// § 49 (2026-10-01) — the strict schema gate of tests/s49.test.mts (and of every older test that runs
// the order path, the price engine or the price sources): fields_get (read-only) of the models § 48
// dumped, and of the models § 49 adds a field to, as they are after scripts/s49-20261001-odoo.mjs
// --apply (x_daily_order.x_price_date / x_awaiting_prices / x_immediate_delivery; x_price_role on
// res.partner and hr.employee; x_item_show / x_item_code on the price day's lines and on the sources'
// rows; x_sources_note), with the selection values. It takes the place of
// tests/fixtures-odoo-fields-20261001-s48.json in the tests' gates (the same models and more, the
// tenant's fields now).
//
//   node scripts/s49-20261001-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261001-s49.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
  "res.partner", "hr.employee", "x_price_offer", "x_daily_price", "x_purchase_list",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 49 (the order's price list and its wait for prices, the immediate delivery, the sources' role, the item's full name; the models of § 48 with them): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261001-s49.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
