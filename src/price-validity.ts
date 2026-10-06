// § 49 ب (2026-10-01) — a price is valid for one day.
//
// The price list of day D (x_price_day, published) is valid from the moment it
// is published until 06:00 Riyadh of D+1, and no longer: no price outside its
// validity is quoted or confirmed (Baraa: no loss from an old price). A late
// publication («نشر المعتمد الآن») is valid until the next 06:00 after it.
//
//   • the valid list now: the published real day with the latest date whose
//     validity has not ended (yesterday's until 06:00; today's from its
//     publication);
//   • an item's price in it: its published line (approved, not left out, a
//     price above 0); an item of that same day that was not published takes
//     the day's line «السعر المربح المقترح» (§ 48 ب, the same day's purchase —
//     never an older day's); anything else has no price;
//   • no valid list: nothing is priced. The order is kept and quoted by itself
//     at the first valid publication (src/order-flow.ts).
//
// Read-only: nothing here writes.

import type { Env } from "./config";
import { call } from "./odoo";
import { addDaysYmd, odooUtcMs, riyadhDateKey, riyadhDayMinuteMs } from "./hours";

/** A list ends at this Riyadh minute of the day after it (06:00). */
export const LIST_EXPIRY_MINUTE = 6 * 60;

export interface ValidList {
  dayId: number;
  /** The price day, «YYYY-MM-DD» (Riyadh). */
  day: string;
  /** unix ms; null when the record carries no publication time. */
  publishedAtMs: number | null;
  validUntilMs: number;
}

/** The first 06:00 Riyadh strictly after `ms`. */
export function nextExpiryAfter(ms: number): number {
  const day = riyadhDateKey(new Date(ms));
  const today = riyadhDayMinuteMs(day, LIST_EXPIRY_MINUTE);
  return ms < today ? today : riyadhDayMinuteMs(addDaysYmd(day, 1), LIST_EXPIRY_MINUTE);
}

/**
 * When the list of `day` stops being valid: 06:00 of the day after it; a list
 * published later than that (a late «نشر المعتمد الآن») until the next 06:00
 * after its publication. Pure.
 */
export function listValidUntilMs(day: string, publishedAtMs: number | null = null): number {
  const own = riyadhDayMinuteMs(addDaysYmd(day, 1), LIST_EXPIRY_MINUTE);
  return publishedAtMs !== null && Number.isFinite(publishedAtMs) && publishedAtMs >= own ? nextExpiryAfter(publishedAtMs) : own;
}

/** A published list is valid at `nowMs` while its end has not come (at 06:00 sharp it is over). Pure. */
export function isValidAt(day: string, publishedAtMs: number | null, nowMs: number): boolean {
  return nowMs < listValidUntilMs(day, publishedAtMs);
}

interface DayRow { id: number; x_date: string; x_state: string; x_published_at?: string | false }
const toList = (r: DayRow): ValidList => {
  const at = odooUtcMs(r.x_published_at || null);
  const publishedAtMs = Number.isFinite(at) ? at : null;
  return { dayId: r.id, day: r.x_date, publishedAtMs, validUntilMs: listValidUntilMs(r.x_date, publishedAtMs) };
};

/** How many days back a published day is looked for (a late publication of an older day). */
const LOOK_BACK_DAYS = 3;

/** The valid price list at `nowMs`, or null. Simulation days are never a list. Throws on Odoo trouble. */
export async function validPriceList(env: Env, nowMs: number = Date.now()): Promise<ValidList | null> {
  const today = riyadhDateKey(new Date(nowMs));
  const rows = await call<DayRow[]>(env, "x_price_day", "search_read", {
    domain: [["x_state", "=", "published"], ["x_utak_simulation", "!=", true], ["x_date", ">=", addDaysYmd(today, -LOOK_BACK_DAYS)], ["x_date", "<=", today]],
    fields: ["id", "x_date", "x_state", "x_published_at"],
    order: "x_date desc, id desc",
    limit: 10,
  });
  for (const r of rows) {
    const l = toList(r);
    if (isValidAt(l.day, l.publishedAtMs, nowMs)) return l;
  }
  return null;
}

/** The list of `day`, when it is published and still valid at `nowMs`; else null. */
export async function listOfDayIfValid(env: Env, day: string, nowMs: number = Date.now()): Promise<ValidList | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) return null;
  const rows = await call<DayRow[]>(env, "x_price_day", "search_read", {
    domain: [["x_date", "=", day], ["x_state", "=", "published"], ["x_utak_simulation", "!=", true]],
    fields: ["id", "x_date", "x_state", "x_published_at"],
    order: "id desc",
    limit: 1,
  });
  if (!rows[0]) return null;
  const l = toList(rows[0]);
  return isValidAt(l.day, l.publishedAtMs, nowMs) ? l : null;
}

export interface ListPrice { price: number; source: "published" | "missing" }

/**
 * The price of an item in a valid list: its published line, else none — the
 * item is not available that day (§ 59 ج: never the day's suggested price,
 * never a supplier row's stored price, never another day's).
 */
export async function listPrice(env: Env, list: ValidList, productId: number, packagingId: number): Promise<ListPrice> {
  const lines = await call<Array<{ id: number; x_sale_price: number | false; x_excluded: boolean; x_status: string | false; x_suggested_price?: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id", "=", list.dayId], ["x_utak_simulation", "!=", true], ["x_product_tmpl_id", "=", productId], ["x_packaging_id", "=", packagingId]],
    fields: ["id", "x_sale_price", "x_excluded", "x_status", "x_suggested_price"],
    order: "id desc",
    limit: 5,
  });
  const published = lines.find((l) => !l.x_excluded && Number(l.x_sale_price) > 0);
  if (published) return { price: Number(published.x_sale_price), source: "published" };
  // § 59 ج — an item the list did not publish is NOT AVAILABLE that day: no price of ours stands in
  // for it (until § 59 its «السعر المربح المقترح» did). The order's quotation leaves the line out.
  return { price: 0, source: "missing" };
}
