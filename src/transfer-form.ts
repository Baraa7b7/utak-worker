// § 57 د (2026-10-05) — the customer's «إشعار تحويل»: he says he transferred
// money, for which invoices, how much, when, with the receipt; Baraa says
// whether it reached the account; only then is anything paid.
//
// It DEVELOPS the path of «حولت» (src/pay-claim.ts) and of the receipt image
// (handleCustomerMedia): with an open invoice the customer now gets a form
// instead of «المحصّل بيتأكد»; without one, or when the form cannot go, what
// those two did before stands, word for word.
//
// The Flow (utak_transfer_v1; scripts/lib/s57-transfer-flow.mjs is its JSON) is
// ONE screen with no endpoint — everything it shows goes with the message
// (flow_action navigate): his open invoices as a CheckboxGroup (the oldest
// first, at most twenty), the amount, the date, the reference, ONE PhotoPicker
// and a note.
//
//   • Three doors, all inside his 24h window (an interactive message: never a
//     template, never held): the button «🏦 أرسلت تحويل» under the invoice's
//     free text; a payment-claim text («حولت», «دفعت», …) or «تحويل 🏦» as the
//     whole message; an image or a PDF that Claude reads as a transfer receipt
//     — then the form opens on what was read (amount, date, reference) and the
//     image stays with the form's token, so its own photo is not needed.
//   • «Open» = x_invoice issued or overdue with something left to pay, of an
//     order of THIS customer; never a row flagged x_utak_simulation or
//     x_is_simulation, nor one of an order so flagged. A number of a price
//     source or a supplier (src/price-privacy.ts) never gets the form.
//   • flow_token (tr1.…): one per send, kept in KV with the number. A reply is
//     read by the number it was sent to, once. No invoice ticked, an invoice
//     that is not his or not open any more, an amount that is not a number > 0
//     with at most two decimals, a date that is not a real day or is after
//     today (Riyadh), or NO photo at all (none before the form, none in it):
//     the form is refused as a whole — one message, with a fresh form opened on
//     what he wrote — and nothing is kept.
//   • «إرسال» PAYS NOTHING. The notice is kept in KV thirty days; the receipt
//     is attached to each chosen invoice (one note with the file in the log of
//     its account.move when it has one, else an ir.attachment on the x_invoice
//     row, which has no log); the customer reads «وصلنا إشعار تحويلك بمبلغ X —
//     نأكد لك أول ما يوصل الحساب»; Baraa gets the customer, the invoices, the
//     amount, the date, the reference and the image, with «✅ وصل» / «❌ ما وصل».
//   • «✅ وصل» (Baraa's number alone, once): the amount goes over the chosen
//     invoices, the oldest first, each up to what is left on it, by the
//     collection's own recordCollection (x_payment, method transfer, dated the
//     day of the transfer) — so the custom ledger, the invoice's state, the
//     18:00 list and the receipt of each row stay as any collection's. What is
//     left over is the customer's credit: it is never put on an invoice he did
//     not tick. With ACCOUNTING_SYNC: ONE account.payment for the whole
//     transfer on BNK1 (src/accounting.ts syncTransferToAccounting).
//   • «❌ ما وصل»: nothing is written; the customer reads one fixed text.
//   • A second tap on either button: «سبق تسجيله», and nothing is written.
//   • The amounts are his own invoices' (the sale side): no purchase price, no
//     cost and no profit is read, kept or sent here.
//
// § 58 ب (2026-10-05) — ONE source for every transfer. Every way a transfer is
// said files, or updates, ONE notice: the customer's form (and the image, which
// opens it), the collector's «تحويل 🏦» of a collection request, the delivery
// form's «تحويل». None of them pays anything: the payment on BNK1 is made in
// one place, Baraa's «✅ وصل».
//   • A notice names its sources (who said it, when, how much). The collector's
//     has no receipt image: Baraa reads «المصدر: المحصّل …», and the collector
//     reads «تمام، سجّلناه — ينتظر تأكيد وصول المبلغ».
//   • A second notice on an invoice that has an OPEN notice (not decided yet) is
//     linked to the first: no second «✅ وصل» is asked, Baraa reads the two
//     sources in one line-by-line message, and the first message's buttons stay
//     the only ones. The customer's own figures (he made the transfer: its
//     amount, day, reference, invoices and image) stand over a collector's;
//     between two of the same kind the first's stand. A different amount is
//     said, with the one «✅ وصل» will record.
//   • The last guard is the collection's own (src/invoice.ts recordCollection):
//     an invoice with nothing left, or less than the amount, never takes the
//     excess — «✅ وصل» says each such invoice with its two amounts in Baraa's
//     one message, so one payment or none is made on an invoice, never two.
// § 58 أ — after «✅ وصل» the customer reads ONE message: «استلمنا تحويلك X ريال
// ✅ وسددنا: فاتورة Y (مبلغ)، فاتورة Z (مبلغ)» with each receipt's link. The
// receipts are issued here (src/receipt.ts issueReceiptForRecord), and the
// per-payment confirmation sends nothing for such a row (src/payment-confirm.ts).

import type { Env } from "./config";
import { SYSTEM_PROMPT_READ_TRANSFER_RECEIPT } from "./config";
import type { NormalizedMessage } from "./types";
import type { RouterReply } from "./router";
import { call, getInvoiceById, getOrderCustomer } from "./odoo";
import { readDocumentJson } from "./claude";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { fmtSar } from "./collect-pay";
import { parseCustodyAmount } from "./custody-form";
import { readReceiptPhotos } from "./receipt-form";
import { priceClosedNumber } from "./price-privacy";

/** utak_transfer_v1 at Meta, published 2026-10-05 (a published Flow's JSON is frozen). */
export const TRANSFER_FLOW_ID = "1089772170263768";
export const TRANSFER_FLOW_SCREEN = "TRANSFER_A";
/** The form, and the answers to the customer's own «إرسال». */
export const TRANSFER_PURPOSE = "customer_transfer_form";
/** Baraa's decision as the customer reads it (hours after his notice, maybe outside his window). */
export const TRANSFER_DECISION_PURPOSE = "customer_transfer_decision";
/** The notice to Baraa with its two buttons, and what he reads after a tap (his number alone). */
export const TRANSFER_OWNER_PURPOSE = "owner_transfer_notice";
/** The one trial to Baraa and its answers (his number alone). */
export const TRANSFER_TEST_PURPOSE = "transfer_form_test";
/** The button under the invoice's free text. */
export const TRANSFER_BUTTON = "transfer_notice";
export const TRANSFER_BUTTON_TITLE = "🏦 أرسلت تحويل";
export const TRANSFER_CTA = "إشعار تحويل";
export const TRANSFER_TITLE = "إشعار تحويل";
export const TRANSFER_TEST_MARK = "🧪 تجربة";
export const TRANSFER_OK_TITLE = "✅ وصل";
export const TRANSFER_NO_TITLE = "❌ ما وصل";
/** Baraa's two buttons: trn_ok_<notice> / trn_no_<notice>. */
export const TRANSFER_DECISION_RE = /^trn_(ok|no)_([a-f0-9]{10})$/;
/** Meta: a CheckboxGroup takes at most twenty options — the oldest twenty. */
export const TRANSFER_INVOICES_MAX = 20;
/** The trial lists a few of the oldest real open invoices. */
export const TRANSFER_TEST_ROWS = 5;
/** A notice waits for Baraa's decision this long. */
export const TRANSFER_KEEP_SEC = 30 * 24 * 60 * 60;
/** Meta's limits: a heading, an option's title and description, a message's body. */
export const TRANSFER_HEADING_MAX = 80;
export const TRANSFER_OPTION_TITLE_MAX = 30;
export const TRANSFER_OPTION_DESCRIPTION_MAX = 300;
export const TRANSFER_BODY_MAX = 1024;
export const TRANSFER_NOTE_MAX = 500;
export const TRANSFER_REFERENCE_MAX = 64;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
/** Never an «open invoice»: a trial's row, and every row the sim / pilot worker made. */
const SIM_FIELDS = ["x_utak_simulation", "x_is_simulation"] as const;

// ---------------------------------------------------------------- texts

/** «إرسال» was read: nothing is paid yet. */
export const transferReceivedText = (amount: number): string => `وصلنا إشعار تحويلك بمبلغ ${fmtSar(amount)} ر.س — نأكد لك أول ما يوصل الحساب`;
/** § 58 ب — what a collector reads after his «تحويل 🏦»: nothing is paid until «✅ وصل». */
export const COLLECTOR_NOTICED_TEXT = "تمام، سجّلناه — ينتظر تأكيد وصول المبلغ";
/** § 58 أ — the trial of the ONE message of «✅ وصل» to Baraa (his number alone). */
export const TRANSFER_CONFIRMED_TEST_PURPOSE = "transfer_confirmed_test";
export const TRANSFER_NOT_ARRIVED_TEXT = "ما وصلنا التحويل للحين. لو حوّلت أرسل لنا صورة إيصال واضحة، أو انتظر يوم عمل ونراجع مرة ثانية";
export const TRANSFER_ALREADY_TEXT = "سبق تسجيله";
export const TRANSFER_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «تحويل» ونرسل لك نموذجاً جديداً.";
export const TRANSFER_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. لإشعار جديد اكتب «تحويل».";
export const TRANSFER_NONE_TEXT = "ما عليك فواتير مفتوحة عندنا الآن ✅";
export const TRANSFER_FAILED_TEXT = "تعذّر إرسال نموذج إشعار التحويل الآن. أرسل لنا صورة الإيصال هنا ونتابعها معك.";
export const TRANSFER_HOW_TEXT = "اختر الفواتير اللي حوّلت لها، واكتب المبلغ والتاريخ، وأرفق صورة الإيصال، ثم «إرسال».";
export const TRANSFER_HOW_WITH_PHOTO_TEXT = "صورة إيصالك وصلتنا ✅ اختر الفواتير اللي حوّلت لها، وتأكد من المبلغ والتاريخ، ثم «إرسال».";
export const TRANSFER_BAD_INVOICES_TEXT = "اختر فاتورة واحدة على الأقل من فواتيرك المفتوحة.";
export const TRANSFER_GONE_INVOICE_TEXT = "فاتورة اخترتها لم تعد مفتوحة عندنا";
export const TRANSFER_BAD_AMOUNT_TEXT = "المبلغ المحوّل رقم أكبر من صفر، بخانتين عشريتين على الأكثر.";
export const TRANSFER_BAD_DATE_TEXT = "تاريخ التحويل يوم صحيح: اليوم أو قبله.";
export const TRANSFER_NO_PHOTO_TEXT = "أرفق صورة الإيصال في النموذج.";
export const TRANSFER_NOTICE_GONE_TEXT = "هذا الإشعار لم يعد محفوظاً (مرّ عليه أكثر من 30 يوماً): لم يُسجَّل شيء. سجّل الدفعة من Odoo.";
export const TRANSFER_RETRY_TEXT = "تعذّر تسجيل القرار الآن. اضغط الزر مرة ثانية بعد قليل.";
export const TRANSFER_UNREAD_TEXT = "ℹ️ لم يُقرأ من الصورة شيء: راجعها بنفسك.";
export const TRANSFER_NO_IMAGE_TEXT = "(الصورة لم تُرفق هنا: تجدها على الفاتورة في Odoo)";
export const TRANSFER_POSTED_TEXT = "القيد: دفعة واحدة على البنك (BNK1)، تنتظر مطابقتها مع سطر الكشف.";
export const TRANSFER_NOT_POSTED_TEXT = "⚠️ لم تُسجَّل الدفعة في المحاسبة (وصلك السبب في تنبيه): سجّلها يدوياً على BNK1.";

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const round2 = (n: number): number => Math.round(n * 100) / 100;
const oneLine = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
/** «3 أكتوبر 2026», or «-» for a day that is not one. */
const dayText = (ymd: string): string => (ymd ? arabicDate(ymd) : "-");
export const transferNoticeButton = (): { id: string; title: string } => ({ id: TRANSFER_BUTTON, title: TRANSFER_BUTTON_TITLE });
/** «TRN-1a2b3c4d5e»: the notice as the payment rows and the bank memo name it. */
export const noticeRef = (id: string): string => `TRN-${id}`;

// ---------------------------------------------------------------- his open invoices

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);

export interface OpenInvoice {
  id: number;
  number: string;
  /** x_invoice_date (YYYY-MM-DD), "" when it has none. */
  date: string;
  total: number;
  /** The total less every payment on it. */
  remaining: number;
  /** Its accounting twin (x_account_move_id), when it has one. */
  moveId: number | null;
  customerId: number;
  customer: string;
}

/**
 * The open invoices of one customer — or of everyone (`partnerId` null: the
 * trial's rows) — the oldest first, at most `limit`: issued or overdue, with
 * something left to pay, and not simulation by either flag, on the invoice or
 * on its order. Read-only. Throws on Odoo trouble.
 */
export async function openInvoices(env: Env, partnerId: number | null, limit: number = TRANSFER_INVOICES_MAX): Promise<OpenInvoice[]> {
  type Inv = { id: number; x_invoice_number: string | false; x_total: number | false; x_invoice_date: string | false; x_order_id: M2O; x_account_move_id: M2O };
  const invs = await call<Inv[]>(env, "x_invoice", "search_read", {
    domain: [
      ["x_status", "in", ["issued", "overdue"]], ...SIM_FIELDS.map((f) => [f, "!=", true]),
      ...(partnerId ? [["x_order_id.x_customer_id", "=", partnerId]] : []),
    ],
    fields: ["id", "x_invoice_number", "x_total", "x_invoice_date", "x_order_id", "x_account_move_id"],
    order: "x_invoice_date asc, id asc", limit: 200,
  });
  if (!invs.length) return [];
  type Order = { id: number; x_customer_id: M2O } & Record<string, unknown>;
  const orders = await call<Order[]>(env, "x_daily_order", "read", {
    ids: [...new Set(invs.map((i) => m2oId(i.x_order_id)).filter(Boolean))], fields: ["id", "x_customer_id", ...SIM_FIELDS],
  });
  const byOrder = new Map(orders.map((o) => [o.id, o]));
  // an invoice of a simulation order is a simulation's, whatever its own flags say
  const real = invs.filter((i) => { const o = byOrder.get(m2oId(i.x_order_id)); return !!o && !SIM_FIELDS.some((f) => o[f] === true); });
  if (!real.length) return [];
  const pays = await call<Array<{ id: number; x_invoice_id: M2O; x_amount: number | false }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "in", real.map((i) => i.id)]], fields: ["id", "x_invoice_id", "x_amount"], limit: 5000,
  });
  const paid = new Map<number, number>();
  for (const p of pays) paid.set(m2oId(p.x_invoice_id), (paid.get(m2oId(p.x_invoice_id)) ?? 0) + (Number(p.x_amount) || 0));
  return real
    .map((i): OpenInvoice => {
      const o = byOrder.get(m2oId(i.x_order_id))!;
      const total = round2(Number(i.x_total) || 0);
      return {
        id: i.id, number: String(i.x_invoice_number || `#${i.id}`), date: typeof i.x_invoice_date === "string" ? i.x_invoice_date.slice(0, 10) : "",
        total, remaining: round2(total - (paid.get(i.id) ?? 0)), moveId: m2oId(i.x_account_move_id) || null,
        customerId: m2oId(o.x_customer_id), customer: Array.isArray(o.x_customer_id) ? oneLine(o.x_customer_id[1]) : "",
      };
    })
    .filter((i) => i.remaining > 0.005)
    // the oldest first: by its date (an invoice with none goes last), then by its id
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id - b.id)
    .slice(0, limit);
}

/** The amount over the chosen invoices as given (the oldest first), each up to what is left on it; the rest is the excess. */
export function allocateTransfer(invoices: Array<Pick<OpenInvoice, "id" | "number" | "remaining">>, amount: number): { rows: Array<{ invoiceId: number; number: string; amount: number; paid: boolean }>; excess: number } {
  let left = round2(amount);
  const rows: Array<{ invoiceId: number; number: string; amount: number; paid: boolean }> = [];
  for (const i of invoices) {
    if (left <= 0.005) break;
    const share = round2(Math.min(left, i.remaining));
    if (!(share > 0)) continue;
    rows.push({ invoiceId: i.id, number: i.number, amount: share, paid: share + 0.005 >= i.remaining });
    left = round2(left - share);
  }
  return { rows, excess: Math.max(0, left) };
}

/** An invoice's number without the prefix every one of them has: a title holds thirty characters. */
export const shortNumber = (n: string): string => String(n ?? "").replace(/^UTAK-INV-/, "");
/** One option of the list: the number and what is left in its title, the whole line in its description. */
export function invoiceOption(i: OpenInvoice, o: { withCustomer?: boolean } = {}): { id: string; title: string; description: string } {
  const tail = ` · ${fmtSar(i.remaining)} ر.س`;
  return {
    id: String(i.id),
    // the amount is never the part that is cut
    title: `${cut(shortNumber(i.number), TRANSFER_OPTION_TITLE_MAX - chars(tail).length)}${tail}`,
    description: cut([
      i.number, ...(o.withCustomer && i.customer ? [i.customer] : []), ...(i.date ? [arabicDate(i.date)] : []),
      `الإجمالي ${fmtSar(i.total)} ر.س`, `المتبقي ${fmtSar(i.remaining)} ر.س`,
    ].join(" — "), TRANSFER_OPTION_DESCRIPTION_MAX),
  };
}

// ---------------------------------------------------------------- the receipt, read

export interface TransferMedia { id: string; mime: string }
/** No date read from a receipt is older than this (every Hijri year is). */
export const RECEIPT_DATE_FLOOR = "2000-01-01";
/** What Claude read from a receipt: each field only when it was read. */
export interface ReceiptRead { amount?: number; date?: string; reference?: string }

/** «المبلغ المحوّل»: a number > 0 with at most two decimals — nothing else. */
export function parseTransferAmount(raw: unknown): number | "invalid" {
  const n = parseCustodyAmount(raw);
  return n === "invalid" || !(n > 0) ? "invalid" : n;
}
/** «تاريخ التحويل»: YYYY-MM-DD, a real day, not after `today` (Riyadh). */
export function parseTransferDate(raw: unknown, today: string): string | "invalid" {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "invalid";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // «2026-02-30» rolls over to March: not a day
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return "invalid";
  return s > today ? "invalid" : s;
}
/** A reference as printed: one line, no spaces around it, within the room a memo gives it. */
export const cleanReference = (raw: unknown): string => (typeof raw === "string" || typeof raw === "number" ? cut(oneLine(raw), TRANSFER_REFERENCE_MAX) : "");
/** The invoices ticked: the ids of a CheckboxGroup's reply, each once. */
export function parseChosen(raw: unknown): number[] {
  const ids = (Array.isArray(raw) ? raw : []).map((v) => (typeof v === "string" || typeof v === "number" ? Number(v) : NaN)).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/**
 * An image or a PDF read by Claude: null when it is NOT a transfer receipt, or
 * was not read at all (the caller does what it did before). A field Claude
 * could not read, or read as something it cannot be, is left out. Never throws.
 */
export async function readTransferReceipt(env: Env, file: { base64: string; mime: string }, today: string = riyadhDateKey()): Promise<ReceiptRead | null> {
  const j = await readDocumentJson(env, file, SYSTEM_PROMPT_READ_TRANSFER_RECEIPT);
  if (!j || j.receipt !== true) return null;
  const amount = parseTransferAmount(typeof j.amount === "number" ? round2(j.amount) : j.amount), date = parseTransferDate(j.date, today), reference = cleanReference(j.reference);
  // a Hijri day read as a Gregorian one («1448-04-21») is a real date fourteen centuries ago: never the form's opening date
  const dated = date !== "invalid" && date >= RECEIPT_DATE_FLOOR;
  return { ...(amount !== "invalid" ? { amount } : {}), ...(dated ? { date } : {}), ...(reference ? { reference } : {}) };
}

// ---------------------------------------------------------------- flow_token

export interface TransferToken {
  v: 1;
  token: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  name: string;
  createdAt: number;
  /** A receipt that came before the form: its media at Meta, and what was read from it. */
  media?: TransferMedia;
  read?: ReceiptRead;
  /** The trial to Baraa: its reply is checked against the rows it showed, and keeps nothing. */
  test?: boolean;
  rows?: OpenInvoice[];
  usedAt?: number;
}
export const transferTokenKey = (token: string): string => `transfer_t:v1:${token}`;
export const isTransferToken = (token: string): boolean => String(token ?? "").startsWith("tr1.");
export function newTransferToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `tr1.${partnerId}.${rand}`;
}
export async function readTransferToken(env: Env, token: string): Promise<TransferToken | null> {
  if (!isTransferToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(transferTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as TransferToken) : null;
    return rec && rec.v === 1 && typeof rec.to === "string" ? rec : null;
  } catch { return null; }
}
async function writeTransferToken(env: Env, rec: TransferToken): Promise<void> {
  await env.MSG_DEDUP.put(transferTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the notice (KV)

/** One invoice's share of a confirmed transfer: its x_payment, and whether the invoice is paid with it. */
export interface TransferRow { invoiceId: number; number: string; paymentId: number; amount: number; paid: boolean; receiptUrl?: string }
/** § 58 ب — who said a transfer was made. */
export type TransferBy = "customer" | "collector";
export interface TransferSource {
  by: TransferBy;
  /** The customer's name, or the collector's. */
  name: string;
  at: number;
  /** The amount this source named, and the invoices (their numbers). */
  amount: number;
  invoices: string[];
}
export interface TransferNotice {
  v: 1;
  id: string;
  /** When the first source was read. */
  at: number;
  partnerId: number;
  name: string;
  /** The customer's number (digits): where Baraa's decision goes. */
  to: string;
  /** The invoices he ticked, the oldest first, with what was left on each then. */
  invoices: Array<{ id: number; number: string; remaining: number }>;
  amount: number;
  /** The day of the transfer, YYYY-MM-DD. */
  date: string;
  reference: string;
  note: string;
  /** The receipt (a customer's notice always has one; a collector's has none). */
  media?: TransferMedia;
  /** § 58 ب — everyone who said it, the first first (a notice of before § 58 has none: its customer). */
  sources?: TransferSource[];
  /** Baraa's decision, once: what «✅ وصل» recorded is in Odoo (the x_payment rows that name this notice). */
  decided?: { how: "ok" | "no"; at: number; excess?: number };
}
export const transferNoticeKey = (id: string): string => `transfer_notice:v1:${id}`;
export const newNoticeId = (): string => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function readTransferNotice(env: Env, id: string): Promise<TransferNotice | null> {
  try {
    const raw = await env.MSG_DEDUP.get(transferNoticeKey(id));
    const rec = raw ? (JSON.parse(raw) as TransferNotice) : null;
    return rec && rec.v === 1 && typeof rec.amount === "number" ? rec : null;
  } catch { return null; }
}
async function writeTransferNotice(env: Env, rec: TransferNotice): Promise<void> {
  await env.MSG_DEDUP.put(transferNoticeKey(rec.id), JSON.stringify(rec), { expirationTtl: TRANSFER_KEEP_SEC });
}

// ---------------------------------------------------------------- § 58 ب: one notice an invoice

export const sourcesOf = (n: TransferNotice): TransferSource[] =>
  (n.sources?.length ? n.sources : [{ by: "customer", name: n.name, at: n.at, amount: n.amount, invoices: n.invoices.map((i) => i.number) }]);
export const sourceLabel = (s: Pick<TransferSource, "by" | "name">): string => (s.by === "customer" ? "العميل" : `المحصّل${s.name ? ` ${s.name}` : ""}`);
/** «• المحصّل عمر — 300 ر.س — الساعة 10:20». */
export const sourceLine = (s: TransferSource): string => `• ${sourceLabel(s)} — ${fmtSar(s.amount)} ر.س — الساعة ${riyadhHHMM(new Date(s.at))}`;
/** The open notice of an invoice: the id of the notice that waits for Baraa's decision on it. */
export const transferOpenKey = (invoiceId: number): string => `transfer_open:v1:${invoiceId}`;
/** The notice that still waits for «✅ وصل» / «❌ ما وصل» on one of these invoices (the first found), or null. */
export async function openNoticeOn(env: Env, invoiceIds: number[]): Promise<TransferNotice | null> {
  for (const id of invoiceIds) {
    let noticeId: string | null = null;
    try { noticeId = await env.MSG_DEDUP.get(transferOpenKey(id)); } catch { noticeId = null; }
    if (!noticeId) continue;
    const n = await readTransferNotice(env, noticeId);
    // a decided notice is not open any more: the next transfer on its invoice is a notice of its own
    if (n && !n.decided) return n;
  }
  return null;
}
async function markOpen(env: Env, n: TransferNotice): Promise<void> {
  for (const i of n.invoices) await env.MSG_DEDUP.put(transferOpenKey(i.id), n.id, { expirationTtl: TRANSFER_KEEP_SEC });
}
/** What a source says: the notice's own fields, and who says them. */
export interface NoticeDraft extends Omit<TransferNotice, "v" | "id" | "at" | "decided" | "sources"> { source: TransferSource }
export interface PlannedNotice {
  notice: TransferNotice;
  /** An open notice already stood on one of its invoices: this source was added to it. */
  linked: boolean;
  /** The customer's figures took the place of a collector's. */
  replaced: boolean;
}
/**
 * The notice a source files: a new one — or, when one of its invoices has an
 * OPEN notice, that one with this source added (no second notice, so no second
 * «✅ وصل»). The customer's figures stand over a collector's; between two of
 * the same kind the first's stand. Nothing is written here: the caller writes
 * the notice, then marks its invoices (keepNotice).
 */
export async function planTransferNotice(env: Env, d: NoticeDraft, nowMs: number): Promise<PlannedNotice> {
  const { source, ...fields } = d;
  const first = await openNoticeOn(env, d.invoices.map((i) => i.id));
  if (!first) return { notice: { v: 1, id: newNoticeId(), at: nowMs, ...fields, sources: [source] }, linked: false, replaced: false };
  const before = sourcesOf(first);
  const replaced = source.by === "customer" && !before.some((s) => s.by === "customer");
  const notice: TransferNotice = replaced
    ? { ...first, ...fields, reference: fields.reference || first.reference, media: fields.media ?? first.media, sources: [...before, source] }
    : { ...first, reference: first.reference || fields.reference, media: first.media ?? fields.media, sources: [...before, source] };
  return { notice, linked: true, replaced };
}

// ---------------------------------------------------------------- the send

export interface TransferWho { partnerId: number; name: string; whatsapp: string }
/** What the fields open with: a receipt read before the form, or what he wrote on a form that was refused. */
export interface TransferInit { sel?: number[]; amt?: string; date?: string; ref?: string; note?: string }
export interface TransferFormOpts {
  now?: number;
  /** The text above the button (a refusal's reasons): else the form's own. */
  body?: string;
  /** His open invoices, when the caller has just read them (the trial: the rows it shows). */
  invoices?: OpenInvoice[];
  media?: TransferMedia;
  read?: ReceiptRead;
  init?: TransferInit;
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface TransferFormResult { sent: boolean; reason?: string; token?: string; invoices?: number }

/** The screen's nine keys. */
export function transferData(who: TransferWho, invoices: OpenInvoice[], day: string, o: Pick<TransferFormOpts, "media" | "read" | "init" | "test"> = {}): Record<string, unknown> {
  const mark = o.test ? `${TRANSFER_TEST_MARK} — ` : "";
  const listed = new Set(invoices.map((i) => i.id));
  return {
    t: cut(`${mark}${TRANSFER_TITLE} — ${who.name}`, TRANSFER_HEADING_MAX),
    how: o.media ? TRANSFER_HOW_WITH_PHOTO_TEXT : TRANSFER_HOW_TEXT,
    // the trial lists everyone's invoices (or samples): each says whose it is
    invs: invoices.map((i) => invoiceOption(i, { withCustomer: o.test })),
    // nothing is ticked for him — but his only open invoice, where there is nothing to choose
    sel: (o.init?.sel ?? (invoices.length === 1 ? [invoices[0].id] : [])).filter((id) => listed.has(id)).map(String),
    amt: o.init?.amt ?? (o.read?.amount !== undefined ? fmtSar(o.read.amount) : ""),
    d: o.init?.date ?? o.read?.date ?? day,
    max: day,
    ref: o.init?.ref ?? o.read?.reference ?? "",
    note: o.init?.note ?? "",
  };
}
export function transferSession(text: string, token: string, data: Record<string, unknown>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, TRANSFER_BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: TRANSFER_FLOW_ID,
            flow_cta: TRANSFER_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: TRANSFER_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}
/** «المبلغ 500 ر.س · التاريخ 3 أكتوبر 2026 · المرجع FT123»: what was read, each part only when it was. */
export function readLine(r: ReceiptRead): string {
  return [...(r.amount !== undefined ? [`المبلغ ${fmtSar(r.amount)} ر.س`] : []), ...(r.date ? [`التاريخ ${arabicDate(r.date)}`] : []), ...(r.reference ? [`المرجع ${r.reference}`] : [])].join(" · ");
}
/** The text above the form's button. */
export function transferFormText(o: Pick<TransferFormOpts, "media" | "read"> = {}): string {
  const read = o.read ? readLine(o.read) : "";
  return [
    `🏦 ${TRANSFER_TITLE}`,
    ...(read ? [`قرأنا من إيصالك: ${read}. راجعها في النموذج وصحّحها لو لزم.`] : []),
    `اضغط «${TRANSFER_CTA}»: ${o.media ? TRANSFER_HOW_WITH_PHOTO_TEXT : TRANSFER_HOW_TEXT}`,
  ].join("\n");
}

/**
 * One transfer-notice form: the interactive message, inside the number's window
 * only. Nothing is held and no template is used. Not sent — and it says why —
 * to a number of a price source or a supplier, outside the window, or to a
 * customer with no open invoice. Throws on Odoo trouble (the caller says the
 * form could not go, or does what it did before).
 */
export async function sendTransferForm(env: Env, who: TransferWho, opts: TransferFormOpts = {}): Promise<TransferFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  // a customer's form: never to a price source or a supplier, whatever partner the caller named
  if (!opts.test && (await priceClosedNumber(env, to))) return { sent: false, reason: "closed_number" };
  const now = opts.now ?? Date.now();
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const invoices = opts.invoices ?? (await openInvoices(env, who.partnerId));
  if (!invoices.length) return { sent: false, reason: "no_open_invoice" };
  const rec: TransferToken = {
    v: 1, token: newTransferToken(who.partnerId), to, partnerId: who.partnerId, name: who.name, createdAt: now,
    ...(opts.media ? { media: opts.media } : {}), ...(opts.read ? { read: opts.read } : {}),
    ...(opts.test ? { test: true, rows: invoices } : {}),
  };
  await writeTransferToken(env, rec);
  const mark = opts.test ? `${TRANSFER_TEST_MARK} — ` : "";
  const res = await sendViaGateway(env, {
    purpose: opts.test ? TRANSFER_TEST_PURPOSE : TRANSFER_PURPOSE,
    to,
    content: transferSession(`${mark}${opts.body ?? transferFormText(opts)}`, rec.token, transferData(who, invoices, riyadhDateKey(new Date(now)), opts)),
    noHold: true,
    noHoldReason: "نموذج إشعار التحويل يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(transferTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token, invoices: invoices.length };
}

// ---------------------------------------------------------------- the three doors

async function tell(env: Env, to: string, text: string, ctx?: ExecutionContext, purpose: string = TRANSFER_PURPOSE): Promise<void> {
  await sendViaGateway(env, { purpose, to, content: textContent(text), ctx });
}

/** The form for a customer who said he transferred. Never throws: what could not go is a reason, and the caller's old answer stands. */
export async function offerTransferForm(env: Env, who: TransferWho, opts: TransferFormOpts = {}): Promise<TransferFormResult> {
  try {
    return await sendTransferForm(env, who, opts);
  } catch (e) {
    console.warn("[transfer] the form could not be sent", (e as Error)?.message);
    return { sent: false, reason: "error" };
  }
}

/** «🏦 أرسلت تحويل» under the invoice's text: the form; with nothing open, or when it cannot go, one line. */
export async function answerTransferButton(env: Env, partner: { id: number; name?: string; x_whatsapp_number?: string | false | null } | null): Promise<RouterReply> {
  const number = String(partner?.x_whatsapp_number || "");
  if (!partner?.id || !number) return { text: TRANSFER_FAILED_TEXT };
  const r = await offerTransferForm(env, { partnerId: partner.id, name: partner.name || "", whatsapp: number });
  return { text: r.sent ? "" : r.reason === "no_open_invoice" ? TRANSFER_NONE_TEXT : TRANSFER_FAILED_TEXT };
}

/**
 * A customer's image or PDF: when he has an open invoice and Claude reads it as
 * a transfer receipt, the form goes, opened on what was read, and the image
 * stays with its token. False — he owes nothing (Claude is not asked), the file
 * could not be fetched, it is not a receipt, the form could not go: the media's
 * old answer stands. Never throws.
 */
export async function offerTransferFormFromMedia(env: Env, customer: { id: number; name?: string }, from: string, media: { id: string }, ctx?: ExecutionContext): Promise<boolean> {
  try {
    const invoices = await openInvoices(env, customer.id);
    if (!invoices.length) return false;
    const { downloadMedia } = await import("./supplier-pay");
    const file = await downloadMedia(env, media.id);
    if (!file) return false;
    const read = await readTransferReceipt(env, file);
    if (!read) return false;
    return (await sendTransferForm(env, { partnerId: customer.id, name: customer.name || "", whatsapp: from }, { ctx, invoices, media: { id: media.id, mime: file.mime }, read })).sent;
  } catch (e) {
    console.warn("[transfer] the media was not read as a receipt", (e as Error)?.message);
    return false;
  }
}

// ---------------------------------------------------------------- «إرسال»

/** A line an invoice: its number and what was left on it when he sent the notice. */
const invoicesLine = (list: Array<{ number: string; remaining: number }>): string[] => list.map((i) => `• ${i.number} — المتبقي ${fmtSar(i.remaining)} ر.س`);
/** The amount against what is left on the ticked invoices: what Baraa wants to know before he taps. */
export function coverText(amount: number, invoices: Array<{ remaining: number }>): string {
  const due = round2(invoices.reduce((s, i) => s + i.remaining, 0)), diff = round2(amount - due);
  if (diff === 0) return "يطابق المتبقي على المختارة";
  return diff > 0 ? `يزيد عن المتبقي على المختارة بـ ${fmtSar(diff)} ر.س` : `أقل من المتبقي على المختارة بـ ${fmtSar(-diff)} ر.س`;
}
/** What the image says against what he wrote: his own figures stand, and Baraa reads the difference. "" when they agree. */
export function mismatchLine(typed: { amount: number; date: string }, said: ReceiptRead | null | undefined): string {
  const parts = [
    ...(said?.amount !== undefined && Math.abs(said.amount - typed.amount) > 0.005 ? [`المبلغ ${fmtSar(said.amount)} ر.س (كتب ${fmtSar(typed.amount)} ر.س)`] : []),
    ...(said?.date && said.date !== typed.date ? [`التاريخ ${arabicDate(said.date)} (كتب ${arabicDate(typed.date)})`] : []),
  ];
  return parts.length ? `⚠️ الصورة تقول غير ما كتب: ${parts.join(" · ")}` : "";
}
/** Baraa's message: the customer, the invoices, the amount, the date, the reference — within a button message's 1024 characters. */
export function ownerNoticeText(n: Pick<TransferNotice, "name" | "invoices" | "amount" | "date" | "reference" | "note">, extra: string[] = []): string {
  const build = (list: string[]): string => [
    `🏦 ${TRANSFER_TITLE} — ${n.name}`,
    ...list,
    `المبلغ المحوّل: ${fmtSar(n.amount)} ر.س (${coverText(n.amount, n.invoices)})`,
    `تاريخ التحويل: ${dayText(n.date)}`,
    `المرجع: ${n.reference || "لم يُذكر"}`,
    ...(n.note ? [`ملاحظته: ${n.note}`] : []),
    ...extra.filter(Boolean),
    "وصل الحساب؟ 👇",
  ].join("\n");
  const full = build(["الفواتير:", ...invoicesLine(n.invoices)]);
  if (chars(full).length <= TRANSFER_BODY_MAX) return full;
  // many invoices: their numbers on one line, so the amount, the date and the reference are never the part that is cut
  return cut(build([`الفواتير (${n.invoices.length}): ${cut(n.invoices.map((i) => shortNumber(i.number)).join("، "), 400)}`]), TRANSFER_BODY_MAX);
}
function ownerNoticeSession(n: TransferNotice, text: string, withMedia: boolean): GwSession {
  // § 58 ب — a collector's notice has no receipt: no header, and no line about an image that is not there
  const media = n.media;
  const header = !media ? null : /pdf/i.test(media.mime) ? { type: "document", document: { id: media.id, filename: `إيصال-${noticeRef(n.id)}.pdf` } } : { type: "image", image: { id: media.id } };
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "button",
        ...(withMedia && header ? { header } : {}),
        body: { text: cut(withMedia || !media ? text : `${text}\n${TRANSFER_NO_IMAGE_TEXT}`, TRANSFER_BODY_MAX) },
        action: { buttons: [
          { type: "reply", reply: { id: `trn_ok_${n.id}`, title: TRANSFER_OK_TITLE } },
          { type: "reply", reply: { id: `trn_no_${n.id}`, title: TRANSFER_NO_TITLE } },
        ] },
      },
    },
  };
}
/** The notice to Baraa: with the receipt as its header (the media Meta already holds), and without it when Meta refuses that. */
async function sendOwnerNotice(env: Env, n: TransferNotice, text: string, ctx?: ExecutionContext): Promise<void> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return;
  const res = await sendViaGateway(env, { purpose: TRANSFER_OWNER_PURPOSE, to: owner, content: ownerNoticeSession(n, text, true), ctx });
  if (gatewayDecision(res)?.action !== "rejected" || !n.media) return;
  console.warn(`[transfer] notice ${n.id}: Meta refused the receipt as a header — sent without it`);
  await sendViaGateway(env, { purpose: TRANSFER_OWNER_PURPOSE, to: owner, content: ownerNoticeSession(n, text, false), ctx });
}

/** § 58 ب — «المصدر: المحصّل عمر — بلا صورة إيصال»: under a notice only a collector filed. */
export const collectorSourceText = (name: string): string => `المصدر: ${sourceLabel({ by: "collector", name })} — بلا صورة إيصال`;
/** § 58 ب — what Baraa reads when a second source is linked to an open notice: the two sources, and what «✅ وصل» will record. */
export function linkedNoticeText(p: Pick<PlannedNotice, "notice" | "replaced">, extra: string[] = []): string {
  const n = p.notice, src = sourcesOf(n);
  const differ = new Set(src.map((x) => fmtSar(x.amount))).size > 1;
  return cut([
    `🔗 مصدر ثانٍ لإشعار تحويل — ${n.name} (${noticeRef(n.id)})`,
    ...src.map(sourceLine),
    `الفواتير: ${n.invoices.map((i) => shortNumber(i.number)).join("، ")}`,
    ...(differ ? [`⚠️ المبالغ مختلفة: «${TRANSFER_OK_TITLE}» يسجّل ${fmtSar(n.amount)} ر.س (${p.replaced ? "مبلغ العميل" : "مبلغ الإشعار الأول"})`] : []),
    ...extra.filter(Boolean),
    `رُبط بالإشعار الأول: لا تأكيد ثانٍ، ودفعة واحدة فقط — القرار من رسالته الأولى.`,
  ].join("\n"), TRANSFER_BODY_MAX);
}
/** The second source to Baraa: no button (the first message's two are the only ones); with the receipt when this source brought one. */
async function sendOwnerLinked(env: Env, p: PlannedNotice, media: TransferMedia | undefined, extra: string[], ctx?: ExecutionContext): Promise<void> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return;
  const text = linkedNoticeText(p, extra);
  if (media) {
    const body = /pdf/i.test(media.mime) ? { type: "document", document: { id: media.id, filename: `إيصال-${noticeRef(p.notice.id)}.pdf`, caption: text } } : { type: "image", image: { id: media.id, caption: text } };
    const sent = gatewayDecision(await sendViaGateway(env, { purpose: TRANSFER_OWNER_PURPOSE, to: owner, content: { kind: "session", body }, ctx }));
    // Meta refused the receipt as it stands: the two sources still reach him, as text
    if (sent?.action !== "rejected") return;
    console.warn(`[transfer] notice ${p.notice.id}: Meta refused the second source's receipt — sent as text`);
  }
  await tell(env, owner, text, ctx, TRANSFER_OWNER_PURPOSE);
}
/** The notice as planned is kept, and its invoices marked as waiting on it. */
async function keepNotice(env: Env, n: TransferNotice): Promise<void> {
  await writeTransferNotice(env, n);
  await markOpen(env, n);
}

/** The line kept in an invoice's log with the receipt. */
export const noticeLogLine = (n: Pick<TransferNotice, "id" | "name" | "amount" | "date" | "reference">): string =>
  `إشعار تحويل من العميل ${n.name} (${noticeRef(n.id)}): ${fmtSar(n.amount)} ر.س بتاريخ ${dayText(n.date)}${n.reference ? ` — المرجع ${n.reference}` : ""}. بانتظار تأكيد وصوله للحساب، ولم تُسجَّل دفعة.`;
/**
 * The receipt on ONE chosen invoice: a note with the file in the log of its
 * account.move when it has one; else an ir.attachment on the x_invoice row
 * (which has no log), the line as its description. Throws on Odoo trouble.
 */
async function keepOnInvoice(env: Env, inv: OpenInvoice, n: Pick<TransferNotice, "id" | "name" | "amount" | "date" | "reference">, file: { base64: string; mime: string } | null): Promise<void> {
  const line = noticeLogLine(n);
  const ext = /pdf/i.test(file?.mime ?? "") ? "pdf" : /png/i.test(file?.mime ?? "") ? "png" : "jpg";
  const vals = file ? { name: `إيصال-تحويل-${noticeRef(n.id)}.${ext}`, raw: file.base64, mimetype: file.mime } : null;
  if (!inv.moveId) {
    if (vals) await call<number[]>(env, "ir.attachment", "create", { vals_list: [{ ...vals, res_model: "x_invoice", res_id: inv.id, description: line }] });
    return;
  }
  const att = vals ? await call<number[]>(env, "ir.attachment", "create", { vals_list: [{ ...vals, res_model: "account.move", res_id: inv.moveId }] }) : [];
  // an internal note: it is the team's record, not a message to the invoice's followers
  await call(env, "account.move", "message_post", { ids: [inv.moveId], body: line, message_type: "comment", subtype_xmlid: "mail.mt_note", ...(att.length ? { attachment_ids: att } : {}) });
}

export interface TransferOutcome {
  action: "noticed" | "invalid" | "test" | "unknown" | "duplicate";
  noticeId?: string;
  amount?: number;
  problems?: string[];
  /** § 58 ب — added to an open notice of one of its invoices: no second confirmation was asked. */
  linked?: boolean;
}

// ---------------------------------------------------------------- § 58 ب: the collector's «تحويل 🏦»

export interface CollectorNoticeOutcome {
  text: string;
  noticeId?: string;
  linked?: boolean;
  amount?: number;
  /** The amount he typed is more than what is left: nothing was filed (he is asked again). */
  overLimit?: { remaining: number };
}
/**
 * A transfer a collector says he was shown or told of — the «تحويل 🏦» of a
 * collection request, the delivery form's «تحويل»: a notice with the source
 * «المحصّل», and NO payment. `amount` null = all that is left on the invoice.
 * An invoice that is paid, or has nothing left: one line, nothing filed. An
 * amount above what is left: nothing filed (overLimit). Baraa gets the notice
 * with «✅ وصل» / «❌ ما وصل» — or, when the invoice already has an open notice,
 * the two sources with no second request. Throws on Odoo trouble.
 */
export async function noticeCollectorTransfer(env: Env, invoiceId: number, amount: number | null, who: { id: number; name: string; whatsapp: string }, o: { now?: number; ctx?: ExecutionContext } = {}): Promise<CollectorNoticeOutcome> {
  const nowMs = o.now ?? Date.now();
  const inv = await getInvoiceById(env, invoiceId);
  if (!inv) return { text: `الفاتورة رقم ${invoiceId} غير موجودة.` };
  if (inv.status === "paid") return { text: `الفاتورة ${inv.number} تم تحصيلها مسبقاً ✅` };
  const prior = await call<Array<{ x_amount: number | false }>>(env, "x_payment", "search_read", { domain: [["x_invoice_id", "=", invoiceId]], fields: ["x_amount"], limit: 200 });
  const remaining = round2(inv.total - prior.reduce((t, p) => t + (Number(p.x_amount) || 0), 0));
  if (!(remaining > 0.005)) return { text: `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${inv.number}.` };
  if (amount !== null && amount > remaining + 0.005) return { text: `المتبقي ${fmtSar(remaining)} ر.س فقط على الفاتورة ${inv.number}.`, overLimit: { remaining } };
  const sum = round2(amount ?? remaining);
  const cust = inv.orderId ? await getOrderCustomer(env, inv.orderId).catch(() => null) : null;
  const planned = await planTransferNotice(env, {
    partnerId: cust?.id ?? 0, name: cust?.name ?? "", to: waDigits(cust?.phone ?? ""),
    invoices: [{ id: invoiceId, number: inv.number, remaining }],
    // he says it now: the day is today's (the customer's own notice, when it comes, names the transfer's day)
    amount: sum, date: riyadhDateKey(new Date(nowMs)), reference: "", note: "",
    source: { by: "collector", name: who.name, at: nowMs, amount: sum, invoices: [inv.number] },
  }, nowMs);
  const n = planned.notice;
  await keepNotice(env, n);
  if (planned.linked) await sendOwnerLinked(env, planned, undefined, [], o.ctx);
  else await sendOwnerNotice(env, n, ownerNoticeText(n, [collectorSourceText(who.name)]), o.ctx);
  console.log(`[transfer] notice ${n.id} by the collector ${who.id} invoice=${invoiceId} amount=${sum}${planned.linked ? " — linked to the open notice" : ""}`);
  return { text: COLLECTOR_NOTICED_TEXT, noticeId: n.id, linked: planned.linked, amount: sum };
}

/** What a trial's «إرسال» would have recorded, had it been a customer's and Baraa tapped «✅ وصل». */
export function trialText(chosen: OpenInvoice[], f: { amount: number; date: string; reference: string; note: string }): string {
  const plan = allocateTransfer(chosen, f.amount);
  return [
    `${TRANSFER_TEST_MARK} — وصل ${TRANSFER_TITLE} ✅`,
    `المبلغ ${fmtSar(f.amount)} ر.س — التاريخ ${dayText(f.date)} — المرجع ${f.reference || "لم يُذكر"}`,
    "لو كان إشعار عميل وضغطت «✅ وصل» لسُجّل:",
    ...plan.rows.map((r) => `• ${r.number}: ${fmtSar(r.amount)} ر.س${r.paid ? " (تُسدَّد كاملة)" : " (جزئي)"}`),
    ...(plan.excess > 0 ? [excessLine(plan.excess)] : []),
    "📸 صورة النموذج كانت ستُحفظ على كل فاتورة مختارة.",
    ...(f.note ? [`ملاحظتك: ${f.note}`] : []),
    "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)",
  ].join("\n");
}
export const excessLine = (excess: number): string => `زيادة ${fmtSar(excess)} ر.س باقية رصيداً للعميل`;

/** A reply of the transfer form (nfm_reply): read, checked against its token and his open invoices, kept, and sent to Baraa. */
export async function handleTransferReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<TransferOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? TRANSFER_TEST_PURPOSE : TRANSFER_PURPOSE;
  const say = (text: string) => tell(env, to, text, ctx, purpose);
  const rec = await readTransferToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[transfer] reply with no token of this number from=${to.slice(-4)}`);
    await say(TRANSFER_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  // a token is read once
  const claim = await claimButton(env, `transfer_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[transfer] repeated token partner=${rec.partnerId} — not kept again`);
    await say(TRANSFER_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const who: TransferWho = { partnerId: rec.partnerId, name: rec.name, whatsapp: to };
    const values = msg.flow?.values ?? {};
    const today = riyadhDateKey(new Date(nowMs));
    const ids = parseChosen(values.inv), readAmount = parseTransferAmount(values.amt), readDate = parseTransferDate(values.date, today);
    const typedRef = cleanReference(values.ref), note = cut(oneLine(values.note), TRANSFER_NOTE_MAX);
    const [photo] = readReceiptPhotos(values.photo);
    // the photo of the form itself, else the one that came before it
    const anyMedia: TransferMedia | undefined = photo ? { id: photo.id, mime: photo.mime || "image/jpeg" } : rec.media;
    // his open invoices NOW: one paid since the form was sent is not open any more (the trial: the rows it showed)
    const open = rec.test ? rec.rows ?? [] : await openInvoices(env, rec.partnerId);
    const chosen = open.filter((i) => ids.includes(i.id));
    const gone = ids.length - chosen.length;
    const used = async () => { await writeTransferToken(env, { ...rec, usedAt: nowMs }); await finishButton(env, claim, TOKEN_TTL); };

    const problems = [...(!ids.length ? ["inv"] : gone ? ["gone"] : []), ...(readAmount === "invalid" ? ["amt"] : []), ...(readDate === "invalid" ? ["date"] : []), ...(!anyMedia ? ["photo"] : [])];
    if (problems.length) {
      await used();
      const reasons: Record<string, string> = { inv: TRANSFER_BAD_INVOICES_TEXT, gone: `${TRANSFER_GONE_INVOICE_TEXT}. اختر من القائمة الجديدة.`, amt: TRANSFER_BAD_AMOUNT_TEXT, date: TRANSFER_BAD_DATE_TEXT, photo: TRANSFER_NO_PHOTO_TEXT };
      const text = ["⚠️ ما انحفظ شيء من النموذج:", ...problems.map((p) => `• ${reasons[p]}`), "عبّه من جديد ثم «إرسال» 👇"].join("\n");
      // the fresh form opens on what he wrote that was right (a photo cannot be put back: Meta's)
      const init: TransferInit = { sel: chosen.map((i) => i.id), amt: readAmount === "invalid" ? "" : fmtSar(readAmount), ...(readDate === "invalid" ? {} : { date: readDate }), ref: typedRef, note };
      const r = await sendTransferForm(env, who, { now: nowMs, ctx, body: text, invoices: open, media: rec.media, read: rec.read, init, test: rec.test }).catch(() => ({ sent: false }));
      if (!r.sent) await say(text);
      return { action: "invalid", problems };
    }
    // no problem = every field was read: `problems` above is the one check of each
    const amount = readAmount as number, date = readDate as string, media = anyMedia as TransferMedia;
    if (rec.test) {
      await used();
      await say(trialText(chosen, { amount, date, reference: typedRef, note }));
      return { action: "test", amount };
    }

    // ---- a notice: the receipt as a file, what it says, then KV, Odoo, the customer, Baraa
    const { downloadMedia } = await import("./supplier-pay");
    const file = await downloadMedia(env, media.id);
    // the form's own photo is read now (its reference; his amount and date stand); the one before the form was read then
    const said = photo ? (file ? await readTransferReceipt(env, file, today) : null) : rec.read ?? null;
    // § 58 ب — ONE notice an invoice: with an open notice on a chosen invoice (the collector's «تحويل 🏦»,
    // or an earlier form of his), this one is linked to it — no second «✅ وصل» is asked
    const planned = await planTransferNotice(env, {
      partnerId: rec.partnerId, name: rec.name, to,
      invoices: chosen.map((i) => ({ id: i.id, number: i.number, remaining: i.remaining })),
      amount, date, reference: typedRef || said?.reference || "", note, media,
      source: { by: "customer", name: rec.name, at: nowMs, amount, invoices: chosen.map((i) => i.number) },
    }, nowMs);
    const n = planned.notice;
    await writeTransferNotice(env, n);
    await used();
    await markOpen(env, n);
    // the line kept with the receipt says what THIS form said (a linked notice may keep the first's figures)
    const said1 = { id: n.id, name: rec.name, amount, date, reference: typedRef || said?.reference || "" };
    const notKept: string[] = [];
    for (const inv of chosen) {
      try {
        await keepOnInvoice(env, inv, said1, file);
        if (!file) notKept.push(inv.number);
      } catch (e) {
        notKept.push(inv.number);
        console.warn(`[transfer] notice ${n.id}: the receipt was not kept on ${inv.number}`, (e as Error)?.message);
      }
    }
    await say(transferReceivedText(amount));
    const extra = [
      said ? mismatchLine({ amount, date }, said) : TRANSFER_UNREAD_TEXT,
      notKept.length ? `⚠️ تعذّر حفظ صورة الإيصال على: ${notKept.join("، ")}` : "",
    ];
    if (planned.linked) await sendOwnerLinked(env, planned, media, extra, ctx);
    else await sendOwnerNotice(env, n, ownerNoticeText(n, extra), ctx);
    console.log(`[transfer] notice ${n.id} partner=${rec.partnerId} amount=${amount} date=${date} invoices=${chosen.map((i) => i.id).join(",")}${notKept.length ? ` (receipt not kept on ${notKept.length})` : ""}${planned.linked ? ` — linked to the open notice${planned.replaced ? ", his figures stand" : ""}` : ""}`);
    return { action: "noticed", noticeId: n.id, amount, ...(planned.linked ? { linked: true } : {}) };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- Baraa's decision

export interface TransferDecisionOutcome {
  action: "confirmed" | "declined" | "duplicate" | "unknown" | "error";
  noticeId?: string;
  payments?: number[];
  excess?: number;
  accountPaymentId?: number | null;
}

/** «سبق تسجيله», and what was decided when it is known. */
export function alreadyText(n: TransferNotice | null): string {
  const d = n?.decided;
  return d && n ? `${TRANSFER_ALREADY_TEXT}: «${d.how === "ok" ? TRANSFER_OK_TITLE : TRANSFER_NO_TITLE}» الساعة ${riyadhHHMM(new Date(d.at))} — ${n.name}، ${fmtSar(n.amount)} ر.س` : TRANSFER_ALREADY_TEXT;
}
/** § 58 ب — an invoice that could not take its share of the transfer: what was asked of it, and what was left on it. */
export interface TransferShort { number: string; asked: number; left: number }
/** «⚠️ UTAK-INV-…: المبلغ 300 ر.س والمتبقي 0 ر.س — لم يُسجَّل عليها شيء»: the last guard, as Baraa reads it. */
export const shortLine = (x: TransferShort): string =>
  `⚠️ ${x.number}: المبلغ ${fmtSar(x.asked)} ر.س والمتبقي ${fmtSar(x.left)} ر.س — ${x.left > 0 ? `سُجّل ${fmtSar(x.left)} ر.س فقط` : "لم يُسجَّل عليها شيء"}`;
/**
 * § 58 أ — the customer's ONE message after «✅ وصل»: the amount, each invoice
 * with what was paid on it, what is left over, and each receipt's link.
 */
export function customerConfirmedText(amount: number, rows: Array<Pick<TransferRow, "number" | "amount" | "paid" | "receiptUrl">>, excess: number): string {
  const links = rows.filter((r) => r.receiptUrl);
  return [
    rows.length
      ? `استلمنا تحويلك ${fmtSar(amount)} ريال ✅ وسددنا: ${rows.map((r) => `فاتورة ${r.number} (${fmtSar(r.amount)} ريال${r.paid ? "" : " — جزئي"})`).join("، ")}`
      : `استلمنا تحويلك ${fmtSar(amount)} ريال ✅ والفواتير التي اخترتها مسدّدة من قبل.`,
    ...(excess > 0 ? [`الباقي ${fmtSar(excess)} ريال رصيد لك عندنا.`] : []),
    ...(links.length === 1 ? [`الإيصال: ${links[0].receiptUrl}`] : links.length ? ["الإيصالات:", ...links.map((r) => `• ${shortNumber(r.number)}: ${r.receiptUrl}`)] : []),
  ].join("\n");
}
/** What Baraa reads after «✅ وصل». */
export function confirmedText(n: TransferNotice, rows: TransferRow[], excess: number, accounting: "off" | "posted" | "failed" | "none", shorts: TransferShort[] = []): string {
  const src = sourcesOf(n);
  return [
    `✅ سُجّل تحويل ${n.name}: ${fmtSar(n.amount)} ر.س — ${dayText(n.date)} — المرجع ${n.reference || "لم يُذكر"}`,
    ...rows.map((r) => `• ${r.number}: ${fmtSar(r.amount)} ر.س${r.paid ? " (سُدّدت كاملة)" : " (جزئي)"}`),
    ...(rows.length ? [] : ["لم يُسجَّل شيء على فاتورة: المختارة كلها مسدّدة الآن."]),
    ...shorts.map(shortLine),
    ...(excess > 0 ? [`${excessLine(excess)}${accounting === "posted" ? "" : " (لا قيد لها: سجّلها يدوياً لو لزم)"}`] : []),
    ...(accounting === "posted" ? [TRANSFER_POSTED_TEXT] : accounting === "failed" ? [TRANSFER_NOT_POSTED_TEXT] : []),
    ...(src.length > 1 ? [`المصادر: ${src.map((x) => `${sourceLabel(x)} (${riyadhHHMM(new Date(x.at))})`).join(" · ")}`] : []),
    n.to ? `أُبلغ العميل برسالة واحدة${rows.some((r) => r.receiptUrl) ? " فيها روابط الإيصالات" : ""}.` : "لم تُرسل رسالة للعميل: لا رقم واتساب له.",
  ].join("\n");
}

/**
 * «✅ وصل» / «❌ ما وصل» under a notice. Baraa's number alone (null for any
 * other: the caller answers as it does a button it does not know), and once: a
 * second tap on either button reads «سبق تسجيله» and writes nothing. Never
 * throws: a tap that could not finish is released and says so, and the next
 * tap goes on from what Odoo already holds of this notice — its x_payment rows
 * (they name it in their note) and their account.payment — so no invoice is
 * paid twice and no second payment is posted.
 */
export async function handleTransferDecision(env: Env, buttonId: string, from: string, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<TransferDecisionOutcome | null> {
  const m = TRANSFER_DECISION_RE.exec(String(buttonId ?? ""));
  if (!m || !isOwnerRecipient(env, from)) return null;
  const how = m[1] as "ok" | "no", id = m[2];
  const say = (text: string) => tell(env, from, text, ctx, TRANSFER_OWNER_PURPOSE);
  const n = await readTransferNotice(env, id);
  if (!n) {
    await say(TRANSFER_NOTICE_GONE_TEXT);
    return { action: "unknown", noticeId: id };
  }
  // ONE lock for the two buttons: «وصل» then «ما وصل» is a second tap too
  const claim = await claimButton(env, `transfer_decide:${id}`, TRANSFER_KEEP_SEC);
  if (!claim.claimed || n.decided) {
    console.warn(`[transfer] notice ${id}: repeated tap (${how}) — nothing written`);
    await say(alreadyText(n));
    return { action: "duplicate", noticeId: id };
  }
  try {
    if (how === "no") {
      // nothing is written anywhere but the notice's own mark
      await writeTransferNotice(env, { ...n, decided: { how, at: nowMs } });
      await finishButton(env, claim, TRANSFER_KEEP_SEC);
      if (n.to) await tell(env, n.to, TRANSFER_NOT_ARRIVED_TEXT, ctx, TRANSFER_DECISION_PURPOSE);
      await say(`❌ ${TRANSFER_TITLE} ${n.name} (${fmtSar(n.amount)} ر.س): ما وصل. لم يُسجَّل شيء، وأُبلغ العميل.`);
      console.log(`[transfer] notice ${id}: not arrived — nothing written`);
      return { action: "declined", noticeId: id };
    }
    // ---- «✅ وصل»: the chosen invoices, the oldest first, each up to what is left on it NOW
    const { recordCollection } = await import("./invoice");
    // the day of the transfer; today's is this moment, an earlier day's its noon (Riyadh)
    const collectedAt = toOdooUtc(n.date === riyadhDateKey(new Date(nowMs)) ? nowMs : riyadhDayMinuteMs(n.date, 12 * 60));
    const notes = `${TRANSFER_TITLE} ${noticeRef(id)}${n.reference ? ` — المرجع ${n.reference}` : ""}`;
    // what a tap that failed half-way already recorded: this notice's own rows, named in their note —
    // read from Odoo, where they are, so the next tap goes on from there and records nothing twice
    const kept = await call<Array<{ id: number; x_invoice_id: M2O; x_amount: number | false; x_account_payment_id: M2O | number }>>(env, "x_payment", "search_read", {
      domain: [["x_invoice_id", "in", n.invoices.map((i) => i.id)], ["x_method", "=", "transfer"], ["x_notes", "ilike", noticeRef(id)]],
      fields: ["id", "x_invoice_id", "x_amount", "x_account_payment_id"], limit: 200,
    });
    const numberOf = new Map(n.invoices.map((i) => [i.id, i.number]));
    const rows: TransferRow[] = kept.map((p) => ({ invoiceId: m2oId(p.x_invoice_id), number: numberOf.get(m2oId(p.x_invoice_id)) ?? "", paymentId: p.id, amount: round2(Number(p.x_amount) || 0), paid: false }));
    let left = round2(n.amount - rows.reduce((s, r) => s + r.amount, 0));
    // § 58 ب — the last guard, said here: an invoice that had less left than its share of the transfer
    // (a cash collection, or a payment in Odoo, since the notice) takes what is left on it, or nothing
    const shorts: TransferShort[] = [];
    for (const inv of n.invoices) {
      if (left <= 0.005) break;
      if (rows.some((r) => r.invoiceId === inv.id)) continue;
      const share = round2(Math.min(left, inv.remaining));
      const r = await recordCollection(env, { invoiceId: inv.id, quietExcess: true, method: "transfer", amount: left, collectedAt, notes, accounting: false });
      const got = r.paymentId && r.amount ? r.amount : 0;
      if (got + 0.005 < share) shorts.push({ number: inv.number, asked: share, left: got });
      // paid in the meantime: its share goes on to the next chosen invoice, and then to the excess
      if (!r.paymentId || !r.amount) continue;
      rows.push({ invoiceId: inv.id, number: inv.number, paymentId: r.paymentId, amount: r.amount, paid: false });
      left = round2(left - r.amount);
    }
    const excess = Math.max(0, left);
    // as he ticked them, the oldest first — whatever order the rows were made or read in
    const place = new Map(n.invoices.map((i, k) => [i.id, k]));
    rows.sort((a, b) => (place.get(a.invoiceId) ?? 0) - (place.get(b.invoiceId) ?? 0));
    // each invoice as it stands now: paid or not, and its accounting twin
    const state = rows.length
      ? await call<Array<{ id: number; x_status: string | false; x_account_move_id: M2O }>>(env, "x_invoice", "read", { ids: rows.map((r) => r.invoiceId), fields: ["id", "x_status", "x_account_move_id"] })
      : [];
    const stateOf = new Map(state.map((s) => [s.id, s]));
    for (const r of rows) r.paid = stateOf.get(r.invoiceId)?.x_status === "paid";
    // ---- the books: ONE payment for the whole transfer (never a second one for rows that have theirs)
    const { isAccountingSyncEnabled, syncTransferToAccounting } = await import("./accounting");
    let accounting: "off" | "posted" | "failed" | "none" = "off";
    let accountPaymentId = kept.map((p) => m2oId(p.x_account_payment_id)).find(Boolean) ?? null;
    if (isAccountingSyncEnabled(env)) {
      if (rows.length && !accountPaymentId) {
        accountPaymentId = await syncTransferToAccounting(env, {
          label: `${n.name} (${noticeRef(id)})`,
          rows: rows.map((r) => ({ paymentId: r.paymentId, invoiceNumber: r.number, invoiceMoveId: m2oId(stateOf.get(r.invoiceId)?.x_account_move_id) || null, amount: r.amount })),
          amount: n.amount, date: n.date, reference: n.reference || noticeRef(id),
        });
      }
      accounting = !rows.length ? "none" : accountPaymentId ? "posted" : "failed";
    }
    await writeTransferNotice(env, { ...n, decided: { how, at: nowMs, excess } });
    await finishButton(env, claim, TRANSFER_KEEP_SEC);
    // § 58 أ — each row's receipt, issued here without a message of its own (a receipt that cannot be
    // built now leaves its row without a link; the */5 net issues it, and still sends nothing for it)
    const { issueReceiptForRecord } = await import("./receipt");
    for (const r of rows) {
      try {
        r.receiptUrl = (await issueReceiptForRecord(env, r.paymentId))?.pdfUrl;
      } catch (e) {
        console.warn(`[transfer] notice ${id}: the receipt of payment #${r.paymentId} was not issued`, (e as Error)?.message);
      }
    }
    // the ONE message of this transfer to the customer: what was paid, on which invoices, with the receipts
    if (n.to) await tell(env, n.to, customerConfirmedText(n.amount, rows, excess), ctx, TRANSFER_DECISION_PURPOSE);
    await say(confirmedText(n, rows, excess, accounting, shorts));
    console.log(`[transfer] notice ${id}: arrived — x_payment ${rows.map((r) => r.paymentId).join(",") || "-"} excess=${excess} accounting=${accounting}${accountPaymentId ? ` account.payment=${accountPaymentId}` : ""}`);
    return { action: "confirmed", noticeId: id, payments: rows.map((r) => r.paymentId), excess, accountPaymentId };
  } catch (e) {
    await releaseButton(env, claim);
    console.error(`[transfer] notice ${id}: the decision (${how}) did not finish`, (e as Error)?.message);
    try { await say(TRANSFER_RETRY_TEXT); } catch { /* nothing more to say */ }
    return { action: "error", noticeId: id };
  }
}

// ---------------------------------------------------------------- the trial to Baraa

export const TRANSFER_TEST_REAL_TEXT = "الفواتير في النموذج حقيقية ومفتوحة الآن (للقراءة فقط): لا يُسجَّل عليها شيء.";
export const TRANSFER_TEST_SAMPLE_TEXT = "الفواتير في النموذج عيّنات، ليست فواتير حقيقية.";
/** Three rows that are no one's invoices, each saying so: what the trial shows when nothing real is open. */
export function sampleInvoices(day: string): OpenInvoice[] {
  return [300, 250.5, 120].map((total, k) => ({ id: k + 1, number: `عيّنة ${k + 1}`, date: day, total, remaining: total, moveId: null, customerId: 0, customer: "عيّنة للتجربة، ليست فاتورة" }));
}

/**
 * ONE transfer form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. It lists the oldest real open
 * invoices (read-only), or three sample rows said to be samples when there are
 * none or they cannot be read. His «إرسال» is answered with what would have
 * been recorded: nothing is written, and nobody else is told.
 */
export async function sendTransferFormTest(env: Env, now: number = Date.now()): Promise<TransferFormResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `transfer_test:${TRANSFER_FLOW_ID}:${day}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const real = await openInvoices(env, null, TRANSFER_TEST_ROWS).catch(() => []);
    // his window closed: the form does not go (sendTransferForm), and the day's trial is not spent
    const r = await sendTransferForm(env, { partnerId: 0, name: "براء", whatsapp: owner }, {
      now, test: true, invoices: real.length ? real : sampleInvoices(day),
      body: `${transferFormText()}\n${real.length ? TRANSFER_TEST_REAL_TEXT : TRANSFER_TEST_SAMPLE_TEXT}`,
    });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- § 58 أ: the trial of the one message

export const TRANSFER_CONFIRMED_TEST_LINK = "(رابط الإيصال PDF)";
/** The trial's text: the customer's ONE message after «✅ وصل», for two invoices. */
export function confirmedTestText(rows: Array<Pick<OpenInvoice, "number" | "remaining">>, real: boolean): string {
  const amount = round2(rows.reduce((t, r) => t + r.remaining, 0));
  return [
    `${TRANSFER_TEST_MARK} — هكذا تصل العميل رسالة واحدة بعد «${TRANSFER_OK_TITLE}» على تحويل لفاتورتين (بدل رسالة لكل إيصال):`,
    customerConfirmedText(amount, rows.map((r) => ({ number: r.number, amount: r.remaining, paid: true, receiptUrl: TRANSFER_CONFIRMED_TEST_LINK })), 0),
    real ? "الفاتورتان حقيقيتان ومفتوحتان الآن (للقراءة فقط)." : "الفاتورتان عيّنتان، ليستا فاتورتين حقيقيتين.",
    "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)",
  ].join("\n");
}
/**
 * The ONE message of «✅ وصل» for two invoices, to Baraa's own number, marked
 * «🧪 تجربة»: only while his window is open (nothing held), once a day. The two
 * oldest real open invoices (read-only), or two sample rows said to be samples.
 * Nothing is written, no receipt is issued, and nobody else is told.
 */
export async function sendTransferConfirmedTest(env: Env, now: number = Date.now()): Promise<{ sent: boolean; reason?: string }> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const day = riyadhDateKey(new Date(now));
  const once = await claimButton(env, `transfer_confirmed_test:${day}`, DAY_TTL);
  // the day's one trial
  if (!once.claimed) return { sent: false, reason: "already_today" };
  try {
    const real = await openInvoices(env, null, 2).catch(() => []);
    const rows = real.length === 2 ? real : sampleInvoices(day).slice(0, 2);
    const res = await sendViaGateway(env, {
      purpose: TRANSFER_CONFIRMED_TEST_PURPOSE, to: owner, content: textContent(confirmedTestText(rows, real.length === 2)),
      noHold: true, noHoldReason: "تجربة رسالة «✅ وصل» تُرسل داخل نافذة 24 ساعة فقط",
    });
    const d = gatewayDecision(res);
    if (d?.action !== "session") {
      await releaseButton(env, once);
      return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
    }
    await finishButton(env, once, DAY_TTL);
    return { sent: true };
  } catch (e) {
    await releaseButton(env, once);
    throw e;
  }
}
