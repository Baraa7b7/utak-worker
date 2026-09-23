// UTAK — sale → accounting setup, 2026-09-23.
//
// Wires x_daily_order → sale.order → customer invoice (account.move
// out_invoice created FROM the sale order). This script only prepares Odoo;
// the Worker code lives in src/sale-accounting.ts and runs behind
// ACCOUNTING_SYNC.
//
// 1. VERIFY (read only, STOP on mismatch):
//      • sales journal INV exists, default account 500001 (income)
//      • 102011 is asset_receivable and is the customer receivable
//      • company sale tax (account_sale_tax_id) is a price-included 15%
// 2. Fields (ir.model.fields, manual):
//      x_daily_order.x_sale_order_id   many2one → sale.order
//      x_invoice.x_invoice_sent_at     datetime (invoice WhatsApp'd to the
//                                      customer after full collection)
// 3. Service product «بضاعة مباعة (وسيط)» (default_code UTAK-SALE-GOODS):
//    type service → action_confirm creates NO stock.picking (sale_stock is
//    installed and creates deliveries for every goods/consu product, and
//    product types must not change). Income account 500001, no default taxes
//    (the Worker pins tax_ids on every line), invoice_policy = delivery +
//    service_type = manual → qty_delivered is written by the Worker at
//    delivery and the invoice bills exactly what was delivered.
//    purchase_ok = false.
// 4. Team: عمر المجهلي (res.partner 9) must carry the warehouse role in
//    x_role_ids (the field getTeamMembersByRole reads). Added if missing.
// 5. Test purchase orders 8/9/10 (locked after the 09-23 live verify):
//    archived when purchase.order has an `active` field; otherwise reported.
//
// Idempotent: every step searches first. Snapshot of what was created /
// changed: scripts/artifacts/acct-20260923-sale-setup-rollback.json
// Flags:
//   --dry-run   print the plan, write nothing
//   --rollback  undo: fields unlinked, product unlinked (archived if Odoo
//               refuses because moves reference it), role removed if added
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

const ROLLBACK = new URL("./artifacts/acct-20260923-sale-setup-rollback.json", import.meta.url);
const DRY = process.argv.includes("--dry-run");
const MODE = process.argv.includes("--rollback") ? "rollback" : "apply";

const FIELDS = [
  { model: "x_daily_order", name: "x_sale_order_id", ttype: "many2one", relation: "sale.order", field_description: "أمر البيع" },
  { model: "x_invoice", name: "x_invoice_sent_at", ttype: "datetime", relation: false, field_description: "أُرسلت للعميل (بعد التحصيل)" },
];
const PRODUCT_CODE = "UTAK-SALE-GOODS";
const PRODUCT_NAME = "بضاعة مباعة (وسيط)";
const OMAR_ID = 9;
const TEST_POS = [8, 9, 10];

function stop(msg) { console.error(`STOP: ${msg}`); process.exit(1); }

async function verify() {
  console.log("\n[1] verify journal / accounts / tax");
  const [inv] = await call("account.journal", "search_read", {
    domain: [["type", "=", "sale"]], fields: ["id", "code", "name", "default_account_id"], order: "sequence, id", limit: 1,
  });
  if (!inv) stop("no sales journal");
  const [income] = await call("account.account", "search_read", {
    domain: [["code", "=", "500001"]], fields: ["id", "code", "name", "account_type"], limit: 1,
  });
  const [ar] = await call("account.account", "search_read", {
    domain: [["code", "=", "102011"]], fields: ["id", "code", "name", "account_type"], limit: 1,
  });
  if (!income) stop("account 500001 missing");
  if (!ar) stop("account 102011 missing");
  const [probe] = await call("res.partner", "read", { ids: [48], fields: ["id", "property_account_receivable_id"] });
  const [co] = await call("res.company", "read", { ids: [1], fields: ["id", "account_sale_tax_id"] });
  if (!co?.account_sale_tax_id) stop("company sale tax empty");
  const [tax] = await call("account.tax", "read", {
    ids: [co.account_sale_tax_id[0]], fields: ["id", "amount", "type_tax_use", "price_include", "active"],
  });
  console.log(`  journal ${inv.code} (id ${inv.id}) default → ${inv.default_account_id?.[1]}`);
  console.log(`  ${income.code} ${income.name} → ${income.account_type}`);
  console.log(`  ${ar.code} ${ar.name} → ${ar.account_type}; test customer 48 receivable → ${probe?.property_account_receivable_id?.[1]}`);
  console.log(`  company sale tax → ${tax.id} ${tax.amount}% ${tax.type_tax_use} price_include=${tax.price_include}`);
  if (inv.default_account_id?.[0] !== income.id) stop("sales journal default account is not 500001");
  if (income.account_type !== "income") stop("500001 is not income");
  if (ar.account_type !== "asset_receivable") stop("102011 is not asset_receivable");
  if (probe?.property_account_receivable_id?.[0] !== ar.id) stop("customer receivable is not 102011");
  if (!tax.active || tax.type_tax_use !== "sale" || !tax.price_include) stop("company sale tax is not an active price-included sale tax");
  return { inv, income, ar };
}

async function ensureFields(snap) {
  console.log("\n[2] fields");
  for (const f of FIELDS) {
    const [model] = await call("ir.model", "search_read", { domain: [["model", "=", f.model]], fields: ["id"], limit: 1 });
    if (!model) stop(`ir.model ${f.model} missing`);
    const [ex] = await call("ir.model.fields", "search_read", {
      domain: [["model", "=", f.model], ["name", "=", f.name]], fields: ["id", "ttype", "relation"], limit: 1,
    });
    const key = `${f.model}.${f.name}`;
    if (ex) {
      if (ex.ttype !== f.ttype || (f.relation && ex.relation !== f.relation)) stop(`${key} exists as ${ex.ttype}→${ex.relation}`);
      console.log(`  ${key}: exists (id ${ex.id}) — skip`);
      snap.fields[key] ??= { id: ex.id, created: false };
      continue;
    }
    if (DRY) { console.log(`  ${key}: WOULD create ${f.ttype}${f.relation ? ` → ${f.relation}` : ""}`); continue; }
    const vals = {
      model_id: model.id, name: f.name, ttype: f.ttype,
      field_description: f.field_description, state: "manual", copied: false,
    };
    if (f.relation) { vals.relation = f.relation; vals.on_delete = "set null"; }
    const [id] = await call("ir.model.fields", "create", { vals_list: [vals] });
    snap.fields[key] = { id, created: true };
    console.log(`  ${key}: created (id ${id})`);
  }
}

async function ensureProduct(snap, income) {
  console.log("\n[3] service product");
  const [ex] = await call("product.template", "search_read", {
    domain: [["default_code", "=", PRODUCT_CODE], ["active", "in", [true, false]]],
    fields: ["id", "name", "type", "sale_ok", "purchase_ok", "invoice_policy", "service_type",
      "property_account_income_id", "taxes_id", "active"],
    limit: 1,
  });
  if (ex) {
    const bad = [];
    if (ex.type !== "service") bad.push(`type=${ex.type}`);
    if (!ex.sale_ok) bad.push("sale_ok=false");
    if (ex.invoice_policy !== "delivery") bad.push(`invoice_policy=${ex.invoice_policy}`);
    if (ex.service_type !== "manual") bad.push(`service_type=${ex.service_type}`);
    if (ex.property_account_income_id?.[0] !== income.id) bad.push(`income=${ex.property_account_income_id?.[1]}`);
    if (ex.taxes_id?.length) bad.push(`taxes=${ex.taxes_id}`);
    if (!ex.active) bad.push("archived");
    if (bad.length) stop(`product ${ex.id} exists but ${bad.join(", ")}`);
    console.log(`  ${PRODUCT_CODE}: exists (tmpl ${ex.id}) — skip`);
    snap.product ??= { tmpl_id: ex.id, created: false };
    return;
  }
  if (DRY) { console.log(`  ${PRODUCT_CODE}: WOULD create service «${PRODUCT_NAME}» income ${income.code}, invoice_policy=delivery, service_type=manual`); return; }
  const [id] = await call("product.template", "create", {
    vals_list: [{
      name: PRODUCT_NAME, default_code: PRODUCT_CODE, type: "service",
      sale_ok: true, purchase_ok: false,
      invoice_policy: "delivery", service_type: "manual",
      property_account_income_id: income.id,
      taxes_id: [[6, 0, []]], supplier_taxes_id: [[6, 0, []]],
      list_price: 0, standard_price: 0,
    }],
  });
  snap.product = { tmpl_id: id, created: true };
  console.log(`  ${PRODUCT_CODE}: created (tmpl ${id})`);
}

async function ensureWarehouseRole(snap) {
  console.log("\n[4] عمر المجهلي → warehouse");
  const [role] = await call("x_employee_role", "search_read", { domain: [["x_code", "=", "warehouse"]], fields: ["id", "x_name"], limit: 1 });
  if (!role) { console.log("  x_employee_role warehouse missing — REPORT, skipped"); snap.omar = { error: "no warehouse role" }; return; }
  const [p] = await call("res.partner", "read", {
    ids: [OMAR_ID], fields: ["id", "name", "active", "x_role", "x_role_ids", "x_whatsapp_number", "x_wa_allowed"],
  }).catch(() => []);
  if (!p || !String(p.name).includes("المجهلي") || !String(p.name).includes("عمر")) {
    console.log(`  res.partner ${OMAR_ID} is not عمر المجهلي — REPORT, skipped`);
    snap.omar = { error: "record not found" };
    return;
  }
  console.log(`  partner ${p.id} «${p.name}» active=${p.active} x_role(legacy)=${p.x_role} x_role_ids=${JSON.stringify(p.x_role_ids)} wa=${p.x_whatsapp_number} x_wa_allowed=${p.x_wa_allowed}`);
  snap.omar ??= { partner_id: p.id, before_role_ids: p.x_role_ids, added: false };
  if (p.x_role_ids.includes(role.id)) {
    console.log(`  warehouse role (${role.id}) already on x_role_ids — skip`);
  } else if (DRY) {
    console.log(`  WOULD add role ${role.id} to x_role_ids`);
  } else {
    await call("res.partner", "write", { ids: [p.id], vals: { x_role_ids: [[4, role.id, 0]] } });
    snap.omar.added = true;
    snap.omar.role_id = role.id;
    console.log(`  added role ${role.id}`);
  }
  // Same domain as src/odoo.ts getTeamMembersByRole(env, "warehouse").
  const members = await call("res.partner", "search_read", {
    domain: [["x_role_ids.x_code", "=", "warehouse"], ["active", "=", true]],
    fields: ["id", "name", "x_whatsapp_number"], limit: 50,
  });
  console.log(`  getTeamMembersByRole(warehouse) → ${JSON.stringify(members.map((m) => [m.id, m.name, m.x_whatsapp_number]))}`);
  snap.omar.warehouse_members = members.map((m) => m.id);
}

async function archiveTestPurchaseOrders(snap) {
  console.log("\n[5] test purchase orders 8/9/10");
  const [activeField] = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "purchase.order"], ["name", "=", "active"]], fields: ["id"], limit: 1,
  });
  const pos = await call("purchase.order", "read", { ids: TEST_POS, fields: ["id", "name", "state", "locked", "invoice_status"] });
  for (const po of pos) console.log(`  ${po.id} ${po.name} state=${po.state} locked=${po.locked} invoice_status=${po.invoice_status}`);
  if (!activeField) {
    console.log("  purchase.order has NO `active` field on this Odoo 19 — cannot archive; they stay locked (not deleted)");
    snap.purchase_orders = { archived: false, reason: "purchase.order has no active field", state: pos };
    return;
  }
  if (DRY) { console.log("  WOULD archive"); return; }
  await call("purchase.order", "write", { ids: TEST_POS, vals: { active: false } });
  snap.purchase_orders = { archived: true, ids: TEST_POS };
}

async function apply() {
  const snap = existsSync(ROLLBACK)
    ? JSON.parse(readFileSync(ROLLBACK, "utf8"))
    : { created_at: new Date().toISOString(), fields: {}, product: null, omar: null };
  const { income } = await verify();
  await ensureFields(snap);
  await ensureProduct(snap, income);
  await ensureWarehouseRole(snap);
  await archiveTestPurchaseOrders(snap);
  if (!DRY) {
    snap.updated_at = new Date().toISOString();
    writeFileSync(ROLLBACK, JSON.stringify(snap, null, 2));
    console.log(`\nrollback snapshot → ${ROLLBACK.pathname}`);
  }
}

async function rollback() {
  if (!existsSync(ROLLBACK)) stop("no rollback snapshot");
  const snap = JSON.parse(readFileSync(ROLLBACK, "utf8"));
  if (snap.omar?.added && snap.omar.role_id) {
    await call("res.partner", "write", { ids: [snap.omar.partner_id], vals: { x_role_ids: [[3, snap.omar.role_id, 0]] } });
    console.log(`  role ${snap.omar.role_id} removed from partner ${snap.omar.partner_id}`);
  }
  if (snap.product?.created) {
    try {
      await call("product.template", "unlink", { ids: [snap.product.tmpl_id] });
      console.log(`  product ${snap.product.tmpl_id} unlinked`);
    } catch (e) {
      await call("product.template", "write", { ids: [snap.product.tmpl_id], vals: { active: false } });
      console.log(`  product ${snap.product.tmpl_id} referenced — archived (${e.message.slice(0, 80)})`);
    }
  }
  for (const [key, f] of Object.entries(snap.fields ?? {})) {
    if (!f.created) continue;
    await call("ir.model.fields", "unlink", { ids: [f.id] });
    console.log(`  field ${key} (${f.id}) unlinked`);
  }
  if (snap.purchase_orders?.archived) {
    await call("purchase.order", "write", { ids: snap.purchase_orders.ids, vals: { active: true } });
    console.log("  purchase orders unarchived");
  }
}

console.log(`acct-20260923-sale-setup — mode=${MODE}${DRY ? " (dry-run)" : ""}`);
if (MODE === "rollback") await rollback(); else await apply();
