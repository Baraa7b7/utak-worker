// ح3 (2026-09-24): ربط القالب المعتمد utak_order_update (#64، UTILITY، متغيران)
// بغرض جديد customer_order_update، ليستخدمه تذكير 20:00 وإشعار إلغاء 21:00
// خارج نافذة 24 ساعة. لا يلمس Meta ولا يرسل شيئاً.
//
//   node --experimental-strip-types scripts/wa-20260924-order-update-purpose.mjs            (dry-run)
//   node --experimental-strip-types scripts/wa-20260924-order-update-purpose.mjs --apply
//   node --experimental-strip-types scripts/wa-20260924-order-update-purpose.mjs --rollback
//
// قبل أي كتابة تُحفظ لقطة في scripts/artifacts/wa-20260924-order-update-rollback.json.
// التراجع: يعيد x_purpose للقالب إلى قيمته السابقة ثم يحذف قيمة الاختيار إن كانت من إنشائنا.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { pickTemplate } from "../src/template-pick.ts";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const RB = new URL("./artifacts/wa-20260924-order-update-rollback.json", import.meta.url);
const TEMPLATE_ID = 64;
const PURPOSE = "customer_order_update";
const LABEL = "Customer order update (reminder / cancel notice)";
const FIELDS = ["id", "x_meta_template_id", "x_purpose", "x_param_count", "x_meta_status", "x_category"];

const [field] = await call("ir.model.fields", "search_read", {
  domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]],
  fields: ["id", "ttype"],
});
if (!field || field.ttype !== "selection") throw new Error("x_whatsapp_template.x_purpose selection field not found");

async function verify() {
  const rows = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", PURPOSE]], fields: FIELDS });
  const chosen = pickTemplate(rows, () => 2);
  const ok = rows.length === 1 && chosen?.id === TEMPLATE_ID && chosen.x_meta_status === "APPROVED" && chosen.x_param_count === 2;
  console.log(`verify ${PURPOSE}: rows=${rows.map((r) => `${r.x_meta_template_id}#${r.id}(p=${r.x_param_count},${r.x_category},${r.x_meta_status})`).join(", ") || "∅"} → ${ok ? "✅" : "❌"}`);
  return ok;
}

if (ROLLBACK) {
  if (!existsSync(RB)) throw new Error("no rollback file");
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  console.log(`rollback: #${TEMPLATE_ID} x_purpose → ${rb.before.x_purpose}`);
  await call("x_whatsapp_template", "write", { ids: [TEMPLATE_ID], vals: { x_purpose: rb.before.x_purpose } });
  if (rb.createdSelectionId) {
    const left = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", PURPOSE]] });
    if (left === 0) {
      await call("ir.model.fields.selection", "unlink", { ids: [rb.createdSelectionId] });
      console.log(`rollback: removed selection value ${PURPOSE} #${rb.createdSelectionId}`);
    } else console.log(`rollback: ${left} row(s) still use ${PURPOSE} — selection value kept`);
  }
  const [after] = await call("x_whatsapp_template", "read", { ids: [TEMPLATE_ID], fields: FIELDS });
  console.log("after rollback:", JSON.stringify(after));
  process.exit(0);
}

const [before] = await call("x_whatsapp_template", "read", { ids: [TEMPLATE_ID], fields: FIELDS });
console.log("before:", JSON.stringify(before));
if (before.x_meta_template_id !== "utak_order_update") throw new Error(`#${TEMPLATE_ID} is ${before.x_meta_template_id}, expected utak_order_update`);
if (before.x_meta_status !== "APPROVED" || before.x_param_count !== 2) throw new Error("template not APPROVED/2 params");
const existingSel = await call("ir.model.fields.selection", "search_read", {
  domain: [["field_id", "=", field.id], ["value", "=", PURPOSE]], fields: ["id"],
});
const users = existingSel.length
  ? await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", PURPOSE]], fields: FIELDS })
  : [];
console.log(`selection ${PURPOSE}: ${existingSel.length ? "exists #" + existingSel[0].id : "missing"}; rows using it: ${users.length}`);
if (users.some((u) => u.id !== TEMPLATE_ID)) throw new Error("another template already uses this purpose — resolve first");

if (!APPLY) {
  console.log("(dry-run) would create the selection value if missing and set #64 x_purpose =", PURPOSE);
  process.exit(0);
}

const rb = { created: new Date().toISOString(), templateId: TEMPLATE_ID, before, createdSelectionId: null };
writeFileSync(RB, JSON.stringify(rb, null, 2));
if (!existingSel.length) {
  const id = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: field.id, value: PURPOSE, name: LABEL }] });
  rb.createdSelectionId = Array.isArray(id) ? id[0] : id;
  writeFileSync(RB, JSON.stringify(rb, null, 2));
  console.log(`created selection ${PURPOSE} #${rb.createdSelectionId}`);
}
await call("x_whatsapp_template", "write", { ids: [TEMPLATE_ID], vals: { x_purpose: PURPOSE } });
rb.after = { x_purpose: PURPOSE };
writeFileSync(RB, JSON.stringify(rb, null, 2));
if (!(await verify())) throw new Error("verify failed — run --rollback");
