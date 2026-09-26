// Today's prices: build, review, approve, publish — 2026-09-25 (STATUS § 35).
//
// Suppliers' prices stay where § 26 keeps them (x_daily_price, one row per
// supplier / product / packaging / Riyadh day, an outlier marked `pending`).
// Nothing parallel: one record per Riyadh day, x_price_day «أسعار اليوم», with
// one line per product and packaging (x_price_day_line):
//
//   • built and kept current by the worker from the day's prices (every */5
//     tick when they changed, right after a supplier's reply, and on the
//     form's «🔄 تحديث»), never from another day's prices;
//   • the default supplier is the cheapest price that is not an outlier; with
//     only outliers, the cheapest outlier, and the line blocks the approval
//     until Baraa edits the price or ticks «اعتماد رغم الشذوذ» (Odoo computes
//     x_blocked); Baraa may switch the supplier (an Odoo automation takes that
//     supplier's price of the day);
//   • the margin comes from the product card (product.template.x_margin_pct);
//     sale price = purchase × (1 + margin / 100), rounded to two decimals,
//     half up (computeSalePrice here = the stored compute in Odoo); a line
//     without margin (0 or empty) is excluded: never published, and Baraa is
//     told its product's name;
//   • Baraa approves in Odoo (UTAK ← «💰 أسعار اليوم» ← «اعتماد أسعار اليوم»):
//     the record locks, and a webhook asks this worker to publish;
//   • the publication is a critical («مهمة») message to every customer, through
//     the gateway: text inside the number's window, held outside it (with the
//     customer's «فتح المحادثة» template when Meta allows it); sale price and
//     packaging only, cut into parts when long; Baraa gets the same list and
//     the counts;
//   • no approval by the ordering-opening time (ORDERING_HOURS_OPEN, 06:00
//     Riyadh; PRICES_DEADLINE="HH:MM" overrides it): the day is «missed», no
//     publication, one alert. Yesterday's prices are never re-sent. A late
//     approval publishes as usual.
//
// Nothing here writes list_price or standard_price.

import type { Env } from "./config";
import { ORDERING_HOURS_CLOSE, ORDERING_HOURS_OPEN } from "./config";
import { call } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { cutoffLabel, sendOwnerAlert, sendOwnerMessage } from "./templates";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { fnv1a } from "./auto-send-guard";
import { arabicDate, maskPhone } from "./wa-params";
import { riyadhDateKey, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";

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

// ---------------------------------------------------------------- the rules

/**
 * purchase × (1 + margin / 100), two decimals, half up — in integers, exactly
 * as the stored compute of x_price_day_line.x_sale_price in Odoo:
 *   c = int(cost * 100 + 0.5); m = int(margin * 100 + 0.5)
 *   sale = ((c * (10000 + m) + 5000) // 10000) / 100
 * No margin (≤ 0) or no price → 0 (the line is not published).
 */
export function computeSalePrice(cost: number, marginPct: number): number {
  if (!(Number(cost) > 0) || !(Number(marginPct) > 0)) return 0;
  const c = Math.floor(Number(cost) * 100 + 0.5);
  const m = Math.floor(Number(marginPct) * 100 + 0.5);
  return Math.floor((c * (10000 + m) + 5000) / 10000) / 100;
}

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

export interface DailyPriceRow {
  id: number;
  x_date: string | false;
  x_supplier_id: [number, string] | false;
  x_product_tmpl_id: [number, string] | false;
  x_packaging_id: [number, string] | false;
  x_price_sar: number | false;
  x_extraction_status: string | false;
}

export interface Offer {
  priceId: number;
  supplierId: number;
  supplierName: string;
  price: number;
  /** § 26: an outlier is saved `pending`. */
  outlier: boolean;
}

export interface LinePlan {
  key: string;
  productId: number;
  productName: string;
  packagingId: number;
  packagingName: string;
  offers: Offer[];
  chosen: Offer;
  offersText: string;
}

/** Cheapest non-outlier; with only outliers, the cheapest outlier. Ties: the earlier price row. */
export function pickDefaultOffer(offers: Offer[]): Offer {
  const byPrice = (a: Offer, b: Offer) => a.price - b.price || a.priceId - b.priceId;
  const normal = offers.filter((o) => !o.outlier).sort(byPrice);
  return normal[0] ?? [...offers].sort(byPrice)[0];
}

function shortName(name: string): string {
  const n = String(name ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
  return n.length > 24 ? `${n.slice(0, 23)}…` : n;
}
function money(x: number): string {
  const n = Math.round(Number(x) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** «أحمد حسان 25 · خالد 27 (شاذ)», cheapest first. */
export function offersText(offers: Offer[]): string {
  return [...offers].sort((a, b) => a.price - b.price || a.priceId - b.priceId)
    .map((o) => `${shortName(o.supplierName)} ${money(o.price)}${o.outlier ? " (شاذ)" : ""}`).join(" · ");
}

/** One line per product and packaging, from the day's rows: each supplier's latest price, and the default. */
export function planLines(rows: DailyPriceRow[]): LinePlan[] {
  const latest = new Map<string, DailyPriceRow>();
  for (const r of rows) {
    if (!Array.isArray(r.x_product_tmpl_id) || !Array.isArray(r.x_packaging_id) || !Array.isArray(r.x_supplier_id)) continue;
    if (!(Number(r.x_price_sar) > 0) || r.x_extraction_status === "failed") continue;
    const k = `${r.x_product_tmpl_id[0]}:${r.x_packaging_id[0]}:${r.x_supplier_id[0]}`;
    const cur = latest.get(k);
    if (!cur || r.id > cur.id) latest.set(k, r);
  }
  const groups = new Map<string, { row: DailyPriceRow; offers: Offer[] }>();
  for (const r of latest.values()) {
    const key = `${(r.x_product_tmpl_id as [number, string])[0]}:${(r.x_packaging_id as [number, string])[0]}`;
    const g = groups.get(key) ?? { row: r, offers: [] };
    g.offers.push({
      priceId: r.id,
      supplierId: (r.x_supplier_id as [number, string])[0],
      supplierName: (r.x_supplier_id as [number, string])[1],
      price: Number(r.x_price_sar),
      outlier: r.x_extraction_status === "pending",
    });
    groups.set(key, g);
  }
  const out: LinePlan[] = [];
  for (const [key, g] of groups) {
    out.push({
      key,
      productId: (g.row.x_product_tmpl_id as [number, string])[0],
      productName: (g.row.x_product_tmpl_id as [number, string])[1],
      packagingId: (g.row.x_packaging_id as [number, string])[0],
      packagingName: (g.row.x_packaging_id as [number, string])[1],
      offers: g.offers,
      chosen: pickDefaultOffer(g.offers),
      offersText: offersText(g.offers),
    });
  }
  return out.sort((a, b) => shortName(a.productName).localeCompare(shortName(b.productName), "ar") || a.packagingId - b.packagingId);
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
}

const DAY_FIELDS = ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_published_at"];
const LINE_FIELDS = [
  "id", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_daily_price_id", "x_default_price_id",
  "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_sale_price", "x_excluded", "x_blocked", "x_offers",
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

async function readDayRows(env: Env, day: string): Promise<DailyPriceRow[]> {
  return call<DailyPriceRow[]>(env, "x_daily_price", "search_read", {
    domain: [["x_date", "=", day], ["x_price_sar", ">", 0], ["x_supplier_id", "!=", false], ["x_extraction_status", "!=", "failed"]],
    fields: ["id", "x_date", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_price_sar", "x_extraction_status"],
    order: "id asc",
    limit: 1000,
  });
}

async function readMargins(env: Env, productIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(productIds)].filter((x) => x > 0);
  if (!ids.length) return new Map();
  const rows = await call<Array<{ id: number; x_margin_pct: number | false }>>(env, "product.template", "search_read", {
    domain: [["id", "in", ids]], fields: ["id", "x_margin_pct"], context: { active_test: false }, limit: ids.length,
  });
  return new Map(rows.map((r) => [r.id, Number(r.x_margin_pct) || 0]));
}

// ---------------------------------------------------------------- refresh

export interface RefreshReport {
  day: string;
  action: "no_prices" | "unchanged" | "locked" | "refreshed";
  dayId?: number;
  state?: string;
  created?: number;
  updated?: number;
  lines?: number;
  excluded?: number;
}

function fpKey(day: string): string {
  return `prices_fp:v1:${day}`;
}

/**
 * Build or update the day's record from its prices. A line Baraa touched
 * (another supplier, an edited price, «اعتماد رغم الشذوذ») keeps his choice;
 * an untouched line follows the new default. A line without margin takes the
 * product's margin when it gets one. Approved and published days are never
 * touched. Skipped when nothing changed since the last run (unless forced).
 */
export async function refreshPriceDay(env: Env, opts: { day?: string; force?: boolean; now?: number } = {}): Promise<RefreshReport> {
  const day = opts.day ?? riyadhDateKey(new Date(opts.now ?? Date.now()));
  const rows = await readDayRows(env, day);
  const found = await readDay(env, day);
  if (!rows.length && !found) return { day, action: "no_prices" };
  const rec = found ?? (await ensureDay(env, day));
  const plan = planLines(rows);
  const margins = await readMargins(env, plan.map((p) => p.productId));
  const fp = fnv1a(JSON.stringify([
    rec.id, rec.x_state,
    rows.map((r) => [r.id, r.x_price_sar, r.x_extraction_status]),
    [...margins.entries()].sort((a, b) => a[0] - b[0]),
  ]));
  if (!opts.force) {
    try {
      if ((await env.MSG_DEDUP.get(fpKey(day))) === fp) return { day, action: "unchanged", dayId: rec.id, state: rec.x_state };
    } catch { /* recompute */ }
  }
  if (rec.x_state === "approved" || rec.x_state === "published") {
    return { day, action: "locked", dayId: rec.id, state: rec.x_state };
  }
  const lines = await readLines(env, rec.id);
  const byKey = new Map(lines.map((l) => [`${Array.isArray(l.x_product_tmpl_id) ? l.x_product_tmpl_id[0] : 0}:${Array.isArray(l.x_packaging_id) ? l.x_packaging_id[0] : 0}`, l]));
  const creates: Array<Record<string, unknown>> = [];
  let updated = 0;
  let seq = lines.length;
  for (const p of plan) {
    const margin = margins.get(p.productId) ?? 0;
    const l = byKey.get(p.key);
    if (!l) {
      creates.push({
        x_day_id: rec.id, x_name: `${shortName(p.productName)} — ${p.packagingName}`, x_sequence: ++seq,
        x_product_tmpl_id: p.productId, x_packaging_id: p.packagingId,
        x_supplier_id: p.chosen.supplierId, x_daily_price_id: p.chosen.priceId, x_default_price_id: p.chosen.priceId,
        x_source_price: p.chosen.price, x_cost_price: p.chosen.price, x_is_outlier: p.chosen.outlier, x_outlier_ok: false,
        x_margin_pct: margin, x_offers: p.offersText,
      });
      continue;
    }
    const vals: Record<string, unknown> = {};
    const curPrice = Array.isArray(l.x_daily_price_id) ? l.x_daily_price_id[0] : 0;
    const defPrice = Array.isArray(l.x_default_price_id) ? l.x_default_price_id[0] : 0;
    const untouched = curPrice === defPrice && Math.abs((l.x_cost_price || 0) - (l.x_source_price || 0)) < 0.005 && !l.x_outlier_ok;
    if (untouched && defPrice !== p.chosen.priceId) {
      Object.assign(vals, {
        x_supplier_id: p.chosen.supplierId, x_daily_price_id: p.chosen.priceId, x_default_price_id: p.chosen.priceId,
        x_source_price: p.chosen.price, x_cost_price: p.chosen.price, x_is_outlier: p.chosen.outlier,
      });
    }
    if ((l.x_offers || "") !== p.offersText) vals.x_offers = p.offersText;
    if (!(Number(l.x_margin_pct) > 0) && margin > 0) vals.x_margin_pct = margin;
    if (Object.keys(vals).length) {
      await call(env, PRICE_LINE_MODEL, "write", { ids: [l.id], vals });
      updated++;
    }
  }
  if (creates.length) await call<number[]>(env, PRICE_LINE_MODEL, "create", { vals_list: creates });
  try { await env.MSG_DEDUP.put(fpKey(day), fp, { expirationTtl: 3 * 24 * 3600 }); } catch { /* next tick recomputes */ }
  const excluded = plan.filter((p) => !((margins.get(p.productId) ?? 0) > 0)).length;
  console.log(`[prices] ${day} refreshed: +${creates.length} ~${updated} (${plan.length} lines, ${excluded} without margin)`);
  return { day, action: "refreshed", dayId: rec.id, state: rec.x_state, created: creates.length, updated, lines: plan.length, excluded };
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
  action: "published" | "already" | "not_approved" | "in_progress" | "blocked" | "mismatch" | "not_found" | "unapproved_meanwhile";
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
    const publishable = lines.filter((l) => !l.x_excluded && Number(l.x_sale_price) > 0);
    const mismatch = publishable.filter((l) => Math.abs(Number(l.x_sale_price) - computeSalePrice(l.x_cost_price, l.x_margin_pct)) > 0.005);
    if (mismatch.length) {
      await releaseButton(penv, claim);
      await sendOwnerAlert(penv, `⚠️ أسعار ${day.x_date} لم تُنشر: سعر البيع في Odoo لا يطابق القاعدة (${mismatch.map((l) => `${lineName(l)} ${l.x_sale_price}≠${computeSalePrice(l.x_cost_price, l.x_margin_pct)}`).join("، ")}).`);
      return { action: "mismatch", day: day.x_date, dayId };
    }
    const excluded = lines.filter((l) => l.x_excluded || !(Number(l.x_sale_price) > 0)).map(lineName);
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
      excluded.length ? `لم يُنشر (بلا هامش): ${excluded.join("، ")}.` : "",
      "وهذه نسخة ما وصلهم:",
    ].filter(Boolean).join("\n");
    const copy = buildPriceMessages(day.x_date, published, PRICE_TEXT_LIMIT, summary);
    for (const part of copy) await sendOwnerMessage(penv, part, OWNER_PRICES_PURPOSE);
    if (excluded.length) {
      await sendOwnerAlert(penv, `⚠️ أصناف بلا هامش لم تُنشر اليوم: ${excluded.join("، ")}. ضع «هامش الربح %» في بطاقة المنتج (أو في سطر اليوم).`);
    }
    const report = [
      `نُشر ${nowOdoo(now)} UTC. الأصناف: ${published.length}، والرسائل لكل عميل: ${parts.length}، والعملاء: ${recipients.length}.`,
      `نصاً ${counts.session}، ومحفوظة ${counts.held}، ومحجوبة (القائمة/الحارس) ${counts.refused}، ولم تُرسل ${counts.skipped}، ورفضها Meta ${counts.rejected}.`,
      excluded.length ? `مستبعد بلا هامش: ${excluded.join("، ")}.` : "لا مستبعد.",
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
  action: "before" | "after_window" | "claimed_before" | "missed" | "approved" | "published" | "already_missed";
  day: string;
  dayId?: number;
}

/** At the deadline (within DEADLINE_WINDOW_MIN): a day not approved becomes «missed», with one alert. Never re-sends another day's prices. */
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
  const target = rec ?? (await ensureDay(env, day, "missed"));
  if (target.x_state !== "missed") await call(env, PRICE_DAY_MODEL, "write", { ids: [target.id], vals: { x_state: "missed" } });
  const lines = await readLines(env, target.id).catch(() => [] as DayLine[]);
  const hh = `${String(Math.floor(dl / 60)).padStart(2, "0")}:${String(dl % 60).padStart(2, "0")}`;
  await sendOwnerAlert(env, [
    `⏰ أسعار اليوم (${arabicDate(day)}) لم تُعتمد حتى ${hh}، فلم تُنشر للعملاء.`,
    lines.length ? `أصناف السجل: ${lines.length} (شاذ لم يُعالج: ${lines.filter((l) => l.x_blocked).length}، وبلا هامش: ${lines.filter((l) => l.x_excluded).length}).` : "لم يصل سعر من الموردين اليوم.",
    "لا تُعاد أسعار أمس. الاعتماد المتأخر من «💰 أسعار اليوم» ينشر عادي.",
  ].join("\n"));
  await finishButton(env, claim);
  return { action: "missed", day, dayId: target.id };
}

export interface PricesTick {
  /** § 40 ب — 02:30 «أرسل أسعار السوق اليوم» to the sources that are not suppliers. */
  marketAsk?: { action: string } | { error: string };
  refresh?: RefreshReport | { error: string };
  deadline?: DeadlineReport | { error: string };
  publish?: PublishReport | { error: string };
}

/** The every-5-minutes tick: refresh the day (when its prices changed), the deadline, and an approval whose webhook was lost. */
export async function runPricesTick(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<PricesTick> {
  const out: PricesTick = {};
  try {
    const { runMarketAsk } = await import("./price-sources");
    out.marketAsk = await runMarketAsk(env, now, pricesDeadlineMinutes(env).minutes);
  } catch (e) { out.marketAsk = { error: (e as Error)?.message ?? String(e) }; }
  try { out.refresh = await refreshPriceDay(env, { now }); } catch (e) { out.refresh = { error: (e as Error)?.message ?? String(e) }; }
  try { out.deadline = await checkPricesDeadline(env, now); } catch (e) { out.deadline = { error: (e as Error)?.message ?? String(e) }; }
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
