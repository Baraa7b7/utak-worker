// § 59 ج (2026-10-06) — the customer sees what is available today, with its prices.
//
//   [ج1] the order form's message («اطلب الآن») names the available items and their prices — up to
//        ten, then «+N صنف داخل النموذج» — inside Meta's cap: in answer to «اطلب», after the first
//        order message of the day, with the 06:00 list
//   [ج2] an item asked for by text that the valid list does not hold — a line left out, an exception
//        without a decision, no line at all, an item switched off, one we do not sell: «هذا الصنف غير
//        متوفر اليوم 🌿 المتوفر اليوم:» with the list and the form. Never the suggested price, never
//        «نراجع السعر», never a line of the order
//   [ج3] the quotation of the text path — «خلاص», the order's own message, the order that waited for
//        the publication — is the form's, to the letter: a line an item with its amount, and the total
//   [ج4] the welcome of a new customer: a text inside his window, not utak_welcome
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s59-available.test.mts

import { readFileSync } from "node:fs";
import { CUST2, CUST2_PHONE, ctx, graph, heldFor, inbound, openWindow, partnerOf, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { C1, C1_PHONE, DAY, assert, cost, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const OF = await import("../src/order-form.ts");
const FLOW = await import("../src/order-flow.ts");
const PR = await import("../src/prices.ts");
const PV = await import("../src/price-validity.ts");
const TPL = await import("../src/templates.ts");
const { dispatch } = await import("../src/router.ts");
const worker = (await import("../src/index.ts")).default;

const NEXT = "2026-10-04";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const ordersOf = (customer = C1) => rows("x_daily_order").filter((o: any) => o.x_customer_id === customer) as any[];
const linesOf = (orderId: number) => rows("x_daily_order_line").filter((l: any) => l.x_order_id === orderId) as any[];
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
let mid = 0;
const orderText = (env: any, t: string, items: unknown, intent = "place_order") => quiet(async () => {
  setExtract(items);
  try { return await dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: `m${++mid}`, type: "text", text: t, timestamp: "0" } as any, intent: intent as any, senderType: "customer", partner: partnerOf(C1) as any }); } finally { setExtract(null); }
});
/** A customer's order message through the webhook (the reply and what follows it are sent). */
const orderSay = async (env: any, t: string, items: unknown) => {
  const real = globalThis.fetch;
  let call = 0;
  // the classifier answers «place_order», then the extractor the items
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("anthropic.com")) {
      const out = call++ % 2 === 0 ? { intent: "place_order", confidence: 0.95 } : items;
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 });
    }
    return real(input as any, init);
  }) as typeof fetch;
  try { await say(env, C1_PHONE, text(t)); } finally { globalThis.fetch = real; }
};
const khalas = (env: any) => quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: `k${++mid}`, type: "text", text: "خلاص", timestamp: "0" } as any, intent: "request_quotation" as any, senderType: "customer", partner: partnerOf(C1) as any }));
const c1 = { partnerId: C1, name: "مطعم الوادي", whatsapp: "+" + C1_PHONE };
const TOMATO = { product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 };
const CUCUMBER = { product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 };
const POTATO = { product_id: 3, product_name_raw: "بطاطس", packaging_id: 31, quantity: 4 };
const ONION = { product_id: 4, product_name_raw: "بصل", packaging_id: 41, quantity: 1 };

/** The tenant's world: no minimum order, the customer's district known, his window open. */
function world(riyadh: string): any {
  const env = fresh(riyadh); cost(500); setExtract(null);
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 6;
  table("product.template").get(1)!.name = "[UTAK-VEG-001] طماطم";
  table("x_product_packaging").get(11)!.x_name = "كرتون · 14 كيلو";
  openWindow(env, C1_PHONE);
  return env;
}
/**
 * A published day: tomato 31 and cucumber 28.5 published; potato LEFT OUT (its suggested price 22.5 and
 * a market price 17.17 still on its line); onion an exception without a decision (suggested 16.5).
 */
function published(day = DAY, at = `${day} 06:00`): number {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_published_at: utc(at) });
  const line = (seq: number, p: number, k: number, v: Record<string, unknown>) => seed("x_price_day_line", { x_day_id: d, x_sequence: seq, x_product_tmpl_id: p, x_packaging_id: k, x_blocked: false, x_utak_simulation: false, x_manual_price: 0, ...v });
  line(1, 1, 11, { x_cost_price: 15, x_market_price: 31, x_sale_price: 31, x_suggested_price: 20, x_status: "auto", x_excluded: false });
  line(2, 2, 21, { x_cost_price: 14, x_market_price: 28.5, x_sale_price: 28.5, x_suggested_price: 19, x_status: "auto", x_excluded: false });
  line(3, 3, 31, { x_cost_price: 15.55, x_market_price: 17.17, x_sale_price: 0, x_suggested_price: 22.5, x_status: "unpublished", x_excluded: true });
  line(4, 4, 41, { x_cost_price: 9.99, x_market_price: 0, x_sale_price: 0, x_suggested_price: 16.5, x_status: "exception", x_excluded: false });
  return d;
}
/** `n` more published items at `price`. */
function more(d: number, n: number, from: number, price = 10, name = (id: number) => `صنف ${id}`): void {
  for (let i = 0; i < n; i++) {
    const id = from + i;
    seed("product.template", { id, name: name(id), sale_ok: true, x_is_active_for_sale: true, categ_id: 6 });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
    seed("x_price_day_line", { x_day_id: d, x_sequence: 100 + i, x_product_tmpl_id: id, x_packaging_id: id * 10 + 1, x_cost_price: 5, x_market_price: price, x_sale_price: price, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 8, x_manual_price: 0, x_utak_simulation: false });
  }
}
const AVAILABLE = "المتوفر اليوم:\n• طماطم (كرتون · 14 كيلو): 31 ر.س\n• خيار (جرم): 28.50 ر.س";
/** No number of the day that is not a published sale price may reach a customer. */
const SECRET = ["22.5", "22.50", "17.17", "16.5", "16.50", "15.55", "9.99"];
const leaks = (s: string) => SECRET.filter((n) => s.includes(n));
const everythingTo = (d: string) => sentTo(d).map((b) => JSON.stringify(b)).join("\n");

// ================================================================ ج1 — the form's message
console.log("\n[ج1] «اطلب الآن»: the message names what is available today with its prices");
{
  const items = [{ productName: "[UTAK-FRT-002] موز أمريكي", packagingName: "كرتون · 14 كيلو", price: 70 }, { productName: "رمان وسط", packagingName: "كرتون", price: 20.5 }];
  assert("a line: «• موز أمريكي (كرتون · 14 كيلو): 70 ر.س» — the name without its code, the packaging, the sale price", OF.availableLine(items[0]) === "• موز أمريكي (كرتون · 14 كيلو): 70 ر.س" && OF.availableLine(items[1]) === "• رمان وسط (كرتون): 20.50 ر.س");
  assert("the block: the heading, the lines, nothing after them when every item is named", OF.availableBlock(items) === "المتوفر اليوم:\n• موز أمريكي (كرتون · 14 كيلو): 70 ر.س\n• رمان وسط (كرتون): 20.50 ر.س");
  const many = Array.from({ length: 23 }, (_, i) => ({ productName: `صنف ${i + 1}`, packagingName: "كرتون", price: 10 + i }));
  const block = OF.availableBlock(many);
  assert("more than ten: the first ten, then «+13 صنف داخل النموذج»", block.split("\n").length === 12 && block.split("\n")[10] === "• صنف 10 (كرتون): 19 ر.س" && block.endsWith("\n+13 صنف داخل النموذج"), block);
  assert("exactly ten: no «+N» line; none: no block", !OF.availableBlock(many.slice(0, 10)).includes("داخل النموذج") && OF.availableBlock([]) === "");
  // Meta's cap: an item is never cut — what does not fit is counted in «+N»
  const long = Array.from({ length: 12 }, (_, i) => ({ productName: `صنف باسم طويل جداً لا ينتهي أبداً ويتكرر ويتكرر ويتكرر ويتكرر ويتكرر ويتكرر حتى يملأ السطر رقم ${i + 1}`, packagingName: "كرتون · 10 كيلو", price: 100 + i }));
  const body = OF.orderFormBody(OF.ORDER_FORM_PRICES_TEXT, long);
  const shown = body.split("\n").filter((l) => l.startsWith("• ")).length;
  assert("long names: the body stays within 1024 characters, whole lines only, the rest counted", [...body].length <= OF.ORDER_BODY_MAX && shown >= 1 && shown < 10 && body.endsWith(`+${12 - shown} صنف داخل النموذج`) && body.split("\n").filter((l) => l.startsWith("• ")).every((l) => l.endsWith("ر.س")), `${[...body].length} / ${shown}`);
  assert("a text that leaves no room for a line: the text alone, never a cut one", OF.orderFormBody("ن".repeat(1010), long) === "ن".repeat(1010));
}
{
  // in answer to «اطلب»
  let env = world(`${DAY} 10:00`); published();
  await say(env, C1_PHONE, text("اطلب"));
  let f = flowsTo(C1_PHONE);
  assert("«اطلب»: ONE form whose message is the ask, an empty line, then the available items with their prices", f.length === 1 && bodyOf(f[0]) === `${OF.orderFormAskText("مطعم الوادي")}\n\n${AVAILABLE}` && par(f[0]).flow_cta === OF.ORDER_FORM_CTA, bodyOf(f[0]));
  assert("…the unpublished ones are not in it, nor any number that is not a published sale price", !bodyOf(f[0]).includes("بطاطس") && !bodyOf(f[0]).includes("بصل") && leaks(everythingTo(C1_PHONE)).length === 0, leaks(everythingTo(C1_PHONE)).join(","));
  // after his first order message of the day
  env = world(`${DAY} 10:00`); published();
  await orderSay(env, "طماطم كرتون 3", [TOMATO]);
  f = flowsTo(C1_PHONE);
  assert("after his first order message: the form's message is the follow text, then the available items", f.length === 1 && bodyOf(f[0]) === `${OF.ORDER_FORM_FOLLOW_TEXT}\n\n${AVAILABLE}` && dataOf(f[0]).i1 === "3", bodyOf(f[0]));
  // with the 06:00 list
  env = world(`${DAY} 06:00`);
  const d = seed("x_price_day", { x_date: DAY, x_state: "approved", x_name: `أسعار اليوم ${DAY}`, x_utak_simulation: false, x_approved_at: utc(`${DAY} 05:59`) });
  for (const [p, k, price] of [[1, 11, 31], [2, 21, 28.5]] as Array<[number, number, number]>) seed("x_price_day_line", { x_day_id: d, x_sequence: p, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: 15, x_market_price: price, x_sale_price: price, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 20, x_manual_price: 0, x_utak_simulation: false });
  await quiet(() => PR.publishPriceDay(env, d));
  f = flowsTo(C1_PHONE);
  assert("with the 06:00 list: the form's message carries them too", f.length === 1 && bodyOf(f[0]) === `${OF.ORDER_FORM_PRICES_TEXT}\n\n${AVAILABLE}`, bodyOf(f[0]));
  // more than ten published
  env = world(`${DAY} 10:00`); more(published(), 13, 50);
  await say(env, C1_PHONE, text("اطلب"));
  f = flowsTo(C1_PHONE);
  const lines = bodyOf(f[0]).split("\n");
  assert("fifteen published: ten named, then «+5 صنف داخل النموذج» — and the form holds all fifteen", lines.filter((l) => l.startsWith("• ")).length === 10 && lines.at(-1) === "+5 صنف داخل النموذج" && [...bodyOf(f[0])].length <= 1024 && Object.keys(dataOf(f[0])).filter((k) => /^l\d+$/.test(k) && dataOf(f[0])[k] !== "-").length === 15, bodyOf(f[0]));
  // «عدّل الطلب» keeps its own text alone
  env = world(`${DAY} 10:00`); published();
  await say(env, C1_PHONE, text("اطلب"));
  const r = await quiet(() => OF.handleOrderFormReply(env, { from: "+" + C1_PHONE, messageId: "wamid.F1", flow: { token: tokenOf(flowsTo(C1_PHONE)[0]), values: { q1: "2" } } }));
  graph.length = 0;
  await quiet(() => OF.reopenOrderForm(env, r.orderId!, c1));
  f = flowsTo(C1_PHONE);
  assert("«عدّل الطلب»: its own text alone (he has seen the order priced)", f.length === 1 && bodyOf(f[0]) === OF.orderFormEditText(r.orderId!) && !bodyOf(f[0]).includes(OF.AVAILABLE_TITLE), bodyOf(f[0]));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ج2 — not available today
console.log("\n[ج2] an item the valid list does not hold: «هذا الصنف غير متوفر اليوم 🌿 المتوفر اليوم:» and the form");
{
  assert("the wording: alone → Baraa's; among others → named; a word the catalog does not know is never echoed", OF.unavailableText(["بطاطس"], true) === "هذا الصنف غير متوفر اليوم 🌿" && OF.unavailableText(["[UTAK-1] بطاطس"], false) === "بطاطس غير متوفر اليوم 🌿" && OF.unavailableText(["بطاطس", "بصل", "بطاطس"], false) === "غير متوفر اليوم: بطاطس، بصل 🌿" && OF.unavailableText([], false) === OF.UNAVAILABLE_TEXT);
  const UNAVAILABLE_FORM = `هذا الصنف غير متوفر اليوم 🌿\n\n${AVAILABLE}`;
  for (const [label, item] of [["a line left out of the publication (its suggested price 22.5 on it)", POTATO], ["an exception without a decision", ONION]] as const) {
    const env = world(`${DAY} 10:00`); published();
    await orderSay(env, `${item.product_name_raw} ${item.quantity}`, [item]);
    const got = sentTo(C1_PHONE);
    assert(`${label}: ONE message — the form under «هذا الصنف غير متوفر اليوم 🌿», then «المتوفر اليوم:» with its prices`, got.length === 1 && got[0]?.interactive?.type === "flow" && bodyOf(got[0]) === UNAVAILABLE_FORM && par(got[0]).flow_cta === OF.ORDER_FORM_CTA, everythingTo(C1_PHONE).slice(0, 600));
    assert(`${label}: no order, no line, no quotation`, ordersOf().length === 0 && rows("x_daily_order_line").length === 0 && rows("x_quotation").length === 0);
    assert(`${label}: never its suggested price, never «نراجع السعر», and Baraa gets no «عرض سعر لم يُرسل»`, leaks(everythingTo(C1_PHONE)).length === 0 && !everythingTo(C1_PHONE).includes("نراجع السعر") && !ownerTexts().some((t) => t.includes("عرض سعر لم يُرسل")), leaks(everythingTo(C1_PHONE)).join(","));
  }
  {
    // an item with no line at all in the day
    const env = world(`${DAY} 10:00`); published();
    seed("product.template", { id: 9, name: "جزر", sale_ok: true, x_is_active_for_sale: true, categ_id: 6 });
    seed("x_product_packaging", { id: 91, x_name: "كيس", x_product_tmpl_id: 9, x_is_default: true });
    env.MSG_DEDUP.store.delete("catalog:v2");
    await orderSay(env, "جزر 2", [{ product_id: 9, product_name_raw: "جزر", packaging_id: 91, quantity: 2 }]);
    assert("an item with no line at all in the day: the same message, no order", flowsTo(C1_PHONE).length === 1 && bodyOf(flowsTo(C1_PHONE)[0]) === UNAVAILABLE_FORM && ordersOf().length === 0, everythingTo(C1_PHONE).slice(0, 400));
  }
  {
    // an item we do not sell at all, and one switched off
    const env = world(`${DAY} 10:00`); published();
    await orderSay(env, "أناناس 2", [{ product_id: 0, product_name_raw: "أناناس", packaging_id: 0, quantity: 2 }]);
    assert("an item we do not sell: the same message — and its word is not echoed back", flowsTo(C1_PHONE).length === 1 && bodyOf(flowsTo(C1_PHONE)[0]) === UNAVAILABLE_FORM && !everythingTo(C1_PHONE).includes("أناناس") && ordersOf().length === 0, everythingTo(C1_PHONE).slice(0, 400));
  }
  {
    // the form went by itself earlier that day: the unavailable answer still goes (it is not «once a list»)
    const env = world(`${DAY} 10:00`); published();
    await orderSay(env, "طماطم كرتون 3", [TOMATO]);
    assert("(his first order message brought the form once)", flowsTo(C1_PHONE).length === 1);
    graph.length = 0;
    await orderSay(env, "بطاطس 4", [POTATO]);
    const f = flowsTo(C1_PHONE);
    assert("later the same day he asks for what is not there: the form again, under the unavailable text — opened with his 3 cartons", f.length === 1 && bodyOf(f[0]).startsWith("هذا الصنف غير متوفر اليوم 🌿\n\nالمتوفر اليوم:") && dataOf(f[0]).i1 === "3" && linesOf(ordersOf()[0].id).length === 1, everythingTo(C1_PHONE).slice(0, 400));
  }
  {
    // some available, some not: the available ones are his order; the others are named after it
    const env = world(`${DAY} 10:00`); published();
    await orderSay(env, "طماطم كرتون 3 وبطاطس 4 وبصل 1", [TOMATO, POTATO, ONION]);
    const got = sentTo(C1_PHONE);
    const o = ordersOf()[0];
    assert("mixed: the reply of before for what was added — the tomato alone", got.length === 2 && /بديت لك طلب جديد ✅/.test(bodyOf(got[0])) && bodyOf(got[0]).includes("• طماطم كرتون × 3") && !bodyOf(got[0]).includes("بطاطس") && !bodyOf(got[0]).includes("بعض الأصناف مو متوفرة"), bodyOf(got[0]));
    assert("mixed: the order holds the available item alone", linesOf(o.id).length === 1 && linesOf(o.id)[0].x_product_tmpl_id === 1);
    assert("mixed: then the form under «غير متوفر اليوم: بطاطس، بصل 🌿» and the available items — his 3 cartons in it", got[1]?.interactive?.type === "flow" && bodyOf(got[1]) === `غير متوفر اليوم: بطاطس، بصل 🌿\n\n${AVAILABLE}` && dataOf(got[1]).i1 === "3", bodyOf(got[1]));
    assert("mixed: no suggested price anywhere", leaks(everythingTo(C1_PHONE)).length === 0);
  }
  {
    // mixed with «خلاص» in the same message: the quotation of what is available, then the form
    const env = world(`${DAY} 10:00`); published();
    await orderSay(env, "طماطم كرتون 3 وبطاطس 4 خلاص", [TOMATO, POTATO]);
    const got = sentTo(C1_PHONE);
    assert("mixed with «خلاص»: the quotation of the tomato (93 ر.س) with its buttons, then the form under «بطاطس غير متوفر اليوم 🌿»", got.length === 2 && got[0]?.interactive?.type === "button" && bodyOf(got[0]).includes("• طماطم كرتون · 14 كيلو × 3 = 93 ر.س") && bodyOf(got[0]).includes("المجموع: 93 ر.س") && got[1]?.interactive?.type === "flow" && bodyOf(got[1]).startsWith("بطاطس غير متوفر اليوم 🌿\n\nالمتوفر اليوم:"), everythingTo(C1_PHONE).slice(0, 700));
  }
  {
    // no valid list: as before § 59 — the order is kept for the day's prices, everything in it
    const env = world(`${DAY} 06:30`);
    await orderSay(env, "بطاطس 4", [POTATO]);
    const o = ordersOf()[0];
    assert("no valid list: nothing is «غير متوفر» — the order is kept for the day's prices, as before", !!o && o.x_awaiting_prices === true && linesOf(o.id).length === 1 && textsTo(C1_PHONE).some((t) => t.includes(FLOW.AWAITING_TEXT)) && !everythingTo(C1_PHONE).includes("غير متوفر اليوم"), everythingTo(C1_PHONE).slice(0, 300));
    // …the list comes without it: he is told then, with what is available — never «نراجع السعر»
    setRiyadh(`${DAY} 09:00`);
    published(DAY, `${DAY} 09:00`);
    graph.length = 0;
    const out = await quiet(() => FLOW.quoteAwaitingOrders(env, Date.now()));
    const told = textsTo(C1_PHONE);
    assert("…the list comes without it: «هذا الصنف غير متوفر اليوم 🌿» and «المتوفر اليوم:» with the prices, the order closed", out[0]?.action === "unavailable" && told.length === 1 && told[0] === `هذا الصنف غير متوفر اليوم 🌿\n${AVAILABLE}` && table("x_daily_order").get(o.id)!.x_state === "cancelled" && linesOf(o.id)[0].x_status === "unavailable" && rows("x_quotation").length === 0, JSON.stringify([out, told]));
    assert("…never its suggested price (22.5)", leaks(everythingTo(C1_PHONE)).length === 0);
  }
  {
    // the price of an item in a list: its published line, or none
    const env = world(`${DAY} 10:00`); const d = published();
    const list = (await PV.validPriceList(env))!;
    assert("listPrice: the published line's price; a line left out, an exception, no line — none (never the suggested price)", list.dayId === d && (await PV.listPrice(env, list, 1, 11)).price === 31 && JSON.stringify(await PV.listPrice(env, list, 3, 31)) === JSON.stringify({ price: 0, source: "missing" }) && (await PV.listPrice(env, list, 4, 41)).price === 0 && (await PV.listPrice(env, list, 99, 991)).source === "missing");
  }
  {
    // the form cannot go (no item published at all): the same words as text
    const env = world(`${DAY} 10:00`);
    const d = seed("x_price_day", { x_date: DAY, x_state: "published", x_name: "أسعار", x_utak_simulation: false, x_published_at: utc(`${DAY} 06:00`) });
    void d;
    await orderSay(env, "بطاطس 4", [POTATO]);
    assert("a published day with no item: «هذا الصنف غير متوفر اليوم 🌿» as text, no form, no order", textsTo(C1_PHONE).length === 1 && textsTo(C1_PHONE)[0] === OF.UNAVAILABLE_TEXT && flowsTo(C1_PHONE).length === 0 && ordersOf().length === 0, everythingTo(C1_PHONE).slice(0, 300));
  }
  {
    // a line that left the order before any quotation priced it never enters the sale order
    const src = readFileSync(new URL("../src/sale-accounting.ts", import.meta.url), "utf8");
    assert("the sale order skips a line marked unavailable that carries no price (and keeps one short at the delivery, priced)", src.includes('if (r.x_status === "unavailable" && !unit) continue;') && /fields: \["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price", "x_status", "x_special_price", "x_pack_text"\]/.test(src));
  }
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ج3 — the quotation of the text path
console.log("\n[ج3] the text path's quotation is the form's, to the letter");
{
  const stripNumber = (s: string) => s.replace(/عرض السعر رقم \S+ لطلبك رقم #\d+/, "عرض السعر رقم N لطلبك رقم #O");
  // the form's own quotation of «3 tomato + 2 cucumber»
  let env = world(`${DAY} 10:00`); published();
  await say(env, C1_PHONE, text("اطلب"));
  await quiet(() => OF.handleOrderFormReply(env, { from: "+" + C1_PHONE, messageId: "wamid.Q1", flow: { token: tokenOf(flowsTo(C1_PHONE)[0]), values: { q1: "3", q2: "2" } } }));
  const formQuote = bodyOf(sentTo(C1_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1));
  assert("(the form's quotation: a line an item with its amount, the total)", formQuote.includes("• طماطم كرتون · 14 كيلو × 3 = 93 ر.س") && formQuote.includes("• خيار جرم × 2 = 57 ر.س") && formQuote.includes("المجموع: 150 ر.س"), formQuote);

  // «خلاص» after a text order of the same items
  env = world(`${DAY} 10:00`); published();
  await orderText(env, "طماطم كرتون 3 وخيار جرم 2", [TOMATO, CUCUMBER]);
  const k = await khalas(env);
  assert("«خلاص»: the same body as the form's, to the letter (the numbers of the quotation and the order aside)", stripNumber(String(k.bodyBeforeButtons)) === stripNumber(formQuote) && (k.buttons ?? []).length === 3, String(k.bodyBeforeButtons));
  assert("…each line «• الصنف التعبئة × الكمية = المبلغ ر.س», and «المجموع: 150 ر.س»", String(k.bodyBeforeButtons).split("\n").filter((l) => /^• .+ × \d+ = [\d.]+ ر\.س$/.test(l)).length === 2 && String(k.bodyBeforeButtons).includes("\nالمجموع: 150 ر.س\n"));

  // «… خلاص» in the order's own message
  env = world(`${DAY} 10:00`); published();
  const inline = await orderText(env, "طماطم كرتون 3 وخيار جرم 2 خلاص", [TOMATO, CUCUMBER]);
  const ib = String(inline.bodyBeforeButtons);
  assert("the order's own message with «خلاص»: «بديت لك طلب جديد ✅», then the same body", ib.startsWith("بديت لك طلب جديد ✅\n") && stripNumber(ib.slice("بديت لك طلب جديد ✅\n".length)) === stripNumber(formQuote) && (inline.buttons ?? []).length === 3, ib);

  // the order that waited for the publication
  env = world(`${DAY} 06:30`);
  await orderText(env, "طماطم كرتون 3 وخيار جرم 2", [TOMATO, CUCUMBER]);
  setRiyadh(`${DAY} 09:00`); published(DAY, `${DAY} 09:00`);
  graph.length = 0;
  const out = await quiet(() => FLOW.quoteAwaitingOrders(env, Date.now()));
  const wq = sentTo(C1_PHONE).filter((b: any) => b?.interactive?.type === "button");
  assert("the order that waited for the prices: the same body, with its three buttons", out[0]?.action === "quoted" && wq.length === 1 && stripNumber(bodyOf(wq[0])) === stripNumber(formQuote), bodyOf(wq[0]));

  // a new quotation after the list expired: the same lines and total under its reason
  env = world(`${DAY} 10:00`); published();
  await orderText(env, "طماطم كرتون 3", [TOMATO]);
  await khalas(env);
  const o = ordersOf()[0];
  setRiyadh(`${NEXT} 07:00`);
  const d2 = published(NEXT, `${NEXT} 06:00`);
  (rows("x_price_day_line").find((l: any) => l.x_day_id === d2 && l.x_product_tmpl_id === 1) as any).x_sale_price = 35;
  (rows("x_price_day_line").find((l: any) => l.x_day_id === d2 && l.x_product_tmpl_id === 1) as any).x_market_price = 35;
  const re = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, fromRaw: C1_PHONE, profileName: "", messageId: "t-re", type: "button", buttonId: `confirm_order_${o.id}`, text: "", timestamp: "0" } as any, intent: "other" as any, senderType: "customer", partner: partnerOf(C1) as any }));
  const rb = String(re.bodyBeforeButtons ?? "");
  assert("«تأكيد» the next morning (the list expired, the day passed): the reason, then the new quotation with its line at today's price (105) and its total", rb.startsWith("طلبك ما تأكد قبل الساعة 9:00 مساءً، وهذا عرض السعر بيوم التوصيل الجديد:\n📄 عرض السعر رقم") && rb.includes("• طماطم كرتون · 14 كيلو × 3 = 105 ر.س") && rb.includes("المجموع: 105 ر.س") && (re.buttons ?? []).length === 3, rb);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ج4 — the welcome
console.log("\n[ج4] the welcome of a new customer: a text inside his window");
{
  assert("the text, Baraa's wording", TPL.welcomeText("أبو خالد") === "أهلاً أبو خالد، تم تفعيل حسابك في يو تاك 🌿 تقدر تطلب من هنا في أي وقت: اكتب «اطلب» ويوصلك نموذج فيه أصناف اليوم وأسعارها.");
  assert("no name on his profile: «أهلاً بك»", TPL.welcomeText("").startsWith("أهلاً بك، تم تفعيل حسابك") && TPL.welcomeText("  ").startsWith("أهلاً بك،"));
  assert("it says nothing of a last hour to order (§ 49: orders at every hour)", !/آخر موعد|9:00|مساءً/.test(TPL.welcomeText("x")));
  const env = world(`${DAY} 10:00`); published();
  seed("x_whatsapp_template", { x_purpose: "customer_welcome", x_meta_template_id: "utak_welcome", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  const NEW = "966500000777";
  const before = rows("res.partner").length;
  await quiet(() => worker.fetch(signed({ entry: [{ changes: [{ value: { contacts: [{ wa_id: NEW, profile: { name: "مطعم الريف" } }], messages: [{ id: "wamid.NEW1", from: NEW, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "السلام عليكم" } }] } }] }] }), env, ctx));
  const got = sentTo(NEW);
  assert("a new number's first message: a partner, and the welcome as TEXT with his name — first", rows("res.partner").length === before + 1 && got[0]?.type === "text" && String(got[0]?.text?.body) === TPL.welcomeText("مطعم الريف"), JSON.stringify(got.map((b: any) => b.template?.name ?? b.text?.body)).slice(0, 400));
  assert("utak_welcome is sent no more (its row stays in Odoo)", !sentTo(NEW).some((b: any) => b?.type === "template") && rows("x_whatsapp_template").some((t: any) => t.x_meta_template_id === "utak_welcome"));
  graph.length = 0;
  await quiet(() => worker.fetch(signed({ entry: [{ changes: [{ value: { contacts: [{ wa_id: NEW, profile: { name: "مطعم الريف" } }], messages: [{ id: "wamid.NEW2", from: NEW, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "مرحبا" } }] } }] }] }), env, ctx));
  assert("his second message: no second welcome", !sentTo(NEW).some((b: any) => String(b?.text?.body ?? "").includes("تم تفعيل حسابك")));
  graph.length = 0;
  await say(env, CUST2_PHONE, text("السلام عليكم"));
  assert("a customer we know: no welcome", !sentTo(CUST2_PHONE).some((b: any) => String(b?.text?.body ?? "").includes("تم تفعيل حسابك")));
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert("the webhook names the welcome template nowhere", !src.includes("T.CUSTOMER_WELCOME"));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

void [CUST2, heldFor];
done();
