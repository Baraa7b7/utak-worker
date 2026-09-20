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
  resolvePackagingNames,
  call,
} from "./odoo";
import { sendText, sendButtons } from "./meta";
import { sendTemplateByPurpose, T } from "./templates";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  renderPDFShell,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";

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
      // sim-harness (2026-09-13): getLatestSalePrice now returns a tagged
      // object. Invoice path only needs the numeric price — pipeline
      // semantics preserved.
      unit = (await getLatestSalePrice(env, l.product_id, l.packaging_id)).price;
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
  invoiceDate: Date;
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

// Middle slot for an invoice: the line-items table.
function renderInvoiceBodyHTML(
  items: InvoiceLineItem[],
  m: PageMetrics,
): string {
  const rowsHtml = items
    .map(
      (item) => `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${m.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(item.name)}</td>
      <td style="height: ${m.rowHeight}; text-align: right; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${escapeHTML(item.pack)}</td>
      <td style="height: ${m.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${m.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price)}</td>
      <td style="height: ${m.rowHeight}; text-align: left; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total)}</td>
    </tr>
  `,
    )
    .join("");

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          <th style="width: 40%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${m.thPad};">الصنف</th>
          <th style="width: 20%; text-align: right; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${m.thPad};">العبوة</th>
          <th style="width: 10%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${m.thPad};">الكمية</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${m.thPad};">السعر</th>
          <th style="width: 15%; text-align: left; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${m.thPad};">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// Bottom-right totals block for an invoice.
function renderInvoiceTotalsHTML(
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

export function renderInvoiceHTML(data: InvoicePDFData): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };

  return renderPDFShell({
    documentTitle: "فاتورة",
    documentNumber: data.invoiceNumber,
    documentDate: data.invoiceDate,
    billTo,
    bodyHTML: renderInvoiceBodyHTML(data.items, pageMetrics),
    totalsHTML: renderInvoiceTotalsHTML(
      data.subtotal,
      data.discount,
      data.vatAmount,
      data.grandTotal,
    ),
    footerNote: data.paymentTerms,
    // ZATCA QR is only meaningful when there's VAT to attest to. Suppress it
    // while VAT is inactive (Baraa activates it later).
    showZatcaQR: data.vatAmount > 0,
    pageMetrics,
  });
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

  const packagingNames = await resolvePackagingNames(
    env,
    order.lines.map((l) => ({ packaging_id: l.packaging_id, product_id: l.product_id })),
  );

  let subtotal = 0;
  const items: InvoiceLineItem[] = [];

  let lineIdx = -1;
  for (const l of order.lines) {
    lineIdx++;
    let unit = l.unit_price ?? 0;
    if (!unit || unit <= 0) {
      // sim-harness (2026-09-13): unpack .price from tagged lookup result.
      unit = (await getLatestSalePrice(env, l.product_id, l.packaging_id)).price;
    }
    const total = round2(unit * l.quantity);
    subtotal = round2(subtotal + total);
    items.push({
      name: l.product_name || 'صنف',
      pack: packagingNames[lineIdx],
      qty: l.quantity,
      price: unit,
      total,
    });
  }

  return {
    invoiceNumber: invoice.number,
    invoiceDate: new Date(),
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
// Build from a standard Odoo customer invoice (account.move, out_invoice).
// Parallel reader alongside buildInvoicePDFDataFromOdoo (x_invoice).
// VAT stays 0 until Baraa activates it — showZatcaQR should be false
// while amount_tax === 0 (caller decides).
// --------------------------------------------------------------
export async function buildInvoicePDFDataFromAccountMove(
  env: Env,
  moveId: number,
): Promise<InvoicePDFData | null> {
  type MoveHead = {
    id: number;
    name: string | false;
    invoice_date: string | false;
    date: string | false;
    partner_id: [number, string] | false;
    invoice_line_ids: number[];
    amount_untaxed: number;
    amount_tax: number;
    amount_total: number;
    move_type: string;
  };
  const heads = await call<MoveHead[]>(env, "account.move", "read", {
    ids: [moveId],
    fields: ["id","name","invoice_date","date","partner_id","invoice_line_ids","amount_untaxed","amount_tax","amount_total","move_type"],
  });
  const head = heads[0];
  if (!head) return null;
  if (head.move_type !== "out_invoice" && head.move_type !== "out_refund") return null;

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
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    display_type: string | false;
    sale_line_ids: number[];
  };
  type ProdProd = { id: number; product_tmpl_id: [number, string] | false };
  const lines = head.invoice_line_ids.length > 0
    ? await call<Line[]>(env, "account.move.line", "read", {
        ids: head.invoice_line_ids,
        fields: ["id","name","product_id","quantity","price_unit","price_subtotal","display_type","sale_line_ids"],
      })
    : [];
  const productLines = lines.filter((l) => l.product_id && !l.display_type);
  const prodIds = Array.from(new Set(productLines.map((l) => l.product_id ? l.product_id[0] : 0).filter((n) => n > 0)));
  const prods = prodIds.length > 0
    ? await call<ProdProd[]>(env, "product.product", "read", {
        ids: prodIds,
        fields: ["id","product_tmpl_id"],
      })
    : [];
  const tmplByProd = new Map<number, number>();
  for (const p of prods) if (p.product_tmpl_id) tmplByProd.set(p.id, p.product_tmpl_id[0]);

  // If the invoice was generated from a sale.order, pull packaging from the
  // linked sale.order.line's x_packaging_id — no new field on account.move.line.
  // Fall back to the product's default packaging when nothing is linked.
  type SolPack = { id: number; x_packaging_id: [number, string] | false };
  const solIds = Array.from(
    new Set(
      productLines
        .flatMap((l) => l.sale_line_ids ?? [])
        .filter((id) => typeof id === "number" && id > 0),
    ),
  );
  const solPack = solIds.length > 0
    ? await call<SolPack[]>(env, "sale.order.line", "read", {
        ids: solIds,
        fields: ["id","x_packaging_id"],
      })
    : [];
  const packByLine = new Map<number, number>();
  for (const s of solPack) if (s.x_packaging_id) packByLine.set(s.id, s.x_packaging_id[0]);

  const packagingNames = await resolvePackagingNames(
    env,
    productLines.map((l) => {
      const linkedPack = (l.sale_line_ids ?? []).map((id) => packByLine.get(id) ?? 0).find((n) => n > 0) ?? 0;
      return {
        packaging_id: linkedPack,
        product_id: l.product_id ? (tmplByProd.get(l.product_id[0]) ?? 0) : 0,
      };
    }),
  );

  let subtotal = 0;
  const items: InvoiceLineItem[] = productLines.map((l, i) => {
    const total = round2(l.price_subtotal);
    subtotal = round2(subtotal + total);
    const displayName = (typeof l.name === "string" && l.name)
      ? l.name.split("\n")[0]
      : (l.product_id ? l.product_id[1] : "صنف");
    return {
      name: displayName,
      pack: packagingNames[i],
      qty: l.quantity,
      price: l.price_unit,
      total,
    };
  });

  const rawDate = head.invoice_date || head.date || null;
  const invoiceDate = rawDate ? new Date(String(rawDate)) : new Date();

  return {
    invoiceNumber: (typeof head.name === "string" && head.name) ? head.name : `INV-${moveId}`,
    invoiceDate,
    customer: {
      name: partner?.name || (head.partner_id ? head.partner_id[1] : "عميل"),
      address: partner?.street || partner?.city || "الرياض",
      phone: partner?.phone || "",
    },
    items,
    subtotal,
    discount: 0,
    vatAmount: head.amount_tax || 0,
    grandTotal: head.amount_total || subtotal,
  };
}

// --------------------------------------------------------------
// Test data
// --------------------------------------------------------------

export const TEST_INVOICE_DATA: InvoicePDFData = {
  invoiceNumber: 'INV-2026-0147',
  invoiceDate: new Date('2026-09-05T12:00:00Z'),
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
