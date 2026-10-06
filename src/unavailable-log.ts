// § 60 ج (2026-10-06) — «طلبوا وما كان متوفر»: what customers asked for and the day's list did not hold.
//
// Every answer «هذا الصنف غير متوفر اليوم» (§ 59 ج — an item not published today, one switched off,
// one we do not sell) leaves ONE light row in Odoo (x_unavailable_request, scripts/lib/s60-odoo.mjs):
// the Riyadh day, the customer, the item as he wrote it, the catalog's item when one matched, and the
// quantity when he gave one. It is written where the answer is decided:
//   • the order's intake (src/router.ts): the items of his message the valid list does not hold;
//   • freezeOrderPrices (src/order-flow.ts): a line of an order kept from before the list, which
//     leaves the order (the line carries the catalog's name, not his words).
// Nothing alerts Baraa at once. The 21:30 summary (src/owner-summary.ts) names the day's items —
// «طلبوا اليوم وما كان متوفر: طماطم ×3 (عميلان)، خيار ×1», the five most asked by the number of
// customers, then «+N»; no row, no line — and «🎯 الفرص والقادم» (src/day-tabs.ts) the last seven days'.
// A row marked x_utak_simulation is in no count. Writing a row never stops an answer: a failure is
// logged and the customer is answered as before.

import type { Env } from "./config";
import { call } from "./odoo";
import { riyadhDateKey } from "./hours";

export const REQUEST_MODEL = "x_unavailable_request";
const SIM_FIELD = "x_utak_simulation";
/** The item as he wrote it is kept this long at most. */
export const REQUEST_TEXT_MAX = 120;
/** The summary's line names this many items, then «+N». */
export const SUMMARY_ITEMS_MAX = 5;

/** One item of an answer «غير متوفر اليوم». */
export interface UnavailableAsk {
  /** The item as the customer wrote it (a line of an order: the catalog's name). */
  text: string;
  /** The catalog's item, when one matched. */
  productId?: number | null;
  /** The quantity, when he gave one. */
  quantity?: number | null;
}

const clean = (s: string): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, REQUEST_TEXT_MAX);
/** The catalog's own name: the «[UTAK-…]» reference in front of it removed. */
const plainName = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();

/** The rows of one answer, as they are created. Pure. */
export function requestVals(day: string, partnerId: number, items: UnavailableAsk[]): Array<Record<string, unknown>> {
  return items.map((it) => ({ ...it, text: clean(it.text) })).filter((it) => it.text).map((it) => ({
    x_name: `${day} — ${it.text}`,
    x_date: day,
    x_partner_id: partnerId,
    x_text: it.text,
    x_product_tmpl_id: Number(it.productId) > 0 ? Number(it.productId) : false,
    x_quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 0,
  }));
}

/**
 * The items of one answer «غير متوفر اليوم», into Odoo: a row an item. No customer (a trial to Baraa's
 * own number), no item: nothing. Never throws — the answer goes whatever happens here. Returns how
 * many rows were written.
 */
export async function logUnavailable(env: Env, a: { partnerId: number; items: UnavailableAsk[]; now?: number }): Promise<number> {
  try {
    if (!(a.partnerId > 0)) return 0;
    const vals_list = requestVals(riyadhDateKey(new Date(a.now ?? Date.now())), a.partnerId, a.items);
    if (!vals_list.length) return 0;
    await call<number[]>(env, REQUEST_MODEL, "create", { vals_list });
    return vals_list.length;
  } catch (e) {
    console.warn("[unavailable] the request was not recorded", (e as Error)?.message);
    return 0;
  }
}

export interface UnavailableRow { day: string; partnerId: number; text: string; productId: number; productName: string; quantity: number }

/** The real rows of the days [from, to] (Riyadh days, both in). Throws on Odoo trouble. */
export async function readUnavailable(env: Env, from: string, to: string): Promise<UnavailableRow[]> {
  const rows = await call<Array<{ x_date: string; x_partner_id: [number, string] | false; x_text: string | false; x_product_tmpl_id: [number, string] | false; x_quantity: number | false }>>(env, REQUEST_MODEL, "search_read", {
    domain: [["x_date", ">=", from], ["x_date", "<=", to], [SIM_FIELD, "!=", true]],
    fields: ["x_date", "x_partner_id", "x_text", "x_product_tmpl_id", "x_quantity"],
    order: "x_date asc, id asc",
    limit: 5000,
  });
  return rows.map((r) => ({
    day: String(r.x_date), partnerId: Array.isArray(r.x_partner_id) ? r.x_partner_id[0] : 0, text: clean(String(r.x_text || "")),
    productId: Array.isArray(r.x_product_tmpl_id) ? r.x_product_tmpl_id[0] : 0, productName: Array.isArray(r.x_product_tmpl_id) ? plainName(r.x_product_tmpl_id[1]) : "",
    quantity: Number(r.x_quantity) || 0,
  }));
}

/** One item of the count: how many times it was asked for, by how many customers, and the quantity said. */
export interface UnavailableItem { name: string; productId: number; asks: number; customers: number; quantity: number }

/**
 * The rows by item — the catalog's item when one matched (its name), else his own words — the most
 * customers first, then the most asks, then the name. Pure.
 */
export function groupUnavailable(rows: UnavailableRow[]): UnavailableItem[] {
  const by = new Map<string, { name: string; productId: number; asks: number; who: Set<number>; quantity: number }>();
  for (const r of rows) {
    const key = r.productId > 0 ? `p:${r.productId}` : `t:${r.text}`;
    const g = by.get(key) ?? { name: r.productId > 0 ? r.productName || r.text : r.text, productId: r.productId, asks: 0, who: new Set<number>(), quantity: 0 };
    g.asks++;
    g.who.add(r.partnerId);
    g.quantity += r.quantity;
    by.set(key, g);
  }
  return [...by.values()].filter((g) => g.name)
    .map((g) => ({ name: g.name, productId: g.productId, asks: g.asks, customers: g.who.size, quantity: Math.round(g.quantity * 100) / 100 }))
    .sort((a, b) => b.customers - a.customers || b.asks - a.asks || a.name.localeCompare(b.name, "ar"));
}

/** «عميل واحد», «عميلان», «3 عملاء», «11 عميلاً». */
export function customersWord(n: number): string {
  return n === 1 ? "عميل واحد" : n === 2 ? "عميلان" : n <= 10 ? `${n} عملاء` : `${n} عميلاً`;
}
/** «طماطم ×3 (عميلان)»; asked once: «خيار ×1». */
export function itemText(i: UnavailableItem): string {
  return `${i.name} ×${i.asks}${i.asks > 1 ? ` (${customersWord(i.customers)})` : ""}`;
}
export const SUMMARY_UNAVAILABLE_HEAD = "طلبوا اليوم وما كان متوفر";

/**
 * The summary's line: «طلبوا اليوم وما كان متوفر: طماطم ×3 (عميلان)، خيار ×1» — the `max` items most
 * customers asked for, then «+N» for the rest. "" without a row: the summary then carries no line. Pure.
 */
export function unavailableLine(items: UnavailableItem[], max: number = SUMMARY_ITEMS_MAX, head: string = SUMMARY_UNAVAILABLE_HEAD): string {
  if (!items.length) return "";
  const rest = items.length - max;
  return `${head}: ${items.slice(0, max).map(itemText).join("، ")}${rest > 0 ? `، +${rest}` : ""}`;
}
