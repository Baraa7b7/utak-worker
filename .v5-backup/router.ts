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
  findOrCreateTodayOrder,
  getOrderSummary,
  getPartnerLocation,
  getPartnerNeighborhood,
  logMessageAnalysis,
  setOrderLocation,
  setOrderNeighborhood,
  updateOrderState,
} from "./odoo";
import {
  containsUrgencyKeywords,
  isOrderingHoursOpen,
  isQuotationTrigger,
} from "./hours";
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
  if (msg.type === "interactive" && msg.buttonId) {
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

  // Ordering hours check (v3: also honours the 06:00 KV flag)
  if (!(await isOrderingHoursOpen(env))) {
    return {
      text: "استقبال الطلبات مقفول حالياً. طلبك يوصلك بكرة الصبح إن شاء الله 🌿\n(ساعات الاستقبال 6 صباحاً – 9 مساءً)",
    };
  }

  const catalog = await fetchCatalog(env);
  if (catalog.length === 0) {
    return { text: "النظام يحدّث الكتالوج الحين، حاول بعد دقيقة لو سمحت." };
  }

  const items = await extractOrderItems(env, msg.text, catalog, partner.name);
  const valid = items.filter((it) => it.product_id > 0 && it.packaging_id > 0);
  const unknown = items.filter((it) => it.product_id === 0);

  if (valid.length === 0 && unknown.length === 0) {
    return {
      text: "ما قدرت أفهم الأصناف من رسالتك. اكتب لي مثلاً: طماطم كرتون 3، خيار جرم 5.",
    };
  }

  // Find or create today's draft order
  const { id: orderId, created } = await findOrCreateTodayOrder(
    env,
    partner.id,
    undefined,
    msg.messageId,
  );

  if (valid.length > 0) {
    await addOrderLines(env, orderId, valid);
  }

  // Build summary line for reply
  const addedSummary = valid
    .map((it) => {
      const prod = catalog.find((p) => p.id === it.product_id);
      const pk = prod?.packagings.find((x) => x.id === it.packaging_id);
      const pname = prod?.name ?? it.product_name_raw;
      const pkname = pk?.name ?? "";
      return `• ${pname} ${pkname} × ${it.quantity}`;
    })
    .join("\n");

  const unknownWarn = unknown.length
    ? `\n\n⚠️ ما لقيت في الكتالوج: ${unknown.map((u) => u.product_name_raw).join("، ")}`
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
          unknownWarn,
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
        unknownWarn,
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
      unknownWarn,
      urgencyNote,
      ``,
      `تبغى تضيف شي ثاني، ولا نجهز الكوتيشن؟ (اكتب "خلاص" لما تخلّص)`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
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
  // ---- v6.1: standing-order reminder buttons ----
  const mStandingConfirm = /^standing_confirm_(\d+)$/.exec(buttonId);
  if (mStandingConfirm) {
    const sid = Number(mStandingConfirm[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "standing_confirm",
      actionTaken: `button:standing_confirm:${sid}`,
    });
    return { text: await handleStandingConfirm(env, sid) };
  }
  const mStandingEdit = /^standing_edit_(\d+)$/.exec(buttonId);
  if (mStandingEdit) {
    const sid = Number(mStandingEdit[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "standing_edit",
      actionTaken: `button:standing_edit:${sid}`,
    });
    return { text: await handleStandingEdit(env, sid) };
  }
  const mStandingSkip = /^standing_skip_(\d+)$/.exec(buttonId);
  if (mStandingSkip) {
    const sid = Number(mStandingSkip[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "standing_skip",
      actionTaken: `button:standing_skip:${sid}`,
    });
    return { text: await handleStandingSkip(env, sid) };
  }

  // ---- v5: collector confirmed cash/transfer ----
  if (buttonId.startsWith("collect_cash_") || buttonId.startsWith("collect_transfer_")) {
    const { handleCollectionButton } = await import("./invoice");
    const result = await handleCollectionButton(env, buttonId, partner?.id ?? null);
    if (result) return { text: result.text };
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
    const { routesDispatched, ordersMoved } = await warehouseConfirmedPurchase(env, listId);
    return {
      text: `تمام 👍 تم إرسال المسارات لـ ${routesDispatched} سواق (${ordersMoved} توصيلة).`,
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
    const { routeId, allDone } = await markStopDelivered(env, orderId);
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
    return {
      text: allDone
        ? `تم التسليم ✅ — خلصت مسارك اليوم. شكراً 🙏`
        : `تم التسليم ✅ — التوصيلة الجاية بانتظارك.`,
    };
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
    }
    return { text: `تمام، اكتب لي وش المشكلة بالضبط (رسالة واحدة) وأنا أسجّلها لبراء.` };
  }

  const m = /^(confirm_order|edit_order|cancel_order)_(\d+)$/.exec(buttonId);
  if (!m) {
    return { text: "زر غير معروف." };
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

  if (action === "confirm_order") {
    await updateOrderState(env, orderId, "confirmed");
    return { text: "تم التأكيد ✅ — طلبك في السكة، يوصلك في وقته 🌿" };
  }

  if (action === "cancel_order") {
    await updateOrderState(env, orderId, "cancelled");
    return { text: "تم الإلغاء. نستناك المرة الجاية 🌿" };
  }

  // edit_order → return to draft so new messages append lines again
  await updateOrderState(env, orderId, "draft");
  return {
    text: "تفضّل، عدّل — قل لي إيش تبغى تغيّر (تزيد، تحذف، أو تبدل صنف).",
  };
}
