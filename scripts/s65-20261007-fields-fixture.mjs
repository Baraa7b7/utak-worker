// § 65 (2026-10-07) — the strict schema gate, whole (the tests read «the last fixture» as the full one):
// fields_get (read-only) of every model tests/fixtures-odoo-fields-20261007-s64.json dumped, and the two models of
// the suppliers' registry (x_supplier_season, x_supplier_capacity). New since § 64: the supplier's card on
// res.partner (x_supplier_state and 19 more, three one2many), seven fields on x_price_offer, two on x_daily_price,
// x_pricing_config.x_supplier_outreach. It is read AFTER the s64 fixture in the gate (the last one wins). Written
// from the tenant after `scripts/s65-20261007-odoo.mjs --apply`: run it again after any later change of fields.
//
//   node scripts/s65-20261007-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261007-s65.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261007-s64.json, and § 65's two
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
  "hr.job",
  "x_special_quote", "x_special_quote_line", "x_special_quote_recipient",
  "sale.order", "sale.order.line", "x_preview_ticket",
  "x_supplier_season", "x_supplier_capacity", "res.country",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 65 (the suppliers\' registry: res.partner, x_price_offer, x_daily_price, x_pricing_config, x_supplier_season, x_supplier_capacity; every model of § 64 again)`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261007-s65.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  "sale.order.line": ["x_pack_text", "x_packaging_id", "x_item_origin", "x_item_size", "display_type", "price_total"],
  x_preview_ticket: ["x_name", "x_model", "x_res_id", "x_used", "x_active", "create_date"],
  x_price_day_line: ["x_day_date", "x_product_tmpl_id", "x_market_price", "x_cost_price", "x_break_even", "x_full_cost", "x_packaging_id", "x_utak_simulation"],
  "product.template": ["categ_id", "x_is_active_for_sale"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
