// The team roster — hr.employee is the ONLY source (2026-09-25, STATUS § 31).
//
// Locked decisions (Baraa, 2026-09-25):
//   • The team lives in the Employees app. An employee is on UTAK's team when
//     «أدوار UTAK» (x_utak_role_ids → x_employee_role, codes unchanged) is not
//     empty. Its WhatsApp chat is its Work Contact (work_contact_id: the
//     existing partner — conversation, history, number; x_utak_whatsapp is
//     the contact's x_whatsapp_number, else its phone).
//   • res.partner.x_role_ids / x_shift_start / x_neighborhoods stay in Odoo for
//     rollback only: nothing here reads them.
//   • Working days and hours come from the employee's working schedule
//     (resource_calendar_id): a day with no line is a weekly day off; the start
//     of the first period is when «بدء الدوام» goes out; the end of the last
//     period is the end of the shift. Riyadh time.
//   • Time off (hr_holidays is not installed): resource.calendar.leaves, for
//     the employee (resource_id) or for the whole company (no resource). A day
//     whose shift start falls inside a time off: no message, no absence.
//   • Safety: an employee joins attendance only with a working schedule AND
//     «مشمول بالتحضير» (x_utak_attendance) on. Odoo's default «40 hours/week»
//     has no clock times at all (duration lines), so it never sends anything.
//
// § 61 (2026-10-06) — THE JOB IS FIXED AND THE EMPLOYEE CHANGES. An employee's
// roles are HIS JOB'S («أدوار الوظيفة» on hr.job, x_job_role_ids) ∪ the ones on
// his own card («أدوار إضافية (خارج الوظيفة)», x_utak_role_ids — the same field
// as before, its values unchanged). His schedule is the card's when Baraa chose
// one there, else the job's default (the company's own default schedule — the
// one Odoo puts on every new card, with no clock times — is not a choice). He is
// on attendance when the card OR the job says so. Everything that followed the
// roles follows these, with no path of its own: giving a new employee his job is
// all it takes, within the cache's five minutes.
//
// Reads are batched: one hr.employee search_read with only the fields needed
// (the role codes come from a separate 1-hour cache), plus — only when an
// employee is on attendance with a schedule — one read of those schedules'
// lines and one of the time off in the next three weeks. No N+1. The result
// is cached in KV for 5 minutes and dropped at once by the Odoo automations
// «utak.team_roster ← …» (POST /odoo/hook/team-roster) when an employee, a
// schedule line or a time off changes.

import type { Env } from "./config";
import type { TeamMember, TeamRole } from "./types";
import { call } from "./odoo";
import { odooUtcMs, riyadhDateKey, riyadhDayMinuteMs, toOdooUtc } from "./hours";

export const ROSTER_KV = "team:roster:v1";
export const ROLES_KV = "team:roles:v1";
export const ROSTER_TTL = 300;          // ≤ 5 minutes (Baraa)
/** The models whose Odoo automations drop the cache (POST /odoo/hook/team-roster). */
export const TEAM_ROSTER_HOOK_MODELS: readonly string[] = ["hr.employee", "resource.calendar.attendance", "resource.calendar.leaves"];
const ROLES_TTL = 60 * 60;
const LEAVE_WINDOW_DAYS = 21;           // how far ahead a next shift is looked for
const DAY_MS = 24 * 60 * 60 * 1000;

export const EMPLOYEE_FIELDS = [
  "id", "name", "work_contact_id", "x_utak_role_ids", "x_utak_attendance", "x_utak_whatsapp",
  "x_utak_neighborhood_ids", "resource_calendar_id", "resource_id", "company_id", "job_id",
] as const;
/** § 61 — what a job gives its holder. */
export const JOB_MODEL = "hr.job";
export const JOB_FIELDS = ["id", "name", "x_job_role_ids", "x_default_calendar_id", "x_job_attendance"] as const;
export const LINE_FIELDS = [
  "calendar_id", "calendar_type", "dayofweek", "hour_from", "hour_to", "duration_based", "date",
  "recurrency", "recurrency_type", "recurrency_interval", "recurrency_until", "recurrency_excluded_occurences",
] as const;
export const LEAVE_FIELDS = ["id", "name", "resource_id", "calendar_id", "company_id", "date_from", "date_to"] as const;

export interface RosterMember {
  employeeId: number;
  /** The Work Contact: the partner that holds the WhatsApp chat (0 = none). */
  partnerId: number;
  name: string;
  /** «+9665…» from the Work Contact, or "". */
  whatsapp: string;
  codes: TeamRole[];
  /** «مشمول بالتحضير». */
  attendance: boolean;
  calendarId: number | null;
  calendarName: string;
  resourceId: number | null;
  companyId: number | null;
  neighborhoods: number[];
  /** § 61 — his job (hr.job), or null: his roles are his card's alone. */
  jobId: number | null;
  jobName: string;
}
/** § 61 — a job of UTAK: what its holder carries. */
export interface RosterJob {
  id: number;
  name: string;
  codes: TeamRole[];
  calendarId: number | null;
  calendarName: string;
  attendance: boolean;
}
export interface CalendarLine {
  calendarId: number;
  type: "fixed" | "variable";
  dayofweek: string;              // Odoo: Monday = "0" … Sunday = "6"
  hourFrom: number;
  hourTo: number;
  durationBased: boolean;
  date: string | null;
  recurrency: boolean;
  recurrencyType: "days" | "weeks";
  interval: number;
  until: string | null;
  excluded: string[];
}
export interface LeaveSpan {
  id: number;
  name: string;
  resourceId: number | null;
  calendarId: number | null;
  companyId: number | null;
  fromMs: number;
  toMs: number;
}
export interface Roster {
  loadedAt: number;
  /** The team: every active employee with a role — his job's or his card's. */
  members: RosterMember[];
  lines: CalendarLine[];
  leaves: LeaveSpan[];
  /** § 61 — the active jobs. */
  jobs: RosterJob[];
  /** § 61 — every active employee with a job or a role (the members, and a holder of a job without roles). */
  staff: RosterMember[];
}

type M2O = [number, string] | false | null | undefined;
const m2oId = (v: M2O | number): number | null => (Array.isArray(v) ? v[0] : typeof v === "number" && v > 0 ? v : null);
const m2oName = (v: M2O): string => (Array.isArray(v) ? String(v[1] ?? "") : "");
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------- loading

/** Active role id → code (x_employee_role; the archived «Customer» rows map to nothing). */
async function roleCodes(env: Env): Promise<Map<number, TeamRole>> {
  try {
    const hit = await env.MSG_DEDUP.get(ROLES_KV);
    if (hit) return new Map(JSON.parse(hit) as Array<[number, TeamRole]>);
  } catch { /* read again */ }
  const rows = await call<Array<{ id: number; x_code: string }>>(env, "x_employee_role", "search_read", {
    domain: [["x_active", "=", true]], fields: ["id", "x_code"], limit: 50,
  });
  const map = new Map<number, TeamRole>(rows.filter((r) => r.x_code && r.x_code !== "customer").map((r) => [r.id, r.x_code as TeamRole]));
  try { await env.MSG_DEDUP.put(ROLES_KV, JSON.stringify([...map]), { expirationTtl: ROLES_TTL }); } catch { /* next time */ }
  return map;
}

/** A resource.calendar.attendance row (LINE_FIELDS) as the roster keeps it. */
export function toCalendarLine(l: Record<string, unknown>): CalendarLine {
  return {
    calendarId: m2oId(l.calendar_id as M2O) ?? 0,
    type: l.calendar_type === "variable" ? "variable" : "fixed",
    dayofweek: String(l.dayofweek ?? ""),
    hourFrom: Number(l.hour_from) || 0,
    hourTo: Number(l.hour_to) || 0,
    durationBased: l.duration_based === true || (!Number(l.hour_from) && !Number(l.hour_to)),
    date: typeof l.date === "string" ? l.date : null,
    recurrency: l.recurrency === true,
    recurrencyType: l.recurrency_type === "days" ? "days" : "weeks",
    interval: Number(l.recurrency_interval) || 0,
    until: typeof l.recurrency_until === "string" ? l.recurrency_until : null,
    excluded: Array.isArray(l.recurrency_excluded_occurences) ? (l.recurrency_excluded_occurences as unknown[]).map(String) : [],
  };
}

/**
 * § 61 — the roles a member works with: his job's, then what his card adds
 * (no role twice). The job's come first: the card's are «خارج الوظيفة».
 */
export function effectiveCodes(jobCodes: TeamRole[], cardCodes: TeamRole[]): TeamRole[] {
  return [...new Set([...jobCodes, ...cardCodes])];
}
/**
 * § 61 — the schedule a member works by: his card's when one was chosen there,
 * else his job's default. The company's own default schedule on the card is
 * what Odoo puts on every new one, not a choice: the job's default wins it.
 */
export function effectiveCalendar(
  card: { id: number | null; name: string }, job: { id: number | null; name: string } | null, companyDefault: number | null,
): { id: number | null; name: string } {
  if (job?.id && (!card.id || card.id === companyDefault)) return { id: job.id, name: job.name };
  return card;
}

/** Reads Odoo (no cache). Throws on Odoo trouble. */
export async function fetchRoster(env: Env, nowMs: number = Date.now()): Promise<Roster> {
  const roles = await roleCodes(env);
  const codesOf = (ids: unknown): TeamRole[] => [...new Set((Array.isArray(ids) ? (ids as number[]) : []).map((id) => roles.get(id)).filter((c): c is TeamRole => !!c))];
  // § 61 — the jobs first: an employee's roles, schedule and attendance start from his job's
  const jobRows = await call<Array<Record<string, unknown>>>(env, JOB_MODEL, "search_read", { domain: [], fields: [...JOB_FIELDS], order: "sequence asc, id asc", limit: 200 });
  const jobs: RosterJob[] = jobRows.map((j) => ({
    id: Number(j.id),
    name: String(j.name ?? ""),
    codes: codesOf(j.x_job_role_ids),
    calendarId: m2oId(j.x_default_calendar_id as M2O),
    calendarName: m2oName(j.x_default_calendar_id as M2O),
    attendance: j.x_job_attendance === true,
  }));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const rows = await call<Array<Record<string, unknown>>>(env, "hr.employee", "search_read", {
    domain: ["|", ["x_utak_role_ids", "!=", false], ["job_id", "!=", false]],
    fields: [...EMPLOYEE_FIELDS],
    order: "id asc",
    limit: 200,
  });
  // the schedule Odoo puts on a new card by itself, per company (read only when a job's default could replace it)
  const companyDefault = new Map<number, number>();
  if (rows.some((r) => jobById.get(m2oId(r.job_id as M2O) ?? 0)?.calendarId)) {
    const companies = await call<Array<{ id: number; resource_calendar_id: M2O }>>(env, "res.company", "search_read", { domain: [], fields: ["id", "resource_calendar_id"], limit: 20 });
    for (const co of companies) { const cal = m2oId(co.resource_calendar_id); if (cal) companyDefault.set(co.id, cal); }
  }
  const staff: RosterMember[] = [];
  for (const r of rows) {
    // an archived job gives nothing: its holder keeps his card's roles alone
    const job = jobById.get(m2oId(r.job_id as M2O) ?? 0) ?? null;
    const codes = effectiveCodes(job?.codes ?? [], codesOf(r.x_utak_role_ids));
    if (codes.length === 0 && !job) continue;
    const companyId = m2oId(r.company_id as M2O);
    const calendar = effectiveCalendar(
      { id: m2oId(r.resource_calendar_id as M2O), name: m2oName(r.resource_calendar_id as M2O) },
      job ? { id: job.calendarId, name: job.calendarName } : null,
      companyDefault.get(companyId ?? 0) ?? null,
    );
    const wa = typeof r.x_utak_whatsapp === "string" ? r.x_utak_whatsapp.trim() : "";
    staff.push({
      employeeId: Number(r.id),
      partnerId: m2oId(r.work_contact_id as M2O) ?? 0,
      name: String(r.name ?? ""),
      whatsapp: digits(wa).length > 3 ? (wa.startsWith("+") ? wa.replace(/[^+\d]/g, "") : `+${digits(wa)}`) : "",
      codes,
      attendance: r.x_utak_attendance === true || job?.attendance === true,
      calendarId: calendar.id,
      calendarName: calendar.name,
      resourceId: m2oId(r.resource_id as M2O),
      companyId,
      neighborhoods: Array.isArray(r.x_utak_neighborhood_ids) ? (r.x_utak_neighborhood_ids as number[]) : [],
      jobId: job?.id ?? null,
      jobName: job?.name ?? "",
    });
  }
  // the team is who works with a role; a holder of a job without roles is on the staff alone
  const members = staff.filter((m) => m.codes.length > 0);
  // Schedules and time off only for the employees attendance can reach.
  const onAtt = members.filter((m) => m.attendance && m.calendarId);
  let lines: CalendarLine[] = [];
  let leaves: LeaveSpan[] = [];
  if (onAtt.length) {
    const calIds = [...new Set(onAtt.map((m) => m.calendarId as number))];
    const rawLines = await call<Array<Record<string, unknown>>>(env, "resource.calendar.attendance", "search_read", {
      domain: [["calendar_id", "in", calIds]], fields: [...LINE_FIELDS], limit: 500,
    });
    lines = rawLines.map(toCalendarLine);
    const today = riyadhDateKey(new Date(nowMs));
    const from = toOdooUtc(riyadhDayMinuteMs(today, 0) - DAY_MS);
    const to = toOdooUtc(riyadhDayMinuteMs(today, 0) + (LEAVE_WINDOW_DAYS + 1) * DAY_MS);
    const resIds = onAtt.map((m) => m.resourceId).filter((x): x is number => !!x);
    const rawLeaves = await call<Array<Record<string, unknown>>>(env, "resource.calendar.leaves", "search_read", {
      domain: [
        ["count_as", "!=", "working_time"],
        ["date_from", "<=", to],
        ["date_to", ">=", from],
        "|", ["resource_id", "in", resIds], ["resource_id", "=", false],
      ],
      fields: [...LEAVE_FIELDS],
      order: "date_from asc",
      limit: 500,
    });
    leaves = rawLeaves.map((v) => ({
      id: Number(v.id),
      name: String(v.name || ""),
      resourceId: m2oId(v.resource_id as M2O),
      calendarId: m2oId(v.calendar_id as M2O),
      companyId: m2oId(v.company_id as M2O),
      fromMs: odooUtcMs(v.date_from as string),
      toMs: odooUtcMs(v.date_to as string),
    })).filter((v) => Number.isFinite(v.fromMs) && Number.isFinite(v.toMs));
  }
  return { loadedAt: nowMs, members, lines, leaves, jobs, staff };
}

/** The roster, from KV when fresh (≤ 5 min). Throws on Odoo trouble. */
export async function loadRoster(env: Env, nowMs: number = Date.now()): Promise<Roster> {
  try {
    const hit = await env.MSG_DEDUP.get(ROSTER_KV);
    if (hit) {
      const r = JSON.parse(hit) as Roster;
      // § 61 — a roster cached by the code of before (no jobs, no staff) is not this one: read again
      if (r && Array.isArray(r.members) && Array.isArray(r.jobs) && Array.isArray(r.staff) && nowMs - r.loadedAt >= 0 && nowMs - r.loadedAt < ROSTER_TTL * 1000) return r;
    }
  } catch { /* read Odoo */ }
  const r = await fetchRoster(env, nowMs);
  try { await env.MSG_DEDUP.put(ROSTER_KV, JSON.stringify(r), { expirationTtl: ROSTER_TTL }); } catch { /* next time */ }
  return r;
}

/** Drop the cached roster (and role codes): the next read goes to Odoo. */
export async function invalidateRoster(env: Env): Promise<void> {
  await Promise.all([env.MSG_DEDUP.delete(ROSTER_KV), env.MSG_DEDUP.delete(ROLES_KV)].map((p) => p.catch(() => {})));
}

// ---------------------------------------------------------------- lookups

export function toTeamMember(m: RosterMember, role?: TeamRole): TeamMember {
  return {
    id: m.partnerId,
    employeeId: m.employeeId,
    name: m.name,
    x_whatsapp_number: m.whatsapp,
    x_role: role ?? m.codes[0],
    x_role_codes: m.codes,
    x_neighborhoods: m.neighborhoods,
  };
}

/** The employee whose Work Contact number is `num` (digits compared). */
export function memberByNumber(roster: Roster, num: string): RosterMember | null {
  const d = digits(num);
  if (d.length < 4) return null;
  return roster.members.find((m) => m.whatsapp && m.partnerId && digits(m.whatsapp) === d) ?? null;
}
export function memberByPartner(roster: Roster, partnerId: number): RosterMember | null {
  return partnerId ? roster.members.find((m) => m.partnerId === partnerId) ?? null : null;
}
export function membersByRole(roster: Roster, role: TeamRole): RosterMember[] {
  return roster.members.filter((m) => m.codes.includes(role) && m.whatsapp && m.partnerId);
}

// ---------------------------------------------------------------- the working schedule

/** Odoo's dayofweek of a Riyadh calendar day: Monday = 0 … Sunday = 6. */
export function odooWeekday(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * The schedule lines that apply on `day`, as Odoo reads them
 * (resource.calendar._get_working_attendances + attendance._filter_by_date):
 * a fixed schedule uses its weekday lines (no date), a variable one its dated
 * lines (a single date, or a recurrence every N days / weeks until its end,
 * minus excluded dates).
 */
export function linesOn(lines: CalendarLine[], calendarId: number, day: string): CalendarLine[] {
  const wd = String(odooWeekday(day));
  return lines.filter((a) => {
    if (a.calendarId !== calendarId) return false;
    if (a.type === "fixed" ? !!a.date : !a.date) return false;
    if (a.recurrency && a.date) {
      if (!a.interval || a.excluded.includes(day) || day < a.date || (a.until && day > a.until)) return false;
      const d = dayDiff(a.date, day);
      return a.recurrencyType === "days" ? d % a.interval === 0 : d % 7 === 0 && Math.floor(d / 7) % a.interval === 0;
    }
    return a.date ? a.date === day : a.dayofweek === wd;
  });
}

/** The time off (if any) of this member covering `atMs`, mirroring Odoo's _leave_intervals_batch. */
export function leaveAt(roster: Roster, m: RosterMember, atMs: number): LeaveSpan | null {
  return roster.leaves.find((v) => {
    if (!(v.fromMs <= atMs && atMs < v.toMs)) return false;
    if (v.resourceId) return v.resourceId === m.resourceId;
    // company-wide: same company, and no schedule or this member's schedule
    return (v.companyId === null || v.companyId === m.companyId) && (v.calendarId === null || v.calendarId === m.calendarId);
  }) ?? null;
}

export type DayKind = "not_enrolled" | "no_calendar" | "no_number" | "day_off" | "leave" | "no_clock_time" | "work";
export interface DayPlan {
  kind: DayKind;
  day: string;
  /** minutes after Riyadh midnight: start of the first period, end of the last. */
  startMin?: number;
  endMin?: number;
  leave?: string;
}

/** What `day` is for this member: not on attendance, a day off, a time off, or a work day with its hours. */
export function dayPlan(roster: Roster, m: RosterMember, day: string): DayPlan {
  if (!m.attendance) return { kind: "not_enrolled", day };
  if (!m.calendarId) return { kind: "no_calendar", day };
  if (!m.whatsapp) return { kind: "no_number", day };
  const on = linesOn(roster.lines, m.calendarId, day);
  if (on.length === 0) return { kind: "day_off", day };
  const timed = on.filter((l) => !l.durationBased && l.hourTo > l.hourFrom);
  if (timed.length === 0) return { kind: "no_clock_time", day };
  const startMin = Math.round(Math.min(...timed.map((l) => l.hourFrom)) * 60);
  const endMin = Math.round(Math.max(...timed.map((l) => l.hourTo)) * 60);
  const lv = leaveAt(roster, m, riyadhDayMinuteMs(day, startMin));
  if (lv) return { kind: "leave", day, startMin, endMin, leave: lv.name || "إجازة" };
  return { kind: "work", day, startMin, endMin };
}

/** The next work-day start strictly after `fromMs` (up to three weeks ahead), or null. */
export function nextShiftStart(roster: Roster, m: RosterMember, fromMs: number): { day: string; startMin: number; ms: number } | null {
  const today = riyadhDateKey(new Date(fromMs));
  for (let i = 0; i <= LEAVE_WINDOW_DAYS; i++) {
    const day = riyadhDateKey(new Date(riyadhDayMinuteMs(today, 12 * 60) + i * DAY_MS));
    const p = dayPlan(roster, m, day);
    if (p.kind !== "work") {
      if (p.kind === "day_off" || p.kind === "leave" || p.kind === "no_clock_time") continue;
      return null;                                    // not on attendance at all
    }
    const ms = riyadhDayMinuteMs(day, p.startMin as number);
    if (ms > fromMs) return { day, startMin: p.startMin as number, ms };
  }
  return null;
}

/** Can attendance run for this member at all (on attendance, a schedule, a number, clock times)? */
export function onAttendance(p: DayPlan): boolean {
  return p.kind === "work" || p.kind === "day_off" || p.kind === "leave";
}
