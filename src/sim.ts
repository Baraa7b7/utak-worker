// ============================================================
// Simulation-mode module.
//
// One low-level interception point (metaSendOrSim) that every WhatsApp
// outbound call funnels through — see fetchMeta() in meta.ts.
//
// In SIMULATION_MODE the exact JSON body we would have POSTed to Meta is
// written to the sim_outbound D1 table together with a synthetic wamid,
// and a Response identical in shape to a successful Meta response is
// returned so all upper-layer code (retry, log, quote tracking) keeps
// running unchanged.
//
// Every /sim/* endpoint is gated by SIM_SECRET (constant-time compare).
// ============================================================

import type { Env } from "./config";
import { SIM_GUARD_MODELS, SIM_MARKED_MODELS, SIM_PURGE_ORDER, runtimeMode } from "./config";
import { call as odooCall } from "./odoo";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

export function isSimulation(env: Env): boolean {
  return env.SIMULATION_MODE === "true";
}

export function isPilot(env: Env): boolean {
  return env.PILOT_MODE === "true";
}

/** True when either sim or pilot — the /sim/* control plane accepts both. */
export function isNonProd(env: Env): boolean {
  const rm = runtimeMode(env);
  return rm.mode !== "prod";
}

/** Constant-time string compare so a bad SIM_SECRET can't be timed. */
export function verifySimSecret(env: Env, provided: string | null): boolean {
  const expected = env.SIM_SECRET ?? "";
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Synthetic wamid, mirroring Meta's shape: `wamid.HBg...` base64-ish blob.
 * We prefix with `wamid.SIM.` so a downstream grep can always tell them apart
 * from real ones. Length matches Meta's ~50-char typical.
 */
export function generateFakeWamid(): string {
  const rand = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...rand))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `wamid.SIM.${b64}`;
}

/** Per-run id lives in KV under a fixed key; a POST /sim/reset can rotate it. */
const RUN_ID_KEY = "sim:current_run_id";

export async function getCurrentRunId(env: Env): Promise<string> {
  const stored = await env.MSG_DEDUP.get(RUN_ID_KEY);
  if (stored) return stored;
  const fresh = `run_${Date.now()}`;
  await env.MSG_DEDUP.put(RUN_ID_KEY, fresh);
  return fresh;
}

export async function setCurrentRunId(env: Env, runId: string): Promise<void> {
  await env.MSG_DEDUP.put(RUN_ID_KEY, runId);
}

// ------------------------------------------------------------
// Outbound recording (called from meta.ts::fetchMeta)
//
// Two operations, one usable in either sim or pilot mode:
//   recordOutbound         — write one row to sim_outbound (D1). Throws
//                            on hard failure; the caller decides whether
//                            to surface it or log-and-continue.
//   synthesizeMetaResponse — build a Meta-shaped success Response. Used
//                            in sim mode where no real send happens.
//
// Splitting these lets pilot mode reuse recordOutbound with the REAL
// wamid extracted from the actual Meta response, and lets sim mode
// pair it with a synthetic wamid so the caller still gets a JSON body
// that looks exactly like graph.facebook.com's.
// ------------------------------------------------------------

export interface RecordOutboundInput {
  /** The full JSON body that was (sim) OR was about to be (pilot) POSTed to Meta. */
  body: Record<string, unknown>;
  /** The wamid to save. Synthetic in sim, real in pilot. */
  wamid: string;
  /** Whether the Meta send actually succeeded. Sim always passes false. */
  delivered: boolean;
}

export async function recordOutbound(env: Env, input: RecordOutboundInput): Promise<void> {
  if (!env.SIM_DB) {
    throw new Error("SIM_DB binding missing — sim_outbound cannot be written");
  }

  const runId = await getCurrentRunId(env);
  const ts = Date.now();

  const body = input.body as {
    to?: string;
    type?: string;
    text?: { body?: string };
    template?: { name?: string; components?: unknown[] };
    interactive?: { body?: { text?: string }; action?: unknown };
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  };

  const to_number = String(body.to ?? "");
  const msg_type = String(body.type ?? "unknown");
  let template_name: string | null = null;
  let variables_json: string | null = null;
  let body_text: string | null = null;
  let attachment: string | null = null;

  if (msg_type === "text") {
    body_text = body.text?.body ?? null;
  } else if (msg_type === "template" && body.template) {
    template_name = body.template.name ?? null;
    const comps = (body.template.components ?? []) as Array<Record<string, unknown>>;
    variables_json = JSON.stringify(comps);
    const bodyComp = comps.find((c) => c.type === "body") as
      | { parameters?: Array<{ text?: string }> }
      | undefined;
    if (bodyComp?.parameters) {
      body_text = bodyComp.parameters.map((p) => p.text ?? "").join(" | ");
    }
    const header = comps.find((c) => c.type === "header") as
      | { parameters?: Array<Record<string, unknown>> }
      | undefined;
    if (header?.parameters?.[0]) {
      attachment = JSON.stringify(header.parameters[0]);
    }
  } else if (msg_type === "interactive" && body.interactive) {
    body_text = body.interactive.body?.text ?? null;
    variables_json = JSON.stringify(body.interactive.action ?? null);
  } else if (msg_type === "location" && body.location) {
    body_text = [body.location.name, body.location.address].filter(Boolean).join(" — ") || null;
    attachment = JSON.stringify(body.location);
  }

  // The `delivered` flag rides in the raw_request blob (schema didn't have
  // a column and adding one is a migration Baraa hasn't approved yet).
  const rawWithFlag = JSON.stringify({ ...(input.body as object), __delivered: input.delivered });

  await env.SIM_DB.prepare(
    `INSERT INTO sim_outbound
     (run_id, ts_ms, to_number, msg_type, template_name, variables_json, body_text, attachment, wamid, raw_request)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      ts,
      to_number,
      msg_type,
      template_name,
      variables_json,
      body_text,
      attachment,
      input.wamid,
      rawWithFlag,
    )
    .run();
}

/**
 * Build a Meta-shaped 200 response so sim callers see the same JSON
 * (`messaging_product`, `contacts`, `messages[0].id`) as a real send.
 */
export function synthesizeMetaResponse(to: string, wamid: string): Response {
  return new Response(
    JSON.stringify({
      messaging_product: "whatsapp",
      contacts: [{ input: to, wa_id: to }],
      messages: [{ id: wamid, message_status: "accepted" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Try to read the real wamid Meta returned. Never throws — a parse
 * failure surfaces as a labeled placeholder so the D1 row is still
 * useful for /sim/purge coverage.
 */
export async function extractRealWamid(resp: Response): Promise<string> {
  try {
    const clone = resp.clone();
    const j = (await clone.json()) as { messages?: Array<{ id?: string }> };
    const id = j?.messages?.[0]?.id;
    if (typeof id === "string" && id) return id;
  } catch {
    /* ignore — fall through */
  }
  return `wamid.PILOT.no_id.${Date.now()}`;
}

// ------------------------------------------------------------
// D1 read / reset
// ------------------------------------------------------------

export interface SimOutboundRow {
  id: number;
  run_id: string;
  ts_ms: number;
  to_number: string;
  msg_type: string;
  template_name: string | null;
  variables_json: string | null;
  body_text: string | null;
  attachment: string | null;
  wamid: string;
  raw_request: string;
}

export async function readOutbound(
  env: Env,
  runId: string,
  limit = 500,
): Promise<SimOutboundRow[]> {
  if (!env.SIM_DB) return [];
  const stmt = env.SIM_DB.prepare(
    `SELECT id, run_id, ts_ms, to_number, msg_type, template_name,
            variables_json, body_text, attachment, wamid, raw_request
       FROM sim_outbound
      WHERE run_id = ?
      ORDER BY id ASC
      LIMIT ?`,
  ).bind(runId, limit);
  const { results } = await stmt.all<SimOutboundRow>();
  return results ?? [];
}

export async function resetOutboundRun(env: Env, runId: string): Promise<number> {
  if (!env.SIM_DB) return 0;
  const res = await env.SIM_DB.prepare(`DELETE FROM sim_outbound WHERE run_id = ?`)
    .bind(runId)
    .run();
  // D1 exposes changes on `meta.changes` — falls back to 0 if the driver
  // shape changes across wrangler versions.
  const meta = (res as unknown as { meta?: { changes?: number }; changes?: number }).meta;
  return meta?.changes ?? (res as unknown as { changes?: number }).changes ?? 0;
}

// ------------------------------------------------------------
// Odoo guard — refuse to boot if any non-sim business row exists
// ------------------------------------------------------------

export interface GuardResult {
  ok: boolean;
  field_present: boolean;
  offending: { model: string; count: number }[];
  message: string;
}

/**
 * Fails closed:
 *  - x_is_simulation field missing on any guarded model → NOT ok
 *  - any row with x_is_simulation != true on any guarded model → NOT ok
 * Baraa's spec explicitly says: never inspect the Odoo URL. Trust only the flag.
 */
export async function guardSimulationOdoo(env: Env): Promise<GuardResult> {
  // 1) Field presence check via ir.model.fields.
  const fieldCheck = await odooCall<Array<{ id: number; model: string }>>(
    env,
    "ir.model.fields",
    "search_read",
    {
      domain: [
        ["name", "=", "x_is_simulation"],
        ["model", "in", SIM_GUARD_MODELS as unknown as string[]],
      ],
      fields: ["id", "model"],
      limit: 100,
    },
  );
  const modelsWithField = new Set(fieldCheck.map((f) => f.model));
  const missing = SIM_GUARD_MODELS.filter((m) => !modelsWithField.has(m));
  if (missing.length > 0) {
    return {
      ok: false,
      field_present: false,
      offending: [],
      message: `x_is_simulation field missing on: ${missing.join(", ")} — add it manually before booting sim.`,
    };
  }

  // 2) Any row missing the flag = production data.
  const offending: { model: string; count: number }[] = [];
  for (const model of SIM_GUARD_MODELS) {
    const count = await odooCall<number>(env, model, "search_count", {
      domain: [
        "|",
        ["x_is_simulation", "=", false],
        ["x_is_simulation", "=", null],
      ],
    });
    if (count > 0) offending.push({ model, count });
  }
  if (offending.length > 0) {
    return {
      ok: false,
      field_present: true,
      offending,
      message:
        "Refusing to run sim: production rows found. Purge or migrate them first.",
    };
  }
  return { ok: true, field_present: true, offending: [], message: "guard passed" };
}

// ------------------------------------------------------------
// /sim/purge — dry-run by default, ?confirm=1 to actually delete
// ------------------------------------------------------------

export interface PurgeReport {
  dry_run: boolean;
  order: readonly string[];
  per_model: PurgeModelResult[];
  total_matched: number;
  total_deleted: number;
  total_archived: number;
  errors: number;
}

export interface PurgeModelResult {
  model: string;
  action: "unlink" | "archive" | "skip";
  matched: number;
  ids_sample: number[];
  deleted?: number;
  archived?: number;
  error?: string;
}

/**
 * Purge every row carrying x_is_simulation=true, in the fixed FK-safe order
 * declared in SIM_PURGE_ORDER. Fail-tolerant: a failure on any one model
 * logs and continues; the final report tells Baraa exactly what worked and
 * what did not.
 *
 * Invariant enforced by construction: every search / unlink domain includes
 * `["x_is_simulation", "=", true]`. There is no code path in this function
 * that can delete rows without that filter — if you edit this function,
 * that invariant is what to protect first.
 *
 * res.partner is archived (write active=false), never deleted, because Odoo
 * refuses to unlink a partner referenced by any surviving row (order, log,
 * message, external system).
 */
export async function purgeSimulationData(
  env: Env,
  opts: { confirm: boolean },
): Promise<PurgeReport> {
  const SIM_FLAG_FILTER: readonly [string, string, boolean] = [
    "x_is_simulation",
    "=",
    true,
  ];
  const per_model: PurgeModelResult[] = [];
  let total_matched = 0;
  let total_deleted = 0;
  let total_archived = 0;
  let errors = 0;

  for (const model of SIM_PURGE_ORDER) {
    if (!SIM_MARKED_MODELS.has(model)) {
      // Guardrail: purge order must never target a model we do not stamp.
      per_model.push({
        model,
        action: "skip",
        matched: 0,
        ids_sample: [],
        error: "in SIM_PURGE_ORDER but not in SIM_MARKED_MODELS — refusing to touch",
      });
      errors++;
      continue;
    }

    let ids: number[] = [];
    try {
      ids = await odooCall<number[]>(env, model, "search", {
        domain: [SIM_FLAG_FILTER],
        limit: 100000,
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`[sim/purge] ${model} search failed`, msg);
      per_model.push({
        model,
        action: "skip",
        matched: 0,
        ids_sample: [],
        error: `search: ${msg}`,
      });
      errors++;
      continue;
    }
    total_matched += ids.length;

    // res.partner: archive, not delete
    if (model === "res.partner") {
      const entry: PurgeModelResult = {
        model,
        action: "archive",
        matched: ids.length,
        ids_sample: ids.slice(0, 5),
      };
      if (ids.length > 0 && opts.confirm) {
        try {
          await odooCall(env, model, "write", {
            ids,
            vals: { active: false },
          });
          entry.archived = ids.length;
          total_archived += ids.length;
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          console.error(`[sim/purge] archive ${model} failed`, msg);
          entry.error = `archive: ${msg}`;
          errors++;
        }
      }
      per_model.push(entry);
      continue;
    }

    // Everything else: unlink with the sim-flag domain baked in (via search)
    const entry: PurgeModelResult = {
      model,
      action: "unlink",
      matched: ids.length,
      ids_sample: ids.slice(0, 5),
    };
    if (ids.length > 0 && opts.confirm) {
      try {
        await odooCall(env, model, "unlink", { ids });
        entry.deleted = ids.length;
        total_deleted += ids.length;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.error(`[sim/purge] unlink ${model} failed`, msg);
        entry.error = `unlink: ${msg}`;
        errors++;
      }
    }
    per_model.push(entry);
  }

  return {
    dry_run: !opts.confirm,
    order: SIM_PURGE_ORDER,
    per_model,
    total_matched,
    total_deleted,
    total_archived,
    errors,
  };
}

// ------------------------------------------------------------
// /sim/inject — mimic a Meta webhook POST for one message
// ------------------------------------------------------------

export interface InjectInput {
  from: string;                                   // E.164 with or without '+'
  type: "text" | "button" | "interactive";
  text?: string;                                  // for type='text'
  button?: { id: string; title: string };         // for type='button' (template quick-reply)
  interactive?:                                    // for type='interactive'
    | { kind: "button_reply"; id: string; title: string }
    | { kind: "list_reply"; id: string; title: string };
  profileName?: string;
}

/**
 * Build a payload that matches the shape parseWebhook() in meta.ts already
 * handles. Never re-uses a wamid: a real Meta message id is unique per event,
 * and MSG_DEDUP would swallow a repeat as a duplicate.
 */
export function buildInjectedWebhookPayload(input: InjectInput): {
  payload: Record<string, unknown>;
  wamid: string;
} {
  const from = input.from.replace(/^\+/, "");
  // Meta wamid format is opaque; we just need something unique the dedup layer
  // has never seen. Prefix labels the source clearly.
  const wamid = `wamid.INJECT.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  let messageObj: Record<string, unknown>;
  if (input.type === "text") {
    messageObj = {
      id: wamid,
      from,
      timestamp,
      type: "text",
      text: { body: input.text ?? "" },
    };
  } else if (input.type === "button") {
    messageObj = {
      id: wamid,
      from,
      timestamp,
      type: "button",
      button: {
        payload: input.button?.id ?? "",
        text: input.button?.title ?? "",
      },
    };
  } else if (input.type === "interactive") {
    const kind = input.interactive?.kind ?? "button_reply";
    messageObj = {
      id: wamid,
      from,
      timestamp,
      type: "interactive",
      interactive:
        kind === "list_reply"
          ? {
              type: "list_reply",
              list_reply: {
                id: input.interactive?.id ?? "",
                title: input.interactive?.title ?? "",
              },
            }
          : {
              type: "button_reply",
              button_reply: {
                id: input.interactive?.id ?? "",
                title: input.interactive?.title ?? "",
              },
            },
    };
  } else {
    throw new Error(`unsupported inject type: ${(input as { type: string }).type}`);
  }

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "SIM_ENTRY",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "SIM",
                phone_number_id: "SIM_PHONE_ID",
              },
              contacts: input.profileName
                ? [{ profile: { name: input.profileName }, wa_id: from }]
                : [{ wa_id: from }],
              messages: [messageObj],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  return { payload, wamid };
}
