// UTAK Cloudflare Worker — v2 entry point.
// Endpoints:
//   GET  /             → sanity ping
//   GET  /health       → Odoo smoke test + timestamp
//   GET  /webhook      → Meta verification challenge
//   POST /webhook      → Meta events (HMAC-verified, deduped, routed)

import type { Env } from "./config";
import { handleVerify, verifySignature, parseWebhook, sendText, sendButtons } from "./meta";
import { seenBefore, markSeen } from "./dedup";
import { findOrCreateCustomer, findSupplierByWhatsApp, findTeamMemberByWhatsApp, markStopIssue, smokeTest } from "./odoo";
import { classifyIntent } from "./claude";
import { dispatch, type RouterReply } from "./router";
import type { SenderType, OdooPartner } from "./types";
import {
  askAllSuppliersForPrices,
  handleSupplierReply,
  openOrderingWindow,
  updateSupplierReliabilityScores,
} from "./suppliers";
import {
  aggregateAndDispatchToWarehouse,
  closeUnconfirmedOrders,
} from "./team";

export default {
  // v3 — cron dispatcher
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[scheduled] cron=${cron} at ${new Date().toISOString()}`);
    try {
      switch (cron) {
        case "0 23 * * *":
          await askAllSuppliersForPrices(env);
          break;
        case "0 2 * * *":
          await updateSupplierReliabilityScores(env);
          break;
        case "0 3 * * *":
          await openOrderingWindow(env);
          break;
        // v4:
        case "0 18 * * *":              // 21:00 Riyadh
          await closeUnconfirmedOrders(env);
          break;
        case "15 18 * * *":             // 21:15 Riyadh
          await aggregateAndDispatchToWarehouse(env);
          break;
        case "0 15 * * *": {
          const { sendDailyCollectionSummary } = await import("./invoice");
          await sendDailyCollectionSummary(env);
          break;
        }
        default:
          console.warn(`[scheduled] unhandled cron: ${cron}`);
      }
    } catch (e) {
      console.error(`[scheduled] cron ${cron} failed`, (e as Error)?.stack ?? e);
    }
  },

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

    // v3: suppliers bypass classifier + dispatch — their messages are always
    // price replies. We need supplied_product_ids + WhatsApp number here, so
    // fetch them lazily from Odoo.
    if (supplier) {
      const enriched = await enrichSupplier(env, supplier);
      const replyText = await handleSupplierReply(env, enriched, msg.text, msg.messageId);
      if (replyText) await sendText(env, msg.from, replyText);
      await markSeen(env, msg.messageId);
      continue;
    }

    // v4: team member detection. Team members interact via buttons + free-text
    // notes (for issues). They must NOT create customer records or hit Claude.
    const teamMember = await findTeamMemberByWhatsApp(env, msg.from);
    if (teamMember) {
      if (msg.type === "interactive" && msg.buttonId) {
        // Route buttons: warehouse purchase_done, driver delivered/issue
        const reply: RouterReply = await dispatch(env, {
          msg,
          intent: "other",
          senderType: "customer",   // reuse RouterInput shape; not used for buttons
          partner: { id: teamMember.id, name: teamMember.name, x_whatsapp_number: teamMember.x_whatsapp_number },
        });
        await sendReply(env, msg.from, reply);
      } else if (msg.type === "text") {
        // Free text from a team member — check for pending issue note capture
        const pendingKey = `pending_issue:${teamMember.id}`;
        const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);
        if (pendingOrderId) {
          const orderId = Number(pendingOrderId);
          await markStopIssue(env, orderId, msg.text);
          await env.MSG_DEDUP.delete(pendingKey);
          if (env.OWNER_WHATSAPP) {
            await sendText(
              env,
              env.OWNER_WHATSAPP,
              `⚠️ مشكلة توصيل\nسواق: ${teamMember.name}\nطلب: #${orderId}\nالمشكلة: ${msg.text}`,
            );
          }
          await sendText(env, msg.from, "تم تسجيل المشكلة، براء بيراجعها 🙏");
        } else {
          // Unrecognised free text from team member — soft ack
          await sendText(env, msg.from, `مرحبا ${teamMember.name} 👋 استخدم الأزرار عشان نأكد الحالة.`);
        }
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    const partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
    const senderType: SenderType = "customer";

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

// v3 — hydrate the supplier partner with fields needed by handleSupplierReply
async function enrichSupplier(env: Env, supplier: OdooPartner): Promise<OdooPartner & {
  x_supplied_product_ids: number[];
  x_whatsapp_number: string;
}> {
  const { readPartnerSupplierFields } = await import("./odoo");
  const extra = await readPartnerSupplierFields(env, supplier.id);
  return {
    ...supplier,
    x_supplied_product_ids: extra?.x_supplied_product_ids ?? [],
    x_whatsapp_number: extra?.x_whatsapp_number ?? supplier.x_whatsapp_number ?? "",
  };
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
