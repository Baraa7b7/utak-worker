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
//     send it again.

import type { Env } from "./config";
import { call } from "./odoo";
import { textContent } from "./meta";
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
  if (a.receipt?.url) lines.push(`الإيصال: ${a.receipt.url}`);
  lines.push("يو تاك 🌿");
  return lines.join("\n");
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
    ids: [paymentId], fields: ["id", "x_invoice_id", "x_amount", SIM_FIELD],
  });
  if (!pay || !m2oId(pay.x_invoice_id)) return { action: "not_found", paymentId };
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
  console.log(`[payconf] payment #${paymentId} (${invoiceNumber}, ${paymentAmountLabel(amount)}${remaining > 0 ? `, remaining ${paymentAmountLabel(remaining)}` : ""}) → ${action}${d && "template" in d && d.template ? ` ${d.template}` : ""}`);
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
