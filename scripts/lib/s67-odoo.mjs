// § 67 (2026-10-08) — «🧊 وضع التجميد»: the tenant's data (scripts/s67-20261008-odoo.mjs applies it).
//
// The switch lives on the pricing settings (x_pricing_config, the record «⚙️ الإعدادات» opens); the worker
// reads it (src/freeze.ts). Nothing here calls the worker: the two buttons are Odoo code, so the count of
// Odoo's links to the worker stays what it was.

export const CONFIG_MODEL = "x_pricing_config";
export const DAY_MODEL = "x_price_day";
export const MSG_MODEL = "x_wa_message";
export const SETTINGS_FORM = "utak.pricing_settings_form"; // #2855
export const DAY_FORM = "utak.price_day_form";              // #2834
export const MSG_SEARCH = "x_wa_message.search";            // #2781
export const MSG_LIST = "x_wa_message.tree";                // #2775

/** The reply a customer's attempt to order gets while frozen (Baraa edits it in the settings). */
export const DEFAULT_REPLY = "نشكر تواصلك 🌿 استقبال الطلبات متوقف مؤقتاً ونرجع قريباً بإذن الله";

export const CONFIG_FIELDS = [
  { name: "x_freeze_on", ttype: "boolean", field_description: "🧊 وضع التجميد", help: "مُشغَّلاً: لا رسالة آلية تخرج لغير براء (طلبات الأسعار، النشر، رسائل العملاء والفريق، تنبيهات اليوم). أفعالك اليدوية من Odoo تعمل كالمعتاد. إطفاؤه يعيد كل شيء من الموعد التالي بلا إرسال متأخر." },
  { name: "x_freeze_until", ttype: "date", field_description: "حتى تاريخ (اختياري)", help: "آخر يوم مجمَّد. بعده يُطفأ التجميد وحده ويصلك تنبيه. فارغ = حتى تطفئه بنفسك." },
  { name: "x_freeze_reply", ttype: "text", field_description: "رد التجميد على محاولة الطلب", help: "ما يصل العميل إن راسلنا أثناء التجميد (مرة كل 6 ساعات للرقم)." },
  { name: "x_freeze_since", ttype: "datetime", field_description: "بدأ التجميد", readonly: true, copied: false },
  { name: "x_freeze_ended_at", ttype: "datetime", field_description: "انتهى التجميد", readonly: true, copied: false },
];

/** On the day's record, for the button of «📊 اليوم»: the switch of the active settings (not stored). */
export const DAY_FIELDS = [
  {
    name: "x_freeze_on", ttype: "boolean", field_description: "🧊 وضع التجميد", store: false, readonly: true, depends: "x_date",
    compute: "today = (datetime.datetime.now() + datetime.timedelta(hours=3)).date()\ncfg = self.env['x_pricing_config'].sudo().search([('x_is_active', '=', True), ('x_active_from', '<=', today), '|', ('x_active_to', '=', False), ('x_active_to', '>=', today)], order='x_active_from desc, id desc', limit=1)\non = bool(cfg and cfg.x_freeze_on and (not cfg.x_freeze_until or cfg.x_freeze_until >= today))\nfor record in self:\n    record['x_freeze_on'] = on",
  },
];

/** x_wa_message.x_status: what the freeze stepped over — written once, never sent later. */
export const FROZEN_STATUS = { value: "frozen", name: "🧊 مجمّد (لم تُرسل)", sequence: 12 };

const ACTIVE_CFG = "today = (datetime.datetime.now() + datetime.timedelta(hours=3)).date()\ncfg = env['x_pricing_config'].sudo().search([('x_is_active', '=', True), ('x_active_from', '<=', today), '|', ('x_active_to', '=', False), ('x_active_to', '>=', today)], order='x_active_from desc, id desc', limit=1)\nif not cfg:\n    raise UserError('لا يوجد إعداد تسعير فعّال اليوم.')\n";
const RELOAD = "action = {'type': 'ir.actions.client', 'tag': 'soft_reload'}";

/** The two buttons of «📊 اليوم» (Odoo code alone), and the stamp the automation runs on every change of the switch. */
export const ACTIONS = {
  on: { name: "utak.freeze.turn_on", model: DAY_MODEL, code: `${ACTIVE_CFG}cfg.write({'x_freeze_on': True})\n${RELOAD}` },
  off: { name: "utak.freeze.turn_off", model: DAY_MODEL, code: `${ACTIVE_CFG}cfg.write({'x_freeze_on': False, 'x_freeze_until': False})\n${RELOAD}` },
  stamp: {
    name: "utak.freeze.stamp", model: CONFIG_MODEL,
    code: "now = datetime.datetime.now()\nfor rec in records:\n    if rec.x_freeze_on:\n        rec.write({'x_freeze_since': now, 'x_freeze_ended_at': False})\n    elif rec.x_freeze_since and not rec.x_freeze_ended_at:\n        rec.write({'x_freeze_ended_at': now})",
  },
};
export const AUTOMATION = "utak.freeze.stamp (on switch)";

export const ON_CONFIRM = "تشغيل وضع التجميد؟ يتوقف كل إرسال آلي لغيرك: طلبات الأسعار وتذكيراتها، نشر 06:00 ورسائل العملاء، رسائل الفريق، وتنبيهات اليوم. أفعالك اليدوية من Odoo تعمل كالمعتاد.";
export const OFF_CONFIRM = "إطفاء وضع التجميد؟ يعود كل شيء من الموعد التالي، ولا يُرسل شيء مما فات.";
export const BANNER = "🧊 وضع التجميد مُشغَّل: لا رسالة آلية تخرج لغير براء (لا طلب أسعار ولا نشر ولا رسائل عملاء أو فريق). ما يتخطاه التجميد يُسجَّل «مجمّد» ولا يُرسل لاحقاً.";

/** The extension views (applied AFTER the worker's code: a switch the deployed worker does not read would lie). */
export const views = ({ on, off }) => ({
  "utak.price_day_form.s67_freeze": {
    model: DAY_MODEL, inherit: DAY_FORM, priority: 99,
    arch: `<data>
  <xpath expr="//header/button[@name='1004']" position="before">
    <button name="${off}" type="action" string="🧊 التجميد مُشغَّل — أطفئه" class="btn-danger" invisible="not x_freeze_on" confirm="${OFF_CONFIRM}"/>
    <button name="${on}" type="action" string="🧊 جمّد النظام" class="btn-secondary" invisible="x_freeze_on" confirm="${ON_CONFIRM}"/>
  </xpath>
  <xpath expr="//field[@name='x_is_today']" position="after">
    <field name="x_freeze_on" invisible="1"/>
    <div class="alert alert-danger" role="alert" invisible="not x_freeze_on">${BANNER}</div>
  </xpath>
</data>`,
  },
  "utak.pricing_settings_form.s67_freeze": {
    model: CONFIG_MODEL, inherit: SETTINGS_FORM, priority: 99,
    arch: `<data>
  <xpath expr="//div[hasclass('oe_title')]" position="after">
    <div class="alert alert-danger" role="alert" invisible="not x_freeze_on">${BANNER}</div>
    <group string="🧊 وضع التجميد">
      <group>
        <field name="x_freeze_on" widget="boolean_toggle"/>
        <field name="x_freeze_until"/>
        <field name="x_freeze_since" readonly="1" invisible="not x_freeze_since"/>
        <field name="x_freeze_ended_at" readonly="1" invisible="not x_freeze_ended_at"/>
      </group>
      <group>
        <field name="x_freeze_reply" placeholder="${DEFAULT_REPLY}"/>
      </group>
    </group>
  </xpath>
</data>`,
  },
  "x_wa_message.search.s67_frozen": {
    model: MSG_MODEL, inherit: MSG_SEARCH, priority: 40,
    arch: `<data>
  <xpath expr="//search" position="inside">
    <separator/>
    <filter name="utak_frozen" string="🧊 مجمّد" domain="[('x_status', '=', 'frozen')]"/>
  </xpath>
</data>`,
  },
});
