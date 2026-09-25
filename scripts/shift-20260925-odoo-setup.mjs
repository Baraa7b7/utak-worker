// The team's working schedules, attendance on, the sample employees archived,
// and automation 6 fixed — 2026-09-25, STATUS § 32.
//
// Locked decisions (Baraa, 2026-09-25):
//   1. two working schedules (resource.calendar, fixed), Saturday to Thursday,
//      one line per day with real clock times (no hours-only line); Friday has
//      no line (a weekly day off):
//        «UTAK — عمر»    02:00–12:00  → hr.employee 4 (عمر المجهلي)
//        «UTAK — عثمان»  06:00–16:00  → hr.employee 5 (عثمان عبدالوهاب)
//      Asia/Riyadh: saas~19.4 has no time zone on resource.calendar
//      (fields_get); the zone is the employee's (hr.employee.tz → hr.version)
//      and its resource's (resource.resource.tz). Both must read Asia/Riyadh.
//   2. each schedule on its employee (resource_calendar_id) and «مشمول
//      بالتحضير» (x_utak_attendance) on.
//   3. Odoo's sample employees Emma Granger (2), Michael Williams (1) and Simon
//      Jones (3): active=False, only if none has a UTAK role, a WhatsApp
//      contact (a Work Contact with a WhatsApp number, a WhatsApp channel, a
//      message in x_wa_message or a Discuss membership) or an attendance row
//      (x_team_attendance by employee or Work Contact; hr.attendance if the
//      model exists). One that fails is not touched and is reported. Nothing
//      is deleted; the Work Contacts are left as they are.
//   4. base.automation 6 (wa_control.on_sync_requested): the filter is JSON
//      `true`, which Odoo evaluates as Python on every write to x_wa_control
//      (NameError → HTTP 500: the 05:00 template sync cannot record its
//      result). It becomes `True` — the same meaning, nothing else changes.
//      Proof on the server: the same no-op write on x_wa_control (the value it
//      already has) fails before the fix and passes after it, with nothing
//      changed and the webhook not fired (x_sync_requested stays False).
//
//   node scripts/shift-20260925-odoo-setup.mjs                  # dry run (default)
//   node scripts/shift-20260925-odoo-setup.mjs --apply
//   node scripts/shift-20260925-odoo-setup.mjs --verify         # read-only checks
//   node scripts/shift-20260925-odoo-setup.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/shift-20260925-odoo-setup-rollback.json. The
// pre-state is on disk before the first write, and every created id is
// appended as soon as it exists. The rollback deletes nothing either: the two
// schedules are archived after they are unlinked from the employees.

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
const RB = new URL("./artifacts/shift-20260925-odoo-setup-rollback.json", import.meta.url).pathname;

const TZ = "Asia/Riyadh";
const COMPANY = 1;
// Odoo dayofweek: Monday "0" … Sunday "6". Saturday → Thursday; Friday ("4") has no line.
const SAT_THU = ["5", "6", "0", "1", "2", "3"];
const FRIDAY = "4";
const SCHEDULES = [
  { key: "omar", employee: 4, contact: 9, employeeName: "عمر المجهلي", name: "UTAK — عمر", from: 2, to: 12 },
  { key: "othman", employee: 5, contact: 15, employeeName: "عثمان عبدالوهاب", name: "UTAK — عثمان", from: 6, to: 16 },
];
const SAMPLES = [
  { employee: 2, name: "Emma Granger" },
  { employee: 1, name: "Michael Williams" },
  { employee: 3, name: "Simon Jones" },
];
const AUTOMATION = 6;
const AUTOMATION_NAME = "wa_control.on_sync_requested";
const OLD_DOMAIN = `[["x_sync_requested", "=", true]]`;
const NEW_DOMAIN = `[["x_sync_requested", "=", True]]`;
const AUTOMATION_KEEP = ["name", "active", "model_id", "trigger", "trigger_field_ids", "filter_pre_domain", "action_server_ids", "on_change_field_ids", "trg_date_id", "trg_selection_field_id", "trg_field_ref"];
const CONTROL_MODEL = "x_wa_control";
const CONTROL_FIELDS = ["id", "x_name", "x_sync_requested", "x_last_sync_at", "x_last_sync_result"];

const EMP_FIELDS = ["id", "name", "active", "tz", "resource_calendar_id", "resource_id", "work_contact_id", "company_id", "version_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp"];
const ctxAll = { active_test: false };
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null);
const saveRb = (rb) => writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
const hh = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const m2o = (v) => (Array.isArray(v) ? v[0] : v || false);

// ---------------------------------------------------------------- field names (fields_get)
async function assertFields(model, names) {
  const fg = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !fg[n]);
  if (missing.length) throw new Error(`${model}: missing fields ${missing.join(", ")} — stop`);
  return fg;
}
const calFg = await assertFields("resource.calendar", ["name", "active", "calendar_type", "company_id", "attendance_ids", "hours_per_day"]);
if (calFg.tz) throw new Error("resource.calendar has a tz field on this tenant — revisit decision 1 before writing");
await assertFields("resource.calendar.attendance", ["calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date", "recurrency", "sequence"]);
await assertFields("hr.employee", EMP_FIELDS.filter((f) => f !== "id"));
await assertFields("hr.version", ["resource_calendar_id", "tz"]);
await assertFields("resource.resource", ["tz", "calendar_id", "active"]);
await assertFields("res.partner", ["x_whatsapp_number", "x_wa_channel_id", "x_role_ids", "employee_ids", "active"]);
await assertFields("x_wa_message", ["x_partner_id"]);
await assertFields("discuss.channel.member", ["partner_id", "channel_id"]);
await assertFields("x_team_attendance", ["x_employee_id", "x_partner_id"]);
await assertFields("base.automation", [...AUTOMATION_KEEP, "filter_domain"]);
await assertFields(CONTROL_MODEL, CONTROL_FIELDS.filter((f) => f !== "id"));

// ---------------------------------------------------------------- reads
const readEmployees = (ids) => call("hr.employee", "read", { ids, fields: EMP_FIELDS, context: ctxAll });
const readAutomation = async () => (await call("base.automation", "read", { ids: [AUTOMATION], fields: [...AUTOMATION_KEEP, "filter_domain", "write_date"], context: ctxAll }))[0];
const readControl = () => call(CONTROL_MODEL, "search_read", { domain: [], fields: CONTROL_FIELDS, context: ctxAll, order: "id asc" });
const schedulesByName = async () => call("resource.calendar", "search_read", {
  domain: [["name", "in", SCHEDULES.map((s) => s.name)]], fields: ["id", "name", "active", "calendar_type", "company_id", "attendance_ids", "hours_per_day"], context: ctxAll,
});
const readLines = (calIds) => call("resource.calendar.attendance", "search_read", {
  domain: [["calendar_id", "in", calIds]],
  fields: ["id", "calendar_id", "dayofweek", "hour_from", "hour_to", "duration_based", "date", "recurrency", "sequence"],
  order: "calendar_id asc, sequence asc, id asc",
});

/** Why a sample employee may NOT be archived ([] = it may). */
async function sampleBlockers(emp) {
  const out = [];
  if ((emp.x_utak_role_ids ?? []).length) out.push(`UTAK roles ${emp.x_utak_role_ids.join(",")}`);
  const contact = m2o(emp.work_contact_id);
  if (contact) {
    const [p] = await call("res.partner", "read", { ids: [contact], fields: ["x_whatsapp_number", "x_wa_channel_id", "x_role_ids"], context: ctxAll });
    if (p?.x_whatsapp_number) out.push(`Work Contact ${contact} has a WhatsApp number ${p.x_whatsapp_number}`);
    if (p?.x_wa_channel_id) out.push(`Work Contact ${contact} has a WhatsApp channel ${m2o(p.x_wa_channel_id)}`);
    if ((p?.x_role_ids ?? []).length) out.push(`Work Contact ${contact} has old partner roles ${p.x_role_ids.join(",")}`);
    const msgs = await call("x_wa_message", "search_count", { domain: [["x_partner_id", "=", contact]], context: ctxAll });
    if (msgs) out.push(`${msgs} WhatsApp message(s) on Work Contact ${contact}`);
    const members = await call("discuss.channel.member", "search_count", { domain: [["partner_id", "=", contact]] });
    if (members) out.push(`Work Contact ${contact} is in ${members} Discuss channel(s)`);
  }
  const att = await call("x_team_attendance", "search_count", {
    domain: contact ? ["|", ["x_employee_id", "=", emp.id], ["x_partner_id", "=", contact]] : [["x_employee_id", "=", emp.id]], context: ctxAll,
  });
  if (att) out.push(`${att} x_team_attendance row(s)`);
  const hrAtt = await call("ir.model", "search_count", { domain: [["model", "=", "hr.attendance"]] });
  if (hrAtt) {
    const n = await call("hr.attendance", "search_count", { domain: [["employee_id", "=", emp.id]] });
    if (n) out.push(`${n} hr.attendance row(s)`);
  }
  return out;
}

async function snapshot() {
  const emps = await readEmployees([...SCHEDULES.map((s) => s.employee), ...SAMPLES.map((s) => s.employee)]);
  const versions = await call("hr.version", "read", { ids: emps.map((e) => m2o(e.version_id)).filter(Boolean), fields: ["id", "employee_id", "resource_calendar_id", "tz"], context: ctxAll });
  const resources = await call("resource.resource", "read", { ids: emps.map((e) => m2o(e.resource_id)).filter(Boolean), fields: ["id", "name", "tz", "calendar_id", "active"], context: ctxAll });
  return {
    at: new Date().toISOString(),
    employees: emps, versions, resources,
    schedulesWithOurNames: await schedulesByName(),
    automation6: await readAutomation(),
    control: await readControl(),
  };
}

// ================================================================ rollback
if (ROLLBACK) {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file: ${RB}`);
  const c = rb.created ?? {};
  const b = rb.before;
  const act = async (label, fn) => { console.log(`${APPLY ? "" : "would "}${label}`); if (APPLY) await fn(); };
  // automation 6: its filter back to the JSON form (the 500 comes back with it)
  if (c.automation6) await act(`base.automation ${AUTOMATION}: filter_domain ← ${b.automation6.filter_domain}`,
    () => call("base.automation", "write", { ids: [AUTOMATION], vals: { filter_domain: b.automation6.filter_domain } }));
  // the sample employees: active again
  for (const id of c.archived ?? []) {
    const before = b.employees.find((e) => e.id === id);
    await act(`hr.employee ${id} (${before?.name}): active ← ${before?.active}`, () => call("hr.employee", "write", { ids: [id], vals: { active: before?.active ?? true } }));
  }
  // Omar and Othman: schedule and «مشمول بالتحضير» as before
  for (const s of SCHEDULES) {
    if (!c.linked?.[s.employee]) continue;
    const before = b.employees.find((e) => e.id === s.employee);
    await act(`hr.employee ${s.employee} (${s.employeeName}): resource_calendar_id ← ${m2o(before.resource_calendar_id)}, x_utak_attendance ← ${before.x_utak_attendance}`,
      () => call("hr.employee", "write", { ids: [s.employee], vals: { resource_calendar_id: m2o(before.resource_calendar_id), x_utak_attendance: before.x_utak_attendance } }));
  }
  // the two schedules: archived, not deleted
  for (const [key, id] of Object.entries(c.calendars ?? {})) {
    await act(`resource.calendar ${id} (${key}): active ← False (archived, not deleted)`, () => call("resource.calendar", "write", { ids: [id], vals: { active: false } }));
  }
  console.log(APPLY ? "rollback done" : "dry run: nothing changed (add --apply)");
  process.exit(0);
}

// ================================================================ verify (read-only)
async function verify() {
  const rb = readRb();
  const c = rb?.created ?? {};
  const checks = [];
  const push = (name, cond, detail = "") => checks.push([detail ? `${name} — ${detail}` : name, !!cond]);
  const cals = await schedulesByName();
  const lines = await readLines(cals.map((x) => x.id));
  const emps = await readEmployees([...SCHEDULES.map((s) => s.employee), ...SAMPLES.map((s) => s.employee)]);
  const versions = await call("hr.version", "read", { ids: emps.map((e) => m2o(e.version_id)).filter(Boolean), fields: ["id", "resource_calendar_id", "tz"], context: ctxAll });
  const resources = await call("resource.resource", "read", { ids: emps.map((e) => m2o(e.resource_id)).filter(Boolean), fields: ["id", "tz", "calendar_id", "active"], context: ctxAll });
  for (const s of SCHEDULES) {
    const mine = cals.filter((x) => x.name === s.name);
    push(`«${s.name}»: exactly one schedule, the one this script created`, mine.length === 1 && mine[0].id === c.calendars?.[s.key], mine.map((x) => x.id).join(","));
    const cal = mine[0];
    if (!cal) continue;
    push(`«${s.name}»: active, fixed, company ${COMPANY}`, cal.active === true && cal.calendar_type === "fixed" && m2o(cal.company_id) === COMPANY, `${cal.active}/${cal.calendar_type}/${m2o(cal.company_id)}`);
    const l = lines.filter((x) => m2o(x.calendar_id) === cal.id);
    push(`«${s.name}»: six lines, Saturday → Thursday`, l.length === 6 && JSON.stringify(l.map((x) => x.dayofweek).sort()) === JSON.stringify([...SAT_THU].sort()), l.map((x) => x.dayofweek).join(","));
    push(`«${s.name}»: no Friday line`, !l.some((x) => x.dayofweek === FRIDAY));
    push(`«${s.name}»: every line ${hh(s.from)}–${hh(s.to)} with clock times (not duration-based, no date, no recurrence)`,
      l.every((x) => x.hour_from === s.from && x.hour_to === s.to && x.duration_based === false && !x.date && !x.recurrency),
      l.map((x) => `${x.dayofweek}:${hh(x.hour_from)}-${hh(x.hour_to)}${x.duration_based ? "(duration)" : ""}`).join(" "));
    const e = emps.find((x) => x.id === s.employee);
    push(`${s.employeeName} (${s.employee}): Working Hours = «${s.name}»`, m2o(e?.resource_calendar_id) === cal.id, JSON.stringify(e?.resource_calendar_id));
    const v = versions.find((x) => x.id === m2o(e?.version_id));
    push(`${s.employeeName}: its current hr.version holds the schedule`, m2o(v?.resource_calendar_id) === cal.id, JSON.stringify(v?.resource_calendar_id));
    push(`${s.employeeName}: «مشمول بالتحضير» on`, e?.x_utak_attendance === true);
    const r = resources.find((x) => x.id === m2o(e?.resource_id));
    push(`${s.employeeName}: time zone ${TZ} (employee, version, resource)`, e?.tz === TZ && v?.tz === TZ && r?.tz === TZ, `${e?.tz}/${v?.tz}/${r?.tz}`);
    push(`${s.employeeName}: still active, roles unchanged, Work Contact ${s.contact}`,
      e?.active === true && m2o(e?.work_contact_id) === s.contact
      && JSON.stringify([...(e?.x_utak_role_ids ?? [])].sort()) === JSON.stringify([...(rb?.before?.employees?.find((x) => x.id === s.employee)?.x_utak_role_ids ?? [])].sort()));
  }
  for (const s of SAMPLES) {
    const e = emps.find((x) => x.id === s.employee);
    const planned = (c.archived ?? []).includes(s.employee);
    if (planned) {
      push(`${s.name} (${s.employee}): archived (active=False), not deleted`, e && e.active === false);
      const r = resources.find((x) => x.id === m2o(e?.resource_id));
      push(`${s.name}: its resource archived with it`, r && r.active === false);
    } else {
      push(`${s.name} (${s.employee}): not touched (${(rb?.skipped?.[s.employee] ?? []).join("; ") || "not archived"})`, e && e.active === rb?.before?.employees?.find((x) => x.id === s.employee)?.active);
    }
  }
  // automation 6
  const a = await readAutomation();
  push(`automation ${AUTOMATION}: filter_domain = ${NEW_DOMAIN}`, a.filter_domain === NEW_DOMAIN, a.filter_domain);
  const before = rb?.before?.automation6 ?? {};
  for (const f of AUTOMATION_KEEP) push(`automation ${AUTOMATION}: ${f} unchanged`, JSON.stringify(a[f]) === JSON.stringify(before[f]), `${JSON.stringify(before[f])} → ${JSON.stringify(a[f])}`);
  const ctl = await readControl();
  push("x_wa_control: one record, x_sync_requested still False", ctl.length === 1 && ctl[0].x_sync_requested === false, JSON.stringify(ctl));
  const b0 = rb?.before?.control?.[0] ?? {};
  push("x_wa_control: last sync fields unchanged by the proof write", ctl[0]?.x_last_sync_at === b0.x_last_sync_at && ctl[0]?.x_last_sync_result === b0.x_last_sync_result,
    `${JSON.stringify(b0.x_last_sync_at)} → ${JSON.stringify(ctl[0]?.x_last_sync_at)}`);
  if (rb?.proof) {
    push("proof: the no-op write on x_wa_control failed BEFORE the fix (NameError)", rb.proof.before?.ok === false && /NameError|true/.test(rb.proof.before?.error ?? ""), rb.proof.before?.error?.slice(0, 120));
    push("proof: the same write passed AFTER the fix", rb.proof.after?.ok === true, rb.proof.after?.error ?? "");
  }
  // the roster the worker will read (team-roster.ts): only Omar and Othman, both on attendance with a schedule
  const roster = await call("hr.employee", "search_read", { domain: [["x_utak_role_ids", "!=", false]], fields: ["id", "x_utak_attendance", "resource_calendar_id"], order: "id asc" });
  push("the worker's roster: employees 4 and 5, both on attendance with a schedule",
    JSON.stringify(roster.map((r) => [r.id, r.x_utak_attendance, !!r.resource_calendar_id])) === JSON.stringify([[4, true, true], [5, true, true]]), JSON.stringify(roster));
  const activeAll = await call("hr.employee", "search_read", { domain: [], fields: ["id", "name"], order: "id asc" });
  const expectActive = [4, 5, ...SAMPLES.map((s) => s.employee).filter((id) => !(c.archived ?? []).includes(id))].sort((x, y) => x - y);
  push(`active employees: ${expectActive.join(", ")}`, JSON.stringify(activeAll.map((r) => r.id)) === JSON.stringify(expectActive), activeAll.map((r) => `${r.id} ${r.name}`).join(", "));
  let ok = 0;
  for (const [name, pass] of checks) { console.log(`${pass ? "✓" : "✗"} ${name}`); if (pass) ok++; }
  console.log(`\nverify: ${ok}/${checks.length}`);
  return ok === checks.length;
}
if (VERIFY) process.exit((await verify()) ? 0 : 1);

// ================================================================ plan (dry run and apply)
const before = await snapshot();
const plan = [];
const skipped = {};

// 1+2. schedules and the employees
const existingCals = before.schedulesWithOurNames;
for (const s of SCHEDULES) {
  const e = before.employees.find((x) => x.id === s.employee);
  if (!e) throw new Error(`hr.employee ${s.employee} not found — stop`);
  if (e.name !== s.employeeName || m2o(e.work_contact_id) !== s.contact) throw new Error(`hr.employee ${s.employee} is «${e.name}» / contact ${m2o(e.work_contact_id)} — expected «${s.employeeName}» / ${s.contact}; stop`);
  if (!(e.x_utak_role_ids ?? []).length) throw new Error(`${s.employeeName} has no UTAK role — stop`);
  const v = before.versions.find((x) => x.id === m2o(e.version_id));
  const r = before.resources.find((x) => x.id === m2o(e.resource_id));
  if (e.tz !== TZ || v?.tz !== TZ || r?.tz !== TZ) throw new Error(`${s.employeeName}: time zone ${e.tz}/${v?.tz}/${r?.tz}, expected ${TZ} everywhere — stop`);
  const mine = existingCals.filter((x) => x.name === s.name);
  if (mine.length) plan.push(`«${s.name}» exists already (${mine.map((x) => x.id).join(",")}) — reuse only if the rollback file created it`);
  else plan.push(`create resource.calendar «${s.name}» (fixed, company ${COMPANY}) with ${SAT_THU.length} lines ${hh(s.from)}–${hh(s.to)}: Sat, Sun, Mon, Tue, Wed, Thu; Friday no line`);
  plan.push(`hr.employee ${s.employee} (${s.employeeName}): resource_calendar_id ${JSON.stringify(e.resource_calendar_id)} → «${s.name}», x_utak_attendance ${e.x_utak_attendance} → true (tz ${e.tz} kept)`);
}
// 3. samples
for (const s of SAMPLES) {
  const e = before.employees.find((x) => x.id === s.employee);
  if (!e) { skipped[s.employee] = ["not found"]; plan.push(`${s.name} (${s.employee}): not found — nothing to do`); continue; }
  if (e.name !== s.name) { skipped[s.employee] = [`name is «${e.name}»`]; plan.push(`${s.name} (${s.employee}): name is «${e.name}» — not touched`); continue; }
  if (e.active === false) { skipped[s.employee] = ["archived already"]; plan.push(`${s.name} (${s.employee}): archived already`); continue; }
  const why = await sampleBlockers(e);
  if (why.length) { skipped[s.employee] = why; plan.push(`${s.name} (${s.employee}): NOT archived — ${why.join("; ")}`); }
  else plan.push(`hr.employee ${s.employee} (${s.name}): active → False (no UTAK role; Work Contact ${m2o(e.work_contact_id)}: no WhatsApp number, channel, message or Discuss membership; no attendance row)`);
}
// 4. automation 6
const a6 = before.automation6;
if (a6.name !== AUTOMATION_NAME) throw new Error(`base.automation ${AUTOMATION} is «${a6.name}» — stop`);
if (a6.filter_domain === NEW_DOMAIN) plan.push(`automation ${AUTOMATION}: already ${NEW_DOMAIN}`);
else if (a6.filter_domain !== OLD_DOMAIN) throw new Error(`automation ${AUTOMATION} filter is ${a6.filter_domain}, not the expected ${OLD_DOMAIN} — stop`);
else plan.push(`base.automation ${AUTOMATION} (${AUTOMATION_NAME}): filter_domain ${OLD_DOMAIN} → ${NEW_DOMAIN} (nothing else)`);
if (before.control.length !== 1 || before.control[0].x_sync_requested !== false) throw new Error(`x_wa_control is not one record with x_sync_requested=False: ${JSON.stringify(before.control)} — stop`);
plan.push(`proof: x_wa_control ${before.control[0].id}.write({x_sync_requested: False}) (its current value) before the fix (expect HTTP 500 NameError, nothing written) and after it (expect OK)`);

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${plan.length} steps`);
for (const p of plan) console.log(`  • ${p}`);
if (!APPLY) { console.log("\ndry run: nothing written (add --apply)"); process.exit(0); }

// ================================================================ apply
const prior = readRb();
if (prior?.created && Object.keys(prior.created).length) throw new Error(`${RB} already records an apply — run --verify, or --rollback first`);
const rb = { before, plan, skipped, created: {} };
saveRb(rb);                                    // the pre-state is on disk before the first write
console.log(`\nsnapshot → ${RB}`);

// 1. the schedules
rb.created.calendars = {};
for (const s of SCHEDULES) {
  const lines = SAT_THU.map((d, i) => [0, 0, { dayofweek: d, hour_from: s.from, hour_to: s.to, sequence: 10 + i }]);
  const [id] = await call("resource.calendar", "create", {
    vals_list: [{ name: s.name, calendar_type: "fixed", company_id: COMPANY, attendance_ids: lines }],
  }, { probe: [["name", "=", s.name]] });
  rb.created.calendars[s.key] = id; saveRb(rb);
  console.log(`created resource.calendar ${id} «${s.name}»`);
  // Odoo must not have added its default lines next to ours
  const got = await readLines([id]);
  const bad = got.filter((l) => !(SAT_THU.includes(l.dayofweek) && l.hour_from === s.from && l.hour_to === s.to && l.duration_based === false));
  if (got.length !== SAT_THU.length || bad.length) throw new Error(`«${s.name}» lines are not as planned: ${JSON.stringify(got)} — stop (rollback archives it)`);
}
// 2. link + attendance on
rb.created.linked = {};
for (const s of SCHEDULES) {
  await call("hr.employee", "write", { ids: [s.employee], vals: { resource_calendar_id: rb.created.calendars[s.key], x_utak_attendance: true } });
  rb.created.linked[s.employee] = true; saveRb(rb);
  console.log(`hr.employee ${s.employee} (${s.employeeName}) ← «${s.name}», مشمول بالتحضير`);
}
// 3. archive the samples that passed
rb.created.archived = [];
for (const s of SAMPLES) {
  if (skipped[s.employee]) continue;
  await call("hr.employee", "write", { ids: [s.employee], vals: { active: false } });
  rb.created.archived.push(s.employee); saveRb(rb);
  console.log(`hr.employee ${s.employee} (${s.name}) archived`);
}
// 4. automation 6, with the proof write around it
const ctlId = before.control[0].id;
const probe = async () => {
  try { await call(CONTROL_MODEL, "write", { ids: [ctlId], vals: { x_sync_requested: false } }); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 600) }; }
};
rb.proof = {};
if (before.automation6.filter_domain === OLD_DOMAIN) {
  rb.proof.before = await probe(); saveRb(rb);
  console.log(`proof before the fix: ${rb.proof.before.ok ? "OK (unexpected)" : `failed as expected — ${rb.proof.before.error.slice(0, 160)}`}`);
  await call("base.automation", "write", { ids: [AUTOMATION], vals: { filter_domain: NEW_DOMAIN } });
  rb.created.automation6 = true; saveRb(rb);
  console.log(`base.automation ${AUTOMATION}: filter_domain ← ${NEW_DOMAIN}`);
}
rb.proof.after = await probe(); saveRb(rb);
console.log(`proof after the fix: ${rb.proof.after.ok ? "OK" : `FAILED — ${rb.proof.after.error}`}`);

console.log("\napplied — verifying");
process.exit((await verify()) ? 0 : 1);
