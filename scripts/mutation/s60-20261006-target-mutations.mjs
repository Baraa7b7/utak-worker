// Mutation check for § 60 (2026-10-06), 2 of 3 — the day's target against its actual (ب: src/day-insight.ts,
// src/day-screen.ts, src/operating-cost.ts), and «📈 تاريخ الأسعار» with a saved filter an item (تاريخ:
// src/history-filters.ts, src/prices.ts, scripts/lib/s60-ui.mjs, scripts/lib/s58-ui.mjs).
// Each mutation disables ONE guard, runs the test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s60-20261006-target-mutations.mjs [ب تاريخ]     (no argument: every part)
//
// Out: scripts/artifacts/s60-20261006-target-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ب
  ["ب", "«هدف الربح اليومي» is not read", [["src/operating-cost.ts",
    "profitTarget: typeof r.x_daily_profit_target === \"number\" && r.x_daily_profit_target > 0 ? r.x_daily_profit_target : 0,", "profitTarget: 0,"]], "tests/s60-target.test.mts"],
  ["ب", "a negative profit target is read as it is", [["src/operating-cost.ts",
    "typeof r.x_daily_profit_target === \"number\" && r.x_daily_profit_target > 0 ?", "typeof r.x_daily_profit_target === \"number\" ?"]], "tests/s60-target.test.mts"],
  ["ب", "the profit target does not join the cost in T", [["src/day-insight.ts",
    "target: why ? 0 : r6(((cost as number) + P) / contribution), why };", "target: why ? 0 : r6((cost as number) / contribution), why };"]], "tests/s60-target.test.mts"],
  ["ب", "a contribution of exactly nothing still gives a target", [["src/day-insight.ts",
    "cost === null ? \"no_cost\" : contribution > 0 ? \"\" : \"no_contribution\";", "cost === null ? \"no_cost\" : contribution >= 0 ? \"\" : \"no_contribution\";"]], "tests/s60-target.test.mts"],
  ["ب", "real sales never weigh the mean", [["src/day-insight.ts",
    "const basis: PlanBasis = sold > 0 ? \"weighted\" : \"simple\";", "const basis: PlanBasis = \"simple\";"]], "tests/s60-target.test.mts"],
  ["ب", "the plan's contribution keeps the waste in", [["src/day-insight.ts",
    "contribution = round2(margin - waste);", "contribution = round2(margin);"]], "tests/s60-target.test.mts"],
  ["ب", "a target is rounded to the nearest carton, not up", [["src/day-insight.ts",
    "(t > 0 ? Math.ceil(r6(t)) : 0);", "(t > 0 ? Math.round(r6(t)) : 0);"]], "tests/s60-target.test.mts"],
  ["ب", "a day with nothing to publish is not said to be one", [["src/day-insight.ts",
    "const why: NoTarget = !items.length ? \"no_items\" : cost === null", "const why: NoTarget = cost === null"]], "tests/s60-target.test.mts"],
  ["ب", "a cost «تعذّر» still gives a target", [["src/day-insight.ts",
    "!items.length ? \"no_items\" : cost === null ? \"no_cost\" : contribution > 0", "!items.length ? \"no_items\" : contribution > 0"]], "tests/s60-target.test.mts"],
  ["ب", "the day keeps «simple» whatever the basis", [["src/day-insight.ts",
    "x_plan_basis: p.basis,", "x_plan_basis: \"simple\","]], "tests/s60-target.test.mts"],
  ["ب", "«لتغطية التشغيل» is said of a day with nothing to publish", [["src/day-insight.ts",
    "export function coverText(p: Pick<DayPlan, \"cost\" | \"contribution\" | \"items\">): string {\n  if (!p.items || p.cost === null) return \"\";", "export function coverText(p: Pick<DayPlan, \"cost\" | \"contribution\" | \"items\">): string {\n  if (p.cost === null) return \"\";"]], "tests/s60-target.test.mts"],
  ["ب", "the volume's part is made with the margin, not the contribution", [["src/day-insight.ts",
    "    a.cartons * plan.contribution - (plan.cost + plan.profitTarget),", "    a.cartons * plan.margin - (plan.cost + plan.profitTarget),"]], "tests/s60-target.test.mts"],
  ["ب", "the volume's part forgets the profit target", [["src/day-insight.ts",
    "    a.cartons * plan.contribution - (plan.cost + plan.profitTarget),", "    a.cartons * plan.contribution - plan.cost,"]], "tests/s60-target.test.mts"],
  ["ب", "the margin's part has the wrong sign", [["src/day-insight.ts",
    "    a.marginTotal - a.cartons * plan.margin,", "    a.cartons * plan.margin - a.marginTotal,"]], "tests/s60-target.test.mts"],
  ["ب", "the waste's part has the wrong sign", [["src/day-insight.ts",
    "    -(a.waste - a.cartons * plan.waste),", "    (a.waste - a.cartons * plan.waste),"]], "tests/s60-target.test.mts"],
  ["ب", "the costs' part is dropped", [["src/day-insight.ts",
    "    -(a.cost - plan.cost),\n", "    0,\n"]], "tests/s60-target.test.mts"],
  ["ب", "nothing recorded as waste counts as no waste", [["src/day-insight.ts",
    "const waste = wasteReal ? (input.wasteRecorded as number) : Q * plan.waste;", "const waste = wasteReal ? (input.wasteRecorded as number) : 0;"]], "tests/s60-target.test.mts"],
  ["ب", "the plan's waste is said to be a recorded one", [["src/day-insight.ts",
    "const wasteReal = input.wasteRecorded !== null;", "const wasteReal = true;"]], "tests/s60-target.test.mts"],
  ["ب", "what rounding leaves over is dropped (the four no longer add up)", [["src/day-insight.ts",
    "  if (left !== 0 && out.length) {", "  if (false) {"]], "tests/s60-target.test.mts"],
  ["ب", "what rounding leaves over goes to the smallest part", [["src/day-insight.ts",
    "if (Math.abs(p) > Math.abs(out[k])) k = i;", "if (Math.abs(p) < Math.abs(out[k])) k = i;"]], "tests/s60-target.test.mts"],
  ["ب", "the real profit forgets the day's cost", [["src/day-insight.ts",
    "const profit = round2(marginTotal - waste - costActual), gap", "const profit = round2(marginTotal - waste), gap"]], "tests/s60-target.test.mts"],
  ["ب", "the gap forgets the profit target", [["src/day-insight.ts",
    "gap = round2(marginTotal - waste - costActual - plan.profitTarget);", "gap = round2(marginTotal - waste - costActual);"]], "tests/s60-target.test.mts"],
  ["ب", "a part of nothing is named in the gap's line", [["src/day-insight.ts",
    "(v ? `${VARIANCE_NAMES[i]} ${signedInt(v)}` : \"\")", "(`${VARIANCE_NAMES[i]} ${signedInt(v)}`)"]], "tests/s60-target.test.mts"],
  ["ب", "a deficit is called a surplus", [["src/day-insight.ts",
    "total < 0 ? `عجز ${Math.abs(total)}` : total > 0 ? `فائض ${total}`", "total < 0 ? `فائض ${Math.abs(total)}` : total > 0 ? `عجز ${total}`"]], "tests/s60-target.test.mts"],
  ["ب", "the waste's part is named the margin's", [["src/day-insight.ts",
    "[\"الكمية\", \"الهامش\", \"التالف\", \"التكاليف\"]", "[\"الكمية\", \"التالف\", \"الهامش\", \"التكاليف\"]"]], "tests/s60-target.test.mts"],
  ["ب", "a day under its target gets ✅", [["src/day-insight.ts",
    "الحقيقي ${signedInt(a.profit)} ${a.gap >= 0 ? \"✅\" : \"❌\"}`", "الحقيقي ${signedInt(a.profit)} ${\"✅\"}`"]], "tests/s60-target.test.mts"],
  ["ب", "a day with no real delivery gets numbers", [["src/day-insight.ts",
    "  if (!(a.cartons > 0)) return [`${when}: ${NO_SALES_TEXT}`];\n", ""]], "tests/s60-target.test.mts"],
  ["ب", "the 🎯 line names the first part, not the largest", [["src/day-insight.ts",
    "(Math.abs(v) > Math.abs(whole[best]) ? i : best)", "(best)"]], "tests/s60-target.test.mts"],
  ["ب", "the 🎯 line of a day under its target gets ✅", [["src/day-insight.ts",
    "ربح ${signedInt(a.profit)} ${a.gap >= 0 ? \"✅\" : \"❌\"}${whole[k]", "ربح ${signedInt(a.profit)} ${\"✅\"}${whole[k]"]], "tests/s60-target.test.mts"],
  ["ب", "a simulation's order is counted as sold", [["src/day-insight.ts",
    "[\"x_delivered_at\", \"<\", toOdooUtc(riyadhDayMinuteMs(to, 0) + DAY_MS)], [SIM_FIELD, \"!=\", true]],", "[\"x_delivered_at\", \"<\", toOdooUtc(riyadhDayMinuteMs(to, 0) + DAY_MS)]],"]], "tests/s60-target.test.mts"],
  ["ب", "the day ends at 03:00 Riyadh (a UTC day)", [["src/day-insight.ts",
    "toOdooUtc(riyadhDayMinuteMs(to, 0) + DAY_MS)], [SIM_FIELD", "toOdooUtc(riyadhDayMinuteMs(to, 0) + DAY_MS + 3 * 3600_000)], [SIM_FIELD"]], "tests/s60-target.test.mts"],
  ["ب", "a line that left the order counts as delivered", [["src/day-insight.ts",
    "const delivered = String(l.x_status) === \"unavailable\" ? 0 : Number(l.x_quantity) || 0;", "const delivered = Number(l.x_quantity) || 0;"]], "tests/s60-target.test.mts"],
  ["ب", "a short carton counts as waste", [["src/day-insight.ts",
    "new Set([\"damaged\", \"refused\"])", "new Set([\"damaged\", \"refused\", \"short\"])"]], "tests/s60-target.test.mts"],
  ["ب", "what the customer refused is no waste", [["src/day-insight.ts",
    "new Set([\"damaged\", \"refused\"])", "new Set([\"damaged\"])"]], "tests/s60-target.test.mts"],
  ["ب", "the waste is counted at the sale price", [["src/day-insight.ts",
    "lost.reduce((a, l) => a + l.returned * l.purchase, 0)", "lost.reduce((a, l) => a + l.returned * l.sale, 0)"]], "tests/s60-target.test.mts"],
  ["ب", "a line takes the purchase price of the day it was delivered", [["src/day-insight.ts",
    "const purchase = cost.get(`${o.priceDay}:${key}`) ?? 0;", "const purchase = cost.get(`${o.delivered}:${key}`) ?? 0;"]], "tests/s60-target.test.mts"],
  ["ب", "a delivered line without a sale price is summed as nothing", [["src/day-insight.ts",
    "    if (delivered > 0 && !(sale > 0)) throw new Error(\"a delivered line without a sale price\");\n", ""]], "tests/s60-target.test.mts"],
  ["ب", "a delivered line without its purchase price is summed as nothing", [["src/day-insight.ts",
    "    if (!(purchase > 0)) throw new Error(\"a delivered line without its day's purchase price\");\n", ""]], "tests/s60-target.test.mts"],
  ["ب", "Baraa's own price on a line is ignored", [["src/day-insight.ts",
    "const sale = Number(l.x_price_unit_manual) > 0 ? Number(l.x_price_unit_manual) : Number(l.x_unit_price) || 0;", "const sale = Number(l.x_unit_price) || 0;"]], "tests/s60-target.test.mts"],
  ["ب", "an invoice's discount stays in the margin", [["src/day-insight.ts",
    "(l.sale / d - l.purchase), 0) - discount / d;", "(l.sale / d - l.purchase), 0);"]], "tests/s60-target.test.mts"],
  ["ب", "a simulation's invoice gives a discount", [["src/day-insight.ts",
    "domain: [[\"x_order_id\", \"in\", [...byId.keys()]], [SIM_FIELD, \"!=\", true]], fields: [\"x_order_id\", \"x_total\"]", "domain: [[\"x_order_id\", \"in\", [...byId.keys()]]], fields: [\"x_order_id\", \"x_total\"]"]], "tests/s60-target.test.mts"],
  ["ب", "reading the actual alone writes it", [["src/day-insight.ts",
    "if (rec && !opts.dry) await call(env, DAY_MODEL, \"write\"", "if (rec) await call(env, DAY_MODEL, \"write\""]], "tests/s60-target.test.mts"],
  ["ب", "the actual is never kept", [["src/day-insight.ts",
    "if (rec && !opts.dry) await call(env, DAY_MODEL, \"write\"", "if (rec && opts.dry) await call(env, DAY_MODEL, \"write\""]], "tests/s60-target.test.mts"],
  ["ب", "a day without a kept cost counts a cost of 0", [["src/day-insight.ts",
    "  if (!(plan.cost > 0)) {\n    const c = (await dailyOperatingCost", "  if (false) {\n    const c = (await dailyOperatingCost"]], "tests/s60-target.test.mts"],
  ["ب", "the kept record says the waste was recorded", [["src/day-insight.ts",
    "x_act_waste_real: a.wasteReal,", "x_act_waste_real: true,"]], "tests/s60-target.test.mts"],
  ["ب", "the plan counts the rows that do not go out", [["src/day-screen.ts",
    "  return rows.filter((r) => r.publish && r.price > 0 && r.purchase > 0).map((r) => ({\n    key: r.key, margin:", "  return rows.map((r) => ({\n    key: r.key, margin:"]], "tests/s60-target.test.mts"],
  ["ب", "the plan's margin is at the market price, not the row's own", [["src/day-screen.ts",
    "key: r.key, margin: round2(round2(r.price / (r.vatPct ?", "key: r.key, margin: round2(round2(r.sale / (r.vatPct ?"]], "tests/s60-target.test.mts"],
  ["ب", "sales older than seven days weigh the plan", [["src/day-screen.ts",
    "if (s.day >= from && s.day < inputs.day && s.quantity > 0)", "if (s.day < inputs.day && s.quantity > 0)"]], "tests/s60-target.test.mts"],
  ["ب", "the day's own sales weigh its plan", [["src/day-screen.ts",
    "if (s.day >= from && s.day < inputs.day && s.quantity > 0)", "if (s.day >= from && s.quantity > 0)"]], "tests/s60-target.test.mts"],
  ["ب", "how the target is made is not written", [["src/day-insight.ts",
    "    + (formula ? `<div class=\"small text-muted\">${ltrNumbers(formula)}</div>` : \"\")\n", ""]], "tests/s60-target.test.mts"],
  ["ب", "the day's own line never joins «🎯 الهدف مقابل الفعلي»", [["src/day-insight.ts",
    "    + (own ? actualHtml(own, \"اليوم\") : \"\")\n", ""]], "tests/s60-target.test.mts"],
  ["ب", "«21:30» is cut in two inside the line", [["src/day-insight.ts",
    "esc(s).replace(/[+−]?\\d+(?:[.,:–]\\d+)*%?/g,", "esc(s).replace(/[+−]?\\d+(?:[.,]\\d+)*%?/g,"]], "tests/s60-target.test.mts"],
  ["ب", "the plan is not kept on the day", [["src/day-screen.ts",
    "    ...header, ...planVals(plan),\n", "    ...header,\n"]], "tests/s60-target.test.mts"],
  ["ب", "the settings' profit target never reaches the plan", [["src/day-screen.ts",
    "profitTarget: settings.profitTarget, own };", "profitTarget: 0, own };"]], "tests/s60-target.test.mts"],
  ["ب", "the day's cost never reaches the plan", [["src/day-screen.ts",
    "return { inputs, cost: share.cost, cartons:", "return { inputs, cost: null, cartons:"]], "tests/s60-target.test.mts"],
  ["ب", "«أمس» is the day before yesterday", [["src/day-screen.ts",
    "new Date(Date.parse(`${day}T12:00:00Z`) - 24 * 3600_000).toISOString().slice(0, 10);\n/** Each item", "new Date(Date.parse(`${day}T12:00:00Z`) - 48 * 3600_000).toISOString().slice(0, 10);\n/** Each item"]], "tests/s60-target.test.mts"],
  // ---------------------------------------------------------------- تاريخ
  ["تاريخ", "a saved filter keeps the item's reference in its name", [["src/history-filters.ts",
    "    name: plainName(name), model_id: LINE_MODEL,", "    name: name, model_id: LINE_MODEL,"]], "tests/s60-history.test.mts"],
  ["تاريخ", "a saved filter is the action's default", [["src/history-filters.ts",
    "user_ids: [[6, 0, []]], is_default: false, sort: \"[]\",", "user_ids: [[6, 0, []]], is_default: true, sort: \"[]\","]], "tests/s60-history.test.mts"],
  ["تاريخ", "a saved filter draws the days without a market price", [["src/history-filters.ts",
    "domain: `[(\"x_product_tmpl_id\", \"=\", ${productId}), (\"x_market_price\", \">\", 0)]`,", "domain: `[(\"x_product_tmpl_id\", \"=\", ${productId})]`,"]], "tests/s60-history.test.mts"],
  ["تاريخ", "a saved filter opens stacked", [["src/history-filters.ts",
    "\"graph_stacked\": False}`,", "\"graph_stacked\": True}`,"]], "tests/s60-history.test.mts"],
  ["تاريخ", "a saved filter opens as bars", [["src/history-filters.ts",
    "\"graph_mode\": \"line\", \"graph_groupbys\"", "\"graph_mode\": \"bar\", \"graph_groupbys\""]], "tests/s60-history.test.mts"],
  ["تاريخ", "Odoo is asked for the filters with every run", [["src/history-filters.ts",
    "    if ([...products.keys()].every((id) => known.includes(id))) return 0;\n", ""]], "tests/s60-history.test.mts"],
  ["تاريخ", "an item whose filter exists gets another", [["src/history-filters.ts",
    ".filter((v) => !names.has(String(v.name)))", ""]], "tests/s60-history.test.mts"],
  ["تاريخ", "two products of one name get two filters", [["src/history-filters.ts",
    "      .filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i);", ";"]], "tests/s60-history.test.mts"],
  ["تاريخ", "filters that cannot be made stop the engine", [["src/history-filters.ts",
    "    console.warn(\"[history-filters] the items' saved filters could not be made\", (e as Error)?.message);\n    return 0;", "    throw e;"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the engine never adds a new item's filter", [["src/prices.ts",
    "  await (await import(\"./history-filters\")).ensureItemFilters(env, items);\n", ""]], "tests/s60-history.test.mts"],
  ["تاريخ", "«📈 تاريخ الأسعار» opens on the last 14 days alone (empty days drawn)", [["scripts/lib/s60-ui.mjs",
    "export const HISTORY_DEFAULTS = [\"f_market\", \"f_14\"];", "export const HISTORY_DEFAULTS = [\"f_14\"];"]], "tests/s60-history.test.mts"],
  ["تاريخ", "«📈 تاريخ الأسعار» opens on the last 7 days", [["scripts/lib/s60-ui.mjs",
    "export const HISTORY_DAYS = 14;", "export const HISTORY_DAYS = 7;"]], "tests/s60-history.test.mts"],
  ["تاريخ", "«فيه سعر سوق» lets a price of 0 through", [["scripts/lib/s60-ui.mjs",
    "[\"f_market\", \"فيه سعر سوق\", \"[('x_market_price', '>', 0)]\"],", "[\"f_market\", \"فيه سعر سوق\", \"[('x_market_price', '>=', 0)]\"],"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the filters share one group (two chosen ones widen)", [["scripts/lib/s60-ui.mjs",
    ".join(\"\\n  <separator/>\\n\")}\n  <separator/>\n  <filter name=\"g_day\"", ".join(\"\\n\")}\n  <separator/>\n  <filter name=\"g_day\""]], "tests/s60-history.test.mts"],
  ["تاريخ", "the history's search view becomes the model's default", [["scripts/lib/s60-ui.mjs",
    "export const HISTORY_SEARCH_PRIORITY = 95;", "export const HISTORY_SEARCH_PRIORITY = 16;"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the brief's field is a direct child of the page (Odoo pads it)", [["scripts/lib/s60-ui.mjs",
    "export const BRIEF_TAG = `<div name=\"utak_day_brief\" class=\"mb-2\"><field name=\"${BRIEF_FIELD}\" readonly=\"1\" nolabel=\"1\"/></div>\\n    `;", "export const BRIEF_TAG = `<field name=\"${BRIEF_FIELD}\" readonly=\"1\" nolabel=\"1\" class=\"mb-2\"/>\\n    `;"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the brief is put after the tiles", [["scripts/lib/s60-ui.mjs",
    "return arch.replace(`${NOTEBOOK_OPEN}${TILES_FROM}`, `${NOTEBOOK_OPEN}${BRIEF_TAG}${TILES_FROM}`);", "return arch.replace(`${NOTEBOOK_OPEN}${TILES_FROM}`, `${NOTEBOOK_OPEN}${TILES_FROM}${BRIEF_TAG}`);"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the brief's field does not sanitize its tags", [["scripts/lib/s60-ui.mjs",
    "const HTML_FLAGS = { sanitize: true, sanitize_overridable: false, sanitize_tags: true,", "const HTML_FLAGS = { sanitize: true, sanitize_overridable: false, sanitize_tags: false,"]], "tests/s60-history.test.mts"],
  ["تاريخ", "the older verifies do not take § 60's field off the form", [["scripts/lib/s58-ui.mjs",
    "  arch = arch.replace(BRIEF_TAG_60, \"\");\n", ""]], "tests/s60-history.test.mts"],
  ["تاريخ", "a form that is not § 58's is changed all the same", [["scripts/lib/s60-ui.mjs",
    "  if (!once(arch, `${NOTEBOOK_OPEN}${TILES_FROM}`)) throw new Error(", "  if (false) throw new Error("]], "tests/s60-history.test.mts"],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s60-20261006-target-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
