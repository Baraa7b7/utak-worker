// ============================================================
// v7: Central template sender — reads Odoo x_whatsapp_template mapping
// and sends via Meta Graph API with body params + button payloads.
// ============================================================
import type { Env } from "./config";

// Meta template name resolution is cached in-memory per Worker isolate.
// The mapping rarely changes; if it does, redeploy or wait ~24h for
// isolate recycling.
const cache = new Map<string, { name: string; language: string }>();

async function fetchMapping(env: Env, purpose: string): Promise<{ name: string; language: string } | null> {
  const cached = cache.get(purpose);
  if (cached) return cached;
  const res = await fetch(`${env.ODOO_URL}/json/2/x_whatsapp_template/search_read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ODOO_API_KEY}`,
    },
    body: JSON.stringify({
      domain: [["x_purpose", "=", purpose]],
      fields: ["x_meta_template_id", "x_language"],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ x_meta_template_id: string; x_language: string }>;
  if (rows.length === 0) return null;
  const entry = { name: rows[0].x_meta_template_id, language: rows[0].x_language || "ar" };
  cache.set(purpose, entry);
  return entry;
}

export interface QuickReplyPayload {
  /** button index in the template (0-based) */
  index: number;
  /** payload string (what our webhook receives as buttonId when tapped) */
  payload: string;
}

/**
 * Send an approved Meta template by internal purpose.
 * @param bodyParams — ordered strings that map to {{1}}, {{2}}, ...
 * @param buttonPayloads — for templates with QUICK_REPLY buttons: assign a payload per button index.
 *                        Omit to accept Meta's default (which sends the button text back).
 */
export async function sendTemplateByPurpose(
  env: Env,
  to: string,
  purpose: string,
  bodyParams: string[] = [],
  buttonPayloads: QuickReplyPayload[] = [],
): Promise<Response | null> {
  const mapping = await fetchMapping(env, purpose);
  if (!mapping) {
    console.warn(`[templates] no mapping for purpose='${purpose}'`);
    return null;
  }
  const components: any[] = [];
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })),
    });
  }
  for (const b of buttonPayloads) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(b.index),
      parameters: [{ type: "payload", payload: b.payload }],
    });
  }
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: mapping.name,
        language: { code: mapping.language },
        components,
      },
    }),
  });
}

// ---- Purpose constants (all 19) ----
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
  CUSTOMER_WELCOME: "customer_welcome",
  CUSTOMER_DAILY_REMIND: "customer_daily_remind",
  CUSTOMER_ORDER_CONFIRM: "customer_order_confirm",
  CUSTOMER_DELIVERY_INCOMING: "customer_delivery_incoming",
  CUSTOMER_DELIVERY_DONE: "customer_delivery_done",
  CUSTOMER_INVOICE: "customer_invoice",
  CUSTOMER_PAY_REMIND: "customer_pay_remind",
  CUSTOMER_INACTIVE: "customer_inactive",
  CUSTOMER_FEEDBACK: "customer_feedback",
} as const;
