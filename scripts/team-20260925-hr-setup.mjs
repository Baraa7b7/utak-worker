// The team moves to the Employees app (hr.employee) — 2026-09-25, STATUS § 31.
//
// hr.employee becomes the ONLY source for the team. This script builds the
// Odoo side; the worker reads nothing else (src/team-roster.ts).
//   1. fields
//      hr.employee.x_utak_role_ids          «أدوار UTAK»  (many2many x_employee_role, codes unchanged)
//      hr.employee.x_utak_attendance        «مشمول بالتحضير» (boolean, off)
//      hr.employee.x_utak_whatsapp          «رقم واتساب» (computed from the Work Contact: x_whatsapp_number, else phone)
//      hr.employee.x_utak_neighborhood_ids  «أحياء التوصيل» (many2many x_neighborhood; was res.partner.x_neighborhoods)
//      x_team_attendance.x_employee_id      «الموظف» (the old x_partner_id stays, relabelled, for rollback)
//   2. two employees, Omar (Work Contact = partner 9) and Othman (partner 15):
//      their roles, Omar's neighborhoods and hire date; NO working schedule and
//      «مشمول بالتحضير» off (Baraa sets both). No new partner. Ahmed: none.
//   3. existing x_team_attendance rows → x_employee_id (by Work Contact).
//   4. UI: the UTAK group on the employee form (roles, «مشمول بالتحضير»,
//      Work Contact, number, neighborhoods); a UTAK employees action on
//      hr.employee (cards: each employee once with roles; list: roles,
//      schedule, «مشمول بالتحضير», number; filters «مشمول بالتحضير» and
//      «بلا جدول عمل»); menu «الموظفين» (551) → it; «حضور الفريق» shows the
//      employee; a new menu «إجازات الفريق» (resource.calendar.leaves); the
//      customers action (926) excludes the team through hr.employee.
//   5. automations: a change to an employee, a schedule line or a time off
//      posts to the sim worker's /odoo/hook/team-roster, which drops the
//      roster cache (the same pattern as automation 13).
//
// res.partner.x_role_ids / x_shift_start / x_neighborhoods stay in the
// database for rollback only: nothing reads them, and no menu shows them.
// No module is installed, nothing is deleted (rollback deletes only what
// this script created).
//
//   node scripts/team-20260925-hr-setup.mjs                 # dry run (default)
//   node scripts/team-20260925-hr-setup.mjs --apply
//   node scripts/team-20260925-hr-setup.mjs --verify        # read-only checks
//   node scripts/team-20260925-hr-setup.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/team-20260925-hr-setup-rollback.json. The
// pre-state is on disk before the first write, and every created id is
// appended as soon as it exists. Roll the worker back first.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: no WhatsApp from this script");
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const VERIFY = args.includes("--verify");
const RB = new URL("./artifacts/team-20260925-hr-setup-rollback.json", import.meta.url).pathname;

const OMAR = 9, OTHMAN = 15;                 // res.partner (their WhatsApp chats)
const TEAM_MENU_PARENT = 546;                // UTAK/🚚 التوصيل والفريق
const EMP_MENU = 551;                        // «الموظفين» → action 927 (res.partner) before
const OLD_EMP_ACTION = 927;
const CUSTOMERS_ACTION = 926;                // «قائمة العملاء»
const ATT_LIST = 2823, ATT_SEARCH = 2824;    // x_team_attendance views (§ 29)
const HR_FORM = "view_employee_form", HR_SEARCH = "view_employee_filter";
const HOOK_PATH = "/odoo/hook/team-roster";
const LEAVES_MENU_SEQ = 16;                  // after «حضور الفريق» (15)

const ROLE_CODES = { OMAR: ["driver", "warehouse", "collector"], OTHMAN: ["admin"] };
const CUSTOMERS_DOMAIN = "[('customer_rank', '>', 0), '!', ('employee_ids.x_utak_role_ids', '!=', False)]";
const EMP_ACTION_DOMAIN = "[('x_utak_role_ids', '!=', False)]";

const WA_COMPUTE = `for record in self:
    contact = record.work_contact_id
    record['x_utak_whatsapp'] = contact.x_whatsapp_number or contact.phone or False
`;
const FIELDS = [
  { model: "hr.employee", name: "x_utak_role_ids", ttype: "many2many", relation: "x_employee_role",
    relation_table: "x_hr_employee_utak_role_rel", column1: "hr_employee_id", column2: "x_employee_role_id",
    field_description: "أدوار UTAK",
    help: "سائق / شراء / محصّل / مدير. من له دور يظهر في UTAK ← الموظفين، وتصله مهام دوره عبر واتساب (رقمه من «جهة اتصال واتساب»)." },
  { model: "hr.employee", name: "x_utak_attendance", ttype: "boolean", field_description: "مشمول بالتحضير",
    help: "يصله زر «بدء الدوام» مع بداية أول فترة في جدول عمله، ويُسجَّل حاضراً / متأخراً / غائباً. يلزم معه جدول عمل (ساعات العمل)؛ اليوم الذي لا سطر له في الجدول إجازة أسبوعية، والإجازات من UTAK ← إجازات الفريق." },
  { model: "hr.employee", name: "x_utak_whatsapp", ttype: "char", field_description: "رقم واتساب",
    compute: WA_COMPUTE, depends: "work_contact_id.x_whatsapp_number,work_contact_id.phone", store: false, readonly: true,
    help: "من «جهة اتصال واتساب» (Work Contact): رقم الواتساب، وإلا الهاتف." },
  { model: "hr.employee", name: "x_utak_neighborhood_ids", ttype: "many2many", relation: "x_neighborhood",
    relation_table: "x_hr_employee_utak_neigh_rel", column1: "hr_employee_id", column2: "x_neighborhood_id",
    field_description: "أحياء التوصيل", help: "للسائق: طلبات هذه الأحياء تذهب إليه أولاً، والباقي بالتناوب." },
  { model: "x_team_attendance", name: "x_employee_id", ttype: "many2one", relation: "hr.employee", on_delete: "set null",
    index: true, field_description: "الموظف" },
];
const OLD_PARTNER_LABEL = "جهة الاتصال (للتراجع)";

// ---------------------------------------------------------------- views
const FORM_EXT = `<data>
  <xpath expr="//group[@name='schedule']" position="after">
    <group name="utak_team" string="UTAK — الفريق">
      <field name="x_utak_role_ids" widget="many2many_tags" options="{'color_field': 'x_color', 'no_create_edit': True}"/>
      <field name="x_utak_attendance" widget="boolean_toggle"/>
      <field name="work_contact_id" string="جهة اتصال واتساب" options="{'no_create': True}"/>
      <field name="x_utak_whatsapp" readonly="1"/>
      <field name="x_utak_neighborhood_ids" widget="many2many_tags"/>
    </group>
  </xpath>
</data>`;
const KANBAN = `<kanban sample="1">
  <field name="name"/>
  <field name="x_utak_role_ids"/>
  <field name="x_utak_whatsapp"/>
  <field name="resource_calendar_id"/>
  <field name="x_utak_attendance"/>
  <templates>
    <t t-name="card">
      <div class="d-flex flex-column p-2">
        <div class="fw-bold fs-5 mb-1"><field name="name"/></div>
        <div class="mb-2"><field name="x_utak_role_ids" widget="many2many_tags" options="{'color_field': 'x_color'}"/></div>
        <div class="text-muted small mb-1"><i class="fa fa-whatsapp me-1"/><field name="x_utak_whatsapp"/></div>
        <div class="small mb-1"><i class="fa fa-clock-o me-1"/><field name="resource_calendar_id"/><span t-if="!record.resource_calendar_id.raw_value" class="text-warning">بلا جدول عمل</span></div>
        <div class="small"><span t-if="record.x_utak_attendance.raw_value">✅ مشمول بالتحضير</span><span t-else="" class="text-muted">غير مشمول بالتحضير</span></div>
      </div>
    </t>
  </templates>
</kanban>`;
const LIST = `<list string="الموظفين" sample="1">
  <field name="name"/>
  <field name="x_utak_role_ids" string="الأدوار" widget="many2many_tags" options="{'color_field': 'x_color'}"/>
  <field name="resource_calendar_id" string="جدول العمل"/>
  <field name="x_utak_attendance" string="مشمول بالتحضير" widget="boolean_toggle"/>
  <field name="x_utak_whatsapp" string="الرقم"/>
</list>`;
const SEARCH_EXT = `<data>
  <xpath expr="//search" position="inside">
    <separator/>
    <filter name="utak_attendance" string="مشمول بالتحضير" domain="[('x_utak_attendance', '=', True)]"/>
    <filter name="utak_no_calendar" string="بلا جدول عمل" domain="[('x_utak_attendance', '=', True), ('resource_calendar_id', '=', False)]"/>
  </xpath>
</data>`;
const ATT_LIST_ARCH = `<list string="حضور الفريق" default_order="x_date desc, x_shift_at asc" create="0" decoration-danger="x_status == 'absent'" decoration-warning="x_status == 'late'" decoration-success="x_status == 'present'">
  <field name="x_date"/>
  <field name="x_employee_id"/>
  <field name="x_shift_at"/>
  <field name="x_sent_at"/>
  <field name="x_tapped_at"/>
  <field name="x_status"/>
  <field name="x_reminder_sent"/>
</list>`;
const ATT_SEARCH_ARCH = `<search string="حضور الفريق">
  <field name="x_employee_id"/>
  <filter name="today" string="اليوم" domain="[('x_date', '=', context_today().strftime('%Y-%m-%d'))]"/>
  <separator/>
  <filter name="absent" string="غائب" domain="[('x_status', '=', 'absent')]"/>
  <filter name="late" string="متأخر" domain="[('x_status', '=', 'late')]"/>
  <filter name="present" string="حاضر" domain="[('x_status', '=', 'present')]"/>
  <group>
    <filter name="by_employee" string="الموظف" context="{'group_by': 'x_employee_id'}"/>
    <filter name="by_date" string="التاريخ" context="{'group_by': 'x_date'}"/>
  </group>
</search>`;
const NAMES = {
  formExt: "utak.hr_employee_form.team",
  kanban: "utak.hr_employee_kanban",
  list: "utak.hr_employee_list",
  search: "utak.hr_employee_search",
  empAction: "UTAK — الموظفين",
  leavesAction: "UTAK — إجازات الفريق",
  leavesMenu: "إجازات الفريق",
};
const HOOK_MODELS = ["hr.employee", "resource.calendar.attendance", "resource.calendar.leaves"];
const saName = (m) => `utak.team_roster.hook ← ${m}`;
const baName = (m, t) => `utak.team_roster ← ${m} (${t})`;
const TRIGGERS = ["on_create_or_write", "on_unlink"];

// ---------------------------------------------------------------- schema check (fields_get)
async function assertFields(model, names) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !(n in f));
  if (missing.length) throw new Error(`${model}: fields missing on the tenant: ${missing.join(", ")}`);
}
await assertFields("ir.model.fields", ["model_id", "model", "name", "field_description", "ttype", "relation", "relation_table", "column1", "column2", "compute", "depends", "store", "readonly", "on_delete", "index", "help"]);
await assertFields("hr.employee", ["name", "work_contact_id", "resource_calendar_id", "resource_id", "tz", "company_id", "contract_date_start", "image_1920", "active"]);
await assertFields("resource.resource", ["calendar_id", "tz"]);
await assertFields("resource.calendar.attendance", ["calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date", "recurrency"]);
await assertFields("resource.calendar.leaves", ["name", "resource_id", "calendar_id", "company_id", "date_from", "date_to", "count_as"]);
await assertFields("res.partner", ["x_role_ids", "x_shift_start", "x_neighborhoods", "x_hire_date", "x_whatsapp_number", "employee_ids", "image_1920"]);
await assertFields("x_team_attendance", ["x_partner_id", "x_date", "x_status"]);
await assertFields("ir.ui.view", ["name", "model", "type", "arch_base", "arch_db", "inherit_id", "mode", "priority"]);
await assertFields("ir.actions.act_window", ["name", "res_model", "view_mode", "context", "domain", "search_view_id", "view_id", "help"]);
await assertFields("ir.actions.act_window.view", ["act_window_id", "view_id", "view_mode", "sequence"]);
await assertFields("ir.actions.server", ["name", "model_id", "state", "webhook_url"]);
await assertFields("base.automation", ["name", "model_id", "trigger", "trigger_field_ids", "action_server_ids", "active", "filter_domain"]);
await assertFields("ir.ui.menu", ["name", "parent_id", "action", "sequence"]);

const find = async (model, domain) => (await call(model, "search_read", { domain, fields: ["id"], limit: 50, context: { active_test: false } })).map((r) => r.id);
const one = async (model, domain) => (await find(model, domain))[0];
const modelId = async (m) => one("ir.model", [["model", "=", m]]);
const xmlId = async (module, name) => (await call("ir.model.data", "search_read", { domain: [["module", "=", module], ["name", "=", name]], fields: ["res_id"], limit: 1 }))[0]?.res_id;
const PARTNER_SNAP_FIELDS = ["name", "phone", "email", "x_whatsapp_number", "image_1920", "active", "customer_rank", "supplier_rank", "x_contact_class", "x_role_ids", "x_shift_start", "x_neighborhoods", "x_hire_date", "x_wa_channel_id", "company_id"];
const roleIdsByCode = async () => new Map((await call("x_employee_role", "search_read", { domain: [["x_active", "=", true]], fields: ["id", "x_code"] })).map((r) => [r.x_code, r.id]));
const customersCount = async (domain) => call("res.partner", "search_count", { domain });
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null);
const saveRb = (rb) => writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");

async function hookUrl() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", "wa_inbox.reply_webhook"]], fields: ["webhook_url"], limit: 1 });
  const m = /^(https?:\/\/[^/]+)\/.*[?&]token=([^&]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error("could not read origin/token from wa_inbox.reply_webhook");
  if (!m[1].includes("utak-worker-sim")) throw new Error(`webhook origin is not the sim worker: ${m[1]}`);
  return { origin: m[1], url: `${m[1]}${HOOK_PATH}?token=${m[2]}` };
}

async function snapshot() {
  const partners = await call("res.partner", "read", { ids: [OMAR, OTHMAN], fields: PARTNER_SNAP_FIELDS, context: { active_test: false } });
  const [menu] = await call("ir.ui.menu", "read", { ids: [EMP_MENU], fields: ["name", "action", "parent_id", "sequence"] });
  const [a926] = await call("ir.actions.act_window", "read", { ids: [CUSTOMERS_ACTION], fields: ["domain"] });
  const views = await call("ir.ui.view", "read", { ids: [ATT_LIST, ATT_SEARCH], fields: ["arch_db"] });
  const [pf] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_team_attendance"], ["name", "=", "x_partner_id"]], fields: ["id", "field_description"] });
  const attRows = await call("x_team_attendance", "search_count", { domain: [] });
  return {
    at: new Date().toISOString(),
    partners: partners.map((p) => ({ ...p, image_1920: p.image_1920 ? `<${String(p.image_1920).length} b64 chars>` : false })),
    partnerImages: Object.fromEntries(partners.map((p) => [p.id, p.image_1920 || false])),
    menu551: menu, action926Domain: a926.domain,
    customersBefore: await customersCount(eval926(a926.domain)),
    customersBeforeIds: (await call("res.partner", "search_read", { domain: eval926(a926.domain), fields: ["id"] })).map((r) => r.id),
    attViews: Object.fromEntries(views.map((v) => [v.id, v.arch_db])),
    attPartnerField: pf, attRows,
    employeesBefore: await find("hr.employee", [["active", "in", [true, false]]]),
  };
}
// the customers action domain in JSON (for search_count), both the old and the new form
function eval926(d) {
  if (d === "[('customer_rank', '>', 0), ('x_role_ids', '=', False)]") return [["customer_rank", ">", 0], ["x_role_ids", "=", false]];
  if (d === CUSTOMERS_DOMAIN) return [["customer_rank", ">", 0], "!", ["employee_ids.x_utak_role_ids", "!=", false]];
  throw new Error(`unexpected action ${CUSTOMERS_ACTION} domain: ${d}`);
}

// ================================================================ rollback
if (ROLLBACK) {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file: ${RB}`);
  const c = rb.created ?? {};
  const act = async (label, fn) => { console.log(`${APPLY ? "" : "would "}${label}`); if (APPLY) await fn(); };
  const del = async (model, ids0) => {
    const ids = [ids0].flat().filter(Boolean);
    if (!ids.length) return;
    const alive = await find(model, [["id", "in", ids]]);
    if (alive.length) await act(`delete ${model} ${alive.join(",")}`, () => call(model, "unlink", { ids: alive }));
  };
  await del("base.automation", c.automations);
  await del("ir.actions.server", c.serverActions);
  if (c.menu551) await act(`menu ${EMP_MENU}: action ← ${rb.before.menu551.action}`, () => call("ir.ui.menu", "write", { ids: [EMP_MENU], vals: { action: rb.before.menu551.action } }));
  await del("ir.ui.menu", c.leavesMenu);
  await del("ir.actions.act_window", [c.empAction, c.leavesAction]);
  await del("ir.ui.view", [c.formExt, c.kanban, c.list, c.search]);
  if (c.action926) await act(`action ${CUSTOMERS_ACTION}: domain ← ${rb.before.action926Domain}`, () => call("ir.actions.act_window", "write", { ids: [CUSTOMERS_ACTION], vals: { domain: rb.before.action926Domain } }));
  for (const id of c.attViews ?? []) await act(`view ${id}: arch ← before`, () => call("ir.ui.view", "write", { ids: [id], vals: { arch_base: rb.before.attViews[id] } }));
  if (c.attPartnerLabel) await act(`x_team_attendance.x_partner_id label ← «${rb.before.attPartnerField.field_description}»`, () => call("ir.model.fields", "write", { ids: [rb.before.attPartnerField.id], vals: { field_description: rb.before.attPartnerField.field_description } }));
  // the employees this script created (their Work Contacts stay: they were the partners before)
  for (const [pid, empId] of Object.entries(c.employees ?? {})) {
    const alive = await find("hr.employee", [["id", "=", empId]]);
    if (alive.length) await act(`delete hr.employee ${empId} (Work Contact ${pid} stays)`, () => call("hr.employee", "unlink", { ids: alive }));
  }
  for (const p of rb.before.partners) {
    const img = rb.before.partnerImages[p.id];
    await act(`res.partner ${p.id}: image ← ${img ? "before" : "none"}`, () => call("res.partner", "write", { ids: [p.id], vals: { image_1920: img || false } }));
  }
  const fieldIds = Object.values(c.fields ?? {});
  await del("ir.model.fields", fieldIds.filter((id) => id !== c.fields?.["x_team_attendance.x_employee_id"]));
  await del("ir.model.fields", c.fields?.["x_team_attendance.x_employee_id"]);
  console.log(APPLY ? "rollback done" : "dry run: nothing changed (add --apply)");
  process.exit(0);
}

// ================================================================ verify (read-only)
async function verify() {
  const rb = readRb();
  const c = rb.created;
  const checks = [];
  const push = (name, cond, detail = "") => checks.push([detail ? `${name} — ${detail}` : name, !!cond]);
  const ef = await call("hr.employee", "fields_get", { attributes: ["type", "string", "relation", "store"] });
  const af = await call("x_team_attendance", "fields_get", { attributes: ["type", "string", "relation"] });
  for (const d of FIELDS) {
    const f = (d.model === "hr.employee" ? ef : af)[d.name];
    push(`${d.model}.${d.name} ${d.ttype} «${d.field_description}»`, f?.type === d.ttype && f?.string === d.field_description && (!d.relation || f?.relation === d.relation));
  }
  push("x_utak_whatsapp is not stored (computed from the Work Contact)", ef.x_utak_whatsapp?.store === false);
  push(`x_team_attendance.x_partner_id relabelled «${OLD_PARTNER_LABEL}»`, af.x_partner_id?.string === OLD_PARTNER_LABEL);
  const roles = await roleIdsByCode();
  const emps = await call("hr.employee", "search_read", {
    domain: [["x_utak_role_ids", "!=", false]],
    fields: ["id", "name", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp", "x_utak_neighborhood_ids", "resource_calendar_id", "resource_id", "tz", "contract_date_start", "active"],
    order: "id asc",
  });
  push("exactly two employees with a UTAK role", emps.length === 2, emps.map((e) => `${e.id} ${e.name}`).join(", "));
  const byContact = new Map(emps.map((e) => [e.work_contact_id?.[0], e]));
  for (const [key, pid] of [["OMAR", OMAR], ["OTHMAN", OTHMAN]]) {
    const e = byContact.get(pid);
    const want = ROLE_CODES[key].map((code) => roles.get(code)).sort();
    push(`${key}: employee on Work Contact ${pid}`, !!e && e.id === c.employees?.[pid]);
    if (!e) continue;
    push(`${key}: roles ${ROLE_CODES[key].join(",")}`, JSON.stringify([...e.x_utak_role_ids].sort()) === JSON.stringify(want));
    push(`${key}: no working schedule, «مشمول بالتحضير» off`, e.resource_calendar_id === false && e.x_utak_attendance === false);
    const [res] = await call("resource.resource", "read", { ids: [e.resource_id[0]], fields: ["calendar_id", "tz"] });
    push(`${key}: resource ${e.resource_id[0]} has no calendar either, tz Asia/Riyadh`, res.calendar_id === false && e.tz === "Asia/Riyadh", JSON.stringify(res));
    const [p] = await call("res.partner", "read", { ids: [pid], fields: ["x_whatsapp_number"] });
    push(`${key}: number from the Work Contact = ${e.x_utak_whatsapp}`, e.x_utak_whatsapp && e.x_utak_whatsapp === p.x_whatsapp_number);
  }
  const omar = byContact.get(OMAR);
  if (omar) push("OMAR: neighborhoods 1,2 and hire date 2025-01-01", JSON.stringify([...omar.x_utak_neighborhood_ids].sort()) === "[1,2]" && omar.contract_date_start === "2025-01-01");
  // the partners: the chats are untouched
  const now = await call("res.partner", "read", { ids: [OMAR, OTHMAN], fields: PARTNER_SNAP_FIELDS, context: { active_test: false } });
  for (const p of now) {
    const b = rb.before.partners.find((x) => x.id === p.id);
    const same = PARTNER_SNAP_FIELDS.filter((f) => f !== "image_1920").every((f) => JSON.stringify(p[f]) === JSON.stringify(b[f]));
    const img = (p.image_1920 || false) === (rb.before.partnerImages[p.id] || false);
    push(`partner ${p.id} ${p.name}: name, numbers, roles, class, channel, image unchanged`, same && img);
  }
  push("no other employee created", (await find("hr.employee", [["active", "in", [true, false]]])).length === rb.before.employeesBefore.length + 2);
  // UI
  const ids = [c.kanban, c.list, c.search];
  const v = await call("hr.employee", "get_views", { views: [[c.kanban, "kanban"], [c.list, "list"], [false, "form"], [c.search, "search"]] });
  const form = v.views.form.arch, kan = v.views.kanban.arch, lst = v.views.list.arch, srch = v.views.search.arch;
  for (const f of ["x_utak_role_ids", "x_utak_attendance", "work_contact_id", "x_utak_whatsapp", "x_utak_neighborhood_ids"]) push(`employee form (Employees app) shows ${f}`, form.includes(`name="${f}"`));
  push("employee form: the UTAK group sits after «Schedule»", form.indexOf('name="utak_team"') > form.indexOf('name="schedule"'));
  push("cards: no group-by (each employee once) with roles", !kan.includes("default_group_by") && kan.includes('name="x_utak_role_ids"'));
  for (const f of ["x_utak_role_ids", "resource_calendar_id", "x_utak_attendance", "x_utak_whatsapp"]) push(`list column ${f}`, lst.includes(`name="${f}"`));
  push("search: «مشمول بالتحضير» and «بلا جدول عمل»", srch.includes('name="utak_attendance"') && srch.includes('name="utak_no_calendar"'));
  const [ea] = await call("ir.actions.act_window", "read", { ids: [c.empAction], fields: ["res_model", "domain", "view_mode", "search_view_id", "view_ids"] });
  push(`action ${c.empAction}: hr.employee with a UTAK role`, ea.res_model === "hr.employee" && ea.domain === EMP_ACTION_DOMAIN && ea.search_view_id?.[0] === c.search);
  const avs = await call("ir.actions.act_window.view", "read", { ids: ea.view_ids, fields: ["view_mode", "view_id"] });
  push("action opens the UTAK cards and list", avs.some((a) => a.view_mode === "kanban" && a.view_id?.[0] === c.kanban) && avs.some((a) => a.view_mode === "list" && a.view_id?.[0] === c.list));
  const [menu] = await call("ir.ui.menu", "read", { ids: [EMP_MENU], fields: ["action", "parent_id"] });
  push(`menu ${EMP_MENU} «الموظفين» → action ${c.empAction}`, menu.action === `ir.actions.act_window,${c.empAction}`);
  const [lm] = await call("ir.ui.menu", "read", { ids: [c.leavesMenu], fields: ["name", "action", "parent_id", "sequence"] });
  push("menu «إجازات الفريق» under 🚚 التوصيل والفريق", lm?.parent_id?.[0] === TEAM_MENU_PARENT && lm?.action === `ir.actions.act_window,${c.leavesAction}`);
  const [la] = await call("ir.actions.act_window", "read", { ids: [c.leavesAction], fields: ["res_model", "view_mode"] });
  push("leaves action on resource.calendar.leaves", la.res_model === "resource.calendar.leaves");
  const att = await call("x_team_attendance", "get_views", { views: [[ATT_LIST, "list"], [ATT_SEARCH, "search"]] });
  push("«حضور الفريق» list shows the employee, not the partner", att.views.list.arch.includes('name="x_employee_id"') && !att.views.list.arch.includes('name="x_partner_id"'));
  push("«حضور الفريق» search by employee", att.views.search.arch.includes('name="x_employee_id"') && !att.views.search.arch.includes("x_partner_id"));
  const noEmp = await call("x_team_attendance", "search_count", { domain: [["x_employee_id", "=", false]] });
  push(`every attendance row has an employee (rows without: ${noEmp})`, noEmp === 0);
  const [a926] = await call("ir.actions.act_window", "read", { ids: [CUSTOMERS_ACTION], fields: ["domain"] });
  const afterIds = (await call("res.partner", "search_read", { domain: eval926(a926.domain), fields: ["id"] })).map((r) => r.id).sort((a, b) => a - b);
  const allCust = (await call("res.partner", "search_read", { domain: [["customer_rank", ">", 0]], fields: ["id"] })).map((r) => r.id);
  const teamContacts = (await call("hr.employee", "search_read", { domain: [["x_utak_role_ids", "!=", false]], fields: ["work_contact_id"] })).map((e) => e.work_contact_id?.[0]);
  const want = allCust.filter((id) => !teamContacts.includes(id)).sort((a, b) => a - b);
  push(`customers action ${CUSTOMERS_ACTION}: every customer but the team (${rb.before.customersBeforeIds.join(",")} → ${afterIds.join(",")})`, a926.domain === CUSTOMERS_DOMAIN && JSON.stringify(afterIds) === JSON.stringify(want));
  const othmanInCustomers = await customersCount([...eval926(a926.domain), ["id", "=", OTHMAN]]);
  push("Othman (customer_rank 1, role «مدير») is not in the customers list", othmanInCustomers === 0);
  const noCal = await call("hr.employee", "search_count", { domain: [["x_utak_attendance", "=", true], ["resource_calendar_id", "=", false]] });
  push(`filter «بلا جدول عمل» runs (${noCal} now)`, noCal === 0);
  // automations
  const { origin } = await hookUrl();
  const sas = await call("ir.actions.server", "read", { ids: c.serverActions ?? [], fields: ["state", "webhook_url", "model_id"] });
  push(`${HOOK_MODELS.length} webhook actions → ${origin}${HOOK_PATH}`, sas.length === HOOK_MODELS.length && sas.every((s) => s.state === "webhook" && s.webhook_url.startsWith(`${origin}${HOOK_PATH}?token=`)));
  const bas = await call("base.automation", "read", { ids: c.automations ?? [], fields: ["active", "trigger", "model_id"] });
  push(`${HOOK_MODELS.length * TRIGGERS.length} automations active`, bas.length === HOOK_MODELS.length * TRIGGERS.length && bas.every((b) => b.active));
  let ok = true;
  for (const [name, cond] of checks) { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) ok = false; }
  console.log(`${checks.filter((x) => x[1]).length}/${checks.length}`);
  void ids;
  return ok;
}
if (VERIFY) process.exit((await verify()) ? 0 : 1);

// ================================================================ plan / apply
const log = (...a) => console.log(...a);
const rb = readRb() ?? { created: {} };
if (!rb.before) {
  rb.before = await snapshot();
  if (APPLY) { saveRb(rb); log(`snapshot → ${RB}`); }
}
const c = rb.created;
const save = () => { if (APPLY) saveRb(rb); };
const doIt = async (label, fn) => { log(`${APPLY ? "" : "would "}${label}`); return APPLY ? fn() : null; };

log(`pre-state: employees ${rb.before.employeesBefore.join(",") || "-"} (sample data), attendance rows ${rb.before.attRows}, customers list ${rb.before.customersBefore}, menu ${EMP_MENU} → ${rb.before.menu551.action}`);
for (const p of rb.before.partners) log(`  partner ${p.id} ${p.name}: ${p.x_whatsapp_number}, roles ${JSON.stringify(p.x_role_ids)}, shift ${p.x_shift_start}, neighborhoods ${JSON.stringify(p.x_neighborhoods)}, hire ${p.x_hire_date}, employees ${JSON.stringify(p.employee_ids ?? [])}`);

// 1. fields
c.fields ??= {};
for (const d of FIELDS) {
  const key = `${d.model}.${d.name}`;
  const existing = await one("ir.model.fields", [["model", "=", d.model], ["name", "=", d.name]]);
  if (existing) { c.fields[key] ??= existing; log(`field ${key} exists (${existing})`); continue; }
  const { model, ...vals } = d;
  const id = await doIt(`create field ${key} (${d.ttype}${d.relation ? " → " + d.relation : ""}) «${d.field_description}»`, async () =>
    (await call("ir.model.fields", "create", { vals_list: [{ ...vals, model_id: await modelId(model), state: "manual" }] }))[0]);
  if (id) { c.fields[key] = id; save(); }
}
{
  const f = rb.before.attPartnerField;
  if (f.field_description !== OLD_PARTNER_LABEL) {
    await doIt(`relabel x_team_attendance.x_partner_id «${f.field_description}» → «${OLD_PARTNER_LABEL}»`, () => call("ir.model.fields", "write", { ids: [f.id], vals: { field_description: OLD_PARTNER_LABEL } }));
    if (APPLY) { c.attPartnerLabel = true; save(); }
  }
}

// 2. employees (Work Contact = the existing partner; no schedule; not on attendance)
c.employees ??= {};
const roles = await roleIdsByCode();
for (const [key, pid] of [["OMAR", OMAR], ["OTHMAN", OTHMAN]]) {
  const p = rb.before.partners.find((x) => x.id === pid);
  const already = await find("hr.employee", [["work_contact_id", "=", pid], ["active", "in", [true, false]]]);
  if (already.length) { c.employees[pid] ??= already[0]; log(`employee for partner ${pid} exists (${already[0]})`); continue; }
  const roleIds = ROLE_CODES[key].map((code) => roles.get(code));
  if (roleIds.some((r) => !r)) throw new Error(`role missing for ${key}: ${ROLE_CODES[key]}`);
  const vals = {
    name: p.name, work_contact_id: pid, company_id: 1, tz: "Asia/Riyadh",
    resource_calendar_id: false, x_utak_attendance: false,
    x_utak_role_ids: [[6, 0, roleIds]],
    ...(p.x_neighborhoods?.length ? { x_utak_neighborhood_ids: [[6, 0, p.x_neighborhoods]] } : {}),
    ...(p.x_hire_date ? { contract_date_start: p.x_hire_date } : {}),
  };
  const id = await doIt(`create hr.employee «${p.name}» ${JSON.stringify({ ...vals, x_utak_role_ids: ROLE_CODES[key] })}`, async () =>
    (await call("hr.employee", "create", { vals_list: [vals] }))[0]);
  if (!id) continue;
  c.employees[pid] = id; save();
  // Odoo may still hand the new employee / its resource the company's default schedule: clear it.
  const [e] = await call("hr.employee", "read", { ids: [id], fields: ["resource_calendar_id", "resource_id", "work_contact_id"] });
  const [res] = await call("resource.resource", "read", { ids: [e.resource_id[0]], fields: ["calendar_id"] });
  if (e.resource_calendar_id || res.calendar_id) {
    log(`  Odoo gave it a schedule (${JSON.stringify(e.resource_calendar_id)} / resource ${JSON.stringify(res.calendar_id)}) — clearing`);
    await call("hr.employee", "write", { ids: [id], vals: { resource_calendar_id: false } });
    await call("resource.resource", "write", { ids: [e.resource_id[0]], vals: { calendar_id: false } });
  }
  if (e.work_contact_id?.[0] !== pid) throw new Error(`employee ${id}: Work Contact is ${JSON.stringify(e.work_contact_id)}, expected ${pid}`);
  // hr.employee.create writes a generated avatar onto the Work Contact: the partner keeps its own.
  const [pAfter] = await call("res.partner", "read", { ids: [pid], fields: ["image_1920"] });
  if ((pAfter.image_1920 || false) !== (rb.before.partnerImages[pid] || false)) {
    log(`  partner ${pid}: avatar restored`);
    await call("res.partner", "write", { ids: [pid], vals: { image_1920: rb.before.partnerImages[pid] || false } });
  }
}

// 3. attendance rows → the employee
if (APPLY) {
  const rows = await call("x_team_attendance", "search_read", { domain: [["x_employee_id", "=", false]], fields: ["id", "x_partner_id"] });
  const empByContact = new Map((await call("hr.employee", "search_read", { domain: [["work_contact_id", "!=", false]], fields: ["id", "work_contact_id"] })).map((e) => [e.work_contact_id[0], e.id]));
  c.attRowsMoved ??= [];
  for (const r of rows) {
    const emp = r.x_partner_id ? empByContact.get(r.x_partner_id[0]) : null;
    if (!emp) { log(`  attendance row ${r.id}: partner ${JSON.stringify(r.x_partner_id)} has no employee — left`); continue; }
    await call("x_team_attendance", "write", { ids: [r.id], vals: { x_employee_id: emp } });
    c.attRowsMoved.push(r.id); save();
  }
  log(`attendance rows moved: ${c.attRowsMoved.length} (of ${rows.length} without an employee)`);
} else log(`would move the ${rb.before.attRows} x_team_attendance row(s) to x_employee_id`);

// 4. UI
const view = async (key, vals) => {
  const existing = await one("ir.ui.view", [["name", "=", NAMES[key]]]);
  if (existing) { c[key] ??= existing; log(`view ${NAMES[key]} exists (${existing})`); return existing; }
  const id = await doIt(`create view ${NAMES[key]}`, async () => (await call("ir.ui.view", "create", { vals_list: [{ name: NAMES[key], ...vals }] }))[0]);
  if (id) { c[key] = id; save(); }
  return id;
};
const hrForm = await xmlId("hr", HR_FORM), hrSearch = await xmlId("hr", HR_SEARCH);
await view("formExt", { model: "hr.employee", type: "form", inherit_id: hrForm, mode: "extension", priority: 90, arch_base: FORM_EXT });
await view("kanban", { model: "hr.employee", type: "kanban", mode: "primary", priority: 90, arch_base: KANBAN });
await view("list", { model: "hr.employee", type: "list", mode: "primary", priority: 90, arch_base: LIST });
await view("search", { model: "hr.employee", type: "search", inherit_id: hrSearch, mode: "primary", priority: 90, arch_base: SEARCH_EXT });

let empAction = await one("ir.actions.act_window", [["name", "=", NAMES.empAction]]);
if (empAction) { c.empAction ??= empAction; log(`action ${NAMES.empAction} exists (${empAction})`); }
else {
  empAction = await doIt(`create action «${NAMES.empAction}» (hr.employee, ${EMP_ACTION_DOMAIN})`, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
    name: NAMES.empAction, res_model: "hr.employee", view_mode: "kanban,list,form", domain: EMP_ACTION_DOMAIN,
    context: "{}", search_view_id: c.search, view_id: c.kanban,
    help: "<p>موظفو UTAK: من له دور في «أدوار UTAK». أضف موظفاً من تطبيق «الموظفون» أو من هنا، واربطه بمحادثته في «جهة اتصال واتساب».</p>",
  }] }))[0]);
  if (empAction) {
    c.empAction = empAction; save();
    await call("ir.actions.act_window.view", "create", { vals_list: [
      { act_window_id: empAction, view_mode: "kanban", view_id: c.kanban, sequence: 1 },
      { act_window_id: empAction, view_mode: "list", view_id: c.list, sequence: 2 },
    ] });
  }
}
{
  const [m] = await call("ir.ui.menu", "read", { ids: [EMP_MENU], fields: ["action"] });
  const want = `ir.actions.act_window,${c.empAction ?? "<new>"}`;
  if (m.action !== want) {
    await doIt(`menu ${EMP_MENU} «الموظفين»: ${m.action} → ${want}`, () => call("ir.ui.menu", "write", { ids: [EMP_MENU], vals: { action: want } }));
    if (APPLY) { c.menu551 = true; save(); }
  }
}
let leavesAction = await one("ir.actions.act_window", [["name", "=", NAMES.leavesAction]]);
if (leavesAction) { c.leavesAction ??= leavesAction; log(`action ${NAMES.leavesAction} exists (${leavesAction})`); }
else {
  leavesAction = await doIt(`create action «${NAMES.leavesAction}» (resource.calendar.leaves, Odoo's own list/form)`, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
    name: NAMES.leavesAction, res_model: "resource.calendar.leaves", view_mode: "list,form", context: "{}",
    help: "<p>إجازة موظف: اختر الموظف في «Resource» مع البداية والنهاية. إجازة عامة للشركة: اترك «Resource» و«Working Hours» فارغين. يوم الإجازة: لا رسالة «بدء الدوام» ولا غياب.</p>",
  }] }))[0]);
  if (leavesAction) { c.leavesAction = leavesAction; save(); }
}
let leavesMenu = await one("ir.ui.menu", [["parent_id", "=", TEAM_MENU_PARENT], ["name", "=", NAMES.leavesMenu]]);
if (leavesMenu) { c.leavesMenu ??= leavesMenu; log(`menu ${NAMES.leavesMenu} exists (${leavesMenu})`); }
else {
  leavesMenu = await doIt(`create menu UTAK/🚚 التوصيل والفريق/«${NAMES.leavesMenu}» (seq ${LEAVES_MENU_SEQ})`, async () => (await call("ir.ui.menu", "create", { vals_list: [{
    name: NAMES.leavesMenu, parent_id: TEAM_MENU_PARENT, sequence: LEAVES_MENU_SEQ, action: `ir.actions.act_window,${c.leavesAction}`,
  }] }))[0]);
  if (leavesMenu) { c.leavesMenu = leavesMenu; save(); }
}
if (rb.before.action926Domain !== CUSTOMERS_DOMAIN) {
  const [a] = await call("ir.actions.act_window", "read", { ids: [CUSTOMERS_ACTION], fields: ["domain"] });
  if (a.domain !== CUSTOMERS_DOMAIN) {
    await doIt(`action ${CUSTOMERS_ACTION} «قائمة العملاء»: domain ${a.domain} → ${CUSTOMERS_DOMAIN}`, () => call("ir.actions.act_window", "write", { ids: [CUSTOMERS_ACTION], vals: { domain: CUSTOMERS_DOMAIN } }));
    if (APPLY) { c.action926 = true; save(); }
  }
}
c.attViews ??= [];
for (const [id, arch] of [[ATT_LIST, ATT_LIST_ARCH], [ATT_SEARCH, ATT_SEARCH_ARCH]]) {
  const [v] = await call("ir.ui.view", "read", { ids: [id], fields: ["arch_db"] });
  if (!v.arch_db.includes("x_partner_id")) { log(`view ${id} already on x_employee_id`); continue; }
  await doIt(`view ${id} (حضور الفريق): x_partner_id → x_employee_id`, () => call("ir.ui.view", "write", { ids: [id], vals: { arch_base: arch } }));
  if (APPLY && !c.attViews.includes(id)) { c.attViews.push(id); save(); }
}

// 5. automations → the sim worker drops its roster cache
{
  const { origin, url } = await hookUrl();
  log(`webhook target: ${origin}${HOOK_PATH}`);
  c.serverActions ??= []; c.automations ??= [];
  for (const m of HOOK_MODELS) {
    const mid = await modelId(m);
    let sa = await one("ir.actions.server", [["name", "=", saName(m)]]);
    if (sa) log(`server action ${saName(m)} exists (${sa})`);
    else {
      sa = await doIt(`create webhook action ${saName(m)}`, async () => (await call("ir.actions.server", "create", { vals_list: [{ name: saName(m), model_id: mid, state: "webhook", webhook_url: url }] }))[0]);
      if (sa) { c.serverActions.push(sa); save(); }
    }
    for (const t of TRIGGERS) {
      const ba = await one("base.automation", [["name", "=", baName(m, t)]]);
      if (ba) { log(`automation ${baName(m, t)} exists (${ba})`); continue; }
      const id = await doIt(`create automation ${baName(m, t)}`, async () => (await call("base.automation", "create", { vals_list: [{
        name: baName(m, t), model_id: mid, trigger: t, active: true, action_server_ids: [[6, 0, [sa]]],
      }] }))[0]);
      if (id) { c.automations.push(id); save(); }
    }
  }
}
log(APPLY ? "applied — run --verify" : "dry run: nothing written (add --apply)");
