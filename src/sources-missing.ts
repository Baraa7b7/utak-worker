// § 67 و (2026-10-08) — outside the freeze, for the official start:
//
//   04:30  the sources that have not sent today's prices → ONE alert to Baraa naming each with the day it last
//          sent, and the button «🔁 أعد طلب الأسعار». The button sends the ask again, now, to every source still
//          silent (the form inside its window, its template outside it) — once a day — and answers him in one line.
//   07:30  a day still «فائت» after the 06:00 alert → ONE reminder.
//
// Both are important alerts (`owner_critical`: never blocked, never dropped), both run from the prices tick,
// and neither runs while frozen nor for a time that passed while frozen (src/freeze.ts).

import type { Env } from "./config";
import { ORDERING_HOURS_OPEN } from "./config";
import { call } from "./odoo";
import { buttonsContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhHHMM, riyadhMinutes } from "./hours";
import { arabicDate } from "./wa-params";
import { OWNER_CRITICAL_PURPOSE } from "./owner-alerts";
import { REASK_PAYLOAD } from "./owner-team";
import { OFFER_MODEL, SPECIAL_FIELD, hasOffersToday, loadPriceSources, marketTargets, partnerPriceRole, type PriceRole } from "./price-sources";
import { PLACE_TODAY } from "./places";

export const SOURCES_MISSING_MINUTE = 4 * 60 + 30;
export const MISSED_REMIND_MINUTE = 7 * 60 + 30;
/** Each of the two runs within this long after its minute (a tick that was late), never later. */
export const SOURCES_WINDOW_MIN = 60;
export const REASK_TITLE = "🔁 أعد طلب الأسعار";
export const reaskPayload = (day: string): string => `rsk_${day}`;
const SIM_FIELD = "x_utak_simulation";
const DAY_TTL = 26 * 3600;

export interface SilentSource {
  partnerId: number;
  name: string;
  whatsapp: string;
  /** «شراء»: a supplier asked at 02:00; «سوق»: a market source asked at 02:30. */
  kind: "شراء" | "سوق";
  employeeId: number | null;
  role: PriceRole | null;
  /** The day of his last price on record (YYYY-MM-DD), or null: he never sent one. */
  last: string | null;
}

/** The sources asked today that have not sent a price yet, each with the day of its last one. */
export async function silentSources(env: Env, day: string): Promise<SilentSource[]> {
  const out = new Map<number, SilentSource>();
  // the suppliers the 02:00 ask reached and who have not answered it
  const { silentAskLogs } = await import("./suppliers");
  const ids = [...new Set((await silentAskLogs(env)).map((l) => (l.x_supplier_id as [number, string])[0]))];
  const partners = ids.length
    ? await call<Array<{ id: number; name: string; x_whatsapp_number: string | false }>>(env, "res.partner", "read", { ids, fields: ["id", "name", "x_whatsapp_number"] })
    : [];
  for (const p of partners) {
    out.set(p.id, { partnerId: p.id, name: String(p.name || "").replace(/\s+/g, " ").trim(), whatsapp: String(p.x_whatsapp_number || ""), kind: "شراء", employeeId: null, role: await partnerPriceRole(env, p.id), last: null });
  }
  // the market sources with no offer of today
  for (const t of marketTargets(await loadPriceSources(env))) {
    if (out.has(t.partnerId) || await hasOffersToday(env, t.partnerId, day)) continue;
    out.set(t.partnerId, { partnerId: t.partnerId, name: t.name, whatsapp: t.whatsapp, kind: "سوق", employeeId: t.employeeId, role: t.role, last: null });
  }
  for (const s of out.values()) {
    const [o] = await call<Array<{ x_date: string | false }>>(env, OFFER_MODEL, "search_read", {
      domain: [["x_source_partner_id", "=", s.partnerId], [SIM_FIELD, "!=", true], [SPECIAL_FIELD, "!=", true]], fields: ["x_date"], order: "x_date desc, id desc", limit: 1,
    });
    s.last = typeof o?.x_date === "string" && o.x_date ? o.x_date : null;
  }
  return [...out.values()];
}

export function sourcesMissingText(day: string, silent: SilentSource[], at: string): string {
  return [
    `⏰ ${at} — مصادر لم ترسل أسعار اليوم (${arabicDate(day)}): ${silent.length}`,
    ...silent.map((s) => `• ${s.name} (${s.kind}) — آخر إرسال: ${s.last ? arabicDate(s.last) : "لم يرسل من قبل"}`),
    `«${REASK_TITLE}» يرسل لهم الطلب مرة ثانية الآن.`,
  ].join("\n");
}

export interface SourcesMissingReport { action: "before" | "after" | "claimed_before" | "none" | "alerted" | "not_delivered"; silent?: string[] }

/** 04:30 (the prices tick): the one alert of the day with every silent source, and the button. Throws on Odoo trouble (the claim is released). */
export async function runSourcesMissing(env: Env, now: number = Date.now()): Promise<SourcesMissingReport> {
  const m = riyadhMinutes(new Date(now));
  if (m < SOURCES_MISSING_MINUTE) return { action: "before" };
  if (m >= SOURCES_MISSING_MINUTE + SOURCES_WINDOW_MIN) return { action: "after" };
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return { action: "none" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `src_missing:${day}`, DAY_TTL);
  if (!claim.claimed) return { action: "claimed_before" };
  try {
    const silent = await silentSources(env, day);
    if (!silent.length) { await finishButton(env, claim, DAY_TTL); return { action: "none" }; }
    const d = gatewayDecision(await sendViaGateway({ ...env, AUTO_SEND_JOB: undefined } as Env, {
      purpose: OWNER_CRITICAL_PURPOSE,
      to: owner,
      content: buttonsContent(sourcesMissingText(day, silent, riyadhHHMM(new Date(now))), [{ id: reaskPayload(day), title: REASK_TITLE }]),
    }));
    const taken = d?.action === "session" || d?.action === "held";
    // an alert the gateway did not take is not «the day's one»: the next tick tries again
    if (taken) await finishButton(env, claim, DAY_TTL); else await releaseButton(env, claim);
    return { action: taken ? "alerted" : "not_delivered", silent: silent.map((s) => s.name) };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/**
 * «🔁 أعد طلب الأسعار»: the ask again to every source still silent — once a day. The line Baraa gets back.
 * It is his own act: it goes while frozen too, and outside the automated-send guard.
 */
export async function handleReaskButton(env: Env, buttonId: string, now: number = Date.now()): Promise<string> {
  const day = REASK_PAYLOAD.exec(buttonId)?.[1] ?? "";
  const today = riyadhDateKey(new Date(now));
  if (day !== today) return `هذا تنبيه يوم ${day ? arabicDate(day) : "سابق"}: لا يُعاد منه طلب. أسعار اليوم في ${PLACE_TODAY}.`;
  const claim = await claimButton(env, `src_reask:${day}`, DAY_TTL);
  if (!claim.claimed) return "سبق إعادة طلب الأسعار اليوم من هذا الزر ✅";
  try {
    const silent = await silentSources(env, day);
    if (!silent.length) { await finishButton(env, claim, DAY_TTL); return "كل المصادر أرسلت أسعار اليوم ✅ لا طلب يُعاد."; }
    const { sendFlowAsk, flowNudgeText, sourceKind } = await import("./price-flow");
    const { cutoffLabel } = await import("./templates");
    const aenv = { ...env, AUTO_SEND_JOB: undefined } as Env;
    const parts: string[] = [];
    for (const s of silent) {
      if (!s.whatsapp) { parts.push(`${s.name} ✗ (بلا رقم)`); continue; }
      const src = { partnerId: s.partnerId, employeeId: s.employeeId, name: s.name, whatsapp: s.whatsapp, supplier: s.kind === "شراء", role: s.role };
      const r = await sendFlowAsk(aenv, src, { now, body: flowNudgeText(cutoffLabel(ORDERING_HOURS_OPEN), sourceKind(src)) }).catch((e) => ({ via: null, duplicate: false, reason: (e as Error)?.message }));
      parts.push(r.via === "session" ? `${s.name} ✅ (النموذج)` : r.via === "template" ? `${s.name} ✅ (القالب)` : `${s.name} ✗ (نافذته مغلقة ولا قالب يصله)`);
    }
    await finishButton(env, claim, DAY_TTL);
    return `🔁 أُعيد طلب أسعار اليوم (${riyadhHHMM(new Date(now))}): ${parts.join(" · ")}`;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

export const missedReminderText = (day: string): string =>
  `⏰ تذكير 07:30: أسعار اليوم (${arabicDate(day)}) ما زالت لم تُنشر. «✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً، أو قرارك ثم «نشر المعتمد الآن» في ${PLACE_TODAY}. لا تُعاد أسعار أمس.`;

export interface MissedReminderReport { action: "before" | "after" | "claimed_before" | "not_missed" | "by_owner" | "reminded" | "not_delivered" }

/** 07:30 (the prices tick): ONE reminder when the day is still «فائت» — never for a day Baraa closed himself («لا تنشر»). */
export async function runMissedReminder(env: Env, now: number = Date.now()): Promise<MissedReminderReport> {
  const m = riyadhMinutes(new Date(now));
  if (m < MISSED_REMIND_MINUTE) return { action: "before" };
  if (m >= MISSED_REMIND_MINUTE + SOURCES_WINDOW_MIN) return { action: "after" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `missed_remind:${day}`, DAY_TTL);
  if (!claim.claimed) return { action: "claimed_before" };
  try {
    const { readDay, readLines, OUT_OF_CATALOG_REASON } = await import("./prices");
    const rec = await readDay(env, day);
    if (rec?.x_state !== "missed") { await finishButton(env, claim, DAY_TTL); return { action: "not_missed" }; }
    const inDay = (await readLines(env, rec.id)).filter((l) => l.x_reason !== OUT_OF_CATALOG_REASON);
    if (inDay.length > 0 && inDay.every((l) => l.x_decision === "skip")) { await finishButton(env, claim, DAY_TTL); return { action: "by_owner" }; }
    const { sendOwnerCritical } = await import("./templates");
    const { taken } = await sendOwnerCritical({ ...env, AUTO_SEND_JOB: undefined } as Env, missedReminderText(day), { kind: "prices_missed_remind" });
    if (taken) await finishButton(env, claim, DAY_TTL); else await releaseButton(env, claim);
    return { action: taken ? "reminded" : "not_delivered" };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
