// New-number screening and «مراجعة الأرقام» (2026-09-25, STATUS § 30).
//
// Locked decisions (Baraa, 2026-09-25):
//   • Every number that writes starts as a customer (welcome, template,
//     catalog as before). A partner created from WhatsApp is «غير مراجَع»
//     (x_contact_class = unreviewed); the conversation shows its intent.
//   • Screening runs only on an «غير مراجَع» partner, once per inbound text,
//     and stops as soon as the class is fixed (by Baraa, or by a real order).
//   • A real order (a non-cancelled x_daily_order with lines) → «عميل», no review.
//   • purchase (طلب أو استفسار شراء) → still a customer, no review.
//   • unclear (غير واضح) → still a customer, flagged «ينتظر المراجعة».
//   • wrong_number / vendor_pitch / personal / spam → «ينتظر المراجعة», and
//     every automated customer message stops (bot replies, follow-ups,
//     reactivation, rating, reminders) until Baraa decides. The first welcome
//     reply is never withdrawn.
//   • Known partners are never screened: team (role), suppliers, anyone with
//     an order, Baraa — they never reach screening (earlier routes), or their
//     class is empty (only WhatsApp-created partners are «غير مراجَع»).
//   • Entering review: ONE message in the Discuss channel «📋 مراجعة الأرقام»
//     (name, number, intent, reason, first message, a link to the record), and
//     one owner alert «رقم جديد ينتظر المراجعة: {الاسم}». Baraa decides in Odoo
//     (UTAK ← 📋 مراجعة الأرقام; scripts/rev-20260925-odoo-setup.mjs).
//   • Once flagged, the flag stays until Baraa's decision or a real order; the
//     hold follows the latest intent (a later purchase message lifts it).
//   • Class personal / team / supplier (Baraa's decision): no automated
//     customer message at all.

import type { Env } from "./config";
import type { Intent } from "./types";
import { call } from "./odoo";
import { screenContact, type ScreenIntent } from "./claude";
import { claimButton } from "./button-lock";
import { toOdooUtc } from "./hours";

export type ContactClass = "unreviewed" | "customer" | "supplier" | "team" | "personal";
export type AiIntent = ScreenIntent;

export const INTENT_LABEL: Readonly<Record<AiIntent, string>> = {
  purchase: "طلب أو استفسار شراء",
  wrong_number: "رقم غلط",
  vendor_pitch: "عرض بيع لنا",
  personal: "شخصي",
  spam: "إزعاج",
  unclear: "غير واضح",
};
/** Intents that stop every automated customer message while the review waits. */
export const NON_CUSTOMER_INTENTS: ReadonlySet<string> = new Set(["wrong_number", "vendor_pitch", "personal", "spam"]);
/** Baraa's decisions that are not «customer»: nothing automated for customers reaches them. */
export const NOT_CUSTOMER_CLASSES: ReadonlySet<string> = new Set(["supplier", "team", "personal"]);
/** The existing classifier already says «purchase» for these: no second Claude call. */
export const PURCHASE_CLASSIFY_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  "product_inquiry", "place_order", "add_to_order", "request_quotation", "confirm_order", "edit_order", "cancel_order",
]);
const CLASSIFY_REASON: Partial<Record<Intent, string>> = {
  product_inquiry: "يسأل عن أصنافنا أو أسعارها",
  place_order: "أرسل أصنافاً وكميات",
  add_to_order: "يضيف على طلبه",
  request_quotation: "يطلب عرض السعر",
  confirm_order: "يؤكد طلبه",
  edit_order: "يعدّل طلبه",
  cancel_order: "يلغي طلبه",
};

export const REVIEW_CHANNEL_NAME = "📋 مراجعة الأرقام";
export const REVIEW_ACTION_NAME = "UTAK — مراجعة الأرقام";
export const REVIEW_ALERT_PREFIX = "رقم جديد ينتظر المراجعة: ";
/** Fields read to decide screening and the hold. */
export const SCREEN_FIELDS = ["x_contact_class", "x_ai_intent", "x_review_pending"] as const;
const RECENT_TEXTS = 5;
const MEDIA_MARK = /^\[(audio|image|video|document|sticker|location|voice|نوع)[:\]\s]/i;
const KV_TARGETS = "review:targets:v1";

export interface ScreenState {
  id: number;
  name?: string;
  x_contact_class?: string | false;
  x_ai_intent?: string | false;
  x_review_pending?: boolean;
}

// ---------------------------------------------------------------- the hold

/**
 * Must every automated customer message (bot reply, follow-up, reactivation,
 * rating, reminder) skip this partner? A decided «customer» never; Baraa's
 * other decisions always; otherwise while the review waits on a non-customer
 * intent. «غير واضح» stays a customer.
 */
export function isCustomerAutomationHeld(p: Partial<ScreenState> | null | undefined): boolean {
  if (!p) return false;
  const cls = String(p.x_contact_class || "");
  if (cls === "customer") return false;
  if (NOT_CUSTOMER_CLASSES.has(cls)) return true;
  return !!p.x_review_pending && NON_CUSTOMER_INTENTS.has(String(p.x_ai_intent || ""));
}

/** Of these partners, the ones no automated customer message may reach. Throws on Odoo trouble. */
export async function heldPartnerIds(env: Env, ids: number[]): Promise<Set<number>> {
  const uniq = [...new Set(ids.filter((id) => id > 0))];
  if (!uniq.length) return new Set();
  const rows = await call<ScreenState[]>(env, "res.partner", "search_read", {
    domain: [["id", "in", uniq]],
    fields: ["id", ...SCREEN_FIELDS],
    limit: uniq.length,
  });
  return new Set(rows.filter(isCustomerAutomationHeld).map((r) => r.id));
}

/** One partner's screening state; null on Odoo trouble (the caller fails open). */
export async function readScreenState(env: Env, partnerId: number): Promise<ScreenState | null> {
  if (!partnerId) return null;
  try {
    const [p] = await call<ScreenState[]>(env, "res.partner", "read", {
      ids: [partnerId], fields: ["id", "name", ...SCREEN_FIELDS],
    });
    return p ?? null;
  } catch (e) {
    console.warn(`[screen] state read failed for ${partnerId}`, (e as Error)?.message);
    return null;
  }
}

// ---------------------------------------------------------------- screening

export interface ScreenInput {
  partnerId: number;
  partnerName: string;
  number: string;
  profileName?: string;
  /** This inbound text (already in x_wa_message by ingestInbound). */
  text: string;
  /** The existing classifier's answer for this text, when the bot ran it. */
  classifyIntent?: Intent | null;
  /** Already read by the caller (skips a read). */
  state?: ScreenState | null;
  nowMs?: number;
}

export type ScreenAction = "not_unreviewed" | "customer_by_order" | "screened" | "claude_failed" | "no_state";
export interface ScreenOutcome {
  action: ScreenAction;
  intent?: AiIntent;
  reason?: string;
  /** The review flag after this text. */
  pending?: boolean;
  /** This text put the partner into review (channel message + owner alert). */
  entered?: boolean;
  /** Automated customer messages must skip the partner after this text. */
  held: boolean;
}

/** A non-cancelled order with at least one line. */
export async function hasRealOrder(env: Env, partnerId: number): Promise<boolean> {
  const n = await call<number>(env, "x_daily_order", "search_count", {
    domain: [["x_customer_id", "=", partnerId], ["x_state", "!=", "cancelled"], ["x_line_ids", "!=", false]],
  });
  return n > 0;
}

/** The partner's recent inbound texts, oldest first, this one last. */
async function recentInboundTexts(env: Env, partnerId: number, current: string): Promise<string[]> {
  let texts: string[] = [];
  try {
    const rows = await call<Array<{ x_body: string | false }>>(env, "x_wa_message", "search_read", {
      domain: [["x_partner_id", "=", partnerId], ["x_direction", "=", "in"], ["x_kind", "=", "text"]],
      fields: ["x_body"],
      order: "id desc",
      limit: RECENT_TEXTS + 3,
    });
    texts = rows.map((r) => String(r.x_body || "").trim()).filter((t) => t && !MEDIA_MARK.test(t)).slice(0, RECENT_TEXTS).reverse();
  } catch (e) {
    console.warn(`[screen] history read failed for ${partnerId}`, (e as Error)?.message);
  }
  const cur = String(current ?? "").trim();
  if (cur && texts[texts.length - 1] !== cur) texts = [...texts.slice(-(RECENT_TEXTS - 1)), cur];
  return texts;
}

/**
 * Screen one inbound text of a partner. Only an «غير مراجَع» partner is
 * touched; anything else returns at once with its hold.
 */
export async function screenInbound(env: Env, input: ScreenInput): Promise<ScreenOutcome> {
  const st = input.state !== undefined ? input.state : await readScreenState(env, input.partnerId);
  if (!st) return { action: "no_state", held: false };
  if (st.x_contact_class !== "unreviewed") return { action: "not_unreviewed", held: isCustomerAutomationHeld(st) };
  const nowMs = input.nowMs ?? Date.now();
  const last = { x_review_last_msg: String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200), x_review_last_at: toOdooUtc(nowMs) };

  if (await hasRealOrder(env, input.partnerId)) {
    await call(env, "res.partner", "write", { ids: [input.partnerId], vals: { x_contact_class: "customer", x_review_pending: false, ...last } });
    console.log(`[screen] partner=${input.partnerId} → customer (real order)`);
    return { action: "customer_by_order", pending: false, held: false };
  }

  let intent: AiIntent;
  let reason: string;
  const ci = input.classifyIntent ?? null;
  if (ci && PURCHASE_CLASSIFY_INTENTS.has(ci)) {
    intent = "purchase";
    reason = CLASSIFY_REASON[ci] ?? "يسأل عن الشراء";
  } else {
    const texts = await recentInboundTexts(env, input.partnerId, input.text);
    const r = await screenContact(env, texts, input.profileName || input.partnerName);
    if (!r) return { action: "claude_failed", held: isCustomerAutomationHeld(st) };
    intent = r.intent;
    reason = r.reason;
  }

  const wasPending = !!st.x_review_pending;
  const pending = wasPending || intent !== "purchase";
  const vals: Record<string, unknown> = { x_ai_intent: intent, x_ai_reason: reason, ...last };
  if (pending && !wasPending) vals.x_review_pending = true;
  await call(env, "res.partner", "write", { ids: [input.partnerId], vals });
  const entered = pending && !wasPending;
  console.log(`[screen] partner=${input.partnerId} intent=${intent} pending=${pending}${entered ? " entered" : ""}`);
  if (entered) {
    try {
      await announceReview(env, { partnerId: input.partnerId, name: st.name || input.partnerName, number: input.number, intent, reason, current: input.text });
    } catch (e) {
      console.warn(`[screen] announce failed for ${input.partnerId}`, (e as Error)?.message);
    }
  }
  const after = { ...st, x_ai_intent: intent, x_review_pending: pending };
  return { action: "screened", intent, reason, pending, entered, held: isCustomerAutomationHeld(after) };
}

// ---------------------------------------------------------------- entering review

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The review channel and action ids (KV, one day). */
async function reviewTargets(env: Env): Promise<{ channelId: number; actionId: number }> {
  try {
    const hit = await env.MSG_DEDUP.get(KV_TARGETS);
    if (hit) {
      const t = JSON.parse(hit) as { channelId: number; actionId: number };
      if (t.channelId) return t;
    }
  } catch { /* read again */ }
  const [ch] = await call<Array<{ id: number }>>(env, "discuss.channel", "search_read", {
    domain: [["name", "=", REVIEW_CHANNEL_NAME], ["channel_type", "=", "channel"]], fields: ["id"], limit: 1,
  });
  const [act] = await call<Array<{ id: number }>>(env, "ir.actions.act_window", "search_read", {
    domain: [["name", "=", REVIEW_ACTION_NAME]], fields: ["id"], limit: 1,
  }).catch(() => []);
  const t = { channelId: ch?.id ?? 0, actionId: act?.id ?? 0 };
  if (t.channelId) {
    try { await env.MSG_DEDUP.put(KV_TARGETS, JSON.stringify(t), { expirationTtl: 24 * 60 * 60 }); } catch { /* next time */ }
  }
  return t;
}

/** A link that opens the partner's record (inside the review action when it exists). */
export function reviewRecordUrl(env: Env, partnerId: number, actionId: number): string {
  const base = String(env.ODOO_URL || "").replace(/\/+$/, "");
  return actionId ? `${base}/odoo/action-${actionId}/${partnerId}` : `${base}/odoo/res.partner/${partnerId}`;
}

/** The body of the one channel message about a partner entering review. */
export function reviewMessageHtml(a: {
  name: string; number: string; intent: AiIntent; reason: string; first: string; url: string;
}): string {
  return [
    `<p><b>رقم جديد ينتظر المراجعة</b></p>`,
    `<p>الاسم: ${esc(a.name)}<br/>`,
    `الرقم: ${esc(a.number)}<br/>`,
    `النية: ${esc(INTENT_LABEL[a.intent] ?? a.intent)}<br/>`,
    `السبب: ${esc(a.reason)}<br/>`,
    `أول رسالة: «${esc(a.first.slice(0, 300))}»</p>`,
    `<p><a href="${esc(a.url)}">افتح سجله</a> · القرار من UTAK ← 📋 مراجعة الأرقام</p>`,
  ].join("");
}

/**
 * ONE channel message and ONE owner alert per partner entering review, even
 * if two texts race (KV claim + read-back).
 */
async function announceReview(env: Env, a: {
  partnerId: number; name: string; number: string; intent: AiIntent; reason: string; current: string;
}): Promise<void> {
  const claim = await claimButton(env, `review:announce:${a.partnerId}`, 365 * 24 * 60 * 60);
  if (!claim.claimed) return;
  let first = String(a.current ?? "");
  try {
    const rows = await call<Array<{ x_body: string | false }>>(env, "x_wa_message", "search_read", {
      domain: [["x_partner_id", "=", a.partnerId], ["x_direction", "=", "in"], ["x_kind", "=", "text"]],
      fields: ["x_body"], order: "id asc", limit: 10,
    });
    first = rows.map((r) => String(r.x_body || "").trim()).find((t) => t && !MEDIA_MARK.test(t)) ?? first;
  } catch { /* the current text stands in */ }
  const { channelId, actionId } = await reviewTargets(env);
  if (channelId) {
    const { getBotPartnerId, postToChannel } = await import("./wa-inbox");
    const author = (await getBotPartnerId(env).catch(() => null)) ?? 0;
    const body = reviewMessageHtml({ ...a, first, url: reviewRecordUrl(env, a.partnerId, actionId) });
    const ok = author ? await postToChannel(env, channelId, author, body) : false;
    if (!ok) console.warn(`[screen] review channel post failed for ${a.partnerId}`);
  } else {
    console.warn("[screen] review channel not found");
  }
  const { sendOwnerAlert } = await import("./templates");
  await sendOwnerAlert(env, `${REVIEW_ALERT_PREFIX}${a.name}`);
}

// ---------------------------------------------------------------- archived numbers (STATUS § 31)

export const ARCHIVED_ASK_PREFIX = "رقم مؤرشف يطلب: ";

/**
 * 2026-09-25 (STATUS § 31) — an archived partner wrote: the message is in its
 * inbox and the bot sends nothing. Its recent texts go to the same screening
 * classifier (screenContact, one Haiku call); when it reads «طلب أو استفسار
 * شراء», Baraa gets ONE alert «رقم مؤرشف يطلب: {الاسم}» per partner and
 * Riyadh day. Nothing is written on the archived partner.
 */
export async function alertArchivedPurchase(env: Env, a: {
  partnerId: number; name: string; profileName?: string; text: string; nowMs?: number;
}): Promise<{ intent: AiIntent | null; alerted: boolean }> {
  const texts = await recentInboundTexts(env, a.partnerId, a.text);
  const r = await screenContact(env, texts, a.profileName || a.name);
  if (!r) return { intent: null, alerted: false };
  if (r.intent !== "purchase") {
    console.log(`[screen] archived partner=${a.partnerId} intent=${r.intent} — no alert`);
    return { intent: r.intent, alerted: false };
  }
  const { riyadhDateKey } = await import("./hours");
  const day = riyadhDateKey(new Date(a.nowMs ?? Date.now()));
  const claim = await claimButton(env, `archived:ask:${day}:${a.partnerId}`, 26 * 60 * 60);
  if (!claim.claimed) return { intent: r.intent, alerted: false };
  const { sendOwnerAlert } = await import("./templates");
  await sendOwnerAlert(env, `${ARCHIVED_ASK_PREFIX}${a.name}`);
  console.log(`[screen] archived partner=${a.partnerId} intent=purchase — owner alerted`);
  return { intent: r.intent, alerted: true };
}
