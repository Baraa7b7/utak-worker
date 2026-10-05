// § 57 ز (2026-10-05) — the WhatsApp Flow of the supplier's registration, as data.
//
// Pure: no network, no worker import. The Meta script of § 57 sends it; tests/s57-supplier-vat.test.mts
// checks it against what the worker builds and reads (src/supplier-vat.ts): the screen, the data keys,
// the payload, and Meta's limit on every text.
//
// ---- utak_supplier_register_v1 ----
// A supplier whose invoice reached us and whose tax number could not be read from it — and whose card
// has none — is asked ONCE for what a tax invoice of his needs. ONE screen (SUPPLIER_REGISTER), no
// endpoint: everything it shows goes with the message (flow_action navigate), as the Flows of § 55 do,
// and a published Flow's JSON is frozen. Eight components (Meta allows fifty):
//   • the heading and one line of text (from the data)
//   • «الاسم الرسمي» (legal, required): the establishment's name as in its commercial registration
//   • «السجل التجاري» (cr, a number, required): ten digits — the worker refuses anything else
//   • «الرقم الضريبي» (vat, a number, required): fifteen digits, the first and the last «3» — checked
//     by the worker, by the same rule as a number read from an invoice
//   • «صورة شهادة الضريبة» (photo): ONE PhotoPicker, REQUIRED by the Flow itself (min-uploaded-photos 1;
//     a PhotoPicker takes no `required`) and by the worker. Meta's rules for a PhotoPicker are in
//     scripts/lib/s55-flows.mjs (one a screen, a top-level property of the `complete` payload, never
//     pre-filled, max-uploaded-photos stated)
//   • «الآيبان (اختياري)» (iban, optional): checked by the worker as § 52's (SA, 24 characters, mod 97);
//     one that is not valid is not kept, and never refuses the form
//   • «إرسال»
// The data:
//   t        the heading: «تسجيل بيانات المورد — <the supplier>»      how   the line under it
//   i_legal  i_cr  i_vat  i_iban   what each field opens with (his card's name; what he typed on a
//                                  form that was refused)
// The reply carries legal, cr, vat, photo, iban and the flow_token.

import { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents } from "./s55-flows.mjs";

export { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents };

export const SUPPLIER_FLOW_NAME = "utak_supplier_register_v1";
export const SUPPLIER_SCREEN = "SUPPLIER_REGISTER";
export const SUPPLIER_SCREEN_TITLE = "تسجيل المورد";
export const SUPPLIER_CTA = "سجّل بياناتك";
export const SUPPLIER_SUBMIT_LABEL = "إرسال";
export const SUPPLIER_LEGAL_LABEL = "الاسم الرسمي";
export const SUPPLIER_LEGAL_HINT = "اسم المنشأة كما في السجل التجاري";
export const SUPPLIER_CR_LABEL = "السجل التجاري";
export const SUPPLIER_CR_HINT = "10 أرقام";
export const SUPPLIER_VAT_LABEL = "الرقم الضريبي";
export const SUPPLIER_VAT_HINT = "15 رقماً يبدأ وينتهي بـ 3";
export const SUPPLIER_PHOTO_NAME = "photo";
export const SUPPLIER_PHOTO_LABEL = "صورة شهادة الضريبة";
export const SUPPLIER_PHOTO_HINT = "صوّر شهادة التسجيل في ضريبة القيمة المضافة، أو اخترها من الصور.";
/** Exactly one photo, and the largest one in KiB (as the receipt form of § 55). */
export const SUPPLIER_PHOTO_MIN = 1;
export const SUPPLIER_PHOTO_MAX = 1;
export const SUPPLIER_PHOTO_MAX_KB = 10240;
export const SUPPLIER_IBAN_LABEL = "الآيبان (اختياري)";
export const SUPPLIER_IBAN_HINT = "SA ثم 22 رقماً، لتحويل مستحقاتك";
/** Meta's limits on the texts of this screen (characters), by where the text stands. */
export const SUPPLIER_LIMITS = {
  screenTitle: 30, heading: 80, body: 4096, footer: 35,
  inputLabel: 20, inputHint: 80, photoLabel: 80, photoDescription: 300, cta: 20,
};
/** The text fields, in the form's order: [name, label, hint, input type, required]. */
export const SUPPLIER_INPUTS = [
  ["legal", SUPPLIER_LEGAL_LABEL, SUPPLIER_LEGAL_HINT, "text", true],
  ["cr", SUPPLIER_CR_LABEL, SUPPLIER_CR_HINT, "number", true],
  ["vat", SUPPLIER_VAT_LABEL, SUPPLIER_VAT_HINT, "number", true],
  ["iban", SUPPLIER_IBAN_LABEL, SUPPLIER_IBAN_HINT, "text", false],
];
/** The fields of the reply, in the form's order. */
export const SUPPLIER_FIELDS = ["legal", "cr", "vat", SUPPLIER_PHOTO_NAME, "iban"];

/** The screen's data model: every key the worker sends, with Meta's mandatory example. */
export function supplierDataModel() {
  return {
    t: { type: "string", __example__: "تسجيل بيانات المورد — أحمد حسان" },
    how: { type: "string", __example__: "عبّ بيانات منشأتك مرة واحدة، وأرفق صورة شهادة الضريبة، ثم «إرسال»." },
    i_legal: { type: "string", __example__: "مؤسسة أحمد حسان للخضار والفواكه" },
    i_cr: { type: "string", __example__: "" },
    i_vat: { type: "string", __example__: "" },
    i_iban: { type: "string", __example__: "" },
  };
}
const input = ([name, label, hint, type, required]) => ({
  type: "TextInput", name, label, "input-type": type, required, "helper-text": hint, "init-value": `\${data.i_${name}}`,
});
export function supplierPhotoPicker() {
  return {
    type: "PhotoPicker", name: SUPPLIER_PHOTO_NAME, label: SUPPLIER_PHOTO_LABEL, description: SUPPLIER_PHOTO_HINT,
    "min-uploaded-photos": SUPPLIER_PHOTO_MIN, "max-uploaded-photos": SUPPLIER_PHOTO_MAX, "max-file-size-kb": SUPPLIER_PHOTO_MAX_KB,
  };
}
/** «إرسال»: every field — the photo a top-level property, as Meta requires. */
export const supplierSubmitPayload = () => Object.fromEntries(SUPPLIER_FIELDS.map((k) => [k, `\${form.${k}}`]));

export function buildSupplierFlowJson() {
  const [legal, cr, vat, iban] = SUPPLIER_INPUTS.map(input);
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: SUPPLIER_SCREEN,
      title: SUPPLIER_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: supplierDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.t}" },
          { type: "TextBody", text: "${data.how}" },
          legal,
          cr,
          vat,
          supplierPhotoPicker(),
          iban,
          { type: "Footer", label: SUPPLIER_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: supplierSubmitPayload() } },
        ],
      },
    }],
  };
}

/** The Flow of § 57 ز, as the Meta script walks it. */
export const FLOW = { key: "supplier", name: SUPPLIER_FLOW_NAME, build: buildSupplierFlowJson, first: SUPPLIER_SCREEN };
