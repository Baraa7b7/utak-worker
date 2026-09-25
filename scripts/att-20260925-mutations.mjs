// Mutation check for tests/attendance.test.mts (2026-09-25, STATUS § 29).
// Each mutation disables ONE mechanism in src/, runs the test file, and must
// make it fail. The source is restored in `finally` after every run, and the
// script refuses to start if the tree already differs from what it expects.
//
//   node scripts/att-20260925-mutations.mjs
//
// Out: scripts/artifacts/att-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const M = [
  ["time: sends before the shift", "src/attendance.ts", `if (since < 0) return "before_shift";`, `if (since < -12 * 60 * MIN) return "before_shift";`],
  ["no time (0.0) treated as 00:00", "src/attendance.ts", `v <= 0 || v >= 24`, `v < 0 || v >= 24`],
  ["gate: never holds", "src/attendance.ts", `return { hold: true, onAttendance: true,`, `return { hold: false, onAttendance: true,`],
  ["reminder: Odoo flag ignored", "src/attendance.ts", `return row.x_reminder_sent ? "reminded" : sendReminder(`, `return sendReminder(`],
  ["reminder: KV claim ignored", "src/attendance.ts", `if (!claim.claimed) return "remind_claimed";`, `if (false) return "remind_claimed";`],
  ["absent at +90 instead of +60", "src/attendance.ts", `export const ABSENT_AFTER_MIN = 60;`, `export const ABSENT_AFTER_MIN = 90;`],
  ["late only after +60", "src/attendance.ts", `return tapMs - shiftMs > LATE_AFTER_MIN * MIN ? "late" : "present";`, `return tapMs - shiftMs > ABSENT_AFTER_MIN * MIN ? "late" : "present";`],
  ["Baraa on the roster", "src/attendance.ts", `.filter((m) => !isOwnerNumber(env, m.whatsapp));`, `;`],
  ["start: today's Odoo row ignored", "src/attendance.ts", `rows.get(m.id) ?? null, nowMs)`, `null, nowMs)`],
  ["start: KV claim ignored", "src/attendance.ts", `if (!claim.claimed) return "start_claimed";`, `if (false) return "start_claimed";`],
  ["tap after absent: no owner alert", "src/attendance.ts", `if (afterAbsent) {`, `if (false) {`],
  ["late inbound acted on", "src/index.ts", `if (lateH !== null) {`, `if (false && lateH !== null) {`],
  ["owner guard without owner_window", "src/meta.ts", `  "owner_window",\n]);`, `]);`],
  ["route not queued before the tap", "src/team.ts", `  if (att.hold) {\n    const q: TeamQueueItem[]`, `  if (false) {\n    const q: TeamQueueItem[]`],
  ["06:00 list follow-up not held", "src/team.ts", `for (const wh of warehouse) if ((await attendanceHold(env, wh.id)).hold) held.add(wh.id);`, ``],
  ["18:00 summary not held", "src/invoice.ts", `if ((await attendanceHold(env, c.id)).hold) {`, `if (false) {`, true],
  ["a text before the tap releases tasks", "src/index.ts", `} else if (att.hold) {`, `} else if (false) {`],
  ["queue flushed on any text before the tap", "src/index.ts", `if (!att.hold) await flushTeamQueue(env, msg.from);`, `await flushTeamQueue(env, msg.from);`],
];

const results = [];
for (const [name, file, find, repl, all] of M) {
  const path = root + file;
  const orig = readFileSync(path, "utf8");
  const n = orig.split(find).length - 1;
  if (n < 1 || (!all && n !== 1)) throw new Error(`«${name}»: pattern found ${n}× in ${file} — fix the mutation list`);
  let out = "", code = 0;
  try {
    writeFileSync(path, all ? orig.split(find).join(repl) : orig.replace(find, repl));
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", "tests/attendance.test.mts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status ?? 1; out = String(e.stdout ?? "");
    }
  } finally {
    writeFileSync(path, orig);
  }
  const summary = /attendance: (\d+) passed, (\d+) failed/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 110));
  const caught = code !== 0;
  results.push({ mutation: name, file, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/att-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
process.exit(missed.length ? 1 : 0);
