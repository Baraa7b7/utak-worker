// § 44 (2026-09-28) — the Odoo side of the VAT-number question (part د).
// JSON-2 only (scripts/lib/s40-kit.mjs). No tax setting, no module, no
// account.move / account.payment. Nothing is deleted except by --drop.
//
//   --part=d    on res.partner:
//                 x_vat_status «حالة التسجيل الضريبي» (selection unknown / registered /
//                   not_registered, «غير معروف» by ir.default for new records; an empty value
//                   on an existing partner reads «غير معروف» in the worker — no mass write);
//                 x_legal_name «الاسم الرسمي للمنشأة» (char — res.partner has no standard legal-name
//                   field, and `name` is the display name the inbox titles and the messages use);
//                 x_vat_ask_count «مرات سؤال الرقم الضريبي» (integer, the worker's counter, max 3);
//               the number stays in the standard `vat`, the address in the standard `street`;
//               all four beside the standard VAT field on the partner form (Baraa edits them there).
//
//   node scripts/archive/s44-20260928-odoo.mjs --part=d              dry-run
//   node scripts/archive/s44-20260928-odoo.mjs --part=d --apply      rollback file first, then write (idempotent)
//   node scripts/archive/s44-20260928-odoo.mjs --verify              read-only checks
//   node scripts/archive/s44-20260928-odoo.mjs --rollback [--drop] [--apply]
//
// Rollback file: scripts/artifacts/s44-20260928-odoo-rollback.json. No WhatsApp.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureView, log, modelId, one, rollbackFile } from "../lib/s40-kit.mjs";

const RB = new URL("../artifacts/s44-20260928-odoo-rollback.json", import.meta.url);
const PART = (process.argv.find((a) => a.startsWith("--part=")) ?? "").slice(7);

export const VAT_STATUS_SEL = "[('unknown', 'غير معروف'), ('registered', 'مسجّل'), ('not_registered', 'غير مسجّل')]";
const FIELDS = [
  {
    name: "x_vat_status", ttype: "selection", field_description: "حالة التسجيل الضريبي", selection: VAT_STATUS_SEL,
    help: "§ 44: هل منشأة العميل مسجلة في ضريبة القيمة المضافة. «مسجّل» مع الرقم الضريبي ← فاتورة ضريبية كاملة باسم المنشأة ورقمها وعنوانها (من 2026-10-01). «غير مسجّل» ← فاتورة مبسطة ولا يُسأل مرة ثانية. «غير معروف» ← يُسأل بعد طلبه المؤكد القادم (3 مرات على الأكثر).",
  },
  {
    name: "x_legal_name", ttype: "char", field_description: "الاسم الرسمي للمنشأة",
    help: "§ 44: اسم المنشأة كما في السجل التجاري، يُطبع على الفاتورة الضريبية الكاملة. فارغ ← يُطبع اسم العميل.",
  },
  {
    name: "x_vat_ask_count", ttype: "integer", field_description: "مرات سؤال الرقم الضريبي",
    help: "§ 44: عدد مرات سؤال العميل عن تسجيله الضريبي بعد طلب مؤكد. بعد 3 بلا جواب لا يُسأل، ويصل براء تنبيه واحد. صفّره ليُسأل من جديد.",
  },
];
const NAMES = { partnerVatForm: "res.partner.form.utak_vat_status" };
const VIEWS = {
  partnerVatForm: `<data>
  <xpath expr="//field[@name='vat']" position="after">
    <field name="x_vat_status"/>
    <field name="x_legal_name" invisible="x_vat_status != 'registered' and not x_legal_name"/>
    <field name="x_vat_ask_count" invisible="x_vat_status != 'unknown' and not x_vat_ask_count"/>
  </xpath>
</data>`,
};

const ctx = rollbackFile(RB, "scripts/archive/s44-20260928-odoo.mjs");
const { rb, save } = ctx;
rb.created.fields ??= [];

async function ensureField(model, def) {
  const have = await one("ir.model.fields", [["model", "=", model], ["name", "=", def.name]]);
  if (have) { log(`= ${model}.${def.name} #${have}`); return have; }
  log(`+ ${model}.${def.name} (${def.ttype})`);
  if (!APPLY) return null;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: await modelId(model), ...def }] });
  rb.created.fields.push(id); save();
  log(`  → #${id}`);
  return id;
}
async function ensureDefault(model, field, value) {
  const fid = await one("ir.model.fields", [["model", "=", model], ["name", "=", field]]);
  const have = fid ? await one("ir.default", [["field_id", "=", fid]]) : null;
  if (have) { log(`= ir.default ${model}.${field} #${have}`); return; }
  log(`+ ir.default ${model}.${field} = ${JSON.stringify(value)}`);
  if (!APPLY || !fid) return;
  const [id] = await call("ir.default", "create", { vals_list: [{ field_id: fid, json_value: JSON.stringify(value) }] });
  rb.created.defaults ??= []; rb.created.defaults.push(id); save();
  log(`  → #${id}`);
}
/** The standard partner form (base.view_partner_form), where the VAT field is. */
async function partnerBaseForm() {
  const [x] = await call("ir.model.data", "search_read", { domain: [["module", "=", "base"], ["name", "=", "view_partner_form"]], fields: ["res_id"] });
  return x?.res_id;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  log(`created: fields ${JSON.stringify(c.fields ?? [])}, defaults ${JSON.stringify(c.defaults ?? [])}, views ${JSON.stringify(c.views ?? {})}`);
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.view", Object.values(c.views ?? {})],
      ["ir.default", c.defaults ?? []],
      ["ir.model.fields", c.fields ?? []],
    ]);
  } else log("(the fields stay: --drop deletes what this script created — only after the worker code that writes them is rolled back)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const f = await call("res.partner", "fields_get", { attributes: ["type", "string", "selection"] });
  check("res.partner.x_vat_status selection unknown / registered / not_registered", f.x_vat_status?.type === "selection"
    && JSON.stringify((f.x_vat_status.selection ?? []).map((s) => s[0])) === JSON.stringify(["unknown", "registered", "not_registered"]), JSON.stringify(f.x_vat_status));
  check("res.partner.x_legal_name char", f.x_legal_name?.type === "char", JSON.stringify(f.x_legal_name));
  check("res.partner.x_vat_ask_count integer", f.x_vat_ask_count?.type === "integer", JSON.stringify(f.x_vat_ask_count));
  check("res.partner.vat and street are the standard fields", f.vat?.type === "char" && f.street?.type === "char");
  const fid = await one("ir.model.fields", [["model", "=", "res.partner"], ["name", "=", "x_vat_status"]]);
  const [d] = fid ? await call("ir.default", "search_read", { domain: [["field_id", "=", fid]], fields: ["json_value"] }) : [];
  check("x_vat_status default «unknown» (ir.default)", d?.json_value === "\"unknown\"", JSON.stringify(d));
  const v = await call("res.partner", "get_views", { views: [[false, "form"]] });
  const arch = String(v?.views?.form?.arch ?? "");
  check("the partner form shows the status, the legal name and the ask counter beside the VAT number", ["x_vat_status", "x_legal_name", "x_vat_ask_count", "vat"].every((n) => arch.includes(`name="${n}"`)));
  process.exit(done());
}

// ---------------------------------------------------------------- apply
if (PART === "d") {
  for (const def of FIELDS) await ensureField("res.partner", def);
  await ensureDefault("res.partner", "x_vat_status", "unknown");
  const base = await partnerBaseForm();
  if (!base) throw new Error("base.view_partner_form not found");
  await ensureView(ctx, "partnerVatForm", NAMES.partnerVatForm, { model: "res.partner", type: "form", inherit_id: base, mode: "extension", priority: 99, arch_base: VIEWS.partnerVatForm });
  log(APPLY ? "part d done — run --verify" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}
log("usage: --part=d [--apply] · --verify · --rollback [--drop] [--apply]");
process.exit(2);
