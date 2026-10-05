// § 54 ج (2026-10-05) — Baraa's review of the day's prices as a WhatsApp Flow, as data.
//
// Pure: no network, no worker import. scripts/s54-20261005-flows.mjs sends it to Meta;
// tests/s54.test.mts checks it against what the worker builds (src/price-review.ts: the pages, the
// slot count, the data keys, the payload).
//
// No endpoint: the worker passes ALL the data with the message to the first screen (flow_action
// navigate), as utak_price_ask_v2 and utak_order_v1 do, and a published Flow's JSON is frozen — any
// change of its shape is a new Flow.
//
// ---- utak_owner_review_v1 ----
// FOUR generic pages (REVIEW_A … REVIEW_D) of fifteen items. Each item is three components:
//   • a line of text: «شراء X · سوق Y · الفرق Z · بدون خسارة B · مقترح P»;
//   • a list (Dropdown) opened on the proposed decision — «انشر بالمقترح (P)», «انشر بسعر السوق (Y)»
//     (only when there is a market price), «لا تنشر», «سعر يدوي»: the worker sends each item's own
//     options;
//   • a number field «السعر اليدوي», read by the worker only with «سعر يدوي».
// The worker fills the pages in order with the categories that HAVE items (فواكه، خضار، ورقيات،
// أخرى); a category of more than fifteen continues on the next page. «التالي» never opens an empty
// page, and «اعتمد» sits on the last page that has items.
//   t<k>         page k's heading: its category
//   m<k>         a page follows page k (k = 1 … 3)
//   x<n>         slot n's line of numbers           l<n>   its list's label — the item's name (20 characters at Meta)
//   o<n>         its options [{ id, title }] (a title holds 30 characters at Meta)
//   s<n>         the option it opens on (the proposed decision, or Baraa's own)
//   i<n>         the manual price it opens with     v<n>   slot n is shown
// The reply carries d<n> (the option's id) and p<n> (the manual price) of every page up to the one
// «اعتمد» was tapped on, and the flow_token.

export const FLOW_JSON_VERSION = "6.0";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_NEXT_LABEL = "التالي";
export const REVIEW_SUBMIT_LABEL = "اعتمد";

export const REVIEW_FLOW_NAME = "utak_owner_review_v1";
export const REVIEW_PAGES = ["REVIEW_A", "REVIEW_B", "REVIEW_C", "REVIEW_D"];
export const REVIEW_FIRST_SCREEN = REVIEW_PAGES[0];
export const REVIEW_PAGE_SLOTS = 15;
export const REVIEW_SLOTS = REVIEW_PAGES.length * REVIEW_PAGE_SLOTS;
export const REVIEW_SCREEN_TITLE = "مراجعة أسعار اليوم";
export const REVIEW_CTA = "راجع الأسعار";
export const REVIEW_MANUAL_LABEL = "السعر اليدوي";
export const REVIEW_MANUAL_HINT = "يُقرأ مع «سعر يدوي» فقط";
/** The ids of a list's options: x_decision's own values, and «سعر يدوي». */
export const REVIEW_OPTION_IDS = ["profit", "market", "skip", "manual"];
/** Meta: at most this many components on a screen. */
export const SCREEN_COMPONENTS_MAX = 50;

const reviewPages = () => REVIEW_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–15, 16–30, … */
export const reviewPageSlots = (k) => Array.from({ length: REVIEW_PAGE_SLOTS }, (_, i) => (k - 1) * REVIEW_PAGE_SLOTS + i + 1);

const OPTION_ITEMS = { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } };
/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function reviewDataModel() {
  const data = {};
  for (const { k } of reviewPages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < REVIEW_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of reviewPageSlots(k)) {
      data[`x${n}`] = { type: "string", __example__: n === 1 ? "شراء 55 · سوق 70 · الفرق 15 · بدون خسارة 68.70 · مقترح 71.50" : "-" };
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "موز أمريكي" : "-" };
      data[`o${n}`] = {
        type: "array", items: OPTION_ITEMS,
        __example__: n === 1
          ? [{ id: "profit", title: "انشر بالمقترح (71.50)" }, { id: "market", title: "انشر بسعر السوق (70)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]
          : [{ id: "skip", title: "-" }],
      };
      data[`s${n}`] = { type: "string", __example__: n === 1 ? "market" : "skip" };
      data[`i${n}`] = { type: "string", __example__: "" };
      data[`v${n}`] = { type: "boolean", __example__: n === 1 };
    }
  }
  return data;
}

/** A data key as page k reads it: its own on the first page, the first page's on the others. */
const rref = (k, key) => (k === 1 ? `\${data.${key}}` : `\${screen.${REVIEW_FIRST_SCREEN}.data.${key}}`);
/** A field's value in the «اعتمد» payload of page k: its own form, or an earlier page's. */
const rformRef = (k, name, n) => {
  const owner = Math.ceil(n / REVIEW_PAGE_SLOTS);
  return owner === k ? `\${form.${name}${n}}` : `\${screen.${REVIEW_PAGES[owner - 1]}.form.${name}${n}}`;
};
function reviewSubmitFooter(k) {
  const upTo = Array.from({ length: k * REVIEW_PAGE_SLOTS }, (_, i) => i + 1);
  return {
    type: "Footer", label: REVIEW_SUBMIT_LABEL,
    "on-click-action": { name: "complete", payload: Object.fromEntries(upTo.flatMap((n) => [[`d${n}`, rformRef(k, "d", n)], [`p${n}`, rformRef(k, "p", n)]])) },
  };
}
function reviewNextFooter(k) {
  return { type: "Footer", label: FLOW_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: REVIEW_PAGES[k] }, payload: {} } };
}
/** The three components of slot n on page k. */
export function reviewSlot(k, n) {
  return [
    { type: "TextCaption", text: rref(k, `x${n}`), visible: rref(k, `v${n}`) },
    // required while it is shown: no «(اختياري)» beside the item's name, and the choice cannot be emptied
    { type: "Dropdown", name: `d${n}`, label: rref(k, `l${n}`), required: rref(k, `v${n}`), "data-source": rref(k, `o${n}`), "init-value": rref(k, `s${n}`), visible: rref(k, `v${n}`) },
    { type: "TextInput", name: `p${n}`, label: REVIEW_MANUAL_LABEL, "input-type": "number", required: false, "helper-text": REVIEW_MANUAL_HINT, "init-value": rref(k, `i${n}`), visible: rref(k, `v${n}`) },
  ];
}
function reviewScreen(k) {
  const last = k === REVIEW_PAGES.length;
  return {
    id: REVIEW_PAGES[k - 1],
    title: REVIEW_SCREEN_TITLE,
    terminal: true,
    success: true,
    data: k === 1 ? reviewDataModel() : {},
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: rref(k, `t${k}`) },
        ...reviewPageSlots(k).flatMap((n) => reviewSlot(k, n)),
        last ? reviewSubmitFooter(k) : { type: "If", condition: rref(k, `m${k}`), then: [reviewNextFooter(k)], else: [reviewSubmitFooter(k)] },
      ],
    },
  };
}
/** Every component of a screen, the ones inside an `If` too. */
export function screenComponents(screen) {
  const walk = (c) => [c, ...(c.then ?? []).flatMap(walk), ...(c.else ?? []).flatMap(walk)];
  return screen.layout.children.flatMap(walk);
}
/** Forward routes only, stated (the «التالي» footers sit inside an `If`). */
export const reviewRoutingModel = () => Object.fromEntries(REVIEW_PAGES.map((id, i) => [id, REVIEW_PAGES[i + 1] ? [REVIEW_PAGES[i + 1]] : []]));
export function buildReviewFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: reviewRoutingModel(), screens: reviewPages().map(({ k }) => reviewScreen(k)) };
}

/** The Flow of § 54, as the Meta script walks it. */
export const FLOWS = [
  { key: "review", name: REVIEW_FLOW_NAME, build: buildReviewFlowJson, first: REVIEW_FIRST_SCREEN },
];
