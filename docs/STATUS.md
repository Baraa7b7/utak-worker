# حالة مشروع UTAK — المرجع الموحّد

- **تاريخ الفحص:** 2026-09-23 (≈ 05:30 UTC)
- **الفرع:** `sim-harness`، وHEAD قبل هذا الملف هو `adb7255`
- **نوع الفحص:** للقراءة فقط. لم يُكتب شيء في Odoo (لا create ولا write ولا unlink)، ولم يُرسل إلى Graph إلا طلبات GET، ولم يُنشر شيء، ولم يُعدَّل `src/` ولا `wrangler.toml`.
- **الاستعلامات:** [scripts/status-20260923-full-check.mjs](../scripts/status-20260923-full-check.mjs)، ومخرجها الخام في `scripts/artifacts/status-20260923-full-check.json`.
- **ملاحظة تقنية:** `read_group` يرجع 404 على `/json/2` في هذا الإصدار من Odoo، لذلك يجمّع السكربت الأرقام محلياً من `search_read`.

## ملخص: جاهز / ناقص / معطّل

| # | البند | الحالة | الخلاصة |
|---|---|---|---|
| 0 | الفرع وgit | ✅ جاهز | الفرع متزامن مع origin (0/0)، وفيه 16 commit بعد `321af5d`. في الشجرة `.gitignore` معدّل ومجلد `scripts/oneoff/` غير متتبع |
| 1 | النشر | ✅ جاهز | نسخة sim هي `26bf9781` (2026-09-22)، ونسخة prod هي `5c138821` (2026-09-20). `ACCOUNTING_SYNC` مفعّل على sim فقط، وcron يعمل على sim فقط |
| 2 | إصلاح قيد التحصيل | ⛔ غير منفّذ | لا يوجد سكربت ولا ملف rollback، و`payment_account_id` فارغ في CSHD وBNK1، ولا يوجد حارس في الكود |
| 3 | المحاسبة الفعلية | ⚠️ ناقص | عدد القيود الحقيقية **0**. القيود الثمانية الموجودة كلها لشريك الاختبار 48 ومعكوسة، والدفعات الأربع ملغاة وليس لها قيد |
| 3 | الضرائب والشركة | ⚠️ ناقص | ضريبة 15% موجودة، لكنها غير مربوطة بأي منتج (0 من 40)، وضريبة الشركة الافتراضية فارغة، و`l10n_sa_edi` غير مثبت |
| 4 | خريطة الربط | ⚠️ ناقص | تدفقان فقط يكتبان قيوداً (الفاتورة والتحصيل)، والباقي يكتب في نماذج `x_*`. المصاريف والرواتب ليس لها كود |
| 5 | قوالب واتساب | ⚠️ ناقص | كل القوالب الـ 52 معتمدة (APPROVED)، لكن **لا يصلح أي زوج من أزواج الترحيل الستة للترحيل دون تعديل الكود**، وثلاثة أغراض مكرّرة في Odoo |
| 6 | تقسيم الصفحات | ✅ جاهز (مع ملاحظة) | `overflow:hidden` أُزيل، والصفحات تتعدد. بقي `height: 297mm` ثابتاً في الفرع الافتراضي |
| 6 | الهوية الرسمية | ⚠️ ناقص | الاسم والرقم الضريبي والعنوان موجودة. السجل التجاري غير موجود، والحقول الثنائية فارغة، ولا توجد حقول للختم أو التوقيع |
| 7 | النظافة والأمن | ⚠️ ناقص | `audit-partners` ما زال موجوداً. سجل 02:00 يُكتب مرتين. يوجد 46 ملف PDF متتبع في `scripts/artifacts` |

---

## 0) التحقق قبل أي خطوة

- `pwd` = `/Users/baraa7/utak-worker` ✅، والفرع `sim-harness` ✅.
- **الفرق عن origin:** `0 0`، أي أن الفرع ليس متقدماً ولا متأخراً عن `origin/sim-harness`.
- **حالة الشجرة:** ` M .gitignore`، وفيه سطر جديد `.env.zatca-oneoff`، و`?? scripts/oneoff/`، وفيه `income-statement-zatca.ts`، وهو سكربت مؤقت لقائمة الدخل التقديرية المطلوبة لتسجيل ZATCA. لم يُضمَّنا في commit هذا الفحص.
- **هل يوجد commit بعد `321af5d`** (2026-09-21 08:32، «ربط الإيراد والتحصيل بـ account.move / account.payment»)؟ **نعم، 16 commit.** أولها `2e9a0a8` (pdf-template: خيارات الورقة الرسمية)، وآخرها `adb7255`. لا يخص أي منها إصلاح قيد التحصيل.

آخر 15 commit:

| hash | التاريخ | العنوان |
|---|---|---|
| adb7255 | 2026-09-22 11:46 | official-doc(ai-draft): سكربت e2e لاختبار الصياغة الذكية حياً على sim |
| af8c3c9 | 2026-09-22 11:44 | pagination(all-docs): كل المستندات تدعم صفحات متعددة بلا حذف محتوى |
| 8aac534 | 2026-09-22 11:23 | odoo-views(x_bilingual): نقل الحقول الأربعة من داخل `<h1>` إلى مجموعة بجانب VAT |
| 53a59e2 | 2026-09-22 11:23 | company-info(readCompanyInfo): CRN من additional_identifiers + الدولة/العنوان بلغتين |
| b367f2b | 2026-09-22 10:53 | i18n(e2e): سيناريو e2e على sim — Bank Letter EN preview + bi invoice |
| 7e7351a | 2026-09-22 10:50 | i18n(seeds+tests+fixtures): نماذج إنجليزية + قاموس أسماء الأصناف + اختبارات |
| 8c40d75 | 2026-09-22 10:50 | i18n(render): دعم اللغة ar/en/bi في كل مستندات UTAK |
| 18aa13f | 2026-09-22 10:50 | i18n(odoo): إضافة حقول اللغة والثنائي إلى Odoo |
| 50d3221 | 2026-09-22 10:20 | legal-footer(all-docs): سطران قانونيان موحدان في كل مستندات UTAK |
| 27b6227 | 2026-09-22 10:20 | company-info(readCompanyInfo): استبدال x_company_registry بقراءة CRN من l10n_sa على partner |
| 3c5ac98 | 2026-09-22 09:20 | official-doc(footer): سطران رفيعان |
| d0ec9ee | 2026-09-22 08:47 | official-doc(tests+e2e): وحدة اختبار + سيناريو e2e على sim + عيّنات PDF |
| 45bbf84 | 2026-09-22 08:47 | official-doc(seed): زرع ٤ نماذج جاهزة كـ x_is_template=True |
| 2cbf5f1 | 2026-09-22 08:47 | official-doc(odoo): موديلات x_official_doc + x_official_doc_block + views + menus + server actions |
| 0fd160c | 2026-09-22 08:47 | official-doc(sim): موديل الوركر + endpoints preview/issue/ai-draft + /official-doc-pdf |

## 1) حالة النشر

| البيئة | Worker | النسخة الحالية (100%) | تاريخ النشر (UTC) |
|---|---|---|---|
| sim | `utak-worker-sim` | `26bf9781-7b70-4678-b7a1-73e01ef171d2` | 2026-09-22 08:48 |
| prod | `utak-worker` | `5c138821-82e7-424f-b3a3-207700fe4e71` | 2026-09-20 22:18 |

المصدر: `wrangler deployments list`، وهو أمر قراءة فقط.

**`ACCOUNTING_SYNC` في `wrangler.toml`:**
- `[vars]` (prod): غير معرّف، أي مطفأ.
- `[env.sim.vars]`: `"true"`.
- `[env.pilot.vars]`: غير معرّف.

قد يكون prod مضبوطاً من لوحة Cloudflare، ولم يُفحص ذلك لأن الفحص لم يقرأ متغيرات اللوحة.

**جداول cron:**
- prod `[triggers]`: `crons = []`، وهي موقوفة منذ قرار 2026-09-16، والمواعيد محفوظة في تعليق.
- sim `[env.sim.triggers]`: ثمانية مواعيد، هي 02:00 و05:00 و06:00 و21:00 و21:15 و18:00 و17:00 و08:00 بتوقيت الرياض (`0 23` و`0 2` و`0 3` و`0 18` و`15 18` و`0 15` و`0 14` و`0 5` UTC).
- pilot `[env.pilot.triggers]`: `crons = []`.

**`/health` على sim** (الحقول غير الحساسة فقط):
- `status`: `ok`
- `odoo`: `connected (apikey)`
- `sigFailures.totalLast7Days`: 2، وكلاهما في 2026-09-21

`/health` على prod يرد HTTP 200.

## 2) هل نُفّذ إصلاح قيد التحصيل؟

- `scripts/acct-20260921-payment-fix.mjs`: **غير موجود**.
- ملف rollback له: **غير موجود**. الموجود هو `scripts/artifacts/acct-20260921-rollback.json` فقط، وهو ملف سكربت الإعداد `acct-20260921-setup.mjs`.

**اليوميتان:**

| اليومية | id | النوع | default_account_id | account_type | سطر الدفع الوارد | payment_account_id |
|---|---|---|---|---|---|---|
| CSHD كاش السائق | 19 | cash | 101007 كاش السائق (id 257) | `asset_cash` | id 5 · Manual Payment · inbound | **فارغ (null)** |
| BNK1 Bank | 13 | bank | 101001 Bank (id 247) | `asset_cash` | id 3 · Manual Payment · inbound | **فارغ (null)** |

- حساب suspense للاثنتين هو 101002 Bank Suspense (`asset_current`).
- الحقل `account_journal_payment_debit_account_id` على الشركة غير موجود أو فارغ.

**الأثر المُشاهد:** الدفعات الأربع PAY00001 إلى PAY00004 كلها ملغاة (`canceled`)، و`move_id` فارغ فيها كلها. ولا يوجد أي `account.move` من نوع `entry`. معنى ذلك أن تسجيل الدفعة لم يولّد قيد تحصيل: فالحساب الوسيط (outstanding) غير محدد على سطر طريقة الدفع، فلا يُنشأ قيد.

**حارس نوع الحساب في `src/accounting.ts`:** **لا يوجد.** الكود لا يقرأ `account_type` ولا `destination_account_id` ولا الحساب الوسيط. الفحص الوحيد هو وجود اليومية نفسها ([src/accounting.ts:242](../src/accounting.ts)). بعد الترحيل يبحث الكود عن الدفعة باليومية والمبلغ والتاريخ فقط ([src/accounting.ts:278-287](../src/accounting.ts))، **دون تصفية بالشريك**، فإذا حُصّلت دفعتان بنفس المبلغ في نفس اليوم فقد تُربط الدفعة الخطأ.

**الحكم: ⛔ غير منفّذ.** الأدلة:
1. سكربت الإصلاح وملف rollback له غير موجودين.
2. `payment_account_id` فارغ في CSHD وBNK1.
3. لا يوجد حارس في الكود.
4. لا يوجد commit بعد `321af5d` يتعلق بالتحصيل.

## 3) حالة المحاسبة الفعلية

**الأعداد:**

| النموذج | التفصيل | العدد |
|---|---|---|
| account.move | out_invoice · posted | 4 |
| account.move | out_refund · posted | 4 |
| account.move | (أي نوع آخر أو حالة أخرى) | 0 |
| account.payment | canceled | 4 |
| account.move.line | الكل | 16 |

**القيود كلها لشريك الاختبار id=48 «اختبار محاسبة». عدد القيود الحقيقية غير الاختبارية: 0.**

| id | الرقم | النوع | التاريخ | المبلغ | الحالة | السطور (حساب · النوع · مدين/دائن) |
|---|---|---|---|---|---|---|
| 6 | INV/2026/00001 | out_invoice | 2026-09-21 | 3 | reversed | 102011 receivable 3/0 · 500001 income 0/3 |
| 7 | INV/2026/00002 | out_invoice | 2026-09-21 | 3 | reversed | 102011 receivable 3/0 · 500001 income 0/3 |
| 8 | RINV/2026/00003 | out_refund (عكس 00002) | 2026-09-21 | 3 | paid | 500001 income 3/0 · 102011 receivable 0/3 |
| 9 | INV/2026/00003 | out_invoice | 2026-09-21 | 3 | reversed | 102011 receivable 3/0 · 500001 income 0/3 |
| 10 | RINV/2026/00001 | out_refund (عكس 00003) | 2026-09-21 | 3 | paid | 500001 income 3/0 · 102011 receivable 0/3 |
| 11 | RINV/2026/00002 | out_refund (عكس 00001، «orphan cleanup») | 2026-09-21 | 3 | paid | 500001 income 3/0 · 102011 receivable 0/3 |
| 12 | INV/2026/00004 | out_invoice | 2026-09-21 | 3 | reversed | 102011 receivable 3/0 · 500001 income 0/3 |
| 13 | RINV/2026/00004 | out_refund (عكس 00004) | 2026-09-21 | 3 | paid | 500001 income 3/0 · 102011 receivable 0/3 |

- لا توجد ضريبة على أي فاتورة: `amount_tax = 0`.
- الدفعات PAY00001 إلى PAY00004 كلها للشريك 48 على يومية CSHD بمبلغ 3، وكلها `canceled` دون قيد.

**ميزان المراجعة المجمّع** (كل الدفاتر، القيود المرحّلة):

| الحساب | الاسم | النوع | مدين | دائن | الرصيد |
|---|---|---|---|---|---|
| 102011 | Accounts Receivable | asset_receivable | 12 | 12 | 0 |
| 500001 | Sales Account | income | 12 | 12 | 0 |
| **المجموع** | | | **24** | **24** | **0** |

لا توجد سطور بحالة مسودة.

**الشركة (id=1):**

| الحقل | القيمة |
|---|---|
| name | شركة يو تاك ذات مسؤولية محدودة |
| vat | 315022736600003 |
| country_id | Saudi Arabia (192) |
| currency_id | SAR |
| السنة المالية | تنتهي 31/12 |
| chart_template | `sa` |
| account_sale_tax_id | **فارغ** |
| account_purchase_tax_id | **فارغ** |
| fiscalyear_lock_date / tax_lock_date / sale_lock_date / purchase_lock_date / hard_lock_date | كلها فارغة |
| user_*_lock_date (الحقول الخمسة) | `0001-01-01`، وهي قيم محسوبة، أي لا قفل |

**الضرائب النشطة بنسبة 15%:**

| id | الاسم | الاستخدام | النوع |
|---|---|---|---|
| 5 | 15% | sale | percent |
| 21 | 15% | purchase | percent |
| 22 | 15% R C | purchase | percent |
| 32 | 15% WH R G | purchase | division |
| 33 | 15% WH O G | purchase | division |

**المنتجات:** العدد الفعلي 40 وليس 37.
- عليها `taxes_id`: **0**
- عليها `supplier_taxes_id`: **0**
- `sale_ok`: 39
- `x_is_active_for_sale`: 4

**حساب رأس المال 300010** «رأس المال المدفوع» (equity، id 256): **لا يوجد عليه أي سطر قيد**، لا مرحّل ولا مسودة.

**الوحدات:**

| الوحدة | الحالة |
|---|---|
| `l10n_sa` | installed |
| `l10n_sa_edi` | **uninstalled** |
| `l10n_sa_pos` | uninstalled |
| `account_accountant` | installed |
| `stock` | installed |
| `stock_account` | installed |
| `purchase` | installed |
| `sale_management` | installed |
| `hr_expense` | uninstalled |
| `hr_payroll` | uninstalled |

## 4) خريطة الربط الحالية

| التدفق | يكتب الكود في | النموذج القياسي المستهدف | يولّد قيداً اليوم؟ | المرجع |
|---|---|---|---|---|
| أسعار الموردين | `x_supplier_price_request_log`، `x_daily_price`، `res.partner` | `product.supplierinfo` | لا | [suppliers.ts:128](../src/suppliers.ts) و[:246](../src/suppliers.ts) → [odoo.ts:619](../src/odoo.ts) و[:706](../src/odoo.ts) |
| الطلب | `x_daily_order`، `x_daily_order_line`، `x_message_analysis` | `sale.order` | لا | [router.ts:217](../src/router.ts) و[:225](../src/router.ts) → [odoo.ts:412](../src/odoo.ts) و[:433](../src/odoo.ts) |
| عرض السعر | `x_quotation` (أما `sale-order-quotation.ts` فيقرأ `sale.order` فقط) | `sale.order` بحالة draft | لا | [router.ts:286](../src/router.ts) → [odoo.ts:512](../src/odoo.ts)؛ [quotation.ts:616](../src/quotation.ts) |
| الفاتورة | `x_invoice`، ومعه `account.move` إذا كان ACCOUNTING_SYNC مفعّلاً | `account.move` (out_invoice) | **نعم على sim** (مدين AR، دائن الإيراد، دون ضريبة) | [invoice.ts:100](../src/invoice.ts)، [invoice.ts:115](../src/invoice.ts) → [accounting.ts:152-172](../src/accounting.ts) |
| التحصيل | `x_payment`، `x_invoice`، ومعهما `account.payment` عبر الـ wizard | `account.payment` | **لا فعلياً**: تُنشأ الدفعة لكن دون قيد (البند 2) | [invoice.ts:258](../src/invoice.ts) و[:281](../src/invoice.ts) → [accounting.ts:250-296](../src/accounting.ts) |
| قائمة الشراء | `x_purchase_list`، `x_daily_order_line` | `purchase.order` ثم فاتورة مورد | لا (`purchase.order` = 0) | [team.ts:64](../src/team.ts) → [odoo.ts:1022](../src/odoo.ts) |
| التوزيع | `x_delivery_route`، `x_delivery_stop`، `x_daily_order` | `stock.picking` | لا | [team.ts:136](../src/team.ts) → [odoo.ts:1285](../src/odoo.ts)؛ [router.ts:494](../src/router.ts) |
| الشكاوى | `x_complaint` | `helpdesk.ticket` أو mail.activity | لا (وليس محاسبياً أصلاً) | [complaint.ts:62](../src/complaint.ts) → [odoo-v6-append.ts:119](../src/odoo-v6-append.ts) |
| الطلبات الثابتة | `x_standing_order`، `x_daily_order` | `sale.order` (أو اشتراك) | لا | [standing.ts:47](../src/standing.ts) → [odoo-v6-append.ts:56](../src/odoo-v6-append.ts) |
| المصاريف | **لا يوجد كود** | `hr.expense` أو `account.move` (in_invoice) | لا (`hr_expense` غير مثبت) | لم يُعثر على expense أو مصروف في `src/` |
| الرواتب والعمولات | **لا يوجد كود**؛ يوجد فقط الثابت `T.COMMISSION` والحقل `res.partner.x_monthly_salary` | `hr.payslip` أو قيد يدوي | لا (`hr_payroll` غير مثبت) | [templates.ts:115](../src/templates.ts) |

**أعداد سجلات النماذج `x_*`** (مع تاريخ آخر إنشاء بتوقيت UTC):

| النموذج | العدد | آخر سجل |
|---|---|---|
| x_collection_item | 1 | 2026-08-29 |
| x_collection_task | 1 | 2026-08-29 |
| x_complaint | 1 | 2026-09-02 |
| x_daily_order | 17 | 2026-09-21 05:30 |
| x_daily_order_line | 16 | 2026-09-15 |
| x_daily_price | 14 | 2026-09-19 |
| x_delivery_route | 2 | 2026-09-11 |
| x_delivery_stop | 2 | 2026-09-11 |
| x_employee_role | 4 | 2026-09-03 |
| x_invoice | 6 | 2026-09-21 05:30 |
| x_message_analysis | 34 | 2026-09-12 |
| x_neighborhood | 3 | 2026-08-29 |
| x_official_doc | 11 | 2026-09-22 11:50 |
| x_official_doc_block | 48 | 2026-09-22 11:50 |
| x_payment | 8 | 2026-09-21 05:30 |
| x_pricing_config | 1 | 2026-08-29 |
| x_product_packaging | 47 | 2026-09-19 |
| x_purchase_list | 2 | 2026-09-11 |
| x_quotation | 9 | 2026-09-15 |
| x_standing_order | 0 | — |
| x_standing_order_line | 0 | — |
| x_supplier_price_request_log | 24 | 2026-09-22 23:00 |
| x_wa_control | 1 | 2026-09-17 |
| x_wa_message | 87 | 2026-09-22 23:00 |
| x_whatsapp_template | 52 | 2026-09-21 04:39 |

**النماذج القياسية:**

| النموذج | العدد |
|---|---|
| sale.order | 2 |
| purchase.order | 0 |
| stock.picking | 4 |
| res.partner | 22 |
| product.supplierinfo | 7 |
| hr.expense و hr.payslip | غير موجودين |

**أنواع المنتجات** (40 قالب منتج):

| النوع | العدد |
|---|---|
| `consu` | 38، منها 35 عليها `is_storable=True` |
| `service` | 2 |
| `product` | 0 |

في Odoo 18 فما بعد لم يعد النوع `product` موجوداً، وحل محله `consu` مع `is_storable`.

## 5) قوالب واتساب (GET فقط)

- **Meta** (`/2144001136512196/message_templates`): 52 قالباً، **وكلها APPROVED**. 51 منها لغتها `ar`، وواحد لغته `en_US` (`hello_world`).
- **الفئة MARKETING (15 قالباً):** delivery_done، feedback، followup_customer، followup_supplier، order_cutoff، owner_alert، quality_issue، reactivate، service_notice، shift_start، **supplier_daily_ask**، v2_commission، v2_daily_remind، v2_inactive، v2_welcome.
- **الفئة UTILITY:** الباقي.

القائمة الكاملة لكل قالب، بالاسم والحالة والفئة واللغة وعدد المتغيرات والنص، موجودة في `sections.wa_templates_meta` داخل ملف JSON.

**أزواج الترحيل الستة** (المصدر: تسليم جلسة 2026-09-21 وملف `wa-templates-20260921-relabel-old.mjs`):

| القديم ← الجديد | الحالة | متغيرات القديم ← الجديد | ما يرسله الكود اليوم | الحكم |
|---|---|---|---|---|
| utak_v2_order_confirm ← utak_order_confirmed | APPROVED/UTILITY | 3 (الاسم، عدد الأصناف، التوصيل) ← 2 (رقم الطلب، التوصيل) | لا يوجد مستدعٍ لـ `T.CUSTOMER_ORDER_CONFIRM` | ❌ غير جاهز: المتغيرات مختلفة عدداً ومعنى. التبديل لا يضر اليوم لأنه لا يوجد مستدعٍ، لكن أي مستدعٍ مستقبلي يجب أن يُكتب على الشكل الجديد |
| utak_delivery_done ← utak_delivered | القديم MARKETING، والجديد UTILITY | 1 (الاسم) ← 1 (رقم الطلب) | `[customerName]` مع زرين في [team.ts:308](../src/team.ts) | ❌ غير جاهز: العدد متطابق لكن المعنى مختلف (اسم مقابل رقم طلب)، والجديد بلا الزرين «كل شي تمام / عندي ملاحظة» |
| utak_delivery_incoming ← utak_out_for_delivery | UTILITY | 3 (الاسم، السائق، الوقت) ← 2 (رقم الطلب، السائق) | لا يوجد مستدعٍ لـ `T.CUSTOMER_DELIVERY_INCOMING` | ❌ غير جاهز: العدد والترتيب مختلفان (نفس حالة الزوج الأول) |
| utak_v2_pay_remind ← utak_payment_reminder | UTILITY | 2 (الاسم، المبلغ) ← 3 (رقم الفاتورة، المبلغ، الاستحقاق) | `[name, amount]` في [outreach.ts:81](../src/outreach.ts) | ❌ غير جاهز: يحتاج تعديل الكود ليرسل رقم الفاتورة وتاريخ الاستحقاق |
| utak_v2_welcome ← utak_welcome | القديم MARKETING، والجديد UTILITY | 1 (الاسم) ← 2 (الاسم، موعد الإغلاق) | `[profileName]` في [index.ts:1971](../src/index.ts) | ❌ غير جاهز: ينقص متغير `{{2}}` |
| utak_v2_inactive ← utak_reactivate | MARKETING | 1 (الاسم) ← 2 (الاسم، عرض اليوم) | `[name]` في [outreach.ts:113](../src/outreach.ts) | ❌ غير جاهز: ينقص متغير `{{2}}`، والقديم فيه زرّا رد سريع |

**القوالب السبعة المعلّقة:** لم تُسمِّ ملفات التسليم في المستودع قائمة صريحة بسبعة قوالب. الجدول التالي **مستنتج** من Odoo، وهو الأغراض السبعة التي ما زالت مربوطة بقوالب v1/v2 القديمة خارج الأزواج الستة، مع البديل الأقرب إن وُجد:

| الغرض (x_purpose) | القالب الحالي (المتغيرات) | البديل المرشّح (المتغيرات) | الحكم |
|---|---|---|---|
| supplier_ask | utak_supplier_daily_ask (1، **MARKETING**) | لا يوجد مكافئ؛ `utak_supplier_price_nudge` (2) قالب تذكير وليس طلب أسعار | يبقى كما هو. يُقترح تقديم نسخة UTILITY |
| customer_daily_remind | utak_v2_daily_remind (1 + زرّان، MARKETING) | utak_order_cutoff (1 = الساعة، بلا أزرار) | ❌ غير مكافئ، لأن الكود يعتمد على الزرين ([standing.ts:26](../src/standing.ts)) |
| customer_invoice | utak_invoice_customer_v2 (4) | — | يبقى، وهو مطابق للكود ([invoice.ts:180](../src/invoice.ts)) |
| customer_invoice_pdf | utak_invoice_pdf_v1 (4 + DOCUMENT) | utak_invoice_ready (3 + DOCUMENT: رقم، مبلغ، استحقاق) | ❌ غير جاهز: الكود يرسل [الاسم، الرقم، التاريخ، الإجمالي] ([invoice.ts:172](../src/invoice.ts)) |
| loading_done | utak_v2_loading (2) | — | لا يوجد مستدعٍ في الكود |
| owner_summary | utak_v2_summary (3) | — | لا يوجد مستدعٍ مباشر؛ مذكور فقط في [meta.ts:206](../src/meta.ts) |
| commission | utak_v2_commission (3، MARKETING) | — | لا يوجد مستدعٍ ولا كود رواتب |

**⚠️ أغراض مكرّرة في Odoo:** الدالة `fetchMapping` تستعلم بـ `limit: 1` دون ترتيب ([templates.ts:13-33](../src/templates.ts)).

| الغرض | السجلات | الحالة |
|---|---|---|
| `collection_summary` | 11 utak_collection_summary (4 متغيرات، يطابق الكود) و42 utak_v2_collection (3، لا يطابق) | مكرّر |
| `purchase_list` | 5 utak_purchase_list_v2 (4، يطابق) و43 utak_v2_purchase (2) | مكرّر |
| `driver_dispatch` | 7 utak_driver_dispatch (4، يطابق) و44 utak_v2_driver_route (2) | مكرّر |

الترتيب الافتراضي حسب id يختار اليوم السجل الصحيح، لكن هذا مصادفة: إذا تغيّر الترتيب فستفشل الرسائل.

**`x_purpose` الحالي لكل قالب في Odoo:**

| id | القالب | x_purpose |
|---|---|---|
| 4 | utak_supplier_daily_ask | supplier_ask |
| 5 | utak_purchase_list_v2 | purchase_list |
| 6 | utak_v2_loading | loading_done |
| 7 | utak_driver_dispatch | driver_dispatch |
| 8 | utak_driver_stop | driver_stop |
| 9 | utak_driver_collection | driver_collection |
| 10 | utak_collection_request | collection_request |
| 11 | utak_collection_summary | collection_summary |
| 12 | utak_v2_commission | commission |
| 13 | utak_v2_summary | owner_summary |
| 14 | utak_v2_welcome | customer_welcome |
| 15 | utak_v2_daily_remind | customer_daily_remind |
| 16 | utak_v2_order_confirm | customer_order_confirm |
| 17 | utak_delivery_incoming | customer_delivery_incoming |
| 18 | utak_delivery_done | customer_delivery_done |
| 19 | utak_invoice_customer_v2 | customer_invoice |
| 20 | utak_v2_pay_remind | customer_pay_remind |
| 21 | utak_v2_inactive | customer_inactive |
| 22 | utak_feedback | customer_feedback |
| 23 | utak_invoice_pdf_v1 | customer_invoice_pdf |
| 24 | utak_owner_alert | owner_alert |
| 25 | utak_shift_start | team_shift_start |
| 42 | utak_v2_collection | collection_summary (مكرّر) |
| 43 | utak_v2_purchase | purchase_list (مكرّر) |
| 44 | utak_v2_driver_route | driver_dispatch (مكرّر) |
| 45 | hello_world | other |
| 46 | utak_supplier_confirm_v1 | supplier_confirm |
| 47 إلى 71 | القوالب الجديدة الـ 25 (من po_confirmed حتى followup_order) | **other**، أي أن أياً منها غير مربوط بغرض |

`x_meta_status` في Odoo = APPROVED للجميع، وهو متطابق مع Meta.

## 6) المستندات والهوية

**تقسيم الصفحات** ([src/pdf-template.ts](../src/pdf-template.ts)):
- أثر commit `af8c3c9` **موجود**:
  - `@page { size: A4 }` في السطرين :477 و:605.
  - `break-after: page`.
  - `thead` يتكرر في كل صفحة، والصفوف والكتل لا تنقسم (:480-484 و:608-612).
  - Gotenberg يطبع «صفحة X من Y».
- **`overflow: hidden` أُزيل** من CSS، ولم يبقَ إلا في التعليقات (:450 و:574).
- **ملاحظة:** في الفرع الافتراضي (byte-parity) ما زال div الصفحة يحمل `height: 297mm` ثابتاً ([pdf-template.ts:490](../src/pdf-template.ts))، مع أن التعليق في :450-453 يقول إنه صار `min-height`. الفرع الآخر (`pageStyle`، :579) يستخدم `min-height`. المحتوى لم يعد يُقص لأن `overflow` صار مرئياً، لكن خلفية الصفحة الأولى وحشوتها لا تمتدان مع المحتوى. هذا يحتاج تحققاً بصرياً على مستند طويل.

**اسم الشركة في Odoo:** «شركة يو تاك ذات مسؤولية محدودة». كلمة «يو تاك» **منفصلة** وليست «يوتاك» متصلة، في `res.company.name` و`res.partner` (id=1) معاً.

**بيانات الهوية:**

| البيان | موجود؟ | الحقل |
|---|---|---|
| الرقم الضريبي | ✅ 315022736600003 | `res.company.vat` و`res.partner.vat` (id=1) |
| العنوان | ✅ جزئياً: السلي، الرياض 14273 | `street` و`city` و`zip` (الحقول القياسية) |
| الجوال والبريد | ✅ | `phone`، `email` |
| السجل التجاري (CRN) | ❌ غير موجود في أي حقل | `company_registry` غير متاح أو فارغ. حقول `l10n_sa_additional_identification_*` **غير موجودة على res.partner** لأنها تأتي مع `l10n_sa_edi` غير المثبت، لذلك لن يجد commit `53a59e2` ما يقرؤه |
| الاسم القانوني ثنائي اللغة | ❌ فارغ | `x_legal_name_ar`، `x_legal_name_en` |
| العنوان ثنائي اللغة | ❌ فارغ | `x_address_ar`، `x_address_en` |

**الختم والتوقيع:** **لا توجد حقول على الشركة.** الموجود فقط حقول تطبيق Sign: `sign_terms*` و`sign_invoice` (boolean) و`sign_send_request_wa_template_id`، ولا يوجد حقل صورة لختم أو توقيع.

**ما هو جاهز لإصدار القوائم المالية على الورق الرسمي:**
- الغلاف الرسمي `renderPDFShell` مع Gotenberg.
- نموذج `x_official_doc` مع أربعة قوالب، ونسخ إنجليزية.
- الفوتر القانوني الموحّد.
- دعم ar/en/bi.
- تعدد الصفحات.
- قارئ ميزان المراجعة ([accounting.ts:319-369](../src/accounting.ts)).
- سكربت مؤقت لقائمة الدخل التقديرية (`scripts/oneoff/income-statement-zatca.ts`، غير متتبع).

**ما ينقص:**
1. قيود حقيقية، فعددها اليوم 0.
2. قيد التحصيل (البند 2).
3. ضريبة على المنتجات وضريبة افتراضية للشركة.
4. حلقة المشتريات: COGS والذمم الدائنة (AP)، و`purchase.order` = 0.
5. قيد رأس المال الافتتاحي على 300010.
6. السجل التجاري، والاسم والعنوان بلغتين.
7. حقول الختم والتوقيع.
8. `l10n_sa_edi` للفوترة الإلكترونية، المرحلة الثانية من ZATCA.
9. قرار قفل الفترات، فكل حقول القفل فارغة.

## 7) النظافة والأمن

- **`src/audit-partners.ts`: موجود**، ومساره `/admin/audit-partners` **مسجّل** ([index.ts:169-180](../src/index.ts)) خلف `AUDIT_TOKEN`. هذا السر غير موجود في قائمة أسرار sim، لذلك يرد المسار على sim بـ 401 دائماً. مع ذلك يبقى في الكود مسار كتابة: `?create_pilot=1` ينشئ `res.partner` ([audit-partners.ts:316](../src/audit-partners.ts)).
- **`.gitignore`:**
  - يغطي `.env.sim-verify` ✅.
  - يغطي `.env.zatca-oneoff` ✅، لكن في تعديل غير مُرسَل.
  - يغطي `/*.pdf` في الجذر فقط ✅.
  - **لا يغطي** ملفات PDF تحت `scripts/artifacts/`، وفيها **46 ملف PDF متتبعاً**، وهي عيّنات الاختبار.
  - يغطي أيضاً `.dev.vars` و`*.bak` و`*.bak2` و`*.old`. لكن `src/config.ts.bak2` و`src/invoice.ts.old` موجودان على القرص، ومتجاهَلان.
- **الملفات غير المتتبعة الآن:** `scripts/oneoff/income-statement-zatca.ts`، ومعه تعديل `.gitignore`. لم يُضمَّنا في هذا الـ commit.
- **أسرار Cloudflare على sim** (الأسماء فقط): ADMIN_TOKEN، ANTHROPIC_API_KEY، GOTENBERG_PASSWORD، GOTENBERG_URL، GOTENBERG_USER، INTERNAL_WEBHOOK_SECRET، META_ACCESS_TOKEN، META_APP_SECRET، META_VERIFY_TOKEN، ODOO_API_KEY، ODOO_HOOK_TOKEN، SALE_PDF_DOWNLOAD_TOKEN، SIM_SECRET. **لا يوجد اسم يشبه قيمة hex.**
- **خلل `utak_supplier_daily_ask` في `src/suppliers.ts` ما زال قائماً:**
  - [suppliers.ts:129-135](../src/suppliers.ts): `sendTemplate` يُستدعى **دون purpose**، فيُسجَّل الإرسال بلا ربط بقالب، و`x_template_id` فارغ في كل السجلات.
  - [suppliers.ts:148](../src/suppliers.ts): `logWaMessage` يُستدعى يدوياً، ومعه ينعكس نفس الإرسال عبر `fetchMeta` ثم `dispatchEcho` ([meta.ts:310/367/379](../src/meta.ts) → [meta.ts:538](../src/meta.ts))، **فيُكتب سطران لكل إرسال**.
  - [suppliers.ts:139](../src/suppliers.ts): فشل الإرسال يُسجَّل `no_reply` فيختلط بعدم الرد.
  - [suppliers.ts:125](../src/suppliers.ts): القص عند 900 حرف قد يقطع اسم صنف.
  - القالب نفسه مصنّف **MARKETING** لدى Meta.
- **هل يسجّل مسار 02:00 في `x_wa_message`؟ نعم، ولكن مكرراً.** دورة 2026-09-22 23:00 UTC:
  - سجلّا طلب (`x_supplier_price_request_log` 23 و24، `sent`).
  - أربعة صفوف `x_wa_message` (115 إلى 118)، كلها `out/template/auto/sent` للشريك 30 أحمد حسان، و`x_template_id` فارغ فيها.

## 8) المتبقي للتشطيب (مرتب بالأولوية)

1. **إصلاح قيد التحصيل:** ضبط `payment_account_id` على سطري Manual Payment الواردين في CSHD (id 5) وBNK1 (id 3)، إما إلى حساب وسيط `asset_current` أو مباشرة إلى 101007 و101001. يُنفَّذ بسكربت `acct-…-payment-fix.mjs` مع rollback، ويُضاف حارس في `accounting.ts` يتحقق أن للدفعة `move_id`، وأن حسابها من النوع المتوقع بعد الترحيل. ويُضاف `partner_id` إلى بحث الدفعة ([accounting.ts:278](../src/accounting.ts)).
2. **الضريبة:** ربط ضريبة المبيعات 5 وضريبة المشتريات 21 بالمنتجات الـ 40، وضبط `account_sale_tax_id` و`account_purchase_tax_id` على الشركة. بدون ذلك كل فاتورة تصدر دون ضريبة القيمة المضافة.
3. **تنظيف الأغراض المكرّرة** (42 و43 و44) أو إفراغ `x_purpose` فيها، وإضافة `order` في `fetchMapping`.
4. **ترحيل القوالب الستة:** يحتاج تعديل كود قبل نقل `x_purpose`: pay_remind وwelcome وinactive تحتاج متغيراً إضافياً، وdelivery_done يحتاج قراراً بشأن الزرين. الزوجان order_confirm وdelivery_incoming يمكن نقلهما دون أثر لأنه لا مستدعي لهما.
5. **خلل 02:00:** تمرير purpose لـ `sendTemplate`، وإزالة التسجيل المزدوج، والتمييز بين فشل الإرسال وعدم الرد. ويُقترح تقديم نسخة UTILITY من طلب الأسعار.
6. **قيد رأس المال الافتتاحي** على 300010.
7. **حلقة المشتريات:** من `x_purchase_list` إلى `purchase.order` ثم فاتورة المورد، لإظهار COGS والذمم الدائنة.
8. **الهوية:**
   - تثبيت `l10n_sa_edi` أو اعتماد مصدر للسجل التجاري.
   - تعبئة الاسم والعنوان بلغتين.
   - توحيد كتابة الاسم («يو تاك» أو «يوتاك») حسب السجل التجاري.
   - إضافة حقول صورة للختم والتوقيع.
9. **`pdf-template.ts:490`:** توحيد `height` إلى `min-height`، مع التحقق البصري على مستند طويل.
10. **النظافة:**
    - حذف `audit-partners` ومساره.
    - إضافة `scripts/artifacts/*.pdf` إلى `.gitignore` مع قرار بشأن الملفات الـ 46 المتتبعة.
    - إرسال تعديل `.gitignore` المعلّق.
11. **ما قبل prod:** قرار صريح بتفعيل `ACCOUNTING_SYNC` على prod، ونقل الكرون من sim إلى prod حسب الخطوات الموثقة في `wrangler.toml`.
12. **تحقق يحتاج متابعة:** في [invoice.ts:112](../src/invoice.ts) تُمرَّر قيمة `l.product_id` كأنها `product_tmpl_id`. إذا لم تكن هي نفسها معرّف القالب، فسيسقط ربط المنتج على سطر الفاتورة دون أي خطأ.
