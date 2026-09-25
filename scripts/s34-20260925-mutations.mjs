// Mutation check for STATUS § 34 («فتح المحادثة», the receipt template, team
// notes): each mutation disables ONE mechanism, runs tests/wa-opener.test.mts,
// and must make it fail. The source is restored in `finally` after every run;
// a pattern that is not found exactly once stops the script.
//
//   node scripts/s34-20260925-mutations.mjs
//
// Out: scripts/artifacts/s34-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const O = "tests/wa-opener.test.mts";
const OP = "src/wa-opener.ts", GW = "src/wa-gateway.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- once a day
  ["once a day: the day key is not checked (neither the early read nor the claim)", [[OP,
    "    if (today !== null) return { outcome: \"already_today\", category, detail: today };", "    void today;"],
    [OP, "  if (prev !== null) return { claimed: false, token: \"\", state: prev };\n", ""]], O],
  ["once a day: no read-back on the claim (a race sends twice)", [[OP,
    "    if (back !== null && back !== token) return { claimed: false, token, state: back };", "    void back;"]], O],
  ["once a day: the sent opener does not mark the day", [[OP,
    "      await markOpenerSentToday(env, to, d.template, now);\n      console.log(`[opener] sent", "      console.log(`[opener] sent"],
    [OP, "    const claim = await claimDay(env, to, now);\n    if (!claim.claimed)", "    const claim = { claimed: true, state: \"\" };\n    if (!claim.claimed)"]], O],
  // ---- the category
  ["category: every number is a customer", [[OP,
    "  if (team) return { category: \"team\", reason: \"فريق\", partnerId: team.id };", "  void team;"],
    [OP, "  if (supplier) return { category: \"supplier\", reason: \"مورد\", partnerId: supplier.id };", "  void supplier;"]], O],
  ["category: archived numbers get an opener", [[OP,
    "  if (partners.length > 0 && active.length === 0) return { category: null, reason: \"مؤرشف\" };",
    "  if (partners.length > 0 && active.length === 0) return { category: \"customer\", reason: \"x\", partnerId: partners[0].id };"]], O],
  ["category: «شخصي» gets an opener", [[OP,
    "  if (active.some((p) => p.x_contact_class === \"personal\")) return { category: null, reason: \"شخصي\" };", ""]], O],
  ["category: the opted-out get an opener", [[OP,
    "  if (partners.some((p) => p.x_wa_marketing_optout === true)) return { category: null, reason: \"أوقف الرسائل (§ 23)\" };", ""]], O],
  ["category: the review hold is ignored", [[OP,
    "  if (isCustomerAutomationHeld(customer)) return { category: null, reason: \"ينتظر المراجعة أو محجوز عن الرسائل الآلية\" };", ""]], O],
  // ---- critical
  ["critical: a held critical message sends no opener", [[GW,
    "  if (policy.critical) {\n    const { sendOpenerForHeld }", "  if (false) {\n    const { sendOpenerForHeld }"]], O],
  ["critical: every held message sends an opener", [[OP,
    "    if (!purposePolicy(heldPurpose)?.critical) return { outcome: \"not_critical\" };", ""],
    [GW, "  if (policy.critical) {\n    const { sendOpenerForHeld }", "  if (true) {\n    const { sendOpenerForHeld }"]], O],
  ["critical: owner alerts not critical", [["src/wa-purposes.ts",
    "  owner_alert: crit(op(\"تنبيه المالك\", false, { hours: 36 }), \"تنبيه تشغيلي\"),", "  owner_alert: op(\"تنبيه المالك\", false, { hours: 36 }),"]], O],
  // ---- unusable / refused
  ["unusable: a final (MARKETING/REJECTED) template retried within the day", [[OP,
    "    if (awaitingMeta(why)) {", "    if (true) {"]], O],
  ["unusable: a PENDING template spends the day", [[OP,
    "    if (awaitingMeta(why)) {", "    if (false) {"]], O],
  ["refused: Meta's refusal frees the day (a second try)", [[OP,
    "    if (d?.action === \"rejected\") {\n      // The claim stays",
    "    if (d?.action === \"rejected\") {\n      await env.MSG_DEDUP.delete(openerDayKey(to, now));\n      // The claim stays"]], O],
  // ---- the tap
  ["tap: not handled (routing continues)", [["src/index.ts",
    "      if ((msg.type === \"button\" || msg.type === \"interactive\") && msg.buttonId === OPEN_PAYLOAD) {", "      if (false) {"]], O],
  ["tap: «ما فيه تحديث» even after a flush", [["src/index.ts",
    "          } else if (!flushed || flushed.sent === 0) {", "          } else if (true) {"]], O],
  ["tap: Baraa gets no «✅ تم»", [["src/index.ts",
    "            await sendText(env, msg.from, ownerWindowAck(), { ctx, purpose: \"owner_alert\" });\n          } else if (!flushed",
    "            void ownerWindowAck;\n          } else if (!flushed"]], O],
  // ---- Baraa
  ["owner: an opener in the half hour before 06:00", [[OP,
    "      if (until >= 0 && until <= OWNER_MORNING_QUIET_MIN) {", "      if (false) {"]], O],
  ["owner: utak_owner_alert back as a fallback", [["src/templates.ts",
    "      content: { kind: \"session\", body: { type: \"text\", text: { body: String(text ?? \"\") } } },\n    });",
    "      content: { kind: \"session\", body: { type: \"text\", text: { body: String(text ?? \"\") } } },\n      fallback: [{ kind: \"template\", purpose: \"owner_alert\", params: (n) => n === \"utak_owner_alert_v3\" ? [\"t\", String(text)] : [String(text)] }],\n    });"]], O],
  ["owner: no utak_update_owner backup at 06:00", [["src/attendance.ts",
    "      fallback: [openerOption(\"owner\", [arabicDate(day), OWNER_OPENER_UPDATE])],", ""]], O],
  ["owner: the 06:00 backup does not count as the day's opener", [["src/attendance.ts",
    "    await markOpenerSentToday(env, owner, d.template, nowMs);\n", ""]], O],
  ["owner guard: owner_team_note blocked", [[GW,
    "\"conv_open_owner\", \"owner_team_note\"]", "\"conv_open_owner\"]"]], O],
  // ---- params
  ["params: a customer's {{1}} is the date, not the account number", [[OP,
    "  const ref = category === \"customer\" && partnerId ? String(partnerId) : arabicDate(riyadhDateKey(new Date(now)));",
    "  const ref = arabicDate(riyadhDateKey(new Date(now)));"]], O],
  // ---- the receipt
  ["receipt: no utak_payment_received outside the window", [["src/receipt.ts",
    "    fallback: [{ kind: \"template\", purpose: T.CUSTOMER_PAYMENT_RECEIVED, params: [receiptAmountLabel(data.totalReceived), invoiceNumber] }],\n", ""]], O],
  ["receipt: the payment ack is held outside the window", [["src/invoice.ts",
    "        noHold: true,\n", ""]], O],
  // ---- team notes
  ["team note: without the customer's name", [["src/team-note.ts",
    "      customerName = (await getOrderCustomer(env, orderId))?.name || \"-\";", "      customerName = \"-\";"]], O],
  ["team note: the collection note is not kept on the payment", [["src/team-note.ts",
    "        await call(env, \"x_payment\", \"write\", { ids: [pay.id], vals: { x_notes: next.slice(-4000) } });", "        void next;"]], O],
  ["team note: «ملاحظة 📝» not offered after a collection", [["src/router.ts",
    "    if (text && collected) {", "    if (false) {"]], O],
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
writeFileSync(root + "scripts/artifacts/s34-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
