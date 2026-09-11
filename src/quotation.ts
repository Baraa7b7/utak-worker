// UTAK Quotation — عرض سعر
// Uses the shared renderPDFShell for pixel-parity with the invoice.

import type { Env } from "./config";
import { getOrderForInvoicing, getLatestSalePrice, call } from "./odoo";
import { sendText } from "./meta";
import { sendTemplateByPurpose, T } from "./templates";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  htmlToPDF,
  renderPDFShell,
  signDocToken,
  uploadPDFToR2,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";

export interface QuotationLineItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
}

export interface QuotationPDFData {
  quotationNumber: string;
  quotationDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: QuotationLineItem[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  grandTotal: number;
}

const QUOTATION_FOOTER =
  "هذا العرض ساري لمدة ٧ أيام من تاريخ الإصدار.";

// ---- Body: line-items table (same 5 columns as invoice) ----
export function renderQuotationBodyHTML(
  items: QuotationLineItem[],
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
          <th style="width: 10%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الكمية</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">السعر</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: subtotal + discount + VAT 15% + grand total ----
export function renderQuotationTotalsHTML(
  subtotal: number,
  discount: number,
  vatAmount: number,
  grandTotal: number,
): string {
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>المجموع الفرعي</span><span style="direction: ltr;">${formatMoney(subtotal)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>الخصم</span><span style="direction: ltr;">${formatMoney(discount)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>ضريبة القيمة المضافة (١٥٪)</span><span style="direction: ltr;">${formatMoney(vatAmount)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">الإجمالي</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal)}</span></div>
      </div>
    </div>`;
}

export function renderQuotationHTML(data: QuotationPDFData): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  return renderPDFShell({
    documentTitle: "عرض سعر",
    documentNumber: data.quotationNumber,
    documentDate: data.quotationDate,
    billTo,
    bodyHTML: renderQuotationBodyHTML(data.items, pageMetrics),
    totalsHTML: renderQuotationTotalsHTML(
      data.subtotal,
      data.discount,
      data.vatAmount,
      data.grandTotal,
    ),
    footerNote: QUOTATION_FOOTER,
    showZatcaQR: false,
    pageMetrics,
  });
}

export async function generateQuotationPDF(
  data: QuotationPDFData,
  env: Env,
): Promise<Uint8Array> {
  return await htmlToPDF(renderQuotationHTML(data), env);
}

export async function uploadQuotationToR2(
  env: Env,
  pdfBytes: Uint8Array,
  quotationNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  const result = await uploadPDFToR2(env, {
    pdfBytes,
    folder: "quotations",
    urlPrefix: "quotation-pdf",
    docNumber: quotationNumber,
    workerOrigin,
  });
  // URL-encode the {num} segment. The R2 key stays raw; the GET
  // /quotation-pdf/:num/:tok.pdf handler decodeURIComponent()s before
  // R2 lookup and HMAC verification. uploadPDFToR2 already required
  // ADMIN_TOKEN, so the non-null assertion is safe here.
  const token = await signDocToken(env.ADMIN_TOKEN!, quotationNumber);
  const publicUrl = `${workerOrigin}/quotation-pdf/${encodeURIComponent(quotationNumber)}/${token}.pdf`;
  return { ...result, publicUrl };
}

// ---- Build from a real Odoo x_quotation record ----
export async function buildQuotationPDFDataFromOdoo(
  env: Env,
  quotationId: number,
): Promise<QuotationPDFData | null> {
  type QuoRow = {
    id: number;
    x_quotation_number: string | false;
    x_order_id: [number, string] | false;
    x_sent_at: string | false;
    create_date: string | false;
  };
  let rows: QuoRow[];
  try {
    rows = await call<QuoRow[]>(env, "x_quotation", "read", {
      ids: [quotationId],
      fields: ["id", "x_quotation_number", "x_order_id", "x_sent_at", "create_date"],
    });
  } catch (e) {
    console.error(
      "[q-issue] step 1 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }
  const q = rows[0];
  if (!q) return null;
  if (!q.x_order_id) {
    throw new Error(`Quotation ${quotationId} has no linked order`);
  }

  const order = await getOrderForInvoicing(env, q.x_order_id[0]);
  if (!order) {
    throw new Error(`Order ${q.x_order_id[0]} for quotation ${quotationId} not found`);
  }

  let subtotal = 0;
  const items: QuotationLineItem[] = [];
  for (const l of order.lines) {
    let unit = l.unit_price ?? 0;
    if (!unit || unit <= 0) {
      unit = await getLatestSalePrice(env, l.product_id, l.packaging_id);
    }
    const total = round2(unit * l.quantity);
    subtotal = round2(subtotal + total);
    items.push({
      name: l.product_name || "صنف",
      pack: l.packaging_name || "-",
      qty: l.quantity,
      price: unit,
      total,
    });
  }

  if (typeof q.x_quotation_number !== "string" || !q.x_quotation_number) {
    throw new Error(`Missing x_quotation_number on record ${quotationId}`);
  }
  const number = q.x_quotation_number;

  const rawDate = (q.x_sent_at || q.create_date) as string | false;
  const quotationDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();

  return {
    quotationNumber: number,
    quotationDate,
    customer: {
      name: order.customer_name || "عميل",
      address: order.neighborhood || "الرياض",
      phone: order.customer_whatsapp || "",
    },
    items,
    subtotal,
    discount: 0,
    vatAmount: 0,
    grandTotal: subtotal,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Verify a `/quotation-pdf/{num}/{tok}.pdf` signed token ----
export async function verifyQuotationToken(
  secret: string,
  quotationNumber: string,
  token: string,
): Promise<boolean> {
  const expected = await signDocToken(secret, quotationNumber);
  return expected === token;
}

// ---- Orchestrate: build → PDF → R2 → WhatsApp → mark sent ----
export interface QuotationDispatchResult {
  quotationId: number;
  number: string;
  pdfUrl: string;
  pdfSize: number;
  messageId: string | null;
}

export async function createAndDispatchQuotationForRecord(
  env: Env,
  quotationId: number,
): Promise<QuotationDispatchResult | null> {
  let data: QuotationPDFData | null;
  try {
    data = await buildQuotationPDFDataFromOdoo(env, quotationId);
  } catch (e) {
    console.error(
      "[q-issue] step 2 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }
  if (!data) {
    console.warn(`[quotation] record ${quotationId} not found`);
    return null;
  }

  let html: string;
  try {
    html = renderQuotationHTML(data);
  } catch (e) {
    console.error(
      "[q-issue] step 3 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await htmlToPDF(html, env);
  } catch (e) {
    console.error(
      "[q-issue] step 4 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  let uploaded: { key: string; publicUrl: string; size: number };
  try {
    uploaded = await uploadQuotationToR2(
      env,
      pdfBytes,
      data.quotationNumber,
      env.WORKER_ORIGIN,
    );
  } catch (e) {
    console.error(
      "[q-issue] step 5 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  const customerPhone = data.customer.phone;
  const quotationDate = data.quotationDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  let messageId: string | null = null;
  if (!customerPhone) {
    console.warn(`[quotation] ${quotationId} has no customer WhatsApp — skipping send`);
  } else {
    try {
      let resp: Response | null = null;
      try {
        resp = await sendTemplateByPurpose(
          env,
          customerPhone,
          T.CUSTOMER_QUOTATION_PDF,
          [
            data.customer.name || "",
            data.quotationNumber,
            quotationDate,
            String(data.grandTotal),
          ],
          [],
          { type: "document", link: uploaded.publicUrl, filename: `${data.quotationNumber}.pdf` },
        );
      } catch (e) {
        console.warn(`[quotation] template send threw`, (e as Error).message);
      }

      if (!resp || !resp.ok) {
        // Fallback: plain text with PDF link (works even before Meta approves utak_v2_quotation_pdf)
        const body = [
          `📄 عرض السعر رقم ${data.quotationNumber}`,
          ``,
          `العميل: ${data.customer.name}`,
          `الإجمالي: ${data.grandTotal} ر.س`,
          ``,
          `الملف: ${uploaded.publicUrl}`,
          ``,
          `العرض ساري ٧ أيام. شكراً لتعاملكم مع UTAK 🌿`,
        ].join("\n");
        resp = await sendText(env, customerPhone, body);
      }

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
        "[q-issue] step 7 FAILED:",
        (e as Error).message,
        (e as Error).stack,
      );
      throw e;
    }
  }

  try {
    await call<boolean>(env, "x_quotation", "write", {
      ids: [quotationId],
      vals: { x_sent_at: nowOdoo() },
    });
  } catch (e) {
    console.error(
      "[q-issue] step 8 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    // Kept best-effort — a write-back failure must not undo a WhatsApp send
    // that already reached the customer. Prior behavior was warn-and-continue.
    console.warn(`[quotation] failed to update x_sent_at`, (e as Error).message);
  }

  return {
    quotationId,
    number: data.quotationNumber,
    pdfUrl: uploaded.publicUrl,
    pdfSize: uploaded.size,
    messageId,
  };
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---- Test data — 6 items, ~1500 SAR total ----
export const TEST_QUOTATION_DATA: QuotationPDFData = {
  quotationNumber: "QUO-2026-0032",
  quotationDate: new Date("2026-09-08T09:00:00Z"),
  customer: {
    name: "مطعم النخيل",
    contactPerson: "أ. محمد الشمري",
    address: "العليا، الرياض",
    phone: "+966 55 214 8830",
  },
  items: [
    { name: "طماطم شيري كرزية درجة أولى", pack: "كرتون ٨ كجم", qty: 5, price: 45, total: 225 },
    { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8, price: 28, total: 224 },
    { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4, price: 55, total: 220 },
    { name: "بطاطس", pack: "كيس ٢٥ كجم", qty: 4, price: 68, total: 272 },
    { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 4, price: 72, total: 288 },
    { name: "بقدونس طازج", pack: "ربطة × ٢٠", qty: 12, price: 24, total: 288 },
  ],
  subtotal: 1517,
  discount: 0,
  vatAmount: 0,
  grandTotal: 1517,
};
