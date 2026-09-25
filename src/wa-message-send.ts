// Item 2 (tonight 2026-09-17) — Handle Odoo webhook for x_wa_message rows
// that just transitioned to x_status='queued'.
//
// Flow (see the tonight spec, بند 2):
//   1. Read the wa_message by id. Idempotency: proceed only when
//      x_status = 'queued'. Flip to 'sending' BEFORE any outbound work.
//   2. Resolve recipient: partner.x_whatsapp_number → partner.phone,
//      normalize to E.164 +966....
//   3. Reject if recipient equals OWNER_WHATSAPP (Baraa) — this route
//      is customer-facing; owner is a management inbox only.
//   4. If x_manual is NOT set, honor SIM_ALLOWLIST (via isRecipientAllowed).
//      x_manual bypasses allowlist for this route ONLY. Owner-guard is
//      never bypassed.
//   5. dry_run=true: run all validation, never call the gateway / no media
//      upload. Terminate with x_status='dry_ok'.
//   6. Kind branches:
//      - template: verify x_meta_status='APPROVED' and x_param_count matches
//        the number of params. Send through the gateway as an approved template.
//      - text: through the gateway ({type:'text', text:{body}}); outside the 24h
//        window it is held (x_status «held») until the number writes.
//        Meta 131047 (=outside the 24h window) → x_status='failed' with the
//        Arabic reason from the spec.
//      - document: upload x_attachment to Meta /media, then the gateway as
//        {type:'document', document:{id:<media_id>, filename:<x_filename>}}.
//      - button_reply: not a valid outbound kind — reject.
//   7. Persist wamid / status / processed_at / meta_error. Post an audit
//      line to the partner chatter and (if x_res_model/x_res_id set) to
//      the related record's chatter.

import type { Env } from "./config";
import { isRecipientAllowed } from "./config";
import { call } from "./odoo";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";

interface WaMessageRow {
  id: number;
  x_partner_id: [number, string] | false;
  x_direction: string | false;
  x_kind: string | false;
  x_template_id: [number, string] | false;
  x_params: string | false;
  x_body: string | false;
  x_attachment: string | false; // base64
  x_filename: string | false;
  x_res_model: string | false;
  x_res_id: number | false;
  x_status: string | false;
  x_meta_message_id: string | false;
  x_dry_run: boolean;
  x_manual: boolean;
}

interface PartnerRow {
  id: number;
  name: string;
  x_whatsapp_number: string | false;
  phone: string | false;
}

interface TemplateRow {
  id: number;
  x_meta_template_id: string | false;
  x_meta_id: string | false;
  x_meta_status: string | false;
  x_language: string | false;
  x_param_count: number | false;
  x_category: string | false;
}

const nowOdoo = (): string =>
  new Date().toISOString().replace("T", " ").slice(0, 19);

// Very lenient E.164 → +966 default (matches other UTAK helpers).
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("966")) return `+${digits}`;
  if (digits.startsWith("00966")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length === 10) return `+966${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `+966${digits}`;
  // If the caller already gave a plain international number, keep it.
  if (raw.startsWith("+")) return raw;
  return `+${digits}`;
}

function ownerDigits(env: Env): string {
  return String(env.OWNER_WHATSAPP ?? "").replace(/[^0-9]/g, "");
}
function toDigits(s: string): string {
  return String(s ?? "").replace(/[^0-9]/g, "");
}

async function fetchWaMessage(env: Env, id: number): Promise<WaMessageRow | null> {
  const rows = await call<WaMessageRow[]>(env, "x_wa_message", "read", {
    ids: [id],
    fields: [
      "id",
      "x_partner_id",
      "x_direction",
      "x_kind",
      "x_template_id",
      "x_params",
      "x_body",
      "x_attachment",
      "x_filename",
      "x_res_model",
      "x_res_id",
      "x_status",
      "x_meta_message_id",
      "x_dry_run",
      "x_manual",
    ],
  });
  return rows[0] ?? null;
}

async function fetchPartner(env: Env, id: number): Promise<PartnerRow | null> {
  const rows = await call<PartnerRow[]>(env, "res.partner", "read", {
    ids: [id],
    fields: ["id", "name", "x_whatsapp_number", "phone"],
  });
  return rows[0] ?? null;
}

async function fetchTemplate(env: Env, id: number): Promise<TemplateRow | null> {
  const rows = await call<TemplateRow[]>(env, "x_whatsapp_template", "read", {
    ids: [id],
    fields: [
      "id",
      "x_meta_template_id",
      "x_meta_id",
      "x_meta_status",
      "x_language",
      "x_param_count",
      "x_category",
    ],
  });
  return rows[0] ?? null;
}

async function updateWaMessage(
  env: Env,
  id: number,
  vals: Record<string, unknown>,
): Promise<void> {
  await call<boolean>(env, "x_wa_message", "write", { ids: [id], vals });
}

// Best-effort chatter write. A failing chatter post never fails the send —
// the row itself is the source of truth for outcomes.
async function postChatter(
  env: Env,
  model: string,
  resId: number,
  body: string,
): Promise<void> {
  try {
    await call<number>(env, model, "message_post", { ids: [resId], body });
  } catch (e) {
    console.warn(`[wa-msg chatter] ${model}#${resId} post failed`, (e as Error)?.message);
  }
}

// Upload a base64 attachment to Meta /media. Returns the media id string.
async function uploadMediaToMeta(
  env: Env,
  b64: string,
  filename: string,
): Promise<string> {
  // Guess a MIME type from the filename (PDF is the overwhelming case for us;
  // any other type still uploads as octet-stream and Meta accepts it).
  const lower = (filename || "").toLowerCase();
  let mime = "application/octet-stream";
  if (lower.endsWith(".pdf")) mime = "application/pdf";
  else if (lower.endsWith(".png")) mime = "image/png";
  else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
  else if (lower.endsWith(".mp4")) mime = "video/mp4";

  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: mime });
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", blob, filename || "file");

  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/media`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meta media upload failed status=${res.status} body=${text.slice(0, 400)}`);
  }
  const j = JSON.parse(text) as { id?: string };
  if (!j.id) throw new Error(`meta media upload returned no id: ${text.slice(0, 200)}`);
  return j.id;
}

interface HandleResult {
  ok: boolean;
  final_status: string;
  reason?: string;
  wamid?: string;
}

export async function handleWaMessageWebhook(
  env: Env,
  waId: number,
  ctx?: ExecutionContext,
): Promise<HandleResult> {
  const msg = await fetchWaMessage(env, waId);
  if (!msg) return { ok: false, final_status: "missing", reason: `no row ${waId}` };

  // 1. Idempotency guard: only 'queued' proceeds. Anything else means either
  //    a duplicate fire or a manual reset — leave the row alone.
  if (msg.x_status !== "queued") {
    return {
      ok: true,
      final_status: msg.x_status || "",
      reason: `not queued (current=${msg.x_status})`,
    };
  }
  await updateWaMessage(env, waId, { x_status: "sending" });

  // Helper to bail out with a failed status + chatter write.
  const fail = async (reason: string): Promise<HandleResult> => {
    await updateWaMessage(env, waId, {
      x_status: "failed",
      x_meta_error: reason.slice(0, 2000),
      x_processed_at: nowOdoo(),
    });
    if (msg.x_partner_id) {
      await postChatter(
        env,
        "res.partner",
        msg.x_partner_id[0],
        `فشل إرسال واتساب #${waId}: ${reason.slice(0, 400)}`,
      );
    }
    if (msg.x_res_model && typeof msg.x_res_id === "number" && msg.x_res_id > 0) {
      await postChatter(
        env,
        msg.x_res_model,
        msg.x_res_id,
        `فشل إرسال واتساب #${waId}: ${reason.slice(0, 400)}`,
      );
    }
    return { ok: false, final_status: "failed", reason };
  };

  // 2. Resolve recipient.
  if (!msg.x_partner_id) return await fail("لا يوجد شريك مربوط بالرسالة");
  const partner = await fetchPartner(env, msg.x_partner_id[0]);
  if (!partner) return await fail(`الشريك ${msg.x_partner_id[0]} غير موجود`);

  const rawPhone =
    (typeof partner.x_whatsapp_number === "string" && partner.x_whatsapp_number) ||
    (typeof partner.phone === "string" && partner.phone) ||
    "";
  const to = normalizePhone(rawPhone);
  if (!to) return await fail(`الشريك ${partner.name} بدون رقم واتساب صالح`);

  // 3. Owner-guard (never bypassable, even with x_manual).
  const owner = ownerDigits(env);
  if (owner && toDigits(to) === owner) {
    return await fail("رقم المالك لا يُستخدم كوجهة");
  }

  // 4. SIM_ALLOWLIST + item4 per-partner allowlist. x_manual bypasses BOTH
  //    here (this route only). Owner-guard above stays non-bypassable.
  if (!msg.x_manual && !isRecipientAllowed(env, to)) {
    const { isPartnerWaAllowed } = await import("./odoo");
    const partnerOK = await isPartnerWaAllowed(env, to);
    if (!partnerOK) {
      return await fail(
        `الرقم ${to} خارج SIM_ALLOWLIST وبلا x_wa_allowed — فعّل الخانة على الشريك أو x_manual للتجاوز`,
      );
    }
    console.log(`[wa-msg] permitted via partner.x_wa_allowed=true to=${to}`);
  }

  // 5. dry_run: validate the rest of the message shape but never send.
  //    Same validators as the real branches, so a dry_ok is a strong signal
  //    the queued send would go through.
  const kind = msg.x_kind || "";
  const isText = kind === "text";
  const isTemplate = kind === "template";
  const isDocument = kind === "document";
  if (kind === "button_reply") return await fail("button_reply is inbound-only");
  if (!isText && !isTemplate && !isDocument) return await fail(`نوع غير مدعوم: ${kind}`);

  // Template + params validation (used by both dry_run and real send).
  let tmpl: TemplateRow | null = null;
  let paramsArray: string[] = [];
  if (isTemplate) {
    if (!msg.x_template_id) return await fail("قالب غير محدد");
    tmpl = await fetchTemplate(env, msg.x_template_id[0]);
    if (!tmpl) return await fail(`القالب ${msg.x_template_id[0]} غير موجود`);
    const status = String(tmpl.x_meta_status ?? "").toUpperCase();
    if (status !== "APPROVED") {
      return await fail(`القالب ${tmpl.x_meta_template_id} حالته ${status} (لازم APPROVED)`);
    }
    if (typeof msg.x_params === "string" && msg.x_params.trim()) {
      try {
        const raw = JSON.parse(msg.x_params);
        if (!Array.isArray(raw)) return await fail("x_params لازم يكون JSON array");
        paramsArray = raw.map((v) => String(v));
      } catch {
        return await fail("x_params ليس JSON صالح");
      }
    }
    const expected = typeof tmpl.x_param_count === "number" ? tmpl.x_param_count : 0;
    if (paramsArray.length !== expected) {
      return await fail(
        `عدد الخانات لا يطابق (المرسل ${paramsArray.length}، المتوقع ${expected})`,
      );
    }
  }

  // Document validation (used by both dry_run and real send).
  if (isDocument) {
    if (!msg.x_attachment) return await fail("مرفق فارغ لنوع document");
    if (!msg.x_filename) return await fail("اسم الملف مطلوب لنوع document");
  }

  // Text: nothing to validate beyond non-empty body.
  if (isText) {
    if (!msg.x_body || !msg.x_body.trim()) return await fail("نص الرسالة فارغ");
  }

  if (msg.x_dry_run) {
    await updateWaMessage(env, waId, {
      x_status: "dry_ok",
      x_processed_at: nowOdoo(),
      x_meta_error: false,
      x_debug_payload: JSON.stringify(
        { to, kind, params: paramsArray, template: tmpl?.x_meta_template_id },
        null,
        2,
      ).slice(0, 4000),
    });
    if (msg.x_partner_id) {
      await postChatter(
        env,
        "res.partner",
        msg.x_partner_id[0],
        `dry-run واتساب #${waId} ناجح — النوع ${kind}`,
      );
    }
    if (msg.x_res_model && typeof msg.x_res_id === "number" && msg.x_res_id > 0) {
      await postChatter(
        env,
        msg.x_res_model,
        msg.x_res_id,
        `dry-run واتساب #${waId} ناجح — النوع ${kind}`,
      );
    }
    return { ok: true, final_status: "dry_ok" };
  }

  // 6. Real send — through the single gateway (STATUS § 33). A text or a
  //    document outside the number's 24h window is held there (x_status
  //    «held») and goes at the number's next inbound; a template goes if Meta
  //    approved it (a MARKETING one only to a number that did not opt out).
  let resp: Response;
  const base = { purpose: "wa_message_manual", to, manual: msg.x_manual, rowId: waId, ctx } as const;
  try {
    if (isText) {
      resp = await sendViaGateway(env, {
        ...base,
        content: { kind: "session", body: { type: "text", text: { body: (msg.x_body || "").slice(0, 4096) } } },
      });
    } else if (isTemplate && tmpl) {
      resp = await sendViaGateway(env, {
        ...base,
        content: {
          kind: "template",
          row: {
            id: tmpl.id,
            x_meta_template_id: String(tmpl.x_meta_template_id || ""),
            x_language: tmpl.x_language,
            x_meta_status: tmpl.x_meta_status,
            x_category: tmpl.x_category,
            x_param_count: tmpl.x_param_count,
          },
          params: paramsArray,
        },
      });
    } else if (isDocument) {
      const mediaId = await uploadMediaToMeta(
        env,
        msg.x_attachment as string,
        (msg.x_filename as string) || "file",
      );
      resp = await sendViaGateway(env, {
        ...base,
        content: { kind: "session", body: { type: "document", document: { id: mediaId, filename: (msg.x_filename as string) || "file" } } },
      });
    } else {
      return await fail(`نوع غير مدعوم: ${kind}`);
    }
  } catch (e) {
    return await fail(`استثناء عند الإرسال: ${(e as Error)?.message ?? String(e)}`);
  }

  // 7. Interpret the gateway's answer.
  const decision = gatewayDecision(resp);
  if (decision?.action === "held") {
    // The gateway wrote x_status «held» on this row; it becomes «sent» at the flush.
    const note = `⏳ رسالة واتساب #${waId} محفوظة: الرقم خارج نافذة 24 ساعة، وتُرسل عند أول رسالة منه.`;
    if (msg.x_partner_id) await postChatter(env, "res.partner", msg.x_partner_id[0], note);
    if (msg.x_res_model && typeof msg.x_res_id === "number" && msg.x_res_id > 0) {
      await postChatter(env, msg.x_res_model, msg.x_res_id, note);
    }
    return { ok: true, final_status: "held", reason: decision.reason };
  }
  if (decision?.action === "skipped") {
    // Row already «skipped» / «expired» with the reason.
    return { ok: false, final_status: "skipped", reason: decision.reason };
  }
  const rawText = await resp.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }

  if (!resp.ok) {
    // deno-lint-ignore no-explicit-any
    const err = (parsed as any)?.error ?? null;
    const code = typeof err?.code === "number" ? err.code : null;
    let reason: string;
    if (code === 131047) {
      reason = "العميل لم يراسل خلال 24 ساعة — أرسل قالباً أولاً";
    } else {
      reason = `Meta ${resp.status} code=${code ?? "?"} msg=${String(err?.message ?? rawText).slice(0, 300)}`;
    }
    return await fail(reason);
  }

  // deno-lint-ignore no-explicit-any
  const wamid = (parsed as any)?.messages?.[0]?.id ?? null;
  await updateWaMessage(env, waId, {
    x_status: "sent",
    x_meta_message_id: wamid || false,
    x_processed_at: nowOdoo(),
    x_meta_error: false,
    // 2026-09-20 (cover) — badge source on the row itself; x_manual is the
    // authoritative flag ("manual send from Odoo").
    x_source: msg.x_manual ? "manual" : "auto",
  });
  if (msg.x_partner_id) {
    await postChatter(
      env,
      "res.partner",
      msg.x_partner_id[0],
      `📩 أُرسلت رسالة واتساب #${waId} (${kind})${wamid ? ` — wamid=${wamid}` : ""}`,
    );
  }
  if (msg.x_res_model && typeof msg.x_res_id === "number" && msg.x_res_id > 0) {
    await postChatter(
      env,
      msg.x_res_model,
      msg.x_res_id,
      `📩 أُرسلت رسالة واتساب #${waId} (${kind})${wamid ? ` — wamid=${wamid}` : ""}`,
    );
  }
  return { ok: true, final_status: "sent", wamid: wamid || undefined };
}

// ============================================================
// Inbound helper — called from the /webhook message pipeline to log every
// incoming (in) or outbound (out) event into x_wa_message. Best-effort:
// a failure here MUST never break the customer / supplier / team flow.
// ============================================================
export interface LogInboundArgs {
  partnerId: number | null;
  direction: "in" | "out";
  kind: "text" | "template" | "document" | "button_reply";
  body?: string;
  metaMessageId?: string;
  status?: string;
  // 2026-09-20 (inbox) — optional back-reference to a mail.message (the
  // Discuss reply that produced this send) so the audit tab in Odoo can
  // link the outbound row to its source.
  resModel?: string;
  resId?: number;
  /**
   * 2026-09-20 (inbox cover) — provenance stamp. "auto" = the Worker sent
   * on its own (bot reply, cron, follow-up). "manual" = a human triggered
   * the send (Discuss composer, /odoo/hook/wa manual send, x_manual=true).
   * "inbound" = the message came from Meta into the Worker. Falls back to
   * an inference from direction+manual when omitted so old callers still
   * write a sensible value.
   */
  source?: "auto" | "manual" | "inbound";
  manual?: boolean;
  /**
   * 2026-09-20 (fix) — unix ms of the source-of-truth timestamp for this
   * event. On inbound, callers pass Meta's own timestamp (already parsed
   * to ms by parseMetaTimestampMs); the value lands in x_processed_at so
   * the 24h-window check reads a Meta clock, not our own. Omitted →
   * fall back to now().
   */
  metaTimestampMs?: number;
  /** 2026-09-24 — Meta error ("Meta 132018: …") for a failed send (x_meta_error). */
  metaError?: string;
}

export async function logWaMessage(env: Env, a: LogInboundArgs): Promise<void> {
  await createWaMessageRow(env, a);
}

/**
 * logWaMessage, returning the new row's id (null when it was skipped or failed).
 * 2026-09-25 (STATUS § 33) — the gateway keeps the id of a held message's row,
 * to turn it «sent» / «expired» later.
 */
export async function createWaMessageRow(
  env: Env,
  a: LogInboundArgs & { debugPayload?: string; extra?: Record<string, unknown> },
): Promise<number | null> {
  try {
    // 2026-09-23 — logical unique index on x_meta_message_id: one row per
    // wamid. Odoo has no DB constraint on this studio field, so the check
    // lives here, in the single function every logger goes through.
    if (a.metaMessageId && (await waMessageExistsForWamid(env, a.metaMessageId))) {
      console.log(`[logWaMessage] wamid=${a.metaMessageId.slice(-10)} already logged — skip`);
      return null;
    }
    const processedAt = typeof a.metaTimestampMs === "number" && Number.isFinite(a.metaTimestampMs)
      ? new Date(a.metaTimestampMs).toISOString().replace("T", " ").slice(0, 19)
      : nowOdoo();
    const vals: Record<string, unknown> = {
      x_direction: a.direction,
      x_kind: a.kind,
      x_status: a.status ?? (a.direction === "in" ? "received" : "sent"),
      x_processed_at: processedAt,
    };
    if (a.partnerId) vals.x_partner_id = a.partnerId;
    if (a.body) vals.x_body = a.body.slice(0, 2000);
    if (a.metaMessageId) vals.x_meta_message_id = a.metaMessageId;
    if (a.resModel) vals.x_res_model = a.resModel;
    if (a.resId) vals.x_res_id = a.resId;
    if (typeof a.manual === "boolean") vals.x_manual = a.manual;
    if (a.metaError) vals.x_meta_error = a.metaError.slice(0, 2000);
    if (a.debugPayload) vals.x_debug_payload = a.debugPayload.slice(0, 4000);
    // 2026-09-25 (STATUS § 36) — the gateway's own fields (x_echo_status …).
    if (a.extra) Object.assign(vals, a.extra);
    const source =
      a.source ??
      (a.direction === "in" ? "inbound" : a.manual === true ? "manual" : "auto");
    // x_source is added by scripts/inbox-cover-20260920-apply.mjs. If Odoo
    // rejects the field name (studio setup lags a Worker deploy), the whole
    // insert would fail — retry once without x_source so the audit row is
    // still created. Best-effort; failure of that retry is still logged.
    vals.x_source = source;
    try {
      const ids = await call<number[]>(env, "x_wa_message", "create", { vals_list: [vals] });
      return Array.isArray(ids) ? ids[0] ?? null : null;
    } catch (e) {
      const em = (e as Error)?.message ?? "";
      if (/x_source/i.test(em)) {
        delete vals.x_source;
        const ids = await call<number[]>(env, "x_wa_message", "create", { vals_list: [vals] });
        console.warn("[logWaMessage] created without x_source — run apply script");
        return Array.isArray(ids) ? ids[0] ?? null : null;
      }
      throw e;
    }
  } catch (e) {
    console.warn("[logWaMessage] failed", (e as Error)?.message);
    return null;
  }
}

/** True when an x_wa_message row already carries this wamid. */
export async function waMessageExistsForWamid(env: Env, wamid: string): Promise<boolean> {
  const rows = await call<Array<{ id: number }>>(env, "x_wa_message", "search_read", {
    domain: [["x_meta_message_id", "=", wamid]],
    fields: ["id"],
    limit: 1,
  });
  return rows.length > 0;
}

// ============================================================
// Meta status callback — a webhook `statuses` update. We correlate by
// meta_message_id and bump x_status. Never creates rows.
// 2026-09-25 (STATUS § 37 أ) — never down: sent < failed < delivered < read
// (src/wa-status.ts statusVerdict). A lower status is not written; «failed»
// after delivered / read is not written and is noted in x_debug_payload.
// ============================================================
export async function updateWaStatusByWamid(
  env: Env,
  wamid: string,
  status: "sent" | "delivered" | "read" | "failed",
  errorMessage?: string,
): Promise<{ id: number; body: string; debugPayload?: string; previous: string; applied: boolean; verdict: import("./wa-status").VerdictWhy } | null> {
  try {
    const rows = await call<Array<{ id: number; x_status: string | false; x_body: string | false; x_debug_payload: string | false }>>(
      env,
      "x_wa_message",
      "search_read",
      {
        domain: [["x_meta_message_id", "=", wamid]],
        fields: ["id", "x_status", "x_body", "x_debug_payload"],
        limit: 1,
      },
    );
    if (rows.length === 0) return null;
    const { statusVerdict, withIgnoredNote } = await import("./wa-status");
    const previous = String(rows[0].x_status || "");
    const v = statusVerdict(previous, status);
    if (v.apply) {
      const vals: Record<string, unknown> = { x_status: status };
      if (errorMessage) vals.x_meta_error = errorMessage.slice(0, 2000);
      await call<boolean>(env, "x_wa_message", "write", {
        ids: [rows[0].id],
        vals,
      });
    } else if (v.why === "failed_after_delivery") {
      console.warn(`[status] wamid=${wamid.slice(-10)} row=${rows[0].id} failed after ${previous} — not written (technical log)`);
      await call<boolean>(env, "x_wa_message", "write", {
        ids: [rows[0].id],
        vals: {
          x_debug_payload: withIgnoredNote(rows[0].x_debug_payload, {
            status, over: previous, at: new Date().toISOString(), error: (errorMessage ?? "").slice(0, 300),
          }),
        },
      });
    }
    return {
      id: rows[0].id,
      body: typeof rows[0].x_body === "string" ? rows[0].x_body : "",
      debugPayload: typeof rows[0].x_debug_payload === "string" ? rows[0].x_debug_payload : undefined,
      previous,
      applied: v.apply,
      verdict: v.why,
    };
  } catch (e) {
    console.warn("[updateWaStatusByWamid] failed", (e as Error)?.message);
    return null;
  }
}
