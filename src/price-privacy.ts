// § 53 أ (2026-10-04) — who may see which price.
//
//   • Baraa sees everything.
//   • An employee (Omar) sees the SALE price alone: never a supplier's purchase
//     price, the cost, the waste, the suggested price or the profit. What he
//     paid himself in the cash market is his own number.
//   • A supplier (Ahmed) sees his own prices alone: never our sale price, the
//     market price or the profit.
//   • An outside price source (رائد: a partner «مصدر أسعار» that is neither a
//     supplier, a customer nor an employee) sees NO price of ours at all — and
//     never the customers' price list.
//
// Every number above the sale price (purchase, cost, suggested, profit) lives in
// messages of the owner's purposes alone; the gateway (src/wa-gateway.ts) sends
// an owner's purpose to his number only. What carries our SALE prices to a
// customer — the day's list, a quotation, the order form — is refused by the
// gateway for a number that belongs to a price source or a supplier, whatever
// path produced it (a failed lookup that let the number into the customer path,
// a second partner on the same number, a held message flushed later).
//
// The «closed» numbers: every partner flagged «مصدر أسعار» or with a supplier
// rank, by `x_whatsapp_number` and by `phone` (the last nine digits decide, as
// for the cash-market supplier). Kept CLOSED_TTL_SECONDS in KV: one Odoo read
// for the sends of those minutes. An employee is not closed (he may see the
// sale price), and is kept out of the customers' list by the roster.

import type { Env } from "./config";
import { call } from "./odoo";
import { waDigits } from "./wa-window";

/** The purposes whose content carries our sale prices as a customer reads them. */
export const CUSTOMER_PRICE_PURPOSES: ReadonlySet<string> = new Set([
  "customer_prices", "customer_quotation", "customer_quotation_pdf", "customer_order_form",
]);

export type ClosedKind = "source" | "supplier";
export interface ClosedNumber {
  digits: string;
  id: number;
  name: string;
  kind: ClosedKind;
}

export const CLOSED_KV_KEY = "price_closed:v1";
export const CLOSED_TTL_SECONDS = 5 * 60;

/** «مصدر أسعار» / «مورد», as Baraa reads it. */
export const closedKindLabel = (k: ClosedKind): string => (k === "supplier" ? "مورد" : "مصدر أسعار");

/** The same number, written «0501234567», «+966501234567» or «966501234567»: the last nine digits decide. */
export function sameNumber(a: string, b: string): boolean {
  const x = waDigits(a), y = waDigits(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9));
}

/**
 * The numbers of every price source and supplier (partners; one read). Throws
 * when Odoo cannot be read: the caller decides (the gateway refuses a
 * price-bearing send it cannot verify).
 */
export async function readClosedNumbers(env: Env): Promise<ClosedNumber[]> {
  const rows = await call<Array<{ id: number; name: string; phone: string | false; x_whatsapp_number: string | false; supplier_rank: number; x_price_source?: boolean }>>(env, "res.partner", "search_read", {
    domain: ["|", ["x_price_source", "=", true], ["supplier_rank", ">", 0]],
    fields: ["id", "name", "phone", "x_whatsapp_number", "supplier_rank", "x_price_source"], order: "id asc", limit: 500,
  });
  const out: ClosedNumber[] = [];
  for (const r of rows) {
    const kind: ClosedKind = (Number(r.supplier_rank) || 0) > 0 ? "supplier" : "source";
    for (const n of new Set([r.x_whatsapp_number, r.phone].map((v) => waDigits(String(v || ""))).filter(Boolean))) {
      out.push({ digits: n, id: r.id, name: String(r.name || ""), kind });
    }
  }
  return out;
}

/** The closed numbers: from KV, else from Odoo (and into KV). Throws when neither can be read. */
export async function closedNumbers(env: Env): Promise<ClosedNumber[]> {
  try {
    const raw = await env.MSG_DEDUP.get(CLOSED_KV_KEY);
    const kept = raw ? (JSON.parse(raw) as ClosedNumber[]) : null;
    if (Array.isArray(kept)) return kept;
  } catch { /* read Odoo */ }
  const list = await readClosedNumbers(env);
  try { await env.MSG_DEDUP.put(CLOSED_KV_KEY, JSON.stringify(list), { expirationTtl: CLOSED_TTL_SECONDS }); } catch { /* the next send reads again */ }
  return list;
}

/** The price source or supplier this number belongs to, else null. Throws when it cannot be verified. */
export async function priceClosedNumber(env: Env, to: string): Promise<ClosedNumber | null> {
  if (!waDigits(to)) return null;
  return (await closedNumbers(env)).find((c) => sameNumber(c.digits, to)) ?? null;
}
