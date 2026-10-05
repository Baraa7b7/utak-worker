// § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم», made plain: what § 56 puts in Odoo, as data. One
// source for scripts/s56-20261005-odoo.mjs (which writes it to the tenant), scripts/s56-20261005-shots.mts
// (which renders the screen and measures its contrast) and tests/s56.test.mts (which reads the arch).
//
//   • the fields the worker fills with every run (src/day-screen.ts): on the line, the cells of the
//     table Odoo cannot make by itself; on the day, the header's four numbers and the chart;
//   • the screen's body, in the order Baraa reads the day's review (§ 55): the header (the date, the
//     state, the publication time, four large numbers), the chart, the table — الصنف · الشراء (بدون
//     ضريبة) · الشراء شامل · السوق · ربحنا بسعر السوق ± · المقترح (وربحه) · فرق المقترح عن السوق ± ·
//     القرار · السبب — cards in the same order on a phone, and everything else (the carton share, the
//     waste, «بدون خسارة», the observations, the sources, the technical fields) in the line's own
//     form, opened from its row. The form's header — «🔄 إعادة الحساب», «نشر المعتمد الآن», the day
//     before and after — the links to the other screens and the two banners are NOT touched: the
//     body alone is replaced inside the arch the tenant carries (§ 48 + § 49 + § 54).
import { DAY_NOTE } from "./s48-odoo-views.mjs";
import { NOTES } from "./s54-odoo.mjs";

export const VIEW_DAY = "utak.price_day_form";
export const DAY_MODEL = "x_price_day";
export const LINE_MODEL = "x_price_day_line";

// ---------------------------------------------------------------- the fields (the worker writes them)
export const LINE_FIELDS = [
  { name: "x_cost_vat_show", ttype: "char", field_description: "الشراء شامل", help: "سعر الشراء × 1.15 بمنزلتين، للمقارنة بالعين مع سعر السوق الشامل. يكتبه الوركر مع كل حساب؛ «—» حين لا سعر شراء." },
  { name: "x_market_profit", ttype: "float", field_description: "ربحنا بسعر السوق (رقم)", help: "يكتبه الوركر: الرقم الذي يلوَّن به عمود «ربحنا بسعر السوق». 0 = لا سعر سوق أو لا ربح." },
  { name: "x_market_profit_show", ttype: "char", field_description: "ربحنا بسعر السوق", help: "(سعر السوق ÷ 1.15) − الشراء − التالف − حصة التشغيل، بإشارة ومنزلتين — رقم رسالة المراجعة نفسه. يكتبه الوركر؛ «—» حين لا سعر سوق." },
  { name: "x_suggested_profit_show", ttype: "char", field_description: "المقترح (وربحه)", help: "السعر المربح المقترح، وبين قوسين ما يربحه الكرتون لو بيع به. يكتبه الوركر." },
  { name: "x_gap_show", ttype: "char", field_description: "فرق المقترح عن السوق", help: "المقترح − سعر السوق، بإشارة: قيمةً ونسبةً من سعر السوق. يكتبه الوركر؛ «—» حين لا سعر سوق." },
  { name: "x_outcome_show", ttype: "char", field_description: "القرار", help: "ما يحدث للصنف كما هو الآن، ورمزه أولاً: قرارك إن قررت، وإلا القرار المقترح («معتمد» = يُنشر بلا قرار منك، «ينتظر قرارك» = لا يُنشر حتى تقرر). بعد النشر: «نُشر بـ …» أو «لم يُنشر». يكتبه الوركر." },
];
/**
 * The chart's field keeps Odoo's sanitizer (tags and attributes): what the worker writes is div / span
 * with class, style, title and dir only, which the sanitizer stores as written (verified on the
 * tenant, byte for byte) — nothing is gained by switching it off, and a field without it would take a
 * script from any internal user. The style attribute and the classes are kept as written. The form
 * shows the value INSIDE the page, in the page's own stylesheet (light and dark), because it carries
 * no <style>: Odoo moves a value with one into a sandboxed frame.
 */
export const CHART_FIELD = {
  name: "x_chart_html", ttype: "html", field_description: "الرسم البياني",
  sanitize: true, sanitize_overridable: false, sanitize_tags: true, sanitize_attributes: true, sanitize_style: false, sanitize_form: true, strip_style: false, strip_classes: false,
  help: "«سعرنا مقابل السوق» و«ربح الكرتون» لهذا اليوم. يكتبه الوركر مع كل حساب (HTML بلا سكربت).",
};
export const SANITIZE_FLAGS = ["sanitize", "sanitize_overridable", "sanitize_tags", "sanitize_attributes", "sanitize_style", "sanitize_form", "strip_style", "strip_classes"];
export const DAY_FIELDS = [
  { name: "x_n_publish", ttype: "integer", field_description: "للنشر", help: "عدد الأصناف التي تُنشر كما هي الآن: بقرارك، أو بالقرار المقترح. بعد النشر: ما نُشر. يكتبه الوركر." },
  { name: "x_n_skip", ttype: "integer", field_description: "لا تنشر", help: "عدد الأصناف التي لا تُنشر كما هي الآن. بعد النشر: ما لم يُنشر. يكتبه الوركر." },
  { name: "x_n_warn", ttype: "integer", field_description: "⚠️ سعر شاذ ينتظرك", help: "أصناف سعرها تغيّر كثيراً عن آخر سعر، وما زالت بلا قرار منك. يكتبه الوركر." },
  { name: "x_avg_profit", ttype: "float", field_description: "متوسط ربح الكرتون (رقم)", help: "يكتبه الوركر: متوسط «ربحنا» للأصناف التي تُنشر (كل صنف مرة). 0 = لا صنف للنشر." },
  { name: "x_avg_profit_show", ttype: "char", field_description: "متوسط ربح الكرتون", help: "متوسط «ربحنا» للأصناف التي تُنشر، بإشارة ومنزلتين — رقم تأكيد رسالة المراجعة نفسه. «—» حين لا صنف للنشر." },
  CHART_FIELD,
];

// ---------------------------------------------------------------- the table, the card, the line's form
export const COLUMNS = [
  ["x_item_show", "الصنف"],
  ["x_cost_show", "الشراء (بدون ضريبة)"],
  ["x_cost_vat_show", "الشراء شامل"],
  ["x_market_show", "السوق"],
  ["x_market_profit_show", "ربحنا بسعر السوق ±"],
  ["x_suggested_profit_show", "المقترح (وربحه)"],
  ["x_gap_show", "فرق المقترح عن السوق ±"],
  ["x_outcome_show", "القرار"],
  ["x_reason", "السبب"],
];
const label = (name) => COLUMNS.find((c) => c[0] === name)[1];

/** The lines on a wide screen: nine columns, read-only — a row opens the line's form (its details, and «قرار براء»). */
export const LINE_LIST = `<list create="0" delete="0">
        <field name="x_sequence" column_invisible="1"/>
        <field name="x_market_profit" column_invisible="1"/>
        <field name="x_item_show" string="${label("x_item_show")}"/>
        <field name="x_item_code" string="الرمز" optional="hide"/>
        <field name="x_cost_show" string="${label("x_cost_show")}"/>
        <field name="x_cost_vat_show" string="${label("x_cost_vat_show")}"/>
        <field name="x_market_show" string="${label("x_market_show")}"/>
        <field name="x_market_profit_show" string="${label("x_market_profit_show")}" decoration-success="x_market_profit &gt; 0" decoration-danger="x_market_profit &lt; 0" decoration-bf="x_market_profit != 0"/>
        <field name="x_suggested_profit_show" string="${label("x_suggested_profit_show")}"/>
        <field name="x_gap_show" string="${label("x_gap_show")}"/>
        <field name="x_outcome_show" string="${label("x_outcome_show")}"/>
        <field name="x_reason" string="${label("x_reason")}"/>
      </list>`;
const cardRow = (name, strong = false) => `<div class="d-flex justify-content-between${strong ? " fw-bold" : ""}"><span${strong ? "" : ` class="text-muted"`}>${label(name)}</span><field name="${name}"/></div>`;
/** The line's card on a phone: the same cells in the same order, each on a line of its own — nothing scrolls sideways. The side border repeats the mark's meaning; the mark itself is in «القرار». */
export const LINE_CARD = `<t t-name="card">
          <div t-attf-class="border-start border-5 ps-3 pe-1 #{(record.x_outcome_show.raw_value || '').startsWith('✅') ? 'border-success' : (record.x_outcome_show.raw_value || '').startsWith('❌') ? 'border-danger' : record.x_outcome_show.raw_value ? 'border-warning' : 'border-secondary'}">
            <div class="mb-1" name="utak_item">
              <field name="x_item_show" class="fw-bold fs-5"/>
              <div class="small text-muted" t-if="record.x_item_code.raw_value"><field name="x_item_code"/></div>
            </div>
            ${cardRow("x_cost_show")}
            ${cardRow("x_cost_vat_show")}
            ${cardRow("x_market_show")}
            <div class="d-flex justify-content-between fw-bold"><span>${label("x_market_profit_show")}</span><span t-attf-class="#{record.x_market_profit.raw_value &gt; 0 ? 'text-success' : record.x_market_profit.raw_value &lt; 0 ? 'text-danger' : ''}"><field name="x_market_profit_show"/></span></div>
            ${cardRow("x_suggested_profit_show")}
            ${cardRow("x_gap_show")}
            <div class="fw-bold border-top mt-1 pt-1" name="utak_outcome"><field name="x_outcome_show"/></div>
            <div class="small" t-if="record.x_reason.raw_value"><field name="x_reason"/></div>
          </div>
        </t>`;
/** What left the table for the line's own form: the cost's parts, «بدون خسارة», the observations, the sources, the technical fields. */
export const DETAIL_FIELDS = ["x_waste_cost", "x_op_share", "x_full_cost", "x_even_show", "x_market_count", "x_supplier_id", "x_offers", "x_uplift_pct", "x_is_outlier", "x_sale_show", "x_profit_show", "x_status", "x_board_status", "x_net_purchase", "x_net_sale", "x_real_profit", "x_unit_profit", "x_manual_for", "x_decided_at", "x_daily_price_id"];
const ro = (name, string = "") => `<field name="${name}"${string ? ` string="${string}"` : ""} readonly="1"/>`;
/** A line opened from its row or its card: «القرار» as it stands, Baraa's own decision, then every number behind it. */
export const LINE_FORM = `<form string="تفاصيل الصنف">
        <sheet>
          <div class="oe_title"><h2><field name="x_item_show" readonly="1"/></h2><div class="small text-muted"><field name="x_item_code" readonly="1"/></div></div>
          <div class="fs-4 fw-bold mb-2" name="utak_outcome"><field name="x_outcome_show" readonly="1" class="oe_inline"/></div>
          <group>
            <group string="قرارك">
              <field name="x_decision" string="قرار براء"/>
              <field name="x_manual_price" string="السعر المعدّل" invisible="x_decision != 'edit' and not x_manual_price"/>
              ${ro("x_status", "الحالة")}
              ${ro("x_reason", label("x_reason"))}
            </group>
            <group string="الأسعار">
              <field name="x_cost_show" string="${label("x_cost_show")}"/>
              ${ro("x_cost_vat_show", label("x_cost_vat_show"))}
              <field name="x_market_show" string="${label("x_market_show")}"/>
              ${ro("x_market_profit_show", label("x_market_profit_show"))}
              ${ro("x_suggested_profit_show", label("x_suggested_profit_show"))}
              ${ro("x_gap_show", label("x_gap_show"))}
              <field name="x_sale_show" string="البيع المعتمد"/>
              <field name="x_profit_show" string="الربح / المعاينة"/>
            </group>
            <group string="التكلفة">
              ${ro("x_waste_cost", "التالف")}
              ${ro("x_op_share", "حصة التشغيل")}
              ${ro("x_full_cost", "التكلفة الكاملة")}
              <field name="x_even_show" string="بدون خسارة"/>
            </group>
            <group string="المصادر">
              ${ro("x_supplier_id", "المصدر")}
              ${ro("x_market_count", "المشاهدات")}
              ${ro("x_offers", "عروض المصادر")}
              ${ro("x_uplift_pct", "زيادة السوق ٪")}
              ${ro("x_is_outlier", "سعر شاذ")}
            </group>
            <group string="حقول تقنية">
              ${ro("x_board_status", "اللوحة")}
              ${ro("x_net_purchase")}
              ${ro("x_net_sale")}
              ${ro("x_real_profit")}
              ${ro("x_unit_profit")}
              ${ro("x_manual_for")}
              ${ro("x_decided_at")}
              ${ro("x_daily_price_id")}
            </group>
          </group>
        </sheet>
      </form>`;

// ---------------------------------------------------------------- the day's body
const OPEN = "x_state in ('draft', 'missed')", PUBLISHED = "x_state == 'published'";
const tile = (inner) => `<div class="col-6 col-md-3"><div class="border rounded p-2 text-center h-100">
          ${inner}
        </div></div>`;
const big = (field, extra = "") => `<div class="fs-1 fw-bold lh-1${extra}"><field name="${field}" readonly="1" class="oe_inline"/></div>`;
/** The four large numbers. A published day says «نُشر» / «لم يُنشر»; the sign is in the average itself, its colour only repeats it. */
export const TILES = `<div class="row g-2 mb-2" name="utak_day_tiles">
        ${tile(`${big("x_n_publish")}
          <div invisible="${PUBLISHED}">✅ للنشر</div><div invisible="not (${PUBLISHED})">✅ نُشر</div>`)}
        ${tile(`${big("x_n_skip")}
          <div invisible="${PUBLISHED}">❌ لا تنشر</div><div invisible="not (${PUBLISHED})">❌ لم يُنشر</div>`)}
        ${tile(`${big("x_n_warn")}
          <div>⚠️ سعر شاذ ينتظرك</div>`)}
        ${tile(`<field name="x_avg_profit" invisible="1"/>
          <div class="fs-1 fw-bold lh-1 text-success" invisible="x_avg_profit &lt;= 0"><field name="x_avg_profit_show" readonly="1" class="oe_inline"/></div>
          <div class="fs-1 fw-bold lh-1 text-danger" invisible="x_avg_profit &gt;= 0"><field name="x_avg_profit_show" readonly="1" class="oe_inline"/></div>
          <div class="fs-1 fw-bold lh-1" invisible="x_avg_profit != 0"><field name="x_avg_profit_show" readonly="1" class="oe_inline"/></div>
          <div>متوسط ربح الكرتون</div>`)}
      </div>`;
export const APPROVED_NOTE = "وما عليه «ينتظر قرارك» لا يُنشر حتى تقرر: من رسالة المراجعة في واتساب، أو افتح الصنف هنا واختر «قرار براء».";
export const CHART_EMPTY_NOTE = "الرسم يُبنى مع أول حساب لليوم: اضغط «🔄 إعادة الحساب».";
/** The explanation under the table: § 48's formula with § 54's rule (what the tenant carries), and how «ربحنا» is made. */
const [, RULE_WAS, RULE_NOW] = NOTES.find((n) => n[0] === VIEW_DAY);
if (DAY_NOTE.split(RULE_WAS).length !== 2) throw new Error("scripts/lib/s56-ui.mjs: § 48's note no longer carries the sentence § 54 replaced");
export const NOTE_54 = DAY_NOTE.replace(RULE_WAS, RULE_NOW);
export const PROFIT_RULE = "«ربحنا» = (سعر البيع ÷ 1.15) − الشراء − التالف − حصة التشغيل، للكرتون الواحد.";
export const DAY_NOTE_56 = `${PROFIT_RULE} ${NOTE_54}`;

/** The screen's body: from the title to «تقرير النشر» (which stays where it is). */
export const DAY_BODY = `<div class="oe_title"><h1>📊 اليوم — <field name="x_date" readonly="1" class="oe_inline"/></h1></div>
    <div class="d-flex flex-wrap gap-3 mb-3 fs-4" name="utak_day_head">
      <div><span class="text-muted">الحالة:</span> <field name="x_state" readonly="1" class="oe_inline fw-bold"/></div>
      <div><span class="text-muted">وقت النشر:</span> <field name="x_published_at" readonly="1" class="oe_inline fw-bold" invisible="not x_published_at"/><span class="fw-bold" invisible="x_published_at">لم يُنشر</span></div>
    </div>
    <div class="alert alert-warning" role="status" invisible="not x_board_note"><field name="x_board_note" readonly="1" class="oe_inline"/></div>
    ${TILES}
    <div class="text-muted mb-3" invisible="not (${OPEN})" name="utak_approved_note">المعتمد الآن بلا قرار منك: <field name="x_n_publishable" readonly="1" class="oe_inline fw-bold"/>. ${APPROVED_NOTE}</div>
    <field name="x_chart_html" readonly="1" nolabel="1" class="mb-3"/>
    <div class="text-muted mb-3" invisible="x_chart_html" name="utak_chart_empty">${CHART_EMPTY_NOTE}</div>
    <field name="x_line_ids" readonly="not (${OPEN})" mode="list,kanban">
      ${LINE_LIST}
      <kanban create="0" delete="0">
        <field name="x_outcome_show"/>
        <field name="x_market_profit"/>
        <field name="x_reason"/>
        <field name="x_item_code"/>
        <templates>
        ${LINE_CARD}
        </templates>
      </kanban>
      ${LINE_FORM}
    </field>
    <separator string="تفاصيل حساب اليوم"/>
    <group name="utak_day_details">
      <group string="تكلفة التشغيل">
        <field name="x_op_cost" string="تكلفة اليوم" readonly="1"/>
        <field name="x_op_share" string="حصة الكرتون" readonly="1"/>
        <field name="x_op_basis" string="أساس الحصة" readonly="1"/>
        <field name="x_op_expected" readonly="1" invisible="x_op_basis == 'actual'"/>
        <field name="x_op_cartons" readonly="1" invisible="x_op_basis != 'actual'"/>
      </group>
      <group string="الحساب والاعتماد">
        <field name="x_board_at" string="آخر حساب" readonly="1"/>
        <field name="x_approved_at" string="وقت الاعتماد" readonly="1"/>
        <label for="x_n_green" string="اللوحة"/>
        <div>🟢 <field name="x_n_green" readonly="1" class="oe_inline"/> · 🟡 <field name="x_n_yellow" readonly="1" class="oe_inline"/> · 🔴 <field name="x_n_red" readonly="1" class="oe_inline"/> · ⚪ <field name="x_n_none" readonly="1" class="oe_inline"/></div>
      </group>
    </group>
    <div class="alert alert-info" role="status" invisible="not x_op_share_500">مقارنة: لو كانت الكراتين 500 يومياً، حصة الكرتون <field name="x_op_share_500" readonly="1" class="oe_inline fw-bold"/> ر.س.</div>
    <div class="text-muted mb-2">${DAY_NOTE_56}</div>
    `;

/** The body starts at the title and ends before «تقرير النشر»: the header, the links and the banners above it, and the report under it, stay as they are. */
const BODY_FROM = `<div class="oe_title"><h1>`;
const BODY_TO = `<group string="تقرير النشر"`;
export const BODY_MARK = `name="utak_day_tiles"`;
/** The tenant's arch with § 56's body (an arch that already carries it is left as it is; one that is not § 48 + § 49 + § 54's stops the script). */
export function dayArch(arch) {
  if (arch.includes(BODY_MARK)) return arch;
  const from = arch.indexOf(BODY_FROM), to = arch.indexOf(BODY_TO);
  if (from < 0 || to < from || arch.split(BODY_FROM).length !== 2 || arch.split(BODY_TO).length !== 2) throw new Error("📊 اليوم: the title or «تقرير النشر» was not found once in the form — stop (the view was changed by hand?)");
  const body = arch.slice(from, to);
  // what the body replaces must be the screen of § 48 + § 49 + § 54: its editable table, and its note with § 54's rule
  if (!/<list editable="bottom"/.test(body) || !body.includes(NOTE_54)) throw new Error("📊 اليوم: the form's body is not § 48 + § 49 + § 54's — stop (the view was changed by hand?)");
  return `${arch.slice(0, from)}${DAY_BODY}${arch.slice(to)}`;
}
