// § 60 ب (2026-10-06) — the day's target against what was really sold.
//
// THE CARTON'S CONTRIBUTION (§ 60 أ 3) = the sale ÷ 1.15 − the purchase − the waste: what a carton leaves
// to cover the day's operating cost. No carton share in it — the profit of the engine, the decision and
// the review (profitAt, src/price-review.ts) keeps its share and is not touched; the contribution stands
// BESIDE it on the screen.
//
// THE PLAN of a day, with every run of the engine, from the items that go out as things stand:
//   m̄_plan = the mean of (sale ÷ 1.15 − purchase), w̄_plan = the mean of the waste (the settings' waste %
//   × the purchase), c_plan = m̄_plan − w̄_plan — a simple mean, and one weighted by the cartons really
//   delivered in the last seven days once real sales of those items exist;
//   T = (C_plan + P) ÷ c_plan — «🎯 هدف اليوم: N كرتون», C_plan the day's operating cost and P «هدف الربح
//   اليومي» of the settings. c_plan ≤ 0: «لا هدف ممكن بأسعار اليوم».
//
// THE ACTUAL of a day, with the 21:30 summary (src/owner-summary.ts), from the real orders delivered that
// Riyadh day (never a simulation's):
//   Q = the cartons delivered, m̄_act = the mean of (sale ÷ 1.15 − purchase) over them (each line at its
//   own price and the purchase price of its price day; an invoice's discount comes off),
//   W_act = what the delivery form recorded as «تالف» or «رفضه العميل» at its purchase price — nothing
//   recorded: Q × w̄_plan — and C_act = C_plan (the real expenses are set against the plan by the week,
//   src/day-tabs.ts). A = Q × m̄_act − W_act − C_act.
// The gap to the target, A − P, is the sum of four parts, to the halala (varianceParts):
//   the volume  (Q − T) × c_plan            the margin  Q × (m̄_act − m̄_plan)
//   the waste   −(W_act − Q × w̄_plan)       the costs   −(C_act − C_plan)
// «عجز 125: الكمية −110 · التالف −15». A day without a real delivery: «لا مبيعات حقيقية بعد».
// Every number is kept on the day's own record (x_plan_*, x_act_*, x_var_*; scripts/lib/s58-odoo.mjs).
// On the screen it is a sentence and its numbers, no drawing (Baraa's amendment): «🎯 الهدف مقابل الفعلي»
// under the tiles, and ONE line of «خلاصة اليوم» (briefActualLine: the largest reason alone).

import type { Env } from "./config";
import { profitVatRate } from "./config";
import { call } from "./odoo";
import { toOdooUtc, riyadhDayMinuteMs } from "./hours";
import { dailyOperatingCost } from "./operating-cost";

export const DAY_MODEL = "x_price_day";
const SIM_FIELD = "x_utak_simulation";
const DAY_MS = 24 * 3600_000;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const fixed2 = (n: number): string => round2(n).toFixed(2);
/** «+125», «−110» (U+2212), «0»: whole riyals, with its sign whenever it has one. */
export function signedInt(x: number): string {
  const n = Math.round(x);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}
/** «96», «12.5»: cartons as they are, two decimals at most. */
export const cartonsText = (q: number): string => String(round2(q));

// ---------------------------------------------------------------- the carton's contribution

/**
 * A carton's contribution at a sale price: the board's own net sale (price ÷ 1.15, rounded) minus the
 * purchase and the waste — the profit of profitAt plus the carton share. Null without a purchase price
 * or a price. Pure.
 */
export function contributionAt(l: { purchase: number; waste: number; vatPct: number | null }, price: number): number | null {
  if (!(l.purchase > 0) || !(price > 0)) return null;
  const d = l.vatPct ? 1 + l.vatPct / 100 : 1;
  return round2(round2(price / d) - l.purchase - (Number(l.waste) || 0));
}

// ---------------------------------------------------------------- the plan

/** One item that goes out: its margin (sale ÷ 1.15 − purchase) and its planned waste, per carton. */
export interface PlanItem { key: string; margin: number; waste: number }
export type PlanBasis = "simple" | "weighted";
export const PLAN_BASIS_TEXT: Readonly<Record<PlanBasis, string>> = { simple: "متوسط بسيط", weighted: "مرجّح بمبيعات آخر 7 أيام" };
export type NoTarget = "" | "no_items" | "no_cost" | "no_contribution";
export interface DayPlan {
  /** How many items the means were made of. */
  items: number;
  margin: number;
  waste: number;
  contribution: number;
  basis: PlanBasis;
  profitTarget: number;
  /** The day's operating cost; null = «تعذّر». */
  cost: number | null;
  /** T, as it is (not rounded up); 0 = no target. */
  target: number;
  why: NoTarget;
}

/**
 * The plan of a day. `mix`: the cartons really delivered of each item in the last seven days — with one
 * of the day's items in it the means are weighted by it (an item never sold weighs nothing); else they
 * are simple. Pure.
 */
export function dayPlan(items: PlanItem[], cost: number | null, profitTarget: number, mix?: ReadonlyMap<string, number>): DayPlan {
  const P = profitTarget > 0 ? round2(profitTarget) : 0;
  const weights = items.map((i) => Math.max(0, Number(mix?.get(i.key)) || 0));
  const sold = weights.reduce((a, b) => a + b, 0);
  const basis: PlanBasis = sold > 0 ? "weighted" : "simple";
  const w = basis === "weighted" ? weights : items.map(() => 1), total = w.reduce((a, b) => a + b, 0);
  const mean = (of: (i: PlanItem) => number): number => (total > 0 ? round2(items.reduce((a, i, k) => a + of(i) * w[k], 0) / total) : 0);
  const margin = mean((i) => i.margin), waste = mean((i) => i.waste), contribution = round2(margin - waste);
  const why: NoTarget = !items.length ? "no_items" : cost === null ? "no_cost" : contribution > 0 ? "" : "no_contribution";
  return { items: items.length, margin, waste, contribution, basis, profitTarget: P, cost, target: why ? 0 : r6(((cost as number) + P) / contribution), why };
}

/** The whole cartons of a target: 205.2 → 206 (a carton short does not cover it). */
export const targetCartons = (t: number): number => (t > 0 ? Math.ceil(r6(t)) : 0);

export const PLAN_FIELDS = ["x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_plan_basis", "x_profit_target", "x_target_cartons"] as const;
export type PlanVals = Record<(typeof PLAN_FIELDS)[number], string | number>;
/** The plan as the day's record keeps it. */
export function planVals(p: DayPlan): PlanVals {
  return { x_plan_margin: p.margin, x_plan_waste: p.waste, x_plan_contribution: p.contribution, x_plan_basis: p.basis, x_profit_target: p.profitTarget, x_target_cartons: round2(p.target) };
}

export const NO_TARGET_TEXT: Readonly<Record<Exclude<NoTarget, "">, string>> = {
  no_contribution: "لا هدف ممكن بأسعار اليوم",
  no_items: "لا صنف قابل للنشر اليوم",
  no_cost: "تعذّر (تكلفة اليوم لم تُقرأ)",
};
/** «🎯 هدف اليوم: 206 كرتون»; none: «🎯 هدف اليوم: لا هدف ممكن بأسعار اليوم». */
export function targetText(p: Pick<DayPlan, "target" | "why">): string {
  return `🎯 هدف اليوم: ${p.why ? NO_TARGET_TEXT[p.why] : `${targetCartons(p.target)} كرتون`}`;
}
/** «(تكلفة التشغيل 641.23 + هدف الربح 0.00) ÷ متوسط مساهمة الكرتون 3.12 — متوسط بسيط لـ 4 أصناف». "" without a mean. */
export function targetFormula(p: DayPlan): string {
  if (!p.items || p.cost === null) return "";
  return `(تكلفة التشغيل ${fixed2(p.cost)} + هدف الربح ${fixed2(p.profitTarget)}) ÷ متوسط مساهمة الكرتون ${fixed2(p.contribution)} — ${PLAN_BASIS_TEXT[p.basis]} لـ ${p.items} ${p.items === 1 ? "صنف" : p.items <= 10 ? "أصناف" : "صنفاً"}`;
}
/** «🎯 لتغطية التشغيل بأسعار اليوم تحتاج N كرتون» — the cost alone, no profit target; "" when it cannot be said. */
export function coverText(p: Pick<DayPlan, "cost" | "contribution" | "items">): string {
  if (!p.items || p.cost === null) return "";
  return p.contribution > 0 ? `🎯 لتغطية التشغيل بأسعار اليوم تحتاج ${targetCartons(p.cost / p.contribution)} كرتون` : `🎯 ${NO_TARGET_TEXT.no_contribution}: مساهمة الكرتون لا تغطي التشغيل`;
}

// ---------------------------------------------------------------- the actual

/** The plan as a day's record keeps it (what the actual is set against). */
export interface PlanStored { margin: number; waste: number; contribution: number; profitTarget: number; cost: number }
/** What was really delivered a day. */
export interface ActualInput {
  /** Q. */
  cartons: number;
  /** Σ over the delivered cartons of (sale ÷ 1.15 − purchase), the invoices' discounts off. */
  marginTotal: number;
  /** What was recorded as damaged or refused, at its purchase price; null = nothing was recorded. */
  wasteRecorded: number | null;
}
export interface DayActual {
  cartons: number;
  /** T of the plan (0 = the plan had none). */
  target: number;
  margin: number;
  waste: number;
  wasteReal: boolean;
  cost: number;
  /** A. */
  profit: number;
  profitTarget: number;
  /** A − P, and its four parts: they add up to it, to the halala. */
  gap: number;
  volume: number;
  marginVar: number;
  wasteVar: number;
  costVar: number;
}

/**
 * `parts` rounded to `digits` so that they add up to `total` rounded to `digits`: what ROUNDING leaves
 * over (half a unit a part at most: a halala or two, a riyal or two) goes to the largest part. A gap
 * larger than rounding can make is no rounding — the parts are then left as they are, and do not add
 * up (a formula that lost a term is seen, never smoothed over). Pure.
 */
export function splitExact(total: number, parts: number[], digits = 2): number[] {
  const f = 10 ** digits, r = (x: number): number => Math.round(x * f) / f;
  const out = parts.map(r), left = r(r(total) - out.reduce((a, b) => a + b, 0));
  if (left !== 0 && out.length && Math.abs(left) <= ((out.length + 1) * 0.5) / f + 1e-9) {
    let k = 0;
    out.forEach((p, i) => { if (Math.abs(p) > Math.abs(out[k])) k = i; });
    out[k] = r(out[k] + left);
  }
  return out;
}

/**
 * The four parts of A − P, by the order's formula to the letter — the volume (Q − T) × c_plan (written
 * without the division: T × c_plan is C_plan + P), the margin Q × (m̄_act − m̄_plan), the waste
 * −(W_act − Q × w̄_plan), the costs −(C_act − C_plan) — not rounded. Pure.
 */
export function varianceParts(plan: PlanStored, a: { cartons: number; marginTotal: number; waste: number; cost: number }): [number, number, number, number] {
  return [
    a.cartons * plan.contribution - (plan.cost + plan.profitTarget),
    a.marginTotal - a.cartons * plan.margin,
    -(a.waste - a.cartons * plan.waste),
    -(a.cost - plan.cost),
  ];
}

/** The actual of a day against its plan. `costActual`: C_act (by the day it is the plan's own). Pure. */
export function dayActual(plan: PlanStored, input: ActualInput, costActual: number = plan.cost): DayActual {
  const Q = Math.max(0, Number(input.cartons) || 0);
  const wasteReal = input.wasteRecorded !== null;
  const waste = wasteReal ? (input.wasteRecorded as number) : Q * plan.waste;
  const marginTotal = Q > 0 ? input.marginTotal : 0;
  const profit = round2(marginTotal - waste - costActual), gap = round2(marginTotal - waste - costActual - plan.profitTarget);
  const [volume, marginVar, wasteVar, costVar] = splitExact(gap, varianceParts(plan, { cartons: Q, marginTotal, waste, cost: costActual }));
  return {
    cartons: round2(Q), target: plan.contribution > 0 ? r6((plan.cost + plan.profitTarget) / plan.contribution) : 0,
    margin: Q > 0 ? round2(marginTotal / Q) : 0, waste: round2(waste), wasteReal, cost: round2(costActual), profit, profitTarget: plan.profitTarget,
    gap, volume, marginVar, wasteVar, costVar,
  };
}

export const ACTUAL_FIELDS = ["x_act_cartons", "x_act_margin", "x_act_waste", "x_act_waste_real", "x_act_cost", "x_act_profit", "x_var_volume", "x_var_margin", "x_var_waste", "x_var_cost", "x_act_at"] as const;
/** The actual as the day's record keeps it. */
export function actualVals(a: DayActual, nowMs: number): Record<(typeof ACTUAL_FIELDS)[number], string | number | boolean> {
  return {
    x_act_cartons: a.cartons, x_act_margin: a.margin, x_act_waste: a.waste, x_act_waste_real: a.wasteReal, x_act_cost: a.cost, x_act_profit: a.profit,
    x_var_volume: a.volume, x_var_margin: a.marginVar, x_var_waste: a.wasteVar, x_var_cost: a.costVar, x_act_at: new Date(nowMs).toISOString().replace("T", " ").slice(0, 19),
  };
}

/** What the lines of a day's actual are written from: the stored numbers. */
export type ActualShown = Pick<DayActual, "cartons" | "target" | "profit" | "profitTarget" | "gap" | "volume" | "marginVar" | "wasteVar" | "costVar">;
/** A day's record → its stored actual; null = not computed yet (x_act_at empty). */
export function actualOfRecord(r: Record<string, unknown> | null | undefined): ActualShown | null {
  if (!r || !r.x_act_at) return null;
  const n = (k: string): number => Number(r[k]) || 0;
  const volume = n("x_var_volume"), marginVar = n("x_var_margin"), wasteVar = n("x_var_waste"), costVar = n("x_var_cost");
  return { cartons: n("x_act_cartons"), target: n("x_target_cartons"), profit: n("x_act_profit"), profitTarget: n("x_profit_target"), gap: round2(volume + marginVar + wasteVar + costVar), volume, marginVar, wasteVar, costVar };
}

export const NO_SALES_TEXT = "لا مبيعات حقيقية بعد";
export const NOT_COMPUTED_TEXT = "لم تُحسب أرقامه بعد (تُحسب مع ملخص 21:30)";
export const VARIANCE_NAMES = ["الكمية", "الهامش", "التالف", "التكاليف"] as const;
export type DayWord = "أمس" | "اليوم";

/** «عجز 125: الكمية −110 · التالف −15» — whole riyals that add up; a part of nothing is not named. */
export function gapLine(a: ActualShown): string {
  const whole = splitExact(a.gap, [a.volume, a.marginVar, a.wasteVar, a.costVar], 0), total = Math.round(a.gap);
  const parts = whole.map((v, i) => (v ? `${VARIANCE_NAMES[i]} ${signedInt(v)}` : "")).filter(Boolean).join(" · ");
  const head = total < 0 ? `عجز ${Math.abs(total)}` : total > 0 ? `فائض ${total}` : "على الهدف";
  return parts ? `${head}: ${parts}` : head;
}
/**
 * «أمس: بعنا 96 من 206 (47%) — ربح أمس الحقيقي −125 ❌» and, under it, the gap to the target by its
 * parts. Not computed: one line that says so; no real delivery: «أمس: لا مبيعات حقيقية بعد». Pure.
 */
export function actualLines(a: ActualShown | null, when: DayWord): string[] {
  if (!a) return [`${when}: ${NOT_COMPUTED_TEXT}`];
  if (!(a.cartons > 0)) return [`${when}: ${NO_SALES_TEXT}`];
  const t = targetCartons(a.target);
  const sold = t > 0 ? `بعنا ${cartonsText(a.cartons)} من ${t} (${Math.round((a.cartons / a.target) * 100)}%)` : `بعنا ${cartonsText(a.cartons)} كرتون (بلا هدف)`;
  return [`${when}: ${sold} — ربح ${when} الحقيقي ${signedInt(a.profit)} ${a.gap >= 0 ? "✅" : "❌"}`, gapLine(a)];
}

/**
 * «🎯 أمس: بعنا 96 من 206 (47%) — ربح −125 ❌، أكبر سبب: الكمية −110» — the 🎯 line of «خلاصة اليوم»: what
 * was sold of the target, the real profit, and the LARGEST of the gap's four parts. Not computed, or no
 * real delivery: a few words. Pure.
 */
export function briefActualLine(a: ActualShown | null, when: DayWord): string {
  if (!a) return `🎯 ${when}: لم تُحسب أرقامه بعد`;
  if (!(a.cartons > 0)) return `🎯 ${when}: ${NO_SALES_TEXT}`;
  const t = targetCartons(a.target);
  const sold = t > 0 ? `بعنا ${cartonsText(a.cartons)} من ${t} (${Math.round((a.cartons / a.target) * 100)}%)` : `بعنا ${cartonsText(a.cartons)} كرتون (بلا هدف)`;
  const whole = splitExact(a.gap, [a.volume, a.marginVar, a.wasteVar, a.costVar], 0);
  const k = whole.reduce((best, v, i) => (Math.abs(v) > Math.abs(whole[best]) ? i : best), 0);
  return `🎯 ${when}: ${sold} — ربح ${signedInt(a.profit)} ${a.gap >= 0 ? "✅" : "❌"}${whole[k] ? `، أكبر سبب: ${VARIANCE_NAMES[k]} ${signedInt(whole[k])}` : ""}`;
}

// ---------------------------------------------------------------- the HTML under the tiles

const esc = (s: string): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A signed number stays left to right inside a right-to-left line. */
const ltrNumbers = (s: string): string => esc(s).replace(/[+−]?\d+(?:[.,:–]\d+)*%?/g, (m) => `<span dir="ltr">${m}</span>`);
function actualHtml(a: ActualShown | null | undefined, when: DayWord): string {
  if (a === undefined) return "";
  const [first, second] = actualLines(a, when);
  const tone = !a || !(a.cartons > 0) ? " text-muted" : "";
  return `<div class="utak-actual mt-2${tone}">${ltrNumbers(first)}</div>${second ? `<div class="utak-gap small ${a && a.gap < 0 ? "text-danger" : "text-success"}">${ltrNumbers(second)}</div>` : ""}`;
}
/**
 * «🎯 الهدف مقابل الفعلي», as HTML for x_target_html (§ 56's rules: div and span, class / style / dir
 * only, no <style>): the day's target and how it is made, the day before against its own target, and —
 * once the 21:30 summary computed it — the day itself. `yesterday`: null = not computed, undefined = no
 * line at all. Pure.
 */
export function targetHtml(p: DayPlan, yesterday: ActualShown | null | undefined, own?: ActualShown | null): string {
  const formula = targetFormula(p);
  return `<div class="utak-target">`
    + `<div class="fs-4 fw-bold">${ltrNumbers(targetText(p))}</div>`
    + (formula ? `<div class="small text-muted">${ltrNumbers(formula)}</div>` : "")
    + actualHtml(yesterday, "أمس")
    + (own ? actualHtml(own, "اليوم") : "")
    + `</div>`;
}

// ---------------------------------------------------------------- Odoo: the day's actual (21:30)

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
/** The delivery form's reasons that are waste: the goods were there and were lost to us («ناقص» were never there). */
export const WASTE_REASONS: ReadonlySet<string> = new Set(["damaged", "refused"]);
export const DAY_ACTUAL_FIELDS = ["id", "x_date", "x_state", "x_op_cost", "x_n_publish", ...PLAN_FIELDS, ...ACTUAL_FIELDS];
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The real record of a day (never a simulation's) with its plan and its actual; null = none. */
export async function readDayRecord(env: Env, day: string): Promise<Record<string, unknown> | null> {
  const [r] = await call<Array<Record<string, unknown>>>(env, DAY_MODEL, "search_read", {
    domain: [["x_date", "=", day], [SIM_FIELD, "!=", true]], fields: DAY_ACTUAL_FIELDS, order: "id asc", limit: 1,
  });
  return r ?? null;
}
export function planOfRecord(r: Record<string, unknown>): PlanStored {
  const n = (k: string): number => Number(r[k]) || 0;
  return { margin: n("x_plan_margin"), waste: n("x_plan_waste"), contribution: n("x_plan_contribution"), profitTarget: n("x_profit_target"), cost: n("x_op_cost") };
}

/** A real line delivered: the cartons, the price it was sold at, its purchase price, and what came back. */
export interface SoldLine { day: string; priceDay: string; key: string; quantity: number; sale: number; purchase: number; returned: number; reason: string }

/**
 * The real order lines delivered on the Riyadh days [from, to] (the delivery time; an order or a line of
 * a simulation never), each with the purchase price of its price day. A line without a sale price or
 * without its day's purchase price: an error — never a partial sum. Throws on Odoo trouble.
 */
export async function readSoldLines(env: Env, from: string, to: string): Promise<{ lines: SoldLine[]; discount: Map<string, number>; orders: number }> {
  const riyadhDay = (odooUtc: string): string => new Date(Date.parse(odooUtc.replace(" ", "T") + "Z") + 3 * 3600_000).toISOString().slice(0, 10);
  const orders = await call<Array<{ id: number; x_delivered_at: string | false; x_price_date: string | false; x_order_date: string | false }>>(env, "x_daily_order", "search_read", {
    domain: [["x_state", "in", ["delivered", "closed"]], ["x_delivered_at", ">=", toOdooUtc(riyadhDayMinuteMs(from, 0))], ["x_delivered_at", "<", toOdooUtc(riyadhDayMinuteMs(to, 0) + DAY_MS)], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_delivered_at", "x_price_date", "x_order_date"], order: "id asc", limit: 5000,
  });
  const real = orders.filter((o) => typeof o.x_delivered_at === "string");
  if (!real.length) return { lines: [], discount: new Map(), orders: 0 };
  const byId = new Map(real.map((o) => [o.id, { delivered: riyadhDay(o.x_delivered_at as string), priceDay: String(o.x_price_date || o.x_order_date || "") }]));
  const rows = await call<Array<{ x_order_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_quantity: number | false; x_status: string | false; x_unit_price: number | false; x_price_unit_manual: number | false; x_return_qty: number | false; x_return_reason: string | false }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", [...byId.keys()]], [SIM_FIELD, "!=", true]],
    fields: ["x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status", "x_unit_price", "x_price_unit_manual", "x_return_qty", "x_return_reason"], limit: 20000,
  });
  const priceDays = [...new Set([...byId.values()].map((o) => o.priceDay).filter(Boolean))];
  // the purchase price of each line's price day: the real days first (their ids), then their lines
  const days = priceDays.length ? await call<Array<{ id: number; x_date: string }>>(env, DAY_MODEL, "search_read", {
    domain: [["x_date", "in", priceDays], [SIM_FIELD, "!=", true]], fields: ["id", "x_date"], limit: 200,
  }) : [];
  const dateOf = new Map(days.map((d) => [d.id, String(d.x_date)]));
  const costs = days.length ? await call<Array<{ x_day_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_cost_price: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id", "in", days.map((d) => d.id)], ["x_cost_price", ">", 0]],
    fields: ["x_day_id", "x_product_tmpl_id", "x_packaging_id", "x_cost_price"], limit: 5000,
  }) : [];
  const cost = new Map(costs.map((c) => [`${dateOf.get(m2oId(c.x_day_id))}:${m2oId(c.x_product_tmpl_id)}:${m2oId(c.x_packaging_id)}`, Number(c.x_cost_price) || 0]));
  const lines: SoldLine[] = [];
  const gross = new Map<number, number>();
  for (const l of rows) {
    const o = byId.get(m2oId(l.x_order_id));
    if (!o) continue;
    const key = `${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`;
    const delivered = String(l.x_status) === "unavailable" ? 0 : Number(l.x_quantity) || 0;
    const returned = WASTE_REASONS.has(String(l.x_return_reason)) ? Number(l.x_return_qty) || 0 : 0;
    if (!(delivered > 0) && !(returned > 0)) continue;
    const sale = Number(l.x_price_unit_manual) > 0 ? Number(l.x_price_unit_manual) : Number(l.x_unit_price) || 0;
    const purchase = cost.get(`${o.priceDay}:${key}`) ?? 0;
    if (delivered > 0 && !(sale > 0)) throw new Error("a delivered line without a sale price");
    if (!(purchase > 0)) throw new Error("a delivered line without its day's purchase price");
    lines.push({ day: o.delivered, priceDay: o.priceDay, key, quantity: delivered, sale, purchase, returned, reason: String(l.x_return_reason || "") });
    gross.set(m2oId(l.x_order_id), (gross.get(m2oId(l.x_order_id)) ?? 0) + round2(sale * delivered));
  }
  // an invoice's discount, as the customer saw it (the lines − the invoice's total), by the delivery day
  const invs = await call<Array<{ x_order_id: M2O; x_total: number | false }>>(env, "x_invoice", "search_read", {
    domain: [["x_order_id", "in", [...byId.keys()]], [SIM_FIELD, "!=", true]], fields: ["x_order_id", "x_total"], limit: 5000,
  });
  const discount = new Map<string, number>();
  for (const i of invs) {
    const id = m2oId(i.x_order_id), d = round2((gross.get(id) ?? 0) - (Number(i.x_total) || 0)), day = byId.get(id)?.delivered;
    if (day && d > 0.005) discount.set(day, round2((discount.get(day) ?? 0) + d));
  }
  return { lines, discount, orders: real.length };
}

/** What was really delivered on `day`, from its sold lines. `vatPct`: the day's rate (15 from the cutoff). Pure. */
export function actualInput(lines: SoldLine[], day: string, vatPct: number | null, discount = 0): ActualInput {
  const d = vatPct ? 1 + vatPct / 100 : 1;
  const of = lines.filter((l) => l.day === day);
  const cartons = of.reduce((a, l) => a + l.quantity, 0);
  const marginTotal = of.reduce((a, l) => a + l.quantity * (l.sale / d - l.purchase), 0) - discount / d;
  const lost = of.filter((l) => l.returned > 0);
  return { cartons, marginTotal, wasteRecorded: lost.length ? lost.reduce((a, l) => a + l.returned * l.purchase, 0) : null };
}

export interface ActualReport {
  day: string;
  /** The day's real record; 0 = none (nothing is written). */
  dayId: number;
  /** T of the day's plan. */
  target: number;
  actual: ActualShown;
}

/**
 * The actual of `day` against its plan, with the 21:30 summary: read, computed, and — unless `dry` —
 * kept on the day's record (x_act_*, x_var_*, x_act_at; the caller then writes the day's screen again,
 * src/day-screen.ts writeDayScreen, so «🎯 الهدف مقابل الفعلي» carries the day's own line). A day without
 * a real record: nothing is written. Throws on Odoo trouble (the summary then says «تعذّر»).
 */
export async function computeDayActual(env: Env, day: string, nowMs: number = Date.now(), opts: { dry?: boolean } = {}): Promise<ActualReport> {
  const rec = await readDayRecord(env, day);
  const sold = await readSoldLines(env, day, day);
  const plan: PlanStored = rec ? planOfRecord(rec) : { margin: 0, waste: 0, contribution: 0, profitTarget: 0, cost: 0 };
  // a day whose record holds no cost (none, or «تعذّر» when it was computed): the day's cost now — never 0 for a cost
  if (!(plan.cost > 0)) {
    const c = (await dailyOperatingCost(env, day, nowMs)).total;
    if (c === null) throw new Error("the day's operating cost could not be read");
    plan.cost = c;
  }
  const a = dayActual(plan, actualInput(sold.lines, day, profitVatRate(day), sold.discount.get(day) ?? 0));
  const shown: ActualShown = { cartons: a.cartons, target: Number(rec?.x_target_cartons) || 0, profit: a.profit, profitTarget: a.profitTarget, gap: a.gap, volume: a.volume, marginVar: a.marginVar, wasteVar: a.wasteVar, costVar: a.costVar };
  if (rec && !opts.dry) await call(env, DAY_MODEL, "write", { ids: [Number(rec.id)], vals: actualVals(a, nowMs) });
  return { day, dayId: rec ? Number(rec.id) : 0, target: shown.target, actual: shown };
}
