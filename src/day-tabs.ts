// § 60 د (2026-10-06) — the three tabs of «📊 اليوم» the worker writes — «💧 وين يروح المال», «⭐ الأصناف»
// and «🎯 الفرص والقادم» (x_tab_money_html, x_tab_items_html, x_tab_next_html; the pages are in the form
// since § 58, scripts/lib/s58-ui.mjs) — and «خلاصة اليوم», the box of four lines first in «📍 اليوم»
// (x_brief_html, scripts/lib/s60-ui.mjs).
//
// Baraa's amendment: the day's reading is TEXT AND NUMBERS. Every tab is text and lists alone — no
// coloured table, no matrix, no waterfall (the drawings of an analysis are a later order, once weeks of
// data exist) — and its FIRST line is its own summary, written by the system from the numbers:
//   «💧» «من كل كرتون بسعر X: ضريبة · شراء · تالف · تشغيل · لنا» in riyals, the operating share as it
//        really was, and the week's expenses against the plan;
//   «⭐» each item's mean profit, the days it went out and its market's direction;
//   «🎯» the five opportunities worth the most riyals, each a sentence and what to do.
// Each is ONE HTML field under § 56's rules — div and span only, no <style>, no script, only class /
// style / dir, the field's sanitizer on — never longer than TAB_ITEM_BUDGET characters an item of the day
// (fitTab drops the least needed part first, never the opening line). An item's name is escaped.
// NEVER a simulation's data: every read asks for the real records alone.
//
// What they are made of, beside the day's own rows (src/day-screen.ts): readInsightInputs — the real
// days before this one and their lines (the last 30 days), the real lines delivered in the last 14
// days, the expenses posted in the EXP journal this week (Saturday first), the items customers asked
// for and were not available (the last 7 days, src/unavailable-log.ts), and the day's purchase offers.
// Each part is read by itself: one that cannot be read is left empty and named in `errors`, and the
// engine goes on. Kept in KV for a quarter of an hour (the engine asks with every change).

import type { Env } from "./config";
import { call } from "./odoo";
import type { ScreenRow } from "./day-screen";
import {
  DAY_MODEL, PLAN_FIELDS, ACTUAL_FIELDS, actualOfRecord, addDays, briefActualLine, coverText, readSoldLines, round2,
  type ActualShown, type DayPlan, type DayWord, type SoldLine,
} from "./day-insight";
import { customersWord, groupUnavailable, readUnavailable, type UnavailableItem } from "./unavailable-log";
import { arabicDate } from "./wa-params";

const SIM_FIELD = "x_utak_simulation";
/** How far back the real days are read (the last number of an item, its market's direction). */
export const HISTORY_DAYS = 30;
/** «⭐ الأصناف»: the coloured table's days. */
export const GRID_DAYS = 14;
/** A drawing is «complete» with this many days of data; the matrix needs this many days WITH real sales. */
export const ENOUGH_DAYS = 7;
/** «بكرة إذا استمر» is not shown before this many days with a market price. */
export const RANGE_MARKET_DAYS = 5;
/** «طالع 3 أيام متتالية», «ضاق 3 أيام متتالية». */
export const STREAK = 3;
/** The asks of the last days «🎯 الفرص» reads. */
export const ASK_DAYS = 7;
/** A market price this far (of the mean) from the mean of the days before it is going up or down. */
export const TREND_BAND = 0.02;
/** A tab is at most this many characters an item of the day. */
export const TAB_ITEM_BUDGET = 1500;
export const INPUT_TTL_SEC = 15 * 60;
export const EXPENSE_JOURNAL = "EXP";
const EXPENSE_TYPES = ["expense", "expense_direct_cost", "expense_depreciation"];
/** An accounting record of the September trials (no simulation flag on a journal entry): never an expense of ours. */
export const SIM_REF = "SIM-TEST";

// ---------------------------------------------------------------- the inputs

/** A real line of a day before this one. */
export interface HistoryLine {
  day: string;
  key: string;
  name: string;
  /** 0 = none, each. */
  purchase: number;
  market: number;
  /** The price it went out at; 0 = it did not go out (or its day was never published). */
  sale: number;
  /** The carton's profit at the price the board read (the approved price, else the market price). */
  profit: number;
  /** The net sale − the net purchase (0 without both). */
  margin: number;
  /** Did the board hold both a sale and a purchase that day? Without them `profit` is no number (a day of before the board). */
  priced: boolean;
}
/** A real day before this one. */
export interface PastDay {
  day: string;
  state: string;
  /** Its operating cost as its record keeps it; 0 = none. */
  cost: number;
  planWaste: number;
  /** What the 21:30 summary kept of it; null = not computed. */
  actual: ActualShown | null;
  actWaste: number;
  actCost: number;
}
export interface PurchaseOffer { key: string; partnerId: number; source: string; price: number; day: string }
export interface InsightInputs {
  day: string;
  days: PastDay[];
  history: HistoryLine[];
  /** The real lines delivered on the GRID_DAYS days before this one. */
  sold: SoldLine[];
  /** The expenses posted this week up to the day; null = they could not be read. */
  expenses: number | null;
  weekFrom: string;
  /** The items asked for and not available, the last ASK_DAYS days (this day in). */
  unavailable: UnavailableItem[];
  /** The purchase offers of the last ASK_DAYS days (this day in), every «شراء» source. */
  offers: PurchaseOffer[];
  errors: string[];
}
export const emptyInputs = (day: string): InsightInputs => ({ day, days: [], history: [], sold: [], expenses: null, weekFrom: weekStart(day), unavailable: [], offers: [], errors: [] });

/** The Saturday that opens the operating week of `day` (Friday closes it). */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 1) % 7));
}

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const plainName = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
const inputsKey = (day: string): string => `insight_in:v1:${day}`;

async function readPast(env: Env, day: string): Promise<{ days: PastDay[]; history: HistoryLine[] }> {
  const recs = await call<Array<Record<string, unknown>>>(env, DAY_MODEL, "search_read", {
    domain: [["x_date", ">=", addDays(day, -HISTORY_DAYS)], ["x_date", "<", day], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_date", "x_state", "x_op_cost", ...PLAN_FIELDS, ...ACTUAL_FIELDS], order: "x_date asc, id asc", limit: 200,
  });
  // one real record a date (the first, as readDay takes it)
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of recs) if (!byDate.has(String(r.x_date))) byDate.set(String(r.x_date), r);
  const days: PastDay[] = [...byDate.values()].sort((a, b) => (String(a.x_date) < String(b.x_date) ? -1 : 1)).map((r) => ({
    day: String(r.x_date), state: String(r.x_state || ""), cost: Number(r.x_op_cost) || 0, planWaste: Number(r.x_plan_waste) || 0,
    actual: actualOfRecord(r), actWaste: Number(r.x_act_waste) || 0, actCost: Number(r.x_act_cost) || 0,
  }));
  if (!days.length) return { days, history: [] };
  const dateOf = new Map([...byDate.values()].map((r) => [Number(r.id), String(r.x_date)]));
  const published = new Set([...byDate.values()].filter((r) => r.x_state === "published").map((r) => Number(r.id)));
  const lines = await call<Array<{ x_day_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_cost_price: number | false; x_market_price: number | false; x_sale_price: number | false; x_excluded: boolean; x_real_profit: number | false; x_net_sale: number | false; x_net_purchase: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id", "in", [...dateOf.keys()]], [SIM_FIELD, "!=", true]],
    fields: ["x_day_id", "x_product_tmpl_id", "x_packaging_id", "x_cost_price", "x_market_price", "x_sale_price", "x_excluded", "x_real_profit", "x_net_sale", "x_net_purchase"],
    order: "id asc", limit: 5000,
  });
  const history: HistoryLine[] = lines.map((l) => {
    const dayId = m2oId(l.x_day_id), net = Number(l.x_net_sale) || 0, buy = Number(l.x_net_purchase) || 0;
    const out = published.has(dayId) && !l.x_excluded && Number(l.x_sale_price) > 0;
    return {
      day: dateOf.get(dayId) ?? "", key: `${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`, name: Array.isArray(l.x_product_tmpl_id) ? plainName(l.x_product_tmpl_id[1]) : "",
      purchase: Number(l.x_cost_price) || 0, market: Number(l.x_market_price) || 0, sale: out ? Number(l.x_sale_price) : 0,
      profit: Number(l.x_real_profit) || 0, margin: net > 0 && buy > 0 ? round2(net - buy) : 0, priced: net > 0 && buy > 0,
    };
  }).filter((l) => l.day);
  return { days, history };
}

async function readExpenses(env: Env, from: string, to: string): Promise<number> {
  const rows = await call<Array<{ balance: number | false; ref: string | false; move_name: string | false }>>(env, "account.move.line", "search_read", {
    domain: [["journal_id.code", "=", EXPENSE_JOURNAL], ["parent_state", "=", "posted"], ["date", ">=", from], ["date", "<=", to], ["account_type", "in", EXPENSE_TYPES]],
    fields: ["balance", "ref", "move_name"], limit: 5000,
  });
  return round2(rows.filter((r) => !`${r.ref || ""} ${r.move_name || ""}`.includes(SIM_REF)).reduce((a, r) => a + (Number(r.balance) || 0), 0));
}

/**
 * The purchase offers of the last ASK_DAYS days (this day in) from the «شراء» sources — the suppliers'
 * rows (x_daily_price, a failed reading left out) and the sources' offers (x_price_offer), the real ones
 * alone. The engine takes the lowest offer OF THE DAY, so a cheaper source «not taken» is one that
 * offered less on an earlier day and is not the day's supplier («🎯 الفرص»).
 */
async function readOffers(env: Env, day: string): Promise<PurchaseOffer[]> {
  const { loadPriceSources, marketOnlyPartners } = await import("./price-sources");
  const sources = await loadPriceSources(env);
  const marketOnly = marketOnlyPartners(sources);
  const ids = [...sources.partnerIds].filter((id) => !marketOnly.has(id));
  if (!ids.length) return [];
  const names = new Map<number, string>([...sources.partners.map((x) => [x.partnerId, x.name] as [number, string]), ...sources.employees.map((x) => [x.partnerId, x.name] as [number, string])]);
  const from = addDays(day, -(ASK_DAYS - 1));
  const key = (r: { x_product_tmpl_id: M2O; x_packaging_id: M2O }): string => `${m2oId(r.x_product_tmpl_id)}:${m2oId(r.x_packaging_id)}`;
  const who = (v: M2O): string => names.get(m2oId(v)) ?? (Array.isArray(v) ? String(v[1]) : "");
  const rows = await call<Array<{ x_date: string; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_price_sar: number | false; x_supplier_id: M2O }>>(env, "x_daily_price", "search_read", {
    domain: [["x_date", ">=", from], ["x_date", "<=", day], ["x_price_sar", ">", 0], ["x_extraction_status", "!=", "failed"], ["x_supplier_id", "in", ids], [SIM_FIELD, "!=", true]],
    fields: ["x_date", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_supplier_id"], limit: 5000,
  });
  const offers = await call<Array<{ x_date: string; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_purchase_price: number | false; x_source_partner_id: M2O }>>(env, "x_price_offer", "search_read", {
    domain: [["x_date", ">=", from], ["x_date", "<=", day], ["x_purchase_price", ">", 0], ["x_source_partner_id", "in", ids], [SIM_FIELD, "!=", true]],
    fields: ["x_date", "x_product_tmpl_id", "x_packaging_id", "x_purchase_price", "x_source_partner_id"], limit: 5000,
  });
  return [
    ...rows.map((r) => ({ key: key(r), partnerId: m2oId(r.x_supplier_id), source: who(r.x_supplier_id), price: Number(r.x_price_sar) || 0, day: String(r.x_date) })),
    ...offers.map((o) => ({ key: key(o), partnerId: m2oId(o.x_source_partner_id), source: who(o.x_source_partner_id), price: Number(o.x_purchase_price) || 0, day: String(o.x_date) })),
  ].filter((o) => o.partnerId > 0 && o.price > 0);
}

/**
 * What the tabs, the target and the chart's «▲ ▼» read beside the day's own lines. Never throws: a
 * part that cannot be read is left empty and named in `errors`. Kept INPUT_TTL_SEC in KV (a failed
 * read is not kept); `force` reads again.
 */
export async function readInsightInputs(env: Env, day: string, nowMs: number = Date.now(), force = false): Promise<InsightInputs> {
  if (!force) {
    try {
      const hit = await env.MSG_DEDUP.get(inputsKey(day));
      const kept = hit ? (JSON.parse(hit) as { at?: number; inputs?: InsightInputs }) : null;
      if (kept?.inputs && typeof kept.at === "number" && nowMs >= kept.at && nowMs - kept.at < INPUT_TTL_SEC * 1000) return kept.inputs;
    } catch { /* read them */ }
  }
  const out = emptyInputs(day);
  const attempt = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) {
      out.errors.push(name);
      console.warn(`[day-tabs] ${day}: ${name} could not be read`, (e as Error)?.message);
    }
  };
  await attempt("past", async () => { Object.assign(out, await readPast(env, day)); });
  await attempt("sold", async () => { out.sold = (await readSoldLines(env, addDays(day, -GRID_DAYS), addDays(day, -1))).lines; });
  await attempt("expenses", async () => { out.expenses = await readExpenses(env, out.weekFrom, day); });
  await attempt("unavailable", async () => { out.unavailable = groupUnavailable(await readUnavailable(env, addDays(day, -(ASK_DAYS - 1)), day)); });
  await attempt("offers", async () => { out.offers = await readOffers(env, day); });
  if (!out.errors.length) {
    try { await env.MSG_DEDUP.put(inputsKey(day), JSON.stringify({ at: nowMs, inputs: out }), { expirationTtl: INPUT_TTL_SEC }); } catch { /* the next run reads again */ }
  }
  return out;
}

// ---------------------------------------------------------------- what the numbers say

/** The last earlier day's number of each item: its market price and its purchase price (0 = none yet). */
export function lastNumbers(history: HistoryLine[]): Map<string, { market: number; purchase: number }> {
  const out = new Map<string, { market: number; purchase: number }>();
  for (const l of [...history].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))) {
    const cur = out.get(l.key) ?? { market: 0, purchase: 0 };
    if (!(cur.market > 0) && l.market > 0) cur.market = l.market;
    if (!(cur.purchase > 0) && l.purchase > 0) cur.purchase = l.purchase;
    out.set(l.key, cur);
  }
  return out;
}

/** An item's numbers by day, the oldest first, this day last: `of` picks the number (0 = none that day). */
function series(key: string, history: HistoryLine[], today: number, day: string, of: (l: HistoryLine) => number): Array<{ day: string; value: number }> {
  const past = history.filter((l) => l.key === key && of(l) > 0).map((l) => ({ day: l.day, value: of(l) })).sort((a, b) => (a.day < b.day ? -1 : 1));
  return today > 0 ? [...past, { day, value: today }] : past;
}
/** Did the last STREAK steps all go the same way (`sign` 1 up, −1 down)? The move over them, else 0. */
export function streak(values: number[], sign: 1 | -1): number {
  if (values.length < STREAK + 1) return 0;
  const last = values.slice(-(STREAK + 1));
  for (let i = 1; i < last.length; i++) if (!((last[i] - last[i - 1]) * sign > 0.004)) return 0;
  return round2(last[last.length - 1] - last[0]);
}
export type Direction = "up" | "down" | "flat";
export const DIRECTION_TEXT: Readonly<Record<Direction, string>> = { up: "طالع ▲", down: "نازل ▼", flat: "ثابت ●" };
export interface Trend {
  /** How many days carry a market price (this day in). */
  days: number;
  last: number;
  /** The mean of the days before the last one, the last seven days at most; 0 = none. */
  mean: number;
  direction: Direction | null;
  /** «بكرة إذا استمر»: the last price ∓ the mean absolute daily move; null before RANGE_MARKET_DAYS days. */
  range: [number, number] | null;
}
/** The market's direction of an item from its prices by day (the oldest first). Pure. */
export function trendOf(points: Array<{ day: string; value: number }>): Trend {
  const values = points.map((p) => p.value), n = values.length, last = n ? values[n - 1] : 0;
  const lastDay = n ? points[n - 1].day : "";
  const before = points.slice(0, -1).filter((p) => p.day >= addDays(lastDay || "1970-01-01", -ENOUGH_DAYS)).map((p) => p.value);
  const mean = before.length ? round2(before.reduce((a, b) => a + b, 0) / before.length) : 0;
  const direction: Direction | null = !(mean > 0) ? null : last > mean * (1 + TREND_BAND) ? "up" : last < mean * (1 - TREND_BAND) ? "down" : "flat";
  let range: [number, number] | null = null;
  if (n >= RANGE_MARKET_DAYS) {
    const moves = values.slice(1).map((v, i) => Math.abs(v - values[i]));
    const step = round2(moves.reduce((a, b) => a + b, 0) / moves.length);
    range = [round2(Math.max(0, last - step)), round2(last + step)];
  }
  return { days: n, last, mean, direction, range };
}

// ---------------------------------------------------------------- HTML, small

const esc = (s: string): string => String(s ?? "").replace(/\u00a0/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f2 = (x: number): string => round2(x).toFixed(2);
/** «+1.13», «−0.74» (U+2212), «0.00». */
const sign2 = (x: number): string => { const n = round2(x); return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`; };
/** A number as a line writes it: its sign, its digits, and a point, a comma, a colon or a dash only BETWEEN digits («21:30», «73.00–77.00») — what follows it («35.75:») stays in the line's own direction — and its percent. */
export const NUMBER = /[+−]?\d+(?:[.,:–]\d+)*%?/g;
/** Text into HTML: escaped, and every number (with its sign or its percent) kept left to right inside the right-to-left line. */
export const lineHtml = (text: string): string => esc(text).replace(NUMBER, (m) => `<span dir="ltr">${m}</span>`);
const lead = (text: string): string => `<div class="utak-lead fw-bold mb-2">${lineHtml(text)}</div>`;
const line = (text: string, cls = ""): string => `<div class="small${cls ? ` ${cls}` : ""}">${lineHtml(text)}</div>`;
const list = (name: string, lines: string[]): string => (lines.length ? `<div class="utak-${name} mt-2">${lines.map((l) => line(l)).join("")}</div>` : "");

/** A tab's part: `rank` 0 is never dropped; the highest rank goes first when the tab is over its budget. */
export interface TabPart { html: string; rank: number }
/**
 * The parts in their order inside one div, within TAB_ITEM_BUDGET characters an item (one item at
 * least): over it, the part of the highest rank is dropped, again until it fits. Pure.
 */
export function fitTab(name: string, parts: TabPart[], items: number): string {
  const budget = TAB_ITEM_BUDGET * Math.max(1, items);
  const kept = parts.filter((p) => p.html);
  const wrap = (): string => `<div class="utak-tab utak-tab-${name}">${kept.map((p) => p.html).join("")}</div>`;
  while (wrap().length > budget) {
    const drop = kept.reduce((k, p, i) => (p.rank > 0 && (k < 0 || p.rank >= kept[k].rank) ? i : k), -1);
    if (drop < 0) break;
    kept.splice(drop, 1);
  }
  return wrap();
}

// ---------------------------------------------------------------- «💧 وين يروح المال»

/** Where a carton's sale price goes: the five parts add up to it. */
export interface CartonSplit {
  /** Yesterday's cartons as they were really sold (their mean), or one carton at the mean of the day's prices. */
  basis: "actual" | "carton";
  sale: number;
  vat: number;
  purchase: number;
  waste: number;
  share: number;
  /** «لنا». */
  profit: number;
}
/** The four parts that leave us, as the line names them. */
export const SPLIT_COSTS = [["vat", "ضريبة"], ["purchase", "شراء"], ["waste", "تالف"], ["share", "تشغيل"]] as const;
export const CARTON_BASIS_TEXT = "للكرتون الواحد بمتوسط أسعار اليوم";

/** One carton at the mean of the items that go out: the parts add up to the sale price. Null with none. Pure. */
export function cartonSplit(rows: ScreenRow[]): CartonSplit | null {
  const out = rows.filter((r) => r.publish && r.price > 0 && r.purchase > 0 && r.profit !== null);
  if (!out.length) return null;
  const mean = (of: (r: ScreenRow) => number): number => out.reduce((a, r) => a + of(r), 0) / out.length;
  const sale = round2(mean((r) => r.price));
  // each part as it is; what rounding leaves over is in the VAT (itself what is left of the price)
  const purchase = round2(mean((r) => r.purchase)), waste = round2(mean((r) => r.waste)), share = round2(mean((r) => r.opShare)), profit = round2(mean((r) => r.profit as number));
  return { basis: "carton", sale, vat: round2(sale - purchase - waste - share - profit), purchase, waste, share, profit };
}
/**
 * Yesterday as it was really sold, a carton: its delivered lines, and the waste, the cost and the
 * profit its record keeps, each over the cartons delivered. Null without a real sale. Pure.
 */
export function actualSplit(sold: SoldLine[], y: PastDay | undefined, vatPct: number | null): CartonSplit | null {
  if (!y?.actual || !(y.actual.cartons > 0)) return null;
  const of = sold.filter((l) => l.day === y.day && l.quantity > 0);
  if (!of.length) return null;
  const d = vatPct ? 1 + vatPct / 100 : 1, q = y.actual.cartons;
  const purchaseRaw = of.reduce((a, l) => a + l.quantity * l.purchase, 0) / q;
  // the sale as the record's profit has it (an invoice's discount is already off it)
  const net = (y.actual.profit + y.actCost + y.actWaste) / q + purchaseRaw, sale = round2(net * d);
  const purchase = round2(purchaseRaw), waste = round2(y.actWaste / q), share = round2(y.actCost / q), profit = round2(y.actual.profit / q);
  return { basis: "actual", sale, vat: round2(sale - purchase - waste - share - profit), purchase, waste, share, profit };
}
/** «من كل كرتون بسعر 35.75: ضريبة 4.66 · شراء 23.25 · تالف 1.16 · تشغيل 2.56 · لنا +4.12» — riyals. */
export function splitLine(w: CartonSplit): string {
  return `من كل كرتون بسعر ${f2(w.sale)}: ${SPLIT_COSTS.map(([k, label]) => `${label} ${f2(w[k])}`).join(" · ")} · لنا ${sign2(w.profit)}`;
}
export const NO_SPLIT_TEXT = "لا صنف يُنشر اليوم بسعر وشراء";

export interface MoneyContext {
  rows: ScreenRow[];
  inputs: InsightInputs;
  /** What the day's cost was divided by, and the cost itself (null = «تعذّر»). */
  cartons: number | null;
  cost: number | null;
  vatPct: number | null;
}
/** The carton's split the screen shows: yesterday's real one when it had real sales, else the day's own. Pure. */
export function moneySplit(c: Pick<MoneyContext, "rows" | "inputs" | "vatPct">): CartonSplit | null {
  const y = c.inputs.days.find((d) => d.day === addDays(c.inputs.day, -1));
  return actualSplit(c.inputs.sold, y, c.vatPct) ?? cartonSplit(c.rows);
}
/** «💧 وين يروح المال»: text alone — the carton's split, the operating share as it really was, the week's expenses against the plan. Pure. */
export function moneyTabHtml(c: MoneyContext): string {
  const y = c.inputs.days.find((d) => d.day === addDays(c.inputs.day, -1));
  const w = moneySplit(c);
  const basis = !w ? "" : w.basis === "actual" ? `أمس فعلياً (${arabicDate(y?.day ?? c.inputs.day)})، وبالتالف ${y && y.actWaste > 0 ? "الفعلي" : "المخطط"}.` : `${CARTON_BASIS_TEXT} (لا مبيعات حقيقية أمس).`;
  const perCarton = y?.actual && y.actual.cartons > 0 && y.actCost > 0 ? `بمبيعات أمس الفعلية كانت ${f2(y.actCost / y.actual.cartons)} للكرتون` : "لا مبيعات فعلية أمس للمقارنة";
  const share = c.cartons && c.cartons > 0 ? `حصة التشغيل محسوبة على ${round2(c.cartons)} كرتون — ${perCarton}.` : "حصة التشغيل: تعذّرت (لا تكلفة لليوم أو لا «كراتين متوقعة»).";
  // the week so far: what was really posted against the daily cost of its days
  const week = [...c.inputs.days.filter((d) => d.day >= c.inputs.weekFrom && d.cost > 0).map((d) => d.cost), ...(c.cost !== null && c.cost > 0 ? [c.cost] : [])];
  const planned = round2(week.reduce((a, b) => a + b, 0)), spent = c.inputs.expenses;
  const days = `${week.length} ${week.length === 1 ? "يوم" : week.length === 2 ? "يومين" : "أيام"}`;
  const weekLine = `الأسبوع حتى الآن (من السبت ${arabicDate(c.inputs.weekFrom)}): مصاريف مسجّلة فعلاً ${spent === null ? "تعذّرت" : `${f2(spent)} ريال${spent ? "" : " (لم يُسجَّل مصروف بعد)"}`} مقابل المخطط ${f2(planned)} ريال (تكلفة التشغيل اليومية لـ ${days})`
    + (!spent ? "." : spent > planned ? ` — فوق المخطط بـ ${f2(spent - planned)}.` : ` — تحت المخطط بـ ${f2(planned - spent)}.`);
  return fitTab("money", [
    { html: lead(w ? `${splitLine(w)}.` : `${NO_SPLIT_TEXT}.`), rank: 0 },
    { html: basis ? line(basis, "text-muted") : "", rank: 3 },
    { html: `<div class="utak-share mt-2">${line(share)}</div>`, rank: 1 },
    { html: `<div class="utak-week mt-2">${line(weekLine)}</div>`, rank: 2 },
  ], c.rows.length);
}

// ---------------------------------------------------------------- «⭐ الأصناف»

export interface ItemStats {
  key: string;
  name: string;
  /** The mean of its carton's profit over the days it went out, of the last GRID_DAYS days; null = it never did. */
  average: number | null;
  /** How many of those days it went out. */
  days: number;
  trend: Trend;
}
/** The last GRID_DAYS days, the oldest first, this day last. */
export const gridDays = (day: string): string[] => Array.from({ length: GRID_DAYS }, (_, i) => addDays(day, i - (GRID_DAYS - 1)));

/**
 * Each item of the day over the last GRID_DAYS days: on a day it went out, its profit — as it was
 * really sold when real cartons of that day's price were delivered (the published profit moved by what
 * they really fetched against the published price), else at the price it was published at. `state`:
 * this day's own (it counts once it is published). Pure.
 */
export function itemStats(rows: ScreenRow[], inputs: InsightInputs, state: string, vatPct: number | null): ItemStats[] {
  const days = gridDays(inputs.day), d = vatPct ? 1 + vatPct / 100 : 1;
  return rows.map((r) => {
    const out = days.map((day): number | null => {
      if (day === inputs.day) return state === "published" && r.publish && r.profit !== null ? r.profit : null;
      const l = inputs.history.find((h) => h.key === r.key && h.day === day);
      if (!l || !(l.sale > 0) || !l.priced) return null;
      const sold = inputs.sold.filter((s) => s.key === r.key && s.priceDay === day && s.quantity > 0);
      const q = sold.reduce((a, s) => a + s.quantity, 0);
      return q > 0 ? round2(l.profit + sold.reduce((a, s) => a + s.quantity * (s.sale - l.sale), 0) / q / d) : l.profit;
    }).filter((c): c is number => c !== null);
    return {
      key: r.key, name: r.name, days: out.length, average: out.length ? round2(out.reduce((a, b) => a + b, 0) / out.length) : null,
      trend: trendOf(series(r.key, inputs.history, r.market, inputs.day, (l) => l.market)),
    };
  });
}
/** «السوق طالع ▲ (75.00 مقابل متوسط 70.00) · بكرة إذا استمر 73.00–77.00»; no earlier day: «السوق —». */
export function trendText(t: Trend): string {
  if (!t.direction) return "السوق —";
  return `السوق ${DIRECTION_TEXT[t.direction]} (${f2(t.last)} مقابل متوسط ${f2(t.mean)})${t.range ? ` · بكرة إذا استمر ${f2(t.range[0])}–${f2(t.range[1])}` : ""}`;
}
/** «موز: متوسط الربح +12.26 · أيام النشر 3 · السوق طالع ▲ (…)». */
export function itemLine(s: ItemStats): string {
  return `${s.name}: ${s.average === null ? "لم يُنشر" : `متوسط الربح ${sign2(s.average)} · أيام النشر ${s.days}`} · ${trendText(s.trend)}`;
}
/** «تكتمل الصورة بعد 7 أيام بيانات — عندنا الآن N». */
export const notEnough = (have: number, need: number = ENOUGH_DAYS): string => `تكتمل الصورة بعد ${need} أيام بيانات — عندنا الآن ${have}`;

export interface ItemsContext { rows: ScreenRow[]; inputs: InsightInputs; state: string; vatPct: number | null }
/** «⭐ الأصناف»: a list alone — each item's mean profit, the days it went out and its market's direction. Pure. */
export function itemsTabHtml(c: ItemsContext): string {
  const stats = itemStats(c.rows, c.inputs, c.state, c.vatPct);
  const ranked = stats.filter((s) => s.average !== null).sort((a, b) => (b.average as number) - (a.average as number));
  const most = Math.max(0, ...stats.map((s) => s.days));
  const opening = !ranked.length ? `لا صنف نُشر في آخر ${GRID_DAYS} يوماً.`
    : ranked.length === 1 ? `${ranked[0].name}: متوسط ربح الكرتون ${sign2(ranked[0].average as number)} في ${ranked[0].days} ${ranked[0].days === 1 ? "يوم" : "أيام"} نشر.`
      : `أربح صنف في آخر ${GRID_DAYS} يوماً: ${ranked[0].name} (${sign2(ranked[0].average as number)} للكرتون)، وأضعفها: ${ranked[ranked.length - 1].name} (${sign2(ranked[ranked.length - 1].average as number)}).`;
  return fitTab("items", [
    { html: lead(opening), rank: 0 },
    { html: most > 0 && most < ENOUGH_DAYS ? line(`${notEnough(most)}.`, "text-muted") : "", rank: 2 },
    { html: list("items", [...ranked, ...stats.filter((s) => s.average === null)].map(itemLine)), rank: 1 },
  ], c.rows.length);
}

// ---------------------------------------------------------------- «🎯 الفرص والقادم»

export interface Opportunity {
  kind: "above" | "rising" | "cheaper" | "asked";
  /** A sentence and what to do. */
  text: string;
  /** A few words, for «خلاصة اليوم». */
  short: string;
  /** Riyals a carton; 0 for an ask (it has no price today). */
  riyal: number;
}
/** «🎯 الفرص» names this many. */
export const TOP_OPPORTUNITIES = 5;
/** The opportunities, the most riyals first; the asks (no price to value them) after them, the most customers first. Pure. */
export function opportunities(rows: ScreenRow[], inputs: InsightInputs, suppliers: ReadonlyMap<string, number>): Opportunity[] {
  const out: Opportunity[] = [];
  for (const r of rows) {
    // (أ) the market stands above our suggested price
    if (r.sale > 0 && r.suggested > 0 && r.sale - r.suggested > 0.004) {
      const d = round2(r.sale - r.suggested);
      out.push({ kind: "above", riyal: d, short: `${r.name} (السوق فوق المقترح ${sign2(d)})`, text: `${r.name}: السوق ${f2(r.sale)} أعلى من المقترح ${f2(r.suggested)} بـ ${f2(d)} للكرتون — بِعه بسعر السوق.` });
    }
    // (ب) the market went up three days in a row
    const up = streak(series(r.key, inputs.history, r.market, inputs.day, (l) => l.market).map((p) => p.value), 1);
    if (up > 0) out.push({ kind: "rising", riyal: up, short: `${r.name} (سوق طالع ${sign2(up)})`, text: `${r.name}: السوق طالع ${STREAK} أيام متتالية (${sign2(up)}) — راجع سعر بيعه قبل النشر.` });
    // (ج) a cheaper purchase source among the last days' offers, not the one the day's purchase was taken from: each other source's latest offer
    const taken = suppliers.get(r.key) ?? 0, latest = new Map<number, PurchaseOffer>();
    for (const o of inputs.offers) {
      if (o.key !== r.key || o.partnerId === taken) continue;
      const cur = latest.get(o.partnerId);
      if (!cur || o.day > cur.day || (o.day === cur.day && o.price < cur.price)) latest.set(o.partnerId, o);
    }
    const cheaper = [...latest.values()].filter((o) => r.purchase > 0 && r.purchase - o.price > 0.004).sort((a, b) => a.price - b.price)[0];
    if (cheaper) {
      const d = round2(r.purchase - cheaper.price), today = cheaper.day === inputs.day;
      out.push({ kind: "cheaper", riyal: d, short: `${r.name} (شراء أرخص ${sign2(d)} عند ${cheaper.source})`,
        text: `${r.name}: ${cheaper.source} أرخص بـ ${f2(d)} للكرتون (${f2(cheaper.price)}${today ? "" : ` يوم ${arabicDate(cheaper.day).replace(/ \d{4}$/, "")}`} مقابل ${f2(r.purchase)}) — ${today ? "اشترِ منه" : "اطلب سعره اليوم"}.` });
    }
  }
  out.sort((a, b) => b.riyal - a.riyal);
  // (د) asked for and not available, the last days
  for (const u of inputs.unavailable) out.push({ kind: "asked", riyal: 0, short: `${u.name} (طلبه ${customersWord(u.customers)})`, text: `${u.name}: طلبه ${customersWord(u.customers)} في ${ASK_DAYS} أيام (×${u.asks}) وما كان متوفراً — وفّره وانشره.` });
  return out;
}
export const MARGIN_ALARM = "⚠️ الهامش ضاق 3 أيام متتالية";
/** «⚠️ الهامش ضاق 3 أيام متتالية — موز (5.20 ← 3.10): راجع سعر شرائه أو بيعه.» for each item whose margin narrowed. Pure. */
export function marginAlarms(rows: ScreenRow[], inputs: InsightInputs): string[] {
  return rows.flatMap((r) => {
    const d = r.vatPct ? 1 + r.vatPct / 100 : 1, base = r.publish ? r.price : r.sale;
    const today = base > 0 && r.purchase > 0 ? round2(round2(base / d) - r.purchase) : 0;
    const v = series(r.key, inputs.history, today, inputs.day, (l) => l.margin).map((p) => p.value);
    return streak(v, -1) < 0 ? [`${MARGIN_ALARM} — ${r.name} (${f2(v[v.length - 1 - STREAK])} ← ${f2(v[v.length - 1])}): راجع سعر شرائه أو بيعه.`] : [];
  });
}

export interface NextContext { rows: ScreenRow[]; inputs: InsightInputs; plan: DayPlan; suppliers: ReadonlyMap<string, number> }
/** «🎯 الفرص والقادم»: the five opportunities worth the most riyals, each a sentence and what to do; the alarms; what covers the day. Pure. */
export function nextTabHtml(c: NextContext): string {
  const all = opportunities(c.rows, c.inputs, c.suppliers), top = all.slice(0, TOP_OPPORTUNITIES);
  const valued = all.filter((o) => o.riyal > 0);
  const opening = !all.length ? "لا فرصة ظاهرة بأرقام اليوم."
    : valued.length ? `${all.length === 1 ? "فرصة واحدة" : all.length === 2 ? "فرصتان" : all.length <= 10 ? `${all.length} فرص` : `${all.length} فرصة`} اليوم، أكبرها ${sign2(valued[0].riyal)} للكرتون${all.length > top.length ? ` (أعلى ${top.length} هنا)` : ""}.`
      : `${all.length === 1 ? "صنف واحد طلبه" : `${all.length} أصناف طلبها`} العملاء وما كان متوفراً.`;
  const cover = coverText(c.plan);
  return fitTab("next", [
    { html: lead(opening), rank: 0 },
    { html: list("opps", top.map((o, i) => `${i + 1}. ${o.text}`)), rank: 1 },
    { html: list("alarms", marginAlarms(c.rows, c.inputs)), rank: 2 },
    { html: cover ? `<div class="utak-cover fw-bold mt-3">${lineHtml(cover)}</div>` : "", rank: 0 },
  ], c.rows.length);
}

// ---------------------------------------------------------------- «خلاصة اليوم»

export const BRIEF_TITLE = "خلاصة اليوم";
export interface BriefContext {
  rows: ScreenRow[];
  state: string;
  /** The mean profit of what goes out (the header's own); null = none. */
  average: number | null;
  /** The day the 🎯 line is about, against its own target: null = not computed yet, undefined = no record. */
  actual: ActualShown | null | undefined;
  when: DayWord;
  split: CartonSplit | null;
  opportunities: Opportunity[];
}
const itemsWord = (n: number): string => (n === 1 ? "صنف" : n >= 3 && n <= 10 ? "أصناف" : "صنفاً");
/**
 * The four lines of «خلاصة اليوم», with the day's numbers — what goes out and the mean carton profit;
 * the day before against its target and the largest reason of the gap; what a carton leaves us and its
 * largest cost; the two opportunities worth the most. A line without data says so in a few words. Pure.
 */
export function briefLines(b: BriefContext): [string, string, string, string] {
  const out = b.rows.filter((r) => r.publish).length, n = b.rows.length;
  const first = out ? `✅ ${b.state === "published" ? "نُشر" : "يُنشر"} اليوم ${out} من ${n} ${itemsWord(n)} — متوسط ربح الكرتون ${b.average === null ? "غير محسوب" : sign2(b.average)}` : `✅ لا صنف للنشر اليوم${n ? ` (من ${n})` : ""}`;
  const w = b.split;
  const cost = w ? [...SPLIT_COSTS].sort((x, y) => w[y[0]] - w[x[0]])[0] : null;
  const third = w && cost ? `💧 من كل كرتون بـ ${f2(w.sale)}: لنا ${sign2(w.profit)}، وأكبر بند ال${cost[1]} ${f2(w[cost[0]])}` : `💧 ${NO_SPLIT_TEXT}`;
  const top = b.opportunities.slice(0, 2).map((o) => o.short);
  const fourth = top.length === 2 ? `➡️ أهم فرصتين: ${top[0]} · ${top[1]}` : top.length ? `➡️ أهم فرصة: ${top[0]}` : "➡️ لا فرصة ظاهرة اليوم";
  return [first, briefActualLine(b.actual ?? null, b.when), third, fourth];
}
/** «خلاصة اليوم» as HTML for x_brief_html: a box, its title and the four lines (§ 56's rules: div and span, no <style>). Pure. */
export function briefHtml(lines: readonly string[]): string {
  return `<div class="utak-brief border rounded-3 p-3"><div class="utak-brief-title fw-bold mb-1">${BRIEF_TITLE}</div>${lines.map((l) => `<div class="utak-brief-line">${lineHtml(l)}</div>`).join("")}</div>`;
}
