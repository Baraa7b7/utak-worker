// § 55 (2026-10-05) — the WhatsApp Flows of § 55, as data.
//
// Pure: no network, no worker import. scripts/s55-20261005-flows.mjs sends them to Meta;
// tests/s55.test.mts checks each against what the worker builds (the pages, the slot count, the data
// keys, the payload).
//
// No endpoint: the worker passes ALL the data with the message to the first screen (flow_action
// navigate), as utak_price_ask_v2, utak_order_v1 and utak_owner_review_v1 do, and a published Flow's
// JSON is frozen — any change of its shape is a new Flow.
//
// ---- utak_owner_review_v2 (§ 55 أ) ----
// Baraa's review of the day's prices, made plain: TWO lines of text an item where v1 (§ 54,
// scripts/lib/s54-flows.mjs) had one. SIX generic pages (REVIEW_A … REVIEW_F) of ten items. Each item is
// four components:
//   • «شراء X · سوق Y · ربحنا بسعر السوق: ±a»                      (x<n>)
//   • «سعرنا المقترح P = أعلى/أقل من السوق بـ d (±e%)»             (y<n>)
//   • a list (Dropdown) opened on the proposed decision, every choice with its own profit —
//     «بالمقترح 31.50 (ربح +2.30)», «بسعر السوق 28 (ربح −0.74)» (only with a market price), «لا تنشر»,
//     «سعر يدوي»: the worker sends each item's own options;
//   • a number field «السعر اليدوي», read by the worker only with «سعر يدوي».
// Meta allows fifty components a screen: 10 × 4 + the heading + the `If` and its two footers = 44.
// The worker fills the pages in order with the categories that HAVE items (فواكه، خضار، ورقيات،
// أخرى); a category of more than ten continues on the next page. «التالي» never opens an empty page,
// and «اعتمد» sits on the last page that has items.
//   t<k>         page k's heading: its category
//   m<k>         a page follows page k (k = 1 … 5)
//   x<n> y<n>    slot n's two lines                 l<n>   its list's label — the item's name (20 characters at Meta)
//   o<n>         its options [{ id, title }] (a title holds 30 characters at Meta)
//   s<n>         the option it opens on (the proposed decision, or Baraa's own)
//   i<n>         the manual price it opens with     v<n>   slot n is shown
// The reply carries d<n> (the option's id) and p<n> (the manual price) of every page up to the one
// «اعتمد» was tapped on, and the flow_token — the same reply as v1's.

export const FLOW_JSON_VERSION = "6.0";
export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_NEXT_LABEL = "التالي";
/** Meta: at most this many components on a screen. */
export const SCREEN_COMPONENTS_MAX = 50;

const OPTION_ITEMS = { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } };
/** Every component of a screen, the ones inside an `If` too. */
export function screenComponents(screen) {
  const walk = (c) => [c, ...(c.then ?? []).flatMap(walk), ...(c.else ?? []).flatMap(walk)];
  return screen.layout.children.flatMap(walk);
}

// ================================================================ utak_owner_review_v2

export const REVIEW_SUBMIT_LABEL = "اعتمد";
export const REVIEW_FLOW_NAME = "utak_owner_review_v2";
export const REVIEW_PAGES = ["REVIEW_A", "REVIEW_B", "REVIEW_C", "REVIEW_D", "REVIEW_E", "REVIEW_F"];
export const REVIEW_FIRST_SCREEN = REVIEW_PAGES[0];
export const REVIEW_PAGE_SLOTS = 10;
export const REVIEW_SLOTS = REVIEW_PAGES.length * REVIEW_PAGE_SLOTS;
export const REVIEW_SCREEN_TITLE = "أسعار اليوم";
export const REVIEW_CTA = "عدّل الأسعار";
export const REVIEW_MANUAL_LABEL = "السعر اليدوي";
export const REVIEW_MANUAL_HINT = "يُقرأ مع «سعر يدوي» فقط";
/** The ids of a list's options: x_decision's own values, and «سعر يدوي». */
export const REVIEW_OPTION_IDS = ["profit", "market", "skip", "manual"];

const reviewPages = () => REVIEW_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–10, 11–20, … */
export const reviewPageSlots = (k) => Array.from({ length: REVIEW_PAGE_SLOTS }, (_, i) => (k - 1) * REVIEW_PAGE_SLOTS + i + 1);

/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function reviewDataModel() {
  const data = {};
  for (const { k } of reviewPages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < REVIEW_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of reviewPageSlots(k)) {
      data[`x${n}`] = { type: "string", __example__: n === 1 ? "شراء 22 · سوق 28 · ربحنا بسعر السوق: −0.74" : "-" };
      data[`y${n}`] = { type: "string", __example__: n === 1 ? "سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)" : "-" };
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير" : "-" };
      data[`o${n}`] = {
        type: "array", items: OPTION_ITEMS,
        __example__: n === 1
          ? [{ id: "profit", title: "بالمقترح 31.50 (ربح +2.30)" }, { id: "market", title: "بسعر السوق 28 (ربح −0.74)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]
          : [{ id: "skip", title: "-" }],
      };
      data[`s${n}`] = { type: "string", __example__: "skip" };
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
/** The four components of slot n on page k. */
export function reviewSlot(k, n) {
  return [
    { type: "TextCaption", text: rref(k, `x${n}`), visible: rref(k, `v${n}`) },
    { type: "TextCaption", text: rref(k, `y${n}`), visible: rref(k, `v${n}`) },
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
/** Forward routes only, stated (the «التالي» footers sit inside an `If`). */
export const reviewRoutingModel = () => Object.fromEntries(REVIEW_PAGES.map((id, i) => [id, REVIEW_PAGES[i + 1] ? [REVIEW_PAGES[i + 1]] : []]));
export function buildReviewFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: reviewRoutingModel(), screens: reviewPages().map(({ k }) => reviewScreen(k)) };
}

// ================================================================ utak_receipt_v1 (§ 55 د)
//
// The buyer's receipt of the day's purchases (src/receipt-form.ts), TWO screens, no endpoint:
//   RECEIPT_A «ما استلمته من الموردين» — a heading, a line of text, THIRTY number fields g<n>: the
//             quantity RECEIVED of each item of the purchase list, opened on the quantity ordered. No
//             price of ours is anywhere in it: the item's name, its packaging, «المطلوب N» and its
//             supplier's name. «التالي» → RECEIPT_B.
//   RECEIPT_B «مشتريات السوق النقدي» — a heading, a line saying it is optional, FIVE rows of four
//             fields — ci<k> the item (a list of the active items), cq<k> the quantity, cp<k> the price
//             he PAID for a carton, cs<k> the seller's name — then ONE PhotoPicker `photo` (the tax
//             invoice, optional) and «إرسال» (complete).
// The data, all on RECEIPT_A (RECEIPT_B reads it from there):
//   t1 n1        RECEIPT_A's heading and its line          t2 n2   RECEIPT_B's
//   l<n> h<n>    slot n's label — the item's name (20 characters at Meta) — and its hint:
//                «التعبئة · المطلوب N · المورد» (80)
//   i<n>         what the field opens with: the quantity ordered     v<n>   slot n is shown
//   items        the options of every row's list [{ id: "<product>:<packaging>", title }] (a title holds
//                30 characters at Meta, a list 200 options)
// The reply carries g1 … g30, ci / cq / cp / cs of the five rows, `photo` and the flow_token.
// PhotoPicker (Flow JSON 4.0+), Meta's rules: one a screen; its value a TOP-LEVEL string property of the
// `complete` payload ("photo": "${form.photo}"), never in a `navigate` payload, never inside If / Switch;
// no `required` (min-uploaded-photos 0 = optional); max-uploaded-photos stated (the default 30 is
// refused); it cannot be pre-filled. Without an endpoint the reply's response_json then holds
// "photo": [{ file_name, mime_type, sha256, id }] and the id is downloaded as any inbound media.

export const FLOW_SUBMIT_LABEL = "إرسال";
export const RECEIPT_FLOW_NAME = "utak_receipt_v1";
export const RECEIPT_SCREENS = ["RECEIPT_A", "RECEIPT_B"];
export const RECEIPT_FIRST_SCREEN = RECEIPT_SCREENS[0];
export const RECEIPT_CASH_SCREEN = RECEIPT_SCREENS[1];
export const RECEIPT_SLOTS = 30;
export const RECEIPT_CASH_ROWS = 5;
export const RECEIPT_SCREEN_TITLE = "استلام المشتريات";
export const RECEIPT_CTA = "استلام المشتريات";
/** The photos one reply may carry (Meta's documents disagree on what a `complete` payload allows: 1 or up to 10). */
export const RECEIPT_PHOTO_MAX = 1;
/** The largest photo the picker takes, in KiB (Meta's default is 25600: too much to hand to Odoo as base64). */
export const RECEIPT_PHOTO_MAX_KB = 10240;
export const RECEIPT_PHOTO_NAME = "photo";
export const RECEIPT_PHOTO_LABEL = "صورة الفاتورة الضريبية";
export const RECEIPT_PHOTO_HINT = "اختياري: صوّر الفاتورة أو اخترها من الصور. لو ما رفعتها هنا أرسلها صورة عادية بعد النموذج.";
/** A cash-market row's four fields: [name prefix, type, label (20 characters at Meta), helper text]. */
export const RECEIPT_CASH_FIELDS = [
  ["ci", "Dropdown", "الصنف", ""],
  ["cq", "number", "الكمية", "عدد الكراتين اللي اشتريتها"],
  ["cp", "number", "السعر المدفوع", "سعر الكرتون الواحد كما دفعته، بالريال"],
  ["cs", "text", "اسم البائع", "المحل أو البائع في السوق"],
];

/** The slots of RECEIPT_A: 1 … 30. */
export const receiptSlots = () => Array.from({ length: RECEIPT_SLOTS }, (_, i) => i + 1);
/** The rows of RECEIPT_B: 1 … 5. */
export const receiptCashRows = () => Array.from({ length: RECEIPT_CASH_ROWS }, (_, i) => i + 1);

/** RECEIPT_A's data model: every key the worker sends, with Meta's mandatory example. */
export function receiptDataModel() {
  const data = {
    t1: { type: "string", __example__: "ما استلمته من الموردين" },
    n1: { type: "string", __example__: "أكّد الكمية المستلمة لكل صنف: الخانة فيها المطلوب، عدّلها لو استلمت غيره، واكتب 0 لو ما استلمته." },
    t2: { type: "string", __example__: "مشتريات السوق النقدي" },
    n2: { type: "string", __example__: "اختياري: اتركه فاضي لو ما اشتريت شي من السوق النقدي." },
    items: { type: "array", items: OPTION_ITEMS, __example__: [{ id: "1:11", title: "طماطم — كرتون" }] },
  };
  for (const n of receiptSlots()) {
    data[`l${n}`] = { type: "string", __example__: n === 1 ? "طماطم" : "-" };
    data[`h${n}`] = { type: "string", __example__: n === 1 ? "كرتون · المطلوب 5 · أحمد حسان" : "-" };
    data[`i${n}`] = { type: "string", __example__: n === 1 ? "5" : "" };
    data[`v${n}`] = { type: "boolean", __example__: n === 1 };
  }
  return data;
}

/** A data key as RECEIPT_B reads it: RECEIPT_A's. */
const cref = (key) => `\${screen.${RECEIPT_FIRST_SCREEN}.data.${key}}`;
/** Slot n's field on RECEIPT_A: required while it is shown — a quantity received is always stated (0 = none of it). */
export function receiptSlot(n) {
  return {
    type: "TextInput", name: `g${n}`, label: `\${data.l${n}}`, "input-type": "number", required: `\${data.v${n}}`,
    "helper-text": `\${data.h${n}}`, "init-value": `\${data.i${n}}`, visible: `\${data.v${n}}`,
  };
}
/** The four fields of cash-market row k on RECEIPT_B: none is required (the worker reads a row by its item). */
export function receiptCashRow(k) {
  return RECEIPT_CASH_FIELDS.map(([name, type, label, helper]) => (type === "Dropdown"
    ? { type: "Dropdown", name: `${name}${k}`, label: `${label} ${k}`, required: false, "data-source": cref("items") }
    : { type: "TextInput", name: `${name}${k}`, label, "input-type": type, required: false, "helper-text": helper }));
}
export function receiptPhotoPicker() {
  return {
    type: "PhotoPicker", name: RECEIPT_PHOTO_NAME, label: RECEIPT_PHOTO_LABEL, description: RECEIPT_PHOTO_HINT,
    "min-uploaded-photos": 0, "max-uploaded-photos": RECEIPT_PHOTO_MAX, "max-file-size-kb": RECEIPT_PHOTO_MAX_KB,
  };
}
/** «إرسال»: every quantity of RECEIPT_A, the five rows, and the photo — a top-level property, as Meta requires. */
export function receiptSubmitPayload() {
  return {
    ...Object.fromEntries(receiptSlots().map((n) => [`g${n}`, `\${screen.${RECEIPT_FIRST_SCREEN}.form.g${n}}`])),
    ...Object.fromEntries(receiptCashRows().flatMap((k) => RECEIPT_CASH_FIELDS.map(([name]) => [`${name}${k}`, `\${form.${name}${k}}`]))),
    [RECEIPT_PHOTO_NAME]: `\${form.${RECEIPT_PHOTO_NAME}}`,
  };
}
export const receiptRoutingModel = () => ({ [RECEIPT_FIRST_SCREEN]: [RECEIPT_CASH_SCREEN], [RECEIPT_CASH_SCREEN]: [] });
export function buildReceiptFlowJson() {
  return {
    version: FLOW_JSON_VERSION,
    routing_model: receiptRoutingModel(),
    screens: [
      {
        id: RECEIPT_FIRST_SCREEN,
        title: RECEIPT_SCREEN_TITLE,
        data: receiptDataModel(),
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextHeading", text: "${data.t1}" },
            { type: "TextBody", text: "${data.n1}" },
            ...receiptSlots().map(receiptSlot),
            { type: "Footer", label: FLOW_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: RECEIPT_CASH_SCREEN }, payload: {} } },
          ],
        },
      },
      {
        id: RECEIPT_CASH_SCREEN,
        title: RECEIPT_SCREEN_TITLE,
        terminal: true,
        success: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextHeading", text: cref("t2") },
            { type: "TextBody", text: cref("n2") },
            ...receiptCashRows().flatMap(receiptCashRow),
            receiptPhotoPicker(),
            { type: "Footer", label: FLOW_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: receiptSubmitPayload() } },
          ],
        },
      },
    ],
  };
}

// ================================================================ utak_carload_v1
//
// ---- utak_carload_v1 (§ 55 ج) ----
// The car's load, ONE Flow for its two moments (src/car-load.ts). FOUR generic pages (LOAD_A … LOAD_D)
// of fifteen slots; a slot is TWO optional number fields:
//   • a<n> — the morning: the quantity loaded; the evening: what is LEFT on the car
//   • b<n> — the evening alone: what is damaged (hidden in the morning)
// Meta allows fifty components a screen: 15 × 2 + the heading + the line of text + the `If` and its two
// footers = 35. The worker fills the pages in order with the categories that HAVE items (فواكه، خضار،
// ورقيات، أخرى); a category of more than fifteen continues on the next page. «التالي» never opens an
// empty page, and «إرسال» sits on the last page that has items. No price of any kind is in it.
//   note         the line under the heading: what to write, by the moment
//   t<k>         page k's heading: the moment and its category
//   m<k>         a page follows page k (k = 1 … 3)
//   l<n> h<n>    a<n>'s label — the item's name (20 characters at Meta) — and its hint (80): the
//                packaging in the morning, «الباقي في السيارة · المحمّل 20 كرتون» in the evening
//   g<n>         b<n>'s label: «تالف: <the item>» (20)
//   v<n>         slot n is shown          w<n>   its second field is shown (the evening)
//   i<n> j<n>    what a<n> and b<n> open with (a form sent again: what is on record, or what he wrote)
// The reply carries a<n> and b<n> of every page up to the one «إرسال» was tapped on, and the flow_token.

export const CARLOAD_FLOW_NAME = "utak_carload_v1";
export const CARLOAD_PAGES = ["LOAD_A", "LOAD_B", "LOAD_C", "LOAD_D"];
export const CARLOAD_FIRST_SCREEN = CARLOAD_PAGES[0];
export const CARLOAD_PAGE_SLOTS = 15;
export const CARLOAD_SLOTS = CARLOAD_PAGES.length * CARLOAD_PAGE_SLOTS;
export const CARLOAD_SCREEN_TITLE = "حمولة السيارة";
export const CARLOAD_SUBMIT_LABEL = "إرسال";

const carloadPages = () => CARLOAD_PAGES.map((id, k) => ({ id, k: k + 1 }));
/** The slots of page k (1-based): 1–15, 16–30, … */
export const carloadPageSlots = (k) => Array.from({ length: CARLOAD_PAGE_SLOTS }, (_, i) => (k - 1) * CARLOAD_PAGE_SLOTS + i + 1);

/** The first page's data model: every key the worker sends, with Meta's mandatory example. */
export function carloadDataModel() {
  const data = { note: { type: "string", __example__: "اكتب الكمية المحمّلة جنب كل صنف. الخانة الفاضية = صفر." } };
  for (const { k } of carloadPages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "حمولة الصباح — فواكه" : "-" };
    if (k < CARLOAD_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of carloadPageSlots(k)) {
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير" : "-" };
      data[`h${n}`] = { type: "string", __example__: n === 1 ? "كرتون · الكمية المحمّلة" : "-" };
      data[`g${n}`] = { type: "string", __example__: n === 1 ? "تالف: رمان كبير" : "-" };
      data[`v${n}`] = { type: "boolean", __example__: n === 1 };
      data[`w${n}`] = { type: "boolean", __example__: false };
      data[`i${n}`] = { type: "string", __example__: "" };
      data[`j${n}`] = { type: "string", __example__: "" };
    }
  }
  return data;
}

/** A data key as page k reads it: its own on the first page, the first page's on the others. */
const lref = (k, key) => (k === 1 ? `\${data.${key}}` : `\${screen.${CARLOAD_FIRST_SCREEN}.data.${key}}`);
/** A field's value in the «إرسال» payload of page k: its own form, or an earlier page's. */
const cformRef = (k, name, n) => {
  const owner = Math.ceil(n / CARLOAD_PAGE_SLOTS);
  return owner === k ? `\${form.${name}${n}}` : `\${screen.${CARLOAD_PAGES[owner - 1]}.form.${name}${n}}`;
};
function carloadSubmitFooter(k) {
  const upTo = Array.from({ length: k * CARLOAD_PAGE_SLOTS }, (_, i) => i + 1);
  return {
    type: "Footer", label: CARLOAD_SUBMIT_LABEL,
    "on-click-action": { name: "complete", payload: Object.fromEntries(upTo.flatMap((n) => [[`a${n}`, cformRef(k, "a", n)], [`b${n}`, cformRef(k, "b", n)]])) },
  };
}
function carloadNextFooter(k) {
  return { type: "Footer", label: FLOW_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: CARLOAD_PAGES[k] }, payload: {} } };
}
/** The two fields of slot n on page k. */
export function carloadSlot(k, n) {
  return [
    { type: "TextInput", name: `a${n}`, label: lref(k, `l${n}`), "input-type": "number", required: false, "helper-text": lref(k, `h${n}`), visible: lref(k, `v${n}`), "init-value": lref(k, `i${n}`) },
    { type: "TextInput", name: `b${n}`, label: lref(k, `g${n}`), "input-type": "number", required: false, visible: lref(k, `w${n}`), "init-value": lref(k, `j${n}`) },
  ];
}
function carloadScreen(k) {
  const last = k === CARLOAD_PAGES.length;
  return {
    id: CARLOAD_PAGES[k - 1],
    title: CARLOAD_SCREEN_TITLE,
    terminal: true,
    success: true,
    data: k === 1 ? carloadDataModel() : {},
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: lref(k, `t${k}`) },
        { type: "TextBody", text: lref(k, "note") },
        ...carloadPageSlots(k).flatMap((n) => carloadSlot(k, n)),
        last ? carloadSubmitFooter(k) : { type: "If", condition: lref(k, `m${k}`), then: [carloadNextFooter(k)], else: [carloadSubmitFooter(k)] },
      ],
    },
  };
}
/** Forward routes only, stated (the «التالي» footers sit inside an `If`). */
export const carloadRoutingModel = () => Object.fromEntries(CARLOAD_PAGES.map((id, i) => [id, CARLOAD_PAGES[i + 1] ? [CARLOAD_PAGES[i + 1]] : []]));
export function buildCarloadFlowJson() {
  return { version: FLOW_JSON_VERSION, routing_model: carloadRoutingModel(), screens: carloadPages().map(({ k }) => carloadScreen(k)) };
}

/** The Flows of § 55, as the Meta script walks them. */
export const FLOWS = [
  { key: "review", name: REVIEW_FLOW_NAME, build: buildReviewFlowJson, first: REVIEW_FIRST_SCREEN },
  { key: "receipt", name: RECEIPT_FLOW_NAME, build: buildReceiptFlowJson, first: RECEIPT_FIRST_SCREEN },
  { key: "carload", name: CARLOAD_FLOW_NAME, build: buildCarloadFlowJson, first: CARLOAD_FIRST_SCREEN },
];
