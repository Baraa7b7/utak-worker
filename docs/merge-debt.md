# Merge Debt — sim-harness → main

Items that live only on `sim-harness` and MUST be replicated / addressed
before this branch merges into main.

## Phase 1 — Template sync Meta → Odoo (2026-09-17)

- **`ODOO_HOOK_TOKEN` secret** must exist on the prod worker before the
  Odoo Automated Action's webhook URL points there. Currently only set on
  `[env.sim]`. Rotate independently between envs.
- **Odoo schema changes** already live on `utakfresh.odoo.com` (shared
  between sim and prod): 8 new fields on `x_whatsapp_template`, new
  `x_wa_control` singleton model + view + button, `wa_control.sync_webhook`
  server action, `wa_control.on_sync_requested` base.automation. When
  merging to prod, the automation's webhook URL must be flipped from the
  sim origin to `https://utak-worker.utak-business.workers.dev/…`.
- **Template sync writes** to `x_whatsapp_template` mutate only new fields
  (`x_meta_id`, `x_meta_status`, `x_category`, `x_body`, `x_param_count`,
  `x_buttons`, `x_last_synced`, `x_missing_in_meta`). The template-selector
  fields the sender relies on (`x_meta_template_id`, `x_language`,
  `x_purpose`) are never touched.
- **New Odoo records** (Meta templates with no Odoo row) are created with
  `x_purpose` unset so `fetchMapping` in `src/templates.ts` refuses to auto-
  select them until Baraa assigns a purpose by hand.
- **Cron append**: the 05:00 Riyadh handler (`case "0 2 * * *"`) now calls
  `runTemplateSync` in a try/catch after the existing reliability-score
  work. If prod's cron dashboard toggle is re-enabled, this handler will
  double-fire alongside sim on the same Odoo tenant — leave the prod cron
  paused until the sim/pilot window closes.
- **Blocker on this branch**: ~~`META_ACCESS_TOKEN` on the sim worker is a
  48-char string that Meta rejects with "Cannot parse access token"~~
  Resolved 2026-09-17: token replaced with a permanent one Meta accepts
  (GET `/2144001136512196/message_templates` returned data). The sync
  pipeline is now unblocked.

## Phase A — Diagnostic auth split (2026-09-17)

- **`/admin/wa-template-sync` — header-only auth.** The diagnostic route
  now accepts the token only via `X-Admin-Token` request header. A caller
  passing `?token=` in the query string is rejected with 401 before any
  work. Rationale: query strings leak into logs, browser history, and
  proxy caches; a diagnostic that touches Odoo must not.
- **`/odoo/hook/wa-template-sync` — query-string auth stays.** Odoo 19
  SaaS "Send Webhook Notification" server actions cannot set custom
  headers or sign the body, so this hook is stuck reading `?token=`. Do
  not switch it without a matching Odoo migration.
- **Temporary Phase A routes** — `/admin/meta-phone-info` (Meta phone
  diagnostic) and `/admin/dry-run-supplier-ask` (02:00 dry-run) live on
  `sim-harness` for the tonight-readiness check only. Both are removed
  before merge; see the "Phase A cleanup" commit that closes Phase A.

## Items 1–4 (tonight, 2026-09-17)

Prod does not yet know any of the following Odoo schema. Replaying
each item's script (scripts/item{1,2,3,4}-*.mjs) against the prod
tenant is required on promotion. Nothing here changes the eight
cron jobs, the 02:00 supplier ask flow, x_daily_price, the pricing
formula, x_is_active_for_sale, or SIM_ALLOWLIST — all of those stay
identical to prod.

### Item 1 — product.template.x_supplier_ids
- New many2many field on product.template pointing at res.partner,
  storing rows in the SAME table
  `x_product_template_res_partner_rel` that already backs
  res.partner.x_supplied_product_ids — columns reversed
  (column1=product_template_id, column2=res_partner_id). Writes
  from either side surface on the other.
- Two inherited views: product.template.form.utak_suppliers adds
  a "الموردون" section (widget=many2many_tags, domain
  supplier_rank>0); res.partner.form.utak_supplied_products adds
  the "الأصناف اللي يوردها" tab (visible only when supplier_rank>0).
- Data change kept on this branch: product.template id=105 (Avocado)
  is linked to res.partner id=30 (أحمد حسان). This must remain in
  place on prod; do NOT delete it on merge.

### Item 2 — x_wa_message model + queued send pipeline
- New model x_wa_message (18 x_* fields incl. x_partner_id,
  x_direction, x_kind, x_template_id, x_params, x_body, x_attachment,
  x_filename, x_res_model, x_res_id, x_status, x_meta_message_id,
  x_meta_error, x_processed_at, x_dry_run, x_debug_payload,
  x_manual). ir.access row for base.group_user (Odoo 19 crud kind).
- Inverse res.partner.x_wa_message_ids (one2many) so the partner
  tab has a live recordset.
- Views: tree, form (statusbar + "إرسال" button via
  ir.actions.server wa_message.action_queue), search, and inherited
  res.partner.form.utak_wa_messages tab.
- Menus: UTAK → "رسائل واتساب" and UTAK → "تحكم واتساب" (the
  latter reuses the x_wa_control singleton from Phase 1).
- ir.actions.server wa_message.send_webhook (state=webhook) points
  at the sim origin. Prod must flip that URL to
  https://utak-worker.utak-business.workers.dev/odoo/hook/wa
  along with a prod ODOO_HOOK_TOKEN.
- base.automation wa_message.on_queued
  (trigger=on_create_or_write, filter_domain
  `[["x_status","=","queued"]]`).
- Inbound webhook side-effect: every incoming Meta message writes an
  x_wa_message row (direction=in, status=received) via
  logWaMessage; Meta `statuses` callbacks bump the row's x_status
  via updateWaStatusByWamid.
- **Not logged to x_wa_message (2026-09-18):** the 02:00
  supplier-ask cron (`askAllSuppliersForPrices` →
  `sendTemplate` → `fetchMeta`) does NOT create an x_wa_message
  row. It writes to `x_supplier_ask_log` and, in sim, to
  `sim_outbound` via `recordOutbound`. If the UTAK «رسائل
  واتساب» screen should include the daily supplier-ask fan-out,
  the cleanest hook is to call `logWaMessage(env, {partnerId,
  direction: 'out', kind: 'template', body: productList,
  status: 'sent'})` right after the successful `sendTemplate`
  return in `src/suppliers.ts` (~line 143). Same missing coverage
  applies to the other cron paths that call `sendTemplate` /
  `sendText` directly without going through the queued
  `x_wa_message` pipeline (collection cron, morning report,
  driver flow). Not fixed in this commit — surfaced only.
- **Search view filters (2026-09-18).** `x_wa_message.search`
  (view id 2781) rewritten to expose six filters (واردة / صادرة
  / مرفوضة / قيد الإرسال / اليوم) plus three group-by toggles
  (partner / status / direction) and three search fields (partner,
  body ilike, wamid). `ir.actions.act_window` id 965 now pins
  `search_view_id` to this view (was unset — Odoo was picking
  the previous 3-filter arch by default). «اليوم» uses
  `context_today().strftime('%Y-%m-%d 00:00:00')` — a single
  expression, no `datetime.combine`, verified through
  `get_views`. Group-by is written as flat `<filter
  context="{'group_by': ...}"/>` entries with a `<separator/>`
  above them: the previous attempt wrapped them in `<group
  expand="0" string="تجميع حسب">` and Odoo 19.4 silent-rolled
  the whole search view on that. Script:
  `scripts/item2-wa-search-filters.mjs` — idempotent; safe to
  re-run on prod after the initial item2 migration.
- **Ahmed Hassan Sep 17 19:05 (id=1) x_status blank —
  diagnosis only.** Row was created without any `x_status` in
  the `vals_list`, so the column is stored as `NULL` in Postgres.
  Odoo's Selection widget renders NULL as an empty cell, so the
  tree column is blank on purpose. Not a rendering bug; the row
  is genuinely missing a status. Every code-path today
  (`logWaMessage`, the q-manual-wa create at
  `src/index.ts:938`) supplies `x_status` on create, so this is
  a one-off from an early smoke test. No fix applied in this
  commit — will address separately if we decide to backfill or
  add a NOT NULL constraint on `x_status`.

### Item 3 — manual quotation
- x_quotation.x_origin (selection auto/manual, default auto).
- x_daily_order_line.x_price_unit_manual (float, optional).
- ir.actions.server quotation.manual_pdf_build (→
  /internal/quotation-issue) and quotation.manual_wa_send (→
  /internal/quotation-wa-send). Both webhook URLs bake in the sim
  hook token and origin — prod must swap both.
- Inherited x_quotation form view adds an x_origin statusbar + the
  two header buttons "إصدار PDF" and "إرسال واتساب".
- Worker: createAndDispatchQuotationForRecord skips WhatsApp send
  (and x_sent_at write) when x_origin=='manual'. PDF+R2 still runs
  so the "إصدار PDF" button leaves an up-to-date file. Manual
  blocked line surfaces "صنف بلا سعر: <name>". Reuse of the
  existing PDF pipeline means no parallel code path.

### Item 4 — res.partner.x_wa_allowed
- Boolean field with label "مسموح واتساب".
- Inherited res.partner form view adds a "UTAK — واتساب" group
  exposing the flag.
- **Default for new partners flipped to True (2026-09-18).**
  Implemented as a single `ir.default` row on the field
  (`field_id`=<x_wa_allowed>, `json_value`="true", no user / no
  company / no condition). Applies whenever a new res.partner is
  created without an explicit x_wa_allowed value — regardless of
  customer_rank / supplier_rank / partner type. To roll back to
  a False default later, delete that `ir.default` row (or write
  `json_value`="false" on it). No automation or hook is used —
  purely native Odoo field default.
- **Bulk backfill (2026-09-18).** All existing res.partner rows,
  active AND archived, suppliers / customers / employees / drivers /
  everything, were flipped to x_wa_allowed=True via
  `scripts/item4-wa-allowed-default-true.mjs`. Baraa's number
  (+966505154962) is the only exclusion — his eight partner rows
  keep whatever value they had (all still False). Prod promotion
  must re-run the same script after item4-wa-allowed.mjs has
  landed the field/views.
- Worker: fetchMeta's allowlist gate becomes a two-stage check —
  SIM_ALLOWLIST (fast, sync) then, on miss, isPartnerWaAllowed
  (Odoo-backed with a 60s KV cache under key
  `wa_allowed:<+E164>`). Owner-guard runs before both and stays
  non-bypassable, even if the owner's partner row has
  x_wa_allowed=true.
- Same two-stage gate is duplicated in handleWaMessageWebhook so
  the x_wa_message dry_run path enforces the same policy without
  needing a live Meta call.
- Inbound alert: unrecognized (non-supplier, non-team) sender whose
  number fails BOTH gates triggers a one-per-24h owner alert
  "رقم جديد راسل: <name/phone> — فعّل واتساب أو رد يدوياً"
  via KV key `wa_unallowed_alert:<+E164>`.
- The three current allowlisted numbers (+966505154962,
  +966536251307, +966571777704) stay allowlisted via SIM_ALLOWLIST
  — nothing about SIM_ALLOWLIST changes.

## Phase 1 item 1 (parallel build) — sale.order UTAK quotation (2026-09-18)

Parallel build. `x_quotation` and the 02:00 supplier-price flow stay
identical to prod; nothing about them changes. Adds a second, independent
"إرسال واتساب" path that reads from a standard `sale.order` and reuses
the same UTAK PDF shell, R2 upload helper, `x_wa_message` create, and
queued send pipeline (`handleWaMessageWebhook`) that the manual
`x_quotation` path already uses.

- **Schema on `utakfresh.odoo.com` (shared sim/prod)**:
  - `sale.order.line.x_price_unit_manual` — Studio float. Optional; when
    `> 0` it wins over the standard `price_unit` and over the
    `x_daily_price` fallback.
  - `sale.order.line.x_packaging_id` — Studio many2one to
    `x_product_packaging` (the existing 42-row custom model). Standard
    `product.packaging` is NOT present on this tenant, so packaging is
    read from the same source the x_daily_order_line pipeline already
    uses. No data migration performed or required.
  - `ir.actions.server` **sale.quotation.wa_send** (state=webhook) →
    `/internal/sale-quotation-wa-send`. Webhook URL bakes in the sim hook
    token + origin — **prod must flip the URL** to
    `https://utak-worker.utak-business.workers.dev/internal/sale-quotation-wa-send`
    along with the prod `ODOO_HOOK_TOKEN`.
  - `ir.ui.view` **sale.order.form.utak_wa_button** — inherited form view
    that injects a single header button "إرسال واتساب (UTAK)" with an
    Arabic confirm string. Uses `<xpath expr="//header" position="inside">`;
    the standard `<header>` on `sale.order` is kept intact.
- **Numbering decision**: no new `ir.sequence` created. Standard
  `sale.order.name` (`ir.sequence` code `sale.order`, prefix `S`,
  padding 5 → `S00001…`) is the quotation number. `x_quotation`
  numbering (`Q-YYYY-NNNN`) is a completely separate sequence — the two
  cannot collide.
- **Packaging decision**: `x_packaging_id` many2one on `sale.order.line`
  reuses the existing `x_product_packaging` (42 rows). Reason: probe
  confirmed `product.packaging` is not installed on this tenant, so any
  migration to the standard model would require installing it first.
  Least intervention wins.
- **Pricing wiring**: three-tier priority (`x_price_unit_manual` →
  `price_unit` → `x_daily_price`) is enforced in the Worker inside
  `buildQuotationPDFDataFromSaleOrder` (in
  [src/sale-order-quotation.ts](../src/sale-order-quotation.ts)). Odoo
  Online (saas-19.4) doesn't allow Python compute on pricelist items,
  and adding an `ir.actions.server` (state=code) `pre-create` hook to
  auto-fill `price_unit` would be a second write path; the Worker-side
  read is the simplest working choice. The `x_daily_price` fallback
  reuses `getLatestSalePrice` byte-for-byte (no formula change).
- **Missing-price block**: same Arabic surface as the manual
  `x_quotation` path — "صنف بلا سعر: <name>", owner alert via
  `sendOwnerAlert`, no `x_wa_message` row created.
- **All existing barriers reused**: owner-guard (never bypassable),
  `SIM_ALLOWLIST` + `x_wa_allowed` gate, 24-hour Meta rule (code 131047),
  `?dry_run=1` for safe testing. The queued `x_wa_message` write to
  `x_res_model='sale.order'` + `x_res_id=<so id>` flows through the
  existing `handleWaMessageWebhook` unchanged — this route is generic
  over `res_model`, so no code fork was needed.
- **Verified on sim (2026-09-18)** via
  `scripts/item1-sale-quotation-verify.mjs`:
  - Three-tier priority produced a valid `dry_ok` with `x_res_model='sale.order'`.
  - Missing-price line produced no `x_wa_message` row (blocked before create).
  - Owner-phone destination → `x_status='failed'`,
    `x_meta_error="رقم المالك لا يُستخدم كوجهة"`.
  - `x_quotation` count / `x_daily_order` count / `ir.cron` count / the
    two `quotation.manual_*` server actions (id + webhook_url) all
    unchanged before vs. after.
  - Every test row (3 sale.orders, 2 x_wa_messages, 1 temp partner) was
    deleted on the way out. No real data touched.
- **Rollback (single script or four RPC calls)**:
  1. `ir.ui.view.unlink([id=2787])` — the inherited sale.order form view.
  2. `ir.actions.server.unlink([id=970])` — the `sale.quotation.wa_send`
     webhook action.
  3. `ir.model.fields.unlink([id=20155])` — `x_packaging_id` on
     `sale.order.line`.
  4. `ir.model.fields.unlink([id=20153])` — `x_price_unit_manual` on
     `sale.order.line`.
  Worker rollback: remove `src/sale-order-quotation.ts` and the
  `/internal/sale-quotation-wa-send` block in `src/index.ts` (the diff
  is purely additive — no other file changed).

## Item 5 (sim, 2026-09-18) — remove default VAT from the sale flow + neutralize sale_project picker filter

Braa's screen showed two problems on `sale.order.line`:

1. Every new line was stamped with a 15% VAT.
2. The product picker returned zero UTAK products.

### Diagnosis (fully evidenced, no guesswork)

Sources of the automatic 15% VAT:

- **Company default.** `res.company id=1 utakfresh` had
  `account_sale_tax_id = [5, "15%"]` and
  `account_purchase_tax_id = [21, "15%"]`. Odoo stamps this onto any new
  `product.template.taxes_id` that is created without an explicit value.
- **Per-product default.** Every one of the 37 existing
  `product.template` rows carried `taxes_id = [5]` (sale tax id 5, "15%")
  and `supplier_taxes_id = [21]` (purchase tax id 21, "15%") — copied from
  the SA fiscal chart when the products were seeded. `sale.order.line` derives
  its `tax_ids` from `product_id.taxes_id` on create.

Source of the empty product picker:

- **`sale_project` view id=2431**
  (`sale_project.sale_order_line_view_form_editable`, priority 999,
  inherits `sale.order.line.form.readonly` id=1256) adds
  `<attribute name="domain">[('type', '=', 'service')]</attribute>` to
  `<field name="product_id"/>`. UTAK's 35 seed products are `type='consu'`,
  so the standalone-form picker on `sale.order.line` filters them all out.
  This is a `sale_project` behaviour, not a UTAK bug — it exists so that a
  sale.order tied to a project only offers billable services on a line.

### What Item 5 changes on `utakfresh.odoo.com`

The tenant is shared between sim and prod, so this landed once. Nothing in
`account.tax` was deleted — the 17 SA-chart taxes are still there,
including id=5 "15%" and id=21 "15%". They are just no longer applied by
default.

- **A. Company default cleared.**
  `res.company.write([1], {account_sale_tax_id: false, account_purchase_tax_id: false})`.
- **B. Per-product tax cleared** on all 37 `product.template` rows:
  `taxes_id = [[6, 0, []]]` and `supplier_taxes_id = [[6, 0, []]]`.
- **C. Picker override view.** New `ir.ui.view` id=2788
  `utak.sale.order.line.form.no_service_filter` (priority=1000, inherits
  1256) resets the domain to `[('sale_ok', '=', True)]`, overriding
  sale_project's view 2431 (priority 999). UTAK consumables now show in the
  standalone-form picker again; sale_project's own use (project-billing
  services) is only cosmetically affected when a project-linked line is
  edited in the standalone form.

`x_is_active_for_sale` (the operational daily-availability boolean on
`product.template`, id=20045) was **not touched**. `sale_ok` is Odoo's
"can be sold ever" flag; `x_is_active_for_sale` is UTAK's "on today's
menu". Do not conflate them.

### Rollback (one command, single script)

The apply script wrote a full snapshot of `res.company` + every touched
`product.template` (including the exact `taxes_id` / `supplier_taxes_id`
lists) to `scripts/artifacts/item5-tax-rollback.json` before making any
change. To reinstate the 15% VAT default and drop the picker override:

```
node scripts/item5-tax-rollback-restore.mjs
```

This restores the company default, walks every product row back to its
snapshot value, and unlinks view id=2788. It is idempotent — safe to
re-run. If the JSON is lost, the two tax ids to re-apply are
`account_sale_tax_id=5` and `account_purchase_tax_id=21` (from the SA
chart on this tenant).

To reactivate later on a per-product basis (partial rollout when the
accountant decides), write directly:

```
product.template.write([...utak_ids], { taxes_id: [[6, 0, [5]]] })
```

### Prod promotion note

Since this is a tenant-level change and the tenant is shared, prod already
sees it. When promoting `sim-harness` → `main`, **do not re-run**
`scripts/item5-tax-and-picker-fix.mjs` against prod — the snapshot in
`scripts/artifacts/item5-tax-rollback.json` was taken from this
already-cleared state; a second run would overwrite the rollback JSON with
empty-tax rows and destroy the ability to restore. If a fresh snapshot is
ever needed for prod, take it before applying anything.

The Worker code is unchanged in Item 5 — no deploy needed. The PDF pipeline
still passes `vatAmount: 0` to the UTAK shell
([src/sale-order-quotation.ts:193](../src/sale-order-quotation.ts:193)), and
`pdf-template.ts` still ships an empty VAT number (`vat: ""` on line 42).
The "ضريبة القيمة المضافة (١٥٪): 0.00 ر.س" row that renders is a fixed
visual placeholder; hiding it is a separate template decision.

### Verified 2026-09-18 (Asia/Riyadh)

Via `scripts/item5-verify.mjs`:

- Fresh sale.order.line with product طماطم, qty=4, price=25 →
  `tax_ids=[]`, `price_subtotal=100`, `price_total=100`.
- Parent `sale.order.amount_tax=0`, `amount_untaxed=100`, `amount_total=100`.
- Brand-new `product.template` created with no explicit `taxes_id` reads
  back as `taxes_id=[]` — proves the company default was really cleared.
- View 2788 priority=1000 above sale_project view 2431 priority=999.
- Counts of `x_quotation` (9), `x_daily_order` (13), `x_daily_price` (7),
  `ir.cron` (56), and the three quotation.manual_* / sale.quotation.wa_send
  server actions unchanged before → after.
- The `x_is_active_for_sale` field (id=20045) definition unchanged.
- Every test row (1 sale.order, 1 sale.order.line, 1 product.template)
  deleted on the way out. Zero deltas.

### Units — reported, not changed

Braa's screen showed unit "الوحدات" on lines. Confirmed against the
tenant: all 37 UTAK product templates carry `uom_id=[1,"Units"]`; UTAK's
"كرتون / كيلو / جرم / كيس / فلين" live on `x_product_packaging` (42 rows,
already surfaced through the parallel `sale.order.line.x_packaging_id`
Studio field — see Item 1). No change made to UOM. If Braa wants the
sale.order.line to show كرتون/كيلو instead of Units, we need to either
(i) migrate the 35 UTAK templates to `uom_id=31 "كرتون"` (factor 10000,
which is bizarre — the SaaS Studio-created row needs its `factor` fixed
to 1 first, or new UOMs `كيلو`/`كرتون`/`جرم`/`كيس` seeded), or
(ii) rebrand what the line displays via a UOM overlay column. Both are
follow-ups, not part of Item 5.

## Item 2 sub-items (2026-09-18) — small pending

Batched cleanup pass. Six sub-items surfaced in Baraa's task list.
Every write below applies to the shared tenant `utakfresh.odoo.com`,
so **do not re-run these against prod on merge** — prod already sees
them. Worker code changes DO need to promote as usual.

### Item 2a — rotate `ODOO_HOOK_TOKEN` (leaked)

Script only. `scripts/item2a-rotate-hook-token.mjs` is prep — it
reads the new token from `~/utak-hook-token.txt` (mode 600, generated
locally, never printed) and writes it into the 5 sim-facing
`ir.actions.server.webhook_url` values on `utakfresh.odoo.com`
(ids 968, 969, 970, 963, 967). The 2 prod-facing rows (957 Send
Receipt Webhook, 941 UTAK: Issue & Send Quotation) are untouched;
prod rotates independently on `main`.

Actual rotation is NOT executed by the sim-harness pipeline — Claude
Code's auto-mode classifier refuses secret-store writes. Baraa runs
three commands in order:

```
cat ~/utak-hook-token.txt | npx wrangler secret put ODOO_HOOK_TOKEN --env sim
npx wrangler deploy --env sim
node scripts/item2a-rotate-hook-token.mjs
```

Between step 2 and step 3, Odoo→Worker webhooks with the old token
receive 401 for a few seconds — the window is bounded and no
customer-facing flow is on this path.

### Item 2b — unbind Odoo's native sale-order print reports

Applied on `utakfresh.odoo.com` via `scripts/item2b-hide-native-sale-print.mjs`.

Before: three `ir.actions.report` rows exist for `sale.order` —
`id=433 sale.report_saleorder` (already unbound),
`id=434 sale.report_saleorder_pro_forma` bound,
`id=477 sale.report_saleorder_raw` bound.

Write: `binding_model_id = false` on ids 434 + 477. `binding_type`
stays `"report"` — Odoo 19 SaaS refuses to null it (the field is
required even when unbinding, and setting it to false alongside
`binding_model_id` trips a `ValidationError`). Setting
`binding_model_id` alone is enough to remove the entry from the
Print button dropdown.

Rollback: `ir.actions.report.write([477 or 434], {binding_model_id: 2731})`.
Report definitions stay callable via direct URL; only the menu entry
is removed.

### Item 2c — log 02:00 supplier fan-out to `x_wa_message`

Worker code only. In `src/suppliers.ts::askAllSuppliersForPrices`,
right after the successful `sendTemplate` + `sent++`/`console.log`,
a passive `logWaMessage(env, {...})` call now creates an
`x_wa_message` row with `direction=out`, `kind=template`,
`body="[supplier_ask] <productList>"`, `status=sent`. Send logic
and timing are unchanged; the log call is best-effort (its own
try/catch inside `wa-message-send.ts`), so a log failure never
breaks the cron.

Same coverage is STILL missing from the collection cron
(`x_collection_task`), morning report, and driver flow — those
remain follow-ups. `merge-debt.md` retains the earlier note on
that.

### Item 2d — recompute old sale.orders with lingering `tax_ids`

No-op after item5 cleanup. Verified via `scripts/verify-item2.mjs`
(actually `/tmp/.../scratchpad/verify-item2.mjs` for the last run):

- `sale.order.line` with `tax_ids != false` = **0**
- `sale.order` with `amount_tax != 0` = **0**
- `product.template` with `taxes_id != false` = **0**

Nothing to recompute; item5 was thorough on the shared tenant.

### Item 2e — create the 4 missing `x_whatsapp_template` rows

Applied on `utakfresh.odoo.com` in two steps:

1. `scripts/item2e-template-purposes.mjs` — creates 4 rows for the
   Meta templates the sync failed to land (because `x_purpose` is
   required at the model level but the sync leaves it unset on
   create; `wa-template-sync.ts` still refuses to auto-fill it,
   which keeps the "needs Baraa" signal intact). Rows are created
   with placeholder `x_purpose="other"`. Then a re-triggered sync
   backfills `x_meta_id / x_meta_status / x_category / x_body /
   x_param_count / x_buttons / x_last_synced` from Meta.
2. `scripts/item2e-template-purposes-refine.mjs` — reassigns
   `x_purpose` based on the actual body of each template:

   | id | Meta template          | body summary               | x_purpose            |
   |----|------------------------|----------------------------|----------------------|
   | 42 | utak_v2_collection     | كشف التحصيل                | collection_summary   |
   | 43 | utak_v2_purchase       | قائمة مشتريات اليوم        | purchase_list        |
   | 44 | utak_v2_driver_route   | مسارك جاهز                 | driver_dispatch      |
   | 45 | hello_world            | Meta demo (English)        | other                |

   `fetchMapping` uses `limit=1` (order = id ASC), so the v1 rows
   (id=5, 7, 11) still win at send-time. The v2 rows are
   semantically labeled and ready for Baraa to demote a v1 to
   `"other"` when he wants v2 to take over. **No worker code
   behaviour changes.**

Rollback: `x_whatsapp_template.unlink([42, 43, 44, 45])`.

### Item 2f — register `supplier_confirm` template if Meta-approved

Skipped: **`supplier_confirm` is not approved on Meta** (verified
by running `runTemplateSync` — the fetch returned 26 templates and
none of them names `supplier_confirm`). Nothing to register in
Odoo. When/if it lands on Meta, the existing sync will create the
row (blocked by the same `x_purpose` gate as item2e — same fix
applies).

### Item 2 verification (2026-09-18, 17:5x Asia/Riyadh)

Via `/tmp/.../scratchpad/verify-item2.mjs`:

- `ir.cron` = 56  (unchanged)
- `x_daily_price` = 7  (unchanged, 02:00 flow intact)
- `x_quotation` = 9  (unchanged)
- `x_daily_order` = 13  (unchanged)
- `x_whatsapp_template` = 26  (was 22 → +4)
- `x_wa_control` = 1  (unchanged)
- `x_wa_message` = 2  (unchanged; item2c fires on the next 02:00 cron)
- `sale.order.line` with `tax_ids != false` = 0
- `sale.order` with `amount_tax != 0` = 0
- Sim-facing webhook URLs (5 rows) all still carry the OLD token
  (rotation gated on Baraa's `wrangler secret put`)
- Prod-facing webhook URLs (2 rows) untouched
- `sale.order` print reports 434 + 477 unbound; 433 was already
  unbound

Post-deploy sync health check (`GET /admin/wa-template-sync` on
`utak-worker-sim`) returned 200 with 26 fetched / 26 updated / 0
errors.

## Phase 2, 3, 4 — deferred

Not yet on this branch. Update this file per phase as they land.
