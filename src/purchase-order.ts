// UTAK Purchase Order — أمر شراء (to supplier)
// Uses the shared renderPDFShell. Party names stay as-is on the shell
// ("فاتورة إلى / BILL TO"); the CONTENT of that slot is supplier data.

import type { Env } from "./config";
import { call, resolvePackagingNames } from "./odoo";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  htmlToPDF,
  buildGotenbergFooterHtml,
  GOTENBERG_FOOTER_MARGIN,
  renderPDFShell,
  uploadPDFToR2,
  type LegalFooterInfo,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";
import { readCompanyInfo, type CompanyInfo } from "./company";
import { toLegalFooterAr } from "./legal-footer";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, itemCellHTML, labelForBillTo, labelForFrom, labelForTerms, taglineFor, thanksLine } from "./doc-shell";

export interface PurchaseOrderItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
  name_en?: string;
  pack_en?: string;
}

export interface PurchaseOrderPDFData {
  poNumber: string;
  poDate: Date;
  supplier: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: PurchaseOrderItem[];
  subtotal: number;
  grandTotal: number;
  // Doc-level language. purchase.order has no Studio x_doc_lang field; the
  // dispatcher fills this from the supplier's res.partner.x_doc_lang (with
  // "ar" fallback).
  lang?: DocLang;
}

const PO_FOOTER =
  "يُرجى التسليم في التاريخ المحدد. أي تعديل في الأسعار يتطلب موافقة مسبقة من UTAK.";

// ---- Body: 5 columns (agreed price + total, no VAT) ----
export function renderPurchaseOrderBodyHTML(
  items: PurchaseOrderItem[],
  m?: PageMetrics,
  lang: DocLang = "ar",
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = items
    .map(
      (item) => {
        const nameCell = isAr ? escapeHTML(item.name) : itemCellHTML(item.name, item.name_en, lang);
        const packCell = isAr ? escapeHTML(item.pack) : itemCellHTML(item.pack, item.pack_en, lang);
        return `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${packCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price, lang)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total, lang)}</td>
    </tr>
  `;
      },
    )
    .join("");

  const L = (key: "colItem" | "colPackaging" | "colOrderedQty" | "colAgreedPrice" | "colTotal") =>
    isEn ? UI[key].en : UI[key].ar;
  const th = (label: string, w: string, alignEn = false) =>
    `<th style="width: ${w}; text-align: ${isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right")}; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">${escapeHTML(label)}</th>`;

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          ${th(L("colItem"), "40%")}
          ${th(L("colPackaging"), "20%")}
          ${th(L("colOrderedQty"), "10%", true)}
          ${th(L("colAgreedPrice"), "15%", true)}
          ${th(L("colTotal"), "15%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: subtotal + total (no VAT, no discount) ----
export function renderPurchaseOrderTotalsHTML(
  subtotal: number,
  grandTotal: number,
  lang: DocLang = "ar",
): string {
  const L = (key: "subtotal" | "grandTotal") => (lang === "en" ? UI[key].en : UI[key].ar);
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(L("subtotal"))}</span><span style="direction: ltr;">${formatMoney(subtotal, lang)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(L("grandTotal"))}</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal, lang)}</span></div>
      </div>
    </div>`;
}

export function renderPurchaseOrderHTML(data: PurchaseOrderPDFData, company?: CompanyInfo): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  const supplierAsBillTo: PartyInfo = {
    name: data.supplier.name,
    contactName: data.supplier.contactPerson,
    address: data.supplier.address,
    phone: data.supplier.phone,
  };
  const legalFooterBar: LegalFooterInfo | undefined = company
    ? toLegalFooterAr(company)
    : undefined;
  return renderPDFShell({
    documentTitle: lang === "en" ? UI.purchaseOrder.en : UI.purchaseOrder.ar,
    documentNumber: data.poNumber,
    documentDate: data.poDate,
    billTo: supplierAsBillTo,
    from: data.lang ? fromPartyFor(lang, company) : undefined,
    bodyHTML: renderPurchaseOrderBodyHTML(data.items, pageMetrics, lang),
    totalsHTML: renderPurchaseOrderTotalsHTML(data.subtotal, data.grandTotal, lang),
    footerNote: lang === "en" ? UI.poNote.en : PO_FOOTER,
    showZatcaQR: false,
    legalFooterBar,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    billToLabel: data.lang ? labelForBillTo(lang) : undefined,
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    termsLabel: data.lang ? labelForTerms(lang) : undefined,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    documentDateStr: lang === "en" ? formatDateEn(data.poDate) : undefined,
  });
}

export async function generatePurchaseOrderPDF(
  data: PurchaseOrderPDFData,
  env: Env,
): Promise<Uint8Array> {
  const company = await readCompanyInfo(env);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  return await htmlToPDF(renderPurchaseOrderHTML(data, company), env, {
    footerHtml: buildGotenbergFooterHtml(lang),
    marginBottom: GOTENBERG_FOOTER_MARGIN,
  });
}

export async function uploadPurchaseOrderToR2(
  env: Env,
  pdfBytes: Uint8Array,
  poNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  return await uploadPDFToR2(env, {
    pdfBytes,
    folder: "purchase-orders",
    urlPrefix: "purchase-order-pdf",
    docNumber: poNumber,
    workerOrigin,
  });
}

// ---- Build from a real Odoo x_purchase_list record ----
// NOTE: x_purchase_list is a daily AGGREGATED list across all suppliers
// (see createPurchaseListRecord + x_aggregated_items JSON). We do not have
// a single supplier per list. The PDF uses a generic "الأسواق المركزية"
// placeholder in the BILL TO slot until a per-supplier PO model exists.
export async function buildPurchaseOrderPDFDataFromOdoo(
  env: Env,
  purchaseListId: number,
): Promise<PurchaseOrderPDFData | null> {
  type ListRow = {
    id: number;
    x_date: string | false;
    x_aggregated_items: string | false;
    x_status: string | false;
    create_date: string | false;
  };
  const rows = await call<ListRow[]>(env, "x_purchase_list", "read", {
    ids: [purchaseListId],
    fields: ["id", "x_date", "x_aggregated_items", "x_status", "create_date"],
  });
  const list = rows[0];
  if (!list) return null;

  type Agg = {
    product_id?: number;
    product_name?: string;
    packaging_id?: number;
    packaging_name?: string;
    total_quantity?: number;
    unit_price?: number;
  };
  let aggregated: Agg[] = [];
  const raw = list.x_aggregated_items;
  if (typeof raw === "string" && raw) {
    try {
      aggregated = JSON.parse(raw) as Agg[];
    } catch {
      aggregated = [];
    }
  }

  // Re-resolve packaging labels at render time. The purchase list stores a
  // snapshot of packaging_name from when the list was aggregated, but the
  // packaging refactor rebuilds x_name from x_type + weight — read the live
  // value so the PO shows what Odoo shows.
  const packagingNames = await resolvePackagingNames(
    env,
    aggregated.map((a) => ({
      packaging_id: typeof a.packaging_id === "number" ? a.packaging_id : 0,
      product_id: typeof a.product_id === "number" ? a.product_id : 0,
    })),
  );

  let subtotal = 0;
  const items: PurchaseOrderItem[] = aggregated.map((a, i) => {
    const qty = typeof a.total_quantity === "number" ? a.total_quantity : 0;
    const price = typeof a.unit_price === "number" ? a.unit_price : 0;
    const total = round2(qty * price);
    subtotal = round2(subtotal + total);
    return {
      name: a.product_name || "صنف",
      pack: packagingNames[i],
      qty,
      price,
      total,
    };
  });

  const rawDate = (list.x_date || list.create_date) as string | false;
  const poDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();
  const poNumber = `PO-${new Date().getFullYear()}-${String(purchaseListId).padStart(4, "0")}`;

  return {
    poNumber,
    poDate,
    supplier: {
      name: "الأسواق المركزية",
      address: "سوق الجملة، الرياض",
      phone: "",
    },
    items,
    subtotal,
    grandTotal: subtotal,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Build from a standard Odoo purchase.order ----
// Parallel reader alongside buildPurchaseOrderPDFDataFromOdoo (x_purchase_list).
// Reads partner_id (supplier) + order_line, resolves packaging from the
// x_product_packaging fallback per product template.
export async function buildPurchaseOrderPDFDataFromPurchaseOrder(
  env: Env,
  purchaseOrderId: number,
): Promise<PurchaseOrderPDFData | null> {
  type POHead = {
    id: number;
    name: string | false;
    date_order: string | false;
    partner_id: [number, string] | false;
    order_line: number[];
    amount_untaxed: number;
    amount_total: number;
  };
  const heads = await call<POHead[]>(env, "purchase.order", "read", {
    ids: [purchaseOrderId],
    fields: ["id","name","date_order","partner_id","order_line","amount_untaxed","amount_total"],
  });
  const head = heads[0];
  if (!head) return null;

  type Partner = { id: number; name: string | false; phone: string | false; street: string | false; city: string | false };
  const partner = head.partner_id
    ? (await call<Partner[]>(env, "res.partner", "read", {
        ids: [head.partner_id[0]],
        fields: ["id","name","phone","street","city"],
      }))[0]
    : null;

  type Line = {
    id: number;
    name: string | false;
    product_id: [number, string] | false;
    product_qty: number;
    price_unit: number;
    price_subtotal: number;
    x_packaging_id: [number, string] | false;
  };
  type ProdProd = { id: number; product_tmpl_id: [number, string] | false };
  const lines = head.order_line.length > 0
    ? await call<Line[]>(env, "purchase.order.line", "read", {
        ids: head.order_line,
        fields: ["id","name","product_id","product_qty","price_unit","price_subtotal","x_packaging_id"],
      })
    : [];
  const prodIds = Array.from(new Set(lines.map((l) => l.product_id ? l.product_id[0] : 0).filter((n) => n > 0)));
  const prods = prodIds.length > 0
    ? await call<ProdProd[]>(env, "product.product", "read", {
        ids: prodIds,
        fields: ["id","product_tmpl_id"],
      })
    : [];
  const tmplByProd = new Map<number, number>();
  for (const p of prods) if (p.product_tmpl_id) tmplByProd.set(p.id, p.product_tmpl_id[0]);

  // Read packaging from the line first (Studio m2o x_packaging_id); fall back
  // to the product's default packaging when the line has none.
  const packagingNames = await resolvePackagingNames(
    env,
    lines.map((l) => ({
      packaging_id: l.x_packaging_id ? l.x_packaging_id[0] : 0,
      product_id: l.product_id ? (tmplByProd.get(l.product_id[0]) ?? 0) : 0,
    })),
  );

  let subtotal = 0;
  const items: PurchaseOrderItem[] = lines.map((l, i) => {
    const total = round2(l.price_subtotal);
    subtotal = round2(subtotal + total);
    const displayName = (typeof l.name === "string" && l.name)
      ? l.name.split("\n")[0]
      : (l.product_id ? l.product_id[1] : "صنف");
    return {
      name: displayName,
      pack: packagingNames[i],
      qty: l.product_qty,
      price: l.price_unit,
      total,
    };
  });

  const rawDate = head.date_order || null;
  const poDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();

  return {
    poNumber: (typeof head.name === "string" && head.name) ? head.name : `PO-${purchaseOrderId}`,
    poDate,
    supplier: {
      name: partner?.name || (head.partner_id ? head.partner_id[1] : "المورد"),
      address: partner?.street || partner?.city || "الرياض",
      phone: partner?.phone || "",
    },
    items,
    subtotal,
    grandTotal: head.amount_total || subtotal,
  };
}

// ---- Test data — supplier "خضار الرياض", 4 items ----
export const TEST_PURCHASE_ORDER_DATA: PurchaseOrderPDFData = {
  poNumber: "PO-2026-0042",
  poDate: new Date("2026-09-08T21:15:00Z"),
  supplier: {
    name: "خضار الرياض",
    contactPerson: "أ. أحمد الغامدي",
    address: "سوق الجملة، الرياض",
    phone: "+966 55 900 4400",
  },
  items: [
    { name: "طماطم شيري كرزية درجة أولى", pack: "كرتون ٨ كجم", qty: 30, price: 32, total: 960 },
    { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 40, price: 18, total: 720 },
    { name: "بطاطس", pack: "كيس ٢٥ كجم", qty: 25, price: 55, total: 1375 },
    { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 22, price: 60, total: 1320 },
  ],
  subtotal: 4375,
  grandTotal: 4375,
};
