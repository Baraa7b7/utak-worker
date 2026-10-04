// § 47 (2026-10-01) — the purchase price is entered net of VAT, and the profitable price.
//
//   [أ] every purchase price is net as written, whoever the source: the board and the profit never
//       divide it by 1.15, a registered and an unregistered source give the same numbers, «the
//       lowest offer» compares the numbers as they are; the supplier's bill adds 15 % on top for a
//       supplier with a VAT number (22 → 25.30) and nothing for one without (22); the supplier
//       dues, the purchase order document, the sale-price fallback and the free texts that ask for
//       prices follow the same rule.
//   [ب] «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح» (rounded up to 0.5), «الهامش الأدنى ٪»,
//       the four cases of the engine, the exception's message and its choices («اعتمد بالسعر
//       المربح»: a reply button among three, a list row among four), the decision from WhatsApp and
//       from Odoo, the publication.
//   [ج] the numbers of 2026-10-01 (share 1.99, margin 5 %), and no new-product alert for a product
//       whose flag is off.
//
// § 48 (2026-10-01) — re-based on the fixed minimum profit a carton: the suggested price is (full cost
// + «الربح الأدنى للكرتون» 2) × 1.15 rounded up to 0.5, no longer full cost × 1.05 × 1.15 (with the kit's
// share of 2.00: tomato 29.00, cucumber 36.00, potato 26.50; on 10-01: 31.50 / 24.00 / 19.50), and on
// the fallback of § 48 ب (a purchase price today without a fallback is «missing», never an older
// day's price). The rule itself — the market price once it reaches the suggested price — is § 47's.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s47.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx as harnessCtx, graph, heldFor, inbound, odooLog, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, DAY, DRIVER, FIX, assert, cost, dayOf, done, dp, fresh, lineFor, market, ownerTexts, rejected } from "./s46-kit.mts";

const EN = await import("../src/pricing-engine.ts");
const PB = await import("../src/pricing-board.ts");
const PR = await import("../src/prices.ts");
const OC = await import("../src/operating-cost.ts");
const PA = await import("../src/purchase-accounting.ts");
const SP = await import("../src/supplier-pay.ts");
const PS = await import("../src/price-sources.ts");
const SUP = await import("../src/suppliers.ts");
const PO = await import("../src/purchase-order.ts");
const OD = await import("../src/odoo.ts");
const PSU = await import("../src/product-setup.ts");
const worker = (await import("../src/index.ts")).default;

const offer = (o: Record<string, unknown>) => ({ kind: "market", price: 0, outlier: false, partnerId: 1, sourceName: "م", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o }) as any;
const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };
const VAT = { ratePct: 15 };
const FLOOR = { opShare: 2, minProfit: 2 };
/** Omar's «شراء» / «سوق» of the day (an x_price_offer row of the employee's Work Contact). */
const omar = (product: number, packaging: number, o: { purchase?: number; market?: number; outlier?: boolean }, day = DAY) =>
  seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: DRIVER, x_date: day, x_purchase_price: o.purchase ?? 0, x_market_price: o.market ?? 0, x_purchase_outlier: false, x_market_outlier: o.outlier === true, x_status: o.outlier ? "outlier" : "valid", x_utak_simulation: false });
const excMsgs = () => sentTo(OWNER).filter((b: any) => b?.type === "interactive" && /استثناء في أسعار اليوم/.test(String(b.interactive?.body?.text)));
const msgOf = (name: string) => excMsgs().find((b: any) => String(b.interactive.body.text).includes(name)) as any;
const choiceIds = (b: any): string[] => b?.interactive?.type === "list"
  ? (b.interactive.action.sections ?? []).flatMap((s: any) => s.rows.map((r: any) => r.id))
  : (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);

// ================================================================ [أ] the purchase price is net
console.log("\n[أ] the board: the purchase price as written, registered or not (nothing ÷ 1.15)");
{
  const b = PB.boardLine({ purchase: 22, sale: 0, wastePct: 5, vatRatePct: 15, opShare: 1.99, minProfit: 2 });
  assert("net purchase = the number as it is (22), not 22 ÷ 1.15 = 19.13", b.x_net_purchase === 22 && b.x_waste_cost === 1.1 && b.x_full_cost === 25.09, JSON.stringify(b));
  assert("boardLine has no «registered» input any more: the same call is every source's", !("registered" in ({ purchase: 22, sale: 0, wastePct: 5, vatRatePct: 15, opShare: 1.99 } as PB.BoardLineInput)));
  for (const registered of [true, false]) {
    const env = fresh(`${DAY} 03:00`); cost(500);
    table("res.partner").get(AHMED)!.x_vat_registered = registered;
    dp(1, 11, 20); market(1, 11, 34.5);
    await quiet(() => PR.refreshPriceDay(env));
    const t = lineFor(1);
    assert(`the engine's line, Ahmed «مسجل في الضريبة» ${registered ? "ticked" : "unticked"}: net purchase 20, full cost 23, unit profit 9, real profit 7`,
      t.x_cost_price === 20 && t.x_net_purchase === 20 && t.x_full_cost === 23 && t.x_unit_profit === 9 && t.x_real_profit === 7 && t.x_status === "auto", JSON.stringify(t));
  }
  assert("the profit rule takes no registration: sale ÷ 1.15 − purchase − waste", EN.vatProfit.length === 4 && Math.round(EN.vatProfit(34.5, 20, 5, 15) * 100) / 100 === 9);
}

console.log("\n[أ] the lowest offer: the numbers as they are");
{
  // before § 47 a registered source's 23 counted 20 net against an unregistered 22: now 22 < 23 as written
  const [l] = EN.computePricing([ITEM], [
    offer({ kind: "purchase", price: 23, partnerId: AHMED, sourceName: "أحمد حسان", model: "dp", rowId: 5 }),
    offer({ kind: "purchase", price: 22, partnerId: DRIVER, sourceName: "عمر", rowId: 3 }),
    offer({ kind: "market", price: 34.5, partnerId: DRIVER, rowId: 3 }),
  ], 5, VAT, FLOOR);
  assert("Omar's «شراء» 22 beats Ahmed's 23 (no source's price is reduced by a VAT it «recovers»)", l.purchase === 22 && l.purchaseOffer?.partnerId === DRIVER, JSON.stringify(l));
  const env = fresh(`${DAY} 03:00`); cost(500);
  dp(1, 11, 23); omar(1, 11, { purchase: 22, market: 34.5 });
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1);
  assert("…on the day: the line's purchase 22 from Omar, net purchase 22", t.x_cost_price === 22 && t.x_supplier_id === DRIVER && t.x_net_purchase === 22, JSON.stringify(t));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the purchase order and the supplier's bill: 22 → 25.30 registered, 22 not");
{
  const reg = PA.computeNetTotals([22], 15), un = PA.computeNetTotals([22], null);
  assert("a net 22, a supplier with a VAT number: 22 + 3.30 = 25.30", reg.subtotal === 22 && reg.tax === 3.3 && reg.total === 25.3, JSON.stringify(reg));
  assert("a net 22, a supplier without one: 22, no tax", un.subtotal === 22 && un.tax === 0 && un.total === 22, JSON.stringify(un));
  const small = PA.computeNetTotals([0.1, 0.1, 0.1], 15);
  assert("the tax is rounded on each line then summed, as Odoo does (round_per_line): 3 × 0.10 → 0.02 each = 0.06, not 0.30 × 15 % = 0.05", small.tax === 0.06 && small.subtotal === 0.3 && small.total === 0.36, JSON.stringify(small));
  const item = { product_id: 108, product_name: "رمان كبير", packaging_id: 44, packaging_name: "كرتون", total_quantity: 1, order_ids: [1], unit_price: 22 } as any;
  const withTax = PA.buildPurchaseOrderLineCommands([item], 900, [21]), noTax = PA.buildPurchaseOrderLineCommands([item], 900, []);
  assert("the PO line: price_unit is the net 22 as entered, the tax pinned on the line (or none)", withTax[0][2].price_unit === 22 && JSON.stringify(withTax[0][2].tax_ids) === "[[6,0,[21]]]" && noTax[0][2].price_unit === 22 && JSON.stringify(noTax[0][2].tax_ids) === "[[6,0,[]]]");
  const g = (lines: any[], tax: any) => PA.evaluateVendorBillGuard({ moveState: "posted", moveType: "in_invoice", lines, tax });
  const added = [
    { account_code: "400001", account_type: "expense_direct_cost", debit: 22, credit: 0 },
    { account_code: "104041", account_type: "asset_current", debit: 3.3, credit: 0, is_tax: true },
    { account_code: "201002", account_type: "liability_payable", debit: 0, credit: 25.3 },
  ];
  const split = [
    { account_code: "400001", account_type: "expense_direct_cost", debit: 19.13, credit: 0 },
    { account_code: "104041", account_type: "asset_current", debit: 2.87, credit: 0, is_tax: true },
    { account_code: "201002", account_type: "liability_payable", debit: 0, credit: 22 },
  ];
  assert("the guard accepts the bill that ADDS the tax (22 + 3.30 = 25.30)", g(added, { expectTax: true, expectedTax: reg.tax, amountTax: 3.3, expectedTotal: reg.total, amountTotal: 25.3 }).ok);
  assert("…and refuses one that SPLITS the net price (19.13 + 2.87 = 22)", !g(split, { expectTax: true, expectedTax: reg.tax, amountTax: 2.87, expectedTotal: reg.total, amountTotal: 22 }).ok);
  assert("…and an unregistered supplier's bill is the price itself (22), a tax line on it refused", g([added[0], { ...added[2], credit: 22 }], { expectTax: false, expectedTax: 0, amountTax: 0, expectedTotal: 22, amountTotal: 22 }).ok
    && !g(added, { expectTax: false, expectedTax: 0, amountTax: 3.3, expectedTotal: 22, amountTotal: 25.3 }).ok);
  const totals = PO.renderPurchaseOrderTotalsHTML(22, 25.3, "ar", 3.3), plain = PO.renderPurchaseOrderTotalsHTML(22, 22, "ar", 0);
  assert("the purchase order document: the VAT row between the subtotal and the total when there is one, none otherwise", /ضريبة القيمة المضافة/.test(totals) && /3[.٫]30|٣[.٫]٣٠/.test(totals) && !/ضريبة القيمة المضافة/.test(plain), totals.slice(0, 300));
}

console.log("\n[أ] the supplier dues: the price is net, a supplier with a VAT number is owed 15 % on top");
{
  const it = { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 10, price_supplier_id: AHMED };
  const price = { id: 9, x_supplier_id: [AHMED, "أحمد"] as [number, string], x_product_tmpl_id: [1, "طماطم"] as [number, string], x_packaging_id: [11, "كرتون"] as [number, string], x_date: DAY, x_price_sar: 22, x_extraction_status: "extracted" };
  const plain = SP.planDues({ x_date: DAY, listSupplierId: AHMED }, [it], [price]);
  assert("no VAT number: 10 × 22 = 220.00, as before", plain.dues[0].amountH === 22000 && plain.dues[0].lines[0].vatH === 0 && plain.dues[0].lines[0].unitPrice === 22, JSON.stringify(plain.dues[0]));
  const taxed = SP.planDues({ x_date: DAY, listSupplierId: AHMED }, [it], [price], undefined, (sid) => (sid === AHMED ? 15 : null));
  assert("a VAT number: 220 + 33 = 253.00 (the line keeps the net price 22)", taxed.dues[0].amountH === 25300 && taxed.dues[0].lines[0].vatH === 3300 && taxed.dues[0].lines[0].subtotalH === 25300 && taxed.dues[0].lines[0].unitPrice === 22, JSON.stringify(taxed.dues[0]));
  assert("the VAT of a line is rounded on the line (0.35 × 3 = 1.05 → 0.16), as the bill does", SP.lineVatH(105, 15) === 16 && SP.lineVatH(2200, 15) === 330 && SP.lineVatH(2200, null) === 0);

  const env = fresh(`${DAY} 10:00`);
  dp(1, 11, 22);
  const listId = seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([it]), x_utak_simulation: false });
  await quiet(() => SP.syncSupplierDues(env, listId));
  const d1 = rows("x_supplier_due")[0] as any;
  assert("through Odoo, Ahmed without a VAT number on his card: the due 220", d1?.x_amount === 220 && rows("x_supplier_due_line")[0]?.x_subtotal === 220 && !rows("x_supplier_due_line")[0]?.x_note, JSON.stringify(d1));
  table("res.partner").get(AHMED)!.vat = "310123456700003";
  await quiet(() => SP.syncSupplierDues(env, listId));
  const d2 = rows("x_supplier_due")[0] as any, l2 = rows("x_supplier_due_line")[0] as any;
  assert("…his VAT number entered: the due follows (253), the line says why", rows("x_supplier_due").length === 1 && d2.x_amount === 253 && l2.x_subtotal === 253 && l2.x_unit_price === 22 && /ضريبة 15% \(33\.00 ر\.س\)/.test(String(l2.x_note)), JSON.stringify([d2, l2]));
  const env2 = fresh("2026-09-30 10:00");
  dp(1, 11, 22, "2026-09-30");
  table("res.partner").get(AHMED)!.vat = "310123456700003";
  const old = seed("x_purchase_list", { x_date: "2026-09-30", x_status: "done", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([it]), x_utak_simulation: false });
  await quiet(() => SP.syncSupplierDues(env2, old));
  assert("a list before the VAT cutoff (09-30): no VAT even with his number", (rows("x_supplier_due")[0] as any)?.x_amount === 220);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] a purchase price is never a sale price; the free texts that ask for prices say «بدون ضريبة»");
{
  const env = fresh(`${DAY} 10:00`);
  const row = (day: string, sale?: number) => seed("x_daily_price", { x_product_tmpl_id: 3, x_packaging_id: 31, x_supplier_id: AHMED, x_price_sar: 22, ...(sale ? { x_sale_price: sale } : {}), x_date: day, x_extraction_status: "extracted" });
  row(DAY);
  const none = await quiet(() => OD.getLatestSalePrice(env, 3, 31, DAY));
  assert("a supplier row with a purchase price alone (typed in Odoo): no sale price («missing»), never the net 22", none.price === 0 && none.source === "missing", JSON.stringify(none));
  row("2026-10-02", 28);
  row(DAY);                                                 // and one more purchase-only row today, newer than yesterday's
  const stale = await quiet(() => OD.getLatestSalePrice(env, 3, 31, DAY));
  assert("…and no older day's price takes its place (§ 48 ب): a purchase price today without a fallback is «missing», yesterday's 28 is not used", stale.price === 0 && stale.source === "missing", JSON.stringify(stale));
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: AHMED, x_price_sar: 20, x_sale_price: 28, x_date: "2026-10-02", x_extraction_status: "extracted" });
  seed("x_daily_price", { x_product_tmpl_id: 4, x_packaging_id: 41, x_supplier_id: AHMED, x_price_sar: 21, x_date: "2026-10-02", x_extraction_status: "extracted" });   // a newer row of that day with a purchase price alone
  const old = await quiet(() => OD.getLatestSalePrice(env, 4, 41, DAY));
  assert("…a product nobody priced today still takes its latest SALE price («stale», 28 of yesterday) — a newer purchase-only row of that day is skipped, as before", old.price === 28 && old.source === "stale" && old.price_date === "2026-10-02", JSON.stringify(old));
  row(DAY, 30.36);
  row(DAY);                                                 // a newer row of today, again with a purchase price alone
  const got = await quiet(() => OD.getLatestSalePrice(env, 3, 31, DAY));
  assert("…today's row the worker wrote (with its x_sale_price) is today's price, a newer purchase-only row beside it ignored", got.price === 30.36 && got.source === "today", JSON.stringify(got));
  // § 51 — «ولو معك سعر شراء اكتب «شراء» جنب رقمه…» was deleted from the ask of a source without a role; a «شراء» source's ask still says «بدون ضريبة»
  assert("the 02:30 ask of a «شراء» source: «…سعر الشراء لكل صنف، بدون ضريبة»; the ask of a source without a role no longer invites a purchase price",
    /سعر الشراء لكل صنف، بدون ضريبة/.test(PS.marketAskText("عمر المجهلي", "purchase")) && !/شراء/.test(PS.marketAskText("عمر المجهلي")), PS.marketAskText("عمر المجهلي"));
  assert("the supplier's «تعديل الأسعار» reply: «السعر بدون ضريبة»", /السعر بدون ضريبة/.test(SUP.SUPPLIER_EDIT_TEXT), SUP.SUPPLIER_EDIT_TEXT);
  assert("the 05:00 reminder as text: «الأسعار بدون ضريبة»", /الأسعار بدون ضريبة/.test(SUP.supplierNudgeText("6:00 صباحاً")) && /قبل الساعة 6:00 صباحاً/.test(SUP.supplierNudgeText("6:00 صباحاً")));
  const src = ["../src/prices.ts", "../src/price-sources.ts", "../src/suppliers.ts", "../src/pricing-board.ts", "../src/pricing-engine.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  // § 52 ج — the one «شامل الضريبة» in these files is the MARKET line («اكتب السعر زي ما ينباع في السوق (شامل الضريبة).»): a market
  // observation is the price it sells at, VAT inside. It never sits in a «شراء» source's ask.
  assert("no text of the price flow tells a source its purchase price is «شامل» the tax", !/(سعر|أسعار)[^"`\n]{0,40}شامل[ة]? (ال)?ضريب/.test(src.split(PS.MARKET_VAT_LINE).join(""))
    && !/شامل/.test(PS.marketAskText("أحمد", "purchase")) && !/شامل/.test(PS.marketUnreadText("purchase")) && !/شامل/.test(SUP.supplierNudgeText("6:00 صباحاً")) && !/شامل/.test(SUP.SUPPLIER_EDIT_TEXT));
}

// ================================================================ [ب] the profitable price
console.log("\n[ب] «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح»");
{
  const f = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 })!;
  assert("full cost = 20 + 1 + 2 = 23", f.netPurchase === 20 && f.waste === 1 && f.fullCost === 23, JSON.stringify(f));
  assert("the break-even = 23 × 1.15 = 26.45 (VAT-inclusive)", f.breakEven === 26.45);
  assert("the suggested price = (23 + 2) × 1.15 = 28.75 → up to 29.00", f.suggested === 29);
  assert("rounded UP to the nearest half riyal: 30.296 → 30.50, 23.01 → 23.50, 17.62 → 18.00", EN.ceilToStep(30.296) === 30.5 && EN.ceilToStep(23.01) === 23.5 && EN.ceilToStep(17.62) === 18);
  assert("…a price already on a step stays (23.00, 30.50), float noise does not push it up", EN.ceilToStep(23) === 23 && EN.ceilToStep(30.5) === 30.5 && EN.ceilToStep(23.0000004) === 23 && EN.SUGGESTED_STEP === 0.5);
  assert("halala rounding half up: 20.90 × 1.15 = 24.035 → 24.04", EN.priceFloor({ purchase: 18, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 })!.breakEven === 24.04);
  const m10 = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 3 })!;
  const m0 = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 0 })!;
  assert("the minimum profit is riyals on top of the full net cost: 3 → (23 + 3) × 1.15 = 29.90 → 30.00; 0 → 26.45 → 26.50", m10.suggested === 30 && m0.suggested === 26.5 && m10.breakEven === 26.45);
  const pre = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: 2, vatRatePct: null, minProfit: 2 })!;
  assert("before the VAT cutoff nothing is multiplied by 1.15: break-even 23, suggested 23 + 2 = 25.00", pre.breakEven === 23 && pre.suggested === 25);
  const noShare = EN.priceFloor({ purchase: 20, wastePct: 5, opShare: null, vatRatePct: 15, minProfit: 2 })!;
  assert("the carton share unreadable: no break-even and no suggested price (never from a guessed cost)", noShare.breakEven === null && noShare.suggested === null && noShare.fullCost === 21);
  assert("no purchase price: nothing", EN.priceFloor({ purchase: null, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 }) === null && EN.priceFloor({ purchase: 0, wastePct: 5, opShare: 2, vatRatePct: 15, minProfit: 2 }) === null);
  const b = PB.boardLine({ purchase: 20, sale: 28, wastePct: 5, vatRatePct: 15, opShare: 2, minProfit: 2 });
  assert("the board's line carries the same two numbers (26.45, 29.00)", b.x_break_even === 26.45 && b.x_suggested_price === 29 && (PB.BOARD_LINE_FIELDS as readonly string[]).includes("x_break_even") && (PB.BOARD_LINE_FIELDS as readonly string[]).includes("x_suggested_price"));
  const none = PB.boardLine({ purchase: null, sale: 28, wastePct: 5, vatRatePct: 15, opShare: 2, minProfit: 2 });
  assert("…0 on a line without a purchase price", none.x_break_even === 0 && none.x_suggested_price === 0);
}

console.log("\n[ب] «الربح الأدنى للكرتون» in the settings (default 2; § 48 أ — it took the place of «الهامش الأدنى ٪»)");
{
  const env = fresh(`${DAY} 03:00`);
  assert("readPricingSettings: 2 on the record", (await quiet(() => OC.readPricingSettings(env, DAY)))?.minProfit === 2);
  table("x_pricing_config").get(1)!.x_min_profit_sar = 3.5;
  assert("…Baraa's 3.5", (await quiet(() => OC.readPricingSettings(env, DAY)))?.minProfit === 3.5);
  table("x_pricing_config").get(1)!.x_min_profit_sar = 0;
  assert("…his 0 is 0 (the break-even, rounded up)", (await quiet(() => OC.readPricingSettings(env, DAY)))?.minProfit === 0);
  delete (table("x_pricing_config").get(1) as any).x_min_profit_sar;
  assert("…a record without the value: the default 2", (await quiet(() => OC.readPricingSettings(env, DAY)))?.minProfit === 2 && EN.DEFAULT_MIN_PROFIT_SAR === 2);
  const env2 = fresh(`${DAY} 03:00`); cost(500);
  dp(1, 11, 20); market(1, 11, 29);
  await quiet(() => PR.refreshPriceDay(env2));
  assert("at 2 riyals: tomato (suggested 29.00, market 29) is automatic", lineFor(1).x_status === "auto" && lineFor(1).x_suggested_price === 29);
  table("x_pricing_config").get(1)!.x_min_profit_sar = 3;
  const r = await quiet(() => PR.refreshPriceDay(env2));
  assert("Baraa raises it to 3: the next run recomputes (suggested 30.00) and the same line is an exception", r.action === "refreshed" && lineFor(1).x_suggested_price === 30 && lineFor(1).x_status === "exception" && lineFor(1).x_reason === "سعر السوق 29 أقل من السعر المربح 30", JSON.stringify(lineFor(1)));
  const w = await quiet(() => PR.rewriteBoard(env2, dayOf().id));
  assert("…and the board rewritten from the stored line («🔄» after a decision) keeps the same 30.00 (the settings' amount, not the default)", w.updated === 0 && lineFor(1).x_suggested_price === 30 && lineFor(1).x_break_even === 26.45, JSON.stringify(w));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the four cases of the engine (the rule, pure)");
{
  const run = (offers: any[], floor: any = FLOOR) => EN.computePricing([ITEM], offers, 5, VAT, floor)[0];
  const p20 = offer({ kind: "purchase", price: 20, model: "dp", partnerId: AHMED });
  const c1 = run([p20, offer({ price: 29 })]);
  assert("(1) market 29 ≥ the suggested 29.00 → no exception, sale = the market price", c1.exceptions.length === 0 && c1.sale === 29 && c1.suggested === 29 && c1.breakEven === 26.45 && c1.fullCost === 23, JSON.stringify(c1));
  assert("…and the verdict: automatic at the market price", JSON.stringify(EN.lineVerdict(c1, null, 0)) === JSON.stringify({ status: "auto", sale: 29, excluded: false, reason: "" }));
  const c1b = run([p20, offer({ price: 40 })]);
  assert("…a market price well above it is published as it is (40, not the suggested 29)", c1b.exceptions.length === 0 && EN.lineVerdict(c1b, null, 0).sale === 40);
  const c2 = run([p20, offer({ price: 28.5 })]);
  assert("(2) market 28.50 < 29.00 → an exception «سعر السوق 28.50 أقل من السعر المربح 29»", c2.exceptions.join() === "below_profit" && c2.reason === "سعر السوق 28.50 أقل من السعر المربح 29" && EN.lineVerdict(c2, null, 0).status === "exception", JSON.stringify(c2));
  assert("…a market price above the break-even (26.45) but below the suggested price is still an exception (it was automatic before § 47)", c2.unitProfit !== null && c2.unitProfit > 0);
  const c3 = run([p20]);
  assert("(3) no market price, a purchase price → an exception that carries the suggested price", c3.exceptions.join() === "no_market" && c3.suggested === 29 && c3.sale === null, JSON.stringify(c3));
  const c4 = run([offer({ price: 28 })]);
  assert("(4) no purchase price → «لا سعر شراء», no suggested price, as before", c4.exceptions.join() === "no_purchase" && c4.suggested === null && c4.breakEven === null && c4.fullCost === null, JSON.stringify(c4));
  const out = run([p20, offer({ price: 30, outlier: true })]);
  assert("an outlier stays an exception even above the suggested price", out.exceptions.join() === "outlier");
  const noShare = run([p20, offer({ price: 24 })], { opShare: null, minProfit: 2 });
  assert("the carton share unreadable: the rule before § 47 (24 ÷ 1.15 − 21 = −0.13 → «ربح الوحدة ≤ 0»), no suggested price", noShare.exceptions.join() === "no_profit" && noShare.suggested === null, JSON.stringify(noShare));
  // the decisions
  assert("«اعتمد بالسعر المربح» → approved by hand at the suggested price", JSON.stringify(EN.lineVerdict(c3, "profit", 0)) === JSON.stringify({ status: "manual", sale: 29, excluded: false, reason: "براء: اعتمد بالسعر المربح" }));
  assert("…at the price he saw when he decided (stored), not a later one", EN.lineVerdict(c3, "profit", 27.5).sale === 27.5);
  assert("…without any suggested price (no purchase): the decision cannot apply — still an exception", EN.lineVerdict(c4, "profit", 0).status === "exception");
  assert("«اعتمد بسعر السوق» / «لا تنشر» / «عدّل» as before", EN.lineVerdict(c2, "market", 0).sale === 28.5 && EN.lineVerdict(c2, "skip", 0).status === "unpublished" && EN.lineVerdict(c2, "edit", 31).sale === 31);
  assert("the publication's check: a «profit» line carries its decided price, else the line's suggested price",
    EN.saleRule({ x_status: "manual", x_market_price: 0, x_manual_price: 28, x_decision: "profit", x_suggested_price: 29 }) === 28
    && EN.saleRule({ x_status: "manual", x_market_price: 0, x_manual_price: 0, x_decision: "profit", x_suggested_price: 28 }) === 28
    && EN.saleRule({ x_status: "manual", x_market_price: 27.5, x_manual_price: 0, x_decision: "market", x_suggested_price: 28 }) === 27.5
    && EN.saleRule({ x_status: "auto", x_market_price: 30, x_manual_price: 0 }) === 30 && EN.saleRule({ x_status: "exception", x_market_price: 30, x_manual_price: 0 }) === 0);
}

/** The day of the four cases: tomato (1) automatic, cucumber (2) below the suggested price, potato (3) no market, onion (4) no purchase. */
function fourCases(riyadh = `${DAY} 04:00`): any {
  const env = fresh(riyadh); cost(500);
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, 20); market(1, 11, 29);        // suggested 29.00 → automatic at 29
  dp(2, 21, 26); market(2, 21, 34);        // full 29.30 → suggested 36.00 > 34
  dp(3, 31, 18);                           // full 20.90 → suggested 26.50, no market
  market(4, 41, 30);                       // no purchase
  return env;
}

console.log("\n[ب] the engine on the day, and the exception's message and choices");
{
  const env = fourCases();
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1), c = lineFor(2), p = lineFor(3), o = lineFor(4);
  assert("(1) tomato: automatic at the market price 29 (🟢)", t.x_status === "auto" && t.x_sale_price === 29 && t.x_suggested_price === 29 && t.x_break_even === 26.45 && !t.x_excluded, JSON.stringify(t));
  assert("(2) cucumber: an exception, «سعر السوق 34 أقل من السعر المربح 36»", c.x_status === "exception" && c.x_sale_price === 0 && c.x_excluded === true && c.x_reason === "سعر السوق 34 أقل من السعر المربح 36" && c.x_suggested_price === 36 && c.x_break_even === 33.7, JSON.stringify(c));
  assert("(3) potato: an exception «لا سعر سوق» carrying the suggested 26.50 (and the break-even 24.04); ⚪ on the board", p.x_status === "exception" && p.x_reason === "لا سعر سوق" && p.x_suggested_price === 26.5 && p.x_break_even === 24.04 && p.x_board_status === "none" && p.x_full_cost === 20.9, JSON.stringify(p));
  assert("(4) onion: «لا سعر شراء», no suggested price", o.x_status === "exception" && o.x_reason === "لا سعر شراء" && o.x_suggested_price === 0 && o.x_break_even === 0, JSON.stringify(o));
  const n = await quiet(() => PR.notifyPriceExceptions(env));
  assert("04:00: one message per exception (3), none for the automatic line", n.action === "sent" && n.sent === 3 && excMsgs().length === 3 && !msgOf("طماطم"), JSON.stringify(n));
  const cm = msgOf("خيار"), pm = msgOf("بطاطس"), om = msgOf("بصل");
  assert("(2) the message names both numbers: the market price 34 and the suggested 36", /الشراء \(بدون ضريبة\): 26 · السوق: 34/.test(cm.interactive.body.text) && /السعر المربح المقترح: 36 · أقل سعر بيع بدون خسارة: 33\.70/.test(cm.interactive.body.text) && /قرارك قبل 06:00/.test(cm.interactive.body.text), cm.interactive.body.text);
  assert("(2) four choices → ONE list message under «القرار»: «اعتمد بالسعر المربح», «اعتمد بسعر السوق», «لا تنشر», «عدّل»",
    cm.interactive.type === "list" && cm.interactive.action.button === "القرار" && JSON.stringify(choiceIds(cm)) === JSON.stringify([`pexc_p_${c.id}`, `pexc_m_${c.id}`, `pexc_s_${c.id}`, `pexc_e_${c.id}`])
    && JSON.stringify(cm.interactive.action.sections[0].rows.map((r: any) => r.title)) === JSON.stringify(["اعتمد بالسعر المربح", "اعتمد بسعر السوق", "لا تنشر", "عدّل"]), JSON.stringify(cm.interactive.action));
  assert("…each price beside its row (36 ر.س, 34 ر.س)", cm.interactive.action.sections[0].rows[0].description === "36 ر.س" && cm.interactive.action.sections[0].rows[1].description === "34 ر.س");
  assert("(3) the message carries the suggested price; three reply buttons: «اعتمد بالسعر المربح» / «لا تنشر» / «عدّل»",
    /السعر المربح المقترح: 26\.50/.test(pm.interactive.body.text) && /السوق: —/.test(pm.interactive.body.text) && pm.interactive.type === "button"
    && JSON.stringify(choiceIds(pm)) === JSON.stringify([`pexc_p_${p.id}`, `pexc_s_${p.id}`, `pexc_e_${p.id}`]) && pm.interactive.action.buttons[0].reply.title === "اعتمد بالسعر المربح", JSON.stringify(pm.interactive));
  assert("(4) no purchase: the buttons as before («اعتمد بسعر السوق» / «لا تنشر» / «عدّل»), no suggested line", JSON.stringify(choiceIds(om)) === JSON.stringify([`pexc_m_${o.id}`, `pexc_s_${o.id}`, `pexc_e_${o.id}`]) && !/السعر المربح المقترح/.test(om.interactive.body.text), om.interactive.body.text);
  assert("the new title fits a reply button (≤ 20 characters) and a list row (≤ 24)", PR.PROFIT_BUTTON_TITLE === "اعتمد بالسعر المربح" && [...PR.PROFIT_BUTTON_TITLE].length <= 20);
  assert("no template is used for an exception (session messages only)", sentTo(OWNER).every((b: any) => b.type !== "template"));
  setRiyadh(`${DAY} 04:05`);
  assert("the next tick: no second message", (await quiet(() => PR.notifyPriceExceptions(env))).action === "notified_before" && excMsgs().length === 3);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fourCases(); closeOwnerWindow(env);
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const held = JSON.stringify(heldFor(env, OWNER));
  assert("his window closed: the exceptions are held with their choices (the list too), nothing sent, no template", excMsgs().length === 0 && sentTo(OWNER).every((b: any) => b.type !== "template") && /pexc_p_\d+/.test(held) && /"type":"list"/.test(held), held.slice(0, 300));
}
{
  const env = fresh(`${DAY} 04:00`); cost(500);
  dp(1, 11, 20); market(1, 11, 30); omar(1, 11, { market: 31, outlier: true });
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const t = lineFor(1);
  assert("an outlier above the suggested price: the buttons of before only (no «اعتمد بالسعر المربح»: the market price is the profitable one)", t.x_status === "exception" && !PR.offersProfitChoice(t) && JSON.stringify(choiceIds(msgOf("طماطم"))) === JSON.stringify([`pexc_m_${t.id}`, `pexc_s_${t.id}`, `pexc_e_${t.id}`]), JSON.stringify(choiceIds(msgOf("طماطم"))));
}

console.log("\n[ب] «اعتمد بالسعر المربح»: the tap, the lock, the board, the next run");
{
  const env = fourCases();
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const p = lineFor(3), o = lineFor(4);
  const r0 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_p_${o.id}`));
  assert("on a line without a purchase price: refused, nothing written", /لا سعر مربح مقترح لـ بصل/.test(r0) && !lineFor(4).x_decision, r0);
  const r1 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_p_${p.id}`));
  const p1 = lineFor(3);
  assert("potato (no market): approved by hand at the suggested 26.50", /بطاطس: يُنشر بالسعر المربح 26\.50 ر\.س/.test(r1) && p1.x_decision === "profit" && p1.x_manual_price === 26.5 && p1.x_manual_for === "profit" && p1.x_status === "manual" && p1.x_sale_price === 26.5 && p1.x_excluded === false && p1.x_reason === "براء: اعتمد بالسعر المربح" && !!p1.x_decided_at, JSON.stringify({ r1, p1 }));
  assert("…its card follows at once: sale 26.50, net sale 23.04, real profit 23.04 − 20.90 = 2.14 → 🟢 (and no preview: the line is approved)", p1.x_board_sale === 26.5 && p1.x_net_sale === 23.04 && p1.x_real_profit === 2.14 && p1.x_board_status === "green" && p1.x_preview_sale === 0 && p1.x_preview_profit === 0, JSON.stringify(p1));
  // the cucumber (market 34, above its break-even 33.70, below its suggested 36.00) is 🟢 on the board and still an exception
  assert("…and the header's counts: 🟢 3 (tomato, cucumber at the market price, potato) · ⚪ 1 (onion)", dayOf().x_n_green === 3 && dayOf().x_n_none === 1 && lineFor(2).x_board_status === "green" && lineFor(2).x_status === "exception", JSON.stringify(dayOf()));
  const r2 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_s_${p.id}`));
  assert("a second choice on the same line → «القرار مسجّل مسبقاً: اعتمد بالسعر المربح», unchanged", /القرار مسجّل مسبقاً على بطاطس: اعتمد بالسعر المربح/.test(r2) && lineFor(3).x_decision === "profit", r2);
  table("x_operating_cost").forEach((r: any) => { r.x_amount = 1000; });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const p2 = lineFor(3);
  assert("the cost rises (the suggested price becomes 29.00): his decided 26.50 stays the sale price", p2.x_status === "manual" && p2.x_sale_price === 26.5 && p2.x_suggested_price === 29 && p2.x_manual_price === 26.5, JSON.stringify(p2));
  // through /webhook: a list row's tap arrives as list_reply
  const c = lineFor(2);
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "list_reply", list_reply: { id: `pexc_p_${c.id}`, title: "اعتمد بالسعر المربح" } } })), env, harnessCtx));
  const c1 = lineFor(2);
  assert("through /webhook: the list row «اعتمد بالسعر المربح» → the line approved at its suggested price, and the confirmation", c1.x_decision === "profit" && c1.x_status === "manual" && c1.x_sale_price === c1.x_manual_price && c1.x_sale_price === c.x_suggested_price && ownerTexts().some((x) => /خيار: يُنشر بالسعر المربح/.test(x)), JSON.stringify({ c1, t: ownerTexts() }));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 04:00`);                       // no cost line → no carton share → no suggested price
  seed("x_operating_cost", { x_name: "صيانة", x_cost_type: "fixed", x_frequency: "monthly", x_amount: 2600, x_date_from: "2026-01-01", x_date_to: false, x_utak_simulation: false });
  table("hr.employee").forEach((e: any) => { e.resource_calendar_id = false; });
  dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const p = lineFor(3);
  assert("the day's cost «تعذّر»: no suggested price on the line, the choices of before («لا تنشر» / «عدّل»)", p.x_suggested_price === 0 && JSON.stringify(choiceIds(msgOf("بطاطس"))) === JSON.stringify([`pexc_s_${p.id}`, `pexc_e_${p.id}`]) && !/السعر المربح المقترح/.test(msgOf("بطاطس").interactive.body.text), JSON.stringify(p));
  assert("…and a «اعتمد بالسعر المربح» tap is refused", /لا سعر مربح مقترح/.test(await quiet(() => PR.handlePriceExceptionButton(env, `pexc_p_${p.id}`))) && !lineFor(3).x_decision);
}

console.log("\n[ب] the decision from Odoo («قرار براء» = «اعتمد بالسعر المربح», no price typed), and the publication");
{
  const env = fourCases(`${DAY} 05:00`);
  await quiet(() => PR.refreshPriceDay(env));
  table("x_price_day_line").get(lineFor(3).id)!.x_decision = "profit";          // chosen in the form, «السعر المعدّل» left empty
  await quiet(() => PR.refreshPriceDay(env, { force: true }));                     // «🔄 إعادة الحساب»
  const p = lineFor(3);
  assert("the engine applies it: approved by hand at the suggested 26.50", p.x_status === "manual" && p.x_sale_price === 26.5 && p.x_reason === "براء: اعتمد بالسعر المربح" && !p.x_excluded && !!p.x_decided_at, JSON.stringify(p));
  assert("…and keeps that 26.50 as his price («السعر المعدّل», fixed for «profit»): a later cost change does not move a decided line", p.x_manual_price === 26.5 && p.x_manual_for === "profit");
  table("x_operating_cost").forEach((r: any) => { r.x_amount = 1000; });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…the cost rises (suggested 29.00): still approved at 26.50", lineFor(3).x_sale_price === 26.5 && lineFor(3).x_suggested_price === 29 && lineFor(3).x_status === "manual", JSON.stringify(lineFor(3)));
  table("x_operating_cost").forEach((r: any) => { r.x_amount = 500; });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  setRiyadh(`${DAY} 06:00`);
  const tick = await quiet(() => PR.runPricesTick(env, Date.now()));
  const list = JSON.stringify(heldFor(env, "966500000891"));
  assert("06:00: published — tomato at the market 29 and potato at the suggested 26.50", (tick.deadline as any)?.action === "auto_published" && dayOf().x_state === "published" && /• طماطم \(كرتون\): 29 ر.س/.test(list) && /• بطاطس \(كرتون\): 26\.50 ر.س/.test(list), list.slice(0, 400));
  assert("…the undecided exceptions (cucumber, onion) are not published, as before, and Baraa gets the one line", !/خيار|بصل/.test(list) && lineFor(2).x_status === "unpublished" && /استثناء بلا قرار عند النشر/.test(String(lineFor(2).x_reason)) && ownerTexts().filter((x) => x.startsWith("⏰ لم يُنشر اليوم 2 أصناف")).length === 1, JSON.stringify(ownerTexts().slice(-3)));
  const price = await quiet(() => OD.getLatestSalePrice(env, 3, 31));
  assert("the quotation / invoice price of potato: today's published 26.50", price.price === 26.5 && price.source === "today", JSON.stringify(price));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ج] the numbers of 2026-10-01, and the new-product alert
console.log("\n[ج] 2026-10-01: share 1.99 (496.52 ÷ 250), waste 5 %, minimum profit 2 riyals a carton (§ 48 أ)");
{
  const share = PB.boardShare(496.52, 250, { days: 0, average: null }).share;
  const want: Array<[string, number, number, number, number, number]> = [
    ["رمان كبير", 22, 1.1, 25.09, 28.85, 31.5],
    ["رمان وسط", 16, 0.8, 18.79, 21.61, 24],
    ["رمان صغير", 12, 0.6, 14.59, 16.78, 19.5],
    ["موز أمريكي", 22, 1.1, 25.09, 28.85, 31.5],
  ];
  assert("the carton share: 1.99", share === 1.99);
  for (const [name, purchase, waste, full, even, suggested] of want) {
    const b = PB.boardLine({ purchase, sale: 0, wastePct: 5, vatRatePct: 15, opShare: share, minProfit: 2 });
    assert(`${name}: الشراء ${purchase} · التالف ${waste} · التكلفة الكاملة ${full} · أقل سعر بدون خسارة ${even} · المقترح ${suggested} · ⚪ بلا سوق`,
      b.x_net_purchase === purchase && b.x_waste_cost === waste && b.x_full_cost === full && b.x_break_even === even && b.x_suggested_price === suggested && b.x_board_status === "none" && b.x_real_profit === 0, JSON.stringify(b));
  }
}
{
  const env = fresh("2026-10-01 11:00");
  seed("x_operating_cost", { x_name: "تكلفة اليوم", x_cost_type: "variable", x_frequency: "daily", x_amount: 496.52, x_date_from: "2026-10-01", x_date_to: false, x_utak_simulation: false });
  const d = seed("x_price_day", { x_date: "2026-10-01", x_state: "missed", x_name: "أسعار اليوم 2026-10-01", x_utak_simulation: false });
  dp(1, 11, 22, "2026-10-01");
  // a line of a product that is not for sale (the banana of 10-01), written by hand with its purchase price
  const banana = seed("x_price_day_line", { x_day_id: d, x_sequence: 9, x_name: "بطاطس — كرتون", x_product_tmpl_id: 3, x_packaging_id: 31, x_supplier_id: AHMED, x_source_price: 22, x_cost_price: 22 });
  table("product.template").get(3)!.x_is_active_for_sale = false;
  graph.length = 0; odooLog.length = 0;
  const r = await quiet(() => PR.refreshPriceDay(env, { day: "2026-10-01", force: true }));
  const t = lineFor(1, "2026-10-01"), b = table("x_price_day_line").get(banana) as any;
  assert("a «فات الموعد» day is still computed by the engine, and stays «فات الموعد»", r.action === "refreshed" && dayOf("2026-10-01").x_state === "missed" && !odooLog.some((x) => x.model === "x_price_day" && "x_state" in (x.body?.vals ?? {})), JSON.stringify(r));
  assert("its line with a purchase price and no market: an exception «لا سعر سوق», the two numbers written, ⚪", t.x_cost_price === 22 && t.x_status === "exception" && t.x_reason === "لا سعر سوق" && t.x_full_cost === 25.09 && t.x_break_even === 28.85 && t.x_suggested_price === 31.5 && t.x_board_status === "none", JSON.stringify(t));
  assert("the line of a product not for sale keeps its purchase price and gets the same numbers («لم يُنشر»)", b.x_cost_price === 22 && b.x_status === "unpublished" && b.x_full_cost === 25.09 && b.x_break_even === 28.85 && b.x_suggested_price === 31.5 && b.x_board_status === "none", JSON.stringify(b));
  assert("…and nothing is sent by a recompute (no exception message outside 04:00–06:00, no publication)", graph.length === 0 && heldFor(env, OWNER).length === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] no «🆕 صنف جديد» alert for a product whose flag is off");
{
  const env = fresh(`${DAY} 09:00`);
  const id = seed("product.template", { id: 197, name: "موز أمريكي", default_code: "UTAK-FRT-002", categ_id: false, x_supplier_ids: [AHMED], x_is_active_for_sale: false, x_name_en: false, x_utak_new: false, create_date: "2026-10-03 05:55:00" });
  for (const hm of ["09:05", "09:10", "09:30"]) {
    setRiyadh(`${DAY} ${hm}`);
    const r = await quiet(() => PSU.runProductSetupTick(env));
    assert(`${hm}: an existing product (flag off, however incomplete its card): the tick does not read it, nothing sent`, r.length === 0 && ownerTexts().length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(r));
  }
  const fresh2 = fresh(`${DAY} 09:05`);
  const nid = seed("product.template", { id: 198, name: "صنف أُنشئ بسكربت", default_code: false, categ_id: false, x_supplier_ids: [], x_is_active_for_sale: false, x_name_en: false, x_utak_new: true, create_date: "2026-10-03 06:00:00" });
  assert("a product just created (5 minutes): flagged, waiting", (await quiet(() => PSU.runProductSetupTick(fresh2)))[0]?.action === "waiting");
  table("product.template").get(nid)!.x_utak_new = false;                       // the flag cleared inside the ten minutes
  setRiyadh(`${DAY} 09:10`);
  const after = await quiet(() => PSU.runProductSetupTick(fresh2));
  assert("its flag cleared before the ten minutes: no alert at all, now or later", after.length === 0 && ownerTexts().length === 0 && heldFor(fresh2, OWNER).length === 0, JSON.stringify(after));
  assert("the only products the tick reads are the flagged ones", JSON.stringify(odooLog.filter((x) => x.model === "product.template" && x.method === "search_read").at(-1)?.body?.domain) === JSON.stringify([[PSU.NEW_FLAG, "=", true]]));
  void id;
}

// ================================================================ [س]
console.log("\n[س] schema, and the wiring");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));
{
  const f = FIX[FIX.length - 1];
  assert("the fixture (read-only fields_get) still names x_min_margin_pct (nothing deleted), x_break_even, x_suggested_price", f.x_pricing_config.includes("x_min_margin_pct") && f.x_price_day_line.includes("x_break_even") && f.x_price_day_line.includes("x_suggested_price"));
  assert("…and «profit» among the decisions", JSON.stringify(f._selections["x_price_day_line.x_decision"]) === '["market","skip","edit","profit"]');
  const idx = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert("the owner's branch routes pexc_p_ to the price decision (a reply button or a list row)", /\/\^pexc_\[mspe\]_\\d\+\$\/\.test\(msg\.buttonId/.test(idx) && PR.PRICE_EXCEPTION_PAYLOAD.test("pexc_p_12") && !PR.PRICE_EXCEPTION_PAYLOAD.test("pexc_x_12"));
  const views = readFileSync(new URL("../scripts/lib/s47-odoo-views.mjs", import.meta.url), "utf8");
  assert("the board's card and list show the two numbers, the settings form «الهامش الأدنى ٪» beside «نسبة التالف»",
    /أقل سعر بيع بدون خسارة<\/span><field name="x_break_even"\/>/.test(views) && /السعر المربح المقترح<\/span><field name="x_suggested_price"\/>/.test(views)
    && /<field name="x_break_even"\/>\n  <field name="x_suggested_price"\/>/.test(views) && /<field name="x_waste_pct"\/>`;[\s\S]*<field name="x_min_margin_pct"\/>/.test(views));
  const pa = readFileSync(new URL("../src/purchase-accounting.ts", import.meta.url), "utf8");
  assert("the bill's tax is resolved price-excluded, and no price-included twin is searched any more", /resolveCompanyPurchaseTaxExcluded\(env\)/.test(pa) && !/tax_included/.test(pa.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
}

done();
