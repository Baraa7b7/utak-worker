// Mutation check for tests/review.test.mts (+ tests/attendance.test.mts for
// the window time) — 2026-09-25, STATUS § 30. Each mutation disables ONE
// mechanism, runs the test file, and must make it fail. The source is
// restored in `finally` after every run; a pattern that is not found exactly
// once stops the script.
//
//   node scripts/rev-20260925-mutations.mjs
//
// Out: scripts/artifacts/rev-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const REVIEW = "tests/review.test.mts", ATT = "tests/attendance.test.mts";
// [name, file, find, replace, test file]
const M = [
  ["new partner not «غير مراجَع»", "src/odoo.ts", `    x_contact_class: "unreviewed",\n  };`, `  };`, REVIEW],
  ["screens any class (known partners too)", "src/screening.ts", `if (st.x_contact_class !== "unreviewed") return`, `if (false) return`, REVIEW],
  ["a real order does not confirm a customer", "src/screening.ts", `if (await hasRealOrder(env, input.partnerId)) {`, `if (false) {`, REVIEW],
  ["purchase flagged too", "src/screening.ts", `const pending = wasPending || intent !== "purchase";`, `const pending = true;`, REVIEW],
  ["non-customer intents not held", "src/screening.ts", `return !!p.x_review_pending && NON_CUSTOMER_INTENTS.has(String(p.x_ai_intent || ""));`, `return false;`, REVIEW],
  ["«شخصي» (decided) not held", "src/screening.ts", `new Set(["supplier", "team", "personal"])`, `new Set(["supplier", "team"])`, REVIEW],
  ["decided «عميل» held by an old flag", "src/screening.ts", `  if (cls === "customer") return false;\n`, ``, REVIEW],
  ["classifier not reused (a second Claude call)", "src/screening.ts", `if (ci && PURCHASE_CLASSIFY_INTENTS.has(ci)) {`, `if (false) {`, REVIEW],
  ["announce: no race claim", "src/screening.ts", `  if (!claim.claimed) return;\n  let first`, `  let first`, REVIEW],
  ["announce: no channel message", "src/screening.ts", `const ok = author ? await postToChannel(env, channelId, author, body) : false;`, `const ok = false;`, REVIEW],
  ["announce: no owner alert", "src/screening.ts", "  await sendOwnerAlert(env, `${REVIEW_ALERT_PREFIX}${a.name}`);", ``, REVIEW],
  ["inbound: held partner still answered", "src/index.ts", `    if (isCustomerAutomationHeld(screenState)) {`, `    if (false) {`, REVIEW],
  ["inbound: a held text is not screened", "src/index.ts", `      if (msg.type === "text" && !optoutCmd) {\n        screened = true;`, `      if (false) {\n        screened = true;`, REVIEW],
  ["inbound: held «إيقاف» preference dropped", "src/index.ts", `          await handleOptoutCommand(env, partner, msg.text).catch(() => null);`, ``, REVIEW],
  ["inbound: text not screened after the reply", "src/index.ts", `    if (msg.type === "text" && !screened) {`, `    if (false) {`, REVIEW],
  ["media: held partner answered + owner alert", "src/index.ts", `          if (held) console.log(`, `          if (false) console.log(`, REVIEW],
  ["outreach (rating / pay / reactivation) not gated", "src/outreach.ts", `  return rows.filter((r) => !isCustomerAutomationHeld(r));`, `  return rows;`, REVIEW],
  ["standing reminder not gated", "src/standing.ts", `    if (held.has(s.x_customer_id[0])) {`, `    if (false) {`, REVIEW],
  ["20:00 / 21:00 notices not gated", "src/team.ts", `  if ((await heldPartnerIds(env, [cust.id])).has(cust.id)) return "held";`, ``, REVIEW],
  ["archived: ingest routes it as new", "src/wa-inbox.ts", `route = created.archived ? "archived" : "new";`, `route = "new";`, REVIEW],
  ["archived: no lookup (a new partner is created)", "src/odoo.ts", `  if (archived) return { ...archived, archived: true };`, ``, REVIEW],
  ["archived: customer path guard (after a failed ingest)", "src/index.ts", `    if (partner.archived) {`, `    if (false) {`, REVIEW],
  ["button «عميل» keeps the flag", "scripts/lib/review-buttons.mjs", `    vals = {'x_contact_class': 'customer', 'x_review_pending': False}`, `    vals = {'x_contact_class': 'customer'}`, REVIEW],
  ["button «مورد» without supplier_rank", "scripts/lib/review-buttons.mjs", `        vals['supplier_rank'] = 1`, `        pass_ = 1`, REVIEW],
  ["button «أرشفة» deletes", "scripts/lib/review-buttons.mjs", `records.write({'x_review_pending': False, 'active': False})`, `records.unlink()`, REVIEW],
  ["button «فريق» sets «عميل»", "scripts/lib/review-buttons.mjs", `records.write({'x_contact_class': 'team', 'x_review_pending': False})`, `records.write({'x_contact_class': 'customer', 'x_review_pending': False})`, REVIEW],
  ["backfill: a supplier classified", "scripts/lib/review-backfill-core.mjs", `if ((p.supplier_rank ?? 0) > 0) {`, `if (false) {`, REVIEW],
  ["backfill: an order on the number ignored", "scripts/lib/review-backfill-core.mjs", `if (orderNumbers.has(num)) {`, `if (false) {`, REVIEW],
  ["window: always the fallback", "src/attendance.ts", `  if (!shifts.length) return { minutes: ownerWindowMinutes(env)`, `  if (true) return { minutes: ownerWindowMinutes(env)`, REVIEW],
  ["window: no 15-minute lead", "src/attendance.ts", `export const OWNER_WINDOW_LEAD_MIN = 15;`, `export const OWNER_WINDOW_LEAD_MIN = 0;`, REVIEW],
  ["window: Baraa's own time counts", "src/attendance.ts", `    .filter((m) => !isOwnerNumber(env, m.whatsapp) && m.whatsapp)`, `    .filter((m) => m.whatsapp)`, REVIEW],
  ["window: always the fallback (attendance tests)", "src/attendance.ts", `  if (!shifts.length) return { minutes: ownerWindowMinutes(env)`, `  if (true) return { minutes: ownerWindowMinutes(env)`, ATT],
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
  const summary = /(?:review|attendance): (\d+) passed, (\d+) failed/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 120));
  const caught = code !== 0;
  results.push({ mutation: name, file, test, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/rev-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
