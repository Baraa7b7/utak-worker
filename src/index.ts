// UTAK Cloudflare Worker — v2 entry point.
// Endpoints:
//   GET  /                            → sanity ping
//   GET  /health                      → Odoo smoke test
//   GET  /webhook                     → Meta verification
//   POST /webhook                     → Meta events
//   POST /admin/migrate               → Odoo schema migration (token-guarded)
//   GET  /test-invoice                → PDF preview (token-guarded)
//        ?token=X                     → test data (مطعم النخيل)
//        ?token=X&id=147              → real Odoo invoice #147
//        ?token=X&id=147&save=1       → generate + upload to R2, return JSON URL
//   GET  /invoice-pdf/{num}/{tok}.pdf → PUBLIC PDF from R2 (HMAC-signed)
//   POST /internal/quotation-issue    → Odoo webhook: build+send quotation PDF (token-guarded via ?token=)
//   GET  /admin/dry-run-quotation     → build a quotation PDF without sending WhatsApp (token-guarded)
//        ?token=X&id=32               → return PDF inline
//        ?token=X&id=32&save=1        → upload to R2, return JSON URL
//   GET  /quotation-pdf/{num}/{tok}.pdf → PUBLIC quotation PDF from R2 (HMAC-signed)

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
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[scheduled] cron=${cron} at ${new Date().toISOString()}`);
    try {
      switch (cron) {
        case "0 23 * * *": await askAllSuppliersForPrices(env); break;
        case "0 2 * * *": await updateSupplierReliabilityScores(env); break;
        case "0 3 * * *": await openOrderingWindow(env); break;
        case "0 18 * * *": await closeUnconfirmedOrders(env); break;
        case "15 18 * * *": await aggregateAndDispatchToWarehouse(env); break;
        case "0 15 * * *": {
          const { sendDailyCollectionSummary } = await import("./invoice");
          await sendDailyCollectionSummary(env);
          break;
        }
        case "0 14 * * *": {
          const { sendStandingOrderReminders } = await import("./standing");
          await sendStandingOrderReminders(env);
          break;
        }
        case "0 5 * * *": {
          const { runDailyOutreach } = await import("./outreach");
          await runDailyOutreach(env);
          break;
        }
        default: console.warn(`[scheduled] unhandled cron: ${cron}`);
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

    if (request.method === "POST" && url.pathname === "/admin/migrate") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = env.ADMIN_TOKEN ?? "";
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

    // 2026-09-05 — invoice PDF preview + optional R2 upload
    if (request.method === "GET" && url.pathname === "/test-invoice") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = env.ADMIN_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const {
          generateInvoicePDF,
          buildInvoicePDFDataFromOdoo,
          uploadInvoiceToR2,
          TEST_INVOICE_DATA,
        } = await import("./invoice");

        const idParam = url.searchParams.get("id");
        const shouldSave = url.searchParams.get("save") === "1";

        let data;
        let filenameHint: string;

        if (idParam) {
          const id = Number(idParam);
          if (!Number.isFinite(id) || id <= 0) {
            return json({ error: "invalid id" }, 400);
          }
          data = await buildInvoicePDFDataFromOdoo(env, id);
          if (!data) return json({ error: `invoice ${id} not found` }, 404);
          filenameHint = `utak-invoice-${data.invoiceNumber}.pdf`;
        } else {
          data = TEST_INVOICE_DATA;
          filenameHint = `utak-test-invoice.pdf`;
        }

        const pdfBytes = await generateInvoicePDF(data, env);

        // save=1 → upload to R2 + return JSON with public URL
        if (shouldSave) {
          const origin = `${url.protocol}//${url.host}`;
          const result = await uploadInvoiceToR2(env, pdfBytes, data.invoiceNumber, origin);
          return json({
            ok: true,
            invoiceNumber: data.invoiceNumber,
            size: result.size,
            publicUrl: result.publicUrl,
            r2Key: result.key,
          });
        }

        // Default → return PDF inline
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${filenameHint}"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // 2026-09-05 — PUBLIC endpoint: serves invoice PDF from R2 by signed URL.
    // Path shape: /invoice-pdf/{invoiceNumber}/{token}.pdf
    // No auth token needed — signature in path is the security.
    if (request.method === "GET" && url.pathname.startsWith("/invoice-pdf/")) {
      const path = url.pathname.substring("/invoice-pdf/".length);
      const match = /^(.+?)\/([a-f0-9]{16})\.pdf$/.exec(path);
      if (!match) return new Response("not found", { status: 404 });

      const invoiceNumber = match[1];
      const providedToken = match[2];

      if (!env.ADMIN_TOKEN) {
        return new Response("service misconfigured", { status: 500 });
      }

      const { verifyInvoiceToken } = await import("./invoice");
      const valid = await verifyInvoiceToken(env.ADMIN_TOKEN, invoiceNumber, providedToken);
      if (!valid) return new Response("not found", { status: 404 });

      const key = `invoices/${invoiceNumber}.pdf`;
      const obj = await env.INVOICES_BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });

      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${invoiceNumber}.pdf"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // 2026-09-10 — Odoo → Worker: issue a quotation (build PDF + send WhatsApp).
    // Auth: shared token in ?token=... URL query, compared time-safe to
    // INTERNAL_WEBHOOK_SECRET. Odoo 19 SaaS "Send Webhook Notification" can't
    // send custom headers or sign the body, so HMAC isn't an option there.
    // Body: Odoo sends `{"_action": "...", "_id": <recordId>, "_model": "x_quotation"}`.
    // We accept `quotation_id` too so manual/curl callers keep working.
    if (request.method === "POST" && url.pathname === "/internal/quotation-issue") {
      if (!env.INTERNAL_WEBHOOK_SECRET) {
        return json({ error: "service misconfigured — INTERNAL_WEBHOOK_SECRET missing" }, 500);
      }

      let body: { quotation_id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }

      const providedToken = url.searchParams.get("token") ?? "";
      if (
        !providedToken ||
        !timingSafeEqual(providedToken, env.INTERNAL_WEBHOOK_SECRET)
      ) {
        return json({ error: "unauthorized" }, 401);
      }

      if (body._model && body._model !== "x_quotation") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const qid = Number(body.quotation_id ?? body._id);
      if (!Number.isFinite(qid) || qid <= 0) {
        return json({ error: "invalid quotation_id / _id" }, 400);
      }

      // Async response pattern: return 202 immediately so Odoo's Server
      // Action releases the row lock. The Worker keeps running the full
      // pipeline in ctx.waitUntil — reading the same x_quotation record
      // was deadlocking against Odoo's own transactional lock and hitting
      // the 2-minute Odoo webhook timeout → "Canceled".
      ctx.waitUntil(
        (async () => {
          try {
            const { createAndDispatchQuotationForRecord } = await import("./quotation");
            const result = await createAndDispatchQuotationForRecord(env, qid);
            if (!result) {
              console.warn("[q-issue] background pipeline: quotation not found for id:", qid);
              return;
            }
          } catch (e) {
            console.error(
              "[q-issue] background pipeline FAILED:",
              (e as Error).message,
              (e as Error).stack,
            );
          }
        })(),
      );

      return new Response(
        JSON.stringify({ status: "accepted", quotation_id: qid }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2026-09-09 — quotation dry-run: build PDF, optionally upload to R2, NEVER sends WhatsApp.
    // Mirrors /test-invoice. Will be removed after we're confident in the flow.
    if (request.method === "GET" && url.pathname === "/admin/dry-run-quotation") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = env.ADMIN_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      const idParam = url.searchParams.get("id");
      try {
        const {
          buildQuotationPDFDataFromOdoo,
          generateQuotationPDF,
          uploadQuotationToR2,
          TEST_QUOTATION_DATA,
        } = await import("./quotation");

        let data;
        if (idParam) {
          const id = Number(idParam);
          if (!Number.isFinite(id) || id <= 0) {
            return json({ error: "invalid id" }, 400);
          }
          data = await buildQuotationPDFDataFromOdoo(env, id);
          if (!data) return json({ error: `quotation ${id} not found` }, 404);
        } else {
          data = TEST_QUOTATION_DATA;
        }

        const pdfBytes = await generateQuotationPDF(data, env);
        const shouldSave = url.searchParams.get("save") === "1";

        if (shouldSave) {
          const origin = `${url.protocol}//${url.host}`;
          const result = await uploadQuotationToR2(env, pdfBytes, data.quotationNumber, origin);
          return json({
            ok: true,
            quotationNumber: data.quotationNumber,
            size: result.size,
            publicUrl: result.publicUrl,
            r2Key: result.key,
          });
        }

        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="utak-quotation-${data.quotationNumber}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // 2026-09-09 — PUBLIC: serves quotation PDF from R2 by signed URL.
    // Path shape: /quotation-pdf/{quotationNumber}/{token}.pdf
    if (request.method === "GET" && url.pathname.startsWith("/quotation-pdf/")) {
      const path = url.pathname.substring("/quotation-pdf/".length);
      const match = /^(.+?)\/([a-f0-9]{16})\.pdf$/.exec(path);
      if (!match) return new Response("not found", { status: 404 });

      let quotationNumber: string;
      try {
        quotationNumber = decodeURIComponent(match[1]);
      } catch {
        return new Response("not found", { status: 404 });
      }
      const providedToken = match[2];

      if (!env.ADMIN_TOKEN) {
        return new Response("service misconfigured", { status: 500 });
      }

      const { verifyQuotationToken } = await import("./quotation");
      const valid = await verifyQuotationToken(env.ADMIN_TOKEN, quotationNumber, providedToken);
      if (!valid) return new Response("not found", { status: 404 });

      const key = `quotations/${quotationNumber}.pdf`;
      const obj = await env.INVOICES_BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });

      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${quotationNumber}.pdf"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
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
    if (
      msg.type !== "text" &&
      msg.type !== "interactive" &&
      msg.type !== "button" &&
      msg.type !== "location"
    ) continue;
    if (!msg.text && !msg.buttonId && !msg.location) continue;

    if (await seenBefore(env, msg.messageId)) continue;

    const supplier = await findSupplierByWhatsApp(env, msg.from);
    if (supplier) {
      const enriched = await enrichSupplier(env, supplier);
      const replyText = await handleSupplierReply(env, enriched, msg.text, msg.messageId);
      if (replyText) await sendText(env, msg.from, replyText);
      await markSeen(env, msg.messageId);
      continue;
    }

    const teamMember = await findTeamMemberByWhatsApp(env, msg.from);
    if (teamMember) {
      if (msg.type === "interactive" && msg.buttonId) {
        const reply: RouterReply = await dispatch(env, {
          msg, intent: "other", senderType: "customer",
          partner: { id: teamMember.id, name: teamMember.name, x_whatsapp_number: teamMember.x_whatsapp_number },
        });
        await sendReply(env, msg.from, reply);
      } else if (msg.type === "text") {
        const pendingKey = `pending_issue:${teamMember.id}`;
        const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);
        if (pendingOrderId) {
          const orderId = Number(pendingOrderId);
          await markStopIssue(env, orderId, msg.text);
          await env.MSG_DEDUP.delete(pendingKey);
          if (env.OWNER_WHATSAPP) {
            await sendText(env, env.OWNER_WHATSAPP,
              `⚠️ مشكلة توصيل\nسواق: ${teamMember.name}\nطلب: #${orderId}\nالمشكلة: ${msg.text}`);
          }
          await sendText(env, msg.from, "تم تسجيل المشكلة، براء بيراجعها 🙏");
        } else {
          await sendText(env, msg.from, `مرحبا ${teamMember.name} 👋 استخدم الأزرار عشان نأكد الحالة.`);
        }
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    const { findCustomerByWhatsApp } = await import("./odoo");
    const existing = await findCustomerByWhatsApp(env, msg.from);
    if (!existing && msg.type === "text") {
      try {
        const { sendTemplateByPurpose, T } = await import("./templates");
        await sendTemplateByPurpose(env, msg.from, T.CUSTOMER_WELCOME,
          [msg.profileName || "صديقنا"]);
      } catch (e) { console.warn("[welcome] send failed", (e as Error).message); }
    }
    const partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
    const senderType: SenderType = "customer";

    const pendingKey = `pending_neighborhood:${partner.id}`;
    const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);

    if (pendingOrderId) {
      const orderId = Number(pendingOrderId);

      if (msg.type === "location" && msg.location) {
        const { latitude, longitude, name, address } = msg.location;
        const neigh = (name ?? address ?? "").trim().slice(0, 60);
        await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
        await setOrderLocation(env, orderId, latitude, longitude, neigh);
        await env.MSG_DEDUP.delete(pendingKey);
        const reply: RouterReply = await dispatch(env, {
          msg: { ...msg, text: "خلاص" },
          intent: "request_quotation",
          senderType, partner,
        });
        await sendReply(env, msg.from, reply);
        await markSeen(env, msg.messageId);
        continue;
      }

      if (msg.type === "text") {
        const neigh = msg.text.trim();
        if (neigh.length >= 2 && neigh.length <= 60) {
          await savePartnerNeighborhood(env, partner.id, neigh);
          await setOrderNeighborhood(env, orderId, neigh);
          await env.MSG_DEDUP.delete(pendingKey);
          await sendText(env, msg.from,
            `حفظنا الحي: ${neigh} ✅\nلو تقدر ترسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي) بيوصلك السائق أدق مرة جاية 🌿`);
          const reply: RouterReply = await dispatch(env, {
            msg: { ...msg, text: "خلاص" },
            intent: "request_quotation",
            senderType, partner,
          });
          await sendReply(env, msg.from, reply);
          await markSeen(env, msg.messageId);
          continue;
        }
        await sendText(env, msg.from,
          "أرسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي)، أو اكتب اسم الحي فقط 🙏");
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    if (msg.type === "location" && msg.location) {
      const { latitude, longitude, name, address } = msg.location;
      const neigh = (name ?? address ?? "").trim().slice(0, 60);
      await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
      await sendText(env, msg.from, "حفظنا موقعك للتوصيل ✅ طلباتك الجاية بيوصلك السائق مباشرة.");
      await markSeen(env, msg.messageId);
      continue;
    }

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
