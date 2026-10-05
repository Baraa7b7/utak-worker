// § 55 أ (2026-10-05) — the day's price review made plain: «ربحنا» signed, and where our price stands.
//
//   [أ1] «ربحنا»: the net of a carton by the board's own formula, with the numbers of 2026-10-05 (the
//        record #54) — banana +1.13, medium −0.35, small +2.37 at the suggested price, large −0.74 /
//        +2.30 — against the board's stored fields; the sign and the two decimals
//   [أ2] the message: the note under the title, a line an item with its mark, no «الفرق», the three
//        lines at the bottom, the three new buttons
//   [أ3] an outlier: ⚠️ and its second line «(آخر سعر ← اليوم)»; a row Baraa decided; 🔻
//   [أ4] the length: the table as text with the three lines by name, the buttons under them by number
//   [أ5] the buttons do what § 54's did; the confirmation with each profit and «متوسط الربح للكرتون»
//   [أ6] the form utak_owner_review_v2: its JSON against what the worker sends; two lines an item; every
//        choice with its profit within Meta's thirty characters; its reply; a form of before § 55
//   [أ7] the trial to Baraa: nothing written, nothing published
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s55.test.mts

import { readFileSync } from "node:fs";
import { OWNER, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, C1_PHONE, DAY, DRIVER, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const RV = await import("../src/price-review.ts");
const PB = await import("../src/pricing-board.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s55-flows.mjs");
// @ts-ignore — plain .mjs helpers
const V1 = await import("../scripts/lib/s54-flows.mjs");

const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };

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
const review = (env: any, now?: number) => quiet(() => RV.notifyPriceReviewMessage(env, now));
const owner = () => sentTo(OWNER);
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const buttonIds = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.id ?? ""));
const buttonTitles = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.title ?? ""));
const withButtons = () => owner().filter((b: any) => b?.interactive?.type === "button");
const texts = () => owner().filter((b: any) => b?.type === "text").map(bodyOf);
const flows = () => owner().filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const line = (p: number) => lineFor(p) as any;
const tap = (env: any, id: string, now?: number) => quiet(() => RV.handlePriceReviewButton(env, id, now));
let wamid = 0;
const formReply = (env: any, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => RV.handlePriceReviewReply(env, { from: "+" + OWNER, messageId: `wamid.S${++wamid}`, flow: { token, values } }, undefined, now));
const hook = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const lineWrites = () => odooLog.filter((c: any) => c.model === "x_price_day_line" && (c.method === "write" || c.method === "create")).length;
const dayWrites = () => odooLog.filter((c: any) => c.model === "x_price_day" && c.method === "write" && "x_state" in (c.body?.vals ?? {})).length;
const rowsOf = (env: any) => quiet(() => RV.dayReviewRows(env, dayOf()));
const count = (s: string) => [...s].length;
/** A hand-made row: purchase 55, market 70 — the banana of 10-05 (a full cost of 59.74). */
const row = (o: Record<string, unknown> = {}): any => ({
  lineId: 1, productId: 1, name: "موز", purchase: 55, market: 70, sale: 70, upliftPct: 0, breakEven: 68.7, suggested: 71.5, fullCost: 59.74, vatPct: 15,
  proposal: { kind: "market", price: 70, why: "below_suggested", outlier: false, auto: true }, decision: null, decidedPrice: 0, ...o,
});
const SKIP = { kind: "skip", price: 0, why: "loss", outlier: false, auto: false };

// ================================================================ أ1
console.log("\n[أ1] «ربحنا»: the net of a carton, by the board's own formula, with the numbers of 2026-10-05");
{
  const env = world(); prices();
  await engine(env);
  const r = await rowsOf(env);
  const at = (i: number, price: number) => RV.profitAt(r[i], price);
  assert("the full cost of a carton is the board's: 59.74 · 17.74 · 14.59 · 25.09 (purchase + 5 % waste + the share 1.99)", JSON.stringify(r.map((x: any) => x.fullCost)) === JSON.stringify([59.74, 17.74, 14.59, 25.09])
    && [1, 2, 3, 4].every((p, i) => line(p).x_full_cost === r[i].fullCost), JSON.stringify(r.map((x: any) => x.fullCost)));
  assert("banana at the market price 70: +1.13 (70 ÷ 1.15 = 60.87 − 59.74)", at(0, 70) === 1.13 && RV.signed(at(0, 70)!) === "+1.13", String(at(0, 70)));
  assert("medium pomegranate at the market price 20: −0.35", at(1, 20) === -0.35 && RV.signed(at(1, 20)!) === "−0.35", String(at(1, 20)));
  assert("small pomegranate at the suggested price 19.50: +2.37 (no market price)", at(2, 19.5) === 2.37 && RV.signed(at(2, 19.5)!) === "+2.37", String(at(2, 19.5)));
  assert("large pomegranate: −0.74 at the market price 28, +2.30 at the suggested 31.50", at(3, 28) === -0.74 && at(3, 31.5) === 2.3 && RV.signed(at(3, 31.5)!) === "+2.30", JSON.stringify([at(3, 28), at(3, 31.5)]));
  // the board's own stored numbers (src/pricing-board.ts boardLine): the same amounts, to the halala
  assert("…the same as the board's «الربح الحقيقي» of each line with a market price (x_real_profit: 1.13 · −0.35 · −0.74)", line(1).x_real_profit === at(0, 70) && line(2).x_real_profit === at(1, 20) && line(4).x_real_profit === at(3, 28),
    JSON.stringify([1, 2, 4].map((p) => line(p).x_real_profit)));
  assert("…and as its preview at the suggested price (x_preview_profit: medium 2.26 · small 2.37 · large 2.30)", line(2).x_preview_profit === at(1, 23) && line(3).x_preview_profit === at(2, 19.5) && line(4).x_preview_profit === at(3, 31.5) && at(1, 23) === 2.26,
    JSON.stringify([2, 3, 4].map((p) => line(p).x_preview_profit)));
  const b = PB.boardLine({ purchase: 22, sale: 28, approved: false, wastePct: 5, vatRatePct: 15, opShare: 1.99, minProfit: 2 });
  assert("…boardLine itself, from the inputs: the large pomegranate's −0.74 and +2.30", b.x_real_profit === -0.74 && b.x_preview_profit === 2.3 && b.x_full_cost === 25.09, JSON.stringify(b));
  assert("the sign is always written, with two decimals: «+1.13», «−0.74» (U+2212), «+2.30», «+12.00»; zero has none: «0.00»",
    RV.signed(1.13) === "+1.13" && RV.signed(-0.74) === "−0.74" && RV.signed(2.3) === "+2.30" && RV.signed(12) === "+12.00" && RV.signed(0) === "0.00" && RV.signed(-0.004) === "0.00" && RV.signed(-0.74).charCodeAt(0) === 0x2212);
  assert("no purchase price, no full cost, or no price: no profit is made up (null)", RV.profitAt(row({ purchase: 0 }), 70) === null && RV.profitAt(row({ fullCost: 0 }), 70) === null && RV.profitAt(row(), 0) === null);
  assert("before the VAT cutoff nothing is divided by 1.15 (the day's rate is null)", RV.profitAt(row({ vatPct: null }), 70) === 10.26 && RV.reviewRows(await PR.readLines(env, dayOf().id), "market", "2026-09-30")[0].vatPct === null && r[0].vatPct === 15);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ2
console.log("\n[أ2] the message of 04:00: the note, a line an item with its mark, the three lines, the three buttons");
{
  const env = world(); prices();
  await engine(env);
  const r = await review(env);
  assert("04:00 → ONE message, with buttons", r.action === "sent" && owner().length === 1 && withButtons().length === 1, JSON.stringify(r));
  const body = bodyOf(owner()[0]);
  const want = [
    "📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026",
    "(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)",
    "",
    "✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70",
    "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر",
    "✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50",
    "❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر",
    "",
    "لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50",
    "وما ينتشر: رمان وسط، رمان كبير",
    "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70",
  ];
  const L = body.split("\n");
  assert("the whole message, line for line", body === want.join("\n"), body);
  assert("the line under the title says what «الربح» is", L[1] === RV.PROFIT_NOTE && RV.PROFIT_NOTE === "(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)", L[1]);
  assert("«الفرق Z (P%)» is gone from the message", !body.includes("الفرق") && !/\(\d+%\)/.test(body), body);
  assert("every item carries its purchase price and, beside it, × 1.15 with two decimals — 63.25 · 17.25 · 13.80 · 25.30 — before the market", JSON.stringify(L.slice(3, 7).map((l) => /— (شراء [\d.]+ \([\d.]+ شامل\)) · /.exec(l)?.[1])) === JSON.stringify(["شراء 55 (63.25 شامل)", "شراء 15 (17.25 شامل)", "شراء 12 (13.80 شامل)", "شراء 22 (25.30 شامل)"]), L.slice(3, 7).join(" | "));
  assert("every item's line opens with its mark: ✅ published with a profit, ❌ «لا تنشر»", L.slice(3, 7).map((l) => [...l][0]).join("") === "✅❌✅❌", L.slice(3, 7).join(" | "));
  assert("every profit carries its sign and two decimals", L.slice(3, 7).every((l) => /: [+−]\d+\.\d{2} ←/.test(l)), L.slice(3, 7).join(" | "));
  assert("the three lines at the bottom: what «نفّذ المقترح» publishes, what it does not, and what goes out at 6 with no tap", L.at(-3) === want.at(-3) && L.at(-2) === want.at(-2) && L.at(-1) === want.at(-1), L.slice(-3).join(" | "));
  assert("the summary of § 54 («N للنشر · M لا تنشر · K ⚠️», «بلا قرارك حتى 06:00…») is gone", !/للنشر ·/.test(body) && !body.includes("بلا قرارك"), body);
  assert("the three buttons, in order: «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء»", JSON.stringify(buttonTitles(owner()[0])) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء"]), JSON.stringify(buttonTitles(owner()[0])));
  assert("…their ids are § 54's (the day, the version): the same actions under new names", JSON.stringify(buttonIds(owner()[0])) === JSON.stringify([`prv_a_${dayOf().id}_1`, `prv_r_${dayOf().id}_1`, `prv_n_${dayOf().id}_1`]));
  assert("…each within Meta's twenty characters; the button under a confirmation is «✏️ عدّل» too", [RV.REVIEW_BUTTON_ALL, RV.REVIEW_BUTTON_FORM, RV.REVIEW_BUTTON_NONE, RV.REVIEW_BUTTON_EDIT].every((t) => count(t) <= 20) && RV.REVIEW_BUTTON_EDIT === RV.REVIEW_BUTTON_FORM);
  assert("the old names are in no text the worker sends («اعتمد الكل كما هو», «✏️ مراجعة», «لا تنشر اليوم», «✏️ تعديل»)",
    ["price-review.ts", "prices.ts"].every((f) => !srcOf(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).some((l) => /اعتمد الكل|✏️ مراجعة|لا تنشر اليوم|✏️ تعديل/.test(l.replace(/\/\*\*.*?\*\//g, "").replace(/\/\/.*$/, "")))));
  assert("it went to Baraa alone, and nothing is held", graph.every((b: any) => b.to === OWNER) && heldFor(env, OWNER).length === 0);
  const again = await review(env);
  assert("nothing changed → the review is not sent again", again.action === "sent_before" && owner().length === 1, JSON.stringify(again));
  // the day's cost is corrected: the banana still goes out at 70, but «ربحنا» is another number → the review again
  (rows("x_operating_cost")[0] as any).x_amount = 746.52;     // a share of 2.99: the banana's full cost 60.74 → +0.13 at 70
  setRiyadh(`${DAY} 04:20`);
  await engine(env);
  const upd = await review(env);
  const b2 = bodyOf(owner().at(-1));
  assert("a change of the cost alone changes «ربحنا» → «🔄 تحديث» naming the banana, with its new profit (+0.13 at the same 70)", upd.action === "sent" && upd.ver === 2 && b2.startsWith("🔄 تحديث مراجعة أسعار اليوم (04:20)")
    && /^تغيّر: .*موز أمريكي/m.test(b2) && b2.includes("✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +0.13 ← انشر بـ 70"), JSON.stringify([upd, b2]));
  const r0 = (await rowsOf(env))[0];
  assert("…a waiting row's signature covers its full cost", RV.rowSig(r0).endsWith(":60.74") && RV.rowSig(r0) !== RV.rowSig({ ...r0, fullCost: 59.74 }) && RV.rowSig(r0) === RV.rowSig({ ...r0 }), RV.rowSig(r0));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the lines one by one, pure
  assert("«شامل» = the purchase × 1.15, always (whatever the day's VAT rate), two decimals, whole halalas half up; the purchase itself as entered", RV.purchaseText({ purchase: 22 }) === "شراء 22 (25.30 شامل)" && RV.purchaseText({ purchase: 20 }) === "شراء 20 (23.00 شامل)" && RV.purchaseText({ purchase: 21.37 }) === "شراء 21.37 (24.58 شامل)" && RV.purchaseText({ purchase: 20.5 }) === "شراء 20.50 (23.58 شامل)"
    && RV.purchaseText({ purchase: 12.5 }) === "شراء 12.50 (14.38 شامل)"      // 14.375: half up on whole halalas (the float product alone rounds to 14.37)
    && RV.reviewLine(row({ vatPct: null })).includes("شراء 55 (63.25 شامل)") && RV.PURCHASE_VAT_FACTOR === 1.15, RV.purchaseText({ purchase: 12.5 }));
  assert("without a purchase price nothing is written for it", RV.purchaseText({ purchase: 0 }) === "" && !RV.reviewLine(row({ purchase: 0, fullCost: 0, proposal: { ...SKIP, why: "no_purchase" } })).includes("شامل"));
  assert("the line with a market price: «✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70»", RV.reviewLine(row()) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70", RV.reviewLine(row()));
  const large = row({ name: "رمان كبير", purchase: 22, market: 28, sale: 28, breakEven: 28.85, suggested: 31.5, fullCost: 25.09, proposal: SKIP });
  assert("«❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر»", RV.reviewLine(large) === "❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر", RV.reviewLine(large));
  const small = row({ name: "رمان صغير", purchase: 12, market: 0, sale: 0, breakEven: 16.78, suggested: 19.5, fullCost: 14.59, proposal: { kind: "profit", price: 19.5, why: "no_market", outlier: false, auto: false } });
  assert("without a market price: «✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50»", RV.reviewLine(small) === "✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50", RV.reviewLine(small));
  const above = row({ market: 75, sale: 75, proposal: { kind: "profit", price: 71.5, why: "above_suggested", outlier: false, auto: true } });
  assert("the market above the suggested price, published at the suggested one: the profit shown is the one of the price it goes out at (+2.43)", RV.reviewLine(above) === "✅ موز — شراء 55 (63.25 شامل) · سوق 75 | ربحنا بالمقترح 71.50: +2.43 ← انشر بـ 71.50", RV.reviewLine(above));
  assert("no purchase price: «❌ خس — سوق 70 | لا سعر شراء ← لا تنشر»", RV.reviewLine(row({ name: "خس", purchase: 0, fullCost: 0, proposal: { ...SKIP, why: "no_purchase" } })) === "❌ خس — سوق 70 | لا سعر شراء ← لا تنشر");
  assert("neither a market price nor a suggested one: «❌ خس — شراء 55 (63.25 شامل) · لا سعر سوق ← لا تنشر»", RV.reviewLine(row({ name: "خس", market: 0, sale: 0, breakEven: 0, suggested: 0, proposal: { ...SKIP, why: "no_price" } })) === "❌ خس — شراء 55 (63.25 شامل) · لا سعر سوق ← لا تنشر");
  const up = row({ market: 70, sale: 72.5, upliftPct: 3, proposal: { kind: "market", price: 72.5, why: "above_suggested", outlier: false, auto: true } });
  assert("with «زيادة على سعر السوق»: the market as observed, the price after it, and the profit at that price (+3.30)", RV.reviewLine(up) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 (بعد الزيادة 72.50) | ربحنا بسعر السوق: +3.30 ← انشر بـ 72.50", RV.reviewLine(up));
  const bare = row({ breakEven: 0, suggested: 0, fullCost: 57.75 });           // the day's cost «تعذّر»: purchase + waste alone
  assert("the day's cost could not be read: the profit says it holds no carton share — «ربحنا بسعر السوق (بلا حصة التشغيل): +3.12»", RV.reviewLine(bare) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق (بلا حصة التشغيل): +3.12 ← انشر بـ 70" && RV.reviewInfo(bare) === "شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق (بلا حصة التشغيل): +3.12" && !RV.reviewLine(row()).includes("بلا حصة"), RV.reviewLine(bare));
  assert("«الساعة 6» for 06:00, «الساعة 06:30» for a time that is not on the hour", RV.clockAr(360) === "الساعة 6" && RV.clockAr(390) === "الساعة 06:30" && RV.clockAr(600) === "الساعة 10");
  const three = RV.choiceLines([row(), large, small], 360);
  assert("the three lines, pure: published by the tap (with prices), not published, and by itself", JSON.stringify(three) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز 70، رمان صغير 19.50", "وما ينتشر: رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز 70"]), JSON.stringify(three));
  assert("nothing by itself: «…ينتشر تلقائياً: لا شيء»; nothing left out: «وما ينتشر: لا شيء»; nothing at all: «…ينتشر: لا شيء»",
    RV.choiceLines([small], 360)[2] === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء" && RV.choiceLines([small], 360)[1] === "وما ينتشر: لا شيء" && RV.choiceLines([large], 360)[0] === "لو ضغطت «نفّذ المقترح» ينتشر: لا شيء", JSON.stringify(RV.choiceLines([small], 360)));
  assert("after 06:00 on a day that was not published the third line says a tap publishes at once", RV.choiceLines([row(), large], 360, { late: true })[2] === "فات موعد الساعة 6 وما انتشرت أسعار اليوم: ضغطك «نفّذ المقترح» الآن ينشر فوراً.", RV.choiceLines([row()], 360, { late: true })[2]);
}

// ================================================================ أ3
console.log("\n[أ3] an outlier (⚠️ and what moved), a row Baraa decided, and a price with no profit");
{
  const env = world();
  dp(1, 11, 22, "2026-10-02");                                // Ahmed's price of the day before
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 99, x_date: "2026-10-02", x_extraction_status: "extracted", x_utak_simulation: true });   // a simulation row is no reference
  const today = dp(1, 11, 55); table("x_daily_price").get(today)!.x_extraction_status = "pending";   // § 26: moved ×2.5 → kept, marked
  market(1, 11, 70);
  dp(2, 21, 15); market(2, 21, 20);
  dp(3, 31, 12);
  dp(4, 41, 22); market(4, 41, 28);
  await engine(env);
  assert("the banana's line is «سعر شاذ: الشراء» — an exception, not published by itself", line(1).x_is_outlier === true && line(1).x_status === "exception" && /سعر شاذ: الشراء/.test(line(1).x_reason), JSON.stringify([line(1).x_status, line(1).x_reason]));
  await review(env);
  const body = bodyOf(owner()[0]);
  const L = body.split("\n");
  assert("its line opens with ⚠️ and keeps the rule's decision: «⚠️ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70»", L[3] === "⚠️ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70", L[3]);
  assert("…and under it a second line: «⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه» (the supplier's price before, and today's)", L[4] === "⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه", L[4]);
  assert("…the next item follows on its own line", L[5] === "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر", L[5]);
  assert("«نفّذ المقترح» would publish it (the rule's decision), but nothing goes out by itself at 6", L.at(-3) === "لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50" && L.at(-1) === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء", L.slice(-3).join(" | "));
  const r = await rowsOf(env);
  assert("the row carries what moved: the purchase, 22 → 55 (never today's own row, never a simulation row); the other rows nothing", JSON.stringify(r[0].moved) === JSON.stringify([{ kind: "purchase", last: 22, now: 55 }]) && r.slice(1).every((x: any) => x.moved === undefined), JSON.stringify(r.map((x: any) => x.moved)));
  assert("in the form its first line opens with the same warning", RV.reviewInfo(r[0]) === "⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه · شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13", RV.reviewInfo(r[0]));
  // Baraa decides it (from Odoo): the mark is his decision's, the warning leaves
  Object.assign(line(1), { x_decision: "market" });
  await engine(env);
  const r2 = await rowsOf(env);
  assert("once Baraa decided it: «✅ … ← قرارك: انشر بـ 70», no second line, nothing read about it", RV.reviewItemLines(r2[0]).join("\n") === "✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: انشر بـ 70" && r2[0].moved === undefined, RV.reviewItemLines(r2[0]).join("\n"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a market observation that moved: the source's own number before it
  const env = world();
  dp(1, 11, 55);
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: DRIVER, x_date: "2026-10-02", x_purchase_price: 0, x_market_price: 40, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false });
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: DRIVER, x_date: DAY, x_purchase_price: 0, x_market_price: 70, x_purchase_outlier: false, x_market_outlier: true, x_status: "outlier", x_utak_simulation: false });
  await engine(env);
  const [b] = await rowsOf(env);
  assert("a market outlier: «⚠️ سعر السوق تغيّر كثير (40 ← 70)، تأكد منه»", JSON.stringify(RV.movedLines(b)) === JSON.stringify(["⚠️ سعر السوق تغيّر كثير (40 ← 70)، تأكد منه"]) && /سعر شاذ: السوق/.test(line(1).x_reason), JSON.stringify([RV.movedLines(b), line(1).x_reason]));
  assert("the price before not known: the line names no numbers — «⚠️ سعر الشراء تغيّر كثير عن آخر سعر، تأكد منه»",
    JSON.stringify(RV.movedLines(row({ proposal: { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false } }))) === JSON.stringify(["⚠️ سعر الشراء تغيّر كثير عن آخر سعر، تأكد منه"])
    && JSON.stringify(RV.movedLines(row({ moved: [{ kind: "purchase", last: 0, now: 55 }], proposal: { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false } }))) === JSON.stringify(["⚠️ سعر الشراء تغيّر كثير عن آخر سعر، تأكد منه"]));
  assert("both prices moved: a line each", RV.movedLines(row({ moved: [{ kind: "purchase", last: 22, now: 55 }, { kind: "market", last: 40, now: 70 }], proposal: { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false } })).length === 2);
  assert("a row that is no outlier has no second line", RV.movedLines(row()).length === 0 && RV.reviewItemLines(row()).length === 1);
  // the marks
  assert("✅ a profit above zero · ❌ «لا تنشر» · ⚠️ an outlier waiting · 🔻 published with no profit (a manual price below «بدون خسارة», or exactly at it)",
    RV.rowMark(row()) === "✅" && RV.rowMark(row({ proposal: SKIP })) === "❌" && RV.rowMark(row({ proposal: { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false } })) === "⚠️"
    && RV.rowMark(row({ decision: "edit", decidedPrice: 60 })) === "🔻" && RV.rowMark(row({ decision: "edit", decidedPrice: 68.7 })) === "🔻" && RV.rowMark(row({ decision: "skip" })) === "❌");
  assert("Baraa's own price: «🔻 موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعرك 60: −7.57 ← قرارك: انشر بـ 60»", RV.reviewLine(row({ decision: "edit", decidedPrice: 60 })) === "🔻 موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعرك 60: −7.57 ← قرارك: انشر بـ 60", RV.reviewLine(row({ decision: "edit", decidedPrice: 60 })));
  assert("his «لا تنشر»: «❌ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: لا تنشر»", RV.reviewLine(row({ decision: "skip" })) === "❌ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: لا تنشر", RV.reviewLine(row({ decision: "skip" })));
  assert("a profit that cannot be computed (a row of before § 55, no full cost): the line stands without it, ✅", RV.reviewLine(row({ fullCost: undefined, vatPct: undefined })) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 ← انشر بـ 70", RV.reviewLine(row({ fullCost: undefined, vatPct: undefined })));
}

// ================================================================ أ4
console.log("\n[أ4] the length: 4, 20 and 40 items");
{
  const day = "2026-10-03";
  const mk = (n: number): any[] => Array.from({ length: n }, (_, i) => row({ lineId: i + 1, productId: i + 1, name: `صنف طويل الاسم رقم ${i + 1}` }));
  const groups = (n: number) => [{ title: "فواكه", rows: mk(n).slice(0, Math.ceil(n / 2)) }, { title: "خضار", rows: mk(n).slice(Math.ceil(n / 2)) }];
  const itemLines = (t: string, r: any) => t.split("\n").filter((l) => l.startsWith(`✅ ${r.name} — `)).length;
  const t4 = RV.buildReviewTexts(day, groups(4), 360);
  assert("4 items: the whole review above the buttons — no separate text", t4.texts.length === 0 && t4.body.length <= 1024 && mk(4).every((r) => itemLines(t4.body, r) === 1), String(t4.body.length));
  assert("…two categories: a heading line each, in the forms' order", t4.body.indexOf("— فواكه —") > 0 && t4.body.indexOf("— خضار —") > t4.body.indexOf("— فواكه —"), t4.body);
  // how many priced items fit above the buttons: every line carries its purchase («شراء 55 (63.25 شامل)»), its market and its profit
  const real = (n: number) => RV.buildReviewTexts(day, [{ title: "فواكه", rows: Array.from({ length: n }, (_, i) => row({ lineId: i + 1, productId: i + 1, name: `موز أمريكي ${i + 1}` })) }], 360);
  const fit = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => real(n).texts.length === 0);
  assert("a day of fully priced items goes whole above the buttons up to 7 items, and from 8 as text first (1024 characters)", fit.length === 7 && fit.at(-1) === 7 && real(7).body.length <= 1024 && real(8).texts.length === 1 && real(8).body.length <= 1024, JSON.stringify([fit, real(7).body.length, real(8).body.length]));
  const t20 = RV.buildReviewTexts(day, groups(20), 360);
  assert("20 items do not fit an interactive message's text (1024): the table goes first as plain text, every item once", t20.texts.length === 1 && t20.texts[0].length <= PR.PRICE_TEXT_LIMIT && mk(20).every((r) => itemLines(t20.texts[0], r) === 1), JSON.stringify(t20.texts.map((t) => t.length)));
  assert("…that text opens with the title and the note, and closes with the three lines BY NAME", t20.texts[0].split("\n")[1] === RV.PROFIT_NOTE && t20.texts[0].includes("لو ضغطت «نفّذ المقترح» ينتشر: صنف طويل الاسم رقم 1 70، ") && t20.texts[0].split("\n").at(-1)!.startsWith("لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: صنف طويل الاسم رقم 1 70"), t20.texts[0].slice(-300));
  assert("…then the buttons under the same three lines BY NUMBER — no item line in it, within 1024", t20.body.length <= 1024 && !t20.body.includes("ربحنا") && t20.body === ["📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026", "20 صنفاً في الجدول أعلاه.", "لو ضغطت «نفّذ المقترح» ينتشر: 20 صنفاً", "وما ينتشر: لا شيء", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: 20 صنفاً"].join("\n"), t20.body);
  const t40 = RV.buildReviewTexts(day, groups(40), 360);
  assert("40 items: every line once, each part within a text message's room, the buttons' text within 1024", t40.texts.every((t) => t.length <= PR.PRICE_TEXT_LIMIT) && t40.body.length <= 1024 && mk(40).every((r) => itemLines(t40.texts.join("\n"), r) === 1), JSON.stringify(t40.texts.map((t) => t.length)));
  const tight = RV.buildReviewTexts(day, groups(40), 360, {}, 1024, 900);
  assert("a table longer than one text message is cut on line boundaries, «(1/N)» … and nothing is lost — a long list of names is cut after its commas", tight.texts.length > 1 && tight.texts.every((t, i) => t.split("\n")[0].endsWith(`(${i + 1}/${tight.texts.length})`) && t.length <= 900)
    && mk(40).every((r) => itemLines(tight.texts.join("\n"), r) === 1) && mk(40).every((r) => tight.texts.join("\n").split(`${r.name} 70`).length - 1 === 2), JSON.stringify(tight.texts.map((t) => t.length)));
  // names three characters longer: the first part (it carries the note under its title) still fits its room
  const wide = RV.buildReviewTexts(day, [{ title: "فواكه", rows: mk(40).map((r) => ({ ...r, name: `${r.name} ممم` })) }], 360, { update: { at: "05:10", changed: ["صنف طويل الاسم رقم 1 ممم", "صنف طويل الاسم رقم 2 ممم"] } }, 1024, 900);
  assert("the first part counts the note and «تغيّر: …» in its room: no part passes the limit", wide.texts.length > 1 && wide.texts.every((t) => t.length <= 900) && wide.texts[0].split("\n")[1] === RV.PROFIT_NOTE && wide.texts[0].split("\n")[2].startsWith("تغيّر: "), JSON.stringify(wide.texts.map((t) => t.length)));
  assert("by number: «صنف واحد», «صنفان», then «3 أصناف» … «18 صنفاً»", JSON.stringify([1, 2, 3, 18].map((n) => RV.choiceLines(mk(n), 360, { compact: true })[0].split(": ")[1])) === JSON.stringify(["صنف واحد", "صنفان", "3 أصناف", "18 صنفاً"]));
  const long = "لو ضغطت «نفّذ المقترح» ينتشر: " + Array.from({ length: 30 }, (_, i) => `صنف ${i + 1} 70`).join("، ");
  const cutUp = RV.wrapList(long, 120);
  assert("wrapList: every piece within the room, cut after «، », and joined again it is the line itself", cutUp.length > 1 && cutUp.every((p) => p.length <= 120) && cutUp.slice(0, -1).every((p) => p.endsWith("،")) && cutUp.join(" ") === long && RV.wrapList("قصير", 120).length === 1, JSON.stringify(cutUp.map((p) => p.length)));
  // an outlier's second line never leaves its item
  const warned = mk(30).map((r) => ({ ...r, moved: [{ kind: "purchase", last: 22, now: 55 }], proposal: { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false } }));
  // whatever the room of a part (every limit from 600 to 760 characters), the second line is never the first of a part
  const whole = (limit: number) => RV.buildReviewTexts(day, [{ title: "فواكه", rows: warned }], 360, {}, 1024, limit).texts;
  const kept = (ts: string[]) => ts.every((t) => { const ls = t.split("\n"); return ls.every((l, i) => !l.startsWith("⚠️ سعر الشراء") || !!ls[i - 1]?.startsWith("⚠️ صنف")); });
  const limits = Array.from({ length: 161 }, (_, i) => 600 + i);
  assert("an outlier's second line stays under its item in every part, wherever the parts are cut", limits.every((n) => whole(n).length > 1 && kept(whole(n))), JSON.stringify(limits.filter((n) => !kept(whole(n))).slice(0, 5)));
}
{
  // 20 real lines through the engine and the gateway
  const env = world(); prices();
  for (let i = 0; i < 16; i++) {
    const id = 100 + i;
    seed("product.template", { id, name: `صنف ${id}`, sale_ok: true, x_is_active_for_sale: true, categ_id: i < 8 ? 6 : false });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
    dp(id, id * 10 + 1, 10); market(id, id * 10 + 1, 16);     // «بدون خسارة» 14.36 ≤ 16 < the suggested 17: by itself, +1.42
  }
  await engine(env);
  const r = await review(env);
  assert("20 items on the day: the table as ONE text, then ONE message with the buttons", r.action === "sent" && r.parts === 1 && owner().length === 2 && owner()[0].type === "text" && withButtons().length === 1, JSON.stringify(r));
  const t = bodyOf(owner()[0]);
  assert("…a line of the table: «✅ صنف 100 — شراء 10 (11.50 شامل) · سوق 16 | ربحنا بسعر السوق: +1.42 ← انشر بـ 16» (16 ÷ 1.15 = 13.91 − 12.49)", t.split("\n").includes("✅ صنف 100 — شراء 10 (11.50 شامل) · سوق 16 | ربحنا بسعر السوق: +1.42 ← انشر بـ 16"), t.slice(0, 500));
  assert("…the buttons' text counts: 18 by the tap, 2 not, 17 by themselves", bodyOf(owner()[1]).split("\n").slice(-3).join("\n") === ["لو ضغطت «نفّذ المقترح» ينتشر: 18 صنفاً", "وما ينتشر: صنفان", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: 17 صنفاً"].join("\n"), bodyOf(owner()[1]));
}

// ================================================================ أ5
console.log("\n[أ5] the buttons do what § 54's did; the confirmation carries each profit and the average");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const res = await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«✅ نفّذ المقترح»: every item takes its proposed decision — banana the market 70, small the suggested 19.50, medium and large «لا تنشر»", res === "all:4"
    && JSON.stringify([1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price])) === JSON.stringify([["market", 70], ["skip", 0], ["profit", 19.5], ["skip", 0]]), JSON.stringify([res, [1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price])]));
  const conf = bodyOf(owner().at(-1));
  const want = [
    "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.",
    "سيُنشر 06:00:",
    "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13",
    "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37",
    "متوسط الربح للكرتون: +1.75",
    "لا يُنشر: رمان وسط، رمان كبير.",
  ];
  assert("the confirmation, line for line: each published item with its price and «ربحنا» signed, then «متوسط الربح للكرتون: +1.75»", conf === want.join("\n"), conf);
  assert("…with «✏️ عدّل» under it", JSON.stringify(buttonTitles(owner().at(-1))) === JSON.stringify(["✏️ عدّل"]) && buttonIds(owner().at(-1))[0] === `prv_r_${dayOf().id}_0`);
  assert("the average is the plain mean of the published items' profits (1.13 and 2.37 → +1.75); with none published there is no such line",
    RV.averageProfitLine([row(), row({ purchase: 12, fullCost: 14.59, proposal: { kind: "profit", price: 19.5, why: "no_market", outlier: false, auto: false } })]) === "متوسط الربح للكرتون: +1.75" && RV.averageProfitLine([]) === ""
    && !RV.confirmationText(DAY, [row({ decision: "skip" })], { deadline: "06:00" }).includes("متوسط"));
  assert("a loss on average is written with its minus: «متوسط الربح للكرتون: −3.22»", RV.averageProfitLine([row(), row({ decision: "edit", decidedPrice: 60 })]) === "متوسط الربح للكرتون: −3.22", RV.averageProfitLine([row(), row({ decision: "edit", decidedPrice: 60 })]));
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  assert("06:00: the two items are published at those prices", dl.action === "auto_published" && dayOf().x_state === "published" && sentTo(C1_PHONE).some((b: any) => /موز أمريكي \(كرتون\): 70 ر\.س/.test(bodyOf(b)) && /رمان صغير \(كرتون\): 19\.50 ر\.س/.test(bodyOf(b))), JSON.stringify(dl));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); prices();
  await engine(env); await review(env);
  const res = await tap(env, `prv_n_${dayOf().id}_1`);
  assert("«⛔ لا تنشر شيء»: «لا تنشر» on every item, answered once with «✏️ عدّل» to take it back", res === "none:4" && [1, 2, 3, 4].every((p) => line(p).x_decision === "skip")
    && bodyOf(owner().at(-1)) === "⛔ لن تُنشر أسعار اليوم (4 أصناف): سُجّل «لا تنشر» عليها كلها. للتراجع قبل 06:00: «✏️ عدّل»." && JSON.stringify(buttonTitles(owner().at(-1))) === JSON.stringify(["✏️ عدّل"]), bodyOf(owner().at(-1)));
  setRiyadh(`${DAY} 06:00`);
  await quiet(() => PR.checkPricesDeadline(env));
  assert("…06:00: nothing is published, and the alert is the one line of a day he closed himself", dayOf().x_state === "missed" && texts().at(-1)!.startsWith("⛔ أسعار اليوم (3 أكتوبر 2026) لم تُنشر بقرارك"), texts().at(-1));
}
{
  // a day nobody decided and nothing publishes by itself: the 06:00 alert names the new buttons
  const env = world(); dp(3, 31, 12);
  await engine(env); await review(env);
  setRiyadh(`${DAY} 06:00`);
  await quiet(() => PR.checkPricesDeadline(env));
  assert("the 06:00 alert of a day that was not published: «✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً", /«✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً/.test(texts().at(-1) ?? ""), texts().at(-1));
  assert("a per-item exception message of before § 54 is answered with the new names too", PR.OLD_EXCEPTION_TEXT.includes("(✅ نفّذ المقترح / ✏️ عدّل)"));
  // the review's buttons of before § 55 (the same ids) still decide: «اعتمد الكل كما هو» of a message already in his chat
  const env2 = world(); prices();
  await engine(env2); await review(env2);
  const snap = JSON.parse(env2.MSG_DEDUP.store.get(RV.snapshotKey(dayOf().id)));
  for (const r of snap.rows) { delete r.fullCost; delete r.vatPct; }                       // a snapshot written before § 55
  env2.MSG_DEDUP.store.set(RV.snapshotKey(dayOf().id), JSON.stringify(snap));
  const res = await tap(env2, `prv_a_${dayOf().id}_1`);
  assert("a snapshot written before § 55 (no full cost in its rows) still decides, and the confirmation is made from the day itself", res === "all:4" && bodyOf(owner().at(-1)).includes("• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13"), bodyOf(owner().at(-1)));
}

// ================================================================ أ6
console.log("\n[أ6] the form utak_owner_review_v2: two lines an item, every choice with its profit");
{
  const json = LIB.buildReviewFlowJson();
  const first = json.screens[0];
  assert("six pages of ten items, forward routes only, every page terminal", json.version === "6.0" && json.screens.length === 6 && LIB.REVIEW_PAGE_SLOTS === 10 && LIB.REVIEW_SLOTS === 60
    && JSON.stringify(json.routing_model) === JSON.stringify({ REVIEW_A: ["REVIEW_B"], REVIEW_B: ["REVIEW_C"], REVIEW_C: ["REVIEW_D"], REVIEW_D: ["REVIEW_E"], REVIEW_E: ["REVIEW_F"], REVIEW_F: [] }) && json.screens.every((s: any) => s.terminal && s.success));
  assert("the worker's constants are the Flow's: its id, the first screen, the pages, the slots, the button", RV.REVIEW_FLOW_ID === "1135227635856887" && RV.REVIEW_FLOW_SCREEN === LIB.REVIEW_FIRST_SCREEN && RV.REVIEW_FLOW_PAGES === LIB.REVIEW_PAGES.length && RV.REVIEW_FLOW_PAGE_SLOTS === LIB.REVIEW_PAGE_SLOTS && RV.REVIEW_FLOW_SLOTS === LIB.REVIEW_SLOTS && RV.REVIEW_FLOW_CTA === LIB.REVIEW_CTA && count(LIB.REVIEW_CTA) <= 20);
  assert("no endpoint: no data_api_version, no data_exchange anywhere", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange"));
  assert("every page within Meta's fifty components (10 × 4 + the heading + the footers)", json.screens.every((s: any) => LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX) && LIB.screenComponents(first).length === 44 && LIB.screenComponents(json.screens[5]).length === 42, JSON.stringify(json.screens.map((s: any) => LIB.screenComponents(s).length)));
  const slot = LIB.reviewSlot(1, 1);
  assert("an item is FOUR components: two lines of text, its list, «السعر اليدوي»", JSON.stringify(slot.map((c: any) => c.type)) === JSON.stringify(["TextCaption", "TextCaption", "Dropdown", "TextInput"]) && slot[0].text === "${data.x1}" && slot[1].text === "${data.y1}" && slot[2].name === "d1" && slot[3].name === "p1");
  assert("…on a later page they read the first page's data", LIB.reviewSlot(2, 11)[1].text === "${screen.REVIEW_A.data.y11}" && LIB.reviewSlot(2, 11)[2]["data-source"] === "${screen.REVIEW_A.data.o11}");
  assert("the first page declares 431 keys: t1–t6, m1–m5, and x / y / l / o / s / i / v of sixty slots", Object.keys(first.data).length === 431 && ["t6", "m5", "x60", "y60", "l60", "o60", "s60", "i60", "v60"].every((k) => k in first.data) && !("m6" in first.data));
  const submit = (k: number) => { const f = json.screens[k - 1].layout.children.at(-1); return k === 6 ? f : f.else[0]; };
  assert("«اعتمد» on page k carries d / p of every page up to it (the reply of v1, unchanged)", [1, 2, 6].every((k) => Object.keys(submit(k)["on-click-action"].payload).length === 20 * k) && submit(2)["on-click-action"].payload.d3 === "${screen.REVIEW_A.form.d3}" && submit(2)["on-click-action"].payload.p14 === "${form.p14}" && submit(1).label === "اعتمد");
  assert("the example of every option's title is within thirty characters", (first.data.o1.__example__ as any[]).every((o) => count(o.title) <= RV.REVIEW_OPTION_MAX));
  assert("v1 (§ 54) stays as it was published — four pages of fifteen — and is no longer what the worker sends", V1.REVIEW_PAGES.length === 4 && V1.REVIEW_PAGE_SLOTS === 15 && V1.REVIEW_FLOW_NAME === "utak_owner_review_v1" && LIB.REVIEW_FLOW_NAME === "utak_owner_review_v2");
}
{
  const env = world(); prices();
  await engine(env); await review(env);
  const res = await tap(env, `prv_r_${dayOf().id}_1`);
  assert("«✏️ عدّل» → the form (a Flow), to Baraa", res === "form" && flows().length === 1, JSON.stringify(res));
  const f = flows()[0], d = dataOf(f), model = LIB.reviewDataModel();
  assert("it opens utak_owner_review_v2 on its first page, by «عدّل الأسعار»", par(f).flow_id === RV.REVIEW_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "REVIEW_A" && par(f).flow_cta === "عدّل الأسعار");
  assert("every key sent is declared on the first page, with its type", JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(model).sort())
    && Object.keys(d).every((k) => (model[k].type === "array" ? Array.isArray(d[k]) : typeof d[k] === model[k].type)), Object.keys(d).filter((k) => !(k in model)).join(","));
  assert("its text: «✏️ عدّل أسعار السبت 3 أكتوبر 2026: 4 أصناف.» and that every choice carries its profit", bodyOf(f).split("\n")[0] === "✏️ عدّل أسعار السبت 3 أكتوبر 2026: 4 أصناف." && bodyOf(f).includes("وجنب كل خيار ربحه للكرتون"), bodyOf(f));
  assert("one page, «فواكه»: no page follows", d.t1 === "فواكه" && d.m1 === false && [1, 2, 3, 4].every((n) => d[`v${n}`] === true) && d.v5 === false);
  assert("the first line of each item: «شراء X · سوق Y · ربحنا بسعر السوق: ±a»; without a market price «شراء 12 (13.80 شامل) · لا سعر سوق»",
    JSON.stringify([1, 2, 3, 4].map((n) => d[`x${n}`])) === JSON.stringify(["شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13", "شراء 15 (17.25 شامل) · سوق 20 · ربحنا بسعر السوق: −0.35", "شراء 12 (13.80 شامل) · لا سعر سوق", "شراء 22 (25.30 شامل) · سوق 28 · ربحنا بسعر السوق: −0.74"]), JSON.stringify([1, 2, 3, 4].map((n) => d[`x${n}`])));
  assert("the second line: where our suggested price stands against the market — «أعلى من السوق بـ d (+e%)», or «لا سعر سوق للمقارنة»",
    JSON.stringify([1, 2, 3, 4].map((n) => d[`y${n}`])) === JSON.stringify(["سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)", "سعرنا المقترح 23 = أعلى من السوق بـ 3 (+15%)", "سعرنا المقترح 19.50 — لا سعر سوق للمقارنة", "سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)"]), JSON.stringify([1, 2, 3, 4].map((n) => d[`y${n}`])));
  assert("«الفرق», «بدون خسارة» and «مقترح N» of § 54's one line are in neither", !/الفرق|بدون خسارة/.test(JSON.stringify(d)));
  assert("the large pomegranate's choices, each with its profit: «بالمقترح 31.50 (ربح +2.30)» · «بسعر السوق 28 (ربح −0.74)» · «لا تنشر» · «سعر يدوي»",
    JSON.stringify(d.o4) === JSON.stringify([{ id: "profit", title: "بالمقترح 31.50 (ربح +2.30)" }, { id: "market", title: "بسعر السوق 28 (ربح −0.74)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]), JSON.stringify(d.o4));
  assert("the banana's: «بالمقترح 71.50 (ربح +2.43)» · «بسعر السوق 70 (ربح +1.13)»; the small one has no «بسعر السوق»", d.o1[0].title === "بالمقترح 71.50 (ربح +2.43)" && d.o1[1].title === "بسعر السوق 70 (ربح +1.13)"
    && JSON.stringify(d.o3) === JSON.stringify([{ id: "profit", title: "بالمقترح 19.50 (ربح +2.37)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]), JSON.stringify([d.o1, d.o3]));
  assert("each list opens on the proposed decision: market · skip · profit · skip", JSON.stringify([1, 2, 3, 4].map((n) => d[`s${n}`])) === JSON.stringify(["market", "skip", "profit", "skip"]));
  assert("every title within Meta's thirty characters, every label within twenty", [1, 2, 3, 4].every((n) => d[`o${n}`].every((o: any) => count(o.title) <= 30) && count(d[`l${n}`]) <= 20));
  // his answer: the banana at the market, the medium at the suggested price, the small at his own price, the large out
  const before = lineWrites();
  const ans = await hook(env, OWNER, nfm(par(f).flow_token, { d1: "market", p1: "", d2: "profit", p2: "", d3: "manual", p3: "18", d4: "skip", p4: "" }));
  assert("«اعتمد» through the webhook: the four decisions are written on their lines", ans.status === 200 && lineWrites() > before
    && JSON.stringify([1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price])) === JSON.stringify([["market", 70], ["profit", 23], ["edit", 18], ["skip", 0]]), JSON.stringify([1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price])));
  const conf = bodyOf(owner().at(-1));
  assert("the confirmation: each with its price and profit — the medium +2.26 at 23, the small +1.06 at his 18 — and the average +1.48", conf === [
    "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.", "سيُنشر 06:00:",
    "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13", "• رمان وسط — 23 ر.س (المقترح) · ربحنا +2.26", "• رمان صغير — 18 ر.س (سعر يدوي) · ربحنا +1.06",
    "متوسط الربح للكرتون: +1.48", "لا يُنشر: رمان كبير.",
  ].join("\n"), conf);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the second line and the choices, pure
  assert("our suggested price below the market: «سعرنا المقترح 71.50 = أقل من السوق بـ 3.50 (−4.7%)»", RV.reviewCompare(row({ market: 75, sale: 75 })) === "سعرنا المقترح 71.50 = أقل من السوق بـ 3.50 (−4.7%)", RV.reviewCompare(row({ market: 75, sale: 75 })));
  assert("equal to it: «سعرنا المقترح 71.50 = سعر السوق»; no suggested price: «لا سعر مقترح»", RV.reviewCompare(row({ market: 71.5, sale: 71.5 })) === "سعرنا المقترح 71.50 = سعر السوق" && RV.reviewCompare(row({ suggested: 0 })) === "لا سعر مقترح");
  assert("the comparison is with the market AS OBSERVED, whatever the uplift (70, not 72.50)", RV.reviewCompare(row({ sale: 72.5, upliftPct: 3 })) === "سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)");
  assert("with an uplift the first line names both: «شراء 55 (63.25 شامل) · سوق 70 (بعد الزيادة 72.50) · ربحنا بسعر السوق: +3.30», and «بسعر السوق» is offered at 72.50",
    RV.reviewInfo(row({ sale: 72.5, upliftPct: 3 })) === "شراء 55 (63.25 شامل) · سوق 70 (بعد الزيادة 72.50) · ربحنا بسعر السوق: +3.30" && RV.reviewOptions(row({ sale: 72.5, upliftPct: 3 }))[1].title === "بسعر السوق 72.50 (ربح +3.30)", RV.reviewInfo(row({ sale: 72.5, upliftPct: 3 })));
  assert("no purchase price: «لا سعر شراء · سوق 70», and its choices carry no made-up profit", RV.reviewInfo(row({ purchase: 0, fullCost: 0 })) === "لا سعر شراء · سوق 70"
    && JSON.stringify(RV.reviewOptions(row({ purchase: 0, fullCost: 0, breakEven: 0, suggested: 0 }))) === JSON.stringify([{ id: "market", title: "بسعر السوق 70" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]));
  const big = RV.reviewOptions(row({ purchase: 100, fullCost: 107, market: 128.5, sale: 128.5, suggested: 126 }));
  assert("the longest usual title still fits: «بسعر السوق 128.50 (ربح +4.74)» (29 characters)", big[1].title === "بسعر السوق 128.50 (ربح +4.74)" && count(big[1].title) === 29, big[1].title);
  const huge = RV.reviewOptions(row({ purchase: 1000, fullCost: 1092, market: 1128.5, sale: 1128.5, suggested: 1260.5 }));
  assert("a title that would pass thirty characters drops the word «ربح», never a digit: «بسعر السوق 1128.50 (−110.70)»", huge[1].title === "بسعر السوق 1128.50 (−110.70)" && huge.every((o: any) => count(o.title) <= 30) && !huge.some((o: any) => o.title.includes("…")), JSON.stringify(huge));
}
{
  // a category of more than ten continues on the next page; sixty items at most
  const mk = (n: number, from = 0): any[] => Array.from({ length: n }, (_, i) => row({ lineId: from + i + 1, productId: from + i + 1, name: `صنف ${from + i + 1}` }));
  const f = RV.reviewFormItems([{ title: "فواكه", rows: mk(12) }, { title: "خضار", rows: mk(3, 100) }]);
  assert("twelve fruits: ten on «فواكه», two on «فواكه (2)», then «خضار» on the third page", JSON.stringify(f.pages) === JSON.stringify(["فواكه", "فواكه (2)", "خضار"]) && JSON.stringify(f.items.map((i: any) => i.slot)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 21, 22, 23]) && f.left.length === 0, JSON.stringify([f.pages, f.items.map((i: any) => i.slot)]));
  const d = RV.reviewFormData(f.pages, f.items);
  assert("…«التالي» after the first two pages only, and the empty slots hidden", d.m1 === true && d.m2 === true && d.m3 === false && d.v12 === true && d.v13 === false && d.v21 === true && d.y21 === "سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)" && d.y13 === "-");
  const over = RV.reviewFormItems([{ title: "فواكه", rows: mk(65) }]);
  assert("sixty-five items: sixty in the form, five named in its message and left on their proposed decision", over.items.length === 60 && over.left.length === 5 && over.pages.length === 6 && RV.reviewFormText(DAY, 60, over.left).includes("خارج النموذج (يتسع لـ 60): صنف 61، "));
}
{
  // a form sent before § 55 (utak_owner_review_v1: the same d<n> / p<n>) is still read by its token
  const env = world(); prices();
  await engine(env);
  const token = "pr1.20261003.aabbccddeeff001122";
  const item = (slot: number, p: number, o: Record<string, unknown>) => ({ slot, lineId: line(p).id, name: NAMES[p], label: NAMES[p], info: "شراء 55 (63.25 شامل) · سوق 70 · الفرق 15 · بدون خسارة 68.70 · مقترح 71.50", options: [{ id: "profit", title: "انشر بالمقترح (71.50)" }, { id: "market", title: "انشر بسعر السوق (70)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }], selected: "market", manual: "", suggested: 71.5, sale: 70, breakEven: 68.7, ...o });
  env.MSG_DEDUP.store.set(RV.reviewFormKey(token), JSON.stringify({ v: 1, token, day: DAY, dayId: dayOf().id, to: OWNER, items: [item(1, 1, {})], pages: ["فواكه"], createdAt: Date.now() }));
  const r = await formReply(env, token, { d1: "market", p1: "" });
  assert("a reply of utak_owner_review_v1 still in his chat: read, and the banana decided at 70", r.action === "decided" && line(1).x_decision === "market" && line(1).x_sale_price === 70, JSON.stringify(r));
}

// ================================================================ أ7
console.log("\n[أ7] the trial to Baraa: the new message and form, nothing written, nothing published");
{
  const env = world(`${DAY} 10:00`); prices();
  await engine(env);
  const w0 = lineWrites(), s0 = dayWrites();
  const t = await quiet(() => RV.sendPriceReviewTest(env));
  assert("the trial goes to Baraa alone, once: «🧪 تجربة — 📋 مراجعة أسعار اليوم — …» with the note, the four lines and the three lines", t.sent === true && t.items === 4 && owner().length === 1 && graph.every((b: any) => b.to === OWNER)
    && bodyOf(owner()[0]).startsWith("🧪 تجربة — 📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026\n(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)\n\n✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70") && bodyOf(owner()[0]).includes("لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70"), bodyOf(owner()[0]));
  assert("…its buttons are the trial's (prvt_…), under the new names", JSON.stringify(buttonIds(owner()[0])) === JSON.stringify([`prvt_a_${dayOf().id}_1`, `prvt_r_${dayOf().id}_1`, `prvt_n_${dayOf().id}_1`]) && buttonTitles(owner()[0])[0] === "✅ نفّذ المقترح");
  const again = await quiet(() => RV.sendPriceReviewTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && owner().length === 1, JSON.stringify(again));
  assert("the day's claim is the new Flow's and this shape's: neither the trial of § 54 (utak_owner_review_v1) nor the first one of § 55 (without the purchase price) blocks it", [...env.MSG_DEDUP.store.keys()].some((k: string) => k.includes(`prv_test:${RV.REVIEW_FLOW_ID}:${RV.REVIEW_TEST_EDITION}:${DAY}`)) && RV.REVIEW_TEST_EDITION === "2");
  await tap(env, `prvt_a_${dayOf().id}_1`);
  const conf = bodyOf(owner().at(-1));
  assert("«✅ نفّذ المقترح» on the trial: the confirmation as it would read — each profit, the average — and «لم يُكتب شيء»", conf.includes("• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13") && conf.includes("• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37") && conf.includes("متوسط الربح للكرتون: +1.75") && conf.endsWith("(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)"), conf);
  await tap(env, `prvt_r_${dayOf().id}_1`);
  const f = flows()[0];
  assert("«✏️ عدّل» on the trial: the form itself, marked «🧪 تجربة», with its two lines", !!f && bodyOf(f).startsWith("🧪 تجربة — ✏️ عدّل أسعار") && dataOf(f).t1 === "🧪 تجربة — فواكه" && dataOf(f).y4 === "سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)", bodyOf(f));
  await hook(env, OWNER, nfm(par(f).flow_token, { d1: "market", p1: "", d2: "skip", p2: "", d3: "manual", p3: "15", d4: "profit", p4: "" }));
  const ans = bodyOf(owner().at(-1));
  assert("its answer names each decision with its profit — the small one at his 15: −1.55, below «بدون خسارة» — and writes nothing", ans.includes("• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13") && ans.includes("• رمان صغير — 15 ر.س (سعر يدوي) · ربحنا −1.55 ⚠️ أقل من سعر بدون خسارة 16.78") && ans.includes("• رمان كبير — 31.50 ر.س (المقترح) · ربحنا +2.30") && ans.includes("• رمان وسط — لا تنشر"), ans);
  assert("nothing was written on a line, the day's state did not move, and no customer got anything", lineWrites() === w0 && dayWrites() === s0 && [1, 2, 3, 4].every((p) => !line(p).x_decision) && sentTo(C1_PHONE).length === 0 && rows("x_price_day").every((d: any) => d.x_state === "draft"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

done();
