// Confirm invariants held by the refactor: x_daily_price for today,
// x_quotation, x_purchase_list, and cron counts should be unchanged.

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
  const today = new Date().toISOString().slice(0, 10);
  const daily = await call("x_daily_price", "search_count", { domain: [["x_date", "=", today]] });
  console.log(`x_daily_price today (${today}): ${daily}`);
  const quos = await call("x_quotation", "search_count", { domain: [] });
  console.log(`x_quotation total: ${quos}`);
  const pls = await call("x_purchase_list", "search_count", { domain: [] });
  console.log(`x_purchase_list total: ${pls}`);
  const crons = await call("ir.cron", "search_count", { domain: [] });
  console.log(`ir.cron total: ${crons}`);
  const packagings = await call("x_product_packaging", "search_count", { domain: [] });
  console.log(`x_product_packaging total: ${packagings}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
