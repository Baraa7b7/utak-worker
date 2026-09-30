// § 40 ج (2026-09-26) — the pricing engine v1 on «💰 أسعار اليوم».
//
// The day record and its lines stay (§ 35: x_price_day / x_price_day_line). What
// changes:
//   1. new line fields, written by the worker: x_market_price «سعر السوق» (the
//      median of the day's observations), x_market_count «عدد المشاهدات»,
//      x_unit_profit «ربح الوحدة», x_status «الحالة» (تلقائي / استثناء / معتمد
//      يدوياً / لم يُنشر), x_reason «السبب»; and Baraa's decision, editable in
//      the review screen or set from WhatsApp: x_decision «قرار براء» (اعتمد
//      بسعر السوق / لا تنشر / سعر معدّل), x_manual_price «السعر المعدّل»,
//      x_decided_at;
//   2. x_sale_price, x_excluded, x_blocked stop being Odoo computes from the
//      margin (sale = purchase × margin): they become plain stored fields the
//      worker writes (sale = the market price, or Baraa's). Their values stay;
//      the old compute / depends / readonly are kept in the rollback file;
//   3. the review form: purchase, market, observations, sale, profit, status,
//      reason, decision; «نشر المعتمد الآن» (the § 35 approve — its check
//      now wants one auto / manual line, not an outlier-free list);
//   4. automation 22 (changing the supplier takes his price) off: the purchase
//      price is the engine's minimum; automation 23 (the lock) also watches the
//      decision and the edited price;
//   5. product.template: «هامش الربح %» for display only — a non-stored compute
//      x_margin_view ((market − purchase) ÷ purchase, today's line) shown on
//      the card; x_margin_pct stays (not deleted), relabelled as unused.
//
//   node scripts/s40-20260926-engine.mjs                 dry-run
//   node scripts/s40-20260926-engine.mjs --apply         rollback file first, then write (idempotent)
//   node scripts/s40-20260926-engine.mjs --verify        read-only checks (the Python computes vs src/)
//   node scripts/s40-20260926-engine.mjs --rollback [--apply]           everything back as it was (nothing deleted)
//   node scripts/s40-20260926-engine.mjs --rollback --drop [--apply]    and delete the fields this script created
//
// Rollback file: scripts/artifacts/s40-20260926-engine-rollback.json. No WhatsApp. Never writes
// list_price / standard_price.
import { execFileSync } from "node:child_process";
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, fieldRow, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s40-20260926-engine-rollback.json", import.meta.url);
const DAY = "x_price_day", LINE = "x_price_day_line";
const VIEW_DAY_FORM = 2834, VIEW_PRODUCT_EXT = 2833, PRODUCT_FORM = 559;
const ACT_APPROVE_CHECK = 1000, ACT_APPROVE = 1002, ACT_UNAPPROVE = 1003, ACT_REFRESH = 1004;
const AUTO_SUPPLIER = 22, AUTO_LOCK = 23;

export const LINE_FIELDS = [
  { name: "x_market_price", ttype: "float", field_description: "سعر السوق", help: "وسيط مشاهدات السوق لليوم من كل المصادر. مشاهدة واحدة تكفي. لا ترحيل من الأمس." },
  { name: "x_market_count", ttype: "integer", field_description: "عدد المشاهدات" },
  { name: "x_unit_profit", ttype: "float", field_description: "ربح الوحدة", help: "سعر السوق − سعر الشراء − (نسبة التالف × سعر الشراء)." },
  { name: "x_status", ttype: "selection", field_description: "الحالة", selection: "[('auto', 'تلقائي'), ('exception', 'استثناء'), ('manual', 'معتمد يدوياً'), ('unpublished', 'لم يُنشر')]" },
  { name: "x_reason", ttype: "char", field_description: "السبب" },
  { name: "x_decision", ttype: "selection", field_description: "قرار براء", selection: "[('market', 'اعتمد بسعر السوق'), ('skip', 'لا تنشر'), ('edit', 'سعر معدّل')]",
    help: "للاستثناء (أو لتجاوز التلقائي) قبل موعد النشر: «سعر معدّل» يأخذ «السعر المعدّل». يُطبَّق في النبضة التالية أو بـ «🔄 إعادة الحساب»." },
  { name: "x_manual_price", ttype: "float", field_description: "السعر المعدّل" },
  { name: "x_decided_at", ttype: "datetime", field_description: "وقت القرار" },
];
/** Stored computes (§ 35) that become plain fields the worker writes. */
const TO_PLAIN = ["x_sale_price", "x_excluded", "x_blocked"];
const RELABEL = {
  x_supplier_id: "مصدر الشراء", x_offers: "عروض المصادر", x_excluded: "لم يُنشر", x_margin_pct: "هامش العرض %",
};
export const MARGIN_VIEW_CODE = `today = (datetime.datetime.now() + datetime.timedelta(hours=3)).date()
for record in self:
    value = 0.0
    rid = record.id if isinstance(record.id, int) else False
    if rid:
        line = record.env['x_price_day_line'].search([('x_day_id.x_date', '=', today), ('x_product_tmpl_id', '=', rid), ('x_cost_price', '>', 0), ('x_market_price', '>', 0)], order='x_sequence asc, id asc', limit=1)
        if line:
            value = round((line.x_market_price - line.x_cost_price) / line.x_cost_price * 100.0, 2)
    record['x_margin_view'] = value`;
const MARGIN_VIEW_FIELD = {
  name: "x_margin_view", ttype: "float", field_description: "هامش الربح %", compute: MARGIN_VIEW_CODE, depends: "", store: false, readonly: true,
  help: "للعرض فقط: (سعر السوق − سعر الشراء) ÷ سعر الشراء لليوم، من «💰 أسعار اليوم». لا يُستعمل في التسعير: سعر البيع = سعر السوق.",
};
const MARGIN_PCT_LABEL = "هامش الربح % (قديم — لا يُستعمل في التسعير)";
const APPROVE_CODE = `for rec in records:
    if rec.x_state not in ('draft', 'missed'):
        raise UserError('لا يُعتمد إلا سجل «مسودة» أو «فات الموعد».')
    if not rec.x_line_ids.filtered(lambda l: l.x_status in ('auto', 'manual') and not l.x_excluded and l.x_sale_price > 0):
        raise UserError('لا صنف معتمد للنشر: كل الأصناف استثناء بلا قرار أو «لا تنشر».')
    rec.write({'x_state': 'approved', 'x_approved_by': env.user.id, 'x_approved_at': datetime.datetime.now()})`;
const PRODUCT_EXT = `<data>
  <xpath expr="//field[@name='categ_id']" position="after">
    <field name="x_margin_view" string="هامش الربح %" readonly="1"/>
  </xpath>
</data>`;
const DAY_FORM = `<form string="أسعار اليوم" create="0" delete="0">
  <header>
    <button name="${ACT_APPROVE}" type="action" string="نشر المعتمد الآن" class="btn-primary" invisible="x_state not in ('draft', 'missed')" confirm="نشر الأصناف المعتمدة (تلقائياً أو منك) للعملاء الآن؟ الاستثناءات بلا قرار لا تُنشر."/>
    <button name="${ACT_UNAPPROVE}" type="action" string="إلغاء الاعتماد" invisible="x_state != 'approved'"/>
    <button name="${ACT_REFRESH}" type="action" string="🔄 إعادة الحساب" invisible="x_state not in ('draft', 'missed')"/>
    <field name="x_state" widget="statusbar" statusbar_visible="draft,approved,published"/>
  </header>
  <sheet>
    <div class="oe_title"><h1><field name="x_name" readonly="1"/></h1></div>
    <group>
      <group><field name="x_date" readonly="1"/><field name="x_approved_by" readonly="1"/></group>
      <group><field name="x_approved_at" readonly="1"/><field name="x_published_at" readonly="1"/></group>
    </group>
    <div class="text-muted mb-2">سعر البيع = سعر السوق (وسيط مشاهدات اليوم). ربح الوحدة = السوق − الشراء − التالف. غير الاستثناء يُعتمد ويُنشر تلقائياً في موعد النشر. الاستثناء يحتاج قرارك («قرار براء»، و«السعر المعدّل» مع «سعر معدّل»)، وإلا لا يُنشر.</div>
    <field name="x_line_ids" readonly="x_state not in ('draft', 'missed')">
      <list editable="bottom" create="0" delete="0" decoration-danger="x_status == 'exception'" decoration-success="x_status == 'manual'" decoration-muted="x_status == 'unpublished'">
        <field name="x_sequence" column_invisible="1"/>
        <field name="x_product_tmpl_id" readonly="1"/>
        <field name="x_packaging_id" readonly="1"/>
        <field name="x_cost_price" string="الشراء" readonly="1"/>
        <field name="x_supplier_id" string="من" readonly="1" optional="show"/>
        <field name="x_market_price" string="السوق" readonly="1"/>
        <field name="x_market_count" string="المشاهدات" readonly="1"/>
        <field name="x_sale_price" string="البيع" readonly="1"/>
        <field name="x_unit_profit" string="الربح" readonly="1"/>
        <field name="x_status" readonly="1"/>
        <field name="x_reason" readonly="1"/>
        <field name="x_decision"/>
        <field name="x_manual_price"/>
        <field name="x_offers" readonly="1" optional="hide"/>
      </list>
    </field>
    <group string="تقرير النشر" invisible="not x_publish_report">
      <field name="x_publish_report" nolabel="1" readonly="1" colspan="2"/>
    </group>
  </sheet>
</form>`;

const ctx = rollbackFile(RB, "scripts/s40-20260926-engine.mjs");
const { rb, save } = ctx;
const fid = async (m, f) => one("ir.model.fields", [["model", "=", m], ["name", "=", f]]);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before;
  log(`restore: ${Object.keys(b).join(", ") || "-"}`);
  if (APPLY) {
    for (const [name, v] of Object.entries(b.plain ?? {})) {
      await call("ir.model.fields", "write", { ids: [v.id], vals: { compute: v.compute, depends: v.depends, readonly: v.readonly } });
    }
    for (const [key, v] of Object.entries(b.labels ?? {})) await call("ir.model.fields", "write", { ids: [v.id], vals: { field_description: v.field_description } });
    if (b.dayForm) await call("ir.ui.view", "write", { ids: [VIEW_DAY_FORM], vals: { arch_base: b.dayForm } });
    if (b.productExt) await call("ir.ui.view", "write", { ids: [VIEW_PRODUCT_EXT], vals: { arch_base: b.productExt } });
    if (b.approveCode) await call("ir.actions.server", "write", { ids: [ACT_APPROVE_CHECK], vals: { code: b.approveCode } });
    if (b.autoSupplier !== undefined) await call("base.automation", "write", { ids: [AUTO_SUPPLIER], vals: { active: b.autoSupplier } });
    if (b.lockTriggers) await call("base.automation", "write", { ids: [AUTO_LOCK], vals: { trigger_field_ids: [[6, 0, b.lockTriggers]] } });
  }
  if (DROP) await dropCreated(rb, [["ir.model.fields", [...(rb.created.fields ?? []), rb.created.marginView].filter(Boolean)]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

/** The Python status / sale rule of the worker, checked in python3 against src/pricing-engine.ts. */
async function pythonMarginCheck(code) {
  const py = `
import json, datetime
class Line:
    def __init__(self, cost, market): self.x_cost_price = cost; self.x_market_price = market
    def __bool__(self): return True
class Env(dict):
    pass
class Model:
    def __init__(self, line): self.line = line
    def search(self, dom, order=None, limit=None): return self.line
class Rec(dict):
    def __init__(self, rid, line): super().__init__(); self.id = rid; self.env = {'x_price_day_line': Model(line)}
out = []
for cost, market in [(20, 24), (15, 15), (50, 45), (13.5, 16.25)]:
    self = [Rec(7, Line(cost, market))]
${code.split("\n").map((l) => "    " + l).join("\n")}
    out.append(self[0]['x_margin_view'])
print(json.dumps(out))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const lf = await call(LINE, "fields_get", { attributes: ["type", "selection", "readonly", "store"] });
  for (const d of LINE_FIELDS) check(`${LINE}.${d.name} ${d.ttype}`, lf[d.name]?.type === d.ttype);
  check("x_status = auto / exception / manual / unpublished", JSON.stringify((lf.x_status?.selection ?? []).map((s) => s[0])) === JSON.stringify(["auto", "exception", "manual", "unpublished"]));
  check("x_decision = market / skip / edit", JSON.stringify((lf.x_decision?.selection ?? []).map((s) => s[0])) === JSON.stringify(["market", "skip", "edit"]));
  for (const f of TO_PLAIN) {
    const r = await fieldRow(LINE, f);
    check(`${f}: a plain stored field now (no compute, not readonly)`, r && !r.compute && !r.depends && r.store === true && r.readonly === false, JSON.stringify({ c: String(r?.compute || "").slice(0, 20), d: r?.depends, s: r?.store, ro: r?.readonly }));
  }
  const kept = await call(LINE, "search_read", { domain: [["x_day_id.x_date", "=", "2026-09-25"]], fields: ["x_sale_price", "x_excluded"], order: "id asc" });
  check("the 09-25 published values kept (20.25, 51.75, 0, 31.2)", JSON.stringify(kept.map((k) => k.x_sale_price)) === JSON.stringify([20.25, 51.75, 0, 31.2]), JSON.stringify(kept));
  const [sa] = await call("ir.actions.server", "read", { ids: [ACT_APPROVE_CHECK], fields: ["code"] });
  check("approve check: v1 (an auto / manual line needed)", String(sa?.code ?? "").trim() === APPROVE_CODE.trim());
  const [a22] = await call("base.automation", "read", { ids: [AUTO_SUPPLIER], fields: ["active"], context: { active_test: false } });
  check("automation 22 (supplier → his price) off", a22?.active === false);
  const [a23] = await call("base.automation", "read", { ids: [AUTO_LOCK], fields: ["active", "trigger_field_ids"] });
  const dec = await fid(LINE, "x_decision"), man = await fid(LINE, "x_manual_price");
  check("automation 23 (the lock) also watches the decision and the edited price", a23?.active && a23.trigger_field_ids.includes(dec) && a23.trigger_field_ids.includes(man) && a23.trigger_field_ids.length === 15, JSON.stringify(a23));
  const gv = await call(DAY, "get_views", { views: [[VIEW_DAY_FORM, "form"]] });
  const arch = String(gv?.views?.form?.arch ?? "");
  check("review form: purchase, market, observations, sale, profit, status, reason, decision",
    ["x_cost_price", "x_market_price", "x_market_count", "x_sale_price", "x_unit_profit", "x_status", "x_reason", "x_decision", "x_manual_price"].every((f) => arch.includes(`name="${f}"`)) && arch.includes("نشر المعتمد الآن"));
  const pf = await call("product.template", "fields_get", { attributes: ["type", "string", "readonly", "store"] });
  check("product.template.x_margin_view «هامش الربح %» (computed, not stored)", pf.x_margin_view?.type === "float" && pf.x_margin_view?.store === false && pf.x_margin_view?.string === "هامش الربح %", JSON.stringify(pf.x_margin_view));
  check("x_margin_pct kept, relabelled unused", pf.x_margin_pct?.type === "float" && pf.x_margin_pct?.string === MARGIN_PCT_LABEL, JSON.stringify(pf.x_margin_pct));
  const pv = await call("product.template", "get_views", { views: [[PRODUCT_FORM, "form"]] });
  const parch = String(pv?.views?.form?.arch ?? "");
  check("product card shows x_margin_view, not x_margin_pct", parch.includes('name="x_margin_view"') && !parch.includes('name="x_margin_pct"'));
  const read = await call("product.template", "search_read", { domain: [["x_is_active_for_sale", "=", true]], fields: ["id", "x_margin_view"], limit: 10 });
  check(`the compute runs on the tenant (${read.length} products read)`, read.length > 0 && read.every((r) => typeof r.x_margin_view === "number"), JSON.stringify(read));
  const [mf] = await call("ir.model.fields", "search_read", { domain: [["model", "=", "product.template"], ["name", "=", "x_margin_view"]], fields: ["compute"] });
  const pyOut = await pythonMarginCheck(mf?.compute ?? MARGIN_VIEW_CODE);
  const { displayMarginPct } = await import("../src/pricing-engine.ts").catch(() => ({ displayMarginPct: null }));
  const js = displayMarginPct ? [[20, 24], [15, 15], [50, 45], [13.5, 16.25]].map(([c, m]) => displayMarginPct(c, m)) : null;
  check("the Python compute = displayMarginPct (src/pricing-engine.ts)", !!js && JSON.stringify(js) === JSON.stringify(pyOut), JSON.stringify({ py: pyOut, js }));
  done();
}

// ---------------------------------------------------------------- plan / apply
save();
const lineModel = await modelId(LINE);
// 1. the new line fields
await ensureFields(ctx, LINE, lineModel, LINE_FIELDS);
// 2. the three computes → plain fields (their values stay)
rb.before.plain ??= {};
for (const f of TO_PLAIN) {
  const r = await fieldRow(LINE, f);
  if (!r) throw new Error(`${LINE}.${f} missing — stop`);
  if (!r.compute && r.readonly === false) { log(`= ${f} is a plain field`); continue; }
  log(`✎ ${f}: compute «${r.compute.split("\n")[1]?.trim() ?? ""}…» (depends ${r.depends}, readonly ${r.readonly}) → plain, writable`);
  if (APPLY) {
    rb.before.plain[f] ??= { id: r.id, compute: r.compute, depends: r.depends, readonly: r.readonly };
    save();
    await call("ir.model.fields", "write", { ids: [r.id], vals: { compute: false, depends: false, readonly: false } });
  }
}
// 3. labels
rb.before.labels ??= {};
for (const [f, label] of Object.entries(RELABEL)) {
  const r = await fieldRow(LINE, f);
  if (r.field_description === label) { log(`= ${LINE}.${f} «${label}»`); continue; }
  log(`✎ ${LINE}.${f} «${r.field_description}» → «${label}»`);
  if (APPLY) { rb.before.labels[`${LINE}.${f}`] ??= { id: r.id, field_description: r.field_description }; save(); await call("ir.model.fields", "write", { ids: [r.id], vals: { field_description: label } }); }
}
const mp = await fieldRow("product.template", "x_margin_pct");
if (mp.field_description === MARGIN_PCT_LABEL) log(`= product.template.x_margin_pct «${MARGIN_PCT_LABEL}»`);
else {
  log(`✎ product.template.x_margin_pct «${mp.field_description}» → «${MARGIN_PCT_LABEL}»`);
  if (APPLY) { rb.before.labels["product.template.x_margin_pct"] ??= { id: mp.id, field_description: mp.field_description }; save(); await call("ir.model.fields", "write", { ids: [mp.id], vals: { field_description: MARGIN_PCT_LABEL } }); }
}
// 4. the approve check, the review form, the automations
const [sa] = await call("ir.actions.server", "read", { ids: [ACT_APPROVE_CHECK], fields: ["code", "name"] });
if (String(sa.code).trim() === APPROVE_CODE.trim()) log("= approve check v1");
else {
  log(`✎ server action ${ACT_APPROVE_CHECK} ${sa.name}: the v1 check`);
  if (APPLY) { rb.before.approveCode ??= sa.code; save(); await call("ir.actions.server", "write", { ids: [ACT_APPROVE_CHECK], vals: { code: APPROVE_CODE } }); }
}
const [dv] = await call("ir.ui.view", "read", { ids: [VIEW_DAY_FORM], fields: ["arch_db", "name"] });
if (String(dv.arch_db).includes("readonly=\"x_state not in ('draft', 'missed')\"") && String(dv.arch_db).includes('name="x_unit_profit"')) log("= review form v1");
else {
  log(`✎ view ${VIEW_DAY_FORM} ${dv.name}: the v1 review form`);
  if (APPLY) { rb.before.dayForm ??= dv.arch_db; save(); await call("ir.ui.view", "write", { ids: [VIEW_DAY_FORM], vals: { arch_base: DAY_FORM } }); }
}
const [a22] = await call("base.automation", "read", { ids: [AUTO_SUPPLIER], fields: ["active", "name"], context: { active_test: false } });
if (!a22.active) log(`= automation ${AUTO_SUPPLIER} off`);
else {
  log(`✎ automation ${AUTO_SUPPLIER} ${a22.name} → off`);
  if (APPLY) { rb.before.autoSupplier ??= true; save(); await call("base.automation", "write", { ids: [AUTO_SUPPLIER], vals: { active: false } }); }
}
const [a23] = await call("base.automation", "read", { ids: [AUTO_LOCK], fields: ["trigger_field_ids", "name"] });
const want23 = [...new Set([...a23.trigger_field_ids, await fid(LINE, "x_decision"), await fid(LINE, "x_manual_price")].filter(Boolean))];
if (want23.length === a23.trigger_field_ids.length) log(`= automation ${AUTO_LOCK} watches ${want23.length} fields`);
else {
  log(`✎ automation ${AUTO_LOCK} ${a23.name}: + x_decision, x_manual_price (${a23.trigger_field_ids.length} → ${a23.trigger_field_ids.length + 2})`);
  if (APPLY) { rb.before.lockTriggers ??= a23.trigger_field_ids; save(); await call("base.automation", "write", { ids: [AUTO_LOCK], vals: { trigger_field_ids: [[6, 0, want23]] } }); }
}
// 5. «هامش الربح %» for display (after x_market_price exists), and the card
const haveMv = await fid("product.template", "x_margin_view");
if (haveMv) log(`= product.template.x_margin_view #${haveMv}`);
else {
  log("+ product.template.x_margin_view (float, non-stored compute from today's line)");
  if (APPLY) {
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: await modelId("product.template"), ...MARGIN_VIEW_FIELD }] });
    rb.created.marginView = id; save();
    log(`  → #${id}`);
    // the compute must run on the tenant before the card shows it
    await call("product.template", "search_read", { domain: [], fields: ["id", "x_margin_view"], limit: 5 });
  }
}
const [pv] = await call("ir.ui.view", "read", { ids: [VIEW_PRODUCT_EXT], fields: ["arch_db", "name"] });
if (String(pv.arch_db).includes("x_margin_view")) log("= product card shows x_margin_view");
else {
  log(`✎ view ${VIEW_PRODUCT_EXT} ${pv.name}: x_margin_pct → x_margin_view (readonly)`);
  if (APPLY) { rb.before.productExt ??= pv.arch_db; save(); await call("ir.ui.view", "write", { ids: [VIEW_PRODUCT_EXT], vals: { arch_base: PRODUCT_EXT } }); }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
