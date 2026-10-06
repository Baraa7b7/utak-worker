// § 61 (2026-10-06) — the strict schema gate of the tests of § 61 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 60 dumped, and — new in the gate — hr.job
// «الوظائف» with what § 61 put on it (x_job_role_ids «أدوار الوظيفة», x_default_calendar_id, x_job_attendance,
// the five texts, the documents, the salary range and the fixed costs). TWO fields of an older model are
// new: x_operating_cost.x_job_id and x_employee_id (the job and the employee of a cost line); and ONE
// selection value: x_whatsapp_template.x_purpose «team_welcome» (once scripts/s61-20261006-odoo.mjs
// --only=templates is applied). It is read AFTER tests/fixtures-odoo-fields-20261006-s60.json in the gate
// (the last one wins: the tenant's fields now). Written from the tenant after
// `scripts/s61-20261006-odoo.mjs --apply` (2026-10-06): run it again after any later change of fields.
//
//   node scripts/s61-20261006-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261006-s61.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261006-s60.json (the tests read «the last fixture» as the full one), then § 61's
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
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 61 (hr.job for the first time, with the fields of the jobs; x_operating_cost.x_job_id / x_employee_id; every other model of § 60 again, unchanged): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261006-s61.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  "hr.job": ["name", "active", "sequence", "employee_ids", "x_job_role_ids", "x_default_calendar_id", "x_job_attendance", "x_responsibilities", "x_day_by_hour", "x_kpis", "x_takeover_list", "x_handover_list", "x_required_docs", "x_salary_from", "x_salary_to", "x_fixed_costs"],
  x_operating_cost: ["x_job_id", "x_employee_id"],
  "hr.employee": ["job_id", "x_utak_role_ids", "x_utak_attendance", "resource_calendar_id"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
