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
// → 15% VAT input; supplier without vat → no tax at all.
// § 47 أ (2026-10-01) — THE PURCHASE PRICE IS NET OF VAT: price_unit is the
// price as entered, and a registered supplier's 15% is ADDED on top of it
// (22 → 22 + 3.30 = 25.30 on the bill); an unregistered one's bill is the
// price itself (22). The tax is res.company.account_purchase_tax_id, read
// live in Odoo (never hard-coded), and it must be price-EXCLUDED: a
// price-included tax (the «15% شامل (مشتريات)» twin used before § 47) would
// split the net price instead of adding to it, and is refused.
//
// § 44 هـ (2026-09-28) — ONE VENDOR BILL PER SUPPLIER. A list whose items
// came from more than one supplier (Ahmed, and «مشتريات السوق النقدية» #104
// for the lines Omar's written market purchase price won in «أسعار اليوم» —
// the attribution of the supplier dues, src/supplier-pay.ts planDues) gets a
// purchase.order + bill per supplier, with that supplier's lines and prices:
// his own item at the list's unit_price, a market-won item at Omar's written
// price. The input tax is split only for a supplier with a VAT number on his
// card and a bill dated from 10-01 (per bill). A no-VAT bill of the cash market
// from 10-01 → ONE line a day to Baraa «مشتريات سوق بلا رقم ضريبي: X ر.س،
// ضريبتها لا تُخصم» (X = the day's no-VAT cash-market bills).
//
// Idempotent, per supplier: the purchase.order's origin is fixed
// (x_purchase_list/<list>/s<supplier>) and searched before every create — a
// live one is never created twice (a posted bill → «already»; none → the owner
// is alerted). The list is linked (x_purchase_order_id / x_account_move_id, the
// list supplier's bill first) only when EVERY supplier's bill is posted, so a
// linked list is complete and skipped, and a partial one completes on a re-run.
// A live PO of the old single-bill origin (x_purchase_list/<list>) still blocks
// the whole list (owner alerted) — a crash between confirm and link can never
// produce a duplicate purchase.
//
// Guard on the posted bill: expense debited (expense_direct_cost / expense),
// payable credited (liability_payable), a debited tax line only when the
// supplier is registered and the date is past the cutoff, balanced, total =
// what is owed (the net amount, plus the tax when there is one). Any failure → bill and PO cancelled, owner alerted
// (T.OWNER_ALERT) with the list number and reason, nothing linked. The
// x_purchase_list flow and WhatsApp never stop. NEVER throws.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import type { PurchaseListItem } from "./types";
import { call } from "./odoo";
import { sendOwnerAlert } from "./templates";
import { findCashMarketSupplier, winnerKey, type MarketWinners } from "./cash-market";
import {
  isAccountingSyncEnabled,
  roundHalala,
  todayRiyadhYmd,
  type GuardLine,
  type GuardResult,
} from "./accounting";

export const PURCHASE_GOODS_PRODUCT_CODE = "UTAK-PUR-GOODS";

/** purchase.order.origin of the old single bill of a list — still the orphan-PO search key. */
export function purchaseListOrigin(listId: number): string {
  return `x_purchase_list/${listId}`;
}

/** § 44 هـ — the fixed purchase.order.origin of one supplier's bill of a list (searched before every create). */
export function purchaseBillOrigin(listId: number, supplierId: number): string {
  return `${purchaseListOrigin(listId)}/s${supplierId}`;
}

/** § 44 ز — the bill's reference: the purchase list's number (the supplier's own invoice number has no field yet). */
export function purchaseBillRef(listId: number): string {
  return `PL-${listId}`;
}

export const CASH_NO_VAT_PREFIX = "مشتريات سوق بلا رقم ضريبي";
/** § 44 هـ — Baraa's one line a day. */
export function cashNoVatText(totalSar: number): string {
  const r = Math.round(totalSar * 100) / 100;
  return `${CASH_NO_VAT_PREFIX}: ${Number.isInteger(r) ? r : r.toFixed(2)} ر.س، ضريبتها لا تُخصم`;
}

export interface SupplierBillPlan {
  supplierId: number;
  /** The supplier's items, each at the price he is paid (unit_price). */
  items: PurchaseListItem[];
  /** The market-won lines (owed to «مشتريات السوق النقدية»). */
  market: boolean;
}

/**
 * § 44 هـ — the list's items per supplier (the supplier dues' attribution): a
 * line whose winning purchase price came from a market source goes to the
 * cash-market supplier at that written price; any other to its own supplier
 * (price_supplier_id, else the list's) at the list's unit_price. No supplier →
 * `noSupplier`. The list's supplier first, then by id.
 */
export function planSupplierBills(
  items: PurchaseListItem[],
  listSupplierId: number | null,
  market?: { cashSupplierId: number | null; winners: MarketWinners },
): { bills: SupplierBillPlan[]; noSupplier: PurchaseListItem[] } {
  const by = new Map<number, SupplierBillPlan>();
  const noSupplier: PurchaseListItem[] = [];
  for (const it of items) {
    if (!(Number(it.total_quantity) > 0)) continue;
    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));
    let sid: number | null;
    let line: PurchaseListItem = it;
    if (won) {
      sid = market!.cashSupplierId;
      line = { ...it, unit_price: won.price };
    } else {
      const p = Number((it as { price_supplier_id?: number | null }).price_supplier_id ?? 0);
      sid = p > 0 ? p : listSupplierId && listSupplierId > 0 ? listSupplierId : null;
    }
    if (!sid) { noSupplier.push(it); continue; }
    const b = by.get(sid) ?? { supplierId: sid, items: [], market: !!won };
    b.items.push(line);
    b.market = b.market || !!won;
    by.set(sid, b);
  }
  const bills = [...by.values()].sort((a, b) => (a.supplierId === listSupplierId ? -1 : b.supplierId === listSupplierId ? 1 : a.supplierId - b.supplierId));
  return { bills, noSupplier };
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
 * § 47 أ — the purchase tax that is ADDED on a net price: the company's
 * account_purchase_tax_id, which must be an active percent purchase tax and
 * price-EXCLUDED. Throws otherwise (a price-included tax would split the net
 * price: 22 → 19.13 + 2.87, not 22 + 3.30).
 */
export async function resolveCompanyPurchaseTaxExcluded(env: Env): Promise<PurchaseTax> {
  type Co = { id: number; account_purchase_tax_id: [number, string] | false };
  const [co] = await call<Co[]>(env, "res.company", "read", { ids: [1], fields: ["id", "account_purchase_tax_id"] });
  if (!co?.account_purchase_tax_id) throw new Error("res.company.account_purchase_tax_id فارغ — ضريبة الشراء غير مضبوطة");
  type Tax = { id: number; amount: number; amount_type: string; type_tax_use: string; price_include: boolean; active: boolean };
  const [base] = await call<Tax[]>(env, "account.tax", "read", {
    ids: [co.account_purchase_tax_id[0]],
    fields: ["id", "amount", "amount_type", "type_tax_use", "price_include", "active"],
  });
  if (!base || !base.active || base.type_tax_use !== "purchase" || base.amount_type !== "percent" || !(base.amount > 0)) {
    throw new Error(`ضريبة الشراء ${co.account_purchase_tax_id[0]} غير صالحة`);
  }
  if (base.price_include) {
    throw new Error(`ضريبة الشراء ${base.id} شاملة في السعر (price_include=true) — سعر الشراء يُدخَل بدون ضريبة، والمطلوب ضريبة تُضاف على السعر`);
  }
  return { id: base.id, rate: base.amount };
}

export interface NetTotals {
  /** Total before tax (sum of the lines' net amounts). */
  subtotal: number;
  /** Sum of the per-line taxes. */
  tax: number;
  /** What is owed: subtotal + tax. */
  total: number;
  lines: Array<{ net: number; tax: number; gross: number }>;
}

/**
 * § 47 أ — the totals of net (tax-excluded) line amounts: per line the tax =
 * round(net × rate ÷ 100), then summed (round_per_line — the rule configured
 * on the company). `ratePct` null/0 = no VAT: total = subtotal. 22 → 22 +
 * 3.30 = 25.30.
 */
export function computeNetTotals(lineNets: number[], ratePct: number | null): NetTotals {
  const lines = lineNets.map((n) => {
    const net = roundHalala(n);
    const tax = ratePct ? roundHalala((net * ratePct) / 100) : 0;
    return { net, tax, gross: roundHalala(net + tax) };
  });
  const sum = (k: "net" | "tax" | "gross") => roundHalala(lines.reduce((a, l) => a + l[k], 0));
  return { subtotal: sum("net"), tax: sum("tax"), total: sum("gross"), lines };
}

/** null = no tax (before the cutoff, or supplier not VAT-registered). */
export async function resolvePurchaseTaxForBill(
  env: Env,
  a: { supplierVat: unknown; billDate: string; vatEffectiveDate?: string },
): Promise<PurchaseTax | null> {
  if (!isVatApplicable(a.billDate, a.vatEffectiveDate)) return null;
  if (!supplierIsVatRegistered(a.supplierVat)) return null;
  return resolveCompanyPurchaseTaxExcluded(env);
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

/** order_line commands; price_unit is the net price as entered (§ 47 أ), and every line pins tax_ids (empty = no tax). */
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
  /** What is owed: Σ unit_price × qty (net), plus the tax when one is expected (§ 47 أ). */
  expectedTotal: number;
  amountTotal: number;
}

const COST_TYPES: ReadonlySet<string> = new Set(["expense_direct_cost", "expense"]);

/**
 * Vendor bill: posted in_invoice; cost debited on expense_direct_cost /
 * expense; payable credited on liability_payable; a debited tax line only
 * when expected (amount = the per-line tax added on the net); balanced; total = what is owed.
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
    reasons.push(`إجمالي الفاتورة ${f.tax.amountTotal} ≠ المستحق ${f.tax.expectedTotal}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface PurchaseSyncOptions {
  /** YYYY-MM-DD (Riyadh); defaults to today. Odoo refuses future dates. */
  billDate?: string;
  /** Live-verify only: pretend VAT starts on this date. Runtime never sets it. */
  vatEffectiveDate?: string;
}

export interface SupplierBillResult {
  supplierId: number;
  purchaseOrderId: number;
  moveId: number;
  /** Found by its fixed origin (not created now). */
  existed: boolean;
  tax: boolean;
  total: number;
}

export interface PurchaseSyncResult {
  /** The first bill (the list supplier's when it has one). */
  purchaseOrderId: number;
  moveId: number;
  skipped: boolean;
  /** § 44 هـ — one per supplier. */
  bills?: SupplierBillResult[];
  /** § 44 هـ — suppliers whose bill was refused (owner alerted), and items with no supplier. */
  failed?: number[];
  noSupplier?: number;
}

/**
 * Sync one closed x_purchase_list → a purchase.order + posted vendor bill per
 * supplier (§ 44 هـ). Returns the bills (the first one's ids on top), or null
 * when none could be made (owner alerted). NEVER throws.
 */
export async function syncPurchaseListToAccounting(
  env: Env,
  listId: number,
  opts: PurchaseSyncOptions = {},
): Promise<PurchaseSyncResult | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  const alert = async (reason: string): Promise<void> => {
    const msg = `[purchase-accounting] قائمة الشراء #${listId}: ${reason}`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
  };
  const failList = async (reason: string): Promise<null> => {
    await alert(`${reason}، ولم يُربط شيء`);
    return null;
  };

  try {
    type ListRow = {
      id: number;
      x_date?: string | false;
      x_supplier_id: [number, string] | false;
      x_purchase_order_id: [number, string] | false;
      x_account_move_id: [number, string] | false;
      x_aggregated_items: string | false;
    };
    const [list] = await call<ListRow[]>(env, "x_purchase_list", "read", {
      ids: [listId],
      fields: ["id", "x_date", "x_supplier_id", "x_purchase_order_id", "x_account_move_id", "x_aggregated_items"],
    });
    if (!list) return await failList("القائمة غير موجودة");
    if (list.x_purchase_order_id || list.x_account_move_id) {
      console.log(`[purchase-accounting] list ${listId} already linked (po=${list.x_purchase_order_id ? list.x_purchase_order_id[0] : "-"}, move=${list.x_account_move_id ? list.x_account_move_id[0] : "-"}) — skip`);
      return {
        purchaseOrderId: list.x_purchase_order_id ? list.x_purchase_order_id[0] : 0,
        moveId: list.x_account_move_id ? list.x_account_move_id[0] : 0,
        skipped: true,
      };
    }

    let items: PurchaseListItem[];
    try { items = parsePurchaseListItems(list.x_aggregated_items); }
    catch (e) { return await failList(`x_aggregated_items تالف: ${(e as Error).message}`); }
    if (!items.some((it) => Number(it.total_quantity) > 0)) return await failList("لا أصناف بكمية في القائمة");

    // the old single bill of this list (origin without /s…): never a second purchase
    const origin = purchaseListOrigin(listId);
    const orphans = await call<Array<{ id: number; name: string; state: string }>>(env, "purchase.order", "search_read", {
      domain: [["origin", "=", origin], ["state", "!=", "cancel"]],
      fields: ["id", "name", "state"],
      limit: 5,
    });
    if (orphans.length) {
      return await failList(`يوجد أمر شراء قائم لهذه القائمة غير مربوط (${orphans.map((o) => `${o.name}/${o.id}`).join("، ")}) — راجعه يدوياً`);
    }

    // who is owed each line: the supplier dues' attribution (§ 42 أ)
    let market: { cashSupplierId: number | null; winners: MarketWinners } | undefined;
    if (list.x_date) {
      const { readMarketPlan } = await import("./supplier-pay");
      market = await readMarketPlan(env, String(list.x_date));
    }
    const listSupplierId = list.x_supplier_id ? list.x_supplier_id[0] : null;
    const plan = planSupplierBills(items, listSupplierId, market);
    if (plan.noSupplier.length) {
      const names = plan.noSupplier.map((it) => `«${it.product_name} — ${it.packaging_name}»`).join("، ");
      if (!plan.bills.length) return await failList(`المورد غير محدد لأي صنف (${names})`);
      await alert(`بلا مورد: ${names} — لم تدخل أي فاتورة مورد، والقائمة لم تُربط`);
    }

    const [product] = await call<Array<{ id: number }>>(env, "product.product", "search_read", {
      domain: [["default_code", "=", PURCHASE_GOODS_PRODUCT_CODE], ["type", "=", "service"]],
      fields: ["id"],
      limit: 1,
    });
    if (!product) return await failList(`منتج الخدمة ${PURCHASE_GOODS_PRODUCT_CODE} غير موجود (شغّل scripts/acct-20260923-purchase-setup.mjs)`);

    const billDate = opts.billDate ?? todayRiyadhYmd();
    const done: SupplierBillResult[] = [];
    const failed: number[] = [];
    for (const b of plan.bills) {
      const r = await syncOneSupplierBill(env, listId, b, product.id, billDate, opts);
      if (r.ok) done.push(r.bill);
      else { failed.push(b.supplierId); await alert(r.reason); }
    }
    if (!done.length) return null;

    // linked only when complete: every supplier's bill, and no item without a supplier
    if (!failed.length && !plan.noSupplier.length) {
      await call<boolean>(env, "x_purchase_list", "write", {
        ids: [listId],
        vals: { x_purchase_order_id: done[0].purchaseOrderId, x_account_move_id: done[0].moveId },
      });
    }
    console.log(`[purchase-accounting] list ${listId}: ${done.map((d) => `s${d.supplierId} → po ${d.purchaseOrderId} bill ${d.moveId}${d.existed ? " (existed)" : ""} total ${d.total}${d.tax ? " taxed" : ""}`).join("; ")}${failed.length ? ` · failed ${failed.join(",")}` : ""}`);

    // § 44 هـ — the cash market without a VAT number from 10-01: Baraa's one line a day
    if (done.some((d) => !d.existed && !d.tax) && isVatApplicable(billDate, opts.vatEffectiveDate)) {
      try { await notifyCashNoVat(env, billDate, done); } catch (e) { console.warn("[purchase-accounting] cash no-VAT line failed", (e as Error)?.message); }
    }
    return {
      purchaseOrderId: done[0].purchaseOrderId, moveId: done[0].moveId, skipped: false,
      bills: done, failed, noSupplier: plan.noSupplier.length,
    };
  } catch (e) {
    return await failList(`فشل الربط المحاسبي: ${(e as Error).message}`);
  }
}

/** One supplier's purchase.order + posted bill (§ 44 هـ). Never throws; cancels what it made on failure. */
async function syncOneSupplierBill(
  env: Env,
  listId: number,
  b: SupplierBillPlan,
  productId: number,
  billDate: string,
  opts: PurchaseSyncOptions,
): Promise<{ ok: true; bill: SupplierBillResult } | { ok: false; reason: string }> {
  let poId: number | null = null;
  let billId: number | null = null;
  const fail = async (reason: string): Promise<{ ok: false; reason: string }> => {
    if (billId) await cancelMoveQuietly(env, billId);
    if (poId) await cancelPurchaseOrderQuietly(env, poId);
    return {
      ok: false,
      reason: `فاتورة المورد #${b.supplierId}: ${reason}` +
        (billId || poId ? ` — أُلغي${billId ? ` القيد ${billId}` : ""}${poId ? ` وأمر الشراء ${poId}` : ""}` : "") + "، ولم تُربط القائمة",
    };
  };
  try {
    const itemReasons = validatePurchaseItems(b.items);
    if (itemReasons.length) return await fail(itemReasons.join("؛ "));
    const origin = purchaseBillOrigin(listId, b.supplierId);
    // the fixed reference, checked before the create: one bill per supplier per list
    const existing = await call<Array<{ id: number; name: string; state: string; invoice_ids: number[] }>>(env, "purchase.order", "search_read", {
      domain: [["origin", "=", origin], ["state", "!=", "cancel"]],
      fields: ["id", "name", "state", "invoice_ids"],
      limit: 5,
    });
    if (existing.length) {
      const inv = existing[0].invoice_ids?.length
        ? await call<Array<{ id: number; state: string; amount_total: number; amount_tax: number }>>(env, "account.move", "search_read", {
            domain: [["id", "in", existing[0].invoice_ids], ["state", "=", "posted"], ["move_type", "=", "in_invoice"]],
            fields: ["id", "state", "amount_total", "amount_tax"], limit: 5,
          })
        : [];
      if (existing.length === 1 && inv.length === 1) {
        return { ok: true, bill: { supplierId: b.supplierId, purchaseOrderId: existing[0].id, moveId: inv[0].id, existed: true, tax: (inv[0].amount_tax ?? 0) > 0, total: inv[0].amount_total } };
      }
      return { ok: false, reason: `فاتورة المورد #${b.supplierId}: يوجد أمر شراء قائم لها (${existing.map((o) => `${o.name}/${o.id}`).join("، ")}) بلا فاتورة مرحّلة واحدة — راجعه يدوياً، ولم تُربط القائمة` };
    }

    const [supplier] = await call<Array<{ id: number; vat: string | false }>>(env, "res.partner", "read", {
      ids: [b.supplierId],
      fields: ["id", "vat"],
    });
    const tax = await resolvePurchaseTaxForBill(env, {
      supplierVat: supplier?.vat, billDate, vatEffectiveDate: opts.vatEffectiveDate,
    });
    // § 47 أ — unit_price is net: the registered supplier's tax is added on top
    const expected = computeNetTotals(
      b.items.map((it) => (it.unit_price as number) * it.total_quantity),
      tax?.rate ?? null,
    );
    const [createdPo] = await call<number[]>(env, "purchase.order", "create", {
      vals_list: [{
        partner_id: b.supplierId,
        origin,
        partner_ref: purchaseBillRef(listId),
        order_line: buildPurchaseOrderLineCommands(b.items, productId, tax ? [tax.id] : []),
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
      vals: { invoice_date: billDate, ref: purchaseBillRef(listId) },
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
    return { ok: true, bill: { supplierId: b.supplierId, purchaseOrderId: poId, moveId: billId, existed: false, tax: tax !== null, total: expected.total } };
  } catch (e) {
    return await fail(`فشل الربط المحاسبي: ${(e as Error).message}`);
  }
}

/**
 * § 44 هـ — a no-VAT bill of «مشتريات السوق النقدية» from 10-01: ONE line to
 * Baraa that day with the day's no-VAT cash-market bills (claimed per day).
 */
async function notifyCashNoVat(env: Env, billDate: string, bills: SupplierBillResult[]): Promise<void> {
  const cash = await findCashMarketSupplier(env);
  if (!cash || !bills.some((d) => d.supplierId === cash.id && !d.tax && !d.existed)) return;
  const { claimButton } = await import("./button-lock");
  const claim = await claimButton(env, `cash_novat:${billDate}`, 26 * 60 * 60);
  if (!claim.claimed) return;
  const day = await call<Array<{ amount_total: number; amount_tax: number }>>(env, "account.move", "search_read", {
    domain: [["move_type", "=", "in_invoice"], ["state", "=", "posted"], ["partner_id", "=", cash.id], ["invoice_date", "=", billDate]],
    fields: ["amount_total", "amount_tax"], limit: 200,
  });
  const total = roundHalala(day.filter((m) => !(m.amount_tax > 0)).reduce((a, m) => a + (m.amount_total ?? 0), 0));
  if (!(total > 0)) return;
  await sendOwnerAlert(env, cashNoVatText(total));
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
