// v3 — Supplier orchestration.
// - askAllSuppliersForPrices: 02:00 cron, sends the daily price ask template.
// - handleSupplierReply:      called by index.ts when a known supplier writes in.
// - updateSupplierReliabilityScores: 05:00 cron, recomputes x_reliability_score.
// - openOrderingWindow:       06:00 cron, sets the KV flag + pings Baraa if late.
// 2026-09-25 (WA-SCENARIOS م5 / م6 / م7):
// - nudgeLateSuppliers:          05:00 cron, ONE reminder to a still-silent supplier.
// - alertSuppliersWithoutPrices: 21:15 cron, one owner alert per still-silent supplier.
// - handleSupplierMedia / a reply with no readable price: «وصلتنا» + owner alert, no price.
// - handleSupplierButton:        the confirmation's «تعديل الأسعار» / «توقف اليوم» / «شكراً».

import type { Env } from "./config";
import { joinCapped } from "./wa-params";
import {
  DEFAULT_OPS_MARGIN_PCT,
  DEFAULT_PROFIT_MARGIN_PCT,
  ORDERING_HOURS_OPEN,
  ORDERING_OPEN_KEY,
  ORDERING_OPEN_TTL_SECONDS,
  TMPL_SUPPLIER_ASK,
  TMPL_SUPPLIER_CONFIRM,
  TMPL_SUPPLIER_PRICE_NUDGE,
  PRICE_OUTLIER_RATIO,
} from "./config";
import type { OdooPartner, SupplierLogRow, SupplierPriceItem } from "./types";
import {
  call,
  createDailyPrice,
  createSupplierAskLog,
  fetchSupplierCatalog,
  getActivePricingConfig,
  getActiveSuppliersForAsk,
  getLastSupplierPrice,
  getLatestSupplierLog,
  getPartnerNames,
  getRecentSupplierLogs,
  getSupplierPendingLog,
  getTemplateByPurpose,
  updateSupplierLog,
  writePartner,
} from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { cutoffLabel, sendOwnerAlert, sendTemplateByPurpose, supplierAskParams, SUPPLIER_ASK_LEGACY } from "./templates";
import { extractSupplierPrices } from "./claude";
import { odooUtcToRiyadhHHMM, riyadhDateKey, riyadhHHMM, riyadhMinutes } from "./hours";
import { isSkippedDuplicate } from "./auto-send-guard";

const nowOdoo = (): string => new Date().toISOString().replace("T", " ").slice(0, 19);

const isTemplateApproved = (metaId: string | undefined | null): boolean =>
  !!metaId && typeof metaId === "string" && !metaId.startsWith("PENDING_");

// ============================================================
// 2026-09-25 (م6) — replies the bot cannot read as prices, and no guessed price
// ============================================================

/** Sent to a supplier whose message (free text, voice, image …) holds no readable price. */
export const SUPPLIER_ACK_TEXT = "وصلتنا رسالتك في يو تاك، والفريق بيراجعها ويرد عليك 🌿";

/** Every number written in a message (Arabic-Indic digits, «٫» and thousands commas normalised). */
export function numbersInText(text: string): number[] {
  const s = String(text ?? "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, ".")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  return [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/**
 * No guessed price is ever saved: an extracted price stays only when its
 * product is one this supplier supplies, its packaging belongs to that
 * product, and its number is written in the message itself. The rest is
 * dropped (and reported to the owner), never stored.
 */
export function checkExtractedPrices(
  prices: SupplierPriceItem[],
  products: Array<{ id: number }>,
  packagings: Array<{ id: number; product_id: number }>,
  text: string,
): { kept: SupplierPriceItem[]; dropped: Array<{ item: SupplierPriceItem; reason: string }> } {
  const productIds = new Set(products.map((p) => p.id));
  const written = numbersInText(text);
  const kept: SupplierPriceItem[] = [];
  const dropped: Array<{ item: SupplierPriceItem; reason: string }> = [];
  for (const p of prices) {
    if (!productIds.has(p.product_id)) dropped.push({ item: p, reason: "صنف لا يورّده" });
    else if (!packagings.some((k) => k.id === p.packaging_id && k.product_id === p.product_id)) dropped.push({ item: p, reason: "تعبئة لا تخص الصنف" });
    else if (!written.some((n) => Math.abs(n - p.cost_price) < 0.005)) dropped.push({ item: p, reason: "السعر غير مكتوب في الرسالة" });
    else kept.push(p);
  }
  return { kept, dropped };
}

/** An outlier: the new price differs from the last one by PRICE_OUTLIER_RATIO or more, either way. */
export function isPriceOutlier(last: number, next: number): boolean {
  if (!(last > 0) || !(next > 0)) return false;
  return Math.max(last, next) / Math.min(last, next) >= PRICE_OUTLIER_RATIO;
}


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

      // STATUS § 33 — the resolved row goes to the gateway, which sends it only
      // if Meta approved it as UTILITY (the legacy utak_supplier_daily_ask is
      // MARKETING and is never used for this operational ask).
      const res = await sendViaGateway(env, {
        purpose: TMPL_SUPPLIER_ASK,
        to: s.x_whatsapp_number,
        content: { kind: "template", row: tmpl, params: supplierAskParams(tmpl.x_meta_template_id, supplierName, productList) },
      });
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
      // a second x_wa_message row for the same send: the gateway's echo
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
    await alertOwner(env, `⚠️ فشل استخراج الأسعار من "${supplier.name}"، ولم يُحفظ أي سعر.\n\n${trunc(messageText, 400)}`);
    return SUPPLIER_ACK_TEXT;
  }

  // 2026-09-25 (م6) — only prices the message really states (checkExtractedPrices).
  const check = checkExtractedPrices(extract.prices, products, packagings, messageText);
  if (!check.kept.length) {
    if (pendingLog) {
      await updateSupplierLog(env, pendingLog.id, {
        x_replied_at: nowOdoo(),
        x_status: "replied",
      });
    }
    // Free text, a greeting, a bare number: «وصلتنا» to the supplier and the
    // text to the owner right away (was: «أرسل بصيغة…», and an alert only
    // above 15 characters). Nothing is saved.
    await alertOwner(
      env,
      `🤔 رد من المورد "${supplier.name}" ما فهمناه كأسعار، ولم يُحفظ أي سعر${check.dropped.length ? ` (استُبعد ${check.dropped.length} سعراً مخمَّناً)` : ""}. رددنا بأن الفريق بيراجعه.\n\nالنص: ${trunc(messageText, 600)}`,
    );
    return SUPPLIER_ACK_TEXT;
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
  const packagingNameById = new Map(packagings.map((k) => [k.id, k.name]));
  const failed: Array<{ product_id: number; product_name: string; reason: string }> = [];
  let created = 0;
  for (const p of check.kept) {
    const sale = round2(p.cost_price * opsMul * profitMul);
    try {
      // 2026-09-25 — an outlier is saved and used, marked for review, and
      // the owner hears of it at once (one alert per price, not batched).
      const last = await getLastSupplierPrice(env, supplier.id, p.product_id, p.packaging_id).catch(() => null);
      const outlier = !!last && isPriceOutlier(last.price, p.cost_price);
      await createDailyPrice(env, {
        supplier_id: supplier.id,
        product_id: p.product_id,
        packaging_id: p.packaging_id,
        cost_price: p.cost_price,
        sale_price: sale,
        actual_weight_kg: p.actual_weight_kg,
        source_message_id: messageId,
        raw_reply: messageText,
        extraction_status: outlier ? "pending" : "extracted",
      });
      created++;
      if (outlier && last) {
        const pct = Math.round(((p.cost_price - last.price) / last.price) * 100);
        await alertOwner(
          env,
          `⚠️ سعر شاذ من المورد "${supplier.name}": ${productNameById.get(p.product_id) ?? p.product_id} (${packagingNameById.get(p.packaging_id) ?? p.packaging_id})\nآخر سعر: ${last.price} ريال${last.date ? ` (${last.date})` : ""}\nالسعر الجديد: ${p.cost_price} ريال (${pct > 0 ? "+" : ""}${pct}%)\nحُفظ ويُستخدم، وعُلّم للمراجعة (x_extraction_status = pending). لم يُرفض.`,
        );
      }
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
        `نجح ${created} من أصل ${check.kept.length}. راجع log الـ worker لتفاصيل الأخطاء.`,
      ].join("\n"),
    );
  }
  if (check.dropped.length > 0) {
    await alertOwner(
      env,
      [
        `⚠️ من رد المورد "${supplier.name}" حُفظ ${created} سعراً، واستُبعد ${check.dropped.length} لأنه غير واضح في الرسالة (لم يُحفظ):`,
        ...check.dropped.map((d) => `• ${productNameById.get(d.item.product_id) ?? `صنف ${d.item.product_id}`} ${d.item.cost_price}: ${d.reason}`),
        ``,
        `النص: ${trunc(messageText, 400)}`,
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

  // 2026-09-25 (STATUS § 35) — «💰 أسعار اليوم» follows the prices at once
  // (the */5 tick would within five minutes). Never blocks the reply.
  if (created > 0) {
    try {
      const { refreshPriceDay } = await import("./prices");
      await refreshPriceDay(env);
    } catch (e) {
      console.warn("[supplier reply] prices refresh failed", (e as Error)?.message);
    }
  }

  // Approved-template confirmation, if available. 2026-09-24 —
  // utak_supplier_confirm_v1 is «شكراً {{1}} … لـ {{2}} صنف»: two variables.
  // 2026-09-25 (م7) — its three buttons now carry payloads (supplierButtonAction).
  const thanks = `تمام، استلمنا ${created} صنف بأسعار اليوم. الله يعطيك العافية 🌿`;
  if (supplier.x_whatsapp_number) {
    // STATUS § 33 — one gateway request: the template with its buttons, else
    // the thank-you text (the supplier just wrote, so the window is open). No
    // second message after Meta refuses the first.
    try {
      await sendTemplateByPurpose(env, supplier.x_whatsapp_number, TMPL_SUPPLIER_CONFIRM,
        [supplier.name || "", String(created)], SUPPLIER_CONFIRM_BUTTONS, undefined,
        { fallback: [textContent(thanks)] });
      return "";
    } catch (e) {
      console.warn("[supplier reply] confirm send exception", (e as Error)?.message);
    }
  }

  return thanks;
}

// ============================================================
// 2026-09-25 (م6) — a supplier's voice note / image / document
// ============================================================

const MEDIA_KIND: Record<string, string> = {
  audio: "رسالة صوتية", image: "صورة", video: "فيديو", document: "مستند", sticker: "ملصق",
};

/**
 * No speech-to-text, no OCR: «وصلتنا» to the supplier, the ask log marked
 * replied, and the owner told at once. No price is saved from media.
 */
export async function handleSupplierMedia(
  env: Env,
  supplier: { id: number; name: string },
  msg: { type: string; from: string; text?: string },
): Promise<string> {
  const log = await getSupplierPendingLog(env, supplier.id).catch(() => null);
  if (log) await updateSupplierLog(env, log.id, { x_replied_at: nowOdoo(), x_status: "replied" }).catch(() => {});
  const kind = MEDIA_KIND[msg.type] ?? `رسالة (${msg.type})`;
  await alertOwner(
    env,
    `${msg.type === "audio" ? "🎤" : "📎"} ${kind} من المورد "${supplier.name}" (${msg.from}): لا تُقرأ آلياً، ولم يُحفظ أي سعر. رددنا بأن الفريق بيراجعها؛ افتح محادثته في Discuss.${msg.text ? `\n\nالنص المرفق: ${trunc(msg.text, 400)}` : ""}`,
  );
  return SUPPLIER_ACK_TEXT;
}

// ============================================================
// 2026-09-25 (م7) — the confirmation template's three buttons
// ============================================================

/** utak_supplier_confirm_v1 buttons, in template order: «تعديل الأسعار», «توقف اليوم», «شكراً». */
export const SUPPLIER_BUTTON = { edit: "supplier_edit", stop: "supplier_stop", thanks: "supplier_thanks" } as const;
const SUPPLIER_CONFIRM_BUTTONS = [
  { index: 0, payload: SUPPLIER_BUTTON.edit },
  { index: 1, payload: SUPPLIER_BUTTON.stop },
  { index: 2, payload: SUPPLIER_BUTTON.thanks },
];
export const SUPPLIER_EDIT_TEXT = "تمام، أرسل الأسعار المعدلة بنفس الصيغة (الصنف، التعبئة، السعر)، ونعتمد الأحدث.";
export const SUPPLIER_STOP_TEXT = "تمام، سجّلنا توقفك اليوم. الله يعطيك العافية.";
export type SupplierButton = "edit" | "stop" | "thanks";

/**
 * A tap on the confirmation's buttons. By payload, or by the button text for
 * confirmations sent before the payloads existed. Null for anything else.
 */
export function supplierButtonAction(msg: { type: string; buttonId?: string; text?: string }): SupplierButton | null {
  if (msg.type !== "button" && msg.type !== "interactive") return null;
  const id = String(msg.buttonId ?? "");
  const t = String(msg.text ?? "").trim();
  if (id === SUPPLIER_BUTTON.edit || t === "تعديل الأسعار") return "edit";
  if (id === SUPPLIER_BUTTON.stop || t === "توقف اليوم") return "stop";
  if (id === SUPPLIER_BUTTON.thanks || t === "شكراً" || t === "شكرا") return "thanks";
  return null;
}

/**
 * «تعديل الأسعار» → ask for the corrected prices (the newest is used);
 * «توقف اليوم» → noted on the latest ask log (x_name) + the owner alerted once
 * per day; «شكراً» → no reply. None of them reaches the price extractor.
 */
export async function handleSupplierButton(
  env: Env,
  supplier: { id: number; name: string },
  action: SupplierButton,
): Promise<string> {
  if (action === "thanks") return "";
  if (action === "edit") return SUPPLIER_EDIT_TEXT;
  const key = `supplier_stop:${supplier.id}:${riyadhDateKey()}`;
  if (await env.MSG_DEDUP.get(key)) return SUPPLIER_STOP_TEXT; // a second tap: no second alert
  const at = riyadhHHMM();
  await env.MSG_DEDUP.put(key, at, { expirationTtl: 2 * 24 * 3600 });
  const log = await getLatestSupplierLog(env, supplier.id).catch(() => null);
  if (log) {
    await updateSupplierLog(env, log.id, {
      x_name: `توقف اليوم ${at}`,
      ...(log.x_replied_at ? {} : { x_replied_at: nowOdoo(), x_status: "replied" }),
    }).catch((e) => console.warn("[supplier stop] log write failed", (e as Error)?.message));
  }
  await alertOwner(
    env,
    `⛔ المورد "${supplier.name}" ضغط «توقف اليوم» الساعة ${at}${log ? `، وسُجّل على طلب الأسعار #${log.id}` : ""}. أسعاره المستلمة اليوم باقية كما هي.`,
  );
  return SUPPLIER_STOP_TEXT;
}

// ============================================================
// 2026-09-25 (م5) — a supplier who has not sent prices
// ============================================================

/** Today's (Riyadh) ask logs still waiting for a reply. «no_reply» = the ask never reached him (ت13). */
async function silentAskLogs(env: Env): Promise<SupplierLogRow[]> {
  const hours = riyadhMinutes() / 60 + 0.1;
  return (await getRecentSupplierLogs(env, hours)).filter((l) => l.x_status === "sent" && !l.x_replied_at && Array.isArray(l.x_supplier_id));
}
const nudgeKey = (logId: number) => `supplier_nudge:${logId}`;

/**
 * 05:00 Riyadh (3h after the 02:00 ask) — ONE reminder to each supplier whose
 * ask is still unanswered: utak_supplier_price_nudge «… نحتاجها قبل الساعة
 * 6:00 صباحاً». The KV key is taken before the send, so a re-run, a retry or
 * a failed send never makes a second reminder. Without a mapped template the
 * reminder goes as text inside the 24h window only.
 */
export async function nudgeLateSuppliers(env: Env): Promise<{ nudged: number; skipped: number }> {
  const logs = await silentAskLogs(env);
  let nudged = 0, skipped = 0;
  const ids = [...new Set(logs.map((l) => (l.x_supplier_id as [number, string])[0]))];
  const partners = ids.length
    ? await call<Array<{ id: number; name: string; x_whatsapp_number: string | false }>>(env, "res.partner", "read", {
        ids, fields: ["id", "name", "x_whatsapp_number"],
      })
    : [];
  const byId = new Map(partners.map((p) => [p.id, p]));
  const needBy = cutoffLabel(ORDERING_HOURS_OPEN);
  for (const l of logs) {
    const p = byId.get((l.x_supplier_id as [number, string])[0]);
    if (!p?.x_whatsapp_number || (await env.MSG_DEDUP.get(nudgeKey(l.id)))) { skipped++; continue; }
    await env.MSG_DEDUP.put(nudgeKey(l.id), riyadhHHMM(), { expirationTtl: 2 * 24 * 3600 });
    try {
      const name = String(p.name || "").replace(/\s+/g, " ").trim();
      // STATUS § 33 — the approved template, else the same reminder as text
      // inside the supplier's window (held for it otherwise, until the day ends).
      const r = await sendTemplateByPurpose(env, p.x_whatsapp_number, TMPL_SUPPLIER_PRICE_NUDGE, [name, needBy], [], undefined,
        { fallback: [textContent(`تذكير من يو تاك: ما وصلتنا أسعارك اليوم للحين، نحتاجها قبل الساعة ${needBy} لو سمحت.`)] });
      const d = gatewayDecision(r);
      if (d?.action === "template" || d?.action === "session") nudged++;
      else {
        if (d?.action === "held") console.warn(`[supplier nudge] ${p.name}: held until they write — ${d.reason}`);
        skipped++;
      }
    } catch (e) {
      skipped++;
      console.error(`[supplier nudge] ${p.name} failed`, (e as Error)?.message);
    }
  }
  console.log(`[cron 05:00] supplier nudge: nudged=${nudged} skipped=${skipped} silent=${logs.length}`);
  return { nudged, skipped };
}

/**
 * 21:15 Riyadh, when the purchase list is built — one owner alert per supplier
 * still silent (not batched), once per ask. His items go on the list without
 * a price from him today.
 */
export async function alertSuppliersWithoutPrices(env: Env): Promise<{ alerted: number }> {
  const logs = await silentAskLogs(env);
  let alerted = 0;
  const now = riyadhHHMM();
  for (const l of logs) {
    const key = `supplier_noprice_alert:${l.id}`;
    if (await env.MSG_DEDUP.get(key)) continue;
    await env.MSG_DEDUP.put(key, now, { expirationTtl: 2 * 24 * 3600 });
    const nudgedAt = await env.MSG_DEDUP.get(nudgeKey(l.id));
    await alertOwner(
      env,
      `⚠️ المورد "${(l.x_supplier_id as [number, string])[1]}" لم يرسل أسعار اليوم حتى بناء قائمة الشراء (${now}). طُلبت منه الساعة ${odooUtcToRiyadhHHMM(l.x_sent_at)}، و${nudgedAt ? `ذُكّر مرة واحدة الساعة ${nudgedAt}` : "لم يُرسل له تذكير"}. أصنافه في القائمة بلا سعر منه اليوم.`,
    );
    alerted++;
  }
  console.log(`[cron 21:15] suppliers without prices: alerted=${alerted} silent=${logs.length}`);
  return { alerted };
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
