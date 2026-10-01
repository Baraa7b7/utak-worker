// § 46 ج (2026-10-01) — the zero-price guard: a line whose price is ≤ 0 or
// empty never enters a quotation or an invoice.
//
//   • the quotation: it is not created and not sent. The customer is told
//     «نراجع السعر وأرد عليك», the order stays open (draft), and Baraa gets
//     one alert a day per order with the order's number and the items. The
//     same check stands wherever a quotation is created («خلاص» in the order's
//     message, the quotation request and its path after the location) and
//     where the order is confirmed («تأكيد الطلب», whichever message carried
//     the button: the quotation, the 20:00 reminder or its reply), and the PDF
//     pipeline keeps its own block (src/quotation.ts);
//   • the invoice at «تم التسليم»: it is not issued — the delivery itself goes
//     on. Baraa gets one alert per order, the order is remembered (KV), and
//     the every-5-minutes tick issues and sends the invoice by itself once
//     the price is corrected in Odoo (the line's unit price, its manual price,
//     or the order day's published price).
//
// A price is read as the quotation reads it: the line's manual price, else
// its stored unit price, else the order day's price (getLatestSalePrice).

import type { Env } from "./config";
import { getLatestSalePrice, getOrderForInvoicing } from "./odoo";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { PLACE_TODAY } from "./places";

export const PRICE_REVIEW_TEXT = "نراجع السعر وأرد عليك 🌿";
/** A held invoice is retried this long, then dropped from the list (the alert stays in Baraa's chat). */
export const ZERO_INVOICE_KEEP_MS = 30 * 24 * 3600_000;
export const ZERO_INVOICE_INDEX = "inv_zero:v1:index";

export interface ZeroLine { product: string; packaging: string }

/** ≤ 0, empty, or not a number: not a price. */
export function isZeroPrice(unit: unknown): boolean {
  return !(typeof unit === "number" && Number.isFinite(unit) && unit > 0);
}

const label = (z: ZeroLine) => `• ${z.product || "صنف"}${z.packaging ? ` (${z.packaging})` : ""}`;

async function alertOwner(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("[zero-price] owner alert failed", (e as Error)?.message);
  }
}

// ---------------------------------------------------------------- the quotation

/** The order's lines whose price, as the quotation would price them, is ≤ 0 or empty. Null: no such order. */
export async function orderZeroLines(env: Env, orderId: number): Promise<{ customer: string; zero: ZeroLine[] } | null> {
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) return null;
  const zero: ZeroLine[] = [];
  for (const l of order.lines) {
    let unit = !isZeroPrice(l.price_unit_manual) ? (l.price_unit_manual as number) : !isZeroPrice(l.unit_price) ? (l.unit_price as number) : 0;
    if (isZeroPrice(unit)) unit = (await getLatestSalePrice(env, l.product_id, l.packaging_id, order.order_date ?? undefined)).price;
    if (isZeroPrice(unit)) zero.push({ product: l.product_name, packaging: l.packaging_name });
  }
  return { customer: order.customer_name, zero };
}

/**
 * Before a quotation is created, or a confirm button offered or acted on:
 * null when every line has a price; else the customer's text («نراجع السعر
 * وأرد عليك») — and Baraa's alert, once a day per order. A check that cannot
 * be read lets the order through (the PDF pipeline still blocks a line without
 * a price).
 */
export async function quotationZeroGuard(env: Env, orderId: number): Promise<string | null> {
  let found: Awaited<ReturnType<typeof orderZeroLines>>;
  try {
    found = await orderZeroLines(env, orderId);
  } catch (e) {
    console.warn(`[zero-price] order ${orderId}: the price check could not be read`, (e as Error)?.message);
    return null;
  }
  if (!found || !found.zero.length) return null;
  const claim = await claimButton(env, `zero_q:${orderId}:${riyadhDateKey()}`, 26 * 3600);
  if (claim.claimed) {
    await alertOwner(env, [
      `🚫 عرض سعر لم يُرسل — الطلب #${orderId} (${found.customer || "عميل"}): صنف بسعر صفر أو بلا سعر:`,
      ...found.zero.map(label),
      `أُبلغ العميل «نراجع السعر وأرد عليك»، والطلب باقٍ مفتوحاً.`,
      `صحّح السعر في Odoo («سعر يدوي للوحدة» على سطر الطلب، أو سعر اليوم في ${PLACE_TODAY})، ثم يكتب العميل «خلاص» أو أرسل العرض من Odoo.`,
    ].join("\n"));
    await finishButton(env, claim, 26 * 3600);
  }
  console.warn(`[zero-price] order ${orderId}: no quotation — ${found.zero.length} line(s) without a price`);
  return PRICE_REVIEW_TEXT;
}

// ---------------------------------------------------------------- the invoice

interface Held { o: number; at: number }

async function readIndex(env: Env): Promise<Held[]> {
  try {
    const raw = await env.MSG_DEDUP.get(ZERO_INVOICE_INDEX);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((h) => h && Number(h.o) > 0) : [];
  } catch {
    return [];
  }
}
async function writeIndex(env: Env, list: Held[]): Promise<void> {
  if (!list.length) { await env.MSG_DEDUP.delete(ZERO_INVOICE_INDEX).catch(() => {}); return; }
  await env.MSG_DEDUP.put(ZERO_INVOICE_INDEX, JSON.stringify(list), { expirationTtl: Math.ceil(ZERO_INVOICE_KEEP_MS / 1000) + 3600 });
}

/** The orders whose invoice waits for a price. */
export async function heldZeroInvoices(env: Env): Promise<number[]> {
  return (await readIndex(env)).map((h) => h.o);
}

/**
 * An invoice not issued for a zero price: the order is remembered for the
 * tick, and Baraa gets one alert per order (not one per retry).
 */
export async function holdZeroInvoice(env: Env, orderId: number, customer: string, zero: ZeroLine[], now: number = Date.now()): Promise<void> {
  try {
    const list = await readIndex(env);
    if (!list.some((h) => h.o === orderId)) await writeIndex(env, [...list, { o: orderId, at: now }]);
  } catch (e) {
    console.error(`[zero-price] order ${orderId}: could not remember the held invoice`, (e as Error)?.message);
  }
  const claim = await claimButton(env, `inv_zero_alert:${orderId}`, Math.ceil(ZERO_INVOICE_KEEP_MS / 1000));
  if (!claim.claimed) return;
  await alertOwner(env, [
    `🚫 فاتورة لم تصدر — الطلب #${orderId} (${customer || "عميل"}): صنف بسعر صفر أو بلا سعر:`,
    ...zero.map(label),
    `التسليم مسجّل. صحّح السعر في Odoo على سطر الطلب («سعر يدوي للوحدة» أو Unit Price)، وتصدر الفاتورة وتُرسل تلقائياً خلال 5 دقائق.`,
  ].join("\n"));
  await finishButton(env, claim, Math.ceil(ZERO_INVOICE_KEEP_MS / 1000));
}

export interface ZeroInvoiceTick { orderId: number; action: "issued" | "waiting" | "dropped" | "error"; invoice?: string; detail?: string }

/**
 * The every-5-minutes tick: each held order's invoice again. Issued (and
 * sent, as at «تم التسليم») once its lines all have a price; still zero → it
 * waits, without a second alert. One run at a time (a KV claim): a slow run
 * and the next tick never issue the same order twice — and the invoice's own
 * guards (the order's x_invoice, invoice_issue:<order>) stand behind it.
 */
export async function runZeroInvoiceTick(env: Env, now: number = Date.now()): Promise<ZeroInvoiceTick[]> {
  const list = await readIndex(env);
  if (!list.length) return [];
  const run = await claimButton(env, "inv_zero_tick", 4 * 60);
  if (!run.claimed) return [];
  const out: ZeroInvoiceTick[] = [];
  try {
    const { createAndDispatchInvoiceForOrder } = await import("./invoice");
    for (const h of list) {
      if (now - h.at > ZERO_INVOICE_KEEP_MS) { out.push({ orderId: h.o, action: "dropped", detail: "older than 30 days" }); continue; }
      try {
        const z = await orderZeroLines(env, h.o);
        if (!z) { out.push({ orderId: h.o, action: "dropped", detail: "the order is gone" }); continue; }
        // still without a price: it waits (no invoice attempt, no second alert)
        if (z.zero.length) { out.push({ orderId: h.o, action: "waiting" }); continue; }
        const inv = await createAndDispatchInvoiceForOrder(env, h.o);
        // priced now and still no invoice (every line short, a simulation order): not this guard's to retry
        out.push(inv ? { orderId: h.o, action: "issued", invoice: inv.number } : { orderId: h.o, action: "dropped", detail: "no invoice to issue" });
      } catch (e) {
        out.push({ orderId: h.o, action: "error", detail: (e as Error)?.message ?? String(e) });
      }
    }
    // an order held while this run was going stays (read again, then drop only what was issued or dropped here)
    const done = new Set(out.filter((r) => r.action === "issued" || r.action === "dropped").map((r) => r.orderId));
    const fresh = await readIndex(env);
    await writeIndex(env, fresh.filter((h) => !done.has(h.o)));
  } finally {
    await releaseButton(env, run);
  }
  return out;
}
