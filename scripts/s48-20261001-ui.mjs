// § 48 هـ–و (2026-10-01) — UTAK ← «💲 التسعير»: everything about pricing in one menu, the first of UTAK.
//
//   📊 اليوم            one screen for the day (it merges «💰 أسعار اليوم» and «📊 لوحة التسعير»): the header,
//                       the lines in one editable table («قرار براء» chosen in the row), cards on a phone,
//                       «🔄 إعادة الحساب», «نشر المعتمد الآن» behind a confirmation that names how many
//                       items go to how many customers, the day before / after. Opens on today's record,
//                       else the last day with a clear note; never creates a record.
//   📅 الأيام السابقة   the days and their chart; a day opens on the screen of «📊 اليوم».
//   📥 عروض المصادر     the day's purchase replies (x_daily_price), market observations (x_price_offer) and
//                       price asks (x_supplier_price_request_log) in one screen: the raw reply, the extracted
//                       value, the extraction status; the simulation left out.
//   📦 الأصناف          the produce, edited in the list: «نشط للبيع», the packaging and its weight, the
//                       category, the supplier; the filter «ناقص» = the rule of the «🆕 صنف جديد» alert.
//   ⚙️ الإعدادات        the waste, the minimum profit a carton, the expected cartons, the outlier ratio, the
//                       minimum order, the stops, the discount tiers — and the operating cost lines, shown
//                       and edited inside it, with the day's computed cost.
// The eleven pricing menus of before are hidden (active = false), nothing is deleted, and the actions
// that pointed at the old screens open the new ones.
//
//   node scripts/s48-20261001-ui.mjs                    dry-run: the plan, nothing written
//   node scripts/s48-20261001-ui.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s48-20261001-ui.mjs --verify           read-only checks
//   node scripts/s48-20261001-ui.mjs --rollback [--apply]          the old menus back, the new menu off, views / actions / values back
//   node scripts/s48-20261001-ui.mjs --rollback --drop [--apply]   and delete what this script created
//                                                                  (only after the worker's code is rolled back: it reads x_outlier_ratio, writes x_n_recipients)
//
// Rollback file: scripts/artifacts/s48-20261001-ui-rollback.json. The tenant is production: no order,
// invoice, payment, price or price day is written here — the schema, the views, the actions, the menus,
// x_pricing_config.x_outlier_ratio and the cost lines' link to their settings record. No WhatsApp.
import {
  APPLY, DROP, ROLLBACK, UTAK_MENU, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu, ensureServerAction, ensureView, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";
import {
  ACTION, CFG_COST_LINES, CFG_UI_FIELDS, COST_FIELDS, DAY_FIELDS, DAY_GRAPH, MARKET_LIST, MARKET_SEARCH, MENU, OLD_MENUS, OUTLIER_RATIO, PRODUCT_FIELDS, PURCHASE_LIST, PURCHASE_SEARCH,
  REF_CATEGORIES, VIEW, WINDOW, confirmCode, confirmForm, dayForm, dayList, openDayCode, productsDomain, productsList, productsSearch, settingsCode, settingsForm, sourcesForm,
  sourcesListCode, stepDayCode,
} from "./lib/s48-ui.mjs";
import * as S56 from "./lib/s56-ui.mjs";
import { FORM_CLASS } from "./lib/s57-ui.mjs";   // § 57 أ: the day's form carries its own class and stylesheet (the table wraps and clips nothing)
import { HISTORY_ACTION, HISTORY_TITLE } from "./lib/s58-ui.mjs";
import { REQUEST_ACTION, REQUEST_TITLE } from "./lib/s60-odoo.mjs";   // § 58 د: «📈 تاريخ الأسعار», a sixth screen under «💲 التسعير» (Odoo's own graph and pivot)

const RB = new URL("./artifacts/s48-20261001-ui-rollback.json", import.meta.url);
const DAY = "x_price_day", LINE = "x_price_day_line", CFG = "x_pricing_config", COST = "x_operating_cost", TMPL = "product.template", DP = "x_daily_price", PO = "x_price_offer";
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s48-20261001-ui.mjs");
const { rb, save } = ctx;
const pause = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "priority"], context: ALL }))[0];
const actionOf = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "code", "state", "model_id"], context: ALL }))[0];
const windowOf = async (name) => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", name]], fields: ["id", "res_model", "view_mode", "domain", "context", "view_id", "search_view_id"], context: ALL }))[0];
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};
const categoryIds = async () => {
  const cats = await call("product.category", "search_read", { domain: [["name", "in", REF_CATEGORIES], ["parent_id", "=", false]], fields: ["id", "name"], order: "id asc" });
  if (cats.length !== REF_CATEGORIES.length) throw new Error(`the categories ${REF_CATEGORIES.join(" / ")} were not all found: ${JSON.stringify(cats)} — stop`);
  return REF_CATEGORIES.map((n) => cats.find((c) => c.name === n).id);
};
const fieldHave = async (model, name) => !!(await one("ir.model.fields", [["model", "=", model], ["name", "=", name]]));

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  for (const m of b.menus ?? []) log(`menu #${m.id} «${m.name}»: active back to ${m.active}`);
  for (const id of Object.values(c.menus ?? {})) log(`menu #${id} (created): active = false${DROP ? " — dropped" : ""}`);
  for (const [k, v] of Object.entries(b.views ?? {})) log(`view ${k} #${v.id}: arch back`);
  for (const [k, v] of Object.entries(b.actions ?? {})) log(`server action ${k} #${v.id}: code back`);
  for (const [k, v] of Object.entries(b.windows ?? {})) log(`act_window ${k} #${v.id}: ${JSON.stringify(v.vals)} back`);
  if (b.costLinks) log(`${COST}: x_config_id back on ${b.costLinks.length} lines`);
  if (b.config) log(`${CFG} #${b.config.id}: x_outlier_ratio back to ${b.config.x_outlier_ratio}`);
  if (APPLY) {
    for (const m of b.menus ?? []) await call("ir.ui.menu", "write", { ids: [m.id], vals: { active: m.active } });
    const made = Object.values(c.menus ?? {}).filter(Boolean);
    if (made.length && !DROP) await call("ir.ui.menu", "write", { ids: made, vals: { active: false } });
    for (const v of Object.values(b.views ?? {})) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
    for (const v of Object.values(b.actions ?? {})) await call("ir.actions.server", "write", { ids: [v.id], vals: { code: v.code } });
    for (const v of Object.values(b.windows ?? {})) await call("ir.actions.act_window", "write", { ids: [v.id], vals: v.vals });
    if (!DROP) {
      for (const l of b.costLinks ?? []) await call(COST, "write", { ids: [l.id], vals: { x_config_id: l.x_config_id || false } });
      if (b.config) await call(CFG, "write", { ids: [b.config.id], vals: { x_outlier_ratio: b.config.x_outlier_ratio } });
    }
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", [...Object.values(c.menus ?? {})].reverse()], ["ir.actions.act_window", Object.values(c.windows ?? {})], ["ir.actions.server", Object.values(c.actions ?? {})],
      ["ir.ui.view", Object.values(c.views ?? {})], ["ir.default", c.irDefaults ?? []], ["ir.model.fields", [...(c.fields ?? [])].reverse()],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- the ids every view and action names
async function resolve() {
  const v = {}, a = {};
  for (const [k, name] of Object.entries(VIEW)) v[k] = (await viewOf(name))?.id ?? null;
  for (const [k, name] of Object.entries(ACTION)) a[k] = (await actionOf(name))?.id ?? null;
  for (const [k, name] of Object.entries(WINDOW)) a[k] = (await windowOf(name))?.id ?? null;
  return { v, a };
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const { v, a } = await resolve();
  const cats = await categoryIds();
  check("every view, server action and window of «💲 التسعير» exists", Object.values(v).every(Boolean) && Object.values(a).every(Boolean), JSON.stringify({ v, a }));
  // the menu: the first of UTAK, its five screens, the old ones hidden
  const kids = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", UTAK_MENU]], fields: ["id", "name", "sequence", "active", "action"], order: "sequence, id", context: ALL });
  const shown = kids.filter((m) => m.active);
  const root = shown.find((m) => m.name === MENU.root);
  check(`«${MENU.root}» is the first item of the UTAK menu (sequence ${root?.sequence}, before «${shown[1]?.name}» ${shown[1]?.sequence})`, !!root && shown[0]?.id === root.id && root.sequence < shown[1].sequence, JSON.stringify(shown.slice(0, 3).map((m) => [m.name, m.sequence])));
  const subs = root ? await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", root.id]], fields: ["id", "name", "sequence", "action"], order: "sequence, id" }) : [];
  // § 58 د — «📈 تاريخ الأسعار» (scripts/s58-20261005-day.mjs) sits after «📅 الأيام السابقة»: the five screens of § 48 are where they were
  const history = await one("ir.actions.act_window", [["name", "=", HISTORY_ACTION]]);
  // § 60 ج — «🙋 طلبوا وما كان متوفر» (scripts/s60-20261006-odoo.mjs) sits after it
  const requests = await one("ir.actions.act_window", [["name", "=", REQUEST_ACTION]]);
  const want = [[MENU.today, `ir.actions.server,${a.openDay}`], [MENU.days, `ir.actions.act_window,${a.days}`], [HISTORY_TITLE, `ir.actions.act_window,${history}`], [REQUEST_TITLE, `ir.actions.act_window,${requests}`], [MENU.sources, `ir.actions.server,${a.openSources}`], [MENU.products, `ir.actions.act_window,${a.products}`], [MENU.settings, `ir.actions.server,${a.settings}`]];
  check("its five screens, in order: 📊 اليوم · 📅 الأيام السابقة · 📥 عروض المصادر · 📦 الأصناف · ⚙️ الإعدادات — each on its action — and § 58's «📈 تاريخ الأسعار» and § 60's «🙋 طلبوا وما كان متوفر» after the second", JSON.stringify(subs.map((m) => [m.name, m.action])) === JSON.stringify(want), JSON.stringify(subs.map((m) => [m.name, m.action])));
  check("«💲 التسعير» itself carries no action, and «📊 اليوم» is its first screen: the UTAK app opens on it", root && !root.action && subs[0]?.name === MENU.today);
  const old = await call("ir.ui.menu", "search_read", { domain: [["id", "in", OLD_MENUS.map(([id]) => id)]], fields: ["id", "name", "active"], context: ALL });
  check(`the ${OLD_MENUS.length} pricing menus of before are hidden, none deleted (${old.filter((m) => !m.active).map((m) => `#${m.id}`).join(" ")})`, old.length === OLD_MENUS.length && old.every((m) => m.active === false), JSON.stringify(old.filter((m) => m.active)));
  const visible = await call("ir.ui.menu", "search_read", { domain: [["id", "child_of", UTAK_MENU], ["id", "not in", [root?.id ?? 0, ...subs.map((m) => m.id)]]], fields: ["id", "name", "action", "parent_id"] });
  const pricingActions = new Set([`ir.actions.server,${a.openDay}`, `ir.actions.server,${a.openDayOld}`, `ir.actions.server,${a.openSources}`, `ir.actions.server,${a.settings}`, `ir.actions.act_window,${a.days}`, `ir.actions.act_window,${a.products}`]);
  check("no other visible UTAK menu opens a pricing screen (no two copies of the same thing)", !visible.some((m) => pricingActions.has(m.action)) && !visible.some((m) => /أسعار اليوم|لوحة التسعير|إعدادات التسعير|التكاليف التشغيلية|عروض المصادر|الأسعار اليومية|معاملات التسعير/.test(m.name)), JSON.stringify(visible.filter((m) => pricingActions.has(m.action))));
  await pause();
  // the five screens open
  const run = async (id, context = {}) => call("ir.actions.server", "run", { ids: [id], context });
  const [today] = await call(DAY, "search_read", { domain: [["x_date", "=", riyadhToday()], ["x_utak_simulation", "=", false]], fields: ["id", "x_date"], limit: 1 });
  const [last] = await call(DAY, "search_read", { domain: [["x_date", "<=", riyadhToday()], ["x_utak_simulation", "=", false]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1 });
  const opened = await run(a.openDay);
  check(`«${MENU.today}» opens the day's record #${opened?.res_id} (${last?.x_date}) on the one screen (view #${v.day})${today ? "" : ", with the note «لا يوجد سجل لليوم»"}`, opened?.res_model === DAY && opened.res_id === last?.id && JSON.stringify(opened.views) === JSON.stringify([[v.day, "form"]]) && opened.context?.utak_no_today === !today && opened.target === "current", JSON.stringify(opened));
  const count = await call(DAY, "search_count", { domain: [] });
  check("…and creates no record (the old «💰 أسعار اليوم» action, redirected, does not either)", JSON.stringify((await run(a.openDayOld))?.views) === JSON.stringify([[v.day, "form"]]) && (await call(DAY, "search_count", { domain: [] })) === count);
  const src = await run(a.openSources);
  check(`«${MENU.sources}» opens the same day on the sources screen (view #${v.sources})`, src?.res_id === last?.id && JSON.stringify(src.views) === JSON.stringify([[v.sources, "form"]]), JSON.stringify(src));
  const set = await run(a.settings);
  const cfg = await activeConfig(["id", "x_outlier_ratio", "x_min_profit_sar", "x_waste_pct", "x_expected_cartons", "x_cost_line_ids", "x_day_cost_note"]);
  check(`«${MENU.settings}» opens the active settings record #${cfg?.id} (view #${v.settings})`, set?.res_model === CFG && set.res_id === cfg?.id && JSON.stringify(set.views) === JSON.stringify([[v.settings, "form"]]), JSON.stringify(set));
  const days = await windowOf(WINDOW.days), prods = await windowOf(WINDOW.products);
  check(`«${MENU.days}»: the list and the chart of the real days; a day opens on the screen of «${MENU.today}» (the model's first form view)`, days?.res_model === DAY && days.view_mode === "list,graph,form" && /x_utak_simulation/.test(String(days.domain)) && (await call("ir.ui.view", "search_read", { domain: [["model", "=", DAY], ["type", "=", "form"]], fields: ["id"], order: "priority, id", limit: 1 }))[0]?.id === v.day, JSON.stringify(days));
  check(`«${MENU.products}»: the produce in an editable list with the «ناقص» filter`, prods?.res_model === TMPL && prods.view_id?.[0] === v.products && prods.search_view_id?.[0] === v.productsSearch && String(prods.domain) === productsDomain(cats), JSON.stringify(prods));
  await pause();
  // what the screens render (get_views), and what they compute on the real records
  const dayArch = String((await call(DAY, "get_views", { views: [[v.day, "form"]] }))?.views?.form?.arch ?? "");
  check("the day's screen: the header (cost, share, counts, approval, publication, last run), the comparison at 500, the explanation", ["x_op_cost", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_approved_at", "x_published_at", "x_board_at", "x_state"].every((f) => dayArch.includes(`name="${f}"`)) && dayArch.includes("الربح الأدنى للكرتون"));
  // § 56 (2026-10-05) — the day's body was rebuilt (scripts/lib/s56-ui.mjs): the table is the review's nine columns, read-only, and
  // «قرار براء», «السعر المعدّل» and every other number (the source, the observations, break-even, sale, profit / preview, the status)
  // are in the line's own form. (This check failed from § 49 on: it still named the product and the packaging as two columns.)
  const dayList = /<list[\s\S]*?<\/list>/.exec(dayArch.slice(dayArch.indexOf('<field name="x_line_ids"')))?.[0] ?? "";
  const dayColumns = [...dayList.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].filter((m) => !/column_invisible|optional="hide"/.test(m[2])).map((m) => [m[1], /string="([^"]*)"/.exec(m[2])?.[1]]);
  const lineForm = /<form string="تفاصيل الصنف">[\s\S]*?<\/form>/.exec(dayArch)?.[0] ?? "";
  // § 57 أ (2026-10-05) — the same nine columns, in a form that takes the whole width: its own class and ONE stylesheet (scripts/lib/s57-ui.mjs)
  // under which the table wraps and clips nothing. (The list is read from the field itself: the stylesheet names x_line_ids too.)
  check(`…the lines in one table of § 56's nine columns (${S56.COLUMNS.map((c) => c[1]).join(" · ")}), read-only, wrapped by the form's own stylesheet (§ 57); «قرار براء», «السعر المعدّل» and the numbers behind them in the line's own form`, JSON.stringify(dayColumns) === JSON.stringify(S56.COLUMNS) && !/editable=/.test(dayList)
    && new RegExp(`<form[^>]*class="${FORM_CLASS}"`).test(dayArch) && dayArch.split("<style").length === 2 && dayArch.indexOf("<style>") < dayArch.indexOf('<field name="x_line_ids"')
    && ["x_decision", "x_manual_price", ...S56.DETAIL_FIELDS].every((f) => lineForm.includes(`name="${f}"`)), JSON.stringify(dayColumns));
  check("…cards on a phone (a kanban of the same lines: «القرار» with its mark, a coloured side border), and the line's form for the decision", /mode="list,kanban"/.test(dayArch) && dayArch.includes("border-start border-5") && /<kanban/.test(dayArch) && lineForm.includes('name="x_decision"') && /<kanban[\s\S]*name="x_outcome_show"[\s\S]*<\/kanban>/.test(dayArch));
  check(`…the buttons: «🔄 إعادة الحساب» (#${a.refresh}), «نشر المعتمد الآن» → the confirmation (#${a.confirm}), the day before (#${a.prev}) and after (#${a.next}); the publication is never one tap`, dayArch.includes(`name="${a.refresh}"`) && dayArch.includes(`name="${a.confirm}"`) && dayArch.includes(`name="${a.prev}"`) && dayArch.includes(`name="${a.next}"`) && !dayArch.includes(`name="${a.approve}"`));
  check("…and the other four screens one tap away (the row of links)", [a.days, a.openSources, a.products, a.settings].every((id) => dayArch.includes(`name="${id}"`)));
  const confArch = String((await call(DAY, "get_views", { views: [[v.confirm, "form"]] }))?.views?.form?.arch ?? "");
  check("the confirmation names the items and the customers, says it sends for real, and only its own button publishes", confArch.includes('name="x_n_publishable"') && confArch.includes('name="x_n_recipients"') && confArch.includes("رسائل واتساب فعلية") && confArch.includes(`name="${a.approve}"`) && confArch.includes('special="cancel"'));
  const conf = last ? await run(a.confirm, { active_model: DAY, active_id: last.id, active_ids: [last.id] }).catch((e) => ({ error: String(e.message) })) : null;
  const [lastState] = last ? await call(DAY, "read", { ids: [last.id], fields: ["x_state", "x_approved_at", "x_published_at", "x_n_publishable", "x_n_recipients", "x_publish_names", "x_is_today", "x_src_purchase_ids", "x_src_market_ids", "x_src_ask_ids"] }) : [];
  check(`«نشر المعتمد الآن» on #${last?.id} opens the confirmation as a dialog and changes nothing (state «${lastState?.x_state}», not approved, not published)`,
    (["draft", "missed"].includes(lastState?.x_state) ? conf?.target === "new" && JSON.stringify(conf.views) === JSON.stringify([[v.confirm, "form"]]) && conf.res_id === last.id : /لا يُنشر إلا/.test(conf?.error ?? "")) && (lastState?.x_state !== "missed" || (!lastState.x_approved_at && !lastState.x_published_at)), JSON.stringify(conf));
  log(`    #${last?.id}: الأصناف التي ستُنشر ${lastState?.x_n_publishable} (${lastState?.x_publish_names}) · العملاء ${lastState?.x_n_recipients} · سجل اليوم ${lastState?.x_is_today} · ردود الشراء ${lastState?.x_src_purchase_ids?.length} · مشاهدات السوق ${lastState?.x_src_market_ids?.length} · طلبات الأسعار ${lastState?.x_src_ask_ids?.length}`);
  const realDp = last ? await call(DP, "search_read", { domain: [["x_date", "=", last.x_date], ["x_utak_simulation", "!=", true]], fields: ["id"], order: "id" }) : [];
  const realPo = last ? await call(PO, "search_read", { domain: [["x_date", "=", last.x_date], ["x_utak_simulation", "!=", true]], fields: ["id"], order: "id" }) : [];
  check(`the sources screen of #${last?.id}: the real rows only — purchase replies ${realDp.map((r) => `#${r.id}`).join(" ") || "—"}, market observations ${realPo.length}, the simulation left out`,
    JSON.stringify([...(lastState?.x_src_purchase_ids ?? [])].sort((x, y) => x - y)) === JSON.stringify(realDp.map((r) => r.id)) && JSON.stringify([...(lastState?.x_src_market_ids ?? [])].sort((x, y) => x - y)) === JSON.stringify(realPo.map((r) => r.id)), JSON.stringify(lastState));
  const srcArch = String((await call(DAY, "get_views", { views: [[v.sources, "form"]] }))?.views?.form?.arch ?? "");
  check("…three tabs (ردود الشراء، مشاهدات السوق، طلبات الأسعار) with the raw reply, the extracted value and the extraction status; read-only", ["x_src_purchase_ids", "x_src_market_ids", "x_src_ask_ids", "x_raw_reply", "x_raw_text", "x_price_sar", "x_market_price", "x_extraction_status"].every((f) => srcArch.includes(`name="${f}"`)) && /<form[^>]*edit="0"/.test(srcArch));
  await pause();
  const prodArch = String((await call(TMPL, "get_views", { views: [[v.products, "list"], [v.productsSearch, "search"]] }))?.views?.list?.arch ?? "");
  check("«📦 الأصناف»: «نشط للبيع», the category, the supplier, the packaging and its weight edited in the list; «الناقص» shown", /<list[^>]*editable="bottom"/.test(prodArch) && ["x_is_active_for_sale", "categ_id", "x_supplier_ids", "x_pack_id", "x_pack_weight", "x_missing"].every((f) => prodArch.includes(`name="${f}"`)));
  const produce = await call(TMPL, "search_read", { domain: JSON.parse(productsDomain(cats).replace(/\(/g, "[").replace(/\)/g, "]").replace(/'/g, '"').replace(/False/g, "false")), fields: ["id", "name", "default_code", "categ_id", "x_is_active_for_sale", "x_supplier_ids", "x_name_en", "x_pack_id", "x_pack_weight", "x_missing", "type"], order: "id", context: ALL });
  const packs = await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", produce.map((p) => p.id)]], fields: ["id", "x_product_tmpl_id", "x_type", "x_approx_weight_kg", "x_is_default", "x_sequence"], order: "x_sequence, id" });
  const catRows = new Map((await call("product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"] })).map((c) => [c.id, c]));
  const { MISSING_LABEL } = await import("./lib/s48-ui.mjs");
  const expectMissing = (p) => {
    const out = [];
    let ok = false;
    for (let c = catRows.get(p.categ_id?.[0]), hops = 0; c && !ok && hops < 20; c = catRows.get(c.parent_id?.[0]), hops++) ok = REF_CATEGORIES.includes(String(c.name).trim());
    if (!ok) out.push(MISSING_LABEL.category);
    if (!(p.x_supplier_ids ?? []).length) out.push(MISSING_LABEL.supplier);
    if (!p.x_is_active_for_sale) out.push(MISSING_LABEL.forSale);
    const mine = packs.filter((k) => k.x_product_tmpl_id?.[0] === p.id);
    const d = mine.find((k) => k.x_is_default) ?? mine[0];
    if (!d) out.push(MISSING_LABEL.noPack);
    else if (d.x_type === "carton" && d.x_approx_weight_kg === 8) out.push(MISSING_LABEL.tempWeight);
    else if (["carton", "bag", "foam"].includes(d.x_type) && !(d.x_approx_weight_kg > 0)) out.push(MISSING_LABEL.noWeight);
    if (!String(p.x_name_en || "").trim()) out.push(MISSING_LABEL.english);
    return { text: out.join("، ") || false, pack: d?.id ?? false, weight: d?.x_approx_weight_kg ?? 0 };
  };
  const off = produce.filter((p) => { const e = expectMissing(p); return p.x_missing !== e.text || (p.x_pack_id?.[0] ?? false) !== e.pack || p.x_pack_weight !== e.weight; });
  check(`the ${produce.length} products of the list: «الناقص», the default packaging and its weight as the rule gives them (the rule of the «🆕 صنف جديد» alert)`, produce.length > 0 && off.length === 0, JSON.stringify(off.slice(0, 3).map((p) => [p.id, p.x_missing, expectMissing(p)])));
  check("…only produce: no service, no accounting intermediary (UTAK-SALE / UTAK-PUR)", produce.every((p) => p.type !== "service" && !/^UTAK-(SALE|PUR)/.test(String(p.default_code || ""))));
  log(`    ناقص ${produce.filter((p) => p.x_missing).length} من ${produce.length} · مكتمل ${produce.filter((p) => !p.x_missing).length}`);
  await pause();
  const setArch = String((await call(CFG, "get_views", { views: [[v.settings, "form"]] }))?.views?.form?.arch ?? "");
  check("«⚙️ الإعدادات»: نسبة التالف، الربح الأدنى للكرتون، الكراتين المتوقعة، نسبة السعر الشاذ، الحد الأدنى للطلب، المحطات، الشرائح — and the cost lines edited inside, with the day's computed cost", ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_min_order_sar", "x_planned_stops", "x_tier_ids", "x_cost_line_ids", "x_day_cost_note"].every((f) => setArch.includes(`name="${f}"`)) && !setArch.includes("x_min_margin_pct"));
  const costs = await call(COST, "search_read", { domain: [], fields: ["id", "x_config_id"], context: ALL });
  check(`every operating cost line (${costs.length}) is on the active settings record #${cfg?.id}, so it shows inside «⚙️ الإعدادات»`, costs.length > 0 && costs.every((c) => c.x_config_id?.[0] === cfg?.id) && (cfg?.x_cost_line_ids ?? []).length === costs.length, JSON.stringify(costs.filter((c) => c.x_config_id?.[0] !== cfg?.id)));
  if (rb.before.costs) {
    const now = await call(COST, "search_read", { domain: [], fields: ["id", "x_name", "x_cost_type", "x_frequency", "x_amount", "x_date_from", "x_date_to", "x_utak_simulation"], order: "id", context: ALL });
    check("…and no cost line's amount, dates or kind changed (the day's cost is the same)", JSON.stringify(now) === JSON.stringify(rb.before.costs), "a cost line differs from the snapshot");
  }
  check(`نسبة السعر الشاذ = ${OUTLIER_RATIO} on the active record, and the other settings untouched`, cfg?.x_outlier_ratio === OUTLIER_RATIO && (!rb.before.config || ["x_min_profit_sar", "x_waste_pct", "x_expected_cartons"].every((f) => cfg[f] === rb.before.config[f])), JSON.stringify(cfg));
  log(`    ${cfg?.x_day_cost_note}`);
  // the old actions are redirected, none deleted
  const acts = await call("ir.actions.server", "search_read", { domain: [["name", "in", [ACTION.openDay, ACTION.openDayOld, ACTION.prev, ACTION.next]]], fields: ["id", "name", "code"] });
  check("the old «أسعار اليوم» / «لوحة التسعير» actions (open, previous, next) now open the one screen — nothing points at the board's old form", acts.length === 4 && acts.every((x) => String(x.code).includes(String(v.day)) && !/\[\[2871, 'form'\]\]/.test(String(x.code)) && !/\.create\(/.test(String(x.code))), JSON.stringify(acts.map((x) => [x.id, x.name])));
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  check("the lock automation #23 is untouched and active", lock?.active === true);
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
rb.before.views ??= {}; rb.before.actions ??= {}; rb.before.windows ??= {}; rb.created.irDefaults ??= [];
const dayModel = await modelId(DAY), cfgModel = await modelId(CFG), costModel = await modelId(COST), tmplModel = await modelId(TMPL), lineModel = await modelId(LINE);
const cats = await categoryIds();
log(`الفئات: ${REF_CATEGORIES.map((n, i) => `${n} #${cats[i]}`).join(" · ")}`);

// 1. the fields
await ensureFields(ctx, DAY, dayModel, DAY_FIELDS);
await ensureFields(ctx, CFG, cfgModel, CFG_UI_FIELDS);
await ensureFields(ctx, COST, costModel, COST_FIELDS);
if (await fieldHave(COST, "x_config_id")) await ensureFields(ctx, CFG, cfgModel, [CFG_COST_LINES]);
else log(`+ ${CFG}.${CFG_COST_LINES.name} (one2many → ${COST}.x_config_id)`);
// the first --apply created x_pack_id not stored, and Odoo then refused the related fields through it («not
// searchable»): that empty field of this script's own is replaced by the stored one (nothing else is ever deleted)
const [packField] = await call("ir.model.fields", "search_read", { domain: [["model", "=", TMPL], ["name", "=", "x_pack_id"]], fields: ["id", "store"] });
if (packField && packField.store === false) {
  if (!(rb.created.fields ?? []).includes(packField.id)) throw new Error(`${TMPL}.x_pack_id #${packField.id} is not stored and was not created by this script — stop`);
  log(`✎ ${TMPL}.x_pack_id #${packField.id} (not stored, created by this script minutes ago, empty): replaced by a stored field`);
  if (APPLY) { await call("ir.model.fields", "unlink", { ids: [packField.id] }); rb.created.fields = rb.created.fields.filter((id) => id !== packField.id); rb.replaced = [...(rb.replaced ?? []), { field: "product.template.x_pack_id", id: packField.id, why: "not stored: Odoo refuses a related field through it" }]; save(); }
}
// the packaging's type is offered in the list only if Odoo takes a related selection (else its name and weight)
let withType = await fieldHave(TMPL, "x_pack_type");
for (const d of PRODUCT_FIELDS) {
  if (await fieldHave(TMPL, d.name)) { log(`= ${TMPL}.${d.name}`); continue; }
  log(`+ ${TMPL}.${d.name} (${d.ttype}${d.compute ? ", compute" : ""}${d.related ? `, related ${d.related}` : ""})`);
  if (!APPLY) continue;
  try {
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: tmplModel, ...d }] });
    rb.created.fields ??= []; rb.created.fields.push(id); save(); log(`  → #${id}`);
    if (d.name === "x_pack_type") withType = true;
  } catch (e) {
    if (d.name !== "x_pack_type") throw e;
    log(`  ✗ Odoo refused the related selection (${String(e.message).slice(0, 160)}) — the list shows the packaging's name and weight`);
  }
}

// 2. the values: the outlier ratio, and the cost lines on their settings record
const haveRatio = await fieldHave(CFG, "x_outlier_ratio");
const cfg = await activeConfig(["id", "x_name", "x_min_profit_sar", "x_waste_pct", "x_expected_cartons", ...(haveRatio ? ["x_outlier_ratio"] : [])]);
if (!cfg) throw new Error("no active x_pricing_config — stop");
if (cfg.x_outlier_ratio === OUTLIER_RATIO) log(`= config #${cfg.id} x_outlier_ratio ${OUTLIER_RATIO}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): x_outlier_ratio ${cfg.x_outlier_ratio ?? "∅"} → ${OUTLIER_RATIO} (the worker's own constant until now)`);
  if (APPLY) { rb.before.config ??= { id: cfg.id, x_outlier_ratio: cfg.x_outlier_ratio ?? 0, x_min_profit_sar: cfg.x_min_profit_sar, x_waste_pct: cfg.x_waste_pct, x_expected_cartons: cfg.x_expected_cartons }; save(); await call(CFG, "write", { ids: [cfg.id], vals: { x_outlier_ratio: OUTLIER_RATIO } }); }
}
const ensureDefault = async (model, field, value) => {
  const fid = await one("ir.model.fields", [["model", "=", model], ["name", "=", field]]);
  const defs = fid ? await call("ir.default", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "json_value"] }) : [];
  if (defs.length) { log(`= ir.default ${model}.${field} = ${defs[0].json_value} #${defs[0].id}`); return; }
  log(`+ ir.default ${model}.${field} = ${value}`);
  if (APPLY) { const [id] = await call("ir.default", "create", { vals_list: [{ field_id: fid, json_value: String(value) }] }); rb.created.irDefaults.push(id); save(); log(`  → #${id}`); }
};
await ensureDefault(CFG, "x_outlier_ratio", OUTLIER_RATIO);
await ensureDefault(COST, "x_config_id", cfg.id);
const haveLink = await fieldHave(COST, "x_config_id");
const costs = await call(COST, "search_read", { domain: [], fields: ["id", "x_name", "x_cost_type", "x_frequency", "x_amount", "x_date_from", "x_date_to", "x_utak_simulation", ...(haveLink ? ["x_config_id"] : [])], order: "id", context: ALL });
const loose = costs.filter((c) => c.x_config_id?.[0] !== cfg.id);
if (!loose.length) log(`= the ${costs.length} cost lines are on settings #${cfg.id}`);
else {
  log(`✎ ${COST}: x_config_id → #${cfg.id} on ${loose.length} lines (${loose.map((c) => `#${c.id}`).join(" ")}) — the link only, no amount or date`);
  if (APPLY) {
    rb.before.costLinks ??= loose.map((c) => ({ id: c.id, x_config_id: c.x_config_id?.[0] ?? false }));
    rb.before.costs ??= costs.map(({ x_config_id, ...rest }) => rest); save();
    await call(COST, "write", { ids: loose.map((c) => c.id), vals: { x_config_id: cfg.id } });
  }
}

// 3. the views, first as placeholders (their ids are named by the actions, and the actions' ids by the views)
const PLACE = { form: `<form><sheet><field name="display_name"/></sheet></form>`, list: `<list><field name="display_name"/></list>`, search: `<search><field name="display_name"/></search>`, graph: `<graph><field name="display_name"/></graph>` };
const NEW_VIEWS = [
  ["dayGraph", DAY, "graph", 16], ["confirm", DAY, "form", 95], ["sources", DAY, "form", 96],
  ["purchaseList", DP, "list", 90], ["purchaseSearch", DP, "search", 90], ["marketList", PO, "list", 90], ["marketSearch", PO, "search", 90],
  ["products", TMPL, "list", 90], ["productsSearch", TMPL, "search", 90],
];
for (const [key, model, type, priority] of NEW_VIEWS) await ensureView(ctx, key, VIEW[key], { model, type, priority, arch_base: PLACE[type] });
let { v, a } = await resolve();

// 4. the server actions and the windows
const setCode = async (key, name, code) => {
  const act = await actionOf(name);
  if (!act) throw new Error(`server action ${name} not found — stop`);
  if (act.code === code) { log(`= server action ${name} #${act.id}`); return; }
  log(`✎ server action ${name} #${act.id}: its code (${String(act.code).length} → ${code.length} characters)`);
  if (!APPLY) return;
  rb.before.actions[key] ??= { id: act.id, code: act.code }; save();
  await call("ir.actions.server", "write", { ids: [act.id], vals: { code } });
};
const newAction = async (key, name, model, code) => {
  const id = await ensureServerAction(ctx, key, name, { model_id: model, state: "code", code });
  return id;
};
const ready = Object.values(v).every(Boolean);
if (!ready && !APPLY) log("· (dry-run) the new views do not exist yet: the actions and the archs that name them are planned, not shown in full");
if (ready) {
  await newAction("openSources", ACTION.openSources, dayModel, openDayCode({ ...v, forceSources: true }));
  await newAction("confirm", ACTION.confirm, dayModel, confirmCode(v));
  await newAction("purchaseList", ACTION.purchaseList, dayModel, sourcesListCode(v, "purchase"));
  await newAction("marketList", ACTION.marketList, dayModel, sourcesListCode(v, "market"));
  await setCode("openDay", ACTION.openDay, openDayCode(v));
  await setCode("openDayOld", ACTION.openDayOld, openDayCode(v));
  await setCode("prev", ACTION.prev, stepDayCode(v, "prev"));
  await setCode("next", ACTION.next, stepDayCode(v, "next"));
  await setCode("settings", ACTION.settings, settingsCode(v));
  // the windows
  const days = await windowOf(WINDOW.days);
  if (!days) throw new Error(`act_window ${WINDOW.days} not found — stop`);
  const daysWant = { view_mode: "list,graph,form", domain: "[('x_utak_simulation', '=', False)]" };
  if (days.view_mode === daysWant.view_mode && days.domain === daysWant.domain) log(`= act_window ${WINDOW.days} #${days.id}`);
  else {
    log(`✎ act_window ${WINDOW.days} #${days.id}: view_mode ${days.view_mode} → ${daysWant.view_mode} · domain ${days.domain} → ${daysWant.domain}`);
    if (APPLY) { rb.before.windows.days ??= { id: days.id, vals: { view_mode: days.view_mode, domain: days.domain } }; save(); await call("ir.actions.act_window", "write", { ids: [days.id], vals: daysWant }); }
  }
  await ensureActWindow(ctx, "products", WINDOW.products, { res_model: TMPL, view_mode: "list,form", view_id: v.products, search_view_id: v.productsSearch, domain: productsDomain(cats), context: "{}" });
  const packList = await one("ir.ui.view", [["name", "=", "utak.x_product_packaging.list.editable"]]);
  await ensureActWindow(ctx, "packagings", WINDOW.packagings, { res_model: "x_product_packaging", view_mode: "list,form", ...(packList ? { view_id: packList } : {}), context: "{}" });
  const lineGraph = await one("ir.ui.view", [["name", "=", "utak.pricing_board_graph"]]), lineSearch = await one("ir.ui.view", [["name", "=", "utak.pricing_board_search"]]);
  await ensureActWindow(ctx, "profitGraph", WINDOW.profitGraph, { res_model: LINE, view_mode: "graph,list", ...(lineGraph ? { view_id: lineGraph } : {}), ...(lineSearch ? { search_view_id: lineSearch } : {}), domain: "[('x_utak_simulation', '=', False), ('x_day_id.x_utak_simulation', '=', False)]", context: "{'search_default_g_day': 1}" });
  ({ v, a } = await resolve());
}

// 5. the archs
const edit = async (key, name, arch) => {
  const cur = await viewOf(name);
  if (!cur) throw new Error(`view ${name} not found — stop`);
  if (cur.arch_db === arch) { log(`= view ${name} #${cur.id}`); return; }
  log(`✎ view ${name} #${cur.id}: ${cur.arch_db.length} → ${arch.length} characters`);
  if (!APPLY) return;
  rb.before.views[key] ??= { id: cur.id, arch: cur.arch_db }; save();
  await call("ir.ui.view", "write", { ids: [cur.id], vals: { arch_base: arch } });
};
if (ready && Object.values(a).every(Boolean)) {
  await edit("purchaseList", VIEW.purchaseList, PURCHASE_LIST);
  await edit("purchaseSearch", VIEW.purchaseSearch, PURCHASE_SEARCH);
  await edit("marketList", VIEW.marketList, MARKET_LIST);
  await edit("marketSearch", VIEW.marketSearch, MARKET_SEARCH);
  await edit("dayGraph", VIEW.dayGraph, DAY_GRAPH);
  await edit("dayList", VIEW.dayList, dayList(a));
  await edit("confirm", VIEW.confirm, confirmForm(a));
  await edit("sources", VIEW.sources, sourcesForm(a));
  await edit("day", VIEW.day, dayForm(a));
  await edit("products", VIEW.products, productsList(a, withType));
  await edit("productsSearch", VIEW.productsSearch, productsSearch(cats));
  await edit("settings", VIEW.settings, settingsForm(a));
} else log("· the archs are written once every view and action exists (--apply)");

// 6. the menu, and the old ones hidden
if (ready && Object.values(a).every(Boolean)) {
  const root = await ensureMenu(ctx, "root", MENU.root, UTAK_MENU, false, 1);
  if (root) {
    await ensureMenu(ctx, "today", MENU.today, root, `ir.actions.server,${a.openDay}`, 10);
    await ensureMenu(ctx, "days", MENU.days, root, `ir.actions.act_window,${a.days}`, 20);
    await ensureMenu(ctx, "sources", MENU.sources, root, `ir.actions.server,${a.openSources}`, 30);
    await ensureMenu(ctx, "products", MENU.products, root, `ir.actions.act_window,${a.products}`, 40);
    await ensureMenu(ctx, "settings", MENU.settings, root, `ir.actions.server,${a.settings}`, 50);
    const made = Object.values(rb.created.menus ?? {}).filter(Boolean);
    const offNow = made.length ? await call("ir.ui.menu", "search_read", { domain: [["id", "in", made], ["active", "=", false]], fields: ["id"], context: ALL }) : [];
    if (offNow.length) { log(`✎ the new menu was switched off by a rollback: on again (${offNow.map((m) => `#${m.id}`).join(" ")})`); if (APPLY) await call("ir.ui.menu", "write", { ids: offNow.map((m) => m.id), vals: { active: true } }); }
  } else log(`+ its five screens: ${[MENU.today, MENU.days, MENU.sources, MENU.products, MENU.settings].join(" · ")}`);
} else log(`+ menu ${MENU.root} (the first of UTAK) and its five screens`);
const old = await call("ir.ui.menu", "search_read", { domain: [["id", "in", OLD_MENUS.map(([id]) => id)]], fields: ["id", "name", "active", "action", "parent_id"], context: ALL });
for (const [id, name] of OLD_MENUS) {
  const m = old.find((x) => x.id === id);
  if (!m) throw new Error(`menu #${id} «${name}» not found — stop`);
  if (!m.name.includes(name.replace(/^\S+ /, "")) && m.name !== name) throw new Error(`menu #${id} is «${m.name}», not «${name}» — stop`);
}
const toHide = old.filter((m) => m.active);
if (!toHide.length) log(`= the ${OLD_MENUS.length} old pricing menus are hidden`);
else {
  log(`✎ hide (active = false, never deleted): ${toHide.map((m) => `#${m.id} «${m.name}»`).join(" · ")}`);
  if (APPLY && ready && Object.values(a).every(Boolean)) {
    rb.before.menus ??= old.map((m) => ({ id: m.id, name: m.name, active: m.active })); save();
    await call("ir.ui.menu", "write", { ids: toHide.map((m) => m.id), vals: { active: false } });
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
