// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-s37.json
// (the strict schema gate after § 37: x_supplier_payment, x_supplier_due,
// x_supplier_due_line, the supplier fields of res.partner, x_purchase_list,
// x_daily_price, and x_whatsapp_template's x_purpose with supplier_payment_sent).
// Run after scripts/s37-20260925-odoo.mjs --apply.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const MODELS = ["x_supplier_payment", "x_supplier_due", "x_supplier_due_line", "x_purchase_list", "x_daily_price", "x_whatsapp_template"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after § 37. Every field of each model (res.partner: its x_sp_* fields).`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) {
    if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  }
}
const pf = await call("res.partner", "fields_get", { attributes: ["type"] });
out["res.partner.x_sp"] = Object.keys(pf).filter((k) => k.startsWith("x_sp_")).sort();
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-s37.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "), "· res.partner x_sp_*:", out["res.partner.x_sp"].join(","));
console.log("x_state:", out._selections["x_supplier_payment.x_state"].join(","), "· purpose has supplier_payment_sent:", out._selections["x_whatsapp_template.x_purpose"].includes("supplier_payment_sent"));
