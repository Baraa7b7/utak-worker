// Accounting parallel-write. Gated behind ACCOUNTING_SYNC — added 2026-09-21.
//
// Everything here is additive: the x_invoice / x_payment path stays exactly
// as it was, and this module is called AFTER those rows land. If accounting
// synchronization fails for any reason the caller keeps going, an owner
// alert is fired, and the original WhatsApp send still happens.
//
// Riyadh is UTC+3, no DST. Invoice and payment dates are computed by
// shifting UTC forward three hours and taking the YYYY-MM-DD prefix; the
// prod tenant treats these as naive Odoo `date` values.
//
// Idempotency: the caller passes the x_invoice / x_payment id and the
// existing x_account_move_id / x_account_payment_id. When either is set we
// skip work and return the linked id.
//
// Tax: `tax_ids: [[6, 0, []]]` explicitly wipes any category / partner /
// company fiscal-position default. Total on the account.move must equal
// the total on x_invoice; VAT stays off until Baraa activates it.

import type { Env } from "./config";
import { call } from "./odoo";
import { sendOwnerAlert } from "./templates";

/** ACCOUNTING_SYNC = "true" turns the parallel writes on. Any other value = off. */
export function isAccountingSyncEnabled(env: Env): boolean {
  return env.ACCOUNTING_SYNC === "true";
}

/** Odoo `date` string in Riyadh local time (UTC+3, no DST). */
export function todayRiyadhYmd(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export interface AccountingInvoiceLine {
  /** product.template id (x_daily_order_line.x_product_tmpl_id). */
  product_tmpl_id: number;
  /** Free-text description shown on the invoice line. */
  description: string;
  quantity: number;
  price_unit: number;
}

export interface AccountingInvoiceArgs {
  invoiceId: number;
  /** Pre-existing link on x_invoice; when set, we skip and return it. */
  existingMoveId: number | null;
  invoiceNumber: string;
  customerPartnerId: number;
  invoiceDate?: string; // YYYY-MM-DD, defaults to Riyadh today
  lines: AccountingInvoiceLine[];
  /** Sanity check — thrown if move total drifts from x_invoice.total. */
  expectedTotal: number;
}

/**
 * Build the `invoice_line_ids` payload for an out_invoice. Every line
 * uses (0, 0, {...}) — Odoo's "create new" one-2-many command — and every
 * line pins `tax_ids: [[6, 0, []]]` so no tax sneaks in from category or
 * partner defaults. Exported for the unit test.
 */
export function buildInvoiceLineCommands(
  lines: AccountingInvoiceLine[],
  productProductByTmpl: Map<number, number>,
): Array<[number, number, Record<string, unknown>]> {
  return lines.map((l) => {
    const productId = productProductByTmpl.get(l.product_tmpl_id) ?? 0;
    const vals: Record<string, unknown> = {
      name: l.description,
      quantity: l.quantity,
      price_unit: l.price_unit,
      tax_ids: [[6, 0, []]],
    };
    if (productId > 0) vals.product_id = productId;
    return [0, 0, vals];
  });
}

/**
 * Resolve product.template ids → product.product ids. Every template on
 * this tenant has exactly one product variant, so a single search_read is
 * enough. Returns a map; missing templates simply drop out (the caller's
 * line renders with a description only, no product link).
 */
async function resolveProductVariantIds(
  env: Env,
  tmplIds: number[],
): Promise<Map<number, number>> {
  const unique = Array.from(new Set(tmplIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (unique.length === 0) return new Map();
  type Row = { id: number; product_tmpl_id: [number, string] | false };
  const rows = await call<Row[]>(env, "product.product", "search_read", {
    domain: [["product_tmpl_id", "in", unique]],
    fields: ["id", "product_tmpl_id"],
    limit: unique.length * 2,
  });
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.product_tmpl_id) map.set(r.product_tmpl_id[0], r.id);
  }
  return map;
}

/**
 * Sync one x_invoice → account.move. Idempotent: if
 * `args.existingMoveId` is truthy we short-circuit and return it. On any
 * failure we log, fire an owner alert, and return null. NEVER throws.
 */
export async function syncInvoiceToAccounting(
  env: Env,
  args: AccountingInvoiceArgs,
): Promise<number | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  if (args.existingMoveId && args.existingMoveId > 0) {
    console.log(`[accounting] invoice ${args.invoiceId} already linked to move ${args.existingMoveId} — skip`);
    return args.existingMoveId;
  }
  try {
    const productMap = await resolveProductVariantIds(
      env,
      args.lines.map((l) => l.product_tmpl_id),
    );
    const invoiceDate = args.invoiceDate ?? todayRiyadhYmd();

    // Optional payment term — default to Immediate (id 1) if the partner
    // has none set. `property_payment_term_id` on res.partner is the
    // customer default; we fall back to the seeded Immediate term.
    let paymentTermId: number | null = null;
    try {
      type PartnerRow = { id: number; property_payment_term_id: [number, string] | false };
      const [partner] = await call<PartnerRow[]>(env, "res.partner", "read", {
        ids: [args.customerPartnerId],
        fields: ["id", "property_payment_term_id"],
      });
      if (partner?.property_payment_term_id) {
        paymentTermId = partner.property_payment_term_id[0];
      }
    } catch (e) {
      console.warn("[accounting] payment-term lookup failed", (e as Error).message);
    }

    const invoiceLineIds = buildInvoiceLineCommands(args.lines, productMap);
    const moveVals: Record<string, unknown> = {
      move_type: "out_invoice",
      partner_id: args.customerPartnerId,
      invoice_date: invoiceDate,
      ref: args.invoiceNumber,
      invoice_line_ids: invoiceLineIds,
    };
    if (paymentTermId) moveVals.invoice_payment_term_id = paymentTermId;

    const [moveId] = await call<number[]>(env, "account.move", "create", {
      vals_list: [moveVals],
    });
    await call<boolean>(env, "account.move", "action_post", { ids: [moveId] });

    // Verify total matches x_invoice within a rounding tolerance. If not,
    // alert the owner but keep the link — the number is on both sides for
    // reconciliation from Odoo.
    type MoveHead = { id: number; amount_total: number; state: string };
    const [head] = await call<MoveHead[]>(env, "account.move", "read", {
      ids: [moveId],
      fields: ["id", "amount_total", "state"],
    });
    if (head && Math.abs((head.amount_total ?? 0) - args.expectedTotal) > 0.01) {
      const msg = `[accounting] move ${moveId} total ${head.amount_total} ≠ x_invoice ${args.invoiceNumber} total ${args.expectedTotal}`;
      console.warn(msg);
      // Best-effort alert; deliberately not awaited on the critical path.
      sendOwnerAlert(env, msg).catch(() => {});
    }

    // 2026-09-23 — account-type guard: receivable debited, income credited,
    // nothing on an expense account. On failure the move is reset + cancelled
    // and NOT linked, so a wrong entry never stays posted in the books.
    const invLines = await readMoveLinesWithTypes(env, moveId);
    const invGuard = evaluateInvoiceGuard({ moveState: head?.state ?? "", lines: invLines });
    if (!invGuard.ok) {
      await cancelMoveQuietly(env, moveId);
      const msg = `[accounting] فاتورة ${args.invoiceNumber}: قيد ${moveId} رُفض وأُلغي — ${invGuard.reasons.join("؛ ")}`;
      console.error(msg);
      try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
      return null;
    }

    await call<boolean>(env, "x_invoice", "write", {
      ids: [args.invoiceId],
      vals: { x_account_move_id: moveId },
    });
    console.log(`[accounting] linked x_invoice ${args.invoiceId} → account.move ${moveId} (state=${head?.state})`);
    return moveId;
  } catch (e) {
    const msg = `[accounting] invoice ${args.invoiceNumber} sync failed: ${(e as Error).message}`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* swallow — alert must not block */ }
    return null;
  }
}

export type PaymentMethod = "cash" | "transfer";

/** Journal each collection method targets. */
export function journalIdForMethod(env: Env, method: PaymentMethod): "CSHD" | "BNK1" {
  return method === "cash" ? "CSHD" : "BNK1";
}

export interface AccountingPaymentArgs {
  paymentId: number;
  /** Pre-existing link on x_payment. */
  existingPaymentMoveId: number | null;
  invoiceMoveId: number | null; // linked account.move (x_invoice.x_account_move_id)
  invoiceNumber: string;
  amount: number;
  method: PaymentMethod;
  /** YYYY-MM-DD; defaults to Riyadh today. */
  paymentDate?: string;
}

async function findJournalId(env: Env, code: "CSHD" | "BNK1"): Promise<number | null> {
  const rows = await call<Array<{ id: number; code: string }>>(env, "account.journal", "search_read", {
    domain: [["code", "=", code]],
    fields: ["id", "code"],
    limit: 1,
  });
  return rows[0]?.id ?? null;
}

/**
 * Sync one x_payment → account.payment reconciled against the linked
 * account.move. Uses the account.payment.register wizard so Odoo builds
 * the balanced journal entry and does the reconciliation for us.
 *
 * If `invoiceMoveId` is null (legacy x_invoice with no account.move twin)
 * we skip with a warning; we never create a floating payment that cannot
 * settle a receivable.
 *
 * Idempotent: `args.existingPaymentMoveId` short-circuits.
 * NEVER throws.
 */
export async function syncPaymentToAccounting(
  env: Env,
  args: AccountingPaymentArgs,
): Promise<number | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  if (args.existingPaymentMoveId && args.existingPaymentMoveId > 0) {
    console.log(`[accounting] payment ${args.paymentId} already linked → skip`);
    return args.existingPaymentMoveId;
  }
  if (!args.invoiceMoveId || args.invoiceMoveId <= 0) {
    console.warn(`[accounting] payment ${args.paymentId} skipped — invoice ${args.invoiceNumber} has no account.move twin`);
    return null;
  }
  try {
    const journalCode = journalIdForMethod(env, args.method);
    const journalId = await findJournalId(env, journalCode);
    if (!journalId) {
      throw new Error(`journal ${journalCode} not found — has scripts/acct-20260921-setup.mjs run?`);
    }
    const paymentDate = args.paymentDate ?? todayRiyadhYmd();

    // The invoice's commercial partner — used to filter the fallback search
    // so two same-amount collections on the same day can never cross-link.
    type InvHead = {
      id: number;
      commercial_partner_id: [number, string] | false;
      partner_id: [number, string] | false;
      amount_residual: number;
    };
    const [inv] = await call<InvHead[]>(env, "account.move", "read", {
      ids: [args.invoiceMoveId],
      fields: ["id", "commercial_partner_id", "partner_id", "amount_residual"],
    });
    // A payment that covers the whole open balance must leave the invoice
    // paid / in_payment; a smaller one legitimately leaves it partial.
    const expectFull = args.amount + 0.005 >= (inv?.amount_residual ?? 0);
    const partnerId = inv?.commercial_partner_id
      ? inv.commercial_partner_id[0]
      : inv?.partner_id ? inv.partner_id[0] : null;
    if (!partnerId) throw new Error(`invoice move ${args.invoiceMoveId} has no partner`);

    const wizardCtx = {
      active_model: "account.move",
      active_ids: [args.invoiceMoveId],
      active_id: args.invoiceMoveId,
    };
    // account.payment.register is a TransientModel: create with a context
    // that names the invoice, write the payment values, then call
    // action_create_payments — which posts the payment and reconciles.
    const [wizardId] = await call<number[]>(env, "account.payment.register", "create", {
      vals_list: [{
        journal_id: journalId,
        amount: args.amount,
        payment_date: paymentDate,
        // currency_id deliberately omitted — the wizard takes it from the
        // invoice. Passing false (as before 2026-09-23) went unnoticed while
        // payments produced no entry; once payment_account_id was set Odoo
        // builds the move and rejects it: "Missing required field Currency".
      }],
      context: wizardCtx,
    });

    const actionResult = await call<unknown>(env, "account.payment.register", "action_create_payments", {
      ids: [wizardId],
      context: wizardCtx,
    });

    // 2026-09-23 — take the payment id from the action Odoo returns (Odoo 19
    // JSON-2: an ir.actions.act_window with res_model=account.payment and
    // res_id). Only if that is missing fall back to a search filtered by
    // partner + amount + journal + date together.
    let paymentRecId = extractPaymentIdFromAction(actionResult);
    let located = "action";
    if (!paymentRecId) {
      type PaymentRow = { id: number };
      const rows = await call<PaymentRow[]>(env, "account.payment", "search_read", {
        domain: buildPaymentSearchDomain({ partnerId, amount: args.amount, journalId, date: paymentDate }),
        fields: ["id"],
        order: "id desc",
        limit: 1,
      });
      paymentRecId = rows[0]?.id ?? null;
      located = "search";
    }
    if (!paymentRecId) {
      throw new Error("account.payment created but could not be located afterwards");
    }

    // 2026-09-23 — account-type guard. On any failure: cancel the payment,
    // alert the owner, leave the invoice unsettled, do not link. The caller
    // (x_payment + WhatsApp) carries on either way.
    const facts = await readPaymentFacts(env, paymentRecId, args.invoiceMoveId);
    const guard = evaluatePaymentGuard({ ...facts, expectedPartnerId: partnerId, expectFull });
    if (!guard.ok) {
      await cancelPaymentQuietly(env, paymentRecId);
      const msg = `[accounting] تحصيل الفاتورة ${args.invoiceNumber} (${args.method}): الدفعة ${paymentRecId} أُلغيت — ${guard.reasons.join("؛ ")}`;
      console.error(msg);
      try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
      return null;
    }

    await call<boolean>(env, "x_payment", "write", {
      ids: [args.paymentId],
      vals: { x_account_payment_id: paymentRecId },
    });
    console.log(`[accounting] linked x_payment ${args.paymentId} → account.payment ${paymentRecId} (${journalCode}, located via ${located}, invoice ${facts.invoicePaymentState})`);
    return paymentRecId;
  } catch (e) {
    const msg = `[accounting] payment for ${args.invoiceNumber} (${args.method}) sync failed: ${(e as Error).message}`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* swallow */ }
    return null;
  }
}

// ---- 2026-09-23: payment lookup + account-type guards ----

/**
 * Payment id from the action account.payment.register.action_create_payments
 * returns. One payment → {res_model: "account.payment", res_id: N}; several →
 * a domain [["id", "in", [...]]] (we register one invoice, so take the only
 * id). Anything else → null and the caller falls back to a filtered search.
 */
export function extractPaymentIdFromAction(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { res_model?: unknown; res_id?: unknown; domain?: unknown };
  if (r.res_model !== "account.payment") return null;
  if (typeof r.res_id === "number" && r.res_id > 0) return r.res_id;
  if (Array.isArray(r.domain)) {
    for (const leaf of r.domain) {
      if (Array.isArray(leaf) && leaf[0] === "id" && leaf[1] === "in" && Array.isArray(leaf[2]) && leaf[2].length === 1) {
        const id = leaf[2][0];
        if (typeof id === "number" && id > 0) return id;
      }
    }
  }
  return null;
}

/** Fallback search domain — partner, amount, journal and date all together. */
export function buildPaymentSearchDomain(a: {
  partnerId: number;
  amount: number;
  journalId: number;
  date: string;
}): Array<[string, string, unknown]> {
  return [
    ["partner_id", "=", a.partnerId],
    ["amount", "=", a.amount],
    ["journal_id", "=", a.journalId],
    ["date", "=", a.date],
  ];
}

export interface GuardLine {
  account_code: string;
  account_type: string;
  debit: number;
  credit: number;
}

export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

const PAYMENT_DEBIT_TYPES: ReadonlySet<string> = new Set(["asset_cash", "asset_current"]);
const INCOME_TYPES: ReadonlySet<string> = new Set(["income", "income_other"]);
const EXPENSE_TYPES: ReadonlySet<string> = new Set([
  "expense", "expense_depreciation", "expense_direct_cost",
]);

export interface PaymentFacts {
  paymentState: string;
  paymentPartnerId: number | null;
  moveId: number | null;
  moveState: string;
  lines: GuardLine[];
  invoicePaymentState: string;
}

/**
 * After action_create_payments. Odoo 19 account.payment has no "posted"
 * state (draft / paid / reconciled / canceled / rejected) — the posted
 * check is on the payment's journal entry (move_id.state).
 */
export function evaluatePaymentGuard(
  f: PaymentFacts & { expectedPartnerId: number; expectFull: boolean },
): GuardResult {
  const reasons: string[] = [];
  if (!f.moveId) reasons.push("الدفعة بلا قيد (move_id فارغ)");
  if (f.moveId && f.moveState !== "posted") reasons.push(`قيد الدفعة حالته ${f.moveState || "?"} وليس posted`);
  if (f.paymentState === "canceled" || f.paymentState === "rejected" || f.paymentState === "draft") {
    reasons.push(`حالة الدفعة ${f.paymentState}`);
  }
  if (f.paymentPartnerId !== f.expectedPartnerId) {
    reasons.push(`شريك الدفعة ${f.paymentPartnerId ?? "?"} ≠ شريك الفاتورة ${f.expectedPartnerId}`);
  }
  const debits = f.lines.filter((l) => l.debit > 0);
  if (f.moveId && debits.length === 0) reasons.push("لا يوجد سطر مدين في قيد الدفعة");
  for (const l of debits) {
    if (!PAYMENT_DEBIT_TYPES.has(l.account_type)) {
      reasons.push(`الحساب المدين ${l.account_code} من نوع ${l.account_type} (المسموح asset_cash أو asset_current)`);
    }
  }
  for (const l of f.lines) {
    if (INCOME_TYPES.has(l.account_type) || EXPENSE_TYPES.has(l.account_type)) {
      reasons.push(`قيد الدفعة يمس حساب ${l.account_type} ${l.account_code}`);
    }
  }
  const settled = f.invoicePaymentState === "paid" || f.invoicePaymentState === "in_payment";
  if (f.expectFull && !settled) {
    reasons.push(`حالة سداد الفاتورة ${f.invoicePaymentState || "?"} (المتوقع paid أو in_payment)`);
  }
  if (!f.expectFull && f.invoicePaymentState !== "partial" && !settled) {
    reasons.push(`حالة سداد الفاتورة ${f.invoicePaymentState || "?"} بعد دفعة جزئية (المتوقع partial)`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Invoice: receivable debited, income credited, no expense line, posted. */
export function evaluateInvoiceGuard(f: { moveState: string; lines: GuardLine[] }): GuardResult {
  const reasons: string[] = [];
  if (f.moveState !== "posted") reasons.push(`الفاتورة حالتها ${f.moveState || "?"} وليس posted`);
  const recvDebit = f.lines.filter((l) => l.account_type === "asset_receivable" && l.debit > 0);
  const incomeCredit = f.lines.filter((l) => INCOME_TYPES.has(l.account_type) && l.credit > 0);
  if (recvDebit.length === 0) reasons.push("لا يوجد سطر ذمم مدينة (asset_receivable) مدين");
  if (incomeCredit.length === 0) reasons.push("لا يوجد سطر إيراد (income) دائن");
  for (const l of f.lines) {
    if (EXPENSE_TYPES.has(l.account_type)) reasons.push(`الفاتورة تمس حساب مصروف ${l.account_code}`);
    if (l.account_type === "asset_receivable" && l.credit > 0) reasons.push(`الذمم ${l.account_code} دائنة في فاتورة بيع`);
    if (INCOME_TYPES.has(l.account_type) && l.debit > 0) reasons.push(`الإيراد ${l.account_code} مدين في فاتورة بيع`);
  }
  return { ok: reasons.length === 0, reasons };
}

async function readMoveLinesWithTypes(env: Env, moveId: number): Promise<GuardLine[]> {
  type Line = { account_id: [number, string] | false; debit: number; credit: number };
  const lines = await call<Line[]>(env, "account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]],
    fields: ["account_id", "debit", "credit"],
    limit: 200,
  });
  const accIds = Array.from(new Set(lines.map((l) => (l.account_id ? l.account_id[0] : 0)).filter((n) => n > 0)));
  const accs = accIds.length
    ? await call<Array<{ id: number; code: string; account_type: string }>>(env, "account.account", "read", {
        ids: accIds,
        fields: ["id", "code", "account_type"],
      })
    : [];
  const byId = new Map(accs.map((a) => [a.id, a]));
  return lines.map((l) => {
    const a = l.account_id ? byId.get(l.account_id[0]) : undefined;
    return {
      account_code: a?.code ?? "?",
      account_type: a?.account_type ?? "?",
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
    };
  });
}

async function readPaymentFacts(env: Env, paymentId: number, invoiceMoveId: number): Promise<PaymentFacts> {
  type Pay = { id: number; state: string; move_id: [number, string] | false; partner_id: [number, string] | false };
  const [p] = await call<Pay[]>(env, "account.payment", "read", {
    ids: [paymentId],
    fields: ["id", "state", "move_id", "partner_id"],
  });
  const moveId = p?.move_id ? p.move_id[0] : null;
  let moveState = "";
  let lines: GuardLine[] = [];
  if (moveId) {
    const [m] = await call<Array<{ id: number; state: string }>>(env, "account.move", "read", {
      ids: [moveId],
      fields: ["id", "state"],
    });
    moveState = m?.state ?? "";
    lines = await readMoveLinesWithTypes(env, moveId);
  }
  const [inv] = await call<Array<{ id: number; payment_state: string }>>(env, "account.move", "read", {
    ids: [invoiceMoveId],
    fields: ["id", "payment_state"],
  });
  return {
    paymentState: p?.state ?? "",
    paymentPartnerId: p?.partner_id ? p.partner_id[0] : null,
    moveId,
    moveState,
    lines,
    invoicePaymentState: inv?.payment_state ?? "",
  };
}

/** Reset + cancel a payment. Cancelling unreconciles and voids its entry. */
async function cancelPaymentQuietly(env: Env, paymentId: number): Promise<void> {
  try { await call<boolean>(env, "account.payment", "action_draft", { ids: [paymentId] }); }
  catch (e) { console.warn(`[accounting] payment ${paymentId} action_draft:`, (e as Error).message); }
  try { await call<boolean>(env, "account.payment", "action_cancel", { ids: [paymentId] }); }
  catch (e) { console.warn(`[accounting] payment ${paymentId} action_cancel:`, (e as Error).message); }
}

async function cancelMoveQuietly(env: Env, moveId: number): Promise<void> {
  try { await call<boolean>(env, "account.move", "button_draft", { ids: [moveId] }); }
  catch (e) { console.warn(`[accounting] move ${moveId} button_draft:`, (e as Error).message); }
  try { await call<boolean>(env, "account.move", "button_cancel", { ids: [moveId] }); }
  catch (e) { console.warn(`[accounting] move ${moveId} button_cancel:`, (e as Error).message); }
}

// ---- Small readers used by the admin verify route ----

export interface TrialBalanceRow {
  account_id: number;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Read all posted move lines for one partner and roll them up by account. */
export async function readPartnerTrialBalance(
  env: Env,
  partnerId: number,
): Promise<TrialBalanceRow[]> {
  type Line = {
    id: number;
    account_id: [number, string] | false;
    debit: number;
    credit: number;
    parent_state: string;
  };
  const lines = await call<Line[]>(env, "account.move.line", "search_read", {
    domain: [
      ["partner_id", "=", partnerId],
      ["parent_state", "=", "posted"],
    ],
    fields: ["id", "account_id", "debit", "credit", "parent_state"],
    limit: 500,
  });
  const byAcc = new Map<number, TrialBalanceRow>();
  const accIds = new Set<number>();
  for (const l of lines) {
    if (!l.account_id) continue;
    accIds.add(l.account_id[0]);
  }
  const accInfo = accIds.size
    ? await call<Array<{ id: number; code: string; name: string }>>(env, "account.account", "read", {
        ids: Array.from(accIds),
        fields: ["id", "code", "name"],
      })
    : [];
  const infoById = new Map(accInfo.map((r) => [r.id, r]));
  for (const l of lines) {
    if (!l.account_id) continue;
    const id = l.account_id[0];
    const info = infoById.get(id);
    const row = byAcc.get(id) ?? {
      account_id: id,
      account_code: info?.code ?? "?",
      account_name: info?.name ?? String(id),
      debit: 0,
      credit: 0,
      balance: 0,
    };
    row.debit += l.debit ?? 0;
    row.credit += l.credit ?? 0;
    row.balance = row.debit - row.credit;
    byAcc.set(id, row);
  }
  return Array.from(byAcc.values()).sort((a, b) => a.account_code.localeCompare(b.account_code));
}
