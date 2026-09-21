// إنشاء 4 قوالب خدمية مرتبطة بمعاملة على WABA 2144001136512196 (Graph v22.0).
//
// المميز عن wa-templates-20260921-create.mjs:
//   - القوالب هنا كلها UTILITY ومرتبطة برقم معاملة (طلب / طلب شراء).
//   - النصوص أطول لتخفيف نسبة المتغيرات ولا تبدأ/تنتهي بمتغير.
//   - إذا رُفض قالب: يعيد المحاولة مرة واحدة فقط بصياغة alt، ثم يتوقف.
//   - إذا اعتمد Meta القالب لكن صنّفه MARKETING: لا يعيد المحاولة، يسجّل ذلك.
//
// idempotent: يجرد Meta أولاً ويتخطى الأسماء الموجودة.
// لا يطبع أي token.
//
// Rollback (فرد فرد):
//   DELETE https://graph.facebook.com/v22.0/<WABA_ID>/message_templates?name=<name>

import { readFileSync } from "node:fs";

const abs = "/Users/baraa7/utak-worker/.env.sim-verify";
const env = Object.fromEntries(
  readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const TOKEN = env.META_ACCESS_TOKEN;
if (!TOKEN) { console.error("no META_ACCESS_TOKEN"); process.exit(2); }

const WABA = "2144001136512196";
const V = "v22.0";

// ============================================================
// القوالب الأربعة — النصوص بالحرف كما في السبك، مع أمثلة لكل متغير.
// alt = صياغة بديلة نستخدمها مرة واحدة فقط لو رُفض القالب.
// ============================================================
const TEMPLATES = [
  {
    name: "utak_followup_order",
    category: "UTILITY",
    body: "مرحباً {{1}}، لدينا تحديث بخصوص طلبك رقم {{2}} لدى يو تاك. نرجو الرد على هذه الرسالة حتى نكمل معك التفاصيل. شكراً لك",
    example: ["أبو خالد", "12345"],
    alt: "مرحباً {{1}}، لدينا تحديث نودّ مشاركته معك بخصوص طلبك رقم {{2}} الخاص بيو تاك. يرجى الرد على هذه الرسالة كي نكمل معك التفاصيل ونجيب على أي استفسار. شكراً لك",
  },
  {
    name: "utak_followup_po",
    category: "UTILITY",
    body: "السلام عليكم {{1}}، لدينا تحديث بخصوص طلب الشراء رقم {{2}} من يو تاك. نرجو الرد على هذه الرسالة حتى نكمل معك التفاصيل. شكراً لك",
    example: ["أخي محمد", "PO-100"],
    alt: "السلام عليكم {{1}}، لدينا تحديث نودّ مشاركته معك بخصوص طلب الشراء رقم {{2}} الصادر من يو تاك. يرجى الرد على هذه الرسالة كي نكمل معك التفاصيل. شكراً لك",
  },
  {
    name: "utak_order_service_notice",
    category: "UTILITY",
    body: "تنبيه بخصوص توصيل طلبك رقم {{1}} لدى يو تاك: {{2}}. نعتذر عن أي إزعاج، ونحن متاحون للرد على أي استفسار",
    example: ["12345", "تأخر السائق بسبب زحمة الطريق"],
    alt: "تنبيه خدمة يتعلق بتوصيل طلبك رقم {{1}} لدى يو تاك، والتفاصيل: {{2}}. نعتذر عن أي إزعاج قد يسببه ذلك، وفريقنا جاهز للرد على أي استفسار",
  },
  {
    name: "utak_po_quality_issue",
    category: "UTILITY",
    body: "لدينا ملاحظة جودة على طلب الشراء رقم {{1}} المورَّد إلى يو تاك، والتفاصيل: {{2}}. نحتاج نتفق معك على طريقة المعالجة",
    example: ["PO-100", "الطماطم فيها كرتونان متعبان"],
    alt: "نودّ إبلاغك بأن لدينا ملاحظة جودة على طلب الشراء رقم {{1}} الذي وُرِّد إلى يو تاك. تفاصيل الملاحظة: {{2}}. نحتاج نتفق معك على طريقة المعالجة",
  },
];

async function graph(path, opts = {}) {
  const url = `https://graph.facebook.com/${V}${path}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) };
  return fetch(url, { ...opts, headers });
}

// ---- جرد Meta ----
const existing = new Map(); // name → { status, category }
{
  let url = `/${WABA}/message_templates?fields=name,status,category,language&limit=200`;
  for (let p = 0; p < 10 && url; p++) {
    const r = await graph(url);
    const t = await r.text();
    if (!r.ok) { console.error(`inventory failed HTTP ${r.status}: ${t.slice(0,400)}`); process.exit(2); }
    const j = JSON.parse(t);
    for (const x of j.data ?? []) existing.set(x.name, { status: x.status, category: x.category });
    url = j.paging?.next ? j.paging.next.replace(`https://graph.facebook.com/${V}`, "") : null;
  }
}
console.log(`Meta موجود عنده الآن: ${existing.size} قالب`);

// ---- إنشاء قالب واحد ----
async function createOne({ name, category, body, example }) {
  const bodyComp = { type: "BODY", text: body };
  if (example && example.length > 0) bodyComp.example = { body_text: [example] };
  const payload = {
    name, language: "ar", category, allow_category_change: true,
    components: [bodyComp],
  };
  const r = await graph(`/${WABA}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${txt.slice(0,500)}` };
  const j = JSON.parse(txt);
  return { ok: true, id: j.id, status: j.status, category: j.category };
}

// ---- اللوب الرئيسي مع إعادة صياغة مرة واحدة عند الرفض ----
const report = [];
for (const tpl of TEMPLATES) {
  if (existing.has(tpl.name)) {
    const e = existing.get(tpl.name);
    console.log(`[skip] ${tpl.name} — موجود مسبقاً (status=${e.status}, category=${e.category})`);
    report.push({ name: tpl.name, action: "موجود مسبقاً", meta_status: e.status, meta_category: e.category });
    continue;
  }
  process.stdout.write(`[try1] ${tpl.name} ... `);
  const r1 = await createOne(tpl);
  if (r1.ok) {
    console.log(`OK id=${r1.id} status=${r1.status} category=${r1.category}`);
    report.push({
      name: tpl.name, action: "أُنشئ",
      meta_status: r1.status, meta_category: r1.category, id: r1.id,
      note: r1.category !== "UTILITY" ? "Meta أعادت تصنيفه" : null,
    });
    continue;
  }
  console.log(`FAIL ${r1.error}`);
  process.stdout.write(`[try2 alt] ${tpl.name} ... `);
  const r2 = await createOne({ ...tpl, body: tpl.alt });
  if (r2.ok) {
    console.log(`OK id=${r2.id} status=${r2.status} category=${r2.category}`);
    report.push({
      name: tpl.name, action: "أُنشئ بعد إعادة صياغة",
      meta_status: r2.status, meta_category: r2.category, id: r2.id,
      reason_first_rejection: r1.error,
      note: r2.category !== "UTILITY" ? "Meta أعادت تصنيفه" : null,
    });
    continue;
  }
  console.log(`FAIL2 ${r2.error}`);
  report.push({
    name: tpl.name, action: "فشل مرتين",
    error_first: r1.error, error_second: r2.error,
  });
}

console.log(`\n=== SUMMARY ===`);
console.log(JSON.stringify(report, null, 2));
