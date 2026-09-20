// Item 2b — hide standard sale-order print reports from the sale.order form
// Print menu so no un-branded Odoo PDF can be sent to a UTAK customer.
//
// Approach: set binding_model_id=False on the two ir.actions.report rows that
// currently bind to sale.order. The report *definitions* are kept (id=433,
// 434, 477 stay), only their menu binding is removed. UTAK still uses its
// own PDF pipeline (renderPDFShell + Gotenberg + R2) unaffected.
//
// Rollback: write binding_model_id back to sale.order's model id (2731):
//   ir.actions.report.write([477], {binding_model_id: 2731, binding_type: "report"});
//   ir.actions.report.write([434], {binding_model_id: 2731, binding_type: "report"});

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
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: missing Odoo creds");
  process.exit(1);
}

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
async function call(model, method, body) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers: h, body: JSON.stringify(body),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(model, method, body); }
    throw new Error(`HTTP ${r.status} ${model}.${method}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

const TARGETS = [
  { id: 477, name: "Quotation / Order (sale.report_saleorder_raw)" },
  { id: 434, name: "PRO FORMA Invoice (sale.report_saleorder_pro_forma)" },
];

const before = await call("ir.actions.report", "search_read", {
  domain: [["id", "in", TARGETS.map((t) => t.id)]],
  fields: ["id", "name", "report_name", "binding_model_id", "binding_type"],
});
console.log("BEFORE:");
for (const r of before) {
  console.log(`  id=${r.id} name=${r.name} bind=${JSON.stringify(r.binding_model_id)} type=${r.binding_type}`);
}

for (const t of TARGETS) {
  await call("ir.actions.report", "write", {
    ids: [t.id],
    vals: { binding_model_id: false },
  });
  console.log(`unbound id=${t.id}`);
}

const after = await call("ir.actions.report", "search_read", {
  domain: [["id", "in", TARGETS.map((t) => t.id)]],
  fields: ["id", "name", "binding_model_id", "binding_type"],
});
console.log("\nAFTER:");
for (const r of after) {
  console.log(`  id=${r.id} name=${r.name} bind=${JSON.stringify(r.binding_model_id)} type=${r.binding_type}`);
}

const stillBound = after.filter((r) => r.binding_model_id !== false);
if (stillBound.length) {
  console.error(`FAIL: ${stillBound.length} report(s) still bound`);
  process.exit(2);
}
console.log("\nBoth standard sale-order print reports are now unbound. UTAK PDF pipeline unaffected.");
