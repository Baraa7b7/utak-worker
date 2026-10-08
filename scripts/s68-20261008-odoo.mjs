// § 68 (2026-10-08) — the employee's file in Odoo (scripts/lib/s68-odoo.mjs is the data):
//
//   schema (BEFORE the worker's code — the code of before § 68 reads none of it):
//   1  x_team_attendance: «الخروج», «الساعات» (computed), «التأخير (دقيقة)», «المصدر», «ملاحظة», the two places;
//      the status «إجازة»; x_tapped_at is titled «الدخول»; a row made by hand is «يدوي» by default
//   2  resource.calendar.leaves: «نوع الإجازة»
//   3  the model x_employee_note (date, kind, text, attachment)
//   4  hr.employee: the papers (an x_ field where Odoo has none of its own, a state for each), «🗂️ اكتمال الأوراق ٪»,
//      «الأوراق الناقصة», «أقرب انتهاء ورقة», the month's six figures, the attendance and the notes of the card, the
//      time off and the cost lines as text, and the three fields the worker writes («العهدة والمستحقات», «الأداء»,
//      «آخر تحديث للأرقام»)
//   5  the papers of the three active cards start «ناقص» (an empty state alone is filled; a new card starts so too)
//
//   ui (--only=ui, AFTER the deploy — «🔄 حدّث الأرقام» calls a route the code of before does not have):
//   6  «🔄 حدّث الأرقام»: a webhook to the PROD worker (`/odoo/hook/employee-file?op=refresh`), with the hook secret
//      the other buttons carry (read from one of them, never printed)
//   7  the employee's own form with six tabs, the list's four columns, the filter «أوراق ناقصة», the attendance
//      list's columns (and rows by hand), «نوع الإجازة» on the time off
//   8  «UTAK — الموظفين» (#995): the list first, and the form of the six tabs; its menu is «👥 الموظفون»
//
//   node scripts/s68-20261008-odoo.mjs [--only=schema|ui]              dry-run (schema alone when no --only)
//   node scripts/s68-20261008-odoo.mjs [--only=…] --apply
//   node scripts/s68-20261008-odoo.mjs [--only=…] --verify
//   node scripts/s68-20261008-odoo.mjs --rollback [--only=ui] [--apply]   ui: the views off, #995 and its menu as they
//        were. Without --only: the ui, then the title of x_tapped_at and the three cards' states as they were.
//        The fields, the model, the status «إجازة», the defaults and the action stay (nothing is deleted).
//
// ROLLBACK ORDER: (1) --rollback --only=ui, (2) THE CODE, (3) --rollback. The worker of § 68 writes the new fields
// of the attendance row and reads the papers: they stay. Rollback file: scripts/artifacts/s68-20261008-odoo-rollback.json.
// The tenant is production. No WhatsApp send. No order, invoice, payment, cost line or journal entry is written here.
import { APPLY, ROLLBACK, VERIFY, call, checker, ensureFields, ensureModel, ensureServerAction, log, modelId, modelOrderAccess, one, rollbackFile } from "./lib/s40-kit.mjs";
import * as L from "./lib/s68-odoo.mjs";
import { PROD_HOST, tag } from "./lib/s67-token.mjs";

const RB = new URL("./artifacts/s68-20261008-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s68-20261008-odoo.mjs");
const { rb, save } = ctx;
const c = rb.created, b = rb.before;
const ALL = { active_test: false };
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=")[1] ?? "";
const ONLY = arg("only");
const on = (part) => (ONLY ? ONLY.split(",").includes(part) : part === "schema");
const pause = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const m2oId = (v) => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);

const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
const langs = async () => (await call("res.lang", "search_read", { domain: [["active", "=", true]], fields: ["code"] })).map((l) => l.code);
const labelOf = async (model, field, lang) => (await call(model, "fields_get", { allfields: [field], attributes: ["string"], context: { lang } }))[field]?.string ?? null;
const selectionOf = async (model, field) => {
  const f = await fieldId(model, field);
  return { f, rows: f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [] };
};
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "type", "mode", "priority"], context: ALL }))[0] ?? null;
const defaultsOf = async (fid) => (fid ? call("ir.default", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "json_value", "user_id", "company_id"] }) : []);
const actionViews = async () => call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "=", L.EMPLOYEE_ACTION]], fields: ["id", "sequence", "view_mode", "view_id"], order: "sequence asc, id asc" });
const action = async () => (await call("ir.actions.act_window", "read", { ids: [L.EMPLOYEE_ACTION], fields: ["id", "name", "view_mode", "view_id"] }))[0];
const menuName = async (lang) => (await call("ir.ui.menu", "read", { ids: [L.EMPLOYEE_MENU], fields: ["name"], context: { lang } }))[0]?.name ?? null;
const cards = async () => call(L.EMP_MODEL, "search_read", { domain: [["id", "in", L.ACTIVE_EMPLOYEES]], fields: ["id", "name", ...L.DOC_STATE_FIELDS], context: ALL, order: "id asc" });
/** The hook's base URL and token, from a button that carries them (the token is never printed: its tag alone). */
async function hookBase() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", "utak.team_roster.hook ← hr.employee"]], fields: ["webhook_url"], limit: 1 });
  const m = /^https:\/\/([^/]+)\/odoo\/hook\/[a-z-]+\?token=([A-Za-z0-9._~-]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) return null;
  return { host: m[1], token: m[2], url: `https://${m[1]}${L.REFRESH_PATH}?token=${m[2]}&op=refresh`, shown: `https://${m[1]}${L.REFRESH_PATH}?token=<tag:${tag(m[2])}>&op=refresh` };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const act = async (label, fn) => { log(`✎ ${label}`); if (APPLY) { await fn(); await pause(400); } };
  // the ui first: the screens of before
  if (b.action) await act(`act_window #${L.EMPLOYEE_ACTION}: view_mode ← ${b.action.view_mode}, view_id ← #${b.action.view_id}`, () => call("ir.actions.act_window", "write", { ids: [L.EMPLOYEE_ACTION], vals: { view_mode: b.action.view_mode, view_id: b.action.view_id || false } }));
  for (const [id, seq] of Object.entries(b.actionViews ?? {})) await act(`act_window.view #${id}: sequence ← ${seq}`, () => call("ir.actions.act_window.view", "write", { ids: [Number(id)], vals: { sequence: seq } }));
  if (c.actionFormView) await act(`act_window.view #${c.actionFormView} (the form of the six tabs): → Odoo's own form #${L.NATIVE_EMPLOYEE_FORM}`, () => call("ir.actions.act_window.view", "write", { ids: [c.actionFormView], vals: { view_id: L.NATIVE_EMPLOYEE_FORM } }));
  for (const [lang, name] of Object.entries(b.menuName ?? {})) await act(`menu #${L.EMPLOYEE_MENU} (${lang}): name ← «${name}»`, () => call("ir.ui.menu", "write", { ids: [L.EMPLOYEE_MENU], vals: { name }, context: { lang } }));
  for (const [key, id] of Object.entries(c.views ?? {}).filter(([, v]) => v)) await act(`view #${id} (${key}): off`, () => call("ir.ui.view", "write", { ids: [id], vals: { active: false } }));
  if (ONLY === "ui") { log(APPLY ? "the screens are as before — now roll the worker's code back, then run --rollback again for the rest" : "dry-run: nothing written (add --apply)"); process.exit(0); }
  for (const [lang, label] of Object.entries(b.tappedLabel ?? {})) await act(`${L.ATT_MODEL}.x_tapped_at (${lang}): title ← «${label}»`, async () => call("ir.model.fields", "write", { ids: [await fieldId(L.ATT_MODEL, "x_tapped_at")], vals: { field_description: label }, context: { lang } }));
  if ((b.attBackfill ?? []).length) await act(`${L.ATT_MODEL}: ${b.attBackfill.length} row(s) of before — source and minutes empty again`, () => call(L.ATT_MODEL, "write", { ids: b.attBackfill, vals: { x_source: false, x_late_min: 0 } }));
  for (const [id, vals] of Object.entries(b.states ?? {})) await act(`hr.employee #${id}: the papers' states as they were (${Object.keys(vals).length} empty again)`, () => call(L.EMP_MODEL, "write", { ids: [Number(id)], vals }));
  log("the fields, the model, the status «إجازة», the defaults and the action stay (nothing is deleted)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  if (on("schema")) {
    const af = await call(L.ATT_MODEL, "fields_get", { attributes: ["type", "string", "selection", "store", "readonly"] });
    for (const f of L.ATT_FIELDS) check(`${L.ATT_MODEL}.${f.name}: ${f.ttype}, «${f.field_description}»`, af[f.name]?.type === f.ttype && af[f.name].string === f.field_description, JSON.stringify(af[f.name]));
    check("…«الساعات» is computed and stored", af.x_hours?.readonly === true && af.x_hours?.store !== false);
    check("…the status «إجازة» is one of four", JSON.stringify((af.x_status?.selection ?? []).map((s) => s[0])) === JSON.stringify(["present", "late", "absent", "leave"]), JSON.stringify(af.x_status?.selection));
    check("…«المصدر»: واتساب / يدوي", JSON.stringify(af.x_source?.selection) === JSON.stringify(L.SOURCES), JSON.stringify(af.x_source?.selection));
    for (const lang of await langs()) check(`…x_tapped_at is titled «${L.TAPPED_LABEL}» (${lang})`, (await labelOf(L.ATT_MODEL, "x_tapped_at", lang)) === L.TAPPED_LABEL);
    const src = await defaultsOf(await fieldId(L.ATT_MODEL, "x_source"));
    const noSource = await call(L.ATT_MODEL, "search_count", { domain: [["x_source", "=", false], "|", ["x_sent_at", "!=", false], ["x_tapped_at", "!=", false]], context: ALL });
    const lateNoMin = await call(L.ATT_MODEL, "search_count", { domain: [["x_status", "=", "late"], ["x_late_min", "=", 0], ["x_tapped_at", "!=", false]], context: ALL });
    check("…every row of before has its source, and every «متأخر» its minutes", noSource === 0 && lateNoMin === 0, `${noSource} without a source, ${lateNoMin} «متأخر» with 0 minutes`);
    check("…a row made by hand is «يدوي» by default", src.length === 1 && src[0].json_value === "\"manual\"" && !src[0].user_id && !src[0].company_id, JSON.stringify(src));
    await pause();
    const lf = await call(L.LEAVE_MODEL, "fields_get", { allfields: ["x_leave_type"], attributes: ["type", "string", "selection"] });
    check(`${L.LEAVE_MODEL}.x_leave_type: «نوع الإجازة», five kinds`, lf.x_leave_type?.type === "selection" && lf.x_leave_type.string === "نوع الإجازة" && JSON.stringify(lf.x_leave_type.selection) === JSON.stringify(L.LEAVE_TYPES), JSON.stringify(lf.x_leave_type));
    const nm = await modelId(L.NOTE_MODEL);
    check(`model ${L.NOTE_MODEL}`, !!nm);
    if (nm) {
      const nf = await call(L.NOTE_MODEL, "fields_get", { attributes: ["type", "string", "relation", "required", "selection"] });
      for (const f of L.NOTE_FIELDS) check(`${L.NOTE_MODEL}.${f.name}: ${f.ttype}${f.relation ? ` → ${f.relation}` : ""}, «${f.field_description}»`, nf[f.name]?.type === f.ttype && nf[f.name].string === f.field_description && (!f.relation || nf[f.name].relation === f.relation) && (!f.required || nf[f.name].required === true), JSON.stringify(nf[f.name]));
      check("…its kinds: ملاحظة، تنبيه شفهي، إنذار كتابي، إشادة", JSON.stringify(nf.x_kind?.selection) === JSON.stringify(L.NOTE_KINDS), JSON.stringify(nf.x_kind?.selection));
    }
    await pause();
    const ef = await call(L.EMP_MODEL, "fields_get", { attributes: ["type", "string", "relation", "store", "readonly", "selection"] });
    for (const f of L.EMP_FIELDS) check(`${L.EMP_MODEL}.${f.name}: ${f.ttype}${f.relation ? ` → ${f.relation}` : ""}${f.compute ? (f.store ? ", computed and stored" : ", computed") : ""}`, ef[f.name]?.type === f.ttype && ef[f.name].string === f.field_description && (!f.relation || ef[f.name].relation === f.relation) && (!f.compute || (ef[f.name].readonly === true && (f.store ? ef[f.name].store !== false : ef[f.name].store === false))), JSON.stringify(ef[f.name]));
    for (const d of L.DOCS) {
      check(`the paper «${d.title}»: its number, its end, its attachment and its state are fields of the card`, [d.number, d.expiry, d.file, d.fileName, d.state].every((f) => !!ef[f]), [d.number, d.expiry, d.file, d.fileName, d.state].filter((f) => !ef[f]).join(", "));
      check(`…its state: ناقص / قيد الإجراء / مكتمل / لا ينطبق`, JSON.stringify(ef[d.state]?.selection) === JSON.stringify(L.DOC_STATES), JSON.stringify(ef[d.state]?.selection));
    }
    await pause();
    const cs = await cards();
    check(`the ${L.ACTIVE_EMPLOYEES.length} active cards: no paper's state is empty`, cs.length === L.ACTIVE_EMPLOYEES.length && cs.every((e) => L.DOC_STATE_FIELDS.every((f) => !!e[f])), JSON.stringify(cs.map((e) => [e.id, L.DOC_STATE_FIELDS.filter((f) => !e[f])])));
    const figures = await call(L.EMP_MODEL, "search_read", { domain: [["id", "in", L.ACTIVE_EMPLOYEES]], fields: ["id", "name", "x_docs_pct", "x_docs_missing", "x_docs_next_expiry", ...L.MONTH_FIELDS.map((f) => f.name), "x_leaves_text", "x_cost_text"], order: "id asc" });
    check("Odoo computes the papers' figures and the month's on every card (a read does not fail)", figures.length === L.ACTIVE_EMPLOYEES.length && figures.every((e) => Number.isInteger(e.x_docs_pct) && typeof e.x_leaves_text === "string" && typeof e.x_cost_text === "string"), JSON.stringify(figures).slice(0, 300));
    for (const e of figures) log(`    #${e.id} ${e.name}: papers ${e.x_docs_pct}% · missing «${e.x_docs_missing || "-"}» · month: present ${e.x_att_present}, late ${e.x_att_late} (${e.x_att_late_min} min), absent ${e.x_att_absent}, leave ${e.x_att_leave}, hours ${e.x_att_hours}`);
    const filter = await call(L.EMP_MODEL, "search_read", { domain: [["x_docs_pct", "<", 100], ["id", "in", L.ACTIVE_EMPLOYEES]], fields: ["id"] });
    check("«أوراق ناقصة» can be searched (the percentage is stored)", Array.isArray(filter));
    for (const d of L.DOC_STATE_FIELDS.slice(0, 1)) {
      const def = await defaultsOf(await fieldId(L.EMP_MODEL, d));
      check("a new card's papers start «ناقص»", def.length === 1 && def[0].json_value === "\"missing\"", JSON.stringify(def));
    }
  }
  if (on("ui")) {
    const base = await hookBase();
    const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", L.REFRESH_ACTION]], fields: ["id", "state", "model_name", "webhook_url"], context: ALL });
    check(`action ${L.REFRESH_ACTION} #${act?.id}: a webhook of ${L.EMP_MODEL} → ${base?.shown}`, !!base && act?.state === "webhook" && act.model_name === L.EMP_MODEL && act.webhook_url === base.url && base.host === PROD_HOST);
    for (const [key, name, model, parent, type, arch] of L.VIEWS(act?.id ?? null)) {
      const v = await viewByName(name);
      check(`view ${name}: on${parent ? `, an extension of #${parent}` : `, a ${type} of its own`}, as written`, !!v && v.active === true && v.model === model && (parent ? m2oId(v.inherit_id) === parent : !v.inherit_id) && v.arch_db === arch, JSON.stringify(v && { id: v.id, active: v.active, inherit: v.inherit_id, same: v.arch_db === arch }));
      void key;
    }
    await pause();
    const form = await viewByName(L.FORM_VIEW);
    const got = form ? await call(L.EMP_MODEL, "get_view", { view_id: form.id, view_type: "form" }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) })) : { error: "no view" };
    const pages = [...String(got.arch ?? "").matchAll(/<page string="([^"]+)"/g)].map((m) => m[1]);
    check("the employee's form loads with its six tabs, in order", JSON.stringify(pages) === JSON.stringify(["البيانات", "الحضور", "الأوراق", "العهدة والمستحقات", "الأداء", "الملاحظات والإنذارات"]), got.error ?? pages.join(" | "));
    check("…«العهدة والمستحقات» is the administrator's alone, and carries «🔄 حدّث الأرقام»", /<page string="العهدة والمستحقات"[^>]*groups="base\.group_system"/.test(form?.arch_db ?? "") && String(got.arch ?? "").includes("🔄 حدّث الأرقام"));
    const list = await call(L.EMP_MODEL, "get_view", { view_id: L.EMPLOYEE_LIST_VIEW, view_type: "list" }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
    const cols = [...String(list.arch ?? "").matchAll(/<field name="([a-z_]+)"/g)].map((m) => m[1]);
    check("the list loads: الوظيفة، حضور الشهر، التأخير، اكتمال الأوراق ٪، أقرب انتهاء ورقة — in that order after the name", JSON.stringify(cols.slice(0, 6)) === JSON.stringify(["name", "job_id", "x_att_present", "x_att_late", "x_docs_pct", "x_docs_next_expiry"]), list.error ?? cols.join(", "));
    const search = await call(L.EMP_MODEL, "get_view", { view_id: L.EMPLOYEE_SEARCH_VIEW, view_type: "search" }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
    check("the filter «أوراق ناقصة» is in the search", String(search.arch ?? "").includes("أوراق ناقصة"), search.error ?? "");
    const att = await call(L.ATT_MODEL, "get_view", { view_id: L.ATT_LIST_VIEW, view_type: "list" }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
    check("«حضور الفريق» loads with الخروج، الساعات، التأخير، المصدر، ملاحظة — and a row can be added by hand", ["x_out_at", "x_hours", "x_late_min", "x_source", "x_note"].every((f) => String(att.arch ?? "").includes(`name="${f}"`)) && /create="1"/.test(String(att.arch ?? "")) && /editable="top"/.test(String(att.arch ?? "")), att.error ?? "");
    for (const [id, type] of [[L.LEAVE_LIST_VIEW, "list"], [L.LEAVE_FORM_VIEW, "form"]]) {
      const lv = await call(L.LEAVE_MODEL, "get_view", { view_id: id, view_type: type }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
      check(`the time off's ${type} loads with «نوع الإجازة»`, String(lv.arch ?? "").includes('name="x_leave_type"'), lv.error ?? "");
    }
    await pause();
    const a = await action();
    const avs = await actionViews();
    check(`«UTAK — الموظفين» (#${L.EMPLOYEE_ACTION}): the list first, then the cards, then the form of the six tabs`, a.view_mode === "list,kanban,form" && m2oId(a.view_id) === L.EMPLOYEE_LIST_VIEW && JSON.stringify(avs.map((v) => [v.view_mode, m2oId(v.view_id)])) === JSON.stringify([["list", L.EMPLOYEE_LIST_VIEW], ["kanban", L.EMPLOYEE_KANBAN_VIEW], ["form", form?.id]]), JSON.stringify({ mode: a.view_mode, views: avs.map((v) => [v.sequence, v.view_mode, v.view_id]) }));
    for (const lang of await langs()) check(`its menu is «${L.EMPLOYEE_MENU_NAME}» (${lang})`, (await menuName(lang)) === L.EMPLOYEE_MENU_NAME);
  }
  done();
}

// ---------------------------------------------------------------- apply / dry-run
log(APPLY ? `APPLY — ${ONLY || "schema"}` : `dry-run — ${ONLY || "schema"} (nothing is written; add --apply)`);
if (on("schema")) {
  // 1 — the attendance row
  const attMid = await modelId(L.ATT_MODEL);
  await ensureFields(ctx, L.ATT_MODEL, attMid, L.ATT_FIELDS);
  const st = await selectionOf(L.ATT_MODEL, "x_status");
  if (st.rows.some((r) => r.value === L.LEAVE_STATUS.value)) log(`= ${L.ATT_MODEL}.x_status «${L.LEAVE_STATUS.name}»`);
  else {
    log(`+ ${L.ATT_MODEL}.x_status: the value «${L.LEAVE_STATUS.name}» (${L.LEAVE_STATUS.value})`);
    if (APPLY) { c.leaveStatus = (await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: st.f, ...L.LEAVE_STATUS }] }))[0]; save(); log(`  → #${c.leaveStatus}`); }
  }
  const tapped = await fieldId(L.ATT_MODEL, "x_tapped_at");
  for (const lang of await langs()) {
    const cur = await labelOf(L.ATT_MODEL, "x_tapped_at", lang);
    if (cur === L.TAPPED_LABEL) { log(`= ${L.ATT_MODEL}.x_tapped_at (${lang}) «${cur}»`); continue; }
    log(`✎ ${L.ATT_MODEL}.x_tapped_at (${lang}): title «${cur}» → «${L.TAPPED_LABEL}»`);
    if (APPLY) { b.tappedLabel ??= {}; b.tappedLabel[lang] ??= cur; save(); await call("ir.model.fields", "write", { ids: [tapped], vals: { field_description: L.TAPPED_LABEL }, context: { lang } }); await pause(300); }
  }
  const setDefault = async (model, field, value, keyName) => {
    const fid = await fieldId(model, field);
    const have = await defaultsOf(fid);
    if (have.length) { log(`= default of ${model}.${field}: ${have[0].json_value}`); return; }
    log(`+ default of ${model}.${field}: ${JSON.stringify(value)}`);
    if (APPLY && fid) { c.defaults ??= {}; c.defaults[keyName] = (await call("ir.default", "create", { vals_list: [{ field_id: fid, json_value: JSON.stringify(value) }] }))[0]; save(); await pause(250); }
  };
  await setDefault(L.ATT_MODEL, "x_source", "manual", "attSource");
  await pause();
  // the rows of before (every one of them came from WhatsApp): their source, and the minutes of a «متأخر»
  if (await fieldId(L.ATT_MODEL, "x_source")) {
    const old = await call(L.ATT_MODEL, "search_read", { domain: [["x_source", "=", false]], fields: ["id", "x_status", "x_shift_at", "x_tapped_at", "x_sent_at", "x_late_min"], order: "id asc", limit: 500, context: ALL });
    const ms = (v) => Date.parse(String(v).replace(" ", "T") + "Z");
    const todo = old.filter((r) => r.x_sent_at || r.x_tapped_at).map((r) => ({ id: r.id, late: r.x_status === "late" && r.x_tapped_at && r.x_shift_at && !r.x_late_min ? Math.max(0, Math.floor((ms(r.x_tapped_at) - ms(r.x_shift_at)) / 60000)) : null }));
    if (!todo.length) log(`= ${L.ATT_MODEL}: no row of before without a source`);
    else {
      log(`✎ ${L.ATT_MODEL}: ${todo.length} row(s) of before ← «واتساب»; the minutes of ${todo.filter((t) => t.late !== null).length} «متأخر» among them from their own two times`);
      if (APPLY) {
        b.attBackfill ??= [];
        for (const t of todo) {
          b.attBackfill.push(t.id); save();
          await call(L.ATT_MODEL, "write", { ids: [t.id], vals: { x_source: "whatsapp", ...(t.late !== null ? { x_late_min: t.late } : {}) } });
          await pause(250);
        }
      }
    }
  } else log(`+ ${L.ATT_MODEL}: the rows of before ← «واتساب», and the minutes of each «متأخر»`);
  // 2 — the time off
  await ensureFields(ctx, L.LEAVE_MODEL, await modelId(L.LEAVE_MODEL), L.LEAVE_FIELDS);
  // 3 — the notes
  const noteMid = await ensureModel(ctx, "noteModel", L.NOTE_MODEL, L.NOTE_MODEL_NAME);
  await ensureFields(ctx, L.NOTE_MODEL, noteMid, L.NOTE_FIELDS);
  await modelOrderAccess(noteMid, L.NOTE_MODEL, "x_date desc, id desc");
  await pause();
  // 4 — the card
  await ensureFields(ctx, L.EMP_MODEL, await modelId(L.EMP_MODEL), L.EMP_FIELDS);
  for (const f of L.DOC_STATE_FIELDS) await setDefault(L.EMP_MODEL, f, "missing", f);
  // 5 — the three active cards
  const haveStates = !!(await fieldId(L.EMP_MODEL, L.DOC_STATE_FIELDS[0]));
  if (!haveStates) log(`+ hr.employee ${L.ACTIVE_EMPLOYEES.map((i) => `#${i}`).join(" ")}: every paper's state ← «ناقص»`);
  else for (const e of await cards()) {
    const empty = L.DOC_STATE_FIELDS.filter((f) => !e[f]);
    if (!empty.length) { log(`= hr.employee #${e.id} ${e.name}: no empty state`); continue; }
    log(`✎ hr.employee #${e.id} ${e.name}: ${empty.length} empty state(s) ← «ناقص»`);
    if (APPLY) { b.states ??= {}; b.states[e.id] ??= Object.fromEntries(empty.map((f) => [f, false])); save(); await call(L.EMP_MODEL, "write", { ids: [e.id], vals: Object.fromEntries(empty.map((f) => [f, "missing"])) }); await pause(400); }
  }
}
if (on("ui")) {
  // 6 — «🔄 حدّث الأرقام»
  const base = await hookBase();
  if (!base) { log("✗ no button carries the hook's token (utak.team_roster.hook ← hr.employee) — stopped"); process.exit(1); }
  if (base.host !== PROD_HOST) { log(`✗ the hook's host is ${base.host}, not prod — stopped`); process.exit(1); }
  log(`  the button's URL: ${base.shown}`);
  const empMid = await modelId(L.EMP_MODEL);
  const refresh = await ensureServerAction(ctx, "refresh", L.REFRESH_ACTION, { model_id: empMid, state: "webhook", webhook_url: base.url, webhook_field_ids: [[6, 0, []]] });
  if (refresh) {
    const [cur] = await call("ir.actions.server", "read", { ids: [refresh], fields: ["webhook_url"] });
    if (cur.webhook_url !== base.url) { log(`✎ action #${refresh}: its URL ← the hook's token of today`); if (APPLY) await call("ir.actions.server", "write", { ids: [refresh], vals: { webhook_url: base.url } }); }
  }
  await pause();
  // 7 — the views
  c.views ??= {};
  for (const [key, name, model, parent, type, arch] of L.VIEWS(refresh ?? null)) {
    const v = await viewByName(name);
    if (!v) {
      log(`+ view ${name} (${parent ? `an extension of #${parent}` : `a ${type} of its own`})`);
      if (APPLY) {
        c.views[key] = (await call("ir.ui.view", "create", { vals_list: [{ name, model, type, arch_db: arch, priority: parent ? 100 : 95, ...(parent ? { inherit_id: parent, mode: "extension" } : { mode: "primary" }) }] }))[0];
        save(); log(`  → #${c.views[key]}`); await pause(500);
      }
      continue;
    }
    c.views[key] ??= v.id;
    if (v.arch_db === arch && v.active) { log(`= view ${name} #${v.id}`); continue; }
    log(`✎ view ${name} #${v.id}: ${v.active ? "" : "on, "}its arch as written`);
    if (APPLY) { await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_db: arch, active: true } }); save(); await pause(500); }
  }
  // 8 — the action and its menu
  const form = await viewByName(L.FORM_VIEW);
  const a = await action();
  const avs = await actionViews();
  if (a.view_mode !== "list,kanban,form" || m2oId(a.view_id) !== L.EMPLOYEE_LIST_VIEW) {
    log(`✎ act_window #${L.EMPLOYEE_ACTION}: view_mode «${a.view_mode}» → «list,kanban,form», view_id → #${L.EMPLOYEE_LIST_VIEW}`);
    if (APPLY) { b.action ??= { view_mode: a.view_mode, view_id: m2oId(a.view_id) }; save(); await call("ir.actions.act_window", "write", { ids: [L.EMPLOYEE_ACTION], vals: { view_mode: "list,kanban,form", view_id: L.EMPLOYEE_LIST_VIEW } }); }
  } else log(`= act_window #${L.EMPLOYEE_ACTION}: list,kanban,form`);
  for (const [mode, seq] of [["list", 1], ["kanban", 2]]) {
    const row = avs.find((v) => v.view_mode === mode);
    if (!row) { log(`✗ act_window #${L.EMPLOYEE_ACTION} has no ${mode} row`); continue; }
    if (row.sequence === seq) { log(`= act_window.view #${row.id} ${mode}: sequence ${seq}`); continue; }
    log(`✎ act_window.view #${row.id} ${mode}: sequence ${row.sequence} → ${seq}`);
    if (APPLY) { b.actionViews ??= {}; b.actionViews[row.id] ??= row.sequence; save(); await call("ir.actions.act_window.view", "write", { ids: [row.id], vals: { sequence: seq } }); await pause(300); }
  }
  const formRow = avs.find((v) => v.view_mode === "form");
  if (formRow && form && m2oId(formRow.view_id) === form.id) log(`= act_window.view #${formRow.id} form → #${form.id}`);
  else if (formRow) {
    log(`✎ act_window.view #${formRow.id} form → the form of the six tabs`);
    if (APPLY && form) await call("ir.actions.act_window.view", "write", { ids: [formRow.id], vals: { view_id: form.id, sequence: 3 } });
  } else {
    log(`+ act_window.view of #${L.EMPLOYEE_ACTION}: form → the form of the six tabs (sequence 3)`);
    if (APPLY && form) { c.actionFormView = (await call("ir.actions.act_window.view", "create", { vals_list: [{ act_window_id: L.EMPLOYEE_ACTION, view_mode: "form", view_id: form.id, sequence: 3 }] }))[0]; save(); log(`  → #${c.actionFormView}`); }
  }
  for (const lang of await langs()) {
    const cur = await menuName(lang);
    if (cur === L.EMPLOYEE_MENU_NAME) { log(`= menu #${L.EMPLOYEE_MENU} (${lang}) «${cur}»`); continue; }
    log(`✎ menu #${L.EMPLOYEE_MENU} (${lang}): «${cur}» → «${L.EMPLOYEE_MENU_NAME}»`);
    if (APPLY) { b.menuName ??= {}; b.menuName[lang] ??= cur; save(); await call("ir.ui.menu", "write", { ids: [L.EMPLOYEE_MENU], vals: { name: L.EMPLOYEE_MENU_NAME }, context: { lang } }); await pause(300); }
  }
}
save();
log(APPLY ? `applied (${ONLY || "schema"}) — now --verify` : "dry-run: nothing written (add --apply)");
