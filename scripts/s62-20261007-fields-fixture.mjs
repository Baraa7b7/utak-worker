// § 62 (2026-10-07) — the strict schema gate of the tests of § 62 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 61 dumped, and — new in the gate — the three
// models of «طلب أسعار خاص»: x_special_quote (the request), x_special_quote_line (its lines) and
// x_special_quote_recipient (its sources). THREE fields of an older model are new: x_price_offer.x_special
// «خاص», x_special_quote_id and x_special_unit (a market observation of a special request, which every
// reader of the day leaves out). It is read AFTER tests/fixtures-odoo-fields-20261006-s61.json in the gate
// (the last one wins: the tenant's fields now). Written from the tenant after
// `scripts/s62-20261007-odoo.mjs --apply` (2026-10-07): run it again after any later change of fields.
//
//   node scripts/s62-20261007-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261007-s62.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261006-s61.json (the tests read «the last fixture» as the full one), then § 62's
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
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 62 (the three models of «طلب أسعار خاص» for the first time; x_price_offer.x_special / x_special_quote_id / x_special_unit; every other model of § 61 again, unchanged): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261007-s62.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_special_quote: ["x_name", "x_partner_id", "x_date", "x_state", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_valid_until", "x_note", "x_order_profit", "x_profit_text", "x_missing_purchase", "x_missing_final", "x_total", "x_summary", "x_last_result", "x_source_notes", "x_asked_at", "x_sale_order_id", "x_quotation_number", "x_pdf_url", "x_issued_at", "x_prepared", "x_utak_simulation", "x_line_ids", "x_recipient_ids"],
  x_special_quote_line: ["x_quote_id", "x_sequence", "x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_market_text", "x_market_median", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_total", "x_profit", "x_obs"],
  x_special_quote_recipient: ["x_quote_id", "x_partner_id", "x_role", "x_asked_at", "x_via", "x_replied_at", "x_priced", "x_reminded_at"],
  x_price_offer: ["x_special", "x_special_quote_id", "x_special_unit"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
