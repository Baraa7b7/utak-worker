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
const PS = "src/price-sources.ts";

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
  // ---------------------------------------------------------------- ب the sources
  ["ب", "the extractor's label trusted (no «سوق» / «شراء» rule)", [[PS,
    "    const kind = k === \"ambiguous\" ? c.label : k === \"other\" ? OTHER[DEFAULT_KIND[role]] : DEFAULT_KIND[role];", "    const kind = c.label;"]], T],
  ["ب", "«20 سوق 24»: the keyword taken by both numbers", [[PS,
    "      return !(next !== undefined && NUM.test(next));", "      return true;"]], T],
  ["ب", "a number not written in the message kept (م6)", [[PS,
    "    if (k === \"unwritten\") { out.dropped.push(`${c.v}: غير مكتوب في الرسالة`); continue; }", "    if (false) { continue; }"]], T],
  ["ب", "a quantity not written kept", [[PS,
    "    if (kindByText(text, q, role) === \"unwritten\") out.dropped.push(`الكمية ${q}: غير مكتوبة`);\n    else out.qty = q;", "    out.qty = q;"]], T],
  ["ب", "a product outside the catalog kept", [[PS,
    "    if (!ids.has(it.product_id)) { dropped.push({ item: it, reason: \"صنف لا يورّده\" }); continue; }", ""]], T],
  ["ب", "Omar's default kind: purchase", [[PS,
    "const DEFAULT_KIND: Record<SourceRole, PriceKind> = { supplier: \"purchase\", observer: \"market\" };", "const DEFAULT_KIND: Record<SourceRole, PriceKind> = { supplier: \"purchase\", observer: \"purchase\" };"]], T],
  ["ب", "the market ask sent to a supplier too", [[PS,
    "...src.partners.filter((p) => !p.supplier && !emp.has(p.partnerId))", "...src.partners.filter((p) => !emp.has(p.partnerId))"]], T],
  ["ب", "the ask not claimed once a day", [[PS,
    "claimButton(env, `mask_sent:${day}:p${t.partnerId}`, 26 * 60 * 60)", "claimButton(env, `mask_sent:${day}:p${t.partnerId}:${Math.random()}`, 26 * 60 * 60)"]], T],
  ["ب", "the ask before 02:30", [[PS,
    "  if (m < MARKET_ASK_MINUTE) return { action: \"before\" };\n", ""]], T],
  ["ب", "the ask after the publication time", [[PS,
    "  if (m >= untilMinute) return { action: \"after\" };\n", ""]], T],
  ["ب", "outside the window: held by the gateway, not the team queue", [[PS,
    "content: textContent(text), noHold: true, noHoldReason: \"طابور الفريق حتى «بدء الدوام»\" }", "content: textContent(text) }"]], T],
  ["ب", "before the tap: sent anyway", [[PS,
    "        if (h.hold) {\n          if (h.phase === \"before\") {", "        if (false) {\n          if (h.phase === \"before\") {"]], T],
  ["ب", "a day off: queued anyway", [[PS,
    "          if (h.phase === \"before\") {", "          if (true) {"]], T],
  ["ب", "the reply window a day, not 90 minutes", [[PS,
    "nowMs - m.at <= MARKET_REPLY_WINDOW_MIN * MIN", "nowMs - m.at <= 24 * 60 * MIN"]], T],
  ["ب", "the held ask's delivering message read as prices", [[PS,
    "  if (m.at === null) { await writeMarketAskMarker(env, digits, day, nowMs); return false; }", "  if (m.at === null) { await writeMarketAskMarker(env, digits, day, nowMs); return true; }"]], T],
  ["ب", "the queue flush does not start the window", [["src/team-queue.ts",
    "        if (r.ok && marketAsk) {", "        if (false) {"]], T],
  ["ب", "yesterday's queued ask sent", [["src/team-queue.ts",
    "      if (l.ask_day !== riyadhDateKey()) {", "      if (false) {"]], T],
  ["ب", "a source without the flag read", [[PS,
    "  if (!emp && !src.partners.some((p) => p.partnerId === who.partnerId && !p.supplier)) return null;\n", ""]], T],
  ["ب", "no market outlier", [[PS,
    "  const mOut = isOutlier(lastM, o.market);", "  const mOut = false;"]], T],
  ["ب", "a simulation offer as the outlier reference", [[PS,
    "[f, \">\", 0], [SIM_FIELD, \"!=\", true]],", "[f, \">\", 0]],"]], T],
  ["ب", "Ahmed's «سوق» number saved as his purchase price", [["src/suppliers.ts",
    "    const p = { ...k.item, cost_price: k.purchase ?? 0 };", "    const p = { ...k.item, cost_price: k.purchase ?? k.market ?? 0 };"], ["src/suppliers.ts",
    "      if (k.purchase !== undefined) {", "      if (p.cost_price > 0) {"]], T],
  ["ب", "Ahmed's market observation not saved", [["src/suppliers.ts",
    "      if (k.market !== undefined || k.qty !== undefined) {", "      if (false) {"]], T],
  ["ب", "the team hook not wired in /webhook", [["src/index.ts",
    ".then((m) => m.tryMarketReply(env,", ".then((m) => null && m.tryMarketReply(env,"]], T],
  ["ب", "the ask not in the */5 prices tick", [["src/prices.ts",
    "    out.marketAsk = await runMarketAsk(env, now, pricesDeadlineMinutes(env).minutes);", "    out.marketAsk = { action: \"ran\" }; void runMarketAsk;"]], T],
  ["ب", "Omar's reply not acknowledged", [[PS,
    "  return { saved, reply: marketAckText(saved) };", "  return { saved, reply: \"\" };"]], T],
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
