# حالة مشروع UTAK — المرجع الموحّد

- **تاريخ الفحص:** 2026-09-23 (≈ 05:30 UTC)
- **الفرع:** `sim-harness`، وHEAD قبل هذا الملف هو `adb7255`
- **نوع الفحص:** للقراءة فقط. لم يُكتب شيء في Odoo (لا create ولا write ولا unlink)، ولم يُرسل إلى Graph إلا طلبات GET، ولم يُنشر شيء، ولم يُعدَّل `src/` ولا `wrangler.toml`.
- **الاستعلامات:** [scripts/status-20260923-full-check.mjs](../scripts/status-20260923-full-check.mjs)، ومخرجها الخام في `scripts/artifacts/status-20260923-full-check.json`.
- **تحديث 2026-09-23 (بعد الفحص):** أُصلح تكرار الرسائل الآلية (§ 9) وقيد التحصيل (§ 2)، وأُعيد تفعيل `ACCOUNTING_SYNC` على sim بعد نجاح التحقق الحي. الأقسام 1 و2 و3 و7 و8 محدّثة، وما لم يُذكر فيه «تحديث» فهو من فحص الصباح.
- **تحديث 2026-09-23 (الضريبة):** فُعّلت ضريبة القيمة المضافة 15% بتاريخ سريان 2026-10-01 بتوقيت الرياض (§ 10). الأقسام 1 و3 و8 محدّثة.
- **تحديث 2026-09-23 (المشتريات):** رُبطت قائمة الشراء بالمحاسبة: `x_purchase_list` ← `purchase.order` ← فاتورة مورد `in_invoice` (§ 11). الأقسام 1 و3 و4 و8 محدّثة.
- **ملاحظة تقنية:** `read_group` يرجع 404 على `/json/2` في هذا الإصدار من Odoo، لذلك يجمّع السكربت الأرقام محلياً من `search_read`.

## ملخص: جاهز / ناقص / معطّل

| # | البند | الحالة | الخلاصة |
|---|---|---|---|
| 0 | الفرع وgit | ✅ جاهز | الفرع متزامن مع origin (0/0)، وفيه 16 commit بعد `321af5d`. في الشجرة `.gitignore` معدّل ومجلد `scripts/oneoff/` غير متتبع |
| 1 | النشر | ✅ جاهز (تحديث 09-23) | نسخة sim هي `6385b0ed` (2026-09-23)، ونسخة prod `5c138821` بلا تغيير. **جدولة prod كانت فعّالة فعلياً** (سبب التكرار) وفُرّغت عبر API؛ الكرون الآن على sim فقط فعلاً. `ACCOUNTING_SYNC=true` على sim |
| 2 | إصلاح قيد التحصيل | ✅ منفّذ (09-23) | `payment_account_id` مضبوط على السطور الأربعة، والحارسان في الكود، والتحقق الحي بثلاث دورات نجح ثم عُكس إلى صفر |
| 3 | المحاسبة الفعلية | ⚠️ ناقص | عدد القيود الحقيقية **0**. كل القيود لشريكي الاختبار 48 و51 ومعكوسة، والميزان العام صفر |
| 3 | الضرائب والشركة | ✅ مفعّلة (09-23، سريان 10-01) | ضريبة البيع 5 وضريبة الشراء 21 على المنتجات الأربعين وعلى الشركة، وضريبة البيع شاملة في السعر. الكود يقرر الضريبة بتاريخ الفاتورة (§ 10). `l10n_sa_edi` غير مثبت (خارج هذا الأمر) |
| 4 | ربط المشتريات | ✅ منفّذ على sim (09-23) | إغلاق القائمة ← `purchase.order` مؤكد ← فاتورة مورد مرحّلة (400001 مدين / 201002 دائن / 104041 للمورد المسجل بعد الحد). لا دفعات للموردين بعد: الذمم الدائنة تبقى مفتوحة (§ 11) |
| 4 | خريطة الربط | ⚠️ ناقص | ثلاثة تدفقات تكتب قيوداً (الفاتورة والتحصيل وفاتورة المورد)، والباقي يكتب في نماذج `x_*`. المصاريف والرواتب ليس لها كود |
| 5 | قوالب واتساب | ⚠️ ناقص | كل القوالب الـ 52 معتمدة (APPROVED)، لكن **لا يصلح أي زوج من أزواج الترحيل الستة للترحيل دون تعديل الكود**، وثلاثة أغراض مكرّرة في Odoo |
| 6 | تقسيم الصفحات | ✅ جاهز (مع ملاحظة) | `overflow:hidden` أُزيل، والصفحات تتعدد. بقي `height: 297mm` ثابتاً في الفرع الافتراضي |
| 6 | الهوية الرسمية | ⚠️ ناقص | الاسم والرقم الضريبي والعنوان موجودة. السجل التجاري غير موجود، والحقول الثنائية فارغة، ولا توجد حقول للختم أو التوقيع |
| 7 | النظافة والأمن | ⚠️ ناقص | `audit-partners` ما زال موجوداً. ~~سجل 02:00 يُكتب مرتين~~ أُصلح 09-23 (§ 9). يوجد 46 ملف PDF متتبع في `scripts/artifacts` |
| 9 | تكرار الرسائل الآلية | ✅ أُصلح (09-23) | السبب: جدولة prod فعّالة بجانب sim = إرسال حقيقي مزدوج. أُزيلت جدولة prod، ومفتاح idempotency في KV، وسجل واحد لكل wamid |

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

**تحديث 2026-09-23 (المشتريات):** sim = `e380feb5-7fa3-4478-aea7-c25db24db119`. prod بلا نشر، وجدولته الفعلية `[]` (عبر API قبل النشر وبعده)، وsim ثمانية مواعيد.

**تحديث 2026-09-23 (الضريبة):** sim = `06983cb5-fcd9-4b29-8709-6f4d1d7bfaf0`. prod بلا تغيير (`5c138821`)، وجدولته الفعلية `[]` (تحقق عبر API قبل النشر وبعده).

**تحديث 2026-09-23:** sim = `6385b0ed-ad0d-4130-b56b-b53bdc0656c8` (نُشر مرتين اليوم: `a5123ec2` بتعطيل ACCOUNTING_SYNC أولاً، ثم `6385b0ed` بالإصلاحات وإعادة تفعيله). **جدولة prod الفعلية** (من Cloudflare API، لا من الملف) كانت الثمانية كلها منذ 2026-09-20 22:18:32 UTC، وهي الآن `[]`. نسخة الاسترجاع: `scripts/artifacts/cron-20260923-prod-schedules-rollback.json`.

**`ACCOUNTING_SYNC` في `wrangler.toml`:**
- `[vars]` (prod): غير معرّف، أي مطفأ.
- `[env.sim.vars]`: `"true"` (عُطّل صباح 09-23 ثم أُعيد بعد التحقق الحي).
- `[env.pilot.vars]`: غير معرّف.

قد يكون prod مضبوطاً من لوحة Cloudflare، ولم يُفحص ذلك لأن الفحص لم يقرأ متغيرات اللوحة.

**جداول cron:**
- prod `[triggers]`: `crons = []` في الملف، **لكن الجدولة الفعلية على Cloudflare كانت الثمانية حتى 2026-09-23** (انظر § 9). الآن فارغة فعلياً.
- sim `[env.sim.triggers]`: ثمانية مواعيد، هي 02:00 و05:00 و06:00 و21:00 و21:15 و18:00 و17:00 و08:00 بتوقيت الرياض (`0 23` و`0 2` و`0 3` و`0 18` و`15 18` و`0 15` و`0 14` و`0 5` UTC).
- pilot `[env.pilot.triggers]`: `crons = []`.

**`/health` على sim** (الحقول غير الحساسة فقط):
- `status`: `ok`
- `odoo`: `connected (apikey)`
- `sigFailures.totalLast7Days`: 2، وكلاهما في 2026-09-21

`/health` على prod يرد HTTP 200.

## 2) هل نُفّذ إصلاح قيد التحصيل؟

> **تحديث 2026-09-23 — ✅ منفّذ.** ما يلي تحت هذا المربع هو حالة الصباح قبل الإصلاح.
>
> **Odoo** ([scripts/acct-20260923-payment-fix.mjs](../scripts/acct-20260923-payment-fix.mjs)، idempotent، rollback: `scripts/artifacts/acct-20260923-payment-fix-rollback.json`، الاسترجاع بـ `--rollback`):
>
> | سطر | اليومية | الاتجاه | قبل | بعد | النوع |
> |---|---|---|---|---|---|
> | 5 | CSHD | inbound | فارغ | 101007 كاش السائق (257) | asset_cash |
> | 6 | CSHD | outbound | فارغ | 101007 كاش السائق (257) | asset_cash |
> | 3 | BNK1 | inbound | فارغ | 101003 Outstanding Receipts (254) | asset_current |
> | 4 | BNK1 | outbound | فارغ | 101004 Outstanding Payments (255) | asset_current |
>
> **الكود** (`src/accounting.ts`):
> - معرّف الدفعة يؤخذ من ناتج `action_create_payments` مباشرة (`res_model=account.payment` + `res_id`، ثبت حياً على Odoo 19 JSON-2 في الدورات الثلاث: «located via action»)، والبحث الاحتياطي صار بالشريك + المبلغ + اليومية + التاريخ معاً (`extractPaymentIdFromAction`، `buildPaymentSearchDomain`).
> - حارس الدفعة `evaluatePaymentGuard`: قيد موجود ومرحّل، الحساب المدين asset_cash أو asset_current، لا income ولا expense، شريك الدفعة = شريك الفاتورة، والفاتورة paid أو in_payment (أو partial لدفعة جزئية فعلاً). عند الفشل: إلغاء الدفعة، تنبيه مالك عبر `T.OWNER_ALERT` برقم الفاتورة والسبب، ولا ربط. مسار x_payment وواتساب لا يتوقف.
> - حارس الفاتورة `evaluateInvoiceGuard`: الذمم مدينة والإيراد دائن ولا مصروف؛ عند الفشل يُلغى القيد ولا يُربط.
> - **خلل كشفه التحقق الحي:** `currency_id: false` في الـ wizard كان يمر لأن الدفعة بلا قيد؛ بعد ضبط الحساب رفضه Odoo («Missing required field Currency»). أُزيل.
> - ملاحظة Odoo 19: `account.payment.state` لا يحوي `posted` (draft/paid/reconciled/canceled/rejected)، فشرط «posted» يُفحص على `move_id.state`. وإلغاء الدفعة في Odoo 19 يحذف قيدها (`move_id` يصير فارغاً).
>
> **الدفعات الأربع القديمة** PAY00001..00004 (canceled، بلا قيد): **لم تُلمس.**
>
> **التحقق الحي** (`scripts/acct-20260921-live-verify.mjs`، يستورد `src/accounting.ts` نفسه، يحجب أي طلب إلى graph.facebook.com، فروق على الميزان العام المرحّل):
>
> | الدورة | الحساب | المتوقع | الفعلي قبل العكس | بعد العكس |
> |---|---|---|---|---|
> | أ كاش (فاتورة 12، دفعة 9 على CSHD) | 102011 / 500001 / 101007 | +3 / −12 / +9 | +3 / −12 / +9 ✓ | 0 |
> | ب تحويل (فاتورة 10، دفعة 10 على BNK1) | 102011 / 500001 / 101003 | 0 / −10 / +10 | 0 / −10 / +10 ✓ (in_payment) | 0 |
> | ج التباس (7 للشريك 48 و7 للشريك 51، دفعة على 48) | 102011 / 500001 / 101007 | +7 / −14 / +7 | +7 / −14 / +7 ✓؛ الدفعة تسوّي الفاتورة 21 فقط، وفاتورة 51 not_paid | 0 |
>
> لا حساب رابع في أي دورة. العكس توقف مرة عند HTTP 429 من Odoo.com، فأُكمل بـ `--reverse-only` (صار السكربت يعيد المحاولة ويتخطى ما عُكس). المخرجات: `scripts/artifacts/acct-20260923-live-verify-*.json`.

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

**تحديث 2026-09-23:** بعد التحقق الحي صارت الأعداد: out_invoice posted = 9، out_refund posted = 9، account.payment canceled = 7 (الأربع القديمة + PCSHD/2026/00001 و00002 وPBNK1/2026/00001)، وسطور القيود المرحّلة = 36. القيود الجديدة: INV/2026/00005..00009 (ids 14، 17، 19، 21، 22) ومعكوساتها RINV/2026/00005..00009 (16، 24..27). الفاتورة 22 للشريك 51 «اختبار محاسبة ب» (شريك اختبار ثانٍ لدورة الالتباس، `x_is_simulation=true`، مؤرشف). **الميزان العام بعد العكس: 102011 = 0، 500001 = 0، ولا حساب آخر.**

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
| account_sale_tax_id | ~~فارغ~~ → **5 «15%» sale** (تحديث 09-23) |
| account_purchase_tax_id | ~~فارغ~~ → **21 «15%» purchase** (تحديث 09-23) |
| tax_calculation_rounding_method | ~~round_globally~~ → **round_per_line** (تحديث 09-23) |
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
| قائمة الشراء | `x_purchase_list`، `x_daily_order_line`، ومعهما `purchase.order` + فاتورة مورد عند الإغلاق إذا كان ACCOUNTING_SYNC مفعّلاً | `purchase.order` ثم فاتورة مورد | **نعم على sim (09-23)**: تكلفة 400001 مدين، ذمم 201002 دائن، وضريبة مدخلات 104041 للمورد المسجل بعد الحد | [team.ts:64](../src/team.ts) → [odoo.ts:1022](../src/odoo.ts)؛ الإغلاق [team.ts](../src/team.ts) `warehouseConfirmedPurchase` → [purchase-accounting.ts](../src/purchase-accounting.ts) (§ 11) |
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
- **تحديث 2026-09-23:** التسجيل اليدوي في suppliers.ts أُزيل، و`purpose` يُمرَّر، وسجل الطلب يُكتب بعد الإرسال. الصفوف الأربعة لكل ليلة كانت = عاملان (prod + sim) × تسجيلان. انظر § 9.
- **هل يسجّل مسار 02:00 في `x_wa_message`؟ نعم، ولكن مكرراً.** دورة 2026-09-22 23:00 UTC:
  - سجلّا طلب (`x_supplier_price_request_log` 23 و24، `sent`).
  - أربعة صفوف `x_wa_message` (115 إلى 118)، كلها `out/template/auto/sent` للشريك 30 أحمد حسان، و`x_template_id` فارغ فيها.

## 8) المتبقي للتشطيب (مرتب بالأولوية)

1. ~~**إصلاح قيد التحصيل**~~ ✅ 2026-09-23 (§ 2).
   الأصل: **إصلاح قيد التحصيل:** ضبط `payment_account_id` على سطري Manual Payment الواردين في CSHD (id 5) وBNK1 (id 3)، إما إلى حساب وسيط `asset_current` أو مباشرة إلى 101007 و101001. يُنفَّذ بسكربت `acct-…-payment-fix.mjs` مع rollback، ويُضاف حارس في `accounting.ts` يتحقق أن للدفعة `move_id`، وأن حسابها من النوع المتوقع بعد الترحيل. ويُضاف `partner_id` إلى بحث الدفعة ([accounting.ts:278](../src/accounting.ts)).
2. ~~**الضريبة**~~ ✅ 2026-09-23 (§ 10). **بقي:** نشر هذا الكود على prod قبل 2026-10-01، وإلا تصدر فواتير prod بعد الحد بلا ضريبة (كود prod الحالي `5c138821` يثبّت `tax_ids` فارغة ويكتب `x_tax_amount = 0`). ثم الدورة د مرحّلة فعلاً بـ `--d-date=<اليوم>` من 10-01.
   الأصل: ربط ضريبة المبيعات 5 وضريبة المشتريات 21 بالمنتجات الـ 40، وضبط `account_sale_tax_id` و`account_purchase_tax_id` على الشركة.
3. **تنظيف الأغراض المكرّرة** (42 و43 و44) أو إفراغ `x_purpose` فيها، وإضافة `order` في `fetchMapping`.
4. **ترحيل القوالب الستة:** يحتاج تعديل كود قبل نقل `x_purpose`: pay_remind وwelcome وinactive تحتاج متغيراً إضافياً، وdelivery_done يحتاج قراراً بشأن الزرين. الزوجان order_confirm وdelivery_incoming يمكن نقلهما دون أثر لأنه لا مستدعي لهما.
5. **خلل 02:00:** (التسجيل المزدوج وpurpose ✅ 2026-09-23؛ بقي: التمييز بين فشل الإرسال وعدم الرد، ونسخة UTILITY) تمرير purpose لـ `sendTemplate`، وإزالة التسجيل المزدوج، والتمييز بين فشل الإرسال وعدم الرد. ويُقترح تقديم نسخة UTILITY من طلب الأسعار.
6. **قيد رأس المال الافتتاحي** على 300010.
7. ~~**حلقة المشتريات**~~ ✅ 2026-09-23 على sim (§ 11). **بقي:** دفع الموردين (`account.payment` outbound على الذمم المفتوحة)، وتسجيل موظف مستودع (`x_role='warehouse'`؛ لا يوجد حالياً فلا تُغلق أي قائمة بالزر)، ونشر prod مع قرار ACCOUNTING_SYNC.
   الأصل: من `x_purchase_list` إلى `purchase.order` ثم فاتورة المورد، لإظهار COGS والذمم الدائنة.
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
11. **ما قبل prod:** ⚠️ قبل أي `wrangler deploy` لـ prod تحقّق من الجدولة الفعلية عبر API لا من الملف (§ 9). قرار صريح بتفعيل `ACCOUNTING_SYNC` على prod، ونقل الكرون من sim إلى prod حسب الخطوات الموثقة في `wrangler.toml`.
12. **تحقق يحتاج متابعة:** في [invoice.ts:112](../src/invoice.ts) تُمرَّر قيمة `l.product_id` كأنها `product_tmpl_id`. إذا لم تكن هي نفسها معرّف القالب، فسيسقط ربط المنتج على سطر الفاتورة دون أي خطأ.

## 9) تكرار الرسائل الآلية (2026-09-23)

**البلاغ:** الرسائل الآلية تصل مكررة على الجوال.

**الأدلة** ([scripts/dup-20260923-diag.mjs](../scripts/dup-20260923-diag.mjs)، للقراءة فقط، والمخرج `scripts/artifacts/dup-20260923-diag.json`):
- `x_wa_message` آخر 14 يوماً: 56 صفاً صادراً، 54 منها بلا wamid. 14 مجموعة تكرار خلال 5 دقائق، وكلها بنمط واحد: **دفعتان كاملتان بفارق 30–50 ثانية**، أولهما قرب :13 والثانية قرب :46.
- جدول D1 `sim_outbound` على sim يحمل wamid الحقيقي من Meta، وفيه **إرسال واحد فقط** لكل مستقبل في كل مهمة، في توقيت الدفعة الثانية (:45). أي أن الدفعة الأولى أرسلها عامل آخر لا يكتب في D1 sim.
- Cloudflare API: `utak-worker` (prod) كانت جدولته الفعلية **الثمانية كلها**، `created_on 2026-09-20T22:18:32Z`، أي لحظة نشر `5c138821`. ذلك النشر سبق commit `872202f` (تفريغ crons في الملف) بساعة، ولم يُعَد نشر prod بعده. أول تكرار مسجّل: 2026-09-20 23:00 UTC، أي أول تشغيل بعد النشر.

**الحكم:** **إرسال حقيقي مكرر**، لا تكرار تسجيل فقط. العامل prod يعمل بلا PILOT_MODE وبلا SIM_ALLOWLIST، فيرسل الرسالة نفسها مرة ثانية. wamid الدفعة الأولى غير متاح لأن prod لا يكتب D1، ولأن سجل الـ echo لم يكن يحمل wamid أصلاً. وفوق ذلك كان مسار 02:00 يكتب صفين لكل إرسال (4 صفوف في الليلة = عاملان × تسجيلان).

| الحالة (UTC) | المستقبل | القالب/النوع | المرات | wamid |
|---|---|---|---|---|
| 09-20 23:00 | ********704 | utak_supplier_daily_ask | 2 إرسال (4 صفوف) | sim: `…NTMwRDgx…` · prod: غير مسجّل |
| 09-21 05:00 | ********888 / ********756 | utak_v2_inactive | 2 لكل واحد | sim: `…OUU5MEQ5…` / `…MDFCMDA1…` · prod: غير مسجّل |
| 09-21 15:00 | ********832 / ********002 | ملخص التحصيل (نص) | 2 لكل واحد | sim: `…RUJCREJE…` / `…M0U3QzU4…` · prod: غير مسجّل |
| 09-21 23:00 | ********704 | utak_supplier_daily_ask | 2 (4 صفوف) | sim: `…QkMyNTRD…` · prod: غير مسجّل |
| 09-22 05:00 | ********370 / ********051 | utak_v2_inactive | 2 لكل واحد | sim: `…RDY4NTg3…` / `…QTI2RjE1…` · prod: غير مسجّل |
| 09-22 15:00 | ********832 / ********002 | ملخص التحصيل (نص) | 2 لكل واحد | sim: `…REZFMzc4…` / `…MjY1ODlF…` · prod: غير مسجّل |
| 09-22 23:00 | ********704 | utak_supplier_daily_ask | 2 (4 صفوف) | sim: `…NzNENzk3…` · prod: غير مسجّل |

**الأسباب المحتملة، واحداً واحداً:**

| السبب | ينطبق؟ | الدليل |
|---|---|---|
| جدولة مكررة في wrangler.toml على نفس الموعد | لا في الملف، **نعم فعلياً** | الملف: 8 مواعيد فريدة على sim و`[]` على prod. لكن Cloudflare: الثمانية فعّالة على prod أيضاً (السبب الجذري) |
| أكثر من scheduled handler أو مسار لنفس دالة الإرسال | لا | handler واحد في `src/index.ts`؛ `/sim/trigger` يدوي ولم يُستدعَ في أوقات التكرار |
| إعادة محاولة بعد خطأ شبكة | لا | `fetchMeta` بلا retry. الإرسال الثاني ضمن sim للملخص هو fallback نصي بعد فشل القالب (`wamid.PILOT.no_id`)، أي أن القالب لم يصل |
| غياب مفتاح idempotency | نعم (عامل مساعد) | لا يوجد أي مفتاح على مستوى المستقبل + القالب + اليوم |
| تسجيل مزدوج في الإرسال والويبهوك | نعم في 02:00 فقط | `suppliers.ts` كان يسجّل يدوياً، و`fetchMeta` يسجّل عبر echo |
| إعادة معالجة webhook status | لا | `updateWaStatusByWamid` يعدّل فقط ولا ينشئ |
| رد آلي مزدوج على الوارد | لم يُرصد في 14 يوماً، لكن الثغرة موجودة | `markSeen` كان يُكتب بعد المعالجة، فإعادة Meta أثناء المعالجة تمر من `seenBefore` |

**الإصلاح:**
1. **الجذر:** `PUT /workers/scripts/utak-worker/schedules []` بعد موافقة براء الصريحة (لا نشر ولا تعديل كود على prod). مُتحقَّق: `schedules: []`.
2. **مفتاح idempotency** ([src/auto-send-guard.ts](../src/auto-send-guard.ts)): `autosend:v1:<يوم الرياض>:<رقم المستقبل>:<القالب أو النوع>:<المهمة>`، مدته 26 ساعة، ويُكتب قبل الإرسال داخل `fetchMeta`. يعمل فقط حين يحمل env الحقل `AUTO_SEND_JOB`، وهذا الحقل يضعه `scheduled()` و`runSimJob()` فقط. أي محاولة ثانية تُرفض بـ 409 `SkippedDuplicate` وتُسجَّل `[auto-send] skipped duplicate`. أُضيفت «المهمة» إلى المفتاح لأن المالك يستلم `utak_owner_alert` من مهام 06:00 و21:00 و21:15 في اليوم نفسه، وكلها مشروعة.
3. **الإرسال اليدوي من Odoo** (`wa_message_manual`) لا يُحجب؛ التكرار خلال دقيقة يُسجَّل `[manual-send] … repeated within 60s — not blocked`.
4. **سجل واحد لكل wamid:** الـ echo يمرّر wamid، و`logWaMessage` يتحقق من وجوده قبل الإنشاء (فهرس منطقي)، والتسجيل اليدوي في 02:00 أُزيل.
5. **الوارد:** `markSeen` يُكتب فور تجاوز `seenBefore`.

**الاختبارات:** `tests/auto-send-guard.test.mts` (25 ✓): الاستدعاء المزدوج يرسل مرة، اليوم التالي بتوقيت الرياض يرسل، مهمة مختلفة لا تُحجب، اليدوي لا يُحجب، سجل واحد لكل wamid، المفتاح يُكتب قبل الإرسال.

**حدود:** KV متسق في النهاية بين المناطق، فتشغيلان متزامنان في منطقتين مختلفتين خلال ثوانٍ قد يمرّان معاً. لذلك الإصلاح الجذري (مُجدوِل واحد) هو الأساس، والمفتاح شبكة أمان.

## 10) ضريبة القيمة المضافة 15% (2026-09-23، سريان 2026-10-01 بتوقيت الرياض)

**القرارات المقفلة:** 15% على كل المنتجات بيعاً وشراءً. سعر البيع **شامل** الضريبة، فيُفصل في الفاتورة إلى صافٍ وضريبة، ويبقى المجموع كما كان يدفعه العميل. الحد الفاصل هو تاريخ الفاتورة بتوقيت الرياض: قبل 2026-10-01 بلا ضريبة، ومن 2026-10-01 فصاعداً 15%. لا فوترة إلكترونية، ولا `l10n_sa_edi`، ولا QR.

**Odoo** ([scripts/tax-20260923-enable-vat.mjs](../scripts/tax-20260923-enable-vat.mjs)، idempotent، و`--dry-run`، والاسترجاع بـ `--rollback` من `scripts/artifacts/tax-20260923-enable-vat-rollback.json`):

| البند | قبل | بعد |
|---|---|---|
| `res.company.vat` | 315022736600003 | بلا تغيير. لم يُمرَّر `UTAK_VAT_NUMBER` ولا يوجد `.env.vat`، والقيمة الموجودة صحيحة الشكل (15 رقماً، تبدأ بـ 3 وتنتهي بـ 3) |
| `account_sale_tax_id` | فارغ | 5 «15%» sale (حسابها 201017 VAT Output) |
| `account_purchase_tax_id` | فارغ | 21 «15%» purchase (حسابها 104041 VAT Input) |
| `tax_calculation_rounding_method` | round_globally | **round_per_line**، ليكون مجموع ضريبة الفاتورة = مجموع ضرائب الأسطر، وهي نفس قاعدة الكود |
| ضريبة 5: `price_include_override` | false (يتبع الشركة `tax_excluded`) | **`tax_included`** → `price_include = true` |
| ضريبة 21 | tax_excluded | بلا تغيير، فأسعار الموردين صافية |
| `taxes_id` / `supplier_taxes_id` | 0 من 40 | **40 من 40** ← [5] / [21] (تغيّر 40، والتشغيل الثاني غيّر 0) |

- **Odoo 19:** `account.tax.price_include` حقل محسوب للقراءة فقط. الحقل المخزّن هو `price_include_override` (tax_included / tax_excluded / false، والقيمة false تعني اتباع `res.company.account_price_include`). لم يُلمس الافتراضي على مستوى الشركة.
- **أثر جانبي مقصود:** المنتجات صارت تحمل الضريبة، فأي `sale.order` أو فاتورة تُنشأ **يدوياً من واجهة Odoo** ستحسب 15% شاملة فوراً، حتى قبل 10-01. أما مسار الوركر فيثبّت `tax_ids` صراحة: فارغة قبل الحد، وضريبة الشركة من الحد فصاعداً. هذا يعكس بند item5 (2026-09-18) الذي كان قد أزال الضريبة عمداً.

**الكود:**
- [src/config.ts](../src/config.ts): `VAT_EFFECTIVE_DATE_RIYADH = "2026-10-01"` و`isVatApplicable(ymd)`. التاريخ المشوّه يرمي خطأ، فلا يمر أبداً كأنه بلا ضريبة.
- [src/accounting.ts](../src/accounting.ts):
  - `resolveCompanySaleTax` تقرأ `account_sale_tax_id` من Odoo، وترفض الضريبة إن كانت غير نشطة، أو ليست ضريبة بيع، أو ليست نسبة مئوية، أو **غير شاملة**.
  - `buildInvoiceLineCommands(..., taxIds)` تضع `[[6,0,[]]]` قبل الحد و`[[6,0,[5]]]` من الحد.
  - `splitTaxInclusive` و`computeInclusiveTotals`: الضريبة = تقريب(الإجمالي × 15 ÷ 115) لكل سطر، والصافي = الإجمالي − الضريبة، ثم الجمع.
- **الحارس:** `evaluateInvoiceGuard({ tax })`. من الحد: يلزم سطر ضريبة دائن، وأن تساوي `amount_tax` المتوقع (بتسامح أقل من 0.005)، وأن يساوي الإجمالي `x_invoice.total`. قبل الحد: أي سطر ضريبة يُرفض. عند الفشل يُلغى القيد، ويُنبَّه المالك، ولا يُربط.
- **خلل كشفه التحقق الحي:** إذا فشل `action_post` كانت المسودة تبقى يتيمة. صارت تُلغى.
- [src/invoice.ts](../src/invoice.ts):
  - `x_invoice` يُكتب بـ `x_subtotal` (الصافي) و`x_tax_amount` و`x_total` (الشامل)، وتاريخه صار بتوقيت الرياض بدل UTC.
  - إن تعذّر تحديد الضريبة بعد الحد: لا تصدر الفاتورة، ويُنبَّه المالك.
  - نص واتساب الاحتياطي يعرض الأسطر الثلاثة للفاتورة الضريبية فقط.
- **قالب PDF:**
  - «فاتورة ضريبية»، ثم الإجمالي قبل الضريبة، والضريبة 15%، والإجمالي شامل الضريبة.
  - الرقم الضريبي للمنشأة، والرقم الضريبي للعميل إن وُجد في `res.partner.vat`.
  - الفاتورة بلا ضريبة لا تظهر فيها أي سطور ضريبية. أُزيل سطر «ضريبة 0.00» منها، وحُدّثت لقطة `invoice.ar-snapshot.html` بفرق سطر واحد فقط.
  - QR مطفأ دائماً في هذا الأمر.
- **خلل ثانٍ:** `buildInvoicePDFDataFromAccountMove` كانت تُسقط كل الأسطر، لأن سطر المنتج في Odoo 17+ يحمل `display_type = "product"`. أُصلح.

**الاختبارات:** [tests/vat.test.mts](../tests/vat.test.mts) (66 ✓):
- 09-30 بلا ضريبة، و10-01 عليها 15%، وحد اليوم عند 21:00 UTC.
- 115 → 100 + 15، والتقريب إلى هللتين على 0.01…200.
- فاتورة متعددة الأصناف: الضريبة = مجموع ضرائب الأسطر.
- حارس غياب سطر الضريبة، ورفض الضريبة غير الشاملة، وإلغاء المسودة عند رفض الترحيل.
- المستند بالحالتين.

`tsc` نظيف، و`npm test` أخضر.

**التحقق الحي** ([scripts/tax-20260923-live-verify.mjs](../scripts/tax-20260923-live-verify.mjs)، للشريك 48 فقط، وطلبات graph.facebook.com محجوبة، مع إعادة المحاولة عند 429). Odoo (l10n_sa) **يرفض ترحيل أي فاتورة تاريخها بعد اليوم** بتوقيت الرياض («ZATCA does not allow future-dated invoices»)، واليوم 2026-09-23، فلا يمكن ترحيل 10-05 ولا 09-30 الآن. لذلك مرّ الكود الحقيقي، ورُفض الترحيل، وأُلغيت المسودة، وقيس التوزيع على سطور القيد نفسه، وثبت أن الميزان المرحّل لم يتحرك. وأضيفت الدورة هـ′ مرحّلة بتاريخ اليوم.

| الدورة | المتوقع | الفعلي قبل العكس | الميزان المرحّل | بعد العكس |
|---|---|---|---|---|
| د: 2026-10-05، 115 شامل (القيد 31، مسودة ملغاة) | 102011 +115 / 500001 −100 / 201017 −15 | +115 / −100 / −15 ✓، ولا حساب رابع | لم يتحرك ✓ | — |
| هـ: 2026-09-30، 50 (القيد 32، مسودة ملغاة) | 102011 +50 / 500001 −50، بلا ضريبة | +50 / −50 ✓، و`tax_ids` فارغة رغم افتراضي المنتج | لم يتحرك ✓ | — |
| هـ′: 2026-09-23، 50 (INV/2026/00010، id 33) | 102011 +50 / 500001 −50 | +50 / −50 ✓ | +50 / −50 | RINV/2026/00010 (34) → **0** ✓ |

- **الميزان العام بعد العكس:** فارغ، أي صفر على كل الحسابات.
- **المسودة اليتيمة 28:** من أول تشغيل قبل الإصلاح. أُلغيت، وسجلها في `scripts/artifacts/tax-20260923-orphan-draft-28-cancel.json`.
- **PDF للمراجعة البصرية:** `scripts/artifacts/tax-20260923-invoice-after-cutoff.pdf`.
- **التقرير:** `scripts/artifacts/tax-20260923-live-verify-1790151800370.json`.
- **الدورة د مرحّلةً فعلاً:** تُعاد من 2026-10-01 بـ `--d-date=<اليوم>`.


## 11) ربط المشتريات بالمحاسبة (2026-09-23)

**المسار:** إغلاق قائمة الشراء (زر `purchase_done_<id>` ← `warehouseConfirmedPurchase`) ← `purchase.order` للمورد ثم `button_confirm` ← فاتورة مورد `in_invoice` بتاريخ اليوم بتوقيت الرياض ثم `action_post` ← ربط الحقلين. كله خلف `ACCOUNTING_SYNC`، ولا يوقف مسار القائمة ولا واتساب (يُستدعى بعد إرسال المسارات، ولا يرمي أي خطأ).

**ما اكتُشف قبل التنفيذ، وقرار براء:**
- `x_purchase_list` لم يكن فيه مورد ولا سعر؛ JSON القائمة فيه الصنف والعبوة والكمية فقط. **القرار:** حقل `x_supplier_id`، و`unit_price` لكل صنف داخل `x_aggregated_items`. يُعبَّأ الاثنان آلياً في 21:15 من `x_daily_price.x_price_sar` لليوم (والمورد فقط إن كان واحداً لكل الأصناف المسعّرة)، ويُعدَّلان في Odoo قبل الإغلاق. السعر المعدّل يبقى إن أعيد تشغيل 21:15 في اليوم نفسه. نقص المورد أو أي سعر = لا أمر شراء + تنبيه مالك.
- `purchase_stock` مثبّت، و`button_confirm` ينشئ استلاماً `stock.picking` لأي منتج بضاعة (`consu`). **القرار:** منتج خدمة وسيط واحد، وأسطر أمر الشراء تحمل اسم الصنف والعبوة والكمية نصاً. لا picking، ولا تغيير لأنواع المنتجات. (ثبت حياً: `picking_ids` فارغة في الدورات الثلاث.)
- لا يوجد اليوم أي `res.partner` بـ `x_role='warehouse'`، فزر الإغلاق لا يصل أحداً فعلياً (بلاغ «ما يوجد موظف مستودع» في 21:15).

**Odoo** ([scripts/acct-20260923-purchase-setup.mjs](../scripts/acct-20260923-purchase-setup.mjs)، idempotent، و`--dry-run`، والاسترجاع بـ `--rollback` من `scripts/artifacts/acct-20260923-purchase-setup-rollback.json`):

| البند | المعرّف | التفاصيل |
|---|---|---|
| تحقق: يومية المشتريات | BILL (9) | الحساب الافتراضي 400001 |
| تحقق: 400001 | 136 | `expense_direct_cost` |
| تحقق: الذمم الدائنة | 201002 (106) | `liability_payable`، وهو `property_account_payable_id` للمورد 30 |
| `x_purchase_list.x_supplier_id` | ir.model.fields 20260 | many2one ← res.partner |
| `x_purchase_list.x_purchase_order_id` | 20262 | many2one ← purchase.order |
| `x_purchase_list.x_account_move_id` | 20264 | many2one ← account.move |
| منتج «بضاعة مشتراة (وسيط)» `UTAK-PUR-GOODS` | product.template 110 | service، مصروفه 400001، بلا ضرائب افتراضية، `purchase_method=purchase`، `sale_ok=false` |
| ضريبة «15% شامل (مشتريات)» | account.tax 43 | نسخة `copy()` من ضريبة الشركة 21 مع `price_include_override=tax_included`؛ حصتها على 104041 VAT Input. **الضريبة 21 لم تُلمس** |

لماذا ضريبة شاملة جديدة: القرار أن سعر المورد المسجل شامل 15%. مع الضريبة 21 (غير شاملة) يجب تقريب الصافي أولاً، فقد يخطئ «الصافي + الضريبة» المبلغ المدفوع بهللة (10 ← 8.70 + 1.31 = 10.01). الكود لا يثبّت المعرّف: يقرأ `account_purchase_tax_id` من الشركة، ثم يبحث عن توأمها الشامل بالنسبة والمجموعة.

**الكود:**
- [src/purchase-accounting.ts](../src/purchase-accounting.ts): `syncPurchaseListToAccounting(env, listId)`.
  - **idempotency:** أي من الحقلين موجود = تخطٍّ. وأمر شراء حي `origin = x_purchase_list/<id>` غير مربوط = لا إنشاء + تنبيه، فانقطاع بين التأكيد والربط لا يولّد أمراً مكرراً.
  - **الضريبة:** `resolvePurchaseTaxForBill`: قبل `VAT_EFFECTIVE_DATE_RIYADH` بلا ضريبة. من الحد: مورد له `vat` ← الضريبة الشاملة على كل سطر، ومورد بلا `vat` ← بلا ضريبة.
  - **الحارس** `evaluateVendorBillGuard`: in_invoice ومرحّلة، التكلفة مدينة على `expense_direct_cost` أو `expense`، الذمم دائنة على `liability_payable`، لا أي حساب آخر، سطر ضريبة مدين فقط حين يُتوقع ويساوي التقسيم، القيد متوازن، والإجمالي = المدفوع. عند الفشل: `button_draft` + `button_cancel` للفاتورة، و`button_cancel` لأمر الشراء، وتنبيه مالك (`T.OWNER_ALERT`) برقم القائمة والسبب، ولا ربط.
  - **فشل `action_post`:** تُلغى المسودة وأمر الشراء (لا يتيم).
- [src/odoo.ts](../src/odoo.ts): `prefillPurchasePrices` والتعبئة داخل `createPurchaseListRecord`.
- [src/team.ts](../src/team.ts): الاستدعاء في آخر `warehouseConfirmedPurchase`.
- [src/config.ts](../src/config.ts): `isVatApplicable(ymd, effectiveDate?)`. الوسيط الثاني للتحقق الحي فقط، ولا يمرّره أي مسار تشغيلي.
- [src/types.ts](../src/types.ts): `PurchaseListItem.unit_price` و`price_supplier_id`.

**الاختبارات:** [tests/purchase-accounting.test.mts](../tests/purchase-accounting.test.mts) (65 ✓):
- مورد غير مسجل بلا ضريبة.
- مورد مسجل بعد الحد: 115 ← الضريبة 43 على السطر.
- مورد مسجل قبل الحد بلا ضريبة.
- idempotency بالحقل وبأمر يتيم.
- حارس غياب سطر الضريبة، وحارس الحساب الخاطئ.
- رفض `action_post` يلغي المسودة وأمر الشراء.
- نقص المورد أو السعر.
- التعبئة المسبقة.
- المفتاح مطفأ.

`tsc` نظيف، و`npm test` أخضر.

**التحقق الحي** ([scripts/acct-20260923-purchase-live-verify.mjs](../scripts/acct-20260923-purchase-live-verify.mjs)):
- **النطاق:** موردا اختبار 52 و53 (`x_is_simulation`)، وطلبات graph.facebook.com محجوبة، وكل التواريخ 2026-09-23.
- **الدورة ز:** تمرر `vatEffectiveDate = اليوم` لأن Odoo يرفض الترحيل بتاريخ مستقبلي. هي وسيط دالة لا متغير بيئة.
- **التقرير:** `scripts/artifacts/acct-20260923-purchase-live-verify-1790152826693.json`.

| الدورة | القائمة ← أمر الشراء ← الفاتورة | المتوقع | الفعلي قبل العكس | بعد العكس |
|---|---|---|---|---|
| و: مورد بلا رقم ضريبي، 80 | 4 ← P00010 (8) ← BILL/2026/09/0001 (35) | 400001 +80 / 201002 −80 | +80 / −80 ✓، بلا سطر ضريبة، ولا حساب ثالث | RBILL/2026/09/0001 (38) |
| ز: مورد مسجل، 115 شامل | 5 ← P00011 (9) ← BILL/2026/09/0002 (36) | 400001 +100 / 104041 +15 / 201002 −115 | +100 / +15 / −115 ✓ | RBILL/2026/09/0002 (39) |
| ح: الإغلاق مرتين | 6 ← P00012 (10) ← BILL/2026/09/0003 (37) | أمر واحد وفاتورة واحدة؛ 400001 +30 / 201002 −30 | الثاني `skipped` بنفس المعرّفات، وأمر واحد وفاتورة واحدة ✓ | RBILL/2026/09/0003 (40) |

- **الميزان العام:** قبل العكس كان 400001 +210، و104041 +15، و201002 −225. **بعد العكس فارغ، أي صفر على كل الحسابات.**
- **التنظيف:** قوائم الاختبار 4 و5 و6 حُذفت، والموردان 52 و53 أُرشفا.
- **أوامر الشراء 8 و9 و10:** Odoo يرفض إلغاءها بعد ترحيل فاتورتها حتى مع عكسها، و`button_done` غير موجود في Odoo 19، فأُقفلت بـ `button_lock`. سجلها في `scripts/artifacts/acct-20260923-purchase-live-verify-po-lock.json`. بعد العكس تظهر `invoice_status = to invoice`، والقفل يمنع إعادة فوترتها.

**لا دفعات للموردين في هذا الأمر:** فاتورة المورد تبقى `not_paid`، والذمة الدائنة على 201002 مفتوحة حتى يُبنى مسار `account.payment` الصادر (سطرا Manual Payment الصادران في CSHD وBNK1 مضبوطان مسبقاً § 2).
