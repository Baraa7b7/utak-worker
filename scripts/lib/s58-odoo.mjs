// § 58 (2026-10-05) — what «📊 اليوم» gains in Odoo, and the account of «من جيب براء», as data: one
// source for scripts/s58-20261005-odoo.mjs (which writes it to the tenant) and the tests of
// src/day-insight.ts, src/day-tabs.ts and src/expense-accounting.ts (which read the pieces against
// what the worker writes).
//
//   • x_pricing_config: x_daily_profit_target «هدف الربح اليومي (ريال)» — P of the day's target; 0 by default.
//   • x_price_day_line: x_contribution «مساهمة الكرتون» — the sale ÷ 1.15 − the purchase − the waste (no
//     carton share), at the price the board reads (the approved price, else the market price); 0 = none.
//     A measure of «📈 تاريخ الأسعار».
//   • x_price_day, the day's plan (written with every run of the engine):
//       x_plan_margin        m̄_plan  the mean of (sale ÷ 1.15 − purchase) of the items that go out
//       x_plan_waste         w̄_plan  the mean of their waste (the waste % × the purchase)
//       x_plan_contribution  c_plan  = m̄_plan − w̄_plan
//       x_plan_basis         simple «متوسط بسيط» / weighted «مرجّح بمبيعات آخر 7 أيام»
//       x_profit_target      P       the settings' target that day
//       x_target_cartons     T       = (the day's cost + P) ÷ c_plan; 0 = no target is possible
//     the day's actual (written with the 21:30 summary):
//       x_act_cartons Q · x_act_margin m̄_act · x_act_waste W_act · x_act_waste_real (was it recorded, or
//       the plan's) · x_act_cost C_act · x_act_profit A · x_var_volume / x_var_margin / x_var_waste /
//       x_var_cost (the four parts of A − P) · x_act_at (when; empty = not computed)
//     and what the screen shows, HTML the worker writes under § 56's rules (div and span, inline style,
//     no <style>, Odoo's own colour classes, the field's sanitizer on):
//       x_target_html     «🎯 الهدف مقابل الفعلي», under the tiles of «📍 اليوم»
//       x_tab_money_html  «💧 وين يروح المال»
//       x_tab_items_html  «⭐ الأصناف»
//       x_tab_next_html   «🎯 الفرص والقادم»
//   • journal BRA #21 «مدفوعات البراء الشخصية»: its OUTBOUND payment method line posts to 201021 «Owner
//     Current Account» (Baraa's decision, § 58 أ 2). Until now the line had no account, so a payment on BRA
//     got no journal entry and the expense form hid «من جيب براء» (src/expense-accounting.ts reads the
//     line). 205001 is not touched; the old payment PAY00005 is not touched.

export const CONFIG_MODEL = "x_pricing_config";
export const DAY_MODEL = "x_price_day";
export const LINE_MODEL = "x_price_day_line";

export const PROFIT_TARGET_FIELD = "x_daily_profit_target";
export const PROFIT_TARGET_LABEL = "هدف الربح اليومي (ريال)";
export const CONFIG_FIELDS = [
  { name: PROFIT_TARGET_FIELD, ttype: "float", field_description: PROFIT_TARGET_LABEL,
    help: "الربح الذي تريده في اليوم فوق تغطية تكلفة التشغيل. «🎯 هدف اليوم» = (تكلفة التشغيل اليومية + هذا الرقم) ÷ متوسط مساهمة الكرتون. 0 = الهدف تغطية التشغيل فقط." },
];

export const CONTRIBUTION_FIELD = "x_contribution";
export const LINE_FIELDS = [
  { name: CONTRIBUTION_FIELD, ttype: "float", field_description: "مساهمة الكرتون",
    help: "(البيع ÷ 1.15) − الشراء − التالف، بلا حصة التشغيل: ما يبقى من الكرتون لتغطية التشغيل. بسعر البيع المعتمد، وإلا بسعر السوق. يكتبه الوركر؛ 0 = لا شراء أو لا سعر." },
];

/** [value, label] — the values are the ones src/day-insight.ts writes. */
export const PLAN_BASIS_OPTIONS = [["simple", "متوسط بسيط"], ["weighted", "مرجّح بمبيعات آخر 7 أيام"]];
const selection = (options) => `[${options.map(([v, l]) => `('${v}', '${l}')`).join(", ")}]`;
/** An HTML field as § 56's chart: Odoo's sanitizer on (tags and attributes), inline style kept. */
const HTML_FLAGS = { sanitize: true, sanitize_overridable: false, sanitize_tags: true, sanitize_attributes: true, sanitize_style: false, sanitize_form: true, strip_style: false, strip_classes: false };
export const SANITIZE_FLAGS = Object.keys(HTML_FLAGS);
export const HTML_FIELDS = [
  { name: "x_target_html", ttype: "html", field_description: "الهدف مقابل الفعلي", ...HTML_FLAGS,
    help: "«🎯 هدف اليوم» بالكراتين، وسطر أمس: كم بعنا من الهدف، وربح أمس الحقيقي، وتفصيل الفرق عن الهدف. يكتبه الوركر مع كل حساب ومع ملخص 21:30 (HTML بلا سكربت)." },
  { name: "x_tab_money_html", ttype: "html", field_description: "💧 وين يروح المال", ...HTML_FLAGS,
    help: "شلال الربح: البيع ← الضريبة ← الشراء ← التالف ← حصة التشغيل ← الربح، ومصاريف الأسبوع الفعلية مقابل المخطط. يكتبه الوركر (HTML بلا سكربت)." },
  { name: "x_tab_items_html", ttype: "html", field_description: "⭐ الأصناف", ...HTML_FLAGS,
    help: "ربح كل صنف في آخر 14 يوماً، ومتوسطه وأيام نشره واتجاه سوقه، ومصفوفة الأصناف بعد 7 أيام فيها مبيعات حقيقية. يكتبه الوركر (HTML بلا سكربت)." },
  { name: "x_tab_next_html", ttype: "html", field_description: "🎯 الفرص والقادم", ...HTML_FLAGS,
    help: "الفرص مرتبة بالريال، واتجاه كل صنف ونطاق «بكرة إذا استمر»، والإنذارات، وكم كرتوناً يغطي التشغيل بأسعار اليوم. يكتبه الوركر (HTML بلا سكربت)." },
];
export const DAY_FIELDS = [
  { name: "x_plan_margin", ttype: "float", field_description: "هامش الكرتون المخطط", help: "متوسط (البيع ÷ 1.15 − الشراء) للأصناف التي تُنشر اليوم. يكتبه الوركر مع كل حساب." },
  { name: "x_plan_waste", ttype: "float", field_description: "تالف الكرتون المخطط", help: "متوسط التالف المخطط للكرتون (نسبة التالف × الشراء) للأصناف التي تُنشر اليوم. يكتبه الوركر." },
  { name: "x_plan_contribution", ttype: "float", field_description: "متوسط مساهمة الكرتون", help: "هامش الكرتون المخطط − تالفه المخطط: ما يبقى من الكرتون لتغطية التشغيل. يكتبه الوركر." },
  { name: "x_plan_basis", ttype: "selection", selection: selection(PLAN_BASIS_OPTIONS), field_description: "أساس المتوسط", help: "متوسط بسيط للأصناف، أو مرجّح بخليط مبيعات آخر 7 أيام حين توجد مبيعات حقيقية. يكتبه الوركر." },
  { name: "x_profit_target", ttype: "float", field_description: "هدف الربح اليومي", help: "«هدف الربح اليومي» من الإعدادات كما كان في حساب هذا اليوم. يكتبه الوركر." },
  { name: "x_target_cartons", ttype: "float", field_description: "هدف اليوم (كرتون)", help: "(تكلفة التشغيل اليومية + هدف الربح اليومي) ÷ متوسط مساهمة الكرتون. 0 = لا هدف ممكن بأسعار اليوم. يكتبه الوركر." },
  { name: "x_act_cartons", ttype: "float", field_description: "الكراتين المسلَّمة", help: "ما سُلّم فعلاً في هذا اليوم من طلبات حقيقية (بلا محاكاة). يُحسب مع ملخص 21:30." },
  { name: "x_act_margin", ttype: "float", field_description: "هامش الكرتون الفعلي", help: "متوسط (البيع ÷ 1.15 − الشراء) للكرتون المسلَّم فعلاً. يُحسب مع ملخص 21:30." },
  { name: "x_act_waste", ttype: "float", field_description: "التالف الفعلي (ريال)", help: "قيمة التالف والمرتجع المسجَّل في نموذجي التسليم والاستلام؛ وإن لم يُسجَّل شيء: التالف المخطط للكراتين المسلَّمة. يُحسب مع ملخص 21:30." },
  { name: "x_act_waste_real", ttype: "boolean", field_description: "التالف مسجَّل فعلاً", help: "صح = «التالف الفعلي» من أرقام مسجَّلة؛ خطأ = لم يُسجَّل شيء فأُخذ المخطط." },
  { name: "x_act_cost", ttype: "float", field_description: "تكلفة التشغيل الفعلية", help: "يومياً = تكلفة التشغيل المخططة لليوم (المصاريف الفعلية تُقارَن أسبوعياً في «💧 وين يروح المال»)." },
  { name: "x_act_profit", ttype: "float", field_description: "الربح الحقيقي", help: "الكراتين المسلَّمة × هامش الكرتون الفعلي − التالف الفعلي − تكلفة التشغيل. يُحسب مع ملخص 21:30." },
  { name: "x_var_volume", ttype: "float", field_description: "فرق الكمية", help: "(الكراتين المسلَّمة − الهدف) × متوسط مساهمة الكرتون المخططة." },
  { name: "x_var_margin", ttype: "float", field_description: "فرق الهامش", help: "الكراتين المسلَّمة × (الهامش الفعلي − الهامش المخطط)." },
  { name: "x_var_waste", ttype: "float", field_description: "فرق التالف", help: "−(التالف الفعلي − الكراتين المسلَّمة × التالف المخطط للكرتون)." },
  { name: "x_var_cost", ttype: "float", field_description: "فرق التكاليف", help: "−(تكلفة التشغيل الفعلية − المخططة)." },
  { name: "x_act_at", ttype: "datetime", field_description: "وقت حساب الفعلي", help: "متى حُسبت أرقام اليوم الفعلية (مع ملخص 21:30). فارغ = لم تُحسب بعد." },
  ...HTML_FIELDS,
];

// ---------------------------------------------------------------- «من جيب براء»
export const POCKET_JOURNAL_ID = 21;
export const POCKET_JOURNAL_CODE = "BRA";
/** 201021 «Owner Current Account» (a current liability; its balance is in Baraa's favour). */
export const POCKET_ACCOUNT_CODE = "201021";
/** The journal's default account, which this order does not touch. */
export const POCKET_UNTOUCHED_CODE = "205001";
