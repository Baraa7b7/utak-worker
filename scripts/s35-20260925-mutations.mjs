// Mutation check for STATUS § 35 («أسعار اليوم»): each mutation disables ONE
// rule, runs tests/prices.test.mts, and must make it fail. The source is
// restored in `finally` after every run; a pattern that is not found exactly
// once stops the script.
//
//   node scripts/s35-20260925-mutations.mjs
//
// Out: scripts/artifacts/s35-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/prices.test.mts";
const PR = "src/prices.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- the rules
  ["rounding: half down instead of half up", [[PR,
    "  return Math.floor((c * (10000 + m) + 5000) / 10000) / 100;", "  return Math.floor((c * (10000 + m)) / 10000) / 100;"]], T],
  ["rule: the margin ignored (sale = purchase)", [[PR,
    "  return Math.floor((c * (10000 + m) + 5000) / 10000) / 100;", "  return c / 100 + 0 * m;"]], T],
  ["default: the cheapest, outliers included", [[PR,
    "  const normal = offers.filter((o) => !o.outlier).sort(byPrice);", "  const normal = [...offers].sort(byPrice);"]], T],
  ["plan: a supplier's first price instead of the latest", [[PR,
    "    if (!cur || r.id > cur.id) latest.set(k, r);", "    if (!cur) latest.set(k, r);"]], T],
  ["plan: a failed extraction counts", [[PR,
    "    if (!(Number(r.x_price_sar) > 0) || r.x_extraction_status === \"failed\") continue;", "    if (!(Number(r.x_price_sar) > 0)) continue;"]], T],
  ["prices: another day's prices read", [[PR,
    "    domain: [[\"x_date\", \"=\", day], [\"x_price_sar\", \">\", 0],", "    domain: [[\"x_price_sar\", \">\", 0],"]], T],
  ["deadline: ORDERING_HOURS_OPEN ignored (07:00)", [[PR,
    "  return set === null ? { minutes: ORDERING_HOURS_OPEN * 60, source: \"ORDERING_HOURS_OPEN\" }", "  return set === null ? { minutes: 7 * 60, source: \"ORDERING_HOURS_OPEN\" }"]], T],
  // ---- refresh
  ["refresh: Baraa's edits overwritten (every line follows the default)", [[PR,
    "    if (untouched && defPrice !== p.chosen.priceId) {", "    if (defPrice !== p.chosen.priceId) {"]], T],
  ["refresh: a margin added later not taken", [[PR,
    "    if (!(Number(l.x_margin_pct) > 0) && margin > 0) vals.x_margin_pct = margin;\n", ""]], T],
  ["refresh: an approved day is rebuilt", [[PR,
    "  if (rec.x_state === \"approved\" || rec.x_state === \"published\") {\n    return { day, action: \"locked\"", "  if (false) {\n    return { day, action: \"locked\""]], T],
  ["refresh: no fingerprint (every tick rewrites)", [[PR,
    "      if ((await env.MSG_DEDUP.get(fpKey(day))) === fp) return", "      if (false) return"]], T],
  // ---- publish
  ["publish: a draft is published", [[PR,
    "  if (day.x_state !== \"approved\") return { action: \"not_approved\"", "  if (false) return { action: \"not_approved\""]], T],
  ["publish: twice (no «already»)", [[PR,
    "  if (day.x_state === \"published\") return { action: \"already\"", "  if (false) return { action: \"already\""],
    [PR, "  if (!claim.claimed) return { action: \"in_progress\"", "  if (false) return { action: \"in_progress\""]], T],
  ["publish: an excluded line published", [[PR,
    "    const publishable = lines.filter((l) => !l.x_excluded && Number(l.x_sale_price) > 0);", "    const publishable = lines.filter((l) => Number(l.x_cost_price) > 0);"]], T],
  ["publish: the purchase price shown instead of the sale price", [[PR,
    "      salePrice: Number(l.x_sale_price),", "      salePrice: Number(l.x_cost_price),"]], T],
  ["publish: an unhandled outlier published", [[PR,
    "    if (blocked.length) {\n      await releaseButton(penv, claim);", "    if (false) {\n      await releaseButton(penv, claim);"]], T],
  ["publish: a sale price off the rule published", [[PR,
    "    if (mismatch.length) {", "    if (false) {"]], T],
  ["publish: no copy / counts for Baraa", [[PR,
    "    for (const part of copy) await sendOwnerMessage(penv, part, OWNER_PRICES_PURPOSE);\n", ""]], T],
  ["publish: no alert naming the products without margin", [[PR,
    "      await sendOwnerAlert(penv, `⚠️ أصناف بلا هامش لم تُنشر اليوم:", "      if (0) await sendOwnerAlert(penv, `⚠️ أصناف بلا هامش لم تُنشر اليوم:"]], T],
  ["publish: never cut into parts", [[PR,
    "    if (size + it.length + 1 > room && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }", ""]], T],
  ["publish: not critical (no opener when held)", [["src/wa-purposes.ts",
    "  customer_prices: crit(op(\"أسعار اليوم\"), \"أسعار اليوم\"),", "  customer_prices: op(\"أسعار اليوم\"),"]], T],
  // ---- recipients
  ["recipients: the opted-out included", [[PR,
    "    if (p.x_wa_marketing_optout === true || isCustomerAutomationHeld(p)) continue;", "    if (isCustomerAutomationHeld(p)) continue;"]], T],
  ["recipients: review-held and «شخصي» included", [[PR,
    "    if (p.x_wa_marketing_optout === true || isCustomerAutomationHeld(p)) continue;", "    if (p.x_wa_marketing_optout === true) continue;"]], T],
  ["recipients: the team included", [[PR,
    "    if (!d || seen.has(d) || d === owner || team.has(d)) continue;", "    if (!d || seen.has(d) || d === owner) continue;"]], T],
  // ---- the deadline
  ["deadline: the day not marked «missed»", [[PR,
    "  if (target.x_state !== \"missed\") await call(env, PRICE_DAY_MODEL, \"write\", { ids: [target.id], vals: { x_state: \"missed\" } });\n", ""]], T],
  ["deadline: the alert every tick (no claim)", [[PR,
    "  if (!claim.claimed) return { action: \"claimed_before\", day };", "  if (false) return { action: \"claimed_before\", day };"]], T],
  ["deadline: a late worker still raises it at 09:00", [[PR,
    "  if (m >= dl + DEADLINE_WINDOW_MIN) return { action: \"after_window\", day };", ""]], T],
  // ---- tick / hook / quotes
  ["tick: publishes an approval at once (no wait for the webhook)", [[PR,
    "    if (rec?.x_state === \"approved\" && approvedAt && now - approvedAt >= PUBLISH_RETRY_AFTER_MS) {", "    if (rec?.x_state === \"approved\") {"]], T],
  ["hook: no token check", [["src/index.ts",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/prices\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/prices\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false && !timingSafeEqual(providedToken, expected)) {"]], T],
  ["quotes: the published price not used", [["src/odoo.ts",
    "    if (p > 0) return { price: p, source: \"today\", price_date: today, age_days: 0 };\n  } catch (e) {\n    console.warn(\"[price] published lookup failed", "    void p;\n  } catch (e) {\n    console.warn(\"[price] published lookup failed"]], T],
];

const results = [];
for (const [name, edits, test] of M) {
  const originals = new Map();
  let out = "", code = 0;
  try {
    for (const [file, find, repl] of edits) {
      const path = root + file;
      const orig = originals.get(path) ?? readFileSync(path, "utf8");
      if (!originals.has(path)) originals.set(path, orig);
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`«${name}»: pattern found ${n}× in ${file} — fix the mutation list`);
      writeFileSync(path, cur.replace(find, repl));
    }
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status ?? 1; out = String(e.stdout ?? "");
    }
  } finally {
    for (const [path, orig] of originals) writeFileSync(path, orig);
  }
  const summary = /(\d+) ✓\s+(\d+) ✗/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 120));
  const caught = code !== 0;
  results.push({ mutation: name, files: edits.map((e) => e[0]), test, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/s35-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
