// Shared types used across modules.

export type Intent =
  | "greeting"
  | "product_inquiry"
  | "place_order"
  | "supplier_price_reply"
  | "complaint"
  | "other";

export type SenderType = "customer" | "supplier" | "unknown";

// A single inbound message, flattened from Meta's payload shape.
export interface NormalizedMessage {
  messageId: string;    // Meta message id (wamid.xxx) — dedup key
  from: string;         // E.164 with leading '+'
  fromRaw: string;      // As Meta sent it, no '+' (needed for outbound Graph calls)
  profileName: string;  // Meta contact profile name, may be empty
  text: string;         // Message body (v1 handles text only)
  timestamp: string;    // Meta's unix seconds as string
  type: string;         // 'text' | 'image' | ... (v1 only processes 'text')
}

export interface OdooPartner {
  id: number;
  name: string;
  supplier_rank?: number;
  customer_rank?: number;
  x_whatsapp_number?: string;
}

export interface ClassifyResult {
  intent: Intent;
  confidence: number;
}
