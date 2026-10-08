// § 66 أ / ب (2026-10-08) — «✅ العميل وافق» and «📦 حوّل لطلب»: a special request's acceptance and the day's
// order it becomes (src/special-accept.ts).
//
//   • the acceptance opens on the request: the delivery date (the next working day an order placed now can be
//     delivered on), each line's confirmed quantity where the quotation names one, the customer's payment terms;
//     what Baraa typed stays
//   • a unit-price quotation: «الكمية المؤكدة» is mandatory for every line (0 = out of the order)
//   • the conversion: the order of the delivery date's eve, confirmed, its lines at the quotation's final prices
//     LOCKED («سعر خاص»), items that are not «نشط للبيع» taken; the request «مقبول — تحوّل لطلب»; never twice
//   • an expired quotation: refused, unless «أعتمد الأسعار رغم انتهاء الصلاحية» — and that is recorded
//   • the customer's confirmation: his window, else the confirmation's template, else Baraa sends it
//   • the linked sale order takes the confirmed quantities and is confirmed (ACCOUNTING_SYNC)
//   • a large order: Baraa is told at the conversion and once on the morning of its delivery
//   • a customer's «موافق / نعتمد …»: ONE alert to Baraa, nothing converted
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s66-accept.test.mts

import { OWNER, closeOwnerWindow, ctx, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import {
  AHMED, CONFIRM_TEMPLATE, DAY, GARLIC, LETTUCE, MADARAT, MADARAT_PHONE, MUSHROOM, ORANGE, QUOTE, SERVICE, SIX,
  confirmAs, linesOf, orderLines, ordersOf, ownerSaid, priced, quote, round, saleLines, saleOrders, textsTo, tplTo, unlockConvert, utc, world, writes,
  type Row,
} from "./s66-kit.mts";

const ACC = await import("../src/special-accept.ts");
const SQ = await import("../src/special-quote.ts");
const QT = await import("../src/special-quotation.ts");
const M = await import("../src/special-quote-math.ts");
const GW = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
/** The gateway's 24-hour stop of a purpose Meta refused for a number (here: Baraa's alerts, after a burst — Meta 131056). */
const blockOwnerAlerts = (env: any) => env.MSG_DEDUP.store.set(GW.purposeBlockKey(OWNER, "owner_alert"), JSON.stringify({ code: 131056, at: "2026-10-03T02:02:29.719Z" }));
const unblockOwnerAlerts = (env: any) => env.MSG_DEDUP.store.delete(GW.purposeBlockKey(OWNER, "owner_alert"));

const now = () => Date.now();
const at = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const result = (id: number): string => String(quote(id).x_last_result ?? "");
/** The lines of a unit-price quotation, as Madarat's: one unit of each, the price typed before VAT. [product, buy, net, «التعبئة»] */
const UNIT: Array<[number, number, number, string]> = [[ORANGE, 105, 121.3, "18 كيلو"], [1, 55, 63.7, "14 كيلو -مخمر"], [1, 60, 69.35, "14 كيلو -غير مخمر"], [MUSHROOM, 11, 12.83, "كرتون 2 كجم"]];
/** A request «قبل الضريبة» whose every quantity is 1, priced; `issue` = «📄 أصدر عرض السعر» pressed (the customer's window open). */
async function unitQuote(env: any, extra: Record<string, unknown> = {}, issue = true): Promise<number> {
  const id = priced(UNIT.map(([p, buy, net, unit]) => [p, 1, buy, 0, unit] as Row), { x_price_mode: "net", ...extra });
  linesOf(id).forEach((l, i) => Object.assign(l, { x_final_price: 0, x_final_net: UNIT[i][2] }));
  if (issue) await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  return id;
}
/** A request by quantities («شاملة الضريبة»), priced and issued. */
async function qtyQuote(env: any, lines: Row[] = SIX, extra: Record<string, unknown> = {}): Promise<number> {
  const id = priced(lines, extra);
  await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  return id;
}
const confirm = (id: number, typed: string[]) => linesOf(id).forEach((l, i) => { if (typed[i] !== undefined) l.x_confirmed_qty = typed[i]; });
const approve = (env: any, id: number) => quiet(() => ACC.approveSpecialQuote(env, id, { now: now() }));
const convert = (env: any, id: number) => quiet(() => ACC.convertSpecialQuote(env, id, { now: now(), ctx }));

// ============================================================================
console.log("\n[أ] the confirmed quantity, as typed");
{
  const p = ACC.parseConfirmedQty;
  assert("nothing typed is NOT zero", p("") === null && p("   ") === null);
  assert("a number: Latin or Arabic digits, the Arabic decimal sign and the comma read", p("9") === 9 && p("٩") === 9 && p("0") === 0 && p("2.5") === 2.5 && p("٢٫٥") === 2.5 && p("2,5") === 2.5 && p(" 12 ") === 12);
  assert("anything else is not a quantity", p("-1") === "invalid" && p("تسعة") === "invalid" && p("9 كرتون") === "invalid" && p("1.2345") === "invalid" && p("12345678") === "invalid");
  const line = (qty: number, typed: string, name = "صنف"): any => ({ productName: name, qty, confirmedQty: typed, finalPrice: 10 });
  const unit = ACC.confirmedPlan({ layout: "auto", lines: [line(1, "9", "أ"), line(1, "", "ب"), line(1, "0", "ج"), line(1, "x", "د")] } as any);
  assert("a unit-price quotation: a line with nothing typed is MISSING, 0 is out of the order, a word is unreadable", unit.lines.length === 1 && unit.lines[0].qty === 9 && JSON.stringify(unit.missing) === '["ب"]' && JSON.stringify(unit.out) === '["ج"]' && JSON.stringify(unit.invalid) === '["د"]');
  const qty = ACC.confirmedPlan({ layout: "auto", lines: [line(5, "", "أ"), line(1, "", "ب"), line(7, "3", "ج"), line(4, "0", "د")] } as any);
  assert("a quotation by quantities: nothing typed is the line's own quantity (its 1 too), a typed one replaces it", JSON.stringify(qty.lines.map((x) => x.qty)) === "[5,1,3]" && qty.missing.length === 0 && JSON.stringify(qty.out) === '["د"]');
  const forced = ACC.confirmedPlan({ layout: "unit", lines: [line(5, "", "أ"), line(1, "", "ب")] } as any);
  assert("«أسعار الوحدة» chosen over real quantities: a line that asked for more than one confirms it; a line of 1 is still missing", forced.lines.length === 1 && forced.lines[0].qty === 5 && JSON.stringify(forced.missing) === '["ب"]');
  assert("the confirmed total: each line at its VAT-inclusive final price, to the halala", ACC.confirmedTotal([{ line: { finalPrice: 139.49 } as any, qty: 9 }, { line: { finalPrice: 14.75 } as any, qty: 2.5 }]) === round(9 * 139.49 + round(2.5 * 14.75)));
}

console.log("\n[أ] the dates");
{
  assert("the earliest delivery: tomorrow morning for an order placed before 21:00, the morning after from 21:00", ACC.earliestDeliveryDay(at(`${DAY} 14:00`)) === "2026-10-04" && ACC.earliestDeliveryDay(at(`${DAY} 20:59`)) === "2026-10-04" && ACC.earliestDeliveryDay(at(`${DAY} 21:00`)) === "2026-10-05" && ACC.earliestDeliveryDay(at("2026-10-04 01:00")) === "2026-10-05");
  assert("the next working day: the day itself when it works, else the first that does", ACC.nextWorkingDay("2026-10-04", () => true) === "2026-10-04" && ACC.nextWorkingDay("2026-10-04", (d) => d !== "2026-10-04" && d !== "2026-10-05") === "2026-10-06" && ACC.nextWorkingDay("2026-10-04", () => false) === "2026-10-04");
  assert("expired: past its «صالح حتى» — and a request that carries none never expires", ACC.isExpired("2026-10-03 10:00:00", at(`${DAY} 14:00`)) && !ACC.isExpired("2026-10-03 20:59:59", at(`${DAY} 14:00`)) && !ACC.isExpired("", at(`${DAY} 14:00`)));
  const env = world();
  assert("no «جدول أيام العمل» named: the earliest delivery day", (await ACC.defaultDeliveryDay(env, now())) === "2026-10-04");
  // Saturday 10-03: a schedule without Sunday (Odoo's weekday 6) and Monday (0)
  const env2 = world();
  table("x_pricing_config").get(1)!.x_workdays_calendar_id = workSchedule([[5, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12], [4, 2, 12]], { name: "UTAK — أيام العمل" });
  assert("«جدول أيام العمل» without Sunday and Monday: the delivery moves to Tuesday", (await ACC.defaultDeliveryDay(env2, now())) === "2026-10-06");
}

console.log("\n[ج] the cartons of a large order");
{
  assert("a line's cartons are its quantity («التعبئة» is what it is carried in)", JSON.stringify(ACC.lineCartons(9, "18 كيلو", 10)) === '{"cartons":9,"kilos":0}' && JSON.stringify(ACC.lineCartons(4, "كرتون 18 كجم", 0)) === '{"cartons":4,"kilos":0}');
  assert("a line sold by the kilo: its kilos ÷ the item's packaging weight — an unknown weight is told apart, never guessed", JSON.stringify(ACC.lineCartons(500, "كيلو", 10)) === '{"cartons":50,"kilos":0}' && JSON.stringify(ACC.lineCartons(500, " كجم ", 0)) === '{"cartons":0,"kilos":500}' && M.isKiloUnit("KG") && !M.isKiloUnit("18 كيلو"));
  assert("the order's cartons: whole (a carton started is a carton)", JSON.stringify(ACC.orderCartons([{ qty: 9, unit: "كرتون", packKg: 0 }, { qty: 105, unit: "كيلو", packKg: 10 }, { qty: 30, unit: "كيلو", packKg: 0 }])) === '{"cartons":20,"kilos":30}');
  assert("«🚚 طلب كبير {N} كرتون: رتّب المركبة»", ACC.largeOrderText(60, 0, "") === "🚚 طلب كبير 60 كرتون: رتّب المركبة" && ACC.largeOrderText(60, 30, "الطلب #7") === "🚚 طلب كبير 60 كرتون و30 كيلو: رتّب المركبة — الطلب #7");
  const env = world();
  assert("«حد الطلب الكبير» from the settings; none or zero: 50", (await ACC.largeOrderLimit(env, DAY)) === 50 && (table("x_pricing_config").get(1)!.x_large_order_cartons = 20, await ACC.largeOrderLimit(env, DAY)) === 20 && (table("x_pricing_config").get(1)!.x_large_order_cartons = 0, await ACC.largeOrderLimit(env, DAY)) === ACC.LARGE_ORDER_DEFAULT && ACC.LARGE_ORDER_DEFAULT === 50);
}

console.log("\n[أ] a customer's acceptance, in his own words");
{
  const yes = ["موافق", "موافقين على العرض", "نعتمد", "تمام اعتمدوا", "أكدوا الطلب", "تمام، نعتمد العرض", "اعتمدوه", "مُوافِق", "OK", "Approved, go ahead", "على بركة الله"];
  const no = ["غير موافق", "ما نعتمد", "مو موافقين", "لسنا موافقين على السعر", "not ok", "كم سعر الموز اليوم؟", "ابغى كرتون طماطم", "", "موافقات", "x".repeat(401)];
  assert("«موافق / نعتمد / تمام اعتمدوا / أكدوا الطلب …» read as an acceptance", yes.every(ACC.looksLikeAcceptance), JSON.stringify(yes.filter((t) => !ACC.looksLikeAcceptance(t))));
  assert("its refusal, a question, an order and a long text do not", !no.some(ACC.looksLikeAcceptance), JSON.stringify(no.filter(ACC.looksLikeAcceptance)));
}

// ============================================================================
console.log("\n[أ] «✅ العميل وافق»: a quotation that is not issued");
{
  const env = world();
  const id = await unitQuote(env, {}, false);
  const before = writes().length;
  const r = await approve(env, id);
  assert("refused, and said on «آخر نتيجة»: the quotation is not issued yet", r.action === "refused" && result(id).startsWith("🚫 لم يُسجَّل القبول: العرض لم يصدر بعد") && !quote(id).x_accepted_at);
  assert("nothing but that line is written", writes().length === before + 1);
  quote(id).x_state = "closed";
  assert("a closed request: refused", (await approve(env, id)).detail === "الطلب مغلق" && !quote(id).x_accepted_at);
  assert("a request that is not there: nothing", (await approve(env, 999999)).action === "not_found");
}

console.log("\n[أ] «✅ العميل وافق» on a unit-price quotation");
{
  const env = world();
  table("res.partner").get(MADARAT)!.x_pay_terms = "credit";
  const id = await unitQuote(env);
  assert("the quotation is issued: «صدر العرض», a draft sale order", quote(id).x_state === "quoted" && saleOrders().length === 1 && saleOrders()[0].state === "draft");
  const before = writes().length, graphBefore = sentTo(OWNER).length + sentTo(MADARAT_PHONE).length;
  const r = await approve(env, id);
  const q = quote(id);
  assert("the acceptance opens on the request: its time, the delivery date (tomorrow morning), the customer's terms", r.action === "approved" && q.x_accepted_at === utc(`${DAY} 14:00`) && q.x_delivery_date === "2026-10-04" && q.x_pay_terms === "credit");
  assert("no confirmed quantity is written: a unit-price quotation names none", linesOf(id).every((l) => !l.x_confirmed_qty) && !q.x_confirmed_total);
  assert("ONE write of the request (and its result line); the state stays «صدر العرض»; no message", writes().filter((w) => w.model === QUOTE).length - writes().slice(0, before).filter((w) => w.model === QUOTE).length === 2 && q.x_state === "quoted" && sentTo(OWNER).length + sentTo(MADARAT_PHONE).length === graphBefore);
  assert("«آخر نتيجة» says what to do next: the date, and the quantity of every line (0 = out)", result(id).includes("✅ سُجّل قبول العميل") && result(id).includes("الأحد 4 أكتوبر 2026") && result(id).includes(`«${ACC.CONVERT_BUTTON}»`) && result(id).includes("اكتب «الكمية المؤكدة» لكل سطر (0 = خارج الطلب): 4 بلا كمية"));
  assert("no order is made by the acceptance", rows("x_daily_order").length === 0 && saleOrders()[0].state === "draft");
  // pressed again after Baraa typed: what he typed stays
  Object.assign(q, { x_delivery_date: "2026-10-07", x_pay_terms: "cash" });
  confirm(id, ["9"]);
  setRiyadh(`${DAY} 15:00`);
  await approve(env, id);
  assert("pressed again: the time, the date, the terms and a quantity Baraa typed all stay", quote(id).x_accepted_at === utc(`${DAY} 14:00`) && quote(id).x_delivery_date === "2026-10-07" && quote(id).x_pay_terms === "cash" && linesOf(id)[0].x_confirmed_qty === "9" && result(id).includes("3 بلا كمية"));
  assert("…and «إجمالي الطلب المؤكد» follows the quantities typed so far", quote(id).x_confirmed_total === round(9 * M.grossOf(121.3)));
  // a save of the lines in Odoo asks the worker for the numbers again («🔄 احسب», the line's automation): the total follows
  confirm(id, ["9", "5", "0", "2"]);
  const n1 = writes().length;
  await quiet(() => SQ.recalcQuote(env, id, { now: now() }));
  assert("a recalculation after Baraa typed more quantities: «إجمالي الطلب المؤكد» follows them (9 + 5 + 2 of their lines)", quote(id).x_confirmed_total === round(9 * M.grossOf(121.3) + 5 * M.grossOf(63.7) + round(2 * M.grossOf(12.83))) && writes().length === n1 + 1);
  await quiet(() => SQ.recalcQuote(env, id, { now: now() }));
  assert("…and a second pass writes nothing (no loop with the save that asked for it)", writes().length === n1 + 1);
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] «✅ العميل وافق» on a quotation by quantities, after 21:00, expired");
{
  const env = world(`${DAY} 21:30`);
  const id = await qtyQuote(env, SIX, { x_valid_until: utc(`${DAY} 21:00`) });
  const r = await approve(env, id);
  assert("each line confirms its own quantity", r.action === "approved" && JSON.stringify(linesOf(id).map((l) => l.x_confirmed_qty)) === JSON.stringify(SIX.map(([, q]) => String(q))));
  assert("after 21:00 the delivery is the morning after tomorrow", quote(id).x_delivery_date === "2026-10-05");
  assert("the customer's card has no terms: «طريقة الدفع» stays empty", !quote(id).x_pay_terms);
  assert("«إجمالي الطلب المؤكد» = the quotation's total", quote(id).x_confirmed_total === 14625 && quote(id).x_total === 14625);
  assert("an expired quotation: the result says to tick «أعتمد الأسعار رغم انتهاء الصلاحية»", result(id).includes("⚠️ انتهت صلاحية العرض (3 أكتوبر 2026 الساعة 21:00)") && result(id).includes(`«${ACC.EXPIRED_BOX}»`));
  // the customer confirmed less of one line: Baraa types it, and a second press leaves it
  linesOf(id)[0].x_confirmed_qty = "1000";
  await approve(env, id);
  assert("pressed again: the quantity Baraa typed (1000 of 1464) stays, and the confirmed total follows it", linesOf(id)[0].x_confirmed_qty === "1000" && linesOf(id)[1].x_confirmed_qty === "494" && quote(id).x_confirmed_total === round(14625 - 464 * 4.75));
}

// ============================================================================
console.log("\n[ب] «📦 حوّل لطلب»: what it refuses");
{
  const env = world();
  const id = await unitQuote(env, {}, false);
  const refused = async (label: string, why: string) => {
    unlockConvert(env, id);
    const before = writes().length;
    const r = await convert(env, id);
    assert(label, r.action === "refused" && String(r.detail).includes(why) && result(id).startsWith("🚫 لم يتحوّل لطلب:") && result(id).includes(why) && rows("x_daily_order").length === 0, `${r.action}: ${r.detail}`);
    return writes().length - before;
  };
  await refused("a quotation that is not issued", "العرض لم يصدر بعد");
  await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  await refused("issued, and «✅ العميل وافق» not pressed", `اضغط «${ACC.APPROVE_BUTTON}» أولاً`);
  await approve(env, id);
  await refused("a unit-price quotation with no confirmed quantity: every line is named", "بلا كمية: برتقال، طماطم، طماطم، فطر أبيض");
  confirm(id, ["9", "5", "0", "كثير"]);
  await refused("a quantity that cannot be read is named", "«الكمية المؤكدة» لا تُقرأ: فطر أبيض");
  confirm(id, ["0", "0", "0", "0"]);
  await refused("every line confirmed 0: nothing to convert", "كل الكميات المؤكدة صفر");
  confirm(id, ["9", "5", "0", "2"]);
  quote(id).x_delivery_date = DAY;
  await refused("a delivery date whose purchase list has gone (today's): the earliest is named", "أقرب تسليم صباح الأحد 4 أكتوبر 2026");
  assert("…in the words of the day's cutoff", ACC.tooEarlyText(DAY, "2026-10-04") === "«تاريخ التسليم» السبت 3 أكتوبر 2026 فات موعد قائمة شرائه (الساعة 9:00 مساء اليوم الذي قبله): أقرب تسليم صباح الأحد 4 أكتوبر 2026");
  quote(id).x_delivery_date = false;
  await refused("no delivery date at all", "لا «تاريخ التسليم» على الطلب");
  quote(id).x_delivery_date = "2026-10-04";
  // an item with no packaging in Odoo cannot stand on an order's line
  const pack = [...table("x_product_packaging").values()].find((p) => p.x_product_tmpl_id === MUSHROOM)!;
  table("x_product_packaging").delete(pack.id as number);
  await refused("an item with no packaging in Odoo is named", "لا عبوة في Odoo للصنف (أضفها من «📦 الأصناف»): فطر أبيض");
  table("x_product_packaging").set(pack.id as number, pack);
  quote(id).x_valid_until = utc(`${DAY} 13:00`);
  const n = await refused("an expired quotation, «أعتمد الأسعار رغم انتهاء الصلاحية» not ticked", "انتهت صلاحية العرض (3 أكتوبر 2026 الساعة 13:00)");
  assert("a refusal writes its result line and nothing else (the recalculation found nothing to change)", n === 1);
  assert("…and it says how: tick the box, or issue a new quotation", ACC.expiredText(utc(`${DAY} 13:00`)) === `انتهت صلاحية العرض (3 أكتوبر 2026 الساعة 13:00): أشّر «${ACC.EXPIRED_BOX}» ثم أعد، أو أصدر عرضاً جديداً`);
  assert("nothing reached the customer or changed his quotation through all of it", textsTo(MADARAT_PHONE).length === 0 && saleOrders()[0].state === "draft" && quote(id).x_state === "quoted" && !quote(id).x_daily_order_id);
  quote(id).x_state = "closed";
  await refused("a closed request", "الطلب مغلق");
  assert("a request that is not there: nothing", (unlockConvert(env, 999999), (await convert(env, 999999)).action === "not_found"));
}

console.log("\n[ب] «📦 حوّل لطلب»: the order");
{
  const env = world();
  table("res.partner").get(MADARAT)!.x_pay_terms = "credit";
  table("res.partner").get(MADARAT)!.x_delivery_neighborhood = "الملقا";
  const id = await unitQuote(env);
  await approve(env, id);
  confirm(id, ["9", "5", "0", "2.5"]);
  quote(id).x_delivery_note = "البوابة 3 قبل 7 صباحاً";
  const sentBefore = textsTo(MADARAT_PHONE).length, ownerBefore = sentTo(OWNER).length;
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  const made = orderLines(order?.id);
  const gross = UNIT.map(([, , net]) => M.grossOf(net));
  const total = round(9 * gross[0] + 5 * gross[1] + round(2.5 * gross[3]));
  assert("ONE order: the delivery date's eve (its 21:15 list is the delivery's), confirmed, of the customer, from this request", r.action === "converted" && ordersOf(id).length === 1 && r.orderId === order.id && order.x_order_date === DAY && order.x_state === "confirmed" && order.x_customer_id === MADARAT && order.x_special_quote_id === id && order.x_confirmed_at === utc(`${DAY} 14:00`) && order.x_created_via === "manual" && order.x_utak_simulation !== true, JSON.stringify(order));
  assert("its lines: the confirmed quantities — the line confirmed 0 is out", made.length === 3 && JSON.stringify(made.map((l) => [l.x_product_tmpl_id, l.x_quantity])) === JSON.stringify([[ORANGE, 9], [1, 5], [MUSHROOM, 2.5]]), JSON.stringify(made));
  assert("…at the quotation's final VAT-inclusive prices (the price before VAT × 1.15, to the halala), as the line's price AND its manual one", made.every((l, i) => l.x_unit_price === [gross[0], gross[1], gross[3]][i] && l.x_price_unit_manual === l.x_unit_price && l.x_subtotal === round(l.x_quantity * l.x_unit_price)) && gross[1] === 73.26 && gross[3] === 14.75);
  assert("…each «سعر خاص», with the quotation's «التعبئة», its purchase price and the source that gave it", made.every((l) => l.x_special_price === true && l.x_special_supplier_id === AHMED && l.x_status === "pending") && JSON.stringify(made.map((l) => [l.x_pack_text, l.x_special_purchase])) === JSON.stringify([["18 كيلو", 105], ["14 كيلو -مخمر", 55], ["كرتون 2 كجم", 11]]));
  assert("…on the item's own packaging — an item that is not «نشط للبيع» is taken in this order", made[0].x_packaging_id === ORANGE * 10 && made[1].x_packaging_id === 11 && table("product.template").get(ORANGE)!.x_is_active_for_sale === false && table("product.template").get(MUSHROOM)!.x_is_active_for_sale === false);
  assert("the order's notes: the request and its quotation, the payment terms, the delivery note", String(order.x_delivery_notes).split("\n")[0] === `طلب أسعار خاص ${quote(id).x_name} — عرض السعر ${quote(id).x_quotation_number}` && String(order.x_delivery_notes).includes("طريقة الدفع: آجل") && String(order.x_delivery_notes).includes("ملاحظة التسليم: البوابة 3 قبل 7 صباحاً") && !String(order.x_delivery_notes).includes("انتهاء صلاحية"));
  assert("…the customer's neighbourhood, and its total", order.x_delivery_neighborhood === "الملقا" && order.x_total_amount === total && r.total === total);
  assert("the request: «مقبول — تحوّل لطلب», the order's link, the time, the confirmed total", quote(id).x_state === "accepted" && quote(id).x_daily_order_id === order.id && quote(id).x_converted_at === utc(`${DAY} 14:00`) && quote(id).x_confirmed_total === total && SQ.STATE_LABEL.accepted === "مقبول — تحوّل لطلب");
  assert("«آخر نتيجة»: the order, its delivery morning, its total, what is out, how the confirmation went", result(id).includes(`📦 تحوّل إلى الطلب #${order.id}: 3 صنف، التسليم صباح الأحد 4 أكتوبر 2026، الإجمالي ${total} ر.س`) && result(id).includes("خارج الطلب (كميتها 0): طماطم") && result(id).includes("التأكيد وصل العميل (داخل نافذته)"));
  const said = textsTo(MADARAT_PHONE).slice(sentBefore);
  assert("the customer's confirmation, as a text inside his window: the order's number, the delivery morning, the total", said.length === 1 && r.to === "customer_session" && said[0] === ACC.customerConfirmText(order.id, "2026-10-04", total, String(quote(id).x_quotation_number)) && said[0].includes(`تم تأكيد طلبك رقم #${order.id} ✅`) && said[0].includes("🚚 التسليم: صباح الأحد 4 أكتوبر 2026") && said[0].includes(`الإجمالي: ${total} ر.س شامل ضريبة القيمة المضافة`));
  const own = sentTo(OWNER).slice(ownerBefore);
  assert("Baraa's own message of a confirmed order, with «📦 سلّم وحصّل»: the delivery is the day's path", own.length === 1 && String(own[0]?.interactive?.body?.text).startsWith(`✅ طلب مؤكد #${order.id} — شركة مدارات للاغذية`) && own[0].interactive.action.buttons[0].reply.id === `dlv_${order.id}` && String(own[0].interactive.body.text).includes("برتقال 18 كيلو × 9"));
  assert("ACCOUNTING_SYNC is off: the quotation in Odoo is left as it is", saleOrders()[0].state === "draft" && saleLines(saleOrders()[0].id).every((l) => l.product_uom_qty === 1) && !order.x_sale_order_id);
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));

  // never twice
  for (const lockGone of [false, true]) {
    if (lockGone) unlockConvert(env, id);
    const again = await convert(env, id);
    assert(lockGone ? "…and after the lock: refused by the request itself («سبق تحويله»)" : "pressed again at once: the button's lock answers", lockGone ? again.action === "refused" && again.detail === ACC.alreadyConvertedText(order.id) : again.action === "busy");
  }
  // «مقبول» is the request's own word: even with its order cancelled it is not converted again from that state
  order.x_state = "cancelled";
  unlockConvert(env, id);
  const stuck = await convert(env, id);
  assert("«مقبول» with its order cancelled: still refused as converted («↩️ أعد فتحه» brings it back «صدر العرض» first)", stuck.action === "refused" && stuck.detail === ACC.alreadyConvertedText(order.id) && ordersOf(id).length === 1);
  order.x_state = "confirmed";
  // an accepted request issues no new quotation: its sale order is the order's now
  env.MSG_DEDUP.store.delete(`btnlock:v1:spq_issue:${id}`);
  const so0 = saleOrders().length;
  const reissue = await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  assert("«📄 أصدر عرض السعر» on an accepted request: refused, no new sale order, the state stays «مقبول»", reissue.action === "refused" && String(reissue.detail) === `الطلب مقبول وتحوّل إلى الطلب #${order.id}` && saleOrders().length === so0 && quote(id).x_state === "accepted");
  // a request back at «صدر العرض» that still points at its order: the order it points at refuses
  quote(id).x_state = "quoted";
  unlockConvert(env, id);
  const third = await convert(env, id);
  assert("a request back to «صدر العرض» that still points at its order: refused while that order stands", third.action === "refused" && third.detail === ACC.alreadyConvertedText(order.id) && ordersOf(id).length === 1);
  order.x_state = "cancelled";
  unlockConvert(env, id);
  const fourth = await convert(env, id);
  assert("…and once that order is cancelled, it converts again: a new order", fourth.action === "converted" && ordersOf(id).length === 2 && fourth.orderId !== order.id && quote(id).x_daily_order_id === fourth.orderId);
}

console.log("\n[ب] an expired quotation, by Baraa's own tick");
{
  const env = world();
  const id = await unitQuote(env, { x_valid_until: utc(`${DAY} 13:30`) });
  await approve(env, id);
  confirm(id, ["1", "1", "1", "1"]);
  assert("without the tick: refused", (await convert(env, id)).action === "refused" && ordersOf(id).length === 0);
  quote(id).x_accept_expired = true;
  unlockConvert(env, id);
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  assert("with «أعتمد الأسعار رغم انتهاء الصلاحية»: converted", r.action === "converted" && !!order);
  assert("…and it is RECORDED on the order's notes, with the validity that had passed and the hour", String(order.x_delivery_notes).includes(ACC.expiredRecord(utc(`${DAY} 13:30`), now())) && ACC.expiredRecord(utc(`${DAY} 13:30`), now()) === `اعتُمدت الأسعار بعد انتهاء صلاحية العرض (كان صالحاً حتى 3 أكتوبر 2026 الساعة 13:30) بتأشير براء «${ACC.EXPIRED_BOX}» — 3 أكتوبر 2026 الساعة 14:00` && result(id).includes("اعتُمدت الأسعار بعد انتهاء الصلاحية"));
}

console.log("\n[ب] whose purchase price it is; and a conversion that fails half way");
{
  const obs = (p: number) => ({ purchase: { [AHMED]: { p, n: "أحمد", at: 2 }, 880: { p: p + 5, n: "آخر", at: 1 } }, market: {} });
  assert("the purchase source of a line: the one whose price IS its «الشراء» — none when Baraa typed another, or nobody sent one", ACC.purchaseSupplier({ obs: obs(105), purchase: 105 } as any) === AHMED && ACC.purchaseSupplier({ obs: obs(105), purchase: 110 } as any) === 880 && ACC.purchaseSupplier({ obs: obs(105), purchase: 99 } as any) === 0 && ACC.purchaseSupplier({ obs: { purchase: {}, market: {} }, purchase: 99 } as any) === 0);
  const env = world();
  const id = await unitQuote(env);
  await approve(env, id);
  confirm(id, ["9", "5", "0", "2"]);
  // Odoo refuses the order's lines once (a 400 is never retried)
  const real = globalThis.fetch;
  let failed = 0;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.endsWith("/x_daily_order_line/create") && !failed++) return new Response(JSON.stringify({ name: "odoo.exceptions.ValidationError", message: "no", arguments: ["no"] }), { status: 400 });
    return real(input as any, init);
  }) as typeof fetch;
  let threw = "";
  try { await convert(env, id); } catch (e) { threw = String((e as Error)?.message); } finally { globalThis.fetch = real; }
  const [half] = rows("x_daily_order") as any[];
  assert("a conversion that fails after the order was made: that order is CANCELLED (nothing deleted), and it has no line", threw.includes("ValidationError") && rows("x_daily_order").length === 1 && half.x_state === "cancelled" && rows("x_daily_order_line").length === 0);
  assert("…the request is still «صدر العرض», «آخر نتيجة» says so, Baraa is told, the customer nothing", quote(id).x_state === "quoted" && result(id).startsWith("🚫 تعذّر التحويل لطلب:") && result(id).includes(`(الطلب #${half.id} أُلغي)`) && ownerSaid().some((t) => t.startsWith(`🚫 تعذّر تحويل الطلب الخاص #${id} إلى طلب`)) && textsTo(MADARAT_PHONE).length === 0 && saleOrders()[0].state === "draft");
  const again = await convert(env, id);
  assert("…and the next press starts clean: a new order, confirmed (the lock was released)", again.action === "converted" && again.orderId !== half.id && ordersOf(id).filter((o) => o.x_state === "confirmed").length === 1 && orderLines(again.orderId!).length === 3);
}

console.log("\n[ب] the customer's confirmation outside his window");
{
  const env = world();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${MADARAT_PHONE}`);
  const id = priced();
  // issued while his window was open; closed by the time he accepts
  openWindow(env, MADARAT_PHONE);
  await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  env.MSG_DEDUP.store.delete(`wa_win:v1:${MADARAT_PHONE}`);
  await approve(env, id);
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  const tpl = tplTo(MADARAT_PHONE, CONFIRM_TEMPLATE);
  assert("the confirmation's own template: the order's number and «صباح …»", r.to === "customer_template" && tpl.length === 1 && JSON.stringify(tpl[0].template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify(ACC.confirmTemplateParams(order.id, "2026-10-04")) && JSON.stringify(ACC.confirmTemplateParams(7, "2026-10-04")) === '["7","صباح الأحد 4 أكتوبر 2026"]');
  assert("…and no text is held for him", textsTo(MADARAT_PHONE).length === 0 && result(id).includes("التأكيد وصل العميل (بقالب تأكيد الطلب)"));

  // the template is not usable (Meta filed it MARKETING): Baraa sends it himself
  const env2 = world();
  [...table("x_whatsapp_template").values()].find((t) => t.x_meta_template_id === CONFIRM_TEMPLATE)!.x_category = "MARKETING";
  const id2 = priced();
  await quiet(() => QT.issueSpecialQuotation(env2, id2, { now: now() }));
  env2.MSG_DEDUP.store.delete(`wa_win:v1:${MADARAT_PHONE}`);
  await approve(env2, id2);
  const r2 = await convert(env2, id2);
  const [o2] = ordersOf(id2);
  const mine = ownerSaid().find((t) => t.startsWith(`📨 تأكيد الطلب #${o2.id} لم يصل`));
  assert("neither his window nor a usable template: the text reaches Baraa to send himself, nothing is held", r2.to === "owner_instead" && !!mine && mine!.includes("أرسله له بنفسك:") && mine!.includes(ACC.customerConfirmText(o2.id, "2026-10-04", 14625, String(quote(id2).x_quotation_number))) && tplTo(MADARAT_PHONE, CONFIRM_TEMPLATE).length === 0 && textsTo(MADARAT_PHONE).length === 0 && heldFor(env2, MADARAT_PHONE).length === 0);
  assert("…the order stands all the same", o2.x_state === "confirmed" && quote(id2).x_state === "accepted" && result(id2).includes("التأكيد لم يصل العميل"));
}

console.log("\n[ب] the linked sale order (ACCOUNTING_SYNC)");
{
  const env = world();
  env.ACCOUNTING_SYNC = "true";
  const id = await unitQuote(env);
  const so = saleOrders()[0];
  await approve(env, id);
  confirm(id, ["9", "5", "0", "2"]);
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  const made = orderLines(order.id), lines = saleLines(so.id);
  const byKey = (k: number) => lines.find((l) => l.sequence === k)!;
  assert("the quotation is confirmed: «sale», no stock picking, and linked on the order", r.action === "converted" && so.state === "sale" && order.x_sale_order_id === so.id && so.client_order_ref === `UTAK-ORDER-${order.id}` && saleOrders().length === 1);
  assert("each confirmed line: the sale-accounting's service product, «الصنف — التعبئة», the confirmed quantity, the locked price, the sale tax, keyed by the order's line", made.every((l) => { const s = byKey(l.id); return s && s.product_id === SERVICE && s.product_uom_qty === l.x_quantity && s.price_unit === l.x_unit_price && JSON.stringify(s.tax_ids) === JSON.stringify([[6, 0, [77]]]); }) && byKey(made[0].id).name === "برتقال — 18 كيلو" && byKey(made[1].id).name === "طماطم — 14 كيلو -مخمر");
  const out = lines.filter((l) => l.sequence >= ACC.OUT_LINE_SEQUENCE);
  assert("the line outside the order: quantity 0 and price 0, its own product, under a key no order line carries — nothing deleted", lines.length === 4 && out.length === 1 && out[0].product_uom_qty === 0 && out[0].price_unit === 0 && out[0].product_id === 1001 && out[0].x_pack_text === "14 كيلو -غير مخمر");
  assert("the two lines of ONE item went each to its own («التعبئة» tells them apart)", byKey(made[1].id).x_pack_text === "14 كيلو -مخمر");
  assert("«آخر نتيجة» names the sale order", result(id).includes(`أمر البيع ${so.name} أُكّد بالكميات المؤكدة`));
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));

  {
    // the SECOND line of that item confirmed and the first out: by the item alone the first would be taken
    const e = world();
    e.ACCOUNTING_SYNC = "true";
    const q = await unitQuote(e);
    await approve(e, q);
    confirm(q, ["0", "0", "4", "0"]);
    await convert(e, q);
    const [o] = ordersOf(q);
    const [only] = orderLines(o.id);
    const sl = saleLines(saleOrders()[0].id);
    assert("…the second line of an item confirmed alone: the sale order's own second line takes it, the first is out", sl.find((l) => l.sequence === only.id)?.x_pack_text === "14 كيلو -غير مخمر" && sl.find((l) => l.x_pack_text === "14 كيلو -مخمر")!.product_uom_qty === 0 && sl.filter((l) => l.product_uom_qty === 0).length === 3 && sl.find((l) => l.sequence === only.id)!.product_uom_qty === 4);
  }
  for (const how of ["picking", "draft"] as const) {
    const e = world();
    e.ACCOUNTING_SYNC = "true";
    confirmAs.how = how;
    const q = await unitQuote(e);
    await approve(e, q);
    confirm(q, ["1", "1", "1", "1"]);
    const res = await convert(e, q);
    const [o] = ordersOf(q);
    assert(how === "picking" ? "a confirm that leaves a stock picking: Baraa is told, the order is NOT linked to it — and stands" : "a confirm Odoo did not take: Baraa is told, nothing linked, the order stands",
      res.action === "converted" && o.x_state === "confirmed" && !o.x_sale_order_id && ownerSaid().some((t) => t.startsWith("⚠️ أمر البيع") && t.includes(how === "picking" ? "أنشأ حركة مخزون (7001)" : "حالته draft بعد التأكيد")) && result(q).includes("لم يُربط"));
  }
  confirmAs.how = "sale";
  // a quotation that is no draft any more is left alone: the order takes a sale order of its own, as any order
  const e = world();
  e.ACCOUNTING_SYNC = "true";
  const q = await unitQuote(e);
  const quotation = saleOrders()[0];
  quotation.state = "cancel";
  await approve(e, q);
  confirm(q, ["2", "1", "1", "1"]);
  await convert(e, q);
  const [o] = ordersOf(q);
  const own = saleOrders().find((s) => s.id !== quotation.id);
  assert("a quotation that is not a draft any more is not touched: the order gets its own sale order, the day's way", quotation.state === "cancel" && !!own && own.origin === `x_daily_order/${o.id}` && own.state === "sale" && o.x_sale_order_id === own.id && saleLines(own.id).length === 4 && saleLines(own.id).some((l) => l.name === "برتقال — 18 كيلو" && l.product_uom_qty === 2 && l.product_id === SERVICE));
}

console.log("\n[ب] a request flagged «محاكاة»");
{
  const env = world();
  env.ACCOUNTING_SYNC = "true";
  const id = await unitQuote(env, { x_utak_simulation: true }, false);
  // a simulation is never issued: its state is set by hand, as the scenario's script does
  Object.assign(quote(id), { x_state: "quoted", x_quotation_number: "محاكاة" });
  await quiet(() => SQ.recalcQuote(env, id, { now: now() }));
  await approve(env, id);
  confirm(id, ["9", "5", "0", "2"]);
  const custBefore = sentTo(MADARAT_PHONE).length;
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  assert("it converts: its order and every line of it carry the flag", r.action === "converted" && order.x_utak_simulation === true && orderLines(order.id).length === 3 && orderLines(order.id).every((l) => l.x_utak_simulation === true && l.x_special_price === true));
  assert("no sale order is made or confirmed, whatever ACCOUNTING_SYNC says", saleOrders().length === 0 && !order.x_sale_order_id);
  assert("NOTHING goes to the customer: what he would read reaches Baraa alone, marked «🧪 محاكاة»", sentTo(MADARAT_PHONE).length === custBefore && r.to === "owner_simulation" && ownerSaid().filter((t) => t.startsWith(`${ACC.SIM_MARK} — ما كان سيصل العميل «شركة مدارات للاغذية»:`) && t.includes(`تم تأكيد طلبك رقم #${order.id}`)).length === 1 && !ownerSaid().some((t) => t.startsWith("✅ طلب مؤكد")));
}

// ============================================================================
console.log("\n[ج] a large order: at the conversion, and on the morning of its delivery");
{
  const env = world();
  // 60 cartons and 105 kilos of an item whose packaging weighs 8 kilos (14 cartons): 74
  table("x_product_packaging").get(GARLIC * 10)!.x_approx_weight_kg = 8;
  const id = await qtyQuote(env, [[ORANGE, 60, 100, 133, "18 كيلو"], [GARLIC, 105, 10, 14.25, "كيلو"], [LETTUCE, 30, 6, 9, "كيلو"]]);
  await approve(env, id);
  const r = await convert(env, id);
  const [order] = ordersOf(id);
  const alert = ownerSaid().filter((t) => t.startsWith("🚚 طلب كبير"));
  assert("74 cartons against a limit of 50: «🚚 طلب كبير 74 كرتون و30 كيلو: رتّب المركبة» with the order and its delivery morning", r.cartons === 74 && alert.length === 1 && alert[0] === `🚚 طلب كبير 74 كرتون و30 كيلو: رتّب المركبة — الطلب #${order.id} (${quote(id).x_name}، شركة مدارات للاغذية)، التسليم صباح الأحد 4 أكتوبر 2026` && result(id).includes("طلب كبير 74 كرتون") && !result(id).includes("تنبيه واتساب"));
  const tick = () => quiet(() => ACC.runLargeOrderMorning(env, now()));
  setRiyadh(`${DAY} 23:00`);
  assert("the evening before: nothing", (await tick()).length === 0);
  setRiyadh("2026-10-04 01:55");
  assert("the delivery day before 02:00: nothing yet", (await tick()).length === 0 && ownerSaid().filter((t) => t.startsWith("🚚")).length === 1);
  setRiyadh("2026-10-04 02:05");
  const first = await tick();
  const morning = ownerSaid().filter((t) => t.startsWith("🚚 طلب كبير"));
  assert("from 02:00 of the delivery day: ONE «🚚 طلب كبير 74 كرتون … رتّب المركبة — اليوم تسليم الطلب …»", JSON.stringify(first) === JSON.stringify([{ orderId: order.id, action: "alerted" }]) && morning.length === 2 && morning[1] === `🚚 طلب كبير 74 كرتون و30 كيلو: رتّب المركبة — اليوم تسليم الطلب #${order.id} (${quote(id).x_name}، شركة مدارات للاغذية)` && ACC.LARGE_MORNING_MINUTE === 120);
  setRiyadh("2026-10-04 02:10");
  assert("the next tick: not again", JSON.stringify(await tick()) === JSON.stringify([{ orderId: order.id, action: "alerted_before" }]) && ownerSaid().filter((t) => t.startsWith("🚚")).length === 2);
  setRiyadh("2026-10-05 02:05");
  assert("the day after: nothing of it", (await tick()).length === 0);

  // under the limit: no alert; an order cancelled before its morning: none either
  const env2 = world();
  const small = await qtyQuote(env2, [[ORANGE, 49, 100, 133, "18 كيلو"]]);
  await approve(env2, small);
  const rs = await convert(env2, small);
  assert("49 cartons: no alert, and nothing kept for the morning", rs.cartons === 49 && !ownerSaid().some((t) => t.startsWith("🚚")) && ![...env2.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("sq_large:")));
  table("x_pricing_config").get(1)!.x_large_order_cartons = 40;
  const big = await qtyQuote(env2, [[ORANGE, 40, 100, 133, "18 كيلو"]]);
  await approve(env2, big);
  await convert(env2, big);
  const [bo] = ordersOf(big);
  assert("the limit is the settings' own (40): told at the conversion", ownerSaid().filter((t) => t.startsWith("🚚 طلب كبير 40 كرتون: رتّب المركبة")).length === 1);
  bo.x_state = "cancelled";
  setRiyadh("2026-10-04 02:05");
  const gone = await quiet(() => ACC.runLargeOrderMorning(env2, now()));
  assert("…cancelled before its morning: no second alert", JSON.stringify(gone) === JSON.stringify([{ orderId: bo.id, action: "gone" }]) && ownerSaid().filter((t) => t.startsWith("🚚")).length === 1);

  // the gateway is not taking Baraa's alerts: the screen says so at the conversion, and the morning alert is tried again
  const env3 = world();
  blockOwnerAlerts(env3);
  const q3 = await qtyQuote(env3, [[ORANGE, 60, 100, 133, "18 كيلو"]]);
  await approve(env3, q3);
  await convert(env3, q3);
  const [o3] = ordersOf(q3);
  assert("the alert of the conversion did not reach him: «آخر نتيجة» says to arrange the vehicle all the same", !ownerSaid().some((t) => t.startsWith("🚚")) && result(q3).includes("طلب كبير 60 كرتون (تنبيه واتساب لم يصلك الآن: رتّب المركبة)") && o3.x_state === "confirmed");
  const tick3 = () => quiet(() => ACC.runLargeOrderMorning(env3, now()));
  setRiyadh("2026-10-04 02:05");
  assert("its morning alert is skipped too — and told so", JSON.stringify(await tick3()) === JSON.stringify([{ orderId: o3.id, action: "not_delivered" }]) && !ownerSaid().some((t) => t.startsWith("🚚")));
  setRiyadh("2026-10-04 02:10");
  assert("…not tried at every tick", JSON.stringify(await tick3()) === JSON.stringify([{ orderId: o3.id, action: "alerted_before" }]) && ACC.LARGE_RETRY_SECONDS === 1800);
  unblockOwnerAlerts(env3);
  env3.MSG_DEDUP.store.delete(`btnlock:v1:sq_large_morning:${o3.id}`);   // (the harness's KV keeps no clock: the half hour has passed)
  setRiyadh("2026-10-04 02:40");
  assert("…and half an hour later, the gateway taking it: ONE «🚚 … اليوم تسليم الطلب …»", JSON.stringify(await tick3()) === JSON.stringify([{ orderId: o3.id, action: "alerted" }]) && ownerSaid().filter((t) => t.startsWith("🚚 طلب كبير 60 كرتون: رتّب المركبة — اليوم تسليم الطلب")).length === 1);
}

// ============================================================================
console.log("\n[أ] «موافق» from the customer: one alert to Baraa, nothing converted");
{
  const env = world();
  const ACTION = seed("ir.actions.act_window", { name: "UTAK — طلبات أسعار خاصة", res_model: QUOTE });
  const id = await unitQuote(env);
  const say = (text: string, from = MADARAT_PHONE) => quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text } })), env, ctx));
  const alerts = () => ownerSaid().filter((t) => t.startsWith("✅ شركة مدارات للاغذية يبدو موافقاً على"));
  const reads = () => odooLog.filter((c) => c.model === QUOTE && c.method === "search_read" && JSON.stringify(c.body?.domain ?? []).includes("x_partner_id")).length;
  const r0 = reads();
  await say("كم سعر الموز اليوم؟");
  assert("a message that is no acceptance reads no request at all", reads() === r0 && alerts().length === 0);
  await say("تمام اعتمدوا العرض");
  const number = String(quote(id).x_quotation_number);
  assert("«تمام اعتمدوا العرض»: ONE alert «✅ {العميل} يبدو موافقاً على {رقم العرض}» with the request's link", alerts().length === 1 && alerts()[0] === ACC.acceptanceAlertText("شركة مدارات للاغذية", number, `https://odoo.test/odoo/action-${ACTION}/${id}`) && alerts()[0].split("\n")[0] === `✅ شركة مدارات للاغذية يبدو موافقاً على ${number}` && alerts()[0].split("\n")[1] === `https://odoo.test/odoo/action-${ACTION}/${id}`);
  assert("NOTHING is converted and nothing is written on the request", rows("x_daily_order").filter((o: any) => o.x_special_quote_id).length === 0 && quote(id).x_state === "quoted" && !quote(id).x_accepted_at && saleOrders()[0].state === "draft");
  await say("موافقين");
  assert("a second acceptance: no second alert", alerts().length === 1);
  // a quotation that is past its validity, one Baraa already accepted, and a simulation's: none
  const env2 = world();
  const cases: Array<[string, Record<string, unknown>]> = [["past its «صالح حتى»", { x_valid_until: utc(`${DAY} 13:00`) }], ["Baraa already pressed «✅ العميل وافق»", { x_accepted_at: utc(`${DAY} 13:00`) }], ["a simulation's", { x_utak_simulation: true }], ["not issued yet", { x_state: "priced" }]];
  for (const [label, over] of cases) {
    const q = await unitQuote(env2);
    Object.assign(quote(q), over);
    const out = await quiet(() => ACC.noticeAcceptance(env2, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
    assert(`no alert for a quotation ${label}`, out.length === 0, JSON.stringify(out));
    quote(q).x_state = "closed";
  }
  assert("…and none went out for them", ownerSaid().filter((t) => t.includes("يبدو موافقاً")).length === 0);
  const live = await unitQuote(env2);
  closeOwnerWindow(env2);
  const out = await quiet(() => ACC.noticeAcceptance(env2, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
  assert("Odoo has no action of that name: the alert still goes, its link Odoo's own door", out.length === 1 && out[0].action === "alerted" && out[0].quoteId === live && ACC.acceptanceAlertText("أ", "S1", "u").split("\n").length === 3);
  assert("another customer's «موافق» is not this one's", (await quiet(() => ACC.noticeAcceptance(env2, { id: 501, name: "مطعم الوادي" }, now()))).length === 0);
  // the gateway is not taking Baraa's alerts (Meta refused the purpose for his number within 24 hours): the alert is NOT lost
  const env3 = world();
  const q3 = await unitQuote(env3);
  blockOwnerAlerts(env3);
  const skipped = await quiet(() => ACC.noticeAcceptance(env3, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
  assert("an alert the gateway skipped is told so, and reaches nobody", skipped.length === 1 && skipped[0].action === "not_delivered" && skipped[0].quoteId === q3 && !ownerSaid().some((t) => t.includes("يبدو موافقاً")));
  const still = await quiet(() => ACC.noticeAcceptance(env3, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
  assert("…it does not use up the quotation's one alert: his next «موافق» tries again (still skipped)", still.length === 1 && still[0].action === "not_delivered");
  unblockOwnerAlerts(env3);
  const went = await quiet(() => ACC.noticeAcceptance(env3, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
  const once = await quiet(() => ACC.noticeAcceptance(env3, { id: MADARAT, name: "شركة مدارات للاغذية" }, now()));
  assert("…and once the gateway takes it again: ONE alert, then no more", went[0]?.action === "alerted" && once[0]?.action === "alerted_before" && ownerSaid().filter((t) => t.includes("يبدو موافقاً")).length === 1);
}

// ============================================================================
console.log("\n[هـ] the screens (scripts/lib/s66-odoo.mjs) and the worker's wiring");
{
  // @ts-ignore — plain .mjs helper
  const L = await import("../scripts/lib/s66-odoo.mjs");
  const { readFileSync } = await import("node:fs");
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const names = (defs: any[]) => defs.map((d) => d.name);
  assert("the request's fields of the acceptance are the ones the worker reads and writes", ["x_accepted_at", "x_delivery_date", "x_pay_terms", "x_delivery_note", "x_accept_expired", "x_daily_order_id", "x_converted_at", "x_confirmed_total"].every((f) => names(L.QUOTE_FIELDS).includes(f) && src("special-quote.ts").includes(`"${f}"`)) && names(L.LINE_FIELDS).includes("x_confirmed_qty"));
  assert("the order's: the request it came from; its line's: «سعر خاص», «التعبئة», «الشراء» and its source", JSON.stringify(names(L.ORDER_FIELDS)) === '["x_special_quote_id"]' && JSON.stringify(names(L.ORDER_LINE_FIELDS)) === '["x_special_price","x_pack_text","x_special_purchase","x_special_supplier_id"]' && L.ORDER_LINE_FIELDS[0].field_description === "سعر خاص" && names(L.CONFIG_FIELDS)[0] === ACC.LARGE_ORDER_FIELD && L.LARGE_ORDER_DEFAULT === ACC.LARGE_ORDER_DEFAULT);
  assert("«الكمية المؤكدة» is TEXT (empty is not zero), and the box of an expired quotation carries the worker's own words", L.LINE_FIELDS[0].ttype === "char" && L.QUOTE_FIELDS.find((d: any) => d.name === "x_accept_expired").field_description === ACC.EXPIRED_BOX);
  assert("«طريقة الدفع» is the customer card's three terms, by the worker's labels", JSON.stringify(Object.fromEntries(L.PAY_TERMS)) === JSON.stringify(ACC.PAY_TERMS_LABEL));
  assert("the two buttons by the worker's names, on the hook's two ops", L.APPROVE_LABEL === ACC.APPROVE_BUTTON && L.CONVERT_LABEL === ACC.CONVERT_BUTTON && L.HOOKS.approve.op === "approve" && L.HOOKS.convert.op === "convert");
  const v = L.views({ close: 1, send: 2, accept: 3, issue: 4, approve: 5, convert: 6, saleAccept: 7 });
  const form = v["utak.special_quote_form.s66_accept"].arch as string;
  assert("the form: «✅ العميل وافق» only on an issued request; «📦 حوّل لطلب» only once accepted, and it asks first", form.includes(`<button name="5" type="action" string="${ACC.APPROVE_BUTTON}" class="btn-primary" invisible="x_state != 'quoted'"/>`) && form.includes(`<button name="6" type="action" string="${ACC.CONVERT_BUTTON}" class="btn-primary" invisible="x_state != 'quoted' or not x_accepted_at" confirm="${L.CONVERT_CONFIRM}"/>`) && form.indexOf('name="5"') < form.indexOf('name="6"') && form.includes(`<xpath expr="//header/button[@name='1']" position="before">`));
  assert("…an accepted request shows no «أرسل», «اعتمد المقترح» or «أصدر», and its lines are read-only", [2, 3, 4].every((n) => form.includes(`<xpath expr="//header/button[@name='${n}']" position="attributes"><attribute name="invisible">x_state in ('closed', 'accepted')</attribute></xpath>`)) && form.includes(`<xpath expr="//field[@name='x_line_ids']" position="attributes"><attribute name="readonly">x_state in ('closed', 'accepted')</attribute></xpath>`));
  assert("…the acceptance's group appears with the acceptance, its fields closed once converted, and «الكمية المؤكدة» beside the quantity", form.includes(`name="utak_accept" invisible="not x_accepted_at and x_state != 'accepted'"`) && ["x_delivery_date", "x_pay_terms", "x_delivery_note", "x_accept_expired"].every((f) => new RegExp(`<field name="${f}" readonly="x_state != 'quoted'"`).test(form)) && form.includes(`<xpath expr="//field[@name='x_line_ids']/list/field[@name='x_qty']" position="after">`) && form.includes(`<field name="x_confirmed_qty" column_invisible="not parent.x_accepted_at"`) && form.includes("draft,sent,priced,quoted,accepted,closed"));
  const search = v["utak.special_quote_search.s66"].arch as string;
  const dom = (name: string) => L.FILTERS.find((f: string[]) => f[0] === name)[2] as string;
  assert("the search: «مقبول»; «بانتظار رد العميل» = issued, still valid, not accepted; «انتهت صلاحيته» = issued and past it", JSON.stringify(L.FILTERS.map((f: string[]) => [f[0], f[1]])) === '[["f_accepted","مقبول"],["f_waiting","بانتظار رد العميل"],["f_expired","انتهت صلاحيته"]]' && dom("f_accepted") === "[('x_state', '=', 'accepted')]" && dom("f_waiting").startsWith("[('x_state', '=', 'quoted'), ('x_valid_until', '&gt;=', datetime.datetime.now()") && dom("f_expired").startsWith("[('x_state', '=', 'quoted'), ('x_valid_until', '&lt;', datetime.datetime.now()") && L.FILTERS.every((f: string[]) => search.includes(`<filter name="${f[0]}" string="${f[1]}" domain="${f[2]}"/>`)));
  assert("the list tells «مقبول» apart; the sale order's «✅ العميل وافق» shows on a draft quotation that came from a request", (v["utak.special_quote_list.s66"].arch as string).includes(`<attribute name="decoration-primary">x_state == 'accepted'</attribute>`) && (v["utak.sale.order.form.s66_accept"].arch as string).includes(`<button name="7" string="${ACC.APPROVE_BUTTON}" type="action" class="btn-secondary" invisible="state not in ('draft', 'sent') or not origin"/>`));
  assert("…and its code presses the request's own «✅ العميل وافق» and opens the request — refusing an order that is no request's", L.SALE_ACCEPT_CODE.includes("env['x_special_quote'].search([('x_sale_order_id', '=', record.id)], limit=1)") && L.SALE_ACCEPT_CODE.includes(`('name', '=', '${L.HOOKS.approve.name}')`) && L.SALE_ACCEPT_CODE.includes("raise UserError(") && L.SALE_ACCEPT_CODE.includes("'res_model': 'x_special_quote'") && !/token=/.test(L.SALE_ACCEPT_CODE));
  assert("«↩️ أعد فتحه»: a converted request comes back «مقبول» — «صدر العرض» only when its order was cancelled", L.REOPEN_CODE.includes("converted = rec.x_daily_order_id and rec.x_daily_order_id.x_state != 'cancelled'") && L.REOPEN_CODE.includes("'accepted' if converted else ('quoted' if rec.x_quotation_number"));
  assert("the order's form shows the request and the line's four fields; the settings show «حد الطلب الكبير»", ["x_special_price", "x_pack_text", "x_special_purchase", "x_special_supplier_id"].every((f) => (v["x_daily_order.form.utak_s66"].arch as string).includes(`name="${f}"`)) && (v["x_daily_order.form.utak_s66"].arch as string).includes('<field name="x_special_quote_id" readonly="1" invisible="not x_special_quote_id"/>') && (v["utak.pricing_settings_form.s66_large_order"].arch as string).includes('<field name="x_large_order_cartons"/>'));
  const index = src("index.ts");
  const tick = index.slice(index.indexOf("// § 66 ج — a large special order"), index.indexOf("// § 65 هـ — the approved suppliers' periodic check-in"));
  assert("the five-minute tick runs the large orders' morning (its own claim, no auto-send job of the tick)", tick.includes("const lg = await runLargeOrderMorning(rawEnv, Date.now());") && index.indexOf("// § 66 ج — a large special order") > index.indexOf("runSpecialNudgeTick(rawEnv"));
  assert("a customer's message is read for an acceptance before anything screens it out — and only then is a request read", index.indexOf("if (looksLikeAcceptance(msg.text)) await noticeAcceptance(env, { id: partner.id, name: partner.name });") > 0 && index.indexOf("if (looksLikeAcceptance(msg.text))") < index.indexOf("const { readScreenState, isCustomerAutomationHeld, screenInbound } = await import(\"./screening\");"));
}

done();
