// Partial collection from WhatsApp — 2026-09-27 (STATUS § 42 ب).
//
// «نقد 💵» / «تحويل 🏦» (the collection request's template buttons, or its
// session buttons) no longer records the payment at once. It answers the
// collector, in his conversation, with the open balance and two buttons:
//
//   «المبلغ كامل (X ر.س)» → the open balance, recorded as before;
//   «مبلغ آخر»            → «اكتب المبلغ المستلم»: his first text within 30
//                           minutes holding one positive number (Western or
//                           Arabic-Indic digits) is recorded; more than the
//                           open balance is refused («المتبقي X ر.س فقط») and
//                           asked again; a text without a number is asked again.
//
// After a recording: the receipt of m10 per payment as before (the x_payment
// fires it), and what is left stays due (m2 reminds it). With ACCOUNTING_SYNC
// the payment gets its account.payment at its own amount (recordCollection).
//
// No choice within 30 minutes → nothing recorded and ONE reminder to the
// collector (the same two buttons); nothing 30 minutes after the reminder (or
// after his last step since it) → ONE alert to Baraa with the invoice number
// and the customer's name. The */5 tick (runCollectPayTick) keeps the time.
//
// Every step holds a KV lock: the prompt (60 s), «مبلغ آخر» (60 s), and the
// recording itself per prompt (collect_rec:<invoice>:<nonce>, 7 days) — a
// second tap of «المبلغ كامل», or a second amount for the same prompt, never
// records twice; recordCollection's re-count after the create stays the
// second net. A later «نقد» on the same invoice is a new prompt (the rest of
// a partial collection).
//
// Button ids: collect_full_<cash|transfer>_<invoice>_<nonce>,
//             collect_other_<cash|transfer>_<invoice>_<nonce>.

import type { Env } from "./config";
import type { RouterReply } from "./router";
import { ALREADY_DONE_TEXT, BUTTON_LOCK_TTL, claimButton, finishButton, releaseButton, withButtonLock } from "./button-lock";
import { call, getInvoiceById, getOrderCustomer } from "./odoo";
import { buttonsContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { sendOwnerAlert } from "./templates";
import { riyadhHHMM } from "./hours";
import { waDigits } from "./wa-window";

export type CollectMethod = "cash" | "transfer";
/** The choice, the amount, the reminder and the alert all wait this long. */
export const CP_WAIT_MIN = 30;
const MIN = 60_000;
const STATE_TTL = 26 * 60 * 60;
const INDEX_TTL = 7 * 24 * 60 * 60;
/** A double tap of «نقد» / «تحويل» or «مبلغ آخر» within this is answered, not re-run. */
export const CP_TAP_LOCK_TTL = 60;
export const CP_REMIND_PURPOSE = "collection_amount_remind";
export const CP_MAX_AMOUNT = 1_000_000;

export const cpStateKey = (invoiceId: number): string => `cpay:v1:${invoiceId}`;
export const cpAmountKey = (partnerId: number): string => `cpay_amount:v1:${partnerId}`;
export const CP_INDEX_KEY = "cpay_open:v1";
/** The recording lock of one prompt. */
export const cpRecLock = (invoiceId: number, nonce: string): string => `collect_rec:${invoiceId}:${nonce}`;

export const COLLECT_CHOICE_RE = /^collect_(full|other)_(cash|transfer)_(\d+)_([a-z0-9]{4,16})$/;
export const OTHER_TITLE = "مبلغ آخر";

export interface CollectPending {
  invoiceId: number;
  method: CollectMethod;
  /** The collector (his Work Contact) and his number. */
  partnerId: number;
  to: string;
  collector: string;
  nonce: string;
  step: "choose" | "amount";
  /** His last step (the prompt, «مبلغ آخر», an amount asked again). */
  at: number;
  remindedAt?: number;
  alertedAt?: number;
  number: string;
  customer: string;
}
interface AmountPointer { invoiceId: number; method: CollectMethod; nonce: string; at: number }

// ---------------------------------------------------------------- text

export function fmtSar(n: number): string {
  const r = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
const how = (m: CollectMethod) => (m === "cash" ? "نقد 💵" : "تحويل 🏦");

/**
 * «المبلغ كامل (X ر.س)» when it fits Meta's 20 characters of a reply button,
 * else «كامل (X ر.س)», else «المبلغ كامل» (the amount stays in the body).
 */
export function fullTitle(remaining: number): string {
  const x = fmtSar(remaining);
  return [`المبلغ كامل (${x} ر.س)`, `كامل (${x} ر.س)`, "المبلغ كامل"].find((t) => t.length <= 20)!;
}
export function choiceButtons(p: Pick<CollectPending, "invoiceId" | "method" | "nonce">, remaining: number): Array<{ id: string; title: string }> {
  return [
    { id: `collect_full_${p.method}_${p.invoiceId}_${p.nonce}`, title: fullTitle(remaining) },
    { id: `collect_other_${p.method}_${p.invoiceId}_${p.nonce}`, title: OTHER_TITLE },
  ];
}
export function choiceText(p: Pick<CollectPending, "number" | "customer" | "method">, remaining: number): string {
  return [
    `💰 تحصيل الفاتورة ${p.number}`,
    p.customer ? `العميل: ${p.customer}` : "",
    `المتبقي: ${fmtSar(remaining)} ر.س (${how(p.method)})`,
    `كم استلمت؟ «المبلغ كامل» يسجّل ${fmtSar(remaining)} ر.س، و«${OTHER_TITLE}» تكتب المبلغ.`,
  ].filter(Boolean).join("\n");
}
export const askAmountText = (remaining: number): string => `اكتب المبلغ المستلم رقماً فقط (المتبقي ${fmtSar(remaining)} ر.س).`;
export const badAmountText = (remaining: number): string => `⚠️ اكتب المبلغ المستلم رقماً واحداً أكبر من صفر، مثل 100 أو 100.50 (المتبقي ${fmtSar(remaining)} ر.س).`;
export const overAmountText = (remaining: number): string => `المتبقي ${fmtSar(remaining)} ر.س فقط. اكتب المبلغ المستلم مرة ثانية.`;
export function remindText(p: CollectPending, remaining: number): string {
  return [
    `⏰ تذكير: تحصيل الفاتورة ${p.number}${p.customer ? ` (${p.customer})` : ""} ما اكتمل، وما سُجّل شيء.`,
    `المتبقي: ${fmtSar(remaining)} ر.س (${how(p.method)}). كم استلمت؟`,
  ].join("\n");
}
export function ownerAlertText(p: CollectPending, remaining: number): string {
  return [
    `⚠️ تحصيل لم يكتمل: الفاتورة ${p.number} — العميل ${p.customer || "?"}`,
    `ضغط ${p.collector || "المحصّل"} «${how(p.method)}» الساعة ${riyadhHHMM(new Date(p.at))}، ولم يحدد المبلغ بعد التذكير، فلم يُسجَّل شيء.`,
    `المتبقي: ${fmtSar(remaining)} ر.س.`,
  ].join("\n");
}

// ---------------------------------------------------------------- the amount he writes

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
/**
 * The amount in a text: exactly one positive number (Western or Arabic-Indic
 * digits, «٫» or «.» with at most two decimals, a thousands comma allowed).
 * «none» = no usable number (zero, a sign, three decimals, too large), «many» =
 * two different numbers.
 */
export function parseCollectedAmount(text: string): { kind: "ok"; value: number } | { kind: "none" } | { kind: "many" } {
  const s = String(text ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .replace(/٫/g, ".")
    .replace(/(\d)[,٬](?=\d{3}(?!\d))/g, "$1");
  const found = [...s.matchAll(/(-?)(\d+(?:\.\d+)?)/g)];
  const values = [...new Set(found.map((m) => (m[1] ? -1 : Number(m[2]))))];
  if (!values.length) return { kind: "none" };
  if (values.length > 1) return { kind: "many" };
  const [v] = values;
  const dec = (found[0][2].split(".")[1] ?? "").length;
  if (!(v > 0) || dec > 2 || v > CP_MAX_AMOUNT) return { kind: "none" };
  return { kind: "ok", value: Math.round(v * 100) / 100 };
}

// ---------------------------------------------------------------- KV state

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.MSG_DEDUP.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export const readPending = (env: Env, invoiceId: number) => readJson<CollectPending>(env, cpStateKey(invoiceId));
async function writePending(env: Env, p: CollectPending): Promise<void> {
  await env.MSG_DEDUP.put(cpStateKey(p.invoiceId), JSON.stringify(p), { expirationTtl: STATE_TTL });
}
export async function readIndex(env: Env): Promise<number[]> {
  const v = await readJson<unknown>(env, CP_INDEX_KEY);
  return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
}
async function setIndex(env: Env, ids: number[]): Promise<void> {
  try { await env.MSG_DEDUP.put(CP_INDEX_KEY, JSON.stringify(ids.slice(-200)), { expirationTtl: INDEX_TTL }); } catch { /* the next step writes it again */ }
}
async function addIndex(env: Env, id: number): Promise<void> {
  const ids = await readIndex(env);
  if (!ids.includes(id)) await setIndex(env, [...ids, id]);
}
async function dropIndex(env: Env, id: number): Promise<void> {
  const ids = await readIndex(env);
  if (ids.includes(id)) await setIndex(env, ids.filter((x) => x !== id));
}
/** The collector's next text is not an amount any more (a newer tap of any flow wins). */
export async function clearAmountPointer(env: Env, partnerId: number): Promise<void> {
  if (!partnerId) return;
  try { await env.MSG_DEDUP.delete(cpAmountKey(partnerId)); } catch { /* expires in 30 minutes */ }
}
async function lockTaken(env: Env, lockId: string): Promise<boolean> {
  try { return (await env.MSG_DEDUP.get(`btnlock:v1:${lockId}`)) !== null; } catch { return false; }
}

/** The open balance of an x_invoice (total − its x_payment rows). */
async function openBalance(env: Env, invoiceId: number, total: number): Promise<number> {
  const prior = await call<Array<{ x_amount: number }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "=", invoiceId]], fields: ["x_amount"], limit: 200,
  });
  return Math.round((total - prior.reduce((s, p) => s + (p.x_amount ?? 0), 0)) * 100) / 100;
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(6, "0");
}

/** A recording is done: the prompt's state (same nonce, or the invoice fully paid), the index, his pointer. */
async function afterRecorded(env: Env, invoiceId: number, promptNonce: string, partnerId: number, fullyPaid: boolean): Promise<void> {
  const st = await readPending(env, invoiceId);
  if (st && (st.nonce === promptNonce || fullyPaid)) {
    try { await env.MSG_DEDUP.delete(cpStateKey(invoiceId)); } catch { /* expires */ }
    await dropIndex(env, invoiceId);
  }
  const ptr = await readJson<AmountPointer>(env, cpAmountKey(partnerId));
  if (ptr && ptr.invoiceId === invoiceId) await clearAmountPointer(env, partnerId);
}

async function recordedReply(text: string, invoiceId: number, paymentId: number | null): Promise<RouterReply> {
  if (!paymentId) return { text };
  // STATUS § 34 — a note on this collection reaches Baraa with the customer and the order.
  const { collectNoteButton } = await import("./team-note");
  return { bodyBeforeButtons: text, buttons: [collectNoteButton(invoiceId)] };
}

// ---------------------------------------------------------------- the steps

export interface Collector { id: number; name: string; whatsapp: string }

/** «نقد» / «تحويل»: the open balance and the two buttons. Nothing is recorded. */
export async function askCollection(env: Env, invoiceId: number, method: CollectMethod, who: Collector, now: number = Date.now()): Promise<RouterReply> {
  const inv = await getInvoiceById(env, invoiceId);
  if (!inv) return { text: `الفاتورة رقم ${invoiceId} غير موجودة.` };
  if (inv.status === "paid") return { text: `الفاتورة ${inv.number} تم تحصيلها مسبقاً ✅` };
  const remaining = await openBalance(env, invoiceId, inv.total);
  if (!(remaining > 0.005)) return { text: `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${inv.number}.` };
  const customer = inv.orderId ? ((await getOrderCustomer(env, inv.orderId).catch(() => null))?.name ?? "") : "";
  const p: CollectPending = {
    invoiceId, method, partnerId: who.id, to: waDigits(who.whatsapp), collector: who.name,
    nonce: nonce(), step: "choose", at: now, number: inv.number, customer,
  };
  await writePending(env, p);
  await addIndex(env, invoiceId);
  // a newer prompt: his next text is not an amount for an older one
  await clearAmountPointer(env, who.id);
  console.log(`[collect-pay] ask inv=${invoiceId} ${method} remaining=${remaining} nonce=${p.nonce} by=${who.id}`);
  return { bodyBeforeButtons: choiceText(p, remaining), buttons: choiceButtons(p, remaining) };
}

/** «المبلغ كامل»: the open balance, once per prompt. */
export async function collectFull(env: Env, invoiceId: number, method: CollectMethod, promptNonce: string, who: Collector): Promise<RouterReply> {
  const { recordCollection } = await import("./invoice");
  let paymentId: number | null = null, fullyPaid = false;
  const text = await withButtonLock(env, cpRecLock(invoiceId, promptNonce), async () => {
    const r = await recordCollection(env, { invoiceId, method, collectedBy: who.id || null });
    paymentId = r.paymentId; fullyPaid = r.fullyPaid;
    return r.text;
  });
  if (text === ALREADY_DONE_TEXT) return { text };
  await afterRecorded(env, invoiceId, promptNonce, who.id, fullyPaid);
  console.log(`[collect-pay] full inv=${invoiceId} ${method} payment=${paymentId ?? "-"} nonce=${promptNonce}`);
  return recordedReply(text, invoiceId, paymentId);
}

/** «مبلغ آخر»: his next text within 30 minutes is the amount. */
export async function collectOther(env: Env, invoiceId: number, method: CollectMethod, promptNonce: string, who: Collector, now: number = Date.now()): Promise<RouterReply> {
  if (await lockTaken(env, cpRecLock(invoiceId, promptNonce))) return { text: ALREADY_DONE_TEXT };
  let reply: RouterReply = {};
  const text = await withButtonLock(env, `collect_other:${invoiceId}:${promptNonce}`, async () => {
    const inv = await getInvoiceById(env, invoiceId);
    if (!inv) { reply = { text: `الفاتورة رقم ${invoiceId} غير موجودة.` }; return reply.text!; }
    if (inv.status === "paid") { reply = { text: `الفاتورة ${inv.number} تم تحصيلها مسبقاً ✅` }; return reply.text!; }
    const remaining = await openBalance(env, invoiceId, inv.total);
    if (!(remaining > 0.005)) { reply = { text: `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${inv.number}.` }; return reply.text!; }
    const st = (await readPending(env, invoiceId)) ?? {
      invoiceId, method, partnerId: who.id, to: waDigits(who.whatsapp), collector: who.name, nonce: promptNonce,
      step: "choose" as const, at: now, number: inv.number,
      customer: inv.orderId ? ((await getOrderCustomer(env, inv.orderId).catch(() => null))?.name ?? "") : "",
    };
    await writePending(env, { ...st, method, nonce: promptNonce, step: "amount", at: now });
    await addIndex(env, invoiceId);
    const ptr: AmountPointer = { invoiceId, method, nonce: promptNonce, at: now };
    await env.MSG_DEDUP.put(cpAmountKey(who.id), JSON.stringify(ptr), { expirationTtl: CP_WAIT_MIN * 60 });
    // a text now is the amount, not an earlier «مشكلة» / «ملاحظة» / supplier payment
    const { flowKey } = await import("./supplier-pay");
    for (const k of [`pending_issue:${who.id}`, `pending_purchase_issue:${who.id}`, `pending_collect_note:${who.id}`, flowKey(who.id)]) {
      await env.MSG_DEDUP.delete(k).catch(() => {});
    }
    reply = { text: askAmountText(remaining) };
    return reply.text!;
  }, CP_TAP_LOCK_TTL);
  return text === ALREADY_DONE_TEXT ? { text } : reply;
}

/**
 * A collector's text while «مبلغ آخر» waits (30 minutes). Null = not waiting
 * (the text is an ordinary one).
 */
export async function collectAmountReply(env: Env, who: Collector, text: string, now: number = Date.now()): Promise<RouterReply | null> {
  const ptr = await readJson<AmountPointer>(env, cpAmountKey(who.id));
  if (!ptr) return null;
  if (now - ptr.at > CP_WAIT_MIN * MIN) { await clearAmountPointer(env, who.id); return null; }
  const inv = await getInvoiceById(env, ptr.invoiceId);
  if (!inv) { await clearAmountPointer(env, who.id); return { text: `الفاتورة رقم ${ptr.invoiceId} غير موجودة.` }; }
  if (inv.status === "paid") { await afterRecorded(env, ptr.invoiceId, ptr.nonce, who.id, true); return { text: `الفاتورة ${inv.number} تم تحصيلها مسبقاً ✅` }; }
  const remaining = await openBalance(env, ptr.invoiceId, inv.total);
  const parsed = parseCollectedAmount(text);
  if (parsed.kind !== "ok") return { text: badAmountText(remaining) };
  const again = async (rem: number): Promise<RouterReply> => {
    await env.MSG_DEDUP.put(cpAmountKey(who.id), JSON.stringify({ ...ptr, at: now }), { expirationTtl: CP_WAIT_MIN * 60 });
    const st = await readPending(env, ptr.invoiceId);
    if (st) await writePending(env, { ...st, step: "amount", at: now });
    return { text: overAmountText(rem) };
  };
  // more than the open balance: refused inside recordCollection (exact), read at the moment of the write
  const claim = await claimButton(env, cpRecLock(ptr.invoiceId, ptr.nonce));
  if (!claim.claimed) { await clearAmountPointer(env, who.id); return { text: ALREADY_DONE_TEXT }; }
  const { recordCollection } = await import("./invoice");
  let r;
  try {
    r = await recordCollection(env, { invoiceId: ptr.invoiceId, method: ptr.method, amount: parsed.value, collectedBy: who.id || null, exact: true });
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
  if (r.overLimit) { await releaseButton(env, claim); return again(r.overLimit.remaining); }
  if (!r.paymentId) { await releaseButton(env, claim); await clearAmountPointer(env, who.id); return { text: r.text }; }
  await finishButton(env, claim, BUTTON_LOCK_TTL);
  await afterRecorded(env, ptr.invoiceId, ptr.nonce, who.id, r.fullyPaid);
  console.log(`[collect-pay] amount inv=${ptr.invoiceId} ${ptr.method} ${parsed.value} payment=${r.paymentId} nonce=${ptr.nonce}`);
  return recordedReply(r.text, ptr.invoiceId, r.paymentId);
}

// ---------------------------------------------------------------- the */5 tick

export interface CollectTickRow { invoiceId: number; action: "gone" | "settled" | "waiting" | "reminded" | "alerted" | "done_before" | "error" }

/** The reminder 30 minutes after his last step, then Baraa's alert 30 minutes after the reminder. Once each. */
export async function runCollectPayTick(env: Env, now: number = Date.now()): Promise<CollectTickRow[]> {
  const out: CollectTickRow[] = [];
  for (const invoiceId of await readIndex(env)) {
    try {
      const st = await readPending(env, invoiceId);
      if (!st) { await dropIndex(env, invoiceId); out.push({ invoiceId, action: "gone" }); continue; }
      if (st.alertedAt) { await dropIndex(env, invoiceId); out.push({ invoiceId, action: "done_before" }); continue; }
      const inv = await getInvoiceById(env, invoiceId);
      const remaining = inv ? await openBalance(env, invoiceId, inv.total) : 0;
      if (!inv || inv.status === "paid" || !(remaining > 0.005)) {
        try { await env.MSG_DEDUP.delete(cpStateKey(invoiceId)); } catch { /* expires */ }
        await dropIndex(env, invoiceId);
        out.push({ invoiceId, action: "settled" });
        continue;
      }
      if (!st.remindedAt) {
        if (now - st.at < CP_WAIT_MIN * MIN) { out.push({ invoiceId, action: "waiting" }); continue; }
        const claim = await claimButton(env, `cpay_remind:${invoiceId}:${st.nonce}`, STATE_TTL);
        if (claim.claimed && st.to) {
          const { withAutoSendJob } = await import("./auto-send-guard");
          const d = gatewayDecision(await sendViaGateway(withAutoSendJob(env, `collect_remind:${invoiceId}:${st.nonce}`), {
            purpose: CP_REMIND_PURPOSE, to: st.to, content: buttonsContent(remindText(st, remaining), choiceButtons(st, remaining)),
          }));
          console.log(`[collect-pay] remind inv=${invoiceId} → ${d?.action ?? "?"}`);
        }
        await finishButton(env, claim, STATE_TTL);
        await writePending(env, { ...st, remindedAt: now });
        out.push({ invoiceId, action: "reminded" });
        continue;
      }
      if (now - Math.max(st.at, st.remindedAt) < CP_WAIT_MIN * MIN) { out.push({ invoiceId, action: "waiting" }); continue; }
      const claim = await claimButton(env, `cpay_alert:${invoiceId}:${st.nonce}`, STATE_TTL);
      if (claim.claimed) {
        const { withAutoSendJob } = await import("./auto-send-guard");
        await sendOwnerAlert(withAutoSendJob(env, `collect_alert:${invoiceId}:${st.nonce}`), ownerAlertText(st, remaining));
        await finishButton(env, claim, STATE_TTL);
      }
      await writePending(env, { ...st, alertedAt: now });
      await dropIndex(env, invoiceId);
      await clearAmountPointer(env, st.partnerId);
      out.push({ invoiceId, action: "alerted" });
    } catch (e) {
      console.warn(`[collect-pay] tick inv=${invoiceId} failed`, (e as Error)?.message);
      out.push({ invoiceId, action: "error" });
    }
  }
  return out;
}
