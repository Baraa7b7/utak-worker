// § 40 ب (2026-09-26) — the price sources and their daily offers.
//
//   1. «مصدر أسعار» (x_price_source, boolean) on res.partner and on hr.employee,
//      on their forms (the partner's «UTAK — واتساب» group, the employee's
//      «UTAK — الفريق» group). A source is a partner or an employee with it
//      ticked: adding one later = ticking it, no code. The first two: Ahmed
//      Hassan (partner #30, supplier) and Omar Al-Majhali (employee #4).
//   2. x_price_offer «عروض المصادر اليومية»: one row per offer a source sends —
//      source (partner, and the employee when it is one), Riyadh day, product,
//      packaging, purchase price (optional), observed market price (optional),
//      available quantity (optional), status (صالح / شاذ, and which price),
//      the supplier price row it goes with, the message, x_utak_simulation.
//      A supplier's own purchase price stays in x_daily_price (§ 26, § 35: no
//      parallel model for it — the 21:15 list, the supplier dues and the price
//      fallback read it as the vendor's price); x_price_offer holds what that
//      model cannot: market observations, and purchase prices from a source
//      that is not a supplier. Read-only list under 🛒 المشتريات.
//
//   node scripts/s40-20260926-sources.mjs                  dry-run
//   node scripts/s40-20260926-sources.mjs --apply          rollback file first, then write (idempotent)
//   node scripts/s40-20260926-sources.mjs --verify         read-only checks
//   node scripts/s40-20260926-sources.mjs --rollback [--apply]          menu off, the two flags back (nothing deleted)
//   node scripts/s40-20260926-sources.mjs --rollback --drop [--apply]   and delete what this script created
//
// Rollback file: scripts/artifacts/s40-20260926-sources-rollback.json. No WhatsApp.
import {
  APPLY, DROP, PURCHASE_MENU, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu, ensureModel,
  ensureView, log, modelId, modelOrderAccess, one, rollbackFile,
} from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s40-20260926-sources-rollback.json", import.meta.url);
const OFFER = "x_price_offer";
const AHMED = 30, OMAR_EMPLOYEE = 4;
const PARTNER_WA_VIEW = 2784;   // res.partner.form.utak_wa_allowed («UTAK — واتساب»)
const EMPLOYEE_TEAM_VIEW = 2829; // utak.hr_employee_form.team («UTAK — الفريق»)

const SOURCE_FIELD = {
  name: "x_price_source", ttype: "boolean", field_description: "مصدر أسعار",
  help: "مصدر لأسعار اليوم (§ 40): المورد يُسأل 02:00 كالعادة، والموظف أو الشريك يصله 02:30 طلب «أرسل أسعار السوق اليوم»، ورده خلال 90 دقيقة يُقرأ. إضافة مصدر = تعليم هذا الحقل.",
};
export const OFFER_FIELDS = [
  { name: "x_date", ttype: "date", field_description: "اليوم", required: true, index: true },
  { name: "x_source_partner_id", ttype: "many2one", relation: "res.partner", field_description: "المصدر", required: true, on_delete: "restrict", index: true },
  { name: "x_source_employee_id", ttype: "many2one", relation: "hr.employee", field_description: "الموظف", on_delete: "set null" },
  { name: "x_product_tmpl_id", ttype: "many2one", relation: "product.template", field_description: "الصنف", required: true, on_delete: "restrict" },
  { name: "x_packaging_id", ttype: "many2one", relation: "x_product_packaging", field_description: "التعبئة", required: true, on_delete: "restrict" },
  { name: "x_purchase_price", ttype: "float", field_description: "سعر الشراء" },
  { name: "x_market_price", ttype: "float", field_description: "سعر السوق المشاهَد" },
  { name: "x_available_qty", ttype: "float", field_description: "الكمية المتاحة" },
  { name: "x_status", ttype: "selection", field_description: "الحالة", selection: "[('valid', 'صالح'), ('outlier', 'شاذ')]" },
  { name: "x_purchase_outlier", ttype: "boolean", field_description: "شراء شاذ" },
  { name: "x_market_outlier", ttype: "boolean", field_description: "سوق شاذ" },
  { name: "x_daily_price_id", ttype: "many2one", relation: "x_daily_price", field_description: "سجل سعر المورد", on_delete: "set null" },
  { name: "x_source_message_id", ttype: "char", field_description: "معرّف الرسالة" },
  { name: "x_raw_text", ttype: "text", field_description: "نص الرسالة" },
  { name: "x_utak_simulation", ttype: "boolean", field_description: "محاكاة (تجربة)", help: "عرض تجربة: لا يدخل المحرك ولا أي حساب. لا يُحذف." },
];

const NAMES = {
  partnerExt: "res.partner.form.utak_price_source", employeeExt: "utak.hr_employee_form.price_source",
  offerList: "utak.price_offer_list", offerSearch: "utak.price_offer_search", window: "UTAK — عروض المصادر اليومية", menu: "عروض المصادر اليومية",
};
const VIEWS = {
  partnerExt: `<data>
  <xpath expr="//field[@name='x_wa_allowed']" position="after">
    <field name="x_price_source" widget="boolean_toggle"/>
  </xpath>
</data>`,
  employeeExt: `<data>
  <xpath expr="//field[@name='x_utak_attendance']" position="after">
    <field name="x_price_source" widget="boolean_toggle"/>
  </xpath>
</data>`,
  offerList: `<list string="عروض المصادر اليومية" create="0" default_order="x_date desc, id desc" decoration-warning="x_status == 'outlier'" decoration-muted="x_utak_simulation">
  <field name="x_date"/>
  <field name="x_source_partner_id"/>
  <field name="x_product_tmpl_id"/>
  <field name="x_packaging_id"/>
  <field name="x_purchase_price"/>
  <field name="x_market_price"/>
  <field name="x_available_qty" optional="show"/>
  <field name="x_status"/>
  <field name="x_raw_text" optional="hide"/>
  <field name="x_utak_simulation" optional="hide"/>
</list>`,
  offerSearch: `<search string="عروض المصادر">
  <field name="x_source_partner_id"/>
  <field name="x_product_tmpl_id"/>
  <filter name="f_today" string="اليوم" domain="[('x_date', '=', context_today().strftime('%Y-%m-%d'))]"/>
  <filter name="f_market" string="مشاهدات سوق" domain="[('x_market_price', '&gt;', 0)]"/>
  <filter name="f_outlier" string="شاذ" domain="[('x_status', '=', 'outlier')]"/>
  <separator/>
  <filter name="g_day" string="اليوم" context="{'group_by': 'x_date'}"/>
  <filter name="g_source" string="المصدر" context="{'group_by': 'x_source_partner_id'}"/>
</search>`,
};

const ctx = rollbackFile(RB, "scripts/s40-20260926-sources.mjs");
const { rb, save } = ctx;

if (ROLLBACK) {
  const c = rb.created;
  const menus = Object.values(c.menus ?? {}).filter(Boolean);
  log(`menus off: ${menus.join(",") || "-"}; flags back: ${JSON.stringify(rb.before.flags ?? {})}`);
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (rb.before.flags?.partner) await call("res.partner", "write", { ids: [AHMED], vals: { x_price_source: rb.before.flags.partner.x_price_source } });
    if (rb.before.flags?.employee) await call("hr.employee", "write", { ids: [OMAR_EMPLOYEE], vals: { x_price_source: rb.before.flags.employee.x_price_source } });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", menus],
      ["ir.actions.act_window", Object.values(c.windows ?? {})],
      ["ir.ui.view", Object.values(c.views ?? {})],
      ["ir.model", [c.offerModel]],
      ["ir.model.fields", c.sourceFields ?? []],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

if (VERIFY) {
  const { check, done } = checker();
  for (const m of ["res.partner", "hr.employee"]) {
    const f = (await call(m, "fields_get", { attributes: ["type", "string"] })).x_price_source;
    check(`${m}.x_price_source boolean «مصدر أسعار»`, f?.type === "boolean" && f?.string === "مصدر أسعار", JSON.stringify(f));
  }
  const of = await call(OFFER, "fields_get", { attributes: ["type", "relation", "selection", "required"] });
  for (const d of OFFER_FIELDS) check(`${OFFER}.${d.name} ${d.ttype}`, of[d.name]?.type === d.ttype && (!d.relation || of[d.name]?.relation === d.relation) && (!d.required || of[d.name]?.required === true));
  check("x_status = valid / outlier", JSON.stringify((of.x_status?.selection ?? []).map((s) => s[0])) === JSON.stringify(["valid", "outlier"]));
  const [a] = await call("res.partner", "read", { ids: [AHMED], fields: ["name", "x_price_source", "supplier_rank"] });
  check("Ahmed Hassan (#30, supplier) is a source", a?.x_price_source === true && a?.supplier_rank > 0, JSON.stringify(a));
  const [o] = await call("hr.employee", "read", { ids: [OMAR_EMPLOYEE], fields: ["name", "x_price_source", "work_contact_id"] });
  check("Omar Al-Majhali (employee #4) is a source", o?.x_price_source === true && Array.isArray(o?.work_contact_id), JSON.stringify(o));
  check("no other source yet", (await call("res.partner", "search_count", { domain: [["x_price_source", "=", true]] })) === 1
    && (await call("hr.employee", "search_count", { domain: [["x_price_source", "=", true]] })) === 1);
  const pv = await call("res.partner", "get_views", { views: [[124, "form"]] });
  check("partner form shows «مصدر أسعار»", String(pv?.views?.form?.arch ?? "").includes('name="x_price_source"'));
  const ev = await call("hr.employee", "get_views", { views: [[1534, "form"]] });
  check("employee form shows «مصدر أسعار»", String(ev?.views?.form?.arch ?? "").includes('name="x_price_source"'));
  const lv = await call(OFFER, "get_views", { views: [[await one("ir.ui.view", [["name", "=", NAMES.offerList]]), "list"]] });
  check("offers list renders", String(lv?.views?.list?.arch ?? "").includes("x_market_price"));
  const menu = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", PURCHASE_MENU], ["name", "=", NAMES.menu]], fields: ["active", "action"] });
  check("menu 🛒 المشتريات ← عروض المصادر اليومية", menu.length === 1 && menu[0].active);
  const [acc] = await call("ir.model", "read", { ids: [await modelId(OFFER)], fields: ["access_ids"] });
  check("access rights on x_price_offer", (acc?.access_ids ?? []).length > 0);
  check("x_daily_price untouched (no field added)", !(await call("x_daily_price", "fields_get", { attributes: ["type"] })).x_market_price);
  done();
}

save();
// 1. «مصدر أسعار» on the partner and the employee
rb.created.sourceFields ??= [];
for (const m of ["res.partner", "hr.employee"]) {
  const mid = await modelId(m);
  const have = await one("ir.model.fields", [["model", "=", m], ["name", "=", SOURCE_FIELD.name]]);
  if (have) { log(`= ${m}.${SOURCE_FIELD.name} #${have}`); continue; }
  log(`+ ${m}.${SOURCE_FIELD.name} (boolean)`);
  if (!APPLY) continue;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...SOURCE_FIELD }] });
  rb.created.sourceFields.push(id); save();
  log(`  → #${id}`);
}
await ensureView(ctx, "partnerExt", NAMES.partnerExt, { model: "res.partner", type: "form", inherit_id: PARTNER_WA_VIEW, mode: "extension", arch_base: VIEWS.partnerExt });
await ensureView(ctx, "employeeExt", NAMES.employeeExt, { model: "hr.employee", type: "form", inherit_id: EMPLOYEE_TEAM_VIEW, mode: "extension", arch_base: VIEWS.employeeExt });
// 2. x_price_offer
const offerModel = await ensureModel(ctx, "offerModel", OFFER, "عروض المصادر اليومية");
await ensureFields(ctx, OFFER, offerModel, OFFER_FIELDS);
await modelOrderAccess(offerModel, OFFER, "x_date desc, id desc");
await ensureView(ctx, "offerList", NAMES.offerList, { model: OFFER, type: "list", arch_base: VIEWS.offerList });
await ensureView(ctx, "offerSearch", NAMES.offerSearch, { model: OFFER, type: "search", arch_base: VIEWS.offerSearch });
const win = await ensureActWindow(ctx, "offers", NAMES.window, { res_model: OFFER, view_mode: "list", view_id: rb.created.views?.offerList, search_view_id: rb.created.views?.offerSearch, context: "{'search_default_f_today': 1}" });
await ensureMenu(ctx, "offers", NAMES.menu, PURCHASE_MENU, `ir.actions.act_window,${win ?? 0}`, 35);
// 3. the first two sources (the previous values kept for --rollback)
const partnerHas = await one("ir.model.fields", [["model", "=", "res.partner"], ["name", "=", "x_price_source"]]);
const [a] = await call("res.partner", "read", { ids: [AHMED], fields: ["name", ...(partnerHas ? ["x_price_source"] : [])] });
if (a?.x_price_source === true) log(`= res.partner #${AHMED} ${a.name}: مصدر أسعار`);
else {
  log(`✎ res.partner #${AHMED} ${a?.name}: x_price_source → true`);
  if (APPLY) { rb.before.flags ??= {}; rb.before.flags.partner ??= { x_price_source: false }; save(); await call("res.partner", "write", { ids: [AHMED], vals: { x_price_source: true } }); }
}
const empHas = await one("ir.model.fields", [["model", "=", "hr.employee"], ["name", "=", "x_price_source"]]);
const [o] = await call("hr.employee", "read", { ids: [OMAR_EMPLOYEE], fields: ["name", ...(empHas ? ["x_price_source"] : [])] });
if (o?.x_price_source === true) log(`= hr.employee #${OMAR_EMPLOYEE} ${o.name}: مصدر أسعار`);
else {
  log(`✎ hr.employee #${OMAR_EMPLOYEE} ${o?.name}: x_price_source → true`);
  if (APPLY) { rb.before.flags ??= {}; rb.before.flags.employee ??= { x_price_source: false }; save(); await call("hr.employee", "write", { ids: [OMAR_EMPLOYEE], vals: { x_price_source: true } }); }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
