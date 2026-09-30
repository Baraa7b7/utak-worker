// تراجع ترتيب قوالب واتساب (2026-09-24). dry-run افتراضياً: يطبع فقط.
//   node scripts/wa-templates-20260924-rollback.mjs            (يطبع)
//   node scripts/wa-templates-20260924-rollback.mjs --apply    (يكتب القيم السابقة بترتيب عكسي)
// ملاحظة: الكود على sim يختار متغيرات القالب حسب اسمه، فالتراجع آمن دون إعادة نشر.
import { readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
const APPLY = process.argv.includes("--apply");
const rb = JSON.parse(readFileSync(new URL("./artifacts/wa-templates-20260924-rollback.json", import.meta.url), "utf8"));
for (const op of [...rb.ops].reverse()) {
  console.log(`${APPLY ? "✎" : "·"} #${op.id} ${op.name}: → ${JSON.stringify(op.before)}  (undo: ${op.why})`);
  if (APPLY) {
    await call("x_whatsapp_template", "write", { ids: [op.id], vals: op.before });
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log(`${rb.ops.length} ops ${APPLY ? "reverted" : "(dry-run)"}`);
