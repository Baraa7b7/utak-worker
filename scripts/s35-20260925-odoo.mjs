// § 35 (2026-09-25): «💰 أسعار اليوم» in Odoo — the supplier-prices review,
// approval and publication record. Suppliers' prices stay in x_daily_price (§ 26).
//
//   1. product.template.x_margin_pct «هامش الربح %» (float), on the product card;
//   2. x_price_day «أسعار اليوم»: one record per Riyadh date (an automation
//      refuses a second), x_state draft / approved / published / missed, who
//      approved and when, when published, the publication report;
//   3. x_price_day_line: product, packaging, chosen supplier, the suppliers'
//      offers, purchase price, outlier, «اعتماد رغم الشذوذ», margin, and — stored
//      computes, the same integer rule as src/prices.ts computeSalePrice —
//      sale price, «مستبعد» (no margin) and «يمنع الاعتماد» (an unhandled outlier);
//   4. the form: an editable list (outliers coloured, blocked red, excluded
//      muted), «اعتماد أسعار اليوم» (a code action that checks and locks, then
//      a webhook to the sim worker that publishes), «إلغاء الاعتماد» (before
//      publication only), «🔄 تحديث» (webhook: rebuild from the prices);
//   5. automations: one record per date; changing the supplier takes that
//      supplier's price of the day; lines locked once approved / published;
//   6. menus: UTAK ← «💰 أسعار اليوم» (opens today's record, created if
//      missing), and 🛒 المشتريات ← «سجل أسعار الأيام».
//
//   (run with: node --experimental-strip-types --experimental-loader=./tests/loader.mjs — --verify imports src/prices.ts)
//   node scripts/s35-20260925-odoo.mjs                  dry-run (default): the plan, nothing written
//   node scripts/s35-20260925-odoo.mjs --apply          snapshot first, then write (idempotent)
//   node scripts/s35-20260925-odoo.mjs --verify         read-only checks (incl. the Python compute vs computeSalePrice)
//   node scripts/s35-20260925-odoo.mjs --rollback [--apply]          menus and automations off (nothing deleted)
//   node scripts/s35-20260925-odoo.mjs --rollback --drop [--apply]   and delete what this script created (drops the records too)
//
// Rollback file: scripts/artifacts/s35-20260925-odoo-rollback.json. Never
// writes list_price / standard_price. No WhatsApp. Tenant shared with prod.
import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const ROLLBACK = process.argv.includes("--rollback");
const DROP = process.argv.includes("--drop");
const RB = new URL("./artifacts/s35-20260925-odoo-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

const UTAK_MENU = 529;         // UTAK
const PURCHASE_MENU = 547;     // UTAK ← 🛒 المشتريات
const PRODUCT_FORM = 559;      // product.template.common.form
const USER_GROUP_ID = 1;       // «Role / User», as on x_team_attendance / x_wa_message
const HOOK_PATH = "/odoo/hook/prices";
const DAY = "x_price_day", LINE = "x_price_day_line";

export const SALE_COMPUTE = `for record in self:
    cost = record.x_cost_price or 0.0
    margin = record.x_margin_pct or 0.0
    if cost > 0 and margin > 0:
        c = int(cost * 100 + 0.5)
        m = int(margin * 100 + 0.5)
        record['x_sale_price'] = ((c * (10000 + m) + 5000) // 10000) / 100.0
    else:
        record['x_sale_price'] = 0.0`;
export const EXCLUDED_COMPUTE = `for record in self:
    record['x_excluded'] = not ((record.x_margin_pct or 0.0) > 0)`;
export const BLOCKED_COMPUTE = `for record in self:
    edited = abs((record.x_cost_price or 0.0) - (record.x_source_price or 0.0)) >= 0.005
    record['x_blocked'] = bool(record.x_is_outlier and not record.x_outlier_ok and not edited and (record.x_margin_pct or 0.0) > 0)`;

const DAY_FIELDS = [
  { name: "x_date", ttype: "date", field_description: "التاريخ", required: true, index: true },
  { name: "x_state", ttype: "selection", field_description: "الحالة", selection: "[('draft', 'مسودة'), ('approved', 'معتمدة'), ('published', 'منشورة'), ('missed', 'فات الموعد')]" },
  { name: "x_approved_by", ttype: "many2one", relation: "res.users", field_description: "اعتمدها", on_delete: "set null" },
  { name: "x_approved_at", ttype: "datetime", field_description: "وقت الاعتماد" },
  { name: "x_published_at", ttype: "datetime", field_description: "وقت النشر" },
  { name: "x_publish_report", ttype: "text", field_description: "تقرير النشر" },
];
const LINE_FIELDS = [
  { name: "x_day_id", ttype: "many2one", relation: DAY, field_description: "اليوم", on_delete: "cascade", required: true, index: true },
  { name: "x_sequence", ttype: "integer", field_description: "الترتيب" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", field_description: "الصنف", on_delete: "restrict" },
  { name: "x_packaging_id", ttype: "many2one", relation: "x_product_packaging", field_description: "التعبئة", on_delete: "restrict" },
  { name: "x_supplier_id", ttype: "many2one", relation: "res.partner", field_description: "المورد", on_delete: "restrict" },
  { name: "x_daily_price_id", ttype: "many2one", relation: "x_daily_price", field_description: "سعر المورد (السجل)", on_delete: "set null" },
  { name: "x_default_price_id", ttype: "many2one", relation: "x_daily_price", field_description: "الاختيار الآلي", on_delete: "set null" },
  { name: "x_source_price", ttype: "float", field_description: "سعر المورد" },
  { name: "x_cost_price", ttype: "float", field_description: "سعر الشراء" },
  { name: "x_is_outlier", ttype: "boolean", field_description: "شاذ" },
  { name: "x_outlier_ok", ttype: "boolean", field_description: "اعتماد رغم الشذوذ" },
  { name: "x_margin_pct", ttype: "float", field_description: "الهامش %" },
  { name: "x_offers", ttype: "char", field_description: "عروض الموردين" },
  { name: "x_sale_price", ttype: "float", field_description: "سعر البيع", compute: SALE_COMPUTE, depends: "x_cost_price,x_margin_pct", store: true, readonly: true },
  { name: "x_excluded", ttype: "boolean", field_description: "مستبعد (بلا هامش)", compute: EXCLUDED_COMPUTE, depends: "x_margin_pct", store: true, readonly: true },
  { name: "x_blocked", ttype: "boolean", field_description: "يمنع الاعتماد", compute: BLOCKED_COMPUTE, depends: "x_is_outlier,x_outlier_ok,x_cost_price,x_source_price,x_margin_pct", store: true, readonly: true },
];
/** The line fields the lock watches (all stored, non-computed). */
const LOCK_WATCH = ["x_day_id", "x_sequence", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_daily_price_id", "x_default_price_id", "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_offers"];
const MARGIN_FIELD = { name: "x_margin_pct", ttype: "float", field_description: "هامش الربح %", help: "هامش ربح الصنف: سعر البيع في «أسعار اليوم» = سعر الشراء × (1 + الهامش ÷ 100)، مقرّباً لخانتين. فارغ أو 0 = الصنف لا يُنشر للعملاء. لا يغيّر «سعر البيع» (list_price) ولا التكلفة." };

const CODE = {
  openToday: (formId) => `now = datetime.datetime.now() + datetime.timedelta(hours=3)
today = now.date()
rec = env['x_price_day'].search([('x_date', '=', today)], limit=1)
if not rec:
    rec = env['x_price_day'].create({'x_date': today, 'x_name': 'أسعار اليوم %s' % today.strftime('%Y-%m-%d'), 'x_state': 'draft'})
action = {'type': 'ir.actions.act_window', 'name': 'أسعار اليوم', 'res_model': 'x_price_day', 'res_id': rec.id, 'view_mode': 'form', 'views': [[${formId}, 'form']], 'target': 'current'}`,
  approve: `for rec in records:
    if rec.x_state not in ('draft', 'missed'):
        raise UserError('لا يُعتمد إلا سجل «مسودة» أو «فات الموعد».')
    blocked = rec.x_line_ids.filtered(lambda l: l.x_blocked)
    if blocked:
        raise UserError('أسعار شاذة لم تُعالج — عدّل السعر أو فعّل «اعتماد رغم الشذوذ»: %s' % '، '.join(blocked.mapped('x_product_tmpl_id.name')))
    if not rec.x_line_ids.filtered(lambda l: not l.x_excluded and l.x_sale_price > 0):
        raise UserError('لا صنف قابل للنشر: كل الأصناف بلا هامش أو بلا سعر.')
    rec.write({'x_state': 'approved', 'x_approved_by': env.user.id, 'x_approved_at': datetime.datetime.now()})`,
  unapprove: `for rec in records:
    if rec.x_state == 'published':
        raise UserError('نُشرت الأسعار للعملاء، فلا يُلغى اعتمادها.')
    if rec.x_state != 'approved':
        raise UserError('السجل غير معتمد.')
    rec.write({'x_state': 'draft', 'x_approved_by': False, 'x_approved_at': False})`,
  dayUnique: `for rec in records:
    if env['x_price_day'].search_count([('x_date', '=', rec.x_date), ('id', '!=', rec.id)]):
        raise UserError('يوجد سجل «أسعار اليوم» لتاريخ %s من قبل.' % rec.x_date)`,
  lineSupplier: `for rec in records:
    if not rec.x_supplier_id:
        continue
    p = env['x_daily_price'].search([('x_date', '=', rec.x_day_id.x_date), ('x_product_tmpl_id', '=', rec.x_product_tmpl_id.id), ('x_packaging_id', '=', rec.x_packaging_id.id), ('x_supplier_id', '=', rec.x_supplier_id.id), ('x_price_sar', '>', 0), ('x_extraction_status', '!=', 'failed')], order='id desc', limit=1)
    if not p:
        raise UserError('المورد %s لم يرسل سعراً لهذا الصنف اليوم.' % rec.x_supplier_id.name)
    if p.id != rec.x_daily_price_id.id:
        rec.write({'x_daily_price_id': p.id, 'x_source_price': p.x_price_sar, 'x_cost_price': p.x_price_sar, 'x_is_outlier': p.x_extraction_status == 'pending', 'x_outlier_ok': False})`,
  lineLock: `raise UserError('أسعار هذا اليوم معتمدة ومقفلة. «إلغاء الاعتماد» متاح قبل النشر فقط.')`,
};

const VIEWS = {
  productExt: `<data>
  <xpath expr="//field[@name='categ_id']" position="after">
    <field name="x_margin_pct" string="هامش الربح %"/>
  </xpath>
</data>`,
  dayForm: (a) => `<form string="أسعار اليوم" create="0" delete="0">
  <header>
    <button name="${a.approve}" type="action" string="اعتماد أسعار اليوم" class="btn-primary" invisible="x_state not in ('draft', 'missed')" confirm="اعتماد أسعار اليوم ونشرها للعملاء الآن؟"/>
    <button name="${a.unapprove}" type="action" string="إلغاء الاعتماد" invisible="x_state != 'approved'"/>
    <button name="${a.refresh}" type="action" string="🔄 تحديث من أسعار الموردين" invisible="x_state not in ('draft', 'missed')"/>
    <field name="x_state" widget="statusbar" statusbar_visible="draft,approved,published"/>
  </header>
  <sheet>
    <div class="oe_title"><h1><field name="x_name" readonly="1"/></h1></div>
    <group>
      <group><field name="x_date" readonly="1"/><field name="x_approved_by" readonly="1"/></group>
      <group><field name="x_approved_at" readonly="1"/><field name="x_published_at" readonly="1"/></group>
    </group>
    <field name="x_line_ids" readonly="x_state not in ('draft', 'missed')">
      <list editable="bottom" create="0" delete="0" decoration-danger="x_blocked" decoration-warning="x_is_outlier and not x_blocked" decoration-muted="x_excluded">
        <field name="x_sequence" column_invisible="1"/>
        <field name="x_blocked" column_invisible="1"/>
        <field name="x_product_tmpl_id" readonly="1"/>
        <field name="x_packaging_id" readonly="1"/>
        <field name="x_supplier_id" domain="[('supplier_rank', '>', 0)]" options="{'no_create': True, 'no_open': True}"/>
        <field name="x_offers" readonly="1"/>
        <field name="x_source_price" readonly="1" optional="hide"/>
        <field name="x_cost_price"/>
        <field name="x_is_outlier" readonly="1"/>
        <field name="x_outlier_ok"/>
        <field name="x_margin_pct"/>
        <field name="x_sale_price" readonly="1"/>
        <field name="x_excluded" readonly="1"/>
      </list>
    </field>
    <group string="تقرير النشر" invisible="not x_publish_report">
      <field name="x_publish_report" nolabel="1" readonly="1" colspan="2"/>
    </group>
  </sheet>
</form>`,
  dayList: `<list string="سجل أسعار الأيام" default_order="x_date desc" create="0" delete="0" decoration-success="x_state == 'published'" decoration-danger="x_state == 'missed'" decoration-info="x_state == 'approved'">
  <field name="x_date"/>
  <field name="x_state"/>
  <field name="x_approved_by"/>
  <field name="x_approved_at"/>
  <field name="x_published_at"/>
</list>`,
  daySearch: `<search string="أسعار الأيام">
  <field name="x_date"/>
  <filter name="f_published" string="منشورة" domain="[('x_state', '=', 'published')]"/>
  <filter name="f_missed" string="فات الموعد" domain="[('x_state', '=', 'missed')]"/>
  <filter name="f_draft" string="مسودة" domain="[('x_state', '=', 'draft')]"/>
</search>`,
};

const NAMES = {
  productExt: "product.template.form.x_margin_pct",
  dayForm: "utak.price_day_form", dayList: "utak.price_day_list", daySearch: "utak.price_day_search",
  openToday: "utak.prices.open_today", approveCode: "utak.prices.approve_check_lock", approveHook: "utak.prices.approve_webhook",
  approve: "utak.prices.approve", unapprove: "utak.prices.unapprove", refreshHook: "utak.prices.refresh_webhook",
  dayUniqueCode: "utak.prices.day_unique_check", lineSupplierCode: "utak.prices.line_supplier_price", lineLockCode: "utak.prices.line_lock_check",
  dayUnique: "utak.prices.day_unique", lineSupplier: "utak.prices.line_supplier", lineLock: "utak.prices.line_lock",
  history: "UTAK — سجل أسعار الأيام",
  menuToday: "💰 أسعار اليوم", menuHistory: "سجل أسعار الأيام",
  accessDay: "x_price_day user", accessLine: "x_price_day_line user",
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
  return { origin: m[1], approved: `${m[1]}${HOOK_PATH}?token=${m[2]}&op=approved`, refresh: `${m[1]}${HOOK_PATH}?token=${m[2]}&op=refresh` };
}

async function assertFields(model, names) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const missing = names.filter((n) => !f[n]);
  if (missing.length) throw new Error(`${model}: missing ${missing.join(",")} — stop`);
}

/** The Python computes run under python3 with a stub record — they must equal computeSalePrice. */
async function pythonComputeCheck(saleCode, blockedCode) {
  const { computeSalePrice } = await import("../src/prices.ts").catch(() => ({ computeSalePrice: null }));
  const cases = [[10, 15], [25, 20], [13.5, 12.5], [0.6, 33.33], [44, 17.5], [10.15, 10], [2.5, 7], [99.99, 1], [45, 0], [0, 20], [12.345, 10], [1.005, 50], [7.77, 33.3]];
  const py = `
import json, sys
class R(dict):
    def __getattr__(self, k):
        return self.get(k)
cases = json.loads(sys.argv[1])
out = []
for cost, margin in cases:
    self = [R(x_cost_price=cost, x_margin_pct=margin)]
${saleCode.split("\n").map((l) => "    " + l).join("\n")}
    out.append(self[0]['x_sale_price'])
bl = []
for (ol, ok, cost, src, m) in [(True, False, 10, 10, 20), (True, True, 10, 10, 20), (True, False, 12, 10, 20), (True, False, 10, 10, 0), (False, False, 10, 10, 20)]:
    self = [R(x_is_outlier=ol, x_outlier_ok=ok, x_cost_price=cost, x_source_price=src, x_margin_pct=m)]
${blockedCode.split("\n").map((l) => "    " + l).join("\n")}
    bl.append(self[0]['x_blocked'])
print(json.dumps({"sale": out, "blocked": bl}))
`;
  const res = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(cases)], { encoding: "utf8" }));
  const js = computeSalePrice ? cases.map(([c, m]) => computeSalePrice(c, m)) : null;
  return { cases, python: res.sale, js, blocked: res.blocked, equal: !!js && JSON.stringify(js) === JSON.stringify(res.sale) };
}

// ---------------------------------------------------------------- state
async function state() {
  return {
    dayModel: await modelId(DAY),
    lineModel: await modelId(LINE),
    marginField: await fieldId("product.template", "x_margin_pct"),
    views: Object.fromEntries(await Promise.all(["productExt", "dayForm", "dayList", "daySearch"].map(async (k) => [k, await one("ir.ui.view", [["name", "=", NAMES[k]]])]))),
    actions: Object.fromEntries(await Promise.all(["openToday", "approveCode", "approveHook", "approve", "unapprove", "refreshHook", "dayUniqueCode", "lineSupplierCode", "lineLockCode"].map(async (k) => [k, await one("ir.actions.server", [["name", "=", NAMES[k]]])]))),
    automations: Object.fromEntries(await Promise.all(["dayUnique", "lineSupplier", "lineLock"].map(async (k) => [k, await one("base.automation", [["name", "=", NAMES[k]]])]))),
    history: await one("ir.actions.act_window", [["name", "=", NAMES.history]]),
    menuToday: await one("ir.ui.menu", [["name", "=", NAMES.menuToday], ["parent_id", "=", UTAK_MENU]]),
    menuHistory: await one("ir.ui.menu", [["name", "=", NAMES.menuHistory], ["parent_id", "=", PURCHASE_MENU]]),
  };
}

await assertFields("ir.model", ["name", "model", "access_ids", "order"]);
await assertFields("ir.model.fields", ["model_id", "name", "field_description", "ttype", "relation", "relation_field", "selection", "help", "on_delete", "index", "required", "compute", "depends", "store", "readonly"]);
await assertFields("ir.ui.view", ["name", "model", "type", "arch_base", "arch_db", "inherit_id", "mode"]);
await assertFields("ir.actions.server", ["name", "model_id", "state", "code", "webhook_url", "webhook_field_ids", "child_ids", "sequence"]);
await assertFields("base.automation", ["name", "model_id", "trigger", "trigger_field_ids", "action_server_ids", "active", "filter_domain"]);
await assertFields("ir.actions.act_window", ["name", "res_model", "view_mode", "view_id", "search_view_id", "context"]);
await assertFields("ir.ui.menu", ["name", "parent_id", "action", "sequence", "active"]);
await assertFields("product.template", ["categ_id", "list_price", "standard_price"]);
await assertFields("x_daily_price", ["x_date", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_price_sar", "x_extraction_status"]);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const c = rb.created ?? {};
  const menus = [c.menuToday, c.menuHistory].filter(Boolean);
  const autos = Object.values(c.automations ?? {}).filter(Boolean);
  log(`menus off: ${menus.join(",") || "-"}; automations off: ${autos.join(",") || "-"}`);
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (autos.length) await call("base.automation", "write", { ids: autos, vals: { active: false } });
  }
  if (DROP) {
    const order = [
      ["ir.ui.menu", menus], ["base.automation", autos],
      ["ir.actions.server", [c.actions?.approve, c.actions?.approveCode, c.actions?.approveHook, c.actions?.unapprove, c.actions?.refreshHook, c.actions?.openToday, c.actions?.dayUniqueCode, c.actions?.lineSupplierCode, c.actions?.lineLockCode].filter(Boolean)],
      ["ir.actions.act_window", [c.history].filter(Boolean)],
      ["ir.ui.view", [c.views?.dayForm, c.views?.dayList, c.views?.daySearch, c.views?.productExt].filter(Boolean)],
      ["ir.model", [c.lineModel, c.dayModel].filter(Boolean)],
      ["ir.model.fields", [c.marginField].filter(Boolean)],
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
  const pf = await call("product.template", "fields_get", { attributes: ["type", "string"] });
  check("product.template.x_margin_pct float «هامش الربح %»", pf.x_margin_pct?.type === "float", JSON.stringify(pf.x_margin_pct));
  const df = await call(DAY, "fields_get", { attributes: ["type", "relation", "selection", "required"] });
  for (const d of DAY_FIELDS) check(`${DAY}.${d.name} ${d.ttype}`, df[d.name]?.type === d.ttype && (!d.relation || df[d.name]?.relation === d.relation));
  check("x_state = draft/approved/published/missed", JSON.stringify((df.x_state?.selection ?? []).map((x) => x[0])) === JSON.stringify(["draft", "approved", "published", "missed"]));
  check(`${DAY}.x_line_ids one2many → ${LINE}`, df.x_line_ids?.type === "one2many" && df.x_line_ids?.relation === LINE);
  const lf = await call(LINE, "fields_get", { attributes: ["type", "relation", "store", "readonly"] });
  for (const d of LINE_FIELDS) check(`${LINE}.${d.name} ${d.ttype}${d.compute ? " (stored compute)" : ""}`, lf[d.name]?.type === d.ttype && (!d.relation || lf[d.name]?.relation === d.relation) && (!d.compute || lf[d.name]?.store === true));
  const [cf] = await call("ir.model.fields", "search_read", { domain: [["model", "=", LINE], ["name", "=", "x_sale_price"]], fields: ["compute", "depends"] });
  const [bf] = await call("ir.model.fields", "search_read", { domain: [["model", "=", LINE], ["name", "=", "x_blocked"]], fields: ["compute", "depends"] });
  check("x_sale_price compute stored as written", cf?.compute?.trim() === SALE_COMPUTE.trim() && cf?.depends === "x_cost_price,x_margin_pct");
  const py = await pythonComputeCheck(cf?.compute ?? SALE_COMPUTE, bf?.compute ?? BLOCKED_COMPUTE);
  check(`Python compute = computeSalePrice on ${py.cases.length} cases`, py.equal, JSON.stringify({ python: py.python, js: py.js }));
  check("x_blocked: outlier untouched blocks; «رغم الشذوذ», an edited price, no margin, no outlier do not", JSON.stringify(py.blocked) === JSON.stringify([true, false, false, false, false]), JSON.stringify(py.blocked));
  for (const k of ["productExt", "dayForm", "dayList", "daySearch"]) check(`view ${NAMES[k]}`, !!s.views[k]);
  for (const k of Object.keys(s.actions)) check(`server action ${NAMES[k]}`, !!s.actions[k]);
  const acts = await call("ir.actions.server", "read", { ids: Object.values(s.actions).filter(Boolean), fields: ["id", "name", "state", "webhook_url", "child_ids", "sequence", "model_id"] });
  const byName = Object.fromEntries(acts.map((a) => [a.name, a]));
  const urls = await hookUrls();
  check("approve = multi [check & lock (code), then webhook]", byName[NAMES.approve]?.state === "multi" && JSON.stringify(byName[NAMES.approve]?.child_ids?.slice().sort()) === JSON.stringify([s.actions.approveCode, s.actions.approveHook].sort())
    && byName[NAMES.approveCode]?.sequence < byName[NAMES.approveHook]?.sequence);
  check("approve webhook → sim /odoo/hook/prices?op=approved", byName[NAMES.approveHook]?.state === "webhook" && byName[NAMES.approveHook]?.webhook_url === urls.approved);
  check("refresh webhook → sim /odoo/hook/prices?op=refresh", byName[NAMES.refreshHook]?.state === "webhook" && byName[NAMES.refreshHook]?.webhook_url === urls.refresh);
  const autos = await call("base.automation", "read", { ids: Object.values(s.automations).filter(Boolean), fields: ["name", "active", "trigger", "filter_domain", "trigger_field_ids"] });
  check("3 automations active", autos.length === 3 && autos.every((a) => a.active), JSON.stringify(autos));
  const lock = autos.find((a) => a.name === NAMES.lineLock);
  const watch = [];
  for (const f of LOCK_WATCH) watch.push(await fieldId(LINE, f));
  check(`the lock watches every editable line field (${LOCK_WATCH.length})`, JSON.stringify([...(lock?.trigger_field_ids ?? [])].sort((a, b) => a - b)) === JSON.stringify(watch.sort((a, b) => a - b)), JSON.stringify(lock?.trigger_field_ids));
  const gv = await call(DAY, "get_views", { views: [[s.views.dayForm, "form"]] });
  const arch = String(gv?.views?.form?.arch ?? "");
  check("form shows the three buttons", [s.actions.approve, s.actions.unapprove, s.actions.refreshHook].every((id) => arch.includes(`name="${id}"`)), arch.slice(0, 200));
  check("form: editable lines with the outlier colours", arch.includes('editable="bottom"') && arch.includes("decoration-warning") && arch.includes("decoration-danger"));
  const pgv = await call("product.template", "get_views", { views: [[PRODUCT_FORM, "form"]] });
  check("product card shows «هامش الربح %»", String(pgv?.views?.form?.arch ?? "").includes('name="x_margin_pct"'));
  const menus = await call("ir.ui.menu", "read", { ids: [s.menuToday, s.menuHistory].filter(Boolean), fields: ["name", "action", "parent_id", "active"] });
  check("menu UTAK ← 💰 أسعار اليوم → open today", menus.some((m) => m.name === NAMES.menuToday && m.action === `ir.actions.server,${s.actions.openToday}` && m.active));
  check("menu 🛒 المشتريات ← سجل أسعار الأيام", menus.some((m) => m.name === NAMES.menuHistory && m.active));
  const acc = await call("ir.model", "read", { ids: [s.dayModel, s.lineModel].filter(Boolean), fields: ["access_ids"] });
  check("access rights on both models", acc.length === 2 && acc.every((a) => (a.access_ids ?? []).length > 0));
  log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- plan / apply
const s = await state();
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s35-20260925-odoo.mjs", createdAt: new Date().toISOString(), created: {} };
const c = rb.created;
const save = () => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };
save(); // the snapshot (what exists and what this run creates) before the first write
const urls = await hookUrls();
log(`webhook target: ${urls.origin}${HOOK_PATH}`);
const step = async (label, have, fn) => {
  if (have) { log(`= ${label} #${have}`); return have; }
  log(`+ ${label}`);
  if (!APPLY) return null;
  const id = await fn();
  return id;
};

// 1. product.template.x_margin_pct
const tmplModel = await modelId("product.template");
c.marginField = await step("product.template.x_margin_pct", s.marginField ?? c.marginField, async () =>
  (await call("ir.model.fields", "create", { vals_list: [{ model_id: tmplModel, ...MARGIN_FIELD }] }))[0]); save();

// 2. models + fields (x_line_ids after the line model exists; computes after their depends)
c.dayModel = await step(`model ${DAY}`, s.dayModel ?? c.dayModel, async () => (await call("ir.model", "create", { vals_list: [{ name: "أسعار اليوم", model: DAY }] }))[0]); save();
c.lineModel = await step(`model ${LINE}`, s.lineModel ?? c.lineModel, async () => (await call("ir.model", "create", { vals_list: [{ name: "سطر أسعار اليوم", model: LINE }] }))[0]); save();
c.fields ??= [];
async function ensureFields(model, mid, defs) {
  const have = mid ? new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", mid]], fields: ["name"] })).map((r) => r.name)) : new Set();
  for (const d of defs) {
    if (have.has(d.name)) { log(`= ${model}.${d.name}`); continue; }
    log(`+ ${model}.${d.name} (${d.ttype}${d.compute ? ", stored compute" : ""})`);
    if (!APPLY) continue;
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...d }] });
    c.fields.push(id); save();
  }
}
await ensureFields(DAY, c.dayModel, DAY_FIELDS);
await ensureFields(LINE, c.lineModel, LINE_FIELDS);
await ensureFields(DAY, c.dayModel, [{ name: "x_line_ids", ttype: "one2many", relation: LINE, relation_field: "x_day_id", field_description: "الأصناف" }]);
if (APPLY) {
  await call("ir.model", "write", { ids: [c.dayModel], vals: { order: "x_date desc, id desc" } });
  await call("ir.model", "write", { ids: [c.lineModel], vals: { order: "x_sequence asc, id asc" } });
  for (const [mid, name] of [[c.dayModel, NAMES.accessDay], [c.lineModel, NAMES.accessLine]]) {
    const [acc] = await call("ir.model", "read", { ids: [mid], fields: ["access_ids"] });
    if (!(acc?.access_ids ?? []).length) {
      await call("ir.model", "write", { ids: [mid], vals: { access_ids: [[0, 0, { name, group_id: USER_GROUP_ID, operation: "crud", kind: "permission", active: true }]] } });
    }
  }
} else {
  log(`+ order / access on ${DAY} and ${LINE}`);
}

// 3. server actions (the form's buttons name them by id)
c.actions ??= {};
const sa = async (key, vals) => {
  c.actions[key] = await step(`server action ${NAMES[key]}`, s.actions[key] ?? c.actions[key], async () =>
    (await call("ir.actions.server", "create", { vals_list: [{ name: NAMES[key], ...vals }] }))[0]);
  save();
  return c.actions[key];
};
const dayFieldIds = APPLY ? [await fieldId(DAY, "x_date"), await fieldId(DAY, "x_state")] : [];
await sa("approveCode", { model_id: c.dayModel, state: "code", code: CODE.approve, sequence: 1 });
await sa("approveHook", { model_id: c.dayModel, state: "webhook", webhook_url: urls.approved, webhook_field_ids: [[6, 0, dayFieldIds]], sequence: 2 });
await sa("approve", { model_id: c.dayModel, state: "multi", child_ids: [[6, 0, [c.actions.approveCode, c.actions.approveHook].filter(Boolean)]] });
await sa("unapprove", { model_id: c.dayModel, state: "code", code: CODE.unapprove });
await sa("refreshHook", { model_id: c.dayModel, state: "webhook", webhook_url: urls.refresh, webhook_field_ids: [[6, 0, dayFieldIds]] });
await sa("dayUniqueCode", { model_id: c.dayModel, state: "code", code: CODE.dayUnique });
await sa("lineSupplierCode", { model_id: c.lineModel, state: "code", code: CODE.lineSupplier });
await sa("lineLockCode", { model_id: c.lineModel, state: "code", code: CODE.lineLock });

// 4. views
c.views ??= {};
const view = async (key, vals) => {
  c.views[key] = await step(`view ${NAMES[key]}`, s.views[key] ?? c.views[key], async () =>
    (await call("ir.ui.view", "create", { vals_list: [{ name: NAMES[key], ...vals }] }))[0]);
  save();
};
await view("productExt", { model: "product.template", type: "form", inherit_id: PRODUCT_FORM, mode: "extension", arch_base: VIEWS.productExt });
await view("dayForm", { model: DAY, type: "form", arch_base: VIEWS.dayForm({ approve: c.actions.approve ?? 0, unapprove: c.actions.unapprove ?? 0, refresh: c.actions.refreshHook ?? 0 }) });
await view("dayList", { model: DAY, type: "list", arch_base: VIEWS.dayList });
await view("daySearch", { model: DAY, type: "search", arch_base: VIEWS.daySearch });
await sa("openToday", { model_id: c.dayModel, state: "code", code: CODE.openToday(c.views.dayForm ?? "False") });

// 5. automations
c.automations ??= {};
const auto = async (key, vals) => {
  c.automations[key] = await step(`automation ${NAMES[key]}`, s.automations[key] ?? c.automations[key], async () =>
    (await call("base.automation", "create", { vals_list: [{ name: NAMES[key], active: true, ...vals }] }))[0]);
  save();
};
await auto("dayUnique", { model_id: c.dayModel, trigger: "on_create", action_server_ids: [[6, 0, [c.actions.dayUniqueCode].filter(Boolean)]] });
await auto("lineSupplier", { model_id: c.lineModel, trigger: "on_write", trigger_field_ids: [[6, 0, APPLY ? [await fieldId(LINE, "x_supplier_id")] : []]], action_server_ids: [[6, 0, [c.actions.lineSupplierCode].filter(Boolean)]] });
await auto("lineLock", { model_id: c.lineModel, trigger: "on_create_or_write", filter_domain: "[('x_day_id.x_state', 'in', ['approved', 'published'])]", action_server_ids: [[6, 0, [c.actions.lineLockCode].filter(Boolean)]] });
// 2026-09-25 (live trial) — Odoo fills trigger_field_ids from filter_domain
// (x_day_id only), so the lock fired on nothing that Baraa edits. Every stored,
// editable line field is watched explicitly; the previous value is kept.
if (c.automations.lineLock) {
  const want = [];
  for (const f of LOCK_WATCH) want.push(await fieldId(LINE, f));
  const [cur] = await call("base.automation", "read", { ids: [c.automations.lineLock], fields: ["trigger_field_ids"] });
  const have = [...(cur?.trigger_field_ids ?? [])].sort((a, b) => a - b);
  if (JSON.stringify(have) !== JSON.stringify([...want].sort((a, b) => a - b))) {
    log(`✎ automation ${NAMES.lineLock}: trigger fields ${JSON.stringify(have)} → ${LOCK_WATCH.join(",")}`);
    if (APPLY) {
      rb.lineLockTriggerBefore ??= have; save();
      await call("base.automation", "write", { ids: [c.automations.lineLock], vals: { trigger_field_ids: [[6, 0, want]] } });
    }
  } else log(`= automation ${NAMES.lineLock} watches ${LOCK_WATCH.length} fields`);
}

// 6. history action + menus
c.history = await step(`act_window ${NAMES.history}`, s.history ?? c.history, async () => (await call("ir.actions.act_window", "create", { vals_list: [{
  name: NAMES.history, res_model: DAY, view_mode: "list,form", view_id: c.views.dayList, search_view_id: c.views.daySearch,
}] }))[0]); save();
c.menuToday = await step(`menu UTAK ← ${NAMES.menuToday}`, s.menuToday ?? c.menuToday, async () => (await call("ir.ui.menu", "create", { vals_list: [{
  name: NAMES.menuToday, parent_id: UTAK_MENU, action: `ir.actions.server,${c.actions.openToday}`, sequence: 7,
}] }))[0]); save();
c.menuHistory = await step(`menu 🛒 المشتريات ← ${NAMES.menuHistory}`, s.menuHistory ?? c.menuHistory, async () => (await call("ir.ui.menu", "create", { vals_list: [{
  name: NAMES.menuHistory, parent_id: PURCHASE_MENU, action: `ir.actions.act_window,${c.history}`, sequence: 50,
}] }))[0]); save();

log(APPLY ? `applied — created: ${JSON.stringify(c)}` : "dry-run: nothing written (add --apply)");
