// § 64 (2026-10-07) — «💬 المحادثات» by date, the worker's «📈 تاريخ الأسعار» page and § 62 د's leftovers on the
// tenant (scripts/lib/s64-odoo.mjs is the data), in THREE parts:
//
//   schema (--only=schema, BEFORE the worker's code: it reads x_pack_text and x_active)
//     1  discuss.channel: x_pinned, x_last_msg_at, x_last_msg_preview, x_date_bucket, x_last_msg_label;
//        sale.order.line.x_pack_text «التعبئة»; x_preview_ticket.x_active (its default True, the six tickets of
//        § 62 د's checks archived)
//     2  the conversations' three code actions, the NEW automation on mail.message (#12 and #979 are not touched)
//        and the scheduled action 00:05 Riyadh; the code actions of the price-history page and of the request's
//        recalculation on a change of mode (both on no screen and under no automation yet)
//   chats (--only=chats, any time after schema: Odoo alone)
//     3  the first fill of every WhatsApp conversation from its last message (the dry-run counts each group)
//     4  the list and its search, the action, and the menu #565 «💬 المحادثات» on it
//   ui (--only=ui, AFTER the worker's code is deployed: the menu opens a route of the new code)
//     5  «📈 تاريخ الأسعار» #588 opens the worker's page; Odoo's own #1046 becomes «🔢 جدول الأسعار», pivot first,
//        under a menu of its own beside it
//     6  the sale order: «تنزيل PDF (UTAK)» (#2789) off, «التعبئة» in the lines; S00016's lines take «التعبئة» of
//        SQ-0002's (x_pack_text alone); the automation that recalculates a request when «الأسعار في العرض» or
//        «شكل العرض» changes
//
//   node scripts/s64-20261007-odoo.mjs --only=schema|chats|ui             dry-run: the plan, nothing written
//   node scripts/s64-20261007-odoo.mjs --only=schema|chats|ui --apply     (the rollback file first)
//   node scripts/s64-20261007-odoo.mjs --only=schema|chats|ui --verify    read-only checks
//   node scripts/s64-20261007-odoo.mjs --rollback [--apply]               the screens and the data back (see below)
// Rollback file: scripts/artifacts/s64-20261007-odoo-rollback.json. The tenant is production. No WhatsApp send.
// SQ-0002, S00015 and every message are not written; of S00016 only x_pack_text of its lines.
// ROLLBACK ORDER: (1) --rollback (the menus of before, the automations and the scheduled action off, «تنزيل PDF»
// back, the tickets and S00016's «التعبئة» as before), (2) THE CODE. Fields and actions stay (nothing is deleted).
import {
  APPLY, ROLLBACK, VERIFY, call, checker, ensureActWindow, ensureFields, ensureMenu, ensureServerAction, ensureView, fieldRow, log, modelId, rollbackFile,
} from "./lib/s40-kit.mjs";
import * as L from "./lib/s64-odoo.mjs";

const RB = new URL("./artifacts/s64-20261007-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s64-20261007-odoo.mjs");
const { rb, save } = ctx;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "priority", "type"], context: ALL }))[0] ?? null;
const actionByName = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "state", "model_name", "code", "usage"], context: ALL }))[0] ?? null;
const automationByName = async (name) => (await call("base.automation", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "trigger", "model_name", "filter_domain", "trigger_field_ids", "action_server_ids"], context: ALL }))[0] ?? null;
const cronRow = async () => (await call("ir.cron", "search_read", { domain: [["cron_name", "=", L.CHAT_CRON.name]], fields: ["id", "cron_name", "active", "interval_number", "interval_type", "nextcall", "lastcall", "user_id", "ir_actions_server_id", "failure_count"], context: ALL }))[0] ?? null;
const menuRow = async (id) => (await call("ir.ui.menu", "search_read", { domain: [["id", "=", id]], fields: ["id", "name", "action", "parent_id", "sequence", "active"], context: ALL }))[0] ?? null;
const windowByName = async (name, model) => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", name], ["res_model", "=", model]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "search_view_id", "view_id", "view_ids"], context: ALL }))[0] ?? null;
const fieldIds = async (model, names) => {
  const rows = await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "in", names]], fields: ["id", "name"] });
  return names.map((n) => rows.find((r) => r.name === n)?.id).filter(Boolean);
};
const chatIds = async () => ({ onMessage: (await actionByName(L.CHAT_ACTIONS.onMessage.name))?.id, pin: (await actionByName(L.CHAT_ACTIONS.pin.name))?.id, open: (await actionByName(L.CHAT_ACTIONS.open.name))?.id });
/** Every WhatsApp conversation with its last message, and what the list must show for it now (the JS twin of Odoo's code). */
async function expectedChats(now = Date.now()) {
  const chans = await call(L.CHANNEL_MODEL, "search_read", { domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name", "x_wa_partner_id", "x_pinned", "x_last_msg_at", "x_last_msg_preview", "x_date_bucket", "x_last_msg_label"], order: "id asc", limit: 1000, context: ALL });
  const out = [];
  for (const c of chans) {
    const [m] = await call(L.MESSAGE_MODEL, "search_read", { domain: [...L.MESSAGE_DOMAIN, ["res_id", "=", c.id]], fields: ["id", "date", "preview", "attachment_ids"], order: L.MESSAGE_ORDER, limit: 1 });
    const last = m ? L.odooMs(m.date) : NaN;
    out.push({ id: c.id, have: c, want: { x_last_msg_at: m ? m.date : false, x_last_msg_preview: (m ? L.previewOf(m.preview, (m.attachment_ids ?? []).length > 0) : "") || false, x_date_bucket: L.bucketOf(last, now, c.x_pinned === true), x_last_msg_label: L.labelOf(last, now) || false } });
    await pause(220);
  }
  return out;
}
const countByBucket = (rows, pick) => L.BUCKETS.map(([k, label]) => `${label} ${rows.filter((r) => pick(r) === k).length}`).join(" · ");
/** S00016's lines and SQ-0002's, matched by their order and their product: what «التعبئة» each sale line takes. */
async function packPlan() {
  const [so] = await call("sale.order", "search_read", { domain: [["name", "=", L.PACK_FILL.sale]], fields: ["id", "name", "state"], limit: 1 });
  if (!so) return { so: null, plan: [], problems: [`${L.PACK_FILL.sale} is not there`] };
  const sol = await call(L.SALE_LINE_MODEL, "search_read", { domain: [["order_id", "=", so.id], ["display_type", "=", false]], fields: ["id", "sequence", "product_id", "name", "x_pack_text"], order: "sequence asc, id asc" });
  const sql = await call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "=", L.PACK_FILL.quote]], fields: ["id", "x_sequence", "x_product_tmpl_id", "x_unit"], order: "x_sequence asc, id asc" });
  const variants = await call("product.product", "search_read", { domain: [["id", "in", sol.map((l) => l.product_id?.[0]).filter(Boolean)]], fields: ["id", "product_tmpl_id"], context: ALL });
  const tmplOf = new Map(variants.map((v) => [v.id, v.product_tmpl_id?.[0]]));
  const problems = [];
  if (sol.length !== sql.length) problems.push(`${sol.length} sale lines against ${sql.length} request lines`);
  const plan = sol.map((l, i) => {
    const q = sql[i];
    if (!q || q.x_sequence !== l.sequence || q.x_product_tmpl_id?.[0] !== tmplOf.get(l.product_id?.[0])) { problems.push(`line #${l.id} (seq ${l.sequence}) does not match the request's line ${i + 1}`); return null; }
    return { id: l.id, name: String(l.name).split("\n")[0], before: l.x_pack_text || false, pack: String(q.x_unit || "").trim() };
  }).filter(Boolean);
  return { so, plan, problems };
}
const OTHER_LINE_FIELDS = ["sequence", "display_type", "name", "product_id", "product_uom_qty", "price_unit", "price_subtotal", "price_tax", "price_total", "discount", "x_packaging_id", "x_item_origin", "x_item_size", "x_price_unit_manual"];
if (!ROLLBACK && !["schema", "chats", "ui"].includes(ONLY)) { console.log("say which part: --only=schema (before the code), --only=chats (Odoo alone), --only=ui (after the deploy)"); process.exit(2); }

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const put = async (label, model, id, vals) => { log(`✎ ${label}`); if (APPLY && id) await call(model, "write", { ids: [id], vals }); await pause(500); };
  const chat = await menuRow(L.CHAT_MENU_ID);
  if (chat && chat.action !== (rb.before.chatMenuAction ?? L.CHAT_MENU_OLD_ACTION)) await put(`menu #${chat.id} «${chat.name}»: action ← ${rb.before.chatMenuAction ?? L.CHAT_MENU_OLD_ACTION} (Odoo's Discuss)`, "ir.ui.menu", chat.id, { action: rb.before.chatMenuAction ?? L.CHAT_MENU_OLD_ACTION });
  else log("= menu #565: as before");
  const auto = await automationByName(L.CHAT_AUTOMATION.name);
  if (auto?.active) await put(`automation «${auto.name}» #${auto.id}: off`, "base.automation", auto.id, { active: false });
  const cron = await cronRow();
  if (cron?.active) await put(`scheduled action «${cron.cron_name}» #${cron.id}: off`, "ir.cron", cron.id, { active: false });
  const hist = await menuRow(L.HISTORY_MENU_ID);
  if (hist && rb.before.historyMenuAction && hist.action !== rb.before.historyMenuAction) await put(`menu #${hist.id} «${hist.name}»: action ← ${rb.before.historyMenuAction} (Odoo's own chart)`, "ir.ui.menu", hist.id, { action: rb.before.historyMenuAction });
  else log("= menu #588: as before");
  if (rb.before.historyWindow) {
    await put(`act_window #${L.HISTORY_WINDOW_ID}: name and view order of before`, "ir.actions.act_window", L.HISTORY_WINDOW_ID, { name: rb.before.historyWindow.name, view_mode: rb.before.historyWindow.view_mode });
    for (const v of rb.before.historyWindow.views ?? []) await put(`  its view #${v.id} (${v.view_mode}): sequence ← ${v.sequence}`, "ir.actions.act_window.view", v.id, { sequence: v.sequence });
  }
  if (rb.created.menus?.historyTable) await put(`menu «${L.HISTORY_TABLE_MENU.name}» #${rb.created.menus.historyTable}: off`, "ir.ui.menu", rb.created.menus.historyTable, { active: false });
  const old = await viewByName(L.OLD_PDF_VIEW_NAME);
  if (old && !old.active && rb.before.oldPdfViewActive === true) await put(`view ${old.name} #${old.id}: on again («تنزيل PDF (UTAK)»)`, "ir.ui.view", old.id, { active: true });
  const pack = await viewByName(L.VIEW_SALE_PACK);
  if (pack?.active) await put(`view ${pack.name} #${pack.id}: off`, "ir.ui.view", pack.id, { active: false });
  const mode = await automationByName(L.MODE_AUTOMATION.name);
  if (mode?.active) await put(`automation «${mode.name}» #${mode.id}: off`, "base.automation", mode.id, { active: false });
  for (const l of rb.before.packLines ?? []) await put(`sale line #${l.id}: x_pack_text ← ${JSON.stringify(l.before)}`, L.SALE_LINE_MODEL, l.id, { x_pack_text: l.before });
  if (rb.before.ticketsArchived?.length) {
    log(`✎ tickets #${rb.before.ticketsArchived.join(", #")}: active again`);
    if (APPLY) await call(L.TICKET_MODEL, "write", { ids: rb.before.ticketsArchived, vals: { x_active: true } });
  }
  log("the fields, the code actions, the list's views and the conversations' filled fields stay (nothing is deleted)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  if (ONLY === "schema") {
    for (const [model, defs] of [[L.CHANNEL_MODEL, L.CHANNEL_FIELDS], [L.SALE_LINE_MODEL, L.SALE_LINE_FIELDS], [L.TICKET_MODEL, L.TICKET_FIELDS]]) {
      const f = await call(model, "fields_get", { attributes: ["type", "string", "selection", "store"] });
      const bad = defs.filter((d) => !(f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && f[d.name].store !== false));
      check(`${model}: ${defs.map((d) => `${d.name} «${d.field_description}»`).join(", ")}`, !bad.length, JSON.stringify(bad.map((d) => [d.name, f[d.name]])));
      if (model === L.CHANNEL_MODEL) check(`«المجموعة»: ${L.BUCKETS.map(([, v]) => v).join(" ← ")}, in this order`, JSON.stringify(f.x_date_bucket?.selection ?? []) === JSON.stringify(L.BUCKETS), JSON.stringify(f.x_date_bucket?.selection));
      await pause();
    }
    const tf = await fieldRow(L.TICKET_MODEL, "x_active");
    const def = tf ? await call("ir.default", "search_read", { domain: [["field_id", "=", tf.id]], fields: ["id", "json_value", "user_id", "company_id"] }) : [];
    check("a new ticket is active: x_preview_ticket.x_active defaults to True for everyone", def.length === 1 && def[0].json_value === "true" && !def[0].user_id && !def[0].company_id, JSON.stringify(def));
    const tickets = await call(L.TICKET_MODEL, "search_read", { domain: [], fields: ["id", "x_active", "x_used"], order: "id asc", context: ALL });
    check(`the six tickets of § 62 د's checks (#${L.TICKETS_TO_ARCHIVE.join(" #")}) are archived, each one used`, L.TICKETS_TO_ARCHIVE.every((id) => { const t = tickets.find((x) => x.id === id); return t && t.x_active === false && t.x_used === true; }), JSON.stringify(tickets.filter((t) => L.TICKETS_TO_ARCHIVE.includes(t.id))));
    check("no ticket that was never used is archived", tickets.every((t) => t.x_active !== false || t.x_used === true), JSON.stringify(tickets.filter((t) => t.x_active === false && !t.x_used)));
    await pause();
    for (const def of [...Object.values(L.CHAT_ACTIONS), L.HISTORY_ACTION, L.MODE_ACTION]) {
      const a = await actionByName(def.name);
      check(`action ${def.name} #${a?.id}: code of ${def.model}, as written here`, a?.state === "code" && a.model_name === def.model && a.code === def.code, `${String(a?.code ?? "").length} chars against ${def.code.length}`);
      await pause(400);
    }
    const page = await actionByName(L.HISTORY_ACTION.name);
    check("the page's action: a ticket, then the prod worker's /history/t/<ticket> — no token in it", !!page && page.code.includes(`https://${L.PROD_HOST}${L.HISTORY_PATH}`) && !/token=/.test(page.code));
    const auto = await automationByName(L.CHAT_AUTOMATION.name), ids = await chatIds();
    check(`the NEW automation «${L.CHAT_AUTOMATION.name}» #${auto?.id}: on a new mail.message of a conversation (a comment), active, its one action #${ids.onMessage}`, !!auto?.active && auto.trigger === "on_create" && auto.model_name === L.MESSAGE_MODEL && JSON.stringify(auto.action_server_ids) === JSON.stringify([ids.onMessage]) && String(auto.filter_domain).includes("discuss.channel") && String(auto.filter_domain).includes("comment"), JSON.stringify(auto));
    const [a12] = await call("base.automation", "read", { ids: [12], fields: ["id", "name", "active", "action_server_ids", "filter_domain", "write_date"] });
    const [s979] = await call("ir.actions.server", "read", { ids: [979], fields: ["id", "name", "state", "write_date"] });
    check("the inbox's automation #12 and its action #979 are as they were (not written since before § 64)", a12?.name === "wa_inbox.on_message" && a12.active === true && JSON.stringify(a12.action_server_ids) === "[979]" && s979?.state === "webhook" && a12.write_date < "2026-10-07 18:00:00" && s979.write_date < "2026-10-07 18:00:00", JSON.stringify({ a12: a12?.write_date, s979: s979?.write_date }));
    await pause();
    const cron = await cronRow();
    const next = String(cron?.nextcall ?? "");
    check(`the scheduled action «${L.CHAT_CRON.name}» #${cron?.id}: active, every day`, !!cron?.active && cron.interval_number === 1 && cron.interval_type === "days", JSON.stringify(cron));
    check(`its hour: ${L.CHAT_CRON.utcTime} UTC = ${L.CHAT_CRON.riyadhTime} in Riyadh (next: ${next} UTC)`, next.slice(11) === L.CHAT_CRON.utcTime && new Date(L.odooMs(next) + 3 * 3600_000).toISOString().slice(11, 16) === L.CHAT_CRON.riyadhTime, next);
    const cronAct = cron ? (await call("ir.actions.server", "read", { ids: [cron.ir_actions_server_id[0]], fields: ["id", "state", "model_name", "code"] }))[0] : null;
    check("its code: every WhatsApp conversation again from its last message, as written here", cronAct?.state === "code" && cronAct.model_name === L.CHANNEL_MODEL && cronAct.code === L.CHAT_CRON.code);
    // the worker's reads of the new fields answer
    let how = "";
    const s = await call(L.SALE_LINE_MODEL, "search_read", { domain: [], fields: ["id", "x_pack_text", "x_packaging_id"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const t = await call(L.TICKET_MODEL, "search_read", { domain: [["x_name", "=", "none"]], fields: ["id", "x_model", "x_res_id", "x_used", "x_active", "create_date"], limit: 1, context: ALL }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    check("the worker's reads of the new fields answer", Array.isArray(s) && Array.isArray(t), how);
  } else if (ONLY === "chats") {
    const rows = await expectedChats();
    const off = rows.filter((r) => Object.entries(r.want).some(([k, v]) => (r.have[k] || false) !== v));
    check(`every WhatsApp conversation (${rows.length}) shows its last message's time, preview, group and label as of now (Riyadh days)`, rows.length > 0 && !off.length, JSON.stringify(off.slice(0, 3).map((r) => ({ id: r.id, have: [r.have.x_last_msg_at, r.have.x_date_bucket, r.have.x_last_msg_label], want: [r.want.x_last_msg_at, r.want.x_date_bucket, r.want.x_last_msg_label] }))));
    log(`  groups now: ${countByBucket(rows, (r) => r.have.x_date_bucket)}`);
    check(`a preview is never longer than ${L.PREVIEW_MAX} characters`, rows.every((r) => [...String(r.have.x_last_msg_preview || "")].length <= L.PREVIEW_MAX));
    const inner = await call(L.CHANNEL_MODEL, "search_read", { domain: [["x_wa_partner_id", "=", false], "|", ["x_date_bucket", "!=", false], ["x_last_msg_at", "!=", false]], fields: ["id", "name"], context: ALL });
    check("an internal conversation carries none of it", !inner.length, JSON.stringify(inner));
    const ids = await chatIds();
    const list = await viewByName(L.VIEW_CHAT_LIST), search = await viewByName(L.VIEW_CHAT_SEARCH);
    check(`the list ${L.VIEW_CHAT_LIST} #${list?.id}: as written (the customer, the preview, the time, 📌; «📌 تثبيت / إلغاء» on #${ids.pin}, «فتح» and a row's click on #${ids.open})`, !!list?.active && list.model === L.CHANNEL_MODEL && Object.values(ids).every(Boolean) && list.arch_db === L.chatListArch(ids), "the stored arch differs");
    check(`the search ${L.VIEW_CHAT_SEARCH} #${search?.id}: by the name and the number, «📌 المثبّتة», grouped by «المجموعة»`, !!search?.active && search.arch_db === L.CHAT_SEARCH_ARCH, "the stored arch differs");
    const win = await windowByName(L.CHAT_WINDOW.name, L.CHANNEL_MODEL);
    check(`the action «${L.CHAT_WINDOW.name}» #${win?.id}: the WhatsApp conversations alone, one list grouped by «المجموعة»`, win?.domain === L.CHAT_WINDOW.domain && win.context === L.CHAT_WINDOW.context && win.view_mode === L.CHAT_WINDOW.view_mode && win.search_view_id?.[0] === search?.id && win.view_id?.[0] === list?.id, JSON.stringify(win));
    const menu = await menuRow(L.CHAT_MENU_ID);
    check(`the menu #${L.CHAT_MENU_ID} «${menu?.name}» opens it (it opened ${L.CHAT_MENU_OLD_ACTION}: Odoo's Discuss)`, menu?.action === `ir.actions.act_window,${win?.id}` && menu.active, menu?.action);
    await pause();
    // the screen loads: Odoo combines the views and answers the grouped read the list makes
    let how = "";
    const views = await call(L.CHANNEL_MODEL, "get_views", { views: [[list?.id ?? false, "list"], [search?.id ?? false, "search"]] }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; });
    check("the list and its search load as Odoo serves them", String(views?.views?.list?.arch ?? "").includes("x_last_msg_preview") && String(views?.views?.search?.arch ?? "").includes("g_bucket"), how);
    const groups = await call(L.CHANNEL_MODEL, "formatted_read_group", { domain: [["x_wa_partner_id", "!=", false]], groupby: ["x_date_bucket"], aggregates: ["__count"] }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; });
    const order = (groups ?? []).map((g) => g.x_date_bucket);
    check(`the groups come in the list's order (${order.join(", ")})`, Array.isArray(groups) && order.length > 0 && JSON.stringify(order) === JSON.stringify([...order].sort()), how || JSON.stringify(groups));
    const [dayMenu] = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 529], ["action", "!=", false]], fields: ["id", "name", "sequence"], order: "sequence asc, id asc", limit: 1 });
    const [first] = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", 529]], fields: ["id", "name", "sequence"], order: "sequence asc, id asc", limit: 1 });
    check(`UTAK still opens on «💲 التسعير» first (its «📊 اليوم»): the first menu is #${first?.id} «${first?.name}», before «💬 المحادثات» #${dayMenu?.id}`, first?.id === 582 && dayMenu?.id === L.CHAT_MENU_ID, JSON.stringify({ first, dayMenu }));
    const [discuss] = await call("ir.actions.client", "read", { ids: [110], fields: ["id", "tag", "params"] });
    check("Odoo's own Discuss (#110) is as it was", discuss?.tag === "mail.action_discuss" && discuss.params?.default_active_id === "mail.box_inbox", JSON.stringify(discuss));
  } else {
    const page = await actionByName(L.HISTORY_ACTION.name);
    const hist = await menuRow(L.HISTORY_MENU_ID);
    check(`the menu #${L.HISTORY_MENU_ID} «${hist?.name}» opens the worker's page (the code action #${page?.id})`, !!page && hist?.action === `ir.actions.server,${page.id}` && hist.active && hist.name === "📈 تاريخ الأسعار", hist?.action);
    const [win] = await call("ir.actions.act_window", "read", { ids: [L.HISTORY_WINDOW_ID], fields: ["id", "name", "view_mode", "view_ids", "res_model", "domain", "search_view_id"] });
    const views = await call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "=", L.HISTORY_WINDOW_ID]], fields: ["id", "sequence", "view_mode"], order: "sequence asc, id asc" });
    check(`Odoo's own #${L.HISTORY_WINDOW_ID} is «${L.HISTORY_WINDOW_NAME}», the pivot first (the line chart is not what it opens on)`, win?.name === L.HISTORY_WINDOW_NAME && win.view_mode === L.HISTORY_WINDOW_MODE && views[0]?.view_mode === "pivot", JSON.stringify({ name: win?.name, view_mode: win?.view_mode, views }));
    check("…still the real days alone (no simulation)", String(win?.domain).includes("x_utak_simulation") && win.res_model === L.HISTORY_MODEL, win?.domain);
    const [table] = await call("ir.ui.menu", "search_read", { domain: [["name", "=", L.HISTORY_TABLE_MENU.name], ["parent_id", "=", L.HISTORY_PARENT_MENU]], fields: ["id", "action", "sequence", "active"], context: ALL });
    check(`a menu of its own «${L.HISTORY_TABLE_MENU.name}» #${table?.id} beside «📈 تاريخ الأسعار», under «💲 التسعير»`, table?.action === `ir.actions.act_window,${L.HISTORY_WINDOW_ID}` && table.active && table.sequence === L.HISTORY_TABLE_MENU.sequence, JSON.stringify(table));
    await pause();
    const old = await viewByName(L.OLD_PDF_VIEW_NAME);
    check(`the view #${old?.id} «تنزيل PDF (UTAK)» is off (not deleted)`, old?.id === L.OLD_PDF_VIEW_ID && old.active === false, JSON.stringify({ id: old?.id, active: old?.active }));
    const packView = await viewByName(L.VIEW_SALE_PACK), parent = await viewByName(L.SALE_FORM_PARENT);
    check(`the extension ${L.VIEW_SALE_PACK} #${packView?.id}: «التعبئة» in the sale order's lines`, !!packView?.active && packView.inherit_id?.[0] === parent?.id && packView.priority === L.SALE_PACK_PRIORITY && packView.arch_db === L.SALE_PACK_ARCH);
    let how = "";
    const combined = await call("sale.order", "get_views", { views: [[parent?.id ?? false, "form"]] }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; });
    const arch = String(combined?.views?.form?.arch ?? "");
    check("the sale order's form, as Odoo serves it: «👁️ معاينة PDF» and «إرسال واتساب (UTAK)», «التعبئة» in the lines, and no «تنزيل PDF (UTAK)»", arch.includes("معاينة PDF") && arch.includes("إرسال واتساب (UTAK)") && arch.includes('name="x_pack_text"') && !arch.includes("تنزيل PDF (UTAK)") && !arch.includes('name="971"'), how || `${arch.length} chars`);
    await pause();
    const { plan, problems } = await packPlan();
    const [quote] = await call("x_special_quote", "read", { ids: [L.PACK_FILL.quote], fields: ["id", "x_name", "write_date"] });
    check(`${L.PACK_FILL.sale}'s ${plan.length} lines carry «التعبئة» of ${quote?.x_name}'s, line for line`, plan.length > 0 && !problems.length && plan.every((p) => p.before === p.pack && p.pack), JSON.stringify(problems.length ? problems : plan.filter((p) => p.before !== p.pack)));
    const now = await call(L.SALE_LINE_MODEL, "read", { ids: plan.map((p) => p.id), fields: OTHER_LINE_FIELDS });
    const same = (rb.before.packOther ?? []).length === now.length && now.every((l) => JSON.stringify(l) === JSON.stringify((rb.before.packOther ?? []).find((b) => b.id === l.id)));
    check("…and no other field of those lines changed (as read before the write)", same, "a line differs from its snapshot in the rollback file");
    check("SQ-0002 itself is not written since before § 64", !!quote && quote.write_date < "2026-10-07 18:00:00", quote?.write_date);
    await pause();
    const mode = await automationByName(L.MODE_AUTOMATION.name), act = await actionByName(L.MODE_ACTION.name);
    const want = await fieldIds(L.QUOTE_MODEL, L.MODE_AUTOMATION.fields);
    check(`the automation «${L.MODE_AUTOMATION.name}» #${mode?.id}: on a write of «الأسعار في العرض» or «شكل العرض» alone, active, its action #${act?.id}`, !!mode?.active && mode.trigger === "on_write" && mode.model_name === L.QUOTE_MODEL && JSON.stringify([...(mode.trigger_field_ids ?? [])].sort()) === JSON.stringify([...want].sort()) && want.length === 2 && JSON.stringify(mode.action_server_ids) === JSON.stringify([act?.id]), JSON.stringify(mode));
    const [hook] = await call("ir.actions.server", "search_read", { domain: [["name", "=", L.RECALC_HOOK_ACTION]], fields: ["id", "state", "base_automation_id"] });
    const [a29] = await call("base.automation", "read", { ids: [29], fields: ["id", "active", "trigger_field_ids", "action_server_ids"] });
    check(`it presses § 62's own recalc webhook (#${hook?.id}); the save automation #29 is as it was (five fields)`, hook?.state === "webhook" && a29?.active === true && (a29.trigger_field_ids ?? []).length === 5 && JSON.stringify(a29.action_server_ids) === JSON.stringify([hook?.id]), JSON.stringify(a29));
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? `APPLY — ${ONLY}` : `dry-run — ${ONLY} (nothing is written; add --apply)`);
save(); // the rollback file before the first write
/** A code action as written here: made, or its code brought to this file's. */
async function codeAction(key, def) {
  for (const l of def.code.split("\n").slice(0, 3)) log(`    ${l}`);
  const id = await ensureServerAction(ctx, key, def.name, { model_id: await modelId(def.model), state: "code", code: def.code });
  const have = id ? await actionByName(def.name) : null;
  if (have && have.code !== def.code) {
    log(`✎ server action ${def.name} #${have.id}: its code, as written here`);
    rb.before[`code_${key}`] ??= have.code; save();
    if (APPLY) await call("ir.actions.server", "write", { ids: [have.id], vals: { code: def.code } });
  }
  await pause(500);
  return id;
}

if (ONLY === "schema") {
  log("— 1: the fields");
  await ensureFields(ctx, L.CHANNEL_MODEL, await modelId(L.CHANNEL_MODEL), L.CHANNEL_FIELDS);
  await pause();
  await ensureFields(ctx, L.SALE_LINE_MODEL, await modelId(L.SALE_LINE_MODEL), L.SALE_LINE_FIELDS);
  await pause();
  const hadActive = !!(await fieldRow(L.TICKET_MODEL, "x_active"));
  await ensureFields(ctx, L.TICKET_MODEL, await modelId(L.TICKET_MODEL), L.TICKET_FIELDS);
  {
    // at once after the field: a new ticket is active (the worker reads active tickets alone), and so is every
    // ticket but the six of § 62 د's checks — those stay as the new column leaves them: archived
    const tf = await fieldRow(L.TICKET_MODEL, "x_active");
    const def = tf ? await call("ir.default", "search_read", { domain: [["field_id", "=", tf.id]], fields: ["id", "json_value"] }) : [];
    if (def.length) log(`= default of ${L.TICKET_MODEL}.x_active: ${def[0].json_value}`);
    else { log(`+ default of ${L.TICKET_MODEL}.x_active: true`); if (APPLY) { rb.created.ticketDefault = (await call("ir.default", "create", { vals_list: [{ field_id: tf.id, json_value: "true" }] }))[0]; save(); } }
    const rows = tf ? await call(L.TICKET_MODEL, "search_read", { domain: [], fields: ["id", "x_active", "x_used"], order: "id asc", context: ALL }) : [];
    const keep = rows.filter((r) => !L.TICKETS_TO_ARCHIVE.includes(r.id) && r.x_active === false);
    if (!hadActive && keep.length) { log(`✎ tickets #${keep.map((r) => r.id).join(", #")}: active (they are not of the six)`); if (APPLY) await call(L.TICKET_MODEL, "write", { ids: keep.map((r) => r.id), vals: { x_active: true } }); }
    const six = rows.filter((r) => L.TICKETS_TO_ARCHIVE.includes(r.id));
    if (!tf) log(`✎ tickets #${L.TICKETS_TO_ARCHIVE.join(", #")}: archived (x_active off) — the six § 62 د's checks left`);
    else {
      const unused = six.filter((r) => !r.x_used);
      if (unused.length) { log(`✗ ticket #${unused.map((r) => r.id).join(", #")} was never used: not archived`); process.exit(1); }
      const on = six.filter((r) => r.x_active !== false);
      log(`${on.length ? "✎" : "="} tickets #${six.map((r) => r.id).join(", #")}: archived (x_active off)`);
      rb.before.ticketsArchived ??= six.map((r) => r.id); save();
      if (APPLY && on.length) await call(L.TICKET_MODEL, "write", { ids: on.map((r) => r.id), vals: { x_active: false } });
    }
  }
  await pause();
  log("— 2: the conversations' code actions, the new automation and the scheduled action");
  const ids = {};
  for (const [key, def] of Object.entries(L.CHAT_ACTIONS)) ids[key] = await codeAction(`chat_${key}`, def);
  // The message's action cannot be pressed through the API (Odoo refuses a server action on a mail.message the user
  // cannot write; an automation runs it as the system). It stops no message whatever happens in it (its try), and
  // --only=chats --verify holds every conversation against its newest message: a message the automation missed fails it.
  {
    const have = await automationByName(L.CHAT_AUTOMATION.name);
    if (have && !have.active) { log(`✎ automation ${L.CHAT_AUTOMATION.name} #${have.id}: on again`); if (APPLY) await call("base.automation", "write", { ids: [have.id], vals: { active: true } }); }
    else if (have) log(`= automation ${L.CHAT_AUTOMATION.name} #${have.id}`);
    else {
      log(`+ automation ${L.CHAT_AUTOMATION.name} (${L.CHAT_AUTOMATION.model}, ${L.CHAT_AUTOMATION.trigger}, ${L.CHAT_AUTOMATION.filter_domain})`);
      if (APPLY) {
        rb.created.chatAutomation = (await call("base.automation", "create", { vals_list: [{ name: L.CHAT_AUTOMATION.name, model_id: await modelId(L.CHAT_AUTOMATION.model), trigger: L.CHAT_AUTOMATION.trigger, filter_domain: L.CHAT_AUTOMATION.filter_domain, active: true, action_server_ids: [[6, 0, [ids.onMessage]]] }] }))[0];
        save(); log(`  → #${rb.created.chatAutomation}`);
      }
    }
    await pause();
    const cron = await cronRow();
    if (cron && !cron.active) { log(`✎ scheduled action #${cron.id}: on again`); if (APPLY) await call("ir.cron", "write", { ids: [cron.id], vals: { active: true, nextcall: L.nextCronCall(Date.now()) } }); }
    else if (cron) log(`= scheduled action «${L.CHAT_CRON.name}» #${cron.id} (next ${cron.nextcall} UTC)`);
    else {
      const nextcall = L.nextCronCall(Date.now());
      log(`+ scheduled action «${L.CHAT_CRON.name}»: every day, next ${nextcall} UTC (${L.CHAT_CRON.riyadhTime} Riyadh)`);
      if (APPLY) {
        rb.created.chatCron = (await call("ir.cron", "create", { vals_list: [{ name: L.CHAT_CRON.name, model_id: await modelId(L.CHAT_CRON.model), state: "code", code: L.CHAT_CRON.code, user_id: 1, interval_number: L.CHAT_CRON.interval_number, interval_type: L.CHAT_CRON.interval_type, nextcall, active: true }] }))[0];
        save(); log(`  → #${rb.created.chatCron}`);
      }
    }
    const row = await cronRow();
    if (row) {
      const [act] = await call("ir.actions.server", "read", { ids: [row.ir_actions_server_id[0]], fields: ["id", "code"] });
      if (act.code !== L.CHAT_CRON.code) { log(`✎ scheduled action #${row.id}: its code, as written here`); if (APPLY) await call("ir.cron", "write", { ids: [row.id], vals: { code: L.CHAT_CRON.code } }); }
    }
  }
  await pause();
  log("— the page's action and the mode's action (on no screen, under no automation yet)");
  await codeAction("history_page", L.HISTORY_ACTION);
  await codeAction("mode_recalc", L.MODE_ACTION);
  save();
  log(APPLY ? "done — verify: node scripts/s64-20261007-odoo.mjs --only=schema --verify" : "dry-run: nothing written");
  process.exit(0);
}

if (ONLY === "chats") {
  log("— 3: the first fill of every WhatsApp conversation from its last message");
  const cron = await cronRow();
  if (!cron) { log("✗ the scheduled action is not there — run --only=schema first"); process.exit(1); }
  const rows = await expectedChats();
  const todo = rows.filter((r) => Object.entries(r.want).some(([k, v]) => (r.have[k] || false) !== v));
  log(`${rows.length} WhatsApp conversations; ${todo.length} to fill; ${rows.filter((r) => !r.want.x_last_msg_at).length} with no message`);
  log(`groups: ${countByBucket(rows, (r) => r.want.x_date_bucket)}`);
  for (const r of rows) log(`  ${todo.includes(r) ? "✎" : "="} #${r.id} ${String(r.have.name).slice(0, 44)} → ${r.want.x_date_bucket} · ${r.want.x_last_msg_label || "—"} · «${String(r.want.x_last_msg_preview || "").slice(0, 40)}»`);
  if (APPLY && todo.length) {
    // Odoo's own code does it (the scheduled action's, pressed once): what 00:05 will run every night
    await call("ir.actions.server", "run", { ids: [cron.ir_actions_server_id[0]], context: { active_model: L.CHANNEL_MODEL } });
    log("  the scheduled action's code ran once");
  }
  await pause();
  log("— 4: the list, its search, the action and the menu");
  const ids = await chatIds();
  if (!Object.values(ids).every(Boolean)) { log("✗ the conversations' actions are not there — run --only=schema first"); process.exit(1); }
  const put = async (key, name, vals) => {
    const have = await viewByName(name);
    if (have && (have.arch_db !== vals.arch_base || !have.active)) { log(`✎ view ${name} #${have.id}: its arch, as written here`); if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: vals.arch_base, active: true } }); return have.id; }
    return ensureView(ctx, key, name, vals);
  };
  const listId = await put("chatList", L.VIEW_CHAT_LIST, { model: L.CHANNEL_MODEL, type: "list", priority: 99, arch_base: L.chatListArch(ids) });
  await pause();
  const searchId = await put("chatSearch", L.VIEW_CHAT_SEARCH, { model: L.CHANNEL_MODEL, type: "search", priority: 99, arch_base: L.CHAT_SEARCH_ARCH });
  await pause();
  const have = await windowByName(L.CHAT_WINDOW.name, L.CHANNEL_MODEL);
  const winId = have?.id ?? await ensureActWindow(ctx, "chats", L.CHAT_WINDOW.name, { res_model: L.CHANNEL_MODEL, view_mode: L.CHAT_WINDOW.view_mode, domain: L.CHAT_WINDOW.domain, context: L.CHAT_WINDOW.context, view_id: listId, search_view_id: searchId });
  if (have) log(`= act_window ${L.CHAT_WINDOW.name} #${have.id}`);
  await pause();
  const menu = await menuRow(L.CHAT_MENU_ID);
  const want = `ir.actions.act_window,${winId}`;
  if (menu.action === want) log(`= menu #${menu.id} «${menu.name}» opens the list`);
  else {
    log(`✎ menu #${menu.id} «${menu.name}»: action ${menu.action} → ${winId ? want : "the new list"}`);
    rb.before.chatMenuAction ??= menu.action; save();
    if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { action: want } });
  }
  save();
  log(APPLY ? "done — verify: node scripts/s64-20261007-odoo.mjs --only=chats --verify" : "dry-run: nothing written");
  process.exit(0);
}

// ui
log("— 5: «📈 تاريخ الأسعار» opens the worker's page; Odoo's own chart is «🔢 جدول الأسعار», pivot first");
{
  const page = await actionByName(L.HISTORY_ACTION.name);
  if (!page) { log("✗ the page's action is not there — run --only=schema first"); process.exit(1); }
  const menu = await menuRow(L.HISTORY_MENU_ID), want = `ir.actions.server,${page.id}`;
  if (menu.action === want) log(`= menu #${menu.id} «${menu.name}» opens the page`);
  else {
    log(`✎ menu #${menu.id} «${menu.name}»: action ${menu.action} → ${want}`);
    rb.before.historyMenuAction ??= menu.action; save();
    if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { action: want } });
  }
  await pause();
  const [win] = await call("ir.actions.act_window", "read", { ids: [L.HISTORY_WINDOW_ID], fields: ["id", "name", "view_mode"] });
  const views = await call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "=", L.HISTORY_WINDOW_ID]], fields: ["id", "sequence", "view_mode"], order: "sequence asc, id asc" });
  if (win.name === L.HISTORY_WINDOW_NAME && win.view_mode === L.HISTORY_WINDOW_MODE && views[0]?.view_mode === "pivot") log(`= act_window #${win.id} «${win.name}», pivot first`);
  else {
    log(`✎ act_window #${win.id}: «${win.name}» (${win.view_mode}) → «${L.HISTORY_WINDOW_NAME}» (${L.HISTORY_WINDOW_MODE})`);
    rb.before.historyWindow ??= { name: win.name, view_mode: win.view_mode, views }; save();
    if (APPLY) {
      await call("ir.actions.act_window", "write", { ids: [win.id], vals: { name: L.HISTORY_WINDOW_NAME, view_mode: L.HISTORY_WINDOW_MODE } });
      const order = L.HISTORY_WINDOW_MODE.split(",");
      for (const v of views) { const seq = order.indexOf(v.view_mode) + 1 || 9; if (v.sequence !== seq) await call("ir.actions.act_window.view", "write", { ids: [v.id], vals: { sequence: seq } }); }
    }
  }
  await pause();
  const [off] = await call("ir.ui.menu", "search_read", { domain: [["name", "=", L.HISTORY_TABLE_MENU.name], ["parent_id", "=", L.HISTORY_PARENT_MENU], ["active", "=", false]], fields: ["id"], context: ALL });
  if (off) { log(`✎ menu «${L.HISTORY_TABLE_MENU.name}» #${off.id}: on again`); if (APPLY) await call("ir.ui.menu", "write", { ids: [off.id], vals: { active: true } }); }
  else await ensureMenu(ctx, "historyTable", L.HISTORY_TABLE_MENU.name, L.HISTORY_PARENT_MENU, `ir.actions.act_window,${L.HISTORY_WINDOW_ID}`, L.HISTORY_TABLE_MENU.sequence);
  await pause();
}
log("— 6: the sale order (the old button off, «التعبئة»), S00016's lines, and the recalculation on a change of mode");
{
  const old = await viewByName(L.OLD_PDF_VIEW_NAME);
  if (!old || old.id !== L.OLD_PDF_VIEW_ID) { log(`✗ the view ${L.OLD_PDF_VIEW_NAME} #${L.OLD_PDF_VIEW_ID} is not there`); process.exit(1); }
  if (!old.active) log(`= view ${old.name} #${old.id}: already off`);
  else { log(`✎ view ${old.name} #${old.id}: off («تنزيل PDF (UTAK)» leaves the sale order; nothing is deleted)`); rb.before.oldPdfViewActive ??= true; save(); if (APPLY) await call("ir.ui.view", "write", { ids: [old.id], vals: { active: false } }); }
  await pause();
  const parent = await viewByName(L.SALE_FORM_PARENT);
  const have = await viewByName(L.VIEW_SALE_PACK);
  if (have && (!have.active || have.arch_db !== L.SALE_PACK_ARCH)) { log(`✎ view ${L.VIEW_SALE_PACK} #${have.id}: on, as written here`); if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true, arch_base: L.SALE_PACK_ARCH } }); }
  else await ensureView(ctx, "salePack", L.VIEW_SALE_PACK, { model: "sale.order", inherit_id: parent.id, mode: "extension", priority: L.SALE_PACK_PRIORITY, arch_base: L.SALE_PACK_ARCH });
  await pause();

  const { so, plan, problems } = await packPlan();
  if (problems.length) { for (const p of problems) log(`✗ ${p}`); process.exit(1); }
  const todo = plan.filter((p) => p.before !== p.pack);
  log(`${so.name} #${so.id} (${so.state}): ${plan.length} lines, ${todo.length} to fill`);
  for (const p of plan) log(`  ${todo.includes(p) ? "✎" : "="} line #${p.id} «${p.name}»: x_pack_text ${JSON.stringify(p.before)} → «${p.pack}»`);
  if (todo.length) {
    rb.before.packLines ??= plan.map((p) => ({ id: p.id, before: p.before }));
    rb.before.packOther ??= await call(L.SALE_LINE_MODEL, "read", { ids: plan.map((p) => p.id), fields: OTHER_LINE_FIELDS });
    save();
    if (APPLY) for (const p of todo) { await call(L.SALE_LINE_MODEL, "write", { ids: [p.id], vals: { x_pack_text: p.pack } }); await pause(300); }
  }
  await pause();

  const act = await actionByName(L.MODE_ACTION.name);
  if (!act) { log("✗ the mode's action is not there — run --only=schema first"); process.exit(1); }
  const auto = await automationByName(L.MODE_AUTOMATION.name);
  if (auto && !auto.active) { log(`✎ automation ${auto.name} #${auto.id}: on again`); if (APPLY) await call("base.automation", "write", { ids: [auto.id], vals: { active: true } }); }
  else if (auto) log(`= automation ${auto.name} #${auto.id}`);
  else {
    log(`+ automation ${L.MODE_AUTOMATION.name} (${L.MODE_AUTOMATION.model}, ${L.MODE_AUTOMATION.trigger}: ${L.MODE_AUTOMATION.fields.join(", ")})`);
    if (APPLY) {
      rb.created.modeAutomation = (await call("base.automation", "create", { vals_list: [{ name: L.MODE_AUTOMATION.name, model_id: await modelId(L.MODE_AUTOMATION.model), trigger: L.MODE_AUTOMATION.trigger, active: true, trigger_field_ids: [[6, 0, await fieldIds(L.QUOTE_MODEL, L.MODE_AUTOMATION.fields)]], action_server_ids: [[6, 0, [act.id]]] }] }))[0];
      save(); log(`  → #${rb.created.modeAutomation}`);
    }
  }
}
save();
log(APPLY ? "done — verify: node scripts/s64-20261007-odoo.mjs --only=ui --verify" : "dry-run: nothing written");
