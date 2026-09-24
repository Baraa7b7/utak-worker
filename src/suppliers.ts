// v3 — Supplier orchestration.
// - askAllSuppliersForPrices: 02:00 cron, sends the daily price ask template.
// - handleSupplierReply:      called by index.ts when a known supplier writes in.
// - updateSupplierReliabilityScores: 05:00 cron, recomputes x_reliability_score.
// - openOrderingWindow:       06:00 cron, sets the KV flag + pings Baraa if late.

import type { Env } from "./config";
import { joinCapped } from "./wa-params";
import {
  DEFAULT_OPS_MARGIN_PCT,
  DEFAULT_PROFIT_MARGIN_PCT,
  ORDERING_OPEN_KEY,
  ORDERING_OPEN_TTL_SECONDS,
  TMPL_SUPPLIER_ASK,
  TMPL_SUPPLIER_CONFIRM,
} from "./config";
import type { OdooPartner, SupplierLogRow } from "./types";
import {
  call,
  createDailyPrice,
  createSupplierAskLog,
  fetchSupplierCatalog,
  getActivePricingConfig,
  getActiveSuppliersForAsk,
  getPartnerNames,
  getRecentSupplierLogs,
  getSupplierPendingLog,
  getTemplateByPurpose,
  updateSupplierLog,
  writePartner,
} from "./odoo";
import { sendTemplate, sendText } from "./meta";
import { sendOwnerAlert, supplierAskParams, SUPPLIER_ASK_LEGACY } from "./templates";
import { extractSupplierPrices } from "./claude";
import { riyadhDateKey } from "./hours";
import { isSkippedDuplicate } from "./auto-send-guard";

const nowOdoo = (): string => new Date().toISOString().replace("T", " ").slice(0, 19);

const isTemplateApproved = (metaId: string | undefined | null): boolean =>
  !!metaId && typeof metaId === "string" && !metaId.startsWith("PENDING_");

// ============================================================
// 02:00 Riyadh — ask all active suppliers
// ============================================================
export async function askAllSuppliersForPrices(env: Env): Promise<void> {
  const suppliers = await getActiveSuppliersForAsk(env);
  if (suppliers.length === 0) {
    console.log("[cron 02:00] no active suppliers to ask");
    return;
  }

  // 2026-09-25 — the params follow the template the purpose resolves to:
  // legacy utak_supplier_daily_ask = [list], utak_supplier_ask_v2 = [name, list].
  const tmpl = await getTemplateByPurpose(env, TMPL_SUPPLIER_ASK, (name) => supplierAskParams(name, "", "").length);
  if (!tmpl) {
    console.warn("[cron 02:00] template supplier_ask not registered in x_whatsapp_template");
    return;
  }
  if (!isTemplateApproved(tmpl.x_meta_template_id)) {
    console.warn(
      `[cron 02:00] template still pending Meta approval (${tmpl.x_meta_template_id}) — skipping ask`,
    );
    return;
  }

  // batch: fetch all product names once for suppliers in this run
  const allProductIds = [...new Set(suppliers.flatMap((s) => s.x_supplied_product_ids || []))];
  const catalog = allProductIds.length
    ? await fetchSupplierCatalog(env, allProductIds)
    : { products: [], packagings: [] };
  const productNameById = new Map(catalog.products.map((p) => [p.id, p.name]));

  // 2026-09-15 — intersect each supplier's supplied products with the
  // active-for-sale set. A supplier whose supplied ids are all deactivated
  // is skipped silently (single log entry) so we don't ask for prices on
  // items we would refuse to sell today.
  const activeIds = new Set<number>(
    (await call<Array<{ id: number }>>(env, "product.template", "search_read", {
      domain: [
        ["active", "=", true],
        ["sale_ok", "=", true],
        ["x_is_active_for_sale", "=", true],
      ],
      fields: ["id"],
      limit: 500,
    })).map((r) => r.id),
  );

  let sent = 0;
  let failed = 0;
  let skippedEmpty = 0;
  let skippedNoIntersection = 0;
  let skippedDuplicate = 0;
  for (const s of suppliers) {
    try {
      // Intersection: supplier's supplied ids ∩ active-for-sale ids
      const activeSupplied = (s.x_supplied_product_ids || []).filter((id) => activeIds.has(id));
      const productNames = activeSupplied
        .map((id) => productNameById.get(id))
        .filter((n): n is string => !!n);
      if (productNames.length === 0) {
        // Distinguish two skip reasons for the log:
        //   - supplier's linked products are all deactivated (no intersection)
        //   - supplier has no linked products at all / none in catalog
        const supplied = (s.x_supplied_product_ids || []).length;
        if (supplied > 0) {
          console.warn(
            `[cron 02:00] supplier ${s.id} (${s.name}) has ${supplied} supplied product(s), none active-for-sale — skipping`,
          );
          skippedNoIntersection++;
        } else {
          console.warn(
            `[cron 02:00] supplier ${s.id} (${s.name}) has no catalog products — skipping`,
          );
          skippedEmpty++;
        }
        continue;
      }
      // Meta template var rules: no newlines/tabs/4+ spaces, hard cap on
      // template body ≈ 1024 chars. Collapse whitespace to single spaces
      // and truncate the joined list to 900 chars so the parameter always
      // passes Meta's validation, whatever the operator happens to have
      // stored as a product name in Odoo.
      // ت6 (2026-09-24): the cut falls between two names, never inside one,
      // and says how many were left out («وغيرها (N)»).
      // 2026-09-25 — the v2 template's text is longer and also carries the
      // supplier name, so its list gets a smaller cap (body + params ≤ 1024).
      const supplierName = String(s.name || "").replace(/\s+/g, " ").trim();
      const legacy = tmpl.x_meta_template_id === SUPPLIER_ASK_LEGACY;
      const productList = joinCapped(
        productNames.map((n) => String(n).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim()),
        legacy ? 900 : Math.max(400, 780 - supplierName.length),
        "، ",
        (n) => `وغيرها (${n})`,
      ).text;

      const res = await sendTemplate(
        env,
        s.x_whatsapp_number,
        tmpl.x_meta_template_id,
        tmpl.x_language || "ar",
        supplierAskParams(tmpl.x_meta_template_id, supplierName, productList),
        // 2026-09-23 — purpose threads through to the echo so the single
        // x_wa_message row fetchMeta writes is labelled supplier_ask.
        { purpose: TMPL_SUPPLIER_ASK },
      );
      if (await isSkippedDuplicate(res)) {
        // Same job already asked this supplier today — not a failure and
        // not a new ask, so no log row.
        skippedDuplicate++;
        console.warn(`[cron 02:00] supplier ${s.id} skipped duplicate (already asked today)`);
        continue;
      }
      // The ask log is written after the send (was before) so a refused
      // duplicate never leaves a stray pending row behind.
      const logId = await createSupplierAskLog(env, s.id);
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        console.error(`[cron 02:00] supplier ${s.id} template send failed`, res.status, body);
        await updateSupplierLog(env, logId, { x_status: "no_reply" });
        failed++;
        continue;
      }
      sent++;
      console.log(`[cron 02:00] asked supplier ${s.id} (${s.name}) log=${logId}`);
      // 2026-09-23 — the manual logWaMessage that used to follow here wrote
      // a second x_wa_message row for the same send: fetchMeta's echo
      // already logs it (with the wamid). Removed; one row per send.
    } catch (e) {
      failed++;
      console.error(`[cron 02:00] supplier ${s.id} error`, (e as Error)?.message);
    }
  }
  console.log(
    `[cron 02:00] done. asked=${sent} failed=${failed} skipped_empty=${skippedEmpty} skipped_no_intersection=${skippedNoIntersection} skipped_duplicate=${skippedDuplicate} total=${suppliers.length}`,
  );
}

// ============================================================
// Inbound supplier message → extract prices → write x_daily_price
// Called from index.ts when senderType === "supplier" for a text message.
// Returns the reply text to send back (empty string = no free-text reply,
// because we already sent an approved template confirmation).
// ============================================================
export async function handleSupplierReply(
  env: Env,
  supplier: OdooPartner & { x_supplied_product_ids?: number[]; x_whatsapp_number?: string },
  messageText: string,
  messageId: string,
): Promise<string> {
  const suppliedIds: number[] = Array.isArray(supplier.x_supplied_product_ids)
    ? supplier.x_supplied_product_ids
    : [];

  // Load the tight catalog for this supplier
  const { products, packagings } = await fetchSupplierCatalog(env, suppliedIds);

  if (products.length === 0) {
    console.warn(`[supplier reply] supplier ${supplier.id} has no supplied products`);
    return "استلمنا رسالتك، شكراً 🌿";
  }

  // Look up the most recent pending ask log (to mark as replied)
  const pendingLog = await getSupplierPendingLog(env, supplier.id);

  // Extract prices
  let extract;
  try {
    extract = await extractSupplierPrices(env, {
      supplierName: supplier.name,
      replyText: messageText,
      products,
      packagings,
    });
  } catch (e) {
    console.error("[supplier reply] extract exception", (e as Error)?.message);
    if (pendingLog) {
      await updateSupplierLog(env, pendingLog.id, {
        x_replied_at: nowOdoo(),
        x_status: "replied",
      });
    }
    await alertOwner(env, `⚠️ فشل استخراج الأسعار من "${supplier.name}"\n\n${trunc(messageText, 400)}`);
    return "استلمنا رسالتك — نراجعها ونرد عليك خلال دقائق 🌿";
  }

  if (!extract.prices.length) {
    if (pendingLog) {
      await updateSupplierLog(env, pendingLog.id, {
        x_replied_at: nowOdoo(),
        x_status: "replied",
      });
    }
    // Only ping Baraa if it looks like a genuine attempt (not just a greeting)
    if (messageText.trim().length > 15) {
      await alertOwner(
        env,
        `⚠️ رد المورد "${supplier.name}" وصل بس ما قدرنا نستخرج أسعار:\n\n${trunc(messageText, 400)}`,
      );
    }
    return "استلمنا رسالتك — لو تكرمت أرسل الأسعار بصيغة: الصنف، التعبئة، السعر 🙏";
  }

  // Compute sale price using active pricing config
  const cfg = await getActivePricingConfig(env);
  const opsPct = cfg?.x_operations_margin_percent ?? DEFAULT_OPS_MARGIN_PCT;
  const profitPct = cfg?.x_profit_margin_percent ?? DEFAULT_PROFIT_MARGIN_PCT;
  const opsMul = 1 + opsPct / 100;
  const profitMul = 1 + profitPct / 100;

  // sim-harness (2026-09-13): capture per-price failures and alert once
  // after the loop. Prior behaviour swallowed each failure with a bare
  // console.error, letting a partially-broken supplier reply look successful.
  const productNameById = new Map(products.map((pr) => [pr.id, pr.name]));
  const failed: Array<{ product_id: number; product_name: string; reason: string }> = [];
  let created = 0;
  for (const p of extract.prices) {
    const sale = round2(p.cost_price * opsMul * profitMul);
    try {
      await createDailyPrice(env, {
        supplier_id: supplier.id,
        product_id: p.product_id,
        packaging_id: p.packaging_id,
        cost_price: p.cost_price,
        sale_price: sale,
        actual_weight_kg: p.actual_weight_kg,
        source_message_id: messageId,
        raw_reply: messageText,
      });
      created++;
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      console.error("[supplier reply] createDailyPrice failed", reason);
      failed.push({
        product_id: p.product_id,
        product_name: productNameById.get(p.product_id) ?? `product_id=${p.product_id}`,
        reason,
      });
    }
  }
  if (failed.length > 0) {
    const list = failed.map((f) => `• ${f.product_name}`).join("\n");
    await alertOwner(
      env,
      [
        `⚠️ فشل تخزين ${failed.length} سعر من رد "${supplier.name}":`,
        list,
        ``,
        `نجح ${created} من أصل ${extract.prices.length}. راجع log الـ worker لتفاصيل الأخطاء.`,
      ].join("\n"),
    );
  }

  if (pendingLog) {
    await updateSupplierLog(env, pendingLog.id, {
      x_replied_at: nowOdoo(),
      x_prices_received_count: created,
      x_status: created > 0 ? "parsed" : "replied",
    });
  }

  await writePartner(env, supplier.id, { x_last_price_submission: nowOdoo() });

  // Approved-template confirmation, if available
  const conf = await getTemplateByPurpose(env, TMPL_SUPPLIER_CONFIRM, 2);
  if (conf && isTemplateApproved(conf.x_meta_template_id) && supplier.x_whatsapp_number) {
    try {
      const res = await sendTemplate(
        env,
        supplier.x_whatsapp_number,
        conf.x_meta_template_id,
        conf.x_language || "ar",
        // 2026-09-24 — utak_supplier_confirm_v1 is «شكراً {{1}} … لـ {{2}} صنف»:
        // two variables. Sending only the count made Meta reject every send
        // (param-count mismatch) and the plain-text fallback went out instead.
        [supplier.name || "", String(created)],
        { purpose: TMPL_SUPPLIER_CONFIRM },
      );
      if (res.ok) return ""; // template already delivered — no extra text
      console.warn("[supplier reply] confirm template failed", res.status);
    } catch (e) {
      console.warn("[supplier reply] confirm template exception", (e as Error)?.message);
    }
  }

  return `تمام، استلمنا ${created} صنف بأسعار اليوم. الله يعطيك العافية 🌿`;
}

// ============================================================
// 05:00 Riyadh — recompute supplier reliability scores (last 30 days)
// ============================================================
export async function updateSupplierReliabilityScores(env: Env): Promise<void> {
  const logs = await getRecentSupplierLogs(env, 30 * 24);
  if (logs.length === 0) {
    console.log("[cron 05:00] no logs in last 30d");
    return;
  }

  // Bucket by supplier
  const bySupplier = new Map<number, SupplierLogRow[]>();
  for (const l of logs) {
    if (!Array.isArray(l.x_supplier_id)) continue;
    const sid = l.x_supplier_id[0];
    const arr = bySupplier.get(sid) ?? [];
    arr.push(l);
    bySupplier.set(sid, arr);
  }

  for (const [supplierId, sLogs] of bySupplier) {
    try {
      const sent = sLogs.length;
      const replied = sLogs.filter((l) => !!l.x_replied_at).length;
      const parsed = sLogs.filter((l) => l.x_status === "parsed").length;

      const respTimes: number[] = [];
      for (const l of sLogs) {
        if (l.x_sent_at && l.x_replied_at) {
          const dt =
            (new Date(l.x_replied_at as string).getTime() -
              new Date(l.x_sent_at).getTime()) /
            60000;
          if (dt >= 0 && dt < 24 * 60) respTimes.push(dt);
        }
      }
      const avgResp = respTimes.length
        ? respTimes.reduce((a, b) => a + b, 0) / respTimes.length
        : 999;

      const responseRate = sent > 0 ? replied / sent : 0;
      // Full speed_score under 60min, drops to 0 by 300min
      const speedScore = clamp01(1 - Math.max(0, avgResp - 60) / 240);
      const extractionRate = replied > 0 ? parsed / replied : 0;

      const score = round1(
        responseRate * 40 + speedScore * 30 + extractionRate * 30,
      );

      await writePartner(env, supplierId, {
        x_reliability_score: score,
        x_avg_response_time_minutes: round1(avgResp),
      });
      console.log(
        `[cron 05:00] supplier=${supplierId} score=${score} sent=${sent} replied=${replied} parsed=${parsed} avgResp=${round1(avgResp)}min`,
      );
    } catch (e) {
      console.error(`[cron 05:00] supplier ${supplierId} failed`, (e as Error)?.message);
    }
  }
}

// ============================================================
// 06:00 Riyadh — open the ordering window (KV flag) + morning report
// ============================================================
export async function openOrderingWindow(env: Env): Promise<void> {
  const today = riyadhDateKey();

  // Always open — 4h after the 02:00 ask is enough waiting time.
  await env.MSG_DEDUP.put(ORDERING_OPEN_KEY(today), "true", {
    expirationTtl: ORDERING_OPEN_TTL_SECONDS,
  });
  console.log(`[cron 06:00] ordering opened for ${today}`);

  // Ping Baraa about suppliers who did not reply (last ~5h window)
  try {
    const recent = await getRecentSupplierLogs(env, 5);
    const sent = recent.length;
    const replied = recent.filter((l) => !!l.x_replied_at).length;
    const missingIds = recent
      .filter((l) => !l.x_replied_at && Array.isArray(l.x_supplier_id))
      .map((l) => (l.x_supplier_id as [number, string])[0]);

    if (sent === 0) {
      await alertOwner(
        env,
        "☀️ صباح الخير براء — ما فيه طلبات أسعار انرسلت الليلة (لعل القوالب لسا PENDING).",
      );
      return;
    }
    if (missingIds.length === 0) {
      await alertOwner(env, `☀️ صباح الخير — كل الموردين (${sent}) ردوا. الاستقبال مفتوح 🌿`);
      return;
    }

    const names = await getPartnerNames(env, missingIds);
    const list = names.map((s) => `• ${s.name}`).join("\n");
    await alertOwner(
      env,
      `☀️ صباح الخير براء\n\nالموردين اللي ما ردوا (${missingIds.length}/${sent}):\n${list}\n\nالاستقبال مفتوح على أي حال، مع أسعار من رد فقط.`,
    );
    void replied; // (metric already in text above)
  } catch (e) {
    console.error("[cron 06:00] morning report failed", (e as Error)?.message);
  }
}

// ============================================================
// helpers
// ============================================================
async function alertOwner(env: Env, text: string): Promise<void> {
  try {
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("alertOwner failed", (e as Error)?.message);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
