// Mutation check for § 66 (2026-10-08) — «العميل وافق» → an order that is bought, delivered and invoiced:
//   أ  the acceptance (src/special-accept.ts: the confirmed quantities, the dates, «✅ العميل وافق», a customer's «موافق»)
//   ب  the conversion (the guards of «📦 حوّل لطلب», the order and its locked lines, the confirmation, the sale order)
//   ج  the purchase side (the 21:15 list, the receipt, the dues and the bills, the large order)
//   د  the delivery, the invoice and the day's profit
//   هـ the screens (scripts/lib/s66-odoo.mjs), the hook's two ops, the tick
//   و  the suppliers' check-in template again (v2)
// Each mutation disables ONE guard, runs the test file named with it, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ and scripts/lib/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s66-20261008-mutations.mjs [أ ب ج د هـ و]     (no argument: every part)
//
// Out: scripts/artifacts/s66-20261008-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TA = "tests/s66-accept.test.mts", TO = "tests/s66-order.test.mts", TS = "tests/s66-scenario.test.mts", TU = "tests/s65-outreach.test.mts", TQ = "tests/s62-quote.test.mts", TL = "tests/s62d-layout.test.mts";
const ACC = "src/special-accept.ts", SQ = "src/special-quote.ts", QT = "src/special-quotation.ts", MATH = "src/special-quote-math.ts", IDX = "src/index.ts";
const OD = "src/odoo.ts", OF = "src/order-flow.ts", TEAM = "src/team.ts", RF = "src/receipt-form.ts", SP = "src/supplier-pay.ts", PA = "src/purchase-accounting.ts";
const INV = "src/invoice.ts", SA = "src/sale-accounting.ts", INS = "src/day-insight.ts", SUM = "src/owner-summary.ts", DN = "src/delivery-note.ts", CF = "src/complaint-form.ts", OUT = "src/supplier-outreach.ts";
const LIB = "scripts/lib/s66-odoo.mjs", LIBT = "scripts/lib/s66-templates.mjs";
const NOTICE_DOMAIN = "domain: [[\"x_partner_id\", \"=\", partner.id], [\"x_state\", \"=\", \"quoted\"], [SIM_FIELD, \"!=\", true]],";
const NOTICE_SKIP = "      if (isExpired(String(r.x_valid_until || \"\"), now) || r.x_accepted_at) continue;";
const AFTER_CONFIRM = "    if (after?.state !== \"sale\" || (after.picking_ids ?? []).length) {";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ — the acceptance
  ["أ", "nothing typed reads as zero", [[ACC, "  if (!t) return null;\n", "  if (!t) return 0;\n"]], TA],
  ["أ", "any text is a quantity", [[ACC, "  if (!/^\\d{1,7}(\\.\\d{1,3})?$/.test(t)) return \"invalid\";\n", ""]], TA],
  ["أ", "a unit-price line with nothing typed takes its 1", [[ACC, "    if (typed === null && unit && !(l.qty > 1)) { plan.missing.push(name); continue; }\n", ""]], TA],
  ["أ", "a unit-price line that asked for more than one is missing too", [[ACC, "if (typed === null && unit && !(l.qty > 1)) {", "if (typed === null && unit) {"]], TA],
  ["أ", "a line confirmed 0 stays in the order", [[ACC, "    if (qty > 0) plan.lines.push({ line: l, qty });\n    else plan.out.push(name);\n", "    plan.lines.push({ line: l, qty });\n"]], TA],
  ["أ", "the confirmed total at the prices before VAT", [[ACC, "round2(lines.reduce((s, x) => s + round2(x.qty * x.line.finalPrice), 0));", "round2(lines.reduce((s, x) => s + round2(x.qty * x.line.finalNet), 0));"]], TA],
  ["أ", "a request with no «صالح حتى» is expired", [[ACC, "  return Number.isFinite(ms) && ms < now;", "  return !Number.isFinite(ms) || ms < now;"]], TA],
  ["أ", "the earliest delivery ignores the 21:00 cutoff", [[ACC, "deliveryDayOf(nextOrderingDate(new Date(now)));", "deliveryDayOf(riyadhDateKey(new Date(now)));"]], TA],
  ["أ", "«جدول أيام العمل» is not read", [[ACC, "    return nextWorkingDay(from, (d) => isWorkingDay(s, d));", "    return from;"]], TA],
  ["أ", "the next working day skips the day itself", [[ACC, "for (let i = 0, d = from; i < 14; i++, d = addDaysYmd(d, 1)) if (works(d)) return d;", "for (let i = 0, d = addDaysYmd(from, 1); i < 14; i++, d = addDaysYmd(d, 1)) if (works(d)) return d;"]], TA],
  ["أ", "a refusal reads as an acceptance", [[ACC, "  return ACCEPT_RE.test(t) && !REFUSE_RE.test(t);", "  return ACCEPT_RE.test(t);"]], TA],
  ["أ", "a long text is searched for an acceptance", [[ACC, "  if (!t || t.length > 400) return false;", "  if (!t) return false;"], [ACC, "|ok|okay|approved|", "|ok|okay|x+|approved|"]], TA],
  ["أ", "an expired quotation alerts", [[ACC, NOTICE_SKIP, "      if (r.x_accepted_at) continue;"]], TA],
  ["أ", "a quotation Baraa already accepted alerts", [[ACC, NOTICE_SKIP, "      if (isExpired(String(r.x_valid_until || \"\"), now)) continue;"]], TA],
  ["أ", "a simulation's quotation alerts", [[ACC, NOTICE_DOMAIN, "domain: [[\"x_partner_id\", \"=\", partner.id], [\"x_state\", \"=\", \"quoted\"]],"]], TA],
  ["أ", "a quotation that is not issued alerts", [[ACC, NOTICE_DOMAIN, "domain: [[\"x_partner_id\", \"=\", partner.id], [SIM_FIELD, \"!=\", true]],"]], TA],
  ["أ", "another customer's quotation alerts", [[ACC, NOTICE_DOMAIN, "domain: [[\"x_state\", \"=\", \"quoted\"], [SIM_FIELD, \"!=\", true]],"]], TA],
  ["أ", "every «موافق» alerts again", [[ACC, "      if (!claim.claimed) { out.push({ quoteId: id, number, action: \"alerted_before\" }); continue; }\n", ""]], TA],
  ["أ", "the alert carries no link", [[ACC, "  [`✅ ${customer || \"العميل\"} يبدو موافقاً على ${number}`, url, `لو وافق:", "  [`✅ ${customer || \"العميل\"} يبدو موافقاً على ${number}`, `لو وافق:"]], TA],
  ["أ", "the link is the list's, not the request's", [[ACC, "  return actionId ? `${base}/odoo/action-${actionId}/${quoteId}` : `${base}/odoo`;", "  return `${base}/odoo`;"]], TA],
  ["أ", "a customer's message is not read for an acceptance", [[IDX, "        if (looksLikeAcceptance(msg.text)) await noticeAcceptance(env, { id: partner.id, name: partner.name });\n", ""]], TA],
  ["أ", "every message of a customer reads the requests", [[IDX, "        if (looksLikeAcceptance(msg.text)) await noticeAcceptance(", "        if (msg.text) await noticeAcceptance("]], TA],
  ["أ", "a quotation that is not issued is accepted", [[ACC, "  if (q.state === \"accepted\") return refuse(`الطلب مقبول وتحوّل إلى الطلب #${q.accept.orderId}`);\n  if (q.state !== \"quoted\") return refuse(\"العرض لم يصدر بعد: اضغط «📄 أصدر عرض السعر» أولاً\");\n", "  if (q.state === \"accepted\") return refuse(`الطلب مقبول وتحوّل إلى الطلب #${q.accept.orderId}`);\n"]], TA],
  ["أ", "a closed request is accepted", [[ACC, "\n  if (q.state === \"closed\") return refuse(\"الطلب مغلق\");\n", "\n"]], TA],
  ["أ", "the time of the acceptance moves at every press", [[ACC, "  if (!q.accept.at) vals.x_accepted_at = nowOdoo(now);", "  vals.x_accepted_at = nowOdoo(now);"]], TA],
  ["أ", "the delivery date Baraa typed is replaced", [[ACC, "  const deliveryDate = q.accept.deliveryDate || (await defaultDeliveryDay(env, now));\n  if (!q.accept.deliveryDate) vals.x_delivery_date = deliveryDate;", "  const deliveryDate = await defaultDeliveryDay(env, now);\n  vals.x_delivery_date = deliveryDate;"]], TA],
  ["أ", "the terms Baraa chose are replaced", [[ACC, "  if (!q.accept.payTerms && q.partnerId) {", "  if (q.partnerId) {"]], TA],
  ["أ", "the customer's terms are not read", [[ACC, "      if (terms) vals.x_pay_terms = terms;\n", ""]], TA],
  ["أ", "a unit-price line confirms its 1 by itself", [[ACC, "(!l.confirmedQty && l.qty > 0 && (l.qty > 1 || !unit) ?", "(!l.confirmedQty && l.qty > 0 ?"]], TA],
  ["أ", "a quotation by quantities confirms nothing by itself", [[ACC, "(!l.confirmedQty && l.qty > 0 && (l.qty > 1 || !unit) ?", "(!l.confirmedQty && l.qty > 0 && unit ?"]], TA],
  ["أ", "a quantity Baraa typed is replaced", [[ACC, "(!l.confirmedQty && l.qty > 0 && (l.qty > 1 || !unit) ?", "(l.qty > 0 && (l.qty > 1 || !unit) ?"]], TA],
  ["أ", "«إجمالي الطلب المؤكد» is not written with the acceptance", [[ACC, "  if (Math.abs(total - q.accept.total) > 0.004) vals.x_confirmed_total = total;\n", ""]], TA],
  ["أ", "the expired quotation is not warned of", [[ACC, "    isExpired(q.validUntil, now) ? `⚠️ انتهت صلاحية العرض (${validUntilText(q.validUntil)}): أشّر «${EXPIRED_BOX}» ليتحوّل` : \"\",\n", ""]], TA],
  ["أ", "the missing quantities are not counted for Baraa", [[ACC, "    plan.missing.length ? `اكتب «الكمية المؤكدة» لكل سطر (0 = خارج الطلب): ${plan.missing.length} بلا كمية` : \"\",\n", ""]], TA],

  // ---------------------------------------------------------------- ب — the conversion
  ["ب", "no lock: a second press runs beside the first", [[ACC, "  if (!lock.claimed) return { action: \"busy\", detail: \"pressed a moment ago\" };\n", ""]], TA],
  ["ب", "a closed request converts", [[ACC, "    if (q.state === \"closed\") return refuse(\"الطلب مغلق\");\n    // never twice", "    // never twice"]], TA],
  ["ب", "«مقبول» with its order cancelled converts again", [[ACC, "    if (q.state === \"accepted\") return refuse(alreadyConvertedText(q.accept.orderId));\n", ""], [ACC, "    if (q.state !== \"quoted\") return refuse(\"العرض لم يصدر بعد: اضغط «📄 أصدر عرض السعر» أولاً\");\n    if (!q.accept.at)", "    if (!q.accept.at)"]], TA],
  ["ب", "a request that points at a standing order converts again", [[ACC, "    if (q.accept.orderId && (await liveOrder(env, q.accept.orderId))) return refuse(alreadyConvertedText(q.accept.orderId));\n", ""]], TA],
  ["ب", "a cancelled order still blocks a new conversion", [[ACC, "    return !!o && o.x_state !== \"cancelled\";", "    return !!o;"]], TA],
  ["ب", "a quotation that is not issued converts", [[ACC, "    if (q.state !== \"quoted\") return refuse(\"العرض لم يصدر بعد: اضغط «📄 أصدر عرض السعر» أولاً\");\n    if (!q.accept.at)", "    if (!q.accept.at)"]], TA],
  ["ب", "a quotation Baraa did not accept converts", [[ACC, "    if (!q.accept.at) return refuse(`اضغط «${APPROVE_BUTTON}» أولاً`);\n", ""]], TA],
  ["ب", "an expired quotation converts", [[ACC, "    if (expired && !q.accept.expiredOk) return refuse(expiredText(q.validUntil));\n", ""]], TA],
  ["ب", "Baraa's tick does not open an expired quotation", [[ACC, "    if (expired && !q.accept.expiredOk) return refuse(", "    if (expired) return refuse("]], TA],
  ["ب", "the tick is not recorded on the order", [[ACC, "      expired ? expiredRecord(q.validUntil, now) : \"\",\n", ""]], TA],
  ["ب", "a request with no delivery date converts", [[ACC, "    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(q.accept.deliveryDate)) return refuse(\"لا «تاريخ التسليم» على الطلب\");\n", ""]], TA],
  ["ب", "a delivery date whose list has gone converts", [[ACC, "    if (q.accept.deliveryDate < earliest) return refuse(tooEarlyText(q.accept.deliveryDate, earliest));\n", ""]], TA],
  ["ب", "a quantity that cannot be read converts", [[ACC, "    if (plan.invalid.length) return refuse(`«الكمية المؤكدة» لا تُقرأ: ${plan.invalid.join(\"، \")}`);\n", ""]], TA],
  ["ب", "a unit-price line with no quantity converts", [[ACC, "    if (plan.missing.length) return refuse(`عرض أسعار وحدة: اكتب «الكمية المؤكدة» لكل سطر (0 = خارج الطلب). بلا كمية: ${plan.missing.join(\"، \")}`);\n", ""]], TA],
  ["ب", "an order of nothing is made", [[ACC, "    if (!plan.lines.length) return refuse(\"كل الكميات المؤكدة صفر: لا شيء يتحوّل لطلب\");\n", ""]], TA],
  ["ب", "an item with no packaging is put on a line", [[ACC, "    if (noPack.length) return refuse(`لا عبوة في Odoo للصنف (أضفها من «📦 الأصناف»): ${[...new Set(noPack)].join(\"، \")}`);\n", ""]], TA],
  ["ب", "a refusal says nothing on «آخر نتيجة»", [[ACC, "      await writeResult(env, quoteId, `🚫 لم يتحوّل لطلب: ${why}`, now);\n", ""]], TA],
  ["ب", "the order is dated the delivery day itself", [[ACC, "x_order_date: addDaysYmd(deliveryDate, -1),", "x_order_date: deliveryDate,"]], TA],
  ["ب", "the order does not say which request it came from", [[ACC, "        x_special_quote_id: quoteId, x_delivery_notes: notes,", "        x_delivery_notes: notes,"]], TA],
  ["ب", "the order's notes forget the payment terms", [[ACC, "      terms ? `طريقة الدفع: ${terms}` : \"\",\n", ""]], TA],
  ["ب", "the order's notes forget the delivery note", [[ACC, "      q.accept.note ? `ملاحظة التسليم: ${q.accept.note}` : \"\",\n", ""]], TA],
  ["ب", "the lines are not «سعر خاص»", [[ACC, "          x_special_price: true, x_pack_text: l.unit,", "          x_pack_text: l.unit,"]], TA],
  ["ب", "the line's price is the one before VAT", [[ACC, "x_unit_price: l.finalPrice, x_price_unit_manual: l.finalPrice, x_subtotal: round2(qty * l.finalPrice),", "x_unit_price: l.finalNet, x_price_unit_manual: l.finalNet, x_subtotal: round2(qty * l.finalNet),"]], TA],
  ["ب", "the manual price is not written", [[ACC, "x_unit_price: l.finalPrice, x_price_unit_manual: l.finalPrice,", "x_unit_price: l.finalPrice,"]], TA],
  ["ب", "the quotation's «التعبئة» is not kept on the line", [[ACC, "x_special_price: true, x_pack_text: l.unit,", "x_special_price: true,"]], TA],
  ["ب", "the purchase price is not kept on the line", [[ACC, "x_special_purchase: l.purchase > 0 ? l.purchase : false,", "x_special_purchase: false,"]], TA],
  ["ب", "the purchase source is not kept on the line", [[ACC, "          ...(supplier ? { x_special_supplier_id: supplier } : {}),\n", ""]], TA],
  ["ب", "the purchase source is any source, whatever his price", [[ACC, "Object.entries(l.obs.purchase).filter(([, v]) => Math.abs(v.p - l.purchase) < 0.005).sort(", "Object.entries(l.obs.purchase).sort("]], TA],
  ["ب", "the customer's neighbourhood is not put on the order", [[ACC, "      else if (neighborhood) await call<boolean>(env, ORDER_MODEL, \"write\", { ids: [orderId], vals: { x_delivery_neighborhood: neighborhood } });\n", ""]], TA],
  ["ب", "the order stays a draft", [[ACC, "vals: { x_state: \"confirmed\", x_confirmed_at: nowOdoo(now) } });", "vals: { x_confirmed_at: nowOdoo(now) } });"]], TA],
  ["ب", "the request is not «مقبول»", [[ACC, "vals: { x_state: \"accepted\", x_converted_at: nowOdoo(now), x_confirmed_total: total } });", "vals: { x_converted_at: nowOdoo(now), x_confirmed_total: total } });"]], TA],
  ["ب", "the request does not point at its order", [[ACC, "    await call<boolean>(env, QUOTE_MODEL, \"write\", { ids: [quoteId], vals: { x_daily_order_id: orderId } });\n", ""]], TA],
  ["ب", "an order half made stands when the conversion fails", [[ACC, "    if (orderId) await call<boolean>(env, ORDER_MODEL, \"write\", { ids: [orderId], vals: { x_state: \"cancelled\" } }).catch(() => {});\n", ""]], TA],
  ["ب", "a failed conversion keeps the button locked", [[ACC, "    await releaseButton(env, lock);\n    await writeResult(env, quoteId, `🚫 تعذّر التحويل لطلب:", "    await writeResult(env, quoteId, `🚫 تعذّر التحويل لطلب:"]], TA],
  ["ب", "a failed conversion tells Baraa nothing", [[ACC, "    await sendOwnerAlert(env, `🚫 تعذّر تحويل الطلب الخاص #${quoteId} إلى طلب:", "    await Promise.resolve(`🚫 تعذّر تحويل الطلب الخاص #${quoteId} إلى طلب:"]], TA],
  ["ب", "a simulation's order is not flagged", [[ACC, "x_total_amount: total, ...(q.simulation ? { [SIM_FIELD]: true } : {}),", "x_total_amount: total,"]], TA],
  ["ب", "a simulation's lines are not flagged", [[ACC, "x_notes: itemDetail(l.origin, l.size), ...(q.simulation ? { [SIM_FIELD]: true } : {}),", "x_notes: itemDetail(l.origin, l.size),"]], TA],
  ["ب", "a simulation's confirmation goes to the customer", [[ACC, "    if (q.simulation) {\n      to = \"owner_simulation\";", "    if (false) {\n      to = \"owner_simulation\";"]], TA],
  ["ب", "a simulation's quotation is confirmed in Odoo", [[ACC, "    const saleLine = q.simulation ? \"\" : await confirmSaleOrder(env, q, orderId, made, now);", "    const saleLine = await confirmSaleOrder(env, q, orderId, made, now);"]], TA],
  ["ب", "the confirmation is held for a customer outside his window", [[ACC, "          noHold: true, noHoldReason: \"تأكيد الطلب الخاص لا يُحفظ: يصل براء ليرسله بنفسه\",", "          noHoldReason: \"تأكيد الطلب الخاص لا يُحفظ: يصل براء ليرسله بنفسه\","]], TA],
  ["ب", "no template outside the customer's window", [[ACC, "          fallback: [{ kind: \"template\", purpose: T.CUSTOMER_ORDER_CONFIRM, params: confirmTemplateParams(orderId, deliveryDate) }],\n", "          fallback: [],\n"]], TA],
  ["ب", "the template says the delivery day with no «صباح»", [[ACC, "[String(orderId), `صباح ${dayLabel(deliveryDate)}`];", "[String(orderId), dayLabel(deliveryDate)];"]], TA],
  ["ب", "Baraa is not given the text that did not reach the customer", [[ACC, "        to = \"owner_instead\";\n        if (owner) await", "        to = \"owner_instead\";\n        if (false) await"]], TA],
  ["ب", "the confirmation leaves the total out", [[ACC, "  `الإجمالي: ${money(total)} ر.س شامل ضريبة القيمة المضافة`,\n", ""]], TA],
  ["ب", "Baraa's «✅ طلب مؤكد» with «📦 سلّم وحصّل» is not sent", [[ACC, "      await notifyOwnerConfirmed(env, orderId);\n", ""]], TA],
  ["ب", "the sale order is rewritten with ACCOUNTING_SYNC off", [[ACC, "  if (!isAccountingSyncEnabled(env)) return \"\";\n", ""]], TA],
  ["ب", "a quotation that is no draft any more is rewritten", [[ACC, "    if (so.state !== \"draft\" && so.state !== \"sent\") return standard(`${so.name} ليس عرضاً مفتوحاً (${so.state})`);\n", ""]], TA],
  ["ب", "the confirmed lines keep their storable product", [[ACC, "        product_id: service.id, name: saleLineDescription(", "        name: saleLineDescription("]], TA],
  ["ب", "the sale line takes its unit quantity, not the confirmed one", [[ACC, "product_uom_qty: m.qty, price_unit: m.line.finalPrice,", "product_uom_qty: m.line.qty, price_unit: m.line.finalPrice,"]], TA],
  ["ب", "the sale line is not keyed by the order's line", [[ACC, "        tax_ids: [[6, 0, tax ? [tax.id] : []]], sequence: m.orderLineId,", "        tax_ids: [[6, 0, tax ? [tax.id] : []]],"]], TA],
  ["ب", "two lines of one item are told by the item alone", [[ACC, "      let i = free.findIndex((o) => same(o) && String(o.x_pack_text || \"\") === m.line.unit);\n      if (i < 0) i = free.findIndex(same);", "      const i = free.findIndex(same);"]], TA],
  ["ب", "the line outside the order keeps its quantity and price", [[ACC, "{ product_uom_qty: 0, price_unit: 0, sequence: OUT_LINE_SEQUENCE + i }", "{ sequence: OUT_LINE_SEQUENCE + i }"]], TA],
  ["ب", "the line outside the order keeps a key an order line may carry", [[ACC, "{ product_uom_qty: 0, price_unit: 0, sequence: OUT_LINE_SEQUENCE + i }", "{ product_uom_qty: 0, price_unit: 0 }"]], TA],
  ["ب", "the sale order is not confirmed", [[ACC, "    await call<unknown>(env, \"sale.order\", \"action_confirm\", { ids: [so.id] });\n", ""]], TA],
  ["ب", "a confirm that leaves a stock picking is linked", [[ACC, AFTER_CONFIRM, "    if (after?.state !== \"sale\") {"]], TA],
  ["ب", "a sale order Odoo did not confirm is linked", [[ACC, AFTER_CONFIRM, "    if ((after?.picking_ids ?? []).length) {"]], TA],
  ["ب", "the order is not linked to its sale order", [[ACC, "    await call<boolean>(env, ORDER_MODEL, \"write\", { ids: [orderId], vals: { x_sale_order_id: so.id } });\n", ""]], TA],
  ["ب", "the sale order does not name the order", [[ACC, "vals: { client_order_ref: `UTAK-ORDER-${orderId}`, order_line: commands } });", "vals: { order_line: commands } });"]], TA],
  ["ب", "an accepted request issues a new quotation", [[QT, "    if (q.state === \"accepted\") return refuse(`الطلب مقبول وتحوّل إلى الطلب #${q.accept.orderId}`);\n", ""]], TA],
  ["ب", "a recalculation moves «مقبول» back", [[SQ, "  if (q.state === \"accepted\") state = \"accepted\";\n", ""]], TO],
  ["ب", "a line «سعر خاص» is repriced from the day's list", [[OF, "    if (l.special) {\n      lines++;", "    if (false) {\n      lines++;"]], TO],
  ["ب", "a line «سعر خاص» is left out of the order's total", [[OF, "      total = round2(total + round2((l.unit_price ?? 0) * l.quantity));\n      continue;", "      continue;"]], TO],
  ["ب", "the mark «سعر خاص» is not read", [[OD, "      special: l.x_special_price === true,", "      special: false,"]], TO],
  ["ب", "the customer's open order may be the one being made from his quotation", [[OD, "      [\"x_special_quote_id\", \"=\", false],\n", ""]], TO],

  // ---------------------------------------------------------------- ج — the purchase side
  ["ج", "the special lines are merged with the day's", [[OD, "    if (l.special_line) {\n      map.set(purchaseItemKey(l), {", "    if (false) {\n      map.set(purchaseItemKey(l), {"]], TO],
  ["ج", "the item's key forgets the line", [[OD, "  return `${it.product_id}::${it.packaging_id}${it.special_line ? `::sq${it.special_line}` : \"\"}`;", "  return `${it.product_id}::${it.packaging_id}`;"]], TO],
  ["ج", "the target purchase price is not carried to the list", [[OD, "unit_price: l.special_purchase ?? null, price_supplier_id: l.special_supplier_id ?? null,", "unit_price: null, price_supplier_id: l.special_supplier_id ?? null,"]], TO],
  ["ج", "the purchase source is not carried to the list", [[OD, "unit_price: l.special_purchase ?? null, price_supplier_id: l.special_supplier_id ?? null,", "unit_price: l.special_purchase ?? null, price_supplier_id: null,"]], TO],
  ["ج", "the request's name is not carried to the list", [[OD, "        special: l.special ?? \"خاص\", special_line: l.special_line,", "        special_line: l.special_line,"]], TO],
  ["ج", "the item is named by its packaging, not the quotation's «التعبئة»", [[OD, "    ...(pack ? { packaging_name: pack } : {}),\n", ""]], TO],
  ["ج", "a line that is not «سعر خاص» is taken as one", [[OD, "  if (l.x_special_price !== true) return {};\n", ""]], TO],
  ["ج", "a special item takes the day's price of its packaging", [[OD, "    if (it.special_line) return { ...it, unit_price: it.unit_price ?? null, price_supplier_id: it.price_supplier_id ?? null };\n", ""]], TO],
  ["ج", "a corrected price of a special item is lost when the list is made again", [[OD, "  const kept = new Map(keep.map((it) => [purchaseItemKey(it), it]));", "  const kept = new Map(keep.map((it) => [key(it.product_id, it.packaging_id), it]));"]], TO],
  ["ج", "the list does not mark a special line", [[TEAM, "  if (!it.special) return \"\";\n  const price =", "  if (true) return \"\";\n  const price ="]], TO],
  ["ج", "the list marks every line", [[TEAM, "  if (!it.special) return \"\";\n  const price =", "  const price ="]], TO],
  ["ج", "the target purchase price is not shown to the buyer", [[TEAM, "? `، الشراء المستهدف ${formatQty(it.unit_price)}` : \"\";", "? \"\" : \"\";"]], TO],
  ["ج", "the template's line has no mark", [[TEAM, "${formatQty(it.total_quantity)}${specialNote(it)}`),\n    undefined,", "${formatQty(it.total_quantity)}`),\n    undefined,"]], TO],
  ["ج", "the session's message has no mark", [[TEAM, "${formatQty(it.total_quantity)}${specialNote(it)}`)\n    .join(\"\\n\");", "${formatQty(it.total_quantity)}`)\n    .join(\"\\n\");"]], TO],
  ["ج", "the full list sent again has no mark", [[TEAM, "      ...list.items.map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}${specialNote(it)}`),", "      ...list.items.map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}`),"]], TO],
  ["ج", "a special line takes another line's received quantity", [[RF, "`${itemKey(productId, packagingId)}${special ? `:sq${special}` : \"\"}`;", "`${itemKey(productId, packagingId)}`;"]], TO],
  ["ج", "the receipt's slot forgets which line it is", [[RF, "...(it.special_line ? { special: it.special_line } : {}), name: itemName(", "name: itemName("]], TO],
  ["ج", "a special line is an option of a cash purchase", [[RF, "  for (const it of items) if (!it.special_line) out.set(", "  for (const it of items) out.set("]], TO],
  ["ج", "the receipt names a special line the market's", [[RF, "  return (it) => (!it.special_line && market.has(itemKey(", "  return (it) => (market.has(itemKey("]], TO],
  ["ج", "a special line is owed to the cash market", [[SP, "    const won = it.special_line ? undefined : market?.winners.get(winnerKey(it.product_id, it.packaging_id));\n    if (won) {\n      if (!market!.cashSupplierId)", "    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));\n    if (won) {\n      if (!market!.cashSupplierId)"]], TO],
  ["ج", "a special line is owed at the supplier's price of the day", [[SP, "    if (it.special_line) {\n      const price = Number(it.unit_price) > 0 ? Number(it.unit_price) : 0;", "    if (false) {\n      const price = Number(it.unit_price) > 0 ? Number(it.unit_price) : 0;"]], TO],
  ["ج", "a special line with no price is owed nothing, silently", [[SP, "noPrice: !price,\n        special: it.special || \"خاص\",", "noPrice: false,\n        special: it.special || \"خاص\","]], TO],
  ["ج", "a special line with no price is not counted «بلا سعر»", [[SP, "      d.amountH += line.subtotalH;\n      if (line.noPrice) d.unpriced++;\n      by.set(sid, d);\n      continue;", "      d.amountH += line.subtotalH;\n      by.set(sid, d);\n      continue;"]], TO],
  ["ج", "the due's line does not say it is a special request's", [[SP, "              l.special ? `طلب خاص ${l.special} — ${l.packagingName}: سعر الشراء من العرض` : \"\",\n", ""]], TO],
  ["ج", "lines of one item and packaging fold into one when the dues are built again", [[SP, "oldLines.find((o) => !keptLines.has(o.id) && o.x_due_id &&", "oldLines.find((o) => o.x_due_id &&"]], TO],
  ["ج", "a special line counts for the cash market among today's suppliers", [[SP, "      const won = !it.special_line && market.winners.has(", "      const won = market.winners.has("]], TO],
  ["ج", "a special line is billed to the cash market", [[PA, "    const won = it.special_line ? undefined : market?.winners.get(winnerKey(it.product_id, it.packaging_id));", "    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));"]], TO],
  ["ج", "what a special line was really bought at is not written back", [[OD, "    if (brief?.items.some((it) => it.special_line)) await (await import(\"./special-accept\")).syncSpecialPurchase(env, brief.items);\n", ""]], TO],
  ["ج", "the real price is written on a line that is not «سعر خاص»", [[ACC, "domain: [[\"id\", \"in\", priced.map((it) => Number(it.special_line))], [\"x_special_price\", \"=\", true]],", "domain: [[\"id\", \"in\", priced.map((it) => Number(it.special_line))]],"]], TO],
  ["ج", "an unchanged price is written again", [[ACC, "      if (Math.abs((Number(r.x_special_purchase) || 0) - price) < 0.005) continue;\n", ""]], TO],
  ["ج", "the driver's stop names a special line by its packaging", [[OD, "    const pkname = l.x_special_price === true && l.x_pack_text ? String(l.x_pack_text).trim() : stripRef((l.x_packaging_id as [number, string])[1]);", "    const pkname = stripRef((l.x_packaging_id as [number, string])[1]);"]], TO],
  ["ج", "kilos are cartons", [[ACC, "  if (!isKiloUnit(unit)) return { cartons: qty, kilos: 0 };", "  if (true) return { cartons: qty, kilos: 0 };"]], TA],
  ["ج", "an unknown packaging weight is guessed (a kilo a carton)", [[ACC, "  return packKg > 0 ? { cartons: qty / packKg, kilos: 0 } : { cartons: 0, kilos: qty };", "  return packKg > 0 ? { cartons: qty / packKg, kilos: 0 } : { cartons: qty, kilos: 0 };"]], TA],
  ["ج", "a carton started is no carton", [[ACC, "  return { cartons: Math.ceil(sum.cartons - 1e-9), kilos: round2(sum.kilos) };", "  return { cartons: Math.floor(sum.cartons), kilos: round2(sum.kilos) };"]], TA],
  ["ج", "«حد الطلب الكبير» of zero is taken as zero", [[ACC, "    return n > 0 ? Math.floor(n) : LARGE_ORDER_DEFAULT;", "    return Math.floor(n);"]], TA],
  ["ج", "the settings' limit is not read", [[ACC, "    const n = Number(r?.[LARGE_ORDER_FIELD]) || 0;", "    const n = 0;"]], TA],
  ["ج", "a small order is a large one", [[ACC, "    const large = size.cartons >= limit;", "    const large = true;"]], TA],
  ["ج", "an order of exactly the limit is not large", [[ACC, "    const large = size.cartons >= limit;", "    const large = size.cartons > limit;"]], TA],
  ["ج", "Baraa is not told of a large order at the conversion", [[ACC, "      await sendOwnerAlert(penv, `${q.simulation ? `${SIM_MARK} — ` : \"\"}${largeOrderText(size.cartons, size.kilos, tail)}`).catch(() => {});\n", ""]], TA],
  ["ج", "a large order is not kept for its morning", [[ACC, "      await rememberLargeOrder(env, deliveryDate, {", "      await Promise.resolve({"]], TA],
  ["ج", "the morning alert goes before 02:00", [[ACC, "    if (riyadhMinutes(new Date(now)) < LARGE_MORNING_MINUTE) return out;\n", ""]], TA],
  ["ج", "the morning alert goes at every tick", [[ACC, "      if (!claim.claimed) { out.push({ orderId: e.orderId, action: \"alerted_before\" }); continue; }\n", ""]], TA],
  ["ج", "a cancelled order is alerted on its morning", [[ACC, "      if (!o || o.x_state === \"cancelled\" || o.x_state === \"delivered\" || o.x_state === \"closed\") {", "      if (!o) {"]], TA],
  ["ج", "the morning alert is the conversion's own words", [[ACC, "`اليوم تسليم الطلب #${e.orderId} (${e.quote}، ${e.customer || \"—\"})`", "`الطلب #${e.orderId} (${e.quote}، ${e.customer || \"—\"})`"]], TA],
  ["ج", "the tick does not run the large orders' morning", [[IDX, "            const lg = await runLargeOrderMorning(rawEnv, Date.now());", "            const lg: unknown[] = [];"]], TA],

  // ---------------------------------------------------------------- د — the delivery, the invoice, the profit
  ["د", "a before-VAT quotation's total is its lines × 1.15 again", [[QT, "  const grandTotal = net ? inclusive : lines;", "  const grandTotal = net ? round2(lines * VAT_FACTOR) : lines;"]], TO],
  ["د", "a before-VAT quotation's VAT row is 15 % of its lines again (the page no longer adds up)", [[QT, "  const vatAmount = net ? round2(inclusive - lines) : round2(lines - lines / VAT_FACTOR);", "  const vatAmount = net ? round2(lines * 0.15) : round2(lines - lines / VAT_FACTOR);"]], TL],
  ["د", "the quotation's inclusive total is of the prices before VAT", [[QT, "  const inclusive = round2(q.lines.reduce((s, l) => s + round2(l.qty * l.finalPrice), 0));", "  const inclusive = round2(q.lines.reduce((s, l) => s + round2(l.qty * l.finalNet), 0));"]], TO],
  ["د", "a special order takes the quantity discount", [[INV, "  if (order.special_quote_id) { discount = 0; discountPct = 0; }\n", ""]], TO],
  ["د", "the order is not told as a special request's", [[OD, "    special_quote_id: Array.isArray(order.x_special_quote_id) ? order.x_special_quote_id[0] : 0,", "    special_quote_id: 0,"]], TO],
  ["د", "the delivery form names a special line by its packaging", [[OD, "      packaging_name: specialPack(l) || (l.x_packaging_id ? stripRef(l.x_packaging_id[1]) : \"\"),", "      packaging_name: (l.x_packaging_id ? stripRef(l.x_packaging_id[1]) : \"\"),"]], TO],
  ["د", "«التعبئة» of a line that is not «سعر خاص» names it", [[OD, "  return l.x_special_price === true && typeof l.x_pack_text === \"string\" ? l.x_pack_text.trim() : \"\";", "  return typeof l.x_pack_text === \"string\" ? l.x_pack_text.trim() : \"\";"]], TO],
  ["د", "the invoice's PDF prints the packaging's name", [[INV, "      pack: l.pack_text || packagingNames[lineIdx],", "      pack: packagingNames[lineIdx],"]], TO],
  ["د", "the delivery note prints the packaging's name", [[DN, "    pack: l.x_special_price === true && l.x_pack_text ? String(l.x_pack_text).trim() : packagingNames[i],", "    pack: packagingNames[i],"]], TO],
  ["د", "«عندي ملاحظة» lists a special line by its packaging", [[CF, "(typeof l.x_pack_text === \"string\" && l.x_pack_text.trim() ? l.x_pack_text.trim() : m2oName(l.x_packaging_id));", "(m2oName(l.x_packaging_id));"]], TO],
  ["د", "the sale order's line tells a special line by its packaging", [[SA, "    const pack = r.x_special_price === true && r.x_pack_text ? String(r.x_pack_text).trim() : r.x_packaging_id ? stripRef(r.x_packaging_id[1]) : \"\";", "    const pack = r.x_packaging_id ? stripRef(r.x_packaging_id[1]) : \"\";"]], TO],
  ["د", "«📊 اليوم» costs a special line at the day's cost of its packaging", [[INS, "    const purchase = special ? Number(l.x_special_purchase) || 0 : cost.get(`${o.priceDay}:${key}`) ?? 0;", "    const purchase = cost.get(`${o.priceDay}:${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`) ?? 0;"]], TO],
  ["د", "a special line's key is its item's (the item's history takes it)", [[INS, "${m2oId(l.x_packaging_id)}${special ? \":sq\" : \"\"}`;", "${m2oId(l.x_packaging_id)}`;"]], TO],
  ["د", "a special line is not told apart among the day's sold lines", [[INS, "...(special ? { special: true, ...(isKiloUnit(String(l.x_pack_text || \"\")) ? { cartons: 0 } : {}) } : {}) });", "});"]], TO],
  ["د", "a special line's kilos are the day's cartons", [[INS, "...(isKiloUnit(String(l.x_pack_text || \"\")) ? { cartons: 0 } : {})", ""]], TO],
  ["د", "the day's cartons ignore a line's own count", [[INS, "  const cartons = of.reduce((a, l) => a + (l.cartons ?? l.quantity), 0);", "  const cartons = of.reduce((a, l) => a + l.quantity, 0);"]], TO],
  ["د", "a special line with no purchase price is summed as nothing in «📊 اليوم»", [[INS, "    if (!(purchase > 0)) throw new Error(special ? \"a special quotation's line without its purchase price\" : \"a delivered line without its day's purchase price\");\n", "    if (!(purchase > 0) && !special) throw new Error(\"a delivered line without its day's purchase price\");\n"]], TO],
  ["د", "the 21:30 summary costs a special line at the day's cost", [[SUM, "    const buy = l.x_special_price === true ? Number(l.x_special_purchase) || 0 : cost.get(`${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`);", "    const buy = cost.get(`${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`);"]], TO],

  // ---------------------------------------------------------------- هـ — the screens, the hook, the scenario
  ["هـ", "«📦 حوّل لطلب» is not one of the hook's ops", [[SQ, "export const HOOK_OPS = [\"recalc\", \"accept\", \"send\", \"issue\", \"pdf\", \"approve\", \"convert\"] as const;", "export const HOOK_OPS = [\"recalc\", \"accept\", \"send\", \"issue\", \"pdf\", \"approve\"] as const;"]], TS],
  ["هـ", "the hook's «📦 حوّل لطلب» only accepts", [[SQ, "const r = op === \"approve\" ? await approveSpecialQuote(env, id, { now }) : await convertSpecialQuote(env, id, { now, ctx });", "const r = await approveSpecialQuote(env, id, { now });"]], TS],
  ["هـ", "the hook's «✅ العميل وافق» converts at once", [[SQ, "const r = op === \"approve\" ? await approveSpecialQuote(env, id, { now }) : await convertSpecialQuote(env, id, { now, ctx });", "const r = await convertSpecialQuote(env, id, { now, ctx });"]], TS],
  ["هـ", "the state «مقبول» has another label", [[SQ, "accepted: \"مقبول — تحوّل لطلب\", closed: \"مغلق\" };", "accepted: \"مقبول\", closed: \"مغلق\" };"]], TQ],
  ["هـ", "the screens' states are not the worker's", [[LIB, "[\"quoted\", \"صدر العرض\"], [\"accepted\", \"مقبول — تحوّل لطلب\"], [\"closed\", \"مغلق\"]];", "[\"quoted\", \"صدر العرض\"], [\"closed\", \"مغلق\"], [\"accepted\", \"مقبول — تحوّل لطلب\"]];"]], TQ],
  ["هـ", "«الكمية المؤكدة» is a number (empty would read as zero)", [[LIB, "{ name: \"x_confirmed_qty\", ttype: \"char\",", "{ name: \"x_confirmed_qty\", ttype: \"float\","]], TA],
  ["هـ", "«✅ العميل وافق» shows before the quotation is issued", [[LIB, "class=\"btn-primary\" invisible=\"x_state != 'quoted'\"/>", "class=\"btn-primary\"/>"]], TA],
  ["هـ", "«📦 حوّل لطلب» shows before the acceptance", [[LIB, "invisible=\"x_state != 'quoted' or not x_accepted_at\" confirm=", "invisible=\"x_state != 'quoted'\" confirm="]], TA],
  ["هـ", "«📦 حوّل لطلب» does not ask first", [[LIB, " or not x_accepted_at\" confirm=\"${CONVERT_CONFIRM}\"/>", " or not x_accepted_at\"/>"]], TA],
  ["هـ", "an accepted request still shows «📄 أصدر عرض السعر»", [[LIB, "  <xpath expr=\"//header/button[@name='${ids.issue}']\" position=\"attributes\"><attribute name=\"invisible\">x_state in ('closed', 'accepted')</attribute></xpath>\n", ""]], TA],
  ["هـ", "an accepted request's lines can still be edited", [[LIB, "  <xpath expr=\"//field[@name='x_line_ids']\" position=\"attributes\"><attribute name=\"readonly\">x_state in ('closed', 'accepted')</attribute></xpath>\n", ""]], TA],
  ["هـ", "the acceptance's fields stay open after the conversion", [[LIB, "        <field name=\"x_delivery_date\" readonly=\"x_state != 'quoted'\"/>", "        <field name=\"x_delivery_date\"/>"]], TA],
  ["هـ", "«بانتظار رد العميل» shows the expired ones", [[LIB, "[\"f_waiting\", \"بانتظار رد العميل\", `[('x_state', '=', 'quoted'), ('x_valid_until', '&gt;=', ${NOW_UTC})]`],", "[\"f_waiting\", \"بانتظار رد العميل\", `[('x_state', '=', 'quoted')]`],"]], TA],
  ["هـ", "«انتهت صلاحيته» shows the accepted ones", [[LIB, "[\"f_expired\", \"انتهت صلاحيته\", `[('x_state', '=', 'quoted'), ('x_valid_until', '&lt;', ${NOW_UTC})]`],", "[\"f_expired\", \"انتهت صلاحيته\", `[('x_valid_until', '&lt;', ${NOW_UTC})]`],"]], TA],
  ["هـ", "the sale order's button shows on a confirmed order", [[LIB, "invisible=\"state not in ('draft', 'sent') or not origin\"/>", "invisible=\"not origin\"/>"]], TA],
  ["هـ", "the sale order's button accepts an order that is no request's", [[LIB, "if not quote:\n    raise UserError('هذا الأمر ليس عرض «طلب أسعار خاص»: القبول والتحويل من شاشة الطلب الخاص.')\n", ""]], TA],
  ["هـ", "«↩️ أعد فتحه» makes a converted request «صدر العرض»", [[LIB, "rec.write({'x_state': 'accepted' if converted else ('quoted'", "rec.write({'x_state': ('quoted'"]], TA],
  ["هـ", "«↩️ أعد فتحه» keeps «مقبول» though the order was cancelled", [[LIB, "    converted = rec.x_daily_order_id and rec.x_daily_order_id.x_state != 'cancelled'\n", "    converted = rec.x_daily_order_id\n"]], TA],
  ["هـ", "the box of an expired quotation has other words than the worker's", [[LIB, "field_description: \"أعتمد الأسعار رغم انتهاء الصلاحية\",", "field_description: \"اعتماد الأسعار\","]], TA],

  // ---------------------------------------------------------------- و — the check-in template again
  ["و", "v2 takes the supplier's name", [[OUT, "[template === CHECKIN_TEMPLATE_V1 ? name : arabicDate(day)];", "[name];"]], TU],
  ["و", "v1 takes the day", [[OUT, "[template === CHECKIN_TEMPLATE_V1 ? name : arabicDate(day)];", "[arabicDate(day)];"]], TU],
  ["و", "v2 says «دوري» again", [[LIBT, "body: \"طلب تحديث التوفر والأسعار ليوم {{1}} حسب اتفاق التوريد مع يو تاك.", "body: \"تحديث دوري ليوم {{1}} حسب اتفاق التوريد مع يو تاك."]], TU],
  ["و", "v2's button is not the word that opens the offer form", [[LIBT, "export const CHECKIN_BUTTON = \"عرض مورد\";", "export const CHECKIN_BUTTON = \"تحديث التوفر\";"]], TU],
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
writeFileSync(new URL("../artifacts/s66-20261008-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
