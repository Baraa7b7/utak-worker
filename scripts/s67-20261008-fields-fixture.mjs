// § 67 (2026-10-08) — the strict schema gate, whole (the tests read «the last fixture» as the full one):
// fields_get (read-only) of every model tests/fixtures-odoo-fields-20261008-s66.json dumped. New since § 66: «🧊 وضع التجميد»
// on x_pricing_config (x_freeze_on, x_freeze_until, x_freeze_reply, x_freeze_since, x_freeze_ended_at), x_price_day.x_freeze_on
// (not stored), and x_wa_message.x_status «frozen». It is read AFTER the s66 fixture in the gate (the last one wins). Written
// from the tenant after `scripts/s67-20261008-odoo.mjs --only=schema --apply`: run it again after any later change.
//
//   node scripts/s67-20261008-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261008-s67.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261008-s66.json
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
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 67 («🧊 وضع التجميد»: x_pricing_config, x_price_day, x_wa_message.x_status «frozen»)`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261008-s67.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_pricing_config: ["x_freeze_on", "x_freeze_until", "x_freeze_reply", "x_freeze_since", "x_freeze_ended_at"],
  x_price_day: ["x_freeze_on"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
log(`${(out._selections["x_wa_message.x_status"] ?? []).includes("frozen") ? "✓" : "✗"} x_wa_message.x_status: ${JSON.stringify(out._selections["x_wa_message.x_status"])}`);
