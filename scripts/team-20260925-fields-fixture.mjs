// Read-only: fields_get on the tenant → tests/fixtures-odoo-fields-20260925-team.json
// (the strict schema gate in tests/team-hr.test.mts and tests/attendance.test.mts).
// Run after scripts/team-20260925-hr-setup.mjs --apply (STATUS § 31).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const MODELS = ["hr.employee", "resource.calendar", "resource.calendar.attendance", "resource.calendar.leaves",
  "resource.resource", "x_team_attendance", "x_employee_role"];
const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only). Every field of each model (not only x_).`, _selections: {} };
for (const m of MODELS) {
  const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
  out[m] = Object.keys(f).sort();
  for (const k of out[m]) {
    // tz lists 597 zones: the gate keeps only the value the worker writes
    if (f[k].type === "selection" && Array.isArray(f[k].selection)) {
      out._selections[`${m}.${k}`] = k === "tz" ? ["Asia/Riyadh"] : f[k].selection.map((s) => s[0]);
    }
  }
}
writeFileSync(new URL("../tests/fixtures-odoo-fields-20260925-team.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(MODELS.map((m) => `${m}: ${out[m].length}`).join(", "));
console.log("hr.employee x_:", out["hr.employee"].filter((k) => k.startsWith("x_")).join(","));
console.log("x_team_attendance x_:", out.x_team_attendance.filter((k) => k.startsWith("x_")).join(","));
