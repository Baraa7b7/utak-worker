// § 45 ج (2026-09-30): Omar on seven days — Friday 02:00–12:00 in his working schedule.
//
//   node scripts/s45-20260930-omar-friday.mjs              dry run: his calendar, who else uses it, the planned line
//   node scripts/s45-20260930-omar-friday.mjs --apply      snapshot → create the Friday line → verify
//   node scripts/s45-20260930-omar-friday.mjs --rollback   removes the line this script created (from the snapshot) — only on Baraa's word
//
// His calendar «UTAK — عمر» (resource.calendar #3) is his alone (resource.resource #4 only; Othman has
// #4 «UTAK — عثمان», the company #1): the line goes on it — no copy needed. When another resource or
// employee uses it, the script stops (a copy for Omar is then the plan, not this script).
// Nothing else is touched: no cost line (x_operating_cost), no other calendar, no leave.
// Out: scripts/artifacts/s45-20260930-omar-friday-{dry,rollback}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const OMAR = 4, CAL = 3, FRIDAY = "4"; // Odoo: Monday 0 … Sunday 6
const RB = new URL("./artifacts/s45-20260930-omar-friday-rollback.json", import.meta.url);
const FIELDS = ["id", "calendar_id", "dayofweek", "hour_from", "hour_to", "day_period", "duration_based", "date", "recurrency", "sequence"];
const log = (...a) => console.log(...a);

const lines = async () => call("resource.calendar.attendance", "search_read", { domain: [["calendar_id", "=", CAL]], fields: FIELDS, order: "sequence asc, id asc" });

if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  if (!rb.createdLineId) throw new Error("no created line in the rollback file");
  if (!APPLY) { log(`would remove resource.calendar.attendance #${rb.createdLineId} (calendar #${CAL})`); process.exit(0); }
  await call("resource.calendar.attendance", "unlink", { ids: [rb.createdLineId] });
  const after = await lines();
  log(`removed #${rb.createdLineId}; calendar #${CAL} has ${after.length} lines (${after.map((l) => l.dayofweek).join(",")})`);
  process.exit(after.some((l) => l.id === rb.createdLineId) ? 1 : 0);
}

const [emp] = await call("hr.employee", "read", { ids: [OMAR], fields: ["id", "name", "resource_calendar_id", "resource_id", "x_utak_attendance", "x_utak_role_ids"] });
const [cal] = await call("resource.calendar", "read", { ids: [CAL], fields: ["id", "name", "company_id", "attendance_ids"] });
const sharers = await call("resource.resource", "search_read", { domain: [["calendar_id", "=", CAL]], fields: ["id", "name"], context: { active_test: false } });
const empSharers = await call("hr.employee", "search_read", { domain: [["resource_calendar_id", "=", CAL]], fields: ["id", "name"], context: { active_test: false } });
const [co] = await call("res.company", "read", { ids: [1], fields: ["resource_calendar_id"] });
const before = await lines();
const plan = { calendar_id: CAL, dayofweek: FRIDAY, hour_from: 2, hour_to: 12, day_period: "full_day", duration_based: false, recurrency: false, sequence: 16 };
const report = {
  at: new Date().toISOString(), employee: emp, calendar: cal, resourcesOnIt: sharers, employeesOnIt: empSharers, companyCalendar: co.resource_calendar_id,
  linesBefore: before, plan,
};
log(`Omar: hr.employee #${emp.id} ${emp.name}, calendar ${JSON.stringify(emp.resource_calendar_id)}, on attendance ${emp.x_utak_attendance}`);
log(`calendar #${CAL} «${cal.name}»: used by resources ${sharers.map((r) => `#${r.id} ${r.name}`).join(", ")}; employees ${empSharers.map((e) => `#${e.id} ${e.name}`).join(", ")}; company calendar ${JSON.stringify(co.resource_calendar_id)}`);
log(`lines now: ${before.map((l) => `${l.dayofweek} ${l.hour_from}-${l.hour_to}`).join(" · ")}`);
const shared = sharers.some((r) => r.id !== emp.resource_id[0]) || empSharers.some((e) => e.id !== OMAR) || co.resource_calendar_id?.[0] === CAL;
if (shared) { log("✗ the calendar is shared — stop (a copy for Omar is needed)"); process.exit(1); }
if (Array.isArray(emp.resource_calendar_id) ? emp.resource_calendar_id[0] !== CAL : true) { log("✗ Omar is not on calendar #3 — stop"); process.exit(1); }
const hasFriday = before.some((l) => l.dayofweek === FRIDAY);
log(hasFriday ? "= a Friday line exists already — nothing to do" : `+ planned: Friday (${FRIDAY}) 02:00–12:00 on calendar #${CAL}`);
writeFileSync(new URL("./artifacts/s45-20260930-omar-friday-dry.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
if (!APPLY || hasFriday) process.exit(0);

// snapshot → create → verify
if (existsSync(RB)) throw new Error("rollback file exists already — not applying twice");
writeFileSync(RB, JSON.stringify({ ...report, createdLineId: null, note: "--rollback removes createdLineId" }, null, 2) + "\n");
const [id] = [].concat(await call("resource.calendar.attendance", "create", { vals_list: [plan] }));
writeFileSync(RB, JSON.stringify({ ...report, createdLineId: id, note: "--rollback removes createdLineId" }, null, 2) + "\n");
const after = await lines();
const fri = after.find((l) => l.id === id);
const ok = fri && fri.dayofweek === FRIDAY && fri.hour_from === 2 && fri.hour_to === 12 && after.length === before.length + 1;
log(`${ok ? "✓" : "✗"} created #${id}: ${JSON.stringify(fri)}; lines now ${after.map((l) => l.dayofweek).join(",")}`);
const otherCal = await call("resource.calendar.attendance", "search_count", { domain: [["calendar_id", "=", 4]] });
log(`  Othman's calendar #4 lines: ${otherCal} (unchanged: 6)`);
process.exit(ok && otherCal === 6 ? 0 : 1);
