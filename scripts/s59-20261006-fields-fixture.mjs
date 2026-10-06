// § 59 (2026-10-06) — the strict schema gate of the tests of § 59 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 58 dumped, after § 59's changes exist —
// on x_pricing_config x_workdays_calendar_id «جدول أيام العمل (حصة التكلفة)», and on
// x_whatsapp_template.x_purpose the two values «team_prices_ready» and «customer_quotation_pdf_v2» —
// and, new in the gate, x_employee_role (the role «تسويق») and the working schedules
// (resource.calendar, resource.calendar.attendance). With the selection values. It is read AFTER
// tests/fixtures-odoo-fields-20261005-s58.json in the gate (the last one wins: the tenant's fields
// now). Written from the tenant after `scripts/s59-20261006-odoo.mjs --apply` (2026-10-06): run it
// again after any later change of fields.
//
//   node scripts/s59-20261006-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261006-s59.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261005-s58.json (the tests read «the last fixture» as the full one), then § 59's
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
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 59 (x_pricing_config.x_workdays_calendar_id; the purposes team_prices_ready and customer_quotation_pdf_v2; x_employee_role and the working schedules for the first time): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261006-s59.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = { x_pricing_config: ["x_workdays_calendar_id"], x_employee_role: ["x_code", "x_active"], "resource.calendar.attendance": ["calendar_id", "dayofweek", "hour_from", "hour_to"] };
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.map((n) => `${n} ${(out[m] ?? []).includes(n)}`).join(", ")}`);
const purposes = out._selections["x_whatsapp_template.x_purpose"] ?? [];
for (const p of ["team_prices_ready", "customer_quotation_pdf_v2"]) log(`${purposes.includes(p) ? "✓" : "✗"} x_whatsapp_template.x_purpose: ${p}`);
