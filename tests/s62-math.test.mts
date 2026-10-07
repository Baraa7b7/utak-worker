// § 62 أ (2026-10-07) — the numbers of «طلب أسعار خاص» (src/special-quote-math.ts). Pure.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62-math.test.mts

import { assert, done } from "./s46-kit.mts";

const M = await import("../src/special-quote-math.ts");
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

console.log("\n[أ3] the unit's cost, «بدون خسارة» and «الأدنى المربح»");
{
  assert("the cost = the purchase × (1 + the waste): 10 at 5 % → 10.5", near(M.unitCost(10, 5), 10.5));
  assert("…no waste: the purchase itself; no purchase: 0", near(M.unitCost(10, 0), 10) && M.unitCost(0, 5) === 0 && M.unitCost(-3, 5) === 0);
  assert("«بدون خسارة» = the cost × 1.15: 10 at 5 % → 12.08 (12.075 up to the halala)", M.noLossPrice(10, 5) === 12.08, String(M.noLossPrice(10, 5)));
  assert("«الأدنى المربح» = the cost × (1 + the margin) × 1.15: 10 at 5 % and 10 % → 13.28", M.minProfitablePrice(10, 5, 10) === 13.28, String(M.minProfitablePrice(10, 5, 10)));
  assert("…a margin of 0 is «بدون خسارة»", M.minProfitablePrice(10, 5, 0) === M.noLossPrice(10, 5));
  assert("the VAT factor is 1.15, the step a quarter riyal, the default margin 10 %, the default unit a kilo", M.VAT_FACTOR === 1.15 && M.SUGGEST_STEP === 0.25 && M.DEFAULT_MARGIN_PCT === 10 && M.DEFAULT_UNIT === "كيلو");
}

console.log("\n[أ3] up to the quarter riyal");
{
  assert("5.01 → 5.25, 5.25 → 5.25, 5.26 → 5.5, 13.2825 → 13.5", M.ceilTo(5.01) === 5.25 && M.ceilTo(5.25) === 5.25 && M.ceilTo(5.26) === 5.5 && M.ceilTo(13.2825) === 13.5);
  assert("a whole riyal stays; a float's dust lifts nothing (0.1 + 0.2 → 0.5, 3 × 1.25 → 3.75)", M.ceilTo(7) === 7 && M.ceilTo(0.1 + 0.2) === 0.5 && M.ceilTo(3 * 1.25) === 3.75);
  assert("nothing → 0", M.ceilTo(0) === 0 && M.ceilTo(-2) === 0);
}

console.log("\n[أ3] the market's median");
{
  assert("one observation: itself", M.median([6]) === 6);
  assert("two: their mean (5 and 6 → 5.5)", M.median([5, 6]) === 5.5);
  assert("three: the middle one, whatever the order (9, 5, 6 → 6)", M.median([9, 5, 6]) === 6);
  assert("four: the mean of the two middle ones (4, 5, 7, 20 → 6)", M.median([20, 4, 7, 5]) === 6);
  assert("none, or nothing above zero: 0", M.median([]) === 0 && M.median([0, -1]) === 0);
}

console.log("\n[أ3] «المقترح»");
{
  // purchase 10, waste 5 %, margin 10 % → «الأدنى المربح» 13.2825
  assert("the market above «الأدنى المربح»: the market, up to the quarter (14.10 → 14.25)", M.suggestedPrice(10, 14.1, 5, 10) === 14.25, String(M.suggestedPrice(10, 14.1, 5, 10)));
  assert("the market under it: «الأدنى المربح», up to the quarter (13.2825 → 13.5)", M.suggestedPrice(10, 12, 5, 10) === 13.5, String(M.suggestedPrice(10, 12, 5, 10)));
  assert("no market: «الأدنى المربح» (13.5)", M.suggestedPrice(10, 0, 5, 10) === 13.5);
  assert("the market exactly on a quarter above it stays (15 → 15)", M.suggestedPrice(10, 15, 5, 10) === 15);
  assert("no purchase price: nothing is suggested, whatever the market says", M.suggestedPrice(0, 14, 5, 10) === 0);
  assert("«المقترح» is never under «بدون خسارة»", [3.3, 7.77, 10, 21.4].every((p) => M.suggestedPrice(p, 0, 5, 10) >= M.noLossPrice(p, 5)));
}

console.log("\n[أ3] the line's profit and the order's");
{
  // qty 100, final 14.25, purchase 10, waste 5 %: 100 × (14.25 ÷ 1.15 − 10.5) = 189.13
  assert("the line's profit = the quantity × (the final ÷ 1.15 − the cost): 189.13", M.lineProfit(100, 14.25, 10, 5) === 189.13, String(M.lineProfit(100, 14.25, 10, 5)));
  assert("a final price under «بدون خسارة»: a loss with its sign (100 × (11.5 ÷ 1.15 − 10.5) = −50)", M.lineProfit(100, 11.5, 10, 5) === -50);
  assert("exactly «بدون خسارة» (12.075): no profit and no loss", near(M.lineProfit(100, 12.075, 10, 5)!, 0));
  assert("no final price, no purchase price or no quantity: it cannot be told (null)", M.lineProfit(100, 0, 10, 5) === null && M.lineProfit(100, 14, 0, 5) === null && M.lineProfit(0, 14, 10, 5) === null);
  assert("the line's total = the quantity × the final price, VAT inside (1464 × 4.75 = 6954)", M.lineTotal(1464, 4.75) === 6954);
  const lines = [
    { qty: 100, purchase: 10, market: [14.1], finalPrice: 14.25 },     // +189.13
    { qty: 50, purchase: 4, market: [5, 6], finalPrice: 4.5 },         // 50 × (4.5 ÷ 1.15 − 4.2) = −14.35 (under «بدون خسارة» 4.83)
    { qty: 10, purchase: 0, market: [8], finalPrice: 9 },              // no purchase price: outside
    { qty: 20, purchase: 3, market: [], finalPrice: 0 },               // no final price: outside
  ];
  const o = M.orderNumbers(lines, 5, 10, 150);
  assert("the order: four lines, one without a purchase price, one without a final price, one under «بدون خسارة», two counted", o.lines === 4 && o.missingPurchase === 1 && o.missingFinal === 1 && o.belowCost === 1 && o.counted === 2, JSON.stringify(o));
  assert("the lines' profits: 189.13 − 14.35 = 174.78", o.linesProfit === 174.78, String(o.linesProfit));
  assert("the order's profit = the lines' profits − the delivery cost: 174.78 − 150 = 24.78", o.profit === 24.78, String(o.profit));
  assert("the total: 1425 + 225 + 90 + 0 = 1740", o.total === 1740, String(o.total));
  assert("a dearer delivery turns it into a loss: 174.78 − 600 = −425.22", M.orderNumbers(lines, 5, 10, 600).profit === -425.22);
  const n = M.lineNumbers(lines[1], 5, 10);
  assert("a line's numbers: the median 5.5, «بدون خسارة» 4.83, «المقترح» 5.5 (the market above 5.313), its total 225, its profit −14.35, under the cost", n.marketMedian === 5.5 && n.noLoss === 4.83 && n.suggested === 5.5 && n.total === 225 && n.profit === -14.35 && n.belowCost && n.counted, JSON.stringify(n));
  assert("a line without a purchase price: no «بدون خسارة», no «المقترح», no profit, not counted", (() => { const x = M.lineNumbers(lines[2], 5, 10); return x.noLoss === 0 && x.suggested === 0 && x.profit === 0 && !x.counted && !x.belowCost && x.marketMedian === 8; })());
}

console.log("\n[أ3] the sign above the screen");
{
  const base = { lines: 3, missingPurchase: 0, missingFinal: 0, belowCost: 0, counted: 3, total: 1000, linesProfit: 0, profit: 0 };
  assert("a profit: ✅ and «+» with two decimals", M.profitText({ ...base, profit: 1234.5 }) === "✅ ربح الطلب +1,234.50 ريال", M.profitText({ ...base, profit: 1234.5 }));
  assert("a loss: ❌ and «−»", M.profitText({ ...base, profit: -120 }) === "❌ ربح الطلب −120.00 ريال", M.profitText({ ...base, profit: -120 }));
  assert("exactly zero is not a loss: ✅ +0.00", M.profitText(base) === "✅ ربح الطلب +0.00 ريال");
  assert("lines outside the sum are said, so the sign never reads as the whole order's", M.profitText({ ...base, counted: 1, profit: 40 }) === "✅ ربح الطلب +40.00 ريال (2 أسطر خارج الحساب)" && M.profitText({ ...base, counted: 2, profit: 40 }).endsWith("(1 سطر خارج الحساب)"));
  assert("nothing can be counted yet: no sign at all, and why", M.profitText({ ...base, counted: 0, missingPurchase: 3, missingFinal: 3 }) === "⏳ لا ربح يُحسب بعد: 3 بلا سعر شراء، و3 بلا سعر نهائي");
  assert("no line: said", M.profitText({ ...base, lines: 0, counted: 0 }) === "لا أصناف في الطلب بعد");
  assert("the summary: the counts and the total; the lines under «بدون خسارة» only when there are some", M.summaryText({ ...base, missingPurchase: 2, missingFinal: 1 }) === "3 صنف · 2 بلا سعر شراء · 1 بلا سعر نهائي · الإجمالي 1000 ريال" && M.summaryText({ ...base, belowCost: 1 }).includes("⚠️ 1 نهائيه تحت «بدون خسارة»"));
  assert("money: 5 → «5», 5.5 → «5.5», 5.25 → «5.25»; signed: +0.00, −3.10", M.money(5) === "5" && M.money(5.5) === "5.5" && M.money(5.25) === "5.25" && M.signedMoney(0) === "+0.00" && M.signedMoney(-3.1) === "−3.10");
}

done();
