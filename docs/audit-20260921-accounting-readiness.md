# Accounting Readiness Audit — 2026-09-21

**Tenant:** `utakfresh.odoo.com` / db `utakfresh`
**Branch:** `sim-harness` (HEAD `9841b8f`)
**Method:** read-only Odoo JSON-2 (`search_read`, `search_count`, `fields_get`, `read` on `res.company`)
**No writes to Odoo. No deploys. No Meta/Graph calls.**
**Reproduce:** `node scripts/audit-20260921-accounting-readiness.mjs` — writes a local JSON snapshot to `scripts/artifacts/audit-20260921-accounting-readiness.json` (not committed).

The question this audit answers: *what would need to be connected before the standard Odoo financial statements — Balance Sheet, Profit & Loss, Trial Balance — can be produced end-to-end from Odoo?*

Answer in one line: the accounting layer is installed and provisioned, but the app never writes to it. Every business event lives in custom `x_*` models. **`account.move.line` count is 0 → the general ledger is empty.**

---

## 1. Modules

| Module | State |
|---|---|
| `sale` | installed |
| `sale_management` | installed |
| `purchase` | installed |
| `account` | installed |
| `account_accountant` | installed |
| `stock` | installed |
| `crm` | installed |
| `hr` | installed |
| `l10n_sa` | installed |
| `web_studio` | installed |
| `mail` | installed |
| `hr_expense` | **uninstalled** |
| `l10n_sa_edi` | **uninstalled** |

`hr_expense` and `l10n_sa_edi` (ZATCA e-invoicing Phase-2) are the only relevant gaps. The rest of the accounting stack is present.

---

## 2. Standard-model activity

| Model | Total | Notes |
|---|---:|---|
| `sale.order` | 2 | both `draft`, never confirmed to `sale` → no invoice ever flowed from the sales pipeline |
| `sale.order.line` | (2 orders' worth, created by verify script) | test scaffolding only |
| `purchase.order` | 0 | purchases run entirely on custom `x_purchase_list` |
| `account.move` | **0** | no journal entry has ever posted, in any journal, of any type |
| `account.move.line` | **0** | general ledger has no rows |
| `account.payment` | **0** | payments run entirely on custom `x_payment` |
| `account.bank.statement.line` | 0 | no bank feed |
| `stock.picking` | 4 (all `cancel`) | inventory movements never confirmed |
| `stock.quant` | 0 | no on-hand quantity is tracked in Odoo |
| `crm.lead` | 1 | trivial |
| `hr.employee` | 0 | staff/team live on `x_employee_role` + `res.partner` |

Every standard financial model is empty. The chart of accounts and the journals are provisioned; **nothing writes to them**.

---

## 3. Custom `x_*` models with data

21 custom models hold data; the two others (`x_standing_order`, `x_standing_order_line`) are empty.

| Model | Rows | Last write | Role in the flow |
|---|---:|---|---|
| `x_whatsapp_template` | 52 | 2026-09-21 | template registry |
| `x_product_packaging` | 47 | 2026-09-19 | packaging → line pricing |
| `x_wa_message` | 44 | 2026-09-21 | outbound WA send log |
| `x_message_analysis` | 34 | 2026-09-12 | inbound-message classifier log |
| `x_supplier_price_request_log` | 20 | 2026-09-21 | daily supplier ask journal |
| `x_daily_order_line` | 16 | 2026-09-15 | **the actual sales line** |
| `x_daily_price` | 14 | 2026-09-19 | supplier-derived daily price |
| `x_daily_order` | 13 | 2026-09-15 | **the actual sales header** |
| `x_quotation` | 9 | 2026-09-15 | quotation record (custom, in parallel to `sale.order`) |
| `x_employee_role` | 4 | 2026-09-03 | team routing |
| `x_payment` | 4 | 2026-09-11 | **cash/bank receipt (custom)** — no `account.payment` twin |
| `x_neighborhood` | 3 | 2026-08-29 | delivery geo |
| `x_delivery_route` | 2 | 2026-09-11 | driver route header |
| `x_delivery_stop` | 2 | 2026-09-12 | route stop |
| `x_invoice` | 2 | 2026-08-31 | **customer invoice (custom)** — no `account.move` twin |
| `x_purchase_list` | 2 | 2026-09-11 | daily supplier order list |
| `x_collection_item` | 1 | 2026-08-29 | driver collection worksheet |
| `x_collection_task` | 1 | 2026-08-29 | driver collection worksheet |
| `x_complaint` | 1 | 2026-09-02 | customer complaint |
| `x_pricing_config` | 1 | 2026-08-29 | global markup config |
| `x_wa_control` | 1 | 2026-09-17 | WA policy switches |

Note the mirror pattern: every business event has a custom row, and no standard-model row. The GL is empty because none of these rows produce journal entries.

---

## 4. Accounting configuration (what IS set)

- **Company** `utakfresh` — country `Saudi Arabia`, currency `SAR`, chart template `sa`. `account_fiscal_country_id = Saudi Arabia`.
- **Fiscal year end** — month `12`, day `31` (calendar year).
- **Lock dates** — `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`, `purchase_lock_date`, `hard_lock_date` are all `false`. Nothing is locked, which is correct at zero data.
- **Chart of accounts** — 205 accounts, well-typed:

  | account_type | Count |
  |---|---:|
  | `expense` | 90 |
  | `asset_current` | 25 |
  | `liability_current` | 20 |
  | `asset_prepayments` | 17 |
  | `asset_fixed` | 13 |
  | `income` | 12 |
  | `expense_depreciation` | 8 |
  | `asset_receivable` | 4 |
  | `liability_payable` | 4 |
  | `liability_credit_card` | 4 |
  | `expense_direct_cost` | 2 |
  | `liability_non_current` | 2 |
  | `income_other` | 2 |
  | `asset_cash` | 1 |
  | `equity_unaffected` | 1 |

- **Journals** — 11 present, **all with 0 moves**:

  | Code | Type | Name |
  |---|---|---|
  | `INV` | sale | Sales |
  | `BILL` | purchase | Purchases |
  | `BNK1` | bank | Bank |
  | `MISC` | general | Miscellaneous Operations |
  | `CABA` | general | Cash Basis Taxes |
  | `EXCH` | general | Exchange Difference |
  | `IFRS` | general | IFRS 16 Right of Use Asset |
  | `STJ` | general | Inventory Valuation |
  | `TA` | general | Tax Adjustments |
  | `TAX` | general | Tax Returns |
  | `ZAKAT` | general | Zakat |

- **Taxes** — active list includes `15%` sale-side (id 5) and a full purchase-side matrix incl. `15%`, `5%`, `0%`, `EX`, and WHT variants.
- **Payment terms** — 10 seeded terms (Immediate, 15/21/30/45 Days, EOM, mixed splits).
- **Product templates** — 40 templates.
  - `property_account_income_id` set on templates: **0/40**
  - `property_account_expense_id` set on templates: **0/40**
  - Categories cover this: 4/4 categories (`Deliveries`, `Expenses`, `Goods`, `Services`) point to `500001 Sales Account` (income) and `400001 Cost of Goods Sold in Trading` (expense). So the accounting anchor exists at the category level — but no template is unusual, no override needed.
- **Partners** — 19 total (`customer_rank>0`: 7, `supplier_rank>0`: 6). All 19 have both `property_account_receivable_id` and `property_account_payable_id` set (via company defaults).

**Not set:**

- `res.company.vat` = `false` — no 15-digit KSA VAT number on the company (`3xxxxxxxxxxxx03`). ZATCA-compliant invoices require it.
- `res.company.account_sale_tax_id` = `false` and `account_purchase_tax_id` = `false` — no default sale/purchase tax on the company; each product/line has to carry it explicitly or lines will post with no tax.
- `equity` type: 0 accounts (only 1 `equity_unaffected` = Odoo's system "current year earnings"). **No paid-in-capital equity account exists in the chart** — needed for the opening capital entry.

---

## 5. Code map — where every business event is written today

Every row below is a place `src/` calls Odoo `create`/`write`. The point: none of them target the standard accounting models.

| Flow | Written to (current) | Standard target (missing) | Feeds GL now? | Anchor |
|---|---|---|---:|---|
| Daily supplier price capture (`x_daily_price`) | `x_daily_price` | product-level cost / vendor pricelist | ❌ | [src/odoo.ts:706](../src/odoo.ts:706) |
| Daily supplier ask log | `x_supplier_price_request_log` | (bookkeeping only, no GL implication) | ❌ | [src/odoo.ts:619](../src/odoo.ts:619), [src/odoo.ts:650](../src/odoo.ts:650) |
| Customer daily order header | `x_daily_order` | `sale.order` | ❌ | [src/odoo.ts:412](../src/odoo.ts:412), [src/odoo-v6-append.ts:56](../src/odoo-v6-append.ts:56) |
| Customer daily order lines | `x_daily_order_line` | `sale.order.line` | ❌ | [src/odoo.ts:433](../src/odoo.ts:433), [src/odoo-v6-append.ts:73](../src/odoo-v6-append.ts:73) |
| Order state transitions | `x_daily_order` (`x_state` field) | `sale.order` action_confirm / _cancel | ❌ | [src/odoo.ts:490](../src/odoo.ts:490), [src/odoo.ts:920](../src/odoo.ts:920), [src/odoo.ts:1098](../src/odoo.ts:1098) |
| Line unit price edits | `x_daily_order_line` | `sale.order.line.price_unit` | ❌ | [src/odoo.ts:1057](../src/odoo.ts:1057), [src/odoo.ts:2120](../src/odoo.ts:2120) |
| Quotation record (custom) | `x_quotation` | `sale.order` in `sent` state | ❌ | [src/odoo.ts:512](../src/odoo.ts:512), [src/quotation.ts:565](../src/quotation.ts:565) |
| Customer invoice | `x_invoice` | `account.move` (move_type=`out_invoice`) → posted | ❌ | [src/odoo.ts:2038](../src/odoo.ts:2038), [src/odoo.ts:2057](../src/odoo.ts:2057) |
| Payment / receipt | `x_payment` | `account.payment` posted + reconciled to `x_invoice`'s AR line | ❌ | [src/odoo.ts:2110](../src/odoo.ts:2110), [src/receipt.ts:336](../src/receipt.ts:336), [src/index.ts:510](../src/index.ts:510) |
| Purchase list (daily supplier order) | `x_purchase_list` | `purchase.order` posted + vendor bill (`account.move`, move_type=`in_invoice`) | ❌ | [src/odoo.ts:1022](../src/odoo.ts:1022), [src/odoo.ts:1034](../src/odoo.ts:1034), [src/odoo.ts:1044](../src/odoo.ts:1044) |
| Delivery route + stops | `x_delivery_route`, `x_delivery_stop` | `stock.picking` (out) → validated | ❌ | [src/odoo.ts:1285](../src/odoo.ts:1285), [src/odoo.ts:1297](../src/odoo.ts:1297), [src/delivery-note.ts:290](../src/delivery-note.ts:290) |
| Delivery outcome (delivered / issue) | `x_delivery_stop`, `x_daily_order` | `stock.picking.button_validate` | ❌ | [src/odoo.ts:1337](../src/odoo.ts:1337), [src/odoo.ts:1385](../src/odoo.ts:1385) |
| Complaint | `x_complaint` | `crm.lead` (or a helpdesk model) — no GL implication | ❌ | [src/odoo-v6-append.ts:119](../src/odoo-v6-append.ts:119) |
| Standing order | `x_standing_order` (empty) | recurring `sale.order` — no data yet | ❌ | [src/odoo-v6-append.ts:75](../src/odoo-v6-append.ts:75), [src/odoo-v6-append.ts:83](../src/odoo-v6-append.ts:83) |
| Outbound WA send log | `x_wa_message` | (bookkeeping only, no GL implication) | ❌ | [src/wa-message-send.ts:519](../src/wa-message-send.ts:519), [src/index.ts:954](../src/index.ts:954), [src/index.ts:1050](../src/index.ts:1050) |
| Message classifier log | `x_message_analysis` | (bookkeeping only, no GL implication) | ❌ | [src/odoo.ts:558](../src/odoo.ts:558) |
| Partner geo/allowlist mutation | `res.partner` | same | n/a | [src/odoo.ts:716](../src/odoo.ts:716), [src/odoo.ts:1445](../src/odoo.ts:1445), [src/odoo.ts:1531](../src/odoo.ts:1531) |

The only place `src/` reads a standard sales/invoicing model is [src/sale-order-quotation.ts:72](../src/sale-order-quotation.ts:72) (reads `sale.order` created by the Item-1 verify path) and [src/invoice.ts:646](../src/invoice.ts:646) (reads `account.move` for PDF assembly, but the invoice itself was never posted from this codebase — see note below).

Note: [src/invoice.ts:646](../src/invoice.ts:646) suggests an `account.move`-based invoice PDF path, but with `account.move` = 0 rows, this path has never been exercised in production. The runtime path in use is `x_invoice`.

---

## 6. Gaps that prevent Balance Sheet / P&L / Trial Balance

Ordered by structural priority.

### 6.1 No journal entries at all
`account.move.line` = **0**. The GL is empty. Every financial statement in Odoo is a query over `account.move.line`; with zero rows, all three reports render as blank/zero. Until at least one flow starts producing `account.move` rows, no statement will show anything meaningful.

### 6.2 Sales pipeline does not touch `sale.order` / `account.move`
- Custom orders live in `x_daily_order` / `x_daily_order_line`.
- Custom invoices live in `x_invoice`. `x_invoice.create` in [src/odoo.ts:2027](../src/odoo.ts:2027) writes a bare custom row — no `account.move` is created and posted.
- Consequence: revenue is not booked, AR is not booked, VAT-out is not booked.

### 6.3 Payment pipeline does not touch `account.payment`
- Receipts live in `x_payment` ([src/odoo.ts:2093](../src/odoo.ts:2093)).
- No `account.payment` is created, no bank/cash journal entry is posted, no reconciliation against a receivable line happens.
- Consequence: cash-received is not on the balance sheet; there is no way to show unpaid vs. paid on the P&L "Sales" line.

### 6.4 Purchase pipeline does not touch `purchase.order` / vendor bill
- `x_purchase_list` is the actual daily supplier ordering artefact ([src/odoo.ts:1022](../src/odoo.ts:1022)). No `purchase.order`, no vendor bill (`account.move` move_type=`in_invoice`).
- Consequence: COGS is not booked, AP is not booked, purchase VAT-in is not booked.

### 6.5 Inventory pipeline does not touch `stock.picking`
- `x_delivery_route` / `x_delivery_stop` model the driver run, but no `stock.picking` is validated.
- `stock.quant` = 0 → on-hand quantity is not tracked in Odoo at all.
- Consequence: no automated COGS journal from stock valuation; inventory value cannot appear on the balance sheet through Odoo.

### 6.6 Company-level accounting fields not set
- `res.company.vat` is `false`. ZATCA e-invoices require the 15-digit KSA VAT number.
- `res.company.account_sale_tax_id` and `account_purchase_tax_id` are `false`. Default sale/purchase taxes are not set at the company level. As long as every product carries its tax explicitly, this is not blocking — but it is a footgun if any line is created without a tax.

### 6.7 No `equity` (paid-in capital) account
- `equity_unaffected` = 1 (Odoo's automatic "current-year earnings" placeholder).
- `equity` type: **0 accounts**. The KSA chart delivered here does not include a paid-in capital account. Without one, an opening-balance journal for owner capital cannot post to equity.

### 6.8 Cash journal for the driver / owner is not present
- Only one `asset_cash` account exists (bank). Journal `BNK1` is a bank journal. There is no separate cash journal (or cash-in-hand for the driver / collection worksheet).
- Consequence: cash collection by drivers has no destination journal; when payment integration is added, driver-cash will need either a new `cash` journal or a designated cash sub-account and paired journal.

### 6.9 `l10n_sa_edi` (ZATCA Phase-2 e-invoicing) not installed
- KSA VAT-registered sellers must issue ZATCA-compliant e-invoices at posting time. `l10n_sa` (chart of accounts) is installed; `l10n_sa_edi` is not. Once invoices actually start posting to `account.move`, this becomes blocking for compliance.

### 6.10 `hr_expense` not installed
- If owner/driver expenses are meant to hit the P&L via employee expense reports, `hr_expense` is required. Currently there are 0 `hr.employee` rows too, so this is a design decision rather than a gap — but if an expense flow is planned, both need to be added.

### 6.11 No opening balances have been posted
- Even if every future transaction started posting into `account.move` tomorrow, the balance sheet would only show forward activity. Opening balances (starting cash, starting inventory, starting AR/AP, owner capital) have never been posted. This needs a one-time opening-balance journal entry.

---

## 7. What IS in place (so the report doesn't undersell it)

- KSA chart of accounts (`chart_template=sa`), 205 accounts, correctly typed.
- 11 journals seeded (sale, purchase, bank, plus 8 general-purpose ones incl. Zakat, IFRS 16, tax adjustments, tax returns, exchange difference).
- Company set to KSA / SAR, calendar-year fiscal.
- All 4 product categories carry income (`500001`) and expense (`400001`) defaults — so any product posted through a proper sale-order → invoice flow will land on the right accounts without per-product overrides.
- All 19 partners have `property_account_receivable_id` and `property_account_payable_id` set — so any partner posted to `account.move` will land on the right AR/AP account.
- Sale tax `15%` (id 5) and full purchase-side tax matrix exist and are active.
- Payment terms are seeded (10 of them).

The plumbing is there; the code is not writing to it.

---

## 8. Verification checklist for a "GL-connected" milestone

To be answered by a future audit, not by this one:

- [ ] At least one `account.move` in state `posted`, move_type `out_invoice`, for a real customer order.
- [ ] Its `account.move.line` rows include one AR line, one revenue line, one VAT-out line.
- [ ] At least one `account.payment` in state `posted`, reconciled against that AR line.
- [ ] At least one `account.move` posted for a vendor bill (move_type `in_invoice`).
- [ ] At least one `stock.picking` validated (out) and the resulting stock-valuation `account.move` posted through journal `STJ`.
- [ ] An opening-balance `account.move` has been posted to journal `MISC` covering starting cash, starting inventory, and owner capital.
- [ ] `res.company.vat` is set.
- [ ] `l10n_sa_edi` installed and e-invoice submission configured.

---

**End of audit — read-only, no state mutated.**
