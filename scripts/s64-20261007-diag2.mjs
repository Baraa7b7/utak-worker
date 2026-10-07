// § 64 (2026-10-07) — read-only facts, second pass (nothing is written):
//   node scripts/s64-20261007-diag2.mjs > scripts/artifacts/logs/s64-diag2.log 2>&1
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

const chans = await call("discuss.channel", "search_read", { domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name", "last_interest_dt"], order: "id asc", context: ALL });
const ids = chans.map((c) => c.id);
await pause();
await safe("message types in whatsapp channels (count)", async () => {
  const out = {};
  for (const t of ["comment", "notification", "whatsapp_message", "email", "auto_comment", "user_notification"]) { out[t] = await call("mail.message", "search_count", { domain: [["model", "=", "discuss.channel"], ["res_id", "in", ids], ["message_type", "=", t]] }); await pause(300); }
  return out;
});
await safe("the last message of each whatsapp channel (any type) — id, date, type, attachments, Odoo's own preview", async () => {
  const out = [];
  for (const c of chans) {
    const [m] = await call("mail.message", "search_read", { domain: [["model", "=", "discuss.channel"], ["res_id", "=", c.id]], fields: ["id", "date", "message_type", "attachment_ids", "preview", "author_id"], order: "date desc, id desc", limit: 1 });
    out.push(`#${c.id} interest=${c.last_interest_dt} → ${m ? `msg#${m.id} ${m.date} ${m.message_type} att=${(m.attachment_ids ?? []).length} author=${m.author_id?.[0]} preview[${String(m.preview ?? "").length}]=${JSON.stringify(String(m.preview ?? "").slice(0, 70))}` : "no message"}`);
    await pause(250);
  }
  return out.join("\n");
});
await safe("messages with attachments in whatsapp channels (5): body length, preview", async () => (await call("mail.message", "search_read", { domain: [["model", "=", "discuss.channel"], ["res_id", "in", ids], ["attachment_ids", "!=", false]], fields: ["id", "date", "body", "preview", "attachment_ids"], order: "id desc", limit: 5 })).map((m) => `#${m.id} att=${m.attachment_ids.length} body[${String(m.body ?? "").length}]=${JSON.stringify(String(m.body ?? "").slice(0, 80))} preview=${JSON.stringify(m.preview)}`).join("\n"));
await safe("actions #971 #974 #975: bindings, and the views whose buttons call them", async () => {
  const acts = await call("ir.actions.server", "read", { ids: [971, 974, 975], fields: ["id", "name", "model_name", "binding_model_id", "binding_view_types", "base_automation_id"] });
  const views = await call("ir.ui.view", "search_read", { domain: ["|", "|", ["arch_db", "ilike", 'name="971"'], ["arch_db", "ilike", 'name="974"'], ["arch_db", "ilike", 'name="975"']], fields: ["id", "name", "model", "active"], context: ALL });
  const menus = await call("ir.ui.menu", "search_read", { domain: [["action", "in", ["ir.actions.server,971", "ir.actions.server,974", "ir.actions.server,975"]]], fields: ["id", "name", "action"], context: ALL });
  // which worker path each action's code names (the token itself is never shown)
  const code = await call("ir.actions.server", "read", { ids: [971, 974, 975], fields: ["id", "code"] });
  return { acts, views, menus, paths: code.map((c) => ({ id: c.id, paths: [...String(c.code).matchAll(/https:\/\/[a-z0-9.-]+(\/[a-z0-9/_-]+)/g)].map((m) => m[1]), lines: String(c.code).split("\n").length })) };
});
await safe("view #2908 (the sale order's § 62 د extension) and #2789's siblings", async () => (await call("ir.ui.view", "search_read", { domain: [["model", "=", "sale.order"], ["inherit_id", "=", 1225], ["name", "ilike", "utak"]], fields: ["id", "name", "priority", "active", "arch_db"], context: ALL })).map((v) => `#${v.id} ${v.name} prio=${v.priority} active=${v.active}\n${String(v.arch_db).replace(/(token=)[^&"'\s<]+/g, "$1<masked>")}`).join("\n\n"));
await safe("ir.default rows on custom models (shape)", () => call("ir.default", "search_read", { domain: [], fields: ["id", "field_id", "json_value", "user_id", "company_id", "condition"], limit: 8, order: "id desc" }));
await safe("x_price_day_line: real rows by day (count, with market, with purchase)", async () => {
  const rows = await call("x_price_day_line", "search_read", { domain: [["x_utak_simulation", "=", false], ["x_day_id.x_utak_simulation", "=", false]], fields: ["id", "x_day_date", "x_product_tmpl_id", "x_market_price", "x_cost_price", "x_sale_price", "x_full_cost", "x_break_even", "x_op_share", "x_waste_cost", "x_net_purchase", "x_packaging_id"], order: "x_day_date asc, id asc", limit: 2000 });
  const by = {};
  for (const r of rows) { const d = (by[r.x_day_date] ??= { n: 0, market: 0, purchase: 0 }); d.n++; if (r.x_market_price > 0) d.market++; if (r.x_cost_price > 0) d.purchase++; }
  const items = new Map();
  for (const r of rows) { const k = r.x_product_tmpl_id?.[0]; const it = items.get(k) ?? { name: r.x_product_tmpl_id?.[1], market: 0, purchase: 0 }; if (r.x_market_price > 0) it.market++; if (r.x_cost_price > 0) it.purchase++; items.set(k, it); }
  return { rows: rows.length, byDay: by, items: [...items.entries()].map(([k, v]) => `#${k} ${v.name}: market days ${v.market}, purchase days ${v.purchase}`), sample: rows.slice(-3) };
});
await safe("products on those lines: active for sale, category, default packaging", async () => {
  const p = await call("product.template", "search_read", { domain: [["x_is_active_for_sale", "=", true]], fields: ["id", "name", "categ_id", "x_is_active_for_sale", "active"], order: "id asc", context: ALL });
  return p.map((r) => `#${r.id} «${r.name}» cat=${JSON.stringify(r.categ_id)} active=${r.active}`).join("\n");
});
await safe("ir.actions.server #1032 (📊 اليوم menu action) — kind and code head", async () => { const [a] = await call("ir.actions.server", "read", { ids: [1032], fields: ["id", "name", "state", "model_name", "code"] }); return { ...a, code: String(a.code).split("\n").slice(0, 12).join("\n") }; });
await safe("res.partner fields for the search (phone-ish)", async () => Object.keys(await call("res.partner", "fields_get", { attributes: ["type"] })).filter((k) => /phone|mobile|whatsapp/.test(k)).join(", "));
