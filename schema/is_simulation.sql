-- UTAK — «محاكاة» on the sim worker's D1 rows (STATUS § 37 ج, 2026-09-26).
-- is_simulation = 1 marks a row a trial produced (§ 37's trial: the status
-- calls of its messages and their outbound captures). Default 0; no row is
-- ever deleted. Nothing in D1 sums money — the supplier ledger lives in Odoo
-- (x_supplier_*, marked with x_utak_simulation) — the flag keeps the trial out
-- of any report built on these logs.
--
-- The project has no numbered migrations: each schema/*.sql is applied once
-- by hand. This one runs once, after wa_status_log.sql and sim_outbound.sql
-- (ALTER TABLE … ADD COLUMN fails if the column is already there):
--   npx wrangler d1 execute utak-worker-sim-db --file=./schema/is_simulation.sql --env=sim --remote
-- The rows are marked by scripts/s37-20260926-sim-cleanup.mts mark --apply.
-- Rollback (not run unless asked): the flags back with the script's rollback
-- step; the columns stay (ALTER TABLE … DROP COLUMN is_simulation only on request).

ALTER TABLE wa_status_log ADD COLUMN is_simulation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sim_outbound ADD COLUMN is_simulation INTEGER NOT NULL DEFAULT 0;
