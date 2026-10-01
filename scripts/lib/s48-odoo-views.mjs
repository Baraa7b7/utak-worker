// § 48 (2026-10-01) — the texts, the computed display fields and the view pieces of § 48, one source
// for scripts/s48-20261001-odoo.mjs (the logic: أ–د), scripts/s48-20261001-ui.mjs (the «💲 التسعير»
// screens: هـ–و) and scripts/s48-20261001-shots.mts (the contrast of what they show).

// ---------------------------------------------------------------- the rule, as the screens say it
export const MIN_PROFIT_SAR = 2;
/** The explanation at the top of the day's screen: the real formula (§ 48 أ / ج). */
export const DAY_NOTE = "الشراء خام بدون ضريبة. التكلفة الكاملة = الشراء + التالف (نسبة التالف × الشراء) + حصة الكرتون من تكلفة التشغيل. «بدون خسارة» = التكلفة الكاملة × 1.15. «المقترح» = (التكلفة الكاملة + الربح الأدنى للكرتون) × 1.15، لأعلى لأقرب نصف ريال. القاعدة: سعر البيع = سعر السوق متى بلغ المقترح، وغير ذلك استثناء بقرارك. «معاينة» = ما يربحه الصنف لو بيع بالمقترح، وليست سعراً معتمداً.";
/** The sentence § 47 left on «💰 أسعار اليوم» (what the tenant carries before § 48). */
export const S47_DAY_FORM_NOTE = "سعر الشراء بدون ضريبة. سعر البيع = سعر السوق (وسيط مشاهدات اليوم) متى بلغ «المربح المقترح». ربح الوحدة = السوق ÷ 1.15 − الشراء − التالف. غير الاستثناء يُعتمد ويُنشر تلقائياً في موعد النشر. الاستثناء يحتاج قرارك («قرار براء»: «اعتمد بالسعر المربح» أو «اعتمد بسعر السوق» أو «لا تنشر»، و«السعر المعدّل» مع «سعر معدّل»)، وإلا لا يُنشر.";
export const S47_BOARD_NOTE = "الشراء الصافي = سعر الشراء كما أُدخل: كل سعر شراء يُدخَل بدون ضريبة. التالف = نسبة التالف × الشراء الصافي. التكلفة الكاملة = الشراء الصافي + التالف + حصة الكرتون. أقل سعر بيع بدون خسارة = التكلفة الكاملة × 1.15. السعر المربح المقترح = التكلفة الكاملة × (1 + الهامش الأدنى ٪) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال (السعران شاملان الضريبة). البيع الصافي = البيع ÷ 1.15. الربح الحقيقي = البيع الصافي − التكلفة الكاملة. سعر البيع = سعر السوق متى بلغ السعر المربح المقترح، وإلا استثناء بقرارك.";
export const BOARD_NOTE = "الشراء الصافي = سعر الشراء كما أُدخل: كل سعر شراء يُدخَل بدون ضريبة. التالف = نسبة التالف × الشراء الصافي. التكلفة الكاملة = الشراء الصافي + التالف + حصة الكرتون. أقل سعر بيع بدون خسارة = التكلفة الكاملة × 1.15. السعر المربح المقترح = (التكلفة الكاملة + الربح الأدنى للكرتون) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال (السعران شاملان الضريبة). البيع الصافي = البيع ÷ 1.15. الربح الحقيقي = البيع الصافي − التكلفة الكاملة. سعر البيع = سعر السوق متى بلغ السعر المربح المقترح، وإلا استثناء بقرارك.";
export const S47_SETTINGS_NOTE = "سعر الشراء يُدخَل بدون ضريبة. سعر البيع = سعر السوق لليوم متى بلغ «السعر المربح المقترح» = (الشراء + التالف + حصة الكرتون) × (1 + الهامش الأدنى ٪) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. الاستثناءات (بلا شراء، بلا سوق، سوق أقل من السعر المربح، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر. «عدد المحطات» فارغ = لا خصم كمية.";
export const SETTINGS_NOTE = "سعر الشراء يُدخَل بدون ضريبة. سعر البيع = سعر السوق لليوم متى بلغ «السعر المربح المقترح» = (الشراء + التالف + حصة الكرتون + الربح الأدنى للكرتون) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. الاستثناءات (بلا شراء، بلا سوق، سوق أقل من السعر المربح، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر. السعر الاحتياطي حين لا يُنشر اليوم = السعر المربح المقترح. «عدد المحطات» فارغ = لا خصم كمية.";

// ---------------------------------------------------------------- the fields
export const CFG_FIELDS = [
  { name: "x_min_profit_sar", ttype: "float", field_description: "الربح الأدنى للكرتون (ريال)",
    help: "مبلغ ثابت بالريال يُضاف إلى التكلفة الكاملة الصافية (الشراء + التالف + حصة الكرتون). «السعر المربح المقترح» = (التكلفة الكاملة + هذا المبلغ) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. سعر السوق يُنشر تلقائياً متى بلغه، وإلا يصلك استثناء." },
];
export const MARGIN_LABEL_OLD = "الهامش الأدنى ٪";
export const MARGIN_LABEL = "الهامش الأدنى ٪ (قديم — لا يُستعمل)";
export const SUGGESTED_HELP = "(التكلفة الكاملة + الربح الأدنى للكرتون) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال (شامل الضريبة).";

const show = (field, source) => `for record in self:
    value = record.${source}
    record['${field}'] = ('%.2f' % value) if value else '—'`;
/** «الربح / المعاينة»: an approved line shows its real profit; a line without an approved price its preview at the suggested price. */
export const PROFIT_SHOW_CODE = `for record in self:
    if record.x_sale_price:
        record['x_profit_show'] = '%.2f' % record.x_real_profit
    elif record.x_preview_sale:
        record['x_profit_show'] = 'معاينة %.2f' % record.x_preview_profit
    else:
        record['x_profit_show'] = '—'`;
export const LINE_FIELDS = [
  { name: "x_preview_sale", ttype: "float", field_description: "بيع المعاينة", help: "معاينة لسطر بلا سعر بيع معتمد: السعر المربح المقترح. 0 = لا معاينة." },
  { name: "x_preview_profit", ttype: "float", field_description: "ربح المعاينة", help: "ما يربحه الكرتون لو بيع بالسعر المربح المقترح: المقترح ÷ 1.15 − التكلفة الكاملة. للعرض فقط: ليس ربحاً حقيقياً ولا سعراً معتمداً." },
  { name: "x_manual_for", ttype: "char", field_description: "السعر مثبَّت لقرار", help: "يكتبه الوركر: القرار الذي ثُبّت له «السعر المعدّل» (market / profit / edit). قرار يتغيّر في Odoo لا يرث سعر قرار آخر." },
  { name: "x_market_show", ttype: "char", field_description: "السوق", compute: show("x_market_show", "x_market_price"), depends: "x_market_price", store: false, readonly: true, help: "سعر السوق، و«—» حين لا سعر سوق." },
  { name: "x_sale_show", ttype: "char", field_description: "البيع", compute: show("x_sale_show", "x_sale_price"), depends: "x_sale_price", store: false, readonly: true, help: "سعر البيع المعتمد، و«—» حين لا سعر معتمد." },
  { name: "x_profit_show", ttype: "char", field_description: "الربح / المعاينة", compute: PROFIT_SHOW_CODE, depends: "x_sale_price,x_real_profit,x_preview_sale,x_preview_profit", store: false, readonly: true,
    help: "سطر معتمد: ربحه الحقيقي (البيع الصافي − التكلفة الكاملة). سطر بلا سعر معتمد: «معاينة» بما يربحه لو بيع بالمقترح. «—» حين لا هذا ولا ذاك." },
  { name: "x_manual_show", ttype: "char", field_description: "السعر المعدّل", compute: show("x_manual_show", "x_manual_price"), depends: "x_manual_price", store: false, readonly: true, help: "السعر المعدّل، و«—» حين لا سعر." },
  { name: "x_cost_show", ttype: "char", field_description: "الشراء", compute: show("x_cost_show", "x_cost_price"), depends: "x_cost_price", store: false, readonly: true, help: "سعر الشراء الخام (بدون ضريبة)، و«—» حين لا سعر شراء." },
  { name: "x_even_show", ttype: "char", field_description: "بدون خسارة", compute: show("x_even_show", "x_break_even"), depends: "x_break_even", store: false, readonly: true, help: "أقل سعر بيع بدون خسارة، و«—» حين لا يُحسب." },
  { name: "x_suggested_show", ttype: "char", field_description: "المقترح", compute: show("x_suggested_show", "x_suggested_price"), depends: "x_suggested_price", store: false, readonly: true, help: "السعر المربح المقترح، و«—» حين لا يُحسب." },
];
export const DISPLAY_FIELDS = ["x_market_show", "x_sale_show", "x_profit_show", "x_manual_show", "x_cost_show", "x_even_show", "x_suggested_show"];

// ---------------------------------------------------------------- «💰 أسعار اليوم» (the day form of § 35 / § 47), the columns of ج
/** What § 47 left in the day form's list. */
export const S47_DAY_COLUMNS = `        <field name="x_market_price" string="السوق" readonly="1"/>
        <field name="x_market_count" string="المشاهدات" readonly="1"/>
        <field name="x_suggested_price" string="المربح المقترح" readonly="1"/>
        <field name="x_sale_price" string="البيع" readonly="1"/>
        <field name="x_unit_profit" string="الربح" readonly="1"/>
        <field name="x_status" readonly="1"/>
        <field name="x_reason" readonly="1"/>
        <field name="x_decision"/>
        <field name="x_manual_price"/>`;
/**
 * § 48 ج — a value that does not exist shows «—», never 0.00 (the market price, the sale price, the
 * profit); a line without an approved price shows «معاينة …» in italics; «السعر المعدّل» is the
 * input of «سعر معدّل» and stays empty (not 0.00) on every other line that carries no price.
 */
export const DAY_COLUMNS = `        <field name="x_market_price" column_invisible="1"/>
        <field name="x_sale_price" column_invisible="1"/>
        <field name="x_preview_sale" column_invisible="1"/>
        <field name="x_market_show" string="السوق"/>
        <field name="x_market_count" string="المشاهدات" readonly="1"/>
        <field name="x_even_show" string="بدون خسارة"/>
        <field name="x_suggested_show" string="المقترح"/>
        <field name="x_sale_show" string="البيع"/>
        <field name="x_profit_show" string="الربح / المعاينة" decoration-it="not x_sale_price and x_preview_sale"/>
        <field name="x_status" readonly="1"/>
        <field name="x_reason" readonly="1"/>
        <field name="x_decision"/>
        <field name="x_manual_price" invisible="x_decision != 'edit' and not x_manual_price"/>`;
