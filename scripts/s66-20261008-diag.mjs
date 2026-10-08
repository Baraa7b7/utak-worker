// § 66 (2026-10-08) — read-only facts before «العميل وافق ← طلب» (nothing is written):
//
//   node scripts/s66-20261008-diag.mjs > scripts/artifacts/logs/s66-diag.log 2>&1
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const show = (title, v) => console.log(`\n## ${title}\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);
const safe = async (title, fn) => { try { show(title, await fn()); } catch (e) { show(`${title} — FAILED`, String(e?.message ?? e).slice(0, 400)); } await pause(); };
const fieldsOf = async (model, pick) => {
  const f = await call(model, "fields_get", { attributes: ["type", "string", "required", "selection", "relation", "store", "readonly"] });
  return Object.entries(f).filter(([k, v]) => pick(k, v)).map(([k, v]) => `${k}: ${v.type}${v.relation ? `→${v.relation}` : ""}${v.store === false ? " (not stored)" : ""}${v.required ? " REQUIRED" : ""} «${v.string}»${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
};
const mask = (s) => String(s ?? "").replace(/(token=)[^&"'\s<]+/g, "$1<masked>").replace(/([?&](?:secret|key|sig)=)[^&"'\s<]+/g, "$1<masked>");
const viewsOf = async (model) => (await call("ir.ui.view", "search_read", { domain: [["model", "=", model]], fields: ["id", "name", "type", "inherit_id", "active", "priority", "mode", "arch_db"], order: "id asc", context: ALL }))
  .map((v) => `#${v.id} ${v.active ? "" : "(off) "}${v.name} ${v.type} ${v.mode} prio=${v.priority} inherit=${JSON.stringify(v.inherit_id)}\n${v.arch_db}`).join("\n\n");

await safe("x_daily_order fields", () => fieldsOf("x_daily_order", (k) => k.startsWith("x_")));
await safe("x_daily_order_line fields", () => fieldsOf("x_daily_order_line", (k) => k.startsWith("x_")));
await safe("x_special_quote fields", () => fieldsOf("x_special_quote", (k) => k.startsWith("x_")));
await safe("x_special_quote_line fields", () => fieldsOf("x_special_quote_line", (k) => k.startsWith("x_")));
await safe("x_purchase_list fields", () => fieldsOf("x_purchase_list", (k) => k.startsWith("x_")));
await safe("x_product_packaging fields", () => fieldsOf("x_product_packaging", (k) => k.startsWith("x_")));
await safe("x_pricing_config x_* fields", () => fieldsOf("x_pricing_config", (k) => k.startsWith("x_")));
await safe("sale.order x_* fields", () => fieldsOf("sale.order", (k) => k.startsWith("x_")));
await safe("res.partner pay fields", () => fieldsOf("res.partner", (k) => /^x_pay|^x_customer_type|^x_preferred/.test(k)));

await safe("views on x_special_quote", () => viewsOf("x_special_quote"));
await safe("views on x_special_quote_line", () => viewsOf("x_special_quote_line"));
await safe("views on x_daily_order", () => viewsOf("x_daily_order"));
await safe("views on x_daily_order_line", () => viewsOf("x_daily_order_line"));
await safe("views on x_pricing_config", () => viewsOf("x_pricing_config"));
await safe("utak views on sale.order", async () => (await call("ir.ui.view", "search_read", { domain: [["model", "=", "sale.order"], ["name", "like", "utak"]], fields: ["id", "name", "type", "inherit_id", "active", "priority", "mode", "arch_db"], context: ALL })).map((v) => `#${v.id} ${v.active ? "" : "(off) "}${v.name} ${v.type} ${v.mode} inherit=${JSON.stringify(v.inherit_id)}\n${v.arch_db}`).join("\n\n"));

await safe("act_windows on x_special_quote / x_daily_order", () => call("ir.actions.act_window", "search_read", { domain: [["res_model", "in", ["x_special_quote", "x_daily_order"]]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "search_view_id", "view_id"], context: ALL }));
await safe("server actions on x_special_quote / sale.order / x_special_quote_line (masked)", async () => (await call("ir.actions.server", "search_read", { domain: [["model_name", "in", ["x_special_quote", "x_special_quote_line", "sale.order"]]], fields: ["id", "name", "state", "model_name", "webhook_url", "webhook_field_ids", "code", "binding_model_id"], context: ALL }))
  .map((r) => `#${r.id} ${r.name} [${r.state}] ${r.model_name} bind=${JSON.stringify(r.binding_model_id)} fields=${JSON.stringify(r.webhook_field_ids)}\n url=${mask(r.webhook_url)}\n code=${mask(String(r.code || "").slice(0, 1500))}`).join("\n\n"));
await safe("automations on x_special_quote / line / x_daily_order / sale.order", () => call("base.automation", "search_read", { domain: [["model_name", "in", ["x_special_quote_line", "x_special_quote", "x_daily_order", "x_daily_order_line", "sale.order"]]], fields: ["id", "name", "active", "trigger", "model_name", "trigger_field_ids", "action_server_ids", "filter_domain", "filter_pre_domain"], context: ALL }));
await safe("x_special_quote.x_state selection rows", async () => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_special_quote"], ["name", "=", "x_state"]], fields: ["id", "selection_ids", "field_description"] });
  return f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f.id]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [];
});
await safe("x_daily_order.x_created_via selection rows", async () => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_daily_order"], ["name", "=", "x_created_via"]], fields: ["id", "selection_ids", "field_description"] });
  return f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f.id]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [];
});

await safe("the special quotes (state only)", async () => (await call("x_special_quote", "search_read", { domain: [], fields: ["id", "x_name", "x_partner_id", "x_state", "x_valid_until", "x_sale_order_id", "x_quotation_number", "x_price_mode", "x_layout", "x_utak_simulation", "x_issued_at", "x_line_ids"], order: "id asc", context: ALL }))
  .map((q) => `#${q.id} ${q.x_name} partner=${JSON.stringify(q.x_partner_id)} state=${q.x_state} valid=${q.x_valid_until} so=${JSON.stringify(q.x_sale_order_id)} no=${q.x_quotation_number} mode=${q.x_price_mode} layout=${q.x_layout} sim=${q.x_utak_simulation ? 1 : 0} issued=${q.x_issued_at} lines=${q.x_line_ids.length}`).join("\n"));
await safe("sale orders that came from special quotes (read only)", async () => (await call("sale.order", "search_read", { domain: [["origin", "like", "SQ-"]], fields: ["id", "name", "state", "partner_id", "origin", "amount_untaxed", "amount_tax", "amount_total", "validity_date", "order_line", "picking_ids", "invoice_status", "locked"], order: "id asc", context: ALL }))
  .map((s) => `#${s.id} ${s.name} ${s.state} ${JSON.stringify(s.partner_id)} origin=${s.origin} untaxed=${s.amount_untaxed} tax=${s.amount_tax} total=${s.amount_total} valid=${s.validity_date} lines=${s.order_line.length} pickings=${JSON.stringify(s.picking_ids)} inv=${s.invoice_status} locked=${s.locked}`).join("\n"));
await safe("sale.order.line of S00016's kind: products and their types", async () => {
  const [so] = await call("sale.order", "search_read", { domain: [["name", "=", "S00016"]], fields: ["id", "order_line"], limit: 1 });
  if (!so) return "no S00016";
  const lines = await call("sale.order.line", "read", { ids: so.order_line, fields: ["id", "sequence", "product_id", "product_template_id", "product_uom_qty", "price_unit", "tax_ids", "price_subtotal", "price_tax", "price_total", "qty_delivered_method", "x_pack_text", "x_packaging_id", "product_uom_id", "display_type"] });
  const tmpl = [...new Set(lines.map((l) => l.product_template_id?.[0]).filter(Boolean))];
  const t = await call("product.template", "read", { ids: tmpl, fields: ["id", "name", "type", "is_storable", "invoice_policy", "service_type", "x_is_active_for_sale", "active", "uom_id", "x_packaging_ids", "taxes_id", "categ_id"] });
  return { lines: lines.map((l) => `L#${l.id} seq=${l.sequence} p=${JSON.stringify(l.product_id)} qty=${l.product_uom_qty} pu=${l.price_unit} tax=${JSON.stringify(l.tax_ids)} sub=${l.price_subtotal} tax=${l.price_tax} tot=${l.price_total} qdm=${l.qty_delivered_method} pack=${l.x_pack_text} pk=${JSON.stringify(l.x_packaging_id)} uom=${JSON.stringify(l.product_uom_id)}`), templates: t.map((p) => `T#${p.id} «${p.name}» type=${p.type} storable=${p.is_storable} inv=${p.invoice_policy} svc=${p.service_type} active_sale=${p.x_is_active_for_sale} active=${p.active} uom=${JSON.stringify(p.uom_id)} packs=${JSON.stringify(p.x_packaging_ids)} taxes=${JSON.stringify(p.taxes_id)}`) };
});
await safe("the service products of the accounting sync", async () => (await call("product.product", "search_read", { domain: [["default_code", "in", ["UTAK-SALE-GOODS", "UTAK-PUR-GOODS"]]], fields: ["id", "default_code", "name", "type", "is_storable", "invoice_policy", "service_type", "product_tmpl_id"], context: ALL })));
await safe("a few catalog products: type and packaging", async () => (await call("product.template", "search_read", { domain: [["default_code", "like", "UTAK-"]], fields: ["id", "default_code", "name", "type", "is_storable", "invoice_policy", "x_is_active_for_sale", "x_packaging_ids", "uom_id"], order: "id asc", limit: 12 }))
  .map((p) => `T#${p.id} ${p.default_code} «${p.name}» type=${p.type} storable=${p.is_storable} inv=${p.invoice_policy} sale=${p.x_is_active_for_sale} packs=${JSON.stringify(p.x_packaging_ids)} uom=${JSON.stringify(p.uom_id)}`).join("\n"));
await safe("count of product types among catalog", async () => {
  const out = {};
  for (const t of ["consu", "service", "combo"]) { out[t] = await call("product.template", "search_count", { domain: [["type", "=", t]], context: ALL }); await pause(300); }
  out.storable = await call("product.template", "search_count", { domain: [["is_storable", "=", true]], context: ALL });
  return out;
});
await safe("packagings of the special-quote products (#115–#127) and of SQ-0003's lines", async () => {
  const ql = await call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "in", [2, 3]]], fields: ["id", "x_quote_id", "x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_final_price", "x_final_net", "x_total"], order: "x_quote_id asc, x_sequence asc, id asc", limit: 80 });
  const tmpl = [...new Set(ql.map((l) => l.x_product_tmpl_id?.[0]).filter(Boolean))];
  const packs = await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", tmpl]], fields: ["id", "x_name", "x_product_tmpl_id", "x_type", "x_approx_weight_kg", "x_is_default", "x_sequence"], order: "x_product_tmpl_id asc, x_sequence asc, id asc", limit: 300, context: ALL });
  return { lines: ql.map((l) => `Q${l.x_quote_id?.[0]} L#${l.id} ${JSON.stringify(l.x_product_tmpl_id)} qty=${l.x_qty} unit=«${l.x_unit}» buy=${l.x_purchase_price} final=${l.x_final_price} net=${l.x_final_net} total=${l.x_total}`), packs: packs.map((p) => `PK#${p.id} «${p.x_name}» tmpl=${p.x_product_tmpl_id?.[0]} type=${p.x_type} kg=${p.x_approx_weight_kg} default=${p.x_is_default}`) };
});
await safe("installed modules that matter", async () => (await call("ir.module.module", "search_read", { domain: [["name", "in", ["stock", "sale_stock", "sale_management", "sale", "purchase", "purchase_stock", "sale_purchase", "account"]]], fields: ["name", "state"] })).map((m) => `${m.name}=${m.state}`).join(" "));
await safe("the workdays calendar on the settings", async () => {
  const cfg = await call("x_pricing_config", "search_read", { domain: [], fields: ["id", "x_name", "x_is_active", "x_workdays_calendar_id", "x_expected_cartons", "x_planned_stops"], context: ALL });
  const cal = cfg.find((c) => c.x_workdays_calendar_id)?.x_workdays_calendar_id?.[0];
  const att = cal ? await call("resource.calendar.attendance", "search_read", { domain: [["calendar_id", "=", cal]], fields: ["id", "name", "dayofweek", "hour_from", "hour_to", "day_period"], order: "dayofweek asc, hour_from asc" }) : [];
  return { cfg, days: att.map((a) => `${a.dayofweek} ${a.hour_from}-${a.hour_to} ${a.day_period}`) };
});
await safe("simulation customers", async () => (await call("res.partner", "search_read", { domain: [["x_utak_simulation", "=", true]], fields: ["id", "name", "active", "x_whatsapp_number", "x_pay_terms", "customer_rank", "x_contact_class"], order: "id asc", limit: 60, context: ALL }))
  .map((p) => `#${p.id} ${p.active ? "" : "(archived) "}«${p.name}» wa=${p.x_whatsapp_number ? String(p.x_whatsapp_number).slice(0, 6) + "…" : "-"} pay=${p.x_pay_terms || "-"} cust=${p.customer_rank} class=${p.x_contact_class || "-"}`).join("\n"));
await safe("pay terms of the real customers and of Madarat", () => call("res.partner", "read", { ids: [31, 105, 111], fields: ["id", "name", "x_pay_terms", "x_utak_simulation"] }));
await safe("menus under «💲 التسعير» (#582)", () => call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 582]], fields: ["id", "name", "action", "sequence", "active"], order: "sequence asc, id asc", context: ALL }));
await safe("the last daily orders (shape)", async () => (await call("x_daily_order", "search_read", { domain: [], fields: ["id", "x_name", "x_customer_id", "x_order_date", "x_price_date", "x_state", "x_created_via", "x_sale_order_id", "x_total_amount", "x_utak_simulation", "x_immediate_delivery", "x_delivery_notes"], order: "id desc", limit: 6, context: ALL })));
await safe("the last purchase lists (shape)", async () => (await call("x_purchase_list", "search_read", { domain: [], fields: ["id", "x_name", "x_date", "x_status", "x_supplier_id", "x_total_items_count", "x_aggregated_items", "x_utak_simulation", "x_notes"], order: "id desc", limit: 3, context: ALL })).map((l) => ({ ...l, x_aggregated_items: String(l.x_aggregated_items || "").slice(0, 700), x_notes: String(l.x_notes || "").slice(0, 200) })));
await safe("the whatsapp template rows of the suppliers' outreach", () => call("x_whatsapp_template", "search_read", { domain: [["x_name", "like", "supplier_"]], fields: ["id", "x_name", "x_purpose", "x_status", "x_category", "x_language", "x_is_active"], context: ALL }));
