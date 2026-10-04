// § 51 (2026-10-04) — the price-ask WhatsApp Flow and its template, as data.
//
// Pure: no network, no worker import. scripts/s51-20261004-price-flow.mjs sends
// it to Meta; tests/s51.test.mts checks it against what the worker builds
// (src/price-flow.ts: the slot count, the screen, the data keys, the payload).
//
// ONE Flow for both roles («شراء» / «سوق»), ONE screen, no endpoint: the worker
// passes the screen's data with the message (flow_action navigate). A published
// Flow's JSON cannot be edited, so everything a day changes is data:
//   title        «أسعار الشراء اليوم» / «أسعار السوق اليوم»
//   note         the line above the fields
//   l<n> h<n>    the field's label («الصنف — التعبئة», 20 characters at Meta)
//                and its hint («آخر سعر: X», 80 characters)
//   v<n>         the field is shown (an item sits in the slot)
//   i<n>         its initial value («تعديل» reopens the form with what was sent)
// The reply (nfm_reply.response_json) carries p1 … p15 as the user typed them
// and the flow_token; a hidden or empty field arrives empty or not at all.

export const FLOW_NAME = "utak_price_ask_v1";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_JSON_VERSION = "6.0";
export const FLOW_SCREEN = "PRICES";
export const FLOW_SLOTS = 15;
export const FLOW_SUBMIT_LABEL = "إرسال";
export const FLOW_SCREEN_TITLE = "أسعار اليوم";
export const FLOW_NOTE = "الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر.";
export const FLOW_CTA = "أدخل الأسعار";

const slots = () => Array.from({ length: FLOW_SLOTS }, (_, i) => i + 1);

/** The screen's data model: every key the worker sends, with Meta's mandatory example. */
export function flowDataModel() {
  const data = {
    title: { type: "string", __example__: "أسعار الشراء اليوم" },
    note: { type: "string", __example__: FLOW_NOTE },
  };
  for (const n of slots()) {
    data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير — كرتون" : "-" };
    data[`h${n}`] = { type: "string", __example__: n === 1 ? "آخر سعر: 22" : "-" };
    data[`v${n}`] = { type: "boolean", __example__: n === 1 };
    data[`i${n}`] = { type: "string", __example__: "" };
  }
  return data;
}

export function buildFlowJson() {
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: FLOW_SCREEN,
      title: FLOW_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: flowDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.title}" },
          { type: "TextBody", text: "${data.note}" },
          ...slots().map((n) => ({
            type: "TextInput",
            name: `p${n}`,
            label: `\${data.l${n}}`,
            "input-type": "number",
            required: false,
            "helper-text": `\${data.h${n}}`,
            visible: `\${data.v${n}}`,
            "init-value": `\${data.i${n}}`,
          })),
          {
            type: "Footer",
            label: FLOW_SUBMIT_LABEL,
            "on-click-action": {
              name: "complete",
              payload: Object.fromEntries(slots().map((n) => [`p${n}`, `\${form.p${n}}`])),
            },
          },
        ],
      },
    }],
  };
}

// ---------------------------------------------------------------- the template

export const FLOW_TEMPLATE = {
  name: "utak_price_ask_flow_v1",
  purpose: "price_ask_flow",
  label: "طلب الأسعار بالنموذج (للمورد ومصدر السوق) بزر «أدخل الأسعار»",
  language: "ar",
  body: "صباح الخير {{1}} 🌿 طلب {{2}} من يو تاك ليوم {{3}}. اضغط «أدخل الأسعار» وعبّ سعر كل صنف (بدون ضريبة).",
  example: ["أحمد", "أسعار الشراء", "5 أكتوبر 2026"],
  button: FLOW_CTA,
};

/** The POST /message_templates payload, for a Flow id Meta gave. */
export function templatePayload(flowId) {
  const t = FLOW_TEMPLATE;
  return {
    name: t.name,
    language: t.language,
    category: "UTILITY",
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.example] } },
      { type: "BUTTONS", buttons: [{ type: "FLOW", text: t.button, flow_id: String(flowId), flow_action: "navigate", navigate_screen: FLOW_SCREEN }] },
    ],
  };
}
