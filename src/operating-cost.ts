// § 40 أ (2026-09-26) — the operating costs and the pricing settings.
//
// Budget Management (account_budget) is not installed on the tenant and the
// Analytic Accounting setting is off (scripts/s40-20260926-costs.mjs
// --modules), so the planned costs live in x_operating_cost «💰 التكاليف
// التشغيلية» (Odoo, menu UTAK). dailyOperatingCost(day) is the one function the
// engine, the discount guard and the 21:30 coverage line read:
//   • daily   → the amount, every day inside «من / إلى»;
//   • monthly → the amount ÷ the working days of that month;
//   • yearly  → the amount ÷ the working days of that year;
//   a monthly / yearly share falls on working days only (0 on a day off).
// The working days are the driver's working schedule (hr.employee →
// resource.calendar, the roster of STATUS § 31): a day with a schedule line is
// a working day. No driver schedule while a monthly / yearly line applies →
// the total is null («تعذّر»), never a guess. Lines marked x_utak_simulation are
// left out.
//
// The pricing settings are on the active x_pricing_config record (the existing
// «إعدادات التسعير», menu UTAK ← «⚙️ إعدادات التسعير»): x_waste_pct,
// x_min_order_sar, x_planned_stops (empty / 0 = none).

import type { Env } from "./config";
import { call } from "./odoo";
import { LINE_FIELDS, linesOn, loadRoster, toCalendarLine, type CalendarLine } from "./team-roster";
import { riyadhDateKey } from "./hours";

export const COST_MODEL = "x_operating_cost";
export const CONFIG_MODEL = "x_pricing_config";
const SIM_FIELD = "x_utak_simulation";
const DAY_MS = 24 * 60 * 60 * 1000;

export type Frequency = "daily" | "monthly" | "yearly";
export interface CostItem {
  id: number;
  name: string;
  frequency: Frequency;
  amount: number;
}
export interface CostShare extends CostItem {
  /** This line's share of the day; null = cannot be read (no driver schedule). */
  perDay: number | null;
}
export interface DriverSchedule {
  employeeId: number;
  name: string;
  calendarId: number;
  lines: CalendarLine[];
}
export interface DailyCost {
  day: string;
  /** null = «تعذّر» (a monthly / yearly line without a driver schedule). */
  total: number | null;
  items: CostShare[];
  workingDay: boolean | null;
  monthWorkingDays: number | null;
  yearWorkingDays: number | null;
  driver: string | null;
  reason?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Days of [from, to] (inclusive) with a line in the schedule. */
export function workingDaysBetween(s: DriverSchedule, from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (linesOn(s.lines, s.calendarId, d).length > 0) n++;
  return n;
}
export function isWorkingDay(s: DriverSchedule, day: string): boolean {
  return linesOn(s.lines, s.calendarId, day).length > 0;
}
export function monthBounds(day: string): [string, string] {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${day.slice(0, 7)}-01`, `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`];
}
export function yearBounds(day: string): [string, string] {
  return [`${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`];
}

/** The pure rule: each line's share of `day` (the lines already filtered to those in force that day). */
export function costShares(items: CostItem[], day: string, schedule: DriverSchedule | null): Omit<DailyCost, "driver"> {
  const needs = items.some((i) => i.frequency !== "daily");
  const workingDay = schedule ? isWorkingDay(schedule, day) : null;
  const monthWorkingDays = schedule && needs ? workingDaysBetween(schedule, ...monthBounds(day)) : null;
  const yearWorkingDays = schedule && items.some((i) => i.frequency === "yearly") ? workingDaysBetween(schedule, ...yearBounds(day)) : null;
  const share = (i: CostItem): number | null => {
    if (i.frequency === "daily") return i.amount;
    if (!schedule) return null;
    if (!workingDay) return 0;
    const days = i.frequency === "monthly" ? monthWorkingDays : yearWorkingDays;
    return days && days > 0 ? i.amount / days : null;
  };
  const shares = items.map((i) => ({ ...i, perDay: share(i) }));
  const unread = shares.some((s) => s.perDay === null);
  return {
    day,
    total: unread ? null : round2(shares.reduce((a, s) => a + (s.perDay as number), 0)),
    items: shares,
    workingDay,
    monthWorkingDays,
    yearWorkingDays,
    ...(unread ? { reason: schedule ? "لا أيام عمل في جدول دوام السائق" : "لا جدول دوام للسائق في «الموظفون»" } : {}),
  };
}

/** The first driver (lowest employee id) with a working schedule, and its lines. */
export async function driverSchedule(env: Env, nowMs: number = Date.now()): Promise<DriverSchedule | null> {
  const roster = await loadRoster(env, nowMs);
  const d = roster.members.filter((m) => m.codes.includes("driver") && m.calendarId).sort((a, b) => a.employeeId - b.employeeId)[0];
  if (!d?.calendarId) return null;
  let lines = roster.lines.filter((l) => l.calendarId === d.calendarId);
  if (!lines.length) {
    // not on attendance: the roster did not load its schedule
    const raw = await call<Array<Record<string, unknown>>>(env, "resource.calendar.attendance", "search_read", {
      domain: [["calendar_id", "=", d.calendarId]], fields: [...LINE_FIELDS], limit: 200,
    });
    lines = raw.map(toCalendarLine);
  }
  return { employeeId: d.employeeId, name: d.name, calendarId: d.calendarId, lines };
}

/** The x_operating_cost lines in force on `day` (Riyadh), simulation left out. */
export async function readCostItems(env: Env, day: string): Promise<CostItem[]> {
  const rows = await call<Array<{ id: number; x_name: string | false; x_frequency: string; x_amount: number | false }>>(env, COST_MODEL, "search_read", {
    domain: [["x_date_from", "<=", day], "|", ["x_date_to", "=", false], ["x_date_to", ">=", day], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_name", "x_frequency", "x_amount"],
    order: "id asc",
    limit: 500,
  });
  return rows
    .filter((r) => r.x_frequency === "daily" || r.x_frequency === "monthly" || r.x_frequency === "yearly")
    .map((r) => ({ id: r.id, name: String(r.x_name || ""), frequency: r.x_frequency as Frequency, amount: Number(r.x_amount) || 0 }));
}

/** daily_operating_cost(day): the day's operating cost from x_operating_cost. Throws on Odoo trouble. */
export async function dailyOperatingCost(env: Env, day: string = riyadhDateKey(), nowMs: number = Date.now()): Promise<DailyCost> {
  const items = await readCostItems(env, day);
  const schedule = items.some((i) => i.frequency !== "daily") ? await driverSchedule(env, nowMs) : null;
  return { ...costShares(items, day, schedule), driver: schedule?.name ?? null };
}

// ---------------------------------------------------------------- the settings

export interface PricingSettings {
  configId: number;
  /** نسبة التالف % */
  wastePct: number;
  /** الحد الأدنى للطلب (ريال), before the discount; 0 = none. */
  minOrder: number;
  /** عدد المحطات اليومية المخطط; null = empty. */
  plannedStops: number | null;
}

/** The active x_pricing_config on `day` (the one the menu opens). Null when none. Throws on Odoo trouble. */
export async function readPricingSettings(env: Env, day: string = riyadhDateKey()): Promise<PricingSettings | null> {
  const [r] = await call<Array<{ id: number; x_waste_pct: number | false; x_min_order_sar: number | false; x_planned_stops: number | false }>>(env, CONFIG_MODEL, "search_read", {
    domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
    fields: ["id", "x_waste_pct", "x_min_order_sar", "x_planned_stops"],
    order: "x_active_from desc, id desc",
    limit: 1,
  });
  if (!r) return null;
  const stops = Number(r.x_planned_stops) || 0;
  return {
    configId: r.id,
    wastePct: Math.max(0, Number(r.x_waste_pct) || 0),
    minOrder: Math.max(0, Number(r.x_min_order_sar) || 0),
    plannedStops: stops > 0 ? Math.floor(stops) : null,
  };
}
