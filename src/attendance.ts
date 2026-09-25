// Team attendance — «بدء الدوام» (2026-09-25, STATUS § 29; the working
// schedule and time off since STATUS § 31).
//
// Locked decisions (Baraa, 2026-09-25):
//   • The roster is hr.employee (team-roster.ts): an employee with «أدوار UTAK»,
//     «مشمول بالتحضير» on AND a working schedule (resource_calendar_id). The
//     day's first period start is when utak_shift_start_v2 (purpose
//     team_shift_start, button «بدء الدوام», payload shift_start) goes out; a
//     day without a schedule line is a weekly day off; a time off
//     (resource.calendar.leaves, the employee's or the company's) covering
//     the shift start: no message and no absence that day. Riyadh time.
//   • Their tasks wait until they tap; after the tap they arrive as session
//     messages inside the 24h window the tap opened.
//   • +30 min without a tap: ONE reminder (the same template) and an owner
//     alert «{name} لم يسجّل حضوره».
//   • +60 min without a tap: status «غائب» in Odoo, and an owner alert.
//   • A tap before +60: «حاضر», or «متأخر» after +15. A tap after +60:
//     «متأخر» (not absent), the tasks, and an owner alert.
//   • After the end of the last period (and on a day off / time off): no new
//     task reaches the employee. It waits for the start of their next shift
//     (the next «بدء الدوام» tap), and Baraa gets ONE alert «مهمة لـ{الاسم}
//     بعد دوامه» with the task's name (one per employee, task kind and day).
//   • Baraa: the same template every day only to open his 24h window, so
//     owner alerts reach him as text. No attendance, lateness or alerts about
//     him. The time is fixed: OWNER_WINDOW_OPEN_AT (Riyadh, default 06:00),
//     whoever works that day (STATUS § 32 — it replaced «the earliest shift
//     − 15 min» of § 31: his tap opens the window for 24 hours, so it also
//     covers the dawn alerts of the next day, e.g. a 02:00 shift's +30 / +60).
//   • Nothing is sent twice to the same person on the same day, even if the
//     job runs again.
//
// Records: x_team_attendance (one row per employee per Riyadh day):
// x_employee_id (the old x_partner_id is still written — the Work Contact —
// so a rollback of the worker reads the same rows), x_date, x_shift_at,
// x_sent_at, x_tapped_at, x_status (present|late|absent), x_reminder_sent.
//
// Scheduling: ONE cron every 5 minutes (runAttendanceTick) handles whatever
// is due. Idempotency has two layers: a KV claim per (day, employee, step)
// written before the step (button-lock's claim + read-back), and the Odoo row
// itself (x_sent_at / x_reminder_sent / x_status), so a lost KV key still
// cannot repeat a step that already happened. Template sends also pass the
// auto-send guard (distinct job names: shift_start / shift_remind / owner_window).

import type { Env } from "./config";
import { call } from "./odoo";
import { sendOwnerAlert, sendTemplateByPurpose, T } from "./templates";
import { withAutoSendJob } from "./auto-send-guard";
import { claimButton, releaseButton } from "./button-lock";
import { odooUtcToRiyadhHHMM, riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { flushTeamQueue, TEAM_QUEUE_TTL } from "./team-queue";
import { sendText } from "./meta";
import {
  dayPlan, loadRoster, memberByPartner, nextShiftStart,
  type DayPlan, type Roster, type RosterMember,
} from "./team-roster";

export const ATT_MODEL = "x_team_attendance";
export const SHIFT_START_PAYLOAD = "shift_start";
export const LATE_AFTER_MIN = 15;
export const REMIND_AFTER_MIN = 30;
export const ABSENT_AFTER_MIN = 60;
export const OWNER_WINDOW_DEFAULT = "06:00";
/** fetchMeta's owner guard lets this purpose reach OWNER_WHATSAPP (the window-opening template only). */
export const OWNER_WINDOW_PURPOSE = "owner_window";
const OWNER_TEMPLATE_NAME = "براء";
const CLAIM_TTL = 2 * 24 * 60 * 60;
const MIN = 60_000;
/** The owner alert for a task that reaches an employee after the shift (Baraa's wording). */
export const OFFSHIFT_ALERT_PREFIX = "مهمة لـ";
const MAX_QUEUE_TTL = 30 * 24 * 60 * 60;

export type AttStatus = "present" | "late" | "absent";
export interface AttRow {
  id: number;
  x_date: string;
  x_shift_at: string | false;
  x_sent_at: string | false;
  x_tapped_at: string | false;
  x_status: AttStatus | false;
  x_reminder_sent: boolean;
  x_employee_id: [number, string] | number | false;
}
const ROW_FIELDS = ["id", "x_employee_id", "x_date", "x_shift_at", "x_sent_at", "x_tapped_at", "x_status", "x_reminder_sent"];

// ---------------------------------------------------------------- time
/** 330 → «05:30». */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
/** «06:00» → 360; anything else → null. */
export function parseHHMM(s: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** «الأحد 07:00». */
export function shiftLabel(day: string, startMin: number): string {
  return `${WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${hhmm(startMin)}`;
}

/**
 * Today's window-opening time: fixed, OWNER_WINDOW_OPEN_AT (Riyadh); unset or
 * not «HH:MM» → 06:00. The team's schedules do not move it (STATUS § 32).
 */
export function ownerWindowPlan(env: Env): { minutes: number; source: "OWNER_WINDOW_OPEN_AT" | "default" } {
  const set = parseHHMM(env.OWNER_WINDOW_OPEN_AT);
  return set === null
    ? { minutes: parseHHMM(OWNER_WINDOW_DEFAULT) as number, source: "default" }
    : { minutes: set, source: "OWNER_WINDOW_OPEN_AT" };
}
/** «حاضر» up to +15 min after the shift start, «متأخر» after. */
export function statusForTap(tapMs: number, shiftMs: number): "present" | "late" {
  return tapMs - shiftMs > LATE_AFTER_MIN * MIN ? "late" : "present";
}

const digits = (s: string) => String(s ?? "").replace(/\D/g, "");
const tail = (s: string) => "…" + digits(s).slice(-4);
function isOwnerNumber(env: Env, n: string): boolean {
  const o = digits(env.OWNER_WHATSAPP ?? "");
  return !!o && digits(n) === o;
}

// ---------------------------------------------------------------- Odoo rows
async function readRows(env: Env, day: string, employeeIds: number[]): Promise<Map<number, AttRow>> {
  const rows = await call<AttRow[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_date", "=", day], ["x_employee_id", "in", employeeIds]],
    fields: ROW_FIELDS,
    order: "id asc",
  });
  const out = new Map<number, AttRow>();
  for (const r of rows) {
    const eid = Array.isArray(r.x_employee_id) ? r.x_employee_id[0] : Number(r.x_employee_id);
    if (!out.has(eid)) out.set(eid, r); // the first row of the day is authoritative
  }
  return out;
}
async function findRow(env: Env, employeeId: number, day: string): Promise<AttRow | null> {
  return (await readRows(env, day, [employeeId])).get(employeeId) ?? null;
}
async function writeRow(env: Env, id: number, vals: Record<string, unknown>): Promise<void> {
  await call(env, ATT_MODEL, "write", { ids: [id], vals });
}

// ---------------------------------------------------------------- the 5-minute tick
export interface TickMemberReport {
  id: number;            // hr.employee
  partnerId: number;     // its Work Contact
  name: string; to: string; shift: string | null; end: string | null; roles: string[]; action: string;
}
export interface TickReport { day: string; at: string; owner: { at: string; source: string; action: string }; members: TickMemberReport[] }

export async function runAttendanceTick(env: Env, nowMs: number = Date.now()): Promise<TickReport> {
  const day = riyadhDateKey(new Date(nowMs));
  // Baraa is never on the attendance roster, even if he is an employee one day.
  // His window does not depend on the roster: a roster read that fails still opens it.
  let roster: Roster | null = null;
  let teamError: unknown = null;
  try {
    roster = await loadRoster(env, nowMs);
  } catch (e) {
    teamError = e;
  }
  const team = (roster?.members ?? []).filter((m) => !isOwnerNumber(env, m.whatsapp));
  const plans = roster ? team.map((m) => ({ m, plan: dayPlan(roster as Roster, m, day) })) : [];
  const plan = ownerWindowPlan(env);
  const report: TickReport = { day, at: riyadhHHMM(new Date(nowMs)), owner: { at: hhmm(plan.minutes), source: plan.source, action: "-" }, members: [] };
  try {
    report.owner.action = await ownerWindowStep(env, day, nowMs, plan.minutes);
  } catch (e) {
    report.owner.action = `error: ${(e as Error)?.message}`;
    console.error("[attendance] owner window failed", (e as Error)?.message);
  }
  if (teamError) throw teamError;
  const due = plans.filter((p) => p.plan.kind === "work");
  const rows = due.length ? await readRows(env, day, due.map((p) => p.m.employeeId)) : new Map<number, AttRow>();
  for (const { m, plan: dp } of plans) {
    const base = {
      id: m.employeeId, partnerId: m.partnerId, name: m.name, to: m.whatsapp ? tail(m.whatsapp) : "-",
      shift: dp.startMin === undefined ? null : hhmm(dp.startMin), end: dp.endMin === undefined ? null : hhmm(dp.endMin), roles: m.codes,
    };
    if (dp.kind !== "work") { report.members.push({ ...base, action: dp.kind }); continue; }
    try {
      report.members.push({ ...base, action: await memberStep(env, m, day, dp.startMin as number, rows.get(m.employeeId) ?? null, nowMs) });
    } catch (e) {
      report.members.push({ ...base, action: `error: ${(e as Error)?.message}` });
      console.error(`[attendance] ${m.name} failed`, (e as Error)?.message);
    }
  }
  return report;
}

async function memberStep(env: Env, m: RosterMember, day: string, min: number, row: AttRow | null, nowMs: number): Promise<string> {
  const shiftMs = riyadhDayMinuteMs(day, min);
  const since = nowMs - shiftMs;
  if (since < 0) return "before_shift";
  if (row?.x_tapped_at) return `tapped:${row.x_status || "-"}`;
  if (!row?.x_sent_at) {
    if (row) return "start_not_sent";            // claimed earlier; the send failed or was refused
    if (since >= REMIND_AFTER_MIN * MIN) return "start_window_missed";
    return sendStart(env, m, day, shiftMs, nowMs);
  }
  if (since >= ABSENT_AFTER_MIN * MIN) return row.x_status ? `already:${row.x_status}` : markAbsent(env, m, day, min, row);
  if (since >= REMIND_AFTER_MIN * MIN) return row.x_reminder_sent ? "reminded" : sendReminder(env, m, day, min, row);
  return "waiting";
}

function shiftTemplate(env: Env, job: string, to: string, name: string) {
  return sendTemplateByPurpose(withAutoSendJob(env, job), to, T.TEAM_SHIFT_START, [name || ""],
    [{ index: 0, payload: SHIFT_START_PAYLOAD }]);
}
const claimKey = (day: string, m: RosterMember, step: string) => `att:${day}:e${m.employeeId}:${step}`;

async function sendStart(env: Env, m: RosterMember, day: string, shiftMs: number, nowMs: number): Promise<string> {
  const claim = await claimButton(env, claimKey(day, m, "start"), CLAIM_TTL);
  if (!claim.claimed) return "start_claimed";
  let rowId: number;
  try {
    const found = await findRow(env, m.employeeId, day);
    if (found?.x_sent_at) return "start_sent_before";
    rowId = found?.id ?? (await call<number[]>(env, ATT_MODEL, "create", { vals_list: [{
      x_name: `${m.name} · ${day}`, x_employee_id: m.employeeId, x_partner_id: m.partnerId || false,
      x_date: day, x_shift_at: toOdooUtc(shiftMs), x_reminder_sent: false,
    }] }))[0];
  } catch (e) {
    await releaseButton(env, claim); // nothing sent yet: the next tick may try again
    throw e;
  }
  const r = await shiftTemplate(env, "shift_start", m.whatsapp, m.name);
  if (!r) return "no_template";
  if (!r.ok) return `start_failed:${r.status}`;
  await writeRow(env, rowId, { x_sent_at: toOdooUtc(nowMs) });
  return "start_sent";
}

async function sendReminder(env: Env, m: RosterMember, day: string, min: number, row: AttRow): Promise<string> {
  const claim = await claimButton(env, claimKey(day, m, "remind"), CLAIM_TTL);
  if (!claim.claimed) return "remind_claimed";
  const r = await shiftTemplate(env, "shift_remind", m.whatsapp, m.name);
  const ok = !!r?.ok;
  if (ok) await writeRow(env, row.id, { x_reminder_sent: true });
  await sendOwnerAlert(withAutoSendJob(env, "shift_remind"),
    `⏰ ${m.name} لم يسجّل حضوره: دوامه ${hhmm(min)}، ومضت ${REMIND_AFTER_MIN} دقيقة بلا ضغط «بدء الدوام».${ok ? " أُرسل له تذكير." : " تعذّر إرسال التذكير."}`);
  return ok ? "reminded_now" : "remind_failed";
}

async function markAbsent(env: Env, m: RosterMember, day: string, min: number, row: AttRow): Promise<string> {
  const claim = await claimButton(env, claimKey(day, m, "absent"), CLAIM_TTL);
  if (!claim.claimed) return "absent_claimed";
  const fresh = await findRow(env, m.employeeId, day); // a tap may have landed since the tick read the rows
  if (fresh?.x_tapped_at || fresh?.x_status) return `tapped:${fresh.x_status || "-"}`;
  await writeRow(env, row.id, { x_status: "absent" });
  await sendOwnerAlert(withAutoSendJob(env, "shift_absent"),
    `❌ ${m.name} سُجّل غائباً اليوم: لم يضغط «بدء الدوام» خلال ${ABSENT_AFTER_MIN} دقيقة من دوامه (${hhmm(min)}).`);
  return "absent_now";
}

async function ownerWindowStep(env: Env, day: string, nowMs: number, windowMinutes: number): Promise<string> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return "no_owner";
  const since = nowMs - riyadhDayMinuteMs(day, windowMinutes);
  if (since < 0) return "before";
  if (since >= REMIND_AFTER_MIN * MIN) return "passed";
  const claim = await claimButton(env, `att:${day}:owner:window`, CLAIM_TTL);
  if (!claim.claimed) return "sent_before";
  const r = await sendTemplateByPurpose(withAutoSendJob(env, OWNER_WINDOW_PURPOSE), owner, T.TEAM_SHIFT_START,
    [OWNER_TEMPLATE_NAME], [{ index: 0, payload: SHIFT_START_PAYLOAD }], undefined, { sendPurpose: OWNER_WINDOW_PURPOSE });
  if (!r) return "no_template";
  return r.ok ? "sent" : `failed:${r.status}`;
}

// ---------------------------------------------------------------- the tap
export type TapResult =
  | { kind: "not_on_attendance" }
  | { kind: "owner"; text: string }
  | { kind: "not_started"; text: string }
  | { kind: "off_today"; text: string }
  | { kind: "first" | "again"; status: AttStatus; text: string; afterEnd?: boolean };

/**
 * A team member tapped «بدء الدوام» (payload shift_start) at tapMs (Meta's
 * timestamp); `partnerId` is their Work Contact. Only a tap on today's
 * template counts: before today's template went out, nothing is recorded and
 * no task is released. A tap after the shift has ended is recorded (late)
 * but releases nothing: the tasks wait for the next shift.
 */
export async function recordShiftTap(env: Env, partnerId: number, tapMs: number): Promise<TapResult> {
  const roster = await loadRoster(env, tapMs);
  const m = memberByPartner(roster, partnerId);
  // Baraa, even if he is an employee one day: his tap only opens his window.
  if (m && isOwnerNumber(env, m.whatsapp)) return { kind: "owner", text: ownerWindowAck(tapMs) };
  if (!m) return { kind: "not_on_attendance" };
  const day = riyadhDateKey(new Date(tapMs));
  const plan = dayPlan(roster, m, day);
  if (plan.kind === "day_off" || plan.kind === "leave") return { kind: "off_today", text: offText(roster, m, plan, tapMs) };
  if (plan.kind !== "work") return { kind: "not_on_attendance" };
  const min = plan.startMin as number;
  const shiftMs = riyadhDayMinuteMs(day, min);
  const endMs = riyadhDayMinuteMs(day, plan.endMin as number);
  const row = await findRow(env, m.employeeId, day);
  if (!row || !row.x_sent_at) {
    return { kind: "not_started", text: `دوامك اليوم يبدأ ${hhmm(min)}، ووقتها يوصلك زر «بدء الدوام» ومعه مهامك.` };
  }
  const again = (r: AttRow): TapResult => ({
    kind: "again", status: (r.x_status || "present") as AttStatus,
    text: `دوامك اليوم مسجّل من ${odooUtcToRiyadhHHMM(r.x_tapped_at || undefined)} ✅`,
    afterEnd: tapMs >= endMs,
  });
  if (row.x_tapped_at) return again(row);
  const claim = await claimButton(env, claimKey(day, m, "tap"), CLAIM_TTL);
  if (!claim.claimed) return again({ ...row, x_tapped_at: toOdooUtc(tapMs) });
  const status = statusForTap(tapMs, shiftMs);
  const afterAbsent = row.x_status === "absent" || tapMs - shiftMs >= ABSENT_AFTER_MIN * MIN;
  const afterEnd = tapMs >= endMs;
  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status });
  const at = riyadhHHMM(new Date(tapMs));
  if (afterAbsent) {
    await sendOwnerAlert(env,
      `🕘 ${m.name} سجّل حضوره متأخراً الساعة ${at} (دوامه ${hhmm(min)})${row.x_status === "absent" ? " بعد تسجيله غائباً" : ""}، فسُجّل «متأخر»${afterEnd ? "، ودوامه انتهى فمهامه تصله مع دوامه القادم." : " ووصلته مهامه."}`);
  }
  const next = afterEnd ? nextShiftStart(roster, m, tapMs) : null;
  return {
    kind: "first", status, afterEnd,
    text: afterEnd
      ? `تم تسجيل حضورك الساعة ${at} (متأخر، دوامك ${hhmm(min)}–${hhmm(plan.endMin as number)}). دوامك انتهى، ومهامك توصلك مع بداية دوامك القادم${next ? ` (${shiftLabel(next.day, next.startMin)})` : ""}.`
      : status === "present" ? `تم تسجيل حضورك الساعة ${at} ✅` : `تم تسجيل حضورك الساعة ${at} ✅ (متأخر، دوامك ${hhmm(min)})`,
  };
}

function offText(roster: Roster, m: RosterMember, plan: DayPlan, nowMs: number): string {
  const next = nextShiftStart(roster, m, nowMs);
  return `اليوم ${plan.kind === "leave" ? "إجازتك" : "ما عندك دوام"} حسب جدولك، ومهامك توصلك مع بداية دوامك القادم${next ? ` (${shiftLabel(next.day, next.startMin)})` : ""}.`;
}

// ---------------------------------------------------------------- the gate
export type HoldPhase = "before" | "on" | "after" | "off";
export interface Hold {
  hold: boolean;
  onAttendance: boolean;
  shift?: string;
  sent?: boolean;
  /** before: today's shift, not tapped yet · on: tapped, in shift · after: the shift has ended · off: day off / time off. */
  phase?: HoldPhase;
  /** «الأحد 07:00» — the next shift start (after / off). */
  next?: string;
  /** How long a queued task must survive: until the next shift start + 36 h. */
  queueTtl?: number;
  employeeId?: number;
  name?: string;
}

/**
 * Must a task for this member (by Work Contact) wait? Only an employee on
 * attendance (schedule + «مشمول بالتحضير») is ever held: before today's tap,
 * after the end of today's shift, and on a day off or time off. Any Odoo
 * trouble answers «not held» — the task goes out as it did before
 * attendance existed.
 */
export async function attendanceHold(env: Env, partnerId: number, nowMs: number = Date.now()): Promise<Hold> {
  try {
    const roster = await loadRoster(env, nowMs);
    const m = memberByPartner(roster, partnerId);
    if (!m || isOwnerNumber(env, m.whatsapp)) return { hold: false, onAttendance: false };
    const day = riyadhDateKey(new Date(nowMs));
    const plan = dayPlan(roster, m, day);
    const who = { employeeId: m.employeeId, name: m.name };
    const later = (): Pick<Hold, "next" | "queueTtl"> => {
      const n = nextShiftStart(roster, m, nowMs);
      const ttl = n ? Math.round((n.ms - nowMs) / 1000) + TEAM_QUEUE_TTL : MAX_QUEUE_TTL;
      return { next: n ? shiftLabel(n.day, n.startMin) : undefined, queueTtl: Math.min(MAX_QUEUE_TTL, Math.max(TEAM_QUEUE_TTL, ttl)) };
    };
    if (plan.kind === "day_off" || plan.kind === "leave") return { hold: true, onAttendance: true, phase: "off", ...who, ...later() };
    if (plan.kind !== "work") return { hold: false, onAttendance: false };
    const shift = hhmm(plan.startMin as number);
    if (nowMs >= riyadhDayMinuteMs(day, plan.endMin as number)) return { hold: true, onAttendance: true, shift, phase: "after", sent: true, ...who, ...later() };
    const row = await findRow(env, m.employeeId, day);
    if (row?.x_tapped_at) return { hold: false, onAttendance: true, shift, sent: true, phase: "on", ...who };
    return { hold: true, onAttendance: true, shift, sent: !!row?.x_sent_at, phase: "before", ...who, queueTtl: TEAM_QUEUE_TTL };
  } catch (e) {
    console.warn(`[attendance] hold check failed for ${partnerId} — not holding`, (e as Error)?.message);
    return { hold: false, onAttendance: false };
  }
}

/**
 * attendanceHold for a task, plus the owner alert when the task reaches the
 * member after their shift (or on a day off / time off): ONE alert
 * «مهمة لـ{الاسم} بعد دوامه: {task}» per employee, task kind and Riyadh day.
 */
export async function holdForTask(
  env: Env,
  partnerId: number,
  task: { kind: string; label: string },
  nowMs: number = Date.now(),
): Promise<Hold> {
  const h = await attendanceHold(env, partnerId, nowMs);
  if (h.hold && (h.phase === "after" || h.phase === "off") && h.employeeId) {
    try {
      const day = riyadhDateKey(new Date(nowMs));
      const claim = await claimButton(env, `att:${day}:e${h.employeeId}:offshift:${task.kind}`, CLAIM_TTL);
      if (claim.claimed) {
        // the claim above is the «once per kind and day»; the auto-send guard
        // (owner key = day + job + content hash) only stops an identical re-run.
        await sendOwnerAlert(withAutoSendJob(env, "shift_offtask"),
          `⏳ ${OFFSHIFT_ALERT_PREFIX}${h.name} بعد دوامه: ${task.label}. تصله مع بداية دوامه القادم${h.next ? ` (${h.next})` : ""}.`);
      }
    } catch (e) {
      console.warn(`[attendance] off-shift alert failed for ${h.name}`, (e as Error)?.message);
    }
  }
  return h;
}

/** What a held member is told when they write while held. */
export function holdText(h: Hold): string {
  if (h.phase === "after") return `دوامك اليوم انتهى، ومهامك الجديدة توصلك مع بداية دوامك القادم${h.next ? ` (${h.next})` : ""}.`;
  if (h.phase === "off") return `اليوم ما عندك دوام حسب جدولك، ومهامك توصلك مع بداية دوامك القادم${h.next ? ` (${h.next})` : ""}.`;
  return h.sent
    ? "اضغط «بدء الدوام» في رسالة اليوم، وبعدها توصلك مهامك هنا."
    : `دوامك اليوم يبدأ ${h.shift}، ووقتها يوصلك زر «بدء الدوام» ومعه مهامك.`;
}

export const NO_TASKS_TEXT = "ما عندك مهام الآن. أول ما تجهز توصلك هنا 👍";

/**
 * After the tap: everything queued for the member, then what Odoo says is
 * open for their roles (the warehouse's purchase lists without «تم الشراء»,
 * the collector's unpaid invoices). Returns how many messages went out.
 */
export async function deliverTasksOnTap(env: Env, member: { x_role?: string; x_role_codes?: string[] }, to: string): Promise<number> {
  const codes = new Set([member.x_role, ...(member.x_role_codes ?? [])].filter(Boolean));
  let n = await flushTeamQueue(env, to);
  if (codes.has("warehouse")) {
    const { resendOpenPurchaseLists } = await import("./team");
    n += await resendOpenPurchaseLists(env, to).catch(() => 0);
  }
  if (codes.has("collector")) {
    const { sendCollectorBacklog } = await import("./invoice");
    n += await sendCollectorBacklog(env, to).catch(() => 0);
  }
  if (n === 0) await sendText(env, to, NO_TASKS_TEXT);
  return n;
}

/** Owner tapped «بدء الدوام» on the window-opening template: one line, nothing recorded. */
export function ownerWindowAck(nowMs: number = Date.now()): string {
  return `✅ تم. تنبيهات يو تاك توصلك هنا نصاً حتى ${riyadhHHMM(new Date(nowMs + 24 * 60 * MIN))} بكرة.`;
}
