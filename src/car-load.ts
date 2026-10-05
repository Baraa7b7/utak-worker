// § 55 ج (2026-10-05) — the car's load as a WhatsApp Flow: what went on the car
// in the morning, and what is left on it and what is damaged at the end of the
// day. The worker then counts what LEFT the car and holds it against the day's
// deliveries; Baraa is told either way.
//
// The Flow (utak_carload_v1; scripts/lib/s55-flows.mjs is its JSON) is ONE form
// for both moments: four generic pages of fifteen slots, with no endpoint — all
// the data goes with the message to the first page (flow_action navigate), as
// the order form does (src/order-form.ts). A slot is two number fields: a<n>
// (its label the item's name) and b<n> (shown in the evening alone).
//
//   • The morning («حمولة» / «حمولة السيارة», or the button cload_m): a field for
//     every ACTIVE item (active, for sale, x_is_active_for_sale — the price
//     engine's own list, in its default packaging), by category. What he writes
//     is the day's load. Sent again the same day it opens with the load on
//     record and replaces it — until an evening count exists.
//   • The evening («نهاية الحمولة» / «الباقي», or the button cload_e): the items
//     loaded this morning, each with «الباقي» (a) and «التالف» (b). With no load
//     on record he is told so and gets the morning form.
//   • The count: dispatched = loaded − left − damaged, an item. It is compared
//     with what was DELIVERED that Riyadh day — the lines (not «unavailable») of
//     the orders delivered in it (delivered / closed, not simulation), by product
//     and packaging: one car, so all the day's deliveries. The difference an
//     item is dispatched − delivered; an item delivered and never loaded is a
//     difference too.
//   • Baraa (owner_team_note) ALWAYS gets the evening's result: «✅ مطابقة
//     للتسليمات» with the totals, or a line for every item that differs, then
//     the damaged items. In the morning: one line with the total loaded.
//   • Only a team member with the «driver» role, inside his 24h window (an
//     interactive message: never a template, never held). The text commands are
//     the whole message, nothing else in it.
//   • flow_token (cl1.…): one per send, kept in KV with the number, the day and
//     the item of every slot. A reply is read from it — never from the client's
//     data — by the number it was sent to, on the day it was sent, once. A field
//     left empty is 0; a value that is not a number, is negative or has more
//     than two decimals refuses the WHOLE form (nothing kept), and so does
//     left + damaged above the loaded quantity: one message naming the fields,
//     with a fresh form opened on what he wrote.
//   • Nothing is written in Odoo: the day's record lives in KV four days (per
//     Riyadh day and driver), and the messages themselves are recorded by the
//     gateway (x_wa_message) like every send.
//   • NO PRICE of any kind is read, kept or sent here — not purchase, not sale
//     (§ 53: the driver's forms carry no purchase price).

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import type { RouterReply } from "./router";
import { call } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { FLOW_CATEGORIES, FLOW_OTHER_TITLE, FLOW_PLAIN_TITLE, productPages } from "./price-flow";
import { readActiveItems } from "./pricing-engine";
import { dayLabel } from "./order-flow";
import { sendOwnerMessage, T } from "./templates";

/** utak_carload_v1 at Meta (a published Flow's JSON is frozen). */
export const CARLOAD_FLOW_ID = "1128570570118160";
export const CARLOAD_FLOW_SCREEN = "LOAD_A";
export const CARLOAD_FLOW_PAGES = 4;
export const CARLOAD_FLOW_PAGE_SLOTS = 15;
export const CARLOAD_FLOW_SLOTS = CARLOAD_FLOW_PAGES * CARLOAD_FLOW_PAGE_SLOTS;
/** The gateway purpose of the form and of its answers to the driver. */
export const CARLOAD_PURPOSE = "car_load_form";
/** The one trial to Baraa and its answers (allowed to the owner's number alone). */
export const CARLOAD_TEST_PURPOSE = "car_load_form_test";
/** What Baraa is told (the morning's line, the evening's result): the team's note to him. */
export const CARLOAD_OWNER_PURPOSE = T.OWNER_TEAM_NOTE;
/** The role that loads the car. */
export const CARLOAD_ROLE = "driver";
export const CARLOAD_BUTTON_MORNING = "cload_m";
export const CARLOAD_BUTTON_EVENING = "cload_e";
export const CARLOAD_BUTTON_MORNING_TITLE = "حمولة السيارة";
export const CARLOAD_BUTTON_EVENING_TITLE = "نهاية الحمولة";
export const CARLOAD_CTA_MORNING = "سجّل الحمولة";
export const CARLOAD_CTA_EVENING = "سجّل الباقي والتالف";
/** Meta's limits of a TextInput: its label and its helper text. */
export const CARLOAD_LABEL_MAX = 20;
export const CARLOAD_HINT_MAX = 80;
/** …and of a TextHeading. */
export const CARLOAD_HEADING_MAX = 80;
export const CARLOAD_TEST_MARK = "🧪 تجربة";
/** The largest quantity a field takes. */
export const CARLOAD_QTY_MAX = 9999;
/** The day's record is kept this long. */
export const CARLOAD_KEEP_SEC = 4 * 24 * 60 * 60;
/** An interactive message's text, and a text message's room. */
const BODY_MAX = 1024;
const TEXT_ROOM = 3500;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIM_FIELD = "x_utak_simulation";

export type CarLoadMoment = "morning" | "evening";

// ---------------------------------------------------------------- texts

export const CARLOAD_MORNING_TITLE = "حمولة الصباح";
export const CARLOAD_EVENING_TITLE = "آخر اليوم";
export const CARLOAD_MORNING_NOTE = "اكتب الكمية المحمّلة جنب كل صنف. الخانة الفاضية = صفر.";
export const CARLOAD_EVENING_NOTE = "لكل صنف: الباقي في السيارة، وتحته التالف. الخانة الفاضية = صفر.";
export const CARLOAD_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «حمولة» أو «نهاية الحمولة» ونرسل لك نموذج اليوم.";
export const CARLOAD_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. للتعديل اكتب «حمولة» أو «نهاية الحمولة».";
export const CARLOAD_EXPIRED_TEXT = "هذا نموذج يوم سابق، ولم يُسجَّل منه شيء. اكتب «حمولة» أو «نهاية الحمولة» لنموذج اليوم.";
export const CARLOAD_EMPTY_TEXT = "ما وصلتنا كمية في النموذج، ولم يُسجَّل شيء. اكتب الكمية المحمّلة جنب كل صنف ثم «إرسال».";
export const CARLOAD_CLOSED_TEXT = "سُجّل الباقي والتالف لحمولة اليوم، فالحمولة ما تتغيّر بعده. لو فيه خطأ في الحمولة بلّغ براء.";
export const CARLOAD_NO_LOAD_TEXT = "ما فيه حمولة مسجّلة اليوم. سجّل حمولة الصباح أولاً 👇";
export const CARLOAD_STALE_TEXT = "الحمولة تغيّرت بعد إرسال هذا النموذج، فلم يُسجَّل منه شيء. هذا نموذج بالحمولة الحالية 👇";
export const CARLOAD_NO_ITEMS_TEXT = "ما فيه أصناف نشطة الآن، فلا نموذج للحمولة. بلّغ براء.";
export const CARLOAD_FAILED_TEXT = "تعذّر إرسال نموذج الحمولة الآن. جرّب بعد قليل، أو أرسلها لبراء نصاً.";
export const CARLOAD_NOT_READ_TEXT = "⚠️ تعذّرت قراءة تسليمات اليوم من Odoo، فلم تُقارن الحمولة بها.";
export const CARLOAD_MATCH_TEXT = "✅ مطابقة للتسليمات";

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** A quantity as it is read: «20», «2.5». */
export const qty = (n: number): string => (Number.isInteger(n) ? String(n) : String(round2(n)));
/** A difference with its sign: «+2», «−3» (U+2212), «0». */
export function signedQty(n: number): string {
  const v = round2(n);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${qty(Math.abs(v))}`;
}
const hhmm = (ms: number): string => riyadhHHMM(new Date(ms));
/** Names in a line, within `room` characters: the first that fit, then «و N غيرها». */
export function namesLine(names: string[], room: number): string {
  const out: string[] = [];
  for (const n of names) {
    if ([...out, n].join("، ").length > room) break;
    out.push(n);
  }
  const rest = names.length - out.length;
  return rest > 0 ? `${out.join("، ")}${out.length ? " " : ""}و${rest} غيرها` : out.join("، ");
}
/** Lines as messages of at most `room` characters, cut between lines. */
export function textParts(lines: string[], room: number = TEXT_ROOM): string[] {
  const parts: string[] = [];
  let cur: string[] = [], size = 0;
  for (const l of lines) {
    if (cur.length && size + l.length + 1 > room) { parts.push(cur.join("\n")); cur = []; size = 0; }
    cur.push(l); size += l.length + 1;
  }
  if (cur.length) parts.push(cur.join("\n"));
  return parts;
}

/**
 * «حمولة» / «حمولة السيارة» → the morning form; «نهاية الحمولة» / «الباقي» → the
 * evening one. The WHOLE message and nothing else in it (the spelling as it is
 * typed on a phone: ة / ه, أ / ا, the marks, a full stop after it).
 */
export function carLoadCommand(text: string): CarLoadMoment | null {
  const t = String(text ?? "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[.!؟?،,\s]+$/g, "").replace(/\s+/g, " ");
  if (t === "حموله" || t === "حموله السياره") return "morning";
  if (t === "نهايه الحموله" || t === "الباقي") return "evening";
  return null;
}
export const carLoadButtonMoment = (id: string): CarLoadMoment | null =>
  (id === CARLOAD_BUTTON_MORNING ? "morning" : id === CARLOAD_BUTTON_EVENING ? "evening" : null);
export const carLoadEveningButton = (): { id: string; title: string } => ({ id: CARLOAD_BUTTON_EVENING, title: CARLOAD_BUTTON_EVENING_TITLE });
export const carLoadMorningButton = (): { id: string; title: string } => ({ id: CARLOAD_BUTTON_MORNING, title: CARLOAD_BUTTON_MORNING_TITLE });

// ---------------------------------------------------------------- the day's record (KV)

export interface CarLoadEntry {
  /** «<product.template id>:<x_product_packaging id>». */
  key: string;
  productId: number;
  packagingId: number;
  /** «طماطم كرتون». */
  name: string;
  product: string;
  packaging: string;
  /** Its category: the heading of its page. */
  page: string;
  loaded: number;
}
export interface CarLoadCount { key: string; left: number; damaged: number }
export interface CarLoadDay {
  v: 1;
  /** The Riyadh day. */
  day: string;
  /** The driver's Work Contact (res.partner), and his name. */
  driverId: number;
  driver: string;
  /** The morning load: every item with a quantity, and when it was sent. */
  loadedAt: number;
  items: CarLoadEntry[];
  /** The evening count of each loaded item, and when. */
  countedAt?: number;
  count?: CarLoadCount[];
}
export const carLoadKey = (day: string, driverId: number): string => `cload:v1:${day}:${driverId}`;
export async function readCarLoad(env: Env, day: string, driverId: number): Promise<CarLoadDay | null> {
  try {
    const raw = await env.MSG_DEDUP.get(carLoadKey(day, driverId));
    const rec = raw ? (JSON.parse(raw) as CarLoadDay) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}
async function writeCarLoad(env: Env, rec: CarLoadDay): Promise<void> {
  await env.MSG_DEDUP.put(carLoadKey(rec.day, rec.driverId), JSON.stringify(rec), { expirationTtl: CARLOAD_KEEP_SEC });
}

// ---------------------------------------------------------------- the form's items

export interface CarLoadItem {
  slot: number;
  key: string;
  productId: number;
  packagingId: number;
  name: string;
  product: string;
  packaging: string;
  page: string;
  /** a<n>'s label and hint, and b<n>'s label. */
  label: string;
  hint: string;
  label2: string;
  /** The evening: the quantity loaded this morning (the morning form: 0). */
  loaded: number;
}
export interface CarLoadPages {
  items: CarLoadItem[];
  /** The headings of the pages that have items, in order. */
  pages: string[];
  /** The items beyond the form's sixty fields. */
  left: string[];
}
/** An item as the form takes it: its product and packaging, its category, and (the evening) what was loaded of it. */
export interface CarLoadStock { productId: number; packagingId: number; product: string; packaging: string; page: string; loaded: number }

/** A slot's texts: the morning's «كرتون · الكمية المحمّلة», the evening's «الباقي في السيارة · المحمّل 20 كرتون» and «تالف: طماطم». */
export function carLoadSlotTexts(moment: CarLoadMoment, product: string, packaging: string, loaded: number): { label: string; hint: string; label2: string } {
  const p = clean(product), k = clean(packaging);
  return {
    label: cut(p, CARLOAD_LABEL_MAX),
    hint: cut(moment === "morning" ? `${k ? `${k} · ` : ""}الكمية المحمّلة` : `الباقي في السيارة · المحمّل ${qty(loaded)}${k ? ` ${k}` : ""}`, CARLOAD_HINT_MAX),
    label2: cut(`تالف: ${p}`, CARLOAD_LABEL_MAX),
  };
}

/**
 * The items on their pages: by category in the given order, fifteen a page; a
 * longer category continues on the next («خضار (2)»). When that takes more than
 * the form's four pages the items run on instead, fifteen a page in the same
 * order, each page headed by the categories it holds («فواكه · خضار») — so the
 * first SIXTY always have a field, and only what is beyond them is left. Pure.
 */
export function carLoadPages(moment: CarLoadMoment, stock: CarLoadStock[]): CarLoadPages {
  const titles = [...new Set(stock.map((s) => s.page))];
  const ordered = titles.flatMap((title) => stock.filter((s) => s.page === title));
  let pages: Array<{ title: string; rows: CarLoadStock[] }> = [];
  for (const title of titles) {
    const rows = ordered.filter((s) => s.page === title);
    for (let i = 0; i < rows.length; i += CARLOAD_FLOW_PAGE_SLOTS) {
      pages.push({ title: i ? `${title} (${i / CARLOAD_FLOW_PAGE_SLOTS + 1})` : title, rows: rows.slice(i, i + CARLOAD_FLOW_PAGE_SLOTS) });
    }
  }
  if (pages.length > CARLOAD_FLOW_PAGES) {
    pages = [];
    for (let i = 0; i < ordered.length; i += CARLOAD_FLOW_PAGE_SLOTS) {
      const rows = ordered.slice(i, i + CARLOAD_FLOW_PAGE_SLOTS);
      pages.push({ title: [...new Set(rows.map((s) => s.page))].join(" · "), rows });
    }
  }
  const used = pages.slice(0, CARLOAD_FLOW_PAGES);
  const nameOf = (s: CarLoadStock): string => `${clean(s.product)} ${clean(s.packaging)}`.trim();
  return {
    items: used.flatMap((p, k) => p.rows.map((s, j) => ({
      slot: k * CARLOAD_FLOW_PAGE_SLOTS + j + 1, key: `${s.productId}:${s.packagingId}`, productId: s.productId, packagingId: s.packagingId,
      name: nameOf(s), product: clean(s.product), packaging: clean(s.packaging), page: s.page, loaded: s.loaded,
      ...carLoadSlotTexts(moment, s.product, s.packaging, s.loaded),
    }))),
    pages: used.map((p) => p.title),
    left: pages.slice(CARLOAD_FLOW_PAGES).flatMap((p) => p.rows.map(nameOf)),
  };
}

/** The morning's items: every active item in its default packaging, by category (a category that cannot be read: one page, nothing lost). */
export async function morningStock(env: Env): Promise<CarLoadStock[]> {
  const active = await readActiveItems(env, []);
  if (!active.length) return [];
  let of = new Map<number, number>(), titles = new Map<number, string>(), plain = false;
  try {
    ({ of, titles } = await productPages(env, [...new Set(active.map((i) => i.productId))]));
  } catch (e) {
    console.warn("[car-load] the categories could not be read — one page", (e as Error)?.message);
    plain = true;
  }
  const row = (i: (typeof active)[number], page: string): CarLoadStock => ({ productId: i.productId, packagingId: i.packagingId, product: i.productName, packaging: i.packagingName, page, loaded: 0 });
  if (plain) return active.map((i) => row(i, FLOW_PLAIN_TITLE));
  return [
    ...FLOW_CATEGORIES.flatMap((c) => active.filter((i) => (of.get(i.productId) ?? 0) === c.id).map((i) => row(i, titles.get(c.id) ?? c.title))),
    ...active.filter((i) => !(of.get(i.productId) ?? 0)).map((i) => row(i, FLOW_OTHER_TITLE)),
  ];
}
/** The evening's items: what was loaded this morning, as it was kept. */
export const eveningStock = (rec: CarLoadDay): CarLoadStock[] =>
  rec.items.filter((i) => i.loaded > 0).map((i) => ({ productId: i.productId, packagingId: i.packagingId, product: i.product, packaging: i.packaging, page: i.page, loaded: i.loaded }));

export type CarLoadInit = Record<number, { a?: number; b?: number }>;
/** The 428 keys of the first page: the note, each page's heading and whether a page follows it, and l/h/g/v/w/i/j of every slot. */
export function carLoadData(moment: CarLoadMoment, pages: string[], items: CarLoadItem[], init: CarLoadInit = {}, mark = ""): Record<string, string | boolean> {
  const title = moment === "morning" ? CARLOAD_MORNING_TITLE : CARLOAD_EVENING_TITLE;
  const data: Record<string, string | boolean> = { note: moment === "morning" ? CARLOAD_MORNING_NOTE : CARLOAD_EVENING_NOTE };
  for (let k = 1; k <= CARLOAD_FLOW_PAGES; k++) {
    data[`t${k}`] = pages[k - 1] ? cut(`${mark}${title} — ${pages[k - 1]}`, CARLOAD_HEADING_MAX) : "-";
    if (k < CARLOAD_FLOW_PAGES) data[`m${k}`] = k < pages.length;
  }
  for (let n = 1; n <= CARLOAD_FLOW_SLOTS; n++) {
    const it = items.find((x) => x.slot === n);
    data[`l${n}`] = it ? it.label : "-";
    data[`h${n}`] = it ? it.hint : "-";
    data[`g${n}`] = it ? it.label2 : "-";
    data[`v${n}`] = !!it;
    // the second field — «التالف» — belongs to the evening alone
    data[`w${n}`] = !!it && moment === "evening";
    data[`i${n}`] = it && (init[n]?.a ?? 0) > 0 ? qty(init[n].a as number) : "";
    data[`j${n}`] = it && moment === "evening" && (init[n]?.b ?? 0) > 0 ? qty(init[n].b as number) : "";
  }
  return data;
}

// ---------------------------------------------------------------- flow_token

export interface CarLoadToken {
  v: 1;
  token: string;
  moment: CarLoadMoment;
  /** The Riyadh day it was sent: the only day its reply is read. */
  day: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  driverId: number;
  driver: string;
  items: CarLoadItem[];
  pages: string[];
  createdAt: number;
  /** The evening: the load it was made from (a load replaced since then makes it stale). */
  loadedAt?: number;
  /** The trial to Baraa: its reply keeps nothing. */
  test?: boolean;
  usedAt?: number;
}
export const carLoadTokenKey = (token: string): string => `cload_t:v1:${token}`;
export const isCarLoadToken = (token: string): boolean => String(token ?? "").startsWith("cl1.");
export function newCarLoadToken(day: string, driverId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cl1.${day.replace(/-/g, "")}.${driverId}.${rand}`;
}
export async function readCarLoadToken(env: Env, token: string): Promise<CarLoadToken | null> {
  if (!isCarLoadToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(carLoadTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as CarLoadToken) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
  } catch { return null; }
}
async function writeCarLoadToken(env: Env, rec: CarLoadToken): Promise<void> {
  await env.MSG_DEDUP.put(carLoadTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the send

export interface CarLoadWho { partnerId: number; name: string; whatsapp: string }
export interface CarLoadFormOpts {
  now?: number;
  /** The text above the button (default: the moment's own). */
  body?: string;
  /** The same items on the same pages (a form sent again after a refusal). */
  items?: CarLoadItem[];
  pages?: string[];
  left?: string[];
  /** What the fields open with (slot → a / b). */
  init?: CarLoadInit;
  /** The evening: the load the items were taken from. */
  loadedAt?: number;
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface CarLoadFormResult { sent: boolean; reason?: string; token?: string; items?: number }

export function carLoadSession(text: string, token: string, data: Record<string, string | boolean>, cta: string): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: CARLOAD_FLOW_ID,
            flow_cta: cta,
            flow_action: "navigate",
            flow_action_payload: { screen: CARLOAD_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/** The text above the form's button. */
export function carLoadFormText(moment: CarLoadMoment, day: string, o: { left?: string[]; onRecordAt?: number } = {}): string {
  const lines = moment === "morning"
    ? [`🚚 ${CARLOAD_BUTTON_MORNING_TITLE} — ${dayLabel(day)}`, `اضغط «${CARLOAD_CTA_MORNING}» واكتب الكمية المحمّلة جنب كل صنف، ثم «إرسال».`,
      ...(o.onRecordAt ? [`حمولة اليوم المسجّلة (${hhmm(o.onRecordAt)}) مكتوبة في الخانات: عدّلها ثم «إرسال»، وإرسالك يستبدلها.`] : [])]
    : [`🚚 ${CARLOAD_BUTTON_EVENING_TITLE} — ${dayLabel(day)}`, `اضغط «${CARLOAD_CTA_EVENING}» واكتب لكل صنف الباقي في السيارة والتالف، ثم «إرسال».`,
      ...(o.onRecordAt ? [`الباقي والتالف المسجّلان (${hhmm(o.onRecordAt)}) مكتوبان في الخانات: إرسالك يستبدلهما.`] : [])];
  if (o.left?.length) lines.push(`خارج النموذج (يتسع لـ ${CARLOAD_FLOW_SLOTS}): ${namesLine(o.left, 500)}. اكتبها لبراء نصاً.`);
  return lines.join("\n");
}

/**
 * One car-load form: the interactive message, inside the number's window only.
 * Nothing is held and no template is used. The morning's items are the active
 * items; the evening's are the load on record (none: nothing goes).
 */
export async function sendCarLoadForm(env: Env, who: CarLoadWho, moment: CarLoadMoment, opts: CarLoadFormOpts = {}): Promise<CarLoadFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const day = riyadhDateKey(new Date(now));
  let items = opts.items ?? null, pages = opts.pages ?? [], left = opts.left ?? [], loadedAt = opts.loadedAt;
  let init = opts.init, onRecordAt: number | undefined;
  if (!items) {
    const onRecord = opts.test ? null : await readCarLoad(env, day, who.partnerId);
    if (moment === "evening" && !onRecord) return { sent: false, reason: "no_load" };
    const built = carLoadPages(moment, moment === "morning" ? await morningStock(env) : eveningStock(onRecord as CarLoadDay));
    items = built.items; pages = built.pages; left = built.left;
    if (moment === "evening") {
      loadedAt = (onRecord as CarLoadDay).loadedAt;
      // a count already on record: the form opens with it, and sending it again replaces it
      if (onRecord?.count && !init) {
        init = Object.fromEntries(items.map((it) => { const c = onRecord.count?.find((x) => x.key === it.key); return [it.slot, { a: c?.left ?? 0, b: c?.damaged ?? 0 }]; }));
        onRecordAt = onRecord.countedAt;
      }
    } else if (onRecord && !init) {
      // the load on record: the form opens with it (an empty field would otherwise erase its item)
      init = Object.fromEntries(items.map((it) => [it.slot, { a: onRecord.items.find((x) => x.key === it.key)?.loaded ?? 0 }]));
      onRecordAt = onRecord.loadedAt;
    }
  }
  if (!items.length) return { sent: false, reason: "no_items" };
  const rec: CarLoadToken = {
    v: 1, token: newCarLoadToken(day, who.partnerId), moment, day, to, driverId: who.partnerId, driver: who.name, items, pages, createdAt: now,
    ...(loadedAt ? { loadedAt } : {}), ...(opts.test ? { test: true } : {}),
  };
  await writeCarLoadToken(env, rec);
  const mark = opts.test ? `${CARLOAD_TEST_MARK} — ` : "";
  const res = await sendViaGateway(env, {
    purpose: opts.test ? CARLOAD_TEST_PURPOSE : CARLOAD_PURPOSE,
    to,
    content: carLoadSession(`${mark}${opts.body ?? carLoadFormText(moment, day, { left, onRecordAt })}`, rec.token, carLoadData(moment, pages, items, init ?? {}, mark), moment === "morning" ? CARLOAD_CTA_MORNING : CARLOAD_CTA_EVENING),
    noHold: true,
    noHoldReason: "نموذج الحمولة يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(carLoadTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token, items: items.length };
}

// ---------------------------------------------------------------- when it goes

async function tell(env: Env, to: string, text: string, ctx?: ExecutionContext, purpose: string = CARLOAD_PURPOSE): Promise<void> {
  await sendViaGateway(env, { purpose, to, content: textContent(text), ctx });
}

/**
 * The driver asked for the form. The morning: the form (after an evening count:
 * one line — the load no longer changes). The evening: the form of this
 * morning's load; with none on record, one line saying so above the morning
 * form. Never throws: what cannot go is said in one line.
 */
export async function startCarLoad(env: Env, who: CarLoadWho, moment: CarLoadMoment, ctx?: ExecutionContext, now: number = Date.now()): Promise<CarLoadFormResult> {
  const to = waDigits(who.whatsapp);
  try {
    const day = riyadhDateKey(new Date(now));
    const onRecord = await readCarLoad(env, day, who.partnerId);
    let r: CarLoadFormResult;
    if (moment === "morning" && onRecord?.count) {
      await tell(env, to, CARLOAD_CLOSED_TEXT, ctx);
      return { sent: false, reason: "closed" };
    }
    if (moment === "evening" && !onRecord) {
      r = await sendCarLoadForm(env, who, "morning", { now, ctx, body: `${CARLOAD_NO_LOAD_TEXT}\n${carLoadFormText("morning", day)}` });
    } else {
      r = await sendCarLoadForm(env, who, moment, { now, ctx });
    }
    // outside his window nothing is said either: a line held for later would answer nothing
    if (!r.sent && r.reason !== "window_closed") await tell(env, to, r.reason === "no_items" ? CARLOAD_NO_ITEMS_TEXT : CARLOAD_FAILED_TEXT, ctx);
    return r;
  } catch (e) {
    console.warn("[car-load] the form could not be sent", (e as Error)?.message);
    try { await tell(env, to, CARLOAD_FAILED_TEXT, ctx); } catch { /* nothing more to say */ }
    return { sent: false, reason: "error" };
  }
}

type Member = { id: number; name: string; x_whatsapp_number?: string | false | null; x_role?: string; x_role_codes?: string[] };
const hasRole = (m: Member, role: string): boolean => (m.x_role_codes ?? (m.x_role ? [m.x_role] : [])).includes(role);

/**
 * A team member's text: «حمولة» / «نهاية الحمولة» from a DRIVER is answered
 * with the form (true: nothing else replies). Any other text, and the same
 * words from a member without the role, are not this module's (false).
 */
export async function carLoadText(env: Env, member: Member, text: string, from: string, ctx?: ExecutionContext): Promise<boolean> {
  const moment = carLoadCommand(text);
  if (!moment || !hasRole(member, CARLOAD_ROLE)) return false;
  await startCarLoad(env, { partnerId: member.id, name: member.name, whatsapp: String(member.x_whatsapp_number || from) }, moment, ctx);
  return true;
}

/**
 * The buttons cload_m / cload_e: the same forms, for the number of a team
 * member with the driver role (the roster is read). Null for anyone else: the
 * router answers as it does any button it does not know.
 */
export async function handleCarLoadButton(env: Env, buttonId: string, partner: { id: number; name?: string; x_whatsapp_number?: string | false | null } | null): Promise<RouterReply | null> {
  const moment = carLoadButtonMoment(buttonId);
  const number = String(partner?.x_whatsapp_number || "");
  if (!moment || !partner?.id || !number) return null;
  try {
    const { loadRoster, memberByNumber } = await import("./team-roster");
    // the number that tapped, as the roster knows it — never the partner the caller names
    const m = memberByNumber(await loadRoster(env), number);
    if (!m || !m.codes.includes(CARLOAD_ROLE)) return null;
    await startCarLoad(env, { partnerId: m.partnerId, name: m.name, whatsapp: number }, moment);
    return { text: "" };
  } catch (e) {
    console.warn("[car-load] the button could not be answered", (e as Error)?.message);
    return null;
  }
}

// ---------------------------------------------------------------- the day's deliveries

type M2O = [number, string] | false;
const m2o = (v: M2O | number | undefined): [number, string] => (Array.isArray(v) ? v : typeof v === "number" ? [v, ""] : [0, ""]);
export type Delivered = Map<string, { name: string; qty: number }>;

/**
 * What was delivered on a Riyadh day, by product and packaging: the lines (not
 * «unavailable») of the orders delivered in it (delivered / closed, not
 * simulation). All the day's deliveries: one car. Throws on Odoo trouble.
 */
export async function deliveredOn(env: Env, day: string): Promise<Delivered> {
  const from = riyadhDayMinuteMs(day, 0);
  const orders = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
    domain: [["x_state", "in", ["delivered", "closed"]], ["x_delivered_at", ">=", toOdooUtc(from)], ["x_delivered_at", "<", toOdooUtc(from + DAY_MS)], [SIM_FIELD, "!=", true]],
    fields: ["id"], limit: 5000,
  });
  const out: Delivered = new Map();
  if (!orders.length) return out;
  const lines = await call<Array<{ x_product_tmpl_id: M2O; x_packaging_id: M2O; x_quantity: number | false }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", orders.map((o) => o.id)], ["x_status", "!=", "unavailable"], [SIM_FIELD, "!=", true]],
    fields: ["x_product_tmpl_id", "x_packaging_id", "x_quantity"], limit: 20000,
  });
  for (const l of lines) {
    const [p, pName] = m2o(l.x_product_tmpl_id), [k, kName] = m2o(l.x_packaging_id);
    const q = Number(l.x_quantity) || 0;
    if (!p || !(q > 0)) continue;
    const key = `${p}:${k}`;
    const cur = out.get(key);
    out.set(key, { name: cur?.name ?? `${clean(pName)} ${clean(kName)}`.trim(), qty: round2((cur?.qty ?? 0) + q) });
  }
  return out;
}

// ---------------------------------------------------------------- the count

export interface CarLoadRow {
  key: string;
  name: string;
  loaded: number;
  left: number;
  damaged: number;
  /** loaded − left − damaged: what left the car. */
  dispatched: number;
  /** What the day's deliveries hold of it (0 when they were not read). */
  delivered: number;
  /** dispatched − delivered. */
  diff: number;
}
/** Each loaded item with its count, against the day's deliveries; then what was delivered and never loaded. Pure. */
export function carLoadRows(rec: CarLoadDay, delivered: Delivered | null): CarLoadRow[] {
  const rows: CarLoadRow[] = rec.items.filter((i) => i.loaded > 0).map((i) => {
    const c = rec.count?.find((x) => x.key === i.key);
    const left = c?.left ?? 0, damaged = c?.damaged ?? 0;
    const dispatched = round2(i.loaded - left - damaged);
    const got = delivered?.get(i.key)?.qty ?? 0;
    return { key: i.key, name: i.name, loaded: i.loaded, left, damaged, dispatched, delivered: got, diff: delivered ? round2(dispatched - got) : 0 };
  });
  // delivered, and never loaded: a difference too
  for (const [key, d] of delivered ?? []) {
    if (!rows.some((r) => r.key === key)) rows.push({ key, name: d.name, loaded: 0, left: 0, damaged: 0, dispatched: 0, delivered: d.qty, diff: round2(-d.qty) });
  }
  return rows;
}
const sum = (rows: CarLoadRow[], f: (r: CarLoadRow) => number): number => round2(rows.reduce((s, r) => s + f(r), 0));

/** The morning's confirmation to the driver: what he loaded. The list, and the short text that carries the button. */
export function loadConfirmText(rec: CarLoadDay, o: { replacedAt?: number; test?: boolean } = {}): { parts: string[]; body: string } {
  const total = qty(round2(rec.items.reduce((s, i) => s + i.loaded, 0)));
  const head = `✅ سُجّلت حمولة السيارة — ${dayLabel(rec.day)}:`;
  const list = rec.items.map((i) => `• ${i.name} × ${qty(i.loaded)}`);
  const tail = [
    `المجموع: ${total} · عدد الأصناف: ${rec.items.length}`,
    ...(o.replacedAt ? [`🔁 استبدلت الحمولة المسجّلة الساعة ${hhmm(o.replacedAt)}.`] : []),
    o.test ? "(تجربة: لم يُحفظ شيء)" : `آخر اليوم اضغط «${CARLOAD_BUTTON_EVENING_TITLE}» واكتب الباقي والتالف.`,
  ];
  const whole = [head, ...list, ...tail].join("\n");
  if (whole.length <= BODY_MAX) return { parts: [], body: whole };
  return { parts: textParts([head, ...list]), body: [`✅ سُجّلت حمولة السيارة — ${dayLabel(rec.day)} (التفاصيل أعلاه).`, ...tail].join("\n") };
}
/** Baraa's one line in the morning. */
export function ownerLoadLine(rec: CarLoadDay, o: { replacedAt?: number } = {}): string {
  const total = qty(round2(rec.items.reduce((s, i) => s + i.loaded, 0)));
  return `🚚 حمولة السيارة — ${rec.driver} — ${dayLabel(rec.day)}: المحمّل ${total} · عدد الأصناف ${rec.items.length} · الساعة ${hhmm(rec.loadedAt)}${o.replacedAt ? ` (استبدلت حمولة الساعة ${hhmm(o.replacedAt)})` : ""}`;
}
/** The evening's confirmation to the driver: an item — loaded, left, damaged, dispatched. */
export function countConfirmText(rec: CarLoadDay, o: { replacedAt?: number } = {}): string[] {
  const rows = carLoadRows(rec, null);
  return textParts([
    `✅ سُجّل الباقي والتالف — ${dayLabel(rec.day)}:`,
    ...rows.map((r) => `• ${r.name}: المحمّل ${qty(r.loaded)} · الباقي ${qty(r.left)} · التالف ${qty(r.damaged)} · المنصرف ${qty(r.dispatched)}`),
    `المجموع: المحمّل ${qty(sum(rows, (r) => r.loaded))} · الباقي ${qty(sum(rows, (r) => r.left))} · التالف ${qty(sum(rows, (r) => r.damaged))} · المنصرف ${qty(sum(rows, (r) => r.dispatched))}`,
    ...(o.replacedAt ? [`🔁 استبدل العدّ المسجّل الساعة ${hhmm(o.replacedAt)}.`] : []),
    "وصل الملخص لبراء ✅",
  ]);
}
/**
 * Baraa's message at the evening, always: «✅ مطابقة للتسليمات» with the
 * totals, or a line for every item that differs — loaded, left, damaged,
 * dispatched, delivered, the difference with its sign — then the damaged items.
 * `delivered` null: the deliveries could not be read, and it says so.
 */
export function ownerCountText(rec: CarLoadDay, delivered: Delivered | null, o: { correctedAt?: number } = {}): string[] {
  const rows = carLoadRows(rec, delivered);
  const lines = [`🚚 حمولة السيارة — ${rec.driver} — ${dayLabel(rec.day)}`];
  if (o.correctedAt) lines.push(`🔁 تصحيح: هذا العدّ يستبدل عدّ الساعة ${hhmm(o.correctedAt)}.`);
  const off = rows.filter((r) => Math.abs(r.diff) >= 0.005);
  if (!delivered) {
    lines.push(CARLOAD_NOT_READ_TEXT);
    lines.push(`المجموع: المحمّل ${qty(sum(rows, (r) => r.loaded))} · الباقي ${qty(sum(rows, (r) => r.left))} · التالف ${qty(sum(rows, (r) => r.damaged))} · المنصرف ${qty(sum(rows, (r) => r.dispatched))}`);
  } else {
    if (!off.length) lines.push(CARLOAD_MATCH_TEXT);
    else {
      lines.push(`⚠️ فرق في ${off.length} من الأصناف (الفرق = المنصرف − المسلَّم):`);
      for (const r of off) {
        lines.push(r.loaded > 0
          ? `• ${r.name}: المحمّل ${qty(r.loaded)} · الباقي ${qty(r.left)} · التالف ${qty(r.damaged)} · المنصرف ${qty(r.dispatched)} · المسلَّم ${qty(r.delivered)} · الفرق ${signedQty(r.diff)}`
          : `• ${r.name}: لم يُحمَّل · المسلَّم ${qty(r.delivered)} · الفرق ${signedQty(r.diff)}`);
      }
    }
    lines.push(`المجموع: المحمّل ${qty(sum(rows, (r) => r.loaded))} · المسلَّم ${qty(sum(rows, (r) => r.delivered))} · الباقي ${qty(sum(rows, (r) => r.left))} · التالف ${qty(sum(rows, (r) => r.damaged))}`);
  }
  const damaged = rows.filter((r) => r.damaged > 0);
  if (damaged.length) lines.push(`التالف: ${damaged.map((r) => `${r.name} ${qty(r.damaged)}`).join("، ")}`);
  return textParts(lines);
}

// ---------------------------------------------------------------- the reply

/** What a field holds: a quantity (empty = 0), or something that is not one — not a number, negative, more than two decimals. */
export function parseLoadQty(raw: unknown): number | "invalid" {
  if (raw === undefined || raw === null) return 0;
  let s = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");
  if (s === "") return 0;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = Number(s);
  return n <= CARLOAD_QTY_MAX ? n : "invalid";
}

export interface CarLoadEntries {
  /** Every slot's item with what its fields hold (b is 0 in the morning). */
  read: Array<{ item: CarLoadItem; a: number; b: number }>;
  /** The fields that hold something that is not a quantity, by their labels. */
  invalid: string[];
  /** The evening: the items whose left + damaged pass what was loaded. */
  over: string[];
}
/** Each slot's fields against its item — the token's items, never the client's data. */
export function readCarLoadValues(rec: Pick<CarLoadToken, "items" | "moment">, values: Record<string, unknown>): CarLoadEntries {
  const out: CarLoadEntries = { read: [], invalid: [], over: [] };
  for (const item of rec.items) {
    const a = parseLoadQty(values[`a${item.slot}`]);
    const b = rec.moment === "evening" ? parseLoadQty(values[`b${item.slot}`]) : 0;
    if (a === "invalid") out.invalid.push(item.label);
    if (b === "invalid") out.invalid.push(item.label2);
    const av = a === "invalid" ? 0 : a, bv = b === "invalid" ? 0 : b;
    if (rec.moment === "evening" && a !== "invalid" && b !== "invalid" && round2(av + bv) > item.loaded) out.over.push(`${item.name} (المحمّل ${qty(item.loaded)})`);
    out.read.push({ item, a: av, b: bv });
  }
  return out;
}
/** The one message of a refused form: which fields, and why. */
export function carLoadRefusalText(e: Pick<CarLoadEntries, "invalid" | "over">): string {
  return [
    "⚠️ ما انحفظ شيء من النموذج:",
    ...(e.invalid.length ? [`• قيمة غير صحيحة في: ${namesLine(e.invalid, 300)} — اكتب رقماً (صفر أو أكثر) بخانتين عشريتين على الأكثر.`] : []),
    ...(e.over.length ? [`• الباقي + التالف أكثر من المحمّل في: ${namesLine(e.over, 300)}.`] : []),
    "صحّح الخانات ثم «إرسال» 👇",
  ].join("\n");
}

export interface CarLoadOutcome {
  action: "loaded" | "counted" | "invalid" | "empty" | "closed" | "stale" | "test" | "unknown" | "expired" | "duplicate";
  items?: number;
  /** The evening: how many items differ from the deliveries (null: the deliveries were not read). */
  differences?: number | null;
}

/** A reply of the car-load form (nfm_reply): read, checked against its token, kept in KV, reported. */
export async function handleCarLoadReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<CarLoadOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? CARLOAD_TEST_PURPOSE : CARLOAD_PURPOSE;
  const say = (text: string) => tell(env, to, text, ctx, purpose);
  const rec = await readCarLoadToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[car-load] reply with no token of this number from=${to.slice(-4)}`);
    await say(CARLOAD_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const today = riyadhDateKey(new Date(nowMs));
  // the day it was sent, and no other: a load is a day's
  if (rec.day !== today) {
    console.warn(`[car-load] reply of another day driver=${rec.driverId} form=${rec.day} — nothing kept`);
    await say(CARLOAD_EXPIRED_TEXT);
    return { action: "expired" };
  }
  // a token is read once
  const claim = await claimButton(env, `cload_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[car-load] repeated token driver=${rec.driverId} — not kept again`);
    await say(CARLOAD_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const who: CarLoadWho = { partnerId: rec.driverId, name: rec.driver, whatsapp: to };
    const entries = readCarLoadValues(rec, msg.flow?.values ?? {});
    const typed: CarLoadInit = Object.fromEntries(entries.read.map((r) => [r.item.slot, { a: r.a, b: r.b }]));
    const used = async () => { await writeCarLoadToken(env, { ...rec, usedAt: nowMs }); await finishButton(env, claim, TOKEN_TTL); };
    /** The same form again, opened with what he wrote, under `text`; the text alone when the form cannot go. */
    const again = async (text: string) => {
      const r = await sendCarLoadForm(env, who, rec.moment, { now: nowMs, ctx, body: text, items: rec.items, pages: rec.pages, init: typed, loadedAt: rec.loadedAt, test: rec.test }).catch(() => ({ sent: false }));
      if (!r.sent) await say(text);
    };
    // one value that is not a quantity, or more left and damaged than was loaded: the whole form is refused
    if (entries.invalid.length || entries.over.length) {
      await used();
      await again(carLoadRefusalText(entries));
      return { action: "invalid" };
    }
    const onRecord = rec.test ? null : await readCarLoad(env, rec.day, rec.driverId);
    if (rec.moment === "morning") {
      const items: CarLoadEntry[] = entries.read.filter((r) => r.a > 0).map((r) => ({
        key: r.item.key, productId: r.item.productId, packagingId: r.item.packagingId, name: r.item.name, product: r.item.product, packaging: r.item.packaging, page: r.item.page, loaded: r.a,
      }));
      // after the evening count the load no longer changes
      if (onRecord?.count) {
        await used();
        await say(CARLOAD_CLOSED_TEXT);
        return { action: "closed" };
      }
      if (!items.length) {
        // nothing loaded: nothing kept, and the token stays usable
        await releaseButton(env, claim);
        await say(CARLOAD_EMPTY_TEXT);
        return { action: "empty" };
      }
      const day: CarLoadDay = { v: 1, day: rec.day, driverId: rec.driverId, driver: rec.driver, loadedAt: nowMs, items };
      if (rec.test) {
        await used();
        const t = loadConfirmText(day, { test: true });
        for (const p of [...t.parts, t.body]) await say(`${CARLOAD_TEST_MARK} — ${p}`);
        return { action: "test", items: items.length };
      }
      await writeCarLoad(env, day);
      await used();
      const t = loadConfirmText(day, { replacedAt: onRecord?.loadedAt });
      for (const p of t.parts) await say(p);
      await sendViaGateway(env, { purpose, to, content: buttonsContent(t.body, [carLoadEveningButton()]), ctx });
      await sendOwnerMessage(env, ownerLoadLine(day, { replacedAt: onRecord?.loadedAt }), CARLOAD_OWNER_PURPOSE);
      console.log(`[car-load] driver=${rec.driverId} ${rec.day} loaded ${items.length} item(s)${onRecord ? " (replaced)" : ""}`);
      return { action: "loaded", items: items.length };
    }
    // ---- the evening
    const count: CarLoadCount[] = entries.read.map((r) => ({ key: r.item.key, left: r.a, damaged: r.b }));
    // the load this form was made from was replaced (or is gone): its numbers are not this load's
    if (!onRecord || onRecord.loadedAt !== rec.loadedAt) {
      await used();
      if (onRecord) {
        const r = await sendCarLoadForm(env, who, "evening", { now: nowMs, ctx, body: `${CARLOAD_STALE_TEXT}\n${carLoadFormText("evening", rec.day)}` }).catch(() => ({ sent: false }));
        if (!r.sent) await say(CARLOAD_STALE_TEXT);
      } else {
        await say(CARLOAD_NO_LOAD_TEXT.replace(" 👇", ""));
      }
      return { action: "stale" };
    }
    const day: CarLoadDay = { ...onRecord, countedAt: nowMs, count };
    await writeCarLoad(env, day);
    await used();
    for (const p of countConfirmText(day, { replacedAt: onRecord.countedAt })) await say(p);
    // the day's deliveries, read now; unreadable: Baraa is told the count without the comparison
    let delivered: Delivered | null = null;
    try {
      delivered = await deliveredOn(env, rec.day);
    } catch (e) {
      console.warn(`[car-load] ${rec.day}: the deliveries could not be read — no comparison`, (e as Error)?.message);
    }
    for (const p of ownerCountText(day, delivered, { correctedAt: onRecord.countedAt })) await sendOwnerMessage(env, p, CARLOAD_OWNER_PURPOSE);
    const differences = delivered ? carLoadRows(day, delivered).filter((r) => Math.abs(r.diff) >= 0.005).length : null;
    console.log(`[car-load] driver=${rec.driverId} ${rec.day} counted ${count.length} item(s) differences=${differences ?? "not read"}`);
    return { action: "counted", items: count.length, differences };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE car-load form to Baraa's own number, marked «🧪 تجربة»: the morning form
 * over the active items, only while his window is open (nothing held), once a
 * day. His reply is answered with what would be kept, and keeps nothing.
 */
export async function sendCarLoadFormTest(env: Env, now: number = Date.now()): Promise<CarLoadFormResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  const claim = await claimButton(env, `cload_test:${CARLOAD_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    // his window closed: the form does not go (sendCarLoadForm), and the day's trial is not spent
    const r = await sendCarLoadForm(env, { partnerId: 0, name: "براء", whatsapp: owner }, "morning", { now, test: true });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
