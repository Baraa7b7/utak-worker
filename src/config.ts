// Typed environment bindings and shared constants.
// Env keys map 1:1 to wrangler.toml [vars] + `wrangler secret put` names.

export interface Env {
  // ---- Secrets (wrangler secret put ...) ----
  META_APP_SECRET: string;      // HMAC-SHA256 verification of Meta webhooks
  META_ACCESS_TOKEN: string;    // Permanent WABA access token
  META_VERIFY_TOKEN: string;    // Arbitrary string; must match value entered in Meta webhook UI
  ODOO_API_KEY: string;         // Odoo user's API key (used as both X-Api-Key and session password fallback)
  ANTHROPIC_API_KEY: string;    // Claude API key

  // ---- Non-secret vars (wrangler.toml [vars]) ----
  META_PHONE_NUMBER_ID: string;
  META_WABA_ID: string;
  META_GRAPH_VERSION: string;
  ODOO_URL: string;             // e.g. https://utakfresh.odoo.com (no trailing slash)
  ODOO_DB: string;
  ODOO_LOGIN: string;           // Only used if X-Api-Key auth fails and we fall back to session
  CLAUDE_MODEL_CLASSIFY: string;
  CLAUDE_MODEL_REPLY: string;

  // ---- Bindings ----
  MSG_DEDUP: KVNamespace;       // Message-id dedup, 24h TTL
}

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEDUP_TTL_SECONDS = 24 * 60 * 60;

// Classifier prompt — Haiku, cheap, every message.
// Output MUST be a strict JSON object; parser tolerates code fences just in case.
export const SYSTEM_PROMPT_CLASSIFY = `You classify UTAK WhatsApp messages into exactly one intent.
UTAK is a B2B wholesale fresh produce distributor in Riyadh.
Return ONLY a JSON object: {"intent": "<one of the intents>", "confidence": <0-1 float>}
No prose, no markdown, no backticks.

Intents:
- greeting: hi/hello/salaam/سلام only, no other content
- product_inquiry: asking about a product, price, or availability
- place_order: requesting to buy specific items
- supplier_price_reply: sender is a supplier sharing today's prices
- complaint: expressing dissatisfaction or reporting a problem
- other: anything else`;

// Reply composer prompt — Sonnet, only when a Claude-authored reply is needed.
// v1 test phase: neutral professional Arabic. Voice/polish comes later.
export const SYSTEM_PROMPT_REPLY = `You are UTAK's WhatsApp assistant. Reply in clear, professional Arabic. Maximum 3 lines. Never quote firm prices or delivery times. This is a technical test phase - keep replies functional.`;
