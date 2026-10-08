// § 66 ب – د (2026-10-08) — the order a special quotation became, through the day's own readers:
//
//   • «سعر خاص»: no price list and no recalculation changes its lines' prices — not the quotation of the order
//     again, not a publication, not even with the manual price wiped — and an item no list holds stays in it
//   • the customer's own order of the day is never this one
//   • the 21:15 purchase list of the delivery's eve takes its lines WITH the day's orders: each line an item of its
//     own (never merged), by the quotation's «التعبئة», marked «طلب خاص {رقم}» with its target purchase price
//   • the receipt, the supplier's due and the vendor bill read it by that line, at the list's own price of it
//   • the delivery is the day's («📦 سلّم وحصّل»); the invoice bills what was delivered at the special prices, with
//     no quantity discount, and adds up to the quotation's total to the halala
//   • the day's profit («📊 اليوم», the 21:30 summary) counts it by what it was really bought at
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s66-order.test.mts

import { CUST, CUST_PHONE, OWNER, WH_PHONE, ctx, heldFor, odooLog, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { assert, done, dp, rejected } from "./s46-kit.mts";
import {
  AHMED, DAY, MADARAT, MADARAT_PHONE, MARKETING_ROLE, MUSHROOM, OMAR, ORANGE, SERVICE,
  linesOf, orderLines, ordersOf, ownerSaid, priced, quote, round, saleLines, saleOrders, textsTo, utc, world as world66,
  type Row,
} from "./s66-kit.mts";

const ACC = await import("../src/special-accept.ts");
const QT = await import("../src/special-quotation.ts");
const M = await import("../src/special-quote-math.ts");
const OF = await import("../src/order-flow.ts");
const O = await import("../src/odoo.ts");
const PV = await import("../src/price-validity.ts");
const TEAM = await import("../src/team.ts");
const RF = await import("../src/receipt-form.ts");
const SP = await import("../src/supplier-pay.ts");
const PA = await import("../src/purchase-accounting.ts");
const SA = await import("../src/sale-accounting.ts");
const DF = await import("../src/delivery-form.ts");
const INS = await import("../src/day-insight.ts");
const SUM = await import("../src/owner-summary.ts");
const CF = await import("../src/complaint-form.ts");
const { deliverOrder } = await import("../src/router.ts");
const DN = await import("../src/delivery-note.ts");
const CM = await import("../src/cash-market.ts");

const now = () => Date.now();
const NEXT = "2026-10-04";
/** § 66's tenant, with a driver for the routes (Omar carries «سائق» beside «تسويق»). */
function world(riyadh?: string): any {
  const env = world66(riyadh);
  table("hr.employee").get(7000 + OMAR)!.x_utak_role_ids = [72, MARKETING_ROLE];
  return env;
}
/** A unit-price quotation «قبل الضريبة» as Madarat's — [product, buy, net, «التعبئة»] — issued, accepted, and converted with `typed`. */
const UNIT: Array<[number, number, number, string]> = [[ORANGE, 105, 121.3, "18 كيلو"], [1, 55, 63.7, "14 كيلو -مخمر"], [1, 60, 69.35, "14 كيلو -غير مخمر"], [MUSHROOM, 11, 12.83, "كرتون 2 كجم"]];
async function converted(env: any, typed: string[] = ["9", "5", "4", "2"], extra: Record<string, unknown> = {}): Promise<{ quoteId: number; orderId: number }> {
  const id = priced(UNIT.map(([p, buy, , unit]) => [p, 1, buy, 0, unit] as Row), { x_price_mode: "net", ...extra });
  linesOf(id).forEach((l, i) => Object.assign(l, { x_final_price: 0, x_final_net: UNIT[i][2] }));
  await quiet(() => QT.issueSpecialQuotation(env, id, { now: now() }));
  await quiet(() => ACC.approveSpecialQuote(env, id, { now: now() }));
  linesOf(id).forEach((l, i) => { l.x_confirmed_qty = typed[i]; });
  const r = await quiet(() => ACC.convertSpecialQuote(env, id, { now: now(), ctx }));
  if (r.action !== "converted") throw new Error(`not converted: ${r.detail}`);
  return { quoteId: id, orderId: r.orderId! };
}
const GROSS = UNIT.map(([, , net]) => M.grossOf(net));
/** The day's published list: tomato (1/11) at 31 with a cost of 15 — the special order's tomato lines stand on that very packaging. */
function published(day = DAY): number {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: "أسعار", x_utak_simulation: false, x_published_at: utc(`${day} 06:00`) });
  seed("x_price_day_line", { x_day_id: d, x_sequence: 1, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 15, x_market_price: 31, x_sale_price: 31, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 22, x_utak_simulation: false });
  return d;
}
const itemsOf = (listId: number): any[] => JSON.parse(String(table("x_purchase_list").get(listId)!.x_aggregated_items));
const special = (items: any[]) => items.filter((it) => it.special_line);

// ============================================================================
console.log("\n[ب] «سعر خاص»: locked against the day's prices and any recalculation");
{
  const env = world();
  published();
  const { orderId, quoteId } = await converted(env);
  const before = orderLines(orderId).map((l) => ({ ...l }));
  const prices = () => JSON.stringify(orderLines(orderId).map((l) => [l.x_unit_price, l.x_price_unit_manual, l.x_subtotal, l.x_status]));
  const list = (await PV.validPriceList(env, now()))!;
  assert("a valid list is published, with tomato at 31 on the very packaging two special lines stand on", !!list && (await PV.listPrice(env, list, 1, 11)).price === 31 && before[1].x_packaging_id === 11 && before[1].x_unit_price === GROSS[1]);
  const w0 = odooLog.filter((c) => c.model === "x_daily_order_line" && c.method === "write").length;
  const fr = (await quiet(() => OF.freezeOrderPrices(env, orderId, list, new Date(now()))))!;
  assert("freezing the order's prices from that list changes NO line: not the price, not the status — and writes none", prices() === JSON.stringify(before.map((l) => [l.x_unit_price, l.x_price_unit_manual, l.x_subtotal, l.x_status])) && odooLog.filter((c) => c.model === "x_daily_order_line" && c.method === "write").length === w0);
  assert("…the items no list holds (not «نشط للبيع») stay in the order: nothing is «غير متوفر»", fr.lines === 4 && fr.unavailable.length === 0 && fr.unpriced === 0 && rows("x_unavailable_request").length === 0);
  assert("…and its total is the special prices'", fr.total === round(9 * GROSS[0] + 5 * GROSS[1] + 4 * GROSS[2] + 2 * GROSS[3]));
  // the manual price wiped in Odoo: the mark alone still locks the line
  for (const l of orderLines(orderId)) l.x_price_unit_manual = 0;
  await quiet(() => OF.freezeOrderPrices(env, orderId, list, new Date(now())));
  assert("with the manual price wiped: «سعر خاص» alone still keeps the price (31 is never taken, no line leaves)", orderLines(orderId).every((l, i) => l.x_unit_price === before[i].x_unit_price && l.x_status === "pending"));
  // the same line WITHOUT the mark is the day's: it takes the list's price, and an item the list does not hold leaves
  const twin = seed("x_daily_order", { x_customer_id: CUST, x_state: "draft", x_order_date: DAY, x_created_via: "whatsapp" });
  const t1 = seed("x_daily_order_line", { x_order_id: twin, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 5, x_unit_price: GROSS[1], x_status: "pending" });
  const t2 = seed("x_daily_order_line", { x_order_id: twin, x_product_tmpl_id: ORANGE, x_packaging_id: ORANGE * 10, x_quantity: 9, x_unit_price: GROSS[0], x_status: "pending" });
  await quiet(() => OF.freezeOrderPrices(env, twin, list, new Date(now())));
  assert("(an ordinary order's same lines are repriced from the list, and the item it does not hold leaves)", table("x_daily_order_line").get(t1)!.x_unit_price === 31 && table("x_daily_order_line").get(t2)!.x_status === "unavailable");
  // «التعبئة» on a line that is NOT «سعر خاص» names nothing: its packaging's name stands
  table("x_daily_order_line").get(t1)!.x_pack_text = "نص ليس اسماً";
  const plain = (await O.getOrderForInvoicing(env, twin))!.lines.find((l) => l.id === t1)!;
  const marked = (await O.getOrderForInvoicing(env, orderId))!.lines[1];
  assert("a line's name: the quotation's «التعبئة» for a line «سعر خاص», the packaging's own for any other", plain.packaging_name === "كرتون" && plain.special === false && plain.pack_text === "" && marked.packaging_name === "14 كيلو -مخمر" && marked.special === true && marked.pack_text === "14 كيلو -مخمر" && (await O.getOrderForInvoicing(env, orderId))!.special_quote_id === quoteId && (await O.getOrderForInvoicing(env, twin))!.special_quote_id === 0);
  // a new day's publication, and the quotation's own recalculation: nothing moves
  setRiyadh(`${NEXT} 06:05`);
  published(NEXT);
  const { quoteAwaitingOrders } = OF;
  await quiet(() => quoteAwaitingOrders(env, now(), ctx));
  for (const l of linesOf(quoteId)) l.x_final_net = 1;
  await quiet(() => (import("../src/special-quote.ts")).then((SQ) => SQ.recalcQuote(env, quoteId, { now: now() })));
  assert("the next day's publication and a recalculation of the request leave the order's prices as they were", orderLines(orderId).every((l, i) => l.x_unit_price === before[i].x_unit_price) && table("x_daily_order").get(orderId)!.x_state === "confirmed" && quote(quoteId).x_state === "accepted");
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the customer's own order of the day is never this one");
{
  const env = world();
  const id = priced();
  // the order as the conversion leaves it for a moment: a draft of the customer, on the day
  const half = seed("x_daily_order", { x_customer_id: MADARAT, x_state: "draft", x_order_date: DAY, x_created_via: "manual", x_special_quote_id: id });
  const mine = await O.findOrCreateTodayOrder(env, MADARAT, undefined, "wamid.1", new Date(now()));
  assert("a message of the customer opens an order of his own, not the one being made from his quotation", mine.created && mine.id !== half && !table("x_daily_order").get(mine.id)!.x_special_quote_id);
  const again = await O.findOrCreateTodayOrder(env, MADARAT, undefined, "wamid.2", new Date(now()));
  assert("…and his next message finds that same order", !again.created && again.id === mine.id);
}

// ============================================================================
console.log("\n[ج] the purchase list of the delivery's eve");
{
  const env = world(`${DAY} 14:00`);
  dp(1, 11, 20);
  const { orderId, quoteId } = await converted(env, ["9", "5", "4", "0"]);
  const daily = order(CUST, "confirmed", DAY, 1);          // طماطم كرتون × 3, an order of the day on the same item and packaging
  const name = String(quote(quoteId).x_name);
  setRiyadh(`${DAY} 21:15`);
  await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
  const [list] = rows("x_purchase_list") as any[];
  const items = itemsOf(list.id);
  const made = orderLines(orderId);
  assert("ONE list of the order's day — the eve of the delivery — with the day's order and the special one", rows("x_purchase_list").length === 1 && list.x_date === DAY && items.length === 4 && JSON.stringify([...new Set(items.flatMap((it) => it.order_ids))].sort()) === JSON.stringify([daily, orderId].sort()));
  const tomato = items.filter((it) => it.product_id === 1);
  assert("the special lines are items of their own: the day's tomato (كرتون × 3) is NOT merged with them, nor they with each other", tomato.length === 3 && tomato.filter((it) => !it.special_line).length === 1 && tomato.find((it) => !it.special_line).total_quantity === 3 && special(items).length === 3 && new Set(special(items).map((it) => it.special_line)).size === 3);
  assert("each by the quotation's «التعبئة», marked with the request's name and its own order line", JSON.stringify(special(items).map((it) => [it.product_name, it.packaging_name, it.total_quantity, it.special]).sort()) === JSON.stringify([["برتقال", "18 كيلو", 9, name], ["طماطم", "14 كيلو -مخمر", 5, name], ["طماطم", "14 كيلو -غير مخمر", 4, name]].sort()) && special(items).every((it) => made.some((l) => l.id === it.special_line)) && /^SQ-\d{4,}$/.test(name));
  assert("its target purchase price is the quotation's «الشراء», its source the one who gave it — never a price of the day", JSON.stringify(special(items).map((it) => [it.packaging_name, it.unit_price, it.price_supplier_id]).sort()) === JSON.stringify([["18 كيلو", 105, AHMED], ["14 كيلو -مخمر", 55, AHMED], ["14 كيلو -غير مخمر", 60, AHMED]].sort()));
  assert("…while the day's tomato takes the day's price (20), as it always did", tomato.find((it) => !it.special_line).unit_price === 20 && list.x_supplier_id === AHMED);
  assert("the line confirmed 0 is on no list", !items.some((it) => it.product_id === MUSHROOM));
  assert("both orders are in purchase now", table("x_daily_order").get(orderId)!.x_state === "in_purchase" && table("x_daily_order").get(daily)!.x_state === "in_purchase");
  const tpl = sentTo(WH_PHONE).find((b: any) => b?.template?.name === "utak_purchase_list_v2");
  const said = String(tpl?.template?.components?.[0]?.parameters?.[2]?.text ?? "");
  assert("the buyer's list names them: « (طلب خاص SQ-…، الشراء المستهدف 105)» — and the day's line carries no mark and no price", said.includes(`برتقال — 18 كيلو × 9 (طلب خاص ${name}، الشراء المستهدف 105)`) && said.includes(`طماطم — 14 كيلو -مخمر × 5 (طلب خاص ${name}، الشراء المستهدف 55)`) && /طماطم — كرتون × 3(،|$)/.test(said), said);
  openWindow(env, WH_PHONE);
  const n0 = textsTo(WH_PHONE).length + sentTo(WH_PHONE).filter((b: any) => b?.interactive).length;
  await quiet(() => TEAM.resendOpenPurchaseLists(env, "+" + WH_PHONE));
  const full = sentTo(WH_PHONE).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? "")).slice(-1)[0] ?? "";
  assert("…and in the full list the buyer gets when he writes", sentTo(WH_PHONE).length > n0 && full.includes(`برتقال — 18 كيلو × 9 (طلب خاص ${name}، الشراء المستهدف 105)`), full.slice(0, 300));
  assert("…in the session's message too", TEAM.renderPurchaseListMessage(items).includes(`طماطم — 14 كيلو -غير مخمر × 4 (طلب خاص ${name}، الشراء المستهدف 60)`) && TEAM.specialNote({ special: "SQ-0004", unit_price: null }) === " (طلب خاص SQ-0004)" && TEAM.specialNote({ unit_price: 9 }) === "");
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));

  // the 21:15 job again the same night: a price Baraa corrected on a special item stays, and nothing doubles
  const edited = itemsOf(list.id).map((it) => (it.packaging_name === "18 كيلو" ? { ...it, unit_price: 108 } : it));
  table("x_purchase_list").get(list.id)!.x_aggregated_items = JSON.stringify(edited);
  for (const o of [orderId, daily]) table("x_daily_order").get(o)!.x_state = "confirmed";
  await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
  const second = itemsOf(list.id);
  assert("run again: the same four items, and the corrected price of the special item is kept", rows("x_purchase_list").length === 1 && second.length === 4 && second.find((it) => it.packaging_name === "18 كيلو").unit_price === 108 && second.find((it) => it.packaging_name === "14 كيلو -مخمر").unit_price === 55);

  // ---- the receipt: the special line's own quantity, never another's
  const rl = (await RF.readReceiptList(env, list.id))!;
  const shown = RF.receiptItems(rl.items).shown;
  const slot = (pack: string) => shown.find((s) => s.hint.startsWith(pack))!;
  assert("the receipt form: a slot a line — the three tomato lines stand apart, each with its own key", shown.length === 4 && shown.filter((s) => s.productId === 1).length === 3 && shown.filter((s) => s.productId === 1 && s.special).length === 2 && !slot("كرتون ·").special);
  const got = RF.receivedLines(rl.items, [{ item: slot("14 كيلو -مخمر"), quantity: 4 }, { item: slot("كرتون ·"), quantity: 2 }]);
  const after = (pack: string) => got.next.find((it) => it.packaging_name === pack)!;
  assert("4 received of «14 كيلو -مخمر» and 2 of the day's tomato: each on its own line, the others as ordered", after("14 كيلو -مخمر").total_quantity === 4 && after("كرتون").total_quantity === 2 && after("14 كيلو -غير مخمر").total_quantity === 4 && after("18 كيلو").total_quantity === 9 && after("14 كيلو -مخمر").ordered_quantity === 5);
  const options = await RF.receiptCatalog(env, rl.items);
  assert("a special line is no option of a cash-market purchase (its packaging's name is not its item's)", options.filter((o) => o.id === "1:11").length === 1 && !options.some((o) => o.title.includes("14 كيلو")) && !options.some((o) => o.id.startsWith(`${ORANGE}:`)));

  // ---- «تم الشراء»: the lines are bought, the route goes out, the dues are built, the real price goes back
  await quiet(() => TEAM.warehouseConfirmedPurchase(env, list.id));
  assert("the list is confirmed and every line bought", table("x_purchase_list").get(list.id)!.x_status === "done" && orderLines(orderId).every((l) => l.x_status === "purchased"));
  assert("what the special item was really bought at (108, not the target 105) is written on its order line; the others keep theirs", orderLines(orderId).find((l) => l.x_pack_text === "18 كيلو")!.x_special_purchase === 108 && orderLines(orderId).find((l) => l.x_pack_text === "14 كيلو -مخمر")!.x_special_purchase === 55);
  // only what changed is written, and only on a line «سعر خاص»
  const plainLine = seed("x_daily_order_line", { x_order_id: daily, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 1, x_unit_price: 5, x_status: "pending" });
  const w0 = odooLog.filter((c) => c.model === "x_daily_order_line" && c.method === "write").length;
  const moved = orderLines(orderId).find((l) => l.x_pack_text === "14 كيلو -مخمر")!.id;
  const wrote = await quiet(() => ACC.syncSpecialPurchase(env, [...itemsOf(list.id).map((it) => (it.special_line === moved ? { ...it, unit_price: 56 } : it)), { special_line: plainLine, unit_price: 99 }]));
  assert("written again: only the price that moved (55 → 56), never on a line that is not «سعر خاص»", wrote === 1 && odooLog.filter((c) => c.model === "x_daily_order_line" && c.method === "write").length === w0 + 1 && !table("x_daily_order_line").get(plainLine)!.x_special_purchase && orderLines(orderId).find((l) => l.x_pack_text === "14 كيلو -مخمر")!.x_special_purchase === 56);
  orderLines(orderId).find((l) => l.x_pack_text === "14 كيلو -مخمر")!.x_special_purchase = 55;
  table("x_daily_order_line").delete(plainLine);
  const stop = (rows("x_delivery_stop") as any[]).find((s) => s.x_order_id === orderId);
  const note = (await quiet(() => DN.buildDeliveryNotePDFDataFromOdoo(env, stop.id)))!;
  assert("the delivery note prints each line's own «التعبئة»", JSON.stringify(note.items.map((i: any) => i.pack)) === JSON.stringify(["18 كيلو", "14 كيلو -مخمر", "14 كيلو -غير مخمر"]));
  const omar = String(table("res.partner").get(OMAR)!.x_whatsapp_number).replace("+", "");
  const route = [...sentTo(omar), ...heldFor(env, omar)].map((b: any) => JSON.stringify(b)).join(" ");
  assert("the driver's stop names the lines by their «التعبئة»", !!stop &&  route.includes("طماطم 14 كيلو -مخمر × 5") && route.includes("برتقال 18 كيلو × 9") && !route.includes("برتقال كرتون · 8 كيلو"), route.slice(0, 300));
  const dues = rows("x_supplier_due") as any[];
  const dlines = (rows("x_supplier_due_line") as any[]).filter((l) => l.x_due_id === dues[0]?.id);
  assert("ONE due of Ahmed: the day's tomato at his price of the day, each special line at the list's own price of it", dues.length === 1 && dues[0].x_supplier_id === AHMED && dlines.length === 4 && JSON.stringify(dlines.map((l) => [l.x_quantity, l.x_unit_price]).sort()) === JSON.stringify([[3, 20], [4, 60], [5, 55], [9, 108]].sort()) && dlines.every((l) => l.x_no_price === false));
  assert("…a special line's note says whose it is; the day's line says nothing of it", dlines.filter((l) => String(l.x_note || "").includes(`طلب خاص ${name} — `)).length === 3 && dlines.filter((l) => String(l.x_note || "").includes("14 كيلو -مخمر")).length === 1);
  await quiet(() => SP.syncSupplierDues(env, list.id, { force: true }));
  const again = (rows("x_supplier_due_line") as any[]).filter((l) => l.x_due_id === dues[0].id);
  assert("built again: the same four lines — three lines of ONE item and packaging are never folded into one", again.length === 4 && JSON.stringify(again.map((l) => [l.x_quantity, l.x_unit_price]).sort()) === JSON.stringify([[3, 20], [4, 60], [5, 55], [9, 108]].sort()));
}

console.log("\n[ج] a day the market won the item: the special lines on its packaging are not the market's");
{
  const env = world(`${DAY} 14:00`);
  const cash = seed("res.partner", { name: CM.CASH_MARKET_NAME, ref: CM.CASH_MARKET_REF, supplier_rank: 1 });
  const d = published();
  // Raed (a market source, no supplier) wrote the winning purchase price of tomato كرتون that day
  Object.assign([...table("x_price_day_line").values()].find((l) => l.x_day_id === d)!, { x_supplier_id: 880, x_source_price: 18 });
  const { orderId } = await converted(env, ["0", "5", "0", "0"]);
  order(CUST, "confirmed", DAY, 1);
  setRiyadh(`${DAY} 21:15`);
  await quiet(() => TEAM.aggregateAndDispatchToWarehouse(env));
  const [list] = rows("x_purchase_list") as any[];
  assert("the market won tomato كرتون that day", (await SP.readMarketPlan(env, DAY)).winners.has(CM.winnerKey(1, 11)) && (await SP.readMarketPlan(env, DAY)).cashSupplierId === cash);
  openWindow(env, WH_PHONE);
  await quiet(() => RF.sendReceiptForm(env, { partnerId: 601, name: "أحمد", whatsapp: "+" + WH_PHONE }, list.id, { now: now() }));
  const data = sentTo(WH_PHONE).filter((b: any) => b?.interactive?.type === "flow").slice(-1)[0]?.interactive?.action?.parameters?.flow_action_payload?.data ?? {};
  const hints = Object.entries(data).filter(([k]) => /^h\d+$/.test(k)).map(([, v]) => String(v)).filter(Boolean);
  assert("the receipt names the day's tomato «مشتريات السوق النقدية» — and the special line on the same packaging its own supplier", hints.some((h) => h.startsWith("كرتون ·") && h.includes(CM.CASH_MARKET_NAME)) && hints.some((h) => h.startsWith("14 كيلو -مخمر") && h.includes("أحمد حسان") && !h.includes(CM.CASH_MARKET_NAME)), JSON.stringify(hints));
  const who = await quiet(() => SP.todaysSuppliers(env, now()));
  assert("today's suppliers to pay: the cash market for the day's tomato, AND Ahmed for the special line", JSON.stringify(who.map((w: any) => w.id).sort()) === JSON.stringify([AHMED, cash].sort()), JSON.stringify(who));
  void orderId;
}

console.log("\n[ج] the due and the bill, as they are planned");
{
  const item = (over: Record<string, unknown>) => ({ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 3, order_ids: [1], price_supplier_id: AHMED, ...over });
  const price = { id: 9, x_supplier_id: [AHMED, "أحمد"], x_product_tmpl_id: [1, "طماطم"], x_packaging_id: [11, "كرتون"], x_date: DAY, x_price_sar: 20, x_extraction_status: "extracted" } as any;
  const market = { cashSupplierId: 104, winners: new Map([["1:11", { price: 18, sourceName: "عمر" }]]) } as any;
  const key = [...market.winners.keys()][0];
  void key;
  const { winnerKey } = await import("../src/cash-market.ts");
  market.winners = new Map([[winnerKey(1, 11), { price: 18, sourceName: "عمر" }]]);
  const plan = SP.planDues({ x_date: DAY, listSupplierId: AHMED }, [item({}), item({ packaging_name: "14 كيلو -مخمر", total_quantity: 5, unit_price: 55, special: "SQ-0004", special_line: 77 }), item({ packaging_name: "18 كيلو", total_quantity: 2, unit_price: null, special: "SQ-0004", special_line: 78 })] as any, [price], market);
  const cash = plan.dues.find((d) => d.supplierId === 104)!, ahmed = plan.dues.find((d) => d.supplierId === AHMED)!;
  assert("the market won the day's tomato: owed to «مشتريات السوق النقدية» — the special lines on that packaging are NOT the market's", cash.lines.length === 1 && cash.lines[0].unitPrice === 18 && ahmed.lines.length === 2 && ahmed.lines.every((l) => l.special === "SQ-0004"));
  assert("a special line is owed at the list's own price of it (55 × 5), never the supplier's price of the day (20)", ahmed.lines[0].unitPrice === 55 && ahmed.lines[0].subtotalH === 27500 && ahmed.lines[0].priceId === null && !ahmed.lines[0].noPrice);
  assert("…and one with no price in the list is «بلا سعر», counted", ahmed.lines[1].noPrice && ahmed.lines[1].unitPrice === null && ahmed.unpriced === 1 && ahmed.amountH === 27500);
  const bills = PA.planSupplierBills([item({ unit_price: 20 }), item({ packaging_name: "14 كيلو -مخمر", total_quantity: 5, unit_price: 55, special: "SQ-0004", special_line: 77 })] as any, AHMED, market);
  assert("the vendor bills: the day's tomato on the cash-market's at the price that won, the special line on Ahmed's at 55", bills.bills.length === 2 && bills.bills.find((b) => b.supplierId === 104)!.items[0].unit_price === 18 && bills.bills.find((b) => b.supplierId === AHMED)!.items[0].unit_price === 55 && bills.bills.find((b) => b.supplierId === AHMED)!.items.length === 1);
  assert("the key of an item: its item and packaging — and a special line's own", O.purchaseItemKey({ product_id: 1, packaging_id: 11 }) === "1::11" && O.purchaseItemKey({ product_id: 1, packaging_id: 11, special_line: 77 }) === "1::11::sq77");
  const agg = O.aggregatePurchaseList([
    { order_id: 1, customer_id: 1, customer_name: "أ", neighborhood: "", product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", quantity: 3 },
    { order_id: 2, customer_id: 1, customer_name: "أ", neighborhood: "", product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", quantity: 2 },
    { order_id: 3, customer_id: 2, customer_name: "ب", neighborhood: "", product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "14 كيلو", quantity: 5, special: "SQ-0004", special_line: 77, special_purchase: 55, special_supplier_id: AHMED },
  ]);
  assert("aggregation: the day's lines of one item add up (5); the special line stands alone with its price and its source", agg.length === 2 && agg.find((a) => !a.special_line)!.total_quantity === 5 && agg.find((a) => a.special_line === 77)!.unit_price === 55 && agg.find((a) => a.special_line === 77)!.price_supplier_id === AHMED && agg.find((a) => a.special_line === 77)!.total_quantity === 5);
}

// ============================================================================
console.log("\n[د] the delivery and the invoice");
{
  const env = world(`${DAY} 14:00`);
  for (const d of [OWNER, MADARAT_PHONE]) openWindow(env, d);
  const { orderId, quoteId } = await converted(env, ["9", "5", "4", "2"]);
  const total = round(9 * GROSS[0] + 5 * GROSS[1] + 4 * GROSS[2] + 2 * GROSS[3]);
  const lines = (await DF.deliveryLines(env, orderId, now()))!;
  assert("«📦 سلّم وحصّل»: the form's lines by their «التعبئة», at the special prices", lines.lines.length === 4 && JSON.stringify(lines.lines.map((l) => [l.name, l.ordered, l.price])) === JSON.stringify([["برتقال 18 كيلو", 9, GROSS[0]], ["طماطم 14 كيلو -مخمر", 5, GROSS[1]], ["طماطم 14 كيلو -غير مخمر", 4, GROSS[2]], ["فطر أبيض كرتون 2 كجم", 2, GROSS[3]]]));
  // the quotation the customer holds: «قبل الضريبة» by these quantities prints the invoice's own total
  const SQ = await import("../src/special-quote.ts");
  const asQuoted = (await SQ.readQuote(env, quoteId))!;
  const byQty = QT.specialQuotationData({ ...asQuoted, layout: "qty", lines: asQuoted.lines.map((l, i) => ({ ...l, qty: [9, 5, 4, 2][i] })) }, "S1", { name: "م", address: "", phone: "" }, now());
  assert("the quotation «قبل الضريبة» by these quantities: «الإجمالي» is the lines at their VAT-inclusive prices, the VAT row the rest", byQty.grandTotal === total && byQty.subtotal === round(9 * 121.3 + 5 * 63.7 + 4 * 69.35 + 2 * 12.83) && byQty.vatAmount === round(total - byQty.subtotal) && byQty.vatInclusive === false);
  setRiyadh(`${NEXT} 08:00`);
  const r = await quiet(() => deliverOrder(env, orderId));
  const [inv] = (rows("x_invoice") as any[]).filter((i) => i.x_order_id === orderId);
  assert("delivered by the day's own path: ONE invoice", r.delivered && (rows("x_invoice") as any[]).length === 1 && table("x_daily_order").get(orderId)!.x_state === "delivered");
  assert("the invoice's total = the quotation's total, to the halala (the price before VAT × 1.15 to the halala, × the quantity)", inv.x_total === total && inv.x_total === byQty.grandTotal && inv.x_total === quote(quoteId).x_confirmed_total && round(inv.x_subtotal + inv.x_tax_amount) === total, JSON.stringify([inv.x_total, total, byQty.grandTotal]));
  assert("…and its lines are the special prices, by their «التعبئة»", orderLines(orderId).every((l, i) => l.x_unit_price === GROSS[i]) && textsTo(MADARAT_PHONE).concat(sentTo(MADARAT_PHONE).map((b: any) => JSON.stringify(b))).join(" ").includes("برتقال 18 كيلو × 9"));
  const pdf = (await quiet(() => import("../src/invoice.ts").then((I) => I.buildInvoicePDFDataFromOdoo(env, inv.id))))!;
  assert("the invoice's PDF prints each line's own «التعبئة»", JSON.stringify(pdf.items.map((i: any) => i.pack)) === JSON.stringify(["18 كيلو", "14 كيلو -مخمر", "14 كيلو -غير مخمر", "كرتون 2 كجم"]));
  // (the harness's worker stamps what it creates «x_is_simulation», as the pilot does: the reader is asked for those)
  const mine = (await quiet(() => CF.deliveredOrders(env, { partnerId: MADARAT, simulation: true }))).flatMap((o: any) => o.lines);
  assert("«⚠️ عندي ملاحظة» lists the delivered lines by their «التعبئة» (two tomato lines told apart)", mine.filter((l: any) => l.productId === 1).length === 2 && JSON.stringify(mine.filter((l: any) => l.productId === 1).map((l: any) => l.packaging)) === JSON.stringify(["14 كيلو -مخمر", "14 كيلو -غير مخمر"]));
  assert("no call was refused by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د] what was delivered, not what was confirmed; and no quantity discount");
{
  const env = world(`${DAY} 14:00`);
  openWindow(env, OWNER);
  const { orderId } = await converted(env, ["9", "5", "4", "2"]);
  setRiyadh(`${NEXT} 08:00`);
  const sent = await quiet(() => DF.sendDeliveryForm(env, orderId, { kind: "owner", partnerId: null, name: "براء", whatsapp: OWNER }, { now: now() }));
  // 7 of the 9 cartons (2 short), the 4 of «غير مخمر» refused whole
  const reply = await quiet(() => DF.handleDeliveryFormReply(env, { from: "+" + OWNER, messageId: "wamid.S66", flow: { token: sent.token!, values: { q1: "7", r1: "short", q2: "5", r2: "none", q3: "0", r3: "refused", q4: "2", r4: "none", pay: "unpaid", amt: "", note: "" } } }, undefined, now()));
  const [inv] = (rows("x_invoice") as any[]).filter((i) => i.x_order_id === orderId);
  assert("the form's «إرسال» delivers it: the invoice bills 7 + 5 + 2 at the special prices — the short and the refused are not billed", !!sent.token && !!reply && !!inv && inv.x_total === round(7 * GROSS[0] + 5 * GROSS[1] + 2 * GROSS[3]), JSON.stringify([inv?.x_total, reply]));

  // a discount tier that an ordinary order of the same value takes: the special order takes none
  const env2 = world(`${DAY} 14:00`);
  published();
  table("x_pricing_config").get(1)!.x_planned_stops = 12;
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 1, x_amount_from: 100, x_amount_to: 0, x_discount_pct: 3, x_active: true });
  const id = priced([[1, 100, 15, 115, "كرتون"]]);
  await quiet(() => QT.issueSpecialQuotation(env2, id, { now: now() }));
  await quiet(() => ACC.approveSpecialQuote(env2, id, { now: now() }));
  const c = await quiet(() => ACC.convertSpecialQuote(env2, id, { now: now(), ctx }));
  const twin = seed("x_daily_order", { x_customer_id: CUST, x_state: "confirmed", x_order_date: DAY, x_price_date: DAY, x_created_via: "whatsapp" });
  seed("x_daily_order_line", { x_order_id: twin, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 100, x_unit_price: 115, x_status: "pending" });
  openWindow(env2, CUST_PHONE);
  setRiyadh(`${NEXT} 08:00`);
  await quiet(() => deliverOrder(env2, twin));
  await quiet(() => deliverOrder(env2, c.orderId!));
  const of = (o: number) => (rows("x_invoice") as any[]).find((i) => i.x_order_id === o);
  assert("(an ordinary order of 11,500 takes the tier's 3 % before VAT)", of(twin).x_discount === 300 && of(twin).x_total === 11155);
  assert("the special order of the same lines is invoiced at its quotation's prices: no discount, 11,500 to the halala", !(of(c.orderId!).x_discount > 0) && !(of(c.orderId!).x_discount_pct > 0) && of(c.orderId!).x_total === 11500 && of(c.orderId!).x_total === quote(id).x_total);
}

console.log("\n[د] the sale order at the delivery (ACCOUNTING_SYNC)");
{
  const env = world(`${DAY} 14:00`);
  env.ACCOUNTING_SYNC = "true";
  const { orderId } = await converted(env, ["9", "5", "0", "2"]);
  const so = saleOrders()[0], made = orderLines(orderId);
  const ensured = await quiet(() => SA.ensureSaleOrderForDailyOrder(env, orderId));
  assert("the order's sale order IS the quotation, confirmed: no second one is made", ensured?.saleOrderId === so.id && ensured.created === false && saleOrders().length === 1 && so.state === "sale");
  const existing = saleLines(so.id).map((l) => ({ id: l.id, sequence: l.sequence, product_uom_qty: l.product_uom_qty }));
  const cmds = SA.buildDeliveryLineCommands(existing, [{ lineId: made[0].id, description: "x", quantity: 7, priceUnit: made[0].x_unit_price }, { lineId: made[1].id, description: "x", quantity: 5, priceUnit: made[1].x_unit_price }], SERVICE, [77]);
  const on = (lineId: number) => cmds.find((c) => c[0] === 1 && c[1] === saleLines(so.id).find((l) => l.sequence === lineId)!.id)?.[2] as any;
  assert("the delivery bills it by the order's lines: 7 of 9 and 5 delivered on their own lines, at the special prices", on(made[0].id).qty_delivered === 7 && on(made[0].id).price_unit === GROSS[0] && on(made[1].id).qty_delivered === 5 && !cmds.some((c) => c[0] === 0));
  assert("…the line not delivered, and the one outside the order, are delivered 0 (nothing of them is billed)", on(made[2].id).qty_delivered === 0 && cmds.filter((c) => (c[2] as any).qty_delivered === 0).length === 2);
  assert("an ordinary order's sale line tells a special line by its «التعبئة» too", (await quiet(async () => { const o = seed("x_daily_order", { x_customer_id: CUST, x_state: "confirmed", x_order_date: DAY, x_created_via: "manual" }); seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 2, x_unit_price: 73.26, x_status: "pending", x_special_price: true, x_pack_text: "14 كيلو -مخمر" }); const r = await SA.ensureSaleOrderForDailyOrder(env, o); return saleLines(r!.saleOrderId)[0].name; })) === "طماطم — 14 كيلو -مخمر");
}

// ============================================================================
console.log("\n[د] the day's profit: what the special lines were really bought at");
{
  const env = world(`${DAY} 14:00`);
  published();
  const { orderId } = await converted(env, ["9", "5", "0", "0"]);
  const daily = seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_order_date: DAY, x_price_date: DAY, x_created_via: "whatsapp", x_delivered_at: utc(`${NEXT} 08:00`) });
  seed("x_daily_order_line", { x_order_id: daily, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 10, x_unit_price: 31, x_status: "purchased" });
  Object.assign(table("x_daily_order").get(orderId)!, { x_state: "delivered", x_delivered_at: utc(`${NEXT} 08:30`) });
  // the orange was really bought at 108
  orderLines(orderId).find((l) => l.x_pack_text === "18 كيلو")!.x_special_purchase = 108;
  const sold = await INS.readSoldLines(env, NEXT, NEXT);
  const sp = sold.lines.filter((l) => l.special);
  assert("«📊 اليوم» reads the day's delivery with the day's cost (15) and the special lines with their own purchase prices (108, 55)", sold.lines.length === 3 && sold.orders === 2 && sold.lines.find((l) => !l.special)!.purchase === 15 && JSON.stringify(sp.map((l) => [l.quantity, l.sale, l.purchase])) === JSON.stringify([[9, GROSS[0], 108], [5, GROSS[1], 55]]));
  assert("…under a key no item of the day carries (the tomato's history is not theirs)", sp.every((l) => l.key.endsWith(":sq")) && sold.lines.find((l) => !l.special)!.key === "1:11");
  const a = INS.actualInput(sold.lines, NEXT, 15);
  const margin = 10 * (31 / 1.15 - 15) + 9 * (GROSS[0] / 1.15 - 108) + 5 * (GROSS[1] / 1.15 - 55);
  assert("the day's margin counts them by what they were bought at", Math.abs(a.marginTotal - margin) < 0.001 && a.cartons === 24);
  // a special line sold by the kilo: its margin counts, its kilos are no cartons
  orderLines(orderId)[1].x_pack_text = "كيلو";
  const kilo = INS.actualInput((await INS.readSoldLines(env, NEXT, NEXT)).lines, NEXT, 15);
  assert("a special line sold by the kilo: in the margin, not in the day's cartons", kilo.cartons === 19 && Math.abs(kilo.marginTotal - margin) < 0.001);
  // a special line with no purchase price: never a partial sum
  orderLines(orderId)[0].x_special_purchase = 0;
  let threw = "";
  await INS.readSoldLines(env, NEXT, NEXT).catch((e) => { threw = String(e?.message); });
  assert("a special line with no purchase price: the day's figure is «تعذّر», never a partial sum", threw === "a special quotation's line without its purchase price");
  orderLines(orderId)[0].x_special_purchase = 108;
  orderLines(orderId)[1].x_pack_text = "14 كيلو -مخمر";
  // the 21:30 summary of the order day's deliveries: the same prices
  const figures = await quiet(() => SUM.readSummaryFigures(env, Date.parse(`${NEXT}T21:30:00+03:00`)));
  const waste = 0.05;
  const profit = round(10 * (31 / 1.15 - 15 - waste * 15) + 9 * (GROSS[0] / 1.15 - 108 - waste * 108) + 5 * (GROSS[1] / 1.15 - 55 - waste * 55));
  assert("the 21:30 summary's profit of the deliveries: the special lines at 108 and 55, the day's cost as the system computes it", figures.coverage.profit === profit && figures.coverage.cost === 600 && !figures.errors.some((e) => e.startsWith("coverage")), JSON.stringify([figures.coverage, profit, figures.errors]));
}

done();
