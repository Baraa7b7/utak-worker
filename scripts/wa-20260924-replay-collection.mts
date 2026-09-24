// إعادة محاكاة إرسالات utak_collection_summary الفاشلة (#132018) بعد الإصلاح.
// المدخل: صفوف sim_outbound المقروءة بـ SELECT فقط (ملف JSON من wrangler d1 execute --json).
// لا يرسل شيئاً: يمرر كل طلب على المسار الجديد نفسه (joinCapped ثم sanitizeTemplateBody
// الذي يطبقه fetchMeta) ويتحقق من قواعد Meta.
//
//   npx wrangler d1 execute utak-worker-sim-db --env sim --remote --json \
//     --command "SELECT id, ts_ms, to_number, wamid, raw_request FROM sim_outbound WHERE template_name='utak_collection_summary' ORDER BY id" > /tmp/cs.json
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-20260924-replay-collection.mts /tmp/cs.json
import { readFileSync, writeFileSync } from "node:fs";
import { isInvalidTemplateParam, joinCapped, sanitizeTemplateBody, arabicDate } from "../src/wa-params.ts";

const TEMPLATE_TEXT = "📋 قائمة تحصيل اليوم {{1}}:\n\n{{2}}\n\nإجمالي مطلوب: {{3}} ر.س\nعدد الفواتير: {{4}}\n\nلما تحصّل من أي عميل، افتح رسالة الفاتورة واضغط زر التحصيل.";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))[0].results as Array<{ id: number; ts_ms: number; to_number: string; wamid: string; raw_request: string }>;
const report: unknown[] = [];
let ok = 0;
for (const r of rows) {
  const req = JSON.parse(r.raw_request);
  const params: string[] = req.template.components.flatMap((c: any) => c.parameters ?? []).map((p: any) => p.text);
  // What sendDailyCollectionSummary now builds: {{1}} Arabic date, {{2}} one line.
  const items = String(params[1]).split("\n").filter(Boolean);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : "";
  const rebuilt = [ymd ? arabicDate(ymd) : params[0], joinCapped(items).text, params[2], params[3]];
  const body = { type: "template", template: { name: "utak_collection_summary", components: [{ type: "body", parameters: rebuilt.map((t) => ({ type: "text", text: t })) }] } };
  const { fixes, invalid } = sanitizeTemplateBody(body as any);
  const sent: string[] = (body.template.components[0].parameters as any[]).map((p) => p.text);
  const rendered = sent.reduce((t, p, i) => t.replace(`{{${i + 1}}}`, p), TEMPLATE_TEXT);
  const pass = invalid.length === 0 && sent.every((p) => !isInvalidTemplateParam(p)) && rendered.length <= 1024;
  if (pass) ok++;
  report.push({
    id: r.id, at: new Date(r.ts_ms + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " "), to: `…${r.to_number.slice(-4)}`,
    before: { newlinesIn2: String(params[1]).split("\n").length - 1, len2: String(params[1]).length, wamid: r.wamid.slice(0, 22) },
    after: { param1: sent[0], param2: sent[1], len2: sent[1].length, renderedLen: rendered.length, fixesByGuard: fixes.length },
    verdict: pass ? "مقبول الشكل" : "مرفوض",
  });
}
const out = { at: new Date().toISOString(), total: rows.length, acceptable: ok, rows: report };
writeFileSync(new URL("./artifacts/wa-20260924-replay-collection.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
