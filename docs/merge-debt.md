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

## Phase 2, 3, 4 — deferred

Not yet on this branch. Update this file per phase as they land.
