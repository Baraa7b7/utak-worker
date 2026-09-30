// ترتيب قوالب واتساب في Odoo (2026-09-24): إزالة تكرار x_purpose، وترحيل الأزواج،
// والأسماء العربية. لا يلمس Meta ولا يرسل شيئاً.
//
//   node --experimental-strip-types scripts/wa-templates-20260924-migrate.mjs            (dry-run)
//   node --experimental-strip-types scripts/wa-templates-20260924-migrate.mjs --apply
//
// x_purpose حقل selection إلزامي، فـ«التفريغ» = "other" (قيمة «بلا غرض» التي لا يطلبها الكود).
// كل كتابة تُسجَّل قبلها في scripts/artifacts/wa-templates-20260924-rollback.json،
// والتراجع بـ scripts/wa-templates-20260924-rollback.mjs.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { pickTemplate } from "../src/template-pick.ts";
import { CONTRACT } from "./wa-templates-20260924-purpose-contract.mjs";

const APPLY = process.argv.includes("--apply");
const RB = new URL("./artifacts/wa-templates-20260924-rollback.json", import.meta.url);
const rollback = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { created: new Date().toISOString(), ops: [] };
const FIELDS = ["id", "x_meta_template_id", "x_language", "x_purpose", "x_label_ar", "x_name",
  "x_param_count", "x_meta_status", "x_category"];

async function read(ids) { return call("x_whatsapp_template", "read", { ids, fields: FIELDS }); }
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function write(id, vals, why) {
  await pause(400); // odoo.com rate limiter (429) on long label runs
  const [before] = await read([id]);
  const b = Object.fromEntries(Object.keys(vals).map((k) => [k, before[k]]));
  const same = Object.keys(vals).every((k) => before[k] === vals[k]);
  console.log(`  ${same ? "=" : APPLY ? "✎" : "·"} #${id} ${before.x_meta_template_id}: ${JSON.stringify(b)} → ${JSON.stringify(vals)}  (${why})`);
  if (same || !APPLY) return;
  rollback.ops.push({ ts: new Date().toISOString(), id, name: before.x_meta_template_id, before: b, after: vals, why });
  writeFileSync(RB, JSON.stringify(rollback, null, 2));
  await call("x_whatsapp_template", "write", { ids: [id], vals });
}
async function verifyPurpose(purpose) {
  const rows = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", purpose]], fields: FIELDS });
  const want = CONTRACT[purpose]?.params ?? null;
  const chosen = pickTemplate(rows, () => want);
  const ok = rows.length === 1 && chosen?.x_meta_status === "APPROVED" && (want === null || chosen.x_param_count === want);
  console.log(`    ⇢ verify ${purpose}: rows=${rows.map((r) => `${r.x_meta_template_id}#${r.id}(p=${r.x_param_count},${r.x_category})`).join(", ") || "∅"} → ${chosen?.x_meta_template_id ?? "∅"} ${ok ? "✅" : APPLY ? "❌" : "(dry)"}`);
  if (APPLY && !ok) throw new Error(`verify failed for ${purpose}`);
}

// ---- 1) الأغراض المكررة: يبقى القالب الذي يطابق عدد متغيرات الكود ----
const DEDUP = [
  { purpose: "collection_summary", keep: 11, drop: 42, label: "(قديم) ملخص تحصيل — استخدم: قائمة تحصيل اليوم (للمحصّل)" },
  { purpose: "purchase_list",      keep: 5,  drop: 43, label: "(قديم) قائمة شراء — استخدم: قائمة شراء اليوم (للمستودع)" },
  { purpose: "driver_dispatch",    keep: 7,  drop: 44, label: "(قديم) مسار السائق — استخدم: بداية جولة التوصيل (للسائق)" },
];
// ---- 2) الترحيل: زوج واحد في كل مرة، تفريغ القديم ثم ضبط الجديد ثم التحقق ----
const MIGRATE = [
  { purpose: "customer_delivery_done",     from: 18, to: 60, label: "(قديم) تم التسليم — استخدم: تم التسليم" },
  { purpose: "customer_welcome",           from: 14, to: 53, label: "(قديم) ترحيب عميل جديد — استخدم: ترحيب عميل جديد" },
  { purpose: "customer_order_confirm",     from: 16, to: 65, label: "(قديم) تأكيد الطلب — استخدم: تأكيد الطلب" },
  { purpose: "customer_delivery_incoming", from: 17, to: 61, label: "(قديم) الطلب في الطريق — استخدم: الطلب في الطريق" },
];
// ---- 3) الأسماء العربية: متى تُرسل الرسالة ----
export const LABELS = {
  4: "طلب أسعار اليوم (للمورد)", 5: "قائمة شراء اليوم (للمستودع)", 6: "انتهاء التحميل (للمستودع)",
  7: "بداية جولة التوصيل (للسائق)", 8: "محطة توصيل (للسائق)", 9: "توصيل مع تحصيل (للسائق)",
  10: "طلب تحصيل فاتورة (للمحصّل)", 11: "قائمة تحصيل اليوم (للمحصّل)", 12: "كشف العمولة (للفريق)",
  13: "ملخص اليوم (للمالك)", 15: "تذكير الطلب الثابت لبكرة", 19: "إرسال الفاتورة (نص احتياطي)",
  20: "تذكير دفع بالمبلغ المستحق", 21: "تذكير عميل منقطع (تسويق)", 22: "طلب تقييم بعد التسليم",
  23: "إرسال الفاتورة (PDF)", 24: "تنبيه تشغيلي (للمالك)", 25: "بداية الدوام (للفريق)",
  45: "اختبار Meta (لا يُستخدم)", 46: "تأكيد استلام الأسعار (للمورد)", 47: "طلب شراء جديد (للمورد)",
  48: "تذكير بالأسعار المتأخرة (للمورد)", 49: "ملاحظة جودة على توريد (للمورد)", 50: "تعديل طلب شراء (للمورد)",
  51: "إعادة تنشيط بعرض اليوم (تسويق)", 52: "تنبيه خدمة عام (تسويق)", 53: "ترحيب عميل جديد",
  54: "معالجة ملاحظة العميل", 55: "استلام ملاحظة العميل", 56: "تأكيد استلام دفعة", 57: "تذكير دفع",
  58: "الفاتورة جاهزة (PDF)", 59: "تذكير آخر موعد للطلب", 60: "تم التسليم", 61: "الطلب في الطريق",
  62: "تأخر التوصيل", 63: "صنف ناقص واقتراح بديل", 64: "تحديث على الطلب", 65: "تأكيد الطلب",
  66: "جوكر: متابعة مورد", 67: "جوكر: متابعة عميل", 68: "ملاحظة جودة على طلب شراء (للمورد)",
  69: "تنبيه خدمة على طلب", 70: "متابعة طلب شراء (للمورد)", 71: "متابعة طلب عميل",
};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY-RUN (no writes) ===");
  // sanity: ids ↔ names as inventoried
  const all = await call("x_whatsapp_template", "search_read", { domain: [], fields: FIELDS, limit: 500 });
  const byId = new Map(all.map((r) => [r.id, r]));
  const expect = { 11: "utak_collection_summary", 42: "utak_v2_collection", 5: "utak_purchase_list_v2", 43: "utak_v2_purchase",
    7: "utak_driver_dispatch", 44: "utak_v2_driver_route", 18: "utak_delivery_done", 60: "utak_delivered",
    14: "utak_v2_welcome", 53: "utak_welcome", 16: "utak_v2_order_confirm", 65: "utak_order_confirmed",
    17: "utak_delivery_incoming", 61: "utak_out_for_delivery" };
  for (const [id, n] of Object.entries(expect)) if (byId.get(Number(id))?.x_meta_template_id !== n) throw new Error(`id ${id} ≠ ${n}`);

  console.log("\n[1] dedup");
  for (const d of DEDUP) {
    await write(d.drop, { x_purpose: "other", x_label_ar: d.label, x_name: d.label }, `duplicate ${d.purpose}; keep #${d.keep}`);
    await verifyPurpose(d.purpose);
  }
  console.log("\n[2] migrate");
  for (const m of MIGRATE) {
    const [n] = await read([m.to]);
    const want = CONTRACT[m.purpose].params;
    const pre = n.x_meta_status === "APPROVED" && n.x_category === "UTILITY" && (want === null || n.x_param_count === want);
    console.log(` ${m.purpose}: #${m.from} → #${m.to} ${n.x_meta_template_id} (${n.x_meta_status}, ${n.x_category}, p=${n.x_param_count}, code=${want ?? "no caller"}) ${pre ? "ok" : "BLOCKED"}`);
    if (!pre) continue;
    await write(m.from, { x_purpose: "other", x_label_ar: m.label, x_name: m.label }, `migrate ${m.purpose} step 1: clear old`);
    await write(m.to, { x_purpose: m.purpose }, `migrate ${m.purpose} step 2: set new`);
    await verifyPurpose(m.purpose);
  }
  console.log("\n[3] labels");
  for (const [id, label] of Object.entries(LABELS)) await write(Number(id), { x_label_ar: label, x_name: label }, "label");

  console.log("\n[4] final: one row per used purpose");
  for (const p of Object.keys(CONTRACT)) {
    const rows = (await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", p]], fields: FIELDS }));
    const c = CONTRACT[p];
    const r = rows[0];
    const flag = rows.length === 1 && (c.params === null || r.x_param_count === c.params) ? "✅" : rows.length === 0 ? "∅" : "⚠️";
    console.log(`  ${flag} ${p.padEnd(27)} rows=${rows.length} ${rows.map((x) => `${x.x_meta_template_id}(p=${x.x_param_count},${x.x_category})`).join(", ")} code=${c.params ?? "—"}`);
  }
}
