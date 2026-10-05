// Mutation check for § 49 (2026-10-01): each mutation disables ONE guard of a part, runs that part's
// test file, and must make it fail. The source is restored in `finally` after every run; a pattern
// that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// some mutations edit scripts/lib/s49-ui.mjs in place, and an Odoo setup script reading a mutated
// lib would write it to the tenant.
//
//   node scripts/mutation/s49-20261001-mutations.mjs [أ|ب|ج|د|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s49-20261001-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s49.test.mts";
const TS = "tests/s49-sources.test.mts";
const TU = "tests/s49-ui.test.mts";
const PV = "src/price-validity.ts";
const OF = "src/order-flow.ts";
const RT = "src/router.ts";
const OD = "src/odoo.ts";
const HR = "src/hours.ts";
const TM = "src/team.ts";
const PR = "src/prices.ts";
const QU = "src/quotation.ts";
const IV = "src/invoice.ts";
const IX = "src/index.ts";
const GW = "src/wa-gateway.ts";
const OC = "src/operating-cost.ts";
const PS = "src/price-sources.ts";
const EN = "src/pricing-engine.ts";
const SU = "src/suppliers.ts";
const UI = "scripts/lib/s49-ui.mjs";
const DOC = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the minimum order
  ["أ", "an empty or zero setting reads as 150", [[OC,
    "    minOrder: Math.max(0, Number(r.x_min_order_sar) || 0),", "    minOrder: Math.max(0, Number(r.x_min_order_sar) || 150),"]], T],
  ["أ", "a setting of 0 still checks the order (anything is «below»)", [["src/order-pricing.ts",
    "  if (!(min > 0)) return { total: 0, min: 0, below: false, unpriced: 0 };", "  if (!(min > 0)) return { total: 0, min: 150, below: true, unpriced: 0 };"]], T],
  ["أ", "the setting is not read: the minimum is always none", [["src/order-pricing.ts",
    "  const min = settings?.minOrder ?? 0;", "  const min = 0;"]], T],
  ["أ", "«أبغى أعرف أكثر» still names a minimum order", [[RT,
    "• أسعار جملة تنافسية\n", "• أسعار جملة تنافسية\n• لا حد أدنى للطلب في الأسبوع الأول\n"]], T],
  ["أ", "Odoo keeps 150 on the settings record", [[UI,
    "export const MIN_ORDER_SAR = 0;", "export const MIN_ORDER_SAR = 150;"]], T],
  // ---------------------------------------------------------------- ب the validity of a price list
  ["ب", "a list ends at 21:00 (the old closing time), not 06:00", [[PV,
    "export const LIST_EXPIRY_MINUTE = 6 * 60;", "export const LIST_EXPIRY_MINUTE = 21 * 60;"]], T],
  ["ب", "a list ends at 06:00 of its OWN day", [[PV,
    "  const own = riyadhDayMinuteMs(addDaysYmd(day, 1), LIST_EXPIRY_MINUTE);", "  const own = riyadhDayMinuteMs(day, LIST_EXPIRY_MINUTE);"]], T],
  ["ب", "at 06:00 sharp the list is still valid", [[PV,
    "  return nowMs < listValidUntilMs(day, publishedAtMs);", "  return nowMs <= listValidUntilMs(day, publishedAtMs);"]], T],
  ["ب", "a late publication is dead on arrival (no «until the next 06:00»)", [[PV,
    "publishedAtMs >= own ? nextExpiryAfter(publishedAtMs) : own;", "publishedAtMs >= own ? own : own;"]], T],
  ["ب", "the next 06:00 after 05:59 is tomorrow's", [[PV,
    "  return ms < today ? today : riyadhDayMinuteMs(addDaysYmd(day, 1), LIST_EXPIRY_MINUTE);", "  return riyadhDayMinuteMs(addDaysYmd(day, 1), LIST_EXPIRY_MINUTE);"]], T],
  ["ب", "the last published list is valid whatever its age", [[PV,
    "    if (isValidAt(l.day, l.publishedAtMs, nowMs)) return l;", "    return l;"]], T],
  ["ب", "a day that is not published counts as a list", [[PV,
    "    domain: [[\"x_state\", \"=\", \"published\"], [\"x_utak_simulation\", \"!=\", true], [\"x_date\", \">=\",", "    domain: [[\"x_utak_simulation\", \"!=\", true], [\"x_date\", \">=\","]], T],
  ["ب", "a simulation day counts as a list", [[PV,
    "    domain: [[\"x_state\", \"=\", \"published\"], [\"x_utak_simulation\", \"!=\", true], [\"x_date\", \">=\",", "    domain: [[\"x_state\", \"=\", \"published\"], [\"x_date\", \">=\","]], T],
  ["ب", "an item's price is looked for in every day's lines", [[PV,
    "    domain: [[\"x_day_id\", \"=\", list.dayId], [\"x_utak_simulation\", \"!=\", true], [\"x_product_tmpl_id\", \"=\", productId],", "    domain: [[\"x_utak_simulation\", \"!=\", true], [\"x_product_tmpl_id\", \"=\", productId],"]], T],
  ["ب", "a line left out of the publication is a published price", [[PV,
    "  const published = lines.find((l) => !l.x_excluded && Number(l.x_sale_price) > 0);", "  const published = lines.find((l) => Number(l.x_sale_price) > 0);"]], T],
  ["ب", "an unpublished item of the valid day has no price (no suggested price)", [[PV,
    "  if (suggested) return { price: Number(suggested.x_suggested_price), source: \"suggested\" };\n", ""]], T],
  ["ب", "the list of the order's day is valid although it expired", [[PV,
    "  return isValidAt(l.day, l.publishedAtMs, nowMs) ? l : null;", "  return l;"]], T],
  // ---------------------------------------------------------------- ب an order at every hour
  ["ب", "the order's day is the UTC date again", [[OD,
    "  const today = nextOrderingDate(now);\n\n  type OrderRow", "  const today = now.toISOString().slice(0, 10);\n\n  type OrderRow"]], T],
  ["ب", "after 21:00 the order is still today's", [[HR,
    "  if (riyadhHour(now) >= ORDERING_HOURS_CLOSE) {\n    return riyadhDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));", "  if (riyadhHour(now) >= 24) {\n    return riyadhDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));"]], T],
  ["ب", "the delivery day is the ordering day itself", [[HR,
    "  return addDaysYmd(orderDay, 1);", "  return addDaysYmd(orderDay, 0);"]], T],
  ["ب", "an order message is refused outside 06:00–21:00 again", [[RT,
    "  const quotationInline = isQuotationTrigger(msg.text);\n", "  const quotationInline = isQuotationTrigger(msg.text);\n  if (!(await (await import(\"./hours\")).isOrderingHoursOpen(env))) return { text: \"استقبال الطلبات مقفل الآن\" };\n"]], T],
  ["ب", "an order waiting for prices is not the open order (a second message starts another)", [[OD,
    "      \"|\", [\"x_order_date\", \"=\", today], [\"x_awaiting_prices\", \"=\", true],", "      [\"x_order_date\", \"=\", today], [\"x_awaiting_prices\", \"!=\", true],"]], T],
  ["ب", "no valid list: the order message asks for «خلاص» as if there were prices", [[RT,
    "  if (list === null) {\n    await markAwaitingPrices(env, orderId);", "  if (false) {\n    await markAwaitingPrices(env, orderId);"]], T],
  ["ب", "no valid list: the order is not marked «بانتظار أسعار اليوم»", [[OF,
    "  if (!o.awaitingPrices) vals.x_awaiting_prices = true;\n", ""]], T],
  ["ب", "an expired quotation that waits for prices stays «waiting for confirmation»", [[OF,
    "  if (o.state === \"waiting_confirmation\") vals.x_state = \"draft\";\n", ""]], T],
  ["ب", "the wait's wording differs from Baraa's", [[OF,
    "export const AWAITING_TEXT = \"استلمنا طلبك ✅ الأسعار تتحدث، ونرسل لك عرض السعر أول ما تنتشر أسعار اليوم.\";", "export const AWAITING_TEXT = \"استلمنا طلبك ✅ ونرسل لك عرض السعر لاحقاً.\";"]], T],
  // ---------------------------------------------------------------- ب the frozen prices
  ["ب", "the prices are not frozen on the order's lines", [[OF,
    "      await call<boolean>(env, \"x_daily_order_line\", \"write\", { ids: [l.id], vals: { x_unit_price: unit, x_subtotal: subtotal } });\n", ""]], T],
  ["ب", "the order does not carry its price list", [[OF,
    "vals: { x_price_date: list.day, x_order_date: orderDay, x_awaiting_prices: false } });", "vals: { x_order_date: orderDay, x_awaiting_prices: false } });"]], T],
  ["ب", "a quoted order keeps waiting for prices", [[OF,
    "vals: { x_price_date: list.day, x_order_date: orderDay, x_awaiting_prices: false } });", "vals: { x_price_date: list.day, x_order_date: orderDay } });"]], T],
  ["ب", "the quotation leaves the order on its old day", [[OF,
    "vals: { x_price_date: list.day, x_order_date: orderDay, x_awaiting_prices: false } });", "vals: { x_price_date: list.day, x_awaiting_prices: false } });"]], T],
  ["ب", "Baraa's manual price on a line is overwritten by the list's", [[OF,
    "    const unit = manual || (await listPrice(env, list, l.product_id, l.packaging_id)).price;", "    const unit = (await listPrice(env, list, l.product_id, l.packaging_id)).price;"]], T],
  ["ب", "an order priced from a list still takes a later lookup (an older day's price)", [[OD,
    "  if (order.price_date) return { price: 0, source: \"missing\", price_date: null, age_days: null };\n  return getLatestSalePrice(env, productId, packagingId, order.order_date ?? fallbackDay);", "  return getLatestSalePrice(env, productId, packagingId, order.order_date ?? fallbackDay);"]], T],
  ["ب", "the invoice prices the line again instead of its frozen price", [[IV,
    "    let unit = l.unit_price ?? 0;\n    if (!unit || unit <= 0) {\n      // sim-harness (2026-09-13): getLatestSalePrice now returns a tagged", "    let unit = 0;\n    if (!unit || unit <= 0) {\n      // sim-harness (2026-09-13): getLatestSalePrice now returns a tagged"]], T],
  // ---------------------------------------------------------------- ب the waiting order at the publication
  ["ب", "the publication does not quote the waiting orders", [[PR,
    "    const awaiting = await quoteWaitingAfterPublication(penv, now, opts.ctx);", "    const awaiting: AwaitingReport[] = [];"]], T],
  ["ب", "Baraa is not told which waiting orders were quoted", [[PR,
    "    if (quoted.length) {\n      await sendOwnerAlert(env, `📨", "    if (false) {\n      await sendOwnerAlert(env, `📨"]], T],
  ["ب", "the waiting order's quotation has no buttons", [[OF,
    "        const d = gatewayDecision(await send(buttonsContent(body, quotationButtons(o.id))));", "        const d = gatewayDecision(await send(textContent(body)));"]], T],
  ["ب", "the waiting order's quotation is held past its list's end", [[OF,
    "content, expiresAt: list!.validUntilMs, ctx });", "content, ctx });"]], T],
  ["ب", "a waiting order without a delivery place is asked for it instead of quoted", [[OF,
    "      const q = await quoteOrder(penv, { orderId: o.id, partnerId: customerId, now, askLocation: false });", "      const q = await quoteOrder(penv, { orderId: o.id, partnerId: customerId, now });"]], T],
  ["ب", "a waiting order whose item has no price is told nothing", [[OF,
    "        await send(textContent(q.text));\n", ""]], T],
  // ---------------------------------------------------------------- ب 20:00 and 21:00
  ["ب", "20:00 reminds a quotation whose list has expired", [[TM,
    "      if (o.awaitingPrices || (o.priceDate && !(await listOfDayIfValid(env, o.priceDate)))) {", "      if (o.awaitingPrices) {"]], T],
  ["ب", "20:00 reminds an order that waits for prices", [[TM,
    "      if (o.awaitingPrices || (o.priceDate && !(await listOfDayIfValid(env, o.priceDate)))) {", "      if (o.priceDate && !(await listOfDayIfValid(env, o.priceDate))) {"]], T],
  ["ب", "21:00 cancels the order that waits for prices", [[OD,
    "  const pending = (await getUnconfirmedOrders(env)).filter((o) => !o.awaitingPrices);", "  const pending = await getUnconfirmedOrders(env);"], [OD,
    "[\"x_state\", \"in\", [\"waiting_confirmation\", \"draft\"]], [\"x_awaiting_prices\", \"!=\", true]],", "[\"x_state\", \"in\", [\"waiting_confirmation\", \"draft\"]]],"]], T],
  // ---------------------------------------------------------------- ب «تأكيد الطلب»
  ["ب", "«تأكيد» confirms a quotation whose list has expired", [[RT,
    "  if (o.priceDate) confirmable = sameDay && !!(await orderListStillValid(env, o.priceDate, now));", "  if (o.priceDate) confirmable = sameDay;"]], T],
  ["ب", "«تأكيد» after 21:00 keeps the delivery day of a quotation of before 21:00", [[RT,
    "  if (o.priceDate) confirmable = sameDay && !!(await orderListStillValid(env, o.priceDate, now));", "  if (o.priceDate) confirmable = !!(await orderListStillValid(env, o.priceDate, now));"]], T],
  ["ب", "«تأكيد» revives a cancelled order", [[RT,
    "  if (o.state === \"cancelled\") {\n    // not revived", "  if (false) {\n    // not revived"]], T],
  ["ب", "an order no quotation priced is confirmed without a price list", [[RT,
    "    if (list) { await freezeOrderPrices(env, orderId, list, now); confirmable = true; }", "    confirmable = true;"]], T],
  ["ب", "the new quotation after an expiry does not say why", [[RT,
    "      : sameDay ? \"أسعار عرض السعر السابق انتهت صلاحيتها (السعر صالح ليوم واحد)، وهذا عرض جديد بأسعار اليوم:\"", "      : sameDay ? \"\""]], T],
  ["ب", "«تعديل» is refused after 21:00 again", [[RT,
    "  if (IN_EXECUTION.has(o.state)) {\n    await sendOwnerAlert(\n      env,\n      `✏️ طلب تعديل أثناء التنفيذ", "  if (IN_EXECUTION.has(o.state) || !(await import(\"./hours\")).isWithinOrderingWindow()) {\n    await sendOwnerAlert(\n      env,\n      `✏️ طلب تعديل أثناء التنفيذ"]], T],
  // ---------------------------------------------------------------- ب the delivery day and the note
  ["ب", "the confirmation does not name the delivery day", [[RT,
    "طلبك رقم #${orderId} يوصلك صباح ${deliveryLabel(orderDay)} إن شاء الله 🌿${tail}`", "طلبك رقم #${orderId} في السكة، يوصلك في وقته 🌿${tail}`"]], T],
  ["ب", "after 21:00 the quotation speaks of the delivery as before 21:00", [[OF,
    "  return orderDay === riyadhDateKey(now)\n    ? `🚚 التوصيل", "  return true\n    ? `🚚 التوصيل"]], T],
  ["ب", "the quotation's delivery line names no day", [[OF,
    "    ? `🚚 التوصيل: صباح ${deliveryLabel(orderDay)}، لو تأكد قبل الساعة 9:00 مساءً.`\n    : `🚚 التوصيل: صباح ${deliveryLabel(orderDay)} (بعد بكرة)", "    ? `🚚 التوصيل: صباح بكرة، لو تأكد قبل الساعة 9:00 مساءً.`\n    : `🚚 التوصيل: (بعد بكرة)"]], T],
  ["ب", "the fixed note is not Baraa's wording", [[OF,
    "export const PRICE_NOTE = \"السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.\";", "export const PRICE_NOTE = \"الأسعار قد تتغير.\";"]], T],
  ["ب", "the quotation («خلاص») goes out without the note", [[RT,
    "      ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE].filter(Boolean),\n      `اختر:`,\n    ].join(\"\\n\"),", "      ...[q.locationLine, q.deliveryLine, vatNote(now)].filter(Boolean),\n      `اختر:`,\n    ].join(\"\\n\"),"]], T],
  ["ب", "the waiting order's quotation goes out without the note", [[OF,
    "          ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE, \"راجع الأصناف واختر:\"].filter(Boolean),", "          ...[q.locationLine, q.deliveryLine, vatNote(now), \"راجع الأصناف واختر:\"].filter(Boolean),"]], T],
  ["ب", "the day's prices message without the note", [[PR,
    "  const footer = `${PRICE_NOTE}\\nاطلب من هنا في أي وقت", "  const footer = `اطلب من هنا في أي وقت"]], T],
  ["ب", "the day's prices message still closes ordering at 21:00", [[PR,
    "اطلب من هنا في أي وقت: الطلب المؤكد قبل الساعة ${cutoffLabel(ORDERING_HOURS_CLOSE)} يوصلك صباح بكرة 🌿`;", "الأسعار لطلبات اليوم. اطلب من هنا قبل الساعة ${cutoffLabel(ORDERING_HOURS_CLOSE)} 🌿`;"]], T],
  ["ب", "the quotation's PDF footer without the note", [[QU,
    "  `${PRICE_NOTE} العرض ساري حتى الساعة ٦:٠٠ صباحاً من اليوم التالي لأسعاره`;", "  `العرض ساري حتى الساعة ٦:٠٠ صباحاً من اليوم التالي لأسعاره`;"]], T],
  ["ب", "the quotation's PDF still says «حتى ٩:٠٠ مساءً»", [[QU,
    "  `${PRICE_NOTE} العرض ساري حتى الساعة ٦:٠٠ صباحاً من اليوم التالي لأسعاره`;", "  `${PRICE_NOTE} الأسعار سارية حتى ٩:٠٠ مساءً من تاريخ الإصدار`;"]], T],
  // ---------------------------------------------------------------- ج the delivery on the spot
  ["ج", "an order without a stop is not written delivered", [[OD,
    "    await call(env, \"x_daily_order\", \"write\", {\n      ids: [orderId],\n      vals: { x_state: \"delivered\", x_delivered_at: nowOdoo(), x_immediate_delivery: true },\n    });\n", ""]], T],
  ["ج", "the delivery on the spot is not marked «تسليم فوري»", [[OD,
    "      vals: { x_state: \"delivered\", x_delivered_at: nowOdoo(), x_immediate_delivery: true },", "      vals: { x_state: \"delivered\", x_delivered_at: nowOdoo() },"]], T],
  ["ج", "the moment of the delivery on the spot is not recorded", [[OD,
    "      vals: { x_state: \"delivered\", x_delivered_at: nowOdoo(), x_immediate_delivery: true },", "      vals: { x_state: \"delivered\", x_immediate_delivery: true },"]], T],
  ["ج", "a delivery of a route's stop is marked «تسليم فوري»", [[OD,
    "  await call(env, \"x_daily_order\", \"write\", {\n    ids: [orderId],\n    vals: { x_state: \"delivered\", x_delivered_at: nowOdoo() },\n  });", "  await call(env, \"x_daily_order\", \"write\", {\n    ids: [orderId],\n    vals: { x_state: \"delivered\", x_delivered_at: nowOdoo(), x_immediate_delivery: true },\n  });"]], T],
  ["ج", "an order the customer has not confirmed is delivered", [[RT,
    "  if (!DELIVERABLE_STATES.has(brief.state)) {", "  if (false) {"]], T],
  ["ج", "only an order on a route may be delivered", [[OF,
    "export const DELIVERABLE_STATES: ReadonlySet<string> = new Set([\"confirmed\", \"in_purchase\", \"in_delivery\"]);", "export const DELIVERABLE_STATES: ReadonlySet<string> = new Set([\"in_delivery\"]);"]], T],
  ["ج", "a refused delivery keeps its lock (the tap after the confirmation is «تم مسبقاً»)", [[RT,
    "      if (r.delivered) await finishButton(env, claim);\n      else await releaseButton(env, claim);", "      await finishButton(env, claim);"]], T],
  ["ج", "the delivered order stays on a purchase list that is not bought yet", [[RT,
    "      const lists = await removeOrderFromOpenPurchaseLists(env, orderId);", "      const lists: number[] = [];"]], T],
  ["ج", "a list already bought is changed too", [[OD,
    "    domain: [[\"x_status\", \"in\", [\"draft\", \"sent\"]], [\"x_utak_simulation\", \"!=\", true]],\n    fields: [\"id\", \"x_aggregated_items\"],", "    domain: [[\"x_utak_simulation\", \"!=\", true]],\n    fields: [\"id\", \"x_aggregated_items\"],"]], T],
  ["ج", "the whole item leaves the list, the other orders' quantity with it", [[OD,
    "      if (left > 0 && orders.length) next.push({ ...it, total_quantity: left, order_ids: orders });\n", ""]], T],
  ["ج", "the order's number leaves the list, its quantity stays", [[OD,
    "next.push({ ...it, total_quantity: left, order_ids: orders });", "next.push({ ...it, order_ids: orders });"]], T],
  ["ج", "Baraa is not told that a list changed", [[RT,
    "      if (lists.length) {\n        await sendOwnerAlert(env, `🛒", "      if (false) {\n        await sendOwnerAlert(env, `🛒"]], T],
  ["ج", "the invoice is not issued at the delivery on the spot", [[RT,
    // § 55 ب — the call carries the delivery form's options (invoiceOpts): the pattern follows the line
    "  // v5: create invoice + dispatch to customer & collector\n  try {\n    const { createAndDispatchInvoiceForOrder } = await import(\"./invoice\");\n    await createAndDispatchInvoiceForOrder(env, orderId, invoiceOpts);", "  // v5: create invoice + dispatch to customer & collector\n  try {\n    const { createAndDispatchInvoiceForOrder } = await import(\"./invoice\");\n    if (!immediate) await createAndDispatchInvoiceForOrder(env, orderId, invoiceOpts);"]], T],
  ["ج", "the confirmed order does not reach Baraa", [[RT,
    "  await notifyOwnerConfirmed(env, orderId);\n", ""]], T],
  // § 55 ب — the button is «📦 سلّم وحصّل» (the delivery and collection form) where it was «تم التسليم ✅»
  ["ج", "Baraa's message of a confirmed order has no delivery button", [[OF,
    "      content: buttonsContent(text, [deliveryButton(orderId)]),", "      content: textContent(text),"]], T],
  ["ج", "the owner guard refuses the confirmed order's message", [[GW,
    "\"owner_price_review\", \"owner_order_confirmed\", \"price_review_test\"]);", "\"owner_price_review\", \"price_review_test\"]);"]], T],
  ["ج", "Baraa's tap on «تم التسليم» is ignored (as every other button of his)", [[IX,
    "        } else if (((msg.type === \"interactive\" || msg.type === \"button\") && /^delivered_\\d+$/.test(msg.buttonId ?? \"\"))\n          || (msg.type === \"text\" && deliverCommandOrderId(msg.text) !== null)) {", "        } else if (false) {"]], T],
  ["ج", "the driver's «تسليم N» is an ordinary message", [[IX,
    "      } else if (msg.type === \"text\" && deliverCommandOrderId(msg.text) !== null) {", "      } else if (false) {"]], T],
  ["ج", "«تسليم 12 و 13» delivers order 12", [[OF,
    "(?:رقم\\s*)?#?\\s*(\\d{1,9})$/.exec(t);", "(?:رقم\\s*)?#?\\s*(\\d{1,9})/.exec(t);"]], T],
  ["ج", "Arabic-Indic digits are not read in «تسليم ١٢»", [[OF,
    "    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))\n    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));\n  const m = /^(?:تم", "    ;\n  const m = /^(?:تم"]], T],
  // ---------------------------------------------------------------- د the sources' role
  ["د", "a role changes nothing: «شراء» beside a «سوق» source's number makes a purchase offer", [[PS,
    "    const kind = fixed ?? (k === \"ambiguous\" ? c.label : k === \"other\" ? OTHER[DEFAULT_KIND[role]] : DEFAULT_KIND[role]);", "    const kind = k === \"ambiguous\" ? c.label : k === \"other\" ? OTHER[DEFAULT_KIND[reader]] : DEFAULT_KIND[reader];"]], TS],
  ["د", "of two numbers of a source with a role, the extractor's label decides (not the keyword)", [[PS,
    "    const pick = (fixed ? of.find((p) => p.plain) : undefined) ?? of.find((p) => p.label === kind) ?? of[0];", "    const pick = of.find((p) => p.label === kind) ?? of[0];"]], TS],
  ["د", "a «شراء» source's «سوق» number is read with the observer's keyword", [[PS,
    "  const reader: SourceRole = fixed === \"purchase\" ? \"supplier\" : fixed === \"market\" ? \"observer\" : role;", "  const reader: SourceRole = fixed ? \"observer\" : role;"]], TS],
  ["د", "the employee's role is not read", [[PS,
    "    role: asRole(e.x_price_role),", "    role: null,"]], TS],
  ["د", "the partner's role is not read", [[PS,
    "vatRegistered: p.x_vat_registered === true, role: asRole(p.x_price_role) }));", "vatRegistered: p.x_vat_registered === true, role: null }));"]], TS],
  ["د", "an employee's role is looked for on his Work Contact's card first", [[PS,
    "  return sources.employees.find((e) => e.partnerId === partnerId)?.role ?? sources.partners.find((p) => p.partnerId === partnerId)?.role ?? null;", "  return sources.partners.find((p) => p.partnerId === partnerId)?.role ?? null;"]], TS],
  ["د", "«أقل عرض» counts a «سوق» source's purchase number", [[EN,
    "    if (Number(r.x_purchase_price) > 0 && !marketOnly.has(pid)) out.push(", "    if (Number(r.x_purchase_price) > 0) out.push("]], TS],
  ["د", "a «سوق» supplier's own row counts as a purchase offer", [[EN,
    "    if (marketOnly.has(pid)) continue;\n", ""]], TS],
  ["د", "a source without a role is treated as «سوق» (its «شراء» number dropped)", [[PS,
    "filter((x) => x.partnerId && sourceRole(sources, x.partnerId) === \"market\")", "filter((x) => x.partnerId && sourceRole(sources, x.partnerId) !== \"purchase\")"]], TS],
  ["د", "Omar's reply is read without his role", [[PS,
    "  const check = checkOfferItems(items, products, packagings, text, \"observer\", src.role ?? null);", "  const check = checkOfferItems(items, products, packagings, text, \"observer\");"]], TS],
  ["د", "the reply's hook does not pass the source's role", [[PS,
    "name: who.name, digits, role: sourceRole(src, who.partnerId), outside: !emp }, text, messageId, nowMs);", "name: who.name, digits, outside: !emp }, text, messageId, nowMs);"]], TS],
  ["د", "the supplier's reply is read without his role", [[SU,
    "messageText, \"supplier\", await partnerPriceRole(env, supplier.id));", "messageText, \"supplier\");"]], TS],
  ["د", "a «سوق» source is still told to write «شراء» beside a purchase price", [[PS,
    "  if (role === \"market\") return `صباح الخير ${first} 🌿 أرسل أسعار السوق اليوم لو سمحت: اسم الصنف كاملاً والتعبئة وسعر السوق لكل صنف. ${MARKET_VAT_LINE}`;\n", ""]], TS],
  ["د", "the 02:30 ask is sent without the source's role", [[PS,
    "    const text = marketAskText(t.name, t.role);", "    const text = marketAskText(t.name);"]], TS],
  ["د", "Odoo: Omar's role is written «شراء»", [[UI,
    "  { model: \"hr.employee\", id: 4, name: \"عمر المجهلي\", role: \"market\" },", "  { model: \"hr.employee\", id: 4, name: \"عمر المجهلي\", role: \"purchase\" },"]], TS],
  ["د", "Odoo: Ahmed's role is not written", [[UI,
    "  { model: \"res.partner\", id: 30, name: \"أحمد حسان\", role: \"purchase\" },\n", ""]], TS],
  // ---------------------------------------------------------------- هـ the item's full name
  ["هـ", "the table's name is a char field (cut by its column)", [[UI,
    "  { name: \"x_item_show\", ttype: \"text\",", "  { name: \"x_item_show\", ttype: \"char\","]], TU],
  ["هـ", "the table shows the code column by default", [[UI,
    "export const LIST_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n        <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>`;", "export const LIST_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n        <field name=\"x_item_code\" string=\"الرمز\" optional=\"show\"/>`;"]], TU],
  ["هـ", "the table puts the code before the name", [[UI,
    "export const LIST_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n        <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>`;", "export const LIST_ITEM = `<field name=\"x_item_code\" string=\"الرمز\"/>\n        <field name=\"x_item_show\" string=\"الصنف\"/>`;"]], TU],
  ["هـ", "the table keeps the «[UTAK-…] name» column beside the name", [[UI,
    "export const LIST_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n        <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>`;", "export const LIST_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n        <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>\n        <field name=\"x_product_tmpl_id\" string=\"المرجع\" readonly=\"1\"/>`;"]], TU],
  ["هـ", "the card keeps the cut name (x_name)", [[UI,
    "                <field name=\"x_item_show\" class=\"fw-bold fs-5\"/>\n", "                <field name=\"x_name\" class=\"fw-bold fs-5\"/>\n"]], TU],
  ["هـ", "the card has no code under the name", [[UI,
    "                <div class=\"small text-muted\" t-if=\"record.x_item_code.raw_value\"><field name=\"x_item_code\"/></div>\n", ""]], TU],
  ["هـ", "the card's code is as large as the name", [[UI,
    "                <div class=\"small text-muted\" t-if=\"record.x_item_code.raw_value\"><field name=\"x_item_code\"/></div>\n", "                <div class=\"fw-bold fs-5\" t-if=\"record.x_item_code.raw_value\"><field name=\"x_item_code\"/></div>\n"]], TU],
  ["هـ", "the name carries the product's reference", [[UI,
    "    name = (record.x_product_tmpl_id.name or '').strip()", "    name = (record.x_product_tmpl_id.display_name or record.x_product_tmpl_id.name or '').strip()\n    name = '[UTAK] ' + name if name else name"]], TU],
  ["هـ", "the name is cut at 24 characters", [[UI,
    "    record['x_item_show'] = ' — '.join([p for p in (name, pack) if p]) or '—'", "    record['x_item_show'] = ' — '.join([p[:24] for p in (name, pack) if p]) or '—'"]], TU],
  ["هـ", "an item without a name shows nothing (not «—»)", [[UI,
    "    record['x_item_show'] = ' — '.join([p for p in (name, pack) if p]) or '—'", "    record['x_item_show'] = ' — '.join([p for p in (name, pack) if p])"]], TU],
  ["هـ", "the code is a copy kept on the line, not the product's own reference", [[UI,
    "related: \"x_product_tmpl_id.default_code\", store: false, readonly: true },", "store: true, readonly: false },"]], TU],
  ["هـ", "«📥 عروض المصادر»: the source stays before the item in the purchase tab", [[UI,
    "export const PURCHASE_ITEM = `<field name=\"x_item_show\" string=\"الصنف\"/>\n          <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>\n          <field name=\"x_supplier_id\" string=\"المصدر\"/>`;", "export const PURCHASE_ITEM = `<field name=\"x_supplier_id\" string=\"المصدر\"/>\n          <field name=\"x_item_show\" string=\"الصنف\"/>\n          <field name=\"x_item_code\" string=\"الرمز\" optional=\"hide\"/>`;"]], TU],
  ["هـ", "«📥 عروض المصادر»: the market tab is left as § 48 wrote it", [[UI,
    "    out = out.replace(all(PURCHASE_ITEM_48), PURCHASE_ITEM).replace(all(MARKET_ITEM_48), MARKET_ITEM);", "    out = out.replace(all(PURCHASE_ITEM_48), PURCHASE_ITEM);"]], TU],
  ["هـ", "the days' profit list keeps «[UTAK-…] name»", [[UI,
    "export const boardListArch = (arch) => swap(arch, BOARD_ITEM_46, BOARD_ITEM,", "export const boardListArch = (arch) => swap(arch, BOARD_ITEM_46, (m) => m,"]], TU],
  ["هـ", "a link to a roles list sits inside the light-blue note (3.93:1)", [[UI,
    "<div>${ROLES_RULE}</div></div>\n      <button name=\"${a.sourcePartners}\" type=\"action\" string=\"تعديل دور المورد\" class=\"btn btn-link px-0 me-3\"/>", "<div>${ROLES_RULE}</div><button name=\"${a.sourcePartners}\" type=\"action\" string=\"تعديل دور المورد\" class=\"btn btn-link px-0 me-3\"/></div>\n      "]], TU],
  ["هـ", "a roles block of the first shape is kept and a second one added", [[UI,
    "const rolesNow = (arch, a) => (ROLES_FIRST.test(arch) ? arch.replace(ROLES_FIRST, () => rolesBlock(a)) : arch);", "const rolesNow = (arch, a) => arch.replace(/name=\"utak_source_roles\"/, 'name=\"utak_source_roles_old\"');"]], TU],
  ["هـ", "the settings screen gets no roles block", [[UI,
    "export const settingsArch = (arch, a) => swap(rolesNow(arch, a), SETTINGS_COSTS_48,", "export const settingsArch = (arch, a) => arch || swap(rolesNow(arch, a), SETTINGS_COSTS_48,"]], TU],
  ["هـ", "the role is not edited in the row of the sources' lists", [[UI,
    "<list string=\"${title}\" editable=\"bottom\" create=\"0\" delete=\"0\" open_form_view=\"True\">", "<list string=\"${title}\" create=\"0\" delete=\"0\">"]], TU],
  ["هـ", "the role shows on every partner's card, a source or not", [[UI,
    "    <field name=\"x_price_role\" invisible=\"not x_price_source\"/>", "    <field name=\"x_price_role\"/>"]], TU],
  ["هـ", "a new line's stored name is cut at 24 characters again", [[PR,
    "x_name: `${fullName(p.productName)} — ${p.packagingName}`, x_sequence: ++seq,", "x_name: `${shortName(p.productName)} — ${p.packagingName}`, x_sequence: ++seq,"]], TU],
  ["هـ", "the line's stored name keeps the «[UTAK-…]» reference", [[PR,
    "  return String(name ?? \"\").replace(/^\\[[^\\]]*\\]\\s*/, \"\").trim();", "  return String(name ?? \"\").trim();"]], TU],
  // ---------------------------------------------------------------- the guide
  ["ب", "the guide still says the minimum is 150", [[DOC,
    "**بلا حد أدنى** (§ 49). لا رسالة تُرفض", "**أقل طلب 150 ريال** قبل الخصم. لا رسالة تُرفض"]], T],
  ["ب", "the guide has no steps for the week of selling from the car", [[DOC,
    "### أسبوع البيع من السيارة: من مسح QR حتى الفاتورة", "### الأسبوع الأول"]], T],
  ["ب", "the guide does not explain the role of a source", [[DOC,
    "### دور المصدر («دور الأسعار»)", "### المصادر"], [DOC,
    "- على بطاقة كل مصدر أسعار (المورد أو الموظف) حقل **«دور الأسعار»**: «شراء» أو «سوق». **أحمد حسان = شراء، وعمر = سوق.**\n", ""]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s49-20261001-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
