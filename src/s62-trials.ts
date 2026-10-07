// § 62 هـ (2026-10-07) — the three trials of «طلب أسعار خاص» to Baraa's own number.
//
// Each one: his number alone (no other can be named), marked «🧪 تجربة», only
// while his 24h window is open (nothing held, no template), once a Riyadh day.
// Nothing is written in Odoo, no source and no customer is reached.
//
//   purchase    the special form as a «شراء» source reads it (the quantities in
//               the hints, «سعرك بالكيلو بدون ضريبة») — of the newest open request
//   market      the same form as a «سوق» source reads it (no quantity at all)
//   quotation   the request's quotation as a PDF with ILLUSTRATIVE prices that
//               say so: no sale.order is made, no number is taken, no seal
//
// A trial form's reply is answered and writes nothing (its token says «test»).

import type { Env } from "./config";
import { call } from "./odoo";
import { documentContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import type { PriceKind } from "./price-sources";
import { QUOTE_MODEL, quoteName, readQuote, type SpecialQuote } from "./special-quote";
import { SPECIAL_TEST_PURPOSE, placeLines, prepareSpecialAsk, specialCategories, specialItems } from "./special-ask";
import { CLOSING_LINE, specialQuotationData } from "./special-quotation";
import { grossOf, netOf } from "./special-quote-math";
import type { QuotationPDFData } from "./quotation";

export const S62_TRIAL_MARK = "🧪 تجربة";
export const S62_TRIAL_NAMES = ["purchase", "market", "quotation"] as const;
export type S62TrialName = (typeof S62_TRIAL_NAMES)[number];
export const S62_TRIAL_TAIL = "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لمصدر ولا للعميل)";
export interface S62TrialResult { sent: boolean; reason?: string; quote?: string; items?: number; number?: string }
const DAY_TTL = 26 * 60 * 60;

/** The request a trial shows: the one named, else the newest real request that is not closed. */
export async function trialQuote(env: Env, id?: number): Promise<SpecialQuote | null> {
  if (id && id > 0) return readQuote(env, id);
  const [r] = await call<Array<{ id: number }>>(env, QUOTE_MODEL, "search_read", {
    domain: [["x_utak_simulation", "!=", true], ["x_state", "!=", "closed"]], fields: ["id"], order: "id desc", limit: 1,
  });
  return r ? readQuote(env, r.id) : null;
}

async function once(env: Env, name: string, now: number, send: (owner: string) => Promise<S62TrialResult>): Promise<S62TrialResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `s62_trial:${name}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
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
const whyNot = (d: ReturnType<typeof gatewayDecision>): string => (d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision");

/** The special form as a source of this role reads it, to Baraa: the request's real lines, his own number. */
export async function sendAskTrial(env: Env, kind: PriceKind, now: number = Date.now(), id?: number): Promise<S62TrialResult> {
  return once(env, kind, now, async (owner) => {
    const q = await trialQuote(env, id);
    if (!q) return { sent: false, reason: "no_request" };
    const lines = q.lines.filter((l) => l.productId > 0);
    if (!lines.length) return { sent: false, reason: "no_lines", quote: quoteName(q.id) };
    const cats = await specialCategories(env, [...new Set(lines.map((l) => l.productId))]);
    const placed = placeLines(lines, cats.of, cats.titles);
    const items = specialItems(placed, kind);
    // the name the text greets: the request's own source of this role (never reached here)
    const name = q.recipients.find((r) => r.role === kind)?.name || (kind === "purchase" ? "المورد" : "مصدر السوق");
    const p = await prepareSpecialAsk(env, { quoteId: q.id, recipientId: 0, partnerId: 0, name, whatsapp: owner, kind }, items, placed.pages, { now, test: true });
    const d = gatewayDecision(await sendViaGateway(env, { purpose: SPECIAL_TEST_PURPOSE, to: owner, content: p.session, noHold: true, noHoldReason: "تجارب § 62 تُرسل داخل نافذة 24 ساعة فقط" }));
    return d?.action === "session" ? { sent: true, quote: quoteName(q.id), items: items.length } : { sent: false, reason: whyNot(d), quote: quoteName(q.id) };
  });
}

/** An illustrative price for line i: plainly not a real one (5, 6.25, 7.5, …). */
export const illustrativePrice = (i: number): number => 5 + (i % 8) * 1.25;
export const trialQuotationNumber = (id: number): string => `SQ-TRIAL-${String(id).padStart(4, "0")}`;
export const TRIAL_NOTE = `تجربة — الأسعار توضيحية وليست عرضاً: لا يُعتمد هذا المستند. (السطر الختامي للعرض: ${CLOSING_LINE})`;
export function quotationTrialCaption(number: string, quote: string, lines: number): string {
  return [
    `${S62_TRIAL_MARK} — هكذا يصل عرض سعر الطلب الخاص ${quote}: ملف PDF مرفق (${number}.pdf) بأصنافه الـ ${lines}.`,
    "الأسعار فيه توضيحية ومكتوب عليه «تجربة»: ليس عرضاً، ولم يُسجَّل عرض في Odoo.",
    S62_TRIAL_TAIL,
  ].join("\n");
}

/** The trial quotation's data: the request's lines at ILLUSTRATIVE prices (never its real ones), marked «تجربة», not issued (no seal). Pure. */
export function trialQuotationData(q: SpecialQuote, now: number): QuotationPDFData {
  // the illustrative price stands where the request's own would: before VAT or with it, by «الأسعار في العرض»
  const shown: SpecialQuote = { ...q, lines: q.lines.map((l, i) => ({ ...l, finalPrice: q.priceMode === "net" ? grossOf(illustrativePrice(i)) : illustrativePrice(i), finalNet: q.priceMode === "net" ? illustrativePrice(i) : netOf(illustrativePrice(i)), qty: l.qty > 0 ? l.qty : 1 })) };
  return {
    ...specialQuotationData(shown, trialQuotationNumber(q.id), { name: `${S62_TRIAL_MARK} — ${q.partnerName || "عميل"}`, address: "", phone: "" }, now, { issued: false }),
    footerNote: TRIAL_NOTE,
  };
}

/** The request's quotation as a PDF with illustrative prices that say so. No sale.order, no number, no seal. */
export async function sendQuotationTrial(env: Env, now: number = Date.now(), id?: number): Promise<S62TrialResult> {
  return once(env, "quotation", now, async (owner) => {
    const q = await trialQuote(env, id);
    if (!q) return { sent: false, reason: "no_request" };
    if (!q.lines.length) return { sent: false, reason: "no_lines", quote: quoteName(q.id) };
    const data = trialQuotationData(q, now);
    const number = data.quotationNumber;
    const { generateQuotationPDF, uploadQuotationToR2 } = await import("./quotation");
    const pdf = await generateQuotationPDF(data, env);
    const uploaded = await uploadQuotationToR2(env, pdf, number, env.WORKER_ORIGIN);
    const d = gatewayDecision(await sendViaGateway(env, {
      purpose: SPECIAL_TEST_PURPOSE, to: owner, content: documentContent(uploaded.publicUrl, number, quotationTrialCaption(number, quoteName(q.id), data.items.length)),
      noHold: true, noHoldReason: "تجارب § 62 تُرسل داخل نافذة 24 ساعة فقط",
    }));
    return d?.action === "session" ? { sent: true, quote: quoteName(q.id), items: data.items.length, number } : { sent: false, reason: whyNot(d), quote: quoteName(q.id) };
  });
}

export async function sendS62Trial(env: Env, name: string, id?: number, now: number = Date.now()): Promise<S62TrialResult> {
  if (name === "purchase" || name === "market") return sendAskTrial(env, name, now, id);
  if (name === "quotation") return sendQuotationTrial(env, now, id);
  return { sent: false, reason: "unknown_trial" };
}
