// Item 1 (2026-09-18) — parallel build.
//
// Feeds the existing UTAK PDF shell (pdf-template.ts) from a standard
// `sale.order` + `sale.order.line` pair, alongside the existing
// `x_quotation` pipeline. Nothing here modifies the x_quotation flow,
// the 02:00 supplier-price cron, or any of the other UTAK crons.
//
// Price priority (same three tiers as x_daily_order_line, on new fields):
//   1) sale.order.line.x_price_unit_manual (Studio float, > 0)  → source="today"
//   2) sale.order.line.price_unit          (standard field, > 0) → source="today"
//   3) getLatestSalePrice(tmpl, packaging) → x_daily_price       → source=today/stale/missing
//
// Missing-price handling: same Arabic message the manual x_quotation path
// uses today — "صنف بلا سعر: <name>" — surfaced through the shared
// has_blocking_issue / missing_products fields on QuotationPDFData.
//
// Packaging: `x_packaging_id` is a Studio many2one on sale.order.line to
// x_product_packaging (the existing 42-row custom model). `product.packaging`
// is not present on this tenant (probe confirmed), so we read packaging
// from the same source both paths already use.
//
// § 62 د (2026-10-07) — the manual quotation prints what Baraa wrote and what Odoo computed:
//   • the item's name is the FIRST LINE OF THE LINE'S DESCRIPTION (trimmed, its «[ref]» dropped), else the
//     product's name; never «صنف». A line with neither a product nor a description stops the quotation with
//     its place («السطر 3 بلا منتج ولا وصف»).
//   • the numbers are Odoo's: each line's price_subtotal / price_tax / price_total and the order's amount_*,
//     with «الأسعار شاملة …» or «الأسعار قبل …» by how the lines' taxes are set. No tax is created or changed.
//     (A line Odoo holds no price for keeps the older fallbacks — the manual field, then the day's price —
//     read as VAT-inclusive; the totals are then the lines' sums.)
//   • a note line (display_type line_note) is text under the table; a section line is a group's title. Neither
//     is an item and neither stops the quotation.
//   • a line with quantity 0 and a price is a «خيار بديل»: listed under the table, outside the totals. Quantity
//     0 and no price: nothing to quote, left out.
//   • every quantity = 1 → «عرض سعر الوحدة» (QuotationPDFData.layout), from the line's own three numbers.
//   • «المنشأ» and «المقاس» (x_item_origin, x_item_size) print under the item's name.
//
// § 64 (2026-10-07) — the line's pack is, in this order: «التعبئة» as text (x_pack_text — what the special request
// wrote, copied when its quotation is issued), then «العبوة» (x_packaging_id), then the product's default packaging.

import type { Env } from "./config";
import {
  call,
  getLatestSalePrice,
  NO_PACKAGING_PLACEHOLDER,
  resolvePackagingNames,
  stripRef,
} from "./odoo";
import { QUOTATION_FOOTER, itemDetail, type QuotationLineItem, type QuotationPDFData, type QuotationPriceWarning } from "./quotation";
import { UI } from "./i18n";

interface SaleOrderRow {
  id: number;
  name: string | false;
  partner_id: [number, string] | false;
  date_order: string | false;
  create_date: string | false;
  order_line: number[];
  state?: string;
  amount_untaxed?: number;
  amount_tax?: number;
  amount_total?: number;
}

interface SalePartnerRow {
  id: number;
  name: string | false;
  phone: string | false;
  x_whatsapp_number: string | false;
  street: string | false;
  city: string | false;
}

interface SaleLineRow {
  id: number;
  display_type?: string | false;
  product_id: [number, string] | false;
  name?: string | false;
  product_uom_qty: number;
  price_unit: number;
  price_subtotal?: number;
  price_tax?: number;
  price_total?: number;
  discount?: number;
  product_uom_id?: [number, string] | false;
  x_price_unit_manual: number | false;
  x_packaging_id: [number, string] | false;
  x_pack_text?: string | false;
  x_item_origin?: string | false;
  x_item_size?: string | false;
}

interface ProductProductRow {
  id: number;
  product_tmpl_id: [number, string] | false;
  display_name: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const VAT_FACTOR = 1.15;
/** Odoo's generic unit of measure («Units» / «الوحدات»): it names no packaging. */
const GENERIC_UOM_ID = 1;
export const SALE_NOTES_LABEL = "ملاحظات";
export const SALE_ALTERNATIVES_LABEL = "خيارات بديلة";
export const SALE_NET_SUBTOTAL_LABEL = "المجموع قبل الضريبة";
export const SALE_VAT_LABEL = "ضريبة القيمة المضافة 15%";
export const SALE_NO_VAT_LABEL = "ضريبة القيمة المضافة";

/** The first line of a line's description, trimmed, without Odoo's «[ref] » before it. "" when it has none. */
export function firstDescriptionLine(name: unknown): string {
  const line = String(typeof name === "string" ? name : "").split(/\r?\n/).map((x) => x.trim()).find((x) => x) ?? "";
  return stripRef(line).trim();
}
/** § 64 — «التعبئة» a sale order's line carries as text; "" when it carries none. */
export const packTextOf = (l: { x_pack_text?: string | false }): string => (typeof l.x_pack_text === "string" ? l.x_pack_text.trim() : "");
/** A price as an alternative's line writes it: «68», «16.5», «46.49». */
const plain = (n: number): string => { const v = round2(n); return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ""); };

export async function buildQuotationPDFDataFromSaleOrder(
  env: Env,
  saleOrderId: number,
): Promise<QuotationPDFData | null> {
  const orders = await call<SaleOrderRow[]>(env, "sale.order", "read", {
    ids: [saleOrderId],
    fields: ["id", "name", "partner_id", "date_order", "create_date", "order_line", "state", "amount_untaxed", "amount_tax", "amount_total"],
  });
  const order = orders[0];
  if (!order) return null;
  if (!order.partner_id) {
    throw new Error(`sale.order ${saleOrderId} has no partner_id`);
  }

  const [partner] = await call<SalePartnerRow[]>(env, "res.partner", "read", {
    ids: [order.partner_id[0]],
    fields: ["id", "name", "phone", "x_whatsapp_number", "street", "city"],
  });

  const lines: SaleLineRow[] = order.order_line.length
    ? await call<SaleLineRow[]>(env, "sale.order.line", "read", {
        ids: order.order_line,
        fields: [
          "id",
          "display_type",
          "product_id",
          "name",
          "product_uom_qty",
          "price_unit",
          "price_subtotal",
          "price_tax",
          "price_total",
          "discount",
          "product_uom_id",
          "x_price_unit_manual",
          "x_packaging_id",
          "x_pack_text",
          "x_item_origin",
          "x_item_size",
        ],
      })
    : [];

  // sale.order.line.product_id points at product.product; x_daily_price uses
  // product.template. Resolve template ids in one read.
  const productIds = Array.from(
    new Set(lines.map((l) => (l.product_id ? l.product_id[0] : 0)).filter((id) => id > 0)),
  );
  const products: ProductProductRow[] = productIds.length
    ? await call<ProductProductRow[]>(env, "product.product", "read", {
        ids: productIds,
        fields: ["id", "product_tmpl_id", "display_name"],
      })
    : [];
  const templateByProduct = new Map<number, number>();
  for (const p of products) {
    if (p.product_tmpl_id) templateByProduct.set(p.id, p.product_tmpl_id[0]);
  }

  // sale.order.line.product_id → product.product; packaging lookups are keyed
  // on product.template. Resolve display names for the "unit" column in one
  // batch, falling back to the product's default packaging when the line has
  // none, or to the em-dash placeholder when the product itself has none.
  const packagingNames = await resolvePackagingNames(
    env,
    lines.map((l) => ({
      packaging_id: l.x_packaging_id ? l.x_packaging_id[0] : 0,
      product_id: l.product_id ? templateByProduct.get(l.product_id[0]) ?? 0 : 0,
    })),
  );

  // § 64 — «التعبئة» as text stands before «العبوة» and before the product's default packaging
  lines.forEach((l, i) => { const text = packTextOf(l); if (text) packagingNames[i] = text; });

  const items: QuotationLineItem[] = [];
  const price_warnings: QuotationPriceWarning[] = [];
  const missing_products: string[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  const alternatives: string[] = [];
  const sections: Array<{ before: number; title: string }> = [];
  let has_blocking_issue = false;
  // the lines' sums (used for the totals only when a line's price is not Odoo's)
  let sumNet = 0, sumTax = 0, sumGross = 0;
  let fallbackPriced = false;
  // how the lines' taxes are set, from Odoo's own numbers: a price that already holds its tax, or one it is added to
  let taxedIncluded = 0, taxedExcluded = 0;

  let lineIdx = -1;
  let place = 0;
  for (const l of lines) {
    lineIdx++;
    const kind = typeof l.display_type === "string" ? l.display_type : "";
    // a note is text under the table; a section (or a subsection) is a group's title: neither is an item
    if (kind === "line_note") {
      const text = String(typeof l.name === "string" ? l.name : "").trim();
      if (text) notes.push(text);
      continue;
    }
    if (kind) {
      const title = firstDescriptionLine(l.name);
      if (title) sections.push({ before: items.length, title });
      continue;
    }
    place++;
    const productName = l.product_id ? stripRef(l.product_id[1]).trim() : "";
    // what Baraa wrote on the line first; the product's name when he wrote nothing
    const name = firstDescriptionLine(l.name) || productName;
    const qty = num(l.product_uom_qty);
    const uom = l.product_uom_id && l.product_uom_id[0] !== GENERIC_UOM_ID ? String(l.product_uom_id[1] ?? "").trim() : "";
    // a line with no product has no packaging of its own: its unit of measure («كرتون») names it
    const packagingName = packagingNames[lineIdx] !== NO_PACKAGING_PLACEHOLDER || l.product_id || !uom ? packagingNames[lineIdx] : uom;
    const detail = itemDetail(l.x_item_origin, l.x_item_size);

    const manualUnit =
      typeof l.x_price_unit_manual === "number" && l.x_price_unit_manual > 0
        ? l.x_price_unit_manual
        : 0;
    const stored = typeof l.price_unit === "number" && l.price_unit > 0 ? l.price_unit : 0;

    if (!(qty > 0)) {
      // quantity 0 with a price: an alternative, under the table and outside the totals; with none: nothing to quote
      const price = stored || manualUnit;
      if (price > 0 && name) {
        alternatives.push(`${[name, packagingName !== NO_PACKAGING_PLACEHOLDER ? packagingName : "", detail].filter(Boolean).join(" · ")} — ${plain(price)} ريال`);
      }
      continue;
    }
    if (!name) {
      has_blocking_issue = true;
      problems.push(`السطر ${place} بلا منتج ولا وصف: اكتب وصفه أو اختر منتجه`);
      continue;
    }

    let unit = 0, net = 0, tax = 0, gross = 0, total = 0;
    let source: "today" | "stale" | "missing" = "today";
    let age_days: number | null = 0;
    if (stored > 0 && typeof l.price_total === "number" && typeof l.price_subtotal === "number") {
      // Odoo's own numbers for the line
      net = round2(num(l.price_subtotal)); tax = round2(num(l.price_tax)); gross = round2(num(l.price_total));
      const asked = stored * qty * (1 - num(l.discount) / 100);
      const included = Math.abs(asked - gross) <= Math.abs(asked - net);
      if (tax > 0.004) { if (included) taxedIncluded++; else taxedExcluded++; }
      total = included ? gross : net;
      unit = num(l.discount) ? round2(total / qty) : stored;
    } else {
      unit = manualUnit || stored;
      if (unit <= 0) {
        const tmplId = l.product_id ? templateByProduct.get(l.product_id[0]) ?? 0 : 0;
        const packagingId = l.x_packaging_id ? l.x_packaging_id[0] : 0;
        if (tmplId && packagingId) {
          const lookup = await getLatestSalePrice(env, tmplId, packagingId);
          unit = lookup.price;
          source = lookup.source;
          age_days = lookup.age_days;
        } else {
          source = "missing";
          age_days = null;
        }
      }
      // a price Odoo does not hold on the line: a VAT-inclusive one, as the day's prices are
      fallbackPriced = true;
      gross = round2(unit * qty); net = round2(gross / VAT_FACTOR); tax = round2(gross - net);
      total = gross;
      if (unit > 0) taxedIncluded++;
    }

    if (source !== "today") {
      price_warnings.push({ product: name, source, age_days });
      if (source === "missing") {
        has_blocking_issue = true;
        if (!missing_products.includes(name)) missing_products.push(name);
      }
    }
    if (unit <= 0) {
      has_blocking_issue = true;
      if (!missing_products.includes(name)) missing_products.push(name);
    }

    sumNet = round2(sumNet + net); sumTax = round2(sumTax + tax); sumGross = round2(sumGross + gross);
    items.push({ name, pack: packagingName, qty, price: unit, total, net, vat: tax, gross, ...(detail ? { detail } : {}) });
  }
  for (const n of missing_products) problems.push(`صنف بلا سعر: ${n}`);
  // nothing to quote (no line, or notes and alternatives alone) is not a quotation
  if (!items.length && !problems.length) { has_blocking_issue = true; problems.push("لا أصناف في أمر البيع: أضف سطراً بكمية وسعر"); }

  const rawDate = order.date_order || order.create_date;
  const quotationDate = rawDate
    ? new Date(String(rawDate).replace(" ", "T") + "Z")
    : new Date();
  const number = typeof order.name === "string" && order.name ? order.name : `S-${saleOrderId}`;
  const addressParts = [partner?.street, partner?.city].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  const address = addressParts.length > 0 ? addressParts.join(", ") : "الرياض";

  // the totals: the order's own amounts; the lines' sums only when a line's price was not Odoo's
  const fromOdoo = !fallbackPriced && typeof order.amount_total === "number";
  const subtotal = fromOdoo ? round2(num(order.amount_untaxed)) : sumNet;
  const vatAmount = fromOdoo ? round2(num(order.amount_tax)) : sumTax;
  const grandTotal = fromOdoo ? round2(num(order.amount_total)) : sumGross;
  // every quantity 1: a price list, not an order — «عرض سعر الوحدة»
  const unitLayout = items.length > 0 && items.every((x) => x.qty === 1);
  // «شامل» / «قبل الضريبة» by the lines' taxes; lines of both kinds (or none taxed) get no sentence
  const vatWords = taxedIncluded > 0 && taxedExcluded === 0 ? "included" : taxedExcluded > 0 && taxedIncluded === 0 ? "excluded" : "";

  return {
    quotationNumber: number,
    quotationDate,
    customer: {
      name: (typeof partner?.name === "string" && partner.name) || "عميل",
      address,
      phone:
        (typeof partner?.x_whatsapp_number === "string" && partner.x_whatsapp_number) ||
        (typeof partner?.phone === "string" && partner.phone) ||
        "",
    },
    items,
    subtotal,
    discount: 0,
    vatAmount,
    grandTotal,
    totals: { subtotalLabel: SALE_NET_SUBTOTAL_LABEL, vatLabel: vatAmount > 0 ? SALE_VAT_LABEL : SALE_NO_VAT_LABEL, hideDiscount: true },
    // a unit-price quotation prints each price before its VAT and with it: no sentence to add
    ...(unitLayout ? { layout: "unit" as const }
      : vatWords === "included" ? { vatInclusive: true }
      : vatWords === "excluded" ? { footerNote: `${QUOTATION_FOOTER}. ${UI.vatExclusiveNote.ar}` } : {}),
    ...(alternatives.length ? { belowTable: { label: SALE_ALTERNATIVES_LABEL, text: alternatives.join("\n") } } : {}),
    ...(notes.length ? { belowBlocks: [{ label: SALE_NOTES_LABEL, text: notes.join("\n") }] } : {}),
    ...(sections.length ? { sections } : {}),
    price_warnings,
    has_blocking_issue,
    is_manual: true,
    customer_id: order.partner_id[0],
    order_id: order.id,
    missing_products,
    problems,
    // Sent / confirmed = issued (seal + signature); a draft stays unsealed.
    // The WhatsApp send route marks its copy issued: sending issues it.
    issued: order.state === "sent" || order.state === "sale" || order.state === "done",
  };
}
