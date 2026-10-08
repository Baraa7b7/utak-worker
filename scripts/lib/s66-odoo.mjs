// § 66 (2026-10-08) — «العميل وافق» → an order that is bought, delivered and invoiced: the tenant's side.
// The data of scripts/s66-20261008-odoo.mjs (which writes it) and of its verify.
//
// A special request («طلب أسعار خاص», § 62) ended at «صدر العرض» with a draft sale.order. From here:
//   • «✅ العميل وافق» (the request's form, and the linked sale order's) opens the acceptance on the request:
//     the delivery date, each line's confirmed quantity, the payment terms, the delivery note;
//   • «📦 حوّل لطلب» makes the day's order (x_daily_order) of the confirmed quantities at the quotation's
//     final prices — locked («سعر خاص» on the line) — and the request becomes «مقبول — تحوّل لطلب».
// The worker does the work (src/special-accept.ts): the two buttons are webhooks to its special-quote hook.

export const PROD_HOST = "utak-worker.utak-business.workers.dev";
export const HOOK_PATH = "/odoo/hook/special-quote";
/** An action of § 62 that already calls the worker: the origin and the token are read from it, never printed. */
export const SOURCE_ACTION = "utak.special_quote.recalc_webhook";

export const QUOTE_MODEL = "x_special_quote";
export const LINE_MODEL = "x_special_quote_line";
export const ORDER_MODEL = "x_daily_order";
export const ORDER_LINE_MODEL = "x_daily_order_line";
export const CONFIG_MODEL = "x_pricing_config";
export const SALE_MODEL = "sale.order";

/** «الحالة» of a request, in its order: § 62's five and «مقبول» before «مغلق». */
export const STATES = [["draft", "مسودة"], ["sent", "أُرسل للمصادر"], ["priced", "مُسعَّر"], ["quoted", "صدر العرض"], ["accepted", "مقبول — تحوّل لطلب"], ["closed", "مغلق"]];
export const ACCEPTED = "accepted";
/** «طريقة الدفع» on the request: the values of the customer's card («شروط الدفع», res.partner.x_pay_terms). */
export const PAY_TERMS = [["cash", "نقد عند الاستلام"], ["daily_transfer", "تحويل يومي"], ["credit", "آجل"]];
const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;
export const LARGE_ORDER_DEFAULT = 50;

export const QUOTE_FIELDS = [
  { name: "x_accepted_at", ttype: "datetime", field_description: "وافق العميل", help: "وقت ضغط «✅ العميل وافق». بعده تظهر خانات القبول وزر «📦 حوّل لطلب»." },
  { name: "x_delivery_date", ttype: "date", field_description: "تاريخ التسليم", help: "صباح هذا اليوم يُسلَّم الطلب: يدخل قائمة شراء الليلة التي قبله (21:15). الافتراضي يوم العمل التالي من «جدول أيام العمل»." },
  { name: "x_pay_terms", ttype: "selection", selection: sel(PAY_TERMS), field_description: "طريقة الدفع", help: "من بطاقة العميل («شروط الدفع»)، وتُغيَّر لهذا الطلب." },
  { name: "x_delivery_note", ttype: "text", field_description: "ملاحظة التسليم" },
  { name: "x_accept_expired", ttype: "boolean", field_description: "أعتمد الأسعار رغم انتهاء الصلاحية", help: "عرض انتهت صلاحيته لا يتحوّل لطلب إلا بهذه العلامة، وتُسجَّل على الطلب اليومي." },
  { name: "x_daily_order_id", ttype: "many2one", relation: ORDER_MODEL, on_delete: "set null", field_description: "الطلب اليومي", help: "الطلب الذي تحوّل إليه هذا العرض. يكتبه الوركر." },
  { name: "x_converted_at", ttype: "datetime", field_description: "تحوّل لطلب" },
  { name: "x_confirmed_total", ttype: "float", field_description: "إجمالي الطلب المؤكد (شامل الضريبة)", help: "الكميات المؤكدة × السعر النهائي الشامل: ما ستجمعه الفاتورة لو سُلّم كله. يكتبه الوركر." },
];
export const LINE_FIELDS = [
  { name: "x_confirmed_qty", ttype: "char", field_description: "الكمية المؤكدة", help: "ما أكده العميل من هذا السطر. إلزامية في عرض أسعار الوحدة؛ 0 = السطر خارج الطلب. فارغة في عرض بالكميات = الكمية كما هي." },
];
export const ORDER_FIELDS = [
  { name: "x_special_quote_id", ttype: "many2one", relation: QUOTE_MODEL, on_delete: "set null", field_description: "طلب الأسعار الخاص", help: "الطلب قادم من عرض سعر خاص: أسعاره مقفلة على أسطره." },
];
export const ORDER_LINE_FIELDS = [
  { name: "x_special_price", ttype: "boolean", field_description: "سعر خاص", help: "سعر هذا السطر من عرض سعر خاص: لا يغيّره نشر أسعار اليوم ولا إعادة حساب." },
  { name: "x_pack_text", ttype: "char", field_description: "التعبئة (طلب خاص)", help: "التعبئة كما كُتبت في العرض الخاص: تُطبع بدل اسم العبوة." },
  { name: "x_special_purchase", ttype: "float", field_description: "الشراء (طلب خاص)", help: "سعر الشراء لوحدة السطر بدون ضريبة: المستهدف من العرض، ثم الفعلي بعد تأكيد قائمة الشراء. منه يُحسب ربح السطر." },
  { name: "x_special_supplier_id", ttype: "many2one", relation: "res.partner", on_delete: "set null", field_description: "مورد الشراء (طلب خاص)", help: "صاحب أقل سعر شراء في العرض: عليه يُحسب مستحق هذا السطر وفاتورته. فارغ = مورد قائمة الشراء." },
];
export const CONFIG_FIELDS = [
  { name: "x_large_order_cartons", ttype: "integer", field_description: "حد الطلب الكبير (كرتون)", help: "طلب خاص يبلغ هذا العدد من الكراتين: تنبيه «🚚 رتّب المركبة» عند التحويل وصباح يوم التسليم. فارغ أو 0 = 50." },
];

/** The two buttons of the request's form: webhooks to the worker's special-quote hook, by their op. */
export const HOOKS = {
  approve: { name: "utak.special_quote.approve_webhook", op: "approve" },
  convert: { name: "utak.special_quote.convert_webhook", op: "convert" },
};
/**
 * «↩️ أعد فتحه» (§ 62's code action): a request that became an order comes back «مقبول», never «صدر العرض» —
 * unless that order was cancelled: then it is «صدر العرض» again, and may be converted anew.
 */
export const REOPEN_ACTION = "utak.special_quote.reopen";
export const REOPEN_CODE = `for rec in records:
    converted = rec.x_daily_order_id and rec.x_daily_order_id.x_state != 'cancelled'
    rec.write({'x_state': 'accepted' if converted else ('quoted' if rec.x_quotation_number else ('sent' if rec.x_asked_at else 'draft'))})`;
/** § 62's own code of it: what --rollback puts back when the rollback file holds none. */
export const REOPEN_CODE_BEFORE = `for rec in records:
    rec.write({'x_state': 'quoted' if rec.x_quotation_number else ('sent' if rec.x_asked_at else 'draft')})`;
/** «✅ العميل وافق» on the linked sale order: the same press on its request, then the request's form. */
export const SALE_ACCEPT_ACTION = "utak.sale_order.special_accept";
export const SALE_ACCEPT_CODE = `quote = env['x_special_quote'].search([('x_sale_order_id', '=', record.id)], limit=1)
if not quote:
    raise UserError('هذا الأمر ليس عرض «طلب أسعار خاص»: القبول والتحويل من شاشة الطلب الخاص.')
hook = env['ir.actions.server'].sudo().search([('name', '=', '${HOOKS.approve.name}')], limit=1)
if hook:
    hook.with_context(active_model='x_special_quote', active_id=quote.id, active_ids=[quote.id]).run()
action = {
    'type': 'ir.actions.act_window',
    'res_model': 'x_special_quote',
    'res_id': quote.id,
    'view_mode': 'form',
    'views': [(False, 'form')],
    'target': 'current',
}`;

export const APPROVE_LABEL = "✅ العميل وافق";
export const CONVERT_LABEL = "📦 حوّل لطلب";
export const CONVERT_CONFIRM = "ينشئ طلباً يومياً بتاريخ التسليم والكميات المؤكدة، ويؤكد أمر البيع، ويرسل التأكيد للعميل. متأكد؟";
const NOW_UTC = "datetime.datetime.now().to_utc().strftime('%Y-%m-%d %H:%M:%S')";
/** «بانتظار رد العميل»: issued, still valid, not accepted. «انتهت صلاحيته»: issued and past its «صالح حتى». */
export const FILTERS = [
  ["f_accepted", "مقبول", `[('x_state', '=', 'accepted')]`],
  ["f_waiting", "بانتظار رد العميل", `[('x_state', '=', 'quoted'), ('x_valid_until', '&gt;=', ${NOW_UTC})]`],
  ["f_expired", "انتهت صلاحيته", `[('x_state', '=', 'quoted'), ('x_valid_until', '&lt;', ${NOW_UTC})]`],
];

/**
 * The six extension views of the screens (--only=ui, AFTER the worker's code is deployed: the two buttons
 * call ops the worker of before answers 400). `ids`: the server actions' ids the buttons call.
 */
export const views = (ids) => ({
  "utak.special_quote_form.s66_accept": {
    model: QUOTE_MODEL, parent: "utak.special_quote_form", type: "form", shows: [APPROVE_LABEL, CONVERT_LABEL, 'name="x_delivery_date"', 'name="x_confirmed_qty"', "accepted"],
    arch: `<data>
  <xpath expr="//header/button[@name='${ids.close}']" position="before">
    <button name="${ids.approve}" type="action" string="${APPROVE_LABEL}" class="btn-primary" invisible="x_state != 'quoted'"/>
    <button name="${ids.convert}" type="action" string="${CONVERT_LABEL}" class="btn-primary" invisible="x_state != 'quoted' or not x_accepted_at" confirm="${CONVERT_CONFIRM}"/>
  </xpath>
  <xpath expr="//header/button[@name='${ids.send}']" position="attributes"><attribute name="invisible">x_state in ('closed', 'accepted')</attribute></xpath>
  <xpath expr="//header/button[@name='${ids.accept}']" position="attributes"><attribute name="invisible">x_state in ('closed', 'accepted')</attribute></xpath>
  <xpath expr="//header/button[@name='${ids.issue}']" position="attributes"><attribute name="invisible">x_state in ('closed', 'accepted')</attribute></xpath>
  <xpath expr="//header/field[@name='x_state']" position="attributes"><attribute name="statusbar_visible">draft,sent,priced,quoted,accepted,closed</attribute></xpath>
  <xpath expr="//sheet/group" position="after">
    <group string="قبول العميل والتحويل لطلب" name="utak_accept" invisible="not x_accepted_at and x_state != 'accepted'">
      <group>
        <field name="x_accepted_at" readonly="1"/>
        <field name="x_delivery_date" readonly="x_state != 'quoted'"/>
        <field name="x_pay_terms" readonly="x_state != 'quoted'"/>
        <field name="x_delivery_note" readonly="x_state != 'quoted'" placeholder="وقت الاستلام، البوابة، اسم المستلم…"/>
      </group>
      <group>
        <field name="x_accept_expired" readonly="x_state != 'quoted'"/>
        <field name="x_confirmed_total" readonly="1"/>
        <field name="x_daily_order_id" readonly="1"/>
        <field name="x_converted_at" readonly="1"/>
      </group>
    </group>
  </xpath>
  <xpath expr="//field[@name='x_line_ids']" position="attributes"><attribute name="readonly">x_state in ('closed', 'accepted')</attribute></xpath>
  <xpath expr="//field[@name='x_line_ids']/list/field[@name='x_qty']" position="after">
    <field name="x_confirmed_qty" column_invisible="not parent.x_accepted_at" placeholder="0 = خارج الطلب"/>
  </xpath>
</data>`,
  },
  "utak.special_quote_list.s66": {
    model: QUOTE_MODEL, parent: "utak.special_quote_list", type: "list", shows: ['name="x_delivery_date"', "decoration-primary"],
    arch: `<data>
  <xpath expr="//field[@name='x_state']" position="attributes"><attribute name="decoration-primary">x_state == 'accepted'</attribute></xpath>
  <xpath expr="//field[@name='x_quotation_number']" position="after">
    <field name="x_delivery_date" optional="show"/>
    <field name="x_daily_order_id" optional="show"/>
  </xpath>
</data>`,
  },
  "utak.special_quote_search.s66": {
    model: QUOTE_MODEL, parent: "utak.special_quote_search", type: "search", shows: FILTERS.map(([name]) => `name="${name}"`),
    arch: `<data>
  <xpath expr="//filter[@name='f_closed']" position="after">
${FILTERS.map(([name, string, domain]) => `    <filter name="${name}" string="${string}" domain="${domain}"/>`).join("\n")}
  </xpath>
</data>`,
  },
  "x_daily_order.form.utak_s66": {
    model: ORDER_MODEL, parent: "x_daily_order.form", type: "form", shows: ['name="x_special_quote_id"', 'name="x_special_price"', 'name="x_pack_text"', 'name="x_special_purchase"', 'name="x_special_supplier_id"'],
    arch: `<data>
  <xpath expr="//field[@name='x_created_via']" position="after">
    <field name="x_special_quote_id" readonly="1" invisible="not x_special_quote_id"/>
  </xpath>
  <xpath expr="//field[@name='x_line_ids']/list/field[@name='x_unit_price']" position="after">
    <field name="x_special_price" optional="show" readonly="1"/>
    <field name="x_pack_text" optional="show" readonly="1"/>
    <field name="x_special_purchase" optional="show"/>
    <field name="x_special_supplier_id" optional="show" options="{'no_create': True}"/>
  </xpath>
</data>`,
  },
  "utak.pricing_settings_form.s66_large_order": {
    model: CONFIG_MODEL, parent: "utak.pricing_settings_form", type: "form", shows: ['name="x_large_order_cartons"'],
    arch: `<data>
  <xpath expr="//field[@name='x_planned_stops']" position="after">
    <field name="x_large_order_cartons"/>
  </xpath>
</data>`,
  },
  "utak.sale.order.form.s66_accept": {
    model: SALE_MODEL, parent: "sale.order.form", type: "form", shows: [APPROVE_LABEL],
    arch: `<data>
  <xpath expr="//header" position="inside">
    <button name="${ids.saleAccept}" string="${APPROVE_LABEL}" type="action" class="btn-secondary" invisible="state not in ('draft', 'sent') or not origin"/>
  </xpath>
</data>`,
  },
});
/** § 62's actions the form's extension points at (their buttons' names are their ids). */
export const FORM_ACTIONS = { close: "utak.special_quote.close", send: "utak.special_quote.send_webhook", accept: "utak.special_quote.accept_webhook", issue: "utak.special_quote.issue_webhook" };
