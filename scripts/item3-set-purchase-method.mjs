// Item 3 (helper) — set product.template.purchase_method='purchase' on every
// UTAK product template so vendor bills created from a purchase.order pick
// up the ordered quantity rather than the received quantity.
//
// Why: UTAK's products are all type='consu' (consumables — no
// stock.picking + no stock.quant), so `purchase_method='receive'` (the
// Odoo default) never triggers because qty_received is stuck at 0. That
// leaves account.move.line.quantity=0 and amount_untaxed=0 — supplier
// debt never appears in accounting. UTAK operates as a distribution
// middleman (buy → invoice → deliver), so "bill on ordered" is the
// correct model here regardless of the vendor/inventory decision.
//
// Scope: every product.template with default_code starting "UTAK-". This
// covers the current 37 templates and stays targeted enough that a
// non-UTAK product added later stays on Odoo defaults.
//
// Rollback: written to
// scripts/artifacts/item3-purchase-method-rollback.json — snapshot of
// each (id, default_code, name, purchase_method) BEFORE. A companion
// rollback script reapplies the snapshot.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

const before = await call("product.template", "search_read", {
  domain: [["default_code", "=like", "UTAK-%"]],
  fields: ["id","name","default_code","purchase_method","type"],
});
console.log(`UTAK product templates: ${before.length}`);
const needsFlip = before.filter((p) => p.purchase_method !== "purchase");
console.log(`need flip (purchase_method != 'purchase'): ${needsFlip.length}`);
for (const p of needsFlip.slice(0,5)) console.log(`  id=${p.id} ${p.default_code} name=${p.name} current=${p.purchase_method}`);

// Snapshot for rollback
const artifactPath = new URL("./artifacts/item3-purchase-method-rollback.json", import.meta.url);
try { mkdirSync(dirname(artifactPath.pathname), { recursive: true }); } catch {}
writeFileSync(artifactPath, JSON.stringify({
  snapshot_at: new Date().toISOString(),
  before: before.map((p) => ({ id: p.id, default_code: p.default_code, name: p.name, purchase_method: p.purchase_method })),
}, null, 2));
console.log(`snapshot written to ${artifactPath.pathname}`);

if (needsFlip.length === 0) {
  console.log("nothing to flip. done.");
  process.exit(0);
}

const ids = needsFlip.map((p) => p.id);
await call("product.template", "write", { ids, vals: { purchase_method: "purchase" } });

const after = await call("product.template", "search_read", {
  domain: [["id", "in", ids]],
  fields: ["id","default_code","purchase_method"],
});
const stillWrong = after.filter((p) => p.purchase_method !== "purchase");
console.log(`\nAFTER: ${after.length} rows, ${stillWrong.length} still not on 'purchase'`);
if (stillWrong.length) { console.error("FAIL"); process.exit(2); }
console.log(`OK — ${ids.length} product templates flipped to purchase_method='purchase'`);
