// § 37 (2026-09-25): «💵 دفع الموردين» in Odoo — supplier dues, payments,
// balances. No accounting: no account.move, no account.payment.
//
//   1. ir.sequence «UTAK — مرجع دفعات الموردين» (utak.supplier.payment):
//      SP-2026-0001, one range per year;
//   2. x_supplier_payment «دفعة مورد»: supplier, Riyadh date, amount (2
//      decimals), method (نقداً / تحويل), recorded by, channel (Odoo /
//      واتساب), state (بانتظار الاعتماد / معتمدة / مرفوضة), receipt
//      (optional), note, reject reason, who decided and when, «رصيد دائن»,
//      the remaining after it, the supplier's notice, a trial tag;
//   3. x_supplier_due «مستحق مورد يومي» (one per supplier and confirmed
//      purchase list) and x_supplier_due_line (a line per item, «بلا سعر»);
//      written by the worker only;
//   4. res.partner: the supplier's dues and payments (one2many), and three
//      computes — due, approved paid, remaining (= due − paid);
//   5. automations: on create — the reference, today's Riyadh date, and a
//      payment Baraa creates in Odoo is approved at once (cash or transfer),
//      then a webhook to the sim worker; locked once approved or rejected (no
//      edit, no delete);
//   6. buttons «اعتماد» (code, then webhook) and «رفض» (the reason is
//      required; code, then webhook) on a pending payment; «تسجيل دفعة» and
//      «🔄 إعادة حساب المستحقات» (webhook) on the supplier's account;
//   7. views, and menus: UTAK ← «💵 دفع الموردين» (the suppliers: due, paid,
//      remaining), 🛒 المشتريات ← «دفعات الموردين» (pending first) and
//      «مستحقات الموردين اليومية»;
//   8. utak_supplier_payment_sent on x_whatsapp_template (purpose
//      supplier_payment_sent, status / category as Meta has them).
//
//   node scripts/s37-20260925-odoo.mjs                  dry-run (default): the plan, nothing written
//   node scripts/s37-20260925-odoo.mjs --apply          snapshot first, then write (idempotent)
//   node scripts/s37-20260925-odoo.mjs --verify         read-only checks (incl. the Python computes vs the worker's sums)
//   node scripts/s37-20260925-odoo.mjs --rollback [--apply]          menus and automations off, the template row back to «other» (nothing deleted)
//   node scripts/s37-20260925-odoo.mjs --rollback --drop [--apply]   and delete what this script created (drops the records too)
//
// Rollback file: scripts/artifacts/s37-20260925-odoo-rollback.json. No WhatsApp. Tenant shared with prod.
import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SUPPLIER_PAYMENT_TEMPLATE } from "./s37-20260925-supplier-payment-template.mjs";
import { CODE, DUE_TOTAL_COMPUTE, LOCK_WATCH, PAID_TOTAL_COMPUTE, REMAINING_COMPUTE, SEQ_CODE } from "./lib/s37-odoo-code.mjs";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const ROLLBACK = process.argv.includes("--rollback");
const DROP = process.argv.includes("--drop");
const RB = new URL("./artifacts/s37-20260925-odoo-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

const UTAK_MENU = 529;         // UTAK
const PURCHASE_MENU = 547;     // UTAK ← 🛒 المشتريات
const USER_GROUP_ID = 1;       // «Role / User», as on x_price_day / x_wa_message
const HOOK_PATH = "/odoo/hook/supplier-pay";
const SP = "x_supplier_payment", DUE = "x_supplier_due", LINE = "x_supplier_due_line";
const TPL = SUPPLIER_PAYMENT_TEMPLATE;

const SP_FIELDS = [
  { name: "x_supplier_id", ttype: "many2one", relation: "res.partner", field_description: "المورد", required: true, index: true, on_delete: "restrict" },
  { name: "x_date", ttype: "date", field_description: "التاريخ", index: true },
  { name: "x_amount", ttype: "float", field_description: "المبلغ (ر.س)", required: true },
  { name: "x_method", ttype: "selection", field_description: "الطريقة", selection: "[('cash', 'نقداً'), ('transfer', 'تحويل')]", required: true },
  { name: "x_recorded_by", ttype: "many2one", relation: "res.partner", field_description: "سجّلها", on_delete: "set null" },
  { name: "x_channel", ttype: "selection", field_description: "المصدر", selection: "[('odoo', 'Odoo'), ('whatsapp', 'واتساب')]" },
  { name: "x_state", ttype: "selection", field_description: "الحالة", selection: "[('pending', 'بانتظار الاعتماد'), ('approved', 'معتمدة'), ('rejected', 'مرفوضة')]", index: true },
  { name: "x_receipt", ttype: "binary", field_description: "مرفق الإيصال" },
  { name: "x_receipt_filename", ttype: "char", field_description: "اسم ملف الإيصال" },
  { name: "x_note", ttype: "text", field_description: "ملاحظة" },
  { name: "x_reject_reason", ttype: "text", field_description: "سبب الرفض" },
  { name: "x_decided_by", ttype: "many2one", relation: "res.users", field_description: "اعتمدها / رفضها", on_delete: "set null" },
  { name: "x_decided_at", ttype: "datetime", field_description: "وقت الاعتماد / الرفض" },
  { name: "x_overpaid", ttype: "boolean", field_description: "رصيد دائن" },
  { name: "x_remaining_after", ttype: "float", field_description: "المتبقي للمورد بعدها" },
  { name: "x_supplier_notice", ttype: "char", field_description: "إشعار المورد" },
  { name: "x_settled_at", ttype: "datetime", field_description: "وقت المعالجة (الوركر)" },
  { name: "x_trial_tag", ttype: "char", field_description: "وسم تجربة" },
  { name: "x_source_wamid", ttype: "char", field_description: "رسالة واتساب المصدر", index: true },
  { name: "x_is_simulation", ttype: "boolean", field_description: "محاكاة" },
];
const DUE_FIELDS = [
  { name: "x_supplier_id", ttype: "many2one", relation: "res.partner", field_description: "المورد", required: true, index: true, on_delete: "restrict" },
  { name: "x_purchase_list_id", ttype: "many2one", relation: "x_purchase_list", field_description: "قائمة الشراء", index: true, on_delete: "set null" },
  { name: "x_date", ttype: "date", field_description: "التاريخ", index: true },
  { name: "x_amount", ttype: "float", field_description: "المستحق (ر.س)" },
  { name: "x_unpriced_count", ttype: "integer", field_description: "أسطر بلا سعر" },
  { name: "x_is_simulation", ttype: "boolean", field_description: "محاكاة" },
];
const LINE_FIELDS = [
  { name: "x_due_id", ttype: "many2one", relation: DUE, field_description: "المستحق", required: true, index: true, on_delete: "cascade" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", field_description: "الصنف", on_delete: "restrict" },
  { name: "x_packaging_id", ttype: "many2one", relation: "x_product_packaging", field_description: "التعبئة", on_delete: "restrict" },
  { name: "x_quantity", ttype: "float", field_description: "الكمية" },
  { name: "x_unit_price", ttype: "float", field_description: "سعر الشراء" },
  { name: "x_subtotal", ttype: "float", field_description: "المبلغ (ر.س)" },
  { name: "x_no_price", ttype: "boolean", field_description: "بلا سعر" },
  { name: "x_daily_price_id", ttype: "many2one", relation: "x_daily_price", field_description: "سعر المورد (السجل)", on_delete: "set null" },
  { name: "x_note", ttype: "char", field_description: "ملاحظة" },
  { name: "x_is_simulation", ttype: "boolean", field_description: "محاكاة" },
];
const PARTNER_O2M = [
  { name: "x_sp_due_ids", ttype: "one2many", relation: DUE, relation_field: "x_supplier_id", field_description: "المستحقات اليومية (دفع الموردين)" },
  { name: "x_sp_payment_ids", ttype: "one2many", relation: SP, relation_field: "x_supplier_id", field_description: "دفعات المورد" },
];
const PARTNER_COMPUTES = [
  { name: "x_sp_due_total", ttype: "float", field_description: "المستحق للمورد", compute: DUE_TOTAL_COMPUTE, depends: "x_sp_due_ids.x_amount", store: false, readonly: true },
  { name: "x_sp_paid_total", ttype: "float", field_description: "المدفوع للمورد (المعتمد)", compute: PAID_TOTAL_COMPUTE, depends: "x_sp_payment_ids.x_amount,x_sp_payment_ids.x_state", store: false, readonly: true },
  { name: "x_sp_remaining", ttype: "float", field_description: "المتبقي للمورد", compute: REMAINING_COMPUTE, depends: "x_sp_due_ids.x_amount,x_sp_payment_ids.x_amount,x_sp_payment_ids.x_state", store: false, readonly: true },
];
const VIEWS = {
  payForm: (a) => `<form string="دفعة مورد" duplicate="0">
  <header>
    <button name="${a.approve}" type="action" string="اعتماد" class="btn-primary" invisible="x_state != 'pending'" confirm="اعتماد هذه الدفعة؟ يُقفل السجل ويصل المورد إشعار."/>
    <button name="${a.reject}" type="action" string="رفض" invisible="x_state != 'pending'" confirm="رفض هذه الدفعة؟ لازم «سبب الرفض» مكتوباً."/>
    <field name="x_state" widget="statusbar" statusbar_visible="pending,approved,rejected"/>
  </header>
  <sheet>
    <div class="oe_title"><h1><field name="x_name" readonly="1" placeholder="SP-…"/></h1></div>
    <div class="alert alert-warning" role="alert" invisible="not x_overpaid">«رصيد دائن»: المدفوع المعتمد لهذا المورد أكبر من مستحقه.</div>
    <group>
      <group>
        <field name="x_supplier_id" readonly="id and x_state != 'pending'" domain="[('supplier_rank', '&gt;', 0)]" options="{'no_create': True}"/>
        <field name="x_amount" readonly="id and x_state != 'pending'"/>
        <field name="x_method" readonly="id and x_state != 'pending'"/>
        <field name="x_date" readonly="id and x_state != 'pending'"/>
      </group>
      <group>
        <field name="x_recorded_by" readonly="1"/>
        <field name="x_channel" readonly="1"/>
        <field name="x_decided_by" readonly="1" invisible="not x_decided_by"/>
        <field name="x_decided_at" readonly="1" invisible="not x_decided_at"/>
        <field name="x_remaining_after" readonly="1" invisible="x_state != 'approved'"/>
        <field name="x_overpaid" readonly="1" invisible="not x_overpaid"/>
        <field name="x_supplier_notice" readonly="1" invisible="not x_supplier_notice"/>
        <field name="x_trial_tag" readonly="1" invisible="not x_trial_tag"/>
      </group>
    </group>
    <group>
      <field name="x_receipt_filename" invisible="1"/>
      <field name="x_receipt" filename="x_receipt_filename" readonly="id and x_state != 'pending'"/>
      <field name="x_note" readonly="id and x_state != 'pending'"/>
      <field name="x_reject_reason" readonly="x_state != 'pending'" invisible="not id or x_state == 'approved'" placeholder="مطلوب قبل «رفض»"/>
    </group>
  </sheet>
</form>`,
  payList: `<list string="دفعات الموردين" default_order="x_date desc, id desc" decoration-warning="x_state == 'pending'" decoration-muted="x_state == 'rejected'" decoration-danger="x_overpaid">
  <field name="x_name"/>
  <field name="x_date"/>
  <field name="x_supplier_id"/>
  <field name="x_amount" sum="المجموع"/>
  <field name="x_method"/>
  <field name="x_state"/>
  <field name="x_recorded_by"/>
  <field name="x_channel" optional="hide"/>
  <field name="x_overpaid" optional="show"/>
  <field name="x_supplier_notice" optional="hide"/>
</list>`,
  paySearch: `<search string="دفعات الموردين">
  <field name="x_name"/>
  <field name="x_supplier_id"/>
  <filter name="f_pending" string="بانتظار الاعتماد" domain="[('x_state', '=', 'pending')]"/>
  <filter name="f_approved" string="معتمدة" domain="[('x_state', '=', 'approved')]"/>
  <filter name="f_rejected" string="مرفوضة" domain="[('x_state', '=', 'rejected')]"/>
  <filter name="f_overpaid" string="رصيد دائن" domain="[('x_overpaid', '=', True)]"/>
  <group>
    <filter name="g_supplier" string="المورد" context="{'group_by': 'x_supplier_id'}"/>
    <filter name="g_state" string="الحالة" context="{'group_by': 'x_state'}"/>
  </group>
</search>`,
  dueForm: `<form string="مستحق مورد يومي" create="0" edit="0" delete="0" duplicate="0">
  <sheet>
    <div class="oe_title"><h1><field name="x_name" readonly="1"/></h1></div>
    <group>
      <group><field name="x_supplier_id"/><field name="x_date"/><field name="x_purchase_list_id"/></group>
      <group><field name="x_amount"/><field name="x_unpriced_count"/></group>
    </group>
    <field name="x_line_ids">
      <list decoration-danger="x_no_price" create="0" delete="0">
        <field name="x_product_tmpl_id"/>
        <field name="x_packaging_id"/>
        <field name="x_quantity"/>
        <field name="x_unit_price"/>
        <field name="x_subtotal" sum="المستحق"/>
        <field name="x_no_price"/>
        <field name="x_note" optional="show"/>
      </list>
    </field>
  </sheet>
</form>`,
  dueList: `<list string="مستحقات الموردين اليومية" default_order="x_date desc, id desc" create="0" delete="0" decoration-danger="x_unpriced_count &gt; 0">
  <field name="x_date"/>
  <field name="x_supplier_id"/>
  <field name="x_purchase_list_id"/>
  <field name="x_amount" sum="المجموع"/>
  <field name="x_unpriced_count"/>
</list>`,
  accList: `<list string="حسابات الموردين" create="0" delete="0">
  <field name="name"/>
  <field name="x_whatsapp_number" optional="show"/>
  <field name="x_sp_due_total"/>
  <field name="x_sp_paid_total"/>
  <field name="x_sp_remaining" decoration-danger="x_sp_remaining &lt; 0" decoration-bf="x_sp_remaining &gt; 0"/>
</list>`,
  accForm: (a) => `<form string="حساب المورد" create="0" delete="0" edit="0" duplicate="0">
  <header>
    <button name="${a.newPayment}" type="action" string="تسجيل دفعة" class="btn-primary" context="{'default_x_supplier_id': id, 'default_x_method': 'transfer'}"/>
    <button name="${a.refresh}" type="action" string="🔄 إعادة حساب المستحقات"/>
  </header>
  <sheet>
    <div class="oe_title"><h1><field name="name" readonly="1"/></h1></div>
    <group>
      <group>
        <field name="x_sp_due_total"/>
        <field name="x_sp_paid_total"/>
        <field name="x_sp_remaining"/>
      </group>
      <group><field name="x_whatsapp_number" readonly="1"/></group>
    </group>
    <notebook>
      <page string="المستحقات اليومية" name="sp_dues">
        <field name="x_sp_due_ids" readonly="1">
          <list default_order="x_date desc, id desc" decoration-danger="x_unpriced_count &gt; 0">
            <field name="x_date"/>
            <field name="x_purchase_list_id"/>
            <field name="x_amount" sum="المجموع"/>
            <field name="x_unpriced_count"/>
          </list>
        </field>
      </page>
      <page string="الدفعات" name="sp_payments">
        <p class="text-muted">دفعات عمر النقدية «بانتظار الاعتماد» تُعتمد أو تُرفض من 🛒 المشتريات ← دفعات الموردين.</p>
        <field name="x_sp_payment_ids" readonly="1">
          <list default_order="x_date desc, id desc" decoration-warning="x_state == 'pending'" decoration-muted="x_state == 'rejected'" decoration-danger="x_overpaid">
            <field name="x_name"/>
            <field name="x_date"/>
            <field name="x_amount"/>
            <field name="x_method"/>
            <field name="x_state"/>
            <field name="x_recorded_by"/>
            <field name="x_overpaid"/>
          </list>
        </field>
      </page>
    </notebook>
  </sheet>
</form>`,
};

const NAMES = {
  seq: "UTAK — مرجع دفعات الموردين",
  payForm: "utak.supplier_payment_form", payList: "utak.supplier_payment_list", paySearch: "utak.supplier_payment_search",
  dueForm: "utak.supplier_due_form", dueList: "utak.supplier_due_list",
  accList: "utak.supplier_account_list", accForm: "utak.supplier_account_form",
  createCode: "utak.sp.on_create_code", createHook: "utak.sp.created_webhook",
  approveCode: "utak.sp.approve_check", approveHook: "utak.sp.decided_webhook_approve", approve: "utak.sp.approve",
  rejectCode: "utak.sp.reject_check", rejectHook: "utak.sp.decided_webhook_reject", reject: "utak.sp.reject",
  lockCode: "utak.sp.lock_check", noUnlinkCode: "utak.sp.no_unlink_check", refreshHook: "utak.sp.refresh_dues_webhook",
  onCreate: "utak.sp.on_create", lock: "utak.sp.lock", noUnlink: "utak.sp.no_unlink",
  accounts: "UTAK — دفع الموردين", payments: "UTAK — دفعات الموردين", dues: "UTAK — مستحقات الموردين اليومية", newPayment: "UTAK — تسجيل دفعة مورد",
  menuAccounts: "💵 دفع الموردين", menuPayments: "دفعات الموردين", menuDues: "مستحقات الموردين اليومية",
  accessSp: "x_supplier_payment user", accessDue: "x_supplier_due user", accessLine: "x_supplier_due_line user",
};

const find = async (model, domain) => (await call(model, "search_read", { domain, fields: ["id"], limit: 50, context: { active_test: false } })).map((r) => r.id);
const one = async (model, domain) => (await find(model, domain))[0];
const modelId = async (m) => one("ir.model", [["model", "=", m]]);
const fieldId = async (m, f) => one("ir.model.fields", [["model", "=", m], ["name", "=", f]]);

async function hookUrls() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", "wa_inbox.reply_webhook"]], fields: ["webhook_url"], limit: 1 });
  const m = /^(https?:\/\/[^/]+)\/.*[?&]token=([^&]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error("could not read origin/token from wa_inbox.reply_webhook");
  if (!m[1].includes("utak-worker-sim")) throw new Error(`webhook origin is not the sim worker: ${m[1]}`);
  const u = (op) => `${m[1]}${HOOK_PATH}?token=${m[2]}&op=${op}`;
  return { origin: m[1], created: u("created"), decided: u("decided"), refresh: u("refresh") };
}

async function assertFields(model, names) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !f[n]);
  if (missing.length) throw new Error(`${model}: missing ${missing.join(",")} — stop`);
}

/** The Odoo computes (python3, stub records) against the worker's halalas sums (src/supplier-pay.ts). */
async function pythonComputeCheck(dueCode, paidCode, remCode) {
  const { halalas } = await import("../src/supplier-pay.ts").catch(() => ({ halalas: null }));
  const cases = [
    { dues: [150.5, 26.25, 0], pays: [[100, "approved"], [50.75, "pending"], [10, "rejected"]] },
    { dues: [78, 45, 13], pays: [[136, "approved"]] },
    { dues: [0.1, 0.2], pays: [[0.3, "approved"]] },
    { dues: [1500], pays: [[1000, "approved"], [700, "approved"]] },
    { dues: [], pays: [[25.5, "approved"]] },
    { dues: [33.33, 33.33, 33.34], pays: [] },
  ];
  const py = `
import json, sys
class L(list):
    def mapped(self, f):
        return [getattr(x, f) for x in self]
    def filtered(self, fn):
        return L([x for x in self if fn(x)])
class R:
    def __init__(self, **kw):
        self.__dict__.update(kw)
    def __setitem__(self, k, v):
        self.__dict__[k] = v
    def __getitem__(self, k):
        return self.__dict__[k]
out = []
for c in json.loads(sys.argv[1]):
    rec = R(x_sp_due_ids=L([R(x_amount=a) for a in c['dues']]), x_sp_payment_ids=L([R(x_amount=a, x_state=s) for a, s in c['pays']]))
    self = [rec]
${[dueCode, paidCode, remCode].map((code) => code.split("\n").map((l) => "    " + l).join("\n")).join("\n")}
    out.append([rec['x_sp_due_total'], rec['x_sp_paid_total'], rec['x_sp_remaining']])
print(json.dumps(out))
`;
  const res = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(cases)], { encoding: "utf8" }));
  const js = halalas ? cases.map((c) => {
    const d = c.dues.reduce((a, x) => a + halalas(x), 0);
    const p = c.pays.filter(([, s]) => s === "approved").reduce((a, [x]) => a + halalas(x), 0);
    return [d / 100, p / 100, (d - p) / 100];
  }) : null;
  return { cases, python: res, js, equal: !!js && JSON.stringify(js) === JSON.stringify(res) };
}

// ---------------------------------------------------------------- state
async function state() {
  return {
    seq: await one("ir.sequence", [["code", "=", SEQ_CODE]]),
    spModel: await modelId(SP), dueModel: await modelId(DUE), lineModel: await modelId(LINE),
    views: Object.fromEntries(await Promise.all(["payForm", "payList", "paySearch", "dueForm", "dueList", "accList", "accForm"].map(async (k) => [k, await one("ir.ui.view", [["name", "=", NAMES[k]]])]))),
    actions: Object.fromEntries(await Promise.all(["createCode", "createHook", "approveCode", "approveHook", "approve", "rejectCode", "rejectHook", "reject", "lockCode", "noUnlinkCode", "refreshHook"].map(async (k) => [k, await one("ir.actions.server", [["name", "=", NAMES[k]]])]))),
    automations: Object.fromEntries(await Promise.all(["onCreate", "lock", "noUnlink"].map(async (k) => [k, await one("base.automation", [["name", "=", NAMES[k]]])]))),
    windows: Object.fromEntries(await Promise.all(["accounts", "payments", "dues", "newPayment"].map(async (k) => [k, await one("ir.actions.act_window", [["name", "=", NAMES[k]]])]))),
    menuAccounts: await one("ir.ui.menu", [["name", "=", NAMES.menuAccounts], ["parent_id", "=", UTAK_MENU]]),
    menuPayments: await one("ir.ui.menu", [["name", "=", NAMES.menuPayments], ["parent_id", "=", PURCHASE_MENU]]),
    menuDues: await one("ir.ui.menu", [["name", "=", NAMES.menuDues], ["parent_id", "=", PURCHASE_MENU]]),
  };
}

await assertFields("ir.model", ["name", "model", "access_ids", "order"]);
await assertFields("ir.model.fields", ["model_id", "name", "field_description", "ttype", "relation", "relation_field", "selection", "on_delete", "index", "required", "compute", "depends", "store", "readonly"]);
await assertFields("ir.ui.view", ["name", "model", "type", "arch_base", "inherit_id", "mode", "priority"]);
await assertFields("ir.actions.server", ["name", "model_id", "state", "code", "webhook_url", "webhook_field_ids", "child_ids", "sequence"]);
await assertFields("base.automation", ["name", "model_id", "trigger", "trigger_field_ids", "action_server_ids", "active", "filter_domain", "filter_pre_domain"]);
await assertFields("ir.actions.act_window", ["name", "res_model", "view_mode", "view_id", "view_ids", "search_view_id", "context", "domain", "target"]);
await assertFields("ir.ui.menu", ["name", "parent_id", "action", "sequence", "active"]);
await assertFields("ir.sequence", ["name", "code", "prefix", "padding", "use_date_range", "implementation", "company_id"]);
await assertFields("x_purchase_list", ["x_date", "x_status", "x_supplier_id", "x_aggregated_items", "x_ahmad_confirmed_at"]);
await assertFields("x_daily_price", ["x_date", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_price_sar", "x_extraction_status"]);
await assertFields("x_whatsapp_template", ["x_meta_template_id", "x_language", "x_meta_status", "x_category", "x_param_count", "x_purpose", "x_label_ar", "x_meta_id", "x_body_text", "x_buttons_text"]);
await assertFields("res.partner", ["x_whatsapp_number", "supplier_rank"]);

const purposeField = (await call("ir.model.fields", "search_read", { domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]], fields: ["id"] }))[0]?.id;
const selectionId = async (value) => one("ir.model.fields.selection", [["field_id", "=", purposeField], ["value", "=", value]]);
const tplRow = async () => (await call("x_whatsapp_template", "search_read", { domain: [["x_meta_template_id", "=", TPL.name]], fields: ["id", "x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_label_ar", "x_meta_id", "x_body_text", "x_buttons_text"], limit: 5 }))[0] ?? null;

async function metaTemplate() {
  const env = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const r = await fetch(`https://graph.facebook.com/v22.0/2144001136512196/message_templates?name=${TPL.name}&fields=id,name,status,category,components`, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
  const j = await r.json();
  const t = (j.data ?? []).find((x) => x.name === TPL.name);
  if (!t) return null;
  const body = (t.components ?? []).find((c) => c.type === "BODY")?.text ?? "";
  return { id: t.id, status: t.status, category: t.category, body, vars: (body.match(/\{\{\d+\}\}/g) ?? []).length };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const c = rb.created ?? {};
  const menus = [c.menuAccounts, c.menuPayments, c.menuDues].filter(Boolean);
  const autos = Object.values(c.automations ?? {}).filter(Boolean);
  log(`menus off: ${menus.join(",") || "-"}; automations off: ${autos.join(",") || "-"}; template row ${c.tplRow ?? "-"} → x_purpose other`);
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (autos.length) await call("base.automation", "write", { ids: autos, vals: { active: false } });
    if (c.tplRow) await call("x_whatsapp_template", "write", { ids: [c.tplRow], vals: { x_purpose: "other" } });
  }
  if (DROP) {
    const order = [
      ["ir.ui.menu", menus], ["base.automation", autos],
      ["ir.actions.act_window", Object.values(c.windows ?? {}).filter(Boolean)],
      ["ir.actions.server", ["approve", "reject", "approveCode", "approveHook", "rejectCode", "rejectHook", "createCode", "createHook", "lockCode", "noUnlinkCode", "refreshHook"].map((k) => c.actions?.[k]).filter(Boolean)],
      ["ir.ui.view", Object.values(c.views ?? {}).filter(Boolean)],
      ["x_whatsapp_template", [c.tplRow].filter(Boolean)],
      ["ir.model.fields", (c.partnerFields ?? []).slice().reverse()],
      ["ir.model", [c.lineModel, c.dueModel, c.spModel].filter(Boolean)],
      ["ir.sequence", [c.seq].filter(Boolean)],
      ["ir.model.fields.selection", [c.purposeSelection].filter(Boolean)],
    ];
    for (const [m, ids] of order) {
      log(`drop ${m} ${ids.join(",") || "-"}`);
      if (APPLY && ids.length) await call(m, "unlink", { ids });
    }
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const s = await state();
  let ok = 0, bad = 0;
  const check = (name, cond, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name} ${detail}`); } };
  const [seq] = s.seq ? await call("ir.sequence", "read", { ids: [s.seq], fields: ["code", "prefix", "padding", "use_date_range", "implementation"] }) : [];
  check("sequence SP-%(range_year)s-, 4 digits, yearly range, no gap", seq?.prefix === "SP-%(range_year)s-" && seq?.padding === 4 && seq?.use_date_range === true && seq?.implementation === "no_gap", JSON.stringify(seq));
  for (const [model, defs] of [[SP, SP_FIELDS], [DUE, DUE_FIELDS], [LINE, LINE_FIELDS]]) {
    const f = await call(model, "fields_get", { attributes: ["type", "relation", "selection", "required"] });
    for (const d of defs) check(`${model}.${d.name} ${d.ttype}`, f[d.name]?.type === d.ttype && (!d.relation || f[d.name]?.relation === d.relation));
  }
  const spf = await call(SP, "fields_get", { attributes: ["selection", "string"] });
  check("x_state = pending/approved/rejected", JSON.stringify((spf.x_state?.selection ?? []).map((x) => x[0])) === JSON.stringify(["pending", "approved", "rejected"]));
  check("x_method = cash/transfer", JSON.stringify((spf.x_method?.selection ?? []).map((x) => x[0])) === JSON.stringify(["cash", "transfer"]));
  check("x_name labelled «المرجع»", spf.x_name?.string === "المرجع", spf.x_name?.string);
  const df = await call(DUE, "fields_get", { attributes: ["type", "relation"] });
  check(`${DUE}.x_line_ids one2many → ${LINE}`, df.x_line_ids?.type === "one2many" && df.x_line_ids?.relation === LINE);
  const pf = await call("res.partner", "fields_get", { attributes: ["type", "relation", "store"] });
  for (const d of [...PARTNER_O2M, ...PARTNER_COMPUTES]) check(`res.partner.${d.name} ${d.ttype}${d.compute ? " (compute, not stored)" : ""}`, pf[d.name]?.type === d.ttype && (!d.relation || pf[d.name]?.relation === d.relation) && (!d.compute || pf[d.name]?.store === false));
  const comp = await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "in", PARTNER_COMPUTES.map((d) => d.name)]], fields: ["name", "compute", "depends"] });
  const byN = Object.fromEntries(comp.map((c) => [c.name, c]));
  check("the three computes stored as written", PARTNER_COMPUTES.every((d) => byN[d.name]?.compute?.trim() === d.compute.trim() && byN[d.name]?.depends === d.depends));
  const py = await pythonComputeCheck(byN.x_sp_due_total?.compute ?? DUE_TOTAL_COMPUTE, byN.x_sp_paid_total?.compute ?? PAID_TOTAL_COMPUTE, byN.x_sp_remaining?.compute ?? REMAINING_COMPUTE);
  check(`Python computes = the worker's sums on ${py.cases.length} cases (pending / rejected not paid)`, py.equal, JSON.stringify({ python: py.python, js: py.js }));
  for (const k of Object.keys(s.views)) check(`view ${NAMES[k]}`, !!s.views[k]);
  for (const k of Object.keys(s.actions)) check(`server action ${NAMES[k]}`, !!s.actions[k]);
  const acts = await call("ir.actions.server", "read", { ids: Object.values(s.actions).filter(Boolean), fields: ["id", "name", "state", "webhook_url", "child_ids", "sequence", "code"] });
  const byName = Object.fromEntries(acts.map((a) => [a.name, a]));
  const urls = await hookUrls();
  check("approve = multi [check (code), then webhook op=decided]", byName[NAMES.approve]?.state === "multi" && JSON.stringify(byName[NAMES.approve]?.child_ids?.slice().sort()) === JSON.stringify([s.actions.approveCode, s.actions.approveHook].sort())
    && byName[NAMES.approveCode]?.sequence < byName[NAMES.approveHook]?.sequence && byName[NAMES.approveHook]?.webhook_url === urls.decided);
  check("reject = multi [reason required (code), then webhook op=decided]", byName[NAMES.reject]?.state === "multi" && JSON.stringify(byName[NAMES.reject]?.child_ids?.slice().sort()) === JSON.stringify([s.actions.rejectCode, s.actions.rejectHook].sort())
    && byName[NAMES.rejectCode]?.sequence < byName[NAMES.rejectHook]?.sequence && byName[NAMES.rejectHook]?.webhook_url === urls.decided && String(byName[NAMES.rejectCode]?.code).includes("سبب الرفض"));
  check("created webhook → sim /odoo/hook/supplier-pay?op=created", byName[NAMES.createHook]?.state === "webhook" && byName[NAMES.createHook]?.webhook_url === urls.created);
  check("refresh webhook → sim /odoo/hook/supplier-pay?op=refresh", byName[NAMES.refreshHook]?.state === "webhook" && byName[NAMES.refreshHook]?.webhook_url === urls.refresh);
  check("on-create code: sequence, Riyadh date, Odoo payment approved at once", ["next_by_code('utak.supplier.payment')", "timedelta(hours=3)", "'x_state': 'approved'"].every((x) => String(byName[NAMES.createCode]?.code).includes(x)));
  const autos = await call("base.automation", "read", { ids: Object.values(s.automations).filter(Boolean), fields: ["name", "active", "trigger", "filter_domain", "filter_pre_domain", "trigger_field_ids", "action_server_ids"] });
  const aBy = Object.fromEntries(autos.map((a) => [a.name, a]));
  check("3 automations active", autos.length === 3 && autos.every((a) => a.active), JSON.stringify(autos.map((a) => [a.name, a.active])));
  check("on create → [code, webhook] in that order", aBy[NAMES.onCreate]?.trigger === "on_create" && JSON.stringify(aBy[NAMES.onCreate]?.action_server_ids) === JSON.stringify([s.actions.createCode, s.actions.createHook]));
  const watch = [];
  for (const f of LOCK_WATCH) watch.push(await fieldId(SP, f));
  check(`lock: on write, before-state approved/rejected, watches ${LOCK_WATCH.length} fields`, aBy[NAMES.lock]?.trigger === "on_write" && String(aBy[NAMES.lock]?.filter_pre_domain).includes("approved")
    && JSON.stringify([...(aBy[NAMES.lock]?.trigger_field_ids ?? [])].sort((a, b) => a - b)) === JSON.stringify(watch.slice().sort((a, b) => a - b)), JSON.stringify(aBy[NAMES.lock]?.trigger_field_ids));
  check("no delete once approved / rejected", aBy[NAMES.noUnlink]?.trigger === "on_unlink" && String(aBy[NAMES.noUnlink]?.filter_domain).includes("rejected"));
  const gv = await call(SP, "get_views", { views: [[s.views.payForm, "form"]] });
  const arch = String(gv?.views?.form?.arch ?? "");
  check("payment form: «اعتماد» and «رفض» on pending", [s.actions.approve, s.actions.reject].every((id) => arch.includes(`name="${id}"`)) && arch.includes("x_reject_reason"));
  const ga = await call("res.partner", "get_views", { views: [[s.views.accList, "list"], [s.views.accForm, "form"]] });
  const la = String(ga?.views?.list?.arch ?? ""), fa = String(ga?.views?.form?.arch ?? "");
  check("suppliers list: due, paid, remaining", ["x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"].every((f) => la.includes(`name="${f}"`)));
  check("supplier account: «تسجيل دفعة», refresh, dues and payments", fa.includes(`name="${s.windows.newPayment}"`) && fa.includes(`name="${s.actions.refreshHook}"`) && fa.includes("x_sp_due_ids") && fa.includes("x_sp_payment_ids"));
  const pv = await call("ir.ui.view", "read", { ids: [s.views.accList, s.views.accForm].filter(Boolean), fields: ["priority", "mode", "inherit_id"] });
  check("the supplier views never replace the partner's default views (priority 90, primary, no inherit)", pv.length === 2 && pv.every((v) => v.priority === 90 && v.mode === "primary" && !v.inherit_id));
  const [acc] = await call("ir.actions.act_window", "read", { ids: [s.windows.accounts], fields: ["res_model", "domain", "view_ids"] });
  check("«💵 دفع الموردين» → res.partner suppliers with the two views", acc?.res_model === "res.partner" && String(acc?.domain).includes("supplier_rank") && (acc?.view_ids ?? []).length === 2);
  const menus = await call("ir.ui.menu", "read", { ids: [s.menuAccounts, s.menuPayments, s.menuDues].filter(Boolean), fields: ["name", "action", "parent_id", "active"] });
  check("menu UTAK ← 💵 دفع الموردين", menus.some((m) => m.name === NAMES.menuAccounts && m.action === `ir.actions.act_window,${s.windows.accounts}` && m.active));
  check("menus 🛒 المشتريات ← دفعات الموردين، مستحقات الموردين اليومية", menus.filter((m) => m.active).length === 3);
  const accs = await call("ir.model", "read", { ids: [s.spModel, s.dueModel, s.lineModel].filter(Boolean), fields: ["access_ids"] });
  check("access rights on the three models", accs.length === 3 && accs.every((a) => (a.access_ids ?? []).length > 0));
  const row = await tplRow();
  const m = await metaTemplate();
  check(`${TPL.name} row: purpose ${TPL.purpose}, 4 variables, text as at Meta`, row?.x_purpose === TPL.purpose && row?.x_param_count === 4 && row?.x_body_text === TPL.body && m?.body === TPL.body, JSON.stringify({ row, m }));
  check(`…status / category as at Meta (${m?.status}/${m?.category})`, row?.x_meta_status === m?.status && row?.x_category === m?.category);
  const holders = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", TPL.purpose]] });
  check("one row on the purpose", holders === 1, String(holders));
  const nAccounting = { moves: await call("account.move", "search_count", { domain: [] }), payments: await call("account.payment", "search_count", { domain: [] }) };
  log(`  · account.move ${nAccounting.moves}, account.payment ${nAccounting.payments} (read only)`);
  log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- plan / apply
const s = await state();
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s37-20260925-odoo.mjs", createdAt: new Date().toISOString(), created: {} };
const c = rb.created;
rb.accountingBefore ??= { moves: await call("account.move", "search_count", { domain: [] }), payments: await call("account.payment", "search_count", { domain: [] }) };
const save = () => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };
save(); // the snapshot (what exists and what this run creates) before the first write
const urls = await hookUrls();
log(`webhook target: ${urls.origin}${HOOK_PATH} · account.move ${rb.accountingBefore.moves}, account.payment ${rb.accountingBefore.payments}`);
const step = async (label, have, fn) => {
  if (have) { log(`= ${label} #${have}`); return have; }
  log(`+ ${label}`);
  if (!APPLY) return null;
  return await fn();
};

// 1. the sequence
c.seq = await step(`ir.sequence ${SEQ_CODE}`, s.seq ?? c.seq, async () => (await call("ir.sequence", "create", { vals_list: [{
  name: NAMES.seq, code: SEQ_CODE, prefix: "SP-%(range_year)s-", padding: 4, use_date_range: true, implementation: "no_gap", company_id: false,
}] }))[0]); save();

// 2. models + fields
c.spModel = await step(`model ${SP}`, s.spModel ?? c.spModel, async () => (await call("ir.model", "create", { vals_list: [{ name: "دفعة مورد", model: SP }] }))[0]); save();
c.dueModel = await step(`model ${DUE}`, s.dueModel ?? c.dueModel, async () => (await call("ir.model", "create", { vals_list: [{ name: "مستحق مورد يومي", model: DUE }] }))[0]); save();
c.lineModel = await step(`model ${LINE}`, s.lineModel ?? c.lineModel, async () => (await call("ir.model", "create", { vals_list: [{ name: "سطر مستحق مورد", model: LINE }] }))[0]); save();
c.fields ??= [];
c.partnerFields ??= [];
async function ensureFields(model, mid, defs, bucket) {
  const have = mid ? new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", mid]], fields: ["name"] })).map((r) => r.name)) : new Set();
  for (const d of defs) {
    if (have.has(d.name)) { log(`= ${model}.${d.name}`); continue; }
    log(`+ ${model}.${d.name} (${d.ttype}${d.compute ? ", compute" : ""})`);
    if (!APPLY) continue;
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...d }] });
    bucket.push(id); save();
  }
}
await ensureFields(SP, c.spModel, SP_FIELDS, c.fields);
await ensureFields(DUE, c.dueModel, DUE_FIELDS, c.fields);
await ensureFields(LINE, c.lineModel, LINE_FIELDS, c.fields);
await ensureFields(DUE, c.dueModel, [{ name: "x_line_ids", ttype: "one2many", relation: LINE, relation_field: "x_due_id", field_description: "الأسطر" }], c.fields);
const partnerModel = await modelId("res.partner");
await ensureFields("res.partner", partnerModel, PARTNER_O2M, c.partnerFields);
await ensureFields("res.partner", partnerModel, PARTNER_COMPUTES, c.partnerFields);
if (APPLY) {
  const nameField = await fieldId(SP, "x_name");
  const [nf] = await call("ir.model.fields", "read", { ids: [nameField], fields: ["field_description"] });
  if (nf?.field_description !== "المرجع") { rb.spNameLabelBefore ??= nf?.field_description; save(); await call("ir.model.fields", "write", { ids: [nameField], vals: { field_description: "المرجع" } }); }
  await call("ir.model", "write", { ids: [c.spModel], vals: { order: "x_date desc, id desc" } });
  await call("ir.model", "write", { ids: [c.dueModel], vals: { order: "x_date desc, id desc" } });
  await call("ir.model", "write", { ids: [c.lineModel], vals: { order: "id asc" } });
  for (const [mid, name] of [[c.spModel, NAMES.accessSp], [c.dueModel, NAMES.accessDue], [c.lineModel, NAMES.accessLine]]) {
    const [acc] = await call("ir.model", "read", { ids: [mid], fields: ["access_ids"] });
    if (!(acc?.access_ids ?? []).length) {
      await call("ir.model", "write", { ids: [mid], vals: { access_ids: [[0, 0, { name, group_id: USER_GROUP_ID, operation: "crud", kind: "permission", active: true }]] } });
    }
  }
} else {
  log(`+ x_name «المرجع», order and access on ${SP}, ${DUE}, ${LINE}`);
}

// 3. server actions
c.actions ??= {};
const sa = async (key, vals) => {
  c.actions[key] = await step(`server action ${NAMES[key]}`, s.actions[key] ?? c.actions[key], async () =>
    (await call("ir.actions.server", "create", { vals_list: [{ name: NAMES[key], ...vals }] }))[0]);
  save();
  return c.actions[key];
};
const stateFieldIds = APPLY ? [await fieldId(SP, "x_state"), await fieldId(SP, "x_name")] : [];
await sa("createCode", { model_id: c.spModel, state: "code", code: CODE.onCreate, sequence: 1 });
await sa("createHook", { model_id: c.spModel, state: "webhook", webhook_url: urls.created, webhook_field_ids: [[6, 0, stateFieldIds]], sequence: 2 });
await sa("approveCode", { model_id: c.spModel, state: "code", code: CODE.approve, sequence: 1 });
await sa("approveHook", { model_id: c.spModel, state: "webhook", webhook_url: urls.decided, webhook_field_ids: [[6, 0, stateFieldIds]], sequence: 2 });
await sa("approve", { model_id: c.spModel, state: "multi", child_ids: [[6, 0, [c.actions.approveCode, c.actions.approveHook].filter(Boolean)]] });
await sa("rejectCode", { model_id: c.spModel, state: "code", code: CODE.reject, sequence: 1 });
await sa("rejectHook", { model_id: c.spModel, state: "webhook", webhook_url: urls.decided, webhook_field_ids: [[6, 0, stateFieldIds]], sequence: 2 });
await sa("reject", { model_id: c.spModel, state: "multi", child_ids: [[6, 0, [c.actions.rejectCode, c.actions.rejectHook].filter(Boolean)]] });
await sa("lockCode", { model_id: c.spModel, state: "code", code: CODE.lock });
await sa("noUnlinkCode", { model_id: c.spModel, state: "code", code: CODE.noUnlink });
await sa("refreshHook", { model_id: partnerModel, state: "webhook", webhook_url: urls.refresh, webhook_field_ids: [[6, 0, []]] });

// 4. views (+ the «تسجيل دفعة» dialog action, which the account form names)
c.views ??= {};
c.windows ??= {};
const view = async (key, vals) => {
  c.views[key] = await step(`view ${NAMES[key]}`, s.views[key] ?? c.views[key], async () =>
    (await call("ir.ui.view", "create", { vals_list: [{ name: NAMES[key], ...vals }] }))[0]);
  save();
};
await view("payForm", { model: SP, type: "form", arch_base: VIEWS.payForm({ approve: c.actions.approve ?? 0, reject: c.actions.reject ?? 0 }) });
await view("payList", { model: SP, type: "list", arch_base: VIEWS.payList });
await view("paySearch", { model: SP, type: "search", arch_base: VIEWS.paySearch });
await view("dueForm", { model: DUE, type: "form", arch_base: VIEWS.dueForm });
await view("dueList", { model: DUE, type: "list", arch_base: VIEWS.dueList });
c.windows.newPayment = await step(`act_window ${NAMES.newPayment}`, s.windows.newPayment ?? c.windows.newPayment, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
  name: NAMES.newPayment, res_model: SP, view_mode: "form", view_id: c.views.payForm, target: "new",
}] }))[0]); save();
await view("accList", { model: "res.partner", type: "list", mode: "primary", priority: 90, arch_base: VIEWS.accList });
await view("accForm", { model: "res.partner", type: "form", mode: "primary", priority: 90, arch_base: VIEWS.accForm({ newPayment: c.windows.newPayment ?? 0, refresh: c.actions.refreshHook ?? 0 }) });

// 5. automations
c.automations ??= {};
const auto = async (key, vals) => {
  c.automations[key] = await step(`automation ${NAMES[key]}`, s.automations[key] ?? c.automations[key], async () =>
    (await call("base.automation", "create", { vals_list: [{ name: NAMES[key], active: true, ...vals }] }))[0]);
  save();
};
await auto("onCreate", { model_id: c.spModel, trigger: "on_create", action_server_ids: [[6, 0, [c.actions.createCode, c.actions.createHook].filter(Boolean)]] });
await auto("lock", { model_id: c.spModel, trigger: "on_write", filter_pre_domain: "[('x_state', 'in', ['approved', 'rejected'])]", action_server_ids: [[6, 0, [c.actions.lockCode].filter(Boolean)]] });
await auto("noUnlink", { model_id: c.spModel, trigger: "on_unlink", filter_domain: "[('x_state', 'in', ['approved', 'rejected'])]", action_server_ids: [[6, 0, [c.actions.noUnlinkCode].filter(Boolean)]] });
// § 35's lesson: Odoo fills trigger_field_ids from the filter's own fields — the lock watches every business field explicitly.
if (c.automations.lock) {
  const want = [];
  for (const f of LOCK_WATCH) want.push(await fieldId(SP, f));
  const [cur] = await call("base.automation", "read", { ids: [c.automations.lock], fields: ["trigger_field_ids"] });
  const have = [...(cur?.trigger_field_ids ?? [])].sort((a, b) => a - b);
  if (JSON.stringify(have) !== JSON.stringify([...want].sort((a, b) => a - b))) {
    log(`✎ automation ${NAMES.lock}: trigger fields ${JSON.stringify(have)} → ${LOCK_WATCH.join(",")}`);
    if (APPLY) { rb.lockTriggerBefore ??= have; save(); await call("base.automation", "write", { ids: [c.automations.lock], vals: { trigger_field_ids: [[6, 0, want]] } }); }
  } else log(`= automation ${NAMES.lock} watches ${LOCK_WATCH.length} fields`);
}

// 6. windows + menus
c.windows.accounts = await step(`act_window ${NAMES.accounts}`, s.windows.accounts ?? c.windows.accounts, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
  name: NAMES.accounts, res_model: "res.partner", view_mode: "list,form", domain: "[('supplier_rank', '>', 0)]", context: "{'create': False}",
  view_ids: [[0, 0, { sequence: 1, view_mode: "list", view_id: c.views.accList }], [0, 0, { sequence: 2, view_mode: "form", view_id: c.views.accForm }]],
}] }))[0]); save();
c.windows.payments = await step(`act_window ${NAMES.payments}`, s.windows.payments ?? c.windows.payments, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
  name: NAMES.payments, res_model: SP, view_mode: "list,form", search_view_id: c.views.paySearch, context: "{'search_default_f_pending': 1}",
  view_ids: [[0, 0, { sequence: 1, view_mode: "list", view_id: c.views.payList }], [0, 0, { sequence: 2, view_mode: "form", view_id: c.views.payForm }]],
}] }))[0]); save();
c.windows.dues = await step(`act_window ${NAMES.dues}`, s.windows.dues ?? c.windows.dues, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
  name: NAMES.dues, res_model: DUE, view_mode: "list,form",
  view_ids: [[0, 0, { sequence: 1, view_mode: "list", view_id: c.views.dueList }], [0, 0, { sequence: 2, view_mode: "form", view_id: c.views.dueForm }]],
}] }))[0]); save();
c.menuAccounts = await step(`menu UTAK ← ${NAMES.menuAccounts}`, s.menuAccounts ?? c.menuAccounts, async () => (await call("ir.ui.menu", "create", { vals_list: [{
  name: NAMES.menuAccounts, parent_id: UTAK_MENU, action: `ir.actions.act_window,${c.windows.accounts}`, sequence: 8,
}] }))[0]); save();
c.menuPayments = await step(`menu 🛒 المشتريات ← ${NAMES.menuPayments}`, s.menuPayments ?? c.menuPayments, async () => (await call("ir.ui.menu", "create", { vals_list: [{
  name: NAMES.menuPayments, parent_id: PURCHASE_MENU, action: `ir.actions.act_window,${c.windows.payments}`, sequence: 60,
}] }))[0]); save();
c.menuDues = await step(`menu 🛒 المشتريات ← ${NAMES.menuDues}`, s.menuDues ?? c.menuDues, async () => (await call("ir.ui.menu", "create", { vals_list: [{
  name: NAMES.menuDues, parent_id: PURCHASE_MENU, action: `ir.actions.act_window,${c.windows.dues}`, sequence: 70,
}] }))[0]); save();

// 7. the template row (purpose supplier_payment_sent), status as at Meta
const m = await metaTemplate();
if (!m) throw new Error(`${TPL.name} missing at Meta — run scripts/s37-20260925-supplier-payment-template.mjs --meta first`);
if (m.vars !== 4 || m.body !== TPL.body) throw new Error(`${TPL.name} at Meta differs (${m.vars} vars): ${m.body}`);
c.purposeSelection = (await selectionId(TPL.purpose)) ?? c.purposeSelection;
if (c.purposeSelection) log(`= selection ${TPL.purpose} #${c.purposeSelection}`);
else {
  log(`+ selection ${TPL.purpose} «${TPL.label}»`);
  if (APPLY) { const created = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: purposeField, value: TPL.purpose, name: TPL.label }] }); c.purposeSelection = Array.isArray(created) ? created[0] : created; save(); }
}
const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", TPL.purpose]], fields: ["id"] });
const row = await tplRow();
if (holders.some((h) => h.id !== row?.id)) throw new Error(`${TPL.purpose} already on another row ${JSON.stringify(holders)} — stop`);
const tvals = { x_meta_status: m.status, x_category: m.category, x_param_count: 4, x_purpose: TPL.purpose, x_label_ar: TPL.label, x_meta_id: m.id, x_body_text: TPL.body, x_buttons_text: false };
if (row) {
  const diff = Object.entries(tvals).filter(([k, v]) => row[k] !== v && !(v === false && !row[k]));
  if (!diff.length) log(`= #${row.id} ${TPL.name} (${m.status}/${m.category}) on ${TPL.purpose}`);
  else { log(`✎ #${row.id} ${TPL.name}: ${diff.map(([k, v]) => `${k}=${v}`).join(", ")}`); if (APPLY) await call("x_whatsapp_template", "write", { ids: [row.id], vals: Object.fromEntries(diff) }); }
  c.tplRow ??= row.id; save();
} else {
  log(`+ row ${TPL.name} (${m.status}/${m.category}) → ${TPL.purpose}`);
  if (APPLY) { const created = await call("x_whatsapp_template", "create", { vals_list: [{ x_meta_template_id: TPL.name, x_language: "ar", ...tvals }] }); c.tplRow = Array.isArray(created) ? created[0] : created; save(); }
}

log(APPLY ? `applied — created: ${JSON.stringify(c)}` : "dry-run: nothing written (add --apply)");
