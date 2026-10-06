// § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم» made plain, and its chart.
//
//   [أ1] the table's cells and the header's four numbers, with the numbers of 2026-10-05 (the record
//        #54) as the engine computes them: «الشراء شامل», «ربحنا بسعر السوق ±», «المقترح (وربحه)»,
//        «فرق المقترح عن السوق ±», «القرار» — and the same numbers as the day's review (§ 55)
//   [أ2] the signs: «+», «−» (U+2212), two decimals, read left to right in a right-to-left cell
//   [أ3] an item without a market price; one without a purchase price; one out of the catalog
//   [أ4] the record #54 as the tenant stored it: an outlier ⚠️, Baraa's own «لا تنشر»
//   [أ5] Baraa's decision, his own price, a price with no profit (🔻)
//   [أ6] a published day says what went out; the screen is written after the publication
//   [أ7] the engine, the board and writeDayScreen write the screen's fields only beside their own
//   [ب1] the chart: one key, a row an item with its three marks, its values and its profit signed;
//        an item without a market price has two marks and «لا سعر سوق»; one axis
//   [ب2] «ربح الكرتون»: a column an item around the zero line, the value written on it
//   [ب3] the HTML is what Odoo's sanitizer stores as written: div / span, class / style / title / dir,
//        no script — and a product's name never becomes a tag
//   [ج]  the screen's arch (scripts/lib/s56-ui.mjs): the body replaced, the buttons untouched; nine
//        columns in the review's order; cards in the same order; everything else in the line's form
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s56.test.mts

import { readFileSync } from "node:fs";
import { odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { C1_PHONE, DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const RV = await import("../src/price-review.ts");
const DS = await import("../src/day-screen.ts");
// @ts-ignore — plain .mjs helpers
const UI = await import("../scripts/lib/s56-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI48 = await import("../scripts/lib/s48-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI49 = await import("../scripts/lib/s49-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI54 = await import("../scripts/lib/s54-odoo.mjs");

const FX = JSON.parse(readFileSync(new URL("./fixtures-s56-day54.json", import.meta.url), "utf8"));
const SCHEMA = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261005-s58.json", import.meta.url), "utf8")); // § 58: the tenant's fields now (§ 56's and the day's plan, actual and tabs)
const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };
const L = DS.LTR_MARK;

/** The tenant on 2026-10-05: four active items, the day's cost 496.52 over 250 cartons (a share of 1.99), waste 5 %, a minimum profit of 2. */
function world(riyadh = `${DAY} 04:00`): any {
  const env = fresh(riyadh); cost(496.52); setExtract(null);
  for (const [id, name] of Object.entries(NAMES)) table("product.template").get(Number(id))!.name = name;
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 5;
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  openWindow(env, C1_PHONE);
  return env;
}
/** The prices of 2026-10-05: banana 55 / 70, pomegranate (medium) 15 / 20, (small) 12 / —, (large) 22 / 28. */
function prices(): void {
  dp(1, 11, 55); market(1, 11, 70);
  dp(2, 21, 15); market(2, 21, 20);
  dp(3, 31, 12);
  dp(4, 41, 22); market(4, 41, 28);
}
const engine = (env: any, now?: number) => quiet(() => PR.refreshPriceDay(env, { force: true, ...(now ? { now } : {}) }));
const line = (p: number) => lineFor(p) as any;
// § 56's six cells (§ 60 added the line's contribution to what the worker writes: tests/s60-screen.test.mts)
const cells = (p: number) => PR.SCREEN_LINE_FIELDS.filter((f: string) => f !== "x_contribution").map((f: string) => line(p)[f]);
const head = () => Object.fromEntries(PR.SCREEN_DAY_FIELDS.filter((f: string) => f !== "x_chart_html").map((f: string) => [f, dayOf()[f]]));
const chart = () => String(dayOf().x_chart_html);
const writesOf = (model: string) => odooLog.filter((x) => x.model === model && x.method === "write");
/** The chart's rows and columns, each as its own piece of HTML. */
const rowsOf = (html: string) => html.split(`<div class="utak-row `).slice(1).map((r) => r.split(`<div class="utak-axis `)[0]);
const colsOf = (html: string) => html.split(`<div class="utak-col `).slice(1);
const markAt = (row: string, kind: string) => { const m = new RegExp(`<div class="utak-m-${kind}" title="([^"]*)" style="[^"]*?left:([\\d.]+)%`).exec(row); return m ? { title: m[1], at: Number(m[2]) } : null; };
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// ================================================================ [أ1] the day of 2026-10-05, as the engine leaves it
{
  const env = world(); prices();
  const r = await engine(env);
  assert("the engine builds the day: four lines", r.action === "refreshed" && r.lines === 4, JSON.stringify(r));
  assert("موز: شامل 63.25 · ربحنا بسعر السوق +1.13 · المقترح 71.50 (+2.43) · الفرق +1.50 (+2.1%) · «✅ انشر بـ 70.00 · معتمد»",
    JSON.stringify(cells(1)) === JSON.stringify(["63.25", 1.13, `${L}+1.13`, `${L}71.50 (+2.43)`, `${L}+1.50 (+2.1%)`, "✅ انشر بـ 70.00 · معتمد"]), JSON.stringify(cells(1)));
  assert("رمان وسط: شامل 17.25 · ربحنا بسعر السوق −0.35 · المقترح 23.00 (+2.26) · الفرق +3.00 (+15%) · «❌ لا تنشر»",
    JSON.stringify(cells(2)) === JSON.stringify(["17.25", -0.35, `${L}−0.35`, `${L}23.00 (+2.26)`, `${L}+3.00 (+15%)`, "❌ لا تنشر"]), JSON.stringify(cells(2)));
  assert("رمان صغير (بلا سوق): شامل 13.80 · ربحنا بسعر السوق «—» · المقترح 19.50 (+2.37) · الفرق «—» · «✅ انشر بـ 19.50 · ينتظر قرارك»",
    JSON.stringify(cells(3)) === JSON.stringify(["13.80", 0, "—", `${L}19.50 (+2.37)`, "—", "✅ انشر بـ 19.50 · ينتظر قرارك"]), JSON.stringify(cells(3)));
  assert("رمان كبير: شامل 25.30 · ربحنا بسعر السوق −0.74 · المقترح 31.50 (+2.30) · الفرق +3.50 (+12.5%) · «❌ لا تنشر»",
    JSON.stringify(cells(4)) === JSON.stringify(["25.30", -0.74, `${L}−0.74`, `${L}31.50 (+2.30)`, `${L}+3.50 (+12.5%)`, "❌ لا تنشر"]), JSON.stringify(cells(4)));
  assert("the header: للنشر 2 · لا تنشر 2 · ⚠️ 0 · متوسط ربح الكرتون +1.75", JSON.stringify(head()) === JSON.stringify({ x_n_publish: 2, x_n_skip: 2, x_n_warn: 0, x_avg_profit: 1.75, x_avg_profit_show: `${L}+1.75` }), JSON.stringify(head()));
  assert("«معتمد» is what «نشر المعتمد الآن» sends: the banana alone is approved by the rule", [1, 2, 3, 4].filter((p) => PR.isPublishable(line(p))).join() === "1" && [1, 2, 3, 4].filter((p) => String(line(p).x_outcome_show).includes("معتمد")).join() === "1");
  // the same numbers as the day's review (§ 55): one source
  const stored = await PR.readLines(env, dayOf().id);
  const review = RV.reviewRows(stored, "market", DAY);
  const screen = DS.screenRows(stored, "market", DAY, "draft");
  assert("«ربحنا بسعر السوق» is the review's own profitAt at the market price, row by row", review.every((r: any, i: number) => screen[i].marketProfit === (r.sale > 0 ? RV.profitAt(r, r.sale) : null)) && screen.map((r: any) => r.marketProfit).join() === "1.13,-0.35,,-0.74");
  assert("«الشراء شامل» is the review's «(… شامل)», to the halala", review.every((r: any, i: number) => RV.purchaseText(r) === `شراء ${PR.money(r.purchase)} (${DS.fixed2(screen[i].purchaseVat)} شامل)`) && DS.purchaseWithVat(12.5) === 14.38 && DS.purchaseWithVat(0) === 0);
  const counts = RV.reviewCounts(review);
  assert("the header's counts are the review's (reviewCounts), and its average the confirmation's «متوسط الربح للكرتون»", counts.publish === 2 && counts.skip === 2 && counts.warn === 0 && RV.averageProfitLine(review) === "متوسط الربح للكرتون: +1.75" && DS.averageProfit(screen) === 1.75);
  assert("«القرار» opens with the review's own mark, and each row's profit is the one of the review's line", review.every((r: any, i: number) => screen[i].mark === RV.rowMark(r) && screen[i].outcome.startsWith(`${RV.rowMark(r)} `)) && screen.map((r: any) => `${r.profit} ${r.profitBase}`).join(" | ") === "1.13 market | -0.35 market | 2.37 suggested | -0.74 market"
    && review.every((r: any, i: number) => RV.reviewLine(r).includes(`${DS.PROFIT_BASE_TEXT[screen[i].profitBase as "market"]}${screen[i].profitBase === "suggested" ? ` ${PR.money(r.suggested)}` : ""}: ${RV.signed(screen[i].profit)}`)), JSON.stringify(review.map((r: any) => RV.reviewLine(r))));
  assert("the fields the worker writes are the ones the Odoo script creates, each on its model", JSON.stringify([...UI.LINE_FIELDS.map((f: any) => f.name), "x_contribution"]) === JSON.stringify(PR.SCREEN_LINE_FIELDS) && JSON.stringify(UI.DAY_FIELDS.map((f: any) => f.name)) === JSON.stringify(PR.SCREEN_DAY_FIELDS)
    && PR.SCREEN_LINE_FIELDS.every((f: string) => SCHEMA.x_price_day_line.includes(f) && PR.LINE_FIELDS.includes(f)) && PR.SCREEN_DAY_FIELDS.every((f: string) => SCHEMA.x_price_day.includes(f)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));

  // ---- [أ7] a second run with nothing changed writes no line; a board rewrite writes the same screen
  odooLog.length = 0;
  await engine(env);
  assert("a second run with the same prices writes no line again (the cells are compared as stored)", writesOf("x_price_day_line").length === 0, JSON.stringify(writesOf("x_price_day_line").map((x) => x.body.vals)));
  const before = JSON.stringify([[1, 2, 3, 4].map(cells), head(), chart()]);
  odooLog.length = 0;
  await quiet(() => PR.rewriteBoard(env, dayOf().id));
  assert("rewriteBoard leaves the same cells, the same four numbers and the same chart, and writes them on the day", JSON.stringify([[1, 2, 3, 4].map(cells), head(), chart()]) === before && writesOf("x_price_day").length === 1 && PR.SCREEN_DAY_FIELDS.every((f: string) => f in writesOf("x_price_day")[0].body.vals) && writesOf("x_price_day_line").length === 0);
  // writeDayScreen: the screen's fields alone
  for (const p of [1, 2, 3, 4]) Object.assign(line(p), { x_cost_vat_show: false, x_market_profit: 0, x_market_profit_show: false, x_suggested_profit_show: false, x_gap_show: false, x_outcome_show: false });
  Object.assign(dayOf(), { x_n_publish: 0, x_n_skip: 0, x_n_warn: 0, x_avg_profit: 0, x_avg_profit_show: false, x_chart_html: false });
  odooLog.length = 0;
  const dry = await quiet(() => DS.writeDayScreen(env, dayOf().id, { dry: true }));
  assert("writeDayScreen, dry: the day's screen is made (4 lines to write) and nothing is written", dry.updated === 4 && dry.lines === 4 && dry.header.x_n_publish === 2 && odooLog.every((x) => x.method !== "write" && x.method !== "create") && line(1).x_outcome_show === false, JSON.stringify(dry.header.x_n_publish));
  const wrote = await quiet(() => DS.writeDayScreen(env, dayOf().id));
  assert("writeDayScreen: a day computed before § 56 gets its cells, its numbers and its chart back — the same ones", wrote.updated === 4 && JSON.stringify([[1, 2, 3, 4].map(cells), head(), chart()]) === before);
  assert("…writing the screen's own fields ONLY: no price, no status, no decision, no state", writesOf("x_price_day_line").length === 4 && writesOf("x_price_day_line").every((x) => Object.keys(x.body.vals).every((k) => (PR.SCREEN_LINE_FIELDS as readonly string[]).includes(k)))
    && writesOf("x_price_day").length === 1 && JSON.stringify(Object.keys(writesOf("x_price_day")[0].body.vals).sort()) === JSON.stringify([...PR.SCREEN_DAY_FIELDS, ...DS.INSIGHT_DAY_FIELDS].sort()), JSON.stringify(writesOf("x_price_day_line").map((x) => Object.keys(x.body.vals))));
  odooLog.length = 0;
  const again = await quiet(() => DS.writeDayScreen(env, dayOf().id));
  assert("…and a second time no line is written", again.updated === 0 && writesOf("x_price_day_line").length === 0);
  assert("no Odoo field or value outside the schema (the screen's writes)", rejected.length === 0, rejected.join(" | "));

  // ================================================================ [ب1] the chart of that day
  const html = chart();
  const rs = rowsOf(html);
  assert("the chart: «سعرنا مقابل السوق» then «ربح الكرتون», ONE key above the rows, a row an item in the table's order", html.indexOf(DS.CHART_TITLE_PRICES) > 0 && html.indexOf(DS.CHART_TITLE_PROFIT) > html.indexOf(DS.CHART_TITLE_PRICES)
    && html.split(`class="utak-key `).length === 2 && html.indexOf(`class="utak-key `) < html.indexOf(`class="utak-row `) && rs.length === 4 && rs.map((r) => /class="utak-name fw-bold">([^<]*)</.exec(r)?.[1]).join(" | ") === "✅ موز أمريكي | ❌ رمان وسط | ✅ رمان صغير | ❌ رمان كبير", rs.map((r) => text(r).slice(0, 30)).join(" | "));
  const key = /<div class="utak-key [\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  const shapes = [...key.matchAll(/<span style="display:inline-block;vertical-align:middle;margin:0 3px;([^"]*)"><\/span>([^<]*)/g)].map((m) => [m[1], m[2].trim()]);
  assert("the key names the three marks, each a shape of its own (a square, a ring, a diamond) in the text's colour — never a colour alone", shapes.length === 3 && new Set(shapes.map((s) => s[0])).size === 3 && shapes.every((s) => s[0].includes("currentColor") && !/#[0-9a-f]{3,6}|rgb/i.test(s[0]))
    && shapes.map((s) => s[1]).join(" | ") === "الشراء شامل الضريبة | السوق | سعرنا (المقرر، أو المقترح إن لم يُقرر)" && /border-radius:50%/.test(shapes[1][0]) && /rotate\(45deg\)/.test(shapes[2][0]) && !/border-radius|rotate/.test(shapes[0][0]), JSON.stringify(shapes));
  assert("موز: its three marks — الشراء شامل 63.25, السوق 70.00, سعرنا 70.00 (مقرر) — and «▲ +1.13 بسعر السوق» in green", markAt(rs[0], "cost")?.title === "الشراء شامل 63.25" && markAt(rs[0], "market")?.title === "السوق 70.00" && markAt(rs[0], "ours")?.title === "سعرنا 70.00"
    && text(rs[0]).includes("الشراء شامل 63.25") && text(rs[0]).includes("السوق 70.00") && text(rs[0]).includes("سعرنا 70.00 (مقرر)") && /class="utak-profit fw-bold text-success">▲ <span dir="ltr">\+1\.13<\/span> <span class="fw-normal">بسعر السوق<\/span>/.test(rs[0]), text(rs[0]));
  assert("رمان وسط: سعرنا is the suggested price (23.00, «مقترح»: nothing is decided), and «▼ −0.35 بسعر السوق» in red", markAt(rs[1], "ours")?.title === "سعرنا 23.00" && text(rs[1]).includes("سعرنا 23.00 (مقترح)") && /class="utak-profit fw-bold text-danger">▼ <span dir="ltr">−0\.35<\/span> <span class="fw-normal">بسعر السوق<\/span>/.test(rs[1]), text(rs[1]));
  assert("رمان صغير, no market price: TWO marks and «لا سعر سوق», its profit at the suggested price («▲ +2.37 بالمقترح»)", !!markAt(rs[2], "cost") && markAt(rs[2], "market") === null && markAt(rs[2], "ours")?.title === "سعرنا 19.50" && (rs[2].match(/class="utak-m-/g) ?? []).length === 2
    && text(rs[2]).includes("لا سعر سوق") && text(rs[2]).includes("سعرنا 19.50 (مقترح)") && />▲ <span dir="ltr">\+2\.37<\/span> <span class="fw-normal">بالمقترح</.test(rs[2]), text(rs[2]));
  assert("رمان كبير: 25.30 · 28.00 · 31.50 (مقترح), «▼ −0.74 بسعر السوق»", [markAt(rs[3], "cost")?.title, markAt(rs[3], "market")?.title, markAt(rs[3], "ours")?.title].join(" | ") === "الشراء شامل 25.30 | السوق 28.00 | سعرنا 31.50" && />▼ <span dir="ltr">−0\.74<\/span>/.test(rs[3]), text(rs[3]));
  assert("every row with three prices carries three marks, and every profit its sign and its arrow", [0, 1, 3].every((i) => (rs[i].match(/class="utak-m-/g) ?? []).length === 3) && rs.every((r) => /class="utak-profit fw-bold text-(success|danger)">(▲ <span dir="ltr">\+|▼ <span dir="ltr">−)\d+\.\d\d</.test(r)));
  // one axis
  const axis = DS.chartAxis(DS.screenRows(stored, "market", DAY, "draft").flatMap((r: any) => [r.purchaseVat, r.market, r.ours]));
  assert("ONE axis in riyals for every row: 10 → 70 in steps of 10 (the prices run from 13.80 to 70), written once under the rows", JSON.stringify(axis) === JSON.stringify({ lo: 10, hi: 70, step: 10, ticks: [10, 20, 30, 40, 50, 60, 70] }) && html.split(`class="utak-axis `).length === 2
    && html.indexOf(`class="utak-axis `) > html.lastIndexOf(`class="utak-row `) && JSON.stringify([.../<div class="utak-axis [\s\S]*?<\/div><\/div><\/div>/.exec(html)![0].matchAll(/translateX\(-50%\)">([\d.]+)</g)].map((m) => Number(m[1]))) === JSON.stringify(axis!.ticks), JSON.stringify(axis));
  assert("a mark stands where its price is on that axis: 63.25 → 88.75 %, 70 → 100 %, 17.25 → 12.08 %, and a higher price further along, in every row", markAt(rs[0], "cost")?.at === 88.75 && markAt(rs[0], "market")?.at === 100 && markAt(rs[0], "ours")?.at === 100 && markAt(rs[1], "cost")?.at === 12.08 && DS.axisAt(axis!, 10) === 0 && DS.axisAt(axis!, 70) === 100 && DS.axisAt(axis!, 40) === 50 && DS.axisAt(axis!, 5) === 0 && DS.axisAt(axis!, 500) === 100
    && [1, 3].every((i) => markAt(rs[i], "cost")!.at < markAt(rs[i], "market")!.at && markAt(rs[i], "market")!.at < markAt(rs[i], "ours")!.at) && markAt(rs[2], "cost")!.at < markAt(rs[2], "ours")!.at, JSON.stringify(rs.map((r) => ["cost", "market", "ours"].map((k) => markAt(r, k)?.at))));
  assert("the track runs left to right whatever the page's direction, and every tick of the axis is drawn on it", rs.every((r) => /<div class="utak-track" dir="ltr"/.test(r) && axis!.ticks.every((t: number) => r.includes(`left:${DS.axisAt(axis!, t)}%;top:50%;width:1px`))));
  assert("chartAxis: round bounds and nine ticks at most on any range; nothing without a price", DS.chartAxis([]) === null && DS.chartAxis([0, 0]) === null && JSON.stringify(DS.chartAxis([13.8])) === JSON.stringify({ lo: 13.5, hi: 14, step: 0.5, ticks: [13.5, 14] }) && JSON.stringify(DS.chartAxis([20, 20])) === JSON.stringify({ lo: 20, hi: 21, step: 1, ticks: [20, 21] })
    && [[5, 300], [0.5, 2], [19.5, 20], [1, 1000], [12, 12.4, 99]].every((v) => { const a = DS.chartAxis(v)!; return a.lo <= Math.min(...v) && a.hi >= Math.max(...v) && a.ticks.length >= 2 && a.ticks.length <= 9 && a.ticks[0] === a.lo && a.ticks[a.ticks.length - 1] === a.hi; }), JSON.stringify([[5, 300], [0.5, 2], [19.5, 20], [1, 1000]].map((v) => DS.chartAxis(v))));

  // ================================================================ [ب2] «ربح الكرتون»
  const cs = colsOf(html);
  const up = (c: string) => c.split(`<div class="utak-zero"`)[0], down = (c: string) => c.split(`<div class="utak-zero"`)[1];
  const barPx = (part: string) => Number(/class="utak-bar text-(?:success|danger)"[^>]*style="width:24px;height:(\d+)px/.exec(part)?.[1] ?? 0);
  assert("a column an item, in the same order, each around its piece of the zero line", cs.length === 4 && cs.every((c) => c.split(`<div class="utak-zero"`).length === 2) && html.split(`>0</div>`).length >= 2 && cs.map((c) => /<div class="small fw-bold">([^<]*)<\/div>/.exec(c)?.[1]).join(" | ") === "✅ موز أمريكي | ❌ رمان وسط | ✅ رمان صغير | ❌ رمان كبير");
  assert("a profit stands ABOVE the line in green with its value on it (+1.13, +2.37); a loss BELOW it in red (−0.35, −0.74)", [0, 2].every((i) => /class="utak-bar text-success"/.test(up(cs[i])) && !/utak-bar /.test(down(cs[i])) && /class="utak-bar-value small fw-bold" dir="ltr">\+\d/.test(up(cs[i])))
    && [1, 3].every((i) => /class="utak-bar text-danger"/.test(down(cs[i])) && !/utak-bar /.test(up(cs[i])) && /class="utak-bar-value small fw-bold" dir="ltr">−\d/.test(down(cs[i])))
    && cs.map((c) => />([+−]\d+\.\d\d)<\/div>/.exec(c)?.[1]).join(" ") === "+1.13 −0.35 +2.37 −0.74", cs.map((c) => text(c)).join(" | "));
  assert("the columns' heights follow the values: the largest (+2.37) 72 px, +1.13 → 34, −0.35 → 11, −0.74 → 22", [barPx(up(cs[0])), barPx(down(cs[1])), barPx(up(cs[2])), barPx(down(cs[3]))].join() === "34,11,72,22", [barPx(up(cs[0])), barPx(down(cs[1])), barPx(up(cs[2])), barPx(down(cs[3]))].join());
  assert("each column says what its profit was made at: بسعر السوق · بسعر السوق · بالمقترح · بسعر السوق", cs.map((c) => /<div class="small text-muted">([^<]*)<\/div><\/div>/.exec(c)?.[1]).join(" · ") === "بسعر السوق · بسعر السوق · بالمقترح · بسعر السوق");

  // ================================================================ [ب3] what Odoo's sanitizer stores as written
  const tags = [...html.matchAll(/<\/?([a-zA-Z0-9]+)((?:\s+[\w-]+="[^"]*")*)\s*>/g)];
  const attrs = new Set(tags.flatMap((t) => [...t[2].matchAll(/\s([\w-]+)="/g)].map((a) => a[1])));
  assert("the chart is div and span alone, with class / style / title / dir alone — no SVG, no <style>, no script, no handler, no link", tags.length > 100 && tags.every((t) => t[1] === "div" || t[1] === "span") && [...attrs].every((a) => ["class", "style", "title", "dir"].includes(a))
    && html.replace(/<\/?(?:div|span)(?:\s+[\w-]+="[^"]*")*\s*>/g, "").indexOf("<") < 0 && !/javascript:|expression\(|@import|url\(/i.test(html), [...new Set(tags.map((t) => t[1]))].join() + " / " + [...attrs].join());
  assert("…one root, no no-break space, no «%» glued to a digit (Odoo rewrites %20 and the like), every colour the page's own", html.startsWith(`<div class="utak-day-chart d-xxl-flex align-items-start">`) && html.endsWith("</div>") && !html.includes("\u00a0") && !/%[0-9A-Fa-f]{2}/.test(html) && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(html) && html.includes("currentColor") && /text-success/.test(html) && /text-danger/.test(html));
  const open = (html.match(/<(div|span)[\s>]/g) ?? []).length, close = (html.match(/<\/(div|span)>/g) ?? []).length;
  assert("…and every tag is closed", open === close && open > 100, `${open} / ${close}`);
}

// ================================================================ [أ2] the signs
{
  const rowsOf54 = DS.dayScreen(FX.lines, FX.above, FX.day.x_date, FX.day.x_state);
  const signedCells = rowsOf54.lines.flatMap((l: any) => [l.x_market_profit_show, l.x_suggested_profit_show, l.x_gap_show]).filter((c: string) => c !== "—");
  assert("every signed cell opens with the left-to-right mark, so its sign stays in front of its number in a right-to-left cell", signedCells.length === 10 && signedCells.every((c: string) => c.startsWith(L) && /^\u200e[+−]?\d+\.\d\d/.test(c)) && String(rowsOf54.header.x_avg_profit_show).startsWith(L), JSON.stringify(signedCells));
  assert("a profit carries «+», a loss «−» (U+2212, never a hyphen), always two decimals; the number beside it has the same sign", rowsOf54.lines.every((l: any) => l.x_market_profit_show === "—" ? l.x_market_profit === 0 : (l.x_market_profit > 0 ? l.x_market_profit_show.startsWith(`${L}+`) : l.x_market_profit_show.startsWith(`${L}−`)) && /^\u200e[+−]\d+\.\d\d$/.test(l.x_market_profit_show))
    && !rowsOf54.lines.some((l: any) => /-\d/.test(`${l.x_market_profit_show}${l.x_gap_show}${l.x_suggested_profit_show}`)), JSON.stringify(rowsOf54.lines.map((l: any) => l.x_market_profit_show)));
  assert("a price is written with two decimals («70.00», never «70»), and a missing value is «—», never 0.00", DS.fixed2(70) === "70.00" && DS.fixed2(19.5) === "19.50" && DS.fixed2(71.499) === "71.50" && DS.NONE === "—" && !JSON.stringify(rowsOf54.lines).includes("0.00\""));
  // ================================================================ [أ4] the record #54 as the tenant stored it
  assert("#54 as stored: موز is an outlier still waiting — «⚠️ انشر بـ 70.00 · ينتظر قرارك», سعرنا the suggested 71.50", rowsOf54.lines[0].x_outcome_show === "⚠️ انشر بـ 70.00 · ينتظر قرارك" && rowsOf54.rows[0].warn && rowsOf54.rows[0].ours === 71.5 && !rowsOf54.rows[0].decided && rowsOf54.rows[0].profit === 1.13, JSON.stringify(rowsOf54.rows[0]));
  assert("#54 as stored: رمان كبير carries Baraa's own «لا تنشر» — «❌ قرارك: لا تنشر», its profit still the one at the market price (−0.74)", rowsOf54.lines[3].x_outcome_show === "❌ قرارك: لا تنشر" && rowsOf54.rows[3].profit === -0.74 && rowsOf54.rows[3].profitBase === "market" && rowsOf54.lines[3].x_suggested_profit_show === `${L}31.50 (+2.30)`);
  assert("#54 as stored: للنشر 2 · لا تنشر 2 · ⚠️ 1 · متوسط ربح الكرتون +1.75 — and the table's other cells as on a day without the outlier",
    JSON.stringify(Object.fromEntries(Object.entries(rowsOf54.header).filter(([k]) => k !== "x_chart_html"))) === JSON.stringify({ x_n_publish: 2, x_n_skip: 2, x_n_warn: 1, x_avg_profit: 1.75, x_avg_profit_show: `${L}+1.75` })
    && rowsOf54.lines.map((l: any) => [l.x_cost_vat_show, l.x_market_profit_show, l.x_gap_show].join(" ")).join(" | ") === `63.25 ${L}+1.13 ${L}+1.50 (+2.1%) | 17.25 ${L}−0.35 ${L}+3.00 (+15%) | 13.80 — — | 25.30 ${L}−0.74 ${L}+3.50 (+12.5%)`, JSON.stringify(rowsOf54.header.x_n_warn));
  // the same lines on a day already out: nothing waits any more, and what the lines store is what went out (nothing)
  const out54 = DS.dayScreen(FX.lines, FX.above, FX.day.x_date, "published");
  assert("#54's lines on a published day: no ⚠️ any more (nothing waits), every line «❌ لم يُنشر», نُشر 0 · لم يُنشر 4 · متوسط «—»", out54.header.x_n_warn === 0 && out54.header.x_n_publish === 0 && out54.header.x_n_skip === 4 && out54.header.x_avg_profit_show === "—" && out54.header.x_avg_profit === 0 && out54.lines.every((l: any) => l.x_outcome_show === "❌ لم يُنشر"), JSON.stringify(out54.lines.map((l: any) => l.x_outcome_show)));
  // § 53 — a market price with an uplift: «ربحنا بسعر السوق» is made at the price after it, the gap against the market as observed
  const up = DS.dayScreen([{ ...FX.lines[1], x_uplift_pct: 10 }], "market", FX.day.x_date, "draft");
  assert("with «زيادة على سعر السوق» 10 %: ربحنا بسعر السوق at 22 (20 after the uplift) = +1.39, and the gap still 23 − 20 = +3.00 (+15%)", up.rows[0].marketProfit === 1.39 && up.lines[0].x_market_profit_show === `${L}+1.39` && up.lines[0].x_market_profit === 1.39 && up.lines[0].x_gap_show === `${L}+3.00 (+15%)` && up.rows[0].market === 20, JSON.stringify(up.lines[0]));
  const h = String(rowsOf54.header.x_chart_html);
  assert("#54's chart: «⚠️ موز أمريكي» with سعرنا 71.50 (مقترح) beside the market's 70.00, «❌ رمان كبير»", rowsOf(h)[0].includes(`>⚠️ موز أمريكي<`) && text(rowsOf(h)[0]).includes("سعرنا 71.50 (مقترح)") && markAt(rowsOf(h)[0], "ours")!.at > markAt(rowsOf(h)[0], "market")!.at && rowsOf(h)[3].includes(">❌ رمان كبير<"));
}

// ================================================================ [أ3] no purchase price; out of the catalog; a name with HTML in it
{
  const env = world(); prices();
  rows("x_daily_price").filter((r: any) => r.x_product_tmpl_id === 2).forEach((r: any) => { r.x_price_sar = 0; r.x_extraction_status = "failed"; });
  table("product.template").get(3)!.name = `رمان <b onclick="x()">صغير</b> & "حلو"`;
  await engine(env);
  assert("no purchase price: «—» in every cell made from it, «❌ لا تنشر», and nothing made up", JSON.stringify(cells(2)) === JSON.stringify(["—", 0, "—", "—", "—", "❌ لا تنشر"]) && line(2).x_cost_price === 0, JSON.stringify(cells(2)));
  const rs = rowsOf(chart()), cs = colsOf(chart());
  assert("…its row: «لا سعر شراء» among its values, the market's mark alone, no profit drawn; its column: «—» and no bar", /class="utak-values [^"]*" style="[^"]*"><span class="text-nowrap">لا سعر شراء<\/span>/.test(rs[1]) && markAt(rs[1], "cost") === null && markAt(rs[1], "ours") === null && markAt(rs[1], "market")?.title === "السوق 20.00" && /class="utak-profit text-muted">لا سعر شراء</.test(rs[1])
    && !/utak-bar /.test(cs[1]) && /dir="ltr">—<\/div>/.test(cs[1]) && cs[1].includes(`<div class="small text-muted">${DS.NO_PURCHASE_TEXT}</div>`), text(rs[1]) + " / " + text(cs[1]));
  const html = chart();
  assert("a product's name never becomes a tag: «<b onclick…>» is written as text, in the row and under its column", html.includes(`رمان &lt;b onclick="x()"&gt;صغير&lt;/b&gt; &amp; "حلو"`) && !html.includes("<b") && !/\sonclick=/.test(html.replace(/&lt;b onclick="x\(\)"&gt;/g, "")) && DS.esc(`<a href="x">&\u00a0</a>`) === `&lt;a href="x"&gt;&amp; &lt;/a&gt;`
    && html.replace(/<\/?(?:div|span)(?:\s+[\w-]+="[^"]*")*\s*>/g, "").indexOf("<") < 0, html.slice(html.indexOf("رمان &lt;") - 20, html.indexOf("رمان &lt;") + 90));
  // the item leaves the active catalog
  table("product.template").get(4)!.x_is_active_for_sale = false;
  await engine(env);
  assert("an item that left the active catalog: «❌ خارج الكتالوج النشط», out of the four numbers and out of the chart", line(4).x_outcome_show === DS.OUT_OF_CATALOG_TEXT && line(4).x_reason === PR.OUT_OF_CATALOG_REASON && line(4).x_cost_vat_show === "25.30" && line(4).x_market_profit_show === "—"
    && dayOf().x_n_publish + dayOf().x_n_skip === 3 && rowsOf(chart()).length === 3 && colsOf(chart()).length === 3 && !chart().includes("رمان كبير"), JSON.stringify([cells(4), head()]));
  assert("a day without a line says so, and carries no axis", DS.dayChartHtml([]) === `<div class="utak-day-chart text-muted">${DS.CHART_EMPTY_TEXT}</div>` && JSON.stringify(Object.fromEntries(Object.entries(DS.dayScreen([], "market", DAY, "draft").header).filter(([k]) => k !== "x_chart_html"))) === JSON.stringify({ x_n_publish: 0, x_n_skip: 0, x_n_warn: 0, x_avg_profit: 0, x_avg_profit_show: "—" }));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [أ5] Baraa's decision, his own price, a price with no profit
{
  const env = world(); prices();
  await engine(env);
  Object.assign(line(1), { x_decision: "edit", x_manual_price: 72, x_decided_at: false });
  Object.assign(line(3), { x_decision: "profit", x_decided_at: false });
  Object.assign(line(4), { x_decision: "market", x_decided_at: false });
  await engine(env);
  assert("his own price: «✅ قرارك: انشر بـ 72.00», سعرنا 72.00 (مقرر), the profit «بسعرك» (+2.87)", line(1).x_outcome_show === "✅ قرارك: انشر بـ 72.00" && line(1).x_sale_price === 72 && text(rowsOf(chart())[0]).includes("سعرنا 72.00 (مقرر)") && />▲ <span dir="ltr">\+2\.87<\/span> <span class="fw-normal">بسعرك</.test(rowsOf(chart())[0])
    && line(1).x_market_profit_show === `${L}+1.13`, line(1).x_outcome_show + " / " + text(rowsOf(chart())[0]));
  assert("«اعتمد بالسعر المربح» on the item without a market price: «✅ قرارك: انشر بـ 19.50» — no longer «ينتظر قرارك»", line(3).x_outcome_show === "✅ قرارك: انشر بـ 19.50" && text(rowsOf(chart())[2]).includes("سعرنا 19.50 (مقرر)"));
  assert("«اعتمد بسعر السوق» below «بدون خسارة»: it goes out with no profit — 🔻, «▼ −0.74 بسعر السوق», a red column under the line", line(4).x_outcome_show === "🔻 قرارك: انشر بـ 28.00" && rowsOf(chart())[3].includes(">🔻 رمان كبير<") && /text-danger">▼ <span dir="ltr">−0\.74</.test(rowsOf(chart())[3]) && text(rowsOf(chart())[3]).includes("سعرنا 28.00 (مقرر)"), line(4).x_outcome_show);
  assert("the header follows: للنشر 3 · لا تنشر 1 · متوسط ربح الكرتون (2.87 + 2.37 − 0.74) ÷ 3 = +1.50", JSON.stringify(head()) === JSON.stringify({ x_n_publish: 3, x_n_skip: 1, x_n_warn: 0, x_avg_profit: 1.5, x_avg_profit_show: `${L}+1.50` }), JSON.stringify(head()));
  // «لا تنشر» from him
  Object.assign(line(1), { x_decision: "skip", x_decided_at: false });
  await engine(env);
  assert("his «لا تنشر»: «❌ قرارك: لا تنشر», سعرنا back to the suggested price (مقترح), the profit shown the one at the market price", line(1).x_outcome_show === "❌ قرارك: لا تنشر" && text(rowsOf(chart())[0]).includes("سعرنا 71.50 (مقترح)") && />▲ <span dir="ltr">\+1\.13<\/span> <span class="fw-normal">بسعر السوق</.test(rowsOf(chart())[0]) && dayOf().x_n_publish === 2);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [أ6] a published day says what went out
{
  const env = world(`${DAY} 05:55`); prices();
  await engine(env);
  setRiyadh(`${DAY} 06:00`);
  odooLog.length = 0;
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  assert("06:00: the banana goes out by itself, the day is published", dl.action === "auto_published" && dayOf().x_state === "published" && sentTo(C1_PHONE).length > 0, JSON.stringify(dl));
  assert("…and the screen says what went out: «✅ نُشر بـ 70.00», the other three «❌ لم يُنشر» (the small pomegranate too: it waited for him)", [1, 2, 3, 4].map((p) => line(p).x_outcome_show).join(" | ") === "✅ نُشر بـ 70.00 | ❌ لم يُنشر | ❌ لم يُنشر | ❌ لم يُنشر", [1, 2, 3, 4].map((p) => line(p).x_outcome_show).join(" | "));
  assert("…its numbers: نُشر 1 · لم يُنشر 3 · ⚠️ 0 · متوسط ربح الكرتون +1.13", JSON.stringify(head()) === JSON.stringify({ x_n_publish: 1, x_n_skip: 3, x_n_warn: 0, x_avg_profit: 1.13, x_avg_profit_show: `${L}+1.13` }), JSON.stringify(head()));
  assert("…its chart: سعرنا 70.00 (مقرر) for the banana; the others keep their suggested price and their profit at the market price", text(rowsOf(chart())[0]).includes("سعرنا 70.00 (مقرر)") && rowsOf(chart())[2].includes(">❌ رمان صغير<") && text(rowsOf(chart())[2]).includes("سعرنا 19.50 (مقترح)") && />▼ <span dir="ltr">−0\.35</.test(rowsOf(chart())[1]));
  const state = writesOf("x_price_day").findIndex((x) => x.body.vals.x_state === "published");
  const after = odooLog.slice(odooLog.indexOf(writesOf("x_price_day")[state]) + 1).filter((x) => x.method === "write" && (x.model === "x_price_day" || x.model === "x_price_day_line"));
  assert("the screen is written AFTER the state «published», with its own fields alone (the lock's watched fields are never in it)", state >= 0 && after.length >= 2 && after.every((x) => Object.keys(x.body.vals).every((k) => ([...PR.SCREEN_LINE_FIELDS, ...PR.SCREEN_DAY_FIELDS, ...DS.INSIGHT_DAY_FIELDS] as readonly string[]).includes(k))), JSON.stringify(after.map((x) => [x.model, Object.keys(x.body.vals)])));
  // a day published before the engine (§ 35, the tenant's #1): its lines carry no status at all
  const old = [{ ...FX.lines[0], id: 901, x_status: false, x_sale_price: 20.25, x_excluded: false, x_full_cost: 0, x_break_even: 0, x_suggested_price: 0, x_market_price: 0, x_is_outlier: false },
    { ...FX.lines[1], id: 902, x_status: false, x_sale_price: 0, x_excluded: true, x_full_cost: 0, x_break_even: 0, x_suggested_price: 0, x_market_price: 0 }];
  const o35 = DS.dayScreen(old, "market", "2026-09-25", "published");
  assert("a day published before the engine: a line with a sale price and not left out reads «✅ نُشر بـ 20.25», the one left out «❌ لم يُنشر»; the same lines on an open day are not approved", o35.lines.map((l: any) => l.x_outcome_show).join(" | ") === "✅ نُشر بـ 20.25 | ❌ لم يُنشر" && o35.header.x_n_publish === 1 && o35.header.x_n_skip === 1 && o35.header.x_avg_profit_show === "—"
    && DS.dayScreen(old, "market", "2026-09-25", "missed").header.x_n_publish === 0
    && DS.dayScreen([{ ...FX.lines[0], x_is_outlier: false, x_status: false, x_sale_price: 70, x_excluded: false }], "market", FX.day.x_date, "draft").lines[0].x_outcome_show === "✅ انشر بـ 70.00 · ينتظر قرارك", JSON.stringify(o35.lines.map((l: any) => l.x_outcome_show)));
  assert("a day approved and not yet out says «يُنشر بـ …»", DS.dayScreen(await PR.readLines(env, dayOf().id), "market", DAY, "approved").lines[0].x_outcome_show === "✅ يُنشر بـ 70.00");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ج] the screen's arch
{
  const A = { refresh: 1004, confirm: 1038, unapprove: 1003, approve: 1002, prev: 1033, next: 1034, openDay: 1032, openSources: 1037, days: 1009, products: 1041, settings: 1027, purchaseList: 1039, marketList: 1040, packagings: 1042, profitGraph: 1043 };
  const s49 = String(UI49.dayArch(UI48.dayForm(A)));
  const note = UI54.NOTES.find((n: string[]) => n[0] === UI.VIEW_DAY);
  const was = String(UI54.noteArch(s49, note[1], note[2]));     // what the tenant carries before § 56: § 48 + § 49 + § 54
  const now = String(UI.dayArch(was));
  const headOf = (a: string) => /<header>[\s\S]*?<\/header>/.exec(a)?.[0] ?? "";
  assert("the form's header — «🔄 إعادة الحساب», «نشر المعتمد الآن», «إلغاء الاعتماد», the day before and after — is byte for byte what it was", headOf(now) === headOf(was) && headOf(now).length > 400 && ["🔄 إعادة الحساب", "نشر المعتمد الآن", "إلغاء الاعتماد", "◀ اليوم السابق", "اليوم التالي ▶"].every((s) => headOf(now).includes(`string="${s}"`)));
  assert("…so are the links to the other four screens and the two banners above the title, and «تقرير النشر» under the body", now.slice(0, now.indexOf(`<div class="oe_title"><h1>`)) === was.slice(0, was.indexOf(`<div class="oe_title"><h1>`)) && now.slice(now.indexOf(`<group string="تقرير النشر"`)) === was.slice(was.indexOf(`<group string="تقرير النشر"`))
    && now.includes(`name="utak_pricing_nav"`) && now.includes("هذا يوم سابق، وليس اليوم.") && now.includes(`name="x_publish_report"`));
  assert("applying it twice changes nothing; an arch that is not § 48 + § 49 + § 54's stops the script", UI.dayArch(now) === now && [() => UI.dayArch("<form/>"), () => UI.dayArch(s49), () => UI.dayArch(was.replace(`editable="bottom"`, ""))].every((f) => { try { f(); return false; } catch { return true; } }));
  const at = (s: string) => now.indexOf(s);
  const inOrder = (...parts: string[]) => parts.map(at).every((x, i, all) => x >= 0 && (i === 0 || x > all[i - 1]));
  assert("the order: the date, the state and the publication time; the four numbers — للنشر, لا تنشر, ⚠️, متوسط ربح الكرتون; the chart; the table; the day's details", inOrder(`<field name="x_date"`, `name="utak_day_head"`, `<field name="x_state" readonly="1"`, `<field name="x_published_at"`, `name="utak_day_tiles"`, `<field name="x_n_publish"`, "✅ للنشر", `<field name="x_n_skip"`, "❌ لا تنشر", `<field name="x_n_warn"`, "⚠️ سعر شاذ ينتظرك", `<field name="x_avg_profit_show"`, "متوسط ربح الكرتون", `<field name="x_chart_html"`, `<field name="x_line_ids"`, `name="utak_day_details"`, `<field name="x_op_cost"`));
  assert("the four numbers are large (fs-1, bold), two to a row on a phone and four on a wide screen; a published day says «نُشر» / «لم يُنشر»", (UI.TILES.match(/class="col-6 col-md-3"/g) ?? []).length === 4 && (UI.TILES.match(/class="fs-1 fw-bold lh-1/g) ?? []).length === 6 && UI.TILES.includes(`<div invisible="not (x_state == 'published')">✅ نُشر</div>`) && UI.TILES.includes(`<div invisible="not (x_state == 'published')">❌ لم يُنشر</div>`));
  assert("the average's colour only repeats its sign: green above zero, red below it, none at zero — the sign is in the number itself", /class="fs-1 fw-bold lh-1 text-success" invisible="x_avg_profit &lt;= 0"/.test(UI.TILES) && /class="fs-1 fw-bold lh-1 text-danger" invisible="x_avg_profit &gt;= 0"/.test(UI.TILES) && /class="fs-1 fw-bold lh-1" invisible="x_avg_profit != 0"/.test(UI.TILES));
  const list = /<list[\s\S]*?<\/list>/.exec(now)![0];
  const shown = [...list.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].filter((m) => !/column_invisible|optional="hide"/.test(m[2])).map((m) => [m[1], /string="([^"]*)"/.exec(m[2])?.[1]]);
  assert("the table: الصنف · الشراء (بدون ضريبة) · الشراء شامل · السوق · ربحنا بسعر السوق ± · المقترح (وربحه) · فرق المقترح عن السوق ± · القرار · السبب — nine columns, in the review's order", JSON.stringify(shown) === JSON.stringify(UI.COLUMNS)
    && shown.map((c) => c[1]).join(" · ") === "الصنف · الشراء (بدون ضريبة) · الشراء شامل · السوق · ربحنا بسعر السوق ± · المقترح (وربحه) · فرق المقترح عن السوق ± · القرار · السبب", JSON.stringify(shown));
  assert("…read-only (a row opens the line), no colour on a whole row; «ربحنا بسعر السوق» alone is coloured by its sign, and bold", !/editable=/.test(list) && !/<list[^>]*decoration-/.test(list) && (list.match(/decoration-/g) ?? []).length === 3
    && /name="x_market_profit_show"[^>]*decoration-success="x_market_profit &gt; 0" decoration-danger="x_market_profit &lt; 0" decoration-bf="x_market_profit != 0"/.test(list));
  const card = /<kanban[\s\S]*?<\/kanban>/.exec(now)![0], tpl = card.slice(card.indexOf("<templates>"));
  assert("cards on a phone: the same cells in the same order, each on a line of its own (nothing sideways), «القرار» with its mark", /mode="list,kanban"/.test(now) && UI.COLUMNS.map((c: string[]) => tpl.indexOf(`<field name="${c[0]}"`)).every((x: number, i: number, all: number[]) => x > 0 && (i === 0 || x > all[i - 1]))
    && (tpl.match(/class="d-flex justify-content-between/g) ?? []).length === 6 && !/table|overflow|nowrap/.test(tpl) && tpl.includes(`startsWith('✅') ? 'border-success'`) && tpl.includes(`startsWith('❌') ? 'border-danger'`));
  const form = /<form string="تفاصيل الصنف">[\s\S]*?<\/form>/.exec(now)![0];
  assert("the line's own form: «قرار براء» and «السعر المعدّل» (still decided in Odoo), then what left the table — حصة التشغيل, التالف, «بدون خسارة», المشاهدات, المصادر, the technical fields", [...UI.DETAIL_FIELDS, "x_decision", "x_manual_price", "x_outcome_show"].every((f: string) => form.includes(`name="${f}"`))
    && ["x_waste_cost", "x_op_share", "x_full_cost", "x_even_show", "x_market_count", "x_supplier_id", "x_offers", "x_board_status", "x_net_purchase", "x_real_profit"].every((f) => !list.includes(`name="${f}"`) && !tpl.includes(`name="${f}"`))
    && /<field name="x_decision" string="قرار براء"\/>/.test(form) && !/name="x_decision"[^>]*readonly/.test(form) && /name="x_line_ids" readonly="not \(x_state in \('draft', 'missed'\)\)"/.test(now));
  assert("the explanation keeps § 48's formula and § 54's rule, and says how «ربحنا» is made", now.includes(UI.DAY_NOTE_56) && UI.DAY_NOTE_56.startsWith(UI.PROFIT_RULE) && UI.DAY_NOTE_56.includes(note[2]) && !/متى بلغ/.test(now) && now.includes(UI.APPROVED_NOTE) && now.includes(UI.CHART_EMPTY_NOTE));
  // every field the arch names exists on its model (the schema of the tenant, after § 56's fields)
  const lineArch = `${UI.LINE_LIST}${UI.LINE_CARD}${UI.LINE_FORM}`;
  const names = (a: string) => [...new Set([...a.matchAll(/<field name="(\w+)"/g)].map((m) => m[1]))];
  const dayOnly = String(UI.DAY_BODY).replace(UI.LINE_LIST, "").replace(/<kanban[\s\S]*?<\/kanban>/, "").replace(UI.LINE_FORM, "");
  assert("every field the body names exists on its model", names(lineArch).every((f) => SCHEMA.x_price_day_line.includes(f)) && names(dayOnly).every((f) => SCHEMA.x_price_day.includes(f)) && names(lineArch).length >= 28 && names(dayOnly).length >= 20,
    JSON.stringify([names(lineArch).filter((f) => !SCHEMA.x_price_day_line.includes(f)), names(dayOnly).filter((f) => !SCHEMA.x_price_day.includes(f))]));
  assert("the chart's field keeps Odoo's sanitizer, with the style attribute and the classes as written — and the chart carries no <style> (Odoo would move it into a sandboxed frame, outside the page's colours)", UI.CHART_FIELD.ttype === "html" && UI.CHART_FIELD.sanitize === true && UI.CHART_FIELD.sanitize_tags === true && UI.CHART_FIELD.sanitize_attributes === true && UI.CHART_FIELD.sanitize_style === false && UI.CHART_FIELD.strip_style === false && UI.CHART_FIELD.strip_classes === false);
  const wellFormed = (xml: string): string => {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([\w-]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
      if (m[4]) continue;
      if (!m[1]) stack.push(m[2]);
      else if (stack.pop() !== m[2]) return `</${m[2]}> closes nothing`;
    }
    const left = xml.replace(/<\/?[\w-]+(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g, "");
    return stack.length ? `<${stack.join("> <")}> left open` : left.includes("<") ? `a stray «<»: ${left.slice(left.indexOf("<"), left.indexOf("<") + 60)}` : "";
  };
  assert("the arch is well formed: the body alone, and the whole form with it", wellFormed(String(UI.DAY_BODY)) === "" && wellFormed(now) === "" && wellFormed("<a><b></a>") !== "" && wellFormed(`<a x="1">`) !== "", `${wellFormed(String(UI.DAY_BODY))} / ${wellFormed(now)}`);
}

// ================================================================ the team's guide
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  assert("OPERATING-DAY: how «📊 اليوم» is read — the four numbers, the nine columns in their order, the decision by opening the item", ["«✅ للنشر»", "«❌ لا تنشر»", "«⚠️ سعر شاذ ينتظرك»", "«متوسط ربح الكرتون (المنشور)»", "المعتمد الآن بلا قرار منك"].every((t) => guide.includes(t))
    && /الصنف · \*\*الشراء \(بدون ضريبة\)\*\* · \*\*الشراء شامل\*\*[^\n]*\*\*السوق\*\* · \*\*ربحنا بسعر السوق ±\*\* · \*\*المقترح \(وربحه\)\*\*[^\n]*\*\*فرق المقترح عن السوق ±\*\*[^\n]*\*\*القرار\*\* · \*\*السبب\*\*/.test(guide) && /اضغط سطر الصنف لتفتح تفاصيله/.test(guide) && guide.includes("«ينتظر قرارك»"));
  assert("OPERATING-DAY: how the chart is read — «سعرنا مقابل السوق» with its three marks on one axis, an item without a market price, and «ربح الكرتون» around the zero line", guide.includes(`«${DS.CHART_TITLE_PRICES}»`) && guide.includes(`«${DS.CHART_TITLE_PROFIT}»`) && /■ الشراء شامل الضريبة/.test(guide) && /○ السوق/.test(guide) && /◆ سعرنا/.test(guide)
    && /محور واحد بالريال/.test(guide) && /علامتان فقط و«لا سعر سوق»/.test(guide) && /خط الصفر/.test(guide) && /فوق الخط ربح/.test(guide) && /لا في اللون وحده/.test(guide));
}

done();
