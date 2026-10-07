// § 62 أ (2026-10-07) — the numbers of «طلب أسعار خاص». Pure: no Odoo, no clock.
//
// Every price is for ONE unit of the line (a kilo by default). A purchase price
// is net of VAT (§ 47); the market price and every price shown to the customer
// include it.
//
//   cost            = purchase × (1 + waste)
//   «بدون خسارة»     = cost × 1.15
//   «الأدنى المربح»  = cost × (1 + margin) × 1.15
//   «المقترح»        = the higher of (the market's median, «الأدنى المربح»), up to
//                     the nearest quarter riyal; with no market: «الأدنى المربح»
//                     (up to the quarter as well). No purchase price: no cost, so
//                     nothing is suggested — a market price alone promises no profit.
//   the line's profit = quantity × (final ÷ 1.15 − cost)
//   the order's profit = the lines' profits − the delivery cost of this order
//
// A line with no purchase price or no final price has no profit: it is left out
// of the order's profit and counted, so the sign above the screen never reads
// as the profit of the whole order while lines are missing.

export const VAT_FACTOR = 1.15;
export const SUGGEST_STEP = 0.25;
export const DEFAULT_MARGIN_PCT = 10;
export const DEFAULT_UNIT = "كيلو";

export const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pos = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
/**
 * «الأسعار في العرض» (the addition to § 62 ج): «قبل الضريبة» (net, the default)
 * or «شاملة الضريبة» (gross). It decides which final price Baraa types and how
 * the quotation prints; the formulas above never change — they read the
 * VAT-inclusive final price either way.
 */
export type PriceMode = "net" | "gross";
export const DEFAULT_PRICE_MODE: PriceMode = "net";
export const VAT_RATE = 0.15;
/** The price before VAT of a VAT-inclusive one (final ÷ 1.15), to the halala. */
export const netOf = (gross: number): number => round2(pos(gross) / VAT_FACTOR);
/** The VAT-inclusive price of one before VAT (× 1.15), to the halala. */
export const grossOf = (net: number): number => round2(pos(net) * VAT_FACTOR);
const pct = (n: unknown): number => Math.max(0, Number(n) || 0) / 100;

/** Up to the nearest step (a quarter riyal): 5.01 → 5.25, 5.25 → 5.25. A float's dust never lifts a price a whole step. */
export function ceilTo(x: number, step: number = SUGGEST_STEP): number {
  if (!(x > 0)) return 0;
  return round2(Math.ceil(round2(x) / step - 1e-9) * step);
}

/** The unit's cost: the purchase price and its waste. 0 = no purchase price. */
export function unitCost(purchase: number, wastePct: number): number {
  return pos(purchase) * (1 + pct(wastePct));
}
/** «بدون خسارة»: the lowest VAT-inclusive price that pays the cost back. */
export function noLossPrice(purchase: number, wastePct: number): number {
  return round2(unitCost(purchase, wastePct) * VAT_FACTOR);
}
/** «الأدنى المربح»: the cost, the minimum margin on it, and the VAT. */
export function minProfitablePrice(purchase: number, wastePct: number, marginPct: number): number {
  return round2(unitCost(purchase, wastePct) * (1 + pct(marginPct)) * VAT_FACTOR);
}

/** The middle of the observations (the mean of the two middle ones for an even count). 0 = none. */
export function median(values: number[]): number {
  const v = values.map(pos).filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

/** «المقترح». 0 = no purchase price (nothing can be promised). */
export function suggestedPrice(purchase: number, marketMedian: number, wastePct: number, marginPct: number): number {
  if (!(pos(purchase) > 0)) return 0;
  const floor = unitCost(purchase, wastePct) * (1 + pct(marginPct)) * VAT_FACTOR;
  return ceilTo(Math.max(pos(marketMedian), floor));
}

/** The line's profit, net of VAT; null = it cannot be told (no purchase price, no final price or no quantity). */
export function lineProfit(qty: number, finalPrice: number, purchase: number, wastePct: number): number | null {
  if (!(pos(qty) > 0) || !(pos(finalPrice) > 0) || !(pos(purchase) > 0)) return null;
  return round2(qty * (finalPrice / VAT_FACTOR - unitCost(purchase, wastePct)));
}
export const lineTotal = (qty: number, finalPrice: number): number => round2(pos(qty) * pos(finalPrice));

export interface MathLine {
  qty: number;
  purchase: number;
  /** Every market observation of the line (VAT-inclusive, a unit). */
  market: number[];
  finalPrice: number;
}
export interface LineNumbers {
  marketMedian: number;
  noLoss: number;
  suggested: number;
  total: number;
  /** 0 when it cannot be told (see `counted`). */
  profit: number;
  counted: boolean;
  /** The final price is under «بدون خسارة». */
  belowCost: boolean;
}
export function lineNumbers(l: MathLine, wastePct: number, marginPct: number): LineNumbers {
  const marketMedian = median(l.market);
  const noLoss = pos(l.purchase) > 0 ? noLossPrice(l.purchase, wastePct) : 0;
  const p = lineProfit(l.qty, l.finalPrice, l.purchase, wastePct);
  return {
    marketMedian, noLoss,
    suggested: suggestedPrice(l.purchase, marketMedian, wastePct, marginPct),
    total: lineTotal(l.qty, l.finalPrice),
    profit: p ?? 0, counted: p !== null,
    belowCost: noLoss > 0 && pos(l.finalPrice) > 0 && l.finalPrice < noLoss,
  };
}

export interface OrderNumbers {
  lines: number;
  missingPurchase: number;
  missingFinal: number;
  belowCost: number;
  /** The lines whose profit could be told. */
  counted: number;
  total: number;
  linesProfit: number;
  /** The lines' profits − the delivery cost. */
  profit: number;
}
export function orderNumbers(lines: MathLine[], wastePct: number, marginPct: number, deliveryCost: number): OrderNumbers {
  const n = lines.map((l) => lineNumbers(l, wastePct, marginPct));
  const linesProfit = round2(n.reduce((s, x) => s + x.profit, 0));
  return {
    lines: lines.length,
    missingPurchase: lines.filter((l) => !(pos(l.purchase) > 0)).length,
    missingFinal: lines.filter((l) => !(pos(l.finalPrice) > 0)).length,
    belowCost: n.filter((x) => x.belowCost).length,
    counted: n.filter((x) => x.counted).length,
    total: round2(n.reduce((s, x) => s + x.total, 0)),
    linesProfit,
    profit: round2(linesProfit - Math.max(0, Number(deliveryCost) || 0)),
  };
}

/** «+1,234.50» / «−120.00»: always two decimals and the sign. */
export function signedMoney(n: number): string {
  const v = round2(n);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : "+"}${abs}`;
}
/** A price as the screen and the messages write it: «5», «5.25», «5.5». */
export function money(n: number): string {
  const v = round2(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
}

/**
 * The line above the screen: «✅ ربح الطلب +1,234.50 ريال» or «❌ ربح الطلب −120.00 ريال»,
 * and what is still outside it. Nothing priced yet: no sign at all.
 */
export function profitText(o: OrderNumbers): string {
  if (!o.lines) return "لا أصناف في الطلب بعد";
  if (!o.counted) return `⏳ لا ربح يُحسب بعد: ${o.missingPurchase} بلا سعر شراء، و${o.missingFinal} بلا سعر نهائي`;
  const out = o.lines - o.counted;
  return `${o.profit >= 0 ? "✅" : "❌"} ربح الطلب ${signedMoney(o.profit)} ريال${out ? ` (${out} ${out === 1 ? "سطر" : "أسطر"} خارج الحساب)` : ""}`;
}
/** The short line under it: the counts Baraa acts on. */
export function summaryText(o: OrderNumbers): string {
  const parts = [`${o.lines} صنف`, `${o.missingPurchase} بلا سعر شراء`, `${o.missingFinal} بلا سعر نهائي`];
  if (o.belowCost) parts.push(`⚠️ ${o.belowCost} نهائيه تحت «بدون خسارة»`);
  parts.push(`الإجمالي ${money(o.total)} ريال`);
  return parts.join(" · ");
}
