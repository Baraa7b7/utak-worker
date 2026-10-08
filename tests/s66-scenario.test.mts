// § 66 (2026-10-08) — the whole road, once, through the worker's own doors: a special quotation is issued →
// the customer writes «تمام اعتمدوا» → Baraa presses «✅ العميل وافق» and «📦 حوّل لطلب» (Odoo's two webhooks) →
// the 21:15 purchase list of the delivery's eve → «تم الشراء» → a new day's prices are published → the delivery
// by «📦 سلّم وحصّل» → the invoice → the day's figures. Who got what is counted at the end: the customer, Baraa
// and the buyer — and no source of prices a word.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s66-scenario.test.mts

import { CUST, OWNER, WH_PHONE, ctx, inbound, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { assert, done, dp, rejected } from "./s46-kit.mts";
import {
  AHMED, AHMED_PHONE, DAY, MADARAT_PHONE, MARKETING_ROLE, MUSHROOM, OMAR, ORANGE, QUOTE, RAED_PHONE,
  linesOf, orderLines, ordersOf, ownerSaid, priced, quote, round, saleOrders, textsTo, utc, world,
  type Row,
} from "./s66-kit.mts";

const ACC = await import("../src/special-accept.ts");
const QT = await import("../src/special-quotation.ts");
const M = await import("../src/special-quote-math.ts");
const TEAM = await import("../src/team.ts");
const DF = await import("../src/delivery-form.ts");
const INS = await import("../src/day-insight.ts");
const SUM = await import("../src/owner-summary.ts");
const PV = await import("../src/price-validity.ts");
const worker = (await import("../src/index.ts")).default;

const now = () => Date.now();
const NEXT = "2026-10-04";
/** Odoo's webhook of a button of the request's form: 202 at once, the work a moment later (awaited here). */
async function press(env: any, op: string, id: number): Promise<number> {
  const pending: Promise<unknown>[] = [];
  const res = await quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/special-quote?op=${op}&token=HOOK`, { method: "POST", body: JSON.stringify({ _model: QUOTE, _id: id }) }), env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} } as any));
  await quiet(() => Promise.all(pending));
  return res.status;
}

const env = world(`${DAY} 14:00`);
table("hr.employee").get(7000 + OMAR)!.x_utak_role_ids = [72, MARKETING_ROLE];
table("res.partner").get(890)!.x_pay_terms = "daily_transfer";
const ACTION = seed("ir.actions.act_window", { name: "UTAK — طلبات أسعار خاصة", res_model: QUOTE });
dp(1, 11, 20);
// the day's list of 10-03 (tomato at 31, bought at 15), as published at 06:00
const day = seed("x_price_day", { x_date: DAY, x_state: "published", x_name: "أسعار", x_utak_simulation: false, x_published_at: utc(`${DAY} 06:00`) });
seed("x_price_day_line", { x_day_id: day, x_sequence: 1, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 15, x_market_price: 31, x_sale_price: 31, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 22, x_utak_simulation: false });

// ============================================================================
console.log("\n[1] 14:00 — the quotation is issued: one unit of each, the prices before VAT");
const UNIT: Array<[number, number, number, string]> = [[ORANGE, 105, 121.3, "18 كيلو"], [1, 55, 63.7, "14 كيلو -مخمر"], [1, 60, 69.35, "14 كيلو -غير مخمر"], [MUSHROOM, 11, 12.83, "كرتون 2 كجم"]];
const GROSS = UNIT.map(([, , net]) => M.grossOf(net));
const id = priced(UNIT.map(([p, buy, , unit]) => [p, 1, buy, 0, unit] as Row), { x_price_mode: "net" });
linesOf(id).forEach((l, i) => Object.assign(l, { x_final_price: 0, x_final_net: UNIT[i][2] }));
assert("«📄 أصدر عرض السعر» (Odoo's webhook): accepted, and the work done", (await press(env, "issue", id)) === 202 && quote(id).x_state === "quoted");
const number = String(quote(id).x_quotation_number);
assert("the customer holds the file of a unit-price quotation; a draft sale order records it", sentTo(MADARAT_PHONE).filter((b: any) => b?.type === "document").length === 1 && saleOrders().length === 1 && saleOrders()[0].state === "draft" && saleOrders()[0].name === number);
assert("each line's two final prices: the one typed before VAT, and that × 1.15 to the halala", linesOf(id).every((l, i) => l.x_final_net === UNIT[i][2] && l.x_final_price === GROSS[i]));

console.log("\n[2] 16:00 — «تمام اعتمدوا العرض» from the customer");
setRiyadh(`${DAY} 16:00`);
await quiet(() => worker.fetch(signed(inbound(MADARAT_PHONE, { type: "text", text: { body: "تمام اعتمدوا العرض" } })), env, ctx));
const hint = ownerSaid().filter((t) => t.includes("يبدو موافقاً"));
assert("ONE alert to Baraa with the request's link — nothing is converted", hint.length === 1 && hint[0].startsWith(`✅ شركة مدارات للاغذية يبدو موافقاً على ${number}\nhttps://odoo.test/odoo/action-${ACTION}/${id}`) && rows("x_daily_order").filter((o: any) => o.x_special_quote_id).length === 0 && quote(id).x_state === "quoted" && !quote(id).x_accepted_at);

console.log("\n[3] 16:10 — «✅ العميل وافق», the quantities, «📦 حوّل لطلب»");
setRiyadh(`${DAY} 16:10`);
assert("«✅ العميل وافق»: accepted (202), and the acceptance opens on the request", (await press(env, "approve", id)) === 202 && quote(id).x_accepted_at === utc(`${DAY} 16:10`) && quote(id).x_delivery_date === NEXT && quote(id).x_pay_terms === "daily_transfer");
assert("pressed before the quantities are typed, «📦 حوّل لطلب» makes nothing", (await press(env, "convert", id)) === 202 && ordersOf(id).length === 0 && String(quote(id).x_last_result).includes("بلا كمية: برتقال، طماطم، طماطم، فطر أبيض"));
env.MSG_DEDUP.store.delete(`btnlock:v1:spq_convert:${id}`);
// 40 cartons of orange, 12 + 6 of the two bananas' lines, the mushroom out: 58 cartons
linesOf(id).forEach((l, i) => { l.x_confirmed_qty = ["40", "12", "6", "0"][i]; });
quote(id).x_delivery_note = "قبل 7 صباحاً";
const custBefore = textsTo(MADARAT_PHONE).length;
assert("«📦 حوّل لطلب»: accepted (202)", (await press(env, "convert", id)) === 202);
const [o] = ordersOf(id);
const TOTAL = round(40 * GROSS[0] + 12 * GROSS[1] + 6 * GROSS[2]);
assert("the order: tonight's (the delivery's eve), confirmed, three lines at the special prices", !!o && o.x_order_date === DAY && o.x_state === "confirmed" && orderLines(o.id).length === 3 && orderLines(o.id).every((l) => l.x_special_price === true) && o.x_total_amount === TOTAL);
assert("the request: «مقبول — تحوّل لطلب» with the order's link", quote(id).x_state === "accepted" && quote(id).x_daily_order_id === o.id);
assert("the customer is told: the order's number, tomorrow morning, the total", textsTo(MADARAT_PHONE).slice(custBefore).some((t) => t === ACC.customerConfirmText(o.id, NEXT, TOTAL, number)));
assert("Baraa: «✅ طلب مؤكد» with «📦 سلّم وحصّل», and «🚚 طلب كبير 58 كرتون: رتّب المركبة»", sentTo(OWNER).some((b: any) => b?.interactive?.action?.buttons?.[0]?.reply?.id === `dlv_${o.id}`) && ownerSaid().filter((t) => t.startsWith("🚚 طلب كبير 58 كرتون: رتّب المركبة — الطلب")).length === 1);
assert("pressed again: nothing more (one order)", (await press(env, "convert", id)) === 202 && ordersOf(id).length === 1);

console.log("\n[4] 21:15 — the purchase list of the delivery's eve");
const daily = order(CUST, "confirmed", DAY, 1);
setRiyadh(`${DAY} 21:15`);
await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
const [list] = rows("x_purchase_list") as any[];
const items: any[] = JSON.parse(String(list.x_aggregated_items));
const name = String(quote(id).x_name);
assert("the special order's three lines beside the day's order: four items, the special ones marked with their target prices", items.length === 4 && items.filter((it) => it.special === name).length === 3 && JSON.stringify(items.filter((it) => it.special).map((it) => it.unit_price).sort()) === JSON.stringify([105, 55, 60].sort()) && items.find((it) => !it.special).unit_price === 20);
const told = String(sentTo(WH_PHONE).find((b: any) => b?.template?.name === "utak_purchase_list_v2")?.template?.components?.[0]?.parameters?.[2]?.text ?? "");
assert("the buyer reads «برتقال — 18 كيلو × 40 (طلب خاص …، الشراء المستهدف 105)»", told.includes(`برتقال — 18 كيلو × 40 (طلب خاص ${name}، الشراء المستهدف 105)`), told);

console.log("\n[5] the delivery day: the morning alert, «تم الشراء», a new day's prices");
setRiyadh(`${NEXT} 02:05`);
const morning = await quiet(() => ACC.runLargeOrderMorning(env, now()));
assert("02:05 — «🚚 طلب كبير 58 كرتون: رتّب المركبة — اليوم تسليم الطلب …», once", morning.length === 1 && morning[0].action === "alerted" && ownerSaid().filter((t) => t.includes("اليوم تسليم الطلب")).length === 1);
// the orange was bought at 104, a riyal under its target: Baraa corrects the list before it is confirmed
list.x_aggregated_items = JSON.stringify(items.map((it) => (it.packaging_name === "18 كيلو" ? { ...it, unit_price: 104 } : it)));
setRiyadh(`${NEXT} 05:30`);
await quiet(() => TEAM.warehouseConfirmedPurchase(env, list.id));
assert("«تم الشراء»: the lines are bought, the order is on a route, and the orange's real price (104) is on its line", orderLines(o.id).every((l) => l.x_status === "purchased") && table("x_daily_order").get(o.id)!.x_state === "in_delivery" && orderLines(o.id).find((l) => l.x_pack_text === "18 كيلو")!.x_special_purchase === 104);
setRiyadh(`${NEXT} 06:00`);
const day2 = seed("x_price_day", { x_date: NEXT, x_state: "published", x_name: "أسعار", x_utak_simulation: false, x_published_at: utc(`${NEXT} 06:00`) });
seed("x_price_day_line", { x_day_id: day2, x_sequence: 1, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 16, x_market_price: 35, x_sale_price: 35, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 24, x_utak_simulation: false });
assert("06:00 — a new day's list is valid (tomato 35): the order's prices are the quotation's still", (await PV.validPriceList(env, now()))!.day === NEXT && orderLines(o.id).every((l, i) => l.x_unit_price === GROSS[i]));

console.log("\n[6] 08:00 — «📦 سلّم وحصّل», and the invoice");
setRiyadh(`${NEXT} 08:00`);
openWindow(env, OWNER);
openWindow(env, MADARAT_PHONE);
const form = await quiet(() => DF.sendDeliveryForm(env, o.id, { kind: "owner", partnerId: null, name: "براء", whatsapp: OWNER }, { now: now() }));
// everything but one carton of «غير مخمر», damaged
await quiet(() => DF.handleDeliveryFormReply(env, { from: "+" + OWNER, messageId: "wamid.SCN", flow: { token: form.token!, values: { q1: "40", r1: "none", q2: "12", r2: "none", q3: "5", r3: "damaged", pay: "unpaid", amt: "", note: "" } } }, undefined, now()));
const [inv] = (rows("x_invoice") as any[]).filter((i) => i.x_order_id === o.id);
const BILLED = round(40 * GROSS[0] + 12 * GROSS[1] + 5 * GROSS[2]);
assert("ONE invoice, of what was delivered at the special prices", !!inv && (rows("x_invoice") as any[]).filter((i) => i.x_order_id === o.id).length === 1 && inv.x_total === BILLED && table("x_daily_order").get(o.id)!.x_state === "delivered");
assert("…the lines delivered whole add up to the quotation's own numbers, to the halala: 40 × 139.49 and 12 × 73.26", round(40 * GROSS[0]) === 5579.6 && round(12 * GROSS[1]) === 879.12 && GROSS[0] === 139.49 && TOTAL - BILLED === GROSS[2]);
assert("…and delivered whole it would have been the confirmed total the customer was told", round(BILLED + GROSS[2]) === quote(id).x_confirmed_total);
assert("the customer got his invoice", sentTo(MADARAT_PHONE).some((b: any) => JSON.stringify(b).includes(String(inv.x_invoice_number))));

console.log("\n[7] 21:30 — the day's figures");
setRiyadh(`${NEXT} 21:30`);
const sold = await INS.readSoldLines(env, NEXT, NEXT);
assert("«📊 اليوم» counts the order's three lines by what they were really bought at (104, 55, 60) — the damaged carton is its waste", sold.lines.filter((l) => l.special).length === 3 && JSON.stringify(sold.lines.filter((l) => l.special).map((l) => [l.quantity, l.purchase, l.returned])) === JSON.stringify([[40, 104, 0], [12, 55, 0], [5, 60, 1]]));
const figures = await quiet(() => SUM.readSummaryFigures(env, now()));
const profit = round(40 * (GROSS[0] / 1.15 - 104 * 1.05) + 12 * (GROSS[1] / 1.15 - 55 * 1.05) + 5 * (GROSS[2] / 1.15 - 60 * 1.05));
assert("the 21:30 summary's profit of the deliveries is the special order's, from the real purchase prices; the day's cost is the system's (600)", figures.coverage.profit === profit && figures.coverage.cost === 600, JSON.stringify([figures.coverage, profit, figures.errors]));
void daily;

console.log("\n[8] who heard of it");
const heard = (d: string) => sentTo(d).length + ((env.MSG_DEDUP.store.get(`wa_held:v1:${d}`) ?? "") ? 1 : 0);
assert("no source of prices got a word of this order: not Ahmed, not Raed", heard(AHMED_PHONE) === 0 && heard(RAED_PHONE) === 0);
assert("the schema gate refused no call on the whole road", rejected.length === 0, rejected.join(" | "));
void AHMED;

done();
