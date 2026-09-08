// UTAK Purchase Order — أمر شراء (to supplier)
// Uses the shared renderPDFShell. Party names stay as-is on the shell
// ("فاتورة إلى / BILL TO"); the CONTENT of that slot is supplier data.

import type { Env } from "./config";
import { call } from "./odoo";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  htmlToPDF,
  renderPDFShell,
  uploadPDFToR2,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";

export interface PurchaseOrderItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
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
}

const PO_FOOTER =
  "يُرجى التسليم في التاريخ المحدد. أي تعديل في الأسعار يتطلب موافقة مسبقة من UTAK.";

// ---- Body: 5 columns (agreed price + total, no VAT) ----
export function renderPurchaseOrderBodyHTML(
  items: PurchaseOrderItem[],
  m?: PageMetrics,
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const rowsHtml = items
    .map(
      (item) => `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(item.name)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${escapeHTML(item.pack)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${metrics.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total)}</td>
    </tr>
  `,
    )
    .join("");

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          <th style="width: 40%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الصنف</th>
          <th style="width: 20%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">العبوة</th>
          <th style="width: 10%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الكمية المطلوبة</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">السعر المتفق</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: subtotal + total (no VAT, no discount) ----
export function renderPurchaseOrderTotalsHTML(
  subtotal: number,
  grandTotal: number,
): string {
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>المجموع الفرعي</span><span style="direction: ltr;">${formatMoney(subtotal)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">الإجمالي</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal)}</span></div>
      </div>
    </div>`;
}

export function renderPurchaseOrderHTML(data: PurchaseOrderPDFData): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const supplierAsBillTo: PartyInfo = {
    name: data.supplier.name,
    contactName: data.supplier.contactPerson,
    address: data.supplier.address,
    phone: data.supplier.phone,
  };
  return renderPDFShell({
    documentTitle: "أمر شراء",
    documentNumber: data.poNumber,
    documentDate: data.poDate,
    billTo: supplierAsBillTo,
    bodyHTML: renderPurchaseOrderBodyHTML(data.items, pageMetrics),
    totalsHTML: renderPurchaseOrderTotalsHTML(data.subtotal, data.grandTotal),
    footerNote: PO_FOOTER,
    showZatcaQR: false,
    pageMetrics,
  });
}

export async function generatePurchaseOrderPDF(
  data: PurchaseOrderPDFData,
  env: Env,
): Promise<Uint8Array> {
  return await htmlToPDF(renderPurchaseOrderHTML(data), env);
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
    product_name?: string;
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

  let subtotal = 0;
  const items: PurchaseOrderItem[] = aggregated.map((a) => {
    const qty = typeof a.total_quantity === "number" ? a.total_quantity : 0;
    const price = typeof a.unit_price === "number" ? a.unit_price : 0;
    const total = round2(qty * price);
    subtotal = round2(subtotal + total);
    return {
      name: a.product_name || "صنف",
      pack: a.packaging_name || "-",
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
