// Purchase → accounting parallel-write. Gated behind ACCOUNTING_SYNC — added
// 2026-09-23.
//
// When the warehouse closes a purchase list (button purchase_done_<id> →
// warehouseConfirmedPurchase), this module turns the x_purchase_list into:
//   purchase.order (confirmed) → vendor bill account.move (in_invoice, posted)
// so COGS (400001) and supplier payables (201002) show in the statements.
// No payment is created here — the payable stays open.
//
// Inputs on x_purchase_list:
//   x_supplier_id                      who was paid (res.partner)
//   x_aggregated_items[].unit_price    what was paid per packaging unit
//
// No stock: every PO line uses the service product UTAK-PUR-GOODS
// («بضاعة مشتراة (وسيط)», expense 400001), so button_confirm creates no
// stock.picking. The item name / packaging / quantity go on the line text.
//
// Tax (decisions 2026-09-23): bill date (Riyadh) before VAT_EFFECTIVE_DATE →
// no tax whatever the supplier. From the cutoff: supplier with res.partner.vat
// → the paid price includes 15% and is split (115 → 100 + 15 VAT input);
// supplier without vat → no tax at all. The tax is the price-included twin of
// res.company.account_purchase_tax_id, found live in Odoo (never hard-coded).
//
// Idempotent: either x_purchase_order_id or x_account_move_id set → skip. A
// live PO whose origin is this list but that was never linked also blocks a
// second create (owner alerted) — a crash between confirm and link can never
// produce a duplicate purchase.
//
// Guard on the posted bill: expense debited (expense_direct_cost / expense),
// payable credited (liability_payable), a debited tax line only when the
// supplier is registered and the date is past the cutoff, balanced, total =
// paid amount. Any failure → bill and PO cancelled, owner alerted
// (T.OWNER_ALERT) with the list number and reason, nothing linked. The
// x_purchase_list flow and WhatsApp never stop. NEVER throws.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import type { PurchaseListItem } from "./types";
import { call } from "./odoo";
import { sendOwnerAlert } from "./templates";
import {
  computeInclusiveTotals,
  isAccountingSyncEnabled,
  roundHalala,
  todayRiyadhYmd,
  type GuardLine,
  type GuardResult,
} from "./accounting";

export const PURCHASE_GOODS_PRODUCT_CODE = "UTAK-PUR-GOODS";

/** purchase.order.origin for a list — also the orphan-PO search key. */
export function purchaseListOrigin(listId: number): string {
  return `x_purchase_list/${listId}`;
}

/** A supplier is VAT-registered when res.partner.vat holds a non-empty value. */
export function supplierIsVatRegistered(vat: unknown): boolean {
  return typeof vat === "string" && vat.trim().length > 0;
}

export interface PurchaseTax {
  id: number;
  /** Percent, e.g. 15. */
  rate: number;
}

/**
 * The price-INCLUDED purchase tax: the company's account_purchase_tax_id if
 * it is already included, otherwise its included twin (same rate, same tax
 * group, price_include_override = tax_included — created by
 * scripts/acct-20260923-purchase-setup.mjs). Throws when neither is usable.
 */
export async function resolveCompanyPurchaseTaxIncluded(env: Env): Promise<PurchaseTax> {
  type Co = { id: number; account_purchase_tax_id: [number, string] | false };
  const [co] = await call<Co[]>(env, "res.company", "read", { ids: [1], fields: ["id", "account_purchase_tax_id"] });
  if (!co?.account_purchase_tax_id) throw new Error("res.company.account_purchase_tax_id فارغ — ضريبة الشراء غير مضبوطة");
  type Tax = {
    id: number; amount: number; amount_type: string; type_tax_use: string;
    price_include: boolean; active: boolean; tax_group_id: [number, string] | false;
  };
  const fields = ["id", "amount", "amount_type", "type_tax_use", "price_include", "active", "tax_group_id"];
  const [base] = await call<Tax[]>(env, "account.tax", "read", { ids: [co.account_purchase_tax_id[0]], fields });
  if (!base || !base.active || base.type_tax_use !== "purchase" || base.amount_type !== "percent" || !(base.amount > 0)) {
    throw new Error(`ضريبة الشراء ${co.account_purchase_tax_id[0]} غير صالحة`);
  }
  if (base.price_include) return { id: base.id, rate: base.amount };
  const domain: unknown[] = [
    ["type_tax_use", "=", "purchase"],
    ["amount_type", "=", "percent"],
    ["amount", "=", base.amount],
    ["price_include_override", "=", "tax_included"],
    ["active", "=", true],
  ];
  if (base.tax_group_id) domain.push(["tax_group_id", "=", base.tax_group_id[0]]);
  const [twin] = await call<Tax[]>(env, "account.tax", "search_read", { domain, fields, order: "id", limit: 1 });
  if (!twin || !twin.price_include) {
    throw new Error(`لا توجد ضريبة شراء ${base.amount}% شاملة في السعر (شغّل scripts/acct-20260923-purchase-setup.mjs)`);
  }
  return { id: twin.id, rate: twin.amount };
}

/** null = no tax (before the cutoff, or supplier not VAT-registered). */
export async function resolvePurchaseTaxForBill(
  env: Env,
  a: { supplierVat: unknown; billDate: string; vatEffectiveDate?: string },
): Promise<PurchaseTax | null> {
  if (!isVatApplicable(a.billDate, a.vatEffectiveDate)) return null;
  if (!supplierIsVatRegistered(a.supplierVat)) return null;
  return resolveCompanyPurchaseTaxIncluded(env);
}

/** x_aggregated_items JSON → items. Throws on malformed JSON. */
export function parsePurchaseListItems(raw: unknown): PurchaseListItem[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("x_aggregated_items ليس مصفوفة");
  return parsed as PurchaseListItem[];
}

/** Reasons the items cannot become a purchase order (empty = fine). */
export function validatePurchaseItems(items: PurchaseListItem[]): string[] {
  const reasons: string[] = [];
  const priced = items.filter((it) => Number(it.total_quantity) > 0);
  if (priced.length === 0) reasons.push("لا أصناف بكمية في القائمة");
  for (const it of priced) {
    const p = it.unit_price;
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) {
      reasons.push(`«${it.product_name} — ${it.packaging_name}» بلا سعر شراء (unit_price)`);
    }
  }
  return reasons;
}

/** order_line commands; every line pins tax_ids (empty = no tax). */
export function buildPurchaseOrderLineCommands(
  items: PurchaseListItem[],
  productId: number,
  taxIds: number[],
): Array<[number, number, Record<string, unknown>]> {
  return items
    .filter((it) => Number(it.total_quantity) > 0)
    .map((it) => [0, 0, {
      product_id: productId,
      name: `${it.product_name} — ${it.packaging_name}`,
      product_qty: it.total_quantity,
      price_unit: it.unit_price,
      tax_ids: [[6, 0, [...taxIds]]],
    }]);
}

export interface VendorBillTaxExpectation {
  /** Supplier VAT-registered AND bill date on/after the cutoff. */
  expectTax: boolean;
  expectedTax: number;
  amountTax: number;
  /** What was paid (sum of unit_price × qty). */
  expectedTotal: number;
  amountTotal: number;
}

const COST_TYPES: ReadonlySet<string> = new Set(["expense_direct_cost", "expense"]);

/**
 * Vendor bill: posted in_invoice; cost debited on expense_direct_cost /
 * expense; payable credited on liability_payable; a debited tax line only
 * when expected (amount = per-line split); balanced; total = paid amount.
 * Any other line (income, receivable, a credited cost …) is refused.
 */
export function evaluateVendorBillGuard(f: {
  moveState: string;
  moveType: string;
  lines: GuardLine[];
  tax: VendorBillTaxExpectation;
}): GuardResult {
  const reasons: string[] = [];
  if (f.moveType !== "in_invoice") reasons.push(`نوع القيد ${f.moveType || "?"} وليس in_invoice`);
  if (f.moveState !== "posted") reasons.push(`فاتورة المورد حالتها ${f.moveState || "?"} وليس posted`);

  const taxLines = f.lines.filter((l) => l.is_tax);
  const other = f.lines.filter((l) => !l.is_tax);
  const costDebit = other.filter((l) => COST_TYPES.has(l.account_type) && l.debit > 0);
  const payCredit = other.filter((l) => l.account_type === "liability_payable" && l.credit > 0);
  if (costDebit.length === 0) reasons.push("لا يوجد سطر تكلفة (expense_direct_cost أو expense) مدين");
  if (payCredit.length === 0) reasons.push("لا يوجد سطر ذمم دائنة (liability_payable) دائن");
  for (const l of other) {
    const isCost = COST_TYPES.has(l.account_type);
    const isPay = l.account_type === "liability_payable";
    if (!isCost && !isPay) reasons.push(`فاتورة المورد تمس حساب ${l.account_type} ${l.account_code}`);
    if (isCost && l.credit > 0) reasons.push(`التكلفة ${l.account_code} دائنة في فاتورة مورد`);
    if (isPay && l.debit > 0) reasons.push(`الذمم الدائنة ${l.account_code} مدينة في فاتورة مورد`);
  }

  const taxDebit = roundHalala(taxLines.reduce((a, l) => a + l.debit - l.credit, 0));
  if (f.tax.expectTax) {
    if (taxLines.length === 0 || taxDebit <= 0) {
      reasons.push("مورد مسجل بعد تاريخ السريان وفاتورته بلا سطر ضريبة مدخلات");
    } else if (Math.abs(taxDebit - f.tax.expectedTax) > 0.005 || Math.abs(f.tax.amountTax - f.tax.expectedTax) > 0.005) {
      reasons.push(`ضريبة المدخلات ${f.tax.amountTax} (سطر ${taxDebit}) ≠ المتوقع ${f.tax.expectedTax}`);
    }
  } else if (taxLines.length > 0 || Math.abs(f.tax.amountTax) > 0.005) {
    reasons.push(`فاتورة مورد عليها ضريبة ${f.tax.amountTax} والمتوقع بلا ضريبة (مورد غير مسجل أو قبل تاريخ السريان)`);
  }

  const d = roundHalala(f.lines.reduce((a, l) => a + l.debit, 0));
  const c = roundHalala(f.lines.reduce((a, l) => a + l.credit, 0));
  if (Math.abs(d - c) > 0.005) reasons.push(`القيد غير متوازن: مدين ${d} ≠ دائن ${c}`);
  if (Math.abs(f.tax.amountTotal - f.tax.expectedTotal) > 0.005) {
    reasons.push(`إجمالي الفاتورة ${f.tax.amountTotal} ≠ المدفوع ${f.tax.expectedTotal}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface PurchaseSyncOptions {
  /** YYYY-MM-DD (Riyadh); defaults to today. Odoo refuses future dates. */
  billDate?: string;
  /** Live-verify only: pretend VAT starts on this date. Runtime never sets it. */
  vatEffectiveDate?: string;
}

export interface PurchaseSyncResult {
  purchaseOrderId: number;
  moveId: number;
  skipped: boolean;
}

/**
 * Sync one closed x_purchase_list → purchase.order + posted vendor bill.
 * Returns the linked ids, or null on any refusal/failure (owner alerted).
 */
export async function syncPurchaseListToAccounting(
  env: Env,
  listId: number,
  opts: PurchaseSyncOptions = {},
): Promise<PurchaseSyncResult | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  let poId: number | null = null;
  let billId: number | null = null;
  const fail = async (reason: string): Promise<null> => {
    if (billId) await cancelMoveQuietly(env, billId);
    if (poId) await cancelPurchaseOrderQuietly(env, poId);
    const msg = `[purchase-accounting] قائمة الشراء #${listId}: ${reason}` +
      (billId || poId ? ` — أُلغي${billId ? ` القيد ${billId}` : ""}${poId ? ` وأمر الشراء ${poId}` : ""}` : "") +
      "، ولم يُربط شيء";
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
    return null;
  };

  try {
    type ListRow = {
      id: number;
      x_supplier_id: [number, string] | false;
      x_purchase_order_id: [number, string] | false;
      x_account_move_id: [number, string] | false;
      x_aggregated_items: string | false;
    };
    const [list] = await call<ListRow[]>(env, "x_purchase_list", "read", {
      ids: [listId],
      fields: ["id", "x_supplier_id", "x_purchase_order_id", "x_account_move_id", "x_aggregated_items"],
    });
    if (!list) return await fail("القائمة غير موجودة");
    if (list.x_purchase_order_id || list.x_account_move_id) {
      console.log(`[purchase-accounting] list ${listId} already linked (po=${list.x_purchase_order_id ? list.x_purchase_order_id[0] : "-"}, move=${list.x_account_move_id ? list.x_account_move_id[0] : "-"}) — skip`);
      return {
        purchaseOrderId: list.x_purchase_order_id ? list.x_purchase_order_id[0] : 0,
        moveId: list.x_account_move_id ? list.x_account_move_id[0] : 0,
        skipped: true,
      };
    }
    if (!list.x_supplier_id) return await fail("المورد (x_supplier_id) غير محدد");
    const supplierId = list.x_supplier_id[0];

    let items: PurchaseListItem[];
    try { items = parsePurchaseListItems(list.x_aggregated_items); }
    catch (e) { return await fail(`x_aggregated_items تالف: ${(e as Error).message}`); }
    const itemReasons = validatePurchaseItems(items);
    if (itemReasons.length) return await fail(itemReasons.join("؛ "));

    const origin = purchaseListOrigin(listId);
    const orphans = await call<Array<{ id: number; name: string; state: string }>>(env, "purchase.order", "search_read", {
      domain: [["origin", "=", origin], ["state", "!=", "cancel"]],
      fields: ["id", "name", "state"],
      limit: 5,
    });
    if (orphans.length) {
      return await fail(`يوجد أمر شراء قائم لهذه القائمة غير مربوط (${orphans.map((o) => `${o.name}/${o.id}`).join("، ")}) — راجعه يدوياً`);
    }

    const [product] = await call<Array<{ id: number }>>(env, "product.product", "search_read", {
      domain: [["default_code", "=", PURCHASE_GOODS_PRODUCT_CODE], ["type", "=", "service"]],
      fields: ["id"],
      limit: 1,
    });
    if (!product) return await fail(`منتج الخدمة ${PURCHASE_GOODS_PRODUCT_CODE} غير موجود (شغّل scripts/acct-20260923-purchase-setup.mjs)`);

    const [supplier] = await call<Array<{ id: number; vat: string | false }>>(env, "res.partner", "read", {
      ids: [supplierId],
      fields: ["id", "vat"],
    });
    const billDate = opts.billDate ?? todayRiyadhYmd();
    const tax = await resolvePurchaseTaxForBill(env, {
      supplierVat: supplier?.vat, billDate, vatEffectiveDate: opts.vatEffectiveDate,
    });
    const priced = items.filter((it) => Number(it.total_quantity) > 0);
    const expected = computeInclusiveTotals(
      priced.map((it) => (it.unit_price as number) * it.total_quantity),
      tax?.rate ?? null,
    );

    const [createdPo] = await call<number[]>(env, "purchase.order", "create", {
      vals_list: [{
        partner_id: supplierId,
        origin,
        partner_ref: `PL-${listId}`,
        order_line: buildPurchaseOrderLineCommands(priced, product.id, tax ? [tax.id] : []),
      }],
    }, { probe: [["origin", "=", origin], ["state", "=", "draft"]] });
    poId = createdPo;
    await call<unknown>(env, "purchase.order", "button_confirm", { ids: [poId] });
    await call<unknown>(env, "purchase.order", "action_create_invoice", { ids: [poId] });
    const [po] = await call<Array<{ id: number; state: string; invoice_ids: number[] }>>(env, "purchase.order", "read", {
      ids: [poId],
      fields: ["id", "state", "invoice_ids"],
    });
    if (po?.state !== "purchase") return await fail(`أمر الشراء ${poId} حالته ${po?.state ?? "?"} بعد التأكيد`);
    if (!po.invoice_ids || po.invoice_ids.length !== 1) {
      billId = po?.invoice_ids?.[0] ?? null;
      return await fail(`أمر الشراء ${poId} أنتج ${po?.invoice_ids?.length ?? 0} فاتورة (المتوقع 1)`);
    }
    billId = po.invoice_ids[0];
    await call<boolean>(env, "account.move", "write", {
      ids: [billId],
      vals: { invoice_date: billDate, ref: `PL-${listId}` },
    });
    try {
      await call<boolean>(env, "account.move", "action_post", { ids: [billId] });
    } catch (e) {
      return await fail(`رفض Odoo ترحيل فاتورة المورد: ${(e as Error).message}`);
    }

    type Head = { id: number; state: string; move_type: string; amount_total: number; amount_tax: number };
    const [head] = await call<Head[]>(env, "account.move", "read", {
      ids: [billId],
      fields: ["id", "state", "move_type", "amount_total", "amount_tax"],
    });
    const lines = await readMoveLinesWithTypes(env, billId);
    const guard = evaluateVendorBillGuard({
      moveState: head?.state ?? "",
      moveType: head?.move_type ?? "",
      lines,
      tax: {
        expectTax: tax !== null,
        expectedTax: expected.tax,
        amountTax: head?.amount_tax ?? 0,
        expectedTotal: expected.total,
        amountTotal: head?.amount_total ?? 0,
      },
    });
    if (!guard.ok) return await fail(`حارس فاتورة المورد: ${guard.reasons.join("؛ ")}`);

    await call<boolean>(env, "x_purchase_list", "write", {
      ids: [listId],
      vals: { x_purchase_order_id: poId, x_account_move_id: billId },
    });
    console.log(`[purchase-accounting] linked x_purchase_list ${listId} → purchase.order ${poId} + bill ${billId} (total ${expected.total}, tax ${expected.tax})`);
    return { purchaseOrderId: poId, moveId: billId, skipped: false };
  } catch (e) {
    return await fail(`فشل الربط المحاسبي: ${(e as Error).message}`);
  }
}

async function readMoveLinesWithTypes(env: Env, moveId: number): Promise<GuardLine[]> {
  type Line = {
    account_id: [number, string] | false;
    debit: number;
    credit: number;
    display_type: string | false;
    tax_line_id: [number, string] | false;
  };
  const lines = await call<Line[]>(env, "account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]],
    fields: ["account_id", "debit", "credit", "display_type", "tax_line_id"],
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
      is_tax: l.display_type === "tax" || !!l.tax_line_id,
    };
  });
}

async function cancelMoveQuietly(env: Env, moveId: number): Promise<void> {
  try { await call<boolean>(env, "account.move", "button_draft", { ids: [moveId] }); }
  catch (e) { console.warn(`[purchase-accounting] move ${moveId} button_draft:`, (e as Error).message); }
  try { await call<boolean>(env, "account.move", "button_cancel", { ids: [moveId] }); }
  catch (e) { console.warn(`[purchase-accounting] move ${moveId} button_cancel:`, (e as Error).message); }
}

async function cancelPurchaseOrderQuietly(env: Env, poId: number): Promise<void> {
  try { await call<unknown>(env, "purchase.order", "button_cancel", { ids: [poId] }); }
  catch (e) { console.warn(`[purchase-accounting] purchase.order ${poId} button_cancel:`, (e as Error).message); }
}
