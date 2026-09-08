// UTAK Delivery Note — إذن تسليم
// Uses the shared renderPDFShell — no prices, no totals.

import type { Env } from "./config";
import { call } from "./odoo";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  htmlToPDF,
  renderPDFShell,
  uploadPDFToR2,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";

export interface DeliveryNoteItem {
  name: string;
  pack: string;
  qty: number;
}

export interface DeliveryNotePDFData {
  deliveryNumber: string;
  deliveryDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: DeliveryNoteItem[];
}

// Placeholder — round B will replace with the actual signature/whatsapp blocks.
const DELIVERY_NOTE_FOOTER =
  "سيصلكم رابط لتوقيع الاستلام مع رسالة واتساب تأكيدية بعد إتمام التسليم.";

// ---- Body: 3 columns only — no prices ----
export function renderDeliveryNoteBodyHTML(
  items: DeliveryNoteItem[],
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
    </tr>
  `,
    )
    .join("");

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          <th style="width: 55%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الصنف</th>
          <th style="width: 30%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">العبوة</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الكمية</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

export function renderDeliveryNoteHTML(data: DeliveryNotePDFData): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  return renderPDFShell({
    documentTitle: "إذن تسليم",
    documentNumber: data.deliveryNumber,
    documentDate: data.deliveryDate,
    billTo,
    bodyHTML: renderDeliveryNoteBodyHTML(data.items, pageMetrics),
    // no totalsHTML for delivery notes
    footerNote: DELIVERY_NOTE_FOOTER,
    showZatcaQR: false,
    pageMetrics,
  });
}

export async function generateDeliveryNotePDF(
  data: DeliveryNotePDFData,
  env: Env,
): Promise<Uint8Array> {
  return await htmlToPDF(renderDeliveryNoteHTML(data), env);
}

export async function uploadDeliveryNoteToR2(
  env: Env,
  pdfBytes: Uint8Array,
  deliveryNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  return await uploadPDFToR2(env, {
    pdfBytes,
    folder: "delivery-notes",
    urlPrefix: "delivery-note-pdf",
    docNumber: deliveryNumber,
    workerOrigin,
  });
}

// ---- Build from a real Odoo x_delivery_stop record ----
export async function buildDeliveryNotePDFDataFromOdoo(
  env: Env,
  deliveryStopId: number,
): Promise<DeliveryNotePDFData | null> {
  type StopRow = {
    id: number;
    x_order_id: [number, string] | false;
    x_sequence: number | false;
    create_date: string | false;
  };
  const rows = await call<StopRow[]>(env, "x_delivery_stop", "read", {
    ids: [deliveryStopId],
    fields: ["id", "x_order_id", "x_sequence", "create_date"],
  });
  const stop = rows[0];
  if (!stop) return null;
  if (!stop.x_order_id) {
    throw new Error(`Delivery stop ${deliveryStopId} has no linked order`);
  }
  const orderId = stop.x_order_id[0];

  type OrderRow = {
    id: number;
    x_customer_id: [number, string] | false;
    x_delivery_neighborhood: string | false;
    x_line_ids: number[];
  };
  const [order] = await call<OrderRow[]>(env, "x_daily_order", "read", {
    ids: [orderId],
    fields: ["id", "x_customer_id", "x_delivery_neighborhood", "x_line_ids"],
  });
  if (!order) throw new Error(`Order ${orderId} for stop ${deliveryStopId} not found`);

  let custName = "عميل";
  let custPhone = "";
  if (order.x_customer_id) {
    type Partner = { id: number; name: string; phone: string | false; x_whatsapp_number: string | false };
    const [partner] = await call<Partner[]>(env, "res.partner", "read", {
      ids: [order.x_customer_id[0]],
      fields: ["id", "name", "phone", "x_whatsapp_number"],
    });
    if (partner) {
      custName = partner.name || custName;
      custPhone = partner.x_whatsapp_number || partner.phone || "";
    }
  }

  type LineRow = {
    id: number;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
    x_status: string;
  };
  const lines = (order.x_line_ids && order.x_line_ids.length)
    ? await call<LineRow[]>(env, "x_daily_order_line", "read", {
        ids: order.x_line_ids,
        fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status"],
      })
    : [];

  const items: DeliveryNoteItem[] = lines
    .filter((l) => l.x_status !== "unavailable")
    .map((l) => ({
      name: l.x_product_tmpl_id ? l.x_product_tmpl_id[1] : "?",
      pack: l.x_packaging_id ? l.x_packaging_id[1] : "-",
      qty: l.x_quantity,
    }));

  const rawDate = stop.create_date as string | false;
  const deliveryDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();
  const deliveryNumber = `DLV-${new Date().getFullYear()}-${String(deliveryStopId).padStart(4, "0")}`;

  return {
    deliveryNumber,
    deliveryDate,
    customer: {
      name: custName,
      address: order.x_delivery_neighborhood || "الرياض",
      phone: custPhone,
    },
    items,
  };
}

// ---- Test data — 5 items, no prices ----
export const TEST_DELIVERY_NOTE_DATA: DeliveryNotePDFData = {
  deliveryNumber: "DLV-2026-0091",
  deliveryDate: new Date("2026-09-08T10:00:00Z"),
  customer: {
    name: "مطعم النخيل",
    contactPerson: "أ. محمد الشمري",
    address: "العليا، الرياض",
    phone: "+966 55 214 8830",
  },
  items: [
    { name: "طماطم شيري كرزية درجة أولى", pack: "كرتون ٨ كجم", qty: 5 },
    { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8 },
    { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4 },
    { name: "بطاطس", pack: "كيس ٢٥ كجم", qty: 4 },
    { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 4 },
  ],
};
