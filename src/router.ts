// Intent dispatch. Each case returns the reply payload to send back.
// A reply can be plain text OR interactive buttons.
// { text: "" } means "no reply".

import type { Env } from "./config";
import type { Intent, NormalizedMessage, OdooPartner, SenderType } from "./types";
import { composeReply, extractOrderItems } from "./claude";
import {
  addOrderLines,
  createOrderWithLines,
  fetchCatalog,
  findDeactivatedProductMatches,
  findOrCreateTodayOrder,
  getOrderSummary,
  getPartnerLocation,
  getPartnerNeighborhood,
  logMessageAnalysis,
  removeOrderFromOpenPurchaseLists,
  setOrderLocation,
  setOrderNeighborhood,
  updateOrderState,
} from "./odoo";
import { sendText } from "./meta";
import { sendOwnerAlert } from "./templates";
import {
  containsUrgencyKeywords,
  isQuotationTrigger,
  nextOrderingDate,
  riyadhDateKey,
} from "./hours";
import {
  appendPurchaseListNote,
  getOrderBrief,
  getOrderLineItems,
  getPurchaseListBrief,
} from "./odoo";
import { ALREADY_DONE_TEXT, claimButton, finishButton, releaseButton, withButtonLock } from "./button-lock";
import { handleLateNo, handleLateYes } from "./late-order";
import { cancelSaleOrderForDailyOrder, ensureSaleOrderForDailyOrder } from "./sale-accounting";
import {
  notifyCustomerDelivered,
  warehouseConfirmedPurchase,
} from "./team";
import { markStopDelivered, markStopIssue } from "./odoo";
import { looksLikeComplaint, handleComplaint, answerComplaintWithForm } from "./complaint";
import { handleStandingConfirm, handleStandingEdit, handleStandingSkip } from "./standing";
import { minimumText, orderMinimum } from "./order-pricing";
import { quotationZeroGuard } from "./zero-price";
import {
  AWAITING_TEXT, DELIVERABLE_STATES, LOCATION_ASK_LINES, PRICE_NOTE, deliveryLabel, freezeOrderPrices, markAwaitingPrices,
  notifyOwnerConfirmed, orderListStillValid, quotationButtons, quoteOrder, vatNote, type QuoteOutcome,
} from "./order-flow";
import { validPriceList } from "./price-validity";
import { ORDER_FORM_FOLLOW_TEXT } from "./order-form";
import type { InvoiceDispatchOpts } from "./invoice";

/** § 40 د — «أقل طلب N ريال، أضف أصنافاً ليكتمل», and the order's total now (never with a minimum of 0, § 49 أ). */
function belowMinimumText(m: { min: number; total: number }): string {
  return `${minimumText(m.min)}\nمجموع طلبك الآن: ${Number.isInteger(m.total) ? m.total : m.total.toFixed(2)} ريال.`;
}

/** § 42 ب — the collector who tapped (his Work Contact and number). */
function collectorOf(partner: OdooPartner | null): { id: number; name: string; whatsapp: string } {
  return { id: partner?.id ?? 0, name: partner?.name ?? "", whatsapp: String(partner?.x_whatsapp_number ?? "") };
}

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
  /** The gateway purpose (default bot_reply). § 44 د: customer_vat_ask. */
  purpose?: string;
  /** § 44 د — a second message after this one (the VAT question after a confirmation). */
  followUp?: RouterReply;
  /** § 44 د — this reply confirmed the order (the question may follow). Never sent. */
  confirmedOrderId?: number;
  /** § 44 د — the customer of that order when the button's partner is not known. Never sent. */
  confirmedCustomerId?: number;
  /** § 53 ج — after this reply: the order form (once per customer and price list), opened with his open order. */
  orderForm?: { partnerId: number; name: string; body: string };
  /** § 53 د — after this reply: the registration form (a new customer's confirmed order, in place of § 44's questions). */
  registerForm?: { partnerId: number; body: string };
}

/** § 44 د — after a confirmed order: the VAT question follows the confirmation, when due. */
async function withVatAsk(env: Env, reply: RouterReply, partnerId: number | undefined): Promise<RouterReply> {
  const orderId = reply.confirmedOrderId;
  const pid = partnerId || reply.confirmedCustomerId || 0;
  if (!orderId || !pid) return reply;
  const { maybeAskVat } = await import("./vat-ask");
  const ask = await maybeAskVat(env, pid, orderId);
  return ask ? { ...reply, followUp: ask } : reply;
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
    // § 57 هـ — the row and Baraa's alert as before; with an order delivered in the last seven days
    // the form «عندي ملاحظة» goes to him (msg.from) in place of the apology line, and the reply is empty.
    const reply = await handleComplaint(env, partner.id, partner.name || "", msg.text, msg.from);
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

  // § 57 هـ — Claude read it as a complaint (no keyword of ours in it): the same form, on the same
  // condition — and, as before, no row from this door. Without the form: the composed reply below.
  if (intent === "complaint" && senderType === "customer" && partner?.id && msg.text && (await answerComplaintWithForm(env, partner, msg.from, msg.text))) {
    return { text: "" };
  }

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
//
// § 49 ب — an order message is taken at every hour: the 21:00 → 06:00 gate
// («استقبال الطلبات مقفل», «سجّله لبكرة») is gone. The order's day is the
// ordering day of now (after 21:00: tomorrow's list, delivered the morning
// after). What the reply says depends on the price list alone: a valid one →
// as before («خلاص» → the quotation at that list's prices); none → the order
// is kept and the customer is told his quotation comes with the day's prices
// (src/order-flow.ts).
// --------------------------------------------------------------
async function handleOrderMessage(env: Env, input: RouterInput): Promise<RouterReply> {
  const { msg, partner } = input;
  if (!partner) {
    return { text: "حصل خطأ في تسجيلك، نعتذر — نتواصل معك قريباً 🌿" };
  }

  // Also accept "خلاص/جهزه" tacked on the end of an order message
  const quotationInline = isQuotationTrigger(msg.text);

  const catalog = await fetchCatalog(env);
  // 2026-09-15: fetchCatalog is now filtered by x_is_active_for_sale.
  // Empty catalog can mean either a genuine cache-miss race OR (much more
  // likely on a fresh setup) that Baraa hasn't activated any products yet.
  // We still respond with a soft retry — the failure signal for "nothing
  // active" ends up in the alert emitted below, once the customer names
  // something specific.
  const items = await extractOrderItems(env, msg.text, catalog, partner.name);
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

  // Find or create the open order of the ordering day — only when we actually
  // have something active to add. This is the "لا يُنشأ طلب" branch when
  // active.length === 0 above.
  const now = new Date();
  const { id: orderId, created } = await findOrCreateTodayOrder(
    env,
    partner.id,
    undefined,
    msg.messageId,
    now,
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

  // § 49 ب — the day is written out: after 21:00 the order is delivered the morning after tomorrow.
  const urgencyNote = containsUrgencyKeywords(msg.text)
    ? `\n\n📌 توصيلاتنا مجدولة صباحاً — طلبك يوصلك صباح ${deliveryLabel(nextOrderingDate(now))} إن شاء الله.`
    : "";
  const head = [(created ? "بديت لك طلب جديد ✅" : "أضفنا لطلبك ✅"), addedSummary, unavailableWarn, urgencyNote];

  // If customer also said "خلاص/جهزه" in same message, go straight to quotation
  if (quotationInline) {
    const q = await quoteOrder(env, { orderId, partnerId: partner.id, now });
    if (q.kind === "quoted") {
      return {
        bodyBeforeButtons: [
          ...head,
          ``,
          q.locationLine,
          q.deliveryLine,
          vatNote(now),
          PRICE_NOTE,
          `📄 الكوتيشن رقم ${q.number} — راجع الأصناف واختر:`,
        ]
          .filter(Boolean)
          .join("\n"),
        buttons: quotationButtons(orderId),
      };
    }
    return { text: [...head, ``, ...quoteOutcomeLines(q)].filter(Boolean).join("\n") };
  }

  // § 49 ب — no valid price list: the order is kept, and its quotation goes
  // out by itself at the first valid publication. A list that cannot be read
  // (Odoo trouble) changes nothing: the reply of before.
  const list = await validPriceList(env, now.getTime()).catch((e) => {
    console.warn("[order] the valid price list could not be read", (e as Error)?.message);
    return undefined;
  });
  if (list === null) {
    await markAwaitingPrices(env, orderId);
    return { text: [...head, ``, AWAITING_TEXT].filter(Boolean).join("\n") };
  }

  return {
    text: [
      ...head,
      ``,
      `تبغى تضيف شي ثاني، ولا نجهز الكوتيشن؟ (اكتب "خلاص" لما تخلّص)`,
    ]
      .filter(Boolean)
      .join("\n"),
    // § 53 ج — a valid list: after this reply the order form follows, once per customer and list (his lines in it)
    ...(list ? { orderForm: { partnerId: partner.id, name: partner.name || "", body: ORDER_FORM_FOLLOW_TEXT } } : {}),
  };
}

/** What the customer reads when no quotation was made: the wait for prices, the minimum, the price review, the location. */
function quoteOutcomeLines(q: Exclude<QuoteOutcome, { kind: "quoted" }>): string[] {
  if (q.kind === "awaiting") return [AWAITING_TEXT];
  if (q.kind === "need_location") return LOCATION_ASK_LINES;
  return [q.text];
}

// --------------------------------------------------------------
// Quotation request
// --------------------------------------------------------------
async function handleQuotationRequest(env: Env, input: RouterInput): Promise<RouterReply> {
  const { partner, msg } = input;
  if (!partner) return { text: "حصل خطأ، نعتذر." };

  // Find the customer's open order of the ordering day
  const now = new Date();
  const { id: orderId, created } = await findOrCreateTodayOrder(
    env,
    partner.id,
    undefined,
    msg.messageId,
    now,
  );
  if (created) {
    // No prior order today — nothing to quote
    return { text: "ما عندك طلب مفتوح اليوم. ابدأ بكتابة الأصناف اللي تحتاجها." };
  }

  const summary = await getOrderSummary(env, orderId);
  if (!summary || summary.lines.length === 0) {
    return { text: "طلبك فاضي — أضف أصناف أول ثم أجهز الكوتيشن." };
  }
  // § 49 ب — the quotation at the valid list's prices, or the wait for them;
  // § 40 د the minimum and § 46 ج the zero-price guard inside it.
  const q = await quoteOrder(env, { orderId, partnerId: partner.id, now });
  if (q.kind !== "quoted") return { text: quoteOutcomeLines(q).join("\n") };

  const linesText = summary.lines
    .map((l) => `• ${l.product} ${l.packaging} × ${l.qty}`)
    .join("\n");

  return {
    bodyBeforeButtons: [
      `📄 الكوتيشن رقم ${q.number}`,
      linesText,
      ``,
      ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE].filter(Boolean),
      `اختر:`,
    ].join("\n"),
    buttons: quotationButtons(orderId),
  };
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
  // § 44 د — «نعم» / «لا» of the VAT question.
  if (/^vat_(yes|no)_\d+_[a-z0-9]{4,16}$/.test(t)) {
    const { handleVatButton } = await import("./vat-ask");
    return await handleVatButton(env, t);
  }
  if (t === "أبغى أطلب") {
    // § 53 ج — the order form of the valid list (with none: «الأسعار تتحدث…»); the text of before when it cannot go
    if (partner?.id && partner.x_whatsapp_number) {
      try {
        const { answerOrderFormAsk } = await import("./order-form");
        if (await answerOrderFormAsk(env, { partnerId: partner.id, name: partner.name || "", whatsapp: String(partner.x_whatsapp_number) })) return { text: "" };
      } catch (e) {
        console.warn("[order-form] «أبغى أطلب» failed — the text of before", (e as Error)?.message);
      }
    }
    return { text: "تمام 👍 أرسل لي الأصناف اللي تبيها والكميات، وأنا أجهّز الطلب." };
  }
  if (t === "أبغى أعرف أكثر") {
    return { text: `UTAK نوصّل خضار وفواكه طازجة كل يوم مباشرة لباب محلك 🌿

• طلب من الموبايل عبر واتساب
• توصيل يومي في وقته
• أسعار جملة تنافسية

جاهز تبدأ؟ أرسل "أبغى أطلب".` };
  }
  if (t === "كل شي تمام" || t === "ممتازة") {
    return { text: "الحمدلله 🌿 شكراً لك، بنشوفك في الطلب الجاي." };
  }
  if (t === "تحتاج تحسين") {
    return { text: "أشكرك على صدقك 🙏 اكتب لي وش نقدر نحسّنه وسنشتغل عليه فوراً." };
  }

  // ---- § 55 ج: the driver's car-load buttons (the morning's form, the evening's) ----
  {
    const { carLoadButtonMoment, handleCarLoadButton } = await import("./car-load");
    if (carLoadButtonMoment(t)) {
      const reply = await handleCarLoadButton(env, t, partner);
      if (reply) return reply;
    }
  }
  // ---- § 55 هـ: the collector's custody button ----
  {
    const { CUSTODY_BUTTON, handleCustodyButton } = await import("./custody-form");
    if (t === CUSTODY_BUTTON) {
      const reply = await handleCustodyButton(env, t, partner);
      if (reply) return reply;
    }
  }

  // ---- § 57 د: «🏦 أرسلت تحويل» under the invoice's text — the customer's transfer-notice form ----
  {
    const { TRANSFER_BUTTON, answerTransferButton } = await import("./transfer-form");
    if (t === TRANSFER_BUTTON) return await answerTransferButton(env, partner);
  }

  // ---- § 57 هـ: «⚠️ عندي ملاحظة» under the delivery's free text — the customer's complaint form;
  // and the quick reply «عندي ملاحظة» of the older templates (its payload is its text), which does the same ----
  {
    const { COMPLAINT_BUTTON, COMPLAINT_TEMPLATE_PAYLOAD, answerComplaintButton } = await import("./complaint-form");
    if (t === COMPLAINT_BUTTON || t === COMPLAINT_TEMPLATE_PAYLOAD) return await answerComplaintButton(env, partner);
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
      ? await withVatAsk(env, await handleLateYes(env, partner, pid), partner?.id ?? pid)
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
    if (text !== ALREADY_DONE_TEXT) return await withVatAsk(env, out, partner?.id);
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

  // ---- v5: collector tapped cash/transfer ----
  // § 42 ب — nothing is recorded on this tap: the open balance and two
  // buttons, «المبلغ كامل» / «مبلغ آخر» (src/collect-pay.ts). ح8: cash and
  // transfer share one short lock per invoice (a double tap gets one prompt);
  // a later tap is a new prompt (the rest of a partial collection).
  const mCollect = /^collect_(cash|transfer)_(\d+)$/.exec(buttonId);
  if (mCollect) {
    const { askCollection, CP_TAP_LOCK_TTL } = await import("./collect-pay");
    let reply: RouterReply = {};
    const lockText = await withButtonLock(env, `collect_ask:${mCollect[2]}`, async () => {
      reply = await askCollection(env, Number(mCollect[2]), mCollect[1] as "cash" | "transfer", collectorOf(partner));
      return reply.text ?? reply.bodyBeforeButtons ?? "";
    }, CP_TAP_LOCK_TTL);
    return lockText === ALREADY_DONE_TEXT ? { text: ALREADY_DONE_TEXT } : reply;
  }
  // § 42 ب — «المبلغ كامل» records the open balance; «مبلغ آخر» waits for the amount.
  {
    const { COLLECT_CHOICE_RE, collectFull, collectOther } = await import("./collect-pay");
    const mChoice = COLLECT_CHOICE_RE.exec(buttonId);
    if (mChoice) {
      const [, which, method, inv, nonce] = mChoice;
      await logMessageAnalysis(env, {
        customerId: partner?.id ?? null, text: buttonId,
        intent: `collect_${which}`, actionTaken: `button:collect_${which}:${inv}`,
      });
      return which === "full"
        ? await collectFull(env, Number(inv), method as "cash" | "transfer", nonce, collectorOf(partner))
        : await collectOther(env, Number(inv), method as "cash" | "transfer", nonce, collectorOf(partner));
    }
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
        await import("./collect-pay").then((m) => m.clearAmountPointer(env, partner.id));
      }
      return { text: COLLECT_NOTE_PROMPT };
    }
  }

  // ---- § 55 د: «📥 استلام المشتريات» — the receipt form of the purchase list (the buyer alone) ----
  // Its reply (src/receipt-form.ts) writes what was received and then confirms the list under the
  // lock of «تم الشراء» below; this tap only opens the form, so it keeps no lock of its own.
  {
    const { RECEIPT_BUTTON_RE, openReceiptForm } = await import("./receipt-form");
    const mReceipt = RECEIPT_BUTTON_RE.exec(buttonId);
    if (mReceipt) {
      const listId = Number(mReceipt[1]);
      await logMessageAnalysis(env, {
        customerId: partner?.id ?? null,
        text: buttonId,
        intent: "purchase_receipt",
        actionTaken: `button:purchase_receipt:${listId}`,
      });
      return await openReceiptForm(env, listId, partner?.id ? { partnerId: partner.id, name: partner.name || "", whatsapp: String(partner.x_whatsapp_number || "") } : null);
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
      // § 41 هـ — the purchase tax invoice: his next 60 minutes of images / documents go to this list.
      const { openPurchaseInvoiceWindow, PINV_ASK_TEXT } = await import("./purchase-invoice");
      if (partner?.id) await openPurchaseInvoiceWindow(env, partner.id, listId);
      return `تمام 👍 تم إرسال المسارات لـ ${routesDispatched} سواق (${ordersMoved} توصيلة).\n${PINV_ASK_TEXT}`;
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
      await import("./collect-pay").then((m) => m.clearAmountPointer(env, partner.id));
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

  // ---- § 55 ب: «📦 سلّم وحصّل» — the delivery and collection form, to the team member who tapped ----
  // (src/delivery-form.ts reads who he is from his number: anyone else gets nothing.) The form's
  // «إرسال» delivers the order through deliverOrder below, under the lock of «تم التسليم».
  {
    const { DELIVERY_BUTTON_RE, answerDeliveryButton } = await import("./delivery-form");
    const mForm = DELIVERY_BUTTON_RE.exec(buttonId);
    if (mForm) {
      await logMessageAnalysis(env, {
        customerId: partner?.id ?? null,
        text: buttonId,
        intent: "delivery_form",
        actionTaken: `button:delivery_form:${mForm[1]}`,
      });
      return { text: (await answerDeliveryButton(env, Number(mForm[1]), String(partner?.x_whatsapp_number ?? ""))).text };
    }
  }

  // ---- v4: driver marked stop delivered ----
  // § 49 ج — and the delivery on the spot (from the car): any confirmed order,
  // on a route or not, whatever its registered delivery day.
  const mDelivered = /^delivered_(\d+)$/.exec(buttonId);
  if (mDelivered) {
    const orderId = Number(mDelivered[1]);
    await logMessageAnalysis(env, {
      customerId: partner?.id ?? null,
      text: buttonId,
      intent: "delivered",
      actionTaken: `button:delivered:${orderId}`,
    });
    // ح8 — one delivery per order. A tap that delivered nothing (the order is
    // not confirmed yet, § 49 ج) keeps no lock: the tap after his confirmation delivers.
    const claim = await claimButton(env, `delivered:${orderId}`);
    if (!claim.claimed) {
      console.warn(`[btn-lock] repeat tap refused key=${claim.key} state=${claim.state.slice(0, 40)}`);
      return { text: ALREADY_DONE_TEXT };
    }
    try {
      const r = await deliverOrder(env, orderId);
      if (r.delivered) await finishButton(env, claim);
      else await releaseButton(env, claim);
      return { text: r.text };
    } catch (e) {
      await releaseButton(env, claim);
      throw e;
    }
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
      await import("./collect-pay").then((m) => m.clearAmountPointer(env, partner.id));
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
  if (lockText === ALREADY_DONE_TEXT) return { text: ALREADY_DONE_TEXT };
  return action === "confirm_order" ? await withVatAsk(env, reply, partner?.id) : reply;
}

/**
 * «تم التسليم» on an order: the stop's button of a route, or (§ 49 ج) the
 * delivery on the spot of an order that is confirmed and on no route — from
 * the car, the same day, whatever its registered delivery day. The order is
 * written delivered with the moment of the delivery, its invoice is issued
 * and sent as at any delivery (the zero-price guard and the VAT as they are),
 * and it leaves every purchase list not bought yet: it enters none.
 * An order that is not confirmed is not delivered.
 * § 55 ب — `invoiceOpts` is the delivery form's alone (its payment on the
 * invoice just issued, src/invoice.ts InvoiceDispatchOpts): without it this is
 * «تم التسليم» as it always was.
 */
export async function deliverOrder(env: Env, orderId: number, invoiceOpts: InvoiceDispatchOpts = {}): Promise<{ text: string; delivered: boolean }> {
  // ح8: an order already delivered is not delivered, invoiced or announced again.
  const brief = await getOrderBrief(env, orderId);
  if (!brief) return { text: `ما لقينا الطلب #${orderId}.`, delivered: false };
  if (brief.state === "delivered" || brief.state === "closed") {
    return { text: `${ALREADY_DONE_TEXT} الطلب #${orderId} مسجّل مسلّماً.`, delivered: true };
  }
  if (!DELIVERABLE_STATES.has(brief.state)) {
    return {
      text: brief.state === "cancelled"
        ? `الطلب #${orderId} ملغى، فلا يُسلَّم.`
        : `الطلب #${orderId} لم يؤكده العميل بعد، فلا يُسلَّم ولا تصدر فاتورته. يضغط العميل «تأكيد الطلب» أولاً.`,
      delivered: false,
    };
  }
  const { allDone, immediate } = await markStopDelivered(env, orderId);
  if (immediate) {
    try {
      const lists = await removeOrderFromOpenPurchaseLists(env, orderId);
      if (lists.length) {
        await sendOwnerAlert(env, `🛒 الطلب #${orderId} سُلّم فوراً وكان في قائمة الشراء ${lists.map((l) => "#" + l).join("، ")}: خرجت كمياته منها. لو وصلت القائمة عمر قبل الآن، أبلغه.`);
      }
    } catch (e) {
      console.warn(`[delivered] order ${orderId}: the purchase lists were not updated`, (e as Error)?.message);
    }
  }
  // v5: create invoice + dispatch to customer & collector
  try {
    const { createAndDispatchInvoiceForOrder } = await import("./invoice");
    await createAndDispatchInvoiceForOrder(env, orderId, invoiceOpts);
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
  if (immediate) return { text: `تم التسليم ✅ — الطلب #${orderId} سُلّم فوراً، وفاتورته تصل العميل الآن.`, delivered: true };
  // STATUS § 38 (م8) — the next stop's customer: «في الطريق» (once per order).
  try {
    const { notifyNextAfterDelivered } = await import("./out-for-delivery");
    await notifyNextAfterDelivered(env, orderId);
  } catch (e) {
    console.warn(`[delivered] «في الطريق» after #${orderId} failed`, (e as Error)?.message);
  }
  return {
    text: allDone
      ? `تم التسليم ✅ — خلصت مسارك اليوم. شكراً 🙏`
      : `تم التسليم ✅ — التوصيلة الجاية بانتظارك.`,
    delivered: true,
  };
}

// --------------------------------------------------------------
// ح4 — quotation buttons check the live order state before acting.
//   تأكيد: an unconfirmed order, at any hour (§ 49 ب), when the price list
//          it was quoted with is still valid and the 21:00 of its ordering
//          day has not passed. Else it is never confirmed at the old price or
//          the old delivery day: a new quotation at the valid list (or the
//          order waits for the day's prices). A cancelled order is not
//          revived: its items start a new order, quoted the same way.
//   إلغاء: only before the order enters purchasing (draft / waiting /
//          confirmed). Afterwards the customer is told it is in progress and
//          the owner is alerted at once to decide.
//   تعديل: same window as إلغاء, at any hour.
// --------------------------------------------------------------
const IN_EXECUTION: ReadonlySet<string> = new Set(["in_purchase", "in_delivery", "delivered", "closed"]);

/** A new quotation's reply: its number, the delivery day, the note, the three buttons — or why there is none. */
function requoteReply(orderId: number, q: QuoteOutcome, lead: string, now: Date): RouterReply {
  if (q.kind !== "quoted") return { text: [lead, ...quoteOutcomeLines(q)].filter(Boolean).join("\n") };
  return {
    bodyBeforeButtons: [
      lead,
      `📄 الكوتيشن رقم ${q.number} لطلبك رقم #${orderId}`,
      ...[q.locationLine, q.deliveryLine, vatNote(now), PRICE_NOTE].filter(Boolean),
      `اختر:`,
    ].filter(Boolean).join("\n"),
    buttons: quotationButtons(orderId),
  };
}

async function confirmOrderButton(env: Env, orderId: number, partner: OdooPartner | null): Promise<RouterReply> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return { text: "ما لقينا هذا الطلب. اكتب لنا طلبك من جديد 🌿" };
  if (o.state === "confirmed") return { text: `طلبك رقم #${orderId} مؤكد مسبقاً ✅` };
  if (o.state === "in_purchase" || o.state === "in_delivery") return { text: `طلبك رقم #${orderId} مؤكد وفي التنفيذ ✅` };
  if (o.state === "delivered" || o.state === "closed") return { text: `طلبك رقم #${orderId} تم تسليمه ✅` };

  const now = new Date();
  const customerId = partner?.id || o.customerId;
  if (o.state === "cancelled") {
    // not revived: the same items on a new order of the ordering day now, quoted at the valid list
    const items = await getOrderLineItems(env, orderId);
    if (!items.length || !customerId) return { text: `طلبك رقم #${orderId} ملغى وما نقدر نرجّعه. أرسل الأصناف من جديد ونبدأ لك طلب جديد 🌿` };
    const fresh = await createOrderWithLines(env, { customerId, date: nextOrderingDate(now), items, via: "whatsapp", state: "draft" });
    const q = await quoteOrder(env, { orderId: fresh, partnerId: customerId, now });
    return requoteReply(fresh, q, `طلبك رقم #${orderId} أُلغي لأنه ما تأكد. سجّلنا أصنافه طلباً جديداً برقم #${fresh}.`, now);
  }

  // § 49 ب — the price list of its quotation is still valid, and it is still the order's day: confirmed.
  // An order no quotation priced yet (a draft confirmed from the 20:00 reminder): priced now, from the valid list.
  const sameDay = o.date === nextOrderingDate(now);
  let confirmable = false;
  if (o.priceDate) confirmable = sameDay && !!(await orderListStillValid(env, o.priceDate, now));
  else if (!o.awaitingPrices) {
    const list = await validPriceList(env, now.getTime());
    if (list) { await freezeOrderPrices(env, orderId, list, now); confirmable = true; }
  }
  if (!confirmable) {
    const q = await quoteOrder(env, { orderId, partnerId: customerId, now });
    const lead = !o.priceDate ? ""
      : sameDay ? "أسعار عرض السعر السابق انتهت صلاحيتها (السعر صالح ليوم واحد)، وهذا عرض جديد بأسعار اليوم:"
        : "طلبك ما تأكد قبل الساعة 9:00 مساءً، وهذا عرض السعر بيوم التوصيل الجديد:";
    return requoteReply(orderId, q, lead, now);
  }

  // § 40 د — after the state guards (ح4): below the minimum it is not
  // confirmed; the order stays open (draft) to be completed.
  const minimum = await orderMinimum(env, orderId).catch(() => null);
  if (minimum?.below) {
    if (o.state === "waiting_confirmation") await updateOrderState(env, orderId, "draft");
    return { text: belowMinimumText(minimum) };
  }
  // § 46 ج — a line priced ≤ 0 or without a price is never confirmed: the order goes back to draft.
  const review = await quotationZeroGuard(env, orderId);
  if (review) {
    if (o.state !== "draft") await updateOrderState(env, orderId, "draft");
    return { text: review };
  }
  await updateOrderState(env, orderId, "confirmed");
  // 2026-09-23 (ACCOUNTING_SYNC) — confirmed order → confirmed sale.order.
  // Never throws; the customer reply does not depend on it.
  await ensureSaleOrderForDailyOrder(env, orderId);
  let tail = "";
  if (!o.hasLocation && customerId) {
    const loc = await getPartnerLocation(env, customerId);
    const neigh = loc?.neighborhood || (await getPartnerNeighborhood(env, customerId));
    if (loc) await setOrderLocation(env, orderId, loc.latitude, loc.longitude, loc.neighborhood);
    else if (neigh) await setOrderNeighborhood(env, orderId, neigh);
    else {
      await env.MSG_DEDUP.put(`pending_neighborhood:${customerId}`, `loc:${orderId}`, { expirationTtl: 12 * 60 * 60 });
      tail = "\n📍 أرسل موقع التوصيل (📎 → موقع → موقعي الحالي) أو اكتب اسم الحي.";
    }
  }
  // § 49 ج — Baraa gets the confirmed order with «تم التسليم ✅» (the delivery on the spot)
  await notifyOwnerConfirmed(env, orderId);
  // § 49 ب — the delivery day, written out: the morning after the order's day
  const orderDay = (await getOrderBrief(env, orderId))?.date || nextOrderingDate(now);
  return { text: `تم التأكيد ✅ — طلبك رقم #${orderId} يوصلك صباح ${deliveryLabel(orderDay)} إن شاء الله 🌿${tail}`, confirmedOrderId: orderId };
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
  // § 44 د — the VAT questions this order opened end, nothing saved
  if (partner?.id) await import("./vat-ask").then((m) => m.endVatFlowForOrder(env, partner.id, orderId)).catch(() => {});
  return { text: "تم الإلغاء. نستناك المرة الجاية 🌿" };
}

async function editOrderButton(env: Env, orderId: number, partner: OdooPartner | null): Promise<RouterReply> {
  const o = await getOrderBrief(env, orderId);
  if (!o) return { text: "ما لقينا هذا الطلب." };
  if (o.state === "cancelled") return { text: `طلبك رقم #${orderId} ملغى. أرسل الأصناف من جديد ونبدأ لك طلب جديد 🌿` };
  // § 49 ب — at any hour: only an order already in purchasing or delivery is not edited from here
  if (IN_EXECUTION.has(o.state)) {
    await sendOwnerAlert(
      env,
      `✏️ طلب تعديل أثناء التنفيذ: ${partner?.name ?? "عميل"}${partner?.x_whatsapp_number ? " (" + partner.x_whatsapp_number + ")" : ""} يريد تعديل الطلب #${orderId} وحالته ${o.state}. لم يُعدَّل؛ القرار لك.`,
    );
    return { text: `طلبك رقم #${orderId} في التنفيذ الحين، فما يقبل تعديل من هنا. بلّغنا براء وبيتواصل معك 🙏` };
  }
  // edit_order → return to draft so new messages append lines again
  await updateOrderState(env, orderId, "draft");
  // § 53 ج — a quotation the order form made: «تعديل» opens the form with the order's quantities
  try {
    const { isFormOrder, reopenOrderForm } = await import("./order-form");
    if (await isFormOrder(env, orderId)) {
      const { getOrderCustomer } = await import("./odoo");
      const cust = await getOrderCustomer(env, orderId);
      if (cust?.phone && (await reopenOrderForm(env, orderId, { partnerId: cust.id, name: cust.name, whatsapp: cust.phone }))) return { text: "" };
    }
  } catch (e) {
    console.warn(`[order-form] «تعديل» of order ${orderId} could not open the form — the text of before`, (e as Error)?.message);
  }
  return {
    text: "تفضّل، عدّل — قل لي إيش تبغى تغيّر (تزيد، تحذف، أو تبدل صنف).",
  };
}
