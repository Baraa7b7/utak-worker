// § 62 ب (2026-10-07) — the price form of «طلب أسعار خاص» (utak_price_ask_special_v1), as data.
//
// Pure: no network, no worker import. scripts/s62-20261007-flows.mjs sends it to Meta;
// tests/s62-ask.test.mts checks it against what the worker builds (src/special-ask.ts).
//
// It is utak_price_ask_v2 (§ 52, scripts/lib/s52-price-flow.mjs) — four generic pages of fifteen
// optional number fields, no endpoint, ALL the data sent with the message to the first page — with
// two differences:
//   • its screens are titled «طلب أسعار خاص» (v2's say «أسعار اليوم»);
//   • the page «إرسال» sits on also carries ONE optional text field «ملاحظة» (a price by the carton,
//     an origin): `remark` in the reply.
// The data keys are v2's, letter for letter (sub, note, t<k>, m<k>, l<n>, h<n>, v<n>, i<n>): outside a
// source's 24h window the same data goes with the template utak_price_ask_flow_v2, whose button opens
// v2 — the same fields without «ملاحظة» — and the reply is read by the same flow_token.
//
//   sub          «طلب أسعار خاص — 27 صنف»
//   note         the role's line («سعرك بالكيلو بدون ضريبة» / «سعر البيع في السوق بالكيلو شامل الضريبة»)
//   t<k>         page k's heading: its category     m<k>   a page follows page k (k = 1 … 3)
//   l<n> h<n>    slot n's label (20 characters) and hint (80): the quantity for a purchase source
//   v<n>         slot n is shown                    i<n>   its initial value («تعديل»)
// The reply (nfm_reply.response_json): p<n> of every page up to the one «إرسال» was tapped on,
// `remark`, and the flow_token.

export const FLOW_NAME = "utak_price_ask_special_v1";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_JSON_VERSION = "6.0";
export const FLOW_PAGES = ["PAGE_A", "PAGE_B", "PAGE_C", "PAGE_D"];
export const FLOW_FIRST_SCREEN = FLOW_PAGES[0];
export const FLOW_PAGE_SLOTS = 15;
export const FLOW_SLOTS = FLOW_PAGES.length * FLOW_PAGE_SLOTS;
export const FLOW_NEXT_LABEL = "التالي";
export const FLOW_SUBMIT_LABEL = "إرسال";
export const FLOW_SCREEN_TITLE = "طلب أسعار خاص";
export const FLOW_CTA = "أدخل الأسعار";
export const REMARK_FIELD = "remark";
export const REMARK_LABEL = "ملاحظة (اختياري)";
export const REMARK_HELP = "مثلاً: السعر بالكرتون، أو المنشأ";
export const REMARK_MAX = 300;

const pages = () => FLOW_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–15, 16–30, … */
export const pageSlots = (k) => Array.from({ length: FLOW_PAGE_SLOTS }, (_, i) => (k - 1) * FLOW_PAGE_SLOTS + i + 1);

/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function flowDataModel() {
  const data = {
    sub: { type: "string", __example__: "طلب أسعار خاص — 27 صنف" },
    note: { type: "string", __example__: "سعرك بالكيلو بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر." },
  };
  for (const { k } of pages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < FLOW_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of pageSlots(k)) {
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "برتقال" : "-" };
      data[`h${n}`] = { type: "string", __example__: n === 1 ? "الكمية: 1464 كيلو" : "-" };
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

/** «ملاحظة»: on the page «إرسال» sits on, above it. */
const remarkInput = () => ({ type: "TextArea", name: REMARK_FIELD, label: REMARK_LABEL, required: false, "helper-text": REMARK_HELP, "max-length": REMARK_MAX });
function submitFooter(k) {
  const upTo = Array.from({ length: k * FLOW_PAGE_SLOTS }, (_, i) => i + 1);
  return {
    type: "Footer",
    label: FLOW_SUBMIT_LABEL,
    "on-click-action": { name: "complete", payload: { ...Object.fromEntries(upTo.map((n) => [`p${n}`, formRef(k, n)])), [REMARK_FIELD]: `\${form.${REMARK_FIELD}}` } },
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
        // «التالي» while a page with items follows; on the last one that has any: «ملاحظة», then «إرسال»
        ...(last ? [remarkInput(), submitFooter(k)] : [{ type: "If", condition: ref(k, `m${k}`), then: [nextFooter(k)], else: [remarkInput(), submitFooter(k)] }]),
      ],
    },
  };
}

/** Forward routes only: each page to the next. Stated, not left to Meta: the «التالي» footers sit inside an `If`. */
export const flowRoutingModel = () => Object.fromEntries(FLOW_PAGES.map((id, i) => [id, FLOW_PAGES[i + 1] ? [FLOW_PAGES[i + 1]] : []]));

export function buildFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: flowRoutingModel(), screens: pages().map(({ k }) => pageScreen(k)) };
}

export const FLOW = { key: "special", name: FLOW_NAME, build: buildFlowJson };
export const FLOWS = [FLOW];
