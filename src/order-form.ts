// § 53 ج (2026-10-04) — the customer's order as a WhatsApp Flow: a quantity
// field for every item of the day's VALID price list.
//
// The Flow (utak_order_v1, published at Meta; scripts/lib/s53-flows.mjs is its
// JSON) is four generic pages of fifteen optional number fields, with no
// endpoint: all the data goes with the message to the first page (flow_action
// navigate) and the others read it from there. The worker fills the pages, in
// order, with the categories that have an item in the list — فواكه (#5), خضار
// (#6), ورقيات (#7), then «أخرى» — as the price form does (src/price-flow.ts).
//
//   • The items are the published lines of the valid list (§ 49: the day's
//     list, from its publication until 06:00 of the next day): the field's label
//     is the item's name, its hint «التعبئة · السعر X ر.س شامل الضريبة». Above
//     the fields: «السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.» and the
//     delivery day by § 49's rule.
//   • It goes INSIDE the 24h window only — an interactive message, never a
//     template, never held: with the 06:00 prices to a customer whose window is
//     open («اطلب الآن»), in answer to «اطلب» / «أبي أطلب», and after a
//     customer's first order message of the list's day (then opened with what
//     he wrote).
//   • No valid list: no form. He is told the prices are being updated, as § 49.
//   • Never to a price source, a supplier, the team or Baraa: the gateway
//     refuses the purpose for a source's or a supplier's number
//     (src/price-privacy.ts), and the roster is read here.
//   • flow_token: one per send, kept in KV with the customer, the list's day and
//     the item and price of every slot. A reply is read from it — never from the
//     client's data — by the number it was sent to, while ITS list is valid,
//     once. A reply after the list expired writes nothing: a new form with the
//     new prices goes instead (or the «الأسعار تتحدث» text when none is valid).
//   • «إرسال»: the quantities become the lines of the customer's open order of
//     the ordering day, and the quotation follows exactly as after «خلاص»
//     (quoteOrder: the prices frozen from the valid list, the minimum, the
//     zero-price guard, the delivery place) with «تأكيد الطلب» / «تعديل» /
//     «إلغاء». Nothing is deleted: a line emptied in «تعديل» closes the order
//     (cancelled) and its remaining lines start a new one.
//   • «تعديل» on a quotation made by the form opens the form with the order's
//     quantities.
//   • The text order and «خلاص» stay as they were.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import type { NormalizedMessage } from "./types";
import { addOrderLines, call, createOrderWithLines, findOrCreateTodayOrder, getOrderBrief, getOrderForInvoicing, updateOrderState, type LateItem } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { nextOrderingDate, riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { listOfDayIfValid, validPriceList, type ValidList } from "./price-validity";
import { FLOW_CATEGORIES, FLOW_OTHER_TITLE, productPages } from "./price-flow";
import { LOCATION_ASK_LINES, PRICE_NOTE, QUOTATION_PURPOSE, dayLabel, deliveryLine, quotationButtons, quoteOrder, vatNote } from "./order-flow";

/** utak_order_v1 at Meta (a published Flow's JSON is frozen). */
export const ORDER_FLOW_ID = "961075853720270";
export const ORDER_FLOW_SCREEN = "ORDER_A";
export const ORDER_FLOW_PAGES = 4;
export const ORDER_FLOW_PAGE_SLOTS = 15;
export const ORDER_FLOW_SLOTS = ORDER_FLOW_PAGES * ORDER_FLOW_PAGE_SLOTS;
/** The gateway purpose of the form: it carries our sale prices (src/price-privacy.ts). */
export const ORDER_FORM_PURPOSE = "customer_order_form";
/** The one trial to Baraa and its answers (allowed to the owner's number alone). */
export const ORDER_FORM_TEST_PURPOSE = "order_flow_test";
export const ORDER_FORM_CTA = "اطلب الآن";
export const ORDER_FORM_EDIT_CTA = "عدّل الطلب";
/** Meta's limits of a TextInput: its label and its helper text. */
export const ORDER_LABEL_MAX = 20;
export const ORDER_HINT_MAX = 80;
export const ORDER_TEST_MARK = "🧪 تجربة";
/** The largest quantity a field takes (cartons). */
export const ORDER_QTY_MAX = 9999;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";

// ---------------------------------------------------------------- texts

const firstName = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
/** In answer to «اطلب». */
export const orderFormAskText = (name: string): string =>
  `${firstName(name) ? `حياك ${firstName(name)} 🌿 ` : ""}اضغط «${ORDER_FORM_CTA}» واكتب عدد الكراتين جنب كل صنف، ثم «إرسال».`;
/** With the 06:00 prices. */
export const ORDER_FORM_PRICES_TEXT = `تقدر تطلب من هنا مباشرة: اضغط «${ORDER_FORM_CTA}» واكتب عدد الكراتين جنب كل صنف 👇`;
/** After a customer's first order message of the day: the form opens with what he wrote. */
export const ORDER_FORM_FOLLOW_TEXT = `وتقدر تكمل طلبك من النموذج: فيه أصناف اليوم وأسعارها، وكمياتك اللي كتبتها 👇`;
export const orderFormEditText = (orderId: number): string => `عدّل طلبك رقم #${orderId} من النموذج: غيّر الكميات ثم «إرسال» (الخانة الفاضية تحذف الصنف).`;
/** No valid list (§ 49): no form. */
export const ORDER_FORM_NO_LIST_TEXT = "الأسعار تتحدث الآن 🌿 اكتب طلبك من الحين ونحفظه لك، ويوصلك عرض السعر أول ما تنتشر أسعار اليوم.";
export const ORDER_FORM_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء 🌿 اكتب «اطلب» ونرسل لك نموذج اليوم.";
export const ORDER_FORM_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. للتعديل اضغط «تعديل ✏️» تحت عرض السعر.";
export const ORDER_FORM_EMPTY_TEXT = "ما وصلتنا كمية في النموذج 🌿 اكتب عدد الكراتين جنب الصنف اللي تبيه ثم «إرسال».";
export const ORDER_FORM_EXPIRED_TEXT = "أسعار هذا النموذج انتهت صلاحيتها (السعر صالح ليوم واحد)، فلم يُسجَّل منه شيء. هذا نموذج بأسعار اليوم 👇";
export const ORDER_FORM_EXPIRED_NO_LIST_TEXT = `أسعار هذا النموذج انتهت صلاحيتها (السعر صالح ليوم واحد)، فلم يُسجَّل منه شيء. ${ORDER_FORM_NO_LIST_TEXT}`;
export const ORDER_FORM_CLOSED_TEXT = (orderId: number): string => `طلبك رقم #${orderId} ما عاد يقبل تعديلاً من هنا 🙏 اكتب «اطلب» لطلب جديد.`;

/** «اطلب», «أبي أطلب», «ابغى اطلب», «بطلب»: the whole message, nothing else in it. */
export function wantsOrderForm(text: string): boolean {
  const t = String(text ?? "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[.!؟?،,\s]+$/g, "").replace(/\s+/g, " ");
  return /^(?:(?:ابي|ابغي|ابغا|بغيت|ودي|حاب|اريد) )?(?:اطلب|بطلب)(?: الان| الحين)?$/.test(t);
}

function money(x: number): string {
  const n = Math.round(Number(x) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
const qty = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** The hint of an item no list ever priced — the trial's alone: a customer's form holds published prices only. */
export const ORDER_NO_PRICE_HINT = "بلا سعر منشور";
/** A slot's label — the item's name — and its hint: «كرتون · السعر 31 ر.س شامل الضريبة». */
export function orderSlotTexts(product: string, packaging: string, price: number, vat: boolean): { label: string; hint: string } {
  const k = clean(packaging);
  const priced = price > 0 ? `السعر ${money(price)} ر.س${vat ? " شامل الضريبة" : ""}` : ORDER_NO_PRICE_HINT;
  return {
    label: cut(clean(product), ORDER_LABEL_MAX),
    hint: cut(`${k ? `${k} · ` : ""}${priced}`, ORDER_HINT_MAX),
  };
}

// ---------------------------------------------------------------- the form's items

export interface OrderFormItem {
  slot: number;
  productId: number;
  packagingId: number;
  /** «طماطم كرتون», as the quotation names a line. */
  name: string;
  label: string;
  hint: string;
  /** The list's sale price of the item (what the hint shows; the order's lines are frozen from the list itself). */
  price: number;
}
export interface OrderFormItems {
  items: OrderFormItem[];
  /** The headings of the pages that have items, in order. */
  pages: string[];
  /** Every published item of the list. */
  total: number;
  over: Array<{ title: string; total: number }>;
  left: string[];
}
type M2O = [number, string] | false;
const m2o = (v: M2O | number | undefined): [number, string] => (Array.isArray(v) ? v : typeof v === "number" ? [v, ""] : [0, ""]);

/**
 * The published lines of a list: approved, not left out, a price above zero — in the list's own order.
 * `everyLine` (the trial to Baraa alone, when no list was published): every line of the day, at what it
 * would sell for when it has a price — approved, else suggested, else the market — and with none otherwise.
 */
export async function listItems(env: Env, list: Pick<ValidList, "dayId">, everyLine = false): Promise<Array<{ productId: number; productName: string; packagingId: number; packagingName: string; price: number }>> {
  const lines = await call<Array<{ id: number; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_sale_price: number | false; x_excluded: boolean; x_status: string | false; x_suggested_price?: number | false; x_market_price?: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: everyLine ? [["x_day_id", "=", list.dayId], [SIM_FIELD, "!=", true]]
      : [["x_day_id", "=", list.dayId], [SIM_FIELD, "!=", true], ["x_excluded", "=", false], ["x_sale_price", ">", 0], ["x_status", "in", ["auto", "manual"]]],
    fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_sale_price", "x_excluded", "x_status", "x_suggested_price", "x_market_price"],
    order: "x_sequence asc, id asc", limit: 500,
  });
  const priceOf = (l: (typeof lines)[number]): number => Number(l.x_sale_price) || (everyLine ? Number(l.x_suggested_price) || Number(l.x_market_price) || 0 : 0);
  return lines.map((l) => ({
    productId: m2o(l.x_product_tmpl_id)[0], productName: m2o(l.x_product_tmpl_id)[1],
    packagingId: m2o(l.x_packaging_id)[0], packagingName: m2o(l.x_packaging_id)[1], price: priceOf(l),
  })).filter((l) => l.productId > 0 && l.packagingId > 0 && (everyLine || l.price > 0));
}

/** The items on their pages: grouped by category, the first fifteen of each; a category with no item takes no page. */
export async function orderFormItems(env: Env, list: ValidList, everyLine = false): Promise<OrderFormItems> {
  const all = await listItems(env, list, everyLine);
  if (!all.length) return { items: [], pages: [], total: 0, over: [], left: [] };
  const { of, titles } = await productPages(env, [...new Set(all.map((i) => i.productId))]);
  const groups = [...FLOW_CATEGORIES.map((c) => ({ title: titles.get(c.id) ?? c.title, items: all.filter((i) => (of.get(i.productId) ?? 0) === c.id) })),
    { title: FLOW_OTHER_TITLE, items: all.filter((i) => !(of.get(i.productId) ?? 0)) }].filter((g) => g.items.length).slice(0, ORDER_FLOW_PAGES);
  const vat = isVatApplicable(list.day);
  const items = groups.flatMap((g, k) => g.items.slice(0, ORDER_FLOW_PAGE_SLOTS).map((it, j) => {
    const t = orderSlotTexts(it.productName, it.packagingName, it.price, vat);
    return { slot: k * ORDER_FLOW_PAGE_SLOTS + j + 1, productId: it.productId, packagingId: it.packagingId, name: `${clean(it.productName)} ${clean(it.packagingName)}`.trim(), label: t.label, hint: t.hint, price: it.price };
  }));
  return {
    items, pages: groups.map((g) => g.title), total: all.length,
    over: groups.filter((g) => g.items.length > ORDER_FLOW_PAGE_SLOTS).map((g) => ({ title: g.title, total: g.items.length })),
    left: groups.flatMap((g) => g.items.slice(ORDER_FLOW_PAGE_SLOTS).map((i) => clean(i.productName))),
  };
}

/** The 249 keys of the first page: the note, the delivery line, each page's heading and whether a page follows it, and l/h/v/i of every slot. */
export function orderFormData(note: string, del: string, pages: string[], items: OrderFormItem[], init: Record<number, number> = {}): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = { note, del };
  for (let k = 1; k <= ORDER_FLOW_PAGES; k++) {
    data[`t${k}`] = pages[k - 1] ?? "-";
    if (k < ORDER_FLOW_PAGES) data[`m${k}`] = k < pages.length;
  }
  for (let n = 1; n <= ORDER_FLOW_SLOTS; n++) {
    const it = items.find((x) => x.slot === n);
    data[`l${n}`] = it ? it.label : "-";
    data[`h${n}`] = it ? it.hint : "-";
    data[`v${n}`] = !!it;
    data[`i${n}`] = it && init[n] > 0 ? qty(init[n]) : "";
  }
  return data;
}

// ---------------------------------------------------------------- flow_token

export interface OrderFormRecord {
  v: 1;
  token: string;
  /** The price list the form was made from: its day (Riyadh) and when it ends. */
  listDay: string;
  validUntilMs: number;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  name: string;
  items: OrderFormItem[];
  pages: string[];
  createdAt: number;
  /** «تعديل», or a form opened on the customer's open order: the order whose lines it replaces. */
  orderId?: number;
  /** What the form opened with (slot → quantity): an emptied one of them removes its line. */
  init?: Record<number, number>;
  /** The trial to Baraa: its reply creates no order. */
  test?: boolean;
  usedAt?: number;
}
export const orderFormKey = (token: string): string => `oform:v1:${token}`;
export const isOrderFormToken = (token: string): boolean => String(token ?? "").startsWith("of1.");
export function newOrderFormToken(listDay: string, partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `of1.${listDay.replace(/-/g, "")}.${partnerId}.${rand}`;
}
export async function readOrderFormToken(env: Env, token: string): Promise<OrderFormRecord | null> {
  if (!isOrderFormToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(orderFormKey(token));
    const rec = raw ? (JSON.parse(raw) as OrderFormRecord) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}
async function writeOrderFormToken(env: Env, rec: OrderFormRecord): Promise<void> {
  await env.MSG_DEDUP.put(orderFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the send

export interface OrderFormWho { partnerId: number; name: string; whatsapp: string }
export interface OrderFormOpts {
  now?: number;
  /** The list to make it from (the publication passes its own); else the valid list now. */
  list?: ValidList;
  /** The text above the button. */
  body?: string;
  cta?: string;
  orderId?: number;
  init?: Record<number, number>;
  /** The same items on the same pages (a form sent again for the same list). */
  items?: OrderFormItem[];
  pages?: string[];
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface OrderFormResult { sent: boolean; reason?: string; token?: string }

export function orderFormSession(text: string, token: string, data: Record<string, string | boolean>, cta: string = ORDER_FORM_CTA): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: ORDER_FLOW_ID,
            flow_cta: cta,
            flow_action: "navigate",
            flow_action_payload: { screen: ORDER_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/**
 * May this number get the order form? Never Baraa (but his trial), never the
 * team — the roster is read, and a roster that cannot be read sends nothing. A
 * price source's or a supplier's number is refused by the gateway itself.
 */
export async function orderFormRecipientProblem(env: Env, digits: string): Promise<string> {
  if (isOwnerRecipient(env, digits)) return "owner";
  try {
    const { loadRoster, memberByNumber } = await import("./team-roster");
    return memberByNumber(await loadRoster(env), digits) ? "team" : "";
  } catch (e) {
    console.warn("[order-form] the roster could not be read — no form", (e as Error)?.message);
    return "unverified";
  }
}

/**
 * One order form: the interactive message, inside the number's window only.
 * Nothing is held and no template is used; without a valid list nothing goes.
 */
export async function sendOrderForm(env: Env, who: OrderFormWho, opts: OrderFormOpts = {}): Promise<OrderFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  if (!opts.test) {
    const problem = await orderFormRecipientProblem(env, to);
    if (problem) return { sent: false, reason: problem };
  }
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const list = opts.list ?? (await validPriceList(env, now));
  if (!list) return { sent: false, reason: "no_list" };
  let items = opts.items ?? null, pages = opts.pages ?? [];
  if (!items) {
    const built = await orderFormItems(env, list);
    items = built.items; pages = built.pages;
    if (built.left.length && !opts.test) await alertOverflow(env, list.day, built.over, built.left);
  }
  if (!items.length) return { sent: false, reason: "no_items" };
  const rec: OrderFormRecord = {
    v: 1, token: newOrderFormToken(list.day, who.partnerId), listDay: list.day, validUntilMs: list.validUntilMs, to, partnerId: who.partnerId, name: who.name,
    items, pages, createdAt: now,
    ...(opts.orderId ? { orderId: opts.orderId } : {}), ...(opts.init ? { init: opts.init } : {}), ...(opts.test ? { test: true } : {}),
  };
  await writeOrderFormToken(env, rec);
  const mark = opts.test ? `${ORDER_TEST_MARK} — ` : "";
  const data = orderFormData(PRICE_NOTE, deliveryLine(nextOrderingDate(new Date(now)), new Date(now)), pages.map((t) => `${mark}${t}`), items, opts.init ?? {});
  const res = await sendViaGateway(env, {
    purpose: opts.test ? ORDER_FORM_TEST_PURPOSE : ORDER_FORM_PURPOSE,
    to,
    content: orderFormSession(`${mark}${opts.body ?? orderFormAskText(who.name)}`, rec.token, data, opts.cta ?? ORDER_FORM_CTA),
    noHold: true,
    noHoldReason: "نموذج الطلب يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(orderFormKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

/** A category of more items than a page's fields: Baraa's one alert per list. */
async function alertOverflow(env: Env, day: string, over: Array<{ title: string; total: number }>, left: string[]): Promise<void> {
  const claim = await claimButton(env, `oform_over:${day}`, DAY_TTL);
  if (!claim.claimed) return;
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, `⚠️ صفحة الفئة في نموذج الطلب تتسع لـ ${ORDER_FLOW_PAGE_SLOTS} خانة، و${over.map((o) => `«${o.title}» فيها ${o.total} صنفاً منشوراً`).join("، و")}: دخل أول ${ORDER_FLOW_PAGE_SLOTS}، وبقي بلا خانة: ${left.join("، ")}. العميل يطلبها نصاً.`);
  } catch (e) {
    console.warn("[order-form] the overflow alert failed", (e as Error)?.message);
  }
  await finishButton(env, claim, DAY_TTL);
}

// ---------------------------------------------------------------- when it goes

const autoKey = (listDay: string, digits: string): string => `oform_auto:v1:${listDay}:${waDigits(digits)}`;
/** The form went to this number by itself for this list (the 06:00 prices, or his first order message): not a second time. */
export async function orderFormAutoSent(env: Env, listDay: string, digits: string): Promise<boolean> {
  try { return !!(await env.MSG_DEDUP.get(autoKey(listDay, digits))); } catch { return false; }
}
async function markAutoSent(env: Env, listDay: string, digits: string): Promise<void> {
  try { await env.MSG_DEDUP.put(autoKey(listDay, digits), "1", { expirationTtl: TOKEN_TTL }); } catch { /* at worst a second form */ }
}

/** The customer's open order of the ordering day, and its quantities on the form's slots. */
async function openOrderInit(env: Env, partnerId: number, items: OrderFormItem[], now: number, orderId?: number): Promise<{ orderId: number; init: Record<number, number> } | null> {
  let id = orderId ?? 0;
  if (!id) {
    const rows = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
      domain: [["x_customer_id", "=", partnerId], ["x_state", "in", ["draft", "waiting_confirmation"]], "|", ["x_order_date", "=", nextOrderingDate(new Date(now))], ["x_awaiting_prices", "=", true]],
      fields: ["id"], order: "id desc", limit: 1,
    });
    id = rows[0]?.id ?? 0;
  }
  if (!id) return null;
  const order = await getOrderForInvoicing(env, id);
  if (!order) return null;
  const init: Record<number, number> = {};
  for (const l of order.lines) {
    const it = items.find((x) => x.productId === l.product_id && x.packagingId === l.packaging_id);
    if (it && l.quantity > 0) init[it.slot] = (init[it.slot] ?? 0) + l.quantity;
  }
  return { orderId: id, init };
}

/**
 * The form on the customer's open order (if he has one: opened with its
 * quantities). `auto`: a send the customer did not ask for — once per number
 * and list. Never throws.
 */
export async function offerOrderForm(
  env: Env,
  who: OrderFormWho,
  o: { now?: number; body?: string; cta?: string; auto?: boolean; orderId?: number; ctx?: ExecutionContext } = {},
): Promise<OrderFormResult> {
  const now = o.now ?? Date.now();
  try {
    const list = await validPriceList(env, now);
    if (!list) return { sent: false, reason: "no_list" };
    if (o.auto && (await orderFormAutoSent(env, list.day, who.whatsapp))) return { sent: false, reason: "sent_before" };
    const built = await orderFormItems(env, list);
    if (!built.items.length) return { sent: false, reason: "no_items" };
    const open = await openOrderInit(env, who.partnerId, built.items, now, o.orderId).catch(() => null);
    const r = await sendOrderForm(env, who, { now, list, items: built.items, pages: built.pages, body: o.body, cta: o.cta, ctx: o.ctx, ...(open ? { orderId: open.orderId, init: open.init } : {}) });
    if (r.sent && o.auto) await markAutoSent(env, list.day, who.whatsapp);
    return r;
  } catch (e) {
    console.warn("[order-form] the form could not be offered", (e as Error)?.message);
    return { sent: false, reason: "error" };
  }
}

/**
 * «اطلب» / «أبي أطلب» from a customer: the form, or — no valid list — the
 * «الأسعار تتحدث» text. True when he was answered (nothing else replies).
 */
export async function answerOrderFormAsk(env: Env, who: OrderFormWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  const r = await offerOrderForm(env, who, { now, ctx });
  if (r.sent) return true;
  if (r.reason !== "no_list" && r.reason !== "no_items") return false;
  await sendViaGateway(env, { purpose: "bot_reply", to: who.whatsapp, content: textContent(ORDER_FORM_NO_LIST_TEXT), ctx });
  return true;
}

/**
 * After the 06:00 publication: the form to every customer the list just reached
 * inside his window. `list` is the day just published. Returns how many went.
 * Never throws (the publication is done).
 */
export async function sendOrderFormsAfterPrices(env: Env, list: ValidList, recipients: OrderFormWho[], now: number = Date.now(), ctx?: ExecutionContext): Promise<number> {
  let sent = 0;
  try {
    const built = await orderFormItems(env, list);
    if (!built.items.length) return 0;
    for (const r of recipients) {
      try {
        if (await orderFormAutoSent(env, list.day, r.whatsapp)) continue;
        const out = await sendOrderForm(env, r, { now, list, items: built.items, pages: built.pages, body: ORDER_FORM_PRICES_TEXT, ctx });
        if (out.sent) { sent++; await markAutoSent(env, list.day, r.whatsapp); }
      } catch (e) {
        console.warn(`[order-form] the form after the prices failed for partner ${r.partnerId}`, (e as Error)?.message);
      }
    }
  } catch (e) {
    console.warn("[order-form] the forms after the prices failed", (e as Error)?.message);
  }
  return sent;
}

// ---------------------------------------------------------------- the reply

/** What a field holds: a quantity, nothing, or something that is not a quantity above zero. */
export function parseOrderQty(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  let s = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");
  if (s === "") return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return "invalid";
  const n = Math.round(Number(s) * 100) / 100;
  if (n === 0) return null; // «0» = none of it
  return n > 0 && n <= ORDER_QTY_MAX ? n : "invalid";
}

export interface OrderFormEntries {
  wanted: Array<{ item: OrderFormItem; quantity: number }>;
  empty: OrderFormItem[];
  invalid: OrderFormItem[];
}
/** Each slot's field against its item — the token's items, never the client's data. */
export function readOrderFormValues(rec: Pick<OrderFormRecord, "items">, values: Record<string, unknown>): OrderFormEntries {
  const out: OrderFormEntries = { wanted: [], empty: [], invalid: [] };
  for (const item of rec.items) {
    const v = parseOrderQty(values[`q${item.slot}`]);
    if (v === null) out.empty.push(item);
    else if (v === "invalid") out.invalid.push(item);
    else out.wanted.push({ item, quantity: v });
  }
  return out;
}

export interface OrderFormOutcome {
  action: "quoted" | "awaiting" | "review" | "below_minimum" | "need_location" | "empty" | "test" | "unknown" | "expired" | "duplicate" | "closed";
  orderId?: number;
}

/** The order's lines, as the form leaves them. Returns the order that carries them (a new one when a line had to go). */
async function applyOrderForm(env: Env, rec: OrderFormRecord, entries: OrderFormEntries, messageId: string, now: Date): Promise<{ orderId: number; replaced?: number } | { closed: number }> {
  let orderId = rec.orderId ?? 0;
  if (orderId) {
    const o = await getOrderBrief(env, orderId);
    // the order the form was opened on moved on (confirmed, cancelled): its lines are not touched
    if (!o || o.customerId !== rec.partnerId) orderId = 0;
    else if (o.state !== "draft" && o.state !== "waiting_confirmation") return { closed: orderId };
  }
  if (!orderId) orderId = (await findOrCreateTodayOrder(env, rec.partnerId, undefined, messageId, now)).id;
  const order = await getOrderForInvoicing(env, orderId);
  const lines = order?.lines ?? [];
  const lineOf = (it: OrderFormItem) => lines.filter((l) => l.product_id === it.productId && l.packaging_id === it.packagingId);
  // a field the form opened with a quantity and came back empty: that line goes
  const removed = entries.empty.filter((it) => (rec.init?.[it.slot] ?? 0) > 0 && lineOf(it).length > 0);
  const twice = entries.wanted.some((w) => lineOf(w.item).length > 1);
  if (removed.length || twice) {
    // nothing is deleted: the order is closed and its lines — the form's, and the ones the form does not show — start a new one
    const formKeys = new Set(rec.items.map((i) => `${i.productId}:${i.packagingId}`));
    const kept: LateItem[] = lines.filter((l) => !formKeys.has(`${l.product_id}:${l.packaging_id}`) && l.quantity > 0)
      .map((l) => ({ product_id: l.product_id, packaging_id: l.packaging_id, quantity: l.quantity, label: `${l.product_name} ${l.packaging_name} × ${l.quantity}` }));
    const untouched: LateItem[] = rec.items.filter((it) => !entries.wanted.some((w) => w.item.slot === it.slot) && !removed.includes(it) && !entries.empty.includes(it))
      .flatMap((it) => lineOf(it).map((l) => ({ product_id: l.product_id, packaging_id: l.packaging_id, quantity: l.quantity, label: it.name })));
    const wanted: LateItem[] = entries.wanted.map((w) => ({ product_id: w.item.productId, packaging_id: w.item.packagingId, quantity: w.quantity, label: `${w.item.name} × ${qty(w.quantity)}` }));
    // an untouched empty field that still has a line (the form never showed its quantity) keeps it
    const silent: LateItem[] = entries.empty.filter((it) => !removed.includes(it)).flatMap((it) => lineOf(it).map((l) => ({ product_id: l.product_id, packaging_id: l.packaging_id, quantity: l.quantity, label: it.name })));
    const items = [...kept, ...untouched, ...silent, ...wanted];
    if (!items.length) {
      await updateOrderState(env, orderId, "cancelled");
      return { closed: orderId };
    }
    const fresh = await createOrderWithLines(env, { customerId: rec.partnerId, date: nextOrderingDate(now), items, via: "whatsapp", state: "draft", sourceMessageId: messageId });
    await updateOrderState(env, orderId, "cancelled");
    return { orderId: fresh, replaced: orderId };
  }
  const add: Array<{ product_id: number; packaging_id: number; quantity: number; product_name_raw: string; notes: string }> = [];
  for (const w of entries.wanted) {
    const [line] = lineOf(w.item);
    if (!line) add.push({ product_id: w.item.productId, packaging_id: w.item.packagingId, quantity: w.quantity, product_name_raw: w.item.name, notes: "" });
    else if (Math.abs(line.quantity - w.quantity) > 0.0001) await call<boolean>(env, "x_daily_order_line", "write", { ids: [line.id], vals: { x_quantity: w.quantity } });
  }
  if (add.length) await addOrderLines(env, orderId, add as never);
  return { orderId };
}

const formOrderKey = (orderId: number): string => `oform_order:v1:${orderId}`;
/** This order's quotation was made by the form: its «تعديل» opens the form. */
export async function isFormOrder(env: Env, orderId: number): Promise<boolean> {
  try { return !!(await env.MSG_DEDUP.get(formOrderKey(orderId))); } catch { return false; }
}

/** A reply of the order form (nfm_reply): read, checked against its token, written as an order, quoted. */
export async function handleOrderFormReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<OrderFormOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (text: string) => { await sendViaGateway(env, { purpose: owner ? ORDER_FORM_TEST_PURPOSE : "bot_reply", to, content: textContent(text), ctx }); };
  const rec = await readOrderFormToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[order-form] reply with no token of this number from=${to.slice(-4)}`);
    await say(ORDER_FORM_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const who: OrderFormWho = { partnerId: rec.partnerId, name: rec.name, whatsapp: to };
  const entries = readOrderFormValues(rec, msg.flow?.values ?? {});
  const typed: Record<number, number> = Object.fromEntries(entries.wanted.map((w) => [w.item.slot, w.quantity]));
  if (rec.test) {
    const total = Math.round(entries.wanted.reduce((s, w) => s + w.item.price * w.quantity, 0) * 100) / 100;
    const body = entries.wanted.length
      ? `${ORDER_TEST_MARK} — وصل طلبك: ${entries.wanted.map((w) => `${w.item.name} × ${qty(w.quantity)}`).join("، ")}.${total > 0 ? ` المجموع ${money(total)} ر.س.` : ""}\n(تجربة: لم يُنشأ طلب، ولا عرض سعر)`
      : `${ORDER_TEST_MARK} — وصل النموذج بلا كميات.\n(تجربة: لم يُنشأ طلب)`;
    const again = await sendOrderForm(env, who, { now: nowMs, test: true, items: rec.items, pages: rec.pages, init: typed, body, cta: ORDER_FORM_EDIT_CTA, list: { dayId: 0, day: rec.listDay, publishedAtMs: null, validUntilMs: rec.validUntilMs }, ctx }).catch(() => ({ sent: false }));
    if (!again.sent) await say(body);
    return { action: "test" };
  }
  // its own list, still valid: a price is valid for one day (§ 49)
  const list = await listOfDayIfValid(env, rec.listDay, nowMs);
  if (!list) {
    console.warn(`[order-form] expired reply partner=${rec.partnerId} list=${rec.listDay} — nothing written`);
    const fresh = await validPriceList(env, nowMs).catch(() => null);
    const out = fresh ? await sendOrderForm(env, who, { now: nowMs, list: fresh, body: ORDER_FORM_EXPIRED_TEXT, ctx }).catch(() => ({ sent: false })) : { sent: false };
    if (!out.sent) await say(fresh ? ORDER_FORM_EXPIRED_TEXT.replace(" هذا نموذج بأسعار اليوم 👇", " اكتب «اطلب» ونرسل لك نموذج اليوم.") : ORDER_FORM_EXPIRED_NO_LIST_TEXT);
    return { action: "expired" };
  }
  // a token is read once
  const claim = await claimButton(env, `oform_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[order-form] repeated token partner=${rec.partnerId} — not written again`);
    await say(ORDER_FORM_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    if (!entries.wanted.length && !entries.empty.some((it) => (rec.init?.[it.slot] ?? 0) > 0)) {
      // nothing asked for: the token stays usable
      await releaseButton(env, claim);
      await say(entries.invalid.length ? `⚠️ الكمية رقم أكبر من صفر: ${entries.invalid.map((i) => i.label).join("، ")}. ${ORDER_FORM_EMPTY_TEXT}` : ORDER_FORM_EMPTY_TEXT);
      return { action: "empty" };
    }
    const now = new Date(nowMs);
    const applied = await applyOrderForm(env, rec, entries, msg.messageId, now);
    await writeOrderFormToken(env, { ...rec, usedAt: nowMs });
    await finishButton(env, claim, TOKEN_TTL);
    if ("closed" in applied) {
      await say(entries.wanted.length ? ORDER_FORM_CLOSED_TEXT(applied.closed) : `أُلغي طلبك رقم #${applied.closed}: ما بقي فيه صنف. نستناك المرة الجاية 🌿`);
      return { action: "closed", orderId: applied.closed };
    }
    const orderId = applied.orderId;
    try { await env.MSG_DEDUP.put(formOrderKey(orderId), rec.listDay, { expirationTtl: 3 * 24 * 3600 }); } catch { /* «تعديل» then answers in text */ }
    const q = await quoteOrder(env, { orderId, partnerId: rec.partnerId, now });
    const notes = [
      applied.replaced ? `عدّلنا طلبك: الطلب رقم #${applied.replaced} أُغلق، وهذا طلبك رقم #${orderId}.` : "",
      entries.invalid.length ? `⚠️ ما انحسبت (الكمية رقم أكبر من صفر): ${entries.invalid.map((i) => i.label).join("، ")}.` : "",
    ].filter(Boolean);
    if (q.kind === "quoted") {
      const order = await getOrderForInvoicing(env, orderId);
      const lines = order?.lines ?? [];
      const price = (l: { unit_price: number | null; price_unit_manual?: number | null }) => ((l.price_unit_manual ?? 0) > 0 ? (l.price_unit_manual as number) : l.unit_price ?? 0);
      const total = Math.round(lines.reduce((s, l) => s + Math.round(price(l) * l.quantity * 100) / 100, 0) * 100) / 100;
      const body = [
        ...notes,
        `📄 عرض السعر رقم ${q.number} لطلبك رقم #${orderId}، بأسعار ${dayLabel(q.list.day)}:`,
        ...lines.map((l) => `• ${l.product_name} ${l.packaging_name} × ${qty(l.quantity)} = ${money(Math.round(price(l) * l.quantity * 100) / 100)} ر.س`),
        `المجموع: ${money(total)} ر.س`,
        "",
        ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE, "راجع الأصناف واختر:"].filter(Boolean),
      ].join("\n");
      await sendViaGateway(env, { purpose: QUOTATION_PURPOSE, to, content: buttonsContent(body, quotationButtons(orderId)), ctx });
      console.log(`[order-form] partner=${rec.partnerId} order=${orderId} quoted ${q.number} (${lines.length} lines)`);
      return { action: "quoted", orderId };
    }
    const tail = q.kind === "awaiting" ? ["استلمنا طلبك ✅ الأسعار تتحدث، ونرسل لك عرض السعر أول ما تنتشر أسعار اليوم."]
      : q.kind === "need_location" ? [`سجّلنا طلبك رقم #${orderId} ✅`, ...LOCATION_ASK_LINES] : [q.text];
    await say([...notes, ...tail].join("\n"));
    return { action: q.kind, orderId };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- «تعديل» on a quotation made by the form

/**
 * «تعديل ✏️» under a quotation the form made: the form again, opened with the
 * order's quantities. False when it cannot go (no valid list, the window, any
 * failure): the caller answers as before § 53.
 */
export async function reopenOrderForm(env: Env, orderId: number, who: OrderFormWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  if (!(await isFormOrder(env, orderId))) return false;
  const r = await offerOrderForm(env, who, { now, orderId, body: orderFormEditText(orderId), cta: ORDER_FORM_EDIT_CTA, ctx });
  return r.sent;
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE order form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. The valid list; with none (or one
 * without an item), the last real day's lines as they stand — each at what it
 * would sell for, or «بلا سعر منشور» — so the form is seen before the first
 * publication. His reply is answered and creates no order.
 */
export async function sendOrderFormTest(env: Env, now: number = Date.now()): Promise<OrderFormResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `oform_test:${ORDER_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    let list = await validPriceList(env, now);
    let built = list ? await orderFormItems(env, list) : null;
    if (!list || !built?.items.length) {
      // no valid list with an item tonight: the last real day's lines show the form (a trial creates no order)
      const [last] = await call<Array<{ id: number; x_date: string }>>(env, "x_price_day", "search_read", {
        domain: [[SIM_FIELD, "!=", true]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1,
      });
      list = last ? { dayId: last.id, day: last.x_date, publishedAtMs: null, validUntilMs: now + 60 * 60_000 } : null;
      built = list ? await orderFormItems(env, list, true) : null;
    }
    if (!list || !built) { await releaseButton(env, claim); return { sent: false, reason: "no_list" }; }
    const r = await sendOrderForm(env, { partnerId: 0, name: "براء", whatsapp: owner }, { now, list, test: true, items: built.items, pages: built.pages });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
