// Meta WhatsApp Cloud API glue.
// Handles: GET verify challenge, POST HMAC verification, payload parsing, and the
// session-body wrappers over the single send gateway (src/wa-gateway.ts).

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
        let location: NormalizedMessage["location"] | undefined;
        let media: NormalizedMessage["media"] | undefined;

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
        } else if (m.type === "location") {
          // v4.2 — customer shared a WhatsApp location
          const loc = m?.location;
          const lat = typeof loc?.latitude === "number" ? loc.latitude : Number(loc?.latitude);
          const lng = typeof loc?.longitude === "number" ? loc.longitude : Number(loc?.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            location = {
              latitude: lat,
              longitude: lng,
              name: typeof loc?.name === "string" ? loc.name : undefined,
              address: typeof loc?.address === "string" ? loc.address : undefined,
            };
            // Preserve a human-readable version in `text` too, so anything that
            // only inspects text (e.g. logs) still sees something meaningful.
            text = [loc?.name, loc?.address].filter(Boolean).join(" — ") || `📍 ${lat},${lng}`;
          }
        } else if (
          m.type === "image" || m.type === "audio" || m.type === "video" ||
          m.type === "document" || m.type === "sticker"
        ) {
          // 2026-09-20 (inbox) — extract the media descriptor so the Discuss
          // mirror can pull the bytes from Graph. The customer bot itself
          // does not act on media messages, only the mirror does.
          const raw = m[m.type];
          if (raw && typeof raw.id === "string") {
            media = {
              id: raw.id,
              mime_type: typeof raw.mime_type === "string" ? raw.mime_type : undefined,
              filename: typeof raw.filename === "string" ? raw.filename : undefined,
              voice: raw.voice === true,
              caption: typeof raw.caption === "string" ? raw.caption : undefined,
            };
            text = media.caption ?? "";
          }
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
          location,
          media,
        });
      }
    }
  }
  return out;
}

// ============================================================
// Sending — 2026-09-25 (STATUS § 33): every send goes through the single
// gateway in src/wa-gateway.ts (allowlist, the 24h window, templates by
// category, the per-number queue, Meta's refusals). These wrappers only build
// the session body. `purpose` is required: it decides the message's expiry,
// importance and which templates it may use (src/wa-purposes.ts).
// ============================================================

import { sendViaGateway, type GwOption, type GwSession } from "./wa-gateway";

export interface SendOpts {
  /** Key in src/wa-purposes.ts. */
  purpose: string;
  /**
   * 2026-09-20 — request-scoped ExecutionContext. When present, the Discuss
   * inbox echo is dispatched via ctx.waitUntil so the send returns as soon as
   * Meta answers. Callers without one (crons, scripts) await the echo.
   */
  ctx?: ExecutionContext;
  /** Tried in order when this message cannot go now (the purpose's UTILITY template). */
  fallback?: GwOption[];
  important?: boolean;
  expiresAt?: number;
  /** The purpose the owner guard sees, when it differs (owner_window). */
  guardPurpose?: string;
}

export function textContent(body: string): GwSession {
  return { kind: "session", body: { type: "text", text: { body } } };
}

export function buttonsContent(bodyText: string, buttons: Array<{ id: string; title: string }>): GwSession {
  // Meta caps: max 3 buttons, id ≤ 256 chars, title ≤ 20 chars.
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: { type: "button", body: { text: bodyText.slice(0, 1024) }, action: { buttons: safeButtons } },
    },
  };
}

export function locationContent(latitude: number, longitude: number, name?: string, address?: string): GwSession {
  const loc: Record<string, unknown> = { latitude, longitude };
  if (name) loc.name = name.slice(0, 1000);
  if (address) loc.address = address.slice(0, 1000);
  return { kind: "session", body: { type: "location", location: loc } };
}

function send(env: Env, to: string, content: GwSession, opts: SendOpts): Promise<Response> {
  return sendViaGateway(env, {
    purpose: opts.purpose,
    to,
    content,
    fallback: opts.fallback,
    important: opts.important,
    expiresAt: opts.expiresAt,
    guardPurpose: opts.guardPurpose,
    ctx: opts.ctx,
  });
}

// ---- Outbound text ----
export async function sendText(env: Env, to: string, body: string, opts: SendOpts): Promise<Response> {
  return send(env, to, textContent(body), opts);
}

// ---- v4.2: a WhatsApp location message (opens in Waze/Google Maps) ----
export async function sendLocation(
  env: Env,
  to: string,
  latitude: number,
  longitude: number,
  name: string | undefined,
  address: string | undefined,
  opts: SendOpts,
): Promise<Response> {
  return send(env, to, locationContent(latitude, longitude, name, address), opts);
}

// ---- Interactive button message (up to 3 buttons) ----
export async function sendButtons(
  env: Env,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  opts: SendOpts,
): Promise<Response> {
  return send(env, to, buttonsContent(bodyText, buttons), opts);
}
