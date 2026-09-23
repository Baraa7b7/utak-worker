// UTAK — purchase → accounting setup, 2026-09-23.
//
// Wires x_purchase_list → purchase.order → vendor bill (account.move
// in_invoice). This script only prepares Odoo; the Worker code lives in
// src/purchase-accounting.ts and runs behind ACCOUNTING_SYNC.
//
// 1. VERIFY (read only, STOP on mismatch):
//      • purchase journal BILL exists, default account 400001
//      • 400001 is expense_direct_cost
//      • 201002 is liability_payable and is the supplier payable
//        (property_account_payable_id on the real supplier 30)
// 2. x_purchase_list gets three many2one fields (ir.model.fields, manual):
//      x_supplier_id       → res.partner    (who was paid; decision 2026-09-23)
//      x_purchase_order_id → purchase.order
//      x_account_move_id   → account.move
//    The paid price per item lives in x_aggregated_items[].unit_price (JSON),
//    pre-filled at 21:15 from x_daily_price and editable before closing.
// 3. Service product «بضاعة مشتراة (وسيط)» (default_code UTAK-PUR-GOODS):
//    type service → button_confirm creates NO stock.picking (purchase_stock
//    creates receipts for every goods/consu product, and product types must
//    not change). Expense account 400001, no default taxes (the Worker pins
//    tax_ids on every line), purchase_method = purchase (bill on ordered qty),
//    sale_ok = false.
// 4. Tax-INCLUDED twin of the company purchase tax (21 «15%», tax_excluded):
//    copy() keeps the repartition lines (104041 VAT Input) and report tags;
//    only price_include_override = tax_included differs. Decision: a VAT-
//    registered supplier's price already contains 15%, so 115 → 100 + 15
//    exactly. With the excluded tax 21 the net would have to be rounded first
//    and net + tax can miss the paid amount by a halala. Tax 21 itself is
//    NOT touched (manual Odoo POs keep today's behaviour). The Worker finds
//    the twin at run time from res.company.account_purchase_tax_id — no id in
//    code.
//
// Idempotent: every step searches first. Snapshot of created ids:
//   scripts/artifacts/acct-20260923-purchase-setup-rollback.json
// Flags:
//   --dry-run   print the plan, write nothing
//   --rollback  undo: fields unlinked, product + tax unlinked (archived if
//               Odoo refuses because posted moves reference them)
//
// Requires .env.sim-verify.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;
async function call(model, method, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
      body: JSON.stringify(body),
    });
    const t = await res.text();
    if (res.status === 429 && attempt < 6) {
      const wait = 2000 * 2 ** Math.min(attempt, 4);
      console.log(`  … 429 on ${model}.${method}, retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${model}.${method} HTTP ${res.status}: ${t.slice(0, 400)}`);
    return JSON.parse(t);
  }
}

const ROLLBACK = new URL("./artifacts/acct-20260923-purchase-setup-rollback.json", import.meta.url);
const DRY = process.argv.includes("--dry-run");
const MODE = process.argv.includes("--rollback") ? "rollback" : "apply";

const FIELDS = [
  { name: "x_supplier_id", relation: "res.partner", field_description: "المورد (المدفوع له)" },
  { name: "x_purchase_order_id", relation: "purchase.order", field_description: "أمر الشراء" },
  { name: "x_account_move_id", relation: "account.move", field_description: "فاتورة المورد" },
];
const PRODUCT_CODE = "UTAK-PUR-GOODS";
const PRODUCT_NAME = "بضاعة مشتراة (وسيط)";
const TAX_TWIN_NAME = "15% شامل (مشتريات)";

function stop(msg) { console.error(`STOP: ${msg}`); process.exit(1); }

async function verify() {
  console.log("\n[1] verify accounts / journal");
  const [bill] = await call("account.journal", "search_read", {
    domain: [["type", "=", "purchase"]], fields: ["id", "code", "name", "default_account_id"], limit: 1,
  });
  if (!bill) stop("no purchase journal");
  const [cogs] = await call("account.account", "search_read", {
    domain: [["code", "=", "400001"]], fields: ["id", "code", "name", "account_type"], limit: 1,
  });
  if (!cogs) stop("account 400001 missing");
  const [ap] = await call("account.account", "search_read", {
    domain: [["code", "=", "201002"]], fields: ["id", "code", "name", "account_type"], limit: 1,
  });
  if (!ap) stop("account 201002 missing");
  const [ahmad] = await call("res.partner", "read", { ids: [30], fields: ["id", "name", "property_account_payable_id"] });
  const [co] = await call("res.company", "read", { ids: [1], fields: ["id", "account_purchase_tax_id"] });
  console.log(`  journal ${bill.code} (id ${bill.id}) default → ${bill.default_account_id?.[1]}`);
  console.log(`  ${cogs.code} ${cogs.name} → ${cogs.account_type}`);
  console.log(`  ${ap.code} ${ap.name} → ${ap.account_type}`);
  console.log(`  supplier 30 payable → ${ahmad?.property_account_payable_id?.[1]}`);
  console.log(`  company purchase tax → ${co?.account_purchase_tax_id?.[1]} (id ${co?.account_purchase_tax_id?.[0]})`);
  if (bill.default_account_id?.[0] !== cogs.id) stop("purchase journal default account is not 400001");
  if (cogs.account_type !== "expense_direct_cost") stop("400001 is not expense_direct_cost");
  if (ap.account_type !== "liability_payable") stop("201002 is not liability_payable");
  if (ahmad?.property_account_payable_id?.[0] !== ap.id) stop("supplier payable is not 201002");
  if (!co?.account_purchase_tax_id) stop("company purchase tax empty");
  return { bill, cogs, ap, purchaseTaxId: co.account_purchase_tax_id[0] };
}

async function ensureFields(snap) {
  console.log("\n[2] x_purchase_list fields");
  const [model] = await call("ir.model", "search_read", { domain: [["model", "=", "x_purchase_list"]], fields: ["id"], limit: 1 });
  if (!model) stop("ir.model x_purchase_list missing");
  for (const f of FIELDS) {
    const [ex] = await call("ir.model.fields", "search_read", {
      domain: [["model", "=", "x_purchase_list"], ["name", "=", f.name]], fields: ["id", "ttype", "relation"], limit: 1,
    });
    if (ex) {
      if (ex.ttype !== "many2one" || ex.relation !== f.relation) stop(`${f.name} exists as ${ex.ttype}→${ex.relation}`);
      console.log(`  ${f.name}: exists (id ${ex.id}) — skip`);
      snap.fields[f.name] ??= { id: ex.id, created: false };
      continue;
    }
    if (DRY) { console.log(`  ${f.name}: WOULD create many2one → ${f.relation}`); continue; }
    const [id] = await call("ir.model.fields", "create", {
      vals_list: [{
        model_id: model.id, name: f.name, ttype: "many2one", relation: f.relation,
        field_description: f.field_description, state: "manual", on_delete: "set null", copied: false,
      }],
    });
    snap.fields[f.name] = { id, created: true };
    console.log(`  ${f.name}: created (id ${id})`);
  }
}

async function ensureProduct(snap, cogs) {
  console.log("\n[3] service product");
  const [ex] = await call("product.template", "search_read", {
    domain: [["default_code", "=", PRODUCT_CODE], ["active", "in", [true, false]]],
    fields: ["id", "name", "type", "purchase_ok", "sale_ok", "property_account_expense_id", "supplier_taxes_id", "taxes_id", "purchase_method", "active"],
    limit: 1,
  });
  if (ex) {
    const bad = [];
    if (ex.type !== "service") bad.push(`type=${ex.type}`);
    if (!ex.purchase_ok) bad.push("purchase_ok=false");
    if (ex.property_account_expense_id?.[0] !== cogs.id) bad.push(`expense=${ex.property_account_expense_id?.[1]}`);
    if (ex.supplier_taxes_id?.length) bad.push(`supplier_taxes=${ex.supplier_taxes_id}`);
    if (!ex.active) bad.push("archived");
    if (bad.length) stop(`product ${ex.id} exists but ${bad.join(", ")}`);
    console.log(`  ${PRODUCT_CODE}: exists (tmpl ${ex.id}) — skip`);
    snap.product ??= { tmpl_id: ex.id, created: false };
    return;
  }
  if (DRY) { console.log(`  ${PRODUCT_CODE}: WOULD create service «${PRODUCT_NAME}» expense ${cogs.code}`); return; }
  const [id] = await call("product.template", "create", {
    vals_list: [{
      name: PRODUCT_NAME, default_code: PRODUCT_CODE, type: "service",
      purchase_ok: true, sale_ok: false, purchase_method: "purchase",
      property_account_expense_id: cogs.id,
      taxes_id: [[6, 0, []]], supplier_taxes_id: [[6, 0, []]],
      list_price: 0, standard_price: 0,
    }],
  });
  snap.product = { tmpl_id: id, created: true };
  console.log(`  ${PRODUCT_CODE}: created (tmpl ${id})`);
}

async function ensureTaxTwin(snap, purchaseTaxId) {
  console.log("\n[4] tax-included twin of the company purchase tax");
  const [base] = await call("account.tax", "read", {
    ids: [purchaseTaxId],
    fields: ["id", "name", "amount", "amount_type", "type_tax_use", "price_include", "tax_group_id", "country_id", "active"],
  });
  if (!base || base.type_tax_use !== "purchase" || base.amount_type !== "percent") stop(`tax ${purchaseTaxId} unusable`);
  if (base.price_include) {
    console.log(`  company purchase tax ${base.id} is already price-included — no twin needed`);
    return;
  }
  const [ex] = await call("account.tax", "search_read", {
    domain: [["type_tax_use", "=", "purchase"], ["amount_type", "=", "percent"], ["amount", "=", base.amount],
      ["price_include_override", "=", "tax_included"], ["tax_group_id", "=", base.tax_group_id[0]],
      ["country_id", "=", base.country_id[0]], ["active", "in", [true, false]]],
    fields: ["id", "name", "active"], limit: 1,
  });
  if (ex) {
    if (!ex.active) stop(`twin tax ${ex.id} is archived`);
    console.log(`  twin exists: ${ex.id} «${ex.name}» — skip`);
    snap.tax ??= { id: ex.id, created: false };
    return;
  }
  if (DRY) { console.log(`  WOULD copy tax ${base.id} → «${TAX_TWIN_NAME}» price_include_override=tax_included`); return; }
  const res = await call("account.tax", "copy", {
    ids: [base.id],
    default: { name: TAX_TWIN_NAME, price_include_override: "tax_included", description: "15% شامل" },
  });
  const id = Array.isArray(res) ? res[0] : res;
  snap.tax = { id, created: true };
  const [t] = await call("account.tax", "read", {
    ids: [id], fields: ["id", "name", "price_include", "amount", "invoice_repartition_line_ids", "refund_repartition_line_ids"],
  });
  const rep = await call("account.tax.repartition.line", "read", {
    ids: [...t.invoice_repartition_line_ids, ...t.refund_repartition_line_ids],
    fields: ["id", "repartition_type", "account_id", "document_type"],
  });
  console.log(`  created ${id} «${t.name}» price_include=${t.price_include} amount=${t.amount}`);
  for (const r of rep) console.log(`    ${r.document_type} ${r.repartition_type} → ${r.account_id ? r.account_id[1] : "—"}`);
  if (!t.price_include) stop("twin is not price-included");
  if (!rep.some((r) => r.document_type === "invoice" && r.repartition_type === "tax" && String(r.account_id?.[1] ?? "").startsWith("104041"))) {
    stop("twin tax invoice repartition is not on 104041 VAT Input");
  }
}

async function rollback() {
  if (!existsSync(ROLLBACK)) stop("no rollback file");
  const snap = JSON.parse(readFileSync(ROLLBACK, "utf8"));
  console.log(`rollback from ${ROLLBACK.pathname}${DRY ? " (dry-run)" : ""}`);
  for (const [name, f] of Object.entries(snap.fields ?? {})) {
    if (!f.created) { console.log(`  field ${name}: pre-existing — keep`); continue; }
    if (DRY) { console.log(`  WOULD unlink field ${name} (${f.id})`); continue; }
    await call("ir.model.fields", "unlink", { ids: [f.id] });
    console.log(`  field ${name} (${f.id}) unlinked`);
  }
  const undo = async (model, id, label) => {
    if (DRY) { console.log(`  WOULD unlink ${label} ${id} (archive on refusal)`); return; }
    try { await call(model, "unlink", { ids: [id] }); console.log(`  ${label} ${id} unlinked`); }
    catch (e) { await call(model, "write", { ids: [id], vals: { active: false } }); console.log(`  ${label} ${id} in use → archived (${e.message.slice(0, 80)})`); }
  };
  if (snap.product?.created) await undo("product.template", snap.product.tmpl_id, "product.template");
  if (snap.tax?.created) await undo("account.tax", snap.tax.id, "account.tax");
}

async function main() {
  console.log(`acct-20260923-purchase-setup — ${new Date().toISOString()} — mode=${MODE}${DRY ? " (dry-run)" : ""}`);
  if (MODE === "rollback") return rollback();
  const snap = existsSync(ROLLBACK)
    ? JSON.parse(readFileSync(ROLLBACK, "utf8"))
    : { taken_at: new Date().toISOString(), fields: {}, product: null, tax: null };
  const { cogs, purchaseTaxId } = await verify();
  await ensureFields(snap);
  await ensureProduct(snap, cogs);
  await ensureTaxTwin(snap, purchaseTaxId);
  if (!DRY) {
    writeFileSync(ROLLBACK, JSON.stringify(snap, null, 2));
    console.log(`\nsnapshot → ${ROLLBACK.pathname}`);
  }
  console.log(`\n✅ ${DRY ? "dry-run done" : "setup done"}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
