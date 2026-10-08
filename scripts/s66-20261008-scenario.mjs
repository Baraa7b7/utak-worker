// § 66 (2026-10-08) — the whole road, LIVE, on a request and a customer flagged «محاكاة»:
//
//   issue → «✅ العميل وافق» → the confirmed quantities → «📦 حوّل لطلب» → (pressed again: refused)
//
// through Odoo's own buttons (their server actions are run through the API: Odoo calls the PROD worker's hook, as
// a press on the screen does). What is made is flagged «محاكاة» — the request, its customer, the order and its
// lines — so every list, total and invoice of the day leaves it out, and NO message goes to anyone but Baraa's
// own number: what the customer would read reaches him marked «🧪 محاكاة».
//
//   1  a customer «🧪 عميل محاكاة § 66» (no number) and a request of three lines, one unit each, the prices before VAT
//   2  «إصدار»: a simulation is never issued (no number, no sale order): its state is set «صدر العرض» here, and the
//      quotation's page is fetched as «👁️ معاينة PDF» serves it (a ticket, then the worker's signed link)
//   3  «✅ العميل وافق» → the acceptance on the request (the delivery date, the customer's terms)
//   4  the confirmed quantities (40, 12, and 0 = out) → «إجمالي الطلب المؤكد» follows them
//   5  «📦 حوّل لطلب» → the order of the delivery's eve, its lines «سعر خاص»; the request «مقبول — تحوّل لطلب»
//   6  pressed again → «سبق تحويله»: one order
//   7  who was written to since the start: Baraa's number alone
// The purchase list, the delivery form and the invoice of this order are read by scripts/s66-20261008-scenario-preview.mts
// (the worker's own readers, nothing written): the system makes no list and no invoice for a simulation, by its rule.
//
//   node scripts/s66-20261008-scenario.mjs                      dry-run: the plan, nothing written, nothing pressed
//   node scripts/s66-20261008-scenario.mjs --apply              runs it once (the rollback file first)
//   node scripts/s66-20261008-scenario.mjs --check              read-only: what the run left in Odoo, checked again
//   node scripts/s66-20261008-scenario.mjs --rollback [--apply] the request closed, the order cancelled, the customer
//                                                               archived (nothing is deleted)
// Rollback file: scripts/artifacts/s66-20261008-scenario-rollback.json. SQ-0002 and S00016 are never read or written.
import { writeFileSync } from "node:fs";
import { APPLY, ROLLBACK, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";
import * as L from "./lib/s66-odoo.mjs";

const PREVIEW = `https://${L.PROD_HOST}/preview/`;
const RB = new URL("./artifacts/s66-20261008-scenario-rollback.json", import.meta.url);
const { rb, save } = rollbackFile(RB, "scripts/s66-20261008-scenario.mjs");
const c = rb.created;
const pause = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const CUSTOMER = "🧪 عميل محاكاة § 66";
/** [the item's reference, «التعبئة», the purchase price, the final price before VAT, the confirmed quantity] */
const LINES = [["UTAK-FRT-003", "18 كيلو", 105, 121.3, "40"], ["UTAK-FRT-002", "14 كيلو -مخمر", 55, 63.7, "12"], ["UTAK-FRT-002", "14 كيلو -غير مخمر", 60, 69.35, "0"]];
const AHMED = 30;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const grossOf = (net) => round2(net * 1.15);
const utc = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const actionId = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id"], limit: 1 }))[0]?.id;
/** A press of a button of the request's form: its server action, run as the screen runs it. */
const press = async (name, id) => call("ir.actions.server", "run", { ids: [await actionId(name)], context: { active_model: L.QUOTE_MODEL, active_id: id, active_ids: [id] } });
const quoteRow = async (id) => (await call(L.QUOTE_MODEL, "search_read", { domain: [["id", "=", id]], fields: ["id", "x_name", "x_state", "x_partner_id", "x_utak_simulation", "x_valid_until", "x_last_result", "x_sale_order_id", "x_quotation_number", ...L.QUOTE_FIELDS.map((d) => d.name)], context: ALL }))[0];
const lineRows = async (id) => call(L.LINE_MODEL, "search_read", { domain: [["x_quote_id", "=", id]], fields: ["id", "x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_final_net", "x_final_price", "x_confirmed_qty"], order: "x_sequence asc, id asc" });
/** Wait for the worker (the hook answers 202 and works a moment later): until `done(row)` or ~25 seconds. */
async function until(id, done) {
  for (let i = 0; i < 12; i++) {
    await pause(2000);
    const row = await quoteRow(id);
    if (done(row)) return row;
  }
  return quoteRow(id);
}

if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  if (c.quote) {
    const q = await quoteRow(c.quote);
    if (q && q.x_state !== "closed") { log(`✎ request #${c.quote} ${q.x_name}: closed`); if (APPLY) await call(L.QUOTE_MODEL, "write", { ids: [c.quote], vals: { x_state: "closed" } }); } else log(`= request #${c.quote}: ${q ? "closed" : "not there"}`);
    const orders = await call(L.ORDER_MODEL, "search_read", { domain: [["x_special_quote_id", "=", c.quote], ["x_utak_simulation", "=", true]], fields: ["id", "x_state"] });
    for (const o of orders) {
      if (o.x_state !== "cancelled") { log(`✎ order #${o.id}: cancelled`); if (APPLY) await call(L.ORDER_MODEL, "write", { ids: [o.id], vals: { x_state: "cancelled" } }); } else log(`= order #${o.id}: cancelled`);
    }
  }
  if (c.partner) { log(`✎ customer #${c.partner}: archived`); if (APPLY) await call("res.partner", "write", { ids: [c.partner], vals: { active: false } }); }
  log(APPLY ? "rollback done (nothing deleted)" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

const { check, done } = checker();
if (process.argv.includes("--check")) {
  log("CHECK — read-only: what the scenario left in Odoo");
  if (!c.quote || !c.order) { check("the scenario has run", false); done(); }
  const q = await quoteRow(c.quote);
  const [o] = await call(L.ORDER_MODEL, "search_read", { domain: [["id", "=", c.order]], fields: ["id", "x_state", "x_order_date", "x_customer_id", "x_utak_simulation", "x_total_amount", "x_delivery_notes", "x_sale_order_id", "x_special_quote_id"], context: ALL });
  const ol = await call(L.ORDER_LINE_MODEL, "search_read", { domain: [["x_order_id", "=", c.order]], fields: ["id", "x_quantity", "x_unit_price", "x_price_unit_manual", "x_status", "x_utak_simulation", ...L.ORDER_LINE_FIELDS.map((d) => d.name)], order: "id asc" });
  const total = round2(LINES.reduce((s, l) => s + round2(Number(l[4]) * grossOf(l[3])), 0));
  check(`the request #${q.id} ${q.x_name}: «مقبول — تحوّل لطلب», pointing at the order #${o?.id}, its confirmed total ${q.x_confirmed_total}`, q.x_state === "accepted" && q.x_daily_order_id?.[0] === o?.id && !!q.x_converted_at && Math.abs(q.x_confirmed_total - total) < 0.005 && q.x_utak_simulation === true && !q.x_sale_order_id, JSON.stringify([q.x_state, q.x_daily_order_id]));
  check(`«آخر نتيجة»: ${String(q.x_last_result)}`, String(q.x_last_result).startsWith(`📦 تحوّل إلى الطلب #${o?.id}: 2 صنف`) && String(q.x_last_result).includes(`الإجمالي ${total} ر.س`) && String(q.x_last_result).includes("خارج الطلب (كميتها 0)") && String(q.x_last_result).includes("طلب كبير 52 كرتون") && String(q.x_last_result).includes("محاكاة: التأكيد وصلك أنت، ولا أمر بيع ولا رسالة للعميل"));
  check(`the order #${o?.id}: a simulation, ${o?.x_state}, of ${o?.x_order_date} (the eve of ${q.x_delivery_date}), this request's, no sale order, ${o?.x_total_amount}`, o?.x_utak_simulation === true && o.x_special_quote_id?.[0] === q.id && !o.x_sale_order_id && Math.abs(o.x_total_amount - total) < 0.005 && o.x_order_date === new Date(Date.parse(`${q.x_delivery_date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10));
  check("its two lines: «سعر خاص», the confirmed quantities at the VAT-inclusive finals (price and manual price), «التعبئة», the purchase price and Ahmed", ol.length === 2 && ol.every((l, i) => l.x_special_price === true && l.x_quantity === Number(LINES[i][4]) && l.x_unit_price === grossOf(LINES[i][3]) && l.x_price_unit_manual === l.x_unit_price && l.x_pack_text === LINES[i][1] && l.x_special_purchase === LINES[i][2] && l.x_special_supplier_id?.[0] === AHMED && l.x_utak_simulation === true), JSON.stringify(ol.map((l) => [l.x_quantity, l.x_unit_price, l.x_pack_text])));
  check("ONE order of this request", (await call(L.ORDER_MODEL, "search_count", { domain: [["x_special_quote_id", "=", q.id]], context: ALL })) === 1);
  const msgs = await call("x_wa_message", "search_read", { domain: [["x_direction", "=", "out"], "|", ["x_body", "like", `#${o?.id} `], ["x_body", "like", q.x_name]], fields: ["id", "x_partner_id", "x_body", "x_status", "x_meta_error"], order: "id asc", limit: 50, context: ALL });
  for (const m of msgs) log(`  → #${m.id} ${JSON.stringify(m.x_partner_id)} [${m.x_status}] ${String(m.x_body).replace(/\n/g, " ⏎ ").slice(0, 130)}${m.x_meta_error ? ` — ${String(m.x_meta_error).slice(0, 110)}` : ""}`);
  check(`every message of it is Baraa's own number's (#45), marked «🧪 محاكاة»: ${msgs.length}`, msgs.length >= 2 && msgs.every((m) => m.x_partner_id?.[0] === 45 && String(m.x_body).includes("🧪 محاكاة")));
  check("nothing was written to the simulated customer", (await call("x_wa_message", "search_count", { domain: [["x_partner_id", "=", c.partner]], context: ALL })) === 0);
  done();
}
log(APPLY ? "SCENARIO — apply" : "scenario dry-run (nothing is written or pressed; add --apply)");
const products = await call("product.template", "search_read", { domain: [["default_code", "in", [...new Set(LINES.map((l) => l[0]))]]], fields: ["id", "name", "default_code", "x_is_active_for_sale"], context: ALL });
const pid = (ref) => products.find((p) => p.default_code === ref)?.id;
for (const [ref, unit, buy, net, qty] of LINES) log(`+ line: ${ref} #${pid(ref)} «${unit}» — الشراء ${buy}، النهائي قبل الضريبة ${net} (شامل ${grossOf(net)})، الكمية المؤكدة ${qty}`);
const TOTAL = round2(LINES.reduce((s, l) => s + round2(Number(l[4]) * grossOf(l[3])), 0));
log(`  the confirmed total it must come to: ${TOTAL}`);
if (!APPLY) { log("dry-run: nothing written"); process.exit(0); }
if (LINES.some((l) => !pid(l[0]))) { check("the items of the scenario are in the catalog", false, JSON.stringify(products)); done(); }
save();
const started = Date.now();

// ---- 1: the customer and the request
if (!c.partner) {
  [c.partner] = await call("res.partner", "create", { vals_list: [{ name: CUSTOMER, customer_rank: 1, x_utak_simulation: true, x_pay_terms: "credit", x_contact_class: "customer" }] });
  save();
}
log(`customer #${c.partner} «${CUSTOMER}» (محاكاة، بلا رقم، آجل)`);
await pause();
if (!c.quote) {
  [c.quote] = await call(L.QUOTE_MODEL, "create", { vals_list: [{
    x_partner_id: c.partner, x_state: "draft", x_utak_simulation: true, x_price_mode: "net", x_layout: "auto", x_valid_until: utc(started + 36 * 3600_000), x_note: "سيناريو § 66 — محاكاة",
    x_line_ids: LINES.map(([ref, unit, buy, net], i) => [0, 0, { x_sequence: (i + 1) * 10, x_product_tmpl_id: pid(ref), x_qty: 1, x_unit: unit, x_purchase_price: buy, x_final_net: net, x_obs: JSON.stringify({ purchase: { [AHMED]: { p: buy, n: "أحمد حسان", at: started } }, market: {} }) }]),
  }] });
  save();
}
const id = c.quote;
// the save asked the worker for its numbers (the request's automation): its name, the VAT-inclusive finals
let q = await until(id, (r) => !!r?.x_name);
let lines = await lineRows(id);
check(`1 the request #${id} ${q?.x_name}: a simulation, of the simulated customer, three lines of one unit`, q?.x_utak_simulation === true && q.x_partner_id?.[0] === c.partner && lines.length === 3 && lines.every((l) => l.x_qty === 1), JSON.stringify(q?.x_name));
check("  the worker computed each line's VAT-inclusive final: the price before VAT × 1.15, to the halala", lines.every((l, i) => l.x_final_price === grossOf(LINES[i][3])), JSON.stringify(lines.map((l) => [l.x_final_net, l.x_final_price])));

// ---- 2: «إصدار» (a simulation is never issued: the state by hand, the page as the preview serves it)
if (q.x_state !== "quoted" && q.x_state !== "accepted") { await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_state: "quoted", x_quotation_number: `محاكاة-${q.x_name}`, x_issued_at: utc(Date.now()) } }); await pause(); }
try {
  const ticket = await call("ir.actions.server", "run", { ids: [await actionId("utak.special_quote.preview")], context: { active_model: L.QUOTE_MODEL, active_id: id, active_ids: [id] } });
  check("2 «👁️ معاينة PDF» answers the worker's one-use ticket for it (nothing numbered, no sale order)", ticket?.type === "ir.actions.act_url" && String(ticket.url).startsWith(`${PREVIEW}t/`), JSON.stringify(ticket?.type));
  log("  (the ticket is left unused: it expires in five minutes; the page is opened from the screen)");
} catch (e) {
  check("2 «👁️ معاينة PDF» answers the worker's one-use ticket", false, String(e?.message ?? e).slice(0, 200));
}
q = await quoteRow(id);
check("  the request is «صدر العرض» with no sale order (a simulation records none)", q.x_state === "quoted" && !q.x_sale_order_id);

// ---- 3: «✅ العميل وافق»
await press(L.HOOKS.approve.name, id);
// (the worker writes the acceptance, then its result line: both are waited for)
q = await until(id, (r) => !!r?.x_accepted_at && String(r.x_last_result).includes("سُجّل قبول العميل"));
lines = await lineRows(id);
check(`3 «✅ العميل وافق»: the acceptance on the request — its time, «تاريخ التسليم» ${q.x_delivery_date}, «طريقة الدفع» the customer's (آجل)`, !!q.x_accepted_at && /^\d{4}-\d{2}-\d{2}$/.test(String(q.x_delivery_date)) && q.x_pay_terms === "credit" && q.x_state === "quoted", JSON.stringify([q.x_accepted_at, q.x_delivery_date, q.x_pay_terms]));
check("  a unit-price quotation: no confirmed quantity is written for Baraa", lines.every((l) => !l.x_confirmed_qty) && String(q.x_last_result).includes("اكتب «الكمية المؤكدة» لكل سطر"), String(q.x_last_result).slice(0, 160));
check("  no order yet", (await call(L.ORDER_MODEL, "search_count", { domain: [["x_special_quote_id", "=", id]] })) === 0);

// ---- 4: the confirmed quantities, typed on the lines (one save, as the screen saves them)
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_delivery_note: "محاكاة: البوابة 3 قبل 7 صباحاً", x_line_ids: lines.map((l, i) => [1, l.id, { x_confirmed_qty: LINES[i][4] }]) } });
q = await until(id, (r) => Math.abs((r?.x_confirmed_total ?? 0) - TOTAL) < 0.005);
check(`4 «إجمالي الطلب المؤكد» follows the quantities typed (the line's automation asked the worker): ${q.x_confirmed_total}`, Math.abs(q.x_confirmed_total - TOTAL) < 0.005, `${q.x_confirmed_total} ≠ ${TOTAL}`);

// ---- 5: «📦 حوّل لطلب»
await press(L.HOOKS.convert.name, id);
q = await until(id, (r) => r?.x_state === "accepted" && String(r.x_last_result).startsWith("📦"));
const orders = await call(L.ORDER_MODEL, "search_read", { domain: [["x_special_quote_id", "=", id]], fields: ["id", "x_state", "x_order_date", "x_customer_id", "x_utak_simulation", "x_total_amount", "x_delivery_notes", "x_sale_order_id", "x_created_via", "x_confirmed_at"], context: ALL });
const o = orders[0];
c.order = o?.id; save();
const eve = new Date(Date.parse(`${q.x_delivery_date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
check(`5 «📦 حوّل لطلب»: ONE order #${o?.id} — a simulation, confirmed, of the delivery's eve (${eve}), its total ${o?.x_total_amount}`, orders.length === 1 && o.x_utak_simulation === true && o.x_state === "confirmed" && o.x_order_date === eve && o.x_customer_id?.[0] === c.partner && Math.abs(o.x_total_amount - TOTAL) < 0.005 && !o.x_sale_order_id, JSON.stringify(orders));
const ol = o ? await call(L.ORDER_LINE_MODEL, "search_read", { domain: [["x_order_id", "=", o.id]], fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price", "x_price_unit_manual", "x_status", "x_utak_simulation", ...L.ORDER_LINE_FIELDS.map((d) => d.name)], order: "id asc" }) : [];
check("  its lines: the two confirmed (40, 12) — the one confirmed 0 is out — «سعر خاص», at the VAT-inclusive finals, as price and manual price", ol.length === 2 && ol.every((l, i) => l.x_special_price === true && l.x_quantity === Number(LINES[i][4]) && l.x_unit_price === grossOf(LINES[i][3]) && l.x_price_unit_manual === l.x_unit_price && l.x_utak_simulation === true && l.x_status === "pending"), JSON.stringify(ol.map((l) => [l.x_quantity, l.x_unit_price, l.x_special_price])));
check("  …with the quotation's «التعبئة», its purchase price and the source that gave it (Ahmed), on the item's own packaging", ol.every((l, i) => l.x_pack_text === LINES[i][1] && l.x_special_purchase === LINES[i][2] && l.x_special_supplier_id?.[0] === AHMED && Array.isArray(l.x_packaging_id)), JSON.stringify(ol.map((l) => [l.x_pack_text, l.x_special_purchase, l.x_special_supplier_id, l.x_packaging_id])));
check("  the order's notes: the request, the terms, the delivery note", String(o?.x_delivery_notes).includes(`طلب أسعار خاص ${q.x_name}`) && String(o?.x_delivery_notes).includes("طريقة الدفع: آجل") && String(o?.x_delivery_notes).includes("ملاحظة التسليم: محاكاة: البوابة 3"), String(o?.x_delivery_notes));
check(`  the request: «مقبول — تحوّل لطلب», pointing at the order; «آخر نتيجة»: ${String(q.x_last_result).slice(0, 90)}…`, q.x_state === "accepted" && q.x_daily_order_id?.[0] === o?.id && !!q.x_converted_at && String(q.x_last_result).startsWith(`📦 تحوّل إلى الطلب #${o?.id}`) && String(q.x_last_result).includes("طلب كبير 52 كرتون"), String(q.x_last_result));

// ---- 6: pressed again
await press(L.HOOKS.convert.name, id);
await pause(9000);
q = await quoteRow(id);
check("6 pressed again: still ONE order, the request still «مقبول»", (await call(L.ORDER_MODEL, "search_count", { domain: [["x_special_quote_id", "=", id]], context: ALL })) === 1 && q.x_state === "accepted");

// ---- 7: who was written to since the start
await pause(3000);
const msgs = await call("x_wa_message", "search_read", { domain: [["create_date", ">=", utc(started - 5000)], ["x_direction", "=", "out"]], fields: ["id", "x_partner_id", "x_body", "x_status", "x_kind", "create_date"], order: "id asc", limit: 200, context: ALL });
const mine = msgs.filter((m) => String(m.x_body).includes(`#${o?.id}`) || String(m.x_body).includes(q.x_name));
const owner = (await call("res.partner", "search_read", { domain: [["id", "=", 45]], fields: ["id", "name"], context: ALL }))[0];
for (const m of mine) log(`  → ${JSON.stringify(m.x_partner_id)} [${m.x_status}] ${String(m.x_body).replace(/\n/g, " ⏎ ").slice(0, 150)}`);
check(`7 every message of this scenario went to Baraa's own number (#${owner?.id} ${owner?.name}) alone: ${mine.length} message(s), each marked «🧪 محاكاة»`, mine.length >= 2 && mine.every((m) => m.x_partner_id?.[0] === owner?.id && String(m.x_body).includes("🧪 محاكاة")), JSON.stringify(mine.map((m) => [m.x_partner_id, String(m.x_body).slice(0, 40)])));
check("  …what the customer would read, and «🚚 طلب كبير 52 كرتون: رتّب المركبة»", mine.some((m) => String(m.x_body).includes("ما كان سيصل العميل") && String(m.x_body).includes(`تم تأكيد طلبك رقم #${o?.id}`)) && mine.some((m) => String(m.x_body).includes("🚚 طلب كبير 52 كرتون: رتّب المركبة")));
check("  nothing was written to the simulated customer", !msgs.some((m) => m.x_partner_id?.[0] === c.partner));
log(`request #${id} ${q.x_name} · order #${o?.id} · customer #${c.partner} — left as they are (flagged «محاكاة»); to put them away: --rollback --apply`);
writeFileSync(new URL("./artifacts/s66-20261008-scenario-result.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), quote: id, name: q.x_name, order: o?.id, partner: c.partner, total: TOTAL, deliveryDate: q.x_delivery_date, messages: mine.map((m) => ({ id: m.id, to: m.x_partner_id, status: m.x_status, body: m.x_body })) }, null, 2) + "\n");
done();
