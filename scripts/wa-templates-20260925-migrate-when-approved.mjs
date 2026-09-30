// ترحيل الأغراض إلى القوالب الثمانية الجديدة بعد اعتماد Meta (2026-09-25). يُشغَّل يدوياً.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-templates-20260925-migrate-when-approved.mjs            (dry-run)
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-templates-20260925-migrate-when-approved.mjs --apply
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-templates-20260925-migrate-when-approved.mjs --rollback [--apply]
//
// لكل قالب وحده: GET من Meta (قراءة فقط)، ثم يُنقل الغرض فقط إن كان القالب APPROVED وUTILITY، وعدد
// متغيراته يطابق ما يرسله الكود لهذا الاسم (العقد)، وعدد أزراره يطابق المواصفة. غير ذلك يُتخطى.
// إن رُفض القالب الأول وأُنشئت صياغته الثانية (retry) واعتُمدت، تُستخدم الثانية.
// الترتيب لكل غرض: تحديث حالة السجل الجديد من Meta ← تفريغ القديم (other + «(قديم) …») ← ضبط الجديد ← تحقق.
// idempotent: غرض منقول سابقاً = «=» بلا كتابة. كل كتابة تُسجَّل قبلها في
// scripts/artifacts/wa-templates-20260925-migrate-rollback.json، و--rollback يعيدها بترتيب عكسي.
// الكود يختار المتغيرات حسب اسم القالب، فالتراجع يعمل دون إعادة نشر. لا إرسال واتساب، ولا كتابة عند Meta.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { NEW_EIGHT, placeholders, specFor } from "./wa-templates-20260925-new-eight.mjs";
import { contractParams } from "./wa-templates-20260924-purpose-contract.mjs";

const nVars = (body) => new Set(placeholders(body ?? "")).size;
const bodyOf = (m) => (m.components ?? []).find((c) => c.type === "BODY")?.text ?? "";
const buttonsOf = (m) => (m.components ?? []).find((c) => c.type === "BUTTONS")?.buttons ?? [];
const headerOf = (m) => (m.components ?? []).find((c) => c.type === "HEADER")?.format ?? null;

/** Why `m` (a Meta template) cannot carry `t.purpose` yet — null when it can. */
function blocker(t, m) {
  if (!m) return "missing at Meta";
  if (m.status !== "APPROVED") return `status ${m.status}`;
  if (m.category !== "UTILITY") return `category ${m.category}`;
  // 2026-09-25 — a retry may carry other variables than the first wording:
  // the spec, the contract and Meta must all agree for this name.
  const want = contractParams(t.purpose, m.name);
  const have = nVars(bodyOf(m));
  const spec = specFor(m.name)?.code.params.length;
  if (want == null || have !== want || have !== spec) return `variables: Meta ${have}, code ${want ?? "?"}, spec ${spec ?? "?"}`;
  const btn = buttonsOf(m).length;
  if (btn !== t.buttons.length) return `buttons: Meta ${btn}, spec ${t.buttons.length}`;
  if (Boolean(t.documentHeader) !== (headerOf(m) === "DOCUMENT")) return `header: Meta ${headerOf(m) ?? "none"}`;
  return null;
}

/** Pure: Meta inventory (name → template) → one decision per new template. */
export function planMigration(inv) {
  return NEW_EIGHT.map((t) => {
    const names = [t.name, t.retry?.name].filter(Boolean);
    const why = [];
    for (const n of names) {
      const b = blocker(t, inv.get(n));
      if (!b) return { key: t.key, purpose: t.purpose, action: "move", to: n, from: t.replaces, label: specFor(n).label };
      if (inv.has(n) || n === t.name) why.push(`${n}: ${b}`);
    }
    return { key: t.key, purpose: t.purpose, action: "skip", why: why.join("; ") };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const APPLY = process.argv.includes("--apply");
  const ROLLBACK = process.argv.includes("--rollback");
  const { call } = await import("./lib/odoo-cli.mjs");
  const { pickTemplate } = await import("../src/template-pick.ts");
  const RB = new URL("./artifacts/wa-templates-20260925-migrate-rollback.json", import.meta.url);
  const LABELS = new URL("../src/wa-template-labels.json", import.meta.url);
  const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { created: new Date().toISOString(), ops: [] };
  const FIELDS = ["id", "x_meta_template_id", "x_language", "x_purpose", "x_label_ar", "x_name", "x_param_count", "x_meta_status", "x_category"];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  if (ROLLBACK) {
    for (const op of [...rb.ops].reverse()) {
      console.log(`${APPLY ? "✎" : "·"} #${op.id} ${op.name}: → ${JSON.stringify(op.before)}  (undo: ${op.why})`);
      if (APPLY) { await call("x_whatsapp_template", "write", { ids: [op.id], vals: op.before }); await pause(400); }
    }
    if (APPLY && rb.labels) { writeFileSync(LABELS, rb.labels); console.log("src/wa-template-labels.json restored"); }
    if (APPLY) { rb.ops = []; delete rb.labels; rb.revertedAt = new Date().toISOString(); writeFileSync(RB, JSON.stringify(rb, null, 2)); }
    console.log(APPLY ? "reverted" : "(dry-run) add --apply to revert");
    process.exit(0);
  }

  const env = Object.fromEntries(
    readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const inv = new Map();
  let url = "https://graph.facebook.com/v22.0/2144001136512196/message_templates?limit=100&fields=id,name,language,status,category,components";
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
    if (!r.ok) throw new Error(`meta GET HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    for (const x of j.data ?? []) if (x.language === "ar") inv.set(x.name, x);
    url = j.paging?.next ?? null;
  }

  async function write(id, vals, why) {
    await pause(400);
    const [before] = await call("x_whatsapp_template", "read", { ids: [id], fields: FIELDS });
    const b = Object.fromEntries(Object.keys(vals).map((k) => [k, before[k]]));
    if (Object.keys(vals).every((k) => before[k] === vals[k])) return;
    console.log(`  ${APPLY ? "✎" : "·"} #${id} ${before.x_meta_template_id}: ${JSON.stringify(b)} → ${JSON.stringify(vals)}  (${why})`);
    if (!APPLY) return;
    rb.ops.push({ ts: new Date().toISOString(), id, name: before.x_meta_template_id, before: b, after: vals, why });
    writeFileSync(RB, JSON.stringify(rb, null, 2));
    await call("x_whatsapp_template", "write", { ids: [id], vals });
  }

  const [field] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]], fields: ["id"] });
  const labels = JSON.parse(readFileSync(LABELS, "utf8"));
  let moved = 0, skipped = 0, same = 0;
  console.log(APPLY ? "=== APPLY ===" : "=== DRY-RUN (no writes) ===");
  for (const p of planMigration(inv)) {
    if (p.action === "skip") { skipped++; console.log(`⏭  ${p.purpose}: ${p.why}`); continue; }
    const m = inv.get(p.to);
    const [row] = await call("x_whatsapp_template", "search_read", { domain: [["x_meta_template_id", "=", p.to], ["x_language", "=", "ar"]], fields: FIELDS });
    if (!row) { skipped++; console.log(`⏭  ${p.purpose}: ${p.to} has no Odoo row — run wa-templates-20260925-new-eight.mjs --odoo first`); continue; }
    const sel = await call("ir.model.fields.selection", "search_count", { domain: [["field_id", "=", field.id], ["value", "=", p.purpose]] });
    if (!sel) { skipped++; console.log(`⏭  ${p.purpose}: not an x_purpose value — run wa-templates-20260925-new-eight.mjs --odoo first`); continue; }
    const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", p.purpose]], fields: FIELDS });
    if (holders.length === 1 && holders[0].id === row.id) { same++; console.log(`=  ${p.purpose}: already on ${p.to} #${row.id}`); continue; }

    console.log(`➡  ${p.purpose}: ${holders.map((h) => `${h.x_meta_template_id}#${h.id}`).join(", ") || "∅"} → ${p.to} #${row.id} (APPROVED, UTILITY, ${nVars(bodyOf(m))} var(s))`);
    // 1) the new row reflects Meta now (the 05:00 sync may not have run since approval)
    await write(row.id, { x_meta_status: m.status, x_category: m.category, x_param_count: nVars(bodyOf(m)) }, `${p.purpose}: refresh from Meta`);
    // 2) clear every other holder (the old template), and mark it old
    for (const h of holders) if (h.id !== row.id) {
      const old = (typeof h.x_label_ar === "string" && h.x_label_ar.replace(/^\(قديم\)\s*/, "").split(" — ")[0]) || h.x_meta_template_id;
      const label = `(قديم) ${old} — استخدم: ${p.label}`;
      await write(h.id, { x_purpose: "other", x_label_ar: label, x_name: label }, `${p.purpose}: clear old`);
      if (APPLY && labels[h.x_meta_template_id] !== label) {
        rb.labels ??= readFileSync(LABELS, "utf8");
        labels[h.x_meta_template_id] = label;
      }
    }
    // 3) set the new one
    await write(row.id, { x_purpose: p.purpose }, `${p.purpose}: set new`);
    // 4) verify: the purpose resolves to the new template alone, with the code's variable count
    if (APPLY) {
      const rows = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", p.purpose]], fields: FIELDS });
      const chosen = pickTemplate(rows, (n) => contractParams(p.purpose, n));
      const ok = rows.length === 1 && chosen?.id === row.id && chosen.x_meta_status === "APPROVED"
        && chosen.x_param_count === contractParams(p.purpose, chosen.x_meta_template_id);
      console.log(`   ⇢ verify ${p.purpose}: ${rows.map((r) => `${r.x_meta_template_id}#${r.id}(p=${r.x_param_count})`).join(", ")} ${ok ? "✅" : "❌"}`);
      if (!ok) { writeFileSync(RB, JSON.stringify(rb, null, 2)); throw new Error(`verify failed for ${p.purpose} — run with --rollback --apply`); }
    }
    moved++;
  }
  if (APPLY && rb.labels) {
    writeFileSync(LABELS, JSON.stringify(labels, null, 2) + "\n");
    writeFileSync(RB, JSON.stringify(rb, null, 2));
    console.log("src/wa-template-labels.json updated (old names marked «(قديم)») — commit it");
  }
  console.log(`\nmoved=${moved} already=${same} skipped=${skipped}${APPLY ? "" : " (dry-run: add --apply)"}`);
  console.log("Note: the worker caches purpose→template for up to 10 minutes.");
}
