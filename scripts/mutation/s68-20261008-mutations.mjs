// Mutation check for § 68 (2026-10-08) — the hook secret of Odoo's buttons, and the employee's file:
//   أ  the token of Odoo's buttons is its own secret (src/hook-auth.ts, the routes of src/index.ts)
// Each mutation disables ONE guard, runs the test file named with it, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s68-20261008-mutations.mjs [أ]     (no argument: every part)
//
// Out: scripts/artifacts/s68-20261008-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TH = "tests/s68-hook.test.mts";
const HA = "src/hook-auth.ts", IDX = "src/index.ts";
const GATE = "      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {";
const OPEN = "      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (false) {";
/** One route's own gate, switched off. */
const route = (path) => ["أ", `${path} is open without the token`, [[IDX, `url.pathname === "${path}") {\n${GATE}`, `url.pathname === "${path}") {\n${OPEN}`]], TH];

const M = [
  // ---------------------------------------------------------------- أ: the secret
  ["أ", "a short secret is a secret", [[HA, "  if (s.length < HOOK_SECRET_MIN) return \"\";\n", ""]], TH],
  ["أ", "the Odoo API key may be the hook secret", [[HA, "  if (s === env.ODOO_API_KEY) return \"\";\n", ""]], TH],
  ["أ", "a worker without its secret accepts the empty token", [[HA, "  return secret !== \"\" && tokensEqual(provided, secret);", "  return tokensEqual(provided, secret);"]], TH],
  ["أ", "a token of the right length opens", [[HA, "  return diff === 0;", "  return true;"]], TH],
  ["أ", "the start of the secret opens", [[HA, "  if (a.length !== b.length) return false;\n", ""]], TH],
  ["أ", "the secret's minimum is a character", [[HA, "export const HOOK_SECRET_MIN = 32;", "export const HOOK_SECRET_MIN = 1;"]], TH],
  // PHASE 3 — the token of before
  ["أ", "the token of before opens again", [[HA, "  return secret !== \"\" && tokensEqual(provided, secret);", "  return (secret !== \"\" && tokensEqual(provided, secret)) || tokensEqual(provided, String((env as unknown as Record<string, string>).ODOO_HOOK_TOKEN ?? \"-\"));"]], TH],
  // the routes
  ["أ", "the two quotation sends are not behind the secret", [[HA, "  return pathname.startsWith(\"/odoo/hook/\") || pathname === \"/internal/quotation-wa-send\" || pathname === \"/internal/sale-quotation-wa-send\";", "  return pathname.startsWith(\"/odoo/hook/\");"]], TH],
  ["أ", "probe=1 answers without checking the token", [[IDX, "      if (!hookTokenOk(env, url.searchParams.get(\"token\") ?? \"\")) return json({ error: \"unauthorized\" }, 401);\n", ""]], TH],
  ["أ", "probe=1 opens outside the hook's routes", [[IDX, "    if (url.searchParams.get(\"probe\") === \"1\" && isHookGated(url.pathname)) {", "    if (url.searchParams.get(\"probe\") === \"1\") {"]], TH],
  ["أ", "probe=1 lets the route run", [[IDX, "      return json({ ok: true, probe: true });\n", ""]], TH],
  route("/odoo/hook/wa-template-sync"), route("/odoo/hook/wa"), route("/internal/quotation-wa-send"), route("/internal/sale-quotation-wa-send"),
  route("/odoo/hook/wa-inbox"), route("/odoo/hook/wa-inbox-partner"), route("/odoo/hook/team-roster"), route("/odoo/hook/special-quote"), route("/odoo/hook/supplier"),
  ["أ", "the admin's template sync is open without the token", [[IDX, "      const providedToken = request.headers.get(\"x-admin-token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {", "      const providedToken = request.headers.get(\"x-admin-token\") ?? \"\";\n      if (false) {"]], TH],
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
writeFileSync(new URL("../artifacts/s68-20261008-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
