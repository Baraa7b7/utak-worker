// § 66 (2026-10-08) — from «العميل وافق» to an order that is bought, delivered
// and invoiced: the acceptance of a special request (§ 62) and its conversion.
//
// A special request ended at «صدر العرض» with a draft sale.order. From here:
//
//   • «✅ العميل وافق» (approveSpecialQuote) opens the acceptance ON THE REQUEST:
//     «تاريخ التسليم» (the next working day of «جدول أيام العمل» an order placed
//     now can be delivered on), «الكمية المؤكدة» of every line, «طريقة الدفع»
//     from the customer's card, and the delivery note. Nothing is converted.
//   • «📦 حوّل لطلب» (convertSpecialQuote) makes the day's order (x_daily_order)
//     of the delivery date: the confirmed quantities at the quotation's final,
//     VAT-inclusive prices — LOCKED on the lines («سعر خاص»: the line carries its
//     price as its manual price too, and freezeOrderPrices never touches it), so
//     no publication of a day's prices and no recalculation changes them. Items
//     that are not «نشط للبيع» are taken in this order alone. The linked sale
//     order takes the confirmed quantities and is confirmed (ACCOUNTING_SYNC):
//     its lines become the sale-accounting's service lines keyed by the order's
//     lines, so the delivery bills it as it bills any order. The request becomes
//     «مقبول — تحوّل لطلب» with the order's link. Never twice.
//   • Never from a customer's message: «موافق / نعتمد / أكدوا الطلب …» from a
//     customer who holds a valid issued quotation is ONE alert to Baraa with the
//     request's link (noticeAcceptance) — the customer's usual reply follows.
//   • An expired quotation is refused, unless Baraa ticked «أعتمد الأسعار رغم
//     انتهاء الصلاحية» — and that is written on the order's notes.
//   • A unit-price quotation (every quantity 1) names no quantity: «الكمية
//     المؤكدة» must be typed for every line (0 = the line is out of the order).
//   • An order of «حد الطلب الكبير» cartons or more (the settings; 50): Baraa is
//     told at the conversion and once on the morning of its delivery.
//
// A request flagged «محاكاة» converts too: its order and lines carry the flag
// (every list, total and invoice leaves them out, as always), no sale order is
// made or confirmed, and what the customer would read goes to Baraa's own
// number, marked «🧪 محاكاة». Its partner is never written to.

import type { Env } from "./config";
import { call, getPartnerLocation, getPartnerNeighborhood, setOrderLocation } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { addDaysYmd, deliveryDayOf, nextOrderingDate, riyadhDateKey, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";
import { isKiloUnit, round2 } from "./special-quote-math";
import { QUOTE_MODEL, nowOdoo, readQuote, recalcQuote, writeResult, type QuoteLine, type SpecialQuote } from "./special-quote";
import { OWNER_SPECIAL_PURPOSE, odooMs, quotationLayout, validUntilText } from "./special-quotation";
import { dayLabel, notifyOwnerConfirmed } from "./order-flow";
import { itemDetail } from "./quotation";
import { T, sendOwnerAlert, sendOwnerCritical, sendOwnerMessage } from "./templates";

export const ORDER_MODEL = "x_daily_order";
export const ORDER_LINE_MODEL = "x_daily_order_line";
const SIM_FIELD = "x_utak_simulation";
export const CONVERT_LOCK_SECONDS = 90;
/** «حد الطلب الكبير» while the settings hold none. */
export const LARGE_ORDER_DEFAULT = 50;
export const LARGE_ORDER_FIELD = "x_large_order_cartons";
/** The morning alert of a large order: from the start of the operating day (02:00 Riyadh) of its delivery. */
export const LARGE_MORNING_MINUTE = 2 * 60;
const LARGE_KV = "sq_large:v1";
const LARGE_TTL = 4 * 24 * 3600;
export const SIM_MARK = "🧪 محاكاة";
export const APPROVE_BUTTON = "✅ العميل وافق";
export const CONVERT_BUTTON = "📦 حوّل لطلب";
export const EXPIRED_BOX = "أعتمد الأسعار رغم انتهاء الصلاحية";
export const PAY_TERMS_LABEL: Readonly<Record<string, string>> = { cash: "نقد عند الاستلام", daily_transfer: "تحويل يومي", credit: "آجل" };
const asPayTerms = (v: unknown): string => (typeof v === "string" && v in PAY_TERMS_LABEL ? v : "");

type M2O = [number, string] | number | false | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);
const money = (x: number): string => { const n = round2(x); return Number.isInteger(n) ? String(n) : n.toFixed(2); };
const qtyText = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

// ---------------------------------------------------------------- pure: the confirmed quantities

/**
 * «الكمية المؤكدة» as typed: a number of at most three decimals, Arabic digits and the Arabic decimal sign
 * read. null = nothing typed (empty is NOT zero); "invalid" = something that is not a quantity.
 */
export function parseConfirmedQty(raw: string): number | null | "invalid" {
  const t = String(raw ?? "").trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
  if (!t) return null;
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(t)) return "invalid";
  return Number(t);
}

export interface ConfirmedLine { line: QuoteLine; qty: number }
export interface ConfirmedPlan {
  /** The lines of the order: a confirmed quantity above zero. */
  lines: ConfirmedLine[];
  /** Confirmed 0: out of the order. */
  out: string[];
  /** A unit-price quotation's line with nothing typed. */
  missing: string[];
  invalid: string[];
}
/**
 * Each line's confirmed quantity. Nothing typed: the line's own quantity in a quotation by quantities, and
 * MISSING in a unit-price one (its «1» is a unit, not an order) — unless the line itself asked for more than one.
 */
export function confirmedPlan(q: Pick<SpecialQuote, "layout" | "lines">): ConfirmedPlan {
  const unit = quotationLayout(q) === "unit";
  const plan: ConfirmedPlan = { lines: [], out: [], missing: [], invalid: [] };
  for (const l of q.lines) {
    const name = l.productName || "صنف";
    const typed = parseConfirmedQty(l.confirmedQty);
    if (typed === "invalid") { plan.invalid.push(name); continue; }
    if (typed === null && unit && !(l.qty > 1)) { plan.missing.push(name); continue; }
    const qty = typed === null ? l.qty : typed;
    if (qty > 0) plan.lines.push({ line: l, qty });
    else plan.out.push(name);
  }
  return plan;
}
/** «إجمالي الطلب المؤكد»: each confirmed line at its VAT-inclusive final price — what its invoice adds up to, delivered whole. */
export const confirmedTotal = (lines: ConfirmedLine[]): number => round2(lines.reduce((s, x) => s + round2(x.qty * x.line.finalPrice), 0));

// ---------------------------------------------------------------- pure: the dates

/** The quotation's «صالح حتى» has passed. A request that carries none never expires. */
export function isExpired(validUntil: string, now: number): boolean {
  const ms = odooMs(validUntil);
  return Number.isFinite(ms) && ms < now;
}
/** The first morning an order placed now can be delivered: the day after its ordering day (after 21:00, a day later). */
export const earliestDeliveryDay = (now: number): string => deliveryDayOf(nextOrderingDate(new Date(now)));
/** The first day from `from` that `works` — `from` itself when it does; after two weeks of none, `from`. */
export function nextWorkingDay(from: string, works: (day: string) => boolean): string {
  for (let i = 0, d = from; i < 14; i++, d = addDaysYmd(d, 1)) if (works(d)) return d;
  return from;
}
/** «تاريخ التسليم» of a new acceptance: the earliest delivery day, moved to a working day of «جدول أيام العمل». */
export async function defaultDeliveryDay(env: Env, now: number): Promise<string> {
  const from = earliestDeliveryDay(now);
  try {
    const { companySchedule, isWorkingDay } = await import("./operating-cost");
    const s = await companySchedule(env, riyadhDateKey(new Date(now)), now);
    // no schedule named, or one not filled in: every day is a delivery day
    if (!s || !s.lines.length) return from;
    return nextWorkingDay(from, (d) => isWorkingDay(s, d));
  } catch (e) {
    console.warn("[special-accept] «جدول أيام العمل» could not be read — the earliest delivery day", (e as Error)?.message);
    return from;
  }
}

// ---------------------------------------------------------------- pure: the cartons of a large order

/**
 * A line's cartons: its quantity — «التعبئة» is the unit it is bought and carried in — except a line sold by
 * the kilo, whose cartons are its kilos ÷ the item's packaging weight (unknown weight: its kilos are told apart).
 */
export function lineCartons(qty: number, unit: string, packKg: number): { cartons: number; kilos: number } {
  if (!isKiloUnit(unit)) return { cartons: qty, kilos: 0 };
  return packKg > 0 ? { cartons: qty / packKg, kilos: 0 } : { cartons: 0, kilos: qty };
}
export function orderCartons(lines: Array<{ qty: number; unit: string; packKg: number }>): { cartons: number; kilos: number } {
  const sum = lines.map((l) => lineCartons(l.qty, l.unit, l.packKg)).reduce((a, c) => ({ cartons: a.cartons + c.cartons, kilos: a.kilos + c.kilos }), { cartons: 0, kilos: 0 });
  return { cartons: Math.ceil(sum.cartons - 1e-9), kilos: round2(sum.kilos) };
}
/** «🚚 طلب كبير {N} كرتون: رتّب المركبة». */
export const largeOrderText = (cartons: number, kilos: number, tail: string): string =>
  `🚚 طلب كبير ${cartons} كرتون${kilos > 0 ? ` و${qtyText(kilos)} كيلو` : ""}: رتّب المركبة${tail ? ` — ${tail}` : ""}`;

/** «حد الطلب الكبير» of the day's settings; the default when they hold none or cannot be read. */
export async function largeOrderLimit(env: Env, day: string): Promise<number> {
  try {
    const [r] = await call<Array<Record<string, unknown>>>(env, "x_pricing_config", "search_read", {
      domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
      fields: ["id", LARGE_ORDER_FIELD], order: "x_active_from desc, id desc", limit: 1,
    });
    const n = Number(r?.[LARGE_ORDER_FIELD]) || 0;
    return n > 0 ? Math.floor(n) : LARGE_ORDER_DEFAULT;
  } catch (e) {
    console.warn("[special-accept] «حد الطلب الكبير» could not be read — the default", (e as Error)?.message);
    return LARGE_ORDER_DEFAULT;
  }
}

// ---------------------------------------------------------------- pure: a customer's acceptance in his own words

const normal = (s: string): string => String(s ?? "")
  .replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
const ACCEPT_RE = /(?:^| )(?:موافق(?:ين|ون|ه)?|نوافق|وافقنا|نعتمد|اعتمد(?:وا|نا|ناه|وه|ه|ها)?|معتمد|اكد(?:وا|نا)? الطلب|ناكد الطلب|تاكيد الطلب|اكدوا|ثبت(?:وا)? الطلب|نثبت الطلب|نمشي عليه|توكلنا علي الله|علي بركه الله|ok|okay|approved|confirm(?:ed)?|go ahead)(?: |$)/;
const REFUSE_RE = /(?:^| )(?:غير|مو|مش|ما|لا|لسنا|لست|مب|ماني|ما احنا|not|no|don t|dont) (?:\S+ )?(?:موافق|نوافق|نعتمد|اعتمد|معتمد|ناكد|confirm|approved|ok)/;
/** «موافق / نعتمد / تمام اعتمدوا / أكدوا الطلب …» — and not its refusal («غير موافق», «ما نعتمد»). A hint, never a decision. */
export function looksLikeAcceptance(text: string): boolean {
  const t = normal(text);
  if (!t || t.length > 400) return false;
  return ACCEPT_RE.test(t) && !REFUSE_RE.test(t);
}

// ---------------------------------------------------------------- Odoo: the request's link

const ACTION_NAME = "UTAK — طلبات أسعار خاصة";
const ACTION_KV = "sq_action:v1";
/** A link that opens the request in «🧾 طلبات أسعار خاصة» (the action's id is read once a day; without it, the list). */
export async function quoteUrl(env: Env, quoteId: number): Promise<string> {
  const base = String(env.ODOO_URL || "").replace(/\/+$/, "");
  let actionId = 0;
  try { actionId = Number(await env.MSG_DEDUP.get(ACTION_KV)) || 0; } catch { /* read Odoo */ }
  if (!actionId) {
    try {
      const [a] = await call<Array<{ id: number }>>(env, "ir.actions.act_window", "search_read", { domain: [["name", "=", ACTION_NAME], ["res_model", "=", QUOTE_MODEL]], fields: ["id"], limit: 1 });
      actionId = a?.id ?? 0;
      if (actionId) await env.MSG_DEDUP.put(ACTION_KV, String(actionId), { expirationTtl: 24 * 3600 }).catch(() => {});
    } catch (e) {
      console.warn("[special-accept] the requests' action could not be read — the link goes without it", (e as Error)?.message);
    }
  }
  return actionId ? `${base}/odoo/action-${actionId}/${quoteId}` : `${base}/odoo`;
}

/** «✅ {العميل} يبدو موافقاً على {رقم العرض}»: Baraa's ONE alert of a quotation. */
export const acceptanceAlertText = (customer: string, number: string, url: string): string =>
  [`✅ ${customer || "العميل"} يبدو موافقاً على ${number}`, url, `لو وافق: افتح الطلب واضغط «${APPROVE_BUTTON}» ثم «${CONVERT_BUTTON}». (لم يتحوّل شيء، ولم يُرد عليه بغير الرد المعتاد.)`].join("\n");

/**
 * An alert to Baraa that must not be lost: true when it went to his chat or is held for his window; false when the
 * gateway did not take it (a purpose Meta refused for his number is skipped for 24 hours — the caller tries again).
 */
async function ownerAlerted(env: Env, text: string): Promise<boolean> {
  // § 67 د — an important alert: Meta's refusal never blocks it and never drops it (queued and tried again);
  // each one is its own kind (its text names its request), so two requests never fold into one line
  return (await sendOwnerCritical({ ...env, AUTO_SEND_JOB: undefined } as Env, text, { kind: `special:${text.slice(0, 60)}` })).taken;
}

export interface AcceptanceNotice { quoteId: number; number: string; action: "alerted" | "alerted_before" | "not_delivered" }
/**
 * A customer wrote what reads as an acceptance: every quotation issued to him that is still valid and not
 * accepted yet gets ONE alert to Baraa (a KV claim a quotation). Nothing is converted, nothing is answered.
 * A simulation's request never alerts. Never throws.
 */
export async function noticeAcceptance(env: Env, partner: { id: number; name: string }, now: number = Date.now()): Promise<AcceptanceNotice[]> {
  const out: AcceptanceNotice[] = [];
  try {
    if (!(partner.id > 0)) return out;
    const rows = await call<Array<Record<string, unknown>>>(env, QUOTE_MODEL, "search_read", {
      domain: [["x_partner_id", "=", partner.id], ["x_state", "=", "quoted"], [SIM_FIELD, "!=", true]],
      fields: ["id", "x_name", "x_quotation_number", "x_valid_until", "x_accepted_at"], order: "id desc", limit: 5,
    });
    for (const r of rows) {
      const id = Number(r.id);
      // past its «صالح حتى», or Baraa already pressed «✅ العميل وافق»: nothing to tell him
      if (isExpired(String(r.x_valid_until || ""), now) || r.x_accepted_at) continue;
      const number = String(r.x_quotation_number || r.x_name || `#${id}`);
      const claim = await claimButton(env, `sq_accept_notice:${id}`, 14 * 24 * 3600);
      if (!claim.claimed) { out.push({ quoteId: id, number, action: "alerted_before" }); continue; }
      // the quotation's ONE alert is used up only when it reached him: one the gateway skipped is tried again at his next «موافق»
      if (await ownerAlerted(env, acceptanceAlertText(partner.name, number, await quoteUrl(env, id)))) {
        await finishButton(env, claim, 14 * 24 * 3600);
        out.push({ quoteId: id, number, action: "alerted" });
      } else {
        await releaseButton(env, claim);
        out.push({ quoteId: id, number, action: "not_delivered" });
      }
    }
  } catch (e) {
    console.warn(`[special-accept] the acceptance notice of partner ${partner.id} failed`, (e as Error)?.message);
  }
  return out;
}

// ---------------------------------------------------------------- «✅ العميل وافق»

export interface AcceptOutcome { action: string; detail?: string; orderId?: number }

/**
 * «✅ العميل وافق»: the acceptance opens on the request — the time, the delivery date, the customer's payment
 * terms and each line's confirmed quantity where the quotation names one — each only where nothing is written
 * yet (what Baraa typed stays). ONE write. Nothing is converted and no message is sent.
 */
export async function approveSpecialQuote(env: Env, quoteId: number, opts: { now?: number } = {}): Promise<AcceptOutcome> {
  const now = opts.now ?? Date.now();
  const q = await readQuote(env, quoteId);
  if (!q) return { action: "not_found" };
  const refuse = async (why: string): Promise<AcceptOutcome> => {
    await writeResult(env, quoteId, `🚫 لم يُسجَّل القبول: ${why}`, now);
    return { action: "refused", detail: why };
  };
  if (q.state === "closed") return refuse("الطلب مغلق");
  if (q.state === "accepted") return refuse(`الطلب مقبول وتحوّل إلى الطلب #${q.accept.orderId}`);
  if (q.state !== "quoted") return refuse("العرض لم يصدر بعد: اضغط «📄 أصدر عرض السعر» أولاً");

  const vals: Record<string, unknown> = {};
  if (!q.accept.at) vals.x_accepted_at = nowOdoo(now);
  const deliveryDate = q.accept.deliveryDate || (await defaultDeliveryDay(env, now));
  if (!q.accept.deliveryDate) vals.x_delivery_date = deliveryDate;
  if (!q.accept.payTerms && q.partnerId) {
    try {
      const [p] = await call<Array<{ id: number; x_pay_terms: string | false }>>(env, "res.partner", "read", { ids: [q.partnerId], fields: ["id", "x_pay_terms"] });
      const terms = asPayTerms(p?.x_pay_terms);
      if (terms) vals.x_pay_terms = terms;
    } catch (e) {
      console.warn(`[special-accept] ${quoteId}: the customer's payment terms could not be read — left empty`, (e as Error)?.message);
    }
  }
  // «افتراضها الكمية إن > 1»: a line that asked for a quantity confirms it; a quotation by quantities, every line's
  const unit = quotationLayout(q) === "unit";
  const filled = q.lines.map((l) => (!l.confirmedQty && l.qty > 0 && (l.qty > 1 || !unit) ? { ...l, confirmedQty: qtyText(l.qty) } : l));
  const commands = filled.filter((l, i) => l.confirmedQty !== q.lines[i].confirmedQty).map((l) => [1, l.id, { x_confirmed_qty: l.confirmedQty }]);
  if (commands.length) vals.x_line_ids = commands;
  const plan = confirmedPlan({ layout: q.layout, lines: filled });
  const total = confirmedTotal(plan.lines);
  if (Math.abs(total - q.accept.total) > 0.004) vals.x_confirmed_total = total;
  if (Object.keys(vals).length) await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals });

  const text = [
    `✅ سُجّل قبول العميل. راجع «تاريخ التسليم» (${dayLabel(deliveryDate)}) و«الكمية المؤكدة» و«طريقة الدفع» ثم اضغط «${CONVERT_BUTTON}»`,
    plan.missing.length ? `اكتب «الكمية المؤكدة» لكل سطر (0 = خارج الطلب): ${plan.missing.length} بلا كمية` : "",
    isExpired(q.validUntil, now) ? `⚠️ انتهت صلاحية العرض (${validUntilText(q.validUntil)}): أشّر «${EXPIRED_BOX}» ليتحوّل` : "",
  ].filter(Boolean).join(" · ");
  await writeResult(env, quoteId, text, now);
  return { action: "approved", detail: `delivery=${deliveryDate} filled=${commands.length} missing=${plan.missing.length}` };
}

// ---------------------------------------------------------------- «📦 حوّل لطلب»

/** The order as the customer is told of it: its number, its delivery morning, its total. */
export const customerConfirmText = (orderId: number, deliveryDate: string, total: number, quotation: string): string => [
  `تم تأكيد طلبك رقم #${orderId} ✅${quotation ? ` (عرض السعر ${quotation})` : ""}`,
  `🚚 التسليم: صباح ${dayLabel(deliveryDate)}`,
  `الإجمالي: ${money(total)} ر.س شامل ضريبة القيمة المضافة`,
  "شكراً لاختيارك يو تاك 🌿",
].join("\n");
/** utak_order_confirmed's two variables: the order's number, and «صباح …». */
export const confirmTemplateParams = (orderId: number, deliveryDate: string): string[] => [String(orderId), `صباح ${dayLabel(deliveryDate)}`];
export const alreadyConvertedText = (orderId: number): string => `سبق تحويله إلى الطلب #${orderId}: لا يتحوّل مرتين`;
export const tooEarlyText = (deliveryDate: string, earliest: string): string =>
  `«تاريخ التسليم» ${dayLabel(deliveryDate)} فات موعد قائمة شرائه (الساعة 9:00 مساء اليوم الذي قبله): أقرب تسليم صباح ${dayLabel(earliest)}`;
export const expiredText = (validUntil: string): string =>
  `انتهت صلاحية العرض (${validUntilText(validUntil)}): أشّر «${EXPIRED_BOX}» ثم أعد، أو أصدر عرضاً جديداً`;
/** What the order's notes keep of an expired quotation converted by Baraa's own tick. */
export const expiredRecord = (validUntil: string, now: number): string =>
  `اعتُمدت الأسعار بعد انتهاء صلاحية العرض (كان صالحاً حتى ${validUntilText(validUntil)}) بتأشير براء «${EXPIRED_BOX}» — ${validUntilText(nowOdoo(now))}`;

interface Pack { id: number; kg: number; isDefault: boolean }
/** Each item's packaging for the order's line (the line needs one): its default, else its first. */
async function packagingOf(env: Env, productIds: number[]): Promise<Map<number, Pack>> {
  const rows = productIds.length ? await call<Array<{ id: number; x_product_tmpl_id: M2O; x_is_default: boolean; x_approx_weight_kg: number | false }>>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", productIds]], fields: ["id", "x_product_tmpl_id", "x_is_default", "x_approx_weight_kg"], order: "x_sequence asc, id asc", limit: 1000,
  }) : [];
  const out = new Map<number, Pack>();
  for (const r of rows) {
    const p = m2oId(r.x_product_tmpl_id), isDefault = r.x_is_default === true, have = out.get(p);
    if (!have || (isDefault && !have.isDefault)) out.set(p, { id: r.id, kg: Number(r.x_approx_weight_kg) || 0, isDefault });
  }
  return out;
}
/** The purchase source whose price IS the line's «الشراء» (the lowest sent); 0 = Baraa typed another, or none sent one. */
export function purchaseSupplier(l: Pick<QuoteLine, "obs" | "purchase">): number {
  const hit = Object.entries(l.obs.purchase).filter(([, v]) => Math.abs(v.p - l.purchase) < 0.005).sort((a, b) => a[1].at - b[1].at)[0];
  return hit ? Number(hit[0]) || 0 : 0;
}

/** The order is still there and not cancelled. Unreadable: taken as there (never a second order on a doubt). */
async function liveOrder(env: Env, orderId: number): Promise<boolean> {
  try {
    const [o] = await call<Array<{ id: number; x_state: string }>>(env, ORDER_MODEL, "search_read", { domain: [["id", "=", orderId]], fields: ["id", "x_state"], limit: 1 });
    return !!o && o.x_state !== "cancelled";
  } catch {
    return true;
  }
}

/** The sequence of a sale-order line that is outside the order: far above any order line's id (the delivery's key). */
export const OUT_LINE_SEQUENCE = 9_000_000;

/**
 * The linked quotation becomes the order's sale order (ACCOUNTING_SYNC): its lines take the confirmed
 * quantities at their locked prices as the sale-accounting's own service lines — «الصنف — التعبئة» in the
 * text, the order line's id as the key the delivery bills by — a line outside the order goes to quantity 0
 * and price 0 (nothing is deleted), then it is confirmed and linked on the order. A quotation that is not a
 * draft any more (or is not there) is left alone: the order gets its sale order at the delivery, as any order.
 * Returns a line for «آخر نتيجة». NEVER throws.
 */
export async function confirmSaleOrder(env: Env, q: SpecialQuote, orderId: number, made: Array<{ orderLineId: number; line: QuoteLine; qty: number }>, now: number): Promise<string> {
  const { isAccountingSyncEnabled, resolveSaleTaxForDate, todayRiyadhYmd } = await import("./accounting");
  if (!isAccountingSyncEnabled(env)) return "";
  const standard = async (why: string): Promise<string> => {
    const { ensureSaleOrderForDailyOrder } = await import("./sale-accounting");
    const r = await ensureSaleOrderForDailyOrder(env, orderId);
    return `أمر البيع: ${why}${r ? ` — أُنشئ للطلب أمر بيع جديد (#${r.saleOrderId})` : " — وصلك تنبيهه"}`;
  };
  try {
    const { SALE_GOODS_PRODUCT_CODE, saleLineDescription } = await import("./sale-accounting");
    const [so] = q.saleOrderId ? await call<Array<{ id: number; name: string; state: string; order_line: number[] }>>(env, "sale.order", "search_read", {
      domain: [["id", "=", q.saleOrderId]], fields: ["id", "name", "state", "order_line"], limit: 1,
    }) : [];
    if (!so) return standard("لا عرض سعر مسجَّل لهذا الطلب");
    if (so.state !== "draft" && so.state !== "sent") return standard(`${so.name} ليس عرضاً مفتوحاً (${so.state})`);
    const [service] = await call<Array<{ id: number }>>(env, "product.product", "search_read", { domain: [["default_code", "=", SALE_GOODS_PRODUCT_CODE], ["type", "=", "service"]], fields: ["id"], limit: 1 });
    if (!service) return standard(`منتج الخدمة ${SALE_GOODS_PRODUCT_CODE} غير موجود`);
    const tax = await resolveSaleTaxForDate(env, todayRiyadhYmd(new Date(now)));
    const old = so.order_line.length ? await call<Array<{ id: number; product_id: M2O; x_pack_text: string | false }>>(env, "sale.order.line", "read", { ids: so.order_line, fields: ["id", "product_id", "x_pack_text"] }) : [];
    const tmplOf = new Map<number, number>();
    const variants = old.length ? await call<Array<{ id: number; product_tmpl_id: M2O }>>(env, "product.product", "search_read", {
      domain: [["id", "in", [...new Set(old.map((o) => m2oId(o.product_id)))]]], fields: ["id", "product_tmpl_id"], limit: 500, context: { active_test: false },
    }) : [];
    for (const v of variants) tmplOf.set(v.id, m2oId(v.product_tmpl_id));
    const free = [...old];
    const commands: unknown[] = [];
    for (const m of made) {
      const vals = {
        product_id: service.id, name: saleLineDescription(m.line.productName || "صنف", m.line.unit), product_uom_qty: m.qty, price_unit: m.line.finalPrice,
        tax_ids: [[6, 0, tax ? [tax.id] : []]], sequence: m.orderLineId,
      };
      // the quotation's own line of this item: by its item AND its «التعبئة» first (one item may stand on two lines), then by its item
      const same = (o: (typeof old)[number]) => tmplOf.get(m2oId(o.product_id)) === m.line.productId;
      let i = free.findIndex((o) => same(o) && String(o.x_pack_text || "") === m.line.unit);
      if (i < 0) i = free.findIndex(same);
      if (i >= 0) commands.push([1, free.splice(i, 1)[0].id, vals]);
      else commands.push([0, 0, { ...vals, x_pack_text: m.line.unit || false, x_item_origin: m.line.origin || false, x_item_size: m.line.size || false }]);
    }
    // outside the order: quantity 0 and price 0, under a key no order line carries
    free.forEach((o, i) => commands.push([1, o.id, { product_uom_qty: 0, price_unit: 0, sequence: OUT_LINE_SEQUENCE + i }]));
    await call<boolean>(env, "sale.order", "write", { ids: [so.id], vals: { client_order_ref: `UTAK-ORDER-${orderId}`, order_line: commands } });
    await call<unknown>(env, "sale.order", "action_confirm", { ids: [so.id] });
    const [after] = await call<Array<{ id: number; state: string; picking_ids: number[] }>>(env, "sale.order", "read", { ids: [so.id], fields: ["id", "state", "picking_ids"] });
    if (after?.state !== "sale" || (after.picking_ids ?? []).length) {
      const why = after?.state !== "sale" ? `حالته ${after?.state ?? "?"} بعد التأكيد` : `أنشأ حركة مخزون (${after.picking_ids.join("،")})`;
      await sendOwnerAlert(env, `⚠️ أمر البيع ${so.name} للطلب #${orderId} (${q.name}): ${why} — لم يُربط بالطلب: راجعه في Odoo، والطلب يأخذ أمر بيعه عند التسليم.`).catch(() => {});
      return `⚠️ أمر البيع ${so.name}: ${why} — لم يُربط`;
    }
    await call<boolean>(env, ORDER_MODEL, "write", { ids: [orderId], vals: { x_sale_order_id: so.id } });
    return `أمر البيع ${so.name} أُكّد بالكميات المؤكدة`;
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    console.error(`[special-accept] ${q.id}: the sale order of order ${orderId} failed`, why);
    await sendOwnerAlert(env, `⚠️ أمر بيع الطلب #${orderId} (${q.name}) لم يُؤكَّد: ${why.slice(0, 200)} — الطلب قائم، ويأخذ أمر بيعه عند التسليم.`).catch(() => {});
    return "⚠️ أمر البيع لم يُؤكَّد (وصلك تنبيهه): الطلب قائم";
  }
}
export interface ConvertResult extends AcceptOutcome { to?: "customer_session" | "customer_template" | "owner_instead" | "owner_simulation"; total?: number; cartons?: number }

/**
 * «📦 حوّل لطلب»: the accepted request becomes the day's order of its delivery date. See the head of this file.
 * Refused — with its reason on «آخر نتيجة», and nothing written — for a request that is not issued, not accepted,
 * expired without Baraa's tick, converted already, dated before an order placed now can be delivered, or whose
 * confirmed quantities cannot be read.
 */
export async function convertSpecialQuote(env: Env, quoteId: number, opts: { now?: number; ctx?: ExecutionContext } = {}): Promise<ConvertResult> {
  const now = opts.now ?? Date.now();
  const lock = await claimButton(env, `spq_convert:${quoteId}`, CONVERT_LOCK_SECONDS);
  if (!lock.claimed) return { action: "busy", detail: "pressed a moment ago" };
  let orderId = 0;
  try {
    if (!(await recalcQuote(env, quoteId, { now }))) { await releaseButton(env, lock); return { action: "not_found" }; }
    const q = (await readQuote(env, quoteId))!;
    const refuse = async (why: string): Promise<ConvertResult> => {
      await writeResult(env, quoteId, `🚫 لم يتحوّل لطلب: ${why}`, now);
      await releaseButton(env, lock);
      return { action: "refused", detail: why };
    };
    if (q.state === "closed") return refuse("الطلب مغلق");
    // never twice: the request says so, and so does the order it points at while that order stands
    if (q.state === "accepted") return refuse(alreadyConvertedText(q.accept.orderId));
    if (q.accept.orderId && (await liveOrder(env, q.accept.orderId))) return refuse(alreadyConvertedText(q.accept.orderId));
    if (q.state !== "quoted") return refuse("العرض لم يصدر بعد: اضغط «📄 أصدر عرض السعر» أولاً");
    if (!q.accept.at) return refuse(`اضغط «${APPROVE_BUTTON}» أولاً`);
    if (!q.partnerId) return refuse("لا عميل على الطلب");
    const expired = isExpired(q.validUntil, now);
    if (expired && !q.accept.expiredOk) return refuse(expiredText(q.validUntil));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.accept.deliveryDate)) return refuse("لا «تاريخ التسليم» على الطلب");
    const earliest = earliestDeliveryDay(now);
    if (q.accept.deliveryDate < earliest) return refuse(tooEarlyText(q.accept.deliveryDate, earliest));
    const plan = confirmedPlan(q);
    if (plan.invalid.length) return refuse(`«الكمية المؤكدة» لا تُقرأ: ${plan.invalid.join("، ")}`);
    if (plan.missing.length) return refuse(`عرض أسعار وحدة: اكتب «الكمية المؤكدة» لكل سطر (0 = خارج الطلب). بلا كمية: ${plan.missing.join("، ")}`);
    if (!plan.lines.length) return refuse("كل الكميات المؤكدة صفر: لا شيء يتحوّل لطلب");
    const noPrice = plan.lines.filter((x) => !(x.line.finalPrice > 0)).map((x) => x.line.productName || "صنف");
    if (noPrice.length) return refuse(`أسطر بلا سعر نهائي: ${noPrice.join("، ")}`);
    const packs = await packagingOf(env, [...new Set(plan.lines.map((x) => x.line.productId))]);
    const noPack = plan.lines.filter((x) => !packs.has(x.line.productId)).map((x) => x.line.productName || "صنف");
    if (noPack.length) return refuse(`لا عبوة في Odoo للصنف (أضفها من «📦 الأصناف»): ${[...new Set(noPack)].join("، ")}`);

    const deliveryDate = q.accept.deliveryDate;
    const total = confirmedTotal(plan.lines);
    const terms = PAY_TERMS_LABEL[q.accept.payTerms] ?? "";
    const notes = [
      `طلب أسعار خاص ${q.name}${q.quotationNumber ? ` — عرض السعر ${q.quotationNumber}` : ""}`,
      terms ? `طريقة الدفع: ${terms}` : "",
      q.accept.note ? `ملاحظة التسليم: ${q.accept.note}` : "",
      expired ? expiredRecord(q.validUntil, now) : "",
    ].filter(Boolean).join("\n");
    // the order's day is the eve of its delivery: its 21:15 purchase list is the delivery's
    const [created] = await call<number[]>(env, ORDER_MODEL, "create", {
      vals_list: [{
        x_customer_id: q.partnerId, x_order_date: addDaysYmd(deliveryDate, -1), x_state: "draft", x_created_via: "manual",
        x_special_quote_id: quoteId, x_delivery_notes: notes, x_total_amount: total, ...(q.simulation ? { [SIM_FIELD]: true } : {}),
      }],
    }, { probe: [["x_special_quote_id", "=", quoteId], ["x_state", "=", "draft"], ["id", ">", q.accept.orderId || 0]] });
    orderId = created;
    const lineIds = await call<number[]>(env, ORDER_LINE_MODEL, "create", {
      vals_list: plan.lines.map(({ line: l, qty }) => {
        const supplier = purchaseSupplier(l);
        return {
          x_order_id: orderId, x_product_tmpl_id: l.productId, x_packaging_id: packs.get(l.productId)!.id, x_quantity: qty, x_status: "pending",
          // the quotation's final VAT-inclusive price, as the line's price AND its manual one: every reader of a line's price reads this number
          x_unit_price: l.finalPrice, x_price_unit_manual: l.finalPrice, x_subtotal: round2(qty * l.finalPrice),
          x_special_price: true, x_pack_text: l.unit, x_special_purchase: l.purchase > 0 ? l.purchase : false,
          ...(supplier ? { x_special_supplier_id: supplier } : {}),
          x_notes: itemDetail(l.origin, l.size), ...(q.simulation ? { [SIM_FIELD]: true } : {}),
        };
      }),
    });
    // the request points at its order BEFORE the order is confirmed: a second press finds it, whatever fails from here
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals: { x_daily_order_id: orderId } });
    try {
      const loc = await getPartnerLocation(env, q.partnerId);
      const neighborhood = loc?.neighborhood || (await getPartnerNeighborhood(env, q.partnerId));
      if (loc) await setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
      else if (neighborhood) await call<boolean>(env, ORDER_MODEL, "write", { ids: [orderId], vals: { x_delivery_neighborhood: neighborhood } });
    } catch (e) {
      console.warn(`[special-accept] ${quoteId}: the customer's delivery place could not be read — the order goes without it`, (e as Error)?.message);
    }
    await call<boolean>(env, ORDER_MODEL, "write", { ids: [orderId], vals: { x_state: "confirmed", x_confirmed_at: nowOdoo(now) } });
    const made = plan.lines.map((x, i) => ({ orderLineId: lineIds[i], line: x.line, qty: x.qty }));
    const saleLine = q.simulation ? "" : await confirmSaleOrder(env, q, orderId, made, now);
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals: { x_state: "accepted", x_converted_at: nowOdoo(now), x_confirmed_total: total } });

    // ---- the customer's confirmation: his window, else the confirmation's own template, else Baraa sends it himself
    const penv = { ...env, AUTO_SEND_JOB: undefined } as Env;
    const text = customerConfirmText(orderId, deliveryDate, total, q.quotationNumber);
    const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
    let to: ConvertResult["to"];
    let sentLine: string;
    if (q.simulation) {
      to = "owner_simulation";
      if (owner) await sendViaGateway(penv, { purpose: OWNER_SPECIAL_PURPOSE, to: owner, content: textContent(`${SIM_MARK} — ما كان سيصل العميل «${q.partnerName}»:\n${text}`), ctx: opts.ctx }).catch(() => null);
      sentLine = "محاكاة: التأكيد وصلك أنت، ولا أمر بيع ولا رسالة للعميل";
    } else {
      let phone = "";
      try {
        const [p] = await call<Array<{ id: number; phone: string | false; x_whatsapp_number: string | false }>>(env, "res.partner", "read", { ids: [q.partnerId], fields: ["id", "phone", "x_whatsapp_number"] });
        phone = waDigits(String(p?.x_whatsapp_number || p?.phone || ""));
      } catch (e) {
        console.warn(`[special-accept] ${quoteId}: the customer's number could not be read`, (e as Error)?.message);
      }
      let why = phone ? "" : "العميل بلا رقم واتساب";
      let sent: "session" | "template" | null = null;
      if (phone) {
        const d = gatewayDecision(await sendViaGateway(penv, {
          purpose: T.CUSTOMER_ORDER_CONFIRM, to: phone, content: textContent(text),
          fallback: [{ kind: "template", purpose: T.CUSTOMER_ORDER_CONFIRM, params: confirmTemplateParams(orderId, deliveryDate) }],
          noHold: true, noHoldReason: "تأكيد الطلب الخاص لا يُحفظ: يصل براء ليرسله بنفسه", link: { model: ORDER_MODEL, id: orderId }, ctx: opts.ctx,
        }).catch(() => null));
        if (d?.action === "session" || d?.action === "template") sent = d.action;
        else why = d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "لم يُرسل";
      }
      if (sent) {
        to = sent === "session" ? "customer_session" : "customer_template";
        sentLine = `التأكيد وصل العميل (${sent === "session" ? "داخل نافذته" : "بقالب تأكيد الطلب"})`;
      } else {
        to = "owner_instead";
        if (owner) await sendViaGateway(penv, { purpose: OWNER_SPECIAL_PURPOSE, to: owner, content: textContent(`📨 تأكيد الطلب #${orderId} لم يصل «${q.partnerName}» (${why}). أرسله له بنفسك:\n\n${text}`), ctx: opts.ctx }).catch(() => null);
        sentLine = `التأكيد لم يصل العميل (${why}): وصلك نصه لترسله بنفسك`;
      }
      // Baraa's own message of a confirmed order, with «📦 سلّم وحصّل»: the delivery is the day's own path
      await notifyOwnerConfirmed(env, orderId);
    }

    // ---- a large order: now, and on the morning of its delivery
    const size = orderCartons(plan.lines.map((x) => ({ qty: x.qty, unit: x.line.unit, packKg: packs.get(x.line.productId)?.kg ?? 0 })));
    const limit = await largeOrderLimit(env, riyadhDateKey(new Date(now)));
    const large = size.cartons >= limit;
    let told = false;
    if (large) {
      const tail = `الطلب #${orderId} (${q.name}، ${q.partnerName || "—"})، التسليم صباح ${dayLabel(deliveryDate)}`;
      told = await ownerAlerted(penv, `${q.simulation ? `${SIM_MARK} — ` : ""}${largeOrderText(size.cartons, size.kilos, tail)}`).catch(() => false);
      await rememberLargeOrder(env, deliveryDate, { orderId, quote: q.name, customer: q.partnerName, cartons: size.cartons, kilos: size.kilos, simulation: q.simulation });
    }

    const line = [
      `📦 تحوّل إلى الطلب #${orderId}: ${plan.lines.length} صنف، التسليم صباح ${dayLabel(deliveryDate)}، الإجمالي ${money(total)} ر.س`,
      plan.out.length ? `خارج الطلب (كميتها 0): ${plan.out.join("، ")}` : "",
      expired ? "اعتُمدت الأسعار بعد انتهاء الصلاحية" : "",
      saleLine, sentLine,
      large ? `طلب كبير ${size.cartons} كرتون${told ? "" : " (تنبيه واتساب لم يصلك الآن: رتّب المركبة)"}` : "",
    ].filter(Boolean).join(" · ");
    await writeResult(env, quoteId, line, now);
    await finishButton(env, lock, CONVERT_LOCK_SECONDS);
    return { action: "converted", orderId, to, total, cartons: size.cartons, detail: line };
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    // an order made and not finished is cancelled (nothing is deleted): the next press starts clean
    if (orderId) await call<boolean>(env, ORDER_MODEL, "write", { ids: [orderId], vals: { x_state: "cancelled" } }).catch(() => {});
    await releaseButton(env, lock);
    await writeResult(env, quoteId, `🚫 تعذّر التحويل لطلب: ${why.slice(0, 200)}${orderId ? ` (الطلب #${orderId} أُلغي)` : ""}`, now);
    await sendOwnerAlert(env, `🚫 تعذّر تحويل الطلب الخاص #${quoteId} إلى طلب: ${why.slice(0, 300)}${orderId ? ` — الطلب #${orderId} أُلغي` : ""}`).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- the morning of a large order

interface LargeEntry { orderId: number; quote: string; customer: string; cartons: number; kilos: number; simulation?: boolean }
async function rememberLargeOrder(env: Env, deliveryDate: string, entry: LargeEntry): Promise<void> {
  const key = `${LARGE_KV}:${deliveryDate}`;
  try {
    const raw = await env.MSG_DEDUP.get(key);
    const list = (raw ? (JSON.parse(raw) as LargeEntry[]) : []).filter((x) => x.orderId !== entry.orderId);
    await env.MSG_DEDUP.put(key, JSON.stringify([...list, entry]), { expirationTtl: Math.max(LARGE_TTL, Math.ceil((Date.parse(`${deliveryDate}T23:59:59+03:00`) - Date.now()) / 1000) + 24 * 3600) });
  } catch (e) {
    console.warn(`[special-accept] the large order ${entry.orderId} was not kept for its morning`, (e as Error)?.message);
  }
}

export interface LargeMorningStep { orderId: number; action: "alerted" | "alerted_before" | "gone" | "not_delivered" }
/** A morning alert the gateway did not take is tried again after this long (not at every tick). */
export const LARGE_RETRY_SECONDS = 30 * 60;
/**
 * The every-5-minutes tick: on the morning of a large order's delivery (from 02:00 Riyadh), ONE
 * «🚚 طلب كبير {N} كرتون: رتّب المركبة» an order — while it still stands and is not delivered yet. KV alone
 * until a day has one. Never throws.
 */
export async function runLargeOrderMorning(env: Env, now: number = Date.now()): Promise<LargeMorningStep[]> {
  const out: LargeMorningStep[] = [];
  try {
    if (riyadhMinutes(new Date(now)) < LARGE_MORNING_MINUTE) return out;
    const day = riyadhDateKey(new Date(now));
    const raw = await env.MSG_DEDUP.get(`${LARGE_KV}:${day}`);
    if (!raw) return out;
    for (const e of JSON.parse(raw) as LargeEntry[]) {
      const claim = await claimButton(env, `sq_large_morning:${e.orderId}`, 2 * 24 * 3600);
      if (!claim.claimed) { out.push({ orderId: e.orderId, action: "alerted_before" }); continue; }
      const [o] = await call<Array<{ id: number; x_state: string }>>(env, ORDER_MODEL, "search_read", { domain: [["id", "=", e.orderId]], fields: ["id", "x_state"], limit: 1 });
      if (!o || o.x_state === "cancelled" || o.x_state === "delivered" || o.x_state === "closed") {
        await finishButton(env, claim, 2 * 24 * 3600);
        out.push({ orderId: e.orderId, action: "gone" });
        continue;
      }
      const went = await ownerAlerted(env, `${e.simulation ? `${SIM_MARK} — ` : ""}${largeOrderText(e.cartons, e.kilos, `اليوم تسليم الطلب #${e.orderId} (${e.quote}، ${e.customer || "—"})`)}`);
      await finishButton(env, claim, went ? 2 * 24 * 3600 : LARGE_RETRY_SECONDS);
      out.push({ orderId: e.orderId, action: went ? "alerted" : "not_delivered" });
    }
  } catch (e) {
    console.warn("[special-accept] the large orders' morning failed", (e as Error)?.message);
  }
  return out;
}

// ---------------------------------------------------------------- the actual purchase price of a special line

/**
 * A confirmed purchase list: what each special line was really bought at — the list's price of its item, as
 * Baraa left it — goes back to the order's line («الشراء (طلب خاص)»: the day's profit reads it). Only what
 * changed is written. Never throws.
 */
export async function syncSpecialPurchase(env: Env, items: Array<{ special_line?: number; unit_price?: number | null }>): Promise<number> {
  let written = 0;
  try {
    const priced = items.filter((it) => Number(it.special_line) > 0 && Number(it.unit_price) > 0);
    if (!priced.length) return 0;
    const rows = await call<Array<{ id: number; x_special_purchase: number | false }>>(env, ORDER_LINE_MODEL, "search_read", {
      domain: [["id", "in", priced.map((it) => Number(it.special_line))], ["x_special_price", "=", true]], fields: ["id", "x_special_purchase"], limit: 500,
    });
    for (const r of rows) {
      const price = round2(Number(priced.find((it) => Number(it.special_line) === r.id)!.unit_price));
      if (Math.abs((Number(r.x_special_purchase) || 0) - price) < 0.005) continue;
      await call<boolean>(env, ORDER_LINE_MODEL, "write", { ids: [r.id], vals: { x_special_purchase: price } });
      written++;
    }
  } catch (e) {
    console.warn("[special-accept] the special lines' purchase prices were not written back", (e as Error)?.message);
  }
  return written;
}
