// WhatsApp Discuss inbox — reply pipeline.
//
// Called from /odoo/hook/wa-inbox with a mail.message id that a
// base.automation flagged as a Discuss composer reply on a WhatsApp-inbox
// channel. Sends the reply out via Meta and mirrors success/failure into
// the channel as UTAK بوت (only the failure line is added — the success
// case is already in the channel as Baraa's own message).
//
// Every failure path returns a status object rather than throwing, so the
// hook logs a structured line the operator can grep.

import type { Env } from "./config";
import {
  evaluateInboxReplyMessage,
  echoFailure,
  type ReplyGate,
} from "./wa-inbox";
import { sendText } from "./meta";
import { gatewayDecision } from "./wa-gateway";
import { logWaMessage } from "./wa-message-send";

interface ReplyResult {
  ok: boolean;
  action:
    | "sent"
    | "skipped"        // not our concern (bot, echo, non-comment, wrong model)
    | "attachment_only"// no text body, only attachments (unsupported for now)
    | "held"           // outside the 24h window: waits for the contact's next message (STATUS § 33)
    | "meta_failed"
    | "no_phone";
  skip?: string;
  metaError?: string;
}

export async function handleInboxReplyHook(
  env: Env,
  mailMessageId: number,
  ctx?: ExecutionContext,
): Promise<ReplyResult> {
  const gate: ReplyGate = await evaluateInboxReplyMessage(env, mailMessageId);
  if (!gate.send) {
    return { ok: true, action: "skipped", skip: gate.skip ?? "not applicable" };
  }
  const {
    partnerId, partnerName, partnerPhone, body, attachmentCount = 0,
  } = gate;

  if (!partnerPhone) {
    await echoFailure(env, partnerId!, partnerName ?? "", "الجهة ما عندها رقم واتساب");
    return { ok: false, action: "no_phone", skip: "partner has no phone" };
  }

  const bodyText = (body ?? "").trim();

  // Attachments from the Discuss composer are not sent as media yet — send
  // the text portion (if any) and note the missing attachments.
  if (attachmentCount > 0 && bodyText) {
    await echoFailure(
      env,
      partnerId!,
      partnerName ?? "",
      "المرفقات من الصندوق غير مدعومة بعد — انرسل النص فقط.",
    );
    // fall through and send the text
  } else if (attachmentCount > 0 && !bodyText) {
    await echoFailure(
      env,
      partnerId!,
      partnerName ?? "",
      "المرفقات من الصندوق غير مدعومة بعد — الرسالة ما فيها نص.",
    );
    return { ok: false, action: "attachment_only" };
  }

  if (!bodyText) {
    // Nothing to send
    return { ok: true, action: "skipped", skip: "empty body" };
  }

  // Through the single gateway (STATUS § 33): the owner guard, the
  // SIM_ALLOWLIST + x_wa_allowed gate, and the 24h window. Outside the window
  // the reply is held for the contact (a «⏳ محفوظة» line in this channel and
  // an x_wa_message row «held») and goes at their next message — it used to
  // be refused here with «انتهت نافذة 24 ساعة».
  const to = partnerPhone.startsWith("+") ? partnerPhone : `+${partnerPhone.replace(/[^0-9]/g, "")}`;
  const resp = await sendText(env, to, bodyText, { purpose: "inbox_reply", ctx });
  if (gatewayDecision(resp)?.action === "held") {
    return { ok: true, action: "held" };
  }
  if (!resp.ok) {
    let errText = "";
    try { errText = (await resp.clone().text()).slice(0, 200); } catch { /* ignore */ }
    await echoFailure(
      env,
      partnerId!,
      partnerName ?? "",
      `Meta ${resp.status} — ${errText || "فشل الإرسال"}`,
    );
    return { ok: false, action: "meta_failed", metaError: `${resp.status}: ${errText}` };
  }

  // Log x_wa_message; the mirror is already Baraa's own message in the channel
  // so we do NOT post a system echo (that would double-render Baraa's reply).
  // source="manual" so the audit list badges the row as يدوي.
  try {
    await logWaMessage(env, {
      partnerId: partnerId!,
      direction: "out",
      kind: "text",
      body: bodyText,
      resModel: "mail.message",
      resId: mailMessageId,
      status: "sent",
      source: "manual",
      manual: true,
    });
  } catch (e) {
    console.warn("[wa-inbox-reply] logWaMessage failed:", (e as Error).message);
  }

  return { ok: true, action: "sent" };
}
