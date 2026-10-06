// § 59 أ + ب 2 + د 2 (2026-10-06) — Omar's operating roles to Baraa, the company's working days, and
// the rows of the two templates (scripts/lib/s59-odoo.mjs and scripts/lib/s59-templates.mjs are the data):
//
//   1  x_employee_role: «تسويق» (marketing)
//   2  resource.calendar «UTAK — أيام العمل»: a copy of Omar's schedule #3 as it is now (7 days)
//   3  x_pricing_config.x_workdays_calendar_id «جدول أيام العمل (حصة التكلفة)», set on the active
//      settings to (2), and shown on «⚙️ الإعدادات» (an extension view of #2855; #2855 is not edited)
//   4  hr.employee «براء»: Work Contact #45 (his own partner), roles سائق + شراء + محصّل, «مشمول
//      بالتحضير», schedule (2) — every operating task follows the roles to him
//   5  hr.employee #4 عمر: roles ← «تسويق» alone; «مصدر أسعار» off (no 02:30 ask, no 05:00 reminder);
//      «مشمول بالتحضير» off (no «بدء الدوام»). His schedule #3 and «دور الأسعار» stay on his card.
//   6  x_whatsapp_template.x_purpose: «team_prices_ready» and «customer_quotation_pdf_v2», and the row
//      of each template with what Meta says of it now (scripts/s59-20261006-templates.mjs --status first)
//
//   node scripts/s59-20261006-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s59-20261006-odoo.mjs --apply            the six steps (the rollback file first)
//   node scripts/s59-20261006-odoo.mjs --verify           read-only checks
//   node scripts/s59-20261006-odoo.mjs --rollback [--apply]   THE ROLES AS THEY WERE, in one run: Omar's roles,
//        «مصدر أسعار» and «مشمول بالتحضير» back; Baraa's employee without roles, off attendance and archived;
//        the settings' schedule emptied (the costs read the driver's schedule again — Omar's); the
//        extension view off; the two rows' purposes to «other»; «تسويق» and the schedule archived.
//        Nothing is deleted (--drop: by Baraa's decision only, after the worker's code is rolled back).
//
// Rollback file: scripts/artifacts/s59-20261006-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, order, invoice, payment or journal entry is written here.
// APPLY (1)–(3) AND (6) BEFORE THE WORKER'S CODE; (4)–(5) MOVE THE TASKS AND GO WITH THE DEPLOY
// (`--only=roles` / `--skip=roles`): the code of before § 59 refuses a team message to Baraa's number.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, one, rollbackFile } from "./lib/s40-kit.mjs";
import {
  CALENDAR_MODEL, COMPANY, CONFIG_MODEL, EMPLOYEE_MODEL, MARKETING_ROLE, OMAR_CALENDAR, OMAR_EMPLOYEE, OPERATING_CODES, OWNER_EMPLOYEE_NAME,
  OWNER_PARTNER, ROLE_MODEL, SETTINGS_EXT_NAME, SETTINGS_VIEW, TPL_MODEL, WORKDAYS_CALENDAR_NAME, WORKDAYS_FIELD, WORKDAYS_SENTENCE, settingsExtArch,
} from "./lib/s59-odoo.mjs";
import { S59_TEMPLATES } from "./lib/s59-templates.mjs";

const RB = new URL("./artifacts/s59-20261006-odoo-rollback.json", import.meta.url);
const META = new URL("./artifacts/s59-20261006-templates-meta.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s59-20261006-odoo.mjs");
const { rb, save } = ctx;
const c = rb.created, b = rb.before;
const ALL = { active_test: false };
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=")[1] ?? "";
const ONLY = arg("only"), SKIP = arg("skip");
const on = (part) => (ONLY ? ONLY.split(",").includes(part) : !SKIP.split(",").includes(part));
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const m2oId = (v) => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const sameSet = (x, y) => JSON.stringify([...x].sort((p, q) => p - q)) === JSON.stringify([...y].sort((p, q) => p - q));
/** OWNER_WHATSAPP of prod (wrangler.toml [vars]) — compared, never printed. */
const ownerDigits = digits((/^OWNER_WHATSAPP\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) ?? [])[1]);

const EMP_FIELDS = ["id", "name", "active", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp", "resource_calendar_id", "resource_id", "company_id", "x_price_source", "x_price_role"];
const LINE_FIELDS = ["id", "calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date"];
const roles = async () => call(ROLE_MODEL, "search_read", { domain: [], fields: ["id", "x_name", "x_code", "x_active"], context: ALL, order: "id asc", limit: 60 });
const employee = async (id) => (await call(EMPLOYEE_MODEL, "search_read", { domain: [["id", "=", id]], fields: EMP_FIELDS, context: ALL }))[0] ?? null;
const ownerEmployee = async () => (await call(EMPLOYEE_MODEL, "search_read", { domain: [["work_contact_id", "=", OWNER_PARTNER]], fields: EMP_FIELDS, context: ALL, order: "id asc" }));
const calendarByName = async (name) => (await call(CALENDAR_MODEL, "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "company_id"], context: ALL, order: "id asc" }));
const linesOf = async (id) => call("resource.calendar.attendance", "search_read", { domain: [["calendar_id", "=", id]], fields: LINE_FIELDS, order: "dayofweek asc, hour_from asc", limit: 100 });
const lineKey = (l) => `${l.dayofweek}:${l.hour_from}-${l.hour_to}:${l.duration_based ? "d" : "t"}`;
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CONFIG_MODEL, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model"], context: ALL }))[0] ?? null;
const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
const selection = async (fid) => call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });
const tplRows = async (name) => call(TPL_MODEL, "search_read", { domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]], fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text"], limit: 2 });
const atMeta = (name) => (existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).templates?.[name] ?? null : null);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const act = async (label, fn) => { log(`✎ ${label}`); if (APPLY) { await fn(); await pause(400); } };
  // the roles first: Omar as he was, Baraa out of the team
  if (b.omar) {
    await act(`hr.employee #${OMAR_EMPLOYEE} عمر: roles ← [${b.omar.x_utak_role_ids.join(", ")}], «مصدر أسعار» ← ${b.omar.x_price_source}, «مشمول بالتحضير» ← ${b.omar.x_utak_attendance}`,
      () => call(EMPLOYEE_MODEL, "write", { ids: [OMAR_EMPLOYEE], vals: { x_utak_role_ids: [[6, 0, b.omar.x_utak_role_ids]], x_price_source: b.omar.x_price_source, x_utak_attendance: b.omar.x_utak_attendance } }));
  } else log("= عمر: not changed by this script");
  if (c.ownerEmployee) {
    await act(`hr.employee #${c.ownerEmployee} «${OWNER_EMPLOYEE_NAME}» (created here): roles ← [], «مشمول بالتحضير» ← false, archived (not deleted)`,
      () => call(EMPLOYEE_MODEL, "write", { ids: [c.ownerEmployee], vals: { x_utak_role_ids: [[6, 0, []]], x_utak_attendance: false, active: false } }));
  } else if (b.ownerEmployee) {
    await act(`hr.employee #${b.ownerEmployee.id} (existed before): roles ← [${b.ownerEmployee.x_utak_role_ids.join(", ")}], «مشمول بالتحضير» ← ${b.ownerEmployee.x_utak_attendance}, schedule ← ${b.ownerEmployee.resource_calendar_id || "none"}, active ← ${b.ownerEmployee.active}`,
      () => call(EMPLOYEE_MODEL, "write", { ids: [b.ownerEmployee.id], vals: { x_utak_role_ids: [[6, 0, b.ownerEmployee.x_utak_role_ids]], x_utak_attendance: b.ownerEmployee.x_utak_attendance, resource_calendar_id: b.ownerEmployee.resource_calendar_id || false, active: b.ownerEmployee.active } }));
  } else log("= Baraa's employee: not created by this script");
  // the costs' working days: the driver's schedule again (Omar holds «سائق» again above)
  if (b.config) {
    await act(`${CONFIG_MODEL} #${b.config.id}: ${WORKDAYS_FIELD.name} ← ${b.config.calendar || "empty"}`, () => call(CONFIG_MODEL, "write", { ids: [b.config.id], vals: { [WORKDAYS_FIELD.name]: b.config.calendar || false } }));
  }
  if (c.views?.settingsExt) await act(`view #${c.views.settingsExt} ${SETTINGS_EXT_NAME}: off`, () => call("ir.ui.view", "write", { ids: [c.views.settingsExt], vals: { active: false } }));
  for (const t of S59_TEMPLATES) {
    const row = (await tplRows(t.name))[0];
    if (row && row.x_purpose === t.purpose) await act(`${TPL_MODEL} #${row.id} ${t.name}: x_purpose ${row.x_purpose} → other`, () => call(TPL_MODEL, "write", { ids: [row.id], vals: { x_purpose: "other" } }));
  }
  if (c.calendar) await act(`resource.calendar #${c.calendar} «${WORKDAYS_CALENDAR_NAME}»: archived (not deleted)`, () => call(CALENDAR_MODEL, "write", { ids: [c.calendar], vals: { active: false } }));
  if (c.role) await act(`${ROLE_MODEL} #${c.role} «${MARKETING_ROLE.x_name}»: x_active ← false (not deleted)`, () => call(ROLE_MODEL, "write", { ids: [c.role], vals: { x_active: false } }));
  log(DROP ? "created records and the field: dropped" : `the field ${WORKDAYS_FIELD.name}, the two purposes and the created rows stay (nothing is deleted)`);
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.view", [c.views?.settingsExt]], [TPL_MODEL, Object.values(c.rows ?? {})], ["ir.model.fields.selection", Object.values(c.purposes ?? {})],
      ["ir.model.fields", [...(c.fields ?? [])].reverse()],
    ]);
  }
  log(APPLY ? "rollback done — the roster's cache drops itself (the automations of hr.employee); verify with scripts/s59-20261006-diag.mjs" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const rs = await roles();
  const byCode = new Map(rs.filter((r) => r.x_active).map((r) => [r.x_code, r.id]));
  const mk = rs.filter((r) => r.x_code === MARKETING_ROLE.x_code);
  check(`one role «${MARKETING_ROLE.x_name}» (${MARKETING_ROLE.x_code}), active`, mk.length === 1 && mk[0].x_active === true && mk[0].x_name === MARKETING_ROLE.x_name, JSON.stringify(mk));
  await pause();
  const cals = await calendarByName(WORKDAYS_CALENDAR_NAME);
  const cal = cals[0];
  const [mine, omars] = cal ? [await linesOf(cal.id), await linesOf(OMAR_CALENDAR)] : [[], []];
  check(`one schedule «${WORKDAYS_CALENDAR_NAME}», active, the company's`, cals.length === 1 && cal.active === true && m2oId(cal.company_id) === COMPANY, JSON.stringify(cals));
  check(`…a copy of Omar's schedule #${OMAR_CALENDAR} as it is: ${omars.map(lineKey).join(" ")}`, mine.length === omars.length && mine.length > 0 && JSON.stringify(mine.map(lineKey)) === JSON.stringify(omars.map(lineKey)), JSON.stringify(mine.map(lineKey)));
  check("…7 working days a week, each with clock hours", new Set(mine.map((l) => l.dayofweek)).size === 7 && mine.every((l) => !l.duration_based && l.hour_to > l.hour_from && !l.date), JSON.stringify(mine.map(lineKey)));
  await pause();
  const f = await call(CONFIG_MODEL, "fields_get", { attributes: ["type", "string", "relation"] });
  check(`${CONFIG_MODEL}.${WORKDAYS_FIELD.name}: many2one → ${CALENDAR_MODEL}, «${WORKDAYS_FIELD.field_description}»`, f[WORKDAYS_FIELD.name]?.type === "many2one" && f[WORKDAYS_FIELD.name].relation === CALENDAR_MODEL && f[WORKDAYS_FIELD.name].string === WORKDAYS_FIELD.field_description, JSON.stringify(f[WORKDAYS_FIELD.name]));
  const cfg = await activeConfig(["id", WORKDAYS_FIELD.name]);
  check(`the active settings #${cfg?.id} name it`, !!cal && m2oId(cfg?.[WORKDAYS_FIELD.name]) === cal.id, JSON.stringify(cfg));
  const ext = await viewByName(SETTINGS_EXT_NAME);
  check(`the extension view of #${SETTINGS_VIEW} is on, shows the field and the sentence`, !!ext && ext.active === true && m2oId(ext.inherit_id) === SETTINGS_VIEW && ext.arch_db.includes(`name="${WORKDAYS_FIELD.name}"`) && ext.arch_db.includes("جدول ثابت للشركة"), JSON.stringify(ext && { id: ext.id, active: ext.active, inherit: ext.inherit_id }));
  const combined = await call(CONFIG_MODEL, "get_view", { view_id: SETTINGS_VIEW, view_type: "form" }).catch((e) => ({ error: String(e?.message ?? e) }));
  check("«⚙️ الإعدادات» renders with it (get_view), the old sentence about the driver's schedule gone", typeof combined?.arch === "string" && combined.arch.includes(`name="${WORKDAYS_FIELD.name}"`) && combined.arch.includes(WORKDAYS_SENTENCE.slice(0, 40)) && !combined.arch.includes("من جدول دوام السائق"), String(combined?.error ?? "").slice(0, 200));
  await pause();
  if (on("roles")) {
    const owners = await ownerEmployee();
    const me = owners[0];
    const wantRoles = OPERATING_CODES.map((k) => byCode.get(k));
    check(`one employee on Baraa's partner #${OWNER_PARTNER}, active`, owners.length === 1 && me.active === true, JSON.stringify(owners.map((e) => [e.id, e.active])));
    check(`…roles ${OPERATING_CODES.join(" + ")} (and no other)`, !!me && sameSet(me.x_utak_role_ids, wantRoles), JSON.stringify(me?.x_utak_role_ids));
    check("…«مشمول بالتحضير», on the company's schedule", !!me && me.x_utak_attendance === true && m2oId(me.resource_calendar_id) === cal?.id, JSON.stringify(me && [me.x_utak_attendance, me.resource_calendar_id]));
    check("…his number (from the Work Contact) is OWNER_WHATSAPP of prod", !!me && !!ownerDigits && digits(me.x_utak_whatsapp) === ownerDigits, `…${digits(me?.x_utak_whatsapp).slice(-4)}`);
    const omar = await employee(OMAR_EMPLOYEE);
    check(`عمر #${OMAR_EMPLOYEE}: role «${MARKETING_ROLE.x_name}» alone`, !!omar && sameSet(omar.x_utak_role_ids, [byCode.get(MARKETING_ROLE.x_code)]), JSON.stringify(omar?.x_utak_role_ids));
    check("…«مصدر أسعار» off (no 02:30 ask, no 05:00 reminder), «دور الأسعار» kept", !!omar && omar.x_price_source === false && omar.x_price_role === (b.omar?.x_price_role ?? omar.x_price_role), JSON.stringify(omar && [omar.x_price_source, omar.x_price_role]));
    check(`…off attendance (no «بدء الدوام»), his schedule #${OMAR_CALENDAR} kept, active`, !!omar && omar.x_utak_attendance === false && m2oId(omar.resource_calendar_id) === OMAR_CALENDAR && omar.active === true, JSON.stringify(omar && [omar.x_utak_attendance, omar.resource_calendar_id, omar.active]));
    const team = await call(EMPLOYEE_MODEL, "search_read", { domain: [["x_utak_role_ids", "!=", false]], fields: ["id", "x_utak_role_ids"], order: "id asc" });
    for (const k of OPERATING_CODES) {
      const holders = team.filter((e) => e.x_utak_role_ids.includes(byCode.get(k))).map((e) => e.id);
      check(`«${k}» is held by Baraa's employee alone`, holders.length === 1 && holders[0] === me?.id, JSON.stringify(holders));
    }
    const src = await call(EMPLOYEE_MODEL, "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name"] });
    check("no employee is a price source (the market is رائد's)", src.length === 0, JSON.stringify(src));
    await pause();
  }
  if (on("templates")) {
    const tf = await call(TPL_MODEL, "fields_get", { attributes: ["type", "selection"] });
    for (const t of S59_TEMPLATES) {
      check(`${TPL_MODEL}.x_purpose carries «${t.purposeLabel}» (${t.purpose})`, (tf.x_purpose?.selection ?? []).some((s) => s[0] === t.purpose && s[1] === t.purposeLabel), JSON.stringify((tf.x_purpose?.selection ?? []).slice(-3)));
      const rows = await tplRows(t.name);
      const meta = atMeta(t.name);
      check(`one row of ${t.name} (ar), purpose ${t.purpose}, ${t.params} variable(s), as Meta has it (${meta?.status}/${meta?.category})`, rows.length === 1 && rows[0].x_purpose === t.purpose && rows[0].x_param_count === t.params && rows[0].x_meta_id === meta?.id && rows[0].x_meta_status === meta?.status && rows[0].x_category === meta?.category, JSON.stringify(rows));
      const holders = await call(TPL_MODEL, "search_read", { domain: [["x_purpose", "=", t.purpose]], fields: ["id", "x_meta_template_id"] });
      check(`…and no other row holds ${t.purpose}`, holders.length === 1, JSON.stringify(holders));
      if (t.replaces) {
        const old = await call(TPL_MODEL, "search_read", { domain: [["x_meta_template_id", "=", t.replaces]], fields: ["id", "x_purpose", "x_meta_status", "x_category"] });
        check(`${t.replaces} keeps its purpose (the fallback)`, old.length === 1 && old[0].x_purpose === "customer_quotation_pdf", JSON.stringify(old));
      }
      await pause();
    }
    const welcome = await call(TPL_MODEL, "search_read", { domain: [["x_meta_template_id", "=", "utak_welcome"]], fields: ["id", "x_purpose", "x_meta_status"] });
    check("utak_welcome's row is untouched (the worker no longer sends it; nothing is deleted)", welcome.length === 1 && welcome[0].x_purpose === "customer_welcome", JSON.stringify(welcome));
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
if (!ownerDigits) throw new Error("OWNER_WHATSAPP not found in wrangler.toml — stop");
save(); // the rollback file before the first write
const rs = await roles();
const byCode = new Map(rs.filter((r) => r.x_active).map((r) => [r.x_code, r.id]));
for (const k of OPERATING_CODES) if (!byCode.get(k)) throw new Error(`role ${k} missing or inactive — stop`);

if (on("base")) {
  log("— 1: the role «تسويق»");
  const have = rs.find((r) => r.x_code === MARKETING_ROLE.x_code);
  if (have?.x_active) log(`= ${ROLE_MODEL} #${have.id} «${have.x_name}» (${have.x_code})`);
  else if (have) { log(`✎ ${ROLE_MODEL} #${have.id} «${have.x_name}»: x_active false → true`); if (APPLY) { b.roleActive ??= { id: have.id, x_active: false }; save(); await call(ROLE_MODEL, "write", { ids: [have.id], vals: { x_active: true } }); } }
  else {
    log(`+ ${ROLE_MODEL}: «${MARKETING_ROLE.x_name}» (${MARKETING_ROLE.x_code})`);
    if (APPLY) { [c.role] = await call(ROLE_MODEL, "create", { vals_list: [MARKETING_ROLE] }); save(); log(`  → #${c.role}`); }
  }
  await pause();

  log(`— 2: the schedule «${WORKDAYS_CALENDAR_NAME}» (a copy of #${OMAR_CALENDAR})`);
  const omars = await linesOf(OMAR_CALENDAR);
  if (new Set(omars.map((l) => l.dayofweek)).size !== 7 || omars.some((l) => l.duration_based || !(l.hour_to > l.hour_from) || l.date)) throw new Error(`Omar's schedule #${OMAR_CALENDAR} is not 7 days with clock hours: ${JSON.stringify(omars.map(lineKey))} — stop`);
  const cals = await calendarByName(WORKDAYS_CALENDAR_NAME);
  if (cals.length > 1) throw new Error(`${cals.length} schedules named «${WORKDAYS_CALENDAR_NAME}» — stop`);
  let calId = cals[0]?.id ?? c.calendar ?? null;
  if (cals[0]) {
    const mine = await linesOf(cals[0].id);
    if (JSON.stringify(mine.map(lineKey)) !== JSON.stringify(omars.map(lineKey))) throw new Error(`«${WORKDAYS_CALENDAR_NAME}» #${cals[0].id} exists with other lines: ${JSON.stringify(mine.map(lineKey))} — stop`);
    if (!cals[0].active) { log(`✎ ${CALENDAR_MODEL} #${cals[0].id}: archived → active`); if (APPLY) await call(CALENDAR_MODEL, "write", { ids: [cals[0].id], vals: { active: true } }); }
    else log(`= ${CALENDAR_MODEL} #${cals[0].id} «${WORKDAYS_CALENDAR_NAME}»: ${mine.map(lineKey).join(" ")}`);
  } else {
    log(`+ ${CALENDAR_MODEL}: «${WORKDAYS_CALENDAR_NAME}» — ${omars.map(lineKey).join(" ")}`);
    if (APPLY) {
      const lines = omars.map((l, i) => [0, 0, { dayofweek: l.dayofweek, hour_from: l.hour_from, hour_to: l.hour_to, sequence: 10 + i }]);
      [calId] = await call(CALENDAR_MODEL, "create", { vals_list: [{ name: WORKDAYS_CALENDAR_NAME, calendar_type: "fixed", company_id: COMPANY, attendance_ids: lines }] }, { probe: [["name", "=", WORKDAYS_CALENDAR_NAME]] });
      c.calendar = calId; save(); log(`  → #${calId}`);
      // Odoo must not have added its default lines next to ours
      const got = await linesOf(calId);
      if (JSON.stringify(got.map(lineKey)) !== JSON.stringify(omars.map(lineKey))) throw new Error(`«${WORKDAYS_CALENDAR_NAME}» lines are not as planned: ${JSON.stringify(got.map(lineKey))} — stop (the rollback archives it)`);
    }
  }
  await pause();

  log(`— 3: ${CONFIG_MODEL}.${WORKDAYS_FIELD.name}, the active settings, and «⚙️ الإعدادات»`);
  await ensureFields(ctx, CONFIG_MODEL, await modelId(CONFIG_MODEL), [WORKDAYS_FIELD]);
  await pause();
  const hasField = !!(await fieldId(CONFIG_MODEL, WORKDAYS_FIELD.name));
  const cfg = await activeConfig(hasField ? ["id", "x_name", WORKDAYS_FIELD.name] : ["id", "x_name"]);
  if (!cfg) throw new Error("no active pricing settings — stop");
  const cur = hasField ? m2oId(cfg[WORKDAYS_FIELD.name]) : 0;
  if (calId && cur === calId) log(`= settings #${cfg.id}: ${WORKDAYS_FIELD.name} = #${calId}`);
  else {
    log(`✎ settings #${cfg.id} «${cfg.x_name}»: ${WORKDAYS_FIELD.name} ${cur ? `#${cur}` : "empty"} → ${calId ? `#${calId}` : "(the new schedule)"}`);
    if (APPLY) { b.config ??= { id: cfg.id, calendar: cur || false }; save(); await call(CONFIG_MODEL, "write", { ids: [cfg.id], vals: { [WORKDAYS_FIELD.name]: calId } }); }
  }
  const ext = await viewByName(SETTINGS_EXT_NAME);
  const arch = settingsExtArch();
  if (ext && ext.active && ext.arch_db === arch) log(`= view #${ext.id} ${SETTINGS_EXT_NAME}`);
  else if (ext) { log(`✎ view #${ext.id} ${SETTINGS_EXT_NAME}: ${ext.active ? "arch" : "off → on"}`); if (APPLY) { rb.created.views ??= {}; b.settingsExt ??= { id: ext.id, active: ext.active, arch_db: ext.arch_db }; save(); await call("ir.ui.view", "write", { ids: [ext.id], vals: { active: true, arch_db: arch } }); } }
  else {
    log(`+ view ${SETTINGS_EXT_NAME} (an extension of #${SETTINGS_VIEW}: the field before the cost lines, and the sentence under them)`);
    if (APPLY) {
      rb.created.views ??= {};
      [c.views.settingsExt] = await call("ir.ui.view", "create", { vals_list: [{ name: SETTINGS_EXT_NAME, model: CONFIG_MODEL, type: "form", mode: "extension", inherit_id: SETTINGS_VIEW, priority: 99, arch_db: arch }] });
      save(); log(`  → #${c.views.settingsExt}`);
    }
  }
  await pause();
}

if (on("roles")) {
  log("— 4: Baraa's employee, with the three operating roles");
  const cals = await calendarByName(WORKDAYS_CALENDAR_NAME);
  const calId = cals[0]?.id ?? null;
  if (APPLY && !calId) throw new Error(`«${WORKDAYS_CALENDAR_NAME}» is not there — run the base part first`);
  const [partner] = await call("res.partner", "read", { ids: [OWNER_PARTNER], fields: ["id", "name", "active", "x_whatsapp_number", "phone", "supplier_rank", "x_price_source"] });
  if (!partner?.active || digits(partner.x_whatsapp_number || partner.phone) !== ownerDigits) throw new Error(`partner #${OWNER_PARTNER} is not Baraa's number (OWNER_WHATSAPP of prod) — stop`);
  if (partner.supplier_rank > 0 || partner.x_price_source) throw new Error(`partner #${OWNER_PARTNER} is a supplier or a price source — stop`);
  const wantRoles = OPERATING_CODES.map((k) => byCode.get(k));
  const owners = await ownerEmployee();
  if (owners.length > 1) throw new Error(`${owners.length} employees on partner #${OWNER_PARTNER} — stop`);
  if (owners[0]) {
    const e = owners[0];
    const same = e.active && sameSet(e.x_utak_role_ids, wantRoles) && e.x_utak_attendance === true && m2oId(e.resource_calendar_id) === calId;
    if (same) log(`= hr.employee #${e.id} «${e.name}»: roles [${e.x_utak_role_ids.join(", ")}], on attendance, schedule #${calId}`);
    else {
      log(`✎ hr.employee #${e.id} «${e.name}»: roles [${e.x_utak_role_ids.join(", ")}] → [${wantRoles.join(", ")}], «مشمول بالتحضير» ${e.x_utak_attendance} → true, schedule ${m2oId(e.resource_calendar_id) || "none"} → #${calId}, active ${e.active} → true`);
      if (APPLY) {
        if (!c.ownerEmployee) b.ownerEmployee ??= { id: e.id, x_utak_role_ids: e.x_utak_role_ids, x_utak_attendance: e.x_utak_attendance, resource_calendar_id: m2oId(e.resource_calendar_id) || false, active: e.active };
        save();
        await call(EMPLOYEE_MODEL, "write", { ids: [e.id], vals: { active: true, x_utak_role_ids: [[6, 0, wantRoles]], x_utak_attendance: true, resource_calendar_id: calId } });
      }
    }
  } else {
    log(`+ hr.employee «${OWNER_EMPLOYEE_NAME}»: Work Contact #${OWNER_PARTNER} «${partner.name}», roles ${OPERATING_CODES.join(" + ")} [${wantRoles.join(", ")}], «مشمول بالتحضير», schedule ${calId ? `#${calId}` : "(the new one)"}`);
    if (APPLY) {
      const vals = { name: OWNER_EMPLOYEE_NAME, work_contact_id: OWNER_PARTNER, company_id: COMPANY, tz: "Asia/Riyadh", resource_calendar_id: calId, x_utak_attendance: true, x_utak_role_ids: [[6, 0, wantRoles]] };
      [c.ownerEmployee] = await call(EMPLOYEE_MODEL, "create", { vals_list: [vals] }, { probe: [["work_contact_id", "=", OWNER_PARTNER]] });
      save(); log(`  → #${c.ownerEmployee}`);
      const e = await employee(c.ownerEmployee);
      // the Work Contact must still be his own partner, with his number, and the schedule the one asked for
      if (m2oId(e.work_contact_id) !== OWNER_PARTNER || digits(e.x_utak_whatsapp) !== ownerDigits || m2oId(e.resource_calendar_id) !== calId) throw new Error(`the new employee is not as planned: ${JSON.stringify({ contact: e.work_contact_id, calendar: e.resource_calendar_id })} — stop (the rollback archives it)`);
      const [after] = await call("res.partner", "read", { ids: [OWNER_PARTNER], fields: ["name", "x_whatsapp_number", "phone"] });
      if (after.name !== partner.name || after.x_whatsapp_number !== partner.x_whatsapp_number || after.phone !== partner.phone) throw new Error(`partner #${OWNER_PARTNER} changed with the employee: ${JSON.stringify([after.name === partner.name, after.x_whatsapp_number === partner.x_whatsapp_number, after.phone === partner.phone])} — stop`);
    }
  }
  await pause();

  log(`— 5: عمر #${OMAR_EMPLOYEE}: marketing alone`);
  const omar = await employee(OMAR_EMPLOYEE);
  if (!omar) throw new Error(`hr.employee #${OMAR_EMPLOYEE} not found — stop`);
  const mkId = byCode.get(MARKETING_ROLE.x_code) ?? c.role ?? null;
  if (APPLY && !mkId) throw new Error("«تسويق» is not there — run the base part first");
  const done5 = mkId && sameSet(omar.x_utak_role_ids, [mkId]) && omar.x_price_source === false && omar.x_utak_attendance === false;
  if (done5) log(`= عمر: roles [${omar.x_utak_role_ids.join(", ")}], «مصدر أسعار» off, off attendance`);
  else {
    log(`✎ عمر #${OMAR_EMPLOYEE}: roles [${omar.x_utak_role_ids.join(", ")}] → [${mkId ?? "تسويق"}], «مصدر أسعار» ${omar.x_price_source} → false («دور الأسعار» ${omar.x_price_role} stays), «مشمول بالتحضير» ${omar.x_utak_attendance} → false (schedule #${m2oId(omar.resource_calendar_id)} stays)`);
    if (APPLY) {
      b.omar ??= { x_utak_role_ids: omar.x_utak_role_ids, x_price_source: omar.x_price_source, x_price_role: omar.x_price_role, x_utak_attendance: omar.x_utak_attendance, resource_calendar_id: m2oId(omar.resource_calendar_id) || false };
      save();
      await call(EMPLOYEE_MODEL, "write", { ids: [OMAR_EMPLOYEE], vals: { x_utak_role_ids: [[6, 0, [mkId]]], x_price_source: false, x_utak_attendance: false } });
    }
  }
  await pause();
}

if (on("templates")) {
  log("— 6: the purposes and the rows of the two templates");
  const purposeField = await fieldId(TPL_MODEL, "x_purpose");
  let pu = await selection(purposeField);
  c.purposes ??= {}; c.rows ??= {}; b.rowPurposes ??= {};
  for (const t of S59_TEMPLATES) {
    const meta = atMeta(t.name);
    if (!meta?.id) { log(`✗ no Meta status of ${t.name} — run scripts/s59-20261006-templates.mjs --status first`); process.exit(1); }
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
          ...(t.buttons.length ? { x_buttons_text: t.buttons.map((x) => x.text).join("\n") } : {}),
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
log(APPLY ? "done — verify: node scripts/s59-20261006-odoo.mjs --verify" : "dry-run: nothing written");
