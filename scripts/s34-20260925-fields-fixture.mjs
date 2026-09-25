// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-opener.json
// (the strict schema gate for «فتح المحادثة», STATUS § 34). Run after
// scripts/s34-20260925-odoo.mjs --apply: x_whatsapp_template.x_purpose carries
// conv_open_* and customer_payment_received.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const MODELS = ["x_wa_message", "x_whatsapp_template", "res.partner", "x_payment", "x_invoice", "x_delivery_stop", "x_daily_order", "x_message_analysis"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only). Every field of each model (not only x_).`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) {
    if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  }
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-opener.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("x_purpose:", out._selections["x_whatsapp_template.x_purpose"].filter((v) => /conv_open|payment_received/.test(v)).join(","));
