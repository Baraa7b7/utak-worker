// v5 — Invoice generation + collection flow.
// 2026-09-05: ADDED Gotenberg PDF + R2 archive + signed URLs.

import type { Env } from "./config";
import {
  getOrderForInvoicing,
  getLatestSalePrice,
  createInvoiceRecord,
  writeInvoice,
  getInvoiceById,
  getInvoiceCountToday,
  createPaymentRecord,
  updateOrderState,
  getCollectorTeamMembers,
  getUnpaidInvoicesWithCustomer,
  writeOrderLineUnitPrice,
  getOrderCustomerWhatsapp,
} from "./odoo";
import { sendText, sendButtons } from "./meta";
import { sendTemplateByPurpose, T } from "./templates";

// --------------------------------------------------------------
// 5.2 — createAndDispatchInvoiceForOrder (unchanged)
// --------------------------------------------------------------
export async function createAndDispatchInvoiceForOrder(
  env: Env,
  orderId: number,
): Promise<{ invoiceId: number; number: string; total: number } | null> {
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) {
    console.warn(`[invoice] order ${orderId} not found or empty`);
    return null;
  }

  let subtotal = 0;
  const pricedLines: Array<{
    lineId: number;
    product: string;
    packaging: string;
    qty: number;
    unit: number;
    line_total: number;
  }> = [];

  for (const l of order.lines) {
    let unit = l.unit_price ?? 0;
    if (!unit || unit <= 0) {
      unit = await getLatestSalePrice(env, l.product_id, l.packaging_id);
    }
    const line_total = round2(unit * l.quantity);
    subtotal = round2(subtotal + line_total);
    pricedLines.push({
      lineId: l.id,
      product: l.product_name,
      packaging: l.packaging_name,
      qty: l.quantity,
      unit,
      line_total,
    });
  }

  const tax = 0;
  const total = round2(subtotal + tax);

  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await getInvoiceCountToday(env);
  const seq = String(count + 1).padStart(3, "0");
  const invoiceNumber = `UTAK-INV-${ymd}-${seq}`;

  const invoiceId = await createInvoiceRecord(env, {
    orderId,
    invoiceNumber,
    subtotal,
    tax,
    total,
  });

  try {
    await writeOrderLineUnitPrice(env, pricedLines.map(p => ({
      lineId: p.lineId,
      unit: p.unit,
      subtotal: p.line_total,
    })));
  } catch (e) {
    console.warn(`[invoice] failed to write line prices back`, (e as Error).message);
  }

  const linesFormatted = pricedLines
    .map(p => `• ${p.product} × ${p.qty} = ${p.line_total} ر.س`)
    .join("\n");

  // Generate PDF via Gotenberg → upload to R2 → send template with document header
  let pdfUrl: string | null = null;
  try {
    const pdfData = await buildInvoicePDFDataFromOdoo(env, invoiceId);
    if (pdfData) {
      const pdfBytes = await generateInvoicePDF(pdfData, env);
      const uploaded = await uploadInvoiceToR2(env, pdfBytes, invoiceNumber, env.WORKER_ORIGIN);
      pdfUrl = uploaded.publicUrl;
      console.log(`[invoice] PDF generated & uploaded: ${uploaded.size} bytes → ${uploaded.publicUrl}`);
    }
  } catch (e) {
    console.warn(`[invoice] PDF pipeline failed`, (e as Error).message);
  }

  const invoiceDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  try {
    let resp: Response | null = null;
    if (pdfUrl) {
      // New path: send utak_invoice_pdf_v1 with document header
      resp = await sendTemplateByPurpose(
        env,
        order.customer_whatsapp,
        T.CUSTOMER_INVOICE_PDF,
        [order.customer_name || "", invoiceNumber, invoiceDate, String(total)],
        [],
        { type: "document", link: pdfUrl, filename: `${invoiceNumber}.pdf` },
      );
    }
    if (!resp || !resp.ok) {
      // Fallback: old text template
      resp = await sendTemplateByPurpose(env, order.customer_whatsapp, T.CUSTOMER_INVOICE,
        [order.customer_name || "", invoiceNumber, linesFormatted, String(total)]);
    }
    if (!resp || !resp.ok) {
      const customerText = buildCustomerInvoiceText(invoiceNumber, pricedLines, subtotal, total);
      await sendText(env, order.customer_whatsapp, customerText);
    }
    await writeInvoice(env, invoiceId, { x_sent_to_customer_at: nowOdoo() });
  } catch (e) {
    console.warn(`[invoice] failed to send to customer`, (e as Error).message);
  }

  const collectors = await getCollectorTeamMembers(env);
  if (collectors.length === 0) {
    console.warn(`[invoice] no collectors configured — skipping collector dispatch`);
    await writeInvoice(env, invoiceId, { x_sent_to_collector_at: nowOdoo() });
    return { invoiceId, number: invoiceNumber, total };
  }

  const collector = collectors[0];
  const body = buildCollectorRequestText({
    invoiceNumber,
    customerName: order.customer_name,
    neighborhood: order.neighborhood,
    total,
  });
  try {
    const resp = await sendTemplateByPurpose(env, collector.whatsapp, T.COLLECTION_REQUEST,
      [
        order.customer_name || "",
        order.neighborhood || "-",
        invoiceNumber,
        String(total),
      ],
      [
        { index: 0, payload: `collect_cash_${invoiceId}` },
        { index: 1, payload: `collect_transfer_${invoiceId}` },
      ]);
    if (!resp || !resp.ok) {
      await sendButtons(env, collector.whatsapp, body, [
        { id: `collect_cash_${invoiceId}`, title: "نقد 💵" },
        { id: `collect_transfer_${invoiceId}`, title: "تحويل 🏦" },
      ]);
    }
    await writeInvoice(env, invoiceId, { x_sent_to_collector_at: nowOdoo() });
  } catch (e) {
    console.warn(`[invoice] failed to send to collector`, (e as Error).message);
  }

  return { invoiceId, number: invoiceNumber, total };
}

// --------------------------------------------------------------
// 5.3 — Collection button handler (unchanged)
// --------------------------------------------------------------
export interface CollectionResult {
  text: string;
}

export async function handleCollectionButton(
  env: Env,
  buttonId: string,
  collectorPartnerId: number | null,
): Promise<CollectionResult | null> {
  const m = /^(collect_cash|collect_transfer)_(\d+)$/.exec(buttonId);
  if (!m) return null;

  const method: "cash" | "transfer" = m[1] === "collect_cash" ? "cash" : "transfer";
  const invoiceId = Number(m[2]);

  const invoice = await getInvoiceById(env, invoiceId);
  if (!invoice) {
    return { text: `الفاتورة رقم ${invoiceId} غير موجودة.` };
  }
  if (invoice.status === "paid") {
    return { text: `الفاتورة ${invoice.number} تم تحصيلها مسبقاً ✅` };
  }

  const paymentId = await createPaymentRecord(env, {
    invoiceId,
    amount: invoice.total,
    method,
    collectedBy: collectorPartnerId ?? undefined,
  });
  await writeInvoice(env, invoiceId, {
    x_payment_id: paymentId,
    x_status: "paid",
  });
  if (invoice.orderId) {
    await updateOrderState(env, invoice.orderId, "closed");
  }

  const customerWa = invoice.orderId
    ? await getOrderCustomerWhatsapp(env, invoice.orderId)
    : null;
  if (customerWa) {
    try {
      await sendText(env, customerWa, `تم استلام الدفعة ${invoice.total} ر.س، شكراً لك 🙏`);
    } catch (e) {
      console.warn(`[collection] failed to notify customer`, (e as Error).message);
    }
  }

  return {
    text: `تم تسجيل التحصيل ${method === "cash" ? "نقد 💵" : "تحويل 🏦"} — الفاتورة ${invoice.number} ✅`,
  };
}

// --------------------------------------------------------------
// 5.4 — Daily collection summary cron (unchanged)
// --------------------------------------------------------------
export async function sendDailyCollectionSummary(env: Env): Promise<void> {
  const unpaid = await getUnpaidInvoicesWithCustomer(env);
  const collectors = await getCollectorTeamMembers(env);

  if (collectors.length === 0) {
    console.warn(`[collection-cron] no collectors — skip`);
    return;
  }

  if (unpaid.length === 0) {
    for (const c of collectors) {
      try {
        await sendText(env, c.whatsapp, "لا توجد فواتير معلّقة للتحصيل اليوم ✅");
      } catch (e) {
        console.warn(`[collection-cron] send to ${c.whatsapp} failed`, (e as Error).message);
      }
    }
    return;
  }

  const grandTotal = round2(unpaid.reduce((sum, r) => sum + r.total, 0));

  const lines = unpaid
    .map((r, i) => {
      const neigh = r.neighborhood ? ` (${r.neighborhood})` : "";
      return `${i + 1}. ${r.customer_name}${neigh} — ${r.total} ر.س — ${r.number}`;
    })
    .join("\n");

  const body = [
    `📋 قائمة التحصيل اليومية`, ``, lines, ``,
    `الإجمالي المطلوب: ${grandTotal} ر.س`,
    `عدد الفواتير: ${unpaid.length}`, ``,
    `لما تحصّل من أي عميل، افتح رسالة الفاتورة الأصلية واضغط زر التحصيل.`,
  ].join("\n");

  const today = new Date().toISOString().slice(0, 10);
  for (const c of collectors) {
    try {
      const resp = await sendTemplateByPurpose(env, c.whatsapp, T.COLLECTION_SUMMARY,
        [today, lines, String(grandTotal), String(unpaid.length)]);
      if (!resp || !resp.ok) {
        await sendText(env, c.whatsapp, body);
      }
    } catch (e) {
      console.warn(`[collection-cron] send to ${c.whatsapp} failed`, (e as Error).message);
    }
  }
}

// --------------------------------------------------------------
// Formatters + helpers (unchanged)
// --------------------------------------------------------------
function buildCustomerInvoiceText(
  number: string,
  lines: Array<{ product: string; packaging: string; qty: number; unit: number; line_total: number }>,
  subtotal: number,
  total: number,
): string {
  const linesText = lines
    .map((l) => `• ${l.product} ${l.packaging} × ${l.qty} = ${l.line_total} ر.س`)
    .join("\n");
  return [
    `🧾 فاتورتك رقم ${number}`, ``, linesText, ``,
    `المجموع: ${subtotal} ر.س`, `الإجمالي: ${total} ر.س`, ``,
    `شكراً لتعاملكم مع UTAK 🌿`,
  ].join("\n");
}

function buildCollectorRequestText(args: {
  invoiceNumber: string;
  customerName: string;
  neighborhood: string;
  total: number;
}): string {
  const neigh = args.neighborhood ? ` (${args.neighborhood})` : "";
  return [
    `💰 طلب تحصيل`, ``,
    `العميل: ${args.customerName}${neigh}`,
    `الفاتورة: ${args.invoiceNumber}`,
    `المبلغ: ${args.total} ر.س`, ``,
    `اختر طريقة التحصيل:`,
  ].join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ============================================================================
// ============================================================================
// PDF GENERATION via Gotenberg + R2 archive — added 2026-09-05
// ============================================================================
// ============================================================================

export interface InvoiceLineItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
}

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: string;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  grandTotal: number;
  paymentTerms?: string;
}

function formatMoney(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ريال';
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateEn(d: Date): string {
  return d.toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const UTAK_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:60px;height:60px;display:block;"><rect width="100" height="100" fill="#F7F5F0"/><g transform="translate(19,19) scale(0.62)"><path d="M25 16 v40 a25 25 0 0 0 50 0 V38.5" fill="none" stroke="#1E5A41" stroke-width="15" stroke-linecap="round"/><rect x="66.25" y="6" width="17.5" height="17.5" fill="#E07B39"/></g></svg>`;

export function renderInvoiceHTML(data: InvoicePDFData): string {
  const dense = data.items.length > 12;
  const gap = dense ? '16px' : '24px';
  const preTable = dense ? '20px' : '40px';
  const postTable = dense ? '24px' : '40px';
  const tailMin = dense ? '0px' : '40px';
  const thPad = dense ? '6px 0' : '10px 0';
  const rowHeight = dense
    ? Math.max(15, Math.floor(385 / data.items.length)) + 'px'
    : '36px';

  const rowsHtml = data.items.map((item) => `
    <tr style="border-bottom: 0.25px solid #E8E4DE;">
      <td style="height: ${rowHeight}; text-align: right; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.name)}</td>
      <td style="height: ${rowHeight}; text-align: right; font-size: 12px; font-weight: 400; color: #6B6863; padding: 0 12px 0 0;">${escapeHtml(item.pack)}</td>
      <td style="height: ${rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr; color: #6B6863;">${formatMoney(item.price)}</td>
      <td style="height: ${rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total)}</td>
    </tr>
  `).join('');

  const paymentTerms = data.paymentTerms || 'الدفع خلال ٣٠ يوماً من تاريخ الفاتورة. تحويل بنكي أو نقداً عند التسليم.';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: #F7F5F0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { background: #F7F5F0; }
    .utak-page { box-shadow: none !important; margin: 0 !important; }
  }
</style>
</head>
<body>
<div dir="rtl" style="font-family: 'IBM Plex Sans Arabic', 'Tajawal', sans-serif; font-feature-settings: 'tnum' 1; background: #F7F5F0;">
  <div class="utak-page" style="position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 20mm; background: #F7F5F0; color: #1A1815; display: flex; flex-direction: column; overflow: hidden;">
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 160px; font-weight: 200; letter-spacing: 0.06em; color: #1E5A41; opacity: 0.04; pointer-events: none; user-select: none; white-space: nowrap;">UTAK</div>
    <div style="position: relative; display: flex; align-items: flex-start; justify-content: space-between;">
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${UTAK_LOGO_SVG}
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 24px; font-weight: 500; color: #1E5A41; letter-spacing: 0.02em; white-space: nowrap;">UTAK — يو تاك</div>
          <div style="font-size: 10px; font-weight: 400; color: #6B6863; letter-spacing: 0.14em;">توزيع منتجات زراعية طازجة</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 10px; direction: ltr; text-align: left;">
        <div style="font-size: 32px; font-weight: 300; line-height: 1; direction: rtl;">فاتورة</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            <span style="width: 4px; height: 4px; border-radius: 50%; background: #E07B39; display: inline-block;"></span>
            <span style="font-size: 13px; font-weight: 400;">${escapeHtml(data.invoiceNumber)}</span>
          </div>
          <div style="font-size: 13px; font-weight: 400; color: #6B6863;">${escapeHtml(data.invoiceDate)}</div>
        </div>
      </div>
    </div>
    <div style="height: ${gap};"></div>
    <div style="height: 0; border-top: 0.5px solid #1E5A41;"></div>
    <div style="height: ${gap};"></div>
    <div style="position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div style="font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.2em;">فاتورة إلى / BILL TO</div>
        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 400;">
          <div>${escapeHtml(data.customer.name)}</div>
          ${data.customer.contactPerson ? `<div style="color: #6B6863;">${escapeHtml(data.customer.contactPerson)}</div>` : ''}
          <div style="color: #6B6863;">${escapeHtml(data.customer.address)}</div>
          <div style="color: #6B6863; direction: ltr; text-align: right;">${escapeHtml(data.customer.phone)}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; text-align: left;">
        <div style="font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.2em;">من / FROM</div>
        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 400;">
          <div>UTAK — يو تاك</div>
          <div style="color: #6B6863;">الرياض، المملكة العربية السعودية</div>
          <div style="color: #6B6863; direction: ltr;">care@utak.com</div>
          <div style="color: #6B6863; direction: ltr;">+966 58 004 0467</div>
        </div>
      </div>
    </div>
    <div style="height: ${preTable};"></div>
    <table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid #1A1815; border-bottom: 0.5px solid #1A1815;">
          <th style="width: 40%; text-align: right; font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.16em; padding: ${thPad};">الصنف</th>
          <th style="width: 20%; text-align: right; font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.16em; padding: ${thPad};">العبوة</th>
          <th style="width: 10%; text-align: left; font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.16em; padding: ${thPad};">الكمية</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.16em; padding: ${thPad};">السعر</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.16em; padding: ${thPad};">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="height: ${postTable};"></div>
    <div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: #6B6863;"><span>المجموع الفرعي</span><span style="direction: ltr;">${formatMoney(data.subtotal)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: #6B6863;"><span>الخصم</span><span style="direction: ltr;">${formatMoney(data.discount)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: #6B6863;"><span>ضريبة القيمة المضافة (١٥٪)</span><span style="direction: ltr;">${formatMoney(data.vatAmount)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid #1A1815;"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: #1A1815;">الإجمالي</span><span style="font-size: 20px; font-weight: 500; color: #1E5A41; direction: ltr;">${formatMoney(data.grandTotal)}</span></div>
      </div>
    </div>
    <div style="flex: 1; min-height: ${tailMin};"></div>
    <div style="position: relative;">
      <div style="height: 0; border-top: 0.25px solid #E8E4DE;"></div>
      <div style="height: 20px;"></div>
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: flex-start;">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 500; color: #6B6863; letter-spacing: 0.2em;">شروط الدفع</div>
          <div style="font-size: 10px; font-weight: 400; color: #6B6863; line-height: 1.7; max-width: 62%;">${escapeHtml(paymentTerms)}</div>
        </div>
        <div style="width: 80px; height: 80px; border: 0.5px dashed #C9C4BC; display: flex; align-items: center; justify-content: center; text-align: center;">
          <span style="font-size: 7px; font-weight: 400; color: #C9C4BC; letter-spacing: 0.1em; line-height: 1.6;">ZATCA<br>QR</span>
        </div>
      </div>
      <div style="height: 18px;"></div>
      <div style="text-align: center; font-size: 10px; font-weight: 400; color: #6B6863; letter-spacing: 0.08em;">شكراً لثقتكم في UTAK — يو تاك</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

export async function generateInvoicePDF(
  data: InvoicePDFData,
  env: Env,
): Promise<Uint8Array> {
  const html = renderInvoiceHTML(data);

  const gotenbergUrl = env.GOTENBERG_URL;
  const gotenbergUser = env.GOTENBERG_USER;
  const gotenbergPass = env.GOTENBERG_PASSWORD;

  if (!gotenbergUrl || !gotenbergUser || !gotenbergPass) {
    throw new Error('Gotenberg env vars missing: GOTENBERG_URL/USER/PASSWORD');
  }

  const formData = new FormData();
  formData.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  formData.append('paperWidth', '8.27');
  formData.append('paperHeight', '11.69');
  formData.append('marginTop', '0');
  formData.append('marginBottom', '0');
  formData.append('marginLeft', '0');
  formData.append('marginRight', '0');
  formData.append('printBackground', 'true');
  formData.append('waitDelay', '2s');

  const auth = 'Basic ' + btoa(`${gotenbergUser}:${gotenbergPass}`);

  const response = await fetch(
    `${gotenbergUrl}/forms/chromium/convert/html`,
    { method: 'POST', headers: { Authorization: auth }, body: formData },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gotenberg ${response.status}: ${errText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

// --------------------------------------------------------------
// R2 signed URLs (HMAC-SHA256 via ADMIN_TOKEN)
// --------------------------------------------------------------

export async function signInvoiceToken(
  secret: string,
  invoiceNumber: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(invoiceNumber));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16); // 16 hex = 64-bit entropy
}

export async function verifyInvoiceToken(
  secret: string,
  invoiceNumber: string,
  token: string,
): Promise<boolean> {
  const expected = await signInvoiceToken(secret, invoiceNumber);
  return expected === token;
}

/**
 * Uploads a PDF invoice to R2 and returns a signed public URL.
 * URL shape: /invoice-pdf/{invoiceNumber}/{token}.pdf
 */
export async function uploadInvoiceToR2(
  env: Env,
  pdfBytes: Uint8Array,
  invoiceNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  if (!env.ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN missing — required to sign invoice URLs');
  }

  const key = `invoices/${invoiceNumber}.pdf`;

  await env.INVOICES_BUCKET.put(key, pdfBytes, {
    httpMetadata: {
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="${invoiceNumber}.pdf"`,
    },
    customMetadata: {
      invoiceNumber,
      uploadedAt: new Date().toISOString(),
    },
  });

  const token = await signInvoiceToken(env.ADMIN_TOKEN, invoiceNumber);
  const publicUrl = `${workerOrigin}/invoice-pdf/${invoiceNumber}/${token}.pdf`;

  return { key, publicUrl, size: pdfBytes.byteLength };
}

// --------------------------------------------------------------
// 2d — Build InvoicePDFData from a real Odoo x_invoice record
// --------------------------------------------------------------

export async function buildInvoicePDFDataFromOdoo(
  env: Env,
  invoiceId: number,
): Promise<InvoicePDFData | null> {
  const invoice = await getInvoiceById(env, invoiceId);
  if (!invoice) return null;

  if (!invoice.orderId) {
    throw new Error(`Invoice ${invoiceId} (${invoice.number}) has no linked order`);
  }

  const order = await getOrderForInvoicing(env, invoice.orderId);
  if (!order) {
    throw new Error(`Order ${invoice.orderId} for invoice ${invoice.number} not found`);
  }

  let subtotal = 0;
  const items: InvoiceLineItem[] = [];

  for (const l of order.lines) {
    let unit = l.unit_price ?? 0;
    if (!unit || unit <= 0) {
      unit = await getLatestSalePrice(env, l.product_id, l.packaging_id);
    }
    const total = round2(unit * l.quantity);
    subtotal = round2(subtotal + total);
    items.push({
      name: l.product_name || 'صنف',
      pack: l.packaging_name || '-',
      qty: l.quantity,
      price: unit,
      total,
    });
  }

  return {
    invoiceNumber: invoice.number,
    invoiceDate: formatDateEn(new Date()),
    customer: {
      name: order.customer_name || 'عميل',
      address: order.neighborhood || 'الرياض',
      phone: order.customer_whatsapp || '',
    },
    items,
    subtotal,
    discount: 0,
    vatAmount: 0,
    grandTotal: invoice.total,
  };
}

// --------------------------------------------------------------
// Test data
// --------------------------------------------------------------

export const TEST_INVOICE_DATA: InvoicePDFData = {
  invoiceNumber: 'INV-2026-0147',
  invoiceDate: '05 Sep 2026',
  customer: {
    name: 'مطعم النخيل',
    contactPerson: 'أ. محمد الشمري',
    address: 'العليا، الرياض',
    phone: '+966 55 214 8830',
  },
  items: [
    { name: 'طماطم شيري كرزية درجة أولى', pack: 'كرتون ٨ كجم', qty: 6, price: 45, total: 270 },
    { name: 'خيار بلدي', pack: 'كرتون ٥ كجم', qty: 8, price: 28, total: 224 },
    { name: 'خس آيسبرغ', pack: 'كرتون ١٢ حبة', qty: 4, price: 55, total: 220 },
    { name: 'بطاطس', pack: 'كيس ٢٥ كجم', qty: 6, price: 68, total: 408 },
    { name: 'ليمون بلدي', pack: 'كرتون ١٠ كجم', qty: 5, price: 72, total: 360 },
    { name: 'بقدونس طازج', pack: 'ربطة × ٢٠', qty: 6, price: 24, total: 144 },
    { name: 'جزر', pack: 'كيس ١٠ كجم', qty: 10, price: 32, total: 320 },
    { name: 'فلفل رومي ملون', pack: 'كرتون ٥ كجم', qty: 8, price: 58, total: 464 },
  ],
  subtotal: 2410,
  discount: 0,
  vatAmount: 0,
  grandTotal: 2410,
};
