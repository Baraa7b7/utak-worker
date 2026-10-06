// § 60 د (2026-10-06, Baraa's amendment) — the three tabs and «خلاصة اليوم»: text and numbers, no drawing.
//
//   [1] every tab is text and lists alone (no coloured table, no matrix, no waterfall), its FIRST line
//       its own summary, under § 56's rules, within 1500 characters an item
//   [2] «💧 وين يروح المال»: «من كل كرتون بسعر X: ضريبة · شراء · تالف · تشغيل · لنا» in riyals (the parts
//       add up to the price), the operating share as it really was, the week's expenses against the plan
//   [3] «⭐ الأصناف»: each item's mean profit, the days it went out, its market's direction
//   [4] «🎯 الفرص والقادم»: the five opportunities worth the most riyals, each a sentence and what to do;
//       the margin's alarm; what covers the day
//   [5] the market's direction, «3 أيام متتالية» and «بكرة إذا استمر» (not before 5 market days)
//   [6] «خلاصة اليوم»: four lines with the day's numbers; a line without data says so in a few words
//   [7] what they read: the real records alone — never a simulation's — kept a quarter of an hour
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-tabs.test.mts

import { odooLog, openWindow, quiet, rows, seed, setRiyadh, table } from "./wa-harness.mts";
import { AHMED, C1, C1_PHONE, DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const DS = await import("../src/day-screen.ts");
const DI = await import("../src/day-insight.ts");
const DT = await import("../src/day-tabs.ts");

const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const text = (html: unknown) => String(html ?? "").replace(/<\/div>/g, "\n").replace(/<[^>]*>/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
const TABS = ["x_tab_money_html", "x_tab_items_html", "x_tab_next_html"] as const;

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
/** Banana 55 / 70, pomegranate (medium) 15 / 20, (small) 12 / —, (large) 22 / 28. */
function prices(day = DAY): void {
  dp(1, 11, 55, day); market(1, 11, 70, day);
  dp(2, 21, 15, day); market(2, 21, 20, day);
  dp(3, 31, 12, day);
  dp(4, 41, 22, day); market(4, 41, 28, day);
}
const engine = (env: any) => quiet(() => PR.refreshPriceDay(env, { force: true }));
const linesOf = (env: any): Promise<any[]> => quiet(() => PR.readLines(env, dayOf().id));
/** A real day before this one: its state, its cost, and its lines [product, packaging, purchase, market, published sale, profit]. */
function past(day: string, state: string, lines: Array<[number, number, number, number, number, number]>, extra: Record<string, unknown> = {}): number {
  const d = seed("x_price_day", { x_date: day, x_state: state, x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_op_cost: 496.52, ...extra });
  for (const [p, k, purchase, m, sale, profit] of lines) {
    const board = sale > 0 ? sale : m;
    seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: purchase, x_market_price: m, x_sale_price: sale, x_excluded: false, x_utak_simulation: false,
      x_real_profit: profit, x_net_sale: board > 0 ? Math.round((board / 1.15) * 100) / 100 : 0, x_net_purchase: purchase });
  }
  return d;
}
const hist = (day: string, key: string, o: Partial<{ purchase: number; market: number; sale: number; profit: number; margin: number; priced: boolean; name: string }> = {}) => ({ day, key, name: o.name ?? "صنف", purchase: o.purchase ?? 0, market: o.market ?? 0, sale: o.sale ?? 0, profit: o.profit ?? 0, margin: o.margin ?? 0, priced: o.priced ?? ((o.sale ?? 0) > 0) });
const row = (key: string, name: string, o: Record<string, unknown> = {}): any => ({ key, name, publish: true, price: 20, purchase: 12, market: 20, sale: 20, suggested: 19, profit: 2, waste: 0.6, opShare: 2, vatPct: 15, ...o });

// ================================================================ [1] text alone, a summary first
console.log("\n[1] every tab: text and lists alone, its first line its own summary, within 1500 characters an item");
{
  const env = world(); prices();
  past("2026-10-02", "published", [[1, 11, 52, 67, 67, 0.4], [2, 21, 15, 22, 22, 1.39], [3, 31, 12, 0, 19.5, 2.37]]);
  await engine(env);
  const d = dayOf();
  for (const f of TABS) {
    const html = String(d[f]);
    const tags = [...html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*>/g)];
    const attrs = new Set(tags.flatMap((t) => [...t[3].matchAll(/\s([\w-]+)="/g)].map((a) => a[1])));
    assert(`${f}: div and span alone, with class and dir alone — no style at all, so nothing is drawn (no bar, no coloured cell, no grid)`, html.length > 60 && tags.every((t) => t[2] === "div" || t[2] === "span") && [...attrs].every((a) => a === "class" || a === "dir")
      && !/style=|<style|<svg|<table|bg-|position:|display:grid|background/i.test(html), [...attrs].join());
    assert(`${f}: ONE root, and its first line is the tab's own summary`, new RegExp(`^<div class="utak-tab utak-tab-(money|items|next)"><div class="utak-lead fw-bold mb-2">`).test(html) && html.endsWith("</div>") && html.split('class="utak-lead ').length === 2);
    assert(`${f}: within 1500 characters an item (${html.length} of ${DT.TAB_ITEM_BUDGET * 4})`, DT.TAB_ITEM_BUDGET === 1500 && html.length <= DT.TAB_ITEM_BUDGET * 4);
    assert(`${f}: every number reads left to right inside the line`, !/[+−]\d/.test(html.replace(/<span dir="ltr">[^<]*<\/span>/g, "")) && html.includes('<span dir="ltr">'));
  }
  assert("the day carries the eleven fields § 60 writes, and nothing outside the tenant's schema", (DS.INSIGHT_DAY_FIELDS as readonly string[]).every((f) => d[f] !== undefined && d[f] !== false || f === "x_profit_target") && rejected.length === 0, rejected.join(" | "));
}
{
  // the budget holds whatever the day: one item, forty items with long names
  for (const n of [1, 4, 40]) {
    const rs = Array.from({ length: n }, (_, i) => row(`${i + 1}:1`, `صنف طويل الاسم جداً رقم ${i + 1} — تعبئة خاصة ممتازة`, { market: 30 + i, sale: 30 + i, suggested: 20, purchase: 15 }));
    const inputs = { ...DT.emptyInputs(DAY), unavailable: Array.from({ length: 12 }, (_, i) => ({ name: `مطلوب ${i}`, productId: 0, asks: 3, customers: 2, quantity: 0 })),
      history: rs.flatMap((r) => ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((day, k) => hist(day, r.key, { market: 20 + k, sale: 25, profit: 1, margin: 5 - k, purchase: 15 }))),
      offers: rs.map((r) => ({ key: r.key, partnerId: 9, source: "مورد بعيد الاسم", price: 10 })) };
    const plan = DI.dayPlan(DS.planItems(rs), 500, 0);
    const out = [DT.moneyTabHtml({ rows: rs, inputs, cartons: 250, cost: 500, vatPct: 15 }), DT.itemsTabHtml({ rows: rs, inputs, state: "published", vatPct: 15 }), DT.nextTabHtml({ rows: rs, inputs, plan, suppliers: new Map() })];
    assert(`${n} item(s): each tab within ${DT.TAB_ITEM_BUDGET * n} characters (${out.map((h) => h.length).join(" / ")}), and its summary first`, out.every((h) => h.length <= DT.TAB_ITEM_BUDGET * n && h.includes('class="utak-lead ')));
  }
  const parts = [{ html: "<div>A</div>", rank: 0 }, { html: `<div>${"ب".repeat(900)}</div>`, rank: 2 }, { html: `<div>${"ج".repeat(900)}</div>`, rank: 5 }, { html: "<div>Z</div>", rank: 0 }];
  const fit = DT.fitTab("x", parts, 1);
  assert("over its budget a tab drops its least needed part first (the highest rank), never the opening line nor a part of rank 0", fit.includes("A") && fit.includes("Z") && fit.includes("ب") && !fit.includes("ج") && fit.length <= 1500 && DT.fitTab("x", parts, 2).includes("ج"), String(fit.length));
  assert("…and a tab made of rank 0 alone is left as it is", DT.fitTab("x", [{ html: `<div>${"ا".repeat(3000)}</div>`, rank: 0 }], 1).length > 3000);
}

// ================================================================ [2] «💧 وين يروح المال»
console.log("\n[2] «💧 وين يروح المال»: the carton's split, the operating share as it was, the week");
{
  const env = world(); prices();
  await engine(env);
  const lines = text(dayOf().x_tab_money_html);
  // what goes out: the banana at 70 and the small pomegranate at 19.50 → the mean price 44.75
  assert("«من كل كرتون بسعر 44.75: ضريبة 5.83 · شراء 33.50 · تالف 1.68 · تشغيل 1.99 · لنا +1.75.»", lines[0] === "من كل كرتون بسعر 44.75: ضريبة 5.83 · شراء 33.50 · تالف 1.68 · تشغيل 1.99 · لنا +1.75.", lines[0]);
  const split = DT.cartonSplit(DS.screenRows(await linesOf(env), "market", DAY, "draft"))!;
  assert("the five parts add up to the price, to the halala — and «لنا» is the header's mean profit (+1.75)", Math.round((split.vat + split.purchase + split.waste + split.share + split.profit) * 100) / 100 === split.sale && split.profit === dayOf().x_avg_profit && split.basis === "carton", JSON.stringify(split));
  assert("it says what it is: «للكرتون الواحد بمتوسط أسعار اليوم (لا مبيعات حقيقية أمس).»", lines[1] === "للكرتون الواحد بمتوسط أسعار اليوم (لا مبيعات حقيقية أمس).", lines[1]);
  assert("«حصة التشغيل محسوبة على 250 كرتون — لا مبيعات فعلية أمس للمقارنة.»", lines[2] === "حصة التشغيل محسوبة على 250 كرتون — لا مبيعات فعلية أمس للمقارنة.", lines[2]);
  assert("the week (Saturday first; 10-03 is a Saturday): nothing posted yet, against the day's cost", DT.weekStart(DAY) === "2026-10-03" && DT.weekStart("2026-10-06") === "2026-10-03" && DT.weekStart("2026-10-09") === "2026-10-03" && DT.weekStart("2026-10-10") === "2026-10-10"
    && lines[3] === "الأسبوع حتى الآن (من السبت 3 أكتوبر 2026): مصاريف مسجّلة فعلاً 0.00 ريال (لم يُسجَّل مصروف بعد) مقابل المخطط 496.52 ريال (تكلفة التشغيل اليومية لـ 1 يوم).", lines[3]);
  assert("no item goes out with a price and a purchase: the tab says so", text(DT.moneyTabHtml({ rows: [], inputs: DT.emptyInputs(DAY), cartons: 250, cost: 496.52, vatPct: 15 }))[0] === "لا صنف يُنشر اليوم بسعر وشراء." && DT.cartonSplit([row("1:1", "x", { publish: false })]) === null);
  assert("no cartons to divide by: «حصة التشغيل: تعذّرت …»", text(DT.moneyTabHtml({ rows: [], inputs: DT.emptyInputs(DAY), cartons: null, cost: null, vatPct: 15 })).some((l) => l.startsWith("حصة التشغيل: تعذّرت")));
}
{
  // the week's expenses: what is POSTED in the EXP journal on an expense account, this week — against the days' costs
  const env = world(`2026-10-06 04:00`); prices("2026-10-06");
  past("2026-10-03", "missed", [], { x_op_cost: 500 }); past("2026-10-04", "missed", [], { x_op_cost: 480 }); past("2026-10-05", "missed", [], { x_op_cost: 0 });
  past("2026-10-02", "missed", [], { x_op_cost: 999 });   // last week
  const jl = (v: Record<string, unknown>) => seed("account.move.line", { "journal_id.code": "EXP", parent_state: "posted", account_type: "expense", date: "2026-10-05", balance: 0, ref: false, move_name: "EXP/2026/10/0001", ...v });
  jl({ balance: 300 }); jl({ balance: 86.96, date: "2026-10-03" }); jl({ balance: -50, date: "2026-10-06" });                   // an invoice, another, a refund
  jl({ balance: 13.04, account_type: "asset_current" });                                                                          // its VAT line: no expense
  jl({ balance: 700, parent_state: "draft" }); jl({ balance: 900, date: "2026-10-02" }); jl({ balance: 400, date: "2026-10-07" }); // a draft, last week, tomorrow
  jl({ balance: 800, "journal_id.code": "BILL" });                                                                                // a purchase bill: not an operating expense
  jl({ balance: 100, ref: "SIM-TEST مورد وقود" }); jl({ balance: 100, move_name: "SIM-TEST-PAYROLL" });                            // the September trials
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const week = text(dayOf("2026-10-06").x_tab_money_html).find((l) => l.startsWith("الأسبوع حتى الآن"))!;
  assert("spent 300 + 86.96 − 50 = 336.96 (posted, EXP, an expense account, this week, no trial's) against 500 + 480 + today's 496.52 = 1476.52 over the 3 days that carry a cost", week === "الأسبوع حتى الآن (من السبت 3 أكتوبر 2026): مصاريف مسجّلة فعلاً 336.96 ريال مقابل المخطط 1476.52 ريال (تكلفة التشغيل اليومية لـ 3 أيام) — تحت المخطط بـ 1139.56.", week);
  rows("account.move.line")[0].balance = 2000;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("above the plan: «— فوق المخطط بـ …»", text(dayOf("2026-10-06").x_tab_money_html).some((l) => l.endsWith("— فوق المخطط بـ 560.44.")), text(dayOf("2026-10-06").x_tab_money_html).join(" | "));
  assert("expenses that could not be read: «تعذّرت», never 0", text(DT.moneyTabHtml({ rows: [], inputs: { ...DT.emptyInputs(DAY), expenses: null }, cartons: 250, cost: 500, vatPct: 15 })).some((l) => l.includes("مصاريف مسجّلة فعلاً تعذّرت مقابل المخطط 500.00 ريال")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // yesterday had real sales: the split is yesterday's, a carton as it was really sold, and the share as it really was
  const y = { day: "2026-10-02", state: "published", cost: 400, planWaste: 0.6, actWaste: 40, actCost: 400, actual: { cartons: 100, target: 160, profit: -90, profitTarget: 0, gap: -90, volume: -90, marginVar: 0, wasteVar: 0, costVar: 0 } };
  const sold = [{ day: "2026-10-02", priceDay: "2026-10-02", key: "1:11", quantity: 100, sale: 23, purchase: 16.5, returned: 0, reason: "" }];
  const s = DT.actualSplit(sold, y, 15)!;
  // net = (−90 + 400 + 40) ÷ 100 + 16.5 = 20 → the price 23; vat 3, purchase 16.5, waste 0.4, share 4, ours −0.9
  assert("yesterday's real carton: 23.00 = ضريبة 3.00 + شراء 16.50 + تالف 0.40 + تشغيل 4.00 + لنا −0.90", JSON.stringify(s) === JSON.stringify({ basis: "actual", sale: 23, vat: 3, purchase: 16.5, waste: 0.4, share: 4, profit: -0.9 }) && DT.splitLine(s) === "من كل كرتون بسعر 23.00: ضريبة 3.00 · شراء 16.50 · تالف 0.40 · تشغيل 4.00 · لنا −0.90", JSON.stringify(s));
  const inputs = { ...DT.emptyInputs(DAY), days: [y], sold };
  const lines = text(DT.moneyTabHtml({ rows: [row("1:11", "موز")], inputs, cartons: 250, cost: 500, vatPct: 15 }));
  assert("the tab then opens on yesterday as it really was, says so, and gives the share as it really was: 400 ÷ 100 = 4.00 a carton", lines[0] === "من كل كرتون بسعر 23.00: ضريبة 3.00 · شراء 16.50 · تالف 0.40 · تشغيل 4.00 · لنا −0.90." && lines[1] === "أمس فعلياً (2 أكتوبر 2026)، وبالتالف الفعلي." && lines[2] === "حصة التشغيل محسوبة على 250 كرتون — بمبيعات أمس الفعلية كانت 4.00 للكرتون.", lines.join(" | "));
  assert("no real sale yesterday (or a day not computed): the day's own carton", DT.actualSplit(sold, { ...y, actual: null }, 15) === null && DT.actualSplit([], y, 15) === null && DT.actualSplit(sold, { ...y, actual: { ...y.actual, cartons: 0 } }, 15) === null && DT.moneySplit({ rows: [row("1:11", "موز")], inputs: DT.emptyInputs(DAY), vatPct: 15 })?.basis === "carton");
}

// ================================================================ [3] «⭐ الأصناف»
console.log("\n[3] «⭐ الأصناف»: each item's mean profit, the days it went out, its market's direction");
{
  const env = world(); prices();
  // 10-02 published: banana 67 (+0.40), medium 22 (+1.39), small 19.50 (+2.37); 10-01 published: banana 66 (+2.00); 09-30 missed (not published): banana with a price all the same
  past("2026-10-02", "published", [[1, 11, 52, 67, 67, 0.4], [2, 21, 15, 22, 22, 1.39], [3, 31, 12, 0, 19.5, 2.37]]);
  past("2026-10-01", "published", [[1, 11, 50, 66, 66, 2]]);
  past("2026-09-30", "missed", [[1, 11, 50, 64, 64, 9]]);
  past("2026-10-02", "published", [[1, 11, 1, 1, 1, 99], [4, 41, 1, 1, 1, 99]], { x_utak_simulation: true });
  await engine(env);
  const lines = text(dayOf().x_tab_items_html);
  assert("it opens on the best and the weakest of the last 14 days", lines[0] === "أربح صنف في آخر 14 يوماً: رمان صغير (+2.37 للكرتون)، وأضعفها: موز أمريكي (+1.20).", lines[0]);
  assert("…says the picture is not complete yet: the most days any item went out is 2 of the 7 it takes", lines[1] === "تكتمل الصورة بعد 7 أيام بيانات — عندنا الآن 2.", lines[1]);
  assert("a line an item, the best mean first: its mean profit, the days it went out, its market's direction — the item never published last", JSON.stringify(lines.slice(2)) === JSON.stringify([
    "رمان صغير: متوسط الربح +2.37 · أيام النشر 1 · السوق —",
    "رمان وسط: متوسط الربح +1.39 · أيام النشر 1 · السوق نازل ▼ (20.00 مقابل متوسط 22.00)",
    "موز أمريكي: متوسط الربح +1.20 · أيام النشر 2 · السوق طالع ▲ (70.00 مقابل متوسط 65.67)",
    "رمان كبير: لم يُنشر · السوق —",
  ]), lines.slice(2).join(" | "));
  assert("a day that was never published counts for nothing (09-30), nor a simulation's day, nor this day while it is a draft", !lines.join(" ").includes("99") && !lines.join(" ").includes("9.00"));
  // the day is published: its own profit joins the mean
  table("x_price_day").get(dayOf().id)!.x_state = "published";
  for (const p of [1, 2, 3, 4]) Object.assign(table("x_price_day_line").get(lineFor(p).id)!, p === 1 ? {} : { x_status: "unpublished", x_excluded: true });
  await quiet(() => DS.writeDayScreen(env, dayOf().id, { force: true }));
  assert("once the day is published its own line counts: the banana went out 3 days, (0.40 + 2.00 + 1.13) ÷ 3 = +1.18", text(dayOf().x_tab_items_html).some((l) => l.startsWith("موز أمريكي: متوسط الربح +1.18 · أيام النشر 3 ·")), text(dayOf().x_tab_items_html).join(" | "));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const inputs = { ...DT.emptyInputs(DAY), history: [hist("2026-10-02", "1:11", { sale: 20, profit: 2, market: 20 }), hist("2026-10-01", "1:11", { sale: 20, profit: 2, market: 0, priced: false })],
    sold: [{ day: "2026-10-02", priceDay: "2026-10-02", key: "1:11", quantity: 4, sale: 21.15, purchase: 12, returned: 0, reason: "" }, { day: "2026-10-03", priceDay: "2026-10-02", key: "1:11", quantity: 1, sale: 20, purchase: 12, returned: 0, reason: "" }] };
  const [s] = DT.itemStats([row("1:11", "موز", { market: 0 })], inputs, "draft", 15);
  // really sold: 4 at 21.15 and 1 at 20 against the published 20 → (4 × 1.15) ÷ 5 ÷ 1.15 = +0.80 over the published profit
  assert("a day whose cartons were really sold counts as they were sold (the published profit moved by what they fetched): 2 + 0.80 = 2.80 — and a day of before the board (no cost on it) counts for nothing", s.days === 1 && s.average === 2.8, JSON.stringify(s));
  assert("seven days of data: the note is gone", !DT.itemsTabHtml({ rows: [row("1:11", "موز")], inputs: { ...DT.emptyInputs("2026-10-10"), history: Array.from({ length: 7 }, (_, i) => hist(DI.addDays("2026-10-10", -(i + 1)), "1:11", { sale: 20, profit: 1, market: 20 })) }, state: "draft", vatPct: 15 }).includes("تكتمل الصورة")
    && text(DT.itemsTabHtml({ rows: [row("1:11", "موز")], inputs: DT.emptyInputs(DAY), state: "draft", vatPct: 15 }))[0] === "لا صنف نُشر في آخر 14 يوماً.");
  assert("one item alone: its own line opens the tab", text(DT.itemsTabHtml({ rows: [row("1:11", "موز")], inputs, state: "draft", vatPct: 15 }))[0] === "موز: متوسط ربح الكرتون +2.80 في 1 يوم نشر.");
}

// ================================================================ [4] «🎯 الفرص والقادم»
console.log("\n[4] «🎯 الفرص والقادم»: the five opportunities worth the most riyals, each a sentence and what to do");
{
  const rs = [
    row("1:11", "موز", { price: 75, sale: 75, market: 75, suggested: 63.5, purchase: 48 }),          // (أ) +11.50
    row("2:21", "رمان وسط", { price: 20, sale: 20, market: 20, suggested: 22.5, purchase: 14 }),      // the market below the suggested: nothing
    row("3:31", "رمان صغير", { price: 18, sale: 18, market: 18, suggested: 19, purchase: 11 }),
    row("4:41", "رمان كبير", { price: 30, sale: 30, market: 30, suggested: 29.5, purchase: 20 }),     // (أ) +0.50
  ];
  const inputs = { ...DT.emptyInputs(DAY),
    history: [hist("2026-09-30", "3:31", { market: 15 }), hist("2026-10-01", "3:31", { market: 16 }), hist("2026-10-02", "3:31", { market: 17 })],   // (ب) 15 → 16 → 17 → 18: +3.00
    // the large pomegranate's purchase (20) is from #5: #7 offered 18 the day before (and 25 three days ago: his LATEST counts), #8 19, #5 himself 17 earlier (the taken one never); the banana's 50 is dearer than its 48
    offers: [{ key: "4:41", partnerId: 7, source: "سوق العزيزية", price: 25, day: "2026-09-30" }, { key: "4:41", partnerId: 7, source: "سوق العزيزية", price: 18, day: "2026-10-02" }, { key: "4:41", partnerId: 8, source: "أبعد", price: 19, day: "2026-10-02" },
      { key: "4:41", partnerId: 5, source: "المختار", price: 17, day: "2026-10-01" }, { key: "1:11", partnerId: 7, source: "سوق العزيزية", price: 50, day: "2026-10-02" }],
    unavailable: [{ name: "طماطم", productId: 9, asks: 3, customers: 2, quantity: 0 }, { name: "خيار", productId: 0, asks: 1, customers: 1, quantity: 0 }] };
  const opps = DT.opportunities(rs, inputs, new Map([["4:41", 5]]));
  assert("sorted by the riyals a carton, the asks (no price to value them) after them by the number of customers", JSON.stringify(opps.map((o: any) => [o.kind, o.riyal])) === JSON.stringify([["above", 11.5], ["rising", 3], ["cheaper", 2], ["above", 0.5], ["asked", 0], ["asked", 0]]), JSON.stringify(opps.map((o: any) => [o.kind, o.riyal])));
  assert("(أ) the market above the suggested price: a sentence and what to do", opps[0].text === "موز: السوق 75.00 أعلى من المقترح 63.50 بـ 11.50 للكرتون — بِعه بسعر السوق." && opps[0].short === "موز (السوق فوق المقترح +11.50)", opps[0].text);
  assert("(ب) the market up three days in a row", opps[1].text === "رمان صغير: السوق طالع 3 أيام متتالية (+3.00) — راجع سعر بيعه قبل النشر." && opps[1].short === "رمان صغير (سوق طالع +3.00)", opps[1].text);
  assert("(ج) a cheaper purchase source among the last days' offers, not the one taken: each other source's LATEST offer, the cheapest of them — the taken one's own never", opps[2].text === "رمان كبير: سوق العزيزية أرخص بـ 2.00 للكرتون (18.00 يوم 2 أكتوبر مقابل 20.00) — اطلب سعره اليوم." && opps[2].short === "رمان كبير (شراء أرخص +2.00 عند سوق العزيزية)" && opps.filter((o: any) => o.kind === "cheaper").length === 1, opps[2].text);
  assert("…an offer of this very day that the line does not carry yet: «— اشترِ منه»; a source whose latest offer is dearer: nothing", DT.opportunities([rs[3]], { ...DT.emptyInputs(DAY), offers: [{ key: "4:41", partnerId: 7, source: "سوق العزيزية", price: 18, day: DAY }] }, new Map([["4:41", 5]])).find((o: any) => o.kind === "cheaper")?.text === "رمان كبير: سوق العزيزية أرخص بـ 2.00 للكرتون (18.00 مقابل 20.00) — اشترِ منه."
    && DT.opportunities([rs[3]], { ...DT.emptyInputs(DAY), offers: [{ key: "4:41", partnerId: 7, source: "س", price: 18, day: "2026-10-01" }, { key: "4:41", partnerId: 7, source: "س", price: 21, day: "2026-10-02" }] }, new Map([["4:41", 5]])).every((o: any) => o.kind !== "cheaper"));
  assert("(د) asked for and not available in the last seven days", opps[4].text === "طماطم: طلبه عميلان في 7 أيام (×3) وما كان متوفراً — وفّره وانشره." && opps[5].text === "خيار: طلبه عميل واحد في 7 أيام (×1) وما كان متوفراً — وفّره وانشره." && opps[4].short === "طماطم (طلبه عميلان)", opps[4].text);
  const plan = DI.dayPlan(DS.planItems(rs), 641.23, 0);
  const lines = text(DT.nextTabHtml({ rows: rs, inputs, plan, suppliers: new Map([["4:41", 5]]) }));
  assert("the tab: its summary, the FIVE worth the most (numbered), and what covers the day last", lines[0] === "6 فرص اليوم، أكبرها +11.50 للكرتون (أعلى 5 هنا)." && lines.length === 7 && lines[1].startsWith("1. موز: السوق 75.00 أعلى من المقترح") && lines[5].startsWith("5. طماطم:") && !lines.join(" ").includes("خيار") && lines[6].startsWith("🎯 لتغطية التشغيل بأسعار اليوم تحتاج ") && DT.TOP_OPPORTUNITIES === 5, lines.join(" | "));
  assert("every one is a sentence and an action: «— بِعه…», «— راجع…», «— اطلب سعره اليوم», «— وفّره وانشره»", opps.every((o: any) => / — (بِعه بسعر السوق|راجع سعر بيعه قبل النشر|اشترِ منه|اطلب سعره اليوم|وفّره وانشره)\.$/.test(o.text)));
  const none = text(DT.nextTabHtml({ rows: [rs[1]], inputs: DT.emptyInputs(DAY), plan, suppliers: new Map() }));
  assert("no opportunity: the tab says so, and still what covers the day", none[0] === "لا فرصة ظاهرة بأرقام اليوم." && none.length === 2 && none[1].startsWith("🎯 لتغطية التشغيل"));
  assert("one, two: «فرصة واحدة», «فرصتان»; asks alone: «… طلبها العملاء وما كان متوفراً»", text(DT.nextTabHtml({ rows: [rs[0]], inputs: DT.emptyInputs(DAY), plan, suppliers: new Map() }))[0] === "فرصة واحدة اليوم، أكبرها +11.50 للكرتون."
    && text(DT.nextTabHtml({ rows: [rs[0], rs[3]], inputs: DT.emptyInputs(DAY), plan, suppliers: new Map() }))[0] === "فرصتان اليوم، أكبرها +11.50 للكرتون."
    && text(DT.nextTabHtml({ rows: [rs[1]], inputs: { ...DT.emptyInputs(DAY), unavailable: inputs.unavailable }, plan, suppliers: new Map() }))[0] === "2 أصناف طلبها العملاء وما كان متوفراً.");
  // the margin narrowed three days in a row: 6 → 5 → 4 → today's 20 ÷ 1.15 − 14 = 3.39
  const narrow = { ...DT.emptyInputs(DAY), history: [hist("2026-09-30", "2:21", { margin: 6 }), hist("2026-10-01", "2:21", { margin: 5 }), hist("2026-10-02", "2:21", { margin: 4 })] };
  assert("«⚠️ الهامش ضاق 3 أيام متتالية — رمان وسط (6.00 ← 3.39): راجع سعر شرائه أو بيعه.»", JSON.stringify(DT.marginAlarms(rs, narrow)) === JSON.stringify(["⚠️ الهامش ضاق 3 أيام متتالية — رمان وسط (6.00 ← 3.39): راجع سعر شرائه أو بيعه."]) && text(DT.nextTabHtml({ rows: rs, inputs: narrow, plan, suppliers: new Map() })).includes("⚠️ الهامش ضاق 3 أيام متتالية — رمان وسط (6.00 ← 3.39): راجع سعر شرائه أو بيعه."), DT.marginAlarms(rs, narrow).join(" | "));
  assert("a margin that held one of the three days: no alarm", DT.marginAlarms(rs, { ...narrow, history: [hist("2026-09-30", "2:21", { margin: 6 }), hist("2026-10-01", "2:21", { margin: 4 }), hist("2026-10-02", "2:21", { margin: 4 })] }).length === 0);
}
{
  // through the engine: a source that offered less the day before, and is not the one today's purchase is from
  const env = world(); prices();
  seed("res.partner", { id: 802, name: "سوق العزيزية", supplier_rank: 1, x_price_source: true });
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: 802, x_price_sar: 19, x_date: "2026-10-02", x_extraction_status: "extracted" });
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: 802, x_price_sar: 5, x_date: "2026-10-02", x_extraction_status: "failed" });          // a reading that failed: no offer
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: 802, x_price_sar: 6, x_date: "2026-10-02", x_extraction_status: "extracted", x_utak_simulation: true });
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: 802, x_price_sar: 7, x_date: "2026-09-20", x_extraction_status: "extracted" });      // older than the seven days
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: 802, x_date: "2026-10-02", x_purchase_price: 60, x_market_price: 0, x_status: "valid", x_utak_simulation: false });   // dearer than the banana's 55
  await engine(env);
  const lines = text(dayOf().x_tab_next_html);
  assert("today's purchase is Ahmed's 22 (the day's lowest); سوق العزيزية offered 19 the day before: «رمان كبير: سوق العزيزية أرخص بـ 3.00 للكرتون (19.00 يوم 2 أكتوبر مقابل 22.00) — اطلب سعره اليوم.»", lineFor(4).x_cost_price === 22 && lineFor(4).x_supplier_id === AHMED
    && lines.join(" | ") === "فرصة واحدة اليوم، أكبرها +3.00 للكرتون. | 1. رمان كبير: سوق العزيزية أرخص بـ 3.00 للكرتون (19.00 يوم 2 أكتوبر مقابل 22.00) — اطلب سعره اليوم. | 🎯 لتغطية التشغيل بأسعار اليوم تحتاج 133 كرتون", lines.join(" | "));
  assert("…a failed reading, a simulation's row, a row older than seven days and a dearer offer are no opportunity", !lines.join(" ").includes("17.00") && !lines.join(" ").includes("موز"));
  assert("«خلاصة اليوم» names it: «➡️ أهم فرصة: رمان كبير (شراء أرخص +3.00 عند سوق العزيزية)»", text(dayOf().x_brief_html)[4] === "➡️ أهم فرصة: رمان كبير (شراء أرخص +3.00 عند سوق العزيزية)", text(dayOf().x_brief_html)[4]);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [5] the market's direction
console.log("\n[5] the market's direction, three days in a row, and «بكرة إذا استمر»");
{
  const pts = (v: number[], last = "2026-10-10") => v.map((value, i) => ({ day: DI.addDays(last, i - (v.length - 1)), value }));
  const t = DT.trendOf(pts([20, 20, 21]));
  assert("the last price against the mean of the days before it (seven at most): above it by more than 2 % «طالع ▲», below «نازل ▼», else «ثابت ●»", t.direction === "up" && t.mean === 20 && t.last === 21 && DT.trendOf(pts([20, 20, 19.5])).direction === "down" && DT.trendOf(pts([20, 20, 20.3])).direction === "flat" && DT.trendOf(pts([20, 20, 19.7])).direction === "flat" && DT.TREND_BAND === 0.02);
  assert("no earlier day: no direction; a day older than a week does not count in the mean", DT.trendOf(pts([20])).direction === null && DT.trendOf([]).direction === null && DT.trendOf([{ day: "2026-09-01", value: 50 }, { day: "2026-10-09", value: 20 }, { day: "2026-10-10", value: 20 }]).mean === 20);
  assert("«بكرة إذا استمر» = the last price ∓ the mean absolute daily move — and not before 5 days with a market price", DT.trendOf(pts([20, 21, 20, 22])).range === null && JSON.stringify(DT.trendOf(pts([20, 21, 20, 22, 21])).range) === JSON.stringify([19.75, 22.25]) && DT.RANGE_MARKET_DAYS === 5);
  assert("«السوق طالع ▲ (21.00 مقابل متوسط 20.00)», and with the range: «· بكرة إذا استمر 19.75–22.25»", DT.trendText(t) === "السوق طالع ▲ (21.00 مقابل متوسط 20.00)" && DT.trendText(DT.trendOf(pts([20, 21, 20, 22, 21]))).endsWith(" · بكرة إذا استمر 19.75–22.25") && DT.trendText(DT.trendOf([])) === "السوق —");
  assert("three days in a row: the last three steps all the same way — the move over them, else 0", DT.streak([15, 16, 17, 18], 1) === 3 && DT.streak([15, 16, 16, 18], 1) === 0 && DT.streak([16, 17, 18], 1) === 0 && DT.streak([9, 15, 16, 17, 18], 1) === 3 && DT.streak([6, 5, 4, 3.39], -1) === -2.61 && DT.streak([6, 5, 4, 4], -1) === 0 && DT.STREAK === 3);
  assert("a number reads left to right, and what follows it stays in the line: «21:30» and «19.75–22.25» whole, «35.75:» without its colon", DT.lineHtml("ملخص 21:30 بسعر 35.75: لنا +4.12 (47%) 19.75–22.25") === 'ملخص <span dir="ltr">21:30</span> بسعر <span dir="ltr">35.75</span>: لنا <span dir="ltr">+4.12</span> (<span dir="ltr">47%</span>) <span dir="ltr">19.75–22.25</span>');
}

// ================================================================ [6] «خلاصة اليوم»
console.log("\n[6] «خلاصة اليوم»: four lines with the day's numbers");
{
  const env = world(); prices();
  await engine(env);
  const d = dayOf();
  const lines = text(d.x_brief_html);
  assert("the box: its title, then FOUR lines — what goes out, yesterday, the carton, the opportunities", lines.length === 5 && lines[0] === "خلاصة اليوم" && lines[1].startsWith("✅") && lines[2].startsWith("🎯") && lines[3].startsWith("💧") && lines[4].startsWith("➡️"), lines.join(" | "));
  assert("(1) «✅ يُنشر اليوم 2 من 4 أصناف — متوسط ربح الكرتون +1.75» (the header's own numbers)", lines[1] === "✅ يُنشر اليوم 2 من 4 أصناف — متوسط ربح الكرتون +1.75" && d.x_n_publish === 2 && d.x_avg_profit === 1.75, lines[1]);
  assert("(2) the day before has no numbers yet: «🎯 أمس: لم تُحسب أرقامه بعد»", lines[2] === "🎯 أمس: لم تُحسب أرقامه بعد", lines[2]);
  assert("(3) «💧 من كل كرتون بـ 44.75: لنا +1.75، وأكبر بند الشراء 33.50»", lines[3] === "💧 من كل كرتون بـ 44.75: لنا +1.75، وأكبر بند الشراء 33.50", lines[3]);
  assert("(4) no opportunity today: «➡️ لا فرصة ظاهرة اليوم»", lines[4] === "➡️ لا فرصة ظاهرة اليوم", lines[4]);
  const html = String(d.x_brief_html);
  assert("a box of Odoo's own classes (border, rounded-3, p-3), div and span alone, no style at all", html.startsWith(`<div class="utak-brief border rounded-3 p-3"><div class="utak-brief-title fw-bold mb-1">خلاصة اليوم</div>`) && (html.match(/class="utak-brief-line"/g) ?? []).length === 4 && !/style=|<style|bg-/.test(html) && [...html.matchAll(/<(\w+)/g)].every((m) => m[1] === "div" || m[1] === "span"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const a = { cartons: 96, target: 140, profit: -125, profitTarget: 0, gap: -125, volume: -110, marginVar: 0, wasteVar: -15, costVar: 0 };
  const split = { basis: "carton" as const, sale: 35.75, vat: 4.66, purchase: 23.25, waste: 1.16, share: 2.56, profit: 4.12 };
  const opps = [{ kind: "above" as const, riyal: 11.5, short: "موز (السوق فوق المقترح +11.50)", text: "" }, { kind: "cheaper" as const, riyal: 2, short: "رمان (شراء أرخص +2.00 عند أحمد)", text: "" }, { kind: "asked" as const, riyal: 0, short: "طماطم (طلبه عميلان)", text: "" }];
  const rs = [row("1:1", "موز"), row("2:1", "رمان"), row("3:1", "خيار", { publish: false })];
  const b = DT.briefLines({ rows: rs, state: "published", average: 4.12, actual: a, when: "أمس", split, opportunities: opps });
  assert("a day with everything: published, yesterday against its target with the LARGEST reason, the carton with its largest cost, the TWO opportunities worth the most", JSON.stringify(b) === JSON.stringify([
    "✅ نُشر اليوم 2 من 3 أصناف — متوسط ربح الكرتون +4.12",
    "🎯 أمس: بعنا 96 من 140 (69%) — ربح −125 ❌، أكبر سبب: الكمية −110",
    "💧 من كل كرتون بـ 35.75: لنا +4.12، وأكبر بند الشراء 23.25",
    "➡️ أهم فرصتين: موز (السوق فوق المقترح +11.50) · رمان (شراء أرخص +2.00 عند أحمد)",
  ]), b.join(" | "));
  const empty = DT.briefLines({ rows: [], state: "draft", average: null, actual: undefined, when: "أمس", split: null, opportunities: [] });
  assert("a line without data says so in a few words", JSON.stringify(empty) === JSON.stringify(["✅ لا صنف للنشر اليوم", "🎯 أمس: لم تُحسب أرقامه بعد", "💧 لا صنف يُنشر اليوم بسعر وشراء", "➡️ لا فرصة ظاهرة اليوم"]), empty.join(" | "));
  assert("one opportunity: «➡️ أهم فرصة: …»; nothing goes out of three: «✅ لا صنف للنشر اليوم (من 3)»; no real sale: «🎯 أمس: لا مبيعات حقيقية بعد»",
    DT.briefLines({ rows: rs.map((r) => ({ ...r, publish: false })), state: "draft", average: null, actual: { ...a, cartons: 0 }, when: "أمس", split, opportunities: opps.slice(0, 1) }).join(" | ") === "✅ لا صنف للنشر اليوم (من 3) | 🎯 أمس: لا مبيعات حقيقية بعد | 💧 من كل كرتون بـ 35.75: لنا +4.12، وأكبر بند الشراء 23.25 | ➡️ أهم فرصة: موز (السوق فوق المقترح +11.50)");
  assert("the largest cost is named whatever it is (a carton whose operating share is the largest: «وأكبر بند التشغيل 9.00»)", DT.briefLines({ rows: rs, state: "draft", average: 1, actual: null, when: "أمس", split: { ...split, share: 9, purchase: 5 }, opportunities: [] })[2] === "💧 من كل كرتون بـ 35.75: لنا +4.12، وأكبر بند التشغيل 9.00");
  assert("an item's name is written as text, never as a tag", DT.briefHtml(["➡️ أهم فرصة: <b onclick=\"x()\">موز</b> & co"]).includes("&lt;b onclick=\"x()\"&gt;موز&lt;/b&gt; &amp; co") && !/<b /.test(DT.briefHtml(["<b onclick=\"x()\">"])));
}
{
  // names in the tabs are escaped too
  const env = world(); prices();
  table("product.template").get(1)!.name = `موز <img src=x onerror="a()"> & "حلو"`;
  await engine(env);
  const d = dayOf();
  assert("a name with a tag in it reaches no field as a tag", [...TABS, "x_brief_html", "x_target_html"].every((f) => !/<img|onerror="a\(\)">/.test(String(d[f]).replace(/&lt;img[^&]*&gt;/g, ""))) && String(d.x_tab_items_html).includes("موز &lt;img src=x onerror=\"a()\"&gt; &amp; \"حلو\""));
}

// ================================================================ [7] what they read
console.log("\n[7] the real records alone, kept a quarter of an hour");
{
  const env = world(); prices();
  past("2026-10-02", "published", [[1, 11, 52, 67, 67, 0.4]], { x_act_at: "2026-10-02 18:30:00", x_act_cartons: 20, x_act_profit: -100, x_target_cartons: 150, x_var_volume: -100, x_act_waste: 12, x_act_cost: 400 });
  past("2026-10-01", "published", [[1, 11, 9, 9, 9, 9]], { x_utak_simulation: true });
  const sim = past("2026-09-30", "published", []);
  seed("x_price_day_line", { x_day_id: sim, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 7, x_market_price: 7, x_sale_price: 7, x_utak_simulation: true });   // a simulation's line on a real day
  const order = (at: string, extra: Record<string, unknown> = {}) => { const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: at.slice(0, 10), x_price_date: "2026-10-02", x_delivered_at: utc(at), ...extra }); seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 5, x_status: "purchased", x_unit_price: 67 }); return id; };
  order("2026-10-02 09:00"); order("2026-10-02 10:00", { x_utak_simulation: true });
  seed("x_unavailable_request", { x_date: DAY, x_partner_id: C1, x_text: "طماطم", x_product_tmpl_id: false, x_quantity: 0 });
  seed("x_unavailable_request", { x_date: "2026-09-28", x_partner_id: C1, x_text: "قبل أسبوع", x_product_tmpl_id: false, x_quantity: 0 });
  seed("x_unavailable_request", { x_date: "2026-09-20", x_partner_id: C1, x_text: "قديم", x_product_tmpl_id: false, x_quantity: 0 });
  seed("x_unavailable_request", { x_date: DAY, x_partner_id: C1, x_text: "محاكاة", x_product_tmpl_id: false, x_quantity: 0, x_utak_simulation: true });
  odooLog.length = 0;
  const inputs = await quiet(() => DT.readInsightInputs(env, DAY));
  assert("the real days and their real lines alone: 10-02 and 09-30 (no line of a simulation), never the simulation's day", JSON.stringify(inputs.days.map((d: any) => d.day)) === JSON.stringify(["2026-09-30", "2026-10-02"]) && inputs.history.length === 1 && inputs.history[0].day === "2026-10-02" && inputs.history[0].sale === 67 && inputs.history[0].priced, JSON.stringify(inputs.history));
  assert("yesterday's kept actual comes with its day", inputs.days[1].actual?.cartons === 20 && inputs.days[1].actual?.profit === -100 && inputs.days[1].actWaste === 12 && inputs.days[1].actCost === 400 && inputs.days[0].actual === null);
  assert("the real lines delivered in the last 14 days alone (a simulation's order never)", inputs.sold.length === 1 && inputs.sold[0].quantity === 5 && inputs.sold[0].sale === 67 && inputs.sold[0].purchase === 52, JSON.stringify(inputs.sold));
  assert("the asks of the last seven days alone, the real ones (10-03 back to 09-27)", JSON.stringify(inputs.unavailable.map((u: any) => u.name)) === JSON.stringify(["طماطم", "قبل أسبوع"]) && DT.ASK_DAYS === 7, JSON.stringify(inputs.unavailable));
  assert("every read asked for the real records, and nothing was written", odooLog.every((x) => x.method === "search_read" || x.method === "read") && odooLog.filter((x) => ["x_price_day", "x_daily_order", "x_unavailable_request"].includes(x.model)).every((x) => JSON.stringify(x.body.domain).includes("x_utak_simulation")), odooLog.map((x) => `${x.model}.${x.method}`).join(" "));
  assert("no part failed, and nothing outside the tenant's schema was asked for", inputs.errors.length === 0 && rejected.length === 0, `${inputs.errors.join()} ${rejected.join(" | ")}`);
  // kept a quarter of an hour: the engine asks with every change
  odooLog.length = 0;
  const again = await quiet(() => DT.readInsightInputs(env, DAY));
  assert("asked again within 15 minutes: no read at all (kept in KV)", odooLog.length === 0 && JSON.stringify(again) === JSON.stringify(inputs) && DT.INPUT_TTL_SEC === 900);
  const later = await quiet(() => DT.readInsightInputs(env, DAY, Date.now() + 16 * 60_000));
  assert("after 15 minutes, or forced: read again", odooLog.length > 0 && later.days.length === 2 && (odooLog.length = 0, (await quiet(() => DT.readInsightInputs(env, DAY, Date.now(), true))).days.length === 2 && odooLog.length > 0));
}
{
  // a part that cannot be read is left empty and named — the others are read, and nothing is kept
  const env = world(); prices();
  past("2026-10-02", "published", [[1, 11, 52, 67, 67, 0.4]]);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/account.move.line/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no" }), { status: 403 });
    return real(input as any, init);
  }) as typeof fetch;
  let inputs: any;
  try { inputs = await quiet(() => DT.readInsightInputs(env, DAY)); } finally { globalThis.fetch = real; }
  assert("the expenses refused: «expenses» is named, they are null (the tab says «تعذّرت»), the days are still read", JSON.stringify(inputs.errors) === JSON.stringify(["expenses"]) && inputs.expenses === null && inputs.days.length === 1);
  odooLog.length = 0;
  await quiet(() => DT.readInsightInputs(env, DAY));
  assert("…and a failed read is not kept: the next run asks again", odooLog.length > 0);
  // the engine goes on whatever happens to the inputs
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/x_unavailable_request/") || url.includes("/json/2/account.move.line/")) return new Response("{}", { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await quiet(() => PR.refreshPriceDay(env, { force: true })); } finally { globalThis.fetch = real; }
  assert("the engine prices the day all the same, and the tabs are written with what could be read", r.action === "refreshed" && r.lines === 4 && lineFor(1).x_sale_price === 70 && String(dayOf().x_tab_money_html).includes("تعذّرت"));
}

done();
