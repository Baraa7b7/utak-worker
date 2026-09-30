// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-gateway.json
// (the strict schema gate for the send gateway, STATUS § 33). Run after
// scripts/gw-20260925-odoo-status.mjs --apply: x_wa_message.x_status carries
// held / expired / skipped.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const MODELS = ["x_wa_message", "x_whatsapp_template"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only). Every field of each model (not only x_).`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) {
    if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  }
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-gateway.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("x_wa_message.x_status:", out._selections["x_wa_message.x_status"].join(","));
