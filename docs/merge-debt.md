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

## Phase 2, 3, 4 — deferred

Not yet on this branch. Update this file per phase as they land.
