// Anthropic API wrapper.
// Two entry points:
//   classifyIntent — Haiku, cheap, every message
//   composeReply   — Sonnet, only when a Claude-authored reply is required

import type { Env } from "./config";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  SYSTEM_PROMPT_CLASSIFY,
  SYSTEM_PROMPT_REPLY,
} from "./config";
import type { ClassifyResult, Intent, SenderType } from "./types";

const VALID_INTENTS: readonly Intent[] = [
  "greeting",
  "product_inquiry",
  "place_order",
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

  // Tolerate accidental code fences; parse the JSON body.
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { intent?: string; confidence?: number };
    const intent = (VALID_INTENTS as readonly string[]).includes(parsed?.intent ?? "")
      ? (parsed.intent as Intent)
      : "other";
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;
    return { intent, confidence };
  } catch {
    // Model returned non-JSON — degrade gracefully.
    return { intent: "other", confidence: 0 };
  }
}

export async function composeReply(env: Env, context: string): Promise<string> {
  return await callClaude(env, env.CLAUDE_MODEL_REPLY, SYSTEM_PROMPT_REPLY, context, 500);
}
