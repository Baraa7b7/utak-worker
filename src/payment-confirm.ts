// م10 — the payment confirmation to the customer (2026-09-26, STATUS § 39 د; WA-SCENARIOS م10).
//
// One message per x_payment, through the gateway under customer_payment_received:
//   • inside the customer's 24h window: the receipt as text — «✅ استلمنا دفعتك
//     بمبلغ 60 ريال على فاتورة UTAK-INV-…. شكراً لك», then (a partial payment)
//     what is left on the invoice, the receipt number, the method and the PDF
//     link;
//   • outside it: utak_payment_received (UTILITY, APPROVED at Meta; Odoo #56) =
//     [amount, invoice number] — «استلمنا دفعتك بمبلغ {{1}} ريال على فاتورة
//     {{2}}. شكراً لك». Its two variables, partial or not.
// Who calls it: the receipt pipeline (Odoo automation #1, x_payment on create →
// /internal/receipt-issue → createAndDispatchReceiptForRecord), /admin/test-
// receipt, and the */5 sweep below (a payment whose receipt webhook was lost).
// The collector's «نقد / تحويل» only creates the x_payment: the confirmation is
// the receipt's (§ 34's own «تم استلام الدفعة» line was a second message).
// Nothing is sent:
//   • for a payment, its invoice or its order marked x_utak_simulation;
//   • to a customer held from customer automation (the number review, § 30) —
//     as «في الطريق» (م8);
//   • twice: a KV claim per payment before the send, then the x_wa_message rows
//     linked to the payment (x_res_model x_payment / x_res_id) — a second tap, a
//     re-fired webhook, /admin/test-receipt, the sweep or a lost KV key never
//     send it again;
//   • § 58 أ — never for a row that «✅ وصل» made from a transfer notice
//     (src/transfer-form.ts): its x_notes names the notice («إشعار تحويل
//     TRN-…») from the moment it is created, so Odoo's automation #1 — which
//     fires the receipt as soon as the row exists — finds the mark there. The
//     ONE message of that transfer («استلمنا تحويلك X ريال ✅ وسددنا: …», with
//     every receipt's link) is the notice's own. The receipt itself is still
//     issued and written back on the row. Every other payment — cash, one
//     created in Odoo — keeps its message exactly as it was.

import type { Env } from "./config";
import { call } from "./odoo";
import { textContent, documentContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { T } from "./templates";
import { claimButton } from "./button-lock";
import { heldPartnerIds } from "./screening";
import { SIM_FIELD } from "./supplier-pay";
import { toOdooUtc } from "./hours";
import { withAutoSendJob } from "./auto-send-guard";

export const PAYCONF_PURPOSE = T.CUSTOMER_PAYMENT_RECEIVED;
export const PAYCONF_TEMPLATE = "utak_payment_received";
export const PAYCONF_LINK_MODEL = "x_payment";
const PAYCONF_CLAIM_TTL = 30 * 24 * 60 * 60;
/** The sweep: a payment at least this old without its receipt (the webhook had its chance)… */
export const PAYCONF_SWEEP_MIN_AGE_MIN = 10;
/** …and no older than this (a confirmation a day late is not sent). */
export const PAYCONF_SWEEP_MAX_AGE_H = 24;
const PAYCONF_SWEEP_LIMIT = 5;
const MIN = 60_000;

export type PayConfAction =
  | "sent" | "held" | "skipped" | "failed"   // the gateway's answer
  | "already" | "claimed"                    // one message per payment
  | "transfer_notice"                        // § 58 أ — its message is the transfer notice's ONE message
  | "simulation" | "held_partner" | "no_phone" | "not_found";
export interface PayConfOutcome {
  action: PayConfAction;
  paymentId: number;
  invoiceNumber?: string;
  amount?: number;
  /** What is left on the invoice after this payment (0 = paid in full). */
  remaining?: number;
}
export interface PayConfReceipt {
  number?: string;
  url?: string;
  method?: string;
}

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * § 58 أ — the mark of a row made by «✅ وصل» of a transfer notice, as its
 * x_notes carries it («إشعار تحويل TRN-1a2b3c4d5e», then the reference when
 * there is one — src/transfer-form.ts writes it with the row).
 */
export const TRANSFER_NOTICE_NOTE_RE = /إشعار تحويل TRN-[a-f0-9]{10}(?![a-f0-9])/;
export const isTransferNoticeNote = (notes: unknown): boolean => typeof notes === "string" && TRANSFER_NOTICE_NOTE_RE.test(notes);

/** {{1}}: «60» or «60.50» — the amount the customer paid. */
export function paymentAmountLabel(amount: number): string {
  const n = round2(Number(amount || 0));
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** utak_payment_received's two variables: [amount, invoice (or receipt) number], one line each. */
export function payconfParams(amount: number, invoiceNumber: string): [string, string] {
  return [paymentAmountLabel(amount), String(invoiceNumber || "-").replace(/\s+/g, " ").trim() || "-"];
}

/**
 * The text inside the customer's window: the template's words first, then —
 * a partial payment — what is left on the invoice, and the receipt's number,
 * method and link when there is one.
 */
export function payconfText(a: { amount: number; invoiceNumber: string; remaining?: number; receipt?: PayConfReceipt }): string {
  const [amount, invoice] = payconfParams(a.amount, a.invoiceNumber);
  const lines = [`✅ استلمنا دفعتك بمبلغ ${amount} ريال على فاتورة ${invoice}. شكراً لك`];
  if (a.remaining !== undefined && a.remaining > 0.005) lines.push(`المتبقي على الفاتورة: ${paymentAmountLabel(a.remaining)} ريال`);
  if (a.receipt?.number) lines.push(`رقم الإيصال: ${a.receipt.number}`);
  if (a.receipt?.method) lines.push(`طريقة الدفع: ${a.receipt.method}`);
  // § 59 د — no link: the receipt follows as an attached file (sendReceiptFile)
  lines.push("يو تاك 🌿");
  return lines.join("\n");
}

/** § 59 د — the receipt's PDF as a file of its own, after the words that confirm the payment. */
export const RECEIPT_FILE_PURPOSE = "customer_receipt_file";
export type ReceiptFileAction = "sent" | "held" | "skipped" | "none";

/**
 * § 59 د — the receipt as an ATTACHED FILE (UTAK-R-….pdf), never a link: sent now inside the
 * customer's window; outside it, kept for his first open window (the purpose's own time: a week).
 * Nothing when the receipt has no file. Never throws.
 */
export async function sendReceiptFile(env: Env, to: string, receipt: PayConfReceipt | undefined, o: { paymentId?: number; ctx?: ExecutionContext } = {}): Promise<ReceiptFileAction> {
  if (!to || !receipt?.url) return "none";
  try {
    const d = gatewayDecision(await sendViaGateway(env, {
      purpose: RECEIPT_FILE_PURPOSE,
      to,
      content: documentContent(receipt.url, receipt.number || "UTAK-R", receipt.number ? `إيصال الدفع رقم ${receipt.number}` : "إيصال الدفع"),
      important: false,
      // (not linked to the payment: the linked row is the confirmation itself, one a payment)
      ctx: o.ctx,
    }));
    return d?.action === "session" ? "sent" : d?.action === "held" ? "held" : "skipped";
  } catch (e) {
    console.warn(`[payconf] the receipt's file${o.paymentId ? ` of payment #${o.paymentId}` : ""} could not be sent`, (e as Error)?.message);
    return "skipped";
  }
}

/** The rows of this payment's confirmation in x_wa_message (sent, or held to go). */
async function confirmedOnRecord(env: Env, paymentId: number): Promise<boolean> {
  try {
    const rows = await call<Array<{ id: number }>>(env, "x_wa_message", "search_read", {
      domain: [
        ["x_direction", "=", "out"],
        ["x_res_model", "=", PAYCONF_LINK_MODEL],
        ["x_res_id", "=", paymentId],
        ["x_status", "in", ["sent", "delivered", "read", "held", "dry_ok"]],
      ],
      fields: ["id"],
      limit: 1,
    });
    return rows.length > 0;
  } catch (e) {
    // the KV claim already stands for this payment: the record is the second net
    console.warn(`[payconf] record check for payment #${paymentId} failed`, (e as Error)?.message);
    return false;
  }
}

/** The one confirmation of `paymentId` to its customer (see the header). Throws on Odoo trouble before the send. */
export async function confirmPaymentToCustomer(
  env: Env,
  paymentId: number,
  opts: { receipt?: PayConfReceipt; ctx?: ExecutionContext } = {},
): Promise<PayConfOutcome> {
  const [pay] = await call<Array<{ id: number; x_invoice_id: M2O; x_amount: number | false } & Record<string, unknown>>>(env, "x_payment", "read", {
    ids: [paymentId], fields: ["id", "x_invoice_id", "x_amount", "x_notes", SIM_FIELD],
  });
  if (!pay || !m2oId(pay.x_invoice_id)) return { action: "not_found", paymentId };
  // § 58 أ — a transfer notice's row: the customer's one message is the notice's («✅ وصل»), never one a row
  if (isTransferNoticeNote(pay.x_notes)) {
    console.log(`[payconf] skip payment #${paymentId} — a transfer notice's row: its message is the notice's own`);
    return { action: "transfer_notice", paymentId, amount: round2(Number(pay.x_amount) || 0) };
  }
  const invoiceId = m2oId(pay.x_invoice_id);
  const [inv] = await call<Array<{ id: number; x_invoice_number: string | false; x_total: number | false; x_order_id: M2O } & Record<string, unknown>>>(env, "x_invoice", "read", {
    ids: [invoiceId], fields: ["id", "x_invoice_number", "x_total", "x_order_id", SIM_FIELD],
  });
  if (!inv) return { action: "not_found", paymentId };
  const [order] = m2oId(inv.x_order_id)
    ? await call<Array<{ id: number; x_customer_id: M2O } & Record<string, unknown>>>(env, "x_daily_order", "read", {
      ids: [m2oId(inv.x_order_id)], fields: ["id", "x_customer_id", SIM_FIELD],
    })
    : [];
  const amount = round2(Number(pay.x_amount) || 0);
  const invoiceNumber = String(inv.x_invoice_number || opts.receipt?.number || `#${invoiceId}`);
  const base = { paymentId, invoiceNumber, amount };
  if (pay[SIM_FIELD] === true || inv[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {
    const what = pay[SIM_FIELD] === true ? "payment" : inv[SIM_FIELD] === true ? "invoice" : "order";
    console.log(`[payconf] skip payment #${paymentId} — simulation (${SIM_FIELD} on the ${what}): nothing sent`);
    return { action: "simulation", ...base };
  }
  const customerId = m2oId(order?.x_customer_id);
  if (!customerId) return { action: "no_phone", ...base };
  const [p] = await call<Array<{ id: number; x_whatsapp_number: string | false; phone: string | false }>>(env, "res.partner", "read", {
    ids: [customerId], fields: ["id", "x_whatsapp_number", "phone"],
  });
  const to = String(p?.x_whatsapp_number || p?.phone || "");
  if (!to) return { action: "no_phone", ...base };
  try {
    if ((await heldPartnerIds(env, [customerId])).has(customerId)) {
      console.log(`[payconf] skip payment #${paymentId} — customer ${customerId} held for the number review`);
      return { action: "held_partner", ...base };
    }
  } catch (e) {
    console.warn(`[payconf] review state of ${customerId} unreadable — not holding`, (e as Error)?.message);
  }
  // what is left after this payment: the invoice less its real payments up to this one
  const pays = await call<Array<{ id: number; x_amount: number | false }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "=", invoiceId], ["id", "<=", paymentId], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_amount"],
    limit: 500,
  });
  const paid = round2(pays.reduce((s, x) => s + (Number(x.x_amount) || 0), 0));
  const remaining = Math.max(0, round2((Number(inv.x_total) || 0) - paid));
  const claim = await claimButton(env, `payconf:${paymentId}`, PAYCONF_CLAIM_TTL);
  if (!claim.claimed) return { action: "claimed", ...base, remaining };
  if (await confirmedOnRecord(env, paymentId)) return { action: "already", ...base, remaining };
  const r = await sendViaGateway(env, {
    purpose: PAYCONF_PURPOSE,
    to,
    content: textContent(payconfText({ amount, invoiceNumber, remaining, receipt: opts.receipt })),
    fallback: [{ kind: "template", purpose: PAYCONF_PURPOSE, params: payconfParams(amount, invoiceNumber) }],
    link: { model: PAYCONF_LINK_MODEL, id: paymentId },
    ctx: opts.ctx,
  });
  const d = gatewayDecision(r);
  const action: PayConfAction = d?.action === "session" || d?.action === "template" ? "sent"
    : d?.action === "held" ? "held"
    : d?.action === "skipped" || d?.action === "refused" ? "skipped"
    : "failed";
  // § 59 د — the receipt itself: an attached file after the words (now, or with his first open window)
  const file = action === "sent" || action === "held" ? await sendReceiptFile(env, to, opts.receipt, { paymentId, ctx: opts.ctx }) : "none";
  console.log(`[payconf] payment #${paymentId} (${invoiceNumber}, ${paymentAmountLabel(amount)}${remaining > 0 ? `, remaining ${paymentAmountLabel(remaining)}` : ""}) → ${action}${file !== "none" ? ` file=${file}` : ""}${d && "template" in d && d.template ? ` ${d.template}` : ""}`);
  return { action, ...base, remaining };
}

/**
 * The every-5-minutes net (the attendance tick's cron) for a lost receipt
 * webhook (the automation missed x_payment #11 on 09-23): a payment
 * PAYCONF_SWEEP_MIN_AGE_MIN – PAYCONF_SWEEP_MAX_AGE_H old,
 * not simulation, without a receipt number written back and without a claim,
 * goes through the receipt pipeline now (a few per tick). Its confirmation is
 * still the one per payment.
 */
export async function runPaymentConfirmTick(rawEnv: Env, nowMs: number = Date.now(), ctx?: ExecutionContext): Promise<Array<{ paymentId: number; action: string }>> {
  const rows = await call<Array<{ id: number }>>(rawEnv, "x_payment", "search_read", {
    domain: [
      ["create_date", ">=", toOdooUtc(nowMs - PAYCONF_SWEEP_MAX_AGE_H * 60 * MIN)],
      ["create_date", "<=", toOdooUtc(nowMs - PAYCONF_SWEEP_MIN_AGE_MIN * MIN)],
      [SIM_FIELD, "!=", true],
      ["x_studio_char_1_1", "=", false],
    ],
    fields: ["id"],
    order: "id asc",
    limit: 50,
  });
  const out: Array<{ paymentId: number; action: string }> = [];
  for (const { id } of rows) {
    if (out.length >= PAYCONF_SWEEP_LIMIT) break;
    if (await rawEnv.MSG_DEDUP.get(`btnlock:v1:payconf:${id}`)) continue;
    // the auto-send key is per (recipient, template, day, job): one job per payment, so a second payment of the day still goes
    const env = withAutoSendJob(rawEnv, `payment_confirm:${id}`);
    try {
      const { createAndDispatchReceiptForRecord } = await import("./receipt");
      const r = await createAndDispatchReceiptForRecord(env, id, ctx);
      out.push({ paymentId: id, action: r?.confirmation ?? "not_found" });
    } catch (e) {
      out.push({ paymentId: id, action: `error: ${(e as Error)?.message}` });
    }
  }
  return out;
}
