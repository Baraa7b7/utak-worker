// Mutation check for STATUS § 36 (every outbound message on record, the
// template's text, the held line): each mutation disables ONE mechanism, runs
// tests/wa-record.test.mts, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/s36-20260925-mutations.mjs
//
// Out: scripts/artifacts/s36-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/wa-record.test.mts";
const GW = "src/wa-gateway.ts";
const RC = "src/wa-record.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- a row and a line for every send
  ["row+line: an accepted send not recorded (pilot / prod branch)", [[GW,
    "  if (resp.ok) {\n    await afterAccepted(env, req, to, body, wamid, templateName);\n    await recordAccepted(env, req, to, body, wamid);",
    "  if (resp.ok) {\n    await afterAccepted(env, req, to, body, wamid, templateName);"]], T],
  ["Baraa left out again (no partner / channel for the owner)", [[RC,
    "    const byChannel = await inboxPartnerForNumber(env, digits);",
    "    if (digits === waDigits(String(env.OWNER_WHATSAPP ?? \"\"))) return null;\n    const byChannel = await inboxPartnerForNumber(env, digits);"]], T],
  ["the row not on the number's partner", [[RC,
    "    ...(partner ? { x_partner_id: partner.id } : {}),\n", ""]], T],
  ["the held line not posted", [[GW,
    "  await echoRowSoon(env, item.rowId, to, req.ctx);\n", ""]], T],
  ["the held line for customers only (the old owner exclusion)", [[GW,
    "  await echoRowSoon(env, item.rowId, to, req.ctx);", "  if (!isOwnerRecipient(env, to)) await echoRowSoon(env, item.rowId, to, req.ctx);"]], T],
  ["Baraa's Discuss reply recorded again by the gateway", [[GW,
    "  if (req.purpose === \"inbox_reply\" && !rowId) return;", "  if (false) return;"]], T],
  ["a manual send shown as «🤖 آلي»", [[RC,
    "  const tags = [o.manual ? \"📤 يدوي\" : \"🤖 آلي\",", "  const tags = [\"🤖 آلي\","]], T],
  // ---- the line failing, and its retry
  ["a failing line breaks the send", [[RC,
    "      console.warn(`[record] Discuss line row=${rowId} to=${maskPhone(number)} failed — retried by the */5 tick`, (e as Error)?.message);",
    "      throw e;"]], T],
  ["retry: no 2-minute guard (races the first try)", [[RC,
    "[\"write_date\", \"<=\", nowOdoo(now - 2 * 60_000)]", "[\"write_date\", \"<=\", nowOdoo(now + 60_000)]"]], T],
  ["retry: never marks the row «failed»", [[RC,
    "      if (tries >= MAX_ECHO_RETRIES) {", "      if (tries >= 99) {"]], T],
  ["retry: «failed» after one retry", [[RC,
    "      if (tries >= MAX_ECHO_RETRIES) {", "      if (tries >= 1) {"]], T],
  ["a refused row is not kept", [[RC,
    "    await keepOrphan(env, { ...rec, sentAt: rec.sentAt ?? Date.now(), ctx: undefined });\n", ""]], T],
  ["a kept row is never created", [[RC,
    "          const r = await writeSentRow(env, o.rec);", "          if (o) throw new Error(\"mutation\");\n          const r = await writeSentRow(env, o.rec);"]], T],
  ["the */5 tick does not run the retry", [["src/index.ts",
    "            const rr = await retryPendingRecords(env);", "            const rr = { echoed: 0, failed: 0, waiting: 0, orphans: 0 };"]], T],
  // ---- the template's text
  ["variables not filled", [[RC,
    "  const filled = t.bodyText.replace(/\\{\\{(\\d+)\\}\\}/g, (m, n) => params[Number(n) - 1] ?? m);", "  const filled = t.bodyText;"]], T],
  ["buttons not shown as «🔘 label»", [[RC,
    "  const buttons = t.buttonsText.split(\"\\n\").map((l) => l.trim()).filter(Boolean).map((l) => `🔘 ${l}`);", "  const buttons: string[] = [];"]], T],
  ["the document header dropped", [[RC,
    "  if (p.type === \"document\") return `📎 ${p.document?.filename ?? \"مستند\"}`;", "  if (p.type === \"document\") return \"\";"]], T],
  ["unsynced: the template's name instead", [[RC,
    "    const lines = [head, UNSYNCED_LINE, ...params.filter((p) => p !== \"\").map((p) => `• ${p}`)].filter(Boolean);",
    "    const lines = [head, `📋 قالب: ${String((body as TemplateBody).template?.name)}`].filter(Boolean);"]], T],
  ["unsynced: the variables not shown", [[RC,
    "    const lines = [head, UNSYNCED_LINE, ...params.filter((p) => p !== \"\").map((p) => `• ${p}`)].filter(Boolean);",
    "    const lines = [head, UNSYNCED_LINE].filter(Boolean);"]], T],
  ["x_template_id not written", [[RC,
    "    ...(shown.templateId ? { x_template_id: shown.templateId } : {}),\n", ""]], T],
  // ---- the held line
  ["held: the status line missing", [[RC,
    "  if (status === \"held\") html = echoHtml(text, { ...opts, status: heldLine(heldUntilOf(row)) });", "  if (status === \"held\") html = echoHtml(text, opts);"]], T],
  ["held: the status line without the text", [[RC,
    "  if (status === \"held\") html = echoHtml(text, { ...opts, status: heldLine(heldUntilOf(row)) });", "  if (status === \"held\") html = echoHtml(\"\", { ...opts, status: heldLine(heldUntilOf(row)) });"]], T],
  ["held → sent: the line never edited (always a reply)", [[RC,
    "    if (line && !(await editStatusLine(env, row.id))) {", "    if (line && !(false)) {"]], T],
  ["held → sent: no reply when Odoo refuses the edit", [[RC,
    "      await postEcho(env, partner, number, `<p>${escapeHtml(line)}</p>`, { parent_id: row.x_echo_message_id });\n", ""]], T],
  ["expired: the line does not follow", [[GW,
    "  await recordStateChange(env, rowId, to);\n", ""]], T],
  ["skipped: the line does not follow", [[GW,
    "      await recordStateChange(env, item.rowId, to, ctx);\n", ""]], T],
  ["server action: any author's message edited", [[RC,
    "msg.author_id != bot or ", ""]], T],
  ["a backfilled line without «مستكمل»", [[RC,
    "o.backfilled ? BACKFILL_TAG : \"\"", "\"\""]], T],
  // ---- utak_update_supplier
  ["utak_update_supplier never chosen for a supplier", [["src/wa-opener.ts",
    "  supplier: \"conv_open_supplier\",", "  supplier: \"conv_open_customer\","]], T],
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
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name}${fails.length ? `  — ${fails[0]}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("./artifacts/s36-20260925-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
