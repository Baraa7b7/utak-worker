// Mutation check for STATUS § 31 (the team in hr.employee): each mutation
// disables ONE mechanism, runs a test file, and must make it fail. The source
// is restored in `finally` after every run; a pattern that is not found
// exactly once stops the script.
//
//   node scripts/team-20260925-mutations.mjs
//
// Out: scripts/artifacts/team-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/team-hr.test.mts", A = "tests/attendance.test.mts", R = "tests/review.test.mts";
// [name, file, find, replace, test file]
const M = [
  // the working schedule
  ["weekly day off ignored (a day without a line = work)", "src/team-roster.ts",
    `  if (on.length === 0) return { kind: "day_off", day };`, `  if (on.length === 0) return { kind: "work", day, startMin: 7 * 60, endMin: 15 * 60 };`, T],
  ["time off ignored", "src/team-roster.ts", `  if (lv) return { kind: "leave", day, startMin, endMin, leave: lv.name || "إجازة" };`, ``, T],
  ["company time off ignored", "src/team-roster.ts",
    `    return (v.companyId === null || v.companyId === m.companyId) && (v.calendarId === null || v.calendarId === m.calendarId);`, `    return false;`, T],
  ["company time off of another schedule applies", "src/team-roster.ts",
    `    return (v.companyId === null || v.companyId === m.companyId) && (v.calendarId === null || v.calendarId === m.calendarId);`,
    `    return (v.companyId === null || v.companyId === m.companyId);`, T],
  ["time off «counted as working time» applies", "src/team-roster.ts", `        ["count_as", "!=", "working_time"],\n`, ``, T],
  ["«مشمول بالتحضير» ignored", "src/team-roster.ts", `  if (!m.attendance) return { kind: "not_enrolled", day };\n`, ``, T],
  ["no working schedule = a shift every day", "src/team-roster.ts",
    `  if (!m.calendarId) return { kind: "no_calendar", day };`, `  if (!m.calendarId) return { kind: "work", day, startMin: 5 * 60, endMin: 13 * 60 };`, T],
  ["hours-only lines (Odoo's default 40 h) count as clock times", "src/team-roster.ts",
    `  const timed = on.filter((l) => !l.durationBased && l.hourTo > l.hourFrom);`, `  const timed = on;`, T],
  ["the first line's start, not the first period's", "src/team-roster.ts",
    `  const startMin = Math.round(Math.min(...timed.map((l) => l.hourFrom)) * 60);`, `  const startMin = Math.round(timed[0].hourFrom * 60);`, T],
  ["the end of the first period, not the last", "src/team-roster.ts",
    `  const endMin = Math.round(Math.max(...timed.map((l) => l.hourTo)) * 60);`, `  const endMin = Math.round(Math.min(...timed.map((l) => l.hourTo)) * 60);`, T],
  ["variable schedule: recurrence ignored", "src/team-roster.ts",
    `      return a.recurrencyType === "days" ? d % a.interval === 0 : d % 7 === 0 && Math.floor(d / 7) % a.interval === 0;`, `      return true;`, T],
  ["fixed / variable lines mixed", "src/team-roster.ts", `    if (a.type === "fixed" ? !!a.date : !a.date) return false;\n`, ``, T],
  // the roster
  ["an employee without a UTAK role on the roster", "src/team-roster.ts", `    if (codes.length === 0) continue;\n`, ``, T],
  ["team not found by its Work Contact number", "src/team-roster.ts",
    `  return roster.members.find((m) => m.whatsapp && m.partnerId && digits(m.whatsapp) === d) ?? null;`, `  return null;`, T],
  ["driver neighborhoods not from the employee", "src/team-roster.ts",
    `      neighborhoods: Array.isArray(r.x_utak_neighborhood_ids) ? (r.x_utak_neighborhood_ids as number[]) : [],`, `      neighborhoods: [],`, T],
  ["no roster cache (a read per lookup)", "src/team-roster.ts",
    `      if (r && Array.isArray(r.members) && nowMs - r.loadedAt >= 0 && nowMs - r.loadedAt < ROSTER_TTL * 1000) return r;`, `      if (false) return r;`, T],
  ["roster cache longer than 5 minutes", "src/team-roster.ts", `export const ROSTER_TTL = 300; `, `export const ROSTER_TTL = 3600; `, T],
  ["the Odoo hook does not drop the cache", "src/index.ts", `      await invalidateRoster(env);\n      console.log("[team-roster hook]"`, `      console.log("[team-roster hook]"`, T],
  ["attendance row without the employee link", "src/attendance.ts",
    "x_name: `${m.name} · ${day}`, x_employee_id: m.employeeId, x_partner_id", "x_name: `${m.name} · ${day}`, x_partner_id", A],
  // after the shift
  ["after the shift: not held", "src/attendance.ts",
    `    if (nowMs >= riyadhDayMinuteMs(day, plan.endMin as number)) return { hold: true, onAttendance: true, shift, phase: "after", sent: true, ...who, ...later() };\n`, ``, T],
  ["day off / time off: not held", "src/attendance.ts",
    `    if (plan.kind === "day_off" || plan.kind === "leave") return { hold: true, onAttendance: true, phase: "off", ...who, ...later() };\n`, ``, T],
  ["no «مهمة لـ… بعد دوامه» alert", "src/attendance.ts", `  if (h.hold && (h.phase === "after" || h.phase === "off") && h.employeeId) {`, `  if (false) {`, T],
  ["the «بعد دوامه» alert repeats for the same kind (no daily claim)", "src/attendance.ts",
    `      if (claim.claimed) {\n        // the claim above`, `      if (true) {\n        // the claim above`, T],
  ["queue expires before the next shift (36 h)", "src/team.ts",
    `    await enqueueTeamItems(env, driver.x_whatsapp_number, q, att.queueTtl);`, `    await enqueueTeamItems(env, driver.x_whatsapp_number, q);`, T],
  ["18:00 summary sent after the shift", "src/invoice.ts",
    `      if ((await holdForTask(env, c.id, { kind: "collection_summary"`, `      if (false && (await holdForTask(env, c.id, { kind: "collection_summary"`, T],
  ["payment-claim note sent to a collector after the shift", "src/pay-claim.ts",
    `      if (att.hold) {\n        await enqueueTeamItems(env, c.x_whatsapp_number, [{ text: note }], att.queueTtl);`,
    `      if (false) {\n        await enqueueTeamItems(env, c.x_whatsapp_number, [{ text: note }], att.queueTtl);`, T],
  ["21:15 purchase list sent after the shift", "src/team.ts",
    `    if ((await holdForTask(env, wh.id, { kind: "purchase_list", label:`, `    if (false && (await holdForTask(env, wh.id, { kind: "purchase_list", label:`, T],
  ["a tap after the end of the shift releases the tasks", "src/index.ts",
    `            if (!tap.afterEnd) await deliverTasksOnTap(env, teamMember, msg.from);`, `            await deliverTasksOnTap(env, teamMember, msg.from);`, T],
  ["a tap on a day off releases the tasks", "src/index.ts",
    `          } else if (tap.kind === "not_started" || tap.kind === "off_today") {`, `          } else if (tap.kind === "not_started") {`, T],
  // Baraa's window — 2026-09-26 (STATUS § 39 ج): three mutations removed («an employee on time off counts»,
  // «no 15-minute lead», «Baraa's own schedule counts»). Their guards belonged to the § 31 rule (the earliest
  // shift − 15 min), deleted on purpose in 1acc78b (STATUS § 32: a fixed OWNER_WINDOW_OPEN_AT, whoever works);
  // scripts/shift-20260925-mutations.mjs mutates that rule. «Baraa's own employee record on the roster» stays.
  ["window: Baraa's own employee record on the roster", "src/attendance.ts",
    `  const team = (roster?.members ?? []).filter((m) => !isOwnerNumber(env, m.whatsapp));`, `  const team = roster?.members ?? [];`, A],
  // «Customer» roles
  ["ensureCustomerRoleId blind to archived rows (duplicates)", "src/odoo.ts",
    `      limit: 1,\n      context: { active_test: false },\n    });\n    if (found[0]) return found[0].id;`, `      limit: 1,\n    });\n    if (found[0]) return found[0].id;`, T],
  ["a new WhatsApp partner gets the «Customer» role again", "src/odoo.ts",
    `    x_contact_class: "unreviewed",\n  };\n  const ids = await call<number[]>(env, "res.partner", "create", {`,
    `    x_contact_class: "unreviewed",\n    x_role_ids: [[4, 5, 0]],\n  };\n  const ids = await call<number[]>(env, "res.partner", "create", {`, T],
  // archived / personal
  ["archived: only the reviewed ones (the old rule)", "src/odoo.ts",
    `      ["active", "=", false],\n      "|",`, `      ["active", "=", false],\n      ["x_contact_class", "!=", false],\n      "|",`, T],
  ["archived: no «رقم مؤرشف يطلب» alert", "src/screening.ts", `  if (r.intent !== "purchase") {`, `  if (true) {`, T],
  ["archived: the alert every message (no daily claim)", "src/screening.ts",
    `  if (!claim.claimed) return { intent: r.intent, alerted: false };\n  const { sendOwnerAlert }`, `  const { sendOwnerAlert }`, T],
  ["archived: ingest routes it as new", "src/wa-inbox.ts",
    `      route = created.archived ? "archived" : created.quiet ? "quiet" : "new";`, `      route = created.quiet ? "quiet" : "new";`, R],
  ["personal: the customer route (alert «رقم جديد راسل»)", "src/wa-inbox.ts",
    `route = lCustomer.x_contact_class === "personal" ? "quiet" : "customer";`, `route = "customer";`, T],
  ["personal without a customer rank: a duplicate partner", "src/odoo.ts", `  if (personal) return { ...personal, quiet: true };\n`, ``, T],
];

const results = [];
for (const [name, file, find, repl, test] of M) {
  const path = root + file;
  const orig = readFileSync(path, "utf8");
  const n = orig.split(find).length - 1;
  if (n !== 1) throw new Error(`«${name}»: pattern found ${n}× in ${file} — fix the mutation list`);
  let out = "", code = 0;
  try {
    writeFileSync(path, orig.replace(find, repl));
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status ?? 1; out = String(e.stdout ?? "");
    }
  } finally {
    writeFileSync(path, orig);
  }
  const summary = /(?:team-hr|review|attendance): (\d+) passed, (\d+) failed/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 120));
  const caught = code !== 0;
  results.push({ mutation: name, file, test, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/team-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
