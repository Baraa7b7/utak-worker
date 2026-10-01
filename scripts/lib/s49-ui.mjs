// § 49 (2026-10-01) — what § 49 puts in Odoo, one source for scripts/s49-20261001-odoo.mjs (which
// writes it to the tenant), scripts/archive/s49-20261001-shots.mts (which measures its contrast) and
// tests/s49.test.mts (which runs the Python in python3 and reads the archs):
//   أ  «الحد الأدنى للطلب (ريال)» = 0 on the active settings record (0 = no minimum, never mentioned);
//   ب  x_daily_order: «أسعار يوم» (the price list the quotation was priced with), «بانتظار أسعار اليوم»;
//   ج  x_daily_order: «تسليم فوري (من السيارة)»;
//   د  «دور الأسعار» (شراء / سوق) on the source's card — the partner and the employee — and where it
//      shows: «💲 التسعير» ← «⚙️ الإعدادات» and «📥 عروض المصادر», with the two lists it is edited in;
//   هـ the item's full name first («رمان كبير — كرتون», never cut), its UTAK-… code under it on a
//      card and in a column of its own (hidden) in a table: «📊 اليوم», the day opened from
//      «📅 الأيام السابقة» (the same screen) and «📥 عروض المصادر».
// The screens are § 48's (scripts/lib/s48-ui.mjs): § 49 changes pieces of their arch, it does not
// rebuild them.

export const MIN_ORDER_SAR = 0;
export const MIN_ORDER_LABEL = "الحد الأدنى للطلب (ريال)";
export const MIN_ORDER_HELP = "مجموع الطلب قبل الخصم. 0 = بلا حد أدنى: لا يُذكر الحد الأدنى في أي رسالة، ولا يُرفض طلب بسببه.";

export const ROLE = { purchase: "شراء", market: "سوق" };
export const ROLE_SELECTION = `[('purchase', '${ROLE.purchase}'), ('market', '${ROLE.market}')]`;
export const ROLE_HELP = "«شراء»: كل رقم يرسله المصدر يُسجَّل عرض شراء، ومنه يُحسب «أقل عرض». «سوق»: كل رقم يُسجَّل مشاهدة سوق، ولو كتب «شراء» جنبه، ولا يدخل «أقل عرض». فارغ = كما كان قبل § 49 (المورد شراء و«سوق» بالكلمة، وغيره سوق و«شراء» بالكلمة).";
/** The sources of 2026-10-01 and their roles: Ahmed Hassan (res.partner #30) buys, Omar (hr.employee #4) watches the market. */
export const ROLES_TO_SET = [
  { model: "res.partner", id: 30, name: "أحمد حسان", role: "purchase" },
  { model: "hr.employee", id: 4, name: "عمر المجهلي", role: "market" },
];

// ---------------------------------------------------------------- the computed fields (Python Odoo runs)
/** «رمان كبير — كرتون»: the product's own name (no [UTAK-…] in front) and the packaging's, whole. */
export const ITEM_SHOW_CODE = `for record in self:
    name = (record.x_product_tmpl_id.name or '').strip()
    pack = (record.x_packaging_id.x_name or '').strip()
    record['x_item_show'] = ' — '.join([p for p in (name, pack) if p]) or '—'`;
/** One line that names every source and its role (the settings screen and the sources screen). */
export const SOURCES_NOTE_CODE = `ROLE = {'purchase': '${ROLE.purchase}', 'market': '${ROLE.market}'}
parts = []
for p in self.env['res.partner'].search([('x_price_source', '=', True)], order='id'):
    parts.append('%s: %s' % (p.name, ROLE.get(p.x_price_role) or 'بلا دور (كما كان)'))
for e in self.env['hr.employee'].search([('x_price_source', '=', True)], order='id'):
    parts.append('%s: %s' % (e.name, ROLE.get(e.x_price_role) or 'بلا دور (كما كان)'))
note = ' · '.join(parts) or 'لا مصدر أسعار مفعّل.'
for record in self:
    record['x_sources_note'] = note`;

export const ORDER_FIELDS = [
  { name: "x_price_date", ttype: "date", field_description: "أسعار يوم",
    help: "قائمة الأسعار التي سُعّر بها عرض السعر (يكتبها الوركر عند «خلاص»). صالحة من نشرها حتى 06:00 من اليوم التالي، وبعدها لا يُؤكَّد الطلب بها: يصل العميل عرض جديد." },
  { name: "x_awaiting_prices", ttype: "boolean", field_description: "بانتظار أسعار اليوم",
    help: "الطلب محفوظ ولا قائمة أسعار صالحة: يُرسل عرض السعر للعميل تلقائياً عند أول نشر صالح. لا يُلغى عند 21:00." },
  { name: "x_immediate_delivery", ttype: "boolean", field_description: "تسليم فوري (من السيارة)",
    help: "ضُغط «تم التسليم» والطلب مؤكد وليس على مسار: سُلّم مباشرة، وصدرت فاتورته، ولا يدخل قائمة شراء. وقت التسليم الفعلي في «Delivered At»." },
];
const ROLE_FIELD = { name: "x_price_role", ttype: "selection", selection: ROLE_SELECTION, field_description: "دور الأسعار", help: ROLE_HELP };
export const PARTNER_FIELDS = [ROLE_FIELD];
export const EMPLOYEE_FIELDS = [ROLE_FIELD];
const ITEM_FIELDS = [
  { name: "x_item_show", ttype: "text", field_description: "الصنف", compute: ITEM_SHOW_CODE, depends: "x_product_tmpl_id,x_product_tmpl_id.name,x_packaging_id,x_packaging_id.x_name", store: false, readonly: true,
    help: "اسم الصنف كاملاً ثم التعبئة، بلا الرمز وبلا قص." },
  { name: "x_item_code", ttype: "char", field_description: "الرمز", related: "x_product_tmpl_id.default_code", store: false, readonly: true },
];
export const LINE_FIELDS = ITEM_FIELDS, DAILY_PRICE_FIELDS = ITEM_FIELDS, OFFER_FIELDS = ITEM_FIELDS;
const NOTE_FIELD = { name: "x_sources_note", ttype: "char", field_description: "أدوار المصادر", compute: SOURCES_NOTE_CODE, depends: "x_name", store: false, readonly: true };
export const DAY_FIELDS = [NOTE_FIELD], CFG_FIELDS = [NOTE_FIELD];

// ---------------------------------------------------------------- the views
export const VIEW = {
  day: "utak.price_day_form", sources: "utak.pricing_sources_form", settings: "utak.pricing_settings_form",
  purchaseList: "utak.pricing_purchase_list", marketList: "utak.pricing_market_list", boardList: "utak.pricing_board_list",
  sourcePartners: "utak.pricing_source_partners_list", sourceEmployees: "utak.pricing_source_employees_list",
  partnerRole: "res.partner.form.utak_price_role", employeeRole: "utak.hr_employee_form.price_role", orderForm: "x_daily_order.form.utak_s49",
};
export const PARENT_VIEW = { partnerRole: "res.partner.form.utak_price_source", employeeRole: "utak.hr_employee_form.price_source", orderForm: "x_daily_order.form" };
export const WINDOW = { sourcePartners: "UTAK — مصادر الأسعار: الموردون", sourceEmployees: "UTAK — مصادر الأسعار: الموظفون" };

/** `from` (a pattern of § 48's arch) → `to`, once; an arch that already carries `marker` is left as it is. */
function swap(arch, from, to, marker, what) {
  if (arch.includes(marker)) return arch;
  if (!from.test(arch)) throw new Error(`${what}: the § 48 piece was not found — stop (the view was changed by hand?)`);
  return arch.replace(from, to);
}
const all = (re) => new RegExp(re.source, "g");

// هـ — «📊 اليوم»: the lines' table, the phone's card, the line opened from its card
const LIST_ITEM_48 = /<field name="x_product_tmpl_id" string="الصنف" readonly="1"\/>\s*<field name="x_packaging_id" string="التعبئة" readonly="1"\/>/;
export const LIST_ITEM = `<field name="x_item_show" string="الصنف"/>
        <field name="x_item_code" string="الرمز" optional="hide"/>`;
const CARD_NAME_48 = /<field name="x_name" class="fw-bold fs-5"\/>/;
export const CARD_NAME = `<div class="flex-grow-1" name="utak_item">
                <field name="x_item_show" class="fw-bold fs-5"/>
                <div class="small text-muted" t-if="record.x_item_code.raw_value"><field name="x_item_code"/></div>
              </div>`;
const FORM_NAME_48 = /<div class="oe_title"><h2><field name="x_name" readonly="1"\/><\/h2><\/div>/;
export const FORM_NAME = `<div class="oe_title"><h2><field name="x_item_show" readonly="1"/></h2><div class="small text-muted"><field name="x_item_code" readonly="1"/></div></div>`;
export const dayArch = (arch) => swap(swap(swap(arch,
  LIST_ITEM_48, LIST_ITEM, `<field name="x_item_show" string="الصنف"/>`, "📊 اليوم: the table's item column"),
  CARD_NAME_48, CARD_NAME, `name="utak_item"`, "📊 اليوم: the card's name"),
  FORM_NAME_48, FORM_NAME, `<h2><field name="x_item_show" readonly="1"/></h2>`, "📊 اليوم: the line's form title");

// هـ — «📥 عروض المصادر»: the item first and whole, then its source
const PURCHASE_ITEM_48 = /<field name="x_supplier_id" string="المصدر"\/>\s*<field name="x_product_tmpl_id" string="الصنف"\/>\s*<field name="x_packaging_id" string="التعبئة"\/>/;
export const PURCHASE_ITEM = `<field name="x_item_show" string="الصنف"/>
          <field name="x_item_code" string="الرمز" optional="hide"/>
          <field name="x_supplier_id" string="المصدر"/>`;
const MARKET_ITEM_48 = /<field name="x_source_partner_id" string="المصدر"\/>\s*<field name="x_product_tmpl_id" string="الصنف"\/>\s*<field name="x_packaging_id" string="التعبئة"\/>/;
export const MARKET_ITEM = `<field name="x_item_show" string="الصنف"/>
          <field name="x_item_code" string="الرمز" optional="hide"/>
          <field name="x_source_partner_id" string="المصدر"/>`;
export const purchaseListArch = (arch) => swap(arch, PURCHASE_ITEM_48, PURCHASE_ITEM, `<field name="x_item_show"`, "ردود الشراء: the item column");
export const marketListArch = (arch) => swap(arch, MARKET_ITEM_48, MARKET_ITEM, `<field name="x_item_show"`, "مشاهدات السوق: the item column");

// هـ — «📅 الأيام السابقة» ← «📈 ربح الأصناف عبر الأيام»: its list of the lines (the chart names a line by its stored x_name)
const BOARD_ITEM_46 = /<field name="x_product_tmpl_id" string="الصنف"\/>\s*<field name="x_packaging_id" string="التعبئة"\/>/;
export const BOARD_ITEM = `<field name="x_item_show" string="الصنف"/>
  <field name="x_item_code" string="الرمز" optional="hide"/>`;
export const boardListArch = (arch) => swap(arch, BOARD_ITEM_46, BOARD_ITEM, `<field name="x_item_show"`, "ربح الأصناف عبر الأيام: the item column");

// د — the roles, where they show. `a`: the two windows' ids.
export const ROLES_RULE = "«شراء»: كل رقم يرسله المصدر عرض شراء، ومنه «أقل عرض». «سوق»: كل رقم مشاهدة سوق، ولو كتب «شراء»، ولا يدخل «أقل عرض».";
/**
 * The roles, as a screen shows them: the line that names each source and its role, the rule, and —
 * UNDER the note, on the sheet itself — the links to the two lists the role is edited in. (A link
 * inside the light-blue note measured 3.93:1 in the light theme; on the sheet it is 4.86:1.)
 */
export const rolesBlock = (a) => `<div name="utak_source_roles" class="mb-2">
      <div class="alert alert-info mb-1" role="status"><strong>دور الأسعار:</strong> <field name="x_sources_note" readonly="1" nolabel="1" class="oe_inline"/><div>${ROLES_RULE}</div></div>
      <button name="${a.sourcePartners}" type="action" string="تعديل دور المورد" class="btn btn-link px-0 me-3"/><button name="${a.sourceEmployees}" type="action" string="تعديل دور الموظف" class="btn btn-link px-0"/>
    </div>`;
const ROLES_MARK = `<div name="utak_source_roles" class="mb-2">`;
/** The first shape of the block (written to the tenant 2026-10-01 15:38, its links inside the note): replaced by the one above. */
const ROLES_FIRST = /<div class="alert alert-info" role="status" name="utak_source_roles">[\s\S]*?<div>«شراء»[^<]*<\/div>\s*<\/div>/;
const rolesNow = (arch, a) => (ROLES_FIRST.test(arch) ? arch.replace(ROLES_FIRST, () => rolesBlock(a)) : arch);
const SOURCES_NOTE_48 = /(<div class="text-muted mb-2">كل ما وصل من المصادر لهذا اليوم[^<]*<\/div>)/;
export const sourcesArch = (arch, a) => {
  let out = rolesNow(arch, a);
  if (!out.includes(`<field name="x_item_show"`)) {
    if (!PURCHASE_ITEM_48.test(out) || !MARKET_ITEM_48.test(out)) throw new Error("📥 عروض المصادر: the § 48 columns were not found — stop (the view was changed by hand?)");
    out = out.replace(all(PURCHASE_ITEM_48), PURCHASE_ITEM).replace(all(MARKET_ITEM_48), MARKET_ITEM);
  }
  return swap(out, SOURCES_NOTE_48, (_, note) => `${note}\n    ${rolesBlock(a)}`, ROLES_MARK, "📥 عروض المصادر: the roles block");
};
const SETTINGS_COSTS_48 = /<separator string="التكاليف التشغيلية"\/>/;
export const settingsArch = (arch, a) => swap(rolesNow(arch, a), SETTINGS_COSTS_48, `<separator string="مصادر الأسعار"/>\n    ${rolesBlock(a)}\n    <separator string="التكاليف التشغيلية"/>`, ROLES_MARK, "⚙️ الإعدادات: the roles block");

// د — the two lists the role is edited in (a source is ticked on its card; here its role)
const sourceList = (title, name) => `<list string="${title}" editable="bottom" create="0" delete="0" open_form_view="True">
  <field name="${name}" string="المصدر" readonly="1"/>
  <field name="x_price_role" string="دور الأسعار"/>
  <field name="x_price_source" string="مصدر أسعار" widget="boolean_toggle"/>
  <field name="x_vat_registered" string="مسجل في الضريبة" widget="boolean_toggle" optional="show"/>
</list>`;
export const SOURCE_PARTNERS_LIST = sourceList(WINDOW.sourcePartners, "name");
export const SOURCE_EMPLOYEES_LIST = sourceList(WINDOW.sourceEmployees, "name");
export const SOURCE_DOMAIN = "[('x_price_source', '=', True)]";

// د — the source's own card: the role right after «مصدر أسعار»
export const CARD_ROLE = `<data>
  <xpath expr="//field[@name='x_price_source']" position="after">
    <field name="x_price_role" invisible="not x_price_source"/>
  </xpath>
</data>`;
// ب / ج — the order's form: the price list it was priced with, whether it waits for prices, the immediate delivery
export const ORDER_FORM = `<data>
  <xpath expr="//field[@name='x_order_date']" position="after">
    <field name="x_price_date" readonly="1"/>
    <field name="x_awaiting_prices" readonly="1"/>
  </xpath>
  <xpath expr="//field[@name='x_delivered_at']" position="after">
    <field name="x_immediate_delivery" readonly="1"/>
  </xpath>
</data>`;
