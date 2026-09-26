// Today's prices: build, review, approve, publish — 2026-09-25 (STATUS § 35),
// the pricing engine v1 since 2026-09-26 (STATUS § 40 ج).
//
// One record per Riyadh day, x_price_day «أسعار اليوم», one line per active
// product and packaging (x_price_day_line), built and kept current by the
// worker (src/pricing-engine.ts): the lowest valid purchase price of the day
// from any source, the median of the day's market observations, the sale price
// = the market price, the unit profit = market − purchase − waste. A line with
// no purchase price, no market price, a unit profit ≤ 0 or an outlier is an
// exception: Baraa gets one message per exception (three buttons: «اعتمد بسعر
// السوق», «لا تنشر», «عدّل»; one message with the count and the review link
// above EXCEPTIONS_MANY), from the end of Omar's reply window (04:00) until
// the publication time. Every other line is approved automatically.
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
// Nothing here writes list_price or standard_price.

import type { Env } from "./config";
import { ORDERING_HOURS_CLOSE, ORDERING_HOURS_OPEN } from "./config";
import { call } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { cutoffLabel, sendOwnerAlert, sendOwnerMessage } from "./templates";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { fnv1a } from "./auto-send-guard";
import { arabicDate, maskPhone } from "./wa-params";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";
import {
  computePricing, lineVerdict, readActiveItems, readDayOffers, saleRule, type Decision, type LineStatus,
} from "./pricing-engine";
import { loadPriceSources, MARKET_ASK_MINUTE, MARKET_REPLY_WINDOW_MIN } from "./price-sources";
import { readPricingSettings } from "./operating-cost";

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
}

const DAY_FIELDS = ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_approved_by", "x_published_at"];
const LINE_FIELDS = [
  "id", "x_sequence", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_daily_price_id", "x_default_price_id",
  "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_sale_price", "x_excluded", "x_blocked", "x_offers",
  "x_market_price", "x_market_count", "x_unit_profit", "x_status", "x_reason", "x_decision", "x_manual_price", "x_decided_at",
];

async function readDay(env: Env, day: string): Promise<DayRecord | null> {
  const rows = await call<DayRecord[]>(env, PRICE_DAY_MODEL, "search_read", {
    domain: [["x_date", "=", day]], fields: DAY_FIELDS, order: "id asc", limit: 1,
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
  const plan = computePricing(items, offers, settings.wastePct);
  const rec = found ?? (await ensureDay(env, day));
  const lines = await readLines(env, rec.id);
  const fp = fnv1a(JSON.stringify([
    rec.id, rec.x_state, settings.wastePct,
    offers.map((o) => [o.model, o.rowId, o.kind, o.price, o.outlier, o.partnerId]),
    items.map((i) => [i.productId, i.packagingId]),
    lines.filter((l) => l.x_decision || Number(l.x_manual_price) > 0).map((l) => [lineKey(l), l.x_decision || "", Number(l.x_manual_price) || 0]),
  ]));
  if (!opts.force) {
    try {
      if ((await env.MSG_DEDUP.get(fpKey(day))) === fp) return { day, action: "unchanged", dayId: rec.id, state: rec.x_state };
    } catch { /* recompute */ }
  }
  const byKey = new Map(lines.map((l) => [lineKey(l), l]));
  const creates: Array<Record<string, unknown>> = [];
  const counts: Record<LineStatus, number> = { auto: 0, exception: 0, manual: 0, unpublished: 0 };
  let updated = 0;
  let seq = lines.reduce((m, l) => Math.max(m, Number(l.x_sequence) || 0), 0);
  for (const p of plan) {
    const l = byKey.get(p.key);
    const decision = (l?.x_decision || null) as Decision | null;
    const v = lineVerdict(p, decision, Number(l?.x_manual_price) || 0);
    counts[v.status]++;
    const src = p.purchaseOffer;
    const want: Record<string, unknown> = {
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
    const vals = changed(l, want);
    if (Object.keys(vals).length) {
      await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
      updated++;
    }
  }
  const planned = new Set(plan.map((p) => p.key));
  for (const l of lines) {
    if (planned.has(lineKey(l))) continue;
    const vals = changed(l, { x_status: "unpublished", x_reason: "ليس في الكتالوج النشط اليوم", x_sale_price: 0, x_excluded: true });
    if (Object.keys(vals).length) {
      await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
      updated++;
    }
    counts.unpublished++;
  }
  if (creates.length) await call<number[]>(env, PRICE_LINE_MODEL, "create", { vals_list: creates });
  try { await env.MSG_DEDUP.put(fpKey(day), fp, { expirationTtl: 3 * 24 * 3600 }); } catch { /* next tick recomputes */ }
  console.log(`[prices] ${day} refreshed: +${creates.length} ~${updated} (${plan.length} lines: ${JSON.stringify(counts)})`);
  return {
    day, action: "refreshed", dayId: rec.id, state: rec.x_state, created: creates.length, updated, lines: plan.length,
    excluded: counts.exception + counts.unpublished, counts,
  };
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
const DECISION_LABEL: Record<Decision, string> = { market: "اعتمد بسعر السوق", skip: "لا تنشر", edit: "سعر معدّل" };

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
  return [
    `⚠️ استثناء في أسعار اليوم (${arabicDate(day)})`,
    `${lineName(l)}${pk ? ` (${pk})` : ""}`,
    `الشراء: ${cost} · السوق: ${market}${profit}`,
    `السبب: ${l.x_reason || "—"}`,
    `قرارك قبل ${deadline}، وإلا لا يُنشر اليوم.`,
  ].join("\n");
}

/**
 * From exceptionsFromMinutes until the publication time, on a draft day: one
 * message per new exception (a KV guard per product, packaging and day), its
 * buttons «اعتمد بسعر السوق» (only with a market price), «لا تنشر», «عدّل».
 * More than EXCEPTIONS_MANY exceptions: one message with the count and the
 * review screen's link instead (once a day).
 */
export async function notifyPriceExceptions(env: Env, now: number = Date.now()): Promise<{ action: string; sent?: number; count?: number }> {
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
    const buttons = [
      ...(Number(l.x_market_price) > 0 ? [{ id: `pexc_m_${l.id}`, title: "اعتمد بسعر السوق" }] : []),
      { id: `pexc_s_${l.id}`, title: "لا تنشر" },
      { id: `pexc_e_${l.id}`, title: "عدّل" },
    ];
    await sendViaGateway(env, { purpose: EXCEPTION_PURPOSE, to: env.OWNER_WHATSAPP, expiresAt, content: buttonsContent(exceptionText(day, l, deadline), buttons) });
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

/** A tap on an exception's buttons (pexc_m_ / pexc_s_ / pexc_e_ + line id). The reply to Baraa. */
export async function handlePriceExceptionButton(env: Env, payload: string, now: number = Date.now()): Promise<string> {
  const mm = /^pexc_([mse])_(\d+)$/.exec(String(payload ?? ""));
  if (!mm) return "";
  const { l, day, why } = await decidable(env, Number(mm[2]));
  if (why || !l || !day) return why ?? "";
  const name = lineName(l);
  if (mm[1] === "e") {
    await env.MSG_DEDUP.put(editKey(env), JSON.stringify({ lineId: l.id, at: now }), { expirationTtl: EDIT_REPLY_MIN * 60 });
    return `✏️ أرسل سعر البيع لـ ${name} رقماً واحداً خلال ${EDIT_REPLY_MIN} دقيقة.`;
  }
  if (mm[1] === "m") {
    const market = Math.round((Number(l.x_market_price) || 0) * 100) / 100;
    if (!(market > 0)) return `لا سعر سوق لـ ${name} اليوم: اختر «لا تنشر» أو «عدّل».`;
    const ok = await decide(env, l, { x_decision: "market", x_manual_price: market, x_status: "manual", x_reason: "براء: اعتمد بسعر السوق", x_sale_price: market, x_excluded: false }, now);
    return ok ? `✅ ${name}: يُنشر بسعر السوق ${money(market)} ر.س.${missedTail(day)}` : `القرار مسجّل مسبقاً على ${name}.`;
  }
  const ok = await decide(env, l, { x_decision: "skip", x_status: "unpublished", x_reason: "براء: لا تنشر", x_sale_price: 0, x_excluded: true }, now);
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
  const ok = await decide(env, l, { x_decision: "edit", x_manual_price: price, x_status: "manual", x_reason: "براء: سعر معدّل", x_sale_price: price, x_excluded: false }, now);
  return ok ? `✅ ${lineName(l)}: يُنشر بـ ${money(price)} ر.س.${missedTail(day)}` : `القرار مسجّل مسبقاً على ${lineName(l)}.`;
}

export interface PricesTick {
  /** § 40 ب — 02:30 «أرسل أسعار السوق اليوم» to the sources that are not suppliers. */
  marketAsk?: { action: string } | { error: string };
  refresh?: RefreshReport | { error: string };
  /** § 40 ج — the exceptions to Baraa. */
  exceptions?: { action: string } | { error: string };
  /** § 40 د — the daily alert while «عدد المحطات اليومية المخطط» is empty. */
  stops?: { action: string } | { error: string };
  deadline?: DeadlineReport | { error: string };
  publish?: PublishReport | { error: string };
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
  try {
    const { checkPlannedStops } = await import("./order-pricing");
    out.stops = await checkPlannedStops(env, now, dl);
  } catch (e) { out.stops = { error: (e as Error)?.message ?? String(e) }; }
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
