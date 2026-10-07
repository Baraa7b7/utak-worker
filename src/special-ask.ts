// § 62 ب (2026-10-07) — the price ask of «طلب أسعار خاص»: the request's own
// items, by the price form, to the sources Baraa chose on it.
//
//   • The form: utak_price_ask_special_v1 (scripts/lib/s62-price-flow.mjs) —
//     the pages of «أدخل الأسعار» with the request's items alone, «طلب أسعار خاص
//     — N صنف» under each heading, the role's line above the fields, and one
//     optional «ملاحظة». The pages follow the item's category (its own, else
//     its reference's prefix), فواكه then خضار then ورقيات then «أخرى»; a
//     category of more than fifteen takes a second page while one of the four
//     is free, and what has no field is named to Baraa.
//   • § 53's privacy, by the ROLE on the request: a «شراء» source reads each
//     item's quantity (he prices by it) and writes his price net of VAT; a
//     «سوق» source reads no quantity at all and writes the price it sells at.
//     Nobody reads the customer's name, and no price of ours is in the form.
//   • Inside the source's 24h window the form goes at once; outside it the
//     approved template utak_price_ask_flow_v2 (its button opens the same
//     fields without «ملاحظة»); neither usable → the form is OWED to him and
//     goes with his next message.
//   • The reply is read by its own flow_token («sq1.…», kept in KV with the
//     request, the source and the line of every slot), by the number it was
//     sent to, once, at any hour while the request is not «مغلق». It is written
//     on the request's lines — a purchase price is the lowest the «شراء»
//     sources sent, the market observations are kept each with its source —
//     and every market observation is also an x_price_offer row flagged «خاص»
//     with the request (the day's readers leave those out). It NEVER writes a
//     day's price (x_daily_price), never refreshes or reads the day
//     (x_price_day), never marks the 02:00 ask answered.
//   • Baraa reads «📨 وصلت أسعار {الدور} لطلب {العميل}: N من M صنف».
//   • ONE reminder three hours after the ask to a source that has not answered,
//     only while his window is open (never a template, never held).

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession, type GwTemplate } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import {
  FLOW_CATEGORIES, FLOW_OTHER_TITLE, HINT_MAX, LABEL_MAX, PRICE_FLOW_CTA, PRICE_FLOW_EDIT_CTA, PRICE_FLOW_PAGES, PRICE_FLOW_PAGE_SLOTS, PRICE_FLOW_PURPOSE,
  PRICE_FLOW_SCREEN, TEST_MARK, flowAskParams, flowData, flowTemplateReady, pageTitle, parseFlowNumber, type FlowItem,
} from "./price-flow";
import type { PriceKind } from "./price-sources";
import { DEFAULT_UNIT, money } from "./special-quote-math";
import {
  QUOTE_MODEL, RECIPIENT_MODEL, lowestPurchase, nowOdoo, obsText, quoteName, readQuote, recalcQuote, writeResult, type QuoteLine, type SpecialQuote,
} from "./special-quote";

/** utak_price_ask_special_v1 at Meta (scripts/s62-20261007-flows.mjs; a published Flow's JSON is frozen). */
export const SPECIAL_FLOW_ID = "4690022014569990";
export const SPECIAL_ASK_PURPOSE = "special_price_ask";
export const SPECIAL_NUDGE_PURPOSE = "special_price_nudge";
/** The trials to Baraa's own number and their answers (allowed to the owner's number alone). */
export const SPECIAL_TEST_PURPOSE = "special_quote_test";
export const SPECIAL_TOKEN_PREFIX = "sq1.";
export const isSpecialAskToken = (token: string): boolean => String(token ?? "").startsWith(SPECIAL_TOKEN_PREFIX);
export const REMARK_FIELD = "remark";
export const NUDGE_AFTER_MS = 3 * 60 * 60 * 1000;
export const NUDGES_KV = "spq_nudges:v1";
const TOKEN_TTL = 45 * 24 * 60 * 60;
const SEND_LOCK_SECONDS = 90;
const OFFER_MODEL = "x_price_offer";

// ---------------------------------------------------------------- texts

const firstName = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
export const roleNoun = (kind: PriceKind): string => (kind === "purchase" ? "الشراء" : "السوق");
export const roleLabel = (kind: PriceKind): string => (kind === "purchase" ? "شراء" : "سوق");
/** The line under each heading: «طلب أسعار خاص — 27 صنف». */
export const specialTitle = (n: number): string => `طلب أسعار خاص — ${n} صنف`;
/** The role's line above the fields. */
export const ROLE_LINE: Readonly<Record<PriceKind, string>> = {
  purchase: "سعرك بالكيلو بدون ضريبة.",
  market: "سعر البيع في السوق بالكيلو شامل الضريبة.",
};
export const SPECIAL_EMPTY_NOTE = "اترك الخانة فاضية لو ما عندك سعر الصنف.";
export const specialNote = (kind: PriceKind): string => `${ROLE_LINE[kind]} ${SPECIAL_EMPTY_NOTE}`;
/** The text above the button: what is asked, and how — never the customer, never a price of ours. */
export function specialAskText(name: string, kind: PriceKind, n: number): string {
  return kind === "purchase"
    ? `مرحبا ${firstName(name)} 🌿 عندنا في يو تاك طلب أسعار خاص: ${n} صنف بكمياتها. اضغط «${PRICE_FLOW_CTA}» واكتب سعرك بالكيلو بدون ضريبة.`
    : `مرحبا ${firstName(name)} 🌿 نحتاج في يو تاك أسعار السوق لـ ${n} صنف (طلب أسعار خاص). اضغط «${PRICE_FLOW_CTA}» واكتب سعر البيع في السوق بالكيلو شامل الضريبة.`;
}
export const specialNudgeText = (kind: PriceKind, n: number): string =>
  `تذكير من يو تاك: طلب الأسعار الخاص (${n} صنف) ما وصلنا ردّه للحين. اضغط «${PRICE_FLOW_CTA}» واكتب ${kind === "purchase" ? "سعرك بالكيلو بدون ضريبة" : "سعر السوق بالكيلو شامل الضريبة"} لو سمحت 🙏`;
export const SPECIAL_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿";
export const SPECIAL_CLOSED_TEXT = "هذا الطلب أُغلق وما عاد يستقبل أسعاراً: لم يُحفظ شيء 🌿 شكراً لك.";
export const SPECIAL_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. للتعديل اضغط «تعديل».";

const chars = (s: string): string[] => [...String(s ?? "")];
const cut = (s: string, max: number): string => { const c = chars(s); return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join(""); };
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();

/**
 * A slot's label and hint, by the source's role. § 53 — the quantity is in a
 * «شراء» source's hint alone; a «سوق» source's says «السعر بالريال» and nothing
 * of the request. A unit other than the kilo is named to both.
 */
export function specialSlotTexts(line: Pick<QuoteLine, "productName" | "qty" | "unit">, kind: PriceKind): { label: string; hint: string } {
  const unit = clean(line.unit) || DEFAULT_UNIT;
  const hint = kind === "purchase"
    ? `الكمية: ${money(line.qty)} ${unit}`
    : unit === DEFAULT_UNIT ? "السعر بالريال" : `السعر بالريال لكل ${unit}`;
  return { label: cut(clean(line.productName) || "صنف", LABEL_MAX), hint: cut(hint, HINT_MAX) };
}

// ---------------------------------------------------------------- the items on their pages

export interface SpecialItem {
  slot: number;
  lineId: number;
  productId: number;
  /** As the answers name it. */
  name: string;
  label: string;
  hint: string;
}
export interface SpecialPages {
  /** Each line's slot, in the pages' order. */
  placed: Array<{ line: QuoteLine; slot: number }>;
  /** The headings of the pages that have items. */
  pages: string[];
  /** The names of the lines that got no field (more than the four pages hold). */
  left: string[];
}

/** The reference's prefix that names a category when the product carries none (scripts/lib/s46-odoo-code.mjs). */
const REF_CATEGORY: ReadonlyArray<[string, number]> = [["UTAK-FRT-", 5], ["UTAK-VEG-", 6], ["UTAK-LEAF-", 7]];
type M2O = [number, string] | number | false | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);

/**
 * Each product's page: its category among فواكه / خضار / ورقيات (its own or the
 * root it sits under), else the category its reference names, else 0 («أخرى»).
 * Two reads; a failed read throws (the ask is not sent with every item under «أخرى»).
 */
export async function specialCategories(env: Env, productIds: number[]): Promise<{ of: Map<number, number>; titles: Map<number, string> }> {
  const titles = new Map<number, string>(FLOW_CATEGORIES.map((c) => [c.id, c.title]));
  const of = new Map<number, number>();
  if (!productIds.length) return { of, titles };
  const prods = await call<Array<{ id: number; categ_id: M2O; default_code?: string | false }>>(env, "product.template", "search_read", {
    domain: [["id", "in", productIds]], fields: ["id", "categ_id", "default_code"], limit: 500, context: { active_test: false },
  });
  const cats = new Map((await call<Array<{ id: number; name: string; parent_id: M2O }>>(env, "product.category", "search_read", {
    domain: [], fields: ["id", "name", "parent_id"], limit: 500,
  })).map((c) => [c.id, c]));
  for (const c of FLOW_CATEGORIES) { const name = clean(String(cats.get(c.id)?.name ?? "")); if (name) titles.set(c.id, name); }
  for (const p of prods) {
    let page = 0;
    for (let c = cats.get(m2oId(p.categ_id)), hops = 0; c && hops < 20; c = cats.get(m2oId(c.parent_id)), hops++) {
      if (titles.has(c.id)) { page = c.id; break; }
    }
    if (!page) page = REF_CATEGORY.find(([prefix]) => String(p.default_code || "").startsWith(prefix))?.[1] ?? 0;
    of.set(p.id, page);
  }
  return { of, titles };
}

/** The lines on the form's pages: by category, fifteen a page, four pages at most. Pure. */
export function placeLines(lines: QuoteLine[], of: Map<number, number>, titles: Map<number, string>): SpecialPages {
  const groups = [...FLOW_CATEGORIES.map((c) => ({ title: titles.get(c.id) ?? c.title, lines: lines.filter((l) => (of.get(l.productId) ?? 0) === c.id) })),
    { title: FLOW_OTHER_TITLE, lines: lines.filter((l) => !(of.get(l.productId) ?? 0)) }].filter((g) => g.lines.length);
  const chunks: Array<{ title: string; lines: QuoteLine[] }> = [];
  for (const g of groups) {
    const parts = Math.ceil(g.lines.length / PRICE_FLOW_PAGE_SLOTS);
    for (let k = 0; k < parts; k++) {
      chunks.push({ title: parts > 1 ? `${g.title} (${k + 1} من ${parts})` : g.title, lines: g.lines.slice(k * PRICE_FLOW_PAGE_SLOTS, (k + 1) * PRICE_FLOW_PAGE_SLOTS) });
    }
  }
  const shown = chunks.slice(0, PRICE_FLOW_PAGES);
  return {
    placed: shown.flatMap((c, k) => c.lines.map((line, j) => ({ line, slot: k * PRICE_FLOW_PAGE_SLOTS + j + 1 }))),
    pages: shown.map((c) => c.title),
    left: chunks.slice(PRICE_FLOW_PAGES).flatMap((c) => c.lines.map((l) => clean(l.productName))),
  };
}

/** The form's items for a role: the same slots, the role's hints. */
export function specialItems(p: SpecialPages, kind: PriceKind): SpecialItem[] {
  const twice = new Set(p.placed.map((x) => x.line.productId).filter((id, i, a) => a.indexOf(id) !== i));
  return p.placed.map(({ line, slot }) => {
    const t = specialSlotTexts(line, kind);
    const name = twice.has(line.productId) ? `${clean(line.productName)} (${money(line.qty)} ${line.unit})` : clean(line.productName);
    return { slot, lineId: line.id, productId: line.productId, name, label: t.label, hint: t.hint };
  });
}

// ---------------------------------------------------------------- flow_token

export interface SpecialRecord {
  v: 1;
  token: string;
  quoteId: number;
  recipientId: number;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  name: string;
  kind: PriceKind;
  items: SpecialItem[];
  pages: string[];
  createdAt: number;
  /** A trial to Baraa: its reply writes nothing. */
  test?: boolean;
  /** «تعديل»: the token it corrects, and what the form opened with. */
  parent?: string;
  init?: Record<number, number>;
  usedAt?: number;
  values?: Record<number, number>;
}
export const specialTokenKey = (token: string): string => `spq:v1:${token}`;
export function newSpecialToken(quoteId: number, partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${SPECIAL_TOKEN_PREFIX}${quoteId}.${partnerId}.${rand}`;
}
export async function readSpecialToken(env: Env, token: string): Promise<SpecialRecord | null> {
  if (!isSpecialAskToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(specialTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as SpecialRecord) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}
async function writeSpecialToken(env: Env, rec: SpecialRecord): Promise<void> {
  await env.MSG_DEDUP.put(specialTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the message

/** The interactive `flow` message of the special form: `text` above the button, the data with it. */
export function specialSession(text: string, token: string, data: Record<string, string | boolean>, cta: string = PRICE_FLOW_CTA): GwSession {
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
            flow_message_version: "3", flow_token: token, flow_id: SPECIAL_FLOW_ID, flow_cta: cta,
            flow_action: "navigate", flow_action_payload: { screen: PRICE_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

export interface SpecialTarget { quoteId: number; recipientId: number; partnerId: number; name: string; whatsapp: string; kind: PriceKind }
export interface PreparedSpecial { record: SpecialRecord; data: Record<string, string | boolean>; session: GwSession; template: GwTemplate }
export interface SpecialAskOpts { now?: number; body?: string; cta?: string; test?: boolean; parent?: string; init?: Record<number, number> }

/** Everything one ask needs: the token (kept in KV) and the two shapes of the message. */
export async function prepareSpecialAsk(env: Env, t: SpecialTarget, items: SpecialItem[], pages: string[], opts: SpecialAskOpts = {}): Promise<PreparedSpecial> {
  const now = opts.now ?? Date.now();
  const record: SpecialRecord = {
    v: 1, token: newSpecialToken(t.quoteId, t.partnerId), quoteId: t.quoteId, recipientId: t.recipientId, to: waDigits(t.whatsapp), partnerId: t.partnerId,
    name: t.name, kind: t.kind, items, pages, createdAt: now,
    ...(opts.test ? { test: true } : {}), ...(opts.parent ? { parent: opts.parent } : {}), ...(opts.init ? { init: opts.init } : {}),
  };
  await writeSpecialToken(env, record);
  const data = flowData(specialTitle(items.length), specialNote(t.kind), pages.map((p) => pageTitle(p, !!opts.test)), items as unknown as FlowItem[], opts.init ?? {});
  const text = opts.body ?? `${opts.test ? `${TEST_MARK} — ` : ""}${specialAskText(t.name, t.kind, items.length)}`;
  return {
    record, data,
    session: specialSession(text, record.token, data, opts.cta ?? PRICE_FLOW_CTA),
    template: { kind: "template", purpose: PRICE_FLOW_PURPOSE, params: flowAskParams(riyadhDateKey(new Date(now))), flow: { token: record.token, data } },
  };
}

// ---------------------------------------------------------------- owed (the window closed, no template) and the reminder

const owedKey = (digits: string): string => `spq_owed:v1:${waDigits(digits)}`;
interface Owed { quoteId: number; recipientId: number }
async function readOwed(env: Env, digits: string): Promise<Owed[]> {
  try { const j = JSON.parse((await env.MSG_DEDUP.get(owedKey(digits))) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function markOwed(env: Env, digits: string, o: Owed): Promise<void> {
  const list = (await readOwed(env, digits)).filter((x) => !(x.quoteId === o.quoteId && x.recipientId === o.recipientId));
  await env.MSG_DEDUP.put(owedKey(digits), JSON.stringify([...list, o]), { expirationTtl: TOKEN_TTL });
}

export interface Nudge { quoteId: number; recipientId: number; due: number }
export async function readNudges(env: Env): Promise<Nudge[]> {
  try { const j = JSON.parse((await env.MSG_DEDUP.get(NUDGES_KV)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function writeNudges(env: Env, list: Nudge[]): Promise<void> {
  if (list.length) await env.MSG_DEDUP.put(NUDGES_KV, JSON.stringify(list), { expirationTtl: TOKEN_TTL });
  else await env.MSG_DEDUP.delete(NUDGES_KV);
}
async function scheduleNudge(env: Env, quoteId: number, recipientId: number, due: number): Promise<void> {
  const list = (await readNudges(env)).filter((n) => !(n.quoteId === quoteId && n.recipientId === recipientId));
  await writeNudges(env, [...list, { quoteId, recipientId, due }]);
}
async function dropNudge(env: Env, quoteId: number, recipientId: number): Promise<void> {
  const list = await readNudges(env);
  const kept = list.filter((n) => !(n.quoteId === quoteId && n.recipientId === recipientId));
  if (kept.length !== list.length) await writeNudges(env, kept);
}

// ---------------------------------------------------------------- the ask

type Via = "session" | "template" | "owed" | "failed";
export const VIA_LABEL: Readonly<Record<Via, string>> = { session: "نموذج", template: "قالب", owed: "محفوظ حتى يكتب", failed: "تعذّر" };

/** The numbers of the request's sources (one read): x_whatsapp_number, else phone. */
async function recipientNumbers(env: Env, partnerIds: number[]): Promise<Map<number, { name: string; number: string }>> {
  const rows = partnerIds.length ? await call<Array<{ id: number; name: string; phone: string | false; x_whatsapp_number: string | false }>>(env, "res.partner", "read", {
    ids: [...new Set(partnerIds)], fields: ["id", "name", "phone", "x_whatsapp_number"],
  }) : [];
  return new Map(rows.map((r) => [r.id, { name: String(r.name || ""), number: waDigits(String(r.x_whatsapp_number || r.phone || "")) }]));
}

/** One form to one source: inside his window the form, else the approved template, else owed. Never held by the gateway. */
async function askOne(env: Env, t: SpecialTarget, items: SpecialItem[], pages: string[], now: number, ctx?: ExecutionContext): Promise<{ via: Via; reason?: string }> {
  const to = waDigits(t.whatsapp);
  const open = (await readWindow(env, to, now)).open;
  const templateOk = open ? false : await flowTemplateReady(env);
  if (!open && !templateOk) {
    await markOwed(env, to, { quoteId: t.quoteId, recipientId: t.recipientId });
    return { via: "owed" };
  }
  const p = await prepareSpecialAsk(env, t, items, pages, { now });
  const res = await sendViaGateway(env, {
    purpose: SPECIAL_ASK_PURPOSE, to, content: p.session, fallback: templateOk ? [p.template] : [], noHold: true,
    noHoldReason: "نموذج الطلب الخاص يُحفظ حتى يكتب المصدر", link: { model: RECIPIENT_MODEL, id: t.recipientId }, ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action === "session" || d?.action === "template") return { via: d.action };
  try { await env.MSG_DEDUP.delete(specialTokenKey(p.record.token)); } catch { /* expires on its own */ }
  // the window closed under us, or Meta dropped the template for him today: the form waits for his next message
  if (d?.action === "skipped") {
    await markOwed(env, to, { quoteId: t.quoteId, recipientId: t.recipientId });
    return { via: "owed", reason: d.reason };
  }
  return { via: "failed", reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : "code" in d ? `: ${d.code}` : ""}` : "no_decision" };
}

export interface SpecialAskResult {
  action: "sent" | "refused" | "nothing" | "busy" | "not_found";
  detail?: string;
  asks?: Array<{ recipientId: number; name: string; kind: PriceKind; via: Via; reason?: string }>;
  left?: string[];
}

async function tellOwner(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("[special-ask] owner alert failed", (e as Error)?.message);
  }
}
const customerOf = (q: Pick<SpecialQuote, "partnerName" | "id">): string => q.partnerName || quoteName(q.id);

/**
 * «📨 أرسل طلب الأسعار»: the form to every source of the request that has not
 * answered yet. A closed request, a simulation, a request with no line or no
 * source: refused, and the reason is written on the request.
 */
export async function sendSpecialAsk(env: Env, quoteId: number, opts: { now?: number; ctx?: ExecutionContext } = {}): Promise<SpecialAskResult> {
  const now = opts.now ?? Date.now();
  const lock = await claimButton(env, `spq_send:${quoteId}`, SEND_LOCK_SECONDS);
  if (!lock.claimed) return { action: "busy", detail: "pressed a moment ago" };
  try {
    // the defaults of a request nobody saved through the automation yet (its sources among them), and its numbers
    if (!(await recalcQuote(env, quoteId, { now }))) { await releaseButton(env, lock); return { action: "not_found" }; }
    const q = (await readQuote(env, quoteId))!;
    const refuse = async (why: string): Promise<SpecialAskResult> => {
      await writeResult(env, quoteId, `🚫 لم يُرسل طلب الأسعار: ${why}`, now);
      await releaseButton(env, lock);
      return { action: "refused", detail: why };
    };
    if (q.simulation) return refuse("الطلب محاكاة");
    if (q.state === "closed") return refuse("الطلب مغلق");
    if (!q.lines.length) return refuse("لا أصناف في الطلب");
    const lines = q.lines.filter((l) => l.productId > 0);
    const targets = q.recipients.filter((r) => r.partnerId > 0 && r.role && !r.repliedAt);
    if (!q.recipients.length) return refuse("لا مصادر في تبويب «المصادر»");
    if (!targets.length) return refuse("كل المصادر ردّت");

    const cats = await specialCategories(env, [...new Set(lines.map((l) => l.productId))]);
    const placed = placeLines(lines, cats.of, cats.titles);
    const numbers = await recipientNumbers(env, targets.map((r) => r.partnerId));
    const asks: NonNullable<SpecialAskResult["asks"]> = [];
    const commands: unknown[] = [];
    for (const r of targets) {
      const who = numbers.get(r.partnerId);
      const kind = r.role as PriceKind;
      const name = who?.name || r.name;
      if (!who?.number) { asks.push({ recipientId: r.id, name, kind, via: "failed", reason: "بلا رقم واتساب" }); commands.push([1, r.id, { x_via: `${VIA_LABEL.failed}: بلا رقم واتساب` }]); continue; }
      let out: { via: Via; reason?: string };
      try {
        out = await askOne(env, { quoteId, recipientId: r.id, partnerId: r.partnerId, name, whatsapp: who.number, kind }, specialItems(placed, kind), placed.pages, now, opts.ctx);
      } catch (e) {
        out = { via: "failed", reason: (e as Error)?.message ?? String(e) };
      }
      asks.push({ recipientId: r.id, name, kind, ...out });
      commands.push([1, r.id, out.via === "failed" ? { x_via: `${VIA_LABEL.failed}: ${String(out.reason ?? "").slice(0, 120)}` } : { x_asked_at: nowOdoo(now), x_via: VIA_LABEL[out.via] }]);
      // the reminder is for a form that reached him; an owed one goes when he writes
      if (out.via === "session" || out.via === "template") await scheduleNudge(env, quoteId, r.id, now + NUDGE_AFTER_MS);
    }
    const went = asks.filter((a) => a.via !== "failed");
    const vals: Record<string, unknown> = { x_recipient_ids: commands };
    if (went.length) {
      vals.x_asked_at = nowOdoo(now);
      if (q.state === "draft" || !q.state) vals.x_state = "sent";
    }
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals });
    const each = asks.map((a) => `${a.name} (${roleLabel(a.kind)}: ${VIA_LABEL[a.via]}${a.via === "failed" && a.reason ? ` — ${a.reason}` : ""})`).join("، ");
    const leftLine = placed.left.length ? ` ⚠️ بلا خانة (النموذج يتسع لـ ${PRICE_FLOW_PAGES} صفحات): ${placed.left.join("، ")}.` : "";
    await writeResult(env, quoteId, `📨 طلب الأسعار: ${each}.${leftLine}`, now);
    await tellOwner(env, `📨 طلب الأسعار الخاص ${quoteName(quoteId)} (${customerOf(q)}، ${placed.placed.length} صنف): ${each}.${leftLine}`);
    await finishButton(env, lock, SEND_LOCK_SECONDS);
    return { action: went.length ? "sent" : "nothing", asks, left: placed.left, detail: each };
  } catch (e) {
    await releaseButton(env, lock);
    throw e;
  }
}

/**
 * After a source's message (his window has just opened): every special form
 * owed to him goes now — while its request is open and he has not answered it.
 * Never throws. True when one went.
 */
export async function sendOwedSpecial(env: Env, from: string, now: number = Date.now(), ctx?: ExecutionContext): Promise<boolean> {
  const to = waDigits(from);
  if (!to) return false;
  const owed = await readOwed(env, to);
  if (!owed.length) return false;
  try { await env.MSG_DEDUP.delete(owedKey(to)); } catch { return false; }
  let went = false;
  for (const o of owed) {
    try {
      const q = await readQuote(env, o.quoteId);
      const r = q?.recipients.find((x) => x.id === o.recipientId);
      if (!q || q.state === "closed" || q.simulation || !r?.role || r.repliedAt) continue;
      const who = (await recipientNumbers(env, [r.partnerId])).get(r.partnerId);
      if (!who?.number || who.number !== to) continue;
      const lines = q.lines.filter((l) => l.productId > 0);
      const cats = await specialCategories(env, [...new Set(lines.map((l) => l.productId))]);
      const placed = placeLines(lines, cats.of, cats.titles);
      const t: SpecialTarget = { quoteId: q.id, recipientId: r.id, partnerId: r.partnerId, name: who.name || r.name, whatsapp: to, kind: r.role };
      const p = await prepareSpecialAsk(env, t, specialItems(placed, r.role), placed.pages, { now });
      const d = gatewayDecision(await sendViaGateway(env, { purpose: SPECIAL_ASK_PURPOSE, to, content: p.session, noHold: true, noHoldReason: "نموذج الطلب الخاص داخل النافذة فقط", link: { model: RECIPIENT_MODEL, id: r.id }, ctx }));
      if (d?.action !== "session") { await markOwed(env, to, o); continue; }
      await call<boolean>(env, RECIPIENT_MODEL, "write", { ids: [r.id], vals: { x_asked_at: nowOdoo(now), x_via: `${VIA_LABEL.session} (بعد رسالته)` } });
      await scheduleNudge(env, q.id, r.id, now + NUDGE_AFTER_MS);
      went = true;
    } catch (e) {
      console.warn(`[special-ask] the owed form of request ${o.quoteId} failed`, (e as Error)?.message);
      try { await markOwed(env, to, o); } catch { /* lost: Baraa presses the button again */ }
    }
  }
  return went;
}

export interface NudgeTick { quoteId: number; recipientId: number; action: "sent" | "window_closed" | "replied" | "closed" | "gone" | "refused" | "error"; detail?: string }

/**
 * The every-5-minutes tick: ONE reminder to each source whose form went three
 * hours ago and who has not answered — only while his window is open. Whatever
 * happens, the reminder is not tried again. Reads KV alone until one is due.
 */
export async function runSpecialNudgeTick(env: Env, now: number = Date.now(), ctx?: ExecutionContext): Promise<NudgeTick[]> {
  const all = await readNudges(env);
  const due = all.filter((n) => n.due <= now);
  if (!due.length) return [];
  await writeNudges(env, all.filter((n) => n.due > now));
  const out: NudgeTick[] = [];
  const { withAutoSendJob } = await import("./auto-send-guard");
  for (const n of due) {
    try {
      const q = await readQuote(env, n.quoteId);
      const r = q?.recipients.find((x) => x.id === n.recipientId);
      if (!q || !r?.role) { out.push({ ...n, action: "gone" }); continue; }
      if (q.state === "closed" || q.simulation) { out.push({ ...n, action: "closed" }); continue; }
      if (r.repliedAt || r.remindedAt) { out.push({ ...n, action: "replied" }); continue; }
      const who = (await recipientNumbers(env, [r.partnerId])).get(r.partnerId);
      if (!who?.number || !(await readWindow(env, who.number, now)).open) { out.push({ ...n, action: "window_closed" }); continue; }
      const lines = q.lines.filter((l) => l.productId > 0);
      const cats = await specialCategories(env, [...new Set(lines.map((l) => l.productId))]);
      const placed = placeLines(lines, cats.of, cats.titles);
      const items = specialItems(placed, r.role);
      const t: SpecialTarget = { quoteId: q.id, recipientId: r.id, partnerId: r.partnerId, name: who.name || r.name, whatsapp: who.number, kind: r.role };
      const p = await prepareSpecialAsk(env, t, items, placed.pages, { now, body: specialNudgeText(r.role, items.length) });
      const d = gatewayDecision(await sendViaGateway(withAutoSendJob(env, `special_nudge_${q.id}_${r.id}`), {
        purpose: SPECIAL_NUDGE_PURPOSE, to: who.number, content: p.session, noHold: true, noHoldReason: "تذكير الطلب الخاص داخل النافذة فقط", link: { model: RECIPIENT_MODEL, id: r.id }, ctx,
      }));
      if (d?.action !== "session") { out.push({ ...n, action: "refused", detail: d?.action ?? "no_decision" }); continue; }
      await call<boolean>(env, RECIPIENT_MODEL, "write", { ids: [r.id], vals: { x_reminded_at: nowOdoo(now) } });
      out.push({ ...n, action: "sent" });
    } catch (e) {
      out.push({ ...n, action: "error", detail: (e as Error)?.message ?? String(e) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the reply

export interface SpecialEntries {
  priced: Array<{ item: SpecialItem; price: number }>;
  empty: SpecialItem[];
  invalid: SpecialItem[];
}
/** Each slot's field against its item — the token's items, never the client's data. */
export function readSpecialValues(rec: Pick<SpecialRecord, "items">, values: Record<string, unknown>): SpecialEntries {
  const out: SpecialEntries = { priced: [], empty: [], invalid: [] };
  for (const item of rec.items) {
    const v = parseFlowNumber(values[`p${item.slot}`]);
    if (v === null) out.empty.push(item);
    else if (v === "invalid") out.invalid.push(item);
    else out.priced.push({ item, price: v });
  }
  return out;
}
/** «ملاحظة» of the form, as one line. */
export const readRemark = (values: Record<string, unknown>): string => String(typeof values[REMARK_FIELD] === "string" ? values[REMARK_FIELD] : "").replace(/\s+/g, " ").trim().slice(0, 400);

export interface SpecialAck {
  saved: Array<{ item: SpecialItem; price: number }>;
  invalid?: SpecialItem[];
  unsaved?: SpecialItem[];
  kept?: Array<{ item: SpecialItem; price: number }>;
  test?: boolean;
}
/** What the source reads back: his own numbers alone. */
export function specialAckText(a: SpecialAck): string {
  const lines: string[] = [];
  const head = a.test ? `${TEST_MARK} — ` : "";
  if (a.saved.length) lines.push(`${head}وصلت ✅ ${a.saved.map((s) => `${s.item.name} ${money(s.price)}`).join("، ")}.`);
  else lines.push(`${head}وصلت ✅ بدون أسعار: ما سُجّل سعر من هذا النموذج.`);
  if (a.invalid?.length) lines.push(`⚠️ ما انحفظ (السعر رقم أكبر من صفر): ${a.invalid.map((i) => i.name).join("، ")}.`);
  if (a.unsaved?.length) lines.push(`⚠️ ما انحفظ: ${a.unsaved.map((i) => i.name).join("، ")}.`);
  if (a.kept?.length) lines.push(`⚠️ بقي السعر السابق: ${a.kept.map((k) => `${k.item.name} ${money(k.price)}`).join("، ")} (الخانة الفاضية لا تلغي سعراً أُرسل).`);
  if (a.test) lines.push("(تجربة: لم يُكتب شيء في Odoo)");
  return lines.join("\n");
}
/** Baraa's line when a source's prices arrive. */
export const arrivedText = (kind: PriceKind, customer: string, n: number, m: number): string => `📨 وصلت أسعار ${roleNoun(kind)} لطلب ${customer}: ${n} من ${m} صنف`;

/** The packaging an offer row of each product is filed under (its default, else its first): the model requires one. */
async function offerPackagings(env: Env, productIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!productIds.length) return out;
  const packs = await call<Array<{ id: number; x_product_tmpl_id: M2O; x_is_default: boolean; x_sequence: number | false }>>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", productIds]], fields: ["id", "x_product_tmpl_id", "x_is_default", "x_sequence"], limit: 1000,
  });
  for (const id of productIds) {
    const mine = packs.filter((k) => m2oId(k.x_product_tmpl_id) === id).sort((a, b) => (Number(a.x_sequence) || 0) - (Number(b.x_sequence) || 0) || a.id - b.id);
    const pick = mine.find((k) => k.x_is_default) ?? mine[0];
    if (pick) out.set(id, pick.id);
  }
  return out;
}

/**
 * The market observations of a reply, as x_price_offer rows flagged «خاص» with
 * the request — for the price history; every reader of the day leaves them
 * out. One create. A failure loses nothing: the lines hold the prices.
 */
export async function saveSpecialOffers(env: Env, q: SpecialQuote, rec: SpecialRecord, saved: SpecialEntries["priced"], messageId: string, now: number): Promise<number> {
  if (rec.kind !== "market" || !saved.length) return 0;
  const day = riyadhDateKey(new Date(now));
  const packs = await offerPackagings(env, [...new Set(saved.map((s) => s.item.productId))]);
  const unitOf = new Map(q.lines.map((l) => [l.id, l.unit]));
  const vals_list = saved.filter((s) => packs.has(s.item.productId)).map((s) => ({
    x_name: `${day} · خاص ${quoteName(q.id)} · ${s.item.productId}`,
    x_date: day,
    x_source_partner_id: rec.partnerId,
    x_source_employee_id: false,
    x_product_tmpl_id: s.item.productId,
    x_packaging_id: packs.get(s.item.productId),
    x_purchase_price: 0,
    x_market_price: s.price,
    x_available_qty: 0,
    x_status: "valid",
    x_purchase_outlier: false,
    x_market_outlier: false,
    x_source_message_id: messageId || false,
    x_raw_text: `طلب أسعار خاص ${quoteName(q.id)}: ${s.item.label} = ${money(s.price)} (لكل ${unitOf.get(s.item.lineId) || DEFAULT_UNIT})`,
    x_special: true,
    x_special_quote_id: q.id,
    x_special_unit: unitOf.get(s.item.lineId) || DEFAULT_UNIT,
  }));
  if (!vals_list.length) return 0;
  await call<number[]>(env, OFFER_MODEL, "create", { vals_list });
  return vals_list.length;
}

export interface SpecialReplyOutcome {
  action: "saved" | "test" | "unknown" | "closed" | "duplicate";
  saved?: number;
  quoteId?: number;
}

/** A special form's reply (nfm_reply): read, checked against its token and its request, written on the lines, answered. */
export async function handleSpecialAskReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<SpecialReplyOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? SPECIAL_TEST_PURPOSE : "bot_reply";
  const say = async (text: string) => { await sendViaGateway(env, { purpose, to, content: textContent(text), ctx }); };
  const rec = await readSpecialToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[special-ask] reply with no token of this number from=${to.slice(-4)}`);
    await say(SPECIAL_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const values = msg.flow?.values ?? {};
  const entries = readSpecialValues(rec, values);
  const remark = readRemark(values);
  const sent = entries.priced.map((e) => `${e.item.name} ${money(e.price)}`).join("، ") || "بلا أسعار";
  const target: SpecialTarget = { quoteId: rec.quoteId, recipientId: rec.recipientId, partnerId: rec.partnerId, name: rec.name, whatsapp: to, kind: rec.kind };
  const answer = async (ack: SpecialAck, init: Record<number, number>, text?: string) => {
    const body = text ?? specialAckText(ack);
    const edit = await prepareSpecialAsk(env, target, rec.items, rec.pages, { now, init, parent: rec.token, test: rec.test, body, cta: PRICE_FLOW_EDIT_CTA }).catch(() => null);
    const r = edit ? await sendViaGateway(env, { purpose, to, content: edit.session, ctx }) : null;
    // the answer reaches him even if the button could not go
    if (gatewayDecision(r)?.action !== "session") await say(body);
  };

  // the request it belongs to: any hour, while it is not closed
  const q = rec.test ? null : await readQuote(env, rec.quoteId);
  if (!rec.test && (!q || q.state === "closed")) {
    console.warn(`[special-ask] reply to a closed request ${rec.quoteId} partner=${rec.partnerId}`);
    await say(SPECIAL_CLOSED_TEXT);
    await tellOwner(env, `⌛ رد أسعار ${roleNoun(rec.kind)} من «${rec.name}» وصل بعد إغلاق الطلب ${quoteName(rec.quoteId)}${q ? ` (${customerOf(q)})` : ""} ولم يُحفظ: ${sent}.${remark ? `\nملاحظته: ${remark}` : ""}`);
    return { action: "closed", quoteId: rec.quoteId };
  }
  // a token is read once
  const claim = await claimButton(env, `spq_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[special-ask] repeated token partner=${rec.partnerId} — not written again`);
    await answer({ saved: [] }, rec.values ?? {}, SPECIAL_USED_TEXT);
    return { action: "duplicate", quoteId: rec.quoteId };
  }
  try {
    const before = rec.init ?? {};
    const kept = entries.empty.filter((i) => before[i.slot] > 0).map((item) => ({ item, price: before[item.slot] }));
    let saved = entries.priced;
    let unsaved: SpecialItem[] = [];
    if (!rec.test && q) {
      // the request's lines alone: the source's price on its line (a line removed since the ask is named back to him)
      const byId = new Map(q.lines.map((l) => [l.id, l]));
      unsaved = entries.priced.filter((e) => !byId.has(e.item.lineId)).map((e) => e.item);
      saved = entries.priced.filter((e) => byId.has(e.item.lineId));
      const commands: unknown[] = saved.map((e) => {
        const line = byId.get(e.item.lineId)!;
        const obs = { purchase: { ...line.obs.purchase }, market: { ...line.obs.market } };
        obs[rec.kind][String(rec.partnerId)] = { p: e.price, n: rec.name, at: now };
        const lv: Record<string, unknown> = { x_obs: obsText(obs) };
        // «أقل عرض»: the lowest price the «شراء» sources sent for the line
        if (rec.kind === "purchase") lv.x_purchase_price = lowestPurchase(obs);
        return [1, line.id, lv];
      });
      const vals: Record<string, unknown> = {};
      // his row on the request (Baraa may have removed it since the ask: his prices are kept all the same)
      if (q.recipients.some((r) => r.id === rec.recipientId)) vals.x_recipient_ids = [[1, rec.recipientId, { x_replied_at: nowOdoo(now), x_priced: saved.length + kept.length }]];
      if (commands.length) vals.x_line_ids = commands;
      if (remark) vals.x_source_notes = [q.sourceNotes, `${rec.name} (${roleLabel(rec.kind)}): ${remark}`].filter(Boolean).join("\n").slice(-4000);
      if (Object.keys(vals).length) await call<boolean>(env, QUOTE_MODEL, "write", { ids: [q.id], vals });
      // «تعديل»: only what changed is a new observation in the history
      const fresh = saved.filter((s) => before[s.item.slot] !== s.price);
      try { await saveSpecialOffers(env, q, rec, fresh, msg.messageId, now); } catch (e) { console.warn("[special-ask] the «خاص» offer rows were not written", (e as Error)?.message); }
      await recalcQuote(env, q.id, { now });
      await dropNudge(env, q.id, rec.recipientId);
    }
    const kv: Record<number, number> = {};
    for (const k of kept) kv[k.item.slot] = k.price;
    for (const s of saved) kv[s.item.slot] = s.price;
    await writeSpecialToken(env, { ...rec, usedAt: now, values: kv });
    await finishButton(env, claim, TOKEN_TTL);
    await answer({ saved, invalid: entries.invalid, unsaved, kept, test: rec.test }, kv);
    if (!rec.test && q) {
      const extra = [
        `المصدر: ${rec.name} · ${quoteName(q.id)}${rec.parent ? " (تعديل)" : ""}`,
        remark ? `ملاحظته: ${remark}` : "",
        entries.invalid.length ? `⚠️ خانات ليست سعراً: ${entries.invalid.map((i) => i.name).join("، ")}` : "",
        unsaved.length ? `⚠️ أسطر حُذفت من الطلب بعد الإرسال: ${unsaved.map((i) => i.name).join("، ")}` : "",
      ].filter(Boolean);
      await tellOwner(env, [arrivedText(rec.kind, customerOf(q), saved.length, rec.items.length), ...extra].join("\n"));
    }
    console.log(`[special-ask] reply request=${rec.quoteId} partner=${rec.partnerId} kind=${rec.kind} saved=${saved.length} empty=${entries.empty.length} invalid=${entries.invalid.length}${rec.test ? " (test: nothing written)" : ""}`);
    return { action: rec.test ? "test" : "saved", saved: saved.length, quoteId: rec.quoteId };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

