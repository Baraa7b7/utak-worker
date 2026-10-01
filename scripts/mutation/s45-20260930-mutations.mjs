// Mutation check for § 45 (2026-09-30): each mutation disables ONE guard of a
// part, runs its test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/mutation/s45-20260930-mutations.mjs [ب|ج …]     (no argument: every part)
//
// Out: scripts/artifacts/s45-20260930-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s45.test.mts";
const OW = "src/owner-window.ts";
const OS = "src/owner-summary.ts";
const PR = "src/prices.ts";
const IX = "src/index.ts";
const GW = "src/wa-gateway.ts";
const PU = "src/wa-purposes.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ب the 21:30 summary
  ["ب", "template 1 used though not APPROVED", [[OW,
    "    return String(row.x_meta_status || \"\").toUpperCase() === \"APPROVED\" && String(row.x_category || \"\").toUpperCase() === \"UTILITY\" ? row : null;",
    "    return String(row.x_category || \"\").toUpperCase() === \"UTILITY\" ? row : null;"]], T],
  ["ب", "template 1 used though MARKETING", [[OW,
    "    return String(row.x_meta_status || \"\").toUpperCase() === \"APPROVED\" && String(row.x_category || \"\").toUpperCase() === \"UTILITY\" ? row : null;",
    "    return String(row.x_meta_status || \"\").toUpperCase() === \"APPROVED\" ? row : null;"]], T],
  ["ب", "template 1 without the day ({{1}})", [[OW,
    "params: [arabicDate(day), ...params], buttons: [{ index: 0, payload: SUMMARY_ACK_PAYLOAD }]",
    "params: [...params], buttons: [{ index: 0, payload: SUMMARY_ACK_PAYLOAD }]"]], T],
  ["ب", "template 1 without its «تم الاطلاع» payload", [[OW,
    "params: [arabicDate(day), ...params], buttons: [{ index: 0, payload: SUMMARY_ACK_PAYLOAD }]",
    "params: [arabicDate(day), ...params]"]], T],
  ["ب", "template 1 never tried (utak_v2_summary always)", [[OS,
    "    fallback: night?.first ? [text, v2] : night ? [night.option, v2] : [v2],",
    "    fallback: night?.first ? [text, v2] : [v2],"]], T],
  ["ب", "template 1 after utak_v2_summary", [[OS,
    "    fallback: night?.first ? [text, v2] : night ? [night.option, v2] : [v2],",
    "    fallback: night?.first ? [text, v2] : night ? [v2, night.option] : [v2],"]], T],
  ["ب", "the window closing before 06:00 ignored (the text, no button)", [[OW,
    "  return { option, first: win.open && win.closesAtMs < (await nightEndMs(env, day)) };",
    "  return { option, first: false };"]], T],
  ["ب", "template 1 even inside a window that covers the night", [[OW,
    "  return { option, first: win.open && win.closesAtMs < (await nightEndMs(env, day)) };",
    "  return { option, first: win.open };"]], T],
  // ---------------------------------------------------------------- ب the taps
  ["ب", "«تم الاطلاع» without its line", [[OW,
    "  if (payload === SUMMARY_ACK_PAYLOAD) return SUMMARY_ACK_TEXT;\n", ""]], T],
  ["ب", "the taps not routed in the owner branch", [[IX,
    "        } else if ((msg.type === \"interactive\" || msg.type === \"button\") && isOwnerWindowPayload(msg.buttonId)) {",
    "        } else if (false && isOwnerWindowPayload(msg.buttonId)) {"]], T],
  ["ب", "«عرض الاستثناءات»: a line even after the flush sent them", [[OW,
    "  if (payload === PRICE_REVIEW_PAYLOAD) return flushedSent > 0 ? null : PRICE_REVIEW_NOTHING_TEXT;",
    "  if (payload === PRICE_REVIEW_PAYLOAD) return PRICE_REVIEW_NOTHING_TEXT;"]], T],
  ["ب", "«عرض الاستثناءات»: silent when nothing was waiting", [[OW,
    "  if (payload === PRICE_REVIEW_PAYLOAD) return flushedSent > 0 ? null : PRICE_REVIEW_NOTHING_TEXT;",
    "  if (payload === PRICE_REVIEW_PAYLOAD) return null;"]], T],
  // ---------------------------------------------------------------- ب template 2
  ["ب", "template 2 never called from the prices tick", [[PR,
    "  if (out.count) {\n    const { notifyPriceReview } = await import(\"./owner-window\");",
    "  if (false) {\n    const { notifyPriceReview } = await import(\"./owner-window\");"]], T],
  ["ب", "template 2 even when his window is open", [[OW,
    "  if (win.open) return null;\n  const held", "  const held"]], T],
  ["ب", "template 2 with nothing held for him", [[OW,
    "  if (!held.length) return null;\n", ""]], T],
  ["ب", "template 2 without the daily claim (every tick)", [[OW,
    "const reviewLock = (day: string) => `owner_price_review:${day}`;", "const reviewLock = (day: string) => `owner_price_review:${day}:${Math.random()}`;"]], T],
  ["ب", "template 2 used though not usable", [[OW,
    "  const row = await usableOwnerTemplate(env, PRICE_REVIEW_TEMPLATE);\n  if (!row) return \"not_usable\";",
    "  const row = (await usableOwnerTemplate(env, PRICE_REVIEW_TEMPLATE)) ?? ({ id: 1, x_meta_template_id: PRICE_REVIEW_TEMPLATE, x_language: \"ar\", x_meta_status: \"APPROVED\", x_category: \"UTILITY\" } as TemplateCandidate);"]], T],
  ["ب", "the claim kept when nothing went (never retried once approved)", [[OW,
    "  await releaseButton(env, claim);\n  return d?.action", "  await finishButton(env, claim, REVIEW_TTL);\n  return d?.action"],
    [OW, "  if (!row) return \"not_usable\";\n  const claim = await claimButton(env, reviewLock(day), REVIEW_TTL);",
      "  const claim = await claimButton(env, reviewLock(day), REVIEW_TTL);\n  if (!row) { await finishButton(env, claim, REVIEW_TTL); return \"not_usable\"; }"]], T],
  ["ب", "template 2 counts the new exceptions only, not the undecided", [[PR,
    "    const review = await notifyPriceReview(env, riyadhDateKey(new Date(now)), out.count, now).catch((e) => {",
    "    const review = await notifyPriceReview(env, riyadhDateKey(new Date(now)), out.sent ?? out.count, now).catch((e) => {"]], T],
  ["ب", "template 2 without the day ({{1}})", [[OW,
    "params: [arabicDate(day), String(count)]", "params: [String(count)]"]], T],
  ["ب", "template 2 without its «عرض الاستثناءات» payload", [[OW,
    "params: [arabicDate(day), String(count)], buttons: [{ index: 0, payload: PRICE_REVIEW_PAYLOAD }] },",
    "params: [arabicDate(day), String(count)] },"]], T],
  ["ب", "owner_price_review not in the owner guard", [[GW,
    "\"owner_price_exception\", \"owner_price_review\", \"owner_order_confirmed\"]);", "\"owner_price_exception\", \"owner_order_confirmed\"]);"]], T],
  ["ب", "owner_price_review not a known purpose", [[PU,
    "  owner_price_review: op(\"قالب استثناءات الأسعار\"),\n", ""]], T],
  ["ب", "a held exception stale before 06:00", [[PR,
    "  const expiresAt = riyadhDayMinuteMs(day, dl);\n  const deadline = hhmm(dl);",
    "  const expiresAt = riyadhDayMinuteMs(day, dl - 10);\n  const deadline = hhmm(dl);"]], T],
  // ---------------------------------------------------------------- ج Omar on seven days: a planted «Friday off» is caught
  ["ج", "a hard-coded Friday off in the schedule reader (every path)", [["src/team-roster.ts",
    "  const wd = String(odooWeekday(day));\n  return lines.filter((a) => {",
    "  const wd = String(odooWeekday(day));\n  if (wd === \"4\") return [];\n  return lines.filter((a) => {"]], T],
  ["ج", "a hard-coded Friday off in the operating cost's working days", [["src/operating-cost.ts",
    "  for (let d = from; d <= to; d = addDays(d, 1)) if (linesOn(s.lines, s.calendarId, d).length > 0) n++;",
    "  for (let d = from; d <= to; d = addDays(d, 1)) if (linesOn(s.lines, s.calendarId, d).length > 0 && new Date(`${d}T12:00:00Z`).getUTCDay() !== 5) n++;"]], T],
  ["ج", "a hard-coded Friday off for the day's own share", [["src/operating-cost.ts",
    "  return linesOn(s.lines, s.calendarId, day).length > 0;\n}",
    "  return linesOn(s.lines, s.calendarId, day).length > 0 && new Date(`${day}T12:00:00Z`).getUTCDay() !== 5;\n}"]], T],
  ["ج", "the next shift skips Friday (the list held until Saturday)", [["src/team-roster.ts",
    "export function nextShiftStart(roster: Roster, m: RosterMember, fromMs: number): { day: string; startMin: number; ms: number } | null {",
    "export function nextShiftStart(roster: Roster, m: RosterMember, fromMs: number): { day: string; startMin: number; ms: number } | null {\n  if (new Date(fromMs + 3 * 3600_000).getUTCDay() === 4) fromMs += 24 * 3600_000;"]], T],
  ["ج", "the driver's follow-up skips Friday", [["src/driver-followup.ts",
    "        if (plan.kind === \"work\") steps.push(",
    "        if (plan.kind === \"work\" && new Date(`${day}T12:00:00Z`).getUTCDay() !== 5) steps.push("]], T],
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
writeFileSync(new URL("../artifacts/s45-20260930-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
