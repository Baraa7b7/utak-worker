// § 64 (2026-10-07) — read-only facts before «💬 المحادثات» by date, the worker's «📈 تاريخ الأسعار» page and
// § 62 د's leftovers (nothing is written):
//
//   node scripts/s64-20261007-diag.mjs > scripts/artifacts/logs/s64-diag.log 2>&1
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
  return Object.entries(f).filter(([k, v]) => pick(k, v)).map(([k, v]) => `${k}: ${v.type}${v.relation ? `→${v.relation}` : ""}${v.store === false ? " (not stored)" : ""} «${v.string}»${v.selection ? " " + JSON.stringify(v.selection) : ""}`).join("\n");
};
// a secret never reaches a log: anything that looks like a token in a url is masked
const mask = (s) => String(s ?? "").replace(/(token=)[^&"'\s<]+/g, "$1<masked>");

// ------------------------------------------------------------ 1: «💬 المحادثات»
await safe("menus #565, #529 and #565's siblings", () => call("ir.ui.menu", "search_read", { domain: ["|", ["id", "in", [565, 529]], ["parent_id", "=", 529]], fields: ["id", "name", "parent_id", "action", "sequence", "active"], order: "sequence asc, id asc", context: ALL }));
await safe("the action #565 opens", async () => {
  const [m] = await call("ir.ui.menu", "read", { ids: [565], fields: ["action"] });
  const [model, id] = String(m.action || "").split(",");
  if (!model) return "no action";
  const fields = model === "ir.actions.act_window" ? ["id", "name", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id", "target", "view_ids"]
    : model === "ir.actions.client" ? ["id", "name", "tag", "params", "context", "target"]
      : model === "ir.actions.server" ? ["id", "name", "state", "model_name", "code"] : ["id", "name"];
  return { model, row: (await call(model, "read", { ids: [Number(id)], fields }))[0] };
});
await safe("discuss.channel fields: x_*, and anything about unread / last message / pin", () => fieldsOf("discuss.channel", (k) => k.startsWith("x_") || /unread|last_|pin|message_needaction|is_member|channel_type|^name$|^active$|display_name|message_ids|channel_member_ids|channel_partner_ids/.test(k)));
await safe("discuss.channel.member fields about unread / seen", () => fieldsOf("discuss.channel.member", (k) => /unread|seen|new_message|last_|pin|partner_id|channel_id|message_unread/.test(k)));
await safe("whatsapp channels (x_wa_partner_id set)", async () => {
  const rows = await call("discuss.channel", "search_read", { domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name", "channel_type", "x_wa_partner_id", "active", "create_date", "write_date"], order: "id asc", limit: 500, context: ALL });
  return `${rows.length} channels\n` + rows.map((r) => `#${r.id} ${r.active ? "" : "(archived) "}«${r.name}» ${r.channel_type} partner=${JSON.stringify(r.x_wa_partner_id)}`).join("\n");
});
await safe("other channels (no x_wa_partner_id) — count by type", async () => {
  const rows = await call("discuss.channel", "search_read", { domain: [["x_wa_partner_id", "=", false]], fields: ["id", "name", "channel_type"], limit: 500, context: ALL });
  return rows.map((r) => `#${r.id} «${r.name}» ${r.channel_type}`).join("\n");
});
await safe("mail.message fields (the ones a preview needs)", () => fieldsOf("mail.message", (k) => /^(body|date|model|res_id|message_type|subtype_id|author_id|attachment_ids|preview|create_date|x_.*)$/.test(k)));
await safe("the last 6 messages of whatsapp channels (shape only: lengths, types)", async () => {
  const rows = await call("mail.message", "search_read", { domain: [["model", "=", "discuss.channel"]], fields: ["id", "res_id", "date", "message_type", "subtype_id", "author_id", "attachment_ids", "body"], order: "id desc", limit: 6 });
  return rows.map((r) => `#${r.id} ch=${r.res_id} ${r.date} ${r.message_type} sub=${JSON.stringify(r.subtype_id)} att=${(r.attachment_ids ?? []).length} body[${String(r.body ?? "").length}]=${JSON.stringify(String(r.body ?? "").slice(0, 160))}`).join("\n");
});
await safe("base.automation (all): id, name, model, trigger, active, actions", async () => {
  const rows = await call("base.automation", "search_read", { domain: [], fields: ["id", "name", "model_name", "trigger", "active", "action_server_ids", "trigger_field_ids", "filter_domain", "filter_pre_domain"], order: "id asc", context: ALL });
  return rows.map((r) => `#${r.id} ${r.active ? "" : "(off) "}«${r.name}» ${r.model_name} ${r.trigger} actions=${JSON.stringify(r.action_server_ids)} fields=${JSON.stringify(r.trigger_field_ids)} domain=${r.filter_domain || "-"} pre=${r.filter_pre_domain || "-"}`).join("\n");
});
await safe("server action #979 (read only — it is not to be changed)", async () => {
  const [a] = await call("ir.actions.server", "read", { ids: [979], fields: ["id", "name", "state", "model_name", "code", "base_automation_id", "usage"] });
  return { ...a, code: mask(a.code) };
});
await safe("ir.cron (all): id, name, interval, nextcall, active, user, action", async () => {
  const rows = await call("ir.cron", "search_read", { domain: [], fields: ["id", "cron_name", "interval_number", "interval_type", "nextcall", "active", "user_id", "ir_actions_server_id", "model_id", "state"], order: "id asc", context: ALL });
  return rows.map((r) => `#${r.id} ${r.active ? "" : "(off) "}«${r.cron_name}» every ${r.interval_number} ${r.interval_type} next=${r.nextcall} user=${JSON.stringify(r.user_id)} action=${JSON.stringify(r.ir_actions_server_id)} model=${JSON.stringify(r.model_id)} ${r.state}`).join("\n");
});
await safe("ir.cron fields", () => fieldsOf("ir.cron", (k) => !/^(message_|activity_|website_|create_|write_|__)/.test(k)));
await safe("users (tz)", () => call("res.users", "search_read", { domain: [], fields: ["id", "name", "login", "tz", "share", "active"], context: ALL }));
await safe("views on discuss.channel", async () => {
  const rows = await call("ir.ui.view", "search_read", { domain: [["model", "=", "discuss.channel"]], fields: ["id", "name", "type", "mode", "inherit_id", "priority", "active"], order: "id asc", context: ALL });
  return rows.map((r) => `#${r.id} ${r.active ? "" : "(off) "}${r.name} ${r.type} ${r.mode} inherit=${JSON.stringify(r.inherit_id)} prio=${r.priority}`).join("\n");
});
await safe("act_window on discuss.channel", () => call("ir.actions.act_window", "search_read", { domain: [["res_model", "=", "discuss.channel"]], fields: ["id", "name", "view_mode", "domain", "context"], context: ALL }));
await safe("client actions of discuss", () => call("ir.actions.client", "search_read", { domain: [["tag", "ilike", "mail"]], fields: ["id", "name", "tag", "params"], context: ALL }));

// ------------------------------------------------------------ 2: «📈 تاريخ الأسعار»
await safe("act_window #1046 and menu #588 (and its siblings under the same parent)", async () => {
  const [a] = await call("ir.actions.act_window", "read", { ids: [1046], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id", "view_ids", "target", "help"] });
  const vids = a.view_ids?.length ? await call("ir.actions.act_window.view", "read", { ids: a.view_ids, fields: ["id", "sequence", "view_mode", "view_id"] }) : [];
  const [m] = await call("ir.ui.menu", "read", { ids: [588], fields: ["id", "name", "parent_id", "action", "sequence", "active"] });
  const sib = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", m.parent_id[0]]], fields: ["id", "name", "action", "sequence", "active"], order: "sequence asc, id asc", context: ALL });
  return { action: a, views: vids, menu: m, siblings: sib };
});
await safe("views #2891 #2892 #2895 (name, type, arch)", async () => (await call("ir.ui.view", "read", { ids: [2891, 2892, 2895], fields: ["id", "name", "type", "model", "arch_db", "active"] })).map((v) => `#${v.id} ${v.name} ${v.type} ${v.model} active=${v.active}\n${v.arch_db}`).join("\n\n"));
await safe("the history model's fields", async () => {
  const [a] = await call("ir.actions.act_window", "read", { ids: [1046], fields: ["res_model"] });
  return `${a.res_model}\n` + await fieldsOf(a.res_model, (k) => !/^(message_|activity_|website_|__|create_uid|write_uid)/.test(k));
});
await safe("x_price_day fields", () => fieldsOf("x_price_day", (k) => k.startsWith("x_") && !/html/.test(k)));
await safe("x_pricing_config #1", async () => (await call("x_pricing_config", "search_read", { domain: [], fields: [], limit: 1 }))[0]);

// ------------------------------------------------------------ 3: § 62 د leftovers
await safe("view #2789 (the sale order's «تنزيل PDF (UTAK)») and every view that names a static-token route", async () => {
  const [v] = await call("ir.ui.view", "read", { ids: [2789], fields: ["id", "name", "type", "model", "mode", "inherit_id", "priority", "active", "arch_db"] });
  const others = await call("ir.ui.view", "search_read", { domain: ["|", "|", ["arch_db", "ilike", "sale-quotation-pdf"], ["arch_db", "ilike", "invoice-pdf"], ["arch_db", "ilike", "purchase-order-pdf"]], fields: ["id", "name", "model", "active"], context: ALL });
  return { view: { ...v, arch_db: mask(v.arch_db) }, viewsNamingTheRoutes: others };
});
await safe("server actions / url actions that name a static-token route", async () => {
  const srv = await call("ir.actions.server", "search_read", { domain: ["|", "|", ["code", "ilike", "sale-quotation-pdf"], ["code", "ilike", "invoice-pdf"], ["code", "ilike", "purchase-order-pdf"]], fields: ["id", "name", "model_name", "state"], context: ALL });
  const hooks = await call("ir.actions.server", "search_read", { domain: [["webhook_url", "ilike", "-pdf"]], fields: ["id", "name", "model_name", "state", "webhook_url"], context: ALL }).catch((e) => `webhook_url search failed: ${String(e.message).slice(0, 120)}`);
  const urls = await call("ir.actions.act_url", "search_read", { domain: [["url", "ilike", "-pdf"]], fields: ["id", "name", "url", "target"], context: ALL });
  return { serverActions: srv, webhookActions: Array.isArray(hooks) ? hooks.map((h) => ({ ...h, webhook_url: mask(h.webhook_url) })) : hooks, urlActions: urls.map((u) => ({ ...u, url: mask(u.url) })) };
});
await safe("sale.order.line x_* fields", () => fieldsOf("sale.order.line", (k) => k.startsWith("x_")));
await safe("S00015 / S00016 and S00016's lines", async () => {
  const orders = await call("sale.order", "search_read", { domain: [["name", "in", ["S00015", "S00016"]]], fields: ["id", "name", "state", "partner_id", "amount_total", "write_date"], context: ALL });
  const s16 = orders.find((o) => o.name === "S00016");
  const lines = s16 ? await call("sale.order.line", "search_read", { domain: [["order_id", "=", s16.id]], fields: ["id", "sequence", "display_type", "name", "product_id", "product_uom_qty", "price_unit", "x_packaging_id", "x_item_origin", "x_item_size", "write_date"], order: "sequence asc, id asc" }) : [];
  return { orders, lines: lines.map((l) => `#${l.id} seq=${l.sequence} ${l.display_type || "line"} product=${JSON.stringify(l.product_id)} qty=${l.product_uom_qty} price=${l.price_unit} pack=${JSON.stringify(l.x_packaging_id)} origin=${l.x_item_origin} size=${l.x_item_size} «${String(l.name).split("\n")[0]}»`).join("\n") };
});
await safe("x_special_quote fields", () => fieldsOf("x_special_quote", (k) => k.startsWith("x_")));
await safe("x_special_quote_line fields", () => fieldsOf("x_special_quote_line", (k) => k.startsWith("x_")));
await safe("SQ-0002 (#2) head and lines (the pack text)", async () => {
  const [q] = await call("x_special_quote", "read", { ids: [2], fields: ["id", "x_name", "x_state", "x_price_mode", "x_layout", "x_sale_order_id", "write_date"] });
  const lines = await call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "=", 2]], fields: ["id", "x_sequence", "x_product_tmpl_id", "x_qty", "x_unit", "x_item_origin", "x_item_size", "x_final_price", "x_final_net"], order: "x_sequence asc, id asc" });
  return { head: q, lines: lines.map((l) => `#${l.id} seq=${l.x_sequence} ${JSON.stringify(l.x_product_tmpl_id)} qty=${l.x_qty} unit=«${l.x_unit}» origin=${l.x_item_origin} size=${l.x_item_size} final=${l.x_final_price}/${l.x_final_net}`).join("\n") };
});
await safe("automation #29 and its action", async () => {
  const [a] = await call("base.automation", "read", { ids: [29], fields: ["id", "name", "model_name", "trigger", "active", "action_server_ids", "trigger_field_ids", "filter_domain", "filter_pre_domain"] });
  const acts = await call("ir.actions.server", "read", { ids: a.action_server_ids, fields: ["id", "name", "state", "model_name", "code", "webhook_url", "webhook_field_ids"] });
  const tf = a.trigger_field_ids?.length ? await call("ir.model.fields", "read", { ids: a.trigger_field_ids, fields: ["id", "name", "model"] }) : [];
  return { automation: a, triggerFields: tf.map((f) => `${f.model}.${f.name}`), actions: acts.map((x) => ({ ...x, code: mask(x.code), webhook_url: mask(x.webhook_url) })) };
});
await safe("server actions #1049–#1058 (names, kinds; urls masked)", async () => (await call("ir.actions.server", "search_read", { domain: [["id", ">=", 1049], ["id", "<=", 1058]], fields: ["id", "name", "state", "model_name", "webhook_url"], order: "id asc", context: ALL })).map((x) => `#${x.id} ${x.name} ${x.state} ${x.model_name} ${mask(x.webhook_url || "")}`).join("\n"));
await safe("x_preview_ticket fields and rows", async () => {
  const f = await fieldsOf("x_preview_ticket", (k) => !/^(__|display_name)/.test(k));
  const rows = await call("x_preview_ticket", "search_read", { domain: [], fields: ["id", "x_model", "x_res_id", "x_used", "create_date"], order: "id asc", context: ALL });
  return `${f}\n\n${rows.map((r) => `#${r.id} ${r.x_model} #${r.x_res_id} used=${r.x_used} ${r.create_date}`).join("\n")}`;
});
