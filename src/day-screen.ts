// § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم», made plain: the screen says what the day's
// review says (§ 55, src/price-review.ts), with the same numbers from the same functions.
//
// With every run of the engine, every decision and the publication the worker writes
//   • on each line, the cells of the table that Odoo cannot make by itself — «الشراء شامل» (the
//     purchase × 1.15), «ربحنا بسعر السوق» signed (profitAt at the market price after the uplift),
//     «المقترح (وربحه)», «فرق المقترح عن السوق» (its value and its percent, signed) and «القرار»,
//     its mark first (✅ ❌ ⚠️ 🔻) — SCREEN_LINE_FIELDS;
//   • on the day, the header's four numbers — «للنشر», «لا تنشر», «⚠️», «متوسط ربح الكرتون» — and
//     the chart (x_chart_html).
//
// A day still open (draft, missed) reads as the review does: Baraa's decision, else the proposed
// one; «معتمد» is a line that goes out with nothing more from him, «ينتظر قرارك» one that does not.
// A day approved or published reads what its lines store: «نُشر بـ …» / «لم يُنشر».
//
// The chart is plain HTML with inline CSS — div and span only, no SVG, no <style>, no script, and
// only the attributes class / style / title / dir — so Odoo's sanitizer stores it as it is written
// (the field keeps it), and the form shows it INSIDE the page: Odoo (saas~19.4, html_editor) moves
// an HTML value into a sandboxed frame, outside the page's stylesheet, as soon as it carries a
// <style> or anything else of a <head>. Every colour is the page's own: the text colour
// (currentColor) for the marks, Odoo's text-success / text-danger / text-muted for the rest — so
// the chart follows the light and the dark theme. A sign, a shape or a mark always says what a
// colour says.
//   1. «سعرنا مقابل السوق»: a row an item on ONE axis in riyals — ■ the purchase with the VAT, ○ the
//      market price, ◆ our price (the one decided, else the suggested one) — and its profit, signed.
//   2. «ربح الكرتون»: a column an item around a zero line, the value written on it.
// Every name is escaped: the HTML never carries a tag that came from a product's name.

import type { Env } from "./config";
import { call } from "./odoo";
import { readPricingSettings } from "./operating-cost";
import { ABOVE_SUGGESTED_DEFAULT, type AboveSuggested } from "./pricing-engine";
import {
  PRICE_DAY_MODEL, PRICE_LINE_MODEL, SCREEN_DAY_FIELDS, SCREEN_LINE_FIELDS, isPublishable, readLines, type DayLine, type DayRecord,
} from "./prices";
import { NO_SHARE_NOTE, PURCHASE_VAT_FACTOR, isWarned, noShare, profitAt, reviewRows, rowOutcome, signed, signedPct, type ReviewRow } from "./price-review";

export type DayState = DayRecord["x_state"];
/** A day approved or published says what its lines store; a draft or a missed one, what the review proposes. */
const LOCKED: ReadonlySet<string> = new Set(["approved", "published"]);
/** A cell with no value: «—», never 0.00. */
export const NONE = "—";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;
/** «63.25», «70.00»: two decimals, always. */
export const fixed2 = (x: number): string => round2(x).toFixed(2);
/** The purchase price with the VAT, whole halalas, half up (12.50 → 14.38): the review's own «(… شامل)». 0 = none. */
export function purchaseWithVat(purchase: number): number {
  return purchase > 0 ? Math.round(Math.round(purchase * PURCHASE_VAT_FACTOR * 1e6) / 1e4) / 100 : 0;
}

// ---------------------------------------------------------------- a row

/** What a profit was made at. */
export type ProfitBase = "market" | "suggested" | "own";
export const PROFIT_BASE_TEXT: Readonly<Record<ProfitBase, string>> = { market: "بسعر السوق", suggested: "بالمقترح", own: "بسعرك" };
export const NO_PURCHASE_TEXT = "لا سعر شراء";
export const NO_MARKET_TEXT = "لا سعر سوق";
export const OUT_OF_CATALOG_TEXT = "❌ خارج الكتالوج النشط";

/** One item of the day as the screen shows it. */
export interface ScreenRow {
  lineId: number;
  name: string;
  /** ⚠️ an outlier still waiting, ❌ not published, ✅ published with a profit, 🔻 published with none. */
  mark: string;
  /** 0 = none, each. */
  purchase: number;
  purchaseVat: number;
  market: number;
  suggested: number;
  /** «سعرنا»: the price decided (by the rule, by Baraa, or published), else the suggested one. 0 = none. */
  ours: number;
  decided: boolean;
  /** «ربحنا بسعر السوق» (the market price after its uplift) and at the suggested price; null = none. */
  marketProfit: number | null;
  suggestedProfit: number | null;
  /** The row's own profit, as the review's line gives it: at the price it goes out at; a row that does not: at the market price, else at the suggested one. */
  profit: number | null;
  profitBase: ProfitBase | null;
  /** The suggested price against the market price as observed; null without both. */
  gap: number | null;
  gapPct: number | null;
  /** Does it go out as things stand, and at what price. */
  publish: boolean;
  price: number;
  /** It goes out with nothing more from Baraa. */
  approved: boolean;
  warn: boolean;
  noShare: boolean;
  /** «القرار», its mark first. */
  outcome: string;
}

function screenRow(r: ReviewRow, l: DayLine, state: DayState): ScreenRow {
  const locked = LOCKED.has(state);
  // a day published before the engine (§ 35) has lines with no status at all: such a line went out with its sale price unless it was left out
  const stored = isPublishable(l) || (locked && !l.x_status && !l.x_excluded && Number(l.x_sale_price) > 0);
  const o = rowOutcome(r);
  const publish = locked ? stored : o.kind !== "skip";
  const price = !publish ? 0 : locked ? Number(l.x_sale_price) || 0 : o.price;
  const approved = locked ? stored : r.decision ? publish : stored;
  const warn = !locked && isWarned(r);
  const outBase: ProfitBase = locked
    ? (l.x_decision === "edit" ? "own" : l.x_decision === "profit" ? "suggested" : l.x_decision === "market" ? "market" : near(price, r.suggested) && !near(price, r.sale) ? "suggested" : "market")
    : o.kind === "edit" ? "own" : o.kind === "profit" ? "suggested" : "market";
  const marketProfit = r.sale > 0 ? profitAt(r, r.sale) : null;
  const suggestedProfit = r.suggested > 0 ? profitAt(r, r.suggested) : null;
  const outProfit = publish ? profitAt(r, price) : null;
  const base: ProfitBase | null = publish ? outBase : r.sale > 0 ? "market" : r.suggested > 0 ? "suggested" : null;
  const profit = publish ? outProfit : base === "market" ? marketProfit : base === "suggested" ? suggestedProfit : null;
  const mark = warn ? "⚠️" : !publish ? "❌" : outProfit === null || outProfit > 0 ? "✅" : "🔻";
  const gap = r.suggested > 0 && r.market > 0 ? round2(r.suggested - r.market) : null;
  const what = publish ? `انشر بـ ${fixed2(price)}` : "لا تنشر";
  const outcome = locked ? (publish ? `${mark} ${state === "published" ? "نُشر" : "يُنشر"} بـ ${fixed2(price)}` : `${mark} لم يُنشر`)
    : r.decision ? `${mark} قرارك: ${what}`
    : publish ? `${mark} ${what} · ${approved ? "معتمد" : "ينتظر قرارك"}` : `${mark} ${what}`;
  return {
    lineId: r.lineId, name: r.name, mark,
    purchase: r.purchase, purchaseVat: purchaseWithVat(r.purchase), market: r.market, suggested: r.suggested,
    ours: publish && approved ? price : r.suggested > 0 ? r.suggested : 0, decided: publish && approved,
    marketProfit, suggestedProfit, profit, profitBase: profit === null ? null : base,
    gap, gapPct: gap === null ? null : (gap / r.market) * 100,
    publish, price, approved, warn, noShare: noShare(r), outcome,
  };
}

/** The rows of a day's lines, as they are (or will be) stored: every line of the active catalog, in the lines' order. */
export function screenRows(lines: DayLine[], above: AboveSuggested, day: string, state: DayState): ScreenRow[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return reviewRows(lines, above, day).map((r) => screenRow(r, byId.get(r.lineId) as DayLine, state));
}

// ---------------------------------------------------------------- the table's cells and the header's numbers

export type ScreenLineVals = Record<(typeof SCREEN_LINE_FIELDS)[number], string | number>;
export type ScreenHeader = Record<(typeof SCREEN_DAY_FIELDS)[number], string | number>;

/**
 * A cell of signed numbers reads left to right — «+1.13», «19.50 (+2.37)» — wherever it is shown: a
 * left-to-right mark in front of it. (In a right-to-left cell a number's sign would otherwise jump to
 * its right: «1.13+».)
 */
export const LTR_MARK = "\u200e";
const ltr = (s: string): string => `${LTR_MARK}${s}`;
/** «+1.13», «−0.74»; a day whose cost could not be read says so beside it. */
const profitText = (p: number, row: ScreenRow): string => `${signed(p)}${row.noShare ? NO_SHARE_NOTE : ""}`;

/** What the table shows of one line. `row`: null for a line that left the active catalog. */
function lineVals(row: ScreenRow | null, l: DayLine): ScreenLineVals {
  if (!row) {
    const vat = purchaseWithVat(Number(l.x_cost_price) || 0);
    return { x_cost_vat_show: vat > 0 ? fixed2(vat) : NONE, x_market_profit: 0, x_market_profit_show: NONE, x_suggested_profit_show: NONE, x_gap_show: NONE, x_outcome_show: OUT_OF_CATALOG_TEXT };
  }
  return {
    x_cost_vat_show: row.purchaseVat > 0 ? fixed2(row.purchaseVat) : NONE,
    x_market_profit: row.marketProfit ?? 0,
    x_market_profit_show: row.marketProfit === null ? NONE : ltr(profitText(row.marketProfit, row)),
    x_suggested_profit_show: row.suggested > 0 ? ltr(`${fixed2(row.suggested)}${row.suggestedProfit === null ? "" : ` (${profitText(row.suggestedProfit, row)})`}`) : NONE,
    x_gap_show: row.gap === null || row.gapPct === null ? NONE : ltr(`${signed(row.gap)} (${signedPct(row.gapPct)})`),
    x_outcome_show: row.outcome,
  };
}

/** The mean of the profit of the items that go out (each item once: no quantity is known yet); null with none. */
export function averageProfit(rows: ScreenRow[]): number | null {
  const profits = rows.filter((r) => r.publish && r.profit !== null).map((r) => r.profit as number);
  return profits.length ? round2(profits.reduce((a, b) => a + b, 0) / profits.length) : null;
}

function headerVals(rows: ScreenRow[]): ScreenHeader {
  const publish = rows.filter((r) => r.publish).length, avg = averageProfit(rows);
  return {
    x_n_publish: publish, x_n_skip: rows.length - publish, x_n_warn: rows.filter((r) => r.warn).length,
    x_avg_profit: avg ?? 0, x_avg_profit_show: avg === null ? NONE : ltr(signed(avg)),
    x_chart_html: dayChartHtml(rows),
  };
}

export interface DayScreen { rows: ScreenRow[]; lines: ScreenLineVals[]; header: ScreenHeader }
/**
 * The screen of a day from its lines as they are (or will be) stored: `lines[i]` is what the table
 * shows of the i-th line, `header` what the day carries. Every line needs an id of its own (a line
 * not created yet: any number no other line has). Pure.
 */
export function dayScreen(lines: DayLine[], above: AboveSuggested, day: string, state: DayState): DayScreen {
  const rows = screenRows(lines, above, day, state);
  const of = new Map(rows.map((r) => [r.lineId, r]));
  // a line that left the active catalog is no row of the review: it gets «خارج الكتالوج النشط», and stays out of the numbers and the chart
  return { rows, lines: lines.map((l) => lineVals(of.get(l.id) ?? null, l)), header: headerVals(rows) };
}

// ---------------------------------------------------------------- the chart

/** Text into HTML: no tag ever comes from a name. (A no-break space would be stored as an entity: a plain one.) */
export const esc = (s: string): string => String(s ?? "").replace(/\u00a0/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface ChartAxis { lo: number; hi: number; step: number; ticks: number[] }
/** One linear axis in riyals for every price of the chart: round bounds close around them, a round step, nine ticks at most. Null without a price. */
export function chartAxis(values: number[]): ChartAxis | null {
  const v = values.filter((x) => x > 0);
  if (!v.length) return null;
  const min = Math.min(...v), max = Math.max(...v);
  const raw = (max - min || max * 0.2) / 7, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  // the step is never below a seventh of the range, so the bounds hold eight steps at most
  const step = r6((n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
  const lo = r6(Math.floor(r6(min / step)) * step);
  let hi = r6(Math.ceil(r6(max / step)) * step);
  if (hi <= lo) hi = r6(lo + step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1e3; t = r6(t + step)) ticks.push(t);
  return { lo, hi, step, ticks };
}
/** Where a price stands on the axis, in percent of its length (two decimals, inside 0–100). */
export function axisAt(a: ChartAxis, x: number): number {
  return Math.round(Math.min(100, Math.max(0, ((x - a.lo) / (a.hi - a.lo)) * 100)) * 100) / 100;
}

/** The three marks: a shape each, never a colour alone. Each is drawn in the text's own colour. */
const MARK_AT = "position:absolute;top:50%;";
const SHAPE = {
  cost: "width:10px;height:10px;background:currentColor",
  market: "width:14px;height:14px;border:2px solid currentColor;border-radius:50%;box-sizing:border-box",
  ours: "width:10px;height:10px;background:currentColor;transform:rotate(45deg)",
} as const;
const HALF = { cost: 5, market: 7, ours: 5 } as const;
export const MARK_LABEL = { cost: "الشراء شامل", market: "السوق", ours: "سعرنا" } as const;
type MarkKind = keyof typeof SHAPE;
/** A mark on the track, centred on its price. */
const markOn = (kind: MarkKind, at: number, value: number): string =>
  `<div class="utak-m-${kind}" title="${MARK_LABEL[kind]} ${fixed2(value)}" style="${MARK_AT}left:${at}%;margin:-${HALF[kind]}px 0 0 -${HALF[kind]}px;${SHAPE[kind]}"></div>`;
/** The same shape in a line of text (the key, and each row's values). */
const markIn = (kind: MarkKind): string => `<span style="display:inline-block;vertical-align:middle;margin:0 3px;${SHAPE[kind]}"></span>`;

/** «▲ +1.13 بسعر السوق» in green, «▼ −0.74 بسعر السوق» in red: the sign and the arrow say what the colour says. */
function profitLabel(r: ScreenRow): string {
  if (r.profit === null || r.profitBase === null) return `<div class="utak-profit text-muted">${r.purchase > 0 ? NONE : NO_PURCHASE_TEXT}</div>`;
  const tone = r.profit > 0 ? " text-success" : r.profit < 0 ? " text-danger" : "";
  const arrow = r.profit > 0 ? "▲ " : r.profit < 0 ? "▼ " : "";
  return `<div class="utak-profit fw-bold${tone}">${arrow}<span dir="ltr">${signed(r.profit)}</span> <span class="fw-normal">${PROFIT_BASE_TEXT[r.profitBase]}${r.noShare ? NO_SHARE_NOTE : ""}</span></div>`;
}

/** The label column is this wide on a wide screen; on a phone it sits above the track. */
const LABEL_COLUMN = "flex:0 0 15em;max-width:100%";
const TRACK_COLUMN = "flex:1 1 0;min-width:0";
/** The track keeps the marks' half width clear at both ends. */
const TRACK = "position:relative;margin:0 10px;";
const line = (style: string): string => `<div class="text-muted" style="position:absolute;${style};background:currentColor"></div>`;

function priceRow(r: ScreenRow, a: ChartAxis | null): string {
  const marks: string[] = [], values: string[] = [];
  if (a) {
    marks.push(line("left:0;right:0;top:50%;height:1px"), ...a.ticks.map((t) => line(`left:${axisAt(a, t)}%;top:50%;width:1px;height:8px;margin-top:-4px`)));
    // the gap between the market price and ours, drawn: the longer it is, the further our price stands from the market
    if (r.market > 0 && r.ours > 0 && !near(r.market, r.ours)) {
      const from = axisAt(a, Math.min(r.market, r.ours)), to = axisAt(a, Math.max(r.market, r.ours));
      marks.push(line(`left:${from}%;width:${Math.round((to - from) * 100) / 100}%;top:50%;height:3px;margin-top:-1.5px`));
    }
    if (r.purchaseVat > 0) marks.push(markOn("cost", axisAt(a, r.purchaseVat), r.purchaseVat));
    if (r.market > 0) marks.push(markOn("market", axisAt(a, r.market), r.market));
    if (r.ours > 0) marks.push(markOn("ours", axisAt(a, r.ours), r.ours));
  }
  const value = (kind: MarkKind, x: number, note = ""): string => `<span class="text-nowrap">${markIn(kind)}${MARK_LABEL[kind]} <span dir="ltr">${fixed2(x)}</span>${note}</span>`;
  values.push(r.purchaseVat > 0 ? value("cost", r.purchaseVat) : `<span class="text-nowrap">${NO_PURCHASE_TEXT}</span>`);
  values.push(r.market > 0 ? value("market", r.market) : `<span class="text-nowrap">${NO_MARKET_TEXT}</span>`);
  if (r.ours > 0) values.push(value("ours", r.ours, r.decided ? " (مقرر)" : " (مقترح)"));
  return `<div class="utak-row d-md-flex align-items-center border-top py-2">`
    + `<div class="mb-1 mb-md-0" style="${LABEL_COLUMN}"><div class="utak-name fw-bold">${r.mark} ${esc(r.name)}</div>${profitLabel(r)}</div>`
    + `<div style="${TRACK_COLUMN}"><div class="utak-track" dir="ltr" style="${TRACK}height:26px">${marks.join("")}</div>`
    + `<div class="utak-values small d-flex flex-wrap" style="column-gap:14px">${values.join("")}</div></div>`
    + `</div>`;
}

/** The axis' numbers, once, under the rows (the same columns as a row: they stand under the tracks). */
function axisRow(a: ChartAxis): string {
  const labels = a.ticks.map((t) => `<div style="position:absolute;left:${axisAt(a, t)}%;top:0;transform:translateX(-50%)">${Number.isInteger(t) ? t : r6(t)}</div>`).join("");
  return `<div class="utak-axis d-md-flex align-items-start border-top pt-1">`
    + `<div class="d-none d-md-block small text-muted" style="${LABEL_COLUMN}">المحور بالريال</div>`
    + `<div style="${TRACK_COLUMN}"><div class="small text-muted" dir="ltr" style="${TRACK}height:20px">${labels}</div></div>`
    + `</div>`;
}

/** A column's height: this many pixels for the day's largest profit or loss. */
const BAR_UNIT_PX = 72;
const BAR_LABEL_PX = 24;
const BAR_WIDTH_PX = 24;

function profitBars(rows: ScreenRow[]): string {
  const known = rows.filter((r) => r.profit !== null).map((r) => r.profit as number);
  const top = Math.max(0, ...known), bottom = Math.max(0, ...known.map((p) => -p)), most = Math.max(top, bottom, 0.01);
  const px = (p: number): number => Math.max(2, Math.round((Math.abs(p) / most) * BAR_UNIT_PX));
  const up = (top > 0 ? px(top) : 0) + BAR_LABEL_PX, down = bottom > 0 ? px(bottom) + BAR_LABEL_PX : 8;
  const zero = `<div class="utak-zero" style="height:2px;background:currentColor"></div>`;
  const cell = (r: ScreenRow): string => {
    const p = r.profit, label = `<div class="utak-bar-value small fw-bold" dir="ltr">${p === null ? NONE : signed(p)}</div>`;
    const bar = (tone: string, radius: string): string => `<div class="utak-bar ${tone}" title="${p === null ? "" : signed(p)}" style="width:${BAR_WIDTH_PX}px;height:${px(p as number)}px;border-radius:${radius};background:currentColor"></div>`;
    return `<div class="utak-col text-center" style="flex:1 1 84px;min-width:84px;max-width:150px">`
      + `<div class="d-flex flex-column justify-content-end align-items-center" style="height:${up}px">${p === null || p >= 0 ? label : ""}${p !== null && p > 0 ? bar("text-success", "4px 4px 0 0") : ""}</div>`
      + zero
      + `<div class="d-flex flex-column justify-content-start align-items-center" style="height:${down}px">${p !== null && p < 0 ? bar("text-danger", "0 0 4px 4px") + label : ""}</div>`
      + `<div class="small fw-bold">${r.mark} ${esc(r.name)}</div>`
      + `<div class="small text-muted">${r.profitBase ? PROFIT_BASE_TEXT[r.profitBase] : r.purchase > 0 ? NONE : NO_PURCHASE_TEXT}</div>`
      + `</div>`;
  };
  // the zero line's own label, at the line's height
  const lead = `<div class="small text-muted text-center" style="flex:0 0 1.6em"><div style="height:${up - 9}px"></div><div style="line-height:20px">0</div></div>`;
  return `<div class="utak-bars d-flex flex-wrap" style="row-gap:16px">${lead}${rows.map(cell).join("")}</div>`;
}

export const CHART_TITLE_PRICES = "سعرنا مقابل السوق";
export const CHART_PRICES_NOTE = "صف لكل صنف على محور واحد بالريال: أين سعر شرائنا شاملاً الضريبة، وسعر السوق، وسعرنا.";
export const CHART_TITLE_PROFIT = "ربح الكرتون";
export const CHART_PROFIT_NOTE = "الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل";
export const CHART_EMPTY_TEXT = "لا أصناف في أسعار هذا اليوم بعد.";

/**
 * The chart of a day, as HTML for x_chart_html: «سعرنا مقابل السوق» (one key above it, a row an
 * item, one axis in riyals) and «ربح الكرتون» (a column an item around a zero line). An item
 * without a market price has two marks and «لا سعر سوق». Pure.
 */
export function dayChartHtml(rows: ScreenRow[]): string {
  if (!rows.length) return `<div class="utak-day-chart text-muted">${CHART_EMPTY_TEXT}</div>`;
  const axis = chartAxis(rows.flatMap((r) => [r.purchaseVat, r.market, r.ours]));
  const key = `<div class="utak-key d-flex flex-wrap small mb-2" style="column-gap:18px;row-gap:4px">`
    + `<span class="text-nowrap">${markIn("cost")}${MARK_LABEL.cost} الضريبة</span>`
    + `<span class="text-nowrap">${markIn("market")}${MARK_LABEL.market}</span>`
    + `<span class="text-nowrap">${markIn("ours")}${MARK_LABEL.ours} (المقرر، أو المقترح إن لم يُقرر)</span>`
    + `<span class="text-nowrap">▲ ربح · ▼ خسارة</span>`
    + `</div>`;
  return `<div class="utak-day-chart">`
    + `<div class="utak-prices mb-4"><div class="fs-4 fw-bold">${CHART_TITLE_PRICES}</div><div class="small text-muted mb-2">${CHART_PRICES_NOTE}</div>${key}${rows.map((r) => priceRow(r, axis)).join("")}${axis ? axisRow(axis) : ""}</div>`
    + `<div class="utak-profits"><div class="fs-4 fw-bold">${CHART_TITLE_PROFIT}</div><div class="small text-muted mb-2">فوق الخط ربح، وتحته خسارة — ريال للكرتون (${CHART_PROFIT_NOTE}).</div>${profitBars(rows)}</div>`
    + `</div>`;
}

// ---------------------------------------------------------------- a stored day

export interface ScreenReport { day: string; dayId: number; state: DayState; lines: number; updated: number; header: ScreenHeader; rows: ScreenRow[]; values: ScreenLineVals[] }

/**
 * The screen of a stored day from its lines as they are — after a publication (the lines then say
 * «نُشر بـ …» / «لم يُنشر»), and for a day computed before § 56. Only the screen's own fields are
 * written (SCREEN_LINE_FIELDS on a line that differs, SCREEN_DAY_FIELDS on the day): no price, no
 * status, no decision. `dry`: nothing is written.
 */
export async function writeDayScreen(env: Env, dayId: number, opts: { dry?: boolean } = {}): Promise<ScreenReport> {
  const [rec] = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: [dayId], fields: ["id", "x_date", "x_state"] });
  if (!rec) throw new Error(`[day-screen] no x_price_day ${dayId}`);
  const settings = await readPricingSettings(env, rec.x_date);
  const lines = await readLines(env, dayId);
  const screen = dayScreen(lines, settings?.aboveSuggested ?? ABOVE_SUGGESTED_DEFAULT, rec.x_date, rec.x_state);
  let updated = 0;
  for (const [i, l] of lines.entries()) {
    const vals = Object.fromEntries(Object.entries(screen.lines[i]).filter(([k, v]) => !sameCell((l as unknown as Record<string, unknown>)[k], v)));
    if (!Object.keys(vals).length) continue;
    updated++;
    if (!opts.dry) await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
  }
  if (!opts.dry) await call(env, PRICE_DAY_MODEL, "write", { ids: [dayId], vals: screen.header });
  return { day: rec.x_date, dayId, state: rec.x_state, lines: lines.length, updated, header: screen.header, rows: screen.rows, values: screen.lines };
}
/** A stored cell against the one to write: an empty char is `false` in Odoo, a float within a hair. */
function sameCell(cur: unknown, want: string | number): boolean {
  if (typeof want === "number") return Math.abs((Number(cur) || 0) - want) < 0.0001;
  return (typeof cur === "string" ? cur : "") === want;
}
