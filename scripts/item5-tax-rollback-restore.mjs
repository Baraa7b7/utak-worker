// Item 5 rollback — restore the 15% VAT default and the sale_project
// picker domain, using the snapshot at scripts/artifacts/item5-tax-rollback.json.
//
// Usage: node scripts/item5-tax-rollback-restore.mjs
//
// Idempotent. If a product row no longer exists it is skipped.
// The override view "utak.sale.order.line.form.no_service_filter"
// is unlinked; sale_project's own view 2431 keeps its
// [('type','=','service')] domain — the standard sale_project behaviour.

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
  const rbPath = new URL("./artifacts/item5-tax-rollback.json", import.meta.url).pathname;
  const rb = JSON.parse(readFileSync(rbPath, "utf8"));
  console.log(`Restoring from ${rbPath} (snapshot ${rb.generated_at})`);

  // A) restore company defaults
  const co = rb.company;
  const saleTaxId = Array.isArray(co.account_sale_tax_id) ? co.account_sale_tax_id[0] : false;
  const purchaseTaxId = Array.isArray(co.account_purchase_tax_id) ? co.account_purchase_tax_id[0] : false;
  await call("res.company", "write", {
    ids: [co.id],
    vals: { account_sale_tax_id: saleTaxId, account_purchase_tax_id: purchaseTaxId },
  });
  console.log(`[A] restored res.company id=${co.id}: sale=${saleTaxId} purchase=${purchaseTaxId}`);

  // B+C) restore per-product taxes_id and supplier_taxes_id
  let restored = 0;
  for (const p of rb.products) {
    const salesTaxIds = Array.isArray(p.taxes_id) ? p.taxes_id : [];
    const suppTaxIds  = Array.isArray(p.supplier_taxes_id) ? p.supplier_taxes_id : [];
    try {
      await call("product.template", "write", {
        ids: [p.id],
        vals: {
          taxes_id: [[6, 0, salesTaxIds]],
          supplier_taxes_id: [[6, 0, suppTaxIds]],
        },
      });
      restored++;
    } catch (e) {
      console.log(`  skip product ${p.id} (${p.name}): ${e.message.slice(0, 120)}`);
    }
  }
  console.log(`[B+C] restored taxes on ${restored} product.template rows`);

  // D) drop the override view
  const overrides = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", "utak.sale.order.line.form.no_service_filter"]],
    fields: ["id"],
  });
  if (overrides.length > 0) {
    await call("ir.ui.view", "unlink", { ids: overrides.map((v) => v.id) });
    console.log(`[D] unlinked override view id=${overrides.map((v) => v.id).join(",")}`);
  } else {
    console.log("[D] override view not present — nothing to unlink");
  }
  console.log("DONE.");
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
