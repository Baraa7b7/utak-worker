// ============================================================
// v7: Central template sender — reads Odoo x_whatsapp_template mapping
// and sends via Meta Graph API with body params + button payloads.
// ============================================================
import type { Env } from "./config";
import { fetchMeta } from "./meta";
import { ORDERING_HOURS_CLOSE } from "./config";
import { pickTemplate, TEMPLATE_CANDIDATE_FIELDS, type TemplateCandidate } from "./template-pick";

// Candidate rows per purpose are cached in-memory per Worker isolate for
// MAPPING_TTL_MS, so moving an x_purpose in Odoo takes effect within minutes
// (was: until isolate recycling, up to ~24h).
const MAPPING_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { rows: TemplateCandidate[]; at: number }>();

/** Test hook — drop cached mappings. */
export function clearTemplateCache(): void { cache.clear(); }

async function fetchCandidates(env: Env, purpose: string): Promise<TemplateCandidate[] | null> {
  const cached = cache.get(purpose);
  if (cached && Date.now() - cached.at < MAPPING_TTL_MS) return cached.rows;
  const res = await fetch(`${env.ODOO_URL}/json/2/x_whatsapp_template/search_read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ODOO_API_KEY}`,
    },
    body: JSON.stringify({
      domain: [["x_purpose", "=", purpose]],
      fields: TEMPLATE_CANDIDATE_FIELDS,
      order: "id desc",
      limit: 10,
    }),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as TemplateCandidate[];
  // "No mapping" is not cached: a purpose wired in Odoo is picked up on the next send.
  if (rows.length > 0) cache.set(purpose, { rows, at: Date.now() });
  return rows;
}

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

export interface QuickReplyPayload {
  /** button index in the template (0-based) */
  index: number;
  /** payload string (what our webhook receives as buttonId when tapped) */
  payload: string;
}

/**
 * Send an approved Meta template by internal purpose.
 * @param bodyParams — ordered strings that map to {{1}}, {{2}}, ... — or a function of the
 *                     resolved Meta template name, for a purpose that is moving between
 *                     templates with different variables (the params follow the template).
 * @param buttonPayloads — for templates with QUICK_REPLY buttons: assign a payload per button index.
 *                        Omit to accept Meta's default (which sends the button text back).
 */
export type HeaderMedia =
  | { type: "document"; link: string; filename: string }
  | { type: "image"; link: string }
  | { type: "video"; link: string };

export async function sendTemplateByPurpose(
  env: Env,
  to: string,
  purpose: string,
  bodyParams: string[] | ((templateName: string) => string[]) = [],
  buttonPayloads: QuickReplyPayload[] = [],
  headerMedia?: HeaderMedia,
): Promise<Response | null> {
  const rows = await fetchCandidates(env, purpose);
  const paramsFor = (name: string): string[] =>
    typeof bodyParams === "function" ? bodyParams(name) : bodyParams;
  const chosen = rows ? pickTemplate(rows, (name) => paramsFor(name).length) : null;
  if (!rows || !chosen) {
    console.warn(`[templates] no mapping for purpose='${purpose}'`);
    return null;
  }
  if (rows.length > 1) await reportDuplicatePurpose(env, purpose, rows, chosen);
  const mapping = { name: chosen.x_meta_template_id, language: chosen.x_language || "ar" };
  const params = paramsFor(mapping.name);
  const components: any[] = [];
  if (headerMedia) {
    const param: any = { type: headerMedia.type };
    if (headerMedia.type === "document") {
      param.document = { link: headerMedia.link, filename: headerMedia.filename };
    } else if (headerMedia.type === "image") {
      param.image = { link: headerMedia.link };
    } else if (headerMedia.type === "video") {
      param.video = { link: headerMedia.link };
    }
    components.push({ type: "header", parameters: [param] });
  }
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((t) => ({ type: "text", text: String(t) })),
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
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: mapping.name,
      language: { code: mapping.language },
      components,
    },
  }, { purpose });
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
} as const;

// ============================================================
// Owner-facing alert helper (2026-09-17)
//
// Every "Baraa needs to know" event used to go through sendText(env,
// OWNER_WHATSAPP, ...) — free-form text that Meta refuses outside the
// 24-hour customer service window. The 06:00 supplier-recap alert
// silently failed because Baraa hadn't messaged the number that day.
//
// Route the same text through an approved template first (`owner_alert`
// purpose, template `utak_owner_alert`); on any failure — no Odoo
// mapping, template pending Meta approval, non-2xx Meta response —
// fall back to the original sendText so behavior is never worse than
// today.
//
// Meta template variable rules: no newline / tab / 4+ consecutive
// spaces. Alerts often contain \n from string interpolation; sanitize
// them to " | " and cap at 900 chars so the parameter always passes
// Meta's validation.
// ============================================================
import { sendText } from "./meta";
import { sanitizeTemplateParam } from "./wa-params";

// 2026-09-24 — the owner alert keeps its own " | " separator (reads better in
// an alert than " · "), then the shared sanitizer in fetchMeta applies to it
// like to every other template variable.
function sanitizeOwnerAlertParam(text: string): string {
  return sanitizeTemplateParam(String(text ?? "").replace(/[\r\n\t]+/g, " | "));
}

export async function sendOwnerAlert(env: Env, text: string): Promise<void> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return;
  const original = String(text ?? "");
  try {
    const param = sanitizeOwnerAlertParam(original);
    const resp = await sendTemplateByPurpose(env, owner, T.OWNER_ALERT, [param]);
    if (resp && resp.ok) return;
  } catch (e) {
    console.warn("[owner-alert] template send exception", (e as Error)?.message);
  }
  try {
    await sendText(env, owner, original, { purpose: "owner_alert" });
  } catch (e) {
    console.error("[owner-alert] fallback sendText failed", (e as Error)?.message);
  }
}
