// § 57 هـ (2026-10-05) — the customer's «⚠️ عندي ملاحظة»: what was wrong with an
// order delivered to him — which order and item, what kind of note, how much of
// it, a photo, a note — and Baraa's decision on it.
//
// It DEVELOPS the complaints of v6.3 (src/complaint.ts is still the entry;
// x_complaint and createComplaint in src/odoo-v6-append.ts are still where a
// complaint is kept): with an order delivered in the last seven days the
// customer now gets a form instead of «وصلنا ملاحظتك»; without one, or when the
// form cannot go, what the path did before stands, word for word.
//
// The Flow (utak_complaint_v1; scripts/lib/s57-complaint-flow.mjs is its JSON)
// is ONE screen with no endpoint — everything it shows goes with the message
// (flow_action navigate). A Flow without an endpoint cannot make one list
// depend on another, so the order and its item are ONE list.
//
//   • Three doors, all inside his 24h window (an interactive message: never a
//     template, never held): a text that holds a complaint's word («شكوى»,
//     «مشكلة», … — looksLikeComplaint); a text Claude reads as a complaint; the
//     button «⚠️ عندي ملاحظة» under the free text that tells him his order was
//     delivered (and the quick reply «عندي ملاحظة» of the older templates).
//   • The WORDS' door keeps what it always did for the record and for Baraa:
//     the row is made at once from his words and Baraa gets «شكوى جديدة»
//     (src/complaint.ts handleComplaint) — the form goes in place of the
//     apology line, its token holds that row, and «إرسال» FILLS that same row.
//     A form never sent back leaves the row and the alert: nothing is lost.
//     The two other doors made no row before, and make none until «إرسال».
//   • ONE form at a time: while a form sent to him in the last two hours has
//     not been sent back, no second one goes — a complaint in words takes the
//     old path whole, the button asks him to write it.
//   • «Delivered» = x_daily_order of THIS customer, delivered or closed, with
//     x_delivered_at in the last seven days; never a row flagged
//     x_utak_simulation or x_is_simulation. Its lines are the delivered ones
//     (not «unavailable», a quantity above zero). The newest order first, at
//     most sixty options. A number of a price source or a supplier
//     (src/price-privacy.ts) never gets the form.
//   • flow_token (cp1.…): one per send, kept in KV with the number AND the
//     orders it listed. A reply is read by the number it was sent to, once, and
//     against that list alone — so an order of another customer can never be
//     named. An order or item that was not listed, a kind that is not one of
//     the five, a quantity that is not a number > 0 with at most two decimals,
//     or more than was delivered of the item, no quantity for «تالف» / «ناقص» /
//     «جودة» on an item, no photo for «تالف» / «جودة»: the form is refused as a
//     whole — one message, with a fresh form — and nothing is written.
//   • «إرسال»: ONE x_complaint row — the one his words made, filled, else a
//     new one — (the order, the line and its item, x_kind and the older
//     x_type, the quantity, the photo in x_photo, his note and his words). A
//     photo that cannot be downloaded does not lose the note: it
//     is recorded without it, and Baraa reads that. The customer reads «وصلت
//     ملاحظتك رقم #… ونرد عليك اليوم»; Baraa gets the summary and the photo,
//     with «تعويض بالطلب القادم» / «إشعار دائن» / «رفض».
//   • A decision (Baraa's number alone, once): x_decision, x_decided_at, a line
//     in x_resolution_note and x_status — «رفض» closes it (dismissed), the two
//     others leave it «investigating». NOTHING else is written: the
//     compensation and the credit note are made by hand (STATUS § 4 item 7),
//     and Baraa's messages say so. The customer reads ONE fixed text a
//     decision; outside his window it waits for him.
//   • A second tap on any of the three buttons: «سبق تسجيله», nothing written.
//   • No price is read, kept or sent here: not the sale's, not the purchase's.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import type { RouterReply } from "./router";
import { call, stripRef } from "./odoo";
import {
  createComplaint, getComplaintBrief, getPartnerBasic, updateComplaintFromForm, writeComplaintDecision,
  type ComplaintBrief, type ComplaintDecision, type ComplaintKind, type ComplaintType,
} from "./odoo-v6-append";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton, type ButtonClaim } from "./button-lock";
import { odooUtcMs, odooUtcToRiyadhHHMM, riyadhDateKey, riyadhHHMM, toOdooUtc } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { parseCustodyAmount } from "./custody-form";
import { readReceiptPhotos } from "./receipt-form";
import { priceClosedNumber } from "./price-privacy";

/** utak_complaint_v1 at Meta (filled in once the Flow is created; a published Flow's JSON is frozen). */
export const COMPLAINT_FLOW_ID = "0";
export const COMPLAINT_FLOW_SCREEN = "COMPLAINT_A";
/** The form, and the answers to the customer's own «إرسال». */
export const COMPLAINT_PURPOSE = "customer_complaint_form";
/** Baraa's decision as the customer reads it (hours after his note, maybe outside his window). */
export const COMPLAINT_DECISION_PURPOSE = "customer_complaint_decision";
/** The note to Baraa with its three buttons, and what he reads after a tap (his number alone). */
export const COMPLAINT_OWNER_PURPOSE = "owner_complaint_notice";
/** The one trial to Baraa and its answers (his number alone). */
export const COMPLAINT_TEST_PURPOSE = "complaint_form_test";
/** The button under the free text that tells the customer his order was delivered. */
export const COMPLAINT_BUTTON = "complaint_start";
export const COMPLAINT_BUTTON_TITLE = "⚠️ عندي ملاحظة";
/** The quick reply of the older templates (the delivery's, the feedback's): its payload is its text. */
export const COMPLAINT_TEMPLATE_PAYLOAD = "عندي ملاحظة";
export const COMPLAINT_CTA = "عندي ملاحظة";
export const COMPLAINT_TITLE = "عندي ملاحظة";
export const COMPLAINT_TEST_MARK = "🧪 تجربة";
/** Baraa's three buttons: cmp_comp_<complaint> / cmp_credit_<complaint> / cmp_reject_<complaint>. */
export const COMPLAINT_DECISION_RE = /^cmp_(comp|credit|reject)_(\d+)$/;
/** An order is complained about for this many days after its delivery. */
export const COMPLAINT_DAYS = 7;
/** A form waits for his «إرسال» this long: until then no second one is sent to him. */
export const COMPLAINT_PENDING_SEC = 2 * 60 * 60;
/** The options one form lists (scripts/lib/s57-complaint-flow.mjs): the newest orders first. */
export const COMPLAINT_OPTIONS_MAX = 60;
/** The second half of an option's id for a note on the order as a whole. */
export const COMPLAINT_WHOLE_ID = "0";
export const COMPLAINT_WHOLE_TITLE = "الطلب كله";
/** Meta's limits: a heading, an option's title and description. */
export const COMPLAINT_HEADING_MAX = 80;
export const COMPLAINT_OPTION_TITLE_MAX = 30;
export const COMPLAINT_OPTION_DESCRIPTION_MAX = 300;
export const COMPLAINT_NOTE_MAX = 500;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Never «an order of his»: a trial's row, and every row the sim / pilot worker made. */
const SIM_FIELDS = ["x_utak_simulation", "x_is_simulation"] as const;
/** Delivered, and delivered then paid in full (src/invoice.ts closes it). */
const DELIVERED_STATES = ["delivered", "closed"];

// ---------------------------------------------------------------- the kinds and the decisions

/** x_complaint.x_kind as the customer reads it (scripts/lib/s57-odoo.mjs KIND_OPTIONS). */
export const KIND_LABEL: Record<ComplaintKind, string> = { damaged: "تالف", short: "ناقص", quality: "جودة", delay: "تأخير", other: "أخرى" };
/** The form's kind → the older x_type, still written (scripts/lib/s57-odoo.mjs KIND_TO_TYPE). */
export const KIND_TO_TYPE: Record<ComplaintKind, ComplaintType> = { damaged: "quality", short: "quantity", quality: "quality", delay: "delay", other: "other" };
/** A note of these kinds on an item says how much of it. */
const QTY_KINDS: ReadonlySet<string> = new Set(["damaged", "short", "quality"]);
/** A note of these kinds is not taken without a photo. */
const PHOTO_KINDS: ReadonlySet<string> = new Set(["damaged", "quality"]);
/** A complaint closed in Odoo takes no decision from WhatsApp. */
const CLOSED_STATUS: ReadonlySet<string> = new Set(["resolved", "dismissed"]);

export type DecisionKey = "comp" | "credit" | "reject";
/** Baraa's three buttons, in their order: what each writes in x_decision, and its title (twenty characters at Meta). */
export const COMPLAINT_DECISIONS: Record<DecisionKey, { value: ComplaintDecision; title: string }> = {
  comp: { value: "compensate_next", title: "تعويض بالطلب القادم" },
  credit: { value: "credit_note", title: "إشعار دائن" },
  reject: { value: "rejected", title: "رفض" },
};

// ---------------------------------------------------------------- texts

/** «إرسال» was read and the note is on record. */
export const complaintReceivedText = (id: number): string => `وصلت ملاحظتك رقم #${id} ونرد عليك اليوم`;
/** The ONE fixed text the customer reads for each decision. */
export function complaintDecisionText(decision: ComplaintDecision, id: number): string {
  if (decision === "compensate_next") return `ملاحظتك رقم #${id}: نعوّضك عنها مع طلبك القادم ✅ ونعتذر منك.`;
  if (decision === "credit_note") return `ملاحظتك رقم #${id}: نخصم قيمتها من حسابك بإشعار دائن ✅ ونعتذر منك.`;
  return `ملاحظتك رقم #${id}: راجعناها وما قدرنا نعتمدها. لو عندك توضيح أو صورة ثانية أرسلها لنا.`;
}
/** What Baraa still does by hand after each decision. */
export const COMPLAINT_AFTER_TEXT: Record<ComplaintDecision, string> = {
  compensate_next: "⚠️ التعويض لا يُضاف آلياً: أضفه بنفسك لطلبه القادم، ثم أغلق الملاحظة في Odoo.",
  credit_note: "⚠️ الإشعار الدائن لا يصدر آلياً: أصدره يدوياً من Odoo (الدليل: «الإشعار الدائن»)، ثم أغلق الملاحظة.",
  rejected: "أُغلقت الملاحظة في Odoo (مرفوضة).",
};
export const COMPLAINT_MANUAL_TEXT = "التعويض والإشعار الدائن لا ينفّذهما النظام: الزر يسجّل قرارك ويبلّغ العميل فقط، والتنفيذ يدوي (الدليل: «الإشعار الدائن»).";
export const COMPLAINT_ALREADY_TEXT = "سبق تسجيله";
export const COMPLAINT_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «شكوى» ونرسل لك نموذجاً جديداً.";
export const COMPLAINT_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. لملاحظة جديدة اكتب «شكوى».";
/** The button with no order delivered in seven days, or a form that cannot go: he writes it, and the old path takes it. */
export const COMPLAINT_WRITE_TEXT = "تفضّل، اكتب لي ملاحظتك بالتفصيل وسنراجعها فوراً 🙏";
export const COMPLAINT_SORRY_TEXT = "نعتذر عن الإزعاج 🙏 عشان نتابع ملاحظتك صح:";
export const COMPLAINT_HOW_TEXT = "اختر الطلب والصنف ونوع الملاحظة. الكمية للتالف والناقص والجودة، والصورة إلزامية للتالف والجودة. ثم «إرسال».";
export const COMPLAINT_BAD_ITEM_TEXT = "اختر الطلب والصنف من القائمة.";
export const COMPLAINT_BAD_KIND_TEXT = "اختر نوع الملاحظة: تالف، ناقص، جودة، تأخير، أو أخرى.";
export const COMPLAINT_BAD_QTY_TEXT = "الكمية المتأثرة رقم أكبر من صفر، بخانتين عشريتين على الأكثر.";
export const COMPLAINT_NEED_QTY_TEXT = "اكتب الكمية المتأثرة: مطلوبة للتالف والناقص والجودة.";
export const COMPLAINT_NO_PHOTO_TEXT = "أرفق صورة: إلزامية للتالف والجودة.";
export const complaintOverText = (qty: number, delivered: number): string => `الكمية المتأثرة (${fmtQty(qty)}) أكثر من المسلَّم من الصنف (${fmtQty(delivered)}).`;
/** Why a form was refused, by its problem («over» names its two quantities: complaintOverText). */
const REASONS: Record<string, string> = {
  item: COMPLAINT_BAD_ITEM_TEXT, kind: COMPLAINT_BAD_KIND_TEXT, qty: COMPLAINT_BAD_QTY_TEXT, need_qty: COMPLAINT_NEED_QTY_TEXT, photo: COMPLAINT_NO_PHOTO_TEXT,
};
export const COMPLAINT_RETRY_TEXT = "تعذّر تسجيل ملاحظتك الآن. اضغط «إرسال» في النموذج مرة ثانية بعد قليل.";
export const COMPLAINT_DECISION_RETRY_TEXT = "تعذّر تسجيل القرار الآن. اضغط الزر مرة ثانية بعد قليل.";
export const COMPLAINT_PHOTO_LOST_TEXT = "⚠️ تعذّر تحميل صورته: الملاحظة مسجّلة في Odoo بلا صورة.";
export const COMPLAINT_NO_IMAGE_TEXT = "(الصورة لم تُرفق هنا: تجدها على الملاحظة في Odoo)";
export const complaintGoneText = (id: number): string => `الملاحظة #${id} غير موجودة في Odoo: لم يُسجَّل شيء.`;
export const complaintClosedText = (id: number): string => `الملاحظة #${id} مغلقة في Odoo: لم يُسجَّل قرار، ولم يُبلَّغ العميل.`;

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const oneLine = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
/** «3» / «2.5»: a quantity as it is read. */
const fmtQty = (n: number): string => String(Math.round(n * 100) / 100);
export const complaintStartButton = (): { id: string; title: string } => ({ id: COMPLAINT_BUTTON, title: COMPLAINT_BUTTON_TITLE });

// ---------------------------------------------------------------- his delivered orders

type M2O = [number, string] | false;
const m2oId = (v: M2O): number => (Array.isArray(v) ? v[0] : 0);
const m2oName = (v: M2O): string => (Array.isArray(v) ? stripRef(v[1]) : "");

export interface DeliveredLine {
  id: number;
  productId: number;
  product: string;
  packaging: string;
  /** x_quantity: what was DELIVERED of it (§ 55). */
  quantity: number;
}
export interface DeliveredOrder {
  id: number;
  /** The Riyadh day it was delivered, YYYY-MM-DD. */
  day: string;
  customerId: number;
  customer: string;
  /** Its delivered lines, in the order's own line order. */
  lines: DeliveredLine[];
}

/**
 * Delivered orders, the newest first, each with its delivered lines: of one
 * customer since a moment (his form), or the latest of anyone (the trial's
 * row). Never a simulation's by either flag — unless `simulation` asks for
 * exactly those (the trial, when nothing real was ever delivered). Read-only.
 * Throws on Odoo trouble.
 */
export async function deliveredOrders(env: Env, q: { partnerId?: number; sinceMs?: number; simulation?: boolean; limit?: number } = {}): Promise<DeliveredOrder[]> {
  type Order = { id: number; x_customer_id: M2O; x_delivered_at: string };
  const orders = await call<Order[]>(env, "x_daily_order", "search_read", {
    domain: [
      // an order with no delivery moment has no day to show, and sorts first in a descending read
      ["x_state", "in", DELIVERED_STATES], ["x_delivered_at", "!=", false],
      ...(q.simulation ? ["|", [SIM_FIELDS[0], "=", true], [SIM_FIELDS[1], "=", true]] : SIM_FIELDS.map((f) => [f, "!=", true])),
      ...(q.partnerId ? [["x_customer_id", "=", q.partnerId]] : []),
      ...(q.sinceMs !== undefined ? [["x_delivered_at", ">=", toOdooUtc(q.sinceMs)]] : []),
    ],
    fields: ["id", "x_customer_id", "x_delivered_at"], order: "x_delivered_at desc, id desc", limit: q.limit ?? 200,
  });
  if (!orders.length) return [];
  type Line = { id: number; x_order_id: M2O; x_product_tmpl_id: M2O; x_packaging_id: M2O; x_quantity: number | false; x_status: string | false };
  const lines = await call<Line[]>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", orders.map((o) => o.id)]],
    fields: ["id", "x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status"], order: "id asc", limit: 5000,
  });
  const byOrder = new Map<number, DeliveredLine[]>();
  for (const l of lines) {
    // a line he did not get (§ 55: «unavailable», or nothing delivered of it) is not one to complain about
    if (l.x_status === "unavailable" || !(Number(l.x_quantity) > 0)) continue;
    const list = byOrder.get(m2oId(l.x_order_id)) ?? [];
    list.push({ id: l.id, productId: m2oId(l.x_product_tmpl_id), product: m2oName(l.x_product_tmpl_id), packaging: m2oName(l.x_packaging_id), quantity: Number(l.x_quantity) });
    byOrder.set(m2oId(l.x_order_id), list);
  }
  return [...orders]
    // the newest first, whatever order Odoo hands them in
    .sort((a, b) => b.x_delivered_at.localeCompare(a.x_delivered_at))
    .map((o): DeliveredOrder => ({
      id: o.id, day: riyadhDateKey(new Date(odooUtcMs(o.x_delivered_at))), customerId: m2oId(o.x_customer_id), customer: Array.isArray(o.x_customer_id) ? oneLine(o.x_customer_id[1]) : "",
      lines: (byOrder.get(o.id) ?? []).sort((a, b) => a.id - b.id),
    }));
}

/**
 * The orders one form lists: the newest first, each WHOLE (its «الطلب كله» and
 * every line) while the options fit — an order that does not fit, and every
 * older one, is left out. The newest alone is cut to fit, so a form always
 * lists something.
 */
export function offeredOrders(orders: DeliveredOrder[], max: number = COMPLAINT_OPTIONS_MAX): DeliveredOrder[] {
  const out: DeliveredOrder[] = [];
  let used = 0;
  for (const o of orders) {
    if (!out.length) { out.push({ ...o, lines: o.lines.slice(0, max - 1) }); used = 1 + out[0].lines.length; continue; }
    if (used + 1 + o.lines.length > max) break;
    out.push(o);
    used += 1 + o.lines.length;
  }
  return out;
}

export interface ComplaintOption { id: string; title: string; description: string }
/** «طماطم (كرتون)»: an item with its packaging. */
export const itemName = (l: Pick<DeliveredLine, "product" | "packaging">): string => `${l.product}${l.packaging ? ` (${l.packaging})` : ""}`;
/**
 * The list's options: under each order, the newest first, «#<order> · الطلب
 * كله» and then a line an item. A title holds thirty characters: the order's
 * number comes first, so the item's name is the part that is cut.
 */
export function complaintOptions(orders: DeliveredOrder[], o: { withCustomer?: boolean } = {}): ComplaintOption[] {
  return orders.flatMap((order) => {
    const head = `#${order.id} · `;
    // the trial lists another customer's order (or a sample): each option says whose it is
    const where = [`الطلب #${order.id}`, ...(o.withCustomer && order.customer ? [order.customer] : []), `سُلّم ${arabicDate(order.day)}`];
    return [
      {
        id: `${order.id}:${COMPLAINT_WHOLE_ID}`, title: `${head}${COMPLAINT_WHOLE_TITLE}`,
        description: cut([...where, `عدد الأصناف ${order.lines.length}`, "لملاحظة ليست على صنف بعينه (مثل التأخير)"].join(" — "), COMPLAINT_OPTION_DESCRIPTION_MAX),
      },
      ...order.lines.map((l) => ({
        id: `${order.id}:${l.id}`, title: cut(`${head}${l.product}`, COMPLAINT_OPTION_TITLE_MAX),
        description: cut([itemName(l), ...where, `الكمية ${fmtQty(l.quantity)}`].join(" — "), COMPLAINT_OPTION_DESCRIPTION_MAX),
      })),
    ];
  });
}

// ---------------------------------------------------------------- the reply's fields

/** The option he chose, against the orders the form listed: null for anything that was not one of them. */
export function chosenItem(raw: unknown, orders: DeliveredOrder[]): { order: DeliveredOrder; line: DeliveredLine | null } | null {
  const m = /^(\d+):(\d+)$/.exec(typeof raw === "string" ? raw : "");
  const order = m ? orders.find((o) => String(o.id) === m[1]) : undefined;
  if (!m || !order) return null;
  if (m[2] === COMPLAINT_WHOLE_ID) return { order, line: null };
  const line = order.lines.find((l) => String(l.id) === m[2]);
  return line ? { order, line } : null;
}
/** «نوع الملاحظة»: one of the Flow's five ids. */
export const parseComplaintKind = (raw: unknown): ComplaintKind | "invalid" => (typeof raw === "string" && Object.hasOwn(KIND_LABEL, raw) ? (raw as ComplaintKind) : "invalid");
/** «الكمية المتأثرة»: null when the field was left empty; else a number > 0 with at most two decimals. */
export function parseAffectedQty(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = parseCustodyAmount(raw);
  return n === "invalid" || !(n > 0) ? "invalid" : n;
}
/** x_message_text: his note, then what he wrote before the form (when it answered a text). */
export const complaintMessageText = (note: string, words?: string): string => [note, ...(words ? [`رسالته قبل النموذج: «${words}»`] : [])].filter(Boolean).join("\n");

// ---------------------------------------------------------------- flow_token

export interface ComplaintToken {
  v: 1;
  token: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  name: string;
  createdAt: number;
  /** The orders the form listed: the only ones its reply may name. */
  orders: DeliveredOrder[];
  /** His own message, when the form answered a text: written with the form's note. */
  words?: string;
  /** The x_complaint his words already made (the keyword's door): «إرسال» fills it, and makes no second one. */
  complaintId?: number;
  /** The trial to Baraa: its reply writes nothing. */
  test?: boolean;
  usedAt?: number;
}
export const complaintTokenKey = (token: string): string => `complaint_t:v1:${token}`;
export const isComplaintToken = (token: string): boolean => String(token ?? "").startsWith("cp1.");
export function newComplaintToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cp1.${partnerId}.${rand}`;
}
export async function readComplaintToken(env: Env, token: string): Promise<ComplaintToken | null> {
  try {
    const raw = await env.MSG_DEDUP.get(complaintTokenKey(token));
    return raw ? (JSON.parse(raw) as ComplaintToken) : null;
  } catch { return null; }
}
async function writeComplaintToken(env: Env, rec: ComplaintToken): Promise<void> {
  await env.MSG_DEDUP.put(complaintTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}
/** The last form sent to a customer (its token), by his partner. */
export const complaintPendingKey = (partnerId: number): string => `complaint_pending:v1:${partnerId}`;
/** A form sent to him in the last two hours that he has not sent back (a refused one is sent back too). */
async function pendingForm(env: Env, partnerId: number, now: number): Promise<boolean> {
  try {
    const token = await env.MSG_DEDUP.get(complaintPendingKey(partnerId));
    const rec = token ? await readComplaintToken(env, token) : null;
    return !!rec && !rec.usedAt && now - rec.createdAt < COMPLAINT_PENDING_SEC * 1000;
  } catch { return false; }
}

// ---------------------------------------------------------------- the send

export interface ComplaintWho { partnerId: number; name: string; whatsapp: string }
export interface ComplaintFormOpts {
  now?: number;
  /** The text above the button (a refusal's reasons): else the form's own. */
  body?: string;
  /** The orders it lists, when the caller already holds them (a form sent again; the trial's row). */
  orders?: DeliveredOrder[];
  /** His own message, when the form answers a text. */
  words?: string;
  /** The x_complaint his words already made: the form's «إرسال» fills it. */
  complaintId?: number;
  /** What the two texts open with: what he wrote on a form that was refused. */
  init?: { qty?: string; note?: string };
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface ComplaintFormResult { sent: boolean; reason?: string; token?: string; options?: number }

/** The screen's five keys. */
export function complaintData(who: ComplaintWho, orders: DeliveredOrder[], o: Pick<ComplaintFormOpts, "init" | "test"> = {}): Record<string, unknown> {
  const mark = o.test ? `${COMPLAINT_TEST_MARK} — ` : "";
  return {
    t: cut(`${mark}${COMPLAINT_TITLE} — ${who.name}`, COMPLAINT_HEADING_MAX),
    how: COMPLAINT_HOW_TEXT,
    items: complaintOptions(orders, { withCustomer: o.test }),
    qty: o.init?.qty ?? "",
    note: o.init?.note ?? "",
  };
}
export function complaintSession(text: string, token: string, data: Record<string, unknown>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: COMPLAINT_FLOW_ID,
            flow_cta: COMPLAINT_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: COMPLAINT_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}
/** The text above the form's button: an apology first when it answers what he wrote. */
export function complaintFormText(o: Pick<ComplaintFormOpts, "words"> = {}): string {
  return [o.words ? COMPLAINT_SORRY_TEXT : `⚠️ ${COMPLAINT_TITLE}`, `اضغط «${COMPLAINT_CTA}»: ${COMPLAINT_HOW_TEXT}`].join("\n");
}

/**
 * One complaint form: the interactive message, inside the number's window
 * only. Nothing is held and no template is used. Not sent — and it says why —
 * to a number of a price source or a supplier, outside the window, to a
 * customer who still has a form of the last two hours to send back, or to one
 * with no order delivered in the last seven days. Throws on Odoo trouble (the
 * caller does what it did before).
 */
export async function sendComplaintForm(env: Env, who: ComplaintWho, opts: ComplaintFormOpts = {}): Promise<ComplaintFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  // a customer's form: never to a price source or a supplier, whatever partner the caller named
  if (!opts.test && (await priceClosedNumber(env, to))) return { sent: false, reason: "closed_number" };
  const now = opts.now ?? Date.now();
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  // ONE form at a time: his next complaint is not answered with a second one while the first waits
  if (await pendingForm(env, who.partnerId, now)) return { sent: false, reason: "pending_form" };
  const orders = offeredOrders(opts.orders ?? (await deliveredOrders(env, { partnerId: who.partnerId, sinceMs: now - COMPLAINT_DAYS * DAY_MS })));
  if (!orders.length) return { sent: false, reason: "no_delivered_order" };
  const rec: ComplaintToken = {
    v: 1, token: newComplaintToken(who.partnerId), to, partnerId: who.partnerId, name: who.name, createdAt: now, orders,
    ...(opts.words ? { words: opts.words } : {}), ...(opts.complaintId ? { complaintId: opts.complaintId } : {}), ...(opts.test ? { test: true } : {}),
  };
  await writeComplaintToken(env, rec);
  const mark = opts.test ? `${COMPLAINT_TEST_MARK} — ` : "";
  const data = complaintData(who, orders, opts);
  const res = await sendViaGateway(env, {
    purpose: opts.test ? COMPLAINT_TEST_PURPOSE : COMPLAINT_PURPOSE,
    to,
    content: complaintSession(`${mark}${opts.body ?? complaintFormText(opts)}`, rec.token, data),
    noHold: true,
    noHoldReason: "نموذج الملاحظة يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(complaintTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  await env.MSG_DEDUP.put(complaintPendingKey(who.partnerId), rec.token, { expirationTtl: COMPLAINT_PENDING_SEC });
  return { sent: true, token: rec.token, options: (data.items as ComplaintOption[]).length };
}

// ---------------------------------------------------------------- the doors

async function tell(env: Env, to: string, text: string, ctx?: ExecutionContext, purpose: string = COMPLAINT_PURPOSE): Promise<void> {
  await sendViaGateway(env, { purpose, to, content: textContent(text), ctx });
}

/** The form for a customer with a note. Never throws: what could not go is a reason, and the caller's old answer stands. */
export async function offerComplaintForm(env: Env, who: ComplaintWho, opts: ComplaintFormOpts = {}): Promise<ComplaintFormResult> {
  try {
    return await sendComplaintForm(env, who, opts);
  } catch (e) {
    console.warn("[complaint] the form could not be sent", (e as Error)?.message);
    return { sent: false, reason: "error" };
  }
}

/** «⚠️ عندي ملاحظة» under the delivery's text: the form; with no order delivered in seven days, a form still waiting for him, or one that cannot go, he is asked to write it. */
export async function answerComplaintButton(env: Env, partner: { id: number; name?: string; x_whatsapp_number?: string | false | null } | null): Promise<RouterReply> {
  const number = String(partner?.x_whatsapp_number || "");
  if (!partner?.id || !number) return { text: COMPLAINT_WRITE_TEXT };
  const r = await offerComplaintForm(env, { partnerId: partner.id, name: partner.name || "", whatsapp: number });
  return { text: r.sent ? "" : COMPLAINT_WRITE_TEXT };
}

// ---------------------------------------------------------------- «إرسال»

export interface ComplaintSummary {
  id: number;
  name: string;
  order: DeliveredOrder;
  /** Null: the order as a whole. */
  line: DeliveredLine | null;
  kind: ComplaintKind;
  qty: number | null;
  note: string;
  words?: string;
  /** A photo came with the form and could not be downloaded. */
  photoLost?: boolean;
}
/**
 * Baraa's message: the customer, the order and its delivery day, the item, the
 * kind, the quantity, the note — and ONE line saying the compensation and the
 * credit note are made by hand. Each free part is cut, so the whole stays
 * within a button message's 1024 characters with its last two lines whole.
 */
export function ownerComplaintText(c: ComplaintSummary): string {
  return [
    `⚠️ ملاحظة عميل #${c.id} — ${cut(c.name, 60)}`,
    `الطلب: #${c.order.id} — سُلّم ${arabicDate(c.order.day)}`,
    `الصنف: ${c.line ? `${cut(itemName(c.line), 80)} — المسلَّم ${fmtQty(c.line.quantity)}` : COMPLAINT_WHOLE_TITLE}`,
    `النوع: ${KIND_LABEL[c.kind]}`,
    `الكمية المتأثرة: ${c.qty !== null ? fmtQty(c.qty) : "لم تُذكر"}`,
    ...(c.note ? [`ملاحظته: ${cut(c.note, 250)}`] : []),
    ...(c.words ? [`رسالته: «${cut(oneLine(c.words), 150)}»`] : []),
    ...(c.photoLost ? [COMPLAINT_PHOTO_LOST_TEXT] : []),
    COMPLAINT_MANUAL_TEXT,
    "قرارك؟ 👇",
  ].join("\n");
}
function ownerNoticeSession(id: number, text: string, mediaId: string | null): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "button",
        ...(mediaId ? { header: { type: "image", image: { id: mediaId } } } : {}),
        body: { text },
        action: { buttons: (Object.keys(COMPLAINT_DECISIONS) as DecisionKey[]).map((k) => ({ type: "reply", reply: { id: `cmp_${k}_${id}`, title: COMPLAINT_DECISIONS[k].title } })) },
      },
    },
  };
}
/** The note to Baraa: with the photo as its header (the media Meta already holds), and without it when Meta refuses that. */
async function sendOwnerNotice(env: Env, id: number, text: string, mediaId: string | null, ctx?: ExecutionContext): Promise<void> {
  const owner = String(env.OWNER_WHATSAPP ?? "");
  const res = await sendViaGateway(env, { purpose: COMPLAINT_OWNER_PURPOSE, to: owner, content: ownerNoticeSession(id, text, mediaId), ctx });
  if (!mediaId || gatewayDecision(res)?.action !== "rejected") return;
  console.warn(`[complaint] #${id}: Meta refused the photo as a header — sent without it`);
  await sendViaGateway(env, { purpose: COMPLAINT_OWNER_PURPOSE, to: owner, content: ownerNoticeSession(id, `${text}\n${COMPLAINT_NO_IMAGE_TEXT}`, null), ctx });
}

export interface ComplaintOutcome {
  action: "recorded" | "invalid" | "test" | "unknown" | "duplicate" | "error";
  complaintId?: number;
  problems?: string[];
}

/** What a trial's «إرسال» would have recorded, had it been a customer's. */
export function trialText(c: Omit<ComplaintSummary, "id" | "name" | "words" | "photoLost"> & { photo: boolean }): string {
  return [
    `${COMPLAINT_TEST_MARK} — وصلت الملاحظة ✅`,
    "لو كانت ملاحظة عميل لسُجّلت شكوى في Odoo:",
    `• الطلب #${c.order.id} — سُلّم ${arabicDate(c.order.day)}`,
    `• الصنف: ${c.line ? itemName(c.line) : COMPLAINT_WHOLE_TITLE}`,
    `• النوع: ${KIND_LABEL[c.kind]}`,
    `• الكمية المتأثرة: ${c.qty !== null ? fmtQty(c.qty) : "لم تُذكر"}`,
    ...(c.photo ? ["📸 صورة النموذج كانت ستُحفظ مع الملاحظة."] : []),
    ...(c.note ? [`ملاحظتك: ${c.note}`] : []),
    `وكان سيصلك ملخصها بأزرار ${Object.values(COMPLAINT_DECISIONS).map((d) => `«${d.title}»`).join(" و")}.`,
    "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)",
  ].join("\n");
}

/**
 * A reply of the complaint form (nfm_reply): read, checked against its token
 * and the orders it listed, recorded, and sent to Baraa. A reply that could
 * not be recorded says so, and its token is his to send again.
 */
export async function handleComplaintReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<ComplaintOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? COMPLAINT_TEST_PURPOSE : COMPLAINT_PURPOSE;
  const say = (text: string) => tell(env, to, text, ctx, purpose);
  const rec = await readComplaintToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[complaint] reply with no token of this number from=${to.slice(-4)}`);
    await say(COMPLAINT_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  // a token is read once
  const claim = await claimButton(env, `complaint_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[complaint] repeated token partner=${rec.partnerId} — not recorded again`);
    await say(COMPLAINT_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const who: ComplaintWho = { partnerId: rec.partnerId, name: rec.name, whatsapp: to };
    const values = msg.flow?.values ?? {};
    // against the orders the form listed — never the client's word for what an order or a line is
    const chosen = chosenItem(values.item, rec.orders), kind = parseComplaintKind(values.kind), qty = parseAffectedQty(values.qty);
    const note = cut(oneLine(values.note), COMPLAINT_NOTE_MAX);
    const [photo] = readReceiptPhotos(values.photo);
    const line = chosen?.line ?? null;
    const used = async () => { await writeComplaintToken(env, { ...rec, usedAt: nowMs }); await finishButton(env, claim, TOKEN_TTL); };

    const problems = [
      ...(!chosen ? ["item"] : []),
      ...(kind === "invalid" ? ["kind"] : []),
      ...(qty === "invalid" ? ["qty"] : line && qty !== null && qty > line.quantity ? ["over"] : line && qty === null && QTY_KINDS.has(kind) ? ["need_qty"] : []),
      ...(!photo && PHOTO_KINDS.has(kind) ? ["photo"] : []),
    ];
    if (problems.length) {
      await used();
      const why = (p: string): string => (p === "over" ? complaintOverText(qty as number, (line as DeliveredLine).quantity) : REASONS[p]);
      const text = ["⚠️ ما انحفظت ملاحظتك:", ...problems.map((p) => `• ${why(p)}`), "عبّ النموذج من جديد ثم «إرسال» 👇"].join("\n");
      // the fresh form lists the same orders and opens the two texts on what he wrote (a list's choice and a photo cannot be put back)
      const init = { qty: typeof qty === "number" ? fmtQty(qty) : "", note };
      const r = await sendComplaintForm(env, who, { now: nowMs, ctx, body: text, orders: rec.orders, words: rec.words, complaintId: rec.complaintId, init, test: rec.test }).catch(() => ({ sent: false }));
      if (!r.sent) await say(text);
      return { action: "invalid", problems };
    }
    // no problem = every field was read: `problems` above is the one check of each
    const picked = chosen as NonNullable<typeof chosen>, k = kind as ComplaintKind, amount = qty as number | null;
    if (rec.test) {
      await used();
      await say(trialText({ order: picked.order, line, kind: k, qty: amount, note, photo: !!photo }));
      return { action: "test" };
    }

    // ---- a complaint: the photo as a file, then the row, the customer, Baraa
    const { downloadMedia } = await import("./supplier-pay");
    const file = photo ? await downloadMedia(env, photo.id) : null;
    const fields = {
      orderId: picked.order.id, type: KIND_TO_TYPE[k],
      text: complaintMessageText(note, rec.words), kind: k,
      ...(line ? { orderLineId: line.id, productId: line.productId } : {}),
      ...(amount !== null ? { affectedQty: amount } : {}),
      ...(file ? { photoBase64: file.base64 } : {}),
    };
    // the row his words made when the form went (the keyword's door) is the one filled — never a second one
    let id = rec.complaintId ?? null;
    if (id) await updateComplaintFromForm(env, id, fields);
    else id = await createComplaint(env, { customerId: rec.partnerId, severity: "medium", ...fields });
    if (!id) throw new Error("x_complaint was not created");
    await used();
    await say(complaintReceivedText(id));
    const photoLost = !!photo && !file;
    // the photo as the message's header only when it was downloaded: one Meta could not hand over is not one it will show
    await sendOwnerNotice(env, id, ownerComplaintText({ id, name: rec.name, order: picked.order, line, kind: k, qty: amount, note, words: rec.words, photoLost }), photo && file ? photo.id : null, ctx);
    console.log(`[complaint] #${id} partner=${rec.partnerId} order=${picked.order.id} line=${line?.id ?? "-"} kind=${k} qty=${amount ?? "-"}${photo ? (file ? " photo" : " (photo not downloaded)") : ""}`);
    return { action: "recorded", complaintId: id };
  } catch (e) {
    // nothing was recorded: the token is his to send again
    await releaseButton(env, claim);
    console.error(`[complaint] the reply of partner=${rec.partnerId} was not recorded`, (e as Error)?.message);
    try { await say(COMPLAINT_RETRY_TEXT); } catch { /* nothing more to say */ }
    return { action: "error" };
  }
}

// ---------------------------------------------------------------- Baraa's decision

export interface ComplaintDecisionOutcome {
  action: "decided" | "duplicate" | "closed" | "unknown" | "error";
  complaintId: number;
  decision?: ComplaintDecision;
}

const decisionTitle = (v: ComplaintDecision | ""): string => Object.values(COMPLAINT_DECISIONS).find((d) => d.value === v)?.title ?? "";
/** «سبق تسجيله», and what was decided when it is known. */
export function alreadyText(c: ComplaintBrief): string {
  return c.decision ? `${COMPLAINT_ALREADY_TEXT}: «${decisionTitle(c.decision)}» الساعة ${odooUtcToRiyadhHHMM(c.decidedAt)} — الملاحظة #${c.id}، ${c.customer}` : COMPLAINT_ALREADY_TEXT;
}
/** The line a decision adds to x_resolution_note. */
export const resolutionLine = (decision: ComplaintDecision, nowMs: number): string =>
  `${riyadhDateKey(new Date(nowMs))} ${riyadhHHMM(new Date(nowMs))} — قرار براء من واتساب: ${decisionTitle(decision)}${decision === "rejected" ? "" : " (التنفيذ يدوي)"}`;
/** What Baraa reads after a decision. */
export function decidedText(c: ComplaintBrief, decision: ComplaintDecision): string {
  return [
    `✅ سُجّل قرارك على الملاحظة #${c.id} (${c.customer}): ${decisionTitle(decision)}.`,
    `أُبلغ العميل: «${complaintDecisionText(decision, c.id)}»`,
    COMPLAINT_AFTER_TEXT[decision],
  ].join("\n");
}

/**
 * «تعويض بالطلب القادم» / «إشعار دائن» / «رفض» under a customer's note. Baraa's
 * number alone (null for any other: the caller answers as it does a button it
 * does not know), and once: a second tap on ANY of the three reads «سبق
 * تسجيله» and writes nothing. It writes the decision on the complaint and
 * tells the customer — no order line, no credit note, no payment. Never
 * throws: a tap that could not finish is released and says so.
 */
export async function handleComplaintDecision(env: Env, buttonId: string, from: string, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<ComplaintDecisionOutcome | null> {
  const m = COMPLAINT_DECISION_RE.exec(String(buttonId ?? ""));
  if (!m || !isOwnerRecipient(env, from)) return null;
  const decision = COMPLAINT_DECISIONS[m[1] as DecisionKey].value, id = Number(m[2]);
  const say = (text: string) => tell(env, from, text, ctx, COMPLAINT_OWNER_PURPOSE);
  let claim: ButtonClaim | null = null;
  try {
    const c = await getComplaintBrief(env, id);
    if (!c) {
      await say(complaintGoneText(id));
      return { action: "unknown", complaintId: id };
    }
    // closed by hand in Odoo with no decision from here: one now would reopen it, and write to the customer about it
    if (!c.decision && CLOSED_STATUS.has(c.status)) {
      await say(complaintClosedText(id));
      return { action: "closed", complaintId: id };
    }
    // ONE lock for the three buttons: «تعويض» then «رفض» is a second tap too
    claim = await claimButton(env, `complaint_decide:${id}`);
    if (!claim.claimed || c.decision) {
      console.warn(`[complaint] #${id}: repeated tap (${decision}) — nothing written`);
      await say(alreadyText(c));
      return { action: "duplicate", complaintId: id };
    }
    // his number before anything is written: a read that fails leaves the tap as if it never was
    const customer = await getPartnerBasic(env, c.customerId);
    await writeComplaintDecision(env, id, { decision, atMs: nowMs, resolutionNote: [c.resolutionNote, resolutionLine(decision, nowMs)].filter(Boolean).join("\n") });
    await finishButton(env, claim);
    await tell(env, String(customer?.whatsapp || customer?.phone || ""), complaintDecisionText(decision, id), ctx, COMPLAINT_DECISION_PURPOSE);
    await say(decidedText(c, decision));
    console.log(`[complaint] #${id}: ${decision} — recorded, the customer told`);
    return { action: "decided", complaintId: id, decision };
  } catch (e) {
    if (claim) await releaseButton(env, claim);
    console.error(`[complaint] #${id}: the decision (${decision}) did not finish`, (e as Error)?.message);
    try { await say(COMPLAINT_DECISION_RETRY_TEXT); } catch { /* nothing more to say */ }
    return { action: "error", complaintId: id };
  }
}

// ---------------------------------------------------------------- the trial to Baraa

export const COMPLAINT_TEST_REAL_TEXT = "الطلب في النموذج حقيقي ومسلَّم (للقراءة فقط): لا يُسجَّل عليه شيء.";
export const COMPLAINT_TEST_SIM_TEXT = "الطلب في النموذج من سجلات المحاكاة (للقراءة فقط): لا يُسجَّل عليه شيء.";
export const COMPLAINT_TEST_SAMPLE_TEXT = "الطلب في النموذج عيّنة، ليس طلباً حقيقياً.";
/** An order that is no one's, saying so: what the trial shows when nothing was ever delivered. */
export function sampleOrders(day: string): DeliveredOrder[] {
  return [{
    id: 1, day, customerId: 0, customer: "عيّنة للتجربة، ليست طلباً",
    lines: [{ id: 1, productId: 0, product: "عيّنة 1", packaging: "كرتون", quantity: 3 }, { id: 2, productId: 0, product: "عيّنة 2", packaging: "كرتون", quantity: 5 }],
  }];
}

/**
 * ONE complaint form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. It lists the latest real
 * delivered order (read-only); with none, the latest one flagged as a
 * simulation; with none, a sample said to be one. His «إرسال» is answered with
 * what would have been recorded: nothing is written, and nobody else is told.
 */
export async function sendComplaintFormTest(env: Env, now: number = Date.now()): Promise<ComplaintFormResult> {
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `complaint_test:${COMPLAINT_FLOW_ID}:${day}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const real = await deliveredOrders(env, { limit: 1 }).catch(() => []);
    const sim = real.length ? [] : await deliveredOrders(env, { simulation: true, limit: 1 }).catch(() => []);
    // his window closed: the form does not go (sendComplaintForm), and the day's trial is not spent
    const r = await sendComplaintForm(env, { partnerId: 0, name: "براء", whatsapp: String(env.OWNER_WHATSAPP ?? "") }, {
      now, test: true, orders: real.length ? real : sim.length ? sim : sampleOrders(day),
      body: `${complaintFormText()}\n${real.length ? COMPLAINT_TEST_REAL_TEXT : sim.length ? COMPLAINT_TEST_SIM_TEXT : COMPLAINT_TEST_SAMPLE_TEXT}`,
    });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
