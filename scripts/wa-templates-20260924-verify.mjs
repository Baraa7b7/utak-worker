// تحقق قراءة فقط (2026-09-24): كل ثابت T.* و TMPL_* له عقد، وكل غرض مستخدم له قالب واحد
// معتمد بعدد متغيرات يطابق الكود، ولا غرض مكرر في Odoo.
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-templates-20260924-verify.mjs
import { call } from "./lib/odoo-cli.mjs";
import { T } from "../src/templates.ts";
import { TMPL_SUPPLIER_ASK, TMPL_SUPPLIER_CONFIRM } from "../src/config.ts";
import { pickTemplate, findDuplicatePurposes } from "../src/template-pick.ts";
import { CONTRACT, contractParams } from "./wa-templates-20260924-purpose-contract.mjs";

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
// 2026-09-25 — until Meta approves the new templates and
// wa-templates-20260925-migrate-when-approved.mjs maps them, these purposes
// have no row and the code falls back (text+link / utak_order_update / purchase list).
const knownGaps = {
  customer_quotation_pdf: "not mapped yet (utak_quotation_pdf_v1 pending) — text+link fallback",
  customer_order_remind: "not mapped yet (utak_order_confirm_remind_v1 pending) — falls back to customer_order_update",
  purchase_list_remind: "not mapped yet (utak_purchase_list_remind_v1 pending) — falls back to purchase_list",
  // 2026-09-25 (STATUS § 34) — «فتح المحادثة»: mapped at creation; the gateway
  // uses a row only once it is APPROVED and UTILITY (team / owner were filed
  // MARKETING by Meta: never used, the messages stay held).
  conv_open_customer: "utak_update_customer mapped, not APPROVED+UTILITY yet — no opener until it is",
  conv_open_team: "utak_update_team mapped, not APPROVED+UTILITY — no opener (team messages stay held)",
  conv_open_supplier: "utak_update_supplier mapped, not APPROVED+UTILITY yet — no opener until it is",
  conv_open_owner: "utak_update_owner mapped, not APPROVED+UTILITY — no opener (the 06:00 message stays Baraa's opener)",
  owner_team_note: "text only (no template) — held outside Baraa's window",
};
for (const p of constants) {
  const c = CONTRACT[p];
  const cand = rows.filter((r) => r.x_purpose === p);
  const t = pickTemplate(cand, (name) => contractParams(p, name));
  const want = t ? contractParams(p, t.x_meta_template_id) : null;
  const ok = cand.length === 1 && t.x_meta_status === "APPROVED" && (want == null || t.x_param_count === want)
    && (!p.startsWith("conv_open_") || t.x_category === "UTILITY");
  if (!ok && knownGaps[p]) { console.log(`⚠️  ${p}: ${knownGaps[p]}`); continue; }
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${p.padEnd(27)} → ${t ? `${t.x_meta_template_id} (p=${t.x_param_count}, ${t.x_category})` : "∅"}  code=${want ?? "—"} @ ${c?.where}`);
}
console.log(bad ? `\n${bad} problem(s)` : "\nALL OK");
process.exit(bad ? 1 : 0);
