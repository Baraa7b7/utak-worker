// § 49 أ–ج (2026-10-01) — orders at every hour, a price valid for one day, no minimum order, and the
// delivery on the spot.
//
//   [أ] the minimum order is a setting, 0 on the tenant: nothing refused for it, no message names it.
//   [ب] the price list of day D is valid from its publication until 06:00 of D+1 (a late publication
//       until the next 06:00): an order message is never refused (03:00, 05:59, 06:01 without a
//       publication, 14:00, 21:30, 23:59); with a valid list «خلاص» → the quotation at that list's
//       prices, frozen on the order; without one the order is kept, the customer told, and his
//       quotation goes out by itself at the first valid publication; a «تأكيد الطلب» after the list
//       expired never confirms the old price; the 20:00 reminder skips an expired quotation; the
//       delivery day (confirmed before 21:00: tomorrow; after: the day after) is written out; the
//       fixed note in every quotation and in the day's prices message.
//   [ج] the delivery on the spot: any confirmed order, whatever its registered delivery day — the
//       moment of the delivery recorded, the invoice issued and sent, the order on no purchase list.
//   [د] the sources' role: tests/s49-sources.test.mts. [هـ] the item's full name: tests/s49-ui.test.mts.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s49.test.mts

import { readFileSync } from "node:fs";
import {
  COLL_PHONE, OWNER, ctx, graph, heldFor, inbound, openWindow, partnerOf, quiet, rows, seed, sentTo, setRiyadh, signed, table,
} from "./wa-harness.mts";
import { AHMED, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, assert, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const PV = await import("../src/price-validity.ts");
const OF = await import("../src/order-flow.ts");
const OD = await import("../src/odoo.ts");
const HRS = await import("../src/hours.ts");
const OP = await import("../src/order-pricing.ts");
const TEAM = await import("../src/team.ts");
const PR = await import("../src/prices.ts");
const QUO = await import("../src/quotation.ts");
const { dispatch } = await import("../src/router.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helper
const UI = await import("../scripts/lib/s49-ui.mjs");

const PREV = "2026-10-02", NEXT = "2026-10-04", AFTER = "2026-10-05";   // DAY = 2026-10-03, a Saturday
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");

/** The tenant's world of § 49: no minimum order, the customer's district known, his window open. */
function world(riyadh: string): any {
  const env = fresh(riyadh);
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  openWindow(env, C1_PHONE);
  return env;
}
/** A published price day: tomato (1/11) and cucumber (2/21) at these prices. */
function published(day: string, tomato: number, cucumber: number | null = null, at = `${day} 06:00`, extra: Record<string, unknown> = {}): number {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_published_at: utc(at), ...extra });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_market_price: tomato, x_sale_price: tomato, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 29 });
  if (cucumber !== null) seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 2, x_packaging_id: 21, x_cost_price: 26, x_market_price: cucumber, x_sale_price: cucumber, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 36 });
  return d;
}
let mid = 0;
const text = (env: any, body: string, intent: string, items: unknown = null) => quiet(async () => {
  setExtract(items);
  try {
    return await dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: `m${++mid}`, type: "text", text: body, timestamp: "0" } as any, intent: intent as any, senderType: "customer", partner: partnerOf(C1) as any });
  } finally { setExtract(null); }
});
const TOMATO3 = [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }];
const order3 = (env: any, more = "") => text(env, `طماطم كرتون 3${more}`, "place_order", TOMATO3);
const khalas = (env: any) => text(env, "خلاص", "request_quotation");
const tap = (env: any, buttonId: string, who: number | null = C1) => quiet(() => dispatch(env, { msg: { from: "+x", fromRaw: "x", profileName: "", messageId: `t${++mid}`, type: "button", buttonId, text: "", timestamp: "0" } as any, intent: "other", senderType: "customer", partner: who === null ? null : partnerOf(who) as any }));
const unlock = (env: any, orderId: number) => env.MSG_DEDUP.store.delete(`btnlock:v1:order:${orderId}:confirm_order`);   // ح8's 90-second lock has expired
const orderOfC1 = () => rows("x_daily_order").filter((o: any) => o.x_customer_id === C1) as any[];
const linesOf = (orderId: number) => rows("x_daily_order_line").filter((l: any) => l.x_order_id === orderId) as any[];
const body = (r: any) => String(r?.bodyBeforeButtons ?? r?.text ?? "");
const confirmButton = (r: any, orderId: number) => (r?.buttons ?? []).some((b: any) => b.id === `confirm_order_${orderId}`);
const REFUSAL = /مقفل|انقفل|سجّله لبكرة|يفتح الساعة|ما تسجّل/;

// ================================================================ [أ] the minimum order
console.log("\n[أ] the minimum order: a setting, 0 on the tenant — nothing refused, nothing said");
{
  const env = world(`${DAY} 10:00`); published(DAY, 20);
  await order3(env);
  const o = orderOfC1()[0];
  const m = await quiet(() => OP.orderMinimum(env, o.id));
  assert("the setting 0: «not below», and the order's total is not even read", m.below === false && m.min === 0, JSON.stringify(m));
  const r = await khalas(env);
  assert("an order of 60 riyals («طماطم كرتون 3» at 20) gets its quotation and its confirm button", confirmButton(r, o.id) && rows("x_quotation").length === 1 && table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation", JSON.stringify(r));
  assert("…and no word of a minimum in it", !/أقل طلب|الحد الأدنى|حد أدنى/.test(body(r)), body(r));
  const c = await tap(env, `confirm_order_${o.id}`);
  assert("…confirmed", /تم التأكيد/.test(body(c)) && table("x_daily_order").get(o.id)!.x_state === "confirmed" && !/أقل طلب/.test(body(c)), body(c));
}
{
  const env = world(`${DAY} 20:00`); published(DAY, 20);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  await quiet(() => TEAM.sendCutoffReminders(env));
  const sent = sentTo(C1_PHONE).map((b: any) => JSON.stringify(b)).join("\n");
  assert("the 20:00 reminder of a 60-riyal order carries its confirm button and names no minimum", sent.includes(`confirm_order_${o.id}`) && !/أقل طلب/.test(sent), sent.slice(0, 300));
}
{
  const env = world(`${DAY} 10:00`); published(DAY, 20);
  table("x_pricing_config").get(1)!.x_min_order_sar = 150;
  await order3(env);
  const r = await khalas(env);
  assert("the setting is still read: with 150 in it, 60 riyals gets «أقل طلب 150 ريال» and no quotation", /أقل طلب 150 ريال/.test(body(r)) && !r.buttons && rows("x_quotation").length === 0, body(r));
  assert("no «150» is written in the worker's order path (the number lives in Odoo alone)", !/\b150\b/.test(srcOf("router.ts")) && !/\b150\b/.test(srcOf("team.ts")) && !/\b150\b/.test(srcOf("order-flow.ts")) && !/\b150\b/.test(srcOf("order-pricing.ts").replace(/\/\/.*$/gm, "")));
  const more = await tap(env, "أبغى أعرف أكثر");
  assert("«أبغى أعرف أكثر» no longer mentions a minimum order", !/حد أدنى/.test(body(more)) && /أسعار جملة/.test(body(more)), body(more));
  assert("Odoo: the value § 49 writes is 0, and the field's help says what 0 means", UI.MIN_ORDER_SAR === 0 && /0 = بلا حد أدنى/.test(UI.MIN_ORDER_HELP));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب] the validity of a price list
console.log("\n[ب] a price list is valid from its publication until 06:00 of the next day");
{
  const until = PV.listValidUntilMs(DAY);
  assert("the list of a day ends at 06:00 Riyadh of the day after it", until === ms(`${NEXT} 06:00`));
  assert("05:59 the next morning: valid; 06:00 sharp: over", PV.isValidAt(DAY, ms(`${DAY} 06:00`), ms(`${NEXT} 05:59`)) && !PV.isValidAt(DAY, ms(`${DAY} 06:00`), ms(`${NEXT} 06:00`)));
  assert("published early (05:00 of its own day): still until 06:00 of the NEXT day, not one hour", PV.listValidUntilMs(DAY, ms(`${DAY} 05:00`)) === ms(`${NEXT} 06:00`));
  assert("published late the same day («نشر المعتمد الآن» at 13:00): until 06:00 of the next day", PV.listValidUntilMs(DAY, ms(`${DAY} 13:00`)) === ms(`${NEXT} 06:00`));
  assert("published after its own end (yesterday's day, today 08:00): until the next 06:00 after the publication", PV.listValidUntilMs(PREV, ms(`${DAY} 08:00`)) === ms(`${NEXT} 06:00`));
  assert("the next 06:00 after 05:59 is today's, after 06:00 tomorrow's", PV.nextExpiryAfter(ms(`${DAY} 05:59`)) === ms(`${DAY} 06:00`) && PV.nextExpiryAfter(ms(`${DAY} 06:00`)) === ms(`${NEXT} 06:00`));
}
{
  const env = world(`${DAY} 03:00`);
  assert("no published day: no valid list", (await PV.validPriceList(env)) === null);
  const y = published(PREV, 20);
  const l = await PV.validPriceList(env);
  assert("03:00 — yesterday's published list is the valid one, until 06:00 today", l?.dayId === y && l.day === PREV && l.validUntilMs === ms(`${DAY} 06:00`), JSON.stringify(l));
  setRiyadh(`${DAY} 05:59`);
  assert("05:59 — still valid", (await PV.validPriceList(env))?.day === PREV);
  setRiyadh(`${DAY} 06:00`);
  assert("06:00 — over: no valid list until today's is published", (await PV.validPriceList(env)) === null);
  for (const state of ["draft", "approved", "missed"]) {
    const d = seed("x_price_day", { x_date: DAY, x_state: state, x_name: "x", x_utak_simulation: false });
    setRiyadh(`${DAY} 10:00`);
    assert(`a ${state} day is not a list`, (await PV.validPriceList(env)) === null);
    table("x_price_day").delete(d);
  }
  published(DAY, 22, null, `${DAY} 10:00`, { x_utak_simulation: true });
  assert("a simulation day is never a list", (await PV.validPriceList(env)) === null);
  const t = published(DAY, 24, null, `${DAY} 10:05`);
  const now = await PV.validPriceList(env);
  assert("today's published at 10:05: valid from then until 06:00 tomorrow", now?.dayId === t && now.validUntilMs === ms(`${NEXT} 06:00`));
  assert("its price of an item: the published line's", (await PV.listPrice(env, now!, 1, 11)).price === 24 && (await PV.listPrice(env, now!, 1, 11)).source === "published");
  assert("an item the list does not carry: no price", (await PV.listPrice(env, now!, 2, 21)).source === "missing");
  seed("x_price_day_line", { x_day_id: t, x_product_tmpl_id: 2, x_packaging_id: 21, x_cost_price: 26, x_market_price: 0, x_sale_price: 0, x_status: "unpublished", x_excluded: true, x_blocked: false, x_suggested_price: 36 });
  const u = await PV.listPrice(env, now!, 2, 21);
  // § 59 ج — until § 59 its «السعر المربح المقترح» (36) stood in for it; now it is not available that day
  assert("an item of that same day that was not published (§ 59 ج): NO price — not the day's suggested price (36), never another day's", u.price === 0 && u.source === "missing", JSON.stringify(u));
  assert("the list of a day, asked by its date: valid while it is, null after", (await PV.listOfDayIfValid(env, DAY))?.dayId === t && (await PV.listOfDayIfValid(env, PREV)) === null && (await PV.listOfDayIfValid(env, "")) === null);
}
{
  const env = world(`${DAY} 05:30`);
  published(PREV, 20, 30); const t = published(DAY, 24, null, `${DAY} 05:00`);
  const l = await PV.validPriceList(env);
  assert("two valid lists (yesterday's until 06:00, today's published early): today's is the one", l?.dayId === t);
  assert("an item yesterday's list carried (cucumber 30) and today's does not: no price in today's list", (await PV.listPrice(env, l!, 2, 21)).source === "missing" && (await PV.listPrice(env, l!, 1, 11)).price === 24);
  seed("x_price_day_line", { x_day_id: t, x_product_tmpl_id: 2, x_packaging_id: 21, x_cost_price: 26, x_market_price: 33, x_sale_price: 33, x_status: "unpublished", x_excluded: true, x_blocked: false, x_suggested_price: 36 });
  const x = await PV.listPrice(env, l!, 2, 21);
  assert("a line left out of the publication is not a published price, whatever number it still carries (33) — and (§ 59 ج) its suggested price (36) is none either", x.price === 0 && x.source === "missing", JSON.stringify(x));
}

// ---------------------------------------------------------------- an order at every hour
console.log("\n[ب] an order message is taken at every hour");
{
  assert("the ordering day: today before 21:00, tomorrow from 21:00; its delivery the day after", HRS.nextOrderingDate(new Date(ms(`${DAY} 03:00`))) === DAY && HRS.nextOrderingDate(new Date(ms(`${DAY} 20:59`))) === DAY && HRS.nextOrderingDate(new Date(ms(`${DAY} 21:00`))) === NEXT && HRS.deliveryDayOf(DAY) === NEXT && HRS.deliveryDayOf("2026-10-31") === "2026-11-01");
  assert("the router no longer asks whether ordering is open, and offers no «سجّله لبكرة»", !/isOrderingHoursOpen|isWithinOrderingWindow|offerLateOrder|handleClosedHoursOrder/.test(srcOf("router.ts")));
}
for (const [hhmm, list, orderDay, delivery, label] of [
  ["03:00", PREV, DAY, "الأحد 4 أكتوبر 2026", "the list of yesterday, still valid"],
  ["05:59", PREV, DAY, "الأحد 4 أكتوبر 2026", "one minute before yesterday's list ends"],
  ["14:00", DAY, DAY, "الأحد 4 أكتوبر 2026", "today's list"],
  ["21:30", DAY, NEXT, "الاثنين 5 أكتوبر 2026", "after 21:00: tomorrow's purchase list"],
  ["23:59", DAY, NEXT, "الاثنين 5 أكتوبر 2026", "after 21:00: tomorrow's purchase list"],
] as const) {
  const env = world(`${DAY} ${hhmm}`);
  published(PREV, 20);
  if (list === DAY) published(DAY, 24);
  const r1 = await order3(env);
  const o = orderOfC1()[0];
  assert(`${hhmm} (${label}) — the order is recorded, never refused, and the reply asks for «خلاص»`, !!o && linesOf(o.id).length === 1 && /خلاص/.test(body(r1)) && !REFUSAL.test(body(r1)) && !r1.buttons, body(r1));
  assert(`${hhmm} — its ordering day is ${orderDay}`, o.x_order_date === orderDay, o.x_order_date);
  const r2 = await khalas(env);
  const price = list === DAY ? 24 : 20;
  assert(`${hhmm} — «خلاص» → the quotation at the prices of the valid list (${list}: ${price}), frozen on the line`, confirmButton(r2, o.id) && rows("x_quotation").length === 1 && linesOf(o.id)[0].x_unit_price === price && table("x_daily_order").get(o.id)!.x_price_date === list && table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation", JSON.stringify([body(r2), linesOf(o.id)[0], table("x_daily_order").get(o.id)]));
  assert(`${hhmm} — the quotation names the delivery day: صباح ${delivery}${orderDay === NEXT ? " (بعد بكرة)" : ""}`, body(r2).includes(`صباح ${delivery}`) && (orderDay === NEXT ? /بعد بكرة/.test(body(r2)) && /بعد الساعة 9:00 مساءً/.test(body(r2)) : /لو تأكد قبل الساعة 9:00 مساءً/.test(body(r2))), body(r2));
  assert(`${hhmm} — …and the fixed note`, body(r2).includes("السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف."), body(r2));
  const r3 = await tap(env, `confirm_order_${o.id}`);
  assert(`${hhmm} — «تأكيد الطلب»: confirmed, and the confirmation names the same day`, table("x_daily_order").get(o.id)!.x_state === "confirmed" && /تم التأكيد/.test(body(r3)) && body(r3).includes(`صباح ${delivery}`) && table("x_daily_order").get(o.id)!.x_order_date === orderDay, body(r3));
  assert(`${hhmm} — no Odoo field or value outside the schema`, rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 06:01`);
  published(PREV, 20);                                   // yesterday's list ended at 06:00; today's is not published
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 15, x_sale_price: 19, x_date: PREV, x_extraction_status: "extracted" });
  const r1 = await order3(env);
  const o = orderOfC1()[0];
  assert("06:01 without a publication — the order is kept (its line recorded), not refused", !!o && linesOf(o.id).length === 1 && o.x_state === "draft" && !REFUSAL.test(body(r1)), body(r1));
  assert("…the customer is told at once: «استلمنا طلبك ✅ الأسعار تتحدث، ونرسل لك عرض السعر أول ما تنتشر أسعار اليوم.»", body(r1).includes("استلمنا طلبك ✅ الأسعار تتحدث، ونرسل لك عرض السعر أول ما تنتشر أسعار اليوم.") && !r1.buttons, body(r1));
  assert("…the order waits for prices, no quotation, no price on its line (not yesterday's 20, not an old supplier row's 19)", table("x_daily_order").get(o.id)!.x_awaiting_prices === true && rows("x_quotation").length === 0 && !linesOf(o.id)[0].x_unit_price);
  const r2 = await khalas(env);
  assert("…«خلاص»: the same answer, still no quotation and no price", body(r2).includes("استلمنا طلبك ✅ الأسعار تتحدث") && !r2.buttons && rows("x_quotation").length === 0 && !linesOf(o.id)[0].x_unit_price, body(r2));
  const r3 = await text(env, "خيار جرم 2", "add_to_order", [{ product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 }]);
  assert("…a second message adds to the same waiting order", orderOfC1().length === 1 && linesOf(o.id).length === 2 && body(r3).includes("استلمنا طلبك ✅"), body(r3));
  assert("…Baraa is not alerted about a price (nothing was priced), and nothing outside the schema", ownerTexts().filter((t) => /عرض سعر لم يُرسل/.test(t)).length === 0 && rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 14:00`);                    // a day without prices at all
  const r = await order3(env, " خلاص");
  const o = orderOfC1()[0];
  assert("a day with no prices at all, «… خلاص» in the order's own message: kept, the same answer", body(r).includes("استلمنا طلبك ✅ الأسعار تتحدث") && !r.buttons && table("x_daily_order").get(o.id)!.x_awaiting_prices === true && rows("x_quotation").length === 0, body(r));
}

// ---------------------------------------------------------------- the waiting order, quoted at the publication
console.log("\n[ب] the order that waited is quoted by itself at the first valid publication");
function approvedDay(day: string, tomato: number): number {
  const d = seed("x_price_day", { x_date: day, x_state: "approved", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_approved_at: utc(`${day} 08:59`) });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_market_price: tomato, x_sale_price: tomato, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 29 });
  return d;
}
const quoteSends = (phone = C1_PHONE) => sentTo(phone).filter((b: any) => b.type === "interactive" && /عرض السعر رقم/.test(String(b.interactive?.body?.text)));
{
  const env = world(`${DAY} 06:30`);
  await order3(env);
  const o = orderOfC1()[0];
  setRiyadh(`${DAY} 09:00`);
  openWindow(env, C1_PHONE, 150);
  const d = approvedDay(DAY, 26);
  graph.length = 0;
  const rep = await quiet(() => PR.publishPriceDay(env, d));
  const q = quoteSends();
  assert("the publication quotes the waiting order: one message with the three buttons", rep.action === "published" && q.length === 1 && q[0].interactive.action.buttons.map((b: any) => b.reply.id).join() === `confirm_order_${o.id},edit_order_${o.id},cancel_order_${o.id}`, JSON.stringify([rep, q]));
  const t = String(q[0]?.interactive?.body?.text);
  assert("…it names the order, the day's prices, its items, the delivery day and the fixed note", t.includes(`#${o.id}`) && t.includes("بأسعار السبت 3 أكتوبر 2026") && t.includes("• طماطم كرتون × 3") && t.includes("صباح الأحد 4 أكتوبر 2026") && t.includes("السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف."), t);
  assert("…at the NEW prices (26), frozen on the line; the order no longer waits; the quotation record made", linesOf(o.id)[0].x_unit_price === 26 && table("x_daily_order").get(o.id)!.x_awaiting_prices === false && table("x_daily_order").get(o.id)!.x_price_date === DAY && table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation" && rows("x_quotation").filter((x: any) => x.x_order_id === o.id).length === 1);
  assert("…Baraa is told which orders were quoted", ownerTexts().some((x) => x.includes("بانتظار الأسعار") && x.includes(`#${o.id}`)), ownerTexts().join(" | ").slice(0, 300));
  assert("…reported by the publication", rep.awaiting?.length === 1 && rep.awaiting[0].action === "quoted");
  const n = quoteSends().length;
  const tick = await quiet(() => OF.quoteAwaitingOrders(env, Date.now()));
  assert("the tick after it: nothing left to quote, no second message", tick.length === 0 && quoteSends().length === n);
  const c = await tap(env, `confirm_order_${o.id}`);
  assert("…and his «تأكيد الطلب» confirms it at 26", /تم التأكيد/.test(body(c)) && table("x_daily_order").get(o.id)!.x_state === "confirmed" && linesOf(o.id)[0].x_unit_price === 26, body(c));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 06:30`);
  await order3(env);
  const o = orderOfC1()[0];
  setRiyadh(`${NEXT} 06:00`);                            // nothing was published the whole day; his window closed since
  env.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  published(NEXT, 27, null, `${NEXT} 06:00`);
  graph.length = 0;
  const out = await quiet(() => OF.quoteAwaitingOrders(env, Date.now()));
  const held = heldFor(env, C1_PHONE);
  assert("his window closed at the publication: as the gateway decides — held for his next message, no template", out[0]?.action === "quoted" && out[0].detail === "held" && sentTo(C1_PHONE).filter((b: any) => b.type === "template").length === 0 && held.length === 1, JSON.stringify([out, held]).slice(0, 400));
  assert("…held no longer than the list is valid (06:00 of the next day)", held[0]?.expiresAt === ms(`${AFTER} 06:00`), String(held[0]?.expiresAt));
  assert("…the order is quoted on the day it is priced: ordering day and price list of the publication", table("x_daily_order").get(o.id)!.x_order_date === NEXT && table("x_daily_order").get(o.id)!.x_price_date === NEXT && linesOf(o.id)[0].x_unit_price === 27);
}
{
  const env = world(`${DAY} 06:30`);
  await text(env, "خيار جرم 2", "place_order", [{ product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 }]);
  const o = orderOfC1()[0];
  setRiyadh(`${DAY} 09:00`);
  published(DAY, 26, null, `${DAY} 09:00`);              // the list carries no cucumber
  graph.length = 0;
  const out = await quiet(() => OF.quoteAwaitingOrders(env, Date.now()));
  // § 59 ج — «هذا الصنف غير متوفر اليوم 🌿 المتوفر اليوم:» with the list's items and prices; never «نراجع السعر»
  const told = sentTo(C1_PHONE).map((b: any) => String(b.text?.body ?? ""));
  assert("a waiting order whose item the new list does not carry (§ 59 ج): no quotation — «هذا الصنف غير متوفر اليوم 🌿 المتوفر اليوم:» with what the list holds and its price", out[0]?.action === "unavailable" && rows("x_quotation").length === 0 && told.length === 1 && told[0].startsWith("هذا الصنف غير متوفر اليوم 🌿\nالمتوفر اليوم:\n• طماطم (كرتون): 26 ر.س") && !/نراجع السعر/.test(told[0]) && !ownerTexts().some((x) => /عرض سعر لم يُرسل/.test(x)), JSON.stringify([out, told]));
  assert("…it no longer waits (the next tick does not ask again), and is closed: nothing is left in it", table("x_daily_order").get(o.id)!.x_awaiting_prices === false && table("x_daily_order").get(o.id)!.x_state === "cancelled" && linesOf(o.id)[0].x_status === "unavailable" && (await quiet(() => OF.quoteAwaitingOrders(env, Date.now()))).length === 0);
}

{
  const env = world(`${DAY} 06:30`);
  table("res.partner").get(C1)!.x_delivery_neighborhood = false;       // a first-time customer: no delivery place yet
  await order3(env);
  const o = orderOfC1()[0];
  setRiyadh(`${DAY} 09:00`);
  published(DAY, 26, null, `${DAY} 09:00`);
  graph.length = 0;
  const out = await quiet(() => OF.quoteAwaitingOrders(env, Date.now()));
  const t = String(quoteSends()[0]?.interactive?.body?.text ?? "");
  assert("a waiting order without a delivery place is still quoted by the publication (he is not asked a question he did not see coming)", out[0]?.action === "quoted" && quoteSends().length === 1 && !t.includes("📍") && !env.MSG_DEDUP.store.has(`pending_neighborhood:${C1}`), JSON.stringify([out, t]));
  const c = await tap(env, `confirm_order_${o.id}`);
  assert("…the place is asked after his confirmation, as for any confirmed order without one", table("x_daily_order").get(o.id)!.x_state === "confirmed" && /أرسل موقع التوصيل/.test(body(c)) && env.MSG_DEDUP.store.get(`pending_neighborhood:${C1}`) === `loc:${o.id}`, body(c));
}

// ---------------------------------------------------------------- 20:00 and 21:00
console.log("\n[ب] 20:00 reminds only a quotation that can still be confirmed; 21:00 leaves a waiting order");
{
  const env = world(`${DAY} 20:00`);
  published(PREV, 20);                                   // yesterday's list: expired at 06:00 today
  const expired = seed("x_daily_order", { x_customer_id: C1, x_state: "waiting_confirmation", x_order_date: DAY, x_created_via: "whatsapp", x_price_date: PREV });
  seed("x_daily_order_line", { x_order_id: expired, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 20, x_status: "pending" });
  const waiting = seed("x_daily_order", { x_customer_id: C1, x_state: "draft", x_order_date: DAY, x_created_via: "whatsapp", x_awaiting_prices: true });
  seed("x_daily_order_line", { x_order_id: waiting, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 1, x_status: "pending" });
  const r = await quiet(() => TEAM.sendCutoffReminders(env));
  assert("an expired quotation and a waiting order: no reminder to either", r.reminded === 0 && r.skipped === 2 && sentTo(C1_PHONE).length === 0, JSON.stringify(r));
  published(DAY, 24);
  table("x_daily_order").get(expired)!.x_price_date = DAY;
  const r2 = await quiet(() => TEAM.sendCutoffReminders(env));
  assert("a quotation of a list that is still valid: reminded, with its confirm button", r2.reminded === 1 && r2.skipped === 1 && JSON.stringify(sentTo(C1_PHONE)).includes(`confirm_order_${expired}`), JSON.stringify(r2));
  setRiyadh(`${DAY} 21:00`);
  await quiet(() => TEAM.closeUnconfirmedOrders(env));
  assert("21:00: the unconfirmed quotation is cancelled as before; the order that waits for prices is left", table("x_daily_order").get(expired)!.x_state === "cancelled" && table("x_daily_order").get(waiting)!.x_state === "draft" && table("x_daily_order").get(waiting)!.x_awaiting_prices === true);
}

// ---------------------------------------------------------------- «تأكيد الطلب» after the list expired
console.log("\n[ب] a quotation whose price list expired is never confirmed at the old price");
{
  const env = world(`${DAY} 22:00`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  assert("quoted at 22:00 at today's 24 (the order is tomorrow's)", linesOf(o.id)[0].x_unit_price === 24 && table("x_daily_order").get(o.id)!.x_order_date === NEXT);
  setRiyadh(`${NEXT} 05:59`);
  const ok = await tap(env, `confirm_order_${o.id}`);
  assert("«تأكيد» at 05:59 the next morning (the list still valid): confirmed at 24", /تم التأكيد/.test(body(ok)) && table("x_daily_order").get(o.id)!.x_state === "confirmed" && linesOf(o.id)[0].x_unit_price === 24, body(ok));
}
{
  const env = world(`${DAY} 22:00`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  setRiyadh(`${NEXT} 06:01`);                            // the list of DAY ended at 06:00; NEXT is not published
  const r = await tap(env, `confirm_order_${o.id}`);
  assert("«تأكيد» at 06:01, no valid list: NOT confirmed; the order waits for the day's prices and he is told", table("x_daily_order").get(o.id)!.x_state === "draft" && table("x_daily_order").get(o.id)!.x_awaiting_prices === true && body(r).includes("استلمنا طلبك ✅ الأسعار تتحدث") && !r.buttons && !r.confirmedOrderId, body(r));
  setRiyadh(`${NEXT} 08:00`); unlock(env, o.id);
  published(NEXT, 31, null, `${NEXT} 07:30`);
  graph.length = 0;
  const auto = await quiet(() => OF.quoteAwaitingOrders(env, Date.now()));
  assert("…the publication sends him the new quotation at the new price (31)", auto[0]?.action === "quoted" && linesOf(o.id)[0].x_unit_price === 31 && quoteSends().length === 1);
}
{
  const env = world(`${DAY} 22:00`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  const quotations = rows("x_quotation").length;
  setRiyadh(`${NEXT} 06:30`);
  published(NEXT, 31, null, `${NEXT} 06:00`);
  const r = await tap(env, `confirm_order_${o.id}`);
  assert("«تأكيد» after 06:00 with today's list published: NOT confirmed at 24 — a new quotation at 31, with its buttons", table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation" && confirmButton(r, o.id) && linesOf(o.id)[0].x_unit_price === 31 && table("x_daily_order").get(o.id)!.x_price_date === NEXT && rows("x_quotation").length === quotations + 1 && !r.confirmedOrderId, JSON.stringify([body(r), linesOf(o.id)[0]]));
  assert("…it says why, and carries the delivery day and the note", /انتهت صلاحيتها/.test(body(r)) && body(r).includes("صباح الاثنين 5 أكتوبر 2026") && body(r).includes("السعر حسب أسعار اليوم"), body(r));
  unlock(env, o.id);
  const c = await tap(env, `confirm_order_${o.id}`);
  assert("…his next «تأكيد» confirms the new one, at 31", /تم التأكيد/.test(body(c)) && table("x_daily_order").get(o.id)!.x_state === "confirmed" && linesOf(o.id)[0].x_unit_price === 31, body(c));
}
{
  const env = world(`${DAY} 20:50`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  setRiyadh(`${DAY} 21:05`);                             // the 21:00 job has not run on it yet
  const r = await tap(env, `confirm_order_${o.id}`);
  assert("a quotation of before 21:00 confirmed at 21:05: not confirmed for tomorrow — a new quotation with the day after tomorrow", table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation" && confirmButton(r, o.id) && table("x_daily_order").get(o.id)!.x_order_date === NEXT && body(r).includes("صباح الاثنين 5 أكتوبر 2026") && /بعد بكرة/.test(body(r)) && /ما تأكد قبل الساعة 9:00 مساءً/.test(body(r)), body(r));
}
{
  const env = world(`${DAY} 20:50`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  setRiyadh(`${DAY} 21:00`);
  await quiet(() => TEAM.closeUnconfirmedOrders(env));
  setRiyadh(`${DAY} 21:10`);
  const r = await tap(env, `confirm_order_${o.id}`);
  const fresh2 = orderOfC1().find((x) => x.id !== o.id);
  assert("«تأكيد» on the order 21:00 cancelled: it stays cancelled; its items start a new order, quoted at the valid list", table("x_daily_order").get(o.id)!.x_state === "cancelled" && !!fresh2 && fresh2.x_state === "waiting_confirmation" && fresh2.x_order_date === NEXT && linesOf(fresh2.id)[0]?.x_unit_price === 24 && confirmButton(r, fresh2.id) && !REFUSAL.test(body(r)), JSON.stringify([body(r), fresh2]));
}
{
  const env = world(`${DAY} 10:00`);
  published(DAY, 24);
  const draft = seed("x_daily_order", { x_customer_id: C1, x_state: "draft", x_order_date: DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
  seed("x_daily_order_line", { x_order_id: draft, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 2, x_status: "pending" });
  const r = await tap(env, `confirm_order_${draft}`);
  assert("an order no quotation priced (the 20:00 reminder's button on a draft): priced from the valid list, then confirmed", /تم التأكيد/.test(body(r)) && table("x_daily_order").get(draft)!.x_state === "confirmed" && linesOf(draft)[0].x_unit_price === 24 && table("x_daily_order").get(draft)!.x_price_date === DAY, body(r));
}
{
  const env = world(`${DAY} 10:00`);
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  const e = await tap(env, `edit_order_${o.id}`);
  setRiyadh(`${DAY} 23:00`);
  const o2 = seed("x_daily_order", { x_customer_id: C1, x_state: "waiting_confirmation", x_order_date: NEXT, x_created_via: "whatsapp", x_price_date: DAY });
  const e2 = await tap(env, `edit_order_${o2}`);
  assert("«تعديل» at any hour: the order goes back to draft (no «الطلبات تنقفل»)", table("x_daily_order").get(o.id)!.x_state === "draft" && table("x_daily_order").get(o2)!.x_state === "draft" && /عدّل/.test(body(e)) && /عدّل/.test(body(e2)) && !/تنقفل/.test(body(e2)));
}

// ---------------------------------------------------------------- the frozen price
console.log("\n[ب] the order keeps the prices of its quotation: the invoice, days later, is not another day's price");
function taxWorld(): void {
  if (table("res.company").size) return;
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "UTAK Company", vat: "300000000000003", account_sale_tax_id: [77, "15%"] });
}
const invoicesOf = (orderId: number) => rows("x_invoice").filter((i: any) => i.x_order_id === orderId) as any[];
{
  const env = world(`${DAY} 10:00`); taxWorld();
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  await tap(env, `confirm_order_${o.id}`);
  setRiyadh(`${NEXT} 09:00`);
  published(NEXT, 40, null, `${NEXT} 06:00`);            // the next day's price is 40
  table("x_daily_order").get(o.id)!.x_state = "in_delivery";
  seed("x_delivery_stop", { x_order_id: o.id, x_status: "pending" });
  const r = await tap(env, `delivered_${o.id}`, DRIVER);
  const inv = invoicesOf(o.id)[0];
  assert("delivered the next morning, when the day's price is 40: the invoice is 3 × 24 = 72, the price it was confirmed at", /تم التسليم ✅/.test(body(r)) && inv?.x_total === 72 && linesOf(o.id)[0].x_unit_price === 24, JSON.stringify(inv));
}
{
  const env = world(`${DAY} 10:00`);
  published(DAY, 24);                                    // no cucumber in the list
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: 15, x_sale_price: 19, x_date: PREV, x_extraction_status: "extracted" });
  await text(env, "طماطم كرتون 3 وخيار جرم 2", "place_order", [...TOMATO3, { product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 }]);
  const o = orderOfC1()[0];
  // § 59 ج — the item the list does not hold was never added to the order (the form's message said so)
  assert("an item the valid list does not carry is not added to the order (§ 59 ج): the tomato alone", linesOf(o.id).length === 1 && linesOf(o.id)[0].x_product_tmpl_id === 1, JSON.stringify(linesOf(o.id)));
  // …and one that was on the order before the list (seeded here) never takes an older day's price
  const cucumber = table("x_daily_order_line").get(seed("x_daily_order_line", { x_order_id: o.id, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 2, x_status: "pending" })) as any;
  const r = await khalas(env);
  assert("a line the valid list does not carry never takes an older day's price (19 of yesterday): it leaves the quotation, which is made of the rest", confirmButton(r, o.id) && body(r).startsWith("🌿 غير متوفر اليوم (ما دخل العرض): خيار.") && body(r).includes("المجموع: 72 ر.س") && !/نراجع السعر/.test(body(r)) && !cucumber.x_unit_price && cucumber.x_status === "unavailable" && rows("x_quotation").length === 1, JSON.stringify([body(r), cucumber]));
  // Baraa's own price on a line, set before the quotation, is his decision whatever the list holds
  const mine = table("x_daily_order_line").get(seed("x_daily_order_line", { x_order_id: o.id, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 2, x_status: "pending", x_price_unit_manual: 25 })) as any;
  const r2 = await khalas(env);
  assert("…Baraa's manual price on a line: quoted, and that price is the frozen one", confirmButton(r2, o.id) && mine.x_unit_price === 25 && mine.x_status === "pending" && body(r2).includes("• خيار جرم × 2 = 50 ر.س"), JSON.stringify([body(r2), mine]));
}

// ---------------------------------------------------------------- the note
console.log("\n[ب] the fixed note: every quotation (text and PDF) and the day's prices message");
{
  const NOTE = "السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.";
  assert("the note's wording", OF.PRICE_NOTE === NOTE);
  const parts = PR.buildPriceMessages(DAY, [{ productName: "طماطم", packagingName: "كرتون", salePrice: 24 }]);
  assert("the 06:00 prices message (a free text) ends with it, and no longer says «قبل الساعة 9:00» as a closing time", parts[parts.length - 1].includes(NOTE) && /اطلب من هنا في أي وقت/.test(parts[parts.length - 1]) && !/الأسعار لطلبات اليوم\. اطلب من هنا قبل/.test(parts.join("\n")), parts[parts.length - 1]);
  const many = PR.buildPriceMessages(DAY, Array.from({ length: 200 }, (_, i) => ({ productName: `صنف ${i}`, packagingName: "كرتون", salePrice: 10 + i })), 600);
  assert("…in a message cut in parts: once, at the end of the last part", many.length > 1 && many[many.length - 1].includes(NOTE) && many.slice(0, -1).every((p) => !p.includes(NOTE)));
  const html = QUO.renderQuotationHTML({ ...QUO.TEST_QUOTATION_DATA, issued: false });
  assert("the quotation's PDF footer carries it, and its validity is «حتى الساعة ٦:٠٠ صباحاً من اليوم التالي»", html.includes(NOTE) && html.includes("٦:٠٠ صباحاً من اليوم التالي") && !html.includes("٩:٠٠ مساءً"));
  assert("the quotation's plain-text fallback (inside the window) carries it too", /\$\{QUOTATION_FOOTER\}\. شكراً/.test(srcOf("quotation.ts")) && QUO.QUOTATION_FOOTER.startsWith(NOTE));
}

// ================================================================ [ج] the delivery on the spot
console.log("\n[ج] a confirmed order is delivered on the spot, whatever its registered delivery day");
{
  assert("«تسليم 12», «تم التسليم #12», «التسليم ١٢», «تسليم الطلب رقم 12» → 12; anything else → null",
    OF.deliverCommandOrderId("تسليم 12") === 12 && OF.deliverCommandOrderId("تم التسليم #12") === 12 && OF.deliverCommandOrderId("التسليم ١٢") === 12 && OF.deliverCommandOrderId(" تسليم الطلب رقم 12 ") === 12
    && OF.deliverCommandOrderId("تسليم") === null && OF.deliverCommandOrderId("تم تسليم 12 كرتون طماطم") === null && OF.deliverCommandOrderId("12") === null && OF.deliverCommandOrderId("تسليم 12 و 13") === null);
}
{
  const env = world(`${DAY} 21:30`); taxWorld();
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  graph.length = 0;
  await tap(env, `confirm_order_${o.id}`);
  // § 55 ب — the button is «📦 سلّم وحصّل» (the delivery and collection form) where it was «تم التسليم ✅»;
  // the old button of a message sent before still delivers the whole order (the taps below)
  const toOwner = sentTo(OWNER).filter((b: any) => b.type === "interactive" && (b.interactive?.action?.buttons ?? []).some((x: any) => x.reply.id === `dlv_${o.id}`));
  assert("the confirmed order reaches Baraa with its delivery button («📦 سلّم وحصّل», § 55)", toOwner.length === 1 && toOwner[0].interactive.action.buttons.length === 1 && toOwner[0].interactive.action.buttons[0].reply.title === "📦 سلّم وحصّل", JSON.stringify(sentTo(OWNER)).slice(0, 300));
  const t = String(toOwner[0]?.interactive?.body?.text);
  assert("…with the customer, the items, the total (3 × 24 = 72) and the registered delivery day", t.includes(`#${o.id}`) && t.includes("مطعم الوادي") && t.includes("• طماطم كرتون × 3") && t.includes("المجموع: 72 ر.س") && t.includes("صباح الاثنين 5 أكتوبر 2026"), t);
  assert("the order's registered delivery is the day after tomorrow (its ordering day is tomorrow)", table("x_daily_order").get(o.id)!.x_order_date === NEXT && table("x_daily_order").get(o.id)!.x_state === "confirmed");
  graph.length = 0;
  setRiyadh(`${DAY} 21:40`);
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `delivered_${o.id}`, title: "تم التسليم ✅" } } })), env, ctx));
  const od = table("x_daily_order").get(o.id)! as any;
  assert("Baraa's tap, the same evening: the order is delivered, with the moment of the delivery, marked «تسليم فوري»", od.x_state === "delivered" && od.x_delivered_at === utc(`${DAY} 21:40`) && od.x_immediate_delivery === true, JSON.stringify(od));
  const inv = invoicesOf(o.id)[0];
  assert("…its invoice is issued (72, dated the day of the delivery, a tax invoice) and sent to the customer", inv?.x_total === 72 && inv.x_invoice_date === DAY && inv.x_tax_amount > 0 && sentTo(C1_PHONE).some((b: any) => JSON.stringify(b).includes(inv.x_invoice_number)), JSON.stringify(inv));
  assert("…the collector gets its collection request, as at any delivery", sentTo(COLL_PHONE).length + heldFor(env, COLL_PHONE).length >= 1);
  assert("…Baraa is answered «تم التسليم ✅ … سُلّم فوراً»", sentTo(OWNER).some((b: any) => /تم التسليم ✅/.test(String(b.text?.body)) && /سُلّم فوراً/.test(String(b.text?.body))), JSON.stringify(sentTo(OWNER)).slice(0, 300));
  const before = invoicesOf(o.id).length;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `delivered_${o.id}`, title: "تم التسليم ✅" } } })), env, ctx));
  assert("a second tap: no second invoice", invoicesOf(o.id).length === before);
  setRiyadh(`${NEXT} 21:15`);
  graph.length = 0;
  await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
  assert("the next day's 21:15 purchase list (the order's own day) does not carry it: no list at all", rows("x_purchase_list").length === 0 && table("x_daily_order").get(o.id)!.x_state === "delivered");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 14:00`); taxWorld();
  published(DAY, 24);
  await order3(env); await khalas(env);
  const o = orderOfC1()[0];
  const early = await tap(env, `delivered_${o.id}`, null);
  assert("an order the customer has not confirmed is not delivered: nothing written, no invoice", /لم يؤكده العميل بعد/.test(body(early)) && table("x_daily_order").get(o.id)!.x_state === "waiting_confirmation" && invoicesOf(o.id).length === 0, body(early));
  await tap(env, `confirm_order_${o.id}`);
  seed("res.partner", { id: 777, name: "مطعم آخر", x_whatsapp_number: "+966500000777", customer_rank: 1 });
  const other = seed("x_daily_order", { x_customer_id: 777, x_state: "confirmed", x_order_date: DAY, x_created_via: "whatsapp", x_price_date: DAY });
  seed("x_daily_order_line", { x_order_id: other, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 5, x_unit_price: 24, x_status: "pending" });
  const late = await tap(env, `delivered_${o.id}`, null);
  assert("…the refusal kept no lock: after his confirmation the same button delivers (the same day, 14:00)", /تم التسليم ✅/.test(body(late)) && table("x_daily_order").get(o.id)!.x_state === "delivered" && invoicesOf(o.id).length === 1, body(late));
  setRiyadh(`${DAY} 21:15`);
  await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
  const list = rows("x_purchase_list")[0] as any;
  const items = JSON.parse(String(list?.x_aggregated_items ?? "[]"));
  assert("tonight's 21:15 list: the other confirmed order alone (5 cartons), the delivered one is not in it", items.length === 1 && items[0].total_quantity === 5 && JSON.stringify(items[0].order_ids) === JSON.stringify([other]), JSON.stringify(items));
}
{
  const env = world(`${DAY} 22:00`); taxWorld();
  const a = seed("x_daily_order", { x_customer_id: C1, x_state: "in_purchase", x_order_date: DAY, x_created_via: "whatsapp", x_price_date: DAY, x_delivery_neighborhood: "العليا" });
  seed("x_daily_order_line", { x_order_id: a, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 24, x_status: "pending" });
  seed("x_daily_order_line", { x_order_id: a, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 2, x_unit_price: 30, x_status: "pending" });
  const list = seed("x_purchase_list", { x_date: DAY, x_status: "sent", x_total_items_count: 2, x_utak_simulation: false, x_aggregated_items: JSON.stringify([
    { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 8, order_ids: [a, 4242] },
    { product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 2, order_ids: [a] },
  ]) });
  const done2 = seed("x_purchase_list", { x_date: PREV, x_status: "done", x_total_items_count: 1, x_utak_simulation: false, x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 3, order_ids: [a] }]) });
  const r = await tap(env, `delivered_${a}`, null);
  const left = JSON.parse(String((table("x_purchase_list").get(list) as any).x_aggregated_items));
  assert("an order already on tonight's list (not bought yet), delivered on the spot: its quantities leave the list — tomato 8 → 5, cucumber gone", /سُلّم فوراً/.test(body(r)) && left.length === 1 && left[0].total_quantity === 5 && JSON.stringify(left[0].order_ids) === "[4242]" && (table("x_purchase_list").get(list) as any).x_total_items_count === 1, JSON.stringify(left));
  assert("…a list already bought («تم الشراء») is not touched; Baraa is told which list changed", JSON.parse(String((table("x_purchase_list").get(done2) as any).x_aggregated_items))[0].total_quantity === 3 && ownerTexts().some((x) => x.includes(`#${list}`) && /خرجت كمياته/.test(x)), ownerTexts().join(" | ").slice(0, 300));
}
{
  const env = world(`${DAY} 11:00`); taxWorld();
  const a = seed("x_daily_order", { x_customer_id: C1, x_state: "confirmed", x_order_date: DAY, x_created_via: "whatsapp", x_price_date: DAY, x_delivery_neighborhood: "العليا" });
  seed("x_daily_order_line", { x_order_id: a, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 24, x_status: "pending" });
  openWindow(env, DRIVER_PHONE);
  await quiet(() => worker.fetch(signed(inbound(DRIVER_PHONE, { type: "text", text: { body: `تسليم ${a}` } })), env, ctx));
  assert("the driver's «تسليم N» (a confirmed order has no stop message, so no button): delivered on the spot, the invoice issued", table("x_daily_order").get(a)!.x_state === "delivered" && invoicesOf(a).length === 1 && sentTo(DRIVER_PHONE).some((b: any) => /سُلّم فوراً/.test(String(b.text?.body))), JSON.stringify(sentTo(DRIVER_PHONE)).slice(0, 300));
  const b = seed("x_daily_order", { x_customer_id: C1, x_state: "in_delivery", x_order_date: PREV, x_created_via: "whatsapp", x_price_date: PREV });
  seed("x_daily_order_line", { x_order_id: b, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 1, x_unit_price: 20, x_status: "purchased" });
  seed("x_delivery_stop", { x_order_id: b, x_status: "pending" });
  const r = await tap(env, `delivered_${b}`, DRIVER);
  assert("control — a stop of a route: delivered as before, not marked «تسليم فوري»", /تم التسليم ✅/.test(body(r)) && !/فوراً/.test(body(r)) && table("x_daily_order").get(b)!.x_state === "delivered" && !table("x_daily_order").get(b)!.x_immediate_delivery && invoicesOf(b).length === 1, body(r));
}

// ================================================================ the documents
console.log("\n[docs] the operating day says the new hours");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  assert("the guide: orders at every hour, the price valid until 06:00, the order that waits, the delivery on the spot, the sources' role, the week of selling from the car",
    /في أي ساعة/.test(guide) && /حتى 06:00/.test(guide) && guide.includes("استلمنا طلبك ✅ الأسعار تتحدث") && /تسليم فوري|التسليم الفوري/.test(guide) && guide.includes("### دور المصدر") && guide.includes("أحمد حسان = شراء، وعمر = سوق") && /البيع من السيارة/.test(guide));
  assert("…and no longer says the minimum is 150 or that ordering closes at 21:00", !/أقل طلب 150 ريال\*\*/.test(guide) && !/الطلبات تُستقبل من 06:00 إلى 21:00/.test(guide) && !/استقبال طلبات اليوم انقفل/.test(guide));
}

done();
