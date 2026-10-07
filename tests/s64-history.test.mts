// § 64 [2] (2026-10-07) — «📈 تاريخ الأسعار»: the page the worker builds (src/price-history.ts).
//
//   One question — «كيف يتحرك سعر السوق مقابل شرائنا؟» — an item a card: the last market price and its change from
//   the last REAL day, the last purchase price, and a small chart of two lines and one dashed reference.
//
//   [1] a day with no price is a GAP in the line: never a zero, never a stroke across it
//   [2] fewer than five days with a market price in the period: «بيانات غير كافية (N أيام)», no chart
//   [3] the change is from the last real day that had a market price — never from an empty day
//   [4] the reference «بدون خسارة» is the system's own number (the engine's priceFloor)
//   [5] the period, the order and the filters; the address's choices
//   [6] the real days alone (no simulation), and nothing of a special request
//   [7] the door: a one-use ticket, then a signed link that ends; nothing written but the ticket's row
//   [8] the page: RTL, 960 px at most, two cards a row on a wide screen, light and dark, no script
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s64-history.test.mts

import { ctx, graph, odooLog, quiet, seed, table } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { world } from "./s62-kit.mts";

const H = await import("../src/price-history.ts");
const PV = await import("../src/quote-preview.ts");
const PE = await import("../src/pricing-engine.ts");
// @ts-ignore — plain .mjs data
const L = await import("../scripts/lib/s64-odoo.mjs");
const worker = (await import("../src/index.ts")).default;

const TODAY = "2026-10-20";
const NOW = Date.parse(`${TODAY}T10:00:00+03:00`);
const day = (back: number) => H.addDays(TODAY, -back);
const row = (back: number, productId: number, market: number, purchase: number, more: Record<string, unknown> = {}) => ({ day: day(back), productId, market, purchase, breakEven: 0, fullCost: 0, pack: "كرتون · 10 كيلو", ...more });
const P = (id: number, name: string, categoryId = 5, category = "فواكه", activeForSale = true) => ({ id, name, categoryId, category, activeForSale });
const Q = H.DEFAULT_QUERY;
const build = (rows: any[], products: any[], q = Q) => H.buildHistory(rows, products, TODAY, q);
const card = (m: any, id: number) => m.cards.find((c: any) => c.productId === id);
const count = (s: string, part: string) => s.split(part).length - 1;
const pathOf = (svg: string, cls: string) => new RegExp(`<path class="${cls}" d="([^"]*)"`).exec(svg)?.[1] ?? "";

// ================================================================ [1]
console.log("\n[1] a day with no price is a gap: never a zero, never a stroke across it");
{
  // the market: 6 days of prices with two empty days in the middle (one a line with price 0, one with no line at all)
  const rows = [row(8, 1, 20, 15), row(7, 1, 21, 15), row(6, 1, 22, 15), row(5, 1, 0, 15), /* day 4: no line */ row(3, 1, 24, 16), row(2, 1, 25, 16), row(0, 1, 26, 0)];
  const c = card(build(rows, [P(1, "رمان وسط")]), 1);
  assert("the period is fourteen days, oldest first, ending today", c.days.length === 14 && c.days[0] === day(13) && c.days[13] === TODAY && H.DEFAULT_PERIOD === 14);
  assert("a price of 0 and a day with no line are both «no price» (null) — never 0", c.market[13 - 5] === null && c.market[13 - 4] === null && c.purchase[13 - 4] === null && c.purchase[13] === null && ![...c.market, ...c.purchase, ...c.reference].includes(0));
  assert("the days that have a price hold it as it is", c.market[13 - 8] === 20 && c.market[13] === 26 && c.purchase[13 - 3] === 16 && c.marketDays === 6);
  assert("the line is cut where the days are empty: two runs, never one stroke across the gap", JSON.stringify(H.runs(c.market).map((r: any) => [r.at, r.values.length])) === JSON.stringify([[5, 3], [10, 2], [13, 1]]));
  const svg = H.chartSvg(c), d = pathOf(svg, "l-market");
  assert("the market's path: one «M» a run of two days or more, a line only between neighbours", count(d, "M") === 2 && count(d, "L") === 3, d);
  assert("the lone last day (no neighbour) is a marker of its own, not the end of a stroke from three days back", count(svg, 'class="m-market"') === 6 && svg.includes(`${H.dayLabel(TODAY)} · سعر السوق 26.00`));
  // where a zero would sit: the bottom of the plot
  const ys = [...svg.matchAll(/class="m-(?:market|purchase)"[^>]*(?:cy|y)="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert("no marker sits on the floor of the chart (a zero drawn would)", ys.length > 0 && ys.every((y) => y < 168 - 24 - 1), JSON.stringify(ys));
  assert("the purchase line breaks at its own empty days too (day 4, and today)", JSON.stringify(H.runs(c.purchase).map((r: any) => [r.at, r.values.length])) === JSON.stringify([[5, 4], [10, 2]]) && count(pathOf(svg, "l-purchase"), "M") === 2);
  assert("a series of one lone day draws no line at all — its marker alone", pathOf(H.chartSvg({ ...c, market: c.market.map((v: any, i: number) => (i === 13 ? v : null)) }), "l-market") === "");
  assert("the page says so in its legend", H.renderHistoryPage(build(rows, [P(1, "رمان وسط")]), "/history/p/1/x", NOW).includes("اليوم بلا سعر فراغ في الخط"));
}

// ================================================================ [2]
console.log("\n[2] fewer than five days with a market price: «بيانات غير كافية», no chart");
{
  const days = (n: number, id: number) => Array.from({ length: n }, (_, i) => row(i, id, 20 + i, 15));
  const m = build([...days(4, 1), ...days(5, 2), row(0, 3, 0, 15), row(1, 3, 0, 15), row(2, 3, 0, 15), row(3, 3, 0, 15), row(4, 3, 0, 15), row(5, 3, 0, 15)], [P(1, "أ"), P(2, "ب"), P(3, "ج")]);
  assert("the guard is five days", H.MIN_DAYS === 5);
  assert("four days: not enough; five: enough", card(m, 1).enough === false && card(m, 1).marketDays === 4 && card(m, 2).enough === true && card(m, 2).marketDays === 5);
  assert("six days of PURCHASE prices and none of the market: not enough (the page asks about the market)", card(m, 3).enough === false && card(m, 3).marketDays === 0 && card(m, 3).lastPurchase.value === 15);
  const html = H.renderHistoryPage(m, "/history/p/1/x", NOW);
  const of = (id: number) => html.slice(html.indexOf(`data-item="${id}"`), html.indexOf("</article>", html.indexOf(`data-item="${id}"`)));
  assert("the card of four days says «بيانات غير كافية (4 أيام)» and draws nothing", of(1).includes("بيانات غير كافية (4 أيام)") && !of(1).includes("<svg class=\"chart\""));
  assert("the card of five days draws its chart and says nothing of the kind", of(2).includes("<svg class=\"chart\"") && !of(2).includes("بيانات غير كافية"));
  assert("the card with no market day says so, and still shows its last purchase price", of(3).includes("بيانات غير كافية (لا يوم)") && of(3).includes("15.00") && !of(3).includes("<svg class=\"chart\""));
  assert("the words by the count", H.insufficientText(1) === "بيانات غير كافية (يوم واحد)" && H.insufficientText(2) === "بيانات غير كافية (يومان)" && H.insufficientText(3) === "بيانات غير كافية (3 أيام)");
  assert("the page counts them above the cards", m.insufficient === 2 && html.includes("3 أصناف · 2 بيانات غير كافية"));
  // the days are counted INSIDE the period: five market days of which two are older than it are three
  const old = build([row(0, 1, 20, 15), row(1, 1, 20, 15), row(2, 1, 20, 15), row(20, 1, 20, 15), row(21, 1, 20, 15)], [P(1, "أ")]);
  assert("a market day older than the period does not count for it (5 days on record, 3 in the 14)", card(old, 1).marketDays === 3 && card(old, 1).enough === false && card(build([row(0, 1, 20, 15), row(1, 1, 20, 15), row(2, 1, 20, 15), row(20, 1, 20, 15), row(21, 1, 20, 15)], [P(1, "أ")], { ...Q, days: 30 }), 1).enough === true);
}

// ================================================================ [3]
console.log("\n[3] the change is from the last REAL day");
{
  const m = build([row(6, 1, 18.5, 15), row(5, 1, 0, 15), row(4, 1, 0, 15), row(0, 1, 20, 15), row(3, 2, 30, 20), row(0, 2, 30, 20), row(0, 3, 12, 9), row(25, 4, 40, 30), row(1, 4, 38, 30), row(2, 5, 0, 9)],
    [P(1, "أ"), P(2, "ب"), P(3, "ج"), P(4, "د"), P(5, "هـ")]);
  const a = card(m, 1);
  assert("today's 20 against 18.5 six days back — the empty days between are not «0»", a.lastMarket.value === 20 && a.prevMarket.day === day(6) && a.prevMarket.value === 18.5 && a.change.amount === 1.5 && a.change.pct === 8.11);
  assert("…written with its direction, in riyals and per cent, and the day it is measured from", H.changeText(a) === `▲ 1.50 ريال (8.11%) عن ${H.dayLabel(day(6))}`);
  assert("the same price as the last real day: «بلا تغيير»", H.changeText(card(m, 2)) === `بلا تغيير عن ${H.dayLabel(day(3))}` && card(m, 2).change.amount === 0);
  assert("the first market price on record has nothing before it", card(m, 3).change === null && H.changeText(card(m, 3)) === "أول سعر سوق في السجل");
  const d = card(m, 4);
  assert("the last real day may be OLDER than the period (25 days back, the period 14): still the one measured from", d.prevMarket.day === day(25) && d.change.amount === -2 && d.change.pct === -5 && H.changeText(d) === `▼ 2.00 ريال (5.00%) عن ${H.dayLabel(day(25))}`);
  assert("no market price in the period: said so, and no change", card(m, 5).lastMarket === null && H.changeText(card(m, 5)) === "لا سعر سوق في الفترة");
  const html = H.renderHistoryPage(m, "/history/p/1/x", NOW);
  assert("a last price that is not today's carries its day", html.includes(`38.00 <small>${H.dayLabel(day(1))}</small>`) && html.includes(`<div class="v">20.00</div>`));
}

// ================================================================ [4]
console.log("\n[4] «بدون خسارة» is the system's own number");
{
  // the engine's floor for a purchase of 15, a waste of 5 % and a carton share of 2.56 (the 7th of October's real line)
  const floor = PE.priceFloor({ purchase: 15, wastePct: 5, opShare: 2.56, vatRatePct: 15, minProfit: 2 })!;
  assert("the engine: full cost 18.31 (15 + 0.75 + 2.56), «بدون خسارة» 21.06 (× 1.15)", floor.fullCost === 18.31 && floor.breakEven === 21.06);
  assert("the line's own «بدون خسارة» is the reference", H.referenceOf({ breakEven: floor.breakEven!, fullCost: floor.fullCost }) === 21.06);
  assert("a line that holds the full cost alone gets the engine's same step from it (whole halalas × 1.15)", H.referenceOf({ breakEven: 0, fullCost: 18.31 }) === floor.breakEven && H.referenceOf({ breakEven: 0, fullCost: 24.61 }) === PE.priceFloor({ purchase: 21, wastePct: 5, opShare: 2.56, vatRatePct: 15, minProfit: 2 })!.breakEven);
  assert("a line with neither has no reference", H.referenceOf({ breakEven: 0, fullCost: 0 }) === 0);
  const c = card(build([row(2, 1, 20, 15, { breakEven: 21.06, fullCost: 18.31 }), row(1, 1, 20, 0, { breakEven: 21.06 }), row(0, 1, 22, 21, { fullCost: 24.61 })], [P(1, "رمان")]), 1);
  assert("it stands where there is a purchase to stand on, and nowhere else", c.reference[11] === 21.06 && c.reference[12] === null && c.reference[13] === 28.3 && c.lastReference.value === 28.3);
  const svg = H.chartSvg({ ...c, enough: true });
  assert("drawn dashed, apart from the two lines; a lone day of it is a short dash of its own", count(svg, 'class="l-ref"') === 2 && H.renderHistoryPage(build([], []), "/history/p/1/x", NOW).includes("stroke-dasharray:4 4"));
  assert("the legend names it by the system's formula", H.renderHistoryPage(build([], []), "/history/p/1/x", NOW).includes("<b>بدون خسارة</b>: (الشراء + التالف + حصة التشغيل) × 1.15"));
}

// ================================================================ [5]
console.log("\n[5] the period, the order, the filters");
{
  const prods = [P(1, "موز", 5, "فواكه"), P(2, "خيار", 6, "خضار"), P(3, "تفاح", 5, "فواكه"), P(4, "نعناع", 0, "", true), P(5, "أفوكادو", 5, "فواكه", false)];
  const rows = [row(1, 1, 20, 15), row(0, 1, 21, 15), row(1, 2, 10, 7), row(0, 2, 13, 7), row(1, 3, 50, 40), row(0, 3, 49, 40), row(0, 4, 5, 3), row(1, 5, 30, 20), row(0, 5, 60, 20), row(40, 1, 19, 15), row(70, 2, 9, 7)];
  const names = (q: any) => build(rows, prods, q).cards.map((c: any) => c.name);
  assert("opens on: 14 days, the biggest market move first, every category, the items active for sale alone", JSON.stringify(Q) === JSON.stringify({ days: 14, sort: "move", category: null, activeOnly: true }) && JSON.stringify(H.parseQuery(new URLSearchParams(""))) === JSON.stringify(Q));
  assert("the biggest move first, up or down (30 % · 5 % · 2 %), an item with no change last", JSON.stringify(names(Q)) === JSON.stringify(["خيار", "موز", "تفاح", "نعناع"]), JSON.stringify(names(Q)));
  assert("by the name", JSON.stringify(names({ ...Q, sort: "name" })) === JSON.stringify(["تفاح", "خيار", "موز", "نعناع"]));
  assert("by the category, then the name («بلا فئة» for an item with none)", JSON.stringify(build(rows, prods, { ...Q, sort: "cat" }).cards.map((c: any) => `${c.category}/${c.name}`)) === JSON.stringify(["بلا فئة/نعناع", "خضار/خيار", "فواكه/تفاح", "فواكه/موز"]) && H.NO_CATEGORY === "بلا فئة");
  assert("a category alone", JSON.stringify(names({ ...Q, category: 5 })) === JSON.stringify(["موز", "تفاح"]) && JSON.stringify(names({ ...Q, category: 0 })) === JSON.stringify(["نعناع"]));
  assert("the categories offered are those of the items shown, with their counts — the same whichever one is chosen", JSON.stringify(build(rows, prods, { ...Q, category: 6 }).categories) === JSON.stringify([{ id: 0, name: "بلا فئة", count: 1 }, { id: 6, name: "خضار", count: 1 }, { id: 5, name: "فواكه", count: 2 }]));
  assert("«النشطة للبيع فقط» off: the item that is not active for sale is there (and leads: 100 %)", JSON.stringify(names({ ...Q, activeOnly: false })) === JSON.stringify(["أفوكادو", "خيار", "موز", "تفاح", "نعناع"]));
  const c30 = card(build(rows, prods, { ...Q, days: 30 }), 1), c90 = card(build(rows, prods, { ...Q, days: 90 }), 2);
  assert("30 and 90 days: the period's own days", H.PERIODS.join(",") === "14,30,90" && c30.days.length === 30 && c30.days[0] === day(29) && c90.days.length === 90 && c90.market[90 - 1 - 70] === 9 && card(build(rows, prods, { ...Q, days: 30 }), 1).marketDays === 2 && card(build(rows, prods, { ...Q, days: 90 }), 1).marketDays === 3);
  assert("the address's choices: read, and written back (the defaults left out)", JSON.stringify(H.parseQuery(new URLSearchParams("d=90&s=cat&c=6&all=1"))) === JSON.stringify({ days: 90, sort: "cat", category: 6, activeOnly: false }) && H.queryString({ days: 90, sort: "cat", category: 6, activeOnly: false }) === "?d=90&s=cat&c=6&all=1" && H.queryString(Q) === "");
  assert("anything unknown in the address is the default", JSON.stringify(H.parseQuery(new URLSearchParams("d=7&s=profit&c=abc&all=yes"))) === JSON.stringify(Q) && H.parseQuery(new URLSearchParams("d=30")).days === 30);
  const html = H.renderHistoryPage(build(rows, prods, { ...Q, days: 30, category: 5 }), "/history/p/9/sig", NOW);
  assert("every control is a link that keeps the other choices", html.includes(`href="/history/p/9/sig?d=90&amp;c=5"`) && html.includes(`href="/history/p/9/sig?d=30&amp;s=name&amp;c=5"`) && html.includes(`href="/history/p/9/sig?d=30"`) && html.includes(`href="/history/p/9/sig?d=30&amp;c=5&amp;all=1"`));
  assert("the choice in force is marked", html.includes(`<a class="chip on" href="/history/p/9/sig?d=30&amp;c=5" aria-current="true">30 يوماً</a>`) && html.includes(`aria-current="true">✓ النشطة للبيع فقط</a>`) && html.includes(`aria-current="true">فواكه (2)</a>`));
  const ahead = build([row(-1, 1, 99, 15, { pack: "عبوة الغد" }), row(0, 1, 21, 15)], prods).cards[0];
  assert("a line dated after today gives the card nothing — neither a price nor its pack", ahead.lastMarket.value === 21 && ahead.pack === "كرتون · 10 كيلو" && !JSON.stringify(ahead).includes("99"));
}

// ================================================================ [6]
console.log("\n[6] the real days alone, and nothing of a special request");
let env: any;
{
  env = world(`${TODAY} 10:00`);
  for (const [id, name, categ, active] of [[301, "رمان وسط", 5, true], [302, "موز أمريكي", 5, true], [303, "خيار", 6, false], [304, "صنف خاص", false, false]] as Array<[number, string, number | false, boolean]>) {
    seed("product.template", { id, name: `[UTAK-X-${id}] ${name}`, categ_id: categ, x_is_active_for_sale: active, active: true });
    seed("x_product_packaging", { id: id * 10, x_name: "كرتون · 14 كيلو", x_product_tmpl_id: id, x_is_default: true });
  }
  const realDay = (d: string) => seed("x_price_day", { x_date: d, x_state: "published", x_utak_simulation: false });
  const line = (dayId: number, d: string, product: number, market: number, purchase: number, more: Record<string, unknown> = {}) => seed("x_price_day_line", { x_day_id: dayId, x_day_date: d, x_product_tmpl_id: product, x_market_price: market, x_cost_price: purchase, x_break_even: 0, x_full_cost: 0, x_packaging_id: product * 10, x_utak_simulation: false, ...more });
  for (let b = 6; b >= 0; b--) { const d = realDay(day(b)); line(d, day(b), 301, b === 3 ? 0 : 20 + b, 15, { x_break_even: 21.06, x_full_cost: 18.31 }); if (b < 2) line(d, day(b), 302, 70 + b, 60); line(d, day(b), 303, 9, 6); }
  // a simulated day (its lines not flagged themselves), a simulated line on a real day, and a day older than 90 days
  const sim = seed("x_price_day", { x_date: day(1), x_state: "published", x_utak_simulation: true });
  line(sim, day(1), 302, 999, 999);
  line(realDay(day(8)), day(8), 302, 888, 888, { x_utak_simulation: true });
  line(realDay(day(95)), day(95), 301, 777, 777);
  // a special request's own records: an observation flagged «خاص», and the request's line — on an item of no day's line
  seed("x_price_offer", { x_product_tmpl_id: 304, x_price: 55, x_date: TODAY, x_special: true, x_special_quote_id: 1, x_role: "market", x_source_partner_id: 880 });
  seed("x_special_quote_line", { x_quote_id: 1, x_product_tmpl_id: 304, x_qty: 1, x_final_price: 60 });
  odooLog.length = 0;
  const data = await quiet(() => H.readHistory(env, TODAY));
  const m = H.buildHistory(data.rows, data.products, TODAY, { ...Q, activeOnly: false });
  assert("the lines are read under the scope of Odoo's «🔢 جدول الأسعار»: neither a simulated line nor a simulated day", JSON.stringify(H.realDaysDomain("a", "b").slice(0, 2)) === JSON.stringify([["x_utak_simulation", "=", false], ["x_day_id.x_utak_simulation", "=", false]]));
  assert("a simulated day's price (999) and a simulated line's (888) are nowhere", !data.rows.some((r: any) => r.market === 999 || r.market === 888) && card(m, 302).marketDays === 2 && card(m, 302).lastMarket.value === 70);
  assert("a day older than ninety days is not read", H.LOOKBACK_DAYS === 90 && !data.rows.some((r: any) => r.market === 777));
  assert("the special request's item has no card: its observation and its line are no day's line", !card(m, 304) && !JSON.stringify(m).includes("صنف خاص") && m.cards.length === 3);
  const models = [...new Set(odooLog.map((l) => l.model))];
  assert("three reads — the day's lines, their items, the items' categories — and nothing else (no offer, no request, no write)", JSON.stringify(models) === JSON.stringify(["x_price_day_line", "product.template", "product.category"]) && odooLog.length === 3 && odooLog.every((l) => l.method === "search_read"), JSON.stringify(odooLog.map((l) => `${l.model}.${l.method}`)));
  assert("the item's name without its reference, its category's own name, its pack, «نشط للبيع»", card(m, 301).name === "رمان وسط" && card(m, 301).category === "فواكه" && card(m, 301).pack === "كرتون · 14 كيلو" && card(m, 303).category === "خضار" && data.products.find((p: any) => p.id === 303).activeForSale === false);
  assert("the real line's numbers as they are: six market days of seven (one empty), «بدون خسارة» 21.06", card(m, 301).marketDays === 6 && card(m, 301).enough && card(m, 301).lastReference.value === 21.06 && card(m, 301).market[13 - 3] === null);
  assert("the schema gate rejected no field the page reads", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [7]
console.log("\n[7] the door: a one-use ticket, then a signed link that ends");
{
  const T1 = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", T2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", T3 = "ffffffff-0000-4000-8000-aaaaaaaaaaaa", T4 = "11111111-2222-4333-8444-555555555555";
  const odooAt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  const ticket = (name: string, model: string, id: number, more: Record<string, unknown> = {}) => seed("x_preview_ticket", { x_name: name, x_model: model, x_res_id: id, x_used: false, x_active: true, create_date: odooAt(NOW - 3000), ...more });
  const get = (path: string, now = NOW) => quiet(() => H.handleHistory(env, new URL(`https://w.test${path}`), now));
  const writesOf = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method));
  const tid = ticket(T1, "x_price_day_line", 0);
  odooLog.length = 0; graph.length = 0;
  const hop = await get(`/history/t/${T1}`);
  const where = hop.headers.get("Location") ?? "";
  const m = /^\/history\/p\/(\d+)\/([a-f0-9]{16})$/.exec(where);
  assert("the ticket of Odoo's menu answers 302 to the worker's own link: an expiry and a signature, nothing else", hop.status === 302 && !!m && hop.headers.get("Cache-Control") === "no-store" && !where.includes("ADM") && !where.includes("token"), where);
  assert("the link is good for fifteen minutes, signed for THIS expiry under the worker's secret", !!m && Number(m[1]) === NOW + PV.LINK_TTL_MS && PV.LINK_TTL_MS === 15 * 60_000 && m[2] === await H.historySignature("ADM", NOW + PV.LINK_TTL_MS));
  assert("the ticket is burnt and archived before the link is given — its own row is the one thing written", table("x_preview_ticket").get(tid)!.x_used === true && table("x_preview_ticket").get(tid)!.x_active === false && writesOf().length === 1 && JSON.stringify(writesOf()[0].body.vals) === '{"x_used":true,"x_active":false}');
  odooLog.length = 0;
  const page = await get(where);
  const html = await page.text();
  assert("the link answers the page: HTML, never cached, never indexed, no script allowed in it", page.status === 200 && page.headers.get("Content-Type") === "text/html; charset=utf-8" && page.headers.get("Cache-Control") === "private, no-store" && page.headers.get("X-Robots-Tag") === "noindex, nofollow"
    && String(page.headers.get("Content-Security-Policy")).startsWith("default-src 'none'") && !String(page.headers.get("Content-Security-Policy")).includes("script"));
  assert("it is the page of the real days: its question, the two items active for sale, the day's numbers", html.includes(`<h1>${H.HISTORY_TITLE}</h1>`) && H.HISTORY_TITLE === "كيف يتحرك سعر السوق مقابل شرائنا؟" && html.includes("رمان وسط") && html.includes("موز أمريكي") && html.includes('data-item="301"') && !html.includes('data-item="303"') && html.includes("20.00") && html.includes("بدون خسارة 21.06"));
  assert("nothing is written to show it, and nothing is sent", writesOf().length === 0 && graph.length === 0);
  assert("its choices are the address's: «النشطة للبيع فقط» off shows the third item", (await (await get(`${where}?all=1&s=name`)).text()).includes('data-item="303"'));
  assert("the link opens again while it lasts (a reload, a choice)", (await get(where, NOW + PV.LINK_TTL_MS - 1000)).status === 200);
  const late = await get(where, NOW + PV.LINK_TTL_MS + 1);
  assert("…and ends: 410, told to open it from Odoo again — no number of the page in it", late.status === 410 && (await late.text()).includes("📈 تاريخ الأسعار") && !(await get(where, NOW + PV.LINK_TTL_MS + 1).then((r) => r.text())).includes("21.06"));
  assert("a signature that is not the worker's, or one of another expiry: not found", (await get(`/history/p/${m![1]}/${"0".repeat(16)}`)).status === 404 && (await get(`/history/p/${Number(m![1]) + 60_000}/${m![2]}`)).status === 404);
  assert("a preview's signature of the same expiry is not the page's", (await get(`/history/p/${m![1]}/${await PV.previewSignature("ADM", "sq", 1, Number(m![1]))}`)).status === 404);
  const again = await get(`/history/t/${T1}`);
  assert("the ticket opens once: its second use is told «استُعمل» (410) though it is archived, and gives no link", again.status === 410 && !again.headers.get("Location") && (await again.text()).includes("هذا الرابط استُعمل"));
  ticket(T2, "x_price_day_line", 0, { create_date: odooAt(NOW - PV.TICKET_TTL_MS - 1000) });
  assert("a ticket older than five minutes is dead, and stays unburnt", (await get(`/history/t/${T2}`)).status === 410 && [...table("x_preview_ticket").values()].find((t: any) => t.x_name === T2)!.x_used === false);
  // each door takes its own tickets alone
  const pvT = ticket(T3, "sale.order", 5), hsT = ticket(T4, "x_price_day_line", 0);
  odooLog.length = 0;
  assert("a preview's ticket does not open the page (404), and is not burnt by the try", (await get(`/history/t/${T3}`)).status === 404 && table("x_preview_ticket").get(pvT)!.x_used === false && writesOf().length === 0);
  assert("the page's ticket does not open a preview (404), and is not burnt by the try", (await quiet(() => PV.handlePreview(env, `/preview/t/${T4}`, NOW))).status === 404 && table("x_preview_ticket").get(hsT)!.x_used === false);
  assert("an unknown ticket, and anything that is not a ticket: not found — Odoo is not even asked for the second", (await get("/history/t/99999999-0000-4000-8000-000000000000")).status === 404 && (odooLog.length = 0, (await get("/history/t/abc")).status === 404) && odooLog.length === 0 && (await get("/history/x")).status === 404);
  const bare = { ...env, ADMIN_TOKEN: "" };
  assert("a worker with no secret signs nothing and serves nothing", (await quiet(() => H.handleHistory(bare, new URL(`https://w.test/history/t/${T4}`), NOW))).status === 500 && table("x_preview_ticket").get(hsT)!.x_used === false && (await quiet(() => H.handleHistory(bare, new URL(`https://w.test${where}`), NOW))).status === 404);
  // through the worker's own router
  const viaRoute = await quiet(() => worker.fetch(new Request(`https://w.test/history/t/${T4}`), env, ctx));
  const to = viaRoute.headers.get("Location") ?? "";
  assert("GET /history/t/<ticket> on the worker: the 302 to its link, then the page", viaRoute.status === 302 && /^\/history\/p\/\d+\/[a-f0-9]{16}$/.test(to) && (await (await quiet(() => worker.fetch(new Request(`https://w.test${to}?d=30`), env, ctx))).text()).includes("آخر 30 يوماً"));
  assert("…POST is not the page's", (await quiet(() => worker.fetch(new Request(`https://w.test${to}`, { method: "POST" }), env, ctx))).status !== 200);
  assert("the menu's action in Odoo: a random ticket of the database for the page, then the prod worker's /history/t/<ticket> — no token in it", L.HISTORY_ACTION.code.includes("gen_random_uuid()") && L.HISTORY_ACTION.code.includes(`'x_model': '${H.HISTORY_MODEL}'`) && L.HISTORY_ACTION.code.includes(`'url': 'https://${L.PROD_HOST}${L.HISTORY_PATH}' + ticket`)
    && L.HISTORY_ACTION.code.includes("'target': 'new'") && !/token|secret|ADM/i.test(L.HISTORY_ACTION.code) && L.HISTORY_PATH === `${H.HISTORY_PREFIX}t/` && L.HISTORY_TICKET_MODEL === H.HISTORY_MODEL);
  assert("Odoo's own chart stays, as «🔢 جدول الأسعار», the pivot first, under a menu of its own", L.HISTORY_WINDOW_NAME === "🔢 جدول الأسعار" && L.HISTORY_WINDOW_MODE.split(",")[0] === "pivot" && L.HISTORY_WINDOW_ID === 1046 && L.HISTORY_MENU_ID === 588 && L.HISTORY_TABLE_MENU.name === "🔢 جدول الأسعار");
}

// ================================================================ [8]
console.log("\n[8] the page");
{
  const rows = Array.from({ length: 6 }, (_, i) => row(i, 1, 20 + i * 0.5, 15, { breakEven: 21.06 }));
  const html = H.renderHistoryPage(build(rows, [P(1, 'رمان <وسط> & "كبير"')]), "/history/p/1/x", NOW);
  assert("Arabic, right to left, sized for a phone", html.includes('<html lang="ar" dir="rtl">') && html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert("960 px at most, centred; one card a row, two from 720 px; nothing scrolls sideways", H.MAX_WIDTH_PX === 960 && html.includes(".wrap{max-width:960px;margin:0 auto;") && html.includes(".grid2{display:grid;grid-template-columns:minmax(0,1fr);") && html.includes("@media (min-width:720px){.grid2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}") && html.includes("overflow-x:hidden") && html.includes(".chart{display:block;width:100%;height:auto;"));
  assert("light and dark, each with its own colours (the two lines' too)", html.includes("@media (prefers-color-scheme: dark){:root{") && html.includes("--market:#eb6834;--purchase:#2a78d6") && html.includes("--market:#d95926;--purchase:#3987e5") && html.includes('<meta name="color-scheme" content="light dark">'));
  assert("no script and no library: the page is HTML, CSS and SVG", !/<script/i.test(html) && !/\son[a-z]+=/i.test(html) && count(html, "<link ") === 3 && [...html.matchAll(/<link [^>]*href="([^"]+)"/g)].every((m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(m[1])));
  assert("two lines at most and one reference in a chart", count(html, 'class="l-market"') === 1 && count(html, 'class="l-purchase"') === 1 && count(html, 'class="l-ref"') === 1);
  assert("the two lines are told apart without colour: a circle a market price, a square a purchase price — in the chart and in the key", count(html, '<circle class="m-market"') === 6 && count(html, '<rect class="m-purchase"') === 6);
  assert("every number has two decimals", html.includes("22.50") && html.includes("15.00") && H.money(20) === "20.00" && H.money(20.5) === "20.50");
  assert("an item's name is written as text, never as markup", html.includes("رمان &lt;وسط&gt; &amp; &quot;كبير&quot;") && !html.includes("<وسط>"));
  assert("a chart says in words what it shows, and every card has its table", html.includes('role="img" aria-label="رمان &lt;وسط&gt; &amp; &quot;كبير&quot;: سعر السوق وسعر شرائنا وخط «بدون خسارة»') && count(html, "<details><summary>الجدول</summary>") === 1);
  assert("on ninety days a marker stands only where a line cannot show the price (a lone day) and on the last", (() => { const c = card(build([row(80, 1, 20, 0), row(5, 1, 21, 0), row(4, 1, 22, 0), row(3, 1, 23, 0), row(2, 1, 24, 0), row(1, 1, 25, 0)], [P(1, "أ")], { ...Q, days: 90 }), 1); return count(H.chartSvg(c), '<circle class="m-market"') === 2; })());
  assert("no card: the page says so", H.renderHistoryPage(build([], []), "/history/p/1/x", NOW).includes("لا أسعار في هذه الفترة بهذه الخيارات."));
  assert("the foot says where it is opened from, and when the link ends (Riyadh)", html.includes("💲 التسعير ← 📈 تاريخ الأسعار") && html.includes("صالح حتى 10:00"));
}

done();
