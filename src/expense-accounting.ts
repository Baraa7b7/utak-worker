// § 57 و (2026-10-05) — an expense Baraa records from WhatsApp, in Odoo's books.
//
// What docs/EXPENSES.md § 1 has him do by hand, done by the worker when the
// expense form (src/expense-form.ts) is sent:
//   • a vendor bill (account.move, in_invoice) in the journal «المصاريف» (EXP —
//     never BILL, the goods' journal), ONE line on the expense account of its
//     type, quantity 1, its price the amount AS PAID; posted.
//   • the tax: only with a tax invoice AND a valid tax number of the supplier
//     (15 digits, the first 3 and the last 3) — the purchase tax «15% شامل
//     (مشتريات)», price-included, so Odoo splits the input VAT out of the
//     amount paid. In every other case the line's taxes are pinned EMPTY: no
//     default of the account or of the journal is added.
//   • the supplier: found by that tax number, then by his name; none → a new
//     supplier partner with no customer rank and nothing of WhatsApp on him. A
//     partner that exists is never modified here.
//   • its payment, by account.payment.register on the bill, dated the same day,
//     from the journal he chose: CSHD (the driver's cash), BNK1 (the bank) or
//     BRA («من جيب براء»). On this Odoo a payment gets a journal entry only when
//     its payment method line carries a payment account, so «من جيب براء» is
//     recorded only while BRA's OUTBOUND method posts to an account — the
//     partner's current account, whichever Baraa sets there — and the payment
//     must credit that account.
//   • a guard after each of the two (as evaluateInvoiceGuard / evaluatePaymentGuard
//     of src/accounting.ts). A guard that fails, or a step Odoo refuses: what was
//     written is undone — the payment cancelled, the bill back to draft — and the
//     caller tells Baraa. Nothing is ever deleted.
// The journals, the accounts and the tax are found at run time by their code /
// properties and are never created: what is not found stops the entry before
// any write, and Baraa is told which.

import type { Env } from "./config";
import { call } from "./odoo";
import { buildPaymentSearchDomain, extractPaymentIdFromAction, readMoveLinesWithTypes, roundHalala, splitTaxInclusive, type GuardLine, type GuardResult } from "./accounting";

// ---------------------------------------------------------------- the types and their accounts

export type ExpenseType = "fuel" | "car_maintenance" | "rent" | "salaries" | "utilities" | "gov" | "packaging" | "other";
export interface ExpenseTypeDef { id: ExpenseType; title: string; code: string }
/**
 * The eight types of the form, each on an expense account that EXISTS in the
 * chart (docs/ODOO-IDS.md has the same table, with Odoo's names and ids). The
 * account is found by this code when an expense is recorded.
 */
export const EXPENSE_TYPES: ReadonlyArray<ExpenseTypeDef> = [
  { id: "fuel", title: "وقود", code: "400077" },
  { id: "car_maintenance", title: "صيانة السيارة", code: "400042" },
  { id: "rent", title: "إيجار", code: "400017" },
  { id: "salaries", title: "رواتب وأجور", code: "400003" },
  { id: "utilities", title: "كهرباء ومياه واتصالات", code: "400018" },
  { id: "gov", title: "رسوم حكومية", code: "400032" },
  { id: "packaging", title: "مواد تغليف", code: "400064" },
  { id: "other", title: "أخرى", code: "400028" },
];
export const expenseTypeOf = (id: unknown): ExpenseTypeDef | null => EXPENSE_TYPES.find((t) => t.id === id) ?? null;

export type ExpensePay = "cash" | "bank" | "owner";
/** How it was paid: the form's id, its words, and the journal the payment is registered from. */
export const EXPENSE_PAY: ReadonlyArray<{ id: ExpensePay; title: string; journal: string }> = [
  { id: "cash", title: "كاش السائق (CSHD)", journal: "CSHD" },
  { id: "bank", title: "البنك (BNK1)", journal: "BNK1" },
  { id: "owner", title: "من جيب براء", journal: "BRA" },
];
export const expensePayOf = (id: unknown) => EXPENSE_PAY.find((p) => p.id === id) ?? null;
/** The journal of the bill, and the partner's current-account journal («من جيب براء»). */
export const EXPENSE_JOURNAL_CODE = "EXP";
export const POCKET_JOURNAL_CODE = "BRA";
/** The price-included purchase tax, as docs/EXPENSES.md § 3 names it. */
export const EXPENSE_TAX_NAME = "15% شامل (مشتريات)";
export const EXPENSE_TAX_RATE = 15;
export const POCKET_KV_KEY = "expense_pocket:v1";
export const POCKET_TTL_SECONDS = 10 * 60;

const errText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);
type M2O = [number, string] | false;
const m2oId = (v: M2O | undefined): number => (Array.isArray(v) ? v[0] : 0);

// ---------------------------------------------------------------- the supplier's tax number

/** A tax number as it is typed: Arabic-Indic and Persian digits read, spaces and dashes dropped. */
export function normalizeVatNumber(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\u00a0\u200c-\u200f\-]+/g, "");
}
/** A Saudi tax number: fifteen digits, the first 3 and the last 3. */
export const isValidVatNumber = (raw: unknown): boolean => /^3\d{13}3$/.test(normalizeVatNumber(raw));

// ---------------------------------------------------------------- what Odoo holds (read-only)

export interface ExpenseJournal { id: number; code: string; name: string }
/** The journals an expense touches, by code: EXP, CSHD, BNK1, BRA — the ones Odoo has. */
export async function readExpenseJournals(env: Env): Promise<Map<string, ExpenseJournal>> {
  const rows = await call<ExpenseJournal[]>(env, "account.journal", "search_read", {
    domain: [["code", "in", [EXPENSE_JOURNAL_CODE, ...EXPENSE_PAY.map((p) => p.journal)]]],
    fields: ["id", "code", "name"], limit: 10,
  });
  return new Map(rows.map((j) => [j.code, { id: j.id, code: j.code, name: j.name }]));
}

/** Why «من جيب براء» cannot be recorded: its journal is not in Odoo, or the journal's outbound payment method posts to no account. */
export type PocketWhy = "journal" | "method";
export type PocketState = { ok: true; accountId: number } | { ok: false; why: PocketWhy };
/** What Baraa reads when the journal is there and its outbound payment method has no account: the fix is his, in Odoo. */
export const POCKET_NO_ACCOUNT_TEXT = `يومية ${POCKET_JOURNAL_CODE} بلا حساب على طريقة الدفع الصادرة (تُضبط في Odoo)`;

/**
 * Can «من جيب براء» be recorded? A payment of this Odoo gets a journal entry
 * only when its payment method line carries a payment account (CSHD's point
 * at 101007, BNK1's at 101003 / 101004); a line without one leaves the payment
 * with NO entry, and the bill's payable open in the books. So: the journal BRA
 * is in Odoo, and its OUTBOUND payment methods all post to one and the same
 * account — which account is Baraa's own setting there, never the worker's
 * guess (the journal's default account is not read). Read-only.
 */
export async function readPocket(env: Env, journals: Map<string, ExpenseJournal>): Promise<PocketState> {
  const journal = journals.get(POCKET_JOURNAL_CODE);
  if (!journal) return { ok: false, why: "journal" };
  const lines = await call<Array<{ id: number; payment_account_id: M2O }>>(env, "account.payment.method.line", "search_read", {
    domain: [["journal_id", "=", journal.id], ["payment_type", "=", "outbound"]], fields: ["id", "journal_id", "payment_type", "payment_account_id"], limit: 20,
  });
  const accounts = [...new Set(lines.map((l) => m2oId(l.payment_account_id)))];
  return accounts.length === 1 && accounts[0] > 0 ? { ok: true, accountId: accounts[0] } : { ok: false, why: "method" };
}

export type PocketOffer = { ok: true } | { ok: false; why: PocketWhy };
/**
 * Is «من جيب براء» offered in a form sent now — and when not, why? One read of
 * the journal and its payment methods, kept in KV for ten minutes (as the
 * transfer line of src/bank-line.ts): the form is sent on a tap, and its
 * options need no fresher answer — both are read again when the expense is
 * recorded. Throws on Odoo trouble (nothing cached).
 */
export async function ownerPocketAvailable(env: Env, now: number = Date.now()): Promise<PocketOffer> {
  try {
    const raw = await env.MSG_DEDUP.get(POCKET_KV_KEY);
    const c = raw ? (JSON.parse(raw) as { at: number; ok: boolean; why?: PocketWhy }) : null;
    if (c && c.at > 0 && now - c.at < POCKET_TTL_SECONDS * 1000 && typeof c.ok === "boolean") return c.ok ? { ok: true } : { ok: false, why: c.why === "journal" ? "journal" : "method" };
  } catch { /* a cache that cannot be read is only a slower path */ }
  const state = await readPocket(env, await readExpenseJournals(env));
  const offer: PocketOffer = state.ok ? { ok: true } : { ok: false, why: state.why };
  try { await env.MSG_DEDUP.put(POCKET_KV_KEY, JSON.stringify({ at: now, ...offer }), { expirationTtl: POCKET_TTL_SECONDS }); } catch { /* read again next time */ }
  return offer;
}

interface AccountRow { id: number; code: string; name: string; account_type: string }
async function accountBy(env: Env, leaf: [string, string, unknown]): Promise<AccountRow | null> {
  const [a] = await call<AccountRow[]>(env, "account.account", "search_read", { domain: [leaf], fields: ["id", "code", "name", "account_type"], limit: 1 });
  return a ?? null;
}

export interface ExpenseTax { id: number; name: string; rate: number }
/**
 * The purchase tax that is INCLUDED in the amount paid: an active percent
 * purchase tax of 15 with price_include — the one named «15% شامل (مشتريات)»
 * when Odoo has several. None, or several and none by that name: null (the
 * tax that is added on top, the goods' #21, would post 115 for 100 paid).
 */
export async function findInclusivePurchaseTax(env: Env): Promise<ExpenseTax | null> {
  type Tax = { id: number; name: string; amount: number; price_include: boolean; active: boolean };
  const rows = await call<Tax[]>(env, "account.tax", "search_read", {
    domain: [["type_tax_use", "=", "purchase"], ["amount_type", "=", "percent"], ["amount", "=", EXPENSE_TAX_RATE]],
    fields: ["id", "name", "amount", "price_include", "active"], limit: 20,
  });
  const ok = rows.filter((t) => t.active !== false && t.price_include === true);
  const t = ok.length === 1 ? ok[0] : ok.find((x) => x.name === EXPENSE_TAX_NAME);
  return t ? { id: t.id, name: t.name, rate: t.amount } : null;
}

/** A name as it is compared: every run of spaces (the no-break and the invisible ones too) one space, no case. */
export const supplierNameKey = (s: unknown): string => String(s ?? "").replace(/[\s\u00a0\u200c-\u200f\u202a-\u202e]+/g, " ").trim().toLowerCase();

export interface ExpenseSupplier { id: number; name: string }
/**
 * The supplier of an expense: the partner holding this tax number (an entry
 * carries one only when it is valid), else the partner of exactly this name —
 * a partner that is already a supplier first, then the oldest. Odoo is asked
 * for the names that hold the name's longest word, and the whole name is
 * compared here: a name kept in Odoo with two spaces is still the same name,
 * and one that only contains it is not. Null = none: a new one is made when
 * the expense is recorded. Read-only.
 */
export async function findExpenseSupplier(env: Env, name: string, vat: string): Promise<ExpenseSupplier | null> {
  type P = { id: number; name: string; supplier_rank: number };
  const fields = ["id", "name", "supplier_rank"];
  const first = (rows: P[]): P | null => [...rows].sort((a, b) => Number(b.supplier_rank > 0) - Number(a.supplier_rank > 0) || a.id - b.id)[0] ?? null;
  if (vat) {
    const p = first(await call<P[]>(env, "res.partner", "search_read", { domain: [["vat", "=", vat]], fields, limit: 20 }));
    if (p) return { id: p.id, name: p.name };
  }
  const key = supplierNameKey(name);
  const word = key.split(" ").sort((x, y) => y.length - x.length)[0];
  const rows = await call<P[]>(env, "res.partner", "search_read", { domain: [["name", "ilike", word]], fields, limit: 200 });
  const p = first(rows.filter((r) => supplierNameKey(r.name) === key));
  return p ? { id: p.id, name: p.name } : null;
}
/**
 * A NEW supplier: a company, a supplier and not a customer, classed «supplier»
 * (a partner the worker makes is never left «unreviewed»); his tax number (the
 * entry's: a valid one, or none) and «مسجل في الضريبة» with it. Nothing of WhatsApp.
 */
export function newSupplierVals(name: string, vat: string): Record<string, unknown> {
  return {
    name, is_company: true, supplier_rank: 1, customer_rank: 0, x_contact_class: "supplier",
    ...(vat ? { vat, x_vat_registered: true, x_vat_status: "registered" } : {}),
  };
}

// ---------------------------------------------------------------- the entry and its plan

/** One expense, as the form gave it (src/expense-form.ts reads and checks every field). */
export interface ExpenseEntry {
  type: ExpenseType;
  /** The amount AS PAID. */
  amount: number;
  /** «فاتورة ضريبية؟ نعم» with a VALID tax number: the amount holds 15% input VAT. */
  taxed: boolean;
  /** The supplier's tax number when it is valid, else "". */
  vat: string;
  supplier: string;
  pay: ExpensePay;
  /** YYYY-MM-DD, never after today in Riyadh (Odoo refuses a bill dated later). */
  date: string;
  note: string;
  /** The bill's reference: unique to this form (the worker's own mark closes it). */
  ref: string;
}
export interface ExpensePlan {
  type: ExpenseTypeDef;
  account: { id: number; code: string; name: string };
  /** The journal «المصاريف». */
  journalId: number;
  pay: { id: ExpensePay; title: string; journalId: number; journalCode: string; /** «من جيب براء»: the code of the account BRA's outbound payment method posts to. */ pocketAccountCode: string | null };
  tax: ExpenseTax | null;
  net: number;
  vat: number;
  total: number;
  /** The partner found; null = a new supplier is created with the bill. */
  supplier: ExpenseSupplier | null;
}

/** The split of the amount paid: with the tax, its 15% taken OUT of it; without, all of it net. */
export function expenseTotals(amount: number, ratePct: number | null): { net: number; vat: number; total: number } {
  const s = splitTaxInclusive(amount, ratePct ?? 0);
  return { net: s.net, vat: s.tax, total: roundHalala(amount) };
}

/**
 * Everything an expense needs from Odoo, read and checked BEFORE any write:
 * the journal EXP, the journal of the payment, the type's account (found by
 * its code, an expense account), the price-included tax when the amount is
 * taxed, the supplier. `problems` names what is missing — then nothing is
 * written. Read-only; throws on Odoo trouble.
 */
export async function resolveExpense(env: Env, e: ExpenseEntry): Promise<{ plan: ExpensePlan } | { problems: string[] }> {
  const type = expenseTypeOf(e.type)!, pay = expensePayOf(e.pay)!;
  const problems: string[] = [];
  const journals = await readExpenseJournals(env);
  const exp = journals.get(EXPENSE_JOURNAL_CODE), pj = journals.get(pay.journal);
  if (!exp) problems.push(`يومية المصاريف ${EXPENSE_JOURNAL_CODE} غير موجودة في Odoo`);
  if (!pj) problems.push(`يومية الدفع ${pay.journal} («${pay.title}») غير موجودة في Odoo`);
  const account = await accountBy(env, ["code", "=", type.code]);
  if (!account) problems.push(`الحساب ${type.code} («${type.title}») غير موجود في دليل الحسابات`);
  else if (!String(account.account_type).startsWith("expense")) problems.push(`الحساب ${type.code} («${type.title}») نوعه ${account.account_type} وليس حساب مصروف`);
  const tax = e.taxed ? await findInclusivePurchaseTax(env) : null;
  if (e.taxed && !tax) problems.push(`ضريبة المشتريات «${EXPENSE_TAX_NAME}» غير موجودة في Odoo أو ليست شاملة في السعر`);
  // «من جيب براء» credits the account of BRA's outbound payment method — read now, never from the form's cache
  let pocketAccountCode: string | null = null;
  if (pay.id === "owner" && pj) {
    const pocket = await readPocket(env, journals);
    const acc = pocket.ok ? await accountBy(env, ["id", "=", pocket.accountId]) : null;
    if (!acc) problems.push(POCKET_NO_ACCOUNT_TEXT);
    else pocketAccountCode = acc.code;
  }
  if (problems.length || !exp || !pj || !account) return { problems };
  const supplier = await findExpenseSupplier(env, e.supplier, e.vat);
  return {
    plan: {
      type, account: { id: account.id, code: account.code, name: account.name }, journalId: exp.id,
      pay: { id: pay.id, title: pay.title, journalId: pj.id, journalCode: pj.code, pocketAccountCode },
      tax, ...expenseTotals(e.amount, tax?.rate ?? null), supplier,
    },
  };
}

// ---------------------------------------------------------------- the guards

/**
 * The bill after its posting: an in_invoice, posted, in the journal EXP; ONE
 * expense line, on the type's account, debited by the net; the payable
 * credited by the amount paid; a debited tax line exactly when one is expected
 * (its amount the split of the amount paid) and none otherwise; the total the
 * amount AS PAID (a tax added on top would raise it).
 */
export function evaluateExpenseBillGuard(f: {
  moveType: string;
  moveState: string;
  journalId: number;
  expectedJournalId: number;
  lines: GuardLine[];
  accountCode: string;
  /** The amount as paid. */
  total: number;
  expectTax: boolean;
  expectedTax: number;
  amountTax: number;
  amountTotal: number;
}): GuardResult {
  const reasons: string[] = [];
  if (f.moveType !== "in_invoice") reasons.push(`نوع القيد ${f.moveType || "?"} وليس in_invoice`);
  if (f.moveState !== "posted") reasons.push(`الفاتورة حالتها ${f.moveState || "?"} وليست posted`);
  if (f.journalId !== f.expectedJournalId) reasons.push(`الفاتورة في اليومية ${f.journalId || "?"} وليست يومية المصاريف ${f.expectedJournalId}`);
  const taxLines = f.lines.filter((l) => l.is_tax);
  const payable = f.lines.filter((l) => !l.is_tax && l.account_type === "liability_payable");
  const expense = f.lines.filter((l) => !l.is_tax && l.account_type !== "liability_payable");
  const net = roundHalala(f.total - (f.expectTax ? f.expectedTax : 0));
  const [line] = expense;
  if (expense.length !== 1) reasons.push(`سطور المصروف ${expense.length} والمتوقع سطر واحد`);
  else {
    if (line.account_code !== f.accountCode) reasons.push(`سطر المصروف على الحساب ${line.account_code} والمتوقع ${f.accountCode}`);
    if (line.credit > 0 || Math.abs(line.debit - net) > 0.005) reasons.push(`سطر المصروف مدين ${line.debit} ودائن ${line.credit} والمتوقع مدين ${net}`);
  }
  const owed = roundHalala(payable.reduce((a, l) => a + l.credit - l.debit, 0));
  if (Math.abs(owed - f.total) > 0.005) reasons.push(`الذمم الدائنة ${owed} ≠ المبلغ المدفوع ${f.total}`);
  const taxDebit = roundHalala(taxLines.reduce((a, l) => a + l.debit - l.credit, 0));
  if (f.expectTax) {
    if (Math.abs(taxDebit - f.expectedTax) > 0.005 || Math.abs(f.amountTax - f.expectedTax) > 0.005) reasons.push(`ضريبة المدخلات ${f.amountTax} (سطر ${taxDebit}) ≠ المتوقع ${f.expectedTax}`);
  } else if (taxLines.length > 0 || Math.abs(f.amountTax) > 0.005) {
    reasons.push(`على الفاتورة ضريبة ${f.amountTax} والمتوقع بلا ضريبة`);
  }
  if (Math.abs(f.amountTotal - f.total) > 0.005) reasons.push(`إجمالي الفاتورة ${f.amountTotal} ≠ المبلغ المدفوع ${f.total}`);
  return { ok: reasons.length === 0, reasons };
}

/** A payment out of cash or the bank credits an asset account (the cash itself, or the bank's outstanding payments). */
const PAYMENT_CREDIT_TYPES: ReadonlySet<string> = new Set(["asset_cash", "asset_current"]);

/**
 * The payment after action_create_payments: alive (Odoo 19 has no «posted»
 * state on a payment: its entry is what is posted), with a posted entry, from
 * the journal he chose, to the bill's partner, of the amount paid; the entry
 * debits the payable alone and credits cash / the bank — or, «من جيب براء»,
 * the account of BRA's outbound payment method and no other; and the bill is
 * paid / in_payment.
 */
export function evaluateExpensePaymentGuard(f: {
  paymentState: string;
  journalId: number;
  partnerId: number;
  amount: number;
  moveId: number;
  moveState: string;
  lines: GuardLine[];
  billPaymentState: string;
  expectedJournalId: number;
  expectedPartnerId: number;
  total: number;
  /** «من جيب براء»: the code of the account the payment must credit; null = cash or the bank. */
  pocketAccountCode: string | null;
}): GuardResult {
  const reasons: string[] = [];
  if (!f.moveId) reasons.push("الدفعة بلا قيد (move_id فارغ)");
  else if (f.moveState !== "posted") reasons.push(`قيد الدفعة حالته ${f.moveState || "?"} وليس posted`);
  if (f.paymentState === "draft" || f.paymentState === "canceled" || f.paymentState === "rejected") reasons.push(`حالة الدفعة ${f.paymentState}`);
  if (f.journalId !== f.expectedJournalId) reasons.push(`الدفعة من اليومية ${f.journalId || "?"} وليست ${f.expectedJournalId}`);
  if (f.partnerId !== f.expectedPartnerId) reasons.push(`شريك الدفعة ${f.partnerId || "?"} ≠ مورد الفاتورة ${f.expectedPartnerId}`);
  if (Math.abs(f.amount - f.total) > 0.005) reasons.push(`مبلغ الدفعة ${f.amount} ≠ المبلغ المدفوع ${f.total}`);
  for (const l of f.lines) {
    if (l.debit > 0 && l.account_type !== "liability_payable") reasons.push(`قيد الدفعة مدين على ${l.account_code} (${l.account_type}) وليس على الذمم الدائنة`);
    if (l.credit > 0 && (f.pocketAccountCode ? l.account_code !== f.pocketAccountCode : !PAYMENT_CREDIT_TYPES.has(l.account_type))) {
      reasons.push(f.pocketAccountCode ? `قيد الدفعة دائن على ${l.account_code} وليس على جاري الشريك ${f.pocketAccountCode}` : `قيد الدفعة دائن على ${l.account_code} (${l.account_type}) وليس على النقد أو البنك`);
    }
  }
  if (f.billPaymentState !== "paid" && f.billPaymentState !== "in_payment") reasons.push(`حالة سداد الفاتورة ${f.billPaymentState || "?"} (المتوقع paid أو in_payment)`);
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------- the undo

export interface ExpenseUndo {
  /** Nothing of the entry is left posted: the payment cancelled (or never made), the bill not posted. */
  ok: boolean;
  /** As Odoo holds them after the undo ("" = none, or it could not be read). */
  paymentState: string;
  billState: string;
  problems: string[];
}
const stateOf = async (env: Env, model: string, id: number): Promise<string> =>
  (await call<Array<{ id: number; state: string }>>(env, model, "read", { ids: [id], fields: ["id", "state"] }))[0]?.state ?? "";

/**
 * An entry taken back — by «↩️ تراجع», or by the worker itself after a guard:
 * the payment back to draft and cancelled (which also takes it off the bill),
 * THEN the bill back to draft. Each step is read back; a payment that is still
 * alive keeps its bill posted (a bill in draft under a live payment would
 * leave the cash paid against nothing). What is already undone is left as it
 * is, so it can run twice. Nothing is deleted. Never throws.
 */
export async function undoExpenseEntry(env: Env, a: { moveId: number; paymentId: number | null }): Promise<ExpenseUndo> {
  const problems: string[] = [];
  let paymentState = "", billState = "";
  try {
    if (a.paymentId) {
      paymentState = await stateOf(env, "account.payment", a.paymentId);
      if (paymentState !== "canceled") {
        for (const method of ["action_draft", "action_cancel"]) {
          try { await call<unknown>(env, "account.payment", method, { ids: [a.paymentId] }); } catch (e) { problems.push(`الدفعة ${a.paymentId} ${method}: ${errText(e)}`); }
        }
        paymentState = await stateOf(env, "account.payment", a.paymentId);
      }
    }
    billState = await stateOf(env, "account.move", a.moveId);
    if (a.paymentId && paymentState !== "canceled") {
      return { ok: false, paymentState, billState, problems: [`الدفعة ${a.paymentId} لم تُلغَ (حالتها ${paymentState || "?"})، فبقيت الفاتورة كما هي`, ...problems] };
    }
    if (billState === "posted") {
      try { await call<unknown>(env, "account.move", "button_draft", { ids: [a.moveId] }); } catch (e) { problems.push(`الفاتورة ${a.moveId} button_draft: ${errText(e)}`); }
      billState = await stateOf(env, "account.move", a.moveId);
    }
    if (billState === "posted" || !billState) return { ok: false, paymentState, billState, problems: [`الفاتورة ${a.moveId} لم تعد مسودة (حالتها ${billState || "?"})`, ...problems] };
    return { ok: true, paymentState, billState, problems };
  } catch (e) {
    return { ok: false, paymentState, billState, problems: [`تعذّرت قراءة Odoo أثناء التراجع: ${errText(e)}`, ...problems] };
  }
}

// ---------------------------------------------------------------- the record

export interface ExpensePhotoFile { base64: string; mime: string }
export type ExpenseRecord =
  | {
      ok: true; moveId: number; billName: string; paymentId: number;
      supplierId: number; supplierName: string; supplierCreated: boolean;
      /** The form's photo on the bill: none came, kept, or not kept (the entry stands; Baraa attaches it by hand). */
      photo: "none" | "saved" | "failed";
    }
  | {
      ok: false; reasons: string[];
      /** The bill that was created, if one was (in draft after the undo: nothing is deleted). */
      moveId: number | null;
      /** The undo of what was written; null = nothing was written. */
      undo: ExpenseUndo | null;
    };

/** One line: the type's name, then his note. */
export const expenseLineLabel = (title: string, note: string): string => (note ? `${title} — ${note}` : title);

/** The bill, as it is created: ONE line, its taxes pinned either way — the price-included tax, or NONE. */
export function expenseBillVals(e: ExpenseEntry, plan: ExpensePlan, partnerId: number): Record<string, unknown> {
  return {
    move_type: "in_invoice",
    journal_id: plan.journalId,
    partner_id: partnerId,
    invoice_date: e.date,
    ref: e.ref,
    invoice_line_ids: [[0, 0, {
      name: expenseLineLabel(plan.type.title, e.note),
      account_id: plan.account.id,
      quantity: 1,
      price_unit: e.amount,
      tax_ids: [[6, 0, plan.tax ? [plan.tax.id] : []]],
    }]],
  };
}

/** The photo of the form on the bill (ir.attachment takes `raw` on this Odoo, as the purchase invoice's file). */
export async function attachExpensePhoto(env: Env, moveId: number, date: string, file: ExpensePhotoFile): Promise<boolean> {
  try {
    const ext = /pdf/.test(file.mime) ? "pdf" : /png/.test(file.mime) ? "png" : "jpg";
    await call<number[]>(env, "ir.attachment", "create", {
      vals_list: [{ name: `مرفق-المصروف-${date}-${moveId}.${ext}`, raw: file.base64, mimetype: file.mime, res_model: "account.move", res_id: moveId }],
    });
    return true;
  } catch (e) {
    console.warn(`[expense] bill ${moveId}: the photo was not attached`, errText(e));
    return false;
  }
}

/**
 * The expense in Odoo: the supplier (made when none was found), the bill —
 * created, posted, guarded — its photo, then the payment from the journal of
 * the plan, guarded. Whatever fails after the bill exists, everything written
 * is undone before the answer. NEVER throws.
 */
export async function recordExpense(env: Env, e: ExpenseEntry, plan: ExpensePlan, photo: ExpensePhotoFile | null): Promise<ExpenseRecord> {
  let moveId: number | null = null, paymentId: number | null = null;
  const fail = async (reason: string): Promise<ExpenseRecord> => {
    const undo = moveId ? await undoExpenseEntry(env, { moveId, paymentId }) : null;
    console.error(`[expense] ${e.ref}: ${reason}${undo ? ` — undone: payment=${undo.paymentState || "-"} bill=${undo.billState || "?"}${undo.ok ? "" : " (NOT clean)"}` : ""}`);
    return { ok: false, reasons: [reason], moveId, undo };
  };
  try {
    const supplierCreated = !plan.supplier;
    let supplierId = plan.supplier?.id ?? 0;
    if (!supplierId) {
      [supplierId] = await call<number[]>(env, "res.partner", "create", { vals_list: [newSupplierVals(e.supplier, e.vat)] }, { probe: [["name", "=", e.supplier], ["supplier_rank", ">", 0]] });
    }
    [moveId] = await call<number[]>(env, "account.move", "create", { vals_list: [expenseBillVals(e, plan, supplierId)] }, {
      probe: [["move_type", "=", "in_invoice"], ["ref", "=", e.ref], ["partner_id", "=", supplierId], ["state", "=", "draft"]],
    });
    try {
      await call<unknown>(env, "account.move", "action_post", { ids: [moveId] });
    } catch (err) {
      return await fail(`رفض Odoo ترحيل الفاتورة: ${errText(err)}`);
    }
    type Head = { id: number; name: string; state: string; move_type: string; journal_id: M2O; commercial_partner_id: M2O; partner_id: M2O; amount_total: number; amount_tax: number; payment_state: string };
    const readHead = async (): Promise<Head | undefined> => (await call<Head[]>(env, "account.move", "read", {
      ids: [moveId!], fields: ["id", "name", "state", "move_type", "journal_id", "commercial_partner_id", "partner_id", "amount_total", "amount_tax", "payment_state"],
    }))[0];
    const head = await readHead();
    const billGuard = evaluateExpenseBillGuard({
      moveType: head?.move_type ?? "", moveState: head?.state ?? "", journalId: m2oId(head?.journal_id), expectedJournalId: plan.journalId,
      lines: await readMoveLinesWithTypes(env, moveId), accountCode: plan.account.code,
      total: plan.total, expectTax: plan.tax !== null, expectedTax: plan.vat, amountTax: head?.amount_tax ?? 0, amountTotal: head?.amount_total ?? 0,
    });
    if (!billGuard.ok) return await fail(`حارس الفاتورة: ${billGuard.reasons.join("؛ ")}`);
    const photoState = photo ? ((await attachExpensePhoto(env, moveId, e.date, photo)) ? "saved" : "failed") : "none";

    // the payment: the register wizard on the bill builds the entry and reconciles it
    const partnerId = m2oId(head?.commercial_partner_id) || m2oId(head?.partner_id) || supplierId;
    const wizardCtx = { active_model: "account.move", active_ids: [moveId], active_id: moveId };
    const [wizardId] = await call<number[]>(env, "account.payment.register", "create", {
      vals_list: [{ journal_id: plan.pay.journalId, amount: plan.total, payment_date: e.date }], context: wizardCtx,
    });
    const action = await call<unknown>(env, "account.payment.register", "action_create_payments", { ids: [wizardId], context: wizardCtx });
    paymentId = extractPaymentIdFromAction(action);
    if (!paymentId) {
      const found = await call<Array<{ id: number }>>(env, "account.payment", "search_read", {
        domain: buildPaymentSearchDomain({ partnerId, amount: plan.total, journalId: plan.pay.journalId, date: e.date }), fields: ["id"], order: "id desc", limit: 1,
      });
      paymentId = found[0]?.id ?? null;
    }
    if (!paymentId) return await fail("أنشأ Odoo الدفعة ولم يُعثر عليها بعد ذلك: راجع دفعات المورد في Odoo");
    type Pay = { id: number; state: string; move_id: M2O; partner_id: M2O; journal_id: M2O; amount: number };
    const [p] = await call<Pay[]>(env, "account.payment", "read", { ids: [paymentId], fields: ["id", "state", "move_id", "partner_id", "journal_id", "amount"] });
    const payMoveId = m2oId(p?.move_id);
    const payGuard = evaluateExpensePaymentGuard({
      paymentState: p?.state ?? "", journalId: m2oId(p?.journal_id), partnerId: m2oId(p?.partner_id), amount: p?.amount ?? 0,
      moveId: payMoveId, moveState: payMoveId ? await stateOf(env, "account.move", payMoveId) : "", lines: payMoveId ? await readMoveLinesWithTypes(env, payMoveId) : [],
      billPaymentState: (await readHead())?.payment_state ?? "",
      expectedJournalId: plan.pay.journalId, expectedPartnerId: partnerId, total: plan.total, pocketAccountCode: plan.pay.pocketAccountCode,
    });
    if (!payGuard.ok) return await fail(`حارس الدفعة: ${payGuard.reasons.join("؛ ")}`);
    console.log(`[expense] ${e.ref}: bill ${moveId} (${head?.name}) ${plan.account.code} total=${plan.total} vat=${plan.vat} → payment ${paymentId} from ${plan.pay.journalCode}${supplierCreated ? `, new supplier ${supplierId}` : ""}`);
    return {
      ok: true, moveId, billName: String(head?.name || `#${moveId}`), paymentId,
      supplierId, supplierName: plan.supplier?.name ?? e.supplier, supplierCreated, photo: photoState,
    };
  } catch (err) {
    return await fail(`تعذّر التسجيل في Odoo: ${errText(err)}`);
  }
}
