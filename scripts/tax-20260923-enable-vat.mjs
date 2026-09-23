// UTAK — enable 15% VAT in Odoo, 2026-09-23 (effective 2026-10-01 Riyadh).
//
// Locked decisions (Baraa, 2026-09-23):
//   • 15% on every product, sale and purchase.
//   • Displayed sale prices are TAX-INCLUDED: the sale price is treated as
//     gross and the invoice splits it into net + VAT, so the customer pays
//     exactly what they paid before activation for the same price.
//   • The Worker decides per invoice date (src/config.ts VAT_EFFECTIVE_DATE_RIYADH):
//     before the cutoff tax_ids stay empty; from it the company sale tax.
//   • No e-invoicing, no l10n_sa_edi, no QR here.
//
// What this script writes (only these, nothing else):
//   1. res.company(1).vat                    ← UTAK_VAT_NUMBER (env var or
//      untracked .env.vat), ONLY if provided and valid; otherwise untouched
//      and reported.
//   2. res.company(1).account_sale_tax_id    ← sale 15%     (id resolved live)
//      res.company(1).account_purchase_tax_id← purchase 15% (id resolved live)
//   3. res.company(1).tax_calculation_rounding_method ← round_per_line, so the
//      invoice VAT equals the sum of per-line VAT (same rule the Worker uses
//      for x_invoice — src/accounting.ts splitTaxInclusive).
//   4. account.tax(sale 15%).price_include_override ← "tax_included".
//      Odoo 19: `price_include` is a computed, read-only boolean; the stored
//      field is `price_include_override` (selection tax_included /
//      tax_excluded, false = follow company account_price_include). The
//      company default stays "tax_excluded" and the purchase tax is left on
//      the default (supplier prices are net).
//   5. product.template(all 40).taxes_id          ← [sale 15%]
//      product.template(all 40).supplier_taxes_id ← [purchase 15%]
//
// Idempotent: values already on target are skipped.
// Rollback snapshot (first run only, never overwritten):
//   scripts/artifacts/tax-20260923-enable-vat-rollback.json
// Restore:  node scripts/tax-20260923-enable-vat.mjs --rollback
// Read-only preview: --dry-run
//
// Shared tenant (sim + prod): these are configuration writes, no journal
// entry is created by this script.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const readEnvFile = (rel) => {
  const u = new URL(rel, import.meta.url);
  if (!existsSync(u)) return {};
  return Object.fromEntries(
    readFileSync(u, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
};
const env = readEnvFile("../.env.sim-verify");
const { ODOO_URL, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_API_KEY) throw new Error(".env.sim-verify missing ODOO_URL / ODOO_API_KEY");

async function call(model, method, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
      body: JSON.stringify(body),
    });
    const t = await res.text();
    if (res.status === 429 && attempt < 8) {
      const wait = 2000 * 2 ** Math.min(attempt, 4);
      console.log(`  … 429 on ${model}.${method}, retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${model}.${method} HTTP ${res.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
  }
}

const ROLLBACK = new URL("./artifacts/tax-20260923-enable-vat-rollback.json", import.meta.url);
const COMPANY_ID = 1;
const COMPANY_FIELDS = ["id", "vat", "account_sale_tax_id", "account_purchase_tax_id", "tax_calculation_rounding_method", "account_price_include"];
const TAX_FIELDS = ["id", "name", "type_tax_use", "amount", "amount_type", "price_include", "price_include_override", "active", "company_id"];

/** Saudi VAT number: 15 digits, starts and ends with 3. */
const VAT_RE = /^3\d{13}3$/;

function vatFromEnvironment() {
  const fromProc = (process.env.UTAK_VAT_NUMBER ?? "").trim();
  if (fromProc) return { value: fromProc, source: "env UTAK_VAT_NUMBER" };
  const fromFile = (readEnvFile("../.env.vat").UTAK_VAT_NUMBER ?? "").trim();
  if (fromFile) return { value: fromFile, source: ".env.vat" };
  return { value: "", source: "none" };
}

/** The one active 15% percent tax of a given use on the company — refuses ambiguity. */
async function findTax(use) {
  const rows = await call("account.tax", "search_read", {
    domain: [["type_tax_use", "=", use], ["amount", "=", 15], ["amount_type", "=", "percent"],
             ["company_id", "=", COMPANY_ID], ["active", "=", true], ["name", "=", "15%"]],
    fields: TAX_FIELDS,
  });
  if (rows.length !== 1) throw new Error(`expected exactly one active ${use} tax named "15%", got ${rows.length}: ${JSON.stringify(rows.map((r) => r.id))}`);
  return rows[0];
}

async function readState() {
  const [company] = await call("res.company", "read", { ids: [COMPANY_ID], fields: COMPANY_FIELDS });
  const sale = await findTax("sale");
  const purchase = await findTax("purchase");
  const products = await call("product.template", "search_read", {
    domain: [],
    fields: ["id", "name", "taxes_id", "supplier_taxes_id", "active"],
    context: { active_test: false },
    order: "id",
    limit: 1000,
  });
  return { company, sale, purchase, products };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

async function rollback() {
  if (!existsSync(ROLLBACK)) throw new Error("no rollback file — nothing to restore");
  const snap = JSON.parse(readFileSync(ROLLBACK, "utf8"));
  const c = snap.company;
  await call("res.company", "write", {
    ids: [COMPANY_ID],
    vals: {
      vat: c.vat || false,
      account_sale_tax_id: c.account_sale_tax_id ? c.account_sale_tax_id[0] : false,
      account_purchase_tax_id: c.account_purchase_tax_id ? c.account_purchase_tax_id[0] : false,
      tax_calculation_rounding_method: c.tax_calculation_rounding_method,
    },
  });
  console.log(`  company restored: vat=${c.vat} sale=${JSON.stringify(c.account_sale_tax_id)} purchase=${JSON.stringify(c.account_purchase_tax_id)} rounding=${c.tax_calculation_rounding_method}`);
  await call("account.tax", "write", { ids: [snap.sale.id], vals: { price_include_override: snap.sale.price_include_override || false } });
  console.log(`  tax ${snap.sale.id} price_include_override → ${snap.sale.price_include_override || "false"}`);
  for (const p of snap.products) {
    await call("product.template", "write", {
      ids: [p.id],
      vals: { taxes_id: [[6, 0, p.taxes_id]], supplier_taxes_id: [[6, 0, p.supplier_taxes_id]] },
      context: { active_test: false },
    });
  }
  console.log(`  ${snap.products.length} products restored to their snapshot taxes`);
  console.log("✅ rollback done");
}

async function main() {
  const mode = process.argv.includes("--rollback") ? "rollback" : process.argv.includes("--dry-run") ? "dry-run" : "apply";
  console.log(`tax-20260923-enable-vat — ${new Date().toISOString()} — mode=${mode}`);
  if (mode === "rollback") return rollback();

  const before = await readState();
  const { company, sale, purchase, products } = before;
  console.log(`  company.vat = ${company.vat || "(empty)"}`);
  console.log(`  company sale/purchase tax = ${JSON.stringify(company.account_sale_tax_id)} / ${JSON.stringify(company.account_purchase_tax_id)}`);
  console.log(`  company rounding = ${company.tax_calculation_rounding_method}, account_price_include = ${company.account_price_include}`);
  console.log(`  sale tax ${sale.id} "${sale.name}" price_include=${sale.price_include} override=${sale.price_include_override}`);
  console.log(`  purchase tax ${purchase.id} "${purchase.name}" price_include=${purchase.price_include} override=${purchase.price_include_override}`);
  console.log(`  products: ${products.length}, with sale tax ${products.filter((p) => p.taxes_id.length).length}, with purchase tax ${products.filter((p) => p.supplier_taxes_id.length).length}`);

  if (mode === "apply") {
    if (!existsSync(ROLLBACK)) {
      writeFileSync(ROLLBACK, JSON.stringify({ taken_at: new Date().toISOString(), ...before }, null, 2));
      console.log(`  snapshot → ${ROLLBACK.pathname}`);
    } else {
      console.log("  snapshot exists — kept (first-run values)");
    }
  }
  const write = async (label, model, ids, vals) => {
    if (mode === "dry-run") { console.log(`  [dry-run] ${label}`); return; }
    await call(model, "write", { ids, vals });
    console.log(`  ${label}`);
  };

  // 1. VAT number
  const vat = vatFromEnvironment();
  const report = { vat: { current: company.vat || null, source: vat.source, action: "" } };
  if (!vat.value) {
    report.vat.action = company.vat ? "kept (no env value supplied)" : "MISSING — no env value supplied";
    console.log(`  vat: no UTAK_VAT_NUMBER supplied — ${report.vat.action}`);
  } else if (!VAT_RE.test(vat.value)) {
    throw new Error(`UTAK_VAT_NUMBER from ${vat.source} is not a 15-digit Saudi VAT number (3…3) — refusing`);
  } else if (vat.value === company.vat) {
    report.vat.action = "already equal";
    console.log(`  vat: already ${company.vat} — skip`);
  } else {
    await write(`vat: ${company.vat || "(empty)"} → ${vat.value} (from ${vat.source})`, "res.company", [COMPANY_ID], { vat: vat.value });
    report.vat.action = "written";
  }

  // 2 + 3. Company defaults
  const companyVals = {};
  if ((company.account_sale_tax_id?.[0] ?? null) !== sale.id) companyVals.account_sale_tax_id = sale.id;
  if ((company.account_purchase_tax_id?.[0] ?? null) !== purchase.id) companyVals.account_purchase_tax_id = purchase.id;
  if (company.tax_calculation_rounding_method !== "round_per_line") companyVals.tax_calculation_rounding_method = "round_per_line";
  if (Object.keys(companyVals).length) await write(`company ← ${JSON.stringify(companyVals)}`, "res.company", [COMPANY_ID], companyVals);
  else console.log("  company defaults already on target — skip");

  // 4. Sale tax is price-included
  if (sale.price_include_override !== "tax_included") {
    await write(`tax ${sale.id} price_include_override: ${sale.price_include_override} → tax_included`, "account.tax", [sale.id], { price_include_override: "tax_included" });
  } else console.log(`  tax ${sale.id} already tax_included — skip`);

  // 5. Products
  let changed = 0;
  for (const p of products) {
    const vals = {};
    if (!sameSet(p.taxes_id, [sale.id])) vals.taxes_id = [[6, 0, [sale.id]]];
    if (!sameSet(p.supplier_taxes_id, [purchase.id])) vals.supplier_taxes_id = [[6, 0, [purchase.id]]];
    if (!Object.keys(vals).length) continue;
    changed++;
    if (mode === "dry-run") continue;
    await call("product.template", "write", { ids: [p.id], vals, context: { active_test: false } });
  }
  console.log(`  products changed: ${changed} of ${products.length}${mode === "dry-run" ? " (dry-run, not written)" : ""}`);
  if (mode === "dry-run") return;

  // Verify
  const after = await readState();
  let ok = true;
  const chk = (label, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
  chk(`company.account_sale_tax_id = ${sale.id}`, after.company.account_sale_tax_id?.[0] === sale.id);
  chk(`company.account_purchase_tax_id = ${purchase.id}`, after.company.account_purchase_tax_id?.[0] === purchase.id);
  chk("company rounding = round_per_line", after.company.tax_calculation_rounding_method === "round_per_line");
  chk(`sale tax ${sale.id} price_include = true (override tax_included)`, after.sale.price_include === true && after.sale.price_include_override === "tax_included");
  chk(`purchase tax ${purchase.id} unchanged (price_include=${after.purchase.price_include})`, after.purchase.price_include === purchase.price_include);
  chk(`all ${after.products.length} products carry sale tax ${sale.id}`, after.products.every((p) => sameSet(p.taxes_id, [sale.id])));
  chk(`all ${after.products.length} products carry purchase tax ${purchase.id}`, after.products.every((p) => sameSet(p.supplier_taxes_id, [purchase.id])));
  chk(`company.vat present (${after.company.vat || "empty"})`, !!after.company.vat);
  const out = new URL(`./artifacts/tax-20260923-enable-vat-apply-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), report, products_changed: changed, after: { company: after.company, sale: after.sale, purchase: after.purchase } }, null, 2));
  console.log(`  report → ${out.pathname}`);
  if (!ok) { console.error("VERIFY FAILED"); process.exit(1); }
  console.log("✅ VAT configuration in place");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
