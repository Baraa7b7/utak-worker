-- UTAK — Meta delivery-status log (STATUS § 37 أ, 2026-09-25).
-- One row per status call Meta's webhook delivers (sent / delivered / read /
-- failed), with what the worker did with it. Written by logMetaStatus in
-- src/wa-status.ts; read by highestLoggedStatus (a row created after its
-- statuses arrived) and by the correction script
-- scripts/s37-20260925-status-fix.mts.
--
-- One-time setup on the sim worker's D1 database (the prod worker has no D1):
--   npx wrangler d1 execute utak-worker-sim-db --file=./schema/wa_status_log.sql --env=sim --remote
-- Rollback (not run unless asked): DROP TABLE wa_status_log;

CREATE TABLE IF NOT EXISTS wa_status_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wamid        TEXT    NOT NULL,
  status       TEXT    NOT NULL,   -- sent | delivered | read | failed (Meta's word)
  meta_ts      INTEGER,            -- Meta's own timestamp (unix seconds)
  received_ms  INTEGER NOT NULL,   -- when the worker got the call (unix ms)
  recipient    TEXT,               -- recipient_id as Meta sent it
  error_code   INTEGER,            -- errors[0].code on «failed»
  row_id       INTEGER,            -- x_wa_message id, when one carries the wamid
  applied      INTEGER NOT NULL,   -- 1 = written on the row, 0 = not
  verdict      TEXT    NOT NULL    -- new | higher | same | lower | failed_after_delivery | not_meta_state | no_row
);

CREATE INDEX IF NOT EXISTS idx_wa_status_log_wamid ON wa_status_log(wamid);
