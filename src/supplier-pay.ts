// Supplier payments — 2026-09-25 (STATUS § 37 ب).
//
// What UTAK owes each supplier, what it paid, and what is left:
//
//   • the daily due (x_supplier_due, one per supplier and confirmed purchase
//     list, with a line per item — x_supplier_due_line): quantity × that
//     supplier's own price of that day in x_daily_price (§ 26; the latest row,
//     price > 0, extraction not failed). The item's supplier is the one the
//     purchase list priced it from (price_supplier_id in x_aggregated_items),
//     else the list's supplier. A line without such a price is not counted:
//     it is marked «بلا سعر» and Baraa gets one important alert per list and
//     set of such lines. Built when the warehouse taps «تم الشراء», kept
//     current by the */5 tick (a price that arrives later), and on
//     «🔄 إعادة حساب المستحقات» in Odoo. A confirmed list = x_status «done».
//   • payments (x_supplier_payment): SP-2026-0001 references from an Odoo
//     sequence, state pending / approved / rejected. Baraa's own (Odoo, cash or
//     transfer) are approved at once; Omar's cash payments from WhatsApp wait
//     for Baraa's «اعتماد» or «رفض» (a reason is required). Decided = locked
//     (Odoo automations). Amounts are kept to two decimals (halalas here).
//   • the balance per supplier: due, approved paid, remaining = due − paid.
//     Paying more than the remaining is accepted: the payment is marked
//     «رصيد دائن» and Baraa is alerted.
//   • after an approval only: the supplier's notice — text inside his 24h
//     window, else utak_supplier_payment_sent (when APPROVED / UTILITY), else
//     held as a critical message (§ 34) — and Omar is told the decision.
//
// Omar (a team member with the purchase or the collection role) records a
// payment from WhatsApp: «💵 دفعت لمورد» → the supplier (from today's purchase
// list) → the amount as a number (anything else is refused with a clear line)
// → the receipt photo, or «تخطي».
//
// Nothing here creates account.move or account.payment: this is UTAK's own
// ledger, not accounting (ACCOUNTING_SYNC stays out of it).
//
// § 37 ج (2026-09-26): a trial's record carries x_utak_simulation (SIM_FIELD)
// on the list, the payment, the due and its line. It is counted nowhere — not
// in a due, a paid, a remaining or a «رصيد دائن», not in the tick, not in
// Omar's supplier picker — and a simulation payment's notice never goes: here
// (settlePayment) and in the gateway itself, whoever sends it
// (simulationPaymentRef). Never deleted.

import type { Env } from "./config";
import { isTestMode } from "./config";
import { call } from "./odoo";
import { textContent, buttonsContent, listContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { sendOwnerAlert } from "./templates";
import { claimButton, finishButton } from "./button-lock";
import { fnv1a } from "./auto-send-guard";
import { arabicDate, maskPhone } from "./wa-params";
import { riyadhDateKey } from "./hours";
import type { RouterReply } from "./router";
import type { TeamMember } from "./types";
import { CASH_MARKET_NAME, CASH_MARKET_REF, findCashMarketSupplier, marketWinners, winnerKey, type MarketWinners } from "./cash-market";

export const SP_MODEL = "x_supplier_payment";
export const DUE_MODEL = "x_supplier_due";
export const DUE_LINE_MODEL = "x_supplier_due_line";
/** The supplier's notice (critical: held outside his window with utak_update_supplier when Meta allows it). */
export const SP_NOTICE_PURPOSE = "supplier_payment_sent";
/** The decision on Omar's payment, to Omar. */
export const SP_TEAM_PURPOSE = "team_sp_decision";
export const SP_TEMPLATE = "utak_supplier_payment_sent";
/** A payment the approve / create webhook did not settle is settled by the tick after this. */
export const SETTLE_RETRY_AFTER_MS = 3 * 60_000;
/** § 37 ج — «محاكاة (تجربة)»: a trial's list / payment / due / line, counted nowhere (not x_is_simulation, which every sim row has). */
export const SIM_FIELD = "x_utak_simulation";
/** The domain term every sum and list here carries. */
const NOT_SIM: [string, string, boolean] = [SIM_FIELD, "!=", true];
/** x_supplier_notice of a simulation payment. */
export const SIM_NOTICE = "لا إشعار للمورد (محاكاة)";
/** § 42 أ — x_supplier_notice of a payment to «مشتريات السوق النقدية» (no number, never notified). */
export const CASH_MARKET_NOTICE = "لا إشعار للمورد (مشتريات السوق النقدية بلا رقم)";
/** The tick recomputes the dues of confirmed lists this many days back. */
export const DUE_DAYS_BACK = 3;
/** A list confirmed less than this ago is left to the tap's own sync. */
export const DUE_TICK_GRACE_MS = 2 * 60_000;

// ---------------------------------------------------------------- money (integer halalas)

/** 13.5 → 1350; 1.005 → 101 (half up, float noise removed first). */
export function halalas(x: number): number {
  const n = Number(x) || 0;
  const micro = Math.round(n * 1e6);
  return Math.round(micro / 1e4);
}
/** 150000 → "1500.00" (two decimals, Western digits, no grouping). */
export function money(h: number): string {
  const neg = h < 0;
  const a = Math.abs(Math.round(h));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
const toOdoo = (h: number) => Math.round(h) / 100;

const AR_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
export const MAX_PAYMENT_H = 100_000_000; // 1,000,000.00 SAR

/**
 * Omar's amount: a number only — digits (Arabic-Indic too) with at most one
 * decimal point («.» or «٫») and two decimals. Anything else (letters, «ر.س»,
 * commas, a sign, zero, more than two decimals) → null.
 */
export function parseAmount(text: string): number | null {
  const s = String(text ?? "").trim().replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d).replace("٫", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  const h = Number(int) * 100 + Number((dec + "00").slice(0, 2));
  if (!(h > 0) || h > MAX_PAYMENT_H) return null;
  return h;
}

// ---------------------------------------------------------------- the dues (pure)

export interface ListItem {
  product_id: number;
  product_name: string;
  packaging_id: number;
  packaging_name: string;
  total_quantity: number;
  price_supplier_id?: number | null;
}
export interface PriceRow {
  id: number;
  x_supplier_id: [number, string] | false;
  x_product_tmpl_id: [number, string] | false;
  x_packaging_id: [number, string] | false;
  x_date: string | false;
  x_price_sar: number | false;
  x_extraction_status: string | false;
}
export interface DueLinePlan {
  productId: number;
  productName: string;
  packagingId: number;
  packagingName: string;
  quantity: number;
  unitPrice: number | null;
  priceId: number | null;
  subtotalH: number;
  noPrice: boolean;
  /** § 42 أ — the market source whose written purchase price won this line (owed to «مشتريات السوق النقدية»). */
  marketBy?: string;
}
export interface DuePlan {
  supplierId: number;
  lines: DueLinePlan[];
  amountH: number;
  unpriced: number;
}

function cleanName(s: string): string {
  return String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
}

/** The item's supplier: the one the list priced it from, else the list's supplier, else none. */
export function itemSupplier(it: ListItem, listSupplierId: number | null): number | null {
  const p = Number(it.price_supplier_id ?? 0);
  if (p > 0) return p;
  return listSupplierId && listSupplierId > 0 ? listSupplierId : null;
}

/** That supplier's own price of that day for the item: the latest row, price > 0, not a failed extraction. */
export function supplierPriceFor(prices: PriceRow[], supplierId: number, it: ListItem, day: string): PriceRow | null {
  let best: PriceRow | null = null;
  for (const p of prices) {
    if (!p.x_supplier_id || p.x_supplier_id[0] !== supplierId) continue;
    if (!p.x_product_tmpl_id || p.x_product_tmpl_id[0] !== it.product_id) continue;
    if (!p.x_packaging_id || p.x_packaging_id[0] !== it.packaging_id) continue;
    if (String(p.x_date || "") !== day) continue;
    if (!(Number(p.x_price_sar) > 0) || p.x_extraction_status === "failed") continue;
    if (!best || p.id > best.id) best = p;
  }
  return best;
}

/** Quantity × price in halalas, half up. */
export function lineSubtotalH(quantity: number, unitPrice: number): number {
  return halalas(Number(quantity) * Number(unitPrice));
}

/**
 * The dues of one confirmed list: per supplier, a line per item with its own
 * price (or «بلا سعر», not counted), the amount = sum of the priced lines.
 * Items with no supplier at all come back in `noSupplier`.
 */
export function planDues(
  list: { x_date: string; listSupplierId: number | null },
  items: ListItem[],
  prices: PriceRow[],
  market?: MarketPlan,
): { dues: DuePlan[]; noSupplier: ListItem[] } {
  const by = new Map<number, DuePlan>();
  const noSupplier: ListItem[] = [];
  for (const it of items) {
    const qty = Number(it.total_quantity) || 0;
    const base = {
      productId: it.product_id, productName: cleanName(it.product_name),
      packagingId: it.packaging_id, packagingName: cleanName(it.packaging_name),
      quantity: qty,
    };
    // § 42 أ — the winning purchase price came from a source that is not a
    // supplier (Omar at the market): owed to «مشتريات السوق النقدية» at that
    // written price, never to the item's usual supplier.
    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));
    if (won) {
      if (!market!.cashSupplierId) { noSupplier.push(it); continue; }
      const sid = market!.cashSupplierId;
      const line: DueLinePlan = {
        ...base, unitPrice: won.price, priceId: null, subtotalH: lineSubtotalH(qty, won.price), noPrice: false,
        marketBy: cleanName(won.sourceName) || "السوق",
      };
      const d = by.get(sid) ?? { supplierId: sid, lines: [], amountH: 0, unpriced: 0 };
      d.lines.push(line);
      d.amountH += line.subtotalH;
      by.set(sid, d);
      continue;
    }
    const sid = itemSupplier(it, list.listSupplierId);
    if (!sid) { noSupplier.push(it); continue; }
    const p = supplierPriceFor(prices, sid, it, list.x_date);
    const line: DueLinePlan = {
      ...base,
      unitPrice: p ? Number(p.x_price_sar) : null,
      priceId: p ? p.id : null,
      subtotalH: p ? lineSubtotalH(qty, Number(p.x_price_sar)) : 0,
      noPrice: !p,
    };
    const d = by.get(sid) ?? { supplierId: sid, lines: [], amountH: 0, unpriced: 0 };
    d.lines.push(line);
    d.amountH += line.subtotalH;
    if (line.noPrice) d.unpriced++;
    by.set(sid, d);
  }
  return { dues: [...by.values()].sort((a, b) => a.supplierId - b.supplierId), noSupplier };
}

/** § 42 أ — the market-won lines of the list's day and the supplier they are owed to (null = not found). */
export interface MarketPlan {
  cashSupplierId: number | null;
  winners: MarketWinners;
}

/** The market plan of one day: the winners, and «مشتريات السوق النقدية» only when there is one. Throws on Odoo trouble. */
export async function readMarketPlan(env: Env, day: string): Promise<MarketPlan> {
  const winners = await marketWinners(env, day);
  if (!winners.size) return { cashSupplierId: null, winners };
  const cash = await findCashMarketSupplier(env);
  if (!cash) console.warn(`[supplier-pay] ${day}: ${winners.size} market line(s) but no «${CASH_MARKET_NAME}» partner (ref ${CASH_MARKET_REF}) — «بلا مورد»`);
  return { cashSupplierId: cash?.id ?? null, winners };
}

// ---------------------------------------------------------------- the dues (Odoo)

interface ListRow {
  id: number;
  x_date: string | false;
  x_status: string | false;
  x_supplier_id: [number, string] | false;
  x_aggregated_items: string | false;
  x_ahmad_confirmed_at?: string | false;
  x_utak_simulation?: boolean;
}
interface DueRow {
  id: number;
  x_supplier_id: [number, string] | false;
  x_purchase_list_id: [number, string] | false;
  x_amount: number;
  x_unpriced_count: number;
}
interface DueLineRow {
  id: number;
  x_due_id: [number, string] | false;
  x_product_tmpl_id: [number, string] | false;
  x_packaging_id: [number, string] | false;
  x_quantity: number;
  x_unit_price: number;
  x_subtotal: number;
  x_no_price: boolean;
  x_daily_price_id: [number, string] | false;
  x_note: string | false;
}

export interface DueSyncReport {
  action: "not_found" | "simulation" | "not_confirmed" | "unchanged" | "synced";
  listId: number;
  day?: string;
  dues?: Array<{ supplierId: number; amount: string; unpriced: number }>;
  unpriced?: number;
  noSupplier?: number;
  alerted?: boolean;
}

function parseItems(raw: string | false): ListItem[] {
  try {
    const v = typeof raw === "string" && raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function readPricesFor(env: Env, day: string, items: ListItem[]): Promise<PriceRow[]> {
  const productIds = [...new Set(items.map((i) => i.product_id).filter((n) => n > 0))];
  if (!productIds.length) return [];
  return await call<PriceRow[]>(env, "x_daily_price", "search_read", {
    domain: [["x_date", "=", day], ["x_product_tmpl_id", "in", productIds], ["x_price_sar", ">", 0], ["x_utak_simulation", "!=", true]],
    fields: ["id", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_date", "x_price_sar", "x_extraction_status"],
    order: "id desc",
    limit: 1000,
  });
}

async function partnerNames(env: Env, ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((n) => n > 0))];
  if (!uniq.length) return new Map();
  const rows = await call<Array<{ id: number; name: string }>>(env, "res.partner", "read", {
    ids: uniq, fields: ["id", "name"], context: { active_test: false },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function tagged(tag: string | false | null | undefined, text: string): string {
  const t = String(tag || "").trim();
  return t ? `${t} — ${text}` : text;
}

/**
 * Build or refresh the dues of one confirmed list. Idempotent (a fingerprint in
 * KV skips an unchanged plan unless `force`); never deletes a line: a line no
 * longer on a supplier is zeroed with a note. One «بلا سعر» alert per list and
 * set of unpriced lines.
 */
export async function syncSupplierDues(env: Env, listId: number, opts: { force?: boolean } = {}): Promise<DueSyncReport> {
  const [list] = await call<ListRow[]>(env, "x_purchase_list", "read", {
    ids: [listId], fields: ["id", "x_date", "x_status", "x_supplier_id", "x_aggregated_items", SIM_FIELD],
  });
  if (!list) return { action: "not_found", listId };
  const day = String(list.x_date || "");
  if (list.x_utak_simulation) {
    // § 37 ج — a simulation list: no due is built or refreshed, no «بلا سعر» alert
    console.log(`[supplier-pay] skip dues list=${listId} ${day} — simulation (${SIM_FIELD})`);
    return { action: "simulation", listId, day };
  }
  if (list.x_status !== "done") return { action: "not_confirmed", listId, day };
  const items = parseItems(list.x_aggregated_items);
  const prices = await readPricesFor(env, day, items);
  const market = await readMarketPlan(env, day);
  const plan = planDues({ x_date: day, listSupplierId: list.x_supplier_id ? list.x_supplier_id[0] : null }, items, prices, market);
  const fp = fnv1a(JSON.stringify(plan));
  const fpKey = `sp_due_fp:v1:${listId}`;
  const summary = plan.dues.map((d) => ({ supplierId: d.supplierId, amount: money(d.amountH), unpriced: d.unpriced }));
  const unpriced = plan.dues.reduce((a, d) => a + d.unpriced, 0);
  if (!opts.force) {
    try {
      if ((await env.MSG_DEDUP.get(fpKey)) === fp) return { action: "unchanged", listId, day, dues: summary, unpriced, noSupplier: plan.noSupplier.length };
    } catch { /* recompute */ }
  }
  const names = await partnerNames(env, plan.dues.map((d) => d.supplierId));
  const existing = await call<DueRow[]>(env, DUE_MODEL, "search_read", {
    domain: [["x_purchase_list_id", "=", listId]],
    fields: ["id", "x_supplier_id", "x_purchase_list_id", "x_amount", "x_unpriced_count"],
    limit: 200,
  });
  const dueIds = existing.map((d) => d.id);
  const oldLines = dueIds.length
    ? await call<DueLineRow[]>(env, DUE_LINE_MODEL, "search_read", {
        domain: [["x_due_id", "in", dueIds]],
        fields: ["id", "x_due_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price", "x_subtotal", "x_no_price", "x_daily_price_id", "x_note"],
        limit: 2000,
      })
    : [];
  const sim = isTestMode(env);
  const touchedDues = new Set<number>();
  const keptLines = new Set<number>();
  for (const d of plan.dues) {
    const name = names.get(d.supplierId) ?? `#${d.supplierId}`;
    const vals = {
      x_name: `${name} — ${day} — قائمة #${listId}`,
      x_supplier_id: d.supplierId,
      x_purchase_list_id: listId,
      x_date: day,
      x_amount: toOdoo(d.amountH),
      x_unpriced_count: d.unpriced,
    };
    let dueId = existing.find((e) => e.x_supplier_id && e.x_supplier_id[0] === d.supplierId)?.id;
    if (dueId) await call(env, DUE_MODEL, "write", { ids: [dueId], vals });
    else [dueId] = await call<number[]>(env, DUE_MODEL, "create", { vals_list: [{ ...vals, ...(sim ? { x_is_simulation: true } : {}) }] });
    touchedDues.add(dueId);
    for (const l of d.lines) {
      const lv = {
        x_due_id: dueId,
        x_product_tmpl_id: l.productId,
        x_packaging_id: l.packagingId,
        x_quantity: l.quantity,
        x_unit_price: l.unitPrice ?? 0,
        x_subtotal: toOdoo(l.subtotalH),
        x_no_price: l.noPrice,
        x_daily_price_id: l.priceId ?? false,
        x_note: l.noPrice ? "بلا سعر: لا سعر من هذا المورد لهذا الصنف في ذلك اليوم"
          : l.marketBy ? `سعر شراء ${l.marketBy} المكتوب من السوق (فاز بسعر الشراء في «أسعار اليوم»)` : false,
      };
      const old = oldLines.find((o) => o.x_due_id && o.x_due_id[0] === dueId && o.x_product_tmpl_id && o.x_product_tmpl_id[0] === l.productId
        && o.x_packaging_id && o.x_packaging_id[0] === l.packagingId);
      if (old) {
        keptLines.add(old.id);
        await call(env, DUE_LINE_MODEL, "write", { ids: [old.id], vals: lv });
      } else {
        await call(env, DUE_LINE_MODEL, "create", { vals_list: [{ ...lv, ...(sim ? { x_is_simulation: true } : {}) }] });
      }
    }
  }
  // lines no longer on their supplier (the list's supplier changed): zeroed, kept
  const gone = oldLines.filter((o) => !keptLines.has(o.id) && (Number(o.x_subtotal) !== 0 || Number(o.x_quantity) !== 0));
  if (gone.length) await call(env, DUE_LINE_MODEL, "write", { ids: gone.map((o) => o.id), vals: { x_quantity: 0, x_subtotal: 0, x_no_price: false, x_note: "لم يعد على هذا المورد في القائمة" } });
  const orphanDues = existing.filter((e) => !touchedDues.has(e.id) && (Number(e.x_amount) !== 0 || Number(e.x_unpriced_count) !== 0));
  if (orphanDues.length) await call(env, DUE_MODEL, "write", { ids: orphanDues.map((e) => e.id), vals: { x_amount: 0, x_unpriced_count: 0 } });
  try { await env.MSG_DEDUP.put(fpKey, fp, { expirationTtl: 30 * 24 * 3600 }); } catch { /* recomputed next time */ }

  // the «بلا سعر» alert: when a line of the list is without a price for the
  // first time (a line priced later, or one already reported, alerts nothing)
  let alerted = false;
  const noPriceLines = plan.dues.flatMap((d) => d.lines.filter((l) => l.noPrice).map((l) => ({ supplierId: d.supplierId, l })));
  const keys = [
    ...noPriceLines.map((x) => `${x.supplierId}:${x.l.productId}:${x.l.packagingId}`),
    ...plan.noSupplier.map((i) => `none:${i.product_id}:${i.packaging_id}`),
  ];
  const seenKey = `sp_noprice_seen:v1:${listId}`;
  let seen: string[] = [];
  try { seen = JSON.parse((await env.MSG_DEDUP.get(seenKey)) ?? "[]"); } catch { seen = []; }
  const fresh = keys.filter((k) => !seen.includes(k));
  if (fresh.length) {
    const claim = await claimButton(env, `sp_noprice:${listId}:${fnv1a(fresh.slice().sort().join("|"))}`, 30 * 24 * 3600);
    try { await env.MSG_DEDUP.put(seenKey, JSON.stringify([...new Set([...seen, ...keys])]), { expirationTtl: 30 * 24 * 3600 }); } catch { /* the claim still stops a repeat */ }
    if (claim.claimed) {
      const lines = [
        ...noPriceLines.map((x) => `• ${names.get(x.supplierId) ?? "#" + x.supplierId}: ${x.l.productName} (${x.l.packagingName}) × ${x.l.quantity}`),
        ...plan.noSupplier.map((i) => market.winners.has(winnerKey(i.product_id, i.packaging_id))
          ? `• بلا مورد (شراء السوق، ولا شريك «${CASH_MARKET_NAME}» بالمرجع ${CASH_MARKET_REF}): ${cleanName(i.product_name)} (${cleanName(i.packaging_name)}) × ${i.total_quantity}`
          : `• بلا مورد: ${cleanName(i.product_name)} (${cleanName(i.packaging_name)}) × ${i.total_quantity}`),
      ];
      await sendOwnerAlert(env, tagged(env.TRIAL_TAG, [
        `⚠️ مستحقات الموردين — قائمة الشراء #${listId} (${arabicDate(day)}): أسطر «بلا سعر» لم تُحسب في المستحق:`,
        ...lines,
        "أدخل سعر المورد لذلك اليوم في «الأسعار اليومية»، وتُحسب تلقائياً (أو «🔄 إعادة حساب المستحقات» في 💵 دفع الموردين).",
      ].join("\n")));
      await finishButton(env, claim, 30 * 24 * 3600);
      alerted = true;
    }
  }
  console.log(`[supplier-pay] dues list=${listId} ${day} ${JSON.stringify(summary)} unpriced=${unpriced} noSupplier=${plan.noSupplier.length}`);
  return { action: "synced", listId, day, dues: summary, unpriced, noSupplier: plan.noSupplier.length, alerted };
}

// ---------------------------------------------------------------- the balance

export interface Balance { dueH: number; paidH: number; remainingH: number }

/**
 * Due (all its daily dues) − approved paid, simulation rows left out. The same
 * sums as the Odoo computes on res.partner (scripts/lib/s37-odoo-code.mjs).
 * Every «المتبقي» and «رصيد دائن» here comes from it.
 */
export async function supplierBalance(env: Env, supplierId: number): Promise<Balance> {
  const dues = await call<Array<{ x_amount: number }>>(env, DUE_MODEL, "search_read", {
    domain: [["x_supplier_id", "=", supplierId], NOT_SIM], fields: ["x_amount"], limit: 5000,
  });
  const paid = await call<Array<{ x_amount: number }>>(env, SP_MODEL, "search_read", {
    domain: [["x_supplier_id", "=", supplierId], ["x_state", "=", "approved"], NOT_SIM], fields: ["x_amount"], limit: 5000,
  });
  const dueH = dues.reduce((a, d) => a + halalas(d.x_amount), 0);
  const paidH = paid.reduce((a, p) => a + halalas(p.x_amount), 0);
  return { dueH, paidH, remainingH: dueH - paidH };
}

// ---------------------------------------------------------------- payments

export const SP_FIELDS = [
  "id", "x_name", "x_supplier_id", "x_date", "x_amount", "x_method", "x_recorded_by", "x_channel", "x_state",
  "x_note", "x_reject_reason", "x_decided_by", "x_decided_at", "x_overpaid", "x_remaining_after", "x_supplier_notice",
  "x_settled_at", "x_trial_tag", "x_source_wamid", SIM_FIELD,
];
export interface PaymentRow {
  id: number;
  x_name: string | false;
  x_supplier_id: [number, string] | false;
  x_date: string | false;
  x_amount: number;
  x_method: "cash" | "transfer" | false;
  x_recorded_by: [number, string] | false;
  x_channel: "odoo" | "whatsapp" | false;
  x_state: "pending" | "approved" | "rejected" | false;
  x_note: string | false;
  x_reject_reason: string | false;
  x_decided_by: [number, string] | false;
  x_decided_at: string | false;
  x_overpaid: boolean;
  x_remaining_after: number;
  x_supplier_notice: string | false;
  x_settled_at: string | false;
  x_trial_tag: string | false;
  x_source_wamid: string | false;
  x_utak_simulation?: boolean;
}

const nowOdoo = (ms: number = Date.now()) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

export async function readPayment(env: Env, id: number): Promise<PaymentRow | null> {
  const [p] = await call<PaymentRow[]>(env, SP_MODEL, "read", { ids: [id], fields: SP_FIELDS });
  return p ?? null;
}

/** The supplier's notice, exactly the template's text (the session text inside his window). */
export function supplierNoticeText(amountH: number, day: string, ref: string, remainingH: number): string {
  return `تم تسجيل دفعة لك من يو تاك بمبلغ ${money(amountH)} ر.س بتاريخ ${arabicDate(day)}، رقم المرجع ${ref}. الرصيد المتبقي لك: ${money(Math.max(0, remainingH))} ر.س.`;
}
export function supplierNoticeParams(amountH: number, day: string, ref: string, remainingH: number): string[] {
  return [money(amountH), arabicDate(day), ref, money(Math.max(0, remainingH))];
}

/** The payment references (SP-2026-0001 …) in a text or a template's parameters. */
export function paymentRefsIn(s: string): string[] {
  return [...new Set(String(s ?? "").match(/SP-\d{4}-\d{4,}/g) ?? [])];
}

/**
 * § 37 ج — the gateway's check (src/wa-gateway.ts), whoever sends the notice:
 * the first of these references that is a simulation payment, else null.
 * Throws when Odoo cannot answer; the gateway then refuses the send.
 */
export async function simulationPaymentRef(env: Env, refs: string[]): Promise<string | null> {
  if (!refs.length) return null;
  const rows = await call<Array<{ x_name: string | false }>>(env, SP_MODEL, "search_read", {
    domain: [["x_name", "in", refs], [SIM_FIELD, "=", true]], fields: ["x_name"], limit: refs.length,
  });
  return rows[0] ? String(rows[0].x_name) : null;
}

export interface TeamPaymentInput {
  supplierId: number;
  amountH: number;
  member: { id: number; name: string };
  receipt?: { base64: string; filename: string } | null;
  wamid?: string;
}

/**
 * Omar's cash payment: pending, with the member as «سجّلها». The reference
 * comes from Odoo (the on-create automation). Baraa gets one important alert
 * with the supplier, the amount, the reference and the remaining.
 */
export async function createTeamPayment(env: Env, input: TeamPaymentInput): Promise<{ id: number; ref: string; remainingBeforeH: number; duplicate: boolean }> {
  if (input.wamid) {
    const hit = await call<Array<{ id: number; x_name: string | false }>>(env, SP_MODEL, "search_read", {
      domain: [["x_source_wamid", "=", input.wamid]], fields: ["id", "x_name"], limit: 1,
    });
    if (hit[0]) return { id: hit[0].id, ref: String(hit[0].x_name || ""), remainingBeforeH: 0, duplicate: true };
  }
  const vals: Record<string, unknown> = {
    x_supplier_id: input.supplierId,
    x_amount: toOdoo(input.amountH),
    x_method: "cash",
    x_channel: "whatsapp",
    x_state: "pending",
    x_recorded_by: input.member.id,
    x_date: riyadhDateKey(),
    ...(input.wamid ? { x_source_wamid: input.wamid } : {}),
    ...(input.receipt ? { x_receipt: input.receipt.base64, x_receipt_filename: input.receipt.filename } : {}),
    ...(isTestMode(env) ? { x_is_simulation: true } : {}),
    ...(env.TRIAL_TAG ? { x_trial_tag: env.TRIAL_TAG } : {}),
  };
  const [id] = await call<number[]>(env, SP_MODEL, "create", { vals_list: [vals] });
  const p = await readPayment(env, id);
  const ref = String(p?.x_name || `#${id}`);
  const supplierName = p?.x_supplier_id ? p.x_supplier_id[1] : `#${input.supplierId}`;
  const bal = await supplierBalance(env, input.supplierId);
  const over = input.amountH - bal.remainingH;
  await sendOwnerAlert(env, tagged(p?.x_trial_tag || env.TRIAL_TAG, [
    `💵 دفعة نقدية من ${input.member.name} بانتظار اعتمادك`,
    `المورد: ${supplierName}`,
    `المبلغ: ${money(input.amountH)} ر.س`,
    `المرجع: ${ref}`,
    `المتبقي للمورد قبلها: ${money(bal.remainingH)} ر.س`,
    over > 0 ? `⚠️ تزيد عن المتبقي بـ ${money(over)} ر.س، فإن اعتُمدت تُعلَّم «رصيد دائن».` : "",
    `اعتمدها أو ارفضها من UTAK ← 💵 دفع الموردين (دفعات الموردين).${input.receipt ? " ومعها صورة الإيصال." : ""}`,
  ].filter(Boolean).join("\n")));
  console.log(`[supplier-pay] pending ${ref} supplier=${input.supplierId} ${money(input.amountH)} by ${input.member.name}`);
  return { id, ref, remainingBeforeH: bal.remainingH, duplicate: false };
}

export interface SettleReport {
  action: "not_found" | "pending" | "already" | "simulation" | "approved" | "rejected";
  id: number;
  ref?: string;
  remaining?: string;
  overpaid?: boolean;
  notice?: string;
  member?: string;
}

function noticeLabel(d: ReturnType<typeof gatewayDecision>, at: number): string {
  const hhmm = new Date(at + 3 * 3600_000).toISOString().slice(11, 16);
  if (!d) return "لم يُرسل";
  if (d.action === "session") return `نصاً ${hhmm}`;
  if (d.action === "template") return `بالقالب ${d.template} ${hhmm}`;
  if (d.action === "held") return "محفوظ حتى رسالته (خارج نافذة 24 ساعة ولا قالب معتمد)";
  if (d.action === "refused") return `محجوب: ${d.reason.slice(0, 120)}`;
  if (d.action === "skipped") return `لم يُرسل: ${d.reason.slice(0, 120)}`;
  return `رفضه Meta (${d.code ?? "?"})`;
}

async function supplierNumber(env: Env, supplierId: number): Promise<string> {
  const [p] = await call<Array<{ x_whatsapp_number: string | false; phone: string | false }>>(env, "res.partner", "read", {
    ids: [supplierId], fields: ["x_whatsapp_number", "phone"], context: { active_test: false },
  });
  return String(p?.x_whatsapp_number || p?.phone || "");
}

/**
 * A decided payment's consequences, once (KV claim + x_settled_at):
 *   approved → the balance after it (x_remaining_after, «رصيد دائن» + alert
 *              when negative), the supplier's notice, and — for Omar's — his line;
 *   rejected → Omar's line with the reason. No notice to the supplier.
 *   simulation (§ 37 ج) → nothing goes out: no notice (text or template), no
 *              line, no alert; only settled, with the skip in the log.
 */
export async function settlePayment(env: Env, id: number, opts: { ctx?: ExecutionContext; now?: number } = {}): Promise<SettleReport> {
  const now = opts.now ?? Date.now();
  const p = await readPayment(env, id);
  if (!p) return { action: "not_found", id };
  if (p.x_state !== "approved" && p.x_state !== "rejected") return { action: "pending", id, ref: String(p.x_name || "") };
  if (p.x_settled_at) return { action: "already", id, ref: String(p.x_name || "") };
  if (p.x_utak_simulation) {
    const ref = String(p.x_name || `#${id}`);
    console.warn(`[supplier-pay] skip ${ref} — simulation (${SIM_FIELD}): no notice, no ${SP_TEMPLATE}, no line, no alert`);
    await call(env, SP_MODEL, "write", { ids: [id], vals: { x_settled_at: nowOdoo(now), x_supplier_notice: SIM_NOTICE } });
    return { action: "simulation", id, ref, notice: SIM_NOTICE };
  }
  const claim = await claimButton(env, `sp_settle:${id}`, 30 * 24 * 3600);
  if (!claim.claimed) return { action: "already", id, ref: String(p.x_name || "") };
  const penv = { ...env, AUTO_SEND_JOB: undefined } as Env;
  try {
    const ref = String(p.x_name || `#${id}`);
    const supplierId = p.x_supplier_id ? p.x_supplier_id[0] : 0;
    const supplierName = p.x_supplier_id ? p.x_supplier_id[1] : "?";
    const amountH = halalas(p.x_amount);
    const day = String(p.x_date || riyadhDateKey(new Date(now)));
    const tag = p.x_trial_tag;
    const member = p.x_channel === "whatsapp" && p.x_recorded_by ? p.x_recorded_by : null;
    let memberLine = "";
    if (p.x_state === "rejected") {
      if (member) {
        const reason = String(p.x_reject_reason || "").trim() || "—";
        memberLine = await notifyMember(penv, member[0], tagged(tag, `❌ رفض براء دفعتك ${ref}: ${supplierName} بمبلغ ${money(amountH)} ر.س.\nالسبب: ${reason}`), opts.ctx);
      }
      await call(penv, SP_MODEL, "write", { ids: [id], vals: { x_settled_at: nowOdoo(now), x_supplier_notice: "لا إشعار للمورد (مرفوضة)" } });
      await finishButton(penv, claim, 30 * 24 * 3600);
      console.log(`[supplier-pay] rejected ${ref} settled member=${memberLine || "-"}`);
      return { action: "rejected", id, ref, member: memberLine || undefined };
    }
    const bal = await supplierBalance(penv, supplierId);
    const overpaid = bal.remainingH < 0;
    await call(penv, SP_MODEL, "write", { ids: [id], vals: { x_remaining_after: toOdoo(bal.remainingH), x_overpaid: overpaid } });
    if (overpaid) {
      await sendOwnerAlert(penv, tagged(tag, [
        `⚠️ «رصيد دائن» لدى المورد ${supplierName}`,
        `الدفعة ${ref} بمبلغ ${money(amountH)} ر.س جعلت المدفوع المعتمد ${money(bal.paidH)} ر.س أكبر من المستحق ${money(bal.dueH)} ر.س بـ ${money(-bal.remainingH)} ر.س.`,
      ].join("\n")));
    }
    // the supplier's notice: text inside his window, else the UTILITY template, else held (critical, § 34).
    // A trial's notice (x_trial_tag) never uses the template: it cannot carry the tag, and a real
    // supplier must not read a trial payment as his own — text inside the window, held outside it.
    // § 42 أ — «مشتريات السوق النقدية» has no number and is never notified (not even one added later).
    const cash = supplierId ? await findCashMarketSupplier(penv).catch(() => null) : null;
    const isCash = !!cash && cash.id === supplierId;
    const to = supplierId && !isCash ? await supplierNumber(penv, supplierId) : "";
    let notice = isCash ? CASH_MARKET_NOTICE : "لا رقم واتساب للمورد";
    if (to) {
      const resp = await sendViaGateway(penv, {
        purpose: SP_NOTICE_PURPOSE,
        to,
        content: textContent(tagged(tag, supplierNoticeText(amountH, day, ref, bal.remainingH))),
        fallback: tag ? [] : [{ kind: "template", purpose: SP_NOTICE_PURPOSE, params: supplierNoticeParams(amountH, day, ref, bal.remainingH) }],
        ctx: opts.ctx,
      });
      notice = noticeLabel(gatewayDecision(resp), now);
    }
    if (member) {
      memberLine = await notifyMember(penv, member[0], tagged(tag, `✅ اعتمد براء دفعتك ${ref}: ${supplierName} بمبلغ ${money(amountH)} ر.س.`), opts.ctx);
    }
    await call(penv, SP_MODEL, "write", { ids: [id], vals: { x_settled_at: nowOdoo(now), x_supplier_notice: notice.slice(0, 250) } });
    await finishButton(penv, claim, 30 * 24 * 3600);
    console.log(`[supplier-pay] approved ${ref} remaining=${money(bal.remainingH)} overpaid=${overpaid} notice=${notice} to=${maskPhone(to)}`);
    return { action: "approved", id, ref, remaining: money(bal.remainingH), overpaid, notice, member: memberLine || undefined };
  } catch (e) {
    // nothing is known to have gone out only if it threw before the notice: keep the claim, tell Baraa
    console.error(`[supplier-pay] settle ${id} failed`, (e as Error)?.message);
    await sendOwnerAlert(penv, `⚠️ تعذّر إكمال دفعة المورد ${String(p.x_name || id)}: ${(e as Error)?.message ?? e}. راجعها قبل إعادة المحاولة.`).catch(() => {});
    throw e;
  }
}

/** A text to the member (by Work Contact) through the gateway. Returns the decision label. */
async function notifyMember(env: Env, partnerId: number, text: string, ctx?: ExecutionContext): Promise<string> {
  const [p] = await call<Array<{ x_whatsapp_number: string | false; phone: string | false }>>(env, "res.partner", "read", {
    ids: [partnerId], fields: ["x_whatsapp_number", "phone"], context: { active_test: false },
  });
  const to = String(p?.x_whatsapp_number || p?.phone || "");
  if (!to) return "لا رقم";
  const resp = await sendViaGateway(env, { purpose: SP_TEAM_PURPOSE, to, content: textContent(text), ctx });
  return noticeLabel(gatewayDecision(resp), Date.now());
}

// ---------------------------------------------------------------- the hook and the tick

/**
 * Odoo → worker: a payment was created (approved when Baraa's) or decided.
 * Odoo sends the webhook before it commits: a record not found yet — or, for
 * «decided», still pending — is read again (twice). A new pending payment
 * (Omar's) is left alone.
 */
export async function onPaymentHook(env: Env, id: number, opts: { ctx?: ExecutionContext; waitMs?: number; op?: "created" | "decided" } = {}): Promise<SettleReport> {
  const waitMs = opts.waitMs ?? 1500;
  let r = await settlePayment(env, id, opts);
  const again = (x: SettleReport) => x.action === "not_found" || (x.action === "pending" && opts.op === "decided");
  for (let i = 0; i < 2 && again(r) && waitMs > 0; i++) {
    await new Promise((res) => setTimeout(res, waitMs));
    r = await settlePayment(env, id, opts);
  }
  return r;
}

/** Every confirmed list of the last days (a simulation list aside): its dues (a price that arrived later). */
export async function syncRecentDues(env: Env, now: number = Date.now(), opts: { force?: boolean; daysBack?: number } = {}): Promise<DueSyncReport[]> {
  const since = riyadhDateKey(new Date(now - (opts.daysBack ?? DUE_DAYS_BACK) * 24 * 3600_000));
  const lists = await call<ListRow[]>(env, "x_purchase_list", "search_read", {
    domain: [["x_status", "=", "done"], ["x_date", ">=", since], NOT_SIM],
    fields: ["id", "x_ahmad_confirmed_at"], order: "id asc", limit: 30,
  });
  const out: DueSyncReport[] = [];
  for (const l of lists) {
    const at = typeof l.x_ahmad_confirmed_at === "string" ? Date.parse(l.x_ahmad_confirmed_at.replace(" ", "T") + "Z") : 0;
    if (!opts.force && at && now - at < DUE_TICK_GRACE_MS) continue; // the tap's own sync is running
    out.push(await syncSupplierDues(env, l.id, { force: opts.force }));
  }
  return out;
}

export interface SupplierPayTick {
  dues?: Array<{ listId: number; action: string }> | { error: string };
  settled?: SettleReport[] | { error: string };
}

/** The every-5-minutes tick: the dues of recent confirmed lists, and a decided payment whose webhook was lost (never a simulation one). */
export async function runSupplierPayTick(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<SupplierPayTick> {
  const out: SupplierPayTick = {};
  try {
    out.dues = (await syncRecentDues(env, now)).map((r) => ({ listId: r.listId, action: r.action }));
  } catch (e) {
    out.dues = { error: (e as Error)?.message ?? String(e) };
  }
  try {
    const rows = await call<Array<{ id: number }>>(env, SP_MODEL, "search_read", {
      domain: [["x_state", "in", ["approved", "rejected"]], ["x_settled_at", "=", false],
        ["x_decided_at", "<=", nowOdoo(now - SETTLE_RETRY_AFTER_MS)], ["x_decided_at", ">=", nowOdoo(now - DUE_DAYS_BACK * 24 * 3600_000)], NOT_SIM],
      fields: ["id"], order: "id asc", limit: 20,
    });
    const settled: SettleReport[] = [];
    for (const r of rows) settled.push(await settlePayment(env, r.id, { ctx, now }));
    out.settled = settled;
  } catch (e) {
    out.settled = { error: (e as Error)?.message ?? String(e) };
  }
  return out;
}

// ---------------------------------------------------------------- Omar's steps on WhatsApp

export const SP_START = "sp_pay_start";
export const SP_SUPPLIER_PREFIX = "sp_sup_";
export const SP_SKIP = "sp_skip_receipt";
export const SP_START_TITLE = "💵 دفعت لمورد";
export const SP_FLOW_TTL = 30 * 60;
export const SP_CANCEL_WORDS = ["إلغاء", "الغاء", "الغ", "cancel"];

export const SP_TEXT = {
  noSuppliers: "ما فيه موردين في قائمة شراء اليوم. تُسجَّل الدفعة لمورد من القائمة فقط؛ غير ذلك سجّلها لبراء نصاً.",
  chooseSupplier: "💵 دفعت لمورد — اختر المورد من قائمة شراء اليوم:",
  chooseButton: "الموردون",
  askAmount: (name: string) => `المورد: ${name}\nاكتب المبلغ المدفوع رقماً فقط (مثال: 1500 أو 1500.50).`,
  badAmount: "⚠️ المبلغ لازم يكون رقماً فقط أكبر من صفر، بلا حروف ولا فواصل، مثل 1500 أو 1500.50. اكتب المبلغ مرة ثانية (أو «إلغاء»).",
  askReceipt: (amountH: number, name: string) => `المبلغ: ${money(amountH)} ر.س لـ ${name} (نقداً).\nأرسل صورة الإيصال الآن، أو اضغط «تخطي».`,
  receiptOnly: "أرسل صورة الإيصال، أو اضغط «تخطي» (أو اكتب «إلغاء»).",
  skip: "تخطي",
  receiptFailed: "ما قدرت أحفظ الصورة. أرسلها مرة ثانية، أو اضغط «تخطي».",
  cancelled: "أُلغي تسجيل الدفعة. ما سُجّل شيء.",
  expired: "انتهت مهلة تسجيل الدفعة. اضغط «💵 دفعت لمورد» من جديد.",
  notSupplier: "هذا المورد ليس في قائمة شراء اليوم. اضغط «💵 دفعت لمورد» من جديد.",
  notAllowed: "تسجيل دفعات الموردين لفريق الشراء والتحصيل فقط.",
  recorded: (ref: string, name: string, amountH: number, withReceipt: boolean) =>
    `✅ سُجّلت الدفعة ${ref}: ${name} بمبلغ ${money(amountH)} ر.س (نقداً)${withReceipt ? " مع صورة الإيصال" : ""}، وهي بانتظار اعتماد براء. يوصلك رده هنا.`,
};

export interface FlowState {
  step: "supplier" | "amount" | "receipt";
  supplierId?: number;
  supplierName?: string;
  amountH?: number;
  at: number;
}
export const flowKey = (partnerId: number) => `sp_flow:v1:${partnerId}`;

export async function readFlow(env: Env, partnerId: number): Promise<FlowState | null> {
  try {
    const raw = await env.MSG_DEDUP.get(flowKey(partnerId));
    return raw ? (JSON.parse(raw) as FlowState) : null;
  } catch {
    return null;
  }
}
async function writeFlow(env: Env, partnerId: number, s: FlowState): Promise<void> {
  await env.MSG_DEDUP.put(flowKey(partnerId), JSON.stringify(s), { expirationTtl: SP_FLOW_TTL });
}
async function clearFlow(env: Env, partnerId: number): Promise<void> {
  try { await env.MSG_DEDUP.delete(flowKey(partnerId)); } catch { /* expires */ }
}

/** The purchase role or the collection role («دور الشراء والتحصيل»). */
export function isPaymentMember(m: Pick<TeamMember, "x_role" | "x_role_codes">): boolean {
  const codes = new Set([m.x_role, ...(m.x_role_codes ?? [])]);
  return codes.has("warehouse") || codes.has("collector");
}
export function startButton(): { id: string; title: string } {
  return { id: SP_START, title: SP_START_TITLE };
}

/** The suppliers of today's purchase list(s): lists sent or confirmed in the last 36 hours (not a simulation list). */
export async function todaysSuppliers(env: Env, now: number = Date.now()): Promise<Array<{ id: number; name: string }>> {
  const since = riyadhDateKey(new Date(now - 36 * 3600_000));
  const lists = await call<ListRow[]>(env, "x_purchase_list", "search_read", {
    domain: [["x_status", "in", ["sent", "done"]], ["x_date", ">=", since], NOT_SIM],
    fields: ["id", "x_date", "x_supplier_id", "x_aggregated_items"], order: "id desc", limit: 5,
  });
  const ids: number[] = [];
  const markets = new Map<string, MarketPlan>();
  for (const l of lists) {
    const ls = l.x_supplier_id ? l.x_supplier_id[0] : null;
    // § 42 أ — a line whose purchase price the market won is owed to «مشتريات السوق النقدية»
    const day = String(l.x_date || "");
    let market = markets.get(day);
    if (!market) {
      market = await readMarketPlan(env, day).catch((e) => {
        console.warn(`[supplier-pay] market plan ${day} unreadable`, (e as Error)?.message);
        return { cashSupplierId: null, winners: new Map() } as MarketPlan;
      });
      markets.set(day, market);
    }
    for (const it of parseItems(l.x_aggregated_items)) {
      const won = market.winners.has(winnerKey(it.product_id, it.packaging_id));
      const s = won ? market.cashSupplierId : itemSupplier(it, ls);
      if (s && !ids.includes(s)) ids.push(s);
    }
    if (ls && !ids.includes(ls)) ids.push(ls);
  }
  if (!ids.length) return [];
  const rows = await call<Array<{ id: number; name: string; active: boolean }>>(env, "res.partner", "read", {
    ids, fields: ["id", "name", "active"], context: { active_test: false },
  });
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is { id: number; name: string; active: boolean } => !!r && r.active !== false)
    .map((r) => ({ id: r.id, name: r.name }));
}

function supplierPicker(suppliers: Array<{ id: number; name: string }>): RouterReply | { list: ReturnType<typeof listContent> } {
  const rows = suppliers.slice(0, 10).map((s) => ({ id: `${SP_SUPPLIER_PREFIX}${s.id}`, title: s.name }));
  if (rows.length <= 3) return { bodyBeforeButtons: SP_TEXT.chooseSupplier, buttons: rows };
  return { list: listContent(SP_TEXT.chooseSupplier, SP_TEXT.chooseButton, rows) };
}

export type FlowReply = RouterReply & { list?: ReturnType<typeof listContent> };

/** A team member's tap on one of the flow's buttons (sp_…). */
export async function handlePayButton(env: Env, member: TeamMember, buttonId: string, now: number = Date.now()): Promise<FlowReply> {
  if (!isPaymentMember(member)) return { text: SP_TEXT.notAllowed };
  if (buttonId === SP_START) {
    const suppliers = await todaysSuppliers(env, now);
    if (!suppliers.length) { await clearFlow(env, member.id); return { text: SP_TEXT.noSuppliers }; }
    await writeFlow(env, member.id, { step: "supplier", at: now });
    // a text now is the amount, not an earlier «مشكلة» / «ملاحظة»
    for (const k of [`pending_issue:${member.id}`, `pending_purchase_issue:${member.id}`, `pending_collect_note:${member.id}`, `cpay_amount:v1:${member.id}`]) {
      await env.MSG_DEDUP.delete(k).catch(() => {});
    }
    return supplierPicker(suppliers) as FlowReply;
  }
  const flow = await readFlow(env, member.id);
  if (buttonId.startsWith(SP_SUPPLIER_PREFIX)) {
    if (!flow) return { text: SP_TEXT.expired, buttons: [startButton()] };
    const id = Number(buttonId.slice(SP_SUPPLIER_PREFIX.length));
    const s = (await todaysSuppliers(env, now)).find((x) => x.id === id);
    if (!s) return { text: SP_TEXT.notSupplier, buttons: [startButton()] };
    await writeFlow(env, member.id, { step: "amount", supplierId: s.id, supplierName: s.name, at: now });
    return { text: SP_TEXT.askAmount(s.name) };
  }
  if (buttonId === SP_SKIP) {
    if (!flow || flow.step !== "receipt" || !flow.supplierId || !flow.amountH) return { text: SP_TEXT.expired, buttons: [startButton()] };
    return await finishFlow(env, member, flow, null);
  }
  return { text: "" };
}

/** A text while the flow is open: the amount, a word in the receipt step, or «إلغاء». Null = not in the flow. */
export async function handlePayText(env: Env, member: TeamMember, text: string, now: number = Date.now()): Promise<FlowReply | null> {
  const flow = await readFlow(env, member.id);
  if (!flow) return null;
  const t = String(text ?? "").trim();
  if (SP_CANCEL_WORDS.includes(t.toLowerCase())) { await clearFlow(env, member.id); return { text: SP_TEXT.cancelled }; }
  if (flow.step === "supplier") {
    const suppliers = await todaysSuppliers(env, now);
    return suppliers.length ? (supplierPicker(suppliers) as FlowReply) : { text: SP_TEXT.noSuppliers };
  }
  if (flow.step === "amount") {
    const h = parseAmount(t);
    if (h === null) return { text: SP_TEXT.badAmount };
    await writeFlow(env, member.id, { ...flow, step: "receipt", amountH: h, at: now });
    return { bodyBeforeButtons: SP_TEXT.askReceipt(h, flow.supplierName ?? ""), buttons: [{ id: SP_SKIP, title: SP_TEXT.skip }] };
  }
  return { bodyBeforeButtons: SP_TEXT.receiptOnly, buttons: [{ id: SP_SKIP, title: SP_TEXT.skip }] };
}

/** An image / document while the flow waits for the receipt. Null = not waiting for one. */
export async function handlePayMedia(
  env: Env,
  member: TeamMember,
  media: { id: string; mime_type?: string; filename?: string },
  wamid?: string,
): Promise<FlowReply | null> {
  const flow = await readFlow(env, member.id);
  if (!flow || flow.step !== "receipt" || !flow.supplierId || !flow.amountH) return null;
  const file = await downloadMedia(env, media.id);
  if (!file) return { bodyBeforeButtons: SP_TEXT.receiptFailed, buttons: [{ id: SP_SKIP, title: SP_TEXT.skip }] };
  const ext = /pdf/.test(file.mime) ? "pdf" : /png/.test(file.mime) ? "png" : "jpg";
  return await finishFlow(env, member, flow, { base64: file.base64, filename: media.filename || `إيصال-${riyadhDateKey()}.${ext}` }, wamid);
}

async function finishFlow(env: Env, member: TeamMember, flow: FlowState, receipt: { base64: string; filename: string } | null, wamid?: string): Promise<FlowReply> {
  await clearFlow(env, member.id);
  const r = await createTeamPayment(env, {
    supplierId: flow.supplierId!, amountH: flow.amountH!, member: { id: member.id, name: member.name }, receipt, wamid,
  });
  return { text: SP_TEXT.recorded(r.ref, flow.supplierName ?? "", flow.amountH!, !!receipt) };
}

/** Meta media → base64 (the receipt photo, through the inbox's download). Null when Meta or the download fails. */
export async function downloadMedia(env: Env, mediaId: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const { fetchMetaMediaBytes } = await import("./wa-inbox");
    const got = await fetchMetaMediaBytes(env, mediaId);
    if (!got) return null;
    let s = "";
    for (let i = 0; i < got.bytes.length; i += 0x8000) s += String.fromCharCode(...got.bytes.subarray(i, i + 0x8000));
    return { base64: btoa(s), mime: got.mime || "image/jpeg" };
  } catch (e) {
    console.warn("[supplier-pay] receipt download failed", (e as Error)?.message);
    return null;
  }
}
