// § 57 و (2026-10-05) — «تسجيل مصروف»: Baraa records an expense from WhatsApp,
// as a WhatsApp Flow, and the worker enters it in Odoo's books.
//
// The Flow (utak_expense_v2 since § 58 أ 4; scripts/lib/s58-expense-flow.mjs is
// its JSON — utak_expense_v1 of scripts/lib/s57-expense-flow.mjs without «رواتب
// وأجور») is ONE screen with no endpoint — its data goes with the message
// (flow_action navigate): the heading, a line of text, the ways of paying on
// offer and today's date. He fills the type (one of seven), the amount as paid, «فاتورة
// ضريبية؟», the supplier's tax number and name, the way it was paid, the date,
// a photo and a note, then «إرسال».
//
//   • BARAA ALONE. The doors — the whole message «مصروف» / «تسجيل مصروف», and
//     the button expense_start under the reply to «تم الاطلاع» of the 21:30
//     summary (the owner has no menu in WhatsApp: that reply is his one regular
//     tap) — the form, its answers and «↩️ تراجع» are read from his number and
//     sent to it under purposes the gateway lets through to him alone. The
//     same word from anyone else is not this module's.
//   • Inside his 24h window only (an interactive message: never a template,
//     never held). With ACCOUNTING_SYNC off nothing is recorded, so no form is
//     sent: one line says so.
//   • flow_token (ex1.…): one per send, kept in KV with his number and the ways
//     of paying it offered. A reply is read from the number it was sent to,
//     once.
//   • «خانة لا تُقرأ = النموذج كله يُرفض ولا يُكتب شيء» (§ 55): a type that is not
//     one of the seven — «رواتب وأجور» of a form of utak_expense_v1 sent before
//     § 58 is said by its own line: the salaries have their monthly entry —, an
//     amount that is not a number above zero with at most
//     two decimals, «فاتورة ضريبية؟» without an answer, no supplier name, a way
//     of paying that was not offered, a date that is not one or is after today
//     in Riyadh, or «نعم» without the invoice's photo — one message naming each,
//     with a fresh form.
//   • «نعم» with a tax number that is not a valid one is NOT refused: the
//     expense is recorded WITHOUT input VAT, and the answer says so.
//   • The entry is src/expense-accounting.ts: a posted vendor bill in EXP with
//     the photo, then its payment from the journal he chose — guarded, and
//     undone whole when a guard fails.
//   • His answer: the bill's number, the account, the supplier, net / VAT /
//     total, the journal of the payment — and ONE button «↩️ تراجع»
//     (exp_undo_<the bill>), good for 24 hours, once: it cancels the payment
//     and puts the bill back to draft. Nothing is deleted.
//   • The trial (sendExpenseFormTest, POST /odoo/hook/expense-form-test): one
//     form a day to his own number, marked «🧪 تجربة». Its «إرسال» answers with
//     what WOULD have been recorded — read from Odoo, nothing written.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { dayLabel } from "./order-flow";
import { isAccountingSyncEnabled } from "./accounting";
import { readReceiptPhotos } from "./receipt-form";
import {
  EXPENSE_PAY, EXPENSE_REMOVED_TYPE, POCKET_JOURNAL_CODE, POCKET_NO_ACCOUNT_TEXT, expensePayOf, expenseTypeOf, isValidVatNumber, normalizeVatNumber, ownerPocketAvailable, recordExpense, resolveExpense,
  undoExpenseEntry, type ExpenseEntry, type ExpensePay, type ExpensePhotoFile, type ExpensePlan, type ExpenseRecord, type PocketWhy,
} from "./expense-accounting";

/**
 * utak_expense_v2 at Meta, published 2026-10-05 (§ 58 أ 4; a published Flow's JSON is frozen).
 * utak_expense_v1 (#1084220070882916, with «رواتب وأجور») stays published there and is not sent.
 */
export const EXPENSE_FLOW_ID = "2207848546771736";
export const EXPENSE_FLOW_SCREEN = "EXPENSE_A";
/** The gateway purpose of the form, of its answers and of «↩️ تراجع»: the owner's number alone. */
export const EXPENSE_PURPOSE = "expense_form";
/** The one trial to Baraa and its answers (the owner's number alone). */
export const EXPENSE_TEST_PURPOSE = "expense_form_test";
export const EXPENSE_BUTTON = "expense_start";
export const EXPENSE_BUTTON_TITLE = "🧾 تسجيل مصروف";
export const EXPENSE_CTA = "سجّل المصروف";
export const EXPENSE_TITLE = "تسجيل مصروف";
export const EXPENSE_TEST_MARK = "🧪 تجربة";
/** «↩️ تراجع» under the answer: exp_undo_<the bill's account.move id>. */
export const EXPENSE_UNDO_PAYLOAD = /^exp_undo_(\d+)$/;
export const EXPENSE_UNDO_TITLE = "↩️ تراجع";
/** How long the undo is good for. */
export const EXPENSE_UNDO_SECONDS = 24 * 60 * 60;
/** Meta's limit of a TextHeading; the room a supplier's name and a note take. */
export const EXPENSE_HEADING_MAX = 80;
export const EXPENSE_SUPPLIER_MAX = 80;
export const EXPENSE_NOTE_MAX = 200;
const BODY_MAX = 1024;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
/** The undo's record outlives its 24 hours, so a late tap is answered as late — not as unknown. */
const UNDO_KEEP = 3 * 24 * 60 * 60;

// ---------------------------------------------------------------- texts

export const EXPENSE_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «مصروف» لنموذج جديد.";
export const EXPENSE_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. لمصروف آخر اكتب «مصروف».";
export const EXPENSE_FAILED_TEXT = "تعذّر إرسال نموذج تسجيل المصروف الآن. جرّب بعد قليل.";
export const EXPENSE_OFF_TEXT = "المحاسبة مطفأة في هذه البيئة (ACCOUNTING_SYNC): لا يُسجَّل مصروف من هنا، ولم يُكتب شيء.";
export const EXPENSE_ERROR_TEXT = "تعذّر الوصول إلى Odoo الآن: لم يُسجَّل شيء من النموذج. أعد «إرسال» من النموذج نفسه بعد قليل.";
/** The line under the form when «من جيب براء» cannot be offered: its journal is not in Odoo, or the journal's outbound payment method has no account. */
export const EXPENSE_NO_POCKET_TEXT: Readonly<Record<PocketWhy, string>> = {
  journal: `⚠️ خيار «من جيب براء» غير معروض: يومية ${POCKET_JOURNAL_CODE} غير موجودة في Odoo.`,
  method: `⚠️ خيار «من جيب براء» غير معروض: ${POCKET_NO_ACCOUNT_TEXT}.`,
};
export const EXPENSE_HOW_TEXT = "اكتب المبلغ كما دفعته. ضريبة المدخلات تُفصل مع «نعم» ورقم ضريبي صحيح وصورة الفاتورة فقط.";
export const EXPENSE_BAD: Readonly<Record<string, string>> = {
  type: "اختر نوع المصروف من القائمة.",
  salaries: "«رواتب وأجور» لم تعد في النموذج: الرواتب تُسجَّل بقيدها الشهري، وتسجيلها هنا يكرّرها. اختر نوعاً آخر.",
  amt: "المبلغ رقم أكبر من صفر، بخانتين عشريتين على الأكثر.",
  tax: "اختر «نعم» أو «لا» في «فاتورة ضريبية؟».",
  sup: "اكتب اسم المورد.",
  pay: "اختر طريقة الدفع من المعروض في النموذج.",
  date: "التاريخ غير صحيح.",
  future: "التاريخ بعد اليوم: Odoo لا يقبل فاتورة بتاريخ لاحق.",
  photo: "مع «فاتورة ضريبية: نعم» لازم صورة الفاتورة.",
};
export const EXPENSE_UNDO_HINT = `«${EXPENSE_UNDO_TITLE}» خلال 24 ساعة يلغي الدفعة ويعيد الفاتورة مسودة (لا حذف).`;
export const EXPENSE_UNDO_UNKNOWN_TEXT = "لا مصروف مسجّل بهذا الزر: لم يتغيّر شيء.";
export const EXPENSE_UNDO_EXPIRED_TEXT = "انتهت مهلة التراجع (24 ساعة): لم يتغيّر شيء. عدّل الفاتورة من Odoo.";
export const expenseUndoDoneText = (bill: string): string => `سبق التراجع عن ${bill} ✅ ولم يتغيّر شيء الآن.`;
export const expenseUndoneText = (bill: string): string =>
  `↩️ تم التراجع: أُلغيت الدفعة، وعادت الفاتورة ${bill} مسودة في Odoo (لم يُحذف شيء). صحّحها ورحّلها من Odoo، أو اكتب «مصروف» لتسجيلها من جديد.`;

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const oneLine = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
/** An amount as it is read: «115», «86.96». */
function money(x: number): string {
  const n = Math.round((Number(x) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const ownerOf = (env: Env): string => waDigits(String(env.OWNER_WHATSAPP ?? ""));

/** «مصروف» / «تسجيل مصروف»: the WHOLE message and nothing else in it (the marks, a full stop after it). */
export function expenseCommand(text: string): boolean {
  const t = String(text ?? "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[.!؟?،,\s]+$/g, "").replace(/\s+/g, " ");
  return t === "مصروف" || t === "تسجيل مصروف";
}
export const expenseButton = (): { id: string; title: string } => ({ id: EXPENSE_BUTTON, title: EXPENSE_BUTTON_TITLE });
export const expenseUndoButton = (moveId: number): { id: string; title: string } => ({ id: `exp_undo_${moveId}`, title: EXPENSE_UNDO_TITLE });

// ---------------------------------------------------------------- flow_token

export interface ExpenseToken {
  v: 1;
  token: string;
  /** The Riyadh day it was sent. */
  day: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  /** The ways of paying the form offered: no other is read from its reply. */
  pay: ExpensePay[];
  createdAt: number;
  /** The trial: its reply writes nothing. */
  test?: boolean;
  usedAt?: number;
}
export const expenseTokenKey = (token: string): string => `expense_t:v1:${token}`;
export const isExpenseToken = (token: string): boolean => String(token ?? "").startsWith("ex1.");
export function newExpenseToken(day: string): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ex1.${day.replace(/-/g, "")}.${rand}`;
}
export async function readExpenseToken(env: Env, token: string): Promise<ExpenseToken | null> {
  if (!isExpenseToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(expenseTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as ExpenseToken) : null;
    return rec && rec.v === 1 && Array.isArray(rec.pay) ? rec : null;
  } catch { return null; }
}
async function writeExpenseToken(env: Env, rec: ExpenseToken): Promise<void> {
  await env.MSG_DEDUP.put(expenseTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}
/**
 * The bill's reference: his note (else the type's name), closed by a mark that
 * is this form's alone. Odoo refuses a second posted bill of the same vendor,
 * date and reference — two fill-ups a day at the same station are two bills —
 * and the mark is also what finds the bill again after an ambiguous failure.
 */
export const expenseRef = (text: string, token: string): string => `${cut(text, 60)} — EX-${String(token.split(".").pop() ?? "").slice(0, 8).toUpperCase()}`;

// ---------------------------------------------------------------- the send

export interface ExpenseFormOpts {
  now?: number;
  /** The text above the button (default: the day and what to do). */
  body?: string;
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface ExpenseFormResult { sent: boolean; reason?: string; token?: string; pay?: ExpensePay[] }

/** The four keys of the screen: its heading, the line under it (and `line`: why «من جيب براء» is not offered), the ways of paying on offer, today. */
export function expenseData(day: string, pay: ExpensePay[], mark = "", line = ""): Record<string, unknown> {
  return {
    t: cut(`${mark}${EXPENSE_TITLE} — ${dayLabel(day)}`, EXPENSE_HEADING_MAX),
    n: line ? `${EXPENSE_HOW_TEXT}\n${line}` : EXPENSE_HOW_TEXT,
    pay: EXPENSE_PAY.filter((p) => pay.includes(p.id)).map((p) => ({ id: p.id, title: p.title })),
    d: day,
  };
}
export function expenseSession(text: string, token: string, data: Record<string, unknown>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: EXPENSE_FLOW_ID,
            flow_cta: EXPENSE_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: EXPENSE_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}
/** The text above the form's button. */
export function expenseFormText(day: string): string {
  return [`🧾 ${EXPENSE_TITLE} — ${dayLabel(day)}`, `اضغط «${EXPENSE_CTA}»، عبّئ النوع والمبلغ والمورد وطريقة الدفع، ثم «إرسال».`].join("\n");
}

/**
 * One expense form, to Baraa's number and no other: the interactive message,
 * inside his window only. Nothing is held and no template is used. «من جيب
 * براء» is among its ways of paying only while its journal is in Odoo and the
 * journal's outbound payment method posts to an account; when it is not, a
 * line says which of the two. Throws on Odoo trouble (the caller says the form
 * could not go).
 */
export async function sendExpenseForm(env: Env, opts: ExpenseFormOpts = {}): Promise<ExpenseFormResult> {
  const to = ownerOf(env);
  if (!to) return { sent: false, reason: "no_owner" };
  const now = opts.now ?? Date.now();
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const day = riyadhDateKey(new Date(now));
  const pocket = await ownerPocketAvailable(env, now);
  const pay = EXPENSE_PAY.filter((p) => p.id !== "owner" || pocket.ok).map((p) => p.id);
  const line = pocket.ok ? "" : EXPENSE_NO_POCKET_TEXT[pocket.why];
  const rec: ExpenseToken = { v: 1, token: newExpenseToken(day), day, to, pay, createdAt: now, ...(opts.test ? { test: true } : {}) };
  await writeExpenseToken(env, rec);
  const mark = opts.test ? `${EXPENSE_TEST_MARK} — ` : "";
  const text = `${mark}${opts.body ?? expenseFormText(day)}${line ? `\n${line}` : ""}`;
  const res = await sendViaGateway(env, {
    purpose: opts.test ? EXPENSE_TEST_PURPOSE : EXPENSE_PURPOSE,
    to,
    content: expenseSession(text, rec.token, expenseData(day, pay, mark, line)),
    noHold: true,
    noHoldReason: "نموذج تسجيل المصروف يُرسل داخل نافذة براء فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(expenseTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token, pay };
}

// ---------------------------------------------------------------- the doors

async function tell(env: Env, text: string, ctx?: ExecutionContext, purpose: string = EXPENSE_PURPOSE, buttons: Array<{ id: string; title: string }> = []): Promise<void> {
  await sendViaGateway(env, { purpose, to: ownerOf(env), content: buttons.length ? buttonsContent(text, buttons) : textContent(text), ctx });
}

/** Baraa asked for the form. Never throws: what cannot go is said in one line. */
export async function startExpense(env: Env, ctx?: ExecutionContext, now: number = Date.now()): Promise<ExpenseFormResult> {
  // nothing can be recorded here: a form he would fill for nothing is not sent
  if (!isAccountingSyncEnabled(env)) {
    await tell(env, EXPENSE_OFF_TEXT, ctx);
    return { sent: false, reason: "accounting_off" };
  }
  try {
    const r = await sendExpenseForm(env, { now, ctx });
    // outside his window nothing is said either: a line held for later would answer nothing
    if (!r.sent && r.reason !== "window_closed") await tell(env, EXPENSE_FAILED_TEXT, ctx);
    return r;
  } catch (e) {
    console.warn("[expense] the form could not be sent", (e as Error)?.message);
    try { await tell(env, EXPENSE_FAILED_TEXT, ctx); } catch { /* nothing more to say */ }
    return { sent: false, reason: "error" };
  }
}

/**
 * A message from Baraa's number: «مصروف» / «تسجيل مصروف» or the button
 * expense_start → the form; «↩️ تراجع» → the undo. True when it was one of
 * them (nothing else answers). Any other message, and ANY message of another
 * number, is not this module's (false, and nothing is read or sent).
 */
export async function expenseMessage(env: Env, msg: Pick<NormalizedMessage, "from" | "type" | "text" | "buttonId">, ctx?: ExecutionContext): Promise<boolean> {
  if (!isOwnerRecipient(env, msg.from)) return false;
  const button = msg.type === "interactive" || msg.type === "button" ? String(msg.buttonId ?? "") : "";
  if (button === EXPENSE_BUTTON || (msg.type === "text" && expenseCommand(msg.text))) {
    await startExpense(env, ctx);
    return true;
  }
  if (EXPENSE_UNDO_PAYLOAD.test(button)) {
    const r = await handleExpenseUndo(env, button, ctx);
    console.log(`[expense] undo ${button} → ${r}`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the reply: reading it

/** «المبلغ كما دُفع»: a number ABOVE zero with at most two decimals — nothing else (an empty field is not an amount). */
export function parseExpenseAmount(raw: unknown): number | "invalid" {
  if (raw === undefined || raw === null) return "invalid";
  let s = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  return Number(s) > 0 ? Number(s) : "invalid";
}
/** «تاريخ المصروف»: empty = today; else a real day «YYYY-MM-DD» (as Flow JSON 5.0+ sends a DatePicker), never after today. */
export function parseExpenseDate(raw: unknown, today: string): string | "invalid" | "future" {
  const s = String(raw ?? "").trim();
  if (!s) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "invalid";
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return "invalid";
  return s > today ? "future" : s;
}

export interface ExpenseRead {
  /** The keys of EXPENSE_BAD: what refuses the form. */
  problems: string[];
  entry: ExpenseEntry | null;
  /** «نعم» with a tax number that is not a valid one: what he typed ("" = nothing). Recorded WITHOUT tax, and said. */
  badVat: string | null;
  photo: { id: string; mime?: string } | null;
}

/** Every field of a reply against its token — the ways of paying it offered, never the client's own list — and today in Riyadh. */
export function readExpenseValues(rec: Pick<ExpenseToken, "token" | "pay">, values: Record<string, unknown>, today: string): ExpenseRead {
  const problems: string[] = [];
  const type = expenseTypeOf(values.type);
  // § 58 أ 4 — a form of utak_expense_v1 sent before the list changed: refused whole, and told why
  if (!type) problems.push(values.type === EXPENSE_REMOVED_TYPE ? "salaries" : "type");
  const amount = parseExpenseAmount(values.amt);
  if (amount === "invalid") problems.push("amt");
  const taxInvoice = values.tax === "yes" ? true : values.tax === "no" ? false : null;
  if (taxInvoice === null) problems.push("tax");
  const supplier = cut(oneLine(values.sup), EXPENSE_SUPPLIER_MAX);
  if (!supplier) problems.push("sup");
  const pay = expensePayOf(values.pay);
  if (!pay || !rec.pay.includes(pay.id)) problems.push("pay");
  const date = parseExpenseDate(values.date, today);
  if (date === "invalid") problems.push("date");
  if (date === "future") problems.push("future");
  const [photo] = readReceiptPhotos(values.photo);
  // an input-VAT claim stands on the tax invoice itself: «نعم» comes with its photo
  if (taxInvoice === true && !photo) problems.push("photo");
  if (problems.length || !type || amount === "invalid" || taxInvoice === null || !pay || date === "invalid" || date === "future") return { problems, entry: null, badVat: null, photo: null };
  // the tax number counts with «نعم» only; one that is not valid records the expense WITHOUT tax
  const typed = oneLine(values.vat);
  const taxed = taxInvoice && isValidVatNumber(typed);
  const note = cut(oneLine(values.note), EXPENSE_NOTE_MAX);
  return {
    problems,
    entry: { type: type.id, amount, taxed, vat: taxed ? normalizeVatNumber(typed) : "", supplier, pay: pay.id, date, note, ref: expenseRef(note || type.title, rec.token) },
    badVat: taxInvoice && !taxed ? typed : null,
    photo: photo ? { id: photo.id, ...(photo.mime ? { mime: photo.mime } : {}) } : null,
  };
}

// ---------------------------------------------------------------- the reply: what Baraa reads

/** «نعم» with a number that is not a valid one: the line of his answer. */
export const badVatText = (typed: string, test = false): string =>
  `⚠️ ${typed ? `الرقم الضريبي «${cut(typed, 30)}» غير صحيح (15 رقماً يبدأ بـ 3 وينتهي بـ 3)` : "«فاتورة ضريبية: نعم» بلا رقم ضريبي للمورد"}: ${test ? "كان سيُسجَّل" : "سُجّل"} بلا ضريبة مدخلات.`;
/** Net / VAT / total, as the answer reads them. */
export function totalsLine(p: { net: number; vat: number; total: number; taxed: boolean }): string {
  return p.taxed
    ? `الصافي ${money(p.net)} ر.س + ضريبة المدخلات ${money(p.vat)} ر.س = الإجمالي ${money(p.total)} ر.س`
    : `الإجمالي ${money(p.total)} ر.س — بلا ضريبة مدخلات`;
}
/** The lines both answers share: the account, the supplier, the split, the payment's journal, the day, his note. */
function entryLines(e: ExpenseEntry, plan: ExpensePlan, supplier: string): string[] {
  return [
    `الحساب: ${plan.account.code} ${plan.account.name}`,
    `المورد: ${supplier}`,
    totalsLine({ ...plan, taxed: plan.tax !== null }),
    `الدفع: ${plan.pay.title}`,
    `التاريخ: ${dayLabel(e.date)}`,
    ...(e.note ? [`ملاحظة: ${e.note}`] : []),
  ];
}
export const EXPENSE_PHOTO_SAVED_TEXT = "📎 الصورة مرفقة بالفاتورة.";
export const EXPENSE_PHOTO_FAILED_TEXT = "⚠️ الصورة لم تُحفظ: أرفقها يدوياً على الفاتورة في Odoo.";

/** The answer of a recorded expense (its button is «↩️ تراجع»). */
export function expenseDoneText(e: ExpenseEntry, plan: ExpensePlan, r: Extract<ExpenseRecord, { ok: true }>, badVat: string | null): string {
  return [
    `✅ سُجّل المصروف — ${plan.type.title}`,
    `الفاتورة: ${r.billName}`,
    ...entryLines(e, plan, `${r.supplierName}${r.supplierCreated ? " (مورد جديد)" : ""}`),
    ...(r.photo === "saved" ? [EXPENSE_PHOTO_SAVED_TEXT] : r.photo === "failed" ? [EXPENSE_PHOTO_FAILED_TEXT] : []),
    ...(badVat !== null ? [badVatText(badVat)] : []),
    EXPENSE_UNDO_HINT,
  ].join("\n");
}
/** The answer when nothing stands: why, and what is left in Odoo (a draft is never deleted). */
export function expenseFailedText(r: Extract<ExpenseRecord, { ok: false }>): string {
  const clean = !r.undo || r.undo.ok;
  return [
    `⚠️ لم يُسجَّل المصروف: ${r.reasons.join("؛ ")}`,
    ...(r.moveId && clean ? [`لا شيء مرحَّل: الفاتورة #${r.moveId} مسودة في Odoo (لم تُحذف)، والدفعة ملغاة إن أُنشئت.`] : []),
    ...(r.moveId && !clean ? [`🚨 بقي في Odoo ما يحتاج مراجعتك يدوياً (الفاتورة #${r.moveId}): ${r.undo!.problems.join("؛ ")}`] : []),
    "بعد التصحيح اكتب «مصروف» لنموذج جديد.",
  ].join("\n");
}
/** Odoo lacks something the entry needs: nothing was written. */
export const expenseBlockedText = (problems: string[], test = false): string =>
  [test ? "⚠️ كان سيتوقف قبل أي كتابة:" : "⚠️ لم يُسجَّل المصروف، ولم يُكتب شيء في Odoo:", ...problems.map((p) => `• ${p}`), ...(test ? [] : ["أصلحه في Odoo ثم أعد «إرسال» من النموذج نفسه."])].join("\n");
/** The trial's answer: what WOULD have been recorded. */
export function expenseTestText(e: ExpenseEntry, plan: ExpensePlan, o: { badVat: string | null; photo: boolean }): string {
  return [
    `${EXPENSE_TEST_MARK} — كان سيُسجَّل: ${plan.type.title}`,
    ...entryLines(e, plan, plan.supplier ? `${plan.supplier.name} (موجود في Odoo)` : `${e.supplier} (مورد جديد: كان سيُنشأ)`),
    o.photo ? "📎 مع النموذج صورة: كانت ستُرفق بالفاتورة." : "بلا صورة.",
    ...(o.badVat !== null ? [badVatText(o.badVat, true)] : []),
    "(تجربة: لم يُكتب شيء في Odoo — لا فاتورة ولا دفعة ولا مورد)",
  ].join("\n");
}

// ---------------------------------------------------------------- the undo (KV)

export interface ExpenseUndoRecord {
  v: 1;
  /** The bill (account.move) and its payment (account.payment). */
  moveId: number;
  paymentId: number;
  billName: string;
  /** When the expense was recorded: the 24 hours run from here. */
  at: number;
}
export const expenseUndoKey = (moveId: number): string => `expense_undo:v1:${moveId}`;
export async function readExpenseUndo(env: Env, moveId: number): Promise<ExpenseUndoRecord | null> {
  try {
    const raw = await env.MSG_DEDUP.get(expenseUndoKey(moveId));
    const rec = raw ? (JSON.parse(raw) as ExpenseUndoRecord) : null;
    return rec && rec.v === 1 && rec.moveId === moveId ? rec : null;
  } catch { return null; }
}
async function writeExpenseUndo(env: Env, rec: ExpenseUndoRecord): Promise<void> {
  await env.MSG_DEDUP.put(expenseUndoKey(rec.moveId), JSON.stringify(rec), { expirationTtl: UNDO_KEEP });
}

/**
 * «↩️ تراجع» from Baraa's number (the caller checked whose it is): within 24
 * hours of the record, once (the button's claim is what remembers it) — the
 * payment cancelled, the bill back to draft. A tap that is late, a second
 * tap, a bill this worker did not record: one line, and nothing is written.
 * An undo Odoo refuses says what is left, and may be tapped again.
 */
export async function handleExpenseUndo(env: Env, buttonId: string, ctx?: ExecutionContext, now: number = Date.now()): Promise<"undone" | "unknown" | "duplicate" | "expired" | "failed"> {
  const moveId = Number(EXPENSE_UNDO_PAYLOAD.exec(buttonId)?.[1] ?? 0);
  const rec = moveId ? await readExpenseUndo(env, moveId) : null;
  if (!rec) { await tell(env, EXPENSE_UNDO_UNKNOWN_TEXT, ctx); return "unknown"; }
  if (now - rec.at > EXPENSE_UNDO_SECONDS * 1000) { await tell(env, EXPENSE_UNDO_EXPIRED_TEXT, ctx); return "expired"; }
  const claim = await claimButton(env, `expense_undo:${moveId}`, UNDO_KEEP);
  if (!claim.claimed) { await tell(env, expenseUndoDoneText(rec.billName), ctx); return "duplicate"; }
  const u = await undoExpenseEntry(env, rec);
  if (!u.ok) {
    await releaseButton(env, claim);
    await tell(env, `⚠️ لم يكتمل التراجع عن ${rec.billName}: ${u.problems.join("؛ ")}`, ctx);
    return "failed";
  }
  await finishButton(env, claim, UNDO_KEEP);
  await tell(env, expenseUndoneText(rec.billName), ctx);
  return "undone";
}

// ---------------------------------------------------------------- the seam of § 57 ز

/**
 * § 57 ز reads the supplier's tax number from every supplier-invoice image —
 * «مرفق المصروف» among them. This is its hook: called once an expense stands
 * (the bill posted and paid) with its photo attached. The picture is read for
 * the bill's partner (src/supplier-vat.ts readExpenseInvoice: a number written
 * on a card that has none, an alert for one that differs; no form is ever sent
 * from here), and nothing of it throws into the answer.
 */
export async function expensePhotoPosted(env: Env, a: { partnerId: number; moveId: number; mediaId: string; mime: string }): Promise<void> {
  const { readExpenseInvoice } = await import("./supplier-vat");
  await readExpenseInvoice(env, a);
}

// ---------------------------------------------------------------- the reply

export interface ExpenseOutcome {
  action: "recorded" | "failed" | "blocked" | "invalid" | "test" | "off" | "unknown" | "duplicate" | "error";
  moveId?: number;
  paymentId?: number;
  problems?: string[];
}

/** The form's photo, downloaded by its media id (as any inbound media). Null = it could not be read. Never throws. */
async function downloadPhoto(env: Env, mediaId: string): Promise<ExpensePhotoFile | null> {
  try {
    const { downloadMedia } = await import("./supplier-pay");
    return await downloadMedia(env, mediaId);
  } catch (e) {
    console.warn("[expense] the form's photo was not downloaded", (e as Error)?.message);
    return null;
  }
}

/** A reply of the expense form (nfm_reply): read, checked against its token, recorded in Odoo, answered. Never throws. */
export async function handleExpenseReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<ExpenseOutcome> {
  const from = waDigits(msg.from);
  // the owner's form alone: a reply from any other number is read by nothing, and answered by nothing
  if (!isOwnerRecipient(env, from)) {
    console.warn(`[expense] a reply from a number that is not the owner's from=${from.slice(-4)} — ignored`);
    return { action: "unknown" };
  }
  const rec = await readExpenseToken(env, msg.flow?.token ?? "");
  const purpose = rec?.test ? EXPENSE_TEST_PURPOSE : EXPENSE_PURPOSE;
  const say = (text: string, buttons: Array<{ id: string; title: string }> = []) => tell(env, text, ctx, purpose, buttons);
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== from) {
    await say(EXPENSE_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  // a token is read once
  const claim = await claimButton(env, `expense_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn("[expense] repeated token — not recorded again");
    await say(EXPENSE_USED_TEXT);
    return { action: "duplicate" };
  }
  // once the writes may have started the token is never given back: a second «إرسال» would be a second bill
  let writing = false;
  const used = async (): Promise<void> => {
    try { await writeExpenseToken(env, { ...rec, usedAt: nowMs }); await finishButton(env, claim, TOKEN_TTL); } catch { /* the running claim still refuses a repeat */ }
  };
  try {
    // nothing can be recorded here (the form was sent before the setting changed): said before anything is read
    if (!rec.test && !isAccountingSyncEnabled(env)) {
      await used();
      await say(EXPENSE_OFF_TEXT);
      return { action: "off" };
    }
    const read = readExpenseValues(rec, msg.flow?.values ?? {}, riyadhDateKey(new Date(nowMs)));
    // a field that cannot be read: the form is refused whole, with a fresh one
    if (!read.entry) {
      await used();
      const text = ["⚠️ لم يُسجَّل شيء من النموذج:", ...read.problems.map((p) => `• ${EXPENSE_BAD[p]}`), "عبّه من جديد ثم «إرسال» 👇"].join("\n");
      const r = await sendExpenseForm(env, { now: nowMs, ctx, body: text, test: rec.test }).catch(() => ({ sent: false }));
      if (!r.sent) await say(text);
      return { action: "invalid", problems: read.problems };
    }
    const e = read.entry;
    if (rec.test) {
      // read-only: what Odoo holds for this entry — and nothing is written
      const res = await resolveExpense(env, e);
      await used();
      await say("plan" in res ? expenseTestText(e, res.plan, { badVat: read.badVat, photo: !!read.photo }) : `${EXPENSE_TEST_MARK} — ${expenseBlockedText(res.problems, true)}`);
      return { action: "test", ...("problems" in res ? { problems: res.problems } : {}) };
    }
    const res = await resolveExpense(env, e);
    // Odoo lacks an account, a journal or the tax: nothing is written, and the same form can be sent again after the fix
    if ("problems" in res) {
      await releaseButton(env, claim);
      await say(expenseBlockedText(res.problems));
      return { action: "blocked", problems: res.problems };
    }
    const file = read.photo ? await downloadPhoto(env, read.photo.id) : null;
    writing = true;
    const r = await recordExpense(env, e, res.plan, file);
    await used();
    if (!r.ok) {
      await say(expenseFailedText(r));
      return { action: "failed", ...(r.moveId ? { moveId: r.moveId } : {}), problems: r.reasons };
    }
    try { await writeExpenseUndo(env, { v: 1, moveId: r.moveId, paymentId: r.paymentId, billName: r.billName, at: nowMs }); } catch { /* the answer still goes; the button will say it knows no such expense */ }
    // a photo that came and was not downloaded is said as one that was not kept
    const shown: typeof r = read.photo && !file ? { ...r, photo: "failed" } : r;
    await say(expenseDoneText(e, res.plan, shown, read.badVat), [expenseUndoButton(r.moveId)]);
    if (r.photo === "saved" && read.photo) {
      try { await expensePhotoPosted(env, { partnerId: r.supplierId, moveId: r.moveId, mediaId: read.photo.id, mime: file?.mime ?? read.photo.mime ?? "image/jpeg" }); } catch (err) { console.warn("[expense] the photo's hook failed", (err as Error)?.message); }
    }
    return { action: "recorded", moveId: r.moveId, paymentId: r.paymentId };
  } catch (err) {
    console.error("[expense] the reply could not be handled", (err as Error)?.message);
    if (!writing) await releaseButton(env, claim);
    try { await say(writing ? "⚠️ تعذّر إكمال الرد بعد التسجيل: راجع آخر فاتورة في يومية المصاريف في Odoo." : EXPENSE_ERROR_TEXT); } catch { /* nothing more to say */ }
    return { action: "error" };
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE expense form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. Its reply is answered with what
 * would have been recorded, and writes nothing.
 */
export async function sendExpenseFormTest(env: Env, now: number = Date.now()): Promise<ExpenseFormResult> {
  if (!ownerOf(env)) return { sent: false, reason: "no_owner" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `expense_test:${EXPENSE_FLOW_ID}:${day}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    // his window closed: the form does not go (sendExpenseForm), and the day's trial is not spent
    const r = await sendExpenseForm(env, { now, test: true });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
