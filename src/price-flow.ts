// § 51 (2026-10-04) — the price ask as a WhatsApp Flow: one numeric field per
// item «نشط للبيع», instead of a free text read by the extractor.
//
// The Flow (utak_price_ask_v1, published at Meta) is ONE screen with fifteen
// optional number fields; everything a day changes is data sent with the
// message (flow_action navigate, no endpoint — scripts/lib/s51-price-flow.mjs
// is its JSON): the heading («أسعار الشراء اليوم» / «أسعار السوق اليوم»), the
// line above the fields, and for each slot its label, its hint («آخر سعر: X»),
// whether it is shown and its initial value.
//
//   • The ask: inside the number's 24h window an interactive `flow` message;
//     outside it the UTILITY template utak_price_ask_flow_v1 (a FLOW button).
//     Neither usable (the template pending, refused or filed MARKETING, and
//     the window closed) → the caller sends what it sent before § 51, in the
//     same run: the 02:00 template utak_supplier_ask_v2, Omar's 02:30 text,
//     the 05:00 reminder. A Flow that Meta refuses never blocks them (it has
//     its own purpose).
//   • flow_token: one per send, kept in KV with the day, the source, and the
//     item of every slot. A reply is read from it — never from the client's
//     data — by the number it was sent to, on its own day, before that day's
//     publication, once.
//   • The reply (nfm_reply): each number goes to its slot's product and
//     packaging with no extractor. It is written as the text reply is: a
//     supplier's purchase price → x_daily_price (x_extraction_status «flow»,
//     «pending» for an outlier, as § 26), any other source → x_price_offer
//     (purchase or market by its role). An empty field = not available today:
//     nothing is written for it.
//   • «وصلت ✅ رمان كبير 22، موز أمريكي 22.» answers it, under a «تعديل» button
//     that opens the same form with what was sent. The newest row of a source
//     is the one the engine reads (src/pricing-engine.ts latestPerSource).
//   • The free-text reply stays as it was.
//
// § 53 أ — the hint is the source's OWN number or nothing: «آخر سعر» reads only
// the rows he sent himself (a row with his message's id — never one typed in
// Odoo under his name), and an OUTSIDE source (رائد: neither a supplier nor an
// employee) gets no «آخر سعر» at all — his fields say «السعر بالريال».
//
// § 52 (2026-10-04) — utak_price_ask_v2: PAGES BY CATEGORY. Four generic pages
// of fifteen fields (scripts/lib/s52-price-flow.mjs), still with no endpoint:
// all the data goes with the message to the first page and the others read it
// from there. The worker fills the pages, in order, with the categories that
// have an item today — فواكه (#5), خضار (#6), ورقيات (#7), then «أخرى» for an
// item of none of them — so «التالي» never opens an empty page and «إرسال» sits
// on the last page that has items. A category of more than fifteen: the first
// fifteen, and Baraa's one alert a day. v1 stays at Meta, unused.
//   • The line above the fields follows the source's role: «الأسعار بدون ضريبة.»
//     for a purchase price, «اكتب السعر زي ما ينباع في السوق (شامل الضريبة).» for
//     a market observation (the engine compares it, as it is, with the
//     VAT-inclusive suggested price).
//   • Outside the window: the template utak_price_ask_flow_v2 for every source,
//     only while Meta holds it APPROVED and UTILITY.
//   • A source that was asked by the old text template (his window was closed)
//     and then writes or taps anything before his prices arrive that day gets
//     the form at once — his window has just opened — once a day.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call, createDailyPrice, getLastSupplierPrice, getSupplierPendingLog, updateSupplierLog, writePartner } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession, type GwTemplate } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { isSkippedDuplicate } from "./auto-send-guard";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { readActiveItems } from "./pricing-engine";
import type { PriceKind, PriceRole } from "./price-sources";

/** utak_price_ask_v2 at Meta (PUBLISHED 2026-10-04, § 52; a published Flow's JSON is frozen). */
export const PRICE_FLOW_ID = "1123704886881420";
/** utak_price_ask_v1 (§ 51): still at Meta, no longer sent. */
export const PRICE_FLOW_V1_ID = "1086052444016554";
/** The first page: the only screen a message (or a template's FLOW button) opens. */
export const PRICE_FLOW_SCREEN = "PAGE_A";
export const PRICE_FLOW_PAGES = 4;
/** The fields of one page — of one category. */
export const PRICE_FLOW_PAGE_SLOTS = 15;
export const PRICE_FLOW_SLOTS = PRICE_FLOW_PAGES * PRICE_FLOW_PAGE_SLOTS;
export const PRICE_FLOW_TEMPLATE = "utak_price_ask_flow_v2";
/** § 52 هـ — the pages in this order (product.category ids; a child category counts as its root), then «أخرى». */
export const FLOW_CATEGORIES: ReadonlyArray<{ id: number; title: string }> = [{ id: 5, title: "فواكه" }, { id: 6, title: "خضار" }, { id: 7, title: "ورقيات" }];
export const FLOW_OTHER_TITLE = "أخرى";
/** The one page of a form whose token carries no pages (a v1 token, § 51). */
export const FLOW_PLAIN_TITLE = "الأصناف";
/** The gateway purpose of a Flow ask, and its template's x_purpose. */
export const PRICE_FLOW_PURPOSE = "price_ask_flow";
/** The one trial to Baraa and its answers (allowed to the owner's number). */
export const PRICE_FLOW_TEST_PURPOSE = "price_flow_test";
export const PRICE_FLOW_CTA = "أدخل الأسعار";
export const PRICE_FLOW_EDIT_CTA = "تعديل";
/** § 52 ج — the VAT line of a role: a purchase price is net of VAT, a market observation is the price it sells at (VAT inside). */
export const VAT_LINE: Readonly<Record<PriceKind, string>> = {
  purchase: "الأسعار بدون ضريبة.",
  market: "اكتب السعر زي ما ينباع في السوق (شامل الضريبة).",
};
export const PRICE_FLOW_EMPTY_NOTE = "اترك الخانة فاضية لو الصنف غير متوفر.";
/** The line above the fields, by the source's role. */
export const flowNote = (kind: PriceKind): string => `${VAT_LINE[kind]} ${PRICE_FLOW_EMPTY_NOTE}`;
/** Meta's limits of a TextInput: its label and its helper text. */
export const LABEL_MAX = 20;
export const HINT_MAX = 80;
export const NO_LAST_PRICE = "لا سعر سابق";
/** § 53 أ — the hint of an outside source's field: no price at all, his own or anyone's. */
export const NO_PRICE_HINT = "السعر بالريال";
export const TEST_MARK = "🧪 تجربة";
const TOKEN_TTL = 36 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";

// ---------------------------------------------------------------- texts

const firstName = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
export const kindNoun = (kind: PriceKind): string => (kind === "purchase" ? "أسعار الشراء" : "أسعار السوق");
/** The line under a page's heading: «أسعار الشراء اليوم» / «أسعار السوق اليوم». */
export const flowTitle = (kind: PriceKind): string => `${kindNoun(kind)} اليوم`;
/** A page's heading: its category; the trial's starts with «🧪 تجربة». */
export const pageTitle = (category: string, test = false): string => `${test ? `${TEST_MARK} — ` : ""}${category}`;
/** {{1}} of utak_price_ask_flow_v2 («طلب تحديث الأسعار ليوم {{1}} حسب الاتفاق مع يو تاك. …»): the day. */
export const flowAskParams = (day: string): string[] => [arabicDate(day)];
/** What the button asks for, by the role (§ 52 ج). */
const FILL_LINE: Readonly<Record<PriceKind, string>> = {
  purchase: "اضغط «أدخل الأسعار» وعبّ سعر كل صنف (بدون ضريبة).",
  market: "اضغط «أدخل الأسعار» واكتب السعر زي ما ينباع في السوق (شامل الضريبة).",
};
/** The ask inside the window (free text: no template is used there). */
export function flowAskText(name: string, kind: PriceKind, day: string): string {
  return `صباح الخير ${firstName(name)} 🌿 طلب ${kindNoun(kind)} من يو تاك ليوم ${arabicDate(day)}. ${FILL_LINE[kind]}`;
}
/** The 05:00 reminder inside the window, with the same button. */
export const flowNudgeText = (needBy: string, kind: PriceKind = "purchase"): string =>
  `تذكير من يو تاك: ما وصلتنا ${kind === "market" ? "أسعار السوق" : "أسعارك"} اليوم للحين، نحتاجها قبل الساعة ${needBy} لو سمحت. ${FILL_LINE[kind]}`;
export const FLOW_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿 انتظر طلب الأسعار القادم.";
export const flowExpiredText = (why: "day" | "published"): string =>
  why === "published" ? "أسعار اليوم نُشرت، وهذا النموذج ما عاد يستقبل: لم يُحفظ شيء 🌿" : "هذا نموذج يوم سابق وانتهى وقته: لم يُحفظ شيء 🌿 انتظر طلب أسعار اليوم.";
export const FLOW_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. للتعديل اضغط «تعديل».";

function money(x: number): string {
  const n = Math.round(Number(x) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();

/**
 * A slot's label and hint. The label is «الصنف — التعبئة» when Meta's twenty
 * characters hold it; a longer one keeps the product alone, and its packaging
 * opens the hint. The hint is never empty («لا سعر سابق»).
 */
export function slotTexts(product: string, packaging: string, last: number | null, noPrice = false): { label: string; hint: string } {
  const p = clean(product), k = clean(packaging);
  const full = k ? `${p} — ${k}` : p;
  // § 53 أ — `noPrice`: the hint of an outside source carries no number, whatever `last` is
  const lastText = noPrice ? NO_PRICE_HINT : last !== null && last > 0 ? `آخر سعر: ${money(last)}` : NO_LAST_PRICE;
  if (chars(full).length <= LABEL_MAX) return { label: full, hint: lastText };
  return { label: cut(p, LABEL_MAX), hint: cut([k, lastText].filter(Boolean).join(" · "), HINT_MAX) };
}

// ---------------------------------------------------------------- the form's data

export interface FlowItem {
  slot: number;
  productId: number;
  packagingId: number;
  /** As the answer names it («رمان كبير»; with its packaging when the product sits in two slots). */
  name: string;
  label: string;
  hint: string;
}

/**
 * The 249 keys of the first page (every page reads them from it): the line
 * under the heading, the line above the fields, each page's heading (t<k>) and
 * whether a page follows it (m<k>: «التالي», else «إرسال»), and l/h/v/i of every
 * slot. `pages` = the headings of the pages that have items, in order.
 */
export function flowData(sub: string, note: string, pages: string[], items: FlowItem[], init: Record<number, number> = {}): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = { sub, note };
  for (let k = 1; k <= PRICE_FLOW_PAGES; k++) {
    data[`t${k}`] = pages[k - 1] ?? "-";
    if (k < PRICE_FLOW_PAGES) data[`m${k}`] = k < pages.length;
  }
  for (let n = 1; n <= PRICE_FLOW_SLOTS; n++) {
    const it = items.find((x) => x.slot === n);
    data[`l${n}`] = it ? it.label : "-";
    data[`h${n}`] = it ? it.hint : "-";
    data[`v${n}`] = !!it;
    data[`i${n}`] = it && init[n] > 0 ? money(init[n]) : "";
  }
  return data;
}

export interface FlowSource {
  partnerId: number;
  employeeId?: number | null;
  name: string;
  whatsapp: string;
  /** A supplier (the 02:00 ask): his purchase price is an x_daily_price row. */
  supplier: boolean;
  /** «دور الأسعار» on his card; none = a supplier's numbers are purchase prices, any other source's market observations. */
  role: PriceRole | null;
}
export const sourceKind = (s: { supplier: boolean; role: PriceRole | null }): PriceKind => s.role ?? (s.supplier ? "purchase" : "market");
/** § 53 أ — an outside price source: a partner that is neither a supplier nor an employee (رائد). It is shown no price at all. */
export const isOutsideSource = (s: { supplier: boolean; employeeId?: number | null }): boolean => !s.supplier && !s.employeeId;

/**
 * The source's last value of each item, newest first (one read): «آخر سعر».
 * § 53 أ — his own rows alone (the partner filter) and only those he sent
 * himself (x_source_message_id: a reply or a form of his, never a row typed in
 * Odoo). Simulation left out; a failed read gives none.
 */
export async function lastPrices(env: Env, src: { partnerId: number; supplier: boolean }, kind: PriceKind, productIds: number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!src.partnerId || !productIds.length) return out;
  const daily = src.supplier && kind === "purchase";
  const model = daily ? "x_daily_price" : "x_price_offer";
  const who = daily ? "x_supplier_id" : "x_source_partner_id";
  const f = daily ? "x_price_sar" : kind === "purchase" ? "x_purchase_price" : "x_market_price";
  try {
    const rows = await call<Array<Record<string, unknown>>>(env, model, "search_read", {
      // § 62 ب — «آخر سعر» is never a «خاص» row (a special request's observation: a kilo's price, not the packaging's)
      domain: [[who, "=", src.partnerId], ["x_product_tmpl_id", "in", productIds], [f, ">", 0], ["x_source_message_id", "!=", false], [SIM_FIELD, "!=", true], ...(daily ? [] : [["x_special", "!=", true]])],
      fields: ["x_product_tmpl_id", "x_packaging_id", f], order: "x_date desc, id desc", limit: 400,
    });
    for (const r of rows) {
      const p = Array.isArray(r.x_product_tmpl_id) ? Number(r.x_product_tmpl_id[0]) : Number(r.x_product_tmpl_id);
      const k = Array.isArray(r.x_packaging_id) ? Number(r.x_packaging_id[0]) : Number(r.x_packaging_id);
      const key = `${p}:${k}`;
      if (!out.has(key) && Number(r[f]) > 0) out.set(key, Number(r[f]));
    }
  } catch (e) {
    console.warn("[price-flow] the last prices could not be read — no hint", (e as Error)?.message);
  }
  return out;
}

const m2oId = (v: unknown): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);

/**
 * § 52 هـ — each product's page: the id of its category among FLOW_CATEGORIES
 * (its own, or the root it sits under), 0 = «أخرى»; and each page's heading as
 * Odoo names the category. Two reads. A failed read throws: the caller sends
 * the ask of before rather than a form with every item under «أخرى».
 */
export async function productPages(env: Env, productIds: number[]): Promise<{ of: Map<number, number>; titles: Map<number, string> }> {
  const titles = new Map<number, string>(FLOW_CATEGORIES.map((c) => [c.id, c.title]));
  const of = new Map<number, number>();
  if (!productIds.length) return { of, titles };
  const prods = await call<Array<{ id: number; categ_id: unknown }>>(env, "product.template", "search_read", {
    domain: [["id", "in", productIds]], fields: ["id", "categ_id"], limit: 500,
  });
  const cats = new Map((await call<Array<{ id: number; name: string; parent_id: unknown }>>(env, "product.category", "search_read", {
    domain: [], fields: ["id", "name", "parent_id"], limit: 500,
  })).map((c) => [c.id, c]));
  for (const c of FLOW_CATEGORIES) { const name = clean(String(cats.get(c.id)?.name ?? "")); if (name) titles.set(c.id, name); }
  for (const p of prods) {
    let page = 0;
    for (let c = cats.get(m2oId(p.categ_id)), hops = 0; c && hops < 20; c = cats.get(m2oId(c.parent_id)), hops++) {
      if (titles.has(c.id)) { page = c.id; break; }
    }
    of.set(p.id, page);
  }
  return { of, titles };
}

export interface FlowItems {
  items: FlowItem[];
  /** The headings of the pages that have items, in order (فواكه، خضار، ورقيات، أخرى — the empty ones left out). */
  pages: string[];
  /** Every item «نشط للبيع». */
  total: number;
  /** The categories of more than fifteen items, and the names left without a field. */
  over: Array<{ title: string; total: number }>;
  left: string[];
}

/**
 * The items of the form: every product «نشط للبيع» with its default packaging,
 * in the engine's order (src/pricing-engine.ts readActiveItems), grouped by
 * category into the pages — the first fifteen of each. A category with no item
 * takes no page, so slot numbers follow the pages that exist (1–15, 16–30, …).
 */
export async function flowItems(env: Env, hints: { partnerId: number; supplier: boolean; employeeId?: number | null }, kind: PriceKind): Promise<FlowItems> {
  const all = await readActiveItems(env, []);
  const { of, titles } = await productPages(env, [...new Set(all.map((i) => i.productId))]);
  const groups = [...FLOW_CATEGORIES.map((c) => ({ title: titles.get(c.id) ?? c.title, items: all.filter((i) => (of.get(i.productId) ?? 0) === c.id) })),
    { title: FLOW_OTHER_TITLE, items: all.filter((i) => !(of.get(i.productId) ?? 0)) }].filter((g) => g.items.length);
  const shown = groups.flatMap((g, k) => g.items.slice(0, PRICE_FLOW_PAGE_SLOTS).map((it, j) => ({ it, slot: k * PRICE_FLOW_PAGE_SLOTS + j + 1 })));
  // § 53 أ — an outside source (neither a supplier nor an employee): no last price is read or shown
  const outside = isOutsideSource(hints);
  const last = outside ? new Map<string, number>() : await lastPrices(env, hints, kind, shown.map((x) => x.it.productId));
  const twice = new Set(shown.map((x) => x.it.productId).filter((id, i, a) => a.indexOf(id) !== i));
  const items = shown.map(({ it, slot }) => {
    const t = slotTexts(it.productName, it.packagingName, last.get(`${it.productId}:${it.packagingId}`) ?? null, outside);
    const name = twice.has(it.productId) ? `${clean(it.productName)} (${clean(it.packagingName)})` : clean(it.productName);
    return { slot, productId: it.productId, packagingId: it.packagingId, name, label: t.label, hint: t.hint };
  });
  return {
    items, pages: groups.map((g) => g.title), total: all.length,
    over: groups.filter((g) => g.items.length > PRICE_FLOW_PAGE_SLOTS).map((g) => ({ title: g.title, total: g.items.length })),
    left: groups.flatMap((g) => g.items.slice(PRICE_FLOW_PAGE_SLOTS).map((i) => clean(i.productName))),
  };
}

// ---------------------------------------------------------------- flow_token

export interface FlowRecord {
  /** 1 = a token of utak_price_ask_v1 (§ 51, one page, no `pages`); 2 = of v2. */
  v: 1 | 2;
  token: string;
  /** The Riyadh day the prices are for. */
  day: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  employeeId: number | null;
  name: string;
  supplier: boolean;
  kind: PriceKind;
  items: FlowItem[];
  /** § 52 — the headings of the form's pages, in order («تعديل» opens the same pages). */
  pages?: string[];
  createdAt: number;
  /** The trial to Baraa: its reply writes nothing in Odoo. */
  test?: boolean;
  /** «تعديل»: the token it corrects, and what the form opened with. */
  parent?: string;
  init?: Record<number, number>;
  /** A reply was taken (a token is read once), and what it carried. */
  usedAt?: number;
  values?: Record<number, number>;
}
export const flowTokenKey = (token: string): string => `pflow:v1:${token}`;
export function newFlowToken(day: string, partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pf1.${day.replace(/-/g, "")}.${partnerId}.${rand}`;
}
export async function readFlowToken(env: Env, token: string): Promise<FlowRecord | null> {
  if (!token) return null;
  try {
    const raw = await env.MSG_DEDUP.get(flowTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as FlowRecord) : null;
    return rec && (rec.v === 1 || rec.v === 2) && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}
async function writeFlowToken(env: Env, rec: FlowRecord): Promise<void> {
  await env.MSG_DEDUP.put(flowTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the ask

export interface FlowAskOpts {
  now?: number;
  /** The text above the button (the ask's own by default). */
  body?: string;
  cta?: string;
  test?: boolean;
  /** «تعديل»: the same items on the same pages, opened with what was sent. */
  items?: FlowItem[];
  pages?: string[];
  init?: Record<number, number>;
  parent?: string;
  /** The source whose last prices fill the hints, when it is not the recipient (the trial to Baraa — never another recipient: prepareFlowAsk). */
  hintsFrom?: { partnerId: number; supplier: boolean; employeeId?: number | null };
}
export interface PreparedFlow {
  record: FlowRecord;
  data: Record<string, string | boolean>;
  session: GwSession;
  template: GwTemplate;
  total: number;
}

/** The interactive `flow` message: `text` above the button, the form's data with it. */
export function flowSession(text: string, token: string, data: Record<string, string | boolean>, cta: string = PRICE_FLOW_CTA): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: PRICE_FLOW_ID,
            flow_cta: cta,
            flow_action: "navigate",
            flow_action_payload: { screen: PRICE_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/**
 * Everything one ask needs: the items on their pages, the token (kept in KV)
 * and the two shapes of the message. Null when no item is active for sale. A
 * category of more than fifteen: its first fifteen, and Baraa is told once a day.
 */
export async function prepareFlowAsk(env: Env, src: FlowSource, opts: FlowAskOpts = {}): Promise<PreparedFlow | null> {
  const now = opts.now ?? Date.now();
  const day = riyadhDateKey(new Date(now));
  const kind = sourceKind(src);
  let items = opts.items ?? null;
  // a token with no pages (v1, § 51): its items sit on one page
  let pages = opts.pages?.length ? opts.pages : [FLOW_PLAIN_TITLE];
  let total = items?.length ?? 0;
  if (!items) {
    // § 53 أ — another source's last prices fill the hints of the trial to Baraa alone
    const built = await flowItems(env, opts.test && opts.hintsFrom ? opts.hintsFrom : src, kind);
    items = built.items; pages = built.pages; total = built.total;
    if (built.left.length) await alertOverflow(env, day, built.over, built.left);
  }
  if (!items.length) return null;
  const record: FlowRecord = {
    v: 2, token: newFlowToken(day, src.partnerId), day, to: waDigits(src.whatsapp), partnerId: src.partnerId, employeeId: src.employeeId ?? null,
    name: src.name, supplier: src.supplier, kind, items, pages, createdAt: now,
    ...(opts.test ? { test: true } : {}), ...(opts.parent ? { parent: opts.parent } : {}), ...(opts.init ? { init: opts.init } : {}),
  };
  await writeFlowToken(env, record);
  const data = flowData(flowTitle(kind), flowNote(kind), pages.map((t) => pageTitle(t, !!opts.test)), items, opts.init ?? {});
  const text = opts.body ?? `${opts.test ? `${TEST_MARK} — ` : ""}${flowAskText(src.name, kind, day)}`;
  return {
    record, data, total,
    session: flowSession(text, record.token, data, opts.cta ?? PRICE_FLOW_CTA),
    template: { kind: "template", purpose: PRICE_FLOW_PURPOSE, params: flowAskParams(day), flow: { token: record.token, data } },
  };
}

/** A category of more items than a page's fields: Baraa's one alert a day, with the ones left out. */
async function alertOverflow(env: Env, day: string, over: Array<{ title: string; total: number }>, left: string[]): Promise<void> {
  const claim = await claimButton(env, `pflow_over:${day}`, 26 * 60 * 60);
  if (!claim.claimed) return;
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, `⚠️ صفحة الفئة في نموذج الأسعار تتسع لـ ${PRICE_FLOW_PAGE_SLOTS} خانة، و${over.map((o) => `«${o.title}» فيها ${o.total} صنفاً نشطاً للبيع`).join("، و")}: دخل أول ${PRICE_FLOW_PAGE_SLOTS}، وبقي بلا خانة: ${left.join("، ")}. أطفئ «نشط للبيع» عمّا لا يُباع اليوم، أو اطلب سعره نصاً.`);
  } catch (e) {
    console.warn("[price-flow] the overflow alert failed", (e as Error)?.message);
  }
  await finishButton(env, claim, 26 * 60 * 60);
}

/**
 * Where the Flow's template stands in Odoo (x_whatsapp_template, as the sync
 * left it): «ready» = APPROVED and UTILITY — the only state it is sent in;
 * «pending» = Meta has not decided; «unusable» = refused, paused or filed
 * MARKETING (never used, never re-submitted); «missing» = no row.
 */
export type FlowTemplateState = "ready" | "pending" | "unusable" | "missing";
export async function flowTemplateState(env: Env): Promise<FlowTemplateState> {
  try {
    const rows = await call<Array<{ id: number; x_meta_status?: string | false; x_category?: string | false }>>(env, "x_whatsapp_template", "search_read", {
      domain: [["x_purpose", "=", PRICE_FLOW_PURPOSE]], fields: ["id", "x_meta_status", "x_category"], order: "id desc", limit: 5,
    });
    if (!rows.length) return "missing";
    const utility = rows.filter((r) => String(r.x_category || "").toUpperCase() === "UTILITY");
    if (utility.some((r) => String(r.x_meta_status || "").toUpperCase() === "APPROVED")) return "ready";
    return utility.some((r) => String(r.x_meta_status || "").toUpperCase() === "PENDING") ? "pending" : "unusable";
  } catch (e) {
    console.warn("[price-flow] the template's status could not be read — not used", (e as Error)?.message);
    return "unusable";
  }
}
export async function flowTemplateReady(env: Env): Promise<boolean> {
  return (await flowTemplateState(env)) === "ready";
}

/**
 * Before the 02:00 ask: the Flow template's status and category are read again
 * from Meta — this template alone, one GET (the daily sync runs at 05:00,
 * after the ask):
 *   • while Odoo holds it PENDING: an approval that arrived in the evening is
 *     used the same night;
 *   • § 52 د — while Odoo holds it usable: Meta files a template MARKETING
 *     after approving it (§ 34, § 51), and a MARKETING template is dropped —
 *     the row is corrected before the template is used, and the ask of before
 *     goes instead.
 * A refused or MARKETING row is left alone (never used, never read again
 * here). Never throws; a read that fails leaves the row as it is.
 */
export async function refreshFlowTemplate(env: Env): Promise<FlowTemplateState | "synced" | "failed"> {
  const state = await flowTemplateState(env);
  if (state !== "pending" && state !== "ready") return state;
  try {
    const { syncOneTemplate } = await import("./wa-template-sync");
    await syncOneTemplate(env, PRICE_FLOW_TEMPLATE);
    const { clearTemplateCache } = await import("./wa-gateway");
    clearTemplateCache();
    return "synced";
  } catch (e) {
    console.warn("[price-flow] the template sync before the ask failed", (e as Error)?.message);
    return "failed";
  }
}

export interface FlowAskResult {
  /** How it went out; null = it did not (the caller sends what it sent before § 51). */
  via: "session" | "template" | null;
  /** The automated-send guard refused it: this job already asked this number today. */
  duplicate: boolean;
  token?: string;
  reason?: string;
}

/**
 * One ask by Flow: the interactive message inside the window, else the
 * template. Nothing is held and nothing is sent when neither can go.
 */
export async function sendFlowAsk(env: Env, src: FlowSource, opts: FlowAskOpts = {}): Promise<FlowAskResult> {
  const to = waDigits(src.whatsapp);
  if (!to) return { via: null, duplicate: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  // neither the window nor the template: no request at all (no «skipped» line in his conversation)
  if (!(await readWindow(env, to, now)).open && (opts.test || !(await flowTemplateReady(env)))) return { via: null, duplicate: false, reason: "not_usable" };
  const p = await prepareFlowAsk(env, src, opts);
  if (!p) return { via: null, duplicate: false, reason: "no_items" };
  const res = await sendViaGateway(env, {
    purpose: opts.test ? PRICE_FLOW_TEST_PURPOSE : PRICE_FLOW_PURPOSE,
    to,
    content: p.session,
    fallback: opts.test ? [] : [p.template],
    noHold: true,
    noHoldReason: "يُرسل طلب الأسعار بصيغته السابقة",
  });
  if (await isSkippedDuplicate(res)) return { via: null, duplicate: true, reason: "duplicate" };
  const d = gatewayDecision(res);
  const via = d?.action === "session" ? "session" : d?.action === "template" ? "template" : null;
  if (!via) {
    try { await env.MSG_DEDUP.delete(flowTokenKey(p.record.token)); } catch { /* expires on its own */ }
    return { via, duplicate: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : "code" in d ? `: ${d.code}` : ""}` : "no_decision" };
  }
  return { via, duplicate: false, token: p.record.token };
}

// ---------------------------------------------------------------- the form owed after the old template (§ 52 و)

const DAY_TTL = 26 * 60 * 60;
const owedKey = (digits: string): string => `pflow_owed:v1:${waDigits(digits)}`;
const arrivedKey = (day: string, digits: string): string => `pflow_in:v1:${day}:${waDigits(digits)}`;

/**
 * This source was asked today by the old text template (his window was closed
 * and the Flow's template is not usable): the form is owed to him. His next
 * message opens his window, and sendOwedFlow sends it then.
 */
export async function markFlowOwed(env: Env, src: FlowSource, now: number = Date.now()): Promise<void> {
  const to = waDigits(src.whatsapp);
  if (!to) return;
  try {
    await env.MSG_DEDUP.put(owedKey(to), JSON.stringify({ day: riyadhDateKey(new Date(now)), src: { ...src, whatsapp: to } }), { expirationTtl: DAY_TTL });
  } catch { /* he answers the template in text, as before § 52 */ }
}
export async function clearFlowOwed(env: Env, digits: string): Promise<void> {
  try { await env.MSG_DEDUP.delete(owedKey(digits)); } catch { /* expires on its own */ }
}
/** This number's prices of the day arrived (a text reply read, or a form): nothing more is owed or queued for it today. */
export async function markPricesArrived(env: Env, digits: string, day: string): Promise<void> {
  if (!waDigits(digits)) return;
  try { await env.MSG_DEDUP.put(arrivedKey(day, digits), "1", { expirationTtl: DAY_TTL }); } catch { /* the reminder reads Odoo as well */ }
  await clearFlowOwed(env, digits);
}
export async function pricesArrived(env: Env, digits: string, day: string): Promise<boolean> {
  try { return !!(await env.MSG_DEDUP.get(arrivedKey(day, digits))); } catch { return false; }
}

/**
 * After a source's message (any message or button) was handled: the form owed
 * to him goes now — today's, before his prices arrived and before the day's
 * publication, ONCE a day for the number. True when it went.
 */
export async function sendOwedFlow(env: Env, from: string, now: number = Date.now()): Promise<boolean> {
  const to = waDigits(from);
  if (!to) return false;
  let owed: { day: string; src: FlowSource } | null = null;
  try {
    const raw = await env.MSG_DEDUP.get(owedKey(to));
    owed = raw ? JSON.parse(raw) : null;
  } catch { return false; }
  if (!owed?.src) return false;
  const day = riyadhDateKey(new Date(now));
  if (owed.day !== day) { await clearFlowOwed(env, to); return false; }
  if (await pricesArrived(env, to, day)) { await clearFlowOwed(env, to); return false; }
  if (await dayPublished(env, day).catch(() => false)) { await clearFlowOwed(env, to); return false; }
  const claim = await claimButton(env, `pflow_owed_sent:${day}:${to}`, DAY_TTL);
  if (!claim.claimed) return false;
  try {
    const r = await sendFlowAsk(env, { ...owed.src, whatsapp: to }, { now });
    if (!r.via) { await releaseButton(env, claim); return false; }
    await finishButton(env, claim, DAY_TTL);
    await clearFlowOwed(env, to);
    console.log(`[price-flow] the form owed after the old template went to …${to.slice(-4)} (${r.via})`);
    return true;
  } catch (e) {
    await releaseButton(env, claim);
    console.warn("[price-flow] the owed form failed", (e as Error)?.message);
    return false;
  }
}

// ---------------------------------------------------------------- the reply

/** What a field holds: a price, nothing (not available today), or something that is not a price above zero. */
export function parseFlowNumber(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  let s = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");
  if (s === "") return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return "invalid";
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 ? n : "invalid";
}

export interface FlowEntries {
  priced: Array<{ item: FlowItem; price: number }>;
  empty: FlowItem[];
  invalid: FlowItem[];
}
/** Each slot's field against its item — the token's items, never the client's data. */
export function readFlowValues(rec: Pick<FlowRecord, "items">, values: Record<string, unknown>): FlowEntries {
  const out: FlowEntries = { priced: [], empty: [], invalid: [] };
  for (const item of rec.items) {
    const v = parseFlowNumber(values[`p${item.slot}`]);
    if (v === null) out.empty.push(item);
    else if (v === "invalid") out.invalid.push(item);
    else out.priced.push({ item, price: v });
  }
  return out;
}

export interface FlowAck {
  saved: Array<{ item: FlowItem; price: number }>;
  invalid?: FlowItem[];
  unsaved?: FlowItem[];
  /** «تعديل» emptied a field that carried a price: the price sent before stays. */
  kept?: Array<{ item: FlowItem; price: number }>;
  test?: boolean;
}
/** «وصلت ✅ رمان كبير 22، موز أمريكي 22.» and what was not saved, named. */
export function flowAckText(a: FlowAck): string {
  const lines: string[] = [];
  const head = a.test ? `${TEST_MARK} — ` : "";
  if (a.saved.length) lines.push(`${head}وصلت ✅ ${a.saved.map((s) => `${s.item.name} ${money(s.price)}`).join("، ")}.`);
  else lines.push(`${head}وصلت ✅ بدون أسعار: ما سُجّل سعر من هذا النموذج.`);
  if (a.invalid?.length) lines.push(`⚠️ ما انحفظ (السعر رقم أكبر من صفر): ${a.invalid.map((i) => i.name).join("، ")}.`);
  if (a.unsaved?.length) lines.push(`⚠️ ما انحفظ: ${a.unsaved.map((i) => i.name).join("، ")}. اضغط «تعديل» وأرسله مرة ثانية لو سمحت 🙏`);
  if (a.kept?.length) lines.push(`⚠️ بقي السعر السابق: ${a.kept.map((k) => `${k.item.name} ${money(k.price)}`).join("، ")} (الخانة الفاضية لا تلغي سعراً أُرسل).`);
  if (a.test) lines.push("(تجربة: لم يُكتب شيء في Odoo)");
  return lines.join("\n");
}

/** The day's prices are published: its Flow takes no more replies. */
export async function dayPublished(env: Env, day: string): Promise<boolean> {
  const [r] = await call<Array<{ id: number; x_state: string | false; x_published_at: string | false }>>(env, "x_price_day", "search_read", {
    domain: [["x_date", "=", day], [SIM_FIELD, "!=", true]], fields: ["id", "x_state", "x_published_at"], order: "id asc", limit: 1,
  });
  return !!r && (r.x_state === "published" || !!r.x_published_at);
}

const nowOdoo = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/**
 * The prices of a reply, written as the text reply writes them. Returns what
 * Odoo took and what it refused (named in the answer, to be sent again).
 */
export async function saveFlowPrices(env: Env, rec: FlowRecord, priced: FlowEntries["priced"], messageId: string, now: number): Promise<{ saved: FlowEntries["priced"]; unsaved: FlowItem[] }> {
  const saved: FlowEntries["priced"] = [];
  const unsaved: FlowItem[] = [];
  const { readOutlierRatio } = await import("./operating-cost");
  const ratio = priced.length ? await readOutlierRatio(env, rec.day) : undefined;
  const asDaily = rec.supplier && rec.kind === "purchase";
  // § 48 ب — the row's fallback sale price = «السعر المربح المقترح» of its purchase price (0 when it cannot be made)
  const { dayFloorInputs, fallbackSale } = await import("./pricing-board");
  const floorInputs = asDaily && priced.length ? await dayFloorInputs(env, rec.day).catch((e) => {
    console.warn("[price-flow] the day's floor inputs could not be read — no fallback sale price", (e as Error)?.message);
    return null;
  }) : null;
  const { isPriceOutlier } = await import("./suppliers");
  const { saveOffer } = await import("./price-sources");
  for (const e of priced) {
    const raw = `نموذج واتساب: ${e.item.label} = ${money(e.price)}`;
    try {
      if (asDaily) {
        // § 26 — an outlier is saved and used, marked for review («pending»), and Baraa hears of it at once
        const last = await getLastSupplierPrice(env, rec.partnerId, e.item.productId, e.item.packagingId).catch(() => null);
        const outlier = !!last && isPriceOutlier(last.price, e.price, ratio);
        await createDailyPrice(env, {
          supplier_id: rec.partnerId, product_id: e.item.productId, packaging_id: e.item.packagingId,
          cost_price: e.price, sale_price: fallbackSale(e.price, floorInputs), actual_weight_kg: null,
          source_message_id: messageId, raw_reply: raw, extraction_status: outlier ? "pending" : "flow",
        });
        if (outlier && last) {
          const pct = Math.round(((e.price - last.price) / last.price) * 100);
          await alertOwner(env, `⚠️ سعر شاذ من المورد "${rec.name}" (نموذج الأسعار): ${e.item.label}\nآخر سعر: ${last.price} ريال${last.date ? ` (${last.date})` : ""}\nالسعر الجديد: ${e.price} ريال (${pct > 0 ? "+" : ""}${pct}%)\nحُفظ ويُستخدم، وعُلّم للمراجعة (x_extraction_status = pending). لم يُرفض.`);
        }
      } else {
        await saveOffer(env, {
          partnerId: rec.partnerId, employeeId: rec.employeeId, productId: e.item.productId, packagingId: e.item.packagingId,
          ...(rec.kind === "purchase" ? { purchase: e.price } : { market: e.price }), messageId, text: raw, ratio,
        }, rec.day);
      }
      saved.push(e);
    } catch (err) {
      console.error("[price-flow] price write failed", (err as Error)?.message);
      unsaved.push(e.item);
    }
  }
  if (rec.supplier && !rec.parent) {
    // the ask is answered (the 05:00 reminder and the 21:15 alert read this log), as a text reply answers it
    try {
      const log = await getSupplierPendingLog(env, rec.partnerId);
      if (log) await updateSupplierLog(env, log.id, { x_replied_at: nowOdoo(now), x_prices_received_count: saved.length, x_status: saved.length > 0 ? "parsed" : "replied" });
      await writePartner(env, rec.partnerId, { x_last_price_submission: nowOdoo(now) });
    } catch (e) {
      console.warn("[price-flow] the ask log could not be marked", (e as Error)?.message);
    }
  }
  if (saved.length) {
    try {
      const { refreshPriceDay } = await import("./prices");
      await refreshPriceDay(env, { now });
    } catch (e) {
      console.warn("[price-flow] prices refresh failed", (e as Error)?.message);
    }
  }
  return { saved, unsaved };
}

async function alertOwner(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("[price-flow] owner alert failed", (e as Error)?.message);
  }
}

export interface FlowReplyOutcome {
  action: "saved" | "test" | "unknown" | "expired" | "duplicate";
  saved?: number;
  why?: string;
}

/** A Flow's reply (nfm_reply): read, checked against its token, written, answered. */
export async function handlePriceFlowReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<FlowReplyOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? PRICE_FLOW_TEST_PURPOSE : "bot_reply";
  const say = async (text: string) => { await sendViaGateway(env, { purpose, to, content: textContent(text), ctx }); };
  const rec = await readFlowToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[price-flow] reply with no token of this number from=${to.slice(-4)}`);
    await say(FLOW_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const entries = readFlowValues(rec, msg.flow?.values ?? {});
  const sent = entries.priced.map((e) => `${e.item.name} ${money(e.price)}`).join("، ") || "بلا أسعار";
  // its own day, and before that day's publication
  const expired = rec.day !== riyadhDateKey(new Date(now)) ? "day"
    : !rec.test && (await dayPublished(env, rec.day).catch(() => false)) ? "published" : null;
  if (expired) {
    console.warn(`[price-flow] expired reply (${expired}) partner=${rec.partnerId} day=${rec.day}`);
    await say(flowExpiredText(expired));
    if (!rec.test) await alertOwner(env, `⌛ رد نموذج الأسعار من «${rec.name}» وصل ${expired === "published" ? "بعد نشر أسعار اليوم" : `بعد يومه (${rec.day})`} ولم يُحفظ: ${sent}.`);
    return { action: "expired", why: expired };
  }
  const answer = async (ack: FlowAck, init: Record<number, number>, text?: string) => {
    const body = text ?? flowAckText(ack);
    const edit = await prepareFlowAsk(env, { partnerId: rec.partnerId, employeeId: rec.employeeId, name: rec.name, whatsapp: to, supplier: rec.supplier, role: rec.kind },
      { now, items: rec.items, pages: rec.pages, init, parent: rec.token, test: rec.test, body, cta: PRICE_FLOW_EDIT_CTA }).catch(() => null);
    const r = edit ? await sendViaGateway(env, { purpose, to, content: edit.session, ctx }) : null;
    // the answer reaches him even if the button could not go
    if (gatewayDecision(r)?.action !== "session") await say(body);
  };
  // a token is read once
  const claim = await claimButton(env, `pflow_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[price-flow] repeated token partner=${rec.partnerId} — not written again`);
    await answer({ saved: [] }, rec.values ?? {}, FLOW_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const before = rec.init ?? {};
    const kept = entries.empty.filter((i) => before[i.slot] > 0).map((item) => ({ item, price: before[item.slot] }));
    const w = rec.test ? { saved: entries.priced, unsaved: [] as FlowItem[] } : await saveFlowPrices(env, rec, entries.priced, msg.messageId, now);
    const values: Record<number, number> = {};
    for (const k of kept) values[k.item.slot] = k.price;
    for (const s of w.saved) values[s.item.slot] = s.price;
    await writeFlowToken(env, { ...rec, usedAt: now, values });
    await finishButton(env, claim, TOKEN_TTL);
    // § 52 و — his prices arrived: no form is owed, and a queued ask of today is dropped
    if (!rec.test && w.saved.length) await markPricesArrived(env, to, rec.day);
    if (kept.length && !rec.test) await alertOwner(env, `ℹ️ «${rec.name}» أفرغ في تعديل نموذج الأسعار خانة: ${kept.map((k) => `${k.item.name} (كان ${money(k.price)})`).join("، ")}. السعر السابق باقٍ في Odoo: الخانة الفاضية لا تلغيه.`);
    await answer({ saved: w.saved, invalid: entries.invalid, unsaved: w.unsaved, kept, test: rec.test }, values);
    console.log(`[price-flow] reply partner=${rec.partnerId} kind=${rec.kind} saved=${w.saved.length} empty=${entries.empty.length} invalid=${entries.invalid.length} unsaved=${w.unsaved.length}${rec.test ? " (test: nothing written)" : ""}`);
    return { action: rec.test ? "test" : "saved", saved: w.saved.length };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE Flow to Baraa's own number, with today's items, marked «🧪 تجربة»: only
 * while his window is open (no template, nothing held), once a day. His reply
 * is answered and writes nothing in Odoo.
 */
export async function sendFlowTest(env: Env, now: number = Date.now()): Promise<{ sent: boolean; reason?: string; token?: string }> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  // one trial a day of THIS Flow (the key carries its id: v1's trial of the same day does not count)
  const claim = await claimButton(env, `pflow_test:${PRICE_FLOW_ID}:${riyadhDateKey(new Date(now))}`, 26 * 60 * 60);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    // the hints a «شراء» source would see: the first supplier among the sources
    const { loadPriceSources } = await import("./price-sources");
    const ref = (await loadPriceSources(env).catch(() => null))?.partners.find((p) => p.supplier && p.role !== "market");
    const r = await sendFlowAsk(env, { partnerId: 0, name: "براء", whatsapp: owner, supplier: false, role: "purchase" },
      { now, test: true, hintsFrom: ref ? { partnerId: ref.partnerId, supplier: true } : undefined });
    if (!r.via) { await releaseButton(env, claim); return { sent: false, reason: r.reason }; }
    await finishButton(env, claim, 26 * 60 * 60);
    return { sent: true, token: r.token };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
