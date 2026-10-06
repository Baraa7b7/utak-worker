// § 59 أ (2026-10-06) — the data of scripts/s59-20261006-odoo.mjs. Pure: no network, no worker import.
//
// Omar (hr.employee #4) is marketing until further notice: his three operating roles go to Baraa, who
// becomes an employee of the team (Work Contact #45, his own partner). The working days the costs are
// divided by no longer follow whoever holds «سائق»: a schedule of the company's own, a copy of
// Omar's (7 days), named on the pricing settings.

export const ROLE_MODEL = "x_employee_role";
export const EMPLOYEE_MODEL = "hr.employee";
export const CONFIG_MODEL = "x_pricing_config";
export const CALENDAR_MODEL = "resource.calendar";
export const TPL_MODEL = "x_whatsapp_template";

/** The new role of the marketing member: no task of the day reaches it; the price list does (src/team-prices.ts). */
export const MARKETING_ROLE = { x_name: "تسويق", x_code: "marketing", x_color: 3, x_active: true };
/** The three operating roles (x_employee_role, by code) that move from Omar to Baraa. */
export const OPERATING_CODES = ["driver", "warehouse", "collector"];

export const OMAR_EMPLOYEE = 4;
export const OMAR_CALENDAR = 3;           // «UTAK — عمر»: 7 days, 02:00–12:00
export const OWNER_PARTNER = 45;          // «Bara.a - U TAK»: Baraa's own partner, his WhatsApp number
export const OWNER_EMPLOYEE_NAME = "براء";
export const COMPANY = 1;

/** The company's working days (the costs' monthly and yearly shares), and Baraa's own «بدء الدوام» hour. */
export const WORKDAYS_CALENDAR_NAME = "UTAK — أيام العمل";
export const WORKDAYS_FIELD = {
  name: "x_workdays_calendar_id", ttype: "many2one", relation: CALENDAR_MODEL, on_delete: "set null",
  field_description: "جدول أيام العمل (حصة التكلفة)",
  help: "أيام العمل التي تُقسم عليها التكاليف الشهرية والسنوية. ثابت للشركة: لا يتبع من يحمل دور السائق. فارغ = جدول دوام السائق كما كان.",
};

/** The settings form (#2855) gains the field, and its sentence about the working days says where they come from now. */
export const SETTINGS_VIEW = 2855;
export const SETTINGS_EXT_NAME = "utak.pricing_settings_form.s59_workdays";
export const WORKDAYS_SENTENCE = "تكلفة اليوم = اليومي كما هو، والشهري ÷ أيام عمل الشهر، والسنوي ÷ أيام عمل السنة (من «جدول أيام العمل» أعلاه: جدول ثابت للشركة لا يتبع من يحمل دور السائق)، لكل بند سارٍ في ذلك اليوم. لإيقاف بند: اكتب تاريخ «إلى» (لا حذف).";
export const settingsExtArch = () => `<data>
  <xpath expr="//field[@name='x_cost_line_ids']" position="before">
    <group name="utak_workdays"><field name="${WORKDAYS_FIELD.name}" options="{'no_create': True, 'no_open': False}"/></group>
  </xpath>
  <xpath expr="//field[@name='x_cost_line_ids']/following-sibling::div[1]" position="replace">
    <div class="text-muted">${WORKDAYS_SENTENCE}</div>
  </xpath>
</data>`;

/** The cost of the order's proof: 2026-10-06 = 641.23, before and after (scripts/s59-20261006-cost.mts). */
export const PROOF_DAY = "2026-10-06";
export const PROOF_COST = 641.23;
