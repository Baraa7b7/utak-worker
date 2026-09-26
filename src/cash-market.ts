// «مشتريات السوق النقدية» — 2026-09-27 (STATUS § 42 أ).
//
// Omar buys some items at the market himself (his «شراء» price, § 40 ب). When
// the engine's winning purchase price of a purchase-list line came from such a
// source — a price source that is not a supplier: an employee (Omar), or a
// flagged partner without supplier_rank — that line is owed to the supplier
// «مشتريات السوق النقدية» (res.partner, ref UTAK-CASH-MARKET), at that
// written price (x_price_day_line.x_source_price), not to the item's usual
// supplier (Ahmed) as a «بلا سعر» line.
//
//   • the winner is read from «أسعار اليوم» of the list's day
//     (x_price_day_line.x_supplier_id: the partner of the winning purchase
//     offer; a simulation day or line is left out);
//   • its payments go through the supplier-payment flow as any supplier's
//     (Omar records, Baraa approves), and its notice never goes: it has no
//     number (src/supplier-pay.ts settlePayment);
//   • the gateway sends it nothing, ever — a number added to it later in Odoo
//     included (cashMarketRecipient, src/wa-gateway.ts).
//
// Missing (archived, or its ref changed) → the market lines have no supplier
// («بلا مورد» in the dues alert), never Ahmed's.

import type { Env } from "./config";
import { call } from "./odoo";
import { loadPriceSources } from "./price-sources";
import { waDigits } from "./wa-window";

export const CASH_MARKET_REF = "UTAK-CASH-MARKET";
export const CASH_MARKET_NAME = "مشتريات السوق النقدية";
/** KV: the partner's numbers, if any (normally none), for the gateway's check. */
const NUMS_KEY = "cash_market_nums:v1";
const NUMS_TTL = 10 * 60;

type M2O = [number, string] | false;

/** The active «مشتريات السوق النقدية» partner, or null. Throws on Odoo trouble. */
export async function findCashMarketSupplier(env: Env): Promise<{ id: number; name: string } | null> {
  const rows = await call<Array<{ id: number; name: string }>>(env, "res.partner", "search_read", {
    domain: [["ref", "=", CASH_MARKET_REF]], fields: ["id", "name"], order: "id asc", limit: 1,
  });
  return rows[0] ?? null;
}

export interface MarketWinner {
  /** The source partner whose purchase offer won (Omar's Work Contact). */
  partnerId: number;
  sourceName: string;
  /** The written purchase price that won (x_source_price). */
  price: number;
}

/** "product::packaging" → the market source that won its purchase price that day. */
export type MarketWinners = Map<string, MarketWinner>;
export const winnerKey = (productId: number, packagingId: number): string => `${productId}::${packagingId}`;

/**
 * The lines of «أسعار اليوم» of `day` whose winning purchase price came from a
 * price source that is not a supplier. Empty when the day has no record or no
 * such line. Throws on Odoo trouble.
 */
export async function marketWinners(env: Env, day: string): Promise<MarketWinners> {
  const out: MarketWinners = new Map();
  if (!day) return out;
  const lines = await call<Array<{ x_product_tmpl_id: M2O; x_packaging_id: M2O; x_supplier_id: M2O; x_source_price: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id.x_date", "=", day], ["x_day_id.x_utak_simulation", "!=", true], ["x_utak_simulation", "!=", true],
      ["x_supplier_id", "!=", false], ["x_source_price", ">", 0]],
    fields: ["x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_source_price"],
    order: "id asc", limit: 1000,
  });
  if (!lines.length) return out;
  const src = await loadPriceSources(env);
  const employees = new Set(src.employees.map((e) => e.partnerId).filter(Boolean));
  const nonSupplier = (pid: number) => employees.has(pid) || src.partners.some((p) => p.partnerId === pid && !p.supplier);
  for (const l of lines) {
    if (!l.x_product_tmpl_id || !l.x_packaging_id || !l.x_supplier_id) continue;
    const pid = l.x_supplier_id[0];
    if (!nonSupplier(pid)) continue;
    out.set(winnerKey(l.x_product_tmpl_id[0], l.x_packaging_id[0]), {
      partnerId: pid, sourceName: String(l.x_supplier_id[1] ?? ""), price: Number(l.x_source_price),
    });
  }
  return out;
}

/**
 * The gateway's check: is `to` a number of «مشتريات السوق النقدية»? It has
 * none by design; this stops a number added later in Odoo from ever getting a
 * message. Odoo unreachable → false (a partner without a number cannot be the
 * recipient of any send the worker addresses by number), logged.
 */
export async function isCashMarketNumber(env: Env, to: string): Promise<boolean> {
  const d = waDigits(to);
  if (!d) return false;
  let nums: string[] | null = null;
  try {
    const raw = await env.MSG_DEDUP.get(NUMS_KEY);
    if (raw) nums = JSON.parse(raw) as string[];
  } catch { /* read Odoo */ }
  if (!nums) {
    try {
      const rows = await call<Array<{ phone: string | false; x_whatsapp_number: string | false }>>(env, "res.partner", "search_read", {
        domain: [["ref", "=", CASH_MARKET_REF]], fields: ["phone", "x_whatsapp_number"], context: { active_test: false }, limit: 5,
      });
      nums = rows.flatMap((r) => [r.phone, r.x_whatsapp_number]).map((n) => waDigits(String(n || ""))).filter(Boolean);
      try { await env.MSG_DEDUP.put(NUMS_KEY, JSON.stringify(nums), { expirationTtl: NUMS_TTL }); } catch { /* next send reads again */ }
    } catch (e) {
      console.warn(`[cash-market] numbers unreadable — not blocking`, (e as Error)?.message);
      return false;
    }
  }
  // «0501234567», «+966501234567», «966501234567»: the last nine digits decide.
  return nums.some((n) => n === d || (n.length >= 9 && d.length >= 9 && n.slice(-9) === d.slice(-9)));
}
