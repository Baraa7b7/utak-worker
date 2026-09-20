# WhatsApp template — `utak_supplier_confirm_v1` *(pending Meta approval)*

- **Internal purpose:** `supplier_confirm` (`TMPL_SUPPLIER_CONFIRM` in
  [src/config.ts](../src/config.ts))
- **Called from:** `handleSupplierReply` in [src/suppliers.ts](../src/suppliers.ts)
  after a supplier's daily prices are extracted and stored in `x_daily_price`.
  Sends the confirmation as an approved template so the 24-hour Meta rule
  does not trip when the supplier has been silent for more than a day.
- **Language:** Arabic (`ar`)
- **Category:** Utility

## Body

Two `{{n}}` parameters:

1. `{{1}}` — supplier's name (from `res.partner.name`)
2. `{{2}}` — count of items whose prices were extracted this reply

Body text (paste verbatim into Meta Business Manager):

```
شكراً {{1}} 🌿

استلمنا أسعارك لـ {{2}} صنف اليوم. سنعتمدها لطلبات اليوم.

لو تحتاج تعديل، اضغط "تعديل الأسعار" أو رد "تعديل".
```

## Buttons (all `QUICK_REPLY`)

1. `تعديل الأسعار` — supplier realized a price was wrong.
2. `توقف اليوم` — supplier signals the day's list is unavailable
   (bad stock, closed, off).
3. `شكراً` — supplier acks; used later to decide if the confirmation
   round-trip was actually seen.

Payload strings (what the webhook receives when the supplier taps) are
irrelevant for storage — Meta returns the button text back as
`button_reply.title`. Handling is added in `handleButton` in the router
once the template lands.

## Steps to activate

1. **Meta side (WhatsApp Manager → Message templates → Create)**
   - Name: `utak_supplier_confirm_v1`
   - Language: Arabic
   - Category: Utility
   - Header: none
   - Body: paste the body text above (Meta rejects leading/trailing
     whitespace and any `\n` runs of 5+; the block above respects that).
   - Buttons: `Quick reply` with the three texts above, in order.
   - Footer: none
   - Submit. Approval usually lands within a few hours; can be up to
     24h. Meta rejects if the body sample is missing — provide sample
     text like "شكراً أحمد 🌿 استلمنا أسعارك لـ 7 صنف اليوم…".

2. **Odoo side — no manual step required.**
   `scripts/item3b-pre-register-supplier-confirm.mjs` already created a
   placeholder row in `x_whatsapp_template` with:
   - `x_meta_template_id` = `utak_supplier_confirm_v1`
   - `x_language` = `ar`
   - `x_purpose` = `supplier_confirm`
   - `x_meta_status` = `PENDING_META`
   - `x_missing_in_meta` = `true`
   Once Meta approves, the sync (either the 05:00 cron or the manual
   `/admin/wa-template-sync` route) will UPDATE this row in place with
   `x_meta_id`, `x_meta_status="APPROVED"`, `x_body`, `x_param_count=2`,
   `x_buttons` (3 quick_reply entries), `x_last_synced`, and flip
   `x_missing_in_meta=false`.

3. **Worker side — no code change needed.**
   `sendTemplateByPurpose(env, to, "supplier_confirm", [name, count], [], null)`
   already exists and will pick up the mapping on the next isolate cold
   start (or force it by redeploying).

## Fallback (until approval)

`handleSupplierReply` today returns a plain-text reply. That stays the
outbound behaviour while the template is `PENDING_META`. Once approved,
the same code path can start using the template by calling
`sendTemplateByPurpose(..., "supplier_confirm", ...)` — no schema
migration; the worker cache pulls the mapping on next cold start.

## Rollback

- Delete the Meta template from Business Manager (Meta soft-deletes;
  the row on our side will flip to `x_missing_in_meta=true` on next
  sync).
- Or on Odoo: `x_whatsapp_template.unlink([<id from the pre-register
  script>])`.
