// Find test records left over from the previous cleanup (item10 seed):
//   - draft purchase.order with origin="UTAK-CLEANUP-TEST" for supplier أحمد (partner 30)
//   - draft account.move (out_invoice) with partner=31 dated 2026-09-19 with no invoice_date_due
// Prints candidate ids only; does not delete.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
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
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, { method: "POST", headers: h, body: JSON.stringify(b) });
  const t = await r.text(); let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
    throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message ?? String(t).slice(0, 300)}`);
  }
  return p;
}

// 1) Purchase orders with the sentinel origin left by item10-seed
const pos = await call("purchase.order", "search_read", {
  domain: [["origin", "=", "UTAK-CLEANUP-TEST"]],
  fields: ["id", "name", "state", "partner_id", "origin", "date_order", "amount_total", "create_uid", "create_date"],
});
console.log(`purchase.order candidates (origin=UTAK-CLEANUP-TEST):`);
for (const p of pos) console.log(`  ${JSON.stringify(p)}`);

// 2) All draft purchase.order for Ahmed created today for cross-check
const posAhmedDraft = await call("purchase.order", "search_read", {
  domain: [
    ["partner_id", "=", 30],
    ["state", "in", ["draft", "sent"]],
    ["create_date", ">=", "2026-09-19 00:00:00"],
  ],
  fields: ["id", "name", "state", "origin", "date_order", "create_date", "amount_total"],
  order: "id desc",
});
console.log(`\nAhmed draft purchase.order today:`);
for (const p of posAhmedDraft) console.log(`  ${JSON.stringify(p)}`);

// 3) Draft customer invoices to partner 31 (ابو مكين) with no VAT — those are the test ones
const invsCust31 = await call("account.move", "search_read", {
  domain: [
    ["partner_id", "=", 31],
    ["move_type", "=", "out_invoice"],
    ["state", "=", "draft"],
    ["create_date", ">=", "2026-09-19 00:00:00"],
  ],
  fields: ["id", "name", "state", "partner_id", "invoice_date", "amount_total", "amount_tax", "create_date"],
  order: "id desc",
});
console.log(`\naccount.move (customer 31) drafts today:`);
for (const inv of invsCust31) console.log(`  ${JSON.stringify(inv)}`);

// 4) Broader safety net: all draft out_invoice created today
const allDraftInvoices = await call("account.move", "search_read", {
  domain: [
    ["move_type", "=", "out_invoice"],
    ["state", "=", "draft"],
    ["create_date", ">=", "2026-09-19 00:00:00"],
  ],
  fields: ["id", "name", "state", "partner_id", "invoice_date", "amount_total", "create_date"],
  order: "id desc",
});
console.log(`\nAll customer draft invoices today:`);
for (const inv of allDraftInvoices) console.log(`  ${JSON.stringify(inv)}`);
