// v5 — Invoice generation + collection flow.
// 2026-09-05: ADDED Gotenberg PDF + R2 archive + signed URLs.

import type { Env } from "./config";
import { arabicDate, joinCapped } from "./wa-params";
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
  resolvePackagingNames,
  call,
} from "./odoo";
import {
  isAccountingSyncEnabled,
  syncPaymentToAccounting,
  todayRiyadhYmd,
  resolveSaleTaxForDate,
  computeInclusiveTotals,
  type SaleTax,
} from "./accounting";
import {
  ensureSaleOrderForDailyOrder,
  invoiceSaleOrderOnDelivery,
  saleLineDescription,
} from "./sale-accounting";
import { buttonsContent, sendText, textContent } from "./meta";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { gatewayDecision, sendViaGateway, type GwOption } from "./wa-gateway";
import { sendOwnerAlert, sendTemplateByPurpose, T } from "./templates";
import {
  BRAND_COLORS,
  BRAND_RULES,
  BRAND_TYPE,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  renderPDFShell,
  htmlToPDF,
  buildGotenbergFooterHtml,
  GOTENBERG_FOOTER_MARGIN,
  renderSealSignatureBlock,
  type LegalFooterInfo,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";
import type { CompanyInfo } from "./company";
import { readCompanyInfo } from "./company";
import { toLegalFooterAr } from "./legal-footer";
import { parseOdooUtc, resolveZatcaQr, zatcaQrSvg, type ZatcaQr } from "./zatca-qr";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, itemCellHTML, labelForBillTo, labelForFrom, labelForTerms, taglineFor, thanksLine } from "./doc-shell";

// --------------------------------------------------------------
// 5.2 — createAndDispatchInvoiceForOrder
//
// § 41 ج (2026-09-26, م18) — the customer's invoice is issued AND sent at the
// moment of «تم التسليم» on the stop, whatever was collected (all, part or
// nothing). Its supply and issue time is that moment (x_issued_at; its date
// and its number's day are that moment's Riyadh day). Collections after it
// record payments on it (م10 and the receipt per payment, unchanged); what is
// left stays due and the payment reminder (م2) sees it. One invoice per order:
// the order's x_invoice first, then a KV claim held while it is issued; the
// customer send claims x_invoice_sent_at. An order marked x_utak_simulation
// gets no invoice. The old «send only after full collection» path
// (sendInvoiceToCustomerIfPaid, ACCOUNTING_SYNC) is gone.
// --------------------------------------------------------------
export const INVOICE_CLAIM_TTL = 10 * 60;
export const INVOICE_DONE_TTL = 30 * 24 * 60 * 60;

export async function createAndDispatchInvoiceForOrder(
  env: Env,
  orderId: number,
): Promise<{ invoiceId: number; number: string; total: number } | null> {
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) {
    console.warn(`[invoice] order ${orderId} not found or empty`);
    return null;
  }
  if (await isSimulationOrder(env, orderId)) {
    console.log(`[invoice] order ${orderId} is marked x_utak_simulation — no invoice issued or sent`);
    return null;
  }

  // One invoice per order: a second «تم التسليم» (or a retry) reuses it.
  const existing = await findInvoiceForOrder(env, orderId);
  if (existing) {
    console.log(`[invoice] order ${orderId} already has x_invoice ${existing.invoiceId} (${existing.number}) — no second invoice`);
    return existing;
  }
  const claim = await claimButton(env, `invoice_issue:${orderId}`, INVOICE_CLAIM_TTL);
  if (!claim.claimed) {
    console.warn(`[invoice] order ${orderId}: another issue is running (${claim.state.slice(0, 40)}) — no second invoice`);
    return await findInvoiceForOrder(env, orderId);
  }
  let issued: { invoiceId: number; number: string; total: number } | null = null;
  try {
    issued = await issueAndDispatchInvoice(env, orderId, order);
  } finally {
    if (issued) await finishButton(env, claim, INVOICE_DONE_TTL);
    else await releaseButton(env, claim);
  }
  return issued;
}

async function issueAndDispatchInvoice(
  env: Env,
  orderId: number,
  order: NonNullable<Awaited<ReturnType<typeof getOrderForInvoicing>>>,
): Promise<{ invoiceId: number; number: string; total: number } | null> {
  const accountingOn = isAccountingSyncEnabled(env);
  // Every line short at delivery: no invoice at all (a zero invoice is never
  // sent); the sale order (ACCOUNTING_SYNC) stays open, un-invoiced.
  if (order.lines.length === 0) {
    if (accountingOn) await ensureSaleOrderForDailyOrder(env, orderId);
    const msg = `[invoice] الطلب ${orderId}: كل الأصناف ناقصة — لم تصدر فاتورة${accountingOn ? "، وأمر البيع باقٍ بلا فوترة" : ""}`;
    console.warn(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
    return null;
  }
  // The moment of «تم التسليم»: the supply and issue time of the invoice.
  const issuedAt = new Date();

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

  // 2026-09-23 — VAT by invoice date (Riyadh, src/config.ts
  // VAT_EFFECTIVE_DATE_RIYADH). Prices are tax-INCLUDED: the line totals
  // above are what the customer pays; from the cutoff they are split into
  // net + 15% (per line, then summed). Before it: tax 0, exactly as before.
  // If the cutoff has passed but the Odoo sale tax cannot be resolved we stop
  // here — never issue a post-cutoff invoice silently without VAT.
  const invoiceDateYmd = todayRiyadhYmd(issuedAt);
  let saleTax: SaleTax | null;
  try {
    saleTax = await resolveSaleTaxForDate(env, invoiceDateYmd);
  } catch (e) {
    const msg = `[invoice] الطلب ${orderId}: لم تصدر الفاتورة — تعذّر تحديد ضريبة البيع (${(e as Error).message})`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
    throw e;
  }
  const split = computeInclusiveTotals(pricedLines.map((p) => p.line_total), saleTax?.rate ?? null);
  // § 40 د — the quantity discount, before VAT, from the delivered lines on
  // the order's day (the quotation computed it the same way). Never blocks.
  let discount = 0, discountPct = 0;
  try {
    const { orderDiscount } = await import("./order-pricing");
    const d = await orderDiscount(env, {
      day: order.order_date ?? invoiceDateYmd,
      lines: order.lines.map((l, i) => ({ productId: l.product_id, packagingId: l.packaging_id, qty: l.quantity, unit: pricedLines[i].unit })),
      vatRate: async () => saleTax?.rate ?? null,
    });
    if (d.applied) { discount = d.amount; discountPct = d.pct; }
    else if (d.tierPct > 0) console.log(`[invoice] order ${orderId}: no discount — ${d.reason}`);
  } catch (e) {
    console.warn(`[invoice] order ${orderId}: discount check failed — none applied`, (e as Error).message);
  }
  const { discountedTotals } = await import("./order-pricing");
  const totals = discountedTotals(split, discount, saleTax?.rate ?? null);
  const tax = totals.tax;
  const total = totals.total;
  subtotal = totals.subtotal;

  // § 41 ج — the number's day is the Riyadh day of issue (it was the UTC day:
  // a delivery between 02:00 and 03:00 Riyadh took yesterday's), and the
  // serial counts that day's invoices (simulation ones left out).
  const ymd = invoiceDateYmd.replace(/-/g, "");
  const count = await getInvoiceCountToday(env, invoiceDateYmd);
  const seq = String(count + 1).padStart(3, "0");
  const invoiceNumber = `UTAK-INV-${ymd}-${seq}`;

  const invoiceId = await createInvoiceRecord(env, {
    orderId,
    invoiceNumber,
    invoiceDate: invoiceDateYmd,
    issuedAt,
    subtotal,
    tax,
    total,
    discount,
    discountPct,
  });

  // Parallel accounting write. Gated on ACCOUNTING_SYNC and swallows every
  // failure — the x_invoice row and the WhatsApp sends below are the source
  // of truth, and must not break because the standard-ledger twin fails.
  // 2026-09-23 — the invoice is created FROM the order's sale.order (billing
  // the delivered quantities: shortages were filtered out above), no longer
  // as a standalone account.move.
  if (accountingOn) {
    try {
      await invoiceSaleOrderOnDelivery(env, {
        invoiceId,
        existingMoveId: null,
        invoiceNumber,
        orderId,
        delivered: pricedLines.map((p) => ({
          lineId: p.lineId,
          description: saleLineDescription(p.product, p.packaging),
          quantity: p.qty,
          priceUnit: p.unit,
        })),
        expectedTotal: total,
      });
    } catch (e) {
      console.error(`[invoice] accounting sync threw`, (e as Error).message);
    }
  }

  try {
    await writeOrderLineUnitPrice(env, pricedLines.map(p => ({
      lineId: p.lineId,
      unit: p.unit,
      subtotal: p.line_total,
    })));
  } catch (e) {
    console.warn(`[invoice] failed to write line prices back`, (e as Error).message);
  }

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

  // § 41 ج — the invoice reaches the customer now, at «تم التسليم», once
  // (x_invoice_sent_at claimed before the send, released if it fails).
  await sendIssuedInvoice(env, invoiceId, invoiceNumber, () => dispatchInvoiceToCustomer(env, {
    to: order.customer_whatsapp,
    customerName: order.customer_name,
    invoiceNumber,
    invoiceDateYmd,
    total,
    subtotal,
    tax,
    pdfUrl,
    lines: pricedLines,
  }));

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
  // STATUS § 34 — a third session button: the collector's note to Baraa
  // (the template utak_collection_request keeps its two).
  const { collectNoteButton } = await import("./team-note");
  const collectButtons = [
    { id: `collect_cash_${invoiceId}`, title: "نقد 💵" },
    { id: `collect_transfer_${invoiceId}`, title: "تحويل 🏦" },
    collectNoteButton(invoiceId),
  ];
  // 2026-09-25 (STATUS § 29) — a collector on attendance who has not
  // tapped «بدء الدوام» today gets the request (with its buttons) after the tap.
  // STATUS § 31 — after the shift (or on a day off / time off): at the next
  // shift's tap, and Baraa gets one «مهمة لـ… بعد دوامه».
  try {
    const { holdForTask } = await import("./attendance");
    const att = await holdForTask(env, collector.id, { kind: "collection_request", label: `طلب تحصيل ${invoiceNumber} (${order.customer_name || "-"}، ${total} ر.س)` });
    if (att.hold) {
      const { enqueueTeamItems } = await import("./team-queue");
      await enqueueTeamItems(env, collector.whatsapp, [{ text: body, buttons: collectButtons }], att.queueTtl);
      await writeInvoice(env, invoiceId, { x_sent_to_collector_at: nowOdoo() });
      console.log(`[invoice] collection request ${invoiceNumber} queued until ${collector.name}'s «بدء الدوام»`);
      return { invoiceId, number: invoiceNumber, total };
    }
  } catch (e) {
    console.warn(`[invoice] collector queue failed — sending now`, (e as Error).message);
  }
  try {
    // STATUS § 33 — one gateway request: the template, else the buttons in the
    // collector's window (held for it otherwise). No second try after a refusal.
    await sendTemplateByPurpose(env, collector.whatsapp, T.COLLECTION_REQUEST,
      [
        order.customer_name || "",
        order.neighborhood || "-",
        invoiceNumber,
        String(total),
      ],
      [
        { index: 0, payload: `collect_cash_${invoiceId}` },
        { index: 1, payload: `collect_transfer_${invoiceId}` },
      ],
      undefined,
      { fallback: [buttonsContent(body, collectButtons)] });
    await writeInvoice(env, invoiceId, { x_sent_to_collector_at: nowOdoo() });
  } catch (e) {
    console.warn(`[invoice] failed to send to collector`, (e as Error).message);
  }

  return { invoiceId, number: invoiceNumber, total };
}

// --------------------------------------------------------------
// Customer invoice WhatsApp — sent once, at «تم التسليم» (§ 41 ج).
// --------------------------------------------------------------
interface CustomerInvoiceSend {
  to: string;
  customerName: string;
  invoiceNumber: string;
  /** YYYY-MM-DD (Riyadh) — shown as e.g. "23 Sept 2026". */
  invoiceDateYmd: string;
  total: number;
  subtotal: number;
  tax: number;
  pdfUrl: string | null;
  lines: Array<{ product: string; packaging: string; qty: number; unit: number; line_total: number }>;
}

/**
 * PDF template → text template → plain text, as ONE gateway request (STATUS
 * § 33): the first that can go now is sent — a template if approved (UTILITY),
 * the text inside the customer's window — and nothing is tried after Meta
 * refuses it. Outside the window with no usable template the text is held for
 * the customer. Throws when nothing went and nothing is held.
 */
async function dispatchInvoiceToCustomer(env: Env, a: CustomerInvoiceSend): Promise<void> {
  if (!a.to) throw new Error("customer has no WhatsApp number");
  // ت5 (2026-09-24): «24 سبتمبر 2026» — Arabic month, Latin digits, no bidi marks.
  const invoiceDate = arabicDate(a.invoiceDateYmd);
  // ح1: one line — the multi-line {{3}} was refused by Meta (#132018).
  const linesFormatted = joinCapped(a.lines.map(p => `${p.product} × ${p.qty} = ${p.line_total} ر.س`)).text;
  const customerText = buildCustomerInvoiceText(a.invoiceNumber, a.lines, a.subtotal, a.total, a.tax);
  const textTemplate: GwOption = {
    kind: "template",
    purpose: T.CUSTOMER_INVOICE,
    params: [a.customerName || "", a.invoiceNumber, linesFormatted, String(a.total)],
  };
  const pdfTemplate: GwOption | null = a.pdfUrl
    ? {
        kind: "template",
        purpose: T.CUSTOMER_INVOICE_PDF,
        params: [a.customerName || "", a.invoiceNumber, invoiceDate, String(a.total)],
        header: { type: "document", link: a.pdfUrl, filename: `${a.invoiceNumber}.pdf` },
      }
    : null;
  const options: GwOption[] = [...(pdfTemplate ? [pdfTemplate] : []), textTemplate, textContent(customerText)];
  const resp = await sendViaGateway(env, {
    purpose: T.CUSTOMER_INVOICE,
    to: a.to,
    content: options[0],
    fallback: options.slice(1),
  });
  if (!resp.ok) throw new Error(`invoice WhatsApp failed (HTTP ${resp.status})`);
}

/** The order's x_invoice, if one was already issued. */
async function findInvoiceForOrder(
  env: Env,
  orderId: number,
): Promise<{ invoiceId: number; number: string; total: number } | null> {
  const rows = await call<Array<{ id: number; x_invoice_number: string; x_total: number }>>(env, "x_invoice", "search_read", {
    domain: [["x_order_id", "=", orderId]],
    fields: ["id", "x_invoice_number", "x_total"],
    order: "id",
    limit: 1,
  });
  const r = rows[0];
  return r ? { invoiceId: r.id, number: r.x_invoice_number, total: r.x_total } : null;
}

/**
 * Rebuild the customer send for an issued x_invoice: the PDF archived in R2
 * at issue (re-generated only if it is missing), the order's customer and
 * its priced lines (x_unit_price written back at issue).
 */
export async function sendInvoiceDocumentToCustomer(env: Env, invoiceId: number): Promise<void> {
  const invoice = await getInvoiceById(env, invoiceId);
  if (!invoice) throw new Error(`x_invoice ${invoiceId} not found`);
  if (!invoice.orderId) throw new Error(`x_invoice ${invoiceId} has no order`);
  const order = await getOrderForInvoicing(env, invoice.orderId);
  if (!order) throw new Error(`order ${invoice.orderId} not found`);

  let pdfUrl: string | null = null;
  try {
    const archived = await env.INVOICES_BUCKET?.head(`invoices/${invoice.number}.pdf`);
    if (archived && env.ADMIN_TOKEN) {
      const token = await signInvoiceToken(env.ADMIN_TOKEN, invoice.number);
      pdfUrl = `${env.WORKER_ORIGIN}/invoice-pdf/${invoice.number}/${token}.pdf`;
    } else {
      const pdfData = await buildInvoicePDFDataFromOdoo(env, invoiceId);
      if (pdfData) {
        const uploaded = await uploadInvoiceToR2(env, await generateInvoicePDF(pdfData, env), invoice.number, env.WORKER_ORIGIN);
        pdfUrl = uploaded.publicUrl;
      }
    }
  } catch (e) {
    console.warn(`[invoice-send] PDF lookup failed for ${invoice.number}`, (e as Error).message);
  }

  const lines = order.lines.map((l) => {
    const unit = l.unit_price ?? 0;
    return { product: l.product_name, packaging: l.packaging_name, qty: l.quantity, unit, line_total: round2(unit * l.quantity) };
  });
  await dispatchInvoiceToCustomer(env, {
    to: order.customer_whatsapp,
    customerName: order.customer_name,
    invoiceNumber: invoice.number,
    invoiceDateYmd: invoice.date ?? todayRiyadhYmd(),
    total: invoice.total,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    pdfUrl,
    lines,
  });
}

export type InvoiceSendOutcome = "already_sent" | "sent" | "failed";

/**
 * § 41 ج — the one customer send of an issued invoice: x_invoice_sent_at is
 * claimed BEFORE the send (a second «تم التسليم» or a retry finds it set and
 * sends nothing); a failed send releases it and alerts the owner. Never throws.
 */
export async function sendIssuedInvoice(env: Env, invoiceId: number, invoiceNumber: string, send: () => Promise<void>): Promise<InvoiceSendOutcome> {
  try {
    const [inv] = await call<Array<{ id: number; x_invoice_sent_at: string | false }>>(env, "x_invoice", "read", {
      ids: [invoiceId], fields: ["id", "x_invoice_sent_at"],
    });
    if (inv?.x_invoice_sent_at) {
      console.log(`[invoice-send] ${invoiceNumber} already sent at ${inv.x_invoice_sent_at} — skip`);
      return "already_sent";
    }
    await writeInvoice(env, invoiceId, { x_invoice_sent_at: nowOdoo() });
  } catch (e) {
    console.warn(`[invoice-send] ${invoiceNumber}: x_invoice_sent_at claim failed — sending anyway`, (e as Error).message);
  }
  try {
    await send();
    await writeInvoice(env, invoiceId, { x_sent_to_customer_at: nowOdoo() });
    return "sent";
  } catch (e) {
    await writeInvoice(env, invoiceId, { x_invoice_sent_at: false }).catch(() => {});
    const msg = `[invoice-send] ${invoiceNumber}: تعذّر إرسال الفاتورة للعميل عند التسليم — ${(e as Error).message}`;
    console.error(msg);
    try { await sendOwnerAlert(env, msg); } catch { /* alert must not block */ }
    return "failed";
  }
}

/** § 41 ج — the order is a simulation (x_utak_simulation): no invoice. Unreadable → not a simulation (the flag is read, never guessed true). */
async function isSimulationOrder(env: Env, orderId: number): Promise<boolean> {
  try {
    const [o] = await call<Array<{ id: number; x_utak_simulation: boolean }>>(env, "x_daily_order", "read", { ids: [orderId], fields: ["id", "x_utak_simulation"] });
    return o?.x_utak_simulation === true;
  } catch (e) {
    console.warn(`[invoice] order ${orderId}: simulation flag unreadable`, (e as Error).message);
    return false;
  }
}

// --------------------------------------------------------------
// 5.3 — Collection button handler
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
  const r = await recordCollection(env, { invoiceId, method, collectedBy: collectorPartnerId });
  return { text: r.text };
}

export interface CollectionArgs {
  invoiceId: number;
  method: "cash" | "transfer";
  /** Defaults to the open balance (the button always collects in full). */
  amount?: number;
  collectedBy?: number | null;
}

export interface CollectionOutcome extends CollectionResult {
  paymentId: number | null;
  fullyPaid: boolean;
}

/**
 * Record one collection on an x_invoice. The button collects the open
 * balance; an explicit smaller `amount` is a partial collection: x_invoice
 * stays issued (the rest due) and the order stays open. The collection that
 * completes the balance marks it paid and closes the order. § 41 ج: the
 * invoice itself went to the customer at «تم التسليم» — nothing is sent here.
 */
export async function recordCollection(
  env: Env,
  a: CollectionArgs,
): Promise<CollectionOutcome> {
  const { invoiceId, method } = a;
  const invoice = await getInvoiceById(env, invoiceId);
  if (!invoice) {
    return { text: `الفاتورة رقم ${invoiceId} غير موجودة.`, paymentId: null, fullyPaid: false };
  }
  if (invoice.status === "paid") {
    return { text: `الفاتورة ${invoice.number} تم تحصيلها مسبقاً ✅`, paymentId: null, fullyPaid: true };
  }

  const prior = await call<Array<{ id: number; x_amount: number }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "=", invoiceId]],
    fields: ["id", "x_amount"],
    limit: 200,
  });
  const collected = round2(prior.reduce((s, p) => s + (p.x_amount ?? 0), 0));
  const remaining = round2(invoice.total - collected);
  let amount = a.amount ?? remaining;
  if (!(amount > 0) || !(remaining > 0)) {
    return { text: `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${invoice.number}.`, paymentId: null, fullyPaid: remaining <= 0 };
  }
  if (amount > remaining) amount = remaining;
  amount = round2(amount);
  const fullyPaid = amount + 0.005 >= remaining;

  const paymentId = await createPaymentRecord(env, {
    invoiceId,
    amount,
    method,
    collectedBy: a.collectedBy ?? undefined,
  });
  await writeInvoice(env, invoiceId, fullyPaid
    ? { x_payment_id: paymentId, x_status: "paid" }
    : { x_payment_id: paymentId });

  // ح8 second net: the button lock is KV (not atomic across colos). Re-count
  // after the create; more collected than invoiced = a double tap got through.
  try {
    const after = await call<Array<{ id: number; x_amount: number }>>(env, "x_payment", "search_read", {
      domain: [["x_invoice_id", "=", invoiceId]],
      fields: ["id", "x_amount"],
      limit: 200,
    });
    const sum = round2(after.reduce((t, p) => t + (p.x_amount ?? 0), 0));
    if (sum > invoice.total + 0.01) {
      await sendOwnerAlert(
        env,
        `🚨 تحصيل مكرر على الفاتورة ${invoice.number}: المسجّل ${sum} ر.س والفاتورة ${invoice.total} ر.س (${after.length} دفعة: ${after.map((p) => "#" + p.id).join("، ")}). راجع الدفعات واحذف المكرر.`,
      );
    }
  } catch (e) {
    console.warn(`[collection] overpayment check failed`, (e as Error).message);
  }

  // Parallel accounting write for the collection. Only meaningful when the
  // matching x_invoice was itself twinned into account.move (i.e. created
  // after ACCOUNTING_SYNC was flipped on). Legacy x_invoice rows with no
  // move_id are skipped with a warn — never a floating unlinked payment.
  if (isAccountingSyncEnabled(env)) {
    try {
      type LinkRow = { id: number; x_account_move_id: [number, string] | false };
      const [link] = await call<LinkRow[]>(env, "x_invoice", "read", {
        ids: [invoiceId],
        fields: ["id", "x_account_move_id"],
      });
      const invoiceMoveId = link?.x_account_move_id ? link.x_account_move_id[0] : null;
      await syncPaymentToAccounting(env, {
        paymentId,
        existingPaymentMoveId: null,
        invoiceMoveId,
        invoiceNumber: invoice.number,
        amount,
        method,
      });
    } catch (e) {
      console.error(`[collection] accounting sync threw`, (e as Error).message);
    }
  }

  if (fullyPaid && invoice.orderId) {
    await updateOrderState(env, invoice.orderId, "closed");
  }

  // STATUS § 39 د (م10) — nothing to the customer from here: the x_payment
  // just created fires the receipt (Odoo automation #1 → /internal/receipt-
  // issue, and the */5 net for a lost webhook), whose confirmation is the one
  // message of this payment (src/payment-confirm.ts). § 34's own «تم استلام
  // الدفعة» line was a second message inside the window.

  // § 41 ج — the invoice itself reached the customer at «تم التسليم» (the
  // «after full collection» send is gone).

  const how = method === "cash" ? "نقد 💵" : "تحويل 🏦";
  const text = fullyPaid
    ? `تم تسجيل التحصيل ${how} — الفاتورة ${invoice.number} ✅`
    : `تم تسجيل تحصيل جزئي ${how} ${amount} ر.س — الفاتورة ${invoice.number} (المتبقي ${round2(remaining - amount)} ر.س)`;
  return { text, paymentId, fullyPaid };
}

// --------------------------------------------------------------
// 5.4 — Daily collection summary cron (unchanged)
// --------------------------------------------------------------
export const NOTHING_TO_COLLECT_TEXT = "لا توجد فواتير معلّقة للتحصيل اليوم ✅";

/**
 * The 18:00 summary for one unpaid list: the four utak_collection_summary
 * variables ([date, list, total, count]) and the full multi-line text used
 * inside the 24h window only. ح1: {{2}} is one line — the multi-line list
 * failed 6/6 on sim with #132018.
 */
export function buildCollectionSummary(
  unpaid: Array<{ number: string; total: number; customer_name: string; neighborhood: string }>,
  ymd: string,
): { params: string[]; text: string; grandTotal: number } {
  const grandTotal = round2(unpaid.reduce((sum, r) => sum + r.total, 0));
  const items = unpaid.map((r, i) => {
    const neigh = r.neighborhood ? ` (${r.neighborhood})` : "";
    return `${i + 1}. ${r.customer_name}${neigh} — ${r.total} ر.س — ${r.number}`;
  });
  const text = [
    `📋 قائمة التحصيل اليومية`, ``, items.join("\n"), ``,
    `الإجمالي المطلوب: ${grandTotal} ر.س`,
    `عدد الفواتير: ${unpaid.length}`, ``,
    `لما تحصّل من أي عميل، افتح رسالة الفاتورة الأصلية واضغط زر التحصيل.`,
  ].join("\n");
  return { params: [arabicDate(ymd), joinCapped(items).text, String(grandTotal), String(unpaid.length)], text, grandTotal };
}

export interface CollectionSummaryReport {
  invoices: number;
  total: number;
  /** per collector (last 4 digits): what went out, or why nothing did. */
  sends: Array<{ to: string; via: "template" | "text" | "held" | "none"; reason?: string }>;
}

/**
 * 18:00 Riyadh — the collectors' list of unpaid invoices (simulation invoices
 * excluded, see getUnpaidInvoicesWithCustomer).
 *
 * 2026-09-24 — on 09-24 the template failed (#132018) and the free-text
 * fallback then failed too (#131047, outside the 24h window), so the list
 * never arrived. 2026-09-25 (STATUS § 33) — one gateway request: the approved
 * template, else the text inside the collector's window, else the text waits
 * for the collector's next message (and Baraa hears of it once). A refused
 * template is recorded and alerted by the gateway, and never followed by text.
 */
export async function sendDailyCollectionSummary(env: Env): Promise<CollectionSummaryReport> {
  const unpaid = await getUnpaidInvoicesWithCustomer(env);
  const collectors = await getCollectorTeamMembers(env);
  const report: CollectionSummaryReport = { invoices: unpaid.length, total: 0, sends: [] };

  if (collectors.length === 0) {
    console.warn(`[collection-cron] no collectors — skip`);
    return report;
  }
  const { attendanceHold, holdForTask } = await import("./attendance");
  const tail = (wa: string) => "…" + wa.replace(/\D/g, "").slice(-4);
  // 2026-09-25 (STATUS § 29) — a collector who has not tapped «بدء الدوام»
  // today gets the unpaid list right after the tap (sendCollectorBacklog).
  const HELD = "held until «بدء الدوام»";
  const outcome = (r: Response): { via: "template" | "text" | "held" | "none"; reason?: string } => {
    const d = gatewayDecision(r);
    if (d?.action === "template") return { via: "template" };
    if (d?.action === "session") return { via: "text" };
    if (d?.action === "held") return { via: "held", reason: d.reason };
    if (d?.action === "rejected") return { via: "none", reason: `Meta ${d.code}` };
    return { via: "none", reason: d && "reason" in d ? d.reason : `HTTP ${r.status}` };
  };

  if (unpaid.length === 0) {
    // «Nothing today» is not worth a paid template: a session text, which
    // waits for the collector's window until the end of the day.
    for (const c of collectors) {
      try {
        if ((await attendanceHold(env, c.id)).hold) {
          report.sends.push({ to: tail(c.whatsapp), via: "none", reason: HELD });
          continue;
        }
        const r = await sendText(env, c.whatsapp, NOTHING_TO_COLLECT_TEXT, { purpose: "collection_nothing" });
        report.sends.push({ to: tail(c.whatsapp), ...outcome(r) });
      } catch (e) {
        console.warn(`[collection-cron] send to ${tail(c.whatsapp)} failed`, (e as Error).message);
      }
    }
    return report;
  }

  const s = buildCollectionSummary(unpaid, new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10));
  report.total = s.grandTotal;
  for (const c of collectors) {
    try {
      // STATUS § 31 — after the shift / on a day off: the list waits for the
      // next shift's tap (sendCollectorBacklog), with one owner alert.
      if ((await holdForTask(env, c.id, { kind: "collection_summary", label: `ملخص التحصيل (${unpaid.length} فاتورة، ${s.grandTotal} ر.س)` })).hold) {
        report.sends.push({ to: tail(c.whatsapp), via: "none", reason: HELD });
        continue;
      }
      const resp = await sendTemplateByPurpose(env, c.whatsapp, T.COLLECTION_SUMMARY, s.params, [], undefined,
        { fallback: [textContent(s.text)] });
      report.sends.push({ to: tail(c.whatsapp), ...outcome(resp) });
    } catch (e) {
      console.warn(`[collection-cron] send to ${tail(c.whatsapp)} failed`, (e as Error).message);
    }
  }
  return report;
}

/**
 * 2026-09-25 (STATUS § 29) — right after a collector taps «بدء الدوام»: the
 * unpaid list as text (the 18:00 summary's own text; the tap opened the 24h
 * window). Nothing unpaid → nothing sent. Returns how many messages went out.
 */
export async function sendCollectorBacklog(env: Env, to: string): Promise<number> {
  const unpaid = await getUnpaidInvoicesWithCustomer(env);
  if (unpaid.length === 0) return 0;
  const s = buildCollectionSummary(unpaid, new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10));
  const r = await sendText(env, to, s.text, { purpose: "collection_summary" });
  return r.ok ? 1 : 0;
}

// --------------------------------------------------------------
// Formatters + helpers (unchanged)
// --------------------------------------------------------------
function buildCustomerInvoiceText(
  number: string,
  lines: Array<{ product: string; packaging: string; qty: number; unit: number; line_total: number }>,
  subtotal: number,
  total: number,
  tax: number = 0,
): string {
  const linesText = lines
    .map((l) => `• ${l.product} ${l.packaging} × ${l.qty} = ${l.line_total} ر.س`)
    .join("\n");
  // Tax-free (pre-cutoff) invoices keep the exact pre-VAT wording.
  // § 40 د — the quantity discount (before VAT), when the invoice has one.
  const discount = invoiceDiscount({ subtotal, tax, total });
  const discountLine = discount > 0 ? [`خصم الكمية: ${discount} ر.س`] : [];
  const totals = tax > 0
    ? [`الإجمالي قبل الضريبة: ${subtotal} ر.س`, ...discountLine, `ضريبة القيمة المضافة 15%: ${tax} ر.س`, `الإجمالي شامل الضريبة: ${total} ر.س`]
    : [`المجموع: ${subtotal} ر.س`, ...discountLine, `الإجمالي: ${total} ر.س`];
  return [
    `🧾 فاتورتك رقم ${number}`, ``, linesText, ``,
    ...totals, ``,
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
  // Bilingual overlays (Part B). When absent, bi/en modes fall back to
  // the Arabic-only string.
  name_en?: string;
  pack_en?: string;
}

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
    /** res.partner.vat — printed on a tax invoice only when registered. */
    vat?: string;
  };
  items: InvoiceLineItem[];
  /** Before VAT when vatAmount > 0 (prices are VAT-inclusive). */
  subtotal: number;
  discount: number;
  /** 0 = tax-free invoice (dated before the VAT cutoff): no VAT rows at all. */
  vatAmount: number;
  grandTotal: number;
  /** Seller VAT number; falls back to the Odoo company VAT (CompanyInfo.vat). */
  sellerVat?: string;
  paymentTerms?: string;
  // Doc-level language, resolved by the dispatcher from x_invoice.x_doc_lang
  // + customer.x_doc_lang. Left undefined preserves the byte-parity Arabic
  // baseline every legacy fixture relies on.
  //
  // KSA VAT Executive Regulation, Article 53: a tax invoice must include
  // its Arabic text. resolveDocLang enforces this by upgrading a resolved
  // "en" to "bi" when isTaxInvoice=true (see src/i18n.ts).
  lang?: DocLang;
  /**
   * ZATCA Phase 1 QR (2026-09-24). Set by the Odoo builders on tax invoices
   * only (vatAmount > 0, i.e. dated from VAT_EFFECTIVE_DATE_RIYADH); a
   * tax-free invoice never carries one.
   */
  zatcaQr?: ZatcaQr;
  /**
   * True for an issued invoice (every x_invoice row; a posted account.move).
   * Only issued invoices print the company seal + signature.
   */
  issued?: boolean;
}

/** Printed QR edge — comfortably scannable by a phone at arm's length. */
export const ZATCA_QR_SIZE_MM = 30;

// Middle slot for an invoice: the line-items table.
function renderInvoiceBodyHTML(
  items: InvoiceLineItem[],
  m: PageMetrics,
  lang: DocLang = "ar",
): string {
  // Byte-parity path: lang="ar" reproduces the exact Part A table.
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = items
    .map(
      (item) => {
        const nameCell = isAr
          ? escapeHTML(item.name)
          : itemCellHTML(item.name, item.name_en, lang);
        const packCell = isAr
          ? escapeHTML(item.pack)
          : itemCellHTML(item.pack, item.pack_en, lang);
        return `
    <tr style="border-bottom: ${BRAND_RULES.row};">
      <td style="height: ${m.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: ${BRAND_TYPE.cell.size}; font-weight: ${BRAND_TYPE.cell.weight}; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${m.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: ${BRAND_TYPE.cell.size}; font-weight: ${BRAND_TYPE.cell.weight}; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${packCell}</td>
      <td style="height: ${m.rowHeight}; text-align: ${dirEn}; font-size: ${BRAND_TYPE.cell.size}; font-weight: ${BRAND_TYPE.cell.weight}; direction: ltr;">${item.qty}</td>
      <td style="height: ${m.rowHeight}; text-align: ${dirEn}; font-size: ${BRAND_TYPE.cell.size}; font-weight: ${BRAND_TYPE.cell.weight}; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price, lang)}</td>
      <td style="height: ${m.rowHeight}; text-align: ${dirEn}; font-size: ${BRAND_TYPE.cell.size}; font-weight: ${BRAND_TYPE.cell.weight}; direction: ltr;">${formatMoney(item.total, lang)}</td>
    </tr>
  `;
      },
    )
    .join("");

  const th = (label: string, w: string, alignEn: boolean = false) => {
    const align = isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right");
    return `<th style="width: ${w}; text-align: ${align}; font-size: ${BRAND_TYPE.th.size}; font-weight: ${BRAND_TYPE.th.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.th.tracking}; padding: ${m.thPad};">${escapeHTML(label)}</th>`;
  };

  const L = (key: "colItem" | "colPackaging" | "colQty" | "colPrice" | "colTotal") => {
    if (isAr) return UI[key].ar;
    if (isEn) return UI[key].en;
    // bi shows the Arabic column header (primary language is Arabic).
    return UI[key].ar;
  };

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: ${BRAND_RULES.th}; border-bottom: ${BRAND_RULES.th};">
          ${th(L("colItem"), "40%")}
          ${th(L("colPackaging"), "20%")}
          ${th(L("colQty"), "10%", true)}
          ${th(L("colPrice"), "15%", true)}
          ${th(L("colTotal"), "15%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// Bottom-right totals block for an invoice.
//
// 2026-09-23 — two shapes:
//   • vatAmount === 0 (tax-free, dated before the VAT cutoff): subtotal,
//     discount, total. NO VAT row — an old invoice never shows tax lines.
//   • vatAmount > 0 (tax invoice): total before VAT, discount, VAT 15%, total
//     including VAT, plus the seller VAT number and the customer VAT number
//     (only when the customer has one) on the opposite side.
export function renderInvoiceTotalsHTML(
  subtotal: number,
  discount: number,
  vatAmount: number,
  grandTotal: number,
  lang: DocLang = "ar",
  vatNumbers: { seller?: string; buyer?: string } = {},
  qr?: ZatcaQr,
): string {
  // lang="ar" keeps the hard-coded Arabic strings from Part A. en/bi swap in
  // their translations from src/i18n.ts (bi shows the Arabic label).
  type Key = "subtotal" | "discount" | "vat15" | "grandTotal" | "subtotalExclVat" | "grandTotalInclVat" | "sellerVatNo" | "buyerVatNo" | "sellerName" | "issuedAt" | "vatTotal";
  const L = (key: Key) => {
    if (lang === "en") return UI[key].en;
    return UI[key].ar;
  };
  const isTax = vatAmount > 0;
  const row = (label: string, value: string) =>
    `<div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(label)}</span><span style="direction: ltr;">${value}</span></div>`;
  const vatRow = isTax ? `
        ${row(L("vat15"), formatMoney(vatAmount, lang))}` : "";
  const numbers: string[] = [];
  // 2026-09-24 — with a ZATCA QR the seller block prints the QR's decoded
  // values VERBATIM (name, VAT no., timestamp, total, VAT), so what a phone
  // scans and what the paper says are the same characters.
  const showQr = isTax && qr !== undefined;
  if (showQr) {
    const f = qr.fields;
    const cap = (label: string, value: string, key: string) =>
      `<div style="display: flex; justify-content: space-between; gap: 8px; font-size: 9px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(label)}</span><bdi dir="${key === "name" ? "auto" : "ltr"}" data-zatca="${key}" style="color: ${BRAND_COLORS.ink};">${escapeHTML(value)}</bdi></div>`;
    numbers.push(`<div data-zatca="qr" data-zatca-source="${qr.source}" style="display: flex; gap: 10px; align-items: flex-start;">
          ${zatcaQrSvg(qr.base64, ZATCA_QR_SIZE_MM)}
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; padding-top: 2px;">
            ${cap(L("sellerName"), f.sellerName, "name")}
            ${cap(L("sellerVatNo"), f.vatNumber, "vat")}
            ${cap(L("issuedAt"), f.timestamp, "timestamp")}
            ${cap(L("grandTotalInclVat"), f.total, "total")}
            ${cap(L("vatTotal"), f.vatTotal, "tax")}
          </div>
        </div>`);
  } else if (isTax && vatNumbers.seller && vatNumbers.seller.trim()) {
    numbers.push(row(L("sellerVatNo"), escapeHTML(vatNumbers.seller.trim())));
  }
  if (isTax && vatNumbers.buyer && vatNumbers.buyer.trim()) numbers.push(row(L("buyerVatNo"), escapeHTML(vatNumbers.buyer.trim())));
  const numbersCol = numbers.length
    ? `
      <div style="width: ${showQr ? "52%" : "40%"}; display: flex; flex-direction: column; gap: 9px;">
        ${numbers.join("\n        ")}
      </div>`
    : "";
  return `<div style="position: relative; display: flex; justify-content: ${numbersCol ? "space-between" : "flex-end"};">${numbersCol}
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        ${row(L(isTax ? "subtotalExclVat" : "subtotal"), formatMoney(subtotal, lang))}
        ${row(L("discount"), formatMoney(discount, lang))}${vatRow}
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(L(isTax ? "grandTotalInclVat" : "grandTotal"))}</span><span style="font-size: ${BRAND_TYPE.grandTotal.size}; font-weight: ${BRAND_TYPE.grandTotal.weight}; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal, lang)}</span></div>
      </div>
    </div>`;
}

// The Arabic-only branch is the byte-parity baseline every fixture relies on.
// `company` is optional here (unit tests + snapshot fixtures don't pass it);
// the production dispatch path always passes it so the legal-footer strip
// renders on every real UTAK PDF.
//
// Language: `data.lang` selects "ar" | "en" | "bi". Tax invoice guard: an
// invoice with vatAmount > 0 is a ZATCA-compliant tax invoice — resolveDocLang
// upgrades a resolved "en" to "bi" so the Arabic content stays on the page.
export function renderInvoiceHTML(data: InvoicePDFData, company?: CompanyInfo): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const isTaxInvoice = data.vatAmount > 0;
  const lang: DocLang = resolveDocLang({
    docLang: data.lang,
    partnerLang: undefined,
    isTaxInvoice,
  });
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  const legalFooterBar: LegalFooterInfo | undefined = company
    ? toLegalFooterAr(company)
    : undefined;

  // Byte-parity: without an explicit `lang`, the shell stays on the legacy
  // template. `lang === "ar"` also passes through cleanly since the shell
  // treats undefined and "ar" identically.
  const title = isTaxInvoice ? UI.taxInvoice : UI.invoice;
  const sealBlock = data.issued && company
    ? renderSealSignatureBlock({ stamp: company.stampImage, signature: company.signatureImage }, { marginTopMm: 0, raiseMm: 6 })
    : "";
  return renderPDFShell({
    documentTitle: lang === "en" ? title.en : title.ar,
    documentNumber: data.invoiceNumber,
    documentDate: data.invoiceDate,
    billTo,
    // FROM slot: only override when lang was requested — preserves the
    // byte-parity Part A output (BRAND_INFO default) for ar mode.
    from: data.lang ? fromPartyFor(lang, company) : undefined,
    bodyHTML: renderInvoiceBodyHTML(data.items, pageMetrics, lang),
    totalsHTML: renderInvoiceTotalsHTML(
      data.subtotal,
      data.discount,
      data.vatAmount,
      data.grandTotal,
      lang,
      { seller: data.sellerVat ?? company?.vat, buyer: data.customer.vat },
      isTaxInvoice ? data.zatcaQr : undefined,
    ),
    footerNote: data.paymentTerms ?? (lang === "en" ? UI.invoicePaymentTerms.en : UI.invoicePaymentTerms.ar),
    // The footer's dashed placeholder stays off: the real ZATCA QR (tax
    // invoices only, 2026-09-24) sits in the totals block, bottom-right.
    showZatcaQR: false,
    legalFooterBar,
    // Seal + signature, bottom-left in the terms row of the last page (raised
    // 6 mm into the row's top gap so a one-page invoice stays one page):
    // issued invoices only. Left undefined (not "") otherwise so the
    // byte-parity template holds.
    footerSealHTML: sealBlock || undefined,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    billToLabel: data.lang ? labelForBillTo(lang) : undefined,
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    termsLabel: data.lang ? labelForTerms(lang) : undefined,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    documentDateStr: lang === "en" ? formatDateEn(data.invoiceDate) : undefined,
  });
}

export async function generateInvoicePDF(
  data: InvoicePDFData,
  env: Env,
): Promise<Uint8Array> {
  const company = await readCompanyInfo(env);
  const html = renderInvoiceHTML(data, company);
  // 2026-09-22 (item 4): every printed page carries the "صفحة X من Y" strip
  // in the reserved bottom margin. The lang picks the label text.
  const lang: DocLang = resolveDocLang({
    docLang: data.lang,
    isTaxInvoice: data.vatAmount > 0,
  });
  return await htmlToPDF(html, env, {
    footerHtml: buildGotenbergFooterHtml(lang),
    marginBottom: GOTENBERG_FOOTER_MARGIN,
  });
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

  // 2026-09-23 — VAT comes from the x_invoice row as issued (the split was
  // decided on its Riyadh invoice date). A tax-free invoice (x_tax_amount 0,
  // every invoice before the cutoff) renders exactly as before: no VAT rows.
  const vatAmount = invoice.tax > 0 ? invoice.tax : 0;
  let customerVat: string | undefined;
  if (vatAmount > 0) {
    try {
      const [p] = await call<Array<{ id: number; vat: string | false }>>(env, "res.partner", "read", {
        ids: [order.customer_id],
        fields: ["id", "vat"],
      });
      if (p && typeof p.vat === "string" && p.vat.trim()) customerVat = p.vat.trim();
    } catch (e) {
      console.warn(`[invoice] customer VAT lookup failed`, (e as Error).message);
    }
  }

  // 2026-09-24 — ZATCA Phase 1 QR on tax invoices only. Prefer l10n_sa's
  // string from the twinned account.move; else encode the same five fields
  // from the x_invoice row (issued at its create_date).
  let zatcaQr: ZatcaQr | undefined;
  if (vatAmount > 0) {
    const [row] = await call<Array<{ create_date: string; x_account_move_id: [number, string] | false }>>(
      env, "x_invoice", "read", { ids: [invoiceId], fields: ["create_date", "x_account_move_id"] },
    );
    zatcaQr = await resolveInvoiceZatcaQr(env, {
      invoiceNumber: invoice.number,
      moveId: row?.x_account_move_id ? row.x_account_move_id[0] : null,
      issuedAtUtc: row?.create_date ? parseOdooUtc(row.create_date) : new Date(),
      total: invoice.total,
      tax: vatAmount,
    });
  }

  return {
    issued: true,
    ...(zatcaQr ? { zatcaQr } : {}),
    invoiceNumber: invoice.number,
    invoiceDate: invoice.date ? new Date(`${invoice.date}T12:00:00Z`) : new Date(),
    customer: {
      name: order.customer_name || 'عميل',
      address: order.neighborhood || 'الرياض',
      phone: order.customer_whatsapp || '',
      ...(customerVat ? { vat: customerVat } : {}),
    },
    items,
    subtotal: vatAmount > 0 ? invoice.subtotal : subtotal,
    // § 40 د — the quantity discount (before VAT) the invoice was issued with:
    // net + VAT − total (0 on every invoice without one).
    discount: invoiceDiscount(invoice),
    vatAmount,
    grandTotal: invoice.total,
  };
}

/** The discount an x_invoice was issued with, from its stored totals: subtotal + VAT − total (≥ 0). */
export function invoiceDiscount(inv: { subtotal: number; tax: number; total: number }): number {
  const d = round2(Number(inv.subtotal) + Number(inv.tax) - Number(inv.total));
  return d >= 0.01 ? d : 0;
}

// --------------------------------------------------------------
// ZATCA QR resolver shared by both builders. Reads l10n_sa_qr_code_str from
// the posted move (when there is one) and the seller identity from
// res.company; resolveZatcaQr decides which string to print. Never throws —
// a QR failure is logged and the invoice renders without it rather than
// not at all (the x_invoice row is already issued).
// --------------------------------------------------------------
async function resolveInvoiceZatcaQr(
  env: Env,
  a: { invoiceNumber: string; moveId: number | null; issuedAtUtc: Date; total: number; tax: number },
): Promise<ZatcaQr | undefined> {
  try {
    let odooQr: string | false = false;
    let issuedAtUtc = a.issuedAtUtc;
    if (a.moveId) {
      const [m] = await call<Array<{ state: string; l10n_sa_qr_code_str: string | false; l10n_sa_confirmation_datetime: string | false }>>(
        env, "account.move", "read",
        { ids: [a.moveId], fields: ["state", "l10n_sa_qr_code_str", "l10n_sa_confirmation_datetime"] },
      );
      if (m?.state === "posted") {
        odooQr = m.l10n_sa_qr_code_str;
        if (m.l10n_sa_confirmation_datetime) issuedAtUtc = parseOdooUtc(m.l10n_sa_confirmation_datetime);
      }
    }
    const [company] = await call<Array<{ name: string; vat: string | false }>>(
      env, "res.company", "read", { ids: [1], fields: ["name", "vat"] },
    );
    const qr = resolveZatcaQr({
      odooQr,
      expected: { vatNumber: typeof company?.vat === "string" ? company.vat : "", total: a.total, vatTotal: a.tax },
      fallback: { sellerName: company?.name ?? "", issuedAtUtc },
    });
    if (qr.odooRejected && a.moveId) {
      console.warn(`[invoice] ${a.invoiceNumber}: l10n_sa QR not used (${qr.odooRejected}) — encoded locally`);
    }
    return { base64: qr.base64, fields: qr.fields, source: qr.source };
  } catch (e) {
    console.error(`[invoice] ${a.invoiceNumber}: ZATCA QR failed — rendered without QR`, (e as Error).message);
    return undefined;
  }
}

// --------------------------------------------------------------
// Build from a standard Odoo customer invoice (account.move, out_invoice).
// Parallel reader alongside buildInvoicePDFDataFromOdoo (x_invoice).
// 2026-09-23 — VAT from the move itself (amount_untaxed / amount_tax). Line
// totals are shown tax-included (price_total) like the x_invoice PDF, so the
// line table always adds up to the grand total; for a tax-free move
// price_total === price_subtotal and nothing changes.
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
    state: string;
    create_date: string;
  };
  const heads = await call<MoveHead[]>(env, "account.move", "read", {
    ids: [moveId],
    fields: ["id","name","invoice_date","date","partner_id","invoice_line_ids","amount_untaxed","amount_tax","amount_total","move_type","state","create_date"],
  });
  const head = heads[0];
  if (!head) return null;
  if (head.move_type !== "out_invoice" && head.move_type !== "out_refund") return null;

  type Partner = { id: number; name: string | false; phone: string | false; street: string | false; city: string | false; vat: string | false };
  const partner = head.partner_id
    ? (await call<Partner[]>(env, "res.partner", "read", {
        ids: [head.partner_id[0]],
        fields: ["id","name","phone","street","city","vat"],
      }))[0]
    : null;

  type Line = {
    id: number;
    name: string | false;
    product_id: [number, string] | false;
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    price_total: number;
    display_type: string | false;
    sale_line_ids: number[];
  };
  type ProdProd = { id: number; product_tmpl_id: [number, string] | false };
  const lines = head.invoice_line_ids.length > 0
    ? await call<Line[]>(env, "account.move.line", "read", {
        ids: head.invoice_line_ids,
        fields: ["id","name","product_id","quantity","price_unit","price_subtotal","price_total","display_type","sale_line_ids"],
      })
    : [];
  // Odoo 17+ tags invoice product lines display_type = "product" (tax /
  // payment_term / line_section / line_note are the others). The old
  // `!l.display_type` test dropped every line — found 2026-09-23 on the first
  // live tax-invoice PDF.
  const productLines = lines.filter((l) => l.product_id && (!l.display_type || l.display_type === "product"));
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
    const total = round2(typeof l.price_total === "number" ? l.price_total : l.price_subtotal);
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
  // A draft move is not an issued invoice: no QR, no seal.
  const issued = head.state === "posted";
  const invoiceNumber = (typeof head.name === "string" && head.name) ? head.name : `INV-${moveId}`;
  const zatcaQr = issued && head.move_type === "out_invoice" && (head.amount_tax || 0) > 0
    ? await resolveInvoiceZatcaQr(env, {
        invoiceNumber,
        moveId,
        issuedAtUtc: parseOdooUtc(head.create_date),
        total: head.amount_total,
        tax: head.amount_tax,
      })
    : undefined;

  return {
    issued,
    ...(zatcaQr ? { zatcaQr } : {}),
    invoiceNumber,
    invoiceDate,
    customer: {
      name: partner?.name || (head.partner_id ? head.partner_id[1] : "عميل"),
      address: partner?.street || partner?.city || "الرياض",
      phone: partner?.phone || "",
      ...(typeof partner?.vat === "string" && partner.vat.trim() ? { vat: partner.vat.trim() } : {}),
    },
    items,
    subtotal: (head.amount_tax || 0) > 0 ? round2(head.amount_untaxed) : subtotal,
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
