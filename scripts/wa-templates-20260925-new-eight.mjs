// القوالب الثمانية الجديدة (2026-09-25): إنشاؤها عند Meta، وتسجيلها في Odoo بغرض other.
//
//   node --experimental-strip-types scripts/wa-templates-20260925-new-eight.mjs                 (dry-run: النصوص والفحوص فقط)
//   node --experimental-strip-types scripts/wa-templates-20260925-new-eight.mjs --meta          (POST للقوالب الناقصة فقط)
//   node --experimental-strip-types scripts/wa-templates-20260925-new-eight.mjs --odoo          (قيم x_purpose + سجلات Odoo)
//   node --experimental-strip-types scripts/wa-templates-20260925-new-eight.mjs --odoo-rollback (حذف ما أنشأه --odoo فقط)
//
// Meta: الطلب الوحيد الكاتب هو POST /message_templates لقالب غير موجود بالاسم. لا حذف ولا تعديل.
//   idempotent: يجرد Meta أولاً ويتخطى أي اسم موجود (بأي حالة).
//   إعادة الصياغة: إن رُفض قالب أو صُنّف MARKETING يُنشأ بديله `retry` مرة واحدة (اسم جديد، لأن
//   الاسم المرفوض لا يُعاد استخدامه). القالب الأول يبقى كما هو.
// Odoo: كل إنشاء يُسجَّل قبله في scripts/artifacts/wa-templates-20260925-new-eight-odoo-rollback.json.
// لا إرسال واتساب لأي رقم.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// المواصفة: النص، والأمثلة، والأزرار، وما يرسله الكود (العدد والترتيب ومرجعه).
// `audience`: customer/supplier = عامية خفيفة + «يو تاك» إلزامي؛ internal/finance = فصحى.
// `replaces`: القالب القديم الذي يفرغ غرضه عند الترحيل (null = غرض جديد بلا قالب سابق).
// ---------------------------------------------------------------------------
export const NEW_EIGHT = [
  {
    key: "supplier_ask",
    name: "utak_supplier_ask_v2",
    purpose: "supplier_ask",
    replaces: "utak_supplier_daily_ask",
    audience: "supplier",
    label: "طلب أسعار اليوم (للمورد)",
    body: "صباح الخير {{1}}، معك يو تاك. نحتاج أسعارك اليوم لهالأصناف: {{2}}. يا ليت ترد بسعر كل صنف وتعبئته (مثال: طماطم كرتون 25 ريال)، والله يعطيك العافية.",
    example: ["أحمد حسان", "طماطم، خيار، بطاطس، خس"],
    buttons: [],
    code: { params: ["اسم المورد", "قائمة الأصناف بسطر واحد"], where: "src/suppliers.ts:143 (supplierAskParams في src/templates.ts)", payloads: [] },
    retry: {
      name: "utak_supplier_price_ask_v1",
      body: "صباح الخير {{1}}، معك يو تاك. نبغى أسعار اليوم للأصناف التالية: {{2}}. رد علينا بسعر كل صنف وتعبئته (مثال: طماطم كرتون 25 ريال)، وشكراً لك.",
    },
  },
  {
    key: "owner_alert",
    name: "utak_owner_alert_v2",
    purpose: "owner_alert",
    replaces: "utak_owner_alert",
    audience: "internal",
    label: "تنبيه تشغيلي (للمالك)",
    body: "تنبيه تشغيلي من نظام يو تاك: {{1}} — يرجى مراجعة التفاصيل واتخاذ الإجراء المناسب.",
    example: ["قائمة شراء اليوم لم تُؤكَّد حتى الآن"],
    buttons: [],
    code: { params: ["نص التنبيه بسطر واحد"], where: "src/templates.ts:254 (sendOwnerAlert)", payloads: [] },
    retry: {
      name: "utak_ops_alert_v1",
      body: "تنبيه من نظام التشغيل في يو تاك بخصوص: {{1}} — يرجى المراجعة واتخاذ الإجراء اللازم.",
    },
  },
  {
    key: "team_shift_start",
    name: "utak_shift_start_v2",
    purpose: "team_shift_start",
    replaces: "utak_shift_start",
    audience: "internal",
    label: "بداية الدوام (للفريق)",
    body: "مرحباً {{1}}، مهامك في يو تاك لهذا اليوم جاهزة. اضغط زر «بدء الدوام» أدناه لاستلام التفاصيل والمواقع.",
    example: ["عمر"],
    buttons: [{ type: "QUICK_REPLY", text: "بدء الدوام" }],
    code: { params: ["اسم الموظف"], where: "src/team.ts:407", payloads: ["shift_start"] },
    retry: {
      name: "utak_shift_ready_v1",
      body: "مرحباً {{1}}، تم تجهيز مهام يو تاك الخاصة بك لهذا اليوم. يرجى الضغط على «بدء الدوام» لاستلام التفاصيل والمواقع.",
    },
  },
  {
    key: "customer_daily_remind",
    name: "utak_standing_remind_v2",
    purpose: "customer_daily_remind",
    replaces: "utak_v2_daily_remind",
    audience: "customer",
    label: "تذكير الطلب الثابت لبكرة",
    body: "مساء الخير {{1}}، قائمتك الثابتة عند يو تاك جاهزة لطلب بكرة. تحب نرسلها مثل ما هي، أو تعدّل عليها؟",
    example: ["مطعم الوادي"],
    buttons: [{ type: "QUICK_REPLY", text: "تمام أرسلوها" }, { type: "QUICK_REPLY", text: "أبغى أعدّل" }],
    code: { params: ["اسم العميل"], where: "src/standing.ts:27", payloads: ["standing_confirm_<id>", "standing_edit_<id>"] },
    retry: {
      name: "utak_standing_order_remind_v1",
      body: "مساء الخير {{1}}، طلبك الثابت عند يو تاك جاهز لتوصيل بكرة. نعتمده مثل ما هو، أو تحب تعدّل عليه قبل الإقفال؟",
    },
  },
  {
    key: "customer_pay_remind",
    name: "utak_pay_remind_v3",
    purpose: "customer_pay_remind",
    replaces: "utak_v2_pay_remind",
    audience: "finance",
    label: "تذكير دفع بالمبلغ المستحق",
    body: "تذكير من يو تاك: عزيزنا {{1}}، يوجد على حسابكم مبلغ مستحق قدره {{2}} ريال. نأمل التكرم بسداده في أقرب وقت، ولأي استفسار يسعدنا ردكم على هذه الرسالة.",
    example: ["مطعم الوادي", "1250.00"],
    buttons: [],
    code: { params: ["اسم العميل", "مجموع المستحق (toFixed(2))"], where: "src/outreach.ts:81", payloads: [] },
    retry: {
      name: "utak_balance_due_v1",
      body: "إشعار من يو تاك: عزيزنا {{1}}، رصيد حسابكم المستحق حالياً {{2}} ريال عن فواتير سابقة. نأمل سداده في أقرب وقت، ولأي استفسار يسعدنا ردكم على هذه الرسالة.",
    },
  },
  {
    key: "customer_quotation_pdf",
    name: "utak_quotation_pdf_v1",
    purpose: "customer_quotation_pdf",
    replaces: null,
    audience: "finance",
    label: "إرسال عرض السعر (PDF)",
    body: "مرحباً {{1}}، مرفق عرض السعر رقم {{2}} من يو تاك بتاريخ {{3}}، بإجمالي {{4}} ريال. الأسعار سارية حتى موعد إقفال الطلبات في يوم الإصدار، ولأي استفسار يسعدنا ردكم على هذه الرسالة.",
    example: ["مطعم الوادي", "QUO-2026-0032", "24 سبتمبر 2026", "480"],
    documentHeader: true,
    buttons: [],
    code: { params: ["اسم العميل", "رقم العرض", "التاريخ", "الإجمالي"], where: "src/quotation.ts:590 (quotationTemplateParams، src/quotation.ts:415)", payloads: [] },
    retry: {
      name: "utak_quotation_doc_v1",
      body: "مرحباً {{1}}، بناءً على طلبكم نرفق عرض السعر رقم {{2}} من يو تاك بتاريخ {{3}}، وإجماليه {{4}} ريال. العرض ساري حتى موعد إقفال الطلبات في يوم الإصدار.",
    },
  },
  {
    key: "customer_order_remind",
    name: "utak_order_confirm_remind_v1",
    purpose: "customer_order_remind",
    replaces: null,
    audience: "customer",
    label: "تذكير تأكيد الطلب قبل الإقفال",
    body: "تذكير من يو تاك: طلبك رقم {{1}} لسه ما تأكد، ويُلغى تلقائياً الساعة {{2}}. اضغط «تأكيد الطلب» عشان يدخل طلبات اليوم، أو «إلغاء» لو ما تحتاجه.",
    example: ["#1234", "9:00 مساءً"],
    buttons: [{ type: "QUICK_REPLY", text: "تأكيد الطلب" }, { type: "QUICK_REPLY", text: "إلغاء" }],
    code: { params: ["#رقم الطلب", "موعد الإقفال (cutoffLabel)"], where: "src/team.ts:79 (notifyOrderCustomer، remind)", payloads: ["confirm_order_<id>", "cancel_order_<id>"] },
    retry: {
      name: "utak_order_pending_remind_v1",
      body: "تنبيه من يو تاك: طلبك رقم {{1}} بانتظار تأكيدك، ولو ما تأكد يُلغى تلقائياً الساعة {{2}}. اختر «تأكيد الطلب» أو «إلغاء» من الأزرار تحت.",
    },
  },
  {
    key: "purchase_list_remind",
    name: "utak_purchase_list_remind_v1",
    purpose: "purchase_list_remind",
    replaces: null,
    audience: "internal",
    label: "تذكير قائمة الشراء غير المؤكدة (للمستودع)",
    body: "تذكير من يو تاك: قائمة شراء يوم {{1}} لم يُضغط فيها على «تم الشراء» حتى الآن، وعدد أصنافها {{2}}. يرجى الضغط على الزر أدناه بعد إتمام الشراء، أو الرد على هذه الرسالة إن وُجدت مشكلة.",
    example: ["25 سبتمبر 2026", "12"],
    buttons: [{ type: "QUICK_REPLY", text: "تم الشراء" }],
    code: { params: ["تاريخ القائمة بالعربية", "عدد الأصناف"], where: "src/team.ts:332 (sendPurchaseListReminder)", payloads: ["purchase_done_<id>"] },
    retry: {
      name: "utak_purchase_pending_v1",
      body: "تنبيه من يو تاك: قائمة الشراء ليوم {{1}} ما زالت بانتظار التأكيد، وعدد أصنافها {{2}}. يرجى الضغط على «تم الشراء» بعد إتمام الشراء، أو الرد على هذه الرسالة عند وجود مشكلة.",
    },
  },
];

/** Selection values the code calls that may be missing from x_whatsapp_template.x_purpose. */
export const NEW_PURPOSES = [
  { value: "customer_quotation_pdf", name: "Customer quotation (PDF)" },
  { value: "customer_order_remind", name: "Customer order confirm reminder (20:00)" },
  { value: "purchase_list_remind", name: "Purchase list reminder (06:00)" },
];

// ---------------------------------------------------------------------------
// فحوص النص (تستخدمها الاختبارات أيضاً)
// ---------------------------------------------------------------------------
export function placeholders(body) {
  return [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}
export function textProblems(t, body = t.body) {
  const p = [];
  const ph = placeholders(body);
  const n = new Set(ph).size;
  if (ph.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(",")) p.push(`placeholders not 1..n in order: ${ph}`);
  if (/^\s*\{\{\d+\}\}/.test(body)) p.push("starts with a variable");
  if (/\{\{\d+\}\}[\s.،!؟?]*$/.test(body)) p.push("ends with a variable");
  if (t.example.length !== n) p.push(`example has ${t.example.length}, body has ${n}`);
  if (t.code.params.length !== n) p.push(`code sends ${t.code.params.length}, body has ${n}`);
  if (t.code.payloads.length > t.buttons.length) p.push(`code sets ${t.code.payloads.length} payloads, template has ${t.buttons.length} buttons`);
  if (!body.includes("يو تاك")) p.push("no «يو تاك»");
  if (/بدون انقطاع/.test(body)) p.push("«بدون انقطاع»");
  if (/[\n\t]/.test(body) || / {4,}/.test(body)) p.push("newline/tab/4+ spaces");
  if (body.length > 1024) p.push("body > 1024");
  for (const b of t.buttons) if (b.text.length > 25) p.push(`button > 25: ${b.text}`);
  if (!/^[a-z0-9_]+$/.test(t.name) || (t.retry && !/^[a-z0-9_]+$/.test(t.retry.name))) p.push("bad name");
  return p;
}

// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const META = process.argv.includes("--meta");
  const ODOO = process.argv.includes("--odoo");
  const ODOO_RB = process.argv.includes("--odoo-rollback");
  const env = Object.fromEntries(
    readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const TOKEN = env.META_ACCESS_TOKEN;
  const WABA = "2144001136512196", APP_ID = "2331128704328678", V = "v22.0";
  const META_REPORT = new URL("./artifacts/wa-templates-20260925-new-eight-meta.json", import.meta.url);
  const ODOO_RBF = new URL("./artifacts/wa-templates-20260925-new-eight-odoo-rollback.json", import.meta.url);

  let bad = 0;
  for (const t of NEW_EIGHT) {
    const p = [...textProblems(t), ...(t.retry ? textProblems(t, t.retry.body).map((x) => `retry: ${x}`) : [])];
    console.log(`${p.length ? "❌" : "✅"} ${t.name} [${t.purpose}] ${t.code.params.length} var(s) @ ${t.code.where}${p.length ? " — " + p.join("; ") : ""}`);
    bad += p.length;
  }
  if (bad) { console.error(`${bad} text problem(s) — nothing sent`); process.exit(1); }

  async function metaInventory() {
    const out = new Map();
    let url = `https://graph.facebook.com/${V}/${WABA}/message_templates?limit=100&fields=id,name,language,status,category,components,rejected_reason`;
    while (url) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!r.ok) throw new Error(`meta GET HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      for (const x of j.data ?? []) out.set(x.name, x);
      url = j.paging?.next ?? null;
    }
    return out;
  }
  async function uploadPdfHandle(filePath) {
    const buf = readFileSync(filePath);
    const start = await fetch(`https://graph.facebook.com/${V}/${APP_ID}/uploads?file_length=${buf.length}&file_type=application/pdf&access_token=${encodeURIComponent(TOKEN)}`, { method: "POST" });
    const sj = await start.json();
    if (!start.ok || !sj.id) throw new Error(`upload start HTTP ${start.status}: ${JSON.stringify(sj).slice(0, 300)}`);
    const up = await fetch(`https://graph.facebook.com/${V}/${sj.id}`, { method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, file_offset: "0" }, body: buf });
    const uj = await up.json();
    if (!up.ok || !uj.h) throw new Error(`upload HTTP ${up.status}: ${JSON.stringify(uj).slice(0, 300)}`);
    return uj.h;
  }
  async function create(t, name, body) {
    const components = [];
    if (t.documentHeader) components.push({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [await uploadPdfHandle(new URL("../quotation.pdf", import.meta.url).pathname)] } });
    components.push({ type: "BODY", text: body, example: { body_text: [t.example] } });
    if (t.buttons.length) components.push({ type: "BUTTONS", buttons: t.buttons });
    const r = await fetch(`https://graph.facebook.com/${V}/${WABA}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, language: "ar", category: "UTILITY", components }),
    });
    const txt = await r.text();
    return r.ok ? { ok: true, ...JSON.parse(txt) } : { ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 600)}` };
  }
  const needsRetry = (m) => m && (m.status === "REJECTED" || m.category === "MARKETING");

  if (META) {
    const report = existsSync(META_REPORT) ? JSON.parse(readFileSync(META_REPORT, "utf8")) : { runs: [] };
    const run = { at: new Date().toISOString(), created: [], skipped: [], failed: [], retried: [] };
    let inv = await metaInventory();
    console.log(`\nMeta: ${inv.size} template(s) before`);
    for (const t of NEW_EIGHT) {
      if (inv.has(t.name)) { console.log(`[skip] ${t.name} exists (${inv.get(t.name).status}/${inv.get(t.name).category})`); run.skipped.push(t.name); continue; }
      const r = await create(t, t.name, t.body);
      console.log(`[create] ${t.name} → ${r.ok ? `id=${r.id} status=${r.status} category=${r.category}` : r.error}`);
      (r.ok ? run.created : run.failed).push({ name: t.name, ...r });
    }
    // Meta answers the POST before its review; read the state back, then reword once where needed.
    await new Promise((res) => setTimeout(res, 20000));
    inv = await metaInventory();
    for (const t of NEW_EIGHT) {
      const m = inv.get(t.name);
      const failed = run.failed.find((f) => f.name === t.name);
      if (!(needsRetry(m) || failed) || !t.retry) continue;
      if (inv.has(t.retry.name)) { console.log(`[skip] retry ${t.retry.name} exists`); continue; }
      const why = failed ? failed.error : `${m.status}/${m.category}${m.rejected_reason ? " " + m.rejected_reason : ""}`;
      const r = await create(t, t.retry.name, t.retry.body);
      console.log(`[retry] ${t.name} (${why}) → ${t.retry.name}: ${r.ok ? `id=${r.id} status=${r.status} category=${r.category}` : r.error}`);
      run.retried.push({ from: t.name, why, name: t.retry.name, ...r });
    }
    if (run.retried.length) { await new Promise((res) => setTimeout(res, 15000)); inv = await metaInventory(); }
    run.after = NEW_EIGHT.flatMap((t) => [t.name, t.retry?.name]).filter((n) => inv.has(n))
      .map((n) => ({ name: n, id: inv.get(n).id, status: inv.get(n).status, category: inv.get(n).category, rejected_reason: inv.get(n).rejected_reason }));
    report.runs.push(run);
    writeFileSync(META_REPORT, JSON.stringify(report, null, 2));
    console.log("\nstate:");
    for (const a of run.after) console.log(`  ${a.name}: ${a.status} / ${a.category}${a.rejected_reason && a.rejected_reason !== "NONE" ? " — " + a.rejected_reason : ""}`);
  }

  if (ODOO || ODOO_RB) {
    const { call } = await import("./lib/odoo-cli.mjs");
    const [field] = await call("ir.model.fields", "search_read", {
      domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]], fields: ["id", "ttype"],
    });
    if (!field || field.ttype !== "selection") throw new Error("x_purpose selection field not found");
    const rb = existsSync(ODOO_RBF) ? JSON.parse(readFileSync(ODOO_RBF, "utf8")) : { created: new Date().toISOString(), selections: [], rows: [] };
    const save = () => writeFileSync(ODOO_RBF, JSON.stringify(rb, null, 2));

    if (ODOO_RB) {
      for (const r of [...rb.rows].reverse()) {
        const [cur] = await call("x_whatsapp_template", "read", { ids: [r.id], fields: ["x_purpose", "x_meta_template_id"] });
        if (!cur) continue;
        if (cur.x_purpose !== "other") { console.log(`keep #${r.id} ${cur.x_meta_template_id}: purpose ${cur.x_purpose} (run the migrate rollback first)`); continue; }
        await call("x_whatsapp_template", "unlink", { ids: [r.id] });
        console.log(`unlinked #${r.id} ${r.name}`);
      }
      for (const s of rb.selections) {
        const used = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", s.value]] });
        if (used) { console.log(`keep selection ${s.value}: ${used} row(s) use it`); continue; }
        await call("ir.model.fields.selection", "unlink", { ids: [s.id] });
        console.log(`removed selection ${s.value} #${s.id}`);
      }
      process.exit(0);
    }

    for (const p of NEW_PURPOSES) {
      const ex = await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", field.id], ["value", "=", p.value]], fields: ["id"] });
      if (ex.length) { console.log(`= selection ${p.value} exists #${ex[0].id}`); continue; }
      const id = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: field.id, value: p.value, name: p.name }] });
      rb.selections.push({ value: p.value, id: Array.isArray(id) ? id[0] : id }); save();
      console.log(`+ selection ${p.value} #${rb.selections.at(-1).id}`);
    }
    const inv = await metaInventory();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    for (const t of NEW_EIGHT) {
      for (const [name, isRetry] of [[t.name, false], [t.retry?.name, true]]) {
        const m = name && inv.get(name);
        if (!m) continue;
        const ex = await call("x_whatsapp_template", "search_read", { domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]], fields: ["id", "x_purpose"] });
        if (ex.length) { console.log(`= #${ex[0].id} ${name} exists (purpose ${ex[0].x_purpose})`); continue; }
        const comps = m.components ?? [];
        const body = comps.find((c) => c.type === "BODY")?.text ?? "";
        const buttons = (comps.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b, i) => `[${i}] ${b.type} — ${b.text}`).join("\n");
        const label = isRetry ? `${t.label} (صياغة ثانية)` : t.label;
        const [id] = await call("x_whatsapp_template", "create", { vals_list: [{
          x_meta_template_id: name, x_language: "ar", x_meta_id: m.id, x_meta_status: m.status, x_category: m.category,
          x_body: body, x_param_count: new Set(placeholders(body)).size, x_buttons: buttons, x_last_synced: now,
          x_missing_in_meta: false, x_label_ar: label, x_name: label, x_purpose: "other",
        }] }, { probe: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]] });
        rb.rows.push({ id, name }); save();
        console.log(`+ #${id} ${name} «${label}» purpose=other status=${m.status}/${m.category}`);
      }
    }
  }
  if (!META && !ODOO && !ODOO_RB) console.log("\n(dry-run) add --meta to create at Meta, --odoo to register in Odoo");
}
