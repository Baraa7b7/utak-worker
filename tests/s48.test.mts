// § 48 (2026-10-01) — the fixed minimum profit a carton, the fallback = the suggested price, the
// preview, a decision taken in Odoo on a missed day, and «—» for a value that does not exist.
//
//   [أ] «الربح الأدنى للكرتون (ريال)»: the suggested price = (full cost + the amount) × 1.15, rounded UP
//       to 0.5; «أقل سعر بيع بدون خسارة» unchanged; «الهامش الأدنى ٪» read by nothing; the rule itself
//       (the market price once it reaches the suggested one) unchanged by § 48 — § 54 moved the line of
//       the exception from the suggested price down to «بدون خسارة»; the numbers of 2026-10-01.
//   [ب] the fallback sale price = the suggested price: the supplier's row when he answers, the engine
//       keeping every row of the day in step, the quotation's lookup (the day's line first), no
//       fallback at all when the suggested price cannot be made, the simulation rows left out.
//   [ج] the preview of a line without an approved price, in fields of its own; the real profit and
//       the status keep their meaning; the «—» texts (the Python Odoo computes, run in python3).
//   [د] «اعتمد بالسعر المربح» chosen in Odoo on a «فات الموعد» day: «🔄 إعادة الحساب» approves the line
//       at the suggested price, the day stays missed, nothing is sent; the tick applies a decision
//       nobody recomputed; a decision changed in Odoo does not inherit another decision's price.
//   [و] the places: every text of the worker and the documents names the screens of «💲 التسعير».
//
// § 54 (2026-10-05) — re-based on the proposed decision (src/pricing-engine.ts proposeDecision) and the
// day's review in ONE message (src/price-review.ts): a market price between «بدون خسارة» and the suggested
// price is automatic at the market price (an exception «أقل من السعر المربح» before), and the suggested
// price and the break-even reach Baraa in the review's form, where «انشر بالمقترح» is a choice — the message
// per exception and its «اعتمد بالسعر المربح» button are gone. A decision from the review on a «فات
// الموعد» day publishes at once; the text that sent him to «نشر المعتمد الآن» for it is gone with them.
//
// § 55 (2026-10-05) — the review made plain: an item's line carries «ربحنا» (the board's net of a carton) in
// place of the purchase price and «الفرق»; the form says the suggested price on a second line («سعرنا
// المقترح 29 = أعلى من السوق بـ 3 (+11.5%)») and each choice carries its own profit («بالمقترح 29 (ربح
// +2.22)»); «بدون خسارة» stays on the line in Odoo and in the form's record. The buttons are «✅ نفّذ
// المقترح», «✏️ عدّل» and «⛔ لا تنشر شيء».
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s48.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { OWNER, graph, heldFor, odooLog, order, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { AHMED, C1, DAY, DRIVER, DRIVER_PHONE, FIX, assert, cost, dayOf, done, dp, fourLines, fresh, lineFor, market, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const EN = await import("../src/pricing-engine.ts");
const PB = await import("../src/pricing-board.ts");
const PR = await import("../src/prices.ts");
const OC = await import("../src/operating-cost.ts");
const SUP = await import("../src/suppliers.ts");
const OD = await import("../src/odoo.ts");
const ZP = await import("../src/zero-price.ts");
const PS = await import("../src/price-sources.ts");
// @ts-ignore — plain .mjs helper
const VW = await import("../scripts/lib/s48-odoo-views.mjs");
// @ts-ignore — plain .mjs helper
const UI = await import("../scripts/lib/s48-ui.mjs");
const PL = await import("../src/places.ts");
const PSU = await import("../src/product-setup.ts");
const OW = await import("../src/owner-window.ts");
const SP = await import("../src/supplier-pay.ts");
const PRV = await import("../src/price-review.ts");

const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };
const offer = (o: Record<string, unknown>) => ({ kind: "market", price: 0, outlier: false, partnerId: 1, sourceName: "م", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o }) as any;
const omar = (product: number, packaging: number, o: { purchase?: number; market?: number }, day = DAY) =>
  seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: DRIVER, x_date: day, x_purchase_price: o.purchase ?? 0, x_market_price: o.market ?? 0, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false });
const dpRow = (id: number) => table("x_daily_price").get(id) as any;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const TEN_01 = "2026-10-01";
/** The real day of 2026-10-01 as it stood: missed, the day's cost 496.52 (share 1.99), Ahmed's three pomegranate prices. */
function tenOne(riyadh = `${TEN_01} 13:00`): any {
  const env = fresh(riyadh);
  seed("x_operating_cost", { x_name: "تكلفة اليوم", x_cost_type: "variable", x_frequency: "daily", x_amount: 496.52, x_date_from: TEN_01, x_date_to: false, x_utak_simulation: false });
  seed("x_price_day", { x_date: TEN_01, x_state: "missed", x_name: `أسعار اليوم ${TEN_01}`, x_utak_simulation: false });
  dp(1, 11, 22, TEN_01); dp(2, 21, 16, TEN_01); dp(3, 31, 12, TEN_01);
  return env;
}

// ================================================================ [أ] the fixed minimum profit a carton
console.log("\n[أ] «الربح الأدنى للكرتون»: the suggested price = (full cost + 2) × 1.15, up to the nearest 0.5");
{
  const share = PB.boardShare(496.52, 250, { days: 0, average: null }).share;
  const want: Array<[string, number, number, number, number]> = [
    ["رمان كبير", 22, 25.09, 28.85, 31.5],
    ["رمان وسط", 16, 18.79, 21.61, 24],
    ["رمان صغير", 12, 14.59, 16.78, 19.5],
    ["موز أمريكي", 22, 25.09, 28.85, 31.5],
  ];
  assert("the carton share of 2026-10-01: 1.99", share === 1.99);
  for (const [name, purchase, full, even, suggested] of want) {
    const f = EN.priceFloor({ purchase, wastePct: 5, opShare: share, vatRatePct: 15, minProfit: 2 })!;
    assert(`${name}: الشراء ${purchase} ← التكلفة الكاملة ${full} ← بدون خسارة ${even} (لم يتغير) ← المقترح ${suggested.toFixed(2)}`, f.fullCost === full && f.breakEven === even && f.suggested === suggested, JSON.stringify(f));
  }
  const big = EN.priceFloor({ purchase: 22, wastePct: 5, opShare: 1.99, vatRatePct: 15, minProfit: 2 })!;
  assert("(25.09 + 2) × 1.15 = 31.1535 → up to 31.50 — not 25.09 × 1.05 × 1.15 = 30.30 → 30.50 of § 47", big.suggested === 31.5 && big.suggested !== 30.5);
  const onStep = EN.priceFloor({ purchase: 18, wastePct: 0, opShare: 0, vatRatePct: 15, minProfit: 2 })!;
  const above = EN.priceFloor({ purchase: 18.01, wastePct: 0, opShare: 0, vatRatePct: 15, minProfit: 2 })!;
  assert("a price already on a half riyal stays: (18 + 2) × 1.15 = 23.00; one halala more goes up: 23.01 → 23.50", onStep.suggested === 23 && above.suggested === 23.5, JSON.stringify([onStep, above]));
  const zero = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 0 })!;
  const neg = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: -5 })!;
  assert("an amount of 0 (or below): the break-even rounded up (26.45 → 26.50), never below it", zero.suggested === 26.5 && neg.suggested === 26.5 && zero.breakEven === 26.45);
  const half = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2.5 })!;
  assert("the amount is riyals, with its halalas: 2.50 → (23 + 2.50) × 1.15 = 29.325 → 29.50", half.suggested === 29.5);
  const a = EN.priceFloor({ purchase: 10, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 })!;
  const b = EN.priceFloor({ purchase: 100, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 })!;
  assert("fixed, not a percentage: the net profit at the suggested price is at least 2 riyals on a cheap carton and on a dear one alike",
    Math.round((a.suggested! / 1.15 - a.fullCost) * 100) / 100 >= 2 && Math.round((a.suggested! / 1.15 - a.fullCost) * 100) / 100 < 2.5
    && Math.round((b.suggested! / 1.15 - b.fullCost) * 100) / 100 >= 2 && Math.round((b.suggested! / 1.15 - b.fullCost) * 100) / 100 < 2.5, JSON.stringify([a, b]));
  const pre = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: null, minProfit: 2 })!;
  assert("before the VAT cutoff: 23 + 2 = 25.00, nothing × 1.15", pre.suggested === 25 && pre.breakEven === 23);
  const noShare = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: null, vatRatePct: 15, minProfit: 2 })!;
  assert("the carton share unreadable: no suggested price", noShare.suggested === null && noShare.breakEven === null);
}

console.log("\n[أ] the settings: «الربح الأدنى للكرتون» is read, «الهامش الأدنى ٪» by nothing");
{
  const env = fresh(`${DAY} 03:00`); cost(500);
  const s = await quiet(() => OC.readPricingSettings(env, DAY));
  assert("readPricingSettings gives minProfit 2, and no margin at all", s?.minProfit === 2 && !("minMarginPct" in (s as object)), JSON.stringify(s));
  const bare = { ...table("x_pricing_config").get(1)! } as any;
  delete (table("x_pricing_config").get(1) as any).x_min_profit_sar;
  assert("a settings record without the value: the default, 2 riyals", (await quiet(() => OC.readPricingSettings(env, DAY)))?.minProfit === 2 && EN.DEFAULT_MIN_PROFIT_SAR === 2);
  table("x_pricing_config").get(1)!.x_min_profit_sar = bare.x_min_profit_sar;
  dp(1, 11, 20); market(1, 11, 29);
  await quiet(() => PR.refreshPriceDay(env));
  const before = { ...lineFor(1) };
  table("x_pricing_config").get(1)!.x_min_margin_pct = 50;
  const r = await quiet(() => PR.refreshPriceDay(env));
  assert("«الهامش الأدنى ٪» set to 50 on the record: nothing is recomputed, no number moves", r.action === "unchanged" && lineFor(1).x_suggested_price === before.x_suggested_price && lineFor(1).x_suggested_price === 29 && lineFor(1).x_status === "auto");
  assert("…and nothing asks Odoo for it", !odooLog.some((x) => JSON.stringify(x.body ?? {}).includes("x_min_margin_pct")));
  const code = ["pricing-engine.ts", "pricing-board.ts", "prices.ts", "operating-cost.ts", "suppliers.ts", "odoo.ts", "order-pricing.ts", "owner-summary.ts"].map((f) => stripComments(srcOf(f))).join("\n");
  assert("no code of the price flow names x_min_margin_pct or a margin percent", !/x_min_margin_pct|minMarginPct|MIN_MARGIN_PCT/.test(code));
  table("x_pricing_config").get(1)!.x_min_profit_sar = 4;
  await quiet(() => PR.refreshPriceDay(env));
  // § 54 أ — below the suggested price and above «بدون خسارة» (26.45) is no exception any more («سعر السوق 29 أقل من السعر المربح 31.50» before)
  assert("«الربح الأدنى للكرتون» raised to 4: the next run recomputes (27 × 1.15 = 31.05 → 31.50); the line, now below its suggested price and above «بدون خسارة» 26.45, stays automatic at the market 29 (§ 54)", lineFor(1).x_suggested_price === 31.5 && lineFor(1).x_break_even === 26.45 && lineFor(1).x_status === "auto" && lineFor(1).x_sale_price === 29 && !lineFor(1).x_reason, JSON.stringify(lineFor(1)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the rule: the market price — § 54: once it reaches «بدون خسارة» (the suggested price before), else an exception");
{
  const run = (offers: any[]) => EN.computePricing([ITEM], offers, 5, { ratePct: 15 }, { opShare: 2, minProfit: 2 })[0];
  const p20 = offer({ kind: "purchase", price: 20, model: "dp", partnerId: AHMED });
  const at = run([p20, offer({ price: 29 })]), over = run([p20, offer({ price: 40 })]), under = run([p20, offer({ price: 28.5 })]), loss = run([p20, offer({ price: 26 })]), none = run([p20]);
  assert("market 29 = the suggested 29.00 → automatic at 29", at.exceptions.length === 0 && EN.lineVerdict(at, null, 0).sale === 29);
  assert("market 40 → published at 40 (the market price, never lowered to the suggested one)", over.exceptions.length === 0 && EN.lineVerdict(over, null, 0).sale === 40);
  assert("market 28.50 (under the new suggested 29.00, above «بدون خسارة» 26.45) → automatic at 28.50 (§ 54: no longer the exception «سعر السوق 28.50 أقل من السعر المربح 29»)", under.exceptions.length === 0 && under.reason === "" && under.suggested === 29 && under.proposal.why === "below_suggested" && EN.lineVerdict(under, null, 0).status === "auto" && EN.lineVerdict(under, null, 0).sale === 28.5, JSON.stringify(under.proposal));
  assert("market 26 (under «بدون خسارة» 26.45) → an exception, with both numbers in its reason", loss.exceptions.join() === "loss" && loss.reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && EN.lineVerdict(loss, null, 0).status === "exception", JSON.stringify(loss));
  const edge = run([p20, offer({ price: 26.45 })]);
  assert("market 26.45 = «بدون خسارة» exactly → not a loss: no exception, automatic at 26.45", edge.breakEven === 26.45 && edge.exceptions.length === 0 && edge.reason === "" && EN.lineVerdict(edge, null, 0).status === "auto" && EN.lineVerdict(edge, null, 0).sale === 26.45, JSON.stringify([edge.exceptions, edge.proposal]));
  assert("no market price → an exception carrying the suggested 29.00", none.exceptions.join() === "no_market" && none.suggested === 29 && none.proposal.kind === "profit" && none.proposal.price === 29);
  const env = fresh(`${DAY} 04:00`); cost(500);
  dp(1, 11, 20); market(1, 11, 26);                         // a loss: the line waits for Baraa (28.50 would be automatic since § 54)
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const text = String(sentTo(OWNER).map((b: any) => b?.interactive?.body?.text ?? "").find((t: string) => t.includes("طماطم")) ?? "");
  // § 55 — «ربحنا» in place of the purchase and «الفرق»: 26 ÷ 1.15 = 22.61 − the full cost (20 + 1 + 2 = 23) = −0.39
  assert("the 04:00 review names the item with its market price, what a carton loses there (−0.39) and «لا تنشر» — ❌ first", lineFor(1).x_status === "exception" && lineFor(1).x_full_cost === 23 && text.split("\n").includes("❌ طماطم — سوق 26 | ربحنا بسعر السوق: −0.39 ← لا تنشر"), text);
  await quiet(() => PRV.handlePriceReviewButton(env, `prv_r_${dayOf().id}_1`));
  const form = sentTo(OWNER).find((b: any) => b?.interactive?.type === "flow")?.interactive.action.parameters;
  const item = (await PRV.readReviewFormToken(env, String(form?.flow_token)))?.items.find((i: any) => i.name === "طماطم");
  const data = form?.flow_action_payload.data ?? {};
  // § 55 — the suggested price is on the item's second line (y<n>), against the market: 29 − 26 = 3, 3 ÷ 26 = 11.5 %;
  // «بدون خسارة» is no longer in the form's text: it stays on the line in Odoo and in the form's record (the ⚠️ of a manual price below it)
  assert("…and its form («✏️ عدّل») carries the purchase, the market and the same «ربحنا» on the first line, the new suggested price (29) against the market on the second", data[`x${item?.slot}`] === "شراء 20 · سوق 26 · ربحنا بسعر السوق: −0.39" && data[`y${item?.slot}`] === "سعرنا المقترح 29 = أعلى من السوق بـ 3 (+11.5%)", `${data[`x${item?.slot}`]} | ${data[`y${item?.slot}`]}`);
  assert("…the break-even (26.45) on the line in Odoo and in the form's record, no longer in its text", lineFor(1).x_break_even === 26.45 && item?.breakEven === 26.45 && !/بدون خسارة|26\.45/.test(`${data[`x${item?.slot}`]}${data[`y${item?.slot}`]}${JSON.stringify(data[`o${item?.slot}`])}`), JSON.stringify([lineFor(1).x_break_even, item?.breakEven]));
  // 29 ÷ 1.15 = 25.22 − 23 = +2.22
  assert("…and its «بالمقترح» choice the same number, with the profit a carton makes there (+2.22)", JSON.stringify(data[`o${item?.slot}`]?.[0]) === JSON.stringify({ id: "profit", title: "بالمقترح 29 (ربح +2.22)" }) && item?.suggested === 29, JSON.stringify(data[`o${item?.slot}`]));
}

// ================================================================ [ب] the fallback sale price = the suggested price
console.log("\n[ب] a supplier's row: its fallback sale price is the suggested price of its purchase price");
{
  const f = { wastePct: 5, opShare: 1.99, minProfit: 2, vatRatePct: 15 };
  assert("fallbackSale(22) = 31.50, (16) = 24.00, (12) = 19.50 — not purchase × 1.38 (30.36 / 22.08 / 16.56)", PB.fallbackSale(22, f) === 31.5 && PB.fallbackSale(16, f) === 24 && PB.fallbackSale(12, f) === 19.5);
  assert("no carton share, no settings, no purchase price: 0 (no fallback)", PB.fallbackSale(22, { ...f, opShare: null }) === 0 && PB.fallbackSale(22, null) === 0 && PB.fallbackSale(0, f) === 0);

  const env = fresh(`${DAY} 03:10`); cost(500);
  const sup = { ...table("res.partner").get(AHMED)!, id: AHMED } as any;
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 20, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await quiet(() => SUP.handleSupplierReply(env, sup, "طماطم 20", "wamid.S48a"));
  const row = rows("x_daily_price")[0] as any;
  const created = (log: typeof odooLog) => log.filter((x) => x.model === "x_daily_price" && x.method === "create").flatMap((x) => x.body?.vals_list ?? []);
  assert("Ahmed answers «طماطم 20»: the row is CREATED with x_sale_price = 29.00 (the suggested price), not 20 × 1.15 × 1.20 = 27.60", row?.x_price_sar === 20 && row.x_sale_price === 29 && created(odooLog).length === 1 && created(odooLog)[0].x_sale_price === 29, JSON.stringify(created(odooLog)));
  const f2 = await quiet(() => PB.dayFloorInputs(env, DAY));
  assert("dayFloorInputs: the day's waste 5 %, share 2.00, minimum profit 2, VAT 15", JSON.stringify(f2) === JSON.stringify({ wastePct: 5, opShare: 2, minProfit: 2, vatRatePct: 15 }), JSON.stringify(f2));

  const env2 = fresh(`${DAY} 03:10`);                       // a monthly cost and no working schedule: the day's cost «تعذّر»
  seed("x_operating_cost", { x_name: "صيانة", x_cost_type: "fixed", x_frequency: "monthly", x_amount: 2600, x_date_from: "2026-01-01", x_date_to: false, x_utak_simulation: false });
  table("hr.employee").forEach((e: any) => { e.resource_calendar_id = false; });
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 20, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await quiet(() => SUP.handleSupplierReply(env2, { ...table("res.partner").get(AHMED)!, id: AHMED } as any, "طماطم 20", "wamid.S48b"));
  const bare = rows("x_daily_price")[0] as any;
  const made = odooLog.filter((x) => x.model === "x_daily_price" && x.method === "create").flatMap((x) => x.body?.vals_list ?? []);
  assert("the day's cost cannot be read: the price is saved, with NO fallback (created with 0) — never a guessed one", bare?.x_price_sar === 20 && !(bare.x_sale_price > 0) && made.length === 1 && made[0].x_sale_price === 0, JSON.stringify(made));
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 19, x_sale_price: 26.22, x_date: "2026-10-02", x_extraction_status: "extracted" });
  const got = await quiet(() => OD.getLatestSalePrice(env2, 1, 11, DAY));
  assert("…so the item has no price («missing») — yesterday's 26.22 does not take its place", got.price === 0 && got.source === "missing", JSON.stringify(got));
  const o = order(C1, "draft", DAY);
  for (const l of rows("x_daily_order_line") as any[]) if (l.x_order_id === o) l.x_unit_price = 0;
  const z = await quiet(() => ZP.orderZeroLines(env2, o));
  assert("…and the zero-price guard stops the order (its line has no price)", z?.zero.length === 1 && z.zero[0].product === "طماطم", JSON.stringify(z));
  setExtract(null);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the engine keeps every supplier row of the day in step");
{
  const env = fresh(`${DAY} 03:00`); cost(500);
  const typed = dp(1, 11, 20);                              // typed in Odoo: a purchase price, no x_sale_price
  const pending = seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: 26, x_sale_price: 35.88, x_date: DAY, x_extraction_status: "pending" });
  const sim = seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 16, x_sale_price: 22.08, x_date: DAY, x_extraction_status: "extracted", x_utak_simulation: true });
  const old = seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 22, x_sale_price: 30.36, x_date: "2026-10-02", x_extraction_status: "extracted" });
  await quiet(() => PR.refreshPriceDay(env));
  assert("a row typed in Odoo gets its fallback: 20 → 29.00", dpRow(typed).x_sale_price === 29, JSON.stringify(dpRow(typed)));
  assert("a row carrying the old purchase × 1.38 (35.88) is corrected: 26 → 36.00 (an outlier «pending» row too)", dpRow(pending).x_sale_price === 36);
  assert("a simulation row is never read or written (16 / 22.08 as they were)", dpRow(sim).x_sale_price === 22.08 && lineFor(1).x_cost_price === 20 && !String(lineFor(1).x_offers).includes("16"));
  assert("another day's row is not touched (the history stays: 30.36)", dpRow(old).x_sale_price === 30.36);
  const second = await quiet(() => PR.refreshPriceDay(env));
  assert("the next tick: nothing changed («unchanged»)", second.action === "unchanged", JSON.stringify(second));
  dpRow(typed).x_sale_price = 99;                           // typed over in Odoo
  const third = await quiet(() => PR.refreshPriceDay(env));
  assert("a value typed over the fallback is put back at the next run (29.00)", third.action === "refreshed" && dpRow(typed).x_sale_price === 29);
  table("x_operating_cost").forEach((r: any) => { r.x_amount = 1000; });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the day's cost doubles (share 4.00): the fallback follows the suggested price (27 × 1.15 = 31.05 → 31.50)", dpRow(typed).x_sale_price === 31.5 && lineFor(1).x_suggested_price === 31.5);
  table("x_pricing_config").get(1)!.x_expected_cartons = false;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("«الكراتين المتوقعة» emptied (no carton share): the fallback is removed (0), not left at an old number", dpRow(typed).x_sale_price === 0 && dpRow(pending).x_sale_price === 0 && lineFor(1).x_suggested_price === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the price a quotation takes when the day is not published");
{
  const env = fresh(`${DAY} 08:00`); cost(500);
  dp(1, 11, 23); omar(1, 11, { purchase: 20 });             // two sources: the line's purchase is the lowest (Omar's 20)
  omar(3, 31, { purchase: 18 });                            // Omar alone: no supplier row at all
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: AHMED, x_price_sar: 20, x_sale_price: 28, x_date: "2026-10-02", x_extraction_status: "extracted" });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const tomato = await quiet(() => OD.getLatestSalePrice(env, 1, 11, DAY));
  assert("tomato: the day's line's suggested price (29.00, from the lowest purchase 20), not the supplier row's own (23 → 32.50)", tomato.price === 29 && tomato.source === "today" && lineFor(1).x_cost_price === 20 && (rows("x_daily_price")[0] as any).x_sale_price === 32.5, JSON.stringify(tomato));
  const potato = await quiet(() => OD.getLatestSalePrice(env, 3, 31, DAY));
  assert("potato, bought by Omar alone (no supplier row): its line's suggested 26.50 — it had no fallback before § 48", potato.price === 26.5 && potato.source === "today", JSON.stringify(potato));
  const onion = await quiet(() => OD.getLatestSalePrice(env, 4, 41, DAY));
  assert("onion, priced by nobody today: its latest price, «stale» (28 of yesterday), as before", onion.price === 28 && onion.source === "stale" && onion.price_date === "2026-10-02", JSON.stringify(onion));
  // Omar alone, and the carton share unreadable: the line has a purchase price and no suggested price → no price at all
  const env1 = fresh(`${DAY} 08:00`); cost(500);
  table("x_pricing_config").get(1)!.x_expected_cartons = false;
  omar(3, 31, { purchase: 18 });
  seed("x_daily_price", { x_product_tmpl_id: 3, x_packaging_id: 31, x_supplier_id: AHMED, x_price_sar: 17, x_sale_price: 23.46, x_date: "2026-10-02", x_extraction_status: "extracted" });
  await quiet(() => PR.refreshPriceDay(env1, { force: true }));
  const noShare = await quiet(() => OD.getLatestSalePrice(env1, 3, 31, DAY));
  assert("a purchase price today (Omar's, no supplier row) whose suggested price cannot be made: «missing» — never yesterday's 23.46", lineFor(3).x_cost_price === 18 && lineFor(3).x_suggested_price === 0 && noShare.price === 0 && noShare.source === "missing", JSON.stringify(noShare));
  // before the engine wrote the line: the supplier's row answers
  const env2 = fresh(`${DAY} 08:00`); cost(500);
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 20, x_sale_price: 29, x_date: DAY, x_extraction_status: "extracted" });
  const early = await quiet(() => OD.getLatestSalePrice(env2, 1, 11, DAY));
  assert("no line yet for the day: the supplier row's fallback (29.00)", early.price === 29 && early.source === "today", JSON.stringify(early));
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: 25, x_sale_price: 34.5, x_date: "2026-10-02", x_extraction_status: "extracted" });
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: 26, x_date: DAY, x_extraction_status: "extracted" });
  const bareRow = await quiet(() => OD.getLatestSalePrice(env2, 2, 21, DAY));
  assert("…and a row of today with a purchase price and no fallback (no line yet either): «missing», not yesterday's 34.50", bareRow.price === 0 && bareRow.source === "missing", JSON.stringify(bareRow));
  // simulation rows and days are never a price
  const env3 = fresh(`${DAY} 08:00`); cost(500);
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 16, x_sale_price: 22.08, x_date: DAY, x_extraction_status: "extracted", x_utak_simulation: true });
  const simDay = seed("x_price_day", { x_date: DAY, x_state: "draft", x_name: "محاكاة", x_utak_simulation: true });
  seed("x_price_day_line", { x_day_id: simDay, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 16, x_suggested_price: 24, x_sale_price: 0, x_excluded: true });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 20, x_sale_price: 28, x_date: "2026-10-02", x_extraction_status: "extracted" });
  const none = await quiet(() => OD.getLatestSalePrice(env3, 1, 11, DAY));
  assert("a simulation row and a simulation day's line are nothing: not a price (24 / 22.08), and not «a purchase price today» either — yesterday's real 28, «stale»", none.price === 28 && none.source === "stale" && none.price_date === "2026-10-02", JSON.stringify(none));
  // published: the published price first, the suggested price for a line left out
  const env4 = fresh(`${DAY} 05:55`); cost(500);
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, 20); market(1, 11, 34.5); dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env4));
  setRiyadh(`${DAY} 06:00`);
  await quiet(() => PR.runPricesTick(env4, Date.now()));
  const pub = await quiet(() => OD.getLatestSalePrice(env4, 1, 11, DAY)), left = await quiet(() => OD.getLatestSalePrice(env4, 3, 31, DAY));
  assert("a published day: the published market price (34.50) comes first", dayOf().x_state === "published" && pub.price === 34.5 && pub.source === "today", JSON.stringify(pub));
  assert("…and an item left out of the publication (an exception without a decision) sells at its suggested price (26.50)", lineFor(3).x_status === "unpublished" && left.price === 26.5, JSON.stringify(left));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ج] the preview, and «—»
console.log("\n[ج] the preview of a line without an approved price, in fields of its own");
{
  const p = PB.boardLine({ purchase: 22, sale: 0, wastePct: 5, vatRatePct: 15, opShare: 1.99, minProfit: 2 });
  assert("no approved price, no market: the preview at the suggested 31.50 → 31.50 ÷ 1.15 − 25.09 = 2.30", p.x_preview_sale === 31.5 && p.x_preview_profit === 2.3, JSON.stringify(p));
  assert("…the real numbers stay empty: no sale, real profit 0, ⚪", p.x_board_sale === 0 && p.x_net_sale === 0 && p.x_real_profit === 0 && p.x_board_status === "none");
  const a = PB.boardLine({ purchase: 22, sale: 31.5, approved: true, wastePct: 5, vatRatePct: 15, opShare: 1.99, minProfit: 2 });
  assert("an approved line has no preview: its real profit is the number (2.30, 🟢)", a.x_preview_sale === 0 && a.x_preview_profit === 0 && a.x_real_profit === 2.3 && a.x_board_status === "green", JSON.stringify(a));
  const m = PB.boardLine({ purchase: 26, sale: 31.05, approved: false, wastePct: 5, vatRatePct: 15, opShare: 2, minProfit: 2 });
  assert("an exception with a market price: the real profit and status keep their meaning (at the market price: −2.30, 🔴), the preview beside them (36.00 → +2.00)", m.x_board_sale === 31.05 && m.x_real_profit === -2.3 && m.x_board_status === "red" && m.x_preview_sale === 36 && m.x_preview_profit === 2, JSON.stringify(m));
  assert("no purchase price, or no carton share: no preview", PB.boardLine({ purchase: null, sale: 30, wastePct: 5, vatRatePct: 15, opShare: 2, minProfit: 2 }).x_preview_sale === 0 && PB.boardLine({ purchase: 22, sale: 0, wastePct: 5, vatRatePct: 15, opShare: null, minProfit: 2 }).x_preview_profit === 0);
  assert("the two fields are the board's own (written with it)", (PB.BOARD_LINE_FIELDS as readonly string[]).includes("x_preview_sale") && (PB.BOARD_LINE_FIELDS as readonly string[]).includes("x_preview_profit"));

  const env = fresh(`${DAY} 04:00`); cost(500); fourLines(); dp(4, 41, 30);
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1), c = lineFor(2), o = lineFor(4);
  assert("on the day — tomato, approved automatically: no preview", t.x_status === "auto" && t.x_preview_sale === 0 && t.x_preview_profit === 0 && t.x_real_profit === 7, JSON.stringify(t));
  assert("…cucumber, an exception: its preview 36.00 / +2.00, its real card still the market's (🔴 −2.30)", c.x_status === "exception" && c.x_preview_sale === 36 && c.x_preview_profit === 2 && c.x_real_profit === -2.3 && c.x_board_status === "red", JSON.stringify(c));
  assert("…onion, no market price: the preview (30 + 1.5 + 2 = 33.50 → 41.00, +2.15), ⚪ and real profit 0", o.x_status === "exception" && o.x_preview_sale === 41 && o.x_preview_profit === 2.15 && o.x_board_status === "none" && o.x_real_profit === 0, JSON.stringify(o));
  // § 54 — the decision is the review's: «✅ نفّذ المقترح» (§ 55; «✅ اعتمد الكل كما هو» before) gives the onion its proposed «انشر بـ 41», the suggested price (the two losses: «لا تنشر»)
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  await quiet(() => PRV.handlePriceReviewButton(env, `prv_a_${dayOf().id}_1`));
  const o2 = lineFor(4);
  assert("«انشر بالمقترح» on it (its proposed decision, «✅ نفّذ المقترح»): the preview becomes the real profit (41.00, +2.15, 🟢) and leaves", o2.x_decision === "profit" && o2.x_status === "manual" && o2.x_sale_price === 41 && o2.x_real_profit === 2.15 && o2.x_board_status === "green" && o2.x_preview_sale === 0 && o2.x_preview_profit === 0, JSON.stringify(o2));
  table("product.template").get(4)!.x_is_active_for_sale = false;            // the approved onion leaves the catalog
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const gone = lineFor(4);
  assert("an approved line whose product leaves the catalog («لم يُنشر»): no sale price any more, and its preview back at once (41.00, +2.15)", gone.x_status === "unpublished" && gone.x_sale_price === 0 && gone.x_preview_sale === 41 && gone.x_preview_profit === 2.15 && gone.x_real_profit === 0, JSON.stringify(gone));
  table("x_price_day_line").get(c.id)!.x_preview_sale = 0;
  await quiet(() => PR.rewriteBoard(env, dayOf().id));
  assert("the board rewritten from the stored lines writes the preview too", lineFor(2).x_preview_sale === 36);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] «—» for a value that does not exist (the Python Odoo computes, run in python3)");
{
  const codes = Object.fromEntries((VW.LINE_FIELDS as any[]).filter((f) => f.compute).map((f) => [f.name, f.compute]));
  const PY = `
import json, sys
codes = json.loads(sys.argv[1]); cases = json.loads(sys.argv[2])
class Rec:
    def __init__(s, d):
        s.__dict__.update(d); s.out = {}
    def __setitem__(s, k, v): s.out[k] = v
res = []
for c in cases:
    r = Rec(c)
    for name, code in codes.items(): exec(code, {'self': [r]})
    res.append(r.out)
print(json.dumps(res))`;
  const base = { x_market_price: 0, x_sale_price: 0, x_real_profit: 0, x_preview_sale: 0, x_preview_profit: 0, x_manual_price: 0, x_cost_price: 0, x_break_even: 0, x_suggested_price: 0 };
  const cases = [
    base,
    { ...base, x_cost_price: 22, x_break_even: 28.85, x_suggested_price: 31.5, x_preview_sale: 31.5, x_preview_profit: 2.3 },
    { ...base, x_cost_price: 22, x_break_even: 28.85, x_suggested_price: 31.5, x_sale_price: 31.5, x_real_profit: 2.3, x_manual_price: 31.5 },
    { ...base, x_cost_price: 26, x_market_price: 31.05, x_real_profit: -2.3, x_preview_sale: 36, x_preview_profit: 2 },
    { ...base, x_market_price: 30, x_real_profit: 0 },
    { ...base, x_cost_price: 20, x_market_price: 23, x_sale_price: 23, x_real_profit: -3 },
  ];
  const out = JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify(codes), JSON.stringify(cases)], { encoding: "utf8" }));
  assert("seven computed texts: the market, the sale, the profit / preview, the manual price, the purchase, the break-even, the suggested price", JSON.stringify(Object.keys(codes).sort()) === JSON.stringify([...VW.DISPLAY_FIELDS].sort()) && VW.DISPLAY_FIELDS.length === 7);
  assert("an empty line: «—» everywhere, never 0.00", Object.values(out[0]).every((v) => v === "—") && Object.keys(out[0]).length === 7, JSON.stringify(out[0]));
  assert("a purchase price and nothing else: السوق «—», البيع «—», السعر المعدّل «—», and «معاينة 2.30»", out[1].x_market_show === "—" && out[1].x_sale_show === "—" && out[1].x_manual_show === "—" && out[1].x_profit_show === "معاينة 2.30" && out[1].x_cost_show === "22.00" && out[1].x_even_show === "28.85" && out[1].x_suggested_show === "31.50", JSON.stringify(out[1]));
  assert("an approved line: the numbers with two decimals, the real profit, no «معاينة»", out[2].x_sale_show === "31.50" && out[2].x_profit_show === "2.30" && out[2].x_manual_show === "31.50" && out[2].x_market_show === "—", JSON.stringify(out[2]));
  assert("an exception with a market price: the market price shown, the sale «—», the preview — not the market's loss", out[3].x_market_show === "31.05" && out[3].x_sale_show === "—" && out[3].x_profit_show === "معاينة 2.00", JSON.stringify(out[3]));
  assert("a market price without a purchase price: no profit and no preview («—»)", out[4].x_profit_show === "—" && out[4].x_cost_show === "—" && out[4].x_suggested_show === "—", JSON.stringify(out[4]));
  assert("an approved line that loses: its real loss (−3.00), not a preview", out[5].x_profit_show === "-3.00", JSON.stringify(out[5]));
  const cols = String(VW.DAY_COLUMNS);
  assert("the day's list shows the texts (السوق، البيع، الربح / المعاينة) and not the raw 0.00 numbers", ["x_market_show", "x_sale_show", "x_profit_show", "x_even_show", "x_suggested_show"].every((f) => new RegExp(`<field name="${f}" string=`).test(cols)) && /<field name="x_market_price" column_invisible="1"\/>/.test(cols) && /<field name="x_sale_price" column_invisible="1"\/>/.test(cols) && !/name="x_unit_profit"/.test(cols));
  assert("«معاينة» is set apart: the word itself, and italics on the cell of a line without an approved price", /name="x_profit_show"[^>]*decoration-it="not x_sale_price and x_preview_sale"/.test(cols));
  assert("«السعر المعدّل» is an input of «سعر معدّل»: empty (not 0.00) on a line that carries no price", /name="x_manual_price" invisible="x_decision != 'edit' and not x_manual_price"/.test(cols));
  const note = String(VW.DAY_NOTE);
  assert("the explanation at the top is the real formula: the raw purchase, the waste, the carton share, the minimum profit, the rule, the preview",
    ["الشراء خام بدون ضريبة", "التالف (نسبة التالف × الشراء)", "حصة الكرتون", "(التكلفة الكاملة + الربح الأدنى للكرتون) × 1.15", "لأعلى لأقرب نصف ريال", "سعر السوق متى بلغ المقترح", "استثناء", "معاينة"].every((t) => note.includes(t)) && !/الهامش الأدنى|1\.05|٪/.test(note), note);
  assert("no screen text of § 48 says «الهامش الأدنى ٪» as a rule", ![VW.DAY_NOTE, VW.BOARD_NOTE, VW.SETTINGS_NOTE].some((t: string) => t.includes("الهامش الأدنى")));
}

// ================================================================ [د] a decision in Odoo on a missed day
console.log("\n[د] 2026-10-01: «اعتمد بالسعر المربح» chosen in Odoo on the «فات الموعد» day, then «🔄 إعادة الحساب»");
{
  const env = tenOne();
  await quiet(() => PR.refreshPriceDay(env, { day: TEN_01, force: true }));
  for (const id of [1, 2, 3]) table("x_price_day_line").get(lineFor(id, TEN_01).id)!.x_decision = "profit";   // saved in the form, «السعر المعدّل» empty
  assert("the decision alone changes nothing (what 2026-10-01 12:51 looked like): still an exception, sale 0", [1, 2, 3].every((id) => lineFor(id, TEN_01).x_status === "exception" && lineFor(id, TEN_01).x_sale_price === 0 && !lineFor(id, TEN_01).x_decided_at));
  graph.length = 0; odooLog.length = 0;
  const r = await quiet(() => PR.refreshPriceDay(env, { day: TEN_01, force: true }));          // the hook of «🔄 إعادة الحساب»
  const want: Array<[number, number, number]> = [[1, 31.5, 2.3], [2, 24, 2.08], [3, 19.5, 2.37]];
  for (const [id, sale, profit] of want) {
    const l = lineFor(id, TEN_01);
    assert(`${l.x_name}: البيع ${sale.toFixed(2)} = المقترح، «معتمد يدوياً»، والربح الحقيقي ${profit.toFixed(2)} 🟢`,
      l.x_status === "manual" && l.x_sale_price === sale && l.x_suggested_price === sale && l.x_excluded === false && l.x_reason === "براء: اعتمد بالسعر المربح"
      && l.x_board_sale === sale && l.x_real_profit === profit && l.x_board_status === "green" && l.x_preview_sale === 0 && l.x_manual_price === sale && l.x_manual_for === "profit" && !!l.x_decided_at, JSON.stringify(l));
  }
  const d = dayOf(TEN_01);
  assert("the day stays «فات الموعد»: its state is never written, not approved, not published", r.action === "refreshed" && d.x_state === "missed" && !d.x_approved_at && !d.x_published_at && !odooLog.some((x) => x.model === "x_price_day" && "x_state" in (x.body?.vals ?? {})), JSON.stringify(d));
  assert("…its header counts the three as 🟢 (and ⚪ 1: the product nobody priced)", d.x_n_green === 3 && d.x_n_none === 1 && d.x_n_yellow === 0 && d.x_n_red === 0 && d.x_op_share === 1.99, JSON.stringify(d));
  assert("nothing is sent: no message to anyone, nothing held", graph.length === 0 && heldFor(env, OWNER).length === 0 && heldFor(env, "966500000501").length === 0);
  const q = await quiet(() => OD.getLatestSalePrice(env, 1, 11, TEN_01));
  assert("a quotation that day takes the suggested 31.50 (the fallback: the day is not published)", q.price === 31.5 && q.source === "today", JSON.stringify(q));
  assert("…and the publication's own check accepts the line (its price = the rule)", EN.saleRule(lineFor(1, TEN_01)) === 31.5);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د] the tick applies a decision taken in Odoo that nobody recomputed");
{
  const env = tenOne(`${TEN_01} 13:00`);
  await quiet(() => PR.refreshPriceDay(env, { day: TEN_01, force: true }));
  table("x_price_day_line").get(lineFor(1, TEN_01).id)!.x_decision = "profit";
  graph.length = 0; odooLog.length = 0;
  const t1 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("13:00 is outside the engine's hours («outside»), yet the day is recomputed for the waiting decision", (t1.refresh as any)?.action === "outside" && Array.isArray(t1.decisions) && t1.decisions.length === 1 && t1.decisions[0].day === TEN_01 && t1.decisions[0].action === "refreshed", JSON.stringify(t1));
  const l = lineFor(1, TEN_01);
  assert("…the line is approved at 31.50, «وقت القرار» written, the day still missed, nothing sent", l.x_status === "manual" && l.x_sale_price === 31.5 && !!l.x_decided_at && dayOf(TEN_01).x_state === "missed" && graph.length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(l));
  odooLog.length = 0;
  setRiyadh(`${TEN_01} 13:05`);
  const t2 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("the next tick: nothing waiting, no day recomputed, no write", Array.isArray(t2.decisions) && t2.decisions.length === 0 && !odooLog.some((x) => x.method === "write" || x.method === "create"), JSON.stringify(t2.decisions));
  // yesterday's missed day, at 09:00 the next morning
  table("x_price_day_line").get(lineFor(2, TEN_01).id)!.x_decision = "profit";
  setRiyadh("2026-10-02 09:00");
  const t3 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("a decision on YESTERDAY's missed day is applied too (24.00)", Array.isArray(t3.decisions) && t3.decisions.some((x) => x.day === TEN_01) && lineFor(2, TEN_01).x_sale_price === 24 && dayOf(TEN_01).x_state === "missed", JSON.stringify(t3.decisions));
  table("x_price_day_line").get(lineFor(3, TEN_01).id)!.x_decision = "profit";
  setRiyadh("2026-10-03 09:00");
  const t4 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("…an older day (two days back) is left to «🔄 إعادة الحساب»: the tick does not look further than yesterday", Array.isArray(t4.decisions) && !t4.decisions.some((x) => x.day === TEN_01) && lineFor(3, TEN_01).x_sale_price === 0 && PR.ODOO_DECISION_DAYS_BACK === 1);
  await quiet(() => PR.refreshPriceDay(env, { day: TEN_01, force: true }));
  assert("…which applies it (19.50)", lineFor(3, TEN_01).x_sale_price === 19.5 && lineFor(3, TEN_01).x_status === "manual");
}
{
  const env = fresh(`${DAY} 13:00`); cost(500);
  const pub = seed("x_price_day", { x_date: DAY, x_state: "published", x_name: "منشور", x_utak_simulation: false });
  const locked = seed("x_price_day_line", { x_day_id: pub, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_sale_price: 30, x_status: "auto", x_decision: "skip", x_decided_at: false });
  const simDay = seed("x_price_day", { x_date: DAY, x_state: "draft", x_name: "محاكاة", x_utak_simulation: true });
  seed("x_price_day_line", { x_day_id: simDay, x_product_tmpl_id: 2, x_packaging_id: 21, x_cost_price: 20, x_status: "exception", x_decision: "profit", x_decided_at: false });
  odooLog.length = 0;
  const t = await quiet(() => PR.applyOdooDecisions(env));
  assert("a published day and a simulation day are never recomputed for a decision", t.length === 0 && !odooLog.some((x) => x.method === "write") && (table("x_price_day_line").get(locked) as any).x_sale_price === 30, JSON.stringify(t));
  const dom = JSON.stringify(odooLog.find((x) => x.model === "x_price_day_line" && x.method === "search_read")?.body?.domain ?? []);
  assert("the tick's one read: a decision, no «وقت القرار», a draft or missed real day, today or yesterday", dom.includes('["x_decision","!=",false]') && dom.includes('["x_decided_at","=",false]') && dom.includes('["x_day_id.x_state","in",["draft","missed"]]') && dom.includes('["x_day_id.x_utak_simulation","!=",true]') && dom.includes('["x_day_id.x_date",">=","2026-10-02"]') && dom.includes(`["x_day_id.x_date","<=","${DAY}"]`), dom);
}
{
  const env = fresh(`${DAY} 13:00`); cost(500); dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  table("product.template").get(3)!.x_is_active_for_sale = false;                 // it left the catalog
  table("x_price_day_line").get(lineFor(3).id)!.x_decision = "profit";
  const a = await quiet(() => PR.applyOdooDecisions(env));
  const l = lineFor(3);
  assert("a decision on a line whose product is not for sale: the line stays «لم يُنشر» (sale 0), with its preview", a.length === 1 && l.x_status === "unpublished" && l.x_sale_price === 0 && l.x_excluded === true && l.x_preview_sale === 26.5, JSON.stringify(l));
  assert("…and is marked seen, so the tick does not recompute the day again every five minutes", !!l.x_decided_at && (await quiet(() => PR.applyOdooDecisions(env))).length === 0);
}

console.log("\n[د] a decision changed in Odoo does not inherit another decision's price");
{
  const fx = EN.fixedPrice;
  assert("fixedPrice: «سعر معدّل» is his number whatever it was fixed for", fx({ x_decision: "edit", x_manual_price: 31, x_manual_for: "profit" }) === 31 && fx({ x_decision: "edit", x_manual_price: 31 }) === 31);
  assert("…a price fixed for «profit» counts for «profit» alone", fx({ x_decision: "profit", x_manual_price: 26.5, x_manual_for: "profit" }) === 26.5 && fx({ x_decision: "market", x_manual_price: 26.5, x_manual_for: "profit" }) === 0 && fx({ x_decision: "profit", x_manual_price: 23, x_manual_for: "market" }) === 0);
  assert("…a price fixed before § 48 (no mark) is the decision's, as it was", fx({ x_decision: "market", x_manual_price: 27.5, x_manual_for: false }) === 27.5 && fx({ x_decision: "profit", x_manual_price: 28 }) === 28);
  assert("…no price: 0", fx({ x_decision: "profit", x_manual_price: 0, x_manual_for: "profit" }) === 0);
  assert("the publication's check reads the same rule", EN.saleRule({ x_status: "manual", x_market_price: 23, x_manual_price: 26.5, x_decision: "market", x_manual_for: "profit", x_suggested_price: 26.5 }) === 23
    && EN.saleRule({ x_status: "manual", x_market_price: 23, x_manual_price: 26.5, x_decision: "profit", x_manual_for: "profit", x_suggested_price: 29 }) === 26.5);

  const env = fresh(`${DAY} 05:00`); cost(500); fourLines();                      // potato: purchase 18, market 23, suggested 26.50
  await quiet(() => PR.refreshPriceDay(env));
  const id = lineFor(3).id, line = () => table("x_price_day_line").get(id) as any;
  line().x_decision = "profit";
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("«اعتمد بالسعر المربح» in Odoo: approved at 26.50, the price fixed for «profit»", line().x_sale_price === 26.5 && line().x_manual_price === 26.5 && line().x_manual_for === "profit");
  line().x_decision = "market";                                                    // he changes his mind in the list
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("changed to «اعتمد بسعر السوق»: approved at the market price 23 — NOT at the 26.50 fixed for the other decision", line().x_status === "manual" && line().x_sale_price === 23 && line().x_reason === "براء: اعتمد بسعر السوق", JSON.stringify(line()));
  assert("…the stale fixed price is removed, so the publication's check agrees (23)", line().x_manual_price === 0 && !line().x_manual_for && EN.saleRule(line()) === 23);
  line().x_decision = "profit";
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("back to «اعتمد بالسعر المربح»: 26.50 again, fixed again", line().x_sale_price === 26.5 && line().x_manual_price === 26.5 && line().x_manual_for === "profit");
  line().x_decision = "skip";
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("«لا تنشر»: not published, and the price fixed by the worker goes with the decision", line().x_status === "unpublished" && line().x_sale_price === 0 && line().x_manual_price === 0 && !line().x_manual_for);
  line().x_decision = "profit";
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  line().x_decision = false;                                                       // the decision removed
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the decision removed: an exception again (sale 0, its preview back), the fixed price gone", line().x_status === "exception" && line().x_sale_price === 0 && line().x_manual_price === 0 && !line().x_manual_for && line().x_preview_sale === 26.5, JSON.stringify(line()));
  line().x_decision = "edit"; line().x_manual_price = 31;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("«سعر معدّل» 31: approved at 31, marked «edit»", line().x_sale_price === 31 && line().x_manual_price === 31 && line().x_manual_for === "edit" && line().x_reason === "براء: سعر معدّل");
  line().x_decision = "profit";
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…changed to «اعتمد بالسعر المربح»: the suggested 26.50, not his 31", line().x_sale_price === 26.5 && line().x_manual_price === 26.5 && line().x_manual_for === "profit");
  // a number he typed himself, with no decision, is his: the engine leaves it
  const cid = lineFor(2).id;
  (table("x_price_day_line").get(cid) as any).x_manual_price = 40;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("a price typed with no decision is left as typed (no decision → still an exception)", (table("x_price_day_line").get(cid) as any).x_manual_price === 40 && lineFor(2).x_status === "exception");
  // before § 48: a WhatsApp «اعتمد بسعر السوق» fixed the price without a mark
  const tid = lineFor(1).id;
  Object.assign(table("x_price_day_line").get(tid) as any, { x_decision: "market", x_manual_price: 33, x_manual_for: false, x_decided_at: "2026-10-03 01:00:00" });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("a market price fixed before § 48 (no mark) stays his (33), and gets its mark", lineFor(1).x_sale_price === 33 && lineFor(1).x_manual_price === 33 && lineFor(1).x_manual_for === "market");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د] a source's reply inside the window that gives no price (2026-10-01 05:39, Omar: «شراء رمان ١١ / موز أمريكي ٤٤»)");
{
  const env = fresh(`${DAY} 05:39`); cost(500);
  const who = { partnerId: DRIVER, name: "عمر المجهلي" };
  const text = "شراء رمان ١١\nموز أمريكي ٤٤";
  await PS.writeMarketAskMarker(env, DRIVER_PHONE, DAY, Date.now());            // the ask reached him (his «بدء الدوام»)
  setExtract({ prices: [], unrecognized: ["رمان", "موز أمريكي"] });             // «رمان» is three products; the banana is not for sale
  const r = await quiet(() => PS.tryMarketReply(env, who, `+${DRIVER_PHONE}`, text, "wamid.U1"));
  assert("he is told how to write it (the product's full name, then the price) — not «استخدم الأزرار»", r === PS.MARKET_UNREAD_TEXT && /اسم الصنف كاملاً/.test(String(r)) && /رمان كبير 26 شراء 22/.test(String(r)), String(r));
  const alerts = ownerTexts().filter((x) => x.startsWith("🤔 رد من «عمر المجهلي» على طلب أسعار السوق"));
  assert("Baraa gets ONE alert with the text itself: nothing was saved", alerts.length === 1 && alerts[0].includes(text) && /لم يُحفظ أي سعر/.test(alerts[0]) && rows("x_price_offer").length === 0, JSON.stringify(ownerTexts()));
  await quiet(() => PS.tryMarketReply(env, who, `+${DRIVER_PHONE}`, text, "wamid.U1"));
  assert("the same message delivered twice: no second alert", ownerTexts().filter((x) => x.startsWith("🤔 رد من «عمر المجهلي»")).length === 1);
  const hello = await quiet(() => PS.tryMarketReply(env, who, `+${DRIVER_PHONE}`, "السلام عليكم، وصلت السوق", "wamid.U2"));
  assert("a message with no number in it stays an ordinary message (no alert)", hello === null && ownerTexts().filter((x) => x.startsWith("🤔")).length === 1);
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 24, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  const ok = await quiet(() => PS.tryMarketReply(env, who, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.U3"));
  assert("a readable reply is saved as before («وصلتنا أسعار السوق (1 صنف)»)", ok === PS.marketAckText(1) && rows("x_price_offer").length === 1 && (rows("x_price_offer")[0] as any).x_market_price === 24, String(ok));
  setRiyadh(`${DAY} 07:15`);
  setExtract({ prices: [], unrecognized: ["رمان"] });
  const late = await quiet(() => PS.tryMarketReply(env, who, `+${DRIVER_PHONE}`, "رمان 11", "wamid.U4"));
  assert("outside the 90 minutes: not read as prices, no alert", late === null && ownerTexts().filter((x) => x.startsWith("🤔")).length === 1);
  setExtract(null);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [و] «💲 التسعير»: the places, the screens, the settings
console.log("\n[و] the places: every text of the worker names the screens of «💲 التسعير»");
{
  assert("the five screens, under «💲 التسعير»", PL.PLACE_TODAY === "«💲 التسعير» ← «📊 اليوم»" && PL.PLACE_DAYS === "«💲 التسعير» ← «📅 الأيام السابقة»" && PL.PLACE_SOURCES === "«💲 التسعير» ← «📥 عروض المصادر»" && PL.PLACE_PRODUCTS === "«💲 التسعير» ← «📦 الأصناف»" && PL.PLACE_SETTINGS === "«💲 التسعير» ← «⚙️ الإعدادات»");
  assert("…the same names as the menu the setup script writes", UI.MENU.root === PL.PRICING_MENU && [UI.MENU.today, UI.MENU.days, UI.MENU.sources, UI.MENU.products, UI.MENU.settings].every((n: string, i: number) => [PL.PLACE_TODAY, PL.PLACE_DAYS, PL.PLACE_SOURCES, PL.PLACE_PRODUCTS, PL.PLACE_SETTINGS][i] === `«${UI.MENU.root}» ← «${n}»`));
  const OLD = ["💰 أسعار اليوم", "📊 لوحة التسعير", "⚙️ إعدادات التسعير", "💰 التكاليف التشغيلية", "«الأسعار اليومية»", "عروض المصادر اليومية", "معاملات التسعير", "«سجل أسعار الأيام»", "طلبات الأسعار اليومية"];
  const files = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"));
  const hits = files.flatMap((f) => { const code = stripComments(srcOf(f)); return OLD.filter((o) => code.includes(o)).map((o) => `${f}: ${o}`); });
  assert(`no text of the worker (${files.length} files, comments apart) names a pricing place of before § 48`, hits.length === 0, hits.join(" | "));
  assert("the hidden menus are the eleven pricing menus of before", UI.OLD_MENUS.length === 11 && JSON.stringify(UI.OLD_MENUS.map((m: any) => m[0]).sort((a: number, b: number) => a - b)) === JSON.stringify([535, 537, 553, 555, 556, 572, 573, 577, 578, 579, 581]));

  // the texts as they go out
  const env = fresh(`${DAY} 06:00`); cost(500); dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.runPricesTick(env, Date.now()));
  const missed = ownerTexts().find((x) => x.startsWith("⏰ أسعار اليوم")) ?? "";
  assert("06:00, nothing approved: Baraa is sent to «💲 التسعير» ← «📊 اليوم» for «نشر المعتمد الآن»", dayOf().x_state === "missed" && missed.includes(`«نشر المعتمد الآن» في ${PL.PLACE_TODAY}`), missed);
  // § 54 — a decision from the review on the missed day publishes at once (no «انشر من … بزر «نشر المعتمد الآن»» line any more);
  // what still sends him to the screen: the missed alert's own line, a review whose buttons no longer decide, an old exception message
  assert("…and to the review itself first: «✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً", missed.includes("«✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً") && missed.includes("لم يُنشر (4): ") && missed.includes("بطاطس (بلا سعر سوق وبلا قرار)"), missed);
  const late = await quiet(() => PRV.handlePriceReviewButton(env, `prv_a_${dayOf().id}_1`));
  assert("a decision on the missed day from a review that is no longer there: «…أو قرّر من «💲 التسعير» ← «📊 اليوم»»", late === "no_snapshot" && ownerTexts().at(-1) === `انتهت صلاحية هذه الرسالة: اضغط «${PRV.REVIEW_BUTTON_FORM}»، أو قرّر من ${PL.PLACE_TODAY}.` && !lineFor(3).x_decision, JSON.stringify([late, ownerTexts().at(-1)]));
  assert("a tap on an exception message of before § 54: «…أو من «💲 التسعير» ← «📊 اليوم»»", PR.OLD_EXCEPTION_TEXT.endsWith(`أو من ${PL.PLACE_TODAY}.`), PR.OLD_EXCEPTION_TEXT);
  assert("the review reminder that finds nothing", OW.PRICE_REVIEW_NOTHING_TEXT.endsWith(`التفاصيل في ${PL.PLACE_TODAY}.`));
  assert("the board's note when «الكراتين المتوقعة» is empty names «⚙️ الإعدادات»", PB.boardShare(500, null, { days: 0, average: null }).note.includes(`فارغة في ${PL.PLACE_SETTINGS}`));
  const alert = PSU.newProductAlert({ id: 9, name: "صنف", default_code: false, categ_id: false, x_supplier_ids: [], x_is_active_for_sale: false, x_name_en: false, create_date: "2026-10-03 00:00:00" }, ["المورد"]);
  assert("the «🆕 صنف جديد» alert ends with where to complete it: «📦 الأصناف»", alert.split("\n").at(-1) === `أكمله من ${PL.PLACE_PRODUCTS}.`, alert);
  assert("a supplier due without its price points at «📥 عروض المصادر»", /أدخل سعر المورد لذلك اليوم في \$\{PLACE_SOURCES\} \(ردود الشراء\)/.test(srcOf("supplier-pay.ts")) && typeof SP.syncSupplierDues === "function");
  const docs = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const docHits = ["UTAK ← 💰 أسعار اليوم", "UTAK ← 📊 لوحة التسعير", "UTAK ← ⚙️ إعدادات التسعير", "عروض المصادر اليومية", "في «💰 أسعار اليوم»", "من **💰 أسعار اليوم**"].filter((o) => docs.includes(o));
  assert("the operating-day guide names the five screens and no old pricing place", [UI.MENU.root, UI.MENU.today, UI.MENU.days, UI.MENU.sources, UI.MENU.products, UI.MENU.settings].every((n: string) => docs.includes(n)) && docHits.length === 0, docHits.join(" | "));
}

console.log("\n[و] the confirmation of «نشر المعتمد الآن»: how many customers the day would reach");
{
  const env = fresh(`${DAY} 04:00`); cost(500);
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  seed("res.partner", { id: 892, name: "موقوف", customer_rank: 1, x_whatsapp_number: "+966500000892", x_wa_marketing_optout: true });
  dp(1, 11, 20); market(1, 11, 34.5);
  await quiet(() => PR.refreshPriceDay(env));
  const n = (await quiet(() => PR.priceRecipients(env))).length;
  assert(`the engine writes the publication's own count on the day (${n}: the opted-out customer is not one)`, n === 3 && dayOf().x_n_recipients === n, JSON.stringify(dayOf()));
  seed("res.partner", { id: 893, name: "عميل جديد", customer_rank: 1, x_whatsapp_number: "+966500000893" });
  await quiet(() => PR.rewriteBoard(env, dayOf().id));
  assert("…and «🔄» / a decision's board rewrite brings it up to date (4)", dayOf().x_n_recipients === 4);
  const dry = await quiet(() => PR.rewriteBoard(env, dayOf().id, { dry: true }));
  assert("a dry rewrite counts nothing and writes nothing", !("x_n_recipients" in (dry.header ?? {})));
  const cf = String(UI.confirmForm({ approve: 1002 }));
  assert("the confirmation shows the two numbers and the names, says it sends for real, and carries the only button that publishes", cf.includes('name="x_n_publishable"') && cf.includes('name="x_n_recipients"') && cf.includes('name="x_publish_names"') && cf.includes("رسائل واتساب فعلية") && /<button name="1002" type="action"[^>]*invisible="not x_n_publishable"/.test(cf) && cf.includes('special="cancel"'));
  const A = { refresh: 1004, confirm: 1038, unapprove: 1003, approve: 1002, prev: 1033, next: 1034, openDay: 1032, openSources: 1037, days: 1009, products: 1041, settings: 1027, purchaseList: 1039, marketList: 1040, packagings: 1042, profitGraph: 1043 };
  const df = String(UI.dayForm(A));
  assert("the day's screen: «نشر المعتمد الآن» opens the confirmation (never the approval itself)", /<button name="1038" type="action" string="نشر المعتمد الآن"/.test(df) && !df.includes('name="1002"') && /<button name="1004" type="action" string="🔄 إعادة الحساب"/.test(df));
  assert("…the day before and after, «اليوم» when it is another day, and the other four screens one tap away", df.includes('name="1033"') && df.includes('name="1034"') && /<button name="1032" type="action" string="اليوم"[^>]*invisible="x_is_today"/.test(df) && [1009, 1037, 1041, 1027].every((id) => new RegExp(`<button name="${id}" type="action" string="[^"]+" class="btn btn-link`).test(df)));
  assert("…the header: the date and the state, the day's cost, the carton share and the comparison at 500, the counts, the approval and publication times, the explanation", ["x_date", "x_state", "x_op_cost", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_approved_at", "x_published_at"].every((f) => df.includes(`name="${f}"`)) && df.includes(VW.DAY_NOTE));
  assert("…no record today: a clear note; another day: «هذا يوم سابق»", /invisible="not context.get\('utak_no_today'\)">لا يوجد سجل أسعار لليوم بعد/.test(df) && /invisible="x_is_today or context.get\('utak_no_today'\)">هذا يوم سابق/.test(df));
  const cols = [...String(UI.LINE_LIST).matchAll(/<field name="(\w+)"(?![^>]*column_invisible)/g)].map((m) => m[1]);
  assert("…the lines' table, in the order asked: الصنف، التعبئة، الشراء، المصدر، السوق، المشاهدات، بدون خسارة، المقترح، البيع، الربح / المعاينة، (اللوحة)، الحالة، السبب، قرار براء، السعر المعدّل",
    JSON.stringify(cols) === JSON.stringify(["x_product_tmpl_id", "x_packaging_id", "x_cost_show", "x_supplier_id", "x_market_show", "x_market_count", "x_even_show", "x_suggested_show", "x_sale_show", "x_profit_show", "x_board_status", "x_status", "x_reason", "x_decision", "x_manual_price", "x_offers"]), JSON.stringify(cols));
  assert("…«قرار براء» and «السعر المعدّل» are the only cells he can write, in the row itself", /<list editable="bottom" create="0" delete="0"/.test(UI.LINE_LIST) && /<field name="x_decision" string="قرار براء"\/>/.test(UI.LINE_LIST) && /<field name="x_manual_price" string="السعر المعدّل" invisible=/.test(UI.LINE_LIST)
    && [...String(UI.LINE_LIST).matchAll(/<field name="(x_(?:product_tmpl_id|packaging_id|supplier_id|market_count|board_status|status|reason|offers))"[^>]*>/g)].every((m) => m[0].includes('readonly="1"')));
  assert("…on a phone: cards (the status in words, a coloured side border, «—» texts, no table to scroll sideways)", /mode="list,kanban"/.test(df) && UI.LINE_CARD.includes("border-start border-5") && ["x_cost_show", "x_market_show", "x_even_show", "x_suggested_show", "x_sale_show", "x_profit_show", "x_manual_show", "x_board_status", "x_status", "x_decision"].every((f) => UI.LINE_CARD.includes(`name="${f}"`)) && !/widget="badge"/.test(UI.LINE_CARD));
  assert("…and the preview set apart on the card too (italics)", /fst-italic/.test(UI.LINE_CARD) && /!record\.x_sale_price\.raw_value and record\.x_preview_sale\.raw_value/.test(UI.LINE_CARD));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[و] «نسبة السعر الشاذ» is a setting");
{
  const env = fresh(`${DAY} 03:10`); cost(500);
  assert("the settings give 1.5 when the record carries none", (await quiet(() => OC.readPricingSettings(env, DAY)))?.outlierRatio === 1.5);
  table("x_pricing_config").get(1)!.x_outlier_ratio = 2;
  assert("…Baraa's 2", (await quiet(() => OC.readPricingSettings(env, DAY)))?.outlierRatio === 2 && (await quiet(() => OC.readOutlierRatio(env, DAY))) === 2);
  table("x_pricing_config").get(1)!.x_outlier_ratio = 0.5;
  assert("…a value not above 1 is not a ratio: 1.5", (await quiet(() => OC.readPricingSettings(env, DAY)))?.outlierRatio === 1.5);
  table("x_pricing_config").get(1)!.x_is_active = false;
  assert("…no settings record: 1.5, never a throw", (await quiet(() => OC.readOutlierRatio(env, DAY))) === 1.5);
  table("x_pricing_config").get(1)!.x_is_active = true;
  assert("isPriceOutlier takes the ratio: 20 → 35 is an outlier at 1.5, not at 2; 20 → 40 is one at 2", SUP.isPriceOutlier(20, 35) && SUP.isPriceOutlier(20, 35, 1.5) && !SUP.isPriceOutlier(20, 35, 2) && SUP.isPriceOutlier(20, 40, 2) && SUP.isPriceOutlier(40, 20, 2));
  // Ahmed's last price 20, today's 35
  const sup = { ...table("res.partner").get(AHMED)!, id: AHMED } as any;
  const one = (p: number, m: number | null = null) => ({ prices: [{ product_id: 1, packaging_id: 11, cost_price: p, market_price: m, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 20, x_date: "2026-10-02", x_extraction_status: "extracted" });
  table("x_pricing_config").get(1)!.x_outlier_ratio = 2;
  setExtract(one(35));
  await quiet(() => SUP.handleSupplierReply(env, sup, "طماطم 35", "wamid.R1"));
  const r1 = rows("x_daily_price").at(-1) as any;
  assert("the supplier's 20 → 35 with the ratio at 2: saved «extracted», no outlier alert", r1.x_price_sar === 35 && r1.x_extraction_status === "extracted" && !ownerTexts().some((x) => x.includes("سعر شاذ")), JSON.stringify(r1));
  table("x_pricing_config").get(1)!.x_outlier_ratio = 1.5;
  setExtract(one(60));
  await quiet(() => SUP.handleSupplierReply(env, sup, "طماطم 60", "wamid.R2"));
  const r2 = rows("x_daily_price").at(-1) as any;
  assert("35 → 60 with the ratio at 1.5: «pending» and the alert", r2.x_price_sar === 60 && r2.x_extraction_status === "pending" && ownerTexts().some((x) => x.includes("سعر شاذ")), JSON.stringify(r2));
  // Omar's market observation: his last 24, today's 40
  seed("x_price_offer", { x_product_tmpl_id: 2, x_packaging_id: 21, x_source_partner_id: DRIVER, x_date: "2026-10-02", x_purchase_price: 0, x_market_price: 24, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false });
  const a1 = await quiet(() => PS.saveOffer(env, { partnerId: DRIVER, productId: 2, packagingId: 21, market: 40, text: "خيار 40" }, DAY));
  const a2 = await quiet(() => PS.saveOffer(env, { partnerId: DRIVER, productId: 2, packagingId: 21, market: 70, text: "خيار 70", ratio: 2 }, DAY));
  assert("a market observation 24 → 40 is an outlier at the default 1.5; 40 → 70 is not one at 2", a1.outlier === true && a2.outlier === false, JSON.stringify([a1, a2]));
  table("x_pricing_config").get(1)!.x_outlier_ratio = 2;
  await PS.writeMarketAskMarker(env, DRIVER_PHONE, DAY, Date.now());
  setExtract({ prices: [{ product_id: 2, packaging_id: 21, cost_price: 41, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await quiet(() => PS.tryMarketReply(env, { partnerId: DRIVER, name: "عمر المجهلي" }, `+${DRIVER_PHONE}`, "خيار 41", "wamid.R3"));
  const last = rows("x_price_offer").at(-1) as any;
  assert("…and his reply reads the settings' ratio (41 after 70: ÷ 1.71 — valid at 2, it would be «شاذ» at 1.5)", last.x_market_price === 41 && last.x_status === "valid" && last.x_market_outlier === false, JSON.stringify(last));
  setExtract(null);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[و] «📦 الأصناف»: «ناقص» is the rule of the «🆕 صنف جديد» alert (the Python Odoo computes against the worker's own function)");
{
  const cats: Array<{ id: number; name: string; parent: number | false }> = [{ id: 1, name: "Goods", parent: false }, { id: 5, name: "فواكه", parent: false }, { id: 6, name: "خضار", parent: false }, { id: 51, name: "حمضيات", parent: 5 }];
  type P = { id: number; categ: number | false; suppliers: number[]; afs: boolean; en: string | false; packs: Array<{ id: number; type: string; kg: number; def: boolean; seq: number }> };
  const products: P[] = [
    { id: 1, categ: false, suppliers: [], afs: false, en: false, packs: [] },                                                       // everything missing
    { id: 2, categ: 5, suppliers: [30], afs: true, en: "Pomegranate", packs: [{ id: 21, type: "carton", kg: 10, def: true, seq: 10 }] }, // complete
    { id: 3, categ: 51, suppliers: [30], afs: true, en: "Orange", packs: [{ id: 31, type: "carton", kg: 8, def: true, seq: 10 }] },      // a child category; the temporary 8 kg
    { id: 4, categ: 1, suppliers: [30], afs: true, en: "Avocado", packs: [{ id: 41, type: "carton", kg: 4, def: true, seq: 0 }] },       // Goods is not a produce category
    { id: 5, categ: 5, suppliers: [30], afs: true, en: "Pomegranate L", packs: [{ id: 51, type: "carton", kg: 0, def: true, seq: 0 }] },  // «كرتون» بلا وزن (the pomegranates of the tenant)
    { id: 6, categ: 6, suppliers: [30], afs: true, en: "Watermelon", packs: [{ id: 61, type: "piece", kg: 0, def: true, seq: 10 }, { id: 62, type: "carton", kg: 8, def: false, seq: 20 }] }, // by the piece: no weight needed; the 8 kg carton is not the default
    { id: 7, categ: 6, suppliers: [], afs: false, en: " ", packs: [{ id: 72, type: "bag", kg: 0, def: false, seq: 20 }, { id: 71, type: "bag", kg: 8, def: false, seq: 10 }] }, // no default: the first by sequence (a bag of 8 is not «temporary»)
    { id: 8, categ: 5, suppliers: [30], afs: true, en: "Tomato", packs: [{ id: 81, type: "foam", kg: 0, def: true, seq: 10 }] },
    { id: 9, categ: 5, suppliers: [30], afs: true, en: "Banana", packs: [{ id: 91, type: "carton", kg: 8, def: false, seq: 10 }, { id: 92, type: "carton", kg: 13, def: true, seq: 20 }] }, // the default is the second by sequence
  ];
  const PY = `
import json, sys
code = sys.argv[1]; pack_code = sys.argv[2]; cats = json.loads(sys.argv[3]); products = json.loads(sys.argv[4])
class Cat:
    def __init__(s, d): s.id = d['id']; s.name = d['name']; s.parent_id = False
class RS(list):
    def sorted(s, key=None): return RS(sorted(s, key=key))
    def filtered(s, f): return RS([x for x in s if f(x)])
    def __getitem__(s, i):
        r = list.__getitem__(s, i)
        return RS(r) if isinstance(i, slice) else r
    def __or__(s, o): return s if len(s) else o
    def __getattr__(s, n):
        if len(s) == 1: return getattr(list.__getitem__(s, 0), n)
        raise AttributeError(n)
class Pack:
    def __init__(s, d): s.id = d['id']; s.x_type = d['type']; s.x_approx_weight_kg = d['kg']; s.x_is_default = d['def']; s.x_sequence = d['seq']
class Prod:
    def __init__(s, d, cmap):
        s.id = d['id']; s.categ_id = cmap.get(d['categ']) or False; s.x_supplier_ids = d['suppliers']; s.x_is_active_for_sale = d['afs']; s.x_name_en = d['en']
        s.x_packaging_ids = RS([Pack(k) for k in d['packs']]); s.out = {}
    def __setitem__(s, k, v): s.out[k] = v
cmap = {c['id']: Cat(c) for c in cats}
for c in cats:
    if c['parent']: cmap[c['id']].parent_id = cmap[c['parent']]
res = []
for d in products:
    p = Prod(d, cmap)
    exec(code, {'self': [p]}); exec(pack_code, {'self': [p]})
    pk = p.out['x_pack_id']
    res.append({'missing': p.out['x_missing'], 'pack': (pk[0].id if len(pk) else False)})
print(json.dumps(res, ensure_ascii=False))`;
  const out = JSON.parse(execFileSync("python3", ["-c", PY, UI.MISSING_CODE, UI.PACK_CODE, JSON.stringify(cats), JSON.stringify(products)], { encoding: "utf8" }));
  const catMap = new Map(cats.map((c) => [c.id, { id: c.id, name: c.name, parent_id: c.parent }]));
  const L = UI.MISSING_LABEL;
  // the worker's words → the list's short labels (the same items, in the same order)
  const short = (m: string) => m.startsWith("الفئة") ? L.category : m === "المورد" ? L.supplier : m === "«نشط للبيع»" ? L.forSale : m.startsWith("التعبئة") ? L.noPack : m.startsWith("وزن الكرتون") ? L.tempWeight : m.startsWith("وزن التعبئة") ? L.noWeight : m === "الاسم بالإنجليزي" ? L.english : `?${m}`;
  const worker = products.map((p) => {
    const packs = [...p.packs].sort((a, b) => a.seq - b.seq || a.id - b.id).map((k) => ({ x_product_tmpl_id: p.id, x_type: k.type, x_approx_weight_kg: k.kg, x_is_default: k.def, id: k.id }));
    const m = PSU.missingOnProduct({ id: p.id, name: "x", default_code: "UTAK-X", categ_id: p.categ, x_supplier_ids: p.suppliers, x_is_active_for_sale: p.afs, x_name_en: p.en, create_date: "" } as any, packs as any, catMap as any);
    return { missing: m.map(short).join("، ") || false, pack: ((packs.find((k) => k.x_is_default) ?? packs[0]) as any)?.id ?? false };
  });
  assert("the Python of «الناقص» and of «التعبئة الافتراضية» gives, product by product, what the worker's missingOnProduct gives", JSON.stringify(out) === JSON.stringify(worker), JSON.stringify({ out, worker }));
  assert("…everything missing on an empty card", out[0].missing === [L.category, L.supplier, L.forSale, L.noPack, L.english].join("، "));
  assert("…a complete product: nothing (the filter «ناقص» leaves it out)", out[1].missing === false && out[1].pack === 21);
  assert("…a child of «فواكه» is a produce category; the temporary 8 kg carton is missing its weight", out[2].missing === L.tempWeight);
  assert("…«Goods» is not a produce category", out[3].missing === L.category);
  assert("…a carton, a bag or a foam box with no weight (the tenant's pomegranates): «وزن التعبئة» — the alert's rule gained it too", out[4].missing === L.noWeight && out[7].missing === L.noWeight && PSU.WEIGHED_TYPES.join() === "carton,bag,foam");
  assert("…sold by the piece: no weight asked; the 8 kg carton that is not the default does not count", out[5].missing === false && out[5].pack === 61);
  assert("…no default packaging: the first by sequence", out[6].pack === 71 && out[6].missing === [L.supplier, L.forSale, L.english].join("، "));
  assert("…the default packaging is the one marked default, wherever it stands (13 kg, complete) — not the first (the 8 kg carton)", out[8].pack === 92 && out[8].missing === false);
  const list = String(UI.productsList({ packagings: 1042 }, true)), search = String(UI.productsSearch([5, 6, 7]));
  assert("the list is edited in place: «نشط للبيع», the category, the supplier, the packaging's type and weight; «الناقص» read-only", /<list[^>]*editable="bottom"/.test(list) && ["categ_id", "x_is_active_for_sale", "x_supplier_ids", "x_pack_type", "x_pack_weight"].every((f) => new RegExp(`<field name="${f}"(?![^>]*readonly="1")`).test(list)) && /<field name="x_missing" string="الناقص" readonly="1"\/>/.test(list));
  assert("the filter «ناقص» reads the same field", /<filter name="f_missing" string="ناقص" domain="\[\('x_missing', '!=', False\)\]"\/>/.test(search));
  assert("the list is the produce: the three categories, a product without a category, or a UTAK-FRT / VEG / LEAF reference — never a service", UI.productsDomain([5, 6, 7]) === "[('type', '!=', 'service'), '|', '|', '|', '|', ('categ_id', 'child_of', [5, 6, 7]), ('categ_id', '=', False), ('default_code', '=like', 'UTAK-FRT-%'), ('default_code', '=like', 'UTAK-VEG-%'), ('default_code', '=like', 'UTAK-LEAF-%')]");
}

console.log("\n[و] the screens' own Python: «📊 اليوم» opens today's record, else the last day with its note, and never creates one");
{
  const PY = `
import json, sys, datetime
import datetime as _dt
codes = json.loads(sys.argv[1]); cases = json.loads(sys.argv[2])
class UserError(Exception): pass
class Rec:
    def __init__(s, d): s.__dict__.update(d); s.x_date = datetime.date.fromisoformat(d['x_date']); s.written = None
    def __bool__(s): return True
    def write(s, vals): s.written = vals
class RS(list):
    def write(s, vals):
        for r in s: r.write(vals)
    @property
    def id(s): return list.__getitem__(s, 0).id
    @property
    def x_date(s): return list.__getitem__(s, 0).x_date
class Model:
    def __init__(s, rows): s.rows = rows; s.created = 0
    def create(s, vals): s.created += 1
    def search(s, domain, order='id', limit=None):
        ops = {'=': lambda a, b: a == b, '<': lambda a, b: a < b, '>': lambda a, b: a > b, '<=': lambda a, b: a <= b, '>=': lambda a, b: a >= b, '!=': lambda a, b: a != b}
        def ok(r, dom):
            st = []
            for t in reversed(dom):
                if t == '|': a = st.pop(); b = st.pop(); st.append(a or b)
                else:
                    try: st.append(ops[t[1]](getattr(r, t[0]), t[2]))
                    except TypeError: st.append(False)   # an empty field against a date: no match, as in Odoo
            return all(st)
        out = [r for r in s.rows if ok(r, domain)]
        for part in reversed([p.strip() for p in order.split(',')]):
            f = part.split()[0]; out.sort(key=lambda r: getattr(r, f), reverse=part.endswith('desc'))
        return RS(out[:limit] if limit else out)
class Env:
    def __init__(s, models, ctx): s.models = models; s.context = ctx
    def __getitem__(s, n): return s.models[n]
res = []
for c in cases:
    class FixedDT(datetime.datetime):
        @classmethod
        def now(cls): return datetime.datetime.fromisoformat(c['utc'])
    class DT: datetime = FixedDT; timedelta = _dt.timedelta; date = _dt.date; time = _dt.time
    days = Model([Rec(d) for d in c.get('days', [])]); costs = Model([Rec(dict(x_date='2000-01-01', **k)) for k in c.get('costs', [])]); cfgs = Model([Rec(dict(x_date='2000-01-01', **k)) for k in c.get('configs', [])])
    for k in cfgs.rows:
        k.x_active_from = datetime.date.fromisoformat(k.x_active_from); k.x_active_to = datetime.date.fromisoformat(k.x_active_to) if k.x_active_to else False
    env = Env({'x_price_day': days, 'x_operating_cost': costs, 'x_pricing_config': cfgs}, c.get('context', {}))
    g = {'env': env, 'datetime': DT, 'UserError': UserError, 'record': next((r for r in days.rows if r.id == c.get('record')), None)}
    try:
        exec(codes[c['code']], g)
        a = g['action']
        res.append({'res_id': a.get('res_id'), 'views': a.get('views'), 'target': a.get('target'), 'context': a.get('context'), 'name': a.get('name'), 'model': a.get('res_model'), 'domain': str(a.get('domain')), 'created': days.created, 'attached': [k.id for k in costs.rows if k.written]})
    except UserError as e:
        res.append({'error': str(e), 'created': days.created})
print(json.dumps(res, ensure_ascii=False))`;
  const V = { day: 2834, sources: 2874, confirm: 2873, settings: 2855, purchaseList: 2875, purchaseSearch: 2876, marketList: 2877, marketSearch: 2878 };
  const codes = { open: UI.openDayCode(V), openSources: UI.openDayCode({ ...V, forceSources: true }), prev: UI.stepDayCode(V, "prev"), next: UI.stepDayCode(V, "next"), confirm: UI.confirmCode(V), settings: UI.settingsCode(V), purchase: UI.sourcesListCode(V, "purchase"), market: UI.sourcesListCode(V, "market") };
  const days = [
    { id: 48, x_date: "2026-09-29", x_utak_simulation: false, x_state: "published" }, { id: 49, x_date: "2026-09-30", x_utak_simulation: true, x_state: "draft" },
    { id: 50, x_date: "2026-10-01", x_utak_simulation: false, x_state: "missed" }, { id: 51, x_date: "2026-10-01", x_utak_simulation: true, x_state: "draft" },
  ];
  const cases = [
    { code: "open", utc: "2026-10-01T10:00:00", days },                                             // 13:00 Riyadh: today's record
    { code: "open", utc: "2026-10-01T22:30:00", days },                                             // 01:30 Riyadh of 10-02: no record yet
    { code: "open", utc: "2026-10-01T10:00:00", days: [] },
    { code: "open", utc: "2026-10-01T10:00:00", days, context: { utak_view: "sources" } },
    { code: "openSources", utc: "2026-10-01T10:00:00", days },
    { code: "prev", utc: "2026-10-01T10:00:00", days, record: 50 },
    { code: "next", utc: "2026-10-01T10:00:00", days, record: 48 },
    { code: "next", utc: "2026-10-01T10:00:00", days, record: 50 },
    { code: "prev", utc: "2026-10-01T10:00:00", days, record: 50, context: { utak_view: "sources" } },
    { code: "confirm", utc: "2026-10-01T10:00:00", days, record: 50 },
    { code: "confirm", utc: "2026-10-01T10:00:00", days, record: 48 },
    { code: "settings", utc: "2026-10-01T10:00:00", days, configs: [{ id: 1, x_is_active: true, x_active_from: "2026-08-29", x_active_to: false }], costs: [{ id: 2, x_config_id: 1 }, { id: 12, x_config_id: false }] },
    { code: "purchase", utc: "2026-10-01T10:00:00", days, record: 50 },
    { code: "market", utc: "2026-10-01T10:00:00", days, record: 50 },
  ];
  const r = JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify(codes), JSON.stringify(cases)], { encoding: "utf8" }));
  assert("today's real record (#50, never the simulation's #51) on the one screen, no note", r[0].res_id === 50 && JSON.stringify(r[0].views) === "[[2834, \"form\"]]".replace(/ /g, "") && r[0].context.utak_no_today === false && r[0].target === "current" && r[0].model === "x_price_day", JSON.stringify(r[0]));
  assert("no record for today (01:30 of the next day): the last real day (#50), with the note «لا يوجد سجل أسعار لليوم»", r[1].res_id === 50 && r[1].context.utak_no_today === true);
  assert("…and no record is ever created by opening the screen", r.every((x: any) => x.created === 0) && !/\.create\(/.test(Object.values(codes).join("\n")));
  assert("no day at all: a plain message, not an empty screen", /لا يوجد سجل أسعار بعد/.test(r[2].error ?? ""));
  assert("«📥 عروض المصادر» opens the same day on its own screen (the menu's action, and «اليوم» pressed inside it)", r[3].views[0][0] === 2874 && r[4].views[0][0] === 2874 && r[4].res_id === 50 && r[3].context.utak_view === "sources" && r[4].name === UI.MENU.sources);
  assert("the day before / after skip the simulation's days (#50 ← #48 → #50), and stay on the screen they were pressed on", r[5].res_id === 48 && r[6].res_id === 50 && r[5].views[0][0] === 2834 && r[8].res_id === 48 && r[8].views[0][0] === 2874 && r[5].context.utak_no_today === false);
  assert("…no day after the last one: «لا يوم بعد …»", /لا يوم بعد 2026-10-01/.test(r[7].error ?? ""));
  assert("«نشر المعتمد الآن» on a missed day: the confirmation, as a dialog on that record", r[9].res_id === 50 && r[9].target === "new" && r[9].views[0][0] === 2873);
  assert("…on a published day: refused", /لا يُنشر إلا سجل «مسودة» أو «فات الموعد»/.test(r[10].error ?? ""));
  assert("«⚙️ الإعدادات» opens the active record, and a cost line created elsewhere is attached to it first", r[11].res_id === 1 && r[11].views[0][0] === 2855 && JSON.stringify(r[11].attached) === "[12]");
  assert("«فتح مجمّعة بالمصدر»: that day's rows, grouped by source, the simulation filtered out by default", r[12].model === "x_daily_price" && /x_date/.test(r[12].domain) && r[12].context.search_default_g_source === 1 && r[12].context.search_default_f_real === 1 && r[12].context.default_x_date === "2026-10-01" && r[13].model === "x_price_offer" && r[13].context.search_default_f_real === 1);
  // the three small computes
  const PY2 = `
import json, sys, datetime
import datetime as _dt
codes = json.loads(sys.argv[1])
class L:
    def __init__(s, n, st, ex, sale): s.x_name = n; s.x_status = st; s.x_excluded = ex; s.x_sale_price = sale
class RS(list):
    def filtered(s, f): return RS([x for x in s if f(x)])
class D:
    def __init__(s, date, lines): s.x_date = date; s.x_line_ids = RS(lines); s.out = {}
    def __setitem__(s, k, v): s.out[k] = v
class FixedDT(datetime.datetime):
    @classmethod
    def now(cls): return datetime.datetime(2026, 10, 1, 22, 30)
class DT: datetime = FixedDT; timedelta = _dt.timedelta
lines = [L('رمان كبير', 'manual', False, 31.5), L('رمان وسط', 'auto', False, 24), L('موز', 'exception', True, 0), L('خيار', 'manual', True, 20), L('بصل', 'unpublished', True, 0)]
a = D(datetime.date(2026, 10, 2), lines); b = D(datetime.date(2026, 10, 1), []); c = D(False, [])
for d in (a, b, c):
    for code in codes: exec(code, {'self': [d], 'datetime': DT})
print(json.dumps([a.out, b.out, c.out], ensure_ascii=False))`;
  const k = JSON.parse(execFileSync("python3", ["-c", PY2, JSON.stringify([UI.IS_TODAY_CODE, UI.N_PUBLISHABLE_CODE, UI.PUBLISH_NAMES_CODE])], { encoding: "utf8" }));
  assert("«سجل اليوم» is the Riyadh day (22:30 UTC of 10-01 is 10-02)", k[0].x_is_today === true && k[1].x_is_today === false && k[2].x_is_today === false);
  assert("«الأصناف التي ستُنشر»: approved (automatically or by Baraa), not left out, with a price — 2 of the 5 — and their names with their prices", k[0].x_n_publishable === 2 && k[0].x_publish_names === "رمان كبير 31.50، رمان وسط 24.00" && k[1].x_n_publishable === 0 && k[1].x_publish_names === "—", JSON.stringify(k));
}

// ================================================================ [س]
console.log("\n[س] schema");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));
{
  const f = FIX[FIX.length - 1];
  assert("the § 48 fixture (read-only fields_get) names x_min_profit_sar, the preview, x_manual_for and the «—» texts", f.x_pricing_config.includes("x_min_profit_sar") && ["x_preview_sale", "x_preview_profit", "x_manual_for", ...VW.DISPLAY_FIELDS].every((n: string) => f.x_price_day_line.includes(n)));
  assert("…and still x_min_margin_pct: hidden, not deleted", f.x_pricing_config.includes("x_min_margin_pct"));
  assert("…and the fields of «💲 التسعير»: x_n_recipients, x_outlier_ratio, the cost lines, «الناقص»", f.x_price_day.includes("x_n_recipients") && f.x_price_day.includes("x_src_purchase_ids") && f.x_pricing_config.includes("x_outlier_ratio") && f.x_pricing_config.includes("x_cost_line_ids") && f.x_operating_cost.includes("x_config_id") && ["x_missing", "x_pack_id", "x_pack_weight"].every((n) => f["product.template"].includes(n)));
}

done();
