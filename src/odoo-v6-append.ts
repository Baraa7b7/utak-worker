// v6 additions.
//
// v6Call used to be a self-contained Bearer-only Odoo client, which bypassed
// the sim-injection hook in src/odoo.ts::call. That meant x_standing_order /
// x_complaint / and any other row created through this file skipped the
// x_is_simulation stamp in sim mode — a silent isolation gap.
//
// Fix: delegate to the same `call` gateway prod uses. Zero behavior change
// for prod (`call` was already Bearer-first + session fallback); sim runs
// now stamp every v6 row correctly.
import type { Env } from "./config";
import { call } from "./odoo";

async function v6Call<T = unknown>(
  env: Env, model: string, method: string, body: Record<string, unknown>,
): Promise<T> {
  return call<T>(env, model, method, body);
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
  // 2026-09-24 — Riyadh calendar day (was the UTC day), like every other order path.
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
/** § 57 هـ — what the customer chose in the form utak_complaint_v1 (x_kind). */
export type ComplaintKind = "damaged" | "short" | "quality" | "delay" | "other";
/** § 57 هـ — Baraa's decision from WhatsApp (x_decision). */
export type ComplaintDecision = "compensate_next" | "credit_note" | "rejected";

/**
 * § 57 هـ — the form's own fields (src/complaint-form.ts), each written only
 * when the form gave it: a complaint from a plain text has none of them.
 */
export interface ComplaintFormFields {
  kind?: ComplaintKind;
  orderLineId?: number;
  productId?: number;
  affectedQty?: number;
  /** The customer's picture, base64 (x_photo is a binary field). */
  photoBase64?: string;
}
function complaintFormVals(args: ComplaintFormFields): Record<string, unknown> {
  const vals: Record<string, unknown> = {};
  if (args.kind) vals.x_kind = args.kind;
  if (args.orderLineId) vals.x_order_line_id = args.orderLineId;
  if (args.productId) vals.x_product_tmpl_id = args.productId;
  if (args.affectedQty !== undefined) vals.x_affected_qty = args.affectedQty;
  if (args.photoBase64) vals.x_photo = args.photoBase64;
  return vals;
}

export async function createComplaint(
  env: Env,
  args: {
    customerId: number;
    orderId?: number;
    type: ComplaintType;
    severity: ComplaintSeverity;
    text: string;
  } & ComplaintFormFields,
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
  Object.assign(vals, complaintFormVals(args));
  const ids = await v6Call<number[]>(env, "x_complaint", "create", { vals_list: [vals] });
  return Array.isArray(ids) ? ids[0] : (ids as unknown as number);
}
/**
 * § 57 هـ — the form's «إرسال» on a complaint his words already made (the
 * keyword's door): the order he chose in place of his latest one, the kind's
 * x_type in place of the classifier's, his note with those words, and the
 * form's own fields. The customer, the severity and the status stay as they are.
 */
export async function updateComplaintFromForm(
  env: Env, complaintId: number,
  args: { orderId: number; type: ComplaintType; text: string } & ComplaintFormFields,
): Promise<void> {
  await v6Call(env, "x_complaint", "write", {
    ids: [complaintId],
    vals: { x_order_id: args.orderId, x_type: args.type, x_message_text: args.text, ...complaintFormVals(args) },
  });
}

/** § 57 هـ — a complaint as Baraa's decision reads it: whose it is, and where it stands. */
export interface ComplaintBrief {
  id: number;
  customerId: number;
  customer: string;
  status: string;
  decision: ComplaintDecision | "";
  decidedAt: string;
  resolutionNote: string;
}
export async function getComplaintBrief(env: Env, complaintId: number): Promise<ComplaintBrief | null> {
  type Row = { id: number; x_customer_id: [number, string] | false; x_status: string | false; x_decision: ComplaintDecision | false; x_decided_at: string | false; x_resolution_note: string | false };
  const rows = await v6Call<Row[]>(env, "x_complaint", "search_read", {
    domain: [["id", "=", complaintId]],
    fields: ["id", "x_customer_id", "x_status", "x_decision", "x_decided_at", "x_resolution_note"], limit: 1,
  });
  const r = rows[0];
  if (!r || !r.x_customer_id) return null;
  return {
    id: r.id, customerId: r.x_customer_id[0], customer: r.x_customer_id[1], status: r.x_status || "",
    decision: r.x_decision || "", decidedAt: r.x_decided_at || "", resolutionNote: r.x_resolution_note || "",
  };
}
/**
 * § 57 هـ — Baraa's decision on a complaint: the decision, its moment, a line in
 * the resolution note and the status. A refusal closes it (dismissed, with its
 * moment); the two others leave it «investigating» — the compensation and the
 * credit note are made by hand, and Baraa closes it in Odoo when it is done.
 * Nothing else is written anywhere.
 */
export async function writeComplaintDecision(
  env: Env, complaintId: number,
  args: { decision: ComplaintDecision; atMs: number; resolutionNote: string },
): Promise<void> {
  const at = new Date(args.atMs).toISOString().replace("T", " ").slice(0, 19);
  const vals: Record<string, unknown> = {
    x_decision: args.decision, x_decided_at: at, x_resolution_note: args.resolutionNote,
    x_status: args.decision === "rejected" ? "dismissed" : "investigating",
  };
  if (args.decision === "rejected") vals.x_resolved_at = at;
  await v6Call(env, "x_complaint", "write", { ids: [complaintId], vals });
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
