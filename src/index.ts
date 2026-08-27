// UTAK Cloudflare Worker — v1 entry point.
// Endpoints:
//   GET  /             → sanity ping
//   GET  /health       → Odoo smoke test + timestamp
//   GET  /webhook      → Meta verification challenge
//   POST /webhook      → Meta events (HMAC-verified, deduped, routed)

import type { Env } from "./config";
import { handleVerify, verifySignature, parseWebhook, sendText } from "./meta";
import { seenBefore, markSeen } from "./dedup";
import { findOrCreateCustomer, findSupplierByWhatsApp, smokeTest } from "./odoo";
import { classifyIntent } from "./claude";
import { dispatch } from "./router";
import type { SenderType } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("UTAK Worker v1", { status: 200 });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const odoo = await smokeTest(env);
      return json(
        {
          status: odoo.ok ? "ok" : "degraded",
          odoo: odoo.ok ? `connected (${odoo.mode})` : "failed",
          error: odoo.ok ? undefined : odoo.error,
          timestamp: new Date().toISOString(),
        },
        odoo.ok ? 200 : 503,
      );
    }

    if (request.method === "GET" && url.pathname === "/webhook") {
      return handleVerify(url, env);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const raw = await request.text();
      const sig = request.headers.get("x-hub-signature-256");
      const ok = await verifySignature(raw, sig, env);
      if (!ok) return new Response("bad signature", { status: 401 });

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return new Response("bad json", { status: 400 });
      }

      // Handle inline. Meta gives us ~20s before it retries; v1 flow completes in ~2-3s.
      // If we exceed that regularly, promote heavy work to ctx.waitUntil() + Queue.
      try {
        await handleWebhook(env, payload);
      } catch (e) {
        // Log but always ack — otherwise Meta hammers us with retries.
        console.error("webhook handler error", (e as Error)?.stack ?? e);
      }
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};

async function handleWebhook(env: Env, payload: unknown): Promise<void> {
  const messages = parseWebhook(payload);

  for (const msg of messages) {
    // v1: text only
    if (msg.type !== "text" || !msg.text) continue;

    // Dedup: Meta will re-deliver on any non-2xx or timeout
    if (await seenBefore(env, msg.messageId)) continue;

    // Sender-type resolution: supplier lookup first (rarer, exact match on x_whatsapp_number)
    const supplier = await findSupplierByWhatsApp(env, msg.from);

    let senderType: SenderType;
    let partner;

    if (supplier) {
      senderType = "supplier";
      partner = supplier;
    } else {
      // Not a supplier → treat as customer (create if new)
      partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
      senderType = "customer";
    }

    const { intent } = await classifyIntent(env, msg.text, senderType);
    const reply = await dispatch(env, { msg, intent, senderType, partner });

    if (reply) {
      await sendText(env, msg.from, reply);
    }

    await markSeen(env, msg.messageId);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
