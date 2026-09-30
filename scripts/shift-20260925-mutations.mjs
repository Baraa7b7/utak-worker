// Mutation check for STATUS § 32 (Baraa's fixed morning time and the team's
// real schedules): each mutation disables ONE mechanism, runs a test file,
// and must make it fail. The source is restored in `finally` after every run;
// a pattern that is not found exactly once stops the script.
//
//   node scripts/shift-20260925-mutations.mjs
//
// Out: scripts/artifacts/shift-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const S = "tests/team-shifts.test.mts", A = "tests/attendance.test.mts", R = "tests/review.test.mts", T = "tests/team-hr.test.mts";
const TICK_PLAN = `  const plan = ownerWindowPlan(env);\n`;
// the § 31 rule, put back: the earliest shift of those who work today − 15 min
const OLD_RULE = `  const starts = plans.filter((p) => p.plan.kind === "work").map((p) => p.plan.startMin as number);
  const plan = starts.length ? { minutes: Math.max(0, Math.min(...starts) - 15), source: "earliest_shift" } : ownerWindowPlan(env);\n`;
// [name, file, find, replace, test file]
const M = [
  // Baraa's window: fixed
  ["window: the § 31 rule back (earliest shift − 15)", "src/attendance.ts", TICK_PLAN, OLD_RULE, S],
  ["window: the § 31 rule back (attendance tests)", "src/attendance.ts", TICK_PLAN, OLD_RULE, A],
  ["window: the § 31 rule back (team-hr tests)", "src/attendance.ts", TICK_PLAN, OLD_RULE, T],
  ["window: OWNER_WINDOW_OPEN_AT ignored (always 06:00)", "src/attendance.ts",
    `  const set = parseHHMM(env.OWNER_WINDOW_OPEN_AT);`, `  const set = parseHHMM("06:00");`, R],
  ["window: OWNER_WINDOW_OPEN_AT ignored in the tick", "src/attendance.ts",
    `  const set = parseHHMM(env.OWNER_WINDOW_OPEN_AT);`, `  const set = parseHHMM("06:00");`, A],
  ["window: no default when unset (00:00)", "src/attendance.ts",
    `    ? { minutes: parseHHMM(OWNER_WINDOW_DEFAULT) as number, source: "default" }`, `    ? { minutes: 0, source: "default" }`, R],
  ["window: skipped on a day nobody works", "src/attendance.ts",
    `    report.owner.action = await ownerWindowStep(env, day, nowMs, plan.minutes);`,
    `    report.owner.action = plans.some((p) => p.plan.kind === "work") ? await ownerWindowStep(env, day, nowMs, plan.minutes) : "skipped";`, S],
  // the rules the real schedules lean on
  ["Friday (no line) treated as a work day", "src/team-roster.ts",
    `  if (on.length === 0) return { kind: "day_off", day };`, `  if (on.length === 0) return { kind: "work", day, startMin: 2 * 60, endMin: 12 * 60 };`, S],
  ["after the shift: not held", "src/attendance.ts",
    `    if (nowMs >= riyadhDayMinuteMs(day, plan.endMin as number)) return { hold: true, onAttendance: true, shift, phase: "after", sent: true, ...who, ...later() };\n`, ``, S],
  ["next shift ignores the day off (Friday counted)", "src/team-roster.ts",
    `      if (p.kind === "day_off" || p.kind === "leave" || p.kind === "no_clock_time") continue;`, `      if (p.kind === "leave" || p.kind === "no_clock_time") continue;`, S],
  ["the reminder at +30 not sent", "src/attendance.ts",
    `  if (since >= REMIND_AFTER_MIN * MIN) return row.x_reminder_sent ? "reminded" : sendReminder(env, m, day, min, row);`, `  if (since >= REMIND_AFTER_MIN * MIN) return "reminded";`, S],
  ["«متأخر» after +15 → «حاضر»", "src/attendance.ts",
    `  return tapMs - shiftMs > LATE_AFTER_MIN * MIN ? "late" : "present";`, `  return "present";`, S],
  // b02e80d (§ 33): sendOwnerAlert hands the text to the gateway, whose window decision sends it inside his
  // window (and holds it outside) — the pattern turns that decision off for owner_alert alone (§ 39 ج)
  ["owner alerts never as text inside his window", "src/wa-gateway.ts",
    `    if (win.open) return dispatchToMeta(env, req, to, opt.body);`,
    `    if (win.open && req.purpose !== "owner_alert") return dispatchToMeta(env, req, to, opt.body);`, S],
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
  const summary = /(?:team-shifts|team-hr|review|attendance): (\d+) passed, (\d+) failed/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 120));
  const caught = code !== 0;
  results.push({ mutation: name, file, test, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/shift-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
