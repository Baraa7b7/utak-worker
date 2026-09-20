// Item 5 (2026-09-18) — remove default 15% VAT from the sale flow, and
// neutralize sale_project's [('type','=','service')] domain on the
// sale.order.line product picker.
//
// Diagnosed sources (see docs/merge-debt.md for details):
//   TAX  (A) res.company.account_sale_tax_id = [5,"15%"]  (default for new products)
//   TAX  (B) product.template.taxes_id       = [5]         (explicit, on every UTAK sku)
//   TAX  (C) product.template.supplier_taxes_id = [21]     (purchase side, mirrored)
//   PICK (D) ir.ui.view id=2431 (sale_project.sale_order_line_view_form_editable)
//            adds [('type','=','service')] to <field name="product_id"/> — this
//            is why the standalone-form picker on a sale.order.line hides UTAK
//            consumables. sale_project ships this view for its own use; we
//            override it with a higher-priority inherit view.
//
// This script:
//   1. Prints BEFORE snapshot (company defaults, per-product taxes, view 2431).
//   2. Writes a rollback JSON to scripts/artifacts/item5-tax-rollback.json.
//   3. Clears (A), (B), (C).
//   4. Creates a new inherit view "utak.sale.order.line.form.no_service_filter"
//      with priority=1000 that resets product_id domain to [('sale_ok','=',True)].
//   5. Prints AFTER snapshot.
//
// Nothing is deleted from account.tax. Reactivate by rerunning
// scripts/item5-tax-rollback-restore.mjs against the same rollback JSON.
//
// READ path is limited to the 37 product.template rows on this tenant, plus
// res.company id=1 and view id=2431. Nothing else is touched.

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

function writeRollback(json, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

async function main() {
  const rollbackPath = new URL("./artifacts/item5-tax-rollback.json", import.meta.url).pathname;
  const stamp = new Date().toISOString();
  console.log(`Item 5 apply — ${stamp}`);

  // ---------- BEFORE ----------
  const before = { generated_at: stamp };
  before.company = (await call("res.company", "read", {
    ids: [1],
    fields: ["id", "name", "account_sale_tax_id", "account_purchase_tax_id"],
  }))[0];
  before.products = await call("product.template", "search_read", {
    domain: [], fields: ["id", "name", "taxes_id", "supplier_taxes_id"],
    order: "id",
  });
  const view2431 = await call("ir.ui.view", "search_read", {
    domain: [["id", "=", 2431]], fields: ["id", "name", "priority", "arch"],
  });
  before.view_2431 = view2431[0] ?? null;
  const existingOverride = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", "utak.sale.order.line.form.no_service_filter"]],
    fields: ["id", "name", "priority", "inherit_id", "active"],
  });
  before.existing_override_view = existingOverride;
  console.log("[BEFORE]");
  console.log("  company:", JSON.stringify(before.company));
  console.log(`  products with taxes_id set: ${before.products.filter((p) => Array.isArray(p.taxes_id) && p.taxes_id.length > 0).length} / ${before.products.length}`);
  console.log(`  view 2431 priority: ${before.view_2431?.priority} — first 200 chars of arch:`);
  console.log("    ", String(before.view_2431?.arch ?? "").slice(0, 200));
  console.log(`  existing override view: ${JSON.stringify(existingOverride)}`);

  writeRollback(before, rollbackPath);
  console.log(`\nRollback JSON written to: ${rollbackPath}\n`);

  // ---------- APPLY ----------
  // (A) Clear company defaults so a NEW product created with no taxes_id
  //     doesn't get 15% VAT stamped on it.
  await call("res.company", "write", {
    ids: [1],
    vals: { account_sale_tax_id: false, account_purchase_tax_id: false },
  });
  console.log("[A] cleared res.company.account_sale_tax_id and account_purchase_tax_id");

  // (B) & (C) Clear every existing product.template.taxes_id / supplier_taxes_id.
  // Odoo m2m write ops: [[6, 0, []]] replaces the set with empty.
  const productIds = before.products.map((p) => p.id);
  await call("product.template", "write", {
    ids: productIds,
    vals: { taxes_id: [[6, 0, []]], supplier_taxes_id: [[6, 0, []]] },
  });
  console.log(`[B+C] cleared taxes_id and supplier_taxes_id on ${productIds.length} product.template rows`);

  // (D) Create an inherit view on sale.order.line.form.readonly (id=1256)
  //     that outranks sale_project's view 2431 (priority=999). We reset the
  //     product_id domain to the standard [('sale_ok','=',True)].
  let overrideId;
  if (existingOverride.length > 0) {
    overrideId = existingOverride[0].id;
    await call("ir.ui.view", "write", {
      ids: [overrideId],
      vals: {
        priority: 1000,
        active: true,
        arch_base: `<data>
  <field name="product_id" position="attributes">
    <attribute name="domain">[('sale_ok', '=', True)]</attribute>
  </field>
</data>`,
      },
    });
    console.log(`[D] updated existing override view id=${overrideId}`);
  } else {
    const created = await call("ir.ui.view", "create", {
      vals_list: [{
        name: "utak.sale.order.line.form.no_service_filter",
        model: "sale.order.line",
        inherit_id: 1256,
        priority: 1000,
        active: true,
        arch_base: `<data>
  <field name="product_id" position="attributes">
    <attribute name="domain">[('sale_ok', '=', True)]</attribute>
  </field>
</data>`,
      }],
    });
    overrideId = created[0];
    console.log(`[D] created override view id=${overrideId}`);
  }

  // ---------- AFTER ----------
  const afterCompany = (await call("res.company", "read", {
    ids: [1],
    fields: ["id", "name", "account_sale_tax_id", "account_purchase_tax_id"],
  }))[0];
  const stillHaveTaxes = await call("product.template", "search_count", {
    domain: ["|", ["taxes_id", "!=", false], ["supplier_taxes_id", "!=", false]],
  });
  const overrideAfter = await call("ir.ui.view", "read", {
    ids: [overrideId],
    fields: ["id", "name", "priority", "active", "inherit_id"],
  });
  console.log("\n[AFTER]");
  console.log("  company:", JSON.stringify(afterCompany));
  console.log(`  product.template rows still carrying any tax: ${stillHaveTaxes}`);
  console.log("  override view:", JSON.stringify(overrideAfter));

  console.log(`\nOK. Rollback JSON stored at ${rollbackPath}`);
  console.log("Restore command: node scripts/item5-tax-rollback-restore.mjs");
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
