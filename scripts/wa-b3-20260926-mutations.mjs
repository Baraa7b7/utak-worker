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
const OFD = "src/out-for-delivery.ts";
const OS = "src/owner-summary.ts";

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
  // ---- م8: «في الطريق»
  ["م8: «تم التسليم» does not notify the next stop", [["src/router.ts",
    "        await notifyNextAfterDelivered(env, orderId);\n", ""]], T],
  ["م8: the route's start does not notify the first stop", [["src/team.ts",
    "    await notifyRouteStart(env, routeId, driver.name || \"\");\n", ""]], T],
  ["م8: a held route without its route_start marker", [["src/team.ts",
    "    q.push({ route_start: routeId, driver: driver.name || \"\" });\n", ""]], T],
  ["م8: the flush ignores the route_start marker", [["src/team-queue.ts",
    "        await notifyRouteStart(env, l.route_start, typeof l.driver === \"string\" ? l.driver : undefined);\n", ""]], T],
  ["م8: no KV claim per order", [[OFD,
    "claimButton(env, `ofd:${orderId}`, OFD_CLAIM_TTL)", "claimButton(env, `ofd:${orderId}:${Math.random()}`, OFD_CLAIM_TTL)"]], T],
  ["م8: no record check (x_wa_message)", [[OFD,
    "  if (await ofdOnRecord(env, orderId)) return \"already\";\n", ""]], T],
  ["م8: a cancelled / delivered order not skipped", [[OFD,
    "    if (!o || DONE_STATES.has(String(o.x_state || \"\")) || s.status === \"delivered\") {", "    if (!o || s.status === \"delivered\") {"]], T],
  ["م8: a delivered stop not skipped", [[OFD,
    "    if (!o || DONE_STATES.has(String(o.x_state || \"\")) || s.status === \"delivered\") {", "    if (!o || DONE_STATES.has(String(o.x_state || \"\"))) {"]], T],
  ["م8: a stop marked «مشكلة» does not stop the sequence", [[OFD,
    "    if (s.status === \"issue\") return { action: \"issue_waits\", orderId: s.orderId, skipped };\n", ""]], T],
  ["م8: a simulation order notified", [[OFD,
    "    if (o[SIM_FIELD] === true) {", "    if (false) {"]], T],
  ["م8: the template first even inside the window", [[OFD,
    "    content: textContent(ofdText(orderId, driverName)),\n    fallback: [{ kind: \"template\", purpose: OFD_PURPOSE, params: ofdParams(orderId, driverName) }],",
    "    content: { kind: \"template\", purpose: OFD_PURPOSE, params: ofdParams(orderId, driverName) },\n    fallback: [textContent(ofdText(orderId, driverName))],"]], T],
  ["م8: {{2}} is the bare name (not «السائق …»)", [[OFD,
    "  return n ? `السائق ${n}` : \"السائق\";", "  return n || \"السائق\";"]], T],
  // ---- م17: Baraa's summary
  ["م17: no daily claim (sent on every run)", [[OS,
    "claimButton(env, `owner_summary:${day}`, CLAIM_TTL)", "claimButton(env, `owner_summary:${day}:${Math.random()}`, CLAIM_TTL)"]], T],
  ["م17: simulation orders counted", [[OS,
    "    domain: [[\"x_order_date\", \"=\", day], [\"x_state\", \"in\", states], [SIM_FIELD, \"!=\", true]],", "    domain: [[\"x_order_date\", \"=\", day], [\"x_state\", \"in\", states]],"]], T],
  ["م17: a simulation payment counted as collected", [[OS,
    "      [\"x_method\", \"in\", [\"cash\", \"transfer\"]], [SIM_FIELD, \"!=\", true],", "      [\"x_method\", \"in\", [\"cash\", \"transfer\"]],"]], T],
  ["م17: a payment on a simulation invoice / order counted", [[OS,
    "  return new Set(invs.filter((i) => i[SIM_FIELD] === true || simOrders.has(m2oId(i.x_order_id))).map((i) => i.id));", "  return new Set(invs.filter((i) => i[SIM_FIELD] === true).map((i) => i.id));"]], T],
  ["م17: the UTC day instead of Riyadh's", [[OS,
    "  const from = riyadhDayMinuteMs(day, 0);", "  const from = Date.parse(`${day}T00:00:00Z`);"]], T],
  ["م17: a partial total when a line has no price", [[OS,
    "total: t && t.unpriced === 0 ? t.total : null", "total: t ? t.total : null"]], T],
  ["م17: unavailable lines counted in the total", [[OS,
    "    if (l.x_status === \"unavailable\") continue;\n", ""]], T],
  ["م17: one unreadable figure stops the summary", [[OS,
    "    try { return await fn(); } catch (e) {", "    try { return await fn(); } finally { void 0; } { const e = null as unknown;"]], T],
  ["م17: the template even inside his window", [[OS,
    "    content: textContent(summaryText(figures)),\n    fallback: [{ kind: \"template\", purpose: T.OWNER_SUMMARY, params: summaryParams(figures) }],",
    "    content: { kind: \"template\", purpose: T.OWNER_SUMMARY, params: summaryParams(figures) },\n    fallback: [textContent(summaryText(figures))],"]], T],
  ["م17: pending ignores the payments", [[OS,
    "Math.max(0, round2((Number(i.x_total) || 0) - (paid.get(i.id) ?? 0)))", "Math.max(0, round2(Number(i.x_total) || 0))"]], T],
  ["م17: pending takes future-dated invoices", [[OS,
    "[\"x_status\", \"in\", [\"issued\", \"overdue\"]], [\"x_invoice_date\", \"<=\", day], [SIM_FIELD, \"!=\", true]]", "[\"x_status\", \"in\", [\"issued\", \"overdue\"]], [SIM_FIELD, \"!=\", true]]"]], T],
  ["م17: «closed» not counted as delivered", [[OS,
    "const DELIVERED_STATES = new Set([\"delivered\", \"closed\"]);", "const DELIVERED_STATES = new Set([\"delivered\"]);"]], T],
  ["م17: the 21:30 cron not wired", [["src/index.ts",
    "          const r = await sendOwnerSummary(env);\n", "          const r = { day: \"\", action: \"-\", figures: undefined as undefined | { errors: string[] } };\n"]], T],
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
