// § 40 (2026-09-26) — the strict schema gate of tests/pricing-v1.test.mts:
// fields_get (read-only) of every model the pricing engine v1 reads or writes,
// with the selection values. Run after each part's --apply; a model that does
// not exist yet is left out.
//
//   node scripts/s40-20260926-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20260926-s40.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

const MODELS = [
  "x_operating_cost", "x_pricing_config", "x_pricing_tier", "x_price_offer",
  "x_daily_price", "x_price_day", "x_price_day_line", "x_product_packaging", "product.template",
  "res.partner", "hr.employee", "resource.calendar.attendance",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice", "x_payment",
  "x_wa_message", "x_whatsapp_template", "x_supplier_price_request_log",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 40 (pricing engine v1): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260926-s40.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
