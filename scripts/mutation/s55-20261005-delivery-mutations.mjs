// Mutation check for § 55 ب (2026-10-05) — the delivery and collection form: each mutation disables ONE
// guard, runs its test file, and must make it fail. The source is restored in `finally` after every
// run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s55-20261005-delivery-mutations.mjs [ب …]     (no argument: every part)
//
// Out: scripts/artifacts/s55-20261005-delivery-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s55-delivery.test.mts";
const DF = "src/delivery-form.ts";
const TM = "src/team.ts";
const OF = "src/order-flow.ts";
const RT = "src/router.ts";
const IX = "src/index.ts";
const IN = "src/invoice.ts";
const GW = "src/wa-gateway.ts";
const PP = "src/price-privacy.ts";
const PUR = "src/wa-purposes.ts";
const LIB = "scripts/lib/s55-flows.mjs";
const OD = "scripts/lib/s55-odoo.mjs";
const KIT = "tests/s46-kit.mts";

const SETTLE = "  if (opts.settle && (await opts.settle({ invoiceId, number: invoiceNumber, total }).catch(() => false))) {";
const RET = "    const ret = { x_ordered_qty: x.line.ordered, x_return_qty: x.short, x_return_reason: x.reason ?? \"short\" };";
const VALS = "    const vals = x.delivered > 0 ? { x_quantity: x.delivered, ...ret } : { x_status: \"unavailable\", ...ret };";
const HINT = "    hint: cut(`${k ? `${k} · ` : \"\"}المطلوب ${qty(ordered)} · ${priced}`, DELIVERY_HINT_MAX),";
const QTY_RE = "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";\n  const n = Number(s);\n  if (n > ordered";
const AMT_RE = "  if (s === \"\") return null;\n  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";";
const AMT_RANGE = "  return n > 0 && n <= DELIVERY_AMOUNT_MAX ? n : \"invalid\";";
const OWNER_SET = "\"owner_alert\", \"owner_delivery_form\", \"delivery_form_test\", ";
const NOTHING_TOLD = "      if (!owner) {\n        await sendOwnerMessage(env, [\n          `⚠️ لم يُسلَّم الطلب";
const FAIL_UNDO = "      if (undo) await undo();\n      await releaseButton(env, lock);\n      throw err;";
const SETTLED = "          return payment.kind === \"paid\";";
const CUSTODY = "  const custody = owner ? \"✅ سُجّل في عهدة المحصّل\" : \"✅ في عهدتك\";";
const RECORD = "collectedBy, exact: true });";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- the Flow at Meta
  ["ب", "the Flow has twenty-five line slots (fifty-six components a screen)", [[LIB,
    "export const DELIVERY_SLOTS = 20;", "export const DELIVERY_SLOTS = 25;"]], T],
  ["ب", "the Flow's screen is not the one the worker opens", [[LIB,
    "export const DELIVERY_SCREEN = \"DELIVER_A\";", "export const DELIVERY_SCREEN = \"DELIVER\";"]], T],
  ["ب", "a quantity may be left empty in the Flow (not required)", [[LIB,
    "required: `\\${data.v${n}}`, \"helper-text\"", "required: false, \"helper-text\""]], T],
  ["ب", "the quantity field does not open on a value", [[LIB,
    "\"init-value\": `\\${data.i${n}}`, visible: `\\${data.v${n}}` },", "visible: `\\${data.v${n}}` },"]], T],
  ["ب", "the reason's list is gone from the Flow", [[LIB,
    "    { type: \"Dropdown\", name: `r${n}`, label: DELIVERY_REASON_LABEL, required: false, \"data-source\": DELIVERY_REASONS, \"init-value\": DELIVERY_REASONS[0].id, visible: `\\${data.v${n}}` },\n", ""]], T],
  ["ب", "the reason opens on «تالف»", [[LIB,
    "\"init-value\": DELIVERY_REASONS[0].id", "\"init-value\": DELIVERY_REASONS[1].id"]], T],
  ["ب", "the reason is required", [[LIB,
    "label: DELIVERY_REASON_LABEL, required: false", "label: DELIVERY_REASON_LABEL, required: true"]], T],
  ["ب", "«تالف» is not a reason of the Flow", [[LIB,
    "  { id: \"damaged\", title: \"تالف\" },\n", ""]], T],
  ["ب", "«لم يدفع» is not a choice of the Flow", [[LIB,
    "  { id: \"unpaid\", title: \"لم يدفع\" },\n", ""]], T],
  ["ب", "a payment is chosen for him (cash)", [[LIB,
    "required: true, \"data-source\": DELIVERY_PAY_OPTIONS }", "required: true, \"data-source\": DELIVERY_PAY_OPTIONS, \"init-value\": \"cash\" }"]], T],
  ["ب", "the payment is not required", [[LIB,
    "name: \"pay\", label: DELIVERY_PAY_LABEL, required: true", "name: \"pay\", label: DELIVERY_PAY_LABEL, required: false"]], T],
  ["ب", "the amount is required", [[LIB,
    "label: DELIVERY_AMOUNT_LABEL, \"input-type\": \"number\", required: false", "label: DELIVERY_AMOUNT_LABEL, \"input-type\": \"number\", required: true"]], T],
  ["ب", "«إرسال» does not send the reasons", [[LIB,
    "[[`q${n}`, `\\${form.q${n}}`], [`r${n}`, `\\${form.r${n}}`]]", "[[`q${n}`, `\\${form.q${n}}`]]"]], T],
  ["ب", "«إرسال» does not send the payment", [[LIB,
    "...[\"pay\", \"amt\", \"note\"].map(", "...[\"amt\", \"note\"].map("]], T],
  // ---------------------------------------------------------------- what the worker sends
  ["ب", "the Flow's id is back to «0» (not the one Meta published)", [[DF,
    "export const DELIVERY_FLOW_ID = \"1113882387786390\";", "export const DELIVERY_FLOW_ID = \"0\";"]], T],
  ["ب", "the message opens another Flow", [[DF,
    "            flow_id: DELIVERY_FLOW_ID,", "            flow_id: \"961075853720270\","]], T],
  ["ب", "the worker fills fifteen slots (the Flow has twenty)", [[DF,
    "export const DELIVERY_FLOW_SLOTS = 20;", "export const DELIVERY_FLOW_SLOTS = 15;"]], T],
  ["ب", "the worker opens another screen", [[DF,
    "export const DELIVERY_FLOW_SCREEN = \"DELIVER_A\";", "export const DELIVERY_FLOW_SCREEN = \"DELIVER_B\";"]], T],
  ["ب", "an unused slot carries an empty label", [[DF,
    "    data[`l${n}`] = l ? l.label : \"-\";", "    data[`l${n}`] = l ? l.label : \"\";"]], T],
  ["ب", "the field does not open on the ordered quantity", [[DF,
    "    data[`i${n}`] = l ? qty(l.ordered) : \"0\";", "    data[`i${n}`] = \"0\";"]], T],
  ["ب", "the hint drops «المطلوب N»", [[DF, HINT,
    "    hint: cut(`${k ? `${k} · ` : \"\"}${priced}`, DELIVERY_HINT_MAX),"]], T],
  ["ب", "the hint drops the sale price", [[DF, HINT,
    "    hint: cut(`${k ? `${k} · ` : \"\"}المطلوب ${qty(ordered)}`, DELIVERY_HINT_MAX),"]], T],
  ["ب", "the hint is not cut to Meta's eighty characters", [[DF, HINT,
    "    hint: `${k ? `${k} · ` : \"\"}المطلوب ${qty(ordered)} · ${priced}`,"]], T],
  ["ب", "a long name is not cut to Meta's twenty characters", [[DF,
    "    label: cut(clean(product), DELIVERY_LABEL_MAX),", "    label: clean(product),"]], T],
  ["ب", "the heading is not cut to Meta's eighty characters", [[DF,
    "طلب #${orderId} — ${customer || \"عميل\"}`, DELIVERY_HEAD_MAX);", "طلب #${orderId} — ${customer || \"عميل\"}`, 400);"]], T],
  ["ب", "the hint says «شامل الضريبة» whatever the day", [[DF,
    "ر.س${vat ? \" شامل الضريبة\" : \"\"}` : DELIVERY_NO_PRICE_HINT;", "ر.س${true ? \" شامل الضريبة\" : \"\"}` : DELIVERY_NO_PRICE_HINT;"]], T],
  ["ب", "a line without a price shows «السعر 0»", [[DF,
    "  const priced = price > 0 ? `السعر", "  const priced = true ? `السعر"]], T],
  ["ب", "a line of quantity 0 has a field", [[DF,
    "order.lines.filter((l) => l.quantity > 0).map(", "order.lines.map("]], T],
  ["ب", "Baraa's manual price on a line is not shown", [[DF,
    "    const price = l.unit_price ?? l.price_unit_manual ?? 0;", "    const price = l.unit_price ?? 0;"]], T],
  ["ب", "the lines beyond twenty are dropped (not named, not in the summary)", [[DF,
    "extra: all.slice(DELIVERY_FLOW_SLOTS) };", "extra: [] };"]], T],
  ["ب", "the message does not name the lines outside the form", [[DF,
    "    left.length ? `خارج النموذج", "    false ? `خارج النموذج"]], T],
  // ---------------------------------------------------------------- the button
  ["ب", "the stop's session button is «تم التسليم ✅» again", [[TM,
    "    deliveryButton(s.order_id),\n", "    { id: `delivered_${s.order_id}`, title: \"تم التسليم ✅\" },\n"]], T],
  ["ب", "Baraa's confirmed order carries «تم التسليم ✅» again", [[OF,
    "      content: buttonsContent(text, [deliveryButton(orderId)]),", "      content: buttonsContent(text, [{ id: `delivered_${orderId}`, title: \"تم التسليم ✅\" }]),"]], T],
  ["ب", "the template's quick reply is changed too (dlv_)", [[TM,
    "        { index: 0, payload: `delivered_${s.order_id}` },", "        { index: 0, payload: `dlv_${s.order_id}` },"]], T],
  ["ب", "the button's id is delivered_<order>", [[DF,
    "({ id: `dlv_${orderId}`, title: DELIVERY_BUTTON_TITLE })", "({ id: `delivered_${orderId}`, title: DELIVERY_BUTTON_TITLE })"]], T],
  ["ب", "the button is still titled «تم التسليم ✅»", [[DF,
    "export const DELIVERY_BUTTON_TITLE = \"📦 سلّم وحصّل\";", "export const DELIVERY_BUTTON_TITLE = \"تم التسليم ✅\";"]], T],
  ["ب", "Baraa's text still says «اضغط «تم التسليم»»", [[OF,
    "اضغط «${DELIVERY_BUTTON_TITLE}»: تكتب", "اضغط «تم التسليم»: تكتب"]], T],
  ["ب", "Baraa's text does not name «تسليم N»", [[OF,
    " (أو اكتب «تسليم ${orderId}» لتسليمه كاملاً.)", ""]], T],
  // ---------------------------------------------------------------- who, when, which order
  ["ب", "anyone's tap gets the form (the roster is not asked)", [[DF,
    "    return m ? { kind: \"team\", partnerId: m.partnerId, name: m.name, whatsapp: digits } : null;", "    return { kind: \"team\", partnerId: m?.partnerId ?? 0, name: m?.name ?? \"\", whatsapp: digits };"]], T],
  ["ب", "a roster that cannot be read: he is taken for a team member", [[DF,
    "    console.warn(\"[delivery-form] the roster could not be read — no form\", (e as Error)?.message);\n    return null;", "    return { kind: \"team\", partnerId: 0, name: \"\", whatsapp: digits };"]], T],
  ["ب", "Baraa is not known as the owner", [[DF,
    "  if (isOwnerRecipient(env, digits)) return { kind: \"owner\",", "  if (false) return { kind: \"owner\","]], T],
  ["ب", "Baraa's form goes under the team's purpose", [[DF,
    "isOwnerRecipient(env, to) ? OWNER_DELIVERY_FORM_PURPOSE : DELIVERY_FORM_PURPOSE);", "DELIVERY_FORM_PURPOSE);"]], T],
  ["ب", "the team's form is not a price purpose: a supplier's number may get it", [[PP,
    "  \"delivery_form\",\n", ""]], T],
  ["ب", "the owner guard refuses Baraa's own delivery form", [[GW, OWNER_SET,
    "\"owner_alert\", \"delivery_form_test\", "]], T],
  ["ب", "the owner guard refuses the trial", [[GW, OWNER_SET,
    "\"owner_alert\", \"owner_delivery_form\", "]], T],
  ["ب", "the team's form is an automatic purpose: one message Meta refused stops it for 24h", [[PUR,
    "  delivery_form: { label: \"نموذج التسليم والتحصيل\", kind: \"reply\",", "  delivery_form: { label: \"نموذج التسليم والتحصيل\", kind: \"operational\","]], T],
  ["ب", "Baraa's form is an automatic purpose: one message Meta refused stops it for 24h", [[PUR,
    "  owner_delivery_form: { label: \"نموذج التسليم والتحصيل (المالك)\", kind: \"reply\",", "  owner_delivery_form: { label: \"نموذج التسليم والتحصيل (المالك)\", kind: \"operational\","]], T],
  ["ب", "the form is held for a number outside its window", [[DF,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const built = opts.built", "  const built = opts.built"], [DF,
    "    noHold: true,\n    noHoldReason: \"نموذج التسليم يُرسل داخل نافذة 24 ساعة فقط\",\n", ""]], T],
  ["ب", "an order that is not found is asked for its state", [[DF,
    "  if (!brief) return { reason: \"not_found\",", "  if (false) return { reason: \"not_found\","]], T],
  ["ب", "an order already delivered is not answered «مسجّل مسلّماً»", [[DF,
    "  if (brief.state === \"delivered\" || brief.state === \"closed\") return { reason: \"delivered\",", "  if (false) return { reason: \"delivered\","]], T],
  ["ب","a cancelled order is not answered «ملغى»", [[DF,
    "  if (brief.state === \"cancelled\") return { reason: \"cancelled\",", "  if (false) return { reason: \"cancelled\","]], T],
  ["ب", "an order the customer has not confirmed gets a form", [[DF,
    "  if (!DELIVERABLE_STATES.has(brief.state)) return { reason: \"not_confirmed\",", "  if (false) return { reason: \"not_confirmed\","]], T],
  ["ب", "the order's state is not looked at before a form", [[DF,
    "    if (problem) return { sent: false, ...problem };", "    if (false) return { sent: false, ...problem };"]], T],
  ["ب", "an order without a line gets an empty form", [[DF,
    "  if (!built || !built.lines.length) return", "  if (!built) return"]], T],
  ["ب", "a form that did not go leaves its token", [[DF,
    "    try { await env.MSG_DEDUP.delete(deliveryFormKey(rec.token)); } catch { /* expires on its own */ }\n", ""]], T],
  // ---------------------------------------------------------------- the reply: the token
  ["ب", "another number's reply with the token is taken", [[DF,
    "  if (!rec || rec.to !== to) {\n    console.warn(`[delivery-form] reply with no token", "  if (!rec) {\n    console.warn(`[delivery-form] reply with no token"]], T],
  ["ب", "a token is read twice", [[DF,
    "  if (!use.claimed) {", "  if (false) {"]], T],
  ["ب", "an order already delivered is not answered before the form is taken", [[DF,
    "  if (closed) {\n    await say(closed.text);", "  if (false) {\n    await say(closed.text);"]], T],
  ["ب", "the order's lines that moved since the form are not noticed", [[DF,
    "  if (!current || !sameLines(rec, current)) {", "  if (!current) {"]], T],
  ["ب", "a quantity changed in Odoo since the form is not noticed", [[DF,
    "c.lineId === l.lineId && Math.abs(c.ordered - l.ordered) < 0.0001", "c.lineId === l.lineId"]], T],
  ["ب", "a line added to the order since the form is not noticed", [[DF,
    "  return shown.length === cur.length && shown.every(", "  return shown.every("]], T],
  ["ب","a reply is not known by its token (dv1.)", [[DF,
    "String(token ?? \"\").startsWith(\"dv1.\");", "String(token ?? \"\").startsWith(\"dx1.\");"]], T],
  // ---------------------------------------------------------------- the reply: what the fields hold
  ["ب", "a field that cannot be read does not refuse the form", [[DF,
    "  if (problems.length) {\n    console.warn(`[delivery-form] order=${orderId} refused", "  if (false) {\n    console.warn(`[delivery-form] order=${orderId} refused"]], T],
  ["ب", "no new form after a refusal", [[DF,
    "    const again = await sendDeliveryForm(env, orderId, who, { now: nowMs, body: deliveryRefusalText(orderId, problems), ctx }).catch(() => ({ sent: false }));", "    const again = { sent: false };"]], T],
  ["ب", "the refusal does not name the field", [[DF,
    "  ...problems.map((p) => `• ${p}`),\n", ""]], T],
  ["ب", "more than the ordered quantity is taken", [[DF,
    "  if (n > ordered + 0.005) return \"invalid\";\n", ""]], T],
  ["ب", "an empty quantity is zero", [[DF, QTY_RE,
    "  if (s !== \"\" && !/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";\n  const n = Number(s);\n  if (n > ordered"]], T],
  ["ب", "a quantity of three decimals is taken", [[DF, QTY_RE,
    "  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";\n  const n = Number(s);\n  if (n > ordered"]], T],
  ["ب", "a negative quantity is taken", [[DF, QTY_RE,
    "  if (!/^-?\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";\n  const n = Number(s);\n  if (n > ordered"]], T],
  ["ب", "Arabic digits are not read", [[DF,
    "  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))\n  .replace(/[۰-۹]/g", "  .replace(/[۰-۹]/g"]], T],
  ["ب", "a shortfall with no reason chosen is «تالف»", [[DF,
    "(raw in RETURN_REASONS ? (raw as ReturnReason) : \"short\") : null;", "(raw in RETURN_REASONS ? (raw as ReturnReason) : \"damaged\") : null;"]], T],
  ["ب", "a reason that is not one of the three is written as it came", [[DF,
    "(raw in RETURN_REASONS ? (raw as ReturnReason) : \"short\") : null;", "(raw || \"short\") : null;"]], T],
  ["ب", "a payment that is not one of the three is cash", [[DF,
    "  out.pay = pay in PAY_METHODS ? (pay as PayMethod) : null;", "  out.pay = pay in PAY_METHODS ? (pay as PayMethod) : \"cash\";"]], T],
  ["ب", "«المبلغ المستلم» is read with «لم يدفع»", [[DF,
    "  if (out.pay === \"cash\" || out.pay === \"transfer\") {\n    const a = parsePaidAmount(values.amt);", "  if (out.pay) {\n    const a = parsePaidAmount(values.amt);"]], T],
  ["ب", "an amount that is not a number is the whole invoice", [[DF,
    "    if (a === \"invalid\") out.badAmount = true;\n    else out.amount = a;", "    if (a !== \"invalid\") out.amount = a;"]], T],
  ["ب", "an amount of zero is taken", [[DF, AMT_RANGE,
    "  return n >= 0 && n <= DELIVERY_AMOUNT_MAX ? n : \"invalid\";"]], T],
  ["ب", "an amount has no ceiling", [[DF, AMT_RANGE,
    "  return n > 0 ? n : \"invalid\";"]], T],
  ["ب", "an amount of three decimals is taken", [[DF, AMT_RE,
    "  if (s === \"\") return null;\n  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";"]], T],
  // ---------------------------------------------------------------- the reply: what is written
  ["ب", "a line delivered in part keeps the ordered quantity (the invoice bills what was ordered)", [[DF, VALS,
    "    const vals = x.delivered > 0 ? { ...ret } : { x_status: \"unavailable\", ...ret };"]], T],
  ["ب", "a line of which nothing was delivered stays in the invoice", [[DF, VALS,
    "    const vals = x.delivered > 0 ? { x_quantity: x.delivered, ...ret } : { ...ret };"]], T],
  ["ب", "a line of which nothing was delivered has its quantity set to 0", [[DF, VALS,
    "    const vals = x.delivered > 0 ? { x_quantity: x.delivered, ...ret } : { x_status: \"unavailable\", x_quantity: 0, ...ret };"]], T],
  ["ب", "«الكمية المطلوبة» is not kept on the line", [[DF, RET,
    "    const ret = { x_return_qty: x.short, x_return_reason: x.reason ?? \"short\" };"]], T],
  ["ب", "«المرتجع» is the delivered quantity", [[DF, RET,
    "    const ret = { x_ordered_qty: x.line.ordered, x_return_qty: x.delivered, x_return_reason: x.reason ?? \"short\" };"]], T],
  ["ب", "«سبب المرتجع» is not written", [[DF, RET,
    "    const ret = { x_ordered_qty: x.line.ordered, x_return_qty: x.short };"]], T],
  ["ب", "a line delivered in full is written too", [[DF,
    "  const short = e.entries.filter((x) => x.short > 0);\n  const none = short.filter(", "  const short = e.entries;\n  const none = short.filter("]], T],
  ["ب", "the note is not written on the order", [[DF,
    "    if (e.note) await appendDeliveryNote(", "    if (false) await appendDeliveryNote("]], T],
  ["ب", "the note replaces the order's notes", [[DF,
    "  const next = `${typeof o?.x_delivery_notes === \"string\" && o.x_delivery_notes ? `${o.x_delivery_notes}\\n` : \"\"}[", "  const next = `["]], T],
  // ---------------------------------------------------------------- nothing delivered
  ["ب", "nothing delivered is still a delivery", [[DF,
    "    if (!rec.extra.length && !e.entries.some((x) => x.delivered > 0)) {", "    if (false) {"]], T],
  ["ب", "the lines outside the form do not count as delivered", [[DF,
    "    if (!rec.extra.length && !e.entries.some(", "    if (!e.entries.some("]], T],
  ["ب", "nothing delivered: the stop is not marked «مشكلة»", [[DF,
    "      await markStopIssue(env, orderId, note);\n", ""]], T],
  ["ب", "nothing delivered: the reasons are not kept on the order", [[DF,
    "      await appendDeliveryNote(env, orderId, rec.who.name, note, nowMs).catch(", "      await Promise.resolve().catch("]], T],
  ["ب", "nothing delivered: Baraa is not told", [[DF, NOTHING_TOLD,
    "      if (false) {\n        await sendOwnerMessage(env, [\n          `⚠️ لم يُسلَّم الطلب"]], T],
  ["ب", "nothing delivered by Baraa himself: he gets a second line", [[DF, NOTHING_TOLD,
    "      if (true) {\n        await sendOwnerMessage(env, [\n          `⚠️ لم يُسلَّم الطلب"]], T],
  ["ب", "nothing delivered: a payment he reported is lost", [[DF,
    "          e.pay && e.pay !== \"unpaid\" ? `• بلّغ عن دفع ولم يُسجَّل: ${reported(e)}` : \"\",\n", ""]], T],
  // ---------------------------------------------------------------- the delivery and its lock
  ["ب", "the form does not hold the lock of «تم التسليم»", [[DF,
    "    const lock = await claimButton(env, `delivered:${orderId}`);", "    const lock = await claimButton(env, `dform_deliver:${orderId}`);"]], T],
  ["ب", "a delivery lock held by another tap is ignored", [[DF,
    "    if (!lock.claimed) {\n      await releaseButton(env, use);", "    if (false) {\n      await releaseButton(env, use);"]], T],
  ["ب", "the form is used up when another delivery holds the lock", [[DF,
    "    if (!lock.claimed) {\n      await releaseButton(env, use);\n", "    if (!lock.claimed) {\n"]], T],
  ["ب", "the delivery lock is let go after the delivery", [[DF,
    "    await finishButton(env, lock);\n    await finishButton(env, use, TOKEN_TTL);", "    await releaseButton(env, lock);\n    await finishButton(env, use, TOKEN_TTL);"]], T],
  ["ب", "the lines are not put back when the delivery throws", [[DF, FAIL_UNDO,
    "      await releaseButton(env, lock);\n      throw err;"]], T],
  ["ب", "the delivery lock is kept when the delivery throws", [[DF, FAIL_UNDO,
    "      if (undo) await undo();\n      throw err;"]], T],
  ["ب", "the form is used up when the delivery throws", [[DF,
    "  } catch (err) {\n    await releaseButton(env, use);\n    throw err;\n  }\n}", "  } catch (err) {\n    throw err;\n  }\n}"]], T],
  ["ب", "a reply that failed is answered by nothing", [[DF,
    "    await say(rec ? DELIVERY_FORM_ERROR_TEXT(rec.orderId) : DELIVERY_FORM_UNKNOWN_TEXT);\n", ""]], T],
  ["ب", "an answer that does not go undoes a delivery that is done (the form may be sent again)", [[DF,
    "    try { await sendViaGateway(env, { purpose, to, content: textContent(text), ctx }); }\n    catch (e) { console.warn(`[delivery-form] the answer to ${to.slice(-4)} did not go`, (e as Error)?.message); }", "    await sendViaGateway(env, { purpose, to, content: textContent(text), ctx });"]], T],
  ["ب", "the lines are not put back when «تم التسليم» refuses the order", [[DF,
    "      if (!delivered.delivered) await undo();\n", ""]], T],
  ["ب", "the locks are kept when «تم التسليم» refuses the order", [[DF,
    "    if (!delivered.delivered) {\n      await releaseButton(env, lock);\n      await releaseButton(env, use);\n", "    if (!delivered.delivered) {\n"]], T],
  ["ب", "a line put back is «pending» whatever it was", [[DF,
    "{ x_status: was.find((w) => w.id === x.line.lineId)?.x_status || \"pending\", ...cleared }", "{ x_status: \"pending\", ...cleared }"]], T],
  ["ب", "a line put back does not get its quantity back", [[DF,
    "{ x_quantity: x.line.ordered, ...cleared }", "{ ...cleared }"]], T],
  ["ب", "a line put back keeps its return fields", [[DF,
    "    const cleared = { x_ordered_qty: 0, x_return_qty: 0, x_return_reason: false };", "    const cleared = {};"]], T],
  // ---------------------------------------------------------------- the payment
  ["ب", "cash is recorded as a transfer", [[DF,
    "  const method = e.pay;\n  const amount", "  const method = \"transfer\";\n  const amount"]], T],
  ["ب", "the amount he wrote is ignored: always the invoice's total", [[DF,
    "  const amount = e.amount ?? inv.total;", "  const amount = inv.total;"]], T],
  ["ب", "the one who collected is not named on the payment", [[DF, RECORD,
    "collectedBy: null, exact: true });"]], T],
  ["ب", "an amount above the invoice is cut down to it and recorded", [[DF, RECORD,
    "collectedBy, exact: false });"]], T],
  ["ب", "an amount above the invoice is not told as such", [[DF,
    "    if (r.overLimit) return { kind: \"over\", method, amount, remaining: r.overLimit.remaining };\n", ""]], T],
  ["ب", "«لم يدفع» records a payment", [[DF,
    "  if (e.pay !== \"cash\" && e.pay !== \"transfer\") return { kind: \"unpaid\" };\n  const method = e.pay;", "  const method = e.pay === \"transfer\" ? \"transfer\" : \"cash\";"]], T],
  ["ب", "the rest of a part payment is the invoice's total", [[DF,
    "rest: round2(inv.total - amount) };", "rest: inv.total };"]], T],
  ["ب", "the collector is asked although the form paid the invoice in full", [[DF, SETTLED,
    "          return false;"]], T],
  ["ب", "the collector is not asked when something stays due", [[DF, SETTLED,
    "          return payment.kind !== \"no_invoice\";"]], T],
  ["ب", "no invoice is told as «لم يدفع»", [[DF,
    "    let payment: DeliveryPayment = { kind: \"no_invoice\" };", "    let payment: DeliveryPayment = { kind: \"unpaid\" };"]], T],
  ["ب", "the invoice path never calls the form's settlement", [[IN, SETTLE,
    "  if (false) {"]], T],
  ["ب", "the invoice path asks the collector whatever the settlement answered", [[IN, SETTLE,
    "  if (opts.settle && (await opts.settle({ invoiceId, number: invoiceNumber, total }).catch(() => false)) && false) {"]], T],
  ["ب", "the invoice path never asks the collector once a settlement is given", [[IN, SETTLE,
    "  if (opts.settle && ((await opts.settle({ invoiceId, number: invoiceNumber, total }).catch(() => false)) || true)) {"]], T],
  ["ب", "a settlement that throws breaks the invoice's issue", [[IN, SETTLE,
    "  if (opts.settle && (await opts.settle({ invoiceId, number: invoiceNumber, total }))) {"]], T],
  ["ب", "the invoice path drops the option before the issue", [[IN,
    "    issued = await issueAndDispatchInvoice(env, orderId, order, opts);", "    issued = await issueAndDispatchInvoice(env, orderId, order);"]], T],
  ["ب", "«تم التسليم» does not pass the form's option to the invoice", [[RT,
    "    await createAndDispatchInvoiceForOrder(env, orderId, invoiceOpts);", "    await createAndDispatchInvoiceForOrder(env, orderId);"]], T],
  // ---------------------------------------------------------------- what is told
  ["ب", "his summary goes as an ordinary reply (no price guard)", [[DF,
    "    const purpose = rec && rec.to === to ? purposeFor(env, to, !!rec.test) : isOwnerRecipient(env, to) ? OWNER_DELIVERY_FORM_PURPOSE : \"bot_reply\";", "    const purpose = isOwnerRecipient(env, to) ? OWNER_DELIVERY_FORM_PURPOSE : \"bot_reply\";"]], T],
  ["ب", "the summary drops a shortfall's reason", [[DF,
    "  return x.delivered > 0 ? `${head} — لم يُسلَّم ${qty(x.short)} (${why})` : `${head} — لم يُسلَّم (${why})`;", "  return x.delivered > 0 ? `${head} — لم يُسلَّم ${qty(x.short)}` : `${head} — لم يُسلَّم`;"]], T],
  ["ب", "the summary drops the invoice and its total", [[DF,
    "    inv ? `الفاتورة ${inv.number}: ${money(inv.total)} ر.س (بالمسلَّم فقط)` : \"\",\n", ""]], T],
  ["ب", "the summary drops the lines outside the form", [[DF,
    "    rec.extra.length ? `• وخارج النموذج، مسلَّمة كاملة:", "    false ? `• وخارج النموذج، مسلَّمة كاملة:"]], T],
  ["ب", "the summary drops the route's next step", [[DF,
    "    e.note ? `ملاحظتك: ${e.note}` : \"\",\n    tail,\n", "    e.note ? `ملاحظتك: ${e.note}` : \"\",\n"]], T],
  ["ب", "cash is not said to be in his custody", [[DF, CUSTODY,
    "  const custody = owner ? \"✅ سُجّل في عهدة المحصّل\" : \"✅\";"]], T],
  ["ب", "Baraa's own cash is said to be «في عهدتك»", [[DF, CUSTODY,
    "  const custody = false ? \"✅ سُجّل في عهدة المحصّل\" : \"✅ في عهدتك\";"]], T],
  // («a transfer is said to be in his custody» left with § 58 ب: «تحويل» is a notice, never a payment of the form —
  //  its line is checked in scripts/mutation/s58-20261005-transfers-mutations.mjs)
  ["ب", "a part payment does not name what stays due", [[DF,
    "    case \"part\": return `${took(p.method, p.amount)} — الباقي ${money(p.rest)} ر.س مستحق`;", "    case \"part\": return took(p.method, p.amount);"]], T],
  ["ب", "«لم يدفع» does not name the amount due", [[DF,
    "    case \"unpaid\": return `${PAY_METHODS.unpaid}: ${money(inv?.total ?? 0)} ر.س مستحق`;", "    case \"unpaid\": return PAY_METHODS.unpaid;"]], T],
  ["ب", "he is not told that no invoice came out", [[DF,
    "    case \"no_invoice\": return `⚠️ لم تصدر فاتورة الآن، فلم يُسجَّل دفع (${reported(e)}).${owner ? \"\" : \" وصل براء ما بلّغته.\"}`;", "    case \"no_invoice\": return \"\";"]], T],
  ["ب", "Baraa is told of a delivery in full, paid in full", [[DF,
    "  return lines.length ? [`📦 تسليم الطلب #${rec.orderId} — ${rec.customer} (${rec.who.name})`, ...lines].join(\"\\n\") : \"\";", "  return [`📦 تسليم الطلب #${rec.orderId} — ${rec.customer} (${rec.who.name})`, ...lines].join(\"\\n\");"]], T],
  ["ب", "Baraa is not told of anything", [[DF,
    "    if (forOwner) await sendOwnerMessage(env, forOwner, T.OWNER_TEAM_NOTE);", "    if (false) await sendOwnerMessage(env, forOwner, T.OWNER_TEAM_NOTE);"]], T],
  ["ب", "Baraa gets the line-group of his own delivery", [[DF,
    "    const forOwner = owner ? \"\" : deliveryOwnerText(rec, e, inv, paid);", "    const forOwner = deliveryOwnerText(rec, e, inv, paid);"]], T],
  ["ب", "Baraa is not told of a shortfall", [[DF,
    "    ...e.entries.filter((x) => x.short > 0).map((x) => (x.delivered > 0\n      ? `• ناقص:", "    ...e.entries.filter(() => false).map((x) => (x.delivered > 0\n      ? `• ناقص:"]], T],
  ["ب", "Baraa is not told of an unpaid invoice", [[DF,
    "    : p.kind === \"unpaid\" ? `• ${PAY_METHODS.unpaid}: ${money(inv?.total ?? 0)} ر.س مستحق${of}`", "    : p.kind === \"unpaid\" ? \"\""]], T],
  ["ب", "Baraa is not told of a part payment as one", [[DF,
    "      : p.kind === \"part\" ? `• دفع جزئي:", "      : false ? `• دفع جزئي:"]], T],
  ["ب", "Baraa is not told of an amount above the invoice as one", [[DF,
    "        : p.kind === \"over\" ? `• بلّغ", "        : false ? `• بلّغ"]], T],
  ["ب", "Baraa's line loses what was reported when no invoice came out", [[DF,
    "            : `• لم تصدر فاتورة، فلم يُسجَّل دفع. بلّغ: ${reported(e)}`;", "            : `• لم تصدر فاتورة، فلم يُسجَّل دفع.`;"]], T],
  ["ب", "Baraa is not told of a note alone", [[DF,
    "    e.note ? `• ملاحظة: ${e.note}` : \"\",\n  ].filter(Boolean);\n  return lines.length", "    \"\",\n  ].filter(Boolean);\n  return lines.length"]], T],
  // ---------------------------------------------------------------- the trial
  ["ب", "the trial's reply is taken as a real one", [[DF,
    "  if (rec.test) {\n    await say(problems.length", "  if (false) {\n    await say(problems.length"]], T],
  ["ب","the trial looks at the order's state (a delivered order shows nothing)", [[DF,
    "  if (!opts.test) {\n    const problem = await orderDeliveryProblem(env, orderId);", "  if (true) {\n    const problem = await orderDeliveryProblem(env, orderId);"]], T],
  ["ب", "the trial goes twice a day", [[DF,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n  try {\n    let orderId", "  try {\n    let orderId"]], T],
  ["ب", "the trial is built from a simulation order while a real one has lines (no filter on the first pass)", [[DF,
    "        domain: [[SIM_FIELD, sim ? \"=\" : \"!=\", true], [\"x_line_ids\", \"!=\", false]], fields: [\"id\"]", "        domain: [[\"x_line_ids\", \"!=\", false]], fields: [\"id\"]"]], T],
  ["ب", "the trial shows a simulation order before a real one", [[DF,
    "    for (const sim of [false, true]) {", "    for (const sim of [true, false]) {"]], T],
  ["ب", "the trial never falls back to an order marked as a simulation (a tenant with no real order gets none)", [[DF,
    "    for (const sim of [false, true]) {", "    for (const sim of [false]) {"]], T],
  ["ب", "the trial is built from an order without a line", [[DF,
    "        domain: [[SIM_FIELD, sim ? \"=\" : \"!=\", true], [\"x_line_ids\", \"!=\", false]], fields: [\"id\"]", "        domain: [[SIM_FIELD, sim ? \"=\" : \"!=\", true]], fields: [\"id\"]"], [DF,
    "        if (b?.lines.length) { orderId = o.id; built = b; break; }", "        if (b) { orderId = o.id; built = b; break; }"]], T],
  ["ب", "the trial reads the orders with his window closed", [[DF,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n  const claim = await claimButton(env, `dform_test:", "  const claim = await claimButton(env, `dform_test:"]], T],
  ["ب", "the trial runs without an owner's number", [[DF,
    "  if (!owner) return { sent: false, reason: \"no_owner\" };\n  if (!(await readWindow(env, owner, now)).open)", "  if (!(await readWindow(env, owner, now)).open)"]], T],
  ["ب", "the day's trial is used up when there was no order to show", [[DF,
    "    if (!built) { await releaseButton(env, claim); return { sent: false, reason: \"no_order\" }; }", "    if (!built) return { sent: false, reason: \"no_order\" };"]], T],
  ["ب", "the trial's form is not marked «🧪 تجربة» in its heading", [[DF,
    "  cut(`${test ? `${DELIVERY_TEST_MARK} — ` : \"\"}طلب #", "  cut(`${false ? `${DELIVERY_TEST_MARK} — ` : \"\"}طلب #"]], T],
  ["ب", "the trial's message is not marked «🧪 تجربة»", [[DF,
    "    `${test ? `${DELIVERY_TEST_MARK} — ` : \"\"}📦 تسليم الطلب #", "    `${false ? `${DELIVERY_TEST_MARK} — ` : \"\"}📦 تسليم الطلب #"]], T],
  ["ب", "the trial goes under Baraa's ordinary purpose", [[DF,
    "  (test ? DELIVERY_FORM_TEST_PURPOSE : isOwnerRecipient", "  (false ? DELIVERY_FORM_TEST_PURPOSE : isOwnerRecipient"]], T],
  ["ب", "the trial's answer does not say that nothing was recorded", [[DF,
    "    TEST_TAIL,\n  ].filter(Boolean).join(\"\\n\");\n}\n\n/**\n * ONE delivery form", "  ].filter(Boolean).join(\"\\n\");\n}\n\n/**\n * ONE delivery form"]], T],
  ["ب", "the trial's hook takes any token", [[IX,
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/delivery-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/delivery-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {"]], T],
  // ---------------------------------------------------------------- the routes
  ["ب", "the form's reply goes to the price form's handler", [[IX,
    "        } else if ((await import(\"./delivery-form\")).isDeliveryFormToken(msg.flow.token ?? \"\")) {", "        } else if (false) {"]], T],
  ["ب", "Baraa's tap on «📦 سلّم وحصّل» is ignored (as every other button of his)", [[IX,
    "        } else if ((msg.type === \"interactive\" || msg.type === \"button\") && /^dlv_\\d+$/.test(msg.buttonId ?? \"\")) {", "        } else if (false) {"]], T],
  ["ب", "Baraa's tap is answered by nothing when no form went", [[IX,
    "          if (reply.text) await sendText(env, msg.from, reply.text, { ctx, purpose: \"owner_alert\" });\n        } else if (((msg.type === \"interactive\" || msg.type === \"button\") && /^delivered_\\d+$/", "        } else if (((msg.type === \"interactive\" || msg.type === \"button\") && /^delivered_\\d+$/"]], T],
  ["ب", "the team's tap on «📦 سلّم وحصّل» is an old button", [[RT,
    "    if (mForm) {\n      await logMessageAnalysis(env, {", "    if (false) {\n      await logMessageAnalysis(env, {"]], T],
  // ---------------------------------------------------------------- Odoo
  ["ب", "the Odoo script's reasons miss «رفضه العميل»", [[OD,
    "[\"short\", \"ناقص\"], [\"refused\", \"رفضه العميل\"]];", "[\"short\", \"ناقص\"]];"]], T],
  ["ب", "the Odoo script creates another field than the one the worker writes", [[OD,
    "export const RETURN_QTY_FIELD = \"x_return_qty\";", "export const RETURN_QTY_FIELD = \"x_returned_qty\";"]], T],
  ["ب", "the columns are added to a form that does not list its lines", [[OD,
    "  if (!body) return null;", "  if (!body) return \"list\";"]], T],
  ["ب", "the columns are added to a lines' list without «الكمية»", [[OD,
    "  return new RegExp(`<field[^>]*\\\\bname=\"${QTY_FIELD}\"`).test(body[0]) ? body[1] : null;", "  return body[1];"]], T],
  ["ب", "the columns go before «الكمية»", [[OD,
    "/field[@name='${QTY_FIELD}']\" position=\"after\">", "/field[@name='${QTY_FIELD}']\" position=\"before\">"]], T],
  ["ب", "the tests' gate does not load the § 55 fixture (the three fields unknown)", [[KIT,
    "  \"fixtures-odoo-fields-20261005-s55.json\",   // § 55:", "  // § 55:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s56.json\",   // § 56:", "  // § 56:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s57.json\",   // § 57:", "  // § 57:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s58.json\",   // § 58:", "  // § 58:"]], T],
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
writeFileSync(new URL("../artifacts/s55-20261005-delivery-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
