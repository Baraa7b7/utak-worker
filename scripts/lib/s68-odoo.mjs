// § 68 (2026-10-08) — the employee's file in Odoo: the data of scripts/s68-20261008-odoo.mjs.
//
//   attendance   x_team_attendance (the rows the worker writes since § 29) gains «الخروج», «الساعات», «التأخير (دقيقة)»,
//                «المصدر», «ملاحظة», the two places, and the status «إجازة»; hr_attendance is NOT installed (no new app)
//   time off     resource.calendar.leaves gains «نوع الإجازة»
//   papers       on the card itself: Odoo's own fields where they exist (identification_id, id_card, passport_id,
//                passport_expiration_date, permit_no, work_permit_expiration_date, has_work_permit, contract_date_end,
//                driving_license) and an x_ field for what Odoo has none for; a state for each; «🗂️ اكتمال الأوراق ٪»
//   notes        x_employee_note (date, kind, text, attachment)
//   the screens  the employee's own form with six tabs, the list's columns, the filter «أوراق ناقصة»
//
// src/employee-file.ts carries the same list of papers (tests/s68-file compares the two).

export const ATT_MODEL = "x_team_attendance";
export const EMP_MODEL = "hr.employee";
export const LEAVE_MODEL = "resource.calendar.leaves";
export const NOTE_MODEL = "x_employee_note";
export const NOTE_MODEL_NAME = "UTAK — ملاحظات وإنذارات الموظف";
export const COST_MODEL = "x_operating_cost";
export const TEAM_MENU = 546;                 // UTAK ← 🚚 التوصيل والفريق
export const EMPLOYEE_MENU = 551;             // «الموظفين»
export const EMPLOYEE_MENU_NAME = "👥 الموظفون";
export const EMPLOYEE_ACTION = 995;           // UTAK — الموظفين
export const EMPLOYEE_LIST_VIEW = 2831;       // utak.hr_employee_list
export const EMPLOYEE_KANBAN_VIEW = 2830;     // utak.hr_employee_kanban
export const EMPLOYEE_SEARCH_VIEW = 2832;     // utak.hr_employee_search
export const NATIVE_EMPLOYEE_FORM = 1534;     // hr.employee.form
export const ATT_LIST_VIEW = 2823;            // x_team_attendance.list
export const ATT_SEARCH_VIEW = 2824;          // x_team_attendance.search
export const LEAVE_LIST_VIEW = 531;           // resource.calendar.leaves.list
export const LEAVE_FORM_VIEW = 530;           // resource.calendar.leaves.form
export const ADMIN_GROUP = "base.group_system";
export const ACTIVE_EMPLOYEES = [4, 5, 6];    // عمر، عثمان، براء

const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;
const pyDict = (pairs) => `{${pairs.map(([k, v]) => `'${k}': '${v}'`).join(", ")}}`;

export const SOURCES = [["whatsapp", "واتساب"], ["manual", "يدوي"]];
export const LEAVE_TYPES = [["annual", "سنوية"], ["sick", "مرضية"], ["unpaid", "بدون راتب"], ["emergency", "طارئة"], ["other", "أخرى"]];
export const DOC_STATES = [["missing", "ناقص"], ["progress", "قيد الإجراء"], ["done", "مكتمل"], ["na", "لا ينطبق"]];
export const NOTE_KINDS = [["note", "ملاحظة"], ["verbal", "تنبيه شفهي"], ["warning", "إنذار كتابي"], ["praise", "إشادة"]];
/** The status a day of time off gets (the worker writes it; Baraa may too). */
export const LEAVE_STATUS = { value: "leave", name: "إجازة", sequence: 4 };
/** x_tapped_at is the entry: its title says so. */
export const TAPPED_LABEL = "الدخول";
export const TAPPED_LABEL_BEFORE = "وقت الضغط";

/**
 * The papers of an employee. `number` / `expiry` / `file`: Odoo's own field where it has one, else an x_ field
 * this order creates. `role`: asked of the holder of that role alone. «أخرى» counts when it is named.
 */
export const DOCS = [
  { key: "id", title: "الإقامة / الهوية", number: "identification_id", expiry: "x_doc_id_expiry", file: "id_card", fileName: "id_card_name", state: "x_doc_id_state" },
  { key: "passport", title: "جواز السفر", number: "passport_id", expiry: "passport_expiration_date", file: "x_doc_passport_file", fileName: "x_doc_passport_file_name", state: "x_doc_passport_state" },
  { key: "permit", title: "تصريح العمل", number: "permit_no", expiry: "work_permit_expiration_date", file: "has_work_permit", fileName: "work_permit_name", state: "x_doc_permit_state" },
  { key: "contract", title: "عقد العمل", number: "x_doc_contract_no", expiry: "contract_date_end", file: "x_doc_contract_file", fileName: "x_doc_contract_file_name", state: "x_doc_contract_state" },
  { key: "gosi", title: "التأمينات", number: "x_doc_gosi_no", expiry: "x_doc_gosi_expiry", file: "x_doc_gosi_file", fileName: "x_doc_gosi_file_name", state: "x_doc_gosi_state" },
  { key: "health", title: "الشهادة الصحية", number: "x_doc_health_no", expiry: "x_doc_health_expiry", file: "x_doc_health_file", fileName: "x_doc_health_file_name", state: "x_doc_health_state" },
  { key: "license", title: "رخصة القيادة", number: "x_doc_license_no", expiry: "x_doc_license_expiry", file: "driving_license", fileName: "driving_license_name", state: "x_doc_license_state", role: "driver" },
  { key: "other", title: "أخرى", name: "x_doc_other_name", number: "x_doc_other_no", expiry: "x_doc_other_expiry", file: "x_doc_other_file", fileName: "x_doc_other_file_name", state: "x_doc_other_state" },
];
export const DOC_STATE_FIELDS = DOCS.map((d) => d.state);

// ---------------------------------------------------------------- computed fields (Odoo runs this Python)

/** «الساعات» = الخروج − الدخول. */
export const HOURS_CODE = `for r in self:
    r['x_hours'] = round((r.x_out_at - r.x_tapped_at).total_seconds() / 3600.0, 2) if r.x_tapped_at and r.x_out_at and r.x_out_at > r.x_tapped_at else 0.0`;

/** The papers asked of this employee: the six of everyone, the driver's licence, and «أخرى» when it is named — «لا ينطبق» left out. */
const ASKED = `    codes = set((r.job_id.x_job_role_ids | r.x_utak_role_ids).mapped('x_code'))
    docs = [${DOCS.filter((d) => !d.role && !d.name).map((d) => `('${d.state}', '${d.title}')`).join(", ")}]
    if 'driver' in codes:
        docs.append(('x_doc_license_state', 'رخصة القيادة'))
    if r.x_doc_other_name:
        docs.append(('x_doc_other_state', r.x_doc_other_name))
    docs = [d for d in docs if r[d[0]] != 'na']`;
export const DOCS_PCT_CODE = `for r in self:
${ASKED}
    r['x_docs_pct'] = int(100.0 * len([d for d in docs if r[d[0]] == 'done']) / len(docs) + 0.5) if docs else 100`;
export const DOCS_MISSING_CODE = `for r in self:
${ASKED}
    r['x_docs_missing'] = '، '.join([d[1] + (' (قيد الإجراء)' if r[d[0]] == 'progress' else '') for d in docs if r[d[0]] != 'done']) or False`;
export const DOCS_DEPENDS = [...DOC_STATE_FIELDS, "x_doc_other_name", "job_id", "job_id.x_job_role_ids", "x_utak_role_ids"].join(",");
export const NEXT_EXPIRY_CODE = `for r in self:
    ds = [p[1] for p in [${DOCS.map((d) => `(r.${d.state}, r.${d.expiry})`).join(", ")}] if p[1] and p[0] != 'na']
    r['x_docs_next_expiry'] = min(ds) if ds else False`;

/** This month (Riyadh) of the employee's attendance rows — simulation rows never count. */
const monthCode = (field, expr) => `today = (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).date()
ids = [i for i in self.ids if isinstance(i, int)]
rows = self.env['${ATT_MODEL}'].search([('x_employee_id', 'in', ids), ('x_date', '>=', today.replace(day=1)), ('x_date', '<=', today), ('x_utak_simulation', '!=', True)]) if ids else self.env['${ATT_MODEL}']
for r in self:
    mine = rows.filtered(lambda a: a.x_employee_id.id == r.id)
    r['${field}'] = ${expr}`;
export const MONTH_FIELDS = [
  { name: "x_att_present", ttype: "integer", field_description: "حضور الشهر (يوم)", expr: "len(mine.filtered(lambda a: a.x_status in ('present', 'late')))" },
  { name: "x_att_late", ttype: "integer", field_description: "التأخير (يوم)", expr: "len(mine.filtered(lambda a: a.x_status == 'late'))" },
  { name: "x_att_late_min", ttype: "integer", field_description: "دقائق التأخير", expr: "int(sum(mine.filtered(lambda a: a.x_status == 'late').mapped('x_late_min')))" },
  { name: "x_att_absent", ttype: "integer", field_description: "الغياب (يوم)", expr: "len(mine.filtered(lambda a: a.x_status == 'absent'))" },
  { name: "x_att_leave", ttype: "integer", field_description: "الإجازة (يوم)", expr: "len(mine.filtered(lambda a: a.x_status == 'leave'))" },
  { name: "x_att_hours", ttype: "float", field_description: "الساعات", expr: "round(sum(mine.mapped('x_hours')), 2)" },
];

export const LEAVES_TEXT_CODE = `T = ${pyDict(LEAVE_TYPES)}
for r in self:
    out = []
    if r.resource_id:
        for l in self.env['${LEAVE_MODEL}'].search([('resource_id', '=', r.resource_id.id)], order='date_from desc', limit=12):
            a = (l.date_from + datetime.timedelta(hours=3)).strftime('%Y-%m-%d')
            b = (l.date_to + datetime.timedelta(hours=3)).strftime('%Y-%m-%d')
            out.append('• ' + (T.get(l.x_leave_type) or 'إجازة') + ': ' + (a if a == b else a + ' ← ' + b) + ((' — ' + l.name) if l.name else ''))
    r['x_leaves_text'] = '\\n'.join(out) or 'لا إجازات مسجّلة.'`;

export const NO_COST_TEXT = "لا بند تكلفة مربوط بهذا الموظف أو بوظيفته. يُربط من «💲 التسعير ← ⚙️ الإعدادات» (عمودا «الوظيفة» و«الموظف» في جدول التكاليف).";
export const COST_TEXT_CODE = `F = {'daily': 'يومياً', 'monthly': 'شهرياً', 'yearly': 'سنوياً'}
today = (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).date()
for r in self:
    out = []
    if isinstance(r.id, int):
        dom = ['|', ('x_employee_id', '=', r.id), ('x_job_id', '=', r.job_id.id)] if r.job_id else [('x_employee_id', '=', r.id)]
        for c in self.env['${COST_MODEL}'].search(dom + [('x_utak_simulation', '!=', True)]):
            live = (not c.x_date_from or c.x_date_from <= today) and (not c.x_date_to or c.x_date_to >= today)
            out.append('• ' + (c.x_name or '') + ': ' + ('%.2f' % (c.x_amount or 0)) + ' ر.س ' + (F.get(c.x_frequency) or '') + ('' if live else ' (غير سارٍ اليوم)'))
    r['x_cost_text'] = '\\n'.join(out) or '${NO_COST_TEXT}'`;

// ---------------------------------------------------------------- the fields

export const ATT_FIELDS = [
  { name: "x_out_at", ttype: "datetime", field_description: "الخروج", help: "وقت «🏁 انتهى دوامي» من واتساب، أو ما يكتبه براء باليد." },
  { name: "x_hours", ttype: "float", field_description: "الساعات", compute: HOURS_CODE, depends: "x_tapped_at,x_out_at", store: true, readonly: true },
  { name: "x_late_min", ttype: "integer", field_description: "التأخير (دقيقة)", help: "الدقائق بعد بداية الدوام حين الحالة «متأخر» (أكثر من 15 دقيقة)، وإلا صفر. يكتبها النظام عند الدخول، وتُعدَّل باليد." },
  { name: "x_source", ttype: "selection", selection: sel(SOURCES), field_description: "المصدر", help: "«واتساب»: سجّله الموظف من محادثته. «يدوي»: أضافه أو عدّله براء هنا." },
  { name: "x_note", ttype: "char", field_description: "ملاحظة" },
  { name: "x_in_map", ttype: "char", field_description: "موقع الدخول", help: "رابط الموقع إن أرسله الموظف بعد «بدأت الدوام» (اختياري)." },
  { name: "x_out_map", ttype: "char", field_description: "موقع الخروج", help: "رابط الموقع إن أرسله الموظف بعد «انتهى دوامي» (اختياري)." },
];
export const LEAVE_FIELDS = [
  { name: "x_leave_type", ttype: "selection", selection: sel(LEAVE_TYPES), field_description: "نوع الإجازة" },
];
export const NOTE_FIELDS = [
  { name: "x_employee_id", ttype: "many2one", relation: EMP_MODEL, on_delete: "cascade", required: true, field_description: "الموظف" },
  { name: "x_date", ttype: "date", required: true, field_description: "التاريخ" },
  { name: "x_kind", ttype: "selection", selection: sel(NOTE_KINDS), required: true, field_description: "النوع" },
  { name: "x_text", ttype: "text", field_description: "النص" },
  { name: "x_file", ttype: "binary", field_description: "المرفق" },
  { name: "x_file_name", ttype: "char", field_description: "اسم المرفق" },
];
const docField = (d, what) => `${what} — ${d.title}`;
/** The card: an x_ field for every paper's part Odoo has no field of its own for, and a state for each. */
export const DOC_FIELDS = DOCS.flatMap((d) => [
  d.name ? { name: d.name, ttype: "char", field_description: "اسم الورقة — أخرى" } : null,
  d.number.startsWith("x_") ? { name: d.number, ttype: "char", field_description: docField(d, "الرقم") } : null,
  d.expiry.startsWith("x_") ? { name: d.expiry, ttype: "date", field_description: docField(d, "الانتهاء") } : null,
  d.file.startsWith("x_") ? { name: d.file, ttype: "binary", field_description: docField(d, "المرفق") } : null,
  d.fileName.startsWith("x_") ? { name: d.fileName, ttype: "char", field_description: docField(d, "اسم المرفق") } : null,
  { name: d.state, ttype: "selection", selection: sel(DOC_STATES), field_description: docField(d, "الحالة") },
].filter(Boolean));
export const EMP_FIELDS = [
  ...DOC_FIELDS,
  { name: "x_docs_pct", ttype: "integer", field_description: "🗂️ اكتمال الأوراق ٪", compute: DOCS_PCT_CODE, depends: DOCS_DEPENDS, store: true, readonly: true, help: "المكتمل من الأوراق المطلوبة: الست لكل موظف، ورخصة القيادة لحامل دور «سائق»، و«أخرى» إن سُمّيت. «لا ينطبق» خارج الحساب." },
  { name: "x_docs_missing", ttype: "char", field_description: "الأوراق الناقصة", compute: DOCS_MISSING_CODE, depends: DOCS_DEPENDS, store: true, readonly: true },
  { name: "x_docs_next_expiry", ttype: "date", field_description: "أقرب انتهاء ورقة", compute: NEXT_EXPIRY_CODE, depends: [...DOCS.map((d) => d.expiry), ...DOC_STATE_FIELDS].join(","), store: false, readonly: true },
  ...MONTH_FIELDS.map((f) => ({ name: f.name, ttype: f.ttype, field_description: f.field_description, compute: monthCode(f.name, f.expr), depends: "name", store: false, readonly: true })),
  { name: "x_attendance_ids", ttype: "one2many", relation: ATT_MODEL, relation_field: "x_employee_id", field_description: "سجل الحضور" },
  { name: "x_note_ids", ttype: "one2many", relation: NOTE_MODEL, relation_field: "x_employee_id", field_description: "الملاحظات والإنذارات" },
  { name: "x_leaves_text", ttype: "text", field_description: "الإجازات المسجّلة", compute: LEAVES_TEXT_CODE, depends: "resource_id", store: false, readonly: true },
  { name: "x_cost_text", ttype: "text", field_description: "بند التكلفة (الراتب)", compute: COST_TEXT_CODE, depends: "job_id", store: false, readonly: true },
  { name: "x_custody_text", ttype: "text", field_description: "العهدة والمستحقات", help: "يكتبه النظام مرة في اليوم ومع «🔄 حدّث الأرقام»: الكاش الذي حصّله من «التحصيلات»، ورصيد يومية كاش السائق، وأين يُسجَّل تسليم العهدة." },
  { name: "x_perf_text", ttype: "text", field_description: "الأداء", help: "يكتبه النظام مما هو مسجّل فعلاً: رقم حين توجد بيانات، و«لا بيانات بعد» حين لا." },
  { name: "x_file_at", ttype: "datetime", field_description: "آخر تحديث للأرقام" },
];

// ---------------------------------------------------------------- the screens

export const FORM_VIEW = "utak.hr_employee_form.file";
const docGroup = (d) => `          <group string="${d.title}${d.role ? " (للسائق)" : ""}">
${d.name ? `            <field name="${d.name}" string="اسم الورقة"/>\n` : ""}            <field name="${d.number}" string="الرقم"/>
            <field name="${d.expiry}" string="تاريخ الانتهاء"/>
            <field name="${d.state}" string="الحالة"/>
            <field name="${d.fileName}" invisible="1"/>
            <field name="${d.file}" string="المرفق" filename="${d.fileName}"/>
          </group>`;
/** The employee's own form: six tabs. `refreshAction`: the id of «🔄 حدّث الأرقام» (null before the worker's deploy). */
export const formArch = (refreshAction = null) => `<form string="ملف الموظف">
  <sheet>
    <field name="company_id" invisible="1"/>
    <field name="resource_id" invisible="1"/>
    <div class="oe_title">
      <h1><field name="name" placeholder="اسم الموظف"/></h1>
      <h3><field name="job_id" options="{'no_create': True}" placeholder="الوظيفة"/></h3>
    </div>
    <notebook>
      <page string="البيانات" name="utak_data">
        <group>
          <group string="الوظيفة والأدوار">
            <field name="x_utak_role_ids" widget="many2many_tags" options="{'color_field': 'x_color', 'no_create_edit': True}"/>
            <field name="x_utak_attendance" widget="boolean_toggle"/>
            <field name="resource_calendar_id" string="جدول الدوام"/>
            <field name="contract_date_start" string="تاريخ البدء"/>
            <field name="x_price_source" widget="boolean_toggle"/>
            <field name="x_price_role" invisible="not x_price_source"/>
          </group>
          <group string="التواصل">
            <field name="work_contact_id" string="جهة اتصال واتساب" options="{'no_create': True}"/>
            <field name="x_utak_whatsapp" string="الهاتف (واتساب)" readonly="1"/>
            <field name="x_utak_neighborhood_ids" widget="many2many_tags"/>
          </group>
        </group>
      </page>
      <page string="الحضور" name="utak_attendance">
        <group string="هذا الشهر" col="6">
          <field name="x_att_present"/>
          <field name="x_att_late"/>
          <field name="x_att_late_min"/>
          <field name="x_att_absent"/>
          <field name="x_att_leave"/>
          <field name="x_att_hours"/>
        </group>
        <field name="x_attendance_ids" context="{'default_x_source': 'manual'}">
          <list editable="top" default_order="x_date desc, id desc" limit="31" decoration-danger="x_status == 'absent'" decoration-warning="x_status == 'late'" decoration-info="x_status == 'leave'" decoration-muted="x_utak_simulation">
            <field name="x_date"/>
            <field name="x_status"/>
            <field name="x_shift_at" string="بداية الدوام" optional="show"/>
            <field name="x_tapped_at"/>
            <field name="x_out_at"/>
            <field name="x_hours" sum="المجموع"/>
            <field name="x_late_min" sum="المجموع"/>
            <field name="x_source"/>
            <field name="x_note"/>
            <field name="x_in_map" widget="url" optional="hide"/>
            <field name="x_out_map" widget="url" optional="hide"/>
            <field name="x_utak_simulation" optional="show"/>
          </list>
        </field>
        <separator string="الإجازات"/>
        <field name="x_leaves_text" nolabel="1"/>
        <div class="text-muted">الإجازة (نوعها، من، إلى) تُسجَّل من «🚚 التوصيل والفريق ← إجازات الفريق»: يومها لا رسالة «بدء الدوام» ولا غياب. صفوف «محاكاة» لا تدخل أرقام الشهر.</div>
      </page>
      <page string="الأوراق" name="utak_docs">
        <group>
          <group>
            <field name="x_docs_pct" widget="progressbar"/>
            <field name="x_docs_next_expiry"/>
          </group>
          <group>
            <field name="x_docs_missing"/>
          </group>
        </group>
        <group>
${DOCS.map(docGroup).join("\n")}
        </group>
      </page>
      <page string="العهدة والمستحقات" name="utak_custody" groups="${ADMIN_GROUP}">
        <field name="x_custody_text" readonly="1" nolabel="1" placeholder="تُكتب مع أول تحديث يومي، أو بزر «🔄 حدّث الأرقام»."/>
        <separator string="بند التكلفة (الراتب) من جدول التكاليف"/>
        <field name="x_cost_text" nolabel="1"/>
        <group>
          <field name="x_file_at" readonly="1"/>
        </group>
${refreshAction ? `        <button name="${refreshAction}" type="action" string="🔄 حدّث الأرقام" class="btn-secondary"/>\n` : ""}      </page>
      <page string="الأداء" name="utak_perf">
        <field name="x_perf_text" readonly="1" nolabel="1" placeholder="تُكتب مع أول تحديث يومي: رقم حين توجد بيانات، و«لا بيانات بعد» حين لا."/>
        <div class="text-muted">يُحسب مما هو مسجّل فعلاً (المسارات، المرتجعات والملاحظات، التحصيلات، تسليم العهدة). مقاييس الوظيفة نصاً في «الوظائف».</div>
      </page>
      <page string="الملاحظات والإنذارات" name="utak_notes">
        <field name="x_note_ids" context="{'default_x_date': context_today().strftime('%Y-%m-%d'), 'default_x_kind': 'note'}">
          <list editable="top" default_order="x_date desc, id desc" decoration-danger="x_kind == 'warning'" decoration-warning="x_kind == 'verbal'" decoration-success="x_kind == 'praise'">
            <field name="x_date"/>
            <field name="x_kind"/>
            <field name="x_text"/>
            <field name="x_file_name" column_invisible="1"/>
            <field name="x_file" filename="x_file_name"/>
          </list>
        </field>
      </page>
    </notebook>
  </sheet>
</form>`;

export const LIST_EXT = "utak.hr_employee_list.s68_file";
export const listExtArch = () => `<data>
  <xpath expr="//field[@name='job_id']" position="after">
    <field name="x_att_present" string="حضور الشهر"/>
    <field name="x_att_late" string="التأخير"/>
    <field name="x_docs_pct" string="اكتمال الأوراق ٪" widget="progressbar"/>
    <field name="x_docs_next_expiry" string="أقرب انتهاء ورقة"/>
  </xpath>
</data>`;
export const SEARCH_EXT = "utak.hr_employee_search.s68_docs";
export const searchExtArch = () => `<data>
  <xpath expr="/search" position="inside">
    <separator/>
    <filter name="utak_docs_missing" string="أوراق ناقصة" domain="[('x_docs_pct', '&lt;', 100)]"/>
  </xpath>
</data>`;
export const ATT_LIST_EXT = "x_team_attendance.list.s68";
export const attListExtArch = () => `<data>
  <xpath expr="/list" position="attributes">
    <attribute name="create">1</attribute>
    <attribute name="editable">top</attribute>
    <attribute name="decoration-info">x_status == 'leave'</attribute>
  </xpath>
  <xpath expr="//field[@name='x_tapped_at']" position="after">
    <field name="x_out_at"/>
    <field name="x_hours" sum="المجموع"/>
    <field name="x_late_min"/>
  </xpath>
  <xpath expr="//field[@name='x_status']" position="after">
    <field name="x_source"/>
    <field name="x_note"/>
    <field name="x_in_map" widget="url" optional="hide"/>
    <field name="x_out_map" widget="url" optional="hide"/>
    <field name="x_utak_simulation" optional="hide"/>
  </xpath>
</data>`;
export const ATT_SEARCH_EXT = "x_team_attendance.search.s68";
export const attSearchExtArch = () => `<data>
  <xpath expr="//filter[@name='present']" position="after">
    <filter name="leave" string="إجازة" domain="[('x_status', '=', 'leave')]"/>
    <separator/>
    <filter name="manual" string="يدوي" domain="[('x_source', '=', 'manual')]"/>
    <filter name="not_sim" string="بلا المحاكاة" domain="[('x_utak_simulation', '!=', True)]"/>
  </xpath>
</data>`;
export const LEAVE_LIST_EXT = "resource.calendar.leaves.list.s68_type";
export const LEAVE_FORM_EXT = "resource.calendar.leaves.form.s68_type";
export const leaveExtArch = () => `<data>
  <xpath expr="//field[@name='name']" position="after">
    <field name="x_leave_type"/>
  </xpath>
</data>`;

/** [key, name, model, the view it extends (null: a view of its own), its kind, its arch]. */
export const VIEWS = (refreshAction = null) => [
  ["form", FORM_VIEW, EMP_MODEL, null, "form", formArch(refreshAction)],
  ["list", LIST_EXT, EMP_MODEL, EMPLOYEE_LIST_VIEW, "list", listExtArch()],
  ["search", SEARCH_EXT, EMP_MODEL, EMPLOYEE_SEARCH_VIEW, "search", searchExtArch()],
  ["attList", ATT_LIST_EXT, ATT_MODEL, ATT_LIST_VIEW, "list", attListExtArch()],
  ["attSearch", ATT_SEARCH_EXT, ATT_MODEL, ATT_SEARCH_VIEW, "search", attSearchExtArch()],
  ["leaveList", LEAVE_LIST_EXT, LEAVE_MODEL, LEAVE_LIST_VIEW, "list", leaveExtArch()],
  ["leaveForm", LEAVE_FORM_EXT, LEAVE_MODEL, LEAVE_FORM_VIEW, "form", leaveExtArch()],
];

/** «🔄 حدّث الأرقام»: Odoo → the worker (`/odoo/hook/employee-file?op=refresh`), with the hook secret the other buttons carry. */
export const REFRESH_ACTION = "utak.employee_file.refresh_webhook";
export const REFRESH_PATH = "/odoo/hook/employee-file";
