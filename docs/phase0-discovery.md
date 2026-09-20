# Phase 0 — Discovery Report

Date: 2026-09-17 · Branch: `sim-harness`

## 0.a — Auto-quotation flow

**Trigger:** Odoo Automated Action fires on `x_quotation` create/write → POSTs `{_action, _id, _model}` to `/internal/quotation-issue?token=...` (secret `INTERNAL_WEBHOOK_SECRET`). Worker responds 202 immediately and runs pipeline in `ctx.waitUntil`.

**Pipeline** — `src/quotation.ts:createAndDispatchQuotationForRecord(env, quotationId)`:

1. `buildQuotationPDFDataFromOdoo` — reads `x_quotation` (fields `id`, `x_quotation_number`, `x_order_id`, `x_sent_at`, `create_date`), joins to order via `getOrderForInvoicing`. Per line: use `line.unit_price` if >0 (cached on `x_daily_order_line`), else fall back to `getLatestSalePrice(env, product_id, packaging_id)` which reads `x_daily_price`. Missing price → `has_blocking_issue=true`, alerts owner via `sendOwnerAlert`, returns `{blocked:true}` before any PDF/send. No `x_sent_at` write on blocked path.
2. `renderQuotationHTML` — Cormorant/Inter-styled HTML via `renderPDFShell` (shared with invoice; the "company template" is this shell). Includes VAT row currently (`vatAmount`), though it's always 0 for quotations. **Manual quotation constraint: no VAT line, no VAT number.** Company template needs a switch to hide the VAT row for `x_origin=manual` — I'll add a flag to `renderPDFShell` inputs.
3. `htmlToPDF` → Gotenberg (`env.GOTENBERG_URL`, basic auth).
4. `uploadQuotationToR2` → `INVOICES_BUCKET`, key `quotations/{quotationNumber}.pdf`, signed URL `${WORKER_ORIGIN}/quotation-pdf/{num}/{token}.pdf`.
5. `sendTemplateByPurpose(env, phone, T.CUSTOMER_QUOTATION_PDF, [name, num, date, total], [], {type:"document", link, filename})`. On template failure → `sendText` plain-text fallback with the R2 link.
6. Write-back: `x_quotation.write` sets `x_sent_at = nowOdoo()`.

**Entry point for manual quotations:** the *earliest* point that accepts partner + items + prices is `createQuotationRecord(env, orderId)` at `src/odoo.ts:443` — it takes an `x_daily_order` id and returns `{id, number}`. A "manual" flow needs a partner + line items — it must first create an `x_daily_order`, add lines, then call `createQuotationRecord`. Reusing the pipeline means the Odoo form's "إرسال واتساب" button also uses `/internal/quotation-issue` (identical Automated Action, gated on `x_origin=manual`).

## 0.b — Template sender

`src/templates.ts:sendTemplateByPurpose` looks up `x_whatsapp_template` filtered by `x_purpose` (the field the worker uses to pick a template). It reads only:
- `x_meta_template_id` — the Meta template's name (mapped for send)
- `x_language` — Meta language code

**Never touched by the syncer.** Additions from Phase 1 (`x_meta_id`, `x_language`, `x_meta_status`, `x_category`, `x_body`, `x_param_count`, `x_buttons`, `x_last_synced`, `x_missing_in_meta`) are additive. The syncer *reads* `x_purpose` (unchanged) when writing back — a Meta template with no Odoo record is created with `x_purpose = false` so `fetchMapping` won't pick it up.

## 0.c — Odoo capability probe

Ran `scripts/probe-odoo.mjs`. Each capability creates a disabled test record, records success, deletes it.

| Capability | Result | Detail |
|---|---|---|
| WEBHOOK_OK | ✅ yes | `ir.actions.server` with `state="webhook"` accepted |
| CODE_OK | ✅ yes | `ir.actions.server` with `state="code"` accepted |
| VIEWS_OK | ✅ yes | Inherited view of `base.view_partner_form` created + deleted |
| MODELS_OK | ✅ yes | Custom `x_probe_model_*` + `x_probe_char` field created + deleted |

**Mode chosen: `hook mode`.** All webhook-based triggers work; no need to add a poll cron.

## 0.d/e — Decision

Proceed with all subsequent phases in **hook mode**. No cron schedule additions.
