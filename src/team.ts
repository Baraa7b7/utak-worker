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
  getOrderCustomer,
  getOrderIdsFromPurchaseList,
  getPurchaseListBrief,
  getTeamMembersByRole,
  getUnconfirmedOrders,
  getUnconfirmedPurchaseLists,
  markPurchaseListDone,
  markPurchaseListSent,
  transitionOrdersToInPurchase,
  type UnconfirmedOrder,
} from "./odoo";
import { sendButtons, sendLocation, sendText } from "./meta";
import { sendTemplateByPurpose, T, sendOwnerAlert, cutoffLabel, purchaseRemindParams } from "./templates";
import { createAndDispatchDeliveryNoteForStop } from "./delivery-note";
import { syncPurchaseListToAccounting } from "./purchase-accounting";
import { riyadhDateKey } from "./hours";
import { arabicDate, joinCapped } from "./wa-params";
import type { PurchaseListItem } from "./types";
import { holdForTask } from "./attendance";
import { heldPartnerIds } from "./screening";
import { enqueueTeamItems, type TeamQueueItem } from "./team-queue";

// ============================================================
// Customer order notice — 2026-09-24 (ح3)
//
// Inside the 24h window: a session message (with buttons when given).
// Outside it: the approved UTILITY template utak_order_update
// («تحديث على طلبك رقم {{1}}: {{2}}. لأي استفسار رد على هذه الرسالة»),
// purpose customer_order_update. A free-form text outside the window would be
// accepted by Meta and then dropped (131047), so it is never tried there.
// ============================================================
export const CUTOFF_PROMPT_TTL = 2 * 60 * 60;

async function notifyOrderCustomer(
  env: Env,
  o: { id: number; customerId: number },
  session: { text: string; buttons?: Array<{ id: string; title: string }> },
  templateUpdate: string,
  opts: { remind?: boolean } = {},
): Promise<"session" | "template" | "template_buttons" | "none" | "held" | "failed"> {
  const cust = await getOrderCustomer(env, o.id);
  if (!cust?.phone) return "none";
  // 2026-09-25 (STATUS § 30) — no reminder / notice to a partner held from customer automation.
  if ((await heldPartnerIds(env, [cust.id])).has(cust.id)) return "held";
  const { isInside24hWindow } = await import("./wa-inbox");
  const inside = await isInside24hWindow(env, o.customerId || cust.id).catch(() => false);
  if (inside) {
    const r = session.buttons?.length
      ? await sendButtons(env, cust.phone, session.text, session.buttons)
      : await sendText(env, cust.phone, session.text);
    return r.ok ? "session" : "failed";
  }
  // 2026-09-25 — the 20:00 reminder goes as utak_order_confirm_remind_v1
  // (customer_order_remind) with the confirm / cancel buttons once that purpose
  // is mapped. Only «no template mapped» falls through to utak_order_update: a
  // mapped template that failed (or was refused as a repeat) is not re-sent
  // under another name.
  if (opts.remind) {
    const rr = await sendTemplateByPurpose(env, cust.phone, T.CUSTOMER_ORDER_REMIND,
      [`#${o.id}`, cutoffLabel()], orderRemindButtons(o.id));
    if (rr) return rr.ok ? "template_buttons" : "failed";
  }
  const r = await sendTemplateByPurpose(env, cust.phone, T.CUSTOMER_ORDER_UPDATE, [`#${o.id}`, templateUpdate]);
  if (r && r.ok) return "template";
  if (!r) console.warn(`[order-notice] no template mapped for ${T.CUSTOMER_ORDER_UPDATE} — order ${o.id} not notified`);
  return "failed";
}

/** Payloads for utak_order_confirm_remind_v1: button 0 «تأكيد الطلب», button 1 «إلغاء». */
export function orderRemindButtons(orderId: number): Array<{ index: number; payload: string }> {
  return [
    { index: 0, payload: `confirm_order_${orderId}` },
    { index: 1, payload: `cancel_order_${orderId}` },
  ];
}

// ============================================================
// 20:00 Riyadh — remind every customer with an unconfirmed order (ح3)
// ============================================================
export async function sendCutoffReminders(env: Env): Promise<{ reminded: number; failed: number }> {
  const orders = await getUnconfirmedOrders(env, riyadhDateKey());
  let reminded = 0, failed = 0;
  for (const o of orders) {
    try {
      const how = await notifyOrderCustomer(
        env,
        o,
        {
          text: `⏰ طلبك رقم #${o.id} لسه ما تأكد، ويُلغى تلقائياً الساعة ${cutoffLabel()} لو ما تأكد. اضغط «تأكيد الطلب» عشان يدخل طلبات اليوم 👇`,
          buttons: [
            { id: `confirm_order_${o.id}`, title: "تأكيد الطلب ✅" },
            { id: `cancel_order_${o.id}`, title: "إلغاء ❌" },
          ],
        },
        `لم يُؤكَّد بعد، ويُلغى تلقائياً الساعة ${cutoffLabel()}. رد على هذه الرسالة لتأكيده`,
        { remind: true },
      );
      if (how === "template") {
        // A reply to the template (any text) re-sends the confirm button inside the window.
        await env.MSG_DEDUP.put(`cutoff_prompt:${o.customerId}`, String(o.id), { expirationTtl: CUTOFF_PROMPT_TTL });
      }
      if (how === "session" || how === "template" || how === "template_buttons") reminded++;
      else if (how !== "held") failed++;
    } catch (e) {
      failed++;
      console.error(`[cron 20:00] reminder for order ${o.id} failed`, (e as Error)?.message);
    }
  }
  console.log(`[cron 20:00] unconfirmed=${orders.length} reminded=${reminded} failed=${failed}`);
  return { reminded, failed };
}

// ============================================================
// 21:00 Riyadh — auto-cancel unconfirmed orders, and tell each customer (ح3)
// ============================================================
export async function closeUnconfirmedOrders(env: Env): Promise<void> {
  const before = await getUnconfirmedOrders(env);
  const ids = await cancelStaleWaitingOrders(env);
  console.log(`[cron 21:00] cancelled ${ids.length} unconfirmed orders`);
  const byId = new Map<number, UnconfirmedOrder>(before.map((o) => [o.id, o]));
  let notified = 0;
  for (const id of ids) {
    const o = byId.get(id) ?? { id, customerId: 0 } as UnconfirmedOrder;
    try {
      const how = await notifyOrderCustomer(
        env,
        o,
        { text: `طلبك رقم #${id} أُلغي لأنه ما تأكد قبل الساعة ${cutoffLabel()} 🙏 لو تبغاه على طلبات بكرة، أرسل الأصناف هنا ونسجّلها لك.` },
        `أُلغي لعدم تأكيده قبل الساعة ${cutoffLabel()}. لو تبغاه على طلبات بكرة رد على هذه الرسالة بالأصناف`,
      );
      if (how === "session" || how === "template") notified++;
    } catch (e) {
      console.error(`[cron 21:00] cancel notice for order ${id} failed`, (e as Error)?.message);
    }
  }
  if (ids.length > 0 && env.OWNER_WHATSAPP) {
    await sendOwnerAlert(
      env,
      `📊 إقفال الطلبات\nتم إلغاء ${ids.length} طلب لم يُؤكَّد اليوم (${ids.map((i) => "#" + i).join("، ")}). أُبلغ ${notified} عميل.`,
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
      await sendOwnerAlert(env, "📊 21:15\nلا يوجد طلبات مؤكدة اليوم — ما تم إنشاء قائمة شراء.");
    }
    return;
  }

  const items = aggregatePurchaseList(lines);
  const listId = await createPurchaseListRecord(env, items);

  // v4.1: lock the exact orders that made it onto this list into in_purchase
  // NOW, so downstream flows (purchase_done → build routes) don't depend on
  // the button being tapped on the same Riyadh day.
  const orderIdsOnList = Array.from(
    new Set(items.flatMap((it) => it.order_ids ?? [])),
  );
  await transitionOrdersToInPurchase(env, orderIdsOnList);

  const warehouseMembers = await getTeamMembersByRole(env, "warehouse");
  if (warehouseMembers.length === 0) {
    console.error("[cron 21:15] no warehouse team member found — check «أدوار UTAK» (شراء) on hr.employee");
    if (env.OWNER_WHATSAPP) {
      await sendOwnerAlert(
        env,
        "⚠️ ما يوجد موظف مستودع (warehouse) مسجّل. القائمة أنشئت (id=" + listId + ") لكن ما اتبعثت.",
      );
    }
    return;
  }

  for (const wh of warehouseMembers) {
    // 2026-09-25 (STATUS § 29) — not tapped «بدء الدوام» today: the open list
    // reaches them right after the tap (resendOpenPurchaseLists), not now.
    // STATUS § 31 — after the shift (or on a day off / time off) the same, until
    // the next shift's tap, and Baraa gets one «مهمة لـ… بعد دوامه».
    if ((await holdForTask(env, wh.id, { kind: "purchase_list", label: `قائمة الشراء #${listId} (${items.length} صنف)` })).hold) {
      console.log(`[cron 21:15] list ${listId} waits for ${wh.name}'s «بدء الدوام»`);
      continue;
    }
    await sendPurchaseListTemplate(env, wh, listId, items);
  }
  await markPurchaseListSent(env, listId);
  console.log(`[cron 21:15] purchase list id=${listId} sent to ${warehouseMembers.length} warehouse member(s)`);
}

/**
 * The purchase_list template (utak_purchase_list_v2, 4 vars + «تم الشراء» /
 * «مشكلة»). {{3}} is ONE line (ح1): Meta refused the old multi-line list with
 * #132018. A long list is cut on an item boundary and says how many are left;
 * any reply from the warehouse then gets the full list in the session.
 */
async function sendPurchaseListTemplate(
  env: Env,
  wh: TeamMember,
  listId: number,
  items: PurchaseListItem[],
  opts: { reminder?: boolean; date?: string } = {},
): Promise<boolean> {
  const list = purchaseListLine(items);
  const day = arabicDate(opts.date || riyadhDateKey());
  try {
    const resp = await sendTemplateByPurpose(env, wh.x_whatsapp_number, T.PURCHASE_LIST,
      [wh.name || "", opts.reminder ? `${day} (تذكير: لم يُضغط «تم الشراء» بعد)` : day, list, String(items.length)],
      [
        { index: 0, payload: `purchase_done_${listId}` },
        { index: 1, payload: `purchase_issue_${listId}` },
      ]);
    if (resp && resp.ok) return true;
    // Fallback: session buttons (reach the warehouse only inside the window).
    const r = await sendButtons(env, wh.x_whatsapp_number, renderPurchaseListMessage(items), purchaseListButtons(listId));
    return r.ok;
  } catch (e) {
    console.error(`[purchase-list] failed to send to ${wh.name}`, (e as Error)?.message);
    return false;
  }
}

export function purchaseListButtons(listId: number): Array<{ id: string; title: string }> {
  return [
    { id: `purchase_done_${listId}`, title: "تم الشراء ✅" },
    { id: `purchase_issue_${listId}`, title: "مشكلة ⚠️" },
  ];
}

/** "1. طماطم — كرتون × 3، 2. خيار — جرم × 5 … و 4 أخرى (…)" */
export function purchaseListLine(items: PurchaseListItem[]): string {
  return joinCapped(
    items.map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}`),
    undefined,
    "، ",
    (n) => `و ${n} أصناف أخرى (أرسل أي رسالة لعرض القائمة كاملة)`,
  ).text;
}

export function renderPurchaseListMessage(items: PurchaseListItem[]): string {
  const header = `🛒 قائمة شراء اليوم\nعدد الأصناف: ${items.length}`;
  const lines = items
    .map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}`)
    .join("\n");
  const footer = `\nاضغط "تم الشراء" لما تخلّص، عشان نجهّز مسارات السواقين.`;
  // Meta interactive body max 1024 chars — trim if we somehow overflow
  const full = `${header}\n\n${lines}\n${footer}`;
  return full.length <= 1024 ? full : full.slice(0, 1020) + "…";
}

/**
 * The warehouse wrote something (not a pending issue): send every list still
 * waiting for «تم الشراء» in full, inside the session window just opened.
 * Returns how many lists were sent.
 */
export async function resendOpenPurchaseLists(env: Env, to: string): Promise<number> {
  const ids = await getUnconfirmedPurchaseLists(env, riyadhDateKey(new Date(Date.now() - 36 * 3600 * 1000)));
  let n = 0;
  for (const id of ids) {
    const list = await getPurchaseListBrief(env, id);
    if (!list || list.items.length === 0) continue;
    const full = [
      `🛒 قائمة الشراء #${id} (${arabicDate(list.date)}) — ${list.items.length} صنف`,
      "",
      ...list.items.map((it, i) => `${i + 1}. ${it.product_name} — ${it.packaging_name} × ${formatQty(it.total_quantity)}`),
    ].join("\n");
    // Interactive bodies cap at 1024: long lists go as text chunks, then the buttons.
    if (full.length > 1000) {
      for (let i = 0; i < full.length; i += 3500) await sendText(env, to, full.slice(i, i + 3500));
      await sendButtons(env, to, `قائمة الشراء #${id}: اضغط لما تخلّص.`, purchaseListButtons(id));
    } else {
      await sendButtons(env, to, full, purchaseListButtons(id));
    }
    n++;
  }
  return n;
}

/**
 * 06:00 Riyadh — ح7: a purchase list still «sent» (no «تم الشراء») gets a
 * reminder to the warehouse (the same approved template, marked as a
 * reminder) and an immediate owner alert.
 */
export async function followUpUnconfirmedPurchaseLists(env: Env): Promise<{ reminded: number }> {
  const ids = await getUnconfirmedPurchaseLists(env, riyadhDateKey(new Date(Date.now() - 36 * 3600 * 1000)));
  if (ids.length === 0) return { reminded: 0 };
  const warehouse = await getTeamMembersByRole(env, "warehouse");
  // 2026-09-25 (STATUS § 29) — a member who has not tapped «بدء الدوام» today
  // gets the open list right after the tap instead of this reminder (and after
  // the shift / on a day off: at the next shift, STATUS § 31).
  const held = new Set<number>();
  for (const wh of warehouse) {
    if ((await holdForTask(env, wh.id, { kind: "purchase_list_remind", label: `تذكير قائمة الشراء (${ids.map((i) => "#" + i).join("، ")})` })).hold) held.add(wh.id);
  }
  let reminded = 0;
  for (const id of ids) {
    const list = await getPurchaseListBrief(env, id);
    if (!list) continue;
    for (const wh of warehouse) {
      if (held.has(wh.id)) continue;
      if (await sendPurchaseListReminder(env, wh, id, list)) reminded++;
    }
    const sentTo = warehouse.filter((w) => !held.has(w.id)).map((w) => w.name).join("، ");
    const waiting = warehouse.filter((w) => held.has(w.id)).map((w) => w.name).join("، ");
    await sendOwnerAlert(
      env,
      `⏰ قائمة الشراء #${id} (${arabicDate(list.date)}) لم يُضغط عليها «تم الشراء» حتى الآن، فلا مسارات ولا توصيل. ` +
        (waiting
          ? `${sentTo ? `أُرسل تذكير للمستودع (${sentTo}). ` : ""}بانتظار «بدء الدوام»: ${waiting}، وتصله القائمة بعد الضغط.`
          : `أُرسل تذكير للمستودع (${warehouse.map((w) => w.name).join("، ") || "لا يوجد موظف مستودع"}).`),
    );
  }
  return { reminded };
}

/**
 * 2026-09-25 — the purchase_list_remind template («تم الشراء» button) once
 * that purpose is mapped: utak_purchase_list_remind_v2 = [list id, date, item
 * count], or v1 = [date, item count] (purchaseRemindParams). Until then the
 * purchase list template again, marked as a reminder. Only «no template
 * mapped» falls back — a mapped template that failed is not re-sent under
 * another name.
 */
async function sendPurchaseListReminder(
  env: Env,
  wh: TeamMember,
  listId: number,
  list: { date: string; items: PurchaseListItem[] },
): Promise<boolean> {
  try {
    const date = arabicDate(list.date || riyadhDateKey());
    const r = await sendTemplateByPurpose(env, wh.x_whatsapp_number, T.PURCHASE_LIST_REMIND,
      (name) => purchaseRemindParams(name, listId, date, list.items.length),
      [{ index: 0, payload: `purchase_done_${listId}` }]);
    if (r) return r.ok;
  } catch (e) {
    console.error(`[purchase-list] reminder to ${wh.name} failed`, (e as Error)?.message);
    return false;
  }
  return sendPurchaseListTemplate(env, wh, listId, list.items, { reminder: true, date: list.date });
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
  // v4.1: fetch the exact orders from the list BEFORE marking done, then pass
  // them to route building — decouples routing from "today's" date filter.
  const orderIdsOnList = await getOrderIdsFromPurchaseList(env, listId);
  await markPurchaseListDone(env, listId);
  const routes = await buildAndCreateRoutesForDrivers(env, orderIdsOnList);

  let ordersMoved = 0;
  for (const r of routes) {
    ordersMoved += r.stops.length;
    await sendDriverRoute(env, r.driver, r.stops, r.routeId);
  }

  if (env.OWNER_WHATSAPP) {
    await sendOwnerAlert(
      env,
      `🚚 تم إرسال المسارات\n- عدد السواقين: ${routes.length}\n- عدد التوصيلات: ${ordersMoved}`,
    );
  }

  // 2026-09-23 — closed list → purchase.order + posted vendor bill, behind
  // ACCOUNTING_SYNC. Runs last and never throws: routes and WhatsApp above
  // have already gone out, and a refusal only alerts the owner.
  await syncPurchaseListToAccounting(env, listId);
  return { routesDispatched: routes.length, ordersMoved };
}

export async function sendDriverRoute(
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
  const stopBody = (s: RouteStop) =>
    `توصيلة #${s.order_id} — ${s.customer_name}${s.neighborhood ? " (" + s.neighborhood + ")" : ""}\n${s.line_summary}`.slice(0, 1024);
  const stopButtons = (s: RouteStop) => [
    { id: `delivered_${s.order_id}`, title: "تم التسليم ✅" },
    { id: `delivery_issue_${s.order_id}`, title: "فيه مشكلة ⚠️" },
  ];

  // 2026-09-25 (STATUS § 29) — attendance. A driver on attendance who has
  // not tapped today's «بدء الدوام» gets the whole route after the tap: the
  // list, then per stop its location, delivery note and buttons, all queued in
  // order. A driver who already tapped today gets it now, without a second
  // «بدء الدوام» template. A driver not on attendance: unchanged below.
  // STATUS § 31 — after the shift (or on a day off / time off) the route is
  // queued the same way for the next shift, and Baraa gets one alert.
  const att = await holdForTask(env, driver.id, { kind: "route", label: `مسار التوصيل (${stops.length} توصيلة، المسار #${routeId})` });
  if (att.hold) {
    const q: TeamQueueItem[] = [{ text: trimmed }];
    for (const s of stops) {
      if (typeof s.latitude === "number" && typeof s.longitude === "number") {
        q.push({ latitude: s.latitude, longitude: s.longitude, name: `#${s.order_id} — ${s.customer_name}`, address: s.neighborhood || undefined });
      } else if (s.map_url) {
        q.push({ text: `📍 #${s.order_id} — ${s.customer_name}\n${s.map_url}` });
      }
      if (typeof s.stop_id === "number") {
        try {
          const dn = await createAndDispatchDeliveryNoteForStop(env, s.stop_id, driver.x_whatsapp_number, { defer: true });
          if (dn?.deferredText) q.push({ text: dn.deferredText });
        } catch (e) {
          console.warn(`[sendDriverRoute] delivery-note failed for stop ${s.stop_id}`, (e as Error)?.message);
        }
      }
      q.push({ text: stopBody(s), buttons: stopButtons(s) });
    }
    await enqueueTeamItems(env, driver.x_whatsapp_number, q, att.queueTtl);
    console.log(`[sendDriverRoute] route ${routeId} (${stops.length} stops) queued until ${driver.name}'s «بدء الدوام»`);
    return;
  }

  // 2026-09-17 — shift-start gate. Before the driver_dispatch template we
  // send an approved team_shift_start template with a QUICK_REPLY button.
  // Meta lets templates through anytime, but any FOLLOW-UP free-form
  // (location, text) only reaches the driver AFTER they reply. We use the
  // button tap as that reply — pending locations sit in KV under
  // pending_loc:<driver_phone> until the tap flushes them (see
  // handleWebhook team branch). If the shift template fails or is not
  // wired up in Odoo yet, we fall through to the old inline behaviour so
  // pilot is never worse off than before.
  const shiftResp = att.onAttendance
    ? null
    : await sendTemplateByPurpose(
      env,
      driver.x_whatsapp_number,
      T.TEAM_SHIFT_START,
      [driver.name || ""],
      [{ index: 0, payload: "shift_start" }],
    );
  const shiftOk = !!shiftResp && shiftResp.ok;

  // v7: use approved driver_dispatch template (opens conversation window;
  // per-stop buttons follow inside the 24h window via sendButtons).
  // ح1: {{3}} is one line (the multi-line list was refused with #132018).
  // Every stop also gets its own driver_stop message below, so a cut list
  // loses nothing.
  const oneLine = joinCapped(
    stops.map((s, i) => `${i + 1}. ${s.customer_name}${s.neighborhood ? " (" + s.neighborhood + ")" : ""}`),
  ).text;
  const resp = await sendTemplateByPurpose(env, driver.x_whatsapp_number, T.DRIVER_DISPATCH,
    [driver.name || "", arabicDate(riyadhDateKey()), oneLine, String(stops.length)]);
  if (!resp || !resp.ok) {
    // Fallback to plain text
    await sendText(env, driver.x_whatsapp_number, trimmed);
  }

  // Queued behind «بدء الدوام», in stop order: locations and (م11) the
  // delivery-note texts. Flushed by the team branch in index.ts.
  const pendingLocations: Array<
    | { latitude: number; longitude: number; name: string; address?: string }
    | { text: string }
  > = [];

  for (const s of stops) {
    // 2026-09-17 — when the shift-start template lands, defer this
    // sendLocation until the driver taps the button (flushed in handleWebhook).
    // If shift-start didn't work, send inline so drivers on today's pilot
    // still receive locations without regressing on the current behavior.
    if (typeof s.latitude === "number" && typeof s.longitude === "number") {
      if (shiftOk) {
        pendingLocations.push({
          latitude: s.latitude,
          longitude: s.longitude,
          name: `#${s.order_id} — ${s.customer_name}`,
          address: s.neighborhood || undefined,
        });
      } else {
        await sendLocation(
          env,
          driver.x_whatsapp_number,
          s.latitude,
          s.longitude,
          `#${s.order_id} — ${s.customer_name}`,
          s.neighborhood || undefined,
        );
      }
    } else if (s.map_url) {
      const t = `📍 #${s.order_id} — ${s.customer_name}\n${s.map_url}`;
      if (shiftOk) pendingLocations.push({ text: t });
      else await sendText(env, driver.x_whatsapp_number, t);
    }

    // Phase 3 — before the driver_stop button prompt, generate + send the
    // delivery-note PDF for this stop. Warn-and-continue: a delivery-note
    // failure must not block the driver from getting the stop buttons.
    if (typeof s.stop_id === "number") {
      try {
        const dn = await createAndDispatchDeliveryNoteForStop(env, s.stop_id, driver.x_whatsapp_number, { defer: shiftOk });
        if (shiftOk && dn?.deferredText) pendingLocations.push({ text: dn.deferredText });
      } catch (e) {
        console.warn(
          `[sendDriverRoute] delivery-note failed for stop ${s.stop_id}`,
          (e as Error)?.message,
        );
      }
    } else {
      console.warn(
        `[sendDriverRoute] stop for order ${s.order_id} has no stop_id — skipping delivery note`,
      );
    }

    // v7: driver_stop template — 5 params: stop#, customer, neighborhood, address, items
    const resp2 = await sendTemplateByPurpose(env, driver.x_whatsapp_number, T.DRIVER_STOP,
      [
        String(s.order_id),
        s.customer_name || "",
        s.neighborhood || "-",
        s.map_url || s.customer_phone || "-",
        s.line_summary || "",
      ],
      [
        { index: 0, payload: `delivered_${s.order_id}` },
        { index: 1, payload: `delivery_issue_${s.order_id}` },
      ]);
    if (!resp2 || !resp2.ok) {
      // Fallback to plain buttons if template send fails
      await sendButtons(env, driver.x_whatsapp_number, stopBody(s), stopButtons(s));
    }
  }

  // 2026-09-17 — store the deferred locations in KV so the team-branch
  // webhook handler can flush them on the driver's first inbound
  // (shift_start button, or any other reply within 20h).
  if (shiftOk && pendingLocations.length > 0) {
    try {
      // 2026-09-25 — appended (team-queue.ts), no longer overwriting anything
      // already queued for this number.
      await enqueueTeamItems(env, driver.x_whatsapp_number, pendingLocations, 20 * 60 * 60);
    } catch (e) {
      console.warn(
        `[sendDriverRoute] failed to queue locations for ${driver.x_whatsapp_number}`,
        (e as Error)?.message,
      );
    }
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
  // 2026-09-24 — customer_delivery_done moved from utak_delivery_done
  // (MARKETING, {{1}} = name, 2 quick replies) to utak_delivered (UTILITY,
  // {{1}} = order number, no buttons). Params follow whichever template the
  // purpose resolves to, so the Odoo switch and a rollback are both safe.
  const resp = await sendTemplateByPurpose(env, customerPhone, T.CUSTOMER_DELIVERY_DONE,
    (name) => (name === "utak_delivery_done" ? [customerName || ""] : [String(orderId)]));
  if (!resp || !resp.ok) {
    // Fallback to plain text (works only inside 24h window)
    const msg = `مرحبا ${customerName || ""} 🌿\nتم توصيل طلبك رقم #${orderId}. الفاتورة النهائية بتوصلك قريباً.\nشكراً لثقتك في UTAK.`;
    await sendText(env, customerPhone, msg);
  }
}

// ============================================================
// Helpers for router
// ============================================================
export { getLatestPurchaseListToday };
