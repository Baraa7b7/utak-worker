// Orders after the 21:00 cutoff — 2026-09-24 (WA-SCENARIOS ح2, ح9; قرار براء).
//
// Before: «طلبك يوصلك بكرة الصبح» and nothing was recorded. Now the customer
// decides with two buttons:
//   «سجّله لبكرة» → an order is created for the next ordering day, confirmed,
//                   and the customer is told its number and dates.
//   «لا شكراً»    → closed politely, nothing recorded.
// The parsed items wait in KV (LATE_TTL) between the message and the tap.
// A second message before the tap adds to the same pending list. The same
// prompt serves a standing-order confirmation after 21:15 (ح9) and a confirm
// tap on an order that was cancelled at the cutoff (ح4).

import type { Env } from "./config";
import type { OdooPartner } from "./types";
import type { LateItem } from "./odoo";
import { nextOrderingDate, riyadhDateKey } from "./hours";
import { arabicDate } from "./wa-params";
import { withButtonLock, ALREADY_DONE_TEXT } from "./button-lock";

export const LATE_TTL = 12 * 60 * 60;
const lateKey = (partnerId: number) => `late_order:${partnerId}`;
const lateDoneKey = (partnerId: number) => `late_done:${partnerId}`;

export interface LatePending {
  items: LateItem[];
  via: "whatsapp" | "standing_order";
  at: string;
  /** Ordering day shown in the prompt (re-computed at tap time). */
  date: string;
}

export interface LateReply {
  text?: string;
  bodyBeforeButtons?: string;
  buttons?: Array<{ id: string; title: string }>;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function lateButtons(partnerId: number, orderDate: string, now: Date = new Date()): Array<{ id: string; title: string }> {
  const tomorrow = orderDate !== riyadhDateKey(now);
  return [
    { id: `late_yes_${partnerId}`, title: tomorrow ? "سجّله لبكرة" : "سجّله لليوم" },
    { id: `late_no_${partnerId}`, title: "لا شكراً" },
  ];
}

export async function readLatePending(env: Env, partnerId: number): Promise<LatePending | null> {
  try {
    const raw = await env.MSG_DEDUP.get(lateKey(partnerId));
    if (!raw) return null;
    const p = JSON.parse(raw) as LatePending;
    return Array.isArray(p?.items) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Park the items and ask. `lead` is the first line of the prompt (why the
 * order was not taken now).
 */
export async function offerLateOrder(
  env: Env,
  partnerId: number,
  items: LateItem[],
  opts: { via?: "whatsapp" | "standing_order"; lead?: string; now?: Date } = {},
): Promise<LateReply> {
  const now = opts.now ?? new Date();
  const via = opts.via ?? "whatsapp";
  const prev = await readLatePending(env, partnerId);
  const merged = prev && prev.via === via ? [...prev.items, ...items] : items;
  const date = nextOrderingDate(now);
  const pending: LatePending = { items: merged, via, at: now.toISOString(), date };
  await env.MSG_DEDUP.put(lateKey(partnerId), JSON.stringify(pending), { expirationTtl: LATE_TTL });
  const tomorrow = date !== riyadhDateKey(now);
  const lead = opts.lead ?? (tomorrow
    ? "استقبال طلبات اليوم انقفل الساعة 9:00 مساءً، وطلبك ما تسجّل."
    : "استقبال الطلبات يفتح الساعة 6:00 صباحاً، وطلبك ما تسجّل بعد.");
  const ask = tomorrow
    ? `تبغانا نسجّله على طلبات بكرة (${arabicDate(date)})؟ يوصلك صباح ${arabicDate(addDays(date, 1))} إن شاء الله.`
    : `تبغانا نسجّله على طلبات اليوم (${arabicDate(date)})؟ يوصلك صباح ${arabicDate(addDays(date, 1))} إن شاء الله.`;
  return {
    bodyBeforeButtons: [lead, "", ...merged.map((i) => `• ${i.label}`), "", ask].join("\n"),
    buttons: lateButtons(partnerId, date, now),
  };
}

/** «سجّله لبكرة». Idempotent: a second tap answers «تم مسبقاً». */
export async function handleLateYes(
  env: Env,
  partner: OdooPartner | null,
  partnerIdFromButton: number,
  now: Date = new Date(),
): Promise<LateReply> {
  const pid = partner?.id ?? partnerIdFromButton;
  const pending = await readLatePending(env, pid);
  if (!pending) {
    const done = await env.MSG_DEDUP.get(lateDoneKey(pid)).catch(() => null);
    if (done) return { text: `${ALREADY_DONE_TEXT} طلبك مسجّل برقم #${done}.` };
    return { text: "انتهت مهلة هذا الطلب. أرسل الأصناف من جديد ونسجّلها لك 🌿" };
  }
  const text = await withButtonLock(env, `late_yes:${pid}:${pending.at}`, async () => {
    const odoo = await import("./odoo");
    const date = nextOrderingDate(now);
    // ح9: a standing order already registered for that day is not duplicated.
    if (pending.via === "standing_order") {
      const existing = await odoo.findLiveOrderOn(env, pid, date, "standing_order");
      if (existing) {
        await env.MSG_DEDUP.delete(lateKey(pid));
        return `طلبك المعتاد ليوم ${arabicDate(date)} مسجّل أصلاً برقم #${existing} ✅`;
      }
    }
    const loc = await odoo.getPartnerLocation(env, pid);
    const neigh = loc?.neighborhood || (await odoo.getPartnerNeighborhood(env, pid));
    const orderId = await odoo.createOrderWithLines(env, {
      customerId: pid,
      date,
      items: pending.items,
      via: pending.via,
      state: "confirmed",
      neighborhood: neigh || undefined,
    });
    if (loc) await odoo.setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
    await env.MSG_DEDUP.delete(lateKey(pid));
    await env.MSG_DEDUP.put(lateDoneKey(pid), String(orderId), { expirationTtl: LATE_TTL });
    // 2026-09-23 (ACCOUNTING_SYNC) — confirmed order → confirmed sale.order. Never throws.
    const { ensureSaleOrderForDailyOrder } = await import("./sale-accounting");
    await ensureSaleOrderForDailyOrder(env, orderId);
    const lines = [
      `تم ✅ سجّلنا طلبك رقم #${orderId} على طلبات يوم ${arabicDate(date)}:`,
      ...pending.items.map((i) => `• ${i.label}`),
      "",
      `يوصلك صباح ${arabicDate(addDays(date, 1))} إن شاء الله 🌿`,
    ];
    if (!loc && !neigh) {
      await env.MSG_DEDUP.put(`pending_neighborhood:${pid}`, `loc:${orderId}`, { expirationTtl: LATE_TTL });
      lines.push("", "📍 أرسل موقع التوصيل (📎 → موقع → موقعي الحالي) أو اكتب اسم الحي.");
    }
    return lines.join("\n");
  });
  return { text };
}

/** «لا شكراً». */
export async function handleLateNo(env: Env, partner: OdooPartner | null, partnerIdFromButton: number): Promise<LateReply> {
  const pid = partner?.id ?? partnerIdFromButton;
  const pending = await readLatePending(env, pid);
  if (!pending) return { text: ALREADY_DONE_TEXT };
  await env.MSG_DEDUP.delete(lateKey(pid));
  return { text: "تمام، ما سجّلنا شي 🌿 نستقبل طلباتك يومياً من الساعة 6:00 صباحاً إلى 9:00 مساءً، وحياك الله في أي وقت." };
}
