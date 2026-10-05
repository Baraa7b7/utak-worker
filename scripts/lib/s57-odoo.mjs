// § 57 هـ + ز (2026-10-05) — what the complaint form and the supplier's registration put in Odoo, as
// data: one source for scripts/s57-20261005-odoo.mjs (which writes it to the tenant) and the tests of
// src/complaint-form.ts and src/supplier-vat.ts (which read the pieces against what the worker writes).
//
//   • x_complaint (the complaints' own model, «UTAK ← 👥 العملاء ← الشكاوى»): what the form
//     utak_complaint_v1 asks and what Baraa decides —
//       x_kind            «نوع الملاحظة»      damaged «تالف» / short «ناقص» / quality «جودة» / delay «تأخير» / other «أخرى»
//                                              (x_type, the older classification, is still written: KIND_TO_TYPE)
//       x_order_line_id   «سطر الطلب»         the line of the order the note is about
//       x_product_tmpl_id «الصنف»             its item
//       x_affected_qty    «الكمية المتأثرة»
//       x_photo           «الصورة»            the customer's picture (required for «تالف» and «جودة»)
//       x_decision        «قرار براء»         compensate_next «تعويض بالطلب القادم» / credit_note «إشعار دائن» / rejected «رفض»
//       x_decided_at      «وقت القرار»
//     The compensation itself and the credit note stay manual (STATUS § 4 item 7): the decision is recorded, nothing is posted.
//   • res.partner: x_cr_number «السجل التجاري» — the supplier's registration form (utak_supplier_register_v1).
//     The tax number goes in vat with x_vat_registered / x_vat_status «registered», the official name in
//     x_legal_name, the IBAN in x_iban: fields the card already has.
//   • three extension views show them: the complaint's form and list, and the partner's form (after «VAT»).
// Nothing else: a transfer notice and an expense use models and fields Odoo already has.

export const COMPLAINT_MODEL = "x_complaint";
export const PARTNER_MODEL = "res.partner";

/** [value, label] — the values are the ones src/complaint-form.ts writes. */
export const KIND_OPTIONS = [["damaged", "تالف"], ["short", "ناقص"], ["quality", "جودة"], ["delay", "تأخير"], ["other", "أخرى"]];
export const DECISION_OPTIONS = [["compensate_next", "تعويض بالطلب القادم"], ["credit_note", "إشعار دائن"], ["rejected", "رفض"]];
/** The form's kind → the older x_type (quality / quantity / delay / staff_behavior / pricing / other). */
export const KIND_TO_TYPE = { damaged: "quality", short: "quantity", quality: "quality", delay: "delay", other: "other" };
const selection = (options) => `[${options.map(([v, l]) => `('${v}', '${l}')`).join(", ")}]`;

export const COMPLAINT_FIELDS = [
  { name: "x_kind", ttype: "selection", selection: selection(KIND_OPTIONS), field_description: "نوع الملاحظة",
    help: "ما اختاره العميل في نموذج «⚠️ عندي ملاحظة»: تالف، ناقص، جودة، تأخير، أو أخرى." },
  { name: "x_order_line_id", ttype: "many2one", relation: "x_daily_order_line", field_description: "سطر الطلب", on_delete: "set null",
    help: "سطر الطلب الذي عليه الملاحظة، كما اختاره العميل من أصناف طلبه." },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", field_description: "الصنف", on_delete: "set null",
    help: "الصنف الذي عليه الملاحظة." },
  { name: "x_affected_qty", ttype: "float", field_description: "الكمية المتأثرة",
    help: "كم كرتوناً (أو وحدة) من الصنف عليه الملاحظة، كما كتبه العميل." },
  { name: "x_photo", ttype: "binary", field_description: "الصورة",
    help: "صورة العميل مع الملاحظة (إلزامية للتالف والجودة)." },
  { name: "x_decision", ttype: "selection", selection: selection(DECISION_OPTIONS), field_description: "قرار براء",
    help: "ما قرره براء من واتساب: تعويض بالطلب القادم، أو إشعار دائن، أو رفض. التعويض والإشعار الدائن يُنفَّذان يدوياً." },
  { name: "x_decided_at", ttype: "datetime", field_description: "وقت القرار", help: "متى ضغط براء زر القرار." },
];
export const CR_FIELD = "x_cr_number";
export const PARTNER_FIELDS = [
  { name: CR_FIELD, ttype: "char", field_description: "السجل التجاري",
    help: "رقم السجل التجاري كما كتبه المورد في نموذج التسجيل (utak_supplier_register_v1)." },
];

// ---------------------------------------------------------------- the views
export const COMPLAINT_FORM_VIEW = "x_complaint.form";
export const COMPLAINT_LIST_VIEW = "x_complaint.list";
export const PARTNER_FORM_VIEW = "res.partner.form";
export const VIEWS = {
  complaintForm: {
    name: "x_complaint.form.utak_s57", model: COMPLAINT_MODEL, type: "form", parent: COMPLAINT_FORM_VIEW,
    arch: `<data>
  <xpath expr="//field[@name='x_order_id']" position="after">
    <field name="x_product_tmpl_id"/>
    <field name="x_order_line_id" invisible="not x_order_line_id"/>
    <field name="x_kind"/>
    <field name="x_affected_qty"/>
  </xpath>
  <xpath expr="//field[@name='x_resolved_at']" position="after">
    <field name="x_decision"/>
    <field name="x_decided_at" readonly="1"/>
  </xpath>
  <xpath expr="//notebook" position="inside">
    <page string="الصورة" invisible="not x_photo"><field name="x_photo" widget="image" nolabel="1"/></page>
  </xpath>
</data>`,
    shows: ["x_product_tmpl_id", "x_order_line_id", "x_kind", "x_affected_qty", "x_decision", "x_decided_at", "x_photo"],
  },
  complaintList: {
    name: "x_complaint.list.utak_s57", model: COMPLAINT_MODEL, type: "list", parent: COMPLAINT_LIST_VIEW,
    arch: `<data>
  <xpath expr="//field[@name='x_type']" position="after">
    <field name="x_kind" optional="show"/>
    <field name="x_product_tmpl_id" optional="show"/>
    <field name="x_affected_qty" optional="hide"/>
  </xpath>
  <xpath expr="//field[@name='x_status']" position="after">
    <field name="x_decision" optional="show"/>
  </xpath>
</data>`,
    shows: ["x_kind", "x_product_tmpl_id", "x_affected_qty", "x_decision"],
  },
  partnerForm: {
    name: "res.partner.form.utak_s57", model: PARTNER_MODEL, type: "form", parent: PARTNER_FORM_VIEW,
    arch: `<data>
  <xpath expr="//field[@name='vat']" position="after">
    <field name="${CR_FIELD}"/>
  </xpath>
</data>`,
    shows: [CR_FIELD],
  },
};
