// إنشاء 21 قالب واتساب في WABA 2144001136512196 عبر Graph v22.0.
//
// يقرأ META_ACCESS_TOKEN من .env.sim-verify. لا يطبع أي token.
// idempotent: يجرد Meta أولاً ويتخطى الأسماء الموجودة (أياً كانت الحالة).
//
// utak_invoice_ready يحوي HEADER DOCUMENT ويستخدم quotation.pdf كمثال — يرفع الملف
// عبر Resumable Upload API لأخذ handle قبل الإنشاء.
//
// Rollback (فرد فرد لكل قالب أنشئ):
//   DELETE https://graph.facebook.com/v22.0/<WABA_ID>/message_templates?name=<name>

import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";

const abs = "/Users/baraa7/utak-worker/.env.sim-verify";
const env = Object.fromEntries(
  readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const TOKEN = env.META_ACCESS_TOKEN;
if (!TOKEN) { console.error("no META_ACCESS_TOKEN"); process.exit(2); }

const WABA = "2144001136512196";
const APP_ID = "2331128704328678";
const V = "v22.0";

// ============================================================
// خريطة القوالب — 21 قالب. اسم تقني، فئة، لغة، مكوّنات، أمثلة.
// ============================================================
const TEMPLATES = [
  {
    name: "utak_followup_customer",
    category: "UTILITY",
    body: "مرحباً {{1}}، لدينا تحديث بخصوص {{2}}. نرجو الرد على هذه الرسالة لنكمل معك. فريق يو تاك",
    example: ["أبو خالد", "طلبك الأخير"],
  },
  {
    name: "utak_followup_supplier",
    category: "UTILITY",
    body: "السلام عليكم {{1}}، نحتاج نتواصل معك بخصوص {{2}}. نرجو الرد على هذه الرسالة. يو تاك",
    example: ["أخي محمد", "أسعار اليوم"],
  },
  {
    name: "utak_order_confirmed",
    category: "UTILITY",
    body: "تم تأكيد طلبك رقم {{1}}، والتوصيل {{2}}. شكراً لاختيارك يو تاك",
    example: ["12345", "بكرة الصباح"],
  },
  {
    name: "utak_order_update",
    category: "UTILITY",
    body: "تحديث على طلبك رقم {{1}}: {{2}}. لأي استفسار رد على هذه الرسالة",
    example: ["12345", "أضفنا البطاطس للطلب"],
  },
  {
    name: "utak_item_shortage",
    category: "UTILITY",
    body: "نعتذر، الصنف {{1}} غير متوفر اليوم في طلبك رقم {{2}}. البديل المقترح: {{3}}. اختر من الأزرار أدناه",
    example: ["طماطم", "12345", "خيار مكانه"],
    buttons: [
      { type: "QUICK_REPLY", text: "موافق على البديل" },
      { type: "QUICK_REPLY", text: "بدون بديل" },
    ],
  },
  {
    name: "utak_delivery_delay",
    category: "UTILITY",
    body: "نعتذر عن تأخر طلبك رقم {{1}}، والوصول المتوقع {{2}}. نقدّر صبرك",
    example: ["12345", "خلال ساعة"],
  },
  {
    name: "utak_out_for_delivery",
    category: "UTILITY",
    body: "طلبك رقم {{1}} في الطريق إليك الآن مع {{2}}. يو تاك",
    example: ["12345", "السائق أحمد"],
  },
  {
    name: "utak_delivered",
    category: "UTILITY",
    body: "تم تسليم طلبك رقم {{1}}. إذا فيه أي ملاحظة على الجودة رد علينا خلال اليوم",
    example: ["12345"],
  },
  {
    name: "utak_order_cutoff",
    category: "UTILITY",
    body: "تذكير: آخر موعد لطلبات الغد الساعة {{1}}. أرسل طلبك الآن لضمان التوصيل",
    example: ["9 مساءً"],
  },
  {
    name: "utak_invoice_ready",
    category: "UTILITY",
    body: "فاتورة طلبك رقم {{1}} بمبلغ {{2}} ريال، وتاريخ الاستحقاق {{3}}. شكراً لتعاملك مع يو تاك",
    example: ["12345", "540", "بعد 7 أيام"],
    documentHeader: true,
    documentFilePath: "/Users/baraa7/utak-worker/quotation.pdf",
  },
  {
    name: "utak_payment_reminder",
    category: "UTILITY",
    body: "تذكير ودي: فاتورة رقم {{1}} بمبلغ {{2}} ريال مستحقة بتاريخ {{3}}. شاكرين تعاونك",
    example: ["12345", "540", "بعد 3 أيام"],
  },
  {
    name: "utak_payment_received",
    category: "UTILITY",
    body: "استلمنا دفعتك بمبلغ {{1}} ريال على فاتورة {{2}}. شكراً لك",
    example: ["540", "12345"],
  },
  {
    name: "utak_complaint_received",
    category: "UTILITY",
    body: "استلمنا ملاحظتك على طلب رقم {{1}}، وسنعود لك خلال {{2}}. يو تاك",
    example: ["12345", "ساعتين"],
  },
  {
    name: "utak_complaint_resolved",
    category: "UTILITY",
    body: "تمت معالجة ملاحظتك على طلب رقم {{1}}: {{2}}. نشكرك على إبلاغنا",
    example: ["12345", "استبدلنا الصنف التالف بديل طازج"],
  },
  {
    name: "utak_welcome",
    category: "UTILITY",
    body: "أهلاً {{1}}، تم تفعيل حسابك في يو تاك. اطلب مباشرة من هنا، وآخر موعد للطلب يومياً الساعة {{2}}. حياك",
    example: ["أبو خالد", "9 مساءً"],
  },
  {
    name: "utak_service_notice",
    category: "UTILITY",
    body: "تنبيه: {{1}} بتاريخ {{2}}. نعتذر عن أي إزعاج",
    example: ["إجازة عيد الفطر — لا توصيل", "2026-04-01"],
  },
  {
    name: "utak_reactivate",
    category: "MARKETING",
    body: "اشتقنا لك {{1}}! عندنا اليوم {{2}}. اطلب الآن ويوصلك بكرة",
    example: ["أبو خالد", "طماطم طازة بسعر ممتاز"],
  },
  {
    name: "utak_supplier_price_nudge",
    category: "UTILITY",
    // ملاحظة: النص لا يبدأ بمتغير — Meta ترفض ذلك في القوالب العربية.
    body: "أهلاً {{1}}، لم تصلنا أسعارك اليوم بعد. نحتاجها قبل الساعة {{2}} لو سمحت",
    example: ["أخي محمد", "3 مساءً"],
  },
  {
    name: "utak_po_confirmed",
    category: "UTILITY",
    // ملاحظة: النص أطول لتخفيف نسبة المتغيرات — Meta ترفض القوالب القصيرة ذات المتغيرات الكثيرة.
    body: "لديك طلب شراء جديد من يو تاك رقم {{1}}. البنود المطلوبة: {{2}}. موعد الاستلام {{3}}. نرجو التأكيد باختيار أحد الأزرار أدناه",
    example: ["PO-100", "10 كراتين طماطم و5 كراتين خيار", "بكرة صباحاً"],
    buttons: [
      { type: "QUICK_REPLY", text: "تأكيد" },
      { type: "QUICK_REPLY", text: "لا أستطيع" },
    ],
  },
  {
    name: "utak_po_changed",
    category: "UTILITY",
    body: "تعديل على طلب الشراء رقم {{1}}: {{2}}. نرجو التأكيد",
    example: ["PO-100", "الكمية 15 بدل 10"],
    buttons: [
      { type: "QUICK_REPLY", text: "تأكيد" },
    ],
  },
  {
    name: "utak_quality_issue",
    category: "UTILITY",
    body: "ملاحظة جودة على توريد {{1}}: {{2}}. نحتاج نتفق على المعالجة",
    example: ["PO-100", "الطماطم فيها 4 كراتين متعبة"],
  },
];

// ============================================================
// جرد Meta أولاً
// ============================================================
async function graph(path, opts = {}) {
  const url = `https://graph.facebook.com/${V}${path}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) };
  return fetch(url, { ...opts, headers });
}

const existing = new Set();
{
  let url = `/${WABA}/message_templates?fields=name,status,category,language&limit=200`;
  for (let p = 0; p < 10 && url; p++) {
    const r = await graph(url);
    const t = await r.text();
    if (!r.ok) { console.error(`inventory failed HTTP ${r.status}: ${t.slice(0,400)}`); process.exit(2); }
    const j = JSON.parse(t);
    for (const x of j.data ?? []) existing.add(x.name);
    const next = j.paging?.next;
    if (!next) { url = null; break; }
    // paging.next هو URL كامل — نجعله path
    url = next.replace(`https://graph.facebook.com/${V}`, "");
  }
}
console.log(`Meta موجود عنده الآن: ${existing.size} قالب`);

// ============================================================
// دالة رفع PDF (resumable upload) — تعطي handle
// ============================================================
async function uploadPdfHandle(filePath) {
  const size = statSync(filePath).size;
  // 1) بدء جلسة رفع
  const start = await fetch(
    `https://graph.facebook.com/${V}/${APP_ID}/uploads?file_length=${size}&file_type=application/pdf&access_token=${encodeURIComponent(TOKEN)}`,
    { method: "POST" },
  );
  const startTxt = await start.text();
  if (!start.ok) throw new Error(`upload session start HTTP ${start.status}: ${startTxt.slice(0,300)}`);
  const startJson = JSON.parse(startTxt);
  const sessionId = startJson.id; // upload:XXX
  if (!sessionId) throw new Error(`no session id: ${startTxt.slice(0,300)}`);

  // 2) رفع الملف كامل في POST واحد (يعمل حتى ~25MB)
  const fd = openSync(filePath, "r");
  const buf = Buffer.alloc(size);
  readSync(fd, buf, 0, size, 0);
  closeSync(fd);

  const up = await fetch(
    `https://graph.facebook.com/${V}/${sessionId}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${TOKEN}`,
        "file_offset": "0",
      },
      body: buf,
    },
  );
  const upTxt = await up.text();
  if (!up.ok) throw new Error(`upload chunk HTTP ${up.status}: ${upTxt.slice(0,300)}`);
  const upJson = JSON.parse(upTxt);
  if (!upJson.h) throw new Error(`no handle returned: ${upTxt.slice(0,300)}`);
  return upJson.h;
}

// ============================================================
// إنشاء قالب واحد
// ============================================================
async function createTemplate(tpl) {
  const components = [];

  if (tpl.documentHeader) {
    const handle = await uploadPdfHandle(tpl.documentFilePath);
    components.push({
      type: "HEADER",
      format: "DOCUMENT",
      example: { header_handle: [handle] },
    });
  }

  const bodyComp = { type: "BODY", text: tpl.body };
  if (tpl.example && tpl.example.length > 0) {
    bodyComp.example = { body_text: [tpl.example] };
  }
  components.push(bodyComp);

  if (tpl.buttons && tpl.buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: tpl.buttons });
  }

  const body = {
    name: tpl.name,
    language: "ar",
    category: tpl.category,
    allow_category_change: true,
    components,
  };

  const r = await graph(`/${WABA}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) {
    return { ok: false, error: `HTTP ${r.status}: ${txt.slice(0,500)}` };
  }
  const j = JSON.parse(txt);
  return { ok: true, id: j.id, status: j.status, category: j.category };
}

// ============================================================
// اللوب الرئيسي
// ============================================================
const report = [];
for (const tpl of TEMPLATES) {
  if (existing.has(tpl.name)) {
    console.log(`[skip] ${tpl.name} — موجود مسبقاً`);
    report.push({ name: tpl.name, status: "موجود مسبقاً" });
    continue;
  }
  process.stdout.write(`[create] ${tpl.name} ... `);
  try {
    const r = await createTemplate(tpl);
    if (r.ok) {
      console.log(`OK id=${r.id} status=${r.status} category=${r.category}`);
      report.push({ name: tpl.name, status: r.status, category: r.category, id: r.id });
    } else {
      console.log(`FAIL ${r.error}`);
      report.push({ name: tpl.name, status: "FAIL", error: r.error });
    }
  } catch (e) {
    console.log(`EXC ${e.message}`);
    report.push({ name: tpl.name, status: "EXCEPTION", error: e.message });
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(JSON.stringify(report, null, 2));
