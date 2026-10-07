// § 64 (2026-10-07) — «📈 تاريخ الأسعار»: the page the WORKER builds, in place of Odoo's ready chart (which fills an
// empty day with a zero once two lines share it, opens on every item at once, and has neither a reference line nor
// a guard against too little data).
//
// The page asks ONE question — «كيف يتحرك سعر السوق مقابل شرائنا؟» — and answers it an item a card:
//   • the item and its pack; the last market price and its change from THE LAST REAL DAY that had one (▲ / ▼ in
//     riyals and per cent — never from an empty day); the last purchase price;
//   • a small chart (SVG, drawn here, no library): two lines — the market price and our purchase price — and one
//     dashed reference: «بدون خسارة», the carton's full cost as the system computes it (the purchase + its waste
//     + the carton's share of the day's cost, × 1.15 — the number the engine wrote on the day's line);
//   • A DAY WITH NO PRICE IS A GAP in the line: never a zero, never a stroke across it;
//   • fewer than MIN_DAYS days with a market price in the period: «بيانات غير كافية (N أيام)» and no chart.
// Above the cards: the period (14 / 30 / 90 days), the order (the biggest market move / the name / the category),
// the category, and «النشطة للبيع فقط» (on unless switched off). Every control is a link: the page runs no script.
//
// The data: the real days' lines (x_price_day_line, the same scope as Odoo's «🔢 جدول الأسعار»: no simulation).
// A special request's observations never reach a day's line (src/special-quote.ts), so none is here.
//
// The door: Odoo's menu makes a ONE-USE ticket (x_preview_ticket, § 62 د) and opens /history/t/<ticket>; the worker
// burns it and answers 302 to /history/p/<expiry>/<signature> — its own link, good for LINK_TTL_MS. No fixed secret
// is in the menu, the action or the address. The page shows purchase prices and costs: it is Baraa's alone.
// READ-ONLY: nothing is written but the ticket's own row, and nothing is sent.

import type { Env } from "./config";
import { call, stripRef } from "./odoo";
import { riyadhDateKey } from "./hours";
import { arabicDate } from "./wa-params";
import { signDocToken } from "./pdf-template";
import { LINK_TTL_MS, messagePage, redeemTicket, type TicketWords } from "./quote-preview";

export const HISTORY_PREFIX = "/history/";
export const HISTORY_MODEL = "x_price_day_line";
export const HISTORY_TITLE = "كيف يتحرك سعر السوق مقابل شرائنا؟";
export const PERIODS = [14, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 14;
/** A chart needs this many days with a market price in the period. */
export const MIN_DAYS = 5;
/** How far back the lines are read: the longest period. */
export const LOOKBACK_DAYS = 90;
export const MAX_WIDTH_PX = 960;
export type SortKey = "move" | "name" | "cat";
export const SORTS: ReadonlyArray<[SortKey, string]> = [["move", "أكبر حركة سوق"], ["name", "الاسم"], ["cat", "الفئة"]];
export const NO_CATEGORY = "بلا فئة";
const VAT_PCT = 15;

export interface HistoryQuery {
  days: Period;
  sort: SortKey;
  /** A category's id; 0 = the items with none; null = every category. */
  category: number | null;
  activeOnly: boolean;
}
export const DEFAULT_QUERY: HistoryQuery = { days: DEFAULT_PERIOD, sort: "move", category: null, activeOnly: true };
/** The page's choices from its address; anything unknown is the default. */
export function parseQuery(p: URLSearchParams): HistoryQuery {
  const d = Number(p.get("d"));
  const s = p.get("s");
  const c = p.get("c");
  return {
    days: (PERIODS as readonly number[]).includes(d) ? (d as Period) : DEFAULT_PERIOD,
    sort: s === "name" || s === "cat" ? s : "move",
    category: c !== null && /^\d{1,9}$/.test(c) ? Number(c) : null,
    activeOnly: p.get("all") !== "1",
  };
}
/** The address's query for a choice (the defaults are left out). */
export function queryString(q: HistoryQuery): string {
  const p: string[] = [];
  if (q.days !== DEFAULT_PERIOD) p.push(`d=${q.days}`);
  if (q.sort !== "move") p.push(`s=${q.sort}`);
  if (q.category !== null) p.push(`c=${q.category}`);
  if (!q.activeOnly) p.push("all=1");
  return p.length ? `?${p.join("&")}` : "";
}

export interface HistoryRow { day: string; productId: number; market: number; purchase: number; breakEven: number; fullCost: number; pack: string }
export interface HistoryProduct { id: number; name: string; categoryId: number; category: string; activeForSale: boolean }
export interface Point { day: string; value: number }
export interface HistoryCard {
  productId: number;
  name: string;
  pack: string;
  categoryId: number;
  category: string;
  /** The period's days, oldest first; the three series hold a value or null (no price that day) for each. */
  days: string[];
  market: Array<number | null>;
  purchase: Array<number | null>;
  reference: Array<number | null>;
  /** The days of the period that have a market price. */
  marketDays: number;
  lastMarket: Point | null;
  /** The last real day BEFORE lastMarket that had a market price (it may be older than the period). */
  prevMarket: Point | null;
  change: { amount: number; pct: number } | null;
  lastPurchase: Point | null;
  lastReference: Point | null;
  enough: boolean;
}
export interface HistoryModel {
  today: string;
  query: HistoryQuery;
  cards: HistoryCard[];
  /** The categories of the items that have a price in the period (before the category's own filter), by name. */
  categories: Array<{ id: number; name: string; count: number }>;
  insufficient: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const price = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
/** `n` days after an ISO day (before it when negative). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}
/** The days of a period that ends today, oldest first. */
export const periodDays = (today: string, days: number): string[] => Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
/**
 * «بدون خسارة» of a day's line: the engine's own number (priceFloor: the full cost × 1.15, in whole halalas); a
 * line that holds the full cost alone gets the same step from it. 0 = the line has neither.
 */
export function referenceOf(r: Pick<HistoryRow, "breakEven" | "fullCost">): number {
  if (r.breakEven > 0) return r.breakEven;
  return r.fullCost > 0 ? Math.round((Math.round(r.fullCost * 100) * (100 + VAT_PCT)) / 100) / 100 : 0;
}

/** The page's model from the real days' lines: pure. `rows` may reach further back than the period (the change needs them). */
export function buildHistory(rows: HistoryRow[], products: HistoryProduct[], today: string, query: HistoryQuery): HistoryModel {
  const days = periodDays(today, query.days);
  const from = days[0];
  const productOf = new Map(products.map((p) => [p.id, p]));
  const byProduct = new Map<number, HistoryRow[]>();
  for (const r of rows) {
    if (!(r.productId > 0) || r.day > today) continue;
    const list = byProduct.get(r.productId) ?? [];
    list.push(r);
    byProduct.set(r.productId, list);
  }
  const all: HistoryCard[] = [];
  for (const [productId, list] of byProduct) {
    const p = productOf.get(productId);
    if (!p) continue;
    if (query.activeOnly && !p.activeForSale) continue;
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    // a day's line (the later one, were a day to hold two)
    const onDay = new Map(list.map((r) => [r.day, r]));
    const series = (pick: (r: HistoryRow) => number): Array<number | null> => days.map((d) => { const r = onDay.get(d); const v = r ? pick(r) : 0; return v > 0 ? v : null; });
    const market = series((r) => price(r.market)), purchase = series((r) => price(r.purchase));
    // the reference stands only where there is a purchase to stand on
    const reference = series((r) => (price(r.purchase) > 0 ? referenceOf(r) : 0));
    if (!market.some((v) => v !== null) && !purchase.some((v) => v !== null)) continue;
    const last = (s: Array<number | null>): Point | null => { for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return { day: days[i], value: s[i] as number }; return null; };
    const lastMarket = last(market);
    const before = lastMarket ? [...onDay.values()].filter((r) => r.day < lastMarket.day && price(r.market) > 0).pop() : undefined;
    const prevMarket = before ? { day: before.day, value: price(before.market) } : null;
    const amount = lastMarket && prevMarket ? round2(lastMarket.value - prevMarket.value) : 0;
    const marketDays = market.filter((v) => v !== null).length;
    const inPeriod = [...onDay.values()].filter((r) => r.day >= from);
    all.push({
      productId, name: p.name, pack: inPeriod[inPeriod.length - 1]?.pack ?? "", categoryId: p.categoryId, category: p.category || NO_CATEGORY,
      days, market, purchase, reference, marketDays, lastMarket, prevMarket,
      change: lastMarket && prevMarket ? { amount, pct: round2((amount / prevMarket.value) * 100) } : null,
      lastPurchase: last(purchase), lastReference: last(reference), enough: marketDays >= MIN_DAYS,
    });
  }
  const cats = new Map<number, { id: number; name: string; count: number }>();
  for (const c of all) { const k = cats.get(c.categoryId) ?? { id: c.categoryId, name: c.category, count: 0 }; k.count++; cats.set(c.categoryId, k); }
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, "ar");
  const cards = all.filter((c) => query.category === null || c.categoryId === query.category);
  const move = (c: HistoryCard): number => (c.change ? Math.abs(c.change.pct) : -1);
  cards.sort((a, b) => (query.sort === "name" ? byName(a, b)
    : query.sort === "cat" ? a.category.localeCompare(b.category, "ar") || byName(a, b)
    : move(b) - move(a) || byName(a, b)));
  return { today, query, cards, categories: [...cats.values()].sort(byName), insufficient: cards.filter((c) => !c.enough).length };
}

// ---------------------------------------------------------------- the chart
const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const money = (n: number): string => n.toFixed(2);
/** «6/10»: a day as the page writes it. */
export const dayLabel = (day: string): string => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
const CHART = { w: 440, h: 168, left: 40, right: 12, top: 12, bottom: 24 } as const;
/** The runs of consecutive days that have a value: [[start index, values…], …]. A gap ends a run. */
export function runs(values: Array<number | null>): Array<{ at: number; values: number[] }> {
  const out: Array<{ at: number; values: number[] }> = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const lastRun = out[out.length - 1];
    if (lastRun && lastRun.at + lastRun.values.length === i) lastRun.values.push(v);
    else out.push({ at: i, values: [v] });
  });
  return out;
}
const n1 = (n: number): string => (Math.round(n * 10) / 10).toString();
/**
 * One item's chart. A line is drawn run by run (a day with no price breaks it); a value is a marker with its own
 * native tooltip (a circle for the market, a square for the purchase: the two are told apart without colour).
 */
export function chartSvg(c: HistoryCard): string {
  const n = c.days.length;
  const vals = [...c.market, ...c.purchase, ...c.reference].filter((v): v is number => v !== null);
  if (!vals.length) return "";
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = hi > lo ? (hi - lo) * 0.12 : Math.max(1, hi * 0.05);
  lo = Math.max(0, lo - pad); hi += pad;
  const pw = CHART.w - CHART.left - CHART.right, ph = CHART.h - CHART.top - CHART.bottom;
  const x = (i: number): number => CHART.left + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v: number): number => CHART.top + ph - ((v - lo) / (hi - lo)) * ph;
  const path = (values: Array<number | null>): string => runs(values).filter((r) => r.values.length > 1)
    .map((r) => r.values.map((v, k) => `${k ? "L" : "M"}${n1(x(r.at + k))} ${n1(y(v))}`).join(" ")).join(" ");
  // a marker on every value while the days are few; on a long period only where a line cannot show it (a lone day) and on the last
  const dense = n > 30;
  const lastAt = (values: Array<number | null>): number => { for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i; return -1; };
  const marked = (values: Array<number | null>): number[] => {
    const lone = new Set(runs(values).filter((r) => r.values.length === 1).map((r) => r.at));
    const end = lastAt(values);
    return values.map((v, i) => (v !== null && (!dense || lone.has(i) || i === end) ? i : -1)).filter((i) => i >= 0);
  };
  const tip = (name: string, i: number, v: number): string => `<title>${esc(`${dayLabel(c.days[i])} · ${name} ${money(v)}`)}</title>`;
  const dots = marked(c.market).map((i) => `<circle class="m-market" cx="${n1(x(i))}" cy="${n1(y(c.market[i] as number))}" r="4">${tip("سعر السوق", i, c.market[i] as number)}</circle>`).join("");
  const squares = marked(c.purchase).map((i) => `<rect class="m-purchase" x="${n1(x(i) - 4)}" y="${n1(y(c.purchase[i] as number) - 4)}" width="8" height="8" rx="1">${tip("سعر شرائنا", i, c.purchase[i] as number)}</rect>`).join("");
  // the reference: dashed; a lone day of it is a short dash of its own
  const ref = runs(c.reference).map((r) => (r.values.length > 1
    ? `<path class="l-ref" d="${r.values.map((v, k) => `${k ? "L" : "M"}${n1(x(r.at + k))} ${n1(y(v))}`).join(" ")}"/>`
    : `<path class="l-ref" d="M${n1(x(r.at) - 7)} ${n1(y(r.values[0]))} L${n1(x(r.at) + 7)} ${n1(y(r.values[0]))}"/>`)).join("");
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<line class="grid" x1="${CHART.left}" x2="${CHART.w - CHART.right}" y1="${n1(y(v))}" y2="${n1(y(v))}"/><text class="tick" x="${CHART.left - 6}" y="${n1(y(v) + 3.5)}" text-anchor="end">${money(v)}</text>`).join("");
  const xl = (i: number, anchor: string): string => `<text class="tick" x="${n1(x(i))}" y="${CHART.h - 6}" text-anchor="${anchor}">${dayLabel(c.days[i])}</text>`;
  const label = `${c.name}: سعر السوق وسعر شرائنا وخط «بدون خسارة»، من ${dayLabel(c.days[0])} إلى ${dayLabel(c.days[n - 1])}`;
  return `<svg class="chart" viewBox="0 0 ${CHART.w} ${CHART.h}" role="img" aria-label="${esc(label)}" direction="ltr">${ticks}${xl(0, "start")}${n > 2 ? xl(Math.floor((n - 1) / 2), "middle") : ""}${n > 1 ? xl(n - 1, "end") : ""}${ref}<path class="l-purchase" d="${path(c.purchase)}"/><path class="l-market" d="${path(c.market)}"/>${squares}${dots}</svg>`;
}

// ---------------------------------------------------------------- the page
/** «▲ 1.50 ريال (8.11%) عن 5/10»; the first market price on record has nothing to be compared with. */
export function changeText(c: Pick<HistoryCard, "change" | "prevMarket" | "lastMarket">): string {
  if (!c.lastMarket) return "لا سعر سوق في الفترة";
  if (!c.change || !c.prevMarket) return "أول سعر سوق في السجل";
  const since = `عن ${dayLabel(c.prevMarket.day)}`;
  if (c.change.amount === 0) return `بلا تغيير ${since}`;
  return `${c.change.amount > 0 ? "▲" : "▼"} ${money(Math.abs(c.change.amount))} ريال (${money(Math.abs(c.change.pct))}%) ${since}`;
}
export const insufficientText = (n: number): string => `بيانات غير كافية (${n === 0 ? "لا يوم" : n === 1 ? "يوم واحد" : n === 2 ? "يومان" : `${n} أيام`})`;

const CSS = `:root{--bg:#F7F5F0;--card:#FFFFFF;--ink:#1A1815;--muted:#6B6863;--line:#E8E4DE;--brand:#1E5A41;--chip:#EFEBE4;--on:#1E5A41;--on-ink:#FFFFFF;--market:#eb6834;--purchase:#2a78d6;--ref:#6B6863}
@media (prefers-color-scheme: dark){:root{--bg:#171512;--card:#211F1C;--ink:#F3F1EC;--muted:#B5B1A9;--line:#35322D;--brand:#7BC4A3;--chip:#2B2824;--on:#7BC4A3;--on-ink:#12110F;--market:#d95926;--purchase:#3987e5;--ref:#B5B1A9}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans Arabic','Tajawal',system-ui,sans-serif;font-variant-numeric:tabular-nums;line-height:1.6;overflow-x:hidden}
.wrap{max-width:${MAX_WIDTH_PX}px;margin:0 auto;padding:20px 16px 40px}
.brand{font-size:13px;font-weight:500;color:var(--brand);letter-spacing:.02em}
h1{font-size:24px;font-weight:500;margin:2px 0 4px;color:var(--ink);text-wrap:balance}
.sub{font-size:13px;color:var(--muted);margin:0 0 14px}
.controls{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:12px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.row>span{font-size:12px;color:var(--muted);min-width:52px}
a.chip{display:inline-block;padding:4px 12px;border-radius:999px;background:var(--chip);color:var(--ink);font-size:13px;text-decoration:none;white-space:nowrap}
a.chip.on{background:var(--on);color:var(--on-ink);font-weight:500}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--muted);margin:0 0 14px}
.legend b{font-weight:400;color:var(--ink)}
.key{display:inline-block;vertical-align:middle;margin-inline-end:6px}
.grid2{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
@media (min-width:720px){.grid2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 14px 10px;min-width:0}
.card h2{font-size:17px;font-weight:500;margin:0;overflow-wrap:anywhere}
.pack{font-size:12px;color:var(--muted);margin-bottom:8px}
.stats{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 12px;margin-bottom:6px}
.stat .k{font-size:11px;color:var(--muted)}
.stat .v{font-size:20px;font-weight:500;direction:ltr;unicode-bidi:isolate;display:inline-block}
.stat .v small{font-size:11px;font-weight:400;color:var(--muted)}
.stat .d{font-size:12px;color:var(--muted)}
.chart{display:block;width:100%;height:auto;margin-top:4px}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .tick{fill:var(--muted);font-size:10px;font-family:inherit}
.chart .l-market{fill:none;stroke:var(--market);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .l-purchase{fill:none;stroke:var(--purchase);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .l-ref{fill:none;stroke:var(--ref);stroke-width:1.5;stroke-dasharray:4 4}
.chart .m-market{fill:var(--market);stroke:var(--card);stroke-width:2}
.chart .m-purchase{fill:var(--purchase);stroke:var(--card);stroke-width:2}
.thin{border:1px dashed var(--line);border-radius:8px;padding:18px 12px;text-align:center;color:var(--muted);font-size:14px;margin-top:6px}
.thin small{display:block;font-size:11px;margin-top:2px}
details{margin-top:6px;font-size:12px;color:var(--muted)}
summary{cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:6px;color:var(--ink)}
th,td{padding:3px 4px;border-bottom:1px solid var(--line);text-align:start;font-weight:400}
th{color:var(--muted);font-size:11px}
td.n{direction:ltr;text-align:end}
.empty{padding:40px 12px;text-align:center;color:var(--muted)}
.foot{margin-top:18px;font-size:11px;color:var(--muted);text-align:center}`;
const KEY_MARKET = `<svg class="key" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--market)" stroke-width="2"/><circle cx="11" cy="5" r="4" fill="var(--market)"/></svg>`;
const KEY_PURCHASE = `<svg class="key" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--purchase)" stroke-width="2"/><rect x="7" y="1" width="8" height="8" rx="1" fill="var(--purchase)"/></svg>`;
const KEY_REF = `<svg class="key" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--ref)" stroke-width="1.5" stroke-dasharray="4 4"/></svg>`;

function cardHtml(c: HistoryCard, today: string): string {
  const at = (p: Point | null): string => (p && p.day !== today ? ` <small>${dayLabel(p.day)}</small>` : "");
  const stat = (key: string, name: string, p: Point | null, under: string): string =>
    `<div class="stat"><div class="k">${key}${name}</div><div class="v">${p ? `${money(p.value)}${at(p)}` : "—"}</div><div class="d">${esc(under)}</div></div>`;
  const table = `<details><summary>الجدول</summary><table><thead><tr><th>اليوم</th><th>السوق</th><th>الشراء</th><th>بدون خسارة</th></tr></thead><tbody>${c.days.map((d, i) => (c.market[i] === null && c.purchase[i] === null ? "" :
    `<tr><td>${dayLabel(d)}</td>${[c.market[i], c.purchase[i], c.reference[i]].map((v) => `<td class="n">${v === null ? "—" : money(v)}</td>`).join("")}</tr>`)).join("")}</tbody></table></details>`;
  const body = c.enough ? chartSvg(c) : `<div class="thin">${insufficientText(c.marketDays)}<small>الرسم يظهر من ${MIN_DAYS} أيام فيها سعر سوق في الفترة</small></div>`;
  return `<article class="card" data-item="${c.productId}"><h2>${esc(c.name)}</h2><div class="pack">${esc(c.pack || "—")}</div>
<div class="stats">${stat(KEY_MARKET, "آخر سعر سوق", c.lastMarket, changeText(c))}${stat(KEY_PURCHASE, "آخر سعر شراء", c.lastPurchase, c.lastReference ? `بدون خسارة ${money(c.lastReference.value)}` : "")}</div>
${body}${table}</article>`;
}

/** The whole page. `base` = the page's own signed path; `until` = when its link ends (ms). */
export function renderHistoryPage(m: HistoryModel, base: string, until: number): string {
  const q = m.query;
  const chip = (label: string, to: HistoryQuery, on: boolean): string => `<a class="chip${on ? " on" : ""}" href="${esc(base + queryString(to))}"${on ? ' aria-current="true"' : ""}>${esc(label)}</a>`;
  const periods = PERIODS.map((d) => chip(`${d} يوماً`, { ...q, days: d }, q.days === d)).join("");
  const sorts = SORTS.map(([k, label]) => chip(label, { ...q, sort: k }, q.sort === k)).join("");
  const cats = chip("الكل", { ...q, category: null }, q.category === null) + m.categories.map((c) => chip(`${c.name} (${c.count})`, { ...q, category: c.id }, q.category === c.id)).join("");
  const active = chip(q.activeOnly ? "✓ النشطة للبيع فقط" : "النشطة للبيع فقط", { ...q, activeOnly: !q.activeOnly }, q.activeOnly);
  const hm = new Date(until + 3 * 3600_000).toISOString().slice(11, 16);
  const count = m.cards.length === 0 ? "لا أصناف" : m.cards.length === 1 ? "صنف واحد" : m.cards.length === 2 ? "صنفان" : m.cards.length <= 10 ? `${m.cards.length} أصناف` : `${m.cards.length} صنفاً`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>📈 تاريخ الأسعار — يو تاك</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="brand">يو تاك · 📈 تاريخ الأسعار</div>
<h1>${HISTORY_TITLE}</h1>
<p class="sub">آخر ${q.days} يوماً حتى ${esc(arabicDate(m.today))} · ${count}${m.insufficient ? ` · ${m.insufficient} بيانات غير كافية` : ""} · الأيام الحقيقية فقط</p>
<nav class="controls" aria-label="خيارات الصفحة">
<div class="row"><span>الفترة</span>${periods}</div>
<div class="row"><span>الترتيب</span>${sorts}</div>
<div class="row"><span>الفئة</span>${cats}</div>
<div class="row"><span>الأصناف</span>${active}</div>
</nav>
<p class="legend"><span>${KEY_MARKET}<b>سعر السوق</b> (شامل الضريبة)</span><span>${KEY_PURCHASE}<b>سعر شرائنا</b> (قبل الضريبة)</span><span>${KEY_REF}<b>بدون خسارة</b>: (الشراء + التالف + حصة التشغيل) × 1.15</span><span>اليوم بلا سعر فراغ في الخط</span></p>
${m.cards.length ? `<main class="grid2">${m.cards.map((c) => cardHtml(c, m.today)).join("\n")}</main>` : `<div class="empty">لا أسعار في هذه الفترة بهذه الخيارات.</div>`}
<p class="foot">تُفتح من Odoo: 💲 التسعير ← 📈 تاريخ الأسعار · هذا الرابط صالح حتى ${hm} · قراءة فقط</p>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- the data
type M2O = [number, string] | number | false | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);
const m2oName = (v: M2O): string => (Array.isArray(v) ? String(v[1] ?? "") : "");
const SIM_FIELD = "x_utak_simulation";
/** The real days alone: the scope of Odoo's «🔢 جدول الأسعار» (#1046) — neither a simulated line nor a simulated day. */
export const realDaysDomain = (from: string, to: string): unknown[] => [[SIM_FIELD, "=", false], [`x_day_id.${SIM_FIELD}`, "=", false], ["x_day_date", ">=", from], ["x_day_date", "<=", to]];

/** The real days' lines of the last LOOKBACK_DAYS, their items and the items' categories (three reads). Throws on Odoo trouble. */
export async function readHistory(env: Env, today: string): Promise<{ rows: HistoryRow[]; products: HistoryProduct[] }> {
  const raw = await call<Array<Record<string, unknown>>>(env, HISTORY_MODEL, "search_read", {
    domain: realDaysDomain(addDays(today, -(LOOKBACK_DAYS - 1)), today),
    fields: ["id", "x_day_date", "x_product_tmpl_id", "x_market_price", "x_cost_price", "x_break_even", "x_full_cost", "x_packaging_id"],
    order: "x_day_date asc, id asc", limit: 8000,
  });
  const rows: HistoryRow[] = raw.map((r) => ({
    day: String(r.x_day_date || ""), productId: m2oId(r.x_product_tmpl_id as M2O), market: price(r.x_market_price), purchase: price(r.x_cost_price),
    breakEven: price(r.x_break_even), fullCost: price(r.x_full_cost), pack: m2oName(r.x_packaging_id as M2O).trim(),
  })).filter((r) => r.day && r.productId > 0);
  const ids = [...new Set(rows.map((r) => r.productId))];
  const prods = ids.length ? await call<Array<{ id: number; name: string | false; categ_id: M2O; x_is_active_for_sale?: boolean }>>(env, "product.template", "search_read", {
    domain: [["id", "in", ids]], fields: ["id", "name", "categ_id", "x_is_active_for_sale"], limit: 1000, context: { active_test: false },
  }) : [];
  // a category's own name (Odoo's display name is its whole path, «All / فواكه»)
  const catIds = [...new Set(prods.map((p) => m2oId(p.categ_id)).filter((id) => id > 0))];
  const cats = catIds.length ? await call<Array<{ id: number; name: string | false }>>(env, "product.category", "search_read", { domain: [["id", "in", catIds]], fields: ["id", "name"], limit: 500 }) : [];
  const catName = new Map(cats.map((c) => [c.id, String(c.name || "").trim()]));
  return {
    rows,
    products: prods.map((p) => ({
      id: p.id, name: stripRef(String(p.name || "")).trim() || `#${p.id}`, categoryId: m2oId(p.categ_id), category: catName.get(m2oId(p.categ_id)) ?? "", activeForSale: p.x_is_active_for_sale === true,
    })),
  };
}

// ---------------------------------------------------------------- the door
const AGAIN = "ارجع إلى Odoo وافتح «📈 تاريخ الأسعار» من القائمة من جديد.";
const WORDS: TicketWords = { failed: "تعذّر فتح الصفحة", unknown: "رابط غير معروف", once: "رابط الصفحة يفتح مرة واحدة.", again: AGAIN };
const PAGE = /^p\/(\d{10,16})\/([a-f0-9]{16})$/;
const notFound = (): Response => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** The signature of the page's link: its expiry under the worker's own secret. */
export const historySignature = (secret: string, expiry: number): Promise<string> => signDocToken(secret, `history:${expiry}`);
export const historyLinkPath = async (secret: string, expiry: number): Promise<string> => `${HISTORY_PREFIX}p/${expiry}/${await historySignature(secret, expiry)}`;

/** Step 1 — the ticket Odoo's menu made: burnt, and exchanged for the worker's own signed link. */
export async function handleHistoryTicket(env: Env, ticket: string, now: number = Date.now()): Promise<Response> {
  if (!env.ADMIN_TOKEN) return messagePage(500, WORDS.failed, "إعداد الخدمة ناقص.");
  const r = await redeemTicket(env, ticket, now, WORDS, (model) => model === HISTORY_MODEL);
  if (r instanceof Response) return r;
  return new Response(null, { status: 302, headers: { Location: await historyLinkPath(env.ADMIN_TOKEN, now + LINK_TTL_MS), "Cache-Control": "no-store" } });
}

/** Step 2 — the worker's own link: its signature and its expiry, then the page. */
export async function handleHistoryPage(env: Env, expiry: number, signature: string, params: URLSearchParams, now: number = Date.now()): Promise<Response> {
  if (!env.ADMIN_TOKEN) return notFound();
  if (!sameText(await historySignature(env.ADMIN_TOKEN, expiry), signature)) return notFound();
  if (!(expiry > now)) return messagePage(410, "انتهت صلاحية الرابط", AGAIN);
  const today = riyadhDateKey(new Date(now));
  let data: Awaited<ReturnType<typeof readHistory>>;
  try {
    data = await readHistory(env, today);
  } catch (e) {
    console.error("[history] the lines could not be read", (e as Error)?.message);
    return messagePage(503, "تعذّر فتح الصفحة الآن", "Odoo لم يجب. حدّث الصفحة بعد لحظة.");
  }
  const html = renderHistoryPage(buildHistory(data.rows, data.products, today, parseQuery(params)), `${HISTORY_PREFIX}p/${expiry}/${signature}`, expiry);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

/** GET /history/… — the two steps above; anything else is not found. */
export async function handleHistory(env: Env, url: URL, now: number = Date.now()): Promise<Response> {
  const rest = url.pathname.slice(HISTORY_PREFIX.length);
  if (rest.startsWith("t/")) return handleHistoryTicket(env, rest.slice(2), now);
  const m = PAGE.exec(rest);
  if (!m) return notFound();
  return handleHistoryPage(env, Number(m[1]), m[2], url.searchParams, now);
}
