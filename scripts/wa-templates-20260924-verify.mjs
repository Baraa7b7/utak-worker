// تحقق قراءة فقط (2026-09-24): كل ثابت T.* و TMPL_* له عقد، وكل غرض مستخدم له قالب واحد
// معتمد بعدد متغيرات يطابق الكود، ولا غرض مكرر في Odoo.
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-templates-20260924-verify.mjs
import { call } from "./lib/odoo-cli.mjs";
import { T } from "../src/templates.ts";
import { TMPL_SUPPLIER_ASK, TMPL_SUPPLIER_CONFIRM } from "../src/config.ts";
import { pickTemplate, findDuplicatePurposes } from "../src/template-pick.ts";
import { CONTRACT } from "./wa-templates-20260924-purpose-contract.mjs";

let bad = 0;
const constants = [...Object.values(T), TMPL_SUPPLIER_ASK, TMPL_SUPPLIER_CONFIRM];
for (const p of constants) if (!(p in CONTRACT)) { console.log(`❌ constant ${p} missing from contract`); bad++; }
const rows = await call("x_whatsapp_template", "search_read", {
  domain: [], limit: 500,
  fields: ["id", "x_meta_template_id", "x_language", "x_purpose", "x_param_count", "x_meta_status", "x_category"],
});
const dups = findDuplicatePurposes(rows);
console.log(Object.keys(dups).length ? `❌ duplicate purposes: ${JSON.stringify(dups)}` : "✅ no duplicate x_purpose");
if (Object.keys(dups).length) bad++;
const knownGaps = { customer_quotation_pdf: "no Meta template and not in the x_purpose selection — text+link fallback (quotation.ts:593)" };
for (const p of constants) {
  const c = CONTRACT[p];
  const cand = rows.filter((r) => r.x_purpose === p);
  const t = pickTemplate(cand, () => c?.params ?? null);
  const ok = cand.length === 1 && t.x_meta_status === "APPROVED" && (c?.params == null || t.x_param_count === c.params);
  if (!ok && knownGaps[p]) { console.log(`⚠️  ${p}: ${knownGaps[p]}`); continue; }
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${p.padEnd(27)} → ${t ? `${t.x_meta_template_id} (p=${t.x_param_count}, ${t.x_category})` : "∅"}  code=${c?.params ?? "—"} @ ${c?.where}`);
}
console.log(bad ? `\n${bad} problem(s)` : "\nALL OK");
process.exit(bad ? 1 : 0);
