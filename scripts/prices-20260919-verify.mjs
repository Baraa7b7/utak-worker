// Post-write verification for the 2026-09-19 fruit prices task.
//
// Reads every id recorded in prices-20260919-rollback.json's `after` block
// and prints a table:
//   الصنف | id | default_code | التعبئة والوزن | التكلفة | سعر البيع الفعلي
//
// Nothing is written. Safe to rerun.

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

function pad(s, n) {
  const str = String(s ?? "");
  // Rough visual width — Arabic glyphs and Latin count 1 char each; good enough.
  const w = [...str].length;
  return str + " ".repeat(Math.max(0, n - w));
}

async function main() {
  const rollbackPath = new URL("./artifacts/prices-20260919-rollback.json", import.meta.url).pathname;
  const rb = JSON.parse(readFileSync(rollbackPath, "utf8"));
  const priceIds = rb.after.created_daily_prices.map((r) => r.id);
  console.log(`Verify — reading ${priceIds.length} x_daily_price rows just written\n`);

  const rows = await call("x_daily_price", "read", {
    ids: priceIds,
    fields: [
      "id", "x_date", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id",
      "x_price_sar", "x_sale_price", "x_extraction_status", "x_is_simulation",
    ],
  });

  // Load related product + packaging info in bulk.
  const tmplIds = [...new Set(rows.map((r) => Array.isArray(r.x_product_tmpl_id) ? r.x_product_tmpl_id[0] : null).filter(Boolean))];
  const pkgIds  = [...new Set(rows.map((r) => Array.isArray(r.x_packaging_id) ? r.x_packaging_id[0] : null).filter(Boolean))];
  const tmpls = await call("product.template", "read", {
    ids: tmplIds, fields: ["id", "name", "default_code"],
  });
  const pkgs = await call("x_product_packaging", "read", {
    ids: pkgIds, fields: ["id", "x_name", "x_approx_weight_kg", "x_is_default"],
  });
  const tmplBy = new Map(tmpls.map((t) => [t.id, t]));
  const pkgBy  = new Map(pkgs.map((p) => [p.id, p]));

  // Header
  const H = ["الصنف", "id", "default_code", "التعبئة", "الوزن(kg)", "التكلفة", "سعر البيع"];
  console.log(pad(H[0], 14) + " | " + pad(H[1], 4) + " | " + pad(H[2], 14) + " | " + pad(H[3], 8) + " | " + pad(H[4], 10) + " | " + pad(H[5], 8) + " | " + pad(H[6], 10));
  console.log("-".repeat(90));

  rows.sort((a, b) => a.id - b.id);
  for (const r of rows) {
    const tid = Array.isArray(r.x_product_tmpl_id) ? r.x_product_tmpl_id[0] : null;
    const pid = Array.isArray(r.x_packaging_id) ? r.x_packaging_id[0] : null;
    const t = tid ? tmplBy.get(tid) : null;
    const p = pid ? pkgBy.get(pid) : null;
    console.log(
      pad(t?.name ?? "-", 14) + " | " +
      pad(r.id, 4) + " | " +
      pad(t?.default_code ?? "-", 14) + " | " +
      pad(p?.x_name ?? "-", 8) + " | " +
      pad(p?.x_approx_weight_kg ?? "-", 10) + " | " +
      pad(r.x_price_sar, 8) + " | " +
      pad(r.x_sale_price, 10),
    );
  }

  // Sanity: confirm today's date and single supplier
  const uniqDates = [...new Set(rows.map((r) => r.x_date))];
  const uniqSuppliers = [...new Set(rows.map((r) => Array.isArray(r.x_supplier_id) ? r.x_supplier_id[1] : "-"))];
  console.log(`\nDates: ${uniqDates.join(", ")}`);
  console.log(`Suppliers: ${uniqSuppliers.join(", ")}`);
  console.log(`x_is_simulation all-false: ${rows.every((r) => r.x_is_simulation === false)}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
