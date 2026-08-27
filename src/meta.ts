// Meta WhatsApp Cloud API glue.
// Handles: GET verify challenge, POST HMAC verification, payload parsing, outbound text send.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";

// ---- GET /webhook — Meta verification handshake ----
export function handleVerify(url: URL, env: Env): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---- POST /webhook — HMAC-SHA256 signature verification ----
// Meta sends `X-Hub-Signature-256: sha256=<hex>` computed over the raw request body
// using META_APP_SECRET as the HMAC key.
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  env: Env,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice(7);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(hex, provided);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Parse Meta webhook payload ----
// One POST may contain multiple entries and multiple messages.
// Status-update events have no `messages` key and produce zero results — we skip them.
export function parseWebhook(payload: unknown): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  // deno-lint-ignore no-explicit-any
  const entries: any[] = (payload as any)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const messages: unknown[] = value?.messages ?? [];
      const contacts: unknown[] = value?.contacts ?? [];

      const nameByFrom = new Map<string, string>();
      for (const c of contacts as { wa_id?: string; profile?: { name?: string } }[]) {
        if (c?.wa_id) nameByFrom.set(c.wa_id, c?.profile?.name ?? "");
      }

      for (const m of messages as {
        id?: string;
        from?: string;
        type?: string;
        timestamp?: string;
        text?: { body?: string };
      }[]) {
        if (!m?.id || !m?.from) continue;
        out.push({
          messageId: m.id,
          from: `+${m.from}`,
          fromRaw: m.from,
          profileName: nameByFrom.get(m.from) ?? "",
          text: m?.text?.body ?? "",
          timestamp: m.timestamp ?? "",
          type: m.type ?? "unknown",
        });
      }
    }
  }
  return out;
}

// ---- Send outbound text via Meta Graph API ----
export async function sendText(env: Env, to: string, body: string): Promise<Response> {
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
      type: "text",
      text: { body },
    }),
  });
}
