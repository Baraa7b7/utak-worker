// § 60 ج (2026-10-06) — «طلبوا وما كان متوفر»: every «هذا الصنف غير متوفر اليوم» leaves a light row.
//
//   [1] the rows of one answer, the count by item and the summary's line (pure)
//   [2] the order's intake: an item not published, one switched off, one we do not sell — a row each,
//       with the day, the customer, his own words, the catalog's item and the quantity; nothing when no
//       list is valid; Baraa is told nothing at once
//   [3] a line of an order kept from before the list leaves the order: one row, once
//   [4] a row that cannot be written never stops the answer
//   [5] what the 21:30 summary and «🎯 الفرص» read: the real rows of the days asked for, by item — a
//       simulation's row never (the summary's own line: tests/s60-summary.test.mts)
//   [6] the fields are the tenant's (scripts/lib/s60-odoo.mjs, the schema fixture)
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-unavailable.test.mts

import { readFileSync } from "node:fs";
import { CUST2, ctx, inbound, openWindow, partnerOf, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { C1, C1_PHONE, DAY, assert, cost, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const UL = await import("../src/unavailable-log.ts");
const FLOW = await import("../src/order-flow.ts");
const PV = await import("../src/price-validity.ts");
const { dispatch } = await import("../src/router.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const OD = await import("../scripts/lib/s60-odoo.mjs");

const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const asks = () => rows(UL.REQUEST_MODEL) as any[];
const ordersOf = (customer = C1) => rows("x_daily_order").filter((o: any) => o.x_customer_id === customer) as any[];
/** A customer's order message through the webhook: the classifier answers «place_order», then the extractor the items. */
const orderSay = async (env: any, t: string, items: unknown) => {
  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("anthropic.com")) {
      const out = call++ % 2 === 0 ? { intent: "place_order", confidence: 0.95 } : items;
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 });
    }
    return real(input as any, init);
  }) as typeof fetch;
  try { await say(env, C1_PHONE, { type: "text", text: { body: t } }); } finally { globalThis.fetch = real; }
};
const TOMATO = { product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 };
const POTATO = { product_id: 3, product_name_raw: "بطاطا حلوة", packaging_id: 31, quantity: 4 };
const ONION = { product_id: 4, product_name_raw: "بصل", packaging_id: 41, quantity: 1 };

function world(riyadh: string): any {
  const env = fresh(riyadh); cost(500); setExtract(null);
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 6;
  table("product.template").get(3)!.name = "[UTAK-VEG-003] بطاطس";
  openWindow(env, C1_PHONE);
  return env;
}
/** A published day: tomato 31 and cucumber 28.5 published; potato left out; onion an exception without a decision. */
function published(day = DAY, at = `${day} 06:00`): number {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_published_at: utc(at) });
  const line = (seq: number, p: number, k: number, v: Record<string, unknown>) => seed("x_price_day_line", { x_day_id: d, x_sequence: seq, x_product_tmpl_id: p, x_packaging_id: k, x_blocked: false, x_utak_simulation: false, x_manual_price: 0, ...v });
  line(1, 1, 11, { x_cost_price: 15, x_market_price: 31, x_sale_price: 31, x_suggested_price: 20, x_status: "auto", x_excluded: false });
  line(2, 2, 21, { x_cost_price: 14, x_market_price: 28.5, x_sale_price: 28.5, x_suggested_price: 19, x_status: "auto", x_excluded: false });
  line(3, 3, 31, { x_cost_price: 15.55, x_market_price: 17.17, x_sale_price: 0, x_suggested_price: 22.5, x_status: "unpublished", x_excluded: true });
  line(4, 4, 41, { x_cost_price: 9.99, x_market_price: 0, x_sale_price: 0, x_suggested_price: 16.5, x_status: "exception", x_excluded: false });
  return d;
}
const row = (day: string, partnerId: number, text: string, productId = 0, productName = "", quantity = 0) => ({ day, partnerId, text, productId, productName, quantity });

// ================================================================ [1] pure
console.log("\n[1] the rows of one answer, the count by item, the summary's line");
{
  const vals = UL.requestVals(DAY, C1, [{ text: "  طماطم   بلدي ", productId: 1, quantity: 3 }, { text: "أناناس" }, { text: "   " }, { text: "خيار", productId: 0, quantity: -2 }]);
  assert("a row an item: the day, the customer, his words (trimmed), the catalog's item when one matched, the quantity when he gave one — an empty item: no row",
    JSON.stringify(vals) === JSON.stringify([
      { x_name: `${DAY} — طماطم بلدي`, x_date: DAY, x_partner_id: C1, x_text: "طماطم بلدي", x_product_tmpl_id: 1, x_quantity: 3 },
      { x_name: `${DAY} — أناناس`, x_date: DAY, x_partner_id: C1, x_text: "أناناس", x_product_tmpl_id: false, x_quantity: 0 },
      { x_name: `${DAY} — خيار`, x_date: DAY, x_partner_id: C1, x_text: "خيار", x_product_tmpl_id: false, x_quantity: 0 },
    ]), JSON.stringify(vals));
  assert("his words are kept 120 characters at most", UL.requestVals(DAY, C1, [{ text: "ط".repeat(300) }])[0].x_text === "ط".repeat(UL.REQUEST_TEXT_MAX) && UL.REQUEST_TEXT_MAX === 120);
  const items = UL.groupUnavailable([
    row(DAY, 1, "طماطم", 7, "طماطم"), row(DAY, 2, "بندورة", 7, "طماطم", 2), row(DAY, 2, "طماطم حمرا", 7, "طماطم", 1),
    row(DAY, 3, "خيار"), row(DAY, 4, "أناناس"), row(DAY, 4, "أناناس"), row(DAY, 5, "أناناس"), row(DAY, 6, "أناناس"),
  ]);
  assert("by item — the catalog's item whatever his words, else his own words — the most customers first, then the most asks",
    JSON.stringify(items) === JSON.stringify([
      { name: "أناناس", productId: 0, asks: 4, customers: 3, quantity: 0 }, { name: "طماطم", productId: 7, asks: 3, customers: 2, quantity: 3 }, { name: "خيار", productId: 0, asks: 1, customers: 1, quantity: 0 },
    ]), JSON.stringify(items));
  assert("«طلبوا اليوم وما كان متوفر: أناناس ×4 (3 عملاء)، طماطم ×3 (عميلان)، خيار ×1»", UL.unavailableLine(items) === "طلبوا اليوم وما كان متوفر: أناناس ×4 (3 عملاء)، طماطم ×3 (عميلان)، خيار ×1", UL.unavailableLine(items));
  assert("one customer who asked twice: «×2 (عميل واحد)»; eleven: «11 عميلاً»", UL.itemText({ name: "بصل", productId: 0, asks: 2, customers: 1, quantity: 0 }) === "بصل ×2 (عميل واحد)" && UL.customersWord(11) === "11 عميلاً" && UL.customersWord(10) === "10 عملاء");
  const seven = UL.groupUnavailable(Array.from({ length: 7 }, (_, i) => row(DAY, 1, `صنف ${i + 1}`)));
  assert("five items at most, then «+N»", UL.SUMMARY_ITEMS_MAX === 5 && UL.unavailableLine(seven) === "طلبوا اليوم وما كان متوفر: صنف 1 ×1، صنف 2 ×1، صنف 3 ×1، صنف 4 ×1، صنف 5 ×1، +2", UL.unavailableLine(seven));
  assert("exactly five: no «+N»; no row: no line at all", !UL.unavailableLine(seven.slice(0, 5)).includes("+") && UL.unavailableLine([]) === "");
}

// ================================================================ [2] the intake
console.log("\n[2] the order's intake: a row for each item the valid list does not hold");
{
  const env = world(`${DAY} 10:00`); published();
  await orderSay(env, "بطاطا حلوة 4", [POTATO]);
  const a = asks();
  assert("an item left out of the publication: ONE row — the day, the customer, his own words «بطاطا حلوة», the catalog's item, 4",
    a.length === 1 && a[0].x_date === DAY && a[0].x_partner_id === C1 && a[0].x_text === "بطاطا حلوة" && a[0].x_product_tmpl_id === 3 && a[0].x_quantity === 4 && a[0].x_name === `${DAY} — بطاطا حلوة`, JSON.stringify(a));
  assert("…he was answered as § 59 answers (the form under «هذا الصنف غير متوفر اليوم 🌿»), and no order was made", sentTo(C1_PHONE).length === 1 && String(sentTo(C1_PHONE)[0]?.interactive?.body?.text).startsWith("هذا الصنف غير متوفر اليوم 🌿") && ordersOf().length === 0);
  assert("…and Baraa is told nothing at once", ownerTexts().length === 0, ownerTexts().join(" | "));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 10:00`); published();
  await orderSay(env, "طماطم 3 وبصل وأناناس 2", [TOMATO, ONION, { product_id: 0, product_name_raw: "أناناس", packaging_id: 0, quantity: 2 }]);
  const a = asks().map((r) => [r.x_text, r.x_product_tmpl_id, r.x_quantity]);
  assert("an available item with an exception's item and one we do not sell: a row for each of the two (the tomato is ordered, not recorded)",
    JSON.stringify(a) === JSON.stringify([["بصل", 4, 1], ["أناناس", false, 2]]) && ordersOf().length === 1, JSON.stringify(a));
}
{
  const env = world(`${DAY} 10:00`); published();
  Object.assign(table("product.template").get(4)!, { x_is_active_for_sale: false, active: true });
  env.MSG_DEDUP.store.delete("catalog:v2");
  await orderSay(env, "بصل 5", [{ product_id: 0, product_name_raw: "بصل", packaging_id: 0, quantity: 5 }]);
  const a = asks();
  assert("an item switched off: its row carries the catalog's item and the quantity he said", a.length === 1 && a[0].x_text === "بصل" && a[0].x_product_tmpl_id === 4 && a[0].x_quantity === 5, JSON.stringify(a));
}
{
  // no valid list: the order is kept for the day's prices — «غير متوفر اليوم» is not said, and nothing is recorded
  const env = world(`${DAY} 10:00`);
  await orderSay(env, "بطاطا حلوة 4", [POTATO]);
  assert("no valid list: nothing is recorded (the order waits for the prices)", asks().length === 0 && ordersOf().length === 1 && (await PV.validPriceList(env, Date.now())) === null, JSON.stringify(asks()));
}

// ================================================================ [3] a line that leaves an order
console.log("\n[3] a line of an order kept from before the list: one row when it leaves the order, once");
{
  const env = world(`${DAY} 05:00`);
  // the order was taken before any list: tomato and potato
  setExtract([TOMATO, POTATO]);
  await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "m1", type: "text", text: "طماطم 3 وبطاطس 4", timestamp: "0" } as any, intent: "place_order" as any, senderType: "customer", partner: partnerOf(C1) as any }));
  setExtract(null);
  const order = ordersOf()[0];
  assert("before the list: the order holds both lines and nothing is recorded", !!order && rows("x_daily_order_line").filter((l: any) => l.x_order_id === order.id).length === 2 && asks().length === 0);
  published(DAY, `${DAY} 04:30`);
  const q = await quiet(() => FLOW.quoteOrder(env, { orderId: order.id, partnerId: C1, now: new Date() }));
  const a = asks();
  assert("its quotation: the potato leaves the order («unavailable») and is recorded — the catalog's name, its item, 4 cartons", q.kind === "quoted" && JSON.stringify(q.unavailable) === JSON.stringify(["بطاطس"])
    && a.length === 1 && a[0].x_text === "بطاطس" && a[0].x_product_tmpl_id === 3 && a[0].x_quantity === 4 && a[0].x_partner_id === C1 && a[0].x_date === DAY, JSON.stringify([q, a]));
  await quiet(() => FLOW.quoteOrder(env, { orderId: order.id, partnerId: C1, now: new Date() }));
  assert("a second quotation of the same order records nothing more (the line is out of it)", asks().length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [4] a failure to record
console.log("\n[4] a row that cannot be written never stops the answer");
{
  const env = world(`${DAY} 10:00`); published();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes(`/json/2/${UL.REQUEST_MODEL}/create`)) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no" }), { status: 403 });
    return real(input as any, init);
  }) as typeof fetch;
  let n = -1;
  try {
    n = await quiet(() => UL.logUnavailable(env, { partnerId: C1, items: [{ text: "بطاطس", productId: 3, quantity: 4 }] }));
    await orderSay(env, "بطاطا حلوة 4", [POTATO]);
  } finally { globalThis.fetch = real; }
  assert("Odoo refuses the row: 0 written, no throw — and the customer is answered all the same", n === 0 && asks().length === 0 && sentTo(C1_PHONE).length === 1 && String(sentTo(C1_PHONE)[0]?.interactive?.body?.text).startsWith("هذا الصنف غير متوفر اليوم 🌿"));
  assert("no customer (a trial to Baraa's own number): nothing is written", (await UL.logUnavailable(env, { partnerId: 0, items: [{ text: "بطاطس" }] })) === 0 && asks().length === 0);
}

// ================================================================ [5] the day's real rows
console.log("\n[5] what the summary and «🎯 الفرص» read: the real rows of the days asked for, by item");
{
  const env = world(`${DAY} 21:30`);
  const ask = (partner: number, text: string, product: number | false, day = DAY, extra: Record<string, unknown> = {}) => seed(UL.REQUEST_MODEL, { x_date: day, x_partner_id: partner, x_text: text, x_product_tmpl_id: product, x_quantity: 0, ...extra });
  ask(C1, "بطاطا", 3); ask(CUST2, "بطاطس", 3); ask(C1, "بطاطس", 3); ask(C1, "أناناس", false);
  ask(C1, "مانجو", false, "2026-10-02");                          // another day
  ask(CUST2, "كيوي", false, DAY, { x_utak_simulation: true });   // a simulation's
  const got = UL.groupUnavailable(await UL.readUnavailable(env, DAY, DAY));
  assert("the day's real rows alone (a simulation's never), by item, the catalog's name without its reference", JSON.stringify(got.map((i: any) => [i.name, i.asks, i.customers])) === JSON.stringify([["بطاطس", 3, 2], ["أناناس", 1, 1]]), JSON.stringify(got));
  assert("«طلبوا اليوم وما كان متوفر: بطاطس ×3 (عميلان)، أناناس ×1»", UL.unavailableLine(got) === "طلبوا اليوم وما كان متوفر: بطاطس ×3 (عميلان)، أناناس ×1", UL.unavailableLine(got));
  const week = UL.groupUnavailable(await UL.readUnavailable(env, "2026-09-27", DAY));
  assert("seven days: the other day's ask is in", week.length === 3 && week.some((i: any) => i.name === "مانجو"), JSON.stringify(week));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [6] the schema
console.log("\n[6] the fields are the tenant's");
{
  const SCHEMA = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261006-s60.json", import.meta.url), "utf8"));
  const names = OD.REQUEST_FIELDS.map((f: any) => f.name);
  assert("the model and its six fields are the ones the Odoo script creates, and the tenant has them", OD.REQUEST_MODEL === UL.REQUEST_MODEL && names.every((n: string) => SCHEMA[UL.REQUEST_MODEL].includes(n))
    && Object.keys(UL.requestVals(DAY, C1, [{ text: "x" }])[0]).every((k) => SCHEMA[UL.REQUEST_MODEL].includes(k)), JSON.stringify(names));
  assert("its list is read-only and its action shows the real rows alone", /create="0"/.test(OD.REQUEST_LIST_ARCH) && /edit="0"/.test(OD.REQUEST_LIST_ARCH) && OD.REQUEST_DOMAIN === "[('x_utak_simulation', '=', False)]" && names.every((n: string) => n === "x_utak_simulation" || OD.REQUEST_LIST_ARCH.includes(`name="${n}"`)));
}

done();
