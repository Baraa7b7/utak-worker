// ============================================================
// 2026-09-24 (م2) — a customer answers the 08:00 payment reminder with
// «حولت» / «دفعت» or a receipt image.
//
// Before: the text went to the classifier (a generic reply, or none) and the
// image got the ح5 «وصلتنا صورة» reply; nobody who collects money heard of
// it. Now, within PAY_CLAIM_WINDOW_H of a reminder that reached Meta:
//   • the customer gets an honest «وصلنا، المحصّل بيتأكد» reply;
//   • the owner gets an alert (template-backed, always delivered);
//   • each collector who is inside Meta's 24h window gets the same note as
//     text (outside it free text fails with #131047, and the owner alert
//     already carries it).
// Alerts are throttled per customer (PAY_CLAIM_ALERT_EVERY_H) so «حولت» then
// a receipt then «تمام» does not ring three times.
// ============================================================
import type { Env } from "./config";
import { normalizeCommand } from "./optout";

export const PAY_CLAIM_WINDOW_H = 48;
export const PAY_CLAIM_ALERT_EVERY_H = 6;

export const kvPayRemindSent = (partnerId: number): string => `payremind_sent:${partnerId}`;
const kvPayClaimAlert = (partnerId: number): string => `payclaim_alert:${partnerId}`;

export interface PayRemindSent {
  amount: number;
  /** epoch ms of the reminder. */
  at: number;
}

export const PAY_CLAIM_REPLY =
  "شكراً لك ✅ وصلنا إشعار التحويل، والمحصّل بيتأكد منه ويرسل لك الإيصال.";
export const PAY_RECEIPT_REPLY =
  "شكراً لك ✅ وصلنا الإيصال، والمحصّل بيتأكد من التحويل ويرسل لك الإيصال الرسمي.";

// After normalizeCommand: no shadda / hamza, lower case.
const CLAIM_RE =
  /(حولت|حولنا|حولناها|تم التحويل|دفعت|دفعنا|سددت|سددنا|تم الدفع|تم السداد|حواله|حوالة|ارسلت المبلغ|ارسلنا المبلغ|\btransferred\b|\bpaid\b)/;

export function isPaymentClaim(text: string | null | undefined): boolean {
  return !!text && CLAIM_RE.test(normalizeCommand(text));
}

export async function markPayRemindSent(env: Env, partnerId: number, amount: number): Promise<void> {
  const v: PayRemindSent = { amount, at: Date.now() };
  await env.MSG_DEDUP.put(kvPayRemindSent(partnerId), JSON.stringify(v), {
    expirationTtl: PAY_CLAIM_WINDOW_H * 3600,
  });
}

/** The reminder this customer got in the last PAY_CLAIM_WINDOW_H, if any. */
export async function readPayRemindSent(env: Env, partnerId: number): Promise<PayRemindSent | null> {
  try {
    const raw = await env.MSG_DEDUP.get(kvPayRemindSent(partnerId));
    if (!raw) return null;
    const v = JSON.parse(raw) as PayRemindSent;
    if (!(v.at > 0) || Date.now() - v.at > PAY_CLAIM_WINDOW_H * 3600 * 1000) return null;
    return v;
  } catch (e) {
    console.warn("[pay-claim] KV read failed", (e as Error)?.message);
    return null;
  }
}

/**
 * Tell the owner (and collectors inside the 24h window) that a reminded
 * customer says they paid. `evidence` is the customer's text or «صورة إيصال».
 */
export async function notifyPaymentClaim(
  env: Env,
  customer: { id: number; name: string },
  reminded: PayRemindSent,
  evidence: string,
): Promise<{ alerted: boolean; collectors: number }> {
  const throttle = kvPayClaimAlert(customer.id);
  if (await env.MSG_DEDUP.get(throttle).catch(() => null)) return { alerted: false, collectors: 0 };
  await env.MSG_DEDUP.put(throttle, "1", { expirationTtl: PAY_CLAIM_ALERT_EVERY_H * 3600 }).catch(() => {});

  const amount = reminded.amount.toFixed(2);
  const note = `💰 ${customer.name} (#${customer.id}) يقول إنه حوّل بعد تذكير الدفع (المستحق ${amount} ر.س): ${evidence.slice(0, 200)}. تأكد من الحساب، ثم سجّل التحصيل من رسالة الفاتورة.`;
  const { sendOwnerAlert } = await import("./templates");
  await sendOwnerAlert(env, note);

  let collectors = 0;
  try {
    const { getTeamMembersByRole } = await import("./odoo");
    const { isInside24hWindow } = await import("./wa-inbox");
    const { sendText } = await import("./meta");
    for (const c of await getTeamMembersByRole(env, "collector")) {
      if (!c.x_whatsapp_number || !(await isInside24hWindow(env, c.id))) continue;
      const r = await sendText(env, c.x_whatsapp_number, note);
      if (r.ok) collectors++;
    }
  } catch (e) {
    console.warn("[pay-claim] collector notice failed", (e as Error)?.message);
  }
  return { alerted: true, collectors };
}
