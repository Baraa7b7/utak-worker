// § 40 د (2026-09-26) — the quantity discount and the minimum order.
//
// The discount: the tier (x_pricing_tier, «⚙️ إعدادات التسعير») the order's
// total falls in gives the percentage; it applies to the order's total BEFORE
// VAT (prices are VAT-inclusive from 2026-10-01: the net of each line, as the
// invoice splits it). It is not applied when:
//   • no tier gives a discount for that total;
//   • «عدد المحطات اليومية المخطط» is empty (no discount at all; § 41 ب:
//     no alert about it any more — the automatic count of the stops comes
//     after the launch);
//   • the order's profit after the discount would fall below
//     daily_operating_cost(the order's day) ÷ the planned stops — the order's
//     profit = Σ (sale − purchase − waste % × purchase) × qty over its lines,
//     the purchase being the engine's for the order's day (x_price_day_line);
//     a line without one, or the day's cost unreadable → no discount (never a
//     guessed number). § 41 أ — with VAT (prices VAT-inclusive, the invoice's
//     rate) the profit is net of VAT: a line whose purchase came from a
//     registered source (x_price_day_line.x_supplier_id) ÷ 1.15, else sale ÷
//     1.15 − purchase − waste; the discount (what the customer's total drops
//     by, VAT-inclusive) is taken off BEFORE the division;
//   • ACCOUNTING_SYNC is on: the sale order has no discount line yet, so an
//     accounting invoice would not match (a prerequisite for prod).
// The quotation and the invoice compute it the same way from their own lines,
// on the order's day, so a confirmed quotation's total does not move before
// the delivery (unless a line is short).
//
// The minimum order (x_min_order_sar, 150): the order's total at the quoted
// prices, before the discount. Below it: no confirm button anywhere, and the
// customer is told «أقل طلب 150 ريال، أضف أصنافاً ليكتمل»; the order stays open.

import type { Env } from "./config";
import { call, getLatestSalePrice, getOrderForInvoicing } from "./odoo";
import { computeInclusiveTotals, isAccountingSyncEnabled, type InclusiveTotals } from "./accounting";
import { NO_VAT, vatProfit, type VatContext } from "./pricing-engine";
import { dailyOperatingCost, readPricingSettings } from "./operating-cost";
import { riyadhDateKey } from "./hours";

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (x: number) => { const n = round2(x); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

export interface Tier { id: number; from: number; to: number | null; pct: number }

/** The active tiers of the settings record. */
export async function readTiers(env: Env, configId: number): Promise<Tier[]> {
  const rows = await call<Array<{ id: number; x_amount_from: number | false; x_amount_to: number | false; x_discount_pct: number | false }>>(env, "x_pricing_tier", "search_read", {
    domain: [["x_config_id", "=", configId], ["x_active", "=", true]],
    fields: ["id", "x_amount_from", "x_amount_to", "x_discount_pct"],
    order: "x_sequence asc, x_amount_from asc, id asc",
    limit: 100,
  });
  return rows.map((r) => ({ id: r.id, from: Number(r.x_amount_from) || 0, to: Number(r.x_amount_to) > 0 ? Number(r.x_amount_to) : null, pct: Number(r.x_discount_pct) || 0 }));
}

/** The tier a total (two decimals) falls in: from ≤ total ≤ to (no «to» = no ceiling); overlapping → the highest «from». */
export function tierFor(amount: number, tiers: Tier[]): Tier | null {
  const a = round2(amount);
  return tiers.filter((t) => a >= t.from - 0.0001 && (t.to === null || a <= t.to + 0.0001)).sort((x, y) => y.from - x.from)[0] ?? null;
}

export interface PricedLine { productId: number; packagingId: number; qty: number; unit: number }
export interface DiscountResult {
  /** Σ line totals at the quoted prices (VAT-inclusive from the cutoff). */
  gross: number;
  tierPct: number;
  /** The applied percentage (0 when not applied). */
  pct: number;
  /** The discount before VAT. */
  amount: number;
  profitBefore: number | null;
  profitAfter: number | null;
  minProfit: number | null;
  applied: boolean;
  reason: string;
}

/**
 * The order's profit: Σ (sale − purchase − waste % × purchase) × qty, the
 * engine's purchase of `day`. Null if a line has none. § 41 أ — `vat`: net of
 * VAT per line by the source that won its purchase (src/pricing-engine.ts vatProfit).
 */
export async function orderProfit(env: Env, day: string, lines: PricedLine[], wastePct: number, vat: VatContext = NO_VAT): Promise<number | null> {
  const raw = await orderProfitRaw(env, day, lines, wastePct, vat);
  return raw === null ? null : round2(raw);
}

/** orderProfit before its rounding: the discount guard takes the discount off this, then rounds once. */
async function orderProfitRaw(env: Env, day: string, lines: PricedLine[], wastePct: number, vat: VatContext): Promise<number | null> {
  if (!lines.length) return 0;
  const rows = await call<Array<{ x_product_tmpl_id: [number, string] | false; x_packaging_id: [number, string] | false; x_cost_price: number | false; x_supplier_id: [number, string] | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id.x_date", "=", day], ["x_day_id.x_utak_simulation", "!=", true], ["x_product_tmpl_id", "in", [...new Set(lines.map((l) => l.productId))]], ["x_cost_price", ">", 0]],
    fields: ["x_product_tmpl_id", "x_packaging_id", "x_cost_price", "x_supplier_id"],
    limit: 1000,
  });
  const key = (r: { x_product_tmpl_id: [number, string] | false; x_packaging_id: [number, string] | false }) =>
    `${Array.isArray(r.x_product_tmpl_id) ? r.x_product_tmpl_id[0] : 0}:${Array.isArray(r.x_packaging_id) ? r.x_packaging_id[0] : 0}`;
  const cost = new Map(rows.map((r) => [key(r), { price: Number(r.x_cost_price) || 0, source: Array.isArray(r.x_supplier_id) ? r.x_supplier_id[0] : 0 }]));
  let profit = 0;
  for (const l of lines) {
    const c = cost.get(`${l.productId}:${l.packagingId}`);
    if (!(c && c.price > 0)) return null;
    profit += vatProfit(l.unit, c.price, wastePct, vat.ratePct, vat.registered(c.source)) * l.qty;
  }
  return profit;
}

/**
 * The order's discount on `day` (the order's day), from its priced lines.
 * `vatRate` is asked only when a discount may apply (null before the cutoff).
 */
export async function orderDiscount(env: Env, a: { day: string; lines: PricedLine[]; vatRate: () => Promise<number | null> }): Promise<DiscountResult> {
  const gross = round2(a.lines.reduce((s, l) => s + round2(l.unit * l.qty), 0));
  const out: DiscountResult = { gross, tierPct: 0, pct: 0, amount: 0, profitBefore: null, profitAfter: null, minProfit: null, applied: false, reason: "" };
  const settings = await readPricingSettings(env, a.day);
  if (!settings) return { ...out, reason: "لا إعداد تسعير فعّال" };
  const tier = tierFor(gross, await readTiers(env, settings.configId));
  out.tierPct = tier?.pct ?? 0;
  if (!(out.tierPct > 0)) return { ...out, reason: "لا خصم في شريحة هذا المجموع" };
  if (isAccountingSyncEnabled(env)) return { ...out, reason: "الخصم غير مربوط بأمر البيع بعد (ACCOUNTING_SYNC)" };
  if (settings.plannedStops === null) return { ...out, reason: "«عدد المحطات اليومية المخطط» فارغ" };
  const rate = await a.vatRate();
  const split = computeInclusiveTotals(a.lines.map((l) => round2(l.unit * l.qty)), rate);
  const base = rate ? split.subtotal : gross;
  const amount = round2((base * out.tierPct) / 100);
  // § 41 أ — with VAT the profit is net of it, per line by the winning source
  let vat: VatContext = NO_VAT;
  if (rate) {
    const { isSourceVatRegistered, loadPriceSources } = await import("./price-sources");
    const sources = await loadPriceSources(env);
    vat = { ratePct: rate, registered: (pid) => isSourceVatRegistered(sources, pid) };
  }
  const raw = await orderProfitRaw(env, a.day, a.lines, settings.wastePct, vat);
  if (raw === null) return { ...out, reason: "ربح الطلب لا يُقرأ (صنف بلا سعر شراء اليوم)" };
  const profit = round2(raw);
  const cost = await dailyOperatingCost(env, a.day);
  if (cost.total === null) return { ...out, profitBefore: profit, reason: `تكلفة اليوم لا تُقرأ (${cost.reason ?? "—"})` };
  const minProfit = round2(cost.total / settings.plannedStops);
  // the discount off before the division: what the customer's total drops by (VAT-inclusive) ÷ 1.15
  const after = rate
    ? round2(raw - (gross - discountedTotals(split, amount, rate).total) / (1 + rate / 100))
    : round2(raw - amount);
  if (after < minProfit) {
    return { ...out, profitBefore: profit, profitAfter: after, minProfit, reason: `ربح الطلب بعد الخصم ${money(after)} أقل من ${money(minProfit)} (تكلفة اليوم ÷ المحطات)` };
  }
  return { ...out, pct: out.tierPct, amount, profitBefore: profit, profitAfter: after, minProfit, applied: true };
}

/**
 * The totals after a discount taken before VAT: net − discount, VAT on that,
 * the total. Without VAT (before the cutoff): the gross less the discount.
 */
export function discountedTotals(split: InclusiveTotals, discount: number, ratePct: number | null): { subtotal: number; discount: number; tax: number; total: number } {
  if (!(discount > 0)) return { subtotal: split.subtotal, discount: 0, tax: split.tax, total: split.total };
  const net = round2(split.subtotal - discount);
  const tax = ratePct ? round2((net * ratePct) / 100) : 0;
  return { subtotal: split.subtotal, discount: round2(discount), tax, total: round2(net + tax) };
}

// ---------------------------------------------------------------- the minimum order

export interface MinimumCheck { total: number; min: number; below: boolean; unpriced: number }
export const minimumText = (min: number): string => `أقل طلب ${money(min)} ريال، أضف أصنافاً ليكتمل`;

/** The order's total at the prices it would be quoted, before the discount, against the minimum (0 = none). */
export async function orderMinimum(env: Env, orderId: number, day: string = riyadhDateKey()): Promise<MinimumCheck> {
  const settings = await readPricingSettings(env, day);
  const min = settings?.minOrder ?? 0;
  if (!(min > 0)) return { total: 0, min: 0, below: false, unpriced: 0 };
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) return { total: 0, min, below: false, unpriced: 0 };
  let total = 0, unpriced = 0;
  for (const l of order.lines) {
    const unit = (l.price_unit_manual ?? 0) > 0 ? (l.price_unit_manual as number) : (l.unit_price ?? 0) > 0 ? (l.unit_price as number) : (await getLatestSalePrice(env, l.product_id, l.packaging_id, order.order_date ?? day)).price;
    if (!(unit > 0)) { unpriced++; continue; }
    total += round2(unit * l.quantity);
  }
  total = round2(total);
  // a line without a price: the quotation's own «صنف بلا سعر» path decides, not the minimum
  return { total, min, below: unpriced === 0 && order.lines.length > 0 && total < min, unpriced };
}
