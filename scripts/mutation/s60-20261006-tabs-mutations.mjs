// Mutation check for § 60 (2026-10-06), 3 of 3 — the three tabs as text and «خلاصة اليوم», and what they
// read (د: src/day-tabs.ts, src/day-insight.ts, src/day-screen.ts).
// Each mutation disables ONE guard, runs the test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s60-20261006-tabs-mutations.mjs [د]     (no argument: every part)
//
// Out: scripts/artifacts/s60-20261006-tabs-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- د
  ["د", "a tab is never cut to its budget", [["src/day-tabs.ts",
    "  while (wrap().length > budget) {", "  while (false) {"]], "tests/s60-tabs.test.mts"],
  ["د", "over its budget a tab drops its most needed part first", [["src/day-tabs.ts",
    "(p.rank > 0 && (k < 0 || p.rank >= kept[k].rank) ? i : k)", "(p.rank > 0 && (k < 0 || p.rank <= kept[k].rank) ? i : k)"]], "tests/s60-tabs.test.mts"],
  ["د", "a part of rank 0 is dropped", [["src/day-tabs.ts",
    "(p.rank > 0 && (k < 0 || p.rank >= kept[k].rank) ? i : k)", "((k < 0 || p.rank >= kept[k].rank) ? i : k)"]], "tests/s60-tabs.test.mts"],
  ["د", "the budget is 15000 characters an item", [["src/day-tabs.ts",
    "export const TAB_ITEM_BUDGET = 1500;", "export const TAB_ITEM_BUDGET = 15000;"]], "tests/s60-tabs.test.mts"],
  ["د", "the budget does not grow with the items", [["src/day-tabs.ts",
    "const budget = TAB_ITEM_BUDGET * Math.max(1, items);", "const budget = TAB_ITEM_BUDGET;"]], "tests/s60-tabs.test.mts"],
  ["د", "the split names the purchase before the VAT", [["src/day-tabs.ts",
    "[[\"vat\", \"ضريبة\"], [\"purchase\", \"شراء\"], [\"waste\", \"تالف\"], [\"share\", \"تشغيل\"]]", "[[\"purchase\", \"شراء\"], [\"vat\", \"ضريبة\"], [\"waste\", \"تالف\"], [\"share\", \"تشغيل\"]]"]], "tests/s60-tabs.test.mts"],
  ["د", "the carton's price is the mean market price, not the price it goes out at", [["src/day-tabs.ts",
    "const sale = round2(mean((r) => r.price));", "const sale = round2(mean((r) => r.sale));"]], "tests/s60-tabs.test.mts"],
  ["د", "the VAT is not what is left of the price (the parts no longer add up)", [["src/day-tabs.ts",
    "return { basis: \"carton\", sale, vat: round2(sale - purchase - waste - share - profit), purchase,", "return { basis: \"carton\", sale, vat: round2(sale - sale / 1.15), purchase,"]], "tests/s60-tabs.test.mts"],
  ["د", "yesterday's real carton is never shown", [["src/day-tabs.ts",
    "  return actualSplit(c.inputs.sold, y, c.vatPct) ?? cartonSplit(c.rows);", "  return cartonSplit(c.rows);"]], "tests/s60-tabs.test.mts"],
  ["د", "yesterday's real split is the whole day, not a carton", [["src/day-tabs.ts",
    "const purchaseRaw = of.reduce((a, l) => a + l.quantity * l.purchase, 0) / q;", "const purchaseRaw = of.reduce((a, l) => a + l.quantity * l.purchase, 0);"]], "tests/s60-tabs.test.mts"],
  ["د", "the planned waste is called the real one", [["src/day-tabs.ts",
    "${y && y.actWaste > 0 ? \"الفعلي\" : \"المخطط\"}", "${y && y.actWaste > 0 ? \"المخطط\" : \"الفعلي\"}"]], "tests/s60-tabs.test.mts"],
  ["د", "the share «as it really was» is over the planned cartons", [["src/day-tabs.ts",
    "`بمبيعات أمس الفعلية كانت ${f2(y.actCost / y.actual.cartons)} للكرتون`", "`بمبيعات أمس الفعلية كانت ${f2(y.actCost / 250)} للكرتون`"]], "tests/s60-tabs.test.mts"],
  ["د", "no cartons to divide by still gives a share line", [["src/day-tabs.ts",
    "const share = c.cartons && c.cartons > 0 ?", "const share = true ?"]], "tests/s60-tabs.test.mts"],
  ["د", "a draft expense is counted", [["src/day-tabs.ts",
    "[\"journal_id.code\", \"=\", EXPENSE_JOURNAL], [\"parent_state\", \"=\", \"posted\"], ", "[\"journal_id.code\", \"=\", EXPENSE_JOURNAL], "]], "tests/s60-tabs.test.mts"],
  ["د", "the VAT line of an expense is counted as an expense", [["src/day-tabs.ts",
    ", [\"date\", \"<=\", to], [\"account_type\", \"in\", EXPENSE_TYPES]],", ", [\"date\", \"<=\", to]],"]], "tests/s60-tabs.test.mts"],
  ["د", "a purchase bill is counted as an operating expense", [["src/day-tabs.ts",
    "domain: [[\"journal_id.code\", \"=\", EXPENSE_JOURNAL], [\"parent_state\"", "domain: [[\"parent_state\""]], "tests/s60-tabs.test.mts"],
  ["د", "the September trials' entries are counted", [["src/day-tabs.ts",
    "rows.filter((r) => !`${r.ref || \"\"} ${r.move_name || \"\"}`.includes(SIM_REF)).reduce(", "rows.reduce("]], "tests/s60-tabs.test.mts"],
  ["د", "the week opens on Sunday", [["src/day-tabs.ts",
    "  return addDays(day, -((dow + 1) % 7));", "  return addDays(day, -(dow % 7));"]], "tests/s60-tabs.test.mts"],
  ["د", "last week's expenses are counted", [["src/day-tabs.ts",
    "[\"parent_state\", \"=\", \"posted\"], [\"date\", \">=\", from], [\"date\", \"<=\", to]", "[\"parent_state\", \"=\", \"posted\"], [\"date\", \"<=\", to]"]], "tests/s60-tabs.test.mts"],
  ["د", "tomorrow's expenses are counted", [["src/day-tabs.ts",
    "[\"date\", \">=\", from], [\"date\", \"<=\", to], [\"account_type\"", "[\"date\", \">=\", from], [\"account_type\""]], "tests/s60-tabs.test.mts"],
  ["د", "last week's days are in the week's plan", [["src/day-tabs.ts",
    "c.inputs.days.filter((d) => d.day >= c.inputs.weekFrom && d.cost > 0)", "c.inputs.days.filter((d) => d.cost > 0)"]], "tests/s60-tabs.test.mts"],
  ["د", "a day without a cost is counted in the plan's days", [["src/day-tabs.ts",
    "c.inputs.days.filter((d) => d.day >= c.inputs.weekFrom && d.cost > 0)", "c.inputs.days.filter((d) => d.day >= c.inputs.weekFrom)"]], "tests/s60-tabs.test.mts"],
  ["د", "the day's own cost is not in the week's plan", [["src/day-tabs.ts",
    "...(c.cost !== null && c.cost > 0 ? [c.cost] : [])];", "...[]];"]], "tests/s60-tabs.test.mts"],
  ["د", "over the plan is said to be under it", [["src/day-tabs.ts",
    "+ (!spent ? \".\" : spent > planned ? ` — فوق المخطط بـ", "+ (!spent ? \".\" : spent < planned ? ` — فوق المخطط بـ"]], "tests/s60-tabs.test.mts"],
  ["د", "expenses that could not be read are written 0.00", [["src/day-tabs.ts",
    "مصاريف مسجّلة فعلاً ${spent === null ? \"تعذّرت\" :", "مصاريف مسجّلة فعلاً ${false ? \"تعذّرت\" :"]], "tests/s60-tabs.test.mts"],
  ["د", "a day still a draft counts as a day the item went out", [["src/day-tabs.ts",
    "return state === \"published\" && r.publish && r.profit !== null ? r.profit : null;", "return r.publish && r.profit !== null ? r.profit : null;"]], "tests/s60-tabs.test.mts"],
  ["د", "a day never published counts in the item's mean", [["src/day-tabs.ts",
    "const out = published.has(dayId) && !l.x_excluded && Number(l.x_sale_price) > 0;", "const out = !l.x_excluded && Number(l.x_sale_price) > 0;"]], "tests/s60-tabs.test.mts"],
  ["د", "a day of before the board counts as a profit of 0", [["src/day-tabs.ts",
    "if (!l || !(l.sale > 0) || !l.priced) return null;", "if (!l || !(l.sale > 0)) return null;"]], "tests/s60-tabs.test.mts"],
  ["د", "what the cartons really fetched is ignored", [["src/day-tabs.ts",
    "return q > 0 ? round2(l.profit + sold.reduce((a, s) => a + s.quantity * (s.sale - l.sale), 0) / q / d) : l.profit;", "return l.profit;"]], "tests/s60-tabs.test.mts"],
  ["د", "real sales are matched by the delivery day, not the price day", [["src/day-tabs.ts",
    "s.key === r.key && s.priceDay === day && s.quantity > 0", "s.key === r.key && s.day === day && s.quantity > 0"]], "tests/s60-tabs.test.mts"],
  ["د", "the weakest item first", [["src/day-tabs.ts",
    ".sort((a, b) => (b.average as number) - (a.average as number));", ".sort((a, b) => (a.average as number) - (b.average as number));"]], "tests/s60-tabs.test.mts"],
  ["د", "the «not complete yet» note is never written", [["src/day-tabs.ts",
    "html: most > 0 && most < ENOUGH_DAYS ?", "html: false ?"]], "tests/s60-tabs.test.mts"],
  ["د", "an item never published is left out of the list", [["src/day-tabs.ts",
    "[...ranked, ...stats.filter((s) => s.average === null)].map(itemLine)", "ranked.map(itemLine)"]], "tests/s60-tabs.test.mts"],
  ["د", "a market 15 % above its mean is «ثابت»", [["src/day-tabs.ts",
    "export const TREND_BAND = 0.02;", "export const TREND_BAND = 0.2;"]], "tests/s60-tabs.test.mts"],
  ["د", "a rising market is called falling", [["src/day-tabs.ts",
    "last > mean * (1 + TREND_BAND) ? \"up\" : last < mean * (1 - TREND_BAND) ? \"down\" : \"flat\";", "last > mean * (1 + TREND_BAND) ? \"down\" : last < mean * (1 - TREND_BAND) ? \"up\" : \"flat\";"]], "tests/s60-tabs.test.mts"],
  ["د", "the mean counts the last price itself", [["src/day-tabs.ts",
    "const before = points.slice(0, -1).filter(", "const before = points.filter("]], "tests/s60-tabs.test.mts"],
  ["د", "a price older than a week counts in the mean", [["src/day-tabs.ts",
    ".filter((p) => p.day >= addDays(lastDay || \"1970-01-01\", -ENOUGH_DAYS)).map((p) => p.value);", ".map((p) => p.value);"]], "tests/s60-tabs.test.mts"],
  ["د", "«بكرة إذا استمر» is shown from two market days", [["src/day-tabs.ts",
    "  if (n >= RANGE_MARKET_DAYS) {", "  if (n >= 2) {"]], "tests/s60-tabs.test.mts"],
  ["د", "the range opens at the last price", [["src/day-tabs.ts",
    "range = [round2(Math.max(0, last - step)), round2(last + step)];", "range = [round2(last), round2(last + step)];"]], "tests/s60-tabs.test.mts"],
  ["د", "two days in a row count as three", [["src/day-tabs.ts",
    "export const STREAK = 3;", "export const STREAK = 2;"]], "tests/s60-tabs.test.mts"],
  ["د", "a market going up and down counts as a streak", [["src/day-tabs.ts",
    "if (!((last[i] - last[i - 1]) * sign > 0.004)) return 0;", "if (!(Math.abs(last[i] - last[i - 1]) > 0.004)) return 0;"]], "tests/s60-tabs.test.mts"],
  ["د", "a market below the suggested price is an opportunity", [["src/day-tabs.ts",
    "if (r.sale > 0 && r.suggested > 0 && r.sale - r.suggested > 0.004) {", "if (r.sale > 0 && r.suggested > 0) {"]], "tests/s60-tabs.test.mts"],
  ["د", "the opportunities are sorted the least riyals first", [["src/day-tabs.ts",
    "  out.sort((a, b) => b.riyal - a.riyal);", "  out.sort((a, b) => a.riyal - b.riyal);"]], "tests/s60-tabs.test.mts"],
  ["د", "the day's own supplier is offered as a cheaper source", [["src/day-tabs.ts",
    "if (o.key !== r.key || o.partnerId === taken) continue;", "if (o.key !== r.key) continue;"]], "tests/s60-tabs.test.mts"],
  ["د", "a source's first offer counts, not its latest", [["src/day-tabs.ts",
    "if (!cur || o.day > cur.day || (o.day === cur.day && o.price < cur.price)) latest.set(o.partnerId, o);", "if (!cur) latest.set(o.partnerId, o);"]], "tests/s60-tabs.test.mts"],
  ["د", "a dearer source is offered as a cheaper one", [["src/day-tabs.ts",
    ".filter((o) => r.purchase > 0 && r.purchase - o.price > 0.004).sort((a, b) => a.price - b.price)[0];", ".filter((o) => r.purchase > 0).sort((a, b) => a.price - b.price)[0];"]], "tests/s60-tabs.test.mts"],
  ["د", "the dearest of the cheaper sources is named", [["src/day-tabs.ts",
    "r.purchase - o.price > 0.004).sort((a, b) => a.price - b.price)[0];", "r.purchase - o.price > 0.004).sort((a, b) => b.price - a.price)[0];"]], "tests/s60-tabs.test.mts"],
  ["د", "an offer of an earlier day is said to be today's", [["src/day-tabs.ts",
    "${today ? \"اشترِ منه\" : \"اطلب سعره اليوم\"}", "${today ? \"اطلب سعره اليوم\" : \"اشترِ منه\"}"]], "tests/s60-tabs.test.mts"],
  ["د", "«🎯 الفرص» lists every opportunity", [["src/day-tabs.ts",
    "export const TOP_OPPORTUNITIES = 5;", "export const TOP_OPPORTUNITIES = 50;"]], "tests/s60-tabs.test.mts"],
  ["د", "the margin's alarm never rings", [["src/day-tabs.ts",
    "return streak(v, -1) < 0 ? [`${MARGIN_ALARM}", "return false ? [`${MARGIN_ALARM}"]], "tests/s60-tabs.test.mts"],
  ["د", "what covers the day is not written", [["src/day-tabs.ts",
    "{ html: cover ? `<div class=\"utak-cover fw-bold mt-3\">${lineHtml(cover)}</div>` : \"\", rank: 0 },", "{ html: \"\", rank: 0 },"]], "tests/s60-tabs.test.mts"],
  ["د", "a «سوق» source's number is read as a purchase offer", [["src/day-tabs.ts",
    "const ids = [...sources.partnerIds].filter((id) => !marketOnly.has(id));", "const ids = [...sources.partnerIds];"]], "tests/s60-tabs.test.mts"],
  ["د", "a failed reading is an offer", [["src/day-tabs.ts",
    "[\"x_price_sar\", \">\", 0], [\"x_extraction_status\", \"!=\", \"failed\"], [\"x_supplier_id\", \"in\", ids]", "[\"x_price_sar\", \">\", 0], [\"x_supplier_id\", \"in\", ids]"]], "tests/s60-tabs.test.mts"],
  ["د", "a simulation's row is an offer", [["src/day-tabs.ts",
    "[\"x_supplier_id\", \"in\", ids], [SIM_FIELD, \"!=\", true]],", "[\"x_supplier_id\", \"in\", ids]],"]], "tests/s60-tabs.test.mts"],
  ["د", "an offer older than seven days is an offer", [["src/day-tabs.ts",
    "domain: [[\"x_date\", \">=\", from], [\"x_date\", \"<=\", day], [\"x_price_sar\", \">\", 0],", "domain: [[\"x_date\", \"<=\", day], [\"x_price_sar\", \">\", 0],"]], "tests/s60-tabs.test.mts"],
  ["د", "a day published is said to be going out still", [["src/day-tabs.ts",
    "b.state === \"published\" ? \"نُشر\" : \"يُنشر\"", "b.state === \"published\" ? \"يُنشر\" : \"نُشر\""]], "tests/s60-tabs.test.mts"],
  ["د", "the brief counts every item as going out", [["src/day-tabs.ts",
    "const out = b.rows.filter((r) => r.publish).length, n = b.rows.length;", "const out = b.rows.length, n = b.rows.length;"]], "tests/s60-tabs.test.mts"],
  ["د", "a mean that was not computed is written 0.00", [["src/day-tabs.ts",
    "b.average === null ? \"غير محسوب\" : sign2(b.average)", "false ? \"غير محسوب\" : sign2(b.average as number)"]], "tests/s60-tabs.test.mts"],
  ["د", "the brief names the smallest cost", [["src/day-tabs.ts",
    "[...SPLIT_COSTS].sort((x, y) => w[y[0]] - w[x[0]])[0]", "[...SPLIT_COSTS].sort((x, y) => w[x[0]] - w[y[0]])[0]"]], "tests/s60-tabs.test.mts"],
  ["د", "the brief names three opportunities", [["src/day-tabs.ts",
    "b.opportunities.slice(0, 2).map((o) => o.short);", "b.opportunities.slice(0, 3).map((o) => o.short);"]], "tests/s60-tabs.test.mts"],
  ["د", "a name is written into the brief as HTML", [["src/day-tabs.ts",
    "`<div class=\"utak-brief-line\">${lineHtml(l)}</div>`", "`<div class=\"utak-brief-line\">${l}</div>`"]], "tests/s60-tabs.test.mts"],
  ["د", "a number takes what follows it into its own direction («35.75:»)", [["src/day-tabs.ts",
    "export const NUMBER = /[+−]?\\d+(?:[.,:–]\\d+)*%?/g;", "export const NUMBER = /[+−]?\\d[\\d.,:–]*%?/g;"]], "tests/s60-tabs.test.mts"],
  ["د", "«<» in a name is not escaped", [["src/day-tabs.ts",
    ".replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\");\nconst f2", ".replace(/&/g, \"&amp;\").replace(/>/g, \"&gt;\");\nconst f2"]], "tests/s60-tabs.test.mts"],
  ["د", "the inputs are read from Odoo with every run (no KV)", [["src/day-tabs.ts",
    "nowMs - kept.at < INPUT_TTL_SEC * 1000) return kept.inputs;", "nowMs - kept.at < 0) return kept.inputs;"]], "tests/s60-tabs.test.mts"],
  ["د", "the kept inputs never grow old", [["src/day-tabs.ts",
    "&& nowMs >= kept.at && nowMs - kept.at < INPUT_TTL_SEC * 1000) return kept.inputs;", "&& nowMs >= kept.at) return kept.inputs;"]], "tests/s60-tabs.test.mts"],
  ["د", "a failed read is kept", [["src/day-tabs.ts",
    "  if (!out.errors.length) {\n    try { await env.MSG_DEDUP.put(inputsKey(day)", "  if (true) {\n    try { await env.MSG_DEDUP.put(inputsKey(day)"]], "tests/s60-tabs.test.mts"],
  ["د", "«🔄 إعادة الحساب» reads the kept inputs", [["src/day-tabs.ts",
    "  if (!force) {\n    try {\n      const hit = await env.MSG_DEDUP.get(inputsKey(day));", "  if (true) {\n    try {\n      const hit = await env.MSG_DEDUP.get(inputsKey(day));"]], "tests/s60-tabs.test.mts"],
  ["د", "asks older than seven days are opportunities", [["src/day-tabs.ts",
    "await readUnavailable(env, addDays(day, -(ASK_DAYS - 1)), day)", "await readUnavailable(env, addDays(day, -30), day)"]], "tests/s60-tabs.test.mts"],
  ["د", "a part that cannot be read stops the others", [["src/day-tabs.ts",
    "    try { await fn(); } catch (e) {\n      out.errors.push(name);", "    try { await fn(); } catch (e) {\n      throw e;"]], "tests/s60-tabs.test.mts"],
  ["د", "a day whose record was not computed reads as computed", [["src/day-insight.ts",
    "  if (!r || !r.x_act_at) return null;", "  if (!r) return null;"]], "tests/s60-tabs.test.mts"],
  ["د", "the tabs are not written with the day", [["src/day-screen.ts",
    "    x_tab_items_html: itemsTabHtml({ rows, inputs: extra.inputs, state, vatPct }),", "    x_tab_items_html: \"\","]], "tests/s60-tabs.test.mts"],
  ["د", "the brief is not written with the day", [["src/day-screen.ts",
    "    x_brief_html: briefHtml(screenBrief(rows, lines, day, state, extra)),\n", ""]], "tests/s60-tabs.test.mts"],
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
writeFileSync(new URL("../artifacts/s60-20261006-tabs-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
