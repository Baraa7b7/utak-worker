# Odoo Automated Actions — UTAK Worker integrations

Server-side actions that call the Cloudflare Worker from inside Odoo.

**Auth model:** Odoo 19 SaaS ships a built-in *Send Webhook Notification* action
that cannot add custom headers and cannot HMAC-sign the payload. So every
Worker endpoint under `/internal/*` authenticates with a shared token passed in
the URL query string:

```
POST https://utak-worker.utak-business.workers.dev/internal/<endpoint>?token=<INTERNAL_WEBHOOK_SECRET>
```

The Worker compares `?token=` to `INTERNAL_WEBHOOK_SECRET` with a time-safe
check and rejects any request that doesn't match with `401 unauthorized`.

Secret rotation: `wrangler secret put INTERNAL_WEBHOOK_SECRET` on the Worker
side, then update the same value inside every Odoo *Automated Rule* that uses
it (Studio saves the URL literally, so the token lives in the rule's URL).

> The token sits in the URL, so it will show up in Cloudflare access logs and
> in Odoo's outbound request logs. That's an accepted trade-off for SaaS Odoo,
> where signing isn't available. Rotate the secret if either log source is ever
> exposed.

---

## Quotation — "Issue & Send"

**Model:** `x_quotation`
**Trigger:** Automated Rule on `x_quotation` — typical trigger is
`x_customer_response == "confirmed"` (fires the moment sales flips the field),
but any on-create / on-update trigger works.
**Action Type:** *Send Webhook Notification* (Odoo 19 SaaS built-in).

Odoo's *Send Webhook Notification* sends this payload verbatim, no
customisation available:

```json
{
  "_action": "UTAK: Issue & Send Quotation(<action id>)",
  "_id": <record id>,
  "_model": "x_quotation"
}
```

The Worker reads `_id` (and `_model` for a sanity check) and treats the request
exactly the same as if a curl caller had sent `{ "quotation_id": <id> }`.

### Setup checklist inside Odoo Studio

1. **Settings → Technical → Automation → Automated Rules → New**
   - *Model:* `x_quotation`
   - *Trigger:* the event you want (e.g. *On Update* + domain
     `[["x_customer_response","=","confirmed"]]`).
2. Under *Actions To Do* → *Add Action* → **Send Webhook Notification**.
3. *URL:*
   ```
   https://utak-worker.utak-business.workers.dev/internal/quotation-issue?token=<the same value you set with `wrangler secret put INTERNAL_WEBHOOK_SECRET`>
   ```
4. Save. That's it — no Python, no header configuration.

### Successful response shape

```json
{
  "success": true,
  "quotation_id": 42,
  "quotation_number": "Q-2026-042",
  "pdf_url": "https://utak-worker.utak-business.workers.dev/quotation-pdf/Q-2026-042/<token>.pdf",
  "pdf_size": 84213,
  "message_id": "<WhatsApp message id, or null while template pending>"
}
```

Odoo's built-in webhook action doesn't parse the response body — success is
just "did we get a 2xx". If you need the `pdf_url` back on the record's
chatter, add a *Server Action / Execute Code* step **after** the webhook step
that reads the same PDF URL back from Odoo (once the Worker writes it to
`x_pdf_url`), or keep the built-in action for simplicity and inspect the URL in
Cloudflare / R2 when needed.

### Manual retry / debugging

Curl the endpoint directly to reproduce whatever Odoo would send:

```bash
curl -X POST \
  "https://utak-worker.utak-business.workers.dev/internal/quotation-issue?token=$INTERNAL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"_action":"manual retry","_id":42,"_model":"x_quotation"}'
```

The Worker also accepts `{"quotation_id": 42}` for backward compatibility with
older scripts / any tests that still pass `quotation_id`.

### Failure modes

| HTTP | body                                                | cause |
|------|-----------------------------------------------------|-------|
| 401  | `{"error":"unauthorized"}`                           | wrong or missing `?token=` |
| 400  | `{"error":"bad json"}`                               | request body wasn't valid JSON |
| 400  | `{"error":"unexpected model: <x>"}`                  | `_model` present but not `x_quotation` |
| 400  | `{"error":"invalid quotation_id / _id"}`             | no positive integer id in the body |
| 404  | `{"error":"quotation <id> not found"}`               | Odoo has no `x_quotation` row with that id |
| 500  | `{"error":"service misconfigured — INTERNAL_WEBHOOK_SECRET missing"}` | Worker secret unset |
| 500  | `{"success":false,"error":"<message>"}`              | anything raised inside the quotation orchestration |

---

## Future actions (placeholders — not implemented yet)

The sections below will be filled in as Phase 2/3 lands. Same pattern (shared
token in `?token=`, same secret), different endpoint per document type:

- Receipt — `POST /internal/receipt-issue`
- Delivery note — `POST /internal/delivery-issue`
- Purchase order — `POST /internal/purchase-order-issue`
