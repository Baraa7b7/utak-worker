// Today's prices: build, review, approve, publish — 2026-09-25 (STATUS § 35),
// the pricing engine v1 since 2026-09-26 (STATUS § 40 ج).
//
// One record per Riyadh day, x_price_day «أسعار اليوم», one line per active
// product and packaging (x_price_day_line), built and kept current by the
// worker (src/pricing-engine.ts): the lowest valid purchase price of the day
// from any source, the median of the day's market observations, the sale price
// = the market price, the unit profit = market − purchase − waste. A line with
// no purchase price, no market price, a market price below the suggested
// profitable price (§ 47 ب) or an outlier is an exception: Baraa gets one
// message per exception («اعتمد بالسعر المربح», «اعتمد بسعر السوق», «لا تنشر»,
// «عدّل»; one message with the count and the review link above
// EXCEPTIONS_MANY), from the end of Omar's reply window (04:00) until the
// publication time. Every other line is approved automatically.
//
//   • the publication time is § 35's deadline (ORDERING_HOURS_OPEN, 06:00
//     Riyadh; PRICES_DEADLINE="HH:MM" overrides it): the day is approved by the
//     worker and published with § 35's mechanism — a critical message to every
//     customer through the gateway, sale price and packaging only; Baraa gets
//     the same list and the counts, and one line with the number of exceptions
//     left without a decision (they are not published — never yesterday's
//     prices). No line approved at all → «missed», one alert, as in § 35;
//   • Baraa may still publish earlier from Odoo («نشر المعتمد الآن»), or decide
//     a line there («قرار براء», «السعر المعدّل»);
//   • the § 35 margin (sale = purchase × margin) is gone from pricing: the
//     product card's «هامش الربح %» is a display-only Odoo compute.
//
// § 46 أ — «📊 لوحة التسعير»: with every engine run and every decision the
// worker also writes each line's real profit (net purchase, waste, the carton
// share of the day's operating cost, net sale) and its 🟢 🟡 🔴 ⚪ status, and the
// header on the day (src/pricing-board.ts).
//
// § 47 — every purchase price is net of VAT as written (never ÷ 1.15), and
// each line carries «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح»: the
// engine's rule and the exception's fourth choice read them.
//
// § 48 — the suggested price = (full cost + «الربح الأدنى للكرتون») × 1.15
// rounded up to 0.5; the engine keeps every supplier row's fallback sale price
// (x_daily_price.x_sale_price) = the suggested price of its purchase price; a
// line without an approved price carries a preview at the suggested price; and
// a decision taken in Odoo («قرار براء») is applied by the tick within five
// minutes on a draft or a missed day, «🔄 إعادة الحساب» pressed or not — the
// day's state is never changed by it and nothing is sent.
//
// Nothing here writes list_price or standard_price.

import type { Env } from "./config";
import { ORDERING_HOURS_CLOSE, ORDERING_HOURS_OPEN, profitVatRate } from "./config";
import { call } from "./odoo";
import { buttonsContent, listContent, textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { cutoffLabel, sendOwnerAlert, sendOwnerMessage } from "./templates";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { fnv1a } from "./auto-send-guard";
import { arabicDate, maskPhone } from "./wa-params";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";
import {
  computePricing, fixedPrice, lineVerdict, readActiveItems, readDayOffers, saleRule, type Decision, type LineStatus, type LineVerdict,
} from "./pricing-engine";
import { loadPriceSources, MARKET_ASK_MINUTE, MARKET_REPLY_WINDOW_MIN } from "./price-sources";
import { readPricingSettings } from "./operating-cost";
import { BOARD_LINE_FIELDS, boardHeader, boardLine, boardShare, fallbackSale, readBoardInputs, type BoardStatus, type FloorInputs } from "./pricing-board";

export const PRICE_DAY_MODEL = "x_price_day";
export const PRICE_LINE_MODEL = "x_price_day_line";
export const PRICES_PURPOSE = "customer_prices";
export const OWNER_PRICES_PURPOSE = "owner_prices";
/** A WhatsApp text body may hold 4096 characters; parts stay well below. */
export const PRICE_TEXT_LIMIT = 3500;
/** The deadline alert is raised within this many minutes after the deadline, not later (a worker down at 06:00). */
export const DEADLINE_WINDOW_MIN = 60;
/** An approved record not published this long after its approval is published by the tick. */
export const PUBLISH_RETRY_AFTER_MS = 3 * 60_000;

// ---------------------------------------------------------------- the publication time
// § 40 ج — the § 35 margin rule (computeSalePrice, pickDefaultOffer, planLines,
// offersText) is gone: the engine prices (src/pricing-engine.ts).

function parseHHMM(s: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** The approval deadline (Riyadh minutes): the ordering-opening time, or PRICES_DEADLINE. */
export function pricesDeadlineMinutes(env: Env): { minutes: number; source: "PRICES_DEADLINE" | "ORDERING_HOURS_OPEN" } {
  const set = parseHHMM((env as { PRICES_DEADLINE?: string }).PRICES_DEADLINE);
  return set === null ? { minutes: ORDERING_HOURS_OPEN * 60, source: "ORDERING_HOURS_OPEN" } : { minutes: set, source: "PRICES_DEADLINE" };
}

function shortName(name: string): string {
  const n = String(name ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
  return n.length > 24 ? `${n.slice(0, 23)}…` : n;
}
function money(x: number): string {
  const n = Math.round(Number(x) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------- Odoo reads

export interface DayRecord {
  id: number;
  x_date: string;
  x_state: "draft" | "approved" | "published" | "missed";
  x_name?: string;
  x_approved_at?: string | false;
  x_published_at?: string | false;
}

export interface DayLine {
  id: number;
  x_sequence?: number;
  x_product_tmpl_id: [number, string] | false;
  x_packaging_id: [number, string] | false;
  x_supplier_id: [number, string] | false;
  x_daily_price_id: [number, string] | false;
  x_default_price_id: [number, string] | false;
  x_source_price: number;
  x_cost_price: number;
  x_is_outlier: boolean;
  x_outlier_ok: boolean;
  x_margin_pct: number;
  x_sale_price: number;
  x_excluded: boolean;
  x_blocked: boolean;
  x_offers: string | false;
  // § 40 ج — the engine and Baraa's decision
  x_market_price: number;
  x_market_count: number;
  x_unit_profit: number;
  x_status: LineStatus | false;
  x_reason: string | false;
  x_decision: Decision | false;
  x_manual_price: number;
  x_decided_at: string | false;
  /** § 48 د — the decision x_manual_price was fixed for by the worker (market / profit / edit); empty = none, or fixed before § 48. */
  x_manual_for?: string | false;
  // § 46 أ — «📊 لوحة التسعير» (src/pricing-board.ts)
  x_net_purchase?: number;
  x_waste_cost?: number;
  x_op_share?: number;
  x_full_cost?: number;
  // § 47 ب — «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح» (0 = none)
  x_break_even?: number;
  x_suggested_price?: number;
  x_board_sale?: number;
  x_net_sale?: number;
  x_real_profit?: number;
  x_board_status?: BoardStatus | false;
  // § 48 ج — the preview of a line without an approved price (0 = none)
  x_preview_sale?: number;
  x_preview_profit?: number;
}

const DAY_FIELDS = ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_approved_by", "x_published_at"];
const LINE_FIELDS = [
  "id", "x_sequence", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_daily_price_id", "x_default_price_id",
  "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_sale_price", "x_excluded", "x_blocked", "x_offers",
  "x_market_price", "x_market_count", "x_unit_profit", "x_status", "x_reason", "x_decision", "x_manual_price", "x_decided_at", "x_manual_for",
  ...BOARD_LINE_FIELDS,
];

async function readDay(env: Env, day: string): Promise<DayRecord | null> {
  const rows = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "search_read", {
    // § 41 — a day marked x_utak_simulation (the full-day simulation) is not the day's record
    domain: [["x_date", "=", day], ["x_utak_simulation", "!=", true]], fields: DAY_FIELDS, order: "id asc", limit: 1,
  });
  return rows[0] ?? null;
}

/** Today's record, created (draft) when missing. Odoo refuses a second record for a date (automation). */
async function ensureDay(env: Env, day: string, state: DayRecord["x_state"] = "draft"): Promise<DayRecord> {
  const cur = await readDay(env, day);
  if (cur) return cur;
  try {
    await call<number[]>(env, PRICE_DAY_MODEL, "create", {
      vals_list: [{ x_date: day, x_name: `أسعار اليوم ${day}`, x_state: state }],
    });
  } catch (e) {
    console.warn(`[prices] create ${day} refused — reading it again`, (e as Error)?.message);
  }
  const again = await readDay(env, day);
  if (!again) throw new Error(`[prices] no x_price_day for ${day}`);
  return again;
}

async function readLines(env: Env, dayId: number): Promise<DayLine[]> {
  return call<DayLine[]>(env, PRICE_LINE_MODEL, "search_read", {
    domain: [["x_day_id", "=", dayId]], fields: LINE_FIELDS, order: "x_sequence asc, id asc", limit: 500,
  });
}

// ---------------------------------------------------------------- refresh

export interface RefreshReport {
  day: string;
  action: "no_prices" | "unchanged" | "locked" | "refreshed" | "outside";
  dayId?: number;
  state?: string;
  created?: number;
  updated?: number;
  lines?: number;
  /** lines not published as things stand (exception or «لم يُنشر») */
  excluded?: number;
  counts?: Record<LineStatus, number>;
}

function fpKey(day: string): string {
  return `prices_fp:v1:${day}`;
}
const m2oId = (v: [number, string] | false | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const lineKey = (l: DayLine) => `${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`;
/** The supplier ask (02:00): the engine's first minute in the tick. */
export const ENGINE_FROM_MINUTE = 2 * 60;
/** Exceptions reach Baraa from the end of Omar's reply window (02:30 + 90 = 04:00), and at least 30 minutes before the publication. */
export function exceptionsFromMinutes(env: Env): number {
  return Math.min(MARKET_ASK_MINUTE + MARKET_REPLY_WINDOW_MIN, pricesDeadlineMinutes(env).minutes - 30);
}
/** Odoo's value against the one to write: many2one ids, 0 = empty, a float tolerance. */
function sameValue(cur: unknown, want: unknown): boolean {
  const n = (x: unknown) => (Array.isArray(x) ? x[0] : x === null || x === undefined || x === "" ? false : x);
  const a = n(cur), b = n(want);
  if ((a === false || a === 0) && (b === false || b === 0)) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.0001;
  return a === b;
}
function changed(l: DayLine, want: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) if (!sameValue((l as unknown as Record<string, unknown>)[k], v)) out[k] = v;
  return out;
}

/**
 * Build or update the day's record with the engine (src/pricing-engine.ts)
 * from the day's offers of the sources: one line per active product and
 * packaging, its status from the rule and Baraa's decision. A line of a
 * product that left the active catalog is «لم يُنشر». Approved and published
 * days are never touched. Skipped when nothing changed since the last run
 * (unless forced). No record before the exceptions time without an offer.
 */
export async function refreshPriceDay(env: Env, opts: { day?: string; force?: boolean; now?: number } = {}): Promise<RefreshReport> {
  const now = opts.now ?? Date.now();
  const today = riyadhDateKey(new Date(now));
  const day = opts.day ?? today;
  const found = await readDay(env, day);
  if (found && (found.x_state === "approved" || found.x_state === "published")) {
    return { day, action: "locked", dayId: found.id, state: found.x_state };
  }
  const sources = await loadPriceSources(env);
  const offers = await readDayOffers(env, day, sources);
  const exceptionsDue = day === today && riyadhMinutes(new Date(now)) >= exceptionsFromMinutes(env);
  if (!found && !offers.length && !exceptionsDue && !opts.force) return { day, action: "no_prices" };
  const settings = await readPricingSettings(env, day);
  if (!settings) throw new Error(`[prices] no active x_pricing_config on ${day}`);
  const items = await readActiveItems(env, offers);
  // § 41 أ — from the cutoff the sale price is VAT-inclusive; § 47 أ — the purchase price is net, whoever the source
  const vat = { ratePct: profitVatRate(day) };
  // § 46 أ — the day's cost over the cartons: the board, and (§ 47 ب) the suggested profitable price of the rule
  const inputs = await readBoardInputs(env, day, now, !!opts.force);
  const share = boardShare(inputs.cost, settings.expectedCartons, inputs.actual, inputs.costReason);
  const floor: FloorInputs = { wastePct: settings.wastePct, opShare: share.share, minProfit: settings.minProfit, vatRatePct: vat.ratePct };
  const plan = computePricing(items, offers, settings.wastePct, vat, { opShare: share.share, minProfit: settings.minProfit });
  const rec = found ?? (await ensureDay(env, day));
  const lines = await readLines(env, rec.id);
  // the inputs' fingerprint (the stored fallback of a supplier row is one of them: a value typed over it is put back)
  const fingerprint = () => fnv1a(JSON.stringify([
    rec.id, rec.x_state, settings.wastePct, settings.minProfit, vat.ratePct, [...sources.partnerIds].sort((a, b) => a - b),
    [share.cost, share.cartons, share.basis, share.expected],
    offers.map((o) => [o.model, o.rowId, o.kind, o.price, o.outlier, o.partnerId, o.saleStored ?? 0]),
    items.map((i) => [i.productId, i.packagingId]),
    lines.filter((l) => l.x_decision || Number(l.x_manual_price) > 0).map((l) => [lineKey(l), l.x_decision || "", Number(l.x_manual_price) || 0, l.x_manual_for || ""]),
  ]));
  if (!opts.force) {
    try {
      if ((await env.MSG_DEDUP.get(fpKey(day))) === fingerprint()) return { day, action: "unchanged", dayId: rec.id, state: rec.x_state };
    } catch { /* recompute */ }
  }
  // § 48 ب — the fallback sale price of every supplier row of the day = the suggested price of its purchase price
  await syncFallbackSale(env, day, offers, floor);
  // …and the fingerprint kept is the one of the rows as they are now (the next tick is «unchanged»)
  const fp = fingerprint();
  const byKey = new Map(lines.map((l) => [lineKey(l), l]));
  const creates: Array<Record<string, unknown>> = [];
  const counts: Record<LineStatus, number> = { auto: 0, exception: 0, manual: 0, unpublished: 0 };
  let updated = 0;
  let seq = lines.reduce((m, l) => Math.max(m, Number(l.x_sequence) || 0), 0);
  const board: BoardStatus[] = [];
  for (const p of plan) {
    const l = byKey.get(p.key);
    const decision = (l?.x_decision || null) as Decision | null;
    // § 48 د — the price fixed for THIS decision (a decision changed in Odoo does not inherit another's)
    const fixed = l ? fixedPrice(l) : 0;
    const v = lineVerdict(p, decision, fixed);
    counts[v.status]++;
    const src = p.purchaseOffer;
    // § 46 أ — the board's sale is the approved price, else the market price (the rule: sale = market);
    // § 48 ج — without an approved price the line also carries the preview at the suggested price
    const b = boardLine({
      purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.market, approved: v.sale > 0, wastePct: settings.wastePct,
      vatRatePct: vat.ratePct, opShare: share.share, minProfit: settings.minProfit,
    });
    board.push(b.x_board_status);
    const want: Record<string, unknown> = {
      ...b,
      x_supplier_id: src?.partnerId || false,
      x_daily_price_id: src?.model === "dp" ? src.rowId : false,
      x_default_price_id: src?.model === "dp" ? src.rowId : false,
      x_source_price: p.purchase ?? 0,
      x_cost_price: p.purchase ?? 0,
      x_is_outlier: p.outlier.purchase || p.outlier.market,
      x_outlier_ok: false,
      x_margin_pct: p.displayMargin ?? 0,
      x_market_price: p.market ?? 0,
      x_market_count: p.marketCount,
      x_unit_profit: p.unitProfit ?? 0,
      x_offers: p.offersText || false,
      x_status: v.status,
      x_reason: v.reason || false,
      x_sale_price: v.sale,
      x_excluded: v.excluded,
      x_blocked: false,
    };
    if (!l) {
      creates.push({
        x_day_id: rec.id, x_name: `${shortName(p.productName)} — ${p.packagingName}`, x_sequence: ++seq,
        x_product_tmpl_id: p.productId, x_packaging_id: p.packagingId, ...want,
      });
      continue;
    }
    if (decision && !l.x_decided_at) want.x_decided_at = nowOdoo(now);
    Object.assign(want, keptPrice(l, decision, v, fixed));
    const vals = changed(l, want);
    if (Object.keys(vals).length) {
      await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
      updated++;
    }
  }
  const planned = new Set(plan.map((p) => p.key));
  for (const l of lines) {
    if (planned.has(lineKey(l))) continue;
    // the line leaves with no sale price: its board is the one of an unapproved line (the market price, the preview)
    const b = storedBoardLine({ ...l, x_sale_price: 0 }, settings.wastePct, vat.ratePct, share.share, settings.minProfit);
    board.push(b.x_board_status);
    const vals = changed(l, { x_status: "unpublished", x_reason: "ليس في الكتالوج النشط اليوم", x_sale_price: 0, x_excluded: true, ...b });
    // § 48 د — a decision taken in Odoo on such a line is seen once (the tick does not ask for the day again)
    if (l.x_decision && !l.x_decided_at) vals.x_decided_at = nowOdoo(now);
    if (Object.keys(vals).length) {
      await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
      updated++;
    }
    counts.unpublished++;
  }
  if (creates.length) await call<number[]>(env, PRICE_LINE_MODEL, "create", { vals_list: creates });
  // § 46 أ — the board's header on the day (never blocks the engine)
  try {
    await call(env, PRICE_DAY_MODEL, "write", { ids: [rec.id], vals: boardHeader(share, board, now) });
  } catch (e) {
    console.warn(`[prices] ${day}: the board header was not written`, (e as Error)?.message);
  }
  try { await env.MSG_DEDUP.put(fpKey(day), fp, { expirationTtl: 3 * 24 * 3600 }); } catch { /* next tick recomputes */ }
  console.log(`[prices] ${day} refreshed: +${creates.length} ~${updated} (${plan.length} lines: ${JSON.stringify(counts)})`);
  return {
    day, action: "refreshed", dayId: rec.id, state: rec.x_state, created: creates.length, updated, lines: plan.length,
    excluded: counts.exception + counts.unpublished, counts,
  };
}

// ---------------------------------------------------------------- the board (§ 46 أ)

/** A stored line on the board: its purchase (net as written), its approved sale price else its market price (then with the preview, § 48 ج). */
function storedBoardLine(l: DayLine, wastePct: number, vatRatePct: number | null, opShare: number | null, minProfit: number) {
  return boardLine({
    purchase: Number(l.x_cost_price) || 0,
    sale: Number(l.x_sale_price) > 0 ? Number(l.x_sale_price) : Number(l.x_market_price) || 0,
    approved: Number(l.x_sale_price) > 0,
    wastePct, vatRatePct, opShare, minProfit,
  });
}

/**
 * § 47 ب / § 48 د — what the engine keeps of the price of a decision.
 *   • «اعتمد بالسعر المربح» without a price fixed for it (chosen in Odoo): the
 *     suggested price of this run becomes his price (as the WhatsApp tap keeps
 *     the one he saw), so a later cost change does not move it;
 *   • «اعتمد بسعر السوق» chosen in Odoo follows the day's market price, as
 *     before; a price fixed for ANOTHER decision is dropped, never inherited;
 *   • the decision removed, or «لا تنشر»: a price the worker fixed for an
 *     earlier decision goes with it (a number Baraa typed himself stays).
 */
function keptPrice(l: DayLine, decision: Decision | null, v: LineVerdict, fixed: number): Record<string, unknown> {
  const stale = !(fixed > 0) && Number(l.x_manual_price) > 0;
  if (decision === "profit" && v.status === "manual") return { ...(fixed > 0 ? {} : { x_manual_price: v.sale }), x_manual_for: "profit" };
  if (decision === "market" && v.status === "manual") return stale ? { x_manual_price: 0, x_manual_for: false } : fixed > 0 ? { x_manual_for: "market" } : {};
  if (decision === "edit" && v.status === "manual") return { x_manual_for: "edit" };
  if ((!decision || decision === "skip") && l.x_manual_for) return { x_manual_price: 0, x_manual_for: false };
  return {};
}

/**
 * § 48 ب — every supplier row of the day (x_daily_price of a source) carries,
 * as its fallback sale price, the suggested profitable price of its own
 * purchase price — what a quotation takes when the day is not published. 0
 * when the suggested price cannot be made (the carton share «تعذّر»): no
 * fallback, and the zero-price guard stops the order. Only a row whose stored
 * value differs is written. Never blocks the engine.
 */
async function syncFallbackSale(env: Env, day: string, offers: Array<{ model: string; rowId: number; kind: string; price: number; saleStored?: number }>, floor: FloorInputs): Promise<number> {
  let written = 0;
  for (const o of offers) {
    if (o.model !== "dp" || o.kind !== "purchase") continue;
    const want = fallbackSale(o.price, floor);
    if (Math.abs((o.saleStored ?? 0) - want) < 0.0001) continue;
    try {
      await call(env, "x_daily_price", "write", { ids: [o.rowId], vals: { x_sale_price: want } });
      o.saleStored = want;
      written++;
    } catch (e) {
      console.warn(`[prices] ${day}: the fallback sale price of x_daily_price ${o.rowId} was not written`, (e as Error)?.message);
    }
  }
  return written;
}

export interface BoardReport { day: string; dayId: number; lines: number; updated: number; counts: Record<BoardStatus, number> }

/**
 * The board of a day from its stored lines, whatever its state (a decision
 * changed a line's sale price; a day approved or published before the board
 * existed): the lines whose board values differ are written, then the header.
 * The lock (base.automation #23) does not watch the board's fields. `dry`:
 * nothing is written, the values are returned.
 */
export async function rewriteBoard(env: Env, dayId: number, opts: { now?: number; force?: boolean; dry?: boolean } = {}): Promise<BoardReport & { values?: Array<Record<string, unknown>>; header?: Record<string, unknown> }> {
  const now = opts.now ?? Date.now();
  const [rec] = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: [dayId], fields: DAY_FIELDS });
  if (!rec) throw new Error(`[board] no x_price_day ${dayId}`);
  const day = rec.x_date;
  const settings = await readPricingSettings(env, day);
  if (!settings) throw new Error(`[board] no active x_pricing_config on ${day}`);
  const vatRatePct = profitVatRate(day);
  const inputs = await readBoardInputs(env, day, now, !!opts.force);
  const share = boardShare(inputs.cost, settings.expectedCartons, inputs.actual, inputs.costReason);
  const lines = await readLines(env, dayId);
  const counts: Record<BoardStatus, number> = { green: 0, yellow: 0, red: 0, none: 0 };
  const values: Array<Record<string, unknown>> = [];
  let updated = 0;
  for (const l of lines) {
    const b = storedBoardLine(l, settings.wastePct, vatRatePct, share.share, settings.minProfit);
    counts[b.x_board_status]++;
    values.push({ id: l.id, name: `${lineName(l)}${Array.isArray(l.x_packaging_id) ? ` — ${l.x_packaging_id[1]}` : ""}`, purchase: Number(l.x_cost_price) || 0, ...b });
    const vals = changed(l, { ...b });
    if (!Object.keys(vals).length) continue;
    updated++;
    if (!opts.dry) await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
  }
  const header = boardHeader(share, values.map((v) => v.x_board_status as BoardStatus), now);
  if (!opts.dry) await call(env, PRICE_DAY_MODEL, "write", { ids: [dayId], vals: header });
  return { day, dayId, lines: lines.length, updated, counts, ...(opts.dry ? { values, header } : {}) };
}

/** After a decision on a line: its day's board again. Never throws (the decision is already written). */
async function boardAfterDecision(env: Env, dayId: number, now: number): Promise<void> {
  try {
    await rewriteBoard(env, dayId, { now });
  } catch (e) {
    console.warn(`[prices] board after a decision on day ${dayId} failed`, (e as Error)?.message);
  }
}

// ---------------------------------------------------------------- the message

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export function weekdayAr(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

export interface PublishedLine {
  productName: string;
  packagingName: string;
  salePrice: number;
}

/**
 * The customers' message: sale price and packaging only — no purchase price,
 * no supplier, no margin — cut on line boundaries into parts of at most
 * PRICE_TEXT_LIMIT characters, «(1/2)» when there is more than one.
 */
export function buildPriceMessages(day: string, lines: PublishedLine[], limit: number = PRICE_TEXT_LIMIT, heading?: string): string[] {
  const title = `🌿 أسعار يو تاك اليوم — ${weekdayAr(day)} ${arabicDate(day)}`;
  const footer = `الأسعار لطلبات اليوم. اطلب من هنا قبل الساعة ${cutoffLabel(ORDERING_HOURS_CLOSE)} 🌿`;
  const items = lines.map((l) => `• ${shortName(l.productName)} (${l.packagingName}): ${money(l.salePrice)} ر.س`);
  const head = [heading, title].filter(Boolean).join("\n\n");
  const room = Math.max(200, limit - head.length - footer.length - 16);
  const chunks: string[][] = [[]];
  let size = 0;
  for (const it of items) {
    if (size + it.length + 1 > room && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }
    chunks[chunks.length - 1].push(it);
    size += it.length + 1;
  }
  const n = chunks.length;
  return chunks.map((c, i) => {
    const top = n > 1 ? `${head} (${i + 1}/${n})` : head;
    const parts = [top, "", ...c];
    if (i === n - 1) parts.push("", footer);
    return parts.join("\n");
  });
}

// ---------------------------------------------------------------- recipients

export interface PriceRecipient {
  id: number;
  name: string;
  phone: string;
}

/**
 * Every customer who may receive automated messages: customer_rank > 0, a
 * WhatsApp number, not opted out (§ 23 — nothing automated), not held by
 * screening (§ 30: waiting for review, «شخصي», team, supplier), not a team
 * member (§ 31), not Baraa. One per number. The gateway still applies the
 * allowlist on sim.
 */
export async function priceRecipients(env: Env): Promise<PriceRecipient[]> {
  const partners = await call<Array<{
    id: number; name: string; x_whatsapp_number: string | false; x_wa_marketing_optout?: boolean;
    x_contact_class?: string | false; x_review_pending?: boolean; x_ai_intent?: string | false;
  }>>(env, "res.partner", "search_read", {
    domain: [["customer_rank", ">", 0], ["x_whatsapp_number", "!=", false]],
    fields: ["id", "name", "x_whatsapp_number", "x_wa_marketing_optout", "x_contact_class", "x_review_pending", "x_ai_intent"],
    order: "id asc",
    limit: 5000,
  });
  const { isCustomerAutomationHeld } = await import("./screening");
  const { loadRoster } = await import("./team-roster");
  const team = new Set((await loadRoster(env).catch(() => ({ members: [] as Array<{ whatsapp?: string }> }))).members
    .map((m) => waDigits(String(m.whatsapp ?? ""))).filter(Boolean));
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  const seen = new Set<string>();
  const out: PriceRecipient[] = [];
  for (const p of partners) {
    const d = waDigits(String(p.x_whatsapp_number || ""));
    if (!d || seen.has(d) || d === owner || team.has(d)) continue;
    if (p.x_wa_marketing_optout === true || isCustomerAutomationHeld(p)) continue;
    seen.add(d);
    out.push({ id: p.id, name: p.name, phone: `+${d}` });
  }
  return out;
}

// ---------------------------------------------------------------- publish

export interface PublishReport {
  action: "published" | "already" | "not_approved" | "in_progress" | "blocked" | "mismatch" | "not_found" | "unapproved_meanwhile" | "nothing";
  day?: string;
  dayId?: number;
  items?: number;
  parts?: number;
  excluded?: string[];
  recipients?: number;
  counts?: Record<string, number>;
  detail?: string;
}

function nowOdoo(ms: number = Date.now()): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
function lineName(l: DayLine): string {
  return shortName(Array.isArray(l.x_product_tmpl_id) ? l.x_product_tmpl_id[1] : "?");
}
/** § 40 ج — approved automatically or by Baraa, not left out, with a price. */
function isPublishable(l: DayLine): boolean {
  return (l.x_status === "auto" || l.x_status === "manual") && !l.x_excluded && Number(l.x_sale_price) > 0;
}
/** The worker approves at the deadline without a user; Odoo's button writes x_approved_by. */
function approvedByHand(day: DayRecord & { x_approved_by?: [number, string] | false }): boolean {
  return Array.isArray(day.x_approved_by);
}

/**
 * Publish an approved day, once (KV claim + the record's state). Never
 * publishes a draft, missed or published record. The customers' sends go
 * through the gateway without the cron's auto-send key (each part is its own
 * message; the claim here is the idempotency).
 */
export async function publishPriceDay(env: Env, dayId: number, opts: { ctx?: ExecutionContext; now?: number } = {}): Promise<PublishReport> {
  const now = opts.now ?? Date.now();
  const [day] = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: [dayId], fields: DAY_FIELDS });
  if (!day) return { action: "not_found", dayId };
  if (day.x_state === "published") return { action: "already", day: day.x_date, dayId };
  if (day.x_state !== "approved") return { action: "not_approved", day: day.x_date, dayId, detail: day.x_state };
  const claim = await claimButton(env, `prices_pub:${dayId}`, 7 * 24 * 3600);
  if (!claim.claimed) return { action: "in_progress", day: day.x_date, dayId, detail: claim.state };
  const penv = { ...env, AUTO_SEND_JOB: undefined } as Env;
  try {
    const lines = await readLines(penv, dayId);
    const blocked = lines.filter((l) => l.x_blocked);
    if (blocked.length) {
      await releaseButton(penv, claim);
      await sendOwnerAlert(penv, `⚠️ أسعار ${day.x_date} لم تُنشر: أسعار شاذة لم تُعالج (${blocked.map(lineName).join("، ")}).`);
      return { action: "blocked", day: day.x_date, dayId, detail: blocked.map(lineName).join("، ") };
    }
    // § 40 ج — a line goes out only approved (automatically or by Baraa), at
    // the sale price the rule gives it: the market price, or his.
    const publishable = lines.filter(isPublishable);
    const mismatch = publishable.filter((l) => Math.abs(Number(l.x_sale_price) - saleRule(l)) > 0.005);
    if (mismatch.length) {
      await releaseButton(penv, claim);
      await sendOwnerAlert(penv, `⚠️ أسعار ${day.x_date} لم تُنشر: سعر البيع في Odoo لا يطابق القاعدة (${mismatch.map((l) => `${lineName(l)} ${l.x_sale_price}≠${saleRule(l)}`).join("، ")}).`);
      return { action: "mismatch", day: day.x_date, dayId };
    }
    if (!publishable.length) {
      await releaseButton(penv, claim);
      await sendOwnerAlert(penv, `⚠️ أسعار ${day.x_date} لم تُنشر: لا صنف معتمد (تلقائياً أو منك).`);
      return { action: "nothing", day: day.x_date, dayId };
    }
    // an exception still without Baraa's decision is not published (never an old price)
    const undecided = lines.filter((l) => l.x_status === "exception");
    for (const l of undecided) {
      await call(penv, PRICE_LINE_MODEL, "write", {
        ids: [l.id], vals: { x_status: "unpublished", x_reason: `استثناء بلا قرار عند النشر: ${l.x_reason || ""}`.trim(), x_sale_price: 0, x_excluded: true },
      });
    }
    const excluded = lines.filter((l) => !publishable.includes(l)).map(lineName);
    const published: PublishedLine[] = publishable.map((l) => ({
      productName: Array.isArray(l.x_product_tmpl_id) ? l.x_product_tmpl_id[1] : "?",
      packagingName: Array.isArray(l.x_packaging_id) ? l.x_packaging_id[1] : "",
      salePrice: Number(l.x_sale_price),
    }));
    const parts = buildPriceMessages(day.x_date, published);
    const recipients = await priceRecipients(penv);
    const counts: Record<string, number> = { session: 0, held: 0, refused: 0, skipped: 0, rejected: 0, template: 0 };
    for (const r of recipients) {
      let first: string | null = null;
      for (const part of parts) {
        const resp = await sendViaGateway(penv, { purpose: PRICES_PURPOSE, to: r.phone, content: textContent(part), ctx: opts.ctx });
        const d = gatewayDecision(resp);
        first ??= d?.action ?? "refused";
        if (d?.action === "refused") break; // the allowlist / guard refuses every part alike
      }
      counts[first ?? "refused"] = (counts[first ?? "refused"] ?? 0) + 1;
      console.log(`[prices] ${day.x_date} → ${maskPhone(r.phone)} ${first}`);
    }
    const summary = [
      `📢 نُشرت أسعار ${weekdayAr(day.x_date)} ${arabicDate(day.x_date)}. الأصناف: ${published.length}، والعملاء: ${recipients.length}.`,
      `نصاً ${counts.session} · محفوظة حتى رسالتهم ${counts.held} · محجوبة ${counts.refused}${counts.skipped ? ` · لم تُرسل ${counts.skipped}` : ""}${counts.rejected ? ` · رفضها Meta ${counts.rejected}` : ""}.`,
      excluded.length ? `لم يُنشر: ${excluded.join("، ")}.` : "",
      "وهذه نسخة ما وصلهم:",
    ].filter(Boolean).join("\n");
    const copy = buildPriceMessages(day.x_date, published, PRICE_TEXT_LIMIT, summary);
    for (const part of copy) await sendOwnerMessage(penv, part, OWNER_PRICES_PURPOSE);
    // § 40 ج — one line: how many exceptions went unpublished for want of a decision
    if (undecided.length) {
      await sendOwnerAlert(penv, `⏰ لم يُنشر اليوم ${undecided.length} ${undecided.length === 1 ? "صنف" : "أصناف"}: استثناء بلا قرار حتى النشر. التفاصيل في «💰 أسعار اليوم».`);
    }
    const report = [
      `نُشر ${nowOdoo(now)} UTC${day.x_approved_at && !approvedByHand(day) ? " (اعتماد تلقائي)" : ""}. الأصناف: ${published.length}، والرسائل لكل عميل: ${parts.length}، والعملاء: ${recipients.length}.`,
      `نصاً ${counts.session}، ومحفوظة ${counts.held}، ومحجوبة (القائمة/الحارس) ${counts.refused}، ولم تُرسل ${counts.skipped}، ورفضها Meta ${counts.rejected}.`,
      excluded.length ? `لم يُنشر: ${excluded.join("، ")}${undecided.length ? ` (بلا قرار: ${undecided.length})` : ""}.` : "لا مستبعد.",
    ].join("\n");
    const [fresh] = await call<DayRecord[]>(penv, PRICE_DAY_MODEL, "read", { ids: [dayId], fields: ["id", "x_state"] });
    if (fresh?.x_state !== "approved") {
      await call(penv, PRICE_DAY_MODEL, "write", { ids: [dayId], vals: { x_publish_report: `${report}\n⚠️ أُلغي الاعتماد أثناء النشر.` } });
      await finishButton(penv, claim);
      return { action: "unapproved_meanwhile", day: day.x_date, dayId, counts };
    }
    await call(penv, PRICE_DAY_MODEL, "write", { ids: [dayId], vals: { x_state: "published", x_published_at: nowOdoo(now), x_publish_report: report } });
    await finishButton(penv, claim);
    console.log(`[prices] ${day.x_date} published`, JSON.stringify(counts));
    return { action: "published", day: day.x_date, dayId, items: published.length, parts: parts.length, excluded, recipients: recipients.length, counts };
  } catch (e) {
    // Nothing irreversible is known to have happened only if nothing was sent;
    // keep the claim (no second publication) and tell Baraa.
    console.error("[prices] publish failed", (e as Error)?.message);
    await sendOwnerAlert(penv, `⚠️ تعذّر إكمال نشر أسعار ${day.x_date}: ${(e as Error)?.message ?? e}. راجع السجل قبل إعادة المحاولة.`).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- the deadline and the tick

export interface DeadlineReport {
  action: "before" | "after_window" | "claimed_before" | "missed" | "approved" | "published" | "already_missed" | "auto_published";
  day: string;
  dayId?: number;
  publish?: PublishReport;
}

/**
 * At the publication time (the § 35 deadline, within DEADLINE_WINDOW_MIN):
 * the engine's last word, then every line approved automatically or by Baraa
 * is published (§ 35's mechanism, the worker's approval); an exception left
 * without a decision is not. No line approved at all → «missed» and one alert.
 * Never re-sends another day's prices.
 */
export async function checkPricesDeadline(env: Env, now: number = Date.now()): Promise<DeadlineReport> {
  const day = riyadhDateKey(new Date(now));
  const dl = pricesDeadlineMinutes(env).minutes;
  const m = riyadhMinutes(new Date(now));
  if (m < dl) return { action: "before", day };
  if (m >= dl + DEADLINE_WINDOW_MIN) return { action: "after_window", day };
  const claim = await claimButton(env, `prices_deadline:${day}`, 26 * 3600);
  if (!claim.claimed) return { action: "claimed_before", day };
  const rec = await readDay(env, day);
  if (rec?.x_state === "published") return { action: "published", day, dayId: rec.id };
  if (rec?.x_state === "approved") return { action: "approved", day, dayId: rec.id };
  if (rec?.x_state === "missed") return { action: "already_missed", day, dayId: rec.id };
  try {
    await refreshPriceDay(env, { day, now, force: true });
  } catch (e) {
    console.warn(`[prices] ${day} last refresh before the publication failed`, (e as Error)?.message);
  }
  const target = (await readDay(env, day)) ?? (await ensureDay(env, day, "missed"));
  const lines = await readLines(env, target.id).catch(() => [] as DayLine[]);
  if (target.x_state === "draft" && lines.some(isPublishable)) {
    await call(env, PRICE_DAY_MODEL, "write", { ids: [target.id], vals: { x_state: "approved", x_approved_at: nowOdoo(now), x_approved_by: false } });
    await finishButton(env, claim);
    const publish = await publishPriceDay(env, target.id, { now });
    return { action: "auto_published", day, dayId: target.id, publish };
  }
  if (target.x_state !== "missed") await call(env, PRICE_DAY_MODEL, "write", { ids: [target.id], vals: { x_state: "missed" } });
  const hh = hhmm(dl);
  const exc = lines.filter((l) => l.x_status === "exception").length;
  const skip = lines.filter((l) => l.x_status === "unpublished").length;
  const anyPrice = lines.some((l) => Number(l.x_cost_price) > 0 || Number(l.x_market_price) > 0);
  await sendOwnerAlert(env, [
    `⏰ أسعار اليوم (${arabicDate(day)}) لم تُنشر حتى ${hh}: لا صنف معتمد (تلقائياً أو منك).`,
    anyPrice ? `الأصناف: ${lines.length} (استثناء بلا قرار: ${exc}، ولم يُنشر: ${skip}).` : "لم يصل سعر من المصادر اليوم.",
    "لا تُعاد أسعار أمس. قرارك ثم «نشر المعتمد الآن» في «💰 أسعار اليوم» ينشر عادي.",
  ].join("\n"));
  await finishButton(env, claim);
  return { action: "missed", day, dayId: target.id };
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- the exceptions to Baraa (§ 40 ج)

/** Above this many exceptions: one message with the count and the review screen's link. */
export const EXCEPTIONS_MANY = 8;
export const EXCEPTION_PURPOSE = "owner_price_exception";
/** «عدّل»: the price must come within this many minutes. */
export const EDIT_REPLY_MIN = 30;
const EXC_TTL = 26 * 3600;
const excLock = (day: string, l: DayLine) => `pexc:${day}:${lineKey(l)}`;
const editKey = (env: Env) => `pexc_edit:v1:${waDigits(String(env.OWNER_WHATSAPP ?? ""))}`;
const DECISION_LABEL: Record<Decision, string> = { market: "اعتمد بسعر السوق", skip: "لا تنشر", edit: "سعر معدّل", profit: "اعتمد بالسعر المربح" };
/** § 47 ب — the fourth choice. Meta: a reply button's title holds 20 characters. */
export const PROFIT_BUTTON_TITLE = "اعتمد بالسعر المربح";
/** WhatsApp allows three reply buttons: four choices go out as a list under this button. */
export const DECISION_LIST_BUTTON = "القرار";

/** The review screen of a day (the history action's form, else the model's). */
export async function reviewUrl(env: Env, dayId: number): Promise<string> {
  const base = String(env.ODOO_URL || "").replace(/\/+$/, "");
  let act = 0;
  try {
    const hit = await env.MSG_DEDUP.get("prices:review_action:v1");
    if (hit) act = Number(hit) || 0;
    else {
      const [a] = await call<Array<{ id: number }>>(env, "ir.actions.act_window", "search_read", {
        domain: [["name", "=", "UTAK — سجل أسعار الأيام"]], fields: ["id"], limit: 1,
      });
      act = a?.id ?? 0;
      if (act) await env.MSG_DEDUP.put("prices:review_action:v1", String(act), { expirationTtl: 24 * 3600 });
    }
  } catch { /* the model's own link */ }
  return act ? `${base}/odoo/action-${act}/${dayId}` : `${base}/odoo/x_price_day/${dayId}`;
}

export function exceptionText(day: string, l: DayLine, deadline: string): string {
  const pk = Array.isArray(l.x_packaging_id) ? l.x_packaging_id[1] : "";
  const cost = Number(l.x_cost_price) > 0 ? money(l.x_cost_price) : "—";
  const market = Number(l.x_market_price) > 0 ? `${money(l.x_market_price)}${Number(l.x_market_count) > 1 ? ` (${l.x_market_count} مشاهدات)` : ""}` : "—";
  const profit = Number(l.x_cost_price) > 0 && Number(l.x_market_price) > 0 ? ` · ربح الوحدة: ${money(l.x_unit_profit)}` : "";
  // § 47 ب — the two numbers of the decision: the market price above, the suggested profitable price here
  const suggested = Number(l.x_suggested_price) > 0
    ? `السعر المربح المقترح: ${money(Number(l.x_suggested_price))}${Number(l.x_break_even) > 0 ? ` · أقل سعر بيع بدون خسارة: ${money(Number(l.x_break_even))}` : ""}`
    : "";
  return [
    `⚠️ استثناء في أسعار اليوم (${arabicDate(day)})`,
    `${lineName(l)}${pk ? ` (${pk})` : ""}`,
    `الشراء (بدون ضريبة): ${cost} · السوق: ${market}${profit}`,
    suggested,
    `السبب: ${l.x_reason || "—"}`,
    `قرارك قبل ${deadline}، وإلا لا يُنشر اليوم.`,
  ].filter(Boolean).join("\n");
}

/**
 * § 47 ب — «اعتمد بالسعر المربح» is offered when the line has a suggested price
 * and the market price does not reach it (a market price below it, or none).
 */
export function offersProfitChoice(l: DayLine): boolean {
  const suggested = Number(l.x_suggested_price) || 0, market = Number(l.x_market_price) || 0;
  return suggested > 0 && (!(market > 0) || market < suggested - 0.0001);
}

/** The choices of an exception, in order: the profitable price, the market price, «لا تنشر», «عدّل». */
export function exceptionChoices(l: DayLine): Array<{ id: string; title: string; description?: string }> {
  return [
    ...(offersProfitChoice(l) ? [{ id: `pexc_p_${l.id}`, title: PROFIT_BUTTON_TITLE, description: `${money(Number(l.x_suggested_price))} ر.س` }] : []),
    ...(Number(l.x_market_price) > 0 ? [{ id: `pexc_m_${l.id}`, title: "اعتمد بسعر السوق", description: `${money(Number(l.x_market_price))} ر.س` }] : []),
    { id: `pexc_s_${l.id}`, title: "لا تنشر" },
    { id: `pexc_e_${l.id}`, title: "عدّل" },
  ];
}

/**
 * From exceptionsFromMinutes until the publication time, on a draft day: one
 * message per new exception (a KV guard per product, packaging and day), its
 * choices (exceptionChoices): «اعتمد بالسعر المربح» (§ 47 ب: the market price
 * below the suggested one, or none), «اعتمد بسعر السوق» (only with a market
 * price), «لا تنشر», «عدّل» — three as reply buttons, four as a list.
 * More than EXCEPTIONS_MANY exceptions: one message with the count and the
 * review screen's link instead (once a day).
 */
export async function notifyPriceExceptions(env: Env, now: number = Date.now()): Promise<{ action: string; sent?: number; count?: number; review?: string }> {
  const out = await sendPriceExceptions(env, now);
  // § 45 ب — his window closed and exceptions held: utak_owner_price_review_v1, once a day (src/owner-window.ts)
  if (out.count) {
    const { notifyPriceReview } = await import("./owner-window");
    const review = await notifyPriceReview(env, riyadhDateKey(new Date(now)), out.count, now).catch((e) => {
      console.warn("[prices] price review template failed", (e as Error)?.message);
      return "error";
    });
    if (review) return { ...out, review };
  }
  return out;
}

async function sendPriceExceptions(env: Env, now: number): Promise<{ action: string; sent?: number; count?: number }> {
  const day = riyadhDateKey(new Date(now));
  const m = riyadhMinutes(new Date(now));
  const dl = pricesDeadlineMinutes(env).minutes;
  if (m < exceptionsFromMinutes(env) || m >= dl) return { action: "outside" };
  if (!env.OWNER_WHATSAPP) return { action: "no_owner" };
  const rec = await readDay(env, day);
  if (!rec || rec.x_state !== "draft") return { action: "no_draft" };
  const exc = (await readLines(env, rec.id)).filter((l) => l.x_status === "exception" && !l.x_decision);
  if (!exc.length) return { action: "none" };
  const fresh: DayLine[] = [];
  for (const l of exc) if ((await env.MSG_DEDUP.get(`btnlock:v1:${excLock(day, l)}`)) === null) fresh.push(l);
  if (!fresh.length) return { action: "notified_before", count: exc.length };
  const expiresAt = riyadhDayMinuteMs(day, dl);
  const deadline = hhmm(dl);
  if (exc.length > EXCEPTIONS_MANY) {
    for (const l of fresh) await claimButton(env, excLock(day, l), EXC_TTL);
    const c = await claimButton(env, `pexc_many:${day}`, EXC_TTL);
    if (!c.claimed) return { action: "many_before", count: exc.length };
    await sendViaGateway(env, {
      purpose: EXCEPTION_PURPOSE, to: env.OWNER_WHATSAPP, expiresAt,
      content: textContent([
        `⚠️ استثناءات أسعار اليوم (${arabicDate(day)}): ${exc.length} صنفاً تحتاج قرارك قبل ${deadline}، وإلا لا تُنشر اليوم.`,
        `راجعها في شاشة المراجعة: ${await reviewUrl(env, rec.id)}`,
      ].join("\n")),
    });
    await finishButton(env, c, EXC_TTL);
    return { action: "many", sent: 1, count: exc.length };
  }
  let sent = 0;
  for (const l of fresh) {
    const c = await claimButton(env, excLock(day, l), EXC_TTL);
    if (!c.claimed) continue;
    const choices = exceptionChoices(l);
    const text = exceptionText(day, l, deadline);
    // Meta: at most three reply buttons — four choices go out as one list message
    const content = choices.length <= 3 ? buttonsContent(text, choices.map(({ id, title }) => ({ id, title }))) : listContent(text, DECISION_LIST_BUTTON, choices);
    await sendViaGateway(env, { purpose: EXCEPTION_PURPOSE, to: env.OWNER_WHATSAPP, expiresAt, content });
    await finishButton(env, c, EXC_TTL);
    sent++;
  }
  return { action: "sent", sent, count: exc.length };
}

/** Baraa's decision on a line, written once (a lock per line). */
async function decide(env: Env, l: DayLine, vals: Record<string, unknown>, now: number): Promise<boolean> {
  const lock = await claimButton(env, `pexc_dec:${l.id}`);
  if (!lock.claimed) return false;
  try {
    await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals: { ...vals, x_decided_at: nowOdoo(now) } });
  } catch (e) {
    await releaseButton(env, lock);
    throw e;
  }
  await finishButton(env, lock);
  return true;
}

/** The line and its day, when a decision may still be taken (draft, or a missed day not yet published). */
async function decidable(env: Env, lineId: number): Promise<{ l?: DayLine; day?: DayRecord; why?: string }> {
  const [l] = await call<Array<DayLine & { x_day_id: [number, string] | false }>>(env, PRICE_LINE_MODEL, "read", { ids: [lineId], fields: [...LINE_FIELDS, "x_day_id"] });
  if (!l) return { why: "ما لقينا هذا الصنف في أسعار اليوم." };
  const [day] = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: [m2oId(l.x_day_id)], fields: DAY_FIELDS });
  if (!day || (day.x_state !== "draft" && day.x_state !== "missed")) {
    return { l, day, why: `فات موعد نشر أسعار ${day ? arabicDate(day.x_date) : "هذا اليوم"}${day?.x_state === "published" ? " (نُشرت)" : ""}، فلا قرار عليها الآن.` };
  }
  if (l.x_decision) return { l, day, why: `القرار مسجّل مسبقاً على ${lineName(l)}: ${DECISION_LABEL[l.x_decision as Decision]}.` };
  return { l, day };
}
const missedTail = (day: DayRecord) => day.x_state === "missed" ? " السجل «فات الموعد»: انشر من «💰 أسعار اليوم» ← «نشر المعتمد الآن»." : "";

/** The payload of an exception's choice (a reply button or a list row). */
export const PRICE_EXCEPTION_PAYLOAD = /^pexc_([mspe])_(\d+)$/;

/** A tap on an exception's choices (pexc_p_ / pexc_m_ / pexc_s_ / pexc_e_ + line id). The reply to Baraa. */
export async function handlePriceExceptionButton(env: Env, payload: string, now: number = Date.now()): Promise<string> {
  const mm = PRICE_EXCEPTION_PAYLOAD.exec(String(payload ?? ""));
  if (!mm) return "";
  const { l, day, why } = await decidable(env, Number(mm[2]));
  if (why || !l || !day) return why ?? "";
  const name = lineName(l);
  if (mm[1] === "e") {
    await env.MSG_DEDUP.put(editKey(env), JSON.stringify({ lineId: l.id, at: now }), { expirationTtl: EDIT_REPLY_MIN * 60 });
    return `✏️ أرسل سعر البيع لـ ${name} رقماً واحداً خلال ${EDIT_REPLY_MIN} دقيقة.`;
  }
  if (mm[1] === "p") {
    // § 47 ب — the suggested profitable price the line carries (the number his message showed)
    const suggested = Math.round((Number(l.x_suggested_price) || 0) * 100) / 100;
    if (!(suggested > 0)) return `لا سعر مربح مقترح لـ ${name} اليوم (لا سعر شراء، أو تكلفة اليوم لا تُقرأ): اختر «لا تنشر» أو «عدّل».`;
    const ok = await decide(env, l, { x_decision: "profit", x_manual_price: suggested, x_manual_for: "profit", x_status: "manual", x_reason: "براء: اعتمد بالسعر المربح", x_sale_price: suggested, x_excluded: false }, now);
    if (ok) await boardAfterDecision(env, day.id, now);
    return ok ? `✅ ${name}: يُنشر بالسعر المربح ${money(suggested)} ر.س.${missedTail(day)}` : `القرار مسجّل مسبقاً على ${name}.`;
  }
  if (mm[1] === "m") {
    const market = Math.round((Number(l.x_market_price) || 0) * 100) / 100;
    if (!(market > 0)) return `لا سعر سوق لـ ${name} اليوم: اختر «لا تنشر» أو «عدّل».`;
    const ok = await decide(env, l, { x_decision: "market", x_manual_price: market, x_manual_for: "market", x_status: "manual", x_reason: "براء: اعتمد بسعر السوق", x_sale_price: market, x_excluded: false }, now);
    if (ok) await boardAfterDecision(env, day.id, now);
    return ok ? `✅ ${name}: يُنشر بسعر السوق ${money(market)} ر.س.${missedTail(day)}` : `القرار مسجّل مسبقاً على ${name}.`;
  }
  const ok = await decide(env, l, { x_decision: "skip", x_status: "unpublished", x_reason: "براء: لا تنشر", x_sale_price: 0, x_excluded: true }, now);
  if (ok) await boardAfterDecision(env, day.id, now);
  return ok ? `✅ ${name}: لا يُنشر اليوم.` : `القرار مسجّل مسبقاً على ${name}.`;
}

/**
 * Baraa's text within EDIT_REPLY_MIN of «عدّل»: exactly one positive number
 * written in it becomes the line's approved sale price. Null = no «عدّل»
 * waiting (the text is not about prices).
 */
export async function handlePriceEditReply(env: Env, text: string, now: number = Date.now()): Promise<string | null> {
  let pend: { lineId: number; at: number } | null = null;
  try {
    const raw = await env.MSG_DEDUP.get(editKey(env));
    pend = raw ? JSON.parse(raw) : null;
  } catch { pend = null; }
  if (!pend) return null;
  if (now - pend.at > EDIT_REPLY_MIN * 60_000 || now < pend.at) {
    await env.MSG_DEDUP.delete(editKey(env)).catch(() => {});
    return null;
  }
  const { numbersInText } = await import("./suppliers");
  const nums = numbersInText(text).filter((n) => n > 0);
  if (nums.length !== 1) return `أرسل سعر البيع رقماً موجباً واحداً (مثلاً 24.5) خلال ${EDIT_REPLY_MIN} دقيقة من «عدّل».`;
  const { l, day, why } = await decidable(env, pend.lineId);
  await env.MSG_DEDUP.delete(editKey(env)).catch(() => {});
  if (why || !l || !day) return why ?? null;
  const price = Math.round(nums[0] * 100) / 100;
  const ok = await decide(env, l, { x_decision: "edit", x_manual_price: price, x_manual_for: "edit", x_status: "manual", x_reason: "براء: سعر معدّل", x_sale_price: price, x_excluded: false }, now);
  if (ok) await boardAfterDecision(env, day.id, now);
  return ok ? `✅ ${lineName(l)}: يُنشر بـ ${money(price)} ر.س.${missedTail(day)}` : `القرار مسجّل مسبقاً على ${lineName(l)}.`;
}

export interface PricesTick {
  /** § 40 ب — 02:30 «أرسل أسعار السوق اليوم» to the sources that are not suppliers. */
  marketAsk?: { action: string } | { error: string };
  refresh?: RefreshReport | { error: string };
  /** § 40 ج — the exceptions to Baraa. */
  exceptions?: { action: string } | { error: string };
  deadline?: DeadlineReport | { error: string };
  publish?: PublishReport | { error: string };
  /** § 48 د — the days recomputed because a decision taken in Odoo was waiting. */
  decisions?: RefreshReport[] | { error: string };
}

/** A decision taken in Odoo is looked for on the days from this many days back (today, yesterday). */
export const ODOO_DECISION_DAYS_BACK = 1;

/**
 * § 48 د — «قرار براء» chosen in Odoo on a line is applied by the engine: the
 * line carries a decision and no «وقت القرار» (the engine writes it when it
 * sees the decision; the WhatsApp tap writes it itself). The engine runs by
 * itself only from 02:00 to the end of the publication window, and
 * «🔄 إعادة الحساب» may not have been pressed after the decision was saved
 * (2026-10-01: the four decisions of day #50 were saved at 12:51 and nothing
 * computed them). So every tick looks for such a line on a draft or a missed
 * real day of today or yesterday, and recomputes that day — its lines, its
 * board. The day's state is not written and nothing is sent: a missed day
 * stays missed, and is published only by «نشر المعتمد الآن».
 */
export async function applyOdooDecisions(env: Env, now: number = Date.now()): Promise<RefreshReport[]> {
  const today = riyadhDateKey(new Date(now));
  const from = riyadhDateKey(new Date(now - ODOO_DECISION_DAYS_BACK * 24 * 3600_000));
  const waiting = await call<Array<{ id: number; x_day_id: [number, string] | false }>>(env, PRICE_LINE_MODEL, "search_read", {
    domain: [
      ["x_decision", "!=", false], ["x_decided_at", "=", false],
      ["x_day_id.x_state", "in", ["draft", "missed"]], ["x_day_id.x_utak_simulation", "!=", true],
      ["x_day_id.x_date", ">=", from], ["x_day_id.x_date", "<=", today],
    ],
    fields: ["id", "x_day_id"], order: "id asc", limit: 200,
  });
  const dayIds = [...new Set(waiting.map((l) => m2oId(l.x_day_id)).filter(Boolean))];
  if (!dayIds.length) return [];
  const recs = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: dayIds, fields: ["id", "x_date", "x_state"] });
  const out: RefreshReport[] = [];
  for (const day of [...new Set(recs.map((r) => r.x_date))].sort()) out.push(await refreshPriceDay(env, { day, now, force: true }));
  return out;
}

/**
 * The every-5-minutes tick: the market ask, the engine (from the supplier ask
 * to the end of the publication window), the exceptions to Baraa, the
 * publication time, and an approval whose webhook was lost.
 */
export async function runPricesTick(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<PricesTick> {
  const out: PricesTick = {};
  const dl = pricesDeadlineMinutes(env).minutes;
  const m = riyadhMinutes(new Date(now));
  try {
    const { runMarketAsk } = await import("./price-sources");
    out.marketAsk = await runMarketAsk(env, now, dl);
  } catch (e) { out.marketAsk = { error: (e as Error)?.message ?? String(e) }; }
  try {
    out.refresh = m >= ENGINE_FROM_MINUTE && m < dl + DEADLINE_WINDOW_MIN
      ? await refreshPriceDay(env, { now })
      : { day: riyadhDateKey(new Date(now)), action: "outside" };
  } catch (e) { out.refresh = { error: (e as Error)?.message ?? String(e) }; }
  try { out.exceptions = await notifyPriceExceptions(env, now); } catch (e) { out.exceptions = { error: (e as Error)?.message ?? String(e) }; }
  try { out.deadline = await checkPricesDeadline(env, now); } catch (e) { out.deadline = { error: (e as Error)?.message ?? String(e) }; }
  // § 48 د — a decision taken in Odoo and not yet seen by the engine (outside its hours, or «🔄 إعادة الحساب» not pressed)
  try { out.decisions = await applyOdooDecisions(env, now); } catch (e) { out.decisions = { error: (e as Error)?.message ?? String(e) }; }
  // § 41 ب — the daily «عدد المحطات اليومية المخطط فارغ» alert (§ 40 د) was
  // removed: the quantity discount stays off while the field is empty.
  try {
    const rec = await readDay(env, riyadhDateKey(new Date(now)));
    const approvedAt = typeof rec?.x_approved_at === "string" ? Date.parse(rec.x_approved_at.replace(" ", "T") + "Z") : 0;
    if (rec?.x_state === "approved" && approvedAt && now - approvedAt >= PUBLISH_RETRY_AFTER_MS) {
      out.publish = await publishPriceDay(env, rec.id, { ctx, now });
    }
  } catch (e) {
    out.publish = { error: (e as Error)?.message ?? String(e) };
  }
  return out;
}
