// Shared types used across modules.

export type Intent =
  | "greeting"
  | "product_inquiry"
  | "place_order"
  | "add_to_order"
  | "request_quotation"
  | "confirm_order"
  | "edit_order"
  | "cancel_order"
  | "supplier_price_reply"
  | "complaint"
  | "other";

export type SenderType = "customer" | "supplier" | "unknown";

export type OrderState =
  | "draft"
  | "waiting_confirmation"
  | "confirmed"
  | "in_purchase"
  | "in_delivery"
  | "delivered"
  | "closed"
  | "cancelled";

// A single inbound message, flattened from Meta's payload shape.
export interface NormalizedMessage {
  messageId: string;    // Meta message id (wamid.xxx) — dedup key
  from: string;         // E.164 with leading '+'
  fromRaw: string;      // As Meta sent it, no '+' (needed for outbound Graph calls)
  profileName: string;  // Meta contact profile name, may be empty
  text: string;         // Message body (text or button title)
  timestamp: string;    // Meta's unix seconds as string
  type: string;         // 'text' | 'interactive' | ...
  buttonId?: string;    // For interactive button replies, e.g. "confirm_order_42"
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

// v2 catalog structures — cached in KV
export interface CatalogPackaging {
  id: number;
  name: string;             // فلين / جرم / كرتون / كيس
  approx_weight_kg?: number;
  is_default: boolean;
}

export interface CatalogProduct {
  id: number;              // product.template id
  name: string;            // "طماطم"
  default_code?: string;   // "UTAK-VEG-001"
  packagings: CatalogPackaging[];
}

// Sonnet output when parsing an order message
export interface ExtractedOrderItem {
  product_id: number;         // resolved product.template id (or 0 if unknown)
  product_name_raw: string;   // exact term customer used
  packaging_id: number;       // resolved x_product_packaging id (or 0 if ambiguous)
  packaging_name_raw?: string;// term customer used ("كرتون", "جرم", ...) if any
  quantity: number;
  notes?: string;
}
