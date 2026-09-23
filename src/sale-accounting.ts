// Sale → accounting. Gated behind ACCOUNTING_SYNC — added 2026-09-23.
//
//   x_daily_order (confirmed) → sale.order (confirmed, state "sale")
//   delivery → qty_delivered = what was actually delivered
//            → customer invoice created FROM the sale order, posted with the
//              Riyadh delivery date, linked on x_invoice.x_account_move_id
//
// The sale order keeps what was ORDERED (product_uom_qty); the invoice bills
// what was DELIVERED. A shortage (x_daily_order_line.x_status = unavailable)
// is delivered 0, so its amount stays un-invoiced on the sale order.
//
// No stock: every line uses the service product UTAK-SALE-GOODS («بضاعة
// مباعة (وسيط)», income 500001, invoice_policy = delivery, service_type =
// manual), so action_confirm creates no stock.picking — the same approach as
// UTAK-PUR-GOODS on purchase orders. The item name + packaging go on the line
// text. Each sale.order.line carries `sequence` = the x_daily_order_line id,
// the stable key used to write qty_delivered / prices back at delivery.
//
// Tax: tax_ids pinned on every line from the invoice date (Riyadh) against
// VAT_EFFECTIVE_DATE_RIYADH — empty before, the company sale tax (price-
// included) from it. Re-pinned at delivery, because the invoice date is the
// delivery date, not the confirmation date.
//
// Idempotent: x_daily_order.x_sale_order_id blocks a second sale order (a
// live sale.order whose origin is this order but that was never linked is
// adopted, never duplicated); x_invoice.x_account_move_id blocks a second
// invoice (and a live invoice already on the sale order but not linked is
// refused + owner alert).
//
// Guards on the posted invoice: evaluateInvoiceGuard (receivable debited,
// income credited, VAT by date) plus evaluateSaleInvoiceLink: every product
// line comes from THIS sale order, and quantity × price equals the delivered
// lines exactly. Any failure (or a refused action_post) → the invoice is
// reset + cancelled (never an orphan draft), owner alerted, nothing linked.
// The x_invoice flow and WhatsApp never stop. NEVER throws.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import { call, getLatestSalePrice, stripRef } from "./odoo";
import { sendOwnerAlert } from "./templates";
import {
  cancelMoveQuietly,
  computeInclusiveTotals,
  evaluateInvoiceGuard,
  isAccountingSyncEnabled,
  readMoveLinesWithTypes,
  resolveCompanySaleTax,
  roundHalala,
  todayRiyadhYmd,
  type GuardResult,
  type SaleTax,
} from "./accounting";

export const SALE_GOODS_PRODUCT_CODE = "UTAK-SALE-GOODS";

/** sale.order.origin for a daily order — also the orphan search key. */
export function dailyOrderOrigin(orderId: number): string {
  return `x_daily_order/${orderId}`;
}

/** Line text on the sale order / invoice: «item — packaging». */
export function saleLineDescription(product: string, packaging: string): string {
  return packaging ? `${product} — ${packaging}` : product;
}

export interface SaleLineInput {
  /** x_daily_order_line id → sale.order.line.sequence. */
  lineId: number;
  description: string;
  quantity: number;
  priceUnit: number;
}

export interface SaleSyncOptions {
  /** YYYY-MM-DD (Riyadh); defaults to today. */
  date?: string;
  /** Live-verify only: pretend VAT starts on this date. Runtime never sets it. */
  vatEffectiveDate?: string;
}

async function resolveSaleTax(env: Env, ymd: string, vatEffectiveDate?: string): Promise<SaleTax | null> {
  if (!isVatApplicable(ymd, vatEffectiveDate)) return null;
  return resolveCompanySaleTax(env);
}

/** New sale.order.line commands; every line pins tax_ids (empty = no tax). */
export function buildSaleOrderLineCommands(
  lines: SaleLineInput[],
  productId: number,
  taxIds: number[],
): Array<[number, number, Record<string, unknown>]> {
  return lines
    .filter((l) => l.quantity > 0)
    .map((l) => [0, 0, {
      product_id: productId,
      name: l.description,
      product_uom_qty: l.quantity,
      price_unit: l.priceUnit,
      tax_ids: [[6, 0, [...taxIds]]],
      sequence: l.lineId,
    }]);
}

export interface ExistingSoLine {
  id: number;
  sequence: number;
  product_uom_qty: number;
}

/**
 * order_line commands that make the sale order bill exactly `delivered`:
 *   • an existing line (matched by sequence = x line id) gets price, taxes and
 *     qty_delivered; its ordered qty only grows if more was delivered;
 *   • a delivered line with no sale line yet is added (ordered = delivered);
 *   • a sale line not delivered at all (shortage) gets qty_delivered = 0 —
 *     its ordered qty stays, so the gap remains un-invoiced.
 */
export function buildDeliveryLineCommands(
  existing: ExistingSoLine[],
  delivered: SaleLineInput[],
  productId: number,
  taxIds: number[],
): Array<[number, number, Record<string, unknown>]> {
  const bySeq = new Map(existing.map((l) => [l.sequence, l]));
  const deliveredIds = new Set<number>();
  const cmds: Array<[number, number, Record<string, unknown>]> = [];
  for (const d of delivered) {
    if (!(d.quantity > 0)) continue;
    deliveredIds.add(d.lineId);
    const ex = bySeq.get(d.lineId);
    if (ex) {
      const vals: Record<string, unknown> = {
        price_unit: d.priceUnit,
        tax_ids: [[6, 0, [...taxIds]]],
        qty_delivered: d.quantity,
      };
      if (d.quantity > ex.product_uom_qty) vals.product_uom_qty = d.quantity;
      cmds.push([1, ex.id, vals]);
    } else {
      cmds.push([0, 0, {
        product_id: productId,
        name: d.description,
        product_uom_qty: d.quantity,
        price_unit: d.priceUnit,
        tax_ids: [[6, 0, [...taxIds]]],
        sequence: d.lineId,
        qty_delivered: d.quantity,
      }]);
    }
  }
  for (const ex of existing) {
    if (!deliveredIds.has(ex.sequence)) cmds.push([1, ex.id, { qty_delivered: 0 }]);
  }
  return cmds;
}

export interface InvoiceProductLine {
  quantity: number;
  price_unit: number;
  /** sale.order ids reached through sale_line_ids. */
  sale_order_ids: number[];
}

/**
 * The invoice came from THIS sale order and bills exactly the delivered
 * lines: one product line per delivered line, each linked to the sale order,
 * and the multiset of (quantity, price) plus the gross sum match.
 */
export function evaluateSaleInvoiceLink(f: {
  saleOrderId: number;
  lines: InvoiceProductLine[];
  delivered: Array<{ quantity: number; priceUnit: number }>;
  expectedTotal: number;
}): GuardResult {
  const reasons: string[] = [];
  const want = f.delivered.filter((d) => d.quantity > 0);
  if (f.lines.length !== want.length) {
    reasons.push(`عدد أسطر الفاتورة ${f.lines.length} ≠ الأسطر المسلّمة ${want.length}`);
  }
  f.lines.forEach((l, i) => {
    if (l.sale_order_ids.length === 0) reasons.push(`سطر الفاتورة ${i + 1} غير مربوط بأمر بيع`);
    else if (l.sale_order_ids.some((id) => id !== f.saleOrderId)) {
      reasons.push(`سطر الفاتورة ${i + 1} من أمر بيع آخر (${l.sale_order_ids.join("،")})`);
    }
  });
  const key = (q: number, p: number) => `${roundHalala(q)}×${roundHalala(p)}`;
  const got = f.lines.map((l) => key(l.quantity, l.price_unit)).sort();
  const exp = want.map((d) => key(d.quantity, d.priceUnit)).sort();
  if (got.join("|") !== exp.join("|")) {
    reasons.push(`كميات/أسعار الفاتورة [${got.join("، ")}] ≠ المسلّم [${exp.join("، ")}]`);
  }
  const gross = roundHalala(f.lines.reduce((a, l) => a + roundHalala(l.quantity * l.price_unit), 0));
  if (Math.abs(gross - f.expectedTotal) > 0.005) {
    reasons.push(`مجموع أسطر الفاتورة ${gross} ≠ المسلّم بأسعاره ${f.expectedTotal}`);
  }
  return { ok: reasons.length === 0, reasons };
}

async function findSaleGoodsProductId(env: Env): Promise<number | null> {
  const [p] = await call<Array<{ id: number }>>(env, "product.product", "search_read", {
    domain: [["default_code", "=", SALE_GOODS_PRODUCT_CODE], ["type", "=", "service"]],
    fields: ["id"],
    limit: 1,
  });
  return p?.id ?? null;
}

async function alert(env: Env, msg: string): Promise<void> {
  console.error(msg);
  try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
}

type SoHead = {
  id: number;
  name: string;
  state: string;
  locked: boolean;
  picking_ids: number[];
  invoice_ids: number[];
  order_line: number[];
};
const SO_HEAD_FIELDS = ["id", "name", "state", "locked", "picking_ids", "invoice_ids", "order_line"];

async function readSo(env: Env, soId: number): Promise<SoHead | null> {
  const [so] = await call<SoHead[]>(env, "sale.order", "read", { ids: [soId], fields: SO_HEAD_FIELDS });
  return so ?? null;
}

async function readSoLines(env: Env, lineIds: number[]): Promise<ExistingSoLine[]> {
  if (!lineIds.length) return [];
  return call<ExistingSoLine[]>(env, "sale.order.line", "read", {
    ids: lineIds,
    fields: ["id", "sequence", "product_uom_qty"],
  });
}

/** Ordered lines of a daily order, priced like the invoice path. */
async function readOrderedLines(env: Env, lineIds: number[]): Promise<SaleLineInput[]> {
  if (!lineIds.length) return [];
  type Row = {
    id: number;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
    x_unit_price: number | false;
  };
  const rows = await call<Row[]>(env, "x_daily_order_line", "read", {
    ids: lineIds,
    fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price"],
  });
  const out: SaleLineInput[] = [];
  for (const r of rows) {
    if (!(r.x_quantity > 0)) continue;
    let unit = typeof r.x_unit_price === "number" && r.x_unit_price > 0 ? r.x_unit_price : 0;
    if (!unit && r.x_product_tmpl_id && r.x_packaging_id) {
      unit = (await getLatestSalePrice(env, r.x_product_tmpl_id[0], r.x_packaging_id[0])).price;
    }
    const name = r.x_product_tmpl_id ? stripRef(r.x_product_tmpl_id[1]) : "صنف";
    const pack = r.x_packaging_id ? stripRef(r.x_packaging_id[1]) : "";
    out.push({ lineId: r.id, description: saleLineDescription(name, pack), quantity: r.x_quantity, priceUnit: unit });
  }
  return out;
}

export interface EnsureSaleOrderResult {
  saleOrderId: number;
  created: boolean;
}

/**
 * Confirmed x_daily_order → confirmed sale.order, linked on
 * x_daily_order.x_sale_order_id. Already linked → returns it (and, while it
 * is not invoiced yet, re-syncs ordered quantities after an edit). Returns
 * null on refusal / failure (owner alerted). NEVER throws.
 */
export async function ensureSaleOrderForDailyOrder(
  env: Env,
  orderId: number,
  opts: SaleSyncOptions = {},
): Promise<EnsureSaleOrderResult | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  let soId: number | null = null;
  try {
    type OrderRow = {
      id: number;
      x_customer_id: [number, string] | false;
      x_sale_order_id: [number, string] | false;
      x_line_ids: number[];
    };
    const [order] = await call<OrderRow[]>(env, "x_daily_order", "read", {
      ids: [orderId],
      fields: ["id", "x_customer_id", "x_sale_order_id", "x_line_ids"],
    });
    if (!order) { await alert(env, `[sale-accounting] الطلب #${orderId} غير موجود — لا أمر بيع`); return null; }

    if (order.x_sale_order_id) {
      const linked = order.x_sale_order_id[0];
      await resyncOrderedLines(env, linked, order.x_line_ids);
      console.log(`[sale-accounting] order ${orderId} already linked to sale.order ${linked} — skip create`);
      return { saleOrderId: linked, created: false };
    }
    if (!order.x_customer_id) { await alert(env, `[sale-accounting] الطلب #${orderId} بلا عميل — لا أمر بيع`); return null; }

    const origin = dailyOrderOrigin(orderId);
    const orphans = await call<Array<{ id: number; name: string; state: string }>>(env, "sale.order", "search_read", {
      domain: [["origin", "=", origin], ["state", "!=", "cancel"]],
      fields: ["id", "name", "state"],
      limit: 5,
    });
    if (orphans.length > 1) {
      await alert(env, `[sale-accounting] الطلب #${orderId}: أكثر من أمر بيع قائم غير مربوط (${orphans.map((o) => `${o.name}/${o.id}`).join("، ")}) — راجعه يدوياً`);
      return null;
    }
    if (orphans.length === 1) {
      // A crash between action_confirm and the link: adopt, never duplicate.
      const o = orphans[0];
      if (o.state === "draft" || o.state === "sent") await call<unknown>(env, "sale.order", "action_confirm", { ids: [o.id] });
      await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals: { x_sale_order_id: o.id } });
      console.log(`[sale-accounting] order ${orderId}: adopted unlinked sale.order ${o.id}`);
      return { saleOrderId: o.id, created: false };
    }

    const productId = await findSaleGoodsProductId(env);
    if (!productId) {
      await alert(env, `[sale-accounting] منتج الخدمة ${SALE_GOODS_PRODUCT_CODE} غير موجود (شغّل scripts/acct-20260923-sale-setup.mjs) — الطلب #${orderId} بلا أمر بيع`);
      return null;
    }
    const lines = await readOrderedLines(env, order.x_line_ids);
    if (lines.length === 0) {
      await alert(env, `[sale-accounting] الطلب #${orderId} بلا أسطر بكمية — لا أمر بيع`);
      return null;
    }
    const tax = await resolveSaleTax(env, opts.date ?? todayRiyadhYmd(), opts.vatEffectiveDate);

    const [created] = await call<number[]>(env, "sale.order", "create", {
      vals_list: [{
        partner_id: order.x_customer_id[0],
        origin,
        client_order_ref: `UTAK-ORDER-${orderId}`,
        order_line: buildSaleOrderLineCommands(lines, productId, tax ? [tax.id] : []),
      }],
    });
    soId = created;
    await call<unknown>(env, "sale.order", "action_confirm", { ids: [soId] });
    const so = await readSo(env, soId);
    if (so?.state !== "sale") throw new Error(`أمر البيع ${soId} حالته ${so?.state ?? "?"} بعد التأكيد`);
    if (so.picking_ids.length) throw new Error(`أمر البيع ${soId} أنشأ حركة مخزون (${so.picking_ids.join("،")})`);

    await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals: { x_sale_order_id: soId } });
    console.log(`[sale-accounting] linked x_daily_order ${orderId} → sale.order ${soId} (${lines.length} lines)`);
    return { saleOrderId: soId, created: true };
  } catch (e) {
    if (soId) await cancelSaleOrderQuietly(env, soId);
    await alert(env, `[sale-accounting] الطلب #${orderId}: فشل إنشاء أمر البيع — ${(e as Error).message}${soId ? ` — أُلغي أمر البيع ${soId}` : ""}`);
    return null;
  }
}

/**
 * After an edit + re-confirm the x lines may differ from the sale order.
 * While nothing is invoiced yet, align ordered quantities (by sequence):
 * update, add, or zero lines. Best effort — a failure is only logged; the
 * delivery step re-aligns what is actually billed anyway.
 */
async function resyncOrderedLines(env: Env, soId: number, xLineIds: number[]): Promise<void> {
  try {
    const so = await readSo(env, soId);
    if (!so || so.state !== "sale" || so.invoice_ids.length) return;
    const existing = await readSoLines(env, so.order_line);
    const wanted = await readOrderedLines(env, xLineIds);
    const bySeq = new Map(existing.map((l) => [l.sequence, l]));
    const cmds: Array<[number, number, Record<string, unknown>]> = [];
    const seen = new Set<number>();
    const productId = await findSaleGoodsProductId(env);
    for (const w of wanted) {
      seen.add(w.lineId);
      const ex = bySeq.get(w.lineId);
      if (ex && Math.abs(ex.product_uom_qty - w.quantity) > 1e-9) cmds.push([1, ex.id, { product_uom_qty: w.quantity }]);
      if (!ex && productId) cmds.push(...buildSaleOrderLineCommands([w], productId, []));
    }
    for (const ex of existing) if (!seen.has(ex.sequence) && ex.product_uom_qty !== 0) cmds.push([1, ex.id, { product_uom_qty: 0 }]);
    if (cmds.length) {
      await call<boolean>(env, "sale.order", "write", { ids: [soId], vals: { order_line: cmds } });
      console.log(`[sale-accounting] sale.order ${soId}: ordered lines re-synced (${cmds.length} change(s))`);
    }
  } catch (e) {
    console.warn(`[sale-accounting] sale.order ${soId} re-sync failed`, (e as Error).message);
  }
}

export interface SaleInvoiceArgs {
  invoiceId: number;
  /** Pre-existing x_invoice.x_account_move_id; when set we skip. */
  existingMoveId: number | null;
  invoiceNumber: string;
  orderId: number;
  /** Delivered lines (shortages excluded), priced exactly like x_invoice. */
  delivered: SaleLineInput[];
  /** x_invoice.x_total — the tax-included gross of `delivered`. */
  expectedTotal: number;
}

export interface SaleInvoiceResult {
  saleOrderId: number;
  moveId: number;
  skipped: boolean;
}

/**
 * Delivery: bill the sale order for what was delivered, post it on the
 * Riyadh delivery date, link it to x_invoice. Returns null on refusal /
 * failure (owner alerted, nothing linked). NEVER throws.
 */
export async function invoiceSaleOrderOnDelivery(
  env: Env,
  args: SaleInvoiceArgs,
  opts: SaleSyncOptions = {},
): Promise<SaleInvoiceResult | null> {
  if (!isAccountingSyncEnabled(env)) return null;
  let moveId: number | null = null;
  let soId: number | null = null;
  const fail = async (reason: string): Promise<null> => {
    if (moveId) await cancelMoveQuietly(env, moveId);
    await alert(env,
      `[sale-accounting] فاتورة ${args.invoiceNumber} (الطلب #${args.orderId}${soId ? `، أمر البيع ${soId}` : ""}): ${reason}` +
      (moveId ? ` — أُلغي القيد ${moveId}` : "") + "، ولم يُربط شيء");
    return null;
  };
  if (args.existingMoveId && args.existingMoveId > 0) {
    console.log(`[sale-accounting] x_invoice ${args.invoiceId} already linked to move ${args.existingMoveId} — skip`);
    const [o] = await call<Array<{ id: number; x_sale_order_id: [number, string] | false }>>(env, "x_daily_order", "read", {
      ids: [args.orderId], fields: ["id", "x_sale_order_id"],
    }).catch(() => []);
    return { saleOrderId: o?.x_sale_order_id ? o.x_sale_order_id[0] : 0, moveId: args.existingMoveId, skipped: true };
  }
  const delivered = args.delivered.filter((d) => d.quantity > 0);
  if (delivered.length === 0) return fail("لا أصناف مسلّمة — لا فاتورة");

  try {
    const ensured = await ensureSaleOrderForDailyOrder(env, args.orderId, opts);
    if (!ensured) return fail("تعذّر تحديد أمر البيع");
    soId = ensured.saleOrderId;
    let so = await readSo(env, soId);
    if (!so || so.state !== "sale") return fail(`أمر البيع حالته ${so?.state ?? "?"} (المتوقع sale)`);

    // An invoice already on the sale order that is not linked (crash between
    // post and link): never bill twice.
    if (so.invoice_ids.length) {
      const live = await call<Array<{ id: number; name: string; state: string }>>(env, "account.move", "search_read", {
        domain: [["id", "in", so.invoice_ids], ["state", "!=", "cancel"]],
        fields: ["id", "name", "state"],
      });
      if (live.length) return fail(`يوجد على أمر البيع فاتورة قائمة غير مربوطة (${live.map((m) => `${m.name}/${m.id}`).join("، ")}) — راجعها يدوياً`);
    }

    const productId = await findSaleGoodsProductId(env);
    if (!productId) return fail(`منتج الخدمة ${SALE_GOODS_PRODUCT_CODE} غير موجود`);
    const invoiceDate = opts.date ?? todayRiyadhYmd();
    const tax = await resolveSaleTax(env, invoiceDate, opts.vatEffectiveDate);
    const expected = computeInclusiveTotals(delivered.map((d) => d.quantity * d.priceUnit), tax?.rate ?? null);

    if (so.locked) await call<unknown>(env, "sale.order", "action_unlock", { ids: [soId] });
    const existing = await readSoLines(env, so.order_line);
    await call<boolean>(env, "sale.order", "write", {
      ids: [soId],
      vals: { order_line: buildDeliveryLineCommands(existing, delivered, productId, tax ? [tax.id] : []) },
    });

    const ctx = { active_model: "sale.order", active_ids: [soId], active_id: soId };
    const [wizardId] = await call<number[]>(env, "sale.advance.payment.inv", "create", {
      vals_list: [{ advance_payment_method: "delivered", sale_order_ids: [[6, 0, [soId]]] }],
      context: ctx,
    });
    await call<unknown>(env, "sale.advance.payment.inv", "create_invoices", { ids: [wizardId], context: ctx });

    so = await readSo(env, soId);
    const newMoves = so?.invoice_ids.length
      ? await call<Array<{ id: number; state: string; move_type: string }>>(env, "account.move", "search_read", {
          domain: [["id", "in", so.invoice_ids], ["state", "!=", "cancel"]],
          fields: ["id", "state", "move_type"],
        })
      : [];
    if (newMoves.length !== 1) {
      moveId = newMoves[0]?.id ?? null;
      return fail(`أمر البيع أنتج ${newMoves.length} فاتورة (المتوقع 1)`);
    }
    moveId = newMoves[0].id;
    if (newMoves[0].move_type !== "out_invoice") return fail(`نوع القيد ${newMoves[0].move_type} وليس out_invoice`);

    await call<boolean>(env, "account.move", "write", {
      ids: [moveId],
      vals: { invoice_date: invoiceDate, ref: args.invoiceNumber },
    });
    try {
      await call<boolean>(env, "account.move", "action_post", { ids: [moveId] });
    } catch (e) {
      return fail(`رفض Odoo ترحيل الفاتورة: ${(e as Error).message}`);
    }

    type Head = { id: number; state: string; amount_total: number; amount_tax: number };
    const [head] = await call<Head[]>(env, "account.move", "read", {
      ids: [moveId],
      fields: ["id", "state", "amount_total", "amount_tax"],
    });
    const guard = evaluateInvoiceGuard({
      moveState: head?.state ?? "",
      lines: await readMoveLinesWithTypes(env, moveId),
      tax: {
        expectTax: tax !== null,
        expectedTax: expected.tax,
        amountTax: head?.amount_tax ?? 0,
        expectedTotal: args.expectedTotal,
        amountTotal: head?.amount_total ?? 0,
      },
    });
    const link = evaluateSaleInvoiceLink({
      saleOrderId: soId,
      lines: await readInvoiceProductLines(env, moveId),
      delivered,
      expectedTotal: args.expectedTotal,
    });
    const reasons = [...guard.reasons, ...link.reasons];
    if (reasons.length) return fail(`حارس الفاتورة: ${reasons.join("؛ ")}`);

    await call<boolean>(env, "x_invoice", "write", { ids: [args.invoiceId], vals: { x_account_move_id: moveId } });
    console.log(`[sale-accounting] linked x_invoice ${args.invoiceId} → account.move ${moveId} from sale.order ${soId} (total ${head?.amount_total}, tax ${head?.amount_tax})`);
    return { saleOrderId: soId, moveId, skipped: false };
  } catch (e) {
    return fail(`فشل الربط المحاسبي: ${(e as Error).message}`);
  }
}

async function readInvoiceProductLines(env: Env, moveId: number): Promise<InvoiceProductLine[]> {
  type Line = { id: number; quantity: number; price_unit: number; display_type: string | false; sale_line_ids: number[] };
  const rows = await call<Line[]>(env, "account.move.line", "search_read", {
    domain: [["move_id", "=", moveId], ["display_type", "=", "product"]],
    fields: ["id", "quantity", "price_unit", "display_type", "sale_line_ids"],
    limit: 200,
  });
  const saleLineIds = Array.from(new Set(rows.flatMap((r) => r.sale_line_ids ?? [])));
  const soBySaleLine = new Map<number, number>();
  if (saleLineIds.length) {
    const sl = await call<Array<{ id: number; order_id: [number, string] | false }>>(env, "sale.order.line", "read", {
      ids: saleLineIds,
      fields: ["id", "order_id"],
    });
    for (const l of sl) if (l.order_id) soBySaleLine.set(l.id, l.order_id[0]);
  }
  return rows.map((r) => ({
    quantity: r.quantity,
    price_unit: r.price_unit,
    sale_order_ids: Array.from(new Set((r.sale_line_ids ?? []).map((id) => soBySaleLine.get(id) ?? -1))),
  }));
}

/** Best effort: cancel the linked sale order when the customer cancels. */
export async function cancelSaleOrderForDailyOrder(env: Env, orderId: number): Promise<void> {
  if (!isAccountingSyncEnabled(env)) return;
  try {
    const [o] = await call<Array<{ id: number; x_sale_order_id: [number, string] | false }>>(env, "x_daily_order", "read", {
      ids: [orderId], fields: ["id", "x_sale_order_id"],
    });
    if (o?.x_sale_order_id) await cancelSaleOrderQuietly(env, o.x_sale_order_id[0]);
  } catch (e) {
    console.warn(`[sale-accounting] cancel sale order for ${orderId} failed`, (e as Error).message);
  }
}

async function cancelSaleOrderQuietly(env: Env, soId: number): Promise<void> {
  try {
    await call<unknown>(env, "sale.order", "action_cancel", { ids: [soId], context: { disable_cancel_warning: true } });
  } catch (e) {
    console.warn(`[sale-accounting] sale.order ${soId} action_cancel:`, (e as Error).message);
  }
}
