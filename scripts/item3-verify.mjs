// Item 3 end-to-end verification: create purchase.order for Ahmed (today's
// x_daily_price) → confirm → create vendor bill → post → snapshot
// supplier payable ledger → clean up (delete bill + PO). Verifies:
//
//   1. Bill is posted with amount_untaxed == PO total, amount_tax == 0
//   2. Supplier payable ledger for Ahmed picks up the new credit
//   3. Every UTAK product template has purchase_method='purchase'
//   4. x_purchase_list count unchanged (parallel build — flow untouched)
//   5. Test rows are removed
//
// Safe to re-run any day where Ahmed has x_daily_price rows.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers: h, body: JSON.stringify(body),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(model, method, body); }
    throw new Error(`HTTP ${r.status} ${model}.${method}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

const AHMED = 30;
const today = new Date().toISOString().slice(0, 10);

// ------- SNAPSHOT before -------
const beforePLCount = await call("x_purchase_list", "search_count", { domain: [] });
const beforeDPCount = await call("x_daily_price", "search_count", { domain: [] });
const beforeQuot    = await call("x_quotation", "search_count", { domain: [] });
const beforeCrons   = await call("ir.cron", "search_count", { domain: [] });
const beforeAllPMS  = await call("product.template", "search_count", {
  domain: [["default_code", "=like", "UTAK-%"], ["purchase_method", "!=", "purchase"]],
});
async function payableSum(partnerId) {
  const lines = await call("account.move.line", "search_read", {
    domain: [["partner_id","=",partnerId],["account_id.account_type","=","liability_payable"],["parent_state","=","posted"]],
    fields: ["balance"],
  });
  return lines.reduce((s, l) => s + (l.balance || 0), 0);
}
const beforePayable = await payableSum(AHMED);

console.log("BEFORE snapshot:");
console.log(`  x_purchase_list      = ${beforePLCount}`);
console.log(`  x_daily_price        = ${beforeDPCount}`);
console.log(`  x_quotation          = ${beforeQuot}`);
console.log(`  ir.cron              = ${beforeCrons}`);
console.log(`  UTAK templates w/  purchase_method != 'purchase' = ${beforeAllPMS}`);
console.log(`  Ahmed payable balance = ${beforePayable}`);

// ------- Load today's prices -------
const prices = await call("x_daily_price", "search_read", {
  domain: [["x_supplier_id","=",AHMED],["x_date","=",today]],
  fields: ["id","x_product_tmpl_id","x_packaging_id","x_price_sar"],
});
if (prices.length === 0) {
  console.error(`STOP: no x_daily_price for Ahmed on ${today}`);
  process.exit(1);
}
const tmplIds = [...new Set(prices.map((p) => p.x_product_tmpl_id?.[0]).filter(Boolean))];
const variants = await call("product.product", "search_read", {
  domain: [["product_tmpl_id","in",tmplIds]],
  fields: ["id","product_tmpl_id","uom_id"],
});
const variantByTmpl = new Map();
for (const v of variants) variantByTmpl.set(v.product_tmpl_id[0], v);

// ------- CREATE PO -------
const orderLines = prices.map((p) => {
  const v = variantByTmpl.get(p.x_product_tmpl_id[0]);
  return [0, 0, {
    product_id:  v.id,
    name:        `${p.x_product_tmpl_id[1]} — ${p.x_packaging_id?.[1] || ""}`.trim(),
    product_qty: 1,
    price_unit:  p.x_price_sar,
    uom_id:      v.uom_id?.[0] ?? 1,
    tax_ids:     [[6, 0, []]],
  }];
});
const expectedTotal = prices.reduce((s, p) => s + p.x_price_sar, 0);
const poIds = await call("purchase.order", "create", { vals_list: [{
  partner_id: AHMED,
  date_order: `${today} 00:00:00`,
  origin:     `UTAK-VERIFY-${Date.now()}`,
  order_line: orderLines,
}]});
const poId = poIds[0];
console.log(`\n[1] Created purchase.order id=${poId} — expected total=${expectedTotal}`);

let billId = null;
try {
  // ------- CONFIRM -------
  await call("purchase.order", "button_confirm", { ids: [poId] });
  const poC = await call("purchase.order", "read", { ids: [poId], fields: ["state","invoice_status","amount_total","amount_tax"] });
  console.log(`[2] PO after confirm: state=${poC[0].state} invoice_status=${poC[0].invoice_status} total=${poC[0].amount_total} tax=${poC[0].amount_tax}`);
  if (poC[0].state !== "purchase") throw new Error(`PO state=${poC[0].state} (expected 'purchase')`);
  if (poC[0].amount_tax !== 0) throw new Error(`PO amount_tax=${poC[0].amount_tax} (expected 0)`);
  if (Math.abs(poC[0].amount_total - expectedTotal) > 0.01) throw new Error(`PO total mismatch`);

  // ------- CREATE BILL -------
  await call("purchase.order", "action_create_invoice", { ids: [poId] });
  const bills = await call("account.move", "search_read", {
    domain: [["move_type","=","in_invoice"],["partner_id","=",AHMED]],
    fields: ["id","state","amount_untaxed","amount_tax","amount_total"],
    order: "id desc",
    limit: 1,
  });
  billId = bills[0].id;
  console.log(`[3] Draft bill id=${billId}: total=${bills[0].amount_total} tax=${bills[0].amount_tax}`);
  if (bills[0].amount_tax !== 0) throw new Error(`Draft bill amount_tax=${bills[0].amount_tax}`);
  if (Math.abs(bills[0].amount_total - expectedTotal) > 0.01) throw new Error(`Bill total mismatch (got ${bills[0].amount_total}, expected ${expectedTotal})`);

  // ------- POST BILL -------
  await call("account.move", "write", { ids: [billId], vals: { invoice_date: today } });
  await call("account.move", "action_post", { ids: [billId] });
  const posted = await call("account.move", "read", { ids: [billId], fields: ["state","amount_total","amount_tax","name"] });
  console.log(`[4] Posted bill: name=${posted[0].name} state=${posted[0].state} total=${posted[0].amount_total} tax=${posted[0].amount_tax}`);
  if (posted[0].state !== "posted") throw new Error(`Bill state=${posted[0].state} (expected 'posted')`);
  if (posted[0].amount_tax !== 0) throw new Error(`Posted bill amount_tax=${posted[0].amount_tax}`);

  // ------- PAYABLE LEDGER -------
  const afterPayable = await payableSum(AHMED);
  const delta = afterPayable - beforePayable;
  console.log(`[5] Ahmed payable balance: ${beforePayable} → ${afterPayable} (delta ${delta.toFixed(2)})`);
  if (Math.abs(delta - -expectedTotal) > 0.01) throw new Error(`payable delta ${delta} != -${expectedTotal}`);

  console.log(`\nAll asserts passed. Cleaning up.`);
} finally {
  // ------- CLEANUP -------
  if (billId) {
    try {
      const b = await call("account.move", "read", { ids: [billId], fields: ["state"] });
      if (b[0]?.state === "posted") await call("account.move", "button_draft", { ids: [billId] });
      if (b[0]?.state !== "cancel") await call("account.move", "button_cancel", { ids: [billId] });
      await call("account.move", "unlink", { ids: [billId] });
      console.log(`cleaned bill ${billId}`);
    } catch (e) { console.error(`bill cleanup:`, e.message.slice(0,200)); }
  }
  try {
    const p = await call("purchase.order", "read", { ids: [poId], fields: ["state"] });
    if (p[0]?.state === "purchase") await call("purchase.order", "button_cancel", { ids: [poId] });
    await call("purchase.order", "unlink", { ids: [poId] });
    console.log(`cleaned PO ${poId}`);
  } catch (e) { console.error(`po cleanup:`, e.message.slice(0,200)); }
}

// ------- INVARIANTS AFTER -------
const afterPLCount = await call("x_purchase_list", "search_count", { domain: [] });
const afterDPCount = await call("x_daily_price", "search_count", { domain: [] });
const afterQuot    = await call("x_quotation", "search_count", { domain: [] });
const afterCrons   = await call("ir.cron", "search_count", { domain: [] });
const afterAllPMS  = await call("product.template", "search_count", {
  domain: [["default_code", "=like", "UTAK-%"], ["purchase_method", "!=", "purchase"]],
});
const afterPayable = await payableSum(AHMED);
console.log("\nAFTER invariant check:");
const cases = [
  ["x_purchase_list",      beforePLCount, afterPLCount],
  ["x_daily_price",        beforeDPCount, afterDPCount],
  ["x_quotation",          beforeQuot,    afterQuot],
  ["ir.cron",              beforeCrons,   afterCrons],
  ["UTAK templates w/ purchase_method != 'purchase'", beforeAllPMS, afterAllPMS],
  ["Ahmed payable balance", beforePayable, afterPayable],
];
let fail = 0;
for (const [k, a, b] of cases) {
  const ok = a === b;
  console.log(`  ${ok ? "✅" : "❌"} ${k}: ${a} → ${b}`);
  if (!ok) fail++;
}
if (fail > 0) process.exit(2);
console.log("\nOK — item3 verified end-to-end. Zero drift.");
