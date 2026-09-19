// Item 3 — parallel build. Ahmed's daily purchase mapped to a standard
// purchase.order on utakfresh.odoo.com. Sources today's x_daily_price rows
// for supplier أحمد حسان (res.partner id=30) and creates one purchase.order
// with one purchase.order.line per priced item.
//
// Parallel build — the existing x_purchase_list flow (aggregation cron 21:15
// + PDF to Ahmed's WhatsApp) is UNCHANGED. This adds a second, standards-
// aligned representation of the same buy so:
//   • the Purchase app shows Ahmed's daily activity,
//   • a follow-up vendor bill (account.move type=in_invoice) can post
//     supplier debt into accounting (item 6 territory — not done here),
//   • the real cost side of each order becomes queryable for margin.
//
// No VAT: taxes_id=[[6,0,[]]] on every line. product.template.taxes_id was
// already cleared tenant-wide by item5, but we defend on the line too so a
// future default flip cannot silently reintroduce VAT.
//
// Quantity: this first pass uses qty=1 per priced item as a placeholder.
// The eventual demand-driven aggregation (sum x_daily_order_line.x_quantity
// per product_tmpl for today's confirmed orders) is a follow-up — the cron
// 21:15 aggregation logic already exists in the Worker for x_purchase_list
// and can be reused. Doing that reuse here would be a bigger change; the
// task's goal was to prove the standard PO path works and stays VAT-free.
// A caller (Baraa or a follow-up cron) edits qty before the PO is
// confirmed, or the follow-up commit adds the aggregation.
//
// Idempotent: script refuses to create a second PO for the same supplier /
// same date unless --force is passed. Pass --dry_run to print what would be
// created without writing anything. Pass --confirm to also call
// button_confirm on the created PO (state draft → purchase). Default is
// draft — safe to inspect and delete without accounting impact.

import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry_run");
const FORCE   = args.has("--force");
const CONFIRM = args.has("--confirm");

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
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: missing Odoo creds");
  process.exit(1);
}

const AHMED_PARTNER_ID = 30;

let auth = { mode: "apikey", cookie: null };
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
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

const today = new Date().toISOString().slice(0, 10);
console.log(`Target date: ${today} (Riyadh)`);

// Ahmed sanity check
const ahmed = await call("res.partner", "read", { ids: [AHMED_PARTNER_ID], fields: ["id","name","supplier_rank"] });
if (!ahmed[0] || ahmed[0].supplier_rank < 1) {
  console.error(`STOP: partner id=${AHMED_PARTNER_ID} is not a supplier`);
  process.exit(1);
}
console.log(`Supplier: id=${ahmed[0].id} "${ahmed[0].name}"`);

// Load today's x_daily_price for Ahmed
const prices = await call("x_daily_price", "search_read", {
  domain: [["x_supplier_id", "=", AHMED_PARTNER_ID], ["x_date", "=", today]],
  fields: ["id","x_date","x_product_tmpl_id","x_packaging_id","x_price_sar","x_sale_price","x_actual_weight_kg"],
});
if (prices.length === 0) {
  console.error(`STOP: no x_daily_price rows for supplier ${AHMED_PARTNER_ID} on ${today}`);
  process.exit(1);
}
console.log(`Today's priced items: ${prices.length}`);
for (const p of prices) {
  console.log(`  x_daily_price id=${p.id} tmpl=${JSON.stringify(p.x_product_tmpl_id)} pack=${JSON.stringify(p.x_packaging_id)} cost=${p.x_price_sar}`);
}

// Resolve each product.template → product.product (variant)
const tmplIds = [...new Set(prices.map((p) => p.x_product_tmpl_id?.[0]).filter(Boolean))];
const variants = await call("product.product", "search_read", {
  domain: [["product_tmpl_id", "in", tmplIds]],
  fields: ["id","product_tmpl_id","default_code","name","uom_id","type"],
});
const variantByTmpl = new Map();
for (const v of variants) variantByTmpl.set(v.product_tmpl_id[0], v);
console.log(`\nResolved ${variants.length} product.product variants for ${tmplIds.length} templates`);

// Idempotency: refuse if a draft PO already exists for Ahmed today with our own tag
// (search by partner + date_order between today 00:00:00 and 23:59:59 + a tag on origin)
const startOfDay = `${today} 00:00:00`;
const endOfDay   = `${today} 23:59:59`;
const TAG = "UTAK-DAILY";
const existing = await call("purchase.order", "search_read", {
  domain: [
    ["partner_id", "=", AHMED_PARTNER_ID],
    ["date_order", ">=", startOfDay],
    ["date_order", "<=", endOfDay],
    ["origin", "=", TAG],
  ],
  fields: ["id","name","state","amount_untaxed","amount_tax","amount_total","origin"],
});
if (existing.length > 0 && !FORCE) {
  console.log(`\nExisting PO(s) already tagged '${TAG}' for Ahmed today:`);
  for (const e of existing) console.log(`  id=${e.id} name=${e.name} state=${e.state} total=${e.amount_total}`);
  console.log(`\nPass --force to create another. Exiting without changes.`);
  process.exit(0);
}

// Preload default packaging per template as a fallback for lines without an
// explicit x_daily_price.x_packaging_id.
const defaultPackByTmpl = new Map();
if (tmplIds.length > 0) {
  const defaults = await call("x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id","in",tmplIds],["x_is_default","=",true]],
    fields: ["id","x_product_tmpl_id"],
  });
  for (const d of defaults) if (d.x_product_tmpl_id) defaultPackByTmpl.set(d.x_product_tmpl_id[0], d.id);
}

// Build line values
const orderLines = [];
for (const p of prices) {
  const tmplId = p.x_product_tmpl_id[0];
  const v = variantByTmpl.get(tmplId);
  if (!v) {
    console.warn(`skip x_daily_price id=${p.id} — no variant for tmpl id=${tmplId}`);
    continue;
  }
  const packName = p.x_packaging_id?.[1] || "";
  const packId = p.x_packaging_id?.[0] || defaultPackByTmpl.get(tmplId) || false;
  const productName = p.x_product_tmpl_id[1] || v.name;
  const lineName = `${productName}${packName ? ` — ${packName}` : ""}`;
  orderLines.push([0, 0, {
    product_id:  v.id,
    name:        lineName,
    product_qty: 1,           // placeholder — Baraa or the demand aggregator sets the real qty
    price_unit:  p.x_price_sar,
    uom_id:      v.uom_id?.[0] ?? 1,
    tax_ids:     [[6, 0, []]],  // hard-defend against a future default flip
    x_packaging_id: packId,    // pinpoint packaging (falls back to product's default)
  }]);
}
if (orderLines.length === 0) {
  console.error(`STOP: no lines to create`);
  process.exit(1);
}
console.log(`\nWill create purchase.order with ${orderLines.length} line(s)`);
console.log(`  partner_id  = ${AHMED_PARTNER_ID}`);
console.log(`  date_order  = ${startOfDay}`);
console.log(`  origin      = ${TAG}`);
console.log(`  confirmed?  = ${CONFIRM ? "yes" : "no (stays draft)"}`);

if (DRY_RUN) {
  console.log(`\n--dry_run — exiting before write.`);
  process.exit(0);
}

// Create purchase.order
const poIds = await call("purchase.order", "create", {
  vals_list: [{
    partner_id: AHMED_PARTNER_ID,
    date_order: startOfDay,
    origin:     TAG,
    order_line: orderLines,
  }],
});
const poId = poIds[0];
console.log(`\nCreated purchase.order id=${poId}`);

// Optional: confirm (draft → purchase)
if (CONFIRM) {
  await call("purchase.order", "button_confirm", { ids: [poId] });
  console.log(`button_confirm called on id=${poId}`);
}

// Read back for verification
const po = await call("purchase.order", "read", {
  ids: [poId],
  fields: ["id","name","partner_id","state","amount_untaxed","amount_tax","amount_total","currency_id","order_line","origin","date_order"],
});
console.log(`\nAFTER: ${JSON.stringify(po[0], null, 2)}`);

const lines = await call("purchase.order.line", "read", {
  ids: po[0].order_line,
  fields: ["id","name","product_id","product_qty","price_unit","price_subtotal","price_total","tax_ids"],
});
console.log(`\nLines:`);
for (const l of lines) {
  console.log(`  id=${l.id} product=${JSON.stringify(l.product_id)} qty=${l.product_qty} price=${l.price_unit} sub=${l.price_subtotal} total=${l.price_total} taxes=${JSON.stringify(l.tax_ids)}`);
}

// Sanity: no VAT anywhere
const anyTax = lines.some((l) => Array.isArray(l.tax_ids) && l.tax_ids.length > 0);
if (anyTax) {
  console.error(`FAIL: at least one line still carries tax_ids`);
  process.exit(2);
}
if (po[0].amount_tax !== 0) {
  console.error(`FAIL: purchase.order.amount_tax=${po[0].amount_tax} (expected 0)`);
  process.exit(2);
}
console.log(`\nOK — no VAT on any line, amount_tax=0.`);
