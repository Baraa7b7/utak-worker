// § 65 ج (2026-10-07) — «عرض مورد»: the supplier starts it.
//
// «📦 بضاعتي جاهزة» (a farmer, any supplier) and «🚢 وصلت شحنة» (an importer) — the
// buttons of his welcome and of the periodic check-in, their texts typed, or
// «عرض مورد» — open the Flow utak_supplier_offer_v1 for an APPROVED supplier,
// inside his 24h window only: the item (a list of HIS items and «صنف آخر»), the
// quantity, the price, the packaging, the size, the origin, ready from / until,
// a note.
//
// The reply is ONE x_price_offer row flagged «خاص» with «نوع العرض» = «عرض مورد»:
// every reader of the day leaves a «خاص» row out (§ 62), so it enters no list of
// the day, no median, no «أقل عرض» and no «آخر سعر». Its price is the price of
// the packaging he WROTE («وحدة السعر (خاص)»), not of the row's packaging. A form
// with a field that cannot be read is refused whole and nothing is written.
// «صنف آخر» that the catalog does not name hangs on the unlinked item and Baraa's
// one message says «🆕 صنف من مورد»; otherwise it says «📦 عرض مورد».
//
// Nothing here sends a price of ours to anyone.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call, stripRef } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { defaultPackaging, itemRefFor, unlinkedItem } from "./supplier-catalog";
import { SIGNUP_PENDING_TEXT, SUPPLIER_REPLY_PURPOSE, SUPPLIER_TEST_MARK, findCardByNumber, type SupplierCard } from "./supplier-registry";

/** utak_supplier_offer_v1 at Meta (a published Flow's JSON is frozen). */
export const OFFER_FLOW_ID = "1077214898460021";
export const OFFER_FLOW_SCREEN = "OFFER";
export const OFFER_FORM_PURPOSE = "supplier_offer_form";
export const OFFER_TEST_PURPOSE = "supplier_registry_test";
export const OFFER_CTA = "عرض مورد";
export const OFFER_TOKEN_PREFIX = "so1.";
export const isOfferToken = (token: string): boolean => String(token ?? "").startsWith(OFFER_TOKEN_PREFIX);
export const OFFER_OTHER_ID = "other";
export const OFFER_OTHER_TITLE = "صنف آخر (اكتبه تحت)";
export const OFFER_ITEMS_MAX = 199;
export const OFFER_MODEL = "x_price_offer";
export const OFFER_KIND = "supplier_offer";
const TOKEN_TTL = 3 * 24 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";

export type OfferWhat = "ready" | "ship";
export const OFFER_HEADING: Readonly<Record<OfferWhat, string>> = { ready: "📦 بضاعتي جاهزة", ship: "🚢 وصلت شحنة" };
export const OFFER_HOW: Readonly<Record<OfferWhat, string>> = {
  ready: "اكتب ما عندك جاهز الآن: الصنف والكمية والسعر والتعبئة، ثم «إرسال».",
  ship: "اكتب ما وصل في الشحنة: الصنف والكمية والسعر والتعبئة والمنشأ، ثم «إرسال».",
};
export const offerAskText = (what: OfferWhat): string => `${OFFER_HEADING[what]} — اضغط «${OFFER_CTA}» واكتب الصنف والكمية والسعر.`;
export const OFFER_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿 اضغط «📦 بضاعتي جاهزة» لنموذج جديد.";
export const OFFER_USED_TEXT = "عرضك هذا وصلنا من قبل ✅ ولم يُسجَّل مرة ثانية. لعرض جديد اضغط «📦 بضاعتي جاهزة».";
export const OFFER_BAD_TEXT = "ما قدرنا نقرأ العرض 🙏 الصنف والكمية والسعر والتعبئة مطلوبة، والكمية والسعر أرقام أكبر من صفر. لم يُحفظ شيء: اضغط «📦 بضاعتي جاهزة» وأعده.";
export const OFFER_NOT_APPROVED_TEXT = "عروض الموردين للمعتمدين عندنا 🌿 للتسجيل اكتب «تسجيل مورد».";

const plain = (text: string): string => String(text ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
/** What a message asks for: the welcome's two buttons (by id or by text), or «عرض مورد» (the check-in's button). */
export function offerTrigger(msg: Pick<NormalizedMessage, "text" | "buttonId">): OfferWhat | null {
  const id = String(msg.buttonId ?? "");
  if (id === "sup_offer:ship") return "ship";
  if (id === "sup_offer:ready") return "ready";
  const t = plain(msg.text);
  if (t === "وصلت شحنه" || t === "وصلت شحنة" || t === "وصلت شحنتي") return "ship";
  if (t === "بضاعتي جاهزه" || t === "بضاعتي جاهزة" || t === "عرض مورد") return "ready";
  return null;
}

// ---------------------------------------------------------------- flow_token

export interface OfferRecord {
  v: 1;
  token: string;
  to: string;
  partnerId: number;
  name: string;
  what: OfferWhat;
  /** The list he chose from: the product ids, as the form's option ids. */
  items: Array<{ id: number; name: string }>;
  day: string;
  createdAt: number;
  test?: boolean;
  usedAt?: number;
}
export const offerKey = (token: string): string => `supso:v1:${token}`;
export function newOfferToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${OFFER_TOKEN_PREFIX}${partnerId}.${rand}`;
}
export async function readOfferToken(env: Env, token: string): Promise<OfferRecord | null> {
  if (!isOfferToken(token)) return null;
  try {
    const rec = JSON.parse((await env.MSG_DEDUP.get(offerKey(token))) || "null") as OfferRecord | null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the send

const cut = (s: string, max: number): string => { const c = [...String(s ?? "")]; return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join(""); };
/** His items as the form lists them (thirty characters a title at Meta), and «صنف آخر» last. */
export function offerOptions(items: Array<{ id: number; name: string }>): Array<{ id: string; title: string }> {
  return [...items.slice(0, OFFER_ITEMS_MAX).map((i) => ({ id: String(i.id), title: cut(i.name, 30) })), { id: OFFER_OTHER_ID, title: OFFER_OTHER_TITLE }];
}
export function offerData(what: OfferWhat, items: Array<{ id: number; name: string }>, day: string, test = false): Record<string, unknown> {
  return { t: `${test ? `${SUPPLIER_TEST_MARK} — ` : ""}${OFFER_HEADING[what]}`, how: OFFER_HOW[what], items: offerOptions(items), d: day };
}
export function offerSession(text: string, token: string, data: Record<string, unknown>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: { name: "flow", parameters: { flow_message_version: "3", flow_token: token, flow_id: OFFER_FLOW_ID, flow_cta: OFFER_CTA, flow_action: "navigate", flow_action_payload: { screen: OFFER_FLOW_SCREEN, data } } },
      },
    },
  };
}
/** The names of his items, as Odoo names them (one read). */
export async function suppliedItems(env: Env, ids: number[]): Promise<Array<{ id: number; name: string }>> {
  if (!ids.length) return [];
  const rows = await call<Array<{ id: number; name: string }>>(env, "product.template", "search_read", { domain: [["id", "in", ids]], fields: ["id", "name"], order: "name asc", limit: OFFER_ITEMS_MAX });
  return rows.map((r) => ({ id: r.id, name: stripRef(String(r.name || "")).trim() }));
}
export interface OfferSendResult { sent: boolean; reason?: string; token?: string }
/** One offer form: the interactive message, inside the supplier's window only. Nothing is held. */
export async function sendOfferForm(env: Env, who: { partnerId: number; name: string; whatsapp: string; suppliedIds: number[] }, what: OfferWhat, o: { now?: number; test?: boolean; ctx?: ExecutionContext } = {}): Promise<OfferSendResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = o.now ?? Date.now();
  if (!o.test && isOwnerRecipient(env, to)) return { sent: false, reason: "owner" };
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const items = await suppliedItems(env, who.suppliedIds).catch(() => []);
  const day = riyadhDateKey(new Date(now));
  const rec: OfferRecord = { v: 1, token: newOfferToken(who.partnerId), to, partnerId: who.partnerId, name: who.name, what, items, day, createdAt: now, ...(o.test ? { test: true } : {}) };
  await env.MSG_DEDUP.put(offerKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const res = await sendViaGateway(env, {
    purpose: o.test ? OFFER_TEST_PURPOSE : OFFER_FORM_PURPOSE, to,
    content: offerSession(`${o.test ? `${SUPPLIER_TEST_MARK} — ` : ""}${offerAskText(what)}`, rec.token, offerData(what, items, day, !!o.test)),
    noHold: true, noHoldReason: "نموذج عرض المورد يُرسل داخل نافذة 24 ساعة فقط", ctx: o.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(offerKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

/**
 * A supplier's tap or text that asks for the offer form. True when it was answered here. Only an
 * APPROVED supplier gets the form; one «بانتظار الاعتماد» is told so; anyone else is not answered here.
 */
export async function answerOfferTrigger(env: Env, msg: Pick<NormalizedMessage, "from" | "text" | "buttonId">, who: { team: boolean }, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  const what = offerTrigger(msg);
  if (!what || who.team || isOwnerRecipient(env, msg.from)) return false;
  const card: SupplierCard | null = await findCardByNumber(env, msg.from);
  if (!card?.state) return false;
  const to = waDigits(msg.from);
  if (card.state !== "approved") {
    if (card.state === "pending") await sendViaGateway(env, { purpose: SUPPLIER_REPLY_PURPOSE, to, content: textContent(SIGNUP_PENDING_TEXT), ctx });
    return true;
  }
  const r = await sendOfferForm(env, { partnerId: card.id, name: card.name, whatsapp: msg.from, suppliedIds: card.suppliedIds }, what, { now, ctx });
  if (!r.sent) console.warn(`[supplier-offer] the form could not go to …${to.slice(-4)}: ${r.reason}`);
  return true;
}

// ---------------------------------------------------------------- the reply

const clean = (v: unknown, max = 80): string => String(v ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
/** A number above zero, as a field holds it (Arabic digits and «٫» read); null = not one. */
export function offerNumber(raw: unknown): number | null {
  let s = String(raw ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٫/g, ".").replace(/\s+/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 ? n : null;
}
/** A DatePicker's value: «YYYY-MM-DD» (Flow JSON 5+), or milliseconds as an older client sends them; "" = none or not a date. */
export function offerDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s) + 3 * 3600_000).toISOString().slice(0, 10);
  return "";
}
export interface OfferParsed {
  /** The chosen product of his list; 0 = «صنف آخر». */
  productId: number;
  /** The item's name: his list's, or what he typed for «صنف آخر». */
  itemText: string;
  qty: number; price: number; pack: string; size: string; origin: string; from: string; until: string; note: string;
  problems: Array<"item" | "qty" | "price" | "pack">;
}
/** What the form holds, against the list its token carries — never the client's data. */
export function parseOfferValues(rec: Pick<OfferRecord, "items">, raw: Record<string, unknown>): OfferParsed {
  const chosen = String(raw.item ?? "");
  const other = clean(raw.other, 60);
  const item = rec.items.find((i) => String(i.id) === chosen) ?? null;
  const qty = offerNumber(raw.qty), price = offerNumber(raw.price);
  const pack = clean(raw.pack, 40);
  const from = offerDate(raw.from);
  let until = offerDate(raw.until);
  if (from && until && until < from) until = "";
  const problems: OfferParsed["problems"] = [];
  if (!item && !(chosen === OFFER_OTHER_ID && other)) problems.push("item");
  if (qty === null) problems.push("qty");
  if (price === null) problems.push("price");
  if (!pack) problems.push("pack");
  return { productId: item?.id ?? 0, itemText: item ? item.name : other, qty: qty ?? 0, price: price ?? 0, pack, size: clean(raw.size, 30), origin: clean(raw.origin, 40), from, until, note: clean(raw.note, 300), problems };
}

const money = (x: number): string => { const n = Math.round(Number(x) * 100) / 100; return Number.isInteger(n) ? String(n) : n.toFixed(2); };
/** «طماطم — 200 × كرتون 10 كجم بسعر 35 · مقاس 66 · مصر · جاهز من 2026-10-08». */
export function offerLine(p: OfferParsed): string {
  return [`${p.itemText} — ${money(p.qty)} × ${p.pack} بسعر ${money(p.price)}`, p.size ? `مقاس ${p.size}` : "", p.origin, p.from ? `جاهز من ${p.from}${p.until ? ` حتى ${p.until}` : ""}` : p.until ? `جاهز حتى ${p.until}` : ""].filter(Boolean).join(" · ");
}
export const offerAckText = (p: OfferParsed, test = false): string =>
  `${test ? `${SUPPLIER_TEST_MARK} — ` : ""}وصل عرضك ✅ ${offerLine(p)}.\nبنتواصل معك لو احتجناه 🌿${test ? "\n(تجربة: الصف معلّم «محاكاة» ولا يُحسب في أي رقم)" : ""}`;
/** Baraa's ONE message: «📦 عرض مورد», or «🆕 صنف من مورد» when the item is not in the catalog. */
export function offerOwnerText(rec: Pick<OfferRecord, "name" | "what" | "test">, p: OfferParsed, linked: boolean): string {
  const head = linked ? `${rec.what === "ship" ? "🚢 وصلت شحنة" : "📦 عرض مورد"} من «${rec.name}»` : `🆕 صنف من مورد — «${rec.name}» عرض صنفاً ليس في الكتالوج: «${p.itemText}»`;
  return [
    `${rec.test ? `${SUPPLIER_TEST_MARK} — ` : ""}${head}`,
    offerLine(p),
    p.note ? `ملاحظته: ${p.note}` : "",
    linked ? "في «🛒 المشتريات ← 📥 عروض الموردين» (خارج حساب أسعار اليوم)." : "اربطه بصنف من الكتالوج أو أنشئه، من «🛒 المشتريات ← 📥 عروض الموردين» (فلتر «صنف غير مربوط»).",
  ].filter(Boolean).join("\n");
}

/** The row an offer writes (ONE create). «خاص» keeps it out of every reader of the day. */
export function offerRowVals(rec: Pick<OfferRecord, "partnerId" | "name" | "what" | "test">, p: OfferParsed, ref: { productId: number; packagingId: number }, day: string, messageId: string): Record<string, unknown> {
  return {
    x_name: `${day} · عرض مورد · ${rec.name}`.slice(0, 120),
    x_date: day,
    x_source_partner_id: rec.partnerId,
    x_product_tmpl_id: ref.productId,
    x_packaging_id: ref.packagingId,
    x_purchase_price: p.price,
    x_market_price: 0,
    x_available_qty: p.qty,
    x_status: "valid",
    x_source_message_id: messageId || false,
    x_raw_text: `${OFFER_HEADING[rec.what]}: ${offerLine(p)}${p.note ? ` — ${p.note}` : ""}`.slice(0, 2000),
    x_special: true,
    x_special_unit: p.pack,
    x_offer_kind: OFFER_KIND,
    x_item_text: p.itemText,
    x_item_size: p.size || false,
    x_item_origin: p.origin || false,
    x_ready_from: p.from || false,
    x_ready_until: p.until || false,
    x_offer_note: p.note || false,
    ...(rec.test ? { [SIM_FIELD]: true } : {}),
  };
}

async function tellOwner(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.warn("[supplier-offer] the owner's line failed", (e as Error)?.message);
  }
}

export interface OfferOutcome { action: "saved" | "invalid" | "test" | "unknown" | "duplicate" | "not_approved"; rowId?: number; linked?: boolean }

/** A reply of the offer form (nfm_reply): read, checked against its token, written as ONE row, answered. */
export async function handleOfferReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<OfferOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (text: string) => { await sendViaGateway(env, { purpose: owner ? OFFER_TEST_PURPOSE : SUPPLIER_REPLY_PURPOSE, to, content: textContent(text), ctx }); };
  const rec = await readOfferToken(env, msg.flow?.token ?? "");
  if (!rec || rec.to !== to) {
    console.warn(`[supplier-offer] reply with no token of this number from=${to.slice(-4)}`);
    await say(OFFER_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const p = parseOfferValues(rec, msg.flow?.values ?? {});
  // a field that cannot be read: the whole form is refused, nothing is written
  if (p.problems.length) { await say(OFFER_BAD_TEXT); return { action: "invalid" }; }
  // a supplier stopped since the form went: nothing is written
  if (!rec.test) {
    const card = await findCardByNumber(env, msg.from).catch(() => null);
    if (!card || card.id !== rec.partnerId || card.state !== "approved") { await say(OFFER_NOT_APPROVED_TEXT); return { action: "not_approved" }; }
  }
  const claim = await claimButton(env, `supso_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) { await say(OFFER_USED_TEXT); return { action: "duplicate" }; }
  let rowId = 0, linked = true;
  try {
    let ref: { productId: number; packagingId: number };
    if (p.productId) {
      const pack = await defaultPackaging(env, p.productId);
      ref = pack ? { productId: p.productId, packagingId: pack } : { productId: p.productId, packagingId: (await unlinkedItem(env)).packagingId };
    } else {
      const r = await itemRefFor(env, p.itemText);
      ref = r; linked = r.linked;
    }
    const day = riyadhDateKey(new Date(now));
    [rowId] = await call<number[]>(env, OFFER_MODEL, "create", { vals_list: [offerRowVals(rec, p, ref, day, msg.messageId)] });
    await env.MSG_DEDUP.put(offerKey(rec.token), JSON.stringify({ ...rec, usedAt: now }), { expirationTtl: TOKEN_TTL });
    await finishButton(env, claim, TOKEN_TTL);
    if (!rec.test) {
      // «آخر سعر/عرض» on his card: what he just sent
      await call<boolean>(env, "res.partner", "write", { ids: [rec.partnerId], vals: { x_last_offer_text: `${offerLine(p)} — ${day}`.slice(0, 250) } }).catch((e) => console.warn("[supplier-offer] the card's last offer could not be written", (e as Error)?.message));
    }
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
  await say(offerAckText(p, !!rec.test));
  await tellOwner(env, offerOwnerText(rec, p, linked));
  console.log(`[supplier-offer] partner=${rec.partnerId} row=${rowId} linked=${linked}${rec.test ? " (test)" : ""}`);
  return { action: rec.test ? "test" : "saved", rowId, linked };
}

// ---------------------------------------------------------------- the trial to Baraa

/** ONE offer form to Baraa's own number, marked «🧪 تجربة»: inside his window, once a day. Its row is flagged «محاكاة». */
export async function sendOfferTest(env: Env, now: number = Date.now()): Promise<OfferSendResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `supso_test:${OFFER_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    // the row of a trial hangs on Baraa's own partner (the card his number carries), flagged «محاكاة»
    const card = await findCardByNumber(env, `+${owner}`).catch(() => null);
    if (!card) { await releaseButton(env, claim); return { sent: false, reason: "no_owner_partner" }; }
    const r = await sendOfferForm(env, { partnerId: card.id, name: "براء", whatsapp: owner, suppliedIds: [] }, "ready", { now, test: true });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
