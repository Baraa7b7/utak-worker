// Number review in Odoo (2026-09-25, STATUS § 30).
//
// Every number that writes to the company number starts as a customer; the
// conversation shows its intent, and the numbers that are not customers wait
// for Baraa's decision in Odoo. This script builds the Odoo side:
//   1. res.partner fields: x_contact_class «التصنيف», x_ai_intent «نية الذكاء»,
//      x_ai_reason «سبب الذكاء», x_review_pending «ينتظر المراجعة»,
//      x_review_last_msg «آخر رسالة», x_review_last_at «تاريخ آخر رسالة».
//   2. five server actions (عميل · مورد · فريق · شخصي · أرشفة) that work on the
//      selected rows, a list view with them as header buttons, a search view,
//      an action and the menu «📋 مراجعة الأرقام (N)» under UTAK next to
//      «💬 المحادثات». N is kept by an automation on x_review_pending / active.
//   3. a group «UTAK — التصنيف» on the contact form (extension of 124).
//   4. the Discuss channel «📋 مراجعة الأرقام», Baraa a member (all messages).
//   5. attendance: «بداية الدوام» always shown in the employees list (2822
//      without optional), a filter «بلا وقت دوام» (a search view for the
//      employees action 927), and عثمان (15): role «مدير» (4) + class «فريق».
//
//   node scripts/rev-20260925-odoo-setup.mjs                  # dry run (default)
//   node scripts/rev-20260925-odoo-setup.mjs --apply
//   node scripts/rev-20260925-odoo-setup.mjs --verify         # read-only checks
//   node scripts/rev-20260925-odoo-setup.mjs --verify-buttons # runs the five actions on a TEMP partner it creates, then deletes it
//   node scripts/rev-20260925-odoo-setup.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/rev-20260925-odoo-setup-rollback.json. The
// pre-state (view 2822 arch, action 927 search view, partner 15 roles) is on
// disk before the first write, and every created id is appended as soon as it
// exists. --rollback deletes exactly those ids and restores the three records.
// Roll back the worker first (it writes x_contact_class on every new partner).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { REVIEW_BUTTONS } from "./lib/review-buttons.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: no WhatsApp from this script");
  return real(input, init);
})(globalThis.fetch);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const VERIFY = args.includes("--verify");
const VERIFY_BUTTONS = args.includes("--verify-buttons");
const RB = new URL("./artifacts/rev-20260925-odoo-setup-rollback.json", import.meta.url).pathname;

const UTAK_MENU_ID = 529;       // UTAK (app root); 💬 المحادثات is 565 (seq 5)
const MENU_SEQUENCE = 6;        // right after 💬 المحادثات
const PARTNER_FORM = 124;       // res.partner.form
const PARTNER_SEARCH = 125;     // res.partner.select
const EMP_ACTION = 927;         // الموظفين
const EMP_LIST_EXT = 2822;      // utak.employees_list.x_shift_start
const OTHMAN = 15;              // عثمان عبدالوهاب
const EMP_DOMAIN = "[('x_role_ids.x_active', '=', True)]";
const OPS_ROLE = 4;             // x_employee_role «مدير» (admin) — the only non-field-task team role
const BARAA_PARTNER = 3;        // user 2 «albaraa abdulwahab»
const CHANNEL_NAME = "📋 مراجعة الأرقام";
const MENU_LABEL = "📋 مراجعة الأرقام";

const CLASS_SEL = "[('unreviewed', 'غير مراجَع'), ('customer', 'عميل'), ('supplier', 'مورد'), ('team', 'فريق'), ('personal', 'شخصي')]";
const INTENT_SEL = "[('purchase', 'طلب أو استفسار شراء'), ('wrong_number', 'رقم غلط'), ('vendor_pitch', 'عرض بيع لنا'), ('personal', 'شخصي'), ('spam', 'إزعاج'), ('unclear', 'غير واضح')]";
const FIELDS = [
  { name: "x_contact_class", ttype: "selection", selection: CLASS_SEL, field_description: "التصنيف",
    help: "«غير مراجَع» لكل رقم يُنشأ آلياً من واتساب. الذكاء لا يصنّف إلا «غير مراجَع»، ويتوقف فور تثبيت التصنيف. فارغ = شريك قديم لا يُصنَّف آلياً." },
  { name: "x_ai_intent", ttype: "selection", selection: INTENT_SEL, field_description: "نية الذكاء",
    help: "آخر نية قرأها الذكاء من رسائل الرقم وهو «غير مراجَع»." },
  { name: "x_ai_reason", ttype: "char", field_description: "سبب الذكاء", help: "سطر قصير من الذكاء يشرح النية." },
  { name: "x_review_pending", ttype: "boolean", field_description: "ينتظر المراجعة",
    help: "ينتظر قرار براء في «مراجعة الأرقام». رقم غلط / عرض بيع لنا / شخصي / إزعاج: تتوقف عنه كل الرسائل الآلية للعملاء حتى القرار. غير واضح: يبقى عميلاً." },
  { name: "x_review_last_msg", ttype: "char", field_description: "آخر رسالة", help: "آخر رسالة نصية منه وهو «غير مراجَع»." },
  { name: "x_review_last_at", ttype: "datetime", field_description: "تاريخ آخر رسالة" },
];
const NON_CUSTOMER = ["wrong_number", "vendor_pitch", "personal", "spam"];

// ---------------------------------------------------------------- server actions (the five buttons + the counter)
const BUTTONS = REVIEW_BUTTONS;
const saName = (key) => `UTAK مراجعة الأرقام ← ${BUTTONS.find((b) => b.key === key).label}`;
const COUNTER_SA = "UTAK مراجعة الأرقام ← العدّاد";
const COUNTER_BA = "utak.review.menu_counter";
const counterCode = (menuId) => `n = env['res.partner'].search_count([('x_review_pending', '=', True)])
label = '${MENU_LABEL} (%s)' % n
menu = env['ir.ui.menu'].sudo().browse(${menuId}).exists()
if menu:
    for lang in ('en_US', 'ar_001'):
        m = menu.with_context(lang=lang)
        if m.name != label:
            m.write({'name': label})
`;

// ---------------------------------------------------------------- views
const reviewList = (sa) => `<list string="مراجعة الأرقام" create="0" default_order="x_review_last_at desc, id desc"
      decoration-danger="x_review_pending and x_ai_intent in ('wrong_number', 'vendor_pitch', 'personal', 'spam')"
      decoration-warning="x_review_pending and x_ai_intent == 'unclear'"
      decoration-muted="not active">
  <header>
    <button name="${sa.customer}" type="action" string="عميل" class="btn-primary"/>
    <button name="${sa.supplier}" type="action" string="مورد"/>
    <button name="${sa.team}" type="action" string="فريق"/>
    <button name="${sa.personal}" type="action" string="شخصي"/>
    <button name="${sa.archive}" type="action" string="أرشفة" confirm="أرشفة المحدد؟ لا يُحذف شيء، ويُرجَع من فلتر «المؤرشفون»."/>
  </header>
  <field name="active" column_invisible="1"/>
  <field name="name" string="الاسم"/>
  <field name="x_whatsapp_number" string="الرقم"/>
  <field name="x_ai_intent" string="النية"/>
  <field name="x_ai_reason" string="السبب"/>
  <field name="x_review_last_msg" string="آخر رسالة"/>
  <field name="x_review_last_at" string="التاريخ"/>
  <field name="x_contact_class" string="التصنيف" optional="hide"/>
  <field name="x_review_pending" string="ينتظر المراجعة" optional="hide"/>
</list>`;
const REVIEW_SEARCH = `<search string="مراجعة الأرقام">
  <field name="name"/>
  <field name="x_whatsapp_number" string="الرقم"/>
  <filter name="pending" string="ينتظر المراجعة" domain="[('x_review_pending', '=', True)]"/>
  <filter name="archived" string="المؤرشفون" domain="[('active', '=', False)]"/>
  <separator/>
  <filter name="not_customer" string="غير عملاء" domain="[('x_ai_intent', 'in', ['wrong_number', 'vendor_pitch', 'personal', 'spam'])]"/>
  <group>
    <filter name="by_intent" string="النية" context="{'group_by': 'x_ai_intent'}"/>
    <filter name="by_class" string="التصنيف" context="{'group_by': 'x_contact_class'}"/>
  </group>
</search>`;
const FORM_EXT = `<data>
  <xpath expr="//notebook" position="before">
    <group string="UTAK — التصنيف" name="utak_review_group">
      <group>
        <field name="x_contact_class"/>
        <field name="x_review_pending" widget="boolean_toggle"/>
      </group>
      <group>
        <field name="x_ai_intent" readonly="1"/>
        <field name="x_ai_reason" readonly="1"/>
        <field name="x_review_last_msg" readonly="1"/>
        <field name="x_review_last_at" readonly="1"/>
      </group>
    </group>
  </xpath>
</data>`;
const EMP_SEARCH = `<data>
  <xpath expr="//search" position="inside">
    <separator/>
    <filter name="no_shift" string="بلا وقت دوام" domain="['|', ('x_shift_start', '=', False), ('x_shift_start', '&lt;=', 0)]"/>
  </xpath>
</data>`;
const LIST_EXT_2822 = `<data>
  <xpath expr="//field[@name='x_role_ids']" position="after">
    <field name="x_shift_start" widget="float_time" string="بداية الدوام"/>
  </xpath>
</data>`;

const NAMES = {
  reviewList: "utak.review.numbers_list",
  reviewSearch: "utak.review.numbers_search",
  formExt: "res.partner.form.utak_review",
  empSearch: "utak.employees_search.no_shift",
  action: "UTAK — مراجعة الأرقام",
};

// ---------------------------------------------------------------- schema check (fields_get)
async function assertFields(model, names) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !(n in f));
  if (missing.length) throw new Error(`${model}: fields missing on the tenant: ${missing.join(", ")}`);
}
await assertFields("ir.model.fields", ["model_id", "model", "name", "field_description", "ttype", "selection", "help"]);
await assertFields("ir.ui.view", ["name", "model", "type", "arch_base", "arch_db", "inherit_id", "mode", "priority"]);
await assertFields("ir.actions.act_window", ["name", "res_model", "view_mode", "context", "domain", "search_view_id", "view_id"]);
await assertFields("ir.actions.server", ["name", "model_id", "state", "code", "usage"]);
await assertFields("base.automation", ["name", "model_id", "trigger", "trigger_field_ids", "action_server_ids", "active"]);
await assertFields("ir.ui.menu", ["name", "parent_id", "action", "sequence"]);
await assertFields("discuss.channel", ["name", "channel_type", "description", "channel_member_ids"]);
await assertFields("discuss.channel.member", ["channel_id", "partner_id", "custom_notifications"]);
await assertFields("res.partner", ["x_role_ids", "x_shift_start", "x_whatsapp_number", "customer_rank", "supplier_rank", "active"]);

const find = async (model, domain) => (await call(model, "search_read", { domain, fields: ["id"], limit: 20, context: { active_test: false } })).map((r) => r.id);
const partnerModelId = async () => (await find("ir.model", [["model", "=", "res.partner"]]))[0];

async function state() {
  return {
    fields: await find("ir.model.fields", [["model", "=", "res.partner"], ["name", "in", FIELDS.map((f) => f.name)]]),
    serverActions: await find("ir.actions.server", [["name", "in", [...BUTTONS.map((b) => saName(b.key)), COUNTER_SA]]]),
    automation: await find("base.automation", [["name", "=", COUNTER_BA]]),
    views: await find("ir.ui.view", [["name", "in", Object.values(NAMES)]]),
    action: await find("ir.actions.act_window", [["name", "=", NAMES.action]]),
    menu: await find("ir.ui.menu", [["parent_id", "=", UTAK_MENU_ID], ["name", "ilike", MENU_LABEL]]),
    channel: await find("discuss.channel", [["name", "=", CHANNEL_NAME], ["channel_type", "=", "channel"]]),
    view2822: (await call("ir.ui.view", "read", { ids: [EMP_LIST_EXT], fields: ["id", "arch_db"] }))[0],
    action927: (await call("ir.actions.act_window", "read", { ids: [EMP_ACTION], fields: ["id", "search_view_id", "domain"] }))[0],
    othman: (await call("res.partner", "read", { ids: [OTHMAN], fields: ["id", "name", "x_role_ids", "customer_rank", "supplier_rank", "active"] }))[0],
  };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const c = rb.created ?? {};
  const act = async (label, fn) => { console.log(`${APPLY ? "" : "would "}${label}`); if (APPLY) await fn(); };
  // restore first (they point at records deleted below)
  if (c.action927 !== undefined) {
    const sv = rb.before.action927.search_view_id;
    await act(`action ${EMP_ACTION}: search_view_id ← ${JSON.stringify(sv)}`, () =>
      call("ir.actions.act_window", "write", { ids: [EMP_ACTION], vals: { search_view_id: sv ? sv[0] : false } }));
  }
  if (c.action927Domain) {
    await act(`action ${EMP_ACTION}: domain ← ${rb.before.action927Domain}`, () =>
      call("ir.actions.act_window", "write", { ids: [EMP_ACTION], vals: { domain: rb.before.action927Domain } }));
  }
  if (c.view2822) {
    await act(`view ${EMP_LIST_EXT}: arch ← before`, () =>
      call("ir.ui.view", "write", { ids: [EMP_LIST_EXT], vals: { arch_base: rb.before.view2822.arch_db } }));
  }
  if (c.othman) {
    await act(`partner ${OTHMAN}: x_role_ids ← ${JSON.stringify(rb.before.othman.x_role_ids)}`, () =>
      call("res.partner", "write", { ids: [OTHMAN], vals: { x_role_ids: [[6, 0, rb.before.othman.x_role_ids]] } }));
  }
  const steps = [
    ["discuss.channel", c.channel], ["base.automation", c.automation], ["ir.ui.menu", c.menu],
    ["ir.actions.act_window", c.action],
    ["ir.ui.view", [c.reviewList, c.reviewSearch, c.formExt, c.empSearch]],
    ["ir.actions.server", [...Object.values(c.serverActions ?? {}), c.counterSa]],
    ["res.partner", c.tempPartner],
    ["ir.model.fields", c.fields],
  ];
  for (const [model, ids0] of steps) {
    const ids = [ids0].flat().filter(Boolean);
    if (!ids.length) continue;
    const alive = await find(model, [["id", "in", ids]]);
    if (!alive.length) continue;
    await act(`delete ${model} ${alive.join(",")}`, () => call(model, "unlink", { ids: alive }));
  }
  if (APPLY) {
    const after = await state();
    console.log(JSON.stringify({ fields: after.fields, serverActions: after.serverActions, automation: after.automation, views: after.views, action: after.action, menu: after.menu, channel: after.channel, othmanRoles: after.othman.x_role_ids, action927: after.action927.search_view_id, view2822same: after.view2822.arch_db === rb.before.view2822.arch_db }));
  }
  console.log(APPLY ? "rollback done" : "dry run: nothing changed (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify (read-only)
async function verify() {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const c = rb.created;
  const s = await state();
  const pf = await call("res.partner", "fields_get", { attributes: ["type", "selection", "string"] });
  const sel = (n) => (pf[n]?.selection ?? []).map((x) => x[0]).join(",");
  const checks = [
    ...FIELDS.map((d) => [`res.partner.${d.name} ${d.ttype} «${d.field_description}»`, pf[d.name]?.type === d.ttype && pf[d.name]?.string === d.field_description]),
    ["x_contact_class values", sel("x_contact_class") === "unreviewed,customer,supplier,team,personal"],
    ["x_ai_intent values", sel("x_ai_intent") === "purchase,wrong_number,vendor_pitch,personal,spam,unclear"],
    ["6 server actions", s.serverActions.length === 6],
    ["counter automation active", (await call("base.automation", "read", { ids: s.automation, fields: ["active"] }))[0]?.active === true],
    ["4 views", s.views.length === 4],
    ["action", s.action.length === 1],
    ["menu under UTAK", s.menu.length === 1],
    ["channel «📋 مراجعة الأرقام»", s.channel.length === 1],
  ];
  const [menu] = await call("ir.ui.menu", "read", { ids: s.menu, fields: ["name", "sequence", "action"] });
  const n = await call("res.partner", "search_count", { domain: [["x_review_pending", "=", true]] });
  checks.push([`menu label «${menu?.name}» = count ${n}`, menu?.name === `${MENU_LABEL} (${n})`]);
  const members = await call("discuss.channel.member", "search_read", { domain: [["channel_id", "=", s.channel[0]]], fields: ["partner_id", "custom_notifications"] });
  checks.push(["Baraa is a channel member (all messages)", members.some((m) => m.partner_id?.[0] === BARAA_PARTNER && m.custom_notifications === "all")]);
  // the list the action really opens: header buttons → the five server actions
  const views = await call("res.partner", "get_views", { views: [[c.reviewList, "list"], [c.reviewSearch, "search"], [false, "form"]] });
  const listArch = views.views.list.arch, searchArch = views.views.search.arch, formArch = views.views.form.arch;
  for (const b of BUTTONS) checks.push([`list button «${b.label}» → action ${c.serverActions[b.key]}`, listArch.includes(`name="${c.serverActions[b.key]}"`) && listArch.includes(`string="${b.label}"`)]);
  for (const col of ["name", "x_whatsapp_number", "x_ai_intent", "x_ai_reason", "x_review_last_msg", "x_review_last_at"]) {
    checks.push([`list column ${col}`, listArch.includes(`name="${col}"`)]);
  }
  checks.push(["search: pending / archived / not_customer", ["pending", "archived", "not_customer"].every((f) => searchArch.includes(`name="${f}"`))]);
  checks.push(["contact form shows the review group", formArch.includes("x_contact_class") && formArch.includes("x_review_pending")]);
  const [act] = await call("ir.actions.act_window", "read", { ids: s.action, fields: ["domain", "context", "view_id", "search_view_id"] });
  checks.push(["action opens on «ينتظر المراجعة»", String(act.context).includes("search_default_pending")]);
  // attendance
  const emp = await call("res.partner", "get_views", { views: [[2728, "list"], [2735, "form"], [c.empSearch, "search"]] });
  checks.push(["employees list: x_shift_start always shown (no optional)", /<field name="x_shift_start"(?![^>]*optional)[^>]*>/.test(emp.views.list.arch)]);
  checks.push(["employee form: x_shift_start", emp.views.form.arch.includes('name="x_shift_start"')]);
  checks.push(["employees search: «بلا وقت دوام»", emp.views.search.arch.includes('name="no_shift"')]);
  checks.push([`action ${EMP_ACTION} uses that search view`, s.action927.search_view_id?.[0] === c.empSearch]);
  const noShift = await call("res.partner", "search_read", {
    domain: [["x_role_ids.x_active", "=", true], "|", ["x_shift_start", "=", false], ["x_shift_start", "<=", 0]], fields: ["id", "name"],
  });
  checks.push([`filter finds the employees without a time: ${noShift.map((p) => p.id).join(",")}`, noShift.length >= 1]);
  const [a927] = await call("ir.actions.act_window", "read", { ids: [EMP_ACTION], fields: ["domain"] });
  const emps = await call("res.partner", "search_read", { domain: [["x_role_ids.x_active", "=", true]], fields: ["id"] });
  checks.push([`employees action = active roles only (${emps.map((p) => p.id).join(",")})`, a927.domain === EMP_DOMAIN && !emps.some((p) => [45, 49, 50, 54, 59].includes(p.id))]);
  const roleCodes = (await call("x_employee_role", "read", { ids: s.othman.x_role_ids, fields: ["x_code"] })).map((r) => r.x_code);
  const [oth] = await call("res.partner", "read", { ids: [OTHMAN], fields: ["x_contact_class", "customer_rank", "supplier_rank"] });
  checks.push([`عثمان: role ${roleCodes.join(",")}, class ${oth.x_contact_class}, ranks ${oth.customer_rank}/${oth.supplier_rank} unchanged`,
    roleCodes.includes("admin") && oth.x_contact_class === "team" && oth.customer_rank === rb.before.othman.customer_rank && oth.supplier_rank === rb.before.othman.supplier_rank]);
  let ok = true;
  for (const [name, cond] of checks) { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) ok = false; }
  console.log(`${checks.filter((x) => x[1]).length}/${checks.length}`);
  return ok;
}
if (VERIFY) process.exit((await verify()) ? 0 : 1);

// ---------------------------------------------------------------- verify the five buttons on a TEMP partner (creates it, deletes it)
if (VERIFY_BUTTONS) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const sa = rb.created.serverActions;
  const save = () => writeFileSync(RB, JSON.stringify(rb, null, 2));
  const FIELDS_READ = ["active", "x_contact_class", "x_review_pending", "customer_rank", "supplier_rank", "x_role_ids"];
  const [tmp] = await call("res.partner", "create", { vals_list: [{
    name: "TEMP-review-buttons-0925", x_whatsapp_number: "+966500009925", phone: "+966500009925",
    x_contact_class: "unreviewed", x_ai_intent: "spam", x_review_pending: true,
  }] });
  rb.created.tempPartner = tmp; save();
  const menuLabel = async () => (await call("ir.ui.menu", "read", { ids: rb.created.menu ? [rb.created.menu] : [], fields: ["name"] }))[0]?.name;
  const reset = (vals = {}) => call("res.partner", "write", { ids: [tmp], vals: { active: true, x_contact_class: "unreviewed", x_review_pending: true, customer_rank: 0, supplier_rank: 0, ...vals }, context: { active_test: false } });
  const read = async () => (await call("res.partner", "read", { ids: [tmp], fields: FIELDS_READ, context: { active_test: false } }))[0];
  const run = (key) => call("ir.actions.server", "run", { ids: [sa[key]], context: { active_model: "res.partner", active_ids: [tmp], active_id: tmp } });
  const out = [];
  const pendingCount = () => call("res.partner", "search_count", { domain: [["x_review_pending", "=", true]] });
  out.push(["counter follows a new pending partner", (await menuLabel()) === `${MENU_LABEL} (${await pendingCount()})`]);
  const expect = {
    customer: (r) => r.x_contact_class === "customer" && r.customer_rank >= 1 && r.supplier_rank === 0 && r.active,
    supplier: (r) => r.x_contact_class === "supplier" && r.supplier_rank >= 1 && r.customer_rank === 0 && r.active,
    team: (r) => r.x_contact_class === "team" && r.customer_rank === 0 && r.supplier_rank === 0 && (r.x_role_ids ?? []).length === 0 && r.active,
    personal: (r) => r.x_contact_class === "personal" && r.customer_rank === 0 && r.active,
    archive: (r) => r.x_contact_class === "unreviewed" && r.active === false,
  };
  for (const b of BUTTONS) {
    await reset();
    await run(b.key);
    const r = await read();
    out.push([`«${b.label}»: ${JSON.stringify(r)}`, expect[b.key](r) && r.x_review_pending === false]);
  }
  const stillThere = await find("res.partner", [["id", "=", tmp]]);
  out.push(["«أرشفة» does not delete (the row is still there, archived)", stillThere.length === 1]);
  out.push(["counter back after the decisions", (await menuLabel()) === `${MENU_LABEL} (${await pendingCount()})`]);
  // customer_rank already 3 stays 3 (no reset to 1)
  await reset({ customer_rank: 3 }); await run("customer");
  out.push(["«عميل» keeps a higher customer_rank", (await read()).customer_rank === 3]);
  await call("res.partner", "unlink", { ids: [tmp] });
  rb.created.tempPartner = null;
  rb.buttonsVerifiedAt = new Date().toISOString();
  rb.buttonsVerify = out.map(([n, c]) => ({ check: n, ok: !!c }));
  save();
  let ok = true;
  for (const [n, c] of out) { console.log(`${c ? "✓" : "✗"} ${n}`); if (!c) ok = false; }
  console.log(`TEMP partner ${tmp} deleted; counter now «${await menuLabel()}»`);
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- plan / apply
const before = await state();
const pf = await call("res.partner", "fields_get", { attributes: ["type", "string"] });
const clash = Object.entries(pf).filter(([k, v]) => !FIELDS.some((f) => f.name === k) && ["التصنيف", "نية الذكاء", "ينتظر المراجعة", "سبب الذكاء"].includes(v.string));
if (clash.length) throw new Error(`an existing field already covers this: ${clash.map(([k]) => k).join(",")}`);
const plan = [];
for (const f of FIELDS) plan.push(`res.partner.${f.name} (${f.ttype} «${f.field_description}»)`);
plan.push(`5 server actions (${BUTTONS.map((b) => b.label).join(" · ")}) + the counter action + automation «${COUNTER_BA}» (x_review_pending, active)`);
plan.push(`views: «${NAMES.reviewList}» (list + header buttons), «${NAMES.reviewSearch}», «${NAMES.formExt}» (on ${PARTNER_FORM}), «${NAMES.empSearch}» (primary on ${PARTNER_SEARCH})`);
plan.push(`action «${NAMES.action}» + menu «${MENU_LABEL} (N)» under UTAK (${UTAK_MENU_ID}) seq ${MENU_SEQUENCE}`);
plan.push(`channel «${CHANNEL_NAME}» (type channel) + Baraa (${BARAA_PARTNER}) member, all messages`);
plan.push(`view ${EMP_LIST_EXT}: «بداية الدوام» without optional (always shown)`);
plan.push(`action ${EMP_ACTION} (الموظفين): search_view_id ${JSON.stringify(before.action927.search_view_id)} → «${NAMES.empSearch}»`);
plan.push(`action ${EMP_ACTION} (الموظفين): domain ${before.action927.domain} → ${EMP_DOMAIN}`);
plan.push(`partner ${OTHMAN} «${before.othman.name}»: x_role_ids ${JSON.stringify(before.othman.x_role_ids)} → + ${OPS_ROLE} (مدير); x_contact_class → team; ranks ${before.othman.customer_rank}/${before.othman.supplier_rank} unchanged`);
console.log(`pre-state: ${JSON.stringify({ fields: before.fields, serverActions: before.serverActions, automation: before.automation, views: before.views, action: before.action, menu: before.menu, channel: before.channel, action927: before.action927.search_view_id, othmanRoles: before.othman.x_role_ids })}`);
console.log("plan:\n  " + plan.join("\n  "));
if (!APPLY) { console.log("dry run: nothing written (add --apply)"); process.exit(0); }

// Resumable: a step whose id is already recorded in the rollback file is
// skipped; anything that exists WITHOUT being recorded here was not made by
// this script, so apply refuses to touch it.
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { at: new Date().toISOString(), before, created: {} };
const created = rb.created;
const mine = (ids, rec) => ids.every((id) => [rec].flat().filter(Boolean).includes(id));
if (!mine(before.fields, created.fields) || !mine(before.serverActions, [...Object.values(created.serverActions ?? {}), created.counterSa])
    || !mine(before.automation, created.automation) || !mine(before.action, created.action) || !mine(before.menu, created.menu)
    || !mine(before.channel, created.channel)
    || !mine(before.views, [created.reviewList, created.reviewSearch, created.formExt, created.empSearch])) {
  throw new Error("something already exists that this script did not create — refusing (inspect first)");
}
const save = () => writeFileSync(RB, JSON.stringify(rb, null, 2));
save(); // pre-state on disk before the first write

const partnerModel = await partnerModelId();

// 1. fields
created.fields ??= [];
const have = new Set((await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "in", FIELDS.map((f) => f.name)]], fields: ["name"] })).map((r) => r.name));
for (const d of FIELDS) {
  if (have.has(d.name)) continue;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: partnerModel, ...d }] });
  created.fields.push(id); save();
}

// 2. server actions (buttons)
created.serverActions ??= {};
for (const b of BUTTONS) {
  if (created.serverActions[b.key]) continue;
  const [id] = await call("ir.actions.server", "create", { vals_list: [{ name: saName(b.key), model_id: partnerModel, state: "code", code: b.code }] });
  created.serverActions[b.key] = id; save();
}

// 3. views
const view = async (vals) => (await call("ir.ui.view", "create", { vals_list: [vals] }))[0];
created.reviewList ??= await view({ name: NAMES.reviewList, model: "res.partner", type: "list", mode: "primary", priority: 90, arch_base: reviewList(created.serverActions) }); save();
created.reviewSearch ??= await view({ name: NAMES.reviewSearch, model: "res.partner", type: "search", mode: "primary", priority: 90, arch_base: REVIEW_SEARCH }); save();
created.formExt ??= await view({ name: NAMES.formExt, model: "res.partner", type: "form", inherit_id: PARTNER_FORM, mode: "extension", priority: 70, arch_base: FORM_EXT }); save();
created.empSearch ??= await view({ name: NAMES.empSearch, model: "res.partner", type: "search", inherit_id: PARTNER_SEARCH, mode: "primary", priority: 90, arch_base: EMP_SEARCH }); save();

// 4. action + menu
if (!created.action) {
  [created.action] = await call("ir.actions.act_window", "create", { vals_list: [{
    name: NAMES.action, res_model: "res.partner", view_mode: "list,form",
    view_id: created.reviewList, search_view_id: created.reviewSearch,
    domain: "[('x_contact_class', '!=', False)]",
    context: "{'search_default_pending': 1, 'create': False}",
  }] });
  save();
}
if (!created.menu) {
  const n = await call("res.partner", "search_count", { domain: [["x_review_pending", "=", true]] });
  [created.menu] = await call("ir.ui.menu", "create", { vals_list: [{
    name: `${MENU_LABEL} (${n})`, parent_id: UTAK_MENU_ID, action: `ir.actions.act_window,${created.action}`, sequence: MENU_SEQUENCE,
  }] });
  save();
}

// 5. the counter: server action + automation (x_review_pending / active on any partner)
if (!created.counterSa) {
  [created.counterSa] = await call("ir.actions.server", "create", { vals_list: [{ name: COUNTER_SA, model_id: partnerModel, state: "code", code: counterCode(created.menu) }] });
  save();
}
if (!created.automation) {
  const trig = await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "in", ["x_review_pending", "active"]]], fields: ["id", "name"] });
  if (trig.length !== 2) throw new Error(`trigger fields: ${JSON.stringify(trig)}`);
  [created.automation] = await call("base.automation", "create", { vals_list: [{
    name: COUNTER_BA, model_id: partnerModel, trigger: "on_create_or_write",
    trigger_field_ids: [[6, 0, trig.map((f) => f.id)]], action_server_ids: [[6, 0, [created.counterSa]]], active: true,
  }] });
  save();
}

// 6. the channel
if (!created.channel) {
  [created.channel] = await call("discuss.channel", "create", { vals_list: [{
    name: CHANNEL_NAME, channel_type: "channel",
    description: "كل رقم يدخل «مراجعة الأرقام» (رقم غلط، عرض بيع لنا، شخصي، إزعاج، غير واضح) تُنشر عنه هنا رسالة واحدة. القرار من UTAK ← 📋 مراجعة الأرقام.",
  }] });
  save();
}
{
  const members = await call("discuss.channel.member", "search_read", { domain: [["channel_id", "=", created.channel]], fields: ["id", "partner_id", "custom_notifications"] });
  const baraa = members.find((m) => m.partner_id?.[0] === BARAA_PARTNER);
  if (!baraa) await call("discuss.channel.member", "create", { vals_list: [{ channel_id: created.channel, partner_id: BARAA_PARTNER, custom_notifications: "all" }] });
  else if (baraa.custom_notifications !== "all") await call("discuss.channel.member", "write", { ids: [baraa.id], vals: { custom_notifications: "all" } });
}

// 7. attendance display + Othman
if (!created.view2822) {
  await call("ir.ui.view", "write", { ids: [EMP_LIST_EXT], vals: { arch_base: LIST_EXT_2822 } });
  created.view2822 = true; save();
}
if (created.action927 === undefined) {
  await call("ir.actions.act_window", "write", { ids: [EMP_ACTION], vals: { search_view_id: created.empSearch } });
  created.action927 = created.empSearch; save();
}
// The employees action listed every WhatsApp customer too: createCustomer
// links the archived «Customer» role, and `x_role_ids != False` does not skip
// archived roles (reading x_role_ids does). Only an active role makes an employee.
if (!created.action927Domain) {
  rb.before.action927Domain = (await call("ir.actions.act_window", "read", { ids: [EMP_ACTION], fields: ["domain"] }))[0].domain;
  save();
  await call("ir.actions.act_window", "write", { ids: [EMP_ACTION], vals: { domain: EMP_DOMAIN } });
  created.action927Domain = true; save();
}
if (!created.othman) {
  await call("res.partner", "write", { ids: [OTHMAN], vals: { x_role_ids: [[4, OPS_ROLE]], x_contact_class: "team" } });
  created.othman = true; save();
}

console.log("created:", JSON.stringify(created));
process.exit((await verify()) ? 0 : 1);
