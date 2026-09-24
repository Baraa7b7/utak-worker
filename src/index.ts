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
//   POST /internal/receipt-issue      → Odoo webhook: build+send receipt PDF (token-guarded via ?token=)
//   GET  /admin/test-receipt          → run receipt pipeline sync w/ per-step trace (token-guarded, sends real WA)
//   GET  /receipt-pdf/{num}/{tok}.pdf → PUBLIC receipt PDF from R2 (HMAC-signed)
//   GET  /admin/test-delivery-note    → run delivery-note pipeline sync w/ per-step trace (token-guarded, sends real WA)
//        ?token=X&stop_id=42          → drives stop #42, phone auto-resolved from route driver
//   GET  /delivery-note-pdf/{num}/{tok}.pdf → PUBLIC delivery-note PDF from R2 (HMAC-signed)

import type { Env } from "./config";
import { handleVerify, verifySignature, parseWebhook, sendText, sendButtons, sendLocation } from "./meta";
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
  followUpUnconfirmedPurchaseLists,
  resendOpenPurchaseLists,
  sendCutoffReminders,
} from "./team";
import {
  buildInjectedWebhookPayload,
  guardSimulationOdoo,
  isNonProd,
  purgeSimulationData,
  readOutbound,
  resetOutboundRun,
  verifySimSecret,
  type InjectInput,
} from "./sim";
import { parseAllowlist, runtimeMode } from "./config";
import {
  classifySignatureFailure,
  handleSignatureFailure,
  readRecentSignatureFailures,
} from "./webhook-alert";

export default {
  async scheduled(event: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[scheduled] cron=${cron} at ${new Date().toISOString()}`);
    // 2026-09-23 — every send made inside a cron job is automated: mark env
    // so fetchMeta claims a per-(recipient, template, Riyadh day, job) KV
    // key before sending. See src/auto-send-guard.ts.
    const { CRON_JOB, withAutoSendJob } = await import("./auto-send-guard");
    const env = withAutoSendJob(rawEnv, CRON_JOB[cron] ?? `cron:${cron}`);
    try {
      switch (cron) {
        case "0 23 * * *": await askAllSuppliersForPrices(env); break;
        case "0 2 * * *":
          await updateSupplierReliabilityScores(env);
          // Phase 1 (2026-09-17): daily template sync appended to the 05:00
          // Riyadh handler after its existing work, in try/catch so a sync
          // failure never breaks reliability-score scheduling.
          try {
            const { runTemplateSync } = await import("./wa-template-sync");
            const report = await runTemplateSync(env);
            console.log("[wa-sync 05:00]", JSON.stringify(report));
          } catch (e) {
            console.error("[wa-sync 05:00] failed", (e as Error)?.message);
          }
          break;
        case "0 3 * * *":
          await openOrderingWindow(env);
          // 2026-09-24 (ح7) — a purchase list still without «تم الشراء».
          try {
            await followUpUnconfirmedPurchaseLists(withAutoSendJob(rawEnv, "purchase_followup"));
          } catch (e) {
            console.error("[cron 06:00] purchase follow-up failed", (e as Error)?.message);
          }
          break;
        case "0 17 * * *": await sendCutoffReminders(env); break;
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
      // 2026-09-21 — surface the 7-day signature-failure counter so one
      // curl on /health is enough to know if webhook rejects are silently
      // piling up, without waiting on the daily WhatsApp alert to fire.
      const sigFailures = await readRecentSignatureFailures(env, 7).catch(
        () => [] as { date: string; count: number }[],
      );
      const sigFailuresTotal = sigFailures.reduce((a, b) => a + b.count, 0);
      // 2026-09-24 (ح6) — WhatsApp send failures (sync, async and refused
      // template variables), same 7-day shape as sigFailures.
      const { readRecentSendFailures } = await import("./send-failure");
      const sendFailures = await readRecentSendFailures(env, 7).catch(
        () => [] as { date: string; count: number }[],
      );
      return json(
        {
          status: odoo.ok ? "ok" : "degraded",
          odoo: odoo.ok ? `connected (${odoo.mode})` : "failed",
          error: odoo.ok ? undefined : odoo.error,
          sigFailures: {
            totalLast7Days: sigFailuresTotal,
            byDay: sigFailures,
          },
          sendFailures: {
            totalLast7Days: sendFailures.reduce((a, b) => a + b.count, 0),
            byDay: sendFailures,
          },
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

    // TEMPORARY 2026-09-12 — one-shot partner-dedup audit.
    // Reads Othman id=8/id=15 with linked-record counts, dumps role state,
    // audits suppliers, and reports customers missing a delivery neighborhood.
    // Optional: ?create_pilot=1 creates ONE pilot customer.
    // NEVER archives, NEVER unlinks. Gate: AUDIT_TOKEN secret.
    if (request.method === "GET" && url.pathname === "/admin/audit-partners") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-audit-token") ?? "";
      const expected = env.AUDIT_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { runPartnerAudit } = await import("./audit-partners");
        const createPilot = url.searchParams.get("create_pilot") === "1";
        const result = await runPartnerAudit(env, { createPilot });
        return json({ ok: true, ...result });
      } catch (e) {
        return json(
          { ok: false, error: (e as Error).message, stack: (e as Error).stack },
          500,
        );
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

    // 2026-09-12 — Odoo → Worker: issue a receipt (build PDF + send WhatsApp).
    // Auth + async-response pattern mirrors /internal/quotation-issue exactly.
    // Body: Odoo Automated Action sends `{"id": <recordId>}`; also accept `_id`
    // and `payment_id` so manual/curl callers keep working.
    if (request.method === "POST" && url.pathname === "/internal/receipt-issue") {
      if (!env.INTERNAL_WEBHOOK_SECRET) {
        return json({ error: "service misconfigured — INTERNAL_WEBHOOK_SECRET missing" }, 500);
      }

      let body: { id?: number; payment_id?: number; _id?: number; _model?: string } = {};
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

      if (body._model && body._model !== "x_payment") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const pid = Number(body.id ?? body.payment_id ?? body._id);
      if (!Number.isFinite(pid) || pid <= 0) {
        return json({ error: "invalid id / payment_id / _id" }, 400);
      }

      ctx.waitUntil(
        (async () => {
          try {
            const { createAndDispatchReceiptForRecord } = await import("./receipt");
            const result = await createAndDispatchReceiptForRecord(env, pid);
            if (!result) {
              console.warn("[r-issue] background pipeline: payment not found for id:", pid);
              return;
            }
          } catch (e) {
            console.error(
              "[r-issue] background pipeline FAILED:",
              (e as Error).message,
              (e as Error).stack,
            );
          }
        })(),
      );

      return new Response(
        JSON.stringify({ status: "accepted", payment_id: pid }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2026-09-22 — «المستندات الرسمية» pipeline endpoints.
    // Same shape as /internal/quotation-issue: shared token in ?token=,
    // 202 async, ctx.waitUntil runs the full pipeline. Any pipeline error
    // is written back to x_official_doc.x_last_error so the operator sees
    // it in the Odoo form.
    if (
      request.method === "POST" &&
      (url.pathname === "/internal/official-doc/preview" ||
        url.pathname === "/internal/official-doc/issue" ||
        url.pathname === "/internal/official-doc/ai-draft")
    ) {
      if (!env.INTERNAL_WEBHOOK_SECRET) {
        return json({ error: "service misconfigured — INTERNAL_WEBHOOK_SECRET missing" }, 500);
      }
      const providedToken = url.searchParams.get("token") ?? "";
      if (!providedToken || !timingSafeEqual(providedToken, env.INTERNAL_WEBHOOK_SECRET)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { doc_id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "x_official_doc") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const docId = Number(body.doc_id ?? body._id);
      if (!Number.isFinite(docId) || docId <= 0) {
        return json({ error: "invalid doc_id / _id" }, 400);
      }
      const action =
        url.pathname === "/internal/official-doc/preview" ? "preview" :
          url.pathname === "/internal/official-doc/issue" ? "issue" : "ai-draft";
      ctx.waitUntil(
        (async () => {
          try {
            const {
              runPreviewPipeline,
              runIssuePipeline,
              runAIDraftPipeline,
            } = await import("./official-doc");
            if (action === "preview") {
              await runPreviewPipeline(env, { docId, workerOrigin: env.WORKER_ORIGIN });
            } else if (action === "issue") {
              await runIssuePipeline(env, { docId, workerOrigin: env.WORKER_ORIGIN });
            } else {
              await runAIDraftPipeline(env, { docId });
            }
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            console.error(`[official-doc:${action}] FAILED id=${docId}`, msg, (e as Error).stack);
            // Best-effort write-back of the failure — never re-throws.
            try {
              const { call } = await import("./odoo");
              await call<boolean>(env, "x_official_doc", "write", {
                ids: [docId],
                vals: { x_last_error: msg.slice(0, 500) },
              });
            } catch (writeErr) {
              console.error(`[official-doc:${action}] writeback also failed`, (writeErr as Error).message);
            }
          }
        })(),
      );
      return new Response(
        JSON.stringify({ status: "accepted", doc_id: docId, action }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2026-09-22 — PUBLIC: serves an official-doc PDF from R2 by signed URL.
    // Final path shape:   /official-doc-pdf/UTAK-L-2026-001/{tok}.pdf
    // Preview path shape: /official-doc-pdf/preview-{docId}-{ts}/{tok}.pdf
    // The signed name is exactly what signDocToken hashed for that upload;
    // final docs live under R2 key official-docs/<name>.pdf, previews under
    // official-docs/previews/<docId>-<ts>.pdf.
    if (request.method === "GET" && url.pathname.startsWith("/official-doc-pdf/")) {
      const path = url.pathname.substring("/official-doc-pdf/".length);
      const match = /^(.+?)\/([a-f0-9]{16})\.pdf$/.exec(path);
      if (!match) return new Response("not found", { status: 404 });
      let docName: string;
      try {
        docName = decodeURIComponent(match[1]);
      } catch {
        return new Response("not found", { status: 404 });
      }
      const providedTok = match[2];
      if (!env.ADMIN_TOKEN) return new Response("service misconfigured", { status: 500 });
      const { verifyOfficialDocToken } = await import("./official-doc");
      const valid = await verifyOfficialDocToken(env.ADMIN_TOKEN, docName, providedTok);
      if (!valid) return new Response("not found", { status: 404 });
      const previewMatch = /^preview-(\d+)-(\d+)$/.exec(docName);
      const key = previewMatch
        ? `official-docs/previews/${previewMatch[1]}-${previewMatch[2]}.pdf`
        : `official-docs/${docName}.pdf`;
      const obj = await env.INVOICES_BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${docName}.pdf"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    // 2026-09-12 — Diagnostic: run the full receipt pipeline SYNCHRONOUSLY with
    // per-step try/catch, so a failing step is visible in the JSON response
    // instead of hiding in a Worker log line. Mirrors createAndDispatchReceiptForRecord
    // but does NOT call it — a local copy of each step keeps the error boundary
    // per-step. Sends real WhatsApp + writes back to Odoo — treat as a test-fire,
    // not a dry-run.
    if (request.method === "GET" && url.pathname === "/admin/test-receipt") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = env.ADMIN_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      const idParam = url.searchParams.get("id");
      const paymentId = Number(idParam);
      if (!Number.isFinite(paymentId) || paymentId <= 0) {
        return json({ error: "invalid id" }, 400);
      }

      const steps: Record<string, string> = {
        "1_build_data": "pending",
        "2_generate_pdf": "pending",
        "3_upload_r2": "pending",
        "4_send_whatsapp": "pending",
        "5_writeback": "pending",
      };
      let receiptNumber = "";
      let pdfUrl = "";

      const {
        buildReceiptPDFDataFromOdoo,
        generateReceiptPDF,
        uploadReceiptToR2,
      } = await import("./receipt");
      const { call } = await import("./odoo");

      // Step 1 — build from Odoo
      const built = await (async () => {
        try {
          const d = await buildReceiptPDFDataFromOdoo(env, paymentId);
          if (!d) {
            steps["1_build_data"] = `error: payment ${paymentId} not found`;
            return null;
          }
          steps["1_build_data"] = "ok";
          receiptNumber = d.receiptNumber;
          return d;
        } catch (e) {
          steps["1_build_data"] = `error: ${(e as Error).message}`;
          return null;
        }
      })();
      if (!built) return json({ paymentId, steps, receiptNumber, pdfUrl });

      // Step 2 — Gotenberg
      let pdfBytes: Uint8Array | null = null;
      try {
        pdfBytes = await generateReceiptPDF(built, env);
        steps["2_generate_pdf"] = "ok";
      } catch (e) {
        steps["2_generate_pdf"] = `error: ${(e as Error).message}`;
      }
      if (!pdfBytes) return json({ paymentId, steps, receiptNumber, pdfUrl });

      // Step 3 — R2 upload (returns signed URL)
      let uploaded: { key: string; publicUrl: string; size: number } | null = null;
      try {
        uploaded = await uploadReceiptToR2(env, pdfBytes, built.receiptNumber, env.WORKER_ORIGIN);
        pdfUrl = uploaded.publicUrl;
        steps["3_upload_r2"] = `ok: ${uploaded.publicUrl}`;
      } catch (e) {
        steps["3_upload_r2"] = `error: ${(e as Error).message}`;
      }
      if (!uploaded) return json({ paymentId, steps, receiptNumber, pdfUrl });

      // Step 4 — WhatsApp (plain-text fallback, mirrors orchestrator)
      const customerPhone = built.customer.phone;
      if (!customerPhone) {
        steps["4_send_whatsapp"] = "skipped: no phone";
      } else {
        try {
          const method = built.payments[0]?.method || "-";
          const body = [
            `✅ تم استلام دفعتك`,
            `رقم الإيصال: ${built.receiptNumber}`,
            `المبلغ: ${built.totalReceived} ر.س`,
            `طريقة الدفع: ${method}`,
            ``,
            `الإيصال: ${uploaded.publicUrl}`,
            ``,
            `شكراً لتعاملكم مع UTAK 🌿`,
          ].join("\n");
          const resp = await sendText(env, customerPhone, body);
          if (!resp || !resp.ok) {
            const errText = resp ? await resp.text().catch(() => "") : "no response";
            steps["4_send_whatsapp"] = `error: ${resp?.status ?? "?"} ${errText.slice(0, 200)}`;
          } else {
            steps["4_send_whatsapp"] = "ok";
          }
        } catch (e) {
          steps["4_send_whatsapp"] = `error: ${(e as Error).message}`;
        }
      }

      // Step 5 — Odoo write-back
      try {
        await call<boolean>(env, "x_payment", "write", {
          ids: [paymentId],
          vals: {
            x_studio_char_1_1: built.receiptNumber,
            x_studio_datetime_1_1: new Date().toISOString().replace("T", " ").slice(0, 19),
            x_studio_char_2: uploaded.publicUrl,
          },
        });
        steps["5_writeback"] = "ok";
      } catch (e) {
        steps["5_writeback"] = `error: ${(e as Error).message}`;
      }

      return json({ paymentId, steps, receiptNumber, pdfUrl });
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
          // A dry run is a preview: no seal, no signature.
          data = { ...data, issued: false };
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

    // 2026-09-12 — PUBLIC: serves receipt PDF from R2 by signed URL.
    // Path shape: /receipt-pdf/{receiptNumber}/{token}.pdf
    // R2 key written by uploadReceiptToR2 → `receipts/{receiptNumber}.pdf`.
    if (request.method === "GET" && url.pathname.startsWith("/receipt-pdf/")) {
      const path = url.pathname.substring("/receipt-pdf/".length);
      const match = /^(.+?)\/([a-f0-9]{16})\.pdf$/.exec(path);
      if (!match) return new Response("not found", { status: 404 });

      let receiptNumber: string;
      try {
        receiptNumber = decodeURIComponent(match[1]);
      } catch {
        return new Response("not found", { status: 404 });
      }
      const providedToken = match[2];

      if (!env.ADMIN_TOKEN) {
        return new Response("service misconfigured", { status: 500 });
      }

      const { verifyReceiptToken } = await import("./receipt");
      const valid = await verifyReceiptToken(env.ADMIN_TOKEN, receiptNumber, providedToken);
      if (!valid) return new Response("not found", { status: 404 });

      const key = `receipts/${receiptNumber}.pdf`;
      const obj = await env.INVOICES_BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });

      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${receiptNumber}.pdf"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Phase 3 — PUBLIC: serves delivery-note PDF from R2 by signed URL.
    // Path shape: /delivery-note-pdf/{deliveryNumber}/{token}.pdf
    // R2 key written by uploadDeliveryNoteToR2 → `delivery-notes/{deliveryNumber}.pdf`.
    if (request.method === "GET" && url.pathname.startsWith("/delivery-note-pdf/")) {
      const path = url.pathname.substring("/delivery-note-pdf/".length);
      const match = /^(.+?)\/([a-f0-9]{16})\.pdf$/.exec(path);
      if (!match) return new Response("not found", { status: 404 });

      let deliveryNumber: string;
      try {
        deliveryNumber = decodeURIComponent(match[1]);
      } catch {
        return new Response("not found", { status: 404 });
      }
      const providedToken = match[2];

      if (!env.ADMIN_TOKEN) {
        return new Response("service misconfigured", { status: 500 });
      }

      const { verifyDeliveryNoteToken } = await import("./delivery-note");
      const valid = await verifyDeliveryNoteToken(env.ADMIN_TOKEN, deliveryNumber, providedToken);
      if (!valid) return new Response("not found", { status: 404 });

      const key = `delivery-notes/${deliveryNumber}.pdf`;
      const obj = await env.INVOICES_BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });

      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${deliveryNumber}.pdf"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Phase 3 — diagnostic: run the full delivery-note pipeline for a single
    // stop with per-step trace. Sends real WhatsApp + writes back to Odoo.
    // Mirrors /admin/test-receipt. Driver phone is resolved from the stop's
    // route.x_driver_id → res.partner.x_whatsapp_number.
    if (request.method === "GET" && url.pathname === "/admin/test-delivery-note") {
      const token = url.searchParams.get("token") ?? request.headers.get("x-admin-token") ?? "";
      const expected = env.ADMIN_TOKEN ?? "";
      if (!expected || token !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      const idParam = url.searchParams.get("stop_id");
      const stopId = Number(idParam);
      if (!Number.isFinite(stopId) || stopId <= 0) {
        return json({ error: "invalid stop_id" }, 400);
      }

      const steps: Record<string, string> = {
        "1_build_data": "pending",
        "2_generate_pdf": "pending",
        "3_upload_r2": "pending",
        "4_send_whatsapp": "pending",
        "5_writeback": "pending",
      };
      let deliveryNumber = "";
      let pdfUrl = "";
      let driverPhone = "";

      const {
        buildDeliveryNotePDFDataFromOdoo,
        generateDeliveryNotePDF,
        uploadDeliveryNoteToR2,
      } = await import("./delivery-note");
      const { call } = await import("./odoo");

      // Resolve driver phone from stop → route → partner (best-effort).
      try {
        const stopRows = await call<Array<{ x_route_id: [number, string] | false }>>(
          env,
          "x_delivery_stop",
          "read",
          { ids: [stopId], fields: ["x_route_id"] },
        );
        const routeId = stopRows[0]?.x_route_id ? stopRows[0].x_route_id[0] : 0;
        if (routeId) {
          const routeRows = await call<Array<{ x_driver_id: [number, string] | false }>>(
            env,
            "x_delivery_route",
            "read",
            { ids: [routeId], fields: ["x_driver_id"] },
          );
          const driverId = routeRows[0]?.x_driver_id ? routeRows[0].x_driver_id[0] : 0;
          if (driverId) {
            const partnerRows = await call<Array<{ phone: string | false; x_whatsapp_number: string | false }>>(
              env,
              "res.partner",
              "read",
              { ids: [driverId], fields: ["phone", "x_whatsapp_number"] },
            );
            const p = partnerRows[0];
            if (p) {
              driverPhone = (typeof p.x_whatsapp_number === "string" && p.x_whatsapp_number)
                || (typeof p.phone === "string" && p.phone)
                || "";
            }
          }
        }
      } catch {
        /* leave driverPhone empty — step 4 will report skipped */
      }

      // Step 1 — build from Odoo
      const built = await (async () => {
        try {
          const d = await buildDeliveryNotePDFDataFromOdoo(env, stopId);
          if (!d) {
            steps["1_build_data"] = `error: stop ${stopId} not found`;
            return null;
          }
          steps["1_build_data"] = "ok";
          deliveryNumber = d.deliveryNumber;
          return d;
        } catch (e) {
          steps["1_build_data"] = `error: ${(e as Error).message}`;
          return null;
        }
      })();
      if (!built) return json({ stopId, driverPhone, steps, deliveryNumber, pdfUrl });

      // Step 2 — Gotenberg
      let pdfBytes: Uint8Array | null = null;
      try {
        pdfBytes = await generateDeliveryNotePDF(built, env);
        steps["2_generate_pdf"] = "ok";
      } catch (e) {
        steps["2_generate_pdf"] = `error: ${(e as Error).message}`;
      }
      if (!pdfBytes) return json({ stopId, driverPhone, steps, deliveryNumber, pdfUrl });

      // Step 3 — R2 upload (returns signed URL)
      let uploaded: { key: string; publicUrl: string; size: number } | null = null;
      try {
        uploaded = await uploadDeliveryNoteToR2(env, pdfBytes, built.deliveryNumber, env.WORKER_ORIGIN);
        pdfUrl = uploaded.publicUrl;
        steps["3_upload_r2"] = `ok: ${uploaded.publicUrl}`;
      } catch (e) {
        steps["3_upload_r2"] = `error: ${(e as Error).message}`;
      }
      if (!uploaded) return json({ stopId, driverPhone, steps, deliveryNumber, pdfUrl });

      // Step 4 — WhatsApp to driver
      if (!driverPhone) {
        steps["4_send_whatsapp"] = "skipped: no driver phone";
      } else {
        try {
          // Look up order id for the message body (best-effort)
          let orderIdForMsg = 0;
          try {
            const rows = await call<Array<{ x_order_id: [number, string] | false }>>(
              env,
              "x_delivery_stop",
              "read",
              { ids: [stopId], fields: ["x_order_id"] },
            );
            if (rows[0]?.x_order_id) orderIdForMsg = rows[0].x_order_id[0];
          } catch {
            /* ignore */
          }
          const body = [
            `📦 إذن تسليم للطلب ${orderIdForMsg || built.deliveryNumber}`,
            `العميل: ${built.customer.name}`,
            `الحي: ${built.customer.address}`,
            ``,
            `الوثيقة: ${uploaded.publicUrl}`,
          ].join("\n");
          const resp = await sendText(env, driverPhone, body);
          if (!resp || !resp.ok) {
            const errText = resp ? await resp.text().catch(() => "") : "no response";
            steps["4_send_whatsapp"] = `error: ${resp?.status ?? "?"} ${errText.slice(0, 200)}`;
          } else {
            steps["4_send_whatsapp"] = "ok";
          }
        } catch (e) {
          steps["4_send_whatsapp"] = `error: ${(e as Error).message}`;
        }
      }

      // Step 5 — Odoo write-back
      try {
        await call<boolean>(env, "x_delivery_stop", "write", {
          ids: [stopId],
          vals: {
            x_delivery_note_number: built.deliveryNumber,
            x_delivery_note_url: uploaded.publicUrl,
            x_dn_sent_at: new Date().toISOString().replace("T", " ").slice(0, 19),
          },
        });
        steps["5_writeback"] = "ok";
      } catch (e) {
        steps["5_writeback"] = `error: ${(e as Error).message}`;
      }

      return json({ stopId, driverPhone, steps, deliveryNumber, pdfUrl });
    }

    // Phase 1 — synchronous template sync (inline JSON report). Same
    // guarding as /odoo/hook/wa-template-sync but blocks on the sync so
    // failures surface in the response body instead of the tail.
    //
    // Phase A (2026-09-17) — header-only auth. A caller passing ?token=
    // is either buggy or hostile; refuse before doing anything else. The
    // Odoo webhook route /odoo/hook/wa-template-sync keeps the query-string
    // form because Odoo 19 SaaS webhook actions cannot set custom headers.
    if (request.method === "GET" && url.pathname === "/admin/wa-template-sync") {
      if (url.searchParams.has("token")) {
        return json({ error: "unauthorized — token must be in X-Admin-Token header, not query" }, 401);
      }
      const providedToken = request.headers.get("x-admin-token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { runTemplateSync } = await import("./wa-template-sync");
        const report = await runTemplateSync(env);
        return json({ ok: true, report });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message, stack: (e as Error).stack }, 500);
      }
    }


    // Item 3 (2026-09-17) — Odoo → Worker: "إرسال واتساب" button on a
    // manual x_quotation. Reuses buildQuotationPDFDataFromOdoo +
    // renderQuotationHTML + htmlToPDF to produce the PDF, then creates an
    // x_wa_message row with x_attachment (base64) + x_manual=true + res_model/
    // res_id set, transitioned to x_status='queued'. The queued automation
    // fires the send-webhook route, which uploads the media to Meta and
    // sends {type:'document', document:{id, filename}}.
    if (request.method === "POST" && url.pathname === "/internal/quotation-wa-send") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "x_quotation") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const qid = Number(body.id ?? body._id ?? url.searchParams.get("id"));
      if (!Number.isFinite(qid) || qid <= 0) {
        return json({ error: "invalid id" }, 400);
      }
      // ?dry_run=1 lets a tester stamp x_dry_run=true on the auto-created
      // x_wa_message so the queued send stops at 'dry_ok' with no Meta call.
      // Not set by the Odoo button; only used from curl / tests.
      const dryRun = url.searchParams.get("dry_run") === "1";
      ctx.waitUntil(
        (async () => {
          try {
            const {
              buildQuotationPDFDataFromOdoo,
              generateQuotationPDF,
              uploadQuotationToR2,
            } = await import("./quotation");
            const { call } = await import("./odoo");
            const { sendOwnerAlert } = await import("./templates");
            const data = await buildQuotationPDFDataFromOdoo(env, qid);
            if (!data) {
              console.warn(`[q-manual-wa] quotation ${qid} not found`);
              return;
            }
            if (data.has_blocking_issue) {
              const missing = data.missing_products ?? [];
              const reason = missing.map((n) => `صنف بلا سعر: ${n}`).join(" | ") ||
                "صنف بلا سعر";
              console.error(`[q-manual-wa] BLOCKED ${qid} — ${reason}`);
              await sendOwnerAlert(env,
                `🚫 عرض يدوي ${data.quotationNumber} (id=${qid}) لم يُرسل — ${reason}`);
              return;
            }
            const pdfBytes = await generateQuotationPDF(data, env);
            const uploaded = await uploadQuotationToR2(
              env,
              pdfBytes,
              data.quotationNumber,
              env.WORKER_ORIGIN,
            );
            const b64 = arrayBufferToBase64(pdfBytes);
            const partnerId = data.customer_id;
            if (!partnerId) {
              console.error(`[q-manual-wa] no customer_id resolved for quotation ${qid}`);
              return;
            }
            const ids = await call<number[]>(env, "x_wa_message", "create", {
              vals_list: [{
                x_partner_id: partnerId,
                x_direction: "out",
                x_kind: "document",
                x_attachment: b64,
                x_filename: `${data.quotationNumber}.pdf`,
                x_res_model: "x_quotation",
                x_res_id: qid,
                x_manual: true,
                x_dry_run: dryRun,
                x_status: "queued",
                x_body: `عرض سعر ${data.quotationNumber} — الإجمالي ${data.grandTotal} ر.س`,
              }],
            });
            console.log(
              `[q-manual-wa] queued x_wa_message id=${ids[0]} for quotation ${qid} (PDF ${uploaded.size} bytes)`,
            );
          } catch (e) {
            console.error(
              "[q-manual-wa] failed",
              (e as Error)?.message,
              (e as Error)?.stack,
            );
          }
        })(),
      );
      return json({ status: "accepted", quotation_id: qid }, 202);
    }

    // Item 1 (2026-09-18) — parallel build. Odoo → Worker: "إرسال واتساب"
    // button on a standard sale.order. Reuses the shared UTAK helpers
    // (renderQuotationHTML + htmlToPDF + uploadQuotationToR2 + x_wa_message
    // create) exactly like /internal/quotation-wa-send, but the PDF data
    // comes from sale.order instead of x_quotation. Nothing about the
    // x_quotation route is touched; both routes coexist.
    if (request.method === "POST" && url.pathname === "/internal/sale-quotation-wa-send") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "sale.order") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const soid = Number(body.id ?? body._id ?? url.searchParams.get("id"));
      if (!Number.isFinite(soid) || soid <= 0) {
        return json({ error: "invalid id" }, 400);
      }
      const dryRun = url.searchParams.get("dry_run") === "1";
      ctx.waitUntil(
        (async () => {
          try {
            const { buildQuotationPDFDataFromSaleOrder } = await import(
              "./sale-order-quotation"
            );
            const { generateQuotationPDF, uploadQuotationToR2 } = await import(
              "./quotation"
            );
            const { call } = await import("./odoo");
            const { sendOwnerAlert } = await import("./templates");
            const data = await buildQuotationPDFDataFromSaleOrder(env, soid);
            if (!data) {
              console.warn(`[so-manual-wa] sale.order ${soid} not found`);
              return;
            }
            if (data.has_blocking_issue) {
              const missing = data.missing_products ?? [];
              const reason = missing.map((n) => `صنف بلا سعر: ${n}`).join(" | ") ||
                "صنف بلا سعر";
              console.error(`[so-manual-wa] BLOCKED ${soid} — ${reason}`);
              await sendOwnerAlert(
                env,
                `🚫 عرض بيع ${data.quotationNumber} (sale.order id=${soid}) لم يُرسل — ${reason}`,
              );
              return;
            }
            // Sending it to the customer issues it: seal + signature.
            const pdfBytes = await generateQuotationPDF({ ...data, issued: true }, env);
            const uploaded = await uploadQuotationToR2(
              env,
              pdfBytes,
              data.quotationNumber,
              env.WORKER_ORIGIN,
            );
            const b64 = arrayBufferToBase64(pdfBytes);
            const partnerId = data.customer_id;
            if (!partnerId) {
              console.error(`[so-manual-wa] no customer_id resolved for sale.order ${soid}`);
              return;
            }
            const ids = await call<number[]>(env, "x_wa_message", "create", {
              vals_list: [{
                x_partner_id: partnerId,
                x_direction: "out",
                x_kind: "document",
                x_attachment: b64,
                x_filename: `${data.quotationNumber}.pdf`,
                x_res_model: "sale.order",
                x_res_id: soid,
                x_manual: true,
                x_dry_run: dryRun,
                x_status: "queued",
                x_body: `عرض سعر ${data.quotationNumber} — الإجمالي ${data.grandTotal} ر.س`,
              }],
            });
            console.log(
              `[so-manual-wa] queued x_wa_message id=${ids[0]} for sale.order ${soid} (PDF ${uploaded.size} bytes)`,
            );
          } catch (e) {
            console.error(
              "[so-manual-wa] failed",
              (e as Error)?.message,
              (e as Error)?.stack,
            );
          }
        })(),
      );
      return json({ status: "accepted", sale_order_id: soid }, 202);
    }

    // 2026-09-19 — browser-facing "تنزيل PDF (UTAK)" button on sale.order.
    // GET /internal/sale-quotation-pdf?id=<sale_order_id>&token=<SALE_PDF_DOWNLOAD_TOKEN>
    // → 200 application/pdf attachment (built via the SAME builder that the
    //   WhatsApp send route uses: buildQuotationPDFDataFromSaleOrder →
    //   renderQuotationHTML → htmlToPDF). No WhatsApp send, no write-back
    //   to Odoo, no R2 upload. Token is a dedicated secret independent of
    //   INTERNAL_WEBHOOK_SECRET and ODOO_HOOK_TOKEN so it can be rotated
    //   without disturbing existing webhooks. Any auth/id failure returns
    //   404 (not 401) so a wrong token does not reveal that the endpoint
    //   exists to a probing browser tab.
    if (request.method === "GET" && url.pathname === "/internal/sale-quotation-pdf") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.SALE_PDF_DOWNLOAD_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return new Response("not found", { status: 404 });
      }
      const soid = Number(url.searchParams.get("id"));
      if (!Number.isFinite(soid) || soid <= 0) {
        return new Response("not found", { status: 404 });
      }
      try {
        const { buildQuotationPDFDataFromSaleOrder } = await import(
          "./sale-order-quotation"
        );
        const { generateQuotationPDF } = await import("./quotation");
        const data = await buildQuotationPDFDataFromSaleOrder(env, soid);
        if (!data) {
          return new Response("not found", { status: 404 });
        }
        if (data.has_blocking_issue) {
          const missing = (data.missing_products ?? []).join(", ") || "(unnamed)";
          console.error(
            `[so-pdf-download] BLOCKED sale.order ${soid} — صنف بلا سعر: ${missing}`,
          );
          return new Response(
            `صنف بلا سعر: ${missing}`,
            { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        }
        const pdfBytes = await generateQuotationPDF(data, env);
        const filename = `${data.quotationNumber}.pdf`;
        // ArrayBuffer copy: Response wants an actual ArrayBuffer, not a Uint8Array's underlying SharedArrayBuffer.
        const body = pdfBytes.slice().buffer;
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(pdfBytes.byteLength),
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        console.error(
          "[so-pdf-download] failed",
          (e as Error)?.message,
          (e as Error)?.stack,
        );
        return new Response("build error", { status: 500 });
      }
    }

    // 2026-09-19 — Odoo customer-invoice PDF download (UTAK-branded).
    // GET /internal/invoice-pdf?id=<account.move id>&token=<SALE_PDF_DOWNLOAD_TOKEN>
    // Reads account.move (out_invoice/out_refund only) and renders via the
    // shared invoice template. showZatcaQR = false while amount_tax === 0.
    if (request.method === "GET" && url.pathname === "/internal/invoice-pdf") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.SALE_PDF_DOWNLOAD_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return new Response("not found", { status: 404 });
      }
      const moveId = Number(url.searchParams.get("id"));
      if (!Number.isFinite(moveId) || moveId <= 0) {
        return new Response("not found", { status: 404 });
      }
      try {
        const { buildInvoicePDFDataFromAccountMove, generateInvoicePDF } = await import("./invoice");
        const data = await buildInvoicePDFDataFromAccountMove(env, moveId);
        if (!data) {
          return new Response("not found", { status: 404 });
        }
        const pdfBytes = await generateInvoicePDF(data, env);
        const filename = `${data.invoiceNumber}.pdf`;
        const body = pdfBytes.slice().buffer;
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(pdfBytes.byteLength),
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        console.error("[inv-pdf-download] failed", (e as Error)?.message, (e as Error)?.stack);
        return new Response("build error", { status: 500 });
      }
    }

    // 2026-09-19 — Odoo purchase.order PDF download (UTAK-branded).
    // GET /internal/purchase-order-pdf?id=<purchase.order id>&token=<SALE_PDF_DOWNLOAD_TOKEN>
    if (request.method === "GET" && url.pathname === "/internal/purchase-order-pdf") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.SALE_PDF_DOWNLOAD_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return new Response("not found", { status: 404 });
      }
      const poId = Number(url.searchParams.get("id"));
      if (!Number.isFinite(poId) || poId <= 0) {
        return new Response("not found", { status: 404 });
      }
      try {
        const { buildPurchaseOrderPDFDataFromPurchaseOrder, generatePurchaseOrderPDF } = await import("./purchase-order");
        const data = await buildPurchaseOrderPDFDataFromPurchaseOrder(env, poId);
        if (!data) return new Response("not found", { status: 404 });
        const pdfBytes = await generatePurchaseOrderPDF(data, env);
        const filename = `${data.poNumber}.pdf`;
        const body = pdfBytes.slice().buffer;
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(pdfBytes.byteLength),
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        console.error("[po-pdf-download] failed", (e as Error)?.message, (e as Error)?.stack);
        return new Response("build error", { status: 500 });
      }
    }

    // 2026-09-20 — Odoo → Worker: Baraa typed a reply inside a WhatsApp
    // Discuss channel. base.automation on mail.message fires this hook with
    // { _model: "mail.message", id: <mail.message.id> }; we return 202
    // immediately and process in ctx.waitUntil so Odoo's row lock releases
    // fast. Everything a reply needs (channel → partner → phone → 24h
    // window → send → x_wa_message log) lives in handleInboxReplyHook.
    if (request.method === "POST" && url.pathname === "/odoo/hook/wa-inbox") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "mail.message") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const mmId = Number(body.id ?? body._id);
      if (!Number.isFinite(mmId) || mmId <= 0) {
        return json({ error: "invalid id / _id" }, 400);
      }
      ctx.waitUntil(
        (async () => {
          try {
            const { handleInboxReplyHook } = await import("./wa-inbox-reply");
            const result = await handleInboxReplyHook(env, mmId, ctx);
            console.log("[wa-inbox hook]", JSON.stringify({ mmId, ...result }));
          } catch (e) {
            console.error(
              "[wa-inbox hook] failed",
              (e as Error)?.message,
              (e as Error)?.stack,
            );
          }
        })(),
      );
      return json({ status: "accepted", mail_message_id: mmId }, 202);
    }

    // Item 2 (2026-09-17) — Odoo → Worker: process x_wa_message.x_status='queued'.
    // Fired by the base.automation (wa_message.on_queued) via ir.actions.server
    // (wa_message.send_webhook). The full send pipeline (validate → media
    // upload → Meta send → chatter write-back) lives in handleWaMessageWebhook.
    // Async response (202 + ctx.waitUntil) so Odoo's row lock releases fast.
    if (request.method === "POST" && url.pathname === "/odoo/hook/wa") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "x_wa_message") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const waId = Number(body.id ?? body._id);
      if (!Number.isFinite(waId) || waId <= 0) {
        return json({ error: "invalid id / _id" }, 400);
      }
      ctx.waitUntil(
        (async () => {
          try {
            const { handleWaMessageWebhook } = await import("./wa-message-send");
            const result = await handleWaMessageWebhook(env, waId, ctx);
            console.log("[wa-msg hook]", JSON.stringify({ waId, ...result }));
          } catch (e) {
            console.error(
              "[wa-msg hook] failed",
              (e as Error)?.message,
              (e as Error)?.stack,
            );
          }
        })(),
      );
      return json({ status: "accepted", wa_message_id: waId }, 202);
    }

    // Phase 1 (2026-09-17) — Odoo → Worker: template sync trigger.
    // Fired by the base.automation on x_wa_control.x_sync_requested=true.
    // Also usable via curl for a manual sync. Returns 202 and runs the sync
    // in ctx.waitUntil so Odoo's row lock releases immediately.
    if (request.method === "POST" && url.pathname === "/odoo/hook/wa-template-sync") {
      const providedToken = url.searchParams.get("token") ?? "";
      const expected = env.ODOO_HOOK_TOKEN ?? "";
      if (!expected || !timingSafeEqual(providedToken, expected)) {
        return json({ error: "unauthorized" }, 401);
      }
      ctx.waitUntil(
        (async () => {
          try {
            const { runTemplateSync } = await import("./wa-template-sync");
            const report = await runTemplateSync(env);
            console.log("[wa-sync hook]", JSON.stringify(report));
          } catch (e) {
            console.error("[wa-sync hook] failed", (e as Error)?.message);
          }
        })(),
      );
      return json({ status: "accepted" }, 202);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const raw = await request.text();
      const sig = request.headers.get("x-hub-signature-256");
      const ok = await verifySignature(raw, sig, env);
      if (!ok) {
        // 2026-09-21 — silent-outage insurance. Log the rejection, bump the
        // daily KV counter and (once per Riyadh calendar day) fire a
        // WhatsApp alert to OWNER_WHATSAPP so a rotated / mismatched
        // META_APP_SECRET can never sit undetected for ten days again.
        // Runs via ctx.waitUntil so the 401 returns without waiting on KV
        // or Meta; any error inside stays inside the module.
        const failureTask = handleSignatureFailure(env, {
          rawBodyLength: raw.length,
          signatureHeader: sig,
          reason: classifySignatureFailure(sig),
        });
        ctx.waitUntil(failureTask);
        return new Response("bad signature", { status: 401 });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return new Response("bad json", { status: 400 });
      }

      try {
        await handleWebhook(env, payload, ctx);
      } catch (e) {
        console.error("webhook handler error", (e as Error)?.stack ?? e);
      }
      return new Response("ok", { status: 200 });
    }

    // ============================================================
    // /sim/* — simulation-mode control plane
    // Every endpoint requires SIMULATION_MODE=true AND a valid SIM_SECRET.
    // Refusing in production ensures a stray call from a leaked URL cannot
    // trigger anything against the live worker.
    // ============================================================
    if (url.pathname.startsWith("/sim/")) {
      const simResp = await handleSimRoute(request, url, env);
      if (simResp) return simResp;
    }

    return new Response("not found", { status: 404 });
  },
};

// ------------------------------------------------------------
// /sim/* handlers
// ------------------------------------------------------------
async function handleSimRoute(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response | null> {
  if (!isNonProd(env)) {
    return json({ error: "sim/pilot mode not enabled on this worker" }, 404);
  }
  const secret =
    url.searchParams.get("secret") ??
    request.headers.get("x-sim-secret") ??
    "";
  if (!verifySimSecret(env, secret)) {
    return json({ error: "unauthorized" }, 401);
  }

  // TEMPORARY 2026-09-12 — T2 isolation harness.
  // POST /sim/test-send?to=+9665...&text=...  — calls sendText() directly,
  // no Odoo, no template lookup, no handleWebhook. Returns the fetchMeta
  // Response status/body verbatim so a caller can assert AllowlistBlocked
  // (403) or SIM capture (200 + wamid). Remove once T2 signs off.
  if (request.method === "POST" && url.pathname === "/sim/test-send") {
    const to = url.searchParams.get("to") ?? "";
    const text = url.searchParams.get("text") ?? "T2 probe";
    if (!to) return json({ error: "missing to" }, 400);
    const { sendText } = await import("./meta");
    const resp = await sendText(env, to, text);
    const body = await resp.text();
    return json({
      status: resp.status,
      body: (() => { try { return JSON.parse(body); } catch { return body; } })(),
    });
  }

  // GET /sim/mode — report which mode we're in and the allowlist state
  if (request.method === "GET" && url.pathname === "/sim/mode") {
    const rm = runtimeMode(env);
    const allowlist = parseAllowlist(env);
    return json({
      mode: rm.mode,
      misconfig: rm.misconfig,
      allowlist: {
        set: allowlist.length > 0,
        entries: allowlist.length,
        entries_masked: allowlist.map((p) =>
          p.length > 6 ? `${p.slice(0, 6)}…` : p,
        ),
      },
    });
  }

  // POST /sim/inject — inject an incoming WhatsApp message
  if (request.method === "POST" && url.pathname === "/sim/inject") {
    let input: InjectInput;
    try {
      input = (await request.json()) as InjectInput;
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!input?.from || !input?.type) {
      return json({ error: "missing from/type" }, 400);
    }
    const { payload, wamid } = buildInjectedWebhookPayload(input);
    try {
      await handleWebhook(env, payload);
    } catch (e) {
      return json({ error: (e as Error)?.message ?? "handler failed", wamid }, 500);
    }
    return json({ ok: true, injected_wamid: wamid });
  }

  // GET /sim/outbound?run_id=X — list captured messages for a run
  if (request.method === "GET" && url.pathname === "/sim/outbound") {
    const runId = url.searchParams.get("run_id");
    if (!runId) return json({ error: "missing run_id" }, 400);
    const rows = await readOutbound(env, runId);
    return json({ run_id: runId, count: rows.length, messages: rows });
  }

  // POST /sim/reset?run_id=X — wipe one run's captured messages
  if (request.method === "POST" && url.pathname === "/sim/reset") {
    const runId = url.searchParams.get("run_id");
    if (!runId) return json({ error: "missing run_id" }, 400);
    const deleted = await resetOutboundRun(env, runId);
    return json({ run_id: runId, deleted });
  }

  // POST /sim/purge  (dry-run)
  // POST /sim/purge?confirm=1  (actually deletes)
  if (request.method === "POST" && url.pathname === "/sim/purge") {
    const confirm = url.searchParams.get("confirm") === "1";
    try {
      const report = await purgeSimulationData(env, { confirm });
      return json({ ok: true, ...report });
    } catch (e) {
      return json({ error: (e as Error)?.message ?? "purge failed" }, 500);
    }
  }

  // POST /sim/trigger?job=<name> — run a scheduled job right now
  if (request.method === "POST" && url.pathname === "/sim/trigger") {
    const job = url.searchParams.get("job");
    if (!job) return json({ error: "missing job" }, 400);
    try {
      const result = await runSimJob(env, job);
      return json({ ok: true, job, result });
    } catch (e) {
      return json({ error: (e as Error)?.message ?? "trigger failed", job }, 500);
    }
  }

  // GET /sim/guard — dry-run the Odoo guard (call before flipping sim on)
  if (request.method === "GET" && url.pathname === "/sim/guard") {
    const g = await guardSimulationOdoo(env);
    return json(g, g.ok ? 200 : 409);
  }

  return null;
}

async function runSimJob(rawEnv: Env, job: string): Promise<unknown> {
  // 2026-09-23 — same idempotency keys as the cron that runs this job, so
  // a manual trigger after the cron (or vice versa) cannot double-send.
  const { withAutoSendJob } = await import("./auto-send-guard");
  const env = withAutoSendJob(rawEnv, job);
  switch (job) {
    case "ask_suppliers":
      await askAllSuppliersForPrices(env);
      return "askAllSuppliersForPrices done";
    case "reliability_scores":
      await updateSupplierReliabilityScores(env);
      return "updateSupplierReliabilityScores done";
    case "open_ordering":
      await openOrderingWindow(env);
      return "openOrderingWindow done";
    case "cutoff_reminder":
      return await sendCutoffReminders(env);
    case "close_unconfirmed":
      await closeUnconfirmedOrders(env);
      return "closeUnconfirmedOrders done";
    case "purchase_followup":
      return await followUpUnconfirmedPurchaseLists(env);
    case "aggregate_purchase":
      await aggregateAndDispatchToWarehouse(env);
      return "aggregateAndDispatchToWarehouse done";
    case "collection_summary": {
      const { sendDailyCollectionSummary } = await import("./invoice");
      await sendDailyCollectionSummary(env);
      return "sendDailyCollectionSummary done";
    }
    case "standing_reminders": {
      const { sendStandingOrderReminders } = await import("./standing");
      const r = await sendStandingOrderReminders(env);
      return r;
    }
    case "daily_outreach": {
      const { runDailyOutreach } = await import("./outreach");
      return runDailyOutreach(env);
    }
    default:
      throw new Error(
        `unknown job '${job}'. valid: ask_suppliers | reliability_scores | open_ordering | purchase_followup | cutoff_reminder | close_unconfirmed | aggregate_purchase | collection_summary | standing_reminders | daily_outreach`,
      );
  }
}

// 2026-09-17 — flush deferred sendLocation messages queued in KV by
// sendDriverRoute under `pending_loc:<driver_phone>` (20h TTL). The team
// branch calls this on the driver's first inbound; a corrupt payload is
// dropped after logging so a bad row cannot brick the driver's flow.
async function flushPendingLocations(env: Env, to: string, key: string): Promise<void> {
  const raw = await env.MSG_DEDUP.get(key);
  if (!raw) return;
  let locs: Array<{ latitude?: number; longitude?: number; name?: string; address?: string; text?: string }> = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) locs = parsed;
  } catch (e) {
    console.warn("[pending_loc] parse failed", (e as Error)?.message);
    await env.MSG_DEDUP.delete(key);
    return;
  }
  for (const l of locs) {
    // 2026-09-24 (م11) — delivery-note texts are queued here too, in stop order.
    if (typeof l?.text === "string" && l.text) {
      try {
        await sendText(env, to, l.text);
      } catch (e) {
        console.warn("[pending_loc] sendText failed", (e as Error)?.message);
      }
      continue;
    }
    if (typeof l?.latitude !== "number" || typeof l?.longitude !== "number") continue;
    try {
      await sendLocation(env, to, l.latitude, l.longitude, l.name, l.address);
    } catch (e) {
      console.warn("[pending_loc] sendLocation failed", (e as Error)?.message);
    }
  }
  await env.MSG_DEDUP.delete(key);
}

async function handleWebhook(env: Env, payload: unknown, ctx?: ExecutionContext): Promise<void> {
  // Item 2 (2026-09-17) — Meta delivery-status callbacks land here alongside
  // messages. When present, correlate each status update to the matching
  // x_wa_message by wamid and bump its x_status. Best-effort; a failure never
  // interrupts inbound-message processing.
  //
  // 2026-09-20 (cover) — when Meta reports a failed status, also mirror the
  // failure into the recipient's Discuss channel as ⚠️ ما انرسلت — Baraa
  // sees the same "channel is out" cue for late-arriving failures as for
  // immediate ones. Non-failed states stay silent (they'd double the
  // channel's noise) but still stamp x_status on x_wa_message.
  try {
    const { updateWaStatusByWamid } = await import("./wa-message-send");
    const { phoneTail } = await import("./wa-inbox");
    // deno-lint-ignore no-explicit-any
    const entries: any[] = (payload as any)?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const statuses: unknown[] = value?.statuses ?? [];
        // deno-lint-ignore no-explicit-any
        for (const s of statuses as any[]) {
          const wamid: string | undefined = s?.id;
          const rawStatus: string | undefined = s?.status;
          if (!wamid || !rawStatus) continue;
          const s2 =
            rawStatus === "sent" || rawStatus === "delivered" ||
            rawStatus === "read" || rawStatus === "failed"
              ? rawStatus
              : null;
          if (!s2) continue;
          const errMsg = s?.errors?.[0]?.message
            ? `Meta ${s.errors[0].code ?? ""}: ${s.errors[0].message}`
            : undefined;
          const to = s?.recipient_id ?? "";
          console.log(
            `[inbox] wamid=${wamid.slice(-10)} from=${phoneTail(String(to))} kind=status status=${s2}`,
          );
          const row = await updateWaStatusByWamid(env, wamid, s2, errMsg);
          if (s2 === "failed") {
            // 2026-09-24 (ح6) — a late failure (e.g. 131047: free-form text
            // outside the 24h window) is a failure, not a success: counter +
            // owner alert on the first failure of this template today.
            try {
              const { recordSendFailure, templateFromEcho } = await import("./send-failure");
              await recordSendFailure(env, {
                to: String(to),
                what: templateFromEcho(row?.body) ?? (row?.body?.startsWith("📍") ? "location" : "text"),
                code: s?.errors?.[0]?.code ?? null,
                message: s?.errors?.[0]?.message ?? s?.errors?.[0]?.title ?? "failed status",
                phase: "async",
                hasRow: !!row,
                wamid,
              });
            } catch (e) {
              console.warn("[status-failed record]", (e as Error)?.message);
            }
          }
          if (s2 === "failed" && to) {
            try {
              const { findCustomerByWhatsApp, findSupplierByWhatsApp, findTeamMemberByWhatsApp } =
                await import("./odoo");
              const digits = String(to).replace(/[^0-9]/g, "");
              const e164 = digits.startsWith("+") ? digits : `+${digits}`;
              const [t, sup, cus] = await Promise.all([
                findTeamMemberByWhatsApp(env, e164).catch(() => null),
                findSupplierByWhatsApp(env, e164).catch(() => null),
                findCustomerByWhatsApp(env, e164).catch(() => null),
              ]);
              const partner = t ?? sup ?? cus;
              if (partner) {
                const { echoFailure } = await import("./wa-inbox");
                await echoFailure(env, partner.id, partner.name, errMsg ?? "Meta failed");
              }
            } catch (e) {
              console.warn("[status-failed mirror]", (e as Error)?.message);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[status-callback] failed", (e as Error)?.message);
  }

  const messages = parseWebhook(payload);

  for (const msg of messages) {
    // 2026-09-20 (inbox) — the type filter used to short-circuit ALL non-bot
    // types (image, audio, video, document, sticker) before the dedup check.
    // We now still gate the bot on those types below, but the inbox mirror
    // block that follows works on every wamid, so dedup must happen first
    // to survive Meta retries. `bot_types` mirrors the original filter.
    if (!msg.messageId) continue;
    const botTypes =
      msg.type === "text" || msg.type === "interactive" ||
      msg.type === "button" || msg.type === "location";
    const hasBotContent = Boolean(msg.text || msg.buttonId || msg.location);
    const hasMedia = Boolean(msg.media?.id);
    if (!botTypes && !hasMedia) continue;
    if (botTypes && !hasBotContent && !hasMedia) continue;

    if (await seenBefore(env, msg.messageId)) {
      const { phoneTail } = await import("./wa-inbox");
      console.log(
        `[inbox] wamid=${msg.messageId.slice(-10)} from=${phoneTail(msg.from)} kind=message dedup=hit skip=already-seen`,
      );
      continue;
    }
    // 2026-09-23 — claim the wamid NOW, not after the reply. Processing can
    // take tens of seconds (Claude + Odoo); a Meta retry landing in that
    // window used to pass seenBefore and produce a second auto-reply. The
    // per-branch markSeen calls below stay (idempotent re-put).
    await markSeen(env, msg.messageId);

    // 2026-09-20 (cover) — single funnel for every inbound. Ingests BEFORE
    // any team/supplier/customer bot routing so a failure in one of those
    // branches can never make the message disappear from x_wa_message or
    // from Baraa's Discuss channel. `ingestInbound`:
    //   • resolves partner in priority team → supplier → customer → new,
    //     falling back to findOrCreateCustomer for a brand-new number,
    //   • writes x_wa_message with x_source='inbound' and status='received',
    //   • mirrors the message into the partner's Discuss channel as the
    //     contact (not the bot), and
    //   • returns a small IngestResult the [inbox] log line prints so
    //     `wrangler tail` shows exactly what happened to every wamid.
    //
    // Team, supplier and customer matches are also passed through to the
    // bot routing below so we do not re-run the same Odoo lookups a
    // second time on the hot path.
    let ingestRoute: "team" | "supplier" | "customer" | "new" | "owner" = "new";
    let teamMatch: Awaited<ReturnType<typeof findTeamMemberByWhatsApp>> | null = null;
    let supplierMatch: Awaited<ReturnType<typeof findSupplierByWhatsApp>> | null = null;
    let customerMatchForRoute: OdooPartner | null = null;
    try {
      const {
        findCustomerByWhatsApp,
        findSupplierByWhatsApp: fs,
        findTeamMemberByWhatsApp: ft,
      } = await import("./odoo");
      const [t, sup, cus] = await Promise.all([
        ft(env, msg.from).catch(() => null),
        fs(env, msg.from).catch(() => null),
        findCustomerByWhatsApp(env, msg.from).catch(() => null),
      ]);
      teamMatch = t;
      supplierMatch = sup;
      customerMatchForRoute = cus;

      const { ingestInbound, phoneTail } = await import("./wa-inbox");
      const ingest = await ingestInbound(
        env,
        {
          partnerId: 0, // placeholder — ingestInbound sets its own from lookups
          partnerName: "",
          wamid: msg.messageId,
          type: msg.type,
          text: msg.text || undefined,
          location: msg.location,
          media: msg.media,
          from: msg.from,
          profileName: msg.profileName,
          // 2026-09-20 (fix) — Meta's own timestamp (unix seconds as string)
          // for the 24h-window source of truth; see parseMetaTimestampMs in
          // wa-inbox.ts.
          metaTimestamp: msg.timestamp,
        },
        {
          team: t ? { id: t.id, name: t.name } : null,
          supplier: sup ? { id: sup.id, name: sup.name } : null,
          customer: cus ? { id: cus.id, name: cus.name } : null,
        },
      );
      ingestRoute = ingest.route;

      // Single console line every inbound produces, regardless of route.
      const skipOrOk = ingest.mirrored
        ? "ok"
        : ingest.route === "owner"
          ? "skip:owner"
          : `${ingest.skip ? "fail:" + ingest.skip : "skip:unknown"}`;
      console.log(
        `[inbox] wamid=${msg.messageId.slice(-10)} from=${phoneTail(msg.from)} kind=message partner=${ingest.partnerId ?? "-"} route=${ingest.route} mirror=${skipOrOk}`,
      );

      // 2026-09-20 — the unallowed-inbound alert still fires only for
      // strangers (no team, no supplier match). We keep the 24h KV throttle
      // and use the same partner name from the customer match if present.
      if (!sup && !t) {
        const { isRecipientAllowed } = await import("./config");
        const { isPartnerWaAllowed } = await import("./odoo");
        const allowlistOK = isRecipientAllowed(env, msg.from);
        const partnerOK = allowlistOK ? true : await isPartnerWaAllowed(env, msg.from);
        if (!allowlistOK && !partnerOK) {
          const dedupKey = `wa_unallowed_alert:${msg.from}`;
          const already = await env.MSG_DEDUP.get(dedupKey);
          if (!already) {
            const who = cus?.name || msg.profileName || msg.from;
            const { sendOwnerAlert } = await import("./templates");
            try {
              await sendOwnerAlert(
                env,
                `رقم جديد راسل: ${who} (${msg.from}) — فعّل واتساب أو رد يدوياً`,
              );
            } catch (e) {
              console.warn("[wa_unallowed alert send]", (e as Error)?.message);
            }
            try {
              await env.MSG_DEDUP.put(dedupKey, "1", { expirationTtl: 24 * 60 * 60 });
            } catch (e) {
              console.warn("[wa_unallowed KV write]", (e as Error)?.message);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[inbound-log] skipped", (e as Error)?.message);
    }

    // 2026-09-20 (inbox) — bot routing runs only on text / button / location.
    // Media messages are mirrored above and terminate here (with markSeen so
    // Meta retries stay dedup'd).
    if (!botTypes || (!hasBotContent && hasMedia)) {
      // 2026-09-24 (ح5) — a customer's voice note / image / video / document
      // used to stop here with no reply and no alert. Now: an honest reply
      // (the message reached the team, no speech-to-text) and an immediate
      // owner alert. Team, supplier and owner media keep the old behaviour.
      if (!teamMatch && !supplierMatch && ingestRoute !== "owner" && !isOwnerNumber(env, msg.from)) {
        try {
          await handleCustomerMedia(env, msg, customerMatchForRoute, ctx);
        } catch (e) {
          console.warn("[media] customer handling failed", (e as Error)?.message);
        }
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-20 (cover) — reuse the team/supplier matches ingestInbound
    // already resolved. Ordering: team → supplier → customer (a team
    // member who also has customer_rank must not fall into the customer
    // path). ingestRoute='owner' short-circuits below via the OWNER guard.
    const teamMember = teamMatch;
    if (teamMember) {
      // 2026-09-17 — deferred delivery locations. sendDriverRoute stashes
      // per-stop location messages in KV instead of sending them behind
      // an unopened 24-hour window; the driver's first inbound flushes
      // them. Two shapes:
      //   • "shift_start" button reply → text confirmation THEN locations
      //   • anything else from the driver → locations first, then the
      //     regular team handler continues.
      const pendingLocKey = `pending_loc:${msg.from}`;
      // 2026-09-24 — template quick replies arrive as type "button", session
      // buttons as type "interactive". Both are button taps (the team branch
      // used to ignore the template ones: «تم الشراء» and «بدء الدوام» from
      // a template did nothing).
      const isButton = (msg.type === "interactive" || msg.type === "button") && !!msg.buttonId;
      const isShiftStart = isButton && msg.buttonId === "shift_start";
      if (isShiftStart) {
        try {
          await sendText(
            env,
            msg.from,
            "تم بدء الدوام ✅ هذي مواقع توصيلات اليوم",
            { ctx },
          );
          await flushPendingLocations(env, msg.from, pendingLocKey);
        } catch (e) {
          console.warn("[shift_start] flush failed", (e as Error)?.message);
        }
        await markSeen(env, msg.messageId);
        continue;
      }
      await flushPendingLocations(env, msg.from, pendingLocKey);

      if (isButton) {
        const reply: RouterReply = await dispatch(env, {
          msg, intent: "other", senderType: "customer",
          partner: { id: teamMember.id, name: teamMember.name, x_whatsapp_number: teamMember.x_whatsapp_number },
        });
        await sendReply(env, msg.from, reply, ctx);
      } else if (msg.type === "text") {
        const pendingKey = `pending_issue:${teamMember.id}`;
        const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);
        // 2026-09-24 (ح7) — the text after «مشكلة» on the purchase list.
        const purchaseIssueKey = `pending_purchase_issue:${teamMember.id}`;
        const pendingListId = await env.MSG_DEDUP.get(purchaseIssueKey);
        if (pendingListId) {
          const listId = Number(pendingListId);
          await env.MSG_DEDUP.delete(purchaseIssueKey);
          try {
            const { appendPurchaseListNote } = await import("./odoo");
            await appendPurchaseListNote(env, listId, `${teamMember.name}: ${msg.text}`);
          } catch (e) {
            console.warn("[purchase_issue] note write failed", (e as Error)?.message);
          }
          const { sendOwnerAlert } = await import("./templates");
          await sendOwnerAlert(env,
            `⚠️ مشكلة في قائمة الشراء #${listId}\nمن: ${teamMember.name}\nالمشكلة: ${msg.text}`);
          await sendText(env, msg.from, "وصلت المشكلة لبراء وسُجّلت على قائمة الشراء ✅ بيتواصل معك.", { ctx });
        } else if (pendingOrderId) {
          const orderId = Number(pendingOrderId);
          await markStopIssue(env, orderId, msg.text);
          await env.MSG_DEDUP.delete(pendingKey);
          {
            const { sendOwnerAlert } = await import("./templates");
            await sendOwnerAlert(env,
              `⚠️ مشكلة توصيل\nسواق: ${teamMember.name}\nطلب: #${orderId}\nالمشكلة: ${msg.text}`);
          }
          await sendText(env, msg.from, "تم تسجيل المشكلة، براء بيراجعها 🙏", { ctx });
        } else {
          // ح1 — the purchase-list template carries a one-line (possibly cut)
          // list; any message from the warehouse gets the full open list(s).
          let sent = 0;
          if (teamMember.x_role === "warehouse" || teamMember.x_role_codes?.includes("warehouse") || (await isWarehouse(env, teamMember.id))) {
            sent = await resendOpenPurchaseLists(env, msg.from).catch(() => 0);
          }
          if (sent === 0) {
            await sendText(env, msg.from, `مرحبا ${teamMember.name} 👋 استخدم الأزرار عشان نأكد الحالة.`, { ctx });
          }
        }
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-20 (cover) — supplier path moved AFTER team so a partner
    // that carries both roles gets the team behaviour first (Omar carries
    // driver + warehouse + collector on partner 9 and must never fall
    // into the supplier ask/reply pipeline).
    const supplier = supplierMatch;
    if (supplier) {
      const enriched = await enrichSupplier(env, supplier);
      const replyText = await handleSupplierReply(env, enriched, msg.text, msg.messageId);
      if (replyText) await sendText(env, msg.from, replyText, { ctx });
      await markSeen(env, msg.messageId);
      continue;
    }

    // ---- owner-guard (inbound) ----
    // A message from OWNER_WHATSAPP is never a customer conversation:
    // no findOrCreateCustomer, no welcome template, no order creation.
    // If the sender is a registered supplier or team member the earlier
    // branches already handled it; anything reaching here from the owner
    // is a manager reaching out on the customer number by mistake or for
    // testing — log the fact and ignore.
    if (env.OWNER_WHATSAPP) {
      const ownerDigits = env.OWNER_WHATSAPP.replace(/[^0-9]/g, "");
      const fromDigits = msg.from.replace(/[^0-9]/g, "");
      if (ownerDigits && ownerDigits === fromDigits) {
        console.log(
          `[owner-guard] inbound skip from=${msg.from} type=${msg.type}`,
        );
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // 2026-09-20 (cover) — ingestInbound already ran findCustomerByWhatsApp,
    // so reuse its match rather than re-hit Odoo.
    const existing = customerMatchForRoute;
    // 2026-09-24 (م3) — «إيقاف» / «تشغيل» as the whole message is the
    // marketing opt-out: no welcome, no classifier.
    const { parseOptoutCommand } = await import("./optout");
    const optoutCmd = msg.type === "text" ? parseOptoutCommand(msg.text) : null;
    if (!existing && msg.type === "text" && !optoutCmd) {
      try {
        const { sendTemplateByPurpose, T, welcomeParams } = await import("./templates");
        await sendTemplateByPurpose(env, msg.from, T.CUSTOMER_WELCOME,
          (name) => welcomeParams(name, msg.profileName || "صديقنا"));
      } catch (e) { console.warn("[welcome] send failed", (e as Error).message); }
    }
    const partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
    const senderType: SenderType = "customer";

    if (optoutCmd) {
      const { handleOptoutCommand } = await import("./optout");
      const reply = await handleOptoutCommand(env, partner, msg.text);
      if (reply) await sendText(env, msg.from, reply, { ctx });
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-24 (م2) — «حولت» / «دفعت» within 48h of a payment reminder
    // reaches the owner and the collectors instead of the classifier.
    if (msg.type === "text") {
      const { isPaymentClaim, readPayRemindSent, notifyPaymentClaim, PAY_CLAIM_REPLY } = await import("./pay-claim");
      const reminded = isPaymentClaim(msg.text) ? await readPayRemindSent(env, partner.id) : null;
      if (reminded) {
        await sendText(env, msg.from, PAY_CLAIM_REPLY, { ctx });
        await notifyPaymentClaim(env, partner, reminded, `«${msg.text}»`);
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // 2026-09-24 (ح3) — the customer answered the 20:00 utak_order_update
    // template (sent outside the 24h window). Their reply opened the window,
    // so the confirm button can go out now.
    if (msg.type === "text") {
      const promptKey = `cutoff_prompt:${partner.id}`;
      const promptOrder = await env.MSG_DEDUP.get(promptKey).catch(() => null);
      if (promptOrder) {
        await env.MSG_DEDUP.delete(promptKey);
        const { getOrderBrief } = await import("./odoo");
        const o = await getOrderBrief(env, Number(promptOrder));
        if (o && (o.state === "draft" || o.state === "waiting_confirmation")) {
          await sendButtons(env, msg.from, `طلبك رقم #${o.id} بانتظار تأكيدك، ويُلغى تلقائياً الساعة 9:00 مساءً لو ما تأكد 👇`, [
            { id: `confirm_order_${o.id}`, title: "تأكيد الطلب ✅" },
            { id: `cancel_order_${o.id}`, title: "إلغاء ❌" },
          ], { ctx });
          await markSeen(env, msg.messageId);
          continue;
        }
      }
    }

    const pendingKey = `pending_neighborhood:${partner.id}`;
    const pendingRaw = await env.MSG_DEDUP.get(pendingKey);
    // «loc:<orderId>» = an already-confirmed order only needs its location
    // (ح2 late order, ح3 confirm of a draft); no quotation follows.
    const locOnly = typeof pendingRaw === "string" && pendingRaw.startsWith("loc:");
    const pendingOrderId = locOnly ? pendingRaw!.slice(4) : pendingRaw;

    if (pendingOrderId && locOnly && (msg.type === "location" || msg.type === "text")) {
      const orderId = Number(pendingOrderId);
      if (msg.type === "location" && msg.location) {
        const { latitude, longitude, name, address } = msg.location;
        const neigh = (name ?? address ?? "").trim().slice(0, 60);
        await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
        await setOrderLocation(env, orderId, latitude, longitude, neigh);
        await env.MSG_DEDUP.delete(pendingKey);
        await sendText(env, msg.from, `حفظنا موقع التوصيل لطلبك رقم #${orderId} ✅`, { ctx });
        await markSeen(env, msg.messageId);
        continue;
      }
      const neigh = msg.text.trim();
      if (neigh.length >= 2 && neigh.length <= 60) {
        await savePartnerNeighborhood(env, partner.id, neigh);
        await setOrderNeighborhood(env, orderId, neigh);
        await env.MSG_DEDUP.delete(pendingKey);
        await sendText(env, msg.from, `حفظنا الحي: ${neigh} ✅ لطلبك رقم #${orderId}.`, { ctx });
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    if (pendingOrderId && !locOnly) {
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
        await sendReply(env, msg.from, reply, ctx);
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
            `حفظنا الحي: ${neigh} ✅\nلو تقدر ترسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي) بيوصلك السائق أدق مرة جاية 🌿`,
            { ctx });
          const reply: RouterReply = await dispatch(env, {
            msg: { ...msg, text: "خلاص" },
            intent: "request_quotation",
            senderType, partner,
          });
          await sendReply(env, msg.from, reply, ctx);
          await markSeen(env, msg.messageId);
          continue;
        }
        await sendText(env, msg.from,
          "أرسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي)، أو اكتب اسم الحي فقط 🙏",
          { ctx });
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    if (msg.type === "location" && msg.location) {
      const { latitude, longitude, name, address } = msg.location;
      const neigh = (name ?? address ?? "").trim().slice(0, 60);
      await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
      await sendText(env, msg.from, "حفظنا موقعك للتوصيل ✅ طلباتك الجاية بيوصلك السائق مباشرة.", { ctx });
      await markSeen(env, msg.messageId);
      continue;
    }

    let intent: import("./types").Intent = "other";
    if (msg.type === "text") {
      const c = await classifyIntent(env, msg.text, senderType);
      intent = c.intent;
    }

    const reply: RouterReply = await dispatch(env, { msg, intent, senderType, partner });

    await sendReply(env, msg.from, reply, ctx);
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

async function sendReply(
  env: Env,
  to: string,
  reply: RouterReply,
  ctx?: ExecutionContext,
): Promise<void> {
  if (reply.buttons && reply.buttons.length > 0) {
    const body = reply.bodyBeforeButtons ?? reply.text ?? "";
    await sendButtons(env, to, body, reply.buttons, { ctx });
    return;
  }
  if (reply.text && reply.text.trim()) {
    await sendText(env, to, reply.text, { ctx });
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

// item3 (2026-09-17) — Uint8Array → base64 (chunked so a large PDF does not
// exceed the argument limit of String.fromCharCode.apply on some runtimes).
function arrayBufferToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(bin);
}

function isOwnerNumber(env: Env, from: string): boolean {
  const o = String(env.OWNER_WHATSAPP ?? "").replace(/[^0-9]/g, "");
  return o.length > 0 && String(from ?? "").replace(/[^0-9]/g, "") === o;
}

async function isWarehouse(env: Env, partnerId: number): Promise<boolean> {
  try {
    const { getTeamMembersByRole } = await import("./odoo");
    const wh = await getTeamMembersByRole(env, "warehouse");
    return wh.some((w) => w.id === partnerId);
  } catch {
    return false;
  }
}

// 2026-09-24 (ح5) — customer media: reply + immediate owner alert (قرار براء:
// no speech-to-text in this phase, no batching, no delay). Stickers are not a
// message to follow up and are left alone.
const MEDIA_LABEL: Readonly<Record<string, string>> = {
  audio: "رسالة صوتية",
  image: "صورة",
  video: "فيديو",
  document: "مستند",
};

export async function handleCustomerMedia(
  env: Env,
  msg: import("./types").NormalizedMessage,
  customer: OdooPartner | null,
  ctx?: ExecutionContext,
): Promise<boolean> {
  const label = MEDIA_LABEL[msg.type];
  if (!label) return false;
  const kind = msg.type === "audio" && msg.media?.voice ? "رسالة صوتية" : label;
  // 2026-09-24 (م2) — an image / document within 48h of a payment reminder
  // is most likely the transfer receipt: it goes to the owner and collectors.
  if (customer && (msg.type === "image" || msg.type === "document")) {
    const { readPayRemindSent, notifyPaymentClaim, PAY_RECEIPT_REPLY } = await import("./pay-claim");
    const reminded = await readPayRemindSent(env, customer.id);
    if (reminded) {
      await sendText(env, msg.from, PAY_RECEIPT_REPLY, { ctx });
      const caption = msg.media?.caption ? ` — التعليق: ${msg.media.caption.slice(0, 120)}` : "";
      await notifyPaymentClaim(env, customer, reminded, `${kind} (غالباً إيصال التحويل، في محادثته في Discuss)${caption}`);
      return true;
    }
  }
  await sendText(
    env,
    msg.from,
    `وصلتنا ${kind} ✅ الفريق بيتابعها ويرد عليك قريب. ولو هي طلب، تقدر تكتب الأصناف والكميات نصاً عشان تتسجل مباشرة 🌿`,
    { ctx },
  );
  const { sendOwnerAlert } = await import("./templates");
  const who = customer?.name || msg.profileName || "عميل جديد";
  const caption = msg.media?.caption ? ` — التعليق: ${msg.media.caption.slice(0, 200)}` : "";
  await sendOwnerAlert(
    env,
    `${msg.type === "audio" ? "🎤" : "📎"} ${kind} من عميل: ${who} (${msg.from})${caption}. رددنا عليه بأنها وصلت وسيتابعها الفريق؛ افتح محادثته في Discuss.`,
  );
  return true;
}
