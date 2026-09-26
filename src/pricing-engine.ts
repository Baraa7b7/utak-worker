// § 40 ج (2026-09-26) — the pricing engine v1: the rules, and the day's inputs.
//
// For every active product (active, for sale, x_is_active_for_sale) and
// packaging, on the Riyadh day:
//   • purchase price = the lowest valid purchase price of the day from any
//     source (a supplier's x_daily_price row, or a source's x_price_offer);
//   • market price  = the median of the day's market observations from every
//     source (one is enough; nothing carried over from yesterday);
//   • sale price    = the market price, exactly (delivery is free, inside it);
//   • unit profit   = market − purchase − (waste % × purchase).
// An exception when any of: (1) no purchase price, (2) no market price,
// (3) unit profit ≤ 0, (4) an outlier (PRICE_OUTLIER_RATIO, § 26) on the
// purchase price used or on a market observation. Everything else is approved
// automatically at the market price. Baraa decides the exceptions («اعتمد
// بسعر السوق» / «لا تنشر» / «عدّل»); one without a decision by the
// publication time is not published.
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
}
export interface EngineItem {
  productId: number;
  productName: string;
  packagingId: number;
  packagingName: string;
}
export type ExceptionCode = "no_purchase" | "no_market" | "no_profit" | "outlier";
export interface PricingLine extends EngineItem {
  key: string;
  purchase: number | null;
  purchaseOffer: EngineOffer | null;
  market: number | null;
  marketCount: number;
  outlier: { purchase: boolean; market: boolean };
  sale: number | null;
  unitProfit: number | null;
  displayMargin: number | null;
  exceptions: ExceptionCode[];
  reason: string;
  offersText: string;
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

/** For display only: (market − purchase) ÷ purchase × 100 (= the Odoo compute of product.template.x_margin_view). */
export function displayMarginPct(purchase: number, market: number): number {
  return purchase > 0 && market > 0 ? round2(((market - purchase) / purchase) * 100) : 0;
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
  outlier: "سعر شاذ",
};

/** «أحمد حسان: شراء 20 · عمر: سوق 24 (شاذ)», purchases first, cheapest first. */
export function offersLine(offers: EngineOffer[]): string {
  return [...offers].sort((a, b) => (a.kind === b.kind ? a.price - b.price : a.kind === "purchase" ? -1 : 1))
    .map((o) => `${o.sourceName}: ${o.kind === "purchase" ? "شراء" : "سوق"} ${money(o.price)}${o.outlier ? " (شاذ)" : ""}`).join(" · ");
}

/** The rule, for every item. Pure. */
export function computePricing(items: EngineItem[], offers: EngineOffer[], wastePct: number): PricingLine[] {
  const latest = latestPerSource(offers);
  return items.map((it) => {
    const its = latest.filter((o) => o.productId === it.productId && o.packagingId === it.packagingId);
    const purchases = its.filter((o) => o.kind === "purchase").sort((a, b) => a.price - b.price || a.rowId - b.rowId);
    const markets = its.filter((o) => o.kind === "market");
    const p = purchases[0] ?? null;
    const purchase = p?.price ?? null;
    const market = median(markets.map((o) => o.price));
    const profit = purchase !== null && market !== null ? unitProfit(market, purchase, wastePct) : null;
    const outlier = { purchase: !!p?.outlier, market: markets.some((o) => o.outlier) };
    const exceptions: ExceptionCode[] = [];
    if (purchase === null) exceptions.push("no_purchase");
    if (market === null) exceptions.push("no_market");
    if (profit !== null && profit <= 0) exceptions.push("no_profit");
    if (outlier.purchase || outlier.market) exceptions.push("outlier");
    const reason = exceptions.map((c) => c === "no_profit" ? `${REASON[c]} (${money(profit as number)})`
      : c === "outlier" ? `${REASON[c]}: ${[outlier.purchase ? "الشراء" : "", outlier.market ? "السوق" : ""].filter(Boolean).join(" و")}` : REASON[c]).join("، ");
    return {
      ...it,
      key: `${it.productId}:${it.packagingId}`,
      purchase, purchaseOffer: p, market, marketCount: markets.length, outlier,
      sale: market,
      unitProfit: profit,
      displayMargin: purchase !== null && market !== null ? displayMarginPct(purchase, market) : null,
      exceptions, reason,
      offersText: offersLine(its),
    };
  });
}

// ---------------------------------------------------------------- the status of a line

export type LineStatus = "auto" | "exception" | "manual" | "unpublished";
export type Decision = "market" | "skip" | "edit";
export interface LineVerdict { status: LineStatus; sale: number; excluded: boolean; reason: string }

/**
 * The line's status from the rule and Baraa's decision: «لا تنشر» → not
 * published; «اعتمد بسعر السوق» → approved at the market price (the one he saw
 * when he decided, else today's); «سعر معدّل» → approved at his price (a
 * positive number); no decision → automatic, or an exception.
 */
export function lineVerdict(p: PricingLine, decision: Decision | null, manualPrice: number): LineVerdict {
  if (decision === "skip") return { status: "unpublished", sale: 0, excluded: true, reason: "براء: لا تنشر" };
  if (decision === "market") {
    const price = manualPrice > 0 ? manualPrice : p.market ?? 0;
    if (price > 0) return { status: "manual", sale: round2(price), excluded: false, reason: "براء: اعتمد بسعر السوق" };
  }
  if (decision === "edit" && manualPrice > 0) return { status: "manual", sale: round2(manualPrice), excluded: false, reason: "براء: سعر معدّل" };
  if (p.exceptions.length) return { status: "exception", sale: 0, excluded: true, reason: p.reason };
  return { status: "auto", sale: round2(p.market as number), excluded: false, reason: "" };
}

/** The sale price a stored line must carry (the publication checks it): auto → market; manual → the decided price. */
export function saleRule(l: { x_status: string | false; x_market_price: number; x_manual_price: number }): number {
  if (l.x_status === "auto") return round2(Number(l.x_market_price) || 0);
  if (l.x_status === "manual") return round2(Number(l.x_manual_price) > 0 ? Number(l.x_manual_price) : Number(l.x_market_price) || 0);
  return 0;
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
  const dp = await call<Array<{ id: number; x_supplier_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_price_sar: number; x_extraction_status: string | false }>>(env, "x_daily_price", "search_read", {
    domain: [["x_date", "=", day], ["x_price_sar", ">", 0], ["x_extraction_status", "!=", "failed"], ["x_supplier_id", "in", ids]],
    fields: ["id", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_extraction_status"],
    order: "id asc", limit: 2000,
  });
  const po = await call<Array<{ id: number; x_source_partner_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_purchase_price: number; x_market_price: number; x_purchase_outlier: boolean; x_market_outlier: boolean }>>(env, "x_price_offer", "search_read", {
    domain: [["x_date", "=", day], ["x_utak_simulation", "!=", true], ["x_source_partner_id", "in", ids]],
    fields: ["id", "x_source_partner_id", "x_product_tmpl_id", "x_packaging_id", "x_purchase_price", "x_market_price", "x_purchase_outlier", "x_market_outlier"],
    order: "id asc", limit: 2000,
  });
  const out: EngineOffer[] = [];
  for (const r of dp) {
    const [pid, pname] = m2o(r.x_supplier_id);
    out.push({ kind: "purchase", price: Number(r.x_price_sar), outlier: r.x_extraction_status === "pending", partnerId: pid, sourceName: names.get(pid) ?? pname,
      productId: m2o(r.x_product_tmpl_id)[0], packagingId: m2o(r.x_packaging_id)[0], model: "dp", rowId: r.id });
  }
  for (const r of po) {
    const [pid, pname] = m2o(r.x_source_partner_id);
    const base = { partnerId: pid, sourceName: names.get(pid) ?? pname, productId: m2o(r.x_product_tmpl_id)[0], packagingId: m2o(r.x_packaging_id)[0], model: "po" as const, rowId: r.id };
    if (Number(r.x_purchase_price) > 0) out.push({ ...base, kind: "purchase", price: Number(r.x_purchase_price), outlier: r.x_purchase_outlier === true });
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
