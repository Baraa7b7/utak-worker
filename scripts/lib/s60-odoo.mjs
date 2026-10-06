// § 60 ج (2026-10-06) — «طلبوا وما كان متوفر», as data: one source for scripts/s60-20261006-odoo.mjs
// (which writes it to the tenant) and tests/s60-unavailable.test.mts (which reads the pieces against
// what the worker writes — src/unavailable-log.ts).
//
// Every answer «هذا الصنف غير متوفر اليوم» (§ 59 ج) leaves ONE light row here: the day, the customer,
// the item as he wrote it, the catalog's item when one matched, the quantity when he gave one. Nothing
// alerts Baraa at once: the 21:30 summary names the day's items, and «🎯 الفرص والقادم» the week's.
//
// Everything else § 60 writes is already on the tenant since § 58 (scripts/lib/s58-odoo.mjs): the day's
// plan and actual, the four HTML fields, the line's contribution, the settings' profit target.

export const REQUEST_MODEL = "x_unavailable_request";
export const REQUEST_MODEL_NAME = "UTAK — طلبوا وما كان متوفر";
export const REQUEST_ORDER = "x_date desc, id desc";
export const REQUEST_FIELDS = [
  { name: "x_date", ttype: "date", field_description: "اليوم", help: "يوم الرياض الذي طُلب فيه الصنف." },
  { name: "x_partner_id", ttype: "many2one", relation: "res.partner", on_delete: "set null", field_description: "العميل" },
  { name: "x_text", ttype: "char", field_description: "الصنف كما كتبه", help: "اسم الصنف كما ورد في رسالة العميل (أو اسمه في الكتالوج حين خرج من طلب قائم)." },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", on_delete: "set null", field_description: "الصنف في الكتالوج", help: "الصنف المطابق في الكتالوج إن وُجد؛ فارغ = صنف لا نبيعه." },
  { name: "x_quantity", ttype: "float", field_description: "الكمية", help: "الكمية إن ذكرها العميل؛ 0 = لم تُذكر." },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة", help: "سجل اختبار: خارج كل مجموع وكل ملخص." },
];

export const PRICING_MENU = 582;           // UTAK ← 💲 التسعير
export const REQUEST_TITLE = "🙋 طلبوا وما كان متوفر";
export const REQUEST_ACTION = "UTAK — طلبوا وما كان متوفر";
export const REQUEST_VIEW = "utak.unavailable_request_list";
export const REQUEST_MENU_SEQUENCE = 27;   // after «📈 تاريخ الأسعار» (25), before «📥 عروض المصادر» (30)
/** The real rows alone. */
export const REQUEST_DOMAIN = "[('x_utak_simulation', '=', False)]";
/** A list to read: the worker writes the rows, nobody types one. */
export const REQUEST_LIST_ARCH = `<list string="${REQUEST_TITLE}" create="0" edit="0" default_order="${REQUEST_ORDER}">
  <field name="x_date"/>
  <field name="x_partner_id"/>
  <field name="x_text"/>
  <field name="x_product_tmpl_id"/>
  <field name="x_quantity"/>
</list>`;

/** § 58's views this order verifies again (د 4: the contribution is one of the measures of «📈 تاريخ الأسعار»). */
export const HISTORY_VIEWS = ["utak.price_history_graph", "utak.price_history_pivot"];
export const CONTRIBUTION_FIELD = "x_contribution";
