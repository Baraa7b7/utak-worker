// Ordering hours + urgency detection.
// v3 note: The authoritative "is ordering open?" now also checks a KV flag
// set by the 06:00 Riyadh cron once suppliers have replied (or the wait
// window elapsed). Sync helpers below remain pure for unit tests + fallback.

import type { Env } from "./config";
import {
  ORDERING_HOURS_OPEN,
  ORDERING_HOURS_CLOSE,
  URGENCY_KEYWORDS,
  QUOTATION_TRIGGERS,
  ORDERING_OPEN_KEY,
} from "./config";

// Riyadh is UTC+3 year-round (no DST).
export function riyadhHour(now: Date = new Date()): number {
  return (now.getUTCHours() + 3) % 24;
}

// Riyadh calendar day as YYYY-MM-DD (used for the KV flag key).
export function riyadhDateKey(now: Date = new Date()): string {
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return riyadh.toISOString().slice(0, 10);
}

// Pure time-window check — the v2 behaviour, kept for fallback.
export function isWithinOrderingWindow(now: Date = new Date()): boolean {
  const h = riyadhHour(now);
  return h >= ORDERING_HOURS_OPEN && h < ORDERING_HOURS_CLOSE;
}

// v3 authoritative check: window AND today's KV flag set.
export async function isOrderingHoursOpen(
  env?: Env,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isWithinOrderingWindow(now)) return false;
  if (!env) return true; // no env passed → treat as open (v2 behaviour)
  try {
    const flag = await env.MSG_DEDUP.get(ORDERING_OPEN_KEY(riyadhDateKey(now)));
    return flag === "true";
  } catch {
    // If KV read fails, don't lock customers out.
    return true;
  }
}

export function containsUrgencyKeywords(text: string): boolean {
  const t = text.toLowerCase();
  return URGENCY_KEYWORDS.some((kw) => t.includes(kw.toLowerCase()));
}

export function isQuotationTrigger(text: string): boolean {
  const t = text.trim().toLowerCase();
  return QUOTATION_TRIGGERS.some((kw) => t.includes(kw.toLowerCase()));
}

// ---- 2026-09-24 (ح2 / ح9) — closed-hours orders ----

/** Minutes since Riyadh midnight. */
export function riyadhMinutes(now: Date = new Date()): number {
  return riyadhHour(now) * 60 + now.getUTCMinutes();
}

/** The purchase list goes to the warehouse at 21:15 Riyadh. */
export const PURCHASE_LIST_MINUTE = ORDERING_HOURS_CLOSE * 60 + 15;

/**
 * The ordering day an order placed now belongs to: after the 21:00 cutoff it
 * is tomorrow's; before 06:00 (or while today's window has not opened yet) it
 * is today's.
 */
export function nextOrderingDate(now: Date = new Date()): string {
  if (riyadhHour(now) >= ORDERING_HOURS_CLOSE) {
    return riyadhDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  }
  return riyadhDateKey(now);
}

/** True once today's purchase list has gone out (21:15) and until 06:00. */
export function isAfterPurchaseCutoff(now: Date = new Date()): boolean {
  return riyadhMinutes(now) >= PURCHASE_LIST_MINUTE || riyadhHour(now) < ORDERING_HOURS_OPEN;
}

// ---- 2026-09-25 — clock helpers shared by suppliers.ts and attendance.ts ----

/** «14:05» in Riyadh. */
export function riyadhHHMM(now: Date = new Date()): string {
  const m = riyadhMinutes(now);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Odoo UTC «YYYY-MM-DD HH:MM:SS» → unix ms (NaN when empty or invalid). */
export function odooUtcMs(v: string | false | null | undefined): number {
  return v ? Date.parse(String(v).replace(" ", "T") + "Z") : NaN;
}

/** Odoo UTC «YYYY-MM-DD HH:MM:SS» → «HH:MM» in Riyadh. */
export function odooUtcToRiyadhHHMM(v: string | false | undefined): string {
  const t = odooUtcMs(v);
  return Number.isFinite(t) ? riyadhHHMM(new Date(t)) : "—";
}

/** unix ms → Odoo UTC «YYYY-MM-DD HH:MM:SS». */
export function toOdooUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Unix ms of «HH:MM» (minutes after midnight) on a Riyadh calendar day. */
export function riyadhDayMinuteMs(day: string, minutes: number): number {
  return Date.parse(`${day}T00:00:00+03:00`) + minutes * 60_000;
}
