// Team attendance in Odoo (2026-09-25, STATUS § 29).
//
// hr_attendance is not installed (and no module may be installed), hr.employee
// has 0 records, and the team lives on res.partner (x_role_ids, x_hire_date …
// on the «الموظفين» form, view 2735). So:
//   1. res.partner.x_shift_start  float «بداية الدوام» (Riyadh, HH:MM via float_time;
//      00:00 = no time → no «بدء الدوام» template for that person)
//      + two extension views: the employee form (2735) and list (2728).
//   2. x_team_attendance «حضور الفريق»: الموظف، التاريخ، وقت الدوام، وقت الإرسال،
//      وقت الضغط، الحالة (حاضر/متأخر/غائب)، التذكير أُرسل
//      + access (Role / User, crud, like x_wa_message), list + search views,
//      action, and a menu under UTAK ← 🚚 التوصيل والفريق.
//
//   node scripts/att-20260925-odoo-setup.mjs                      # dry run (default)
//   node scripts/att-20260925-odoo-setup.mjs --apply
//   node scripts/att-20260925-odoo-setup.mjs --verify
//   node scripts/att-20260925-odoo-setup.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/att-20260925-odoo-setup-rollback.json — the
// pre-state is written before the first write, and every created id is
// appended as soon as it exists. --rollback deletes exactly those ids (menu,
// action, views, the model with its fields and access, x_shift_start).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const VERIFY = args.includes("--verify");
const RB = new URL("./artifacts/att-20260925-odoo-setup-rollback.json", import.meta.url).pathname;

const MODEL = "x_team_attendance";
const TEAM_MENU_ID = 546;      // UTAK ← 🚚 التوصيل والفريق
const EMP_FORM_VIEW = 2735;    // utak.employee_form
const EMP_LIST_VIEW = 2728;    // utak.employees_list
const USER_GROUP_ID = 1;       // «Role / User», as on x_wa_message / x_employee_role

const SHIFT_HELP = "وقت بداية الدوام بتوقيت الرياض. 00:00 = لا وقت، فلا يُرسل له قالب «بدء الدوام» ولا يُسجَّل حضوره.";

const ATT_FIELDS = [
  { name: "x_partner_id", ttype: "many2one", relation: "res.partner", field_description: "الموظف", on_delete: "cascade", index: true },
  { name: "x_date", ttype: "date", field_description: "التاريخ", index: true },
  { name: "x_shift_at", ttype: "datetime", field_description: "وقت الدوام" },
  { name: "x_sent_at", ttype: "datetime", field_description: "وقت الإرسال" },
  { name: "x_tapped_at", ttype: "datetime", field_description: "وقت الضغط" },
  { name: "x_status", ttype: "selection", field_description: "الحالة", selection: "[('present', 'حاضر'), ('late', 'متأخر'), ('absent', 'غائب')]" },
  { name: "x_reminder_sent", ttype: "boolean", field_description: "التذكير أُرسل" },
];

const FORM_EXT = `<data>
  <xpath expr="//field[@name='x_role_ids']" position="after">
    <field name="x_shift_start" widget="float_time" string="بداية الدوام"/>
  </xpath>
</data>`;
const LIST_EXT = `<data>
  <xpath expr="//field[@name='x_role_ids']" position="after">
    <field name="x_shift_start" widget="float_time" string="بداية الدوام" optional="show"/>
  </xpath>
</data>`;
const ATT_LIST = `<list string="حضور الفريق" default_order="x_date desc, x_shift_at asc" create="0"
      decoration-danger="x_status == 'absent'" decoration-warning="x_status == 'late'" decoration-success="x_status == 'present'">
  <field name="x_date"/>
  <field name="x_partner_id"/>
  <field name="x_shift_at"/>
  <field name="x_sent_at"/>
  <field name="x_tapped_at"/>
  <field name="x_status"/>
  <field name="x_reminder_sent"/>
</list>`;
const ATT_SEARCH = `<search string="حضور الفريق">
  <field name="x_partner_id"/>
  <filter name="today" string="اليوم" domain="[('x_date', '=', context_today().strftime('%Y-%m-%d'))]"/>
  <separator/>
  <filter name="absent" string="غائب" domain="[('x_status', '=', 'absent')]"/>
  <filter name="late" string="متأخر" domain="[('x_status', '=', 'late')]"/>
  <filter name="present" string="حاضر" domain="[('x_status', '=', 'present')]"/>
  <group>
    <filter name="by_partner" string="الموظف" context="{'group_by': 'x_partner_id'}"/>
    <filter name="by_date" string="التاريخ" context="{'group_by': 'x_date'}"/>
  </group>
</search>`;

const NAMES = {
  formExt: "utak.employee_form.x_shift_start",
  listExt: "utak.employees_list.x_shift_start",
  attList: "x_team_attendance.list",
  attSearch: "x_team_attendance.search",
  action: "UTAK — حضور الفريق",
  menu: "حضور الفريق",
  access: "x_team_attendance.access.user",
};

// ---------------------------------------------------------------- schema check (fields_get)
async function assertFields(model, names) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !(n in f));
  if (missing.length) throw new Error(`${model}: fields missing on the tenant: ${missing.join(", ")}`);
}
await assertFields("ir.model", ["name", "model", "access_ids", "order"]);
await assertFields("ir.model.fields", ["model_id", "model", "name", "field_description", "ttype", "relation", "selection", "help", "on_delete", "index"]);
await assertFields("ir.ui.view", ["name", "model", "type", "arch_base", "inherit_id", "mode", "priority"]);
await assertFields("ir.actions.act_window", ["name", "res_model", "view_mode", "context", "search_view_id", "view_id"]);
await assertFields("ir.ui.menu", ["name", "parent_id", "action", "sequence"]);
await assertFields("ir.access", ["name", "model_id", "group_id", "operation", "kind", "active"]);

const find = async (model, domain) => (await call(model, "search_read", { domain, fields: ["id"], limit: 10, context: { active_test: false } })).map((r) => r.id);

async function state() {
  return {
    model: await find("ir.model", [["model", "=", MODEL]]),
    shiftField: await find("ir.model.fields", [["model", "=", "res.partner"], ["name", "=", "x_shift_start"]]),
    views: await find("ir.ui.view", [["name", "in", [NAMES.formExt, NAMES.listExt, NAMES.attList, NAMES.attSearch]]]),
    action: await find("ir.actions.act_window", [["name", "=", NAMES.action]]),
    menu: await find("ir.ui.menu", [["name", "=", NAMES.menu], ["parent_id", "=", TEAM_MENU_ID]]),
    parentViews: await call("ir.ui.view", "read", { ids: [EMP_FORM_VIEW, EMP_LIST_VIEW], fields: ["id", "name", "arch_db"] }),
  };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const c = rb.created ?? {};
  const steps = [
    ["ir.ui.menu", c.menu], ["ir.actions.act_window", c.action],
    ["ir.ui.view", [c.attList, c.attSearch, c.formExt, c.listExt].filter(Boolean)],
    ["ir.model", c.model], ["ir.model.fields", c.shiftField],
  ];
  for (const [model, ids0] of steps) {
    const ids = [ids0].flat().filter(Boolean);
    if (!ids.length) continue;
    console.log(`${APPLY ? "delete" : "would delete"} ${model} ${ids.join(",")}`);
    if (APPLY) await call(model, "unlink", { ids });
  }
  const after = await state();
  console.log(JSON.stringify({ model: after.model, shiftField: after.shiftField, views: after.views, action: after.action, menu: after.menu }));
  const same = after.parentViews.every((v) => rb.before.parentViews.find((b) => b.id === v.id)?.arch_db === v.arch_db);
  console.log(`parent views 2735/2728 unchanged: ${same}`);
  console.log(APPLY ? "rollback done" : "dry run: nothing deleted (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
async function verify() {
  const s = await state();
  const f = await call(MODEL, "fields_get", { attributes: ["type", "relation", "selection", "string"] });
  const pf = await call("res.partner", "fields_get", { attributes: ["type", "string"] });
  const checks = [
    ["model exists", s.model.length === 1],
    ["res.partner.x_shift_start float", pf.x_shift_start?.type === "float"],
    ...ATT_FIELDS.map((d) => [`${MODEL}.${d.name} ${d.ttype}`, f[d.name]?.type === d.ttype && (!d.relation || f[d.name]?.relation === d.relation)]),
    ["x_status values present/late/absent", JSON.stringify((f.x_status?.selection ?? []).map((x) => x[0])) === JSON.stringify(["present", "late", "absent"])],
    ["4 views", s.views.length === 4],
    ["action", s.action.length === 1],
    ["menu under التوصيل والفريق", s.menu.length === 1],
  ];
  // a read through the new model and the partner field (what the worker does)
  const rows = await call(MODEL, "search_read", { domain: [], fields: ATT_FIELDS.map((d) => d.name), limit: 1 });
  checks.push(["search_read on the model", Array.isArray(rows)]);
  const p = await call("res.partner", "read", { ids: [9], fields: ["x_shift_start"] });
  checks.push(["x_shift_start readable (partner 9 = 0.0, no time)", p[0]?.x_shift_start === 0]);
  // the combined (inherited) employee form really shows the field
  const arch = await call("res.partner", "get_views", { views: [[EMP_FORM_VIEW, "form"], [EMP_LIST_VIEW, "list"]] }).catch((e) => ({ err: e.message }));
  const archText = JSON.stringify(arch);
  checks.push(["employee form + list render x_shift_start", (archText.match(/x_shift_start/g) ?? []).length >= 2]);
  const acc = await call("ir.model", "read", { ids: s.model, fields: ["access_ids"] });
  checks.push(["access row", (acc[0]?.access_ids ?? []).length === 1]);
  let ok = true;
  for (const [n, c] of checks) { console.log(`${c ? "✓" : "✗"} ${n}`); if (!c) ok = false; }
  return ok;
}
if (VERIFY) process.exit((await verify()) ? 0 : 1);

// ---------------------------------------------------------------- plan / apply
const before = await state();
const plan = [];
if (!before.shiftField.length) plan.push("create res.partner.x_shift_start (float «بداية الدوام»)");
if (!before.model.length) plan.push(`create model ${MODEL} «حضور الفريق» + ${ATT_FIELDS.length} fields + access (group ${USER_GROUP_ID}, crud)`);
for (const n of [NAMES.formExt, NAMES.listExt, NAMES.attList, NAMES.attSearch]) plan.push(`view «${n}»`);
plan.push(`action «${NAMES.action}»`, `menu «${NAMES.menu}» under ${TEAM_MENU_ID}`);
console.log(`pre-state: ${JSON.stringify({ model: before.model, shiftField: before.shiftField, views: before.views, action: before.action, menu: before.menu })}`);
console.log("plan:\n  " + plan.join("\n  "));
if (!APPLY) { console.log("dry run: nothing written (add --apply)"); process.exit(0); }

// Resumable: a step whose id is already recorded in the rollback file (and
// still exists) is skipped; anything that exists WITHOUT being recorded here
// was not made by this script, so apply refuses to touch it.
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { at: new Date().toISOString(), before, created: {} };
const created = rb.created;
const mine = (ids, rec) => ids.every((id) => [rec].flat().includes(id));
if (!mine(before.model, created.model) || !mine(before.shiftField, created.shiftField) || !mine(before.action, created.action)
    || !mine(before.menu, created.menu) || !mine(before.views, [created.formExt, created.listExt, created.attList, created.attSearch])) {
  throw new Error("something already exists that this script did not create — refusing (inspect first)");
}
const save = () => writeFileSync(RB, JSON.stringify(rb, null, 2));
save(); // pre-state on disk before the first write

// 1. res.partner.x_shift_start
if (!created.shiftField) {
  const partnerModel = (await find("ir.model", [["model", "=", "res.partner"]]))[0];
  [created.shiftField] = await call("ir.model.fields", "create", { vals_list: [{
    model_id: partnerModel, name: "x_shift_start", field_description: "بداية الدوام", ttype: "float", help: SHIFT_HELP,
  }] });
  save();
}

// 2. the model, its fields, its access
// `order` may only name stored fields, so it is set once x_date exists.
if (!created.model) {
  [created.model] = await call("ir.model", "create", { vals_list: [{ name: "حضور الفريق", model: MODEL }] });
  save();
}
created.fields ??= [];
const have = new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", created.model]], fields: ["name"] })).map((r) => r.name));
for (const d of ATT_FIELDS) {
  if (have.has(d.name)) continue;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: created.model, ...d }] });
  created.fields.push(id); save();
}
await call("ir.model", "write", { ids: [created.model], vals: { order: "x_date desc, id desc" } });
const acc = await call("ir.model", "read", { ids: [created.model], fields: ["access_ids"] });
if (!(acc[0]?.access_ids ?? []).length) {
  await call("ir.model", "write", { ids: [created.model], vals: { access_ids: [[0, 0, {
    name: NAMES.access, group_id: USER_GROUP_ID, operation: "crud", kind: "permission", active: true,
  }]] } });
}

// 3. views
const view = async (vals) => (await call("ir.ui.view", "create", { vals_list: [vals] }))[0];
created.formExt ??= await view({ name: NAMES.formExt, model: "res.partner", type: "form", inherit_id: EMP_FORM_VIEW, mode: "extension", arch_base: FORM_EXT }); save();
created.listExt ??= await view({ name: NAMES.listExt, model: "res.partner", type: "list", inherit_id: EMP_LIST_VIEW, mode: "extension", arch_base: LIST_EXT }); save();
created.attList ??= await view({ name: NAMES.attList, model: MODEL, type: "list", arch_base: ATT_LIST }); save();
created.attSearch ??= await view({ name: NAMES.attSearch, model: MODEL, type: "search", arch_base: ATT_SEARCH }); save();

// 4. action + menu
if (!created.action) {
  [created.action] = await call("ir.actions.act_window", "create", { vals_list: [{
    name: NAMES.action, res_model: MODEL, view_mode: "list,form", view_id: created.attList, search_view_id: created.attSearch,
  }] });
  save();
}
if (!created.menu) {
  [created.menu] = await call("ir.ui.menu", "create", { vals_list: [{
    name: NAMES.menu, parent_id: TEAM_MENU_ID, action: `ir.actions.act_window,${created.action}`, sequence: 15,
  }] });
  save();
}
console.log("created:", JSON.stringify(created));
process.exit((await verify()) ? 0 : 1);
