// § 57 (2026-10-05) — the strict schema gate of the tests of § 57 (and of every test built on
// tests/s46-kit.mts): fields_get (read-only) of the models § 56 dumped, after § 57's fields exist — on
// x_complaint what the complaint form asks and what Baraa decides (x_kind, x_order_line_id,
// x_product_tmpl_id, x_affected_qty, x_photo, x_decision, x_decided_at), on res.partner x_cr_number —
// and, new in the gate, the models § 57's forms write for the first time or in a new way: x_complaint,
// x_payment, account.move and its lines, account.payment and its register wizard, ir.attachment. With
// the selection values. It is read AFTER tests/fixtures-odoo-fields-20261005-s56.json in the gate (the
// last one wins: the tenant's fields now). Written from the tenant after
// `scripts/s57-20261005-odoo.mjs --apply` (2026-10-05): run it again after any later change of fields.
//
//   node scripts/s57-20261005-fields-fixture.mjs
//
// Out: tests/fixtures-odoo-fields-20261005-s57.json
import { writeFileSync } from "node:fs";
import { call, log } from "./lib/s40-kit.mjs";

// the models of tests/fixtures-odoo-fields-20261005-s56.json (the tests read «the last fixture» as the full one), then § 57's
const MODELS = [
  "x_pricing_config", "x_price_day", "x_price_day_line", "x_operating_cost",
  "product.template", "product.category", "x_product_packaging",
  "x_daily_order", "x_daily_order_line", "x_quotation", "x_invoice",
  "res.partner", "hr.employee", "x_price_offer", "x_daily_price", "x_purchase_list",
  "x_whatsapp_template", "x_supplier_price_request_log", "x_wa_message",
  "account.journal", "res.partner.bank",
  "x_complaint", "x_payment", "account.move", "account.move.line", "account.payment", "account.payment.register", "ir.attachment",
];
const exists = new Set((await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["model"] })).map((m) => m.model));
const out = {
  _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 16)}Z (read-only), § 57 (the complaint's fields, x_cr_number; and x_complaint, x_payment, account.move, account.move.line, account.payment, account.payment.register, ir.attachment for the first time): every field of each model, and the selection values.`,
  _selections: {},
};
for (const m of MODELS.filter((x) => exists.has(x))) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  await new Promise((r) => setTimeout(r, 1200));
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20261005-s57.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
log(MODELS.map((m) => `${m}: ${out[m]?.length ?? "—"}`).join(", "));
const NEW = { x_complaint: ["x_kind", "x_order_line_id", "x_product_tmpl_id", "x_affected_qty", "x_photo", "x_decision", "x_decided_at"], "res.partner": ["x_cr_number"] };
for (const [m, names] of Object.entries(NEW)) log(`${names.every((n) => (out[m] ?? []).includes(n)) ? "✓" : "✗"} ${m}: ${names.map((n) => `${n} ${(out[m] ?? []).includes(n)}`).join(", ")}`);
