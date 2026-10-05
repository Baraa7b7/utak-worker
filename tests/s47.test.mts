// § 47 (2026-10-01) — the purchase price is entered net of VAT, and the profitable price.
//
//   [أ] every purchase price is net as written, whoever the source: the board and the profit never
//       divide it by 1.15, a registered and an unregistered source give the same numbers, «the
//       lowest offer» compares the numbers as they are; the supplier's bill adds 15 % on top for a
//       supplier with a VAT number (22 → 25.30) and nothing for one without (22); the supplier
//       dues, the purchase order document, the sale-price fallback and the free texts that ask for
//       prices follow the same rule.
//   [ب] «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح» (rounded up to 0.5), «الهامش الأدنى ٪»,
//       the cases of the engine, the day's review and its choices («انشر بالمقترح» among them), the
//       decision from WhatsApp and from Odoo, the publication.
//   [ج] the numbers of 2026-10-01 (share 1.99, margin 5 %), and no new-product alert for a product
//       whose flag is off.
//
// § 48 (2026-10-01) — re-based on the fixed minimum profit a carton: the suggested price is (full cost
// + «الربح الأدنى للكرتون» 2) × 1.15 rounded up to 0.5, no longer full cost × 1.05 × 1.15 (with the kit's
// share of 2.00: tomato 29.00, cucumber 36.00, potato 26.50; on 10-01: 31.50 / 24.00 / 19.50), and on
// the fallback of § 48 ب (a purchase price today without a fallback is «missing», never an older
// day's price). The rule itself — the market price once it reaches the suggested price — is § 47's.
//
// § 54 (2026-10-05) — re-based on the proposed decision of a line (src/pricing-engine.ts proposeDecision)
// and on the day's review in ONE message (src/price-review.ts): a market price between «بدون خسارة» and
// the suggested price is automatic at the market price (an exception «أقل من السعر المربح» before); a line
// is an exception for a loss (the market below «بدون خسارة»), no market price, no purchase price or an
// outlier. The message per exception, its four choices and «عدّل» are gone: the purchase, the market and
// the proposed decision of every item reach Baraa in one message with three buttons, and «انشر بالمقترح» /
// «انشر بسعر السوق» / «لا تنشر» / «سعر يدوي» are the choices of its form. The day of the four cases keeps
// its exception by a real loss (cucumber: market 33 under its «بدون خسارة» 33.70; it was 34).
//
// § 55 أ (2026-10-05) — re-based on the review's plain wording (the behaviour is § 54's): an item's line
// opens with its mark, keeps the purchase price with the same price × 1.15 beside it («شراء 20 (23.00 شامل)»,
// to set against the market, which includes the VAT) and shows «ربحنا» — the board's net of a carton at the
// price, signed, two decimals — in place of «الفرق»; three lines under the table say what each choice does (the
// counts line and «بلا قرارك حتى 06:00…» before); the buttons are «✅ نفّذ المقترح» / «✏️ عدّل» / «⛔ لا تنشر
// شيء»; the form carries two lines an item (its numbers with «ربحنا», and the suggested price against the
// market) and every choice its own profit; the confirmation ends each item with «ربحنا» and adds «متوسط
// الربح للكرتون». With the kit's share of 2.00: tomato at 29 → 25.22 − 23 = +2.22; cucumber at its market
// 33 → 28.70 − 29.30 = −0.60 and at its suggested 36 → 31.30 − 29.30 = +2.00; potato at its suggested
// 26.50 → 23.04 − 20.90 = +2.14.
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
const PRV = await import("../src/price-review.ts");
const worker = (await import("../src/index.ts")).default;

const offer = (o: Record<string, unknown>) => ({ kind: "market", price: 0, outlier: false, partnerId: 1, sourceName: "م", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o }) as any;
const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };
const VAT = { ratePct: 15 };
const FLOOR = { opShare: 2, minProfit: 2 };
/** Omar's «شراء» / «سوق» of the day (an x_price_offer row of the employee's Work Contact). */
const omar = (product: number, packaging: number, o: { purchase?: number; market?: number; outlier?: boolean }, day = DAY) =>
  seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: DRIVER, x_date: day, x_purchase_price: o.purchase ?? 0, x_market_price: o.market ?? 0, x_purchase_outlier: false, x_market_outlier: o.outlier === true, x_status: o.outlier ? "outlier" : "valid", x_utak_simulation: false });
/** § 54 — the day's review: ONE interactive message with every item and three buttons (it replaced a message per exception). */
const reviews = () => sentTo(OWNER).filter((b: any) => b?.type === "interactive" && b.interactive?.type === "button" && /مراجعة أسعار اليوم/.test(String(b.interactive?.body?.text)));
const reviewText = () => String(reviews().at(-1)?.interactive?.body?.text ?? "");
const buttonIds = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
const notify = (env: any) => quiet(() => PRV.notifyPriceReviewMessage(env));
/** The review's form («✏️ عدّل», a Flow; «✏️ مراجعة» before § 55) as it was sent: its token, and the data of its pages. */
const forms = () => sentTo(OWNER).filter((b: any) => b?.interactive?.type === "flow");
const formOf = (b: any) => ({ token: String(b.interactive.action.parameters.flow_token), data: b.interactive.action.parameters.flow_action_payload.data as Record<string, any> });
/** «✏️ عدّل» tapped under the review of the day: the form, and its items by name (slot, choices). */
async function openForm(env: any): Promise<{ action: string; token: string; data: Record<string, any>; item: (name: string) => any }> {
  const action = await quiet(() => PRV.handlePriceReviewButton(env, `prv_r_${dayOf().id}_1`));
  const f = formOf(forms().at(-1));
  const rec = (await PRV.readReviewFormToken(env, f.token))!;
  return { action, ...f, item: (name: string) => rec.items.find((i: any) => i.name === name) };
}
const optionIds = (o: any): string[] => (o ?? []).map((x: any) => x.id);
/** § 55 — the lines of the review's text, and an item's own line in it (its mark, its name, «—»): each item once. */
const reviewLines = (text = reviewText()): string[] => text.split("\n");
const itemLines = (name: string, text = reviewText()): string[] => reviewLines(text).filter((l) => /^(✅|❌|⚠️|🔻) /.test(l) && l.includes(` ${name} — `));
/** …and the three lines that close it: what «نفّذ المقترح» publishes, what it does not, what goes out at 06:00 with no tap. */
const choiceTail = (out: string, stay: string, auto: string): string => `\n\nلو ضغطت «نفّذ المقترح» ينتشر: ${out}\nوما ينتشر: ${stay}\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: ${auto}`;

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
  // § 54 أ — a market price between «بدون خسارة» (26.45) and the suggested price is no longer an exception («سعر السوق 29 أقل من السعر المربح 30» before)
  assert("Baraa raises it to 3: the next run recomputes (suggested 30.00); the same line, now below its suggested price and above «بدون خسارة» 26.45, stays automatic at the market 29 (§ 54)", r.action === "refreshed" && lineFor(1).x_suggested_price === 30 && lineFor(1).x_break_even === 26.45 && lineFor(1).x_status === "auto" && lineFor(1).x_sale_price === 29 && !lineFor(1).x_reason, JSON.stringify(lineFor(1)));
  const w = await quiet(() => PR.rewriteBoard(env2, dayOf().id));
  assert("…and the board rewritten from the stored line («🔄» after a decision) keeps the same 30.00 (the settings' amount, not the default)", w.updated === 0 && lineFor(1).x_suggested_price === 30 && lineFor(1).x_break_even === 26.45, JSON.stringify(w));
  // § 54 — below the suggested price a line no longer waits for him, so the rule's own use of the amount shows where the suggested
  // price IS the sale price: a line without a market price, «اعتمد بالسعر المربح» chosen in Odoo with no price typed
  dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env2));
  table("x_price_day_line").get(lineFor(3).id)!.x_decision = "profit";
  await quiet(() => PR.refreshPriceDay(env2, { force: true }));
  assert("…and the engine's own rule reads the same 3: potato (no market) is approved at (20.90 + 3) × 1.15 = 27.49 → 27.50 — the default 2 would give 26.50", lineFor(3).x_status === "manual" && lineFor(3).x_sale_price === 27.5 && lineFor(3).x_suggested_price === 27.5, JSON.stringify(lineFor(3)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the cases of the engine (the rule, pure)");
{
  const run = (offers: any[], floor: any = FLOOR) => EN.computePricing([ITEM], offers, 5, VAT, floor)[0];
  const p20 = offer({ kind: "purchase", price: 20, model: "dp", partnerId: AHMED });
  const c1 = run([p20, offer({ price: 29 })]);
  assert("(1) market 29 ≥ the suggested 29.00 → no exception, sale = the market price", c1.exceptions.length === 0 && c1.sale === 29 && c1.suggested === 29 && c1.breakEven === 26.45 && c1.fullCost === 23, JSON.stringify(c1));
  assert("…and the verdict: automatic at the market price", JSON.stringify(EN.lineVerdict(c1, null, 0)) === JSON.stringify({ status: "auto", sale: 29, excluded: false, reason: "" }));
  const c1b = run([p20, offer({ price: 40 })]);
  assert("…a market price well above it is published as it is (40, not the suggested 29)", c1b.exceptions.length === 0 && EN.lineVerdict(c1b, null, 0).sale === 40);
  const c2 = run([p20, offer({ price: 28.5 })]);
  assert("(2) market 28.50, between «بدون خسارة» 26.45 and the suggested 29.00 → automatic at the market price 28.50 (§ 54; an exception «سعر السوق 28.50 أقل من السعر المربح 29» before)", c2.exceptions.length === 0 && c2.reason === "" && JSON.stringify(c2.proposal) === JSON.stringify({ kind: "market", price: 28.5, why: "below_suggested", outlier: false, auto: true })
    && JSON.stringify(EN.lineVerdict(c2, null, 0)) === JSON.stringify({ status: "auto", sale: 28.5, excluded: false, reason: "" }), JSON.stringify(c2));
  assert("…nothing is lost at it: the market price covers the break-even (26.45) and the unit profit is above zero", c2.unitProfit !== null && c2.unitProfit > 0 && c2.breakEven === 26.45 && (c2.sale as number) >= (c2.breakEven as number));
  const c2b = run([p20, offer({ price: 26 })]), c2c = run([p20, offer({ price: 26.45 })]);
  assert("(2ب) market 26 < «بدون خسارة» 26.45 → an exception «سعر السوق 26 أقل من سعر بدون خسارة 26.45», proposed «لا تنشر (خسارة)»", c2b.exceptions.join() === "loss" && c2b.reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && c2b.proposal.kind === "skip" && c2b.proposal.why === "loss" && !c2b.proposal.auto && EN.lineVerdict(c2b, null, 0).status === "exception" && EN.lineVerdict(c2b, null, 0).sale === 0, JSON.stringify(c2b));
  assert("…a market price exactly at «بدون خسارة» (26.45) is not a loss: automatic at 26.45", c2c.exceptions.length === 0 && EN.lineVerdict(c2c, null, 0).status === "auto" && EN.lineVerdict(c2c, null, 0).sale === 26.45, JSON.stringify(c2c.proposal));
  const c3 = run([p20]);
  assert("(3) no market price, a purchase price → an exception that carries the suggested price (proposed «انشر بالمقترح 29», by Baraa's word alone)", c3.exceptions.join() === "no_market" && c3.suggested === 29 && c3.sale === null && c3.proposal.kind === "profit" && c3.proposal.price === 29 && !c3.proposal.auto && EN.lineVerdict(c3, null, 0).status === "exception", JSON.stringify(c3));
  const c4 = run([offer({ price: 28 })]);
  assert("(4) no purchase price → «لا سعر شراء», no suggested price, as before (proposed «لا تنشر»)", c4.exceptions.join() === "no_purchase" && c4.suggested === null && c4.breakEven === null && c4.fullCost === null && c4.proposal.kind === "skip" && c4.proposal.why === "no_purchase", JSON.stringify(c4));
  const out = run([p20, offer({ price: 30, outlier: true })]);
  assert("an outlier stays an exception even above the suggested price (the same decision, marked ⚠️, never published without Baraa)", out.exceptions.join() === "outlier" && out.proposal.kind === "market" && out.proposal.price === 30 && out.proposal.outlier && !out.proposal.auto && EN.lineVerdict(out, null, 0).status === "exception");
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

/**
 * The day of the four cases: tomato (1) automatic, cucumber (2) a loss at its market price, potato (3) no
 * market, onion (4) no purchase. § 54 — cucumber's market is 33, under its «بدون خسارة» 33.70 (it was 34:
 * between «بدون خسارة» and the suggested 36, an exception before § 54 and automatic since).
 */
function fourCases(riyadh = `${DAY} 04:00`, cucumberMarket = 33): any {
  const env = fresh(riyadh); cost(500);
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, 20); market(1, 11, 29);        // suggested 29.00 → automatic at 29
  dp(2, 21, 26); market(2, 21, cucumberMarket);   // full 29.30 → «بدون خسارة» 33.70, suggested 36.00
  dp(3, 31, 18);                           // full 20.90 → suggested 26.50, no market
  market(4, 41, 30);                       // no purchase
  return env;
}

console.log("\n[ب] the engine on the day, and the day's review: ONE message, its buttons, its form and its choices (§ 54; the wording of § 55)");
{
  const env = fourCases();
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1), c = lineFor(2), p = lineFor(3), o = lineFor(4);
  assert("(1) tomato: automatic at the market price 29 (🟢)", t.x_status === "auto" && t.x_sale_price === 29 && t.x_suggested_price === 29 && t.x_break_even === 26.45 && !t.x_excluded, JSON.stringify(t));
  assert("(2) cucumber: an exception, «سعر السوق 33 أقل من سعر بدون خسارة 33.70» (a loss)", c.x_status === "exception" && c.x_sale_price === 0 && c.x_excluded === true && c.x_reason === "سعر السوق 33 أقل من سعر بدون خسارة 33.70" && c.x_suggested_price === 36 && c.x_break_even === 33.7, JSON.stringify(c));
  assert("(3) potato: an exception «لا سعر سوق» carrying the suggested 26.50 (and the break-even 24.04); ⚪ on the board", p.x_status === "exception" && p.x_reason === "لا سعر سوق" && p.x_suggested_price === 26.5 && p.x_break_even === 24.04 && p.x_board_status === "none" && p.x_full_cost === 20.9, JSON.stringify(p));
  assert("(4) onion: «لا سعر شراء», no suggested price", o.x_status === "exception" && o.x_reason === "لا سعر شراء" && o.x_suggested_price === 0 && o.x_break_even === 0, JSON.stringify(o));
  const n = await notify(env);
  const body = reviewText(), d = dayOf().id;
  assert("04:00: ONE message for the whole day — the three exceptions (the 3 that need his decision) and the automatic line in it, never a message per item", n.action === "sent" && n.count === 3 && reviews().length === 1 && sentTo(OWNER).length === 1 && ["طماطم", "خيار", "بطاطس", "بصل"].every((x) => itemLines(x, body).length === 1), JSON.stringify({ n, body }));
  // § 55 — «ربحنا» (29 ÷ 1.15 = 25.22, − the full cost 23 = +2.22) took the place of «الفرق 9 (45%)»; the purchase price stays, with the same
  // price × 1.15 beside it («شامل»): 20 → 23.00, 26 → 29.90, 18 → 20.70 — on the three lines that have one, and on no other (the onion has none)
  assert("(1) the automatic line with its proposed decision, ✅, its purchase price («23.00 شامل» beside it) and its profit: «✅ طماطم — شراء 20 (23.00 شامل) · سوق 29 | ربحنا بسعر السوق: +2.22 ← انشر بـ 29»; no «الفرق» in the message",
    reviewLines(body).includes("✅ طماطم — شراء 20 (23.00 شامل) · سوق 29 | ربحنا بسعر السوق: +2.22 ← انشر بـ 29") && !/الفرق/.test(body)
      && JSON.stringify(body.match(/شراء \d[^·|\n]*/g)) === JSON.stringify(["شراء 20 (23.00 شامل) ", "شراء 26 (29.90 شامل) ", "شراء 18 (20.70 شامل) "]), body);
  // § 55 — the loss itself, signed (33 ÷ 1.15 = 28.70, − the full cost 29.30 = −0.60), where «الفرق 7 (27%)» stood; «2 للنشر · 2 لا تنشر · 0 ⚠️» and
  // «بلا قرارك حتى 06:00: يُنشر تلقائياً 1 …» are the three lines, by name and price
  assert("(2) cucumber's line names both numbers — the purchase 26 («29.90 شامل») and the market 33 — and what it loses at it — «ربحنا بسعر السوق: −0.60» — ❌ «لا تنشر»; the three lines say what «نفّذ المقترح» publishes, what it does not, and what happens without him by 06:00",
    reviewLines(body).includes("❌ خيار — شراء 26 (29.90 شامل) · سوق 33 | ربحنا بسعر السوق: −0.60 ← لا تنشر") && body.endsWith(choiceTail("طماطم 29، بطاطس 26.50", "خيار، بصل", "طماطم 29")), body);
  // § 55 — potato at its suggested 26.50: 23.04 − 20.90 = +2.14 (the board's own «real profit» of the approved line, below)
  assert("(3) potato's line carries its purchase price, the suggested price and its profit: «شراء 18 (20.70 شامل) · لا سعر سوق | ربحنا بالمقترح 26.50: +2.14 ← انشر بـ 26.50»; (4) onion's — no purchase price, nothing written for it — «سوق 30 | لا سعر شراء ← لا تنشر»",
    reviewLines(body).includes("✅ بطاطس — شراء 18 (20.70 شامل) · لا سعر سوق | ربحنا بالمقترح 26.50: +2.14 ← انشر بـ 26.50") && reviewLines(body).includes("❌ بصل — سوق 30 | لا سعر شراء ← لا تنشر"), body);
  assert("three reply buttons under it: «✅ نفّذ المقترح» / «✏️ عدّل» / «⛔ لا تنشر شيء» (§ 55: the payloads of § 54)", JSON.stringify(buttonIds(reviews()[0])) === JSON.stringify([`prv_a_${d}_1`, `prv_r_${d}_1`, `prv_n_${d}_1`])
    && JSON.stringify(reviews()[0].interactive.action.buttons.map((x: any) => x.reply.title)) === JSON.stringify([PRV.REVIEW_BUTTON_ALL, PRV.REVIEW_BUTTON_FORM, PRV.REVIEW_BUTTON_NONE])
    && JSON.stringify([PRV.REVIEW_BUTTON_ALL, PRV.REVIEW_BUTTON_FORM, PRV.REVIEW_BUTTON_NONE]) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء"]), JSON.stringify(reviews()[0].interactive.action));
  // «✏️ عدّل»: the choices of every item are in ONE form
  const f = await openForm(env);
  const cu = f.item("خيار"), po = f.item("بطاطس"), on = f.item("بصل");
  assert("«✏️ عدّل» → ONE form (a Flow) with the four items", f.action === "form" && forms().length === 1 && !!cu && !!po && !!on && !!f.item("طماطم"), JSON.stringify(f.action));
  // § 55 — two lines an item. «الفرق 7 · بدون خسارة 33.70 · مقترح 36» left the first: the purchase price has × 1.15 beside it (26 → 29.90), the
  // line ends with «ربحنا» at the market price, and the suggested price has its own line, set against the market as observed: 36 − 33 = 3, 3 ÷ 33 = 9.1 %
  assert("(2) in the form cucumber carries two lines: its numbers and its profit at the market price — «شراء 26 (29.90 شامل) · سوق 33 · ربحنا بسعر السوق: −0.60» — and the suggested price against the market — «سعرنا المقترح 36 = أعلى من السوق بـ 3 (+9.1%)»",
    f.data[`x${cu.slot}`] === "شراء 26 (29.90 شامل) · سوق 33 · ربحنا بسعر السوق: −0.60" && f.data[`y${cu.slot}`] === "سعرنا المقترح 36 = أعلى من السوق بـ 3 (+9.1%)" && !/الفرق|بدون خسارة/.test(String(f.data[`x${cu.slot}`]) + String(f.data[`y${cu.slot}`])), JSON.stringify([f.data[`x${cu.slot}`], f.data[`y${cu.slot}`]]));
  // § 55 — a choice carries its own profit and no longer opens with «انشر»: at the suggested 36 → 31.30 − 29.30 = +2.00, at the market 33 → −0.60
  assert("(2) four choices in ONE list, each price and its profit in its title: «بالمقترح 36 (ربح +2.00)», «بسعر السوق 33 (ربح −0.60)», «لا تنشر», «سعر يدوي» — opened on the proposed «لا تنشر»",
    JSON.stringify(f.data[`o${cu.slot}`]) === JSON.stringify([{ id: "profit", title: "بالمقترح 36 (ربح +2.00)" }, { id: "market", title: "بسعر السوق 33 (ربح −0.60)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]) && f.data[`s${cu.slot}`] === "skip", JSON.stringify(f.data[`o${cu.slot}`]));
  assert("(3) potato (no market price): «بالمقترح 26.50 (ربح +2.14)» / «لا تنشر» / «سعر يدوي» — no «بسعر السوق» — opened on «بالمقترح»; its lines «شراء 18 (20.70 شامل) · لا سعر سوق» and «سعرنا المقترح 26.50 — لا سعر سوق للمقارنة»",
    JSON.stringify(optionIds(f.data[`o${po.slot}`])) === JSON.stringify(["profit", "skip", "manual"]) && f.data[`o${po.slot}`][0].title === "بالمقترح 26.50 (ربح +2.14)" && f.data[`s${po.slot}`] === "profit"
      && f.data[`x${po.slot}`] === "شراء 18 (20.70 شامل) · لا سعر سوق" && f.data[`y${po.slot}`] === "سعرنا المقترح 26.50 — لا سعر سوق للمقارنة", JSON.stringify([f.data[`o${po.slot}`], f.data[`x${po.slot}`], f.data[`y${po.slot}`]]));
  assert("(4) onion (no purchase price): «بسعر السوق 30» (no profit beside it: none can be computed) / «لا تنشر» / «سعر يدوي» — no «بالمقترح», no suggested number («لا سعر مقترح») — opened on «لا تنشر»",
    JSON.stringify(optionIds(f.data[`o${on.slot}`])) === JSON.stringify(["market", "skip", "manual"]) && f.data[`o${on.slot}`][0].title === "بسعر السوق 30" && f.data[`s${on.slot}`] === "skip"
      && f.data[`x${on.slot}`] === "لا سعر شراء · سوق 30" && f.data[`y${on.slot}`] === "لا سعر مقترح", JSON.stringify([f.data[`o${on.slot}`], f.data[`x${on.slot}`], f.data[`y${on.slot}`]]));
  assert("the three titles fit a reply button (≤ 20 characters) and every choice a list option (≤ 30)", [PRV.REVIEW_BUTTON_ALL, PRV.REVIEW_BUTTON_FORM, PRV.REVIEW_BUTTON_NONE].every((x) => [...x].length <= 20)
    && [cu, po, on, f.item("طماطم")].every((it: any) => f.data[`o${it.slot}`].every((x: any) => [...x.title].length <= PRV.REVIEW_OPTION_MAX)) && PRV.REVIEW_OPTION_MAX === 30);
  assert("no template is used for the review or its form (session messages only)", sentTo(OWNER).every((b: any) => b.type !== "template"));
  setRiyadh(`${DAY} 04:05`);
  assert("the next tick: no second message", (await notify(env)).action === "sent_before" && reviews().length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // § 54 أ — the cucumber of before § 54 (market 34, between «بدون خسارة» 33.70 and the suggested 36) is no exception any more
  const env = fourCases(`${DAY} 04:00`, 34);
  await quiet(() => PR.refreshPriceDay(env));
  const c = lineFor(2);
  assert("(2ب) cucumber at a market of 34 (it was the exception «سعر السوق 34 أقل من السعر المربح 36»): automatic at the market price 34, no reason", c.x_status === "auto" && c.x_sale_price === 34 && c.x_excluded === false && !c.x_reason && c.x_suggested_price === 36 && c.x_break_even === 33.7, JSON.stringify(c));
}
{
  const env = fourCases(); closeOwnerWindow(env);
  await quiet(() => PR.refreshPriceDay(env));
  const n = await notify(env);
  assert("his window closed: nothing is held and nothing sent (no template usable here) — the review is owed to his next message", n.action === "window_closed" && n.review === "not_usable" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0 && env.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`), JSON.stringify({ n, held: heldFor(env, OWNER) }));
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "text", text: { body: "صباح الخير" } })), env, harnessCtx));
  assert("…his next message opens his window: the review goes then, whole — its four items, their choices behind its three buttons — and no template", reviews().length === 1 && ["طماطم", "خيار", "بطاطس", "بصل"].every((x) => itemLines(x).length === 1) && reviewText().endsWith(choiceTail("طماطم 29، بطاطس 26.50", "خيار، بصل", "طماطم 29")) && /^prv_a_\d+_1,prv_r_\d+_1,prv_n_\d+_1$/.test(buttonIds(reviews()[0]).join())
    && sentTo(OWNER).every((b: any) => b.type !== "template") && heldFor(env, OWNER).length === 0 && !env.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`), JSON.stringify({ types: sentTo(OWNER).map((b: any) => b.type), text: reviewText() }));
}
{
  const env = fresh(`${DAY} 04:00`); cost(500);
  dp(1, 11, 20); market(1, 11, 30); omar(1, 11, { market: 31, outlier: true });
  await quiet(() => PR.refreshPriceDay(env));
  await notify(env);
  const t = lineFor(1);
  // § 55 — ⚠️ opens the line (it stood before the decision, with «(سعر شاذ)» after it), the purchase 20 has × 1.15 beside it (23.00), «ربحنا» at
  // the market 31 is 26.96 − 23 = +3.96, and a second line under it names what moved: Omar's market price before this one (30) ← the outlier (31)
  const at = reviewLines().indexOf("⚠️ طماطم — شراء 20 (23.00 شامل) · سوق 31 | ربحنا بسعر السوق: +3.96 ← انشر بـ 31");
  assert("an outlier above the suggested price: it waits for him, proposed at the MARKET price and marked ⚠️ (never at the suggested 29: the market price is the profitable one), and the line under it says what moved — «⚠️ سعر السوق تغيّر كثير (30 ← 31)، تأكد منه»",
    t.x_status === "exception" && t.x_market_price === 31 && at >= 0 && reviewLines()[at + 1] === "⚠️ سعر السوق تغيّر كثير (30 ← 31)، تأكد منه" && itemLines("طماطم").length === 1 && !/طماطم — [^\n]*(بالمقترح|انشر بـ 29)/.test(reviewText()), reviewText());
  // § 55 — «1 للنشر · 3 لا تنشر · 1 ⚠️» left the text (the count itself stays: reviewCounts); «بلا قرارك حتى 06:00: لا يُنشر شيء.» is the third line
  const counts = PRV.reviewCounts(await quiet(() => PRV.dayReviewRows(env, dayOf())));
  assert("…counted one ⚠️ (1 published by «نفّذ المقترح», 3 not), and not published without his decision («الساعة 6 ينتشر تلقائياً: لا شيء»)",
    JSON.stringify(counts) === JSON.stringify({ publish: 1, skip: 3, warn: 1, auto: 0 }) && reviewLines().filter((l) => l.startsWith("⚠️ ")).length === 2 && reviewText().endsWith(choiceTail("طماطم 31", "خيار، بطاطس، بصل", "لا شيء")), JSON.stringify({ counts, text: reviewText() }));
}

console.log("\n[ب] «بالمقترح» («انشر بالمقترح» before § 55) from the review: the form's answer, the lock, the board, the next run");
{
  const env = fourCases();
  await quiet(() => PR.refreshPriceDay(env));
  await notify(env);
  const f = await openForm(env);
  // the form as it comes back: potato on its proposed «بالمقترح»; onion «بالمقترح» too — a choice its list never offered
  const answer = (values: Record<string, unknown>, id: string) => quiet(() => PRV.handlePriceReviewReply(env, { from: "+" + OWNER, messageId: id, flow: { token: f.token, values } }));
  const r1 = await answer({ [`d${f.item("بطاطس").slot}`]: "profit", [`d${f.item("بصل").slot}`]: "profit" }, "wamid.F1");
  const o1 = lineFor(4);
  assert("on a line without a purchase price «بالمقترح» is no choice: an answer that names it approves nothing (the line takes what its list opened on, «لا تنشر»)", o1.x_decision === "skip" && o1.x_status === "unpublished" && o1.x_sale_price === 0 && !(o1.x_manual_price > 0), JSON.stringify(o1));
  const p1 = lineFor(3), conf = ownerTexts().at(-1) ?? "";
  // § 55 — the confirmation ends each item with «ربحنا» (potato +2.14, the tomato its list opened on +2.22) and adds their plain mean: (2.22 + 2.14) ÷ 2 = +2.18
  assert("potato (no market): approved by hand at the suggested 26.50, and ONE confirmation says so — with its profit, and «متوسط الربح للكرتون: +2.18»", r1.action === "decided" && conf.startsWith("✅ سُجّلت قراراتك") && conf.includes("سيُنشر 06:00:") && conf.split("\n").includes("• بطاطس — 26.50 ر.س (المقترح) · ربحنا +2.14") && conf.split("\n").includes("متوسط الربح للكرتون: +2.18") && p1.x_decision === "profit" && p1.x_manual_price === 26.5 && p1.x_manual_for === "profit" && p1.x_status === "manual" && p1.x_sale_price === 26.5 && p1.x_excluded === false && p1.x_reason === "براء: اعتمد بالسعر المربح" && !!p1.x_decided_at, JSON.stringify({ r1, conf, p1 }));
  assert("…its card follows at once: sale 26.50, net sale 23.04, real profit 23.04 − 20.90 = 2.14 → 🟢 (and no preview: the line is approved)", p1.x_board_sale === 26.5 && p1.x_net_sale === 23.04 && p1.x_real_profit === 2.14 && p1.x_board_status === "green" && p1.x_preview_sale === 0 && p1.x_preview_profit === 0, JSON.stringify(p1));
  // the cucumber (market 33: its goods covered, its «بدون خسارة» 33.70 not) is 🟡 on the board at its market price, and «لا تنشر»
  assert("…and the header's counts: 🟢 2 (tomato, potato) · 🟡 1 (cucumber at its market price) · ⚪ 1 (onion)", dayOf().x_n_green === 2 && dayOf().x_n_yellow === 1 && dayOf().x_n_red === 0 && dayOf().x_n_none === 1 && lineFor(2).x_board_status === "yellow" && lineFor(2).x_decision === "skip" && lineFor(2).x_status === "unpublished", JSON.stringify(dayOf()));
  const r2 = await answer({ [`d${f.item("بطاطس").slot}`]: "skip" }, "wamid.F2");
  assert("the same form answered a second time is read once → «هذا النموذج سبق اعتماده ✅», the line unchanged", r2.action === "duplicate" && ownerTexts().at(-1) === PRV.REVIEW_FORM_USED_TEXT && lineFor(3).x_decision === "profit" && lineFor(3).x_sale_price === 26.5, JSON.stringify(r2));
  table("x_operating_cost").forEach((r: any) => { r.x_amount = 1000; });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const p2 = lineFor(3);
  assert("the cost rises (the suggested price becomes 29.00): his decided 26.50 stays the sale price", p2.x_status === "manual" && p2.x_sale_price === 26.5 && p2.x_suggested_price === 29 && p2.x_manual_price === 26.5, JSON.stringify(p2));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // through /webhook: a tap on «✅ نفّذ المقترح» («✅ اعتمد الكل كما هو» before § 55) arrives as a button_reply
  const env = fourCases();
  await quiet(() => PR.refreshPriceDay(env));
  await notify(env);
  const before = { c: lineFor(2), p: lineFor(3) };
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `prv_a_${dayOf().id}_1`, title: PRV.REVIEW_BUTTON_ALL } } })), env, harnessCtx));
  const t1 = lineFor(1), c1 = lineFor(2), p1 = lineFor(3), o1 = lineFor(4);
  const conf = ownerTexts().find((x) => x.startsWith("✅ سُجّلت قراراتك")) ?? "";
  assert("through /webhook: «✅ نفّذ المقترح» → every line takes its proposed decision — potato approved at its suggested price, tomato at the market 29, cucumber and onion «لا تنشر»",
    p1.x_decision === "profit" && p1.x_status === "manual" && p1.x_sale_price === p1.x_manual_price && p1.x_sale_price === before.p.x_suggested_price && t1.x_decision === "market" && t1.x_sale_price === 29 && c1.x_decision === "skip" && c1.x_sale_price === 0 && o1.x_decision === "skip", JSON.stringify({ t1, c1, p1, o1 }));
  assert("…and ONE confirmation: what will be published at 06:00 — each with its profit, then «متوسط الربح للكرتون: +2.18» — and what will not",
    sentTo(OWNER).length === 1 && conf === "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.\nسيُنشر 06:00:\n• طماطم — 29 ر.س (سعر السوق) · ربحنا +2.22\n• بطاطس — 26.50 ر.س (المقترح) · ربحنا +2.14\nمتوسط الربح للكرتون: +2.18\nلا يُنشر: خيار، بصل.", JSON.stringify(ownerTexts()));
  // a per-item exception message of before § 54 may still sit in his chat: its list row decides nothing
  const kept = JSON.stringify(lineFor(2));
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "list_reply", list_reply: { id: `pexc_p_${before.c.id}`, title: "اعتمد بالسعر المربح" } } })), env, harnessCtx));
  assert("through /webhook: the list row «اعتمد بالسعر المربح» of an exception message of before § 54 decides nothing — one line says where the decision is taken now", JSON.stringify(lineFor(2)) === kept && sentTo(OWNER).length === 1 && ownerTexts()[0] === PR.OLD_EXCEPTION_TEXT, JSON.stringify(ownerTexts()));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 04:00`);                       // no cost line → no carton share → no suggested price
  seed("x_operating_cost", { x_name: "صيانة", x_cost_type: "fixed", x_frequency: "monthly", x_amount: 2600, x_date_from: "2026-01-01", x_date_to: false, x_utak_simulation: false });
  table("hr.employee").forEach((e: any) => { e.resource_calendar_id = false; });
  dp(3, 31, 18);
  await quiet(() => PR.refreshPriceDay(env));
  await notify(env);
  const p = lineFor(3);
  const f = await openForm(env), po = f.item("بطاطس");
  // § 55 — no market price and no suggested one: the purchase price (18 → 20.70 «شامل») and no «ربحنا» to show on the line, and the form says «لا سعر مقترح» (it was «… مقترح —»)
  assert("the day's cost «تعذّر»: no suggested price on the line, so no «بالمقترح» — proposed «لا تنشر» («❌ بطاطس — شراء 18 (20.70 شامل) · لا سعر سوق ← لا تنشر»), the choices «لا تنشر» / «سعر يدوي», the form's lines «شراء 18 (20.70 شامل) · لا سعر سوق» and «لا سعر مقترح»", p.x_suggested_price === 0 && reviewLines().includes("❌ بطاطس — شراء 18 (20.70 شامل) · لا سعر سوق ← لا تنشر")
    && JSON.stringify(optionIds(f.data[`o${po.slot}`])) === JSON.stringify(["skip", "manual"]) && f.data[`x${po.slot}`] === "شراء 18 (20.70 شامل) · لا سعر سوق" && f.data[`y${po.slot}`] === "لا سعر مقترح", JSON.stringify([p, f.data[`o${po.slot}`], f.data[`x${po.slot}`], f.data[`y${po.slot}`], reviewText()]));
  const r = await quiet(() => PRV.handlePriceReviewButton(env, `prv_a_${dayOf().id}_1`));
  assert("…and «✅ نفّذ المقترح» approves nothing for it (never a guessed price): «لا تنشر», sale 0", /^all:/.test(r) && lineFor(3).x_decision === "skip" && lineFor(3).x_sale_price === 0 && lineFor(3).x_status === "unpublished" && (ownerTexts().at(-1) ?? "").includes("لا صنف للنشر اليوم."), JSON.stringify({ r, l: lineFor(3), t: ownerTexts().at(-1) }));
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
  const pubMsg = ownerTexts().filter((x) => x.startsWith("📢 نُشرت أسعار"));
  assert("…the undecided exceptions (cucumber, onion) are not published, as before, and the publication's ONE message to Baraa names each with its reason (§ 54 د: no second «⏰ لم يُنشر» alert)", !/خيار|بصل/.test(list) && lineFor(2).x_status === "unpublished" && /استثناء بلا قرار عند النشر/.test(String(lineFor(2).x_reason))
    && pubMsg.length === 1 && pubMsg[0].includes("لم يُنشر (2): خيار (خسارة: السوق 33 أقل من 33.70، وبلا قرار)، بصل (لا سعر شراء).") && !ownerTexts().some((x) => x.startsWith("⏰ لم يُنشر")), JSON.stringify(ownerTexts().slice(-3)));
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
  assert("…and nothing is sent by a recompute (no review message outside 04:00–06:00, no publication)", graph.length === 0 && heldFor(env, OWNER).length === 0);
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
  // § 54 — the decision is the review's (prv_…); an old pexc_ tap (a reply button or a list row) is still recognised, and only answered
  assert("the owner's branch routes prv_ (the review's buttons) to the price decision, and answers an old pexc_p_ tap with OLD_EXCEPTION_TEXT", /\/\^prvt\?_\[arn\]_\\d\+_\\d\+\$\/\.test\(msg\.buttonId/.test(idx) && /handlePriceReviewButton\(env, msg\.buttonId!/.test(idx) && PRV.REVIEW_PAYLOAD.test("prv_a_50_1") && !PRV.REVIEW_PAYLOAD.test("prv_x_50_1")
    && /\/\^pexc_\[mspe\]_\\d\+\$\/\.test\(msg\.buttonId/.test(idx) && /sendText\(env, msg\.from, OLD_EXCEPTION_TEXT/.test(idx) && !/handlePriceExceptionButton/.test(idx) && PR.PRICE_EXCEPTION_PAYLOAD.test("pexc_p_12") && !PR.PRICE_EXCEPTION_PAYLOAD.test("pexc_x_12"));
  const views = readFileSync(new URL("../scripts/lib/s47-odoo-views.mjs", import.meta.url), "utf8");
  assert("the board's card and list show the two numbers, the settings form «الهامش الأدنى ٪» beside «نسبة التالف»",
    /أقل سعر بيع بدون خسارة<\/span><field name="x_break_even"\/>/.test(views) && /السعر المربح المقترح<\/span><field name="x_suggested_price"\/>/.test(views)
    && /<field name="x_break_even"\/>\n  <field name="x_suggested_price"\/>/.test(views) && /<field name="x_waste_pct"\/>`;[\s\S]*<field name="x_min_margin_pct"\/>/.test(views));
  const pa = readFileSync(new URL("../src/purchase-accounting.ts", import.meta.url), "utf8");
  assert("the bill's tax is resolved price-excluded, and no price-included twin is searched any more", /resolveCompanyPurchaseTaxExcluded\(env\)/.test(pa) && !/tax_included/.test(pa.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
}

done();
