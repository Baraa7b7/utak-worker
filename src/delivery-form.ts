// § 55 ب (2026-10-05) — the delivery and the collection of an order as ONE
// WhatsApp Flow.
//
// Until § 55 a delivery was a tap: «تم التسليم ✅» delivered the whole order as
// it was ordered, and the payment was a second conversation with the collector
// («طلب التحصيل», src/collect-pay.ts). Now the driver — or Baraa, from the car —
// fills one form at the customer's door:
//
//   • «📦 سلّم وحصّل» (dlv_<order>) takes the place of «تم التسليم ✅» under the
//     driver's stop (the session message and its queued form, src/team.ts) and
//     under Baraa's confirmed order (src/order-flow.ts). The template driver_stop
//     keeps its own quick replies; «تم التسليم» (delivered_<order>) of an older
//     message still delivers the whole order at once; the text «تسليم N» is as
//     it was.
//   • The form (utak_delivery_v1, scripts/lib/s55-flows.mjs; no endpoint): for
//     each of the order's lines the quantity DELIVERED, opened on the ordered
//     one, and why the rest was not — «تالف», «ناقص», «رفضه العميل» — then the
//     payment (كاش / تحويل / لم يدفع), «المبلغ المستلم» and a note. It goes to
//     the one who tapped — a team member or Baraa, no one else — inside his 24h
//     window only: an interactive message, never a template, never held.
//   • § 53: it shows the SALE price of each line and nothing else. No purchase
//     price, cost, suggested price or profit is read here; the gateway refuses
//     its purpose for a supplier's or a price source's number
//     (src/price-privacy.ts), and Baraa's own form goes under his own purpose.
//   • flow_token: one per send, kept in KV with the order, its lines as the form
//     showed them (the line, its name, the ordered quantity, its price), the
//     number it went to and who that is. A reply is read from it — never from
//     the client's data — by that number, once, while the order may still be
//     delivered.
//   • A quantity is a number from 0 to the ordered one, two decimals at most.
//     Anything else — an empty field, a letter, a sign, more than was ordered —
//     a payment that is not one of the three, or an amount that is not a number
//     above zero: the WHOLE form is refused, nothing is written, he is told
//     which field, and a new form goes. Nothing is guessed on the money path.
//   • «إرسال»: a line delivered in part takes the delivered quantity
//     (x_quantity) and keeps what was ordered (x_ordered_qty), what did not
//     arrive (x_return_qty) and why (x_return_reason); a line of which nothing
//     was delivered is marked «unavailable» — the invoice path already leaves
//     such a line out; a line delivered in full is not written. Then the order
//     is delivered by the path of «تم التسليم» itself (src/router.ts
//     deliverOrder, under the same lock): ONE invoice, issued by the invoice
//     path from the delivered quantities. Nothing is computed here, and there
//     is no new accounting path.
//   • The payment is recorded on that invoice by the collection's own function
//     (src/invoice.ts recordCollection): cash → the collector's custody, a
//     transfer → the bank, where it waits for its reconciliation. «لم يدفع»
//     records nothing: the invoice stays due. An amount above the invoice
//     records nothing. The collector's «طلب التحصيل» does not go when the form
//     paid the invoice in full; it goes as before when anything stays due.
//   • Nothing delivered at all: no delivery and no invoice — the stop is marked
//     «مشكلة» with the reasons (the path of «فيه مشكلة»), and the order stays
//     to be delivered.
//   • He gets ONE summary. Baraa gets ONE message whenever the order was not
//     «delivered in full and paid in full»: a shortfall and its reason («تالف»
//     is the damage), an unpaid or part-paid invoice, an amount refused, a note,
//     or no invoice. When Baraa filled the form himself he gets the summary
//     alone.
//   • The trial to Baraa («🧪 تجربة») writes nothing, delivers nothing and
//     records nothing.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import type { NormalizedMessage } from "./types";
import { call, getOrderBrief, getOrderForInvoicing, markStopIssue } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { ALREADY_DONE_TEXT, claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhHHMM } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { DELIVERABLE_STATES } from "./order-flow";
import { sendOwnerMessage, T } from "./templates";

/**
 * utak_delivery_v1 at Meta (published 2026-10-05; its JSON is
 * scripts/lib/s55-flows.mjs, and a published Flow's JSON is frozen: a change
 * of its shape is a new Flow and a new id here).
 */
export const DELIVERY_FLOW_ID = "1113882387786390";
export const DELIVERY_FLOW_SCREEN = "DELIVER_A";
export const DELIVERY_FLOW_SLOTS = 20;
/** The form and its summary to a team member: they carry sale prices (src/price-privacy.ts). */
export const DELIVERY_FORM_PURPOSE = "delivery_form";
/** The same to Baraa, when he delivers from the car: his number alone. */
export const OWNER_DELIVERY_FORM_PURPOSE = "owner_delivery_form";
/** The one trial to Baraa and its answers. */
export const DELIVERY_FORM_TEST_PURPOSE = "delivery_form_test";
/** The session button under a stop and under Baraa's confirmed order (Meta: a title holds 20 characters). */
export const DELIVERY_BUTTON_TITLE = "📦 سلّم وحصّل";
export const DELIVERY_BUTTON_RE = /^dlv_(\d+)$/;
export const deliveryButton = (orderId: number): { id: string; title: string } => ({ id: `dlv_${orderId}`, title: DELIVERY_BUTTON_TITLE });
export const DELIVERY_FORM_CTA = "سلّم وحصّل";
/** Meta's limits of a TextInput: its label and its helper text; of a TextHeading. */
export const DELIVERY_LABEL_MAX = 20;
export const DELIVERY_HINT_MAX = 80;
export const DELIVERY_HEAD_MAX = 80;
export const DELIVERY_TEST_MARK = "🧪 تجربة";
/** The largest amount «المبلغ المستلم» takes. */
export const DELIVERY_AMOUNT_MAX = 1_000_000;
const NOTE_MAX = 500;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";
const LINE_MODEL = "x_daily_order_line";

/** Why a quantity was not delivered: x_daily_order_line.x_return_reason's values, as he reads them. */
export const RETURN_REASONS = { damaged: "تالف", short: "ناقص", refused: "رفضه العميل" } as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
export const PAY_METHODS = { cash: "كاش", transfer: "تحويل", unpaid: "لم يدفع" } as const;
export type PayMethod = keyof typeof PAY_METHODS;

// ---------------------------------------------------------------- texts

const round2 = (n: number): number => Math.round(n * 100) / 100;
function money(x: number): string {
  const n = round2(Number(x));
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const qty = (n: number): string => (Number.isInteger(n) ? String(n) : String(round2(n)));
const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();

/** The one line of text above the fields. */
export const DELIVERY_HOW_TEXT = "اكتب الكمية المسلَّمة فعلاً لكل صنف (معبّأة بالمطلوب)، واختر السبب لو نقص شيء. ثم طريقة الدفع و«إرسال»: الفاتورة تصدر بالمسلَّم فقط.";
/** The hint of a line that has no price yet (the zero-price guard then holds its invoice). */
export const DELIVERY_NO_PRICE_HINT = "بلا سعر";
/** A slot's label — the item's name — and its hint: «كرتون · المطلوب 3 · السعر 31 ر.س شامل الضريبة». */
export function deliverySlotTexts(product: string, packaging: string, ordered: number, price: number, vat: boolean): { label: string; hint: string } {
  const k = clean(packaging);
  const priced = price > 0 ? `السعر ${money(price)} ر.س${vat ? " شامل الضريبة" : ""}` : DELIVERY_NO_PRICE_HINT;
  return {
    label: cut(clean(product), DELIVERY_LABEL_MAX),
    hint: cut(`${k ? `${k} · ` : ""}المطلوب ${qty(ordered)} · ${priced}`, DELIVERY_HINT_MAX),
  };
}
export const deliveryHead = (orderId: number, customer: string, test = false): string =>
  cut(`${test ? `${DELIVERY_TEST_MARK} — ` : ""}طلب #${orderId} — ${customer || "عميل"}`, DELIVERY_HEAD_MAX);
/** The message that carries the form. `left`: the lines beyond the form's slots — delivered in full. */
export function deliveryFormText(orderId: number, customer: string, left: string[], test = false): string {
  return [
    `${test ? `${DELIVERY_TEST_MARK} — ` : ""}📦 تسليم الطلب #${orderId} — ${customer || "عميل"}`,
    `اضغط «${DELIVERY_FORM_CTA}»: اكتب المسلَّم من كل صنف، وطريقة الدفع والمبلغ، ثم «إرسال».`,
    left.length ? `خارج النموذج (يتسع لـ ${DELIVERY_FLOW_SLOTS} صنفاً) وتُسجَّل مسلَّمة كاملة: ${left.join("، ")}.` : "",
  ].filter(Boolean).join("\n");
}
export const DELIVERY_FORM_UNKNOWN_TEXT = `هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اضغط «${DELIVERY_BUTTON_TITLE}» في رسالة الطلب لنموذج جديد.`;
export const DELIVERY_FORM_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية.";
export const DELIVERY_FORM_ERROR_TEXT = (orderId: number): string => `تعذّر تسجيل تسليم الطلب #${orderId} الآن، ولم يكتمل. جرّب «${DELIVERY_BUTTON_TITLE}» بعد قليل، أو بلّغ براء.`;
export const DELIVERY_FORM_NOT_SENT_TEXT = (orderId: number): string => `تعذّر فتح نموذج التسليم الآن. جرّب بعد قليل، أو اكتب «تسليم ${orderId}» لتسليم الطلب كاملاً.`;
/** The answer of «تم التسليم» itself to an order already delivered (src/router.ts deliverOrder). */
export const deliveredAlreadyText = (orderId: number): string => `${ALREADY_DONE_TEXT} الطلب #${orderId} مسجّل مسلّماً.`;
export const DELIVERY_CHANGED_TEXT = (orderId: number): string => `أصناف الطلب #${orderId} تغيّرت بعد فتح النموذج، فلم يُسجَّل منه شيء. هذا نموذج جديد بأصنافه الآن 👇`;
const TEST_TAIL = "(تجربة: لم يُسلَّم شيء، ولم تصدر فاتورة، ولم يُسجَّل دفع)";

// ---------------------------------------------------------------- who fills it

export interface DeliveryWho {
  kind: "team" | "owner";
  /** The member's Work Contact — who collected; null for Baraa. */
  partnerId: number | null;
  name: string;
  whatsapp: string;
}

/**
 * Who this number is, for the form: Baraa, a team member (any role) — or no
 * one. A roster that cannot be read gives no one: nothing is sent on a guess.
 */
export async function deliveryWho(env: Env, from: string): Promise<DeliveryWho | null> {
  const digits = waDigits(from);
  if (!digits) return null;
  if (isOwnerRecipient(env, digits)) return { kind: "owner", partnerId: null, name: "براء", whatsapp: digits };
  try {
    const { loadRoster, memberByNumber } = await import("./team-roster");
    const m = memberByNumber(await loadRoster(env), digits);
    return m ? { kind: "team", partnerId: m.partnerId, name: m.name, whatsapp: digits } : null;
  } catch (e) {
    console.warn("[delivery-form] the roster could not be read — no form", (e as Error)?.message);
    return null;
  }
}

/** The purpose of everything sent to this number: Baraa's own, else the team's (the trial has its own). */
const purposeFor = (env: Env, to: string, test = false): string =>
  (test ? DELIVERY_FORM_TEST_PURPOSE : isOwnerRecipient(env, to) ? OWNER_DELIVERY_FORM_PURPOSE : DELIVERY_FORM_PURPOSE);

// ---------------------------------------------------------------- the order's lines

export interface DeliveryLine {
  /** Its slot in the form (1 … 20); 0 = beyond the form: delivered in full. */
  slot: number;
  lineId: number;
  /** «طماطم كرتون», as the quotation names a line. */
  name: string;
  ordered: number;
  /** The line's SALE price (what the hint shows; the invoice path prices the invoice itself). */
  price: number;
  label: string;
  hint: string;
}
export interface DeliveryLines {
  customer: string;
  /** The lines the form shows: the first twenty. */
  lines: DeliveryLine[];
  /** The rest: no field, delivered in full. */
  extra: DeliveryLine[];
}

/**
 * The lines of an order as its invoice will read them (getOrderForInvoicing:
 * a line marked «unavailable» is not there) — their names, quantities and
 * sale prices, nothing else. Null: no such order.
 */
export async function deliveryLines(env: Env, orderId: number, now: number = Date.now()): Promise<DeliveryLines | null> {
  const order = await getOrderForInvoicing(env, orderId);
  if (!order) return null;
  const vat = isVatApplicable(riyadhDateKey(new Date(now)));
  const all = order.lines.filter((l) => l.quantity > 0).map((l, i): DeliveryLine => {
    const price = l.unit_price ?? l.price_unit_manual ?? 0;
    const t = deliverySlotTexts(l.product_name, l.packaging_name, l.quantity, price, vat);
    return { slot: i < DELIVERY_FLOW_SLOTS ? i + 1 : 0, lineId: l.id, name: `${clean(l.product_name)} ${clean(l.packaging_name)}`.trim(), ordered: l.quantity, price, label: t.label, hint: t.hint };
  });
  return { customer: order.customer_name, lines: all.slice(0, DELIVERY_FLOW_SLOTS), extra: all.slice(DELIVERY_FLOW_SLOTS) };
}

/** The 82 keys of the screen: the heading, the line of text, and l/h/v/i of every slot. */
export function deliveryFormData(head: string, how: string, lines: DeliveryLine[]): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = { head, how };
  for (let n = 1; n <= DELIVERY_FLOW_SLOTS; n++) {
    const l = lines.find((x) => x.slot === n);
    data[`l${n}`] = l ? l.label : "-";
    data[`h${n}`] = l ? l.hint : "-";
    data[`v${n}`] = !!l;
    data[`i${n}`] = l ? qty(l.ordered) : "0";
  }
  return data;
}

// ---------------------------------------------------------------- flow_token

export interface DeliveryFormRecord {
  v: 1;
  token: string;
  orderId: number;
  customer: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  who: Pick<DeliveryWho, "kind" | "partnerId" | "name">;
  lines: DeliveryLine[];
  extra: DeliveryLine[];
  createdAt: number;
  /** The trial to Baraa: its reply writes nothing. */
  test?: boolean;
}
export const deliveryFormKey = (token: string): string => `dform:v1:${token}`;
export const isDeliveryFormToken = (token: string): boolean => String(token ?? "").startsWith("dv1.");
export function newDeliveryFormToken(orderId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `dv1.${orderId}.${rand}`;
}
export async function readDeliveryFormToken(env: Env, token: string): Promise<DeliveryFormRecord | null> {
  if (!isDeliveryFormToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(deliveryFormKey(token));
    const rec = raw ? (JSON.parse(raw) as DeliveryFormRecord) : null;
    return rec && rec.v === 1 && Array.isArray(rec.lines) ? rec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the send

export function deliveryFormSession(text: string, token: string, data: Record<string, string | boolean>, cta: string = DELIVERY_FORM_CTA): GwSession {
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
            flow_id: DELIVERY_FLOW_ID,
            flow_cta: cta,
            flow_action: "navigate",
            flow_action_payload: { screen: DELIVERY_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/** Why an order takes no delivery form now ("" = it may be delivered); the wording of «تم التسليم» itself. */
export async function orderDeliveryProblem(env: Env, orderId: number): Promise<{ reason: string; text: string } | null> {
  const brief = await getOrderBrief(env, orderId);
  if (!brief) return { reason: "not_found", text: `ما لقينا الطلب #${orderId}.` };
  if (brief.state === "delivered" || brief.state === "closed") return { reason: "delivered", text: deliveredAlreadyText(orderId) };
  if (brief.state === "cancelled") return { reason: "cancelled", text: `الطلب #${orderId} ملغى، فلا يُسلَّم.` };
  if (!DELIVERABLE_STATES.has(brief.state)) return { reason: "not_confirmed", text: `الطلب #${orderId} لم يؤكده العميل بعد، فلا يُسلَّم ولا تصدر فاتورته. يضغط العميل «تأكيد الطلب» أولاً.` };
  return null;
}

export interface DeliveryFormOpts {
  now?: number;
  /** The text above the button (a form sent again says why). */
  body?: string;
  /** The trial: the lines are the caller's own, and the order's state is not looked at. */
  test?: boolean;
  built?: DeliveryLines;
  ctx?: ExecutionContext;
}
export interface DeliveryFormResult { sent: boolean; reason?: string; token?: string; /** What to tell him when it did not go. */ text?: string }

/**
 * One delivery form for an order, to the one who asked for it: the interactive
 * message, inside his window only. Nothing is held and no template is used.
 * Only an order that may be delivered (confirmed, or on its way) takes one.
 */
export async function sendDeliveryForm(env: Env, orderId: number, who: DeliveryWho, opts: DeliveryFormOpts = {}): Promise<DeliveryFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  if (!opts.test) {
    const problem = await orderDeliveryProblem(env, orderId);
    if (problem) return { sent: false, ...problem };
  }
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const built = opts.built ?? (await deliveryLines(env, orderId, now));
  if (!built || !built.lines.length) return { sent: false, reason: "no_lines", text: `الطلب #${orderId} ما فيه أصناف تُسلَّم.` };
  const rec: DeliveryFormRecord = {
    v: 1, token: newDeliveryFormToken(orderId), orderId, customer: built.customer, to,
    who: { kind: who.kind, partnerId: who.partnerId, name: who.name }, lines: built.lines, extra: built.extra, createdAt: now,
    ...(opts.test ? { test: true } : {}),
  };
  await env.MSG_DEDUP.put(deliveryFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const data = deliveryFormData(deliveryHead(orderId, built.customer, !!opts.test), DELIVERY_HOW_TEXT, built.lines);
  const res = await sendViaGateway(env, {
    purpose: purposeFor(env, to, !!opts.test),
    to,
    content: deliveryFormSession(opts.body ?? deliveryFormText(orderId, built.customer, built.extra.map((l) => `${l.name} × ${qty(l.ordered)}`), !!opts.test), rec.token, data),
    noHold: true,
    noHoldReason: "نموذج التسليم يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(deliveryFormKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

/**
 * «📦 سلّم وحصّل» under a stop or a confirmed order: the form goes to the one
 * who tapped — a team member or Baraa. Anyone else: nothing. The text is what
 * he is told when no form went ("" = the form is the answer).
 */
export async function answerDeliveryButton(env: Env, orderId: number, from: string, ctx?: ExecutionContext): Promise<{ text: string; sent: boolean }> {
  const who = await deliveryWho(env, from);
  if (!who) {
    console.warn(`[delivery-form] «${DELIVERY_BUTTON_TITLE}» on order ${orderId} from a number that is neither the team's nor Baraa's — nothing sent`);
    return { text: "", sent: false };
  }
  const r = await sendDeliveryForm(env, orderId, who, { ctx });
  if (r.sent) return { text: "", sent: true };
  console.warn(`[delivery-form] order=${orderId} to=${who.whatsapp.slice(-4)} no form: ${r.reason}`);
  return { text: r.text ?? DELIVERY_FORM_NOT_SENT_TEXT(orderId), sent: false };
}

// ---------------------------------------------------------------- the reply: what the fields hold

const latin = (raw: unknown): string => String(raw ?? "")
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/٫/g, ".")
  .replace(/\s+/g, "")
  .replace(/^(\d+),(\d{1,2})$/, "$1.$2");

/**
 * What a quantity field holds: a number from 0 to the ordered quantity, two
 * decimals at most — else «invalid» (an empty field too: it is never read as
 * «all of it» or «none of it»).
 */
export function parseDeliveredQty(raw: unknown, ordered: number): number | "invalid" {
  const s = latin(raw);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = Number(s);
  if (n > ordered + 0.005) return "invalid";
  return Math.abs(n - ordered) <= 0.005 ? ordered : n;
}

/** «المبلغ المستلم»: empty = the whole invoice (null); else one number above zero, two decimals at most. */
export function parsePaidAmount(raw: unknown): number | null | "invalid" {
  const s = latin(raw);
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = Number(s);
  return n > 0 && n <= DELIVERY_AMOUNT_MAX ? n : "invalid";
}

export interface DeliveryEntry {
  line: DeliveryLine;
  delivered: number;
  /** ordered − delivered. */
  short: number;
  /** Why, when something is short; null on a line delivered in full. */
  reason: ReturnReason | null;
}
export interface DeliveryEntries {
  entries: DeliveryEntry[];
  /** Fields that hold no quantity from 0 to the ordered one. */
  badQty: DeliveryLine[];
  /** null: not one of the three. */
  pay: PayMethod | null;
  /** What he received (cash / transfer); null = the whole invoice. Never read for «لم يدفع». */
  amount: number | null;
  badAmount: boolean;
  note: string;
}

/** Each slot's fields against its line — the token's lines, never the client's data. */
export function readDeliveryValues(rec: Pick<DeliveryFormRecord, "lines">, values: Record<string, unknown>): DeliveryEntries {
  const out: DeliveryEntries = { entries: [], badQty: [], pay: null, amount: null, badAmount: false, note: "" };
  for (const line of rec.lines) {
    const d = parseDeliveredQty(values[`q${line.slot}`], line.ordered);
    if (d === "invalid") { out.badQty.push(line); continue; }
    const short = round2(line.ordered - d);
    const raw = String(values[`r${line.slot}`] ?? "");
    // a shortfall with no reason chosen is «ناقص»; a line delivered in full has none
    const reason: ReturnReason | null = short > 0 ? (raw in RETURN_REASONS ? (raw as ReturnReason) : "short") : null;
    out.entries.push({ line, delivered: d, short, reason });
  }
  const pay = String(values.pay ?? "");
  out.pay = pay in PAY_METHODS ? (pay as PayMethod) : null;
  if (out.pay === "cash" || out.pay === "transfer") {
    const a = parsePaidAmount(values.amt);
    if (a === "invalid") out.badAmount = true;
    else out.amount = a;
  }
  out.note = cut(String(values.note ?? "").replace(/\s+/g, " ").trim(), NOTE_MAX);
  return out;
}

/** Why the form is refused as a whole — a line per field; none = it is taken. */
export function deliveryProblems(e: DeliveryEntries): string[] {
  return [
    e.badQty.length ? `الكمية المسلَّمة رقم من 0 إلى المطلوب: ${e.badQty.map((l) => `${l.name} (المطلوب ${qty(l.ordered)})`).join("، ")}` : "",
    e.pay ? "" : `اختر «طريقة الدفع»: ${Object.values(PAY_METHODS).join(" / ")}`,
    e.badAmount ? "«المبلغ المستلم» رقم أكبر من صفر — أو اتركه فاضي لقيمة الفاتورة كاملة" : "",
  ].filter(Boolean);
}
export const deliveryRefusalText = (orderId: number, problems: string[], again = true): string => [
  `⚠️ لم يُسجَّل شيء من نموذج الطلب #${orderId}:`,
  ...problems.map((p) => `• ${p}`),
  again ? "هذا نموذج جديد، عبّه من جديد 👇" : `اضغط «${DELIVERY_BUTTON_TITLE}» في رسالة الطلب لنموذج جديد.`,
].join("\n");

// ---------------------------------------------------------------- the reply: what is told

/** What the form's payment came to. */
export type DeliveryPayment =
  | { kind: "paid"; method: "cash" | "transfer"; amount: number }
  | { kind: "part"; method: "cash" | "transfer"; amount: number; rest: number }
  | { kind: "over"; method: "cash" | "transfer"; amount: number; remaining: number }
  | { kind: "failed"; method: "cash" | "transfer"; amount: number | null; why: string }
  | { kind: "unpaid" }
  | { kind: "no_invoice" };
export interface IssuedInvoice { invoiceId: number; number: string; total: number }

const reported = (e: Pick<DeliveryEntries, "pay" | "amount">): string =>
  (e.pay === "cash" || e.pay === "transfer" ? `${PAY_METHODS[e.pay]}${e.amount === null ? " (المبلغ كامل)" : ` ${money(e.amount)} ر.س`}` : PAY_METHODS.unpaid);
/** «طماطم كرتون: 2 من 3 — ناقص 1 (تالف)». */
function entryLine(x: DeliveryEntry): string {
  const head = `• ${x.line.name}: ${qty(x.delivered)} من ${qty(x.line.ordered)}`;
  if (!(x.short > 0)) return `${head} ✅`;
  const why = RETURN_REASONS[x.reason ?? "short"];
  return x.delivered > 0 ? `${head} — لم يُسلَّم ${qty(x.short)} (${why})` : `${head} — لم يُسلَّم (${why})`;
}
/** What was recorded, as the one who filled the form reads it. */
export function paymentLine(p: DeliveryPayment, inv: IssuedInvoice | null, e: Pick<DeliveryEntries, "pay" | "amount">, owner: boolean): string {
  const custody = owner ? "✅ سُجّل في عهدة المحصّل" : "✅ في عهدتك";
  const took = (method: "cash" | "transfer", amount: number): string =>
    (method === "cash" ? `${PAY_METHODS.cash} ${money(amount)} ر.س ${custody}` : `${PAY_METHODS.transfer} ${money(amount)} ر.س — ينتظر المطابقة البنكية`);
  const told = owner ? "" : " ووصل براء.";
  switch (p.kind) {
    case "paid": return took(p.method, p.amount);
    case "part": return `${took(p.method, p.amount)} — الباقي ${money(p.rest)} ر.س مستحق`;
    case "unpaid": return `${PAY_METHODS.unpaid}: ${money(inv?.total ?? 0)} ر.س مستحق`;
    case "over": return `⚠️ ${PAY_METHODS[p.method]} ${money(p.amount)} ر.س أكبر من المتبقي على الفاتورة (${money(p.remaining)} ر.س): لم يُسجَّل دفع، والفاتورة كلها مستحقة. سجّل المبلغ الصحيح من «طلب التحصيل».${told}`;
    case "failed": return `⚠️ لم يُسجَّل الدفع (${reported(e)}): ${p.why}${told}`;
    case "no_invoice": return `⚠️ لم تصدر فاتورة الآن، فلم يُسجَّل دفع (${reported(e)}).${owner ? "" : " وصل براء ما بلّغته."}`;
  }
}
/** The one summary of a delivery, to the one who filled the form. `tail`: the answer of «تم التسليم» itself (the route's progress). */
export function deliverySummaryText(rec: Pick<DeliveryFormRecord, "orderId" | "customer" | "extra">, e: DeliveryEntries, inv: IssuedInvoice | null, p: DeliveryPayment, tail: string, owner: boolean): string {
  return [
    `📦 الطلب #${rec.orderId} — ${rec.customer}`,
    ...e.entries.map(entryLine),
    rec.extra.length ? `• وخارج النموذج، مسلَّمة كاملة: ${rec.extra.map((l) => `${l.name} × ${qty(l.ordered)}`).join("، ")}` : "",
    inv ? `الفاتورة ${inv.number}: ${money(inv.total)} ر.س (بالمسلَّم فقط)` : "",
    paymentLine(p, inv, e, owner),
    e.note ? `ملاحظتك: ${e.note}` : "",
    tail,
  ].filter(Boolean).join("\n");
}
/**
 * Baraa's ONE message of a delivery that was not «in full and paid in full»
 * ("" = nothing to tell him): each shortfall and its reason, what stays due,
 * an amount that was not recorded, the note.
 */
export function deliveryOwnerText(rec: Pick<DeliveryFormRecord, "orderId" | "customer" | "who">, e: DeliveryEntries, inv: IssuedInvoice | null, p: DeliveryPayment): string {
  const of = inv ? ` — الفاتورة ${inv.number}` : "";
  const pay = p.kind === "paid" ? ""
    : p.kind === "unpaid" ? `• ${PAY_METHODS.unpaid}: ${money(inv?.total ?? 0)} ر.س مستحق${of}`
      : p.kind === "part" ? `• دفع جزئي: ${PAY_METHODS[p.method]} ${money(p.amount)} ر.س من ${money(inv?.total ?? 0)} ر.س، والباقي ${money(p.rest)} ر.س مستحق${of}`
        : p.kind === "over" ? `• بلّغ ${PAY_METHODS[p.method]} ${money(p.amount)} ر.س وهو أكبر من المتبقي (${money(p.remaining)} ر.س): لم يُسجَّل دفع${of}`
          : p.kind === "failed" ? `• بلّغ ${reported(e)} ولم يُسجَّل: ${p.why}${of}`
            : `• لم تصدر فاتورة، فلم يُسجَّل دفع. بلّغ: ${reported(e)}`;
  const lines = [
    ...e.entries.filter((x) => x.short > 0).map((x) => (x.delivered > 0
      ? `• ناقص: ${x.line.name} ${qty(x.delivered)} من ${qty(x.line.ordered)} — ${RETURN_REASONS[x.reason ?? "short"]}`
      : `• لم يُسلَّم: ${x.line.name} × ${qty(x.line.ordered)} — ${RETURN_REASONS[x.reason ?? "short"]}`)),
    pay,
    e.note ? `• ملاحظة: ${e.note}` : "",
  ].filter(Boolean);
  return lines.length ? [`📦 تسليم الطلب #${rec.orderId} — ${rec.customer} (${rec.who.name})`, ...lines].join("\n") : "";
}
/** Nothing was delivered: the note on the stop, as «فيه مشكلة» writes one. */
export const nothingDeliveredNote = (e: DeliveryEntries): string =>
  cut(`لم يُسلَّم شيء (نموذج التسليم): ${e.entries.map((x) => `${x.line.name} × ${qty(x.line.ordered)} — ${RETURN_REASONS[x.reason ?? "short"]}`).join("؛ ")}${e.note ? ` · ملاحظة: ${e.note}` : ""}`, 1000);

// ---------------------------------------------------------------- the reply: what is written

/** The order's lines now are the ones the form showed (each line, at its quantity). */
function sameLines(rec: Pick<DeliveryFormRecord, "lines" | "extra">, now: DeliveryLines): boolean {
  const shown = [...rec.lines, ...rec.extra], cur = [...now.lines, ...now.extra];
  return shown.length === cur.length && shown.every((l) => cur.some((c) => c.lineId === l.lineId && Math.abs(c.ordered - l.ordered) < 0.0001));
}

/** The order's delivery note: a line added, never replaced. */
async function appendDeliveryNote(env: Env, orderId: number, who: string, text: string, now: number): Promise<void> {
  const [o] = await call<Array<{ id: number; x_delivery_notes: string | false }>>(env, "x_daily_order", "read", { ids: [orderId], fields: ["id", "x_delivery_notes"] });
  const next = `${typeof o?.x_delivery_notes === "string" && o.x_delivery_notes ? `${o.x_delivery_notes}\n` : ""}[${riyadhHHMM(new Date(now))} ${who}] ${text}`;
  await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals: { x_delivery_notes: next.slice(-4000) } });
}

/**
 * The delivered quantities on the order's lines. A line delivered in part takes
 * the delivered quantity and keeps the ordered one beside it; a line of which
 * nothing was delivered is «unavailable» (its quantity untouched); a line
 * delivered in full is not written. Returns how to put the lines back (the
 * delivery after it did not happen).
 */
async function writeDelivered(env: Env, e: DeliveryEntries): Promise<() => Promise<void>> {
  const short = e.entries.filter((x) => x.short > 0);
  const none = short.filter((x) => !(x.delivered > 0));
  const was = none.length
    ? await call<Array<{ id: number; x_status: string | false }>>(env, LINE_MODEL, "read", { ids: none.map((x) => x.line.lineId), fields: ["id", "x_status"] })
    : [];
  const done: Array<{ id: number; vals: Record<string, unknown> }> = [];
  for (const x of short) {
    const ret = { x_ordered_qty: x.line.ordered, x_return_qty: x.short, x_return_reason: x.reason ?? "short" };
    const vals = x.delivered > 0 ? { x_quantity: x.delivered, ...ret } : { x_status: "unavailable", ...ret };
    await call<boolean>(env, LINE_MODEL, "write", { ids: [x.line.lineId], vals });
    const cleared = { x_ordered_qty: 0, x_return_qty: 0, x_return_reason: false };
    done.push({ id: x.line.lineId, vals: x.delivered > 0 ? { x_quantity: x.line.ordered, ...cleared } : { x_status: was.find((w) => w.id === x.line.lineId)?.x_status || "pending", ...cleared } });
  }
  return async () => {
    for (const d of done) {
      try { await call<boolean>(env, LINE_MODEL, "write", { ids: [d.id], vals: d.vals }); }
      catch (err) { console.error(`[delivery-form] line ${d.id} could not be put back`, (err as Error)?.message); }
    }
  };
}

export interface DeliveryOutcome {
  action: "delivered" | "nothing" | "refused" | "changed" | "test" | "unknown" | "duplicate" | "closed" | "locked" | "not_delivered" | "error";
  orderId?: number;
  invoiceId?: number;
  payment?: DeliveryPayment["kind"];
}

/** A reply of the delivery form (nfm_reply). Never throws: he is told when it could not be taken. */
export async function handleDeliveryFormReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<DeliveryOutcome> {
  const to = waDigits(msg.from);
  const rec = await readDeliveryFormToken(env, msg.flow?.token ?? "").catch(() => null);
  // an answer that does not go is logged, never thrown: a delivery that is done stays done
  const say = async (text: string): Promise<void> => {
    const purpose = rec && rec.to === to ? purposeFor(env, to, !!rec.test) : isOwnerRecipient(env, to) ? OWNER_DELIVERY_FORM_PURPOSE : "bot_reply";
    try { await sendViaGateway(env, { purpose, to, content: textContent(text), ctx }); }
    catch (e) { console.warn(`[delivery-form] the answer to ${to.slice(-4)} did not go`, (e as Error)?.message); }
  };
  try {
    return await takeDeliveryFormReply(env, rec, to, msg.flow?.values ?? {}, say, ctx, nowMs);
  } catch (e) {
    console.error(`[delivery-form] reply of order ${rec?.orderId ?? "?"} failed`, (e as Error)?.message);
    await say(rec ? DELIVERY_FORM_ERROR_TEXT(rec.orderId) : DELIVERY_FORM_UNKNOWN_TEXT);
    return { action: "error", orderId: rec?.orderId };
  }
}

async function takeDeliveryFormReply(env: Env, rec: DeliveryFormRecord | null, to: string, values: Record<string, unknown>, say: (text: string) => Promise<void>, ctx: ExecutionContext | undefined, nowMs: number): Promise<DeliveryOutcome> {
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[delivery-form] reply with no token of this number from=${to.slice(-4)}`);
    await say(DELIVERY_FORM_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const { orderId } = rec;
  const owner = rec.who.kind === "owner";
  const who: DeliveryWho = { ...rec.who, whatsapp: to };
  const e = readDeliveryValues(rec, values);
  const problems = deliveryProblems(e);
  if (rec.test) {
    await say(problems.length ? `${DELIVERY_TEST_MARK} — ${deliveryRefusalText(orderId, problems, false)}\n${TEST_TAIL}` : deliveryTestAnswer(rec, e));
    return { action: "test", orderId };
  }
  // only while the order may still be delivered: an order already delivered answers as «تم التسليم» does
  const closed = await orderDeliveryProblem(env, orderId);
  if (closed) {
    await say(closed.text);
    return { action: "closed", orderId };
  }
  // one field that cannot be read: the whole form is refused, nothing written, and a new form goes
  if (problems.length) {
    console.warn(`[delivery-form] order=${orderId} refused: ${problems.length} field(s) — nothing written`);
    const again = await sendDeliveryForm(env, orderId, who, { now: nowMs, body: deliveryRefusalText(orderId, problems), ctx }).catch(() => ({ sent: false }));
    if (!again.sent) await say(deliveryRefusalText(orderId, problems, false));
    return { action: "refused", orderId };
  }
  // the order's lines moved since the form was sent (a quantity, a line): its quantities are not this order's any more
  const current = await deliveryLines(env, orderId, nowMs);
  if (!current || !sameLines(rec, current)) {
    console.warn(`[delivery-form] order=${orderId} changed since the form — nothing written`);
    const again = current ? await sendDeliveryForm(env, orderId, who, { now: nowMs, body: DELIVERY_CHANGED_TEXT(orderId), ctx }).catch(() => ({ sent: false })) : { sent: false };
    if (!again.sent) await say(DELIVERY_CHANGED_TEXT(orderId).replace(" هذا نموذج جديد بأصنافه الآن 👇", ` اضغط «${DELIVERY_BUTTON_TITLE}» لنموذج جديد.`));
    return { action: "changed", orderId };
  }
  // a token is read once
  const use = await claimButton(env, `dform_use:${rec.token}`, TOKEN_TTL);
  if (!use.claimed) {
    console.warn(`[delivery-form] repeated token order=${orderId} — not taken again`);
    await say(DELIVERY_FORM_USED_TEXT);
    return { action: "duplicate", orderId };
  }
  try {
    // nothing of the order was delivered: no delivery and no invoice — the stop's «مشكلة», and the order stays
    if (!rec.extra.length && !e.entries.some((x) => x.delivered > 0)) {
      const note = nothingDeliveredNote(e);
      await markStopIssue(env, orderId, note);
      await appendDeliveryNote(env, orderId, rec.who.name, note, nowMs).catch((err) => console.warn(`[delivery-form] order ${orderId}: the note was not written`, (err as Error)?.message));
      await finishButton(env, use, TOKEN_TTL);
      if (!owner) {
        await sendOwnerMessage(env, [
          `⚠️ لم يُسلَّم الطلب #${orderId} — ${rec.customer} (${rec.who.name})`,
          ...e.entries.map((x) => `• ${x.line.name} × ${qty(x.line.ordered)} — ${RETURN_REASONS[x.reason ?? "short"]}`),
          e.pay && e.pay !== "unpaid" ? `• بلّغ عن دفع ولم يُسجَّل: ${reported(e)}` : "",
          e.note ? `• ملاحظة: ${e.note}` : "",
          "لا تسليم ولا فاتورة. الطلب باقٍ للتسليم.",
        ].filter(Boolean).join("\n"), T.OWNER_TEAM_NOTE);
      }
      await say([
        `⚠️ الطلب #${orderId} — ${rec.customer}: لم يُسلَّم منه شيء، فلا تسليم ولا فاتورة ولا دفع.`,
        ...e.entries.map(entryLine),
        `سُجّلت مشكلة على التوصيلة${owner ? "" : " ووصلت براء"}. الطلب باقٍ للتسليم: لو سلّمته بعدين اضغط «${DELIVERY_BUTTON_TITLE}» من جديد.`,
      ].join("\n"));
      console.log(`[delivery-form] order=${orderId} nothing delivered — the stop marked «مشكلة»`);
      return { action: "nothing", orderId };
    }
    // the lock of the «تم التسليم» button: one delivery per order, whichever of the two is used
    const lock = await claimButton(env, `delivered:${orderId}`);
    if (!lock.claimed) {
      await releaseButton(env, use);
      console.warn(`[delivery-form] order=${orderId}: another delivery holds the lock (${lock.state.slice(0, 40)}) — nothing written`);
      await say(ALREADY_DONE_TEXT);
      return { action: "locked", orderId };
    }
    let undo: (() => Promise<void>) | null = null;
    let issued: IssuedInvoice | null = null;
    let payment: DeliveryPayment = { kind: "no_invoice" };
    let delivered = { text: "", delivered: false };
    try {
      undo = await writeDelivered(env, e);
      // the delivery itself — the stop, the order, ONE invoice from the delivered quantities, the customer:
      // the path of «تم التسليم». The payment goes on that invoice once it reached the customer.
      const { deliverOrder } = await import("./router");
      delivered = await deliverOrder(env, orderId, {
        settle: async (inv) => {
          issued = inv;
          payment = await recordFormPayment(env, inv, e, rec.who.partnerId);
          return payment.kind === "paid";
        },
      });
      if (!delivered.delivered) await undo();
    } catch (err) {
      if (undo) await undo();
      await releaseButton(env, lock);
      throw err;
    }
    if (!delivered.delivered) {
      await releaseButton(env, lock);
      await releaseButton(env, use);
      await say(delivered.text);
      return { action: "not_delivered", orderId };
    }
    await finishButton(env, lock);
    await finishButton(env, use, TOKEN_TTL);
    // his note, once the order is delivered (a delivery that failed and is sent again does not write it twice)
    if (e.note) await appendDeliveryNote(env, orderId, rec.who.name, e.note, nowMs).catch((err) => console.warn(`[delivery-form] order ${orderId}: the note was not written`, (err as Error)?.message));
    const inv = issued as IssuedInvoice | null;
    const paid = payment as DeliveryPayment;
    console.log(`[delivery-form] order=${orderId} delivered by=${rec.who.kind} short=${e.entries.filter((x) => x.short > 0).length} invoice=${inv?.number ?? "-"} pay=${paid.kind}`);
    await say(deliverySummaryText(rec, e, inv, paid, delivered.text, owner));
    const forOwner = owner ? "" : deliveryOwnerText(rec, e, inv, paid);
    if (forOwner) await sendOwnerMessage(env, forOwner, T.OWNER_TEAM_NOTE);
    return { action: "delivered", orderId, invoiceId: inv?.invoiceId, payment: paid.kind };
  } catch (err) {
    await releaseButton(env, use);
    throw err;
  }
}

/**
 * The form's payment on the invoice just issued, by the collection's own
 * function: cash and transfer at the amount he received (empty: the invoice's
 * total), refused — nothing recorded — when it is more than what is due;
 * «لم يدفع» records nothing. Never throws.
 */
async function recordFormPayment(env: Env, inv: IssuedInvoice, e: Pick<DeliveryEntries, "pay" | "amount">, collectedBy: number | null): Promise<DeliveryPayment> {
  if (e.pay !== "cash" && e.pay !== "transfer") return { kind: "unpaid" };
  const method = e.pay;
  const amount = e.amount ?? inv.total;
  try {
    const { recordCollection } = await import("./invoice");
    const r = await recordCollection(env, { invoiceId: inv.invoiceId, method, amount, collectedBy, exact: true });
    if (r.overLimit) return { kind: "over", method, amount, remaining: r.overLimit.remaining };
    if (!r.paymentId) return { kind: "failed", method, amount: e.amount, why: r.text };
    return r.fullyPaid ? { kind: "paid", method, amount } : { kind: "part", method, amount, rest: round2(inv.total - amount) };
  } catch (err) {
    console.error(`[delivery-form] invoice ${inv.number}: the payment was not recorded`, (err as Error)?.message);
    return { kind: "failed", method, amount: e.amount, why: "تعذّر التسجيل الآن" };
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/** The trial's answer: what the form WOULD do. Nothing is read from Odoo for it, and nothing written. */
function deliveryTestAnswer(rec: DeliveryFormRecord, e: DeliveryEntries): string {
  const any = rec.extra.length > 0 || e.entries.some((x) => x.delivered > 0);
  const value = round2(e.entries.reduce((s, x) => s + round2(x.delivered * x.line.price), 0) + rec.extra.reduce((s, l) => s + round2(l.ordered * l.price), 0));
  return [
    `${DELIVERY_TEST_MARK} — وصل نموذج تسليم الطلب #${rec.orderId} (${rec.customer}):`,
    ...e.entries.map(entryLine),
    `الدفع: ${reported(e)}`,
    e.note ? `ملاحظة: ${e.note}` : "",
    any
      ? `كان سيُسجَّل التسليم، وتصدر فاتورة بالمسلَّم فقط (قيمته بأسعار الطلب ${money(value)} ر.س)، ${e.pay === "unpaid" ? "وتبقى مستحقة ويصل براء سطر" : `ويُسجَّل الدفع ${e.pay === "cash" ? "في عهدة المحصّل" : "تحويلاً ينتظر المطابقة البنكية"}`}.`
      : "كان سيُسجَّل «مشكلة» على التوصيلة بلا تسليم ولا فاتورة، ويبقى الطلب للتسليم.",
    TEST_TAIL,
  ].filter(Boolean).join("\n");
}

/**
 * ONE delivery form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day, built from the latest real order
 * that has lines (read only). His reply is answered with what would be done:
 * nothing is written, no order is delivered, no invoice issued, no payment
 * recorded.
 */
export async function sendDeliveryFormTest(env: Env, now: number = Date.now()): Promise<DeliveryFormResult & { orderId?: number }> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `dform_test:${DELIVERY_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const orders = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
      domain: [[SIM_FIELD, "!=", true], ["x_line_ids", "!=", false]], fields: ["id"], order: "id desc", limit: 5,
    });
    let orderId = 0, built: DeliveryLines | null = null;
    for (const o of orders) {
      const b = await deliveryLines(env, o.id, now);
      if (b?.lines.length) { orderId = o.id; built = b; break; }
    }
    if (!built) { await releaseButton(env, claim); return { sent: false, reason: "no_order" }; }
    const r = await sendDeliveryForm(env, orderId, { kind: "owner", partnerId: null, name: "براء", whatsapp: owner }, { now, test: true, built });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return { ...r, orderId };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
