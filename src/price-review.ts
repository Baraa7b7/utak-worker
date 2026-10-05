// § 54 (2026-10-05) — the day's prices reviewed by Baraa in ONE message.
//
// Until § 54 every exception of «أسعار اليوم» reached him as its own message
// with its own buttons, and «عدّل» asked for a number within 30 minutes: twenty
// items were twenty messages. Now:
//
//   ب  ONE message, from the end of the market's reply window (04:00) until the
//      publication time, on a draft day: a line per item, by category —
//        «موز: شراء 55 · سوق 70 · الفرق 15 (27%) ← انشر بسعر السوق 70»
//      (الفرق = the market − the purchase; its percentage of the purchase) with
//      the item's proposed decision (src/pricing-engine.ts proposeDecision), and
//      three buttons: «✅ اعتمد الكل كما هو», «✏️ مراجعة», «⛔ لا تنشر اليوم» (§ 55:
//      «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء»). A
//      table longer than an interactive message's text goes first as plain
//      text, then the buttons under a summary («N للنشر · M لا تنشر · K ⚠️»).
//      It goes inside his 24h window only and is never held: with his window
//      closed he gets utak_owner_price_review_v1 (src/owner-window.ts) and the
//      review is built — fresh — at his first message. A change of a proposal
//      before he decides sends the review again («🔄 تحديث»), and the buttons of
//      the older one no longer decide.
//   ج  «✏️ مراجعة» (§ 55: «✏️ عدّل»): the Flow utak_owner_review_v1 (scripts/lib/s54-flows.mjs),
//      no endpoint: pages by category, and for every item its numbers, a list
//      opened on the proposed decision — «انشر بالمقترح (P)», «انشر بسعر السوق
//      (Y)» (with a market price only), «لا تنشر», «سعر يدوي» — and «السعر
//      اليدوي», read with «سعر يدوي» alone. «اعتمد» writes every decision in
//      the line's own decision fields (x_decision, x_manual_price, …: the board
//      in Odoo stays in step), then one confirmation: «سيُنشر 06:00: …». After
//      the publication time on a day that was not published the publication
//      follows at once, by the path of «نشر المعتمد الآن», and the confirmation
//      says so. A manual price below «بدون خسارة» is taken, with a ⚠️ line.
//   د  no decision by 06:00: the engine publishes what rules 5 and 6 propose
//      («بسعر السوق», or by the setting) without ⚠️; the rest is not published,
//      and the 06:00 message names both (src/prices.ts).
//
// Nothing here reaches anyone but Baraa: the purposes are the owner's alone
// (src/wa-gateway.ts). The trial («🧪 تجربة») writes nothing and publishes
// nothing.
//
// § 55 أ (2026-10-05) — the same review, made plain. «الفرق Z (P%)» is gone
// (it set the market, VAT-inclusive, against the purchase, net of VAT: a large
// difference on an item that loses). Every item now shows «ربحنا»: the net of a
// carton as the board computes it (src/pricing-board.ts boardLine) — the sale
// price ÷ 1.15 − the purchase − the waste − the carton's share of the day's
// cost — always with its sign and two decimals («+1.13», «−0.74»):
//   • a line an item, its mark first: ✅ published with a profit, ❌ «لا تنشر»,
//     ⚠️ an outlier (and under it «⚠️ سعر الشراء تغيّر كثير (آخر سعر ← اليوم)،
//     تأكد منه»): «✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق:
//     +1.13 ← انشر بـ 70» — the purchase price as entered (net of VAT) and, beside
//     it, × 1.15 («شامل»), to set against the market price, which includes the VAT;
//   • under the title «(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)»;
//   • three lines at the bottom say what each choice does: what «نفّذ المقترح»
//     publishes, what it does not, and what goes out at the publication time
//     with no tap at all;
//   • the buttons: «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء» — the same
//     behaviour as § 54's;
//   • the form (utak_owner_review_v2): two lines an item — «شراء X (X×1.15
//     شامل) · سوق Y · ربحنا بسعر السوق: ±a» and «سعرنا المقترح P = أعلى/أقل من
//     السوق بـ d (±e%)»
//     — and every choice of the list carries its own profit;
//   • the confirmation: every published item with its price and its profit, and
//     «متوسط الربح للكرتون: ±x».

import type { Env } from "./config";
import { profitVatRate } from "./config";
import type { NormalizedMessage } from "./types";
import { call } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { arabicDate } from "./wa-params";
import { riyadhDateKey, riyadhMinutes } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { DECISION_REASON, fixedPrice, marketSale, proposeDecision, type AboveSuggested, type Decision, type Proposal } from "./pricing-engine";
import { readPricingSettings } from "./operating-cost";
import { FLOW_CATEGORIES, FLOW_OTHER_TITLE, FLOW_PLAIN_TITLE, parseFlowNumber, productPages } from "./price-flow";
import { PLACE_TODAY } from "./places";
import {
  DAY_FIELDS, EXCEPTION_PURPOSE, OUT_OF_CATALOG_REASON, PRICE_DAY_MODEL, PRICE_LINE_MODEL, PRICE_TEXT_LIMIT,
  boardAfterDecision, exceptionsFromMinutes, fullName, hhmm, isPublishable, m2oId, money, nowOdoo, pricesDeadlineMinutes, publishPriceDay,
  readDay, readLines, refreshPriceDay, weekdayAr, type DayLine, type DayRecord,
} from "./prices";

/**
 * utak_owner_review_v2 at Meta (§ 55: two lines an item; scripts/lib/s55-flows.mjs). A published Flow's
 * JSON is frozen: utak_owner_review_v1 (#1084593151143621, § 54) stays at Meta and is no longer sent —
 * a reply of one sent before is still read (the same d<n> / p<n>, by its token).
 */
export const REVIEW_FLOW_ID = "1135227635856887";
export const REVIEW_FLOW_SCREEN = "REVIEW_A";
export const REVIEW_FLOW_PAGES = 6;
export const REVIEW_FLOW_PAGE_SLOTS = 10;
export const REVIEW_FLOW_SLOTS = REVIEW_FLOW_PAGES * REVIEW_FLOW_PAGE_SLOTS;
/** The gateway purpose of the review, its form and its answers: the owner's alone. */
export const REVIEW_PURPOSE = EXCEPTION_PURPOSE;
/** The one trial to Baraa and its answers (nothing written, nothing published). */
export const REVIEW_TEST_PURPOSE = "price_review_test";
export const REVIEW_TEST_MARK = "🧪 تجربة";
/** The shape of the message the trial shows: the trial goes once a day for each (§ 55: «2» = the purchase price with its VAT on every line). */
export const REVIEW_TEST_EDITION = "2";
/** The three buttons (Meta: a reply button's title holds 20 characters). */
/** § 55 — «نفّذ المقترح» (was «اعتمد الكل كما هو»), «عدّل» (was «مراجعة»), «لا تنشر شيء» (was «لا تنشر اليوم»): the same three actions. */
export const REVIEW_BUTTON_ALL_NAME = "نفّذ المقترح";
export const REVIEW_BUTTON_ALL = `✅ ${REVIEW_BUTTON_ALL_NAME}`;
export const REVIEW_BUTTON_FORM = "✏️ عدّل";
export const REVIEW_BUTTON_NONE = "⛔ لا تنشر شيء";
/** Under a confirmation: the form again. */
export const REVIEW_BUTTON_EDIT = REVIEW_BUTTON_FORM;
export const REVIEW_FLOW_CTA = "عدّل الأسعار";
/** Meta: the text of an interactive message holds this many characters. */
export const INTERACTIVE_BODY_MAX = 1024;
/** Meta's limits of the form: a list's label, an option's title, a line of text. */
export const REVIEW_LABEL_MAX = 20;
export const REVIEW_OPTION_MAX = 30;
export const REVIEW_INFO_MAX = 409;
/** prv_<a|r|n>_<day id>_<version>; «prvt_…» is the trial's. Version 0 = the form again, from a confirmation. */
export const REVIEW_PAYLOAD = /^prv(t?)_([arn])_(\d+)_(\d+)$/;
const DAY_TTL = 26 * 60 * 60;
const TOKEN_TTL = 36 * 60 * 60;

// ---------------------------------------------------------------- the rows

/** One item of the day as the review shows it. */
export interface ReviewRow {
  lineId: number;
  productId: number;
  name: string;
  /** 0 = none. */
  purchase: number;
  /** The market price as observed (0 = none); `sale` is that price after the uplift of § 53. */
  market: number;
  sale: number;
  upliftPct: number;
  breakEven: number;
  suggested: number;
  proposal: Proposal;
  /** Baraa's own decision already on the line (WhatsApp or Odoo), and the price it publishes at. */
  decision: Decision | null;
  decidedPrice: number;
  /** § 55 — the carton's full cost as the board stores it (purchase + waste + the carton share; 0 = none) and the day's VAT rate: «ربحنا» is made from them. */
  fullCost: number;
  vatPct: number | null;
  /** § 55 — an outlier: each price that moved, with the same source's price before it (0 = not read). */
  moved?: MovedPrice[];
}
export type OutcomeKind = "market" | "profit" | "edit" | "skip";
export interface MovedPrice { kind: "purchase" | "market"; last: number; now: number }

const m2oName = (v: [number, string] | false | undefined): string => (Array.isArray(v) ? v[1] : "");
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * § 55 — «ربحنا» of a row at a sale price: the board's own net of a carton
 * (src/pricing-board.ts boardLine: the net sale, rounded, minus the full cost)
 * = price ÷ 1.15 − the purchase − the waste − the carton share. Null without a
 * purchase price, a full cost or a price. Pure.
 */
export function profitAt(r: Pick<ReviewRow, "purchase" | "fullCost" | "vatPct">, price: number): number | null {
  if (!(r.purchase > 0) || !(r.fullCost > 0) || !(price > 0)) return null;
  const d = r.vatPct ? 1 + r.vatPct / 100 : 1;
  return round2(round2(price / d) - r.fullCost);
}
/** «+1.13», «−0.74» (U+2212), «0.00»: two decimals, and its sign whenever it has one. */
export function signed(x: number): string {
  const n = round2(x);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
}

/** The rows of a day: every line of the active catalog, its numbers as stored and its proposed decision. `day`: its VAT rate (§ 55, «ربحنا»). */
export function reviewRows(lines: DayLine[], above: AboveSuggested, day: string): ReviewRow[] {
  const vatPct = profitVatRate(day);
  const inDay = lines.filter((l) => l.x_reason !== OUT_OF_CATALOG_REASON);
  const names = inDay.map((l) => fullName(m2oName(l.x_product_tmpl_id)) || "?");
  return inDay.map((l, i) => {
    const pk = m2oName(l.x_packaging_id);
    // two packagings of one product: the packaging tells them apart
    const twice = names.filter((n) => n === names[i]).length > 1;
    const purchase = Number(l.x_cost_price) || 0, market = Number(l.x_market_price) || 0, sale = marketSale(l);
    const breakEven = Number(l.x_break_even) || 0, suggested = Number(l.x_suggested_price) || 0;
    const proposal = proposeDecision({
      purchase: purchase > 0 ? purchase : null, sale: sale > 0 ? sale : null,
      breakEven: breakEven > 0 ? breakEven : null, suggested: suggested > 0 ? suggested : null,
      unitProfit: purchase > 0 && sale > 0 ? Number(l.x_unit_profit) || 0 : null, outlier: l.x_is_outlier === true,
    }, above);
    const decision = (l.x_decision || null) as Decision | null;
    const fixed = fixedPrice(l);
    const decidedPrice = !decision || decision === "skip" ? 0 : fixed > 0 ? fixed : decision === "market" ? sale : decision === "profit" ? suggested : 0;
    return {
      lineId: l.id, productId: m2oId(l.x_product_tmpl_id), name: twice && pk ? `${names[i]} (${pk})` : names[i],
      purchase, market, sale, upliftPct: Number(l.x_uplift_pct) > 0 ? Number(l.x_uplift_pct) : 0, breakEven, suggested, proposal, decision, decidedPrice,
      fullCost: purchase > 0 ? Number(l.x_full_cost) || 0 : 0, vatPct,
    };
  });
}

/** One search_read: the worker's own client, or a script's (scripts/s54-20261005-preview.mts). */
export type SearchRead = (model: string, body: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
/** Which prices of an outlier line moved: the engine's own reason («سعر شاذ: الشراء و السوق»); unreadable = the purchase. */
function movedKinds(l: DayLine): Array<MovedPrice["kind"]> {
  const m = /سعر شاذ: ([^،]*)/.exec(String(l.x_reason || ""));
  const kinds: Array<MovedPrice["kind"]> = [...(m?.[1].includes("الشراء") ? ["purchase" as const] : []), ...(m?.[1].includes("السوق") ? ["market" as const] : [])];
  return kinds.length ? kinds : ["purchase"];
}
/**
 * § 55 — «(آخر سعر ← اليوم)» of an outlier line: the price that moved, and the
 * same source's price before it — as the outlier check read it (§ 26: the
 * supplier's row before this one; a source's offer before this one). A read
 * that fails leaves the price before at 0 (the line then names no numbers).
 */
export async function readMoved(read: SearchRead, day: string, l: DayLine): Promise<MovedPrice[]> {
  const product = m2oId(l.x_product_tmpl_id), packaging = m2oId(l.x_packaging_id);
  const item: unknown[][] = [["x_product_tmpl_id", "=", product], ["x_packaging_id", "=", packaging], ["x_utak_simulation", "!=", true]];
  const before = async (model: string, who: string, partner: number, field: string, notId: number): Promise<number> => {
    const [r] = await read(model, {
      domain: [...item, [who, "=", partner], [field, ">", 0], ["x_date", "<=", day], ["id", "!=", notId]], fields: [field], order: "x_date desc, id desc", limit: 1,
    });
    return r ? Number(r[field]) || 0 : 0;
  };
  const out: MovedPrice[] = [];
  for (const kind of movedKinds(l)) {
    let last = 0, now = kind === "purchase" ? Number(l.x_cost_price) || 0 : Number(l.x_market_price) || 0;
    try {
      const supplier = m2oId(l.x_supplier_id), dailyId = m2oId(l.x_daily_price_id);
      if (kind === "purchase" && supplier && dailyId) last = await before("x_daily_price", "x_supplier_id", supplier, "x_price_sar", dailyId);
      else {
        // the offer of the day that carries the mark: its source, its number, and that source's number before it
        const mark = kind === "purchase" ? "x_purchase_outlier" : "x_market_outlier", field = kind === "purchase" ? "x_purchase_price" : "x_market_price";
        const [o] = await read("x_price_offer", {
          domain: [...item, ["x_date", "=", day], [mark, "=", true]], fields: ["id", "x_source_partner_id", field], order: "id desc", limit: 1,
        });
        if (o) {
          now = Number(o[field]) || now;
          last = await before("x_price_offer", "x_source_partner_id", m2oId(o.x_source_partner_id as [number, string] | false), field, Number(o.id));
        }
      }
    } catch (e) {
      console.warn(`[price-review] line ${l.id}: the price before the outlier could not be read`, (e as Error)?.message);
    }
    out.push({ kind, last, now });
  }
  return out;
}
/** The rows of a stored day as the review sends them: its lines, the setting, and — § 55 — what moved on each outlier still waiting. */
export async function dayReviewRows(env: Env, day: Pick<DayRecord, "id" | "x_date">): Promise<ReviewRow[]> {
  const lines = await readLines(env, day.id);
  const rows = reviewRows(lines, await aboveSetting(env, day.x_date), day.x_date);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const r of rows) {
    const l = byId.get(r.lineId);
    if (l && r.proposal.outlier && !r.decision) r.moved = await readMoved((model, body) => call<Array<Record<string, unknown>>>(env, model, "search_read", body), day.x_date, l);
  }
  return rows;
}

/** What happens to the row as things stand: Baraa's decision, else the proposed one. */
export function rowOutcome(r: ReviewRow): { kind: OutcomeKind; price: number; byOwner: boolean } {
  if (r.decision) return r.decision === "skip" || !(r.decidedPrice > 0) ? { kind: "skip", price: 0, byOwner: true } : { kind: r.decision, price: r.decidedPrice, byOwner: true };
  return { kind: r.proposal.kind, price: r.proposal.price, byOwner: false };
}
/** Is the row published at the publication time with nothing more from Baraa? His decision, or rules 5 and 6 without ⚠️. */
export const publishesAsIs = (r: ReviewRow): boolean => (r.decision ? rowOutcome(r).kind !== "skip" : r.proposal.auto);

// ---------------------------------------------------------------- the texts

/** 06:00 → «الساعة 6»; a time that is not on the hour keeps its minutes: «الساعة 06:30». */
export const clockAr = (minutes: number): string => `الساعة ${minutes % 60 === 0 ? String(Math.floor(minutes / 60)) : hhmm(minutes)}`;
/** The purchase price is entered net of VAT (§ 47); beside it the review writes it with the VAT, to set against the market price. */
export const PURCHASE_VAT_FACTOR = 1.15;
/**
 * «شراء 22 (25.30 شامل)»: the purchase price as entered and × 1.15 — always, and
 * always with two decimals (whole halalas, half up: 12.50 → 14.375 → 14.38, where
 * the float alone gives 14.37). "" without a
 * purchase price: nothing is written.
 */
export function purchaseText(r: Pick<ReviewRow, "purchase">): string {
  if (!(r.purchase > 0)) return "";
  const withVat = Math.round(Math.round(r.purchase * PURCHASE_VAT_FACTOR * 1e6) / 1e4) / 100;
  return `شراء ${money(r.purchase)} (${withVat.toFixed(2)} شامل)`;
}
/** «سوق 70»; with an uplift «سوق 30 (بعد الزيادة 31)»; none: «لا سعر سوق». */
const marketText = (r: ReviewRow): string => (r.market > 0 ? `سوق ${money(r.market)}${r.upliftPct > 0 ? ` (بعد الزيادة ${money(r.sale)})` : ""}` : "لا سعر سوق");
/** The day's cost could not be read («تعذّر», or no «الكراتين المتوقعة»): the row's full cost holds no carton share, and its profit says so. */
export const NO_SHARE_NOTE = " (بلا حصة التشغيل)";
const noShare = (r: ReviewRow): boolean => r.purchase > 0 && r.fullCost > 0 && !(r.breakEven > 0);
/** «ربحنا بسعر السوق: +1.13», «ربحنا بالمقترح 19.50: +2.37», «ربحنا بسعرك 72: +2.87»; "" when it cannot be computed. */
function profitText(r: ReviewRow, kind: OutcomeKind, price: number): string {
  const p = profitAt(r, price);
  if (p === null) return "";
  return `ربحنا ${kind === "market" ? "بسعر السوق" : kind === "profit" ? `بالمقترح ${money(price)}` : `بسعرك ${money(price)}`}${noShare(r) ? NO_SHARE_NOTE : ""}: ${signed(p)}`;
}
/** The profit a row's line shows: at the price it is published at; a row that is not published: at the market price, else at the suggested one. */
function lineProfit(r: ReviewRow): string {
  const o = rowOutcome(r);
  if (o.kind !== "skip") return profitText(r, o.kind, o.price);
  if (!(r.purchase > 0)) return "لا سعر شراء";
  if (r.sale > 0) return profitText(r, "market", r.sale);
  return r.suggested > 0 ? profitText(r, "profit", r.suggested) : "";
}
/** Is the row an outlier still waiting for Baraa's word (⚠️)? */
export const isWarned = (r: ReviewRow): boolean => !r.decision && r.proposal.outlier;
/**
 * The mark a row's line opens with: ⚠️ an outlier still waiting, ❌ not
 * published, ✅ published with a profit above zero — and 🔻 published with none
 * (a price at «بدون خسارة» exactly, or Baraa's own price below it).
 */
export function rowMark(r: ReviewRow): string {
  if (isWarned(r)) return "⚠️";
  const o = rowOutcome(r);
  if (o.kind === "skip") return "❌";
  const p = profitAt(r, o.price);
  return p === null || p > 0 ? "✅" : "🔻";
}
/** «انشر بـ 70», «لا تنشر»; Baraa's own decision: «قرارك: انشر بـ 70». */
export function decisionText(r: ReviewRow): string {
  const o = rowOutcome(r);
  return `${o.byOwner ? "قرارك: " : ""}${o.kind === "skip" ? "لا تنشر" : `انشر بـ ${money(o.price)}`}`;
}
/** «⚠️ سعر الشراء تغيّر كثير (35 ← 55)، تأكد منه» — a line for each price of an outlier that moved. */
export function movedLines(r: ReviewRow): string[] {
  if (!isWarned(r)) return [];
  const moved = r.moved?.length ? r.moved : [{ kind: "purchase" as const, last: 0, now: 0 }];
  return moved.map((m) => `⚠️ سعر ${m.kind === "market" ? "السوق" : "الشراء"} تغيّر كثير${m.last > 0 && m.now > 0 ? ` (${money(m.last)} ← ${money(m.now)})` : " عن آخر سعر"}، تأكد منه`);
}

/**
 * § 55 — an item's line, its mark first: «❌ رمان كبير — شراء 22 (25.30 شامل) ·
 * سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر»; without a market price «✅ رمان
 * صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر
 * بـ 19.50». No «الفرق». Without a purchase price nothing is written for it.
 */
export function reviewLine(r: ReviewRow): string {
  const prices = [purchaseText(r), marketText(r)].filter(Boolean).join(" · ");
  return `${rowMark(r)} ${r.name} — ${[prices, lineProfit(r)].filter(Boolean).join(" | ")} ← ${decisionText(r)}`;
}
/** …and under an outlier's line, what moved. */
export const reviewItemLines = (r: ReviewRow): string[] => [reviewLine(r), ...movedLines(r)];

export interface ReviewGroup { title: string; rows: ReviewRow[] }

/** The rows by category, as the forms order them: فواكه، خضار، ورقيات، then «أخرى». Pure. */
export function groupRows(rows: ReviewRow[], of: Map<number, number>, titles: Map<number, string>): ReviewGroup[] {
  return [
    ...FLOW_CATEGORIES.map((c) => ({ title: titles.get(c.id) ?? c.title, rows: rows.filter((r) => (of.get(r.productId) ?? 0) === c.id) })),
    { title: FLOW_OTHER_TITLE, rows: rows.filter((r) => !(of.get(r.productId) ?? 0)) },
  ].filter((g) => g.rows.length);
}
/** …read from Odoo; categories that cannot be read: one group, nothing lost. */
export async function reviewGroups(env: Env, rows: ReviewRow[]): Promise<ReviewGroup[]> {
  if (!rows.length) return [];
  try {
    const { of, titles } = await productPages(env, [...new Set(rows.map((r) => r.productId))]);
    return groupRows(rows, of, titles);
  } catch (e) {
    console.warn("[price-review] the categories could not be read — one group", (e as Error)?.message);
    return [{ title: FLOW_PLAIN_TITLE, rows }];
  }
}

export interface ReviewCounts { publish: number; skip: number; warn: number; auto: number }
/** How many rows are published as things stand, how many are not, how many ⚠️ wait, and how many go out without Baraa. */
export function reviewCounts(rows: ReviewRow[]): ReviewCounts {
  const publish = rows.filter((r) => rowOutcome(r).kind !== "skip").length;
  return { publish, skip: rows.length - publish, warn: rows.filter(isWarned).length, auto: rows.filter(publishesAsIs).length };
}

/** The title's second line: what «ربحنا» is. */
export const PROFIT_NOTE = "(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)";
const NOTHING = "لا شيء";
const named = (rows: ReviewRow[], price: boolean): string => rows.map((r) => (price ? `${r.name} ${money(rowOutcome(r).price)}` : r.name)).join("، ");
/** «صنف واحد», «صنفان», «18 صنفاً». */
const counted = (rows: ReviewRow[]): string => (rows.length === 1 ? "صنف واحد" : rows.length === 2 ? "صنفان" : `${rows.length} ${itemsWord(rows.length)}`);
/**
 * § 55 — the three lines under the table, what each choice does:
 *   «لو ضغطت «نفّذ المقترح» ينتشر: موز 70، رمان صغير 19.50»
 *   «وما ينتشر: رمان وسط، رمان كبير»
 *   «لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء»
 * `compact`: the numbers of items in place of their names (the names are then in
 * the table's own text). After the publication time on a day that was not
 * published the third line says a tap publishes at once.
 */
export function choiceLines(rows: ReviewRow[], deadlineMin: number, o: { late?: boolean; compact?: boolean } = {}): string[] {
  const out = rows.filter((r) => rowOutcome(r).kind !== "skip"), stay = rows.filter((r) => rowOutcome(r).kind === "skip"), auto = rows.filter(publishesAsIs);
  const list = (rs: ReviewRow[], price: boolean): string => (!rs.length ? NOTHING : o.compact ? counted(rs) : named(rs, price));
  return [
    `لو ضغطت «${REVIEW_BUTTON_ALL_NAME}» ينتشر: ${list(out, true)}`,
    `وما ينتشر: ${list(stay, false)}`,
    o.late ? `فات موعد ${clockAr(deadlineMin)} وما انتشرت أسعار اليوم: ضغطك «${REVIEW_BUTTON_ALL_NAME}» الآن ينشر فوراً.`
      : `لو ما ضغطت شي، ${clockAr(deadlineMin)} ينتشر تلقائياً: ${list(auto, true)}`,
  ];
}

export interface ReviewTextOpts {
  test?: boolean;
  /** «🔄 تحديث»: the time of this version, and the items that changed since the last one. */
  update?: { at: string; changed: string[] };
  /** The publication time has passed on a day that was not published: an approval publishes at once. */
  late?: boolean;
}
export function reviewTitle(day: string, o: ReviewTextOpts = {}): string {
  const lead = o.update ? `🔄 تحديث مراجعة أسعار اليوم (${o.update.at})` : "📋 مراجعة أسعار اليوم";
  return `${o.test ? `${REVIEW_TEST_MARK} — ` : ""}${lead} — ${weekdayAr(day)} ${arabicDate(day)}`;
}

/** A list line longer than a part's room, cut after its commas (nothing lost). */
export function wrapList(line: string, room: number): string[] {
  if (line.length <= room) return [line];
  const out: string[] = [];
  let cur = "";
  for (const piece of line.split(/(?<=، )/)) {
    if (cur && cur.length + piece.length > room) { out.push(cur.trimEnd()); cur = ""; }
    cur += piece;
  }
  if (cur) out.push(cur.trimEnd());
  return out;
}

export interface ReviewTexts {
  /** The table as plain text when it does not fit an interactive message (parts of at most PRICE_TEXT_LIMIT). */
  texts: string[];
  /** The text above the three buttons: the whole review, or its summary after the table. */
  body: string;
}
/**
 * The review as it is sent. The whole of it above the buttons while it fits an
 * interactive message's text; else the table first as plain text — cut on line
 * boundaries, «(1/2)» — with the three choice lines by name after it, and the
 * buttons under the same three lines by number. Pure.
 */
export function buildReviewTexts(day: string, groups: ReviewGroup[], deadlineMin: number, o: ReviewTextOpts = {}, bodyMax: number = INTERACTIVE_BODY_MAX, textMax: number = PRICE_TEXT_LIMIT): ReviewTexts {
  const rows = groups.flatMap((g) => g.rows);
  const title = reviewTitle(day, o);
  // an item is one entry: an outlier's second line never leaves its item
  const table = groups.flatMap((g, i) => [...(groups.length > 1 ? [...(i ? [""] : []), `— ${g.title} —`] : []), ...g.rows.map((r) => reviewItemLines(r).join("\n"))]);
  const tail = choiceLines(rows, deadlineMin, { late: o.late });
  const changed = o.update?.changed.length ? [`تغيّر: ${o.update.changed.join("، ")}.`] : [];
  const whole = [title, PROFIT_NOTE, ...changed, "", ...table, "", ...tail].join("\n");
  if (whole.length <= bodyMax) return { texts: [], body: whole };
  const room = Math.max(200, textMax - title.length - 16);
  const chunks: string[][] = [[]];
  // the first part carries the note (and what changed) under its title: they are in its room
  let size = [PROFIT_NOTE, ...changed].reduce((n, l) => n + l.length + 1, 0);
  // the choice lines by name close the table's text (a blank line before them)
  for (const line of [...table, "", ...tail.flatMap((t) => wrapList(t, room))]) {
    if (size + line.length + 1 > room && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }
    // a part never opens on a blank line
    if (!line && !chunks[chunks.length - 1].length) continue;
    chunks[chunks.length - 1].push(line);
    size += line.length + 1;
  }
  const n = chunks.length;
  return {
    texts: chunks.map((part, i) => [n > 1 ? `${title} (${i + 1}/${n})` : title, ...(i === 0 ? [PROFIT_NOTE, ...changed] : []), "", ...part].join("\n")),
    body: [title, `${rows.length} ${itemsWord(rows.length)} في الجدول أعلاه.`, ...choiceLines(rows, deadlineMin, { late: o.late, compact: true })].join("\n").slice(0, bodyMax),
  };
}

export function reviewButtons(dayId: number, ver: number, test = false): Array<{ id: string; title: string }> {
  const p = test ? "prvt" : "prv";
  return [
    { id: `${p}_a_${dayId}_${ver}`, title: REVIEW_BUTTON_ALL },
    { id: `${p}_r_${dayId}_${ver}`, title: REVIEW_BUTTON_FORM },
    { id: `${p}_n_${dayId}_${ver}`, title: REVIEW_BUTTON_NONE },
  ];
}

// ---------------------------------------------------------------- the snapshot (KV)

/** The review as it was last sent: its buttons decide by it, never by what changed after it. */
export interface ReviewSnapshot {
  v: 1;
  day: string;
  dayId: number;
  /** 1, 2, …: a button of an older version no longer decides. */
  ver: number;
  at: number;
  rows: ReviewRow[];
  /** The signatures of the rows that waited for a decision: a new one sends the review again. */
  sigs: string[];
  test?: boolean;
}
export const snapshotKey = (dayId: number, test = false): string => `${test ? "prvt" : "prv"}:v1:${dayId}`;
const owedKey = (day: string): string => `prv_owed:v1:${day}`;
/** What a waiting row shows: a change of any of it is a new review — § 55: its full cost too («ربحنا» is made from it). */
export const rowSig = (r: ReviewRow): string => [r.lineId, r.purchase, r.market, r.proposal.kind, r.proposal.price, r.proposal.outlier ? 1 : 0, r.fullCost || 0].join(":");

export async function readSnapshot(env: Env, dayId: number, test = false): Promise<ReviewSnapshot | null> {
  try {
    const raw = await env.MSG_DEDUP.get(snapshotKey(dayId, test));
    const s = raw ? (JSON.parse(raw) as ReviewSnapshot) : null;
    return s && s.v === 1 && Array.isArray(s.rows) ? s : null;
  } catch { return null; }
}
async function writeSnapshot(env: Env, s: ReviewSnapshot): Promise<void> {
  await env.MSG_DEDUP.put(snapshotKey(s.dayId, !!s.test), JSON.stringify(s), { expirationTtl: DAY_TTL });
}

async function aboveSetting(env: Env, day: string): Promise<AboveSuggested> {
  try {
    return (await readPricingSettings(env, day))?.aboveSuggested ?? "market";
  } catch (e) {
    console.warn("[price-review] the settings could not be read — «بسعر السوق»", (e as Error)?.message);
    return "market";
  }
}

const ownerOf = (env: Env): string => waDigits(String(env.OWNER_WHATSAPP ?? ""));
/** «صنف» / «أصناف» / «صنفاً», after its number. */
export const itemsWord = (n: number): string => (n === 1 ? "صنف" : n >= 3 && n <= 10 ? "أصناف" : "صنفاً");
/**
 * One message to Baraa, inside his window only (never held: the review is built again at his next
 * message). Without the cron's auto-send key — as the publication's sends: the review has its own
 * idempotency (the version's claim, the snapshot), and an attempt Meta failed must go at the next tick
 * (the key would refuse the same text for the rest of the day).
 */
async function say(env0: Env, content: GwSession, test: boolean, ctx?: ExecutionContext): Promise<boolean> {
  const env = { ...env0, AUTO_SEND_JOB: undefined } as Env;
  const r = await sendViaGateway(env, {
    purpose: test ? REVIEW_TEST_PURPOSE : REVIEW_PURPOSE, to: ownerOf(env), content,
    noHold: true, noHoldReason: "مراجعة الأسعار تُرسل داخل نافذة براء فقط", ctx,
  });
  return gatewayDecision(r)?.action === "session";
}

// ---------------------------------------------------------------- ب: the one message

export interface ReviewSendReport {
  action: "outside" | "no_owner" | "no_day" | "no_draft" | "none" | "decided" | "sent_before" | "window_closed" | "in_progress" | "not_sent" | "sent";
  ver?: number;
  /** The rows that are NOT published without his decision (no market price, a loss, ⚠️, no purchase price). */
  count?: number;
  /** The plain-text parts that carried the table. */
  parts?: number;
  /** utak_owner_price_review_v1, when his window was closed. */
  review?: string;
}

/**
 * The day's review to Baraa: once, and again only when a waiting row changed.
 * From exceptionsFromMinutes until the publication time on a draft day; after
 * it only on a day that was NOT published and whose review never reached him
 * (his window was closed): then an approval publishes at once. His window
 * closed: nothing is held — the review is owed, and built at his next message.
 */
export async function notifyPriceReviewMessage(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<ReviewSendReport> {
  const day = riyadhDateKey(new Date(now));
  const m = riyadhMinutes(new Date(now));
  const dl = pricesDeadlineMinutes(env).minutes;
  if (m < exceptionsFromMinutes(env)) return { action: "outside" };
  const owner = ownerOf(env);
  if (!owner) return { action: "no_owner" };
  const late = m >= dl;
  const owed = async (): Promise<boolean> => { try { return !!(await env.MSG_DEDUP.get(owedKey(day))); } catch { return false; } };
  const settle = async (): Promise<void> => { try { await env.MSG_DEDUP.delete(owedKey(day)); } catch { /* expires on its own */ } };
  if (late && !(await owed())) return { action: "outside" };
  const rec = await readDay(env, day);
  if (!rec) return { action: "no_day" };
  if (!late && rec.x_state !== "draft") return { action: "no_draft" };
  if (late && rec.x_state !== "missed") {
    // still a draft at the publication time: the deadline's step of this same tick decides it — the review stays
    // owed (a day it marks «فات الموعد» sends it at his next message). Approved or published: nothing left to review.
    if (rec.x_state !== "draft") await settle();
    return { action: "outside" };
  }
  const rows = await dayReviewRows(env, rec);
  if (!rows.length) return { action: "none" };
  const waiting = rows.filter((r) => !r.decision);
  if (!waiting.length) { await settle(); return { action: "decided" }; }
  // the rows the rule never publishes by itself: what «بانتظار قرارك» counts
  const needing = waiting.filter((r) => !r.proposal.auto).length;
  const prev = await readSnapshot(env, rec.id);
  const known = new Set(prev?.sigs ?? []);
  const changed = waiting.filter((r) => !known.has(rowSig(r)));
  if (prev && !changed.length) return { action: "sent_before", ver: prev.ver, count: needing };
  if (!(await readWindow(env, owner, now)).open) {
    // nothing is held: the review is owed to him, and — while an item needs his decision — utak_owner_price_review_v1
    // says so (once a day, before the publication). A day that publishes whole by itself wakes nobody.
    try { await env.MSG_DEDUP.put(owedKey(day), "1", { expirationTtl: DAY_TTL }); } catch { /* the next tick marks it */ }
    let review: string | null = null;
    if (!late && needing > 0) {
      const { notifyPriceReview } = await import("./owner-window");
      review = await notifyPriceReview(env, day, needing, now).catch((e) => {
        console.warn("[price-review] the review template failed", (e as Error)?.message);
        return "error";
      });
    }
    return { action: "window_closed", count: needing, ...(review ? { review } : {}) };
  }
  const ver = (prev?.ver ?? 0) + 1;
  // the tick and his own message may both find the same review to send: one of them sends it
  const claim = await claimButton(env, `prv_send:${rec.id}:${ver}`, DAY_TTL);
  if (!claim.claimed) return { action: "in_progress", ver };
  try {
    const built = buildReviewTexts(day, await reviewGroups(env, rows), dl, {
      late,
      ...(prev ? { update: { at: hhmm(m), changed: changed.map((r) => r.name) } } : {}),
    });
    for (const part of built.texts) {
      if (!(await say(env, textContent(part), false, ctx))) { await releaseButton(env, claim); return { action: "not_sent", ver }; }
    }
    if (!(await say(env, buttonsContent(built.body, reviewButtons(rec.id, ver)), false, ctx))) { await releaseButton(env, claim); return { action: "not_sent", ver }; }
    await writeSnapshot(env, { v: 1, day, dayId: rec.id, ver, at: now, rows, sigs: waiting.map(rowSig) });
    await settle();
    await finishButton(env, claim, DAY_TTL);
    console.log(`[price-review] ${day} v${ver}: ${rows.length} item(s), ${needing} need a decision, ${built.texts.length} text part(s)`);
    return { action: "sent", ver, count: needing, parts: built.texts.length };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/**
 * Baraa just wrote or tapped (his window is open): the review owed to him goes
 * now, built from the day as it is. False when none was owed. Never throws.
 */
export async function sendOwedPriceReview(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<boolean> {
  try {
    if (!(await env.MSG_DEDUP.get(owedKey(riyadhDateKey(new Date(now)))))) return false;
    const r = await notifyPriceReviewMessage(env, now, ctx);
    console.log(`[price-review] owed review at his message: ${r.action}`);
    return r.action === "sent";
  } catch (e) {
    console.warn("[price-review] the owed review failed", (e as Error)?.message);
    return false;
  }
}

// ---------------------------------------------------------------- the decisions

/** What a decision writes on its line: the fields the engine and «📊 اليوم» read (x_decision, the price fixed for it, the status). */
export function decisionVals(kind: OutcomeKind, price: number, now: number): Record<string, unknown> {
  if (kind === "skip") return { x_decision: "skip", x_status: "unpublished", x_reason: DECISION_REASON.skip, x_sale_price: 0, x_excluded: true, x_decided_at: nowOdoo(now) };
  return { x_decision: kind, x_manual_price: price, x_manual_for: kind, x_status: "manual", x_reason: DECISION_REASON[kind], x_sale_price: price, x_excluded: false, x_decided_at: nowOdoo(now) };
}
const sameDecision = (l: DayLine, kind: OutcomeKind, price: number): boolean =>
  l.x_decision === kind && (kind === "skip" || (l.x_manual_for === kind && Math.abs((Number(l.x_manual_price) || 0) - price) < 0.005));

export interface DecisionEntry { lineId: number; kind: OutcomeKind; price: number }
/** Each decision on its line (a line that already carries it is not written again). Returns how many were written. */
async function writeDecisions(env: Env, dayId: number, entries: DecisionEntry[], now: number): Promise<number> {
  const lines = new Map((await readLines(env, dayId)).map((l) => [l.id, l]));
  let written = 0;
  for (const e of entries) {
    const l = lines.get(e.lineId);
    if (!l || l.x_reason === OUT_OF_CATALOG_REASON || sameDecision(l, e.kind, e.price)) continue;
    await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals: decisionVals(e.kind, e.price, now) });
    written++;
  }
  if (written) await boardAfterDecision(env, dayId, now);
  return written;
}

interface Decidable { day?: DayRecord; why?: string; late?: boolean }
/** May a decision still be taken on this day? Today's alone, and not once it is approved or published. */
async function decidableDay(env: Env, dayId: number, now: number): Promise<Decidable> {
  const [day] = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "read", { ids: [dayId], fields: DAY_FIELDS });
  if (!day) return { why: "ما لقينا سجل أسعار هذا اليوم." };
  if (day.x_date !== riyadhDateKey(new Date(now))) return { why: `هذه مراجعة أسعار ${arabicDate(day.x_date)}، لا أسعار اليوم: لم يُسجَّل منها شيء.` };
  if (day.x_state === "published") return { why: `نُشرت أسعار ${arabicDate(day.x_date)}، فلا قرار عليها الآن. التفاصيل في ${PLACE_TODAY}.` };
  if (day.x_state === "approved") return { why: `أسعار ${arabicDate(day.x_date)} معتمدة ويجري نشرها الآن، فلا قرار عليها.` };
  // today's publication time has passed (the day is «فات الموعد», or the tick has not closed it yet)
  return { day, late: riyadhMinutes(new Date(now)) >= pricesDeadlineMinutes(env).minutes };
}

export type LateOutcome = "published" | "nothing" | "failed";
/**
 * § 54 ج — an approval after the publication time: the day is published at
 * once, by the path of «نشر المعتمد الآن» (the engine's last word, the
 * approval, publishPriceDay). Nothing approved: nothing is published.
 */
async function publishLate(env: Env, day: DayRecord, now: number, ctx?: ExecutionContext): Promise<LateOutcome> {
  try {
    await refreshPriceDay(env, { day: day.x_date, now, force: true });
  } catch (e) {
    console.warn(`[price-review] ${day.x_date}: the refresh before the late publication failed`, (e as Error)?.message);
  }
  if (!(await readLines(env, day.id)).some(isPublishable)) return "nothing";
  await call(env, PRICE_DAY_MODEL, "write", { ids: [day.id], vals: { x_state: "approved", x_approved_at: nowOdoo(now), x_approved_by: false } });
  const r = await publishPriceDay(env, day.id, { ctx, now, approvedVia: "اعتماد براء من واتساب بعد الموعد" });
  console.log(`[price-review] ${day.x_date}: late publication → ${r.action}`);
  return r.action === "published" ? "published" : "failed";
}

const PUBLISH_LABEL: Record<OutcomeKind, string> = { market: "سعر السوق", profit: "المقترح", edit: "سعر يدوي", skip: "" };
export interface ConfirmOpts { deadline: string; late?: LateOutcome; notes?: string[]; test?: boolean; head?: string }
/** «متوسط الربح للكرتون: +1.75» — the mean of «ربحنا» over the items that are published (each item once: no quantity is known yet); "" with none. */
export function averageProfitLine(rows: ReviewRow[]): string {
  const profits = rows.map((r) => profitAt(r, rowOutcome(r).price)).filter((p): p is number => p !== null);
  return profits.length ? `متوسط الربح للكرتون: ${signed(profits.reduce((a, b) => a + b, 0) / profits.length)}` : "";
}
/**
 * The confirmation: what will be published (or was, after the time) — § 55:
 * each item with its price and «ربحنا» signed, then «متوسط الربح للكرتون» — what
 * will not, and a ⚠️ line for a manual price below «بدون خسارة».
 */
export function confirmationText(day: string, rows: ReviewRow[], o: ConfirmOpts): string {
  const out = rows.filter((r) => (r.decision ? rowOutcome(r).kind !== "skip" : r.proposal.auto));
  const stay = rows.filter((r) => !out.includes(r));
  const lead = o.late === "published" ? `نُشر الآن (بعد موعد ${o.deadline}، بمسار «نشر المعتمد الآن»):`
    : o.late === "failed" ? `فات موعد ${o.deadline}، وتعذّر النشر الآن: راجع ${PLACE_TODAY}. المعتمد:`
    : o.late === "nothing" ? "" : `سيُنشر ${o.deadline}:`;
  const below = rows.filter((r) => r.decision === "edit" && r.breakEven > 0 && r.decidedPrice > 0 && r.decidedPrice < r.breakEven - 0.0001);
  return [
    o.head ?? `${o.test ? `${REVIEW_TEST_MARK} — ` : ""}✅ سُجّلت قراراتك على أسعار ${weekdayAr(day)} ${arabicDate(day)}.`,
    ...(out.length ? [lead, ...out.map((r) => {
      const k = rowOutcome(r), profit = profitAt(r, k.price);
      return `• ${r.name} — ${money(k.price)} ر.س (${PUBLISH_LABEL[k.kind]}${r.decision ? "" : "، تلقائياً"})${profit === null ? "" : ` · ربحنا ${signed(profit)}`}`;
    }), averageProfitLine(out)] : [o.late ? `فات موعد ${o.deadline}، ولا صنف للنشر: لم يُنشر شيء.` : "لا صنف للنشر اليوم."]).filter(Boolean),
    stay.length ? `لا يُنشر: ${stay.map((r) => `${r.name}${r.decision ? "" : " (بلا قرار)"}`).join("، ")}.` : "",
    ...below.map((r) => `⚠️ ${r.name}: السعر اليدوي ${money(r.decidedPrice)} أقل من سعر بدون خسارة ${money(r.breakEven)}.`),
    ...(o.notes ?? []),
    o.test ? "(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)" : "",
  ].filter(Boolean).join("\n");
}

/** The day after the decisions: its confirmation, and — after the time — its publication. */
async function confirmDecisions(env: Env, d: Required<Pick<Decidable, "day">> & { late?: boolean }, now: number, notes: string[], ctx?: ExecutionContext): Promise<void> {
  const day = d.day;
  const late = d.late ? await publishLate(env, day, now, ctx) : undefined;
  const rows = await dayReviewRows(env, day);
  const text = confirmationText(day.x_date, rows, { deadline: hhmm(pricesDeadlineMinutes(env).minutes), late, notes });
  // «✏️ عدّل» while the day can still be decided
  const again = late === "published" ? null : [{ id: `prv_r_${day.id}_0`, title: REVIEW_BUTTON_EDIT }];
  await say(env, again && text.length <= INTERACTIVE_BODY_MAX ? buttonsContent(text, again) : textContent(text.slice(0, 4000)), false, ctx);
}

const STALE_TEXT = (at: string): string => `وصلتك بعد هذه الرسالة نسخة أحدث من مراجعة أسعار اليوم (${at}): الأرقام تغيّرت، فالقرار من أزرارها هي.`;
const riyadhClock = (ms: number): string => hhmm(riyadhMinutes(new Date(ms)));

/**
 * A tap on one of the review's buttons. Everything it says goes from here;
 * the action is returned for the log.
 *   «✅ نفّذ المقترح» — every row still waiting takes its proposed decision,
 *     as that message showed it (an older message than the last sent decides
 *     nothing);
 *   «✏️ عدّل» — the form, built from the day as it is now;
 *   «⛔ لا تنشر شيء» — «لا تنشر» on every row.
 */
export async function handlePriceReviewButton(env: Env, payload: string, now: number = Date.now(), ctx?: ExecutionContext): Promise<string> {
  const mm = REVIEW_PAYLOAD.exec(String(payload ?? ""));
  if (!mm) return "";
  const test = mm[1] === "t", op = mm[2], dayId = Number(mm[3]), ver = Number(mm[4]);
  const tell = async (text: string): Promise<void> => { await say(env, textContent(text), test, ctx); };
  if (test) return handleTestButton(env, op, dayId, now, ctx);
  const d = await decidableDay(env, dayId, now);
  if (d.why || !d.day) { await tell(d.why ?? ""); return "refused"; }
  const day = d.day;
  if (op === "r") {
    const r = await sendReviewForm(env, day, now, { ctx });
    if (!r.sent) await tell(r.reason === "no_items" ? "لا أصناف في أسعار اليوم للمراجعة." : `تعذّر فتح نموذج المراجعة الآن. جرّب بعد قليل، أو قرّر من ${PLACE_TODAY}.`);
    return r.sent ? "form" : `form_${r.reason}`;
  }
  const snap = await readSnapshot(env, dayId);
  if (!snap) { await tell(`انتهت صلاحية هذه الرسالة: اضغط «${REVIEW_BUTTON_FORM}»، أو قرّر من ${PLACE_TODAY}.`); return "no_snapshot"; }
  if (snap.ver !== ver) { await tell(STALE_TEXT(riyadhClock(snap.at))); return "stale"; }
  const claim = await claimButton(env, `prv_${op}:${dayId}:${ver}`, DAY_TTL);
  if (!claim.claimed) { await tell("سُجّل قرارك من هذه الرسالة مسبقاً ✅"); return "duplicate"; }
  try {
    const lines = new Map((await readLines(env, dayId)).map((l) => [l.id, l]));
    // «نفّذ المقترح»: the rows still waiting, each at what the message showed; «لا تنشر شيء»: every row
    const entries: DecisionEntry[] = op === "n"
      ? snap.rows.map((r) => ({ lineId: r.lineId, kind: "skip" as const, price: 0 }))
      : snap.rows.filter((r) => !lines.get(r.lineId)?.x_decision).map((r) => ({ lineId: r.lineId, kind: r.proposal.kind, price: r.proposal.price }));
    const written = await writeDecisions(env, dayId, entries, now);
    await finishButton(env, claim, DAY_TTL);
    if (op === "n") {
      const text = `⛔ لن تُنشر أسعار اليوم (${snap.rows.length} ${itemsWord(snap.rows.length)}): سُجّل «لا تنشر» عليها كلها.${d.late ? "" : ` للتراجع قبل ${hhmm(pricesDeadlineMinutes(env).minutes)}: «${REVIEW_BUTTON_EDIT}».`}`;
      await say(env, buttonsContent(text, [{ id: `prv_r_${dayId}_0`, title: REVIEW_BUTTON_EDIT }]), false, ctx);
      return `none:${written}`;
    }
    await confirmDecisions(env, { day, late: d.late }, now, written ? [] : ["كل الأصناف كان عليها قرار مسبق: لم يتغير شيء."], ctx);
    return `all:${written}`;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- ج: the form

export interface ReviewFormItem {
  slot: number;
  lineId: number;
  name: string;
  /** The list's label: the item's name (20 characters at Meta). */
  label: string;
  /** «شراء X · سوق Y · ربحنا بسعر السوق: ±a» (an outlier's warning first). */
  info: string;
  /** § 55 — «سعرنا المقترح P = أعلى/أقل من السوق بـ d (±e%)», or «… لا سعر سوق للمقارنة». */
  info2?: string;
  options: Array<{ id: string; title: string }>;
  /** The option the list opens on, and the manual price the field opens with. */
  selected: string;
  manual: string;
  /** What «بالمقترح» and «بسعر السوق» publish at, as the form showed them (0 = not offered). */
  suggested: number;
  sale: number;
  breakEven: number;
  /** § 55 — what «ربحنا» of a choice is made from (profitAt); absent on a form sent before § 55. */
  purchase?: number;
  fullCost?: number;
  vatPct?: number | null;
}
const chars = (s: string): string[] => [...String(s ?? "")];
const cut = (s: string, max: number): string => { const c = chars(s); return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join(""); };

/** «شراء 22 (25.30 شامل) · سوق 28 · ربحنا بسعر السوق: −0.74»; no market price: «شراء 12 (13.80 شامل) · لا سعر سوق». An outlier: what moved, first. */
export function reviewInfo(r: ReviewRow): string {
  const numbers = [purchaseText(r) || "لا سعر شراء", marketText(r), r.sale > 0 ? profitText(r, "market", r.sale) : ""].filter(Boolean).join(" · ");
  return cut([...movedLines(r), numbers].join(" · "), REVIEW_INFO_MAX);
}
/** «+12.5%», «−4.7%», «+15%»: one decimal at most. */
const signedPct = (x: number): string => {
  const n = Math.round(x * 10) / 10;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Number.isInteger(n) ? Math.abs(n) : Math.abs(n).toFixed(1)}%`;
};
/**
 * § 55 — where our suggested price stands against the market as observed:
 * «سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)», «… = أقل من السوق بـ
 * 3.50 (−4.7%)», «… = سعر السوق»; no market price: «سعرنا المقترح 19.50 — لا سعر
 * سوق للمقارنة»; no suggested price: «لا سعر مقترح».
 */
export function reviewCompare(r: ReviewRow): string {
  if (!(r.suggested > 0)) return "لا سعر مقترح";
  const lead = `سعرنا المقترح ${money(r.suggested)}`;
  if (!(r.market > 0)) return `${lead} — لا سعر سوق للمقارنة`;
  const d = round2(r.suggested - r.market);
  if (d === 0) return `${lead} = سعر السوق`;
  return `${lead} = ${d > 0 ? "أعلى" : "أقل"} من السوق بـ ${money(Math.abs(d))} (${signedPct((d / r.market) * 100)})`;
}
/** The first text that fits Meta's limit of an option's title (never a number cut in the middle). */
const fits = (candidates: string[], max: number): string => candidates.find((c) => chars(c).length <= max) ?? cut(candidates[candidates.length - 1], max);
/** «بالمقترح 31.50 (ربح +2.30)», «بسعر السوق 28 (ربح −0.74)»: a choice with its price and its own profit. */
function pricedOption(r: Pick<ReviewRow, "purchase" | "fullCost" | "vatPct">, lead: string, price: number): string {
  const p = profitAt(r, price), base = `${lead} ${money(price)}`;
  return p === null ? cut(base, REVIEW_OPTION_MAX) : fits([`${base} (ربح ${signed(p)})`, `${base} (${signed(p)})`, base], REVIEW_OPTION_MAX);
}
/** The choices of an item, each with its profit: «بسعر السوق» only with a market price, «بالمقترح» only with a suggested one. */
export function reviewOptions(r: ReviewRow): Array<{ id: string; title: string }> {
  return [
    ...(r.suggested > 0 ? [{ id: "profit", title: pricedOption(r, "بالمقترح", r.suggested) }] : []),
    ...(r.sale > 0 ? [{ id: "market", title: pricedOption(r, "بسعر السوق", r.sale) }] : []),
    { id: "skip", title: "لا تنشر" },
    { id: "manual", title: "سعر يدوي" },
  ];
}
function formItem(r: ReviewRow, slot: number): ReviewFormItem {
  const options = reviewOptions(r);
  // the list opens on Baraa's own decision when he has one, else on the proposed one
  const o = rowOutcome(r);
  const want = o.kind === "edit" ? "manual" : o.kind;
  const selected = options.some((x) => x.id === want) ? want : options.some((x) => x.id === r.proposal.kind) ? r.proposal.kind : "skip";
  return {
    slot, lineId: r.lineId, name: r.name, label: cut(r.name, REVIEW_LABEL_MAX), info: reviewInfo(r), info2: cut(reviewCompare(r), REVIEW_INFO_MAX), options, selected,
    manual: o.kind === "edit" && o.price > 0 ? money(o.price) : "", suggested: r.suggested, sale: r.sale, breakEven: r.breakEven,
    purchase: r.purchase, fullCost: r.fullCost, vatPct: r.vatPct,
  };
}

export interface ReviewFormItems { items: ReviewFormItem[]; pages: string[]; left: string[] }
/** The items on their pages: by category, ten a page; a longer category continues on the next («فواكه (2)»). Pure. */
export function reviewFormItems(groups: ReviewGroup[]): ReviewFormItems {
  const pages: Array<{ title: string; rows: ReviewRow[] }> = [];
  for (const g of groups) {
    for (let i = 0; i < g.rows.length; i += REVIEW_FLOW_PAGE_SLOTS) {
      pages.push({ title: i ? `${g.title} (${i / REVIEW_FLOW_PAGE_SLOTS + 1})` : g.title, rows: g.rows.slice(i, i + REVIEW_FLOW_PAGE_SLOTS) });
    }
  }
  const used = pages.slice(0, REVIEW_FLOW_PAGES);
  return {
    items: used.flatMap((p, k) => p.rows.map((r, j) => formItem(r, k * REVIEW_FLOW_PAGE_SLOTS + j + 1))),
    pages: used.map((p) => p.title),
    left: pages.slice(REVIEW_FLOW_PAGES).flatMap((p) => p.rows.map((r) => r.name)),
  };
}

export type ReviewFormData = Record<string, string | boolean | Array<{ id: string; title: string }>>;
/** The 431 keys of the first page: each page's heading and whether a page follows it, and x/y/l/o/s/i/v of every slot. */
export function reviewFormData(pages: string[], items: ReviewFormItem[]): ReviewFormData {
  const data: ReviewFormData = {};
  for (let k = 1; k <= REVIEW_FLOW_PAGES; k++) {
    data[`t${k}`] = pages[k - 1] ?? "-";
    if (k < REVIEW_FLOW_PAGES) data[`m${k}`] = k < pages.length;
  }
  for (let n = 1; n <= REVIEW_FLOW_SLOTS; n++) {
    const it = items.find((x) => x.slot === n);
    data[`x${n}`] = it ? it.info : "-";
    data[`y${n}`] = it ? it.info2 ?? "-" : "-";
    data[`l${n}`] = it ? it.label : "-";
    data[`o${n}`] = it ? it.options : [{ id: "skip", title: "-" }];
    data[`s${n}`] = it ? it.selected : "skip";
    data[`i${n}`] = it ? it.manual : "";
    data[`v${n}`] = !!it;
  }
  return data;
}

export interface ReviewFormRecord {
  v: 1;
  token: string;
  day: string;
  dayId: number;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  items: ReviewFormItem[];
  pages: string[];
  createdAt: number;
  test?: boolean;
}
export const reviewFormKey = (token: string): string => `prform:v1:${token}`;
export const isReviewFormToken = (token: string): boolean => String(token ?? "").startsWith("pr1.");
export function newReviewFormToken(day: string): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pr1.${day.replace(/-/g, "")}.${rand}`;
}
export async function readReviewFormToken(env: Env, token: string): Promise<ReviewFormRecord | null> {
  if (!isReviewFormToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(reviewFormKey(token));
    const rec = raw ? (JSON.parse(raw) as ReviewFormRecord) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}

export function reviewFormSession(text: string, token: string, data: ReviewFormData, cta: string = REVIEW_FLOW_CTA): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, INTERACTIVE_BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: REVIEW_FLOW_ID,
            flow_cta: cta,
            flow_action: "navigate",
            flow_action_payload: { screen: REVIEW_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

export const reviewFormText = (day: string, n: number, left: string[], test = false): string => [
  `${test ? `${REVIEW_TEST_MARK} — ` : ""}✏️ عدّل أسعار ${weekdayAr(day)} ${arabicDate(day)}: ${n} ${itemsWord(n)}.`,
  `القرار المقترح مختار مسبقاً لكل صنف، وجنب كل خيار ربحه للكرتون. غيّر ما تريد، واكتب «السعر اليدوي» مع «سعر يدوي» فقط، ثم «اعتمد» في آخر صفحة.`,
  left.length ? `خارج النموذج (يتسع لـ ${REVIEW_FLOW_SLOTS}): ${left.join("، ")} — تبقى على قرارها المقترح.` : "",
].filter(Boolean).join("\n");

/** The review form of a day, built from its lines as they are now. `rows`: the trial's own rows. */
export async function sendReviewForm(env: Env, day: Pick<DayRecord, "id" | "x_date">, now: number, o: { ctx?: ExecutionContext; test?: boolean; rows?: ReviewRow[] } = {}): Promise<{ sent: boolean; reason?: string; token?: string }> {
  const to = ownerOf(env);
  if (!to) return { sent: false, reason: "no_owner" };
  const rows = o.rows ?? await dayReviewRows(env, day);
  const built = reviewFormItems(await reviewGroups(env, rows));
  if (!built.items.length) return { sent: false, reason: "no_items" };
  const rec: ReviewFormRecord = { v: 1, token: newReviewFormToken(day.x_date), day: day.x_date, dayId: day.id, to, items: built.items, pages: built.pages, createdAt: now, ...(o.test ? { test: true } : {}) };
  await env.MSG_DEDUP.put(reviewFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const pages = built.pages.map((t) => `${o.test ? `${REVIEW_TEST_MARK} — ` : ""}${t}`);
  const ok = await say(env, reviewFormSession(reviewFormText(day.x_date, built.items.length, built.left, o.test), rec.token, reviewFormData(pages, built.items)), !!o.test, o.ctx);
  if (!ok) {
    try { await env.MSG_DEDUP.delete(reviewFormKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: "not_sent" };
  }
  return { sent: true, token: rec.token };
}

export interface ReviewFormEntries {
  decisions: Array<DecisionEntry & { item: ReviewFormItem }>;
  /** «سعر يدوي» without a price above zero: nothing is written for the item. */
  noPrice: ReviewFormItem[];
}
/**
 * Each slot's choice against its item — the token's items, never the client's
 * data: d<slot> is an option the item was offered (anything else, or nothing:
 * the option the list opened on), and p<slot> is read with «سعر يدوي» alone.
 * The prices of «بالمقترح» / «بسعر السوق» are the ones the form showed.
 */
export function readReviewValues(rec: Pick<ReviewFormRecord, "items">, values: Record<string, unknown>): ReviewFormEntries {
  const out: ReviewFormEntries = { decisions: [], noPrice: [] };
  for (const item of rec.items) {
    const raw = String(values[`d${item.slot}`] ?? "");
    const choice = item.options.some((o) => o.id === raw) ? raw : item.selected;
    if (choice === "manual") {
      const price = parseFlowNumber(values[`p${item.slot}`]);
      if (typeof price === "number") out.decisions.push({ item, lineId: item.lineId, kind: "edit", price });
      else out.noPrice.push(item);
    } else if (choice === "profit") out.decisions.push({ item, lineId: item.lineId, kind: "profit", price: item.suggested });
    else if (choice === "market") out.decisions.push({ item, lineId: item.lineId, kind: "market", price: item.sale });
    else out.decisions.push({ item, lineId: item.lineId, kind: "skip", price: 0 });
  }
  return out;
}

export const REVIEW_FORM_UNKNOWN_TEXT = `هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اضغط «${REVIEW_BUTTON_FORM}» في رسالة المراجعة لنموذج جديد.`;
export const REVIEW_FORM_USED_TEXT = `هذا النموذج سبق اعتماده ✅ ولم يُسجَّل مرة ثانية. للتعديل اضغط «${REVIEW_BUTTON_EDIT}».`;
const noPriceNote = (items: ReviewFormItem[]): string[] => (items.length
  ? [`⚠️ ما انحسب (اخترت «سعر يدوي» بلا سعر أكبر من صفر): ${items.map((i) => i.name).join("، ")} — بقي على حاله.`] : []);

/** A reply of the review form (nfm_reply): read by its token, written on the lines, confirmed — and published when the time has passed. */
export async function handlePriceReviewReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<{ action: string; written?: number }> {
  const from = waDigits(msg.from);
  const rec = await readReviewFormToken(env, msg.flow?.token ?? "");
  const test = !!rec?.test;
  const tell = async (text: string): Promise<void> => { await say(env, textContent(text), test, ctx); };
  // an unknown token, or one sent to another number: nothing is read from it (and only Baraa is ever answered)
  if (!rec || rec.to !== from || from !== ownerOf(env)) {
    console.warn(`[price-review] reply with no token of this number from=${from.slice(-4)}`);
    if (from === ownerOf(env)) await tell(REVIEW_FORM_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const entries = readReviewValues(rec, msg.flow?.values ?? {});
  if (rec.test) {
    await tell(testFormAnswer(rec, entries));
    return { action: "test" };
  }
  const d = await decidableDay(env, rec.dayId, now);
  if (d.why || !d.day) { await tell(d.why ?? ""); return { action: "refused" }; }
  // a token is read once
  const claim = await claimButton(env, `prform_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed) { await tell(REVIEW_FORM_USED_TEXT); return { action: "duplicate" }; }
  try {
    const written = await writeDecisions(env, rec.dayId, entries.decisions, now);
    await finishButton(env, claim, TOKEN_TTL);
    await confirmDecisions(env, { day: d.day, late: d.late }, now, noPriceNote(entries.noPrice), ctx);
    return { action: d.late ? "late" : "decided", written };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- the trial to Baraa

const TEST_TAIL = "(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)";
/** « · ربحنا +1.13» of a form's item at a price ("" on a form sent before § 55). */
function profitNote(item: ReviewFormItem, price: number): string {
  const p = profitAt({ purchase: item.purchase ?? 0, fullCost: item.fullCost ?? 0, vatPct: item.vatPct ?? null }, price);
  return p === null ? "" : ` · ربحنا ${signed(p)}`;
}
function testFormAnswer(rec: ReviewFormRecord, e: ReviewFormEntries): string {
  const line = (x: ReviewFormEntries["decisions"][number]): string =>
    `• ${x.item.name} — ${x.kind === "skip" ? "لا تنشر" : `${money(x.price)} ر.س (${PUBLISH_LABEL[x.kind]})${profitNote(x.item, x.price)}`}${x.kind === "edit" && x.item.breakEven > 0 && x.price < x.item.breakEven - 0.0001 ? ` ⚠️ أقل من سعر بدون خسارة ${money(x.item.breakEven)}` : ""}`;
  return [
    `${REVIEW_TEST_MARK} — وصلت قراراتك على أسعار ${weekdayAr(rec.day)} ${arabicDate(rec.day)}:`,
    ...e.decisions.map(line),
    ...noPriceNote(e.noPrice),
    TEST_TAIL,
  ].join("\n");
}

/** A tap on the trial's buttons: answered, and nothing else — no decision, no publication. */
async function handleTestButton(env: Env, op: string, dayId: number, now: number, ctx?: ExecutionContext): Promise<string> {
  const tell = async (text: string): Promise<void> => { await say(env, textContent(text), true, ctx); };
  const snap = await readSnapshot(env, dayId, true);
  if (!snap) { await tell(`${REVIEW_TEST_MARK} — انتهت هذه التجربة.`); return "test_gone"; }
  if (op === "r") {
    const r = await sendReviewForm(env, { id: snap.dayId, x_date: snap.day }, now, { ctx, test: true, rows: snap.rows });
    if (!r.sent) await tell(`${REVIEW_TEST_MARK} — تعذّر فتح نموذج المراجعة الآن.`);
    return r.sent ? "test_form" : "test_form_failed";
  }
  if (op === "n") {
    await tell(`${REVIEW_TEST_MARK} — ⛔ كان سيُسجَّل «لا تنشر» على ${snap.rows.length} ${itemsWord(snap.rows.length)}، ولا يُنشر شيء اليوم.\n${TEST_TAIL}`);
    return "test_none";
  }
  // «نفّذ المقترح»: every row at its proposed decision, as the day would be confirmed
  const decided = snap.rows.map((r) => ({ ...r, decision: (r.proposal.kind === "skip" ? "skip" : r.proposal.kind) as Decision, decidedPrice: r.proposal.price }));
  await tell(confirmationText(snap.day, decided, { deadline: hhmm(pricesDeadlineMinutes(env).minutes), test: true }));
  return "test_all";
}

/**
 * ONE review to Baraa's own number, marked «🧪 تجربة», with today's lines as
 * they stand (the last real day when today has none), every row shown as it
 * arrives at 04:00 — waiting for his decision. Only while his window is open
 * (nothing held), once a day. Its buttons and its form are answered and write
 * nothing in Odoo; nothing is published.
 */
export async function sendPriceReviewTest(env: Env, now: number = Date.now()): Promise<{ sent: boolean; reason?: string; day?: string; items?: number }> {
  const owner = ownerOf(env);
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `prv_test:${REVIEW_FLOW_ID}:${REVIEW_TEST_EDITION}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    let rec: Pick<DayRecord, "id" | "x_date"> | null = await readDay(env, riyadhDateKey(new Date(now)));
    if (!rec) {
      const [last] = await call<Array<{ id: number; x_date: string }>>(env, PRICE_DAY_MODEL, "search_read", {
        domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1,
      });
      rec = last ?? null;
    }
    if (!rec) { await releaseButton(env, claim); return { sent: false, reason: "no_day" }; }
    // as at 04:00: no decision taken yet on any row
    // (the rows are read with their lines' own decisions set aside first: an outlier Baraa already decided still shows what moved)
    const rows = (await dayReviewRows(env, rec)).map((r) => ({ ...r, decision: null, decidedPrice: 0 }));
    if (!rows.length) { await releaseButton(env, claim); return { sent: false, reason: "no_items" }; }
    const built = buildReviewTexts(rec.x_date, await reviewGroups(env, rows), pricesDeadlineMinutes(env).minutes, { test: true });
    for (const part of built.texts) {
      if (!(await say(env, textContent(part), true))) { await releaseButton(env, claim); return { sent: false, reason: "not_sent" }; }
    }
    if (!(await say(env, buttonsContent(built.body, reviewButtons(rec.id, 1, true)), true))) { await releaseButton(env, claim); return { sent: false, reason: "not_sent" }; }
    await writeSnapshot(env, { v: 1, day: rec.x_date, dayId: rec.id, ver: 1, at: now, rows, sigs: rows.map(rowSig), test: true });
    await finishButton(env, claim, DAY_TTL);
    return { sent: true, day: rec.x_date, items: rows.length };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
