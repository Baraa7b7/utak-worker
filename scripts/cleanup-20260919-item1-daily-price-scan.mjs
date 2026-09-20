// Item 1 — read-only scan of x_daily_price rows dated today (Riyadh TZ).
// Expected: 21 (14 baseline from item3 + 7 new fruit).

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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(m, met, b) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, {
    method: "POST", headers: h, body: JSON.stringify(b),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
    throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

// Riyadh = UTC+03, no DST. Convert to Riyadh date string.
function riyadhToday() {
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

const today = riyadhToday();
console.log(`Scanning x_daily_price for ${today} (Riyadh)`);

// Discover fields
const fields = await call("x_daily_price", "fields_get", { attributes: ["type", "string"] });
const fieldNames = Object.keys(fields);
const dateFieldCandidates = ["x_date", "x_price_date", "x_day", "x_effective_date"];
const dateField = dateFieldCandidates.find((f) => fieldNames.includes(f));
if (!dateField) throw new Error(`No date-like field found. Available: ${fieldNames.join(", ")}`);
const supFieldCandidates = ["x_supplier_id", "x_partner_id", "x_supplier"];
const supField = supFieldCandidates.find((f) => fieldNames.includes(f));
const prodFieldCandidates = ["x_product_tmpl_id", "x_product_id", "x_product", "x_product_template_id"];
const prodField = prodFieldCandidates.find((f) => fieldNames.includes(f));
const priceFieldCandidates = ["x_price_sar", "x_price", "x_amount", "x_unit_price"];
const priceField = priceFieldCandidates.find((f) => fieldNames.includes(f));
console.log(`  using date=${dateField} sup=${supField} prod=${prodField} price=${priceField}`);

const rows = await call("x_daily_price", "search_read", {
  domain: [[dateField, "=", today]],
  fields: ["id", dateField, supField, prodField, priceField, "create_date", "write_date"].filter(Boolean),
  order: "id asc",
});
console.log(`\nCount: ${rows.length} (expected 21)`);

// Pretty table
const header = ["ID", "Product", "Supplier", "Price"];
console.log("\n" + header.join(" | "));
console.log("-".repeat(90));
for (const r of rows) {
  const prod = Array.isArray(r[prodField]) ? r[prodField][1] : r[prodField];
  const sup = Array.isArray(r[supField]) ? r[supField][1] : r[supField];
  console.log(`${String(r.id).padEnd(5)} | ${String(prod ?? "-").padEnd(30)} | ${String(sup ?? "-").padEnd(28)} | ${r[priceField]}`);
}

// Group by (product, supplier) to detect duplicates
const grouped = new Map();
for (const r of rows) {
  const prod = Array.isArray(r[prodField]) ? r[prodField][0] : r[prodField];
  const sup = Array.isArray(r[supField]) ? r[supField][0] : r[supField];
  const k = `${prod}::${sup}`;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(r);
}
const dups = [...grouped.entries()].filter(([_, v]) => v.length > 1);
if (dups.length > 0) {
  console.log(`\nDUPLICATES: ${dups.length}`);
  for (const [k, v] of dups) console.log(`  ${k}: ids=${v.map(r => r.id).join(",")}`);
} else {
  console.log(`\nNo duplicates on (product, supplier).`);
}

// Missing analysis: if count is under 21, show which product/supplier pairs are missing
if (rows.length < 21) {
  console.log(`\nCount is under 21 by ${21 - rows.length}.`);
}
