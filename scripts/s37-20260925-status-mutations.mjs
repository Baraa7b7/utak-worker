// Mutation check for STATUS § 37 أ (Meta's statuses never go down): each
// mutation disables ONE mechanism, runs tests/wa-status.test.mts, and must
// make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
//   node scripts/s37-20260925-status-mutations.mjs
//
// Out: scripts/artifacts/s37-20260925-status-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/wa-status.test.mts";
const ST = "src/wa-status.ts";
const MS = "src/wa-message-send.ts";
const GW = "src/wa-gateway.ts";
const RC = "src/wa-record.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  ["the row's status written whatever it was (no guard)", [[MS,
    "    if (v.apply) {\n      const vals", "    if (true) {\n      const vals"]], T],
  ["a lower status written over a higher one", [[ST,
    "  if (incoming === \"failed\") return { apply: false, why: \"failed_after_delivery\" };\n  return { apply: false, why: \"lower\" };",
    "  if (incoming === \"failed\") return { apply: false, why: \"failed_after_delivery\" };\n  return { apply: true, why: \"lower\" };"]], T],
  ["«failed» written over delivered / read", [[ST,
    "  if (incoming === \"failed\") return { apply: false, why: \"failed_after_delivery\" };",
    "  if (incoming === \"failed\") return { apply: true, why: \"failed_after_delivery\" };"]], T],
  ["«failed» ranked above delivered", [[ST,
    "{ sent: 1, failed: 2, delivered: 3, read: 4 }", "{ sent: 1, failed: 3.5, delivered: 3, read: 4 }"]], T],
  ["«delivered» not written over «failed»", [[ST,
    "{ sent: 1, failed: 2, delivered: 3, read: 4 }", "{ sent: 1, failed: 5, delivered: 3, read: 4 }"]], T],
  ["the same status written again", [[ST,
    "  if (cur === incoming) return { apply: false, why: \"same\" };\n", ""]], T],
  ["the gateway's own states overwritten (held …)", [[ST,
    "  if (!isMetaStatus(cur)) return { apply: false, why: \"not_meta_state\" };",
    "  if (!isMetaStatus(cur)) return { apply: true, why: \"not_meta_state\" };"]], T],
  ["the ignored failure not noted in x_debug_payload", [[MS,
    "    } else if (v.why === \"failed_after_delivery\") {", "    } else if (false) {"]], T],
  ["a failed after delivery still acted on (line, alert, window, block)", [[GW,
    "  if (over) {\n    console.warn(", "  if (false) {\n    console.warn("]], T],
  ["no row: D1's delivered not consulted", [[GW,
    "    if (hi === \"delivered\" || hi === \"read\") over = hi;", "    if (false) over = hi;"]], T],
  ["the D1 status log not written", [[ST,
    "export async function logMetaStatus(env: Env, ev: StatusEvent): Promise<void> {\n  if (!env.SIM_DB) return;",
    "export async function logMetaStatus(env: Env, ev: StatusEvent): Promise<void> {\n  if (env) return;"]], T],
  ["a row created after its «delivered» starts at «sent»", [[RC,
    "    if (hi === \"delivered\" || hi === \"read\") vals.x_status = hi;", "    if (false) vals.x_status = hi;"]], T],
  ["delivered after failed: the Discuss line not corrected", [[ST,
    "  if (row && applied && row.previous === \"failed\") {", "  if (false) {"]], T],
  ["the webhook writes the status directly (no guard, no log)", [["src/index.ts",
    "          await applyMetaStatus(env, { wamid, status: s2, recipient: String(to), metaTs, errText: errMsg }, ctx);",
    "          await (await import(\"./wa-message-send\")).updateWaStatusByWamid(env, wamid, s2, errMsg);"]], T],
  ["Meta's timestamp not logged", [["src/index.ts",
    "          const metaTs = Number(s?.timestamp) > 0 ? Number(s.timestamp) : null;", "          const metaTs = null;"]], T],
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
writeFileSync(new URL("./artifacts/s37-20260925-status-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
