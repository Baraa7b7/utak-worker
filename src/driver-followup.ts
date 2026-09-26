// م12 — the driver's end-of-shift follow-up (2026-09-26, STATUS § 38; WA-SCENARIOS م12).
//
// The start of the shift is attendance's (src/attendance.ts: «بدء الدوام», the
// +30 reminder, +60 absence) — nothing here repeats or changes it. The end of
// the shift comes from each driver's own working schedule (hr.employee →
// resource.calendar, read through the roster of src/team-roster.ts), Riyadh
// time, never a fixed hour:
//   • end − 30 min, stops still without «تم التسليم» → ONE message to the
//     driver: how many, and whose (one line: two names, then «و N أخرى»);
//   • end + 30 min, stops still without «تم التسليم» → ONE alert to Baraa with
//     the order numbers and the driver's name;
//   • no stop left → no message at all;
//   • a driver without a working schedule (not on attendance, no schedule, no
//     clock times, no number), absent today, or off today (a day off or a time
//     off): no reminder, and ONE alert to Baraa that names the reason — at
//     end − 30 min for the absent driver, at DRIVER_NO_SHIFT_CHECK_AT (18:00)
//     for the others.
// Every step claims its KV key BEFORE it sends (button-lock's claim + read-
// back), so a re-run, a retry or two ticks at once never send twice.
//
// «A stop without «تم التسليم»»: an x_delivery_stop not «delivered», on one of
// the driver's routes dispatched in the last ROUTE_LOOKBACK_H hours (a route
// built the evening before, or held over a day off), whose order is still
// «in_delivery» (not delivered, closed or cancelled) and not marked
// x_utak_simulation. A stop marked «مشكلة» counts: it has no «تم التسليم».
//
// Scheduling: the sim cron DRIVER_FOLLOWUP_CRON (every 5 minutes, two minutes
// after the attendance tick) runs runDriverFollowupTick, which acts only when a
// step is due. A step the cron missed may still go up to STEP_GRACE_MIN late
// (the reminder only until the end of the shift).

import type { Env } from "./config";
import { call } from "./odoo";
import { sendText } from "./meta";
import { sendOwnerAlert } from "./templates";
import { withAutoSendJob } from "./auto-send-guard";
import { claimButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { attendanceStatus, hhmm } from "./attendance";
import { dayPlan, loadRoster, type DayPlan, type RosterMember } from "./team-roster";
import { SIM_FIELD } from "./supplier-pay";

/** The sim cron of this follow-up (wrangler.toml [env.sim.triggers], src/auto-send-guard.ts CRON_JOB). */
export const DRIVER_FOLLOWUP_CRON = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
export const DRIVER_FOLLOWUP_JOB = "driver_followup";
export const REMIND_BEFORE_END_MIN = 30;
export const ALERT_AFTER_END_MIN = 30;
/** Riyadh minute of the one check for a driver without a working schedule, or off today. */
export const DRIVER_NO_SHIFT_CHECK_AT = 18 * 60;
/** How long after its time a step the cron missed may still go. */
export const STEP_GRACE_MIN = 6 * 60;
export const ROUTE_LOOKBACK_H = 72;
export const DRIVER_REMIND_PURPOSE = "driver_stops_left";
const CLAIM_TTL = 3 * 24 * 60 * 60;
const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;

export interface OpenStop {
  stopId: number;
  routeId: number;
  orderId: number;
  customerName: string;
  status: "pending" | "issue";
}

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const stripRef = (s: string) => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

/**
 * The driver's stops still without «تم التسليم» (see the header), in route
 * order: routes by dispatch time, stops by x_sequence. One per order.
 * Throws on Odoo trouble.
 */
export async function openStopsForDriver(env: Env, partnerId: number, sinceMs: number): Promise<OpenStop[]> {
  if (!partnerId) return [];
  const routes = await call<Array<{ id: number; x_dispatched_at: string | false }>>(env, "x_delivery_route", "search_read", {
    domain: [["x_driver_id", "=", partnerId], ["x_dispatched_at", ">=", toOdooUtc(sinceMs)], ["x_status", "!=", "cancelled"]],
    fields: ["id", "x_dispatched_at"],
    order: "x_dispatched_at asc, id asc",
    limit: 50,
  });
  if (routes.length === 0) return [];
  const routeRank = new Map(routes.map((r, i) => [r.id, i]));
  const stops = await call<Array<{ id: number; x_route_id: M2O; x_order_id: M2O; x_sequence: number | false; x_status: string }>>(
    env, "x_delivery_stop", "search_read", {
      domain: [["x_route_id", "in", routes.map((r) => r.id)], ["x_status", "!=", "delivered"]],
      fields: ["id", "x_route_id", "x_order_id", "x_sequence", "x_status"],
      limit: 500,
    });
  if (stops.length === 0) return [];
  const orderIds = [...new Set(stops.map((s) => m2oId(s.x_order_id)).filter(Boolean))];
  const orders = await call<Array<{ id: number; x_state: string | false; x_customer_id: M2O } & Record<string, unknown>>>(
    env, "x_daily_order", "read", { ids: orderIds, fields: ["id", "x_state", "x_customer_id", SIM_FIELD] });
  const open = new Map(orders.filter((o) => o.x_state === "in_delivery" && o[SIM_FIELD] !== true).map((o) => [o.id, o]));
  const out: OpenStop[] = [];
  const seen = new Set<number>();
  const sorted = [...stops].sort((a, b) =>
    (routeRank.get(m2oId(a.x_route_id)) ?? 0) - (routeRank.get(m2oId(b.x_route_id)) ?? 0)
    || Number(a.x_sequence || 0) - Number(b.x_sequence || 0) || a.id - b.id);
  for (const s of sorted) {
    const oid = m2oId(s.x_order_id);
    const o = open.get(oid);
    if (!o || seen.has(oid)) continue;
    seen.add(oid);
    out.push({
      stopId: s.id,
      routeId: m2oId(s.x_route_id),
      orderId: oid,
      customerName: Array.isArray(o.x_customer_id) ? stripRef(o.x_customer_id[1]) : "عميل",
      status: s.x_status === "issue" ? "issue" : "pending",
    });
  }
  return out;
}

// ---------------------------------------------------------------- texts

/** 1 → «محطة واحدة», 2 → «محطتان», 3–10 → «3 محطات», 11+ → «11 محطة». */
export function countAr(n: number, w: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return w.one;
  if (n === 2) return w.two;
  return `${n} ${n <= 10 ? w.few : w.many}`;
}
const STOPS = { one: "محطة واحدة", two: "محطتان", few: "محطات", many: "محطة" };
const ORDERS = { one: "طلب واحد", two: "طلبان", few: "طلبات", many: "طلباً" };

/** One line, cut after two items: «أ»، «أ وب»، «أ، ب و 3 أخرى». */
export function twoAndMore(items: string[]): string {
  const list = items.map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "-";
  if (list.length === 2) return `${list[0]} و${list[1]}`;
  return `${list[0]}، ${list[1]} و ${list.length - 2} أخرى`;
}

/** «#12، #15 (مشكلة)، #18» — every order, up to 20, then «و N أخرى». */
export function orderList(stops: OpenStop[], max = 20): string {
  const shown = stops.slice(0, max).map((s) => `#${s.orderId}${s.status === "issue" ? " (مشكلة)" : ""}`);
  return stops.length > max ? `${shown.join("، ")} و ${stops.length - max} أخرى` : shown.join("، ");
}

export function driverReminderText(stops: OpenStop[], endMin: number): string {
  return `⏰ باقي ${REMIND_BEFORE_END_MIN} دقيقة على نهاية دوامك (${hhmm(endMin)})، وعندك ${countAr(stops.length, STOPS)} بلا «تم التسليم»: ` +
    `${twoAndMore(stops.map((s) => s.customerName))}. اضغط «تم التسليم» على كل توصيلة توصّلها، أو «فيه مشكلة» لو فيه عائق.`;
}

export function ownerAfterShiftText(name: string, stops: OpenStop[], endMin: number): string {
  return `🚚 ${name}: انتهى دوامه الساعة ${hhmm(endMin)}، وبقي ${countAr(stops.length, ORDERS)} بلا «تم التسليم»: ${orderList(stops)}. ` +
    `لا فاتورة ولا تحصيل لها حتى يُضغط «تم التسليم».`;
}

export function ownerReasonText(name: string, reason: string, stops: OpenStop[]): string {
  return `⚠️ ${name} ${reason}، فلا تذكير له بمحطاته. بقي ${countAr(stops.length, ORDERS)} بلا «تم التسليم»: ${orderList(stops)}.`;
}

/** Why a driver gets no reminder today (the words of Baraa's alert). */
export function noShiftReason(p: DayPlan): string {
  switch (p.kind) {
    case "not_enrolled": return "بلا جدول دوام مفعّل (غير مشمول بالتحضير)";
    case "no_calendar": return "بلا جدول دوام في Odoo";
    case "no_clock_time": return "جدول دوامه بلا ساعات";
    case "no_number": return "بلا رقم واتساب في Odoo";
    case "day_off": return "في يوم راحته اليوم حسب جدوله";
    case "leave": return `في إجازة اليوم${p.leave ? ` (${p.leave})` : ""}`;
    default: return "بلا دوام اليوم";
  }
}
export const ABSENT_REASON = "سُجّل غائباً اليوم";

// ---------------------------------------------------------------- the tick

export interface DriverFollowupReport {
  day: string;
  at: string;
  drivers: Array<{ id: number; name: string; steps: string[] }>;
}

const claimKey = (day: string, m: RosterMember, step: string) => `drvf:${day}:e${m.employeeId}:${step}`;

export async function runDriverFollowupTick(rawEnv: Env, nowMs: number = Date.now()): Promise<DriverFollowupReport> {
  const env = withAutoSendJob(rawEnv, DRIVER_FOLLOWUP_JOB);
  const today = riyadhDateKey(new Date(nowMs));
  const yesterday = riyadhDateKey(new Date(nowMs - DAY_MS));
  const report: DriverFollowupReport = { day: today, at: riyadhHHMM(new Date(nowMs)), drivers: [] };
  const roster = await loadRoster(env, nowMs);
  const owner = digits(env.OWNER_WHATSAPP ?? "");
  const drivers = roster.members.filter((m) => m.codes.includes("driver") && m.partnerId && !(owner && digits(m.whatsapp) === owner));
  for (const m of drivers) {
    const steps: string[] = [];
    // yesterday's shift too: one that ends near midnight has its +30 after it
    for (const day of [yesterday, today]) {
      const plan = dayPlan(roster, m, day);
      try {
        if (plan.kind === "work") steps.push(`${day}:${await workStep(env, m, day, plan, nowMs)}`);
        else if (day === today) steps.push(`${day}:${await noShiftStep(env, m, day, plan, nowMs)}`);
      } catch (e) {
        steps.push(`${day}:error: ${(e as Error)?.message}`);
        console.error(`[driver-followup] ${m.name} ${day} failed`, (e as Error)?.message);
      }
    }
    report.drivers.push({ id: m.employeeId, name: m.name, steps });
  }
  return report;
}

async function workStep(env: Env, m: RosterMember, day: string, plan: DayPlan, nowMs: number): Promise<string> {
  const endMin = plan.endMin as number;
  const endMs = riyadhDayMinuteMs(day, endMin);
  const remindAt = endMs - REMIND_BEFORE_END_MIN * MIN;
  const alertAt = endMs + ALERT_AFTER_END_MIN * MIN;
  const inRemind = nowMs >= remindAt && nowMs < endMs;
  const inAlert = nowMs >= alertAt && nowMs < alertAt + STEP_GRACE_MIN * MIN;
  if (!inRemind && !inAlert) return "-";
  // absent today: no reminder, one alert with the reason (the same claim at both times)
  if ((await attendanceStatus(env, m.employeeId, day)) === "absent") {
    return reasonStep(env, m, day, ABSENT_REASON, endMs);
  }
  const stops = await openStopsForDriver(env, m.partnerId, endMs - ROUTE_LOOKBACK_H * 60 * MIN);
  if (stops.length === 0) return inRemind ? "remind:no_stops" : "alert:no_stops";
  if (inRemind) {
    const claim = await claimButton(env, claimKey(day, m, "remind"), CLAIM_TTL);
    if (!claim.claimed) return "remind:claimed";
    // the reminder is worth nothing after the end of the shift: held no longer than that
    const r = await sendText(env, m.whatsapp, driverReminderText(stops, endMin), { purpose: DRIVER_REMIND_PURPOSE, expiresAt: endMs });
    return `remind:${stops.length}:${r.ok ? "sent" : `status_${r.status}`}`;
  }
  const claim = await claimButton(env, claimKey(day, m, "alert"), CLAIM_TTL);
  if (!claim.claimed) return "alert:claimed";
  await sendOwnerAlert(env, ownerAfterShiftText(m.name, stops, endMin));
  return `alert:${stops.length}`;
}

async function noShiftStep(env: Env, m: RosterMember, day: string, plan: DayPlan, nowMs: number): Promise<string> {
  const at = riyadhDayMinuteMs(day, DRIVER_NO_SHIFT_CHECK_AT);
  if (nowMs < at || nowMs >= at + STEP_GRACE_MIN * MIN) return `${plan.kind}:-`;
  return `${plan.kind}:${await reasonStep(env, m, day, noShiftReason(plan), at)}`;
}

/** The one alert to Baraa for a driver who gets no reminder today. */
async function reasonStep(env: Env, m: RosterMember, day: string, reason: string, refMs: number): Promise<string> {
  const stops = await openStopsForDriver(env, m.partnerId, refMs - ROUTE_LOOKBACK_H * 60 * MIN);
  if (stops.length === 0) return "reason:no_stops";
  const claim = await claimButton(env, claimKey(day, m, "reason"), CLAIM_TTL);
  if (!claim.claimed) return "reason:claimed";
  await sendOwnerAlert(env, ownerReasonText(m.name, reason, stops));
  return `reason:${stops.length}`;
}
