// Cleanup 2026-09-19 — DRY-RUN rollback plan.
//
// This script NEVER writes to Odoo. It reads the operations log from
// scripts/artifacts/cleanup-20260919-rollback.json and prints the exact
// mutations that would reverse them, in reverse order. If you want to
// actually execute a rollback, hand-run the printed Odoo calls, or add
// --execute (deliberately not implemented here).

import { readFileSync } from "node:fs";

const path = new URL("./artifacts/cleanup-20260919-rollback.json", import.meta.url).pathname;
const rb = JSON.parse(readFileSync(path, "utf8"));
const ops = rb.operations ?? [];
console.log(`Cleanup rollback plan — ${ops.length} operation(s) recorded on ${rb.generated_at}`);
console.log(`Runs in DRY-RUN ONLY. No mutations sent.`);

for (const op of [...ops].reverse()) {
  console.log(`\n[${op.ts ?? "-"}] ${op.model} id=${op.id} action=${op.action}`);
  if (op.action?.startsWith?.("create") || op.action === "create") {
    console.log(`  UNDO: ${op.model}.unlink([${op.id}])`);
    continue;
  }
  if (op.before === null || op.before === undefined) {
    console.log(`  UNDO: (no snapshot — likely a create; would ${op.model}.unlink([${op.id}]))`);
    continue;
  }
  console.log(`  UNDO: ${op.model}.write([${op.id}], vals=${JSON.stringify(op.before)})`);
}

console.log(`\n${ops.length} operation(s). No side effects performed.`);
