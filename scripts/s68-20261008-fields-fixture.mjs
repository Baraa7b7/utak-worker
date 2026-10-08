// § 68 (2026-10-08) — the strict schema gate, whole (the tests read «the last fixture» as the full one):
// fields_get (read-only) of every model tests/fixtures-odoo-fields-20261008-s67.json dumped, and — in the full fixture
// for the first time since § 31 — the attendance row, the time off, the routes and their stops. New since § 67: the
// employee's file — x_team_attendance (x_out_at, x_hours, x_late_min, x_source, x_note, the two places, the status
// «leave»), resource.calendar.leaves.x_leave_type, the papers and the figures on hr.employee, and x_employee_note.
// Written from the tenant after `scripts/s68-20261008-odoo.mjs --apply`: run it again after any later change.
//
//   node scripts/s68-20261008-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261008-s68.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261008-s67.json, and the five of the employee's file
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
  "x_team_attendance", "resource.calendar.leaves", "x_employee_note", "x_delivery_route", "x_delivery_stop",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 68 (the employee's file: x_team_attendance, resource.calendar.leaves, hr.employee, x_employee_note)`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261008-s68.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = {
  x_team_attendance: ["x_out_at", "x_hours", "x_late_min", "x_source", "x_note", "x_in_map", "x_out_map"],
  "resource.calendar.leaves": ["x_leave_type"],
  x_employee_note: ["x_employee_id", "x_date", "x_kind", "x_text", "x_file", "x_file_name"],
  "hr.employee": ["x_doc_id_state", "x_doc_id_expiry", "x_doc_license_state", "x_doc_other_name", "x_docs_pct", "x_docs_missing", "x_docs_next_expiry", "x_att_present", "x_attendance_ids", "x_note_ids", "x_custody_text", "x_perf_text", "x_file_at"],
};
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.filter((n) => !(out[m] ?? []).includes(n)).join(", ") || `${names.length} fields`}`);
log(`${(out._selections["x_team_attendance.x_status"] ?? []).includes("leave") ? "✓" : "✗"} x_team_attendance.x_status: ${JSON.stringify(out._selections["x_team_attendance.x_status"])}`);
log(`${JSON.stringify(out._selections["x_team_attendance.x_source"]) === JSON.stringify(["whatsapp", "manual"]) ? "✓" : "✗"} x_team_attendance.x_source: ${JSON.stringify(out._selections["x_team_attendance.x_source"])}`);
log(`${JSON.stringify(out._selections["hr.employee.x_doc_id_state"]) === JSON.stringify(["missing", "progress", "done", "na"]) ? "✓" : "✗"} hr.employee.x_doc_id_state: ${JSON.stringify(out._selections["hr.employee.x_doc_id_state"])}`);
