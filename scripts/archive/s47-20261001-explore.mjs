// § 47 (2026-10-01) — read-only exploration of the tenant before the parts (search_read / read /
// fields_get only): the purchase taxes (#43, #21, the company's), the tax rounding method, the price
// sources and their VAT fields, the pricing settings and their view, the price day #50 and its lines,
// the pomegranate / banana products and their packagings, the real purchase offers before today,
// the board views, and every WhatsApp template whose body says «شامل» or «ضريب».
//
//   node scripts/archive/s47-20261001-explore.mjs
//
// Out: scripts/artifacts/s47-20261001-explore.json
import { writeFileSync } from "node:fs";
import { call } from "../lib/odoo-cli.mjs";

const out = { atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };
const log = (...a) => console.log(...a);
const ALL = { active_test: false };
const pause = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const TODAY = "2026-10-01";

// ---- taxes
out.taxes = await call("account.tax", "search_read", { domain: [["type_tax_use", "=", "purchase"]], fields: ["id", "name", "amount", "amount_type", "type_tax_use", "price_include", "price_include_override", "active", "tax_group_id", "include_base_amount"], order: "id asc", context: ALL });
for (const t of out.taxes) log(`tax #${t.id} «${t.name}» ${t.amount}% include=${t.price_include} override=${t.price_include_override} active=${t.active} group=${t.tax_group_id?.[0]}`);
[out.company] = await call("res.company", "read", { ids: [1], fields: ["id", "name", "account_purchase_tax_id", "account_sale_tax_id", "tax_calculation_rounding_method", "account_price_include"].filter(Boolean) }).catch(async () => call("res.company", "read", { ids: [1], fields: ["id", "name", "account_purchase_tax_id", "account_sale_tax_id", "tax_calculation_rounding_method"] }));
log(`company: purchase tax ${JSON.stringify(out.company.account_purchase_tax_id)} · sale tax ${JSON.stringify(out.company.account_sale_tax_id)} · rounding ${out.company.tax_calculation_rounding_method} · price_include ${out.company.account_price_include}`);
await pause();

// ---- sources and suppliers
out.sourcePartners = await call("res.partner", "search_read", { domain: ["|", ["x_price_source", "=", true], ["supplier_rank", ">", 0]], fields: ["id", "name", "vat", "x_vat_registered", "x_price_source", "supplier_rank", "ref", "active", "x_supplied_product_ids"], order: "id asc", context: ALL });
for (const p of out.sourcePartners) log(`partner #${p.id} «${p.name}» vat=${p.vat || "—"} x_vat_registered=${p.x_vat_registered} source=${p.x_price_source} supplier_rank=${p.supplier_rank} ref=${p.ref || "—"} active=${p.active} supplies=${(p.x_supplied_product_ids || []).length}`);
out.sourceEmployees = await call("hr.employee", "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name", "work_contact_id", "x_vat_registered"], context: ALL });
for (const e of out.sourceEmployees) log(`employee #${e.id} «${e.name}» contact=${JSON.stringify(e.work_contact_id)} x_vat_registered=${e.x_vat_registered}`);
await pause();

// ---- pricing settings
for (const m of ["x_pricing_config", "x_price_day", "x_price_day_line", "x_price_offer", "x_daily_price", "x_supplier_due", "x_supplier_due_line"]) {
  const f = await call("ir.model.fields", "search_read", { domain: [["model", "=", m], ["name", "=like", "x_%"]], fields: ["id", "name", "ttype", "field_description", "store", "readonly", "relation"], order: "id asc" });
  out[`fields:${m}`] = f;
  log(`${m}: ${f.map((x) => `${x.name}#${x.id}(${x.ttype})`).join(" ")}`);
  await pause(800);
}
out.config = await call("x_pricing_config", "search_read", { domain: [], fields: [], context: ALL });
for (const c of out.config) log(`config #${c.id}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("x_"))))}`);
out.views = await call("ir.ui.view", "search_read", { domain: [["model", "in", ["x_pricing_config", "x_price_day", "x_price_day_line", "x_price_offer"]]], fields: ["id", "name", "model", "type", "priority", "inherit_id", "active", "arch_db"], order: "id asc", context: ALL });
for (const v of out.views) log(`view #${v.id} ${v.model} ${v.type} «${v.name}» p${v.priority}${v.active ? "" : " (inactive)"} ${String(v.arch_db).length}ch`);
out.windows = await call("ir.actions.act_window", "search_read", { domain: [["res_model", "in", ["x_pricing_config", "x_price_day", "x_price_day_line", "x_price_offer"]]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id"], context: ALL });
for (const w of out.windows) log(`act_window #${w.id} «${w.name}» ${w.res_model} ${w.view_mode} view=${JSON.stringify(w.view_id)} dom=${w.domain}`);
out.menu581 = await call("ir.ui.menu", "search_read", { domain: [["id", "in", [581]]], fields: ["id", "name", "action", "active", "parent_id"], context: ALL });
log(`menu: ${JSON.stringify(out.menu581)}`);
await pause();

// ---- the price day #50
out.day50 = await call("x_price_day", "read", { ids: [50], fields: [] });
log(`day #50: ${JSON.stringify(Object.fromEntries(Object.entries(out.day50[0] ?? {}).filter(([k, v]) => k.startsWith("x_") && v !== false && k !== "x_line_ids")))}`);
out.day50Lines = await call("x_price_day_line", "search_read", { domain: [["x_day_id", "=", 50]], fields: [], order: "x_sequence asc, id asc" });
for (const l of out.day50Lines) log(`  line #${l.id} ${l.x_name} · product ${JSON.stringify(l.x_product_tmpl_id)} pack ${JSON.stringify(l.x_packaging_id)} · cost ${l.x_cost_price} market ${l.x_market_price} sale ${l.x_sale_price} · ${l.x_status} «${l.x_reason}» decision ${l.x_decision} · board ${l.x_board_status} net ${l.x_net_purchase} full ${l.x_full_cost}`);
out.days = await call("x_price_day", "search_read", { domain: [], fields: ["id", "x_date", "x_state", "x_utak_simulation", "x_name"], order: "x_date desc, id desc", limit: 30 });
for (const d of out.days) log(`  day #${d.id} ${d.x_date} ${d.x_state}${d.x_utak_simulation ? " (sim)" : ""}`);
await pause();

// ---- products: pomegranate, banana
out.products = await call("product.template", "search_read", { domain: ["|", "|", ["name", "ilike", "رمان"], ["name", "ilike", "موز"], ["x_utak_new", "=", true]], fields: ["id", "name", "default_code", "categ_id", "active", "sale_ok", "purchase_ok", "x_is_active_for_sale", "x_name_en", "x_utak_new", "taxes_id", "supplier_taxes_id", "x_supplier_ids", "type", "create_date"], order: "id asc", context: ALL });
for (const p of out.products) log(`product #${p.id} [${p.default_code || "—"}] ${p.name} · categ ${JSON.stringify(p.categ_id)} · active ${p.active} afs ${p.x_is_active_for_sale} new ${p.x_utak_new} · tax ${p.taxes_id}/${p.supplier_taxes_id} · suppliers ${p.x_supplier_ids} · en ${p.x_name_en || "—"}`);
out.packagings = await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", out.products.map((p) => p.id)]], fields: [], order: "x_product_tmpl_id, x_sequence, id", context: ALL });
for (const k of out.packagings) log(`  pack #${k.id} product ${k.x_product_tmpl_id?.[0]} «${k.x_name}» type ${k.x_type} kg ${k.x_approx_weight_kg} default ${k.x_is_default}`);
out.fruitRefs = await call("product.template", "search_read", { domain: [["default_code", "=like", "UTAK-FRT-%"]], fields: ["id", "default_code", "name", "active"], order: "default_code asc", context: ALL });
log(`FRT refs: ${out.fruitRefs.map((p) => `${p.default_code}${p.active ? "" : "(archived)"}`).join(" ")}`);
out.categories = await call("product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"], order: "id asc" });
out.productTaxUse = {};
const allProducts = await call("product.template", "search_read", { domain: [], fields: ["id", "supplier_taxes_id", "taxes_id"], context: ALL });
for (const p of allProducts) { const k = `${p.taxes_id}/${p.supplier_taxes_id}`; out.productTaxUse[k] = (out.productTaxUse[k] ?? 0) + 1; }
log(`products by sale/purchase tax: ${JSON.stringify(out.productTaxUse)}`);
await pause();

// ---- purchase offers: real ones before today, and today's
out.offersAll = await call("x_price_offer", "search_read", { domain: [], fields: ["id", "x_date", "x_source_partner_id", "x_source_employee_id", "x_product_tmpl_id", "x_packaging_id", "x_purchase_price", "x_market_price", "x_status", "x_utak_simulation", "create_date"], order: "id asc", limit: 2000 });
const realOffers = out.offersAll.filter((o) => !o.x_utak_simulation);
log(`x_price_offer: ${out.offersAll.length} rows · real (not simulation): ${realOffers.length}`);
for (const o of realOffers) log(`  real offer #${o.id} ${o.x_date} ${o.x_source_partner_id?.[1]} · ${o.x_product_tmpl_id?.[1]} · purchase ${o.x_purchase_price} market ${o.x_market_price} · ${o.x_status}`);
out.dailyAll = await call("x_daily_price", "search_read", { domain: [], fields: ["id", "x_date", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_sale_price", "x_extraction_status", "x_utak_simulation", "create_date"], order: "id asc", limit: 2000 });
const realDaily = out.dailyAll.filter((o) => !o.x_utak_simulation);
log(`x_daily_price: ${out.dailyAll.length} rows · real (not simulation): ${realDaily.length}`);
for (const o of realDaily) log(`  real price #${o.id} ${o.x_date} ${o.x_supplier_id?.[1]} · ${o.x_product_tmpl_id?.[1]} · ${o.x_price_sar} (sale ${o.x_sale_price}) · ${o.x_extraction_status}`);
await pause();

// ---- purchase documents that carry a purchase price
out.purchaseLists = await call("x_purchase_list", "search_read", { domain: [], fields: ["id", "x_date", "x_status", "x_supplier_id", "x_purchase_order_id", "x_account_move_id", "x_utak_simulation"], order: "id desc", limit: 50 });
log(`x_purchase_list: ${out.purchaseLists.length} · real: ${out.purchaseLists.filter((l) => !l.x_utak_simulation).length}`);
for (const l of out.purchaseLists.filter((x) => !x.x_utak_simulation)) log(`  real list #${l.id} ${l.x_date} ${l.x_status} supplier ${JSON.stringify(l.x_supplier_id)} po ${JSON.stringify(l.x_purchase_order_id)} move ${JSON.stringify(l.x_account_move_id)}`);
out.vendorBills = await call("account.move", "search_read", { domain: [["move_type", "=", "in_invoice"]], fields: ["id", "name", "state", "partner_id", "invoice_date", "amount_untaxed", "amount_tax", "amount_total", "ref", "journal_id"], order: "id desc", limit: 50 });
for (const m of out.vendorBills) log(`  bill #${m.id} ${m.name} ${m.state} ${m.invoice_date} ${m.partner_id?.[1]} · ${m.amount_untaxed}+${m.amount_tax}=${m.amount_total} · ${m.ref || ""} · ${m.journal_id?.[1]}`);
await pause();

// ---- automations and the new-product flag
out.automations = await call("base.automation", "search_read", { domain: [["id", "in", [23, 27, 28]]], fields: ["id", "name", "model_id", "trigger", "active", "filter_domain", "filter_pre_domain", "trigger_field_ids", "action_server_ids"], context: ALL });
for (const a of out.automations) log(`automation #${a.id} «${a.name}» ${a.trigger} active ${a.active} actions ${a.action_server_ids} filter ${a.filter_domain}`);
out.actions = await call("ir.actions.server", "search_read", { domain: [["id", "in", [1035, 1036]]], fields: ["id", "name", "state", "code"], context: ALL });
for (const a of out.actions) log(`action #${a.id} «${a.name}» ${String(a.code).length}ch`);
await pause();

// ---- WhatsApp templates: «شامل» / «ضريب»
out.templates = await call("x_whatsapp_template", "search_read", { domain: [], fields: ["id", "x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_body_text"], order: "id asc", context: ALL });
const body = (t) => Object.entries(t).filter(([k, v]) => typeof v === "string" && /body|text|content/i.test(k)).map(([, v]) => v).join("\n");
out.templatesInclusive = out.templates.filter((t) => /شامل|ضريب/.test(body(t)) || /شامل|ضريب/.test(JSON.stringify(t)));
log(`templates: ${out.templates.length} · mentioning «شامل» or «ضريب»: ${out.templatesInclusive.length}`);
for (const t of out.templatesInclusive) log(`  template #${t.id} ${t.x_meta_template_id ?? t.x_name} purpose ${t.x_purpose} status ${t.x_meta_status ?? ""} category ${t.x_meta_category ?? ""}\n    ${body(t).replace(/\n/g, " ⏎ ").slice(0, 600)}`);

writeFileSync(new URL("../artifacts/s47-20261001-explore.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
