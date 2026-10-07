// § 65 (2026-10-07) — the four WhatsApp Flows and the two templates of the suppliers' registry, as data.
//
// Pure: no network, no worker import. scripts/s65-20261007-flows.mjs and -templates.mjs send them to
// Meta; tests/s65-*.test.mts check them against what the worker builds and reads (src/price-flow.ts,
// src/price-extra.ts, src/supplier-registry.ts, src/supplier-offer.ts). None has an endpoint: everything a
// form shows goes with the message (flow_action navigate), and a published Flow's JSON is frozen.
//
// ---- utak_price_ask_v3 — the day's (and a special request's) price form with «المقاس» and «المنشأ» ----
// utak_price_ask_v2 (§ 52) page for page — PAGE_A … PAGE_D, fifteen slots each, the same slot numbers and
// the same data keys (t<k>, m<k>, l<n>, h<n>, v<n>, i<n>, note) — and under every price two optional text
// fields: s<n> «المقاس» and o<n> «المنشأ» (what «تعديل» opens them with: is<n>, io<n>). Fifty components
// a page is Meta's limit, so v2's two lines above the fields — the form's title (`sub`) and the page's
// category (t<k>) — are ONE heading here: «أسعار الشراء اليوم — فواكه». Outside a source's window the
// template utak_price_ask_flow_v2 still opens v2 with v2's own data — the same slots, without the two
// fields — and the reply is read by the same token.
//
// ---- utak_price_extra_v1 — «➕ صنف إضافي» ----
// ONE screen, five rows of five optional fields: the item (text), its price, its packaging, its size, its
// origin (xn<r>, xp<r>, xk<r>, xs<r>, xo<r>). Offered after a price form is taken; a row is kept as an
// observation outside the day's list.
//
// ---- utak_supplier_signup_v1 — «تسجيل مورد» ----
// SIGNUP (the general screen) → TYPE (what the chosen type is asked). «التالي» passes the general answers
// to TYPE as data, and TYPE shows one block by `${data.stype}` (an `If` for each type: the documented
// string comparison); «إرسال» returns the ten general answers and the block's.
//
// ---- utak_supplier_offer_v1 — «عرض مورد» («📦 بضاعتي جاهزة» / «🚢 وصلت شحنة») ----
// ONE screen: the item (a list of HIS items and «صنف آخر»), the quantity, the price, the packaging, the
// size, the origin, ready from / until, a note.

export const FLOW_CATEGORIES = ["OTHER"];
export const FLOW_JSON_VERSION = "6.0";
export const SCREEN_COMPONENTS_MAX = 50;
/** Every component of a screen, the ones inside an `If` too. */
export function screenComponents(screen) {
  const walk = (c) => [c, ...(c.then ?? []).flatMap(walk), ...(c.else ?? []).flatMap(walk)];
  return screen.layout.children.flatMap(walk);
}
/** Meta's limits on a text, by where it stands (characters). */
export const LIMITS = { screenTitle: 30, heading: 80, inputLabel: 20, inputHint: 80, footer: 35, cta: 20, dropdownTitle: 30, checkboxTitle: 30 };

// ================================================================ utak_price_ask_v3

export const PRICE_FLOW_NAME = "utak_price_ask_v3";
export const PRICE_PAGES = ["PAGE_A", "PAGE_B", "PAGE_C", "PAGE_D"];
export const PRICE_FIRST_SCREEN = PRICE_PAGES[0];
export const PRICE_PAGE_SLOTS = 15;
export const PRICE_SLOTS = PRICE_PAGES.length * PRICE_PAGE_SLOTS;
export const PRICE_SCREEN_TITLE = "طلب أسعار";
export const PRICE_NEXT_LABEL = "التالي";
export const PRICE_SUBMIT_LABEL = "إرسال";
// Meta writes «(اختياري)» after the label of a field that is not required: the label itself does not say it
export const SIZE_LABEL = "المقاس";
export const SIZE_HINT = "بلغة السوق، مثل 66";
export const ORIGIN_LABEL = "المنشأ";
export const ORIGIN_HINT = "البلد أو المنطقة";
/** The three fields of a slot in the reply: the price, the size, the origin. */
export const SLOT_FIELDS = ["p", "s", "o"];

const pricePages = () => PRICE_PAGES.map((id, k) => ({ id, k: k + 1 }));
export const priceSlots = (k) => Array.from({ length: PRICE_PAGE_SLOTS }, (_, i) => (k - 1) * PRICE_PAGE_SLOTS + i + 1);

export function priceDataModel() {
  const data = {
    sub: { type: "string", __example__: "أسعار الشراء اليوم" },
    note: { type: "string", __example__: "الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر." },
  };
  for (const { k } of pricePages()) {
    data[`t${k}`] = { type: "string", __example__: k === 1 ? "فواكه" : "-" };
    if (k < PRICE_PAGES.length) data[`m${k}`] = { type: "boolean", __example__: false };
    for (const n of priceSlots(k)) {
      data[`l${n}`] = { type: "string", __example__: n === 1 ? "رمان كبير — كرتون" : "-" };
      data[`h${n}`] = { type: "string", __example__: n === 1 ? "آخر سعر: 22" : "-" };
      data[`v${n}`] = { type: "boolean", __example__: n === 1 };
      data[`i${n}`] = { type: "string", __example__: "" };
      data[`is${n}`] = { type: "string", __example__: "" };
      data[`io${n}`] = { type: "string", __example__: "" };
    }
  }
  return data;
}
const pref = (k, key) => (k === 1 ? `\${data.${key}}` : `\${screen.${PRICE_FIRST_SCREEN}.data.${key}}`);
const pform = (k, name, n) => {
  const owner = Math.ceil(n / PRICE_PAGE_SLOTS);
  return owner === k ? `\${form.${name}${n}}` : `\${screen.${PRICE_PAGES[owner - 1]}.form.${name}${n}}`;
};
function priceSubmitFooter(k) {
  const upTo = Array.from({ length: k * PRICE_PAGE_SLOTS }, (_, i) => i + 1);
  return { type: "Footer", label: PRICE_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: Object.fromEntries(upTo.flatMap((n) => SLOT_FIELDS.map((f) => [`${f}${n}`, pform(k, f, n)]))) } };
}
const priceNextFooter = (k) => ({ type: "Footer", label: PRICE_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: PRICE_PAGES[k] }, payload: {} } });
function pricePage(k) {
  const last = k === PRICE_PAGES.length;
  return {
    id: PRICE_PAGES[k - 1], title: PRICE_SCREEN_TITLE, terminal: true, success: true, data: k === 1 ? priceDataModel() : {},
    layout: {
      type: "SingleColumnLayout",
      children: [
        // «أسعار الشراء اليوم — فواكه»: the form's title and the page's category in ONE component (the limit)
        { type: "TextHeading", text: `\`\${${pref(k, "sub").slice(2, -1)}} ' — ' \${${pref(k, `t${k}`).slice(2, -1)}}\`` },
        { type: "TextBody", text: pref(k, "note") },
        ...priceSlots(k).flatMap((n) => [
          { type: "TextInput", name: `p${n}`, label: pref(k, `l${n}`), "input-type": "number", required: false, "helper-text": pref(k, `h${n}`), visible: pref(k, `v${n}`), "init-value": pref(k, `i${n}`) },
          { type: "TextInput", name: `s${n}`, label: SIZE_LABEL, "input-type": "text", required: false, "helper-text": SIZE_HINT, visible: pref(k, `v${n}`), "init-value": pref(k, `is${n}`) },
          { type: "TextInput", name: `o${n}`, label: ORIGIN_LABEL, "input-type": "text", required: false, "helper-text": ORIGIN_HINT, visible: pref(k, `v${n}`), "init-value": pref(k, `io${n}`) },
        ]),
        last ? priceSubmitFooter(k) : { type: "If", condition: pref(k, `m${k}`), then: [priceNextFooter(k)], else: [priceSubmitFooter(k)] },
      ],
    },
  };
}
export const priceRoutingModel = () => Object.fromEntries(PRICE_PAGES.map((id, i) => [id, PRICE_PAGES[i + 1] ? [PRICE_PAGES[i + 1]] : []]));
export const buildPriceFlowJson = () => ({ version: FLOW_JSON_VERSION, routing_model: priceRoutingModel(), screens: pricePages().map(({ k }) => pricePage(k)) });

// ================================================================ utak_price_extra_v1

export const EXTRA_FLOW_NAME = "utak_price_extra_v1";
export const EXTRA_SCREEN = "EXTRA";
export const EXTRA_SCREEN_TITLE = "صنف إضافي";
export const EXTRA_ROWS = 5;
export const EXTRA_CTA = "➕ صنف إضافي";
export const EXTRA_SUBMIT_LABEL = "إرسال";
/** A row's five fields: [key, label, hint, input type]. The label is followed by the row's number. */
export const EXTRA_FIELDS = [
  ["xn", "الصنف", "اسم الصنف كما في السوق", "text"],
  ["xp", "سعر الصنف", "بالريال", "number"],
  ["xk", "تعبئة الصنف", "كرتون 10 كجم، كيلو، ربطة", "text"],
  ["xs", "مقاس الصنف", SIZE_HINT, "text"],
  ["xo", "منشأ الصنف", ORIGIN_HINT, "text"],
];
export const extraDataModel = () => ({
  t: { type: "string", __example__: "أصناف إضافية — أسعار السوق" },
  note: { type: "string", __example__: "اكتب السعر زي ما ينباع في السوق (شامل الضريبة). حتى خمسة أصناف مو في القائمة." },
});
export const extraSubmitPayload = () => Object.fromEntries(Array.from({ length: EXTRA_ROWS }, (_, i) => i + 1).flatMap((r) => EXTRA_FIELDS.map(([k]) => [`${k}${r}`, `\${form.${k}${r}}`])));
export const buildExtraFlowJson = () => ({
  version: FLOW_JSON_VERSION,
  screens: [{
    id: EXTRA_SCREEN, title: EXTRA_SCREEN_TITLE, terminal: true, success: true, data: extraDataModel(),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: "${data.t}" },
        { type: "TextBody", text: "${data.note}" },
        ...Array.from({ length: EXTRA_ROWS }, (_, i) => i + 1).flatMap((r) => EXTRA_FIELDS.map(([k, label, hint, type]) => ({ type: "TextInput", name: `${k}${r}`, label: `${label} ${r}`, "input-type": type, required: false, "helper-text": hint }))),
        { type: "Footer", label: EXTRA_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: extraSubmitPayload() } },
      ],
    },
  }],
});

// ================================================================ utak_supplier_signup_v1

export const SIGNUP_FLOW_NAME = "utak_supplier_signup_v1";
export const SIGNUP_SCREEN = "SIGNUP";
export const TYPE_SCREEN = "TYPE";
export const SIGNUP_SCREEN_TITLE = "تسجيل مورد";
export const TYPE_SCREEN_TITLE = "تفاصيل نشاطك";
export const SIGNUP_CTA = "سجّل كمورد";
export const SIGNUP_NEXT_LABEL = "التالي";
export const SIGNUP_SUBMIT_LABEL = "إرسال";
/** The types a supplier chooses from (the keys of x_supplier_type; «مورد مصاريف» is Baraa's alone). */
export const SIGNUP_TYPES = [
  { id: "farmer", title: "مزارع" }, { id: "importer", title: "مستورد" }, { id: "market_agent", title: "وكيل سوق مركزي" },
  { id: "wholesaler", title: "تاجر جملة" }, { id: "distributor", title: "موزّع متخصص" }, { id: "other", title: "أخرى" },
];
export const SIGNUP_CATEGORIES = [
  { id: "fruit", title: "فواكه" }, { id: "veg", title: "خضار" }, { id: "leaf", title: "ورقيات" },
  { id: "dates", title: "تمور" }, { id: "mushroom", title: "فطر" }, { id: "herbs", title: "أعشاب" },
];
export const SIGNUP_METHODS = [{ id: "delivers", title: "أوصّل بنفسي" }, { id: "pickup", title: "تستلمون من عندي" }, { id: "market", title: "في السوق" }];
export const SIGNUP_PAY = [{ id: "cash", title: "نقد عند الاستلام" }, { id: "daily_transfer", title: "تحويل يومي" }, { id: "credit", title: "آجل" }];
export const SIGNUP_MONTHS = [["01", "يناير"], ["02", "فبراير"], ["03", "مارس"], ["04", "أبريل"], ["05", "مايو"], ["06", "يونيو"], ["07", "يوليو"], ["08", "أغسطس"], ["09", "سبتمبر"], ["10", "أكتوبر"], ["11", "نوفمبر"], ["12", "ديسمبر"]].map(([id, title]) => ({ id, title }));
/** The general screen's answers, in its order: what «التالي» passes to TYPE and «إرسال» returns. */
export const SIGNUP_GENERAL = ["trade", "contact", "stype", "location", "cats", "items", "origin", "method", "pay", "pay_days"];
export const FARMER_CROPS = 3;
/** What each type is asked: the block's fields, [name, component, label, hint, more]. */
export const TYPE_BLOCKS = {
  farmer: {
    condition: "${data.stype} == 'farmer'",
    fields: [
      ...Array.from({ length: FARMER_CROPS }, (_, i) => i + 1).flatMap((r) => [
        [`f_c${r}`, "TextInput", `المحصول ${r}`, r === 1 ? "مثل: طماطم" : "اختياري"],
        [`f_a${r}`, "Dropdown", `موسمه من شهر (${r})`, ""],
        [`f_b${r}`, "Dropdown", `إلى شهر (${r})`, ""],
      ]),
      ["f_qty", "TextInput", "الكمية المتوقعة", "مثل: 200 كرتون في الأسبوع"],
    ],
  },
  importer: {
    condition: "${data.stype} == 'importer'",
    fields: [["i_countries", "TextInput", "بلدان الاستيراد", "مثل: مصر، جنوب أفريقيا"], ["i_ship", "TextInput", "مواعيد الشحن", "مثل: شحنة كل أسبوعين"], ["i_min", "TextInput", "أقل كمية", "مثل: 50 كرتون"]],
  },
  // Meta's parser takes no «||» beside «==»: the agent and the wholesaler are asked the same two things in two blocks
  agent: {
    condition: "${data.stype} == 'market_agent'",
    fields: [["a_shop", "TextInput", "رقم المحل أو البسطة", "في السوق المركزي"], ["a_daily", "TextArea", "أصنافك اليومية", "ما يتوفر عندك كل يوم"]],
  },
  wholesaler: {
    condition: "${data.stype} == 'wholesaler'",
    fields: [["w_shop", "TextInput", "المحل أو المستودع", "رقمه وأين هو"], ["w_daily", "TextArea", "أصنافك اليومية", "ما يتوفر عندك كل يوم"]],
  },
  distributor: {
    condition: "${data.stype} == 'distributor'",
    fields: [["d_items", "TextArea", "أصنافك المتخصصة", "ما تتخصص فيه"], ["d_min", "TextInput", "أقل كمية", "مثل: 10 كراتين"], ["d_lead", "TextInput", "مدة التجهيز", "مثل: يوم واحد"]],
  },
  other: {
    condition: "${data.stype} == 'other'",
    fields: [["o_note", "TextArea", "نبذة عن نشاطك", "ماذا توفر وكيف"]],
  },
};
export const TYPE_FIELDS = Object.values(TYPE_BLOCKS).flatMap((b) => b.fields.map((f) => f[0]));

export const signupDataModel = () => ({
  t: { type: "string", __example__: "تسجيل مورد لدى يو تاك" },
  how: { type: "string", __example__: "عبّ بيانات نشاطك، ثم «التالي» لتفاصيل نوعك، ثم «إرسال». نراجع ونتواصل معك." },
  i_trade: { type: "string", __example__: "" },
  i_contact: { type: "string", __example__: "" },
  i_location: { type: "string", __example__: "" },
});
export const typeDataModel = () => ({
  ...Object.fromEntries(SIGNUP_GENERAL.filter((k) => k !== "cats").map((k) => [k, { type: "string", __example__: k === "stype" ? "farmer" : "" }])),
  cats: { type: "array", items: { type: "string" }, __example__: [] },
});
const typeField = ([name, component, label, hint]) => (component === "Dropdown"
  ? { type: "Dropdown", name, label, required: false, "data-source": SIGNUP_MONTHS }
  : { type: component, name, label, ...(component === "TextInput" ? { "input-type": "text" } : {}), required: false, ...(hint ? { "helper-text": hint } : {}) });
export const signupSubmitPayload = () => ({
  ...Object.fromEntries(SIGNUP_GENERAL.map((k) => [k, `\${data.${k}}`])),
  ...Object.fromEntries(TYPE_FIELDS.map((k) => [k, `\${form.${k}}`])),
});
export const buildSignupFlowJson = () => ({
  version: FLOW_JSON_VERSION,
  routing_model: { [SIGNUP_SCREEN]: [TYPE_SCREEN], [TYPE_SCREEN]: [] },
  screens: [
    {
      id: SIGNUP_SCREEN, title: SIGNUP_SCREEN_TITLE, data: signupDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.t}" },
          { type: "TextBody", text: "${data.how}" },
          { type: "TextInput", name: "trade", label: "الاسم التجاري", "input-type": "text", required: true, "init-value": "${data.i_trade}" },
          { type: "TextInput", name: "contact", label: "اسم المسؤول", "input-type": "text", required: true, "init-value": "${data.i_contact}" },
          { type: "Dropdown", name: "stype", label: "نوع النشاط", required: true, "data-source": SIGNUP_TYPES },
          { type: "TextInput", name: "location", label: "الموقع", "input-type": "text", required: true, "helper-text": "السوق ورقم المحل، أو المزرعة والمدينة", "init-value": "${data.i_location}" },
          { type: "CheckboxGroup", name: "cats", label: "الفئات", required: false, "data-source": SIGNUP_CATEGORIES },
          { type: "TextArea", name: "items", label: "الأصناف", required: true, "helper-text": "اكتب أصنافك وبينها فاصلة: طماطم، خيار، موز" },
          { type: "TextInput", name: "origin", label: "المنشأ", "input-type": "text", required: false, "helper-text": "البلد أو المنطقة" },
          { type: "Dropdown", name: "method", label: "طريقة التوريد", required: true, "data-source": SIGNUP_METHODS },
          { type: "Dropdown", name: "pay", label: "شروط الدفع", required: true, "data-source": SIGNUP_PAY },
          // a text field: an empty number field does not pass to TYPE's string data (Meta checks the navigate payload's types)
          { type: "TextInput", name: "pay_days", label: "أيام الآجل", "input-type": "text", required: false, "helper-text": "لو الدفع آجل: كم يوم (بالأرقام)" },
          { type: "Footer", label: SIGNUP_NEXT_LABEL, "on-click-action": { name: "navigate", next: { type: "screen", name: TYPE_SCREEN }, payload: Object.fromEntries(SIGNUP_GENERAL.map((k) => [k, `\${form.${k}}`])) } },
        ],
      },
    },
    {
      id: TYPE_SCREEN, title: TYPE_SCREEN_TITLE, terminal: true, success: true, data: typeDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "تفاصيل نشاطك" },
          { type: "TextBody", text: "كل الخانات هنا اختيارية: عبّ ما تعرفه ثم «إرسال»." },
          ...Object.values(TYPE_BLOCKS).map((b) => ({ type: "If", condition: b.condition, then: b.fields.map(typeField) })),
          { type: "Footer", label: SIGNUP_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: signupSubmitPayload() } },
        ],
      },
    },
  ],
});

// ================================================================ utak_supplier_offer_v1

export const OFFER_FLOW_NAME = "utak_supplier_offer_v1";
export const OFFER_SCREEN = "OFFER";
export const OFFER_SCREEN_TITLE = "عرض مورد";
export const OFFER_CTA = "عرض مورد";
export const OFFER_SUBMIT_LABEL = "إرسال";
export const OFFER_OTHER_ID = "other";
export const OFFER_OTHER_TITLE = "صنف آخر (اكتبه تحت)";
/** Meta allows a Dropdown two hundred options: his items, and «صنف آخر». */
export const OFFER_ITEMS_MAX = 199;
export const OFFER_FIELDS = ["item", "other", "qty", "price", "pack", "size", "origin", "from", "until", "note"];
const OPTION_ITEMS = { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } };
export const offerDataModel = () => ({
  t: { type: "string", __example__: "📦 بضاعتي جاهزة" },
  how: { type: "string", __example__: "اكتب ما عندك جاهز الآن: الصنف والكمية والسعر، ثم «إرسال»." },
  items: { type: "array", items: OPTION_ITEMS, __example__: [{ id: OFFER_OTHER_ID, title: OFFER_OTHER_TITLE }] },
  d: { type: "string", __example__: "2026-10-08" },
});
export const offerSubmitPayload = () => Object.fromEntries(OFFER_FIELDS.map((k) => [k, `\${form.${k}}`]));
export const buildOfferFlowJson = () => ({
  version: FLOW_JSON_VERSION,
  screens: [{
    id: OFFER_SCREEN, title: OFFER_SCREEN_TITLE, terminal: true, success: true, data: offerDataModel(),
    layout: {
      type: "SingleColumnLayout",
      children: [
        { type: "TextHeading", text: "${data.t}" },
        { type: "TextBody", text: "${data.how}" },
        { type: "Dropdown", name: "item", label: "الصنف", required: true, "data-source": "${data.items}" },
        { type: "TextInput", name: "other", label: "صنف آخر", "input-type": "text", required: false, "helper-text": "اكتبه لو اخترت «صنف آخر»" },
        { type: "TextInput", name: "qty", label: "الكمية المتاحة", "input-type": "number", required: true, "helper-text": "عدد الكراتين أو الوحدات" },
        { type: "TextInput", name: "price", label: "السعر", "input-type": "number", required: true, "helper-text": "للتعبئة المكتوبة تحت، بدون ضريبة" },
        { type: "TextInput", name: "pack", label: "التعبئة", "input-type": "text", required: true, "helper-text": "كرتون 10 كجم، كيلو، ربطة" },
        { type: "TextInput", name: "size", label: SIZE_LABEL, "input-type": "text", required: false, "helper-text": SIZE_HINT },
        { type: "TextInput", name: "origin", label: ORIGIN_LABEL, "input-type": "text", required: false, "helper-text": ORIGIN_HINT },
        { type: "DatePicker", name: "from", label: "جاهز من", required: false, "init-value": "${data.d}", "min-date": "${data.d}" },
        { type: "DatePicker", name: "until", label: "جاهز حتى", required: false, "min-date": "${data.d}" },
        { type: "TextArea", name: "note", label: "ملاحظة", required: false },
        { type: "Footer", label: OFFER_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: offerSubmitPayload() } },
      ],
    },
  }],
});

/** The Flows of § 65, as the Meta script walks them. */
export const FLOWS = [
  { key: "price", name: PRICE_FLOW_NAME, build: buildPriceFlowJson, first: PRICE_FIRST_SCREEN },
  { key: "extra", name: EXTRA_FLOW_NAME, build: buildExtraFlowJson, first: EXTRA_SCREEN },
  { key: "signup", name: SIGNUP_FLOW_NAME, build: buildSignupFlowJson, first: SIGNUP_SCREEN },
  { key: "offer", name: OFFER_FLOW_NAME, build: buildOfferFlowJson, first: OFFER_SCREEN },
];

// ================================================================ the two templates

// ONE submission each, UTILITY, no greeting and no emoji. Filed MARKETING, refused or pending → never
// used and never re-submitted: «📨 أرسل رابط التسجيل» shows Baraa the invitation's text to send himself,
// and a periodic check-in outside the window waits for the supplier's next message.
export const INVITE_BUTTON = "تسجيل مورد";
export const CHECKIN_BUTTON = "عرض مورد";
export const SUPPLIER_INVITE = {
  name: "utak_supplier_invite_v1",
  purpose: "supplier_invite",
  purposeLabel: "رابط تسجيل مورد (للموردين)",
  label: "رابط تسجيل مورد — بزر «تسجيل مورد» (للموردين)",
  language: "ar",
  body: "بخصوص تسجيلكم كمورد لدى يو تاك: لإكمال التسجيل اضغط «تسجيل مورد» وأدخل بيانات النشاط والأصناف وطريقة التوريد. بعد المراجعة يصلكم تأكيد الاعتماد في هذه المحادثة.",
  example: [],
  params: 0,
  buttons: [{ type: "QUICK_REPLY", text: INVITE_BUTTON }],
  documentHeader: false,
};
export const SUPPLIER_CHECKIN = {
  name: "utak_supplier_checkin_v1",
  purpose: "supplier_checkin",
  purposeLabel: "تواصل دوري مع مورد معتمد (للموردين)",
  label: "تواصل دوري مع مورد معتمد — بزر «عرض مورد» (للموردين)",
  language: "ar",
  body: "تحديث دوري للمورد المعتمد {{1}} لدى يو تاك: لتسجيل ما عندك من بضاعة جاهزة أو شحنة جديدة اضغط «عرض مورد» وأدخل الصنف والكمية والسعر.",
  example: ["مزرعة الخير"],
  params: 1,
  buttons: [{ type: "QUICK_REPLY", text: CHECKIN_BUTTON }],
  documentHeader: false,
};
export const S65_TEMPLATES = [SUPPLIER_INVITE, SUPPLIER_CHECKIN];
