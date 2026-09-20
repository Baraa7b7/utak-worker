// Meta WhatsApp Cloud API glue.
// Handles: GET verify challenge, POST HMAC verification, payload parsing, outbound text + interactive buttons.

import type { Env } from "./config";
import { isRecipientAllowed, parseAllowlist, runtimeMode } from "./config";
import type { NormalizedMessage } from "./types";
import {
  extractRealWamid,
  generateFakeWamid,
  recordOutbound,
  synthesizeMetaResponse,
} from "./sim";

// ---- GET /webhook — Meta verification handshake ----
export function handleVerify(url: URL, env: Env): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---- POST /webhook — HMAC-SHA256 signature verification ----
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  env: Env,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice(7);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(hex, provided);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Parse Meta webhook payload ----
// One POST may contain multiple entries and multiple messages.
// v2: also handles `interactive` messages (button/list replies).
export function parseWebhook(payload: unknown): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  // deno-lint-ignore no-explicit-any
  const entries: any[] = (payload as any)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const messages: unknown[] = value?.messages ?? [];
      const contacts: unknown[] = value?.contacts ?? [];

      const nameByFrom = new Map<string, string>();
      for (const c of contacts as { wa_id?: string; profile?: { name?: string } }[]) {
        if (c?.wa_id) nameByFrom.set(c.wa_id, c?.profile?.name ?? "");
      }

      // deno-lint-ignore no-explicit-any
      for (const m of messages as any[]) {
        if (!m?.id || !m?.from) continue;

        let text = "";
        let buttonId: string | undefined;
        let location: NormalizedMessage["location"] | undefined;
        let media: NormalizedMessage["media"] | undefined;

        if (m.type === "text") {
          text = m?.text?.body ?? "";
        } else if (m.type === "interactive") {
          const btn = m?.interactive?.button_reply;
          const list = m?.interactive?.list_reply;
          if (btn) {
            buttonId = btn.id;
            text = btn.title ?? "";
          } else if (list) {
            buttonId = list.id;
            text = list.title ?? "";
          }
        } else if (m.type === "button") {
          // template quick-reply button
          buttonId = m?.button?.payload;
          text = m?.button?.text ?? "";
        } else if (m.type === "location") {
          // v4.2 — customer shared a WhatsApp location
          const loc = m?.location;
          const lat = typeof loc?.latitude === "number" ? loc.latitude : Number(loc?.latitude);
          const lng = typeof loc?.longitude === "number" ? loc.longitude : Number(loc?.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            location = {
              latitude: lat,
              longitude: lng,
              name: typeof loc?.name === "string" ? loc.name : undefined,
              address: typeof loc?.address === "string" ? loc.address : undefined,
            };
            // Preserve a human-readable version in `text` too, so anything that
            // only inspects text (e.g. logs) still sees something meaningful.
            text = [loc?.name, loc?.address].filter(Boolean).join(" — ") || `📍 ${lat},${lng}`;
          }
        } else if (
          m.type === "image" || m.type === "audio" || m.type === "video" ||
          m.type === "document" || m.type === "sticker"
        ) {
          // 2026-09-20 (inbox) — extract the media descriptor so the Discuss
          // mirror can pull the bytes from Graph. The customer bot itself
          // does not act on media messages, only the mirror does.
          const raw = m[m.type];
          if (raw && typeof raw.id === "string") {
            media = {
              id: raw.id,
              mime_type: typeof raw.mime_type === "string" ? raw.mime_type : undefined,
              filename: typeof raw.filename === "string" ? raw.filename : undefined,
              voice: raw.voice === true,
              caption: typeof raw.caption === "string" ? raw.caption : undefined,
            };
            text = media.caption ?? "";
          }
        }

        out.push({
          messageId: m.id,
          from: `+${m.from}`,
          fromRaw: m.from,
          profileName: nameByFrom.get(m.from) ?? "",
          text,
          timestamp: m.timestamp ?? "",
          type: m.type ?? "unknown",
          buttonId,
          location,
          media,
        });
      }
    }
  }
  return out;
}

// ============================================================
// The single interception point.
//
// Every outbound Meta call (sendText / sendTemplate / sendLocation /
// sendButtons here, plus sendTemplateByPurpose in templates.ts) funnels
// through fetchMeta. Three independent guards run BEFORE any dispatch:
//
//   1. Runtime-mode sanity: refuse when SIMULATION_MODE and PILOT_MODE
//      are both set, or when PILOT_MODE lacks SIM_ALLOWLIST.
//   2. Owner-guard (2026-09-16): if the recipient equals OWNER_WHATSAPP
//      after E.164 digit normalization, only purposes in the owner
//      allowlist are permitted. Every customer / supplier / team path
//      (welcome, quotation, invoice, collection, standing, pay_remind,
//      feedback, inactive, supplier_ask, driver_*) is refused with
//      [owner-guard] blocked purpose=<x>. Owner is a manager only —
//      never a message target on any customer flow.
//   3. Phone-range allowlist (SIM_ALLOWLIST): if set, the recipient's
//      number must start with one of the listed prefixes. Applies in
//      every mode — sim, pilot, prod alike. Unset = production allow-all.
//
// Two independent criteria drive dispatch after the guards:
//
//   • "Test mode?" (sim OR pilot) → recordOutbound writes a sim_outbound row
//     with the appropriate wamid. Both modes generate rows that /sim/purge
//     is later able to find and clean up (paired with the x_is_simulation
//     stamp that odoo.ts::call adds on the Odoo side).
//   • "Real send?" (pilot OR prod) → POST to graph.facebook.com. In pilot
//     the response's real wamid is the one we store in D1; in sim we skip
//     the network and use a synthetic wamid.
// ============================================================

// Options threaded from every send wrapper to fetchMeta. `purpose` is the
// only thing the owner-guard cares about; add other fields here if the
// send layer ever grows further metadata.
export interface SendOpts {
  purpose?: string;
  /**
   * 2026-09-20 — request-scoped ExecutionContext. When present, the Discuss
   * inbox echo is dispatched via ctx.waitUntil so the send returns as soon
   * as Meta's response comes back; the mirror mail.message.create runs in
   * the background and the Worker instance is held open until it settles.
   * Callers on the hot path (handleInboxReplyHook, /webhook) pass their
   * request's ctx; callers without one (crons, scripts) leave it unset and
   * fall back to the awaited path — never a fire-and-forget promise.
   */
  ctx?: ExecutionContext;
}

// Purposes permitted to reach OWNER_WHATSAPP. Anything else addressed at
// the owner is a coding mistake — treat it as such and block loudly.
//   • "owner_alert"    — plain-text alerts sent via sendText(env, OWNER, ...)
//                        from complaint / router / suppliers / team /
//                        quotation / index (driver stop issue).
//   • "owner_summary"  — the approved Meta template T.OWNER_SUMMARY, in
//                        case a future cron uses sendTemplateByPurpose to
//                        deliver the daily summary to the owner.
const OWNER_ALLOWED_PURPOSES: ReadonlySet<string> = new Set([
  "owner_alert",
  "owner_summary",
]);

function ownerDigits(env: Env): string {
  return String(env.OWNER_WHATSAPP ?? "").replace(/[^0-9]/g, "");
}

function toDigits(to: string): string {
  return String(to ?? "").replace(/[^0-9]/g, "");
}

function isOwnerRecipient(env: Env, to: string): boolean {
  const owner = ownerDigits(env);
  return owner.length > 0 && toDigits(to) === owner;
}

function metaErrorResponse(message: string, type: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: { message, type } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function metaRealSend(env: Env, body: Record<string, unknown>): Promise<Response> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function fetchMeta(
  env: Env,
  body: Record<string, unknown>,
  opts: SendOpts = {},
): Promise<Response> {
  const rm = runtimeMode(env);
  if (rm.misconfig) {
    console.error(`[fetchMeta] refusing send — ${rm.misconfig}`);
    return metaErrorResponse(rm.misconfig, "RuntimeMisconfig", 500);
  }

  const to = String((body as { to?: unknown }).to ?? "");

  // ---- owner-guard (allowlist by purpose) ----
  // Runs BEFORE the SIM_ALLOWLIST check so the log line names the real
  // reason. The owner number is a management inbox: it must never be the
  // audience of a customer-flow send, whatever the environment.
  if (isOwnerRecipient(env, to)) {
    const p = opts.purpose ?? "";
    if (!OWNER_ALLOWED_PURPOSES.has(p)) {
      const shown = p || "(none)";
      console.warn(`[owner-guard] blocked purpose=${shown}`);
      return metaErrorResponse(
        `owner-guard: purpose=${shown} not permitted for owner recipient`,
        "OwnerGuardBlocked",
        403,
      );
    }
  }

  if (!isRecipientAllowed(env, to)) {
    // item4 (2026-09-17) — second gate: per-partner x_wa_allowed flag,
    // Odoo-backed with a 60s KV cache. Owner-guard has already run above
    // and remains non-bypassable; this only affects non-owner recipients.
    const { isPartnerWaAllowed } = await import("./odoo");
    const partnerAllowed = await isPartnerWaAllowed(env, to);
    if (!partnerAllowed) {
      const list = parseAllowlist(env);
      const msg = `to=${to} not permitted by SIM_ALLOWLIST (${list.length} entries) and no partner with x_wa_allowed=true`;
      console.warn(`[fetchMeta] BLOCKED by allowlist: ${msg}`);
      return metaErrorResponse(msg, "AllowlistBlocked", 403);
    }
    console.log(`[fetchMeta] permitted via partner.x_wa_allowed=true to=${to}`);
  }

  // ---- sim: capture only, no real send ----
  if (rm.mode === "sim") {
    const wamid = generateFakeWamid();
    try {
      await recordOutbound(env, { body, wamid, delivered: false });
    } catch (e) {
      // A missing D1 or hard insert failure is fatal in sim: silently
      // dropping messages would give agents false-passing runs.
      const msg = (e as Error)?.message ?? String(e);
      console.error("[fetchMeta] sim recordOutbound failed", msg);
      return metaErrorResponse(msg, "SimStorageError", 500);
    }
    // 2026-09-20 (inbox) — echo the send into the recipient's Discuss
    // channel so Baraa sees a unified conversation. When a ctx is
    // threaded from the request handler we dispatch via ctx.waitUntil so
    // the send returns as fast as Meta let us — the mirror still runs to
    // completion in the background. Without ctx we await, so a script
    // caller never turns the echo into a fire-and-forget promise the
    // Worker might reclaim mid-flight.
    await dispatchEcho(env, to, body, opts.ctx);
    return synthesizeMetaResponse(to, wamid);
  }

  // ---- pilot: real send + capture, tied by real wamid ----
  if (rm.mode === "pilot") {
    const resp = await metaRealSend(env, body);
    const wamid = await extractRealWamid(resp);

    // On failure, snapshot Meta's status + error body so post-mortem doesn't
    // require correlated wrangler-tail logs. Body is cloned before any other
    // reader touches it, so the original resp stays consumable by the caller.
    let metaStatus: number | undefined = undefined;
    let metaError: { code: number | null; error_subcode: number | null; message: string } | null =
      null;
    if (!resp.ok) {
      metaStatus = resp.status;
      try {
        const errText = await resp.clone().text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(errText);
        } catch {
          parsed = null;
        }
        // deno-lint-ignore no-explicit-any
        const e = (parsed as any)?.error ?? null;
        const rawMsg = e?.message ?? errText ?? "";
        metaError = {
          code: typeof e?.code === "number" ? e.code : null,
          error_subcode: typeof e?.error_subcode === "number" ? e.error_subcode : null,
          message: String(rawMsg).slice(0, 500),
        };
      } catch (e) {
        metaError = {
          code: null,
          error_subcode: null,
          message: String((e as Error)?.message ?? e).slice(0, 500),
        };
      }
      console.warn(
        `[meta] send failed status=${metaStatus} code=${metaError?.code ?? "null"}`,
      );
    }

    try {
      await recordOutbound(env, { body, wamid, delivered: resp.ok, metaStatus, metaError });
    } catch (e) {
      // Best-effort in pilot: the message was already delivered to Meta,
      // so a D1 write failure must NOT flip the caller's success path.
      // Loud log so operators notice /sim/purge coverage will be short.
      console.error(
        "[fetchMeta] pilot recordOutbound failed — real send succeeded, D1 row missing",
        (e as Error)?.message ?? String(e),
      );
    }
    if (resp.ok) {
      await dispatchEcho(env, to, body, opts.ctx);
    }
    return resp;
  }

  // ---- prod: unchanged ----
  const prodResp = await metaRealSend(env, body);
  if (prodResp.ok) {
    await dispatchEcho(env, to, body, opts.ctx);
  }
  return prodResp;
}

/**
 * Route the inbox echo to the right lifecycle:
 *   - With ctx: schedule via ctx.waitUntil so fetchMeta returns immediately
 *     and the Worker instance stays alive until the mirror settles.
 *   - Without ctx: await it inline so no unattached promise gets orphaned
 *     if the Worker is recycled the moment fetchMeta returns.
 *
 * Awaiting this function is a no-op in the ctx path and a real wait in the
 * fallback — both are safe; the caller's total latency is bounded by which
 * one is in play.
 */
async function dispatchEcho(
  env: Env,
  to: string,
  body: Record<string, unknown>,
  ctx: ExecutionContext | undefined,
): Promise<void> {
  const task = echoOutboundToInbox(env, to, body).catch((e) =>
    console.warn("[fetchMeta] echo failed:", (e as Error).message),
  );
  if (ctx) {
    ctx.waitUntil(task);
    return;
  }
  await task;
}

// -------------------------------------------------------------
// Inbox echo (2026-09-20). Best-effort mirror of outbound sends into the
// recipient's Discuss channel as UTAK بوت. Every failure logs a warning
// and never affects the send's return path.
// -------------------------------------------------------------

function metaBodyToEchoText(body: Record<string, unknown>): string {
  const b = body as { type?: string;
    text?: { body?: string };
    template?: { name?: string; components?: Array<{ parameters?: Array<{ text?: string }> }> };
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
    interactive?: { body?: { text?: string }; action?: { buttons?: Array<{ reply?: { title?: string } }> } };
    document?: { filename?: string };
  };
  if (b.type === "text") return String(b.text?.body ?? "");
  if (b.type === "template") {
    const name = b.template?.name ?? "?";
    const params = (b.template?.components ?? [])
      .flatMap((c) => c?.parameters ?? [])
      .map((p) => p?.text ?? "")
      .filter(Boolean);
    return params.length ? `📋 قالب: ${name} (${params.join("، ")})` : `📋 قالب: ${name}`;
  }
  if (b.type === "location") {
    const lat = b.location?.latitude;
    const lng = b.location?.longitude;
    const label = b.location?.name ?? b.location?.address ?? "";
    return `📍 موقع${label ? " · " + label : ""} — https://maps.google.com/?q=${lat},${lng}`;
  }
  if (b.type === "interactive") {
    const text = b.interactive?.body?.text ?? "";
    const btns = (b.interactive?.action?.buttons ?? [])
      .map((btn) => btn?.reply?.title ?? "")
      .filter(Boolean);
    return btns.length ? `${text}\n[أزرار: ${btns.join(" | ")}]` : text;
  }
  if (b.type === "document") {
    const fn = b.document?.filename ?? "مستند";
    return `📎 ${fn}`;
  }
  return `[${b.type ?? "unknown"}]`;
}

async function echoOutboundToInbox(
  env: Env,
  to: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Owner is not a customer conversation — never echo owner-alert traffic
  // into a Discuss channel.
  if (isOwnerRecipient(env, to)) return;
  const echoText = metaBodyToEchoText(body);
  if (!echoText) return;
  // Resolve the partner by phone / whatsapp number, then post as UTAK بوت.
  const digits = toDigits(to);
  if (!digits) return;
  try {
    const { call } = await import("./odoo");
    const rows = await call<Array<{ id: number; name: string }>>(
      env,
      "res.partner",
      "search_read",
      {
        domain: ["|", ["x_whatsapp_number", "ilike", digits], ["phone", "ilike", digits]],
        fields: ["id", "name"],
        limit: 1,
      },
    );
    if (!rows[0]) return;
    const { echoOutbound } = await import("./wa-inbox");
    await echoOutbound(env, rows[0].id, rows[0].name, echoText);
  } catch (e) {
    console.warn("[fetchMeta] echoOutboundToInbox failed:", (e as Error).message);
  }
}

// ---- Send outbound text via Meta Graph API ----
export async function sendText(
  env: Env,
  to: string,
  body: string,
  opts: SendOpts = {},
): Promise<Response> {
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "text",
    text: { body },
  }, opts);
}

// ---- v3: Send an approved template message (one body parameter for now) ----
// Meta template call. `bodyParams` maps to {{1}}, {{2}}, ... in the template body.
export async function sendTemplate(
  env: Env,
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[] = [],
  opts: SendOpts = {},
): Promise<Response> {
  const components =
    bodyParams.length > 0
      ? [{
          type: "body",
          parameters: bodyParams.map((t) => ({ type: "text", text: t })),
        }]
      : [];
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "ar" },
      components,
    },
  }, opts);
}

// ---- v4.2: Send a WhatsApp location message (opens in Waze/Google Maps) ----
export async function sendLocation(
  env: Env,
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
  opts: SendOpts = {},
): Promise<Response> {
  const loc: Record<string, unknown> = { latitude, longitude };
  if (name) loc.name = name.slice(0, 1000);
  if (address) loc.address = address.slice(0, 1000);
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "location",
    location: loc,
  }, opts);
}

// ---- Send interactive button message (up to 3 buttons) ----
export async function sendButtons(
  env: Env,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  opts: SendOpts = {},
): Promise<Response> {
  // Meta caps: max 3 buttons, id ≤ 256 chars, title ≤ 20 chars.
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));

  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText.slice(0, 1024) },
      action: { buttons: safeButtons },
    },
  }, opts);
}
