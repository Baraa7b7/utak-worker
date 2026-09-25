// Mutation check for STATUS § 33 (the single send gateway): each mutation
// disables ONE mechanism, runs a test file, and must make it fail. The source
// is restored in `finally` after every run; a pattern that is not found
// exactly once stops the script.
//
//   node scripts/gw-20260925-mutations.mjs
//
// Out: scripts/artifacts/gw-20260925-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const G = "tests/wa-gateway.test.mts", I = "tests/wa-inbox.test.mts", S = "tests/team-shifts.test.mts";
const GW = "src/wa-gateway.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- the window decision
  ["window: a session text goes whatever the window", [[GW,
    "    if (win.open) return dispatchToMeta(env, req, to, opt.body);",
    "    if (true) return dispatchToMeta(env, req, to, opt.body);"]], G],
  ["window: closed and no template → skipped instead of held", [[GW,
    // § 34 added noHold to this line (2026-09-25); § 36 brought the pattern up to date
    "  if (held && !req.noHold) return hold(env, req, to, held, why);\n", ""]], G],
  ["window: no 10-minute margin", [["src/wa-window.ts",
    "export const WINDOW_MARGIN_MS = 10 * 60 * 1000;", "export const WINDOW_MARGIN_MS = 0;"]], G],
  // evaluateWindow alone keeps it closed (in + 24h has passed); the check also
  // keeps a late message from writing the number's record (wa-inbox [3g])
  ["window: a message older than 24h (Meta's clock) is written as the last inbound", [["src/wa-window.ts",
    "now - metaTsMs >= WINDOW_MS || ", ""]], I],
  ["window: our arrival time instead of Meta's timestamp", [["src/index.ts",
    "inboundWindow = await noteInbound(env, msg.from, parseMetaTimestampMs(msg.timestamp));",
    "inboundWindow = await noteInbound(env, msg.from, Date.now());"]], G],
  ["window: the Odoo fallback reads the row's arrival (create_date)", [["src/wa-window.ts",
    "  for (const r of rows) latest = Math.max(latest, odooMs(r.x_processed_at));",
    "  for (const r of rows) latest = Math.max(latest, odooMs(r.x_processed_at), odooMs((r as { create_date?: string }).create_date));"],
    ["src/wa-window.ts", '    fields: ["x_processed_at"],', '    fields: ["x_processed_at", "create_date"],']], I],
  // ---- the queue
  ["queue: not flushed on the number's inbound", [["src/index.ts",
    // § 34 keeps the flush's result (2026-09-25); § 36 brought the pattern up to date
    "        flushed = await flushHeld(env, msg.from, inboundWindow, ctx);", "        void flushHeld;"]], G],
  ["queue: flushed newest first", [["src/wa-queue.ts",
    "  return items.sort((a, b) => a.createdAt - b.createdAt);", "  return items.sort((a, b) => b.createdAt - a.createdAt);"]], G],
  ["queue: an expired item is sent anyway", [[GW,
    "    if (item.expiresAt <= now) {\n      await markExpired(env, to, item);", "    if (false) {\n      await markExpired(env, to, item);"]], G],
  ["queue: the same message held twice", [[GW,
    "  if (existing.some((i) => i.id === item.id)) {", "  if (false) {"],
    ["src/wa-queue.ts", '  if (cur.some((i) => i.id === item.id)) return "duplicate";\n', ""]], G],
  ["queue: two racing flushes send twice (no per-item mark)", [[GW,
    "    if (await kvGet(env, mark)) continue;\n", ""]], G],
  ["queue: the sweep drops nothing", [[GW,
    "    const dead = items.filter((i) => i.expiresAt <= now);", "    const dead: QueueItem[] = [];"]], G],
  ["queue: the held row is not «held»", [[GW,
    '    x_status: "held",\n    x_debug_payload: payload,', '    x_status: "sent",\n    x_debug_payload: payload,']], G],
  // ---- categories
  ["category: any category for any purpose", [["src/wa-purposes.ts",
    '  if (c === "UTILITY") return true;', "  if (c) return true;"]], G],
  ["category: MARKETING for every purpose (utak_owner_alert back)", [["src/wa-purposes.ts",
    '    return k === "marketing" || k === "manual";', "    return true;"]], G],
  ["category: MARKETING for owner alerts (team-shifts dawn)", [["src/wa-purposes.ts",
    '    return k === "marketing" || k === "manual";', "    return true;"]], S],
  ["opt-out (§ 23) ignored for a MARKETING template", [[GW,
    '  if (String(row.x_category || "").toUpperCase() === "MARKETING" && (await marketingOptedOut(env, to))) {', "  if (false) {"]], G],
  // ---- important → Baraa once
  ["important: Baraa told on every held message", [[GW,
    "  if (await kvGet(env, key)) return;\n  await kvPut(env, key, new Date().toISOString(), 26 * 3600);",
    "  await kvPut(env, key, new Date().toISOString(), 26 * 3600);"]], G],
  // ---- Meta's refusals
  ["131047: the window stays open", [[GW,
    "    await markWindowClosed(env, to, now);\n", ""]], G],
  ["131047: the message is not re-queued", [[GW,
    "      await putBack(env, to, [item], now);\n", ""]], G],
  ["131047: no retry cap (a send loop)", [[GW,
    "    if (m?.s && m.e > now && attempts < MAX_WINDOW_RETRIES) {", "    if (m?.s && m.e > now) {"]], G],
  ["131049: the template goes again the same day", [[GW,
    "      await kvPut(env, templateBlockKey(to, m.t, now), new Date(now).toISOString(), (riyadhDayEndMs(now) - now) / 1000 + 3600);\n", ""]], G],
  ["other refusal: the purpose goes again within 24h", [[GW,
    "    await kvPut(env, purposeBlockKey(to, m.p), JSON.stringify({ code: f.code, at: new Date(now).toISOString() }), 24 * 3600);\n", ""]], G],
  ["other refusal: bot replies blocked for 24h too", [[GW,
    '  return k === "operational" || k === "marketing";', '  return k !== "manual";']], G],
  ["a status delivered twice is handled twice", [[GW,
    "  if (await kvGet(env, seen)) {", "  if (false) {"]], G],
  // ---- order and gates
  ["allowlist skipped (a refused number would be held)", [[GW,
    "  if (!isRecipientAllowed(env, to)) {", "  if (false) {"]], G],
  ["unknown purpose accepted", [[GW,
    "  if (!policy) {\n    console.error(`[gateway] unknown purpose", "  if (false) {\n    console.error(`[gateway] unknown purpose"]], G],
  ["a direct Graph POST outside the gateway (static check)", [["src/meta.ts",
    "// ---- Outbound text ----",
    "export async function rogueSend(env: Env): Promise<Response> {\n  return fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`, { method: \"POST\" });\n}\n\n// ---- Outbound text ----"]], G],
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
  const summary = /(?:[a-z-]+): (\d+) passed, (\d+) failed/.exec(out);
  const failedChecks = out.split("\n").filter((l) => l.startsWith("  ✗")).map((l) => l.slice(4, 120));
  const caught = code !== 0;
  results.push({ mutation: name, files: edits.map((e) => e[0]), test, caught, exit: code, failed: summary ? Number(summary[2]) : null, first: failedChecks.slice(0, 3) });
  console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name} — ${summary ? `${summary[2]} ✗` : `exit ${code}`}${failedChecks[0] ? ` (${failedChecks[0]})` : ""}`);
}
writeFileSync(root + "scripts/artifacts/gw-20260925-mutations.json", JSON.stringify(results, null, 2) + "\n");
const missed = results.filter((r) => !r.caught);
console.log(`\n${results.length - missed.length}/${results.length} caught`);
if (missed.length) process.exit(1);
