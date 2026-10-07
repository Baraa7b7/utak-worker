// § 62 (2026-10-07) — «طلب أسعار خاص», as data: one source for scripts/s62-20261007-odoo.mjs (which
// writes it to the tenant) and tests/s62-*.test.mts (which read the pieces against what the worker
// reads and writes — src/special-quote.ts, src/special-ask.ts, src/special-quotation.ts).
//
// A customer's request for items outside the day's list: its lines, the sources it is sent to, the
// prices they answer by the form, the worker's numbers on every line (the cost, «بدون خسارة», «المقترح»,
// the profit) and the quotation it ends with. It never touches the day's list: its products are not
// «نشط للبيع», its replies are read by their own token, and its market observations are x_price_offer
// rows flagged «خاص» that every reader of the day leaves out.
//
// Odoo holds the data and the screen; every number is the worker's (src/special-quote-math.ts).

export const QUOTE_MODEL = "x_special_quote";
export const QUOTE_MODEL_NAME = "UTAK — طلب أسعار خاص";
export const QUOTE_ORDER = "id desc";
export const LINE_MODEL = "x_special_quote_line";
export const LINE_MODEL_NAME = "UTAK — سطر طلب أسعار خاص";
export const LINE_ORDER = "x_sequence, id";
export const RECIPIENT_MODEL = "x_special_quote_recipient";
export const RECIPIENT_MODEL_NAME = "UTAK — مصدر طلب أسعار خاص";
export const RECIPIENT_ORDER = "id";
export const OFFER_MODEL = "x_price_offer";

export const STATES = [["draft", "مسودة"], ["sent", "أُرسل للمصادر"], ["priced", "مُسعَّر"], ["quoted", "صدر العرض"], ["closed", "مغلق"]];
export const ROLES = [["purchase", "شراء"], ["market", "سوق"]];
const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;

/** The request (the lines and the sources point at it: their own fields below). */
export const QUOTE_FIELDS = [
  { name: "x_partner_id", ttype: "many2one", relation: "res.partner", on_delete: "restrict", field_description: "العميل" },
  { name: "x_date", ttype: "date", field_description: "التاريخ" },
  { name: "x_state", ttype: "selection", selection: sel(STATES), field_description: "الحالة", help: "مسودة ← أُرسل للمصادر ← مُسعَّر (كل سطر له سعر نهائي) ← صدر العرض ← مغلق. الطلب المغلق لا يقبل رداً من مصدر." },
  { name: "x_waste_pct", ttype: "float", field_description: "نسبة التالف ٪", help: "التكلفة = الشراء × (1 + التالف). الافتراضي من الإعدادات." },
  { name: "x_min_margin_pct", ttype: "float", field_description: "هامش الربح الأدنى ٪", help: "الأدنى المربح = التكلفة × (1 + الهامش) × 1.15. الافتراضي 10." },
  { name: "x_delivery_cost", ttype: "float", field_description: "تكلفة التوصيل لهذا الطلب", help: "تُطرح من مجموع ربح الأسطر. الافتراضي تكلفة التشغيل اليومية الحالية." },
  { name: "x_valid_until", ttype: "datetime", field_description: "صالح حتى", help: "يُكتب في عرض السعر. الافتراضي نهاية الغد." },
  { name: "x_note", ttype: "text", field_description: "ملاحظة" },
  // the worker's numbers (read-only on the screen)
  { name: "x_order_profit", ttype: "float", field_description: "ربح الطلب (ريال)", help: "مجموع ربح الأسطر − تكلفة التوصيل. يكتبه الوركر." },
  { name: "x_profit_text", ttype: "char", field_description: "ربح الطلب", help: "✅ أو ❌ بالإشارة. يكتبه الوركر مع كل حفظ." },
  { name: "x_missing_purchase", ttype: "integer", field_description: "أسطر بلا سعر شراء" },
  { name: "x_missing_final", ttype: "integer", field_description: "أسطر بلا سعر نهائي" },
  { name: "x_total", ttype: "float", field_description: "إجمالي العرض (شامل الضريبة)" },
  { name: "x_summary", ttype: "char", field_description: "الخلاصة" },
  { name: "x_last_result", ttype: "char", field_description: "آخر نتيجة", help: "ما فعله آخر زر: يكتبه الوركر (حدّث الصفحة بعد الضغط بثوانٍ)." },
  { name: "x_source_notes", ttype: "text", field_description: "ملاحظات المصادر", help: "ما كتبه كل مصدر في خانة «ملاحظة» من النموذج." },
  { name: "x_asked_at", ttype: "datetime", field_description: "أُرسل للمصادر" },
  // the quotation
  { name: "x_sale_order_id", ttype: "many2one", relation: "sale.order", on_delete: "set null", field_description: "عرض السعر في Odoo" },
  { name: "x_quotation_number", ttype: "char", field_description: "رقم العرض" },
  { name: "x_pdf_url", ttype: "char", field_description: "رابط PDF" },
  { name: "x_issued_at", ttype: "datetime", field_description: "صدر العرض" },
  { name: "x_prepared", ttype: "boolean", field_description: "جُهّز (الوركر)", help: "الوركر ملأ الافتراضيات: التالف، والهامش، وتكلفة التوصيل، و«صالح حتى»، والمصادر." },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة", help: "سجل اختبار: لا يُرسل منه شيء." },
];
export const QUOTE_O2M = [
  { name: "x_line_ids", ttype: "one2many", relation: LINE_MODEL, relation_field: "x_quote_id", field_description: "الأصناف" },
  { name: "x_recipient_ids", ttype: "one2many", relation: RECIPIENT_MODEL, relation_field: "x_quote_id", field_description: "المصادر" },
];

export const LINE_FIELDS = [
  { name: "x_quote_id", ttype: "many2one", relation: QUOTE_MODEL, on_delete: "cascade", required: true, index: true, field_description: "الطلب" },
  { name: "x_sequence", ttype: "integer", field_description: "الترتيب" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", on_delete: "restrict", field_description: "الصنف" },
  { name: "x_qty", ttype: "float", field_description: "الكمية" },
  { name: "x_unit", ttype: "char", field_description: "الوحدة", help: "كيلو افتراضياً." },
  { name: "x_purchase_price", ttype: "float", field_description: "الشراء", help: "سعر الشراء للوحدة بدون ضريبة: أقل ما أرسلته مصادر «شراء»، أو ما تكتبه بيدك." },
  { name: "x_market_text", ttype: "char", field_description: "السوق", help: "وسيط السوق، وبعده كل مشاهدة بمصدرها." },
  { name: "x_market_median", ttype: "float", field_description: "وسيط السوق" },
  { name: "x_no_loss_price", ttype: "float", field_description: "بدون خسارة", help: "التكلفة × 1.15." },
  { name: "x_suggested_price", ttype: "float", field_description: "المقترح", help: "الأعلى من (وسيط السوق، الأدنى المربح)، لأعلى لأقرب ربع ريال." },
  { name: "x_final_price", ttype: "float", field_description: "النهائي", help: "سعر البيع للوحدة شامل الضريبة: تكتبه أنت (أو «اعتمد المقترح للكل»)." },
  { name: "x_total", ttype: "float", field_description: "الإجمالي" },
  { name: "x_profit", ttype: "float", field_description: "الربح", help: "الكمية × (النهائي ÷ 1.15 − التكلفة)." },
  { name: "x_obs", ttype: "text", field_description: "المشاهدات (تقني)", help: "ما أرسله كل مصدر لهذا السطر: يكتبه الوركر ويقرؤه." },
];

export const RECIPIENT_FIELDS = [
  { name: "x_quote_id", ttype: "many2one", relation: QUOTE_MODEL, on_delete: "cascade", required: true, index: true, field_description: "الطلب" },
  { name: "x_partner_id", ttype: "many2one", relation: "res.partner", on_delete: "restrict", field_description: "المصدر" },
  { name: "x_role", ttype: "selection", selection: sel(ROLES), field_description: "الدور", help: "شراء: يرى الكميات ويكتب سعره بدون ضريبة. سوق: لا يرى كمية، ويكتب سعر السوق شامل الضريبة." },
  { name: "x_asked_at", ttype: "datetime", field_description: "أُرسل له" },
  { name: "x_via", ttype: "char", field_description: "كيف أُرسل" },
  { name: "x_replied_at", ttype: "datetime", field_description: "ردّ" },
  { name: "x_priced", ttype: "integer", field_description: "أصناف سعّرها" },
  { name: "x_reminded_at", ttype: "datetime", field_description: "ذُكّر" },
];

/** «عروض المصادر»: a market observation of a special request — flagged, linked, and left out of the day. */
export const OFFER_FIELDS = [
  { name: "x_special", ttype: "boolean", field_description: "خاص", help: "مشاهدة من «طلب أسعار خاص»: خارج حساب أسعار اليوم، وسعرها للوحدة المكتوبة لا للتعبئة." },
  { name: "x_special_quote_id", ttype: "many2one", relation: QUOTE_MODEL, on_delete: "set null", field_description: "طلب الأسعار الخاص" },
  { name: "x_special_unit", ttype: "char", field_description: "وحدة السعر (خاص)" },
];

// ---------------------------------------------------------------- the screen

export const PRICING_MENU = 582;           // UTAK ← 💲 التسعير
export const MENU_TITLE = "🧾 طلبات أسعار خاصة";
export const MENU_SEQUENCE = 28;           // after «🙋 طلبوا وما كان متوفر» (27), before «📥 عروض المصادر» (30)
export const ACTION_NAME = "UTAK — طلبات أسعار خاصة";
export const ACTION_DOMAIN = "[('x_utak_simulation', '=', False)]";
export const ACTION_CONTEXT = "{'default_x_state': 'draft', 'default_x_min_margin_pct': 10}";
export const VIEW_LIST = "utak.special_quote_list";
export const VIEW_FORM = "utak.special_quote_form";
export const VIEW_SEARCH = "utak.special_quote_search";
export const VIEW_OFFER_LIST = "utak.price_offer_list.special";
export const VIEW_MARKET_LIST = "utak.pricing_market_list.special";
export const VIEW_OFFER_SEARCH = "utak.price_offer_search.special";
/** The lists and the search of «عروض المصادر» the three extensions hang on (by name). */
export const OFFER_PARENTS = { [VIEW_OFFER_LIST]: "utak.price_offer_list", [VIEW_MARKET_LIST]: "utak.pricing_market_list", [VIEW_OFFER_SEARCH]: "utak.price_offer_search" };

/** The worker's hook, and what each button asks of it (src/index.ts /odoo/hook/special-quote?op=…). */
export const HOOK_PATH = "/odoo/hook/special-quote";
export const PROD_HOST = "utak-worker.utak-business.workers.dev";
export const HOOKS = {
  send: { name: "utak.special_quote.send_webhook", op: "send" },
  recalc: { name: "utak.special_quote.recalc_webhook", op: "recalc" },
  accept: { name: "utak.special_quote.accept_webhook", op: "accept" },
  issue: { name: "utak.special_quote.issue_webhook", op: "issue" },
  pdf: { name: "utak.special_quote.pdf_webhook", op: "pdf" },
};
export const CODE_ACTIONS = {
  close: { name: "utak.special_quote.close", code: "for rec in records:\n    rec.write({'x_state': 'closed'})" },
  reopen: { name: "utak.special_quote.reopen", code: "for rec in records:\n    rec.write({'x_state': 'quoted' if rec.x_quotation_number else ('sent' if rec.x_asked_at else 'draft')})" },
};
/** A save that changes what the numbers are made of asks the worker for them again (never a field the worker writes alone). */
export const AUTOMATION_NAME = "utak.special_quote.recalc (on save)";
export const AUTOMATION_TRIGGER = "on_create_or_write";
export const AUTOMATION_FIELDS = ["x_partner_id", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_line_ids"];

export const LIST_ARCH = `<list string="${MENU_TITLE}" default_order="${QUOTE_ORDER}" decoration-muted="x_state == 'closed'">
  <field name="x_name" string="الطلب"/>
  <field name="x_partner_id"/>
  <field name="x_date"/>
  <field name="x_state" widget="badge" decoration-info="x_state == 'sent'" decoration-warning="x_state == 'priced'" decoration-success="x_state == 'quoted'"/>
  <field name="x_profit_text"/>
  <field name="x_missing_purchase"/>
  <field name="x_valid_until" optional="show"/>
  <field name="x_quotation_number" optional="show"/>
</list>`;

export const SEARCH_ARCH = `<search string="${MENU_TITLE}">
  <field name="x_name" string="الطلب"/>
  <field name="x_partner_id"/>
  <filter name="f_open" string="غير مغلق" domain="[('x_state', '!=', 'closed')]"/>
  <filter name="f_closed" string="مغلق" domain="[('x_state', '=', 'closed')]"/>
  <separator/>
  <filter name="g_state" string="الحالة" context="{'group_by': 'x_state'}"/>
  <filter name="g_partner" string="العميل" context="{'group_by': 'x_partner_id'}"/>
</search>`;

/** The eight columns of a line, in the order Baraa reads them (the unit, the median alone and the total can be shown). */
export const LINE_COLUMNS = ["x_product_tmpl_id", "x_qty", "x_purchase_price", "x_market_text", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_profit"];

/** The form. `a` = the ids of the seven actions its buttons call. */
export const formArch = (a) => `<form string="طلب أسعار خاص">
  <header>
    <button name="${a.send}" type="action" string="📨 أرسل طلب الأسعار" class="btn-primary" invisible="x_state == 'closed'" confirm="يُرسل نموذج الأسعار الآن إلى المصادر في تبويب «المصادر». متأكد؟"/>
    <button name="${a.accept}" type="action" string="اعتمد المقترح للكل" invisible="x_state == 'closed'"/>
    <button name="${a.recalc}" type="action" string="🔄 احسب"/>
    <button name="${a.issue}" type="action" string="📄 أصدر عرض السعر" invisible="x_state == 'closed'" confirm="يصدر عرض السعر بالأسعار النهائية ويُرسل ملفه للعميل. متأكد؟"/>
    <button name="${a.pdf}" type="action" string="⬇️ PDF لي فقط" invisible="x_state == 'closed'"/>
    <button name="${a.close}" type="action" string="🔒 أغلق الطلب" invisible="x_state == 'closed'" confirm="الطلب المغلق لا يقبل رداً من مصدر. متأكد؟"/>
    <button name="${a.reopen}" type="action" string="↩️ أعد فتحه" invisible="x_state != 'closed'"/>
    <field name="x_state" widget="statusbar" statusbar_visible="draft,sent,priced,quoted,closed"/>
  </header>
  <sheet>
    <div class="oe_title">
      <h1><field name="x_name" readonly="1" placeholder="طلب أسعار خاص"/></h1>
      <h2><field name="x_profit_text" readonly="1"/></h2>
    </div>
    <group>
      <group string="الطلب">
        <field name="x_partner_id" options="{'no_create': True}" required="1" readonly="x_state == 'closed'"/>
        <field name="x_date"/>
        <field name="x_valid_until"/>
        <field name="x_note"/>
      </group>
      <group string="الحساب">
        <field name="x_missing_purchase" readonly="1"/>
        <field name="x_waste_pct"/>
        <field name="x_min_margin_pct"/>
        <field name="x_delivery_cost"/>
        <field name="x_summary" readonly="1"/>
        <field name="x_last_result" readonly="1"/>
      </group>
    </group>
    <notebook>
      <page string="الأصناف" name="lines">
        <field name="x_line_ids" readonly="x_state == 'closed'" context="{'default_x_unit': 'كيلو'}">
          <list editable="bottom" decoration-danger="x_profit &lt; 0" decoration-muted="not x_purchase_price">
            <field name="x_sequence" widget="handle"/>
            <field name="x_product_tmpl_id" required="1"/>
            <field name="x_qty"/>
            <field name="x_unit" optional="hide"/>
            <field name="x_purchase_price"/>
            <field name="x_market_text" readonly="1"/>
            <field name="x_market_median" readonly="1" optional="hide"/>
            <field name="x_no_loss_price" readonly="1"/>
            <field name="x_suggested_price" readonly="1"/>
            <field name="x_final_price"/>
            <field name="x_profit" readonly="1" sum="ربح الأسطر"/>
            <field name="x_total" readonly="1" optional="hide" sum="الإجمالي"/>
          </list>
        </field>
      </page>
      <page string="المصادر" name="recipients">
        <field name="x_recipient_ids" readonly="x_state == 'closed'" context="{'default_x_role': 'market'}">
          <list editable="bottom">
            <field name="x_partner_id" options="{'no_create': True}" required="1"/>
            <field name="x_role" required="1"/>
            <field name="x_asked_at" readonly="1"/>
            <field name="x_via" readonly="1"/>
            <field name="x_replied_at" readonly="1"/>
            <field name="x_priced" readonly="1"/>
            <field name="x_reminded_at" readonly="1" optional="show"/>
          </list>
        </field>
        <group>
          <field name="x_asked_at" readonly="1"/>
          <field name="x_source_notes" readonly="1"/>
        </group>
      </page>
      <page string="عرض السعر" name="quotation">
        <group>
          <field name="x_quotation_number" readonly="1"/>
          <field name="x_sale_order_id" readonly="1"/>
          <field name="x_total" readonly="1"/>
          <field name="x_order_profit" readonly="1"/>
          <field name="x_missing_final" readonly="1"/>
          <field name="x_issued_at" readonly="1"/>
          <field name="x_pdf_url" readonly="1" widget="url"/>
        </group>
      </page>
    </notebook>
  </sheet>
</form>`;

const afterStatus = `<xpath expr="//field[@name='x_status']" position="after">
    <field name="x_special" optional="show"/>
    <field name="x_special_quote_id" optional="show"/>
    <field name="x_special_unit" optional="hide"/>
  </xpath>`;
export const OFFER_EXT_ARCH = {
  [VIEW_OFFER_LIST]: `<data>\n  ${afterStatus}\n</data>`,
  [VIEW_MARKET_LIST]: `<data>\n  ${afterStatus}\n</data>`,
  [VIEW_OFFER_SEARCH]: `<data>
  <xpath expr="//filter[@name='f_outlier']" position="after">
    <filter name="f_special" string="خاص" domain="[('x_special', '=', True)]"/>
    <filter name="f_not_special" string="بلا الخاص" domain="[('x_special', '!=', True)]"/>
  </xpath>
</data>`,
};
