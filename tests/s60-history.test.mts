// § 60 (2026-10-06, Baraa's amendment) — «خلاصة اليوم» in the day's form, and «📈 تاريخ الأسعار» as a
// tool for analysis (scripts/lib/s60-ui.mjs, src/history-filters.ts).
//
//   [1] the day's form: «خلاصة اليوم» first in «📍 اليوم», before the tiles, in a div of its own — and the
//       form of § 58, and of § 57 under it, byte for byte once it is taken off
//   [2] «📈 تاريخ الأسعار»: «فيه سعر سوق», «فيه سعر شراء», «منشور» and «آخر 14 يوماً», a group each; it
//       opens on the first and the last; never the model's default search view
//   [3] a saved filter an item: the same row from the Odoo script and from the worker
//   [4] the worker adds a NEW item's filter with the day's computation — once, never one Baraa switched
//       off, and it never stops the engine
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-history.test.mts

import { readFileSync } from "node:fs";
import { odooLog, quiet, rows, seed, table } from "./wa-harness.mts";
import { DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const HF = await import("../src/history-filters.ts");
// @ts-ignore — plain .mjs helpers
const UI = await import("../scripts/lib/s60-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI58 = await import("../scripts/lib/s58-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI57 = await import("../scripts/lib/s57-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI56 = await import("../scripts/lib/s56-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI48 = await import("../scripts/lib/s48-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI49 = await import("../scripts/lib/s49-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI54 = await import("../scripts/lib/s54-odoo.mjs");

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SCHEMA = JSON.parse(read("tests/fixtures-odoo-fields-20261006-s60.json"));
const A = { refresh: 1004, confirm: 1038, unapprove: 1003, approve: 1002, prev: 1033, next: 1034, openDay: 1032, openSources: 1037, days: 1009, products: 1041, settings: 1027, purchaseList: 1039, marketList: 1040, packagings: 1042, profitGraph: 1043 };
const HISTORY = 1046;
const note = UI54.NOTES.find((n: string[]) => n[0] === UI56.VIEW_DAY);
const s57 = String(UI57.dayArch57(String(UI56.dayArch(String(UI54.noteArch(String(UI49.dayArch(UI48.dayForm(A))), note[1], note[2]))))));
const s58 = String(UI58.dayArch58(s57, HISTORY));
const s60 = String(UI.dayArch60(s58));

// ================================================================ [1] the day's form
console.log("\n[1] «خلاصة اليوم» first in «📍 اليوم», before the tiles — and nothing else of the form");
{
  assert("the form gains ONE field, x_brief_html, read-only, in a div of its own", s60.length === s58.length + UI.BRIEF_TAG.length && s60.split(`name="${UI.BRIEF_FIELD}"`).length === 2 && UI.BRIEF_FIELD === "x_brief_html"
    && UI.BRIEF_TAG === `<div name="utak_day_brief" class="mb-2"><field name="x_brief_html" readonly="1" nolabel="1"/></div>\n    `);
  const at = (x: string) => s60.indexOf(x);
  assert("it is the FIRST thing of «📍 اليوم»: the page, the brief, the tiles, the target, the note, the chart", at(`name="utak_today"`) > 0 && at(`name="utak_today"`) < at(`name="utak_day_brief"`) && at(`name="utak_day_brief"`) < at(`name="utak_day_tiles"`) && at(`name="utak_day_tiles"`) < at(`name="x_target_html"`) && at(`name="x_target_html"`) < at(`name="x_chart_html"`)
    && s60.includes(`${UI58.NOTEBOOK_OPEN}${UI.BRIEF_TAG}<div class="row g-2 mb-2" name="utak_day_tiles">`));
  assert("the field is not a direct child of the page (Odoo pads the first html field of a notebook page 16px / 32px, which would set the box in from the tiles)", !s60.includes(`${UI58.NOTEBOOK_OPEN}<field`) && s60.includes(`${UI58.NOTEBOOK_OPEN}<div name="utak_day_brief"`));
  assert("without it the form is § 58's byte for byte, and § 57's under that — the older verifies read the screen as before", UI.dayArch58Of(s60) === s58 && UI58.dayArch57Of(s60) === s57 && UI58.dayArch57Of(s58) === s57);
  assert("the tag is spelled the same where the older verifies take it off (scripts/lib/s58-ui.mjs)", UI58.BRIEF_TAG_60 === UI.BRIEF_TAG);
  assert("applied twice it changes nothing; the bare field of the first apply is replaced by the div, never doubled", UI.dayArch60(s60) === s60 && UI.dayArch60(s58.replace(`${UI58.NOTEBOOK_OPEN}`, `${UI58.NOTEBOOK_OPEN}<field name="x_brief_html" readonly="1" nolabel="1" class="mb-2"/>\n    `)) === s60);
  let stopped = "";
  try { UI.dayArch60(s57); } catch (e) { stopped = (e as Error).message; }
  assert("a form that is not § 58's (no notebook opening on the tiles) stops the script", stopped.includes("not § 58's"), stopped);
  assert("one notebook, four pages, the three tabs and their fields as § 58 wrote them", s60.split("<notebook").length === 2 && (s60.match(/<page /g) ?? []).length === 4 && UI58.TABS.every((t: any) => s60.split(`<field name="${t.field}"`).length === 2));
  assert("the field is an HTML field that keeps Odoo's sanitizer, as § 56's chart and § 58's four", UI.BRIEF_FIELDS.length === 1 && UI.BRIEF_FIELDS[0].ttype === "html" && UI.BRIEF_FIELDS[0].sanitize === true && UI.BRIEF_FIELDS[0].sanitize_tags === true && UI.BRIEF_FIELDS[0].sanitize_attributes === true && UI.BRIEF_FIELDS[0].sanitize_style === false
    && UI.BRIEF_FIELDS[0].sanitize_overridable === false && SCHEMA.x_price_day.includes("x_brief_html"));
  const v58 = read("scripts/s58-20261005-day.mjs"), v48 = read("scripts/s48-20261001-ui.mjs");
  assert("§ 58's verify compares the form with § 60's field taken off, and § 48's expects «🙋 طلبوا وما كان متوفر» after «📈 تاريخ الأسعار»", v58.includes(`day.arch_db.replace(BRIEF_TAG_60, "") === dayArch58(was.arch, action?.id)`) && v48.includes(`import { REQUEST_ACTION, REQUEST_TITLE } from "./lib/s60-odoo.mjs";`));
}

// ================================================================ [2] «📈 تاريخ الأسعار»
console.log("\n[2] «📈 تاريخ الأسعار»: no day and no item without a value, the last 14 days, a line chart");
{
  const arch = String(UI.HISTORY_SEARCH_ARCH);
  const filters = [...arch.matchAll(/<filter name="(\w+)" string="([^"]*)" domain="([^"]*)"\/>/g)].map((m) => [m[1], m[2], m[3].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")]);
  assert("four filters: «فيه سعر سوق» (x_market_price > 0), «فيه سعر شراء», «منشور», «آخر 14 يوماً»", JSON.stringify(filters) === JSON.stringify([
    ["f_market", "فيه سعر سوق", "[('x_market_price', '>', 0)]"],
    ["f_purchase", "فيه سعر شراء", "[('x_cost_price', '>', 0)]"],
    ["f_published", "منشور", "[('x_sale_price', '>', 0), ('x_day_id.x_state', '=', 'published')]"],
    ["f_14", "آخر 14 يوماً", "[('x_day_date', '>=', (context_today() - relativedelta(days=13)).strftime('%Y-%m-%d'))]"],
  ]), JSON.stringify(filters));
  const parts = arch.split("<separator/>");
  assert("each in a group of its own (a separator between any two): two chosen filters narrow, never widen", parts.length === 5 && parts.slice(0, 4).every((p) => (p.match(/<filter /g) ?? []).length === 1));
  assert("it opens on «فيه سعر سوق» and «آخر 14 يوماً»: no day and no item without a market price is drawn", UI.HISTORY_CONTEXT === "{'search_default_f_market': 1, 'search_default_f_14': 1}" && JSON.stringify(UI.HISTORY_DEFAULTS) === JSON.stringify(["f_market", "f_14"]) && UI.HISTORY_DAYS === 14);
  assert("the arch is well formed and every field it names is the tenant's", !/<(?!\/?(search|field|filter|separator)\b)/.test(arch) && ["x_market_price", "x_cost_price", "x_sale_price", "x_day_id", "x_day_date", "x_product_tmpl_id"].every((f) => SCHEMA.x_price_day_line.includes(f)) && SCHEMA.x_price_day.includes("x_state"));
  assert("it is never the model's default search view (its priority is above the board's 90), only this action's", UI.HISTORY_SEARCH_PRIORITY === 95 && UI.VIEW_HISTORY_SEARCH === "utak.price_history_search");
  assert("the chart stays § 58's: a LINE, not stacked, by the day and the item — never a pie", /<graph[^>]*type="line"[^>]*stacked="0"/.test(UI58.HISTORY_GRAPH_ARCH) && !/pie/.test(UI58.HISTORY_GRAPH_ARCH) && UI58.HISTORY_DOMAIN.includes("x_utak_simulation"));
  assert("the action's name is the one the worker looks for", UI.HISTORY_ACTION === HF.HISTORY_ACTION && UI.HISTORY_ACTION === UI58.HISTORY_ACTION);
}

// ================================================================ [3] a saved filter an item
console.log("\n[3] a saved filter an item: the chart on that item alone");
{
  const v = HF.itemFilterVals(97, "[UTAK-FRT-002] موز أمريكي", HISTORY);
  assert("by the item's own name (its reference taken off), on the lines, for this action, shared with every user, never the default", v.name === "موز أمريكي" && v.model_id === "x_price_day_line" && v.action_id === HISTORY && JSON.stringify(v.user_ids) === "[[6,0,[]]]" && v.is_default === false && v.sort === "[]");
  assert("its domain: that item alone, where it carries a market price", v.domain === `[("x_product_tmpl_id", "=", 97), ("x_market_price", ">", 0)]`);
  assert("its context: by the day, a line chart of the market price, not stacked", v.context === `{"group_by": ["x_day_date:day"], "graph_measure": "x_market_price", "graph_mode": "line", "graph_groupbys": ["x_day_date:day"], "graph_stacked": False}`);
  assert("the Odoo script and the worker make the very same row", JSON.stringify(UI.itemFilterVals(97, "[UTAK-FRT-002] موز أمريكي", HISTORY)) === JSON.stringify(v) && JSON.stringify(UI.itemFilterVals(5, "خيار", 7)) === JSON.stringify(HF.itemFilterVals(5, "خيار", 7)) && UI.plainName("[X-1]  طماطم ") === HF.plainName("[X-1]  طماطم "));
  assert("every key is a field of ir.filters on the tenant", Object.keys(v).every((k) => SCHEMA["ir.filters"].includes(k)), Object.keys(v).join());
}

// ================================================================ [4] the worker adds a new item's
console.log("\n[4] a new item gets its filter with the day's computation — once");
function world(): any {
  const env = fresh(`${DAY} 04:00`); cost(496.52); setExtract(null);
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  seed("ir.actions.act_window", { id: HISTORY, name: HF.HISTORY_ACTION, res_model: "x_price_day_line" });
  dp(1, 11, 55); market(1, 11, 70); dp(2, 21, 15); market(2, 21, 20);
  return env;
}
const filters = () => rows(HF.FILTER_MODEL) as any[];
{
  const env = world();
  table("product.template").get(1)!.name = "[UTAK-FRT-002] موز أمريكي";
  // the script already made the banana's
  seed(HF.FILTER_MODEL, { ...HF.itemFilterVals(1, "[UTAK-FRT-002] موز أمريكي", HISTORY), user_ids: [], active: true });
  const r = await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const names = filters().map((f) => f.name);
  assert("the day's computation: the four active items each have one — the three that had none are made, the banana's is left alone", r.action === "refreshed" && names.length === 4 && names.filter((n) => n === "موز أمريكي").length === 1 && [2, 3, 4].every((p) => filters().some((f) => f.domain === `[("x_product_tmpl_id", "=", ${p}), ("x_market_price", ">", 0)]` && f.action_id === HISTORY)), names.join("، "));
  assert("the prices are what they were (the filters never touch the engine)", lineFor(1).x_sale_price === 70 && dayOf().x_n_publish >= 1);
  odooLog.length = 0;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the next run: nothing is made, and Odoo is not even asked (the items are known for a day)", filters().length === 4 && odooLog.every((x) => x.model !== HF.FILTER_MODEL && x.model !== "ir.actions.act_window"));
  // a new item is switched on
  seed("product.template", { id: 9, name: "[UTAK-VEG-009] جزر", sale_ok: true, x_is_active_for_sale: true });
  seed("x_product_packaging", { id: 91, x_name: "كيس", x_product_tmpl_id: 9, x_is_default: true });
  dp(9, 91, 8); market(9, 91, 12);
  odooLog.length = 0;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("a NEW item: its filter is added with that run — «جزر», and the four others are not made again", filters().length === 5 && filters().filter((f) => f.name === "جزر").length === 1 && odooLog.filter((x) => x.model === HF.FILTER_MODEL && x.method === "create").length === 1 && (odooLog.find((x) => x.model === HF.FILTER_MODEL && x.method === "create")!.body.vals_list as any[]).length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  // Baraa switched the cucumber's off: it is his, and never made again
  seed(HF.FILTER_MODEL, { ...HF.itemFilterVals(2, "خيار", HISTORY), user_ids: [], active: false });
  const made = await quiet(() => HF.ensureItemFilters(env, [{ productId: 1, productName: "طماطم" }, { productId: 2, productName: "خيار" }, { productId: 1, productName: "طماطم" }, { productId: 0, productName: "x" }, { productId: 7, productName: "  " }]));
  assert("a filter switched off is found and left alone; an item twice (two packagings) gets one; an item without an id or a name none", made === 1 && filters().length === 2 && filters().filter((f) => f.name === "خيار").length === 1 && filters().find((f) => f.name === "خيار").active === false && filters().some((f) => f.name === "طماطم"), JSON.stringify(filters().map((f) => [f.name, f.active])));
  const two = await quiet(() => HF.ensureItemFilters(fresh(), [{ productId: 1, productName: "طماطم" }]));
  assert("no «📈 تاريخ الأسعار» on the tenant (§ 58's view rolled back): nothing is made", two === 0 && filters().length === 0);
}
{
  const env = world();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes(`/json/2/${HF.FILTER_MODEL}/`)) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no" }), { status: 403 });
    return real(input as any, init);
  }) as typeof fetch;
  let r: any, n = -1;
  try { n = await quiet(() => HF.ensureItemFilters(env, [{ productId: 1, productName: "طماطم" }])); r = await quiet(() => PR.refreshPriceDay(env, { force: true })); } finally { globalThis.fetch = real; }
  assert("Odoo refuses the filters: 0 made, no throw — and the engine prices the day all the same", n === 0 && r.action === "refreshed" && lineFor(1).x_sale_price === 70 && filters().length === 0);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…and the next run tries again (a failure is not remembered)", filters().length === 4);
}

done();
