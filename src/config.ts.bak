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
  ODOO_URL: string;
  ODOO_DB: string;
  ODOO_LOGIN: string;
  CLAUDE_MODEL_CLASSIFY: string;
  CLAUDE_MODEL_REPLY: string;

  // v3
  OWNER_WHATSAPP: string;   // Baraa's phone, E.164 with '+'

  // ---- Bindings ----
  MSG_DEDUP: KVNamespace;
}

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEDUP_TTL_SECONDS = 24 * 60 * 60;

// v2: catalog cache in KV, refreshed hourly
export const CATALOG_CACHE_KEY = "catalog:v1";
export const CATALOG_CACHE_TTL_SECONDS = 60 * 60;

// v2: ordering hours (Riyadh local time, 24h)
export const ORDERING_HOURS_OPEN = 6;    // 06:00 open
export const ORDERING_HOURS_CLOSE = 21;  // 21:00 close (cutoff)

// v3: KV flag key set by the 06:00 cron, TTL 20h so it clears before next morning
export const ORDERING_OPEN_KEY = (yyyyMmDd: string) => `ordering_open_${yyyyMmDd}`;
export const ORDERING_OPEN_TTL_SECONDS = 20 * 60 * 60;

// v3: supplier template purposes (must match x_whatsapp_template.x_purpose)
export const TMPL_SUPPLIER_ASK = "supplier_ask";
export const TMPL_SUPPLIER_CONFIRM = "supplier_confirm";

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
- If message contains BOTH quantities AND a quotation phrase, prefer request_quotation.
- Short "ok"/"تمام"/"طيب" after a bot message = other (buttons handle confirmation, not free text).`;

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
