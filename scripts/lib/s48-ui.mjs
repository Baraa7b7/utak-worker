// § 48 و (2026-10-01) — UTAK ← «💲 التسعير»: everything about pricing in one menu, five screens.
// The names, the computed fields' Python, the server actions' code and the views' arch — one source
// for scripts/s48-20261001-ui.mjs (which writes them to the tenant), scripts/archive/s48-20261001-shots.mts
// (which measures their contrast) and tests/s48.test.mts (which runs the Python in python3 and
// reads the arch). Changing a string here changes nothing in Odoo until the setup script is
// re-applied (its --verify compares what the tenant stores with this file).
import { DAY_NOTE, SETTINGS_NOTE } from "./s48-odoo-views.mjs";

export const MENU = { root: "💲 التسعير", today: "📊 اليوم", days: "📅 الأيام السابقة", sources: "📥 عروض المصادر", products: "📦 الأصناف", settings: "⚙️ الإعدادات" };
/** The pricing menus of before § 48: hidden (active = false), never deleted. [id, the name the tenant carried] */
export const OLD_MENUS = [
  [572, "💰 أسعار اليوم"], [581, "📊 لوحة التسعير"], [577, "💰 التكاليف التشغيلية"], [578, "⚙️ إعدادات التسعير"],
  [553, "طلبات الأسعار اليومية"], [535, "الأسعار اليومية"], [579, "عروض المصادر اليومية"], [573, "سجل أسعار الأيام"],
  [537, "معاملات التسعير"], [555, "الأصناف"], [556, "التغليف"],
];
/** The categories of the produce (the category itself or a parent gives the reference, § 46 ب). */
export const REF_CATEGORIES = ["فواكه", "خضار", "ورقيات"];
export const OUTLIER_RATIO = 1.5;

export const VIEW = {
  day: "utak.price_day_form", dayList: "utak.price_day_list", daySearch: "utak.price_day_search", dayGraph: "utak.pricing_days_graph",
  confirm: "utak.pricing_publish_confirm", sources: "utak.pricing_sources_form",
  purchaseList: "utak.pricing_purchase_list", purchaseSearch: "utak.pricing_purchase_search", marketList: "utak.pricing_market_list", marketSearch: "utak.pricing_market_search",
  products: "utak.pricing_products_list", productsSearch: "utak.pricing_products_search", settings: "utak.pricing_settings_form",
};
export const ACTION = {
  openDay: "utak.board.open_today", openDayOld: "utak.prices.open_today", prev: "utak.board.prev_day", next: "utak.board.next_day",
  openSources: "utak.pricing.open_sources", confirm: "utak.pricing.publish_confirm", settings: "utak.pricing.open_settings",
  purchaseList: "utak.pricing.sources_purchase_list", marketList: "utak.pricing.sources_market_list",
  refresh: "utak.prices.refresh_webhook", approve: "utak.prices.approve", unapprove: "utak.prices.unapprove",
};
export const WINDOW = { days: "UTAK — سجل أسعار الأيام", products: "UTAK — أصناف التسعير", packagings: "UTAK — كل التعبئات", profitGraph: "UTAK — ربح الأصناف عبر الأيام" };

// ---------------------------------------------------------------- the computed fields (Python Odoo runs)
const RIYADH_TODAY = "(datetime.datetime.now() + datetime.timedelta(hours=3)).date()";
const PUBLISHABLE = "record.x_line_ids.filtered(lambda l: l.x_status in ('auto', 'manual') and not l.x_excluded and l.x_sale_price > 0)";
export const IS_TODAY_CODE = `today = ${RIYADH_TODAY}
for record in self:
    record['x_is_today'] = bool(record.x_date) and record.x_date == today`;
export const N_PUBLISHABLE_CODE = `for record in self:
    record['x_n_publishable'] = len(${PUBLISHABLE})`;
export const PUBLISH_NAMES_CODE = `for record in self:
    lines = ${PUBLISHABLE}
    record['x_publish_names'] = '، '.join(['%s %.2f' % (l.x_name or '', l.x_sale_price) for l in lines]) or '—'`;
/** The day's offers of the sources, real ones only: the suppliers' purchase replies, the market observations, the asks sent that Riyadh day. */
export const SRC_PURCHASE_CODE = `Row = self.env['x_daily_price']
for record in self:
    record['x_src_purchase_ids'] = Row.search([('x_date', '=', record.x_date), ('x_utak_simulation', '!=', True)], order='x_supplier_id, id') if record.x_date else Row`;
export const SRC_MARKET_CODE = `Row = self.env['x_price_offer']
for record in self:
    record['x_src_market_ids'] = Row.search([('x_date', '=', record.x_date), ('x_utak_simulation', '!=', True)], order='x_source_partner_id, id') if record.x_date else Row`;
export const SRC_ASK_CODE = `Row = self.env['x_supplier_price_request_log']
for record in self:
    if record.x_date:
        start = datetime.datetime.combine(record.x_date, datetime.time(0, 0, 0)) - datetime.timedelta(hours=3)
        record['x_src_ask_ids'] = Row.search([('x_sent_at', '>=', start), ('x_sent_at', '<', start + datetime.timedelta(days=1)), ('x_utak_simulation', '!=', True), ('x_is_simulation', '!=', True)], order='x_sent_at, id')
    else:
        record['x_src_ask_ids'] = Row`;
export const DAY_COST_NOTE_CODE = `Day = self.env['x_price_day']
for record in self:
    d = Day.search([('x_utak_simulation', '!=', True), ('x_board_at', '!=', False)], order='x_date desc, id desc', limit=1)
    if d:
        record['x_day_cost_note'] = 'تكلفة اليوم المحسوبة: %.2f ر.س ليوم %s، وحصة الكرتون %.2f ر.س — كما حسبها النظام آخر مرة. تعديل بند هنا يظهر بعد «🔄 إعادة الحساب» في «📊 اليوم».' % (d.x_op_cost, d.x_date, d.x_op_share)
    else:
        record['x_day_cost_note'] = 'لم تُحسب تكلفة يوم بعد.'`;
export const PACK_CODE = `for record in self:
    packs = record.x_packaging_ids.sorted(key=lambda k: (k.x_sequence or 0, k.id))
    record['x_pack_id'] = packs.filtered(lambda k: k.x_is_default)[:1] or packs[:1]`;
/**
 * «الناقص» of a product — the same list as Baraa's «🆕 صنف جديد» alert (src/product-setup.ts
 * missingOnProduct; tests/s48.test.mts runs both on the same products): the category (فواكه / خضار /
 * ورقيات, itself or a parent), the supplier, «نشط للبيع», the default packaging (none; a carton
 * still at the temporary 8 kg; a weighed packaging without a weight), the English name.
 */
export const MISSING_LABEL = { category: "الفئة", supplier: "المورد", forSale: "نشط للبيع", noPack: "التعبئة", tempWeight: "وزن الكرتون (8 مؤقت)", noWeight: "وزن التعبئة", english: "الاسم بالإنجليزي" };
export const MISSING_CODE = `REF = (${REF_CATEGORIES.map((c) => `'${c}'`).join(", ")})
for record in self:
    out = []
    c = record.categ_id
    ok = False
    hops = 0
    while c and not ok and hops < 20:
        ok = (c.name or '').strip() in REF
        c = c.parent_id
        hops += 1
    if not ok:
        out.append('${MISSING_LABEL.category}')
    if not record.x_supplier_ids:
        out.append('${MISSING_LABEL.supplier}')
    if not record.x_is_active_for_sale:
        out.append('${MISSING_LABEL.forSale}')
    packs = record.x_packaging_ids.sorted(key=lambda k: (k.x_sequence or 0, k.id))
    d = packs.filtered(lambda k: k.x_is_default)[:1] or packs[:1]
    if not d:
        out.append('${MISSING_LABEL.noPack}')
    elif d.x_type == 'carton' and d.x_approx_weight_kg == 8:
        out.append('${MISSING_LABEL.tempWeight}')
    elif d.x_type in ('carton', 'bag', 'foam') and not (d.x_approx_weight_kg > 0):
        out.append('${MISSING_LABEL.noWeight}')
    if not (record.x_name_en or '').strip():
        out.append('${MISSING_LABEL.english}')
    record['x_missing'] = '، '.join(out) if out else False`;

export const DAY_FIELDS = [
  { name: "x_is_today", ttype: "boolean", field_description: "سجل اليوم", compute: IS_TODAY_CODE, depends: "x_date", store: false, readonly: true },
  { name: "x_n_publishable", ttype: "integer", field_description: "الأصناف التي ستُنشر", compute: N_PUBLISHABLE_CODE, depends: "x_line_ids.x_status,x_line_ids.x_excluded,x_line_ids.x_sale_price", store: false, readonly: true, help: "الأصناف المعتمدة (تلقائياً أو منك) بسعر بيع: ما يرسله «نشر المعتمد الآن»." },
  { name: "x_publish_names", ttype: "char", field_description: "الأصناف وأسعارها", compute: PUBLISH_NAMES_CODE, depends: "x_line_ids.x_status,x_line_ids.x_excluded,x_line_ids.x_sale_price,x_line_ids.x_name", store: false, readonly: true },
  { name: "x_n_recipients", ttype: "integer", field_description: "العملاء الذين ستصلهم الأسعار", help: "يكتبه الوركر مع كل حساب لليوم: عدد العملاء في قائمة نشر الأسعار (برقم واتساب، غير موقوفين، وليسوا من الفريق)." },
  { name: "x_src_purchase_ids", ttype: "many2many", relation: "x_daily_price", field_description: "ردود الشراء", compute: SRC_PURCHASE_CODE, depends: "x_date", store: false, readonly: true },
  { name: "x_src_market_ids", ttype: "many2many", relation: "x_price_offer", field_description: "مشاهدات السوق", compute: SRC_MARKET_CODE, depends: "x_date", store: false, readonly: true },
  { name: "x_src_ask_ids", ttype: "many2many", relation: "x_supplier_price_request_log", field_description: "طلبات الأسعار", compute: SRC_ASK_CODE, depends: "x_date", store: false, readonly: true },
];
export const CFG_UI_FIELDS = [
  { name: "x_outlier_ratio", ttype: "float", field_description: "نسبة السعر الشاذ",
    help: "سعر يتحرك هذا العدد من المرات (أو أكثر) عن آخر سعر للمصدر نفسه، صعوداً أو نزولاً، يُعلَّم «شاذ» ويصير استثناء. 1.5 = فرق 50٪. قيمة ليست أكبر من 1 تعني 1.5." },
  { name: "x_day_cost_note", ttype: "char", field_description: "تكلفة اليوم المحسوبة", compute: DAY_COST_NOTE_CODE, depends: "x_name", store: false, readonly: true },
];
export const COST_FIELDS = [
  { name: "x_config_id", ttype: "many2one", relation: "x_pricing_config", field_description: "إعدادات التسعير", on_delete: "set null",
    help: "يربط البند بسجل إعدادات التسعير ليُعرض ويُعدَّل داخل «💲 التسعير» ← «⚙️ الإعدادات». لا أثر له على الحساب." },
];
export const CFG_COST_LINES = { name: "x_cost_line_ids", ttype: "one2many", relation: "x_operating_cost", relation_field: "x_config_id", field_description: "التكاليف التشغيلية" };
export const PRODUCT_FIELDS = [
  // stored: Odoo refuses a related field through a many2one that is not searchable
  { name: "x_pack_id", ttype: "many2one", relation: "x_product_packaging", field_description: "التعبئة الافتراضية", compute: PACK_CODE, depends: "x_packaging_ids,x_packaging_ids.x_is_default,x_packaging_ids.x_sequence", store: true, readonly: true, on_delete: "set null" },
  { name: "x_pack_weight", ttype: "float", field_description: "وزن التعبئة (كجم)", related: "x_pack_id.x_approx_weight_kg", store: false, readonly: false },
  { name: "x_pack_type", ttype: "selection", field_description: "نوع التعبئة", related: "x_pack_id.x_type", store: false, readonly: false },
  { name: "x_missing", ttype: "char", field_description: "الناقص", compute: MISSING_CODE, store: true, readonly: true,
    depends: "categ_id,categ_id.name,categ_id.parent_id,x_supplier_ids,x_is_active_for_sale,x_name_en,x_packaging_ids.x_is_default,x_packaging_ids.x_type,x_packaging_ids.x_approx_weight_kg,x_packaging_ids.x_sequence",
    help: "ما ينقص بطاقة الصنف، بمعيار تنبيه «🆕 صنف جديد» نفسه: الفئة، والمورد، و«نشط للبيع»، والتعبئة ووزنها، والاسم بالإنجليزي. فارغ = مكتمل." },
];

// ---------------------------------------------------------------- the server actions (Python Odoo runs)
const openForm = (id, view, name, extra = "") => `action = {'type': 'ir.actions.act_window', 'name': ${name}, 'res_model': 'x_price_day', 'res_id': ${id}, 'view_mode': 'form', 'views': [[${view}, 'form']], 'target': 'current'${extra}}`;
const pick = (v) => `sources = ${v.forceSources ? "True" : "env.context.get('utak_view') == 'sources'"}
view = ${v.sources} if sources else ${v.day}
name = '${MENU.sources}' if sources else '${MENU.today}'`;
/** «📊 اليوم» (and «📥 عروض المصادر»): today's record, else the last day before it with a clear note. Never creates a record. */
export const openDayCode = (v) => `Day = env['x_price_day']
today = ${RIYADH_TODAY}
rec = Day.search([('x_date', '=', today), ('x_utak_simulation', '=', False)], order='id', limit=1)
missing = not rec
if not rec:
    rec = Day.search([('x_date', '<', today), ('x_utak_simulation', '=', False)], order='x_date desc, id desc', limit=1)
if not rec:
    raise UserError('لا يوجد سجل أسعار بعد: يبنيه النظام مع أول سعر يصل.')
${pick(v)}
${openForm("rec.id", "view", "name", ", 'context': {'utak_no_today': missing, 'utak_view': 'sources' if sources else 'day'}")}`;
export const stepDayCode = (v, dir) => `Day = env['x_price_day']
rec = Day.search([('x_date', '${dir === "prev" ? "<" : ">"}', record.x_date), ('x_utak_simulation', '=', False)], order='${dir === "prev" ? "x_date desc, id desc" : "x_date asc, id asc"}', limit=1)
if not rec:
    raise UserError('لا يوم ${dir === "prev" ? "قبل" : "بعد"} %s.' % record.x_date)
${pick(v)}
${openForm("rec.id", "view", "name", ", 'context': {'utak_no_today': False, 'utak_view': 'sources' if sources else 'day'}")}`;
/** «نشر المعتمد الآن»: the confirmation first — it names how many items go to how many customers. */
export const confirmCode = (v) => `if record.x_state not in ('draft', 'missed'):
    raise UserError('لا يُنشر إلا سجل «مسودة» أو «فات الموعد».')
action = {'type': 'ir.actions.act_window', 'name': 'تأكيد النشر', 'res_model': 'x_price_day', 'res_id': record.id, 'view_mode': 'form', 'views': [[${v.confirm}, 'form']], 'target': 'new'}`;
/** «⚙️ الإعدادات»: the active settings record, with every operating cost line attached to it (they are edited inside it). */
export const settingsCode = (v) => `now = datetime.datetime.now() + datetime.timedelta(hours=3)
today = now.date()
rec = env['x_pricing_config'].search([('x_is_active', '=', True), ('x_active_from', '<=', today), '|', ('x_active_to', '=', False), ('x_active_to', '>=', today)], order='x_active_from desc, id desc', limit=1)
if not rec:
    raise UserError('لا يوجد إعداد تسعير فعّال اليوم.')
stray = env['x_operating_cost'].search([('x_config_id', '!=', rec.id)])
if stray:
    stray.write({'x_config_id': rec.id})
action = {'type': 'ir.actions.act_window', 'name': '${MENU.settings}', 'res_model': 'x_pricing_config', 'res_id': rec.id, 'view_mode': 'form', 'views': [[${v.settings}, 'form']], 'target': 'current'}`;
/** «فتح مجمّعة بالمصدر»: the day's rows as a list of their own, grouped by source, the simulation left out by a filter. */
export const sourcesListCode = (v, kind) => kind === "purchase"
  ? `action = {'type': 'ir.actions.act_window', 'name': 'ردود الشراء — %s' % record.x_date, 'res_model': 'x_daily_price', 'view_mode': 'list,form', 'views': [[${v.purchaseList}, 'list'], [False, 'form']], 'search_view_id': [${v.purchaseSearch}, 'search'], 'domain': [('x_date', '=', record.x_date)], 'context': {'search_default_f_real': 1, 'search_default_g_source': 1, 'default_x_date': str(record.x_date), 'default_x_extraction_status': 'confirmed'}, 'target': 'current'}`
  : `action = {'type': 'ir.actions.act_window', 'name': 'مشاهدات السوق — %s' % record.x_date, 'res_model': 'x_price_offer', 'view_mode': 'list', 'views': [[${v.marketList}, 'list']], 'search_view_id': [${v.marketSearch}, 'search'], 'domain': [('x_date', '=', record.x_date)], 'context': {'search_default_f_real': 1, 'search_default_g_source': 1}, 'target': 'current'}`;

// ---------------------------------------------------------------- the views
/** The other four screens, one tap away from any of them. `a`: the actions' ids. */
export const navRow = (a, here) => `<div class="d-flex flex-wrap gap-1 mb-2" name="utak_pricing_nav">
      ${[["today", a.openDay, MENU.today], ["days", a.days, MENU.days], ["sources", a.openSources, MENU.sources], ["products", a.products, MENU.products], ["settings", a.settings, MENU.settings]]
    .filter(([k]) => k !== here).map(([k, id, label]) => `<button name="${id}" type="action" string="${label}" class="btn btn-link px-2"${k === "today" ? ` context="{'utak_view': 'day'}"` : ""}/>`).join("\n      ")}
    </div>`;
const dayBanners = `<field name="x_is_today" invisible="1"/>
    <div class="alert alert-warning" role="alert" invisible="not context.get('utak_no_today')">لا يوجد سجل أسعار لليوم بعد (يبنيه النظام مع أول سعر يصل، أو عند 04:00). المعروض آخر يوم مسجَّل.</div>
    <div class="alert alert-info" role="status" invisible="x_is_today or context.get('utak_no_today')">هذا يوم سابق، وليس اليوم.</div>`;
const dayButtons = (a, view) => `<button name="${a.prev}" type="action" string="◀ اليوم السابق" context="{'utak_view': '${view}'}"/>
    <button name="${view === "sources" ? a.openSources : a.openDay}" type="action" string="اليوم" context="{'utak_view': '${view}'}" invisible="x_is_today"/>
    <button name="${a.next}" type="action" string="اليوم التالي ▶" context="{'utak_view': '${view}'}"/>`;

/** The line's card on a phone: the status in words and a coloured side border (§ 46), «—» for a value that does not exist. */
export const LINE_CARD = `<t t-name="card">
          <div t-attf-class="border-start border-5 ps-3 pe-1 #{record.x_board_status.raw_value == 'green' ? 'border-success' : record.x_board_status.raw_value == 'yellow' ? 'border-warning' : record.x_board_status.raw_value == 'red' ? 'border-danger' : 'border-secondary'}">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <field name="x_name" class="fw-bold fs-5"/>
              <field name="x_board_status" class="text-nowrap ms-2"/>
            </div>
            <div class="d-flex justify-content-between"><span class="text-muted">الشراء</span><field name="x_cost_show"/></div>
            <div class="d-flex justify-content-between"><span class="text-muted">السوق</span><field name="x_market_show"/></div>
            <div class="d-flex justify-content-between"><span class="text-muted">بدون خسارة</span><field name="x_even_show"/></div>
            <div class="d-flex justify-content-between fw-bold"><span>المقترح</span><field name="x_suggested_show"/></div>
            <div class="d-flex justify-content-between"><span class="text-muted">البيع</span><field name="x_sale_show"/></div>
            <div class="d-flex justify-content-between fw-bold border-top mt-1 pt-1"><span>الربح / المعاينة</span><span t-attf-class="#{!record.x_sale_price.raw_value and record.x_preview_sale.raw_value ? 'fst-italic' : ''}"><field name="x_profit_show"/></span></div>
            <div class="d-flex justify-content-between mt-1"><span class="text-muted">الحالة</span><field name="x_status"/></div>
            <div t-if="record.x_reason.raw_value"><field name="x_reason"/></div>
            <div class="d-flex justify-content-between"><span class="text-muted">قرار براء</span><span><field name="x_decision"/><t t-if="!record.x_decision.raw_value">—</t></span></div>
            <div class="d-flex justify-content-between"><span class="text-muted">السعر المعدّل</span><field name="x_manual_show"/></div>
          </div>
        </t>`;
/** The lines on a wide screen: one editable table — «قرار براء» and «السعر المعدّل» are chosen in the row itself. */
export const LINE_LIST = `<list editable="bottom" create="0" delete="0" decoration-danger="x_status == 'exception'" decoration-success="x_status == 'manual'" decoration-muted="x_status == 'unpublished'">
        <field name="x_sequence" column_invisible="1"/>
        <field name="x_market_price" column_invisible="1"/>
        <field name="x_sale_price" column_invisible="1"/>
        <field name="x_preview_sale" column_invisible="1"/>
        <field name="x_product_tmpl_id" string="الصنف" readonly="1"/>
        <field name="x_packaging_id" string="التعبئة" readonly="1"/>
        <field name="x_cost_show" string="الشراء"/>
        <field name="x_supplier_id" string="المصدر" readonly="1" optional="show"/>
        <field name="x_market_show" string="السوق"/>
        <field name="x_market_count" string="المشاهدات" readonly="1" optional="show"/>
        <field name="x_even_show" string="بدون خسارة"/>
        <field name="x_suggested_show" string="المقترح"/>
        <field name="x_sale_show" string="البيع"/>
        <field name="x_profit_show" string="الربح / المعاينة" decoration-it="not x_sale_price and x_preview_sale"/>
        <field name="x_board_status" string="اللوحة" readonly="1" optional="show"/>
        <field name="x_status" string="الحالة" readonly="1"/>
        <field name="x_reason" string="السبب" readonly="1"/>
        <field name="x_decision" string="قرار براء"/>
        <field name="x_manual_price" string="السعر المعدّل" invisible="x_decision != 'edit' and not x_manual_price"/>
        <field name="x_offers" string="عروض المصادر" readonly="1" optional="hide"/>
      </list>`;
/** A line opened from its card (a phone): the numbers, and the decision. */
export const LINE_FORM = `<form string="سطر السعر">
        <sheet>
          <div class="oe_title"><h2><field name="x_name" readonly="1"/></h2></div>
          <group>
            <group string="الأرقام">
              <field name="x_cost_show" string="الشراء"/>
              <field name="x_supplier_id" string="المصدر" readonly="1"/>
              <field name="x_market_show" string="السوق"/>
              <field name="x_market_count" string="المشاهدات" readonly="1"/>
              <field name="x_even_show" string="بدون خسارة"/>
              <field name="x_suggested_show" string="المقترح"/>
              <field name="x_sale_show" string="البيع"/>
              <field name="x_profit_show" string="الربح / المعاينة"/>
            </group>
            <group string="القرار">
              <field name="x_board_status" string="اللوحة" readonly="1"/>
              <field name="x_status" string="الحالة" readonly="1"/>
              <field name="x_reason" string="السبب" readonly="1"/>
              <field name="x_decision" string="قرار براء"/>
              <field name="x_manual_price" string="السعر المعدّل" invisible="x_decision != 'edit' and not x_manual_price"/>
            </group>
          </group>
        </sheet>
      </form>`;

/** 1. «📊 اليوم»: the day's header, its lines, the decision in the row, «🔄 إعادة الحساب», «نشر المعتمد الآن», the days before and after. */
export const dayForm = (a) => `<form string="${MENU.today}" create="0" delete="0">
  <header>
    <button name="${a.refresh}" type="action" string="🔄 إعادة الحساب" class="btn-primary" invisible="x_state not in ('draft', 'missed')"/>
    <button name="${a.confirm}" type="action" string="نشر المعتمد الآن" invisible="x_state not in ('draft', 'missed')"/>
    <button name="${a.unapprove}" type="action" string="إلغاء الاعتماد" invisible="x_state != 'approved'"/>
    ${dayButtons(a, "day")}
    <field name="x_state" widget="statusbar" statusbar_visible="draft,approved,published"/>
  </header>
  <sheet>
    ${navRow(a, "today")}
    ${dayBanners}
    <div class="oe_title"><h1>${MENU.today} — <field name="x_date" readonly="1" class="oe_inline"/></h1></div>
    <group>
      <group string="تكلفة التشغيل">
        <field name="x_op_cost" string="تكلفة اليوم" readonly="1"/>
        <field name="x_op_share" string="حصة الكرتون" readonly="1"/>
        <field name="x_op_basis" string="أساس الحصة" readonly="1"/>
        <field name="x_op_expected" readonly="1" invisible="x_op_basis == 'actual'"/>
        <field name="x_op_cartons" readonly="1" invisible="x_op_basis != 'actual'"/>
      </group>
      <group string="الأصناف والاعتماد">
        <label for="x_n_green" string="الأصناف"/>
        <div>🟢 <field name="x_n_green" readonly="1" class="oe_inline"/> · 🟡 <field name="x_n_yellow" readonly="1" class="oe_inline"/> · 🔴 <field name="x_n_red" readonly="1" class="oe_inline"/> · ⚪ <field name="x_n_none" readonly="1" class="oe_inline"/></div>
        <field name="x_approved_at" string="وقت الاعتماد" readonly="1"/>
        <field name="x_published_at" string="وقت النشر" readonly="1"/>
        <field name="x_board_at" string="آخر حساب" readonly="1"/>
      </group>
    </group>
    <div class="alert alert-info" role="status" invisible="not x_op_share_500">مقارنة: لو كانت الكراتين 500 يومياً، حصة الكرتون <field name="x_op_share_500" readonly="1" class="oe_inline fw-bold"/> ر.س.</div>
    <div class="alert alert-warning" role="status" invisible="not x_board_note"><field name="x_board_note" readonly="1" class="oe_inline"/></div>
    <div class="text-muted mb-2">${DAY_NOTE}</div>
    <field name="x_line_ids" readonly="x_state not in ('draft', 'missed')" mode="list,kanban">
      ${LINE_LIST}
      <kanban create="0" delete="0">
        <field name="x_board_status"/>
        <field name="x_sale_price"/>
        <field name="x_preview_sale"/>
        <field name="x_reason"/>
        <field name="x_decision"/>
        <templates>
        ${LINE_CARD}
        </templates>
      </kanban>
      ${LINE_FORM}
    </field>
    <group string="تقرير النشر" invisible="not x_publish_report">
      <field name="x_publish_report" nolabel="1" readonly="1" colspan="2"/>
    </group>
  </sheet>
</form>`;

/** The confirmation of «نشر المعتمد الآن»: it sends for real, so it says to how many. */
export const confirmForm = (a) => `<form string="تأكيد النشر" create="0" delete="0" edit="0">
  <sheet>
    <div class="alert alert-warning" role="alert"><strong>هذا يرسل رسائل واتساب فعلية للعملاء الآن، ولا يُتراجع عنه.</strong></div>
    <group>
      <field name="x_date" string="أسعار يوم" readonly="1"/>
      <field name="x_n_publishable" string="الأصناف التي ستُنشر" readonly="1"/>
      <field name="x_n_recipients" string="العملاء الذين ستصلهم" readonly="1"/>
      <field name="x_publish_names" string="الأصناف وأسعارها" readonly="1"/>
    </group>
    <div class="alert alert-info" role="status" invisible="x_n_recipients">عدد العملاء لم يُحسب لهذا اليوم بعد: «🔄 إعادة الحساب» يحسبه.</div>
    <div class="alert alert-info" role="status" invisible="x_n_publishable">لا صنف معتمد للنشر: كل الأصناف استثناء بلا قرار أو «لا تنشر».</div>
    <div class="text-muted">عدد العملاء كما حسبه النظام عند آخر حساب لليوم. الاستثناء بلا قرار لا يُنشر.</div>
  </sheet>
  <footer>
    <button name="${a.approve}" type="action" string="نعم، انشر وأرسل للعملاء" class="btn-primary" invisible="not x_n_publishable" close="1"/>
    <button string="إلغاء" special="cancel" class="btn-secondary"/>
  </footer>
</form>`;

/** 2. «📅 الأيام السابقة»: the days, their counts and their cost; a day opens on the screen of «📊 اليوم». */
export const DAY_LIST = `<list string="${MENU.days}" default_order="x_date desc" create="0" delete="0" decoration-success="x_state == 'published'" decoration-danger="x_state == 'missed'" decoration-info="x_state == 'approved'">
  <header>
    <button name="__PROFIT_GRAPH__" type="action" string="📈 ربح الأصناف عبر الأيام" display="always"/>
  </header>
  <field name="x_date"/>
  <field name="x_state"/>
  <field name="x_n_green" string="🟢"/>
  <field name="x_n_yellow" string="🟡"/>
  <field name="x_n_red" string="🔴"/>
  <field name="x_n_none" string="⚪"/>
  <field name="x_op_cost" string="تكلفة اليوم"/>
  <field name="x_op_share" string="حصة الكرتون"/>
  <field name="x_approved_at" optional="show"/>
  <field name="x_published_at" optional="show"/>
  <field name="x_approved_by" optional="hide"/>
</list>`;
export const dayList = (a) => DAY_LIST.replace("__PROFIT_GRAPH__", String(a.profitGraph));
export const DAY_GRAPH = `<graph string="حصة الكرتون وتكلفة اليوم" type="line" sample="0">
  <field name="x_date" interval="day"/>
  <field name="x_op_share" type="measure"/>
</graph>`;

const PURCHASE_COLUMNS = `<field name="x_supplier_id" string="المصدر"/>
          <field name="x_product_tmpl_id" string="الصنف"/>
          <field name="x_packaging_id" string="التعبئة"/>
          <field name="x_price_sar" string="الشراء (المستخرج)"/>
          <field name="x_sale_price" string="الاحتياطي = المقترح"/>
          <field name="x_actual_weight_kg" string="الوزن الفعلي (كجم)" optional="show"/>
          <field name="x_extraction_status" string="حالة الاستخراج"/>
          <field name="x_raw_reply" string="الرد الخام"/>
          <field name="create_date" string="وصل" optional="show"/>`;
const MARKET_COLUMNS = `<field name="x_source_partner_id" string="المصدر"/>
          <field name="x_product_tmpl_id" string="الصنف"/>
          <field name="x_packaging_id" string="التعبئة"/>
          <field name="x_market_price" string="السوق (المستخرج)"/>
          <field name="x_purchase_price" string="الشراء (المستخرج)"/>
          <field name="x_available_qty" string="الكمية المتاحة" optional="show"/>
          <field name="x_status" string="حالة الاستخراج"/>
          <field name="x_raw_text" string="الرد الخام"/>
          <field name="create_date" string="وصل" optional="show"/>`;
export const PURCHASE_LIST = `<list string="ردود الشراء" default_order="x_supplier_id, id" decoration-warning="x_extraction_status == 'pending'" decoration-danger="x_extraction_status == 'failed'" decoration-muted="x_utak_simulation">
          ${PURCHASE_COLUMNS}
          <field name="x_date" optional="hide"/>
          <field name="x_utak_simulation" optional="hide"/>
</list>`;
export const PURCHASE_SEARCH = `<search string="ردود الشراء">
  <field name="x_supplier_id" string="المصدر"/>
  <field name="x_product_tmpl_id" string="الصنف"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '=', False)]"/>
  <filter name="f_pending" string="شاذ (بانتظار المراجعة)" domain="[('x_extraction_status', '=', 'pending')]"/>
  <filter name="f_failed" string="فشل الاستخراج" domain="[('x_extraction_status', '=', 'failed')]"/>
  <separator/>
  <filter name="g_source" string="المصدر" context="{'group_by': 'x_supplier_id'}"/>
  <filter name="g_product" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
</search>`;
export const MARKET_LIST = `<list string="مشاهدات السوق" create="0" default_order="x_source_partner_id, id" decoration-warning="x_status == 'outlier'" decoration-muted="x_utak_simulation">
          ${MARKET_COLUMNS}
          <field name="x_date" optional="hide"/>
          <field name="x_utak_simulation" optional="hide"/>
</list>`;
export const MARKET_SEARCH = `<search string="مشاهدات السوق">
  <field name="x_source_partner_id" string="المصدر"/>
  <field name="x_product_tmpl_id" string="الصنف"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '=', False)]"/>
  <filter name="f_outlier" string="شاذ" domain="[('x_status', '=', 'outlier')]"/>
  <separator/>
  <filter name="g_source" string="المصدر" context="{'group_by': 'x_source_partner_id'}"/>
  <filter name="g_product" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
</search>`;
/** 3. «📥 عروض المصادر»: one day, three tabs — the purchase replies, the market observations, the asks. The simulation is left out. */
export const sourcesForm = (a) => `<form string="${MENU.sources}" create="0" delete="0" edit="0">
  <header>
    ${dayButtons(a, "sources")}
    <field name="x_state" widget="statusbar" statusbar_visible="draft,approved,published"/>
  </header>
  <sheet>
    ${navRow(a, "sources")}
    ${dayBanners}
    <div class="oe_title"><h1>${MENU.sources} — <field name="x_date" readonly="1" class="oe_inline"/></h1></div>
    <div class="text-muted mb-2">كل ما وصل من المصادر لهذا اليوم، مرتَّباً بالمصدر: الرد الخام كما كُتب، والقيمة المستخرجة منه، وحالة الاستخراج. صفوف المحاكاة مستبعدة.</div>
    <notebook>
      <page string="ردود الشراء" name="purchase">
        <button name="${a.purchaseList}" type="action" string="فتح مجمّعة بالمصدر (وإضافة سعر يدوياً)" class="btn btn-link px-0"/>
        <field name="x_src_purchase_ids" nolabel="1" readonly="1">
          <list create="0" delete="0" decoration-warning="x_extraction_status == 'pending'" decoration-danger="x_extraction_status == 'failed'">
          ${PURCHASE_COLUMNS}
          </list>
        </field>
      </page>
      <page string="مشاهدات السوق" name="market">
        <button name="${a.marketList}" type="action" string="فتح مجمّعة بالمصدر" class="btn btn-link px-0"/>
        <field name="x_src_market_ids" nolabel="1" readonly="1">
          <list create="0" delete="0" decoration-warning="x_status == 'outlier'">
          ${MARKET_COLUMNS}
          </list>
        </field>
      </page>
      <page string="طلبات الأسعار" name="asks">
        <field name="x_src_ask_ids" nolabel="1" readonly="1">
          <list create="0" delete="0">
            <field name="x_supplier_id" string="المورد"/>
            <field name="x_sent_at" string="وقت الإرسال"/>
            <field name="x_status" string="الحالة"/>
            <field name="x_replied_at" string="وقت الرد"/>
            <field name="x_prices_received_count" string="عدد الأسعار"/>
          </list>
        </field>
      </page>
    </notebook>
  </sheet>
</form>`;

/** 4. «📦 الأصناف»: the produce, edited in the list. `c`: the three categories' ids. */
export const productsDomain = (c) => `[('type', '!=', 'service'), '|', '|', '|', '|', ('categ_id', 'child_of', [${c.join(", ")}]), ('categ_id', '=', False), ('default_code', '=like', 'UTAK-FRT-%'), ('default_code', '=like', 'UTAK-VEG-%'), ('default_code', '=like', 'UTAK-LEAF-%')]`;
export const productsList = (a, withType) => `<list string="${MENU.products}" editable="bottom" open_form_view="True" default_order="default_code, name">
  <header>
    <button name="${a.packagings}" type="action" string="كل التعبئات" display="always"/>
  </header>
  <field name="default_code" string="المرجع" readonly="1" optional="show"/>
  <field name="name" string="الصنف"/>
  <field name="categ_id" string="الفئة" options="{'no_create': True}"/>
  <field name="x_is_active_for_sale" string="نشط للبيع" widget="boolean_toggle"/>
  <field name="x_supplier_ids" string="المورد" widget="many2many_tags" domain="[('supplier_rank', '&gt;', 0)]" options="{'no_create': True}"/>
  <field name="x_pack_id" string="التعبئة" readonly="1"/>${withType ? `
  <field name="x_pack_type" string="نوعها" readonly="not x_pack_id"/>` : ""}
  <field name="x_pack_weight" string="وزنها (كجم)" readonly="not x_pack_id"/>
  <field name="x_name_en" string="الاسم بالإنجليزي" optional="show"/>
  <field name="x_missing" string="الناقص" readonly="1"/>
</list>`;
export const productsSearch = (c) => `<search string="${MENU.products}">
  <field name="name" string="الصنف"/>
  <field name="default_code" string="المرجع"/>
  <field name="x_supplier_ids" string="المورد"/>
  <filter name="f_missing" string="ناقص" domain="[('x_missing', '!=', False)]"/>
  <filter name="f_complete" string="مكتمل" domain="[('x_missing', '=', False)]"/>
  <separator/>
  <filter name="f_for_sale" string="نشط للبيع" domain="[('x_is_active_for_sale', '=', True)]"/>
  <filter name="f_not_for_sale" string="غير نشط للبيع" domain="[('x_is_active_for_sale', '=', False)]"/>
  <separator/>
  <filter name="f_categories" string="فواكه / خضار / ورقيات فقط" domain="[('categ_id', 'child_of', [${c.join(", ")}])]"/>
  <separator/>
  <filter name="g_category" string="الفئة" context="{'group_by': 'categ_id'}"/>
</search>`;

/** 5. «⚙️ الإعدادات»: every pricing setting, and the operating cost lines edited inside it with the day's computed cost. */
export const settingsForm = (a) => `<form string="${MENU.settings}" create="0" delete="0">
  <sheet>
    ${navRow(a, "settings")}
    <div class="oe_title"><h1>${MENU.settings}</h1></div>
    <group>
      <group string="التسعير اليومي">
        <field name="x_waste_pct"/>
        <field name="x_min_profit_sar"/>
        <field name="x_expected_cartons"/>
        <field name="x_outlier_ratio"/>
      </group>
      <group string="الطلب والخصم">
        <field name="x_min_order_sar"/>
        <field name="x_planned_stops"/>
        <field name="x_name" readonly="1"/>
        <field name="x_active_from" readonly="1"/>
      </group>
    </group>
    <div class="text-muted">${SETTINGS_NOTE}</div>
    <separator string="التكاليف التشغيلية"/>
    <div class="alert alert-info" role="status"><field name="x_day_cost_note" readonly="1" nolabel="1" class="oe_inline"/></div>
    <field name="x_cost_line_ids" nolabel="1">
      <list editable="bottom" delete="0" default_order="x_frequency, x_name" decoration-muted="x_utak_simulation">
        <field name="x_name" string="البند" required="1"/>
        <field name="x_cost_type"/>
        <field name="x_frequency"/>
        <field name="x_amount" sum="المجموع"/>
        <field name="x_date_from"/>
        <field name="x_date_to"/>
        <field name="x_note" optional="show"/>
        <field name="x_utak_simulation" optional="hide"/>
      </list>
    </field>
    <div class="text-muted">تكلفة اليوم = اليومي كما هو، والشهري ÷ أيام عمل الشهر، والسنوي ÷ أيام عمل السنة (من جدول دوام السائق في «الموظفون»)، لكل بند سارٍ في ذلك اليوم. لإيقاف بند: اكتب تاريخ «إلى» (لا حذف).</div>
    <separator string="شرائح خصم الكمية"/>
    <field name="x_tier_ids" nolabel="1">
      <list editable="bottom" default_order="x_sequence, x_amount_from" decoration-muted="not x_active">
        <field name="x_sequence" widget="handle"/>
        <field name="x_amount_from"/>
        <field name="x_amount_to"/>
        <field name="x_discount_pct"/>
        <field name="x_active" widget="boolean_toggle"/>
      </list>
    </field>
    <div class="text-muted">الخصم على مجموع الطلب قبل الضريبة، بنسبة الشريحة التي يقع فيها المجموع («إلى» فارغ = بلا حد). لا خصم إذا صار ربح الطلب بعده أقل من (تكلفة اليوم ÷ عدد المحطات)، ولا خصم إطلاقاً والمحطات فارغة.</div>
  </sheet>
</form>`;
