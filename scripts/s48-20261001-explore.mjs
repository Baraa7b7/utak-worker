// § 48 (2026-10-01) — read-only exploration of the tenant before the parts (search_read / read /
// fields_get only): the price day #50 with its lines, who wrote what and when; the selections of
// the line's fields; the day's offers (x_daily_price, x_price_offer); the packagings; and the
// inventory of everything about pricing: menus, windows, views, server actions, automations, the
// fields of the pricing models, the settings and the operating costs.
//
//   node scripts/s48-20261001-explore.mjs
//
// Out: scripts/artifacts/s48-20261001-explore.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const out = { atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };
const log = (...a) => console.log(...a);
const ALL = { active_test: false };
const pause = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const TODAY = "2026-10-01";
const MODELS = ["x_price_day", "x_price_day_line", "x_price_offer", "x_daily_price", "x_supplier_price_request_log", "x_operating_cost", "x_pricing_config", "x_product_packaging"];

// ---- the price day #50, its lines, and who wrote them
const META = ["create_uid", "create_date", "write_uid", "write_date"];
out.day50 = await call("x_price_day", "read", { ids: [50], fields: [] });
log(`day #50: ${JSON.stringify(Object.fromEntries(Object.entries(out.day50[0] ?? {}).filter(([k, v]) => (k.startsWith("x_") || META.includes(k)) && v !== false && k !== "x_line_ids")))}`);
out.day50Lines = await call("x_price_day_line", "search_read", { domain: [["x_day_id", "=", 50]], fields: [], order: "x_sequence asc, id asc" });
for (const l of out.day50Lines) {
  log(`  line #${l.id} ${l.x_name} · product ${JSON.stringify(l.x_product_tmpl_id)} pack ${JSON.stringify(l.x_packaging_id)}`);
  log(`     cost ${l.x_cost_price} market ${l.x_market_price} sale ${l.x_sale_price} manual ${l.x_manual_price} · ${l.x_status} «${l.x_reason}» excluded ${l.x_excluded} · decision ${l.x_decision} at ${l.x_decided_at}`);
  log(`     board: net ${l.x_net_purchase} waste ${l.x_waste_cost} share ${l.x_op_share} full ${l.x_full_cost} be ${l.x_break_even} sug ${l.x_suggested_price} sale ${l.x_board_sale} netsale ${l.x_net_sale} profit ${l.x_real_profit} ${l.x_board_status}`);
  log(`     created ${l.create_date} by ${l.create_uid?.[1]} · written ${l.write_date} by ${l.write_uid?.[1]}`);
}
await pause();
const lineIds = out.day50Lines.map((l) => l.id);
out.day50Messages = await call("mail.message", "search_read", { domain: ["|", "&", ["model", "=", "x_price_day_line"], ["res_id", "in", lineIds], "&", ["model", "=", "x_price_day"], ["res_id", "=", 50]], fields: ["id", "model", "res_id", "date", "author_id", "message_type", "body", "tracking_value_ids"], order: "id asc" }).catch((e) => ({ error: String(e.message).slice(0, 200) }));
log(`messages on #50 and its lines: ${Array.isArray(out.day50Messages) ? out.day50Messages.length : JSON.stringify(out.day50Messages)}`);
if (Array.isArray(out.day50Messages)) {
  const tv = out.day50Messages.flatMap((m) => m.tracking_value_ids ?? []);
  out.day50Tracking = tv.length ? await call("mail.tracking.value", "read", { ids: tv, fields: [] }).catch((e) => ({ error: String(e.message).slice(0, 200) })) : [];
  for (const m of out.day50Messages) log(`  msg #${m.id} ${m.model}#${m.res_id} ${m.date} ${m.author_id?.[1]} ${m.message_type} tracking ${m.tracking_value_ids?.length ?? 0} · ${String(m.body).replace(/<[^>]+>/g, " ").slice(0, 160)}`);
}
out.selections = await call("ir.model.fields.selection", "search_read", { domain: [["field_id.model", "in", ["x_price_day", "x_price_day_line", "x_price_offer", "x_daily_price", "x_operating_cost", "x_pricing_config", "x_product_packaging"]]], fields: ["id", "field_id", "value", "name", "sequence"], order: "field_id, sequence, id" });
for (const s of out.selections) log(`  selection ${s.field_id?.[1]} · ${s.value} «${s.name}» #${s.id}`);
await pause();

// ---- fields of the pricing models
for (const m of MODELS) {
  const f = await call("ir.model.fields", "search_read", { domain: [["model", "=", m]], fields: ["id", "name", "ttype", "field_description", "store", "readonly", "relation", "related", "compute", "depends", "help", "required", "tracking"], order: "id asc" });
  out[`fields:${m}`] = f;
  log(`${m}: ${f.filter((x) => x.name.startsWith("x_")).map((x) => `${x.name}#${x.id}(${x.ttype}${x.compute ? ",compute" : ""}${x.related ? `,rel=${x.related}` : ""})`).join(" ")}`);
  await pause(800);
}
out.models = await call("ir.model", "search_read", { domain: [["model", "in", MODELS]], fields: ["id", "model", "name", "is_mail_thread"] });
for (const m of out.models) log(`model #${m.id} ${m.model} «${m.name}» thread ${m.is_mail_thread}`);

// ---- today's offers
out.dailyToday = await call("x_daily_price", "search_read", { domain: [["x_date", "=", TODAY]], fields: [], order: "id asc", context: ALL });
for (const o of out.dailyToday) log(`  x_daily_price #${o.id} ${o.x_date} ${o.x_supplier_id?.[1]} · ${o.x_product_tmpl_id?.[1]} / ${o.x_packaging_id?.[1]} · ${o.x_price_sar} (sale ${o.x_sale_price}) · ${o.x_extraction_status} · sim ${o.x_utak_simulation} · created ${o.create_date} by ${o.create_uid?.[1]}`);
out.dailyRecent = await call("x_daily_price", "search_read", { domain: [["x_date", ">=", "2026-09-19"]], fields: ["id", "x_date", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_sale_price", "x_extraction_status", "x_utak_simulation", "create_date"], order: "id asc", context: ALL });
log(`x_daily_price since 09-19: ${out.dailyRecent.length} · real ${out.dailyRecent.filter((o) => !o.x_utak_simulation).length}`);
out.offersRecent = await call("x_price_offer", "search_read", { domain: [["x_date", ">=", "2026-09-26"]], fields: [], order: "id asc", context: ALL });
log(`x_price_offer since 09-26: ${out.offersRecent.length} · real ${out.offersRecent.filter((o) => !o.x_utak_simulation).length}`);
for (const o of out.offersRecent.slice(-12)) log(`  x_price_offer #${o.id} ${o.x_date} ${o.x_source_partner_id?.[1]} · ${o.x_product_tmpl_id?.[1]} · purchase ${o.x_purchase_price} market ${o.x_market_price} · sim ${o.x_utak_simulation} · ${o.create_date}`);
out.offersCount = await call("x_price_offer", "search_count", { domain: [] });
out.offersLast = await call("x_price_offer", "search_read", { domain: [], fields: ["id", "x_date", "x_utak_simulation", "create_date"], order: "id desc", limit: 3, context: ALL });
log(`x_price_offer: ${out.offersCount} rows, last ${JSON.stringify(out.offersLast)}`);
out.askLog = await call("x_supplier_price_request_log", "search_read", { domain: [], fields: [], order: "id desc", limit: 12, context: ALL });
for (const r of out.askLog) log(`  ask log #${r.id} ${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k, v]) => k.startsWith("x_") && v !== false).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 60) : v])))}`);
await pause();

// ---- packagings and the produce
out.packagings = await call("x_product_packaging", "search_read", { domain: [], fields: [], order: "x_product_tmpl_id, x_sequence, id", context: ALL });
for (const k of out.packagings) log(`  pack #${k.id} product ${JSON.stringify(k.x_product_tmpl_id)} «${k.x_name}» ${JSON.stringify(Object.fromEntries(Object.entries(k).filter(([f, v]) => f.startsWith("x_") && !["x_name", "x_product_tmpl_id"].includes(f) && v !== false)))}`);
out.categories = await call("product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"], order: "id asc" });
out.products = await call("product.template", "search_read", { domain: [["type", "!=", "service"]], fields: ["id", "name", "default_code", "categ_id", "active", "sale_ok", "purchase_ok", "x_is_active_for_sale", "x_name_en", "x_utak_new", "x_supplier_ids", "type"], order: "id asc", context: ALL });
log(`products (not services): ${out.products.length} · by category ${JSON.stringify(out.products.reduce((a, p) => { const k = p.categ_id?.[1] ?? "—"; a[k] = (a[k] ?? 0) + 1; return a; }, {}))}`);
out.productFields = await call("ir.model.fields", "search_read", { domain: [["model", "=", "product.template"], ["name", "=like", "x_%"]], fields: ["id", "name", "ttype", "field_description", "relation", "compute", "related"], order: "id asc" });
log(`product.template x_: ${out.productFields.map((x) => `${x.name}(${x.ttype})`).join(" ")}`);
await pause();

// ---- settings and costs
out.config = await call("x_pricing_config", "search_read", { domain: [], fields: [], context: ALL });
for (const c of out.config) log(`config #${c.id}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("x_"))))}`);
out.costs = await call("x_operating_cost", "search_read", { domain: [], fields: [], order: "id asc", context: ALL });
for (const c of out.costs) log(`cost #${c.id}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k, v]) => k.startsWith("x_") && v !== false)))}`);
out.irDefaults = await call("ir.default", "search_read", { domain: [["field_id.model", "in", MODELS]], fields: ["id", "field_id", "json_value", "user_id", "company_id"] });
log(`ir.default: ${JSON.stringify(out.irDefaults)}`);
await pause();

// ---- the inventory: menus, windows, views, server actions, automations
const roots = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", false]], fields: ["id", "name", "sequence", "active", "action"], order: "sequence, id", context: ALL });
out.rootMenus = roots;
for (const r of roots) log(`root menu #${r.id} «${r.name}» seq ${r.sequence} active ${r.active} action ${r.action}`);
const utak = roots.find((r) => /UTAK/i.test(r.name));
out.utakMenus = utak ? await call("ir.ui.menu", "search_read", { domain: [["id", "child_of", utak.id]], fields: ["id", "name", "sequence", "active", "action", "parent_id", "complete_name", "group_ids"], order: "parent_id, sequence, id", context: ALL }).catch(async () => call("ir.ui.menu", "search_read", { domain: [["id", "child_of", utak.id]], fields: ["id", "name", "sequence", "active", "action", "parent_id", "complete_name"], order: "parent_id, sequence, id", context: ALL })) : [];
for (const m of out.utakMenus) log(`  menu #${m.id} parent ${m.parent_id?.[0] ?? "—"} seq ${m.sequence} ${m.active ? "" : "(hidden) "}«${m.name}» → ${m.action || "—"}`);
await pause();
const WMODELS = [...MODELS, "product.template", "product.category", "x_quantity_discount"];
out.windows = await call("ir.actions.act_window", "search_read", { domain: [["res_model", "in", WMODELS]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id", "view_ids", "target", "res_id", "help"], order: "id asc", context: ALL });
for (const w of out.windows) log(`act_window #${w.id} «${w.name}» ${w.res_model} ${w.view_mode} view=${JSON.stringify(w.view_id)} search=${JSON.stringify(w.search_view_id)} dom=${w.domain} ctx=${w.context}`);
out.windowViews = await call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "in", out.windows.map((w) => w.id)]], fields: ["id", "act_window_id", "view_id", "view_mode", "sequence"], order: "act_window_id, sequence" });
await pause();
out.views = await call("ir.ui.view", "search_read", { domain: [["model", "in", MODELS]], fields: ["id", "name", "model", "type", "priority", "inherit_id", "active", "arch_db", "mode"], order: "id asc", context: ALL });
for (const v of out.views) log(`view #${v.id} ${v.model} ${v.type} «${v.name}» p${v.priority}${v.inherit_id ? ` inherits ${v.inherit_id[0]}` : ""}${v.active ? "" : " (inactive)"} ${String(v.arch_db).length}ch`);
out.productViews = await call("ir.ui.view", "search_read", { domain: [["model", "in", ["product.template"]], ["name", "ilike", "utak"]], fields: ["id", "name", "model", "type", "priority", "inherit_id", "active", "arch_db", "mode"], order: "id asc", context: ALL });
for (const v of out.productViews) log(`view #${v.id} ${v.model} ${v.type} «${v.name}» p${v.priority}${v.inherit_id ? ` inherits ${v.inherit_id[0]}` : ""}${v.active ? "" : " (inactive)"} ${String(v.arch_db).length}ch`);
await pause();
const modelIds = await call("ir.model", "search_read", { domain: [["model", "in", [...MODELS, "product.template"]]], fields: ["id", "model"] });
out.serverActions = await call("ir.actions.server", "search_read", { domain: [["model_id", "in", modelIds.map((m) => m.id)]], fields: ["id", "name", "model_id", "state", "code", "webhook_url", "binding_model_id", "usage", "base_automation_id", "child_ids", "update_path", "value", "evaluation_type"], order: "id asc", context: ALL }).catch(async () => call("ir.actions.server", "search_read", { domain: [["model_id", "in", modelIds.map((m) => m.id)]], fields: ["id", "name", "model_id", "state", "code", "webhook_url", "binding_model_id", "usage"], order: "id asc", context: ALL }));
for (const a of out.serverActions) log(`action #${a.id} «${a.name}» ${a.model_id?.[1]} ${a.state} usage ${a.usage} ${a.webhook_url ? `→ ${String(a.webhook_url).replace(/token=[^&]+/, "token=…")}` : ""} ${a.code ? `${String(a.code).length}ch` : ""}`);
out.automations = await call("base.automation", "search_read", { domain: [], fields: ["id", "name", "model_id", "model_name", "trigger", "active", "filter_domain", "filter_pre_domain", "trigger_field_ids", "action_server_ids", "on_change_field_ids"], order: "id asc", context: ALL });
for (const a of out.automations) log(`automation #${a.id} «${a.name}» ${a.model_name} ${a.trigger} active ${a.active} actions ${a.action_server_ids} fields ${a.trigger_field_ids} filter ${a.filter_domain}`);
await pause();
out.allWindowsCount = await call("ir.actions.act_window", "search_count", { domain: [["name", "=like", "UTAK%"]] });
out.clientActions = await call("ir.actions.client", "search_read", { domain: [["name", "ilike", "utak"]], fields: ["id", "name", "tag"] }).catch(() => []);

// the hook token of a webhook action never goes to the artifact
writeFileSync(new URL("./artifacts/s48-20261001-explore.json", import.meta.url), JSON.stringify(out, null, 2).replace(/token=[^&"\\]+/g, "token=…") + "\n");
log("→ scripts/artifacts/s48-20261001-explore.json");
