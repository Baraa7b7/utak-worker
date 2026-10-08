// § 68 (2026-10-08) — the employee's file: what exists in Odoo today, read-only (search_read / fields_get only;
// nothing is written, nothing is sent). An employee's own numbers (ID, passport, permit) are never printed: a
// field is «filled» or «empty».
//
//   node scripts/s68-20261008-facts.mjs
//
// Out: scripts/artifacts/s68-20261008-facts.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const ALL = { active_test: false };
const pause = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const out = { at: new Date().toISOString() };
const read = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = { error: String(e?.message ?? e).slice(0, 300) }; } await pause(); return out[key]; };
const m2o = (v) => (Array.isArray(v) ? `#${v[0]} ${v[1]}` : v || null);

// 1 — the apps
await read("modules", async () => Object.fromEntries((await call("ir.module.module", "search_read", {
  domain: [["name", "in", ["hr", "hr_attendance", "hr_holidays", "hr_contract", "hr_payroll", "hr_expense", "hr_skills", "hr_fleet", "hr_work_entry", "documents", "documents_hr", "sign", "planning", "hr_presence", "hr_homeworking", "hr_org_chart", "hr_gamification", "hr_recruitment", "hr_appraisal"]]],
  fields: ["name", "state", "shortdesc"], order: "name asc",
})).map((m) => [m.name, m.state])));
await read("models", async () => Object.fromEntries((await call("ir.model", "search_read", {
  domain: [["model", "in", ["hr.attendance", "hr.leave", "hr.leave.type", "hr.contract", "hr.version", "x_team_attendance", "x_utak_attendance", "resource.calendar.leaves", "documents.document", "hr.expense"]]],
  fields: ["id", "model", "name"],
})).map((m) => [m.model, `#${m.id} ${m.name}`])));

// 2 — the attendance rows of today's worker
await read("teamAttendanceFields", async () => (await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_team_attendance"]], fields: ["id", "name", "ttype", "field_description", "relation", "store", "readonly", "compute"], order: "id asc" }))
  .filter((f) => f.name.startsWith("x_")).map((f) => `#${f.id} ${f.name}:${f.ttype}${f.relation ? `→${f.relation}` : ""} «${f.field_description}»${f.compute ? " (compute)" : ""}`));
await read("teamAttendanceStatus", async () => (await call("x_team_attendance", "fields_get", { allfields: ["x_status"], attributes: ["selection", "string"] })).x_status);
await read("teamAttendanceRows", async () => {
  const rows = await call("x_team_attendance", "search_read", { domain: [], fields: ["id", "x_name", "x_employee_id", "x_date", "x_shift_at", "x_sent_at", "x_tapped_at", "x_status", "x_reminder_sent", "x_utak_simulation"], order: "id desc", limit: 400, context: ALL });
  const by = {};
  for (const r of rows) { const k = `${m2o(r.x_employee_id)} · ${r.x_status || "-"}${r.x_utak_simulation ? " · sim" : ""}`; by[k] = (by[k] ?? 0) + 1; }
  return { count: rows.length, by, last: rows.slice(0, 4).map((r) => `#${r.id} ${r.x_date} ${m2o(r.x_employee_id)} [${r.x_status || "-"}] sent ${r.x_sent_at || "-"} tapped ${r.x_tapped_at || "-"}${r.x_utak_simulation ? " sim" : ""}`), first: rows.at(-1)?.x_date ?? null };
});
await read("teamAttendanceUi", async () => ({
  views: (await call("ir.ui.view", "search_read", { domain: [["model", "=", "x_team_attendance"]], fields: ["id", "name", "type", "active", "inherit_id"], context: ALL })).map((v) => `#${v.id} ${v.name} (${v.type}${v.active ? "" : ", off"})`),
  actions: (await call("ir.actions.act_window", "search_read", { domain: [["res_model", "=", "x_team_attendance"]], fields: ["id", "name", "view_mode", "domain", "context"] })).map((a) => `#${a.id} ${a.name} [${a.view_mode}] ${a.domain || ""} ${a.context || ""}`),
  access: (await call("ir.model.access", "search_read", { domain: [["model_id.model", "=", "x_team_attendance"]], fields: ["id", "name", "group_id", "perm_read", "perm_write", "perm_create", "perm_unlink"] })).map((a) => `#${a.id} ${m2o(a.group_id)} r${+a.perm_read}w${+a.perm_write}c${+a.perm_create}u${+a.perm_unlink}`),
}));

// 3 — the employees, and the native document fields of their card
const DOCS = ["identification_id", "id_card", "id_card_name", "passport_id", "passport_expiration_date", "permit_no", "work_permit_expiration_date", "has_work_permit", "work_permit_name", "visa_no", "visa_expire", "driving_license", "driving_license_name", "contract_date_start", "contract_date_end", "first_contract_date", "date_start", "trial_date_end", "certificate", "document_count", "wage", "ssnid", "legal_name", "mobile_phone", "work_phone", "work_permit_scheduled_activity"];
await read("employeeDocFields", async () => {
  const fg = await call("hr.employee", "fields_get", { allfields: DOCS, attributes: ["type", "string", "readonly", "store", "groups", "related", "help"] });
  return Object.fromEntries(DOCS.map((f) => [f, fg[f] ? `${fg[f].type} «${fg[f].string}»${fg[f].readonly ? " readonly" : ""}${fg[f].store === false ? " not-stored" : ""}${fg[f].related ? ` related:${fg[f].related}` : ""}${fg[f].groups ? ` groups:${fg[f].groups}` : ""}` : "ABSENT"]));
});
await read("employeeCustomFields", async () => (await call("ir.model.fields", "search_read", { domain: [["model", "=", "hr.employee"], ["state", "=", "manual"]], fields: ["id", "name", "ttype", "field_description", "relation", "store", "compute"], order: "id asc" }))
  .map((f) => `#${f.id} ${f.name}:${f.ttype}${f.relation ? `→${f.relation}` : ""} «${f.field_description}»${f.compute ? " (compute)" : ""}`));
await read("employees", async () => {
  const present = DOCS.filter((f) => !String(out.employeeDocFields?.[f]).startsWith("ABSENT") && !["wage", "document_count", "legal_name", "mobile_phone", "work_phone"].includes(f));
  const rows = await call("hr.employee", "search_read", { domain: [], fields: ["id", "name", "active", "job_id", "resource_calendar_id", "x_utak_attendance", "x_utak_role_ids", "work_contact_id", "user_id", "company_id", ...present], order: "id asc", context: ALL, limit: 50 });
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, job: m2o(r.job_id), calendar: m2o(r.resource_calendar_id), attendance: r.x_utak_attendance, cardRoles: r.x_utak_role_ids, contact: m2o(r.work_contact_id), user: m2o(r.user_id), dates: { date_start: r.date_start ?? null, contract_date_start: r.contract_date_start ?? null, first_contract_date: r.first_contract_date ?? null }, filled: present.filter((f) => r[f] && !f.includes("date_start") && f !== "first_contract_date") }));
});

// 4 — the screens: the team's form, list, kanban and their extensions; the action; the menus of «🚚 التوصيل والفريق»
await read("views", async () => {
  const base = await call("ir.ui.view", "search_read", { domain: [["id", "in", [2829, 2830, 2831]]], fields: ["id", "name", "type", "mode", "active", "inherit_id", "arch_db", "priority"], context: ALL });
  const ext = await call("ir.ui.view", "search_read", { domain: [["inherit_id", "in", [2829, 2830, 2831]]], fields: ["id", "name", "type", "active", "inherit_id", "arch_db", "priority"], context: ALL, order: "id asc" });
  const search = await call("ir.ui.view", "search_read", { domain: [["model", "=", "hr.employee"], ["type", "=", "search"], ["name", "ilike", "utak"]], fields: ["id", "name", "active", "inherit_id", "arch_db"], context: ALL });
  return { base, ext, search };
});
await read("employeeAction", async () => (await call("ir.actions.act_window", "read", { ids: [995], fields: ["id", "name", "res_model", "view_mode", "view_ids", "view_id", "search_view_id", "domain", "context", "help"] }))[0]);
await read("actionViews", async () => (await call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "=", 995]], fields: ["id", "sequence", "view_mode", "view_id"], order: "sequence asc" })).map((v) => `#${v.id} seq ${v.sequence} ${v.view_mode} → ${m2o(v.view_id)}`));
await read("teamMenus", async () => (await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 546]], fields: ["id", "name", "sequence", "action", "active", "group_ids"], order: "sequence asc, id asc", context: ALL })).map((m) => `#${m.id} «${m.name}» seq ${m.sequence} ${m.action || ""}${m.active ? "" : " (off)"}${(m.group_ids ?? []).length ? ` groups ${m.group_ids}` : ""}`));
await read("teamMenu", async () => (await call("ir.ui.menu", "read", { ids: [546], fields: ["id", "name", "parent_id", "sequence"] }))[0]);

// 5 — schedules and time off
await read("calendars", async () => (await call("resource.calendar", "search_read", { domain: [], fields: ["id", "name", "active", "company_id", "hours_per_day"], context: ALL, order: "id asc" })).map((c) => `#${c.id} «${c.name}»${c.active ? "" : " (archived)"}`));
await read("calendarLines", async () => {
  const rows = await call("resource.calendar.attendance", "search_read", { domain: [["calendar_id", "in", [5]]], fields: ["calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date"], order: "calendar_id, dayofweek, hour_from", limit: 200 });
  return rows.map((l) => `cal ${m2o(l.calendar_id)} day ${l.dayofweek} ${l.hour_from}–${l.hour_to}${l.duration_based ? " (duration)" : ""}${l.date ? ` date ${l.date}` : ""}`);
});
await read("leaveFields", async () => {
  const fg = await call("resource.calendar.leaves", "fields_get", { attributes: ["type", "string", "selection", "required"] });
  return Object.fromEntries(Object.entries(fg).filter(([k]) => !/^(create_|write_|display_name|id$|__)/.test(k)).map(([k, v]) => [k, `${v.type} «${v.string}»${v.required ? " required" : ""}${v.selection ? ` [${v.selection.map((s) => s[0]).join("|")}]` : ""}`]));
});
await read("leaves", async () => {
  const rows = await call("resource.calendar.leaves", "search_read", { domain: [], fields: ["id", "name", "resource_id", "calendar_id", "company_id", "date_from", "date_to"], order: "date_from desc", limit: 30 });
  return { count: rows.length, rows: rows.slice(0, 8).map((r) => `#${r.id} «${r.name || ""}» ${m2o(r.resource_id) ?? "company-wide"} ${r.date_from} → ${r.date_to}`) };
});
await read("leaveUi", async () => ({
  actions: (await call("ir.actions.act_window", "search_read", { domain: [["res_model", "=", "resource.calendar.leaves"]], fields: ["id", "name", "view_mode", "domain"] })).map((a) => `#${a.id} ${a.name} [${a.view_mode}]`),
  utakViews: (await call("ir.ui.view", "search_read", { domain: [["model", "=", "resource.calendar.leaves"], ["name", "ilike", "utak"]], fields: ["id", "name", "type", "active"], context: ALL })).map((v) => `#${v.id} ${v.name} (${v.type})`),
}));

// 6 — the cost lines, the cash, and what an advance would be
await read("costLines", async () => (await call("x_operating_cost", "search_read", { domain: [], fields: ["id", "x_name", "x_amount", "x_frequency", "x_cost_type", "x_date_from", "x_date_to", "x_employee_id", "x_job_id", "x_utak_simulation"], order: "id asc", context: ALL, limit: 100 }))
  .map((c) => `#${c.id} «${c.x_name}» ${c.x_amount}/${c.x_frequency} type ${c.x_cost_type || "-"} ${c.x_date_from || ""}→${c.x_date_to || "…"} employee ${m2o(c.x_employee_id) ?? "-"} job ${m2o(c.x_job_id) ?? "-"}${c.x_utak_simulation ? " sim" : ""}`));
await read("costType", async () => (await call("x_operating_cost", "fields_get", { allfields: ["x_cost_type", "x_frequency"], attributes: ["selection", "string"] })));
await read("cashJournals", async () => (await call("account.journal", "search_read", { domain: [["id", "in", [19, 21, 13]]], fields: ["id", "name", "code", "type", "default_account_id"] })).map((j) => `#${j.id} ${j.code} «${j.name}» ${j.type} → ${m2o(j.default_account_id)}`));
await read("advanceAccounts", async () => (await call("account.account", "search_read", { domain: ["|", "|", "|", ["name", "ilike", "سلف"], ["name", "ilike", "عهد"], ["name", "ilike", "advance"], ["name", "ilike", "موظف"]], fields: ["id", "code", "name", "account_type"], limit: 40 })).map((a) => `#${a.id} ${a.code} «${a.name}» ${a.account_type}`));
await read("cashByCollector", async () => {
  const rows = await call("x_payment", "search_read", { domain: [["x_method", "=", "cash"], ["x_utak_simulation", "!=", true]], fields: ["id", "x_amount", "x_collected_by", "x_collected_at"], order: "id desc", limit: 500 });
  const by = {};
  for (const r of rows) { const k = m2o(r.x_collected_by) ?? "nobody"; by[k] ??= { n: 0, total: 0, last: null }; by[k].n++; by[k].total = Math.round((by[k].total + (Number(r.x_amount) || 0)) * 100) / 100; by[k].last ??= r.x_collected_at; }
  return { count: rows.length, by };
});
await read("methodSelection", async () => (await call("x_payment", "fields_get", { allfields: ["x_method"], attributes: ["selection"] })).x_method?.selection);

// 7 — what a performance figure could be read from
await read("roles", async () => (await call("x_employee_role", "search_read", { domain: [], fields: ["id", "x_name", "x_code", "x_active"], context: ALL, order: "id asc" })).map((r) => `#${r.id} ${r.x_code} «${r.x_name}»${r.x_active ? "" : " (off)"}`));
await read("routeModels", async () => (await call("ir.model", "search_read", { domain: ["|", "|", "|", ["model", "ilike", "x_%route%"], ["model", "ilike", "x_%stop%"], ["model", "ilike", "x_%deliver%"], ["model", "ilike", "x_%purchase%"]], fields: ["id", "model", "name"] })).map((m) => `#${m.id} ${m.model} «${m.name}»`));
await read("complaintKinds", async () => (await call("x_complaint", "fields_get", { allfields: ["x_kind", "x_type", "x_status", "x_decision"], attributes: ["selection", "string"] })));
await read("counts", async () => ({
  ordersDelivered: await call("x_daily_order", "search_count", { domain: [["x_state", "=", "delivered"], ["x_utak_simulation", "!=", true]] }),
  complaints: await call("x_complaint", "search_count", { domain: [["x_is_simulation", "!=", true]] }),
  invoices: await call("x_invoice", "search_count", { domain: [["x_utak_simulation", "!=", true]] }),
  payments: await call("x_payment", "search_count", { domain: [["x_utak_simulation", "!=", true]] }),
}));
await read("orderFields", async () => {
  const fg = await call("x_daily_order", "fields_get", { attributes: ["type", "string"] });
  return Object.fromEntries(Object.entries(fg).filter(([k]) => /deliver|driver|route|confirm|state|date/.test(k)).map(([k, v]) => [k, `${v.type} «${v.string}»`]));
});
await read("lineReturn", async () => (await call("x_daily_order_line", "fields_get", { allfields: ["x_return_reason", "x_return_qty", "x_status"], attributes: ["type", "string", "selection"] })));

// 8 — who would see a «Baraa alone» tab, and what calls the roster's hook
await read("users", async () => (await call("res.users", "search_read", { domain: [["share", "=", false]], fields: ["id", "name", "active"], context: ALL, order: "id asc" })).map((u) => `#${u.id} «${u.name}»${u.active ? "" : " (off)"}`));
await read("automations", async () => (await call("base.automation", "search_read", { domain: [["model_id.model", "in", ["hr.employee", "resource.calendar.attendance", "resource.calendar.leaves", "x_team_attendance", "hr.job"]]], fields: ["id", "name", "active", "trigger", "model_id"], context: ALL, order: "id asc" })).map((a) => `#${a.id} «${a.name}» ${a.trigger} on ${m2o(a.model_id)}${a.active ? "" : " (off)"}`));
await read("settingsCalendar", async () => (await call("x_pricing_config", "read", { ids: [1], fields: ["x_workdays_calendar_id"] }))[0]);

writeFileSync(new URL("./artifacts/s68-20261008-facts.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
const brief = (k) => { const v = out[k]; return v?.error ? `✗ ${v.error}` : JSON.stringify(v); };
for (const k of ["modules", "models", "teamAttendanceFields", "teamAttendanceStatus", "teamAttendanceRows", "teamAttendanceUi", "employeeDocFields", "employeeCustomFields", "employees", "actionViews", "teamMenus", "calendars", "calendarLines", "leaveFields", "leaves", "leaveUi", "costLines", "cashJournals", "advanceAccounts", "cashByCollector", "roles", "routeModels", "counts", "orderFields", "users", "automations", "settingsCalendar"]) console.log(`## ${k}\n${brief(k)}`);
console.log("out: scripts/artifacts/s68-20261008-facts.json");
