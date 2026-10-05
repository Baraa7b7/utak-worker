// § 55 (2026-10-05) — the strict schema gate of tests/s55-delivery.test.mts (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 54 dumped, after § 55's fields exist —
// x_daily_order_line.x_ordered_qty «الكمية المطلوبة», x_return_qty «المرتجع / غير المسلَّم» and
// x_return_reason «سبب المرتجع» (damaged / short / refused) — with the selection values. It is read AFTER
// tests/fixtures-odoo-fields-20261005-s54.json in the gate (the last one wins: the tenant's fields now).
//
// The file committed with § 55 ب's code is PROVISIONAL (the § 54 dump plus the three fields, written
// before they existed on the tenant): run this after `scripts/s55-20261005-odoo.mjs --apply`.
//
//   node scripts/s55-20261005-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261005-s55.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261005-s54.json (the tests read «the last fixture» as the full one)
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
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 55 (the delivery form's three fields on the order's line): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261005-s55.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const line = out.x_daily_order_line ?? [];
log(`x_daily_order_line: x_ordered_qty ${line.includes("x_ordered_qty")}, x_return_qty ${line.includes("x_return_qty")}, x_return_reason ${line.includes("x_return_reason")} → ${JSON.stringify(out._selections["x_daily_order_line.x_return_reason"])}`);
