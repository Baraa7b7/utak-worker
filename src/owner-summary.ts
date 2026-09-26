// م17 — Baraa's daily summary (2026-09-26, STATUS § 38; WA-SCENARIOS م17 / ك2).
//
// 21:30 Riyadh (the sim cron OWNER_SUMMARY_CRON), after the 21:00 close and the
// 21:15 purchase list. utak_v2_summary (UTILITY, APPROVED; purpose
// owner_summary): «ملخص اليوم جاهز / طلبات: {{1}} / توصيلات: {{2}} / إجمالي:
// {{3}} ريال / تفاصيل أكثر في لوحة القيادة.» Three variables, one line each,
// from Odoo only, every record marked x_utak_simulation left out (the order,
// its invoice, its payment), the Riyadh day — never UTC:
//   {{1}} tomorrow's confirmed orders: today's ordering day (x_order_date =
//         today) in confirmed / in_purchase / in_delivery — they are delivered
//         tomorrow morning. Their count, and their total in SAR: every line not
//         «unavailable» × its price (the line's manual price, else its unit
//         price, else the price the quotation and the invoice use:
//         getLatestSalePrice). A line with no price at all makes the total
//         «تعذّر» — never a partial sum.
//   {{2}} today's deliveries: yesterday's ordering day (delivered this
//         morning) — delivered (delivered / closed) of all that went to
//         delivery (confirmed / in_purchase / in_delivery / delivered / closed).
//   {{3}} today's collection: collected today (x_payment.x_collected_at in
//         today's Riyadh day, cash or transfer) and pending (the open balance of
//         the issued / overdue invoices dated up to today: total − paid).
// Inside Baraa's window: the text. Outside it: the template (the gateway's
// usual choice); neither → held for his next tap (36 h). Once a day: a KV
// claim before the send. A figure Odoo cannot give: the summary still goes,
// with «تعذّر» in its place — never a guessed number.
//
// § 40 هـ (2026-09-26) — the cost coverage: today's profit = Σ (sale −
// purchase − waste − discount) over the lines of today's deliveries (the
// orders of {{2}}: yesterday's ordering day, delivered / closed, simulation
// out) — the sale the line's price (its manual price, else the price its
// invoice wrote back), the purchase and the waste of the engine on the order's
// day (x_price_day_line, x_pricing_config), the discount its invoice was
// issued with; coverage % = profit ÷ daily_operating_cost(today) × 100. In the
// text: a fourth line «تغطية تكاليف اليوم: X% (ربح Y من Z)». In the template:
// the same, short, at the end of {{3}} on the same line (its «ريال» follows).

import type { Env } from "./config";
import { profitVatRate } from "./config";
import { call, getLatestSalePrice } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { T } from "./templates";
import { withAutoSendJob } from "./auto-send-guard";
import { claimButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, toOdooUtc } from "./hours";
import { arabicDate } from "./wa-params";
import { SIM_FIELD } from "./supplier-pay";
import { dailyOperatingCost, readPricingSettings } from "./operating-cost";

/** The sim cron of the summary (wrangler.toml [env.sim.triggers], src/auto-send-guard.ts CRON_JOB): 21:30 Riyadh. */
export const OWNER_SUMMARY_CRON = "30 18 * * *";
export const OWNER_SUMMARY_JOB = "owner_summary";
export const UNAVAILABLE = "تعذّر";
const TOMORROW_STATES = ["confirmed", "in_purchase", "in_delivery"];
const DELIVERY_STATES = ["confirmed", "in_purchase", "in_delivery", "delivered", "closed"];
const DELIVERED_STATES = new Set(["delivered", "closed"]);
const CLAIM_TTL = 3 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** 1250 → «1250.00». */
export const sar = (n: number) => round2(n).toFixed(2);

export interface SummaryFigures {
  day: string;
  tomorrow: { count: number; total: number | null; unpriced: number } | null;
  deliveries: { delivered: number; total: number } | null;
  collected: number | null;
  pending: number | null;
  /** § 40 هـ — today's profit (deliveries), today's operating cost, and the coverage (null = «تعذّر»). */
  coverage: { profit: number | null; cost: number | null; pct: number | null };
  errors: string[];
}

/** Orders of `day` in `states`, not marked simulation. */
async function ordersOf(env: Env, day: string, states: string[]): Promise<Array<{ id: number; x_state: string }>> {
  return call(env, "x_daily_order", "search_read", {
    domain: [["x_order_date", "=", day], ["x_state", "in", states], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_state"],
    limit: 2000,
  });
}

/** The total of these orders at the price each line would be quoted / invoiced; unpriced = lines with no price. */
async function ordersTotal(env: Env, orderIds: number[]): Promise<{ total: number; unpriced: number }> {
  if (orderIds.length === 0) return { total: 0, unpriced: 0 };
  const lines = await call<Array<{
    x_order_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_quantity: number;
    x_status: string | false; x_unit_price: number | false; x_price_unit_manual: number | false;
  }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", orderIds]],
    fields: ["x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status", "x_unit_price", "x_price_unit_manual"],
    limit: 10000,
  });
  const lookups = new Map<string, Promise<number>>();
  const priceOf = (productId: number, packagingId: number): Promise<number> => {
    const k = `${productId}:${packagingId}`;
    if (!lookups.has(k)) lookups.set(k, getLatestSalePrice(env, productId, packagingId).then((p) => (p.price > 0 ? p.price : 0)));
    return lookups.get(k)!;
  };
  let total = 0, unpriced = 0;
  for (const l of lines) {
    if (l.x_status === "unavailable") continue;
    const manual = Number(l.x_price_unit_manual) || 0;
    const unit = Number(l.x_unit_price) || 0;
    const price = manual > 0 ? manual : unit > 0 ? unit : await priceOf(m2oId(l.x_product_tmpl_id), m2oId(l.x_packaging_id));
    if (!(price > 0)) { unpriced++; continue; }
    total += price * (Number(l.x_quantity) || 0);
  }
  return { total: round2(total), unpriced };
}

/** Invoices (by id) and the ids among them that are simulation — their own flag or their order's. */
async function simInvoices(env: Env, invoiceIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const invs = await call<Array<{ id: number; x_order_id: M2O } & Record<string, unknown>>>(env, "x_invoice", "read", {
    ids, fields: ["id", "x_order_id", SIM_FIELD],
  });
  const orderIds = [...new Set(invs.map((i) => m2oId(i.x_order_id)).filter(Boolean))];
  const simOrders = new Set(orderIds.length
    ? (await call<Array<{ id: number } & Record<string, unknown>>>(env, "x_daily_order", "read", { ids: orderIds, fields: ["id", SIM_FIELD] }))
      .filter((o) => o[SIM_FIELD] === true).map((o) => o.id)
    : []);
  return new Set(invs.filter((i) => i[SIM_FIELD] === true || simOrders.has(m2oId(i.x_order_id))).map((i) => i.id));
}

async function collectedOn(env: Env, day: string): Promise<number> {
  const from = riyadhDayMinuteMs(day, 0);
  const pays = await call<Array<{ x_amount: number; x_invoice_id: M2O } & Record<string, unknown>>>(env, "x_payment", "search_read", {
    domain: [
      ["x_collected_at", ">=", toOdooUtc(from)], ["x_collected_at", "<", toOdooUtc(from + DAY_MS)],
      ["x_method", "in", ["cash", "transfer"]], [SIM_FIELD, "!=", true],
    ],
    fields: ["x_amount", "x_invoice_id"],
    limit: 5000,
  });
  const sim = await simInvoices(env, pays.map((p) => m2oId(p.x_invoice_id)));
  return round2(pays.filter((p) => !sim.has(m2oId(p.x_invoice_id))).reduce((s, p) => s + (Number(p.x_amount) || 0), 0));
}

async function pendingUpTo(env: Env, day: string): Promise<number> {
  const invs = await call<Array<{ id: number; x_total: number }>>(env, "x_invoice", "search_read", {
    domain: [["x_status", "in", ["issued", "overdue"]], ["x_invoice_date", "<=", day], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_total"],
    limit: 5000,
  });
  if (invs.length === 0) return 0;
  const sim = await simInvoices(env, invs.map((i) => i.id));
  const open = invs.filter((i) => !sim.has(i.id));
  if (open.length === 0) return 0;
  const pays = await call<Array<{ x_amount: number; x_invoice_id: M2O }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "in", open.map((i) => i.id)], [SIM_FIELD, "!=", true]],
    fields: ["x_amount", "x_invoice_id"],
    limit: 10000,
  });
  const paid = new Map<number, number>();
  for (const p of pays) paid.set(m2oId(p.x_invoice_id), (paid.get(m2oId(p.x_invoice_id)) ?? 0) + (Number(p.x_amount) || 0));
  return round2(open.reduce((s, i) => s + Math.max(0, round2((Number(i.x_total) || 0) - (paid.get(i.id) ?? 0))), 0));
}

/**
 * § 40 هـ — the profit of the day's deliveries (the orders of `orderDay`,
 * delivered / closed, not simulation): Σ (sale − purchase − waste % ×
 * purchase) × qty − their invoices' discounts. Null when a line has no sale
 * price or no purchase price of its day (never a partial sum).
 * § 41 أ — `vatRatePct` (15 when the summary day is from the cutoff: the
 * deliveries are invoiced today, VAT-inclusive): net of VAT, per line by the
 * source that won its purchase (registered: ÷ 1.15; else sale ÷ 1.15 −
 * purchase − waste), each invoice's discount (VAT-inclusive: the lines'
 * total − the invoice's total) taken off before the division.
 */
async function deliveredProfit(env: Env, orderDay: string, vatRatePct: number | null = null): Promise<number> {
  const orders = await ordersOf(env, orderDay, [...DELIVERED_STATES]);
  if (orders.length === 0) return 0;
  const ids = orders.map((o) => o.id);
  const lines = await call<Array<{ x_order_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_quantity: number; x_status: string | false; x_unit_price: number | false; x_price_unit_manual: number | false }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", ids]],
    fields: ["x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status", "x_unit_price", "x_price_unit_manual"],
    limit: 10000,
  });
  const costs = await call<Array<{ x_product_tmpl_id: M2O; x_packaging_id: M2O; x_cost_price: number | false; x_supplier_id: M2O }>>(env, "x_price_day_line", "search_read", {
    domain: [["x_day_id.x_date", "=", orderDay], ["x_cost_price", ">", 0]],
    fields: ["x_product_tmpl_id", "x_packaging_id", "x_cost_price", "x_supplier_id"],
    limit: 2000,
  });
  const cost = new Map(costs.map((c) => [`${m2oId(c.x_product_tmpl_id)}:${m2oId(c.x_packaging_id)}`, { price: Number(c.x_cost_price) || 0, source: m2oId(c.x_supplier_id) }]));
  const waste = (await readPricingSettings(env, orderDay))?.wastePct;
  if (waste === undefined) throw new Error(`no pricing settings on ${orderDay}`);
  let registered: (pid: number) => boolean = () => true;
  if (vatRatePct) {
    const { isSourceVatRegistered, loadPriceSources } = await import("./price-sources");
    const sources = await loadPriceSources(env);
    registered = (pid) => isSourceVatRegistered(sources, pid);
  }
  const { vatProfit } = await import("./pricing-engine");
  let profit = 0;
  const grossByOrder = new Map<number, number>();
  for (const l of lines) {
    if (String(l.x_status) === "unavailable") continue; // short at delivery: not sold
    const sale = Number(l.x_price_unit_manual) > 0 ? Number(l.x_price_unit_manual) : Number(l.x_unit_price) || 0;
    const buy = cost.get(`${m2oId(l.x_product_tmpl_id)}:${m2oId(l.x_packaging_id)}`);
    if (!(sale > 0)) throw new Error("a delivered line without a sale price");
    if (!(buy && buy.price > 0)) throw new Error("a delivered line without its day's purchase price");
    const qty = Number(l.x_quantity) || 0;
    profit += vatProfit(sale, buy.price, waste, vatRatePct, registered(buy.source)) * qty;
    grossByOrder.set(m2oId(l.x_order_id), (grossByOrder.get(m2oId(l.x_order_id)) ?? 0) + round2(sale * qty));
  }
  const invs = await call<Array<{ id: number; x_order_id: M2O; x_subtotal: number | false; x_tax_amount: number | false; x_total: number }>>(env, "x_invoice", "search_read", {
    domain: [["x_order_id", "in", ids], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_order_id", "x_subtotal", "x_tax_amount", "x_total"],
    limit: 2000,
  });
  const { invoiceDiscount } = await import("./invoice");
  for (const i of invs) {
    const d = invoiceDiscount({ subtotal: Number(i.x_subtotal) || 0, tax: Number(i.x_tax_amount) || 0, total: Number(i.x_total) || 0 });
    if (!(d > 0)) continue;
    // with VAT: the discount as the customer saw it (lines − invoice total), off before ÷ 1.15
    profit -= vatRatePct
      ? Math.max(0, round2((grossByOrder.get(m2oId(i.x_order_id)) ?? 0) - (Number(i.x_total) || 0))) / (1 + vatRatePct / 100)
      : d;
  }
  return round2(profit);
}

/** Every figure, each on its own: one that Odoo cannot give is null (and named in errors). */
export async function readSummaryFigures(env: Env, nowMs: number = Date.now()): Promise<SummaryFigures> {
  const day = riyadhDateKey(new Date(nowMs));
  const yesterday = riyadhDateKey(new Date(nowMs - DAY_MS));
  const f: SummaryFigures = { day, tomorrow: null, deliveries: null, collected: null, pending: null, coverage: { profit: null, cost: null, pct: null }, errors: [] };
  const attempt = async <X>(name: string, fn: () => Promise<X>): Promise<X | null> => {
    try { return await fn(); } catch (e) {
      f.errors.push(`${name}: ${(e as Error)?.message ?? e}`);
      console.warn(`[owner-summary] ${name} failed`, (e as Error)?.message);
      return null;
    }
  };
  const tomorrowOrders = await attempt("tomorrow", () => ordersOf(env, day, TOMORROW_STATES));
  if (tomorrowOrders) {
    const t = await attempt("tomorrow_total", () => ordersTotal(env, tomorrowOrders.map((o) => o.id)));
    f.tomorrow = { count: tomorrowOrders.length, total: t && t.unpriced === 0 ? t.total : null, unpriced: t?.unpriced ?? 0 };
  }
  const dl = await attempt("deliveries", () => ordersOf(env, yesterday, DELIVERY_STATES));
  if (dl) f.deliveries = { delivered: dl.filter((o) => DELIVERED_STATES.has(o.x_state)).length, total: dl.length };
  f.collected = await attempt("collected", () => collectedOn(env, day));
  f.pending = await attempt("pending", () => pendingUpTo(env, day));
  // § 40 هـ — the cost coverage of the day
  // § 41 أ — the deliveries are invoiced today: VAT out of the profit from the cutoff
  const profit = await attempt("coverage_profit", () => deliveredProfit(env, yesterday, profitVatRate(day)));
  const cost = await attempt("coverage_cost", async () => (await dailyOperatingCost(env, day, nowMs)).total);
  f.coverage = { profit, cost, pct: profit !== null && cost !== null && cost > 0 ? Math.round((profit / cost) * 100) : null };
  return f;
}

/** «34%» / «تعذّر». */
function pctText(c: SummaryFigures["coverage"]): string {
  return c.pct === null ? UNAVAILABLE : `${c.pct}%`;
}
const amountText = (n: number | null) => (n === null ? UNAVAILABLE : sar(n));
/** The text's fourth line: «تغطية تكاليف اليوم: X% (ربح Y من Z)». */
export function coverageLine(c: SummaryFigures["coverage"]): string {
  return `تغطية تكاليف اليوم: ${pctText(c)} (ربح ${amountText(c.profit)} من ${amountText(c.cost)})`;
}
/** The template's short form, appended to {{3}} (its «ريال» follows the cost). */
export function coverageShort(c: SummaryFigures["coverage"]): string {
  return `تغطية التكاليف ${pctText(c)} بربح ${amountText(c.profit)} من ${amountText(c.cost)}`;
}

/** The three variables of utak_v2_summary — one line each. */
export function summaryParams(f: SummaryFigures): [string, string, string] {
  const tomorrowDay = arabicDate(riyadhDateKey(new Date(riyadhDayMinuteMs(f.day, 12 * 60) + DAY_MS)));
  const p1 = !f.tomorrow ? UNAVAILABLE
    : f.tomorrow.total !== null ? `${f.tomorrow.count} مؤكدة لـ ${tomorrowDay} بإجمالي ${sar(f.tomorrow.total)} ريال`
    : `${f.tomorrow.count} مؤكدة لـ ${tomorrowDay}، والإجمالي ${UNAVAILABLE}${f.tomorrow.unpriced ? ` (${f.tomorrow.unpriced} سطر بلا سعر)` : ""}`;
  const p2 = f.deliveries ? `${f.deliveries.delivered} مسلَّمة من ${f.deliveries.total}` : UNAVAILABLE;
  const p3 = f.collected === null && f.pending === null ? UNAVAILABLE
    : `المحصَّل اليوم ${f.collected === null ? UNAVAILABLE : sar(f.collected)} والمعلَّق ${f.pending === null ? UNAVAILABLE : sar(f.pending)}`;
  // § 40 هـ — the coverage, short, on the same line at the end of {{3}}
  return [p1, p2, `${p3} · ${coverageShort(f.coverage)}`];
}

/** The same summary as text, inside his window. */
export function summaryText(f: SummaryFigures): string {
  const [p1, p2] = summaryParams(f);
  const p3 = f.collected === null && f.pending === null ? UNAVAILABLE
    : `المحصَّل اليوم ${f.collected === null ? UNAVAILABLE : sar(f.collected)} والمعلَّق ${f.pending === null ? UNAVAILABLE : sar(f.pending)}`;
  return [
    `📊 ملخص اليوم ${arabicDate(f.day)}`,
    `طلبات الغد: ${p1}`,
    `توصيلات اليوم: ${p2}`,
    `تحصيل اليوم: ${p3 === UNAVAILABLE || f.pending === null ? p3 : `${p3} ريال`}`,
    coverageLine(f.coverage),
  ].join("\n");
}

export interface SummaryReport { day: string; action: string; figures?: SummaryFigures }

export async function sendOwnerSummary(rawEnv: Env, nowMs: number = Date.now()): Promise<SummaryReport> {
  const env = withAutoSendJob(rawEnv, OWNER_SUMMARY_JOB);
  const day = riyadhDateKey(new Date(nowMs));
  if (!env.OWNER_WHATSAPP) return { day, action: "no_owner" };
  const claim = await claimButton(env, `owner_summary:${day}`, CLAIM_TTL);
  if (!claim.claimed) return { day, action: "sent_before" };
  const figures = await readSummaryFigures(env, nowMs);
  const r = await sendViaGateway(env, {
    purpose: T.OWNER_SUMMARY,
    to: env.OWNER_WHATSAPP,
    content: textContent(summaryText(figures)),
    fallback: [{ kind: "template", purpose: T.OWNER_SUMMARY, params: summaryParams(figures) }],
  });
  const d = gatewayDecision(r);
  return { day, action: d?.action ?? `status_${r.status}`, figures };
}
