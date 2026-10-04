// Mutation check for § 53 ج / د (2026-10-04) — the customer's order form and registration form: each
// mutation disables ONE guard, runs tests/s53-forms.test.mts, and must make it fail. The source is
// restored in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s53-20261004-forms-mutations.mjs [ج|د …]     (no argument: every part)
//
// Out: scripts/artifacts/s53-20261004-forms-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s53-forms.test.mts";
const OF = "src/order-form.ts";
const IX = "src/index.ts";
const RT = "src/router.ts";
const PR = "src/prices.ts";
const GW = "src/wa-gateway.ts";
const LIB = "scripts/lib/s53-flows.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ج the items
  ["ج", "a line left out of the publication is an item of the form", [[OF,
    "[\"x_excluded\", \"=\", false], [\"x_sale_price\", \">\", 0], [\"x_status\", \"in\", [\"auto\", \"manual\"]]],", "[\"x_sale_price\", \">\", 0]],"]], T],
  ["ج", "a line with no sale price is an item of the form", [[OF,
    "[\"x_excluded\", \"=\", false], [\"x_sale_price\", \">\", 0], [\"x_status\", \"in\", [\"auto\", \"manual\"]]],", "[\"x_excluded\", \"=\", false], [\"x_status\", \"in\", [\"auto\", \"manual\", \"exception\"]]],"], [OF,
    "})).filter((l) => l.productId > 0 && l.packagingId > 0 && l.price > 0);", "})).filter((l) => l.productId > 0 && l.packagingId > 0);"]], T],
  ["ج", "the sixteenth item of a category slides to the next page", [[OF,
    "const items = groups.flatMap((g, k) => g.items.slice(0, ORDER_FLOW_PAGE_SLOTS).map((it, j) => {", "const items = groups.flatMap((g, k) => g.items.map((it, j) => {"]], T],
  ["ج", "the hint does not carry the price", [[OF,
    "hint: cut(`${k ? `${k} · ` : \"\"}السعر ${money(price)} ر.س${vat ? \" شامل الضريبة\" : \"\"}`, ORDER_HINT_MAX),", "hint: cut(k || \"-\", ORDER_HINT_MAX),"]], T],
  ["ج", "the hint does not say «شامل الضريبة»", [[OF,
    "ر.س${vat ? \" شامل الضريبة\" : \"\"}`, ORDER_HINT_MAX),", "ر.س`, ORDER_HINT_MAX),"]], T],
  ["ج", "the hint does not carry the packaging", [[OF,
    "hint: cut(`${k ? `${k} · ` : \"\"}السعر", "hint: cut(`السعر"]], T],
  ["ج", "the label is the name with its packaging", [[OF,
    "    label: cut(clean(product), ORDER_LABEL_MAX),", "    label: cut(`${clean(product)} — ${k}`, ORDER_LABEL_MAX),"]], T],
  ["ج", "a long name is not cut to Meta's twenty characters", [[OF,
    "    label: cut(clean(product), ORDER_LABEL_MAX),", "    label: clean(product),"]], T],
  ["ج", "the price note is not above the fields", [[OF,
    "const data = orderFormData(PRICE_NOTE, deliveryLine(", "const data = orderFormData(\"-\", deliveryLine("]], T],
  ["ج", "the delivery day is today's, whatever the hour", [[OF,
    "deliveryLine(nextOrderingDate(new Date(now)), new Date(now))", "deliveryLine(riyadhDateKey(new Date(now)), new Date(now))"]], T],
  ["ج", "«التالي» on the last page that has items", [[OF,
    "    if (k < ORDER_FLOW_PAGES) data[`m${k}`] = k < pages.length;", "    if (k < ORDER_FLOW_PAGES) data[`m${k}`] = k <= pages.length;"]], T],
  ["ج", "the form opens with no quantity on «تعديل»", [[OF,
    "    data[`i${n}`] = it && init[n] > 0 ? qty(init[n]) : \"\";", "    data[`i${n}`] = \"\";"]], T],
  ["ج", "the overflow alert goes with every form", [[OF,
    "  const claim = await claimButton(env, `oform_over:${day}`, DAY_TTL);\n  if (!claim.claimed) return;", "  const claim = await claimButton(env, `oform_over:${day}:${Math.random()}`, DAY_TTL);\n  if (!claim.claimed) return;"]], T],
  // ---------------------------------------------------------------- ج the send
  ["ج", "the form goes with no valid list", [[OF,
    "  const list = opts.list ?? (await validPriceList(env, now));\n  if (!list) return { sent: false, reason: \"no_list\" };", "  const list = opts.list ?? (await validPriceList(env, now)) ?? { dayId: 0, day: riyadhDateKey(new Date(now)), publishedAtMs: null, validUntilMs: now };"]], T],
  ["ج", "a published list with no item still sends a form", [[OF,
    "  if (!items.length) return { sent: false, reason: \"no_items\" };\n  const rec: OrderFormRecord", "  const rec: OrderFormRecord"]], T],
  ["ج", "the form is held for a number outside its window", [[OF,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const list = opts.list", "  const list = opts.list"], [OF,
    "    noHold: true,\n    noHoldReason: \"نموذج الطلب يُرسل داخل نافذة 24 ساعة فقط\",\n", ""]], T],
  ["ج", "the team gets the form", [[OF,
    "    return memberByNumber(await loadRoster(env), digits) ? \"team\" : \"\";", "    return \"\";"]], T],
  ["ج", "Baraa gets the customers' form", [[OF,
    "  if (isOwnerRecipient(env, digits)) return \"owner\";\n", ""]], T],
  ["ج", "a roster that cannot be read lets the form go", [[OF,
    "    return \"unverified\";", "    return \"\";"]], T],
  ["ج", "the recipient is not checked at all", [[OF,
    "    const problem = await orderFormRecipientProblem(env, to);\n    if (problem) return { sent: false, reason: problem };", "    const problem = \"\";\n    if (problem) return { sent: false, reason: problem };"]], T],
  ["ج", "the form goes under a purpose the price guard does not watch", [[OF,
    "    purpose: opts.test ? ORDER_FORM_TEST_PURPOSE : ORDER_FORM_PURPOSE,\n    to,\n    content: orderFormSession(", "    purpose: opts.test ? ORDER_FORM_TEST_PURPOSE : \"bot_reply\",\n    to,\n    content: orderFormSession("]], T],
  ["ج", "a refused form leaves its token behind", [[OF,
    "    try { await env.MSG_DEDUP.delete(orderFormKey(rec.token)); } catch { /* expires on its own */ }\n", ""]], T],
  ["ج", "the message opens another Flow", [[OF,
    "            flow_id: ORDER_FLOW_ID,", "            flow_id: \"1123704886881420\","]], T],
  ["ج", "the trial's purpose may reach any number", [[GW,
    "new Set([\"price_flow_test\", \"order_flow_test\", \"owner_alert\",", "new Set([\"price_flow_test\", \"owner_alert\","]], T],
  // ---------------------------------------------------------------- ج when it goes
  ["ج", "«اطلب» is answered by the bot, not the form", [[IX,
    "        if (wantsOrderForm(msg.text) && (await answerOrderFormAsk(", "        if (false && (await answerOrderFormAsk("]], T],
  ["ج", "«اطلب» with no valid list gets no answer of its own", [[OF,
    "  if (r.reason !== \"no_list\" && r.reason !== \"no_items\") return false;\n  await sendViaGateway(env, { purpose: \"bot_reply\", to: who.whatsapp, content: textContent(ORDER_FORM_NO_LIST_TEXT), ctx });\n  return true;", "  return false;"]], T],
  ["ج", "any message that starts with «اطلب» asks for the form", [[OF,
    "(?:اطلب|بطلب)(?: الان| الحين)?$/.test(t);", "(?:اطلب|بطلب)/.test(t);"]], T],
  ["ج", "«أبي أطلب» is not read as asking for the form", [[OF,
    "  return /^(?:(?:ابي|ابغي|ابغا|بغيت|ودي|حاب|اريد) )?(?:اطلب|بطلب)", "  return /^(?:اطلب|بطلب)"]], T],
  ["ج", "the welcome's «أبغى أطلب» button answers in text", [[RT,
    "        if (await answerOrderFormAsk(env, { partnerId: partner.id, name: partner.name || \"\", whatsapp: String(partner.x_whatsapp_number) })) return { text: \"\" };", "        void answerOrderFormAsk;"]], T],
  ["ج", "no form after a customer's first order message", [[RT,
    "    ...(list ? { orderForm: { partnerId: partner.id, name: partner.name || \"\", body: ORDER_FORM_FOLLOW_TEXT } } : {}),\n", ""]], T],
  ["ج", "the reply's form is not sent", [[IX,
    "  if (reply.orderForm) {\n", "  if (false) {\n"]], T],
  ["ج", "a form after every order message of the day", [[OF,
    "    if (o.auto && (await orderFormAutoSent(env, list.day, who.whatsapp))) return { sent: false, reason: \"sent_before\" };\n", ""]], T],
  ["ج", "an automatic form is not remembered", [[OF,
    "    if (r.sent && o.auto) await markAutoSent(env, list.day, who.whatsapp);\n", ""]], T],
  ["ج", "the form after a text order opens empty (his lines not in it)", [[OF,
    "...(open ? { orderId: open.orderId, init: open.init } : {}) });\n    if (r.sent && o.auto)", "});\n    if (r.sent && o.auto)"]], T],
  ["ج", "no form with the 06:00 prices", [[PR,
    "      if (first === \"session\") inWindow.push({ partnerId: r.id, name: r.name, whatsapp: r.phone });\n", ""]], T],
  ["ج", "the 06:00 form is not remembered: the first order message sends a second", [[OF,
    "        if (out.sent) { sent++; await markAutoSent(env, list.day, r.whatsapp); }", "        if (out.sent) { sent++; }"]], T],
  // ---------------------------------------------------------------- ج the reply
  ["ج", "an order form's reply is read as a price form's", [[IX,
    "        if (isOrderFormToken(msg.flow.token ?? \"\")) {", "        if (false) {"]], T],
  ["ج", "a reply from another number is taken", [[OF,
    "  if (!rec || rec.to !== to) {\n    console.warn(`[order-form] reply with no token of this number", "  if (!rec) {\n    console.warn(`[order-form] reply with no token of this number"]], T],
  ["ج", "a reply after the list expired is written at the old price", [[OF,
    "  const list = await listOfDayIfValid(env, rec.listDay, nowMs);\n  if (!list) {", "  const list = await listOfDayIfValid(env, rec.listDay, nowMs);\n  if (false) {"]], T],
  ["ج", "no new form after an expired one", [[OF,
    "    const out = fresh ? await sendOrderForm(env, who, { now: nowMs, list: fresh, body: ORDER_FORM_EXPIRED_TEXT, ctx }).catch(() => ({ sent: false })) : { sent: false };", "    const out = { sent: false };"]], T],
  ["ج", "a token is read twice", [[OF,
    "  if (!claim.claimed || rec.usedAt) {\n    console.warn(`[order-form] repeated token", "  if (false) {\n    console.warn(`[order-form] repeated token"]], T],
  ["ج", "a form with no quantity uses its token up", [[OF,
    "      // nothing asked for: the token stays usable\n      await releaseButton(env, claim);", "      // nothing asked for: the token stays usable"]], T],
  ["ج", "a form with no quantity still makes an order", [[OF,
    "    if (!entries.wanted.length && !entries.empty.some((it) => (rec.init?.[it.slot] ?? 0) > 0)) {", "    if (false) {"]], T],
  ["ج", "the quantities are read from the client's keys, not the token's slots", [[OF,
    "  for (const item of rec.items) {\n    const v = parseOrderQty(values[`q${item.slot}`]);", "  for (const item of [...rec.items, ...(values.q9 ? [{ ...rec.items[0], slot: 9, productId: Number(values.productId) || 2, packagingId: 21 }] : [])]) {\n    const v = parseOrderQty(values[`q${item.slot}`]);"]], T],
  ["ج", "«0» is a quantity that is not above zero (named as wrong)", [[OF,
    "  if (n === 0) return null; // «0» = none of it\n", ""]], T],
  ["ج", "a negative or a huge quantity is taken", [[OF,
    "  return n > 0 && n <= ORDER_QTY_MAX ? n : \"invalid\";", "  return n;"]], T],
  ["ج", "Arabic digits are not read", [[OF,
    "    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))\n    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))\n    .replace(/٫/g, \".\")\n    .replace(/\\s+/g, \"\");\n  if (s === \"\") return null;\n  if (/^\\d+,\\d{1,2}$/.test(s)) s = s.replace(\",\", \".\");\n  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";\n  const n = Math.round(Number(s) * 100) / 100;\n  if (n === 0)", "    .replace(/٫/g, \".\")\n    .replace(/\\s+/g, \"\");\n  if (s === \"\") return null;\n  if (/^\\d+,\\d{1,2}$/.test(s)) s = s.replace(\",\", \".\");\n  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";\n  const n = Math.round(Number(s) * 100) / 100;\n  if (n === 0)"]], T],
  ["ج", "the trial's reply creates an order", [[OF,
    "  if (rec.test) {\n    const total", "  if (false) {\n    const total"]], T],
  ["ج", "the trial is sent every time it is asked", [[OF,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n  try {\n    let list", "  try {\n    let list"]], T],
  ["ج", "the trial is not marked «🧪 تجربة»", [[OF,
    "  const mark = opts.test ? `${ORDER_TEST_MARK} — ` : \"\";", "  const mark = \"\";"]], T],
  // ---------------------------------------------------------------- ج the order's lines
  ["ج", "a quantity changed in the form adds a second line", [[OF,
    "    if (!line) add.push(", "    if (true) add.push("]], T],
  ["ج", "a quantity changed in the form is not written", [[OF,
    "    else if (Math.abs(line.quantity - w.quantity) > 0.0001) await call<boolean>(env, \"x_daily_order_line\", \"write\", { ids: [line.id], vals: { x_quantity: w.quantity } });", "    else if (false) await call<boolean>(env, \"x_daily_order_line\", \"write\", { ids: [line.id], vals: { x_quantity: w.quantity } });"]], T],
  ["ج", "a field emptied in «تعديل» keeps its line", [[OF,
    "  const removed = entries.empty.filter((it) => (rec.init?.[it.slot] ?? 0) > 0 && lineOf(it).length > 0);", "  const removed = entries.empty.filter(() => false);"]], T],
  ["ج", "an order of two lines for one item is set in place (the second stays)", [[OF,
    "  const twice = entries.wanted.some((w) => lineOf(w.item).length > 1);", "  const twice = false;"]], T],
  ["ج", "the order the form closes is left open beside the new one", [[OF,
    "    await updateOrderState(env, orderId, \"cancelled\");\n    return { orderId: fresh, replaced: orderId };", "    return { orderId: fresh, replaced: orderId };"]], T],
  ["ج", "an order confirmed meanwhile is edited by a late form", [[OF,
    "    else if (o.state !== \"draft\" && o.state !== \"waiting_confirmation\") return { closed: orderId };", "    else if (false) return { closed: orderId };"]], T],
  ["ج", "the quotation after the form has no buttons", [[OF,
    "      await sendViaGateway(env, { purpose: QUOTATION_PURPOSE, to, content: buttonsContent(body, quotationButtons(orderId)), ctx });", "      await sendViaGateway(env, { purpose: QUOTATION_PURPOSE, to, content: textContent(body), ctx });"]], T],
  ["ج", "the quotation after the form has no total", [[OF,
    "        `المجموع: ${money(total)} ر.س`,\n        \"\",", "        \"\","]], T],
  ["ج", "the quotation after the form leaves out the price note", [[OF,
    "...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE, \"راجع الأصناف واختر:\"].filter(Boolean),\n      ].join(\"\\n\");\n      await sendViaGateway(env, { purpose: QUOTATION_PURPOSE", "...[q.locationLine, q.deliveryLine, vatNote(now), \"راجع الأصناف واختر:\"].filter(Boolean),\n      ].join(\"\\n\");\n      await sendViaGateway(env, { purpose: QUOTATION_PURPOSE"]], T],
  ["ج", "the order is not quoted after the form (lines only)", [[OF,
    "    const q = await quoteOrder(env, { orderId, partnerId: rec.partnerId, now });\n    const notes", "    const q: any = { kind: \"need_location\" };\n    const notes"]], T],
  ["ج", "he is not told which order was closed", [[OF,
    "      applied.replaced ? `عدّلنا طلبك: الطلب رقم #${applied.replaced} أُغلق، وهذا طلبك رقم #${orderId}.` : \"\",", "      \"\","]], T],
  // ---------------------------------------------------------------- ج «تعديل»
  ["ج", "«تعديل» under the form's quotation answers in text", [[RT,
    "    if (await isFormOrder(env, orderId)) {", "    if (false) {"]], T],
  ["ج", "«تعديل» under a text quotation opens the form", [[OF,
    "  if (!(await isFormOrder(env, orderId))) return false;\n", ""], [RT,
    "    if (await isFormOrder(env, orderId)) {", "    if (true) {"]], T],
  ["ج", "an order the form made is not remembered as the form's", [[OF,
    "    try { await env.MSG_DEDUP.put(formOrderKey(orderId), rec.listDay, { expirationTtl: 3 * 24 * 3600 }); } catch { /* «تعديل» then answers in text */ }\n", ""]], T],
  ["ج", "«تعديل» opens the form under «اطلب الآن»", [[OF,
    "body: orderFormEditText(orderId), cta: ORDER_FORM_EDIT_CTA, ctx });", "body: orderFormEditText(orderId), ctx });"]], T],
  // ---------------------------------------------------------------- ج the Flow's JSON
  ["ج", "the Flow has three pages", [[LIB,
    "export const ORDER_PAGES = [\"ORDER_A\", \"ORDER_B\", \"ORDER_C\", \"ORDER_D\"];", "export const ORDER_PAGES = [\"ORDER_A\", \"ORDER_B\", \"ORDER_C\"];"]], T],
  ["ج", "the Flow's quantity is required", [[LIB,
    "          name: `q${n}`,\n          label: oref(k, `l${n}`),\n          \"input-type\": \"number\",\n          required: false,", "          name: `q${n}`,\n          label: oref(k, `l${n}`),\n          \"input-type\": \"number\",\n          required: true,"]], T],
  ["ج", "the Flow shows no delivery day", [[LIB,
    "        { type: \"TextBody\", text: oref(k, \"del\") },\n", ""]], T],
  ["ج", "the Flow's routes are left to Meta", [[LIB,
    "  return { version: FLOW_JSON_VERSION, routing_model: orderRoutingModel(), screens: orderPages().map(({ k }) => orderScreen(k)) };", "  return { version: FLOW_JSON_VERSION, screens: orderPages().map(({ k }) => orderScreen(k)) };"]], T],
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
writeFileSync(new URL("../artifacts/s53-20261004-forms-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
