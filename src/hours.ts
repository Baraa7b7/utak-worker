// Ordering hours + urgency detection — pure functions, no I/O.

import { ORDERING_HOURS_OPEN, ORDERING_HOURS_CLOSE, URGENCY_KEYWORDS, QUOTATION_TRIGGERS } from "./config";

// Riyadh is UTC+3 year-round (no DST).
export function riyadhHour(now: Date = new Date()): number {
  return (now.getUTCHours() + 3) % 24;
}

export function isOrderingHoursOpen(now: Date = new Date()): boolean {
  const h = riyadhHour(now);
  return h >= ORDERING_HOURS_OPEN && h < ORDERING_HOURS_CLOSE;
}

export function containsUrgencyKeywords(text: string): boolean {
  const t = text.toLowerCase();
  return URGENCY_KEYWORDS.some((kw) => t.includes(kw.toLowerCase()));
}

export function isQuotationTrigger(text: string): boolean {
  const t = text.trim().toLowerCase();
  return QUOTATION_TRIGGERS.some((kw) => t.includes(kw.toLowerCase()));
}
