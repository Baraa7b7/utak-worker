// Meta WhatsApp Cloud API glue.
// Handles: GET verify challenge, POST HMAC verification, payload parsing, outbound text + interactive buttons.

import type { Env } from "./config";
import { isRecipientAllowed, parseAllowlist, runtimeMode } from "./config";
import type { NormalizedMessage } from "./types";
import {
  extractRealWamid,
  generateFakeWamid,
  recordOutbound,
  synthesizeMetaResponse,
} from "./sim";

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
        });
      }
    }
  }
  return out;
}

// ============================================================
// The single interception point.
//
// Every outbound Meta call (sendText / sendTemplate / sendLocation /
// sendButtons here, plus sendTemplateByPurpose in templates.ts) funnels
// through fetchMeta. Two independent guards run BEFORE any dispatch:
//
//   1. Runtime-mode sanity: refuse when SIMULATION_MODE and PILOT_MODE
//      are both set, or when PILOT_MODE lacks SIM_ALLOWLIST.
//   2. Phone-range allowlist (SIM_ALLOWLIST): if set, the recipient's
//      number must start with one of the listed prefixes. Applies in
//      every mode — sim, pilot, prod alike. Unset = production allow-all.
//
// Two independent criteria drive dispatch after the guards:
//
//   • "Test mode?" (sim OR pilot) → recordOutbound writes a sim_outbound row
//     with the appropriate wamid. Both modes generate rows that /sim/purge
//     is later able to find and clean up (paired with the x_is_simulation
//     stamp that odoo.ts::call adds on the Odoo side).
//   • "Real send?" (pilot OR prod) → POST to graph.facebook.com. In pilot
//     the response's real wamid is the one we store in D1; in sim we skip
//     the network and use a synthetic wamid.
// ============================================================
function metaErrorResponse(message: string, type: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: { message, type } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function metaRealSend(env: Env, body: Record<string, unknown>): Promise<Response> {
  const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function fetchMeta(
  env: Env,
  body: Record<string, unknown>,
): Promise<Response> {
  const rm = runtimeMode(env);
  if (rm.misconfig) {
    console.error(`[fetchMeta] refusing send — ${rm.misconfig}`);
    return metaErrorResponse(rm.misconfig, "RuntimeMisconfig", 500);
  }

  const to = String((body as { to?: unknown }).to ?? "");
  if (!isRecipientAllowed(env, to)) {
    const list = parseAllowlist(env);
    const msg = `to=${to} not permitted by SIM_ALLOWLIST (${list.length} entries)`;
    console.warn(`[fetchMeta] BLOCKED by allowlist: ${msg}`);
    return metaErrorResponse(msg, "AllowlistBlocked", 403);
  }

  // ---- sim: capture only, no real send ----
  if (rm.mode === "sim") {
    const wamid = generateFakeWamid();
    try {
      await recordOutbound(env, { body, wamid, delivered: false });
    } catch (e) {
      // A missing D1 or hard insert failure is fatal in sim: silently
      // dropping messages would give agents false-passing runs.
      const msg = (e as Error)?.message ?? String(e);
      console.error("[fetchMeta] sim recordOutbound failed", msg);
      return metaErrorResponse(msg, "SimStorageError", 500);
    }
    return synthesizeMetaResponse(to, wamid);
  }

  // ---- pilot: real send + capture, tied by real wamid ----
  if (rm.mode === "pilot") {
    const resp = await metaRealSend(env, body);
    const wamid = await extractRealWamid(resp);
    try {
      await recordOutbound(env, { body, wamid, delivered: resp.ok });
    } catch (e) {
      // Best-effort in pilot: the message was already delivered to Meta,
      // so a D1 write failure must NOT flip the caller's success path.
      // Loud log so operators notice /sim/purge coverage will be short.
      console.error(
        "[fetchMeta] pilot recordOutbound failed — real send succeeded, D1 row missing",
        (e as Error)?.message ?? String(e),
      );
    }
    return resp;
  }

  // ---- prod: unchanged ----
  return metaRealSend(env, body);
}

// ---- Send outbound text via Meta Graph API ----
export async function sendText(env: Env, to: string, body: string): Promise<Response> {
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "text",
    text: { body },
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
  const components =
    bodyParams.length > 0
      ? [{
          type: "body",
          parameters: bodyParams.map((t) => ({ type: "text", text: t })),
        }]
      : [];
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "ar" },
      components,
    },
  });
}

// ---- v4.2: Send a WhatsApp location message (opens in Waze/Google Maps) ----
export async function sendLocation(
  env: Env,
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
): Promise<Response> {
  const loc: Record<string, unknown> = { latitude, longitude };
  if (name) loc.name = name.slice(0, 1000);
  if (address) loc.address = address.slice(0, 1000);
  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "location",
    location: loc,
  });
}

// ---- Send interactive button message (up to 3 buttons) ----
export async function sendButtons(
  env: Env,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<Response> {
  // Meta caps: max 3 buttons, id ≤ 256 chars, title ≤ 20 chars.
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));

  return fetchMeta(env, {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText.slice(0, 1024) },
      action: { buttons: safeButtons },
    },
  });
}
