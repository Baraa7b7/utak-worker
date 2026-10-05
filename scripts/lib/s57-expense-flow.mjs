// § 57 و (2026-10-05) — the owner's «تسجيل مصروف» form as a WhatsApp Flow, as data.
//
// Pure: no network, no worker import. The Meta script of § 57 sends it (FLOW below, the shape of
// scripts/lib/s55-flows.mjs FLOWS); tests/s57-expense.test.mts checks it against what the worker
// (src/expense-form.ts) sends and reads: the screen, the data keys, the ids, the payload.
//
// No endpoint: the worker passes ALL the data with the message to the screen (flow_action navigate),
// as every Flow of § 55 does, and a published Flow's JSON is frozen — a change of its shape is a new Flow.
//
// ---- utak_expense_v1 ----
// ONE screen (EXPENSE_A), twelve components (Meta allows fifty), filled by Baraa alone:
//   • the heading and a line of text (from the data);
//   • «نوع المصروف» (type, a list, required): the eight types — the worker maps each id to its expense
//     account (docs/ODOO-IDS.md);
//   • «المبلغ كما دُفع» (amt, a number, required);
//   • «فاتورة ضريبية؟» (tax: yes / no, required, nothing chosen for him);
//   • «رقم المورد الضريبي» (vat, optional and ALWAYS visible: a Flow without an endpoint cannot show a
//     field by another one's answer and still send it — its hint says it is read with «نعم» only, as
//     «السعر اليدوي» of utak_owner_review_v2);
//   • «اسم المورد» (sup, required);
//   • «طريقة الدفع» (pay, required): its choices come WITH THE MESSAGE (data.pay), so the worker leaves
//     «من جيب براء» out when the partner's current-account journal is not in Odoo;
//   • «تاريخ المصروف» (date, a DatePicker): opened on today (data.d), and no later day can be picked
//     (max-date = data.d). Flow JSON 5.0+ carries a DatePicker's dates as «YYYY-MM-DD» strings;
//   • ONE PhotoPicker `photo` (0–1 photo: the invoice or the receipt);
//   • «ملاحظة» (note, optional) and «إرسال».
//   t     the heading: «تسجيل مصروف — <the day>»          n   the line under it
//   pay   [{ id, title }] the ways of paying offered       d   today, «YYYY-MM-DD»
// The reply carries type, amt, tax, vat, sup, pay, date, photo, note and the flow_token.
// PhotoPicker, Meta's rules (scripts/lib/s55-flows.mjs has them in full): one a screen, its value a
// TOP-LEVEL string property of the `complete` payload, never inside If / Switch, no `required`
// (min-uploaded-photos 0 = optional), max-uploaded-photos stated, never pre-filled.

import { FLOW_JSON_VERSION, FLOW_SUBMIT_LABEL, SCREEN_COMPONENTS_MAX, screenComponents } from "./s55-flows.mjs";

export { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents };

export const EXPENSE_FLOW_NAME = "utak_expense_v1";
export const EXPENSE_SCREEN = "EXPENSE_A";
export const EXPENSE_SCREEN_TITLE = "تسجيل مصروف";
export const EXPENSE_CTA = "سجّل المصروف";
export const EXPENSE_SUBMIT_LABEL = FLOW_SUBMIT_LABEL;

export const EXPENSE_TYPE_LABEL = "نوع المصروف";
/** The eight types of the order, in its order: the id is what the worker reads. */
export const EXPENSE_TYPES = [
  { id: "fuel", title: "وقود" },
  { id: "car_maintenance", title: "صيانة السيارة" },
  { id: "rent", title: "إيجار" },
  { id: "salaries", title: "رواتب وأجور" },
  { id: "utilities", title: "كهرباء ومياه واتصالات" },
  { id: "gov", title: "رسوم حكومية" },
  { id: "packaging", title: "مواد تغليف" },
  { id: "other", title: "أخرى" },
];
export const EXPENSE_AMOUNT_LABEL = "المبلغ كما دُفع";
export const EXPENSE_AMOUNT_HINT = "بالريال، كما في الفاتورة أو الإيصال (شامل الضريبة إن وُجدت)";
export const EXPENSE_TAX_LABEL = "فاتورة ضريبية؟";
export const EXPENSE_TAX_OPTIONS = [
  { id: "yes", title: "نعم" },
  { id: "no", title: "لا" },
];
export const EXPENSE_VAT_LABEL = "رقم المورد الضريبي";
export const EXPENSE_VAT_HINT = "15 رقماً يبدأ بـ 3 وينتهي بـ 3 — يُقرأ مع «نعم» فقط";
export const EXPENSE_SUPPLIER_LABEL = "اسم المورد";
export const EXPENSE_SUPPLIER_HINT = "كما في الفاتورة، أو «مصروفات نقدية متنوعة»";
export const EXPENSE_PAY_LABEL = "طريقة الدفع";
/** Every way of paying the worker may offer (the message carries the ones on offer): the id is what it reads. */
export const EXPENSE_PAY_OPTIONS = [
  { id: "cash", title: "كاش السائق (CSHD)" },
  { id: "bank", title: "البنك (BNK1)" },
  { id: "owner", title: "من جيب براء" },
];
export const EXPENSE_DATE_LABEL = "تاريخ المصروف";
export const EXPENSE_DATE_HINT = "اليوم افتراضياً — لا يُقبل تاريخ بعد اليوم";
export const EXPENSE_PHOTO_NAME = "photo";
export const EXPENSE_PHOTO_LABEL = "صورة الفاتورة أو الإيصال";
export const EXPENSE_PHOTO_HINT = "لازمة مع «فاتورة ضريبية: نعم»، واختيارية مع «لا». تُرفق بالفاتورة في Odoo.";
/** The photos one reply may carry, and the largest the picker takes, in KiB (as utak_receipt_v1). */
export const EXPENSE_PHOTO_MAX = 1;
export const EXPENSE_PHOTO_MAX_KB = 10240;
export const EXPENSE_NOTE_LABEL = "ملاحظة";
export const EXPENSE_NOTE_HINT = "اختياري — تُكتب في وصف الفاتورة";
/** The fields of the reply, in the screen's order. */
export const EXPENSE_FIELDS = ["type", "amt", "tax", "vat", "sup", "pay", "date", EXPENSE_PHOTO_NAME, "note"];

const OPTION_ITEMS = { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } };

/** The screen's data model: every key the worker sends, with Meta's mandatory example. */
export function expenseDataModel() {
  return {
    t: { type: "string", __example__: "تسجيل مصروف — الاثنين 5 أكتوبر 2026" },
    n: { type: "string", __example__: "اكتب المبلغ كما دفعته. ضريبة المدخلات تُفصل مع «نعم» ورقم ضريبي صحيح وصورة الفاتورة فقط." },
    pay: { type: "array", items: OPTION_ITEMS, __example__: EXPENSE_PAY_OPTIONS },
    d: { type: "string", __example__: "2026-10-05" },
  };
}
export function expensePhotoPicker() {
  return {
    type: "PhotoPicker", name: EXPENSE_PHOTO_NAME, label: EXPENSE_PHOTO_LABEL, description: EXPENSE_PHOTO_HINT,
    "min-uploaded-photos": 0, "max-uploaded-photos": EXPENSE_PHOTO_MAX, "max-file-size-kb": EXPENSE_PHOTO_MAX_KB,
  };
}
/** «إرسال»: every field — the photo a top-level property, as Meta requires. */
export const expenseSubmitPayload = () => Object.fromEntries(EXPENSE_FIELDS.map((k) => [k, `\${form.${k}}`]));

export function buildExpenseFlowJson() {
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: EXPENSE_SCREEN,
      title: EXPENSE_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: expenseDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.t}" },
          { type: "TextBody", text: "${data.n}" },
          // required, and no init-value: the type is his own answer
          { type: "Dropdown", name: "type", label: EXPENSE_TYPE_LABEL, required: true, "data-source": EXPENSE_TYPES },
          { type: "TextInput", name: "amt", label: EXPENSE_AMOUNT_LABEL, "input-type": "number", required: true, "helper-text": EXPENSE_AMOUNT_HINT },
          { type: "RadioButtonsGroup", name: "tax", label: EXPENSE_TAX_LABEL, required: true, "data-source": EXPENSE_TAX_OPTIONS },
          { type: "TextInput", name: "vat", label: EXPENSE_VAT_LABEL, "input-type": "number", required: false, "helper-text": EXPENSE_VAT_HINT },
          { type: "TextInput", name: "sup", label: EXPENSE_SUPPLIER_LABEL, "input-type": "text", required: true, "helper-text": EXPENSE_SUPPLIER_HINT },
          // the choices come with the message: «من جيب براء» only while its journal is in Odoo
          { type: "RadioButtonsGroup", name: "pay", label: EXPENSE_PAY_LABEL, required: true, "data-source": "${data.pay}" },
          { type: "DatePicker", name: "date", label: EXPENSE_DATE_LABEL, required: false, "init-value": "${data.d}", "max-date": "${data.d}", "helper-text": EXPENSE_DATE_HINT },
          expensePhotoPicker(),
          { type: "TextArea", name: "note", label: EXPENSE_NOTE_LABEL, required: false, "helper-text": EXPENSE_NOTE_HINT },
          { type: "Footer", label: EXPENSE_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: expenseSubmitPayload() } },
        ],
      },
    }],
  };
}

/** The Flow of § 57 و, as the Meta script walks it (the shape of scripts/lib/s55-flows.mjs FLOWS). */
export const FLOW = { key: "expense", name: EXPENSE_FLOW_NAME, build: buildExpenseFlowJson, first: EXPENSE_SCREEN };
