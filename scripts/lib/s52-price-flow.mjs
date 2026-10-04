// § 52 (2026-10-04) — the price-ask WhatsApp Flow v2 (pages by category) and its template, as data.
//
// Pure: no network, no worker import. scripts/s52-20261004-price-flow.mjs sends
// it to Meta; tests/s52.test.mts checks it against what the worker builds
// (src/price-flow.ts: the pages, the slot count, the data keys, the payload).
//
// utak_price_ask_v1 (§ 51, one screen) stays at Meta as it is. v2 is FOUR
// pages of fifteen optional number fields each, still with no endpoint: the
// worker passes ALL the data with the message to the first page (flow_action
// navigate), and the later pages read it from there (`${screen.PAGE_A.data.…}`,
// Flow JSON's global reference).
//
// The pages are generic — PAGE_A … PAGE_D — and the worker fills them in order
// with the categories that HAVE items today (فواكه، خضار، ورقيات، أخرى): an
// empty category takes no page, so «التالي» never opens an empty one, and the
// first page (the only one a template's FLOW button can open) always has items.
// Each page's footer is «التالي» while a page follows (m<k> true) and «إرسال»
// on the last one that has items.
//
//   sub          «أسعار الشراء اليوم» / «أسعار السوق اليوم»
//   note         the line above the fields (the VAT line of the source's role)
//   t<k>         page k's heading: its category («فواكه»)
//   m<k>         a page follows page k (k = 1 … 3)
//   l<n> h<n>    slot n's label (20 characters at Meta) and hint (80)
//   v<n>         slot n is shown          i<n>   its initial value («تعديل»)
// Slots 1–15 sit on PAGE_A, 16–30 on PAGE_B, 31–45 on PAGE_C, 46–60 on PAGE_D.
// The reply (nfm_reply.response_json) carries p<n> of every page up to the one
// «إرسال» was tapped on, and the flow_token.

export const FLOW_NAME = "utak_price_ask_v2";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_JSON_VERSION = "6.0";
export const FLOW_PAGES = ["PAGE_A", "PAGE_B", "PAGE_C", "PAGE_D"];
export const FLOW_FIRST_SCREEN = FLOW_PAGES[0];
export const FLOW_PAGE_SLOTS = 15;
export const FLOW_SLOTS = FLOW_PAGES.length * FLOW_PAGE_SLOTS;
export const FLOW_NEXT_LABEL = "التالي";
export const FLOW_SUBMIT_LABEL = "إرسال";
export const FLOW_SCREEN_TITLE = "أسعار اليوم";
export const FLOW_CTA = "أدخل الأسعار";

const pages = () => FLOW_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–15, 16–30, … */
export const pageSlots = (k) => Array.from({ length: FLOW_PAGE_SLOTS }, (_, i) => (k - 1) * FLOW_PAGE_SLOTS + i + 1);

/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function flowDataModel() {
  const data = {
    sub: { type: "string", __example__: "أسعار الشراء اليوم" },
    note: { type: "string", __example__: "الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر." },
  };
  for (const { k } of pages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < FLOW_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of pageSlots(k)) {
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير — كرتون" : "-" };
      data[`h${n}`] = { type: "string", __example__: n === 1 ? "آخر سعر: 22" : "-" };
      data[`v${n}`] = { type: "boolean", __example__: n === 1 };
      data[`i${n}`] = { type: "string", __example__: "" };
    }
  }
  return data;
}

/** A data key as page k reads it: its own on the first page, the first page's on the others. */
const ref = (k, key) => (k === 1 ? `\${data.${key}}` : `\${screen.${FLOW_FIRST_SCREEN}.data.${key}}`);
/** A field's value in the «إرسال» payload of page k: its own form, or an earlier page's. */
const formRef = (k, n) => {
  const owner = Math.ceil(n / FLOW_PAGE_SLOTS);
  return owner === k ? `\${form.p${n}}` : `\${screen.${FLOW_PAGES[owner - 1]}.form.p${n}}`;
};

function submitFooter(k) {
  const upTo = Array.from({ length: k * FLOW_PAGE_SLOTS }, (_, i) => i + 1);
  return {
    type: "Footer",
    label: FLOW_SUBMIT_LABEL,
    "on-click-action": { name: "complete", payload: Object.fromEntries(upTo.map((n) => [`p${n}`, formRef(k, n)])) },
  };
}
function nextFooter(k) {
  return {
    type: "Footer",
    label: FLOW_NEXT_LABEL,
    "on-click-action": { name: "navigate", next: { type: "screen", name: FLOW_PAGES[k] }, payload: {} },
  };
}

function pageScreen(k) {
  const last = k === FLOW_PAGES.length;
  return {
    id: FLOW_PAGES[k - 1],
    title: FLOW_SCREEN_TITLE,
    terminal: true,
    success: true,
    data: k === 1 ? flowDataModel() : {},
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: ref(k, `t${k}`) },
        { type: "TextSubheading", text: ref(k, "sub") },
        { type: "TextBody", text: ref(k, "note") },
        ...pageSlots(k).map((n) => ({
          type: "TextInput",
          name: `p${n}`,
          label: ref(k, `l${n}`),
          "input-type": "number",
          required: false,
          "helper-text": ref(k, `h${n}`),
          visible: ref(k, `v${n}`),
          "init-value": ref(k, `i${n}`),
        })),
        // «التالي» while a page with items follows, «إرسال» on the last one that has any
        last ? submitFooter(k) : { type: "If", condition: ref(k, `m${k}`), then: [nextFooter(k)], else: [submitFooter(k)] },
      ],
    },
  };
}

/** Forward routes only: each page to the next. Stated, not left to Meta: the «التالي» footers sit inside an `If`. */
export const flowRoutingModel = () => Object.fromEntries(FLOW_PAGES.map((id, i) => [id, FLOW_PAGES[i + 1] ? [FLOW_PAGES[i + 1]] : []]));

export function buildFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: flowRoutingModel(), screens: pages().map(({ k }) => pageScreen(k)) };
}

// ---------------------------------------------------------------- the template

// § 52 د — ONE submission, UTILITY, no greeting and no emoji. Filed MARKETING by
// Meta → never used and never re-submitted (the worker keeps utak_supplier_ask_v2).
export const FLOW_TEMPLATE = {
  name: "utak_price_ask_flow_v2",
  purpose: "price_ask_flow",
  label: "طلب تحديث الأسعار بالنموذج (لكل مصادر الأسعار) بزر «أدخل الأسعار»",
  language: "ar",
  body: "طلب تحديث الأسعار ليوم {{1}} حسب الاتفاق مع يو تاك. اضغط «أدخل الأسعار» وأدخل سعر كل صنف.",
  example: ["5 أكتوبر 2026"],
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
      { type: "BUTTONS", buttons: [{ type: "FLOW", text: t.button, flow_id: String(flowId), flow_action: "navigate", navigate_screen: FLOW_FIRST_SCREEN }] },
    ],
  };
}
