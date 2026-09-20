-- UTAK simulation-mode outbound log.
-- Every WhatsApp message the Worker would have sent to Meta Graph is written
-- here instead when SIMULATION_MODE=true. Populated by fetchMeta() in src/meta.ts.
--
-- One-time setup on the sim worker's D1 database:
--   wrangler d1 execute utak-worker-sim-db --file=./schema/sim_outbound.sql --env=sim --remote
--
-- Read back with:
--   GET /sim/outbound?run_id=<id>&secret=<SIM_SECRET>
-- Reset one run:
--   POST /sim/reset?run_id=<id>&secret=<SIM_SECRET>

CREATE TABLE IF NOT EXISTS sim_outbound (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT    NOT NULL,
  ts_ms          INTEGER NOT NULL,          -- unix ms at the moment fetchMeta intercepted
  to_number      TEXT    NOT NULL,          -- E.164 without leading '+', as sent to Meta
  msg_type       TEXT    NOT NULL,          -- 'text' | 'template' | 'interactive' | 'location'
  template_name  TEXT,                      -- Meta template name (only when msg_type='template')
  variables_json TEXT,                      -- JSON array of body/button params for templates, or interactive payload
  body_text      TEXT,                      -- flattened human-readable body (text.body | interactive.body.text | rendered template)
  attachment     TEXT,                      -- JSON: {type:'document'|'image'|'video'|'location', link/coords/filename}
  wamid          TEXT    NOT NULL,          -- synthetic wamid we returned to the caller
  raw_request    TEXT    NOT NULL           -- full JSON body we would have POSTed to Meta, for diffing
);

CREATE INDEX IF NOT EXISTS idx_sim_outbound_run_id ON sim_outbound(run_id);
CREATE INDEX IF NOT EXISTS idx_sim_outbound_ts    ON sim_outbound(ts_ms);
