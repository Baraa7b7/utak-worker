// § 60 (2026-10-06, Baraa's amendment) — «خلاصة اليوم» on «📊 اليوم», and «📈 تاريخ الأسعار» as a tool for
// analysis (scripts/lib/s60-ui.mjs is the data):
//
//   1  x_price_day: x_brief_html «خلاصة اليوم» (an HTML field under § 56's rules, as § 58's four)
//   2  the day's form (utak.price_day_form): the brief FIRST in «📍 اليوم», before the tiles — nothing else
//   3  «📈 تاريخ الأسعار»: its own search view («فيه سعر سوق», «فيه سعر شراء», «منشور», «آخر 14 يوماً»), and the
//      action opens on «فيه سعر سوق» and «آخر 14 يوماً» (the real lines alone, as it was)
//   4  one saved filter an item active for sale, by its name, shared: the chart on that item alone
//
//   node scripts/s60-20261006-day.mjs                    dry-run: the plan, nothing written
//   node scripts/s60-20261006-day.mjs --apply            the four steps (the rollback file first)
//   node scripts/s60-20261006-day.mjs --verify           read-only checks — and, read-only too, what is kept for a
//                                                        later analysis (the market's observations by source and day,
//                                                        the purchase and published price by item and day, the
//                                                        quantities delivered, the asks for what was not available)
//   node scripts/s60-20261006-day.mjs --rollback [--apply]   the form and the action as they were; the search view
//        and the saved filters off (active = false). The field stays (the worker writes it); nothing is deleted.
//   node scripts/s60-20261006-day.mjs --rollback --drop [--apply]   and delete the filters, the search view and the
//        field — by Baraa's decision only, AFTER the worker's code is rolled back.
// Rollback file: scripts/artifacts/s60-20261006-day-rollback.json. The tenant is production. No WhatsApp
// send. No price, decision, order, invoice, payment or journal entry is written here.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the engine writes x_brief_html with every run.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureView, log, modelId, rollbackFile } from "./lib/s40-kit.mjs";
import { dayArch57Of } from "./lib/s58-ui.mjs";
import {
  BRIEF_FIELD, BRIEF_FIELDS, BRIEF_TAG, DAY_MODEL, HISTORY_ACTION, HISTORY_CONTEXT, HISTORY_DAYS, HISTORY_DEFAULTS, HISTORY_FILTERS, HISTORY_SEARCH_ARCH,
  HISTORY_SEARCH_PRIORITY, LINE_MODEL, SANITIZE_FLAGS, VIEW_DAY, VIEW_HISTORY_GRAPH, VIEW_HISTORY_SEARCH, dayArch58Of, dayArch60, itemFilterVals, plainName,
} from "./lib/s60-ui.mjs";

const RB = new URL("./artifacts/s60-20261006-day-rollback.json", import.meta.url);
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s60-20261006-day.mjs");
const { rb, save } = ctx;
rb.before.views ??= {}; rb.before.action ??= null; rb.created.filters ??= {};
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const m2oId = (v) => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active", "priority"], context: ALL }))[0];
const rendered = async (model, id, type) => String((await call(model, "get_views", { views: [[id, type]] }))?.views?.[type]?.arch ?? "");
const actionRow = async () => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", HISTORY_ACTION]], fields: ["id", "res_model", "view_mode", "domain", "context", "search_view_id"] }))[0];
const activeItems = async () => call("product.template", "search_read", { domain: [["active", "=", true], ["sale_ok", "=", true], ["x_is_active_for_sale", "=", true]], fields: ["id", "name"], order: "id asc", limit: 500 });
const filtersOf = async (actionId) => call("ir.filters", "search_read", { domain: [["model_id", "=", LINE_MODEL], ["action_id", "=", actionId]], fields: ["id", "name", "active", "user_ids", "domain", "context", "sort", "is_default"], context: ALL, order: "id asc", limit: 1000 });

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const act = rb.before.action;
  log(act ? `✎ action #${act.id}: search_view_id ← ${act.search_view_id || "none"}, context ← ${act.context}` : "= the action: not changed by this script");
  if (APPLY && act) await call("ir.actions.act_window", "write", { ids: [act.id], vals: { search_view_id: act.search_view_id || false, context: act.context } });
  for (const [name, was] of Object.entries(rb.before.views)) {
    log(`✎ view #${was.id} ${name}: its arch back (${was.arch.length} characters)`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [was.id], vals: { arch_base: was.arch } });
  }
  const views = Object.values(rb.created.views ?? {}).filter(Boolean), filters = Object.values(rb.created.filters).filter(Boolean), fields = rb.created.fields ?? [];
  log(`✎ search view ${views.join(", ") || "-"} and saved filters ${filters.join(", ") || "-"} (created): ${DROP ? "dropped" : "active = false"}; field ${fields.join(", ") || "-"}: ${DROP ? "dropped" : "stays (the worker writes it)"}`);
  if (APPLY && !DROP) {
    if (filters.length) await call("ir.filters", "write", { ids: filters, vals: { active: false } });
    if (views.length) await call("ir.ui.view", "write", { ids: views, vals: { active: false } });
  }
  if (DROP) await dropCreated(rb, [["ir.filters", filters], ["ir.ui.view", views], ["ir.model.fields", [...fields].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const f = await call(DAY_MODEL, "fields_get", { attributes: ["type", "string"] });
  const [row] = await call("ir.model.fields", "search_read", { domain: [["model", "=", DAY_MODEL], ["name", "=", BRIEF_FIELD]], fields: ["name", ...SANITIZE_FLAGS] });
  check(`${DAY_MODEL}.${BRIEF_FIELD}: an HTML field «${BRIEF_FIELDS[0].field_description}» that keeps Odoo's sanitizer as § 56's chart does`, f[BRIEF_FIELD]?.type === "html" && f[BRIEF_FIELD].string === BRIEF_FIELDS[0].field_description && !!row && SANITIZE_FLAGS.every((k) => row[k] === BRIEF_FIELDS[0][k]), JSON.stringify(row));
  await pause();
  const day = await viewOf(VIEW_DAY), was = rb.before.views[VIEW_DAY];
  check(`the day's form #${day?.id} carries «خلاصة اليوم» once`, day?.arch_db.split(BRIEF_TAG).length === 2, "");
  if (was) check("…and without it the form is § 58's byte for byte (the notebook, the tabs, the tiles, the target, the chart, the table)", dayArch58Of(day.arch_db) === was.arch, `${dayArch58Of(day.arch_db).length} / ${was.arch.length}`);
  check("…and § 57's form byte for byte under it (the older verifies read the screen through dayArch57Of)", !dayArch57Of(day.arch_db).includes(BRIEF_FIELD) && !dayArch57Of(day.arch_db).includes("<notebook"), "");
  const arch = await rendered(DAY_MODEL, day.id, "form");
  const at = (s) => arch.indexOf(s);
  check("it renders the brief FIRST in «📍 اليوم», in a div of its own (Odoo pads the first html field of a page): the brief, the tiles, the target, the chart — and one notebook of four pages", at(`name="utak_today"`) > 0 && at(`name="utak_today"`) < at(`name="utak_day_brief"`) && at(`name="utak_day_brief"`) < at(`name="${BRIEF_FIELD}"`) && at(`name="${BRIEF_FIELD}"`) < at(`name="utak_day_tiles"`) && at(`name="utak_day_tiles"`) < at(`name="x_target_html"`) && at(`name="x_target_html"`) < at(`name="x_chart_html"`)
    && arch.split("<notebook").length === 2 && (arch.match(/<page /g) ?? []).length === 4 && new RegExp(`<field name="${BRIEF_FIELD}"[^>]*readonly="1"`).test(arch), "");
  await pause();

  const search = await viewOf(VIEW_HISTORY_SEARCH), action = await actionRow();
  check(`the search view ${VIEW_HISTORY_SEARCH} #${search?.id}: on the lines, active, as written, never the model's default (priority ${HISTORY_SEARCH_PRIORITY})`, search?.active && search.model === LINE_MODEL && search.type === "search" && search.arch_db === HISTORY_SEARCH_ARCH && search.priority === HISTORY_SEARCH_PRIORITY, JSON.stringify(search?.arch_db));
  check(`its filters: ${HISTORY_FILTERS.map((x) => `«${x[1]}»`).join("، ")} — a group each (a separator between any two)`, HISTORY_FILTERS.every(([name]) => search?.arch_db.includes(`<filter name="${name}"`)) && (search?.arch_db.match(/<separator\/>/g) ?? []).length === HISTORY_FILTERS.length, "");
  check(`the action «${HISTORY_ACTION}» #${action?.id} opens with it, on ${HISTORY_DEFAULTS.map((d) => `«${HISTORY_FILTERS.find((x) => x[0] === d)[1]}»`).join(" + ")}, the real lines alone, as a chart first`, m2oId(action?.search_view_id) === search?.id && action.context === HISTORY_CONTEXT && action.domain.includes("x_utak_simulation") && action.view_mode.startsWith("graph"), JSON.stringify(action));
  await pause();
  const graph = await viewOf(VIEW_HISTORY_GRAPH);
  check(`the chart #${graph?.id} opens as a LINE, not stacked — never a pie`, /<graph[^>]*type="line"/.test(graph?.arch_db ?? "") && /<graph[^>]*stacked="0"/.test(graph.arch_db) && !/type="pie"/.test(graph.arch_db), graph?.arch_db);
  const lf = await call(LINE_MODEL, "fields_get", { attributes: ["type", "aggregator", "store"] });
  const measures = ["x_market_price", "x_sale_price", "x_cost_price", "x_real_profit", "x_contribution"];
  const imf = await call("ir.model.fields", "fields_get", { attributes: ["type"] });
  check(`Odoo's aggregate of a custom number is «${[...new Set(measures.map((m) => lf[m]?.aggregator))].join("/")}» and ir.model.fields carries no column to change it (${Object.keys(imf).filter((k) => /aggreg|group_operator/.test(k)).join(", ") || "none"}): a price is never averaged by Odoo — so each opening keeps a point ONE line`, measures.every((m) => lf[m]?.type === "float" && lf[m].store), JSON.stringify(measures.map((m) => lf[m])));
  await pause();
  // the opening, read as Odoo reads it: the real lines with a market price of the last 14 days — every point (a day × an item) is ONE line
  const from = new Date(Date.now() + 3 * 3600_000 - (HISTORY_DAYS - 1) * 86400_000).toISOString().slice(0, 10);
  const open = await call(LINE_MODEL, "search_read", { domain: [["x_utak_simulation", "=", false], ["x_day_id.x_utak_simulation", "=", false], ["x_market_price", ">", 0], ["x_day_date", ">=", from]], fields: ["x_day_date", "x_product_tmpl_id", "x_market_price"], limit: 5000 });
  const cells = new Map();
  for (const l of open) cells.set(`${l.x_day_date}:${m2oId(l.x_product_tmpl_id)}`, (cells.get(`${l.x_day_date}:${m2oId(l.x_product_tmpl_id)}`) ?? 0) + 1);
  check(`the opening draws ${open.length} point(s) on ${new Set(open.map((l) => l.x_day_date)).size} day(s) and ${new Set(open.map((l) => m2oId(l.x_product_tmpl_id))).size} item(s) — every one carries a market price, and each is ONE line (its sum is its value)`, open.length > 0 && open.every((l) => l.x_market_price > 0) && [...cells.values()].every((n) => n === 1), JSON.stringify([...cells].filter(([, n]) => n > 1)));
  await pause();

  const items = await activeItems(), filters = action ? await filtersOf(action.id) : [];
  const want = items.map((p) => itemFilterVals(p.id, p.name, action?.id));
  check(`a saved filter for each of the ${items.length} items active for sale (${items.map((p) => plainName(p.name)).join("، ")}), shared, as the worker would make it`,
    want.every((w) => filters.some((x) => x.active && x.name === w.name && x.domain === w.domain && x.context === w.context && (x.user_ids ?? []).length === 0 && x.is_default === false)), JSON.stringify(filters.map((x) => [x.name, x.active, x.domain])));
  check("…and none is the action's default (the opening stays «فيه سعر سوق» + «آخر 14 يوماً»)", filters.every((x) => x.is_default === false), "");
  await pause();

  // ---- what is kept for a later analysis (read-only)
  const count = (model, domain) => call(model, "search_count", { domain });
  const REAL = ["x_utak_simulation", "!=", true];
  const offers = await count("x_price_offer", [REAL, ["x_market_price", ">", 0]]);
  const sourced = await count("x_price_offer", [REAL, ["x_market_price", ">", 0], ["x_source_partner_id", "!=", false], ["x_date", "!=", false]]);
  const [firstOffer] = await call("x_price_offer", "search_read", { domain: [REAL, ["x_market_price", ">", 0]], fields: ["x_date"], order: "x_date asc, id asc", limit: 1 });
  check(`kept: every market observation by itself, with its source and its day (${sourced}/${offers} rows of x_price_offer, the first on ${firstOffer?.x_date ?? "—"}) — not the day's one number alone`, offers > 0 && sourced === offers, "");
  await pause();
  const supplierRows = await count("x_daily_price", [REAL, ["x_price_sar", ">", 0]]);
  const linesCost = await count(LINE_MODEL, [REAL, ["x_day_id.x_utak_simulation", "!=", true], ["x_cost_price", ">", 0]]);
  const linesSale = await count(LINE_MODEL, [REAL, ["x_day_id.x_utak_simulation", "!=", true], ["x_sale_price", ">", 0]]);
  check(`kept: the purchase price by supplier and day (${supplierRows} rows of x_daily_price), and by item and day on the day's line (${linesCost} lines with a purchase price, ${linesSale} with a published price)`, supplierRows > 0 && linesCost > 0, "");
  await pause();
  const ol = await call("x_daily_order_line", "fields_get", { attributes: ["type"] }), oo = await call("x_daily_order", "fields_get", { attributes: ["type"] });
  const realDelivered = await count("x_daily_order", [REAL, ["x_state", "in", ["delivered", "closed"]]]);
  check(`kept: the quantity sold by item and day — each order line's quantity (x_quantity, x_ordered_qty, x_return_qty and its reason) with its order's delivery time; ${realDelivered} real order(s) delivered so far (no sum by item and day is stored: it is read from the lines)`, ["x_quantity", "x_ordered_qty", "x_return_qty", "x_return_reason", "x_unit_price"].every((k) => ol[k]) && !!oo.x_delivered_at && !!oo.x_price_date, "");
  await pause();
  const asks = await count("x_unavailable_request", [REAL]);
  check(`kept: the asks for what was not available (x_unavailable_request, § 60 ج: ${asks} real row(s) so far)`, asks >= 0, "");
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: ${DAY_MODEL}.${BRIEF_FIELD}`);
await ensureFields(ctx, DAY_MODEL, await modelId(DAY_MODEL), BRIEF_FIELDS);
await pause();

log(`— 2: «📊 اليوم» (${VIEW_DAY}): «خلاصة اليوم» first in «📍 اليوم»`);
const day = await viewOf(VIEW_DAY);
if (!day) throw new Error(`view ${VIEW_DAY} not found — stop`);
const wantDay = dayArch60(day.arch_db);
if (wantDay === day.arch_db) log(`= view ${VIEW_DAY} #${day.id}`);
else {
  log(`✎ view ${VIEW_DAY} #${day.id}: ${day.arch_db.length} → ${wantDay.length} characters (the field ${BRIEF_FIELD} before the tiles; nothing else)`);
  if (APPLY) {
    rb.before.views[VIEW_DAY] ??= { id: day.id, arch: day.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [day.id], vals: { arch_base: wantDay } });
  }
}
await pause();

log(`— 3: «📈 تاريخ الأسعار»: its search view, and what the action opens on`);
for (const l of HISTORY_SEARCH_ARCH.split("\n")) log(`    ${l}`);
const searchId = await ensureView(ctx, "historySearch", VIEW_HISTORY_SEARCH, { model: LINE_MODEL, type: "search", priority: HISTORY_SEARCH_PRIORITY, arch_base: HISTORY_SEARCH_ARCH });
await pause();
const action = await actionRow();
if (!action) throw new Error(`the action «${HISTORY_ACTION}» was not found — stop (scripts/s58-20261005-day.mjs makes it)`);
if (m2oId(action.search_view_id) === searchId && action.context === HISTORY_CONTEXT) log(`= action #${action.id}: opens with the search view #${searchId} on ${HISTORY_DEFAULTS.join(" + ")}`);
else {
  log(`✎ action #${action.id} «${HISTORY_ACTION}»: search_view_id ${m2oId(action.search_view_id) || "none"} → ${searchId ?? "(the new view)"}; context ${action.context} → ${HISTORY_CONTEXT}`);
  if (APPLY) {
    rb.before.action ??= { id: action.id, search_view_id: m2oId(action.search_view_id), context: action.context }; save();
    await call("ir.actions.act_window", "write", { ids: [action.id], vals: { search_view_id: searchId, context: HISTORY_CONTEXT } });
  }
}
await pause();

log(`— 4: a saved filter for each item active for sale`);
const have = await filtersOf(action.id);
for (const p of await activeItems()) {
  const vals = itemFilterVals(p.id, p.name, action.id);
  const cur = have.find((x) => x.name === vals.name);
  if (cur?.active) { log(`= filter «${vals.name}» #${cur.id}`); rb.created.filters[p.id] ??= cur.id; continue; }
  if (cur) {
    log(`✎ filter «${vals.name}» #${cur.id}: on again`);
    if (APPLY) await call("ir.filters", "write", { ids: [cur.id], vals: { active: true } });
    continue;
  }
  log(`+ filter «${vals.name}»: ${vals.domain}`);
  if (APPLY) {
    const [id] = await call("ir.filters", "create", { vals_list: [vals] });
    rb.created.filters[p.id] = id; save();
    log(`  → #${id}`);
    await pause(500);
  }
}
save();
log(APPLY ? "done — verify: node scripts/s60-20261006-day.mjs --verify" : "dry-run: nothing written");
