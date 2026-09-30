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
  "x_utak_neighborhood_ids", "resource_calendar_id", "resource_id", "company_id",
] as const;
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
  members: RosterMember[];
  lines: CalendarLine[];
  leaves: LeaveSpan[];
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

/** Reads Odoo (no cache). Throws on Odoo trouble. */
export async function fetchRoster(env: Env, nowMs: number = Date.now()): Promise<Roster> {
  const roles = await roleCodes(env);
  const rows = await call<Array<Record<string, unknown>>>(env, "hr.employee", "search_read", {
    domain: [["x_utak_role_ids", "!=", false]],
    fields: [...EMPLOYEE_FIELDS],
    order: "id asc",
    limit: 200,
  });
  const members: RosterMember[] = [];
  for (const r of rows) {
    const codes = (Array.isArray(r.x_utak_role_ids) ? (r.x_utak_role_ids as number[]) : [])
      .map((id) => roles.get(id))
      .filter((c): c is TeamRole => !!c);
    if (codes.length === 0) continue;
    const wa = typeof r.x_utak_whatsapp === "string" ? r.x_utak_whatsapp.trim() : "";
    members.push({
      employeeId: Number(r.id),
      partnerId: m2oId(r.work_contact_id as M2O) ?? 0,
      name: String(r.name ?? ""),
      whatsapp: digits(wa).length > 3 ? (wa.startsWith("+") ? wa.replace(/[^+\d]/g, "") : `+${digits(wa)}`) : "",
      codes: [...new Set(codes)],
      attendance: r.x_utak_attendance === true,
      calendarId: m2oId(r.resource_calendar_id as M2O),
      calendarName: m2oName(r.resource_calendar_id as M2O),
      resourceId: m2oId(r.resource_id as M2O),
      companyId: m2oId(r.company_id as M2O),
      neighborhoods: Array.isArray(r.x_utak_neighborhood_ids) ? (r.x_utak_neighborhood_ids as number[]) : [],
    });
  }
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
  return { loadedAt: nowMs, members, lines, leaves };
}

/** The roster, from KV when fresh (≤ 5 min). Throws on Odoo trouble. */
export async function loadRoster(env: Env, nowMs: number = Date.now()): Promise<Roster> {
  try {
    const hit = await env.MSG_DEDUP.get(ROSTER_KV);
    if (hit) {
      const r = JSON.parse(hit) as Roster;
      if (r && Array.isArray(r.members) && nowMs - r.loadedAt >= 0 && nowMs - r.loadedAt < ROSTER_TTL * 1000) return r;
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
