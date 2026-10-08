// § 66 (2026-10-08) — the strict schema gate, whole (the tests read «the last fixture» as the full one):
// fields_get (read-only) of every model tests/fixtures-odoo-fields-20261007-s65.json dumped. New since § 65: the
// acceptance on x_special_quote (x_accepted_at, x_delivery_date, x_pay_terms, x_delivery_note, x_accept_expired,
// x_daily_order_id, x_converted_at, x_confirmed_total) and its state «accepted», x_special_quote_line.x_confirmed_qty,
// x_daily_order.x_special_quote_id, x_daily_order_line.x_special_price / x_pack_text / x_special_purchase,
// x_pricing_config.x_large_order_cartons. It is read AFTER the s65 fixture in the gate (the last one wins). Written
// from the tenant after `scripts/s66-20261008-odoo.mjs --only=schema --apply`: run it again after any later change.
//
//   node scripts/s66-20261008-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261008-s66.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261007-s65.json
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
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 66 (the acceptance of a special request and the order it becomes: x_special_quote, x_special_quote_line, x_daily_order, x_daily_order_line, x_pricing_config; every model of § 65 again)`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261008-s66.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_special_quote: ["x_accepted_at", "x_delivery_date", "x_pay_terms", "x_delivery_note", "x_accept_expired", "x_daily_order_id", "x_converted_at", "x_confirmed_total"],
  x_special_quote_line: ["x_confirmed_qty"],
  x_daily_order: ["x_special_quote_id"],
  x_daily_order_line: ["x_special_price", "x_pack_text", "x_special_purchase"],
  x_pricing_config: ["x_large_order_cartons"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
log(`${(out._selections["x_special_quote.x_state"] ?? []).includes("accepted") ? "✓" : "✗"} x_special_quote.x_state: ${JSON.stringify(out._selections["x_special_quote.x_state"])}`);
