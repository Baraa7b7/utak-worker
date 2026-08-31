// Meta WhatsApp Cloud API glue.
// Handles: GET verify challenge, POST HMAC verification, payload parsing, outbound text + interactive buttons.

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
// v2: also handles `interactive` messages (button/list replies).
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

      // deno-lint-ignore no-explicit-any
      for (const m of messages as any[]) {
        if (!m?.id || !m?.from) continue;

        let text = "";
        let buttonId: string | undefined;

        if (m.type === "text") {
          text = m?.text?.body ?? "";
        } else if (m.type === "interactive") {
          const btn = m?.interactive?.button_reply;
          const list = m?.interactive?.list_reply;
          if (btn) {
            buttonId = btn.id;
            text = btn.title ?? "";
          } else if (list) {
            buttonId = list.id;
            text = list.title ?? "";
          }
        } else if (m.type === "button") {
          // template quick-reply button
          buttonId = m?.button?.payload;
          text = m?.button?.text ?? "";
        }

        out.push({
          messageId: m.id,
          from: `+${m.from}`,
          fromRaw: m.from,
          profileName: nameByFrom.get(m.from) ?? "",
          text,
          timestamp: m.timestamp ?? "",
          type: m.type ?? "unknown",
          buttonId,
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

// ---- v3: Send an approved template message (one body parameter for now) ----
// Meta template call. `bodyParams` maps to {{1}}, {{2}}, ... in the template body.
export async function sendTemplate(
  env: Env,
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[] = [],
): Promise<Response> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  const components =
    bodyParams.length > 0
      ? [{
          type: "body",
          parameters: bodyParams.map((t) => ({ type: "text", text: t })),
        }]
      : [];
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: language || "ar" },
        components,
      },
    }),
  });
}

// ---- Send interactive button message (up to 3 buttons) ----
export async function sendButtons(
  env: Env,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<Response> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  // Meta caps: max 3 buttons, id ≤ 256 chars, title ≤ 20 chars.
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText.slice(0, 1024) },
        action: { buttons: safeButtons },
      },
    }),
  });
}
