// UTAK Cloudflare Worker — v2 entry point.
// Endpoints:
//   GET  /             → sanity ping
//   GET  /health       → Odoo smoke test + timestamp
//   GET  /webhook      → Meta verification challenge
//   POST /webhook      → Meta events (HMAC-verified, deduped, routed)

import type { Env } from "./config";
import { handleVerify, verifySignature, parseWebhook, sendText, sendButtons } from "./meta";
import { seenBefore, markSeen } from "./dedup";
import { findOrCreateCustomer, findSupplierByWhatsApp, smokeTest } from "./odoo";
import { classifyIntent } from "./claude";
import { dispatch, type RouterReply } from "./router";
import type { SenderType } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("UTAK Worker v2", { status: 200 });
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

      try {
        await handleWebhook(env, payload);
      } catch (e) {
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
    // v2: accept text AND interactive (button/list replies)
    if (msg.type !== "text" && msg.type !== "interactive" && msg.type !== "button") continue;
    if (!msg.text && !msg.buttonId) continue;

    if (await seenBefore(env, msg.messageId)) continue;

    const supplier = await findSupplierByWhatsApp(env, msg.from);

    let senderType: SenderType;
    let partner;

    if (supplier) {
      senderType = "supplier";
      partner = supplier;
    } else {
      partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
      senderType = "customer";
    }

    // Buttons skip classification (router handles by buttonId).
    let intent: import("./types").Intent = "other";
    if (msg.type === "text") {
      const c = await classifyIntent(env, msg.text, senderType);
      intent = c.intent;
    }

    const reply: RouterReply = await dispatch(env, { msg, intent, senderType, partner });

    await sendReply(env, msg.from, reply);
    await markSeen(env, msg.messageId);
  }
}

async function sendReply(env: Env, to: string, reply: RouterReply): Promise<void> {
  if (reply.buttons && reply.buttons.length > 0) {
    const body = reply.bodyBeforeButtons ?? reply.text ?? "";
    await sendButtons(env, to, body, reply.buttons);
    return;
  }
  if (reply.text && reply.text.trim()) {
    await sendText(env, to, reply.text);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
