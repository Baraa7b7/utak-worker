// STATUS § 35 — list_price / standard_price of every product (active or not),
// read-only. § 35 never writes either: run before and after, then compare.
//
//   node scripts/s35-20260925-list-price-snapshot.mjs before|after
//   node scripts/s35-20260925-list-price-snapshot.mjs compare
//
// Out: scripts/artifacts/s35-20260925-list-price-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const label = process.argv[2] ?? "before";
const path = (l) => new URL(`./artifacts/s35-20260925-list-price-${l}.json`, import.meta.url);
if (label === "compare") {
  const a = JSON.parse(readFileSync(path("before"), "utf8"));
  const b = JSON.parse(readFileSync(path("after"), "utf8"));
  const byId = new Map(b.products.map((p) => [p.id, p]));
  const diff = [];
  for (const p of a.products) {
    const q = byId.get(p.id);
    if (!q) { diff.push({ id: p.id, missing: true }); continue; }
    for (const k of ["list_price", "standard_price"]) if (p[k] !== q[k]) diff.push({ id: p.id, name: p.name, field: k, before: p[k], after: q[k] });
  }
  const out = { before: a.at, after: b.at, products: a.products.length, afterProducts: b.products.length, differences: diff };
  writeFileSync(path("compare"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  process.exit(diff.length ? 1 : 0);
}
const products = await call("product.template", "search_read", {
  domain: [], fields: ["id", "name", "list_price", "standard_price", "active"], context: { active_test: false }, order: "id", limit: 1000,
});
writeFileSync(path(label), JSON.stringify({ label, at: new Date().toISOString(), products }, null, 2) + "\n");
console.log(`${label}: ${products.length} products, Σlist_price=${products.reduce((t, p) => t + (p.list_price || 0), 0).toFixed(2)}, Σstandard_price=${products.reduce((t, p) => t + (p.standard_price || 0), 0).toFixed(2)}`);
