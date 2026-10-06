// § 59 ز (2026-10-06) — the trials of § 59 to Baraa's own number.
//
// Each one: his number alone (no other can be named), marked «🧪 تجربة», only
// while his 24h window is open (nothing held, no template — but «بدء الدوام»,
// which IS a template: it goes as it reaches him every day), once a Riyadh day.
// Nothing is written in Odoo, no order, no quotation record, no payment, and it
// reaches nobody but him.
//
//   prices       «📋 قائمة أسعار يو تاك اليوم» as the marketing member gets it
//                (src/team-prices.ts): the valid list's published items — or,
//                with none valid, the last real day's as an example that says so
//   quotation    a quotation's PDF as an ATTACHED FILE (UTAK-Q-….pdf, § 59 د):
//                a sample quotation of the same items, its words as the caption
//   shift        «بدء الدوام» as it reaches him now (utak_shift_start_v2, § 59 أ),
//                after one line that says so
//   form / unavailable   the order form's message with «المتوفر اليوم», and the
//                «هذا الصنف غير متوفر اليوم 🌿» answer (src/order-form.ts
//                sendOrderFormTest)

import type { Env } from "./config";
import { call } from "./odoo";
import { documentContent, textContent } from "./meta";
import { gatewayDecision, sendViaGateway, type GwOption } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { validPriceList } from "./price-validity";
import { orderLink, teamPriceItems, teamPriceListParts, type TeamPriceItem } from "./team-prices";

export const S59_TRIAL_MARK = "🧪 تجربة";
export const TEAM_PRICES_TEST_PURPOSE = "team_prices_test";
export const QUOTATION_FILE_TEST_PURPOSE = "quotation_file_test";
export const SHIFT_START_TEST_PURPOSE = "shift_start_test";
export const S59_TRIAL_TAIL = "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)";
export const S59_TRIAL_NAMES = ["prices", "form", "unavailable", "quotation", "shift"] as const;
export type S59TrialName = (typeof S59_TRIAL_NAMES)[number];
export interface S59TrialResult { sent: boolean; reason?: string; example?: boolean; items?: number; number?: string }

const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";

/** The valid list's items — or, with none valid, the last real day's lines that carry a price (an example, said to be one). */
async function trialItems(env: Env, now: number): Promise<{ day: string; items: TeamPriceItem[]; example: boolean }> {
  const list = await validPriceList(env, now);
  if (list) {
    const items = await teamPriceItems(env, list);
    if (items.length) return { day: list.day, items, example: false };
  }
  const [last] = await call<Array<{ id: number; x_date: string }>>(env, "x_price_day", "search_read", {
    domain: [[SIM_FIELD, "!=", true]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1,
  });
  if (!last) return { day: riyadhDateKey(new Date(now)), items: [], example: true };
  const { listItems } = await import("./order-form");
  const all = (await listItems(env, { dayId: last.id }, true)).filter((i) => i.price > 0);
  return { day: last.x_date, items: all.map((i) => ({ productName: i.productName, packagingName: i.packagingName, price: i.price })), example: true };
}

/** One trial's frame: his number, his open window, once a day; `send` says what went. */
async function once(env: Env, name: string, now: number, send: (owner: string) => Promise<S59TrialResult>): Promise<S59TrialResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `s59_trial:${name}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const r = await send(owner);
    if (r.sent) await finishButton(env, claim, DAY_TTL);
    else await releaseButton(env, claim);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
const went = async (env: Env, purpose: string, to: string, content: GwOption): Promise<string> => {
  const d = gatewayDecision(await sendViaGateway(env, { purpose, to, content, noHold: true, noHoldReason: "تجارب § 59 تُرسل داخل نافذة 24 ساعة فقط" }));
  return d?.action === "session" || d?.action === "template" ? "" : d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision";
};

/** What the trial says above the list. */
export function teamPricesTestHead(example: boolean): string {
  return `${S59_TRIAL_MARK} — هكذا تصل عمر قائمة الأسعار مع كل نشر (ويعيد إرسالها كما هي لأي محل)${example ? "، بأسعار آخر يوم كمثال: لا قائمة صالحة الآن" : "، بأسعار القائمة الصالحة الآن"}:`;
}

/** The marketing member's price list, as he gets it. */
export async function sendTeamPricesTest(env: Env, now: number = Date.now()): Promise<S59TrialResult> {
  return once(env, "prices", now, async (owner) => {
    const t = await trialItems(env, now);
    if (!t.items.length) return { sent: false, reason: "no_items" };
    const parts = teamPriceListParts(t.day, t.items, orderLink(env));
    const why = await went(env, TEAM_PRICES_TEST_PURPOSE, owner, textContent(`${teamPricesTestHead(t.example)}\n${S59_TRIAL_TAIL}`));
    if (why) return { sent: false, reason: why };
    for (const part of parts) await went(env, TEAM_PRICES_TEST_PURPOSE, owner, textContent(part));
    return { sent: true, example: t.example, items: t.items.length };
  });
}

/** The trial quotation's number: «UTAK-Q-TRIAL-20261006» (never a real quotation's). */
export const trialQuotationNumber = (day: string): string => `UTAK-Q-TRIAL-${day.replace(/-/g, "")}`;
export function quotationFileTestCaption(number: string, total: number, example: boolean): string {
  return [
    `${S59_TRIAL_MARK} — هكذا يصل العميل عرض السعر: ملف PDF مرفق باسمه (${number}.pdf)، لا رابط.`,
    `📄 عرض السعر رقم ${number}`,
    `الإجمالي: ${total} ر.س`,
    example ? "الأصناف من آخر يوم أسعار كمثال (كرتون واحد من كل صنف)." : "الأصناف من القائمة الصالحة الآن (كرتون واحد من كل صنف).",
    S59_TRIAL_TAIL,
  ].join("\n");
}

/** A quotation's PDF as an attached file: a sample of the list's first items, one carton each. */
export async function sendQuotationFileTest(env: Env, now: number = Date.now()): Promise<S59TrialResult> {
  return once(env, "quotation", now, async (owner) => {
    const t = await trialItems(env, now);
    if (!t.items.length) return { sent: false, reason: "no_items" };
    const { generateQuotationPDF, uploadQuotationToR2 } = await import("./quotation");
    const { isVatApplicable } = await import("./config");
    const { fullName } = await import("./prices");
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const items = t.items.slice(0, 6).map((i) => ({ name: fullName(i.productName), pack: i.packagingName, qty: 1, price: i.price, total: i.price }));
    const grandTotal = round2(items.reduce((s, i) => s + i.total, 0));
    const vat = isVatApplicable(riyadhDateKey(new Date(now)));
    const vatAmount = vat ? round2(grandTotal - grandTotal / 1.15) : 0;
    const number = trialQuotationNumber(riyadhDateKey(new Date(now)));
    const pdf = await generateQuotationPDF({
      quotationNumber: number, quotationDate: new Date(now),
      customer: { name: `${S59_TRIAL_MARK} — عميل تجربة`, address: "", phone: "" },
      items, subtotal: round2(grandTotal - vatAmount), discount: 0, vatAmount, grandTotal, vatInclusive: vat,
      price_warnings: [], has_blocking_issue: false,
    }, env);
    const uploaded = await uploadQuotationToR2(env, pdf, number, env.WORKER_ORIGIN);
    const why = await went(env, QUOTATION_FILE_TEST_PURPOSE, owner, documentContent(uploaded.publicUrl, number, quotationFileTestCaption(number, grandTotal, t.example)));
    return why ? { sent: false, reason: why } : { sent: true, example: t.example, items: items.length, number };
  });
}

export function shiftStartTestText(day: string): string {
  return [
    `${S59_TRIAL_MARK} — بعد هذه الرسالة يصلك قالب «بدء الدوام» كما يصلك الآن كل يوم الساعة 2:00 (${arabicDate(day)} مثالاً):`,
    "ضغطتك عليه تفتح نافذتك 24 ساعة وتسلّمك مهامك: قائمة الشراء المفتوحة، والتحصيلات غير المحصّلة، وما حُفظ لك.",
    "(تجربة: القالب حقيقي وضغطته تعمل كما في كل يوم؛ لا يُسجَّل حضور ولا يُكتب شيء)",
  ].join("\n");
}

/** «بدء الدوام» as it reaches Baraa now: one line, then the template itself. */
export async function sendShiftStartTest(env: Env, now: number = Date.now()): Promise<S59TrialResult> {
  return once(env, "shift", now, async (owner) => {
    const why = await went(env, SHIFT_START_TEST_PURPOSE, owner, textContent(shiftStartTestText(riyadhDateKey(new Date(now)))));
    if (why) return { sent: false, reason: why };
    const { sendTemplateByPurpose, T } = await import("./templates");
    const { OWNER_WINDOW_PURPOSE, SHIFT_START_PAYLOAD } = await import("./attendance");
    const r = await sendTemplateByPurpose(env, owner, T.TEAM_SHIFT_START, ["براء"], [{ index: 0, payload: SHIFT_START_PAYLOAD }], undefined, { sendPurpose: OWNER_WINDOW_PURPOSE });
    const d = gatewayDecision(r);
    return d?.action === "template" ? { sent: true } : { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : `http_${r.status}` };
  });
}

/** One trial by its name (the hook's). */
export async function sendS59Trial(env: Env, name: string, now: number = Date.now()): Promise<S59TrialResult> {
  if (name === "prices") return sendTeamPricesTest(env, now);
  if (name === "quotation") return sendQuotationFileTest(env, now);
  if (name === "shift") return sendShiftStartTest(env, now);
  if (name === "form" || name === "unavailable") {
    const { sendOrderFormTest } = await import("./order-form");
    return sendOrderFormTest(env, now, name === "unavailable" ? "unavailable" : "form");
  }
  return { sent: false, reason: "unknown_trial" };
}
