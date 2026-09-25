// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-s36.json
// (the strict schema gate after § 36: x_whatsapp_template.x_body_text /
// x_buttons_text, x_wa_message.x_echo_status / x_echo_message_id / x_backfilled).
// Run after scripts/s36-20260925-odoo.mts --apply.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const MODELS = ["x_wa_message", "x_whatsapp_template"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after § 36. Every field of each model.`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) {
    if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  }
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-s36.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("x_echo_status:", out._selections["x_wa_message.x_echo_status"].join(","));
