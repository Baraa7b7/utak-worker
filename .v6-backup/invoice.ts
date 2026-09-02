// v5 — Invoice generation + collection flow.
// Trigger: driver taps "تم التسليم" on a stop → team.ts marks stop delivered
//          → team.ts calls createAndDispatchInvoiceForOrder(orderId).
// Then:    invoice sent to customer, collection request sent to collector
//          with cash/transfer buttons. Buttons handled below.
// Cron:    18:00 Riyadh (15:00 UTC) → sendDailyCollectionSummary.

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
// 5.2 — Build invoice from a delivered order + dispatch
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

  // Resolve unit price per line: prefer already-set x_unit_price, else look up
  // today's x_daily_price.x_sale_price for the same product+packaging.
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

  const tax = 0; // ZATCA disabled until CR ready (v5.5)
  const total = round2(subtotal + tax);

  // Sequence: UTAK-INV-YYYYMMDD-NNN
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

  // Write unit prices back to order lines so the record matches the invoice
  // (best-effort, don't fail invoice if these writes fail)
  try {
    await writeOrderLineUnitPrice(env, pricedLines.map(p => ({
      lineId: p.lineId,
      unit: p.unit,
      subtotal: p.line_total,
    })));
  } catch (e) {
    console.warn(`[invoice] failed to write line prices back`, (e as Error).message);
  }

  // ---- Send to customer via approved template ----
  // invoice_customer_v2 params: name, invoiceNumber, lineItems, total
  const linesFormatted = pricedLines
    .map(p => `• ${p.name} × ${p.qty} = ${p.line_total} ر.س`)
    .join("\n");
  try {
    const resp = await sendTemplateByPurpose(env, order.customer_whatsapp, T.CUSTOMER_INVOICE,
      [order.customer_name || "", invoiceNumber, linesFormatted, String(total)]);
    if (!resp || !resp.ok) {
      // Fallback to plain text
      const customerText = buildCustomerInvoiceText(invoiceNumber, pricedLines, subtotal, total);
      await sendText(env, order.customer_whatsapp, customerText);
    }
    await writeInvoice(env, invoiceId, { x_sent_to_customer_at: nowOdoo() });
  } catch (e) {
    console.warn(`[invoice] failed to send to customer`, (e as Error).message);
  }

  // ---- Send to collector(s) with buttons ----
  const collectors = await getCollectorTeamMembers(env);
  if (collectors.length === 0) {
    console.warn(`[invoice] no collectors configured — skipping collector dispatch`);
    await writeInvoice(env, invoiceId, { x_sent_to_collector_at: nowOdoo() });
    return { invoiceId, number: invoiceNumber, total };
  }

  // For v5: pick the first configured collector.
  // Multi-collector routing (by neighborhood) is a v6 refinement.
  const collector = collectors[0];
  const body = buildCollectorRequestText({
    invoiceNumber,
    customerName: order.customer_name,
    neighborhood: order.neighborhood,
    total,
  });
  // v7: collection_request template — 4 params + 2 buttons (نقد | تحويل)
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

  const invoice = await getInvoiceById(env, invoiceId);
  if (!invoice) {
    return { text: `الفاتورة رقم ${invoiceId} غير موجودة.` };
  }
  if (invoice.status === "paid") {
    return { text: `الفاتورة ${invoice.number} تم تحصيلها مسبقاً ✅` };
  }

  // Create payment + link + mark invoice paid + mark order closed
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

  // Notify customer
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
// 5.4 — Daily collection summary cron (18:00 Riyadh / 15:00 UTC)
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
    `📋 قائمة التحصيل اليومية`,
    ``,
    lines,
    ``,
    `الإجمالي المطلوب: ${grandTotal} ر.س`,
    `عدد الفواتير: ${unpaid.length}`,
    ``,
    `لما تحصّل من أي عميل، افتح رسالة الفاتورة الأصلية واضغط زر التحصيل.`,
  ].join("\n");

  const today = new Date().toISOString().slice(0, 10);
  for (const c of collectors) {
    try {
      // v7: collection_summary template — 4 params: date, list, total, count
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
// Formatters
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
    `🧾 فاتورتك رقم ${number}`,
    ``,
    linesText,
    ``,
    `المجموع: ${subtotal} ر.س`,
    `الإجمالي: ${total} ر.س`,
    ``,
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
    `💰 طلب تحصيل`,
    ``,
    `العميل: ${args.customerName}${neigh}`,
    `الفاتورة: ${args.invoiceNumber}`,
    `المبلغ: ${args.total} ر.س`,
    ``,
    `اختر طريقة التحصيل:`,
  ].join("\n");
}

// --------------------------------------------------------------
// Helpers
// --------------------------------------------------------------
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
