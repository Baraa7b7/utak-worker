// § 61 (2026-10-06) — the jobs: the job is fixed and the employee changes (scripts/lib/s61-odoo.mjs and
// scripts/lib/s61-templates.mjs are the data):
//
//   base (BEFORE the worker's code — the code of before § 61 reads none of it):
//   1  hr.job: «أدوار الوظيفة», «جدول الدوام الافتراضي», «مشمول بالتحضير», the five texts, «المستندات
//      المطلوبة», the salary range and the fixed costs (numbers, left empty);
//      x_operating_cost: «الوظيفة» and «الموظف» of a cost line (left empty)
//   2  hr.employee.x_utak_role_ids: its title ← «أدوار إضافية (خارج الوظيفة)» (name and values unchanged)
//   3  the job's form (an extension of hr.job.form), the list «الوظائف» and its menu under «🚚 التوصيل
//      والفريق»; the job on the employee's card, list and kanban; the cost lines' two columns
//   4  «UTAK — الموظفين» (#995) also lists a job's holder whose card carries no role
//   5  Odoo's three sample jobs: archived (their sample employees are archived since § 32)
//   6  the four jobs with their roles, schedule, attendance and texts (a text Baraa edited is never
//      overwritten: only an empty field is filled)
//   7  the job of each holder: براء #6 «مندوب تشغيل», عمر #4 «مندوب تسويق», عثمان #5 «منسق عمليات» —
//      refused when a job would GIVE its holder a role his card does not carry today
//
//   cards (--only=cards, WITH THE DEPLOY — the code of before § 61 reads the card alone):
//   8  the cards of the three: emptied of what their job carries. The effective roles stay the same.
//
//   templates (--only=templates, after scripts/s61-20261006-templates.mjs --status):
//   9  x_whatsapp_template.x_purpose «team_welcome», and the row of utak_team_welcome_v1 as Meta has it
//
//   node scripts/s61-20261006-odoo.mjs [--only=base|cards|templates]             dry-run (base alone when no --only)
//   node scripts/s61-20261006-odoo.mjs [--only=…] --apply
//   node scripts/s61-20261006-odoo.mjs [--only=…] --verify
//   node scripts/s61-20261006-odoo.mjs --rollback --only=cards [--apply]    the cards' roles back, and nothing else
//   node scripts/s61-20261006-odoo.mjs --rollback [--apply]    the cards' roles back FIRST (when not yet), then the
//        holders' jobs off, #995's domain, the title, the sample jobs, and what was created switched off
//        (the four jobs archived, the views and the menu off, the row's purpose to «other»). Nothing is
//        deleted (--drop: by Baraa's decision only, after the worker's code is rolled back).
//
// ROLLBACK ORDER: (1) --rollback --only=cards, (2) THE CODE, (3) --rollback. The code of before § 61
// reads the card alone (a card emptied by (8) would leave its holder without a role), and the code of
// § 61 announces a job taken off its holder: taking the jobs off under it sends Baraa three «📤 خرج».
// Rollback file: scripts/artifacts/s61-20261006-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, order, invoice, payment, cost line or journal entry is written here.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, one, rollbackFile } from "./lib/s40-kit.mjs";
import {
  CALENDAR_MODEL, CARD_ROLES_FIELD, CARD_ROLES_LABEL, COMPANY, COST_FIELDS, COST_MODEL, EMPLOYEE_ACTION, EMPLOYEE_ACTION_DOMAIN, EMPLOYEE_FORM_EXT,
  EMPLOYEE_FORM_TEAM_VIEW, EMPLOYEE_KANBAN_EXT, EMPLOYEE_KANBAN_VIEW, EMPLOYEE_LIST_EXT, EMPLOYEE_LIST_VIEW, EMPLOYEE_MODEL, JOBS, JOB_ACTION, JOB_FIELDS,
  JOB_FORM_EXT, JOB_FORM_VIEW, JOB_LIST_VIEW, JOB_MENU, JOB_MODEL, ROLE_MODEL, SAMPLE_JOBS, SETTINGS_COST_EXT, SETTINGS_VIEW, TEAM_MENU, TPL_MODEL,
  employeeFormExtArch, employeeKanbanExtArch, employeeListExtArch, htmlText, jobContent, jobFormExtArch, jobListArch, settingsCostExtArch,
} from "./lib/s61-odoo.mjs";
import { S61_TEMPLATES } from "./lib/s61-templates.mjs";

const RB = new URL("./artifacts/s61-20261006-odoo-rollback.json", import.meta.url);
const META = new URL("./artifacts/s61-20261006-templates-meta.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s61-20261006-odoo.mjs");
const { rb, save } = ctx;
const c = rb.created, b = rb.before;
const ALL = { active_test: false };
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=")[1] ?? "";
const ONLY = arg("only");
// the cards go with the deploy and the row after Meta's answer: each by its own --only
const on = (part) => (ONLY ? ONLY.split(",").includes(part) : part === "base");
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const m2oId = (v) => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const sorted = (x) => [...x].sort((p, q) => p - q);
const sameSet = (x, y) => JSON.stringify(sorted(x)) === JSON.stringify(sorted(y));
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const EMP_FIELDS = ["id", "name", "active", "job_id", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "resource_calendar_id", "x_price_source", "x_price_role"];
const JOB_READ = ["id", "name", "active", "sequence", "company_id", "employee_ids"];
const JOB_OURS = JOB_FIELDS.map((f) => f.name);
const roles = async () => call(ROLE_MODEL, "search_read", { domain: [], fields: ["id", "x_name", "x_code", "x_active"], context: ALL, order: "id asc", limit: 60 });
const employee = async (id) => (await call(EMPLOYEE_MODEL, "search_read", { domain: [["id", "=", id]], fields: EMP_FIELDS, context: ALL }))[0] ?? null;
const hasJobFields = async () => !!(await one("ir.model.fields", [["model", "=", JOB_MODEL], ["name", "=", JOB_OURS[0]]]));
const jobsByName = async (name, full) => call(JOB_MODEL, "search_read", { domain: [["name", "=", name], ["company_id", "in", [COMPANY, false]]], fields: full ? [...JOB_READ, ...JOB_OURS] : JOB_READ, context: ALL, order: "id asc" });
const calendarByName = async (name) => call(CALENDAR_MODEL, "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active"], context: ALL, order: "id asc" });
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "type", "mode"], context: ALL }))[0] ?? null;
const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
const selection = async (fid) => call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });
const tplRows = async (name) => call(TPL_MODEL, "search_read", { domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]], fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text"], limit: 2 });
const atMeta = (name) => (existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).templates?.[name] ?? null : null);
const langs = async () => (await call("res.lang", "search_read", { domain: [["active", "=", true]], fields: ["code"] })).map((l) => l.code);
const cardLabel = async (lang) => (await call(EMPLOYEE_MODEL, "fields_get", { allfields: [CARD_ROLES_FIELD], attributes: ["string"], context: { lang } }))[CARD_ROLES_FIELD]?.string ?? null;
/** The extension views of this order: [key, name, model, the view it extends (null: a view of its own), its kind, its arch]. */
const VIEWS = [
  ["jobForm", JOB_FORM_EXT, JOB_MODEL, JOB_FORM_VIEW, "form", jobFormExtArch()],
  ["jobList", JOB_LIST_VIEW, JOB_MODEL, null, "list", jobListArch()],
  ["employeeForm", EMPLOYEE_FORM_EXT, EMPLOYEE_MODEL, EMPLOYEE_FORM_TEAM_VIEW, "form", employeeFormExtArch()],
  ["employeeList", EMPLOYEE_LIST_EXT, EMPLOYEE_MODEL, EMPLOYEE_LIST_VIEW, "list", employeeListExtArch()],
  ["employeeKanban", EMPLOYEE_KANBAN_EXT, EMPLOYEE_MODEL, EMPLOYEE_KANBAN_VIEW, "kanban", employeeKanbanExtArch()],
  ["settingsCost", SETTINGS_COST_EXT, "x_pricing_config", SETTINGS_VIEW, "form", settingsCostExtArch()],
];

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const act = async (label, fn) => { log(`✎ ${label}`); if (APPLY) { await fn(); await pause(400); } };
  // the cards first: every role back where the code of before § 61 reads it
  for (const [id, ids] of Object.entries(b.cards ?? {})) {
    await act(`hr.employee #${id}: ${CARD_ROLES_FIELD} ← [${ids.join(", ")}]`, () => call(EMPLOYEE_MODEL, "write", { ids: [Number(id)], vals: { [CARD_ROLES_FIELD]: [[6, 0, ids]] } }));
  }
  if (ONLY === "cards") {
    log(APPLY ? "the cards' roles are back — now roll the worker's code back, then run --rollback again for the rest" : "dry-run: nothing written (add --apply)");
    process.exit(0);
  }
  for (const [id, job] of Object.entries(b.jobOf ?? {})) {
    await act(`hr.employee #${id}: job_id ← ${job || "none"}`, () => call(EMPLOYEE_MODEL, "write", { ids: [Number(id)], vals: { job_id: job || false } }));
  }
  if (b.employeeAction) await act(`act_window #${EMPLOYEE_ACTION}: domain ← ${b.employeeAction.domain}`, () => call("ir.actions.act_window", "write", { ids: [EMPLOYEE_ACTION], vals: { domain: b.employeeAction.domain } }));
  for (const [lang, label] of Object.entries(b.cardLabel ?? {})) {
    await act(`hr.employee.${CARD_ROLES_FIELD} (${lang}): title ← «${label}»`, async () => call("ir.model.fields", "write", { ids: [await fieldId(EMPLOYEE_MODEL, CARD_ROLES_FIELD)], vals: { field_description: label }, context: { lang } }));
  }
  for (const id of b.samples ?? []) await act(`hr.job #${id} (Odoo's sample): active ← true`, () => call(JOB_MODEL, "write", { ids: [id], vals: { active: true } }));
  for (const [key, id] of Object.entries(c.jobs ?? {}).filter(([, v]) => v)) await act(`hr.job #${id} (${key}, created here): archived (not deleted)`, () => call(JOB_MODEL, "write", { ids: [id], vals: { active: false } }));
  if (c.menus?.jobs) await act(`menu #${c.menus.jobs} «${JOB_MENU.name}»: off`, () => call("ir.ui.menu", "write", { ids: [c.menus.jobs], vals: { active: false } }));
  for (const [key, id] of Object.entries(c.views ?? {}).filter(([, v]) => v)) await act(`view #${id} (${key}): off`, () => call("ir.ui.view", "write", { ids: [id], vals: { active: false } }));
  for (const t of S61_TEMPLATES) {
    const row = (await tplRows(t.name))[0];
    if (row && row.x_purpose === t.purpose) await act(`${TPL_MODEL} #${row.id} ${t.name}: x_purpose ${row.x_purpose} → other`, () => call(TPL_MODEL, "write", { ids: [row.id], vals: { x_purpose: "other" } }));
  }
  log(DROP ? "created records and fields: dropped" : "the fields, the purpose, the action and the created rows stay (nothing is deleted)");
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", [c.menus?.jobs]], ["ir.actions.act_window", [c.windows?.jobs]], ["ir.ui.view", Object.values(c.views ?? {})],
      [TPL_MODEL, Object.values(c.rows ?? {})], ["ir.model.fields.selection", Object.values(c.purposes ?? {})],
      [JOB_MODEL, Object.values(c.jobs ?? {})], ["ir.model.fields", [...(c.fields ?? [])].reverse()],
    ]);
  }
  log(APPLY ? "rollback done — the roster's cache drops itself (the automations of hr.employee); verify with scripts/s61-20261006-roles.mts" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const rs = await roles();
  const byCode = new Map(rs.filter((r) => r.x_active).map((r) => [r.x_code, r.id]));
  if (on("base")) {
    const jf = await call(JOB_MODEL, "fields_get", { attributes: ["type", "string", "relation"] });
    for (const f of JOB_FIELDS) check(`${JOB_MODEL}.${f.name}: ${f.ttype}${f.relation ? ` → ${f.relation}` : ""}, «${f.field_description}»`, jf[f.name]?.type === f.ttype && jf[f.name].string === f.field_description && (!f.relation || jf[f.name].relation === f.relation), JSON.stringify(jf[f.name]));
    const cf = await call(COST_MODEL, "fields_get", { attributes: ["type", "string", "relation"] });
    for (const f of COST_FIELDS) check(`${COST_MODEL}.${f.name}: many2one → ${f.relation}, «${f.field_description}»`, cf[f.name]?.type === "many2one" && cf[f.name].relation === f.relation && cf[f.name].string === f.field_description, JSON.stringify(cf[f.name]));
    await pause();
    const costs = await call(COST_MODEL, "search_read", { domain: [], fields: ["id", "x_job_id", "x_employee_id"], context: ALL, limit: 200 });
    check("no cost line was tied to a job or an employee here (Baraa ties them)", costs.every((x) => !x.x_job_id && !x.x_employee_id), JSON.stringify(costs.filter((x) => x.x_job_id || x.x_employee_id)));
    for (const lang of await langs()) check(`the card's field is titled «${CARD_ROLES_LABEL}» (${lang}); its name and kind unchanged`, (await cardLabel(lang)) === CARD_ROLES_LABEL, String(await cardLabel(lang)));
    const ef = await call(EMPLOYEE_MODEL, "fields_get", { allfields: [CARD_ROLES_FIELD], attributes: ["type", "relation"] });
    check(`…${CARD_ROLES_FIELD}: many2many → ${ROLE_MODEL}`, ef[CARD_ROLES_FIELD]?.type === "many2many" && ef[CARD_ROLES_FIELD].relation === ROLE_MODEL, JSON.stringify(ef[CARD_ROLES_FIELD]));
    await pause();
    for (const [key, name, model, parent, type, arch] of VIEWS) {
      const v = await viewByName(name);
      check(`view ${name}: on${parent ? `, an extension of #${parent}` : `, a ${type} of its own`}, as written`, !!v && v.active === true && v.model === model && (parent ? m2oId(v.inherit_id) === parent : !v.inherit_id) && v.arch_db === arch, JSON.stringify(v && { id: v.id, active: v.active, inherit: v.inherit_id, same: v.arch_db === arch }));
    }
    await pause();
    const jobForm = await call(JOB_MODEL, "get_view", { view_id: JOB_FORM_VIEW, view_type: "form" }).catch((e) => ({ error: String(e?.message ?? e) }));
    check("the job's form renders with every field of the order, the roles first (get_view)", typeof jobForm?.arch === "string" && JOB_OURS.every((n) => jobForm.arch.includes(`name="${n}"`)) && jobForm.arch.indexOf('name="x_job_role_ids"') < jobForm.arch.indexOf('name="x_responsibilities"'), String(jobForm?.error ?? "").slice(0, 300));
    const empForm = await call(EMPLOYEE_MODEL, "get_view", { view_type: "form" }).catch((e) => ({ error: String(e?.message ?? e) }));
    check("the employee's card renders with the job before the additional roles (get_view)", typeof empForm?.arch === "string" && /name="job_id"[^>]*string="الوظيفة"/.test(empForm.arch) && empForm.arch.indexOf('string="الوظيفة"') < empForm.arch.indexOf(`name="${CARD_ROLES_FIELD}"`), String(empForm?.error ?? "").slice(0, 300));
    const empList = await call(EMPLOYEE_MODEL, "get_view", { view_id: EMPLOYEE_LIST_VIEW, view_type: "list" }).catch((e) => ({ error: String(e?.message ?? e) }));
    check("the team's list names the job (get_view)", typeof empList?.arch === "string" && empList.arch.includes('name="job_id"') && empList.arch.includes("أدوار إضافية"), String(empList?.error ?? "").slice(0, 300));
    const empKanban = await call(EMPLOYEE_MODEL, "get_view", { view_id: EMPLOYEE_KANBAN_VIEW, view_type: "kanban" }).catch((e) => ({ error: String(e?.message ?? e) }));
    check("the team's cards name the job (get_view)", typeof empKanban?.arch === "string" && empKanban.arch.includes('name="job_id"'), String(empKanban?.error ?? "").slice(0, 300));
    const settings = await call("x_pricing_config", "get_view", { view_id: SETTINGS_VIEW, view_type: "form" }).catch((e) => ({ error: String(e?.message ?? e) }));
    check("«⚙️ الإعدادات» renders with the two columns on the cost lines (get_view)", typeof settings?.arch === "string" && settings.arch.includes('name="x_job_id"') && settings.arch.includes('name="x_employee_id"') && settings.arch.includes('name="x_workdays_calendar_id"'), String(settings?.error ?? "").slice(0, 300));
    await pause();
    const [win] = await call("ir.actions.act_window", "search_read", { domain: [["name", "=", JOB_ACTION]], fields: ["id", "res_model", "view_mode", "view_id"] });
    const listView = await viewByName(JOB_LIST_VIEW);
    check(`action «${JOB_ACTION}»: ${JOB_MODEL}, list then form, our list`, !!win && win.res_model === JOB_MODEL && win.view_mode === "list,form" && m2oId(win.view_id) === listView?.id, JSON.stringify(win));
    const menus = await call("ir.ui.menu", "search_read", { domain: [["name", "=", JOB_MENU.name], ["parent_id", "=", TEAM_MENU]], fields: ["id", "action", "sequence", "active"], context: ALL });
    check(`menu «${JOB_MENU.name}» under UTAK ← «🚚 التوصيل والفريق», on, opens it`, menus.length === 1 && menus[0].active === true && menus[0].action === `ir.actions.act_window,${win?.id}`, JSON.stringify(menus));
    const [empAct] = await call("ir.actions.act_window", "read", { ids: [EMPLOYEE_ACTION], fields: ["domain"] });
    check(`«UTAK — الموظفين» #${EMPLOYEE_ACTION} lists a job's holder too`, empAct?.domain === EMPLOYEE_ACTION_DOMAIN, String(empAct?.domain));
    const listed = await call(EMPLOYEE_MODEL, "search_read", { domain: ["|", [CARD_ROLES_FIELD, "!=", false], ["job_id", "!=", false]], fields: ["id"], order: "id asc" });
    check("…and it lists the three of the team, no sample employee", sameSet(listed.map((e) => e.id), JOBS.map((j) => j.holder).filter(Boolean)), JSON.stringify(listed.map((e) => e.id)));
    const samples = await call(JOB_MODEL, "search_read", { domain: [["id", "in", SAMPLE_JOBS]], fields: ["id", "name", "active"], context: ALL });
    check(`Odoo's sample jobs ${SAMPLE_JOBS.join(", ")} are archived (not deleted)`, samples.length === SAMPLE_JOBS.length && samples.every((s) => s.active === false), JSON.stringify(samples));
    await pause();
    const active = await call(JOB_MODEL, "search_read", { domain: [], fields: ["id", "name"], order: "sequence, id" });
    check(`the active jobs are the four, in order: ${JOBS.map((j) => j.name).join("، ")}`, JSON.stringify(active.map((j) => j.name)) === JSON.stringify(JOBS.map((j) => j.name)), JSON.stringify(active.map((j) => j.name)));
    for (const j of JOBS) {
      const rows = await jobsByName(j.name, true);
      const row = rows[0];
      const cal = j.calendar ? (await calendarByName(j.calendar))[0] : null;
      check(`«${j.name}»: one job, active`, rows.length === 1 && row.active === true, JSON.stringify(rows.map((r) => [r.id, r.active])));
      check(`…roles ${j.roles.join(" + ")} (and no other)`, !!row && sameSet(row.x_job_role_ids, j.roles.map((k) => byCode.get(k))), JSON.stringify(row?.x_job_role_ids));
      check(`…default schedule «${j.calendar ?? "none"}», «مشمول بالتحضير» ${j.attendance ? "on" : "off"}`, !!row && m2oId(row.x_default_calendar_id) === (cal?.id ?? 0) && row.x_job_attendance === j.attendance && (!j.calendar || cal?.active === true), JSON.stringify(row && [row.x_default_calendar_id, row.x_job_attendance]));
      const want = jobContent(j);
      const texts = ["x_responsibilities", "x_day_by_hour", "x_kpis", "x_takeover_list", "x_handover_list"];
      check("…its five texts are filled (each point kept), and the documents", !!row && texts.every((k) => htmlText(row[k]).length > 20) && (c.jobs?.[j.key] !== row.id || texts.every((k) => htmlText(row[k]) === htmlText(want[k]))) && String(row.x_required_docs || "").trim().length > 10, row ? texts.filter((k) => htmlText(row[k]) !== htmlText(want[k])).join(",") : "no row");
      check("…the salary range and the fixed costs are empty (no invented number)", !!row && !row.x_salary_from && !row.x_salary_to && !row.x_fixed_costs, JSON.stringify(row && [row.x_salary_from, row.x_salary_to, row.x_fixed_costs]));
      check(j.holder ? `…held by employee #${j.holder} alone` : "…vacant: no employee", !!row && sameSet(row.employee_ids, j.holder ? [j.holder] : []), JSON.stringify(row?.employee_ids));
      await pause();
    }
    const omar = await employee(4);
    check("عمر: «مصدر أسعار» and «دور الأسعار» as they were (a price source is not a job)", !!omar && omar.x_price_source === (b.priceSource?.[4]?.x_price_source ?? omar.x_price_source) && omar.x_price_role === (b.priceSource?.[4]?.x_price_role ?? omar.x_price_role), JSON.stringify(omar && [omar.x_price_source, omar.x_price_role]));
  }
  if (on("cards")) {
    for (const j of JOBS.filter((x) => x.holder)) {
      const e = await employee(j.holder);
      const job = (await jobsByName(j.name, true))[0];
      const was = b.cardsAtBase?.[j.holder] ?? null;
      check(`#${j.holder} ${e?.name}: holds «${j.name}», active`, !!e && e.active === true && m2oId(e.job_id) === job?.id, JSON.stringify(e?.job_id));
      check("…his card carries none of his job's roles", !!e && !!job && e.x_utak_role_ids.every((r) => !job.x_job_role_ids.includes(r)), JSON.stringify(e?.x_utak_role_ids));
      check(`…his job's roles ∪ his card's = his card's of before § 61 [${(was ?? []).join(", ")}]`, !!e && !!job && !!was && sameSet([...new Set([...job.x_job_role_ids, ...e.x_utak_role_ids])], was), JSON.stringify(e && job && [job.x_job_role_ids, e.x_utak_role_ids]));
      await pause(500);
    }
  }
  if (on("templates")) {
    const tf = await call(TPL_MODEL, "fields_get", { attributes: ["type", "selection"] });
    for (const t of S61_TEMPLATES) {
      check(`${TPL_MODEL}.x_purpose carries «${t.purposeLabel}» (${t.purpose})`, (tf.x_purpose?.selection ?? []).some((s) => s[0] === t.purpose && s[1] === t.purposeLabel), JSON.stringify((tf.x_purpose?.selection ?? []).slice(-3)));
      const rows = await tplRows(t.name);
      const meta = atMeta(t.name);
      check(`one row of ${t.name} (ar), purpose ${t.purpose}, ${t.params} variable(s), as Meta has it (${meta?.status}/${meta?.category})`, rows.length === 1 && rows[0].x_purpose === t.purpose && rows[0].x_param_count === t.params && rows[0].x_meta_id === meta?.id && rows[0].x_meta_status === meta?.status && rows[0].x_category === meta?.category, JSON.stringify(rows));
      const holders = await call(TPL_MODEL, "search_read", { domain: [["x_purpose", "=", t.purpose]], fields: ["id", "x_meta_template_id"] });
      check(`…and no other row holds ${t.purpose}`, holders.length === 1, JSON.stringify(holders));
    }
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? `APPLY (${ONLY || "base"})` : `dry-run (${ONLY || "base"}; nothing is written; add --apply)`);
save(); // the rollback file before the first write
const rs = await roles();
const byCode = new Map(rs.filter((r) => r.x_active).map((r) => [r.x_code, r.id]));
for (const k of new Set(JOBS.flatMap((j) => j.roles))) if (!byCode.get(k)) throw new Error(`role ${k} missing or inactive — stop`);

if (on("base")) {
  log("— 1: the fields of the job, and the two of a cost line");
  await ensureFields(ctx, JOB_MODEL, await modelId(JOB_MODEL), JOB_FIELDS);
  await pause();
  await ensureFields(ctx, COST_MODEL, await modelId(COST_MODEL), COST_FIELDS);
  await pause();

  log(`— 2: the card's field ${CARD_ROLES_FIELD}: its title`);
  const fid = await fieldId(EMPLOYEE_MODEL, CARD_ROLES_FIELD);
  if (!fid) throw new Error(`${EMPLOYEE_MODEL}.${CARD_ROLES_FIELD} not found — stop`);
  for (const lang of await langs()) {
    const cur = await cardLabel(lang);
    if (cur === CARD_ROLES_LABEL) { log(`= title (${lang}) «${cur}»`); continue; }
    log(`✎ ${EMPLOYEE_MODEL}.${CARD_ROLES_FIELD} title (${lang}): «${cur}» → «${CARD_ROLES_LABEL}»`);
    if (APPLY) { b.cardLabel ??= {}; b.cardLabel[lang] ??= cur; save(); await call("ir.model.fields", "write", { ids: [fid], vals: { field_description: CARD_ROLES_LABEL }, context: { lang } }); await pause(500); }
  }

  log("— 3: the views, the list «الوظائف» and its menu");
  c.views ??= {}; b.views ??= {};
  const jobFieldsThere = await hasJobFields();
  for (const [key, name, model, parent, type, arch] of VIEWS) {
    const v = await viewByName(name);
    if (v && v.active && v.arch_db === arch) { log(`= view #${v.id} ${name}`); continue; }
    if (v) {
      log(`✎ view #${v.id} ${name}: ${v.active ? "arch" : "off → on"}`);
      if (APPLY) { if (c.views[key] !== v.id) b.views[key] ??= { id: v.id, active: v.active, arch_db: v.arch_db }; save(); await call("ir.ui.view", "write", { ids: [v.id], vals: { active: true, arch_db: arch } }); }
      continue;
    }
    log(`+ view ${name} (${parent ? `an extension of #${parent}` : `a ${type} of ${model}`})`);
    if (APPLY) {
      if (!jobFieldsThere && !(await hasJobFields())) throw new Error("the job's fields are not there — stop");
      const vals = parent ? { name, model, type, mode: "extension", inherit_id: parent, priority: 99, arch_db: arch } : { name, model, type, priority: 90, arch_db: arch };
      [c.views[key]] = await call("ir.ui.view", "create", { vals_list: [vals] });
      save(); log(`  → #${c.views[key]}`);
      await pause(500);
    }
  }
  const listView = await viewByName(JOB_LIST_VIEW);
  c.windows ??= {}; c.menus ??= {};
  const win = (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", JOB_ACTION]], fields: ["id", "view_id"] }))[0];
  if (win) log(`= action #${win.id} «${JOB_ACTION}»`);
  else {
    log(`+ action «${JOB_ACTION}» (${JOB_MODEL}: list, form)`);
    if (APPLY) { [c.windows.jobs] = await call("ir.actions.act_window", "create", { vals_list: [{ name: JOB_ACTION, res_model: JOB_MODEL, view_mode: "list,form", view_id: listView.id, context: "{}" }] }); save(); log(`  → #${c.windows.jobs}`); }
  }
  const winId = win?.id ?? c.windows.jobs ?? null;
  const menu = (await call("ir.ui.menu", "search_read", { domain: [["name", "=", JOB_MENU.name], ["parent_id", "=", TEAM_MENU]], fields: ["id", "active", "action"], context: ALL }))[0];
  if (menu?.active) log(`= menu #${menu.id} «${JOB_MENU.name}»`);
  else if (menu) { log(`✎ menu #${menu.id} «${JOB_MENU.name}»: off → on`); if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: true, action: `ir.actions.act_window,${winId}` } }); }
  else {
    log(`+ menu «${JOB_MENU.name}» under #${TEAM_MENU} (after «الموظفين»)`);
    if (APPLY) { [c.menus.jobs] = await call("ir.ui.menu", "create", { vals_list: [{ name: JOB_MENU.name, parent_id: TEAM_MENU, action: `ir.actions.act_window,${winId}`, sequence: JOB_MENU.sequence }] }); save(); log(`  → #${c.menus.jobs}`); }
  }
  await pause();

  log(`— 4: «UTAK — الموظفين» #${EMPLOYEE_ACTION}: a job's holder stays listed`);
  const [empAct] = await call("ir.actions.act_window", "read", { ids: [EMPLOYEE_ACTION], fields: ["domain"] });
  if (empAct?.domain === EMPLOYEE_ACTION_DOMAIN) log(`= domain ${empAct.domain}`);
  else {
    log(`✎ act_window #${EMPLOYEE_ACTION}: domain ${empAct?.domain} → ${EMPLOYEE_ACTION_DOMAIN}`);
    if (APPLY) { b.employeeAction ??= { domain: empAct?.domain || false }; save(); await call("ir.actions.act_window", "write", { ids: [EMPLOYEE_ACTION], vals: { domain: EMPLOYEE_ACTION_DOMAIN } }); }
  }
  await pause();

  log("— 5: Odoo's sample jobs");
  const samples = await call(JOB_MODEL, "search_read", { domain: [["id", "in", SAMPLE_JOBS]], fields: ["id", "name", "active", "employee_ids"], context: ALL });
  for (const s of samples) {
    if (JOBS.some((j) => j.name === s.name)) throw new Error(`hr.job #${s.id} «${s.name}» is one of ours — stop`);
    if (s.employee_ids.length) throw new Error(`hr.job #${s.id} «${s.name}» has an active employee — stop`);
    if (!s.active) { log(`= hr.job #${s.id} «${s.name}»: archived`); continue; }
    log(`✎ hr.job #${s.id} «${s.name}» (Odoo's sample, no active employee): archived`);
    if (APPLY) { b.samples ??= []; if (!b.samples.includes(s.id)) b.samples.push(s.id); save(); await call(JOB_MODEL, "write", { ids: [s.id], vals: { active: false } }); }
  }
  await pause();

  log("— 6: the four jobs");
  c.jobs ??= {}; b.jobs ??= {};
  const fieldsThere = await hasJobFields();
  const jobIds = {};
  for (const j of JOBS) {
    const cals = j.calendar ? await calendarByName(j.calendar) : [];
    if (j.calendar && (cals.length !== 1 || !cals[0].active)) throw new Error(`schedule «${j.calendar}»: ${cals.length} found / not active — stop`);
    const calId = cals[0]?.id ?? false;
    const roleIds = j.roles.map((k) => byCode.get(k));
    const rows = await jobsByName(j.name, fieldsThere);
    if (rows.length > 1) throw new Error(`${rows.length} jobs named «${j.name}» — stop`);
    const content = jobContent(j);
    if (!rows.length) {
      log(`+ hr.job «${j.name}»: roles ${j.roles.join(" + ")} [${roleIds.join(", ")}], schedule ${j.calendar ? `«${j.calendar}» #${calId}` : "none"}, «مشمول بالتحضير» ${j.attendance}, ${j.holder ? `for employee #${j.holder}` : "vacant"}`);
      if (APPLY) {
        [c.jobs[j.key]] = await call(JOB_MODEL, "create", { vals_list: [{ name: j.name, company_id: COMPANY, sequence: j.sequence, x_job_role_ids: [[6, 0, roleIds]], x_default_calendar_id: calId, x_job_attendance: j.attendance, ...content }] }, { probe: [["name", "=", j.name]] });
        save(); log(`  → #${c.jobs[j.key]}`);
      }
      jobIds[j.key] = c.jobs[j.key] ?? null;
    } else {
      const row = rows[0];
      jobIds[j.key] = row.id;
      const vals = {};
      if (!row.active) vals.active = true;
      if (fieldsThere) {
        if (!sameSet(row.x_job_role_ids, roleIds)) vals.x_job_role_ids = [[6, 0, roleIds]];
        if (m2oId(row.x_default_calendar_id) !== (calId || 0)) vals.x_default_calendar_id = calId;
        if (row.x_job_attendance !== j.attendance) vals.x_job_attendance = j.attendance;
        // a text Baraa wrote stays: only an empty field is filled
        for (const [k, v] of Object.entries(content)) if (!htmlText(row[k])) vals[k] = v;
      }
      if (!Object.keys(vals).length) log(`= hr.job #${row.id} «${j.name}»: roles [${row.x_job_role_ids?.join(", ")}], schedule #${m2oId(row.x_default_calendar_id) || "-"}, «مشمول بالتحضير» ${row.x_job_attendance}`);
      else {
        log(`✎ hr.job #${row.id} «${j.name}»: ${Object.keys(vals).join(", ")}`);
        if (APPLY) { if (c.jobs[j.key] !== row.id) b.jobs[j.key] ??= { id: row.id, active: row.active, x_job_role_ids: row.x_job_role_ids ?? [], x_default_calendar_id: m2oId(row.x_default_calendar_id) || false, x_job_attendance: row.x_job_attendance ?? false }; save(); await call(JOB_MODEL, "write", { ids: [row.id], vals }); }
      }
    }
    await pause();
  }

  log("— 7: the job of each holder");
  b.jobOf ??= {}; b.cardsAtBase ??= {}; b.priceSource ??= {};
  for (const j of JOBS.filter((x) => x.holder)) {
    const e = await employee(j.holder);
    if (!e?.active) throw new Error(`hr.employee #${j.holder} not found or archived — stop`);
    const roleIds = j.roles.map((k) => byCode.get(k));
    // what he holds today is what he must hold after: the card's roles of before § 61
    const was = b.cardsAtBase[j.holder] ?? e.x_utak_role_ids;
    const gained = roleIds.filter((r) => !was.includes(r));
    if (gained.length) throw new Error(`«${j.name}» would give #${j.holder} ${e.name} a role his card does not carry [${gained.join(", ")}] — stop`);
    const jobId = jobIds[j.key];
    if (jobId && m2oId(e.job_id) === jobId) { log(`= #${j.holder} ${e.name}: «${j.name}» #${jobId} (card roles [${e.x_utak_role_ids.join(", ")}])`); continue; }
    log(`✎ hr.employee #${j.holder} ${e.name}: job ${m2oId(e.job_id) || "none"} → «${j.name}»${jobId ? ` #${jobId}` : ""} (his card's roles [${e.x_utak_role_ids.join(", ")}] stay until the deploy)`);
    if (APPLY) {
      if (!(j.holder in b.jobOf)) b.jobOf[j.holder] = m2oId(e.job_id) || false;
      b.cardsAtBase[j.holder] ??= e.x_utak_role_ids;
      b.priceSource[j.holder] ??= { x_price_source: e.x_price_source, x_price_role: e.x_price_role };
      save();
      await call(EMPLOYEE_MODEL, "write", { ids: [j.holder], vals: { job_id: jobId } });
      const after = await employee(j.holder);
      if (m2oId(after.job_id) !== jobId || !sameSet(after.x_utak_role_ids, e.x_utak_role_ids) || after.x_utak_attendance !== e.x_utak_attendance || m2oId(after.resource_calendar_id) !== m2oId(e.resource_calendar_id) || m2oId(after.work_contact_id) !== m2oId(e.work_contact_id) || after.x_price_source !== e.x_price_source || after.x_price_role !== e.x_price_role) {
        throw new Error(`#${j.holder} is not as planned after the write: ${JSON.stringify(after)} — stop (the rollback takes the job off)`);
      }
    }
    await pause();
  }
}

if (on("cards")) {
  log("— 8: the cards: emptied of what the job carries (the worker's code of § 61 must be live)");
  b.cards ??= {};
  for (const j of JOBS.filter((x) => x.holder)) {
    const e = await employee(j.holder);
    const job = (await jobsByName(j.name, true))[0];
    if (!e?.active || !job?.active) throw new Error(`#${j.holder} or «${j.name}» not there — run the base part first`);
    if (m2oId(e.job_id) !== job.id) throw new Error(`#${j.holder} ${e.name} does not hold «${j.name}» — stop`);
    const keep = e.x_utak_role_ids.filter((r) => !job.x_job_role_ids.includes(r));
    const was = b.cardsAtBase?.[j.holder] ?? e.x_utak_role_ids;
    const effective = [...new Set([...job.x_job_role_ids, ...keep])];
    if (!sameSet(effective, was)) throw new Error(`#${j.holder} ${e.name}: job ∪ card [${sorted(effective).join(", ")}] ≠ his roles of before § 61 [${sorted(was).join(", ")}] — stop`);
    if (sameSet(keep, e.x_utak_role_ids)) { log(`= #${j.holder} ${e.name}: card [${e.x_utak_role_ids.join(", ")}], job [${job.x_job_role_ids.join(", ")}]`); continue; }
    log(`✎ hr.employee #${j.holder} ${e.name}: card roles [${e.x_utak_role_ids.join(", ")}] → [${keep.join(", ")}] (his job «${j.name}» carries [${job.x_job_role_ids.join(", ")}]; effective [${sorted(effective).join(", ")}] as before)`);
    if (APPLY) {
      b.cards[j.holder] ??= e.x_utak_role_ids; save();
      await call(EMPLOYEE_MODEL, "write", { ids: [j.holder], vals: { [CARD_ROLES_FIELD]: [[6, 0, keep]] } });
    }
    await pause();
  }
}

if (on("templates")) {
  log("— 9: the purpose and the row of the welcome template");
  const purposeField = await fieldId(TPL_MODEL, "x_purpose");
  let pu = await selection(purposeField);
  c.purposes ??= {}; c.rows ??= {}; b.rowPurposes ??= {};
  for (const t of S61_TEMPLATES) {
    const meta = atMeta(t.name);
    if (!meta?.id) { log(`✗ no Meta status of ${t.name} — run scripts/s61-20261006-templates.mjs --status first`); process.exit(1); }
    log(`Meta (read ${meta.readAt}): ${t.name} #${meta.id} ${meta.status}/${meta.category}`);
    const have = pu.find((s) => s.value === t.purpose);
    if (have) log(`= ${TPL_MODEL}.x_purpose «${have.name}» #${have.id}`);
    else {
      log(`+ ${TPL_MODEL}.x_purpose: «${t.purposeLabel}» (${t.purpose})`);
      if (APPLY) {
        [c.purposes[t.purpose]] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: purposeField, value: t.purpose, name: t.purposeLabel, sequence: Math.max(0, ...pu.map((s) => s.sequence)) + 1 }] });
        save(); log(`  → #${c.purposes[t.purpose]}`);
        pu = await selection(purposeField);
      }
    }
    await pause();
    const rows = await tplRows(t.name);
    if (rows.length > 1) { log(`✗ ${rows.length} rows of ${t.name} — stop`); process.exit(1); }
    const want = { x_meta_id: meta.id, x_meta_status: meta.status, x_category: meta.category, x_param_count: t.params, x_body_text: t.body, x_purpose: t.purpose };
    if (!rows.length) {
      log(`+ ${TPL_MODEL}: ${t.name} (ar) «${t.label}», purpose ${t.purpose}, ${meta.status}/${meta.category}`);
      if (APPLY) {
        [c.rows[t.name]] = await call(TPL_MODEL, "create", { vals_list: [{
          x_meta_template_id: t.name, x_language: t.language, ...want, x_body: t.body,
          x_label_ar: t.label, x_name: t.label, x_last_synced: nowOdoo(), x_missing_in_meta: false,
        }] }, { probe: [["x_meta_template_id", "=", t.name], ["x_language", "=", t.language]] });
        save(); log(`  → #${c.rows[t.name]}`);
      }
    } else {
      const row = rows[0];
      const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => row[k] !== v));
      if (!Object.keys(diff).length) log(`= ${TPL_MODEL} #${row.id} ${t.name}: ${row.x_meta_status}/${row.x_category}, purpose ${row.x_purpose}`);
      else {
        log(`✎ ${TPL_MODEL} #${row.id} ${t.name}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
        if (APPLY) { if (!c.rows[t.name]) b.rowPurposes[t.name] ??= row.x_purpose || "other"; save(); await call(TPL_MODEL, "write", { ids: [row.id], vals: diff }); }
      }
    }
    await pause();
  }
}
save();
log(APPLY ? `done — verify: node scripts/s61-20261006-odoo.mjs${ONLY ? ` --only=${ONLY}` : ""} --verify` : "dry-run: nothing written");
