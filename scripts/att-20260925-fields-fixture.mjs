// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-attendance.json
// (the strict schema gate in tests/attendance.test.mts). Run after
// scripts/att-20260925-odoo-setup.mjs --apply.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const MODELS = ["x_team_attendance", "res.partner", "x_employee_role", "x_whatsapp_template", "x_wa_message",
  "x_purchase_list", "x_invoice", "x_delivery_route", "x_delivery_stop", "discuss.channel"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only). res.partner keeps x_ fields; base fields are allowed by the gate.`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  const names = Object.keys(f).filter((k) => m !== "res.partner" || k.startsWith("x_")).sort();
  out[m] = names;
  for (const k of names) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-attendance.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("x_team_attendance:", out.x_team_attendance.filter((k) => k.startsWith("x_")).join(","));
