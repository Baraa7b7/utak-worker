// § 42 (2026-09-27) — the strict schema gate of tests/s42.test.mts:
// fields_get (read-only) of every model the § 42 parts reads or writes,
// with the selection values. Run after each part's --apply; a model that does
// not exist yet is left out.
//
//   node scripts/s42-20260927-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20260927-s42.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

const MODELS = [
  "x_operating_cost", "x_pricing_config", "x_pricing_tier", "x_price_offer",
  "x_daily_price", "x_price_day", "x_price_day_line", "x_product_packaging", "product.template",
  "res.partner", "hr.employee", "resource.calendar.attendance", "x_team_attendance",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice", "x_payment",
  "x_purchase_list", "x_supplier_payment", "x_delivery_route", "x_delivery_stop",
  "x_wa_message", "x_whatsapp_template", "x_supplier_price_request_log", "x_message_analysis",
  // § 42: the dues, the accounting twins of a collection, and the sequences
  "x_supplier_due", "x_supplier_due_line", "account.move", "account.payment", "account.payment.register", "account.journal",
  "account.move.line", "account.account", "ir.sequence", "ir.sequence.date_range", "x_standing_order",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 42 (the launch: cash-market supplier, partial collection, pre-launch cleanup): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260927-s42.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
