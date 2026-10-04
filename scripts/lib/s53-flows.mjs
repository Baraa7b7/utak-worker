// § 53 ج / د (2026-10-04) — the customer's two WhatsApp Flows, as data.
//
// Pure: no network, no worker import. scripts/s53-20261004-flows.mjs sends them to Meta;
// tests/s53-forms.test.mts checks them against what the worker builds (src/order-form.ts,
// src/register-form.ts: the pages, the slot count, the data keys, the payload).
//
// Neither uses an endpoint: the worker passes ALL the data with the message to the first screen
// (flow_action navigate), as utak_price_ask_v2 does (scripts/lib/s52-price-flow.mjs), and a published
// Flow's JSON is frozen — any change of its shape is a new Flow.
//
// ---- utak_order_v1 — the order form ----
// FOUR generic pages (ORDER_A … ORDER_D) of fifteen optional number fields: the QUANTITY (cartons) of
// each item of the day's valid price list. The worker fills the pages in order with the categories
// that HAVE items (فواكه، خضار، ورقيات، أخرى): an empty category takes no page, «التالي» never opens
// an empty one, and «إرسال» sits on the last page that has items.
//   note         «السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.»
//   del          the delivery day, by § 49's rule
//   t<k>         page k's heading: its category
//   m<k>         a page follows page k (k = 1 … 3)
//   l<n> h<n>    slot n's label — the item's name (20 characters at Meta) — and its hint:
//                «التعبئة · السعر X ر.س شامل الضريبة» (80)
//   v<n>         slot n is shown          i<n>   its initial value («تعديل»: the quantities sent before)
// The reply carries q<n> of every page up to the one «إرسال» was tapped on, and the flow_token.
//
// ---- utak_register_v1 — the customer's registration ----
// ONE screen: the shop's name (required), its activity (a list), the person in charge, the legal
// name and the VAT number (both optional; the number is checked by the worker, § 44's rule), and
// the district. «تعديل» opens it with what was sent (i_*); the activity is chosen again.

export const FLOW_JSON_VERSION = "6.0";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_NEXT_LABEL = "التالي";
export const FLOW_SUBMIT_LABEL = "إرسال";

// ================================================================ utak_order_v1
export const ORDER_FLOW_NAME = "utak_order_v1";
export const ORDER_PAGES = ["ORDER_A", "ORDER_B", "ORDER_C", "ORDER_D"];
export const ORDER_FIRST_SCREEN = ORDER_PAGES[0];
export const ORDER_PAGE_SLOTS = 15;
export const ORDER_SLOTS = ORDER_PAGES.length * ORDER_PAGE_SLOTS;
export const ORDER_SCREEN_TITLE = "طلب من يو تاك";
export const ORDER_CTA = "اطلب الآن";

const orderPages = () => ORDER_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–15, 16–30, … */
export const orderPageSlots = (k) => Array.from({ length: ORDER_PAGE_SLOTS }, (_, i) => (k - 1) * ORDER_PAGE_SLOTS + i + 1);

/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function orderDataModel() {
  const data = {
    note: { type: "string", __example__: "السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف." },
    del: { type: "string", __example__: "التوصيل: صباح الاثنين 5 أكتوبر 2026، لو تأكد قبل الساعة 9:00 مساءً." },
  };
  for (const { k } of orderPages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < ORDER_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of orderPageSlots(k)) {
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير" : "-" };
      data[`h${n}`] = { type: "string", __example__: n === 1 ? "كرتون · السعر 31 ر.س شامل الضريبة" : "-" };
      data[`v${n}`] = { type: "boolean", __example__: n === 1 };
      data[`i${n}`] = { type: "string", __example__: "" };
    }
  }
  return data;
}

/** A data key as page k reads it: its own on the first page, the first page's on the others. */
const oref = (k, key) => (k === 1 ? `\${data.${key}}` : `\${screen.${ORDER_FIRST_SCREEN}.data.${key}}`);
/** A field's value in the «إرسال» payload of page k: its own form, or an earlier page's. */
const oformRef = (k, n) => {
  const owner = Math.ceil(n / ORDER_PAGE_SLOTS);
  return owner === k ? `\${form.q${n}}` : `\${screen.${ORDER_PAGES[owner - 1]}.form.q${n}}`;
};
function orderSubmitFooter(k) {
  const upTo = Array.from({ length: k * ORDER_PAGE_SLOTS }, (_, i) => i + 1);
  return { type: "Footer", label: FLOW_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: Object.fromEntries(upTo.map((n) => [`q${n}`, oformRef(k, n)])) } };
}
function orderNextFooter(k) {
  return { type: "Footer", label: FLOW_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: ORDER_PAGES[k] }, payload: {} } };
}
function orderScreen(k) {
  const last = k === ORDER_PAGES.length;
  return {
    id: ORDER_PAGES[k - 1],
    title: ORDER_SCREEN_TITLE,
    terminal: true,
    success: true,
    data: k === 1 ? orderDataModel() : {},
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: oref(k, `t${k}`) },
        { type: "TextBody", text: oref(k, "note") },
        { type: "TextBody", text: oref(k, "del") },
        ...orderPageSlots(k).map((n) => ({
          type: "TextInput",
          name: `q${n}`,
          label: oref(k, `l${n}`),
          "input-type": "number",
          required: false,
          "helper-text": oref(k, `h${n}`),
          visible: oref(k, `v${n}`),
          "init-value": oref(k, `i${n}`),
        })),
        last ? orderSubmitFooter(k) : { type: "If", condition: oref(k, `m${k}`), then: [orderNextFooter(k)], else: [orderSubmitFooter(k)] },
      ],
    },
  };
}
/** Forward routes only, stated (the «التالي» footers sit inside an `If`). */
export const orderRoutingModel = () => Object.fromEntries(ORDER_PAGES.map((id, i) => [id, ORDER_PAGES[i + 1] ? [ORDER_PAGES[i + 1]] : []]));
export function buildOrderFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: orderRoutingModel(), screens: orderPages().map(({ k }) => orderScreen(k)) };
}

// ================================================================ utak_register_v1
export const REGISTER_FLOW_NAME = "utak_register_v1";
export const REGISTER_SCREEN = "REGISTER";
export const REGISTER_SCREEN_TITLE = "تسجيل محلك";
export const REGISTER_CTA = "سجّل محلك";
/** The activity's choices: the id is res.partner.x_customer_type's value. */
export const REGISTER_ACTIVITIES = [
  { id: "grocery", title: "بقالة / تموينات" },
  { id: "restaurant", title: "مطعم" },
  { id: "juice", title: "محل عصير" },
  { id: "hotel", title: "فندق / تموين" },
  { id: "other", title: "أخرى" },
];
/** The form's fields: [name, label (20 characters at Meta), helper text, required]. */
export const REGISTER_FIELDS = [
  ["shop", "اسم المحل", "الاسم اللي نكتبه على الفاتورة", true],
  ["contact", "اسم المسؤول", "اللي نتواصل معه عن الطلبات", false],
  ["legal", "الاسم النظامي", "اختياري — كما في السجل التجاري", false],
  ["vat", "الرقم الضريبي", "اختياري — 15 رقماً يبدأ وينتهي بـ 3", false],
  ["district", "الحي", "حي المحل في الرياض", false],
];

export function registerDataModel() {
  const data = { note: { type: "string", __example__: "عبّ بيانات محلك مرة واحدة، ونجهّز طلباتك وفواتيرك عليها." } };
  for (const [name] of REGISTER_FIELDS) data[`i_${name}`] = { type: "string", __example__: "" };
  return data;
}
const input = ([name, label, helper, required]) => ({
  type: "TextInput", name, label, "input-type": name === "vat" ? "number" : "text", required, "helper-text": helper, "init-value": `\${data.i_${name}}`,
});
export function buildRegisterFlowJson() {
  const [shop, ...rest] = REGISTER_FIELDS;
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: REGISTER_SCREEN,
      title: REGISTER_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: registerDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextBody", text: "${data.note}" },
          input(shop),
          { type: "Dropdown", name: "activity", label: "النشاط", required: false, "data-source": REGISTER_ACTIVITIES },
          ...rest.map(input),
          { type: "Footer", label: FLOW_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: Object.fromEntries(["shop", "activity", "contact", "legal", "vat", "district"].map((n) => [n, `\${form.${n}}`])) } },
        ],
      },
    }],
  };
}

/** The two Flows of § 53, as the Meta script walks them. */
export const FLOWS = [
  { key: "order", name: ORDER_FLOW_NAME, build: buildOrderFlowJson, first: ORDER_FIRST_SCREEN },
  { key: "register", name: REGISTER_FLOW_NAME, build: buildRegisterFlowJson, first: REGISTER_SCREEN },
];
