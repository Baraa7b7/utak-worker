// م3 (2026-09-24): حقل إيقاف الرسائل التسويقية على res.partner.
//
//   res.partner.x_wa_marketing_optout (boolean، manual، افتراضه false)
//   وview وارثة من res.partner.form.utak_wa_allowed (2784) تضعه بعد «مسموح واتساب».
//
// يكتبه الوركر حين يرسل العميل «إيقاف» أو «تشغيل» (src/optout.ts)، ويقرؤه
// طلب التقييم وتذكير الغياب في مهمة 08:00 (src/outreach.ts). لا يلمس Meta،
// ولا قالباً، ولا قيداً، ولا يرسل شيئاً.
//
//   node scripts/wa-20260924-marketing-optout-field.mjs                      (dry-run)
//   node scripts/wa-20260924-marketing-optout-field.mjs --apply
//   node scripts/wa-20260924-marketing-optout-field.mjs --rollback           (dry-run)
//   node scripts/wa-20260924-marketing-optout-field.mjs --rollback --apply
//
// اللقطة قبل أي كتابة: scripts/artifacts/wa-20260924-marketing-optout-rollback.json.
// التراجع يحذف الـ view ثم الحقل، ويحذف فقط ما أنشأه هذا السكربت. وقبل حذف
// الحقل يحفظ في اللقطة معرّفات من أوقف الرسائل، لأن الحذف يمحو اختيارهم.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const RB = new URL("./artifacts/wa-20260924-marketing-optout-rollback.json", import.meta.url);
const FIELD = "x_wa_marketing_optout";
const LABEL = "إيقاف الرسائل التسويقية";
const HELP = "يضبطه العميل برسالة «إيقاف» أو «stop»، ويعيده «تشغيل». يوقف طلب التقييم وتذكير الغياب فقط؛ رسائل الطلب والفاتورة وتذكير الدفع مستمرة.";
const BASE_VIEW = "res.partner.form.utak_wa_allowed";
const VIEW_NAME = "res.partner.form.utak_wa_marketing_optout";
const ARCH = `<data>
  <xpath expr="//field[@name='x_wa_allowed']" position="after">
    <field name="${FIELD}" widget="boolean_toggle"/>
  </xpath>
</data>`;
const log = (s) => console.log(`${APPLY ? "" : "(dry-run) "}${s}`);

async function state() {
  const [model] = await call("ir.model", "search_read", { domain: [["model", "=", "res.partner"]], fields: ["id"] });
  const [field] = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "=", FIELD]], fields: ["id", "ttype", "state"],
  });
  const [base] = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", BASE_VIEW], ["model", "=", "res.partner"]], fields: ["id", "active", "arch_db"],
  });
  const [view] = await call("ir.ui.view", "search_read", { domain: [["name", "=", VIEW_NAME]], fields: ["id", "inherit_id", "active"] });
  const optedOut = field
    ? await call("res.partner", "search_read", { domain: [[FIELD, "=", true], ["active", "in", [true, false]]], fields: ["id", "name"] })
    : [];
  return { modelId: model?.id, field, base, view, optedOut };
}

async function verify() {
  const fg = await call("res.partner", "fields_get", { attributes: ["type", "string"] });
  const s = await state();
  const ok = fg[FIELD]?.type === "boolean" && !!s.view?.active;
  console.log(`verify: field=${fg[FIELD] ? `${fg[FIELD].type} «${fg[FIELD].string}»` : "∅"} view=${s.view ? `#${s.view.id}` : "∅"} opted-out=${s.optedOut.length} → ${ok ? "✅" : "❌"}`);
  return ok;
}

async function rollback() {
  if (!existsSync(RB)) throw new Error("no rollback file — nothing was created by this script");
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const s = await state();
  if (s.optedOut.length) {
    log(`${s.optedOut.length} partner(s) opted out — saved to the rollback file before the field goes: ${s.optedOut.map((p) => p.id).join(",")}`);
    if (APPLY) { rb.optedOutAtRollback = s.optedOut; writeFileSync(RB, JSON.stringify(rb, null, 2)); }
  }
  if (rb.created.view_id) { log(`unlink view #${rb.created.view_id}`); if (APPLY) await call("ir.ui.view", "unlink", { ids: [rb.created.view_id] }); }
  else log("view: not created by this script — kept");
  if (rb.created.field_id) { log(`unlink field ${FIELD} #${rb.created.field_id}`); if (APPLY) await call("ir.model.fields", "unlink", { ids: [rb.created.field_id] }); }
  else log("field: not created by this script — kept");
  if (APPLY) {
    const after = await state();
    console.log(`after rollback: field=${after.field ? "#" + after.field.id : "∅"} view=${after.view ? "#" + after.view.id : "∅"}`);
  } else log("nothing written");
}

async function setup() {
  const s = await state();
  if (!s.modelId) throw new Error("ir.model res.partner not found");
  if (!s.base || !s.base.active || !String(s.base.arch_db).includes("x_wa_allowed")) {
    throw new Error(`base view ${BASE_VIEW} missing, inactive, or without x_wa_allowed`);
  }
  if (s.field && s.field.ttype !== "boolean") throw new Error(`${FIELD} exists with type ${s.field.ttype}`);
  console.log(`before: field=${s.field ? "#" + s.field.id : "∅"} view=${s.view ? "#" + s.view.id : "∅"} base=#${s.base.id}`);

  let rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null;
  if (!rb) rb = { script: "scripts/wa-20260924-marketing-optout-field.mjs", createdAt: new Date().toISOString(), before: { field: s.field ?? null, view: s.view ?? null }, created: { field_id: null, view_id: null } };
  const save = () => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2)); };
  save();

  if (s.field) log(`field ${FIELD}: exists #${s.field.id} — kept`);
  else {
    log(`field ${FIELD}: create boolean «${LABEL}» on res.partner (model #${s.modelId})`);
    if (APPLY) {
      const [id] = await call("ir.model.fields", "create", {
        vals_list: [{ model_id: s.modelId, name: FIELD, ttype: "boolean", state: "manual", field_description: LABEL, help: HELP }],
      }, { probe: [["model", "=", "res.partner"], ["name", "=", FIELD]] });
      rb.created.field_id = id; save();
    }
  }
  if (s.view) log(`view ${VIEW_NAME}: exists #${s.view.id} — kept`);
  else {
    log(`view ${VIEW_NAME}: create extension of #${s.base.id}, ${FIELD} after x_wa_allowed`);
    if (APPLY) {
      const [id] = await call("ir.ui.view", "create", {
        vals_list: [{ name: VIEW_NAME, model: "res.partner", type: "form", inherit_id: s.base.id, mode: "extension", priority: 60, arch_db: ARCH }],
      }, { probe: [["name", "=", VIEW_NAME]] });
      rb.created.view_id = id; save();
    }
  }
  if (APPLY && !(await verify())) throw new Error("verify failed — run --rollback --apply");
  if (!APPLY) log("nothing written");
}

console.log(`wa-20260924-marketing-optout-field — ${ROLLBACK ? "rollback" : "setup"}${APPLY ? "" : " (dry-run)"}`);
await (ROLLBACK ? rollback() : setup());
