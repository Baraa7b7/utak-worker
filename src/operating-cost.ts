// § 40 أ (2026-09-26) — the operating costs and the pricing settings.
//
// Budget Management (account_budget) is not installed on the tenant and the
// Analytic Accounting setting is off (scripts/archive/s40-20260926-costs.mjs
// --modules), so the planned costs live in x_operating_cost «💰 التكاليف
// التشغيلية» (Odoo, menu UTAK). dailyOperatingCost(day) is the one function the
// engine, the discount guard and the 21:30 coverage line read:
//   • daily   → the amount, every day inside «من / إلى»;
//   • monthly → the amount ÷ the working days of that month;
//   • yearly  → the amount ÷ the working days of that year;
//   a monthly / yearly share falls on working days only (0 on a day off).
// The working days — § 59 أ: «جدول أيام العمل» of the pricing settings
// (x_pricing_config.x_workdays_calendar_id → resource.calendar), a schedule of
// the company's own that does not follow whoever holds «سائق» (Omar went to
// marketing and the costs must not become «تعذّر» with him). While the
// settings name none: the driver's working schedule, as before § 59
// (hr.employee → resource.calendar, the roster of STATUS § 31). A day with a
// schedule line is a working day. No schedule at all while a monthly / yearly
// line applies → the total is null («تعذّر»), never a guess. Lines marked
// x_utak_simulation are left out.
//
// The pricing settings are on the active x_pricing_config record (UTAK ←
// «💲 التسعير» ← «⚙️ الإعدادات», § 48): x_waste_pct, x_min_order_sar,
// x_planned_stops (empty / 0 = none), — § 46 أ — x_expected_cartons (the carton
// share of the board), and — § 48 أ — x_min_profit_sar «الربح الأدنى للكرتون
// (ريال)» (the suggested profitable price), and — § 48 و — x_outlier_ratio
// «نسبة السعر الشاذ», and — § 53 ب — x_market_uplift_pct «زيادة على سعر السوق ٪»
// (0 = the sale price is the market price), and — § 54 أ — x_above_suggested «لما يكون السوق أعلى
// من المقترح» («بسعر السوق», the default, or «بالمقترح»). § 47's x_min_margin_pct «الهامش الأدنى ٪»
// stays on the record, hidden, and is read by nothing.

import type { Env } from "./config";
import { call } from "./odoo";
import { LINE_FIELDS, linesOn, loadRoster, toCalendarLine, type CalendarLine } from "./team-roster";
import { riyadhDateKey } from "./hours";
import { PRICE_OUTLIER_RATIO } from "./config";
import { DEFAULT_MIN_PROFIT_SAR, aboveSuggestedOf, upliftOf, type AboveSuggested } from "./pricing-engine";

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
  /** § 59 أ — the company's «جدول أيام العمل» (the settings), not a driver's schedule. */
  company?: boolean;
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
  /** § 59 أ — where the working days came from: the company's schedule, the driver's (none named in the settings), or neither. */
  source?: WorkdaysSource | null;
  reason?: string;
}
export type WorkdaysSource = "company" | "driver";

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
    // § 59 أ — the company's schedule without a single line is a schedule not filled in, not «every day is off»
    if (schedule.company && schedule.lines.length === 0) return null;
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
    ...(unread ? { reason: schedule?.company ? NO_COMPANY_DAYS_REASON : schedule ? "لا أيام عمل في جدول دوام السائق" : "لا جدول دوام للسائق في «الموظفون»" } : {}),
  };
}

/** § 59 أ — «تعذّر» when the company's schedule holds no working day in the month (or the year) of the line. */
export const NO_COMPANY_DAYS_REASON = "لا أيام عمل في «جدول أيام العمل» (الإعدادات)";
/** § 59 أ — the field of the pricing settings that names the company's working days. */
export const WORKDAYS_FIELD = "x_workdays_calendar_id";
const WORKDAYS_KV = "cost:workdays:v1";
const WORKDAYS_TTL = 300;

/**
 * § 59 أ — the company's working days: the schedule the active pricing settings of `day` name
 * («جدول أيام العمل»), with its lines (the roster's when it holds them, else one read). Null when the
 * settings name none — and when they cannot be read for the field itself (the caller reads the
 * driver's schedule, as before § 59). The schedule's id and name are kept WORKDAYS_TTL in KV.
 */
export async function companySchedule(env: Env, day: string, nowMs: number = Date.now()): Promise<DriverSchedule | null> {
  let named: { id: number; name: string } | null | undefined;
  try {
    const hit = await env.MSG_DEDUP.get(`${WORKDAYS_KV}:${day}`);
    if (hit) named = (JSON.parse(hit) as { c: { id: number; name: string } | null }).c;
  } catch { /* read Odoo */ }
  if (named === undefined) {
    try {
      const [r] = await call<Array<Record<string, unknown>>>(env, CONFIG_MODEL, "search_read", {
        // the same record readPricingSettings reads: the active settings of `day`
        domain: [["x_active_from", "<=", day], ["x_is_active", "=", true], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
        fields: ["id", WORKDAYS_FIELD],
        order: "x_active_from desc, id desc",
        limit: 1,
      });
      const v = r?.[WORKDAYS_FIELD];
      named = Array.isArray(v) && Number(v[0]) > 0 ? { id: Number(v[0]), name: String(v[1] ?? "") } : typeof v === "number" && v > 0 ? { id: v, name: "" } : null;
    } catch (e) {
      console.warn("[costs] «جدول أيام العمل» could not be read — the driver's schedule, as before", (e as Error)?.message);
      return null;
    }
    try { await env.MSG_DEDUP.put(`${WORKDAYS_KV}:${day}`, JSON.stringify({ c: named }), { expirationTtl: WORKDAYS_TTL }); } catch { /* next time */ }
  }
  if (!named) return null;
  const calendarId = named.id;
  let lines: CalendarLine[] = [];
  try { lines = (await loadRoster(env, nowMs)).lines.filter((l) => l.calendarId === calendarId); } catch { /* its own read below */ }
  if (!lines.length) {
    const raw = await call<Array<Record<string, unknown>>>(env, "resource.calendar.attendance", "search_read", {
      domain: [["calendar_id", "=", calendarId]], fields: [...LINE_FIELDS], limit: 200,
    });
    lines = raw.map(toCalendarLine);
  }
  return { employeeId: 0, name: named.name || "جدول أيام العمل", calendarId, lines, company: true };
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
  const needs = items.some((i) => i.frequency !== "daily");
  // § 59 أ — the company's own working days first; the driver's schedule only while the settings name none
  const schedule = needs ? (await companySchedule(env, day, nowMs)) ?? (await driverSchedule(env, nowMs)) : null;
  return { ...costShares(items, day, schedule), driver: schedule?.name ?? null, source: schedule ? (schedule.company ? "company" : "driver") : null };
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
  /** § 46 أ — الكراتين المتوقعة يومياً (the carton share of «📊 لوحة التسعير»); null = empty. */
  expectedCartons: number | null;
  /** § 48 أ — الربح الأدنى للكرتون (ريال), added to the full net cost (the suggested profitable price); DEFAULT_MIN_PROFIT_SAR when the record carries none. */
  minProfit: number;
  /** § 48 و — نسبة السعر الشاذ: a price that moved this many times (or more) from the same source's last one, either way, is an outlier. PRICE_OUTLIER_RATIO (1.5) when the record carries none, or a value that is not above 1. */
  outlierRatio: number;
  /** § 53 ب — زيادة على سعر السوق ٪: the sale price = the market price × (1 + this ÷ 100), up to the nearest 0.5. 0 (the default, an empty or a negative value) = the market price as it is. */
  marketUpliftPct: number;
  /** § 54 أ — لما يكون السوق أعلى من المقترح: «market» = انشر بسعر السوق (the default, an empty value), «suggested» = انشر بالمقترح. */
  aboveSuggested: AboveSuggested;
}

/** The active x_pricing_config on `day` (the one the menu opens). Null when none. Throws on Odoo trouble. */
export async function readPricingSettings(env: Env, day: string = riyadhDateKey()): Promise<PricingSettings | null> {
  const [r] = await call<Array<{ id: number; x_waste_pct: number | false; x_min_order_sar: number | false; x_planned_stops: number | false; x_expected_cartons: number | false; x_min_profit_sar?: number | false; x_outlier_ratio?: number | false; x_market_uplift_pct?: number | false; x_above_suggested?: string | false }>>(env, CONFIG_MODEL, "search_read", {
    domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
    fields: ["id", "x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons", "x_min_profit_sar", "x_outlier_ratio", "x_market_uplift_pct", "x_above_suggested"],
    order: "x_active_from desc, id desc",
    limit: 1,
  });
  if (!r) return null;
  const stops = Number(r.x_planned_stops) || 0;
  const cartons = Number(r.x_expected_cartons) || 0;
  return {
    configId: r.id,
    wastePct: Math.max(0, Number(r.x_waste_pct) || 0),
    minOrder: Math.max(0, Number(r.x_min_order_sar) || 0),
    plannedStops: stops > 0 ? Math.floor(stops) : null,
    expectedCartons: cartons > 0 ? Math.floor(cartons) : null,
    minProfit: typeof r.x_min_profit_sar === "number" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,
    outlierRatio: typeof r.x_outlier_ratio === "number" && r.x_outlier_ratio > 1 ? r.x_outlier_ratio : PRICE_OUTLIER_RATIO,
    marketUpliftPct: upliftOf(r.x_market_uplift_pct),
    aboveSuggested: aboveSuggestedOf(r.x_above_suggested),
  };
}

/** § 48 و — «نسبة السعر الشاذ» of the day's settings; the default when they cannot be read (an offer is never lost for it). */
export async function readOutlierRatio(env: Env, day: string = riyadhDateKey()): Promise<number> {
  try {
    return (await readPricingSettings(env, day))?.outlierRatio ?? PRICE_OUTLIER_RATIO;
  } catch (e) {
    console.warn("[pricing] the outlier ratio could not be read — the default", (e as Error)?.message);
    return PRICE_OUTLIER_RATIO;
  }
}
