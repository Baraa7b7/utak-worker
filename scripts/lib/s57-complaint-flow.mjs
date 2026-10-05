// § 57 هـ (2026-10-05) — the WhatsApp Flow of the customer's «⚠️ عندي ملاحظة» (the complaint), as data.
//
// Pure: no network, no worker import. The Meta script of § 57 sends it; tests/s57-complaint.test.mts
// checks it against what the worker builds (src/complaint-form.ts): the screen, the data keys, the
// payload, and Meta's limit on every text.
//
// ---- utak_complaint_v1 ----
// The customer says what was wrong with an order delivered to him: which order and item, what kind of
// note, how much of it, a photo, a note. ONE screen (COMPLAINT_A), no endpoint — everything it shows
// goes with the message (flow_action navigate), as the Flows of § 55 do, and a published Flow's JSON is
// frozen. Eight components:
//   • the heading and one line of text
//   • «الطلب والصنف» (item): ONE required list. A Flow without an endpoint cannot make one list depend
//     on another, so the order and its item are a single Dropdown — the worker sends the options: for
//     every order delivered to HIM in the last seven days, the newest first, «#<order> · الطلب كله»
//     (id "<order>:0", a note that is not about one item) and then a line an item, in the order's own
//     line order (id "<order>:<line>"). At most sixty options. An option's title holds thirty
//     characters at Meta: «#<order> · <the item>», the item cut — the whole name, the delivery day and
//     the quantity are the option's description
//   • «نوع الملاحظة» (kind, required, nothing chosen for him): the five values of x_complaint.x_kind
//     (scripts/lib/s57-odoo.mjs KIND_OPTIONS) — a published Flow cannot be given a sixth
//   • «الكمية المتأثرة» (qty, a number, optional HERE: a delay has none — the worker asks it of «تالف»,
//     «ناقص» and «جودة» on an item)
//   • «صورة» (photo): ONE PhotoPicker, optional HERE for the same reason — the worker refuses «تالف»
//     and «جودة» without it. Meta's rules for a PhotoPicker are in scripts/lib/s55-flows.mjs (one a
//     screen, a top-level property of the `complete` payload, never pre-filled, max-uploaded-photos
//     stated)
//   • «ملاحظة» (note, optional) and «إرسال»
// Neither list carries an init-value: nothing is chosen for him, and a value that is no option's is
// not something Meta documents. A form sent again after a refusal opens the two texts on what he wrote.
// The data:
//   t      the heading: «عندي ملاحظة — <the customer>»          how    the line under it
//   items  the options [{ id: "<order>:<line or 0>", title, description }]
//   qty    the quantity it opens with      note   the note it opens with
// The reply carries item, kind, qty, photo, note and the flow_token.

import { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents } from "./s55-flows.mjs";
import { KIND_OPTIONS } from "./s57-odoo.mjs";

export { FLOW_JSON_VERSION, SCREEN_COMPONENTS_MAX, screenComponents };

export const COMPLAINT_FLOW_NAME = "utak_complaint_v1";
export const COMPLAINT_SCREEN = "COMPLAINT_A";
export const COMPLAINT_SCREEN_TITLE = "عندي ملاحظة";
export const COMPLAINT_CTA = "عندي ملاحظة";
export const COMPLAINT_SUBMIT_LABEL = "إرسال";
/** The options one form lists (Meta allows a Dropdown two hundred): the newest orders first. */
export const COMPLAINT_OPTIONS_MAX = 60;
export const COMPLAINT_ITEM_LABEL = "الطلب والصنف";
/** The second half of an option's id for a note on the order as a whole. */
export const COMPLAINT_WHOLE_ID = "0";
export const COMPLAINT_WHOLE_TITLE = "الطلب كله";
export const COMPLAINT_KIND_LABEL = "نوع الملاحظة";
/** The five kinds: the id is x_complaint.x_kind, the title its label in Odoo. */
export const COMPLAINT_KINDS = KIND_OPTIONS.map(([id, title]) => ({ id, title }));
export const COMPLAINT_QTY_LABEL = "الكمية المتأثرة";
export const COMPLAINT_QTY_HINT = "كم كرتوناً أو وحدة — للتالف والناقص والجودة";
export const COMPLAINT_PHOTO_NAME = "photo";
export const COMPLAINT_PHOTO_LABEL = "صورة";
export const COMPLAINT_PHOTO_HINT = "إلزامية للتالف والجودة: صوّر الصنف أو اختر صورته من الصور.";
/** The photos one reply may carry, and the largest one in KiB (as the receipt form of § 55). */
export const COMPLAINT_PHOTO_MAX = 1;
export const COMPLAINT_PHOTO_MAX_KB = 10240;
export const COMPLAINT_NOTE_LABEL = "ملاحظة";
export const COMPLAINT_NOTE_HINT = "اختياري: اكتب ما حصل";
/** Meta's limits on the texts of this screen (characters), by where the text stands. */
export const COMPLAINT_LIMITS = {
  screenTitle: 30, heading: 80, body: 4096, footer: 35,
  inputLabel: 20, inputHint: 80, groupLabel: 30, dropdownLabel: 20, optionTitle: 30, optionDescription: 300,
  photoLabel: 80, photoDescription: 300, cta: 20, dropdownOptions: 200,
};
/** The fields of the reply, in the form's order. */
export const COMPLAINT_FIELDS = ["item", "kind", "qty", COMPLAINT_PHOTO_NAME, "note"];

const OPTION = { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } };

/** The screen's data model: every key the worker sends, with Meta's mandatory example. */
export function complaintDataModel() {
  return {
    t: { type: "string", __example__: "عندي ملاحظة — مطعم الوادي" },
    how: { type: "string", __example__: "اختر الطلب والصنف ونوع الملاحظة، ثم «إرسال»." },
    items: { type: "array", items: OPTION, __example__: [
      { id: "812:0", title: "#812 · الطلب كله", description: "الطلب #812 — سُلّم 3 أكتوبر 2026 — عدد الأصناف 2 — لملاحظة ليست على صنف بعينه (مثل التأخير)" },
      { id: "812:4401", title: "#812 · طماطم", description: "طماطم (كرتون) — الطلب #812 — سُلّم 3 أكتوبر 2026 — الكمية 3" },
    ] },
    qty: { type: "string", __example__: "" },
    note: { type: "string", __example__: "" },
  };
}
export function complaintPhotoPicker() {
  return {
    type: "PhotoPicker", name: COMPLAINT_PHOTO_NAME, label: COMPLAINT_PHOTO_LABEL, description: COMPLAINT_PHOTO_HINT,
    "min-uploaded-photos": 0, "max-uploaded-photos": COMPLAINT_PHOTO_MAX, "max-file-size-kb": COMPLAINT_PHOTO_MAX_KB,
  };
}
/** «إرسال»: every field — the photo a top-level property, as Meta requires. */
export const complaintSubmitPayload = () => Object.fromEntries(COMPLAINT_FIELDS.map((k) => [k, `\${form.${k}}`]));

export function buildComplaintFlowJson() {
  return {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: COMPLAINT_SCREEN,
      title: COMPLAINT_SCREEN_TITLE,
      terminal: true,
      success: true,
      data: complaintDataModel(),
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.t}" },
          { type: "TextBody", text: "${data.how}" },
          // required, and no init-value: a note is always about an order of his, and none is chosen for him
          { type: "Dropdown", name: "item", label: COMPLAINT_ITEM_LABEL, required: true, "data-source": "${data.items}" },
          { type: "RadioButtonsGroup", name: "kind", label: COMPLAINT_KIND_LABEL, required: true, "data-source": COMPLAINT_KINDS },
          { type: "TextInput", name: "qty", label: COMPLAINT_QTY_LABEL, "input-type": "number", required: false, "helper-text": COMPLAINT_QTY_HINT, "init-value": "${data.qty}" },
          complaintPhotoPicker(),
          { type: "TextArea", name: "note", label: COMPLAINT_NOTE_LABEL, required: false, "helper-text": COMPLAINT_NOTE_HINT, "init-value": "${data.note}" },
          { type: "Footer", label: COMPLAINT_SUBMIT_LABEL, "on-click-action": { name: "complete", payload: complaintSubmitPayload() } },
        ],
      },
    }],
  };
}

/** The Flow of § 57 هـ, as the Meta script walks it. */
export const FLOW = { key: "complaint", name: COMPLAINT_FLOW_NAME, build: buildComplaintFlowJson, first: COMPLAINT_SCREEN };
