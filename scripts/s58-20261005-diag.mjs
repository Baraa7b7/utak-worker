// § 58 (2026-10-05) — read-only: what the tenant holds for this order, before anything is written.
//   • journal BRA #21: its outbound payment method lines and their accounts; the accounts 201021 / 205001;
//   • x_pricing_config / x_price_day / x_price_day_line: their fields; the day form #2834 and the settings form;
//   • the menu «💲 التسعير» #582 and its children;
//   • the REAL data (x_utak_simulation = false): days, lines with a purchase / a market price, offers,
//     delivered orders, expenses in EXP.
// Nothing is written. Output: scripts/artifacts/s58-20261005-diag.json and a summary.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const ALL = { active_test: false };
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const out = { readAt: new Date().toISOString() };
const read = async (key, model, method, body) => { out[key] = await call(model, method, body); await pause(); return out[key]; };

// ---- BRA
const [bra] = await read("bra", "account.journal", "search_read", { domain: [["id", "=", 21]], fields: ["id", "name", "code", "type", "default_account_id", "outbound_payment_method_line_ids", "inbound_payment_method_line_ids"] });
await read("braLines", "account.payment.method.line", "search_read", { domain: [["journal_id", "=", 21]], fields: ["id", "name", "payment_type", "payment_account_id", "payment_method_id", "journal_id"], context: ALL });
await read("accounts", "account.account", "search_read", { domain: [["code", "in", ["201021", "205001", "101003", "101004"]]], fields: ["id", "code", "name", "account_type", "reconcile"] });
await read("braPayments", "account.payment", "search_read", { domain: [["journal_id", "=", 21]], fields: ["id", "name", "amount", "date", "state", "move_id", "payment_type", "partner_id", "memo"], limit: 20 });

// ---- the pricing models
for (const m of ["x_pricing_config", "x_price_day", "x_price_day_line", "x_price_offer"]) {
  out[`fields:${m}`] = (await call("ir.model.fields", "search_read", { domain: [["model", "=", m]], fields: ["name", "ttype", "field_description", "relation", "selection"], limit: 400 }))
    .map((f) => `${f.name}:${f.ttype}${f.relation ? `→${f.relation}` : ""} «${f.field_description}»`).sort();
  await pause();
}
await read("views", "ir.ui.view", "search_read", { domain: [["model", "in", ["x_price_day", "x_pricing_config", "x_price_day_line"]]], fields: ["id", "name", "type", "mode", "priority", "active", "inherit_id", "arch_db"], context: ALL });
await read("menus", "ir.ui.menu", "search_read", { domain: ["|", ["id", "=", 582], ["parent_id", "=", 582]], fields: ["id", "name", "parent_id", "sequence", "action"], context: ALL });
await read("actions", "ir.actions.act_window", "search_read", { domain: [["res_model", "in", ["x_price_day", "x_pricing_config", "x_price_day_line"]]], fields: ["id", "name", "res_model", "view_mode", "view_id", "domain", "context"], context: ALL });
await read("config", "x_pricing_config", "search_read", { domain: [], fields: [], limit: 5 });

// ---- the real data
const days = await read("days", "x_price_day", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", "x_published_at", "x_op_cost", "x_op_cartons", "x_op_share", "x_op_basis", "x_n_publish", "x_avg_profit"], order: "x_date asc", limit: 100 });
const lines = await read("lines", "x_price_day_line", "search_read", {
  domain: [["x_day_id", "in", days.map((d) => d.id)]],
  fields: ["id", "x_day_id", "x_product_tmpl_id", "x_packaging_id", "x_cost_price", "x_market_price", "x_sale_price", "x_status", "x_decision", "x_reason", "x_full_cost", "x_waste_cost", "x_op_share", "x_break_even", "x_suggested_price", "x_real_profit", "x_excluded", "x_offers"],
  limit: 2000,
});
await read("offers", "x_price_offer", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: [], order: "id desc", limit: 60 });
await read("realOrders", "x_daily_order", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_order_date", "x_state", "x_customer_id", "x_delivered_at"], order: "id desc", limit: 50 });
out["fields:x_daily_order_line"] = (await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_daily_order_line"]], fields: ["name", "ttype", "field_description", "selection"], limit: 200 })).map((f) => `${f.name}:${f.ttype} «${f.field_description}»`).sort();
await pause();
await read("expJournal", "account.journal", "search_read", { domain: [["code", "in", ["EXP", "BRA", "BNK1", "CSHD"]]], fields: ["id", "code", "name", "type"] });
await read("expMoves", "account.move", "search_read", { domain: [["journal_id.code", "=", "EXP"]], fields: ["id", "name", "date", "state", "move_type", "amount_total", "amount_untaxed", "partner_id", "ref"], order: "date desc", limit: 40 });
await read("costs", "x_operating_cost", "search_read", { domain: [], fields: [], limit: 40 });

writeFileSync(new URL("./artifacts/s58-20261005-diag.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

const m2o = (v) => (Array.isArray(v) ? `#${v[0]} ${v[1]}` : String(v));
console.log(`BRA #${bra.id} ${bra.code} default=${m2o(bra.default_account_id)} out=${JSON.stringify(bra.outbound_payment_method_line_ids)} in=${JSON.stringify(bra.inbound_payment_method_line_ids)}`);
for (const l of out.braLines) console.log(`  line #${l.id} ${l.payment_type} «${l.name}» method=${m2o(l.payment_method_id)} account=${m2o(l.payment_account_id)}`);
for (const a of out.accounts) console.log(`  account #${a.id} ${a.code} «${a.name}» ${a.account_type} reconcile=${a.reconcile}`);
for (const p of out.braPayments) console.log(`  payment #${p.id} ${p.name} ${p.amount} ${p.date} ${p.state} move=${m2o(p.move_id)}`);
for (const v of out.views) console.log(`view #${v.id} ${v.name} (${v.type}, ${v.mode}, active ${v.active}) inherit=${m2o(v.inherit_id)} ${v.arch_db.length} chars`);
for (const m of out.menus) console.log(`menu #${m.id} «${m.name}» parent=${m2o(m.parent_id)} seq=${m.sequence} action=${m.action}`);
for (const a of out.actions) console.log(`action #${a.id} «${a.name}» ${a.res_model} ${a.view_mode} view=${m2o(a.view_id)}`);
console.log(`config: ${JSON.stringify(out.config.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("x_")))))}`);
console.log(`real days: ${days.length}`);
for (const d of days) {
  const ls = lines.filter((l) => l.x_day_id[0] === d.id);
  console.log(`  day #${d.id} ${d.x_date} ${d.x_state} lines=${ls.length} purchase=${ls.filter((l) => l.x_cost_price > 0).length} market=${ls.filter((l) => l.x_market_price > 0).length} sale=${ls.filter((l) => l.x_sale_price > 0).length} op_cost=${d.x_op_cost} cartons=${d.x_op_cartons} share=${d.x_op_share}`);
}
console.log(`real offers: ${out.offers.length}; real orders: ${out.realOrders.length} ${JSON.stringify(out.realOrders.slice(0, 5).map((o) => [o.id, o.x_order_date, o.x_state]))}`);
console.log(`EXP moves: ${out.expMoves.length} ${JSON.stringify(out.expMoves.slice(0, 6).map((m) => [m.name, m.date, m.state, m.amount_total]))}`);
console.log(`costs: ${out.costs.length}`);
