// § 60 ب (2026-10-06) — the day's target against what was really sold.
//
//   [1] the plan: the mean contribution of the items that go out (simple; weighted by the last seven
//       days' real sales once they exist), T = (the day's cost + the profit target) ÷ it; a contribution
//       of nothing or less: «لا هدف ممكن بأسعار اليوم»
//   [2] the gap to the target by the order's formula, to the letter — the volume, the margin, the
//       waste, the costs — and THE FOUR ADD UP TO THE WHOLE GAP, always
//   [3] the lines: «أمس: بعنا Q من T (p%) — ربح أمس الحقيقي ±A ✅ / ❌» and «عجز 125: الكمية −110 ·
//       التالف −15»; no real sale: «لا مبيعات حقيقية بعد»
//   [4] the engine keeps the plan on the day with every run, and «هدف الربح اليومي» of the settings
//       counts from the first run after it
//   [5] the actual of a day, from the real orders delivered that Riyadh day — a simulation's never;
//       the waste from what the delivery form recorded («تالف», «رفضه العميل»), else the plan's
//   [6] with the 21:30 summary the actual is kept on the day's record, and the day after shows it
//       under «أمس» — a sentence and its numbers, no drawing
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-target.test.mts

import { odooLog, openWindow, quiet, rows, seed, setRiyadh, table } from "./wa-harness.mts";
import { C1, C1_PHONE, DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const DS = await import("../src/day-screen.ts");
const DI = await import("../src/day-insight.ts");
const OC = await import("../src/operating-cost.ts");

const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };
const NEXT = "2026-10-04";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const text = (html: unknown) => String(html ?? "").replace(/<\/div>/g, "\n").replace(/<[^>]*>/g, "").split("\n").map((l) => l.trim()).filter(Boolean);

/** The tenant on 2026-10-05 (the world of § 56): the day's cost 496.52 over 250 cartons, waste 5 %, a minimum profit of 2. */
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
/** A real order delivered at a Riyadh time, its lines [product, packaging, quantity, price, extra]. */
function delivered(at: string, lines: Array<[number, number, number, number, Record<string, unknown>?]>, extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: at.slice(0, 10), x_price_date: at.slice(0, 10), x_delivered_at: utc(at), x_created_via: "whatsapp", ...extra });
  for (const [p, k, q, price, more] of lines) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_status: "purchased", x_unit_price: price, x_price_unit_manual: 0, x_return_qty: 0, x_return_reason: false, ...(more ?? {}) });
  return id;
}
const PLAN = { margin: 3.1, waste: 0.6, contribution: 2.5, profitTarget: 0, cost: 350 };

// ================================================================ [1] the plan
console.log("\n[1] the plan: the mean contribution of what goes out, and T");
{
  const items = [{ key: "a", margin: 5.87, waste: 2.75 }, { key: "b", margin: 4.96, waste: 0.6 }];
  const p = DI.dayPlan(items, 496.52, 0);
  assert("a simple mean: m̄ 5.42, w̄ 1.68, c = m̄ − w̄ = 3.74; T = 496.52 ÷ 3.74 = 132.76 → «🎯 هدف اليوم: 133 كرتون»", p.margin === 5.42 && p.waste === 1.68 && p.contribution === 3.74 && p.basis === "simple" && p.items === 2 && Math.abs(p.target - 132.759358) < 1e-5 && DI.targetCartons(p.target) === 133 && DI.targetText(p) === "🎯 هدف اليوم: 133 كرتون", JSON.stringify(p));
  assert("the profit target joins the cost: (496.52 + 300) ÷ 3.74 = 212.97 → 213 cartons", DI.targetCartons(DI.dayPlan(items, 496.52, 300).target) === 213 && DI.dayPlan(items, 496.52, 300).profitTarget === 300);
  assert("a target that is not a positive number is 0", DI.dayPlan(items, 496.52, -50).profitTarget === 0 && DI.dayPlan(items, 496.52, NaN as any).profitTarget === 0);
  assert("a whole target is not rounded up past itself (200 stays 200), a hair over it is the next carton", DI.targetCartons(200) === 200 && DI.targetCartons(200.01) === 201 && DI.targetCartons(0) === 0);
  const mix = new Map([["a", 30], ["b", 10]]);
  const w = DI.dayPlan(items, 496.52, 0, mix);
  assert("real sales of the last seven days weigh the mean: (5.87 × 30 + 4.96 × 10) ÷ 40 = 5.64, waste 2.21, c 3.43 — «مرجّح بمبيعات آخر 7 أيام»", w.basis === "weighted" && w.margin === 5.64 && w.waste === 2.21 && w.contribution === 3.43 && DI.PLAN_BASIS_TEXT.weighted === "مرجّح بمبيعات آخر 7 أيام", JSON.stringify(w));
  assert("sales of other items alone weigh nothing: the mean stays simple", DI.dayPlan(items, 496.52, 0, new Map([["z", 99]])).basis === "simple" && DI.dayPlan(items, 496.52, 0, new Map()).basis === "simple");
  const none = DI.dayPlan([{ key: "a", margin: 1, waste: 1.5 }], 496.52, 0);
  assert("a contribution of nothing or less: no target — «🎯 هدف اليوم: لا هدف ممكن بأسعار اليوم»", none.target === 0 && none.why === "no_contribution" && DI.targetText(none) === "🎯 هدف اليوم: لا هدف ممكن بأسعار اليوم" && DI.dayPlan([{ key: "a", margin: 1, waste: 1 }], 100, 0).why === "no_contribution", JSON.stringify(none));
  assert("no item goes out, or the day's cost «تعذّر»: no target, and the line says which", DI.targetText(DI.dayPlan([], 496.52, 0)) === "🎯 هدف اليوم: لا صنف قابل للنشر اليوم" && DI.targetText(DI.dayPlan(items, null, 0)) === "🎯 هدف اليوم: تعذّر (تكلفة اليوم لم تُقرأ)" && DI.dayPlan(items, null, 0).target === 0);
  assert("how it is made, in one line", DI.targetFormula(p) === "(تكلفة التشغيل 496.52 + هدف الربح 0.00) ÷ متوسط مساهمة الكرتون 3.74 — متوسط بسيط لـ 2 أصناف" && DI.targetFormula(DI.dayPlan([], 1, 0)) === "", DI.targetFormula(p));
  assert("the plan as the day keeps it", JSON.stringify(DI.planVals(p)) === JSON.stringify({ x_plan_margin: 5.42, x_plan_waste: 1.68, x_plan_contribution: 3.74, x_plan_basis: "simple", x_profit_target: 0, x_target_cartons: 132.76 }), JSON.stringify(DI.planVals(p)));
  assert("«🎯 لتغطية التشغيل بأسعار اليوم تحتاج N كرتون»: the cost alone, whatever the profit target", DI.coverText(DI.dayPlan(items, 496.52, 300)) === "🎯 لتغطية التشغيل بأسعار اليوم تحتاج 133 كرتون" && DI.coverText(DI.dayPlan([], 496.52, 0)) === "" && DI.coverText(none).includes("لا هدف ممكن بأسعار اليوم"));
}

// ================================================================ [2] the four parts
console.log("\n[2] the gap to the target: the volume, the margin, the waste, the costs — they add up to it");
{
  // the order's example: a plan of 140 cartons, 96 delivered, the waste 15 over its plan
  const a = DI.dayActual(PLAN, { cartons: 96, marginTotal: 96 * 3.1, wasteRecorded: 96 * 0.6 + 15 });
  assert("T = (C_plan + P) ÷ c_plan = 350 ÷ 2.5 = 140; A = Q·m̄_act − W_act − C_act = 297.60 − 72.60 − 350 = −125", a.target === 140 && a.profit === -125 && a.gap === -125 && a.margin === 3.1 && a.waste === 72.6 && a.wasteReal && a.cost === 350, JSON.stringify(a));
  assert("the volume (Q − T)·c_plan = (96 − 140) × 2.5 = −110; the margin Q·(m̄_act − m̄_plan) = 0; the waste −(W_act − Q·w̄_plan) = −15; the costs −(C_act − C_plan) = 0", a.volume === -110 && a.marginVar === 0 && a.wasteVar === -15 && a.costVar === 0, JSON.stringify(a));
  assert("«عجز 125: الكمية −110 · التالف −15»", DI.gapLine(a) === "عجز 125: الكمية −110 · التالف −15", DI.gapLine(a));
  const raw = DI.varianceParts(PLAN, { cartons: 96, marginTotal: 96 * 3.4, waste: 80, cost: 380 });
  assert("the formula to the letter, each part by itself", Math.abs(raw[0] - (96 - 140) * 2.5) < 1e-9 && Math.abs(raw[1] - 96 * (3.4 - 3.1)) < 1e-9 && Math.abs(raw[2] + (80 - 96 * 0.6)) < 1e-9 && Math.abs(raw[3] + (380 - 350)) < 1e-9, JSON.stringify(raw));
  const none = DI.dayActual(PLAN, { cartons: 96, marginTotal: 96 * 3.1, wasteRecorded: null });
  assert("nothing recorded as waste: W_act = Q × w̄_plan (57.60), said not to be a recorded one, and the waste's part is nothing", none.waste === 57.6 && none.wasteReal === false && none.wasteVar === 0 && none.profit === -110 && DI.gapLine(none) === "عجز 110: الكمية −110", JSON.stringify(none));
  assert("C_act = C_plan by the day: the costs' part is nothing unless a cost is given", none.cost === 350 && none.costVar === 0 && DI.dayActual(PLAN, { cartons: 96, marginTotal: 297.6, wasteRecorded: null }, 380).costVar === -30);
  const over = DI.dayActual({ ...PLAN, profitTarget: 50 }, { cartons: 200, marginTotal: 200 * 3.3, wasteRecorded: 100 });
  assert("above the target: «فائض 110: الكمية +100 · الهامش +40 · التالف +20 … » adds up with a profit target of 50", over.target === 160 && over.gap === 160 && over.volume === 100 && over.marginVar === 40 && over.wasteVar === 20 && DI.gapLine(over) === "فائض 160: الكمية +100 · الهامش +40 · التالف +20", JSON.stringify(over));
  assert("exactly on the target: «على الهدف»", DI.gapLine(DI.dayActual(PLAN, { cartons: 140, marginTotal: 140 * 3.1, wasteRecorded: null })) === "على الهدف");

  // THE FOUR ADD UP TO THE WHOLE GAP — whatever the numbers (a fixed pseudo-random run), to the halala and to the riyal
  let seedN = 20261006, bad = "";
  const rnd = () => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN / 2147483648; };
  for (let i = 0; i < 4000 && !bad; i++) {
    const margin = Math.round(rnd() * 900) / 100, waste = Math.round(rnd() * 200) / 100;
    const plan = { margin, waste, contribution: Math.round((margin - waste) * 100) / 100, profitTarget: i % 3 ? 0 : Math.round(rnd() * 40000) / 100, cost: Math.round(rnd() * 90000) / 100 };
    const Q = i % 7 ? Math.round(rnd() * 40000) / 100 : Math.round(rnd() * 400);
    const x = DI.dayActual(plan, { cartons: Q, marginTotal: Q * (rnd() * 9), wasteRecorded: i % 2 ? rnd() * 300 : null }, i % 5 ? plan.cost : plan.cost + rnd() * 100);
    const sum = Math.round((x.volume + x.marginVar + x.wasteVar + x.costVar) * 100) / 100;
    const whole = DI.splitExact(x.gap, [x.volume, x.marginVar, x.wasteVar, x.costVar], 0);
    if (sum !== x.gap || Math.round((x.profit - x.profitTarget) * 100) / 100 !== x.gap || whole.reduce((s, v) => s + v, 0) !== Math.round(x.gap)) bad = JSON.stringify({ plan, x, sum, whole });
  }
  assert("the volume + the margin + the waste + the costs = A − P, the whole gap: to the halala as kept, to the riyal as written — 4000 days", bad === "", bad);
  assert("…and a gap larger than rounding can make is never smoothed over: the parts are left as they are (a formula that lost a term is seen)", JSON.stringify(DI.splitExact(100, [30, 20, 10])) === JSON.stringify([30, 20, 10]) && JSON.stringify(DI.splitExact(-125, [-110, -15, 0, 50], 0)) === JSON.stringify([-110, -15, 0, 50]));
  assert("what rounding leaves over goes to the largest part", JSON.stringify(DI.splitExact(10, [3.333, 3.333, 3.334])) === JSON.stringify([3.34, 3.33, 3.33]) && JSON.stringify(DI.splitExact(-125, [-110.4, -14.4, -0.2, 0], 0)) === JSON.stringify([-111, -14, -0, 0].map((v) => v + 0)) && JSON.stringify(DI.splitExact(1, [0.5, 0.5], 0).sort()) === JSON.stringify([0, 1]));
}

// ================================================================ [3] the lines
console.log("\n[3] the lines: «أمس: بعنا Q من T (p%) — ربح أمس الحقيقي ±A» and the gap by its parts");
{
  const a = DI.dayActual(PLAN, { cartons: 96, marginTotal: 96 * 3.1, wasteRecorded: 96 * 0.6 + 15 });
  assert("«أمس: بعنا 96 من 140 (69%) — ربح أمس الحقيقي −125 ❌» then «عجز 125: الكمية −110 · التالف −15»", JSON.stringify(DI.actualLines(a, "أمس")) === JSON.stringify(["أمس: بعنا 96 من 140 (69%) — ربح أمس الحقيقي −125 ❌", "عجز 125: الكمية −110 · التالف −15"]), DI.actualLines(a, "أمس").join(" | "));
  const good = DI.dayActual(PLAN, { cartons: 150, marginTotal: 150 * 3.1, wasteRecorded: null });
  assert("the target reached: ✅, and «اليوم» for the day itself", DI.actualLines(good, "اليوم")[0] === "اليوم: بعنا 150 من 140 (107%) — ربح اليوم الحقيقي +25 ✅" && DI.actualLines(good, "اليوم")[1] === "فائض 25: الكمية +25");
  assert("no real delivery: «أمس: لا مبيعات حقيقية بعد» alone; not computed: one line that says so", JSON.stringify(DI.actualLines(DI.dayActual(PLAN, { cartons: 0, marginTotal: 0, wasteRecorded: null }), "أمس")) === JSON.stringify(["أمس: لا مبيعات حقيقية بعد"]) && JSON.stringify(DI.actualLines(null, "أمس")) === JSON.stringify(["أمس: لم تُحسب أرقامه بعد (تُحسب مع ملخص 21:30)"]));
  assert("a day that had no target: «بعنا 12.5 كرتون (بلا هدف)»", DI.actualLines({ ...a, cartons: 12.5, target: 0 }, "أمس")[0].startsWith("أمس: بعنا 12.5 كرتون (بلا هدف) — ربح أمس الحقيقي"));
  assert("the 🎯 line of «خلاصة اليوم»: the largest reason alone — «🎯 أمس: بعنا 96 من 140 (69%) — ربح −125 ❌، أكبر سبب: الكمية −110»", DI.briefActualLine(a, "أمس") === "🎯 أمس: بعنا 96 من 140 (69%) — ربح −125 ❌، أكبر سبب: الكمية −110" && DI.briefActualLine(null, "أمس") === "🎯 أمس: لم تُحسب أرقامه بعد" && DI.briefActualLine({ ...a, cartons: 0 }, "اليوم") === "🎯 اليوم: لا مبيعات حقيقية بعد", DI.briefActualLine(a, "أمس"));
  assert("…the LARGEST of the four, whichever it is: «أكبر سبب: التالف −115»", DI.briefActualLine({ ...a, volume: -10, wasteVar: -115 }, "أمس").endsWith("، أكبر سبب: التالف −115") && DI.briefActualLine({ ...a, gap: 0, volume: 0, wasteVar: 0, profit: 0 }, "أمس") === "🎯 أمس: بعنا 96 من 140 (69%) — ربح 0 ✅");
  const p = DI.dayPlan([{ key: "a", margin: 3.1, waste: 0.6 }], 350, 0);
  const html = DI.targetHtml(p, a);
  assert("«🎯 الهدف مقابل الفعلي» under the tiles: a sentence and its numbers — the target, how it is made, yesterday and its gap", JSON.stringify(text(html)) === JSON.stringify(["🎯 هدف اليوم: 140 كرتون", "(تكلفة التشغيل 350.00 + هدف الربح 0.00) ÷ متوسط مساهمة الكرتون 2.50 — متوسط بسيط لـ 1 صنف", "أمس: بعنا 96 من 140 (69%) — ربح أمس الحقيقي −125 ❌", "عجز 125: الكمية −110 · التالف −15"]), text(html).join(" | "));
  assert("…no drawing: div and span alone, class and dir alone, no style at all — and a number reads left to right («21:30» whole)", !/style=|<svg|<style|position:|background/.test(html) && [...html.matchAll(/<(\w+)/g)].every((m) => m[1] === "div" || m[1] === "span") && html.includes(`<span dir="ltr">−125</span>`) && html.includes(`<span dir="ltr">69%</span>`) && DI.targetHtml(p, null).includes(`<span dir="ltr">21:30</span>`));
  assert("once the day itself is closed its own line joins: «اليوم: …» after «أمس»", text(DI.targetHtml(p, a, good)).join(" | ").includes("عجز 125: الكمية −110 · التالف −15 | اليوم: بعنا 150 من 140 (107%) — ربح اليوم الحقيقي +25 ✅ | فائض 25: الكمية +25"));
  assert("a day with no day before it on record: no «أمس» line at all", text(DI.targetHtml(p, undefined)).length === 2);
}

// ================================================================ [4] the engine keeps the plan
console.log("\n[4] the engine keeps the plan on the day with every run");
{
  const env = world(); prices();
  await engine(env);
  const d = dayOf();
  // what goes out as things stand: the banana at 70 (5.87 / 2.75) and the small pomegranate at its suggested 19.50 (4.96 / 0.60)
  assert("the day's plan: m̄ 5.42, w̄ 1.68, c 3.74, a simple mean, P 0, T 132.76", d.x_plan_margin === 5.42 && d.x_plan_waste === 1.68 && d.x_plan_contribution === 3.74 && d.x_plan_basis === "simple" && d.x_profit_target === 0 && d.x_target_cartons === 132.76, JSON.stringify([d.x_plan_margin, d.x_plan_waste, d.x_plan_contribution, d.x_plan_basis, d.x_profit_target, d.x_target_cartons]));
  assert("…made of the rows that go out, each at its own price", JSON.stringify(DS.planItems(DS.screenRows(await quiet(() => PR.readLines(env, d.id)), "market", DAY, "draft"))) === JSON.stringify([{ key: "1:11", margin: 5.87, waste: 2.75 }, { key: "3:31", margin: 4.96, waste: 0.6 }]));
  assert("under the tiles: «🎯 هدف اليوم: 133 كرتون», how it is made, and — the day before has no numbers yet — «أمس: لم تُحسب أرقامه بعد»", JSON.stringify(text(d.x_target_html)) === JSON.stringify(["🎯 هدف اليوم: 133 كرتون", "(تكلفة التشغيل 496.52 + هدف الربح 0.00) ÷ متوسط مساهمة الكرتون 3.74 — متوسط بسيط لـ 2 أصناف", "أمس: لم تُحسب أرقامه بعد (تُحسب مع ملخص 21:30)"]), text(d.x_target_html).join(" | "));
  assert("readPricingSettings reads «هدف الربح اليومي»: 0 by default", (await quiet(() => OC.readPricingSettings(env, DAY)))?.profitTarget === 0);
  // «هدف الربح اليومي» = 300 in the settings: it counts from the first run after it
  table("x_pricing_config").get(1)!.x_daily_profit_target = 300;
  assert("…a positive number is read as it is; a negative one or a word is 0", (await quiet(() => OC.readPricingSettings(env, DAY)))?.profitTarget === 300 && (table("x_pricing_config").get(1)!.x_daily_profit_target = -5, (await quiet(() => OC.readPricingSettings(env, DAY)))?.profitTarget) === 0);
  table("x_pricing_config").get(1)!.x_daily_profit_target = 300;
  assert("before the next run the day still holds the plan it was computed with", dayOf().x_profit_target === 0 && dayOf().x_target_cartons === 132.76);
  await engine(env);
  assert("the next run: P 300 → T (496.52 + 300) ÷ 3.74 = 212.97 → «🎯 هدف اليوم: 213 كرتون»", dayOf().x_profit_target === 300 && dayOf().x_target_cartons === 212.97 && text(dayOf().x_target_html)[0] === "🎯 هدف اليوم: 213 كرتون" && text(dayOf().x_target_html)[1].startsWith("(تكلفة التشغيل 496.52 + هدف الربح 300.00)"), text(dayOf().x_target_html).join(" | "));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // no item goes out (no market, no purchase): no target
  const env = world();
  await engine(env);
  assert("a day with nothing to publish: T 0 and «🎯 هدف اليوم: لا صنف قابل للنشر اليوم»", dayOf().x_target_cartons === 0 && text(dayOf().x_target_html)[0] === "🎯 هدف اليوم: لا صنف قابل للنشر اليوم", text(dayOf().x_target_html).join(" | "));
}

// ================================================================ [5] what was really delivered
console.log("\n[5] the actual of a day: the real orders delivered that Riyadh day");
{
  const env = world(); prices();
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  delivered(`${DAY} 09:00`, [[1, 11, 10, 70], [3, 31, 6, 19.5]]);
  delivered(`${DAY} 23:30`, [[1, 11, 2, 70]]);                                         // the same Riyadh day, late
  delivered(`${NEXT} 00:10`, [[1, 11, 50, 70]]);                                        // the next Riyadh day
  delivered("2026-10-02 23:50", [[1, 11, 40, 70]], { x_price_date: DAY });              // the day before
  delivered(`${DAY} 10:00`, [[1, 11, 99, 70]], { x_utak_simulation: true });            // a simulation's order
  seed("x_daily_order", { x_customer_id: C1, x_state: "confirmed", x_order_date: DAY, x_price_date: DAY, x_delivered_at: false });   // not delivered
  const sold = await quiet(() => DI.readSoldLines(env, DAY, DAY));
  assert("the day's delivered lines alone: two orders, three lines, 18 cartons — the next day's, the day before's, the simulation's and the one not delivered are out", sold.orders === 2 && sold.lines.length === 3 && sold.lines.reduce((a: number, l: any) => a + l.quantity, 0) === 18 && sold.lines.every((l: any) => l.day === DAY && l.priceDay === DAY), JSON.stringify(sold.lines));
  assert("each line carries its own price and the purchase price of its price day (banana 55, small pomegranate 12)", JSON.stringify(sold.lines.map((l: any) => [l.key, l.quantity, l.sale, l.purchase])) === JSON.stringify([["1:11", 10, 70, 55], ["3:31", 6, 19.5, 12], ["1:11", 2, 70, 55]]));
  const input = DI.actualInput(sold.lines, DAY, 15);
  assert("Q 18; Σ (sale ÷ 1.15 − purchase) = 12 × 5.8696 + 6 × 4.9565 = 100.17; nothing recorded as waste", input.cartons === 18 && Math.abs(input.marginTotal - (12 * (70 / 1.15 - 55) + 6 * (19.5 / 1.15 - 12))) < 1e-9 && input.wasteRecorded === null, JSON.stringify(input));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // what the delivery form recorded: «تالف» and «رفضه العميل» are waste at the purchase price; «ناقص» was never there
  const env = world(); prices();
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  const o = delivered(`${DAY} 09:00`, [
    [1, 11, 8, 70, { x_ordered_qty: 10, x_return_qty: 2, x_return_reason: "damaged" }],
    [3, 31, 6, 19.5, { x_ordered_qty: 7, x_return_qty: 1, x_return_reason: "short" }],
    [4, 41, 0, 28, { x_status: "unavailable", x_ordered_qty: 3, x_return_qty: 3, x_return_reason: "refused" }],
    [2, 21, 5, 0, { x_status: "unavailable" }],                                          // § 59: not in the list — its 5 cartons were never delivered, nothing returned
  ]);
  const sold = await quiet(() => DI.readSoldLines(env, DAY, DAY));
  const input = DI.actualInput(sold.lines, DAY, 15);
  assert("W_act = 2 × 55 (damaged) + 3 × 22 (refused) = 176 — the short carton is no waste; Q = 14 delivered", input.wasteRecorded === 176 && input.cartons === 14 && sold.lines.length === 3 && DI.WASTE_REASONS.has("damaged") && DI.WASTE_REASONS.has("refused") && !DI.WASTE_REASONS.has("short"), JSON.stringify([input, sold.lines]));
  // an invoice's discount comes off the margin, as the customer saw it (the lines 677 − the invoice 650 = 27, net 23.48)
  seed("x_invoice", { x_invoice_number: "UTAK-INV-1", x_order_id: o, x_invoice_date: DAY, x_status: "issued", x_total: 650 });
  seed("x_invoice", { x_invoice_number: "UTAK-INV-SIM", x_order_id: o, x_invoice_date: DAY, x_status: "issued", x_total: 1, x_utak_simulation: true });
  const withInvoice = await quiet(() => DI.readSoldLines(env, DAY, DAY));
  assert("an invoice's discount comes off the day's margin: 8 × 70 + 6 × 19.5 = 677 against 650 → 27 ÷ 1.15 (a simulation's invoice never)", withInvoice.discount.get(DAY) === 27 && Math.abs(DI.actualInput(withInvoice.lines, DAY, 15, 27).marginTotal - (input.marginTotal - 27 / 1.15)) < 1e-9, JSON.stringify([...withInvoice.discount]));
}
{
  // a line keeps the purchase price of ITS price day, and Baraa's own price on a line is the price it was sold at
  const env = world(); prices();
  const before = seed("x_price_day", { x_date: "2026-10-02", x_state: "published", x_name: "أسعار اليوم 2026-10-02", x_utak_simulation: false });
  seed("x_price_day_line", { x_day_id: before, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 50, x_market_price: 66, x_sale_price: 66, x_utak_simulation: false });
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  delivered(`${DAY} 08:00`, [[1, 11, 4, 66]], { x_price_date: "2026-10-02", x_order_date: "2026-10-02" });   // ordered and priced the day before, delivered today
  delivered(`${DAY} 09:00`, [[1, 11, 3, 70, { x_price_unit_manual: 72 }]]);                                   // his own price on the line
  const sold = await quiet(() => DI.readSoldLines(env, DAY, DAY));
  assert("an order priced the day before and delivered today: the purchase price of its price day (50), not today's (55); a line with his own price: sold at it (72)", JSON.stringify(sold.lines.map((l: any) => [l.priceDay, l.quantity, l.sale, l.purchase])) === JSON.stringify([["2026-10-02", 4, 66, 50], [DAY, 3, 72, 55]]), JSON.stringify(sold.lines));
  const inputs: any = { day: DAY, sold: [{ day: "2026-09-23", key: "1:11", quantity: 50 }, { day: "2026-09-30", key: "1:11", quantity: 7 }, { day: "2026-10-02", key: "3:31", quantity: 2 }, { day: DAY, key: "3:31", quantity: 99 }, { day: "2026-10-01", key: "2:21", quantity: 0 }] };
  assert("the plan's weights: the cartons delivered in the seven days BEFORE the day — an older one, the day's own and a line of nothing never", JSON.stringify([...DS.salesMix(inputs)]) === JSON.stringify([["1:11", 7], ["3:31", 2]]), JSON.stringify([...DS.salesMix(inputs)]));
}
{
  const env = world(); prices();
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  delivered(`${DAY} 09:00`, [[1, 11, 5, 0]]);
  let err = "";
  try { await quiet(() => DI.readSoldLines(env, DAY, DAY)); } catch (e) { err = (e as Error).message; }
  assert("a delivered line without a sale price: an error, never a partial sum", err === "a delivered line without a sale price", err);
  rows("x_daily_order_line").forEach((l: any) => { l.x_unit_price = 70; l.x_product_tmpl_id = 2; l.x_packaging_id = 21; });
  rows("x_price_day_line").filter((l: any) => l.x_product_tmpl_id === 2).forEach((l: any) => { l.x_cost_price = 0; });
  err = "";
  try { await quiet(() => DI.readSoldLines(env, DAY, DAY)); } catch (e) { err = (e as Error).message; }
  assert("…nor one without its day's purchase price", err === "a delivered line without its day's purchase price", err);
}

// ================================================================ [6] kept with the summary, shown the day after
console.log("\n[6] the actual is kept on the day's record with the 21:30 summary, and shown the day after under «أمس»");
{
  const env = world(); prices();
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  delivered(`${DAY} 09:00`, [[1, 11, 10, 70], [3, 31, 6, 19.5]]);
  odooLog.length = 0;
  const dry = await quiet(() => DI.computeDayActual(env, DAY, Date.now(), { dry: true }));
  // Q 16; Σ margins 58.70 + 29.74 = 88.43; W_act = 16 × 1.68 = 26.88 (the plan's); A = 88.43 − 26.88 − 496.52 = −434.97
  assert("read alone: Q 16 of T 132.76, A −434.97 = the volume −436.68 + the margin +1.71", dry.dayId === dayOf().id && dry.target === 132.76 && dry.actual.cartons === 16 && dry.actual.profit === -434.97 && dry.actual.gap === -434.97 && dry.actual.volume === -436.68 && dry.actual.marginVar === 1.71 && dry.actual.wasteVar === 0 && dry.actual.costVar === 0, JSON.stringify(dry));
  assert("…and nothing is written", odooLog.every((x) => x.method !== "write" && x.method !== "create") && !dayOf().x_act_at);
  const kept = await quiet(() => DI.computeDayActual(env, DAY, Date.now()));
  const d = dayOf();
  assert("kept on the day's own record: the cartons, the margin, the waste (the plan's: not a recorded one), the cost, the profit, the four parts, and when",
    kept.actual.profit === -434.97 && d.x_act_cartons === 16 && d.x_act_margin === 5.53 && d.x_act_waste === 26.88 && d.x_act_waste_real === false && d.x_act_cost === 496.52 && d.x_act_profit === -434.97
    && d.x_var_volume === -436.68 && d.x_var_margin === 1.71 && d.x_var_waste === 0 && d.x_var_cost === 0 && d.x_act_at === utc(`${DAY} 21:30`), JSON.stringify([d.x_act_cartons, d.x_act_margin, d.x_act_waste, d.x_act_cost, d.x_act_profit, d.x_var_volume, d.x_var_margin, d.x_act_at]));
  assert("…in ONE write of the actual's own fields (no price, no state)", odooLog.filter((x) => x.method === "write").length === 1 && Object.keys(odooLog.find((x) => x.method === "write")!.body.vals).every((k) => (DI.ACTUAL_FIELDS as readonly string[]).includes(k)));
  assert("the stored record reads back as the lines write it", JSON.stringify(DI.actualLines(DI.actualOfRecord(d), "أمس")) === JSON.stringify(["أمس: بعنا 16 من 133 (12%) — ربح أمس الحقيقي −435 ❌", "عجز 435: الكمية −437 · الهامش +2"]), DI.actualLines(DI.actualOfRecord(d), "أمس").join(" | "));
  // the day after, 04:00: its screen shows yesterday against yesterday's own target
  setRiyadh(`${NEXT} 04:00`); prices(NEXT);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const next = dayOf(NEXT);
  assert("the day after, under the tiles: «أمس: بعنا 16 من 133 (12%) — ربح أمس الحقيقي −435 ❌» and «عجز 435: الكمية −437 · الهامش +2»", text(next.x_target_html).slice(2).join(" | ") === "أمس: بعنا 16 من 133 (12%) — ربح أمس الحقيقي −435 ❌ | عجز 435: الكمية −437 · الهامش +2", text(next.x_target_html).join(" | "));
  assert("…and the plan of the day after is weighted by what was really sold (10 bananas, 6 small pomegranates): «مرجّح بمبيعات آخر 7 أيام»", next.x_plan_basis === "weighted" && next.x_plan_margin === 5.53 && text(next.x_target_html)[1].includes("مرجّح بمبيعات آخر 7 أيام"), `${next.x_plan_basis} ${next.x_plan_margin} ${text(next.x_target_html)[1]}`);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a day with no real delivery, and a day with no price record at all
  const env = world(); prices();
  await engine(env);
  setRiyadh(`${DAY} 21:30`);
  const none = await quiet(() => DI.computeDayActual(env, DAY, Date.now()));
  assert("no real delivery: Q 0 is kept (computed), and the line is «لا مبيعات حقيقية بعد»", none.actual.cartons === 0 && !!dayOf().x_act_at && dayOf().x_act_cartons === 0 && DI.actualLines(DI.actualOfRecord(dayOf()), "أمس")[0] === "أمس: لا مبيعات حقيقية بعد");
  setRiyadh(`${NEXT} 21:30`);
  odooLog.length = 0;
  const noDay = await quiet(() => DI.computeDayActual(env, NEXT, Date.now()));
  assert("no price record for the day: nothing is written, the cost is the day's own (never 0)", noDay.dayId === 0 && noDay.target === 0 && odooLog.every((x) => x.method !== "write") && noDay.actual.profit === -496.52, JSON.stringify(noDay));
}

done();
