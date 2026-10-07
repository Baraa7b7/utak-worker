// § 40 ج (2026-09-26) — the pricing engine v1: the rules, and the day's inputs.
//
// For every active product (active, for sale, x_is_active_for_sale) and
// packaging, on the Riyadh day:
//   • purchase price = the lowest valid purchase price of the day from any
//     source (a supplier's x_daily_price row, or a source's x_price_offer);
//   • market price  = the median of the day's market observations from every
//     source (one is enough; nothing carried over from yesterday);
//   • sale price    = the market price, exactly (delivery is free, inside it);
//   • unit profit   = market − purchase − (waste % × purchase); from the VAT
//     cutoff (§ 41 أ, the price day ≥ 2026-10-01) the sale price is
//     VAT-inclusive: sale ÷ 1.15 − purchase − waste.
//
// § 47 أ (2026-10-01) — EVERY PURCHASE PRICE IS NET OF VAT, whoever the source
// and whether or not it is registered (Ahmed's offer, a row typed in Odoo, a
// WhatsApp reply, Omar's «شراء»): the number is used as it is, never divided
// by 1.15, and «the lowest offer» compares the numbers as they are. A
// registered supplier's 15 % is added on his bill (src/purchase-accounting.ts)
// and recovered; an unregistered one adds none: the net cost is the same.
//
// § 47 ب — the profitable price (priceFloor), from the purchase alone:
//   • full cost      = net purchase + waste + the carton's share of the day's
//     operating cost (src/pricing-board.ts);
//   • «أقل سعر بيع بدون خسارة» = full cost × 1.15 (VAT-inclusive);
//   • «السعر المربح المقترح»   = (full cost + «الربح الأدنى للكرتون») × 1.15,
//     rounded UP to the nearest 0.5 riyal (VAT-inclusive). § 48 أ: the minimum
//     profit is a fixed amount in riyals a carton (2 on the settings record),
//     no longer a percentage of the cost («الهامش الأدنى ٪» is read nowhere).
// The rule of a line:
//   1. market ≥ the suggested price → approved automatically at the market
//      price, as before;
//   2. a market price below the suggested one → an exception: Baraa chooses
//      «اعتمد بالسعر المربح», «اعتمد بسعر السوق», «لا تنشر» or «عدّل»;
//   3. no market price, a purchase price → an exception carrying the
//      suggested price: «اعتمد بالسعر المربح», «لا تنشر» or «عدّل»;
//   4. no purchase price → an exception, as before.
// An outlier (PRICE_OUTLIER_RATIO, § 26) on the purchase price used or on a
// market observation stays an exception. An exception without a decision by
// the publication time is not published. When the carton share cannot be read
// (the day's cost «تعذّر», or «الكراتين المتوقعة» empty) there is no suggested
// price: the rule before § 47 stands (an exception when the unit profit ≤ 0).
//
// § 49 د — «دور الأسعار»: «أقل عرض» is computed from the «شراء» sources alone. A
// source whose role is «سوق» sends market observations only (src/price-sources.ts),
// and a purchase price on one of his rows is never a purchase offer.
//
// § 53 ب — «زيادة على سعر السوق ٪» (x_pricing_config.x_market_uplift_pct, 0 by
// default): the sale price = the market price × (1 + the uplift ÷ 100), rounded
// UP to the nearest 0.5 riyal (market 30, uplift 3 % → 30.90 → 31). Every
// comparison of the rule — the suggested price, the unit profit, the exception
// — is made on the price AFTER the uplift, and «اعتمد بسعر السوق» approves that
// price. With an uplift of 0 nothing is rounded and nothing changes: the sale
// price is the market price, exactly.
//
// § 54 أ (2026-10-05) — «القرار المقترح» of a line (proposeDecision), one rule in
// this order, every comparison on the market price AFTER the uplift of § 53:
//   1. no purchase price                        → «لا تنشر»;
//   2. an outlier                               → the decision of the rules below, marked ⚠️;
//   3. no market price                          → «انشر بالمقترح»;
//   4. market < «أقل سعر بيع بدون خسارة»        → «لا تنشر (خسارة)»;
//   5. «بدون خسارة» ≤ market < the suggested    → «انشر بسعر السوق»;
//   6. market ≥ the suggested price             → by the setting «لما يكون السوق أعلى من
//      المقترح» (x_pricing_config.x_above_suggested): «بسعر السوق» (the default) or
//      «بالمقترح» (cheaper than the market).
// Without Baraa's decision by the publication time a line is published only by
// rules 5 and 6 and without ⚠️ (its status «تلقائي»); a line with no market
// price, a loss, an outlier or no purchase price waits for him (an exception)
// and is not published. This replaces § 47's rule 2: a market price between
// «بدون خسارة» and the suggested price is no longer an exception.
//
// Only a source with «مصدر أسعار» counts (a supplier's own row: x_supplier_id
// ticked; an offer: its source partner ticked, or the Work Contact of a ticked
// employee). Offers marked x_utak_simulation are left out. Each source counts
// once per product, packaging and kind: its latest row of the day.

import type { Env } from "./config";
import { call } from "./odoo";
import type { PriceSources } from "./price-sources";

export type PriceKind = "purchase" | "market";
export interface EngineOffer {
  kind: PriceKind;
  price: number;
  outlier: boolean;
  partnerId: number;
  sourceName: string;
  productId: number;
  packagingId: number;
  /** "dp" = x_daily_price (a supplier's purchase), "po" = x_price_offer */
  model: "dp" | "po";
  rowId: number;
  /** § 48 ب — a "dp" row's stored fallback sale price (x_sale_price), kept = the suggested price of its purchase price by the engine. */
  saleStored?: number;
}
export interface EngineItem {
  productId: number;
  productName: string;
  packagingId: number;
  packagingName: string;
}
/** § 54 أ — «loss»: the market price (after the uplift) below «أقل سعر بيع بدون خسارة». */
export type ExceptionCode = "no_purchase" | "no_market" | "no_profit" | "loss" | "outlier";
export interface PricingLine extends EngineItem {
  key: string;
  purchase: number | null;
  purchaseOffer: EngineOffer | null;
  market: number | null;
  marketCount: number;
  outlier: { purchase: boolean; market: boolean };
  /** The sale price of the rule: the market price after «زيادة على سعر السوق ٪» (§ 53 ب); the market price itself at 0. */
  sale: number | null;
  /** § 53 ب — the uplift the sale price was made with (0 = none). */
  upliftPct: number;
  unitProfit: number | null;
  displayMargin: number | null;
  /** § 47 ب — net purchase + waste + the carton share; null without a purchase price. */
  fullCost: number | null;
  /** «أقل سعر بيع بدون خسارة» (VAT-inclusive); null without a purchase price or a carton share. */
  breakEven: number | null;
  /** «السعر المربح المقترح» (VAT-inclusive, rounded up to 0.5); null without a purchase price or a carton share. */
  suggested: number | null;
  exceptions: ExceptionCode[];
  reason: string;
  offersText: string;
  /** § 54 أ — «القرار المقترح»: what the rule would publish, and whether it does so without Baraa. */
  proposal: Proposal;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (x: number) => { const n = round2(x); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

/** The median of the values (the mean of the two middle ones for an even count), two decimals. */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

/** market − purchase − waste % × purchase, two decimals. */
export function unitProfit(market: number, purchase: number, wastePct: number): number {
  return round2(market - purchase - (wastePct / 100) * purchase);
}

/**
 * § 41 أ — the VAT inside the profit; § 47 أ — the purchase price is net.
 * `vatRatePct` is 15 from the cutoff, null before it (then this is unitProfit
 * exactly). The sale price is VAT-inclusive, the purchase price is NET of VAT
 * whoever the source: sale ÷ 1.15 − purchase − waste (waste = waste % ×
 * purchase). Unrounded: the order and the day sum it before rounding.
 */
export function vatProfit(sale: number, purchase: number, wastePct: number, vatRatePct: number | null): number {
  const waste = (wastePct / 100) * purchase;
  return (vatRatePct ? sale / (1 + vatRatePct / 100) : sale) - purchase - waste;
}

/** The VAT context of a pricing day: the rate (null before the cutoff). */
export interface VatContext { ratePct: number | null }
export const NO_VAT: VatContext = { ratePct: null };

// ---------------------------------------------------------------- the profitable price (§ 47 ب)

/** § 48 أ — «الربح الأدنى للكرتون (ريال)» when the settings record carries none. */
export const DEFAULT_MIN_PROFIT_SAR = 2;
/** The suggested price is rounded up to this step (riyals). */
export const SUGGESTED_STEP = 0.5;

/** An amount in whole halalas, half up (float noise removed first: 1.005 → 101). */
const halalas = (x: number): number => Math.round(Math.round((Number(x) || 0) * 1e6) / 1e4);

/** Up to the nearest SUGGESTED_STEP (a float's noise above a step does not push it to the next). */
export function ceilToStep(x: number, step: number = SUGGESTED_STEP): number {
  return round2(Math.ceil(x / step - 1e-6) * step);
}

/** § 53 ب — «زيادة على سعر السوق ٪» as the rule reads it: a number above zero, else 0 (no uplift). */
export function upliftOf(pct: unknown): number {
  const n = Number(pct);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * § 53 ب — the sale price of a market price: market × (1 + uplift ÷ 100), UP to
 * the nearest 0.5 riyal. No uplift (0, empty, negative): the market price as it
 * is — nothing is rounded. Pure.
 */
export function upliftedSale(market: number, upliftPct: unknown): number {
  const pct = upliftOf(upliftPct);
  if (!(pct > 0) || !(market > 0)) return market;
  // whole halalas first: 30 × 1.03 is 30.900000000000002 in a float
  return ceilToStep(halalas(market * (1 + pct / 100)) / 100);
}

export interface PriceFloor {
  /** The purchase price as it is: it is net of VAT. */
  netPurchase: number;
  waste: number;
  /** net purchase + waste + the carton share (0 when the share cannot be read). */
  fullCost: number;
  /** full cost × 1.15; null when the carton share cannot be read. */
  breakEven: number | null;
  /** (full cost + the minimum profit a carton) × 1.15, rounded up to 0.5; null when the carton share cannot be read. */
  suggested: number | null;
}

/**
 * What a purchase price must sell for. Each amount is rounded to two decimals
 * as the board shows it (whole halalas, half up), and the next is made from
 * the rounded one. Null without a purchase price. Pure.
 */
export function priceFloor(a: { purchase: number | null; wastePct: number; opShare: number | null; vatRatePct: number | null; minProfit: number }): PriceFloor | null {
  if (a.purchase === null || !(a.purchase > 0)) return null;
  const netH = halalas(a.purchase);
  const wasteH = Math.round((netH * Math.max(0, a.wastePct)) / 100);
  const fullH = netH + wasteH + (a.opShare !== null ? halalas(a.opShare) : 0);
  const base = { netPurchase: netH / 100, waste: wasteH / 100, fullCost: fullH / 100 };
  if (a.opShare === null) return { ...base, breakEven: null, suggested: null };
  const vat = a.vatRatePct ? 100 + a.vatRatePct : 100;
  return {
    ...base,
    breakEven: Math.round((fullH * vat) / 100) / 100,
    // § 48 أ — a fixed profit in riyals on top of the full cost, then the VAT
    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),
  };
}

/** The inputs of the profitable price on a day: the carton share (null = it cannot be read) and «الربح الأدنى للكرتون» (riyals). */
export interface FloorContext { opShare: number | null; minProfit: number }
export const NO_FLOOR: FloorContext = { opShare: null, minProfit: DEFAULT_MIN_PROFIT_SAR };

/** For display only: (market − purchase) ÷ purchase × 100 (= the Odoo compute of product.template.x_margin_view). */
export function displayMarginPct(purchase: number, market: number): number {
  return purchase > 0 && market > 0 ? round2(((market - purchase) / purchase) * 100) : 0;
}

// ---------------------------------------------------------------- the proposed decision (§ 54 أ)

/** «لما يكون السوق أعلى من المقترح» (x_pricing_config.x_above_suggested): «بسعر السوق» or «بالمقترح». */
export type AboveSuggested = "market" | "suggested";
export const ABOVE_SUGGESTED_DEFAULT: AboveSuggested = "market";
/** The setting as the rule reads it: «suggested» alone changes the rule; anything else is the default. */
export function aboveSuggestedOf(v: unknown): AboveSuggested {
  return v === "suggested" ? "suggested" : ABOVE_SUGGESTED_DEFAULT;
}

/** The proposed decision, in x_decision's own words: «انشر بسعر السوق», «انشر بالمقترح», «لا تنشر». */
export type ProposalKind = "market" | "profit" | "skip";
export type ProposalWhy = "no_purchase" | "no_market" | "no_price" | "loss" | "below_suggested" | "above_suggested";
export interface Proposal {
  kind: ProposalKind;
  /** The price it would publish at (0 for «لا تنشر»). */
  price: number;
  why: ProposalWhy;
  /** Rule 2 — an outlier price: the same decision, marked ⚠️, never published without Baraa. */
  outlier: boolean;
  /** Published at the publication time without a decision (rules 5 and 6, no ⚠️). */
  auto: boolean;
}

/**
 * § 54 أ — the rule, for one line. `sale` is the market price AFTER the uplift
 * (null / 0 = no market price); `breakEven` and `suggested` are null when the
 * carton share cannot be read (then the rule before § 47: a market price is
 * published unless the unit profit is not above zero, and there is no suggested
 * price to publish a line without a market price at). Pure.
 */
export function proposeDecision(i: { purchase: number | null; sale: number | null; breakEven: number | null; suggested: number | null; unitProfit: number | null; outlier: boolean }, above: AboveSuggested = ABOVE_SUGGESTED_DEFAULT): Proposal {
  const outlier = i.outlier === true;
  const skip = (why: ProposalWhy): Proposal => ({ kind: "skip", price: 0, why, outlier, auto: false });
  const suggested = i.suggested !== null && i.suggested > 0 ? round2(i.suggested) : 0;
  // 1 — no purchase price: nothing to sell from
  if (i.purchase === null || !(i.purchase > 0)) return skip("no_purchase");
  // 3 — no market price: the suggested price, by Baraa's word alone
  if (i.sale === null || !(i.sale > 0)) return suggested > 0 ? { kind: "profit", price: suggested, why: "no_market", outlier, auto: false } : skip("no_price");
  const sale = round2(i.sale);
  // 4 — below «بدون خسارة» (no carton share: a unit profit that is not above zero)
  if (i.breakEven !== null && i.breakEven > 0 ? sale < i.breakEven - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip("loss");
  // 6 — the market reaches the suggested price: the setting decides
  if (suggested > 0 && sale >= suggested - 0.0001) {
    return above === "suggested" ? { kind: "profit", price: suggested, why: "above_suggested", outlier, auto: !outlier }
      : { kind: "market", price: sale, why: "above_suggested", outlier, auto: !outlier };
  }
  // 5 — between «بدون خسارة» and the suggested price: the market price
  return { kind: "market", price: sale, why: "below_suggested", outlier, auto: !outlier };
}

/** Each source's latest row of the day, per product, packaging and kind. */
export function latestPerSource(offers: EngineOffer[]): EngineOffer[] {
  const best = new Map<string, EngineOffer>();
  for (const o of offers) {
    if (!(o.price > 0)) continue;
    const k = `${o.model}:${o.partnerId}:${o.productId}:${o.packagingId}:${o.kind}`;
    const cur = best.get(k);
    if (!cur || o.rowId > cur.rowId) best.set(k, o);
  }
  return [...best.values()];
}

const REASON: Record<ExceptionCode, string> = {
  no_purchase: "لا سعر شراء",
  no_market: "لا سعر سوق",
  no_profit: "ربح الوحدة ≤ 0",
  loss: "سعر السوق أقل من سعر بدون خسارة",
  outlier: "سعر شاذ",
};

/** «أحمد حسان: شراء 20 · عمر: سوق 24 (شاذ)», purchases first, cheapest first. */
export function offersLine(offers: EngineOffer[]): string {
  return [...offers].sort((a, b) => (a.kind === b.kind ? a.price - b.price : a.kind === "purchase" ? -1 : 1))
    .map((o) => `${o.sourceName}: ${o.kind === "purchase" ? "شراء" : "سوق"} ${money(o.price)}${o.outlier ? " (شاذ)" : ""}`).join(" · ");
}

/** «سعر السوق 28»; with an uplift «سعر السوق 28 بعد الزيادة 3٪ = 29». */
function marketLead(market: number, sale: number, upliftPct: number): string {
  return upliftPct > 0 ? `سعر السوق ${money(market)} بعد الزيادة ${money(upliftPct)}٪ = ${money(sale)}` : `سعر السوق ${money(market)}`;
}

/**
 * The rule, for every item. Pure. `vat` (§ 41 أ): the unit profit net of VAT
 * from the cutoff. `floor` (§ 47 ب, § 48 أ): the carton share and the minimum
 * profit a carton the suggested price is made from; without a share the rule
 * before § 47. `upliftPct` (§ 53 ب): «زيادة على سعر السوق ٪», 0 = the sale price
 * is the market price as it is. `above` (§ 54 أ): «لما يكون السوق أعلى من المقترح».
 */
export function computePricing(items: EngineItem[], offers: EngineOffer[], wastePct: number, vat: VatContext = NO_VAT, floor: FloorContext = NO_FLOOR, upliftPct: number = 0, above: AboveSuggested = ABOVE_SUGGESTED_DEFAULT): PricingLine[] {
  const latest = latestPerSource(offers);
  const uplift = upliftOf(upliftPct);
  return items.map((it) => {
    const its = latest.filter((o) => o.productId === it.productId && o.packagingId === it.packagingId);
    // § 47 أ — the lowest offer: the numbers as they are (every one is net of VAT)
    const purchases = its.filter((o) => o.kind === "purchase").sort((a, b) => a.price - b.price || a.rowId - b.rowId);
    const markets = its.filter((o) => o.kind === "market");
    const p = purchases[0] ?? null;
    const purchase = p?.price ?? null;
    const market = median(markets.map((o) => o.price));
    // § 53 ب — the sale price: the market price after the uplift (the market price itself at 0)
    const sale = market !== null ? upliftedSale(market, uplift) : null;
    const profit = purchase !== null && sale !== null
      ? round2(vatProfit(sale, purchase, wastePct, vat.ratePct)) : null;
    const fl = priceFloor({ purchase, wastePct, opShare: floor.opShare, vatRatePct: vat.ratePct, minProfit: floor.minProfit });
    const suggested = fl?.suggested ?? null;
    const breakEven = fl?.breakEven ?? null;
    const outlier = { purchase: !!p?.outlier, market: markets.some((o) => o.outlier) };
    // § 54 أ — the proposed decision of the line, and whether it is published without Baraa
    const proposal = proposeDecision({ purchase, sale, breakEven, suggested, unitProfit: profit, outlier: outlier.purchase || outlier.market }, above);
    const exceptions: ExceptionCode[] = [];
    if (purchase === null) exceptions.push("no_purchase");
    if (market === null) exceptions.push("no_market");
    if (purchase !== null && sale !== null) {
      // § 54 أ — a loss = the market price (§ 53 ب: after the uplift) below «أقل سعر بيع بدون خسارة»
      if (breakEven !== null) { if (sale < breakEven - 0.0001) exceptions.push("loss"); }
      else if (profit !== null && profit <= 0) exceptions.push("no_profit");
    }
    if (outlier.purchase || outlier.market) exceptions.push("outlier");
    const reason = exceptions.map((c) => c === "no_profit" ? `${REASON[c]} (${money(profit as number)})`
      : c === "loss" ? `${marketLead(market as number, sale as number, uplift)} أقل من سعر بدون خسارة ${money(breakEven as number)}`
      : c === "outlier" ? `${REASON[c]}: ${[outlier.purchase ? "الشراء" : "", outlier.market ? "السوق" : ""].filter(Boolean).join(" و")}` : REASON[c]).join("، ");
    return {
      ...it,
      key: `${it.productId}:${it.packagingId}`,
      purchase, purchaseOffer: p, market, marketCount: markets.length, outlier,
      sale, upliftPct: uplift,
      unitProfit: profit,
      displayMargin: purchase !== null && sale !== null ? displayMarginPct(purchase, sale) : null,
      fullCost: fl?.fullCost ?? null, breakEven, suggested,
      exceptions, reason,
      offersText: offersLine(its),
      proposal,
    };
  });
}

// ---------------------------------------------------------------- the status of a line

export type LineStatus = "auto" | "exception" | "manual" | "unpublished";
export type Decision = "market" | "skip" | "edit" | "profit";
export interface LineVerdict { status: LineStatus; sale: number; excluded: boolean; reason: string }
/** «السبب» of a line Baraa decided: the engine and the day's review (src/price-review.ts) write the same words. */
export const DECISION_REASON: Readonly<Record<Decision, string>> = {
  market: "براء: اعتمد بسعر السوق", profit: "براء: اعتمد بالسعر المربح", edit: "براء: سعر معدّل", skip: "براء: لا تنشر",
};

/**
 * The line's status from the rule and Baraa's decision: «لا تنشر» → not
 * published; «اعتمد بسعر السوق» → approved at the market price (the one he saw
 * when he decided, else today's); «اعتمد بالسعر المربح» (§ 47 ب) → approved at
 * the suggested price (the one he saw, else today's); «سعر معدّل» → approved
 * at his price (a positive number); no decision → automatic, or an exception.
 * § 54 أ — automatic = the proposed decision of rules 5 and 6: the market price,
 * or — «لما يكون السوق أعلى من المقترح» = «بالمقترح» — the suggested price.
 */
export function lineVerdict(p: PricingLine, decision: Decision | null, manualPrice: number): LineVerdict {
  if (decision === "skip") return { status: "unpublished", sale: 0, excluded: true, reason: DECISION_REASON.skip };
  if (decision === "market") {
    // § 53 ب — «سعر السوق» of the decision is the rule's sale price: the market price after the uplift
    const price = manualPrice > 0 ? manualPrice : p.sale ?? 0;
    if (price > 0) return { status: "manual", sale: round2(price), excluded: false, reason: DECISION_REASON.market };
  }
  if (decision === "profit") {
    const price = manualPrice > 0 ? manualPrice : p.suggested ?? 0;
    if (price > 0) return { status: "manual", sale: round2(price), excluded: false, reason: DECISION_REASON.profit };
  }
  if (decision === "edit" && manualPrice > 0) return { status: "manual", sale: round2(manualPrice), excluded: false, reason: DECISION_REASON.edit };
  if (!p.proposal.auto) return { status: "exception", sale: 0, excluded: true, reason: p.reason };
  // § 54 أ — rule 6 by the setting «بالمقترح»: the line says why it sells below the market
  const cheaper = p.proposal.kind === "profit";
  return { status: "auto", sale: round2(p.proposal.price), excluded: false, reason: cheaper ? aboveSuggestedReason(p.sale as number, p.proposal.price) : "" };
}

/** «السوق 75 أعلى من المقترح 71.50: يُنشر بالمقترح (الإعدادات)» — the reason of an automatic line sold at the suggested price. */
export function aboveSuggestedReason(sale: number, suggested: number): string {
  return `السوق ${money(sale)} أعلى من المقترح ${money(suggested)}: يُنشر بالمقترح (الإعدادات)`;
}

/**
 * § 48 د — the price fixed for the line's decision. «سعر معدّل»: his own number.
 * «اعتمد بسعر السوق» / «اعتمد بالسعر المربح»: the price fixed when that decision
 * was taken counts for THAT decision alone (x_manual_for; empty = fixed before
 * § 48, taken as the decision's) — a decision changed in Odoo afterwards does
 * not inherit the other decision's price. 0 = none.
 */
export function fixedPrice(l: { x_decision?: string | false; x_manual_price?: number; x_manual_for?: string | false }): number {
  const price = Number(l.x_manual_price) || 0;
  if (!(price > 0)) return 0;
  if (l.x_decision === "market" || l.x_decision === "profit") return !l.x_manual_for || l.x_manual_for === l.x_decision ? price : 0;
  return price;
}

/**
 * The sale price a stored line must carry (the publication checks it): auto →
 * market; manual → the decided price, else — «اعتمد بالسعر المربح» chosen in
 * Odoo without a price — the line's suggested price, else the market price.
 * § 53 ب — «market» here is the market price after the line's uplift.
 */
export function saleRule(l: { x_status: string | false; x_market_price: number; x_manual_price: number; x_decision?: string | false; x_suggested_price?: number; x_manual_for?: string | false; x_uplift_pct?: number | false }): number {
  if (l.x_status === "auto") return round2(marketSale(l));
  if (l.x_status === "manual") {
    const fixed = fixedPrice(l);
    if (fixed > 0) return round2(fixed);
    if (l.x_decision === "profit") return round2(Number(l.x_suggested_price) || 0);
    return round2(marketSale(l));
  }
  return 0;
}

/**
 * § 54 أ — is the stored sale price the one a rule gives the line? As saleRule,
 * and for an automatic line also its suggested price while the market price
 * reaches it (rule 6 with «بالمقترح»). The publication checks every line by it.
 */
export function saleMatchesRule(l: Parameters<typeof saleRule>[0] & { x_sale_price: number }): boolean {
  const sale = Number(l.x_sale_price) || 0;
  if (Math.abs(sale - saleRule(l)) <= 0.005) return true;
  if (l.x_status !== "auto") return false;
  const suggested = round2(Number(l.x_suggested_price) || 0);
  return suggested > 0 && marketSale(l) >= suggested - 0.0001 && Math.abs(sale - suggested) <= 0.005;
}

/**
 * § 53 ب — what a stored line sells for at «سعر السوق»: its market price after
 * the uplift the engine wrote on it (x_uplift_pct «زيادة السوق ٪»; 0 or empty =
 * the market price as it is). 0 = no market price.
 */
export function marketSale(l: { x_market_price: number; x_uplift_pct?: number | false }): number {
  const market = Number(l.x_market_price) || 0;
  return market > 0 ? upliftedSale(market, l.x_uplift_pct) : 0;
}

// ---------------------------------------------------------------- Odoo reads

type M2O = [number, string] | false;
const m2o = (v: M2O | number | undefined): [number, string] => Array.isArray(v) ? v : typeof v === "number" ? [v, String(v)] : [0, ""];

/** The day's offers of the sources (x_daily_price of ticked suppliers, x_price_offer of ticked sources), simulation left out. */
export async function readDayOffers(env: Env, day: string, sources: PriceSources): Promise<EngineOffer[]> {
  const ids = [...sources.partnerIds];
  if (!ids.length) return [];
  const names = new Map<number, string>([
    ...sources.partners.map((p) => [p.partnerId, p.name] as [number, string]),
    ...sources.employees.map((e) => [e.partnerId, e.name] as [number, string]),
  ]);
  const dp = await call<Array<{ id: number; x_supplier_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_price_sar: number; x_sale_price?: number | false; x_extraction_status: string | false }>>(env, "x_daily_price", "search_read", {
    domain: [["x_date", "=", day], ["x_price_sar", ">", 0], ["x_extraction_status", "!=", "failed"], ["x_supplier_id", "in", ids], ["x_utak_simulation", "!=", true]],
    fields: ["id", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_sale_price", "x_extraction_status"],
    order: "id asc", limit: 2000,
  });
  const po = await call<Array<{ id: number; x_source_partner_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_purchase_price: number; x_market_price: number; x_purchase_outlier: boolean; x_market_outlier: boolean }>>(env, "x_price_offer", "search_read", {
    // § 62 ب — an observation of a special request («خاص») is no offer of the day: its price is a kilo's, for that request alone
    domain: [["x_date", "=", day], ["x_utak_simulation", "!=", true], ["x_special", "!=", true], ["x_source_partner_id", "in", ids]],
    fields: ["id", "x_source_partner_id", "x_product_tmpl_id", "x_packaging_id", "x_purchase_price", "x_market_price", "x_purchase_outlier", "x_market_outlier"],
    order: "id asc", limit: 2000,
  });
  // § 49 د — «أقل عرض» counts the «شراء» sources alone: a source whose role is «سوق» gives market
  // observations only, so no row of his is a purchase offer (a source without a role: as before).
  const { marketOnlyPartners } = await import("./price-sources");
  const marketOnly = marketOnlyPartners(sources);
  const out: EngineOffer[] = [];
  for (const r of dp) {
    const [pid, pname] = m2o(r.x_supplier_id);
    if (marketOnly.has(pid)) continue;
    out.push({ kind: "purchase", price: Number(r.x_price_sar), outlier: r.x_extraction_status === "pending", partnerId: pid, sourceName: names.get(pid) ?? pname,
      productId: m2o(r.x_product_tmpl_id)[0], packagingId: m2o(r.x_packaging_id)[0], model: "dp", rowId: r.id, saleStored: Number(r.x_sale_price) || 0 });
  }
  for (const r of po) {
    const [pid, pname] = m2o(r.x_source_partner_id);
    const base = { partnerId: pid, sourceName: names.get(pid) ?? pname, productId: m2o(r.x_product_tmpl_id)[0], packagingId: m2o(r.x_packaging_id)[0], model: "po" as const, rowId: r.id };
    if (Number(r.x_purchase_price) > 0 && !marketOnly.has(pid)) out.push({ ...base, kind: "purchase", price: Number(r.x_purchase_price), outlier: r.x_purchase_outlier === true });
    if (Number(r.x_market_price) > 0) out.push({ ...base, kind: "market", price: Number(r.x_market_price), outlier: r.x_market_outlier === true });
  }
  return out;
}

/**
 * The active products and their packagings: every packaging an offer names
 * today, else the default packaging (x_is_default, else the first) — so an
 * active product nobody priced still gets its line (an exception).
 */
export async function readActiveItems(env: Env, offers: EngineOffer[]): Promise<EngineItem[]> {
  const products = await call<Array<{ id: number; name: string }>>(env, "product.template", "search_read", {
    domain: [["active", "=", true], ["sale_ok", "=", true], ["x_is_active_for_sale", "=", true]], fields: ["id", "name"], order: "id asc", limit: 500,
  });
  if (!products.length) return [];
  const packs = await call<Array<{ id: number; x_name: string; x_product_tmpl_id: M2O; x_is_default: boolean; x_sequence: number | false }>>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", products.map((p) => p.id)]], fields: ["id", "x_name", "x_product_tmpl_id", "x_is_default", "x_sequence"], limit: 2000,
  });
  const items: EngineItem[] = [];
  for (const p of products) {
    const mine = packs.filter((k) => m2o(k.x_product_tmpl_id)[0] === p.id)
      .sort((a, b) => (Number(a.x_sequence) || 0) - (Number(b.x_sequence) || 0) || a.id - b.id);
    if (!mine.length) { console.warn(`[pricing] product ${p.id} ${p.name}: no packaging — no line`); continue; }
    const offered = new Set(offers.filter((o) => o.productId === p.id).map((o) => o.packagingId));
    const use = mine.filter((k) => offered.has(k.id));
    for (const k of use.length ? use : [mine.find((x) => x.x_is_default) ?? mine[0]]) {
      items.push({ productId: p.id, productName: p.name, packagingId: k.id, packagingName: k.x_name });
    }
  }
  return items;
}
