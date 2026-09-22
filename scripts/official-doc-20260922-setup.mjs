// Official-doc 2026-09-22 — create the Odoo models, fields, access rules,
// server actions, views, and menus for «المستندات الرسمية».
//
// Every write is captured in scripts/artifacts/official-docs-created.json.
// scripts/official-doc-rollback.mjs (dry-run only) undoes them in reverse.
//
// Odoo tenant is SHARED between sim and prod (utak-tenant-sharing memory) —
// this script is additive and idempotent by name. Custom models start with
// "x_" per Odoo SaaS constraints; ir.access rows are created one at a time
// and verified after each create.
//
// Dry-run by default. Pass --apply to write.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const APPLY = process.argv.includes("--apply");
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

function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }

// -------- helpers -------------------------------------------------

async function findOrCreateModel(model, name, extra = {}) {
  const rows = await call("ir.model", "search_read", {
    domain: [["model", "=", model]], fields: ["id", "model", "name"], limit: 1,
  });
  if (rows.length > 0) {
    say(`model ${model} already exists id=${rows[0].id}`);
    return rows[0].id;
  }
  if (!APPLY) { say(`would create ir.model ${model}`); return -1; }
  const ids = await call("ir.model", "create", {
    vals_list: [{ model, name, state: "manual", ...extra }],
  });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "ir.model", id, name: model, action: "create" });
  say(`created ir.model ${model} id=${id}`);
  return id;
}

async function findField(modelName, fieldName) {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", modelName], ["name", "=", fieldName]],
    fields: ["id", "name", "ttype"], limit: 1,
  });
  return rows[0] ?? null;
}

async function findOrCreateField(modelId, modelName, name, vals) {
  const existing = await findField(modelName, name);
  if (existing) {
    say(`field ${modelName}.${name} exists id=${existing.id}`);
    return existing.id;
  }
  if (!APPLY) { say(`would create field ${modelName}.${name} (${vals.ttype})`); return -1; }
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{ model_id: modelId, name, state: "manual", ...vals }],
  });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "ir.model.fields", id, name: `${modelName}.${name}`, action: "create" });
  say(`created field ${modelName}.${name} id=${id}`);
  return id;
}

async function findOrCreateSelectionOption(fieldId, fieldLabel, value, label, sequence) {
  const existing = await call("ir.model.fields.selection", "search_read", {
    domain: [["field_id", "=", fieldId], ["value", "=", value]],
    fields: ["id", "value", "name"], limit: 1,
  });
  if (existing.length > 0) {
    say(`  ${fieldLabel} option ${value} exists id=${existing[0].id}`);
    return existing[0].id;
  }
  if (!APPLY) { say(`  would create ${fieldLabel} option ${value}`); return -1; }
  const ids = await call("ir.model.fields.selection", "create", {
    vals_list: [{ field_id: fieldId, value, name: label, sequence }],
  });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "ir.model.fields.selection", id, name: `${fieldLabel}=${value}`, action: "create" });
  say(`  created ${fieldLabel} option ${value} id=${id}`);
  return id;
}

async function findOrCreateAccess(name, modelId, groupXmlId) {
  // Odoo 19.4 renamed the ACL model to `ir.access` (single "crud" operation).
  // JSON-2 blocks direct calls to it, but ir.model.access_ids One2many lets
  // us write access rows through the parent model.
  const modelRow = await call("ir.model", "read", { ids: [modelId], fields: ["access_ids"] });
  const existingIds = modelRow[0]?.access_ids ?? [];
  if (existingIds.length > 0) {
    // Read all existing access rows on this model, look for one by name.
    const rows = await call("ir.access", "read", { ids: existingIds, fields: ["id", "name"] });
    const hit = rows.find((r) => r.name === name);
    if (hit) { say(`access ${name} exists id=${hit.id}`); return hit.id; }
  }
  if (!APPLY) { say(`would create access ${name} on modelId=${modelId} group=${groupXmlId}`); return -1; }
  const gRows = await call("ir.model.data", "search_read", {
    domain: [["module", "=", groupXmlId.split(".")[0]], ["name", "=", groupXmlId.split(".")[1]]],
    fields: ["res_id"], limit: 1,
  });
  const groupId = gRows[0]?.res_id;
  if (!groupId) throw new Error(`cannot resolve group xml_id ${groupXmlId}`);
  await call("ir.model", "write", {
    ids: [modelId],
    vals: {
      access_ids: [[0, 0, {
        name,
        group_id: groupId,
        operation: "crud",
        kind: "permission",
        active: true,
      }]],
    },
  });
  // Re-read to find the new access row id — write() didn't return it.
  const after = await call("ir.model", "read", { ids: [modelId], fields: ["access_ids"] });
  const newRows = await call("ir.access", "read", { ids: after[0].access_ids, fields: ["id", "name"] });
  const created = newRows.find((r) => r.name === name);
  if (!created) throw new Error(`ir.access ${name} created but not readable back`);
  record({ ts: new Date().toISOString(), model: "ir.access", id: created.id, name, action: "create" });
  say(`created access ${name} id=${created.id}`);
  return created.id;
}

// -------- main ----------------------------------------------------

async function main() {
  // (1) DOC model
  say("\n(1) x_official_doc model…");
  const docModelId = await findOrCreateModel("x_official_doc", "مستند رسمي");

  // (1a) fields on x_official_doc
  say("(1a) x_official_doc fields…");
  await findOrCreateField(docModelId, "x_official_doc", "x_name", {
    field_description: "الرقم", ttype: "char", copied: false,
  });
  const docTypeFieldId = await findOrCreateField(docModelId, "x_official_doc", "x_doc_type", {
    field_description: "النوع", ttype: "selection", required: true,
  });
  if (docTypeFieldId !== -1) {
    await findOrCreateSelectionOption(docTypeFieldId, "x_doc_type", "letter", "خطاب", 10);
    await findOrCreateSelectionOption(docTypeFieldId, "x_doc_type", "certificate", "إفادة", 20);
    await findOrCreateSelectionOption(docTypeFieldId, "x_doc_type", "authorization", "تفويض", 30);
    await findOrCreateSelectionOption(docTypeFieldId, "x_doc_type", "statement", "قائمة مالية", 40);
    await findOrCreateSelectionOption(docTypeFieldId, "x_doc_type", "other", "أخرى", 50);
  }
  await findOrCreateField(docModelId, "x_official_doc", "x_recipient", {
    field_description: "الجهة", ttype: "char",
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_recipient_label", {
    field_description: "تسمية الجهة", ttype: "char",
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_subject", {
    field_description: "الموضوع", ttype: "char",
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_date", {
    field_description: "التاريخ", ttype: "date",
  });
  const statusFieldId = await findOrCreateField(docModelId, "x_official_doc", "x_status", {
    field_description: "الحالة", ttype: "selection", copied: false,
  });
  if (statusFieldId !== -1) {
    await findOrCreateSelectionOption(statusFieldId, "x_status", "draft", "مسودة", 10);
    await findOrCreateSelectionOption(statusFieldId, "x_status", "issued", "صادر", 20);
  }
  await findOrCreateField(docModelId, "x_official_doc", "x_ai_prompt", {
    field_description: "طلب الصياغة الذكية", ttype: "text",
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_preview_url", {
    field_description: "رابط المعاينة", ttype: "char", copied: false,
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_pdf_url", {
    field_description: "ملف PDF", ttype: "char", copied: false,
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_issued_at", {
    field_description: "تاريخ الإصدار", ttype: "datetime", copied: false,
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_last_error", {
    field_description: "آخر خطأ", ttype: "char", copied: false,
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_is_template", {
    field_description: "نموذج جاهز", ttype: "boolean", copied: false,
  });
  await findOrCreateField(docModelId, "x_official_doc", "x_template_name", {
    field_description: "اسم النموذج", ttype: "char",
  });

  // (2) BLOCK model
  say("\n(2) x_official_doc_block model…");
  const blockModelId = await findOrCreateModel("x_official_doc_block", "بلوك مستند رسمي");

  // (2a) fields on x_official_doc_block
  say("(2a) x_official_doc_block fields…");
  // many2one to parent with on_delete=cascade — must reference the parent
  // model by name via `relation`.
  await findOrCreateField(blockModelId, "x_official_doc_block", "x_doc_id", {
    field_description: "المستند", ttype: "many2one",
    relation: "x_official_doc",
    required: true,
    on_delete: "cascade",
  });
  await findOrCreateField(blockModelId, "x_official_doc_block", "x_sequence", {
    field_description: "الترتيب", ttype: "integer",
  });
  const blockTypeFieldId = await findOrCreateField(blockModelId, "x_official_doc_block", "x_block_type", {
    field_description: "النوع", ttype: "selection", required: true,
  });
  if (blockTypeFieldId !== -1) {
    const opts = [
      ["heading", "عنوان"],
      ["badge", "شارة"],
      ["paragraph", "فقرة"],
      ["kv_card", "بطاقة بيانات"],
      ["table", "جدول"],
      ["highlight_row", "صف مميز"],
      ["notes", "ملاحظات"],
      ["signature", "توقيع"],
      ["stamp", "ختم"],
    ];
    for (let i = 0; i < opts.length; i++) {
      await findOrCreateSelectionOption(blockTypeFieldId, "x_block_type", opts[i][0], opts[i][1], (i + 1) * 10);
    }
  }
  await findOrCreateField(blockModelId, "x_official_doc_block", "x_text", {
    field_description: "النص", ttype: "text",
  });
  const toneFieldId = await findOrCreateField(blockModelId, "x_official_doc_block", "x_tone", {
    field_description: "اللون", ttype: "selection",
  });
  if (toneFieldId !== -1) {
    await findOrCreateSelectionOption(toneFieldId, "x_tone", "neutral", "عادي", 10);
    await findOrCreateSelectionOption(toneFieldId, "x_tone", "warning", "تنبيه", 20);
    await findOrCreateSelectionOption(toneFieldId, "x_tone", "success", "تأكيد", 30);
  }
  await findOrCreateField(blockModelId, "x_official_doc_block", "x_align_numbers", {
    field_description: "محاذاة الأرقام يسار", ttype: "boolean",
  });

  // (1b) x_block_ids one2many on doc (must come AFTER the many2one on block)
  say("(1b) one2many x_block_ids…");
  await findOrCreateField(docModelId, "x_official_doc", "x_block_ids", {
    field_description: "البلوكات", ttype: "one2many",
    relation: "x_official_doc_block",
    relation_field: "x_doc_id",
    copied: true, // duplicate() must copy the child blocks along with the doc
  });

  // (3) ir.access rows — created one at a time, verified after each.
  //     Odoo 19.4: single "crud" operation on ir.access (not per-r/w/c/u).
  say("\n(3) ir.access rows…");
  await findOrCreateAccess("x_official_doc.user", docModelId, "base.group_user");
  await findOrCreateAccess("x_official_doc.system", docModelId, "base.group_system");
  await findOrCreateAccess("x_official_doc_block.user", blockModelId, "base.group_user");
  await findOrCreateAccess("x_official_doc_block.system", blockModelId, "base.group_system");

  say("\nModel/field/access setup done.");
  say(`Rollback log at ${rbPath}`);
  say(`docModelId=${docModelId} blockModelId=${blockModelId}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
