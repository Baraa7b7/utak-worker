// § 55 هـ (2026-10-05) — the custody handover at the end of the day, as a
// WhatsApp Flow: the collector says how much of the day's cash he handed over,
// and how; the worker holds it against the cash he collected, and tells Baraa.
//
// The Flow (utak_custody_v1; scripts/lib/s55-flows.mjs is its JSON) is ONE
// screen with no endpoint — its two texts go with the message (flow_action
// navigate): the heading, the line «الكاش المتوقع معك اليوم: 450 ر.س — 3
// تحصيلات», «المبلغ المسلَّم» (amt, a number, required), «طريقة التسليم» (how:
// bank «إيداع بنكي» / owner «تسليم لبراء», required, nothing chosen for him),
// «ملاحظة» (note, optional) and «إرسال».
//
//   • The cash EXPECTED with him is the sum of HIS cash collections of the
//     Riyadh day: x_payment with x_method = cash, x_collected_by = his Work
//     Contact, x_collected_at in the day — not a simulation row, nor a row of a
//     simulation invoice or order (as the day's summaries count them). It is
//     read when the form is sent (what he sees) and AGAIN when his reply is read:
//     the reply's figure is the one reported, and when it moved since the form
//     was sent the message says both.
//   • «عهدة» / «تسليم العهدة» (the whole message), or the button custody_start,
//     from a team member with the «collector» role, inside his 24h window (an
//     interactive message: never a template, never held).
//   • flow_token (cu1.…): one per send, kept in KV with the number and the day.
//     A reply is read by the number it was sent to, on the day it was sent,
//     once. amt is a number ≥ 0 with at most two decimals and how one of the
//     two: anything else refuses the form — one message, with a fresh form.
//   • Baraa (owner_team_note) ALWAYS gets the result: expected (and from how many
//     collections), handed over, how, the difference with its sign («مطابق» at
//     0), the collector's note — and one line saying NO accounting entry is made.
//     A second handover the same day reaches him as a correction that names the
//     earlier figures. The collector gets «وصل ✅» with the same figures.
//   • NO ENTRY AND NO ODOO WRITE. The order asks for the entry «by the existing
//     custody path»; no such path exists in the worker (a cash collection posts
//     its own account.payment on the driver's cash journal CSHD, and nothing
//     moves cash out of it), so none is made here: the transfer out of CSHD is
//     recorded by hand in Odoo, and the message says so. The handover lives in
//     KV four days (per Riyadh day and collector), and the messages are recorded
//     by the gateway (x_wa_message) like every send.
//   • The amounts are his own collections (the sale side): no purchase price,
//     no cost and no profit is read, kept or sent here.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import type { RouterReply } from "./router";
import { call } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { dayLabel } from "./order-flow";
import { sendOwnerMessage, T } from "./templates";

/** utak_custody_v1 at Meta (a published Flow's JSON is frozen). */
export const CUSTODY_FLOW_ID = "1084087254588299";
export const CUSTODY_FLOW_SCREEN = "CUSTODY_A";
/** The gateway purpose of the form and of its answers to the collector. */
export const CUSTODY_PURPOSE = "custody_form";
/** The one trial to Baraa and its answers (allowed to the owner's number alone). */
export const CUSTODY_TEST_PURPOSE = "custody_form_test";
/** What Baraa is told: the team's note to him. */
export const CUSTODY_OWNER_PURPOSE = T.OWNER_TEAM_NOTE;
/** The role that holds the day's cash. */
export const CUSTODY_ROLE = "collector";
export const CUSTODY_BUTTON = "custody_start";
export const CUSTODY_BUTTON_TITLE = "تسليم العهدة";
export const CUSTODY_CTA = "سلّم العهدة";
export const CUSTODY_TITLE = "تسليم العهدة";
export const CUSTODY_TEST_MARK = "🧪 تجربة";
/** How the cash was handed over: the Flow's ids, and how each is read. */
export const CUSTODY_HOW: Readonly<Record<string, string>> = { bank: "إيداع بنكي", owner: "تسليم لبراء" };
export type CustodyHow = "bank" | "owner";
/** The day's handover is kept this long. */
export const CUSTODY_KEEP_SEC = 4 * 24 * 60 * 60;
/** Meta's limit of a TextHeading, and the room a note takes in a message. */
export const CUSTODY_HEADING_MAX = 80;
export const CUSTODY_NOTE_MAX = 500;
const BODY_MAX = 1024;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIM_FIELD = "x_utak_simulation";

// ---------------------------------------------------------------- texts

export const CUSTODY_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «عهدة» ونرسل لك نموذج اليوم.";
export const CUSTODY_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية. للتصحيح اكتب «عهدة».";
export const CUSTODY_EXPIRED_TEXT = "هذا نموذج يوم سابق، ولم يُسجَّل منه شيء. اكتب «عهدة» لنموذج اليوم.";
export const CUSTODY_FAILED_TEXT = "تعذّر إرسال نموذج تسليم العهدة الآن. جرّب بعد قليل، أو أرسل المبلغ لبراء نصاً.";
export const CUSTODY_BAD_AMOUNT_TEXT = "المبلغ المسلَّم رقم (صفر أو أكثر) بخانتين عشريتين على الأكثر.";
export const CUSTODY_BAD_HOW_TEXT = "اختر طريقة التسليم: «إيداع بنكي» أو «تسليم لبراء».";
/** Baraa's last line, always: nothing is posted for a handover. */
export const CUSTODY_NO_ENTRY_TEXT = "لا قيد آلي: خروج المبلغ من يومية كاش السائق (CSHD) يُسجَّل يدوياً في Odoo.";
export const CUSTODY_NOT_READ_TEXT = "⚠️ تعذّرت قراءة التحصيلات الآن: المتوقع هو ما ظهر في النموذج.";

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** An amount as it is read: «450», «450.50». */
export function money(x: number): string {
  const n = round2(Number(x) || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const hhmm = (ms: number): string => riyadhHHMM(new Date(ms));
/** «لا تحصيلات», «تحصيل واحد», «تحصيلان», «3 تحصيلات», «12 تحصيلاً». */
export function collectionsAr(n: number): string {
  if (n <= 0) return "لا تحصيلات";
  if (n === 1) return "تحصيل واحد";
  if (n === 2) return "تحصيلان";
  return n <= 10 ? `${n} تحصيلات` : `${n} تحصيلاً`;
}
/** The difference handed − expected, with its sign: «مطابق», «−50 ر.س (ناقص)», «+20 ر.س (زيادة)». The minus is U+2212. */
export function differenceText(diff: number): string {
  const d = round2(diff);
  if (d === 0) return "مطابق";
  return d < 0 ? `−${money(-d)} ر.س (ناقص)` : `+${money(d)} ر.س (زيادة)`;
}

/** «عهدة» / «تسليم العهدة»: the WHOLE message and nothing else in it (ة / ه, the marks, a full stop after it). */
export function custodyCommand(text: string): boolean {
  const t = String(text ?? "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[.!؟?،,\s]+$/g, "").replace(/\s+/g, " ");
  return t === "عهده" || t === "تسليم العهده";
}
export const custodyButton = (): { id: string; title: string } => ({ id: CUSTODY_BUTTON, title: CUSTODY_BUTTON_TITLE });

// ---------------------------------------------------------------- the cash expected with him

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
export interface ExpectedCash { total: number; count: number }

/** The invoices among `ids` that are simulation — their own flag, or their order's (as the day's summaries read them). */
export async function simulationInvoices(env: Env, ids: number[]): Promise<Set<number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set();
  const invs = await call<Array<{ id: number; x_order_id: M2O } & Record<string, unknown>>>(env, "x_invoice", "read", { ids: unique, fields: ["id", "x_order_id", SIM_FIELD] });
  const orderIds = [...new Set(invs.map((i) => m2oId(i.x_order_id)).filter(Boolean))];
  const simOrders = new Set(orderIds.length
    ? (await call<Array<{ id: number } & Record<string, unknown>>>(env, "x_daily_order", "read", { ids: orderIds, fields: ["id", SIM_FIELD] })).filter((o) => o[SIM_FIELD] === true).map((o) => o.id)
    : []);
  return new Set(invs.filter((i) => i[SIM_FIELD] === true || simOrders.has(m2oId(i.x_order_id))).map((i) => i.id));
}

/**
 * The cash collected on a Riyadh day — by one collector (his Work Contact), or
 * by everyone (`collectorId` null: the trial's figure): cash only, that day
 * only, no simulation. Read-only. Throws on Odoo trouble.
 */
export async function expectedCash(env: Env, collectorId: number | null, day: string): Promise<ExpectedCash> {
  const from = riyadhDayMinuteMs(day, 0);
  const pays = await call<Array<{ id: number; x_amount: number | false; x_invoice_id: M2O }>>(env, "x_payment", "search_read", {
    domain: [
      ["x_method", "=", "cash"], ["x_collected_at", ">=", toOdooUtc(from)], ["x_collected_at", "<", toOdooUtc(from + DAY_MS)], [SIM_FIELD, "!=", true],
      ...(collectorId ? [["x_collected_by", "=", collectorId]] : []),
    ],
    fields: ["id", "x_amount", "x_invoice_id"], limit: 5000,
  });
  const sim = await simulationInvoices(env, pays.map((p) => m2oId(p.x_invoice_id)));
  const real = pays.filter((p) => !sim.has(m2oId(p.x_invoice_id)));
  return { total: round2(real.reduce((s, p) => s + (Number(p.x_amount) || 0), 0)), count: real.length };
}
/** «الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات». */
export const expectedLine = (e: ExpectedCash): string => `الكاش المتوقع معك اليوم: ${money(e.total)} ر.س — ${collectionsAr(e.count)}`;

// ---------------------------------------------------------------- the day's handover (KV)

export interface CustodyDay {
  v: 1;
  /** The Riyadh day. */
  day: string;
  /** The collector's Work Contact (res.partner), and his name. */
  collectorId: number;
  collector: string;
  /** When the handover was sent. */
  at: number;
  expected: number;
  count: number;
  handed: number;
  how: CustodyHow;
  note: string;
  /** handed − expected. */
  diff: number;
  /** How many handovers of this day came before this one. */
  corrections: number;
}
export const custodyKey = (day: string, collectorId: number): string => `custody:v1:${day}:${collectorId}`;
export async function readCustody(env: Env, day: string, collectorId: number): Promise<CustodyDay | null> {
  try {
    const raw = await env.MSG_DEDUP.get(custodyKey(day, collectorId));
    const rec = raw ? (JSON.parse(raw) as CustodyDay) : null;
    return rec && rec.v === 1 && typeof rec.handed === "number" ? rec : null;
  } catch { return null; }
}
async function writeCustody(env: Env, rec: CustodyDay): Promise<void> {
  await env.MSG_DEDUP.put(custodyKey(rec.day, rec.collectorId), JSON.stringify(rec), { expirationTtl: CUSTODY_KEEP_SEC });
}

// ---------------------------------------------------------------- flow_token

export interface CustodyToken {
  v: 1;
  token: string;
  /** The Riyadh day it was sent: the only day its reply is read. */
  day: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  collectorId: number;
  collector: string;
  /** What the form showed him. */
  expected: number;
  count: number;
  createdAt: number;
  /** The trial to Baraa: its reply keeps nothing. */
  test?: boolean;
  usedAt?: number;
}
export const custodyTokenKey = (token: string): string => `custody_t:v1:${token}`;
export const isCustodyToken = (token: string): boolean => String(token ?? "").startsWith("cu1.");
export function newCustodyToken(day: string, collectorId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cu1.${day.replace(/-/g, "")}.${collectorId}.${rand}`;
}
export async function readCustodyToken(env: Env, token: string): Promise<CustodyToken | null> {
  if (!isCustodyToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(custodyTokenKey(token));
    const rec = raw ? (JSON.parse(raw) as CustodyToken) : null;
    return rec && rec.v === 1 && typeof rec.expected === "number" ? rec : null;
  } catch { return null; }
}
async function writeCustodyToken(env: Env, rec: CustodyToken): Promise<void> {
  await env.MSG_DEDUP.put(custodyTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the send

export interface CustodyWho { partnerId: number; name: string; whatsapp: string }
export interface CustodyFormOpts {
  now?: number;
  /** The text above the button (default: the day and the expected cash). */
  body?: string;
  /** The figure to show (the trial's; a form sent again after a refusal): else it is read now. */
  expected?: ExpectedCash;
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface CustodyFormResult { sent: boolean; reason?: string; token?: string; expected?: number; count?: number }

/** The two keys of the screen: its heading, and the line of the cash expected. */
export function custodyData(day: string, e: ExpectedCash, mark = ""): Record<string, string> {
  return { t: cut(`${mark}${CUSTODY_TITLE} — ${dayLabel(day)}`, CUSTODY_HEADING_MAX), exp: expectedLine(e) };
}
export function custodySession(text: string, token: string, data: Record<string, string>): GwSession {
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
            flow_id: CUSTODY_FLOW_ID,
            flow_cta: CUSTODY_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: CUSTODY_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}
/** The text above the form's button. */
export function custodyFormText(day: string, e: ExpectedCash): string {
  return [`💵 ${CUSTODY_TITLE} — ${dayLabel(day)}`, expectedLine(e), `اضغط «${CUSTODY_CTA}» واكتب المبلغ اللي سلّمته وطريقة التسليم، ثم «إرسال».`].join("\n");
}

/**
 * One custody form: the interactive message, inside the number's window only.
 * Nothing is held and no template is used. The cash expected is read now
 * (throws on Odoo trouble: the caller says the form could not go).
 */
export async function sendCustodyForm(env: Env, who: CustodyWho, opts: CustodyFormOpts = {}): Promise<CustodyFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const day = riyadhDateKey(new Date(now));
  const e = opts.expected ?? (await expectedCash(env, who.partnerId, day));
  const rec: CustodyToken = {
    v: 1, token: newCustodyToken(day, who.partnerId), day, to, collectorId: who.partnerId, collector: who.name, expected: e.total, count: e.count, createdAt: now,
    ...(opts.test ? { test: true } : {}),
  };
  await writeCustodyToken(env, rec);
  const mark = opts.test ? `${CUSTODY_TEST_MARK} — ` : "";
  const res = await sendViaGateway(env, {
    purpose: opts.test ? CUSTODY_TEST_PURPOSE : CUSTODY_PURPOSE,
    to,
    content: custodySession(`${mark}${opts.body ?? custodyFormText(day, e)}`, rec.token, custodyData(day, e, mark)),
    noHold: true,
    noHoldReason: "نموذج تسليم العهدة يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(custodyTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token, expected: e.total, count: e.count };
}

// ---------------------------------------------------------------- when it goes

async function tell(env: Env, to: string, text: string, ctx?: ExecutionContext, purpose: string = CUSTODY_PURPOSE): Promise<void> {
  await sendViaGateway(env, { purpose, to, content: textContent(text), ctx });
}

/** The collector asked for the form. Never throws: what cannot go is said in one line. */
export async function startCustody(env: Env, who: CustodyWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<CustodyFormResult> {
  const to = waDigits(who.whatsapp);
  try {
    const r = await sendCustodyForm(env, who, { now, ctx });
    // outside his window nothing is said either: a line held for later would answer nothing
    if (!r.sent && r.reason !== "window_closed") await tell(env, to, CUSTODY_FAILED_TEXT, ctx);
    return r;
  } catch (e) {
    console.warn("[custody] the form could not be sent", (e as Error)?.message);
    try { await tell(env, to, CUSTODY_FAILED_TEXT, ctx); } catch { /* nothing more to say */ }
    return { sent: false, reason: "error" };
  }
}

type Member = { id: number; name: string; x_whatsapp_number?: string | false | null; x_role?: string; x_role_codes?: string[] };
const hasRole = (m: Member, role: string): boolean => (m.x_role_codes ?? (m.x_role ? [m.x_role] : [])).includes(role);

/**
 * A team member's text: «عهدة» / «تسليم العهدة» from a COLLECTOR is answered
 * with the form (true: nothing else replies). Any other text, and the same
 * words from a member without the role, are not this module's (false).
 */
export async function custodyText(env: Env, member: Member, text: string, from: string, ctx?: ExecutionContext): Promise<boolean> {
  if (!custodyCommand(text) || !hasRole(member, CUSTODY_ROLE)) return false;
  await startCustody(env, { partnerId: member.id, name: member.name, whatsapp: String(member.x_whatsapp_number || from) }, ctx);
  return true;
}

/**
 * The button custody_start: the same form, for the number of a team member
 * with the collector role (the roster is read). Null for anyone else: the
 * router answers as it does any button it does not know.
 */
export async function handleCustodyButton(env: Env, buttonId: string, partner: { id: number; name?: string; x_whatsapp_number?: string | false | null } | null): Promise<RouterReply | null> {
  const number = String(partner?.x_whatsapp_number || "");
  if (buttonId !== CUSTODY_BUTTON || !partner?.id || !number) return null;
  try {
    const { loadRoster, memberByNumber } = await import("./team-roster");
    // the number that tapped, as the roster knows it — never the partner the caller names
    const m = memberByNumber(await loadRoster(env), number);
    if (!m || !m.codes.includes(CUSTODY_ROLE)) return null;
    await startCustody(env, { partnerId: m.partnerId, name: m.name, whatsapp: number });
    return { text: "" };
  } catch (e) {
    console.warn("[custody] the button could not be answered", (e as Error)?.message);
    return null;
  }
}

// ---------------------------------------------------------------- the reply

/** «المبلغ المسلَّم»: a number ≥ 0 with at most two decimals — nothing else (an empty field is not an amount). */
export function parseCustodyAmount(raw: unknown): number | "invalid" {
  if (raw === undefined || raw === null) return "invalid";
  let s = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  return Number(s);
}
/** «طريقة التسليم»: one of the Flow's two ids. */
export const parseCustodyHow = (raw: unknown): CustodyHow | "invalid" => (raw === "bank" || raw === "owner" ? raw : "invalid");

/** The figures of a handover, as both messages read them. */
export interface CustodyFigures {
  expected: number;
  count: number;
  handed: number;
  how: CustodyHow;
  /** What the form showed, when the expected cash moved since it was sent. */
  shown?: ExpectedCash;
}
export function custodyLines(f: CustodyFigures): string[] {
  const moved = f.shown ? ` — كان ${money(f.shown.total)} ر.س (${collectionsAr(f.shown.count)}) لما أُرسل النموذج` : "";
  return [
    `الكاش المتوقع: ${money(f.expected)} ر.س (${collectionsAr(f.count)})${moved}`,
    `المسلَّم فعلاً: ${money(f.handed)} ر.س`,
    `الطريقة: ${CUSTODY_HOW[f.how]}`,
    `الفرق: ${differenceText(f.handed - f.expected)}`,
  ];
}
/** The collector's «وصل ✅», with the figures. */
export function collectorText(day: string, f: CustodyFigures, o: { test?: boolean } = {}): string {
  return [`وصل ✅ ${CUSTODY_TITLE} — ${dayLabel(day)}`, ...custodyLines(f), o.test ? "(تجربة: لم يُحفظ شيء، ولم يُرسل تقرير)" : "وصلت لبراء."].join("\n");
}
/**
 * Baraa's message, always: the figures, the collector's note, a second
 * handover as a correction naming the earlier one, the expected cash that
 * could not be read again — and the line saying no entry is made.
 */
export function ownerText(day: string, collector: string, f: CustodyFigures, o: { note?: string; earlier?: CustodyDay | null; unread?: boolean } = {}): string {
  const e = o.earlier;
  return [
    `💵 ${CUSTODY_TITLE} — ${collector} — ${dayLabel(day)}`,
    ...(e ? [`🔁 تصحيح لتسليم سابق اليوم (${hhmm(e.at)}): المسلَّم ${money(e.handed)} ر.س — ${CUSTODY_HOW[e.how]} — المتوقع ${money(e.expected)} ر.س — الفرق ${differenceText(e.diff)}`] : []),
    ...custodyLines(f),
    ...(o.unread ? [CUSTODY_NOT_READ_TEXT] : []),
    ...(o.note ? [`ملاحظته: ${o.note}`] : []),
    CUSTODY_NO_ENTRY_TEXT,
  ].join("\n");
}

export interface CustodyOutcome {
  action: "handed" | "invalid" | "test" | "unknown" | "expired" | "duplicate";
  expected?: number;
  handed?: number;
  diff?: number;
  problems?: string[];
}

/** A reply of the custody form (nfm_reply): read, checked against its token, kept in KV, reported. */
export async function handleCustodyReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<CustodyOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? CUSTODY_TEST_PURPOSE : CUSTODY_PURPOSE;
  const say = (text: string) => tell(env, to, text, ctx, purpose);
  const rec = await readCustodyToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[custody] reply with no token of this number from=${to.slice(-4)}`);
    await say(CUSTODY_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  // the day it was sent, and no other: the cash is a day's
  if (rec.day !== riyadhDateKey(new Date(nowMs))) {
    console.warn(`[custody] reply of another day collector=${rec.collectorId} form=${rec.day} — nothing kept`);
    await say(CUSTODY_EXPIRED_TEXT);
    return { action: "expired" };
  }
  // a token is read once
  const claim = await claimButton(env, `custody_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    console.warn(`[custody] repeated token collector=${rec.collectorId} — not kept again`);
    await say(CUSTODY_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const who: CustodyWho = { partnerId: rec.collectorId, name: rec.collector, whatsapp: to };
    const values = msg.flow?.values ?? {};
    const handed = parseCustodyAmount(values.amt), how = parseCustodyHow(values.how);
    const note = cut(String(values.note ?? "").replace(/\s+/g, " ").trim(), CUSTODY_NOTE_MAX);
    const used = async () => { await writeCustodyToken(env, { ...rec, usedAt: nowMs }); await finishButton(env, claim, TOKEN_TTL); };
    // an amount that is not one, or no way of handing it over: the form is refused, with a fresh one
    if (handed === "invalid" || how === "invalid") {
      await used();
      const problems = [...(handed === "invalid" ? ["amt"] : []), ...(how === "invalid" ? ["how"] : [])];
      const text = ["⚠️ ما انحفظ شيء من النموذج:", ...(handed === "invalid" ? [`• ${CUSTODY_BAD_AMOUNT_TEXT}`] : []), ...(how === "invalid" ? [`• ${CUSTODY_BAD_HOW_TEXT}`] : []), "عبّه من جديد ثم «إرسال» 👇"].join("\n");
      const r = await sendCustodyForm(env, who, { now: nowMs, ctx, body: text, test: rec.test, ...(rec.test ? { expected: { total: rec.expected, count: rec.count } } : {}) }).catch(() => ({ sent: false }));
      if (!r.sent) await say(text);
      return { action: "invalid", problems };
    }
    if (rec.test) {
      await used();
      const f: CustodyFigures = { expected: rec.expected, count: rec.count, handed, how };
      await say(`${CUSTODY_TEST_MARK} — ${collectorText(rec.day, f, { test: true })}${note ? `\nملاحظتك: ${note}` : ""}`);
      return { action: "test", expected: rec.expected, handed, diff: round2(handed - rec.expected) };
    }
    // the cash expected, read AGAIN now: a collection made after the form was sent counts
    let now: ExpectedCash = { total: rec.expected, count: rec.count }, unread = false;
    try {
      now = await expectedCash(env, rec.collectorId, rec.day);
    } catch (e) {
      unread = true;
      console.warn(`[custody] ${rec.day}: the collections could not be read again — the form's figure`, (e as Error)?.message);
    }
    const movedSince = now.total !== rec.expected || now.count !== rec.count;
    const f: CustodyFigures = { expected: now.total, count: now.count, handed, how, ...(movedSince ? { shown: { total: rec.expected, count: rec.count } } : {}) };
    const earlier = await readCustody(env, rec.day, rec.collectorId);
    const day: CustodyDay = {
      v: 1, day: rec.day, collectorId: rec.collectorId, collector: rec.collector, at: nowMs, expected: now.total, count: now.count, handed, how, note,
      diff: round2(handed - now.total), corrections: earlier ? earlier.corrections + 1 : 0,
    };
    await writeCustody(env, day);
    await used();
    await say(collectorText(rec.day, f));
    await sendOwnerMessage(env, ownerText(rec.day, rec.collector, f, { note, earlier, unread }), CUSTODY_OWNER_PURPOSE);
    console.log(`[custody] collector=${rec.collectorId} ${rec.day} handed=${handed} expected=${now.total} diff=${day.diff} how=${how}${earlier ? " (correction)" : ""}`);
    return { action: "handed", expected: now.total, handed, diff: day.diff };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE custody form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. The figure it shows is today's
 * real cash collections of everyone (read-only; 0 when they cannot be read).
 * His reply is answered, and nothing is kept.
 */
export async function sendCustodyFormTest(env: Env, now: number = Date.now()): Promise<CustodyFormResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  const day = riyadhDateKey(new Date(now));
  const claim = await claimButton(env, `custody_test:${CUSTODY_FLOW_ID}:${day}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const expected = await expectedCash(env, null, day).catch(() => ({ total: 0, count: 0 }));
    // his window closed: the form does not go (sendCustodyForm), and the day's trial is not spent
    const r = await sendCustodyForm(env, { partnerId: 0, name: "براء", whatsapp: owner }, { now, test: true, expected });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
