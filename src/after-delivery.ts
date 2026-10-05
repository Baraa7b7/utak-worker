// § 58 أ (2026-10-05) — the two buttons after a delivery.
//
// The invoice's template and the «تم التسليم» template are Meta's approved
// ones: they carry the buttons Meta approved, so «🏦 أرسلت تحويل» and «⚠️ عندي
// ملاحظة» (which § 57 put under the two FREE texts) never showed on prod, where
// an approved template goes before the free text even inside the window.
//
// Now, after the invoice or «تم التسليم» reached the customer — whichever way
// each went, and neither send is touched — ONE short interactive message with
// the two buttons: «لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇».
//
//   • inside the customer's 24h window only: never a template, never held;
//     outside it nothing is sent, and the order's one time is not spent;
//   • once an order (a KV claim per order, thirty days): a second «تم التسليم»,
//     a retry, a later send of the same invoice never send it again;
//   • the buttons are the forms' own (src/transfer-form.ts TRANSFER_BUTTON,
//     src/complaint-form.ts COMPLAINT_BUTTON): the router answers them as it
//     answers the ones under the free texts;
//   • nothing is read from Odoo and nothing is written: no price, no amount.

import type { Env } from "./config";
import { buttonsContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { readWindow, waDigits } from "./wa-window";
import { riyadhDateKey } from "./hours";
import { transferNoticeButton } from "./transfer-form";
import { complaintStartButton } from "./complaint-form";

export const AFTER_DELIVERY_PURPOSE = "customer_after_delivery";
export const AFTER_DELIVERY_TEST_PURPOSE = "after_delivery_test";
export const AFTER_DELIVERY_TEXT = "لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇";
export const AFTER_DELIVERY_TEST_MARK = "🧪 تجربة";
/** One time an order: the claim outlives any retry of its delivery. */
export const AFTER_DELIVERY_KEEP_SEC = 30 * 24 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
export const afterDeliveryLock = (orderId: number): string => `after_delivery:${orderId}`;
/** The trial's two buttons: Baraa's tap on either is answered with one line, and opens no form. */
export const AFTER_DELIVERY_TEST_RE = /^aftest_(transfer|note)$/;
export const AFTER_DELIVERY_TEST_TAIL = "(تجربة: لم يُكتب شيء، ولم تصل رسالة لأحد غيرك)";

export interface AfterDeliveryResult { sent: boolean; reason?: string }

/** The order's ONE message with the two buttons. Never throws: what could not go is a reason. */
export async function offerAfterDelivery(env: Env, a: { orderId: number; to: string; now?: number; ctx?: ExecutionContext }): Promise<AfterDeliveryResult> {
  try {
    const to = waDigits(a.to);
    if (!to || !a.orderId) return { sent: false, reason: "no_number" };
    // outside his window: nothing — and the order's one time stays for a send inside it
    if (!(await readWindow(env, to, a.now ?? Date.now())).open) return { sent: false, reason: "window_closed" };
    const claim = await claimButton(env, afterDeliveryLock(a.orderId), AFTER_DELIVERY_KEEP_SEC);
    if (!claim.claimed) return { sent: false, reason: "already" };
    try {
      const res = await sendViaGateway(env, {
        purpose: AFTER_DELIVERY_PURPOSE,
        to,
        content: buttonsContent(AFTER_DELIVERY_TEXT, [transferNoticeButton(), complaintStartButton()]),
        noHold: true,
        noHoldReason: "زرّا التحويل والملاحظة يُرسلان داخل نافذة 24 ساعة فقط",
        ctx: a.ctx,
      });
      const d = gatewayDecision(res);
      if (d?.action !== "session") {
        await releaseButton(env, claim);
        return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
      }
      await finishButton(env, claim, AFTER_DELIVERY_KEEP_SEC);
      return { sent: true };
    } catch (e) {
      await releaseButton(env, claim);
      throw e;
    }
  } catch (e) {
    console.warn(`[after-delivery] order ${a.orderId}: the two buttons were not sent`, (e as Error)?.message);
    return { sent: false, reason: "error" };
  }
}

// ---------------------------------------------------------------- the trial to Baraa

export const afterDeliveryTestText = (): string => `${AFTER_DELIVERY_TEST_MARK} — هكذا تصل العميل بعد الفاتورة أو «تم التسليم» (داخل نافذته فقط، مرة لكل طلب):\n${AFTER_DELIVERY_TEXT}`;
/** What Baraa reads when he taps one of the trial's two buttons. */
export function afterDeliveryTestAnswer(which: string): string {
  const what = which === "transfer" ? "«🏦 أرسلت تحويل» يفتح للعميل نموذج «إشعار تحويل» بفواتيره المفتوحة" : "«⚠️ عندي ملاحظة» يفتح للعميل نموذج الملاحظة على أصناف طلبه المسلَّم";
  return `${AFTER_DELIVERY_TEST_MARK} — ${what}.\n${AFTER_DELIVERY_TEST_TAIL}`;
}

/**
 * The two buttons to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. The buttons are the trial's own
 * (aftest_…): a tap is answered with one line and opens no form. Nothing is
 * read from Odoo and nothing is written.
 */
export async function sendAfterDeliveryTest(env: Env, now: number = Date.now()): Promise<AfterDeliveryResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `after_delivery_test:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const res = await sendViaGateway(env, {
      purpose: AFTER_DELIVERY_TEST_PURPOSE,
      to: owner,
      content: buttonsContent(afterDeliveryTestText(), [
        { id: "aftest_transfer", title: transferNoticeButton().title },
        { id: "aftest_note", title: complaintStartButton().title },
      ]),
      noHold: true,
      noHoldReason: "تجربة زرّي التحويل والملاحظة تُرسل داخل نافذة 24 ساعة فقط",
    });
    const d = gatewayDecision(res);
    if (d?.action !== "session") {
      await releaseButton(env, claim);
      return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
    }
    await finishButton(env, claim, DAY_TTL);
    return { sent: true };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/** Baraa's tap on a trial button: one line. Null: not one of them, or not his number. */
export async function answerAfterDeliveryTest(env: Env, buttonId: string, from: string, ctx?: ExecutionContext): Promise<string | null> {
  const m = AFTER_DELIVERY_TEST_RE.exec(String(buttonId ?? ""));
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!m || !owner || waDigits(from) !== owner) return null;
  const { textContent } = await import("./meta");
  await sendViaGateway(env, { purpose: AFTER_DELIVERY_TEST_PURPOSE, to: owner, content: textContent(afterDeliveryTestAnswer(m[1])), ctx });
  return m[1];
}
