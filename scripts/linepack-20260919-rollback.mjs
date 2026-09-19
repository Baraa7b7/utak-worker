// Dry-run rollback for linepack-20260919 operations. Prints undo calls; sends none.
// Reads scripts/artifacts/linepack-20260919-rollback.json.

import { readFileSync } from "node:fs";

const path = new URL("./artifacts/linepack-20260919-rollback.json", import.meta.url).pathname;
const j = JSON.parse(readFileSync(path,"utf8"));
console.log(`linepack-20260919 rollback plan (${j.operations.length} operations) — DRY RUN, no writes`);
console.log(`Rollback file: ${path}\n`);

const ops = j.operations.slice().reverse(); // undo in reverse order
for (const op of ops) {
  const stamp = op.ts ?? "?";
  if (op.action === "write") {
    console.log(`[${stamp}] ${op.model}.write ids=[${op.id}] BEFORE=${JSON.stringify(op.before)}`);
    console.log(`  UNDO:  call("${op.model}","write",{ids:[${op.id}],vals:${JSON.stringify(op.before)}})`);
  } else if (op.action === "unlink") {
    console.log(`[${stamp}] ${op.model}.unlink ids=[${op.id}] (draft record was deleted)`);
    console.log(`  UNDO:  re-create with vals: ${JSON.stringify(op.before)}`);
  } else if (op.action === "create") {
    console.log(`[${stamp}] ${op.model}.create id=${op.id} name="${op.name ?? ""}"`);
    console.log(`  UNDO:  call("${op.model}","unlink",{ids:[${op.id}]})`);
  } else {
    console.log(`[${stamp}] unknown action ${op.action}: ${JSON.stringify(op)}`);
  }
}

console.log(`\n(To roll back, review the plan above and run manually.)`);
