# أرقام Odoo و Meta — UTAK

- الجدول نُقل **حرفياً** من CLAUDE.md § 6 في § 55.1 (2026-10-05). الأكثر استعمالاً منه باقٍ في [CLAUDE.md](../CLAUDE.md) § 6.
- رقم جديد (حقل، عرض، قائمة، Flow، قالب، شريك): يُضاف هنا.
- أرقام أقدم في الأرشيف: § 49 (سطر 6633)، وشاشات «💲 التسعير» (6391)، وإجراءات الخادم والأتمتات (584) — [history/STATUS-archive-2026-10-01.md](history/STATUS-archive-2026-10-01.md).

| الشيء | الرقم |
|---|---|
| قائمة «💲 التسعير» (أول عنصر في UTAK) | #582 |
| «📊 اليوم» / «📅 الأيام السابقة» / «📥 عروض المصادر» / «📦 الأصناف» / «⚙️ الإعدادات» | #583 / #584 / #585 / #586 / #587 |
| باقي قوائم UTAK | «💬 المحادثات» (#565، § 64)، «🛒 المشتريات»، «💵 دفع الموردين»، «💰 المالية»، «📋 مراجعة الأرقام» |
| «🔄 إعادة الحساب» / «نشر المعتمد الآن» (إجراءا خادم) | #1004 / #1038 |
| إعدادات التسعير (`x_pricing_config`) / يوم الأسعار 10-01 (`x_price_day`) | #1 / #50 |
| نموذج الأسعار عند Meta (§ 52): Flow `utak_price_ask_v2` / قالبه `utak_price_ask_flow_v2` (صفه في `x_whatsapp_template`) | #1123704886881420 / #943336198400535 (الصف #90) |
| النموذج السابق (§ 51، باقٍ ولا يُرسل): Flow `utak_price_ask_v1` / قالبه `utak_price_ask_flow_v1` (MARKETING، صفه في `x_whatsapp_template`) | #1086052444016554 / #1071676795680561 (الصف #89) |
| نموذج طلب العميل (§ 53): Flow `utak_order_v1` / نموذج التسجيل: Flow `utak_register_v1` | #961075853720270 / #1397273449266078 |
| قالب تذكير الدفع بالآيبان (§ 53) `utak_pay_remind_iban_v1` (صفه في `x_whatsapp_template`) | #1420873989377026 (الصف #91)؛ والحالي `utak_pay_remind_v3` (الصف #76) |
| حقول § 53: «زيادة على سعر السوق ٪» / «زيادة السوق ٪» على السطر / «اسم المسؤول» على الشريك | #20864 / #20866 / #20868 |
| نموذج مراجعة براء للأسعار (§ 55): Flow `utak_owner_review_v2` / السابق (§ 54، باقٍ ولا يُرسل) `utak_owner_review_v1` / الحقل «لما يكون السوق أعلى من المقترح» (`x_pricing_config.x_above_suggested`) | #1135227635856887 / #1084593151143621 / #20871 |
| نماذج التشغيل (§ 55): Flow `utak_delivery_v1` / `utak_receipt_v1` / `utak_carload_v1` / `utak_custody_v1` | #1113882387786390 / #1581232703689366 / #1128570570118160 / #1084087254588299 |
| حقول § 55 على سطر الطلب: «الكمية المطلوبة» `x_ordered_qty` / «المرتجع / غير المسلَّم» `x_return_qty` / «سبب المرتجع» `x_return_reason`؛ وعرض أعمدتها في نموذج الطلب | #20873 / #20875 / #20877؛ العرض #2887 |
| شاشات تحمل جملة القاعدة (§ 54): «⚙️ الإعدادات» / «📊 اليوم» / اللوحة | العرض #2855 / #2834 / #2871 |
| حقول «📊 اليوم» التي يكتبها الوركر (§ 56) — على السطر: `x_cost_vat_show` / `x_market_profit` / `x_market_profit_show` / `x_suggested_profit_show` / `x_gap_show` / `x_outcome_show`؛ وعلى اليوم: `x_n_publish` / `x_n_skip` / `x_n_warn` / `x_avg_profit` / `x_avg_profit_show` / `x_chart_html` (HTML بتعقيم Odoo) | #20879 / #20881 / #20883 / #20885 / #20887 / #20889؛ #20891 / #20893 / #20895 / #20897 / #20899 / #20901. جسم الشاشة في العرض #2834 (`utak.price_day_form`) |
| نماذج § 57 عند Meta: Flow `utak_transfer_v1` (إشعار تحويل) / `utak_complaint_v1` (عندي ملاحظة) / `utak_expense_v1` (تسجيل مصروف) / `utak_supplier_register_v1` (تسجيل المورد) | #1089772170263768 / #900552779662449 / #1084220070882916 / #2171744217026879 |
| حقول § 57 على الشكوى (`x_complaint`): `x_kind` «نوع الملاحظة» / `x_order_line_id` / `x_product_tmpl_id` / `x_affected_qty` / `x_photo` / `x_decision` «قرار براء» / `x_decided_at`؛ وعلى الشريك `x_cr_number` «السجل التجاري» | #20903 / #20905 / #20907 / #20909 / #20911 / #20913 / #20915؛ والسجل التجاري #20917؛ وعروض الامتداد: `x_complaint.form.utak_s57` #2888، `x_complaint.list.utak_s57` #2889، `res.partner.form.utak_s57` #2890 |
| شاشة «📊 اليوم» (§ 57 أ): العرض #2834 بصنفه `utak_day_form` وورقة أنماطه؛ تسميتا «متوسط ربح الكرتون (المنشور)» | الحقلان #20897 و#20899 |
| يومية البنك BNK1 (§ 57 ج): مصدر الكشوف «يدوي / استيراد» (`bank_statements_source = file_import`)؛ الوارد على 101003 «Outstanding Receipts» (طريقة الدفع #3)، والصادر على 101004 (#4)، والمعلق 101002 | اليومية #13 |
| يومية «مدفوعات البراء الشخصية» BRA (نوعها `credit`، حسابها الافتراضي 205001 «جاري المدير — البراء عبدالوهاب» #260): طريقتا الدفع #7 / #8 **بلا حساب دفع** (دفعة عليها بلا قيد) — «من جيب براء» مخفي حتى يُضبط | اليومية #21 |
| قوالب يسبق بها النص الحر (APPROVED UTILITY): الفاتورة نصاً / الفاتورة PDF / تم التسليم / تأكيد استلام دفعة (صفوف `x_whatsapp_template`) | #19 / #23 / #60 / #56 |
| نماذج المطابقة البنكية (`account.reconcile.model`، يدوية، لكل اليوميات): Internal Transfers / Bank Fees | #3 / #4 |
| أحمد حسان (مورد، دور «شراء») | شريك #30 |
| رائد (مصدر سوق خارجي، دور «سوق»، ليس عميلاً ولا مورداً ولا موظفاً) | شريك #109 |
| حساب الشركة البنكي (SAB، الآيبان) على يومية البنك BNK1 | `res.partner.bank` #1 على اليومية #13 |
| أبو مكين المعبري / بيت التمور (العميلان الحقيقيان) | شريك #31 / #105 |
| مشتريات السوق النقدية (`UTAK-CASH-MARKET`) | شريك #104 |
| براء (§ 59: سائق + شراء + محصّل؛ بطاقته على شريكه #45 «Bara.a - U TAK»، مشمول بالتحضير، جدوله #5) / عمر المجهلي (§ 59: «تسويق» وحده، بلا «مصدر أسعار» ولا تحضير؛ «دور الأسعار» سوق وجدوله #3 باقيان على بطاقته) / عثمان (مدير) | موظف #6 / #4 / #5 |
| أدوار UTAK (`x_employee_role`؛ § 61: على الوظيفة «أدوار الوظيفة»، وعلى البطاقة «أدوار إضافية (خارج الوظيفة)»): سائق / شراء / محصّل / مدير / **تسويق** (§ 59، `marketing`) | #1 / #2 / #3 / #4 / #12 |
| جداول الدوام (`resource.calendar`): «UTAK — عمر» / «UTAK — عثمان» / **«UTAK — أيام العمل»** (§ 59: جدول الشركة الثابت لحصة التكلفة، 7 أيام 02–12) | #3 / #4 / #5 |
| حقل «جدول أيام العمل (حصة التكلفة)» `x_pricing_config.x_workdays_calendar_id` (§ 59) / عرض الامتداد على «⚙️ الإعدادات» `utak.pricing_settings_form.s59_workdays` | #20966 / #2893 (على #2855) |
| قالبا § 59 عند Meta (APPROVED UTILITY): `utak_team_prices_ready_v1` («قائمة الأسعار جاهزة» بزر «أرسل القائمة»، الغرض `team_prices_ready` #4267) / `utak_quotation_pdf_v2` (رأس DOCUMENT، الغرض `customer_quotation_pdf_v2` #4268) | #1296015485947478 (الصف #92) / #1092059686745431 (الصف #93)؛ و`utak_quotation_pdf_v1` الصف #77 باقٍ خلفه، و`utak_welcome` الصف #53 باقٍ ولا يُرسل |
| **الوظائف (§ 61، `hr.job`):** مندوب تشغيل (سائق + شراء + محصّل، جدول #5، تحضير؛ براء #6) / مندوب تسويق (تسويق، جدول #3؛ عمر #4) / منسق عمليات («مدير»، جدول #4؛ عثمان #5) / سائق توصيل (سائق، جدول #5، تحضير؛ **شاغرة**) — وظائف Odoo النموذجية #1–#3 مؤرشفة | #4 / #5 / #6 / #7 |
| حقول الوظيفة (§ 61): `x_job_role_ids` «أدوار الوظيفة» (many2many ← `x_employee_role`) / `x_default_calendar_id` / `x_job_attendance` / `x_responsibilities` / `x_day_by_hour` / `x_kpis` / `x_takeover_list` / `x_handover_list` (HTML) / `x_required_docs` / `x_salary_from` / `x_salary_to` / `x_fixed_costs` (فارغة) | #20990 – #21012 (زوجية) |
| «الوظيفة» و«الموظف» على بند التكلفة (§ 61): `x_operating_cost.x_job_id` / `x_employee_id` (فارغان: يربطهما براء) | #21014 / #21016 |
| عروض § 61: امتداد نموذج الوظيفة `utak.hr_job_form.s61` (على #1521) / قائمة «الوظائف» `utak.hr_job_list` / الوظيفة على بطاقة الموظف (على #2829) وقائمته (#2831) وبطاقاته (#2830) / عمودا بند التكلفة (على #2855) | #2896 / #2897 / #2898 / #2899 / #2900 / #2901 |
| إجراء «UTAK — الوظائف» / قائمته «الوظائف» تحت «🚚 التوصيل والفريق» (#546) / «UTAK — الموظفين» #995 (نطاقه: دور على البطاقة **أو** وظيفة) | #1048 / #590 / #995 |
| قالب § 61 عند Meta (APPROVED UTILITY): `utak_team_welcome_v1` (ترحيب موظف جديد: الاسم، والوظيفة، ومتى تصله أول مهمة؛ الغرض `team_welcome` #4269) — صفّه | #1081614037995135 — الصف #94 |
| رقم واتساب يو تاك نفسه (رابط wa.me في قائمة أسعار التسويق) | `UTAK_WA_NUMBER` في `wrangler.toml` (prod و sim) |
| ضريبة البيع 15% (شاملة) / ضريبة الشراء 15% (مضافة) | #5 / #21 (لا #43 «شامل») |
| يوميات | CSHD كاش السائق (19)، BNK1 البنك (13)، BILL المشتريات (9)، EXP المصاريف (20)، BRA مدفوعات البراء الشخصية (21)، MISC عامة (10) |
| حسابات | 101001 بنك، 101007 كاش السائق، 102011 مدينون، 104041 ضريبة مدخلات، 201002 دائنون، 201017 ضريبة مخرجات، 201021 جاري المالك، 300010 رأس المال، 400001 تكلفة البضاعة، 400003 رواتب، 500001 إيراد |
| منتجا الخدمة الوسيطان | `UTAK-SALE-GOODS`، `UTAK-PUR-GOODS` |
| إجراءات الخادم التي تستدعي الوركر (24، ومنذ § 62: 29 بأزرار «طلب أسعار خاص» الخمسة أدناه) | جدولها في الأرشيف، سطر 584 |
| **طلب أسعار خاص (§ 62):** `x_special_quote` / `x_special_quote_line` / `x_special_quote_recipient` (النماذج) | #6412 / #6437 / #6453 |
| قائمة «🧾 طلبات أسعار خاصة» (تحت «💲 التسعير»، ترتيب 28) / إجراؤها / العروض: القائمة والبحث والنموذج | #591 / #1056 / #2902 / #2903 / #2904 |
| إجراءات الخادم (§ 62): `utak.special_quote.send_webhook` / `recalc` / `accept` / `issue` / `pdf` (webhook إلى prod `/odoo/hook/special-quote?op=…`) / `close` / `reopen` (كود) | #1049 / #1050 / #1051 / #1052 / #1053 / #1054 / #1055 |
| أتمتة الحفظ (§ 62) `utak.special_quote.recalc (on save)`: `on_create_or_write` على العميل والتالف والهامش والتوصيل والأسطر ← #1050 | #29 |
| «خاص» على `x_price_offer` (§ 62): `x_special` / `x_special_quote_id` / `x_special_unit`؛ وامتدادات «عروض المصادر»: القائمتان والبحث | الحقول ضمن #21026–#21140 (ملف التراجع) / #2905 / #2906 / #2907 |
| نموذج الطلب الخاص عند Meta (§ 62): Flow `utak_price_ask_special_v1` (PUBLISHED؛ خارج النافذة القالب `utak_price_ask_flow_v2`، الصف #90) | #4690022014569990 |
| أول طلب (§ 62 د): شركة مدارات للاغذية (العميل) / الطلب | #111 / في `docs/history/s62.md` |
| **§ 62 د (ترتيب عروض الأسعار):** `x_special_quote.x_layout` «شكل العرض» / `x_special_quote_line.x_item_origin` «المنشأ» / `x_item_size` «المقاس» / `x_suggested_net` «المقترح قبل الضريبة» | #21148 / #21150 / #21152 / #21154 |
| `sale.order.line.x_item_origin` / `x_item_size` (§ 62 د) | #21156 / #21158 |
| النموذج `x_preview_ticket` (تذكرة «👁️ معاينة PDF»، § 62 د) وحقوله `x_model` / `x_res_id` / `x_used` | #6477؛ #21168 / #21170 / #21172 |
| إجراءا الكود «👁️ معاينة PDF» (§ 62 د): `utak.special_quote.preview` / `utak.sale_order.preview` (ينشئان التذكرة ويفتحان `/preview/t/<ticket>` على prod؛ ليسا من الإجراءات الـ 29 التي تستدعي الوركر: المتصفح هو الذي يفتح الرابط) | #1057 / #1058 |
| عرض امتداد نموذج أمر البيع `utak.sale.order.form.preview_origin_size` (§ 62 د: الزر والعمودان، أولوية 45 على `sale.order.form` #1225) | #2908 |
| أزرار أمر البيع الأقدم: «تنزيل PDF (UTAK)» (كود، رمز ثابت في رابطه) / «إرسال واتساب (UTAK)» (webhook) وعرضاهما | #971 / #970؛ #2789 / #2787 |
| **كتالوج الأصناف (§ 63):** وحدة «ربطة» (`uom.uom`) / كيلو «كجم» / حبة «الوحدات»؛ الأصناف الجديدة (`product.template`، «نشط للبيع» مطفأ) بأكواد `UTAK-FRT-017…133` و`UTAK-VEG-027…098` و`UTAK-LEAF-011…044`؛ «موز أمريكي مخمر» / «موز أمريكي غير مخمر» | #32 / #16 / #1؛ #128–#350 (أرقام كل صنف في `scripts/artifacts/catalog-plan-20261007.csv`)؛ #131 / #132 |

## حسابات نموذج «تسجيل مصروف» (§ 57)

الوركر يجد كل حساب **برمزه** وقت التسجيل (`EXPENSE_TYPES` في `src/expense-accounting.ts`)، ولا ينشئ حساباً. رمز غير موجود = لا يُكتب شيء ويُخبَر براء. الأنواع سبعة منذ § 58: «رواتب وأجور» (400003) خرج من النموذج، لأن الرواتب تُسجَّل بقيدها الشهري ([EXPENSES.md](EXPENSES.md) § 4).

| النوع في النموذج | رمز الحساب | اسمه في Odoo | رقمه |
|---|---|---|---|
| وقود (`fuel`) | 400077 | Fuel | #211 |
| صيانة السيارة (`car_maintenance`) | 400042 | Maintenance | #177 |
| إيجار (`rent`) | 400017 | Warehouse Rent | #152 |
| كهرباء ومياه واتصالات (`utilities`) | 400018 | Water & Electricity | #153 |
| رسوم حكومية (`gov`) | 400032 | Trade License Fees | #167 |
| مواد تغليف (`packaging`) | 400064 | Consumables | #199 |
| أخرى (`other`) | 400028 | Others | #163 |

| ما يلزم القيد | في Odoo |
|---|---|
| يومية الفاتورة | EXP «المصاريف» #20 (لا BILL #9، فهي لبضاعة المشتريات) |
| يوميات الدفع | CSHD «كاش السائق» #19 · BNK1 البنك #13 (الصادر على 101004 «Outstanding Payments») · BRA «مدفوعات البراء الشخصية» #21 = «من جيب براء»: **طريقة الدفع الصادرة** فيها (`account.payment.method.line` #8) ترحّل إلى **201021** «Owner Current Account» (#258، التزام متداول) منذ § 58 (`scripts/s58-20261005-odoo.mjs`)، فالخيار **معروض** والدفعة تُقيَّد دائنةً عليه. 205001 «جاري المدير — البراء عبدالوهاب» (#260) يبقى الحساب المسجَّل على اليومية ولم يُمس. بلا حساب على السطر #8 يختفي الخيار وحده |
| الضريبة مع فاتورة ضريبية ورقم صحيح | «15% شامل (مشتريات)» #43 (شاملة في السعر؛ لا #21 المضافة)، وضريبة المدخلات على 104041 |
| مورد المصروف النقدي بلا فاتورة ضريبية | «مصروفات نقدية متنوعة» شريك #55 (براء يكتب الاسم الذي يريد) |
| النموذج عند Meta | Flow `utak_expense_v2` #2207848546771736 (`EXPENSE_FLOW_ID`، § 58: بلا «رواتب وأجور»)، وزرّاه `expense_start` و`exp_undo_<رقم الفاتورة>`. الأقدم `utak_expense_v1` #1084220070882916 باقٍ منشوراً ولا يُرسل |
| **§ 64 — «💬 المحادثات» بالتاريخ:** حقول `discuss.channel` `x_pinned` / `x_last_msg_at` / `x_last_msg_preview` / `x_date_bucket` / `x_last_msg_label`؛ إجراءات الكود `utak.wa_chats.on_message` / `.pin` / `.open`؛ الأتمتة `wa_chats.on_message` (على `mail.message`)؛ المهمة المجدولة «UTAK: 💬 المحادثات — مجموعات التاريخ (00:05 الرياض)» وإجراؤها؛ القائمة `utak.wa_chats.list` وبحثها والإجراء؛ القائمة «💬 المحادثات» (كانت تفتح `ir.actions.client` #110) | الحقول #21174 / #21176 / #21178 / #21180 / #21182؛ الإجراءات #1059 / #1060 / #1061؛ الأتمتة #30؛ المهمة #66 (إجراؤها #1062)؛ العرضان #2909 / #2910 والإجراء #1065؛ القائمة #565 |
| **§ 64 — صفحة «📈 تاريخ الأسعار»:** إجراء الكود `utak.price_history.page` (تذكرة ثم `/history/t/…`) على القائمة «📈 تاريخ الأسعار»؛ رسم Odoo القديم = الإجراء «🔢 جدول الأسعار» (`pivot,graph,list`) وقائمته | الإجراء #1063 على القائمة #588؛ الإجراء #1046 وقائمته #592 |
| **§ 64 — بقايا § 62 د:** `sale.order.line.x_pack_text` «التعبئة» وعرض عموده `utak.sale.order.form.pack_text`؛ `x_preview_ticket.x_active` وافتراضيه؛ عرض الزر القديم `sale.order.form.utak_pdf_button` (مطفأ) وإجراؤه؛ أتمتة `utak.special_quote.recalc (on mode / layout)` وإجراؤها `utak.special_quote.recalc_on_mode` (يضغط #1050)؛ مسارا الرمز الثابت الباقيان: إجراء الفاتورة وعرضه، وإجراء أمر الشراء وعرضه | #21184 والعرض #2911؛ #21186 و`ir.default` #34؛ العرض #2789 والإجراء #971؛ الأتمتة #31 والإجراء #1064؛ `x_special_quote.x_calc_mode` «وضع آخر حساب» #21188؛ طلب فحص الأتمتة SQ-0003 (#3، محاكاة، مغلق)؛ #974 / #2796 و#975 / #2797 |
| **§ 65 — سجل الموردين (البطاقة):** على `res.partner`: `x_supplier_state` «حالة المورد»، `x_supplier_type` «نوع المورد» (#19315؛ قيمة «مورد مصاريف» `expense` #4364)، `x_supplied_product_ids` «الأصناف التي يوفرها» (#19316)، `x_supplier_items_text`، `x_origin_country_ids` / `x_origin_text`، `x_supplier_location`، `x_supply_method`، `x_pay_terms` / `x_pay_days`، `x_min_qty_text`، `x_lead_time_text`، `x_contact_cadence`، `x_next_contact`، `x_supplier_detail`، `x_reply_rate`، `x_price_gap_pct`، `x_last_offer_text`، `x_supplier_registered_at` / `_invited_at` / `_welcomed_at`، `x_supplier_result`، و`x_season_ids` / `x_capacity_ids` / `x_offer_ids` | الحقول الجديدة كلها #21198–#21353 (63 حقلاً مع النموذجين والعروض)؛ أحمد #30 ورائد #109 «معتمد»؛ #55 «مورد مصاريف» |
| **§ 65 — النموذجان:** `x_supplier_season` «مواسم المورد» (المورد، الصنف، من/إلى شهر، الكمية المتوقعة، و`x_m01`…`x_m12` محسوبة للمحوري) و`x_supplier_capacity` «طاقة المورد» (الصنف، الطاقة بالكرتون، لكل يوم/دفعة، آخر سعر) | #6490 و#6512 |
| **§ 65 — عروض المصادر:** `x_price_offer.x_offer_kind` («عرض مورد» `supplier_offer` / «صنف إضافي» `extra`)، `x_item_text`، `x_item_size`، `x_item_origin`، `x_ready_from`، `x_ready_until`، `x_offer_note`؛ و`x_daily_price.x_item_size` / `x_item_origin`؛ و`x_pricing_config.x_supplier_outreach` «تفعيل تواصل الموردين» (مطفأ)؛ والصنف غير المربوط `UTAK-UNLINKED` (مؤرشف) وتعبئته | الصنف #351، تعبئته #287 |
| **§ 65 — الأزرار والأتمتة:** webhook `utak.supplier.invite_webhook` و`utak.supplier.welcome_webhook` (إلى `/odoo/hook/supplier?op=…` على prod)؛ كود `utak.supplier.approve` و`utak.supplier.suspend`؛ وكود `utak.special_quote_line.recalc_on_edit` وأتمتته `utak.special_quote_line.recalc (on price edit)` (على `x_special_quote_line`: الشراء، النهائي، قبل الضريبة، الكمية) | #1066 / #1067؛ #1068 / #1069؛ #1070 والأتمتة #32 |
| **§ 65 — الشاشات (تحت «🛒 المشتريات» #547):** «🧑‍🌾 الموردون» / «📥 عروض الموردين» / «📅 تقويم المواسم» / «📦 خريطة الطاقة»؛ العروض `utak.suppliers_list` / `_search` / `utak.supplier_form`، `utak.supplier_offers_list` / `_search`، `utak.supplier_seasons_pivot` / `_list` / `_search`، `utak.supplier_capacity_list` / `_search`؛ وامتدادات المقاس والمنشأ ومفتاح التواصل؛ القائمة القديمة «الموردين» #538 مطفأة | القوائم #593–#596؛ الإجراءات #1071–#1074؛ العروض #2912–#2921؛ الامتدادات #2922–#2926 |
| **§ 65 — عند Meta:** Flows `utak_price_ask_v3` (`PRICE_FLOW_ID`؛ v2 #1123704886881420 = `PRICE_FLOW_V2_ID` يفتحه القالب) · `utak_price_extra_v1` · `utak_supplier_signup_v1` · `utak_supplier_offer_v1` (كلها PUBLISHED 2026-10-07)؛ والقالبان `utak_supplier_invite_v1` (غرضه `supplier_invite` #4367) و`utak_supplier_checkin_v1` (`supplier_checkin` #4368) — قُدّما مرة واحدة UTILITY | Flows #1120057760674035 · #1124859043408270 · #1623451192902813 · #1077214898460021؛ القالبان #1528521765978287 (الصف #95) و#4444875822443934 (الصف #96) |
| **§ 66 — القبول والتحويل (الطلب الخاص ← طلب يومي):** على `x_special_quote`: `x_accepted_at` «وافق العميل» / `x_delivery_date` «تاريخ التسليم» / `x_pay_terms` «طريقة الدفع» (cash / daily_transfer / credit) / `x_delivery_note` / `x_accept_expired` «أعتمد الأسعار رغم انتهاء الصلاحية» / `x_daily_order_id` «الطلب اليومي» / `x_converted_at` / `x_confirmed_total` «إجمالي الطلب المؤكد»؛ وعلى سطره `x_confirmed_qty` «الكمية المؤكدة» (**نص**)؛ وقيمة الحالة `accepted` «مقبول — تحوّل لطلب» (قبل «مغلق») | الحقول #21355–#21371 · الحالة #4372 |
| **§ 66 — على الطلب اليومي:** `x_daily_order.x_special_quote_id` «طلب الأسعار الخاص»؛ وعلى سطره `x_special_price` «سعر خاص» / `x_pack_text` «التعبئة (طلب خاص)» / `x_special_purchase` «الشراء (طلب خاص)» / `x_special_supplier_id` «مورد الشراء (طلب خاص)»؛ و`x_pricing_config.x_large_order_cartons` «حد الطلب الكبير (كرتون)» = 50 على #1 | #21373 · #21375 / #21377 / #21379 / #21383 · #21381 |
| **§ 66 — الإجراءات:** webhook «✅ العميل وافق» `utak.special_quote.approve_webhook` (`op=approve`) و«📦 حوّل لطلب» `utak.special_quote.convert_webhook` (`op=convert`) إلى prod؛ وإجراء كود أمر البيع `utak.sale_order.special_accept`؛ و«↩️ أعد فتحه» #1055 يعيد المحوَّل «مقبول» (و«صدر العرض» إن أُلغي طلبه)؛ وأتمتة السطر #32 تراقب «الكمية المؤكدة» أيضاً | #1075 · #1076 · #1077 |
| **§ 66 — الشاشات (ستة امتدادات، `scripts/lib/s66-odoo.mjs`):** `utak.special_quote_form.s66_accept` (الزرّان، مجموعة «قبول العميل والتحويل لطلب»، عمود «الكمية المؤكدة»، شريط الحالة) · `utak.special_quote_list.s66` · `utak.special_quote_search.s66` (فلاتر `f_accepted` «مقبول» / `f_waiting` «بانتظار رد العميل» / `f_expired` «انتهت صلاحيته») · `x_daily_order.form.utak_s66` · `utak.pricing_settings_form.s66_large_order` · `utak.sale.order.form.s66_accept` | في [history/s66.md](history/s66.md) |
| **§ 66 — عند Meta:** القالب `utak_supplier_checkin_v2` (متغيره اليوم؛ قُدّم UTILITY مرة واحدة 2026-10-08 10:42، فاعتُمد **وصُنّف MARKETING**: لا يُستعمل ولا يُعاد)؛ وقالب تأكيد الطلب القائم `utak_order_confirmed` (الصف #65، الغرض `customer_order_confirm`، APPROVED UTILITY، متغيران: رقم الطلب و«صباح …») هو تأكيد الطلب الخاص خارج نافذة العميل | #864126913455815 |
| **§ 66 — سجلات الفحص والمحاكاة:** أمر البيع التجريبي **S00017** (#17، شريك الاختبار #10، ملغى: فحص إعادة كتابة الأسطر والتأكيد)؛ وسجلات السيناريو الحي (عميل وطلب خاص وطلب يومي، كلها «محاكاة») في [history/s66.md](history/s66.md) | — |
| **§ 67 — «🧊 وضع التجميد»:** على `x_pricing_config`: `x_freeze_on` / `x_freeze_until` / `x_freeze_reply` / `x_freeze_since` / `x_freeze_ended_at`؛ وعلى `x_price_day`: `x_freeze_on` (غير مخزّن: مفتاح الإعدادات الفعّال، لزر «📊 اليوم») | #21385 / #21387 / #21389 / #21391 / #21393 · #21395 |
| **§ 67:** حالة `x_wa_message.x_status` «🧊 مجمّد (لم تُرسل)» (`frozen`) · إجراءات الكود `utak.freeze.turn_on` / `turn_off` / `stamp` (لا تستدعي الوركر) · الأتمتة `utak.freeze.stamp (on switch)` (عند كتابة `x_freeze_on` وحده) · الامتدادات: «📊 اليوم» / «⚙️ الإعدادات» / فلتر «🧊 مجمّد» | #4373 · #1078 / #1079 / #1080 · #33 · #2933 / #2934 / #2935 |
| **§ 67 — رموز الوركر في Odoo (بالوسم، لا بالقيمة):** `SALE_PDF_DOWNLOAD_TOKEN` في #971 #974 #975 · `INTERNAL_WEBHOOK_SECRET` في #941 #957 #968 #980 #981 #982 (دُوِّرا 2026-10-08 15:08) · `ODOO_HOOK_TOKEN` في 24 إجراء (#963 #967 #969 #970 #979 #985 #997–#999 #1001 #1004 #1012 #1014 #1017 #1021 #1049–#1053 #1066 #1067 #1075 #1076؛ **قيمته مفتاح Odoo API**: STATUS § 3 البند 129) | `scripts/s67-20261008-token-inventory.mjs` |
| «طلبوا وما كان متوفر» (§ 60 ج): النموذج `x_unavailable_request` (حقوله `x_date` / `x_partner_id` / `x_text` / `x_product_tmpl_id` / `x_quantity` / `x_utak_simulation`)؛ قائمته للقراءة / إجراؤه / قائمته «🙋 طلبوا وما كان متوفر» تحت «💲 التسعير» | النموذج #6389؛ الحقول #20976 / #20978 / #20980 / #20982 / #20984 / #20986؛ العرض #2894 / الإجراء #1047 / القائمة #589 |
| «خلاصة اليوم» (§ 60): الحقل `x_price_day.x_brief_html` (HTML بتعقيم Odoo)، ومكانه أول «📍 اليوم» في العرض #2834 (`<div name="utak_day_brief">`) | #20988 |
| «📈 تاريخ الأسعار» (§ 60): عرض البحث `utak.price_history_search` (أولويته 95: للإجراء #1046 وحده) بفلاتره `f_market` / `f_purchase` / `f_published` / `f_14`، وسياق الإجراء `search_default_f_market` و`search_default_f_14`؛ والفلاتر المحفوظة (`ir.filters`، مشتركة) موز أمريكي / رمان وسط / رمان صغير / رمان كبير | العرض #2895؛ الفلاتر #8 / #9 / #10 / #11 |
| حقول § 58 التي يكتبها الوركر منذ § 60 — على اليوم: `x_plan_margin` / `x_plan_waste` / `x_plan_contribution` / `x_plan_basis` / `x_profit_target` / `x_target_cartons`، و`x_act_cartons` / `x_act_margin` / `x_act_waste` / `x_act_waste_real` / `x_act_cost` / `x_act_profit` / `x_var_volume` / `x_var_margin` / `x_var_waste` / `x_var_cost` / `x_act_at`، و`x_target_html` / `x_tab_money_html` / `x_tab_items_html` / `x_tab_next_html`؛ وعلى السطر `x_contribution`؛ ويقرأ `x_pricing_config.x_daily_profit_target` | حقول § 58 (سجل التراجع `scripts/artifacts/s58-20261005-odoo-rollback.json`) |
