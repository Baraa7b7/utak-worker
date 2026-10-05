// § 58 (2026-10-05) — the strict schema gate of the tests of § 58 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 57 dumped, after § 58's fields exist — on
// x_pricing_config x_daily_profit_target, on x_price_day_line x_contribution, on x_price_day the day's
// plan (x_plan_*, x_profit_target, x_target_cartons), its actual (x_act_*, x_var_*) and the four HTML
// fields (x_target_html, x_tab_money_html, x_tab_items_html, x_tab_next_html) — and, new in the gate,
// account.payment.method.line (the account of «من جيب براء») and x_purchase_list_line when the tenant
// has it. With the selection values. It is read AFTER tests/fixtures-odoo-fields-20261005-s57.json in
// the gate (the last one wins: the tenant's fields now). Written from the tenant after
// `scripts/s58-20261005-odoo.mjs --apply` (2026-10-05): run it again after any later change of fields.
//
//   node scripts/s58-20261005-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261005-s58.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261005-s57.json (the tests read «the last fixture» as the full one), then § 58's
const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
  "res.partner", "hr.employee", "x_price_offer", "x_daily_price", "x_purchase_list",
  "x_whatsapp_template", "x_supplier_price_request_log", "x_wa_message",
  "account.journal", "res.partner.bank",
  "x_complaint", "x_payment", "account.move", "account.move.line", "account.payment", "account.payment.register", "ir.attachment",
  "account.payment.method.line",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 58 (x_daily_profit_target; x_contribution; the day's plan, actual and four HTML fields; account.payment.method.line for the first time): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261005-s58.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = { x_pricing_config: ["x_daily_profit_target"], x_price_day_line: ["x_contribution"], x_price_day: ["x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_plan_basis", "x_profit_target", "x_target_cartons", "x_act_cartons", "x_act_margin", "x_act_waste", "x_act_waste_real", "x_act_cost", "x_act_profit", "x_var_volume", "x_var_margin", "x_var_waste", "x_var_cost", "x_act_at", "x_target_html", "x_tab_money_html", "x_tab_items_html", "x_tab_next_html"], "account.payment.method.line": ["payment_account_id", "journal_id", "payment_type"] };
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.map((n) => `${n} ${(out[m] ?? []).includes(n)}`).join(", ")}`);
