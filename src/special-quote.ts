// § 62 أ (2026-10-07) — «طلب أسعار خاص»: a customer's request for items outside
// the day's list. The request, its lines and its sources live in Odoo
// (x_special_quote, x_special_quote_line, x_special_quote_recipient —
// scripts/lib/s62-odoo.mjs); every number on them is written here.
//
//   • A new request is PREPARED once (x_prepared): its name «SQ-0001», the waste
//     of the settings, the minimum margin 10 %, the delivery cost = the day's
//     operating cost, «صالح حتى» = the end of tomorrow, and its sources — every
//     partner «مصدر أسعار» by his «دور الأسعار», and every marketing member as a
//     market source of THIS request alone (his card is not touched).
//   • recalcQuote: each line's median of the market, «بدون خسارة», «المقترح», its
//     total and its profit (src/special-quote-math.ts), and above them the
//     order's profit with its sign and the count of lines without a purchase
//     price. ONE write, and only what changed: a save in Odoo asks for this
//     again (the automation on the request), and a second pass writes nothing.
//   • «اعتمد المقترح للكل»: the final price takes «المقترح» on every line that
//     has none yet — a price Baraa typed is never overwritten.
//   • The state: «مُسعَّر» once every line has a final price (back to «أُرسل
//     للمصادر» / «مسودة» when one loses it); «صدر العرض» and «مغلق» are not
//     touched here.
//
// Nothing here reads or writes the day's prices (x_price_day, x_daily_price),
// and nothing here sends a message: the ask is src/special-ask.ts, the
// quotation src/special-quotation.ts.

import type { Env } from "./config";
import { call, stripRef } from "./odoo";
import { riyadhDateKey } from "./hours";
import {
  DEFAULT_MARGIN_PCT, DEFAULT_UNIT, lineNumbers, money, orderNumbers, profitText, round2, summaryText, type OrderNumbers,
} from "./special-quote-math";
import type { PriceKind } from "./price-sources";

export const QUOTE_MODEL = "x_special_quote";
export const LINE_MODEL = "x_special_quote_line";
export const RECIPIENT_MODEL = "x_special_quote_recipient";
export type QuoteState = "draft" | "sent" | "priced" | "quoted" | "closed";
export const STATE_LABEL: Readonly<Record<QuoteState, string>> = { draft: "مسودة", sent: "أُرسل للمصادر", priced: "مُسعَّر", quoted: "صدر العرض", closed: "مغلق" };
const SIM_FIELD = "x_utak_simulation";

type M2O = [number, string] | number | false | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);
const m2oName = (v: M2O): string => (Array.isArray(v) ? String(v[1] ?? "") : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const nowOdoo = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
/** «SQ-0001»: the request's name, from its id. */
export const quoteName = (id: number): string => `SQ-${String(id).padStart(4, "0")}`;

/** What one source sent for a line: his price, his name, when. Keyed by his partner id. */
export type ObsMap = Record<string, { p: number; n: string; at: number }>;
export interface LineObs { purchase: ObsMap; market: ObsMap }
/** The line's observations as the worker keeps them (x_obs, JSON). Anything unreadable = none. */
export function parseObs(raw: unknown): LineObs {
  const out: LineObs = { purchase: {}, market: {} };
  try {
    const j = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : null;
    for (const kind of ["purchase", "market"] as const) {
      for (const [k, v] of Object.entries((j?.[kind] ?? {}) as Record<string, { p?: unknown; n?: unknown; at?: unknown }>)) {
        const p = Number(v?.p);
        if (Number(k) > 0 && p > 0) out[kind][k] = { p: round2(p), n: String(v?.n ?? ""), at: Number(v?.at) || 0 };
      }
    }
  } catch { /* none */ }
  return out;
}
export const obsText = (o: LineObs): string => JSON.stringify(o);
/** «أقل عرض» of the purchase sources; 0 = none sent one. */
export const lowestPurchase = (o: LineObs): number => Object.values(o.purchase).reduce((m, v) => (m === 0 || v.p < m ? v.p : m), 0);
const first = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
/** «5.5 (رائد 5 · عمر 6)»: the median, then every observation with its source. Empty = no observation. */
export function marketText(o: LineObs, median: number): string {
  const each = Object.values(o.market).sort((a, b) => a.at - b.at).map((v) => `${first(v.n) || "مصدر"} ${money(v.p)}`);
  return each.length ? `${money(median)} (${each.join(" · ")})` : "";
}

export interface QuoteLine {
  id: number;
  sequence: number;
  productId: number;
  productName: string;
  qty: number;
  unit: string;
  purchase: number;
  marketText: string;
  marketMedian: number;
  noLoss: number;
  suggested: number;
  finalPrice: number;
  total: number;
  profit: number;
  obs: LineObs;
}
export interface QuoteRecipient {
  id: number;
  partnerId: number;
  name: string;
  role: PriceKind | null;
  askedAt: string;
  via: string;
  repliedAt: string;
  priced: number;
  remindedAt: string;
}
export interface SpecialQuote {
  id: number;
  name: string;
  partnerId: number;
  partnerName: string;
  date: string;
  state: QuoteState | null;
  wastePct: number;
  marginPct: number;
  deliveryCost: number;
  /** Odoo's UTC «YYYY-MM-DD HH:MM:SS»; empty = none. */
  validUntil: string;
  note: string;
  prepared: boolean;
  simulation: boolean;
  askedAt: string;
  saleOrderId: number;
  quotationNumber: string;
  pdfUrl: string;
  sourceNotes: string;
  header: { orderProfit: number; profitText: string; missingPurchase: number; missingFinal: number; total: number; summary: string };
  lines: QuoteLine[];
  recipients: QuoteRecipient[];
}

const QUOTE_READ = ["id", "x_name", "x_partner_id", "x_date", "x_state", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_valid_until", "x_note", "x_prepared", SIM_FIELD,
  "x_asked_at", "x_sale_order_id", "x_quotation_number", "x_pdf_url", "x_source_notes", "x_order_profit", "x_profit_text", "x_missing_purchase", "x_missing_final", "x_total", "x_summary"];
const LINE_READ = ["id", "x_sequence", "x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_market_text", "x_market_median", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_total", "x_profit", "x_obs"];
const RECIPIENT_READ = ["id", "x_partner_id", "x_role", "x_asked_at", "x_via", "x_replied_at", "x_priced", "x_reminded_at"];
const asState = (v: unknown): QuoteState | null => (v === "draft" || v === "sent" || v === "priced" || v === "quoted" || v === "closed" ? v : null);
const asRole = (v: unknown): PriceKind | null => (v === "purchase" || v === "market" ? v : null);

/** The request with its lines and its sources (three reads). Null when it is not there. Throws on Odoo trouble. */
export async function readQuote(env: Env, id: number): Promise<SpecialQuote | null> {
  if (!(id > 0)) return null;
  const [q] = await call<Array<Record<string, unknown>>>(env, QUOTE_MODEL, "read", { ids: [id], fields: QUOTE_READ });
  if (!q) return null;
  const lines = await call<Array<Record<string, unknown>>>(env, LINE_MODEL, "search_read", { domain: [["x_quote_id", "=", id]], fields: LINE_READ, order: "x_sequence asc, id asc", limit: 200 });
  const recipients = await call<Array<Record<string, unknown>>>(env, RECIPIENT_MODEL, "search_read", { domain: [["x_quote_id", "=", id]], fields: RECIPIENT_READ, order: "id asc", limit: 30 });
  return {
    id, name: str(q.x_name), partnerId: m2oId(q.x_partner_id as M2O), partnerName: m2oName(q.x_partner_id as M2O), date: str(q.x_date), state: asState(q.x_state),
    wastePct: num(q.x_waste_pct), marginPct: num(q.x_min_margin_pct), deliveryCost: num(q.x_delivery_cost), validUntil: str(q.x_valid_until), note: str(q.x_note),
    prepared: q.x_prepared === true, simulation: q[SIM_FIELD] === true, askedAt: str(q.x_asked_at), saleOrderId: m2oId(q.x_sale_order_id as M2O),
    quotationNumber: str(q.x_quotation_number), pdfUrl: str(q.x_pdf_url), sourceNotes: str(q.x_source_notes),
    header: { orderProfit: num(q.x_order_profit), profitText: str(q.x_profit_text), missingPurchase: num(q.x_missing_purchase), missingFinal: num(q.x_missing_final), total: num(q.x_total), summary: str(q.x_summary) },
    lines: lines.map((l) => ({
      id: Number(l.id), sequence: num(l.x_sequence), productId: m2oId(l.x_product_tmpl_id as M2O), productName: stripRef(m2oName(l.x_product_tmpl_id as M2O)).trim(),
      qty: num(l.x_qty), unit: str(l.x_unit).trim() || DEFAULT_UNIT, purchase: num(l.x_purchase_price), marketText: str(l.x_market_text), marketMedian: num(l.x_market_median),
      noLoss: num(l.x_no_loss_price), suggested: num(l.x_suggested_price), finalPrice: num(l.x_final_price), total: num(l.x_total), profit: num(l.x_profit), obs: parseObs(l.x_obs),
    })),
    recipients: recipients.map((r) => ({
      id: Number(r.id), partnerId: m2oId(r.x_partner_id as M2O), name: m2oName(r.x_partner_id as M2O), role: asRole(r.x_role), askedAt: str(r.x_asked_at), via: str(r.x_via),
      repliedAt: str(r.x_replied_at), priced: num(r.x_priced), remindedAt: str(r.x_reminded_at),
    })),
  };
}

/** «صالح حتى» of a new request: the end of tomorrow in Riyadh (23:59:59), as Odoo keeps it (UTC). */
export function defaultValidUntil(now: number): string {
  return `${riyadhDateKey(new Date(now + 24 * 3600_000))} 20:59:59`;
}

export interface DefaultRecipient { partnerId: number; role: PriceKind }
/**
 * The sources of a new request: every partner «مصدر أسعار» by his «دور الأسعار»
 * (none: a supplier's price is a purchase price, any other source's a market
 * observation), then every marketing member as a market source of this request
 * alone. A read that fails gives what it could read: Baraa adds the rest.
 */
export async function defaultRecipients(env: Env, now: number): Promise<DefaultRecipient[]> {
  const out: DefaultRecipient[] = [];
  try {
    const rows = await call<Array<{ id: number; supplier_rank?: number; x_price_role?: string | false }>>(env, "res.partner", "search_read", {
      domain: [["x_price_source", "=", true], [SIM_FIELD, "!=", true]], fields: ["id", "supplier_rank", "x_price_role"], order: "id asc", limit: 20,
    });
    for (const r of rows) out.push({ partnerId: r.id, role: asRole(r.x_price_role) ?? ((Number(r.supplier_rank) || 0) > 0 ? "purchase" : "market") });
  } catch (e) {
    console.warn("[special-quote] the price sources could not be read — none added", (e as Error)?.message);
  }
  try {
    const { loadRoster, membersByRole } = await import("./team-roster");
    const { MARKETING_ROLE } = await import("./team-prices");
    for (const m of membersByRole(await loadRoster(env, now), MARKETING_ROLE)) {
      if (m.partnerId > 0 && !out.some((x) => x.partnerId === m.partnerId)) out.push({ partnerId: m.partnerId, role: "market" });
    }
  } catch (e) {
    console.warn("[special-quote] the marketing members could not be read — none added", (e as Error)?.message);
  }
  return out;
}

/** What a request that was never prepared still lacks (its defaults). Reads the settings and the day's cost. */
async function preparation(env: Env, q: SpecialQuote, now: number): Promise<{ vals: Record<string, unknown>; wastePct: number; marginPct: number; deliveryCost: number }> {
  const vals: Record<string, unknown> = { x_prepared: true };
  let { wastePct, marginPct, deliveryCost } = q;
  const day = riyadhDateKey(new Date(now));
  if (!q.date) vals.x_date = day;
  if (!q.validUntil) vals.x_valid_until = defaultValidUntil(now);
  if (!(wastePct > 0)) {
    try {
      const { readPricingSettings } = await import("./operating-cost");
      wastePct = (await readPricingSettings(env, day))?.wastePct ?? 0;
    } catch (e) { console.warn("[special-quote] the settings could not be read — the waste stays empty", (e as Error)?.message); }
    if (wastePct > 0) vals.x_waste_pct = wastePct;
  }
  if (!(marginPct > 0)) { marginPct = DEFAULT_MARGIN_PCT; vals.x_min_margin_pct = marginPct; }
  if (!(deliveryCost > 0)) {
    try {
      const { dailyOperatingCost } = await import("./operating-cost");
      deliveryCost = round2(Math.max(0, (await dailyOperatingCost(env, day, now)).total ?? 0));
    } catch (e) { console.warn("[special-quote] the day's cost could not be read — the delivery cost stays empty", (e as Error)?.message); }
    if (deliveryCost > 0) vals.x_delivery_cost = deliveryCost;
  }
  if (!q.recipients.length) {
    const rec = await defaultRecipients(env, now);
    if (rec.length) vals.x_recipient_ids = rec.map((r) => [0, 0, { x_partner_id: r.partnerId, x_role: r.role }]);
  }
  return { vals, wastePct, marginPct, deliveryCost };
}

const differs = (a: number, b: number): boolean => Math.abs(round2(a) - round2(b)) > 0.004;

export interface RecalcResult {
  quote: SpecialQuote;
  numbers: OrderNumbers;
  state: QuoteState;
  /** The lines whose final price took «المقترح» in this pass («اعتمد المقترح للكل»). */
  accepted: number;
  /** The lines that have no «المقترح» to take (no purchase price). */
  noSuggestion: number;
  /** Something was written to Odoo. */
  wrote: boolean;
}

/**
 * The request's numbers, again: one read of it, one write of what changed.
 * `accept` = «اعتمد المقترح للكل» (the lines without a final price take «المقترح»).
 * Null when the request is not there. Throws on Odoo trouble.
 */
export async function recalcQuote(env: Env, id: number, opts: { now?: number; accept?: boolean } = {}): Promise<RecalcResult | null> {
  const now = opts.now ?? Date.now();
  const q = await readQuote(env, id);
  if (!q) return null;
  const vals: Record<string, unknown> = {};
  let { wastePct, marginPct, deliveryCost } = q;
  if (!q.prepared) {
    const p = await preparation(env, q, now);
    Object.assign(vals, p.vals);
    ({ wastePct, marginPct, deliveryCost } = p);
  }
  if (q.name !== quoteName(id)) vals.x_name = quoteName(id);

  const commands: unknown[] = [];
  let accepted = 0, noSuggestion = 0;
  const math = q.lines.map((l) => {
    const market = Object.values(l.obs.market).map((v) => v.p);
    let finalPrice = l.finalPrice;
    let n = lineNumbers({ qty: l.qty, purchase: l.purchase, market, finalPrice }, wastePct, marginPct);
    if (opts.accept && !(finalPrice > 0)) {
      if (n.suggested > 0) { finalPrice = n.suggested; accepted++; n = lineNumbers({ qty: l.qty, purchase: l.purchase, market, finalPrice }, wastePct, marginPct); }
      else noSuggestion++;
    }
    const text = marketText(l.obs, n.marketMedian);
    const lv: Record<string, unknown> = {};
    if (differs(l.marketMedian, n.marketMedian)) lv.x_market_median = n.marketMedian;
    if (l.marketText !== text) lv.x_market_text = text || false;
    if (differs(l.noLoss, n.noLoss)) lv.x_no_loss_price = n.noLoss;
    if (differs(l.suggested, n.suggested)) lv.x_suggested_price = n.suggested;
    if (differs(l.finalPrice, finalPrice)) lv.x_final_price = finalPrice;
    if (differs(l.total, n.total)) lv.x_total = n.total;
    if (differs(l.profit, n.profit)) lv.x_profit = n.profit;
    if (Object.keys(lv).length) commands.push([1, l.id, lv]);
    return { qty: l.qty, purchase: l.purchase, market, finalPrice };
  });
  const numbers = orderNumbers(math, wastePct, marginPct, deliveryCost);

  // the state: «مُسعَّر» once every line has its final price; an issued or a closed request is left as it is
  let state: QuoteState = q.state ?? "draft";
  if (state !== "quoted" && state !== "closed") {
    state = numbers.lines > 0 && numbers.missingFinal === 0 ? "priced" : q.askedAt ? "sent" : "draft";
  }
  if (state !== q.state) vals.x_state = state;
  const pt = profitText(numbers), st = summaryText(numbers);
  if (differs(q.header.orderProfit, numbers.profit)) vals.x_order_profit = numbers.profit;
  if (q.header.profitText !== pt) vals.x_profit_text = pt;
  if (q.header.missingPurchase !== numbers.missingPurchase) vals.x_missing_purchase = numbers.missingPurchase;
  if (q.header.missingFinal !== numbers.missingFinal) vals.x_missing_final = numbers.missingFinal;
  if (differs(q.header.total, numbers.total)) vals.x_total = numbers.total;
  if (q.header.summary !== st) vals.x_summary = st;
  if (commands.length) vals.x_line_ids = commands;

  const wrote = Object.keys(vals).length > 0;
  if (wrote) await call<boolean>(env, QUOTE_MODEL, "write", { ids: [id], vals });
  return { quote: q, numbers, state, accepted, noSuggestion, wrote };
}

/** «آخر نتيجة» on the request: what the last button did, with its Riyadh time. Never throws. */
export async function writeResult(env: Env, id: number, text: string, now: number = Date.now()): Promise<void> {
  const hm = new Date(now + 3 * 3600_000).toISOString().slice(11, 16);
  try {
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [id], vals: { x_last_result: `${text} — ${hm}`.slice(0, 500) } });
  } catch (e) {
    console.warn(`[special-quote] ${id}: the result line could not be written`, (e as Error)?.message);
  }
}

export const HOOK_OPS = ["recalc", "accept", "send", "issue", "pdf"] as const;
export type HookOp = (typeof HOOK_OPS)[number];
export const isHookOp = (v: string): v is HookOp => (HOOK_OPS as readonly string[]).includes(v);
export const acceptResultText = (r: Pick<RecalcResult, "accepted" | "noSuggestion">): string =>
  r.accepted
    ? `اعتُمد المقترح لـ ${r.accepted} سطر${r.noSuggestion ? `، و${r.noSuggestion} بلا مقترح (لا سعر شراء)` : ""}`
    : r.noSuggestion ? `لا شيء يُعتمد: ${r.noSuggestion} سطر بلا مقترح (لا سعر شراء)، والباقي له سعر نهائي` : "لا شيء يُعتمد: كل سطر له سعر نهائي";

export interface HookOutcome { op: HookOp; id: number; action: string; detail?: string }

/**
 * A button of the request's screen (or its save): Odoo → the worker. A request
 * flagged «محاكاة» is recalculated and nothing more: it sends nothing and
 * issues nothing.
 */
export async function handleSpecialQuoteHook(env: Env, id: number, op: HookOp, ctx?: ExecutionContext, now: number = Date.now()): Promise<HookOutcome> {
  if (op === "recalc" || op === "accept") {
    const r = await recalcQuote(env, id, { now, accept: op === "accept" });
    if (!r) return { op, id, action: "not_found" };
    if (op === "accept") await writeResult(env, id, acceptResultText(r), now);
    return { op, id, action: r.wrote ? "written" : "unchanged", detail: `${r.state} lines=${r.numbers.lines}${op === "accept" ? ` accepted=${r.accepted}` : ""}` };
  }
  if (op === "send") {
    const { sendSpecialAsk } = await import("./special-ask");
    const r = await sendSpecialAsk(env, id, { now, ctx });
    return { op, id, action: r.action, detail: r.detail };
  }
  const { issueSpecialQuotation } = await import("./special-quotation");
  const r = await issueSpecialQuotation(env, id, { now, ctx, ownerOnly: op === "pdf" });
  return { op, id, action: r.action, detail: r.detail };
}
