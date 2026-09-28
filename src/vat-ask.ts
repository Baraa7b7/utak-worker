// The customer's VAT number — 2026-09-28 (STATUS § 44 د).
//
// After ANY confirmed order (the quotation's «تأكيد الطلب», «سجّله لبكرة», the
// standing order's «تمام أرسلوها») of a customer whose «حالة التسجيل الضريبي»
// (res.partner.x_vat_status) is «غير معروف» — and who has no VAT number in his
// card — one session message follows the confirmation (his window is open: he
// just tapped):
//
//   «لإصدار فاتورتك الضريبية: هل منشأتك مسجلة في ضريبة القيمة المضافة؟»  [نعم] [لا]
//
//   «لا»  → «غير مسجّل», never asked again.
//   «نعم» → three steps, each answer within 60 minutes of the step's prompt:
//           1. the VAT number: 15 digits starting and ending with 3 (Western or
//              Arabic-Indic digits, spaces removed); anything else is asked again;
//           2. the establishment's name as in the commercial register;
//           3. the address (district and street, or the short national address).
//           After the third: vat, x_legal_name, street and «مسجّل» in ONE write,
//           and «تم حفظ بياناتك الضريبية ✅». Nothing is saved before it.
//   No answer within 60 minutes → still «غير معروف»; asked again after his next
//   confirmed order, three times at most (x_vat_ask_count). After the third
//   without an answer: never asked, and ONE alert to Baraa.
//   «إيقاف» (or «إلغاء») during the questions, or the order cancelled, ends the
//   flow with nothing saved.
//
// Delivery never waits for the answer: the invoice reads the status at the
// moment of «تم التسليم» (src/tax-invoice.ts buyerTaxInfo).
//
// State: KV `vat_ask:v1:<partner>` (the step, its time, the nonce, the answers so
// far), the index `vat_ask_open:v1` for the */5 tick (runVatAskTick: the
// 60-minute timeout, the cancelled order, the alert). Every step holds a KV
// lock; every message goes through the gateway (purpose customer_vat_ask) and
// is recorded (wa-record). Buttons: vat_yes_<partner>_<nonce>, vat_no_<partner>_<nonce>.

import type { Env } from "./config";
import type { RouterReply } from "./router";
import { ALREADY_DONE_TEXT, claimButton, finishButton, releaseButton, withButtonLock } from "./button-lock";
import { call } from "./odoo";
import { sendOwnerAlert } from "./templates";
import { parseOptoutCommand } from "./optout";

export const VAT_PURPOSE = "customer_vat_ask";
export const VAT_WAIT_MIN = 60;
export const VAT_MAX_ASKS = 3;
const MIN = 60_000;
const STATE_TTL = 26 * 60 * 60;
const INDEX_TTL = 7 * 24 * 60 * 60;
const ALERT_TTL = 365 * 24 * 60 * 60;

export const VAT_QUESTION = "لإصدار فاتورتك الضريبية: هل منشأتك مسجلة في ضريبة القيمة المضافة؟";
export const VAT_ASK_NUMBER = "اكتب الرقم الضريبي (15 رقماً)";
export const VAT_BAD_NUMBER = "⚠️ الرقم الضريبي 15 رقماً يبدأ بـ3 وينتهي بـ3. اكتبه مرة ثانية.";
export const VAT_ASK_NAME = "اكتب اسم المنشأة كما في السجل التجاري";
export const VAT_BAD_NAME = "⚠️ اكتب اسم المنشأة كما في السجل التجاري.";
export const VAT_ASK_ADDRESS = "اكتب العنوان: الحي والشارع، أو العنوان الوطني المختصر";
export const VAT_BAD_ADDRESS = "⚠️ اكتب العنوان: الحي والشارع، أو العنوان الوطني المختصر.";
export const VAT_SAVED = "تم حفظ بياناتك الضريبية ✅";
export const VAT_NO_TEXT = "تمام ✅ سجّلنا أن منشأتك غير مسجلة في ضريبة القيمة المضافة، وتصلك فاتورة ضريبية مبسطة. ما نسألك مرة ثانية.";
export const VAT_STOPPED = "تمام، أوقفنا أسئلة الرقم الضريبي وما حفظنا شي. تصلك فاتورتك كالعادة 🌿";
export const VAT_EXPIRED = "انتهت مهلة هذا السؤال. نسألك مع طلبك المؤكد القادم 🌿";

export const vatKey = (partnerId: number): string => `vat_ask:v1:${partnerId}`;
export const VAT_INDEX_KEY = "vat_ask_open:v1";
export const VAT_BUTTON_RE = /^vat_(yes|no)_(\d+)_([a-z0-9]{4,16})$/;
export type VatStatus = "unknown" | "registered" | "not_registered";

export interface VatFlow {
  partnerId: number;
  orderId: number;
  name: string;
  step: "ask" | "number" | "name" | "address";
  /** The step's prompt (the 60 minutes run from here). */
  at: number;
  nonce: string;
  /** 1..3: which ask this is (x_vat_ask_count after it). */
  askNo: number;
  vat?: string;
  legalName?: string;
}

// ---------------------------------------------------------------- rules

/** An empty status (a partner from before § 44) reads «غير معروف». */
export function vatStatusOf(p: { x_vat_status?: string | false | null } | null | undefined): VatStatus {
  const s = String(p?.x_vat_status || "");
  return s === "registered" || s === "not_registered" ? s : "unknown";
}

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
/**
 * The VAT number in a text, or null: 15 digits, the first and the last «3»
 * (Western or Arabic-Indic digits; spaces and the invisible direction marks
 * WhatsApp copies removed; nothing else accepted).
 */
export function parseVatNumber(text: string): string | null {
  const s = String(text ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .replace(/[\s\u200e\u200f\u2066-\u2069\u202a-\u202e]+/g, "");
  return /^3\d{13}3$/.test(s) ? s : null;
}
const clean = (t: string) => String(t ?? "").replace(/\s+/g, " ").trim();
/** A name: 2–120 characters with at least one letter. */
export function parseLegalName(text: string): string | null {
  const t = clean(text);
  return t.length >= 2 && t.length <= 120 && /\p{L}/u.test(t) ? t : null;
}
/** An address: 3–200 characters with at least one letter or digit. */
export function parseAddress(text: string): string | null {
  const t = clean(text);
  return t.length >= 3 && t.length <= 200 && /[\p{L}\p{N}]/u.test(t) ? t : null;
}
/** «إيقاف» (the opt-out word) or «إلغاء» ends the questions. */
export function isVatStopWord(text: string): boolean {
  const t = clean(text).replace(/[.!؟?]+$/g, "");
  return parseOptoutCommand(t) === "optout" || t === "إلغاء" || t === "الغاء";
}

export function vatButtons(f: Pick<VatFlow, "partnerId" | "nonce">): Array<{ id: string; title: string }> {
  return [
    { id: `vat_yes_${f.partnerId}_${f.nonce}`, title: "نعم" },
    { id: `vat_no_${f.partnerId}_${f.nonce}`, title: "لا" },
  ];
}
export function vatAlertText(name: string): string {
  return [
    `⚠️ الرقم الضريبي: سُئل العميل ${name || "?"} ${VAT_MAX_ASKS} مرات بعد طلباته المؤكدة ولم يُكمل.`,
    "لن يُسأل مرة ثانية، وفواتيره «مبسطة» حتى تُدخل من بطاقته في Odoo: الرقم الضريبي، والاسم الرسمي للمنشأة، والعنوان، والحالة «مسجّل».",
  ].join("\n");
}

// ---------------------------------------------------------------- KV

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.MSG_DEDUP.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export const readVatFlow = (env: Env, partnerId: number) => readJson<VatFlow>(env, vatKey(partnerId));
async function writeFlow(env: Env, f: VatFlow): Promise<void> {
  await env.MSG_DEDUP.put(vatKey(f.partnerId), JSON.stringify(f), { expirationTtl: STATE_TTL });
}
export async function readVatIndex(env: Env): Promise<number[]> {
  const v = await readJson<unknown>(env, VAT_INDEX_KEY);
  return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
}
async function setIndex(env: Env, ids: number[]): Promise<void> {
  try { await env.MSG_DEDUP.put(VAT_INDEX_KEY, JSON.stringify(ids.slice(-500)), { expirationTtl: INDEX_TTL }); } catch { /* next step */ }
}
async function addIndex(env: Env, id: number): Promise<void> {
  const ids = await readVatIndex(env);
  if (!ids.includes(id)) await setIndex(env, [...ids, id]);
}
async function dropIndex(env: Env, id: number): Promise<void> {
  const ids = await readVatIndex(env);
  if (ids.includes(id)) await setIndex(env, ids.filter((x) => x !== id));
}
function nonce(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(6, "0");
}

/**
 * The flow ends without an answer (the 60 minutes, «إيقاف», the order
 * cancelled): nothing is saved; after the third ask, Baraa's one alert.
 */
async function endUnanswered(env: Env, f: VatFlow, why: string, fromTick: boolean): Promise<boolean> {
  try { await env.MSG_DEDUP.delete(vatKey(f.partnerId)); } catch { /* expires */ }
  await dropIndex(env, f.partnerId);
  console.log(`[vat-ask] partner=${f.partnerId} ended ${why} ask=${f.askNo}`);
  if (f.askNo < VAT_MAX_ASKS) return false;
  // one alert per exhausted round (a counter Baraa resets on the card starts a new one)
  const claim = await claimButton(env, `vat_alert:${f.partnerId}:${f.nonce}`, ALERT_TTL);
  if (!claim.claimed) return false;
  const { withAutoSendJob } = await import("./auto-send-guard");
  await sendOwnerAlert(fromTick ? withAutoSendJob(env, `vat_ask_alert:${f.partnerId}`) : env, vatAlertText(f.name));
  await finishButton(env, claim, ALERT_TTL);
  return true;
}

// ---------------------------------------------------------------- the question

const PARTNER_FIELDS = ["id", "name", "vat", "x_vat_status", "x_vat_ask_count"];

/**
 * After a confirmed order: the question (buttons) when his status is «غير
 * معروف», no number is on his card, fewer than three asks so far and none
 * open. Null otherwise. Never throws: the confirmation never depends on it.
 */
export async function maybeAskVat(env: Env, partnerId: number, orderId: number, now: number = Date.now()): Promise<RouterReply | null> {
  if (!partnerId) return null;
  try {
    const [p] = await call<Array<{ id: number; name: string; vat: string | false; x_vat_status: string | false; x_vat_ask_count: number | false }>>(
      env, "res.partner", "read", { ids: [partnerId], fields: PARTNER_FIELDS },
    );
    if (!p || vatStatusOf(p) !== "unknown") return null;
    if (typeof p.vat === "string" && p.vat.trim()) return null; // Baraa entered it on the card
    const count = Number(p.x_vat_ask_count || 0);
    if (count >= VAT_MAX_ASKS) return null;
    const open = await readVatFlow(env, partnerId);
    if (open && now - open.at < VAT_WAIT_MIN * MIN) return null;
    const claim = await claimButton(env, `vat_ask:${partnerId}:${orderId}`, STATE_TTL);
    if (!claim.claimed) return null;
    const f: VatFlow = { partnerId, orderId, name: String(p.name || ""), step: "ask", at: now, nonce: nonce(), askNo: count + 1 };
    await call(env, "res.partner", "write", { ids: [partnerId], vals: { x_vat_ask_count: count + 1 } });
    await writeFlow(env, f);
    await addIndex(env, partnerId);
    console.log(`[vat-ask] partner=${partnerId} order=${orderId} ask=${f.askNo} nonce=${f.nonce}`);
    return { bodyBeforeButtons: VAT_QUESTION, buttons: vatButtons(f), purpose: VAT_PURPOSE };
  } catch (e) {
    console.warn(`[vat-ask] ask for ${partnerId} failed`, (e as Error)?.message);
    return null;
  }
}

async function answer(env: Env, f: VatFlow, yes: boolean, now: number): Promise<RouterReply> {
  if (!yes) {
    await call(env, "res.partner", "write", { ids: [f.partnerId], vals: { x_vat_status: "not_registered" } });
    try { await env.MSG_DEDUP.delete(vatKey(f.partnerId)); } catch { /* expires */ }
    await dropIndex(env, f.partnerId);
    console.log(`[vat-ask] partner=${f.partnerId} no → not_registered`);
    return { text: VAT_NO_TEXT, purpose: VAT_PURPOSE };
  }
  await writeFlow(env, { ...f, step: "number", at: now });
  return { text: VAT_ASK_NUMBER, purpose: VAT_PURPOSE };
}

/** «نعم» / «لا» (buttons). One answer per question (lock on its nonce). */
export async function handleVatButton(env: Env, buttonId: string, now: number = Date.now()): Promise<RouterReply> {
  const m = VAT_BUTTON_RE.exec(buttonId);
  if (!m) return { text: ALREADY_DONE_TEXT };
  const partnerId = Number(m[2]), n = m[3], yes = m[1] === "yes";
  let reply: RouterReply = {};
  const text = await withButtonLock(env, `vat_btn:${partnerId}:${n}`, async () => {
    const f = await readVatFlow(env, partnerId);
    if (!f || f.nonce !== n || f.step !== "ask" || now - f.at > VAT_WAIT_MIN * MIN) {
      const [p] = await call<Array<{ x_vat_status: string | false }>>(env, "res.partner", "read", { ids: [partnerId], fields: ["x_vat_status"] }).catch(() => []);
      const st = vatStatusOf(p);
      reply = { text: st === "registered" ? VAT_SAVED : st === "not_registered" ? VAT_NO_TEXT : VAT_EXPIRED, purpose: VAT_PURPOSE };
      return reply.text!;
    }
    reply = await answer(env, f, yes, now);
    return reply.text!;
  }, STATE_TTL);
  return text === ALREADY_DONE_TEXT ? { text, purpose: VAT_PURPOSE } : reply;
}

/**
 * A customer's text while his questions are open. Null = not his flow (or
 * expired, or a text the step does not take): the text goes on as usual.
 * `locationPending`: the confirmation still waits for his location, so a text
 * without a digit at the number step is that, not a wrong number.
 */
export async function vatFlowReply(env: Env, partnerId: number, text: string, now: number = Date.now(), opts: { locationPending?: boolean } = {}): Promise<RouterReply | null> {
  const f = await readVatFlow(env, partnerId);
  if (!f) return null;
  if (now - f.at > VAT_WAIT_MIN * MIN) return null; // the tick ends it
  if (isVatStopWord(text)) {
    await endUnanswered(env, f, "stopped", false);
    return { text: VAT_STOPPED, purpose: VAT_PURPOSE };
  }
  if (f.step === "ask") {
    const t = clean(text).replace(/[.!؟?]+$/g, "");
    if (t !== "نعم" && t !== "لا") return null;
    return handleVatButton(env, `vat_${t === "نعم" ? "yes" : "no"}_${f.partnerId}_${f.nonce}`, now);
  }
  if (f.step === "number" && opts.locationPending && !/[0-9٠-٩۰-۹]/.test(text)) return null;
  const claim = await claimButton(env, `vat_step:${partnerId}:${f.nonce}:${f.step}`, 60);
  if (!claim.claimed) return { text: "" }; // the same step is being answered right now
  try {
    if (f.step === "number") {
      const vat = parseVatNumber(text);
      if (!vat) { await releaseButton(env, claim); return { text: VAT_BAD_NUMBER, purpose: VAT_PURPOSE }; }
      await writeFlow(env, { ...f, vat, step: "name", at: now });
      await finishButton(env, claim, 60);
      return { text: VAT_ASK_NAME, purpose: VAT_PURPOSE };
    }
    if (f.step === "name") {
      const legalName = parseLegalName(text);
      if (!legalName) { await releaseButton(env, claim); return { text: VAT_BAD_NAME, purpose: VAT_PURPOSE }; }
      await writeFlow(env, { ...f, legalName, step: "address", at: now });
      await finishButton(env, claim, 60);
      return { text: VAT_ASK_ADDRESS, purpose: VAT_PURPOSE };
    }
    const address = parseAddress(text);
    if (!address) { await releaseButton(env, claim); return { text: VAT_BAD_ADDRESS, purpose: VAT_PURPOSE }; }
    // the one write: nothing was saved before the third answer
    await call(env, "res.partner", "write", { ids: [partnerId], vals: {
      vat: f.vat, x_legal_name: f.legalName, street: address, x_vat_status: "registered",
    } });
    try { await env.MSG_DEDUP.delete(vatKey(partnerId)); } catch { /* expires */ }
    await dropIndex(env, partnerId);
    await finishButton(env, claim, 60);
    console.log(`[vat-ask] partner=${partnerId} saved (registered)`);
    return { text: VAT_SAVED, purpose: VAT_PURPOSE };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/** The order that opened the questions was cancelled: the flow ends, nothing saved. */
export async function endVatFlowForOrder(env: Env, partnerId: number, orderId: number): Promise<void> {
  if (!partnerId) return;
  const f = await readVatFlow(env, partnerId);
  if (f && f.orderId === orderId) await endUnanswered(env, f, "order_cancelled", false);
}

// ---------------------------------------------------------------- the */5 tick

export interface VatTickRow { partnerId: number; action: "gone" | "waiting" | "expired" | "expired_alerted" | "order_cancelled" | "error" }

/** 60 minutes without the step's answer, or the order cancelled: the flow ends (the alert after the third ask). */
export async function runVatAskTick(env: Env, now: number = Date.now()): Promise<VatTickRow[]> {
  const out: VatTickRow[] = [];
  for (const partnerId of await readVatIndex(env)) {
    try {
      const f = await readVatFlow(env, partnerId);
      if (!f) { await dropIndex(env, partnerId); out.push({ partnerId, action: "gone" }); continue; }
      if (now - f.at >= VAT_WAIT_MIN * MIN) {
        const alerted = await endUnanswered(env, f, "timeout", true);
        out.push({ partnerId, action: alerted ? "expired_alerted" : "expired" });
        continue;
      }
      const [o] = await call<Array<{ x_state: string }>>(env, "x_daily_order", "read", { ids: [f.orderId], fields: ["x_state"] }).catch(() => []);
      if (o && o.x_state === "cancelled") {
        await endUnanswered(env, f, "order_cancelled", true);
        out.push({ partnerId, action: "order_cancelled" });
        continue;
      }
      out.push({ partnerId, action: "waiting" });
    } catch (e) {
      console.warn(`[vat-ask] tick partner=${partnerId} failed`, (e as Error)?.message);
      out.push({ partnerId, action: "error" });
    }
  }
  return out;
}
