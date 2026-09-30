// § 41 و (2026-09-26) — a read-only snapshot of the tenant's configuration the
// full-day simulation runs on (scripts/s41-full-day-sim.mts --odoo=fake seeds
// the in-memory Odoo of tests/wa-harness.mts with it): the active catalog and
// its packagings, the team (hr.employee, roles, schedules), the sources, the
// templates, the pricing settings, tiers and costs, the company and its tax.
// No business record (order, invoice, price) is read or written.
//
//   node scripts/s41-sim-snapshot.mjs
//
// Out: scripts/artifacts/s41-sim/tenant-snapshot.json
import { mkdirSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/json/2/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  const method = url.split("/").pop();
  if (!["search_read", "read", "fields_get", "search_count"].includes(method)) throw new Error(`BLOCKED (read-only): ${method}`);
  return real(input, init);
})(globalThis.fetch);

const out = {};
const sr = async (model, domain, fields, extra = {}) => (out[model] = await call(model, "search_read", { domain, fields, context: { active_test: false }, ...extra }));
const all = async (model, domain = []) => {
  const f = await call(model, "fields_get", { attributes: ["type", "store"] });
  const fields = Object.keys(f).filter((k) => f[k].store !== false && !["binary", "html"].includes(f[k].type) && !/^(message_|activity_|website_|__)/.test(k));
  return sr(model, domain, fields, { limit: 500 });
};

await all("product.template", [["active", "=", true], ["sale_ok", "=", true]]);
const tmplIds = out["product.template"].map((p) => p.id);
await all("x_product_packaging", [["x_product_tmpl_id", "in", tmplIds]]);
await all("hr.employee", [["active", "=", true]]);
// computed / related on hr.employee (not stored): read them explicitly
const extra = await call("hr.employee", "read", { ids: out["hr.employee"].map((e) => e.id), fields: ["resource_calendar_id", "x_utak_whatsapp", "work_contact_id"] });
for (const e of out["hr.employee"]) Object.assign(e, extra.find((x) => x.id === e.id) ?? {});
const partnerIds = [...new Set([...out["hr.employee"].map((e) => e.work_contact_id?.[0]).filter(Boolean), 30, 1])];
const owner = await call("res.partner", "search_read", { domain: [["x_whatsapp_number", "=", "+966505154962"]], fields: ["id"], limit: 5 });
for (const o of owner) partnerIds.push(o.id);
const bot = await call("res.partner", "search_read", { domain: [["name", "=", "UTAK بوت"]], fields: ["id"], limit: 1 });
for (const b of bot) partnerIds.push(b.id);
await all("res.partner", [["id", "in", [...new Set(partnerIds)]]]);
await all("x_employee_role");
const calIds = [...new Set(out["hr.employee"].map((e) => e.resource_calendar_id?.[0]).filter(Boolean))];
await all("resource.calendar", [["id", "in", calIds]]);
await all("resource.calendar.attendance", [["calendar_id", "in", calIds]]);
await all("resource.calendar.leaves", [["date_to", ">=", "2026-09-26 00:00:00"]]);
await all("x_whatsapp_template");
await all("x_pricing_config");
await all("x_pricing_tier");
await all("x_operating_cost");
await all("x_neighborhood");
out["res.company"] = await call("res.company", "read", { ids: [1], fields: ["id", "name", "vat", "account_sale_tax_id", "street", "city", "zip", "x_legal_name_ar"] });
const taxId = out["res.company"][0].account_sale_tax_id?.[0];
out["account.tax"] = taxId ? await call("account.tax", "read", { ids: [taxId], fields: ["id", "amount", "amount_type", "type_tax_use", "price_include", "active"] }) : [];
out["discuss.channel"] = await call("discuss.channel", "search_read", { domain: [["name", "=", "📋 مراجعة الأرقام"]], fields: ["id", "name", "channel_type"] });
out._at = new Date().toISOString();
mkdirSync(new URL("./artifacts/s41-sim/", import.meta.url), { recursive: true });
writeFileSync(new URL("./artifacts/s41-sim/tenant-snapshot.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(Object.entries(out).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${k}: ${v.length}`).join(", "));
