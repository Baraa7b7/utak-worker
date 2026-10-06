// § 59 (2026-10-06) — read-only: what the tenant holds for this order, before anything is written.
//   • the team: every hr.employee (roles, «مشمول بالتحضير», schedule, Work Contact, «مصدر أسعار»), the
//     role rows (x_employee_role), the working schedules and their lines, the company's own schedule;
//   • the operating costs in force and the pricing settings (the cost of 2026-10-06 is computed by
//     scripts/s59-20261006-cost.mts with the worker's own code);
//   • the WhatsApp template rows (purpose, name, category, status) — the welcome, the quotation, the
//     receipt, the invoice and «بدء الدوام»;
//   • the last published price day and its lines (the trials of [ز]).
// Nothing is written. Output: scripts/artifacts/s59-20261006-diag.json and a summary (no phone number is printed).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const ALL = { active_test: false };
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const out = { readAt: new Date().toISOString() };
const read = async (key, model, method, body) => { out[key] = await call(model, method, body); await pause(); return out[key]; };
const fieldsOf = async (m) => {
  out[`fields:${m}`] = (await call("ir.model.fields", "search_read", { domain: [["model", "=", m], ["name", "=like", "x_%"]], fields: ["name", "ttype", "field_description", "relation", "selection"], limit: 400 }))
    .map((f) => `${f.name}:${f.ttype}${f.relation ? `→${f.relation}` : ""} «${f.field_description}»${f.selection ? ` ${f.selection}` : ""}`).sort();
  await pause();
  return out[`fields:${m}`];
};
const m2o = (v) => (Array.isArray(v) ? `#${v[0]} ${v[1]}` : String(v));
const tail = (s) => (s ? `…${String(s).replace(/\D/g, "").slice(-4)}` : "-");

// ---- the team
const emps = await read("employees", "hr.employee", "search_read", {
  domain: [], context: ALL, order: "id asc", limit: 100,
  fields: ["id", "name", "active", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp", "x_utak_neighborhood_ids", "resource_calendar_id", "resource_id", "company_id", "x_price_source", "x_price_role", "user_id", "job_title"],
});
const roles = await read("roles", "x_employee_role", "search_read", { domain: [], fields: [], context: ALL, order: "id asc", limit: 60 });
await fieldsOf("x_employee_role");
await fieldsOf("hr.employee");
const cals = await read("calendars", "resource.calendar", "search_read", { domain: [], context: ALL, order: "id asc", limit: 60, fields: ["id", "name", "active", "company_id", "hours_per_day", "attendance_ids"] });
const lines = await read("calendarLines", "resource.calendar.attendance", "search_read", {
  domain: [["calendar_id", "in", cals.map((c) => c.id)]], order: "calendar_id asc, dayofweek asc, hour_from asc", limit: 500,
  fields: ["id", "calendar_id", "calendar_type", "dayofweek", "hour_from", "hour_to", "duration_based", "date", "recurrency", "recurrency_type", "recurrency_interval", "recurrency_until", "recurrency_excluded_occurences"],
});
await read("company", "res.company", "search_read", { domain: [], fields: ["id", "name", "resource_calendar_id"] });
await read("leaves", "resource.calendar.leaves", "search_read", { domain: [["date_to", ">=", "2026-10-01 00:00:00"]], fields: ["id", "name", "resource_id", "calendar_id", "date_from", "date_to"], limit: 50 });
await read("automations", "base.automation", "search_read", { domain: [["model_id.model", "in", ["hr.employee", "resource.calendar.attendance", "resource.calendar.leaves", "resource.calendar"]]], fields: ["id", "name", "active", "trigger", "model_id"], context: ALL });

// ---- the costs and the settings
const costs = await read("costs", "x_operating_cost", "search_read", { domain: [], fields: [], context: ALL, order: "id asc", limit: 60 });
await fieldsOf("x_pricing_config");
const config = await read("config", "x_pricing_config", "search_read", { domain: [], fields: [], limit: 5 });
await read("configViews", "ir.ui.view", "search_read", { domain: [["model", "=", "x_pricing_config"]], fields: ["id", "name", "type", "mode", "active", "inherit_id"], context: ALL });

// ---- the templates
await fieldsOf("x_whatsapp_template");
const tmpls = await read("templates", "x_whatsapp_template", "search_read", { domain: [], fields: [], context: ALL, order: "id asc", limit: 200 });

// ---- the last published day
const days = await read("days", "x_price_day", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", "x_published_at"], order: "x_date desc", limit: 6 });
const pub = days.find((d) => d.x_state === "published") ?? days[0];
if (pub) {
  await read("dayLines", "x_price_day_line", "search_read", {
    domain: [["x_day_id", "=", pub.id]], limit: 200,
    fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_sale_price", "x_status", "x_decision", "x_excluded"],
  });
}
// the partners the roles point at (names only)
const partnerIds = [...new Set(emps.map((e) => (Array.isArray(e.work_contact_id) ? e.work_contact_id[0] : 0)).filter(Boolean)), 45];
await read("partners", "res.partner", "search_read", { domain: [["id", "in", partnerIds]], context: ALL, fields: ["id", "name", "active", "x_whatsapp_number", "phone", "x_price_source", "x_price_role", "supplier_rank", "customer_rank", "employee_ids"] });

writeFileSync(new URL("./artifacts/s59-20261006-diag.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

const roleName = (id) => { const r = roles.find((x) => x.id === id); return r ? `${r.x_code ?? "?"}#${id}` : `#${id}`; };
console.log("employees:");
for (const e of emps) console.log(`  #${e.id} «${e.name}» active=${e.active} contact=${m2o(e.work_contact_id)} wa=${tail(e.x_utak_whatsapp)} roles=[${(e.x_utak_role_ids || []).map(roleName).join(", ")}] attendance=${e.x_utak_attendance} calendar=${m2o(e.resource_calendar_id)} resource=${m2o(e.resource_id)} source=${e.x_price_source} role=${e.x_price_role} user=${m2o(e.user_id)}`);
console.log("roles:");
for (const r of roles) console.log(`  #${r.id} ${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith("x_") || k === "display_name")))}`);
console.log("calendars:");
for (const c of cals) {
  const ls = lines.filter((l) => (Array.isArray(l.calendar_id) ? l.calendar_id[0] : l.calendar_id) === c.id);
  console.log(`  #${c.id} «${c.name}» active=${c.active} company=${m2o(c.company_id)} lines=${ls.length}: ${ls.map((l) => `${l.dayofweek}:${l.hour_from}-${l.hour_to}${l.duration_based ? "(d)" : ""}${l.date ? `@${l.date}` : ""}`).join(" ")}`);
}
console.log(`company: ${JSON.stringify(out.company.map((c) => ({ id: c.id, name: c.name, calendar: m2o(c.resource_calendar_id) })))}`);
console.log(`leaves: ${out.leaves.length}; automations: ${out.automations.map((a) => `#${a.id} «${a.name}» ${a.active ? "on" : "off"}`).join(" | ")}`);
console.log("costs:");
for (const c of costs) console.log(`  #${c.id} «${c.x_name}» ${c.x_frequency} ${c.x_amount} from=${c.x_date_from} to=${c.x_date_to} sim=${c.x_utak_simulation} active=${c.x_active ?? c.active ?? "-"}`);
console.log(`config fields: ${out["fields:x_pricing_config"].join(" | ")}`);
console.log(`config: ${JSON.stringify(config.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("x_")))))}`);
console.log(`config views: ${out.configViews.map((v) => `#${v.id} ${v.name} (${v.type}/${v.mode}, ${v.active ? "on" : "off"})`).join(" | ")}`);
console.log(`template fields: ${out["fields:x_whatsapp_template"].join(" | ")}`);
console.log("templates:");
for (const t of tmpls) console.log(`  #${t.id} ${t.x_meta_template_id ?? t.x_name} purpose=${t.x_purpose} cat=${t.x_category ?? "-"} status=${t.x_status ?? t.x_meta_status ?? "-"} lang=${t.x_language ?? "-"} active=${t.x_active ?? t.active ?? "-"}`);
console.log(`days: ${days.map((d) => `#${d.id} ${d.x_date} ${d.x_state} ${d.x_published_at || "-"}`).join(" | ")}`);
for (const l of out.dayLines ?? []) console.log(`  line #${l.id} ${m2o(l.x_product_tmpl_id)} / ${m2o(l.x_packaging_id)} sale=${l.x_sale_price} status=${l.x_status} decision=${l.x_decision} excluded=${l.x_excluded}`);
console.log("partners:");
for (const p of out.partners) console.log(`  #${p.id} «${p.name}» active=${p.active} wa=${tail(p.x_whatsapp_number)} phone=${tail(p.phone)} source=${p.x_price_source} role=${p.x_price_role} sup=${p.supplier_rank} cus=${p.customer_rank} employees=${JSON.stringify(p.employee_ids)}`);
