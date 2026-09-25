// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-review.json
// (the strict schema gate in tests/review.test.mts). Run after
// scripts/rev-20260925-odoo-setup.mjs --apply.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const MODELS = ["res.partner", "x_wa_message", "x_daily_order", "x_daily_order_line", "x_message_analysis", "discuss.channel",
  "discuss.channel.member", "x_employee_role", "x_team_attendance", "x_standing_order", "x_invoice", "x_payment", "x_whatsapp_template"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after rev-20260925-odoo-setup. res.partner keeps x_ fields; base fields are allowed by the gate.`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  const names = Object.keys(f).filter((k) => m !== "res.partner" || k.startsWith("x_")).sort();
  out[m] = names;
  for (const k of names) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-review.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("res.partner review fields:", out["res.partner"].filter((k) => /x_contact_class|x_ai_|x_review_/.test(k)).join(","));
