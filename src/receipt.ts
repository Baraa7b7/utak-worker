// UTAK Payment Receipt — إيصال دفع
// Uses the shared renderPDFShell for pixel-parity with the invoice.

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

export interface ReceiptPayment {
  invoiceNumber: string;
  invoiceDate: string; // display-ready
  amount: number;
  method: string;      // "نقد" | "تحويل بنكي" | free text
}

export interface ReceiptPDFData {
  receiptNumber: string;
  receiptDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  payments: ReceiptPayment[];
  totalReceived: number;
}

const RECEIPT_FOOTER =
  "استلمنا منكم المبلغ المذكور أعلاه عن الفواتير المدرجة. شكراً لالتزامكم.";

// ---- Body: 4 columns — invoice-# / invoice-date / amount / method ----
export function renderReceiptBodyHTML(
  payments: ReceiptPayment[],
  m?: PageMetrics,
): string {
  const metrics = m ?? computePageMetrics(payments.length);
  const rowsHtml = payments
    .map(
      (p) => `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; direction: ltr; unicode-bidi: plaintext;">${escapeHTML(p.invoiceNumber)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${escapeHTML(p.invoiceDate)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(p.amount)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted};">${escapeHTML(p.method)}</td>
    </tr>
  `,
    )
    .join("");

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          <th style="width: 30%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">رقم الفاتورة</th>
          <th style="width: 25%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">تاريخ الفاتورة</th>
          <th style="width: 20%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">المبلغ</th>
          <th style="width: 25%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">طريقة الدفع</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: single "إجمالي المستلم" row, using invoice grand-total style ----
export function renderReceiptTotalsHTML(totalReceived: number): string {
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">إجمالي المستلم</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(totalReceived)}</span></div>
      </div>
    </div>`;
}

export function renderReceiptHTML(data: ReceiptPDFData): string {
  const pageMetrics = computePageMetrics(data.payments.length);
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  return renderPDFShell({
    documentTitle: "إيصال دفع",
    documentNumber: data.receiptNumber,
    documentDate: data.receiptDate,
    billTo,
    bodyHTML: renderReceiptBodyHTML(data.payments, pageMetrics),
    totalsHTML: renderReceiptTotalsHTML(data.totalReceived),
    footerNote: RECEIPT_FOOTER,
    showZatcaQR: false,
    pageMetrics,
  });
}

export async function generateReceiptPDF(
  data: ReceiptPDFData,
  env: Env,
): Promise<Uint8Array> {
  return await htmlToPDF(renderReceiptHTML(data), env);
}

export async function uploadReceiptToR2(
  env: Env,
  pdfBytes: Uint8Array,
  receiptNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  return await uploadPDFToR2(env, {
    pdfBytes,
    folder: "receipts",
    urlPrefix: "receipt-pdf",
    docNumber: receiptNumber,
    workerOrigin,
  });
}

// ---- Build from a real Odoo x_payment record ----
export async function buildReceiptPDFDataFromOdoo(
  env: Env,
  paymentId: number,
): Promise<ReceiptPDFData | null> {
  type PaymentRow = {
    id: number;
    x_invoice_id: [number, string] | false;
    x_amount: number | false;
    x_method: string | false;
    x_collected_at: string | false;
    create_date: string | false;
  };
  const rows = await call<PaymentRow[]>(env, "x_payment", "read", {
    ids: [paymentId],
    fields: ["id", "x_invoice_id", "x_amount", "x_method", "x_collected_at", "create_date"],
  });
  const p = rows[0];
  if (!p) return null;

  const invoiceId = p.x_invoice_id ? p.x_invoice_id[0] : 0;
  if (!invoiceId) throw new Error(`Payment ${paymentId} has no linked invoice`);

  type InvRow = {
    id: number;
    x_invoice_number: string | false;
    x_invoice_date: string | false;
    x_order_id: [number, string] | false;
  };
  const invRows = await call<InvRow[]>(env, "x_invoice", "read", {
    ids: [invoiceId],
    fields: ["id", "x_invoice_number", "x_invoice_date", "x_order_id"],
  });
  const inv = invRows[0];
  if (!inv) throw new Error(`Invoice ${invoiceId} for payment ${paymentId} not found`);

  // Look up the customer for the receipt header
  let custName = "عميل";
  let custAddr = "الرياض";
  let custPhone = "";
  if (inv.x_order_id) {
    type OrderRow = {
      id: number;
      x_customer_id: [number, string] | false;
      x_delivery_neighborhood: string | false;
    };
    const [order] = await call<OrderRow[]>(env, "x_daily_order", "read", {
      ids: [inv.x_order_id[0]],
      fields: ["id", "x_customer_id", "x_delivery_neighborhood"],
    });
    if (order) {
      custAddr = order.x_delivery_neighborhood || custAddr;
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
    }
  }

  const amount = typeof p.x_amount === "number" ? p.x_amount : 0;
  const method = mapMethod(p.x_method);
  const invoiceDate = typeof inv.x_invoice_date === "string" ? inv.x_invoice_date : "";
  const rawDate = (p.x_collected_at || p.create_date) as string | false;
  const receiptDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();
  const invNum = typeof inv.x_invoice_number === "string" ? inv.x_invoice_number : String(invoiceId);
  const receiptNumber = `RCP-${new Date().getFullYear()}-${String(paymentId).padStart(4, "0")}`;

  return {
    receiptNumber,
    receiptDate,
    customer: {
      name: custName,
      address: custAddr,
      phone: custPhone,
    },
    payments: [{ invoiceNumber: invNum, invoiceDate, amount, method }],
    totalReceived: amount,
  };
}

function mapMethod(m: string | false): string {
  if (m === "cash") return "نقد";
  if (m === "transfer") return "تحويل بنكي";
  return (typeof m === "string" && m) ? m : "-";
}

// ---- Test data — 3 invoices, ~4500 SAR total ----
export const TEST_RECEIPT_DATA: ReceiptPDFData = {
  receiptNumber: "RCP-2026-0018",
  receiptDate: new Date("2026-09-08T14:20:00Z"),
  customer: {
    name: "مطعم النخيل",
    contactPerson: "أ. محمد الشمري",
    address: "العليا، الرياض",
    phone: "+966 55 214 8830",
  },
  payments: [
    { invoiceNumber: "UTAK-INV-20260901-003", invoiceDate: "2026-09-01", amount: 1517, method: "نقد" },
    { invoiceNumber: "UTAK-INV-20260903-007", invoiceDate: "2026-09-03", amount: 2015, method: "تحويل بنكي" },
    { invoiceNumber: "UTAK-INV-20260905-002", invoiceDate: "2026-09-05", amount: 968, method: "نقد" },
  ],
  totalReceived: 4500,
};
