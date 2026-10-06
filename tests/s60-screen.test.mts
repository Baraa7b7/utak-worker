// § 60 أ (2026-10-06) — «📍 اليوم»: the chart «سعرنا مقابل السوق» keeps its design, its shapes and its
// order, and gains the break-even, what moved since the last day with a number, and the carton's
// contribution beside the profit. And Baraa's amendment: the chart's width.
//
//   [1] the break-even: a red ┃ on each row at x_break_even, a light pink zone on the axis before it,
//       its name in the key and «┃ التعادل 20.40» under the row — Odoo's own classes, no <style>
//   [2] what moved since the last day that carries a number: «▲ +3.00» / «▼ −2.00» beside the market's
//       value and the purchase's; no earlier number, or no move: nothing; a simulation's day never
//   [3] the carton's contribution = sale ÷ 1.15 − purchase − waste, BESIDE the profit («▲ +1.13 بسعر
//       السوق · مساهمة +3.12»), the line under the key, and x_contribution on the line — the engine, the
//       proposed decision and the review's message are what they were
//   [4] the design stays: the three shapes, their order, the axis; the additions alone are new
//   [5] the width: «سعرنا مقابل السوق» 960px at most; «ربح الكرتون» beside it from 1400px (xxl), under it below
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-screen.test.mts

import { readFileSync } from "node:fs";
import { openWindow, quiet, rows, seed, table } from "./wa-harness.mts";
import { C1_PHONE, DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const RV = await import("../src/price-review.ts");
const DS = await import("../src/day-screen.ts");
const DI = await import("../src/day-insight.ts");
const DT = await import("../src/day-tabs.ts");

const FX = JSON.parse(readFileSync(new URL("./fixtures-s56-day54.json", import.meta.url), "utf8"));
const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };
const BEFORE = "2026-10-02", OLDER = "2026-09-30";

/** The tenant on 2026-10-05 (the world of § 56): the day's cost 496.52 over 250 cartons (a share of 1.99), waste 5 %, a minimum profit of 2. */
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
/** A real day before this one, with the numbers its lines kept. */
function past(day: string, lines: Array<[product: number, packaging: number, purchase: number, market: number]>, extra: Record<string, unknown> = {}): number {
  const d = seed("x_price_day", { x_date: day, x_state: "missed", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, ...extra });
  for (const [p, k, purchase, m] of lines) seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: purchase, x_market_price: m, x_sale_price: 0, x_excluded: false, x_utak_simulation: false });
  return d;
}
const engine = (env: any) => quiet(() => PR.refreshPriceDay(env, { force: true }));
/** The day's lines as the worker reads them (each item with its name). */
const linesOf = (env: any): Promise<any[]> => quiet(() => PR.readLines(env, dayOf().id));
const zone = (row: string) => { const m = /class="utak-loss-zone bg-danger bg-opacity-25" style="position:absolute;left:0;width:([\d.]+)%;top:50%;height:10px;margin-top:-5px"/.exec(row); return m ? Number(m[1]) : null; };
const chart = () => String(dayOf().x_chart_html);
const rowsOf = (html: string) => html.split(`<div class="utak-row `).slice(1).map((r) => r.split(`<div class="utak-axis `)[0]);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const at = (row: string, cls: string) => { const m = new RegExp(`<div class="${cls}[^"]*"(?: title="([^"]*)")? style="[^"]*?left:([\\d.]+)%(?:;width:([\\d.]+)%)?`).exec(row); return m ? { title: m[1] ?? "", left: Number(m[2]), width: m[3] === undefined ? null : Number(m[3]) } : null; };
const markLeft = (row: string, kind: string) => Number(new RegExp(`<div class="utak-m-${kind}" title="[^"]*" style="[^"]*?left:([\\d.]+)%`).exec(row)?.[1]);

// ================================================================ [1] the break-even
console.log("\n[1] the break-even: a red ┃ on each row, a light pink zone before it, its name in the key, its value under the row");
{
  const env = world(); prices();
  await engine(env);
  const html = chart(), rs = rowsOf(html);
  const evens = [1, 2, 3, 4].map((p) => Number(lineFor(p).x_break_even));
  assert("the engine's own «أقل سعر بيع بدون خسارة» of the four lines: 68.70 / 20.40 / 16.78 / 28.85", JSON.stringify(evens) === JSON.stringify([68.7, 20.4, 16.78, 28.85]), JSON.stringify(evens));
  const axis = DS.chartAxis(DS.screenRows(await linesOf(env), "market", DAY, "draft").flatMap((r: any) => [r.purchaseVat, r.market, r.ours, r.breakEven]))!;
  assert("each row carries ONE red ┃ at its break-even on the axis, named in its title", rs.length === 4 && rs.every((r, i) => { const e = at(r, "utak-even bg-danger"); return !!e && r.split('class="utak-even ').length === 2 && e.left === DS.axisAt(axis, evens[i]) && e.title === `التعادل ${evens[i].toFixed(2)}`; }), rs.map((r) => JSON.stringify(at(r, "utak-even bg-danger"))).join(" "));
  assert("…a thin bar the row's height (3px wide, centred on the price), drawn UNDER the three shapes", rs.every((r) => /class="utak-even bg-danger" title="[^"]*" style="position:absolute;left:[\d.]+%;top:1px;bottom:1px;width:3px;margin-left:-1\.5px"/.test(r) && r.indexOf('class="utak-even ') < r.indexOf('class="utak-m-')));
  assert("…and before it a light pink zone on the axis, from the axis' start to the break-even, behind everything", rs.every((r, i) => zone(r) === DS.axisAt(axis, evens[i]) && r.split('class="utak-loss-zone ').length === 2 && r.indexOf('class="utak-loss-zone ') < r.indexOf('class="text-muted" style="position:absolute;left:0;right:0')), rs.map((r) => String(zone(r))).join(" "));
  const key = html.slice(html.indexOf('<div class="utak-key '), html.indexOf('<div class="utak-row '));
  assert("the key names it: «┃ التعادل (أقل سعر بدون خسارة)», the ┃ in red, after the three shapes and before «▲ ربح · ▼ خسارة»", key.includes(`<span class="text-nowrap"><span class="text-danger fw-bold">┃</span> ${DS.EVEN_KEY_TEXT}</span>`) && DS.EVEN_KEY_TEXT === "التعادل (أقل سعر بدون خسارة)"
    && key.indexOf("سعرنا") < key.indexOf("┃") && key.indexOf("┃") < key.indexOf("▲ ربح · ▼ خسارة"), text(key));
  assert("under the row, after its three values: «┃ التعادل 20.40» (the pomegranate), «┃ التعادل 68.70» (the banana)", text(rs[1]).endsWith("┃ التعادل 20.40") && text(rs[0]).endsWith("┃ التعادل 68.70") && rs.every((r) => r.indexOf("utak-even-value") > r.indexOf("سعرنا")), text(rs[1]));
  assert("the colours are Odoo's own classes (bg-danger, bg-opacity-25, text-danger) — no colour written by hand, no <style>", !/<style/i.test(html) && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(html) && html.includes("bg-danger bg-opacity-25") && html.includes("text-danger fw-bold"));
  // Baraa's own price under the break-even, and no market: the break-even stands past the other marks — the axis reaches it
  const low = DS.screenRows([{ ...FX.lines[0], x_market_price: 0, x_decision: "edit", x_manual_price: 65, x_manual_for: "edit", x_sale_price: 65, x_status: "manual" }], "market", FX.day.x_date, "draft");
  const lowAxis = DS.chartAxis(low.flatMap((r: any) => [r.purchaseVat, r.market, r.ours, r.breakEven]))!;
  assert("a break-even past every other mark (his own price under it, no market) is still ON the axis, not pinned to its end", low[0].ours === 65 && low[0].breakEven > 65 && lowAxis.hi >= low[0].breakEven && (at(rowsOf(DS.dayChartHtml(low))[0], "utak-even bg-danger")?.left ?? 100) === DS.axisAt(lowAxis, low[0].breakEven) && DS.axisAt(lowAxis, low[0].breakEven) > DS.axisAt(lowAxis, 65), JSON.stringify([low[0].ours, low[0].breakEven, lowAxis]));
  assert("a row without a break-even (no purchase price): no ┃, no zone, no value", (() => { const r = DS.screenRows([{ ...FX.lines[0], x_cost_price: 0, x_break_even: 0, x_full_cost: 0, x_suggested_price: 0 }], "market", FX.day.x_date, "draft"); const h = DS.dayChartHtml(r); return !h.includes("utak-even") && !h.includes("utak-loss-zone") && h.includes(DS.EVEN_KEY_TEXT); })());
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [2] what moved
console.log("\n[2] what moved since the last day that carries a number");
{
  const env = world();
  // 10-02: banana 52 / 67, medium 15 / 22, small 12 / 0, large — no line; 09-30: large 20 / — (a purchase, no market); a simulation's day (the nearest) says otherwise
  past(BEFORE, [[1, 11, 52, 67], [2, 21, 15, 22], [3, 31, 12, 0]]);
  past(OLDER, [[4, 41, 20, 0], [1, 11, 40, 40]]);
  past("2026-10-02", [[1, 11, 1, 1], [2, 21, 1, 1], [4, 41, 1, 1]], { x_utak_simulation: true });
  prices();
  await engine(env);
  const rs = rowsOf(chart());
  assert("the banana: the purchase with the VAT 63.25 against 59.80 «▲ +3.45», the market 70 against 67 «▲ +3.00»", text(rs[0]).includes("الشراء شامل 63.25 ▲ +3.45") && text(rs[0]).includes("السوق 70.00 ▲ +3.00"), text(rs[0]));
  assert("the medium pomegranate: the purchase did not move (nothing beside it), the market 20 against 22 «▼ −2.00»", /الشراء شامل 17\.25 ○? ?السوق|الشراء شامل 17\.25 السوق/.test(text(rs[1]).replace(/\s+/g, " ")) && text(rs[1]).includes("السوق 20.00 ▼ −2.00") && rs[1].split("utak-move").length === 2, text(rs[1]));
  assert("the small one: no market today, the purchase as it was — nothing at all", !rs[2].includes("utak-move"), text(rs[2]));
  assert("the large one: its last purchase is two days older (09-30): 25.30 against 23.00 «▲ +2.30» — and its market has no earlier number at all: nothing beside it", text(rs[3]).includes("الشراء شامل 25.30 ▲ +2.30") && /السوق 28\.00 (?!▲|▼)/.test(text(rs[3])) && rs[3].split("utak-move").length === 2, text(rs[3]));
  assert("the move stands in the row's values as a number read left to right", rs[0].includes(`<span class="utak-move small" dir="ltr">▲ +3.45</span>`) && rs[1].includes(`<span class="utak-move small" dir="ltr">▼ −2.00</span>`));
  assert("a simulation's day is never the last number (its 1 / 1 moved nothing)", !chart().includes("+62.10") && !chart().includes("+69.00"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); prices();
  await engine(env);
  assert("no earlier day at all: no «▲» and no «▼» beside any value", !chart().includes("utak-move"));
  const last = DT.lastNumbers([
    { day: "2026-10-01", key: "1:11", name: "موز", purchase: 50, market: 0, sale: 0, profit: 0, margin: 0, priced: false },
    { day: "2026-09-29", key: "1:11", name: "موز", purchase: 45, market: 66, sale: 0, profit: 0, margin: 0, priced: false },
  ]);
  assert("the last number of each kind by itself: the purchase of 10-01, the market of 09-29 (10-01 carried none)", JSON.stringify(last.get("1:11")) === JSON.stringify({ market: 66, purchase: 50 }), JSON.stringify([...last]));
}

// ================================================================ [3] the contribution
console.log("\n[3] the carton's contribution beside the profit, and on the line");
{
  const env = world(); prices();
  await engine(env);
  const rs = rowsOf(chart());
  assert("contributionAt = sale ÷ 1.15 − purchase − waste: the banana at 70 → 60.87 − 55 − 2.75 = 3.12; no purchase or no price: none", DI.contributionAt({ purchase: 55, waste: 2.75, vatPct: 15 }, 70) === 3.12 && DI.contributionAt({ purchase: 0, waste: 0, vatPct: 15 }, 70) === null && DI.contributionAt({ purchase: 55, waste: 2.75, vatPct: 15 }, 0) === null && DI.contributionAt({ purchase: 10, waste: 0.5, vatPct: null }, 12) === 1.5);
  assert("the banana's row: «▲ +1.13 بسعر السوق · مساهمة +3.12» — the profit as it was, the contribution beside it", text(rs[0]).includes("▲ +1.13 بسعر السوق · مساهمة +3.12") && /class="utak-profit fw-bold text-success">▲ <span dir="ltr">\+1\.13<\/span> <span class="fw-normal">بسعر السوق<\/span> <span class="utak-contribution fw-normal text-muted">· مساهمة <span dir="ltr">\+3\.12<\/span><\/span><\/div>/.test(rs[0]), text(rs[0]));
  assert("the medium pomegranate: a loss «▼ −0.35 بسعر السوق» and a contribution above zero «مساهمة +1.64»", text(rs[1]).includes("▼ −0.35 بسعر السوق · مساهمة +1.64"), text(rs[1]));
  assert("the small one (no market): both at the suggested price — «▲ +2.37 بالمقترح · مساهمة +4.36»", text(rs[2]).includes("▲ +2.37 بالمقترح · مساهمة +4.36"), text(rs[2]));
  assert("the contribution is the profit plus the carton share (1.99), on every row", DS.screenRows(await linesOf(env), "market", DAY, "draft").every((r: any) => Math.abs(r.contribution - r.profit - 1.99) < 0.011));
  const html = chart();
  assert("under the key, one line: «الربح = بعد حصة التشغيل على هدف 250 كرتون · المساهمة = ما يبقى من الكرتون لتغطية التشغيل»", html.includes(`<div class="utak-key-note small text-muted mb-2">الربح = بعد حصة التشغيل على هدف 250 كرتون · المساهمة = ما يبقى من الكرتون لتغطية التشغيل</div>`) && html.indexOf("utak-key-note") > html.indexOf("utak-key ") && html.indexOf("utak-key-note") < html.indexOf("utak-row "));
  assert("…the cartons are the ones the day's cost was divided by: an actual average says so; none known: no number", DS.chartKeyNote({ cartons: 180.5, basis: "actual" }).startsWith("الربح = بعد حصة التشغيل على متوسط 180.5 كرتون مسلَّم يومياً ·") && DS.chartKeyNote().startsWith("الربح = بعد حصة التشغيل · المساهمة"));
  const stored = [1, 2, 3, 4].map((p) => lineFor(p).x_contribution);
  assert("x_contribution on each line, at the price the board reads (the market price here): 3.12 / 1.64 / 0 (no market) / 1.25", JSON.stringify(stored) === JSON.stringify([3.12, 1.64, 0, 1.25]) && (PR.SCREEN_LINE_FIELDS as readonly string[]).includes("x_contribution") && PR.LINE_FIELDS.includes("x_contribution"), JSON.stringify(stored));
  // Baraa decides the banana at 72: the board's sale becomes 72 → 62.61 − 55 − 2.75 = 4.86
  table("x_price_day_line").get(lineFor(1).id)!.x_decision = "edit"; table("x_price_day_line").get(lineFor(1).id)!.x_manual_price = 72;
  await engine(env);
  assert("a decided price: the line's contribution follows the approved price (72 → 4.86), and the row says «بسعرك · مساهمة +4.86»", lineFor(1).x_contribution === 4.86 && text(rowsOf(chart())[0]).includes("بسعرك · مساهمة +4.86"), `${lineFor(1).x_contribution} ${text(rowsOf(chart())[0]).slice(0, 90)}`);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the engine, the proposed decision and the review's message are what they were
  const env = world(); prices();
  await engine(env);
  const review = RV.reviewRows(await linesOf(env), "market", DAY);
  assert("the review's lines of the day, to the letter (no contribution in them)", review.map((r: any) => RV.reviewLine(r)).join("\n") === [
    "✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70",
    "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر",
    "✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50",
    "❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر",
  ].join("\n"), review.map((r: any) => RV.reviewLine(r)).join("\n"));
  assert("the lines' prices, statuses and profits as § 56 left them", JSON.stringify([1, 2, 3, 4].map((p) => [lineFor(p).x_status, lineFor(p).x_sale_price, lineFor(p).x_real_profit, lineFor(p).x_suggested_price])) === JSON.stringify([["auto", 70, 1.13, 71.5], ["exception", 0, -0.35, 23], ["exception", 0, 0, 19.5], ["exception", 0, -0.74, 31.5]]), JSON.stringify([1, 2, 3, 4].map((p) => [lineFor(p).x_status, lineFor(p).x_sale_price, lineFor(p).x_real_profit, lineFor(p).x_suggested_price])));
}

// ================================================================ [4] the design stays
console.log("\n[4] the design, the shapes and the order stay");
{
  const env = world(); prices();
  await engine(env);
  const html = chart(), rs = rowsOf(html);
  const stripped = (h: string) => h
    .replace(/<div class="utak-loss-zone [^>]*><\/div>/g, "").replace(/<div class="utak-even [^>]*><\/div>/g, "")
    .replace(/<span class="utak-even-value [\s\S]*?<\/span><\/span>/g, "").replace(/ <span class="utak-move [^>]*>[^<]*<\/span>/g, "")
    .replace(/ <span class="utak-contribution [\s\S]*?<\/span><\/span>/g, "").replace(/<div class="utak-key-note [^>]*>[^<]*<\/div>/, "")
    .replace(`<span class="text-nowrap"><span class="text-danger fw-bold">┃</span> ${DS.EVEN_KEY_TEXT}</span>`, "");
  const rowsNow = DS.screenRows(await linesOf(env), "market", DAY, "draft");
  const bare = stripped(html);
  assert("with § 60's additions taken off, each row is § 56's: the label, the track (the axis line, the ticks, the gap, ■ ○ ◆ in that order), the three values", rowsOf(bare).length === 4 && rowsOf(bare).every((r) => !/utak-(even|loss|move|contribution)/.test(r))
    && rs.every((r) => r.indexOf('class="utak-m-cost"') < r.indexOf('class="utak-m-market"') || !r.includes('class="utak-m-market"')) && rs.every((r) => !r.includes('class="utak-m-ours"') || r.lastIndexOf('class="utak-m-') === r.indexOf('class="utak-m-ours"')));
  assert("the three shapes are what they were: a square, a ring, a diamond in the text's own colour", html.includes("width:10px;height:10px;background:currentColor") && html.includes("border:2px solid currentColor;border-radius:50%") && html.includes("transform:rotate(45deg)"));
  assert("the break-even stands between the purchase with the VAT and the suggested price: the axis is the one of the three marks", rowsNow.every((r: any) => !(r.breakEven > 0) || (r.breakEven > r.purchaseVat && r.breakEven < r.suggested))
    && JSON.stringify(DS.chartAxis(rowsNow.flatMap((r: any) => [r.purchaseVat, r.market, r.ours]))) === JSON.stringify(DS.chartAxis(rowsNow.flatMap((r: any) => [r.purchaseVat, r.market, r.ours, r.breakEven]))));
  assert("the marks stand where they stood (the banana: ■ 63.25, ○ 70, ◆ 70)", markLeft(rs[0], "cost") === DS.axisAt(DS.chartAxis(rowsNow.flatMap((r: any) => [r.purchaseVat, r.market, r.ours]))!, 63.25) && markLeft(rs[0], "market") === markLeft(rs[0], "ours"));
  const tags = [...html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*>/g)];
  const attrs = new Set(tags.flatMap((t) => [...t[3].matchAll(/\s([\w-]+)="/g)].map((a) => a[1])));
  assert("still div and span alone, with class / style / title / dir alone", tags.every((t) => t[2] === "div" || t[2] === "span") && [...attrs].every((a) => ["class", "style", "title", "dir"].includes(a)), [...attrs].join());
  assert("«ربح الكرتون», the second drawing, is as it was: a column an item around the zero line", bare.includes('class="utak-bars d-flex flex-wrap"') && (bare.match(/class="utak-col /g) ?? []).length === 4 && bare.includes('class="utak-zero"'));
}

// ================================================================ [5] the width
console.log("\n[5] the width: «سعرنا مقابل السوق» 960px at most, «ربح الكرتون» beside it from 1400px");
{
  const env = world(); prices();
  await engine(env);
  const html = chart();
  assert("«سعرنا مقابل السوق» never grows past 960px, and does not stretch with the screen", DS.CHART_PRICES_MAX_PX === 960 && html.includes(`<div class="utak-prices mb-4" style="flex:0 1 960px;max-width:960px;min-width:0">`), html.slice(0, 200));
  assert("the chart is a row from Odoo's «xxl» width (1400px) and a column below it: «ربح الكرتون» beside the prices, else under them", html.startsWith(`<div class="utak-day-chart d-xxl-flex align-items-start">`) && html.includes(`<div class="utak-profits ms-xxl-4" style="flex:1 1 0;min-width:0">`)
    && html.indexOf("utak-prices") < html.indexOf("utak-profits"));
  assert("…by Odoo's own classes alone (no <style>, no media query written into the field)", !/<style|@media/i.test(html));
  assert("an empty day keeps its one line", DS.dayChartHtml([]) === `<div class="utak-day-chart text-muted">${DS.CHART_EMPTY_TEXT}</div>`);
}

done();
