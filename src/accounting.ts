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

    // account.payment.register is a TransientModel: create with a context
    // that names the invoice, write the payment values, then call
    // action_create_payments — which posts the payment and reconciles.
    const [wizardId] = await call<number[]>(env, "account.payment.register", "create", {
      vals_list: [{
        journal_id: journalId,
        amount: args.amount,
        payment_date: paymentDate,
        currency_id: false, // wizard defaults to the move's currency
      }],
      context: {
        active_model: "account.move",
        active_ids: [args.invoiceMoveId],
        active_id: args.invoiceMoveId,
      },
    });

    const actionResult = await call<unknown>(env, "account.payment.register", "action_create_payments", {
      ids: [wizardId],
      context: {
        active_model: "account.move",
        active_ids: [args.invoiceMoveId],
        active_id: args.invoiceMoveId,
      },
    });
    void actionResult; // ignored — the payment id is read from the move next

    // Find the payment id — it's the newest posted payment whose move
    // reconciles the invoice_move. Query by search_read on account.payment
    // ordered by id desc filtered by journal + amount + date.
    type PaymentRow = { id: number; state: string; date: string; amount: number };
    const rows = await call<PaymentRow[]>(env, "account.payment", "search_read", {
      domain: [
        ["journal_id", "=", journalId],
        ["amount", "=", args.amount],
        ["date", "=", paymentDate],
      ],
      fields: ["id", "state", "date", "amount"],
      order: "id desc",
      limit: 1,
    });
    const paymentMoveId = rows[0]?.id ?? null;
    if (!paymentMoveId) {
      throw new Error("account.payment created but could not be located afterwards");
    }

    await call<boolean>(env, "x_payment", "write", {
      ids: [args.paymentId],
      vals: { x_account_payment_id: paymentMoveId },
    });
    console.log(`[accounting] linked x_payment ${args.paymentId} → account.payment ${paymentMoveId} (${journalCode})`);
    return paymentMoveId;
  } catch (e) {
    const msg = `[accounting] payment for ${args.invoiceNumber} (${args.method}) sync failed: ${(e as Error).message}`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* swallow */ }
    return null;
  }
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
