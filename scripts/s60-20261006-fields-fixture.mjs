// § 60 (2026-10-06) — the strict schema gate of the tests of § 60 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 59 dumped, and — new in the gate — the
// model of § 60 ج, x_unavailable_request «طلبوا وما كان متوفر» (the day, the customer, the item as he
// wrote it, the catalog's item, the quantity), and ir.filters (the saved filter of each item of «📈 تاريخ
// الأسعار», src/history-filters.ts). ONE field of an older model is new: x_price_day.x_brief_html «خلاصة
// اليوم» (scripts/s60-20261006-day.mjs). What else the worker writes on the day and its lines (the plan,
// the actual, the four HTML fields, the line's contribution) and reads on the settings
// (x_daily_profit_target) is on the tenant since § 58. It is
// read AFTER tests/fixtures-odoo-fields-20261006-s59.json in the gate (the last one wins: the tenant's
// fields now). Written from the tenant after `scripts/s60-20261006-odoo.mjs --apply` and
// `scripts/s60-20261006-day.mjs --apply` (2026-10-06): run
// it again after any later change of fields.
//
//   node scripts/s60-20261006-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261006-s60.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261006-s60.json (the tests read «the last fixture» as the full one), then § 60's
const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
  "res.partner", "hr.employee", "x_price_offer", "x_daily_price", "x_purchase_list",
  "x_whatsapp_template", "x_supplier_price_request_log", "x_wa_message",
  "account.journal", "res.partner.bank",
  "x_complaint", "x_payment", "account.move", "account.move.line", "account.payment", "account.payment.register", "ir.attachment",
  "account.payment.method.line",
  "x_employee_role", "resource.calendar", "resource.calendar.attendance",
  "x_unavailable_request", "ir.filters",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 60 (x_unavailable_request and ir.filters for the first time; x_price_day.x_brief_html; every other model of § 59 again, unchanged): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261006-s60.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_unavailable_request: ["x_date", "x_partner_id", "x_text", "x_product_tmpl_id", "x_quantity", "x_utak_simulation"],
  "ir.filters": ["name", "model_id", "action_id", "user_ids", "domain", "context", "sort", "is_default", "active"],
  x_price_day: ["x_brief_html", "x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_plan_basis", "x_profit_target", "x_target_cartons", "x_act_cartons", "x_act_profit", "x_var_volume", "x_act_at", "x_target_html", "x_tab_money_html", "x_tab_items_html", "x_tab_next_html"],
  x_price_day_line: ["x_contribution", "x_break_even", "x_day_date"],
  x_pricing_config: ["x_daily_profit_target"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
