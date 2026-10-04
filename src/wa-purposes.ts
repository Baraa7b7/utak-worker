// WhatsApp send purposes — 2026-09-25 (STATUS § 33, the single gateway).
//
// Every send names a purpose, and the purpose decides what the gateway
// (src/wa-gateway.ts) may do with it:
//   • kind — "operational" (service messages: orders, invoices, team tasks,
//     owner alerts), "marketing" (the explicit marketing messages: the
//     reactivation nudge and the feedback request, both behind the opt-out of
//     § 23), "reply" (the bot answering a message that just arrived) and
//     "manual" (Baraa himself, from Discuss or an x_wa_message row).
//     Only a "marketing" purpose may use a MARKETING template; every other
//     purpose uses UTILITY templates only.
//   • important — outside the 24h window with no usable UTILITY template the
//     message is held for the number; an important one also tells Baraa, once
//     per purpose and number per Riyadh day.
//   • ttl — how long a held message stays deliverable. "day" = until the end of
//     the Riyadh day it was created (the default); { hours } = that long after
//     creation; { untilMinute } = that Riyadh minute of the creation day.
//   • critical — «مهمة» (STATUS § 34): held outside the window, it also sends
//     the number's «فتح المحادثة» template (src/wa-opener.ts), at most once
//     per number and Riyadh day. `update` is that template's {{2}}, the kind
//     of update in two or three words. The critical purposes are Baraa's
//     decision: today's prices, the payment receipt, his alerts, the
//     collector's / driver's notes, the order confirmation or change, and the
//     invoices. Every other purpose keeps § 33 as it was.
//
// A purpose missing from this table is a code bug: the gateway refuses it
// (tests/wa-gateway.test.mts also checks every literal purpose in src/).

export type PurposeKind = "operational" | "marketing" | "reply" | "manual";
export type PurposeTtl = "day" | { hours: number } | { untilMinute: number };

export interface PurposePolicy {
  /** Arabic label for Baraa's alerts. */
  label: string;
  kind: PurposeKind;
  important: boolean;
  ttl: PurposeTtl;
  /** «مهمة» (§ 34): held → the «فتح المحادثة» template, once per number and day. */
  critical?: boolean;
  /** The opener's {{2}} for a critical purpose (two or three words). */
  update?: string;
}

const op = (label: string, important = false, ttl: PurposeTtl = "day"): PurposePolicy =>
  ({ label, kind: "operational", important, ttl });
/** A critical («مهمة») operational purpose, § 34. */
const crit = (p: PurposePolicy, update: string): PurposePolicy => ({ ...p, critical: true, update });

export const PURPOSES: Readonly<Record<string, PurposePolicy>> = {
  // ---- customers
  customer_welcome: op("الترحيب"),
  customer_daily_remind: op("تذكير الطلب المعتاد"),
  customer_order_confirm: crit(op("تأكيد الطلب"), "تأكيد الطلب"),
  customer_order_update: crit(op("تحديث الطلب"), "تعديل الطلب"),
  // the order is cancelled at 21:00 — a reminder held past it is stale
  customer_order_remind: crit(op("تذكير تأكيد الطلب", false, { untilMinute: 21 * 60 }), "تأكيد الطلب"),
  customer_delivery_incoming: op("الطلب في الطريق"),
  customer_delivery_done: op("تم التوصيل"),
  customer_invoice: crit(op("الفاتورة", true), "فاتورة جديدة"),
  customer_invoice_pdf: crit(op("الفاتورة (PDF)", true), "فاتورة جديدة"),
  customer_quotation_pdf: op("عرض السعر", true),
  customer_quotation: op("عرض السعر", true),
  customer_receipt: crit(op("إيصال الدفع", true), "إيصال الدفع"),
  // § 34 — the lookup purpose of utak_payment_received (UTILITY, [amount,
  // invoice number]): the receipt's template outside the window.
  customer_payment_received: crit(op("إيصال الدفع", true), "إيصال الدفع"),
  customer_payment_ack: op("تأكيد استلام الدفعة"),
  customer_pay_remind: op("تذكير الدفع", true),
  // § 53 هـ — the lookup purpose of utak_pay_remind_iban_v1 (UTILITY, [invoice
  // number, amount, due date], the IBAN in its fixed text): the 08:00 reminder's
  // first choice; not APPROVED or not UTILITY → customer_pay_remind's template in the same send.
  customer_pay_remind_iban: op("تذكير الدفع بالآيبان", true),
  // § 35 — today's approved prices to every customer: critical, held for the
  // day outside the window. Not «important»: the publication report counts
  // the held ones (no alert per customer).
  customer_prices: crit(op("أسعار اليوم"), "أسعار اليوم"),
  // § 44 د — «هل منشأتك مسجلة في ضريبة القيمة المضافة؟» after a confirmed order,
  // and its three steps: the bot answering his tap / text (his window is open),
  // stale with the step (60 minutes).
  customer_vat_ask: { label: "سؤال الرقم الضريبي", kind: "reply", important: false, ttl: { hours: 1 } },
  // § 53 ج — the customer's order form (a WhatsApp Flow with the day's sale prices): inside the
  // 24h window only, never a template and never held; what cannot go is simply not sent (the text
  // order stays). The gateway refuses it for a price source's or a supplier's number.
  customer_order_form: op("نموذج الطلب"),
  // § 53 د — the new customer's registration form (a WhatsApp Flow): inside the 24h window only,
  // never a template and never held.
  customer_register_form: op("نموذج تسجيل العميل"),
  customer_feedback: { label: "طلب التقييم", kind: "marketing", important: false, ttl: "day" },
  customer_inactive: { label: "تذكير الغياب", kind: "marketing", important: false, ttl: "day" },
  // ---- suppliers
  supplier_ask: op("طلب الأسعار", true),
  supplier_confirm: op("تأكيد استلام الأسعار"),
  supplier_price_nudge: op("تذكير الأسعار"),
  // § 40 ب — 02:30 «أرسل أسعار السوق اليوم» to a price source that is not a
  // supplier (Omar): a team member's waits in the team queue for his tap; a
  // held one is stale after the 06:00 publication.
  market_price_ask: op("طلب أسعار السوق", false, { untilMinute: 6 * 60 }),
  // § 51 — the price ask as a WhatsApp Flow (a field per active item), to a
  // supplier (02:00, the 05:00 reminder) and to any other source (02:30): the
  // interactive message inside the window, utak_price_ask_flow_v1 outside it.
  // Never held: what cannot go as a Flow goes as the ask of before § 51, under
  // its own purpose (so a Flow that Meta refuses never blocks that ask).
  price_ask_flow: op("نموذج طلب الأسعار"),
  // § 37 — the supplier's notice of a payment Baraa approved: critical
  // («مهمة»): text inside his window, utak_supplier_payment_sent (UTILITY)
  // outside it, else held three days with his «فتح المحادثة» when usable.
  supplier_payment_sent: crit(op("إشعار دفعة المورد", false, { hours: 72 }), "دفعة جديدة"),
  // ---- team
  purchase_list: op("قائمة الشراء", true, { hours: 36 }),
  purchase_list_remind: op("تذكير قائمة الشراء", true, { hours: 36 }),
  loading_done: op("تم التحميل"),
  driver_dispatch: op("مسار التوصيل", true),
  driver_stop: op("توصيلة", true),
  driver_stop_location: op("موقع توصيلة"),
  driver_delivery_note: op("إذن التسليم"),
  driver_collection: op("تحصيل السائق"),
  // § 38 (م12) — end of shift − 30 min: the stops still without «تم التسليم» (held no longer than the shift).
  driver_stops_left: op("تذكير المحطات الباقية"),
  collection_request: op("طلب التحصيل", true, { hours: 36 }),
  // § 42 ب — «نقد» / «تحويل» with no choice (or no amount) for 30 minutes: one
  // reminder to the collector with «المبلغ كامل» / «مبلغ آخر» again.
  collection_amount_remind: op("تذكير مبلغ التحصيل", false, { hours: 2 }),
  collection_summary: op("ملخص التحصيل", true),
  collection_nothing: op("لا تحصيل اليوم"),
  pay_claim_notice: op("تحويل عميل للتحقق"),
  commission: op("العمولة"),
  team_shift_start: op("بدء الدوام"),
  team_task: op("مهمة الفريق", false, { hours: 36 }),
  shift_ack: op("رد بدء الدوام", false, { hours: 2 }),
  // § 37 — Baraa's decision on the member's supplier payment (approved / rejected with the reason).
  team_sp_decision: op("قرار دفعة المورد", false, { hours: 36 }),
  // ---- Baraa
  // alerts wait for his next tap (the 06:00 «بدء الدوام» opens his window);
  // § 34: critical — held, they also send utak_update_owner once a day.
  owner_alert: crit(op("تنبيه المالك", false, { hours: 36 }), "تنبيه تشغيلي"),
  // § 34 — the collector's / driver's note (delivery or collection) to Baraa,
  // with the customer and the order.
  owner_team_note: crit(op("ملاحظة من الفريق", false, { hours: 36 }), "ملاحظة من الفريق"),
  // § 35 — Baraa's copy of the published list, with the counts.
  owner_prices: crit(op("نسخة أسعار اليوم", false, { hours: 36 }), "أسعار اليوم"),
  owner_summary: op("ملخص المالك", false, { hours: 36 }),
  // § 49 ج — a confirmed order, to Baraa, with «تم التسليم ✅»: the delivery on
  // the spot (from the car). Held for his next tap outside his window.
  owner_order_confirmed: op("طلب مؤكد", false, { hours: 36 }),
  // § 40 ج — a price exception for his decision (buttons), or the count with
  // the review link; held for his next tap, stale at the publication time (the
  // request's expiresAt). Not critical: § 34's list is Baraa's, and his opener
  // (utak_update_owner) is MARKETING anyway.
  owner_price_exception: op("استثناء أسعار اليوم", false, { untilMinute: 6 * 60 }),
  // § 45 ب — utak_owner_price_review_v1: «N صنف بانتظار قرارك قبل 06:00» with
  // «عرض الاستثناءات», once per price day while his window is closed.
  // Template only (never held).
  owner_price_review: op("قالب استثناءات الأسعار"),
  owner_window: op("نافذة المالك 06:00"),
  // § 51 — the one trial of the price Flow to Baraa's own number («🧪 تجربة»),
  // inside his window only, and the answers to his trial reply.
  price_flow_test: op("تجربة نموذج الأسعار", false, { hours: 1 }),
  // § 53 ج — the one trial of the order form to Baraa's own number («🧪 تجربة»), inside his
  // window only, and the answers to his trial reply (no order is created).
  order_flow_test: op("تجربة نموذج الطلب", false, { hours: 1 }),
  // § 53 د — the one trial of the registration form to Baraa's own number (nothing written in Odoo).
  register_flow_test: op("تجربة نموذج التسجيل", false, { hours: 1 }),
  // ---- § 34: «فتح المحادثة» — one UTILITY template per recipient category,
  // sent when a critical message is held (src/wa-opener.ts). Template only:
  // never held itself.
  conv_open_customer: op("فتح المحادثة (عميل)"),
  conv_open_team: op("فتح المحادثة (فريق)"),
  conv_open_supplier: op("فتح المحادثة (مورد)"),
  conv_open_owner: op("فتح المحادثة (المالك)"),
  // ---- replies and manual sends
  bot_reply: { label: "رد البوت", kind: "reply", important: false, ttl: { hours: 2 } },
  inbox_reply: { label: "رد من الصندوق", kind: "manual", important: false, ttl: { hours: 48 } },
  wa_message_manual: { label: "رسالة يدوية من Odoo", kind: "manual", important: false, ttl: { hours: 48 } },
  sim_test: { label: "اختبار sim", kind: "manual", important: false, ttl: { hours: 1 } },
};

export function purposePolicy(purpose: string): PurposePolicy | null {
  return Object.prototype.hasOwnProperty.call(PURPOSES, purpose) ? PURPOSES[purpose] : null;
}

/**
 * May a template of this Meta category carry this purpose? UTILITY always.
 * MARKETING only for a marketing purpose — or a template Baraa picked himself
 * on an x_wa_message row (kind "manual"). Opt-out applies to both (gateway).
 */
export function categoryAllowed(purpose: string, category: string | false | null | undefined): boolean {
  const c = String(category || "").toUpperCase();
  if (c === "UTILITY") return true;
  if (c === "MARKETING") {
    const k = purposePolicy(purpose)?.kind;
    return k === "marketing" || k === "manual";
  }
  return false;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RIYADH_MS = 3 * 60 * 60 * 1000;

/** Start of the Riyadh day containing `ms`, in UTC ms. */
export function riyadhDayStartMs(ms: number): number {
  return Math.floor((ms + RIYADH_MS) / DAY_MS) * DAY_MS - RIYADH_MS;
}

/** When a message of this purpose, created at `createdMs`, stops being deliverable. */
export function expiryFor(purpose: string, createdMs: number): number {
  const ttl = purposePolicy(purpose)?.ttl ?? "day";
  if (ttl === "day") return riyadhDayStartMs(createdMs) + DAY_MS;
  if ("hours" in ttl) return createdMs + ttl.hours * 3600_000;
  return riyadhDayStartMs(createdMs) + ttl.untilMinute * 60_000;
}
