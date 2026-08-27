// Intent dispatch. Each case returns the reply text to send back.
// Empty string means "no reply to send".
// When any case exceeds ~50 lines, extract to router/handlers/<intent>.ts.

import type { Env } from "./config";
import type { Intent, NormalizedMessage, OdooPartner, SenderType } from "./types";
import { composeReply } from "./claude";

export interface RouterInput {
  msg: NormalizedMessage;
  intent: Intent;
  senderType: SenderType;
  partner: OdooPartner | null;
}

export async function dispatch(env: Env, input: RouterInput): Promise<string> {
  const { msg, intent, senderType, partner } = input;

  switch (intent) {
    case "greeting": {
      const name = partner?.name || msg.profileName || "";
      return name
        ? `أهلاً ${name}، حياك الله في UTAK. كيف نقدر نساعدك؟`
        : `أهلاً وسهلاً في UTAK. كيف نقدر نساعدك؟`;
    }

    case "supplier_price_reply": {
      // v1 stub: acknowledge receipt only. Parsing + x_daily_price rows land in v2.
      return "استلمنا رسالتك، جاري المعالجة. شكراً لك.";
    }

    case "product_inquiry":
    case "place_order":
    case "complaint":
    case "other": {
      const context = [
        `Sender type: ${senderType}`,
        `Intent: ${intent}`,
        `Partner name: ${partner?.name ?? "unknown"}`,
        `Message: ${msg.text}`,
        ``,
        `Reply appropriately in Arabic per the system rules. This is a test — keep it functional.`,
      ].join("\n");
      return await composeReply(env, context);
    }
  }
}
