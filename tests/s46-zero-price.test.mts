// § 46 ج — the zero-price guard (2026-10-01, src/zero-price.ts): no quotation and no invoice with a
// line priced ≤ 0 or without a price. The quotation: not created, «نراجع السعر وأرد عليك», Baraa's
// alert with the order and the item. The invoice at «تم التسليم»: not issued, the delivery goes on,
// and the every-5-minutes tick issues and sends it once the price is corrected in Odoo.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s46-zero-price.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  COLL_PHONE, CUST, CUST_PHONE, OWNER, employee, graph, heldFor, odooLog, openWindow, partnerOf, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, table, workSchedule,
} from "./wa-harness.mts";
import {
  AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, FIX, OMAR_EMP, assert, cost, dayOf, deliveredAt, done, dp, fourLines, fresh, lineFor, market, ownerTexts, rejected, setExtract,
} from "./s46-kit.mts";

const ZP = await import("../src/zero-price.ts");
const QUO = await import("../src/quotation.ts");
const TEAM = await import("../src/team.ts");
const { dispatch } = await import("../src/router.ts");

// ================================================================ [ج] the zero-price guard
console.log("\n[ج] a price ≤ 0, empty or not a number is not a price");
{
  assert("0, −5, null, undefined, false, NaN, \"12\" → zero; 0.01 and 30 → a price", [0, -5, null, undefined, false, NaN, "12"].every((x) => ZP.isZeroPrice(x)) && !ZP.isZeroPrice(0.01) && !ZP.isZeroPrice(30));
  assert("the customer's text", ZP.PRICE_REVIEW_TEXT.startsWith("نراجع السعر وأرد عليك"));
}
/** Today's published tomato at 30; cucumber has no price anywhere. */
function priced(day = DAY): void {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار ${day}`, x_utak_simulation: false });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_market_price: 30, x_sale_price: 30, x_status: "auto", x_excluded: false, x_blocked: false });
}
function orderOf(day: string, lines: Array<[number, number, number]>, state = "draft", extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: state, x_order_date: day, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا", ...extra });
  for (const [p, k, q] of lines) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_status: "pending" });
  return id;
}
const lineOf = (orderId: number, product: number) => rows("x_daily_order_line").find((l: any) => l.x_order_id === orderId && l.x_product_tmpl_id === product) as any;
const say = (env: any, text: string, id: string) => quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: id, type: "text", text, timestamp: "0" } as any, intent: "request_quotation", senderType: "customer", partner: partnerOf(C1) as any }));
const tap = (env: any, buttonId: string, id: string, who = C1) => quiet(() => dispatch(env, { msg: { from: "+x", fromRaw: "x", profileName: "", messageId: id, type: "button", buttonId, text: "", timestamp: "0" } as any, intent: "other", senderType: "customer", partner: partnerOf(who) as any }));
const zeroAlerts = (re: RegExp) => ownerTexts().filter((t) => re.test(t));

console.log("\n[ج] the quotation: not created, «نراجع السعر وأرد عليك», Baraa's alert with the order and the item");
{
  const env = fresh(`${DAY} 10:00`); priced();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  const o = orderOf(DAY, [[1, 11, 10], [2, 21, 2]]);                  // tomato 300 + cucumber without a price
  const z = await quiet(() => ZP.orderZeroLines(env, o));
  assert("the order's lines without a price: cucumber alone", z?.zero.length === 1 && z.zero[0].product === "خيار", JSON.stringify(z));
  const r1 = await say(env, "خلاص", "z1");
  assert("«خلاص» → «نراجع السعر وأرد عليك», no buttons", String(r1.text).startsWith("نراجع السعر وأرد عليك") && !r1.buttons, JSON.stringify(r1));
  assert("…no x_quotation, the order still open (draft)", rows("x_quotation").length === 0 && table("x_daily_order").get(o)!.x_state === "draft");
  const a = zeroAlerts(/عرض سعر لم يُرسل/);
  assert("…Baraa's alert: the order's number, the customer and the item", a.length === 1 && a[0].includes(`الطلب #${o}`) && a[0].includes("مطعم الوادي") && /• خيار \(جرم\)/.test(a[0]) && !/طماطم/.test(a[0]), a[0]);
  const r2 = await say(env, "خلاص", "z2");
  assert("a second «خلاص» the same day: the same text, no second alert", String(r2.text).startsWith("نراجع السعر وأرد عليك") && zeroAlerts(/عرض سعر لم يُرسل/).length === 1 && rows("x_quotation").length === 0);
  lineOf(o, 2).x_price_unit_manual = 25;                              // Baraa corrects the price in Odoo
  const r3 = await say(env, "خلاص", "z3");
  assert("the price corrected («سعر يدوي للوحدة») → the quotation with its confirm button", (r3.buttons ?? []).some((b: any) => b.id === `confirm_order_${o}`) && rows("x_quotation").length === 1 && table("x_daily_order").get(o)!.x_state === "waiting_confirmation", JSON.stringify(r3));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 10:00`); priced();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  const o = orderOf(DAY, [[1, 11, 10]]);
  lineOf(o, 1).x_unit_price = -5; lineOf(o, 1).x_price_unit_manual = 0;
  table("x_price_day_line").forEach((l: any) => { l.x_sale_price = 0; });   // today's published price is 0 too
  const r = await say(env, "خلاص", "z4");
  assert("a negative unit price and a published price of 0: still «نراجع السعر وأرد عليك», no quotation", String(r.text).startsWith("نراجع السعر وأرد عليك") && rows("x_quotation").length === 0, JSON.stringify(r));
}
{
  const env = fresh(`${DAY} 10:00`); priced();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  const o = orderOf(DAY, [[1, 11, 10]]);
  const r = await say(env, "خلاص", "z5");
  assert("control: every line priced → the quotation as before, no alert", (r.buttons ?? []).length === 3 && rows("x_quotation").length === 1 && zeroAlerts(/لم يُرسل/).length === 0 && table("x_daily_order").get(o)!.x_state === "waiting_confirmation", JSON.stringify(r));
}
{
  const env = fresh(`${DAY} 10:00`); priced();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  env.MSG_DEDUP.store.set(`ordering_open_${DAY}`, "true");
  setExtract([{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 10 }, { product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 }]);
  const r = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "z9", type: "text", text: "طماطم كرتون 10 وخيار جرم 2 خلاص", timestamp: "0" } as any, intent: "place_order", senderType: "customer", partner: partnerOf(C1) as any }));
  setExtract(null);
  const o = rows("x_daily_order").find((x: any) => x.x_customer_id === C1 && x.x_order_date === DAY) as any;
  assert("«… خلاص» in the order's own message: the items recorded, «نراجع السعر وأرد عليك», no quotation, no button, the order open",
    /أضفنا لطلبك|بديت لك طلب جديد/.test(String(r.text)) && /نراجع السعر وأرد عليك/.test(String(r.text)) && !r.buttons && rows("x_quotation").length === 0 && o?.x_state === "draft" && zeroAlerts(/عرض سعر لم يُرسل/).length === 1, JSON.stringify(r));
}
{
  const env = fresh(`${DAY} 10:00`); priced();
  const o = orderOf(DAY, [[1, 11, 10], [2, 21, 2]], "waiting_confirmation");
  const r = await tap(env, `confirm_order_${o}`, "z6");
  assert("an old «تأكيد الطلب» tap on an order with a line without a price: not confirmed, back to draft, the text and the alert", String(r.text).startsWith("نراجع السعر وأرد عليك") && table("x_daily_order").get(o)!.x_state === "draft" && zeroAlerts(/عرض سعر لم يُرسل/).length === 1, JSON.stringify(r));
}
{
  const env = fresh(`${DAY} 20:00`); priced();
  openWindow(env, C1_PHONE, 30);
  const o = orderOf(DAY, [[1, 11, 10], [2, 21, 2]], "waiting_confirmation");
  await quiet(() => TEAM.sendCutoffReminders(env));
  assert("ح3 20:00 reminds it as any unconfirmed order (its «تأكيد الطلب» is what is guarded)", sentTo(C1_PHONE).some((b: any) => b.type === "interactive" && (b.interactive?.action?.buttons ?? []).some((x: any) => x.reply.id === `confirm_order_${o}`)), JSON.stringify(sentTo(C1_PHONE)).slice(0, 300));
  const r = await tap(env, `confirm_order_${o}`, "z7");
  assert("…the tap on the reminder's button: not confirmed, «نراجع السعر وأرد عليك», back to draft, Baraa's alert", String(r.text).startsWith("نراجع السعر وأرد عليك") && table("x_daily_order").get(o)!.x_state === "draft" && zeroAlerts(/عرض سعر لم يُرسل/).length === 1, JSON.stringify(r));
  lineOf(o, 2).x_unit_price = 25;
  env.MSG_DEDUP.store.delete(`btnlock:v1:order:${o}:confirm_order`);   // ح8's 90-second tap lock has expired (the harness KV keeps keys)
  const r2 = await tap(env, `confirm_order_${o}`, "z8");
  assert("…priced: the same button confirms", /تم التأكيد/.test(String(r2.text)) && table("x_daily_order").get(o)!.x_state === "confirmed", JSON.stringify(r2));
}
{
  const env = fresh(`${DAY} 10:00`); priced();
  const o = orderOf(DAY, [[1, 11, 10], [2, 21, 2]], "waiting_confirmation");
  const q = seed("x_quotation", { x_order_id: o, x_quotation_number: "UTAK-Q-20261003-001", x_customer_response: "pending", x_origin: "auto", create_date: "2026-10-03 07:00:00" });
  const res = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, q));
  const a = zeroAlerts(/ما أرسلناه للعميل/);
  assert("the PDF pipeline keeps its own block: nothing sent, x_sent_at empty, Baraa's alert with the order and the item", res?.blocked === true && !table("x_quotation").get(q)!.x_sent_at && sentTo(C1_PHONE).length === 0 && a.length === 1 && a[0].includes(`الطلب #${o}`) && /• خيار/.test(a[0]), JSON.stringify([res, a]));
}

console.log("\n[ج] the invoice at «تم التسليم»: not issued, the delivery goes on, issued by the tick once the price is corrected");
const invoicesOf = (orderId: number) => rows("x_invoice").filter((i: any) => i.x_order_id === orderId);
const invoiceSends = () => sentTo(C1_PHONE).filter((b: any) => /فاتورتك رقم/.test(String(b?.text?.body ?? b?.interactive?.body?.text ?? "")) || /invoice/.test(String(b?.template?.name ?? "")));
function onTheWay(day: string, lines: Array<[number, number, number]>): number {
  // the company's sale tax (15 %, price-included), as on the tenant from 2026-10-01
  if (!table("res.company").size) {
    seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
    seed("res.company", { id: 1, name: "UTAK Company", vat: "300000000000003", account_sale_tax_id: [77, "15%"] });
  }
  const id = orderOf(day, lines, "in_delivery");
  seed("x_delivery_stop", { x_order_id: id, x_status: "pending" });
  return id;
}
{
  const env = fresh(`${DAY} 08:40`); priced("2026-10-02"); priced(DAY);
  openWindow(env, C1_PHONE);
  const o = onTheWay("2026-10-02", [[1, 11, 5], [2, 21, 2]]);
  const r = await tap(env, `delivered_${o}`, "d1", DRIVER);
  assert("«تم التسليم»: the driver's reply, the order delivered", /تم التسليم ✅/.test(String(r.text ?? r.bodyBeforeButtons)) && table("x_daily_order").get(o)!.x_state === "delivered", JSON.stringify(r));
  assert("…no x_invoice, nothing invoiced to the customer, no collection request", invoicesOf(o).length === 0 && invoiceSends().length === 0 && sentTo(COLL_PHONE).length === 0 && heldFor(env, COLL_PHONE).length === 0);
  const a = zeroAlerts(/فاتورة لم تصدر/);
  assert("…Baraa's alert: the order's number, the customer, the item, and that it will issue by itself", a.length === 1 && a[0].includes(`الطلب #${o}`) && a[0].includes("مطعم الوادي") && /• خيار \(جرم\)/.test(a[0]) && /تلقائياً خلال 5 دقائق/.test(a[0]), a[0]);
  assert("…the order is remembered for the tick", JSON.stringify(await ZP.heldZeroInvoices(env)) === JSON.stringify([o]));
  setRiyadh(`${DAY} 08:45`);
  const t1 = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("the tick while the price is still missing: «waiting», no invoice, no second alert", t1.length === 1 && t1[0].action === "waiting" && invoicesOf(o).length === 0 && zeroAlerts(/فاتورة لم تصدر/).length === 1, JSON.stringify(t1));
  lineOf(o, 2).x_unit_price = 25;                                     // Baraa corrects it in Odoo
  setRiyadh(`${DAY} 08:50`);
  const t2 = await quiet(() => ZP.runZeroInvoiceTick(env));
  const [inv] = invoicesOf(o);
  assert("the price corrected → the next tick issues the invoice: 5 × 30 + 2 × 25 = 200", t2[0].action === "issued" && invoicesOf(o).length === 1 && inv.x_total === 200 && t2[0].invoice === inv.x_invoice_number, JSON.stringify([t2, inv]));
  assert("…and sends it to the customer, once, and the collection request goes", invoiceSends().length === 1 && !!inv.x_invoice_sent_at && (sentTo(COLL_PHONE).length >= 1 || heldFor(env, COLL_PHONE).length >= 1));
  assert("…and the order leaves the list", (await ZP.heldZeroInvoices(env)).length === 0);
  setRiyadh(`${DAY} 08:55`);
  const t3 = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("later ticks: nothing, still one invoice and one message", t3.length === 0 && invoicesOf(o).length === 1 && invoiceSends().length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 08:40`); priced("2026-10-02"); priced(DAY);
  openWindow(env, C1_PHONE);
  const o = onTheWay("2026-10-02", [[2, 21, 2]]);
  await tap(env, `delivered_${o}`, "d2", DRIVER);
  assert("every line without a price: no invoice either, held", invoicesOf(o).length === 0 && (await ZP.heldZeroInvoices(env)).includes(o));
  lineOf(o, 2).x_price_unit_manual = 40;
  const t = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("corrected with «سعر يدوي للوحدة» → issued at it (2 × 40 = 80)", t[0].action === "issued" && invoicesOf(o)[0].x_total === 80, JSON.stringify([t, invoicesOf(o)]));
}
{
  const env = fresh(`${DAY} 08:40`); priced("2026-10-02"); priced(DAY);
  openWindow(env, C1_PHONE);
  const o = onTheWay("2026-10-02", [[1, 11, 5]]);
  await tap(env, `delivered_${o}`, "d3", DRIVER);
  assert("control: every line priced → the invoice at «تم التسليم» as before (150), nothing held, no alert", invoicesOf(o).length === 1 && invoicesOf(o)[0].x_total === 150 && (await ZP.heldZeroInvoices(env)).length === 0 && zeroAlerts(/لم تصدر/).length === 0, JSON.stringify(invoicesOf(o)));
  odooLog.length = 0;
  const none = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("the tick with nothing held: no Odoo read at all", none.length === 0 && odooLog.length === 0);
  await quiet(() => ZP.holdZeroInvoice(env, 777, "مطعم الوادي", [{ product: "خيار", packaging: "جرم" }]));
  await quiet(() => ZP.holdZeroInvoice(env, 777, "مطعم الوادي", [{ product: "خيار", packaging: "جرم" }]));
  assert("an order held twice: listed once, alerted once", JSON.stringify(await ZP.heldZeroInvoices(env)) === "[777]" && zeroAlerts(/فاتورة لم تصدر — الطلب #777/).length === 1, JSON.stringify(ownerTexts()));
}
{
  const env = fresh(`${DAY} 08:40`); priced("2026-10-02"); priced(DAY);
  openWindow(env, C1_PHONE);
  const o = onTheWay("2026-10-02", [[1, 11, 5], [2, 21, 2]]);
  await tap(env, `delivered_${o}`, "d4", DRIVER);
  lineOf(o, 2).x_status = "unavailable";                              // Baraa marks the unpriced line short instead
  const t = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("the unpriced line marked short → the invoice for the rest (150)", t[0].action === "issued" && invoicesOf(o)[0].x_total === 150, JSON.stringify(t));
  const o2 = onTheWay("2026-10-02", [[2, 21, 2]]);
  await tap(env, `delivered_${o2}`, "d5", DRIVER);
  env.MSG_DEDUP.store.set(ZP.ZERO_INVOICE_INDEX, JSON.stringify([{ o: o2, at: Date.now() - ZP.ZERO_INVOICE_KEEP_MS - 1000 }]));
  const old = await quiet(() => ZP.runZeroInvoiceTick(env));
  assert("held more than 30 days: dropped from the list (no invoice)", old[0].action === "dropped" && invoicesOf(o2).length === 0 && (await ZP.heldZeroInvoices(env)).length === 0, JSON.stringify(old));
}

// ================================================================ [س]
console.log("\n[س] schema");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));
{
  const idx = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const tick = idx.split('case "*/5 * * * *": {')[1].split('case "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"')[0];
  assert("*/5: runZeroInvoiceTick (a held invoice issued once its price is corrected)", /const zi = await runZeroInvoiceTick\(rawEnv, Date\.now\(\)\);/.test(tick));
}

done();
