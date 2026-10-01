// § 47 (2026-10-01) — the board's card, list and explanation, and the texts of the settings form and
// of «💰 أسعار اليوم», as they are from § 47: the purchase price is net of VAT as entered, and each
// line shows «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح». One source for
// scripts/s47-20261001-odoo.mjs (which moves the tenant's views from the § 46 shape to this one),
// scripts/s46-20261001-board.mjs (so a later re-apply of § 46 writes the same arch) and
// scripts/archive/s47-20261001-board-shots.mts (which measures the card's and the list's contrast).

const cardHead = `<t t-name="card">
          <div t-attf-class="border-start border-5 ps-3 pe-1 #{record.x_board_status.raw_value == 'green' ? 'border-success' : record.x_board_status.raw_value == 'yellow' ? 'border-warning' : record.x_board_status.raw_value == 'red' ? 'border-danger' : 'border-secondary'}">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <field name="x_name" class="fw-bold fs-5"/>
              <field name="x_board_status" class="text-nowrap ms-2"/>
            </div>
            <div class="d-flex justify-content-between"><span class="text-muted">الشراء الصافي</span><field name="x_net_purchase"/></div>
            <div class="d-flex justify-content-between"><span class="text-muted">التكلفة الكاملة</span><field name="x_full_cost"/></div>`;
const cardTail = `
            <div class="d-flex justify-content-between"><span class="text-muted">البيع</span><field name="x_board_sale"/></div>
            <div class="d-flex justify-content-between fw-bold border-top mt-1 pt-1"><span>الربح الحقيقي</span><field name="x_real_profit"/></div>
          </div>
        </t>`;

/** The card of § 46 (what the tenant carries before § 47). */
export const S46_CARD = cardHead + cardTail;
// The colour stays a thick side border and the status its own words: the two new rows use the same
// classes as the rows around them (a muted label, the value in the theme's text colour; the
// suggested price in bold) — no badge, no fixed colour.
/** The card from § 47: + «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح». */
export const CARD = `${cardHead}
            <div class="d-flex justify-content-between"><span class="text-muted">أقل سعر بيع بدون خسارة</span><field name="x_break_even"/></div>
            <div class="d-flex justify-content-between fw-bold"><span>السعر المربح المقترح</span><field name="x_suggested_price"/></div>${cardTail}`;

const kanbanView = (card) => `<kanban string="لوحة التسعير" create="0" delete="0" edit="0" default_order="x_day_date desc, x_sequence, id">
  <field name="x_board_status"/>
  <templates>
    ${card}
  </templates>
</kanban>`;
export const S46_BOARD_KANBAN = kanbanView(S46_CARD);
export const BOARD_KANBAN = kanbanView(CARD);

const listView = (extra) => `<list string="لوحة التسعير" create="0" delete="0" edit="0" default_order="x_day_date desc, x_sequence, id" decoration-success="x_board_status == 'green'" decoration-warning="x_board_status == 'yellow'" decoration-danger="x_board_status == 'red'" decoration-muted="x_board_status == 'none'">
  <field name="x_day_date" optional="show"/>
  <field name="x_product_tmpl_id" string="الصنف"/>
  <field name="x_packaging_id" string="التعبئة"/>
  <field name="x_cost_price" string="الشراء"/>
  <field name="x_net_purchase"/>
  <field name="x_waste_cost"/>
  <field name="x_op_share"/>
  <field name="x_full_cost"/>${extra}
  <field name="x_board_sale"/>
  <field name="x_net_sale"/>
  <field name="x_real_profit" sum="مجموع ربح الكرتون"/>
  <field name="x_board_status" widget="badge" decoration-success="x_board_status == 'green'" decoration-warning="x_board_status == 'yellow'" decoration-danger="x_board_status == 'red'" decoration-muted="x_board_status == 'none'"/>
  <field name="x_status" string="حالة السعر" optional="hide"/>
</list>`;
export const S46_BOARD_LIST = listView("");
// The two columns take the row's decoration like the columns around them (measured on the tenant's
// own CSS by scripts/archive/s47-20261001-board-shots.mts: 4.6:1 at least in both themes).
export const LIST_NEW_COLUMNS = `
  <field name="x_break_even"/>
  <field name="x_suggested_price"/>`;
export const BOARD_LIST = listView(LIST_NEW_COLUMNS);

/** The explanation under the board's cards. */
export const S46_BOARD_NOTE = "الشراء الصافي = الشراء ÷ 1.15 إن كان المصدر مسجلاً في الضريبة (من 2026-10-01)، وإلا الشراء. التالف = نسبة التالف × الشراء الصافي. التكلفة الكاملة = الشراء الصافي + التالف + حصة الكرتون. البيع الصافي = البيع ÷ 1.15 (من 2026-10-01). الربح الحقيقي = البيع الصافي − التكلفة الكاملة. اللوحة للعرض فقط: سعر البيع يبقى سعر السوق.";
export const BOARD_NOTE = "الشراء الصافي = سعر الشراء كما أُدخل: كل سعر شراء يُدخَل بدون ضريبة. التالف = نسبة التالف × الشراء الصافي. التكلفة الكاملة = الشراء الصافي + التالف + حصة الكرتون. أقل سعر بيع بدون خسارة = التكلفة الكاملة × 1.15. السعر المربح المقترح = التكلفة الكاملة × (1 + الهامش الأدنى ٪) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال (السعران شاملان الضريبة). البيع الصافي = البيع ÷ 1.15. الربح الحقيقي = البيع الصافي − التكلفة الكاملة. سعر البيع = سعر السوق متى بلغ السعر المربح المقترح، وإلا استثناء بقرارك.";

/** «⚙️ إعدادات التسعير»: «الهامش الأدنى ٪» beside «نسبة التالف», and the rule's sentence. */
export const SETTINGS_ANCHOR = `<field name="x_waste_pct"/>`;
export const SETTINGS_FIELD = `${SETTINGS_ANCHOR}
        <field name="x_min_margin_pct"/>`;
export const S46_SETTINGS_NOTE = "سعر البيع = سعر السوق لليوم. الاستثناءات (بلا شراء، بلا سوق، ربح ≤ 0، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر. «عدد المحطات» فارغ = لا خصم كمية.";
export const SETTINGS_NOTE = "سعر الشراء يُدخَل بدون ضريبة. سعر البيع = سعر السوق لليوم متى بلغ «السعر المربح المقترح» = (الشراء + التالف + حصة الكرتون) × (1 + الهامش الأدنى ٪) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. الاستثناءات (بلا شراء، بلا سوق، سوق أقل من السعر المربح، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر. «عدد المحطات» فارغ = لا خصم كمية.";

/** «💰 أسعار اليوم»: the suggested price beside the market price, and the rule's sentence. */
export const DAY_FORM_ANCHOR = `<field name="x_market_count" string="المشاهدات" readonly="1"/>`;
export const DAY_FORM_FIELD = `${DAY_FORM_ANCHOR}
        <field name="x_suggested_price" string="المربح المقترح" readonly="1"/>`;
export const S46_DAY_FORM_NOTE = "سعر البيع = سعر السوق (وسيط مشاهدات اليوم). ربح الوحدة = السوق − الشراء − التالف. غير الاستثناء يُعتمد ويُنشر تلقائياً في موعد النشر. الاستثناء يحتاج قرارك («قرار براء»، و«السعر المعدّل» مع «سعر معدّل»)، وإلا لا يُنشر.";
export const DAY_FORM_NOTE = "سعر الشراء بدون ضريبة. سعر البيع = سعر السوق (وسيط مشاهدات اليوم) متى بلغ «المربح المقترح». ربح الوحدة = السوق ÷ 1.15 − الشراء − التالف. غير الاستثناء يُعتمد ويُنشر تلقائياً في موعد النشر. الاستثناء يحتاج قرارك («قرار براء»: «اعتمد بالسعر المربح» أو «اعتمد بسعر السوق» أو «لا تنشر»، و«السعر المعدّل» مع «سعر معدّل»)، وإلا لا يُنشر.";
