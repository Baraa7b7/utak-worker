# WhatsApp template params — audit as of 2026-09-12

This file lists every WhatsApp template call in the Worker, in the exact
order the code passes body params. Compare each entry against the Meta
Business Manager definition — `x_whatsapp_template` in Odoo does **not**
store variable definitions, only the mapping from purpose → Meta name.

**Convention:** rows below are numbered by param position (1-based, matching
Meta's `{{1}}`, `{{2}}`, …). Header params appear separately when a template
has one. Quick-reply button payloads are noted last.

Total call sites audited: **19** (+ 2 legacy fallbacks retained).

---

## 1. `supplier_ask`  →  Meta name TBD (check `x_whatsapp_template.x_meta_template_id`)

- **Call site:** [`src/suppliers.ts`](../src/suppliers.ts) line 87 (`sendTemplate`)
- **Body params:**
  1. `productList` — Arabic comma-separated list of products this specific
     supplier supplies (e.g. "طماطم، خيار، بطاطس"). Built from
     `x_supplied_product_ids` on `res.partner` via `fetchSupplierCatalog`.
- **Fix history:** originally passed `s.name` (supplier name). Fixed in
  `175ffae`, briefly reverted by `ed67124` (no explanation, 3-minute window),
  reapplied as `56d5fe4`. Current code is correct.

## 2. `supplier_confirm`  →  Meta name TBD

- **Call site:** [`src/suppliers.ts`](../src/suppliers.ts) line 219 (`sendTemplate`)
- **Body params:**
  1. count of products extracted (integer as string, e.g. "7")

## 3. `PURCHASE_LIST` (purpose = `purchase_list`)

- **Call site:** [`src/team.ts`](../src/team.ts) line 92 (`sendTemplateByPurpose`)
- **Body params:**
  1. warehouse member name (e.g. "أحمد")
  2. today's date (`YYYY-MM-DD`)
  3. rendered list body (multi-line but no newlines — Meta template rules; check!)
  4. items count (integer as string)
- **Quick-reply buttons:** index 0 → `purchase_done_{listId}`, index 1 → `purchase_issue_{listId}`

## 4. `DRIVER_DISPATCH` (purpose = `driver_dispatch`)

- **Call site:** [`src/team.ts`](../src/team.ts) line 177 (`sendTemplateByPurpose`)
- **Body params:**
  1. driver name
  2. today's date (`YYYY-MM-DD`)
  3. rendered stops summary
  4. stops count (integer as string)

## 5. `DRIVER_STOP` (purpose = `driver_stop`)

- **Call site:** [`src/team.ts`](../src/team.ts) line 224 (`sendTemplateByPurpose`)
- **Body params:**
  1. order id (integer as string)
  2. customer name
  3. neighborhood or `-`
  4. map url OR customer phone OR `-` (whichever is available)
  5. line-item summary
- **Quick-reply buttons:** index 0 → `delivered_{orderId}`, index 1 → `delivery_issue_{orderId}`

## 6. `CUSTOMER_DELIVERY_DONE` (purpose = `customer_delivery_done`)

- **Call site:** [`src/team.ts`](../src/team.ts) line 258 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name

## 7. `CUSTOMER_INVOICE_PDF` (purpose = `customer_invoice_pdf`)  →  `utak_invoice_pdf_v1`

- **Call site:** [`src/invoice.ts`](../src/invoice.ts) line 124 (`sendTemplateByPurpose`)
- **Header:** document (PDF, filename `<invoiceNumber>.pdf`, link from R2 signed URL)
- **Body params:**
  1. customer name
  2. invoice number (e.g. `UTAK-INV-20260912-001`)
  3. invoice date (e.g. `12 Sep 2026`)
  4. total in SAR as plain number (e.g. `1250`)

## 8. `CUSTOMER_INVOICE` (purpose = `customer_invoice`)  →  `utak_invoice_customer_v2` — **text fallback**

- **Call site:** [`src/invoice.ts`](../src/invoice.ts) line 135 (`sendTemplateByPurpose`)
- **Called only when the PDF template send in #7 fails.**
- **Body params:**
  1. customer name
  2. invoice number
  3. `linesFormatted` (rendered items block, no newlines)
  4. total as plain number
- **Note:** #7 and #8 are **separate Meta templates with different schemas**,
  confirmed by Baraa. #7's third param is a date; #8's third param is the
  line block. Do NOT unify them.

## 9. `COLLECTION_REQUEST` (purpose = `collection_request`)

- **Call site:** [`src/invoice.ts`](../src/invoice.ts) line 162 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name
  2. neighborhood or `-`
  3. invoice number
  4. total as plain number
- **Quick-reply buttons:** index 0 → `collect_cash_{invoiceId}`, index 1 → `collect_transfer_{invoiceId}`

## 10. `COLLECTION_SUMMARY` (purpose = `collection_summary`)

- **Call site:** [`src/invoice.ts`](../src/invoice.ts) line 285 (`sendTemplateByPurpose`)
- **Body params:**
  1. today's date (`YYYY-MM-DD`)
  2. rendered lines (multi-invoice list)
  3. grand total as plain number
  4. unpaid invoices count (integer as string)

## 11. `CUSTOMER_QUOTATION_PDF` (purpose = `customer_quotation_pdf`)  →  `utak_v2_quotation_pdf`

- **Call site:** [`src/quotation.ts`](../src/quotation.ts) line 333 (`sendTemplateByPurpose`)
- **Header:** document (PDF, filename `<quotationNumber>.pdf`, link from R2 signed URL)
- **Body params:**
  1. customer name
  2. quotation number (e.g. `UTAK-Q-20260912-001`)
  3. quotation date (e.g. `12 Sep 2026`)
  4. grand total as plain number
- **BLOCKER (2026-09-12):** no row in `x_whatsapp_template` has
  `x_purpose = "customer_quotation_pdf"`. `fetchMapping` returns null →
  `sendTemplateByPurpose` returns null → quotation.ts:350 fallback fires,
  customer receives a **plain text** message with the PDF link instead of
  a document-header template preview. No error, no crash — the customer
  just doesn't see the WhatsApp document card. Meta name `utak_v2_quotation_pdf`
  is still pending Meta approval per `docs/whatsapp-templates-pending.md`.

## 12. `CUSTOMER_WELCOME` (purpose = `customer_welcome`)

- **Call site:** [`src/index.ts`](../src/index.ts) line 878 (`sendTemplateByPurpose`)
- **Body params:**
  1. profile name from WhatsApp (or fallback `"صديقنا"`)

## 13. `CUSTOMER_DAILY_REMIND` (purpose = `customer_daily_remind`)  →  `utak_v2_daily_remind`

- **Call site:** [`src/standing.ts`](../src/standing.ts) line 26 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name
- **Quick-reply buttons:** index 0 → `standing_confirm_{standingId}`, index 1 → `standing_edit_{standingId}`

## 14. `CUSTOMER_FEEDBACK` (purpose = `customer_feedback`)

- **Call site:** [`src/outreach.ts`](../src/outreach.ts) line 48 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name

## 15. `CUSTOMER_PAY_REMIND` (purpose = `customer_pay_remind`)

- **Call site:** [`src/outreach.ts`](../src/outreach.ts) line 81 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name
  2. amount owed with 2 decimals (e.g. `1250.00`)

## 16. `CUSTOMER_INACTIVE` (purpose = `customer_inactive`)

- **Call site:** [`src/outreach.ts`](../src/outreach.ts) line 113 (`sendTemplateByPurpose`)
- **Body params:**
  1. customer name

---

## What this document is NOT

- Not a source of truth for Meta template body text — only Meta Manager is.
- Not a schema check — Odoo's `x_whatsapp_template` stores mapping only, not variable definitions.
- Not a runtime validator — if the count/order in Meta drifts from the
  count/order here, Meta rejects the send with `#132000` or similar; the
  Worker falls back to `sendText` where a fallback exists (see
  `docs/whatsapp-templates-pending.md`).

## How to compare against Meta

For each purpose above:
1. Look up `x_whatsapp_template.x_meta_template_id` for that `x_purpose` in
   Odoo (or check the Meta Manager directly).
2. Open the template in Meta Business Manager → count `{{N}}` placeholders
   in the body, and note whether it has a document/image header.
3. Compare against the "Body params" list above. Order must match, count
   must match, and a documented header (see #7, #11) means the code sends
   `headerMedia` explicitly.
4. If any drift is found, fix the CODE — never edit the Meta template to
   match the code, since the template is approved by Meta and requires
   re-approval on any change.
