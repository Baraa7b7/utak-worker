// § 61 (2026-10-06) — read-only: what Odoo holds for the jobs before anything is written. hr.job and its
// fields, the employees (archived too) with their job, roles, schedule and attendance, the roles, the
// schedules, the cost lines' fields, the UTAK menus of the team and the automations that drop the roster.
// Nothing is written. Output: scripts/artifacts/s61-20261006-diag.json (the amounts stay out of stdout).
//
//   node scripts/s61-20261006-diag.mjs [label]
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

const ALL = { active_test: false };
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const label = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "now";
const out = { label, at: new Date().toISOString() };

out.jobFields = Object.fromEntries(Object.entries(await call("hr.job", "fields_get", { attributes: ["type", "string", "relation", "store", "readonly"] }))
  .filter(([k, v]) => k.startsWith("x_") || ["name", "active", "company_id", "department_id", "description", "requirements", "no_of_employee", "expected_employees", "employee_ids", "sequence", "user_id", "contract_type_id", "job_details"].includes(k)).map(([k, v]) => [k, v]));
await pause();
out.jobs = await call("hr.job", "search_read", { domain: [], fields: ["id", "name", "active", "company_id", "department_id", "no_of_employee", "employee_ids", "sequence"], context: ALL, order: "id asc", limit: 100 });
await pause();
const ef = await call("hr.employee", "fields_get", { attributes: ["type", "string", "relation", "store", "readonly", "help"] });
out.employeeFields = Object.fromEntries(Object.entries(ef).filter(([k]) => k.startsWith("x_") || ["job_id", "job_title", "resource_calendar_id", "work_contact_id", "active", "wage", "departure_date", "departure_reason_id", "version_id", "contract_date_start", "contract_date_end"].includes(k)));
await pause();
out.employees = await call("hr.employee", "search_read", {
  domain: [], context: ALL, order: "id asc", limit: 100,
  fields: ["id", "name", "active", "job_id", "job_title", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp", "resource_calendar_id", "resource_id", "company_id", "x_price_source", "x_price_role", "x_utak_neighborhood_ids"],
});
await pause();
out.roles = await call("x_employee_role", "search_read", { domain: [], fields: ["id", "x_name", "x_code", "x_active", "x_color"], context: ALL, order: "id asc", limit: 60 });
out.roleFieldRows = await call("ir.model.fields", "search_read", { domain: [["model", "in", ["hr.employee", "hr.job"]], ["name", "like", "x_%"]], fields: ["id", "model", "name", "ttype", "relation", "relation_table", "column1", "column2", "field_description", "store", "compute", "depends", "readonly", "help"], order: "model, id", limit: 100 });
await pause();
out.calendars = await call("resource.calendar", "search_read", { domain: [], fields: ["id", "name", "active", "company_id"], context: ALL, order: "id asc", limit: 50 });
out.calendarLines = await call("resource.calendar.attendance", "search_read", { domain: [], fields: ["id", "calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date"], order: "calendar_id, dayofweek, hour_from", limit: 300 });
await pause();
out.costFields = Object.fromEntries(Object.entries(await call("x_operating_cost", "fields_get", { attributes: ["type", "string", "relation", "selection"] })).filter(([k]) => k.startsWith("x_")));
out.costLines = await call("x_operating_cost", "search_read", { domain: [], fields: Object.keys(out.costFields), context: ALL, order: "id asc", limit: 200 });
await pause();
out.jobViews = await call("ir.ui.view", "search_read", { domain: [["model", "=", "hr.job"]], fields: ["id", "name", "type", "mode", "inherit_id", "priority", "active", "key"], context: ALL, order: "type, priority, id", limit: 60 });
out.employeeViewsCustom = await call("ir.ui.view", "search_read", { domain: [["model", "=", "hr.employee"], ["name", "like", "utak"]], fields: ["id", "name", "type", "mode", "inherit_id", "priority", "active", "arch_db"], context: ALL, order: "id", limit: 30 });
await pause();
out.jobActions = await call("ir.actions.act_window", "search_read", { domain: [["res_model", "=", "hr.job"]], fields: ["id", "name", "view_mode", "domain", "context", "view_id"], context: ALL, order: "id", limit: 30 });
out.utakMenus = await call("ir.ui.menu", "search_read", { domain: [["id", "child_of", 529]], fields: ["id", "name", "parent_id", "action", "sequence", "active"], context: ALL, order: "parent_id, sequence, id", limit: 200 });
await pause();
out.rosterAutomations = await call("base.automation", "search_read", { domain: [["name", "like", "utak.team_roster"]], fields: ["id", "name", "active", "model_id", "trigger", "trigger_field_ids", "filter_domain", "filter_pre_domain", "action_server_ids"], context: ALL, order: "id", limit: 30 });
out.hrAutomations = await call("base.automation", "search_read", { domain: [["model_id.model", "in", ["hr.employee", "hr.job"]]], fields: ["id", "name", "active", "trigger"], context: ALL, order: "id", limit: 30 });

writeFileSync(new URL(`./artifacts/s61-20261006-diag-${label}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
const m2o = (v) => (Array.isArray(v) ? `#${v[0]} ${v[1]}` : "-");
console.log("jobs:", out.jobs.map((j) => `#${j.id} «${j.name}»${j.active ? "" : " (archived)"} emp[${j.employee_ids.join(",")}]`).join(" | ") || "none");
console.log("job x_ fields:", Object.keys(out.jobFields).filter((k) => k.startsWith("x_")).join(", ") || "none");
for (const e of out.employees) console.log(`emp #${e.id} «${e.name}»${e.active ? "" : " (archived)"} job ${m2o(e.job_id)} title «${e.job_title || ""}» contact ${m2o(e.work_contact_id)} roles [${e.x_utak_role_ids}] att ${e.x_utak_attendance} cal ${m2o(e.resource_calendar_id)} wa …${String(e.x_utak_whatsapp || "").slice(-4)} src ${e.x_price_source}/${e.x_price_role}`);
console.log("roles:", out.roles.map((r) => `#${r.id} ${r.x_code}«${r.x_name}»${r.x_active ? "" : "(off)"}`).join(" | "));
console.log("calendars:", out.calendars.map((c) => `#${c.id} «${c.name}»${c.active ? "" : "(archived)"}`).join(" | "));
console.log("cost fields:", Object.entries(out.costFields).map(([k, v]) => `${k}:${v.type}${v.relation ? "→" + v.relation : ""}`).join(", "));
console.log("cost lines:", out.costLines.map((c) => `#${c.id} «${c.x_name}» ${c.x_frequency} ${c.x_date_from}→${c.x_date_to || ""}`).join(" | "));
console.log("job views:", out.jobViews.map((v) => `#${v.id} ${v.type}/${v.mode} «${v.name}»${v.active ? "" : "(off)"}`).join(" | "));
console.log("job actions:", out.jobActions.map((a) => `#${a.id} «${a.name}» ${a.view_mode}`).join(" | "));
console.log("utak menus:", out.utakMenus.map((m) => `#${m.id} «${m.name}» ← ${Array.isArray(m.parent_id) ? m.parent_id[0] : "-"}${m.active ? "" : "(off)"}`).join(" | "));
console.log("roster automations:", out.rosterAutomations.map((a) => `#${a.id} «${a.name}» ${a.trigger} fields[${a.trigger_field_ids}] ${a.active ? "" : "(off)"}`).join(" | "));
console.log("hr automations:", out.hrAutomations.map((a) => `#${a.id} «${a.name}» ${a.trigger}${a.active ? "" : "(off)"}`).join(" | "));
log("diag done");
