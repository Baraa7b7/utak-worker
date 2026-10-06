// § 61 (2026-10-06) — the data of scripts/s61-20261006-odoo.mjs. Pure: no network, no worker import.
//
// The job is fixed and the employee changes: a job (hr.job, «الموظفون ← الإعدادات ← الوظائف») carries
// the roles its holder works with, a default schedule and «مشمول بالتحضير», and what Baraa hands over
// and takes back. The worker reads an employee's roles as HIS JOB'S ∪ the ones on his own card
// (src/team-roster.ts) — so assigning a job is all a new employee needs.

export const JOB_MODEL = "hr.job";
export const EMPLOYEE_MODEL = "hr.employee";
export const ROLE_MODEL = "x_employee_role";
export const CALENDAR_MODEL = "resource.calendar";
export const COST_MODEL = "x_operating_cost";
export const TPL_MODEL = "x_whatsapp_template";
export const COMPANY = 1;

/** [أ 1] — the fields of the job (the roles: the same values and the same kind of field as «أدوار UTAK» on the card). */
export const JOB_FIELDS = [
  {
    name: "x_job_role_ids", ttype: "many2many", relation: ROLE_MODEL, relation_table: "x_hr_job_utak_role_rel", column1: "hr_job_id", column2: "x_employee_role_id",
    field_description: "أدوار الوظيفة",
    help: "ما يحمله كل من يشغل هذه الوظيفة: مهام واتساب تتبع هذه الأدوار (سائق، شراء، محصّل، تسويق). تُضاف إليها «أدوار إضافية» على بطاقة الموظف.",
  },
  {
    name: "x_default_calendar_id", ttype: "many2one", relation: CALENDAR_MODEL, on_delete: "set null",
    field_description: "جدول الدوام الافتراضي",
    help: "دوام من يشغل الوظيفة ما لم يُختر له جدول خاص على بطاقته (جدول Odoo الافتراضي «40 hours/week» على البطاقة لا يُعدّ اختياراً).",
  },
  { name: "x_job_attendance", ttype: "boolean", field_description: "مشمول بالتحضير", help: "من يشغل الوظيفة يصله «بدء الدوام» مع بداية دوامه، ومهامه بعد ضغطه. يكفي أن يكون مفعّلاً هنا أو على بطاقة الموظف." },
  { name: "x_responsibilities", ttype: "html", field_description: "المسؤوليات" },
  { name: "x_day_by_hour", ttype: "html", field_description: "يومه ساعة بساعة" },
  { name: "x_kpis", ttype: "html", field_description: "مقاييس الأداء" },
  { name: "x_takeover_list", ttype: "html", field_description: "قائمة الاستلام", help: "نقاط: تصل براء مع رسالة «👤 صار …» حين تُسند الوظيفة لموظف." },
  { name: "x_handover_list", ttype: "html", field_description: "قائمة التسليم", help: "نقاط: تصل براء حين تُزال الوظيفة عن موظف أو يُؤرشف، ومعها ما يقرؤه النظام من عهدة وتحصيل ومسار وشراء." },
  { name: "x_required_docs", ttype: "text", field_description: "المستندات المطلوبة" },
  { name: "x_salary_from", ttype: "float", field_description: "نطاق الراتب من" },
  { name: "x_salary_to", ttype: "float", field_description: "نطاق الراتب إلى" },
  { name: "x_fixed_costs", ttype: "float", field_description: "تكاليف ثابتة على الوظيفة (تأمينات، إقامة)" },
];
/** [د 3] — what ties a cost line to a job or to an employee (the daily data check reads them; nothing fills them). */
export const COST_FIELDS = [
  { name: "x_job_id", ttype: "many2one", relation: JOB_MODEL, on_delete: "set null", field_description: "الوظيفة", help: "الوظيفة التي يخصها هذا البند (راتب، تأمينات، إقامة). فحص البيانات اليومي يذكر الوظيفة المشغولة التي لا بند لها." },
  { name: "x_employee_id", ttype: "many2one", relation: EMPLOYEE_MODEL, on_delete: "set null", field_description: "الموظف", help: "الموظف الذي يخصه هذا البند، إن كان باسمه. فحص البيانات اليومي يذكر البند الساري لموظف غير نشط." },
];

/** [ب 1] — the card's field keeps its technical name and its values; its title says what it is now. */
export const CARD_ROLES_FIELD = "x_utak_role_ids";
export const CARD_ROLES_LABEL = "أدوار إضافية (خارج الوظيفة)";
export const CARD_ROLES_LABEL_BEFORE = "أدوار UTAK";

// ---------------------------------------------------------------- the views
export const JOB_FORM_VIEW = 1521;             // hr.job.form
export const JOB_FORM_EXT = "utak.hr_job_form.s61";
export const jobFormExtArch = () => `<data>
  <xpath expr="//notebook" position="before">
    <group name="utak_job">
      <group string="ما يتبع الوظيفة آلياً">
        <field name="x_job_role_ids" widget="many2many_tags" options="{'color_field': 'x_color', 'no_create_edit': True}"/>
        <field name="x_default_calendar_id" options="{'no_create': True}"/>
        <field name="x_job_attendance" widget="boolean_toggle"/>
        <field name="employee_ids" string="يشغلها الآن" widget="many2many_tags" readonly="1"/>
      </group>
      <group string="الراتب والتكاليف (يملؤها براء)">
        <field name="x_salary_from"/>
        <field name="x_salary_to"/>
        <field name="x_fixed_costs"/>
      </group>
    </group>
    <div class="text-muted mb-3" name="utak_job_note">من يُختار له هذه الوظيفة على بطاقته يحمل أدوارها ودوامها خلال خمس دقائق، بلا أي إعداد آخر. «أدوار إضافية» على بطاقة الموظف تُضاف إلى أدوار الوظيفة. وظيفة لها أدوار ولا يشغلها أحد تظهر في ملخص 21:30 «وظيفة شاغرة».</div>
  </xpath>
  <xpath expr="//notebook" position="inside">
    <page string="المسؤوليات" name="utak_responsibilities"><field name="x_responsibilities" nolabel="1"/></page>
    <page string="يومه ساعة بساعة" name="utak_day"><field name="x_day_by_hour" nolabel="1"/></page>
    <page string="مقاييس الأداء" name="utak_kpis"><field name="x_kpis" nolabel="1"/></page>
    <page string="الاستلام والتسليم" name="utak_moves">
      <separator string="قائمة الاستلام (تصل براء حين يدخل موظف)"/>
      <field name="x_takeover_list" nolabel="1"/>
      <separator string="قائمة التسليم (تصل براء حين يخرج)"/>
      <field name="x_handover_list" nolabel="1"/>
      <separator string="المستندات المطلوبة"/>
      <field name="x_required_docs" nolabel="1"/>
    </page>
  </xpath>
</data>`;

export const JOB_LIST_VIEW = "utak.hr_job_list";
export const jobListArch = () => `<list string="الوظائف">
  <field name="sequence" widget="handle"/>
  <field name="name" string="الوظيفة"/>
  <field name="x_job_role_ids" string="الأدوار" widget="many2many_tags" options="{'color_field': 'x_color'}"/>
  <field name="x_default_calendar_id" string="الدوام الافتراضي"/>
  <field name="x_job_attendance" string="مشمول بالتحضير" widget="boolean_toggle" readonly="1"/>
  <field name="employee_ids" string="يشغلها الآن" widget="many2many_tags"/>
</list>`;
export const JOB_ACTION = "UTAK — الوظائف";
export const TEAM_MENU = 546;                  // UTAK ← 🚚 التوصيل والفريق
export const JOB_MENU = { name: "الوظائف", sequence: 11 };   // right after «الموظفين» (10)

/** The card: the job first, in the team's own group; and the team's list and cards name it. */
export const EMPLOYEE_FORM_TEAM_VIEW = 2829;   // utak.hr_employee_form.team
export const EMPLOYEE_FORM_EXT = "utak.hr_employee_form.s61_job";
export const employeeFormExtArch = () => `<data>
  <xpath expr="//field[@name='x_utak_role_ids']" position="before">
    <field name="job_id" string="الوظيفة" options="{'no_create': True}"/>
  </xpath>
</data>`;
export const EMPLOYEE_LIST_VIEW = 2831;        // utak.hr_employee_list
export const EMPLOYEE_LIST_EXT = "utak.hr_employee_list.s61_job";
export const employeeListExtArch = () => `<data>
  <xpath expr="//field[@name='x_utak_role_ids']" position="before">
    <field name="job_id" string="الوظيفة"/>
  </xpath>
  <xpath expr="//field[@name='x_utak_role_ids']" position="attributes">
    <attribute name="string">أدوار إضافية</attribute>
  </xpath>
</data>`;
export const EMPLOYEE_KANBAN_VIEW = 2830;      // utak.hr_employee_kanban
export const EMPLOYEE_KANBAN_EXT = "utak.hr_employee_kanban.s61_job";
export const employeeKanbanExtArch = () => `<data>
  <xpath expr="//templates//div[hasclass('fw-bold')]" position="after">
    <div class="mb-1"><i class="fa fa-briefcase me-1"/><field name="job_id"/></div>
  </xpath>
</data>`;
/** «UTAK — الموظفين» listed the employees with a role on their card: a job's holder with an empty card must stay in it. */
export const EMPLOYEE_ACTION = 995;
export const EMPLOYEE_ACTION_DOMAIN_BEFORE = "[('x_utak_role_ids', '!=', False)]";
export const EMPLOYEE_ACTION_DOMAIN = "['|', ('x_utak_role_ids', '!=', False), ('job_id', '!=', False)]";

/** The cost lines of «⚙️ الإعدادات»: the job and the employee of a line, after its dates. */
export const SETTINGS_VIEW = 2855;
export const SETTINGS_COST_EXT = "utak.pricing_settings_form.s61_cost_links";
export const settingsCostExtArch = () => `<data>
  <xpath expr="//field[@name='x_cost_line_ids']/list/field[@name='x_date_to']" position="after">
    <field name="x_job_id" optional="show" options="{'no_create': True}"/>
    <field name="x_employee_id" optional="show" options="{'no_create': True}"/>
  </xpath>
</data>`;

/** Odoo's three sample jobs (their sample employees are archived since § 32): archived, so «الوظائف» lists UTAK's own. */
export const SAMPLE_JOBS = [1, 2, 3];

// ---------------------------------------------------------------- the four jobs
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const DOCS = "صورة الهوية أو الإقامة\nرقم واتساب خاص به\nالآيبان (لتحويل الراتب)\nعقد العمل موقّعاً";
const PROFIT = "معادلة الربح: الكمية × مساهمة الكرتون − التشغيل.";

/**
 * [ج] — the four jobs. `roles`: codes of x_employee_role. `calendar`: the NAME of its default schedule
 * (null = none). `holder`: the hr.employee it is assigned to now (null = vacant). The texts are a
 * first draft for Baraa to review, from docs/OPERATING-DAY.md and what the worker does.
 */
export const JOBS = [
  {
    key: "operations", name: "مندوب تشغيل", sequence: 10, roles: ["driver", "warehouse", "collector"], calendar: "UTAK — أيام العمل", attendance: true, holder: 6,
    responsibilities: [
      "يشتري طلبات اليوم من السوق حسب قائمة الشراء، ويستلمها ويطابق الكميات.",
      "يطلب فاتورة الشراء الضريبية من البائع باسم يوتاك ورقمها الضريبي، ويرفع صورتها.",
      "يحمّل السيارة ويوصّل الطلبات بترتيب المسار، ويسجّل عند كل عميل ما سُلّم فعلاً.",
      "يحصّل الفواتير نقداً أو تحويلاً، ويسجّل كل مبلغ في وقته من الزر.",
      "يسلّم عهدة الكاش آخر الدوام، ويبلّغ عن أي مشكلة فوراً من زر «فيه مشكلة ⚠️».",
    ],
    day: [
      "02:00 — يصله «بدء الدوام». يضغطه فتصله مهامه: قائمة الشراء المفتوحة، والتحصيلات غير المحصّلة، وما حُفظ له.",
      "بعد 02:00 — الشراء من السوق، ثم «📥 استلام المشتريات»: المستلم فعلاً من كل صنف، ومشتريات السوق النقدي، وصورة الفاتورة.",
      "قبل الخروج — يكتب «حمولة» ويسجّل المحمَّل من كل صنف.",
      "مع المسار — لكل محطة موقعها وإذن التسليم، ثم «📦 سلّم وحصّل» عند العميل: المسلَّم، وسبب أي نقص، وطريقة الدفع والمبلغ.",
      "11:30 — تذكير بالمحطات الباقية قبل نهاية الدوام (12:00).",
      "آخر الدوام — «نهاية الحمولة» (الباقي والتالف)، ثم «عهدة» (الكاش المسلَّم وطريقته).",
      "18:00 — «📋 قائمة التحصيل اليومية» بالفواتير غير المحصّلة.",
      "21:15 — قائمة شراء الغد.",
    ],
    kpis: [
      PROFIT,
      "التسليم في وقته: كم محطة سُلّمت قبل 12:00 من محطات اليوم. الطلب المتأخر كمية مهددة.",
      "التالف والمرتجع: كراتين «تالف» و«رفضه العميل» في نموذج التسليم، والتالف في «نهاية الحمولة». كل كرتون تالف ينقص المساهمة.",
      "التحصيل وأيامه: المحصَّل من المستحق، وكم يوماً بين الفاتورة وتحصيلها.",
      "فرق العهدة: الفرق بين الكاش المتوقع والمسلَّم. الهدف صفر كل يوم.",
    ],
    takeover: [
      "رقم واتسابه على جهة اتصاله، ويضغط أول «بدء الدوام» يصله.",
      "مفاتيح المركبة ووثائقها (الاستمارة والتأمين) إن وُجدت.",
      "العهدة والكاش: يبدأ من صفر، ويُتفق على طريقة التسليم اليومي (إيداع بنكي أو تسليم لبراء).",
      "التحصيلات المفتوحة: الفواتير غير المحصّلة تصله مع «بدء الدوام».",
      "المسار وأحياء التوصيل، وقائمة الشراء المفتوحة.",
      "شرح النماذج الأربعة: «استلام المشتريات»، و«سلّم وحصّل»، و«حمولة»، و«عهدة».",
    ],
    handover: [
      "العهدة والكاش: يسلّم كل ما معه، ويُطابَق بالمتوقع.",
      "مفاتيح المركبة ووثائقها إن وُجدت.",
      "التحصيلات المفتوحة: ما حصّله ولم يسجّله، وما بقي على العملاء.",
      "المسار: المحطات التي لم تُسلَّم، وأين بضاعتها.",
      "قائمة الشراء غير المستلمة، وفواتير الشراء التي لم تُرفع صورها.",
    ],
    docs: `${DOCS}\nرخصة قيادة سارية`,
  },
  {
    key: "marketing", name: "مندوب تسويق", sequence: 20, roles: ["marketing"], calendar: "UTAK — عمر", attendance: false, holder: 4,
    responsibilities: [
      "يزور المحلات (مطاعم، ومحلات عصير، وبقالات) ويعرض أسعار اليوم.",
      "يعيد إرسال «📋 قائمة أسعار يو تاك اليوم» للمحلات كما هي.",
      "يساعد المحل الجديد على أول طلب من واتساب يو تاك (الرابط في القائمة).",
      "يرجع للعملاء الذين توقفوا عن الطلب ويعرف السبب.",
      "لا يرى إلا سعر البيع: لا شراء ولا سوق ولا ربح.",
    ],
    day: [
      "06:00، ومع كل نشر — تصله «📋 قائمة أسعار يو تاك اليوم». نافذته مغلقة: قالب بزر «أرسل القائمة».",
      "خلال اليوم — زيارات المحلات وإرسال القائمة.",
      "في أي وقت — يكتب «الأسعار» أو «القائمة» فتصله القائمة الصالحة.",
      "لا «بدء الدوام»، ولا مهام تشغيل.",
    ],
    kpis: [
      PROFIT,
      "محلات زارها في الأسبوع.",
      "عملاء جدد سجّلوا من زياراته.",
      "أول طلب: كم عميلاً جديداً أكمل أول طلب.",
      "الطلب المتكرر: كم عميلاً طلب مرة ثانية خلال أسبوعين. كلها تزيد الكمية.",
    ],
    takeover: [
      "رقم واتسابه على جهة اتصاله، ويكتب «الأسعار» مرة ليتأكد أن القائمة تصله.",
      "قائمة العملاء الحاليين وأحياؤهم.",
      "شرح طريقة الطلب: رابط واتساب يو تاك، ونموذج «اطلب الآن».",
    ],
    handover: [
      "المحلات التي زارها وحالة كل واحد.",
      "العملاء الموعودون بزيارة أو عرض.",
      "أي مواد تسويق أو عينات معه.",
    ],
    docs: DOCS,
  },
  {
    key: "coordinator", name: "منسق عمليات", sequence: 30, roles: ["admin"], calendar: "UTAK — عثمان", attendance: false, holder: 5,
    responsibilities: [
      "يتابع الطلبات التي لم تتأكد أو بقيت بلا رد.",
      "يتابع الشكاوى حتى تُغلق.",
      "يكمل البيانات الناقصة في Odoo: بطاقات العملاء، والأصناف، والأرقام الجديدة.",
      "يرفع لبراء ما يحتاج قراراً. لا مهام واتساب آلية لهذه الوظيفة.",
    ],
    day: [
      "06:00 — «بدء الدوام» (لمن هو مشمول بالتحضير على بطاقته).",
      "الصباح — «طلبات اليوم» و«📋 مراجعة الأرقام».",
      "خلال اليوم — «الشكاوى» والبيانات الناقصة.",
      "قبل 16:00 — ما بقي مفتوحاً يُكتب لبراء.",
    ],
    kpis: [
      PROFIT,
      "طلبات بلا متابعة: كم طلباً بقي بلا تأكيد أو رد. الهدف صفر.",
      "شكاوى مغلقة: عددها، وكم يوماً أخذ إغلاقها.",
      "بيانات ناقصة: أصناف وعملاء حالتهم «ناقص». تحمي الكمية وتقلل التالف.",
    ],
    takeover: [
      "رقم واتسابه على جهة اتصاله.",
      "الدخول على Odoo إن لزم عمله.",
      "الشكاوى المفتوحة والأرقام التي تنتظر المراجعة.",
      "الأصناف والعملاء الناقصة بياناتهم.",
    ],
    handover: [
      "الشكاوى المفتوحة وحالة كل واحدة.",
      "الطلبات التي تنتظر متابعة.",
      "البيانات التي بدأ إكمالها ولم تنتهِ.",
      "إيقاف دخوله على Odoo.",
    ],
    docs: DOCS,
  },
  {
    key: "driver", name: "سائق توصيل", sequence: 40, roles: ["driver"], calendar: "UTAK — أيام العمل", attendance: true, holder: null,
    responsibilities: [
      "يوصّل الطلبات بترتيب المسار.",
      "يسجّل عند كل عميل ما سُلّم فعلاً وسبب أي نقص، والدفع إن دفع العميل.",
      "يبلّغ عن أي مشكلة فوراً من زر «فيه مشكلة ⚠️».",
      "يحافظ على المركبة والبضاعة.",
    ],
    day: [
      "02:00 — يصله «بدء الدوام». يضغطه فتصله مهامه.",
      "قبل الخروج — يكتب «حمولة» ويسجّل المحمَّل من كل صنف.",
      "مع المسار — لكل محطة موقعها وإذن التسليم، ثم «📦 سلّم وحصّل» عند العميل.",
      "11:30 — تذكير بالمحطات الباقية قبل نهاية الدوام (12:00).",
      "آخر الدوام — «نهاية الحمولة» (الباقي والتالف).",
    ],
    kpis: [
      PROFIT,
      "التسليم في وقته: كم محطة سُلّمت قبل 12:00 من محطات اليوم.",
      "التالف والمرتجع: كراتين «تالف» و«رفضه العميل» في نموذج التسليم، والتالف في «نهاية الحمولة».",
    ],
    takeover: [
      "رقم واتسابه على جهة اتصاله، ويضغط أول «بدء الدوام» يصله.",
      "مفاتيح المركبة ووثائقها (الاستمارة والتأمين) إن وُجدت.",
      "المسار وأحياء التوصيل.",
      "شرح «سلّم وحصّل» و«حمولة».",
    ],
    handover: [
      "مفاتيح المركبة ووثائقها إن وُجدت.",
      "المسار: المحطات التي لم تُسلَّم، وأين بضاعتها.",
      "العهدة والكاش: أي مبلغ استلمه من عميل ولم يسلّمه.",
    ],
    docs: `${DOCS}\nرخصة قيادة سارية`,
  },
];
/** The job's texts as Odoo keeps them (HTML lists; the documents are plain lines). */
export const jobContent = (j) => ({
  x_responsibilities: ul(j.responsibilities), x_day_by_hour: ul(j.day), x_kpis: ul(j.kpis),
  x_takeover_list: ul(j.takeover), x_handover_list: ul(j.handover), x_required_docs: j.docs,
});
/** The text of an HTML field, tags out (what a check compares: Odoo's sanitizer may re-shape the markup). */
export const htmlText = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** The cost of the order's proof: 2026-10-06 = 641.23, before and after (scripts/s61-20261006-roles.mts). */
export const PROOF_DAY = "2026-10-06";
export const PROOF_COST = 641.23;
