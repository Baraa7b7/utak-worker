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

// v3 — supplier flow

export interface SupplierPriceItem {
  product_id: number;
  packaging_id: number;
  cost_price: number;
  actual_weight_kg: number | null;
  notes: string | null;
}

export interface SupplierPricesExtract {
  prices: SupplierPriceItem[];
  unrecognized: string[];
}

export interface PricingConfig {
  id: number;
  x_operations_margin_percent: number;
  x_profit_margin_percent: number;
}

export interface SupplierForAsk {
  id: number;
  name: string;
  x_whatsapp_number: string;
  x_supplied_product_ids: number[];
}

export interface SupplierLogRow {
  id: number;
  x_supplier_id: [number, string] | false;
  x_sent_at: string;
  x_replied_at: string | false;
  x_prices_received_count?: number;
  x_status: "sent" | "replied" | "no_reply" | "parsed";
}

export interface WhatsAppTemplateRow {
  id: number;
  x_meta_template_id: string;   // real Meta name once approved; "PENDING_..." until then
  x_language: string;           // e.g. "ar"
  x_purpose: string;
}

// ============================================================
// v4 — team roles & orchestration
// ============================================================

export type TeamRole = "customer" | "driver" | "collector" | "warehouse";

export interface TeamMember {
  id: number;
  name: string;
  x_whatsapp_number: string;
  x_role: TeamRole;
  x_neighborhoods?: number[];   // ids of x_neighborhood
}

// A row in the aggregated purchase list Ahmad receives at 21:15
export interface PurchaseListItem {
  product_id: number;
  product_name: string;
  packaging_id: number;
  packaging_name: string;
  total_quantity: number;
  order_ids: number[];          // orders contributing to this line
}

// A confirmed order line as pulled for aggregation
export interface ConfirmedLine {
  order_id: number;
  customer_id: number;
  customer_name: string;
  neighborhood: string;
  product_id: number;
  product_name: string;
  packaging_id: number;
  packaging_name: string;
  quantity: number;
}

// A stop assigned to a driver's route
export interface RouteStop {
  order_id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  neighborhood: string;
  sequence: number;
  line_summary: string;         // "طماطم فلين × 5، خيار جرم × 3"
}
