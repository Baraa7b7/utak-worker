// § 62 (2026-10-07) — read-only facts for «طلب أسعار خاص» (nothing is written):
// the customer by his number, the catalog (every product, active or not), the
// pricing settings, the sources' cards, the quotation model, the pricing menu.
//
//   node scripts/s62-20261007-diag.mjs > scripts/artifacts/logs/s62-diag.log 2>&1
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const show = (title, v) => console.log(`\n## ${title}\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);
const safe = async (title, fn) => { try { show(title, await fn()); } catch (e) { show(`${title} — FAILED`, String(e?.message ?? e).slice(0, 300)); } await pause(); };

await safe("partner by 530032939", () => call("res.partner", "search_read", {
  domain: ["|", "|", ["x_whatsapp_number", "ilike", "530032939"], ["phone", "ilike", "530032939"], ["name", "ilike", "مدارات"]],
  fields: ["id", "name", "phone", "x_whatsapp_number", "is_company", "customer_rank", "supplier_rank", "active"], context: ALL,
}));
await safe("partner fields (a real customer #105, and the sources #30 #109)", () => call("res.partner", "read", {
  ids: [105, 30, 109, 45], fields: ["id", "name", "phone", "x_whatsapp_number", "is_company", "customer_rank", "supplier_rank", "x_price_source", "x_price_role", "x_vat_registered", "x_wa_allowed", "x_utak_simulation", "x_contact_class", "x_review_pending"],
}));
await safe("res.partner fields x_* (name: type, required)", async () => {
  const f = await call("res.partner", "fields_get", { attributes: ["type", "string", "required", "selection"] });
  return Object.entries(f).filter(([k, v]) => k.startsWith("x_") || v.required).map(([k, v]) => `${k}: ${v.type}${v.required ? " REQUIRED" : ""} «${v.string}»${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
});
await safe("employees", () => call("hr.employee", "search_read", { domain: [], fields: ["id", "name", "work_contact_id", "job_id", "mobile_phone", "work_phone", "x_utak_role_ids"], context: ALL }));
await safe("product.template (all)", async () => {
  const rows = await call("product.template", "search_read", {
    domain: [], fields: ["id", "name", "active", "sale_ok", "purchase_ok", "x_is_active_for_sale", "categ_id", "uom_id", "taxes_id", "supplier_taxes_id", "default_code", "type", "x_name_en", "x_utak_new"],
    order: "id asc", limit: 500, context: ALL,
  });
  return rows.map((r) => `#${r.id} ${r.active ? "" : "(archived) "}«${r.name}» sale=${r.sale_ok} forSale=${r.x_is_active_for_sale} cat=${JSON.stringify(r.categ_id)} uom=${JSON.stringify(r.uom_id)} tax=${JSON.stringify(r.taxes_id)}/${JSON.stringify(r.supplier_taxes_id)} ref=${r.default_code} type=${r.type} new=${r.x_utak_new}`).join("\n");
});
await safe("product.template required/x_ fields", async () => {
  const f = await call("product.template", "fields_get", { attributes: ["type", "string", "required", "selection"] });
  return Object.entries(f).filter(([k, v]) => k.startsWith("x_") || v.required).map(([k, v]) => `${k}: ${v.type}${v.required ? " REQUIRED" : ""} «${v.string}»`).join("\n");
});
await safe("packagings", async () => {
  const rows = await call("x_product_packaging", "search_read", { domain: [], fields: ["id", "x_name", "x_product_tmpl_id", "x_type", "x_approx_weight_kg", "x_is_default", "x_sequence"], order: "x_product_tmpl_id asc, id asc", limit: 500, context: ALL });
  return rows.map((r) => `#${r.id} ${JSON.stringify(r.x_product_tmpl_id)} «${r.x_name}» ${r.x_type} ${r.x_approx_weight_kg}kg default=${r.x_is_default}`).join("\n");
});
await safe("x_product_packaging fields", async () => {
  const f = await call("x_product_packaging", "fields_get", { attributes: ["type", "string", "required", "selection"] });
  return Object.entries(f).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k}: ${v.type}${v.required ? " REQUIRED" : ""} «${v.string}»${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
});
await safe("categories", () => call("product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"], context: ALL }));
await safe("uom (kg and friends)", () => call("uom.uom", "search_read", { domain: ["|", ["name", "ilike", "kg"], ["name", "ilike", "كيلو"]], fields: ["id", "name"], context: ALL }));
await safe("pricing config #1", () => call("x_pricing_config", "read", { ids: [1], fields: ["x_waste_pct", "x_min_margin_pct", "x_min_profit_sar", "x_expected_cartons", "x_market_uplift_pct", "x_daily_profit_target", "x_workdays_calendar_id", "x_is_active"] }));
await safe("operating costs", () => call("x_operating_cost", "search_read", { domain: [], fields: ["id", "x_name", "x_amount", "x_frequency", "x_cost_type", "x_date_from", "x_date_to", "x_utak_simulation"], context: ALL }));
await safe("x_quotation fields", async () => {
  const f = await call("x_quotation", "fields_get", { attributes: ["type", "string", "required", "selection", "relation"] });
  return Object.entries(f).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k}: ${v.type}${v.required ? " REQUIRED" : ""} «${v.string}»${v.relation ? " → " + v.relation : ""}${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
});
await safe("x_quotation last 3", () => call("x_quotation", "search_read", { domain: [], fields: ["id", "x_name", "x_quotation_number", "x_order_id", "x_origin", "x_sent_at", "x_pdf_url", "create_date"], order: "id desc", limit: 3 }));
await safe("x_price_offer fields", async () => {
  const f = await call("x_price_offer", "fields_get", { attributes: ["type", "string", "required", "selection", "relation"] });
  return Object.entries(f).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k}: ${v.type}${v.required ? " REQUIRED" : ""} «${v.string}»${v.relation ? " → " + v.relation : ""}${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
});
await safe("pricing menu #582 children", () => call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 582]], fields: ["id", "name", "sequence", "action", "active"], order: "sequence asc", context: ALL }));
await safe("webhook server actions (name, model, url without token)", async () => {
  const rows = await call("ir.actions.server", "search_read", { domain: [["state", "=", "webhook"]], fields: ["id", "name", "model_name", "webhook_url"], order: "id asc", limit: 80 });
  return rows.map((r) => `#${r.id} ${r.name} [${r.model_name}] ${String(r.webhook_url ?? "").replace(/token=[^&]+/, "token=…")}`).join("\n");
});
await safe("automations on product.template", () => call("base.automation", "search_read", { domain: [["model_name", "=", "product.template"]], fields: ["id", "name", "trigger", "active", "action_server_ids", "trigger_field_ids", "filter_domain"], context: ALL }));
await safe("x_whatsapp_template rows for the flow ask / quotation pdf", () => call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "in", ["price_ask_flow", "customer_quotation_pdf_v2", "customer_quotation_pdf"]]], fields: ["id", "x_name", "x_purpose", "x_meta_status", "x_category"] }));
await safe("ir.model x_special*", () => call("ir.model", "search_read", { domain: [["model", "like", "x_special"]], fields: ["id", "model", "name"] }));
