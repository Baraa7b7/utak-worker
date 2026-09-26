// Mutation check for the pricing engine v1 (STATUS § 40, 2026-09-26): each
// mutation disables ONE guard of a part, runs tests/pricing-v1.test.mts, and
// must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
//   node scripts/s40-20260926-mutations.mjs [أ|ب|ج|د|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s40-20260926-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/pricing-v1.test.mts";
const OC = "src/operating-cost.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the operating costs
  ["أ", "a monthly share on the driver's day off", [[OC,
    "    if (!workingDay) return 0;\n", ""]], T],
  ["أ", "monthly ÷ 30 calendar days, not the working days", [[OC,
    "const days = i.frequency === \"monthly\" ? monthWorkingDays : yearWorkingDays;", "const days = i.frequency === \"monthly\" ? 30 : yearWorkingDays;"]], T],
  ["أ", "yearly ÷ the month's working days", [[OC,
    "const days = i.frequency === \"monthly\" ? monthWorkingDays : yearWorkingDays;", "const days = monthWorkingDays;"]], T],
  ["أ", "«إلى» ignored", [[OC,
    "domain: [[\"x_date_from\", \"<=\", day], \"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],",
    "domain: [[\"x_date_from\", \"<=\", day], [SIM_FIELD, \"!=\", true]],"]], T],
  ["أ", "«من» ignored", [[OC,
    "domain: [[\"x_date_from\", \"<=\", day], \"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],",
    "domain: [\"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],"]], T],
  ["أ", "a simulation line counted", [[OC,
    "[\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],", "[\"x_date_to\", \">=\", day]],"]], T],
  ["أ", "no driver schedule → 0 (a guess) instead of «تعذّر»", [[OC,
    "    if (!schedule) return null;\n", "    if (!schedule) return 0;\n"]], T],
  ["أ", "the unreadable total summed partially", [[OC,
    "    total: unread ? null : round2(shares.reduce((a, s) => a + (s.perDay as number), 0)),",
    "    total: round2(shares.reduce((a, s) => a + (s.perDay ?? 0), 0)),"]], T],
  ["أ", "any member's schedule, not the driver's", [[OC,
    "roster.members.filter((m) => m.codes.includes(\"driver\") && m.calendarId)", "roster.members.filter((m) => m.calendarId)"]], T],
  ["أ", "a driver off attendance: his schedule not read", [[OC,
    "  if (!lines.length) {\n    // not on attendance", "  if (false) {\n    // not on attendance"]], T],
  ["أ", "planned stops «empty» read as 0 stops", [[OC,
    "    plannedStops: stops > 0 ? Math.floor(stops) : null,", "    plannedStops: Math.floor(stops),"]], T],
  ["أ", "the settings of an inactive record", [[OC,
    "    domain: [[\"x_is_active\", \"=\", true], [\"x_active_from\", \"<=\", day],", "    domain: [[\"x_active_from\", \"<=\", day],"]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("./artifacts/s40-20260926-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
