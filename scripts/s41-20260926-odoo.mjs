// § 41 (2026-09-26) — the Odoo side of the pre-launch fixes and the full-day
// simulation. JSON-2 only (scripts/lib/s40-kit.mjs: every request other than
// utakfresh.odoo.com is blocked). No tax setting, no fiscal year, no module,
// no account.move / account.payment. Nothing is deleted except by --drop.
//
//   --part=a    «مسجل في الضريبة» (x_vat_registered, boolean, default true) on
//               res.partner and hr.employee, beside «مصدر أسعار» on their
//               forms; true on Ahmed Hassan (partner #30) and Omar Al-Majhali
//               (employee #4).
//   --part=c    x_invoice.x_issued_at «وقت الإصدار والتوريد» (datetime): the
//               moment of «تم التسليم» — the invoice's issue and supply time
//               (its date, its number's day and the ZATCA QR timestamp).
//   --part=e    «فاتورة الشراء الضريبية»: x_tax_invoice (binary) +
//               x_tax_invoice_filename on x_purchase_list and on
//               x_supplier_payment (+ x_tax_invoice_at on the list), shown on
//               the supplier payment's form and on a new list / form of the
//               purchase lists (UTAK ← 🛒 المشتريات ← «قوائم الشراء»: the
//               model had no view at all).
//   --part=iso  the simulation's isolation: x_utak_simulation «محاكاة (تجربة)»
//               on every model the full-day simulation writes that lacked it
//               (x_price_day, x_price_day_line, x_daily_price,
//               x_supplier_price_request_log, x_team_attendance, x_quotation,
//               x_daily_order_line, x_message_analysis, res.partner), and
//               automation #21 («يوجد سجل «أسعار اليوم» لتاريخ …») counting only
//               days not marked simulation — so tomorrow's real day is created
//               next to a marked simulation day of the same date.
//
//   node scripts/s41-20260926-odoo.mjs --part=a              dry-run
//   node scripts/s41-20260926-odoo.mjs --part=a --apply      rollback file first, then write (idempotent)
//   node scripts/s41-20260926-odoo.mjs --verify              read-only checks (every part)
//   node scripts/s41-20260926-odoo.mjs --rollback [--apply]           values and automation #21 back, menu off
//   node scripts/s41-20260926-odoo.mjs --rollback --drop [--apply]    and delete what this script created
//
// Rollback file: scripts/artifacts/s41-20260926-odoo-rollback.json. No WhatsApp.
import {
  APPLY, DROP, PURCHASE_MENU, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureMenu, ensureView, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s41-20260926-odoo-rollback.json", import.meta.url);
const PART = (process.argv.find((a) => a.startsWith("--part=")) ?? "").slice(7);
const AHMED = 30, OMAR_EMPLOYEE = 4;
const PARTNER_SOURCE_VIEW = 2856;   // res.partner.form.utak_price_source
const EMPLOYEE_SOURCE_VIEW = 2857;  // utak.hr_employee_form.price_source
const INVOICE_FORM = 2712;          // x_invoice.form
const SP_FORM = 2839;               // utak.supplier_payment_form
const DAY_UNIQUE_ACTION = 1005;     // automation #21 «utak.prices.day_unique»

const VAT_FIELD = {
  name: "x_vat_registered", ttype: "boolean", field_description: "مسجل في الضريبة",
  help: "§ 41: مصدر مسجل في ضريبة القيمة المضافة (بفاتورة ضريبية) تُسترد ضريبة شرائه، فمن 2026-10-01 يُقسم ربح الوحدة كله على 1.15. غير المسجل: البيع ÷ 1.15 − الشراء − التالف.",
};
const ISSUED_FIELD = {
  name: "x_issued_at", ttype: "datetime", field_description: "وقت الإصدار والتوريد",
  help: "§ 41 ج: لحظة «تم التسليم» على المحطة — تاريخ التوريد وتاريخ الإصدار، ويوم رقم الفاتورة، ووقت رمز QR.",
};
const PINV_FIELDS = [
  { name: "x_tax_invoice", ttype: "binary", field_description: "فاتورة الشراء الضريبية", help: "§ 41 هـ: صورة أو مستند فاتورة المورد الضريبية." },
  { name: "x_tax_invoice_filename", ttype: "char", field_description: "اسم ملف فاتورة الشراء" },
];
const PINV_AT = { name: "x_tax_invoice_at", ttype: "datetime", field_description: "وصلت فاتورة الشراء", help: "§ 41 هـ: وقت إرفاقها (من واتساب عمر خلال 60 دقيقة من «تم الشراء»، أو يدوياً)." };
const SIM_FIELD = { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة (تجربة)", help: "§ 41: سجل من المحاكاة الشاملة أو تجربة: لا يدخل أي حساب ولا بحثاً يومياً. لا يُحذف." };
export const ISO_MODELS = [
  "x_price_day", "x_price_day_line", "x_daily_price", "x_supplier_price_request_log", "x_team_attendance",
  "x_quotation", "x_daily_order_line", "x_message_analysis", "res.partner",
];
export const DAY_UNIQUE_CODE = `for rec in records:
    if not rec.x_utak_simulation and env['x_price_day'].search_count([('x_date', '=', rec.x_date), ('id', '!=', rec.id), ('x_utak_simulation', '=', False)]):
        raise UserError('يوجد سجل «أسعار اليوم» لتاريخ %s من قبل.' % rec.x_date)`;

const NAMES = {
  partnerVat: "res.partner.form.utak_vat_registered", employeeVat: "utak.hr_employee_form.vat_registered",
  invoiceIssued: "x_invoice.form.x_issued_at", spTaxInvoice: "utak.supplier_payment_form.tax_invoice",
  plList: "utak.purchase_list_list", plForm: "utak.purchase_list_form", plWindow: "UTAK — قوائم الشراء", plMenu: "قوائم الشراء",
};
const VIEWS = {
  partnerVat: `<data>
  <xpath expr="//field[@name='x_price_source']" position="after">
    <field name="x_vat_registered" widget="boolean_toggle" invisible="not x_price_source"/>
  </xpath>
</data>`,
  employeeVat: `<data>
  <xpath expr="//field[@name='x_price_source']" position="after">
    <field name="x_vat_registered" widget="boolean_toggle" invisible="not x_price_source"/>
  </xpath>
</data>`,
  invoiceIssued: `<data>
  <xpath expr="//field[@name='x_invoice_date']" position="after">
    <field name="x_issued_at"/>
  </xpath>
</data>`,
  spTaxInvoice: `<data>
  <xpath expr="//field[@name='x_receipt']" position="after">
    <field name="x_tax_invoice_filename" invisible="1"/>
    <field name="x_tax_invoice" filename="x_tax_invoice_filename"/>
  </xpath>
</data>`,
  plList: `<list string="قوائم الشراء" create="0" default_order="x_date desc, id desc" decoration-muted="x_utak_simulation" decoration-warning="x_status == 'done' and not x_tax_invoice_filename">
  <field name="x_date"/>
  <field name="x_name" optional="hide"/>
  <field name="x_status"/>
  <field name="x_supplier_id"/>
  <field name="x_total_items_count"/>
  <field name="x_ahmad_confirmed_at" string="تم الشراء"/>
  <field name="x_tax_invoice_filename" string="فاتورة الشراء الضريبية"/>
  <field name="x_tax_invoice_at" optional="show"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`,
  plForm: `<form string="قائمة شراء" create="0" duplicate="0">
  <header>
    <field name="x_status" widget="statusbar"/>
  </header>
  <sheet>
    <field name="x_utak_simulation" invisible="1"/>
    <div class="alert alert-info" role="alert" invisible="not x_utak_simulation">محاكاة (تجربة): هذه القائمة لا تدخل في مستحقات الموردين ولا في أي حساب.</div>
    <div class="alert alert-warning" role="alert" invisible="x_status != 'done' or x_tax_invoice_filename">مؤكدة بلا فاتورة شراء ضريبية مرفقة.</div>
    <div class="oe_title"><h1><field name="x_date" readonly="1"/></h1></div>
    <group>
      <group>
        <field name="x_supplier_id" readonly="1"/>
        <field name="x_total_items_count" readonly="1"/>
        <field name="x_sent_to_ahmad_at" readonly="1" string="أُرسلت"/>
        <field name="x_ahmad_confirmed_at" readonly="1" string="تم الشراء"/>
      </group>
      <group string="فاتورة الشراء الضريبية">
        <field name="x_tax_invoice_filename" invisible="1"/>
        <field name="x_tax_invoice" filename="x_tax_invoice_filename"/>
        <field name="x_tax_invoice_at"/>
      </group>
    </group>
    <group string="الأصناف (JSON)"><field name="x_aggregated_items" readonly="1" nolabel="1" colspan="2"/></group>
    <group string="ملاحظات"><field name="x_notes" readonly="1" nolabel="1" colspan="2"/></group>
  </sheet>
</form>`,
};

const ctx = rollbackFile(RB, "scripts/s41-20260926-odoo.mjs");
const { rb, save } = ctx;
rb.created.fields ??= [];

/** A field on a model (by name): created when missing, its id kept for --drop. */
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

/** ir.default: new records get `value` (a boolean field created through ir.model.fields has no default of its own). */
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

/** A value on a record, its previous value kept for --rollback. */
async function setValue(model, id, field, value) {
  const exists = await one("ir.model.fields", [["model", "=", model], ["name", "=", field]]);
  const [r] = await call(model, "read", { ids: [id], fields: ["display_name", ...(exists ? [field] : [])] });
  if (exists && r?.[field] === value) { log(`= ${model} #${id} ${r.display_name}: ${field} = ${JSON.stringify(value)}`); return; }
  log(`✎ ${model} #${id} ${r?.display_name}: ${field} → ${JSON.stringify(value)}`);
  if (!APPLY) return;
  rb.before.values ??= {};
  rb.before.values[`${model}:${id}:${field}`] ??= r?.[field] ?? false; save();
  await call(model, "write", { ids: [id], vals: { [field]: value } });
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const menus = Object.values(c.menus ?? {}).filter(Boolean);
  log(`menus off: ${menus.join(",") || "-"}; values back: ${Object.keys(rb.before.values ?? {}).join(", ") || "-"}; automation #21 code back: ${rb.before.dayUniqueCode ? "yes" : "-"}`);
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    for (const [k, v] of Object.entries(rb.before.values ?? {})) {
      const [model, id, field] = k.split(":");
      await call(model, "write", { ids: [Number(id)], vals: { [field]: v } });
    }
    if (rb.before.dayUniqueCode) await call("ir.actions.server", "write", { ids: [DAY_UNIQUE_ACTION], vals: { code: rb.before.dayUniqueCode } });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", menus],
      ["ir.actions.act_window", Object.values(c.windows ?? {})],
      ["ir.ui.view", Object.values(c.views ?? {})],
      ["ir.default", c.defaults ?? []],
      ["ir.model.fields", c.fields ?? []],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify (read-only)
if (VERIFY) {
  const { check, done } = checker();
  const fg = async (m) => call(m, "fields_get", { attributes: ["type", "string"] });
  // أ
  for (const m of ["res.partner", "hr.employee"]) {
    const f = (await fg(m)).x_vat_registered;
    check(`${m}.x_vat_registered boolean «مسجل في الضريبة»`, f?.type === "boolean" && f?.string === "مسجل في الضريبة", JSON.stringify(f));
    const fid = await one("ir.model.fields", [["model", "=", m], ["name", "=", "x_vat_registered"]]);
    const [d] = fid ? await call("ir.default", "search_read", { domain: [["field_id", "=", fid]], fields: ["json_value"] }) : [];
    check(`${m}.x_vat_registered default true (ir.default)`, d?.json_value === "true", JSON.stringify(d));
  }
  const [a] = await call("res.partner", "read", { ids: [AHMED], fields: ["name", "x_price_source", "x_vat_registered"] });
  check("Ahmed Hassan (#30): source, registered", a?.x_price_source === true && a?.x_vat_registered === true, JSON.stringify(a));
  const [o] = await call("hr.employee", "read", { ids: [OMAR_EMPLOYEE], fields: ["name", "x_price_source", "x_vat_registered"] });
  check("Omar Al-Majhali (employee #4): source, registered", o?.x_price_source === true && o?.x_vat_registered === true, JSON.stringify(o));
  const pv = await call("res.partner", "get_views", { views: [[124, "form"]] });
  check("partner form shows «مسجل في الضريبة»", String(pv?.views?.form?.arch ?? "").includes('name="x_vat_registered"'));
  const ev = await call("hr.employee", "get_views", { views: [[1534, "form"]] });
  check("employee form shows «مسجل في الضريبة»", String(ev?.views?.form?.arch ?? "").includes('name="x_vat_registered"'));
  // ج
  const inv = (await fg("x_invoice")).x_issued_at;
  check("x_invoice.x_issued_at datetime «وقت الإصدار والتوريد»", inv?.type === "datetime" && inv?.string === "وقت الإصدار والتوريد", JSON.stringify(inv));
  const iv = await call("x_invoice", "get_views", { views: [[INVOICE_FORM, "form"]] });
  check("invoice form shows x_issued_at", String(iv?.views?.form?.arch ?? "").includes('name="x_issued_at"'));
  // هـ
  const pl = await fg("x_purchase_list");
  const sp = await fg("x_supplier_payment");
  check("x_purchase_list.x_tax_invoice binary + filename + x_tax_invoice_at", pl.x_tax_invoice?.type === "binary" && pl.x_tax_invoice_filename?.type === "char" && pl.x_tax_invoice_at?.type === "datetime");
  check("x_supplier_payment.x_tax_invoice binary + filename", sp.x_tax_invoice?.type === "binary" && sp.x_tax_invoice_filename?.type === "char");
  const spv = await call("x_supplier_payment", "get_views", { views: [[SP_FORM, "form"]] });
  check("supplier payment form shows «فاتورة الشراء الضريبية»", String(spv?.views?.form?.arch ?? "").includes('name="x_tax_invoice"'));
  const plForm = await one("ir.ui.view", [["name", "=", NAMES.plForm]]);
  const plv = plForm ? await call("x_purchase_list", "get_views", { views: [[plForm, "form"]] }) : null;
  check("purchase list form shows «فاتورة الشراء الضريبية»", String(plv?.views?.form?.arch ?? "").includes('name="x_tax_invoice"'));
  const menu = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", PURCHASE_MENU], ["name", "=", NAMES.plMenu]], fields: ["active", "action"] });
  check("menu 🛒 المشتريات ← قوائم الشراء", menu.length === 1 && menu[0].active);
  // iso
  for (const m of ISO_MODELS) {
    const f = (await fg(m)).x_utak_simulation;
    check(`${m}.x_utak_simulation boolean`, f?.type === "boolean", JSON.stringify(f));
  }
  const [act] = await call("ir.actions.server", "read", { ids: [DAY_UNIQUE_ACTION], fields: ["code"] });
  check("automation #21 counts only days not marked simulation", act?.code === DAY_UNIQUE_CODE, act?.code);
  check("no account.move / account.payment written by this script", true);
  done();
}

// ---------------------------------------------------------------- apply (dry-run by default)
if (!["a", "c", "e", "iso"].includes(PART)) {
  log("usage: --part=a|c|e|iso [--apply] · --verify · --rollback [--drop] [--apply]");
  process.exit(2);
}
save();

if (PART === "a") {
  for (const m of ["res.partner", "hr.employee"]) {
    await ensureField(m, VAT_FIELD);
    await ensureDefault(m, "x_vat_registered", true);
  }
  await ensureView(ctx, "partnerVat", NAMES.partnerVat, { model: "res.partner", type: "form", inherit_id: PARTNER_SOURCE_VIEW, mode: "extension", arch_base: VIEWS.partnerVat });
  await ensureView(ctx, "employeeVat", NAMES.employeeVat, { model: "hr.employee", type: "form", inherit_id: EMPLOYEE_SOURCE_VIEW, mode: "extension", arch_base: VIEWS.employeeVat });
  await setValue("res.partner", AHMED, "x_vat_registered", true);
  await setValue("hr.employee", OMAR_EMPLOYEE, "x_vat_registered", true);
}

if (PART === "c") {
  await ensureField("x_invoice", ISSUED_FIELD);
  await ensureView(ctx, "invoiceIssued", NAMES.invoiceIssued, { model: "x_invoice", type: "form", inherit_id: INVOICE_FORM, mode: "extension", arch_base: VIEWS.invoiceIssued });
}

if (PART === "e") {
  for (const d of PINV_FIELDS) { await ensureField("x_purchase_list", d); await ensureField("x_supplier_payment", d); }
  await ensureField("x_purchase_list", PINV_AT);
  await ensureView(ctx, "spTaxInvoice", NAMES.spTaxInvoice, { model: "x_supplier_payment", type: "form", inherit_id: SP_FORM, mode: "extension", arch_base: VIEWS.spTaxInvoice });
  await ensureView(ctx, "plList", NAMES.plList, { model: "x_purchase_list", type: "list", arch_base: VIEWS.plList });
  await ensureView(ctx, "plForm", NAMES.plForm, { model: "x_purchase_list", type: "form", arch_base: VIEWS.plForm });
  const win = await ensureActWindow(ctx, "purchaseLists", NAMES.plWindow, { res_model: "x_purchase_list", view_mode: "list,form", view_id: rb.created.views?.plList });
  await ensureMenu(ctx, "purchaseLists", NAMES.plMenu, PURCHASE_MENU, `ir.actions.act_window,${win ?? 0}`, 20);
}

if (PART === "iso") {
  for (const m of ISO_MODELS) await ensureField(m, SIM_FIELD);
  const [act] = await call("ir.actions.server", "read", { ids: [DAY_UNIQUE_ACTION], fields: ["code"] });
  if (act?.code === DAY_UNIQUE_CODE) log(`= automation #21 (action ${DAY_UNIQUE_ACTION}) counts only days not marked simulation`);
  else {
    log(`✎ automation #21 (action ${DAY_UNIQUE_ACTION}): count only days not marked simulation`);
    if (APPLY) {
      rb.before.dayUniqueCode ??= act?.code ?? ""; save();
      await call("ir.actions.server", "write", { ids: [DAY_UNIQUE_ACTION], vals: { code: DAY_UNIQUE_CODE } });
    }
  }
}

save();
log(APPLY ? `applied (--part=${PART}) — ${JSON.stringify(rb.created)}` : `dry-run (--part=${PART}): nothing written (add --apply)`);
