// § 46 (2026-10-01) — read-only exploration of the tenant before the five parts (search_read /
// fields_get only): the price-day models and their views, the UTAK menu, the products (references,
// categories, taxes, type, units, the default packaging), and the Odoo WhatsApp module.
//
//   node scripts/s46-20261001-explore.mjs
//
// Out: scripts/artifacts/s46-20261001-explore.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const out = { atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };
const log = (...a) => console.log(...a);
const ALL = { active_test: false };

// ---- price day models
for (const m of ["x_price_day", "x_price_day_line", "x_pricing_config"]) {
  const f = await call("ir.model.fields", "search_read", { domain: [["model", "=", m]], fields: ["id", "name", "ttype", "field_description", "store", "compute", "relation"], order: "id asc" });
  out[`fields:${m}`] = f;
  log(`${m}: ${f.length} fields — ${f.filter((x) => x.name.startsWith("x_")).map((x) => `${x.name}#${x.id}`).join(" ")}`);
}
out.views = await call("ir.ui.view", "search_read", { domain: [["model", "in", ["x_price_day", "x_price_day_line", "x_pricing_config", "product.template", "x_product_packaging"]], ["name", "ilike", "utak"]], fields: ["id", "name", "model", "type", "priority", "inherit_id", "active"], order: "id asc", context: ALL });
for (const v of out.views) log(`view #${v.id} ${v.model} ${v.type} «${v.name}» p${v.priority}${v.inherit_id ? ` inherits ${v.inherit_id[0]}` : ""}${v.active ? "" : " (inactive)"}`);
out.windows = await call("ir.actions.act_window", "search_read", { domain: [["res_model", "in", ["x_price_day", "x_price_day_line", "x_pricing_config"]]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id"], context: ALL });
for (const w of out.windows) log(`act_window #${w.id} «${w.name}» ${w.res_model} ${w.view_mode} ctx=${w.context} dom=${w.domain}`);
out.menus = await call("ir.ui.menu", "search_read", { domain: ["|", ["id", "=", 529], ["parent_id", "child_of", 529]], fields: ["id", "name", "parent_id", "sequence", "action", "active", "group_ids"], order: "parent_id, sequence, id", context: ALL });
for (const m of out.menus) log(`menu #${m.id} «${m.name}» parent ${m.parent_id ? m.parent_id[0] : "-"} seq ${m.sequence} action ${m.action || "-"}${m.active ? "" : " (inactive)"}`);
out.automations = await call("base.automation", "search_read", { domain: [], fields: ["id", "name", "model_id", "trigger", "active", "filter_domain", "filter_pre_domain", "trigger_field_ids", "action_server_ids"], order: "id asc", context: ALL });
for (const a of out.automations) log(`automation #${a.id} «${a.name}» ${a.model_id?.[1]} ${a.trigger}${a.active ? "" : " (off)"} actions ${a.action_server_ids}`);
out.config = await call("x_pricing_config", "search_read", { domain: [], fields: [], context: ALL });

// ---- products
const pf = await call("product.template", "fields_get", { attributes: ["type", "string", "relation", "selection"] });
const want = ["id", "name", "default_code", "categ_id", "type", "is_storable", "uom_id", "uom_po_id", "purchase_method", "invoice_policy", "taxes_id", "supplier_taxes_id", "sale_ok", "purchase_ok", "active",
  "x_is_active_for_sale", "x_name_en", "x_margin_pct", "tracking", "list_price", "standard_price", "service_type", "expense_policy", "create_date", "seller_ids"].filter((f) => f in pf);
out.productFieldsRead = want;
out.productCustomFields = Object.entries(pf).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k} (${v.type}) ${v.string}`);
log(`product.template custom: ${out.productCustomFields.join(" | ")}`);
out.products = await call("product.template", "search_read", { domain: [], fields: want, order: "id asc", context: ALL });
for (const p of out.products) log(`#${p.id} [${p.default_code || "—"}] ${p.name} · ${p.categ_id?.[1]} · ${p.type}${p.is_storable ? "+stor" : ""} · uom ${p.uom_id?.[1]} · pm ${p.purchase_method} · tax ${p.taxes_id}/${p.supplier_taxes_id} · sale ${p.sale_ok} act ${p.active} afs ${p.x_is_active_for_sale} · en ${p.x_name_en || "—"}`);
out.categories = await call("product.category", "search_read", { domain: [], fields: ["id", "name", "complete_name", "parent_id"], order: "id asc" });
log(`categories: ${out.categories.map((c) => `#${c.id} ${c.complete_name}`).join(" | ")}`);
out.taxes = await call("account.tax", "search_read", { domain: [], fields: ["id", "name", "type_tax_use", "amount", "price_include_override", "active"], order: "id asc", context: ALL });
log(`taxes: ${out.taxes.filter((t) => t.active).map((t) => `#${t.id} ${t.name} ${t.type_tax_use} ${t.amount}`).join(" | ")}`);
const kf = await call("x_product_packaging", "fields_get", { attributes: ["type", "string", "relation"] });
out.packagingFields = Object.entries(kf).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k} (${v.type}) ${v.string}`);
log(`x_product_packaging: ${out.packagingFields.join(" | ")}`);
out.packagings = await call("x_product_packaging", "search_read", { domain: [], fields: Object.keys(kf).filter((k) => k.startsWith("x_")), order: "id asc", context: ALL });
log(`packagings: ${out.packagings.length}`);
out.irDefaults = await call("ir.default", "search_read", { domain: [], fields: ["id", "field_id", "json_value", "user_id", "company_id"], order: "id asc" });
for (const d of out.irDefaults) log(`ir.default #${d.id} ${d.field_id?.[1]} = ${d.json_value}`);

// ---- the Odoo WhatsApp module
out.modules = await call("ir.module.module", "search_read", { domain: [["name", "ilike", "whatsapp"]], fields: ["name", "state", "shortdesc"] });
log(`modules: ${out.modules.map((m) => `${m.name}=${m.state}`).join(" | ")}`);
out.waModels = await call("ir.model", "search_read", { domain: [["model", "=like", "whatsapp.%"]], fields: ["id", "model", "name"] });
log(`whatsapp.* models: ${out.waModels.map((m) => m.model).join(", ") || "none"}`);
out.waMenus = await call("ir.ui.menu", "search_read", { domain: [["name", "ilike", "whatsapp"]], fields: ["id", "name", "complete_name", "parent_id", "action", "active", "group_ids", "web_icon"], context: ALL });
for (const m of out.waMenus) log(`wa menu #${m.id} «${m.complete_name}» parent ${m.parent_id ? m.parent_id[0] : "-"} groups ${m.group_ids} active ${m.active} icon ${m.web_icon || "-"}`);
out.rootMenus = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", false]], fields: ["id", "name", "active", "group_ids", "web_icon", "sequence"], order: "sequence", context: ALL });
for (const m of out.rootMenus) log(`root #${m.id} «${m.name}» active ${m.active} groups ${m.group_ids}`);

writeFileSync(new URL("./artifacts/s46-20261001-explore.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
