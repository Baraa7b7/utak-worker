// Rollback for item3-set-purchase-method.mjs.
// Reads scripts/artifacts/item3-purchase-method-rollback.json and rewrites
// each UTAK product.template.purchase_method to whatever it was BEFORE the
// flip. Idempotent — safe to re-run.
//
// Does NOT touch any product that wasn't in the snapshot.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(m, met, b) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, {
    method: "POST", headers: h, body: JSON.stringify(b),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
    throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

const artifactPath = new URL("./artifacts/item3-purchase-method-rollback.json", import.meta.url);
let snap;
try { snap = JSON.parse(readFileSync(artifactPath, "utf8")); }
catch (e) { console.error(`cannot read ${artifactPath.pathname}: ${e.message}`); process.exit(1); }

console.log(`Restoring ${snap.before.length} product templates to their pre-flip purchase_method`);
console.log(`snapshot_at: ${snap.snapshot_at}`);

for (const p of snap.before) {
  await call("product.template", "write", {
    ids: [p.id], vals: { purchase_method: p.purchase_method },
  });
  console.log(`  id=${p.id} ${p.default_code} → ${p.purchase_method}`);
}
console.log("done.");
