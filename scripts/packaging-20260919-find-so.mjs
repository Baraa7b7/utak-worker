// Find the latest sale.order with at least one line that has a packaging,
// so we can hit /internal/sale-quotation-pdf and verify the unit column.

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
  const orders = await call("sale.order", "search_read", {
    domain: [],
    fields: ["id","name","partner_id","order_line","date_order","state","create_date"],
    order: "id desc",
    limit: 10,
  });
  console.log(`most recent 10 sale.orders (id desc):`);
  for (const o of orders) {
    const linesN = Array.isArray(o.order_line) ? o.order_line.length : 0;
    console.log(`  #${o.id} ${o.name} partner=${JSON.stringify(o.partner_id)} lines=${linesN} state=${o.state} date=${o.date_order}`);
  }
  // Find the newest one with lines that have x_packaging_id set.
  for (const o of orders) {
    if (!Array.isArray(o.order_line) || o.order_line.length === 0) continue;
    const lines = await call("sale.order.line", "read", {
      ids: o.order_line,
      fields: ["id","product_id","product_uom_qty","x_packaging_id","price_unit"],
    });
    const withPack = lines.filter((l) => l.x_packaging_id).length;
    console.log(`  sale.order #${o.id}: ${lines.length} lines, ${withPack} with packaging`);
    if (withPack > 0) {
      console.log(`  → candidate: SO id=${o.id}, name=${o.name}`);
      for (const l of lines) {
        console.log(`    line#${l.id} product=${JSON.stringify(l.product_id)} pack=${JSON.stringify(l.x_packaging_id)} qty=${l.product_uom_qty}`);
      }
      break;
    }
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
