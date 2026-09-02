// UTAK Cloudflare Worker — v2 entry point.
// Endpoints:
//   GET  /             → sanity ping
//   GET  /health       → Odoo smoke test + timestamp
//   GET  /webhook      → Meta verification challenge
//   POST /webhook      → Meta events (HMAC-verified, deduped, routed)

import type { Env } from "./config";
import { handleVerify, verifySignature, parseWebhook, sendText, sendButtons } from "./meta";
import { seenBefore, markSeen } from "./dedup";
import {
  ensureLocationFields,
  findOrCreateCustomer,
  findSupplierByWhatsApp,
  findTeamMemberByWhatsApp,
  markStopIssue,
  savePartnerLocation,
  savePartnerNeighborhood,
  setOrderLocation,
  setOrderNeighborhood,
  smokeTest,
} from "./odoo";
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
        case "0 14 * * *": {
          // v6.1: 17:00 Riyadh — standing-order reminders
          const { sendStandingOrderReminders } = await import("./standing");
          await sendStandingOrderReminders(env);
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

    // v4.2 — one-shot Odoo schema migration: creates x_delivery_latitude /
    // x_delivery_longitude / x_delivery_map_url on res.partner and x_daily_order.
    // Idempotent (safe to call multiple times). Token-guarded by ADMIN_TOKEN
    // secret — set with: npx wrangler secret put ADMIN_TOKEN
    if (request.method === "POST" && url.pathname === "/admin/migrate") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = (env as unknown as { ADMIN_TOKEN?: string }).ADMIN_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const result = await ensureLocationFields(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
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
    // v4.2: accept text, interactive (button/list replies), button (template
    // quick-reply), and location shares.
    if (
      msg.type !== "text" &&
      msg.type !== "interactive" &&
      msg.type !== "button" &&
      msg.type !== "location"
    ) continue;
    if (!msg.text && !msg.buttonId && !msg.location) continue;

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

    // v4.2: pending_neighborhood — actually now "pending_location" semantically.
    // Preferred answer = WhatsApp location share (precise lat/lng). Text answer
    // still accepted as fallback (coarse neighborhood only, no coords).
    const pendingKey = `pending_neighborhood:${partner.id}`;
    const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);

    if (pendingOrderId) {
      const orderId = Number(pendingOrderId);

      // Case A: precise location share — save coords + resume with quotation
      if (msg.type === "location" && msg.location) {
        const { latitude, longitude, name, address } = msg.location;
        const neigh = (name ?? address ?? "").trim().slice(0, 60);
        await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
        await setOrderLocation(env, orderId, latitude, longitude, neigh);
        await env.MSG_DEDUP.delete(pendingKey);
        const reply: RouterReply = await dispatch(env, {
          msg: { ...msg, text: "خلاص" },
          intent: "request_quotation",
          senderType,
          partner,
        });
        await sendReply(env, msg.from, reply);
        await markSeen(env, msg.messageId);
        continue;
      }

      // Case B: text answer — save as neighborhood (fallback, no coords)
      if (msg.type === "text") {
        const neigh = msg.text.trim();
        if (neigh.length >= 2 && neigh.length <= 60) {
          await savePartnerNeighborhood(env, partner.id, neigh);
          await setOrderNeighborhood(env, orderId, neigh);
          await env.MSG_DEDUP.delete(pendingKey);
          // Gentle prompt: text-only means we won't have precise coords for
          // driver routing — ask for a proper location share too, but don't
          // block the quotation flow.
          await sendText(
            env,
            msg.from,
            `حفظنا الحي: ${neigh} ✅\nلو تقدر ترسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي) بيوصلك السائق أدق مرة جاية 🌿`,
          );
          const reply: RouterReply = await dispatch(env, {
            msg: { ...msg, text: "خلاص" },
            intent: "request_quotation",
            senderType,
            partner,
          });
          await sendReply(env, msg.from, reply);
          await markSeen(env, msg.messageId);
          continue;
        }
        // Too short/long — nudge without dropping the KV marker
        await sendText(
          env,
          msg.from,
          "أرسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي)، أو اكتب اسم الحي فقط 🙏",
        );
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // v4.2: location share outside a pending flow → update partner's saved
    // default so future orders route to the new spot. Short ack, no further processing.
    if (msg.type === "location" && msg.location) {
      const { latitude, longitude, name, address } = msg.location;
      const neigh = (name ?? address ?? "").trim().slice(0, 60);
      await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
      await sendText(env, msg.from, "حفظنا موقعك للتوصيل ✅ طلباتك الجاية بيوصلك السائق مباشرة.");
      await markSeen(env, msg.messageId);
      continue;
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
