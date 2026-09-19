// Pull the SALE_PDF_DOWNLOAD_TOKEN back out of the ir.actions.server row that
// `quotation-fix-20260919-apply.mjs` embedded it into. Prints token + latest
// sale.order id so we can hit /internal/sale-quotation-pdf.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

async function main() {
  const rows = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", "sale.quotation.pdf_download"]],
    fields: ["id","name","code"],
  });
  const row = rows[0];
  if (!row) { console.error("no such action"); process.exit(1); }
  const m = String(row.code).match(/token=([a-f0-9]{32,128})/i);
  if (!m) { console.error("no token in action code"); process.exit(1); }
  console.log(`SALE_PDF_DOWNLOAD_TOKEN=${m[1]}`);

  const latest = await call("sale.order", "search_read", {
    domain: [], fields: ["id","name"], order: "id desc", limit: 1,
  });
  if (latest[0]) console.log(`LATEST_SO_ID=${latest[0].id} LATEST_SO_NAME=${latest[0].name}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
