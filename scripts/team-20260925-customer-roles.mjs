// Read-only inventory (STATUS § 31): the «Customer» rows in x_employee_role and
// the partners linked to each. ensureCustomerRoleId searched without the
// archived rows (x_active is the model's active field) and created a new,
// archived row on every cold cache; createCustomer linked it to every new
// WhatsApp partner. Nothing is merged or deleted here — Baraa decides.
//   node scripts/team-20260925-customer-roles.mjs   → scripts/artifacts/team-20260925-customer-roles.{json,md}
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const ctx = { active_test: false };
const roles = await call("x_employee_role", "search_read", { domain: [["x_code", "=", "customer"]], fields: ["id", "x_name", "x_code", "x_active", "create_date"], order: "id asc", context: ctx });
const out = [];
for (const r of roles) {
  const partners = await call("res.partner", "search_read", {
    domain: [["x_role_ids", "in", [r.id]]], fields: ["id", "name", "active", "x_whatsapp_number", "customer_rank", "x_contact_class", "create_date"], order: "id asc", context: ctx,
  });
  out.push({ ...r, partners });
}
const all = await call("x_employee_role", "search_read", { domain: [], fields: ["id", "x_code", "x_active"], order: "id asc", context: ctx });
const res = { at: new Date().toISOString(), customerRows: out.length, allRoles: all, rows: out };
writeFileSync(new URL("./artifacts/team-20260925-customer-roles.json", import.meta.url), JSON.stringify(res, null, 1) + "\n");
const md = [
  "| صف الدور | أُنشئ (UTC) | نشط | الشريك المرتبط | الشريك نشط | الرقم | التصنيف |",
  "|---|---|---|---|---|---|---|",
  ...out.flatMap((r) => (r.partners.length ? r.partners : [null]).map((p) =>
    `| ${r.id} | ${r.create_date} | ${r.x_active ? "نعم" : "لا (مؤرشف)"} | ${p ? `${p.name} (${p.id})` : "—"} | ${p ? (p.active ? "نعم" : "لا") : "—"} | ${p?.x_whatsapp_number ? "…" + String(p.x_whatsapp_number).slice(-4) : "—"} | ${p?.x_contact_class || "—"} |`)),
];
writeFileSync(new URL("./artifacts/team-20260925-customer-roles.md", import.meta.url), md.join("\n") + "\n");
console.log(md.join("\n"));
console.log(`\n${out.length} customer rows; partners linked: ${out.reduce((n, r) => n + r.partners.length, 0)}`);
