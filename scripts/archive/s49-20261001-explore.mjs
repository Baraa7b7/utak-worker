// § 49 (2026-10-01) — read-only exploration of the tenant before the parts (search_read / read /
// fields_get / get_views only): the order models' fields, the settings record and its minimum order,
// the price sources and what tells their role today, the price days, the real open orders, the views
// of «💲 التسعير» as the tenant stores them, the templates the quotation and the prices go out with.
//
//   node scripts/archive/s49-20261001-explore.mjs
//
// Out: scripts/artifacts/s49-20261001-explore.json
import { writeFileSync } from "node:fs";
import { call } from "../lib/odoo-cli.mjs";

const out = { atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };
const log = (...a) => console.log(...a);
const ALL = { active_test: false };
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));

// ---- fields of the order path's models
const MODELS = ["x_daily_order", "x_daily_order_line", "x_quotation", "x_delivery_stop", "x_delivery_route", "x_purchase_list", "x_pricing_config", "x_price_day", "x_price_day_line", "x_price_offer", "x_daily_price", "x_invoice"];
for (const m of MODELS) {
  const f = await call("ir.model.fields", "search_read", { domain: [["model", "=", m]], fields: ["id", "name", "ttype", "field_description", "store", "readonly", "relation", "related", "compute", "required"], order: "id asc" });
  out[`fields:${m}`] = f;
  log(`${m}: ${f.filter((x) => x.name.startsWith("x_")).map((x) => `${x.name}#${x.id}(${x.ttype}${x.compute ? ",compute" : ""}${x.related ? `,rel=${x.related}` : ""})`).join(" ")}`);
  await pause(600);
}
out.selections = await call("ir.model.fields.selection", "search_read", { domain: [["field_id.model", "in", ["x_daily_order", "x_daily_order_line", "x_quotation", "x_delivery_stop", "x_purchase_list", "x_price_day"]]], fields: ["id", "field_id", "value", "name", "sequence"], order: "field_id, sequence, id" });
for (const s of out.selections) log(`  selection ${s.field_id?.[1]} · ${s.value} «${s.name}» #${s.id}`);
await pause();

// ---- the price-source fields on the partner and the employee
for (const m of ["res.partner", "hr.employee"]) {
  const f = await call("ir.model.fields", "search_read", { domain: [["model", "=", m], ["name", "like", "x_"]], fields: ["id", "name", "ttype", "field_description", "store", "related", "compute"], order: "id asc" });
  out[`fields:${m}`] = f;
  log(`${m}: ${f.map((x) => `${x.name}#${x.id}(${x.ttype})`).join(" ")}`);
  await pause(600);
}
out.sourcePartners = await call("res.partner", "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name", "supplier_rank", "customer_rank", "x_whatsapp_number", "x_vat_registered", "active", "ref"], context: ALL });
out.sourceEmployees = await call("hr.employee", "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name", "work_contact_id", "x_utak_whatsapp", "x_vat_registered", "active"], context: ALL });
for (const p of out.sourcePartners) log(`  source partner #${p.id} ${p.name} · supplier_rank ${p.supplier_rank} · ref ${p.ref} · active ${p.active}`);
for (const e of out.sourceEmployees) log(`  source employee #${e.id} ${e.name} · work contact ${JSON.stringify(e.work_contact_id)} · active ${e.active}`);
out.suppliersForAsk = await call("res.partner", "search_read", { domain: [["supplier_rank", ">", 0]], fields: ["id", "name", "x_price_source", "x_whatsapp_number", "ref", "active"], context: ALL });
for (const p of out.suppliersForAsk) log(`  supplier #${p.id} ${p.name} · source ${p.x_price_source} · ref ${p.ref} · active ${p.active} · wa ${p.x_whatsapp_number ? "yes" : "no"}`);
await pause();

// ---- the settings record
out.configs = await call("x_pricing_config", "search_read", { domain: [], fields: [], order: "id asc", context: ALL });
for (const c of out.configs) log(`config #${c.id}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k, v]) => k.startsWith("x_") && !Array.isArray(v))))}`);
out.tiers = await call("x_pricing_tier", "search_read", { domain: [], fields: [], order: "id asc", context: ALL });
for (const t of out.tiers) log(`  tier #${t.id}: ${t.x_amount_from}–${t.x_amount_to} → ${t.x_discount_pct}% active ${t.x_active}`);
await pause();

// ---- the price days
out.days = await call("x_price_day", "search_read", { domain: [["x_date", ">=", "2026-09-27"]], fields: ["id", "x_date", "x_state", "x_approved_at", "x_published_at", "x_utak_simulation", "x_n_recipients", "write_date"], order: "x_date asc, id asc", context: ALL });
for (const d of out.days) log(`  day #${d.id} ${d.x_date} ${d.x_state} · approved ${d.x_approved_at} · published ${d.x_published_at} · sim ${d.x_utak_simulation} · written ${d.write_date}`);
out.todayLines = await call("x_price_day_line", "search_read", { domain: [["x_day_id.x_date", "=", "2026-10-01"], ["x_day_id.x_utak_simulation", "!=", true]], fields: ["id", "x_name", "x_product_tmpl_id", "x_packaging_id", "x_status", "x_sale_price", "x_suggested_price", "x_cost_price", "x_excluded", "x_decision"], order: "id asc" });
for (const l of out.todayLines) log(`    line #${l.id} «${l.x_name}» product ${JSON.stringify(l.x_product_tmpl_id)} pack ${JSON.stringify(l.x_packaging_id)} · ${l.x_status} sale ${l.x_sale_price} suggested ${l.x_suggested_price} cost ${l.x_cost_price}`);
await pause();

// ---- the orders of the last days (real and simulation), and what is still open
out.orders = await call("x_daily_order", "search_read", { domain: [["x_order_date", ">=", "2026-09-28"]], fields: ["id", "x_order_date", "x_state", "x_customer_id", "x_created_via", "x_confirmed_at", "x_delivered_at", "x_utak_simulation", "x_is_simulation", "create_date"], order: "id asc", context: ALL });
for (const o of out.orders) log(`  order #${o.id} ${o.x_order_date} ${o.x_state} · ${o.x_customer_id?.[1]} · via ${o.x_created_via} · sim ${o.x_utak_simulation}/${o.x_is_simulation} · created ${o.create_date}`);
out.openOrders = await call("x_daily_order", "search_read", { domain: [["x_state", "in", ["draft", "waiting_confirmation", "confirmed", "in_purchase", "in_delivery"]], ["x_utak_simulation", "!=", true]], fields: ["id", "x_order_date", "x_state", "x_customer_id", "x_line_ids", "create_date"], order: "id asc" });
log(`open real orders: ${out.openOrders.length} ${JSON.stringify(out.openOrders.map((o) => [o.id, o.x_order_date, o.x_state]))}`);
await pause();

// ---- the views of «💲 التسعير» as stored, and the forms that show the source's card
const VIEWS = ["utak.price_day_form", "utak.price_day_list", "utak.pricing_sources_form", "utak.pricing_settings_form", "utak.pricing_purchase_list", "utak.pricing_market_list", "utak.pricing_publish_confirm"];
out.views = await call("ir.ui.view", "search_read", { domain: [["name", "in", VIEWS]], fields: ["id", "name", "model", "type", "priority", "arch_db", "write_date"], context: ALL });
for (const v of out.views) log(`  view #${v.id} ${v.name} (${v.model}, ${v.type}) ${String(v.arch_db).length} chars · written ${v.write_date}`);
out.sourceViews = await call("ir.ui.view", "search_read", { domain: [["arch_db", "ilike", "x_price_source"]], fields: ["id", "name", "model", "type", "inherit_id", "arch_db"], context: ALL });
for (const v of out.sourceViews) log(`  view naming x_price_source: #${v.id} ${v.name} (${v.model}, ${v.type}) inherits ${JSON.stringify(v.inherit_id)}`);
out.orderViews = await call("ir.ui.view", "search_read", { domain: [["model", "in", ["x_daily_order", "x_daily_order_line"]]], fields: ["id", "name", "model", "type", "priority", "arch_db"], context: ALL });
for (const v of out.orderViews) log(`  order view #${v.id} ${v.name} (${v.model}, ${v.type}) ${String(v.arch_db).length} chars`);
out.windows = await call("ir.actions.act_window", "search_read", { domain: [["name", "like", "UTAK"]], fields: ["id", "name", "res_model", "view_mode", "domain", "context"], context: ALL });
for (const w of out.windows) log(`  window #${w.id} ${w.name} · ${w.res_model} · ${w.view_mode} · ${w.domain} · ${w.context}`);
out.automations = await call("base.automation", "search_read", { domain: [], fields: ["id", "name", "model_id", "trigger", "active", "trigger_field_ids", "filter_domain", "action_server_ids"], context: ALL });
for (const a of out.automations) log(`  automation #${a.id} ${a.name} · ${a.model_id?.[1]} · ${a.trigger} · active ${a.active}`);
await pause();

// ---- the templates of the quotation, the order reminder and the prices
out.templates = await call("x_whatsapp_template", "search_read", { domain: [], fields: [], order: "id asc", context: ALL });
for (const t of out.templates.filter((x) => /quotation|order|prices|price/i.test(`${x.x_purpose} ${x.x_name} ${x.x_meta_name ?? ""}`))) {
  log(`  template #${t.id} ${JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k, v]) => k.startsWith("x_") && v !== false && String(v).length < 600)))}`);
}

writeFileSync(new URL("../artifacts/s49-20261001-explore.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
log("→ scripts/artifacts/s49-20261001-explore.json");
