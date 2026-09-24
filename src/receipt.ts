// UTAK Payment Receipt — إيصال دفع
// Uses the shared renderPDFShell for pixel-parity with the invoice.

import type { Env } from "./config";
import { call } from "./odoo";
import { sendText } from "./meta";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  htmlToPDF,
  buildGotenbergFooterHtml,
  GOTENBERG_FOOTER_MARGIN,
  renderPDFShell,
  issuedSealHTML,
  signDocToken,
  uploadPDFToR2,
  type LegalFooterInfo,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";
import { readCompanyInfo, type CompanyInfo } from "./company";
import { toLegalFooterAr } from "./legal-footer";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, labelForBillTo, labelForFrom, labelForTerms, taglineFor, thanksLine } from "./doc-shell";

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
  // Doc-level language. Receipts do not carry VAT, so no Article 53 upgrade.
  lang?: DocLang;
  /** Issued document (numbered, sent / recorded). Only issued documents print
   *  the company seal + signature — never a preview or a draft. */
  issued?: boolean;
}

const RECEIPT_FOOTER =
  "استلمنا منكم المبلغ المذكور أعلاه عن الفواتير المدرجة. شكراً لالتزامكم.";

// ---- Body: 4 columns — invoice-# / invoice-date / amount / method ----
export function renderReceiptBodyHTML(
  payments: ReceiptPayment[],
  m?: PageMetrics,
  lang: DocLang = "ar",
): string {
  const metrics = m ?? computePageMetrics(payments.length);
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = payments
    .map(
      (p) => `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; direction: ltr; unicode-bidi: plaintext;">${escapeHTML(p.invoiceNumber)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${escapeHTML(p.invoiceDate)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(p.amount, lang)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted};">${escapeHTML(p.method)}</td>
    </tr>
  `,
    )
    .join("");

  const L = (key: "colInvoiceNumber" | "colInvoiceDate" | "colAmount" | "colPaymentMethod") =>
    isEn ? UI[key].en : UI[key].ar;
  const th = (label: string, w: string, alignEn = false) =>
    `<th style="width: ${w}; text-align: ${isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right")}; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">${escapeHTML(label)}</th>`;

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          ${th(L("colInvoiceNumber"), "30%")}
          ${th(L("colInvoiceDate"), "25%")}
          ${th(L("colAmount"), "20%", true)}
          ${th(L("colPaymentMethod"), "25%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: single "إجمالي المستلم" row, using invoice grand-total style ----
export function renderReceiptTotalsHTML(totalReceived: number, lang: DocLang = "ar"): string {
  const label = lang === "en" ? UI.totalReceived.en : UI.totalReceived.ar;
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(label)}</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(totalReceived, lang)}</span></div>
      </div>
    </div>`;
}

export function renderReceiptHTML(data: ReceiptPDFData, company?: CompanyInfo): string {
  const pageMetrics = computePageMetrics(data.payments.length);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  const legalFooterBar: LegalFooterInfo | undefined = company
    ? toLegalFooterAr(company)
    : undefined;
  return renderPDFShell({
    documentTitle: lang === "en" ? UI.receipt.en : UI.receipt.ar,
    documentNumber: data.receiptNumber,
    documentDate: data.receiptDate,
    billTo,
    from: data.lang ? fromPartyFor(lang, company) : undefined,
    bodyHTML: renderReceiptBodyHTML(data.payments, pageMetrics, lang),
    totalsHTML: renderReceiptTotalsHTML(data.totalReceived, lang),
    footerNote: lang === "en" ? UI.receiptConfirmation.en : RECEIPT_FOOTER,
    showZatcaQR: false,
    legalFooterBar,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    billToLabel: data.lang ? labelForBillTo(lang) : undefined,
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    termsLabel: data.lang ? labelForTerms(lang) : undefined,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    footerSealHTML: issuedSealHTML(data.issued, company),
    sealBesideTotals: true,
    documentDateStr: lang === "en" ? formatDateEn(data.receiptDate) : undefined,
  });
}

export async function generateReceiptPDF(
  data: ReceiptPDFData,
  env: Env,
): Promise<Uint8Array> {
  const company = await readCompanyInfo(env);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  return await htmlToPDF(renderReceiptHTML(data, company), env, {
    footerHtml: buildGotenbergFooterHtml(lang),
    marginBottom: GOTENBERG_FOOTER_MARGIN,
  });
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
  // UTAK-R-YYYYMMDD-NNN — date from x_collected_at, counter = paymentId % 999
  const yyyy = receiptDate.getUTCFullYear();
  const mm = String(receiptDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(receiptDate.getUTCDate()).padStart(2, "0");
  const counter = String(paymentId % 999).padStart(3, "0");
  const receiptNumber = `UTAK-R-${yyyy}${mm}${dd}-${counter}`;

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
    // A recorded x_payment: the receipt is issued.
    issued: true,
  };
}

function mapMethod(m: string | false): string {
  if (m === "cash") return "نقد";
  if (m === "transfer") return "تحويل بنكي";
  return (typeof m === "string" && m) ? m : "-";
}

// ---- Verify a `/receipt-pdf/{num}/{tok}.pdf` signed token ----
export async function verifyReceiptToken(
  secret: string,
  receiptNumber: string,
  token: string,
): Promise<boolean> {
  const expected = await signDocToken(secret, receiptNumber);
  return expected === token;
}

// ---- Orchestrate: build → PDF → R2 → WhatsApp → write-back ----
export interface ReceiptDispatchResult {
  paymentId: number;
  number: string;
  pdfUrl: string;
  pdfSize: number;
  messageId: string | null;
}

export async function createAndDispatchReceiptForRecord(
  env: Env,
  paymentId: number,
): Promise<ReceiptDispatchResult | null> {
  let data: ReceiptPDFData | null;
  try {
    data = await buildReceiptPDFDataFromOdoo(env, paymentId);
  } catch (e) {
    console.error(
      "[r-issue] step 1 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }
  if (!data) {
    console.warn(`[receipt] record ${paymentId} not found`);
    return null;
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateReceiptPDF(data, env);
  } catch (e) {
    console.error(
      "[r-issue] step 2 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  let uploaded: { key: string; publicUrl: string; size: number };
  try {
    uploaded = await uploadReceiptToR2(
      env,
      pdfBytes,
      data.receiptNumber,
      env.WORKER_ORIGIN,
    );
  } catch (e) {
    console.error(
      "[r-issue] step 3 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  const customerPhone = data.customer.phone;
  const amount = data.totalReceived;
  const method = data.payments[0]?.method || "-";

  let messageId: string | null = null;
  if (!customerPhone) {
    console.warn(`[receipt] ${paymentId} has no customer WhatsApp — skipping send`);
  } else {
    try {
      // Plain-text fallback pending an approved receipt template (mirrors quotation).
      const body = [
        `✅ تم استلام دفعتك`,
        `رقم الإيصال: ${data.receiptNumber}`,
        `المبلغ: ${amount} ر.س`,
        `طريقة الدفع: ${method}`,
        ``,
        `الإيصال: ${uploaded.publicUrl}`,
        ``,
        `شكراً لتعاملكم مع UTAK 🌿`,
      ].join("\n");
      const resp = await sendText(env, customerPhone, body);
      if (resp?.ok) {
        try {
          const j = (await resp.json()) as { messages?: Array<{ id?: string }> };
          messageId = j?.messages?.[0]?.id ?? null;
        } catch {
          /* ignore parse error — Meta returned non-JSON */
        }
      }
    } catch (e) {
      console.error(
        "[r-issue] step 4 FAILED:",
        (e as Error).message,
        (e as Error).stack,
      );
      throw e;
    }
  }

  // Warn-and-continue: a write-back failure must not undo a WhatsApp send
  // that already reached the customer.
  try {
    await call<boolean>(env, "x_payment", "write", {
      ids: [paymentId],
      vals: {
        x_studio_char_1_1: data.receiptNumber,
        x_studio_datetime_1_1: nowOdoo(),
        x_studio_char_2: uploaded.publicUrl,
      },
    });
  } catch (e) {
    console.error(
      "[r-issue] step 5 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    console.warn(
      `[receipt] failed to write-back x_payment fields for ${paymentId}`,
      (e as Error).message,
    );
  }

  return {
    paymentId,
    number: data.receiptNumber,
    pdfUrl: uploaded.publicUrl,
    pdfSize: uploaded.size,
    messageId,
  };
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
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
