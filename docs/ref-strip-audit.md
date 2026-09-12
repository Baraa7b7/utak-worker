# [REF] prefix strip — audit of every touched site

**Problem.** Odoo's default `name_get` for `product.template` (and any other
model with `default_code` / `ref`) returns display strings shaped like
`"[UTAK-VEG-001] طماطم"`. Whenever the Worker reads a many-to-one field
back as the `[id, display_name]` tuple, that internal SKU code leaks into
every customer-facing surface: PDFs, WhatsApp messages, driver routes.

**Fix.** One helper `stripRef(name)` exported from `src/odoo.ts`, applied
at every place a display_name is turned into a user-facing string. Applied
at the **read boundary** so callers never see the prefix, and no downstream
formatter needs to know about it.

```ts
export function stripRef(name: string | undefined | null): string {
  if (!name) return "";
  return name.replace(/^\s*\[[^\]]*\]\s*/, "");
}
```

The regex peels a single leading `[…]` group and its trailing whitespace.
Names without a prefix are returned unchanged.

## Every site the strip is applied at (11 total)

### `src/odoo.ts`

| Line | Function | Field | Purpose |
|---|---|---|---|
| ~404 | `getOrderSummary` | `x_product_tmpl_id[1]` → `.product` | order-line preview |
| ~405 | `getOrderSummary` | `x_packaging_id[1]` → `.packaging` | order-line preview |
| ~890 | `getConfirmedLinesForToday` | `x_customer_id[1]` → `customer_name` | driver route / purchase list header |
| ~893 | `getConfirmedLinesForToday` | `x_product_tmpl_id[1]` → `product_name` | purchase list aggregation, driver stop line summary |
| ~895 | `getConfirmedLinesForToday` | `x_packaging_id[1]` → `packaging_name` | same |
| ~1142 | `buildAndCreateRoutesForDrivers` | `x_product_tmpl_id[1]` → `pname` | per-stop `line_summary` |
| ~1143 | `buildAndCreateRoutesForDrivers` | `x_packaging_id[1]` → `pkname` | same |
| ~1157 | `buildAndCreateRoutesForDrivers` | `x_customer_id[1]` → `custName` | RouteStop.customer_name (WhatsApp header + PDF) |
| ~1659 | `getOrderForInvoicing` | `x_product_tmpl_id[1]` → `product_name` | invoice PDF lines |
| ~1661 | `getOrderForInvoicing` | `x_packaging_id[1]` → `packaging_name` | invoice PDF lines |
| ~1894 | `getUnpaidInvoicesWithCustomer` | `x_customer_id[1]` → `customer_name` | daily collection summary sent to collector |

### `src/delivery-note.ts`

| Line | Function | Field | Purpose |
|---|---|---|---|
| ~179 | `buildDeliveryNoteData` | `x_product_tmpl_id[1]` → `item.name` | delivery-note PDF line items |
| ~180 | `buildDeliveryNoteData` | `x_packaging_id[1]` → `item.pack` | delivery-note PDF line items |

Total: 13 leak sites in 2 files. All patched.

## Not applied (deliberately)

- `x_whatsapp_number`, `phone`, `x_delivery_neighborhood` — raw text fields,
  never carry a `default_code` prefix.
- `fetchSupplierCatalog` in `src/odoo.ts:558` — reads `product.template.name`
  directly via `search_read(fields: ["name"])`, which returns the raw `name`
  field (no prefix). If default_code ever becomes part of the actual `name`
  field, that's a separate bug.
- `product_name_raw` in extracted-order structures — echoes what the
  customer typed, not an Odoo display_name.
- Sonnet catalog serialization (`serializeCatalogForPrompt` in
  `src/claude.ts:107`) — feeds the classifier from `CatalogProduct.name`,
  which is populated from `fetchCatalog` → `search_read` on the raw `name`
  field. Confirmed clean.

## If a new caller adds a many2one read

Rule: any `[id, name][1]` that ends up in an outbound WhatsApp text,
button, or PDF must go through `stripRef`. The alternative (asking Odoo to
return the plain `name` field via `read` instead of the `name_get` tuple)
would also work but is a bigger refactor — one helper at the boundary is
simpler and keeps every helper's shape stable.
