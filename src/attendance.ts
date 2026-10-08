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
//   • +120 min without a tap (two hours — § 68; it was +60): status «غائب» in Odoo, and ONE owner
//     alert, merged with the others of its kind (src/owner-alerts.ts).
//   • A tap before +120: «حاضر», or «متأخر» after +15. A tap after +120:
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
//   • § 59 أ (2026-10-06) — Baraa holds the operating roles himself (Omar went to
//     marketing): he is on the roster as any member, and the tasks follow the
//     roles to him. What stays his alone: the SAME one template a day, now at
//     the start of his own shift (his schedule in «الموظفون», 02:00) instead of
//     OWNER_WINDOW_OPEN_AT — on a day his schedule gives him none, the fixed hour
//     as before; his tap opens his window AND releases his tasks (the queue, the
//     open purchase lists, the uncollected invoices); and still no attendance
//     row, no lateness, no reminder, no «غائب», no «مهمة له بعد دوامه» and no
//     hold about him: a task of his goes out when it is made.
//   • Nothing is sent twice to the same person on the same day, even if the
//     job runs again.
//
//   • § 68 (2026-10-08) — the row is the employee's attendance RECORD: the entry (x_tapped_at, «الدخول»:
//     the tap on «بدء الدوام», or its words written by the member — «بدأت الدوام»), the exit (x_out_at:
//     «🏁 انتهى دوامي», the button under the entry's answer, or its words), the minutes late (x_late_min,
//     only when the status is «متأخر»), the source («واتساب»; a row Baraa makes or edits in Odoo is
//     «يدوي»), and the place of each when the member sends one in the quarter of an hour after it. A day
//     of time off gets its own row («إجازة») when the shift would have started. A member who is not on
//     attendance (no «مشمول بالتحضير», or no schedule of his own) may still write «بدأت الدوام»: his
//     row is made then, late by his own schedule's hours, else by the company's «جدول أيام العمل» — no
//     message, no reminder and no «غائب» ever follow him. Nothing of this is Baraa's (§ 59 أ).
//
// Records: x_team_attendance (one row per employee per Riyadh day):
// x_employee_id (the old x_partner_id is still written — the Work Contact —
// so a rollback of the worker reads the same rows), x_date, x_shift_at,
// x_sent_at, x_tapped_at, x_out_at, x_status (present|late|absent|leave), x_late_min, x_source,
// x_note, x_in_map / x_out_map, x_reminder_sent.
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
import { addDaysYmd, odooUtcMs, odooUtcToRiyadhHHMM, riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { flushTeamQueue, TEAM_QUEUE_TTL } from "./team-queue";
import { sendText } from "./meta";
import { waDigits } from "./wa-window";
import { gatewayDecision } from "./wa-gateway";
import { arabicDate } from "./wa-params";
import {
  LINE_FIELDS, dayPlan, linesOn, loadRoster, memberByPartner, nextShiftStart, toCalendarLine,
  type CalendarLine, type DayPlan, type Roster, type RosterMember,
} from "./team-roster";

export const ATT_MODEL = "x_team_attendance";
export const SHIFT_START_PAYLOAD = "shift_start";
export const LATE_AFTER_MIN = 15;
export const REMIND_AFTER_MIN = 30;
/** § 68 — a work day with no entry two hours after its start is «غائب» (it was one hour). */
export const ABSENT_AFTER_MIN = 120;
/** § 68 — every «غائب» alert is one kind: several inside ten minutes reach Baraa as one message. */
export const ABSENT_ALERT_KIND = "shift_absent";
/** § 68 — «🏁 انتهى دوامي»: the button under the entry's answer (a session button, inside the window the entry opened). */
export const SHIFT_END_PAYLOAD = "shift_end";
export const SHIFT_END_TITLE = "🏁 انتهى دوامي";
/** § 68 — «✅ بدأت الدوام»: the session button under «اضغط بدء الدوام» (the template's own button stays «بدء الدوام»). */
export const SHIFT_START_TITLE = "✅ بدأت الدوام";
/** § 68 — x_source of a row the worker writes; a row made or edited in Odoo is «manual» (Odoo's default). */
export const SOURCE_WHATSAPP = "whatsapp";
export const SOURCE_MANUAL = "manual";
/** § 68 — a place sent this long after an entry or an exit is kept with it. */
export const LOCATION_WINDOW_SEC = 15 * 60;
/** § 68 — an exit closes the entry of today, or yesterday's still open when it is this recent (a shift past midnight). */
export const OPEN_ENTRY_MAX_MS = 18 * 60 * 60 * 1000;
export const OWNER_WINDOW_DEFAULT = "06:00";
/** The send gateway's owner guard lets this purpose reach OWNER_WHATSAPP (the window-opening template only). */
export const OWNER_WINDOW_PURPOSE = "owner_window";
const OWNER_TEMPLATE_NAME = "براء";
const CLAIM_TTL = 2 * 24 * 60 * 60;
const MIN = 60_000;
/** The owner alert for a task that reaches an employee after the shift (Baraa's wording). */
export const OFFSHIFT_ALERT_PREFIX = "مهمة لـ";
const MAX_QUEUE_TTL = 30 * 24 * 60 * 60;

export type AttStatus = "present" | "late" | "absent" | "leave";
export interface AttRow {
  id: number;
  x_date: string;
  x_shift_at: string | false;
  x_sent_at: string | false;
  x_tapped_at: string | false;
  x_status: AttStatus | false;
  x_reminder_sent: boolean;
  x_employee_id: [number, string] | number | false;
  x_out_at?: string | false;
  x_late_min?: number | false;
}
const ROW_FIELDS = ["id", "x_employee_id", "x_date", "x_shift_at", "x_sent_at", "x_tapped_at", "x_status", "x_reminder_sent", "x_out_at", "x_late_min"];

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
/** § 59 أ — the tick's report: the window-opening template followed Baraa's own shift (he holds a team role). */
export const OWNER_OWN_SHIFT = "own_shift";
/** «حاضر» up to +15 min after the shift start, «متأخر» after. */
export function statusForTap(tapMs: number, shiftMs: number): "present" | "late" {
  return tapMs - shiftMs > LATE_AFTER_MIN * MIN ? "late" : "present";
}
/** § 68 — «التأخير (دقيقة)»: the whole minutes after the shift start when the entry is «متأخر», else 0. */
export function lateMinutes(tapMs: number, shiftMs: number): number {
  return statusForTap(tapMs, shiftMs) === "late" ? Math.floor((tapMs - shiftMs) / MIN) : 0;
}

// ---------------------------------------------------------------- § 68: the words
/** A message as its letters alone: no marks, no emoji, one spelling of the alef, the yaa and the taa marbuta. */
function plainWords(text: unknown): string {
  return String(text ?? "").normalize("NFKC").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A0-9a-zA-Z ]+/g, " ").replace(/\s+/g, " ").trim();
}
const IN_WORDS: ReadonlySet<string> = new Set(["بدات الدوام", "بدا الدوام", "بدء الدوام", "بدات دوامي", "بدايه الدوام", "ابدا الدوام", "ابدا دوامي", "سجل حضوري", "تسجيل حضور", "تسجيل دخول", "سجل دخولي"]);
const OUT_WORDS: ReadonlySet<string> = new Set(["انتهي دوامي", "انتهي الدوام", "نهايه الدوام", "نهايه دوامي", "خلص دوامي", "خلصت الدوام", "خلصت دوامي", "انهيت الدوام", "انهيت دوامي", "تسجيل خروج", "سجل خروجي"]);
/** The WHOLE message is «بدأت الدوام» (or one of its like): the member's entry, as the tap on «بدء الدوام». */
export function shiftInCommand(text: unknown): boolean {
  return IN_WORDS.has(plainWords(text));
}
/** The WHOLE message is «انتهى دوامي» (or one of its like): the member's exit. */
export function shiftOutCommand(text: unknown): boolean {
  return OUT_WORDS.has(plainWords(text));
}

const digits = (s: string) => String(s ?? "").replace(/\D/g, "");
const tail = (s: string) => "…" + digits(s).slice(-4);
function isOwnerNumber(env: Env, n: string): boolean {
  const o = digits(env.OWNER_WHATSAPP ?? "");
  return !!o && digits(n) === o;
}

/** § 59 أ — Baraa as a member of the team (he holds a role in «الموظفون»), else null. */
export function ownerMember(env: Env, roster: Roster | null): RosterMember | null {
  return roster?.members.find((m) => m.codes.length > 0 && isOwnerNumber(env, m.whatsapp)) ?? null;
}
/**
 * § 59 أ — the minute Baraa's own shift starts on `day` (he holds a team role and his schedule
 * gives him a work day), else null: his one «بدء الدوام» of the day goes then, not at the fixed hour.
 */
export function ownerShiftStart(env: Env, roster: Roster | null, day: string): number | null {
  const m = ownerMember(env, roster);
  if (!m || !roster) return null;
  const p = dayPlan(roster, m, day);
  return p.kind === "work" ? (p.startMin as number) : null;
}

// ---------------------------------------------------------------- Odoo rows
async function readRows(env: Env, day: string, employeeIds: number[]): Promise<Map<number, AttRow>> {
  const rows = await call<AttRow[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_date", "=", day], ["x_employee_id", "in", employeeIds], ["x_utak_simulation", "!=", true]],
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
/** STATUS § 38 (م12) — the member's status on `day` (null: no row, or not decided yet). Throws on Odoo trouble. */
export async function attendanceStatus(env: Env, employeeId: number, day: string): Promise<AttStatus | null> {
  return (await findRow(env, employeeId, day))?.x_status || null;
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

/** § 67 أ — this step fell inside the freeze: nothing is sent for it, now or later. */
export const FROZEN_MISSED_STEP = "frozen_missed";

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
  // § 59 أ — he holds a team role and works today by his own schedule: his «بدء الدوام» at his shift start
  const ownShift = ownerShiftStart(env, roster, day);
  if (ownShift !== null) plan.minutes = ownShift;
  const report: TickReport = { day, at: riyadhHHMM(new Date(nowMs)), owner: { at: hhmm(plan.minutes), source: ownShift === null ? plan.source : OWNER_OWN_SHIFT, action: "-" }, members: [] };
  // § 67 أ — a shift that began while the system was frozen gets no «بدء الدوام» after the freeze is turned
  // off (nor its reminder, nor «غائب»): everything resumes from the next shift.
  const { freezeView } = await import("./freeze");
  const fz = await freezeView(env, nowMs);
  try {
    report.owner.action = fz.on || fz.missed(riyadhDayMinuteMs(day, plan.minutes)) ? FROZEN_MISSED_STEP : await ownerWindowStep(env, day, nowMs, plan.minutes);
  } catch (e) {
    report.owner.action = `error: ${(e as Error)?.message}`;
    console.error("[attendance] owner window failed", (e as Error)?.message);
  }
  if (teamError) throw teamError;
  const due = plans.filter((p) => p.plan.kind === "work");
  const rows = due.length ? await readRows(env, day, due.map((p) => p.m.employeeId)) : new Map<number, AttRow>();
  // § 68 — everyone this tick marks «غائب» reaches Baraa in ONE alert
  const absent: AbsentNow[] = [];
  for (const { m, plan: dp } of plans) {
    const base = {
      id: m.employeeId, partnerId: m.partnerId, name: m.name, to: m.whatsapp ? tail(m.whatsapp) : "-",
      shift: dp.startMin === undefined ? null : hhmm(dp.startMin), end: dp.endMin === undefined ? null : hhmm(dp.endMin), roles: m.codes,
    };
    if (dp.kind !== "work") {
      // § 68 — a day of time off has its row («إجازة») from the hour the shift would have started: no message
      let action: string = dp.kind;
      if (dp.kind === "leave" && dp.startMin !== undefined && nowMs >= riyadhDayMinuteMs(day, dp.startMin)) {
        try { action = await leaveRow(env, m, day, dp); } catch (e) { action = `leave_error: ${(e as Error)?.message}`; }
      }
      report.members.push({ ...base, action });
      continue;
    }
    if (fz.on || fz.missed(riyadhDayMinuteMs(day, dp.startMin as number))) { report.members.push({ ...base, action: FROZEN_MISSED_STEP }); continue; }
    try {
      report.members.push({ ...base, action: await memberStep(env, m, day, dp.startMin as number, rows.get(m.employeeId) ?? null, nowMs, absent) });
    } catch (e) {
      report.members.push({ ...base, action: `error: ${(e as Error)?.message}` });
      console.error(`[attendance] ${m.name} failed`, (e as Error)?.message);
    }
  }
  if (absent.length) {
    try {
      await sendOwnerAlert(withAutoSendJob(env, "shift_absent"), absentText(absent), { kind: ABSENT_ALERT_KIND });
    } catch (e) {
      console.error("[attendance] the «غائب» alert failed", (e as Error)?.message);
    }
  }
  return report;
}

async function memberStep(env: Env, m: RosterMember, day: string, min: number, row: AttRow | null, nowMs: number, absent: AbsentNow[]): Promise<string> {
  const shiftMs = riyadhDayMinuteMs(day, min);
  const since = nowMs - shiftMs;
  if (since < 0) return "before_shift";
  if (row?.x_tapped_at) return `tapped:${row.x_status || "-"}`;
  if (!row?.x_sent_at) {
    if (row) return "start_not_sent";            // claimed earlier; the send failed or was refused
    if (since >= REMIND_AFTER_MIN * MIN) return "start_window_missed";
    return sendStart(env, m, day, shiftMs, nowMs);
  }
  if (since >= ABSENT_AFTER_MIN * MIN) return row.x_status ? `already:${row.x_status}` : markAbsent(env, m, day, min, row, absent);
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
  if (gatewayDecision(r)?.action === "skipped") return "no_template";
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

async function markAbsent(env: Env, m: RosterMember, day: string, min: number, row: AttRow, absent: AbsentNow[]): Promise<string> {
  const claim = await claimButton(env, claimKey(day, m, "absent"), CLAIM_TTL);
  if (!claim.claimed) return "absent_claimed";
  const fresh = await findRow(env, m.employeeId, day); // a tap may have landed since the tick read the rows
  if (fresh?.x_tapped_at || fresh?.x_status) return `tapped:${fresh.x_status || "-"}`;
  await writeRow(env, row.id, { x_status: "absent" });
  absent.push({ name: m.name, shiftMin: min }); // the tick tells Baraa of all of them at once
  return "absent_now";
}
export interface AbsentNow { name: string; shiftMin: number }
/** § 68 — Baraa's «غائب» alert: one message for everyone a tick marked. */
export function absentText(who: AbsentNow[]): string {
  if (who.length === 1) return `❌ ${who[0].name} سُجّل غائباً اليوم: لم يسجّل دخوله خلال ساعتين من بداية دوامه (${hhmm(who[0].shiftMin)}).`;
  return `❌ سُجّلوا غائبين اليوم (لم يسجّلوا دخولهم خلال ساعتين من بداية الدوام): ${who.map((w) => `${w.name} (${hhmm(w.shiftMin)})`).join("، ")}.`;
}

/** § 68 — the row of a day of time off: «إجازة», once, with the time off's name. Nothing is sent. */
async function leaveRow(env: Env, m: RosterMember, day: string, dp: DayPlan): Promise<string> {
  const claim = await claimButton(env, claimKey(day, m, "leave"), CLAIM_TTL);
  if (!claim.claimed) return "leave";
  try {
    if (await findRow(env, m.employeeId, day)) return "leave";
    await call<number[]>(env, ATT_MODEL, "create", { vals_list: [{
      x_name: `${m.name} · ${day}`, x_employee_id: m.employeeId, x_partner_id: m.partnerId || false, x_date: day,
      x_shift_at: toOdooUtc(riyadhDayMinuteMs(day, dp.startMin as number)), x_status: "leave", x_reminder_sent: false,
      x_source: SOURCE_MANUAL, x_note: `إجازة: ${dp.leave || "إجازة"}`,
    }] });
    return "leave_row";
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

async function ownerWindowStep(env: Env, day: string, nowMs: number, windowMinutes: number): Promise<string> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return "no_owner";
  const since = nowMs - riyadhDayMinuteMs(day, windowMinutes);
  if (since < 0) return "before";
  if (since >= REMIND_AFTER_MIN * MIN) return "passed";
  const claim = await claimButton(env, `att:${day}:owner:window`, CLAIM_TTL);
  if (!claim.claimed) return "sent_before";
  // STATUS § 34 — utak_update_owner is the backup of this message only: it
  // goes when utak_shift_start_v2 cannot (not approved, re-filed MARKETING,
  // dropped today). Its «عرض التحديث» opens the window the same way.
  const { markOpenerSentToday, OPENER_TEMPLATE_NAMES, openerOption } = await import("./wa-opener");
  const r = await sendTemplateByPurpose(withAutoSendJob(env, OWNER_WINDOW_PURPOSE), owner, T.TEAM_SHIFT_START,
    [OWNER_TEMPLATE_NAME], [{ index: 0, payload: SHIFT_START_PAYLOAD }], undefined, {
      sendPurpose: OWNER_WINDOW_PURPOSE,
      fallback: [openerOption("owner", [arabicDate(day), OWNER_OPENER_UPDATE])],
    });
  const d = gatewayDecision(r);
  if (d?.action === "skipped") return "no_template";
  if (d?.action === "template" && OPENER_TEMPLATE_NAMES.has(d.template)) {
    await markOpenerSentToday(env, owner, d.template, nowMs);
    return "sent_backup";
  }
  return r.ok ? "sent" : `failed:${r.status}`;
}
/** The {{2}} of utak_update_owner when it stands in for the 06:00 message (§ 34). */
export const OWNER_OPENER_UPDATE = "تنبيهات اليوم";

// ---------------------------------------------------------------- the tap
export type TapResult =
  | { kind: "not_on_attendance" }
  | { kind: "owner"; text: string }
  | { kind: "not_started"; text: string }
  | { kind: "off_today"; text: string }
  | { kind: "first" | "again"; status: AttStatus; text: string; afterEnd?: boolean; rowId?: number; /** § 68 — a member who is not on attendance: his row, no tasks held for it */ free?: boolean };

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
  // § 68 — not on attendance (no «مشمول بالتحضير», or no schedule with hours): his entry is recorded all the same
  if (plan.kind !== "work") return freeEntry(env, roster, m, day, tapMs);
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
    afterEnd: tapMs >= endMs, rowId: r.id,
  });
  if (row.x_tapped_at) return again(row);
  const claim = await claimButton(env, claimKey(day, m, "tap"), CLAIM_TTL);
  if (!claim.claimed) return again({ ...row, x_tapped_at: toOdooUtc(tapMs) });
  const status = statusForTap(tapMs, shiftMs);
  const afterAbsent = row.x_status === "absent" || tapMs - shiftMs >= ABSENT_AFTER_MIN * MIN;
  const afterEnd = tapMs >= endMs;
  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status, x_late_min: lateMinutes(tapMs, shiftMs), x_source: SOURCE_WHATSAPP });
  await rememberForPlace(env, m.whatsapp, row.id, "in", tapMs);
  const at = riyadhHHMM(new Date(tapMs));
  if (afterAbsent) {
    await sendOwnerAlert(env,
      `🕘 ${m.name} سجّل حضوره متأخراً الساعة ${at} (دوامه ${hhmm(min)})${row.x_status === "absent" ? " بعد تسجيله غائباً" : ""}، فسُجّل «متأخر»${afterEnd ? "، ودوامه انتهى فمهامه تصله مع دوامه القادم." : " ووصلته مهامه."}`);
  }
  const next = afterEnd ? nextShiftStart(roster, m, tapMs) : null;
  return {
    kind: "first", status, afterEnd, rowId: row.id,
    text: afterEnd
      ? `تم تسجيل حضورك الساعة ${at} (متأخر، دوامك ${hhmm(min)}–${hhmm(plan.endMin as number)}). دوامك انتهى، ومهامك توصلك مع بداية دوامك القادم${next ? ` (${shiftLabel(next.day, next.startMin)})` : ""}.`
      : status === "present" ? `تم تسجيل حضورك الساعة ${at} ✅` : `تم تسجيل حضورك الساعة ${at} ✅ (متأخر، دوامك ${hhmm(min)})`,
  };
}

// ---------------------------------------------------------------- § 68: an entry without a shift message
/** The hours `day` has in these lines (first start, last end), or null: a day with no clock hours. */
function daySpan(lines: CalendarLine[], calendarId: number, day: string): { startMin: number; endMin: number } | null {
  const timed = linesOn(lines, calendarId, day).filter((l) => !l.durationBased && l.hourTo > l.hourFrom);
  if (!timed.length) return null;
  return { startMin: Math.round(Math.min(...timed.map((l) => l.hourFrom)) * 60), endMin: Math.round(Math.max(...timed.map((l) => l.hourTo)) * 60) };
}
/**
 * The hours a member who is not on attendance is measured by on `day`: his own schedule's when it has clock
 * hours (a day it gives none is a day off: null), else the company's «جدول أيام العمل» (the settings).
 */
export async function freeShift(env: Env, roster: Roster, m: RosterMember, day: string, nowMs: number): Promise<{ startMin: number; endMin: number } | null> {
  if (m.calendarId) {
    let lines = roster.lines.filter((l) => l.calendarId === m.calendarId);
    if (!lines.length) {
      const raw = await call<Array<Record<string, unknown>>>(env, "resource.calendar.attendance", "search_read", { domain: [["calendar_id", "=", m.calendarId]], fields: [...LINE_FIELDS], limit: 200 });
      lines = raw.map(toCalendarLine);
    }
    if (lines.some((l) => !l.durationBased && l.hourTo > l.hourFrom)) return daySpan(lines, m.calendarId, day);
  }
  const { companySchedule } = await import("./operating-cost");
  const co = await companySchedule(env, day, nowMs);
  return co ? daySpan(co.lines, co.calendarId, day) : null;
}

async function freeEntry(env: Env, roster: Roster, m: RosterMember, day: string, tapMs: number): Promise<TapResult> {
  const row = await findRow(env, m.employeeId, day);
  const again = (r: Pick<AttRow, "id" | "x_status" | "x_tapped_at">): TapResult => ({
    kind: "again", status: (r.x_status || "present") as AttStatus, free: true, rowId: r.id,
    text: `دوامك اليوم مسجّل من ${odooUtcToRiyadhHHMM(r.x_tapped_at || undefined)} ✅`,
  });
  if (row?.x_tapped_at) return again(row);
  const claim = await claimButton(env, claimKey(day, m, "tap"), CLAIM_TTL);
  if (!claim.claimed) return again({ id: row?.id ?? 0, x_status: row?.x_status ?? false, x_tapped_at: toOdooUtc(tapMs) });
  let rowId: number, status: "present" | "late" = "present", shift: { startMin: number; endMin: number } | null = null;
  try {
    shift = await freeShift(env, roster, m, day, tapMs);
    const shiftMs = shift ? riyadhDayMinuteMs(day, shift.startMin) : null;
    if (shiftMs !== null) status = statusForTap(tapMs, shiftMs);
    const vals = { x_tapped_at: toOdooUtc(tapMs), x_status: status, x_late_min: shiftMs === null ? 0 : lateMinutes(tapMs, shiftMs), x_source: SOURCE_WHATSAPP };
    if (row) { await writeRow(env, row.id, vals); rowId = row.id; }
    else {
      rowId = (await call<number[]>(env, ATT_MODEL, "create", { vals_list: [{
        x_name: `${m.name} · ${day}`, x_employee_id: m.employeeId, x_partner_id: m.partnerId || false, x_date: day,
        x_shift_at: shiftMs === null ? false : toOdooUtc(shiftMs), x_reminder_sent: false, ...vals,
      }] }))[0];
    }
  } catch (e) {
    await releaseButton(env, claim); // nothing recorded: his next message may try again
    throw e;
  }
  await rememberForPlace(env, m.whatsapp, rowId, "in", tapMs);
  const at = riyadhHHMM(new Date(tapMs));
  return {
    kind: "first", status, free: true, rowId,
    text: status === "present" || !shift ? `تم تسجيل حضورك الساعة ${at} ✅` : `تم تسجيل حضورك الساعة ${at} ✅ (متأخر، دوامك ${hhmm(shift.startMin)})`,
  };
}

/** What follows an entry's answer: how to end the shift, and the place (optional). */
export const ENTRY_HINT = "عند نهاية دوامك اضغط «🏁 انتهى دوامي» أو اكتبها. (اختياري: أرسل موقعك الآن ليُحفظ مع الدخول)";
export const EXIT_HINT = "(اختياري: أرسل موقعك الآن ليُحفظ مع الخروج)";
export const shiftEndButton = (): { id: string; title: string } => ({ id: SHIFT_END_PAYLOAD, title: SHIFT_END_TITLE });
export const shiftStartButton = (): { id: string; title: string } => ({ id: SHIFT_START_PAYLOAD, title: SHIFT_START_TITLE });

// ---------------------------------------------------------------- § 68: the exit
export type EndResult =
  | { kind: "not_member" }
  | { kind: "owner" | "no_entry"; text: string }
  | { kind: "again" | "done"; text: string; rowId: number; minutes?: number };
export const NO_ENTRY_TEXT = "ما عندك دخول مسجّل اليوم، فلم يُسجَّل خروج. اكتب «بدأت الدوام» أولاً.";
export const OWNER_NO_ATTENDANCE_TEXT = "دوامك لا يُسجَّل: الدخول والخروج لتسجيل دوام الفريق.";
/** 598 → «9 س 58 د». */
export function durationAr(minutes: number): string {
  return `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
}

/** The entry an exit at `outMs` closes: today's, else yesterday's when it is still open and recent. */
async function openEntry(env: Env, employeeId: number, day: string, outMs: number): Promise<AttRow | null> {
  const rows = await call<AttRow[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_employee_id", "=", employeeId], ["x_date", "in", [addDaysYmd(day, -1), day]], ["x_utak_simulation", "!=", true], ["x_tapped_at", "!=", false]],
    fields: ROW_FIELDS, order: "x_date desc, id asc", limit: 4,
  });
  const today = rows.find((r) => r.x_date === day);
  if (today) return today;
  const before = rows.find((r) => r.x_date !== day && !r.x_out_at);
  return before && outMs - odooUtcMs(before.x_tapped_at as string) <= OPEN_ENTRY_MAX_MS ? before : null;
}

/**
 * A member's «🏁 انتهى دوامي» (the button, or its words) at outMs: the exit is written on his open entry, once.
 * No entry: nothing is written. Nothing of Baraa's is recorded. Throws on Odoo trouble.
 */
export async function recordShiftEnd(env: Env, partnerId: number, outMs: number): Promise<EndResult> {
  const roster = await loadRoster(env, outMs);
  const m = memberByPartner(roster, partnerId);
  if (!m) return { kind: "not_member" };
  if (isOwnerNumber(env, m.whatsapp)) return { kind: "owner", text: OWNER_NO_ATTENDANCE_TEXT };
  const row = await openEntry(env, m.employeeId, riyadhDateKey(new Date(outMs)), outMs);
  if (!row) return { kind: "no_entry", text: NO_ENTRY_TEXT };
  const again = (at: string | false | undefined): EndResult => ({ kind: "again", rowId: row.id, text: `خروجك مسجّل من ${odooUtcToRiyadhHHMM(at || undefined)} ✅` });
  if (row.x_out_at) return again(row.x_out_at);
  const claim = await claimButton(env, `att:${row.x_date}:e${m.employeeId}:out`, CLAIM_TTL);
  if (!claim.claimed) return again(toOdooUtc(outMs));
  try {
    await writeRow(env, row.id, { x_out_at: toOdooUtc(outMs) });
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
  await rememberForPlace(env, m.whatsapp, row.id, "out", outMs);
  const minutes = Math.max(0, Math.floor((outMs - odooUtcMs(row.x_tapped_at as string)) / MIN));
  return { kind: "done", rowId: row.id, minutes, text: `تم تسجيل خروجك الساعة ${riyadhHHMM(new Date(outMs))} ✅ — مدة دوامك ${durationAr(minutes)}.` };
}

// ---------------------------------------------------------------- § 68: the place (optional)
const placeKey = (number: string): string => `att_loc:v1:${waDigits(number)}`;
/** The entry or exit just recorded waits a quarter of an hour for a place from this number. */
async function rememberForPlace(env: Env, number: string, rowId: number, which: "in" | "out", atMs: number): Promise<void> {
  try { await env.MSG_DEDUP.put(placeKey(number), JSON.stringify({ rowId, which, at: atMs }), { expirationTtl: LOCATION_WINDOW_SEC }); } catch { /* the place is optional */ }
}
export const mapUrl = (latitude: number, longitude: number): string => `https://maps.google.com/?q=${latitude},${longitude}`;
export const placeSavedText = (which: "in" | "out"): string => `📍 حُفظ موقع ${which === "out" ? "الخروج" : "الدخول"} مع دوامك ✅`;
/**
 * A place a member sent: kept with the entry or the exit he recorded in the last quarter of an hour («in» /
 * «out»), else null — the message is then whatever it was before § 68. Throws on Odoo trouble.
 */
export async function saveShiftPlace(env: Env, from: string, place: { latitude: number; longitude: number }, nowMs: number = Date.now()): Promise<"in" | "out" | null> {
  let rec: { rowId: number; which: "in" | "out"; at: number } | null = null;
  try { const raw = await env.MSG_DEDUP.get(placeKey(from)); rec = raw ? JSON.parse(raw) : null; } catch { return null; }
  if (!rec || !(rec.rowId > 0) || nowMs < rec.at || nowMs - rec.at > LOCATION_WINDOW_SEC * 1000) return null;
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  await writeRow(env, rec.rowId, { [rec.which === "out" ? "x_out_map" : "x_in_map"]: mapUrl(place.latitude, place.longitude) });
  try { await env.MSG_DEDUP.delete(placeKey(from)); } catch { /* it expires */ }
  return rec.which;
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
export async function deliverTasksOnTap(env: Env, member: { x_role?: string; x_role_codes?: string[] }, to: string, o: { quietWhenNone?: boolean } = {}): Promise<number> {
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
  // § 59 أ — Baraa's tap already got its one line («✅ تم…»): no «ما عندك مهام» after it
  if (n === 0 && !o.quietWhenNone) await sendText(env, to, NO_TASKS_TEXT, { purpose: "shift_ack" });
  return n;
}

/** Owner tapped «بدء الدوام» on the window-opening template: one line, nothing recorded. */
export function ownerWindowAck(nowMs: number = Date.now()): string {
  return `✅ تم. تنبيهات يو تاك توصلك هنا نصاً حتى ${riyadhHHMM(new Date(nowMs + 24 * 60 * MIN))} بكرة.`;
}
