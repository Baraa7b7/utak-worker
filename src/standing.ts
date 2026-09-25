// v6.1 → v7: Standing Orders — evening reminder via approved template
import type { Env } from "./config";
import {
  getActiveStandingOrders, getStandingLines, createOrderFromStanding,
  markStandingTriggered, setOrderConfirmed, getPartnerBasic,
} from "./odoo-v6-append";
import { sendTemplateByPurpose, T } from "./templates";
import { heldPartnerIds } from "./screening";
import { isAfterPurchaseCutoff, nextOrderingDate, riyadhDateKey } from "./hours";

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
  // 2026-09-25 (STATUS § 30) — no reminder to a partner held from customer automation.
  const held = await heldPartnerIds(env, standings.map((s) => s.x_customer_id[0]));
  for (const s of standings) {
    if (held.has(s.x_customer_id[0])) { skipped++; console.log(`[standing] ${s.id} held for review`); continue; }
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

/**
 * "تمام أرسلوها" → create today's order from the standing list + confirm.
 * 2026-09-24 (ح9):
 *   • a standing order already registered for today is not created twice —
 *     the reply says it is already there (the button lock in router.ts also
 *     refuses a second tap the same day);
 *   • after 21:15 the purchase list has gone, so the tap gets the ح2 prompt
 *     («سجّله لبكرة» / «لا شكراً») with the standing lines.
 */
export async function handleStandingConfirm(
  env: Env,
  standingId: number,
  now: Date = new Date(),
): Promise<{ text?: string; bodyBeforeButtons?: string; buttons?: Array<{ id: string; title: string }> }> {
  const all = await getActiveStandingOrders(env);
  const stan = all.find(x => x.id === standingId);
  if (!stan) return { text: "الطلب المعتاد مو موجود." };
  const customerId = stan.x_customer_id[0];
  const { findLiveOrderOn } = await import("./odoo");

  if (isAfterPurchaseCutoff(now)) {
    const target = nextOrderingDate(now);
    const existing = await findLiveOrderOn(env, customerId, target, "standing_order");
    if (existing) return { text: `طلب الغد مسجّل أصلاً برقم #${existing} ✅ وما سجّلنا طلباً ثانياً.` };
    const lines = await getStandingLines(env, standingId);
    if (lines.length === 0) return { text: "قائمتك الثابتة فاضية. تواصل مع الإدارة." };
    const { offerLateOrder } = await import("./late-order");
    return await offerLateOrder(env, customerId, lines.map((l) => ({
      product_id: l.x_product_tmpl_id[0],
      packaging_id: l.x_packaging_id[0],
      quantity: l.x_default_quantity,
      notes: typeof l.x_notes === "string" ? l.x_notes : "",
      label: `${l.x_product_tmpl_id[1]} ${l.x_packaging_id[1]} × ${l.x_default_quantity}`,
    })), {
      via: "standing_order",
      now,
      lead: "قائمة شراء الليلة طلعت الساعة 9:15 مساءً، فطلبك المعتاد ما يلحق طلبات اليوم.",
    });
  }

  const existing = await findLiveOrderOn(env, customerId, riyadhDateKey(now), "standing_order");
  if (existing) return { text: `طلب الغد مسجّل أصلاً برقم #${existing} ✅ وما سجّلنا طلباً ثانياً.` };
  const orderId = await createOrderFromStanding(env, stan);
  if (!orderId) return { text: "ما قدرنا نجهّز الطلب. تواصل مع الإدارة." };
  await setOrderConfirmed(env, orderId);
  // 2026-09-23 (ACCOUNTING_SYNC) — confirmed order → confirmed sale.order.
  const { ensureSaleOrderForDailyOrder } = await import("./sale-accounting");
  await ensureSaleOrderForDailyOrder(env, orderId);
  return { text: `تم ✅ طلبك المعتاد رقم #${orderId} تحت التجهيز.` };
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
