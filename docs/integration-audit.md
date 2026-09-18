# تكامل UTAK مع تطبيقات Odoo القياسية — فحص قراءة فقط

- التاريخ: 2026-09-18 07:22 Asia/Riyadh
- الفرع: `sim-harness`
- المنهج: **قراءة بحتة**. الاستدعاءات كلها `search_read` / `search_count` / `fields_get` / `read` عبر `.env.sim-verify` باستخدام `scripts/probe-odoo.mjs` كنموذج. لا كتابة ولا تثبيت ولا `unlink`.
- Odoo النسخة: `saas-19.4` (utakfresh.odoo.com، شركة واحدة، عملة `SAR`، بلد `Saudi Arabia`، chart `sa`).
- عدد الوحدات المثبتة: **245** (منها **21 تطبيقاً**). المصدر: `ir.module.module (state=installed)`.

---

## أ) جرد النماذج المخصّصة (x_*)

### أ-1. النماذج التي يُنادى عليها من كود الـWorker

مصدر القائمة: `grep -rEn '"x_[a-z_]+", ?"(read|search|create|write|unlink|search_read|search_count|fields_get)"' src/`.

| # | النموذج | عدد السجلات اليوم | عدد الحقول x_ | يكتبه من؟ | مقابله القياسي | تقييم |
|---|--------|------|------|-----------|----------------|-------|
| 1 | `x_daily_order` | 13 | 16 | Worker (`src/odoo.ts:920,1098,1313,1341,1458,1550`)، مسارات `/webhook`، كرون 21:00/21:15 | `sale.order` | **قابل للاستبدال جزئياً** — الحقل `x_state` selection مختصر ("draft/confirmed/…") مقابل `sale.order.state`. المخطط بسيط. |
| 2 | `x_daily_order_line` | 16 | 12 | Worker (`src/odoo.ts:1057`) + Worker عند تحضير الفاتورة | `sale.order.line` | **قابل للاستبدال** إذا نُقل السعر إلى حقل السطر (انظر البند د-2). |
| 3 | `x_daily_price` | 7 | 12 | Worker `askAllSuppliersForPrices` + `handleSupplierReply` (`src/suppliers.ts:44,160`)، كرون 02:00 | لا نظير مباشر (يشبه `product.supplierinfo.price` لكن مع تاريخ وحقول رد المورد) | **يبقى**. Odoo القياسي ليس فيه "طلب سعر يومي عبر واتساب من مورد وتخزين ردّه". |
| 4 | `x_quotation` | 9 | 9 | Worker `buildQuotationPDFDataFromOdoo` (`src/quotation.ts:191`)، Studio server-action `UTAK: Issue & Send Quotation` (base.automation) | `sale.order` بحالة `draft/sent` | **قابل للاستبدال بالكامل تقنياً** لكن يحتاج تعديل قالب PDF ومسار الإرسال (البند ج-2). |
| 5 | `x_invoice` | 2 | 14 | Worker `createInvoiceRecord` (`src/odoo.ts:2038`) | `account.move` (نوع `out_invoice`) | **قابل للاستبدال** لكن يستوجب: (أ) تفعيل `l10n_sa_edi` لاحقاً، (ب) ربط `partner_id` و`journal_id` و`invoice_line_ids`، (ج) نقل ترقيم `x_invoice_number` إلى `ir.sequence` القياسي. |
| 6 | `x_payment` | 4 | 12 | Worker + Studio server-action `Send Receipt Webhook` عند create | `account.payment` | **قابل للاستبدال** بعد بناء الفاتورة الحقيقية (يستلزم journal بنكي/نقدي). |
| 7 | `x_purchase_list` | 2 | 10 | Worker `src/odoo.ts:1006,1012,1022,1034,1044,1068`، كرون 21:15 | `purchase.order` (واحد لكل مورد) أو تجميعة منتجات يومية | **يحتاج نقاش** — النموذج الحالي "قائمة موحّدة عبر كل الموردين"، بينما `purchase.order` في Odoo يفترض `partner_id` وحيد. **الطريقة الطبيعية:** توليد عدة `purchase.order` (واحد لكل مورد) من نفس الشغل. |
| 8 | `x_delivery_route` | 2 | 12 | Worker (`src/odoo.ts:1358`) | `stock.picking` + `fleet.vehicle` | **يبقى** — Odoo Route لا يعرف "توصيل يومي لعدة عملاء بترتيب توقفات". |
| 9 | `x_delivery_stop` | 2 | 12 | Worker (`src/odoo.ts:1337,1385`) | لا نظير | **يبقى**. |
| 10 | `x_wa_message` | 2 | 18 | Odoo Studio (base.automation `wa_message.on_queued`) → Worker `/odoo/hook/wa` (`src/index.ts:973`) | `whatsapp.message` (من تطبيق WhatsApp القياسي) | **قد يُستبدل جزئياً**؛ لكن UTAK يمر عبر رقم Meta الخاص به مباشرة من الـWorker، لا عبر `whatsapp.account` القياسي. راجع البند هـ. |
| 11 | `x_wa_control` | 1 | 4 | Worker `src/wa-template-sync.ts:235,237` + Studio server-action `wa_control.sync_webhook` | لا نظير | **يبقى**. سجل تحكم سطر واحد. |
| 12 | `x_whatsapp_template` | 22 | 13 | Worker (نسخة محلية لسجل قوالب Meta) | `whatsapp.template` القياسي (10 سجلات موجودة كـ demo) | **قد يُستبدل** لو ربطنا الـWorker بـ`whatsapp.template` بدل `x_whatsapp_template`، لكن قوالبنا في Meta أكثر عدداً (22) وأغنى (buttons, params). النقل يستحق فقط لو دخلنا في التدفق القياسي لـOdoo WhatsApp. |
| 13 | `x_pricing_config` | 1 | 7 | Worker (تكوين نسب هامش) | لا نظير مباشر | **يبقى** — لكن قد يُدمج مستقبلاً في `product.pricelist`. |
| 14 | `x_product_packaging` | 42 | 5 | Worker (كرتون/كيلو/شوال) | `product.packaging` القياسي موجود لكن لم يُعبَّأ | **قابل للاستبدال** بـ`product.packaging` (Odoo فيه `qty` + `barcode` + `product_id`). النقل مباشر تقنياً. |
| 15 | `x_supplier_price_request_log` | 16 | 7 | كرون 02:00 (`askAllSuppliersForPrices`) | لا نظير | **يبقى** (سجل تدقيق). |
| 16 | `x_message_analysis` | 34 | 9 | Worker (`src/complaint.ts` + `src/router.ts`) | لا نظير | **يبقى** — أثر تحليل Claude لكل رسالة. |
| 17 | `x_complaint` | 1 | 12 | Worker | لا نظير مباشر؛ `helpdesk` غير مثبت | **يبقى**. |
| 18 | `x_collection_task` | 1 | 8 | Worker (كرون 18:00) | `account.payment` أو `mail.activity` | **يبقى** حتى الفواتير الحقيقية. |
| 19 | `x_standing_order` | 0 | 8 | لا يستخدم بعد (كرون 17:00) | `sale.order` مع `subscription`؟ | فارغ حالياً — قرار مؤجل. |
| 20 | `x_standing_order_line` | 0 | 6 | كذلك | كذلك | كذلك. |
| 21 | `x_employee_role` | 4 | 4 | Worker (`res.partner.x_role_ids`) | `hr.job` أو `res.groups` | **قابل للاستبدال** بـ`hr.job` + `hr.employee` عند تشغيل الموظفين. |

المجموع: **21 نموذجاً مخصّصاً**. القابلة للاستبدال بمقابل قياسي بلا فقد وظيفي: **9** (`x_daily_order`، `x_daily_order_line`، `x_quotation`، `x_invoice`، `x_payment`، `x_purchase_list`، `x_product_packaging`، `x_employee_role`، جزئياً `x_wa_message`). الباقية إما تبقى لأنه لا مقابل لها (7) أو تبقى حتى تظهر بيانات (5).

### أ-2. أوتوميشن Odoo على النماذج المخصّصة (Studio + base.automation)

- `base.automation` — **3 فقط، كلها من صناعتنا**:
  - `UTAK: Issue & Send Receipt` — على `x_payment.on_create` → server-action `Send Receipt Webhook` → يستدعي الـWorker لبناء PDF الإيصال وإرساله.
  - `wa_control.on_sync_requested` — على `x_wa_control` create/write → يستدعي `/odoo/hook/wa-template-sync`.
  - `wa_message.on_queued` — على `x_wa_message` create/write → يستدعي `/odoo/hook/wa`.
- `ir.actions.server` تلمس x_*: 8 (كلها لنا) — `Send Receipt Webhook`، `UTAK: Issue & Send Quotation`، `quotation.manual_pdf_build`، `quotation.manual_wa_send`، `wa_control.request_sync`، `wa_control.sync_webhook`، `wa_message.action_queue`، `wa_message.send_webhook`.
- **لا يوجد أي ir.cron داخل Odoo يمس x_* مباشرة**. كل الجدولة اليومية (02:00، 21:00، 21:15، 18:00، 17:00، 08:00…) تعيش في `wrangler.toml [triggers]` على Cloudflare (8 crons). Odoo يستضيف 56 كرون قياسي معطّل الأثر علينا.

---

## ب) حالة التطبيقات القياسية

مصدر: `ir.module.module` + `search_count` على النماذج الأساسية.

| التطبيق | مثبت؟ | عدد السجلات الحقيقية | ملاحظة |
|--------|-------|-----------------------|--------|
| Sales (`sale_management`) | ✅ | `sale.order = 0` · `sale.order.line = 0` | لم يُنشأ فيه أي عرض. |
| Purchase (`purchase`) | ✅ | `purchase.order = 0` · لا أسطر | كذلك. |
| Accounting (`accountant` + `account`) | ✅ | `account.move = 0` · `account.move.line = 0` · `account.payment = 0` · `account.tax = 17` · `account.journal = 11` · `account.account = 205` | الشجرة السعودية جاهزة. أدلة الحسابات كاملة. لا فواتير بعد. |
| Inventory (`stock`) | ✅ | `stock.move = 0` · `stock.quant = 0` · `stock.picking = 0` · `stock.warehouse = 1` · `stock.location = 6` | مستودع واحد، لا مخزون. |
| Contacts (`contacts`) | ✅ | `res.partner = 14` (active): 4 عميل، 6 مورد | جميعهم مسموح واتساب (14/14 بعد commit 9d119dd). |
| CRM (`crm`) | ✅ | `crm.lead = 1` · `crm.team = 1` · `crm.stage = 4` | Lead واحد فقط. |
| Employees (`hr`) | ✅ | `hr.employee = 0` · `hr.department = 1` | فارغ. المعلومات الحقيقية على `res.partner.x_role_ids`. |
| Project (`project`) | ✅ | `project.project = 0` · `project.task = 1` | فارغ. |
| Planning (`planning`) | ✅ | `planning.slot = 0` | فارغ. |
| Documents (`documents`) | ✅ | `documents.document = 22` | فيها ملفات. |
| Sign (`sign`) | ✅ | `sign.request = 0` | فارغ. |
| Survey (`survey`) | ✅ | 0 | فارغ. |
| Knowledge (`knowledge`) | ✅ | `knowledge.article = 64` | ممتلئ (توثيق). |
| Calendar/Appointments/Discuss | ✅ | فارغ عملياً | `mail.message = 1711` (chatter). |
| Studio (`web_studio`) | ✅ | — | مصدر الحقول المخصّصة. |
| WhatsApp (`whatsapp` + 11 وحدة تكامل) | ✅ | تفصيل في هـ | حساب Meta = **Demo فقط**. |
| **UTAK** كتطبيق مستقل | ❌ لا يوجد | — | لا يظهر في `ir.module.module`. كل ما لدينا حقول Studio على نماذج قياسية + نماذج `x_*` جديدة. |

- **إعدادات الشركة**: `utakfresh`، عملة `SAR`، بلد Saudi Arabia، chart `sa`، هاتف `0580040467`.
- **الضريبة**: مفعلة — 17 ضريبة في `account.tax` (شجرة SA الجاهزة تحوي VAT 15% مسبقاً).
- **ZATCA / الفوترة الإلكترونية**:
  - ✅ `l10n_sa` (Saudi Arabia - Accounting) — مثبت.
  - ✅ `l10n_sa_reports` — مثبت.
  - ❌ `l10n_sa_edi` (E-invoicing) — **غير مثبت**. هذه هي وحدة توليد XML/QR ZATCA. لتفعيل e-invoicing لاحقاً لازم تثبيتها + شهادة ZATCA.
- **البنوك**: journal `Bank BNK1` موجود، ما فيه cuenta bancario مضاف بعد.
- **Sequence القياسي**: `sale.order` (prefix `S`، next=1). **لا يوجد `ir.sequence` لـ`x_quotation` أو `x_invoice`** — الترقيم يُبنى في الـWorker.

---

## ج) قوالب UTAK المعتمدة (PDF + WhatsApp)

### ج-1. PDF كيف يُبنى الآن

المسار الفعلي (كل PDF من UTAK يمر منه):

1. `src/pdf-template.ts` — الـDNA (ألوان، خط `IBM Plex Sans Arabic`، شعار SVG، `renderPDFShell`).
2. مُنشئ الملف الخاص (`src/quotation.ts` / `invoice.ts` / `receipt.ts` / `delivery-note.ts` / `purchase-order.ts`) يبني بيانات النموذج.
3. `renderPDFShell(...)` يُنتج HTML.
4. `htmlToPDF(env, html)` يرسل HTML إلى **Gotenberg** (`env.GOTENBERG_URL`) ويعيد Uint8Array.
5. `uploadPDFToR2(env, buffer, path)` يخزّن في bucket `INVOICES_BUCKET` (اسمه `utak-invoices` في الإنتاج، `utak-invoices-sim` في sim).
6. الرابط الموقّع بـ`signDocToken` يُرسل عبر واتساب مع قالب "quotation_ready" أو "invoice_ready".

**حقول الإدخال لقالب العرض** (من `QuotationPDFData` في [quotation.ts:35](src/quotation.ts:35)):

```
quotationNumber, quotationDate, customer{name, contactPerson?, address, phone},
items[]{name, pack, qty, price, total}, subtotal, discount, vatAmount, grandTotal,
price_warnings[], has_blocking_issue, is_manual?, customer_id?, order_id?, missing_products?
```

مصدر البيانات الحالي (من [odoo.ts:1889](src/odoo.ts:1889)):

- `x_quotation.read(['id','x_quotation_number','x_order_id','x_sent_at','create_date','x_origin'])`
- `x_daily_order.read(['id','x_customer_id','x_delivery_neighborhood','x_line_ids'])`
- `res.partner.read(['id','name','phone','x_whatsapp_number'])`
- `x_daily_order_line.read(['id','x_product_tmpl_id','x_packaging_id','x_quantity','x_unit_price','x_price_unit_manual','x_status'])`
- fallback: `x_daily_price.search_read(...)` لتحصيل السعر لو السطر بلا سعر.

### ج-2. هل يمكن تغذية نفس القالب من `sale.order`/`account.move` بدل `x_quotation`؟

**نعم، ممكن تقنياً بلا تعديل واحد على `pdf-template.ts` نفسه.** التوصيف:

| الحقل في `QuotationPDFData` | من `x_quotation` اليوم | من `sale.order` بديلاً |
|-----------------------------|------------------------|-------------------------|
| `quotationNumber` | `x_quotation.x_quotation_number` (يبنيه الـWorker) | `sale.order.name` (يبنيه `ir.sequence 'sale.order'`، prefix "S") — سيتغيّر الشكل من `Q-2026-…` إلى `S00001`. **قرار براء**: هل يقبل الترقيم الجديد أم نبني sequence جديد بـprefix `Q`؟ |
| `quotationDate` | `x_sent_at || create_date` | `sale.order.date_order` أو `create_date` |
| `customer.name / address / phone` | `res.partner` عبر `x_customer_id` | `sale.order.partner_id` مباشرة — نفس الشيء بحرفه |
| `items[].name` | `x_product_tmpl_id[1]` (مع `stripRef`) | `sale.order.line.product_id.display_name` |
| `items[].pack` | `x_packaging_id[1]` (نموذج `x_product_packaging`) | يحتاج تحويل: إما نقل بيانات `x_product_packaging` إلى `product.packaging` القياسي، أو إبقاء `x_packaging_id` كحقل مخصّص على `sale.order.line` |
| `items[].qty` | `x_quantity` | `sale.order.line.product_uom_qty` |
| `items[].price` | منطق ثلاثي (manual → cached → fallback من `x_daily_price`) | يمكن تعميم نفس المنطق: `sale.order.line.price_unit` كقيمة أولى، ثم fallback إلى `x_daily_price` كما هو |
| `items[].total` | `unit * qty` | `sale.order.line.price_subtotal` (Odoo يحسبه تلقائياً) |
| `subtotal`، `vatAmount`، `grandTotal` | صفر ضريبة اليوم | `sale.order.amount_untaxed`، `amount_tax`، `amount_total` (سيصبح 0/0/subtotal ما دام `fiscal_position` فارغ أو `no_tax`) |

**الخلاصة**: `pdf-template.ts` غير حساس لمصدر البيانات؛ الاستبدال يعني كتابة `buildQuotationPDFDataFromSaleOrder(env, saleOrderId)` مقابل `buildQuotationPDFDataFromOdoo(env, quotationId)`. **يحتاج تعديل نقطتين حقيقيتين فقط**:

1. `x_packaging_id` (نموذجنا) مقابل `product.packaging` القياسي — قرار: هل ننقل الـ42 سجل؟
2. الترقيم — قرار براء.

### ج-3. قوالب واتساب

- كل الإرسال يمر من الـWorker مباشرة إلى Meta Graph API (`src/meta.ts::sendText` و`sendTemplate`) وليس من Odoo.
- `whatsapp.template` القياسي فيه 10 قوالب Demo (Sale Order, Invoice, Payment Receipt، …) بحالة `approved/draft`، **غير مربوطة بأي تدفق UTAK**.
- قوالبنا الحقيقية (22 سجل) في `x_whatsapp_template` وتُزامَن يدوياً مع Meta عبر `src/wa-template-sync.ts`.
- **لو صار مصدر البيانات `sale.order`، قوالب الواتساب لا تتأثر أبداً** — الـWorker يبني نص القالب من `QuotationPDFData`، والمصدر خلف ذلك شفاف.

---

## د) التسعير — من أين يأتي السعر بالضبط

### د-1. الترتيب الحالي (`quotation.ts:236-256`)

```
1) x_daily_order_line.x_price_unit_manual  (لو > 0)      → source="today"
2) x_daily_order_line.x_unit_price          (لو > 0)      → source="today"
3) getLatestSalePrice(product, packaging) → x_daily_price:
    3.1  domain [x_date=today] limit=1           → source="today"
    3.2  فallback: أحدث x_date                    → source="stale"
    3.3  ولا شيء                                 → source="missing"
```

الحقلان المستخدمان في `x_daily_price`: `x_sale_price` (أولوية) ثم `x_price_sar` (احتياط).
لا `product.pricelist` مفعّل — `product.pricelist = 0` في التينانت.
`x_pricing_config` (سجل واحد، 7 حقول) يحوي نسبة هامش تشغيلي (يُستخدم عند حساب سعر البيع من سعر شراء المورد في `handleSupplierReply`).

### د-2. أقل تدخل لتشغيل نفس المنطق على `sale.order.line`

**الأخف — بلا لمس Odoo القياسي**: نقل `x_price_unit_manual` كـحقل Studio على `sale.order.line`، ونقل `x_daily_price` كما هو (لا يحتاج تغيير — نموذج مستقل). ثم في `buildQuotationPDFDataFromSaleOrder` نفس المنطق ثلاثي المستويات.

**الأنظف — بلا حقول مخصّصة على السطر**: بناء `product.pricelist` واحد بـ`item_type='formula'` يقرأ من `x_daily_price` عبر compute field. **هذا يحتاج وحدة Python (`ir.actions.server` code لا يكفي)**، ومنصة `utakfresh.odoo.com` هي **Odoo Online (SaaS)** لا تسمح بـcustom Python. لذلك: **لا يمكن**، والأخف هو الخيار الوحيد الآن.

معنى ذلك: **لو انتقلنا لـ`sale.order` سنبقي `x_daily_price` كما هو ونضيف حقلاً `x_price_unit_manual` على `sale.order.line` بدل الحقل الحالي على `x_daily_order_line`**. الفارق العملي = صفر على المستخدم النهائي وعلى قالب PDF.

---

## هـ) نقاط التعارض والخطر

### هـ-1. `sale.order` بجانب `x_quotation` — ما الذي قد ينكسر

- **الترقيم**: `sale.order` sequence حالياً prefix `S` وnext=1 — لن يتصادم لأنه فارغ. لكن لو خلطنا (بعض العروض على `sale.order` وبعضها على `x_quotation`) سيصبح لدينا مصدران مختلفان لـ"رقم عرض"، وهذا خطر تشغيلي.
- **الكرونات**: لا كرون Odoo على `x_quotation`. كل الكرونات في Cloudflare Worker. **لا تعارض**.
- **الـwebhooks**: `UTAK: Issue & Send Quotation` (Studio server action) مربوط بـ`x_quotation` فقط. لو أنشأنا `sale.order`، لن يُنطلق تلقائياً. **مطلوب إما نسخ الأتمتة، أو نقل الـtrigger إلى `sale.order.state='sent'`.**
- **التقارير**: لا تقارير مبنية على `x_quotation` (بلا `ir.actions.report` مسجّل).

### هـ-2. هل يوجد كرون/أتمتة يفترض `x_quotation` حصراً؟

- `ir.cron`: لا. لا كرون Odoo يمس نماذج `x_*`.
- `base.automation`: 3 موجودة، فقط `wa_message.on_queued` و`wa_control.on_sync_requested` عامّان (لا يعتمدان على `x_quotation`). `UTAK: Issue & Send Receipt` على `x_payment`.
- الاعتماد الحقيقي على `x_quotation` هو في **الـWorker** فقط (`quotation.ts` + `router.ts` + `index.ts /odoo/hook/wa` route). أي انتقال يبقى قابلاً للتراجع بمفتاح واحد.

### هـ-3. WhatsApp — نقطة التعارض الأخطر

- تطبيق `whatsapp` مثبت + 11 وحدة تكامل (`whatsapp_sale`, `whatsapp_account`, `whatsapp_crm`, `whatsapp_stock`, `whatsapp_sign`, `whatsapp_calendar`, `whatsapp_account_followup`, `whatsapp_identifiers`, `whatsapp_payment`, `saas_whatsapp`).
- `whatsapp.account`: **سجل واحد فقط** بـ`phone_uid = "odoo_demo_account"` و`account_uid = "odoo_demo_account"`. **هذا حساب Demo لا يُرسل أي رسالة حقيقية.**
- `whatsapp.message`: 0 سجل. `whatsapp.composer`: 0 سجل.
- كرون واحد في Odoo يخص واتساب: `WhatsApp: Send In Queue Messages` (كل ساعة). لأن الحساب demo، هذا الكرون **لا يفعل شيئاً حقيقياً** (لا queue، لا account حقيقي).
- **الخلاصة**: **لا يوجد تعارض حالياً** — رقم Meta الوحيد (`META_PHONE_NUMBER_ID=1351691708016803`، `META_WABA_ID=2144001136512196`) مربوط بالـWorker، وليس معرَّفاً في `whatsapp.account`. الـWorker يسمّي حساباً غير موجود في Odoo القياسي.
- **الخطر المستقبلي**: لو ربط أحدنا رقم Meta نفسه بـ`whatsapp.account` عبر واجهة Odoo (Odoo → Settings → Technical → WhatsApp Business Accounts) — سيصبح لدينا **مُرسِلَان لنفس الرقم**: (أ) الـWorker على استقبال webhook وإرسال، (ب) Odoo cron كل ساعة لكل رسالة `whatsapp.message` `outbound queued`. هذا **سيسبب رسائل مكررة و/أو تناقض في `messaging_product` token**. القرار المطلوب: إذا قررنا استعمال Odoo WhatsApp لأي شيء، **يجب** تعطيل الكرون `WhatsApp: Send In Queue Messages` **قبل** ربط الرقم.

---

## و) خطة ربط مقترحة (بلا تنفيذ)

مرتبة بالعائد ÷ المخاطرة (١ = أعلى عائد وأقل مخاطرة).

### و-1. عرض سعر يدوي على `sale.order` بقالب UTAK — عائد كبير، مخاطرة منخفضة
- **يُضاف**: `buildQuotationPDFDataFromSaleOrder(env, saleOrderId)` في `src/quotation.ts` مقابل الدالة القائمة. زر Studio على `sale.order.form` "أرسل بقالب UTAK" يستدعي webhook للـWorker.
- **يبقى**: `pdf-template.ts` بلا تغيير، القوالب في R2 كما هي، تدفق `x_quotation` الآلي (كرون + طلب مورد + auto-quote).
- **يتوقف**: لا شيء.
- **حجم**: ~4 ساعات.
- **تراجع**: حذف الدالة الجديدة والزر — يعود الوضع كما كان.
- **يعتمد على براء**: هل نقبل ترقيم `sale.order` (`S00001`) أم نبني `ir.sequence` جديد بـprefix `Q`؟

### و-2. الفاتورة (`account.move`) من العرض المؤكد — عائد كبير، مخاطرة متوسطة
- **يُضاف**: عند `x_daily_order.x_state = 'delivered'` (كما اليوم)، بدل إنشاء `x_invoice` نُنشئ `account.move` من نوع `out_invoice` (partner_id, journal_id=8 "Sales INV", line_ids من نفس السطور). ثم `action_post` عبر webhook Studio.
- **يبقى**: قالب PDF الفاتورة، تدفق الإيصال (`x_payment`) مبدئياً.
- **يتوقف**: `createInvoiceRecord` على `x_invoice`. `x_invoice_number` يُستبدل بـ`account.move.name`.
- **حجم**: ~8 ساعات + جلسة مع محاسب لتأكيد accounts mapping.
- **تراجع**: بمفتاح `USE_STANDARD_INVOICE` في env، وإرجاع الفروع القديمة.
- **يعتمد على براء**: (أ) هل الضريبة على أم صفر؟ 17 tax موجودة، الافتراضي في المنتج فارغ. (ب) journal بنكي/نقدي — أي حساب سيُحدد للمقبوضات؟ (ج) هل نُفعّل `l10n_sa_edi` (ZATCA E-invoicing) الآن أم لاحقاً؟

### و-3. الشراء من أحمد (`purchase.order`) — عائد متوسط، مخاطرة متوسطة
- **يُضاف**: عند aggregation اليومي (كرون 21:15) بدل `x_purchase_list` واحد، نبني `purchase.order` واحد لكل مورد له كميات. `partner_id` = المورد، `order_line` = المنتجات + الكميات المطلوبة.
- **يبقى**: قالب PDF أمر الشراء يُغذّى من `purchase.order` بدل `x_purchase_list` — نفس تحول ج-2.
- **يتوقف**: `x_purchase_list` (يظل للسجل التاريخي).
- **حجم**: ~10 ساعات (aggregation logic أعقد لأن التوزيع على موردين متعددين حسب `x_supplied_product_ids`).
- **تراجع**: مفتاح واحد.

### و-4. المخزون والتالف (`stock.move` / `stock.picking`) — عائد متوسط، مخاطرة عالية
- **يُضاف**: `stock.picking` من نوع `outgoing` عند كل توصيل (عبر `x_delivery_stop`). حركات المخزون تحدّث `stock.quant`.
- **يبقى**: `x_delivery_route` و`x_delivery_stop` كطبقة تخطيط، `stock.picking` كطبقة تنفيذ.
- **يتوقف**: لا شيء يتوقف — إضافة موازية.
- **حجم**: ~15 ساعة. يحتاج تعريف `product.location` و`stock.warehouse` كاملاً + `internal_transfer` لتلف يومي.
- **تراجع**: صعب — بمجرد تسجيل حركات مخزون في `stock.quant` لا يمكن حذفها بأمان.
- **يعتمد على براء**: هل نريد تتبع مخزون حقيقي (يعني لا بيع بلا كمية متوفرة)؟ أم نبقى في "backorder ok"؟

### و-5. CRM (`crm.lead` / `crm.stage`) للجولات الميدانية — عائد صغير، مخاطرة صفر
- **يُضاف**: كل زيارة ميدانية يسجّلها براء أثناء الجولة تتحول إلى `crm.lead` مع `x_visit_notes`. `crm.stage` الأربع القائمة (`New/Qualified/Proposition/Won`) تُعاد تسميتها لمراحل الاختراق (`جديد/مهتم/عرض مُرسل/عميل`).
- **يبقى**: كل شيء.
- **يتوقف**: لا شيء.
- **حجم**: ~3 ساعات (تكوين مراحل CRM + endpoint في الـWorker يستقبل نوتة الزيارة من واتساب).
- **تراجع**: كامل — كل `crm.lead` يمكن أرشفته.

### و-6. الموظفون (`hr.employee`) بدل `x_role` على `res.partner` — عائد صغير، مخاطرة منخفضة
- **يُضاف**: تحويل الـ4 سجلات في `x_employee_role` + الحقول `x_iqama_number`, `x_iqama_expiry`, `x_iban`, `x_hire_date`, `x_monthly_salary` على `res.partner` إلى `hr.employee` (`work_email`, `identification_id`, `bank_account_id`, `date_hired`, `wage`).
- **يبقى**: `x_role_ids` كـmany2many على `res.partner` (للأدوار العملاء/موردين، ليس موظفين).
- **يتوقف**: `x_role` (selection القديم) — تصبح المرجعية `hr.employee.job_id`.
- **حجم**: ~4 ساعات + هجرة يدوية للـ4 سجلات.
- **تراجع**: كامل.
- **يعتمد على براء**: هل نريد `hr_payroll_gosi` لاحقاً (متوفر كوحدة `l10n_sa_hr_payroll_gosi` غير مثبتة)؟

**مجموع البنود**: **6**.

---

## ز) الأسئلة المفتوحة (يُحسم قبل التنفيذ)

1. **الضريبة**: هل نُفعّل VAT 15% على الفواتير الجديدة من `account.move` أم نُبقيها صفراً كما اليوم؟ لو مفعّلة، هل التسعير الحالي في `x_daily_price` **شامل** الضريبة أم **حصري** منها؟ (اليوم `vatAmount = 0` في كل PDF.)
2. **ZATCA**: هل نُثبت `l10n_sa_edi` الآن (يتطلب شهادة ZATCA فيرست فيز + محاسب) أم نؤجّل حتى الوصول لسقف الإلزام؟
3. **البنك**: `account.journal` "Bank BNK1" موجود لكن بلا `bank_account_id`. أي حساب بنكي حقيقي لـUTAK سيربط؟
4. **الترقيم**: هل نبني `ir.sequence` بـprefix `Q-YYYY-` للعرض و`INV-YYYY-` للفاتورة، أم نقبل `S00001` و`INV/2026/...` الافتراضي؟
5. **`whatsapp.account` Demo**: هل نحذف السجل Demo الوحيد لتفادي أي اختلاط مستقبلي؟ (لا يفعل شيئاً الآن لكن يُشوّش عند الفحص.)
6. **`whatsapp.template` القياسي**: هل نلغي تثبيت `whatsapp_sale/account/crm/stock/…` لأنها تُنشئ 10 قوالب demo وقوائم رسائل غير مستخدمة؟ أو نتركها؟
7. **المخزون**: هل UTAK يعتبر نفسه بائع مخزون (يستوجب تتبّع `stock.quant`) أم وسيط توزيع (يستلم من المورد ويوزّع بلا مخزون حقيقي)؟ الجواب يُحدّد إن كان البند و-4 يستحق.
8. **الموظفون**: هل الأربعة في `x_employee_role` (تم استخراج عددهم فقط) هم فعلاً موظفون بأسماء وإقامات، أم أدوار افتراضية؟ يحتاج فحص محتوى، لم أطلع لأن الأمر READ-ONLY وقد لا يكون آمناً بلا موافقة.
9. **الـpricelist**: 0 pricelists مفعّلة اليوم. هل نبقى بلا `product.pricelist` (كل سطر بسعره الخاص) أم نبني واحداً واحداً للاستفادة من "من – إلى" الكميات؟
10. **`x_standing_order` / `x_standing_order_line`**: صفر سجلات. هل هذا feature مؤجل يبقى، أم نحذف الحقول (نموذج فارغ + كرون معطّل)؟
11. **`x_whatsapp_template` مقابل `whatsapp.template`**: لدينا 22 في المخصّص و10 demo في القياسي. هل نقبل موازاة دائمة، أم ننقل كل شيء إلى القياسي (ونفقد ميزات buttons/params الغنية)؟

---

## المصادر (الملفات الحقيقية)

- الكود: [src/odoo.ts](src/odoo.ts) · [src/quotation.ts](src/quotation.ts) · [src/invoice.ts](src/invoice.ts) · [src/purchase-order.ts](src/purchase-order.ts) · [src/suppliers.ts](src/suppliers.ts) · [src/pdf-template.ts](src/pdf-template.ts) · [src/wa-message-send.ts](src/wa-message-send.ts) · [src/wa-template-sync.ts](src/wa-template-sync.ts)
- Odoo hooks: [src/index.ts:973](src/index.ts:973) `/odoo/hook/wa` · [src/index.ts:1014](src/index.ts:1014) `/odoo/hook/wa-template-sync`
- Cron config: [wrangler.toml:53-63](wrangler.toml:53) `[triggers]`
- سكربت الفحص: `scripts/probe-odoo.mjs` (نموذج) + `scratchpad/probe.mjs` (نسخة الفحص هذه، READ-ONLY، لم تُلمس بيانات).

---

نماذج مخصّصة: 21 · قابلة للاستبدال: 9 · تعارض WhatsApp: لا · قالب UTAK من sale.order: ممكن · بنود الخطة: 6
