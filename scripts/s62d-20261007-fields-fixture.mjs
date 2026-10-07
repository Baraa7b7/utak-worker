// § 62 د (2026-10-07) — the strict schema gate, whole (the tests read «the last fixture» as the full one):
// fields_get (read-only) of every model tests/fixtures-odoo-fields-20261007-s62.json dumped, and — new in
// the gate — sale.order and sale.order.line (the manual quotation reads Odoo's own numbers: price_subtotal /
// price_tax / price_total, amount_*, its display_type) and x_preview_ticket (the one-use ticket of «👁️ معاينة
// PDF»). SIX fields of older models are new: x_special_quote.x_layout «شكل العرض»; x_special_quote_line
// .x_item_origin «المنشأ», x_item_size «المقاس», x_suggested_net «المقترح قبل الضريبة»; and sale.order.line
// .x_item_origin / x_item_size. It is read AFTER the s62 fixture in the gate (the last one wins). Written from
// the tenant after `scripts/s62d-20261007-odoo.mjs --only=schema --apply`: run it again after any later
// change of fields.
//
//   node scripts/s62d-20261007-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261007-s62d.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261007-s62.json, then § 62 د's three
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
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 62 د (x_special_quote.x_layout; x_special_quote_line.x_item_origin / x_item_size / x_suggested_net; sale.order and sale.order.line for the first time, with x_item_origin / x_item_size; x_preview_ticket for the first time; every model of § 62 again)`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261007-s62d.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_special_quote: ["x_layout", "x_price_mode", "x_alternatives"],
  x_special_quote_line: ["x_item_origin", "x_item_size", "x_suggested_net", "x_final_net"],
  "sale.order": ["amount_untaxed", "amount_tax", "amount_total", "order_line", "origin", "validity_date", "state", "partner_id"],
  "sale.order.line": ["display_type", "name", "product_id", "product_uom_qty", "price_unit", "price_subtotal", "price_tax", "price_total", "discount", "product_uom_id", "tax_ids", "x_packaging_id", "x_price_unit_manual", "x_item_origin", "x_item_size", "sequence"],
  x_preview_ticket: ["x_name", "x_model", "x_res_id", "x_used", "create_date"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
log(`✓ «شكل العرض»: ${JSON.stringify(out._selections["x_special_quote.x_layout"])} · display_type: ${JSON.stringify(out._selections["sale.order.line.display_type"])}`);
