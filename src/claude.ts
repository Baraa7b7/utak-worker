// Anthropic API wrapper.
// Three entry points:
//   classifyIntent   — Haiku, cheap, every message
//   extractOrderItems — Sonnet, only on place_order / add_to_order
//   composeReply     — Sonnet, only when a Claude-authored reply is required

import type { Env } from "./config";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  SYSTEM_PROMPT_CLASSIFY,
  SYSTEM_PROMPT_EXTRACT_ORDER,
  SYSTEM_PROMPT_EXTRACT_SUPPLIER_PRICES,
  SYSTEM_PROMPT_REPLY,
} from "./config";
import type {
  CatalogProduct,
  ClassifyResult,
  ExtractedOrderItem,
  Intent,
  SenderType,
  SupplierPricesExtract,
  SupplierPriceItem,
} from "./types";

const VALID_INTENTS: readonly Intent[] = [
  "greeting",
  "product_inquiry",
  "place_order",
  "add_to_order",
  "request_quotation",
  "confirm_order",
  "edit_order",
  "cancel_order",
  "supplier_price_reply",
  "complaint",
  "other",
] as const;

async function callClaude(
  env: Env,
  model: string,
  system: string,
  userText: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    throw new Error(`claude ${res.status}: ${errText}`);
  }

  // deno-lint-ignore no-explicit-any
  const data: any = await res.json();
  const first = data?.content?.find((b: { type?: string }) => b?.type === "text");
  return first?.text ?? "";
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

export async function classifyIntent(
  env: Env,
  text: string,
  senderType: SenderType,
): Promise<ClassifyResult> {
  const raw = await callClaude(
    env,
    env.CLAUDE_MODEL_CLASSIFY,
    SYSTEM_PROMPT_CLASSIFY,
    `${text}\n\nSender type: ${senderType}`,
    200,
  );

  try {
    const parsed = JSON.parse(stripFences(raw)) as { intent?: string; confidence?: number };
    const intent = (VALID_INTENTS as readonly string[]).includes(parsed?.intent ?? "")
      ? (parsed.intent as Intent)
      : "other";
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;
    return { intent, confidence };
  } catch {
    return { intent: "other", confidence: 0 };
  }
}

// Build a compact catalog view for the extractor — only what Sonnet needs.
function serializeCatalogForPrompt(catalog: CatalogProduct[]): string {
  return JSON.stringify(
    catalog.map((p) => ({
      id: p.id,
      name: p.name,
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        name: pk.name,
        default: pk.is_default,
      })),
    })),
  );
}

export async function extractOrderItems(
  env: Env,
  messageText: string,
  catalog: CatalogProduct[],
  customerName: string,
): Promise<ExtractedOrderItem[]> {
  if (catalog.length === 0) return [];

  const userMsg = [
    `CATALOG:`,
    serializeCatalogForPrompt(catalog),
    ``,
    `CUSTOMER: ${customerName}`,
    `MESSAGE: ${messageText}`,
  ].join("\n");

  const raw = await callClaude(env, env.CLAUDE_MODEL_REPLY, SYSTEM_PROMPT_EXTRACT_ORDER, userMsg, 1500);

  try {
    const parsed = JSON.parse(stripFences(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((it: unknown) => {
        // deno-lint-ignore no-explicit-any
        const r = it as any;
        return {
          product_id: Number(r?.product_id ?? 0) | 0,
          product_name_raw: String(r?.product_name_raw ?? ""),
          packaging_id: Number(r?.packaging_id ?? 0) | 0,
          packaging_name_raw: r?.packaging_name_raw ? String(r.packaging_name_raw) : undefined,
          quantity: Number(r?.quantity ?? 0),
          notes: r?.notes ? String(r.notes) : undefined,
        } as ExtractedOrderItem;
      })
      .filter((it) => it.quantity > 0);
  } catch (e) {
    console.error("extractOrderItems parse failed", (e as Error)?.message, raw.slice(0, 200));
    return [];
  }
}

export async function composeReply(env: Env, context: string): Promise<string> {
  return await callClaude(env, env.CLAUDE_MODEL_REPLY, SYSTEM_PROMPT_REPLY, context, 500);
}

// v3 — Parse a supplier's price reply into structured line items.
export async function extractSupplierPrices(
  env: Env,
  args: {
    supplierName: string;
    replyText: string;
    products: Array<{ id: number; name: string }>;
    packagings: Array<{ id: number; name: string; product_id: number; is_default: boolean }>;
  },
): Promise<SupplierPricesExtract> {
  // Build compact catalog view: one product per block with its packagings
  const catalogLines = args.products.map((p) => {
    const pks = args.packagings
      .filter((k) => k.product_id === p.id)
      .map((k) => `  {packaging_id:${k.id}, name:"${k.name}"${k.is_default ? ", default:true" : ""}}`)
      .join("\n");
    return `product_id:${p.id}, name:"${p.name}"\n${pks || "  (no packagings)"}`;
  }).join("\n\n");

  const userMsg = [
    `SUPPLIER: ${args.supplierName}`,
    ``,
    `CATALOG:`,
    catalogLines,
    ``,
    `MESSAGE:`,
    args.replyText,
  ].join("\n");

  const raw = await callClaude(
    env,
    env.CLAUDE_MODEL_REPLY,
    SYSTEM_PROMPT_EXTRACT_SUPPLIER_PRICES,
    userMsg,
    1500,
  );

  try {
    const parsed = JSON.parse(stripFences(raw));
    const pricesRaw: unknown[] = Array.isArray(parsed?.prices) ? parsed.prices : [];
    const unrecogRaw: unknown[] = Array.isArray(parsed?.unrecognized) ? parsed.unrecognized : [];

    const prices: SupplierPriceItem[] = pricesRaw
      // deno-lint-ignore no-explicit-any
      .map((r: any) => ({
        product_id: Number(r?.product_id ?? 0) | 0,
        packaging_id: Number(r?.packaging_id ?? 0) | 0,
        cost_price: Number(r?.cost_price ?? 0),
        actual_weight_kg:
          typeof r?.actual_weight_kg === "number" && r.actual_weight_kg > 0
            ? Number(r.actual_weight_kg)
            : null,
        notes: r?.notes ? String(r.notes) : null,
      }))
      .filter(
        (p) => p.product_id > 0 && p.packaging_id > 0 && p.cost_price > 0,
      );

    return {
      prices,
      unrecognized: unrecogRaw.map((u) => String(u)),
    };
  } catch (e) {
    console.error("extractSupplierPrices parse failed", (e as Error)?.message, raw.slice(0, 200));
    return { prices: [], unrecognized: [] };
  }
}
