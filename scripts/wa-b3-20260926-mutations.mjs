// Mutation check for the important gaps, batch 3 (STATUS § 38, 2026-09-26):
// each mutation disables ONE guard of م12 / م8 / م17, runs
// tests/wa-important-b3.test.mts, and must make it fail. The source is
// restored in `finally` after every run; a pattern that is not found exactly
// once stops the script.
//
//   node scripts/wa-b3-20260926-mutations.mjs
//
// Out: scripts/artifacts/wa-b3-20260926-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/wa-important-b3.test.mts";
const DF = "src/driver-followup.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- م12: the driver's end of shift
  ["م12: the reminder without its KV claim (sent on every tick)", [[DF,
    "claimKey(day, m, \"remind\"), CLAIM_TTL", "claimKey(day, m, \"remind\") + Math.random(), CLAIM_TTL"]], T],
  ["م12: Baraa's end-of-shift alert without its claim", [[DF,
    "claimKey(day, m, \"alert\"), CLAIM_TTL", "claimKey(day, m, \"alert\") + Math.random(), CLAIM_TTL"]], T],
  ["م12: the reason alert without its claim", [[DF,
    "claimKey(day, m, \"reason\"), CLAIM_TTL", "claimKey(day, m, \"reason\") + Math.random(), CLAIM_TTL"]], T],
  ["م12: delivered stops counted", [[DF,
    "[\"x_route_id\", \"in\", routes.map((r) => r.id)], [\"x_status\", \"!=\", \"delivered\"]]", "[\"x_route_id\", \"in\", routes.map((r) => r.id)]]"]], T],
  ["م12: cancelled / delivered orders counted", [[DF,
    "o.x_state === \"in_delivery\" && o[SIM_FIELD] !== true", "o[SIM_FIELD] !== true"]], T],
  ["م12: simulation orders counted", [[DF,
    "o.x_state === \"in_delivery\" && o[SIM_FIELD] !== true", "o.x_state === \"in_delivery\""]], T],
  ["م12: every old route counted (no 72 h window)", [[DF,
    "[[\"x_driver_id\", \"=\", partnerId], [\"x_dispatched_at\", \">=\", toOdooUtc(sinceMs)], [\"x_status\", \"!=\", \"cancelled\"]]", "[[\"x_driver_id\", \"=\", partnerId], [\"x_status\", \"!=\", \"cancelled\"]]"]], T],
  ["م12: an absent driver still reminded", [[DF,
    "  if ((await attendanceStatus(env, m.employeeId, day)) === \"absent\") {", "  if (false) {"]], T],
  ["م12: the reminder after the end of the shift", [[DF,
    "  const inRemind = nowMs >= remindAt && nowMs < endMs;", "  const inRemind = nowMs >= remindAt && nowMs < alertAt;"]], T],
  ["م12: fixed hours instead of the schedule (12:00)", [[DF,
    "  const endMin = plan.endMin as number;", "  const endMin = 12 * 60;"]], T],
  ["م12: messages with no stop left", [[DF,
    "  if (stops.length === 0) return inRemind ? \"remind:no_stops\" : \"alert:no_stops\";\n", ""]], T],
  ["م12: the held reminder outlives the shift", [[DF,
    "{ purpose: DRIVER_REMIND_PURPOSE, expiresAt: endMs }", "{ purpose: DRIVER_REMIND_PURPOSE }"]], T],
  ["م12: «مشكلة» not marked in Baraa's alert", [[DF,
    "`#${s.orderId}${s.status === \"issue\" ? \" (مشكلة)\" : \"\"}`", "`#${s.orderId}`"]], T],
  ["م12: the names not cut after two", [[DF,
    "  return `${list[0]}، ${list[1]} و ${list.length - 2} أخرى`;", "  return list.join(\"، \");"]], T],
  ["م12: no 18:00 alert for a driver without a schedule", [[DF,
    "  if (nowMs < at || nowMs >= at + STEP_GRACE_MIN * MIN) return `${plan.kind}:-`;", "  if (true) return `${plan.kind}:-`;"]], T],
  ["م12: the cron not wired", [["src/index.ts",
    "          const r = await runDriverFollowupTick(env);\n", "          const r = { at: \"\", drivers: [] as Array<{ name: string; steps: string[] }> };\n"]], T],
];

const results = [];
for (const [name, edits, test] of M) {
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      const src = originals.get(path) ?? readFileSync(path, "utf8");
      if (!originals.has(path)) originals.set(path, src);
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
    results.push({ name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("./artifacts/wa-b3-20260926-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
