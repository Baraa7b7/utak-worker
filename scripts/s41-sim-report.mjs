// § 41 و (2026-09-26) — a simulation run's report as Markdown (for STATUS § 41):
// one table per day (every step, its checks ✓ / ✗, the messages it produced),
// the invoices, the QR, the 21:30 summaries, and the accounting entries that
// ACCOUNTING_SYNC=true WOULD have created (read from the code: src/sale-
// accounting.ts, src/accounting.ts, src/purchase-accounting.ts; nothing written).
//
//   node scripts/s41-sim-report.mjs <run>
//
// Out: scripts/artifacts/s41-sim/<run>/report.md
import { readFileSync, writeFileSync } from "node:fs";

const run = process.argv[2];
if (!run) throw new Error("run id");
const dir = new URL(`./artifacts/s41-sim/${run}/`, import.meta.url);
const r = JSON.parse(readFileSync(new URL("report.json", dir), "utf8"));
const created = JSON.parse(readFileSync(new URL("created.json", dir), "utf8"));
const esc = (s) => String(s ?? "").replace(/\|/g, "／").replace(/\n/g, " ⏎ ");
const r2 = (n) => Math.round(n * 100) / 100;
const out = [];
out.push(`# المحاكاة الشاملة — ${run} (${r.mode})`, "");
out.push(`- الفحوص: **${r.checks.ok}/${r.checks.total}**`, `- الرسائل الملتقطة: ${r.capturedCount} (لم يُرسل منها شيء)`, `- ما أنشأه التشغيل في Odoo: ${Object.entries(r.created).map(([m, n]) => `${m} ${n}`).join("، ")}`, "");
const days = [...new Set(r.steps.map((s) => s.day))];
for (const d of days) {
  out.push(`## ${d}`, "", "| الوقت | الخطوة | الفحوص | الرسائل (المستلم ← القالب أو النوع) |", "|---|---|---|---|");
  for (const s of r.steps.filter((x) => x.day === d)) {
    const cs = r.checks.failed.filter((c) => c.day === d && c.step.startsWith(s.at)).length;
    const all = (r.allChecks ?? []).filter((c) => c.day === d && c.step.startsWith(s.at));
    const mark = s.error ? "✗ خطأ" : cs ? `✗ ${cs}` : all.length ? `✓ ${all.length}` : "—";
    const msgs = s.msgs.map((m) => `${m.to} ← ${m.template ?? m.kind}`).join("، ");
    out.push(`| ${s.at} | ${esc(s.name)} | ${mark} | ${esc(msgs) || "—"} |`);
  }
  out.push("");
}
if (r.checks.failed.length) {
  out.push("## الفحوص التي لم تمر", "");
  for (const c of r.checks.failed) out.push(`- ${c.day} ${esc(c.step)}: ${esc(c.name)} — ${esc(c.detail ?? "")}`.slice(0, 600));
  out.push("");
}
out.push("## الفواتير", "", "| العميل | الرقم | الإصدار (UTC) | الصافي | الضريبة | الإجمالي | الحالة |", "|---|---|---|---|---|---|---|");
for (const i of r.invoices) out.push(`| ${esc(i.customer)} | ${i.x_invoice_number} | ${i.x_issued_at} | ${i.x_subtotal} | ${i.x_tax_amount} | ${i.x_total} | ${i.x_status} |`);
out.push("", "## QR الفاتورة الضريبية", "");
for (const q of r.qrs) out.push(`- ${q.invoice}: البائع «${q.sellerName}»، الرقم ${q.vatNumber}، الوقت ${q.timestamp}، الإجمالي ${q.total}، الضريبة ${q.vatTotal}${q.scannedFromPdf ? "، ومقروء من الصفحة المطبوعة ✓" : ""}`);
out.push("", "## ملخصات 21:30", "");
for (const [d, t] of Object.entries(r.summaries)) out.push(`- **${d}:** ${esc(t)}`);
// the entries ACCOUNTING_SYNC would have made (from the code, per record of the run)
out.push("", "## القيود التي كانت ستُنشأ لو كان ACCOUNTING_SYNC مشغّلاً (قراءة من الكود، لا كتابة)", "");
out.push("| الحدث | المستند في Odoo | مدين | دائن |", "|---|---|---|---|");
out.push("| تأكيد الطلب | `sale.order` مؤكد (بلا قيد، ولا مخزون: منتج خدمة) | — | — |");
for (const i of r.invoices) {
  const vat = Number(i.x_tax_amount) || 0;
  out.push(`| «تم التسليم» ${i.x_invoice_number} | فاتورة عميل \`out_invoice\` من أمر البيع، مرحّلة | 102011 ذمم العملاء ${i.x_total} | 500001 المبيعات ${r2(i.x_total - vat)}${vat ? `، 201017 ضريبة المخرجات ${vat}` : ""} |`);
}
for (const p of r.payments ?? []) {
  out.push(`| تحصيل ${p.method === "cash" ? "نقداً" : "تحويلاً"} ${p.amount} (${p.invoice}) | \`account.payment\` عبر \`account.payment.register\` (${p.method === "cash" ? "CSHD" : "BNK1"})، مسوّاة مع الفاتورة | ${p.method === "cash" ? "101007 كاش السائق" : "101003 مقبوضات معلّقة"} ${p.amount} | 102011 ذمم العملاء ${p.amount} |`);
}
for (const l of r.purchaseLists ?? []) {
  out.push(`| «تم الشراء» قائمة ${l.id} (${l.date}) | \`purchase.order\` مؤكد ← فاتورة مورد \`in_invoice\` مرحّلة (منتج الخدمة UTAK-PUR-GOODS) | 400001 تكلفة البضاعة ${l.net}${l.vat ? `، 104041 ضريبة المدخلات ${l.vat}` : ""} | 201002 الموردون ${l.total} |`);
}
out.push("", "لا خصم في أي منها: الخصم مقفل و`ACCOUNTING_SYNC` مشغّل (§ 40 د) — وكان مقفلاً أصلاً لأن «عدد المحطات» فارغ.", "");
out.push(`## ما أنشأه التشغيل (للوسم)`, "", ...created.created.reduce((a, c) => { a.push(`- ${c.at} ${c.model}: ${c.ids.join(", ")}`); return a; }, []).slice(0, 0), `${Object.entries(r.created).map(([m, n]) => `${m}: ${n}`).join(" · ")}`, "");
writeFileSync(new URL("report.md", dir), out.join("\n") + "\n");
console.log(`report.md (${out.length} lines)`);
