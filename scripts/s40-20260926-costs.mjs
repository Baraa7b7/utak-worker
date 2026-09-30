// § 40 أ (2026-09-26) — the operating costs and the pricing settings.
//
// Read first (--modules, read-only): Budget Management (account_budget) is
// «uninstalled» and the «Analytic Accounting» group has no user (the setting is
// off), hr_expense «uninstalled». So nothing is installed or switched on here
// (a new module may change the subscription): the planned costs live in a
// custom model instead —
//   1. x_operating_cost «التكاليف التشغيلية»: name, type (fixed / variable),
//      frequency (daily / monthly / yearly), amount, from / to, account
//      (optional account.account), note, x_utak_simulation; Arabic list /
//      form / search; menu UTAK ← «💰 التكاليف التشغيلية»; the first line
//      «السيارة والسائق (شامل)», variable, daily, 500, from 2026-10-01;
//   2. the pricing settings on the ACTIVE x_pricing_config record (#1, the
//      existing «إعدادات التسعير» — no parallel model): x_waste_pct 5,
//      x_min_order_sar 150, x_planned_stops empty; a form of its own (priority
//      99, so the existing action 919 keeps its default form) and the menu
//      UTAK ← «⚙️ إعدادات التسعير» (opens the active record).
//
//   node scripts/s40-20260926-costs.mjs --modules          read-only: modules / groups → artifact
//   node scripts/s40-20260926-costs.mjs                    dry-run: the plan, nothing written
//   node scripts/s40-20260926-costs.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s40-20260926-costs.mjs --verify           read-only checks
//   node scripts/s40-20260926-costs.mjs --rollback [--apply]           menus off, settings values back (nothing deleted)
//   node scripts/s40-20260926-costs.mjs --rollback --drop [--apply]    and delete what this script created
//
// Rollback file: scripts/artifacts/s40-20260926-costs-rollback.json. Tenant shared
// with prod (5c138821 never reads these fields). No WhatsApp, no account.move.
import { writeFileSync } from "node:fs";
import {
  APPLY, DROP, ROLLBACK, UTAK_MENU, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu, ensureModel,
  ensureServerAction, ensureView, log, modelId, modelOrderAccess, one, rollbackFile, step,
} from "./lib/s40-kit.mjs";

const MODULES = process.argv.includes("--modules");
const RB = new URL("./artifacts/s40-20260926-costs-rollback.json", import.meta.url);
const COST = "x_operating_cost", CFG = "x_pricing_config";

export const COST_FIELDS = [
  { name: "x_cost_type", ttype: "selection", field_description: "النوع", required: true, selection: "[('fixed', 'ثابتة'), ('variable', 'متغيرة')]" },
  { name: "x_frequency", ttype: "selection", field_description: "التكرار", required: true, selection: "[('daily', 'يومي'), ('monthly', 'شهري'), ('yearly', 'سنوي')]",
    help: "يومي: المبلغ كما هو لكل يوم. شهري: ÷ أيام عمل الشهر من جدول دوام السائق. سنوي: ÷ أيام عمل السنة. لا يُحسب يوم خارج «من / إلى»." },
  { name: "x_amount", ttype: "float", field_description: "المبلغ", required: true },
  { name: "x_date_from", ttype: "date", field_description: "من تاريخ", required: true },
  { name: "x_date_to", ttype: "date", field_description: "إلى تاريخ", help: "فارغ = بلا نهاية." },
  { name: "x_account_id", ttype: "many2one", relation: "account.account", field_description: "الحساب المحاسبي", on_delete: "set null" },
  { name: "x_note", ttype: "text", field_description: "ملاحظة" },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة (تجربة)", help: "سطر تجربة: لا يدخل في تكلفة اليوم ولا في أي حساب. لا يُحذف." },
];
export const CFG_FIELDS = [
  { name: "x_waste_pct", ttype: "float", field_description: "نسبة التالف %", help: "ربح الوحدة = سعر السوق − سعر الشراء − (نسبة التالف × سعر الشراء)." },
  { name: "x_min_order_sar", ttype: "float", field_description: "الحد الأدنى للطلب (ريال)", help: "على مجموع الطلب قبل الخصم. أقل منه: لا زر تأكيد." },
  { name: "x_planned_stops", ttype: "integer", field_description: "عدد المحطات اليومية المخطط", help: "حارس خصم الكمية: لا خصم إذا صار ربح الطلب بعد الخصم أقل من (تكلفة اليوم ÷ هذا العدد). فارغ (0) = لا خصم إطلاقاً، وتنبيه يومي حتى يُعبَّأ." },
];
export const FIRST_COST = { x_name: "السيارة والسائق (شامل)", x_cost_type: "variable", x_frequency: "daily", x_amount: 500, x_date_from: "2026-10-01", x_date_to: false };
export const SETTINGS = { x_waste_pct: 5, x_min_order_sar: 150 };

const NAMES = {
  costList: "utak.operating_cost_list", costForm: "utak.operating_cost_form", costSearch: "utak.operating_cost_search",
  settingsForm: "utak.pricing_settings_form", costWindow: "UTAK — التكاليف التشغيلية", openSettings: "utak.pricing.open_settings",
  menuCosts: "💰 التكاليف التشغيلية", menuSettings: "⚙️ إعدادات التسعير",
};
const VIEWS = {
  costList: `<list string="التكاليف التشغيلية" default_order="x_date_from desc, id desc" decoration-muted="x_utak_simulation">
  <field name="x_name" string="الاسم"/>
  <field name="x_cost_type"/>
  <field name="x_frequency"/>
  <field name="x_amount" sum="المجموع"/>
  <field name="x_date_from"/>
  <field name="x_date_to"/>
  <field name="x_account_id" optional="hide"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`,
  costForm: `<form string="تكلفة تشغيلية">
  <sheet>
    <div class="oe_title"><label for="x_name" string="الاسم"/><h1><field name="x_name" placeholder="مثلاً: السيارة والسائق (شامل)" required="1"/></h1></div>
    <group>
      <group><field name="x_cost_type"/><field name="x_frequency"/><field name="x_amount"/></group>
      <group><field name="x_date_from"/><field name="x_date_to"/><field name="x_account_id" options="{'no_create': True}"/></group>
    </group>
    <group><field name="x_note"/><field name="x_utak_simulation"/></group>
    <div class="text-muted">تكلفة اليوم = اليومي كما هو، والشهري ÷ أيام عمل الشهر، والسنوي ÷ أيام عمل السنة (من جدول دوام السائق في «الموظفون»)، لكل سطر ساري في ذلك اليوم.</div>
  </sheet>
</form>`,
  costSearch: `<search string="التكاليف التشغيلية">
  <field name="x_name" string="الاسم"/>
  <filter name="f_current" string="سارية اليوم" domain="[('x_date_from', '&lt;=', context_today().strftime('%Y-%m-%d')), '|', ('x_date_to', '=', False), ('x_date_to', '&gt;=', context_today().strftime('%Y-%m-%d'))]"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '=', False)]"/>
  <separator/>
  <filter name="g_frequency" string="التكرار" context="{'group_by': 'x_frequency'}"/>
</search>`,
  // part د adds the discount tiers to this form (scripts/s40-20260926-tiers.mjs)
  settingsForm: `<form string="إعدادات التسعير" create="0" delete="0">
  <sheet>
    <div class="oe_title"><h1>⚙️ إعدادات التسعير</h1></div>
    <group>
      <group string="التسعير اليومي">
        <field name="x_waste_pct"/>
        <field name="x_min_order_sar"/>
        <field name="x_planned_stops"/>
      </group>
      <group string="السجل">
        <field name="x_name" readonly="1"/>
        <field name="x_active_from" readonly="1"/>
      </group>
    </group>
    <div class="text-muted">سعر البيع = سعر السوق لليوم. الاستثناءات (بلا شراء، بلا سوق، ربح ≤ 0، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر. «عدد المحطات» فارغ = لا خصم كمية.</div>
  </sheet>
</form>`,
};
const openSettingsCode = (formId) => `now = datetime.datetime.now() + datetime.timedelta(hours=3)
today = now.date()
rec = env['x_pricing_config'].search([('x_is_active', '=', True), ('x_active_from', '<=', today), '|', ('x_active_to', '=', False), ('x_active_to', '>=', today)], order='x_active_from desc, id desc', limit=1)
if not rec:
    raise UserError('لا يوجد إعداد تسعير فعّال اليوم.')
action = {'type': 'ir.actions.act_window', 'name': 'إعدادات التسعير', 'res_model': 'x_pricing_config', 'res_id': rec.id, 'view_mode': 'form', 'views': [[${formId}, 'form']], 'target': 'current'}`;

/** The active config record, as src/operating-cost.ts reads it. */
async function activeConfig() {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const rows = await call(CFG, "search_read", {
    domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]],
    fields: ["id", "x_name"], order: "x_active_from desc, id desc", limit: 1,
  });
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- modules (read-only)
if (MODULES) {
  const mods = await call("ir.module.module", "search_read", {
    domain: [["name", "in", ["account_budget", "account_budget_purchase", "analytic", "hr_expense", "account_accountant", "hr"]]], fields: ["name", "state", "shortdesc"],
  });
  const [ga] = await call("res.groups", "search_read", { domain: [["name", "=", "Analytic Accounting"]], fields: ["id", "name", "user_ids", "all_user_ids", "implied_by_ids"] });
  const [gu] = await call("res.groups", "read", { ids: [1], fields: ["name", "implied_ids", "all_implied_ids"] });
  const out = {
    at: new Date().toISOString(),
    modules: Object.fromEntries(mods.map((m) => [m.name, m.state])),
    analyticGroup: ga ? { id: ga.id, users: (ga.all_user_ids ?? []).length, impliedByUserGroup: (gu?.all_implied_ids ?? []).includes(ga.id) } : null,
    budgetModels: (await call("ir.model", "search_read", { domain: [["model", "in", ["budget.analytic", "budget.line", "crossovered.budget", "hr.expense"]]], fields: ["model"] })).map((m) => m.model),
  };
  out.decision = out.modules.account_budget === "installed" && out.analyticGroup?.users > 0 ? "budgets" : "x_operating_cost";
  writeFileSync(new URL("./artifacts/s40-20260926-modules.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const ctx = rollbackFile(RB, "scripts/s40-20260926-costs.mjs");
const { rb, save } = ctx;

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const menus = Object.values(c.menus ?? {}).filter(Boolean);
  log(`menus off: ${menus.join(",") || "-"}`);
  const before = rb.before.settings;
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (before?.id) await call(CFG, "write", { ids: [before.id], vals: before.vals });
  } else if (before?.id) log(`settings #${before.id} back to ${JSON.stringify(before.vals)}`);
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", menus],
      ["ir.actions.server", Object.values(c.actions ?? {})],
      ["ir.actions.act_window", Object.values(c.windows ?? {})],
      ["ir.ui.view", Object.values(c.views ?? {})],
      ["ir.model", [c.costModel]],                  // its fields and records go with it
      ["ir.model.fields", c.cfgFields ?? []],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const cf = await call(COST, "fields_get", { attributes: ["type", "relation", "selection", "required"] });
  for (const d of COST_FIELDS) check(`${COST}.${d.name} ${d.ttype}`, cf[d.name]?.type === d.ttype && (!d.relation || cf[d.name]?.relation === d.relation));
  check("x_cost_type = fixed / variable", JSON.stringify((cf.x_cost_type?.selection ?? []).map((s) => s[0])) === JSON.stringify(["fixed", "variable"]));
  check("x_frequency = daily / monthly / yearly", JSON.stringify((cf.x_frequency?.selection ?? []).map((s) => s[0])) === JSON.stringify(["daily", "monthly", "yearly"]));
  const gf = await call(CFG, "fields_get", { attributes: ["type"] });
  for (const d of CFG_FIELDS) check(`${CFG}.${d.name} ${d.ttype}`, gf[d.name]?.type === d.ttype);
  const first = await call(COST, "search_read", { domain: [["x_name", "=", FIRST_COST.x_name]], fields: Object.keys(FIRST_COST) });
  check("one line «السيارة والسائق (شامل)» متغيرة يومي 500 من 2026-10-01 بلا نهاية", first.length === 1
    && first[0].x_cost_type === "variable" && first[0].x_frequency === "daily" && first[0].x_amount === 500
    && first[0].x_date_from === "2026-10-01" && first[0].x_date_to === false && !first[0].x_utak_simulation, JSON.stringify(first));
  const cfg = await activeConfig();
  const [vals] = cfg ? await call(CFG, "read", { ids: [cfg.id], fields: ["x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_profit_margin_percent", "x_operations_margin_percent"] }) : [];
  check(`active config #${cfg?.id}: التالف 5، الحد الأدنى 150، المحطات فارغ`, vals?.x_waste_pct === 5 && vals?.x_min_order_sar === 150 && !vals?.x_planned_stops, JSON.stringify(vals));
  check("legacy margins untouched (15 / 20)", vals?.x_operations_margin_percent === 15 && vals?.x_profit_margin_percent === 20, JSON.stringify(vals));
  const views = Object.fromEntries(await Promise.all(Object.keys(VIEWS).map(async (k) => [k, await one("ir.ui.view", [["name", "=", NAMES[k]]])])));
  for (const k of Object.keys(VIEWS)) check(`view ${NAMES[k]}`, !!views[k]);
  const [sv] = await call("ir.ui.view", "read", { ids: [views.settingsForm], fields: ["priority"] });
  check("settings form priority 99 (action 919 keeps its default form)", sv?.priority === 99, JSON.stringify(sv));
  const gv = await call(COST, "get_views", { views: [[views.costList, "list"], [views.costForm, "form"]] });
  check("cost list / form render (get_views)", String(gv?.views?.list?.arch ?? "").includes("x_frequency") && String(gv?.views?.form?.arch ?? "").includes("x_account_id"));
  const sgv = await call(CFG, "get_views", { views: [[views.settingsForm, "form"]] });
  check("settings form renders the three fields", ["x_waste_pct", "x_min_order_sar", "x_planned_stops"].every((f) => String(sgv?.views?.form?.arch ?? "").includes(f)));
  const menus = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", UTAK_MENU], ["name", "in", [NAMES.menuCosts, NAMES.menuSettings]]], fields: ["name", "action", "active"] });
  check("menu UTAK ← 💰 التكاليف التشغيلية", menus.some((m) => m.name === NAMES.menuCosts && m.active && String(m.action).startsWith("ir.actions.act_window,")));
  check("menu UTAK ← ⚙️ إعدادات التسعير → opens the active record", menus.some((m) => m.name === NAMES.menuSettings && m.active && String(m.action).startsWith("ir.actions.server,")));
  const [acc] = await call("ir.model", "read", { ids: [await modelId(COST)], fields: ["access_ids"] });
  check("access rights on x_operating_cost", (acc?.access_ids ?? []).length > 0);
  check("nothing installed: account_budget / hr_expense still uninstalled",
    (await call("ir.module.module", "search_count", { domain: [["name", "in", ["account_budget", "hr_expense"]], ["state", "=", "uninstalled"]] })) === 2);
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
// 1. x_operating_cost
const costModel = await ensureModel(ctx, "costModel", COST, "التكاليف التشغيلية");
await ensureFields(ctx, COST, costModel, COST_FIELDS);
await modelOrderAccess(costModel, COST, "x_date_from desc, id desc");
// 2. the settings fields on x_pricing_config (the created ids apart: --drop removes them one by one)
const cfgModel = await modelId(CFG);
const cfgHave = new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", cfgModel]], fields: ["name"] })).map((r) => r.name));
rb.created.cfgFields ??= [];
for (const d of CFG_FIELDS) {
  if (cfgHave.has(d.name)) { log(`= ${CFG}.${d.name}`); continue; }
  log(`+ ${CFG}.${d.name} (${d.ttype})`);
  if (!APPLY) continue;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: cfgModel, ...d }] });
  rb.created.cfgFields.push(id); save();
  log(`  → #${id}`);
}
// 3. views, action, menus
await ensureView(ctx, "costList", NAMES.costList, { model: COST, type: "list", arch_base: VIEWS.costList });
await ensureView(ctx, "costForm", NAMES.costForm, { model: COST, type: "form", arch_base: VIEWS.costForm });
await ensureView(ctx, "costSearch", NAMES.costSearch, { model: COST, type: "search", arch_base: VIEWS.costSearch });
const settingsForm = await ensureView(ctx, "settingsForm", NAMES.settingsForm, { model: CFG, type: "form", priority: 99, arch_base: VIEWS.settingsForm });
const costWindow = await ensureActWindow(ctx, "costs", NAMES.costWindow, {
  res_model: COST, view_mode: "list,form", view_id: rb.created.views?.costList, search_view_id: rb.created.views?.costSearch,
});
if (APPLY && costWindow && rb.created.views?.costForm) {
  // list + form by id (the form is not the model's only one only once Odoo adds defaults; be explicit)
  const [w] = await call("ir.actions.act_window", "read", { ids: [costWindow], fields: ["view_ids"] });
  if (!(w?.view_ids ?? []).length) {
    await call("ir.actions.act_window", "write", { ids: [costWindow], vals: { view_ids: [[0, 0, { sequence: 1, view_mode: "list", view_id: rb.created.views.costList }], [0, 0, { sequence: 2, view_mode: "form", view_id: rb.created.views.costForm }]] } });
  }
}
const openSettings = await ensureServerAction(ctx, "openSettings", NAMES.openSettings, { model_id: cfgModel, state: "code", code: openSettingsCode(settingsForm ?? "False") });
await ensureMenu(ctx, "costs", NAMES.menuCosts, UTAK_MENU, `ir.actions.act_window,${costWindow ?? 0}`, 9);
await ensureMenu(ctx, "settings", NAMES.menuSettings, UTAK_MENU, `ir.actions.server,${openSettings ?? 0}`, 9);
// 4. the first cost line
const haveFirst = costModel ? await one(COST, [["x_name", "=", FIRST_COST.x_name]]) : null;
rb.created.firstCost = await step(`${COST} «${FIRST_COST.x_name}» ${FIRST_COST.x_frequency} ${FIRST_COST.x_amount} من ${FIRST_COST.x_date_from}`, haveFirst ?? rb.created.firstCost, async () =>
  (await call(COST, "create", { vals_list: [FIRST_COST] }))[0]);
save();
// 5. the settings values on the active record (the previous values kept for --rollback)
const cfg = await activeConfig();
if (!cfg) throw new Error("no active x_pricing_config — stop");
const cur = cfgHave.has("x_waste_pct") ? (await call(CFG, "read", { ids: [cfg.id], fields: ["x_waste_pct", "x_min_order_sar", "x_planned_stops"] }))[0] : null;
const want = { ...SETTINGS };
const diff = Object.entries(want).filter(([k, v]) => cur?.[k] !== v);
if (!diff.length) log(`= settings #${cfg.id} ${JSON.stringify(want)}`);
else {
  log(`✎ settings #${cfg.id} (${cfg.x_name}): ${diff.map(([k, v]) => `${k} ${cur?.[k] ?? "∅"} → ${v}`).join(", ")}; x_planned_stops left empty`);
  if (APPLY) {
    rb.before.settings ??= { id: cfg.id, vals: { x_waste_pct: cur?.x_waste_pct ?? 0, x_min_order_sar: cur?.x_min_order_sar ?? 0, x_planned_stops: cur?.x_planned_stops ?? 0 } };
    save();
    await call(CFG, "write", { ids: [cfg.id], vals: want });
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
