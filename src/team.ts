// v4 — team orchestration
//
// Two crons:
//   21:00 Riyadh (18:00 UTC) → closeUnconfirmedOrders
//   21:15 Riyadh (18:15 UTC) → aggregateAndDispatchToWarehouse
//
// Two follow-up flows triggered by button taps (handled in router.ts):
//   purchase_done_{listId}         → warehouseConfirmedPurchase → build routes → dispatch drivers
//   delivered_{orderId}            → markStopDelivered + reply to customer
//   delivery_issue_{orderId}       → markStopIssue (note captured from next driver message)
//
// Templates: purchase list / driver route / collection list are pre-registered in
// x_whatsapp_template but their Meta IDs are still PENDING_ until approved. Until
// then we fall back to sendText+sendButtons — team members are internal so the
// customer 24h session-window rule is not a concern.

import type { Env } from "./config";
import type { TeamMember, RouteStop } from "./types";
import {
  aggregatePurchaseList,
  buildAndCreateRoutesForDrivers,
  cancelStaleWaitingOrders,
  createPurchaseListRecord,
  getConfirmedLinesForToday,
  getLatestPurchaseListToday,
  getTeamMembersByRole,
  markPurchaseListDone,
  markPurchaseListSent,
} from "./odoo";
import { sendButtons, sendText } from "./meta";

// ============================================================
// 21:00 Riyadh — auto-cancel unconfirmed orders
// ============================================================
export async function closeUnconfirmedOrders(env: Env): Promise<void> {
  const ids = await cancelStaleWaitingOrders(env);
  console.log(`[cron 21:00] cancelled ${ids.length} waiting_confirmation orders`);
  if (ids.length > 0 && env.OWNER_WHATSAPP) {
    await sendText(
      env,
      env.OWNER_WHATSAPP,
      `📊 إقفال الطلبات\nتم إلغاء ${ids.length} طلب لم يُؤكَّد اليوم.`,
    );
  }
}

// ============================================================
// 21:15 Riyadh — aggregate + send list to Ahmad (warehouse)
// ============================================================
export async function aggregateAndDispatchToWarehouse(env: Env): Promise<void> {
  const lines = await getConfirmedLinesForToday(env);
  if (lines.length === 0) {
    console.log("[cron 21:15] no confirmed lines today");
    if (env.OWNER_WHATSAPP) {
      await sendText(env, env.OWNER_WHATSAPP, "📊 21:15\nلا يوجد طلبات مؤكدة اليوم — ما تم إنشاء قائمة شراء.");
    }
    return;
  }

  const items = aggregatePurchaseList(lines);
  const listId = await createPurchaseListRecord(env, items);

  const warehouseMembers = await getTeamMembersByRole(env, "warehouse");
  if (warehouseMembers.length === 0) {
    console.error("[cron 21:15] no warehouse team member found — check res.partner x_role='warehouse'");
    if (env.OWNER_WHATSAPP) {
      await sendText(
        env,
        env.OWNER_WHATSAPP,
        "⚠️ ما يوجد موظف مستودع (warehouse) مسجّل. القائمة أنشئت (id=" + listId + ") لكن ما اتبعثت.",
      );
    }
    return;
  }

  const body = renderPurchaseListMessage(items);
  const buttons = [{ id: `purchase_done_${listId}`, title: "تم الشراء ✅" }];

  for (const wh of warehouseMembers) {
    try {
      await sendButtons(env, wh.x_whatsapp_number, body, buttons);
    } catch (e) {
      console.error(`[cron 21:15] failed to send to ${wh.name}`, (e as Error)?.message);
    }
  }
  await markPurchaseListSent(env, listId);
  console.log(`[cron 21:15] purchase list id=${listId} sent to ${warehouseMembers.length} warehouse member(s)`);
}

function renderPurchaseListMessage(items: ReturnType<typeof aggregatePurchaseList>): string {
  const header = `🛒 قائمة شراء اليوم\nعدد الأصناف: ${items.length}`;
  const lines = items
    .map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}`)
    .join("\n");
  const footer = `\nاضغط "تم الشراء" لما تخلّص، عشان نجهّز مسارات السواقين.`;
  // Meta interactive body max 1024 chars — trim if we somehow overflow
  const full = `${header}\n\n${lines}\n${footer}`;
  return full.length <= 1024 ? full : full.slice(0, 1020) + "…";
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(1);
}

// ============================================================
// Ahmad tapped "تم الشراء" → build routes + dispatch drivers
// ============================================================
export async function warehouseConfirmedPurchase(
  env: Env,
  listId: number,
): Promise<{ routesDispatched: number; ordersMoved: number }> {
  await markPurchaseListDone(env, listId);
  const routes = await buildAndCreateRoutesForDrivers(env);

  let ordersMoved = 0;
  for (const r of routes) {
    ordersMoved += r.stops.length;
    await sendDriverRoute(env, r.driver, r.stops, r.routeId);
  }

  if (env.OWNER_WHATSAPP) {
    await sendText(
      env,
      env.OWNER_WHATSAPP,
      `🚚 تم إرسال المسارات\n- عدد السواقين: ${routes.length}\n- عدد التوصيلات: ${ordersMoved}`,
    );
  }
  return { routesDispatched: routes.length, ordersMoved };
}

async function sendDriverRoute(
  env: Env,
  driver: TeamMember,
  stops: RouteStop[],
  routeId: number,
): Promise<void> {
  const header = `🚚 مسارك اليوم — ${stops.length} توصيلة\nمرحبا ${driver.name}`;
  const list = stops
    .map((s, i) => {
      const phone = s.customer_phone ? `\n   📞 ${s.customer_phone}` : "";
      const neigh = s.neighborhood ? `\n   📍 ${s.neighborhood}` : "";
      return `${i + 1}. ${s.customer_name}${neigh}${phone}\n   ${s.line_summary}`;
    })
    .join("\n\n");
  const footer = `\nلما تخلّص كل توصيلة، ابعث لي رقم الطلب واضغط الأزرار اللي تجيك.`;
  const body = `${header}\n\n${list}\n${footer}`;
  const trimmed = body.length <= 1024 ? body : body.slice(0, 1020) + "…";

  // Send the route summary as text, then a per-stop interactive message so
  // buttons work per delivery. We send buttons only for the first three
  // stops in one batch to stay under Meta's rate; the rest follow as
  // separate interactive messages.
  await sendText(env, driver.x_whatsapp_number, trimmed);

  for (const s of stops) {
    const stopBody = `توصيلة #${s.order_id} — ${s.customer_name}${s.neighborhood ? " (" + s.neighborhood + ")" : ""}\n${s.line_summary}`;
    await sendButtons(env, driver.x_whatsapp_number, stopBody.slice(0, 1024), [
      { id: `delivered_${s.order_id}`, title: "تم التسليم ✅" },
      { id: `delivery_issue_${s.order_id}`, title: "فيه مشكلة ⚠️" },
    ]);
  }
}

// ============================================================
// After the driver taps "تم التسليم" → notify customer + owner
// ============================================================
export async function notifyCustomerDelivered(
  env: Env,
  customerPhone: string,
  customerName: string,
  orderId: number,
): Promise<void> {
  if (!customerPhone) return;
  const msg = `مرحبا ${customerName || ""} 🌿\nتم توصيل طلبك رقم #${orderId}. الفاتورة النهائية بتوصلك قريباً.\nشكراً لثقتك في UTAK.`;
  await sendText(env, customerPhone, msg);
}

// ============================================================
// Helpers for router
// ============================================================
export { getLatestPurchaseListToday };
