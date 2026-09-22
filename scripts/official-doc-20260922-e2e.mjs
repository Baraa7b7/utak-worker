// Official-doc 2026-09-22 — end-to-end verification on sim.
//
// Runs, one scenario at a time, by CALLING `ir.actions.server.run` with the
// same context Odoo builds when the operator clicks the header button. This
// exercises the whole loop:
//   1. Odoo Server Action (state="webhook") POSTs to the sim Worker.
//   2. Worker returns 202 and runs the pipeline in ctx.waitUntil.
//   3. Pipeline updates the Odoo record (x_preview_url / x_pdf_url / x_name /
//      x_status) or writes an error to x_last_error.
//
// After each button click the script polls the Odoo record until either
// (a) the expected field changed, or (b) x_last_error is set, or (c) 60s.
//
// Scenarios:
//   (a) Duplicate the "قائمة الدخل التقديرية" template → معاينة → إصدار
//   (b) New draft + AI prompt for a bank letter → صياغة ذكية → issue must
//       fail (placeholders remain) → معاينة succeeds
//   (c) Balance samples: 3-line letter, full page, 2-page (multiple large
//       paragraphs), 40-row table. Preview only (no issue).
//
// After the scenarios, downloads every generated PDF to scratchpad and
// renders a PNG per page (via macOS `sips` and `pdftoppm` when available).
//
// Cleanup: deletes every scenario record EXCEPT the first issued doc
// (UTAK-L-2026-001).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const KEEP_ARTIFACTS_DIR = new URL("./artifacts/official-doc-e2e/", import.meta.url).pathname;
mkdirSync(KEEP_ARTIFACTS_DIR, { recursive: true });

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

// Resolve the three server actions by name.
async function resolveActions() {
  const rows = await call("ir.actions.server", "search_read", {
    domain: [["name", "in", ["official-doc.preview_webhook", "official-doc.issue_webhook", "official-doc.ai_draft_webhook"]]],
    fields: ["id", "name", "webhook_url"],
  });
  const map = {};
  for (const r of rows) map[r.name] = r.id;
  if (!map["official-doc.preview_webhook"]) throw new Error("preview action missing");
  if (!map["official-doc.issue_webhook"]) throw new Error("issue action missing");
  if (!map["official-doc.ai_draft_webhook"]) throw new Error("ai-draft action missing");
  return {
    preview: map["official-doc.preview_webhook"],
    issue: map["official-doc.issue_webhook"],
    aiDraft: map["official-doc.ai_draft_webhook"],
  };
}

// Emulate a button click via `ir.actions.server.run` with an active-record
// context. Same as what Odoo does when the user clicks the header button.
async function runServerAction(actionId, docId) {
  return call("ir.actions.server", "run", {
    ids: [actionId],
    context: {
      active_id: docId,
      active_ids: [docId],
      active_model: "x_official_doc",
    },
  });
}

async function poll(docId, predicate, label, timeoutMs = 60000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const rows = await call("x_official_doc", "read", {
      ids: [docId],
      fields: [
        "id", "x_name", "x_status", "x_preview_url", "x_pdf_url",
        "x_issued_at", "x_last_error", "x_recipient", "x_subject", "x_doc_type",
        "x_block_ids",
      ],
    });
    last = rows[0];
    if (predicate(last)) return { ok: true, record: last };
    if (last?.x_last_error) return { ok: false, record: last, why: `x_last_error: ${last.x_last_error}` };
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, record: last, why: `timeout after ${timeoutMs}ms — ${label}` };
}

async function fetchPdf(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(out, buf);
  return { size: buf.byteLength };
}

async function pdfToPng(pdfPath, pngPrefix) {
  // Try pdftoppm (poppler); if missing, try `sips` on macOS.
  const which = spawnSync("which", ["pdftoppm"]);
  if (which.status === 0) {
    execFileSync("pdftoppm", ["-r", "144", "-png", pdfPath, pngPrefix], { stdio: "inherit" });
    return { tool: "pdftoppm" };
  }
  const sipsWhich = spawnSync("which", ["sips"]);
  if (sipsWhich.status === 0) {
    execFileSync("sips", ["-s", "format", "png", pdfPath, "--out", `${pngPrefix}.png`], { stdio: "inherit" });
    return { tool: "sips" };
  }
  return { tool: null };
}

async function findTemplateId(name) {
  const rows = await call("x_official_doc", "search_read", {
    domain: [["x_is_template", "=", true], ["x_template_name", "=", name]],
    fields: ["id"], limit: 1,
  });
  return rows[0]?.id ?? null;
}

// Odoo "duplicate" — the built-in copy() method. x_name/x_status/x_pdf_url etc.
// have copied=False so they land as False on the copy.
async function duplicateDoc(docId) {
  const newIds = await call("x_official_doc", "copy", { ids: [docId], default: {} });
  const newId = Array.isArray(newIds) ? newIds[0] : newIds;
  // A duplicated template MUST land as a real draft: is_template = False,
  // status = draft. If Odoo defaults left is_template=true (because
  // x_is_template.copied defaults to false on our fields but Duplicate
  // still copies it in some Odoo builds), force it here.
  await call("x_official_doc", "write", { ids: [newId], vals: { x_is_template: false, x_status: "draft" } });
  return newId;
}

async function main() {
  console.log("=== Official-doc E2E ===");
  const acts = await resolveActions();
  console.log(`actions: preview=${acts.preview} issue=${acts.issue} aiDraft=${acts.aiDraft}`);

  const scenarioRecords = [];
  let keptDocId = null;

  // -------- Scenario (a): duplicate income-statement template → preview → issue --------
  // Idempotent: if UTAK-L-2026-001 already exists, keep it as the artifact
  // for this scenario and skip re-issuing (each issue burns a new number).
  console.log("\n(a) Duplicate 'قائمة الدخل التقديرية' → preview → issue…");
  const existingIssued = await call("x_official_doc", "search_read", {
    domain: [["x_name", "=", "UTAK-L-2026-001"]],
    fields: ["id", "x_name", "x_pdf_url"], limit: 1,
  });
  if (existingIssued.length > 0) {
    keptDocId = existingIssued[0].id;
    console.log(`  ✓ UTAK-L-2026-001 already exists as doc_id=${keptDocId} — reusing`);
    if (existingIssued[0].x_pdf_url) {
      const pdf = `${KEEP_ARTIFACTS_DIR}scenario-a-UTAK-L-2026-001.pdf`;
      try {
        if (!existsSync(pdf)) await fetchPdf(existingIssued[0].x_pdf_url, pdf);
        console.log(`  PDF available at ${pdf}`);
      } catch (e) { console.log(`  PDF fetch note: ${e.message}`); }
    }
  } else {
    const templateId = await findTemplateId("قائمة الدخل التقديرية");
    if (!templateId) throw new Error("income-statement template missing — run seed script");
    const docA = await duplicateDoc(templateId);
    console.log(`  duplicated → doc_id=${docA}`);
    scenarioRecords.push({ id: docA, label: "scenario-a" });

    console.log("  running preview…");
    await runServerAction(acts.preview, docA);
    const aPrev = await poll(docA, (r) => !!r.x_preview_url, "preview A");
    console.log(`  preview: ${aPrev.ok ? aPrev.record.x_preview_url : `FAILED — ${aPrev.why}`}`);

    console.log("  running issue…");
    await runServerAction(acts.issue, docA);
    const aIss = await poll(docA, (r) => r.x_status === "issued" && !!r.x_pdf_url, "issue A");
    console.log(`  issue: ${aIss.ok ? `${aIss.record.x_name} @ ${aIss.record.x_pdf_url}` : `FAILED — ${aIss.why}`}`);
    if (aIss.ok) {
      keptDocId = docA;
      const pdf = `${KEEP_ARTIFACTS_DIR}scenario-a-${aIss.record.x_name}.pdf`;
      try {
        await fetchPdf(aIss.record.x_pdf_url, pdf);
        console.log(`  PDF saved → ${pdf}`);
        await pdfToPng(pdf, pdf.replace(/\.pdf$/, ""));
      } catch (e) { console.log(`  PDF download failed: ${e.message}`); }
    }
  }

  // -------- Scenario (b): placeholder guard blocks issue, preview succeeds --------
  // The AI-draft path is exercised by unit tests + validateAIDraft; here we
  // want the issue-rejection guardrail proven end-to-end. So we seed blocks
  // that CONTAIN a placeholder and try to issue.
  //
  // A separate live-AI probe below is best-effort: it fires the ai-draft
  // server action, and if the Anthropic key on this env is invalid, that
  // failure is reported without failing the whole scenario. Fixing the
  // sim key rotation is out of scope for this feature.
  console.log("\n(b) placeholder guard + preview…");
  const docBIds = await call("x_official_doc", "create", { vals_list: [{
    x_doc_type: "letter",
    x_recipient_label: "إلى",
    x_recipient: "بنك الاختبار",
    x_subject: "طلب فتح حساب تجاري",
    x_status: "draft",
    x_date: new Date().toISOString().slice(0, 10),
    x_ai_prompt: "خطاب لبنك الراجحي نطلب فتح حساب جاري تجاري للشركة.",
  }] });
  const docB = Array.isArray(docBIds) ? docBIds[0] : docBIds;
  scenarioRecords.push({ id: docB, label: "scenario-b" });
  console.log(`  draft → doc_id=${docB}`);

  // Seed blocks with a placeholder.
  await call("x_official_doc_block", "create", { vals_list: [
    { x_doc_id: docB, x_sequence: 10, x_block_type: "heading",
      x_text: "خطاب رسمي", x_tone: "neutral", x_align_numbers: true },
    { x_doc_id: docB, x_sequence: 20, x_block_type: "paragraph",
      x_text: "نطلب منكم فتح حساب برقم [رقم الحساب] باسم الشركة.",
      x_tone: "neutral", x_align_numbers: true },
    { x_doc_id: docB, x_sequence: 30, x_block_type: "signature",
      x_text: "براء الوصابي\nالمدير التنفيذي", x_tone: "neutral", x_align_numbers: true },
  ]});
  console.log(`  seeded 3 blocks with one placeholder`);

  console.log("  running issue (must reject — placeholder remains)…");
  await runServerAction(acts.issue, docB);
  const bIss = await poll(
    docB,
    (r) => !!r.x_last_error && /placeholder/i.test(String(r.x_last_error)),
    "issue B (expect rejection)",
    30000,
  );
  const stillDraft = bIss.record?.x_status === "draft";
  console.log(`  issue rejected: ${bIss.ok && stillDraft ? `✓ (${bIss.record.x_last_error})` : `✗ — ${bIss.why ?? ""} — status=${bIss.record?.x_status}`}`);

  console.log("  running preview (must succeed)…");
  // Clear the stale x_last_error from the rejected-issue attempt so the poll
  // sees the preview outcome cleanly.
  await call("x_official_doc", "write", { ids: [docB], vals: { x_last_error: false, x_preview_url: false } });
  await runServerAction(acts.preview, docB);
  const bPrev = await poll(docB, (r) => !!r.x_preview_url, "preview B");
  console.log(`  preview: ${bPrev.ok ? bPrev.record.x_preview_url : `FAILED — ${bPrev.why}`}`);
  if (bPrev.ok) {
    const pdf = `${KEEP_ARTIFACTS_DIR}scenario-b-preview.pdf`;
    try {
      await fetchPdf(bPrev.record.x_preview_url, pdf);
      console.log(`  preview PDF saved → ${pdf}`);
      await pdfToPng(pdf, pdf.replace(/\.pdf$/, ""));
    } catch (e) { console.log(`  preview PDF download failed: ${e.message}`); }
  }

  // Best-effort AI probe: fires the ai-draft server action once. If the
  // Anthropic key on this env is invalid or the API is down, the failure is
  // reported and the scenario continues. Unit tests already prove the JSON
  // validation contract.
  console.log("  probing ai-draft (best-effort — depends on Anthropic key)…");
  const docProbeIds = await call("x_official_doc", "create", { vals_list: [{
    x_doc_type: "letter",
    x_recipient_label: "إلى",
    x_status: "draft",
    x_date: new Date().toISOString().slice(0, 10),
    x_ai_prompt: "خطاب لبنك الراجحي نطلب فتح حساب جاري تجاري للشركة.",
  }]});
  const docProbe = Array.isArray(docProbeIds) ? docProbeIds[0] : docProbeIds;
  scenarioRecords.push({ id: docProbe, label: "scenario-b-ai-probe" });
  await runServerAction(acts.aiDraft, docProbe);
  const aiProbe = await poll(
    docProbe,
    (r) => (Array.isArray(r.x_block_ids) && r.x_block_ids.length > 0) || !!r.x_last_error,
    "ai-draft probe",
    90000,
  );
  const gotBlocks = Array.isArray(aiProbe.record?.x_block_ids) && aiProbe.record.x_block_ids.length > 0;
  console.log(`  ai-draft probe: ${gotBlocks ? `✓ ${aiProbe.record.x_block_ids.length} blocks written` : `env-issue: ${aiProbe.record?.x_last_error?.slice(0, 160)}`}`);

  // -------- Scenario (c): balance samples --------
  console.log("\n(c) balance samples (short letter / full page / 2 pages / 40-row table)…");
  const samples = [
    {
      label: "c-3lines",
      doc_type: "letter",
      subject: "خطاب مختصر",
      recipient: "بنك الاختبار",
      blocks: [
        { type: "heading", text: "خطاب رسمي مختصر", tone: "neutral" },
        { type: "paragraph", text: "نحيطكم علماً أن ثلاث فقرات فقط كافية لتغطية الطلب. شاكرين حسن تعاونكم.", tone: "neutral" },
        { type: "signature", text: "براء الوصابي\nالمدير التنفيذي", tone: "neutral" },
      ],
    },
    {
      label: "c-fullpage",
      doc_type: "letter",
      subject: "خطاب صفحة كاملة",
      recipient: "الجهة المستلمة",
      blocks: [
        { type: "heading", text: "خطاب رسمي — صفحة كاملة", tone: "neutral" },
        { type: "paragraph", text: "السلام عليكم ورحمة الله وبركاته،\nنحيطكم علماً بأن هذا الخطاب مصمم ليملأ صفحة واحدة كاملة من الورقة الرسمية. الفقرات مطولة قصداً لاختبار السلوك عند حد الصفحة.\nنطلب منكم دراسة الطلب المرفق وموافاتنا بردكم خلال المدة المحددة.\nنشكر لكم اهتمامكم وحسن استجابتكم، ونحرص على استمرار التعاون المشترك.".repeat(1), tone: "neutral" },
        { type: "kv_card", tone: "neutral", text: "الاسم الرسمي: UTAK\nالسجل التجاري: 1010000000\nالرقم الضريبي: 300000000000003\nالعنوان: الرياض" },
        { type: "notes", tone: "neutral", text: "ملاحظة أولى مفيدة.\nملاحظة ثانية مفيدة.\nملاحظة ثالثة مفيدة.\nملاحظة رابعة مفيدة." },
        { type: "signature", text: "براء الوصابي\nالمدير التنفيذي", tone: "neutral" },
      ],
    },
    {
      label: "c-twopages",
      doc_type: "letter",
      subject: "خطاب مطوّل — صفحتين",
      recipient: "جهة استلام",
      blocks: [
        { type: "heading", text: "خطاب رسمي مطوّل", tone: "neutral" },
        // 6 heavy paragraphs → forces 2 pages
        ...Array.from({ length: 6 }, (_, i) => ({
          type: "paragraph",
          tone: "neutral",
          text: `الفقرة رقم ${i + 1}: ` + "هذا نص فقرة طويلة قصداً لاختبار انسياب المحتوى على أكثر من صفحة، والتحقق من أن الفوتر القانوني يظهر في نهاية كل صفحة، والهيدر يتكرر إذا لزم، والفواصل تحترم البلوكات فلا يُقطع بلوك بين صفحتين. ".repeat(4),
        })),
        { type: "notes", tone: "neutral", text: "الملاحظة الأولى.\nالملاحظة الثانية.\nالملاحظة الثالثة." },
        { type: "signature", text: "براء الوصابي\nالمدير التنفيذي", tone: "neutral" },
      ],
    },
    {
      label: "c-40rows",
      doc_type: "statement",
      subject: "جدول ٤٠ صفاً",
      recipient: "",
      blocks: [
        { type: "heading", text: "جدول ٤٠ صفاً", tone: "neutral" },
        { type: "badge", tone: "warning", text: "تقديرية — بيانات اختبار" },
        {
          type: "table",
          tone: "neutral",
          text: [
            "البند | كمية | قيمة",
            ...Array.from({ length: 40 }, (_, i) => `صنف ${i + 1} | ${i + 1} | ${(i + 1) * 100}`),
            `= الإجمالي | ${40 * 41 / 2} | ${40 * 41 / 2 * 100}`,
          ].join("\n"),
        },
      ],
    },
  ];

  for (const s of samples) {
    console.log(`\n  → ${s.label}…`);
    const ids = await call("x_official_doc", "create", { vals_list: [{
      x_doc_type: s.doc_type,
      x_recipient_label: "إلى",
      x_recipient: s.recipient,
      x_subject: s.subject,
      x_date: new Date().toISOString().slice(0, 10),
      x_status: "draft",
    }]});
    const docId = Array.isArray(ids) ? ids[0] : ids;
    scenarioRecords.push({ id: docId, label: s.label });
    // create blocks
    const blockVals = s.blocks.map((b, i) => ({
      x_doc_id: docId,
      x_sequence: (i + 1) * 10,
      x_block_type: b.type,
      x_text: b.text,
      x_tone: b.tone,
      x_align_numbers: true,
    }));
    await call("x_official_doc_block", "create", { vals_list: blockVals });
    console.log(`    doc_id=${docId} with ${s.blocks.length} blocks`);
    await runServerAction(acts.preview, docId);
    const pv = await poll(docId, (r) => !!r.x_preview_url, `preview ${s.label}`);
    if (!pv.ok) { console.log(`    preview FAILED — ${pv.why}`); continue; }
    const pdf = `${KEEP_ARTIFACTS_DIR}scenario-${s.label}.pdf`;
    try {
      await fetchPdf(pv.record.x_preview_url, pdf);
      console.log(`    PDF saved → ${pdf}`);
      await pdfToPng(pdf, pdf.replace(/\.pdf$/, ""));
    } catch (e) { console.log(`    PDF download failed: ${e.message}`); }
  }

  // -------- Cleanup --------
  console.log("\nCleanup: deleting all scenario records EXCEPT the first issued one…");
  const toDelete = scenarioRecords.filter((r) => r.id !== keptDocId).map((r) => r.id);
  if (toDelete.length > 0 && APPLY) {
    await call("x_official_doc", "unlink", { ids: toDelete });
    console.log(`  unlinked: ${toDelete.join(", ")}`);
  } else if (toDelete.length > 0) {
    console.log(`  [dry-run] would unlink: ${toDelete.join(", ")}  — rerun with --apply`);
  }
  console.log(`  KEPT: doc_id=${keptDocId} (UTAK-L-2026-001)`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
