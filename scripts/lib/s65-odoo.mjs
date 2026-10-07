// § 65 (2026-10-07) — the suppliers' registry, as data: one source for scripts/s65-20261007-odoo.mjs (which
// writes it to the tenant) and tests/s65-*.test.mts (which read the pieces against what the worker reads
// and writes — src/supplier-registry.ts, src/supplier-offer.ts, src/supplier-outreach.ts).
//
// A supplier is a res.partner that carries «حالة المورد» (x_supplier_state). His type, what he supplies,
// where he is, how he delivers and is paid, and how often we write to him live on his card; his seasons
// and his capacity are two small models; what he offers on his own («📦 بضاعتي جاهزة» / «🚢 وصلت شحنة»)
// and the extra items of a price form are x_price_offer rows flagged «خاص» (every reader of the day
// leaves them out, as § 62's) with their kind in x_offer_kind.
//
// supplier_rank is NOT touched by a registration or an approval: the 02:00 purchase ask and the
// supplier's reply path stay Baraa's decision (the card's «مصدر أسعار» and «دور الأسعار», or a purchase).

export const PARTNER = "res.partner";
export const SEASON_MODEL = "x_supplier_season";
export const SEASON_MODEL_NAME = "UTAK — مواسم المورد";
export const SEASON_ORDER = "x_partner_id, x_month_from, id";
export const CAPACITY_MODEL = "x_supplier_capacity";
export const CAPACITY_MODEL_NAME = "UTAK — طاقة المورد";
export const CAPACITY_ORDER = "x_product_tmpl_id, x_partner_id, id";
export const OFFER_MODEL = "x_price_offer";
export const DAILY_MODEL = "x_daily_price";
export const CONFIG_MODEL = "x_pricing_config";
export const LINE_MODEL = "x_special_quote_line";
export const QUOTE_MODEL = "x_special_quote";

const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;

/** «نوع المورد»: the six keys of before with their Arabic names, and «مورد مصاريف» (new). */
export const SUPPLIER_TYPES = [["wholesaler", "تاجر جملة"], ["farmer", "مزارع"], ["importer", "مستورد"], ["distributor", "موزّع متخصص"], ["market_agent", "وكيل سوق مركزي"], ["expense", "مورد مصاريف"], ["other", "أخرى"]];
export const SUPPLIER_TYPE_FIELD = "x_supplier_type";
export const SUPPLIER_TYPE_TITLE = "نوع المورد";
export const SUPPLIED_FIELD = "x_supplied_product_ids";
export const SUPPLIED_TITLE = "الأصناف التي يوفرها";
export const STATES = [["pending", "بانتظار الاعتماد"], ["approved", "معتمد"], ["suspended", "موقوف"]];
export const SUPPLY_METHODS = [["delivers", "يوصّل بنفسه"], ["pickup", "نستلم من عنده"], ["market", "في السوق"]];
export const PAY_TERMS = [["cash", "نقد عند الاستلام"], ["daily_transfer", "تحويل يومي"], ["credit", "آجل"]];
export const CADENCES = [["daily", "يومي"], ["weekly", "أسبوعي"], ["monthly", "شهري"], ["on_demand", "عند الطلب"]];
/** «إيقاع التواصل» of a type when the card carries none (the approval writes it): expense = none. */
export const CADENCE_BY_TYPE = { market_agent: "daily", wholesaler: "daily", distributor: "weekly", importer: "weekly", farmer: "monthly", other: "on_demand" };
export const MONTHS = [["01", "يناير"], ["02", "فبراير"], ["03", "مارس"], ["04", "أبريل"], ["05", "مايو"], ["06", "يونيو"], ["07", "يوليو"], ["08", "أغسطس"], ["09", "سبتمبر"], ["10", "أكتوبر"], ["11", "نوفمبر"], ["12", "ديسمبر"]];
export const CAPACITY_PER = [["day", "لكل يوم"], ["batch", "لكل دفعة"]];
export const OFFER_KINDS = [["supplier_offer", "عرض مورد"], ["extra", "صنف إضافي"]];

/** The supplier's card (res.partner). x_supplier_type, x_supplied_product_ids and x_contact_name exist. */
export const PARTNER_FIELDS = [
  { name: "x_supplier_state", ttype: "selection", selection: sel(STATES), field_description: "حالة المورد", help: "بانتظار الاعتماد: سجّل من واتساب ولم تعتمده. معتمد: يصله الترحيب وطلب الأسعار والتواصل الدوري. موقوف: لا يصله شيء." },
  { name: "x_supplier_items_text", ttype: "text", field_description: "أصناف كتبها ولم تُطابق", help: "ما كتبه المورد من أصناف ولم يطابق اسماً في الكتالوج: اربطه بيدك من «الأصناف التي يوفرها»." },
  { name: "x_origin_country_ids", ttype: "many2many", relation: "res.country", relation_table: "x_res_partner_origin_country_rel", column1: "partner_id", column2: "country_id", field_description: "المنشأ" },
  { name: "x_origin_text", ttype: "char", field_description: "المنشأ كما كُتب" },
  { name: "x_supplier_location", ttype: "char", field_description: "الموقع", help: "السوق المركزي ورقم المحل أو البسطة، أو المزرعة والمدينة." },
  { name: "x_supply_method", ttype: "selection", selection: sel(SUPPLY_METHODS), field_description: "طريقة التوريد" },
  { name: "x_pay_terms", ttype: "selection", selection: sel(PAY_TERMS), field_description: "شروط الدفع" },
  { name: "x_pay_days", ttype: "integer", field_description: "أيام الآجل" },
  { name: "x_min_qty_text", ttype: "char", field_description: "أقل كمية" },
  { name: "x_lead_time_text", ttype: "char", field_description: "مدة التجهيز" },
  { name: "x_contact_cadence", ttype: "selection", selection: sel(CADENCES), field_description: "إيقاع التواصل", help: "يكتبه الاعتماد من النوع حين يكون فارغاً: وكيل وتاجر يومي، موزّع ومستورد أسبوعي، مزارع شهري (وأسبوعي داخل موسمه)، مصاريف بلا تواصل." },
  { name: "x_next_contact", ttype: "date", field_description: "التواصل القادم", help: "يكتبه الوركر بعد كل تواصل دوري." },
  { name: "x_supplier_detail", ttype: "text", field_description: "تفاصيل التسجيل", help: "ما كتبه المورد في شاشة نوعه من نموذج التسجيل." },
  { name: "x_reply_rate", ttype: "float", field_description: "نسبة الرد ٪", help: "من طلبات الأسعار والتواصل في آخر 30 يوماً: كم منها ردّ عليه. يكتبها الوركر." },
  { name: "x_price_gap_pct", ttype: "float", field_description: "فرق سعره عن وسيط السوق ٪", help: "متوسط (سعره − وسيط السوق) ÷ وسيط السوق لأصنافه في آخر 30 يوماً. موجب = أغلى من السوق. يكتبه الوركر." },
  { name: "x_last_offer_text", ttype: "char", field_description: "آخر سعر/عرض", help: "آخر ما أرسله: الصنف والسعر واليوم. يكتبه الوركر." },
  { name: "x_supplier_registered_at", ttype: "datetime", field_description: "سجّل من واتساب" },
  { name: "x_supplier_invited_at", ttype: "datetime", field_description: "أُرسل له رابط التسجيل" },
  { name: "x_supplier_welcomed_at", ttype: "datetime", field_description: "أُرسل له الترحيب" },
  { name: "x_supplier_result", ttype: "char", field_description: "آخر نتيجة", help: "ما فعله آخر زر: يكتبه الوركر (حدّث الصفحة بعد الضغط بثوانٍ)." },
];
export const PARTNER_O2M = [
  { name: "x_season_ids", ttype: "one2many", relation: SEASON_MODEL, relation_field: "x_partner_id", field_description: "مواسم المورد" },
  { name: "x_capacity_ids", ttype: "one2many", relation: CAPACITY_MODEL, relation_field: "x_partner_id", field_description: "طاقة المورد" },
  { name: "x_offer_ids", ttype: "one2many", relation: OFFER_MODEL, relation_field: "x_source_partner_id", field_description: "عروضه وأسعاره" },
];

/** A month's measure of the seasons' pivot: 1 while the season covers it (a season that wraps the year too). */
const monthCode = (m) => `for r in self:
    a = int(r.x_month_from or 0)
    b = int(r.x_month_to or 0) or a
    r['x_m${m}'] = 1 if a and ((a <= ${Number(m)} and ${Number(m)} <= b) if a <= b else (${Number(m)} >= a or ${Number(m)} <= b)) else 0`;
export const SEASON_FIELDS = [
  { name: "x_partner_id", ttype: "many2one", relation: PARTNER, on_delete: "cascade", required: true, index: true, field_description: "المورد" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", on_delete: "set null", field_description: "الصنف" },
  { name: "x_item_text", ttype: "char", field_description: "الصنف كما كُتب" },
  { name: "x_month_from", ttype: "selection", selection: sel(MONTHS), field_description: "من شهر" },
  { name: "x_month_to", ttype: "selection", selection: sel(MONTHS), field_description: "إلى شهر" },
  { name: "x_expected_qty", ttype: "char", field_description: "الكمية المتوقعة" },
  { name: "x_note", ttype: "char", field_description: "ملاحظة" },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة" },
  ...MONTHS.map(([m, title]) => ({ name: `x_m${m}`, ttype: "integer", field_description: title, compute: monthCode(m), depends: "x_month_from,x_month_to", store: true, readonly: true })),
];
export const CAPACITY_FIELDS = [
  { name: "x_partner_id", ttype: "many2one", relation: PARTNER, on_delete: "cascade", required: true, index: true, field_description: "المورد" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", on_delete: "set null", field_description: "الصنف" },
  { name: "x_item_text", ttype: "char", field_description: "الصنف كما كُتب" },
  { name: "x_qty", ttype: "float", field_description: "الطاقة (كرتون)" },
  { name: "x_per", ttype: "selection", selection: sel(CAPACITY_PER), field_description: "لكل" },
  { name: "x_note", ttype: "char", field_description: "ملاحظة" },
  { name: "x_last_price", ttype: "float", field_description: "آخر سعر", help: "آخر سعر أرسله هذا المورد لهذا الصنف. يكتبه الوركر." },
  { name: "x_last_price_date", ttype: "date", field_description: "تاريخ آخر سعر" },
  { name: "x_reply_rate", ttype: "float", field_description: "نسبة الرد ٪", related: "x_partner_id.x_reply_rate", store: false, readonly: true },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة" },
];
/** «عروض المصادر»: the size and the origin of any observation, and what a supplier's own offer adds. */
export const OFFER_FIELDS = [
  { name: "x_offer_kind", ttype: "selection", selection: sel(OFFER_KINDS), field_description: "نوع العرض", help: "عرض مورد: المورد بادر به («📦 بضاعتي جاهزة» / «🚢 وصلت شحنة»). صنف إضافي: سطر زائد في نموذج الأسعار. كلاهما «خاص»: خارج حساب أسعار اليوم." },
  { name: "x_item_text", ttype: "char", field_description: "الصنف كما كُتب", help: "ما كتبه المصدر. إن لم يطابق الكتالوج فالصنف «غير مربوط»: اربطه من هنا." },
  { name: "x_item_size", ttype: "char", field_description: "المقاس" },
  { name: "x_item_origin", ttype: "char", field_description: "المنشأ" },
  { name: "x_ready_from", ttype: "date", field_description: "جاهز من" },
  { name: "x_ready_until", ttype: "date", field_description: "جاهز حتى" },
  { name: "x_offer_note", ttype: "char", field_description: "ملاحظة المورد" },
];
export const DAILY_FIELDS = [
  { name: "x_item_size", ttype: "char", field_description: "المقاس" },
  { name: "x_item_origin", ttype: "char", field_description: "المنشأ" },
];
export const CONFIG_FIELDS = [
  { name: "x_supplier_outreach", ttype: "boolean", field_description: "تفعيل تواصل الموردين", help: "مطفأ: لا رسالة دورية لأي مورد. مفعّل: بين 09:00 و18:00 — الموزّع والمستورد كل أحد، والمزارع أول الشهر (وكل أحد داخل موسمه): رسالة قصيرة بزر «عرض مورد»." },
];

/** The item of an offer the catalog did not match: an archived product no list reads, so the row keeps its required links. */
export const UNLINKED = { code: "UTAK-UNLINKED", name: "صنف من مورد (غير مربوط)", pack: "كما كُتب" };

// ---------------------------------------------------------------- the buttons

export const HOOK_PATH = "/odoo/hook/supplier";
export const PROD_HOST = "utak-worker.utak-business.workers.dev";
export const HOOKS = {
  invite: { name: "utak.supplier.invite_webhook", op: "invite" },
  welcome: { name: "utak.supplier.welcome_webhook", op: "welcome" },
};
export const CODE_ACTIONS = {
  approve: {
    name: "utak.supplier.approve", model: PARTNER,
    code: `CADENCE = ${JSON.stringify(CADENCE_BY_TYPE).replace(/"/g, "'")}
hook = env['ir.actions.server'].sudo().search([('name', '=', '${HOOKS.welcome.name}')], limit=1)
for rec in records:
    if rec.x_supplier_state == 'approved':
        continue
    vals = {'x_supplier_state': 'approved'}
    if not rec.x_contact_cadence and CADENCE.get(rec.x_supplier_type):
        vals['x_contact_cadence'] = CADENCE[rec.x_supplier_type]
    rec.write(vals)
    if hook:
        hook.with_context(active_model='res.partner', active_id=rec.id, active_ids=[rec.id]).run()`,
  },
  suspend: { name: "utak.supplier.suspend", model: PARTNER, code: "for rec in records:\n    rec.write({'x_supplier_state': 'suspended'})" },
};
/** § 65 ز — an edit of a line's price (or its quantity) presses the request's own «🔄 احسب». */
export const RECALC_HOOK_ACTION = "utak.special_quote.recalc_webhook";
export const LINE_ACTION = {
  name: "utak.special_quote_line.recalc_on_edit", model: LINE_MODEL,
  code: `hook = env['ir.actions.server'].sudo().search([('name', '=', '${RECALC_HOOK_ACTION}')], limit=1)
if hook:
    for q in records.mapped('x_quote_id'):
        hook.with_context(active_model='${QUOTE_MODEL}', active_id=q.id, active_ids=[q.id]).run()`,
};
export const LINE_AUTOMATION = { name: "utak.special_quote_line.recalc (on price edit)", model: LINE_MODEL, trigger: "on_write", fields: ["x_purchase_price", "x_final_price", "x_final_net", "x_qty"] };

// ---------------------------------------------------------------- the screens

export const PURCHASE_MENU = 547;          // UTAK ← 🛒 المشتريات
export const OLD_SUPPLIERS_MENU = 538;     // «الموردين» of before (Odoo's own partner list): off while the new one is on
export const SETTINGS_VIEW = 2855;
export const MENUS = {
  suppliers: { title: "🧑‍🌾 الموردون", sequence: 8 },
  offers: { title: "📥 عروض الموردين", sequence: 12 },
  seasons: { title: "📅 تقويم المواسم", sequence: 14 },
  capacity: { title: "📦 خريطة الطاقة", sequence: 16 },
};
export const ACTIONS = {
  suppliers: {
    name: "UTAK — الموردون", res_model: PARTNER, view_mode: "list,form",
    domain: "['|', '|', ('supplier_rank', '>', 0), ('x_price_source', '=', True), ('x_supplier_state', '!=', False)]",
    context: "{'search_default_g_type': 1, 'default_x_supplier_state': 'pending', 'default_x_contact_class': 'supplier'}",
    help: "<p>كل مورد ببطاقته: نوعه وحالته وأصنافه ومواسمه وطاقته وعروضه. مورد جديد يسجّل من واتساب («تسجيل مورد») أو تنشئ بطاقته برقمه وتضغط «📨 أرسل رابط التسجيل»، ثم «✅ اعتماد».</p>",
  },
  offers: {
    name: "UTAK — عروض الموردين", res_model: OFFER_MODEL, view_mode: "list,form",
    domain: "[('x_offer_kind', '=', 'supplier_offer')]", context: "{'create': False}",
    help: "<p>ما بادر به الموردون: «📦 بضاعتي جاهزة» و«🚢 وصلت شحنة». خارج حساب أسعار اليوم.</p>",
  },
  seasons: {
    name: "UTAK — تقويم المواسم", res_model: SEASON_MODEL, view_mode: "pivot,list,form", domain: "[]", context: "{}",
    help: "<p>الأصناف في الصفوف والأشهر في الأعمدة: الرقم = عدد الموردين الذين موسمهم يغطي الشهر.</p>",
  },
  capacity: {
    name: "UTAK — خريطة الطاقة", res_model: CAPACITY_MODEL, view_mode: "list,form", domain: "[]", context: "{'search_default_g_product': 1}",
    help: "<p>لكل صنف: من يوفره، وكم كرتوناً لكل يوم أو لكل دفعة، وآخر سعر له.</p>",
  },
};
export const VIEWS = {
  suppliersList: "utak.suppliers_list", suppliersSearch: "utak.suppliers_search", suppliersForm: "utak.supplier_form",
  offersList: "utak.supplier_offers_list", offersSearch: "utak.supplier_offers_search",
  seasonsPivot: "utak.supplier_seasons_pivot", seasonsList: "utak.supplier_seasons_list", seasonsSearch: "utak.supplier_seasons_search",
  capacityList: "utak.supplier_capacity_list", capacitySearch: "utak.supplier_capacity_search",
};

export const suppliersListArch = (a) => `<list string="الموردون" default_order="x_supplier_state, name" decoration-warning="x_supplier_state == 'pending'" decoration-muted="x_supplier_state == 'suspended'">
  <header>
    <button name="${a.approve}" type="action" string="✅ اعتماد"/>
    <button name="${a.suspend}" type="action" string="⛔ إيقاف"/>
    <button name="${a.invite}" type="action" string="📨 أرسل رابط التسجيل"/>
  </header>
  <field name="name" string="الاسم"/>
  <field name="x_supplier_type"/>
  <field name="x_supplier_state" widget="badge" decoration-success="x_supplier_state == 'approved'" decoration-warning="x_supplier_state == 'pending'" decoration-danger="x_supplier_state == 'suspended'"/>
  <field name="x_supplier_location"/>
  <field name="x_supplied_product_ids" widget="many2many_tags"/>
  <field name="x_last_offer_text"/>
  <field name="x_reply_rate"/>
  <field name="x_price_gap_pct"/>
  <field name="x_sp_remaining" string="المستحق"/>
  <field name="x_whatsapp_number" optional="hide"/>
  <field name="x_contact_cadence" optional="hide"/>
  <field name="x_next_contact" optional="hide"/>
</list>`;

export const SUPPLIERS_SEARCH_ARCH = `<search string="الموردون">
  <field name="name"/>
  <field name="x_supplied_product_ids"/>
  <field name="x_supplier_location"/>
  <filter name="f_pending" string="بانتظار الاعتماد" domain="[('x_supplier_state', '=', 'pending')]"/>
  <filter name="f_no_type" string="ناقص النوع" domain="[('x_supplier_type', '=', False)]"/>
  <filter name="f_approved" string="معتمد" domain="[('x_supplier_state', '=', 'approved')]"/>
  <filter name="f_suspended" string="موقوف" domain="[('x_supplier_state', '=', 'suspended')]"/>
  <separator/>
  <filter name="g_type" string="النوع" context="{'group_by': 'x_supplier_type'}"/>
  <filter name="g_state" string="الحالة" context="{'group_by': 'x_supplier_state'}"/>
</search>`;

/** The supplier's form: five tabs. `a` = the ids of the three actions its buttons call. */
export const supplierFormArch = (a) => `<form string="المورد">
  <header>
    <button name="${a.approve}" type="action" string="✅ اعتماد" class="btn-primary" invisible="x_supplier_state == 'approved'"/>
    <button name="${a.suspend}" type="action" string="⛔ إيقاف" invisible="x_supplier_state == 'suspended'" confirm="المورد الموقوف لا يصله طلب أسعار ولا تواصل دوري. متأكد؟"/>
    <button name="${a.invite}" type="action" string="📨 أرسل رابط التسجيل" confirm="يُرسل نموذج «تسجيل مورد» الآن إلى رقم الواتساب المكتوب في هذه البطاقة. متأكد؟"/>
    <field name="x_supplier_state" widget="statusbar" statusbar_visible="pending,approved,suspended"/>
  </header>
  <sheet>
    <div class="oe_title">
      <h1><field name="name" placeholder="الاسم التجاري" required="1"/></h1>
      <div class="text-muted"><field name="x_supplier_result" readonly="1"/></div>
    </div>
    <notebook>
      <page string="البيانات" name="data">
        <group>
          <group string="المورد">
            <field name="x_supplier_type"/>
            <field name="x_contact_name"/>
            <field name="x_whatsapp_number" placeholder="+9665XXXXXXXX"/>
            <field name="x_supplier_location"/>
            <field name="x_origin_country_ids" widget="many2many_tags" options="{'no_create': True}"/>
            <field name="x_origin_text"/>
          </group>
          <group string="التوريد والتواصل">
            <field name="x_supply_method"/>
            <field name="x_min_qty_text"/>
            <field name="x_lead_time_text"/>
            <field name="x_contact_cadence"/>
            <field name="x_next_contact"/>
            <field name="x_price_source"/>
            <field name="x_price_role" invisible="not x_price_source"/>
            <field name="x_reply_rate" readonly="1"/>
            <field name="x_price_gap_pct" readonly="1"/>
          </group>
        </group>
        <group string="تفاصيل التسجيل">
          <field name="x_supplier_detail" nolabel="1" colspan="2"/>
          <field name="x_supplier_registered_at" readonly="1"/>
          <field name="x_supplier_invited_at" readonly="1"/>
          <field name="x_supplier_welcomed_at" readonly="1"/>
        </group>
      </page>
      <page string="الأصناف والطاقة" name="items">
        <group>
          <field name="x_supplied_product_ids" widget="many2many_tags" options="{'no_create': True}"/>
          <field name="x_supplier_items_text"/>
        </group>
        <field name="x_capacity_ids">
          <list editable="bottom">
            <field name="x_product_tmpl_id" options="{'no_create': True}"/>
            <field name="x_item_text" optional="show"/>
            <field name="x_qty"/>
            <field name="x_per"/>
            <field name="x_last_price" readonly="1"/>
            <field name="x_last_price_date" readonly="1" optional="show"/>
            <field name="x_note"/>
          </list>
        </field>
      </page>
      <page string="المواسم" name="seasons">
        <field name="x_season_ids">
          <list editable="bottom">
            <field name="x_product_tmpl_id" options="{'no_create': True}"/>
            <field name="x_item_text" optional="show"/>
            <field name="x_month_from"/>
            <field name="x_month_to"/>
            <field name="x_expected_qty"/>
            <field name="x_note"/>
          </list>
        </field>
      </page>
      <page string="العروض والأسعار" name="offers">
        <group>
          <field name="x_last_offer_text" readonly="1"/>
          <field name="x_last_price_submission" readonly="1" string="آخر إرسال أسعار"/>
        </group>
        <field name="x_offer_ids" readonly="1">
          <list default_order="id desc" limit="40" decoration-muted="x_utak_simulation">
            <field name="x_date"/>
            <field name="x_offer_kind"/>
            <field name="x_product_tmpl_id"/>
            <field name="x_item_text" optional="show"/>
            <field name="x_special_unit" string="التعبئة" optional="show"/>
            <field name="x_purchase_price"/>
            <field name="x_market_price"/>
            <field name="x_item_size"/>
            <field name="x_item_origin"/>
            <field name="x_available_qty" optional="show"/>
            <field name="x_ready_from" optional="show"/>
            <field name="x_ready_until" optional="show"/>
            <field name="x_utak_simulation" optional="hide"/>
          </list>
        </field>
      </page>
      <page string="الدفع" name="pay">
        <group>
          <group string="الشروط">
            <field name="x_pay_terms"/>
            <field name="x_pay_days" invisible="x_pay_terms != 'credit'"/>
            <field name="x_iban"/>
            <field name="vat" string="الرقم الضريبي"/>
          </group>
          <group string="الحساب">
            <field name="x_sp_due_total"/>
            <field name="x_sp_paid_total"/>
            <field name="x_sp_remaining"/>
          </group>
        </group>
        <field name="x_sp_due_ids" readonly="1">
          <list default_order="x_date desc, id desc">
            <field name="x_date"/>
            <field name="x_purchase_list_id"/>
            <field name="x_amount" sum="المجموع"/>
          </list>
        </field>
        <field name="x_sp_payment_ids" readonly="1">
          <list default_order="x_date desc, id desc" decoration-muted="x_state == 'rejected'">
            <field name="x_name"/>
            <field name="x_date"/>
            <field name="x_amount"/>
            <field name="x_method"/>
            <field name="x_state"/>
          </list>
        </field>
      </page>
    </notebook>
  </sheet>
</form>`;

export const OFFERS_LIST_ARCH = `<list string="عروض الموردين" create="0" default_order="id desc" decoration-muted="x_utak_simulation">
  <field name="create_date" string="وصل"/>
  <field name="x_source_partner_id" string="المورد"/>
  <field name="x_product_tmpl_id"/>
  <field name="x_item_text"/>
  <field name="x_available_qty"/>
  <field name="x_purchase_price" string="السعر"/>
  <field name="x_special_unit" string="التعبئة"/>
  <field name="x_item_size"/>
  <field name="x_item_origin"/>
  <field name="x_ready_from"/>
  <field name="x_ready_until"/>
  <field name="x_offer_note" optional="show"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`;
export const OFFERS_SEARCH_ARCH = `<search string="عروض الموردين">
  <field name="x_source_partner_id" string="المورد"/>
  <field name="x_product_tmpl_id"/>
  <field name="x_item_text"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '!=', True)]"/>
  <filter name="f_unlinked" string="صنف غير مربوط" domain="[('x_product_tmpl_id.default_code', '=', '${UNLINKED.code}')]"/>
  <separator/>
  <filter name="g_source" string="المورد" context="{'group_by': 'x_source_partner_id'}"/>
  <filter name="g_product" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
</search>`;

export const SEASONS_PIVOT_ARCH = `<pivot string="تقويم المواسم" disable_linking="1">
  <field name="x_product_tmpl_id" type="row"/>
${MONTHS.map(([m]) => `  <field name="x_m${m}" type="measure"/>`).join("\n")}
</pivot>`;
export const SEASONS_LIST_ARCH = `<list string="مواسم المورد" editable="bottom" default_order="${SEASON_ORDER}" decoration-muted="x_utak_simulation">
  <field name="x_partner_id" options="{'no_create': True}"/>
  <field name="x_product_tmpl_id" options="{'no_create': True}"/>
  <field name="x_item_text" optional="show"/>
  <field name="x_month_from"/>
  <field name="x_month_to"/>
  <field name="x_expected_qty"/>
  <field name="x_note"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`;
export const SEASONS_SEARCH_ARCH = `<search string="مواسم المورد">
  <field name="x_partner_id"/>
  <field name="x_product_tmpl_id"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '!=', True)]"/>
  <separator/>
  <filter name="g_product" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
  <filter name="g_partner" string="المورد" context="{'group_by': 'x_partner_id'}"/>
</search>`;

export const CAPACITY_LIST_ARCH = `<list string="خريطة الطاقة" editable="bottom" default_order="${CAPACITY_ORDER}" decoration-muted="x_utak_simulation">
  <field name="x_product_tmpl_id" options="{'no_create': True}"/>
  <field name="x_item_text" optional="hide"/>
  <field name="x_partner_id" string="المورد" options="{'no_create': True}"/>
  <field name="x_qty" string="الطاقة (كرتون)"/>
  <field name="x_per"/>
  <field name="x_last_price" readonly="1"/>
  <field name="x_last_price_date" readonly="1" optional="show"/>
  <field name="x_reply_rate"/>
  <field name="x_note" optional="show"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`;
export const CAPACITY_SEARCH_ARCH = `<search string="خريطة الطاقة">
  <field name="x_product_tmpl_id"/>
  <field name="x_partner_id"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '!=', True)]"/>
  <separator/>
  <filter name="g_product" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
  <filter name="g_partner" string="المورد" context="{'group_by': 'x_partner_id'}"/>
</search>`;

/** The size and the origin beside the price, on the four lists that show a source's price. */
const sizeOrigin = (after) => `<data>
  <xpath expr="//field[@name='${after}']" position="after">
    <field name="x_item_size" optional="show"/>
    <field name="x_item_origin" optional="show"/>
  </xpath>
</data>`;
export const EXTENSIONS = {
  "utak.price_offer_list.s65_size": { parent: "utak.price_offer_list", model: OFFER_MODEL, arch: `<data>
  <xpath expr="//field[@name='x_market_price']" position="after">
    <field name="x_item_size" optional="show"/>
    <field name="x_item_origin" optional="show"/>
    <field name="x_offer_kind" optional="show"/>
    <field name="x_item_text" optional="hide"/>
  </xpath>
</data>` },
  "utak.pricing_market_list.s65_size": { parent: "utak.pricing_market_list", model: OFFER_MODEL, arch: sizeOrigin("x_purchase_price") },
  "x_daily_price.list.v3.s65_size": { parent: "x_daily_price.list.v3", model: DAILY_MODEL, arch: sizeOrigin("x_price_sar") },
  "utak.pricing_purchase_list.s65_size": { parent: "utak.pricing_purchase_list", model: DAILY_MODEL, arch: sizeOrigin("x_price_sar") },
  "utak.pricing_settings_form.s65_outreach": { parent: "utak.pricing_settings_form", model: CONFIG_MODEL, arch: `<data>
  <xpath expr="//div[@name='utak_source_roles']" position="after">
    <group name="utak_supplier_outreach" string="تواصل الموردين"><field name="x_supplier_outreach" widget="boolean_toggle"/></group>
    <div class="text-muted mb-2">مطفأ = لا رسالة دورية لأي مورد. مفعّل: بين 09:00 و18:00 — الموزّع والمستورد كل أحد، والمزارع أول الشهر (وكل أحد داخل موسمه)، رسالة قصيرة بزر «عرض مورد». لا يصل «موقوفاً» ولا «بانتظار الاعتماد» شيء.</div>
  </xpath>
</data>` },
};

/** The partners this order classifies (and nothing else): #55 by its tag, Ahmad and Raed approved with no type. */
export const EXPENSE_TAG = 1;
export const DATA = [
  { id: 55, name: "مصروفات نقدية متنوعة", vals: { x_supplier_type: "expense" } },
  { id: 30, name: "أحمد حسان", vals: { x_supplier_state: "approved" } },
  { id: 109, name: "رائد", vals: { x_supplier_state: "approved" } },
];
