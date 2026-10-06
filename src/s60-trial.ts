// § 60 هـ (2026-10-06) — the ONE trial of § 60 to Baraa's own number: the 21:30 summary as it reaches him
// from now on, with the four lines of «خلاصة اليوم» and «طلبوا اليوم وما كان متوفر».
//
// His number alone (no other can be named), marked «🧪 تجربة», only while his 24h window is open (nothing
// held, no template), once a Riyadh day. Nothing is written in Odoo and nothing is read from it: every
// number is ILLUSTRATIVE and the message says so — but every line is made by the summary's own
// functions (summaryText, briefLines, briefActualLine on dayActual, unavailableLine), so its wording is
// the real one. The 🎯 line is the example of the order: a gap of 125 made of the volume −110 and the
// waste −15.

import type { Env } from "./config";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { dayActual, type ActualShown } from "./day-insight";
import { briefLines, type CartonSplit, type Opportunity } from "./day-tabs";
import type { ScreenRow } from "./day-screen";
import { groupUnavailable, unavailableLine } from "./unavailable-log";
import { summaryText, type SummaryFigures } from "./owner-summary";

export const S60_TRIAL_MARK = "🧪 تجربة";
/** § 58 registered it for this very trial (src/wa-purposes.ts, the owner's number alone). */
export const SUMMARY_TEST_PURPOSE = "target_lines_test";
export const S60_TRIAL_HEAD = `${S60_TRIAL_MARK} — هكذا يصلك ملخص 21:30 من الآن: الأسطر الخمسة الأخيرة جديدة (خلاصة اليوم الأربعة، ثم ما طلبه العملاء وما كان متوفراً). الأرقام كلها توضيحية وليست أرقام اليوم.`;
export const S60_TRIAL_TAIL = "(تجربة بأرقام توضيحية: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)";
const DAY_TTL = 26 * 60 * 60;

/** The illustrative day: a plan of 140 cartons, 96 delivered, the waste 15 riyals over its plan — a gap of 125: the volume −110, the waste −15. */
export function trialActual(): ActualShown {
  const plan = { margin: 3.1, waste: 0.6, contribution: 2.5, profitTarget: 0, cost: 350 };
  const a = dayActual(plan, { cartons: 96, marginTotal: 96 * 3.1, wasteRecorded: 96 * 0.6 + 15 });
  return { cartons: a.cartons, target: a.target, profit: a.profit, profitTarget: a.profitTarget, gap: a.gap, volume: a.volume, marginVar: a.marginVar, wasteVar: a.wasteVar, costVar: a.costVar };
}
const TRIAL_SPLIT: CartonSplit = { basis: "carton", sale: 35.75, vat: 4.66, purchase: 23.25, waste: 1.16, share: 2.56, profit: 4.12 };
const TRIAL_OPPORTUNITIES: Opportunity[] = [
  { kind: "above", riyal: 11.5, short: "موز أمريكي (السوق فوق المقترح +11.50)", text: "" },
  { kind: "cheaper", riyal: 2, short: "رمان كبير (شراء أرخص +2.00 عند مورد آخر)", text: "" },
];
/** The four lines of «خلاصة اليوم», illustrative, by the screen's own function. */
export function trialBrief(): [string, string, string, string] {
  const rows = Array.from({ length: 4 }, () => ({ publish: true }) as ScreenRow);
  return briefLines({ rows, state: "published", average: 4.12, actual: trialActual(), when: "اليوم", split: TRIAL_SPLIT, opportunities: TRIAL_OPPORTUNITIES });
}
/** The summary's own text of an illustrative day (its five lines as they are, then § 60's). */
export function summaryTrialText(day: string): string {
  const row = (partnerId: number, text: string) => ({ day, partnerId, text, productId: 0, productName: "", quantity: 0 });
  const figures: SummaryFigures = {
    day, tomorrow: { count: 3, total: 1840, unpriced: 0 }, deliveries: { delivered: 5, total: 5 }, collected: 2150, pending: 980,
    coverage: { profit: 225, cost: 350, pct: 64 }, brief: trialBrief(),
    unavailable: unavailableLine(groupUnavailable([row(1, "طماطم"), row(2, "طماطم"), row(2, "طماطم"), row(3, "خيار")])), staffing: [], errors: [],
  };
  return [S60_TRIAL_HEAD, "", summaryText(figures), "", S60_TRIAL_TAIL].join("\n");
}

export interface S60TrialResult { sent: boolean; reason?: string }
/** The trial: his number, his open window, once a day. */
export async function sendSummaryTrial(env: Env, now: number = Date.now()): Promise<S60TrialResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `s60_trial:summary:${day}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const d = gatewayDecision(await sendViaGateway(env, { purpose: SUMMARY_TEST_PURPOSE, to: owner, content: textContent(summaryTrialText(day)), noHold: true, noHoldReason: "تجربة § 60 تُرسل داخل نافذة 24 ساعة فقط" }));
    if (d?.action === "session") { await finishButton(env, claim, DAY_TTL); return { sent: true }; }
    await releaseButton(env, claim);
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
