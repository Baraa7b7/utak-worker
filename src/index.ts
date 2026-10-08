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
import { handleVerify, verifySignature, parseWebhook, sendText, sendButtons } from "./meta";
import { seenBefore, markSeen } from "./dedup";
import { PLACE_TODAY } from "./places";
import {
  ensureLocationFields,
  findOrCreateCustomer,
  findSupplierByWhatsApp,
  findTeamMemberByWhatsApp,
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
  alertSuppliersWithoutPrices,
  askAllSuppliersForPrices,
  handleSupplierButton,
  handleSupplierMedia,
  handleSupplierReply,
  nudgeLateSuppliers,
  openOrderingWindow,
  supplierButtonAction,
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
import { parseAllowlist, runtimeMode, isSimRun } from "./config";
import { isQuotationTrigger } from "./hours";
import { deliverCommandOrderId } from "./order-flow";
import {
  classifySignatureFailure,
  handleSignatureFailure,
  readRecentSignatureFailures,
} from "./webhook-alert";
import { isOwnerActPath, withOwnerAct } from "./freeze";
import { hookTokenOk, isHookGated } from "./hook-auth";
import { REASK_PAYLOAD } from "./owner-team";

/** The two ticks (wrangler.toml): the attendance one and the driver's, two minutes after it. */
const TICK_CRON = "*/5 * * * *";
const TICK2_CRON = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";

export default {
  async scheduled(event: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    console.log(`[scheduled] cron=${cron} at ${new Date().toISOString()}`);
    // 2026-09-23 — every send made inside a cron job is automated: mark env
    // so the send gateway claims a per-(recipient, template, Riyadh day, job)
    // KV key before sending. See src/auto-send-guard.ts.
    const { CRON_JOB, withAutoSendJob } = await import("./auto-send-guard");
    const env = withAutoSendJob(rawEnv, CRON_JOB[cron] ?? `cron:${cron}`);
    // § 67 — the two ticks' upkeep, whatever the switch says: a message Meta refused for a passing reason
    // goes again when its spacing is due, and a window of merged alerts that ended sends its one message.
    // Then the freeze: its own tick on */5 (the switch read fresh, «حتى تاريخ», the «مجمّد» rows), and a
    // cron the freeze stops does not run at all.
    let frozen = false;
    try {
      const now = Date.now();
      const fz = await import("./freeze");
      if (cron === TICK_CRON) {
        const ft = await fz.runFreezeTick(rawEnv, now);
        frozen = ft.on;
        if (ft.action === "ended" || ft.noted?.length) console.log("[freeze tick]", JSON.stringify(ft));
      } else {
        frozen = (await fz.freezeView(rawEnv, now, { fresh: true })).on;
      }
      if (cron === TICK_CRON || cron === TICK2_CRON) {
        const { runRetryQueue } = await import("./wa-gateway");
        await runRetryQueue(rawEnv, now, ctx);
        const { flushOwnerAlerts } = await import("./owner-alerts");
        const fl = await flushOwnerAlerts(rawEnv, now);
        if (fl.merged || fl.summaries) console.log("[owner-alerts flush]", JSON.stringify(fl));
      }
      if (frozen && fz.FROZEN_CRONS.has(cron)) {
        console.log(`[scheduled] cron=${cron} frozen — skipped (🧊 وضع التجميد)`);
        return;
      }
    } catch (e) {
      console.error("[freeze] the gate or the upkeep failed", (e as Error)?.message);
    }
    try {
      switch (cron) {
        case "0 23 * * *": await askAllSuppliersForPrices(env); break;
        case "0 2 * * *":
          // § 67 أ — frozen: no reliability score moves and no reminder goes; the template sync stays
          if (!frozen) {
          await updateSupplierReliabilityScores(env);
          // 2026-09-25 (م5) — one reminder to a supplier still silent 3h after the ask.
          try {
            await nudgeLateSuppliers(env);
          } catch (e) {
            console.error("[cron 05:00] supplier nudge failed", (e as Error)?.message);
          }
          }
          // Phase 1 (2026-09-17): daily template sync appended to the 05:00
          // Riyadh handler after its existing work, in try/catch so a sync
          // failure never breaks reliability-score scheduling.
          // § 41 و — a simulation run never reads Meta (nor writes the real
          // x_wa_control status with a refused sync).
          if (!isSimRun(env)) try {
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
        case "15 18 * * *":
          try {
            await aggregateAndDispatchToWarehouse(env);
          } finally {
            // 2026-09-25 (م5) — the purchase list is built: one owner alert per
            // supplier who still has not sent today's prices (even if the
            // list itself failed — its error still reaches the catch below).
            try {
              await alertSuppliersWithoutPrices(env);
            } catch (e) {
              console.error("[cron 21:15] supplier alert failed", (e as Error)?.message);
            }
          }
          break;
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
        // 2026-09-25 (STATUS § 29) — team attendance: whatever is due now
        // («بدء الدوام» at each shift time, the +30 reminder, +60 absence,
        // and Baraa's window-opening template at OWNER_WINDOW_OPEN_AT).
        case "*/5 * * * *": {
          // § 67 أ — frozen: no «بدء الدوام», no reminder, no «غائب» (the tick stops itself: src/attendance.ts)
          {
          const { runAttendanceTick } = await import("./attendance");
          const r = await runAttendanceTick(env);
          const acted = r.members.filter((m) => !["no_time", "before_shift", "waiting", "reminded", "frozen_missed"].includes(m.action) && !m.action.startsWith("tapped") && !m.action.startsWith("already"));
          if (acted.length || !["before", "passed", "sent_before", "frozen_missed"].includes(r.owner.action)) {
            console.log(`[attendance ${r.at}]`, JSON.stringify({ owner: r.owner.action, acted: acted.map((m) => `${m.name}:${m.action}`) }));
          }
          }
          // 2026-09-25 (STATUS § 33) — held messages past their expiry are
          // dropped and their x_wa_message rows marked «expired», even for a
          // number that never writes back.
          try {
            const { sweepExpiredHeld } = await import("./wa-gateway");
            const sw = await sweepExpiredHeld(env);
            if (sw.expired) console.log(`[gateway sweep] ${JSON.stringify(sw)}`);
          } catch (e) {
            console.error("[gateway sweep] failed", (e as Error)?.message);
          }
          // 2026-09-25 (STATUS § 36) — a Discuss line that could not be posted
          // (row x_echo_status «pending») is retried, three times at most, and
          // a row Odoo refused is created.
          try {
            const { retryPendingRecords } = await import("./wa-record");
            const rr = await retryPendingRecords(env);
            if (rr.echoed || rr.failed || rr.waiting || rr.orphans) console.log(`[record retry] ${JSON.stringify(rr)}`);
          } catch (e) {
            console.error("[record retry] failed", (e as Error)?.message);
          }
          // 2026-09-25 (STATUS § 35) — today's prices: the record follows the
          // prices received, the approval deadline, and a lost approval webhook.
          // § 67 أ — frozen: no ask, no review, no publication, no «لم تُنشر» (the tick stops itself: src/prices.ts)
          try {
            const { runPricesTick } = await import("./prices");
            const p = await runPricesTick(env, Date.now(), ctx);
            const quiet = (!p.marketAsk || ("action" in p.marketAsk && ["before", "after", "frozen_missed"].includes(p.marketAsk.action)))
              && (!p.review || ("action" in p.review && ["outside", "no_day", "no_draft", "none", "decided", "sent_before", "frozen_missed"].includes(p.review.action)))
              && (p.refresh && "action" in p.refresh && ["no_prices", "unchanged", "locked", "outside"].includes(p.refresh.action))
              && (p.deadline && "action" in p.deadline && ["before", "after_window", "claimed_before"].includes(p.deadline.action)) && !p.publish;
            if (!quiet) console.log("[prices tick]", JSON.stringify(p));
          } catch (e) {
            console.error("[prices tick] failed", (e as Error)?.message);
          }
          // 2026-09-26 (STATUS § 39 د, م10) — a customer payment whose receipt
          // webhook was lost: its receipt and its one confirmation now.
          try {
            const { runPaymentConfirmTick } = await import("./payment-confirm");
            const pc = await runPaymentConfirmTick(rawEnv, Date.now(), ctx);
            if (pc.length) console.log("[payconf tick]", JSON.stringify(pc));
          } catch (e) {
            console.error("[payconf tick] failed", (e as Error)?.message);
          }
          // § 41 هـ — 12:00: a confirmed purchase list still without its
          // purchase tax invoice → one line to Baraa that day.
          try {
            const { checkPurchaseInvoices, PINV_JOB } = await import("./purchase-invoice");
            const { withAutoSendJob } = await import("./auto-send-guard");
            const pi = await checkPurchaseInvoices(withAutoSendJob(rawEnv, PINV_JOB), Date.now());
            if (pi.action === "alerted") console.log("[pinv tick]", JSON.stringify(pi));
          } catch (e) {
            console.error("[pinv tick] failed", (e as Error)?.message);
          }
          // § 44 د — the VAT questions: 60 minutes without the step's answer (or
          // the order cancelled) end them; Baraa's one alert after the third ask.
          try {
            const { runVatAskTick } = await import("./vat-ask");
            const va = await runVatAskTick(env, Date.now());
            if (va.some((r) => r.action !== "waiting")) console.log("[vat-ask tick]", JSON.stringify(va));
          } catch (e) {
            console.error("[vat-ask tick] failed", (e as Error)?.message);
          }
          // § 42 ب — a collection left without «المبلغ كامل» / an amount: the
          // collector's one reminder at 30 minutes, Baraa's one alert 30 after it.
          try {
            const { runCollectPayTick } = await import("./collect-pay");
            const cp = await runCollectPayTick(env, Date.now());
            if (cp.some((r) => r.action !== "waiting")) console.log("[collect-pay tick]", JSON.stringify(cp));
          } catch (e) {
            console.error("[collect-pay tick] failed", (e as Error)?.message);
          }
          // § 46 ج — an invoice held at «تم التسليم» for a zero price: issued and
          // sent once the price is corrected in Odoo.
          try {
            const { runZeroInvoiceTick } = await import("./zero-price");
            const zi = await runZeroInvoiceTick(rawEnv, Date.now());
            if (zi.some((r) => r.action !== "waiting")) console.log("[zero-invoice tick]", JSON.stringify(zi));
          } catch (e) {
            console.error("[zero-invoice tick] failed", (e as Error)?.message);
          }
          // § 46 ب — a product created in Odoo: Baraa's one alert with what is
          // still missing on it (10 minutes after its creation).
          try {
            const { runProductSetupTick, PRODUCT_SETUP_JOB } = await import("./product-setup");
            const { withAutoSendJob } = await import("./auto-send-guard");
            const ps = await runProductSetupTick(withAutoSendJob(rawEnv, PRODUCT_SETUP_JOB), Date.now());
            if (ps.some((r) => r.action !== "waiting")) console.log("[product-setup tick]", JSON.stringify(ps));
          } catch (e) {
            console.error("[product-setup tick] failed", (e as Error)?.message);
          }
          // 2026-09-25 (STATUS § 37) — supplier payments: the dues of recent
          // confirmed purchase lists (a price that arrived later), and a
          // decided payment whose webhook was lost.
          try {
            const { runSupplierPayTick } = await import("./supplier-pay");
            const sp = await runSupplierPayTick(env, Date.now(), ctx);
            const busy = (Array.isArray(sp.dues) && sp.dues.some((d) => d.action === "synced")) || !Array.isArray(sp.dues)
              || (Array.isArray(sp.settled) && sp.settled.length > 0) || !Array.isArray(sp.settled);
            if (busy) console.log("[supplier-pay tick]", JSON.stringify(sp));
          } catch (e) {
            console.error("[supplier-pay tick] failed", (e as Error)?.message);
          }
          // § 61 د — the jobs: an employee who was given one (Baraa's «👤 صار …» and the employee's
          // welcome), and one who left his (the handover list with what the system reads).
          try {
            const { runStaffingTick, STAFFING_JOB } = await import("./staffing");
            const { withAutoSendJob } = await import("./auto-send-guard");
            const st = await runStaffingTick(withAutoSendJob(rawEnv, STAFFING_JOB), Date.now(), ctx);
            if (st.action !== "none") console.log("[staffing tick]", JSON.stringify(st));
          } catch (e) {
            console.error("[staffing tick] failed", (e as Error)?.message);
          }
          // § 62 ب — a special request's ONE reminder, three hours after its form, to a source that has
          // not answered (inside his window only). KV alone until one is due.
          try {
            const { runSpecialNudgeTick } = await import("./special-ask");
            const sn = await runSpecialNudgeTick(rawEnv, Date.now(), ctx);
            if (sn.length) console.log("[special-nudge tick]", JSON.stringify(sn));
          } catch (e) {
            console.error("[special-nudge tick] failed", (e as Error)?.message);
          }
          // § 66 ج — a large special order: «🚚 طلب كبير … رتّب المركبة» once, on the morning of its delivery
          // (from 02:00). KV alone until a day has one.
          try {
            const { runLargeOrderMorning } = await import("./special-accept");
            const lg = await runLargeOrderMorning(rawEnv, Date.now());
            if (lg.length) console.log("[large-order tick]", JSON.stringify(lg));
          } catch (e) {
            console.error("[large-order tick] failed", (e as Error)?.message);
          }
          // § 65 هـ — the approved suppliers' periodic check-in (OFF unless «تفعيل تواصل الموردين» is on;
          // 09:00–18:00, on a Sunday or the first of the month), and their cards' numbers once a day.
          try {
            const { runSupplierOutreachTick, runSupplierIndicatorsTick, OUTREACH_JOB } = await import("./supplier-outreach");
            const { withAutoSendJob } = await import("./auto-send-guard");
            const so = await runSupplierOutreachTick(withAutoSendJob(rawEnv, OUTREACH_JOB), Date.now(), ctx);
            if (so.action === "ran" || so.action === "error") console.log("[supplier-outreach tick]", JSON.stringify(so));
            const si = await runSupplierIndicatorsTick(rawEnv, Date.now());
            if (si.action === "written" || si.action === "error") console.log("[supplier-indicators tick]", JSON.stringify(si));
          } catch (e) {
            console.error("[supplier-outreach tick] failed", (e as Error)?.message);
          }
          break;
        }
        // 2026-09-26 (STATUS § 38, م12) — the driver's end of shift, from his
        // working schedule: end − 30 his stops without «تم التسليم», end + 30
        // Baraa's alert (and the reason when there is no reminder).
        case "2,7,12,17,22,27,32,37,42,47,52,57 * * * *": {
          const { runDriverFollowupTick } = await import("./driver-followup");
          const r = await runDriverFollowupTick(env);
          const acted = r.drivers.flatMap((d) => d.steps.filter((s) => !/:(-|[a-z_]+:-)$/.test(s)).map((s) => `${d.name}:${s}`));
          if (acted.length) console.log(`[driver-followup ${r.at}]`, JSON.stringify(acted));
          break;
        }
        // 2026-09-26 (STATUS § 38, م17) — 21:30 Riyadh, after the 21:00 close and
        // the 21:15 purchase list: Baraa's summary of the day (once a day).
        case "30 18 * * *": {
          const { sendOwnerSummary } = await import("./owner-summary");
          const r = await sendOwnerSummary(env);
          console.log(`[owner-summary ${r.day}] ${r.action}${r.figures?.errors.length ? ` errors=${JSON.stringify(r.figures.errors)}` : ""}`);
          break;
        }
        default: console.warn(`[scheduled] unhandled cron: ${cron}`);
      }
    } catch (e) {
      console.error(`[scheduled] cron ${cron} failed`, (e as Error)?.stack ?? e);
    }
  },

  async fetch(request: Request, baseEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // § 67 أ — a request Odoo's buttons and automations make is Baraa's own act: the freeze does not stop its sends
    const env = isOwnerActPath(url.pathname) ? withOwnerAct(baseEnv, "odoo") : baseEnv;

    // § 68 أ — «does this button's URL pass?»: the token alone is checked and nothing runs (the check of the
    // 24 Odoo actions after their token is rewritten). A wrong token gets the 401 every route gives it.
    if (url.searchParams.get("probe") === "1" && isHookGated(url.pathname)) {
      if (!hookTokenOk(env, url.searchParams.get("token") ?? "")) return json({ error: "unauthorized" }, 401);
      return json({ ok: true, probe: true });
    }

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
            const result = await createAndDispatchReceiptForRecord(env, pid, ctx);
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

      // Step 4 — WhatsApp: the payment's one confirmation (STATUS § 39 د, م10),
      // with every guard of the receipt pipeline — a payment already confirmed,
      // a simulation or a held customer sends nothing here either.
      try {
        const { confirmPaymentToCustomer } = await import("./payment-confirm");
        const c = await confirmPaymentToCustomer(env, paymentId, {
          receipt: { number: built.receiptNumber, url: uploaded.publicUrl, method: built.payments[0]?.method || undefined },
        });
        steps["4_send_whatsapp"] = c.action === "sent" ? "ok" : c.action;
      } catch (e) {
        steps["4_send_whatsapp"] = `error: ${(e as Error).message}`;
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

    // § 62 د — «👁️ معاينة PDF» (src/quote-preview.ts): GET /preview/t/<one-use ticket Odoo's button made> → 302 to
    // GET /preview/doc/<kind>/<id>/<expiry>/<signature>.pdf, the worker's own short-lived link to the DRAFT.
    // Nothing is numbered, recorded or sent.
    if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
      const { handlePreview } = await import("./quote-preview");
      return handlePreview(env, url.pathname);
    }

    // § 64 — «📈 تاريخ الأسعار» (src/price-history.ts): GET /history/t/<one-use ticket Odoo's menu made> → 302 to
    // GET /history/p/<expiry>/<signature>, the worker's own short-lived link to the page (its choices in the query).
    if (request.method === "GET" && url.pathname.startsWith("/history/")) {
      const { handleHistory } = await import("./price-history");
      return handleHistory(env, url);
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
          const resp = await sendText(env, driverPhone, body, { purpose: "driver_delivery_note" });
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
      if (!hookTokenOk(env, providedToken)) {
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
      if (!hookTokenOk(env, providedToken)) {
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
      if (!hookTokenOk(env, providedToken)) {
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
              // § 62 د — the builder's own sentences («صنف بلا سعر: …», «السطر 3 بلا منتج ولا وصف …»)
              const reason = (data.problems ?? []).join(" | ") || "صنف بلا سعر";
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
                // § 62 د — a unit-price quotation has no total to state
                x_body: data.layout === "unit" ? `عرض سعر ${data.quotationNumber} — أسعار الوحدة لـ ${data.items.length} صنف` : `عرض سعر ${data.quotationNumber} — الإجمالي ${data.grandTotal} ر.س`,
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

    // § 64 (2026-10-07) — GET /internal/sale-quotation-pdf is GONE. It served the sale order's quotation to a link
    // that carried a FIXED token (the «تنزيل PDF (UTAK)» button of 2026-09-19). The button left the sale order
    // (its view is off); «👁️ معاينة PDF» took its place — a one-use ticket, then a signed link of fifteen minutes
    // (src/quote-preview.ts). Nothing else called this path: it answers 410 with no content, whatever is sent with
    // it. (/internal/invoice-pdf and /internal/purchase-order-pdf below still have their buttons, and stay.)
    if (url.pathname === SALE_PDF_GONE_PATH) {
      return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
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
      if (!hookTokenOk(env, providedToken)) {
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

    // 2026-09-25 — Odoo → Worker: a partner with an inbox channel was renamed
    // or got another number. base.automation «wa_inbox.partner_title» on
    // res.partner (name / x_whatsapp_number / phone) posts {_id, _model}, and
    // syncInboxChannelTitles — the one place these channels are named —
    // rebuilds the titles of that partner's numbers.
    if (request.method === "POST" && url.pathname === "/odoo/hook/wa-inbox-partner") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { id?: number; _id?: number; _model?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (body._model && body._model !== "res.partner") {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const partnerId = Number(body.id ?? body._id);
      if (!Number.isFinite(partnerId) || partnerId <= 0) {
        return json({ error: "invalid id / _id" }, 400);
      }
      ctx.waitUntil(
        (async () => {
          try {
            const { syncInboxChannelTitles } = await import("./wa-inbox");
            const changes = await syncInboxChannelTitles(env, { partnerId });
            console.log("[wa-inbox title hook]", JSON.stringify({
              partnerId, written: changes.filter((c) => c.written).map((c) => c.channelId),
            }));
          } catch (e) {
            console.error("[wa-inbox title hook] failed", (e as Error)?.message);
          }
        })(),
      );
      return json({ status: "accepted", partner_id: partnerId }, 202);
    }

    // 2026-09-25 (STATUS § 31) — Odoo → Worker: an employee, a working
    // schedule line or a time off changed (automations «utak.team_roster ←
    // hr.employee / resource.calendar.attendance / resource.calendar.leaves»,
    // on create / edit / delete). The cached roster is dropped; the next read
    // comes from Odoo. Nothing else happens here.
    if (request.method === "POST" && url.pathname === "/odoo/hook/team-roster") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { _model?: string; _id?: number; id?: number } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const { TEAM_ROSTER_HOOK_MODELS } = await import("./team-roster");
      if (body._model && !TEAM_ROSTER_HOOK_MODELS.includes(body._model)) {
        return json({ error: `unexpected model: ${body._model}` }, 400);
      }
      const { invalidateRoster } = await import("./team-roster");
      await invalidateRoster(env);
      console.log("[team-roster hook]", JSON.stringify({ model: body._model ?? "-", id: body._id ?? body.id ?? "-" }));
      return json({ status: "roster_dropped" }, 202);
    }

    // 2026-09-25 (STATUS § 35) — Odoo → Worker, from «💰 أسعار اليوم»:
    //   op=approved — the approval button (after its code action locked the
    //                 record as approved): publish it now;
    //   op=refresh  — «🔄 تحديث»: rebuild the day from the suppliers' prices.
    // 202 at once (Odoo's webhook waits one second); the work runs in waitUntil.
    if (request.method === "POST" && url.pathname === "/odoo/hook/prices") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { _model?: string; _id?: number; id?: number; x_date?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const id = Number(body._id ?? body.id ?? 0);
      const op = url.searchParams.get("op") ?? "";
      if (body._model && body._model !== "x_price_day") return json({ error: `unexpected model: ${body._model}` }, 400);
      if (!id || !["approved", "refresh"].includes(op)) return json({ error: "missing id or op" }, 400);
      const { publishPriceDay, refreshPriceDay } = await import("./prices");
      const task = (op === "approved"
        ? publishPriceDay(env, id, { ctx }).then((r) => console.log("[prices hook] publish", JSON.stringify(r)))
        : refreshPriceDay(env, { day: typeof body.x_date === "string" ? body.x_date : undefined, force: true }).then((r) => console.log("[prices hook] refresh", JSON.stringify(r)))
      ).catch((e) => console.error(`[prices hook] ${op} failed`, (e as Error)?.message));
      ctx.waitUntil(task);
      return json({ status: "accepted", op, id }, 202);
    }

    // 2026-09-25 (STATUS § 37) — Odoo → Worker, from «💵 دفع الموردين»:
    //   op=created — a payment was created (Baraa's own are approved at once:
    //                its balance, «رصيد دائن», the supplier's notice);
    //   op=decided — «اعتماد» / «رفض» on a pending payment (the notice, and
    //                the member's line with the decision);
    //   op=refresh — «🔄 إعادة حساب المستحقات»: the dues of the last 7 days.
    // 202 at once (Odoo's webhook waits one second); the work runs in waitUntil.
    if (request.method === "POST" && url.pathname === "/odoo/hook/supplier-pay") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { _model?: string; _id?: number; id?: number } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const id = Number(body._id ?? body.id ?? 0);
      const op = url.searchParams.get("op") ?? "";
      if (!["created", "decided", "refresh"].includes(op)) return json({ error: "missing op" }, 400);
      if (op !== "refresh" && body._model && body._model !== "x_supplier_payment") return json({ error: `unexpected model: ${body._model}` }, 400);
      if (op !== "refresh" && !id) return json({ error: "missing id" }, 400);
      const sp = await import("./supplier-pay");
      const task = (op === "refresh"
        ? sp.syncRecentDues(env, Date.now(), { force: true, daysBack: 7 }).then((r) => console.log("[supplier-pay hook] refresh", JSON.stringify(r.map((x) => [x.listId, x.action]))))
        : sp.onPaymentHook(env, id, { ctx, op: op as "created" | "decided" }).then((r) => console.log(`[supplier-pay hook] ${op}`, JSON.stringify(r)))
      ).catch((e) => console.error(`[supplier-pay hook] ${op} failed`, (e as Error)?.message));
      ctx.waitUntil(task);
      return json({ status: "accepted", op, id }, 202);
    }

    // Item 2 (2026-09-17) — Odoo → Worker: process x_wa_message.x_status='queued'.
    // Fired by the base.automation (wa_message.on_queued) via ir.actions.server
    // (wa_message.send_webhook). The full send pipeline (validate → media
    // upload → Meta send → chatter write-back) lives in handleWaMessageWebhook.
    // Async response (202 + ctx.waitUntil) so Odoo's row lock releases fast.
    if (request.method === "POST" && url.pathname === "/odoo/hook/wa") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
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
      if (!hookTokenOk(env, providedToken)) {
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

    // § 51 — the ONE trial of the price Flow: to Baraa's own number (no other
    // recipient can be named), while his 24h window is open, once a day. His
    // reply writes nothing in Odoo (src/price-flow.ts sendFlowTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/price-flow-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendFlowTest } = await import("./price-flow");
        return json({ ok: true, ...(await sendFlowTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 53 د — the ONE trial of the registration form: to Baraa's own number, while his window is
    // open, once a day. His reply writes nothing in Odoo (src/register-form.ts sendRegisterFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/register-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendRegisterFormTest } = await import("./register-form");
        return json({ ok: true, ...(await sendRegisterFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 53 ج — the ONE trial of the order form: to Baraa's own number, while his window is
    // open, once a day. His reply creates no order (src/order-form.ts sendOrderFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/order-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendOrderFormTest } = await import("./order-form");
        return json({ ok: true, ...(await sendOrderFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 54 — the ONE trial of the day's price review: to Baraa's own number, while his window is
    // open, once a day, with today's lines. Its buttons and its form write nothing in Odoo and
    // publish nothing (src/price-review.ts sendPriceReviewTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/price-review-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendPriceReviewTest } = await import("./price-review");
        return json({ ok: true, ...(await sendPriceReviewTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 55 ب — the ONE trial of the delivery and collection form: to Baraa's own number, while his
    // window is open, once a day, with the latest real order's lines (no real order yet: the latest
    // one marked as a simulation). Its reply delivers nothing, issues no invoice and records no
    // payment (src/delivery-form.ts sendDeliveryFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/delivery-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendDeliveryFormTest } = await import("./delivery-form");
        return json({ ok: true, ...(await sendDeliveryFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 55 د — the ONE trial of the purchases' receipt form: to Baraa's own number, while his window
    // is open, once a day, from the latest real purchase list. His reply writes nothing, confirms
    // nothing and downloads nothing (src/receipt-form.ts sendReceiptFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/receipt-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendReceiptFormTest } = await import("./receipt-form");
        return json({ ok: true, ...(await sendReceiptFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 55 ج — the ONE trial of the car-load form: to Baraa's own number, while his window is
    // open, once a day, the morning form over the active items. His reply keeps nothing
    // (src/car-load.ts sendCarLoadFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/carload-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendCarLoadFormTest } = await import("./car-load");
        return json({ ok: true, ...(await sendCarLoadFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 57 هـ — the ONE trial of the complaint form: to Baraa's own number, while his window is
    // open, once a day, listing the latest real delivered order (read-only), else a simulation's,
    // else a sample. His reply writes nothing and reaches nobody else
    // (src/complaint-form.ts sendComplaintFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/complaint-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendComplaintFormTest } = await import("./complaint-form");
        return json({ ok: true, ...(await sendComplaintFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 55 هـ — the ONE trial of the custody form: to Baraa's own number, while his window is
    // open, once a day, showing today's real cash collections (read-only). His reply keeps
    // nothing (src/custody-form.ts sendCustodyFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/custody-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendCustodyFormTest } = await import("./custody-form");
        return json({ ok: true, ...(await sendCustodyFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 57 و — the ONE trial of the expense form: to Baraa's own number, while his window is
    // open, once a day. His reply is answered with what would have been recorded, and writes
    // nothing in Odoo (src/expense-form.ts sendExpenseFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/expense-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendExpenseFormTest } = await import("./expense-form");
        return json({ ok: true, ...(await sendExpenseFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 57 د — the ONE trial of the transfer-notice form: to Baraa's own number, while his window
    // is open, once a day, listing the oldest real open invoices (read-only) or samples. His reply
    // writes nothing and reaches nobody else (src/transfer-form.ts sendTransferFormTest).
    // § 58 هـ — the two trials of § 58 أ to Baraa's own number («🧪 تجربة»), only while his window is
    // open, once a day each: the two buttons after an invoice (src/after-delivery.ts), and the ONE
    // message of «✅ وصل» for two invoices (src/transfer-form.ts). Nothing is written.
    if (request.method === "POST" && (url.pathname === "/odoo/hook/after-delivery-test" || url.pathname === "/odoo/hook/transfer-confirmed-test")) {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        if (url.pathname === "/odoo/hook/after-delivery-test") {
          const { sendAfterDeliveryTest } = await import("./after-delivery");
          return json({ ok: true, ...(await sendAfterDeliveryTest(env)) });
        }
        const { sendTransferConfirmedTest } = await import("./transfer-form");
        return json({ ok: true, ...(await sendTransferConfirmedTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 59 ز — the trials of § 59 to Baraa's own number («🧪 تجربة»), only while his window is open,
    // once a day each (?name=prices | form | unavailable | quotation | shift — src/s59-trials.ts).
    // Nothing is written in Odoo, and nobody else is reached.
    if (request.method === "POST" && url.pathname === "/odoo/hook/s59-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendS59Trial } = await import("./s59-trials");
        return json({ ok: true, ...(await sendS59Trial(env, url.searchParams.get("name") ?? "")) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 65 — Odoo → Worker, from «🛒 المشتريات ← 🧑‍🌾 الموردون» (src/supplier-registry.ts):
    //   op=invite  — «📨 أرسل رابط التسجيل»: the registration form to the card's number (the template
    //                outside its window, else the text for Baraa to forward);
    //   op=welcome — after «✅ اعتماد» (Odoo wrote the state and the cadence): the first «التواصل
    //                القادم» and the welcome with his type's buttons.
    // 202 at once; the work runs in waitUntil a moment later (the button's write is committed by then).
    if (request.method === "POST" && url.pathname === "/odoo/hook/supplier") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { _model?: string; _id?: number; id?: number } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const id = Number(body._id ?? body.id ?? url.searchParams.get("id") ?? 0);
      const op = url.searchParams.get("op") ?? "";
      const { isSupplierHookOp, handleSupplierHook } = await import("./supplier-registry");
      if (body._model && body._model !== "res.partner") return json({ error: `unexpected model: ${body._model}` }, 400);
      if (!(id > 0) || !isSupplierHookOp(op)) return json({ error: "missing id or op" }, 400);
      ctx.waitUntil((async () => {
        await new Promise((r) => setTimeout(r, SPECIAL_HOOK_DELAY_MS));
        try {
          console.log("[supplier hook]", JSON.stringify(await handleSupplierHook(env, id, op, ctx)));
        } catch (e) {
          console.error(`[supplier hook] ${op} ${id} failed`, (e as Error)?.message);
        }
      })());
      return json({ status: "accepted", op, id }, 202);
    }
    // § 65 — the three trials of the suppliers' registry to Baraa's own number («🧪 تجربة»), only while his
    // window is open, once a day each (?name=signup | offer | market — src/s65-trials.ts). What they write
    // is flagged «محاكاة»; nobody else is reached.
    if (request.method === "POST" && url.pathname === "/odoo/hook/s65-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendS65Trial } = await import("./s65-trials");
        return json({ ok: true, ...(await sendS65Trial(env, url.searchParams.get("name") ?? "")) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 62 — Odoo → Worker, from «💲 التسعير ← 🧾 طلبات أسعار خاصة» (src/special-quote.ts):
    //   op=recalc — a save of the request (its automation) or «🔄 احسب»: its numbers again;
    //   op=accept — «اعتمد المقترح للكل»;
    //   op=send   — «📨 أرسل طلب الأسعار»: the form to the request's sources;
    //   op=issue  — «📄 أصدر عرض السعر»: recorded, its PDF, the file to the customer;
    //   op=pdf    — «⬇️ PDF لي فقط»: the same quotation, its file to Baraa alone.
    // 202 at once (Odoo's webhook waits one second); the work runs in waitUntil, a moment later:
    // the save that fired the webhook is committed by then, so the worker reads what was saved.
    if (request.method === "POST" && url.pathname === "/odoo/hook/special-quote") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: { _model?: string; _id?: number; id?: number } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const id = Number(body._id ?? body.id ?? url.searchParams.get("id") ?? 0);
      const op = url.searchParams.get("op") ?? "";
      const { isHookOp, handleSpecialQuoteHook, QUOTE_MODEL } = await import("./special-quote");
      if (body._model && body._model !== QUOTE_MODEL) return json({ error: `unexpected model: ${body._model}` }, 400);
      if (!(id > 0) || !isHookOp(op)) return json({ error: "missing id or op" }, 400);
      ctx.waitUntil((async () => {
        await new Promise((r) => setTimeout(r, SPECIAL_HOOK_DELAY_MS));
        try {
          console.log("[special-quote hook]", JSON.stringify(await handleSpecialQuoteHook(env, id, op, ctx)));
        } catch (e) {
          console.error(`[special-quote hook] ${op} ${id} failed`, (e as Error)?.message);
        }
      })());
      return json({ status: "accepted", op, id }, 202);
    }
    // § 62 هـ — the three trials of «طلب أسعار خاص» to Baraa's own number («🧪 تجربة»), only while his
    // window is open, once a day each (?name=purchase | market | quotation, and ?id= a request —
    // src/s62-trials.ts). Nothing is written in Odoo, and no source and no customer is reached.
    if (request.method === "POST" && url.pathname === "/odoo/hook/s62-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendS62Trial } = await import("./s62-trials");
        return json({ ok: true, ...(await sendS62Trial(env, url.searchParams.get("name") ?? "", Number(url.searchParams.get("id")) || undefined)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 61 و — the three trials of the jobs to Baraa's own number («🧪 تجربة»), only while his window
    // is open, once a day each (?name=entry | welcome | exit — src/s61-trials.ts). Nothing is written
    // in Odoo, no task is moved, and nobody else is reached.
    if (request.method === "POST" && url.pathname === "/odoo/hook/s61-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendS61Trial } = await import("./s61-trials");
        return json({ ok: true, ...(await sendS61Trial(env, url.searchParams.get("name") ?? "")) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 60 هـ — the one trial of § 60 to Baraa's own number («🧪 تجربة»): the 21:30 summary with the four
    // lines of «خلاصة اليوم» and «طلبوا اليوم وما كان متوفر», in illustrative numbers that say so. Only
    // while his window is open, once a day. Nothing is written in Odoo (src/s60-trial.ts).
    if (request.method === "POST" && url.pathname === "/odoo/hook/s60-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendSummaryTrial } = await import("./s60-trial");
        return json({ ok: true, ...(await sendSummaryTrial(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    // § 67 — ONE trial alert to Baraa (after the block of `owner_alert` was lifted), and the freeze as the worker reads it
    if (request.method === "POST" && url.pathname === "/odoo/hook/s67-trial") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { runS67Trial } = await import("./s67-trial");
        return json({ ok: true, ...(await runS67Trial(env, url.searchParams.get("op") ?? "state")) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/odoo/hook/transfer-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendTransferFormTest } = await import("./transfer-form");
        return json({ ok: true, ...(await sendTransferFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
    }

    // § 57 ز — the ONE trial of the supplier's registration form: to Baraa's own number, while his
    // window is open, once a day. His reply is answered with what would have been written on a
    // supplier's card, and writes nothing in Odoo (src/supplier-vat.ts sendSupplierRegisterFormTest).
    if (request.method === "POST" && url.pathname === "/odoo/hook/supplier-register-form-test") {
      const providedToken = url.searchParams.get("token") ?? "";
      if (!hookTokenOk(env, providedToken)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const { sendSupplierRegisterFormTest } = await import("./supplier-vat");
        return json({ ok: true, ...(await sendSupplierRegisterFormTest(env)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 500);
      }
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

  // STATUS § 34 — the live «فتح المحادثة» trial, Baraa's number only (never
  // anyone else). POST /sim/opener-trial?close=1&purpose=owner_alert|owner_team_note
  // closes his 24h window in KV (as a 131047 would), then sends ONE critical
  // message through the gateway: outside the window it is held, and his
  // category's opener goes if usable. GET /sim/opener-state reads his window,
  // his queue and today's opener mark. Nothing else is touched.
  if (url.pathname === "/sim/opener-trial" || url.pathname === "/sim/opener-state") {
    const owner = String(env.OWNER_WHATSAPP ?? "");
    if (!owner) return json({ error: "no OWNER_WHATSAPP" }, 400);
    const { readWindow, markWindowClosed } = await import("./wa-window");
    const { readQueue } = await import("./wa-queue");
    const { openerDayKey } = await import("./wa-opener");
    const state = async () => ({
      window: await readWindow(env, owner),
      queue: (await readQueue(env, owner)).map((i) => ({ purpose: i.purpose, created: new Date(i.createdAt).toISOString(), expires: new Date(i.expiresAt).toISOString(), text: (i.body as { text?: { body?: string } })?.text?.body ?? i.body.type })),
      openerToday: await env.MSG_DEDUP.get(openerDayKey(owner)).catch(() => null),
    });
    if (request.method === "GET") return json(await state());
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const purpose = url.searchParams.get("purpose") === "owner_team_note" ? "owner_team_note" : "owner_alert";
    const text = url.searchParams.get("text") || "🧪 تجربة § 34: رسالة مهمة محفوظة خارج النافذة — تصلك عند ضغطتك أو رسالتك التالية.";
    const before = await state();
    if (url.searchParams.get("close") === "1") await markWindowClosed(env, owner, Date.now());
    const { sendOwnerMessage } = await import("./templates");
    const { gatewayDecision } = await import("./wa-gateway");
    const resp = await sendOwnerMessage(env, text, purpose);
    let body: unknown = null;
    try { body = resp ? await resp.clone().json() : null; } catch { body = null; }
    return json({ purpose, decision: gatewayDecision(resp), status: resp?.status ?? null, body, before, after: await state() });
  }

  // TEMPORARY 2026-09-12 — T2 isolation harness.
  // POST /sim/test-send?to=+9665...&text=...  — calls sendText() directly,
  // no Odoo, no template lookup, no handleWebhook. Returns the gateway's
  // Response status/body verbatim so a caller can assert AllowlistBlocked
  // (403) or SIM capture (200 + wamid). Remove once T2 signs off.
  if (request.method === "POST" && url.pathname === "/sim/test-send") {
    const to = url.searchParams.get("to") ?? "";
    const text = url.searchParams.get("text") ?? "T2 probe";
    if (!to) return json({ error: "missing to" }, 400);
    const { sendText } = await import("./meta");
    const resp = await sendText(env, to, text, { purpose: "sim_test" });
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
  // § 67 أ — a job the freeze stops does not run by hand either: its «مجمّد» row, once a day
  {
    const fz = await import("./freeze");
    if (fz.FROZEN_JOB_NAMES.has(job) && (await fz.freezeView(rawEnv, Date.now(), { fresh: true })).on) {
      return `frozen: ${job} skipped — ${await fz.noteFrozenRun(rawEnv, job)}`;
    }
  }
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
    case "supplier_nudge":
      return await nudgeLateSuppliers(env);
    case "supplier_noprice_alert":
      return await alertSuppliersWithoutPrices(env);
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
    case "team_attendance": {
      const { runAttendanceTick } = await import("./attendance");
      return runAttendanceTick(env);
    }
    case "driver_followup": {
      const { runDriverFollowupTick } = await import("./driver-followup");
      return runDriverFollowupTick(env);
    }
    case "owner_summary": {
      const { sendOwnerSummary } = await import("./owner-summary");
      return sendOwnerSummary(env);
    }
    default:
      throw new Error(
        `unknown job '${job}'. valid: ask_suppliers | reliability_scores | supplier_nudge | open_ordering | purchase_followup | cutoff_reminder | close_unconfirmed | aggregate_purchase | supplier_noprice_alert | collection_summary | standing_reminders | daily_outreach | team_attendance | driver_followup | owner_summary`,
      );
  }
}

// 2026-09-17 — the deferred queue (`pending_loc:<number>`) and its flush
// live in src/team-queue.ts since 2026-09-25 (flushTeamQueue).

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
  //
  // 2026-09-25 (STATUS § 37 أ) — never down: sent < failed < delivered < read
  // (src/wa-status.ts). Meta's calls arrive out of order; a lower one is not
  // written, and «failed» after delivered / read is not acted on.
  try {
    const { applyMetaStatus } = await import("./wa-status");
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
          const metaTs = Number(s?.timestamp) > 0 ? Number(s.timestamp) : null;
          console.log(
            `[inbox] wamid=${wamid.slice(-10)} from=${phoneTail(String(to))} kind=status status=${s2}`,
          );
          if (s2 === "failed") {
            // 2026-09-24 (ح6) — a late failure is a failure: row, counter,
            // owner alert, Discuss line. 2026-09-25 (STATUS § 33) — and the
            // gateway's policy: 131047 closes the number's window (a valid
            // session message goes back to its queue), 131049 stops that
            // template to that number today, anything else stops the purpose
            // to that number for 24h. A status Meta delivers twice is handled once.
            try {
              const { handleStatusFailure } = await import("./wa-gateway");
              await handleStatusFailure(env, {
                wamid,
                recipient: String(to),
                code: typeof s?.errors?.[0]?.code === "number" ? s.errors[0].code : null,
                message: s?.errors?.[0]?.message ?? s?.errors?.[0]?.title ?? "failed status",
                errText: errMsg,
                metaTs,
              });
            } catch (e) {
              console.warn("[status-failed]", (e as Error)?.message);
            }
            continue;
          }
          await applyMetaStatus(env, { wamid, status: s2, recipient: String(to), metaTs, errText: errMsg }, ctx);
        }
      }
    }
  } catch (e) {
    console.warn("[status-callback] failed", (e as Error)?.message);
  }

  const messages = parseWebhook(payload);

  for (const msg of messages) {
    // § 67 أ — a message of Baraa's own is his act: the freeze does not stop what it sends. Each message has
    // its own env (the one-pass loop shadows the function's for the whole body; `continue` leaves it).
    const actEnv = isOwnerNumber(env, msg.from) ? withOwnerAct(env, "owner") : env;
    for (const env of [actEnv]) {
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

    // 2026-09-25 (STATUS § 33) — the number's 24h window, by Meta's own
    // timestamp: a message or tap opens it; one older than 24h (a late
    // re-delivery) does not.
    let inboundWindow: import("./wa-window").WindowState | null = null;
    try {
      const { noteInbound } = await import("./wa-window");
      const { parseMetaTimestampMs } = await import("./wa-inbox");
      inboundWindow = await noteInbound(env, msg.from, parseMetaTimestampMs(msg.timestamp));
    } catch (e) {
      console.warn("[wa-window] note failed", (e as Error)?.message);
    }
    // § 62 ب — a special request's form owed to this number (his window was closed and no template
    // could go) goes now that he wrote: one KV read for a number that is owed nothing. Never throws.
    if (!msg.flow) {
      try {
        const { sendOwedSpecial } = await import("./special-ask");
        if (await sendOwedSpecial(env, msg.from, Date.now(), ctx)) console.log(`[special-ask] an owed form went to …${msg.from.slice(-4)}`);
      } catch (e) {
        console.warn("[special-ask] the owed form failed", (e as Error)?.message);
      }
    }

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
    let ingestRoute: import("./wa-inbox").InboundRoute = "new";
    let ingestPartnerId = 0;
    let ingestPartnerName = "";
    let teamMatch: Awaited<ReturnType<typeof findTeamMemberByWhatsApp>> | null = null;
    let supplierMatch: Awaited<ReturnType<typeof findSupplierByWhatsApp>> | null = null;
    let customerMatchForRoute: OdooPartner | null = null;
    // § 52 ب — an outside price source (a partner «مصدر أسعار» that is neither a
    // supplier, a customer nor the team — رائد): never a customer. No customer
    // partner is made for its number, and no welcome or customer reply reaches it.
    let sourceMatch: { id: number; name: string } | null = null;
    try {
      const {
        findCustomerByWhatsApp,
        findSupplierByWhatsApp: fs,
        findTeamMemberByWhatsApp: ft,
      } = await import("./odoo");
      const { findOutsideSource } = await import("./price-sources");
      const [t, sup, cus, src] = await Promise.all([
        ft(env, msg.from).catch(() => null),
        fs(env, msg.from).catch(() => null),
        findCustomerByWhatsApp(env, msg.from).catch(() => null),
        findOutsideSource(env, msg.from).catch(() => null),
      ]);
      teamMatch = t;
      supplierMatch = sup;
      customerMatchForRoute = cus;
      sourceMatch = !t && !sup && !cus && src ? { id: src.id, name: src.name } : null;
      // § 53 أ — a number of a price source or a supplier that the lookups did not give (a read that
      // failed, a number kept in «phone» alone, a customer partner made earlier on the same number):
      // it never enters the customer path — no customer partner, no welcome, no quotation.
      if (!t && !sup && !sourceMatch && !(await import("./wa-gateway")).isOwnerRecipient(env, msg.from)) {
        try {
          const { priceClosedNumber } = await import("./price-privacy");
          const closed = await priceClosedNumber(env, msg.from);
          if (closed) {
            console.warn(`[price-privacy] inbound from a ${closed.kind} number (#${closed.id}) that no lookup matched — kept out of the customer path`);
            sourceMatch = { id: closed.id, name: closed.name };
          }
        } catch (e) {
          console.warn("[price-privacy] the number could not be checked — the gateway still refuses a price-bearing send", (e as Error)?.message);
        }
      }

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
          // the outside source's messages land on its own partner's conversation, as a supplier's do
          supplier: sup ? { id: sup.id, name: sup.name } : sourceMatch,
          customer: cus ? { id: cus.id, name: cus.name, x_contact_class: cus.x_contact_class } : null,
        },
      );
      ingestRoute = ingest.route;
      ingestPartnerId = ingest.partnerId ?? 0;
      ingestPartnerName = ingest.partnerName ?? "";

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
      // 2026-09-25 (STATUS § 31) — «شخصي» (route quiet): its message is kept,
      // and nothing is sent — not this alert either.
      if (!sup && !t && ingest.route !== "archived" && ingest.route !== "quiet") {
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

    // 2026-09-25 (STATUS § 29 ب) — Meta re-delivered this message after its
    // 24h window (the webhook carries the original timestamp). It is in the
    // inbox now; the bot does not act on it (any reply fails with #131047, and
    // an old price or order must not land on today).
    {
      const { lateInboundHours, noteLateInbound } = await import("./wa-inbox");
      const lateH = lateInboundHours(msg.timestamp);
      if (lateH !== null) {
        console.log(`[inbox] wamid=${msg.messageId.slice(-10)} late=${lateH}h skip=bot (outside Meta's 24h window)`);
        try {
          await noteLateInbound(env, ingestPartnerId, ingestPartnerName, msg.timestamp);
        } catch (e) {
          console.warn("[inbox] late note failed", (e as Error)?.message);
        }
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // 2026-09-25 (STATUS § 30) — a number Baraa archived from «مراجعة الأرقام»:
    // mirrored to its inbox above, and nothing automated follows.
    // 2026-09-25 (STATUS § 31) — every archived partner (not only the ones
    // archived from review): the bot sends nothing; a text the screening
    // classifier reads as «طلب أو استفسار شراء» reaches Baraa as one alert.
    if (ingestRoute === "archived") {
      console.log(`[screen] wamid=${msg.messageId.slice(-10)} partner=${ingestPartnerId} archived skip=bot`);
      if (msg.type === "text" && msg.text && ingestPartnerId > 0) {
        try {
          const { alertArchivedPurchase } = await import("./screening");
          await alertArchivedPurchase(env, { partnerId: ingestPartnerId, name: ingestPartnerName, profileName: msg.profileName, text: msg.text });
        } catch (e) {
          console.warn("[screen] archived purchase check failed", (e as Error)?.message);
        }
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-25 (STATUS § 31) — a number Baraa classified «شخصي»: mirrored to
    // its inbox above; no reply, no message, no alert.
    if (ingestRoute === "quiet") {
      console.log(`[screen] wamid=${msg.messageId.slice(-10)} partner=${ingestPartnerId} personal skip=bot`);
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-25 (STATUS § 33) — the window just opened: what the gateway held
    // for this number goes now, oldest first, before any reply.
    let flushed: { sent: number } | null = null;
    if (inboundWindow?.open) {
      try {
        const { flushHeld } = await import("./wa-gateway");
        flushed = await flushHeld(env, msg.from, inboundWindow, ctx);
      } catch (e) {
        console.warn("[gateway] flush failed", (e as Error)?.message);
      }
    }

    // § 67 أ — frozen: the message is in the inbox above, and for anyone but Baraa the bot stops here. A
    // customer gets the settings' reply (once in six hours a number), and Baraa is told who wrote and what.
    if (!isOwnerNumber(env, msg.from)) {
      const { frozenInbound } = await import("./freeze");
      const who = teamMatch ? "team" : supplierMatch ? "supplier" : sourceMatch ? "source" : "customer";
      const what = msg.text || (msg.flow ? "رد نموذج" : msg.buttonId ? `زر ${msg.buttonId}` : `[${msg.type}]`);
      if (await frozenInbound(env, { from: msg.from, name: ingestPartnerName || msg.profileName || "", who, what, partnerId: ingestPartnerId }, ctx)) {
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // § 54 — the day's price review owed to Baraa (his window was closed when it was due):
    // nothing was held for it — it is built now, from the day as it is, and counts as flushed.
    if (inboundWindow?.open && isOwnerNumber(env, msg.from)) {
      const { sendOwedPriceReview } = await import("./price-review");
      if (await sendOwedPriceReview(env, Date.now(), ctx)) flushed = { sent: (flushed?.sent ?? 0) + 1 };
    }

    // § 57 ز — the registration form owed to a supplier (the tax number of an invoice of his was not
    // read while his window was closed): nothing was held for it — it goes with his first message.
    // An image or a document is read first, where a supplier's media is handled below: it may be the
    // invoice that makes the form needless, and the owed form follows it there.
    if (supplierMatch && msg.type !== "image" && msg.type !== "document") {
      const { sendOwedSupplierRegisterForm } = await import("./supplier-vat");
      await sendOwedSupplierRegisterForm(env, msg.from, ctx);
    }

    // 2026-09-25 (STATUS § 34) — «عرض التحديث» on a «فتح المحادثة» template:
    // the flush above was the answer. Baraa gets his usual «✅ تم» line; anyone
    // else one line only when nothing was waiting. No other routing.
    {
      const { OPEN_PAYLOAD, OPEN_NOTHING_TEXT } = await import("./wa-opener");
      if ((msg.type === "button" || msg.type === "interactive") && msg.buttonId === OPEN_PAYLOAD) {
        console.log(`[opener] tap from=${msg.from.slice(-4)} flushed=${flushed?.sent ?? 0}`);
        try {
          if (isOwnerNumber(env, msg.from)) {
            const { ownerWindowAck } = await import("./attendance");
            await sendText(env, msg.from, ownerWindowAck(), { ctx, purpose: "owner_alert" });
          } else if (!flushed || flushed.sent === 0) {
            await sendText(env, msg.from, OPEN_NOTHING_TEXT, { ctx, purpose: "bot_reply" });
          }
        } catch (e) {
          console.warn("[opener] tap reply failed", (e as Error)?.message);
        }
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // § 51 — a WhatsApp Flow's reply (the price form): read by its flow_token
    // with no extractor, written and answered in src/price-flow.ts, whoever the
    // sender is (a supplier, a team member, Baraa's own trial). No other routing.
    if (msg.flow) {
      try {
        const { isOrderFormToken, handleOrderFormReply } = await import("./order-form");
        const { isReviewFormToken, handlePriceReviewReply } = await import("./price-review");
        if (isReviewFormToken(msg.flow.token ?? "")) {
          // § 54 ج — Baraa's review of the day's prices: each item's decision goes on its line
          const r = await handlePriceReviewReply(env, msg, ctx);
          console.log(`[price-review] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.written !== undefined ? ` written=${r.written}` : ""}`);
        } else if ((await import("./receipt-form")).isReceiptFormToken(msg.flow.token ?? "")) {
          // § 55 د — the buyer's receipt of the purchases: the received quantities, then the list's confirmation
          const { handleReceiptFormReply } = await import("./receipt-form");
          const r = await handleReceiptFormReply(env, msg, ctx);
          console.log(`[receipt-form] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.listId ? ` list=${r.listId}` : ""}`);
        } else if ((await import("./supplier-vat")).isSupplierRegisterToken(msg.flow.token ?? "")) {
          // § 57 ز — the supplier's registration: the official name, the CR, the tax number, the certificate, the IBAN — on his card
          const { handleSupplierRegisterReply } = await import("./supplier-vat");
          const r = await handleSupplierRegisterReply(env, msg, ctx);
          console.log(`[supplier-vat] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.partnerId ? ` partner=${r.partnerId}` : ""}${r.number ? ` number=${r.number}` : ""}${r.problems?.length ? ` (${r.problems.join(",")})` : ""}`);
        } else if (isOrderFormToken(msg.flow.token ?? "")) {
          // § 53 ج — the customer's order form: its quantities become his order, and the quotation follows
          const r = await handleOrderFormReply(env, msg, ctx);
          console.log(`[order-form] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.orderId ? ` order=${r.orderId}` : ""}`);
        } else if ((await import("./register-form")).isRegisterFormToken(msg.flow.token ?? "")) {
          // § 53 د — the new customer's registration: its fields go on his card
          const { handleRegisterFormReply } = await import("./register-form");
          const r = await handleRegisterFormReply(env, msg, ctx);
          console.log(`[register-form] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.problems?.length ? ` (${r.problems.join(",")})` : ""}`);
        } else if ((await import("./complaint-form")).isComplaintToken(msg.flow.token ?? "")) {
          // § 57 هـ — the customer's «عندي ملاحظة»: ONE complaint on record, and Baraa's three buttons (nothing is compensated here)
          const { handleComplaintReply } = await import("./complaint-form");
          const r = await handleComplaintReply(env, msg, ctx);
          console.log(`[complaint] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.complaintId ? ` complaint=${r.complaintId}` : ""}${r.problems?.length ? ` (${r.problems.join(",")})` : ""}`);
        } else if ((await import("./car-load")).isCarLoadToken(msg.flow.token ?? "")) {
          // § 55 ج — the driver's car load: the morning's quantities, or the evening's left and damaged
          const { handleCarLoadReply } = await import("./car-load");
          const r = await handleCarLoadReply(env, msg, ctx);
          console.log(`[car-load] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.items !== undefined ? ` items=${r.items}` : ""}`);
        } else if ((await import("./custody-form")).isCustodyToken(msg.flow.token ?? "")) {
          // § 55 هـ — the collector's custody handover: what he handed over of the day's cash, and how
          const { handleCustodyReply } = await import("./custody-form");
          const r = await handleCustodyReply(env, msg, ctx);
          console.log(`[custody] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.diff !== undefined ? ` diff=${r.diff}` : ""}`);
        } else if ((await import("./transfer-form")).isTransferToken(msg.flow.token ?? "")) {
          // § 57 د — the customer's transfer notice: kept, and sent to Baraa for «✅ وصل» / «❌ ما وصل» (nothing is paid here)
          const { handleTransferReply } = await import("./transfer-form");
          const r = await handleTransferReply(env, msg, ctx);
          console.log(`[transfer] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.noticeId ? ` notice=${r.noticeId}` : ""}${r.problems?.length ? ` (${r.problems.join(",")})` : ""}`);
        } else if ((await import("./delivery-form")).isDeliveryFormToken(msg.flow.token ?? "")) {
          // § 55 ب — the delivery and collection form: the delivered quantities, the invoice by them, the payment
          const { handleDeliveryFormReply } = await import("./delivery-form");
          const r = await handleDeliveryFormReply(env, msg, ctx);
          console.log(`[delivery-form] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.orderId ? ` order=${r.orderId}` : ""}${r.payment ? ` pay=${r.payment}` : ""}`);
        } else if ((await import("./special-ask")).isSpecialAskToken(msg.flow.token ?? "")) {
          // § 62 ب — a source's prices for a special request: on the request's lines alone, never on the day's prices
          const { handleSpecialAskReply } = await import("./special-ask");
          const r = await handleSpecialAskReply(env, msg, ctx);
          console.log(`[special-ask] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.quoteId ? ` request=${r.quoteId}` : ""}${r.saved !== undefined ? ` saved=${r.saved}` : ""}`);
        } else if ((await import("./supplier-registry")).isSignupToken(msg.flow.token ?? "")) {
          // § 65 ب — «تسجيل مورد»: ONE card «بانتظار الاعتماد» (the card of his number, else a new one), and Baraa's one message
          const { handleSignupReply } = await import("./supplier-registry");
          const r = await handleSignupReply(env, msg, ctx);
          console.log(`[supplier-registry] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.partnerId ? ` partner=${r.partnerId}` : ""}${r.problems?.length ? ` (${r.problems.join(",")})` : ""}`);
        } else if ((await import("./supplier-offer")).isOfferToken(msg.flow.token ?? "")) {
          // § 65 ج — «عرض مورد»: ONE row outside the day's prices, and Baraa's one message
          const { handleOfferReply } = await import("./supplier-offer");
          const r = await handleOfferReply(env, msg, ctx);
          console.log(`[supplier-offer] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.rowId ? ` row=${r.rowId}` : ""}`);
        } else if ((await import("./price-extra")).isExtraToken(msg.flow.token ?? "")) {
          // § 65 د — «➕ صنف إضافي»: observations outside the day's list
          const { handleExtraReply } = await import("./price-extra");
          const r = await handleExtraReply(env, msg, ctx);
          console.log(`[price-extra] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.saved !== undefined ? ` saved=${r.saved}` : ""}`);
        } else if ((await import("./expense-form")).isExpenseToken(msg.flow.token ?? "")) {
          // § 57 و — Baraa's expense form: a posted vendor bill in EXP and its payment, from his number alone
          const { handleExpenseReply } = await import("./expense-form");
          const r = await handleExpenseReply(env, msg, ctx);
          console.log(`[expense] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.moveId ? ` bill=${r.moveId}` : ""}${r.paymentId ? ` payment=${r.paymentId}` : ""}`);
        } else {
          const { handlePriceFlowReply } = await import("./price-flow");
          const r = await handlePriceFlowReply(env, msg, ctx);
          console.log(`[price-flow] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} ${r.action}${r.saved !== undefined ? ` saved=${r.saved}` : ""}${r.why ? ` (${r.why})` : ""}`);
        }
      } catch (e) {
        console.error("[flow] reply failed", (e as Error)?.message);
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    // § 65 — the suppliers' registry, before any other routing: «تسجيل مورد» (typed, or the invitation's
    // button) from a number that is neither the team nor a registered customer opens the registration
    // form; an approved supplier's «📦 بضاعتي جاهزة» / «🚢 وصلت شحنة» / «عرض مورد» opens the offer form.
    // A message that is none of these costs no read here.
    if ((msg.type === "text" || msg.type === "button" || msg.type === "interactive") && !isOwnerNumber(env, msg.from)) {
      try {
        const { isSignupKeyword, answerSignupKeyword } = await import("./supplier-registry");
        const { offerTrigger, answerOfferTrigger } = await import("./supplier-offer");
        const answered = isSignupKeyword(msg.text) ? await answerSignupKeyword(env, msg, { team: !!teamMatch }, ctx)
          : offerTrigger(msg) ? await answerOfferTrigger(env, msg, { team: !!teamMatch }, ctx) : false;
        if (answered) {
          console.log(`[supplier-registry] wamid=${msg.messageId.slice(-10)} from=${msg.from.slice(-4)} answered by the registry`);
          await markSeen(env, msg.messageId);
          continue;
        }
      } catch (e) {
        console.warn("[supplier-registry] the keyword could not be answered — routed as any message", (e as Error)?.message);
      }
    }

    // 2026-09-20 (inbox) — bot routing runs only on text / button / location.
    // Media messages are mirrored above and terminate here (with markSeen so
    // Meta retries stay dedup'd).
    if (!botTypes || (!hasBotContent && hasMedia)) {
      // 2026-09-24 (ح5) — a customer's voice note / image / video / document
      // used to stop here with no reply and no alert. Now: an honest reply
      // (the message reached the team, no speech-to-text) and an immediate
      // owner alert. Team, supplier and owner media keep the old behaviour.
      if (!teamMatch && !supplierMatch && !sourceMatch && ingestRoute !== "owner" && !isOwnerNumber(env, msg.from)) {
        try {
          // 2026-09-25 (STATUS § 30) — a number waiting for review as not a
          // customer (or decided personal / team / supplier): nothing automated.
          const { readScreenState, isCustomerAutomationHeld } = await import("./screening");
          const held = ingestPartnerId > 0 && isCustomerAutomationHeld(await readScreenState(env, ingestPartnerId));
          if (held) console.log(`[screen] partner=${ingestPartnerId} held skip=media-reply`);
          else await handleCustomerMedia(env, msg, customerMatchForRoute, ctx);
        } catch (e) {
          console.warn("[media] customer handling failed", (e as Error)?.message);
        }
      } else if (teamMatch && hasMedia && (msg.type === "image" || msg.type === "document")) {
        // STATUS § 37 — the receipt photo of «💵 دفعت لمورد» (only while the
        // flow waits for it; any other team media keeps the old behaviour).
        try {
          const { handlePayMedia } = await import("./supplier-pay");
          const reply = await handlePayMedia(env, teamMatch, msg.media!, msg.messageId);
          if (reply) await sendFlowReply(env, msg.from, reply, ctx);
          else {
            // § 41 هـ — within 60 minutes of his «تم الشراء»: the purchase tax invoice
            const { handlePurchaseInvoiceMedia } = await import("./purchase-invoice");
            const ack = await handlePurchaseInvoiceMedia(env, teamMatch.id, msg.media!);
            if (ack) await sendText(env, msg.from, ack, { ctx, purpose: "bot_reply" });
          }
        } catch (e) {
          console.warn("[supplier-pay] receipt media failed", (e as Error)?.message);
        }
      } else if (!teamMatch && supplierMatch) {
        // 2026-09-25 (م6) — a supplier's voice note / image / document (a price
        // list): «وصلتنا» + owner alert, never a guessed price.
        try {
          const reply = await handleSupplierMedia(env, supplierMatch, msg);
          await sendText(env, msg.from, reply, { ctx, purpose: "bot_reply" });
        } catch (e) {
          console.warn("[media] supplier handling failed", (e as Error)?.message);
        }
        await owedPriceForm(env, msg.from);
        // § 57 ز — his image or PDF may be an invoice of his: its tax number is read for his card,
        // then the registration form owed to him goes if it still is (never throws; no price is read)
        if (msg.type === "image" || msg.type === "document") {
          const { supplierSentPicture } = await import("./supplier-vat");
          await supplierSentPicture(env, supplierMatch, msg.from, msg.media!, ctx);
        }
      } else if (!teamMatch && sourceMatch) {
        // § 52 ب — an outside price source's voice note / image: never the customer's reply
        await outsideSourceMessage(env, sourceMatch, msg, ctx);
      }
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-20 (cover) — reuse the team/supplier matches ingestInbound
    // already resolved. Ordering: team → supplier → customer (a team
    // member who also has customer_rank must not fall into the customer
    // path). ingestRoute='owner' short-circuits below via the OWNER guard.
    // § 59 أ — Baraa holds a team role (Omar's operating roles are his until a driver is added): a
    // message of his is a member's, here — unless it is one of his own (the price review, «✅ وصل», a
    // complaint's decision, his expense, a delivery from the car), answered in the owner's branch below.
    const ownersOwn = !!teamMatch && isOwnerNumber(env, msg.from) && (await import("./owner-team")).isOwnerOwnMessage(msg);
    const teamMember = ownersOwn ? null : teamMatch;
    if (teamMember) {
      // 2026-09-17 — deferred delivery locations. sendDriverRoute stashes
      // per-stop location messages in KV instead of sending them behind
      // an unopened 24-hour window; the driver's first inbound flushes
      // them. Two shapes:
      //   • "shift_start" button reply → text confirmation THEN locations
      //   • anything else from the driver → locations first, then the
      //     regular team handler continues.
      // 2026-09-24 — template quick replies arrive as type "button", session
      // buttons as type "interactive". Both are button taps (the team branch
      // used to ignore the template ones: «تم الشراء» and «بدء الدوام» from
      // a template did nothing).
      const isButton = (msg.type === "interactive" || msg.type === "button") && !!msg.buttonId;
      const isShiftStart = isButton && msg.buttonId === "shift_start";
      const { flushTeamQueue } = await import("./team-queue");
      if (isShiftStart) {
        try {
          // 2026-09-25 (STATUS § 29) — attendance: the tap is recorded (present /
          // late, Meta's own tap time) and releases the member's tasks. A member
          // without a shift time keeps the 09-17 behaviour.
          const { recordShiftTap, deliverTasksOnTap } = await import("./attendance");
          const { parseMetaTimestampMs } = await import("./wa-inbox");
          const tap = await recordShiftTap(env, teamMember.id, parseMetaTimestampMs(msg.timestamp) ?? Date.now());
          if (tap.kind === "not_on_attendance") {
            await sendText(env, msg.from, "تم بدء الدوام ✅ هذي مواقع توصيلات اليوم", { ctx, purpose: "shift_ack" });
            await flushTeamQueue(env, msg.from);
          } else if (tap.kind === "owner") {
            await sendText(env, msg.from, tap.text, { ctx, purpose: "owner_alert" });
            // § 59 أ — he holds the operating roles: his tap releases his tasks too (the queue, the open
            // purchase lists, the uncollected invoices), as a member's does. Nothing is recorded about him.
            await deliverTasksOnTap(env, teamMember, msg.from, { quietWhenNone: true });
          } else if (tap.kind === "not_started" || tap.kind === "off_today") {
            // STATUS § 31 — a day off / time off: nothing recorded, nothing released.
            await sendText(env, msg.from, tap.text, { ctx, purpose: "shift_ack" });
          } else {
            await sendText(env, msg.from, tap.text, { ctx, purpose: "shift_ack" });
            // STATUS § 31 — a tap after the end of the shift: recorded (late),
            // and the tasks wait for the next shift.
            if (!tap.afterEnd) await deliverTasksOnTap(env, teamMember, msg.from);
          }
        } catch (e) {
          console.warn("[shift_start] failed", (e as Error)?.message);
        }
        await markSeen(env, msg.messageId);
        continue;
      }
      // 2026-09-25 (STATUS § 29) — before today's «بدء الدوام» tap, a member on
      // attendance gets no task: the queue stays, and so do the open lists.
      const { attendanceHold, holdText } = await import("./attendance");
      const att = await attendanceHold(env, teamMember.id);
      if (!att.hold) await flushTeamQueue(env, msg.from);

      // § 59 ب — the marketing member: «الأسعار» / «القائمة», or «أرسل القائمة» on the template → the
      // valid price list (or «الأسعار تتحدث»); any other message of his → the list owed to him since
      // the publication (his window was closed then), once. Sale prices alone (src/team-prices.ts).
      {
        const TP = await import("./team-prices");
        if (TP.isMarketingMember(teamMember)) {
          const asksPrices = (isButton && msg.buttonId === TP.TEAM_PRICES_PAYLOAD) || (msg.type === "text" && TP.teamPricesCommand(msg.text));
          if (asksPrices) {
            const got = await TP.answerTeamPricesAsk(env, msg.from, ctx);
            console.log(`[team-prices] ask from=${msg.from.slice(-4)} → ${got}`);
            await markSeen(env, msg.messageId);
            continue;
          }
          if (await TP.sendOwedTeamPrices(env, msg.from, ctx)) {
            console.log(`[team-prices] the owed list went to ${msg.from.slice(-4)}`);
            // a member with no other role: his message has no other answer (no «اكتب الأسعار» under the list itself)
            if (TP.isMarketingOnly(teamMember) && msg.type === "text") {
              await markSeen(env, msg.messageId);
              continue;
            }
          }
        }
      }

      let collectReply: RouterReply | null = null;
      if (isButton && msg.buttonId!.startsWith("sp_")) {
        // STATUS § 37 — «💵 دفعت لمورد»: the supplier, then «تخطي» the receipt.
        const { handlePayButton } = await import("./supplier-pay");
        const reply = await handlePayButton(env, teamMember, msg.buttonId!).catch((e) => {
          console.warn("[supplier-pay] button failed", (e as Error)?.message);
          return { text: "تعذّر تسجيل الدفعة الآن. جرّب بعد قليل، أو أرسلها لبراء نصاً." };
        });
        await sendFlowReply(env, msg.from, reply, ctx);
      } else if (isButton) {
        const reply: RouterReply = await dispatch(env, {
          msg, intent: "other", senderType: "customer",
          partner: { id: teamMember.id, name: teamMember.name, x_whatsapp_number: teamMember.x_whatsapp_number },
        });
        await sendReply(env, msg.from, reply, ctx);
      } else if (msg.type === "text" && (await import("./supplier-pay").then((m) => m.readFlow(env, teamMember.id)))) {
        // STATUS § 37 — a text inside the supplier-payment flow: the amount, a
        // word in the receipt step, or «إلغاء». Before any earlier pending state.
        const { handlePayText } = await import("./supplier-pay");
        const reply = await handlePayText(env, teamMember, msg.text).catch((e) => {
          console.warn("[supplier-pay] text failed", (e as Error)?.message);
          return { text: "تعذّر تسجيل الدفعة الآن. جرّب بعد قليل، أو أرسلها لبراء نصاً." };
        });
        if (reply) await sendFlowReply(env, msg.from, reply, ctx);
      } else if (msg.type === "text" && (collectReply = await import("./collect-pay").then((m) => m.collectAmountReply(env,
        { id: teamMember.id, name: teamMember.name, whatsapp: String(teamMember.x_whatsapp_number || msg.from) }, msg.text))
        .catch((e) => {
          console.warn("[collect-pay] amount failed", (e as Error)?.message);
          return { text: "تعذّر تسجيل التحصيل الآن. جرّب بعد قليل، أو أرسله لبراء نصاً." } as RouterReply;
        }))) {
        // § 42 ب — the amount after «مبلغ آخر» (30 minutes): recorded, refused over the balance, or asked again.
        await sendReply(env, msg.from, collectReply, ctx);
      } else if (msg.type === "text" && deliverCommandOrderId(msg.text) !== null) {
        // § 49 ج — «تسليم 12»: the delivery on the spot of a confirmed order that is on no route yet
        // (it has no stop message, so no button). The same handler as the «تم التسليم» button.
        const reply: RouterReply = await dispatch(env, {
          msg: { ...msg, buttonId: `delivered_${deliverCommandOrderId(msg.text)}` }, intent: "other", senderType: "customer",
          partner: { id: teamMember.id, name: teamMember.name, x_whatsapp_number: teamMember.x_whatsapp_number },
        });
        await sendReply(env, msg.from, reply, ctx);
      } else if (msg.type === "text" && (await import("./receipt-form").then((m) => m.isReceiptCommand(msg.text, teamMember)))) {
        // § 55 د — «استلام» / «استلام المشتريات» from the buyer: the receipt form of his open purchase
        // list, or one line when none is open. His own report, not a task sent to him: like «تسليم 12»
        // above — and like the list's buttons — it does not wait for «بدء الدوام».
        const { answerReceiptAsk } = await import("./receipt-form");
        const reply: RouterReply = await answerReceiptAsk(env, { partnerId: teamMember.id, name: teamMember.name, whatsapp: msg.from }, ctx);
        await sendReply(env, msg.from, reply, ctx);
      } else if (msg.type === "text") {
        const pendingKey = `pending_issue:${teamMember.id}`;
        const pendingOrderId = await env.MSG_DEDUP.get(pendingKey);
        // 2026-09-24 (ح7) — the text after «مشكلة» on the purchase list.
        const purchaseIssueKey = `pending_purchase_issue:${teamMember.id}`;
        const pendingListId = await env.MSG_DEDUP.get(purchaseIssueKey);
        // STATUS § 34 — the text after «ملاحظة 📝» on a collection.
        const { pendingCollectNoteKey } = await import("./team-note");
        const collectNoteKey = pendingCollectNoteKey(teamMember.id);
        const pendingCollectNote = await env.MSG_DEDUP.get(collectNoteKey);
        // § 40 ب — a price source's reply within 90 minutes of today's
        // «أرسل أسعار السوق اليوم»: read as market prices (null → an ordinary message).
        let marketReply: string | null = null;
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
          await sendText(env, msg.from, "وصلت المشكلة لبراء وسُجّلت على قائمة الشراء ✅ بيتواصل معك.", { ctx, purpose: "bot_reply" });
        } else if (pendingOrderId) {
          const orderId = Number(pendingOrderId);
          await env.MSG_DEDUP.delete(pendingKey);
          // STATUS § 34 — the driver's note: on the stop, and to Baraa as a
          // critical message with the customer and the order.
          const { recordTeamNote } = await import("./team-note");
          await recordTeamNote(env, { kind: "delivery", memberName: teamMember.name, orderId, text: msg.text });
          await sendText(env, msg.from, "تم تسجيل المشكلة، براء بيراجعها 🙏", { ctx, purpose: "bot_reply" });
        } else if (pendingCollectNote) {
          // STATUS § 34 — the collector's note after «ملاحظة 📝».
          const invoiceId = Number(pendingCollectNote);
          await env.MSG_DEDUP.delete(collectNoteKey);
          const { recordTeamNote, TEAM_NOTE_ACK } = await import("./team-note");
          await recordTeamNote(env, { kind: "collection", memberName: teamMember.name, invoiceId, text: msg.text });
          await sendText(env, msg.from, TEAM_NOTE_ACK, { ctx, purpose: "bot_reply" });
        } else if (await import("./car-load").then((m) => m.carLoadText(env, teamMember, msg.text, msg.from, ctx))) {
          // § 55 ج — «حمولة» / «نهاية الحمولة» from the driver: the car-load form went (src/car-load.ts).
          // After the amount, «تسليم N» and the pending notes; before the market reply and the shift's hold.
        } else if (await import("./custody-form").then((m) => m.custodyText(env, teamMember, msg.text, msg.from, ctx))) {
          // § 55 هـ — «عهدة» / «تسليم العهدة» from the collector: the custody form went (src/custody-form.ts).
        } else if ((marketReply = await import("./price-sources").then((m) => m.tryMarketReply(env,
          { partnerId: teamMember.id, employeeId: teamMember.employeeId ?? null, name: teamMember.name }, msg.from, msg.text, msg.messageId))
          .catch((e) => { console.warn("[market-reply] failed", (e as Error)?.message); return null; }))) {
          await sendText(env, msg.from, marketReply, { ctx, purpose: "bot_reply" });
        } else if (att.hold) {
          await sendText(env, msg.from, holdText(att), { ctx, purpose: "bot_reply" });
        } else {
          // ح1 — the purchase-list template carries a one-line (possibly cut)
          // list; any message from the warehouse gets the full open list(s).
          let sent = 0;
          if (teamMember.x_role === "warehouse" || teamMember.x_role_codes?.includes("warehouse") || (await isWarehouse(env, teamMember.id))) {
            sent = await resendOpenPurchaseLists(env, msg.from).catch(() => 0);
          }
          if (sent === 0) {
            // STATUS § 37 — the purchase and collection roles: «💵 دفعت لمورد».
            const { isPaymentMember, startButton } = await import("./supplier-pay");
            if (isPaymentMember(teamMember)) {
              await sendButtons(env, msg.from, `مرحبا ${teamMember.name} 👋 استخدم الأزرار عشان نأكد الحالة.`, [startButton()], { ctx, purpose: "bot_reply" });
            } else if ((await import("./team-prices")).isMarketingOnly(teamMember)) {
              // § 59 ب — no task of the day is a marketing member's: one line says what he can ask for
              await sendText(env, msg.from, (await import("./team-prices")).marketingHintText(teamMember.name), { ctx, purpose: "bot_reply" });
            } else {
              await sendText(env, msg.from, `مرحبا ${teamMember.name} 👋 استخدم الأزرار عشان نأكد الحالة.`, { ctx, purpose: "bot_reply" });
            }
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
      // 2026-09-25 (م7) — the confirmation's buttons never reach the price extractor.
      const action = supplierButtonAction(msg);
      if (action) {
        const replyText = await handleSupplierButton(env, supplier, action);
        if (replyText) await sendText(env, msg.from, replyText, { ctx, purpose: "bot_reply" });
        await owedPriceForm(env, msg.from);
        await markSeen(env, msg.messageId);
        continue;
      }
      const enriched = await enrichSupplier(env, supplier);
      const replyText = await handleSupplierReply(env, enriched, msg.text, msg.messageId);
      if (replyText) await sendText(env, msg.from, replyText, { ctx, purpose: "bot_reply" });
      // § 52 و — he was asked by the old text template and this message carried no price that was
      // kept: his window has just opened, so the form goes now (once a day).
      await owedPriceForm(env, msg.from);
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
        // 2026-09-25 (STATUS § 29) — his daily «بدء الدوام» only opens the 24h
        // window (the inbound itself did that); one line says so. Nothing is
        // recorded about him.
        const { isOwnerWindowPayload, ownerWindowButtonReply, ownerWindowReplyButtons } = await import("./owner-window");
        if ((msg.type === "interactive" || msg.type === "button") && REASK_PAYLOAD.test(msg.buttonId ?? "")) {
          // § 67 و — «🔁 أعد طلب الأسعار» under the 04:30 alert: the ask again to every source still silent, and one line back
          const { handleReaskButton } = await import("./sources-missing");
          const r = await handleReaskButton(env, msg.buttonId!, Date.now()).catch((e) => `تعذّر إعادة الطلب الآن: ${(e as Error)?.message ?? e}`);
          await sendText(env, msg.from, r, { ctx, purpose: "owner_alert" });
        } else if ((msg.type === "interactive" || msg.type === "button") && msg.buttonId === "shift_start") {
          const { ownerWindowAck } = await import("./attendance");
          await sendText(env, msg.from, ownerWindowAck(), { ctx, purpose: "owner_alert" });
        } else if ((msg.type === "interactive" || msg.type === "button") && isOwnerWindowPayload(msg.buttonId)) {
          // § 45 ب — «تم الاطلاع» (the 21:30 summary) / «عرض الاستثناءات» (the price review): the tap
          // opened his window and the flush above sent what was held; one line, nothing else.
          const r = ownerWindowButtonReply(msg.buttonId!, flushed?.sent ?? 0);
          // § 57 و — under «تم ✅» of the 21:30 summary: «🧾 تسجيل مصروف» (the owner has no menu in
          // WhatsApp: this reply is his one regular tap).
          const under = ownerWindowReplyButtons(env, msg.buttonId!);
          if (r && under.length) await sendButtons(env, msg.from, r, under, { ctx, purpose: "owner_alert" });
          else if (r) await sendText(env, msg.from, r, { ctx, purpose: "owner_alert" });
        } else if ((msg.type === "interactive" || msg.type === "button") && /^prvt?_[arn]_\d+_\d+$/.test(msg.buttonId ?? "")) {
          // § 54 — the day's price review: «✅ اعتمد الكل كما هو» / «✏️ مراجعة» / «⛔ لا تنشر اليوم»
          // (and «✏️ تعديل» under a confirmation). It answers him itself.
          const { handlePriceReviewButton } = await import("./price-review");
          const r = await handlePriceReviewButton(env, msg.buttonId!, Date.now(), ctx).catch(async (e) => {
            console.warn("[price-review] button failed", (e as Error)?.message);
            await sendText(env, msg.from, `تعذّر تسجيل القرار الآن. جرّب بعد قليل، أو قرّر من ${PLACE_TODAY}.`, { ctx, purpose: "owner_alert" });
            return "error";
          });
          console.log(`[price-review] button ${msg.buttonId} → ${r}`);
        } else if ((msg.type === "interactive" || msg.type === "button") && /^pexc_[mspe]_\d+$/.test(msg.buttonId ?? "")) {
          // § 54 — a choice of a per-item exception message of before (§ 40 ج): nothing is decided
          // from it any more; one line says where the decision is taken now.
          const { OLD_EXCEPTION_TEXT } = await import("./prices");
          await sendText(env, msg.from, OLD_EXCEPTION_TEXT, { ctx, purpose: "owner_alert" });
        } else if ((msg.type === "interactive" || msg.type === "button") && /^aftest_(transfer|note)$/.test(msg.buttonId ?? "")) {
          // § 58 أ — a button of the trial of the two buttons after an invoice: one line says what it
          // opens for a customer; no form is opened and nothing is written (src/after-delivery.ts).
          const { answerAfterDeliveryTest } = await import("./after-delivery");
          const r = await answerAfterDeliveryTest(env, msg.buttonId!, msg.from, ctx);
          console.log(`[after-delivery] trial button ${msg.buttonId} → ${r ?? "not Baraa's number"}`);
        } else if ((msg.type === "interactive" || msg.type === "button") && /^trn_(ok|no)_/.test(msg.buttonId ?? "")) {
          // § 57 د — «✅ وصل» / «❌ ما وصل» under a customer's transfer notice: the payment over the chosen
          // invoices, or nothing — once (src/transfer-form.ts answers him itself, and never throws).
          const { handleTransferDecision } = await import("./transfer-form");
          const r = await handleTransferDecision(env, msg.buttonId!, msg.from, ctx);
          console.log(`[transfer] button ${msg.buttonId} → ${r?.action ?? "not a notice's button"}`);
        } else if ((msg.type === "interactive" || msg.type === "button") && /^cmp_(comp|credit|reject)_/.test(msg.buttonId ?? "")) {
          // § 57 هـ — «تعويض بالطلب القادم» / «إشعار دائن» / «رفض» under a customer's complaint: the decision
          // on its row and one fixed text to the customer — once (src/complaint-form.ts answers him itself, and never throws).
          const { handleComplaintDecision } = await import("./complaint-form");
          const r = await handleComplaintDecision(env, msg.buttonId!, msg.from, ctx);
          console.log(`[complaint] button ${msg.buttonId} → ${r?.action ?? "not a complaint's button"}`);
        } else if ((msg.type === "interactive" || msg.type === "button") && /^dlv_\d+$/.test(msg.buttonId ?? "")) {
          // § 55 ب — «📦 سلّم وحصّل» under a confirmed order: the delivery and collection form, to him
          // (its «إرسال» delivers the order by the delivered quantities, with its payment).
          const orderId = Number(msg.buttonId!.slice(4));
          const { answerDeliveryButton, DELIVERY_FORM_NOT_SENT_TEXT } = await import("./delivery-form");
          const reply = await answerDeliveryButton(env, orderId, msg.from, ctx).catch((e) => {
            console.warn("[delivery-form] owner's form failed", (e as Error)?.message);
            return { text: DELIVERY_FORM_NOT_SENT_TEXT(orderId), sent: false };
          });
          if (reply.text) await sendText(env, msg.from, reply.text, { ctx, purpose: "owner_alert" });
        } else if (((msg.type === "interactive" || msg.type === "button") && /^delivered_\d+$/.test(msg.buttonId ?? ""))
          || (msg.type === "text" && deliverCommandOrderId(msg.text) !== null)) {
          // § 49 ج — Baraa sells from the car: «تم التسليم ✅» under a confirmed order (or «تسليم 12»)
          // delivers it on the spot — the invoice issued and sent, the order off every purchase list.
          const buttonId = msg.buttonId && /^delivered_\d+$/.test(msg.buttonId) ? msg.buttonId : `delivered_${deliverCommandOrderId(msg.text)}`;
          const reply: RouterReply = await dispatch(env, { msg: { ...msg, buttonId }, intent: "other", senderType: "customer", partner: null }).catch((e) => {
            console.warn("[delivered] owner delivery failed", (e as Error)?.message);
            return { text: "تعذّر تسجيل التسليم الآن. جرّب بعد قليل." } as RouterReply;
          });
          if (reply.text) await sendText(env, msg.from, reply.text, { ctx, purpose: "owner_alert" });
        } else if (await import("./expense-form").then((m) => m.expenseMessage(env, msg, ctx)).catch((e) => {
          console.warn("[expense] the owner's message failed", (e as Error)?.message);
          return false;
        })) {
          // § 57 و — «مصروف» / «🧾 تسجيل مصروف»: the expense form went; «↩️ تراجع»: the entry was
          // taken back (src/expense-form.ts answers him itself).
        }
        // § 54 — «عدّل» (a price typed within 30 minutes) is gone with the per-item exception
        // messages: a text from him is answered by nothing here, as any other text was.
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // § 52 ب — an outside price source (رائد): its prices within 90 minutes of the ask or the
    // reminder, the form owed after the old template, else «وصلتنا رسالتك» and a line to Baraa.
    // Nothing below this point (the customer path) ever runs for it.
    if (sourceMatch) {
      await outsideSourceMessage(env, sourceMatch, msg, ctx);
      await markSeen(env, msg.messageId);
      continue;
    }

    // § 40 ب — a price source that is a partner (not a supplier, not the
    // team): its reply within 90 minutes of today's market-price ask.
    if (msg.type === "text" && msg.text && ingestPartnerId > 0) {
      try {
        const { tryMarketReply } = await import("./price-sources");
        const r = await tryMarketReply(env, { partnerId: ingestPartnerId, name: ingestPartnerName || msg.profileName || "" }, msg.from, msg.text, msg.messageId);
        if (r) {
          await sendText(env, msg.from, r, { ctx, purpose: "bot_reply" });
          await markSeen(env, msg.messageId);
          continue;
        }
      } catch (e) {
        console.warn("[market-reply] partner check failed", (e as Error)?.message);
      }
    }

    // 2026-09-20 (cover) — ingestInbound already ran findCustomerByWhatsApp,
    // so reuse its match rather than re-hit Odoo.
    const existing = customerMatchForRoute;
    // 2026-09-24 (م3) — «إيقاف» / «تشغيل» as the whole message is the
    // marketing opt-out: no welcome, no classifier.
    const { parseOptoutCommand } = await import("./optout");
    const optoutCmd = msg.type === "text" ? parseOptoutCommand(msg.text) : null;
    const partner = await findOrCreateCustomer(env, msg.from, msg.profileName);
    // 2026-09-25 (STATUS § 30 / § 31) — archived, or «شخصي» (reached here only
    // if the ingest above failed): no welcome, no new partner, no reply.
    if (partner.archived || partner.quiet) {
      await markSeen(env, msg.messageId);
      continue;
    }
    if (!existing && msg.type === "text" && !optoutCmd) {
      // § 59 ج — a new customer's first message opened his window: the welcome is a TEXT inside it,
      // with what § 49 says (orders at every hour). utak_welcome («آخر موعد للطلب…») is sent no more.
      try {
        const { welcomeText } = await import("./templates");
        await sendText(env, msg.from, welcomeText(msg.profileName || ""), { ctx, purpose: "customer_welcome" });
      } catch (e) { console.warn("[welcome] send failed", (e as Error).message); }
    }
    const senderType: SenderType = "customer";

    // § 66 أ — «موافق / نعتمد / أكدوا الطلب …» from a customer who holds a valid issued special quotation: ONE alert
    // to Baraa with the request's link. Nothing is converted and nothing is answered here: his usual reply follows.
    if (msg.type === "text" && msg.text) {
      try {
        const { looksLikeAcceptance, noticeAcceptance } = await import("./special-accept");
        if (looksLikeAcceptance(msg.text)) await noticeAcceptance(env, { id: partner.id, name: partner.name });
      } catch (e) {
        console.warn("[special-accept] the acceptance notice failed", (e as Error)?.message);
      }
    }

    // 2026-09-25 (STATUS § 30) — screening. A partner held from customer
    // automation (waiting for review as wrong number / vendor pitch / personal /
    // spam, or decided personal / team / supplier) gets no bot reply. Its text
    // is still screened while it is «غير مراجَع»: a purchase message lifts the
    // hold and the bot answers it as usual. Odoo trouble reads as «not held».
    const { readScreenState, isCustomerAutomationHeld, screenInbound } = await import("./screening");
    const screenState = await readScreenState(env, partner.id);
    let screened = false;
    if (isCustomerAutomationHeld(screenState)) {
      let held = true;
      if (msg.type === "text" && !optoutCmd) {
        screened = true;
        try {
          held = (await screenInbound(env, {
            partnerId: partner.id, partnerName: partner.name, number: msg.from, profileName: msg.profileName,
            text: msg.text, state: screenState,
          })).held;
        } catch (e) {
          console.warn("[screen] held screening failed", (e as Error)?.message);
        }
      }
      if (held) {
        if (optoutCmd) {
          // the preference is kept for later; no reply goes out
          const { handleOptoutCommand } = await import("./optout");
          await handleOptoutCommand(env, partner, msg.text).catch(() => null);
        }
        console.log(`[screen] wamid=${msg.messageId.slice(-10)} partner=${partner.id} held skip=bot`);
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    // § 44 د — his answer to the VAT questions (the number, the name, the
    // address; «إيقاف» / «إلغاء» ends them). Before the opt-out: «إيقاف» here
    // stops the questions, not the marketing messages. Null = not his flow.
    if (msg.type === "text" && msg.text) {
      try {
        const { vatFlowReply } = await import("./vat-ask");
        const loc = await env.MSG_DEDUP.get(`pending_neighborhood:${partner.id}`).catch(() => null);
        const vr = await vatFlowReply(env, partner.id, msg.text, Date.now(), { locationPending: !!loc });
        if (vr) {
          await sendReply(env, msg.from, vr, ctx);
          await markSeen(env, msg.messageId);
          continue;
        }
      } catch (e) {
        console.warn("[vat-ask] text failed", (e as Error)?.message);
      }
    }

    if (optoutCmd) {
      const { handleOptoutCommand } = await import("./optout");
      const reply = await handleOptoutCommand(env, partner, msg.text);
      if (reply) await sendText(env, msg.from, reply, { ctx, purpose: "bot_reply" });
      await markSeen(env, msg.messageId);
      continue;
    }

    // 2026-09-24 (م2) — «حولت» / «دفعت» within 48h of a payment reminder
    // reaches the owner and the collectors instead of the classifier.
    if (msg.type === "text") {
      const { isPaymentClaim, readPayRemindSent, notifyPaymentClaim, PAY_CLAIM_REPLY, answerClaimWithForm } = await import("./pay-claim");
      // § 57 د — with an open invoice the same words (and «تحويل 🏦») bring his transfer-notice form:
      // which invoices, how much, when, the receipt. With none, or a form that cannot go: as before.
      if (await answerClaimWithForm(env, partner, msg.from, msg.text, ctx)) {
        await markSeen(env, msg.messageId);
        continue;
      }
      const reminded = isPaymentClaim(msg.text) ? await readPayRemindSent(env, partner.id) : null;
      if (reminded) {
        await sendText(env, msg.from, PAY_CLAIM_REPLY, { ctx, purpose: "bot_reply" });
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
          // § 40 د — below the minimum order: no confirm button.
          const { minimumText, orderMinimum } = await import("./order-pricing");
          const minimum = await orderMinimum(env, o.id).catch(() => null);
          if (minimum?.below) {
            await sendText(env, msg.from, `طلبك رقم #${o.id}: ${minimumText(minimum.min)} قبل الساعة 9:00 مساءً، وإلا يُلغى تلقائياً.`, { ctx, purpose: "bot_reply" });
          } else {
            await sendButtons(env, msg.from, `طلبك رقم #${o.id} بانتظار تأكيدك، ويُلغى تلقائياً الساعة 9:00 مساءً لو ما تأكد 👇`, [
              { id: `confirm_order_${o.id}`, title: "تأكيد الطلب ✅" },
              { id: `cancel_order_${o.id}`, title: "إلغاء ❌" },
            ], { ctx, purpose: "bot_reply" });
          }
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
        await sendText(env, msg.from, `حفظنا موقع التوصيل لطلبك رقم #${orderId} ✅`, { ctx, purpose: "bot_reply" });
        await markSeen(env, msg.messageId);
        continue;
      }
      const neigh = msg.text.trim();
      // § 41 و (found by the full-day simulation) — a text with a number in it
      // is an order («رمان وسط 5»), never a neighborhood: it goes on to the
      // bot below and the location stays pending (it was saved as the district).
      if (isNeighborhoodText(neigh)) {
        await savePartnerNeighborhood(env, partner.id, neigh);
        await setOrderNeighborhood(env, orderId, neigh);
        await env.MSG_DEDUP.delete(pendingKey);
        await sendText(env, msg.from, `حفظنا الحي: ${neigh} ✅ لطلبك رقم #${orderId}.`, { ctx, purpose: "bot_reply" });
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

      if (msg.type === "text" && !hasDigits(msg.text)) {
        // § 41 و — a text with a number is an order line (it goes on to the bot
        // and the quotation still waits for the location), not a neighborhood.
        const neigh = msg.text.trim();
        if (isNeighborhoodText(neigh)) {
          await savePartnerNeighborhood(env, partner.id, neigh);
          await setOrderNeighborhood(env, orderId, neigh);
          await env.MSG_DEDUP.delete(pendingKey);
          await sendText(env, msg.from,
            `حفظنا الحي: ${neigh} ✅\nلو تقدر ترسل موقعك من قوقل مابس (📎 → موقع → موقعي الحالي) بيوصلك السائق أدق مرة جاية 🌿`,
            { ctx, purpose: "bot_reply" });
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
          { ctx, purpose: "bot_reply" });
        await markSeen(env, msg.messageId);
        continue;
      }
    }

    if (msg.type === "location" && msg.location) {
      const { latitude, longitude, name, address } = msg.location;
      const neigh = (name ?? address ?? "").trim().slice(0, 60);
      await savePartnerLocation(env, partner.id, latitude, longitude, neigh);
      await sendText(env, msg.from, "حفظنا موقعك للتوصيل ✅ طلباتك الجاية بيوصلك السائق مباشرة.", { ctx, purpose: "bot_reply" });
      await markSeen(env, msg.messageId);
      continue;
    }

    // § 53 ج — «اطلب» / «أبي أطلب»: the order form of the valid list (or, with none, «الأسعار تتحدث…»)
    if (msg.type === "text") {
      try {
        const { wantsOrderForm, answerOrderFormAsk } = await import("./order-form");
        if (wantsOrderForm(msg.text) && (await answerOrderFormAsk(env, { partnerId: partner.id, name: partner.name || msg.profileName || "", whatsapp: msg.from }, ctx))) {
          await markSeen(env, msg.messageId);
          continue;
        }
      } catch (e) {
        console.warn("[order-form] «اطلب» failed — the bot answers", (e as Error)?.message);
      }
    }

    let intent: import("./types").Intent = "other";
    if (msg.type === "text") {
      const c = await classifyIntent(env, msg.text, senderType);
      intent = c.intent;
    }

    const reply: RouterReply = await dispatch(env, { msg, intent, senderType, partner });

    // § 53 د — a NEW customer's first purchase-like message: the registration form follows the reply
    // (once), and the order form waits for his next message — one form at a time
    let registerDue = false;
    if (msg.type === "text" && (intent === "place_order" || intent === "add_to_order" || intent === "request_quotation" || intent === "product_inquiry")) {
      const { registerFormDue } = await import("./register-form");
      registerDue = await registerFormDue(env, partner.id);
      if (registerDue) delete reply.orderForm;
    }
    await sendReply(env, msg.from, reply, ctx);
    if (registerDue) {
      const { sendFirstRegisterForm } = await import("./register-form");
      await sendFirstRegisterForm(env, { partnerId: partner.id, whatsapp: msg.from }, ctx);
    }
    // 2026-09-25 (STATUS § 30) — after the reply, so this text is answered as
    // today; the result steers the next ones.
    if (msg.type === "text" && !screened) {
      try {
        await screenInbound(env, {
          partnerId: partner.id, partnerName: partner.name, number: msg.from, profileName: msg.profileName,
          text: msg.text, classifyIntent: intent, state: screenState,
        });
      } catch (e) {
        console.warn("[screen] failed", (e as Error)?.message);
      }
    }
    await markSeen(env, msg.messageId);
    }
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

/** § 52 و — after a price source's message: the form owed to him after the old text template (once a day). Never throws. */
async function owedPriceForm(env: Env, from: string): Promise<boolean> {
  try {
    const { sendOwedFlow } = await import("./price-flow");
    return await sendOwedFlow(env, from);
  } catch (e) {
    console.warn("[price-flow] the owed form failed", (e as Error)?.message);
    return false;
  }
}

/**
 * § 52 ب — a message from an outside price source (a partner «مصدر أسعار» that is
 * neither a supplier, a customer nor the team). A text within 90 minutes of the
 * ask or the reminder is read as prices; then the form owed after the old
 * template; else «وصلتنا رسالتك» and one line to Baraa. Never a customer reply.
 */
async function outsideSourceMessage(env: Env, source: { id: number; name: string }, msg: import("./types").NormalizedMessage, ctx?: ExecutionContext): Promise<void> {
  let handled = false;
  if (msg.type === "text" && msg.text) {
    try {
      const { tryMarketReply } = await import("./price-sources");
      const r = await tryMarketReply(env, { partnerId: source.id, name: source.name }, msg.from, msg.text, msg.messageId);
      if (r) { await sendText(env, msg.from, r, { ctx, purpose: "bot_reply" }); handled = true; }
    } catch (e) {
      console.warn("[market-reply] outside source failed", (e as Error)?.message);
    }
  }
  if (await owedPriceForm(env, msg.from)) handled = true;
  if (handled) return;
  try {
    const { OUTSIDE_SOURCE_ACK, outsideSourceAlert } = await import("./price-sources");
    await sendText(env, msg.from, OUTSIDE_SOURCE_ACK, { ctx, purpose: "bot_reply" });
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, outsideSourceAlert(source.name, msg.from, msg.text || `[${msg.type}]`));
  } catch (e) {
    console.warn("[outside-source] the acknowledgement failed", (e as Error)?.message);
  }
}

/** STATUS § 37 — a reply of the supplier-payment flow: a list (the suppliers), else buttons or text. */
async function sendFlowReply(
  env: Env,
  to: string,
  reply: import("./supplier-pay").FlowReply,
  ctx?: ExecutionContext,
): Promise<void> {
  if (reply.list) {
    const { sendViaGateway } = await import("./wa-gateway");
    await sendViaGateway(env, { purpose: "bot_reply", to, content: reply.list, ctx });
    return;
  }
  await sendReply(env, to, reply, ctx);
}

async function sendReply(
  env: Env,
  to: string,
  reply: RouterReply,
  ctx?: ExecutionContext,
): Promise<void> {
  // § 44 د — a reply may name its purpose (customer_vat_ask) and carry a second message after it
  const purpose = reply.purpose ?? "bot_reply";
  if (reply.buttons && reply.buttons.length > 0) {
    const body = reply.bodyBeforeButtons ?? reply.text ?? "";
    await sendButtons(env, to, body, reply.buttons, { ctx, purpose });
  } else if (reply.text && reply.text.trim()) {
    await sendText(env, to, reply.text, { ctx, purpose });
  }
  if (reply.followUp) await sendReply(env, to, reply.followUp, ctx);
  // § 53 ج — after a customer's first order message of the list's day: the order form, opened with what he wrote
  if (reply.orderForm?.unavailable) {
    // § 59 ج — he asked for what the valid list does not hold: «… غير متوفر اليوم 🌿 المتوفر اليوم:»
    // with the available items, their prices and the form — every time, not «once a list»
    const { answerUnavailable } = await import("./order-form");
    await answerUnavailable(env, { partnerId: reply.orderForm.partnerId, name: reply.orderForm.name, whatsapp: to }, reply.orderForm.unavailable, ctx);
  } else if (reply.orderForm) {
    const { offerOrderForm } = await import("./order-form");
    await offerOrderForm(env, { partnerId: reply.orderForm.partnerId, name: reply.orderForm.name, whatsapp: to }, { auto: true, body: reply.orderForm.body, ctx });
  }
  // § 53 د — a NEW customer's confirmed order: the registration form, in place of § 44's VAT questions
  if (reply.registerForm) {
    try {
      const { sendRegisterForm } = await import("./register-form");
      await sendRegisterForm(env, { partnerId: reply.registerForm.partnerId, whatsapp: to }, { body: reply.registerForm.body, ctx });
    } catch (e) {
      console.warn("[register-form] the form after the confirmation failed", (e as Error)?.message);
    }
  }
}

/**
 * § 62 — Odoo fires its webhook inside the save's own transaction: the worker
 * waits this long before reading the request, so it reads what was saved.
 */
/** § 64 — the path of the old fixed-token download of a sale order's quotation: gone (410). */
const SALE_PDF_GONE_PATH = "/internal/sale-quotation-pdf";
const SPECIAL_HOOK_DELAY_MS = 1500;

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
  // § 57 د — an image or a PDF that Claude reads as a bank-transfer receipt, from a customer with
  // an open invoice: his transfer-notice form goes, opened on what was read, and nothing below
  // runs. Not a receipt, not read, no open invoice or a form that cannot go: as before.
  if (customer && (msg.type === "image" || msg.type === "document") && msg.media?.id) {
    const { offerTransferFormFromMedia } = await import("./transfer-form");
    if (await offerTransferFormFromMedia(env, customer, msg.from, msg.media, ctx)) return true;
  }
  // 2026-09-24 (م2) — an image / document within 48h of a payment reminder
  // is most likely the transfer receipt: it goes to the owner and collectors.
  if (customer && (msg.type === "image" || msg.type === "document")) {
    const { readPayRemindSent, notifyPaymentClaim, PAY_RECEIPT_REPLY } = await import("./pay-claim");
    const reminded = await readPayRemindSent(env, customer.id);
    if (reminded) {
      await sendText(env, msg.from, PAY_RECEIPT_REPLY, { ctx, purpose: "bot_reply" });
      const caption = msg.media?.caption ? ` — التعليق: ${msg.media.caption.slice(0, 120)}` : "";
      await notifyPaymentClaim(env, customer, reminded, `${kind} (غالباً إيصال التحويل، في محادثته في Discuss)${caption}`);
      return true;
    }
  }
  await sendText(
    env,
    msg.from,
    `وصلتنا ${kind} ✅ الفريق بيتابعها ويرد عليك قريب. ولو هي طلب، تقدر تكتب الأصناف والكميات نصاً عشان تتسجل مباشرة 🌿`,
    { ctx, purpose: "bot_reply" },
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

/** § 41 و — Latin or Arabic-Indic digits: a quantity, so an order line, not a place. */
export function hasDigits(text: string): boolean {
  return /[0-9\u0660-\u0669\u06F0-\u06F9]/.test(String(text ?? ""));
}
/** § 41 و (the live run) — replies, never a district: «خلاص» typed while the
 *  quotation waited for the location was saved as the neighborhood. */
const REPLY_WORDS = new Set([
  "تم", "تمام", "نعم", "ايوه", "أيوه", "ايوا", "اي", "لا", "اوكي", "اوك", "ok", "okay",
  "الغاء", "إلغاء", "شكرا", "شكراً", "مشكور", "هلا", "مرحبا", "السلام عليكم", "وعليكم السلام",
]);
/** § 41 و — a text that can be a neighborhood name: 2–60 characters, no
 *  number, not a quotation word («خلاص»، «جهزه») and not a reply word. */
export function isNeighborhoodText(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 2 || t.length > 60 || hasDigits(t)) return false;
  const bare = t.replace(/[\p{P}\p{Extended_Pictographic}\s]+/gu, " ").trim().toLowerCase();
  return !isQuotationTrigger(t) && !REPLY_WORDS.has(bare);
}
