// Official-doc 2026-09-22 — seed 4 canonical templates.
//   1. خطاب بنك — طلب عام
//   2. إفادة / تعريف
//   3. تفويض
//   4. قائمة الدخل التقديرية (with the exact 5 notes and numbers)
//
// Each template lives as x_official_doc(x_is_template=True, x_status='draft')
// with a name-less draft. Duplicating a template ("Duplicate" button in
// Odoo) yields a fresh draft (x_name=False, x_is_template=False because
// x_is_template.copied=False, x_status=False→'draft' default) that the
// operator fills.
//
// Idempotent by x_template_name — reruns skip templates that already exist.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
mkdirSync(dirname(rbPath), { recursive: true });
let rb = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rbPath)) { try { rb = JSON.parse(readFileSync(rbPath, "utf8")); } catch {} }
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }

const TODAY_ISO = new Date().toISOString().slice(0, 10);

// ---------- template definitions ----------

const T_BANK = {
  x_template_name: "خطاب بنك — طلب عام",
  x_doc_type: "letter",
  x_recipient_label: "إلى",
  x_recipient: "[اسم البنك]",
  x_subject: "[موضوع الخطاب]",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "خطاب رسمي" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "السلام عليكم ورحمة الله وبركاته،\nإشارة إلى [الإشارة إن وجدت]، نحيطكم علماً بأننا [اسم الشركة] نطلب منكم [الطلب المحدد].\nنرفق لكم بيانات الشركة أدناه، وسنقوم بتزويدكم بأي مستندات إضافية عند الطلب." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "الاسم الرسمي: [يُقرأ من بيانات الشركة]\nالسجل التجاري: [يُقرأ من بيانات الشركة]\nالرقم الضريبي: [يُقرأ من بيانات الشركة]\nالعنوان: [يُقرأ من بيانات الشركة]\nجهة التواصل: [الاسم]\nالجوال: [الرقم]" },
    { seq: 40, type: "paragraph", tone: "neutral",
      text: "شاكرين لكم حسن تعاونكم، وتقبلوا خالص التحية والتقدير." },
    { seq: 50, type: "signature", tone: "neutral",
      text: "براء الوصابي\nالمدير التنفيذي" },
  ],
};

const T_CERT = {
  x_template_name: "إفادة / تعريف",
  x_doc_type: "certificate",
  x_recipient_label: "إلى من يهمه الأمر",
  x_recipient: "",
  x_subject: "إفادة تعريف",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "إفادة" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "نفيدكم بأن [الاسم] يشغل منصب [المسمى الوظيفي] لدى شركة [اسم الشركة] منذ [التاريخ]، وأن كل ما يتعلق بأدائه لدى الشركة موثق في سجلاتنا الإدارية.\nصدرت هذه الإفادة بناءً على طلبه، ولاستخدامها في [الغرض]، دون أدنى مسؤولية على الشركة." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "الاسم الرسمي: [يُقرأ من بيانات الشركة]\nالسجل التجاري: [يُقرأ من بيانات الشركة]\nالعنوان: [يُقرأ من بيانات الشركة]" },
    { seq: 40, type: "signature", tone: "neutral",
      text: "براء الوصابي\nالمدير التنفيذي" },
  ],
};

const T_AUTH = {
  x_template_name: "تفويض",
  x_doc_type: "authorization",
  x_recipient_label: "إلى",
  x_recipient: "[الجهة المستلمة]",
  x_subject: "تفويض",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "تفويض رسمي" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "نحن شركة [اسم الشركة]، بموجب هذا الخطاب نفوض السيد/السيدة [اسم المفوَّض] — رقم الهوية [رقم الهوية] — بأن ينوب عنا في [نطاق التفويض]، وذلك ابتداءً من [تاريخ البداية] وحتى [تاريخ النهاية]." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "اسم المفوَّض: [الاسم]\nرقم الهوية: [الرقم]\nالصفة: [الصفة]\nالعلاقة بالشركة: [العلاقة]" },
    { seq: 40, type: "notes", tone: "warning",
      text: "هذا التفويض محدد بالنطاق أعلاه ولا يمتد إلى أي إجراء آخر.\nيسقط التفويض بانتهاء المدة أو بإخطار كتابي من الشركة.\nممنوع تفويض الغير في هذا الشأن دون موافقة كتابية من الشركة." },
    { seq: 50, type: "signature", tone: "neutral",
      text: "براء الوصابي\nالمدير التنفيذي" },
  ],
};

// The income-statement rebuilds the current "استمارة المشروع" body using
// blocks. Numbers are UTAK's own projected values for the first 12 months
// after VAT registration — the same rows Baraa uses in the existing paper.
// Notes and totals reproduced verbatim from the current spec.
const T_STATEMENT = {
  x_template_name: "قائمة الدخل التقديرية",
  x_doc_type: "statement",
  x_recipient_label: "إلى",
  x_recipient: "",
  x_subject: "قائمة الدخل التقديرية — لأول ١٢ شهراً من تاريخ التسجيل في ضريبة القيمة المضافة",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "قائمة الدخل التقديرية" },
    { seq: 20, type: "badge", tone: "warning",
      text: "تقديرية — لأول ١٢ شهراً من تاريخ التسجيل في ضريبة القيمة المضافة" },
    // Table: label | monthly | annual. Any row starting with = is a total.
    { seq: 30, type: "table", tone: "neutral",
      text: [
        "البند | شهري (ريال) | سنوي (ريال)",
        "المبيعات | 40,000 | 480,000",
        "تكلفة المبيعات | 30,000 | 360,000",
        "= مجمل الربح | 10,000 | 120,000",
        "الرواتب | 8,000 | 96,000",
        "النقل والتوصيل | 3,000 | 36,000",
        "الإيجار | 1,000 | 12,000",
        "الرسوم الحكومية | 833 | 10,000",
        "التغليف والمواد | 800 | 9,600",
        "الأنظمة والاتصالات | 500 | 6,000",
        "التسويق | 500 | 6,000",
        "مصاريف أخرى | 400 | 4,800",
        "= إجمالي المصاريف التشغيلية | 15,033 | 180,400",
      ].join("\n") },
    { seq: 40, type: "highlight_row", tone: "warning",
      text: "صافي الربح / (الخسارة) المتوقع | (5,033) | (60,400)" },
    { seq: 50, type: "notes", tone: "neutral",
      text: [
        "الأرقام تقديرية بناءً على خطة الشركة للأشهر الاثني عشر الأولى بعد التسجيل في ضريبة القيمة المضافة.",
        "المبيعات تعكس متوسط الطلبات المتوقعة من قنوات UTAK B2B لتوزيع المنتجات الزراعية الطازجة.",
        "تكلفة المبيعات تشمل مشتريات المنتجات من الموردين، مع هامش تشغيلي مبدئي.",
        "المصاريف التشغيلية تقديرية، وقد تختلف بحسب النمو الفعلي وحاجات التشغيل.",
        "صافي الخسارة المتوقع طبيعي لمرحلة الإطلاق، ويعكس الاستثمار في البنية التشغيلية.",
      ].join("\n") },
  ],
};

async function findTemplate(templateName) {
  const rows = await call("x_official_doc", "search_read", {
    domain: [["x_is_template", "=", true], ["x_template_name", "=", templateName]],
    fields: ["id"], limit: 1,
  });
  return rows[0]?.id ?? null;
}

async function seedTemplate(t) {
  const existing = await findTemplate(t.x_template_name);
  if (existing) {
    console.log(`[seed] ${t.x_template_name} exists id=${existing} — skipping`);
    return existing;
  }
  const ids = await call("x_official_doc", "create", { vals_list: [{
    x_is_template: true,
    x_template_name: t.x_template_name,
    x_doc_type: t.x_doc_type,
    x_recipient_label: t.x_recipient_label,
    x_recipient: t.x_recipient,
    x_subject: t.x_subject,
    x_date: TODAY_ISO,
    x_status: "draft",
  }] });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "x_official_doc", id, name: `template:${t.x_template_name}`, action: "create" });
  console.log(`[seed] created template ${t.x_template_name} id=${id}`);
  const blockRows = t.blocks.map((b) => ({
    x_doc_id: id,
    x_sequence: b.seq,
    x_block_type: b.type,
    x_text: b.text,
    x_tone: b.tone,
    x_align_numbers: true,
  }));
  const blockIds = await call("x_official_doc_block", "create", { vals_list: blockRows });
  const blockIdsArr = Array.isArray(blockIds) ? blockIds : [blockIds];
  for (const bid of blockIdsArr) {
    record({ ts: new Date().toISOString(), model: "x_official_doc_block", id: bid, name: `template:${t.x_template_name}:block`, action: "create" });
  }
  console.log(`[seed]   + ${blockIdsArr.length} blocks`);
  return id;
}

async function main() {
  await seedTemplate(T_BANK);
  await seedTemplate(T_CERT);
  await seedTemplate(T_AUTH);
  await seedTemplate(T_STATEMENT);
  console.log("\n[seed] done.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
