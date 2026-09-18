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

import type { Env } from "./config";
import { call, getLatestSalePrice, stripRef } from "./odoo";
import type { QuotationLineItem, QuotationPDFData, QuotationPriceWarning } from "./quotation";

interface SaleOrderRow {
  id: number;
  name: string | false;
  partner_id: [number, string] | false;
  date_order: string | false;
  create_date: string | false;
  order_line: number[];
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
  product_id: [number, string] | false;
  product_uom_qty: number;
  price_unit: number;
  x_price_unit_manual: number | false;
  x_packaging_id: [number, string] | false;
}

interface ProductProductRow {
  id: number;
  product_tmpl_id: [number, string] | false;
  display_name: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildQuotationPDFDataFromSaleOrder(
  env: Env,
  saleOrderId: number,
): Promise<QuotationPDFData | null> {
  const orders = await call<SaleOrderRow[]>(env, "sale.order", "read", {
    ids: [saleOrderId],
    fields: ["id", "name", "partner_id", "date_order", "create_date", "order_line"],
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
          "product_id",
          "product_uom_qty",
          "price_unit",
          "x_price_unit_manual",
          "x_packaging_id",
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

  let subtotal = 0;
  const items: QuotationLineItem[] = [];
  const price_warnings: QuotationPriceWarning[] = [];
  const missing_products: string[] = [];
  let has_blocking_issue = false;

  for (const l of lines) {
    const productName = l.product_id ? stripRef(l.product_id[1]) : "صنف";
    const packagingName = l.x_packaging_id ? stripRef(l.x_packaging_id[1]) : "-";
    const qty = l.product_uom_qty;

    const manualUnit =
      typeof l.x_price_unit_manual === "number" && l.x_price_unit_manual > 0
        ? l.x_price_unit_manual
        : 0;
    let unit = manualUnit;
    let source: "today" | "stale" | "missing" = "today";
    let age_days: number | null = 0;

    if (unit <= 0) {
      const stored = typeof l.price_unit === "number" && l.price_unit > 0 ? l.price_unit : 0;
      if (stored > 0) {
        unit = stored;
        source = "today";
      }
    }
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

    if (source !== "today") {
      price_warnings.push({ product: productName, source, age_days });
      if (source === "missing") {
        has_blocking_issue = true;
        if (!missing_products.includes(productName)) missing_products.push(productName);
      }
    }
    if (unit <= 0) {
      has_blocking_issue = true;
      if (!missing_products.includes(productName)) missing_products.push(productName);
    }

    const total = round2(unit * qty);
    subtotal = round2(subtotal + total);
    items.push({ name: productName, pack: packagingName, qty, price: unit, total });
  }

  const rawDate = order.date_order || order.create_date;
  const quotationDate = rawDate
    ? new Date(String(rawDate).replace(" ", "T") + "Z")
    : new Date();
  const number = typeof order.name === "string" && order.name ? order.name : `S-${saleOrderId}`;
  const addressParts = [partner?.street, partner?.city].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  const address = addressParts.length > 0 ? addressParts.join(", ") : "الرياض";

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
    vatAmount: 0,
    grandTotal: subtotal,
    price_warnings,
    has_blocking_issue,
    is_manual: true,
    customer_id: order.partner_id[0],
    order_id: order.id,
    missing_products,
  };
}
