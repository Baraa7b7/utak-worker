// Apply the proposed English names for products + packagings.
//
// Reads scripts/artifacts/english-names-proposed.json and, for each row with
// `apply: true`, writes x_name_en on the matching Odoo record.
//
// DEFAULT MODE: dry-run. Pass --apply to actually write.
//
// !!! IMPORTANT: Baraa reviews and edits english-names-proposed.json BEFORE
// running with --apply. This script never runs itself; it only executes when
// Baraa is ready.
//
// Rollback: this script writes x_name_en only. To undo, set the same rows'
// x_name_en back to "" — the reverse-JSON in
// scripts/artifacts/english-names-apply-log.json records what was changed
// (or would be) so a manual revert is a single search.

import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const proposalsPath = new URL("./artifacts/english-names-proposed.json", import.meta.url).pathname;
const proposals = JSON.parse(readFileSync(proposalsPath, "utf8"));

async function writeName(model, id, x_name_en, arCurrent) {
  if (!APPLY) {
    console.log(`  [dry-run] ${model}#${id} ${arCurrent} → ${x_name_en}`);
    return { model, id, x_name_en, before: null, applied: false };
  }
  // Read the current value so the rollback log is complete.
  const [row] = await call(model, "read", { ids: [id], fields: ["x_name_en"] });
  const before = row?.x_name_en ?? null;
  await call(model, "write", { ids: [id], vals: { x_name_en } });
  console.log(`  ${model}#${id} ${arCurrent} → ${x_name_en} (was: ${before || "<empty>"})`);
  return { model, id, x_name_en, before, applied: true };
}

async function main() {
  console.log(`=== apply-english-names (${APPLY ? "APPLY" : "dry-run"}) ===`);
  const log = { generated_at: new Date().toISOString(), applied: APPLY, changes: [] };

  console.log("\nProducts:");
  for (const p of proposals.products) {
    if (!p.apply || !p.x_name_en) continue;
    const change = await writeName("product.template", p.id, p.x_name_en, p.ar);
    log.changes.push(change);
  }

  console.log("\nPackagings:");
  for (const p of proposals.packagings) {
    if (!p.apply || !p.x_name_en) continue;
    const change = await writeName("x_product_packaging", p.id, p.x_name_en, p.ar);
    log.changes.push(change);
  }

  const logPath = new URL("./artifacts/english-names-apply-log.json", import.meta.url).pathname;
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\nWrote log: ${logPath}`);
  if (!APPLY) console.log("\nDry-run only. Rerun with --apply to actually write.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
