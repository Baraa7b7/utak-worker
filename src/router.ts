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
  logMessageAnalysis,
  updateOrderState,
} from "./odoo";
import {
  containsUrgencyKeywords,
  isOrderingHoursOpen,
  isQuotationTrigger,
} from "./hours";

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
      // v3 will parse prices; v2 just acknowledges.
      return { text: "استلمنا رسالتك، جاري المعالجة. شكراً لك." };

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

  // Ordering hours check
  if (!isOrderingHoursOpen()) {
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
    const q = await createQuotationRecord(env, orderId);
    await updateOrderState(env, orderId, "waiting_confirmation");
    return {
      bodyBeforeButtons: [
        (created ? "بديت لك طلب جديد ✅" : "أضفنا لطلبك ✅"),
        addedSummary,
        unknownWarn,
        urgencyNote,
        ``,
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

  const q = await createQuotationRecord(env, orderId);
  await updateOrderState(env, orderId, "waiting_confirmation");

  const linesText = summary.lines
    .map((l) => `• ${l.product} ${l.packaging} × ${l.qty}`)
    .join("\n");

  return {
    bodyBeforeButtons: [
      `📄 الكوتيشن رقم ${q.number}`,
      linesText,
      ``,
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
