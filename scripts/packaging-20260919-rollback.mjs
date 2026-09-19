// Dry-run rollback plan for the 2026-09-19 packaging refactor.
//
// Reads scripts/artifacts/packaging-20260919-rollback.json (the BEFORE
// snapshot) and prints what a live restore would touch — WITHOUT writing
// anything to Odoo.
//
// This script never writes. To actually restore, edit the "DRY_RUN"
// guard below.

import { readFileSync } from "node:fs";

const rollbackPath = new URL("./artifacts/packaging-20260919-rollback.json", import.meta.url).pathname;
const snap = JSON.parse(readFileSync(rollbackPath, "utf8"));
const stamp = new Date().toISOString();

const DRY_RUN = true; // never flip in code; if you need a live restore, ask.

console.log(`packaging rollback — dry-run only — ${stamp}`);
console.log(`Loaded snapshot: ${rollbackPath} (${snap.rows.length} rows, generated ${snap.generated_at})`);

console.log(`\nSteps that a live restore WOULD take:`);
console.log(`  1) Deactivate + delete base.automation rows created in the apply step`);
console.log(`     (identified by name prefix "utak.packaging.").`);
console.log(`  2) Deactivate + delete ir.actions.server rows created in the apply step`);
console.log(`     (identified by name prefix "UTAK Packaging").`);
console.log(`  3) Delete the ir.ui.view rows created in the apply step`);
console.log(`     (identified by name prefix "utak.packaging." or "utak.product.template.list.packaging").`);
console.log(`  4) Delete the ir.model.fields row for x_product_packaging.x_type`);
console.log(`     (also drops its ir.model.fields.selection children).`);
console.log(`  5) For each of ${snap.rows.length} packaging rows, restore the exact BEFORE state:`);
for (const r of snap.rows) {
  console.log(
    `     - id=${r.id} x_name="${r.x_name}" ` +
    `weight=${r.x_approx_weight_kg} ` +
    `default=${r.x_is_default} ` +
    `seq=${r.x_sequence}`
  );
}
console.log(`\nDRY_RUN=${DRY_RUN}; no writes attempted.`);

if (!DRY_RUN) {
  throw new Error("This script is intentionally dry-run only. Ask before flipping DRY_RUN.");
}
