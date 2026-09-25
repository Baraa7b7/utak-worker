// Intent dispatch. Each case returns the reply payload to send back.
// A reply can be plain text OR interactive buttons.
// { text: "" } means "no reply".

import type { Env } from "./config";
import type { Intent, NormalizedMessage, OdooPartner, SenderType } from "./types";
import { composeReply, extractOrderItems } from "./claude";
import {
  addOrderLines,
  createQuotationRecord,
  fetchCatalog,
  findDeactivatedProductMatches,
  findOrCreateTodayOrder,
  getOrderSummary,
  getPartnerLocation,
  getPartnerNeighborhood,
  logMessageAnalysis,
  setOrderLocation,
  setOrderNeighborhood,
  updateOrderState,
} from "./odoo";
import { sendText } from "./meta";
import { sendOwnerAlert } from "./templates";
import {
  containsUrgencyKeywords,
  isOrderingHoursOpen,
  isQuotationTrigger,
  isWithinOrderingWindow,
  riyadhDateKey,
} from "./hours";
import {
  appendPurchaseListNote,
  getOrderBrief,
  getOrderLineItems,
  getPurchaseListBrief,
  type LateItem,
} from "./odoo";
import { ALREADY_DONE_TEXT, withButtonLock } from "./button-lock";
import { handleLateNo, handleLateYes, offerLateOrder } from "./late-order";
import { cancelSaleOrderForDailyOrder, ensureSaleOrderForDailyOrder } from "./sale-accounting";
import {
  notifyCustomerDelivered,
  warehouseConfirmedPurchase,
} from "./team";
import { markStopDelivered, markStopIssue } from "./odoo";
import { looksLikeComplaint, handleComplaint } from "./complaint";
import { handleStandingConfirm, handleStandingEdit, handleStandingSkip } from "./standing";

export interface RouterInput {
  msg: NormalizedMessage;
  intent: Intent;
  senderType: SenderType;
  partner: OdooPartner | null;
}

export interface RouterReply {
  text?: string;
  buttons?: Array<{ id: string; title: string }>;
  bodyBeforeButtons?: string;
}

// --------------------------------------------------------------
// Main dispatch
// --------------------------------------------------------------
export async function dispatch(env: Env, input: RouterInput): Promise<RouterReply> {
  const { msg, intent, senderType, partner } = input;

  // ---- Button replies short-circuit intent classification ----
  if (msg.buttonId) {
    return await handleButton(env, msg.buttonId, partner);
  }

  // ---- v6.3: Complaint keyword short-circuit (customers only) ----
  if (
    senderType === "customer" &&
    partner?.id &&
    msg.text &&
    looksLikeComplaint(msg.text)
  ) {
    const reply = await handleComplaint(env, partner.id, partner.name || "", msg.text);
    await logMessageAnalysis(env, {
      customerId: partner.id,
      text: msg.text,
      intent: "complaint",
      actionTaken: "complaint:auto_created",
    });
    return { text: reply };
  }

  // Silent analytics (fire-and-forget inside function)
  await logMessageAnalysis(env, {
    customerId: partner?.id ?? null,
    text: msg.text,
    intent,
    actionTaken: "", // filled below when meaningful
  });

  switch (intent) {
    case "greeting": {
      const name = partner?.name || msg.profileName || "";
      return {
        text: name
          ? `أهلاً ${name}، حياك الله في UTAK. كيف نقدر نساعدك؟`
          : `أهلاً وسهلاً في UTAK. كيف نقدر نساعدك؟`,
      };
    }

    case "supplier_price_reply":
      // v3+: suppliers are routed directly from index.ts before reaching here.
      // This case only fires if a non-supplier phone was misclassified.
      return { text: "" };

    case "place_order":
    case "add_to_order":
      return await handleOrderMessage(env, input);

    case "request_quotation":
      return await handleQuotationRequest(env, input);

    case "product_inquiry":
      // v2: don't quote prices — that's v3 (daily prices flow).
      return {
        text: "عندنا خضار وفواكه طازجة يومياً. قل لي إيش تحتاج بالضبط والكميات، وأنا أجهز لك الطلب 🌿",
      };

    case "complaint":
    case "other": {
      const context = [
        `Sender type: ${senderType}`,
        `Intent: ${intent}`,
        `Partner name: ${partner?.name ?? "unknown"}`,
        `Message: ${msg.text}`,
        ``,
        `Reply appropriately in Arabic per the system rules.`,
      ].join("\n");
      return { text: await composeReply(env, context) };
    }

    // v2 shouldn't classify these directly, but be safe:
    case "confirm_order":
    case "edit_order":
    case "cancel_order":
      return { text: "استخدم الأزرار الظاهرة تحت الكوتيشن، لو سمحت 🙏" };
  }
}

// --------------------------------------------------------------
// Order intake (place_order / add_to_order)
// --------------------------------------------------------------
async function handleOrderMessage(env: Env, input: RouterInput): Promise<RouterReply> {
  const { msg, partner } = input;
  if (!partner) {
    return { text: "حصل خطأ في تسجيلك، نعتذر — نتواصل معك قريباً 🌿" };
  }

  // Also accept "خلاص/جهزه" tacked on the end of an order message
  const quotationInline = isQuotationTrigger(msg.text);

  // Ordering hours check (v3: also honours the 06:00 KV flag).
  // 2026-09-24 (ح2): no more «يوصلك بكرة» with nothing recorded — the items
  // are parsed and the customer chooses «سجّله لبكرة» / «لا شكراً».
  if (!(await isOrderingHoursOpen(env))) {
    return await handleClosedHoursOrder(env, input);
  }

  const catalog = await fetchCatalog(env);
  // 2026-09-15: fetchCatalog is now filtered by x_is_active_for_sale.
  // Empty catalog can mean either a genuine cache-miss race OR (much more
  // likely on a fresh setup) that Baraa hasn't activated any products yet.
  // We still respond with a soft retry — the failure signal for "nothing
  // active" ends up in the alert emitted below, once the customer names
  // something specific.
  const items = catalog.length === 0
    ? await extractOrderItems(env, msg.text, catalog, partner.name)
    : await extractOrderItems(env, msg.text, catalog, partner.name);
  const active = items.filter((it) => it.product_id > 0 && it.packaging_id > 0);
  const unknownRaw = items.filter((it) => it.product_id === 0);

  // 2026-09-15: reverse-lookup the raw names against products flagged
  // x_is_active_for_sale=false. A hit means the customer explicitly asked
  // for a product Baraa has deactivated — worth alerting on as market intel.
  // A miss means the product simply doesn't exist in Odoo (the existing
  // "not in catalog" warning still applies).
  const deactivatedMatches = await findDeactivatedProductMatches(
    env,
    unknownRaw.map((it) => it.product_name_raw),
  );
  const deactivatedRawSet = new Set(deactivatedMatches.map((m) => m.raw));
  const trulyUnknown = unknownRaw.filter(
    (it) => !deactivatedRawSet.has(it.product_name_raw.trim()),
  );

  // Empty-hands short-circuit — nothing to add, nothing to alert on.
  if (active.length === 0 && trulyUnknown.length === 0 && deactivatedMatches.length === 0) {
    return {
      text: "ما قدرت أفهم الأصناف من رسالتك. اكتب لي مثلاً: طماطم كرتون 3، خيار جرم 5.",
    };
  }

  // Alert Baraa once per intake — grouped, not per-line — when the customer
  // asked for at least one deactivated item. Framed as market intel, not an
  // error: this signal is why we track the flag at all.
  if (deactivatedMatches.length > 0 && env.OWNER_WHATSAPP) {
    const names = deactivatedMatches.map((m) => `• ${m.product_name}`).join("\n");
    const alertText = [
      `📈 طلب على أصناف غير مفعّلة اليوم`,
      `العميل: ${partner.name || "بدون اسم"}${partner.x_whatsapp_number ? " — " + partner.x_whatsapp_number : ""}`,
      ``,
      names,
    ].join("\n");
    try {
      await sendOwnerAlert(env, alertText);
    } catch (e) {
      console.warn("[order] alertOwner (deactivated) failed", (e as Error)?.message);
    }
  }

  // If the entire request is inactive/unknown — no order gets created.
  // Reply politely without exposing the internal reason.
  if (active.length === 0) {
    return {
      text: "بعض الأصناف مو متوفرة اليوم — سجّلنا باقي طلبك 🌿",
    };
  }

  // Find or create today's draft order — only when we actually have
  // something active to add. This is the "لا يُنشأ طلب" branch when
  // active.length === 0 above.
  const { id: orderId, created } = await findOrCreateTodayOrder(
    env,
    partner.id,
    undefined,
    msg.messageId,
  );

  if (active.length > 0) {
    await addOrderLines(env, orderId, active);
  }

  // Build summary line for reply
  const addedSummary = active
    .map((it) => {
      const prod = catalog.find((p) => p.id === it.product_id);
      const pk = prod?.packagings.find((x) => x.id === it.packaging_id);
      const pname = prod?.name ?? it.product_name_raw;
      const pkname = pk?.name ?? "";
      return `• ${pname} ${pkname} × ${it.quantity}`;
    })
    .join("\n");

  // Customer-facing signal for the mixed case (some active + some
  // deactivated OR some active + some genuinely unknown). Same soft line for
  // both — the internal distinction (deactivated vs unknown) leaks nowhere.
  const unavailableWarn = deactivatedMatches.length + trulyUnknown.length > 0
    ? `\n\n🌿 بعض الأصناف مو متوفرة اليوم — سجّلنا باقي طلبك.`
    : "";

  const urgencyNote = containsUrgencyKeywords(msg.text)
    ? `\n\n📌 توصيلاتنا مجدولة صباحاً — طلبك يوصلك بكرة إن شاء الله.`
    : "";

  // If customer also said "خلاص/جهزه" in same message, go straight to quotation
  if (quotationInline) {
    // v4.2: precise location preferred; saved neighborhood text is acceptable
    // fallback. Missing both → park the flow and ask for a location share.
    const loc = await getPartnerLocation(env, partner.id);
    const neigh = loc?.neighborhood || (await getPartnerNeighborhood(env, partner.id));
    if (!loc && !neigh) {
      await env.MSG_DEDUP.put(
        `pending_neighborhood:${partner.id}`,
        String(orderId),
        { expirationTtl: 60 * 30 },
      );
      return {
        text: [
          (created ? "بديت لك طلب جديد ✅" : "أضفنا لطلبك ✅"),
          addedSummary,
          unavailableWarn,
          urgencyNote,
          ``,
          `📍 قبل ما نجهّز الكوتيشن — أرسل موقع التوصيل`,
          `اضغط 📎 → موقع → إرسال موقعي الحالي`,
          `(أو موقع محدد لو التوصيل لمكان ثاني)`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    // Carry saved defaults down to the order record
    if (loc) {
      await setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
    } else if (neigh) {
      await setOrderNeighborhood(env, orderId, neigh);
    }
    const deliveryLine = loc
      ? `📍 التوصيل إلى: ${loc.neighborhood || "الموقع المحفوظ"} (${loc.mapUrl})`
      : `📍 التوصيل إلى: ${neigh}`;
    const q = await createQuotationRecord(env, orderId);
    await updateOrderState(env, orderId, "waiting_confirmation");
    return {
      bodyBeforeButtons: [
        (created ? "بديت لك طلب جديد ✅" : "أضفنا لطلبك ✅"),
        addedSummary,
        unavailableWarn,
        urgencyNote,
        ``,
        deliveryLine,
        `📄 الكوتيشن رقم ${q.number} — راجع الأصناف واختر:`,
      ]
        .filter(Boolean)
        .join("\n"),
      buttons: quotationButtons(orderId),
    };
  }

  return {
    text: [
      (created ? "بديت لك طلب جديد ✅" : "أضفنا لطلبك ✅"),
      addedSummary,
      unavailableWarn,
      urgencyNote,
      ``,
      `تبغى تضيف شي ثاني، ولا نجهز الكوتيشن؟ (اكتب "خلاص" لما تخلّص)`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// --------------------------------------------------------------
// ح2 — an order written while ordering is closed
// --------------------------------------------------------------
async function handleClosedHoursOrder(env: Env, input: RouterInput): Promise<RouterReply> {
  const { msg, partner } = input;
  if (!partner) return { text: "حصل خطأ في تسجيلك، نعتذر — نتواصل معك قريباً 🌿" };
  const catalog = await fetchCatalog(env);
  const items = await extractOrderItems(env, msg.text, catalog, partner.name);
  const late: LateItem[] = items
    .filter((it) => it.product_id > 0 && it.packaging_id > 0 && it.quantity > 0)
    .map((it) => {
      const prod = catalog.find((p) => p.id === it.product_id);
      const pk = prod?.packagings.find((x) => x.id === it.packaging_id);
      return {
        product_id: it.product_id,
        packaging_id: it.packaging_id,
        quantity: it.quantity,
        notes: it.notes || "",
        label: `${prod?.name ?? it.product_name_raw} ${pk?.name ?? ""} × ${it.quantity}`.replace(/ {2,}/g, " "),
      };
    });
  if (late.length === 0) {
    return {
      text: "استقبال الطلبات مقفل الآن (من 6:00 صباحاً إلى 9:00 مساءً)، وما تسجّل شي. اكتب الأصناف والكميات (مثلاً: طماطم كرتون 3) ونعرض عليك تسجيلها على طلبات بكرة 🌿",
    };
  }
  return await offerLateOrder(env, partner.id, late);
}

// --------------------------------------------------------------
// Quotation request
// --------------------------------------------------------------
async function handleQuotationRequest(env: Env, input: RouterInput): Promise<RouterReply> {
  const { partner, msg } = input;
  if (!partner) return { text: "حصل خطأ، نعتذر." };

  // Find the customer's open order today
  const { id: orderId, created } = await findOrCreateTodayOrder(
    env,
    partner.id,
    undefined,
    msg.messageId,
  );
  if (created) {
    // No prior order today — nothing to quote
    return { text: "ما عندك طلب مفتوح اليوم. ابدأ بكتابة الأصناف اللي تحتاجها." };
  }

  const summary = await getOrderSummary(env, orderId);
  if (!summary || summary.lines.length === 0) {
    return { text: "طلبك فاضي — أضف أصناف أول ثم أجهز الكوتيشن." };
  }

  // v4.2: precise location preferred; saved neighborhood text is acceptable
  // fallback. Missing both → park the flow and ask for a location share.
  const loc = await getPartnerLocation(env, partner.id);
  const neigh = loc?.neighborhood || (await getPartnerNeighborhood(env, partner.id));
  if (!loc && !neigh) {
    await env.MSG_DEDUP.put(
      `pending_neighborhood:${partner.id}`,
      String(orderId),
      { expirationTtl: 60 * 30 },
    );
    return {
      text: [
        `📍 قبل ما نجهّز الكوتيشن — أرسل موقع التوصيل`,
        `اضغط 📎 → موقع → إرسال موقعي الحالي`,
        `(أو موقع محدد لو التوصيل لمكان ثاني)`,
      ].join("\n"),
    };
  }
  if (loc) {
    await setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
  } else if (neigh) {
    await setOrderNeighborhood(env, orderId, neigh);
  }

  const q = await createQuotationRecord(env, orderId);
  await updateOrderState(env, orderId, "waiting_confirmation");

  const linesText = summary.lines
    .map((l) => `• ${l.product} ${l.packaging} × ${l.qty}`)
    .join("\n");

  const deliveryLine = loc
    ? `📍 التوصيل إلى: ${loc.neighborhood || "الموقع المحفوظ"} (${loc.mapUrl})`
    : `📍 التوصيل إلى: ${neigh}`;

  return {
    bodyBeforeButtons: [
      `📄 الكوتيشن رقم ${q.number}`,
      linesText,
      ``,
      deliveryLine,
      `الأسعار النهائية عند التسليم. اختر:`,
    ].join("\n"),
    buttons: quotationButtons(orderId),
  };
}

function quotationButtons(orderId: number): Array<{ id: string; title: string }> {
  return [
    { id: `confirm_order_${orderId}`, title: "تأكيد الطلب ✅" },
    { id: `edit_order_${orderId}`, title: "تعديل ✏️" },
    { id: `cancel_order_${orderId}`, title: "إلغاء ❌" },
  ];
}

// --------------------------------------------------------------
// Button handlers
// --------------------------------------------------------------
async function handleButton(
  env: Env,
  buttonId: string,
  partner: OdooPartner | null,
): Promise<RouterReply> {
  // ---- v7: welcome/inactive/feedback quick-reply payloads ----
  // These come from customer_welcome, customer_inactive, customer_feedback,
  // customer_delivery_done templates. Payload defaults to button text.
  const t = (buttonId || "").trim();
  if (t === "أبغى أطلب") {
    return { text: "تمام 👍 أرسل لي الأصناف اللي تبيها والكميات، وأنا أجهّز الطلب." };
  }
  if (t === "أبغى أعرف أكثر") {
    return { text: `UTAK نوصّل خضار وفواكه طازجة كل يوم مباشرة لباب محلك 🌿

• طلب من الموبايل عبر واتساب
• توصيل يومي في وقته
• أسعار جملة تنافسية
• لا حد أدنى للطلب في الأسبوع الأول

جاهز تبدأ؟ أرسل "أبغى أطلب".` };
  }
  if (t === "عندي ملاحظة") {
    return { text: "تفضّل، اكتب لي ملاحظتك بالتفصيل وسنراجعها فوراً 🙏" };
  }
  if (t === "كل شي تمام" || t === "ممتازة") {
    return { text: "الحمدلله 🌿 شكراً لك، بنشوفك في الطلب الجاي." };
  }
  if (t === "تحتاج تحسين") {
    return { text: "أشكرك على صدقك 🙏 اكتب لي وش نقدر نحسّنه وسنشتغل عليه فوراً." };
  }

  // ---- 2026-09-24 (ح2): closed-hours prompt «سجّله لبكرة» / «لا شكراً» ----
  const mLate = /^late_(yes|no)_(\d+)$/.exec(buttonId);
  if (mLate) {
    const pid = Number(mLate[2]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? pid, text: buttonId,
      intent: `late_${mLate[1]}`, actionTaken: `button:late_${mLate[1]}:${pid}`,
    });
    return mLate[1] === "yes"
      ? await handleLateYes(env, partner, pid)
      : await handleLateNo(env, partner, pid);
  }

  // ---- v6.1: standing-order reminder buttons ----
  const mStandingConfirm = /^standing_confirm_(\d+)$/.exec(buttonId);
  if (mStandingConfirm) {
    const sid = Number(mStandingConfirm[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null, text: buttonId,
      intent: "standing_confirm", actionTaken: `button:standing_confirm:${sid}`,
    });
    // ح8/ح9: one confirmation per standing order per Riyadh day.
    let out: RouterReply = {};
    const text = await withButtonLock(env, `standing_confirm:${sid}:${riyadhDateKey()}`, async () => {
      out = await handleStandingConfirm(env, sid);
      return out.text ?? "";
    }, 26 * 60 * 60);
    if (text !== ALREADY_DONE_TEXT) return out;
    const { findLiveOrderOn } = await import("./odoo");
    const existing = partner?.id ? await findLiveOrderOn(env, partner.id, riyadhDateKey(), "standing_order") : null;
    return {
      text: existing
        ? `طلب الغد مسجّل أصلاً برقم #${existing} ✅ وما سجّلنا طلباً ثانياً.`
        : ALREADY_DONE_TEXT,
    };
  }
  const mStandingEdit = /^standing_edit_(\d+)$/.exec(buttonId);
  if (mStandingEdit) {
    const sid = Number(mStandingEdit[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null, text: buttonId,
      intent: "standing_edit", actionTaken: `button:standing_edit:${sid}`,
    });
    return { text: await handleStandingEdit(env, sid) };
  }
  const mStandingSkip = /^standing_skip_(\d+)$/.exec(buttonId);
  if (mStandingSkip) {
    const sid = Number(mStandingSkip[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null, text: buttonId,
      intent: "standing_skip", actionTaken: `button:standing_skip:${sid}`,
    });
    return { text: await handleStandingSkip(env, sid) };
  }

  // ---- v5: collector confirmed cash/transfer ----
  // ح8: cash and transfer share one lock per invoice — the button always
  // collects the full balance, so a second tap of either is a duplicate.
  const mCollect = /^collect_(cash|transfer)_(\d+)$/.exec(buttonId);
  if (mCollect) {
    const { handleCollectionButton } = await import("./invoice");
    let collected = false;
    const text = await withButtonLock(env, `collect:${mCollect[2]}`, async () => {
      const result = await handleCollectionButton(env, buttonId, partner?.id ?? null);
      collected = !!result;
      return result?.text ?? "";
    });
    // STATUS § 34 — a note on this collection reaches Baraa with the customer and the order.
    if (text && collected) {
      const { collectNoteButton } = await import("./team-note");
      return { bodyBeforeButtons: text, buttons: [collectNoteButton(Number(mCollect[2]))] };
    }
    if (text) return { text };
  }

  // ---- STATUS § 34: the collector's note («ملاحظة 📝») ----
  {
    const { COLLECT_NOTE_RE, COLLECT_NOTE_PROMPT, pendingCollectNoteKey, PENDING_NOTE_TTL } = await import("./team-note");
    const mNote = COLLECT_NOTE_RE.exec(buttonId);
    if (mNote) {
      await logMessageAnalysis(env, {
        customerId: partner?.id ?? null,
        text: buttonId,
        intent: "collection_note",
        actionTaken: `button:collect_note:${mNote[1]}`,
      });
      if (partner?.id) {
        await env.MSG_DEDUP.put(pendingCollectNoteKey(partner.id), mNote[1], { expirationTtl: PENDING_NOTE_TTL });
        await env.MSG_DEDUP.delete(`pending_issue:${partner.id}`).catch(() => {});
        await env.MSG_DEDUP.delete(`pending_purchase_issue:${partner.id}`).catch(() => {});
      }
      return { text: COLLECT_NOTE_PROMPT };
    }
  }

  // ---- v4: warehouse confirmed the purchase list ----
  const mPurchase = /^purchase_done_(\d+)$/.exec(buttonId);
  if (mPurchase) {
    const listId = Number(mPurchase[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "purchase_done",
      actionTaken: `button:purchase_done:${listId}`,
    });
    const text = await withButtonLock(env, `purchase_done:${listId}`, async () => {
      // ت14: a list already closed is not re-dispatched (no «0 سواق», no owner alert).
      const list = await getPurchaseListBrief(env, listId);
      if (list?.status === "done") return "القائمة مؤكدة من قبل ✅ والمسارات أُرسلت.";
      const { routesDispatched, ordersMoved } = await warehouseConfirmedPurchase(env, listId);
      if (partner?.id) await env.MSG_DEDUP.delete(`pending_purchase_issue:${partner.id}`).catch(() => {});
      return `تمام 👍 تم إرسال المسارات لـ ${routesDispatched} سواق (${ordersMoved} توصيلة).`;
    });
    // STATUS § 37 — the warehouse just bought: «💵 دفعت لمورد» under the reply.
    const { startButton } = await import("./supplier-pay");
    return { bodyBeforeButtons: text, buttons: [startButton()] };
  }

  // ---- 2026-09-24 (ح7): warehouse reported a problem with the purchase list ----
  const mPurchaseIssue = /^purchase_issue_(\d+)$/.exec(buttonId);
  if (mPurchaseIssue) {
    const listId = Number(mPurchaseIssue[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "purchase_issue",
      actionTaken: `button:purchase_issue:${listId}`,
    });
    if (partner?.id) {
      await env.MSG_DEDUP.put(`pending_purchase_issue:${partner.id}`, String(listId), { expirationTtl: 3 * 60 * 60 });
      await env.MSG_DEDUP.delete(`pending_issue:${partner.id}`).catch(() => {});
      await env.MSG_DEDUP.delete(`pending_collect_note:${partner.id}`).catch(() => {});
    }
    try {
      await appendPurchaseListNote(env, listId, `${partner?.name ?? "المستودع"}: ضغط «مشكلة» — بانتظار التفاصيل`);
    } catch (e) {
      console.warn("[purchase_issue] note failed", (e as Error)?.message);
    }
    await sendOwnerAlert(env, `⚠️ قائمة الشراء #${listId}: ${partner?.name ?? "المستودع"} ضغط «مشكلة». بانتظار تفاصيله نصاً، وتصلك فور كتابتها.`);
    return {
      text: "تمام، اكتب المشكلة بالتفصيل في رسالة واحدة (مثلاً: الطماطم ناقصة 5 كراتين، أو الخيار غير متوفر) وتوصل لبراء فوراً.",
    };
  }

  // ---- v4: driver marked stop delivered ----
  const mDelivered = /^delivered_(\d+)$/.exec(buttonId);
  if (mDelivered) {
    const orderId = Number(mDelivered[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "delivered",
      actionTaken: `button:delivered:${orderId}`,
    });
    const text = await withButtonLock(env, `delivered:${orderId}`, async () => {
      // ح8: an order already delivered is not delivered, invoiced or announced again.
      const brief = await getOrderBrief(env, orderId);
      if (brief && (brief.state === "delivered" || brief.state === "closed")) {
        return `${ALREADY_DONE_TEXT} الطلب #${orderId} مسجّل مسلّماً.`;
      }
      const { allDone } = await markStopDelivered(env, orderId);
      // v5: create invoice + dispatch to customer & collector
      try {
        const { createAndDispatchInvoiceForOrder } = await import("./invoice");
        await createAndDispatchInvoiceForOrder(env, orderId);
      } catch (e) {
        console.warn(`[delivered] invoice dispatch failed for order ${orderId}`, (e as Error).message);
      }
      // Fetch order + customer to notify
      try {
        const { getOrderCustomer } = await import("./odoo");
        const cust = await getOrderCustomer(env, orderId);
        if (cust) {
          await notifyCustomerDelivered(env, cust.phone, cust.name, orderId);
        }
      } catch (e) {
        console.error("[delivered] notify customer failed", (e as Error)?.message);
      }
      return allDone
        ? `تم التسليم ✅ — خلصت مسارك اليوم. شكراً 🙏`
        : `تم التسليم ✅ — التوصيلة الجاية بانتظارك.`;
    });
    return { text };
  }

  // ---- v4: driver reported issue ----
  const mIssue = /^delivery_issue_(\d+)$/.exec(buttonId);
  if (mIssue) {
    const orderId = Number(mIssue[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "delivery_issue",
      actionTaken: `button:delivery_issue:${orderId}`,
    });
    // Record placeholder issue; driver's next text becomes the note (handled below in dispatch)
    await markStopIssue(env, orderId, "(بانتظار تفاصيل من السواق)");
    // Stash pending-issue marker in KV so next text from this driver captures the note
    if (partner?.id) {
      await env.MSG_DEDUP.put(
        `pending_issue:${partner.id}`,
        String(orderId),
        { expirationTtl: 60 * 30 },
      );
      await env.MSG_DEDUP.delete(`pending_purchase_issue:${partner.id}`).catch(() => {});
      await env.MSG_DEDUP.delete(`pending_collect_note:${partner.id}`).catch(() => {});
    }
    return { text: `تمام، اكتب لي وش المشكلة بالضبط (رسالة واحدة) وأنا أسجّلها لبراء.` };
  }

  const m = /^(confirm_order|edit_order|cancel_order)_(\d+)$/.exec(buttonId);
  if (!m) {
    // ت1: a button from an old message (or a template whose payload we no
    // longer handle). Logged, and answered politely instead of «زر غير معروف».
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "unknown_button",
      actionTaken: `button:unknown:${buttonId.slice(0, 60)}`,
    });
    console.warn(`[router] unknown button id=${buttonId.slice(0, 80)}`);
    return { text: "هذا الزر من رسالة قديمة وما عاد يشتغل 🙏 اكتب لنا طلبك أو استفسارك مباشرة." };
  }
  const action = m[1];
  const orderId = Number(m[2]);

  // Log button click
  await logMessageAnalysis(env, {
    customerId: partner?.id ?? null,
    text: buttonId,
    intent: action,
    actionTaken: `button:${action}:${orderId}`,
  });

  // ح8: a double tap within 90s is answered, not re-run. Later taps go
  // through the state guards below (ح4), which read the live order state.
  let reply: RouterReply = {};
  const lockText = await withButtonLock(env, `order:${orderId}:${action}`, async () => {
    reply = action === "confirm_order"
      ? await confirmOrderButton(env, orderId, partner)
      : action === "cancel_order"
        ? await cancelOrderButton(env, orderId, partner)
        : await editOrderButton(env, orderId, partner);
    return reply.text ?? reply.bodyBeforeButtons ?? "";
  }, 90);
  return lockText === ALREADY_DONE_TEXT ? { text: ALREADY_DONE_TEXT } : reply;
}

// --------------------------------------------------------------
// ح4 — quotation buttons check the live order state before acting.
//   تأكيد: only an unconfirmed order of today, while ordering is open. It
//          never revives a cancelled order; after the cutoff it offers the
//          «سجّله لبكرة» prompt with the same items (ح2).
//   إلغاء: only before the order enters purchasing (draft / waiting /
//          confirmed). Afterwards the customer is told it is in progress and
//          the owner is alerted at once to decide.
//   تعديل: same window as إلغاء, and only while ordering is open.
// --------------------------------------------------------------
const IN_EXECUTION: ReadonlySet<string> = new Set(["in_purchase", "in_delivery", "delivered", "closed"]);

async function confirmOrderButton(env: Env, orderId: number, partner: OdooPartner | null): Promise<RouterReply> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return { text: "ما لقينا هذا الطلب. اكتب لنا طلبك من جديد 🌿" };
  if (o.state === "confirmed") return { text: `طلبك رقم #${orderId} مؤكد مسبقاً ✅` };
  if (o.state === "in_purchase" || o.state === "in_delivery") return { text: `طلبك رقم #${orderId} مؤكد وفي التنفيذ ✅` };
  if (o.state === "delivered" || o.state === "closed") return { text: `طلبك رقم #${orderId} تم تسليمه ✅` };

  const unconfirmed = o.state === "draft" || o.state === "waiting_confirmation";
  const open = isWithinOrderingWindow();
  if (unconfirmed && open && o.date === riyadhDateKey()) {
    await updateOrderState(env, orderId, "confirmed");
    // 2026-09-23 (ACCOUNTING_SYNC) — confirmed order → confirmed sale.order.
    // Never throws; the customer reply does not depend on it.
    await ensureSaleOrderForDailyOrder(env, orderId);
    let tail = "";
    if (!o.hasLocation && partner?.id) {
      const loc = await getPartnerLocation(env, partner.id);
      const neigh = loc?.neighborhood || (await getPartnerNeighborhood(env, partner.id));
      if (loc) await setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
      else if (neigh) await setOrderNeighborhood(env, orderId, neigh);
      else {
        await env.MSG_DEDUP.put(`pending_neighborhood:${partner.id}`, `loc:${orderId}`, { expirationTtl: 12 * 60 * 60 });
        tail = "\n📍 أرسل موقع التوصيل (📎 → موقع → موقعي الحالي) أو اكتب اسم الحي.";
      }
    }
    return { text: `تم التأكيد ✅ — طلبك في السكة، يوصلك في وقته 🌿${tail}` };
  }

  // Not confirmable now: cancelled at the cutoff, stale, or past 21:00.
  if (unconfirmed) await cancelIfStillUnconfirmed(env, orderId);
  const items = await getOrderLineItems(env, orderId);
  if (!open && partner?.id && items.length > 0) {
    const why = o.state === "cancelled" ? "أُلغي عند إقفال الساعة 9:00 مساءً لأنه ما تأكد" : "ما تأكد قبل إقفال الساعة 9:00 مساءً";
    return await offerLateOrder(env, partner.id, items, { lead: `طلبك رقم #${orderId} ${why}، فما يدخل طلبات اليوم.` });
  }
  return { text: `طلبك رقم #${orderId} ملغى وما نقدر نرجّعه. أرسل الأصناف من جديد ونبدأ لك طلب جديد 🌿` };
}

async function cancelIfStillUnconfirmed(env: Env, orderId: number): Promise<void> {
  const o = await getOrderBrief(env, orderId);
  if (o && (o.state === "draft" || o.state === "waiting_confirmation")) {
    await updateOrderState(env, orderId, "cancelled");
  }
}

async function cancelOrderButton(env: Env, orderId: number, partner: OdooPartner | null): Promise<RouterReply> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return { text: "ما لقينا هذا الطلب." };
  if (o.state === "cancelled") return { text: `طلبك رقم #${orderId} ملغى مسبقاً ✅` };
  if (IN_EXECUTION.has(o.state)) {
    await sendOwnerAlert(
      env,
      `🚫 طلب إلغاء على طلب في التنفيذ: ${partner?.name ?? "عميل"}${partner?.x_whatsapp_number ? " (" + partner.x_whatsapp_number + ")" : ""} يطلب إلغاء الطلب #${orderId} وحالته ${o.state}. لم يُلغَ؛ القرار لك.`,
    );
    return { text: `طلبك رقم #${orderId} في التنفيذ الحين، فما نقدر نلغيه من هنا. بلّغنا براء وبيتواصل معك قريب 🙏` };
  }
  await updateOrderState(env, orderId, "cancelled");
  await cancelSaleOrderForDailyOrder(env, orderId);
  return { text: "تم الإلغاء. نستناك المرة الجاية 🌿" };
}

async function editOrderButton(env: Env, orderId: number, partner: OdooPartner | null): Promise<RouterReply> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return { text: "ما لقينا هذا الطلب." };
  if (o.state === "cancelled") return { text: `طلبك رقم #${orderId} ملغى. أرسل الأصناف من جديد ونبدأ لك طلب جديد 🌿` };
  if (IN_EXECUTION.has(o.state) || !isWithinOrderingWindow() || o.date !== riyadhDateKey()) {
    await sendOwnerAlert(
      env,
      `✏️ طلب تعديل بعد الإقفال أو أثناء التنفيذ: ${partner?.name ?? "عميل"}${partner?.x_whatsapp_number ? " (" + partner.x_whatsapp_number + ")" : ""} يريد تعديل الطلب #${orderId} وحالته ${o.state}. لم يُعدَّل؛ القرار لك.`,
    );
    return { text: `طلبك رقم #${orderId} ما يقبل تعديل الحين (الطلبات تنقفل الساعة 9:00 مساءً). بلّغنا براء وبيتواصل معك 🙏` };
  }
  // edit_order → return to draft so new messages append lines again
  await updateOrderState(env, orderId, "draft");
  return {
    text: "تفضّل، عدّل — قل لي إيش تبغى تغيّر (تزيد، تحذف، أو تبدل صنف).",
  };
}
