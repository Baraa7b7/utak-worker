// § 54 (2026-10-05) — the strict schema gate of tests/s54.test.mts (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 53 dumped, after § 54's field exists —
// x_pricing_config.x_above_suggested «لما يكون السوق أعلى من المقترح» (market / suggested) — with the
// selection values. It is read AFTER tests/fixtures-odoo-fields-20261004-s53.json in the gate (the
// last one wins: the tenant's fields now).
//
//   node scripts/s54-20261005-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261005-s54.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261004-s51.json (the tests read «the last fixture» as the
// full one), and the two the transfer line reads besides
const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
  "res.partner", "hr.employee", "x_price_offer", "x_daily_price", "x_purchase_list",
  "x_whatsapp_template", "x_supplier_price_request_log", "x_wa_message",
  "account.journal", "res.partner.bank",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 54 (the setting «لما يكون السوق أعلى من المقترح»): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261005-s54.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
log(`x_pricing_config: x_above_suggested ${out.x_pricing_config.includes("x_above_suggested")} → ${JSON.stringify(out._selections["x_pricing_config.x_above_suggested"])}`);
