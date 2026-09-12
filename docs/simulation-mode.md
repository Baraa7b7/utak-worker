# Runtime modes — sim, pilot, prod

Three worlds, one codebase, decided per deploy:

| Mode | Env vars set | Meta calls | Odoo rows stamped | `sim_outbound` written | Recipients allowed |
|---|---|---|---|---|---|
| **prod** | none | real | no | no | anyone (unless `SIM_ALLOWLIST` is set) |
| **pilot** | `PILOT_MODE=true` + non-empty `SIM_ALLOWLIST` | real | **yes** | **yes** (real wamid) | allowlist only (fail-closed if empty) |
| **sim** | `SIMULATION_MODE=true` | captured to D1, no Meta calls | yes | yes (synthetic wamid) | anyone captured; allowlist can layer on |

Two independent criteria drive this:

- **`isTestMode(env)`** — true when sim OR pilot. Gates stamping + capture.
- **`shouldRealSend(env)`** — true when pilot OR prod. Gates the Meta fetch.

Pilot exists specifically so a live trial with real WhatsApp numbers keeps
producing rows `/sim/purge` can find and reset afterwards.

`SIMULATION_MODE` and `PILOT_MODE` are mutually exclusive — the runtime
refuses to send if both are true. `SIM_ALLOWLIST` is a **second, independent
guard**: when set, every outbound recipient must start with one of its
`+`-prefixed entries, regardless of mode. Unset = production allow-all.

Report the current state:
```
GET /sim/mode?secret=$SIM_SECRET
```
Returns `{ mode, misconfig, allowlist: {set, entries, entries_masked} }`.

---

# SIMULATION_MODE — isolated dry-run for UTAK Worker

Everything about the sim worker is additive. The production worker
`utak-worker` and its wrangler.toml settings are **not** modified by any of
this. Deploying, redeploying, or stopping the sim worker cannot affect
production.

## What sim mode does

- **WhatsApp send layer only** is intercepted. Every outbound call that
  would have hit `graph.facebook.com/…/messages` is written to a D1 table
  `sim_outbound` with a synthetic `wamid.SIM.…` and a Meta-shaped response.
- **Everything else** — classifier, router, Odoo writes, PDF pipeline, KV
  dedup — runs unchanged.
- **Odoo isolation** is enforced by an `x_is_simulation` flag stamped on
  every business record the sim worker creates. `POST /sim/purge` wipes
  those rows atomically; `GET /sim/guard` refuses to run if any row on
  `x_daily_order` / `x_quotation` / `x_invoice` lacks the flag.

## One-time setup

### 1. Create Odoo field `x_is_simulation` (boolean, default false) on:

    res.partner, x_daily_order, x_daily_order_line,
    x_quotation, x_invoice, x_payment,
    x_purchase_list, x_delivery_route, x_delivery_stop,
    x_collection_task, x_collection_item,
    x_daily_price, x_supplier_price_request_log, x_message_analysis

Do this via Composio MCP / Odoo Studio / `ir.model.fields.create` — **the
Worker does not create fields**. The guard (`GET /sim/guard`) will tell you
which models still miss the field.

### 2. Cloudflare resources (one-time)

```bash
wrangler kv namespace create SIM_MSG_DEDUP --env sim
wrangler kv namespace create SIM_MSG_DEDUP --env sim --preview
wrangler d1 create utak-worker-sim-db
wrangler r2 bucket create utak-invoices-sim
```

Paste the returned KV ids and D1 database_id into the `[env.sim]` block in
`wrangler.toml` (placeholders `PASTE_SIM_*_HERE`).

### 3. Apply the sim_outbound schema

```bash
wrangler d1 execute utak-worker-sim-db --file=./schema/sim_outbound.sql --env=sim --remote
```

### 4. Set sim secrets

```bash
wrangler secret put META_APP_SECRET   --env sim   # any string; sim never verifies inbound signatures on /sim/inject
wrangler secret put META_ACCESS_TOKEN --env sim   # same value as prod is fine — never sent to Meta in sim
wrangler secret put META_VERIFY_TOKEN --env sim
wrangler secret put ODOO_API_KEY      --env sim
wrangler secret put ANTHROPIC_API_KEY --env sim
wrangler secret put SIM_SECRET        --env sim   # NEW: gates every /sim/* endpoint
```

### 5. Deploy

```bash
wrangler deploy --env sim
```

## Endpoints (all gated by SIM_SECRET, only served when SIMULATION_MODE=true)

Auth: pass `?secret=<SIM_SECRET>` OR header `x-sim-secret: <SIM_SECRET>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/sim/inject` | Deliver a synthetic incoming WhatsApp message to the same webhook handler prod uses. Body: `{"from":"+9665…","type":"text","text":"…"}` or `{"type":"button", "button":{"id":"…","title":"…"}}` or `{"type":"interactive","interactive":{"kind":"button_reply","id":"…","title":"…"}}`. Returns `{ok:true, injected_wamid}`. |
| GET  | `/sim/outbound?run_id=X` | List every outbound message captured under this run. |
| POST | `/sim/reset?run_id=X` | Delete one run's captured outbound rows. |
| POST | `/sim/purge` | Dry-run: report count of `x_is_simulation=true` rows per model in Odoo. |
| POST | `/sim/purge?confirm=1` | Actually unlinks those rows. |
| POST | `/sim/trigger?job=<name>` | Run one scheduled job on demand. Jobs: `ask_suppliers`, `reliability_scores`, `open_ordering`, `close_unconfirmed`, `aggregate_purchase`, `collection_summary`, `standing_reminders`, `daily_outreach`. |
| GET  | `/sim/guard` | Report whether Odoo is safe for sim (field present + no non-sim rows in guarded models). |

### run_id semantics

- The current run_id is stored in `MSG_DEDUP` KV under the key
  `sim:current_run_id`.
- First outbound capture creates one if absent (`run_${Date.now()}`).
- To start a fresh run without losing history:
  `wrangler kv key delete --binding MSG_DEDUP sim:current_run_id --env sim`
  (next capture creates a new `run_…`). Or write your own via
  `wrangler kv key put --binding MSG_DEDUP sim:current_run_id "run_teamtest_2026_09_12" --env sim`.

## Quick-start smoke test

```bash
SIM_URL=https://utak-worker-sim.utak-business.workers.dev
SIM_SECRET=<your-secret>

# 1. Inject a text message from a fake customer
curl -sS -X POST "$SIM_URL/sim/inject?secret=$SIM_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"from":"+966500000001","type":"text","text":"سلام عليكم"}'

# 2. Read back what the worker "sent"
CURRENT_RUN=$(wrangler kv key get --binding MSG_DEDUP sim:current_run_id --env sim)
curl -sS "$SIM_URL/sim/outbound?run_id=$CURRENT_RUN&secret=$SIM_SECRET" | jq .

# 3. Trigger the supplier ask job right now (no waiting for 02:00 cron)
curl -sS -X POST "$SIM_URL/sim/trigger?job=ask_suppliers&secret=$SIM_SECRET" | jq .
```

## PILOT_MODE — real Meta sends, restricted to a small list

The middle tier between sim and prod. Deploy as `wrangler deploy --env pilot`.
Same infrastructure pattern as sim (own KV, own R2, own name). The only
runtime differences from prod:

1. `PILOT_MODE=true` in vars.
2. `SIM_ALLOWLIST` is **required** and non-empty. Every send whose `to`
   doesn't start with one of the listed prefixes is refused with HTTP 403.
3. `/sim/*` endpoints answer (gated by `SIM_SECRET`), so `/sim/inject`,
   `/sim/mode`, `/sim/purge`, `/sim/trigger` all work — but there is no
   `sim_outbound` capture (that's sim-only).

If `SIM_ALLOWLIST` is empty while `PILOT_MODE=true`, the runtime returns
`RuntimeMisconfig` on every send. Fail-closed by design.

Deploy:
```bash
wrangler deploy --env pilot
```

## What sim mode does NOT do

- Does not stub Odoo calls — every read/write goes to the real Odoo. The
  `x_is_simulation` flag is the isolation boundary; scan queries that
  filter by it always see only sim rows.
- Does not stub Anthropic calls — every classify/extract call goes to the
  real API. Costs money; keep runs short.
- Does not stop crons on the prod worker (prod is untouched). The sim
  worker has no crons of its own; jobs run only via `/sim/trigger`.
- Does not verify Meta webhook signatures on `/sim/inject` — HMAC is
  replaced by `SIM_SECRET`. The regular `/webhook` still verifies HMAC.
