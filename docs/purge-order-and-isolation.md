# Purge order + isolation guarantees

## Two independent criteria

Two separate questions decide behavior at the seam:

1. **"Are we in test mode?"** — `isTestMode(env)` in `src/config.ts`.
   True when `SIMULATION_MODE=true` OR `PILOT_MODE=true`. This gates:
   - the `x_is_simulation=true` stamp in `src/odoo.ts::call`
   - the `sim_outbound` row written by `recordOutbound` in `fetchMeta`
2. **"Do we actually POST to Meta?"** — `shouldRealSend(env)`. True when
   NOT `SIMULATION_MODE=true` (i.e., pilot or prod). This gates the real
   `graph.facebook.com` fetch.

Result matrix:

| Mode | Stamp x_is_simulation? | Record sim_outbound? | Real Meta send? |
|---|---|---|---|
| prod | no | no | yes |
| sim | yes | yes (synthetic wamid) | no |
| pilot | yes | yes (real wamid from Meta) | yes |

Pilot exists precisely so a live-fire trial with real WhatsApp numbers
still produces rows /sim/purge can find and clean up afterwards.

## The 15 marked models (authoritative)

Baraa manually adds the `x_is_simulation` boolean field (default `false`) on
these fifteen models in Odoo. Every row the sim OR pilot worker creates on
any of them gets the flag stamped inside `src/odoo.ts::call` before the
request leaves the Worker.

| # | Model | Written by |
|---|---|---|
| 1 | `res.partner` | `createCustomer` |
| 2 | `x_daily_order` | `findOrCreateTodayOrder`, `createOrderFromStanding` |
| 3 | `x_daily_order_line` | `addOrderLines`, `createOrderFromStanding` |
| 4 | `x_quotation` | `createQuotationRecord` |
| 5 | `x_invoice` | `createInvoiceRecord` |
| 6 | `x_payment` | `createPaymentRecord` |
| 7 | `x_delivery_route` | `buildAndCreateRoutesForDrivers` |
| 8 | `x_delivery_stop` | `buildAndCreateRoutesForDrivers` |
| 9 | `x_purchase_list` | `createPurchaseListRecord` |
| 10 | `x_collection_task` | (created via router / v5 handler) |
| 11 | `x_standing_order` | (created in Odoo by hand; sim may write vals) |
| 12 | `x_complaint` | `createComplaint` (odoo-v6-append.ts) |
| 13 | `x_daily_price` | `createDailyPrice` |
| 14 | `x_supplier_price_request_log` | `createSupplierAskLog` |
| 15 | `x_message_analysis` | `logMessageAnalysis` |

`SIM_MARKED_MODELS` in `src/config.ts` holds this exact set. Drift between
the two is a fatal condition: the isolation test (`tests/sim-isolation.test.mts`)
asserts equality against the hard-coded reference list every run.

## Models deliberately NOT marked

Baraa's list omits these; the isolation test proves each stays UNTOUCHED
in every mode:

- **`product.template`** — shared catalog. Sim never creates products;
  every read is a lookup.
- **`x_collection_item`** — no `create` call in the Worker; if a child row
  model of `x_collection_task`, it cascades via `ondelete=cascade`.
- **`ir.model.fields`** / **`ir.access`** / other `ir.*` — Odoo
  infrastructure; must never be stamped.

## v6Call gap — closed

`src/odoo-v6-append.ts` used to hold its own Bearer-only `v6Call` helper
that bypassed `src/odoo.ts::call` and therefore skipped the sim-injection
hook. Every create through it — `createComplaint`, `createOrderFromStanding`
— was silently unstamped. `v6Call` now delegates to `call`; the test
covers `createComplaint` end-to-end to keep this regression-free.

## Purge order (FK-safe)

`/sim/purge` deletes rows in exactly this order — children before parents.
The order is a single `SIM_PURGE_ORDER` constant in `src/config.ts`; the
purge function iterates it as-is.

```
x_daily_order_line
x_delivery_stop
x_payment
x_invoice
x_quotation
x_collection_task
x_delivery_route
x_purchase_list
x_daily_order
x_standing_order
x_complaint
x_daily_price
x_supplier_price_request_log
x_message_analysis
res.partner  ← archived (active=false), never deleted
```

**Why res.partner is archived, not deleted:** Odoo refuses to `unlink` a
partner referenced by any surviving row anywhere in the database — order
logs, mail messages, res.users, external systems. Archive achieves the
same purge-mode isolation (rows disappear from every default view) without
tripping the reference guard.

## Fault tolerance

Per-model failure is logged and the purge continues:

- `search` fails → row logged with `action: "skip"`, `error` set; purge
  moves on. Fatal for that model only.
- `unlink` fails on a business model → same; deletion doesn't roll back
  earlier models (they're already gone).
- `write active=false` fails on `res.partner` → same; earlier deletions
  stand.

Final response contains:

```json
{
  "dry_run": false,
  "order": [ /* SIM_PURGE_ORDER */ ],
  "per_model": [{ "model": "...", "action": "unlink|archive|skip",
                  "matched": N, "deleted": N, "archived": N,
                  "ids_sample": [...], "error": "..." }, ...],
  "total_matched": N,
  "total_deleted": N,
  "total_archived": N,
  "errors": N
}
```

## Non-negotiable invariant

Every `search` / `unlink` / `write` in `purgeSimulationData` includes the
domain filter `["x_is_simulation", "=", true]`. There is no code path in
`src/sim.ts::purgeSimulationData` that can delete a row without that
filter. This is what makes `/sim/purge` safe to expose behind a shared
secret — the worst case with a stolen `SIM_SECRET` is that the attacker
deletes their OWN sim rows. Protecting this invariant is priority #1
whenever this function is edited.

## Dry-run first

Default request: `POST /sim/purge` (no `confirm`). Returns the same report
shape with `dry_run: true` and no writes performed. Confirm with
`POST /sim/purge?confirm=1` only after reviewing the counts.
