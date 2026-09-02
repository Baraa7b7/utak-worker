// v6 additions — self-contained (own Bearer call helper)
import type { Env } from "./config";

async function v6Call<T = unknown>(
  env: Env, model: string, method: string, body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${env.ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ODOO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const p = parsed as any;
    throw new Error(`odoo ${p?.data?.name ?? res.status}: ${p?.data?.message ?? text.slice(0, 200)}`);
  }
  return parsed as T;
}

// ---- v6.1 Standing Orders ----
export type StandingOrder = {
  id: number;
  x_customer_id: [number, string];
  x_frequency: string;
  x_active: boolean;
  x_last_triggered: string | false;
  x_line_ids: number[];
};
export type StandingLine = {
  id: number;
  x_product_tmpl_id: [number, string];
  x_packaging_id: [number, string];
  x_default_quantity: number;
  x_notes: string | false;
};

export async function getActiveStandingOrders(env: Env): Promise<StandingOrder[]> {
  return v6Call<StandingOrder[]>(env, "x_standing_order", "search_read", {
    domain: [["x_active", "=", true]],
    fields: ["id", "x_customer_id", "x_frequency", "x_active", "x_last_triggered", "x_line_ids"],
  });
}
export async function getStandingLines(env: Env, standingId: number): Promise<StandingLine[]> {
  return v6Call<StandingLine[]>(env, "x_standing_order_line", "search_read", {
    domain: [["x_standing_id", "=", standingId]],
    fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_default_quantity", "x_notes"],
  });
}
export async function createOrderFromStanding(
  env: Env, standing: StandingOrder,
): Promise<number | null> {
  const customerId = standing.x_customer_id[0];
  const lines = await getStandingLines(env, standing.id);
  if (lines.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const orderIds = await v6Call<number[]>(env, "x_daily_order", "create", {
    vals_list: [{
      x_customer_id: customerId,
      x_order_date: today,
      x_state: "draft",
      x_created_via: "standing_order",
    }],
  });
  const orderId = Array.isArray(orderIds) ? orderIds[0] : (orderIds as unknown as number);
  if (!orderId) return null;
  const lineVals = lines.map(l => ({
    x_order_id: orderId,
    x_product_tmpl_id: l.x_product_tmpl_id[0],
    x_packaging_id: l.x_packaging_id[0],
    x_quantity: l.x_default_quantity,
    x_status: "pending",
  }));
  await v6Call(env, "x_daily_order_line", "create", { vals_list: lineVals });
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
  await v6Call(env, "x_standing_order", "write", {
    ids: [standing.id],
    vals: { x_last_triggered: nowStr },
  });
  return orderId;
}
export async function markStandingTriggered(env: Env, standingId: number): Promise<void> {
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
  await v6Call(env, "x_standing_order", "write", {
    ids: [standingId], vals: { x_last_triggered: nowStr },
  });
}
export async function setOrderConfirmed(env: Env, orderId: number): Promise<void> {
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
  await v6Call(env, "x_daily_order", "write", {
    ids: [orderId],
    vals: { x_state: "confirmed", x_confirmed_at: nowStr },
  });
}

// ---- v6.3 Complaints ----
export type ComplaintType = "quality" | "quantity" | "delay" | "staff_behavior" | "pricing" | "other";
export type ComplaintSeverity = "low" | "medium" | "high" | "critical";

export async function createComplaint(
  env: Env,
  args: {
    customerId: number;
    orderId?: number;
    type: ComplaintType;
    severity: ComplaintSeverity;
    text: string;
  },
): Promise<number | null> {
  const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
  const vals: Record<string, unknown> = {
    x_customer_id: args.customerId,
    x_type: args.type,
    x_severity: args.severity,
    x_message_text: args.text,
    x_status: "new",
    x_created_at: nowStr,
  };
  if (args.orderId) vals.x_order_id = args.orderId;
  const ids = await v6Call<number[]>(env, "x_complaint", "create", { vals_list: [vals] });
  return Array.isArray(ids) ? ids[0] : (ids as unknown as number);
}
export async function findLatestOrderForCustomer(env: Env, customerId: number): Promise<number | null> {
  const rows = await v6Call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
    domain: [["x_customer_id", "=", customerId]],
    fields: ["id"], order: "id desc", limit: 1,
  });
  return rows.length > 0 ? rows[0].id : null;
}
export async function getPartnerBasic(
  env: Env, partnerId: number,
): Promise<{ name: string; phone: string | false; whatsapp: string | false } | null> {
  const rows = await v6Call<Array<{ name: string; phone: string | false; x_whatsapp_number: string | false }>>(
    env, "res.partner", "search_read",
    { domain: [["id", "=", partnerId]], fields: ["name", "phone", "x_whatsapp_number"], limit: 1 }
  );
  if (rows.length === 0) return null;
  return { name: rows[0].name, phone: rows[0].phone, whatsapp: rows[0].x_whatsapp_number };
}
