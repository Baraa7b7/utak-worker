// Typed environment bindings and shared constants.
// Env keys map 1:1 to wrangler.toml [vars] + `wrangler secret put` names.

export interface Env {
  // ---- Secrets (wrangler secret put ...) ----
  META_APP_SECRET: string;
  META_ACCESS_TOKEN: string;
  META_VERIFY_TOKEN: string;
  ODOO_API_KEY: string;
  ANTHROPIC_API_KEY: string;

  // ---- Non-secret vars (wrangler.toml [vars]) ----
  META_PHONE_NUMBER_ID: string;
  META_WABA_ID: string;
  META_GRAPH_VERSION: string;
  WORKER_ORIGIN: string;
  ODOO_URL: string;
  ODOO_DB: string;
  ODOO_LOGIN: string;
  CLAUDE_MODEL_CLASSIFY: string;
  CLAUDE_MODEL_REPLY: string;

  // v3
  OWNER_WHATSAPP: string;   // Baraa's phone, E.164 with '+'

  // ---- Bindings ----
  MSG_DEDUP: KVNamespace;
  INVOICES_BUCKET: R2Bucket;

  // ---- Optional secrets ----
  ADMIN_TOKEN?: string;
  GOTENBERG_URL?: string;
  GOTENBERG_USER?: string;
  GOTENBERG_PASSWORD?: string;
  /** HMAC-SHA256 shared secret for Odoo → Worker internal webhooks (e.g. /internal/quotation-issue). */
  INTERNAL_WEBHOOK_SECRET?: string;
  /** Phase 1+: shared token for /odoo/hook/* routes (template sync, manual WA send). */
  ODOO_HOOK_TOKEN?: string;
  /**
   * 2026-09-19 — token gating GET /internal/sale-quotation-pdf.
   * Independent of INTERNAL_WEBHOOK_SECRET and ODOO_HOOK_TOKEN so this
   * browser-facing URL (Odoo Server Action → ir.actions.act_url) can be
   * rotated on its own if it leaks into a shared screen or browser history.
   */
  SALE_PDF_DOWNLOAD_TOKEN?: string;

  // ============================================================
  // Simulation-mode env (only bound in [env.sim], undefined in prod).
  // Reads: `env.SIMULATION_MODE === "true"` — never truthiness on the raw
  // string, since wrangler surfaces bools as strings.
  // ============================================================
  /** "true" only in the sim worker. Any other value = production behavior. */
  SIMULATION_MODE?: string;
  /** Shared secret gating every /sim/* endpoint (inject/outbound/reset/purge/trigger). */
  SIM_SECRET?: string;
  /** D1 binding for the sim_outbound log. Only bound on the sim worker. */
  SIM_DB?: D1Database;

  /**
   * PILOT_MODE — sends REAL Meta messages, but only to numbers permitted by
   * SIM_ALLOWLIST. Not the same worker as sim; a pilot deploy is a third
   * environment ([env.pilot]) sitting between sim and prod. Mutually
   * exclusive with SIMULATION_MODE. Requires a non-empty SIM_ALLOWLIST.
   */
  PILOT_MODE?: string;

  /**
   * Second, independent phone-range guard. Comma-separated list of E.164
   * prefixes or exact numbers; each entry begins with '+'. Every outbound
   * WhatsApp send is refused unless the recipient starts with at least
   * one entry.
   *
   * Semantics deliberately independent of SIMULATION_MODE / PILOT_MODE:
   * - unset  → allow all (production default)
   * - set    → strict allow-list, applied to sim / pilot / prod alike
   * - PILOT_MODE=true REQUIRES this to be non-empty (fail-closed)
   *
   * Examples: "+96650,+96651"  or "+966505154962,+966580040467"
   */
  SIM_ALLOWLIST?: string;

  /**
   * 2026-09-21 — accounting parallel-write switch.
   * "true" only in [env.sim.vars] until Baraa turns it on for prod. When
   * enabled, x_invoice creates get an account.move twin (out_invoice,
   * posted; VAT by invoice date — see VAT_EFFECTIVE_DATE_RIYADH) and
   * x_payment creates get an account.payment twin
   * routed to journal CSHD (cash) or BNK1 (bank). Accounting failure
   * never blocks the x_* row or the WhatsApp send — the owner is
   * alerted and the flow continues. Absent / any-other-value = disabled.
   *
   * WARNING: the Odoo tenant is shared between sim and prod, so any
   * posted move is a real move in the company's books. Flip this on
   * prod only after Baraa's explicit go-ahead.
   */
  ACCOUNTING_SYNC?: string;

  /**
   * 2026-09-23 — NOT a wrangler var. Set in code only, on a shallow copy
   * of env that scheduled() / runSimJob() hand to a job (see
   * withAutoSendJob in src/auto-send-guard.ts). When present, the send gateway
   * claims a KV idempotency key per (recipient, template, Riyadh day,
   * job) before sending, so a second run of the same job cannot send the
   * same message twice. Request paths (webhook replies, Odoo manual send)
   * never carry it.
   */
  AUTO_SEND_JOB?: string;

  /**
   * 2026-09-25 (STATUS § 29) — Riyadh «HH:MM» at which Baraa gets the daily
   * «بدء الدوام» template that opens his 24h window. Absent/invalid = 06:00.
   */
  OWNER_WINDOW_OPEN_AT?: string;
}

// ============================================================
// Runtime mode helpers
// ============================================================

export type RuntimeMode = "sim" | "pilot" | "prod";

export interface RuntimeModeResult {
  mode: RuntimeMode;
  /** Set to a non-null string when the env is misconfigured; callers must refuse to act on it. */
  misconfig: string | null;
}

/**
 * Single source of truth for which "world" the Worker is running in.
 * Callers that mutate state (Meta send, /sim/*) branch on this rather than
 * reading env.SIMULATION_MODE directly, so any future mode has one place
 * to slot in.
 */
export function runtimeMode(env: Env): RuntimeModeResult {
  const sim = env.SIMULATION_MODE === "true";
  const pilot = env.PILOT_MODE === "true";
  const allowlist = (env.SIM_ALLOWLIST ?? "").trim();

  if (sim && pilot) {
    return {
      mode: "sim", // sim wins if both accidentally set, but flag misconfig loud
      misconfig: "SIMULATION_MODE and PILOT_MODE both true — mutually exclusive; refusing to act",
    };
  }
  // Fail-closed guard: any test mode (sim OR pilot) must run against a
  // non-empty SIM_ALLOWLIST. Widened 2026-09-12 from pilot-only — sim used to
  // rely on D1 capture as its sole block, but /sim/inject + /sim/trigger can
  // create the same outbound bodies pilot generates, and one config drift
  // (SIMULATION_MODE flipped off, D1 unbound, code path changed) would send
  // open. The allowlist is now a mandatory second gate for both modes.
  // prod is untouched: sim=false and pilot=false fall through to the
  // production return below.
  if ((pilot || sim) && !allowlist) {
    return {
      mode: pilot ? "pilot" : "sim",
      misconfig:
        `${pilot ? "PILOT_MODE" : "SIMULATION_MODE"}=true requires non-empty SIM_ALLOWLIST — refusing to send to open recipients`,
    };
  }
  if (sim) return { mode: "sim", misconfig: null };
  if (pilot) return { mode: "pilot", misconfig: null };
  return { mode: "prod", misconfig: null };
}

/**
 * Parses SIM_ALLOWLIST into normalized prefixes.
 * Never throws — a malformed entry is dropped with a warn.
 */
export function parseAllowlist(env: Env): string[] {
  const raw = (env.SIM_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (!s.startsWith("+")) {
        console.warn(`[allowlist] dropping entry '${s}' — must start with '+'`);
        return false;
      }
      return true;
    });
}

/**
 * `to` may arrive with or without a leading '+' (Meta strips it in outbound
 * bodies). We normalize before comparing so both forms match the same
 * allowlist entry.
 */
export function isRecipientAllowed(env: Env, to: string): boolean {
  const list = parseAllowlist(env);
  if (list.length === 0) return true; // unset = production behavior
  const normalized = to.startsWith("+") ? to : `+${to}`;
  return list.some((p) => normalized.startsWith(p));
}

/**
 * Two independent criteria, kept explicitly separate.
 *
 * `isTestMode`  = "should Odoo creates be stamped with x_is_simulation AND
 *                 should outbound messages be recorded in sim_outbound?"
 *   → true for sim AND pilot.
 *   → drives the injection in src/odoo.ts::call and the D1 record in the send gateway.
 *   → also used by /sim/purge as the criterion for "this row is disposable".
 *
 * `shouldRealSend` = "should we actually POST to graph.facebook.com?"
 *   → false for sim; true for pilot and prod.
 *   → drives whether the send gateway hits Meta.
 *
 * A "misconfig" env (both flags true, or pilot with empty allowlist) is
 * treated as test mode — fail-closed — so no unstamped row can slip
 * through while the operator sorts the config out.
 */
export function isTestMode(env: Env): boolean {
  return env.SIMULATION_MODE === "true" || env.PILOT_MODE === "true";
}

export function shouldRealSend(env: Env): boolean {
  return env.SIMULATION_MODE !== "true";
}

// ============================================================
// Simulation-mode constants
// ============================================================

/**
 * Odoo models the sim wrapper marks with x_is_simulation=true on every create.
 * MUST stay in exact lockstep with the models on which Baraa has added the
 * x_is_simulation field manually in Odoo — a create against a model without
 * the field raises an Odoo ORM error.
 *
 * Authoritative list, 15 models (bumped 2026-09-12):
 *   res.partner, x_daily_order, x_daily_order_line, x_quotation, x_invoice,
 *   x_payment, x_delivery_route, x_delivery_stop, x_purchase_list,
 *   x_collection_task, x_standing_order, x_complaint, x_daily_price,
 *   x_supplier_price_request_log, x_message_analysis.
 *
 * Deliberately NOT in the list:
 *  - product.template: shared catalog, never sim-owned.
 *  - x_collection_item: no create call in the Worker; if a child row model,
 *    it cascades from x_collection_task.
 *  - x_standing_order_line: only read in the Worker; created by hand in Odoo.
 */
export const SIM_MARKED_MODELS: ReadonlySet<string> = new Set([
  "res.partner",
  "x_daily_order",
  "x_daily_order_line",
  "x_quotation",
  "x_invoice",
  "x_payment",
  "x_delivery_route",
  "x_delivery_stop",
  "x_purchase_list",
  "x_collection_task",
  "x_standing_order",
  "x_complaint",
  "x_daily_price",
  "x_supplier_price_request_log",
  "x_message_analysis",
]);

/**
 * The exact order /sim/purge deletes in, respecting foreign-key constraints.
 * Children first, parents last. res.partner is never deleted — it is
 * archived (active=false) at the end because Odoo refuses to unlink a
 * partner referenced by any surviving row.
 */
export const SIM_PURGE_ORDER: readonly string[] = [
  "x_daily_order_line",
  "x_delivery_stop",
  "x_payment",
  "x_invoice",
  "x_quotation",
  "x_collection_task",
  "x_delivery_route",
  "x_purchase_list",
  "x_daily_order",
  "x_standing_order",
  "x_complaint",
  "x_daily_price",
  "x_supplier_price_request_log", // between x_daily_price and x_message_analysis, per §7
  "x_message_analysis",
  "res.partner", // archived, not deleted — see purgeSimulationData
];

/**
 * Models the startup guard scans for any non-sim record. Deliberately narrow —
 * matches the spec: "نماذج الطلبات أو الفواتير أو الكوتيشنات".
 */
export const SIM_GUARD_MODELS: readonly string[] = [
  "x_daily_order",
  "x_quotation",
  "x_invoice",
];

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEDUP_TTL_SECONDS = 24 * 60 * 60;

// 2026-09-23 — VAT activation cutoff, a Riyadh-local calendar date (UTC+3,
// no DST), compared against the invoice date as YYYY-MM-DD. Source: Baraa's
// locked decision of 2026-09-23 — UTAK charges 15% VAT on invoices dated
// 2026-10-01 or later; anything dated before stays tax-free. The tax itself
// (id, rate, price-included) is read from Odoo (res.company
// account_sale_tax_id), never hard-coded — see scripts/tax-20260923-enable-vat.mjs.
export const VAT_EFFECTIVE_DATE_RIYADH = "2026-10-01";

/**
 * True when a Riyadh-local invoice date (YYYY-MM-DD) is on/after the VAT cutoff.
 * `effectiveDate` exists only so the live-verify script can post a taxed
 * cycle today (Odoo refuses future-dated moves); runtime callers never pass it.
 */
export function isVatApplicable(invoiceDateRiyadh: string, effectiveDate: string = VAT_EFFECTIVE_DATE_RIYADH): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDateRiyadh)) {
    throw new Error(`isVatApplicable: invoice date must be YYYY-MM-DD, got "${invoiceDateRiyadh}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error(`isVatApplicable: effective date must be YYYY-MM-DD, got "${effectiveDate}"`);
  }
  return invoiceDateRiyadh >= effectiveDate;
}

// v2: catalog cache in KV, refreshed hourly
// v2 (2026-09-15) — bump forces a re-query after the x_is_active_for_sale
// filter joined fetchCatalog's domain. Do not touch without also invalidating
// stale readers.
export const CATALOG_CACHE_KEY = "catalog:v2";
// 2026-09-15 — dropped from 1h to 5min. With x_is_active_for_sale as the
// day-to-day toggle Baraa flips from Odoo mobile, a full hour between the
// flip and the customer-facing effect is operationally unacceptable.
export const CATALOG_CACHE_TTL_SECONDS = 5 * 60;

// v2: ordering hours (Riyadh local time, 24h)
export const ORDERING_HOURS_OPEN = 6;    // 06:00 open
export const ORDERING_HOURS_CLOSE = 21;  // 21:00 close (cutoff)

// v3: KV flag key set by the 06:00 cron, TTL 20h so it clears before next morning
export const ORDERING_OPEN_KEY = (yyyyMmDd: string) => `ordering_open_${yyyyMmDd}`;
export const ORDERING_OPEN_TTL_SECONDS = 20 * 60 * 60;

// v3: supplier template purposes (must match x_whatsapp_template.x_purpose)
export const TMPL_SUPPLIER_ASK = "supplier_ask";
export const TMPL_SUPPLIER_CONFIRM = "supplier_confirm";

// 2026-09-25 (م5) — one reminder to a supplier still silent at the 05:00 job
// (3h after the 02:00 ask), then one owner alert per still-silent supplier
// when the 21:15 purchase list is built.
export const TMPL_SUPPLIER_PRICE_NUDGE = "supplier_price_nudge";
// 2026-09-25 — a supplier's new price is an outlier when it differs from his
// last price for the same product + packaging by this factor or more (either
// way): saved, marked x_extraction_status=pending, owner alerted. Never refused.
export const PRICE_OUTLIER_RATIO = 1.5;

// v4: team template purposes (registered in x_whatsapp_template once Meta-approved;
// until then, team.ts falls back to plain sendText — team members are internal users
// so the 24h window rule doesn't bite the way it does for customers)
export const TMPL_AHMAD_PURCHASE_LIST = "ahmad_purchase_list";
export const TMPL_DRIVER_ROUTE        = "driver_route";
export const TMPL_COLLECTION_LIST     = "collection_list";

// v3: defaults if pricing config missing/empty
export const DEFAULT_OPS_MARGIN_PCT = 15;
export const DEFAULT_PROFIT_MARGIN_PCT = 20;

// v2: urgency keywords → still create order for next-day, but flag it
export const URGENCY_KEYWORDS = [
  "الحين",
  "ضروري",
  "مستعجل",
  "بسرعة",
  "بأسرع وقت",
  "بعد ساعة",
  "بعد ساعتين",
  "اليوم لازم",
];

// v2: quotation trigger phrases (customer says "finalize the order")
export const QUOTATION_TRIGGERS = [
  "خلاص",
  "جهزه",
  "جهزها",
  "جهز الطلب",
  "الكوتيشن",
  "الفاتورة",
  "احسب",
  "اعطني السعر",
  "كم الإجمالي",
];

// ---- Classifier — Haiku, cheap, every message ----
export const SYSTEM_PROMPT_CLASSIFY = `You classify UTAK WhatsApp messages into exactly one intent.
UTAK is a B2B wholesale fresh produce distributor in Riyadh (Arabic-speaking).
Return ONLY a JSON object: {"intent": "<one_of_the_intents>", "confidence": <0-1>}
No prose, no markdown, no backticks.

Intents (pick exactly one):
- greeting: pure greeting only (سلام/hi/hello/مرحبا/هلا) with no product mention
- product_inquiry: asking whether we have a product, availability, general price question — NOT specifying quantities
- place_order: customer specifies items + quantities to buy (first time in this conversation)
- add_to_order: customer adds more items after already having ordered ("أضف كمان...", "ومعاها...")
- request_quotation: customer wants the total / final quote / says they're done ordering ("خلاص", "جهزه", "احسب", "كم الإجمالي")
- supplier_price_reply: sender is a supplier sharing today's prices (numbers + product names, often terse)
- complaint: expressing dissatisfaction, damage, delay, wrong item, quality issue
- other: anything else — small talk, questions we can't categorize

Notes:
- If sender_type is "supplier", strongly prefer supplier_price_reply for messages with numbers.
- If message contains BOTH quantities AND a quotation phrase, prefer place_order (the order handler creates the quotation inline when it sees "خلاص"/"جهزه" in the same message).
- Short "ok"/"تمام"/"طيب" after a bot message = other (buttons handle confirmation, not free text).`;

// ---- New-number screening — Haiku, only for a partner still «غير مراجَع» (2026-09-25, STATUS § 30) ----
export const SYSTEM_PROMPT_SCREEN = `You screen a WhatsApp contact of UTAK, a B2B wholesale fresh produce distributor in Riyadh (Arabic-speaking). The number is not reviewed yet. Read the contact's recent messages (oldest first) and decide what they want from UTAK.
Return ONLY a JSON object: {"intent": "<one_of_the_intents>", "reason": "<one short Arabic line, at most 12 words>"}
No prose, no markdown, no backticks.

Intents (pick exactly one):
- purchase: wants to buy from us, or asks about our products, prices, delivery or an order (even a short "أبغى أطلب").
- wrong_number: says it is a wrong number, or the message is clearly meant for another person or business.
- vendor_pitch: offers US a product or a service (suppliers, installers, marketing, subscriptions, job seekers) — selling to us, not buying.
- personal: personal, family or friend chat; invitations, meeting links, dates; a courier or appointment that concerns us personally.
- spam: chain messages, prizes or free-data offers, scam or random links, mass ads.
- unclear: too short or ambiguous to tell (a greeting alone, a single letter, dots, an emoji).

Notes:
- A greeting alone ("السلام عليكم") is unclear.
- Judge the whole conversation; the latest message weighs most.
- The reason states in Arabic what the messages show (e.g. "يعرض علينا تركيب شبكة إنترنت").`;

// ---- Reply composer — Sonnet, only for free-form Arabic replies ----
export const SYSTEM_PROMPT_REPLY = `You are UTAK's WhatsApp assistant. Reply in clear professional Arabic. Max 3 lines. Never quote firm prices or delivery times. This is a technical test phase — keep replies functional and warm.`;

// ---- Order extraction — Sonnet, only on place_order / add_to_order ----
export const SYSTEM_PROMPT_EXTRACT_ORDER = `You extract structured order items from an Arabic WhatsApp message using a provided product catalog.

You will receive:
1) A CATALOG as JSON: array of products with id, name, and available packagings (id + name like فلين/جرم/كرتون/كيس).
2) A MESSAGE from a Saudi B2B customer.

Return ONLY a JSON array (no prose, no markdown, no backticks):
[
  {"product_id": <int>, "product_name_raw": "<what customer said>", "packaging_id": <int>, "packaging_name_raw": "<what customer said or empty>", "quantity": <float>, "notes": "<optional>"}
]

Matching rules:
- Fuzzy-match Arabic product names (طماطم = بندورة, خيار = قثاء, بطاطس = بطاطا, بصل = بصل, ليمون = ليم).
- If customer names a packaging (فلين/جرم/كرتون/كيس/طبق), match by name within that product's packagings.
- If customer doesn't specify a packaging: pick the product's default packaging (is_default=true), else the first one.
- If a product isn't in the catalog: set product_id=0 and put the raw name in product_name_raw so we can flag it.
- Quantity: extract the number. If the customer says "كرتونين" quantity=2, "ثلاث كراتين" quantity=3, "نص كرتون" quantity=0.5.
- If the customer says just "طماطم" with no quantity, default quantity=1.
- Ignore greetings, questions, and non-order text — only extract items they're actually requesting.
- Return an empty array [] if no items can be extracted.`;

// ---- Supplier price extraction — Sonnet, only on supplier reply ----
export const SYSTEM_PROMPT_EXTRACT_SUPPLIER_PRICES = `You extract wholesale price quotes from a supplier's Arabic WhatsApp reply.

You will receive:
1) The supplier's name and the CATALOG of products they supply — each with available packagings (فلين/جرم/كرتون/كيس/طبق/كيلو).
2) A MESSAGE (may be terse, may include weights, may list several items).

Return ONLY a JSON object (no prose, no markdown, no backticks):
{
  "prices": [
    {"product_id": <int>, "packaging_id": <int>, "cost_price": <number>, "actual_weight_kg": <number|null>, "notes": "<string|null>"}
  ],
  "unrecognized": ["<raw line the message had but you couldn't map>"]
}

Rules:
- Match Arabic product names fuzzily (طماطم=بندورة, خيار=قثاء, بطاطس=بطاطا).
- If packaging is not explicit, pick the product's default packaging (default=true).
- cost_price is a plain number in SAR (drop "ريال", "ر.س", "sar", commas).
- actual_weight_kg only if supplier mentioned the actual crate weight (e.g. "الكرتون طلع 9 كيلو") — else null.
- NEVER invent a product not in the catalog. Put unmappable lines in "unrecognized".
- If the message is a greeting / question / non-price text, return {"prices": [], "unrecognized": []}.`;
