// § 57 د (2026-10-05) — the WhatsApp Flow of the customer's bank-transfer notice, as data.
//
// Pure: no network, no worker import. The Meta script of § 57 sends it; tests/s57-transfer.test.mts
// checks it against what the worker builds (src/transfer-form.ts): the screen, the data keys, the
// payload, and Meta's limit on every text.
//
// ---- utak_transfer_v1 ----
// The customer says he transferred money: which of his open invoices, how much, when, the receipt.
// ONE screen (TRANSFER_A), no endpoint — everything it shows goes with the message (flow_action
// navigate), as the Flows of § 55 do, and a published Flow's JSON is frozen. Nine components:
//   • the heading and one line of text
//   • «الفواتير» (inv): a CheckboxGroup of HIS open invoices, the oldest first, at most twenty — the
//     worker sends the options. An option's title holds thirty characters at Meta, less than an
//     invoice's full number and its remaining amount, so the title is the number without its
//     «UTAK-INV-» and the remaining amount, and the full line is the option's description
//   • «المبلغ المحوّل» (amt, a number, required)
//   • «تاريخ التحويل» (date, a DatePicker: Flow JSON 5.0+ carries a date as "YYYY-MM-DD"), never after
//     today (max-date)
//   • «رقم المرجع» (ref, optional): opened on what was read from a receipt sent before the form
//   • «صورة الإيصال» (photo): ONE PhotoPicker, optional HERE because the receipt may have come as a
//     photo before the form — the worker refuses a notice that has no photo from either. Meta's rules
//     for a PhotoPicker are in scripts/lib/s55-flows.mjs (one a screen, a top-level property of the
//     `complete` payload, never pre-filled, max-uploaded-photos stated)
//   • «ملاحظة» (note, optional) and «إرسال»
// The data:
//   t      the heading: «إشعار تحويل — <the customer>»          how    the line under it
//   invs   the options [{ id: "<x_invoice id>", title, description }]
//   sel    the invoices it opens ticked (his only open invoice; what he ticked on a form sent again)
//   amt    the amount it opens with      d    the date it opens on      max   today
//   ref    the reference it opens with   note the note it opens with
// The reply carries inv (the ticked ids), amt, date, ref, photo, note and the flow_token.

import { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents } from "./s55-flows.mjs";

export { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents };

export const TRANSFER_FLOW_NAME = "utak_transfer_v1";
export const TRANSFER_SCREEN = "TRANSFER_A";
export const TRANSFER_SCREEN_TITLE = "إشعار تحويل";
export const TRANSFER_CTA = "إشعار تحويل";
export const TRANSFER_SUBMIT_LABEL = "إرسال";
/** Meta: a CheckboxGroup takes at most twenty options. */
export const TRANSFER_INVOICES_MAX = 20;
export const TRANSFER_INVOICES_LABEL = "الفواتير اللي حوّلت لها";
export const TRANSFER_AMOUNT_LABEL = "المبلغ المحوّل";
export const TRANSFER_AMOUNT_HINT = "بالريال، كما في الإيصال";
export const TRANSFER_DATE_LABEL = "تاريخ التحويل";
export const TRANSFER_REF_LABEL = "رقم المرجع";
export const TRANSFER_REF_HINT = "اختياري: رقم العملية كما في الإيصال";
export const TRANSFER_PHOTO_NAME = "photo";
export const TRANSFER_PHOTO_LABEL = "صورة الإيصال";
export const TRANSFER_PHOTO_HINT = "صوّر الإيصال أو اختره من الصور. لو أرسلته لنا صورة قبل النموذج ما تحتاج ترفعه مرة ثانية.";
/** The photos one reply may carry, and the largest one in KiB (as the receipt form of § 55). */
export const TRANSFER_PHOTO_MAX = 1;
export const TRANSFER_PHOTO_MAX_KB = 10240;
export const TRANSFER_NOTE_LABEL = "ملاحظة";
export const TRANSFER_NOTE_HINT = "اختياري";
/** Meta's limits on the texts of this screen (characters), by where the text stands. */
export const TRANSFER_LIMITS = {
  screenTitle: 30, heading: 80, body: 4096, footer: 35,
  inputLabel: 20, inputHint: 80, groupLabel: 30, optionTitle: 30, optionDescription: 300,
  dateLabel: 40, photoLabel: 80, photoDescription: 300, cta: 20,
};
/** The fields of the reply, in the form's order. */
export const TRANSFER_FIELDS = ["inv", "amt", "date", "ref", TRANSFER_PHOTO_NAME, "note"];

const OPTION = { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } };

/** The screen's data model: every key the worker sends, with Meta's mandatory example. */
export function transferDataModel() {
  return {
    t: { type: "string", __example__: "إشعار تحويل — مطعم الوادي" },
    how: { type: "string", __example__: "اختر الفواتير اللي حوّلت لها، واكتب المبلغ والتاريخ، وأرفق صورة الإيصال، ثم «إرسال»." },
    invs: { type: "array", items: OPTION, __example__: [{ id: "9001", title: "20261003-007 · 300 ر.س", description: "UTAK-INV-20261003-007 — 3 أكتوبر 2026 — الإجمالي 300 ر.س — المتبقي 300 ر.س" }] },
    sel: { type: "array", items: { type: "string" }, __example__: ["9001"] },
    amt: { type: "string", __example__: "300" },
    d: { type: "string", __example__: "2026-10-03" },
    max: { type: "string", __example__: "2026-10-03" },
    ref: { type: "string", __example__: "" },
    note: { type: "string", __example__: "" },
  };
}
export function transferPhotoPicker() {
  return {
    type: "PhotoPicker", name: TRANSFER_PHOTO_NAME, label: TRANSFER_PHOTO_LABEL, description: TRANSFER_PHOTO_HINT,
    "min-uploaded-photos": 0, "max-uploaded-photos": TRANSFER_PHOTO_MAX, "max-file-size-kb": TRANSFER_PHOTO_MAX_KB,
  };
}
/** «إرسال»: every field — the photo a top-level property, as Meta requires. */
export const transferSubmitPayload = () => Object.fromEntries(TRANSFER_FIELDS.map((k) => [k, `\${form.${k}}`]));

export function buildTransferFlowJson() {
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: TRANSFER_SCREEN,
      title: TRANSFER_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: transferDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.t}" },
          { type: "TextBody", text: "${data.how}" },
          // at least one invoice: a transfer is always for something he owes
          { type: "CheckboxGroup", name: "inv", label: TRANSFER_INVOICES_LABEL, required: true, "min-selected-items": 1, "data-source": "${data.invs}", "init-value": "${data.sel}" },
          { type: "TextInput", name: "amt", label: TRANSFER_AMOUNT_LABEL, "input-type": "number", required: true, "helper-text": TRANSFER_AMOUNT_HINT, "init-value": "${data.amt}" },
          { type: "DatePicker", name: "date", label: TRANSFER_DATE_LABEL, required: true, "max-date": "${data.max}", "init-value": "${data.d}" },
          { type: "TextInput", name: "ref", label: TRANSFER_REF_LABEL, "input-type": "text", required: false, "helper-text": TRANSFER_REF_HINT, "init-value": "${data.ref}" },
          transferPhotoPicker(),
          { type: "TextArea", name: "note", label: TRANSFER_NOTE_LABEL, required: false, "helper-text": TRANSFER_NOTE_HINT, "init-value": "${data.note}" },
          { type: "Footer", label: TRANSFER_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: transferSubmitPayload() } },
        ],
      },
    }],
  };
}

/** The Flow of § 57 د, as the Meta script walks it. */
export const FLOW = { key: "transfer", name: TRANSFER_FLOW_NAME, build: buildTransferFlowJson, first: TRANSFER_SCREEN };
