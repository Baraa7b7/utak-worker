// v6.1 → v7: Standing Orders — evening reminder via approved template
import type { Env } from "./config";
import {
  getActiveStandingOrders, getStandingLines, createOrderFromStanding,
  markStandingTriggered, setOrderConfirmed, getPartnerBasic,
} from "./odoo-v6-append";
import { sendTemplateByPurpose, T } from "./templates";

/**
 * Cron 14:00 UTC = 17:00 Riyadh — send standing-order reminder using
 * approved `utak_v2_daily_remind` template (2 buttons: confirm / edit).
 * A "no reply within 3h" is treated as skip; no third button needed.
 */
export async function sendStandingOrderReminders(env: Env): Promise<{
  sent: number; skipped: number; errors: number;
}> {
  const standings = await getActiveStandingOrders(env);
  let sent = 0, skipped = 0, errors = 0;
  for (const s of standings) {
    try {
      const cust = await getPartnerBasic(env, s.x_customer_id[0]);
      const whatsapp = cust?.whatsapp || cust?.phone;
      if (!cust || !whatsapp) { skipped++; continue; }
      const lines = await getStandingLines(env, s.id);
      if (lines.length === 0) { skipped++; continue; }
      const resp = await sendTemplateByPurpose(env, whatsapp, T.CUSTOMER_DAILY_REMIND,
        [cust.name || ""],
        [
          { index: 0, payload: `standing_confirm_${s.id}` },
          { index: 1, payload: `standing_edit_${s.id}` },
        ]);
      if (resp && resp.ok) sent++;
      else { errors++; console.warn("[standing] send failed", await resp?.text()); }
    } catch (e) {
      console.error("[standing] error", s.id, (e as Error).message);
      errors++;
    }
  }
  console.log(`[standing] sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}

/** "تمام أرسلوها" → create order + confirm. */
export async function handleStandingConfirm(env: Env, standingId: number): Promise<string> {
  const all = await getActiveStandingOrders(env);
  const stan = all.find(x => x.id === standingId);
  if (!stan) return "الطلب المعتاد مو موجود.";
  const orderId = await createOrderFromStanding(env, stan);
  if (!orderId) return "ما قدرنا نجهّز الطلب. تواصل مع الإدارة.";
  await setOrderConfirmed(env, orderId);
  return `تم ✅ طلبك المعتاد رقم #${orderId} تحت التجهيز.`;
}

/** "أبغى أعدّل" → instructions for now (deep NL parser deferred). */
export async function handleStandingEdit(_env: Env, _standingId: number): Promise<string> {
  return `أرسل التعديل بكلمات بسيطة، مثل:
"بدل الطماطم بالخيار"
"زد الخيار كرتون"
"احذف الليمون اليوم"`;
}

/** Legacy 3-button path (kept for backward compat with any old messages in-flight). */
export async function handleStandingSkip(env: Env, standingId: number): Promise<string> {
  await markStandingTriggered(env, standingId);
  return "تمام 🙏 نلقاك بكرا.";
}
