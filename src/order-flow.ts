// § 49 ب / ج (2026-10-01) — the order's quotation, with a price that is valid
// for one day.
//
// Orders are taken at every hour. What decides a quotation is the VALID price
// list (src/price-validity.ts: the day's published list, from its publication
// until 06:00 of the next day):
//
//   • a valid list → the quotation as before, at that list's prices. The
//     prices are FROZEN on the order's lines when the quotation is made
//     (x_unit_price), and the order carries the list's day («أسعار يوم»,
//     x_price_date): the confirmation, the sale order and the invoice — issued
//     at the delivery, whenever that is — read the frozen prices, never a
//     later day's;
//   • no valid list (after 06:00 with today's not published yet, a day without
//     prices) → the order is KEPT (x_awaiting_prices), the customer is told
//     «استلمنا طلبك ✅ الأسعار تتحدث…», and at the first valid publication his
//     quotation goes to him by itself, at the new prices (quoteAwaitingOrders:
//     called by the publication, and by the every-5-minutes tick behind it);
//   • «تأكيد الطلب» on a quotation whose list has expired (after the next
//     06:00), or after the 21:00 of its ordering day: never confirmed at the
//     old price or the old delivery day — a new quotation at the valid list,
//     or the wait above (src/router.ts);
//   • the delivery day is the day after the ordering day (confirmed before
//     21:00: tomorrow morning; after it: the morning after), written in the
//     quotation and in the confirmation;
//   • every quotation says «السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.»
//
// ج — a confirmed order may be delivered on the spot (from the car): Baraa
// gets each confirmed order with a «تم التسليم ✅» button (notifyOwnerConfirmed).
// § 55 ب: that button is «📦 سلّم وحصّل» now — the delivery and collection form
// (src/delivery-form.ts); «تسليم N» still delivers the whole order at once.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import {
  call, createQuotationRecord, getOrderBrief, getOrderCustomer, getOrderForInvoicing, getPartnerLocation, getPartnerNeighborhood,
  setOrderLocation, setOrderNeighborhood, updateOrderState,
} from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { deliveryDayOf, nextOrderingDate, riyadhDateKey } from "./hours";
import { arabicDate } from "./wa-params";
import { listOfDayIfValid, listPrice, validPriceList, type ValidList } from "./price-validity";
import { minimumText, orderMinimum } from "./order-pricing";
import { quotationZeroGuard } from "./zero-price";

/** The customer's answer when his order is kept for want of a valid price list (Baraa's wording). */
export const AWAITING_TEXT = "استلمنا طلبك ✅ الأسعار تتحدث، ونرسل لك عرض السعر أول ما تنتشر أسعار اليوم.";
/** The fixed note of every quotation — the text, the PDF — and of the day's prices message. */
export const PRICE_NOTE = "السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.";
export const QUOTATION_PURPOSE = "customer_quotation";
export const OWNER_CONFIRMED_PURPOSE = "owner_order_confirmed";
/** The order is confirmed, or on its way: it may be delivered. */
export const DELIVERABLE_STATES: ReadonlySet<string> = new Set(["confirmed", "in_purchase", "in_delivery"]);

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (x: number) => { const n = round2(x); return Number.isInteger(n) ? String(n) : n.toFixed(2); };
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** «الجمعة 2 أكتوبر 2026». */
export function dayLabel(ymd: string): string {
  return `${WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${arabicDate(ymd)}`;
}
/** The morning an order of this ordering day is delivered, as the customer reads it. */
export function deliveryLabel(orderDay: string): string {
  return dayLabel(deliveryDayOf(orderDay));
}
/**
 * The delivery line of a quotation, the day written out. Before 21:00 the
 * order is tonight's (delivered tomorrow, if confirmed before 21:00); after
 * it, it is tomorrow night's — delivered the morning after tomorrow.
 */
export function deliveryLine(orderDay: string, now: Date = new Date()): string {
  return orderDay === riyadhDateKey(now)
    ? `🚚 التوصيل: صباح ${deliveryLabel(orderDay)}، لو تأكد قبل الساعة 9:00 مساءً.`
    : `🚚 التوصيل: صباح ${deliveryLabel(orderDay)} (بعد بكرة): الطلب بعد الساعة 9:00 مساءً يدخل شراء الغد.`;
}
export function vatNote(now: Date = new Date()): string {
  return isVatApplicable(riyadhDateKey(now)) ? "الأسعار شاملة ضريبة القيمة المضافة." : "";
}
export function quotationButtons(orderId: number): Array<{ id: string; title: string }> {
  return [
    { id: `confirm_order_${orderId}`, title: "تأكيد الطلب ✅" },
    { id: `edit_order_${orderId}`, title: "تعديل ✏️" },
    { id: `cancel_order_${orderId}`, title: "إلغاء ❌" },
  ];
}

// ---------------------------------------------------------------- the prices of an order

export interface FrozenOrder { list: ValidList; orderDay: string; total: number; unpriced: number }

/**
 * Freeze the order's prices from a valid list: each line's unit price is its
 * manual price (Baraa's, in Odoo) when it carries one, else the list's price
 * of its item (0 = the list has none: the zero-price guard stops the
 * quotation). The order takes the list's day («أسعار يوم»), the ordering day
 * of `now`, and stops waiting for prices.
 */
export async function freezeOrderPrices(env: Env, orderId: number, list: ValidList, now: Date = new Date()): Promise<FrozenOrder | null> {
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) return null;
  let total = 0, unpriced = 0;
  for (const l of order.lines) {
    const manual = (l.price_unit_manual ?? 0) > 0 ? (l.price_unit_manual as number) : 0;
    const unit = manual || (await listPrice(env, list, l.product_id, l.packaging_id)).price;
    const subtotal = round2(unit * l.quantity);
    if (!(unit > 0)) unpriced++;
    total = round2(total + subtotal);
    if (Math.abs((l.unit_price ?? 0) - unit) > 0.0001) {
      await call<boolean>(env, "x_daily_order_line", "write", { ids: [l.id], vals: { x_unit_price: unit, x_subtotal: subtotal } });
    }
  }
  const orderDay = nextOrderingDate(now);
  await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals: { x_price_date: list.day, x_order_date: orderDay, x_awaiting_prices: false } });
  return { list, orderDay, total, unpriced };
}

/** No valid list: the order is kept, open, until the first valid publication. */
export async function markAwaitingPrices(env: Env, orderId: number): Promise<void> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return;
  const vals: Record<string, unknown> = {};
  if (!o.awaitingPrices) vals.x_awaiting_prices = true;
  // an expired quotation is no quotation: the order is open again
  if (o.state === "waiting_confirmation") vals.x_state = "draft";
  if (Object.keys(vals).length) await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals });
}

/** The price list the order was quoted with, when it is still valid at `now`. */
export async function orderListStillValid(env: Env, priceDate: string, now: Date = new Date()): Promise<ValidList | null> {
  return priceDate ? await listOfDayIfValid(env, priceDate, now.getTime()) : null;
}

// ---------------------------------------------------------------- the quotation

export type QuoteOutcome =
  | { kind: "awaiting" }
  | { kind: "below_minimum"; text: string }
  | { kind: "review"; text: string }
  | { kind: "need_location" }
  | { kind: "quoted"; number: string; orderDay: string; list: ValidList; locationLine: string; deliveryLine: string };

function belowMinimumText(m: { min: number; total: number }): string {
  return `${minimumText(m.min)}\nمجموع طلبك الآن: ${Number.isInteger(m.total) ? m.total : m.total.toFixed(2)} ريال.`;
}

/**
 * The quotation of an order, now. No valid list → the order waits
 * («awaiting»). Else its prices are frozen from the list; below the minimum
 * (§ 40 د; 0 = none) or with a line without a price (§ 46 ج) there is no
 * quotation and the order stays open; without a delivery place the customer
 * is asked for it first (`askLocation`, the default) — or, for a quotation
 * that goes out by itself, it follows the confirmation.
 */
export async function quoteOrder(
  env: Env,
  a: { orderId: number; partnerId: number; now?: Date; askLocation?: boolean },
): Promise<QuoteOutcome> {
  const now = a.now ?? new Date();
  const list = await validPriceList(env, now.getTime());
  if (!list) {
    await markAwaitingPrices(env, a.orderId);
    return { kind: "awaiting" };
  }
  const frozen = await freezeOrderPrices(env, a.orderId, list, now);
  const minimum = await orderMinimum(env, a.orderId).catch(() => null);
  if (minimum?.below) {
    await backToDraft(env, a.orderId);
    return { kind: "below_minimum", text: belowMinimumText(minimum) };
  }
  const review = await quotationZeroGuard(env, a.orderId);
  if (review) {
    await backToDraft(env, a.orderId);
    return { kind: "review", text: review };
  }
  // v4.2: a precise location first; a saved neighborhood is the fallback.
  const loc = await getPartnerLocation(env, a.partnerId);
  const neigh = loc?.neighborhood || (await getPartnerNeighborhood(env, a.partnerId));
  if (!loc && !neigh && a.askLocation !== false) {
    await env.MSG_DEDUP.put(`pending_neighborhood:${a.partnerId}`, String(a.orderId), { expirationTtl: 60 * 30 });
    return { kind: "need_location" };
  }
  if (loc) await setOrderLocation(env, a.orderId, loc.latitude, loc.longitude, loc.neighborhood);
  else if (neigh) await setOrderNeighborhood(env, a.orderId, neigh);
  const locationLine = loc
    ? `📍 التوصيل إلى: ${loc.neighborhood || "الموقع المحفوظ"} (${loc.mapUrl})`
    : neigh ? `📍 التوصيل إلى: ${neigh}` : "";
  const q = await createQuotationRecord(env, a.orderId);
  await updateOrderState(env, a.orderId, "waiting_confirmation");
  const orderDay = frozen?.orderDay ?? nextOrderingDate(now);
  return { kind: "quoted", number: q.number, orderDay, list, locationLine, deliveryLine: deliveryLine(orderDay, now) };
}

async function backToDraft(env: Env, orderId: number): Promise<void> {
  const o = await getOrderBrief(env, orderId);
  if (o?.state === "waiting_confirmation") await updateOrderState(env, orderId, "draft");
}

/** «📍 قبل ما نجهّز الكوتيشن — أرسل موقع التوصيل…» */
export const LOCATION_ASK_LINES = [
  `📍 قبل ما نجهّز الكوتيشن — أرسل موقع التوصيل`,
  `اضغط 📎 → موقع → إرسال موقعي الحالي`,
  `(أو موقع محدد لو التوصيل لمكان ثاني)`,
];

// ---------------------------------------------------------------- the orders that wait for prices

export interface AwaitingReport { orderId: number; action: "quoted" | "review" | "below_minimum" | "empty" | "held" | "no_number" | "claimed_before" | "awaiting" | "error"; detail?: string }

/**
 * Every order kept for want of a valid list gets its quotation now that there
 * is one: its prices frozen from it, the quotation record (its PDF follows as
 * for any quotation), and the message with its three buttons through the
 * gateway — inside the customer's window as it is; outside it, as the gateway
 * decides (held until he writes, no longer than the list is valid). Once per
 * order and list (a KV claim). Nothing when no list is valid. Never throws.
 */
export async function quoteAwaitingOrders(env: Env, nowMs: number = Date.now(), ctx?: ExecutionContext): Promise<AwaitingReport[]> {
  const out: AwaitingReport[] = [];
  let list: ValidList | null;
  let orders: Array<{ id: number; x_customer_id: [number, string] | false; x_line_ids: number[] }>;
  try {
    // the waiting orders first: there are none on almost every tick, and that is one read
    orders = await call(env, "x_daily_order", "search_read", {
      domain: [["x_awaiting_prices", "=", true], ["x_state", "in", ["draft", "waiting_confirmation"]], ["x_utak_simulation", "!=", true]],
      fields: ["id", "x_customer_id", "x_line_ids"],
      order: "id asc",
      limit: 200,
    });
    if (!orders.length) return out;
    list = await validPriceList(env, nowMs);
  } catch (e) {
    console.warn("[awaiting] the waiting orders or the valid list could not be read", (e as Error)?.message);
    return out;
  }
  if (!list) return out;
  // each quotation is its own message: the claim below is the idempotency, not the cron's auto-send key
  const penv = { ...env, AUTO_SEND_JOB: undefined } as Env;
  const now = new Date(nowMs);
  const { heldPartnerIds } = await import("./screening");
  for (const o of orders) {
    const customerId = Array.isArray(o.x_customer_id) ? o.x_customer_id[0] : 0;
    if (!(o.x_line_ids ?? []).length || !customerId) {
      await call<boolean>(penv, "x_daily_order", "write", { ids: [o.id], vals: { x_awaiting_prices: false } }).catch(() => {});
      out.push({ orderId: o.id, action: "empty" });
      continue;
    }
    // a short claim while it runs (a run that died is retried by the tick), kept for the list's day once done
    const claim = await claimButton(penv, `awaitq:${o.id}:${list.day}`, 10 * 60);
    if (!claim.claimed) { out.push({ orderId: o.id, action: "claimed_before" }); continue; }
    try {
      if ((await heldPartnerIds(penv, [customerId])).has(customerId)) { await releaseButton(penv, claim); out.push({ orderId: o.id, action: "held" }); continue; }
      const cust = await getOrderCustomer(penv, o.id);
      if (!cust?.phone) { await releaseButton(penv, claim); out.push({ orderId: o.id, action: "no_number" }); continue; }
      const q = await quoteOrder(penv, { orderId: o.id, partnerId: customerId, now, askLocation: false });
      if (q.kind === "awaiting") { await releaseButton(penv, claim); out.push({ orderId: o.id, action: "awaiting" }); continue; }
      const send = (content: ReturnType<typeof textContent>) => sendViaGateway(penv, { purpose: QUOTATION_PURPOSE, to: cust.phone, content, expiresAt: list!.validUntilMs, ctx });
      if (q.kind === "quoted") {
        const items = (await getOrderForInvoicing(penv, o.id))?.lines ?? [];
        const body = [
          `📄 عرض السعر رقم ${q.number} لطلبك رقم #${o.id}، بأسعار ${dayLabel(q.list.day)}:`,
          ...items.map((l) => `• ${l.product_name} ${l.packaging_name} × ${l.quantity}`),
          "",
          ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE, "راجع الأصناف واختر:"].filter(Boolean),
        ].join("\n");
        const d = gatewayDecision(await send(buttonsContent(body, quotationButtons(o.id))));
        out.push({ orderId: o.id, action: "quoted", detail: d?.action });
      } else if (q.kind === "below_minimum" || q.kind === "review") {
        // no quotation after all (a line without a price, the minimum): he is told, as at «خلاص»
        await send(textContent(q.text));
        out.push({ orderId: o.id, action: q.kind });
      }
      await finishButton(penv, claim, 26 * 3600);
    } catch (e) {
      await releaseButton(penv, claim).catch(() => {});
      console.error(`[awaiting] order ${o.id} failed`, (e as Error)?.message);
      out.push({ orderId: o.id, action: "error", detail: (e as Error)?.message });
    }
  }
  if (out.some((r) => r.action === "quoted")) console.log(`[awaiting] ${list.day}: ${JSON.stringify(out)}`);
  return out;
}

// ---------------------------------------------------------------- ج: the confirmed order, to Baraa

/**
 * § 49 ج — a confirmed order reaches Baraa with a «تم التسليم ✅» button: he
 * sells from the car, and the tap delivers the order on the spot (its invoice
 * is issued and sent as at any delivery, and it enters no purchase list).
 * Once per order. Never throws.
 * § 55 ب — the button is «📦 سلّم وحصّل» now: the delivery and collection form
 * (src/delivery-form.ts), whose «إرسال» delivers the order the same way, by
 * the delivered quantities, with its payment. «تسليم N» still delivers it whole.
 */
export async function notifyOwnerConfirmed(env: Env, orderId: number): Promise<void> {
  if (!env.OWNER_WHATSAPP) return;
  try {
    const claim = await claimButton(env, `owner_confirmed:${orderId}`, 7 * 24 * 3600);
    if (!claim.claimed) return;
    const order = await getOrderForInvoicing(env, orderId);
    if (!order) { await releaseButton(env, claim); return; }
    // § 55 ب — «📦 سلّم وحصّل» (the delivery and collection form) in place of «تم التسليم ✅»
    const { DELIVERY_BUTTON_TITLE, deliveryButton } = await import("./delivery-form");
    const price = (l: { unit_price: number | null; price_unit_manual: number | null }) => (l.price_unit_manual ?? 0) > 0 ? (l.price_unit_manual as number) : l.unit_price ?? 0;
    const total = round2(order.lines.reduce((s, l) => s + round2(price(l) * l.quantity), 0));
    const text = [
      `✅ طلب مؤكد #${orderId} — ${order.customer_name}`,
      ...order.lines.map((l) => `• ${l.product_name} ${l.packaging_name} × ${l.quantity}`),
      `المجموع: ${money(total)} ر.س${order.price_date ? ` (أسعار ${arabicDate(order.price_date)})` : ""}`,
      order.order_date ? `التوصيل المسجَّل: صباح ${deliveryLabel(order.order_date)}.` : "",
      `سلّمته من السيارة؟ اضغط «${DELIVERY_BUTTON_TITLE}»: تكتب المسلَّم وطريقة الدفع، فتصدر فاتورته بالمسلَّم وتُرسل له، ولا يدخل قائمة الشراء. (أو اكتب «تسليم ${orderId}» لتسليمه كاملاً.)`,
    ].filter(Boolean).join("\n");
    await sendViaGateway({ ...env, AUTO_SEND_JOB: undefined } as Env, {
      purpose: OWNER_CONFIRMED_PURPOSE,
      to: env.OWNER_WHATSAPP,
      content: buttonsContent(text, [deliveryButton(orderId)]),
    });
    await finishButton(env, claim, 7 * 24 * 3600);
  } catch (e) {
    console.warn(`[owner-confirmed] order ${orderId} failed`, (e as Error)?.message);
  }
}

/** «تسليم 12» / «تم التسليم #12» from Baraa or the team: the order's number, else null. */
export function deliverCommandOrderId(text: string): number | null {
  const t = String(text ?? "").trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const m = /^(?:تم\s+)?(?:ال)?تسليم\s*(?:الطلب\s*)?(?:رقم\s*)?#?\s*(\d{1,9})$/.exec(t);
  return m ? Number(m[1]) : null;
}
