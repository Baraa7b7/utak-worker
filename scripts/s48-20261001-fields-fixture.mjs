// § 48 (2026-10-01) — the strict schema gate of tests/s48.test.mts (and of every older test that runs
// the price engine or reads the pricing settings): fields_get (read-only) of the models § 46 dumped,
// as they are after scripts/s48-20261001-odoo.mjs --apply (x_pricing_config.x_min_profit_sar; x_price_day_line.x_preview_sale /
// x_preview_profit / x_manual_for and the «—» display texts; the fields of § 47 with them), with the selection
// values. It takes the place of tests/fixtures-odoo-fields-20261001-s47.json in the tests' gates
// (the same models, the tenant's fields now).
//
//   node scripts/s48-20261001-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261001-s48.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 48 (the fixed minimum profit, the preview, the «—» texts; the models of § 46 and § 47): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261001-s48.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
