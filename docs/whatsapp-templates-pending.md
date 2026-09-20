# WhatsApp templates — pending Meta approval

Any Meta template referenced by `src/templates.ts` that has NOT yet been submitted
and approved lives here until it is. The Worker code falls back to `sendText` when
`sendTemplateByPurpose` returns `null` (no Odoo mapping) or `!resp.ok` (Meta
rejected the send), so listing a template here is safe — the flow degrades to
plain text with the PDF link and keeps working.

---

## `utak_v2_quotation_pdf`  *(pending)*

- **Internal purpose:** `customer_quotation_pdf` (registered as `T.CUSTOMER_QUOTATION_PDF`)
- **Called from:** `createAndDispatchQuotationForRecord` in `src/quotation.ts`
- **Language:** Arabic (`ar`)
- **Category:** Utility
- **Header:** Document (PDF, filename `<quotation_number>.pdf`, link served by
  `/quotation-pdf/{num}/{tok}.pdf`)
- **Body parameters** (order matters — matches the `bodyParams` array in
  `createAndDispatchQuotationForRecord`):
  1. `{{1}}` — customer name (e.g. "مطعم النخيل")
  2. `{{2}}` — quotation number (e.g. "UTAK-Q-20260909-001")
  3. `{{3}}` — quotation date (e.g. "09 Sep 2026")
  4. `{{4}}` — grand total in SAR as a plain number (e.g. "1517")
- **Suggested body text (Arabic):**

  ```
  السلام عليكم {{1}} 🌿

  تفضل عرض السعر رقم {{2}} بتاريخ {{3}}.
  الإجمالي: {{4}} ر.س

  العرض ساري لمدة ٧ أيام. لو تحتاج تعديل رد على هذه الرسالة، ولو تريد التأكيد اضغط الزر بالأسفل.

  شكراً لتعاملكم مع UTAK 🌿
  ```

- **Buttons:** none in v1 (we can add a QUICK_REPLY "تأكيد الطلب" in v2 once the
  approval land, then wire it in `handleButton`).

### Steps to activate

1. **Meta side (WhatsApp Manager → Message templates → Create)**
   - Name: `utak_v2_quotation_pdf`
   - Language: Arabic
   - Category: Utility
   - Header: Document (upload a sample PDF for review; any past invoice PDF works)
   - Body: the text above
   - Submit. Approval usually lands within a few hours; can be up to 24h.
2. **Odoo side (Settings → Technical → Records → `x_whatsapp_template`)**
   Create a row with:
   - `x_purpose` = `customer_quotation_pdf`
   - `x_meta_template_id` = `utak_v2_quotation_pdf` (the exact name Meta approved)
   - `x_language` = `ar`
3. **Worker side:** no code change needed. The template cache in
   `src/templates.ts` picks up the new mapping automatically on the next Worker
   isolate cold start (or force it by redeploying).

### Fallback behavior (current, until approval + Odoo mapping land)

`createAndDispatchQuotationForRecord` sends a plain text message with the PDF
link. The customer still gets the quote; they just don't see a native document
header preview in WhatsApp.
