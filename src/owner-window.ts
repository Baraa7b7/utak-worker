// § 45 ب (2026-09-30) — Baraa's window for the night.
//
// Two UTILITY templates (scripts/s45-20260930-owner-templates.mjs), each read
// by its Meta name from x_whatsapp_template (x_purpose «other»: a purpose
// lookup never picks them, so no duplicate-purpose alert) and used only while
// its row is APPROVED / UTILITY — the daily 05:00 sync keeps the row in step
// with Meta:
//   • utak_owner_daily_summary_v1 — the 21:30 summary outside his window
//     (src/owner-summary.ts): «ملخص عمليات يو تاك ليوم {{1}}» then the three
//     variables of utak_v2_summary, and one quick reply «تم الاطلاع»
//     (SUMMARY_ACK_PAYLOAD). It also goes in place of the text when his window
//     is open at 21:30 but closes before tomorrow's 06:00 (the price
//     deadline): the text has no button to keep the night open. Not usable →
//     the text / utak_v2_summary, as before.
//   • utak_owner_price_review_v1 — the day's price exceptions held for him
//     while his window is closed (src/prices.ts): «أسعار يو تاك ليوم {{1}}:
//     {{2}} صنف بانتظار قرارك قبل 06:00.» with the number of undecided
//     exceptions, once per price day (a KV claim), and one quick reply «عرض
//     الاستثناءات» (PRICE_REVIEW_PAYLOAD). It never relies on conv_open_owner
//     (utak_update_owner, MARKETING). Not usable → the exceptions stay held
//     for his next message, as before.
// A tap on either is an inbound (src/index.ts): it opens his 24h window and
// flushes what is held for him — the exceptions with their buttons — before
// any routing. Then, in the owner branch, never an order or a complaint:
//   • «تم الاطلاع» → one line, SUMMARY_ACK_TEXT;
//   • «عرض الاستثناءات» → the flush was the answer; one line only when
//     nothing was waiting.

import { PLACE_TODAY } from "./places";
import type { Env } from "./config";
import { call } from "./odoo";
import { TEMPLATE_CANDIDATE_FIELDS, type TemplateCandidate } from "./template-pick";
import { gatewayDecision, sendViaGateway, type GwTemplate } from "./wa-gateway";
import { readWindow } from "./wa-window";
import { readQueue } from "./wa-queue";
import { arabicDate } from "./wa-params";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs } from "./hours";

export const SUMMARY_TEMPLATE = "utak_owner_daily_summary_v1";
export const PRICE_REVIEW_TEMPLATE = "utak_owner_price_review_v1";
export const SUMMARY_ACK_PAYLOAD = "owner_summary_ack";
export const PRICE_REVIEW_PAYLOAD = "owner_price_review";
/** The gateway purpose of template 2 (src/wa-purposes.ts, the owner guard). */
export const PRICE_REVIEW_PURPOSE = "owner_price_review";
export const SUMMARY_ACK_TEXT = "تم ✅، تنبيهات الليلة تصلك مباشرة";
export const PRICE_REVIEW_NOTHING_TEXT = `لا استثناءات أسعار محفوظة لك الآن: قرّرتها، أو فات موعد 06:00. التفاصيل في ${PLACE_TODAY}.`;
const EXCEPTION_PURPOSE = "owner_price_exception";
const REVIEW_TTL = 26 * 3600;
/** The once-per-price-day claim of template 2 (button-lock key). */
const reviewLock = (day: string) => `owner_price_review:${day}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The template's row by its Meta name when it is APPROVED / UTILITY; null otherwise (or Odoo unreachable). */
export async function usableOwnerTemplate(env: Env, name: string): Promise<TemplateCandidate | null> {
  try {
    const [row] = await call<TemplateCandidate[]>(env, "x_whatsapp_template", "search_read", {
      domain: [["x_meta_template_id", "=", name]],
      fields: TEMPLATE_CANDIDATE_FIELDS,
      order: "id desc",
      limit: 1,
    });
    if (!row) return null;
    return String(row.x_meta_status || "").toUpperCase() === "APPROVED" && String(row.x_category || "").toUpperCase() === "UTILITY" ? row : null;
  } catch (e) {
    console.warn(`[owner-window] ${name} lookup failed`, (e as Error)?.message);
    return null;
  }
}

/** Tomorrow's price deadline (06:00 by default): the end of «the night» for Baraa's window. */
async function nightEndMs(env: Env, day: string): Promise<number> {
  const { pricesDeadlineMinutes } = await import("./prices");
  const tomorrow = riyadhDateKey(new Date(riyadhDayMinuteMs(day, 12 * 60) + DAY_MS));
  return riyadhDayMinuteMs(tomorrow, pricesDeadlineMinutes(env).minutes);
}

/**
 * Template 1 for the summary of `day` ({{1}} the day, then utak_v2_summary's
 * three variables) with its «تم الاطلاع» payload; `first` when his window is
 * open now but closes before tomorrow's deadline (the template goes in place
 * of the text). Null while the template is not usable.
 */
export async function summaryNightOption(env: Env, day: string, params: [string, string, string], nowMs: number = Date.now()): Promise<{ option: GwTemplate; first: boolean } | null> {
  const row = await usableOwnerTemplate(env, SUMMARY_TEMPLATE);
  if (!row) return null;
  const option: GwTemplate = { kind: "template", row, params: [arabicDate(day), ...params], buttons: [{ index: 0, payload: SUMMARY_ACK_PAYLOAD }] };
  const win = await readWindow(env, String(env.OWNER_WHATSAPP ?? ""), nowMs);
  return { option, first: win.open && win.closesAtMs < (await nightEndMs(env, day)) };
}

/**
 * Template 2, once per price day: his window is closed, exception messages of
 * `day` are held for him, and the template is usable. `count` = the day's
 * undecided exceptions. The claim is released when nothing went (a later tick
 * may try again; Meta's refusals are blocked by the gateway for 24h).
 */
export async function notifyPriceReview(env: Env, day: string, count: number, nowMs: number = Date.now()): Promise<string | null> {
  const owner = String(env.OWNER_WHATSAPP ?? "");
  if (!owner || count <= 0) return null;
  if ((await env.MSG_DEDUP.get(`btnlock:v1:${reviewLock(day)}`)) !== null) return null;
  const win = await readWindow(env, owner, nowMs);
  if (win.open) return null;
  const held = (await readQueue(env, owner)).filter((i) => i.purpose === EXCEPTION_PURPOSE && i.expiresAt > nowMs);
  if (!held.length) return null;
  const row = await usableOwnerTemplate(env, PRICE_REVIEW_TEMPLATE);
  if (!row) return "not_usable";
  const claim = await claimButton(env, reviewLock(day), REVIEW_TTL);
  if (!claim.claimed) return null;
  const r = await sendViaGateway(env, {
    purpose: PRICE_REVIEW_PURPOSE,
    to: owner,
    content: { kind: "template", row, params: [arabicDate(day), String(count)], buttons: [{ index: 0, payload: PRICE_REVIEW_PAYLOAD }] },
    noHold: true,
  });
  const d = gatewayDecision(r);
  if (d?.action === "template") {
    await finishButton(env, claim, REVIEW_TTL);
    return "sent";
  }
  await releaseButton(env, claim);
  return d?.action ?? `status_${r.status}`;
}

/** Baraa's tap on either template's button (after the flush): the reply, or null (none). */
export function ownerWindowButtonReply(payload: string, flushedSent: number): string | null {
  if (payload === SUMMARY_ACK_PAYLOAD) return SUMMARY_ACK_TEXT;
  if (payload === PRICE_REVIEW_PAYLOAD) return flushedSent > 0 ? null : PRICE_REVIEW_NOTHING_TEXT;
  return null;
}
export const isOwnerWindowPayload = (p: string | undefined | null): boolean => p === SUMMARY_ACK_PAYLOAD || p === PRICE_REVIEW_PAYLOAD;
