import type { Env } from "./config";
import {
  getActiveStandingOrders, getStandingLines, createOrderFromStanding,
  markStandingTriggered, setOrderConfirmed, getPartnerBasic,
} from "./odoo-v6-append";
import { sendButtons } from "./meta";

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
      const preview = lines.slice(0, 5).map(l =>
        `• ${l.x_product_tmpl_id[1]} ${l.x_packaging_id[1]} × ${l.x_default_quantity}`
      ).join("\n") + (lines.length > 5 ? `\n… و${lines.length - 5} أصناف` : "");
      const body = `مرحباً ${cust.name} 👋
هذا طلبك المعتاد لليوم:
${preview}

نرسله لك زي كل يوم؟`;
      await sendButtons(env, whatsapp, body, [
        { id: `standing_confirm_${s.id}`, title: "تمام أرسلوها" },
        { id: `standing_edit_${s.id}`, title: "أبغى أعدّل" },
        { id: `standing_skip_${s.id}`, title: "لا اليوم شكراً" },
      ]);
      sent++;
    } catch (e) {
      console.error("[standing] error", s.id, (e as Error).message);
      errors++;
    }
  }
  console.log(`[standing] sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}
export async function handleStandingConfirm(env: Env, standingId: number): Promise<string> {
  const all = await getActiveStandingOrders(env);
  const s = all.find(x => x.id === standingId);
  if (!s) return "الطلب المعتاد مو موجود.";
  const orderId = await createOrderFromStanding(env, s);
  if (!orderId) return "ما قدرنا نجهّز الطلب. تواصل مع الإدارة.";
  await setOrderConfirmed(env, orderId);
  return `تم ✅ طلبك المعتاد رقم #${orderId} تحت التجهيز.`;
}
export async function handleStandingEdit(_env: Env, _standingId: number): Promise<string> {
  return `أرسل التعديل بكلمات بسيطة، مثل:
"بدل الطماطم بالخيار"
"زد الخيار كرتون"
"احذف الليمون اليوم"`;
}
export async function handleStandingSkip(env: Env, standingId: number): Promise<string> {
  await markStandingTriggered(env, standingId);
  return "تمام 🙏 نلقاك بكرا.";
}
