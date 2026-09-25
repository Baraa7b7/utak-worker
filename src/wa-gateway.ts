// The single WhatsApp send gateway — 2026-09-25 (STATUS § 33).
//
// Every message to Meta — text, buttons, lists, location, document, template,
// Flow — goes through sendViaGateway. It is the only code that POSTs to
// graph.facebook.com/<phone-id>/messages (dispatchToMeta below);
// tests/wa-gateway.test.mts fails the build if anything else does.
//
// A request names its purpose (src/wa-purposes.ts), the recipient, the
// content, the fallback template(s) if any, and — through the purpose, or
// explicitly — how long it stays deliverable and whether it is important.
// In order:
//   1. runtime sanity, the owner guard and the recipient allowlist (on sim /
//      pilot: SIM_ALLOWLIST, then the partner's x_wa_allowed — § 27). A
//      refused recipient is never held.
//   2. a purpose Meta refused for this number in the last 24h (any refusal but
//      131047 / 131049) is not retried automatically (manual sends excepted).
//   3. the window decision, over the content and then each fallback in order:
//        template → sent if it is APPROVED, its Meta category may carry the
//                   purpose (UTILITY always; MARKETING only for a marketing
//                   purpose) and Meta did not drop it for this number today
//                   (131049) — a template does not need the window;
//        session  → sent if the number's window is open (src/wa-window.ts:
//                   Meta timestamps, 10-minute margin).
//      Nothing usable, and a session option exists → held for the number
//      (src/wa-queue.ts), an x_wa_message row with x_status «held», a line in
//      its Discuss channel, and — for an important purpose — one alert to
//      Baraa per purpose and number per Riyadh day (through this gateway).
//      A critical («مهمة», § 34) purpose also sends the number's «فتح
//      المحادثة» template, once per number and Riyadh day (src/wa-opener.ts).
//      No session option → «skipped», logged the same way. A request marked
//      noHold is skipped instead of held (its content is covered elsewhere).
//   4. one attempt at Meta. Never a second one for the same request.
//
// Meta's refusals, in the send response or in a later `failed` status
// (handleStatusFailure), are all recorded in x_wa_message with their reason:
//   • 131047 → the window is marked closed at once, and a session message that
//     is still valid goes back to the number's queue (twice at most);
//   • 131049 → that template is not sent to that number again today;
//   • anything else → no automatic send of that purpose to that number for 24h
//     (operational and marketing purposes; a bot reply answers a new message
//     and a manual send is Baraa's own, so neither is blocked).
// A status Meta delivers twice is handled once. Nothing here resends in a
// loop: a held message leaves the queue only on the number's next inbound.

import type { Env } from "./config";
import { isRecipientAllowed, parseAllowlist, runtimeMode } from "./config";
import { claimAutoSend, noteManualSend, skippedDuplicateResponse } from "./auto-send-guard";
import { extractRealWamid, generateFakeWamid, recordOutbound, synthesizeMetaResponse } from "./sim";
import { arabicDate, maskPhone, sanitizeTemplateBody } from "./wa-params";
import { recordSendFailure, sendWhat } from "./send-failure";
import { categoryAllowed, expiryFor, purposePolicy } from "./wa-purposes";
import { markWindowClosed, readWindow, waDigits, type WindowState } from "./wa-window";
import {
  enqueueHeld, putBack, queueItemId, queuedNumbers, readQueue, sentMarkKey, SENT_MARK_TTL,
  takeQueue, writeQueue, type QueueItem,
} from "./wa-queue";
import { pickTemplate, TEMPLATE_CANDIDATE_FIELDS, type TemplateCandidate } from "./template-pick";
import { riyadhDateKey, riyadhMinutes } from "./hours";

// ------------------------------------------------------------------ types

export interface QuickReplyPayload {
  /** button index in the template (0-based) */
  index: number;
  /** payload string (what our webhook receives as buttonId when tapped) */
  payload: string;
}

export type HeaderMedia =
  | { type: "document"; link: string; filename: string }
  | { type: "image"; link: string }
  | { type: "video"; link: string };

/** A free-form (session) message: needs the number's 24h window. */
export interface GwSession {
  kind: "session";
  /** The Meta body without messaging_product / to: {type:"text", text:{…}}, interactive, location, document. */
  body: Record<string, unknown>;
}

/** An approved template: looked up by x_purpose, or a row the caller already resolved. */
export interface GwTemplate {
  kind: "template";
  /** x_whatsapp_template.x_purpose to look up (ignored when `row` is given). */
  purpose?: string;
  row?: TemplateCandidate;
  /** {{1}}, {{2}}, … — or a function of the template name (a purpose moving between templates). */
  params?: string[] | ((templateName: string) => string[]);
  buttons?: QuickReplyPayload[];
  header?: HeaderMedia;
}

export type GwOption = GwSession | GwTemplate;

export interface GatewayRequest {
  purpose: string;
  to: string;
  content: GwOption;
  /** Tried in order when the content cannot go (the fallback template, then maybe a session text). */
  fallback?: GwOption[];
  /** Overrides the purpose's importance. */
  important?: boolean;
  /** Overrides the purpose's expiry (unix ms). */
  expiresAt?: number;
  ctx?: ExecutionContext;
  /** The purpose the owner guard sees, when it differs (owner_window). */
  guardPurpose?: string;
  /** A human sent it (x_wa_message x_manual): the row is labelled «يدوي». No gate is bypassed. */
  manual?: boolean;
  /** An x_wa_message row this send settles (the Odoo send route, a held item). */
  rowId?: number;
  /** internal: this send is a queue flush */
  queued?: QueueItem;
  /** internal: the window is already known (the flush) */
  window?: WindowState;
  /**
   * § 34 — outside the window with nothing usable: skipped (logged), not held.
   * For a message another send already covers (the payment ack, which the
   * receipt's utak_payment_received confirms outside the window).
   */
  noHold?: boolean;
  noHoldReason?: string;
}

export type GatewayDecision =
  | { action: "session" }
  | { action: "template"; template: string; lookup?: string }
  | { action: "held"; reason: string; expiresAt: number; duplicate?: boolean }
  | { action: "skipped"; reason: string }
  | { action: "refused"; reason: string }
  | { action: "rejected"; code: number | string | null; template?: string };

const DECISIONS = new WeakMap<Response, GatewayDecision>();

/** What the gateway did with a request (null for a Response it did not produce). */
export function gatewayDecision(resp: Response | null | undefined): GatewayDecision | null {
  return resp ? DECISIONS.get(resp) ?? null : null;
}

function decided(resp: Response, d: GatewayDecision): Response {
  DECISIONS.set(resp, d);
  return resp;
}

function jsonResponse(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function refused(message: string, type: string, status: number): Response {
  return decided(jsonResponse({ error: { message, type } }, status), { action: "refused", reason: `${type}: ${message}` });
}

// ------------------------------------------------------------------ owner guard

// Purposes permitted to reach OWNER_WHATSAPP. Anything else addressed at the
// owner is a coding mistake — blocked loudly (2026-09-16).
//   • owner_alert   — his alerts (sendOwnerAlert), and the one-line «✅ تم»
//   • owner_summary — the approved T.OWNER_SUMMARY template
//   • owner_window  — the daily «بدء الدوام» template (utak_shift_start_v2)
//                     that opens his 24h window (STATUS § 29).
//   • conv_open_owner — utak_update_owner, his «فتح المحادثة» (§ 34)
//   • owner_team_note — the collector's / driver's note (§ 34)
const OWNER_ALLOWED_PURPOSES: ReadonlySet<string> = new Set(["owner_alert", "owner_summary", "owner_window", "conv_open_owner", "owner_team_note"]);

function ownerDigits(env: Env): string {
  return waDigits(String(env.OWNER_WHATSAPP ?? ""));
}
export function isOwnerRecipient(env: Env, to: string): boolean {
  const o = ownerDigits(env);
  return o.length > 0 && waDigits(to) === o;
}

// ------------------------------------------------------------------ rejection memory (KV)

const DAY_MS = 24 * 3600_000;
/** A session message refused with 131047 goes back to the queue at most this many times. */
export const MAX_WINDOW_RETRIES = 2;

function riyadhDayEndMs(now: number): number {
  const r = 3 * 3600_000;
  return Math.floor((now + r) / DAY_MS) * DAY_MS - r + DAY_MS;
}
export function purposeBlockKey(to: string, purpose: string): string {
  return `wa_blk_p:v1:${waDigits(to)}:${purpose}`;
}
export function templateBlockKey(to: string, template: string, now: number = Date.now()): string {
  return `wa_blk_t:v1:${riyadhDateKey(new Date(now))}:${waDigits(to)}:${template}`;
}
export function sentMetaKey(wamid: string): string {
  return `wa_sent:v1:${wamid}`;
}
export function rejectionSeenKey(wamid: string): string {
  return `wa_rej:v1:${wamid}`;
}
/** Does a refusal (not 131047 / 131049) stop this purpose to that number for 24h? */
export function blocksOnRefusal(purpose: string): boolean {
  const k = purposePolicy(purpose)?.kind;
  return k === "operational" || k === "marketing";
}

async function kvGet(env: Env, key: string): Promise<string | null> {
  try { return await env.MSG_DEDUP.get(key); } catch { return null; }
}
async function kvPut(env: Env, key: string, value: string, ttlSec: number): Promise<void> {
  try {
    await env.MSG_DEDUP.put(key, value, { expirationTtl: Math.max(60, Math.ceil(ttlSec)) });
  } catch (e) {
    console.warn(`[gateway] KV write ${key.split(":")[0]} failed`, (e as Error)?.message);
  }
}

/** What we remember about each accepted send, for a later `failed` status. */
interface SentMeta {
  p: string;       // purpose
  d: string;       // digits
  t?: string;      // template name
  s?: Record<string, unknown>; // session body (for a 131047 re-queue)
  c: number;       // created (ms)
  e: number;       // expires (ms)
  i: boolean;      // important
  r?: number;      // x_wa_message row
  a: number;       // attempts so far
  g?: string;      // guard purpose
  m?: boolean;     // manual
}

// ------------------------------------------------------------------ templates

const MAPPING_TTL_MS = 10 * 60 * 1000;
const candidateCache = new Map<string, { rows: TemplateCandidate[]; at: number }>();

/** Test hook — drop cached mappings. */
export function clearTemplateCache(): void { candidateCache.clear(); }

async function fetchCandidates(env: Env, purpose: string): Promise<TemplateCandidate[] | null> {
  const cached = candidateCache.get(purpose);
  if (cached && Date.now() - cached.at < MAPPING_TTL_MS) return cached.rows;
  const res = await fetch(`${env.ODOO_URL}/json/2/x_whatsapp_template/search_read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ODOO_API_KEY}` },
    body: JSON.stringify({
      domain: [["x_purpose", "=", purpose]],
      fields: TEMPLATE_CANDIDATE_FIELDS,
      order: "id desc",
      limit: 10,
    }),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as TemplateCandidate[];
  // "No mapping" is not cached: a purpose wired in Odoo is picked up on the next send.
  if (rows.length > 0) candidateCache.set(purpose, { rows, at: Date.now() });
  return rows;
}

function paramsFor(opt: GwTemplate, name: string): string[] {
  return typeof opt.params === "function" ? opt.params(name) : opt.params ?? [];
}

function buildTemplateBody(opt: GwTemplate, name: string, language: string): Record<string, unknown> {
  const params = paramsFor(opt, name);
  // deno-lint-ignore no-explicit-any
  const components: any[] = [];
  if (opt.header) {
    // deno-lint-ignore no-explicit-any
    const param: any = { type: opt.header.type };
    if (opt.header.type === "document") param.document = { link: opt.header.link, filename: opt.header.filename };
    else if (opt.header.type === "image") param.image = { link: opt.header.link };
    else if (opt.header.type === "video") param.video = { link: opt.header.link };
    components.push({ type: "header", parameters: [param] });
  }
  if (params.length > 0) {
    components.push({ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t) })) });
  }
  for (const b of opt.buttons ?? []) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(b.index),
      parameters: [{ type: "payload", payload: b.payload }],
    });
  }
  return { type: "template", template: { name, language: { code: language || "ar" }, components } };
}

/**
 * § 23 — «إيقاف» stops marketing messages. Any partner on this number with
 * x_wa_marketing_optout blocks a MARKETING template. Odoo unreachable → treated
 * as opted out (no marketing message that day), like readMarketingOptouts.
 */
async function marketingOptedOut(env: Env, to: string): Promise<boolean> {
  const e164 = `+${waDigits(to)}`;
  try {
    const { call } = await import("./odoo");
    const rows = await call<Array<{ id: number }>>(env, "res.partner", "search_read", {
      domain: [["x_wa_marketing_optout", "=", true], "|", ["x_whatsapp_number", "=", e164], ["phone", "=", e164]],
      fields: ["id"],
      limit: 1,
    });
    return rows.length > 0;
  } catch (e) {
    console.warn("[gateway] opt-out read failed — no marketing template", (e as Error)?.message);
    return true;
  }
}

type Resolved = { ok: true; name: string; lookup?: string; body: Record<string, unknown> } | { ok: false; why: string };

async function resolveTemplate(env: Env, purpose: string, opt: GwTemplate, to: string): Promise<Resolved> {
  let row = opt.row ?? null;
  if (!row) {
    const lookup = opt.purpose ?? purpose;
    const rows = await fetchCandidates(env, lookup);
    row = rows ? pickTemplate(rows, (name) => paramsFor(opt, name).length) : null;
    if (!rows || !row) {
      console.warn(`[templates] no mapping for purpose='${lookup}'`);
      return { ok: false, why: `لا قالب مربوط بالغرض ${lookup}` };
    }
    if (rows.length > 1) {
      const { reportDuplicatePurpose } = await import("./templates");
      await reportDuplicatePurpose(env, lookup, rows, row);
    }
  }
  const name = row.x_meta_template_id;
  if (String(row.x_meta_status || "").toUpperCase() !== "APPROVED") {
    return { ok: false, why: `القالب ${name} حالته ${row.x_meta_status || "?"} عند Meta` };
  }
  if (!categoryAllowed(purpose, row.x_category)) {
    console.warn(`[gateway] template ${name} is ${row.x_category || "?"} — not used for purpose=${purpose}`);
    return { ok: false, why: `القالب ${name} فئته ${row.x_category || "?"} ولا يُستعمل لغرض تشغيلي` };
  }
  if (await kvGet(env, templateBlockKey(to, name))) {
    return { ok: false, why: `Meta أسقط القالب ${name} لهذا الرقم اليوم (131049)` };
  }
  if (String(row.x_category || "").toUpperCase() === "MARKETING" && (await marketingOptedOut(env, to))) {
    return { ok: false, why: `الرقم أوقف الرسائل التسويقية، والقالب ${name} تسويقي` };
  }
  return { ok: true, name, lookup: opt.row ? undefined : opt.purpose ?? purpose, body: buildTemplateBody(opt, name, row.x_language || "ar") };
}

// ------------------------------------------------------------------ the gateway

export async function sendViaGateway(env: Env, req: GatewayRequest): Promise<Response> {
  const rm = runtimeMode(env);
  if (rm.misconfig) {
    console.error(`[gateway] refusing send — ${rm.misconfig}`);
    return refused(rm.misconfig, "RuntimeMisconfig", 500);
  }
  const to = waDigits(req.to);
  if (!to) return refused("no recipient", "NoRecipient", 400);

  // ---- owner guard (allowlist by purpose), never bypassed ----
  if (isOwnerRecipient(env, to)) {
    const p = req.guardPurpose ?? req.purpose;
    if (!OWNER_ALLOWED_PURPOSES.has(p)) {
      console.warn(`[owner-guard] blocked purpose=${p}`);
      return refused(`owner-guard: purpose=${p} not permitted for owner recipient`, "OwnerGuardBlocked", 403);
    }
  }

  // ---- the allowlist, before any window decision (STATUS § 27) ----
  // x_manual does not bypass it here: the Odoo send route checks its own
  // allowlist with the bypass, and this final gate still applies (§ 27 d).
  if (!isRecipientAllowed(env, to)) {
    // item4 (2026-09-17) — second gate: per-partner x_wa_allowed (60s KV cache).
    const { isPartnerWaAllowed } = await import("./odoo");
    if (!(await isPartnerWaAllowed(env, to))) {
      const msg = `to=${to} not permitted by SIM_ALLOWLIST (${parseAllowlist(env).length} entries) and no partner with x_wa_allowed=true`;
      console.warn(`[gateway] BLOCKED by allowlist: ${msg}`);
      return refused(msg, "AllowlistBlocked", 403);
    }
    console.log(`[gateway] permitted via partner.x_wa_allowed=true to=${to}`);
  }

  const policy = purposePolicy(req.purpose);
  if (!policy) {
    console.error(`[gateway] unknown purpose '${req.purpose}' — code bug, nothing sent`);
    return refused(`unknown purpose ${req.purpose}`, "UnknownPurpose", 400);
  }

  // ---- a purpose Meta refused for this number (not 131047 / 131049): 24h ----
  // Automatic purposes only: a bot reply answers a new message (not a retry of
  // the refused one), and a manual send is Baraa's own decision.
  if (blocksOnRefusal(req.purpose) && (await kvGet(env, purposeBlockKey(to, req.purpose)))) {
    const reason = `Meta رفض الغرض ${req.purpose} لهذا الرقم خلال 24 ساعة، ولا إعادة تلقائية`;
    console.warn(`[gateway] blocked purpose=${req.purpose} to=${maskPhone(to)} — refused by Meta within 24h`);
    await logSkipped(env, req, to, reason, "skipped");
    return decided(jsonResponse({ error: { message: reason, type: "GatewayBlocked" } }, 409), { action: "skipped", reason });
  }

  // ---- the window decision ----
  const options: GwOption[] = [req.content, ...(req.fallback ?? [])];
  let win: WindowState | undefined = req.window;
  let held: GwSession | null = null;
  const why: string[] = [];
  for (const opt of options) {
    if (opt.kind === "template") {
      let r: Resolved;
      try {
        r = await resolveTemplate(env, req.purpose, opt, to);
      } catch (e) {
        // a caller's params that cannot be built: this option is out, the next one may go
        console.error(`[gateway] template option failed purpose=${req.purpose}`, (e as Error)?.message);
        r = { ok: false, why: `تعذّر بناء القالب: ${(e as Error)?.message ?? e}` };
      }
      if (r.ok) return dispatchToMeta(env, req, to, r.body, r.name, r.lookup);
      why.push(r.why);
      continue;
    }
    win ??= await readWindow(env, to);
    if (win.open) return dispatchToMeta(env, req, to, opt.body);
    held ??= opt;
    why.push(win.closedByMeta ? "Meta أغلق النافذة (131047)" : "الرقم خارج نافذة 24 ساعة");
  }
  if (held && !req.noHold) return hold(env, req, to, held, why);
  if (held && req.noHoldReason) why.push(req.noHoldReason);
  const reason = why.join("؛ ") || "لا محتوى";
  console.warn(`[gateway] skipped purpose=${req.purpose} to=${maskPhone(to)} — ${reason}`);
  await logSkipped(env, req, to, reason, "skipped");
  if (policy.important || req.important) await alertOwnerOnce(env, req.purpose, to, "skipped", reason);
  return decided(jsonResponse({ error: { message: reason, type: "GatewaySkipped" } }, 409), { action: "skipped", reason });
}

// ------------------------------------------------------------------ hold

function riyadhLabel(ms: number): string {
  const d = new Date(ms);
  const m = riyadhMinutes(d);
  return `${arabicDate(riyadhDateKey(d))}، ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

async function hold(env: Env, req: GatewayRequest, to: string, opt: GwSession, why: string[]): Promise<Response> {
  const now = Date.now();
  const policy = purposePolicy(req.purpose)!;
  const important = req.important ?? policy.important;
  const expiresAt = req.expiresAt ?? req.queued?.expiresAt ?? expiryFor(req.purpose, now);
  const reason = why.join("؛ ");
  if (expiresAt <= now) {
    const r = `انتهت صلاحيتها قبل أن تُرسل (${reason})`;
    console.warn(`[gateway] expired purpose=${req.purpose} to=${maskPhone(to)} — ${reason}`);
    await logSkipped(env, req, to, r, "expired", opt.body);
    return decided(jsonResponse({ error: { message: r, type: "GatewayExpired" } }, 409), { action: "skipped", reason: r });
  }
  const item: QueueItem = {
    id: queueItemId(req.purpose, opt.body),
    purpose: req.purpose,
    guardPurpose: req.guardPurpose,
    body: opt.body,
    createdAt: req.queued?.createdAt ?? now,
    expiresAt,
    important,
    rowId: req.rowId ?? req.queued?.rowId,
    attempts: req.queued?.attempts ?? 0,
    manual: req.manual,
  };
  const existing = await readQueue(env, to);
  if (existing.some((i) => i.id === item.id)) {
    console.log(`[gateway] held purpose=${req.purpose} to=${maskPhone(to)} — already in the queue`);
    return decided(jsonResponse({ gateway: { decision: "held", duplicate: true, expiresAt } }, 202),
      { action: "held", reason, expiresAt, duplicate: true });
  }
  const text = sessionEchoText(opt.body);
  const payload = JSON.stringify({ gateway: "held", purpose: req.purpose, reason, expiresAt: new Date(expiresAt).toISOString() });
  item.rowId = await upsertRow(env, item.rowId, to, {
    x_status: "held",
    x_debug_payload: payload,
  }, { body: text, kind: kindOf(opt.body), manual: req.manual, purpose: req.purpose });
  await enqueueHeld(env, to, item, now);
  console.log(`[gateway] held purpose=${req.purpose} to=${maskPhone(to)} until=${new Date(expiresAt).toISOString()} — ${reason}`);
  // § 34 — a critical message: the number's «فتح المحادثة» template, once a day.
  let opener: import("./wa-opener").OpenerResult | null = null;
  if (policy.critical) {
    const { sendOpenerForHeld } = await import("./wa-opener");
    opener = await sendOpenerForHeld(env, to, req.purpose, { ctx: req.ctx, now });
  }
  if (!isOwnerRecipient(env, to)) {
    await echoHeldToInbox(env, to, text, riyadhLabel(expiresAt), req.ctx);
    if (important) await alertOwnerOnce(env, req.purpose, to, "held", riyadhLabel(expiresAt), opener);
  }
  return decided(jsonResponse({ gateway: { decision: "held", expiresAt, opener: opener?.outcome } }, 202), { action: "held", reason, expiresAt });
}

/** One alert to Baraa per purpose, number and Riyadh day (held, skipped, or a 131047 re-queue). */
async function alertOwnerOnce(
  env: Env,
  purpose: string,
  to: string,
  what: "held" | "skipped",
  detail: string,
  opener: import("./wa-opener").OpenerResult | null = null,
): Promise<void> {
  if (isOwnerRecipient(env, to)) return;
  const key = `gw_alert:v1:${riyadhDateKey()}:${waDigits(to)}:${purpose}`;
  if (await kvGet(env, key)) return;
  await kvPut(env, key, new Date().toISOString(), 26 * 3600);
  const label = purposePolicy(purpose)?.label ?? purpose;
  const openerLine = opener?.outcome === "sent" ? ` وأُرسل له قالب «فتح المحادثة» (${opener.template}).`
    : opener?.outcome === "already_today" ? " وقالب «فتح المحادثة» أُرسل له اليوم." : "";
  const text = what === "held"
    ? `📥 رسالة «${label}» إلى ${maskPhone(to)} محفوظة ولم تُرسل: الرقم خارج نافذة 24 ساعة ولا قالب UTILITY لها. تصله عند أول رسالة منه، وتنتهي صلاحيتها ${detail}.${openerLine}`
    : `⚠️ رسالة «${label}» إلى ${maskPhone(to)} لم تُرسل: ${detail}.`;
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.warn("[gateway] owner alert failed", (e as Error)?.message);
  }
}

// ------------------------------------------------------------------ x_wa_message rows

function kindOf(body: Record<string, unknown>): "text" | "template" | "document" {
  const t = (body as { type?: string }).type;
  return t === "template" ? "template" : t === "document" ? "document" : "text";
}

async function partnerForNumber(env: Env, to: string): Promise<{ id: number; name: string } | null> {
  const digits = waDigits(to);
  if (!digits || isOwnerRecipient(env, to)) return null;
  try {
    const { call } = await import("./odoo");
    const rows = await call<Array<{ id: number; name: string }>>(env, "res.partner", "search_read", {
      domain: ["|", ["x_whatsapp_number", "ilike", digits], ["phone", "ilike", digits]],
      fields: ["id", "name"],
      limit: 1,
    });
    if (rows[0]) return rows[0];
    const { inboxPartnerForNumber } = await import("./wa-inbox");
    return await inboxPartnerForNumber(env, to);
  } catch {
    return null;
  }
}

/** Write `vals` on row `rowId`, or create the row. Returns its id (null if Odoo refused). */
async function upsertRow(
  env: Env,
  rowId: number | undefined,
  to: string,
  vals: Record<string, unknown>,
  create: { body: string; kind: "text" | "template" | "document"; manual?: boolean; purpose: string },
): Promise<number | undefined> {
  try {
    const { call } = await import("./odoo");
    if (rowId) {
      await call(env, "x_wa_message", "write", { ids: [rowId], vals });
      return rowId;
    }
    const { createWaMessageRow } = await import("./wa-message-send");
    const partner = await partnerForNumber(env, to);
    const id = await createWaMessageRow(env, {
      partnerId: partner?.id ?? null,
      direction: "out",
      kind: create.kind,
      body: create.body,
      source: create.manual || purposePolicy(create.purpose)?.kind === "manual" ? "manual" : "auto",
      status: String(vals.x_status ?? "sent"),
      metaError: typeof vals.x_meta_error === "string" ? vals.x_meta_error : undefined,
      debugPayload: typeof vals.x_debug_payload === "string" ? vals.x_debug_payload : undefined,
    });
    return id ?? undefined;
  } catch (e) {
    console.warn("[gateway] x_wa_message row failed", (e as Error)?.message);
    return rowId;
  }
}

async function logSkipped(
  env: Env,
  req: GatewayRequest,
  to: string,
  reason: string,
  status: "skipped" | "expired",
  body?: Record<string, unknown>,
): Promise<void> {
  const b = body ?? (req.content.kind === "session" ? req.content.body : undefined);
  await upsertRow(env, req.rowId ?? req.queued?.rowId, to, {
    x_status: status,
    x_meta_error: `البوابة: ${reason}`.slice(0, 2000),
  }, {
    body: b ? sessionEchoText(b) : `📋 ${req.purpose}`,
    kind: b ? kindOf(b) : "template",
    manual: req.manual,
    purpose: req.purpose,
  });
}

// ------------------------------------------------------------------ the one POST to Graph

async function metaRealSend(env: Env, body: Record<string, unknown>): Promise<Response> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function metaErrorOf(text: string, status: number): { code: number | null; error_subcode: number | null; message: string } {
  try {
    // deno-lint-ignore no-explicit-any
    const e = (JSON.parse(text) as any)?.error ?? null;
    return {
      code: typeof e?.code === "number" ? e.code : null,
      error_subcode: typeof e?.error_subcode === "number" ? e.error_subcode : null,
      message: String(e?.message ?? text ?? "").slice(0, 500),
    };
  } catch {
    return { code: null, error_subcode: null, message: (text || `HTTP ${status}`).slice(0, 500) };
  }
}

async function dispatchToMeta(
  env: Env,
  req: GatewayRequest,
  to: string,
  content: Record<string, unknown>,
  templateName?: string,
  lookup?: string,
): Promise<Response> {
  const body: Record<string, unknown> = { messaging_product: "whatsapp", to, ...content };
  const rm = runtimeMode(env);
  const echoPurpose = req.purpose;

  // ---- template variables (2026-09-24, WA-SCENARIOS ح1) ----
  // Newlines/tabs become " · ", runs of spaces collapse, empty becomes "-", long
  // lists are cut on a separator. A caller that passed a newline is a code bug
  // (logged); anything still invalid is refused here as a code error.
  if (body.type === "template") {
    const { fixes, invalid } = sanitizeTemplateBody(body);
    if (fixes.length > 0) {
      console.error(`[tpl-param] code-bug template=${sendWhat(body)} purpose=${req.purpose} fixed=${JSON.stringify(fixes)}`);
    }
    if (invalid.length > 0) {
      await recordSendFailure(env, {
        to, what: sendWhat(body), code: "TemplateParamInvalid",
        message: `invalid template variable(s) ${JSON.stringify(invalid)}`, phase: "code",
      });
      return refused("template variable invalid after sanitize", "TemplateParamInvalid", 400);
    }
  }

  // ---- automated-send idempotency (2026-09-23) ----
  if (env.AUTO_SEND_JOB) {
    try {
      const c = await claimAutoSend(env, to, body, env.AUTO_SEND_JOB);
      if (!c.claimed) {
        console.warn(`[auto-send] skipped duplicate key=${c.key} first_at=${c.firstAt}`);
        return decided(skippedDuplicateResponse(c.key, c.firstAt), { action: "refused", reason: "SkippedDuplicate" });
      }
    } catch (e) {
      console.warn("[auto-send] idempotency KV failed — sending anyway", (e as Error)?.message);
    }
  } else if (req.purpose === "wa_message_manual") {
    const m = await noteManualSend(env, to, body);
    if (m.repeated) console.warn(`[manual-send] identical manual send to=${to} repeated within 60s (key=${m.key}) — not blocked`);
  }

  const via: GatewayDecision = templateName ? { action: "template", template: templateName, lookup } : { action: "session" };

  // ---- sim: capture only, no real send ----
  if (rm.mode === "sim") {
    const wamid = generateFakeWamid();
    try {
      await recordOutbound(env, { body, wamid, delivered: false });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.error("[gateway] sim recordOutbound failed", msg);
      return refused(msg, "SimStorageError", 500);
    }
    await afterAccepted(env, req, to, body, wamid, templateName);
    await dispatchEcho(env, to, body, req.ctx, echoPurpose, wamid, req.rowId ?? req.queued?.rowId, templateName);
    return decided(synthesizeMetaResponse(to, wamid), via);
  }

  // ---- pilot and prod: the real send ----
  const resp = await metaRealSend(env, body);
  let wamid: string | undefined;
  if (rm.mode === "pilot") {
    wamid = await extractRealWamid(resp);
  } else if (resp.ok) {
    try {
      // deno-lint-ignore no-explicit-any
      wamid = ((await resp.clone().json()) as any)?.messages?.[0]?.id ?? undefined;
    } catch { /* ignore */ }
  }
  let metaError: ReturnType<typeof metaErrorOf> | null = null;
  if (!resp.ok) {
    let errText = "";
    try { errText = await resp.clone().text(); } catch { /* ignore */ }
    metaError = metaErrorOf(errText, resp.status);
    console.warn(`[meta] send failed status=${resp.status} code=${metaError.code ?? "null"}`);
  }
  if (rm.mode === "pilot") {
    try {
      await recordOutbound(env, {
        body, wamid: wamid ?? "", delivered: resp.ok,
        metaStatus: resp.ok ? undefined : resp.status, metaError,
      });
    } catch (e) {
      // Best-effort in pilot: the message already reached Meta.
      console.error("[gateway] pilot recordOutbound failed — real send succeeded, D1 row missing", (e as Error)?.message ?? String(e));
    }
  }
  if (resp.ok) {
    await afterAccepted(env, req, to, body, wamid, templateName);
    await dispatchEcho(env, to, body, req.ctx, echoPurpose, wamid, req.rowId ?? req.queued?.rowId, templateName);
    return decided(resp, via);
  }

  // ---- Meta refused it, synchronously ----
  const code = metaError?.code ?? resp.status;
  await dispatchFailureEcho(env, to, metaError?.message ?? `Meta ${resp.status}`, req.ctx);
  const meta = sentMetaFor(req, to, body, templateName);
  const handled = await handleRejection(env, { to, code, meta, message: metaError?.message ?? `HTTP ${resp.status}` });
  await recordSendFailure(env, {
    to, what: sendWhat(body), code, message: metaError?.message ?? `HTTP ${resp.status}`,
    phase: "sync", body: sessionEchoText(body), hasRow: handled.rowHandled,
  });
  return decided(resp, { action: "rejected", code, template: templateName });
}

function sentMetaFor(req: GatewayRequest, to: string, body: Record<string, unknown>, templateName?: string): SentMeta {
  const now = Date.now();
  const policy = purposePolicy(req.purpose);
  const session = body.type !== "template";
  const content: Record<string, unknown> = { ...body };
  delete content.messaging_product;
  delete content.to;
  return {
    p: req.purpose,
    d: to,
    t: templateName,
    s: session ? content : undefined,
    c: req.queued?.createdAt ?? now,
    e: req.expiresAt ?? req.queued?.expiresAt ?? expiryFor(req.purpose, now),
    i: req.important ?? policy?.important ?? false,
    r: req.rowId ?? req.queued?.rowId,
    a: req.queued?.attempts ?? 0,
    g: req.guardPurpose,
    m: req.manual,
  };
}

/** Meta accepted the send: remember it for a later `failed` status. */
async function afterAccepted(
  env: Env,
  req: GatewayRequest,
  to: string,
  body: Record<string, unknown>,
  wamid: string | undefined,
  templateName?: string,
): Promise<void> {
  // one line per accepted send (wrangler tail), like «held» / «skipped» below
  console.log(`[gateway] sent purpose=${req.purpose} to=${maskPhone(to)} via=${templateName ? `template:${templateName}` : String(body.type)}${req.queued ? " (held → flushed)" : ""}`);
  if (!wamid || wamid.includes(".no_id.")) return;
  await kvPut(env, sentMetaKey(wamid), JSON.stringify(sentMetaFor(req, to, body, templateName)), 3 * 24 * 3600);
}

// ------------------------------------------------------------------ Meta's refusals

/**
 * One refusal, sync or async. Never sends anything. Returns whether it already
 * wrote the message's x_wa_message row (so recordSendFailure does not add one).
 */
async function handleRejection(
  env: Env,
  f: { to: string; code: number | string | null; meta: SentMeta | null; message: string },
): Promise<{ rowHandled: boolean }> {
  const now = Date.now();
  const to = waDigits(f.to);
  const code = Number(f.code);
  const m = f.meta;
  if (code === 131047) {
    await markWindowClosed(env, to, now);
    console.warn(`[gateway] 131047 to=${maskPhone(to)} — window marked closed`);
    const attempts = (m?.a ?? 0) + 1;
    if (m?.s && m.e > now && attempts < MAX_WINDOW_RETRIES) {
      const item: QueueItem = {
        id: queueItemId(m.p, m.s), purpose: m.p, guardPurpose: m.g, body: m.s,
        createdAt: m.c, expiresAt: m.e, important: m.i, rowId: m.r, attempts, manual: m.m,
      };
      item.rowId = await upsertRow(env, m.r, to, {
        x_status: "held",
        x_meta_error: `Meta 131047: ${f.message} — النافذة مقفلة، أُعيدت إلى طابور الرقم (صالحة حتى ${riyadhLabel(m.e)})`.slice(0, 2000),
      }, { body: sessionEchoText(m.s), kind: kindOf(m.s), manual: m.m, purpose: m.p });
      await putBack(env, to, [item], now);
      console.log(`[gateway] 131047 purpose=${m.p} to=${maskPhone(to)} — back in the queue (attempt ${attempts})`);
      return { rowHandled: !!item.rowId };
    }
    if (m?.s) console.warn(`[gateway] 131047 purpose=${m.p} to=${maskPhone(to)} — not re-queued (attempt ${attempts}, expired or refused before)`);
  } else if (code === 131049) {
    if (m?.t) {
      await kvPut(env, templateBlockKey(to, m.t, now), new Date(now).toISOString(), (riyadhDayEndMs(now) - now) / 1000 + 3600);
      console.warn(`[gateway] 131049 template=${m.t} to=${maskPhone(to)} — not sent to this number again today`);
    }
  } else if (m?.p && blocksOnRefusal(m.p)) {
    await kvPut(env, purposeBlockKey(to, m.p), JSON.stringify({ code: f.code, at: new Date(now).toISOString() }), 24 * 3600);
    console.warn(`[gateway] Meta ${f.code} purpose=${m.p} to=${maskPhone(to)} — no automatic send of this purpose to this number for 24h`);
  }
  // A held message that was flushed and then refused: its row says so.
  if (m?.r) {
    await upsertRow(env, m.r, to, {
      x_status: "failed",
      x_meta_error: `Meta ${f.code ?? "?"}: ${f.message}`.slice(0, 2000),
    }, { body: "", kind: "text", purpose: m.p });
    return { rowHandled: true };
  }
  return { rowHandled: false };
}

/**
 * A `failed` status from Meta's webhook. Handled once per wamid (Meta delivers
 * a status more than once when our webhook was down, § 33 analysis): the row,
 * the counter and alert, the Discuss line and the rejection policy.
 */
export async function handleStatusFailure(
  env: Env,
  s: { wamid: string; recipient: string; code: number | null; message: string; errText?: string },
): Promise<{ duplicate: boolean }> {
  const seen = rejectionSeenKey(s.wamid);
  if (await kvGet(env, seen)) {
    console.log(`[gateway] failed status wamid=${s.wamid.slice(-10)} already handled — duplicate delivery ignored`);
    return { duplicate: true };
  }
  await kvPut(env, seen, new Date().toISOString(), 7 * 24 * 3600);
  const { updateWaStatusByWamid } = await import("./wa-message-send");
  const row = await updateWaStatusByWamid(env, s.wamid, "failed", s.errText);
  let meta: SentMeta | null = null;
  try {
    const raw = await kvGet(env, sentMetaKey(s.wamid));
    meta = raw ? (JSON.parse(raw) as SentMeta) : null;
  } catch { meta = null; }
  if (meta && row?.id && !meta.r) meta.r = row.id;
  const handled = await handleRejection(env, { to: s.recipient, code: s.code, meta, message: s.message });
  try {
    const { recordSendFailure, templateFromEcho } = await import("./send-failure");
    await recordSendFailure(env, {
      to: String(s.recipient),
      what: meta?.t ?? templateFromEcho(row?.body) ?? (row?.body?.startsWith("📍") ? "location" : "text"),
      code: s.code,
      message: s.message,
      phase: "async",
      hasRow: !!row || handled.rowHandled,
      wamid: s.wamid,
    });
  } catch (e) {
    console.warn("[status-failed record]", (e as Error)?.message);
  }
  await dispatchFailureEcho(env, s.recipient, s.errText ?? "Meta failed", undefined);
  return { duplicate: false };
}

// ------------------------------------------------------------------ the queue

/**
 * The number just wrote (or tapped) and its window is open: send what was held
 * for it, oldest first. Expired items are dropped and their rows marked. If
 * Meta refuses one with 131047 the window is closed again: the rest go back to
 * the queue untouched. Never sends an item twice (per-item mark).
 */
export async function flushHeld(
  env: Env,
  to: string,
  window: WindowState,
  ctx?: ExecutionContext,
): Promise<{ sent: number; expired: number; putBack: number; dropped: number }> {
  const out = { sent: 0, expired: 0, putBack: 0, dropped: 0 };
  if (!window.open) return out;
  const items = await takeQueue(env, to);
  const now = Date.now();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.expiresAt <= now) {
      await markExpired(env, to, item);
      out.expired++;
      continue;
    }
    const mark = sentMarkKey(to, item.id);
    if (await kvGet(env, mark)) continue;
    await kvPut(env, mark, new Date(now).toISOString(), SENT_MARK_TTL);
    const resp = await sendViaGateway(env, {
      purpose: item.purpose,
      to,
      content: { kind: "session", body: item.body },
      guardPurpose: item.guardPurpose,
      manual: item.manual,
      important: item.important,
      expiresAt: item.expiresAt,
      rowId: item.rowId,
      queued: item,
      window,
      ctx,
    });
    const d = gatewayDecision(resp);
    if (d?.action === "session") { out.sent++; continue; }
    if (d?.action === "rejected" && Number(d.code) === 131047) {
      // The item itself went back via handleRejection; the rest wait too.
      const rest = items.slice(i + 1);
      await putBack(env, to, rest, now);
      out.putBack = rest.length;
      break;
    }
    if (d?.action === "refused" && item.rowId) {
      // e.g. the number left the allowlist meanwhile: not sent, and the row says why
      await upsertRow(env, item.rowId, to, { x_status: "skipped", x_meta_error: `البوابة: ${d.reason}`.slice(0, 2000) },
        { body: "", kind: "text", purpose: item.purpose });
    }
    out.dropped++;
  }
  if (items.length) console.log(`[gateway] flush to=${maskPhone(to)} ${JSON.stringify(out)}`);
  return out;
}

async function markExpired(env: Env, to: string, item: QueueItem): Promise<void> {
  console.warn(`[gateway] expired purpose=${item.purpose} to=${maskPhone(to)} created=${new Date(item.createdAt).toISOString()} — dropped, not sent`);
  await upsertRow(env, item.rowId, to, {
    x_status: "expired",
    x_meta_error: `البوابة: انتهت صلاحيتها (${riyadhLabel(item.expiresAt)}) ولم يراسل الرقم قبلها، فلم تُرسل`,
  }, { body: sessionEchoText(item.body), kind: kindOf(item.body), manual: item.manual, purpose: item.purpose });
}

/** The every-5-minutes cron: drop and log every expired held item, even for numbers that never wrote back. */
export async function sweepExpiredHeld(env: Env, now: number = Date.now()): Promise<{ numbers: number; expired: number }> {
  let expired = 0;
  const numbers = await queuedNumbers(env);
  for (const d of numbers) {
    const items = await readQueue(env, d);
    const dead = items.filter((i) => i.expiresAt <= now);
    if (dead.length === 0 && items.length > 0) continue;
    await writeQueue(env, d, items.filter((i) => i.expiresAt > now), now);
    for (const item of dead) {
      await markExpired(env, d, item);
      expired++;
    }
  }
  return { numbers: numbers.length, expired };
}

// ------------------------------------------------------------------ echo into Odoo Discuss

/** Human-readable text of a Meta body (Discuss echo, x_wa_message x_body). */
export function sessionEchoText(body: Record<string, unknown>): string {
  const b = body as {
    type?: string;
    text?: { body?: string };
    template?: { name?: string; components?: Array<{ parameters?: Array<{ text?: string }> }> };
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
    interactive?: { body?: { text?: string }; action?: { buttons?: Array<{ reply?: { title?: string } }> } };
    document?: { filename?: string };
  };
  if (b.type === "text") return String(b.text?.body ?? "");
  if (b.type === "template") {
    const name = b.template?.name ?? "?";
    const params = (b.template?.components ?? []).flatMap((c) => c?.parameters ?? []).map((p) => p?.text ?? "").filter(Boolean);
    return params.length ? `📋 قالب: ${name} (${params.join("، ")})` : `📋 قالب: ${name}`;
  }
  if (b.type === "location") {
    const label = b.location?.name ?? b.location?.address ?? "";
    return `📍 موقع${label ? " · " + label : ""} — https://maps.google.com/?q=${b.location?.latitude},${b.location?.longitude}`;
  }
  if (b.type === "interactive") {
    const text = b.interactive?.body?.text ?? "";
    const btns = (b.interactive?.action?.buttons ?? []).map((btn) => btn?.reply?.title ?? "").filter(Boolean);
    return btns.length ? `${text}\n[أزرار: ${btns.join(" | ")}]` : text;
  }
  if (b.type === "document") return `📎 ${b.document?.filename ?? "مستند"}`;
  return `[${b.type ?? "unknown"}]`;
}

// Purposes whose caller writes its own x_wa_message row and shows the message
// itself (Baraa's Discuss reply is already his own message in the channel).
const HANDLED_BY_CALLER: ReadonlySet<string> = new Set(["inbox_reply", "wa_message_manual"]);

async function dispatchEcho(
  env: Env,
  to: string,
  body: Record<string, unknown>,
  ctx: ExecutionContext | undefined,
  purpose: string,
  wamid: string | undefined,
  rowId: number | undefined,
  templateName?: string,
): Promise<void> {
  const task = echoOutboundToInbox(env, to, body, purpose, wamid, rowId, templateName).catch((e) =>
    console.warn("[gateway] echo failed:", (e as Error).message));
  if (ctx) { ctx.waitUntil(task); return; }
  await task;
}

async function echoOutboundToInbox(
  env: Env,
  to: string,
  body: Record<string, unknown>,
  purpose: string,
  wamid: string | undefined,
  rowId: number | undefined,
  templateName?: string,
): Promise<void> {
  const realWamid = wamid && !wamid.includes(".no_id.") ? wamid : undefined;
  // A held message now sent: its row becomes «sent» with the wamid.
  if (rowId) {
    try {
      const { call } = await import("./odoo");
      await call(env, "x_wa_message", "write", {
        ids: [rowId],
        vals: {
          x_status: "sent",
          x_meta_message_id: realWamid ?? false,
          x_processed_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        },
      });
    } catch (e) {
      console.warn("[gateway] held row → sent failed", (e as Error)?.message);
    }
  }
  // The owner is not a customer conversation — never echoed into Discuss.
  // § 34: his «فتح المحادثة» template is logged in x_wa_message, like every
  // other opener (the others get their row with the echo below).
  if (isOwnerRecipient(env, to)) {
    const { OPENER_TEMPLATE_NAMES } = await import("./wa-opener");
    if (templateName && OPENER_TEMPLATE_NAMES.has(templateName) && !rowId) {
      try {
        const { logWaMessage } = await import("./wa-message-send");
        await logWaMessage(env, {
          partnerId: null,
          direction: "out",
          kind: "template",
          body: sessionEchoText(body),
          source: "auto",
          status: "sent",
          metaMessageId: realWamid,
        });
      } catch (e) {
        console.warn("[gateway] owner opener row failed:", (e as Error).message);
      }
    }
    return;
  }
  const echoText = sessionEchoText(body);
  if (!echoText || HANDLED_BY_CALLER.has(purpose)) return;
  const partner = await partnerForNumber(env, to);
  if (!partner) return;
  const { echoOutbound } = await import("./wa-inbox");
  try {
    await echoOutbound(env, partner.id, partner.name, echoText, body.type === "template" ? purpose : undefined, to);
  } catch (e) {
    // STATUS § 34 — the Discuss mirror failing does not cost the send its
    // x_wa_message row (the record of every send, openers included).
    console.warn("[gateway] echo failed:", (e as Error).message);
  }
  if (rowId) return;
  // An x_wa_message row for the auto send, with the wamid (one row per send).
  try {
    const { logWaMessage } = await import("./wa-message-send");
    await logWaMessage(env, {
      partnerId: partner.id,
      direction: "out",
      kind: body.type === "template" ? "template" : "text",
      body: echoText,
      source: "auto",
      status: "sent",
      metaMessageId: realWamid,
    });
  } catch (e) {
    console.warn("[gateway] echo logWaMessage failed:", (e as Error).message);
  }
}

/** «⚠️ ما انرسلت: <reason>» in the recipient's Discuss channel. Owner: silent. */
async function dispatchFailureEcho(env: Env, to: string, reason: string, ctx: ExecutionContext | undefined): Promise<void> {
  const task = (async () => {
    const partner = await partnerForNumber(env, to);
    if (!partner) return;
    try {
      const { echoFailure } = await import("./wa-inbox");
      await echoFailure(env, partner.id, partner.name, reason);
    } catch (e) {
      console.warn("[gateway] failure echo:", (e as Error).message);
    }
  })();
  if (ctx) ctx.waitUntil(task);
  else await task;
}

/** «⏳ محفوظة…» in the recipient's Discuss channel: what waits, and until when. */
async function echoHeldToInbox(env: Env, to: string, text: string, until: string, ctx: ExecutionContext | undefined): Promise<void> {
  const task = (async () => {
    const partner = await partnerForNumber(env, to);
    if (!partner) return;
    try {
      const { echoHeld } = await import("./wa-inbox");
      await echoHeld(env, partner.id, partner.name, text, until);
    } catch (e) {
      console.warn("[gateway] held echo:", (e as Error).message);
    }
  })();
  if (ctx) ctx.waitUntil(task);
  else await task;
}
