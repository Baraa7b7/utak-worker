// § 65 هـ (2026-10-07) — the periodic check-in of the approved suppliers, and
// the numbers the worker writes on their cards.
//
// THE CHECK-IN ships OFF: «تفعيل تواصل الموردين» in the settings
// (x_pricing_config.x_supplier_outreach, false by default). While it is on, the
// `*/5` tick — between 09:00 and 18:00 Riyadh only — writes to the APPROVED
// suppliers whose «إيقاع التواصل» is due today:
//   • «أسبوعي» (a distributor, an importer): on Sunday;
//   • «شهري» (a farmer): on the first of the month — and on every Sunday while
//     one of his seasons («مواسم المورد») covers the month;
//   • «يومي» (his daily price form is his contact) and «عند الطلب»: never.
// One short message with the button «📦 عرض مورد» inside his 24h window; outside
// it the template utak_supplier_checkin_v1 while Meta holds it APPROVED and
// UTILITY; neither → nothing (a check-in is never held). ONE attempt a supplier
// a due day (a KV claim), and a check-in that went moves «التواصل القادم» to his
// next due day — a card whose «التواصل القادم» is after today is not written to.
//
// THE NUMBERS, once a day (the first tick from 09:00), whatever the switch says:
//   • «نسبة الرد ٪»: of the Riyadh days of the last 30 on which we wrote to him,
//     the share on which he wrote back (the rows of x_wa_message, simulation out);
//   • «فرق سعره عن وسيط السوق ٪»: the average, over his prices of the last 30
//     days, of (his price − the day's market price of that item) ÷ it — a
//     purchase price × 1.15 first (the market's is VAT-inclusive);
//   • «آخر سعر/عرض»: the newest thing he sent, with its day;
//   • on his «طاقة المورد» rows: his last price of each item.
// A number is written only when it changed.

import type { Env } from "./config";
import { call, stripRef } from "./odoo";
import { buttonsContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhMinutes } from "./hours";
import { waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { STATE_FIELD, asCadence, type Cadence } from "./supplier-registry";

export const OUTREACH_JOB = "supplier_outreach";
export const CHECKIN_PURPOSE = "supplier_checkin";
export const OUTREACH_FROM_MINUTE = 9 * 60;
export const OUTREACH_UNTIL_MINUTE = 18 * 60;
export const OUTREACH_FIELD = "x_supplier_outreach";
export const CHECKIN_BUTTON = { id: "sup_offer:ready", title: "📦 عرض مورد" } as const;
export const INDICATOR_DAYS = 30;
const DAY_TTL = 26 * 60 * 60;
const DAY_MS = 86400_000;
const SIM_FIELD = "x_utak_simulation";
const VAT = 1.15;

const firstName = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
/** § 66 و — the check-in template's one variable: the day for v2 (and any later one), the supplier's name for v1. */
export const CHECKIN_TEMPLATE_V1 = "utak_supplier_checkin_v1";
export const checkinParams = (template: string, name: string, day: string): string[] => [template === CHECKIN_TEMPLATE_V1 ? name : arabicDate(day)];
export const checkinText = (name: string): string => `مرحبا ${firstName(name)} 🌿 تحديث يو تاك الدوري: عندك بضاعة جاهزة أو شحنة جديدة؟ اضغط «${CHECKIN_BUTTON.title}» وسجّلها.`;

// ---------------------------------------------------------------- the calendar

const dayOf = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const isSunday = (day: string): boolean => dayOf(day).getUTCDay() === 0;
export const isFirstOfMonth = (day: string): boolean => day.slice(8, 10) === "01";
const plusDays = (day: string, n: number): string => new Date(dayOf(day).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const nextSunday = (day: string): string => plusDays(day, 7 - dayOf(day).getUTCDay());
export const nextFirst = (day: string): string => { const d = dayOf(day); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };
/** A season «من شهر» … «إلى شهر» covers the month (a season that wraps the year too); an empty «إلى» = that month alone. */
export function seasonCovers(from: unknown, to: unknown, month: number): boolean {
  const a = Number(from) || 0;
  if (!(a >= 1 && a <= 12)) return false;
  const b = Number(to) >= 1 && Number(to) <= 12 ? Number(to) : a;
  return a <= b ? a <= month && month <= b : month >= a || month <= b;
}
/**
 * Is a supplier of this cadence due on `day`, and when is he due next after it? `inSeason`: one of
 * his seasons covers the month («شهري» alone reads it).
 */
export function dueOn(cadence: Cadence | null, inSeason: boolean, day: string): { due: boolean; next: string | null } {
  if (cadence === "weekly") return { due: isSunday(day), next: nextSunday(day) };
  if (cadence === "monthly") {
    if (!inSeason) return { due: isFirstOfMonth(day), next: nextFirst(day) };
    const sun = nextSunday(day), first = nextFirst(day);
    return { due: isSunday(day) || isFirstOfMonth(day), next: sun < first ? sun : first };
  }
  return { due: false, next: null };
}

// ---------------------------------------------------------------- the check-in

/** «تفعيل تواصل الموردين» of the active settings. Throws on Odoo trouble (the caller sends nothing). */
export async function outreachEnabled(env: Env, day: string): Promise<boolean> {
  const [r] = await call<Array<Record<string, unknown>>>(env, "x_pricing_config", "search_read", {
    domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
    fields: ["id", OUTREACH_FIELD], order: "x_active_from desc, id desc", limit: 1,
  });
  return r?.[OUTREACH_FIELD] === true;
}

export interface OutreachStep { partnerId: number; name: string; action: "session" | "template" | "not_sent" | "claimed_before" | "no_number" | "contacted" | "error"; next?: string | null; detail?: string }
export interface OutreachResult { action: "outside" | "not_due_day" | "off" | "none" | "ran" | "error"; steps?: OutreachStep[]; detail?: string }

/** The five-minute tick's check-in pass. Never throws. */
export async function runSupplierOutreachTick(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<OutreachResult> {
  const minute = riyadhMinutes(new Date(now));
  if (minute < OUTREACH_FROM_MINUTE || minute >= OUTREACH_UNTIL_MINUTE) return { action: "outside" };
  const day = riyadhDateKey(new Date(now));
  // no cadence is due on a day that is neither a Sunday nor the first of the month: nothing is read
  if (!isSunday(day) && !isFirstOfMonth(day)) return { action: "not_due_day" };
  try {
    if (!(await outreachEnabled(env, day))) return { action: "off" };
    const rows = await call<Array<Record<string, unknown>>>(env, "res.partner", "search_read", {
      domain: [[STATE_FIELD, "=", "approved"], ["x_contact_cadence", "in", ["weekly", "monthly"]], [SIM_FIELD, "!=", true], "|", ["x_next_contact", "=", false], ["x_next_contact", "<=", day]],
      fields: ["id", "name", "x_whatsapp_number", "x_contact_cadence", "x_next_contact"], order: "id asc", limit: 200,
    });
    if (!rows.length) return { action: "none" };
    const monthly = rows.filter((r) => r.x_contact_cadence === "monthly").map((r) => Number(r.id));
    const month = Number(day.slice(5, 7));
    const inSeason = new Set<number>();
    if (monthly.length) {
      const seasons = await call<Array<{ x_partner_id: [number, string] | number | false; x_month_from: string | false; x_month_to: string | false }>>(env, "x_supplier_season", "search_read", {
        domain: [["x_partner_id", "in", monthly], [SIM_FIELD, "!=", true]], fields: ["x_partner_id", "x_month_from", "x_month_to"], limit: 1000,
      });
      for (const s of seasons) if (seasonCovers(s.x_month_from, s.x_month_to, month)) inSeason.add(Array.isArray(s.x_partner_id) ? s.x_partner_id[0] : Number(s.x_partner_id));
    }
    const steps: OutreachStep[] = [];
    for (const r of rows) {
      const id = Number(r.id), name = String(r.name || "");
      const d = dueOn(asCadence(r.x_contact_cadence), inSeason.has(id), day);
      if (!d.due) continue;
      steps.push(await checkIn(env, { id, name, whatsapp: waDigits(String(r.x_whatsapp_number || "")) }, day, d.next, ctx));
    }
    return steps.length ? { action: "ran", steps } : { action: "none" };
  } catch (e) {
    console.error("[supplier-outreach] the pass failed", (e as Error)?.message);
    return { action: "error", detail: (e as Error)?.message };
  }
}

/** ONE check-in of a supplier on a due day: the message inside his window, the template outside it; «التواصل القادم» moves when it went. */
async function checkIn(env: Env, s: { id: number; name: string; whatsapp: string }, day: string, next: string | null, ctx?: ExecutionContext): Promise<OutreachStep> {
  if (!s.whatsapp || isOwnerRecipient(env, s.whatsapp)) return { partnerId: s.id, name: s.name, action: "no_number" };
  const claim = await claimButton(env, `sup_checkin:${day}:${s.id}`, DAY_TTL);
  if (!claim.claimed) return { partnerId: s.id, name: s.name, action: "claimed_before" };
  try {
    const res = await sendViaGateway(env, {
      purpose: CHECKIN_PURPOSE, to: s.whatsapp, content: buttonsContent(checkinText(s.name), [CHECKIN_BUTTON]),
      // § 66 و — utak_supplier_checkin_v2 («طلب تحديث التوفر والأسعار ليوم {{1}} …»): its one variable is the day;
      // v1 (the supplier's name; filed MARKETING by Meta, never used) takes his name still
      fallback: [{ kind: "template", purpose: CHECKIN_PURPOSE, params: (template) => checkinParams(template, s.name, day) }], noHold: true, noHoldReason: "التواصل الدوري لا يُحفظ: يُعاد في موعده القادم", ctx,
    });
    const d = gatewayDecision(res);
    // one attempt a due day, whatever came of it
    await finishButton(env, claim, DAY_TTL);
    if (d?.action !== "session" && d?.action !== "template") return { partnerId: s.id, name: s.name, action: "not_sent", detail: d ? d.action : "no_decision" };
    if (next) await call<boolean>(env, "res.partner", "write", { ids: [s.id], vals: { x_next_contact: next } }).catch((e) => console.warn(`[supplier-outreach] ${s.id}: «التواصل القادم» could not be written`, (e as Error)?.message));
    return { partnerId: s.id, name: s.name, action: d.action, next };
  } catch (e) {
    await releaseButton(env, claim);
    return { partnerId: s.id, name: s.name, action: "error", detail: (e as Error)?.message };
  }
}

// ---------------------------------------------------------------- the numbers

const round1 = (x: number): number => Math.round(x * 10) / 10;
const m2oId = (v: unknown): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);
const m2oName = (v: unknown): string => (Array.isArray(v) ? String(v[1] ?? "") : "");
const riyadhDayOf = (odooUtc: string): string => new Date(Date.parse(`${odooUtc.replace(" ", "T")}Z`) + 3 * 3600_000).toISOString().slice(0, 10);
const money = (x: number): string => { const n = Math.round(Number(x) * 100) / 100; return Number.isInteger(n) ? String(n) : n.toFixed(2); };

/** «نسبة الرد ٪»: of the days we wrote to him, the share on which he wrote back; null = we never wrote. */
export function replyRate(outDays: Iterable<string>, inDays: Iterable<string>): number | null {
  const asked = new Set(outDays), answered = new Set(inDays);
  if (!asked.size) return null;
  let n = 0;
  for (const d of asked) if (answered.has(d)) n++;
  return round1((n / asked.size) * 100);
}
/** «فرق سعره عن وسيط السوق ٪»: the average of (his − the market's) ÷ the market's; null = nothing to compare. */
export function priceGap(pairs: Array<{ his: number; market: number }>): number | null {
  const ok = pairs.filter((p) => p.his > 0 && p.market > 0);
  if (!ok.length) return null;
  return round1((ok.reduce((s, p) => s + (p.his - p.market) / p.market, 0) / ok.length) * 100);
}

export interface IndicatorResult { action: "claimed_before" | "before" | "none" | "written" | "unchanged" | "error"; partners?: number; written?: number; detail?: string }

/** The cards' numbers, once a day from 09:00 Riyadh. Never throws. */
export async function runSupplierIndicatorsTick(env: Env, now: number = Date.now()): Promise<IndicatorResult> {
  if (riyadhMinutes(new Date(now)) < OUTREACH_FROM_MINUTE) return { action: "before" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `sup_indicators:${day}`, DAY_TTL);
  if (!claim.claimed) return { action: "claimed_before" };
  try {
    const r = await refreshSupplierIndicators(env, now);
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    console.error("[supplier-outreach] the numbers failed", (e as Error)?.message);
    return { action: "error", detail: (e as Error)?.message };
  }
}

/** The numbers of every card that carries «حالة المورد» or is a price source. Throws on Odoo trouble. */
export async function refreshSupplierIndicators(env: Env, now: number = Date.now()): Promise<IndicatorResult> {
  const day = riyadhDateKey(new Date(now));
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - INDICATOR_DAYS * DAY_MS).toISOString().slice(0, 10);
  const cards = await call<Array<Record<string, unknown>>>(env, "res.partner", "search_read", {
    domain: ["|", [STATE_FIELD, "!=", false], ["x_price_source", "=", true], [SIM_FIELD, "!=", true]],
    fields: ["id", "supplier_rank", "x_price_role", "x_reply_rate", "x_price_gap_pct", "x_last_offer_text"], order: "id asc", limit: 300,
  });
  if (!cards.length) return { action: "none" };
  const ids = cards.map((c) => Number(c.id));
  const msgs = await call<Array<{ x_partner_id: unknown; x_direction: string | false; x_status: string | false; create_date: string }>>(env, "x_wa_message", "search_read", {
    domain: [["x_partner_id", "in", ids], ["create_date", ">=", `${since} 00:00:00`], [SIM_FIELD, "!=", true]], fields: ["x_partner_id", "x_direction", "x_status", "create_date"], order: "id desc", limit: 5000,
  });
  // the day's market price of each item, as the day's lines keep it (VAT-inclusive)
  const lines = await call<Array<{ x_day_date: string | false; x_product_tmpl_id: unknown; x_packaging_id: unknown; x_market_price: number | false }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_date", ">=", since], ["x_market_price", ">", 0], [SIM_FIELD, "!=", true]], fields: ["x_day_date", "x_product_tmpl_id", "x_packaging_id", "x_market_price"], limit: 3000,
  });
  const marketOf = new Map(lines.map((l) => [`${l.x_day_date}|${m2oId(l.x_product_tmpl_id)}|${m2oId(l.x_packaging_id)}`, Number(l.x_market_price) || 0]));
  const daily = await call<Array<Record<string, unknown>>>(env, "x_daily_price", "search_read", {
    domain: [["x_supplier_id", "in", ids], ["x_date", ">=", since], ["x_price_sar", ">", 0], [SIM_FIELD, "!=", true]], fields: ["x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_date", "x_price_sar"], order: "x_date desc, id desc", limit: 3000,
  });
  const offers = await call<Array<Record<string, unknown>>>(env, "x_price_offer", "search_read", {
    domain: [["x_source_partner_id", "in", ids], ["x_date", ">=", since], [SIM_FIELD, "!=", true]],
    fields: ["x_source_partner_id", "x_product_tmpl_id", "x_packaging_id", "x_date", "x_purchase_price", "x_market_price", "x_special", "x_item_text"], order: "x_date desc, id desc", limit: 3000,
  });
  const capacity = await call<Array<Record<string, unknown>>>(env, "x_supplier_capacity", "search_read", {
    domain: [["x_partner_id", "in", ids]], fields: ["id", "x_partner_id", "x_product_tmpl_id", "x_last_price", "x_last_price_date"], limit: 2000,
  });

  let written = 0;
  for (const c of cards) {
    const id = Number(c.id);
    const mine = msgs.filter((m) => m2oId(m.x_partner_id) === id);
    const sentOk = (m: { x_status: string | false }): boolean => m.x_status === "sent" || m.x_status === "delivered" || m.x_status === "read";
    const rate = replyRate(mine.filter((m) => m.x_direction === "out" && sentOk(m)).map((m) => riyadhDayOf(m.create_date)), mine.filter((m) => m.x_direction === "in").map((m) => riyadhDayOf(m.create_date)));
    const myDaily = daily.filter((d) => m2oId(d.x_supplier_id) === id);
    const myOffers = offers.filter((o) => m2oId(o.x_source_partner_id) === id);
    const pairs: Array<{ his: number; market: number }> = [];
    for (const d of myDaily) pairs.push({ his: Number(d.x_price_sar) * VAT, market: marketOf.get(`${d.x_date}|${m2oId(d.x_product_tmpl_id)}|${m2oId(d.x_packaging_id)}`) ?? 0 });
    // a «خاص» row (a special request's observation, a supplier's offer, an extra item) is a price of another unit: left out
    for (const o of myOffers.filter((x) => x.x_special !== true)) {
      const market = marketOf.get(`${o.x_date}|${m2oId(o.x_product_tmpl_id)}|${m2oId(o.x_packaging_id)}`) ?? 0;
      if (Number(o.x_purchase_price) > 0) pairs.push({ his: Number(o.x_purchase_price) * VAT, market });
      else if (Number(o.x_market_price) > 0) pairs.push({ his: Number(o.x_market_price), market });
    }
    const gap = priceGap(pairs);
    // the newest thing he sent: a daily price or any offer (the lists are newest first)
    const last = [...myDaily.map((d) => ({ day: String(d.x_date), name: stripRef(m2oName(d.x_product_tmpl_id)).trim(), price: Number(d.x_price_sar) })),
      ...myOffers.map((o) => ({ day: String(o.x_date), name: String(o.x_item_text || "") || stripRef(m2oName(o.x_product_tmpl_id)).trim(), price: Number(o.x_purchase_price) || Number(o.x_market_price) || 0 }))]
      .filter((x) => x.price > 0).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))[0];
    const lastText = last ? `${last.name} ${money(last.price)} — ${last.day}` : "";
    const vals: Record<string, unknown> = {};
    if (rate !== null && round1(Number(c.x_reply_rate) || 0) !== rate) vals.x_reply_rate = rate;
    if (gap !== null && round1(Number(c.x_price_gap_pct) || 0) !== gap) vals.x_price_gap_pct = gap;
    if (lastText && String(c.x_last_offer_text || "") !== lastText && !String(c.x_last_offer_text || "").endsWith(`— ${last?.day}`)) vals.x_last_offer_text = lastText.slice(0, 250);
    if (Object.keys(vals).length) { await call<boolean>(env, "res.partner", "write", { ids: [id], vals }); written++; }
    // his «طاقة المورد» rows: his last price of each item
    for (const k of capacity.filter((x) => m2oId(x.x_partner_id) === id)) {
      const pid = m2oId(k.x_product_tmpl_id);
      if (!pid) continue;
      const hit = [...myDaily.map((d) => ({ pid: m2oId(d.x_product_tmpl_id), day: String(d.x_date), price: Number(d.x_price_sar) })),
        ...myOffers.map((o) => ({ pid: m2oId(o.x_product_tmpl_id), day: String(o.x_date), price: Number(o.x_purchase_price) || Number(o.x_market_price) || 0 }))]
        .filter((x) => x.pid === pid && x.price > 0).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))[0];
      if (hit && (Number(k.x_last_price) !== hit.price || String(k.x_last_price_date || "") !== hit.day)) {
        await call<boolean>(env, "x_supplier_capacity", "write", { ids: [Number(k.id)], vals: { x_last_price: hit.price, x_last_price_date: hit.day } });
        written++;
      }
    }
  }
  return { action: written ? "written" : "unchanged", partners: cards.length, written };
}
