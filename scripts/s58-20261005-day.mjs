// § 58 ج + د (2026-10-05) — «📊 اليوم» with its tabs, «📈 تاريخ الأسعار», and «هدف الربح اليومي» in the
// settings (scripts/lib/s58-ui.mjs is the data):
//
//   1  two views on x_price_day_line: utak.price_history_graph and utak.price_history_pivot (Odoo's own
//      graph and pivot: the market price, the sale price, the purchase price, the real profit and the
//      carton's contribution, by the day and the item)
//   2  the action «UTAK — تاريخ الأسعار» (graph, pivot, list; the real lines alone) and its menu
//      «📈 تاريخ الأسعار» under «💲 التسعير»
//   3  utak.price_day_form: the sheet from the tiles down moves, as it is, into the first page
//      «📍 اليوم» of a notebook, with x_target_html under the tiles; three pages more, one HTML field
//      each; one link more, «📊 حلّل بنفسك». The header (its buttons), the form's class and stylesheet,
//      the links, the banners and every field of § 57's screen are not touched.
//   4  utak.pricing_settings_form: «هدف الربح اليومي (ريال)» under «الكراتين المتوقعة يومياً»
//
//   node scripts/s58-20261005-day.mjs                    dry-run: the plan, nothing written
//   node scripts/s58-20261005-day.mjs --apply            the four steps (the rollback file first)
//   node scripts/s58-20261005-day.mjs --verify           read-only checks
//   node scripts/s58-20261005-day.mjs --rollback [--apply]          the two forms' arch as they were; the menu and the two views switched off
//   node scripts/s58-20261005-day.mjs --rollback --drop [--apply]   and delete the menu, the action and the two views — by Baraa's decision only
// Rollback file: scripts/artifacts/s58-20261005-day-rollback.json. The tenant is production. No
// WhatsApp send. No price, decision, order, invoice or payment is written here: two new views, one
// action, one menu, and the arch of two forms. The fields are scripts/s58-20261005-odoo.mjs's (run first).
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureMenu, ensureView, log, rollbackFile } from "./lib/s40-kit.mjs";
import { STYLE_TAG } from "./lib/s57-ui.mjs";
import {
  DAY_MODEL, HISTORY_ACTION, HISTORY_BUTTON, HISTORY_DAY_FIELD, HISTORY_DOMAIN, HISTORY_GRAPH_ARCH, HISTORY_ITEM_FIELD, HISTORY_MEASURES, HISTORY_MENU_SEQUENCE,
  HISTORY_PIVOT_ARCH, HISTORY_TITLE, LINE_MODEL, NEW_DAY_FIELDS, NOTEBOOK, PRICING_MENU, TABS, TARGET_FIELD, TODAY_TAB, VIEW_DAY, VIEW_HISTORY_GRAPH, VIEW_HISTORY_PIVOT, VIEW_SETTINGS,
  dayArch57Of, dayArch58, settingsArch57Of, settingsArch58,
} from "./lib/s58-ui.mjs";
import { PROFIT_TARGET_FIELD, PROFIT_TARGET_LABEL } from "./lib/s58-odoo.mjs";

const RB = new URL("./artifacts/s58-20261005-day-rollback.json", import.meta.url);
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s58-20261005-day.mjs");
const { rb, save } = ctx;
rb.before.views ??= {};
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active"], context: ALL }))[0];
const rendered = async (model, id, type) => String((await call(model, "get_views", { views: [[id, type]] }))?.views?.[type]?.arch ?? "");
const flat = (s) => s.replace(/\s+/g, " ").trim();
const headerOf = (arch) => /<header>[\s\S]*?<\/header>/.exec(arch)?.[0] ?? "";

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  for (const [name, was] of Object.entries(rb.before.views)) {
    log(`view #${was.id} ${name}: its arch back (${was.arch.length} characters)`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [was.id], vals: { arch_base: was.arch } });
  }
  const c = rb.created;
  const menus = Object.values(c.menus ?? {}).filter(Boolean), views = Object.values(c.views ?? {}).filter(Boolean), windows = Object.values(c.windows ?? {}).filter(Boolean);
  log(`menu ${menus.join(", ") || "-"} and views ${views.join(", ") || "-"} (created): ${DROP ? "dropped" : "active = false"}; the action ${windows.join(", ") || "-"}: ${DROP ? "dropped" : "stays (nothing opens it)"}`);
  if (APPLY && !DROP) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (views.length) await call("ir.ui.view", "write", { ids: views, vals: { active: false } });
  }
  if (DROP) await dropCreated(rb, [["ir.ui.menu", menus], ["ir.actions.act_window", windows], ["ir.ui.view", views]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const graph = await viewOf(VIEW_HISTORY_GRAPH), pivot = await viewOf(VIEW_HISTORY_PIVOT);
  check(`${VIEW_HISTORY_GRAPH} #${graph?.id} and ${VIEW_HISTORY_PIVOT} #${pivot?.id} on ${LINE_MODEL}, active, as written`, [[graph, "graph", HISTORY_GRAPH_ARCH], [pivot, "pivot", HISTORY_PIVOT_ARCH]].every(([v, t, a]) => v?.active && v.model === LINE_MODEL && v.type === t && v.arch_db === a), JSON.stringify([graph?.arch_db, pivot?.arch_db]));
  await pause();
  const lineFields = await call(LINE_MODEL, "fields_get", { attributes: ["type", "string", "store"] });
  check(`the five measures are stored numbers of the line, named as the screen names them (${HISTORY_MEASURES.map((m) => `«${m[1]}»`).join("، ")}), and the two axes are stored`, HISTORY_MEASURES.every(([f, label]) => lineFields[f]?.type === "float" && lineFields[f].store && lineFields[f].string === label) && lineFields[HISTORY_DAY_FIELD]?.type === "date" && lineFields[HISTORY_DAY_FIELD].store && lineFields[HISTORY_ITEM_FIELD]?.type === "many2one", JSON.stringify(HISTORY_MEASURES.map(([f]) => [f, lineFields[f]])));
  await pause();
  const [action] = await call("ir.actions.act_window", "search_read", { domain: [["name", "=", HISTORY_ACTION]], fields: ["id", "res_model", "view_mode", "domain", "view_ids", "view_id"] });
  const bound = action ? await call("ir.actions.act_window.view", "search_read", { domain: [["act_window_id", "=", action.id]], fields: ["sequence", "view_mode", "view_id"], order: "sequence" }) : [];
  check(`the action «${HISTORY_ACTION}» #${action?.id}: ${LINE_MODEL}, graph then pivot then list, its own two views, the real lines alone`, action?.res_model === LINE_MODEL && action.view_mode === "graph,pivot,list" && action.domain === HISTORY_DOMAIN
    && JSON.stringify(bound.map((b) => [b.view_mode, b.view_id?.[0]])) === JSON.stringify([["graph", graph?.id], ["pivot", pivot?.id]]), JSON.stringify([action, bound]));
  await pause();
  const [menu] = await call("ir.ui.menu", "search_read", { domain: [["name", "=", HISTORY_TITLE], ["parent_id", "=", PRICING_MENU]], fields: ["id", "sequence", "action", "active"] });
  check(`the menu «${HISTORY_TITLE}» #${menu?.id} under «💲 التسعير» (#${PRICING_MENU}), after «📅 الأيام السابقة», opens it`, !!menu?.active && menu.sequence === HISTORY_MENU_SEQUENCE && menu.action === `ir.actions.act_window,${action?.id}`, JSON.stringify(menu));
  await pause();
  // the real lines read as the views group them (read-only)
  let grouped = null, how = "";
  for (const [method, body] of [
    ["formatted_read_group", { domain: [["x_utak_simulation", "=", false], ["x_day_id.x_utak_simulation", "=", false]], groupby: [`${HISTORY_DAY_FIELD}:day`, HISTORY_ITEM_FIELD], aggregates: HISTORY_MEASURES.map(([f]) => `${f}:sum`) }],
    ["read_group", { domain: [["x_utak_simulation", "=", false], ["x_day_id.x_utak_simulation", "=", false]], fields: HISTORY_MEASURES.map(([f]) => f), groupby: [`${HISTORY_DAY_FIELD}:day`, HISTORY_ITEM_FIELD], lazy: false }],
  ]) {
    try { grouped = await call(LINE_MODEL, method, body); how = method; break; } catch (e) { how = `${method}: ${String(e?.message ?? e).slice(0, 120)}`; }
  }
  check(`Odoo groups the real lines by the day and the item with the five measures (${how}: ${grouped?.length ?? "-"} cells)`, Array.isArray(grouped) && grouped.length > 0, how);
  await pause();

  const day = await viewOf(VIEW_DAY);
  const was = rb.before.views[VIEW_DAY];
  check(`the day's form #${day?.id} carries § 58's notebook «${NOTEBOOK}»`, !!day?.arch_db.includes(`<notebook name="${NOTEBOOK}">`), String(day?.arch_db).slice(0, 80));
  if (was) check("…and without § 58's parts it is the form of § 57 byte for byte: the header (the buttons), the class, the stylesheet, the links, the banners, the tiles, the chart, the table, the details, «تقرير النشر»", dayArch57Of(day.arch_db) === was.arch && headerOf(day.arch_db) === headerOf(was.arch) && day.arch_db === dayArch58(was.arch, action?.id), `${day.arch_db.length} against ${was.arch.length}`);
  const arch = await rendered(DAY_MODEL, day.id, "form");
  const pages = [...arch.matchAll(/<page[^>]*string="([^"]*)"[^>]*name="([^"]*)"/g)].map((m) => [m[2], m[1]]);
  check(`it renders ONE notebook of four pages, in order: ${[TODAY_TAB, ...TABS].map((t) => `«${t.title}»`).join(" · ")}`, arch.split("<notebook").length === 2 && JSON.stringify(pages) === JSON.stringify([TODAY_TAB, ...TABS].map((t) => [t.name, t.title])), JSON.stringify(pages));
  const at = (s) => arch.indexOf(s);
  const today = arch.slice(at(`name="${TODAY_TAB.name}"`), at(`name="${TABS[0].name}"`));
  check("«📍 اليوم» holds everything the screen showed, in its order, with the target right under the tiles: the tiles, the target, the note, the chart, the table, the day's details, «تقرير النشر»", [`name="utak_day_tiles"`, `name="${TARGET_FIELD}"`, `name="utak_approved_note"`, `name="x_chart_html"`, `<field name="x_line_ids"`, `name="utak_day_details"`, `name="x_publish_report"`].map((s) => today.indexOf(s)).every((p, i, all) => p >= 0 && (i === 0 || p > all[i - 1])), today.slice(0, 200));
  check("each of the three tabs is ONE read-only HTML field and the line that says how it is built, and no tab's field shows anywhere else", TABS.every((t, i) => {
    const page = arch.slice(at(`name="${t.name}"`), i + 1 < TABS.length ? at(`name="${TABS[i + 1].name}"`) : at("</notebook>"));
    return (page.match(/<field /g) ?? []).length === 1 && new RegExp(`<field name="${t.field}"[^>]*readonly="1"`).test(page) && page.includes(`invisible="${t.field}"`) && arch.split(`<field name="${t.field}"`).length === 2;
  }) && NEW_DAY_FIELDS.every((f) => arch.includes(`name="${f}"`)), "");
  check("what stays above the tabs: the stylesheet of § 57 (one, first in the sheet), the links, the title, the state and the publication time", arch.split("<style").length === 2 && flat(/<style>([\s\S]*?)<\/style>/.exec(arch)?.[0] ?? "") === flat(STYLE_TAG) && [`<style>`, `name="utak_pricing_nav"`, `name="x_date"`, `name="utak_day_head"`, `<notebook`].map(at).every((p, i, all) => p >= 0 && (i === 0 || p > all[i - 1])), "");
  check(`the link «${HISTORY_BUTTON}» opens the action #${action?.id}, beside the four links that were there`, new RegExp(`<button[^>]*name="${action?.id}"[^>]*string="${HISTORY_BUTTON}"`).test(arch) && ["📅 الأيام السابقة", "📥 عروض المصادر", "📦 الأصناف", "⚙️ الإعدادات"].every((s) => arch.includes(`string="${s}"`)), "");
  check("the buttons of the header, as they were", ["🔄 إعادة الحساب", "نشر المعتمد الآن", "إلغاء الاعتماد", "◀ اليوم السابق", "اليوم التالي ▶"].every((s) => headerOf(arch).includes(`string="${s}"`)), headerOf(arch).slice(0, 200));
  await pause();

  const settings = await viewOf(VIEW_SETTINGS);
  const sWas = rb.before.views[VIEW_SETTINGS];
  const sArch = await rendered("x_pricing_config", settings.id, "form");
  check(`«⚙️ الإعدادات» #${settings?.id} shows «${PROFIT_TARGET_LABEL}» right under «الكراتين المتوقعة يومياً», and nothing else changed`, new RegExp(`<field name="x_expected_cartons"[^>]*/>\\s*<field name="${PROFIT_TARGET_FIELD}"`).test(sArch) && (!sWas || settingsArch57Of(settings.arch_db) === sWas.arch), sArch.slice(0, 200));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the two views of «${HISTORY_TITLE}»`);
for (const l of `${HISTORY_GRAPH_ARCH}\n${HISTORY_PIVOT_ARCH}`.split("\n")) log(`    ${l}`);
const graphId = await ensureView(ctx, "historyGraph", VIEW_HISTORY_GRAPH, { model: LINE_MODEL, type: "graph", priority: 30, arch_base: HISTORY_GRAPH_ARCH });
await pause();
const pivotId = await ensureView(ctx, "historyPivot", VIEW_HISTORY_PIVOT, { model: LINE_MODEL, type: "pivot", priority: 30, arch_base: HISTORY_PIVOT_ARCH });
await pause();

log(`— 2: the action and its menu`);
const actionId = await ensureActWindow(ctx, "history", HISTORY_ACTION, {
  res_model: LINE_MODEL, view_mode: "graph,pivot,list", domain: HISTORY_DOMAIN, context: "{}",
  view_ids: [[0, 0, { sequence: 1, view_mode: "graph", view_id: graphId }], [0, 0, { sequence: 2, view_mode: "pivot", view_id: pivotId }]],
  help: `<p>${HISTORY_MEASURES.map((m) => m[1]).join("، ")} — لكل يوم وصنف، من الأيام الحقيقية فقط (بلا محاكاة).</p>`,
});
await pause();
await ensureMenu(ctx, "history", HISTORY_TITLE, PRICING_MENU, actionId ? `ir.actions.act_window,${actionId}` : false, HISTORY_MENU_SEQUENCE);
await pause();

log(`— 3: «📊 اليوم» (${VIEW_DAY})`);
const day = await viewOf(VIEW_DAY);
if (!day) throw new Error(`view ${VIEW_DAY} not found — stop`);
// a dry-run before the action exists shows the plan with a stand-in id
const wantDay = dayArch58(day.arch_db, actionId ?? 999999);
if (wantDay === day.arch_db) log(`= view ${VIEW_DAY} #${day.id}`);
else {
  log(`✎ view ${VIEW_DAY} #${day.id}: ${day.arch_db.length} → ${wantDay.length} characters (the notebook «${NOTEBOOK}»: ${[TODAY_TAB, ...TABS].map((t) => t.title).join(" · ")}; ${TARGET_FIELD} under the tiles; the link «${HISTORY_BUTTON}»; nothing else)`);
  if (APPLY) {
    rb.before.views[VIEW_DAY] ??= { id: day.id, arch: day.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [day.id], vals: { arch_base: wantDay } });
  }
}
await pause();

log(`— 4: «⚙️ الإعدادات» (${VIEW_SETTINGS})`);
const settings = await viewOf(VIEW_SETTINGS);
if (!settings) throw new Error(`view ${VIEW_SETTINGS} not found — stop`);
const wantSettings = settingsArch58(settings.arch_db);
if (wantSettings === settings.arch_db) log(`= view ${VIEW_SETTINGS} #${settings.id}`);
else {
  log(`✎ view ${VIEW_SETTINGS} #${settings.id}: ${settings.arch_db.length} → ${wantSettings.length} characters («${PROFIT_TARGET_LABEL}» under «الكراتين المتوقعة يومياً»; nothing else)`);
  if (APPLY) {
    rb.before.views[VIEW_SETTINGS] ??= { id: settings.id, arch: settings.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [settings.id], vals: { arch_base: wantSettings } });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s58-20261005-day.mjs --verify" : "dry-run: nothing written");
