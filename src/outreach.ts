// ============================================================
// v7: Outbound outreach cron — feedback, pay reminders, inactive re-engagement.
// Runs once a day (05:00 UTC = 08:00 Riyadh).
//
// 2026-09-24 (م2، م3، م19 — WA-SCENARIOS):
//   • pay reminders read the real x_invoice schema. The old query asked for
//     x_customer_id / x_paid_amount (not fields of x_invoice) and statuses
//     pending / partial (the selection is issued / paid / overdue): Odoo
//     answered HTTP 500 every morning and no reminder ever went out. Now:
//     at most one every PAY_REMIND_EVERY_DAYS, PAY_REMIND_MAX per debt, then
//     one owner alert; a reminded customer's «حولت» or receipt reaches the
//     owner and the collectors (pay-claim.ts);
//   • the inactive nudge needs at least one delivered order — a customer who
//     never ordered is not «inactive»;
//   • the feedback request goes out at most once every FEEDBACK_EVERY_DAYS;
//   • both MARKETING messages skip customers who sent «إيقاف» (optout.ts);
//   • a task that throws alerts the owner instead of a console line only.
// ============================================================
import type { Env } from "./config";
import { riyadhDateKey } from "./hours";
import { call } from "./odoo";
import { readMarketingOptouts } from "./optout";
import { markPayRemindSent } from "./pay-claim";
import { sendOwnerAlert, sendTemplateByPurpose, T } from "./templates";

/** م2 — pending Baraa (س3): one reminder every N days, at most MAX per debt. */
export const PAY_REMIND_EVERY_DAYS = 3;
export const PAY_REMIND_MAX = 3;
/** An invoice is reminded once it is this many days old (unchanged rule). */
export const PAY_REMIND_MIN_AGE_DAYS = 3;
/** م19 — one feedback request per customer every N days. */
export const FEEDBACK_EVERY_DAYS = 7;
/** م3 — «inactive» = no order for N days; nudged at most once every M days. */
export const INACTIVE_AFTER_DAYS = 14;
export const INACTIVE_EVERY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const kvPayRemind = (custId: number) => `payremind:v1:${custId}`;
const kvFeedback = (custId: number) => `feedback:v1:${custId}`;
const kvInactive = (custId: number) => `inactive:${custId}`;

type M2O = [number, string] | false;
type PartnerRow = { id: number; name: string; phone?: string | false; x_whatsapp_number?: string | false };

const waOf = (p: PartnerRow): string => String(p.x_whatsapp_number || p.phone || "");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Riyadh calendar day `days` before today. */
function riyadhYmdAgo(days: number): string {
  return riyadhDateKey(new Date(Date.now() - days * DAY_MS));
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(toYmd + "T00:00:00Z") - Date.parse(fromYmd + "T00:00:00Z")) / DAY_MS);
}

async function readPartners(env: Env, ids: number[], extra: unknown[] = []): Promise<PartnerRow[]> {
  if (ids.length === 0) return [];
  return call<PartnerRow[]>(env, "res.partner", "search_read", {
    domain: [["id", "in", ids], ["active", "=", true], ...extra],
    fields: ["id", "name", "phone", "x_whatsapp_number"],
    limit: ids.length,
  });
}

// ---------------------------------------------------------------- feedback

/**
 * FEEDBACK: customers whose orders were delivered in the last 24h, at most
 * once every FEEDBACK_EVERY_DAYS (م19), never to an opted-out customer (م3).
 */
export async function sendPostDeliveryFeedback(env: Env): Promise<{ sent: number; skipped: number }> {
  const since = new Date(Date.now() - DAY_MS).toISOString().replace("T", " ").slice(0, 19);
  const orders = await call<Array<{ x_customer_id: M2O }>>(env, "x_daily_order", "search_read", {
    domain: [["x_state", "=", "delivered"], ["x_delivered_at", ">=", since]],
    fields: ["id", "x_customer_id"],
    limit: 200,
  });
  const ids = [...new Set(orders.map((o) => (o.x_customer_id ? o.x_customer_id[0] : 0)).filter(Boolean))];
  const optedOut = await readMarketingOptouts(env, ids);
  let sent = 0, skipped = 0;
  for (const cust of await readPartners(env, ids)) {
    const wa = waOf(cust);
    if (!wa || optedOut.has(cust.id) || (await env.MSG_DEDUP.get(kvFeedback(cust.id)))) { skipped++; continue; }
    try {
      const resp = await sendTemplateByPurpose(env, wa, T.CUSTOMER_FEEDBACK, [cust.name || ""]);
      if (!resp?.ok) { skipped++; continue; }
      await env.MSG_DEDUP.put(kvFeedback(cust.id), riyadhDateKey(), { expirationTtl: FEEDBACK_EVERY_DAYS * 86400 });
      sent++;
    } catch (e) { console.error("[feedback] send fail", (e as Error).message); }
  }
  console.log(`[outreach] feedback sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}

// ---------------------------------------------------------------- pay remind

export interface PayRemindState {
  /** reminders sent for this debt. */
  count: number;
  /** Riyadh day of the last one. */
  last: string;
  /** the amount owed at the last one. */
  amount: number;
}

/**
 * The cap, as a pure function. A debt that grew since the last reminder (a
 * new invoice became overdue) starts a new cycle; a partial payment does not.
 */
export function payRemindDecision(
  prev: PayRemindState | null,
  amount: number,
  today: string,
): { send: boolean; next: PayRemindState; last: boolean } {
  const fresh = !prev || amount > prev.amount + 0.005;
  const count = fresh ? 0 : prev!.count;
  const due = fresh || (daysBetween(prev!.last, today) >= PAY_REMIND_EVERY_DAYS && count < PAY_REMIND_MAX);
  if (!due) return { send: false, next: prev!, last: false };
  const next = { count: count + 1, last: today, amount };
  return { send: true, next, last: next.count >= PAY_REMIND_MAX };
}

async function readPayRemindState(env: Env, custId: number): Promise<PayRemindState | null> {
  const raw = await env.MSG_DEDUP.get(kvPayRemind(custId));
  try { return raw ? (JSON.parse(raw) as PayRemindState) : null; } catch { return null; }
}

/** Owed per customer from unpaid, non-simulation invoices at least MIN_AGE days old. */
export async function owedByCustomer(env: Env): Promise<Map<number, { amount: number; invoices: string[] }>> {
  type Inv = { id: number; x_invoice_number: string; x_total: number; x_order_id: M2O };
  const invoices = await call<Inv[]>(env, "x_invoice", "search_read", {
    // Same rule as the 18:00 collection list: simulation / test invoices
    // (x_is_simulation) are never chased.
    domain: [
      ["x_status", "in", ["issued", "overdue"]],
      ["x_invoice_date", "<=", riyadhYmdAgo(PAY_REMIND_MIN_AGE_DAYS)],
      ["x_is_simulation", "!=", true],
    ],
    fields: ["id", "x_invoice_number", "x_total", "x_order_id"],
    limit: 500,
  });
  const out = new Map<number, { amount: number; invoices: string[] }>();
  if (invoices.length === 0) return out;

  const payments = await call<Array<{ x_invoice_id: M2O; x_amount: number }>>(env, "x_payment", "search_read", {
    domain: [["x_invoice_id", "in", invoices.map((i) => i.id)]],
    fields: ["x_invoice_id", "x_amount"],
    limit: 5000,
  });
  const paid = new Map<number, number>();
  for (const p of payments) {
    const id = p.x_invoice_id ? p.x_invoice_id[0] : 0;
    if (id) paid.set(id, (paid.get(id) ?? 0) + (p.x_amount || 0));
  }
  const orderIds = [...new Set(invoices.map((i) => (i.x_order_id ? i.x_order_id[0] : 0)).filter(Boolean))];
  const orders = orderIds.length
    ? await call<Array<{ id: number; x_customer_id: M2O }>>(env, "x_daily_order", "read", {
        ids: orderIds, fields: ["id", "x_customer_id"],
      })
    : [];
  const custOf = new Map(orders.map((o) => [o.id, o.x_customer_id ? o.x_customer_id[0] : 0]));

  for (const inv of invoices) {
    const cust = inv.x_order_id ? custOf.get(inv.x_order_id[0]) : 0;
    const owed = round2((inv.x_total || 0) - (paid.get(inv.id) ?? 0));
    if (!cust || owed <= 0.005) continue;
    const row = out.get(cust) ?? { amount: 0, invoices: [] };
    row.amount = round2(row.amount + owed);
    row.invoices.push(inv.x_invoice_number);
    out.set(cust, row);
  }
  return out;
}

/**
 * PAY REMIND: one message per customer with the total owed (قرار مقفل),
 * capped by payRemindDecision.
 */
export async function sendPaymentReminders(env: Env): Promise<{ sent: number; capped: number; owing: number }> {
  const owed = await owedByCustomer(env);
  const today = riyadhDateKey();
  let sent = 0, capped = 0;
  for (const cust of await readPartners(env, [...owed.keys()])) {
    const wa = waOf(cust);
    const debt = owed.get(cust.id)!;
    if (!wa) continue;
    const d = payRemindDecision(await readPayRemindState(env, cust.id), debt.amount, today);
    if (!d.send) { capped++; continue; }
    try {
      const resp = await sendTemplateByPurpose(env, wa, T.CUSTOMER_PAY_REMIND,
        [cust.name || "", debt.amount.toFixed(2)]);
      if (!resp?.ok) continue; // ح6 records and alerts the failure; the slot is not used up
      await env.MSG_DEDUP.put(kvPayRemind(cust.id), JSON.stringify(d.next), { expirationTtl: 45 * 86400 });
      await markPayRemindSent(env, cust.id, debt.amount);
      sent++;
      if (d.last) {
        await sendOwnerAlert(env,
          `💰 ${cust.name} (#${cust.id}) وصله تذكير الدفع رقم ${d.next.count} (الأخير) والمستحق ${debt.amount.toFixed(2)} ر.س (${debt.invoices.join("، ")}). لا تذكير آلي بعده؛ المتابعة يدوية.`);
      }
    } catch (e) { console.error("[pay_remind] send fail", (e as Error).message); }
  }
  console.log(`[outreach] pay_remind sent=${sent} capped=${capped} owing=${owed.size}`);
  return { sent, capped, owing: owed.size };
}

// ---------------------------------------------------------------- inactive

/**
 * INACTIVE: customers with at least one delivered order and none in the last
 * INACTIVE_AFTER_DAYS (م3: a customer who never ordered is not inactive),
 * once per INACTIVE_EVERY_DAYS, never to an opted-out customer.
 */
export async function sendInactiveReengagement(env: Env): Promise<{ sent: number; skipped: number }> {
  const custIds = async (domain: unknown[]) => new Set(
    (await call<Array<{ x_customer_id: M2O }>>(env, "x_daily_order", "search_read", {
      domain, fields: ["x_customer_id"], limit: 5000,
    })).map((o) => (o.x_customer_id ? o.x_customer_id[0] : 0)).filter(Boolean),
  );
  const bought = await custIds([["x_state", "in", ["delivered", "closed"]]]);
  const recent = await custIds([["x_order_date", ">=", riyadhYmdAgo(INACTIVE_AFTER_DAYS)]]);
  const ids = [...bought].filter((id) => !recent.has(id));
  const optedOut = await readMarketingOptouts(env, ids);
  let sent = 0, skipped = 0;
  for (const c of await readPartners(env, ids, [["customer_rank", ">", 0]])) {
    const wa = waOf(c);
    if (!wa || optedOut.has(c.id) || (await env.MSG_DEDUP.get(kvInactive(c.id)))) { skipped++; continue; }
    try {
      const resp = await sendTemplateByPurpose(env, wa, T.CUSTOMER_INACTIVE, [c.name || ""]);
      if (!resp?.ok) { skipped++; continue; }
      await env.MSG_DEDUP.put(kvInactive(c.id), "1", { expirationTtl: INACTIVE_EVERY_DAYS * 86400 });
      sent++;
    } catch (e) { console.error("[inactive] send fail", (e as Error).message); }
  }
  console.log(`[outreach] inactive sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}

// ---------------------------------------------------------------- 08:00

const TASK_LABEL: Record<string, string> = { feedback: "طلب التقييم", pay_remind: "تذكير الدفع", inactive: "تذكير الغياب" };

export async function runDailyOutreach(env: Env): Promise<Record<string, unknown>> {
  const run = async (key: string, fn: (env: Env) => Promise<object>) => {
    try { return await fn(env); } catch (e) {
      const error = (e as Error).message;
      console.error(`[outreach] ${key} failed`, error);
      // م2 — the pay reminder failed silently every day; a failing task now
      // reaches the owner. The job runs once a day, so at most one alert per
      // task per day.
      try {
        await sendOwnerAlert(env, `⚠️ مهمة 08:00 «${TASK_LABEL[key]}» فشلت ولم يُرسل منها شيء: ${error.slice(0, 200)}`);
      } catch { /* the alert must not mask the report */ }
      return { sent: 0, error };
    }
  };
  const [feedback, pay_remind, inactive] = await Promise.all([
    run("feedback", sendPostDeliveryFeedback),
    run("pay_remind", sendPaymentReminders),
    run("inactive", sendInactiveReengagement),
  ]);
  const report = { feedback, pay_remind, inactive };
  console.log("[outreach] daily done", report);
  return report;
}
