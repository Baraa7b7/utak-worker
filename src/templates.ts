// ============================================================
// v7: Central template sender — reads Odoo x_whatsapp_template mapping
// and sends via Meta Graph API with body params + button payloads.
// ============================================================
import type { Env } from "./config";
import { ORDERING_HOURS_CLOSE } from "./config";
import {
  clearTemplateCache,
  sendViaGateway,
  type GwOption,
  type HeaderMedia,
  type QuickReplyPayload,
} from "./wa-gateway";

// 2026-09-25 (STATUS § 33) — the per-purpose candidate cache moved into the
// gateway with the lookup itself; re-exported for the tests that clear it.
export { clearTemplateCache };
export type { HeaderMedia, QuickReplyPayload };

/**
 * Two or more rows share an x_purpose: log every time, alert the owner once
 * per purpose per Riyadh day. Never throws. The owner_alert purpose itself is
 * only logged — alerting through it would recurse into the same duplicate.
 */
export async function reportDuplicatePurpose(
  env: Env,
  purpose: string,
  rows: Array<{ id: number; x_meta_template_id: string }>,
  chosen: { id: number; x_meta_template_id: string },
): Promise<void> {
  const list = rows.map((r) => `${r.x_meta_template_id}#${r.id}`).join(", ");
  console.error(
    `[templates] duplicate x_purpose='${purpose}': ${list} — using ${chosen.x_meta_template_id}#${chosen.id}`,
  );
  if (purpose === T.OWNER_ALERT) return;
  try {
    const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const key = `dup_purpose:${purpose}:${day}`;
    if (env.MSG_DEDUP) {
      if (await env.MSG_DEDUP.get(key)) return;
      await env.MSG_DEDUP.put(key, "1", { expirationTtl: 26 * 3600 });
    }
    await sendOwnerAlert(
      env,
      `قوالب واتساب: الغرض ${purpose} مربوط بأكثر من قالب (${list}). أُرسل ${chosen.x_meta_template_id}. اترك قالباً واحداً لهذا الغرض في Odoo.`,
    );
  } catch (e) {
    console.warn("[templates] duplicate-purpose alert failed", (e as Error)?.message);
  }
}

/**
 * Send an approved Meta template by internal purpose, through the single
 * gateway (src/wa-gateway.ts): the template goes only if it is APPROVED and
 * its Meta category may carry the purpose (UTILITY; MARKETING only for a
 * marketing purpose), whatever the window. Otherwise the fallbacks, in order
 * (a session message there waits for the number's window).
 * @param bodyParams — ordered strings for {{1}}, {{2}}, … — or a function of the
 *                     resolved Meta template name, for a purpose moving between
 *                     templates with different variables.
 * @param buttonPayloads — QUICK_REPLY payload per button index.
 */
export async function sendTemplateByPurpose(
  env: Env,
  to: string,
  purpose: string,
  bodyParams: string[] | ((templateName: string) => string[]) = [],
  buttonPayloads: QuickReplyPayload[] = [],
  headerMedia?: HeaderMedia,
  opts: {
    // 2026-09-25 (STATUS § 29) — the purpose the owner guard sees, when it
    // differs from the lookup purpose: Baraa's daily utak_shift_start_v2 is
    // looked up as team_shift_start and sent as owner_window.
    sendPurpose?: string;
    /** The message's purpose when it differs from the template lookup purpose. */
    requestPurpose?: string;
    fallback?: GwOption[];
    ctx?: ExecutionContext;
    important?: boolean;
    expiresAt?: number;
  } = {},
): Promise<Response> {
  return sendViaGateway(env, {
    purpose: opts.requestPurpose ?? purpose,
    to,
    content: { kind: "template", purpose, params: bodyParams, buttons: buttonPayloads, header: headerMedia },
    fallback: opts.fallback,
    guardPurpose: opts.sendPurpose,
    ctx: opts.ctx,
    important: opts.important,
    expiresAt: opts.expiresAt,
  });
}

// ---- Params per template for a purpose that changed template ----

/** "9:00 مساءً" for 21 — the daily cutoff as the customer reads it. */
export function cutoffLabel(hour24: number = ORDERING_HOURS_CLOSE): string {
  const h = ((hour24 + 11) % 12) + 1;
  return `${h}:00 ${hour24 >= 12 ? "مساءً" : "صباحاً"}`;
}

/**
 * customer_welcome: utak_welcome (UTILITY) = «أهلاً {{1}} … آخر موعد للطلب
 * يومياً الساعة {{2}}»; the legacy utak_v2_welcome (MARKETING) took only {{1}}.
 */
export function welcomeParams(templateName: string, name: string): string[] {
  return templateName === "utak_v2_welcome" ? [name] : [name, cutoffLabel()];
}

/**
 * supplier_ask (2026-09-25): utak_supplier_ask_v2 (UTILITY) = «صباح الخير {{1}}،
 * معك يو تاك … لهالأصناف: {{2}} …»; the legacy utak_supplier_daily_ask
 * (MARKETING) takes only the list as {{1}}. Any other name gets the new shape.
 */
export const SUPPLIER_ASK_LEGACY = "utak_supplier_daily_ask";
export function supplierAskParams(templateName: string, supplierName: string, productList: string): string[] {
  return templateName === SUPPLIER_ASK_LEGACY ? [productList] : [supplierName, productList];
}

/**
 * owner_alert (2026-09-25): utak_owner_alert_v3 (UTILITY) = «إشعار آلي من نظام
 * يو تاك بشأن عمليات حسابك، سُجّل بتاريخ {{1}}: {{2}}. …» = [when, alert]; the
 * legacy utak_owner_alert and _v2 (both MARKETING at Meta now) take the alert
 * alone. v3's fixed text is longer, so its alert is cut shorter (≤ 1024 total).
 */
export const OWNER_ALERT_V3 = "utak_owner_alert_v3";
export const OWNER_ALERT_V3_TEXT_MAX = 800;
export function ownerAlertParams(templateName: string, alert: string, when: string): string[] {
  return templateName === OWNER_ALERT_V3 ? [when, sanitizeTemplateParam(alert, OWNER_ALERT_V3_TEXT_MAX)] : [alert];
}
/** «25 سبتمبر 2026، 18:01» — the Riyadh time an owner alert is raised. */
export function ownerAlertTime(now: Date = new Date()): string {
  const m = riyadhMinutes(now);
  return `${arabicDate(riyadhDateKey(now))}، ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * purchase_list_remind (2026-09-25): utak_purchase_list_remind_v2 (UTILITY) =
 * «… قائمة الشراء رقم {{1}} المسندة إليك ليوم {{2}}، وعدد أصنافها {{3}} …» =
 * [list id, date, count]; utak_purchase_list_remind_v1 (MARKETING at Meta
 * now) takes [date, count].
 */
export const PURCHASE_REMIND_V2 = "utak_purchase_list_remind_v2";
export function purchaseRemindParams(templateName: string, listId: number, date: string, count: number): string[] {
  return templateName === PURCHASE_REMIND_V2 ? [String(listId), date, String(count)] : [date, String(count)];
}

// ---- Purpose constants ----
export const T = {
  SUPPLIER_ASK: "supplier_ask",
  PURCHASE_LIST: "purchase_list",
  LOADING_DONE: "loading_done",
  DRIVER_DISPATCH: "driver_dispatch",
  DRIVER_STOP: "driver_stop",
  DRIVER_COLLECTION: "driver_collection",
  COLLECTION_REQUEST: "collection_request",
  COLLECTION_SUMMARY: "collection_summary",
  COMMISSION: "commission",
  OWNER_SUMMARY: "owner_summary",
  OWNER_ALERT: "owner_alert",
  TEAM_SHIFT_START: "team_shift_start",
  CUSTOMER_WELCOME: "customer_welcome",
  CUSTOMER_DAILY_REMIND: "customer_daily_remind",
  CUSTOMER_ORDER_CONFIRM: "customer_order_confirm",
  CUSTOMER_DELIVERY_INCOMING: "customer_delivery_incoming",
  CUSTOMER_DELIVERY_DONE: "customer_delivery_done",
  CUSTOMER_INVOICE: "customer_invoice",
  CUSTOMER_INVOICE_PDF: "customer_invoice_pdf",
  CUSTOMER_QUOTATION_PDF: "customer_quotation_pdf",
  CUSTOMER_PAY_REMIND: "customer_pay_remind",
  CUSTOMER_INACTIVE: "customer_inactive",
  CUSTOMER_FEEDBACK: "customer_feedback",
  /** utak_order_update (UTILITY, 2 vars): order number + what changed. 2026-09-24 (ح3). */
  CUSTOMER_ORDER_UPDATE: "customer_order_update",
  /**
   * utak_order_confirm_remind_v1 (UTILITY, 2 vars + «تأكيد الطلب» / «إلغاء»):
   * order number + cutoff time. 2026-09-25 — completes ح3; until Meta approves
   * it and the purpose is moved, the 20:00 reminder falls back to
   * CUSTOMER_ORDER_UPDATE.
   */
  CUSTOMER_ORDER_REMIND: "customer_order_remind",
  /**
   * utak_supplier_price_nudge (UTILITY, 2 vars): supplier name + the time the
   * prices are needed. 2026-09-25 (م5) — the one reminder at 05:00.
   */
  SUPPLIER_PRICE_NUDGE: "supplier_price_nudge",
  /**
   * utak_purchase_list_remind_v2 (UTILITY, 3 vars + «تم الشراء»): list id,
   * list date, item count — v1 (2 vars) was moved to MARKETING by Meta.
   * 2026-09-25 — completes ح7; until moved, the 06:00 follow-up re-sends
   * PURCHASE_LIST marked as a reminder.
   */
  PURCHASE_LIST_REMIND: "purchase_list_remind",
  /**
   * utak_payment_received (UTILITY, 2 vars: amount, invoice number). § 34 — the
   * receipt's template outside the customer's window (receipt.ts).
   */
  CUSTOMER_PAYMENT_RECEIVED: "customer_payment_received",
  /** § 34 — the collector's / driver's note to Baraa (src/team-note.ts). */
  OWNER_TEAM_NOTE: "owner_team_note",
  /** § 34 — «فتح المحادثة», one UTILITY template per category (src/wa-opener.ts). */
  CONV_OPEN_CUSTOMER: "conv_open_customer",
  CONV_OPEN_TEAM: "conv_open_team",
  CONV_OPEN_SUPPLIER: "conv_open_supplier",
  CONV_OPEN_OWNER: "conv_open_owner",
  /**
   * § 37 — utak_supplier_payment_sent (UTILITY, 4 vars: amount, date,
   * reference, remaining): the supplier's notice of an approved payment
   * outside his window (src/supplier-pay.ts settlePayment).
   */
  SUPPLIER_PAYMENT_SENT: "supplier_payment_sent",
} as const;

// ============================================================
// Owner-facing alert helper
//
// 2026-09-17: through the utak_owner_alert template, with a text fallback.
// 2026-09-25 (STATUS § 26): text inside his 24h window, the template outside.
// 2026-09-25 (STATUS § 33, the single gateway): utak_owner_alert is MARKETING
// at Meta (v2 too; v3 refused), and Meta dropped it with #131049 again and
// again (§ 26, § 28, § 32) — an operational alert never uses a MARKETING
// template now. Inside his window the alert goes as text; outside it, it is
// held for his number and reaches him at his next message or tap (the 06:00
// «بدء الدوام» template opens his window every day).
// 2026-09-25 (STATUS § 34): no template option at all — utak_owner_alert is
// not used. An alert is critical («مهمة»): held outside his window, it also
// sends utak_update_owner once a day («عرض التحديث» flushes them all), the
// backup of his 06:00 message (src/wa-opener.ts).
// ============================================================
import { arabicDate, sanitizeTemplateParam } from "./wa-params";
import { riyadhDateKey, riyadhMinutes } from "./hours";

export async function sendOwnerAlert(env: Env, text: string): Promise<void> {
  await sendOwnerMessage(env, text, T.OWNER_ALERT);
}

/**
 * A text to Baraa through the gateway, under `purpose` (owner_alert, or
 * owner_team_note for the collector's / driver's note). Text only: inside his
 * window it goes, outside it is held. Never throws.
 */
export async function sendOwnerMessage(env: Env, text: string, purpose: string = T.OWNER_ALERT): Promise<Response | null> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return null;
  try {
    return await sendViaGateway(env, {
      purpose,
      to: owner,
      content: { kind: "session", body: { type: "text", text: { body: String(text ?? "") } } },
    });
  } catch (e) {
    console.warn("[owner-alert] gateway send failed", (e as Error)?.message);
    return null;
  }
}
