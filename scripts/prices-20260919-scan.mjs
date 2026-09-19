// Read-only probe for the 2026-09-19 fruit prices task.
//
// Prints:
//   (a) All fields of the x_daily_price model (name/type/relation).
//   (b) product.template rows for رمان / موز / أفوكادو|افوكادو / بطيخ / حبحب.
//   (c) x_product_packaging rows attached to those templates.
//   (d) res.partner rows whose name matches "أحمد حسان".
//       If we find zero or >1 → halt so the user disambiguates.
//   (e) default_code samples for fruit templates, plus the last numeric
//       suffix used, so new SKUs can continue the pattern.
//
// No writes. Uses the same JSON-2 client / .env.sim-verify as item5-*.
//
// Output is human-readable AND also mirrored to
//   scripts/artifacts/prices-20260919-scan.json
// so the apply script can load a normalized version of the findings.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

function fmt(v) { return JSON.stringify(v); }

async function main() {
  const stamp = new Date().toISOString();
  console.log(`Scan — ${stamp}`);
  console.log(`Odoo: ${ODOO_URL}  db=${ODOO_DB}  login=${ODOO_LOGIN}`);
  const out = { generated_at: stamp };

  // (a) all fields of x_daily_price
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "x_daily_price"]],
    fields: ["id", "name", "field_description", "ttype", "relation", "required", "readonly", "store", "compute", "depends"],
    order: "name",
  });
  out.x_daily_price_fields = fields;
  console.log(`\n[a] x_daily_price fields (${fields.length}):`);
  for (const f of fields) {
    console.log(
      `   ${f.name.padEnd(28)} ${String(f.ttype).padEnd(10)} ` +
      `store=${f.store} readonly=${f.readonly} req=${f.required} ` +
      `compute=${f.compute ? JSON.stringify(String(f.compute).slice(0, 40)) : "-"}  ` +
      `rel=${f.relation || "-"}  desc=${f.field_description || ""}`
    );
  }

  // Also print fields of x_product_packaging for context
  const pkgFields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "x_product_packaging"]],
    fields: ["name", "field_description", "ttype", "relation"],
    order: "name",
  });
  out.x_product_packaging_fields = pkgFields;
  console.log(`\n[a+] x_product_packaging fields (${pkgFields.length}):`);
  for (const f of pkgFields) {
    console.log(`   ${f.name.padEnd(32)} ${String(f.ttype).padEnd(10)} ${f.relation || ""}  ${f.field_description || ""}`);
  }

  // (b) product.template rows: search by Arabic names (variants)
  const nameNeedles = ["رمان", "موز", "أفوكادو", "افوكادو", "بطيخ", "حبحب"];
  const orDomain = [];
  for (let i = 0; i < nameNeedles.length - 1; i++) orDomain.push("|");
  for (const n of nameNeedles) orDomain.push(["name", "ilike", n]);
  const products = await call("product.template", "search_read", {
    domain: orDomain,
    fields: ["id", "name", "default_code", "categ_id", "taxes_id", "supplier_taxes_id", "uom_id", "list_price", "sale_ok", "purchase_ok", "active"],
    order: "name",
  });
  out.products = products;
  console.log(`\n[b] product.template rows matching (${products.length}):`);
  for (const p of products) {
    console.log(
      `   id=${p.id}  name=${JSON.stringify(p.name)}  code=${p.default_code || "-"}  categ=${fmt(p.categ_id)}  ` +
      `taxes=${fmt(p.taxes_id)}  suppl_taxes=${fmt(p.supplier_taxes_id)}  uom=${fmt(p.uom_id)}  ` +
      `list_price=${p.list_price}  sale_ok=${p.sale_ok}  purchase_ok=${p.purchase_ok}  active=${p.active}`,
    );
  }

  // (c) packagings for those templates
  const tmplIds = products.map((p) => p.id);
  const packagings = tmplIds.length
    ? await call("x_product_packaging", "search_read", {
        domain: [["x_product_tmpl_id", "in", tmplIds]],
        fields: ["id", "x_name", "x_product_tmpl_id", "x_is_default", "x_approx_weight_kg"],
        order: "x_product_tmpl_id, id",
      })
    : [];
  out.packagings = packagings;
  console.log(`\n[c] x_product_packaging for those templates (${packagings.length}):`);
  for (const pk of packagings) {
    console.log(`   id=${pk.id}  tmpl=${fmt(pk.x_product_tmpl_id)}  name=${JSON.stringify(pk.x_name)}  default=${pk.x_is_default}  weight_kg=${fmt(pk.x_approx_weight_kg)}`);
  }

  // (d) supplier partner
  const supplierRows = await call("res.partner", "search_read", {
    domain: [["name", "ilike", "أحمد حسان"]],
    fields: ["id", "name", "supplier_rank", "customer_rank", "phone", "active"],
    order: "id",
  });
  out.supplier_matches = supplierRows;
  console.log(`\n[d] res.partner matches for "أحمد حسان" (${supplierRows.length}):`);
  for (const r of supplierRows) {
    console.log(`   id=${r.id}  name=${JSON.stringify(r.name)}  supplier_rank=${r.supplier_rank}  active=${r.active}  phone=${r.phone || "-"}`);
  }
  if (supplierRows.length !== 1) {
    console.log(`\n[d!] HALT — expected exactly 1 match, got ${supplierRows.length}. Fix before applying.`);
  }

  // (e) default_code pattern for fruit templates
  //     Find the fruit category first, then read code samples.
  const categIds = [...new Set(products.map((p) => Array.isArray(p.categ_id) ? p.categ_id[0] : null).filter(Boolean))];
  const cats = categIds.length
    ? await call("product.category", "read", { ids: categIds, fields: ["id", "name", "parent_id"] })
    : [];
  out.categories = cats;
  console.log(`\n[e] categories referenced by matched products:`);
  for (const c of cats) console.log(`   id=${c.id}  name=${JSON.stringify(c.name)}  parent=${fmt(c.parent_id)}`);

  // Since categ_id is often false on this tenant, also gather all UTAK-FRT-*
  // rows by SKU pattern to figure out the last numeric suffix.
  const fruitByCode = await call("product.template", "search_read", {
    domain: [["default_code", "=like", "UTAK-FRT-%"]],
    fields: ["id", "name", "default_code"],
    order: "default_code desc",
    limit: 200,
  });
  out.code_samples = fruitByCode;
  console.log(`\n[e+] product.template rows with SKU UTAK-FRT-* (desc, ${fruitByCode.length}):`);
  for (const r of fruitByCode) {
    console.log(`   id=${r.id}  code=${r.default_code || "-"}  name=${JSON.stringify(r.name)}`);
  }
  const nums = fruitByCode
    .map((r) => Number((r.default_code || "").replace(/^UTAK-FRT-/, "")))
    .filter((n) => Number.isFinite(n));
  const maxN = nums.length ? Math.max(...nums) : 0;
  out.last_fruit_sku_num = maxN;
  console.log(`\n[e!] highest UTAK-FRT-XXX numeric suffix in use: ${maxN}`);

  const outPath = new URL("./artifacts/prices-20260919-scan.json", import.meta.url).pathname;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nScan JSON → ${outPath}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
