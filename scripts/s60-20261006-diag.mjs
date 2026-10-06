// § 60 (2026-10-06) — read-only: what the tenant holds for the day's tabs, before anything is written.
//   • the real price days (never a simulation's) and what § 58 left on them (the plan, the actual, the
//     four HTML fields), and their lines of the last 14 days;
//   • the pricing settings (the profit target, the waste, the expected cartons);
//   • the real orders and what was delivered; the sources' offers; the expenses posted in EXP;
//   • whether a model for the unavailable requests exists.
// Nothing is written. Output: scripts/artifacts/s60-20261006-diag.json and a summary.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const out = { readAt: new Date().toISOString() };
const read = async (key, model, method, body) => { out[key] = await call(model, method, body); await pause(); return out[key]; };
const len = (v) => (typeof v === "string" ? v.length : 0);
const REAL = ["x_utak_simulation", "!=", true];

const days = await read("days", "x_price_day", "search_read", {
  domain: [REAL], order: "x_date desc", limit: 40,
  fields: ["id", "x_date", "x_state", "x_published_at", "x_op_cost", "x_op_cartons", "x_op_basis", "x_op_share", "x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_plan_basis", "x_profit_target", "x_target_cartons", "x_act_at", "x_act_cartons", "x_n_publish", "x_avg_profit", "x_target_html", "x_tab_money_html", "x_tab_items_html", "x_tab_next_html", "x_chart_html"],
});
console.log(`real price days: ${days.length}`);
for (const d of days) console.log(`  #${d.id} ${d.x_date} ${d.x_state} cost=${d.x_op_cost} cartons=${d.x_op_cartons} (${d.x_op_basis}) share=${d.x_op_share} publish=${d.x_n_publish} avg=${d.x_avg_profit} target=${d.x_target_cartons} act_at=${d.x_act_at} html: target ${len(d.x_target_html)} money ${len(d.x_tab_money_html)} items ${len(d.x_tab_items_html)} next ${len(d.x_tab_next_html)} chart ${len(d.x_chart_html)}`);

const lines = await read("lines", "x_price_day_line", "search_read", {
  domain: [["x_day_id", "in", days.map((d) => d.id)], REAL], order: "x_day_date desc, x_sequence asc", limit: 2000,
  fields: ["id", "x_day_id", "x_day_date", "x_product_tmpl_id", "x_packaging_id", "x_cost_price", "x_market_price", "x_sale_price", "x_status", "x_reason", "x_decision", "x_real_profit", "x_contribution", "x_break_even", "x_suggested_price", "x_waste_cost", "x_op_share", "x_full_cost", "x_board_sale", "x_net_sale", "x_uplift_pct", "x_supplier_id", "x_offers"],
});
console.log(`their lines: ${lines.length}`);
const byDay = new Map();
for (const l of lines) byDay.set(l.x_day_date, [...(byDay.get(l.x_day_date) ?? []), l]);
for (const [d, ls] of byDay) console.log(`  ${d}: ${ls.length} lines · purchase ${ls.filter((l) => l.x_cost_price > 0).length} · market ${ls.filter((l) => l.x_market_price > 0).length} · sale ${ls.filter((l) => l.x_sale_price > 0).length} · contribution≠0 ${ls.filter((l) => l.x_contribution).length}`);
const today = lines.filter((l) => l.x_day_date === days[0]?.x_date);
for (const l of today) console.log(`    ${l.x_product_tmpl_id?.[1]} | ${l.x_packaging_id?.[1]}: buy ${l.x_cost_price} market ${l.x_market_price} sale ${l.x_sale_price} even ${l.x_break_even} sugg ${l.x_suggested_price} waste ${l.x_waste_cost} share ${l.x_op_share} profit ${l.x_real_profit} ${l.x_status}`);

const config = await read("config", "x_pricing_config", "search_read", { domain: [["x_is_active", "=", true]], fields: ["id", "x_daily_profit_target", "x_waste_pct", "x_expected_cartons", "x_min_profit_sar", "x_market_uplift_pct", "x_above_suggested", "x_workdays_calendar_id", "x_active_from"], limit: 5 });
console.log("settings:", JSON.stringify(config));

const orders = await read("orders", "x_daily_order", "search_read", { domain: [REAL], fields: ["id", "x_order_date", "x_state", "x_delivered_at", "x_price_date", "x_customer_id"], order: "id desc", limit: 200 });
console.log(`real orders: ${orders.length} · delivered/closed ${orders.filter((o) => ["delivered", "closed"].includes(o.x_state)).length}`, JSON.stringify(orders.slice(0, 5)));
out.ordersAll = await call("x_daily_order", "search_count", { domain: [] }); await pause();
console.log(`all orders (with simulation): ${out.ordersAll}`);

const offers = await read("offers", "x_price_offer", "search_read", { domain: [REAL, ["x_date", ">=", "2026-09-20"]], fields: ["id", "x_date", "x_product_tmpl_id", "x_packaging_id", "x_purchase_price", "x_market_price", "x_source_partner_id", "x_source_employee_id", "x_status"], order: "x_date desc, id desc", limit: 1000 });
const offDays = new Map();
for (const o of offers) offDays.set(o.x_date, [...(offDays.get(o.x_date) ?? []), o]);
console.log(`real offers since 09-20: ${offers.length}`);
for (const [d, os] of offDays) console.log(`  ${d}: ${os.length} · purchase ${os.filter((o) => o.x_purchase_price > 0).length} · market ${os.filter((o) => o.x_market_price > 0).length} · sources ${[...new Set(os.map((o) => o.x_source_partner_id?.[1] ?? o.x_source_employee_id?.[1] ?? "?"))].join(", ")}`);
const dp = await read("dailyPrices", "x_daily_price", "search_read", { domain: [REAL, ["x_date", ">=", "2026-09-20"]], fields: ["id", "x_date", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_supplier_id"], order: "x_date desc, id desc", limit: 1000 });
console.log(`real supplier rows since 09-20: ${dp.length} on ${[...new Set(dp.map((r) => r.x_date))].join(", ")}`);

const costs = await read("costs", "x_operating_cost", "search_read", { domain: [REAL], fields: ["id", "x_name", "x_frequency", "x_amount", "x_date_from", "x_date_to", "x_cost_type", "x_account_id"], order: "id asc", limit: 100 });
console.log(`operating cost lines: ${costs.length}`);
for (const c of costs) console.log(`  #${c.id} ${c.x_name} ${c.x_frequency} ${c.x_amount} ${c.x_date_from}→${c.x_date_to} type=${c.x_cost_type} account=${c.x_account_id?.[1] ?? "-"}`);

const moves = await read("expenseMoves", "account.move", "search_read", { domain: [["journal_id", "=", 20]], fields: ["id", "name", "date", "state", "move_type", "amount_total", "amount_untaxed", "partner_id", "ref"], order: "date desc, id desc", limit: 100 });
console.log(`moves in EXP #20: ${moves.length}`);
for (const m of moves.slice(0, 20)) console.log(`  #${m.id} ${m.name} ${m.date} ${m.state} ${m.move_type} total ${m.amount_total} untaxed ${m.amount_untaxed} ${m.partner_id?.[1] ?? ""} ${m.ref ?? ""}`);
const moveFields = await call("account.move", "fields_get", { attributes: ["type", "string"] }); await pause();
console.log("account.move x_ fields:", Object.keys(moveFields).filter((k) => k.startsWith("x_")).map((k) => `${k}:${moveFields[k].type}`).join(" "));

const model = await read("unavailableModel", "ir.model", "search_read", { domain: [["model", "in", ["x_unavailable_request", "x_missed_request"]]], fields: ["id", "model", "name"] });
console.log("a model for the unavailable requests:", JSON.stringify(model));
const menus = await read("pricingMenus", "ir.ui.menu", "search_read", { domain: [["parent_id", "=", 582]], fields: ["id", "name", "sequence", "action"], order: "sequence asc" });
for (const m of menus) console.log(`  menu #${m.id} ${m.name} seq ${m.sequence} ${m.action}`);
const [view] = await read("dayView", "ir.ui.view", "search_read", { domain: [["id", "=", 2834]], fields: ["id", "name", "arch_db", "write_date"] });
console.log(`view #2834 ${view?.name} (${view?.write_date}): ${len(view?.arch_db)} chars · notebook ${view?.arch_db?.includes("utak_day_tabs")} · target ${view?.arch_db?.includes("x_target_html")}`);

writeFileSync(new URL("./artifacts/s60-20261006-diag.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("→ scripts/artifacts/s60-20261006-diag.json");
