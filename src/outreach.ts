// ============================================================
// v7: Outbound outreach cron — feedback, pay reminders, inactive re-engagement.
// Runs once a day (05:00 UTC = 08:00 Riyadh).
// ============================================================
import type { Env } from "./config";
import { sendTemplateByPurpose, T } from "./templates";

async function odooSearchRead<T = any>(
  env: Env, model: string, domain: any[], fields: string[], limit = 200, order?: string,
): Promise<T[]> {
  const body: any = { domain, fields, limit };
  if (order) body.order = order;
  const res = await fetch(`${env.ODOO_URL}/json/2/${model}/search_read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ODOO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`odoo search_read ${model}: ${res.status}`);
  return (await res.json()) as T[];
}

/**
 * FEEDBACK: send `customer_feedback` to customers whose orders were delivered
 * in the last 24h and who haven't been asked yet today.
 */
export async function sendPostDeliveryFeedback(env: Env): Promise<{ sent: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const orders = await odooSearchRead(env, "x_daily_order", [
    ["x_state", "=", "delivered"],
    ["x_delivered_at", ">=", since],
  ], ["id", "x_customer_id", "x_delivered_at"], 100);

  // Dedup per customer (one feedback per delivered order max)
  let sent = 0;
  const seen = new Set<number>();
  for (const o of orders as any[]) {
    const custId = o.x_customer_id?.[0];
    if (!custId || seen.has(custId)) continue;
    seen.add(custId);
    const [cust] = await odooSearchRead(env, "res.partner",
      [["id", "=", custId]], ["name", "phone", "x_whatsapp_number"], 1);
    const wa = (cust as any)?.x_whatsapp_number || (cust as any)?.phone;
    if (!wa) continue;
    try {
      await sendTemplateByPurpose(env, wa, T.CUSTOMER_FEEDBACK, [(cust as any).name || ""]);
      sent++;
    } catch (e) { console.error("[feedback] send fail", (e as Error).message); }
  }
  console.log(`[outreach] feedback sent=${sent}`);
  return { sent };
}

/**
 * PAY REMIND: customers with unpaid invoices older than 3 days.
 */
export async function sendPaymentReminders(env: Env): Promise<{ sent: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const invoices = await odooSearchRead(env, "x_invoice", [
    ["x_status", "in", ["pending", "partial"]],
    ["x_invoice_date", "<=", threeDaysAgo],
  ], ["id", "x_customer_id", "x_total", "x_paid_amount"], 200);
  let sent = 0;
  // Aggregate by customer
  const owedByCust = new Map<number, number>();
  for (const inv of invoices as any[]) {
    const custId = inv.x_customer_id?.[0];
    if (!custId) continue;
    const owed = (inv.x_total || 0) - (inv.x_paid_amount || 0);
    if (owed <= 0) continue;
    owedByCust.set(custId, (owedByCust.get(custId) || 0) + owed);
  }
  for (const [custId, amount] of owedByCust) {
    const [cust] = await odooSearchRead(env, "res.partner",
      [["id", "=", custId]], ["name", "phone", "x_whatsapp_number"], 1);
    const wa = (cust as any)?.x_whatsapp_number || (cust as any)?.phone;
    if (!wa) continue;
    try {
      await sendTemplateByPurpose(env, wa, T.CUSTOMER_PAY_REMIND,
        [(cust as any).name || "", amount.toFixed(2)]);
      sent++;
    } catch (e) { console.error("[pay_remind] send fail", (e as Error).message); }
  }
  console.log(`[outreach] pay_remind sent=${sent}`);
  return { sent };
}

/**
 * INACTIVE: customers who haven't ordered in 14+ days.
 * Sends `customer_inactive` template once per 30 days per customer (KV dedup).
 */
export async function sendInactiveReengagement(env: Env): Promise<{ sent: number }> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // All customers with a phone
  const customers = await odooSearchRead(env, "res.partner",
    [["customer_rank", ">", 0], ["active", "=", true]],
    ["id", "name", "phone", "x_whatsapp_number"], 500);
  let sent = 0;
  for (const c of customers as any[]) {
    const wa = c.x_whatsapp_number || c.phone;
    if (!wa) continue;
    // Skip if we sent an inactive nudge in the last 30 days
    const key = `inactive:${c.id}`;
    if (await env.MSG_DEDUP.get(key)) continue;
    // Check for any order in the last 14 days
    const recent = await odooSearchRead(env, "x_daily_order",
      [["x_customer_id", "=", c.id], ["x_order_date", ">=", fourteenDaysAgo]],
      ["id"], 1);
    if (recent.length > 0) continue;
    try {
      await sendTemplateByPurpose(env, wa, T.CUSTOMER_INACTIVE, [c.name || ""]);
      sent++;
      await env.MSG_DEDUP.put(key, "1", { expirationTtl: 30 * 24 * 60 * 60 });
    } catch (e) { console.error("[inactive] send fail", (e as Error).message); }
  }
  console.log(`[outreach] inactive sent=${sent}`);
  return { sent };
}

export async function runDailyOutreach(env: Env): Promise<void> {
  const [fb, pr, ia] = await Promise.all([
    sendPostDeliveryFeedback(env).catch(e => ({ sent: 0, error: (e as Error).message })),
    sendPaymentReminders(env).catch(e => ({ sent: 0, error: (e as Error).message })),
    sendInactiveReengagement(env).catch(e => ({ sent: 0, error: (e as Error).message })),
  ]);
  console.log("[outreach] daily done", { feedback: fb, pay_remind: pr, inactive: ia });
}
