// § 53 (2026-10-04) — what § 53 puts in Odoo, as data: one source for scripts/s53-20261004-odoo.mjs
// (which writes it to the tenant) and tests/s53.test.mts (which reads the pieces).
//
//   ب  x_pricing_config.x_market_uplift_pct «زيادة على سعر السوق ٪» (0 on the active record), shown in
//      «💲 التسعير» ← «⚙️ الإعدادات» right after «نسبة السعر الشاذ»; and x_price_day_line.x_uplift_pct
//      «زيادة السوق ٪», written by the worker with every run (the uplift a line's sale price was made with).
//   د  res.partner.x_contact_name «اسم المسؤول» (the registration form's contact person — no field
//      held it), shown on the partner's card after the VAT number; and «محل عصير» among the
//      customer types (x_customer_type). The other answers of the form go to fields that exist:
//      name, x_customer_type, x_legal_name, vat, x_vat_status, x_delivery_neighborhood.
//   هـ x_whatsapp_template.x_purpose + «تذكير الدفع بالآيبان» (customer_pay_remind_iban), and the row of
//      utak_pay_remind_iban_v1 (scripts/lib/s53-templates.mjs).

export const UPLIFT_DEFAULT = 0;
export const UPLIFT_LABEL = "زيادة على سعر السوق ٪";
export const CFG_FIELDS = [
  { name: "x_market_uplift_pct", ttype: "float", field_description: UPLIFT_LABEL,
    help: "سعر البيع = سعر السوق × (1 + هذه النسبة ÷ 100)، مقرَّباً لأعلى لأقرب نصف ريال. مثال: السوق 30 والزيادة 3 ← 30.90 ← البيع 31. المقارنة بالسعر المربح المقترح والاستثناءات على السعر بعد الزيادة. 0 = البيع بسعر السوق كما هو." },
];
export const LINE_FIELDS = [
  { name: "x_uplift_pct", ttype: "float", field_description: "زيادة السوق ٪",
    help: "يكتبها الوركر مع كل حساب: «زيادة على سعر السوق ٪» التي حُسب بها سعر بيع هذا السطر (0 = سعر السوق كما هو). النشر يتحقق بها من سعر البيع." },
];
/** «⚙️ الإعدادات» (utak.pricing_settings_form, § 48): the uplift right after «نسبة السعر الشاذ». */
export const SETTINGS_VIEW = "utak.pricing_settings_form";
const UPLIFT_MARK = `<field name="x_market_uplift_pct"/>`;
const OUTLIER_48 = /<field name="x_outlier_ratio"\/>/;
export function settingsArch(arch) {
  if (arch.includes(UPLIFT_MARK)) return arch;
  if (!OUTLIER_48.test(arch)) throw new Error("⚙️ الإعدادات: «نسبة السعر الشاذ» was not found in the form — stop (the view was changed by hand?)");
  return arch.replace(OUTLIER_48, (m) => `${m}\n        ${UPLIFT_MARK}`);
}

// ---------------------------------------------------------------- د
export const PARTNER_FIELDS = [
  { name: "x_contact_name", ttype: "char", field_description: "اسم المسؤول",
    help: "§ 53: اسم المسؤول عن الطلبات في المحل، كما كتبه العميل في نموذج التسجيل على واتساب." },
];
export const CUSTOMER_TYPE_JUICE = { value: "juice", name: "محل عصير" };
export const PARTNER_VIEW = "res.partner.form.utak_contact_name";
/** The partner form § 44 extended (the VAT status beside the VAT number): the same parent. */
export const PARTNER_VIEW_SIBLING = "res.partner.form.utak_vat_status";
export const PARTNER_FORM = `<data>
  <xpath expr="//field[@name='vat']" position="before">
    <field name="x_contact_name"/>
  </xpath>
</data>`;
