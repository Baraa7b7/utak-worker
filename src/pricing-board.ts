// § 46 أ (2026-10-01) — «📊 لوحة التسعير»: the real profit of every line of
// «أسعار اليوم», for display. The sale price stays the market price whenever it
// is profitable (src/pricing-engine.ts).
//
// For each line, written whenever the engine runs or a decision changes:
//   • net purchase  = the purchase price as it is (§ 47 أ: every purchase
//     price is entered net of VAT, whoever the source — nothing is divided by
//     1.15);
//   • waste         = waste % × net purchase;
//   • carton share  = dailyOperatingCost(day) ÷ the expected cartons a day
//     («⚙️ إعدادات التسعير»); once ACTUAL_DAYS days with real deliveries exist:
//     ÷ the average cartons actually delivered over the last ACTUAL_DAYS
//     delivery days (the basis is written on the day);
//   • full cost     = net purchase + waste + carton share;
//   • § 47 ب — «أقل سعر بيع بدون خسارة» = full cost × 1.15, and «السعر المربح
//     المقترح» = full cost × (1 + «الهامش الأدنى ٪» ÷ 100) × 1.15 rounded up to
//     0.5 riyal, both VAT-inclusive (priceFloor, src/pricing-engine.ts: the
//     engine's rule reads the same numbers);
//   • net sale      = sale ÷ 1.15 from the cutoff (the sale = the approved
//     price, else the market price);
//   • real profit   = net sale − full cost;
//   • status        = 🟢 real profit > 0 · 🟡 covers the goods and the waste but
//     not the carton share · 🔴 a loss on the goods themselves · ⚪ no data (no
//     purchase or no market).
// Every amount is rounded to two decimals as shown, and the sums are made from
// the rounded amounts: a card always adds up.
//
// The day carries the header: the day's cost, the expected cartons, the carton
// share and its basis, the share were the cartons COMPARE_CARTONS, and the
// number of 🟢 🟡 🔴 ⚪ lines.

import type { Env } from "./config";
import { call } from "./odoo";
import { dailyOperatingCost } from "./operating-cost";
import { DEFAULT_MIN_MARGIN_PCT, priceFloor } from "./pricing-engine";

export type BoardStatus = "green" | "yellow" | "red" | "none";
export type ShareBasis = "expected" | "actual";
/** «سطر مقارنة»: the carton share were the cartons this many a day. */
export const COMPARE_CARTONS = 500;
/** The actual average replaces the expected cartons once this many days with real deliveries exist. */
export const ACTUAL_DAYS = 7;
/** How far back the delivery days are looked for. */
export const ACTUAL_LOOKBACK_DAYS = 90;
/** The inputs (the day's cost, the delivered cartons) are read again after this long. */
export const BOARD_INPUT_TTL_SEC = 15 * 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 3600_000;

// ---------------------------------------------------------------- the carton share

export interface ActualCartons {
  /** Days with real deliveries before the board's day (within the look-back). */
  days: number;
  /** The average cartons delivered over the last ACTUAL_DAYS of them; null below ACTUAL_DAYS days. */
  average: number | null;
}
export interface BoardShare {
  /** dailyOperatingCost(day); null = «تعذّر». */
  cost: number | null;
  expected: number | null;
  basis: ShareBasis;
  /** What the cost was divided by. */
  cartons: number | null;
  share: number | null;
  share500: number | null;
  note: string;
}

/** The carton share of the day and what it was divided by. Pure. */
export function boardShare(cost: number | null, expected: number | null, actual: ActualCartons, costReason = ""): BoardShare {
  const exp = expected !== null && expected > 0 ? expected : null;
  const useActual = actual.days >= ACTUAL_DAYS && actual.average !== null && actual.average > 0;
  const basis: ShareBasis = useActual ? "actual" : "expected";
  const cartons = useActual ? (actual.average as number) : exp;
  const notes: string[] = [];
  if (cost === null) notes.push(`تكلفة اليوم تعذّرت${costReason ? ` (${costReason})` : ""}: الحالة ⚪ لما لا يخسر على البضاعة.`);
  if (cartons === null) notes.push("«الكراتين المتوقعة يومياً» فارغة في «⚙️ إعدادات التسعير»: لا حصة تشغيل.");
  return {
    cost, expected: exp, basis, cartons,
    share: cost !== null && cartons !== null ? round2(cost / cartons) : null,
    share500: cost !== null ? round2(cost / COMPARE_CARTONS) : null,
    note: notes.join(" "),
  };
}

// ---------------------------------------------------------------- a line

export interface BoardLineInput {
  /** The purchase price used by the engine: net of VAT as written (§ 47 أ); null / 0 = none. */
  purchase: number | null;
  /** The approved sale price, else the market price (VAT-inclusive from the cutoff); null / 0 = none. */
  sale: number | null;
  wastePct: number;
  /** 15 from the cutoff, null before it. */
  vatRatePct: number | null;
  /** The carton share; null = it cannot be read. */
  opShare: number | null;
  /** § 47 ب — «الهامش الأدنى ٪» of the settings. */
  minMarginPct?: number;
}
export interface BoardLineValues {
  x_net_purchase: number;
  x_waste_cost: number;
  x_op_share: number;
  x_full_cost: number;
  /** § 47 ب — «أقل سعر بيع بدون خسارة» (0 = none: no purchase, or no carton share). */
  x_break_even: number;
  /** § 47 ب — «السعر المربح المقترح» (0 = none). */
  x_suggested_price: number;
  x_board_sale: number;
  x_net_sale: number;
  x_real_profit: number;
  x_board_status: BoardStatus;
}

/** One line of the board. Pure. */
export function boardLine(i: BoardLineInput): BoardLineValues {
  const d = i.vatRatePct ? 1 + i.vatRatePct / 100 : 1;
  const hasSale = i.sale !== null && i.sale > 0;
  // § 47 أ — the purchase is net as written; the floor is the engine's own (priceFloor)
  const fl = priceFloor({ purchase: i.purchase, wastePct: i.wastePct, opShare: i.opShare, vatRatePct: i.vatRatePct, minMarginPct: i.minMarginPct ?? DEFAULT_MIN_MARGIN_PCT });
  const hasPurchase = fl !== null;
  const netPurchase = fl?.netPurchase ?? 0;
  const waste = fl?.waste ?? 0;
  const opShare = i.opShare !== null ? round2(i.opShare) : 0;
  const fullCost = fl?.fullCost ?? 0;
  const sale = hasSale ? round2(i.sale as number) : 0;
  const netSale = hasSale ? round2((i.sale as number) / d) : 0;
  const complete = hasPurchase && hasSale;
  const realProfit = complete ? round2(netSale - fullCost) : 0;
  let status: BoardStatus = "none";
  if (complete) {
    // the goods themselves: the net sale against the net purchase and its waste
    const goods = round2(netSale - netPurchase - waste);
    if (goods < 0) status = "red";
    else if (i.opShare === null) status = "none";
    else status = realProfit > 0 ? "green" : "yellow";
  }
  return {
    x_net_purchase: netPurchase, x_waste_cost: waste, x_op_share: opShare, x_full_cost: fullCost,
    x_break_even: fl?.breakEven ?? 0, x_suggested_price: fl?.suggested ?? 0,
    x_board_sale: sale, x_net_sale: netSale, x_real_profit: realProfit, x_board_status: status,
  };
}

export const BOARD_LINE_FIELDS = ["x_net_purchase", "x_waste_cost", "x_op_share", "x_full_cost", "x_break_even", "x_suggested_price", "x_board_sale", "x_net_sale", "x_real_profit", "x_board_status"] as const;

/** The day's header: the cost, the share and its basis, the comparison, the counts. */
export function boardHeader(share: BoardShare, statuses: BoardStatus[], nowMs: number): Record<string, unknown> {
  const n = (s: BoardStatus) => statuses.filter((x) => x === s).length;
  return {
    x_op_cost: share.cost ?? 0,
    x_op_expected: share.expected ?? 0,
    x_op_cartons: share.cartons !== null ? round2(share.cartons) : 0,
    x_op_basis: share.basis,
    x_op_share: share.share ?? 0,
    x_op_share_500: share.share500 ?? 0,
    x_n_green: n("green"), x_n_yellow: n("yellow"), x_n_red: n("red"), x_n_none: n("none"),
    x_board_note: share.note || false,
    x_board_at: new Date(nowMs).toISOString().replace("T", " ").slice(0, 19),
  };
}

// ---------------------------------------------------------------- Odoo reads

/** Start of a Riyadh day, as Odoo stores datetimes (UTC, «YYYY-MM-DD HH:MM:SS»). */
function riyadhDayStartUtc(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+03:00`)).toISOString().replace("T", " ").slice(0, 19);
}
const riyadhDayOf = (odooUtc: string) => new Date(Date.parse(odooUtc.replace(" ", "T") + "Z") + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * The real deliveries before `day`: the orders delivered (delivered / closed,
 * a delivery time, not simulation), by the Riyadh day of the delivery. With
 * ACTUAL_DAYS such days: the cartons of their delivered lines (a line short at
 * delivery left out) over the last ACTUAL_DAYS of them, averaged per day.
 */
export async function deliveredCartons(env: Env, day: string): Promise<ActualCartons> {
  const from = new Date(Date.parse(`${day}T00:00:00+03:00`) - ACTUAL_LOOKBACK_DAYS * DAY_MS).toISOString().replace("T", " ").slice(0, 19);
  const orders = await call<Array<{ id: number; x_delivered_at: string | false }>>(env, "x_daily_order", "search_read", {
    domain: [["x_state", "in", ["delivered", "closed"]], ["x_delivered_at", ">=", from], ["x_delivered_at", "<", riyadhDayStartUtc(day)], ["x_utak_simulation", "!=", true]],
    fields: ["id", "x_delivered_at"], order: "x_delivered_at desc", limit: 5000,
  });
  const byDay = new Map<string, number[]>();
  for (const o of orders) {
    if (typeof o.x_delivered_at !== "string") continue;
    const d = riyadhDayOf(o.x_delivered_at);
    byDay.set(d, [...(byDay.get(d) ?? []), o.id]);
  }
  const days = [...byDay.keys()].sort().reverse();
  if (days.length < ACTUAL_DAYS) return { days: days.length, average: null };
  const ids = days.slice(0, ACTUAL_DAYS).flatMap((d) => byDay.get(d) as number[]);
  const lines = await call<Array<{ x_quantity: number | false }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", ids], ["x_status", "!=", "unavailable"], ["x_utak_simulation", "!=", true]],
    fields: ["x_quantity"], limit: 20000,
  });
  const total = lines.reduce((a, l) => a + (Number(l.x_quantity) || 0), 0);
  return { days: days.length, average: round2(total / ACTUAL_DAYS) };
}

export interface BoardInputs { cost: number | null; costReason: string; actual: ActualCartons }
const inputsKey = (day: string) => `board_in:v1:${day}`;

/**
 * The day's cost and the delivered cartons, kept BOARD_INPUT_TTL_SEC in KV (the
 * engine asks every five minutes; a cost line or a delivery does not change
 * that often). `force` reads them again. Never throws: a cost that cannot be
 * read is null with its reason, and the deliveries then count as none.
 */
export async function readBoardInputs(env: Env, day: string, nowMs: number = Date.now(), force = false): Promise<BoardInputs> {
  if (!force) {
    try {
      const hit = await env.MSG_DEDUP.get(inputsKey(day));
      const kept = hit ? (JSON.parse(hit) as BoardInputs & { at?: number }) : null;
      // the age is checked here too (not left to the key's expiry alone)
      if (kept && typeof kept.at === "number" && nowMs >= kept.at && nowMs - kept.at < BOARD_INPUT_TTL_SEC * 1000) {
        return { cost: kept.cost, costReason: kept.costReason, actual: kept.actual };
      }
    } catch { /* read them */ }
  }
  let cost: number | null = null, costReason = "";
  try {
    const c = await dailyOperatingCost(env, day, nowMs);
    cost = c.total;
    costReason = c.reason ?? "";
  } catch (e) {
    costReason = "تعذّرت قراءة التكاليف";
    console.warn(`[board] ${day}: the day's cost could not be read`, (e as Error)?.message);
  }
  let actual: ActualCartons = { days: 0, average: null };
  let complete = true;
  try {
    actual = await deliveredCartons(env, day);
  } catch (e) {
    complete = false;
    console.warn(`[board] ${day}: the delivered cartons could not be read — the expected cartons`, (e as Error)?.message);
  }
  const out: BoardInputs = { cost, costReason, actual };
  // a failed read is not remembered: the next run asks again
  if (complete && (cost !== null || costReason !== "تعذّرت قراءة التكاليف")) {
    try { await env.MSG_DEDUP.put(inputsKey(day), JSON.stringify({ ...out, at: nowMs }), { expirationTtl: BOARD_INPUT_TTL_SEC }); } catch { /* next run reads again */ }
  }
  return out;
}
