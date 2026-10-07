// § 65 (2026-10-07) — read-only facts before the suppliers' registry (nothing is written):
//
//   node scripts/s65-20261007-diag.mjs > scripts/artifacts/logs/s65-diag.log 2>&1
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
// a secret never reaches a log: anything that looks like a token in a url is masked
const mask = (s) => String(s ?? "").replace(/(token=)[^&"'\s<]+/g, "$1<masked>");

await safe("res.partner x_* fields", () => fieldsOf("res.partner", (k) => k.startsWith("x_")));
await safe("x_supplier_type: its field row and its selection rows", async () => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "=", "x_supplier_type"]], fields: ["id", "selection_ids", "field_description", "state"] });
  const rows = f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f.id]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [];
  return { f, rows };
});
await safe("x_price_offer fields", () => fieldsOf("x_price_offer", () => true));
await safe("x_pricing_config x_* fields", () => fieldsOf("x_pricing_config", (k) => k.startsWith("x_")));
await safe("x_special_quote_line: automations on it", () => call("base.automation", "search_read", { domain: [["model_name", "in", ["x_special_quote_line", "x_special_quote"]]], fields: ["id", "name", "active", "trigger", "model_name", "trigger_field_ids", "action_server_ids"], context: ALL }));
await safe("partners: suppliers, price sources, and the named ones", async () => {
  const rows = await call("res.partner", "search_read", {
    domain: ["|", "|", "|", ["supplier_rank", ">", 0], ["x_price_source", "=", true], ["x_supplier_type", "!=", false], ["id", "in", [30, 55, 104, 106, 109]]],
    fields: ["id", "name", "active", "supplier_rank", "customer_rank", "x_supplier_type", "x_price_source", "x_price_role", "x_last_price_submission", "category_id", "x_utak_simulation", "x_whatsapp_number", "phone"], order: "id asc", limit: 200, context: ALL,
  });
  return rows.map((r) => `#${r.id} ${r.active ? "" : "(archived) "}«${r.name}» sup=${r.supplier_rank} cust=${r.customer_rank} type=${r.x_supplier_type || "-"} src=${r.x_price_source ? r.x_price_role || "yes" : "-"} cat=${JSON.stringify(r.category_id)} sim=${r.x_utak_simulation ? 1 : 0} wa=${r.x_whatsapp_number ? "yes" : "-"} last=${r.x_last_price_submission || "-"}`).join("\n");
});
await safe("res.partner.category", () => call("res.partner.category", "search_read", { domain: [], fields: ["id", "name", "partner_ids"], context: ALL }));
await safe("menus under «🛒 المشتريات» (#547)", () => call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 547]], fields: ["id", "name", "action", "sequence", "active"], order: "sequence asc, id asc", context: ALL }));
await safe("menus under «💲 التسعير» (#582)", () => call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 582]], fields: ["id", "name", "action", "sequence", "active"], order: "sequence asc, id asc", context: ALL }));
await safe("views on res.partner named utak.*", async () => (await call("ir.ui.view", "search_read", { domain: [["model", "=", "res.partner"], ["name", "like", "utak"]], fields: ["id", "name", "type", "inherit_id", "active", "priority", "mode"], context: ALL })).map((v) => `#${v.id} ${v.active ? "" : "(off) "}${v.name} ${v.type} ${v.mode} inherit=${JSON.stringify(v.inherit_id)}`).join("\n"));
await safe("views on x_price_offer", async () => (await call("ir.ui.view", "search_read", { domain: [["model", "=", "x_price_offer"]], fields: ["id", "name", "type", "inherit_id", "active", "priority", "mode", "arch_db"], context: ALL })).map((v) => `#${v.id} ${v.active ? "" : "(off) "}${v.name} ${v.type} ${v.mode} inherit=${JSON.stringify(v.inherit_id)}\n${v.arch_db}`).join("\n\n"));
await safe("act_windows on x_price_offer and res.partner (utak)", async () => (await call("ir.actions.act_window", "search_read", { domain: ["|", ["res_model", "=", "x_price_offer"], "&", ["res_model", "=", "res.partner"], ["name", "like", "UTAK"]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "search_view_id", "view_id"], context: ALL })));
await safe("server actions that call the worker (masked), count", async () => {
  const rows = await call("ir.actions.server", "search_read", { domain: [["state", "=", "webhook"]], fields: ["id", "name", "model_name", "webhook_url"], context: ALL });
  return `${rows.length} webhooks\n` + rows.map((r) => `#${r.id} ${r.name} ${r.model_name} ${mask(r.webhook_url)}`).join("\n");
});
await safe("the supplier-pay fields on a supplier (#30)", async () => {
  const f = await call("res.partner", "fields_get", { attributes: ["type", "string"] });
  const names = Object.keys(f).filter((k) => k.startsWith("x_sp_"));
  return { names: names.map((n) => `${n}: ${f[n].type} «${f[n].string}»`), row: (await call("res.partner", "read", { ids: [30], fields: names }))[0] };
});
await safe("res.country: a few names (ar / en)", async () => {
  const en = await call("res.country", "search_read", { domain: [["code", "in", ["SA", "EG", "YE", "IN", "ZA", "TR", "JO", "EC", "PH", "CL", "US", "NL", "ES", "CN", "KE", "LB", "SY", "MA", "PK", "IR", "AU", "NZ", "IT", "FR", "PE", "BR", "AR", "ET", "SD", "AE", "OM", "TH", "VN", "LK", "UG", "TZ", "MX", "CO", "CR", "GT", "TN", "IQ", "KW", "BH", "QA"]]], fields: ["id", "code", "name"], limit: 100 });
  const ar = await call("res.country", "search_read", { domain: [["id", "in", en.map((c) => c.id)]], fields: ["id", "name"], limit: 100, context: { lang: "ar_001" } });
  return en.map((c) => `${c.code}#${c.id} ${c.name} / ${ar.find((a) => a.id === c.id)?.name}`).join(" · ");
});
await safe("x_special_quote_line rows of SQ-0003 (#3)", () => call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "=", 3]], fields: ["id", "x_qty", "x_purchase_price", "x_final_price", "x_final_net", "x_total", "x_profit"], context: ALL }));
await safe("the recalc webhook action and the mode action", async () => (await call("ir.actions.server", "search_read", { domain: [["name", "in", ["utak.special_quote.recalc_webhook", "utak.special_quote.recalc_on_mode"]]], fields: ["id", "name", "state", "model_name", "code"], context: ALL })));
await safe("x_wa_template rows: purposes", async () => (await call("x_wa_template", "search_read", { domain: [], fields: ["id", "x_name", "x_purpose", "x_status", "x_category"], order: "id desc", limit: 12, context: ALL })).map((r) => `#${r.id} ${r.x_name} purpose=${r.x_purpose} ${r.x_status} ${r.x_category}`).join("\n"));
await safe("x_wa_template fields", () => fieldsOf("x_wa_template", (k) => k.startsWith("x_")));
