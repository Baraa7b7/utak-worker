# السكربتات (`scripts/`) — UTAK

- الجدول نُقل **حرفياً** من CLAUDE.md § 8 في § 55.1 (2026-10-05). ما يلزم في كل أمر باقٍ في [CLAUDE.md](../CLAUDE.md) § 8.
- سكربت جديد يبقى في `scripts/`: سطره هنا.
- **مخرجاتها (§ 55.1):** السكربتات التي على `scripts/lib/s40-kit.mjs` (كل سكربتات Odoo من § 46) صامتة: كل سطر في `scripts/artifacts/logs/<السكربت>-<الوضع>-<الوقت>.log`، و stdout يأخذ أسطر «✗» كاملة وسطرين في الآخر؛ `VERBOSE=1` للكامل. خطة الجاف: `grep -E '^\s*[+✎]' <السجل>`. الأقدم منها (`acct-…-setup`، و`s37-…-odoo`، و`s42-…-prelaunch-mark`، و`cutover-prod`، و`…-day50`) تطبع كما كانت: شغّلها إلى ملف (`> scripts/artifacts/logs/<اسم>.log 2>&1`) واقرأ ذيله.

| السكربت | متى |
|---|---|
| `financial-statements.mjs` (`npm run statements`) | القوائم المالية PDF و xlsx، قراءة فقط |
| `acct-month-close.mjs YYYY-MM [--lock]` | فحص الإقفال الشهري والقفل (`docs/MONTH-CLOSE.md`) |
| `payroll-monthly-entry.mjs YYYY-MM` | قيد الرواتب اليدوي (`docs/EXPENSES.md`) |
| `acct-20260921-setup` و`acct-20260923-{sale,purchase,expense}-setup` | إعداد المحاسبة (idempotent)، يسميها الوركر في رسائل الخطأ |
| `s49-20261001-step0.mjs` و`s46-20261001-after-deploy.mjs` | فحوص قبل النشر وبعده (القاعدتان 7 و8) |
| `s57-20261005-fields-fixture.mjs` (وقبله `s56-…` و `s55-…` و`s54-…` و`s53-…` و`s52-…` و`s51-…` و`s49-…`) | توليد بصمة المخطط للاختبارات |
| `s57-20261005-day.mjs` (+ `lib/s57-ui.mjs`) و`s57-20261005-day-diag.mjs` | «📊 اليوم» تملأ العرض (§ 57 أ): صنف النموذج وورقة أنماطه في العرض #2834 وتسمية المتوسط — جاف ← `--apply` ← `--verify`؛ `--rollback` يعيد العرض والتسميتين. و`-diag` قراءة فقط: الـ arch وما يرثه وهل للنموذج chatter |
| `s57-20261005-bank.mjs` | يومية البنك BNK1 (§ 57 ج): مصدر الكشوف «يدوي / استيراد»؛ `--verify` يثبت حسابات الدفعات المعلقة (101003 / 101004) والمعلق (101002) وأن لا قاعدة اعتماد تلقائي؛ `--rollback` يعيد المصدر |
| `s57-20261005-odoo.mjs` (+ `lib/s57-odoo.mjs`) | حقول الشكوى والسجل التجاري وعروضها الثلاثة (§ 57 هـ + ز): جاف ← `--apply` (قبل نشر الكود) ← `--verify`؛ `--rollback` يطفئ العروض والحقول تبقى |
| `s57-20261005-flows.mjs` (+ `lib/s57-flows.mjs` وملف لكل نموذج `lib/s57-{transfer,complaint,expense,supplier}-flow.mjs`) | نماذج § 57 الأربعة عند Meta: `--create` و`--publish` و`--preview`، واسم النموذج لواحد منها (`transfer` / `complaint` / `expense` / `supplier`)؛ المنشور لا يُعدَّل |
| `s57-20261005-trial.mjs transfer\|complaint\|expense\|supplier` | تجربة كل نموذج من § 57 إلى رقم براء من prod المنشور (جاف افتراضياً، `--send` مرة في اليوم لكل واحدة؛ لا تكتب شيئاً) |
| `s56-20261005-odoo.mjs` (+ `lib/s56-ui.mjs`) | حقول «📊 اليوم» وجسم شاشتها: جاف ← `--apply --fields` (الحقول، قبل نشر الكود) ← `--apply` (العرض، بعد نشر الكود وتعبئة الأيام) ← `--verify`؛ `--rollback` يعيد العرض والحقول تبقى |
| `s56-20261005-days.mts` | شاشة يوم لن يحسبه المحرك من جديد (يوم سابق، أو اليوم بعد ساعات المحرك) بدالة الوركر نفسها من أسطره كما هي: حقول الشاشة وحدها. جاف ← `--apply` ← `--verify` (الرسم المخزَّن حرفاً بحرف) |
| `s56-20261005-shots.mts` | بعد أي تعديل في شكل «📊 اليوم» أو رسمها: صور الفاتح والداكن والجوال بـ CSS الخاص بـ Odoo نفسه، وقياس التباين (النص ≥ 4.5، والمرسوم ≥ 3) |
| `s55-20261005-flows.mjs` (+ `lib/s55-flows.mjs`) | نماذج § 55 عند Meta (`utak_owner_review_v2` لمراجعة براء، ونماذج التشغيل): `--create` و`--publish` و`--preview` (رابط المعاينة يفتح في المتصفح بلا دخول)، واسم النموذج لواحد منها؛ المنشور لا يُعدَّل. و`s54-20261005-flows.mjs` لـ v1 الباقي عند Meta |
| `s55-20261005-trial.mjs review\|delivery\|receipt\|carload\|custody` (وقبله `s54-…-trial`) | تجربة مراجعة الأسعار (ونماذج § 55) إلى رقم براء من prod المنشور (جاف افتراضياً، `--send` مرة في اليوم لكل واحدة؛ لا يكتب ولا ينشر) |
| `s54-20261005-preview.mts [اليوم] [--form]` | قراءة فقط: نص رسالة 04:00 (والنموذج) ليوم من الـ tenant كما يبنيه الوركر (بشكل § 55) |
| `s53-20261004-flows.mjs` (+ `lib/s53-flows.mjs`) | نموذجا العميل عند Meta (`utak_order_v1` و`utak_register_v1`): `--create` و`--publish` و`--preview`؛ المنشور لا يُعدَّل |
| `s53-20261004-pay-remind.mjs` (+ `lib/s53-templates.mjs`) | قالب تذكير الدفع بالآيبان: `--status` يقرأ حالته؛ لا إعادة تقديم |
| `s53-20261004-trial.mjs order\|register` | تجربة نموذج الطلب أو التسجيل إلى رقم براء من prod المنشور (جاف افتراضياً، `--send` مرة في اليوم لكل نموذج) |
| `s52-20261004-price-flow.mjs` (+ `lib/s52-price-flow.mjs`) | Flow v2 (صفحات حسب الفئة) وقالبه عند Meta: `--status` يقرأ حالتهما، ولا إعادة تقديم لقالب مرفوض أو MARKETING. و`s51-20261004-price-flow.mjs` لـ v1 الباقي عند Meta |
| `s52-20261004-trial.mjs` (وقبله `s51-…-trial`) | التجربة الوحيدة لنموذج الأسعار إلى رقم براء من prod المنشور (جاف افتراضياً، `--send` مرة في اليوم) |
| `s57-…-{odoo,bank,day}`، `s56-…-{odoo,days}`، `s55-…-odoo`، `s54-…-odoo`، `s53-…-odoo`، `s52-…-odoo`، `s51-…-odoo`، `s49-…-odoo`، `s48-…-{ui,day50,odoo}`، `s47-…-{day50,odoo}`، `s46-…-{wa-menu,product-setup,board}` | تراجع Odoo لـ § 46–§ 57 (`--rollback`) — STATUS § 1 |
| `cutover-prod.mts`، `s42-20260927-prelaunch-mark.mts`، `s45-…-{omar-friday,mark-quotes}` | التحويل sim ← prod وتراجعه، ووسم سجلات المحاكاة |
| `brand-20260924-{render-samples,render-docs,paper-scan,qr-cream-read}` | بعد أي تعديل في PDF: الختم و QR والتذييل ولون الورق |
| `s41-full-day-sim.mts` (+ `sim-report`، `sim-snapshot`، `sim-mark`) | المحاكاة الشاملة ليوم كامل (`--odoo=fake`) |
| `wa-templates-…-{new-eight,migrate-when-approved,purpose-contract}`، `s34-…-opener-templates`، `s37-…-{odoo,supplier-payment-template}` | تعريفات قوالب وعقود تستوردها الاختبارات |
| `apply-english-names.mjs` | بعد مراجعة براء للأسماء الإنجليزية |
- `scripts/lib/` — المكتبة المشتركة (`odoo-cli.mjs` للقراءة والكتابة من السكربت، وقطع عروض Odoo `sNN-ui` / `sNN-odoo-views` التي تختبرها الاختبارات).
- `scripts/mutation/` — الطفرات والماسح. `scripts/archive/` — 252 سكربتاً نُفّذ مرة (ترحيلات، تنظيفات، فحوص، تجارب حية): تاريخ يُقرأ نمطاً، ولا يُشغَّل قبل مراجعته.
- `scripts/artifacts/` — مخرجات ولقطات التراجع: **لا تُحذف ولا تُنقل**، والجديد فيها خارج git. `backups/` — خارج git.
