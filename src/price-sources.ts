// § 40 ب (2026-09-26) — the price sources and their daily offers.
//
// A price source is a partner or an employee with «مصدر أسعار»
// (x_price_source) ticked in Odoo: adding one later is ticking it, no code.
// The first two: Ahmed Hassan (supplier) and Omar Al-Majhali (employee).
//
//   • A supplier keeps the 02:00 / 05:00 flow of § 26 as it is. His purchase
//     prices stay in x_daily_price (the 21:15 list, the supplier dues and the
//     price fallback read them as the vendor's own price). A number with the
//     word «سوق» BESIDE it in his message is a market observation, not a
//     purchase price: it goes to x_price_offer.
//   • Any other source (Omar) gets «أرسل أسعار السوق اليوم» at 02:30 Riyadh,
//     through the gateway: text inside the number's window; outside it (or
//     before his «بدء الدوام» tap) held in the team queue until the tap. His
//     reply within 90 minutes of the ask REACHING him is read by the same
//     extractor and the same rules as § 26 م6 — a product of the active
//     catalog, a number written in the message — as market observations; a
//     number with «شراء» beside it is a purchase price. Anything else from him
//     is an ordinary team message. «وصلتنا أسعار السوق (N صنف)» answers a
//     reply that was read.
//   • Each saved offer is one x_price_offer row: source, Riyadh day, product,
//     packaging, purchase / market / available quantity (each optional), and
//     the status — «شاذ» when a price moved PRICE_OUTLIER_RATIO or more from
//     the same source's last one of the same kind (the § 26 rule).
//
// No guessed price (م6): a number the message does not state is never saved.

import type { Env } from "./config";
import { PRICE_OUTLIER_RATIO } from "./config";
import type { SupplierPriceItem } from "./types";
import { call, fetchSupplierCatalog } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton } from "./button-lock";
import { riyadhDateKey, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";

export const OFFER_MODEL = "x_price_offer";
export const SOURCE_FIELD = "x_price_source";
export const MARKET_ASK_PURPOSE = "market_price_ask";
/** 02:30 Riyadh. */
export const MARKET_ASK_MINUTE = 2 * 60 + 30;
/** A reply counts within this many minutes of the ask reaching the source. */
export const MARKET_REPLY_WINDOW_MIN = 90;
const MIN = 60_000;
const SIM_FIELD = "x_utak_simulation";
const MARKER_TTL = 12 * 60 * 60;

export const marketAskText = (name: string): string =>
  `صباح الخير ${String(name || "").split(" ")[0]} 🌿 أرسل أسعار السوق اليوم لو سمحت: الصنف والتعبئة والسعر لكل صنف. ولو معك سعر شراء اكتب «شراء» جنب رقمه.`;
export const marketAckText = (n: number): string => `وصلتنا أسعار السوق (${n} صنف) 🌿 الله يعطيك العافية.`;

// ---------------------------------------------------------------- «سوق» / «شراء» beside a number

/** supplier: a purchase price unless «سوق» is beside it. observer (Omar): a market observation unless «شراء» is. */
export type SourceRole = "supplier" | "observer";
export type PriceKind = "purchase" | "market";
const KEYWORD: Record<PriceKind, RegExp> = { market: /سوق/, purchase: /شرا/ };
const DEFAULT_KIND: Record<SourceRole, PriceKind> = { supplier: "purchase", observer: "market" };
const OTHER: Record<PriceKind, PriceKind> = { purchase: "market", market: "purchase" };
/** Words skipped between a number and its keyword: «سوق ب 24», «24 ريال سوق», «24 في السوق». */
const FILLER = new Set(["ب", "بـ", "في", "ريال", "رس", "ر.س", "sar", "=", "هو", "سعر"]);

function normalize(text: string): string {
  return String(text ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}
const NUM = /^\d+(?:\.\d+)?$/;
/** Each line's tokens: numbers split from the words around them, punctuation dropped. */
export function tokenLines(text: string): string[][] {
  return normalize(text).split(/\r?\n/).map((line) => line
    .replace(/(\d)(?=[^\d.\s])/g, "$1 ")
    .replace(/([^\d\s.])(?=\d)/g, "$1 ")
    .replace(/[:،,؛;\-–—()[\]«»"'!؟?*•‏‎]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ""))
    .filter(Boolean));
}
function beside(tokens: string[], i: number, kw: RegExp): boolean {
  // before: the word just before the number (a filler word may sit between)
  for (let j = i - 1, skipped = 0; j >= 0 && skipped <= 1; j--) {
    if (NUM.test(tokens[j])) break;
    if (kw.test(tokens[j])) return true;
    if (!FILLER.has(tokens[j])) break;
    skipped++;
  }
  // after: the word just after it, unless that word belongs to the next number («20 سوق 24»)
  for (let j = i + 1, skipped = 0; j < tokens.length && skipped <= 1; j++) {
    if (NUM.test(tokens[j])) break;
    if (kw.test(tokens[j])) {
      const next = tokens.slice(j + 1).find((t) => !FILLER.has(t));
      return !(next !== undefined && NUM.test(next));
    }
    if (!FILLER.has(tokens[j])) break;
    skipped++;
  }
  return false;
}
/**
 * Where the message puts this number: not written at all, always with the
 * other kind's keyword beside it («other»), never («default»), or both
 * («ambiguous» — the extractor's own label decides).
 */
export function kindByText(text: string, n: number, role: SourceRole): "unwritten" | "default" | "other" | "ambiguous" {
  const kw = KEYWORD[OTHER[DEFAULT_KIND[role]]];
  let total = 0, marked = 0;
  for (const tokens of tokenLines(text)) {
    tokens.forEach((t, i) => {
      if (!NUM.test(t) || Math.abs(Number(t) - n) >= 0.005) return;
      total++;
      if (beside(tokens, i, kw)) marked++;
    });
  }
  if (!total) return "unwritten";
  return marked === 0 ? "default" : marked === total ? "other" : "ambiguous";
}

export interface OfferPrices {
  purchase?: number;
  market?: number;
  qty?: number;
  dropped: string[];
}
/**
 * The kinds of one extracted item's numbers, from the message itself: each
 * number must be written; its kind is the source's default unless the other
 * keyword is beside it («سوق» for a supplier, «شراء» for an observer). Two
 * numbers of one kind: the one the extractor labelled that kind stays.
 */
export function classifyOffer(item: { cost_price?: number | null; market_price?: number | null; available_qty?: number | null }, text: string, role: SourceRole): OfferPrices {
  const out: OfferPrices = { dropped: [] };
  const cands: Array<{ v: number; label: PriceKind }> = [];
  if (Number(item.cost_price) > 0) cands.push({ v: Number(item.cost_price), label: "purchase" });
  if (Number(item.market_price) > 0) cands.push({ v: Number(item.market_price), label: "market" });
  const placed: Array<{ v: number; kind: PriceKind; label: PriceKind }> = [];
  for (const c of cands) {
    const k = kindByText(text, c.v, role);
    if (k === "unwritten") { out.dropped.push(`${c.v}: غير مكتوب في الرسالة`); continue; }
    const kind = k === "ambiguous" ? c.label : k === "other" ? OTHER[DEFAULT_KIND[role]] : DEFAULT_KIND[role];
    placed.push({ v: c.v, kind, label: c.label });
  }
  for (const kind of ["purchase", "market"] as PriceKind[]) {
    const of = placed.filter((p) => p.kind === kind);
    if (!of.length) continue;
    const pick = of.find((p) => p.label === kind) ?? of[0];
    out[kind] = pick.v;
    for (const p of of) if (p !== pick) out.dropped.push(`${p.v}: رقمان لنفس النوع`);
  }
  const q = Number(item.available_qty);
  if (q > 0) {
    if (kindByText(text, q, role) === "unwritten") out.dropped.push(`الكمية ${q}: غير مكتوبة`);
    else out.qty = q;
  }
  return out;
}

export interface KeptOffer extends OfferPrices {
  product_id: number;
  packaging_id: number;
  item: SupplierPriceItem;
}
/** m6 for offers: the product from the catalog, its packaging, and the numbers written (classifyOffer). */
export function checkOfferItems(
  items: SupplierPriceItem[],
  products: Array<{ id: number }>,
  packagings: Array<{ id: number; product_id: number }>,
  text: string,
  role: SourceRole,
): { kept: KeptOffer[]; dropped: Array<{ item: SupplierPriceItem; reason: string }> } {
  const ids = new Set(products.map((p) => p.id));
  const kept: KeptOffer[] = [];
  const dropped: Array<{ item: SupplierPriceItem; reason: string }> = [];
  for (const it of items) {
    if (!ids.has(it.product_id)) { dropped.push({ item: it, reason: "صنف لا يورّده" }); continue; }
    if (!packagings.some((k) => k.id === it.packaging_id && k.product_id === it.product_id)) { dropped.push({ item: it, reason: "تعبئة لا تخص الصنف" }); continue; }
    const c = classifyOffer(it, text, role);
    if (c.purchase === undefined && c.market === undefined) { dropped.push({ item: it, reason: "السعر غير مكتوب في الرسالة" }); continue; }
    kept.push({ ...c, product_id: it.product_id, packaging_id: it.packaging_id, item: it });
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------- the offer rows

const isOutlier = (last: number | null, next: number | undefined): boolean =>
  !!last && last > 0 && !!next && next > 0 && Math.max(last, next) / Math.min(last, next) >= PRICE_OUTLIER_RATIO;

/** The source's last earlier value of this kind for the product + packaging (x_price_offer), simulation left out. */
export async function lastOfferValue(env: Env, partnerId: number, productId: number, packagingId: number, kind: PriceKind): Promise<number | null> {
  const f = kind === "purchase" ? "x_purchase_price" : "x_market_price";
  const [r] = await call<Array<Record<string, number | false>>>(env, OFFER_MODEL, "search_read", {
    domain: [["x_source_partner_id", "=", partnerId], ["x_product_tmpl_id", "=", productId], ["x_packaging_id", "=", packagingId], [f, ">", 0], [SIM_FIELD, "!=", true]],
    fields: [f], order: "x_date desc, id desc", limit: 1,
  });
  return r && Number(r[f]) > 0 ? Number(r[f]) : null;
}

export interface OfferWrite {
  partnerId: number;
  employeeId?: number | null;
  productId: number;
  packagingId: number;
  purchase?: number;
  market?: number;
  qty?: number;
  dailyPriceId?: number | null;
  messageId?: string;
  text: string;
  /** a supplier's purchase outlier is decided by § 26 (x_daily_price «pending»). */
  purchaseOutlier?: boolean;
}
/** One x_price_offer row, the outliers decided against the same source's last values. Returns [id, outlier]. */
export async function saveOffer(env: Env, o: OfferWrite, day: string = riyadhDateKey()): Promise<{ id: number; outlier: boolean }> {
  const lastP = o.purchase !== undefined && o.purchaseOutlier === undefined ? await lastOfferValue(env, o.partnerId, o.productId, o.packagingId, "purchase") : null;
  const lastM = o.market !== undefined ? await lastOfferValue(env, o.partnerId, o.productId, o.packagingId, "market") : null;
  const pOut = o.purchaseOutlier ?? isOutlier(lastP, o.purchase);
  const mOut = isOutlier(lastM, o.market);
  const [id] = await call<number[]>(env, OFFER_MODEL, "create", {
    vals_list: [{
      x_name: `${day} · ${o.productId}/${o.packagingId}`,
      x_date: day,
      x_source_partner_id: o.partnerId,
      x_source_employee_id: o.employeeId || false,
      x_product_tmpl_id: o.productId,
      x_packaging_id: o.packagingId,
      x_purchase_price: o.purchase ?? 0,
      x_market_price: o.market ?? 0,
      x_available_qty: o.qty ?? 0,
      x_status: pOut || mOut ? "outlier" : "valid",
      x_purchase_outlier: pOut,
      x_market_outlier: mOut,
      x_daily_price_id: o.dailyPriceId || false,
      x_source_message_id: o.messageId ?? false,
      x_raw_text: String(o.text ?? "").slice(0, 2000),
    }],
  });
  return { id, outlier: pOut || mOut };
}

// ---------------------------------------------------------------- the sources

/**
 * § 41 أ — «مسجل في الضريبة» (x_vat_registered, default true) on the partner
 * and on the employee: a registered source's purchase price carries VAT the
 * business recovers, so from the cutoff the whole unit profit is divided by
 * 1.15; an unregistered one's is not (only the sale price is).
 */
export const VAT_REGISTERED_FIELD = "x_vat_registered";

export interface EmployeeSource { employeeId: number; partnerId: number; name: string; whatsapp: string; vatRegistered: boolean }
export interface PartnerSource { partnerId: number; name: string; whatsapp: string; supplier: boolean; vatRegistered: boolean }
export interface PriceSources {
  employees: EmployeeSource[];
  partners: PartnerSource[];
  /** Every partner an offer of a source carries: the flagged partners and the flagged employees' Work Contacts. */
  partnerIds: Set<number>;
}

/** § 41 أ — the source an offer's partner belongs to is registered for VAT (a partner that is not a source: the field's default, true). */
export function isSourceVatRegistered(sources: PriceSources, partnerId: number): boolean {
  const p = sources.partners.find((x) => x.partnerId === partnerId);
  if (p) return p.vatRegistered;
  const e = sources.employees.find((x) => x.partnerId === partnerId);
  if (e) return e.vatRegistered;
  return true;
}

export async function loadPriceSources(env: Env): Promise<PriceSources> {
  const emps = await call<Array<{ id: number; name: string; work_contact_id: [number, string] | number | false; x_utak_whatsapp: string | false; x_vat_registered: boolean }>>(env, "hr.employee", "search_read", {
    domain: [[SOURCE_FIELD, "=", true]], fields: ["id", "name", "work_contact_id", "x_utak_whatsapp", VAT_REGISTERED_FIELD], order: "id asc", limit: 100,
  });
  const parts = await call<Array<{ id: number; name: string; x_whatsapp_number: string | false; supplier_rank: number; x_vat_registered: boolean }>>(env, "res.partner", "search_read", {
    domain: [[SOURCE_FIELD, "=", true]], fields: ["id", "name", "x_whatsapp_number", "supplier_rank", VAT_REGISTERED_FIELD], order: "id asc", limit: 200,
  });
  const employees = emps.map((e) => ({
    employeeId: e.id,
    partnerId: Array.isArray(e.work_contact_id) ? e.work_contact_id[0] : typeof e.work_contact_id === "number" ? e.work_contact_id : 0,
    name: e.name,
    whatsapp: waDigits(String(e.x_utak_whatsapp || "")),
    vatRegistered: e.x_vat_registered === true,
  }));
  const partners = parts.map((p) => ({ partnerId: p.id, name: p.name, whatsapp: waDigits(String(p.x_whatsapp_number || "")), supplier: (Number(p.supplier_rank) || 0) > 0, vatRegistered: p.x_vat_registered === true }));
  return { employees, partners, partnerIds: new Set([...partners.map((p) => p.partnerId), ...employees.map((e) => e.partnerId).filter(Boolean)]) };
}

// ---------------------------------------------------------------- the 02:30 ask and the 90-minute window

interface Marker { day: string; at: number | null }
const markerKey = (digits: string) => `mask:v1:${waDigits(digits)}`;
/** The ask reached `digits` at `at` (null = held in the gateway until the number writes). */
export async function writeMarketAskMarker(env: Env, digits: string, day: string, at: number | null): Promise<void> {
  try { await env.MSG_DEDUP.put(markerKey(digits), JSON.stringify({ day, at }), { expirationTtl: MARKER_TTL }); } catch { /* the reply reads as a team message */ }
}
async function readMarker(env: Env, digits: string): Promise<Marker | null> {
  try {
    const raw = await env.MSG_DEDUP.get(markerKey(digits));
    return raw ? (JSON.parse(raw) as Marker) : null;
  } catch { return null; }
}

export interface AskResult { name: string; action: "sent" | "queued" | "held" | "off" | "claimed_before" | "refused" | "no_number" }

/** 02:30 Riyadh (the every-5-minutes tick, until the publication time): the ask to every source that is not a supplier, once a day. */
export async function runMarketAsk(env: Env, nowMs: number, untilMinute: number): Promise<{ action: string; asks?: AskResult[] }> {
  const m = riyadhMinutes(new Date(nowMs));
  if (m < MARKET_ASK_MINUTE) return { action: "before" };
  if (m >= untilMinute) return { action: "after" };
  const day = riyadhDateKey(new Date(nowMs));
  // its own auto-send job: the */5 cron's name would key it with every other
  // text to the same number that day (day, number, message type, job).
  const { withAutoSendJob } = await import("./auto-send-guard");
  const jenv = withAutoSendJob(env, MARKET_ASK_PURPOSE);
  const src = await loadPriceSources(env);
  const emp = new Set(src.employees.map((e) => e.partnerId));
  const targets: Array<{ partnerId: number; employeeId: number | null; name: string; whatsapp: string }> = [
    ...src.employees.filter((e) => e.partnerId).map((e) => ({ ...e })),
    ...src.partners.filter((p) => !p.supplier && !emp.has(p.partnerId)).map((p) => ({ ...p, employeeId: null })),
  ];
  const asks: AskResult[] = [];
  for (const t of targets) {
    if (!t.whatsapp) { asks.push({ name: t.name, action: "no_number" }); continue; }
    const claim = await claimButton(env, `mask_sent:${day}:p${t.partnerId}`, 26 * 60 * 60);
    if (!claim.claimed) { asks.push({ name: t.name, action: "claimed_before" }); continue; }
    const text = marketAskText(t.name);
    let action: AskResult["action"] = "refused";
    try {
      if (t.employeeId) {
        const { attendanceHold } = await import("./attendance");
        const h = await attendanceHold(env, t.partnerId, nowMs);
        if (h.hold) {
          if (h.phase === "before") {
            const { enqueueTeamItems } = await import("./team-queue");
            await enqueueTeamItems(env, `+${t.whatsapp}`, [{ text, purpose: MARKET_ASK_PURPOSE, ask_day: day }], h.queueTtl);
            action = "queued";
          } else action = "off";
        } else {
          const d = gatewayDecision(await sendViaGateway(jenv, { purpose: MARKET_ASK_PURPOSE, to: `+${t.whatsapp}`, content: textContent(text), noHold: true, noHoldReason: "طابور الفريق حتى «بدء الدوام»" }));
          if (d?.action === "session") { await writeMarketAskMarker(env, t.whatsapp, day, nowMs); action = "sent"; }
          else if (d?.action === "skipped") {
            const { enqueueTeamItems } = await import("./team-queue");
            await enqueueTeamItems(env, `+${t.whatsapp}`, [{ text, purpose: MARKET_ASK_PURPOSE, ask_day: day }]);
            action = "queued";
          }
        }
      } else {
        const d = gatewayDecision(await sendViaGateway(jenv, { purpose: MARKET_ASK_PURPOSE, to: `+${t.whatsapp}`, content: textContent(text) }));
        if (d?.action === "session") { await writeMarketAskMarker(env, t.whatsapp, day, nowMs); action = "sent"; }
        else if (d?.action === "held") { await writeMarketAskMarker(env, t.whatsapp, day, null); action = "held"; }
      }
    } catch (e) {
      console.warn(`[market-ask] ${t.name} failed`, (e as Error)?.message);
    }
    await finishButton(env, claim, 26 * 60 * 60);
    asks.push({ name: t.name, action });
    console.log(`[market-ask] ${day} ${t.name}: ${action}`);
  }
  return { action: "ran", asks };
}

/** The team queue flushed an ask (src/team-queue.ts): today's reaches the member now; another day's is dropped. */
export async function onQueuedAskFlushed(env: Env, to: string, askDay: unknown, nowMs: number = Date.now()): Promise<boolean> {
  const day = riyadhDateKey(new Date(nowMs));
  if (askDay !== day) return false;
  await writeMarketAskMarker(env, to, day, nowMs);
  return true;
}

/**
 * Is this message a reply to today's ask? Within MARKET_REPLY_WINDOW_MIN of the
 * ask reaching the number. An ask the gateway held reaches it with the number's
 * own message (the flush before routing): that message starts the window.
 */
export async function awaitingMarketReply(env: Env, digits: string, nowMs: number = Date.now()): Promise<boolean> {
  const m = await readMarker(env, digits);
  const day = riyadhDateKey(new Date(nowMs));
  if (!m || m.day !== day) return false;
  if (m.at === null) { await writeMarketAskMarker(env, digits, day, nowMs); return false; }
  return nowMs - m.at >= 0 && nowMs - m.at <= MARKET_REPLY_WINDOW_MIN * MIN;
}

/** The active catalog (active, for sale, x_is_active_for_sale) with its packagings. */
export async function activeCatalog(env: Env): Promise<{ products: Array<{ id: number; name: string }>; packagings: Array<{ id: number; name: string; product_id: number; is_default: boolean }> }> {
  const ids = (await call<Array<{ id: number }>>(env, "product.template", "search_read", {
    domain: [["active", "=", true], ["sale_ok", "=", true], ["x_is_active_for_sale", "=", true]], fields: ["id"], limit: 500,
  })).map((r) => r.id);
  return ids.length ? await fetchSupplierCatalog(env, ids) : { products: [], packagings: [] };
}

/**
 * A source's reply inside the window: its prices saved as offers, and the
 * acknowledgement text. Null → not read as prices (an ordinary message).
 */
export async function handleMarketReply(
  env: Env,
  src: { partnerId: number; employeeId?: number | null; name: string; digits: string },
  text: string,
  messageId: string,
  nowMs: number = Date.now(),
): Promise<{ saved: number; reply: string } | null> {
  if (!(await awaitingMarketReply(env, src.digits, nowMs))) return null;
  const { products, packagings } = await activeCatalog(env);
  if (!products.length) return null;
  const { extractSupplierPrices } = await import("./claude");
  let items: SupplierPriceItem[] = [];
  try {
    items = (await extractSupplierPrices(env, { supplierName: src.name, replyText: text, products, packagings })).prices;
  } catch (e) {
    console.warn("[market-reply] extract failed — an ordinary message", (e as Error)?.message);
    return null;
  }
  const check = checkOfferItems(items, products, packagings, text, "observer");
  if (!check.kept.length) return null;
  const day = riyadhDateKey(new Date(nowMs));
  let saved = 0;
  for (const k of check.kept) {
    try {
      await saveOffer(env, {
        partnerId: src.partnerId, employeeId: src.employeeId ?? null, productId: k.product_id, packagingId: k.packaging_id,
        purchase: k.purchase, market: k.market, qty: k.qty, messageId, text,
      }, day);
      saved++;
    } catch (e) {
      console.error("[market-reply] offer write failed", (e as Error)?.message);
    }
  }
  if (!saved) return null;
  if (check.dropped.length) console.log(`[market-reply] ${src.name}: dropped ${check.dropped.map((d) => `${d.item.product_id}:${d.reason}`).join(", ")}`);
  try {
    const { refreshPriceDay } = await import("./prices");
    await refreshPriceDay(env, { now: nowMs });
  } catch (e) {
    console.warn("[market-reply] prices refresh failed", (e as Error)?.message);
  }
  return { saved, reply: marketAckText(saved) };
}

/** The inbound hook: a flagged employee (by Work Contact) or partner inside its window. */
export async function tryMarketReply(
  env: Env,
  who: { partnerId: number; employeeId?: number | null; name: string },
  from: string,
  text: string,
  messageId: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!text || !who.partnerId) return null;
  const digits = waDigits(from);
  const marker = await readMarker(env, digits);
  if (!marker || marker.day !== riyadhDateKey(new Date(nowMs))) return null; // the cheap check first
  const src = await loadPriceSources(env);
  const emp = src.employees.find((e) => e.partnerId === who.partnerId);
  if (!emp && !src.partners.some((p) => p.partnerId === who.partnerId && !p.supplier)) return null;
  const r = await handleMarketReply(env, { partnerId: who.partnerId, employeeId: emp?.employeeId ?? who.employeeId ?? null, name: who.name, digits }, text, messageId, nowMs);
  return r?.reply ?? null;
}
