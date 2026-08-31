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
