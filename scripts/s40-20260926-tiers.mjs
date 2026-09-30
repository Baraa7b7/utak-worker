// § 40 د (2026-09-26) — the quantity-discount tiers and the invoice's discount.
//
//   1. x_pricing_tier «شرائح خصم الكمية»: من مبلغ، إلى مبلغ (فارغ = بلا حد)،
//      نسبة الخصم %، نشط (default on, ir.default), on the pricing settings
//      record (x_config_id; x_pricing_config.x_tier_ids), edited inside
//      «⚙️ إعدادات التسعير». The first three: 0–499.99 → 0 %, 500–1,000 → 2 %,
//      above 1,000 (from 1,000.01) → 3 %;
//   2. x_invoice.x_discount «الخصم (قبل الضريبة)» and x_discount_pct: the
//      discount an invoice was issued with (its PDF prints it, and the 21:30
//      coverage line takes it off the day's profit).
//
//   node scripts/s40-20260926-tiers.mjs                 dry-run
//   node scripts/s40-20260926-tiers.mjs --apply         rollback file first, then write (idempotent)
//   node scripts/s40-20260926-tiers.mjs --verify        read-only checks
//   node scripts/s40-20260926-tiers.mjs --rollback [--apply]           the settings form back, the tiers off (nothing deleted)
//   node scripts/s40-20260926-tiers.mjs --rollback --drop [--apply]    and delete what this script created
//
// Rollback file: scripts/artifacts/s40-20260926-tiers-rollback.json. No WhatsApp.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureModel, log, modelId, modelOrderAccess, one, rollbackFile,
} from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s40-20260926-tiers-rollback.json", import.meta.url);
const TIER = "x_pricing_tier", CFG = "x_pricing_config";
const CONFIG_ID = 1;
export const TIER_FIELDS = [
  { name: "x_config_id", ttype: "many2one", relation: CFG, field_description: "إعدادات التسعير", required: true, on_delete: "cascade", index: true },
  { name: "x_sequence", ttype: "integer", field_description: "الترتيب" },
  { name: "x_amount_from", ttype: "float", field_description: "من مبلغ" },
  { name: "x_amount_to", ttype: "float", field_description: "إلى مبلغ", help: "فارغ (0) = بلا حد أعلى." },
  { name: "x_discount_pct", ttype: "float", field_description: "نسبة الخصم %" },
  { name: "x_active", ttype: "boolean", field_description: "نشط" },
];
export const INVOICE_FIELDS = [
  { name: "x_discount", ttype: "float", field_description: "الخصم (قبل الضريبة)", help: "خصم الكمية الذي صدرت به الفاتورة (§ 40 د)، قبل الضريبة." },
  { name: "x_discount_pct", ttype: "float", field_description: "نسبة الخصم %" },
];
export const TIERS = [
  { x_sequence: 1, x_amount_from: 0, x_amount_to: 499.99, x_discount_pct: 0, x_active: true },
  { x_sequence: 2, x_amount_from: 500, x_amount_to: 1000, x_discount_pct: 2, x_active: true },
  { x_sequence: 3, x_amount_from: 1000.01, x_amount_to: 0, x_discount_pct: 3, x_active: true },
];
const SETTINGS_FORM = "utak.pricing_settings_form";
const TIERS_BLOCK = `    <separator string="شرائح خصم الكمية"/>
    <field name="x_tier_ids" nolabel="1">
      <list editable="bottom" default_order="x_sequence, x_amount_from" decoration-muted="not x_active">
        <field name="x_sequence" widget="handle"/>
        <field name="x_amount_from"/>
        <field name="x_amount_to"/>
        <field name="x_discount_pct"/>
        <field name="x_active" widget="boolean_toggle"/>
      </list>
    </field>
    <div class="text-muted">الخصم على مجموع الطلب قبل الضريبة، بنسبة الشريحة التي يقع فيها المجموع («إلى» فارغ = بلا حد). لا خصم إذا صار ربح الطلب بعده أقل من (تكلفة اليوم ÷ عدد المحطات)، ولا خصم إطلاقاً والمحطات فارغة.</div>
  </sheet>`;

const ctx = rollbackFile(RB, "scripts/s40-20260926-tiers.mjs");
const { rb, save } = ctx;

if (ROLLBACK) {
  const b = rb.before;
  const tiers = rb.created.tiers ?? [];
  log(`settings form back: ${!!b.settingsForm}; tiers off: ${tiers.join(",") || "-"}`);
  if (APPLY) {
    if (b.settingsForm) await call("ir.ui.view", "write", { ids: [b.settingsFormId], vals: { arch_base: b.settingsForm } });
    if (tiers.length) await call(TIER, "write", { ids: tiers, vals: { x_active: false } });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.default", [rb.created.defaultActive]],
      ["ir.model.fields", [rb.created.tierIds, ...(rb.created.invoiceFields ?? [])]],
      ["ir.model", [rb.created.tierModel]],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

if (VERIFY) {
  const { check, done } = checker();
  const tf = await call(TIER, "fields_get", { attributes: ["type", "relation", "required"] });
  for (const d of TIER_FIELDS) check(`${TIER}.${d.name} ${d.ttype}`, tf[d.name]?.type === d.ttype && (!d.relation || tf[d.name]?.relation === d.relation));
  const cf = (await call(CFG, "fields_get", { attributes: ["type", "relation"] })).x_tier_ids;
  check("x_pricing_config.x_tier_ids one2many → x_pricing_tier", cf?.type === "one2many" && cf?.relation === TIER, JSON.stringify(cf));
  const inf = await call("x_invoice", "fields_get", { attributes: ["type"] });
  for (const d of INVOICE_FIELDS) check(`x_invoice.${d.name} float`, inf[d.name]?.type === "float");
  const rows = await call(TIER, "search_read", { domain: [["x_config_id", "=", CONFIG_ID]], fields: ["x_amount_from", "x_amount_to", "x_discount_pct", "x_active"], order: "x_sequence asc, id asc" });
  check("the three tiers: 0–499.99 0 %، 500–1,000 2 %، from 1,000.01 3 % (all active)",
    JSON.stringify(rows.map((r) => [r.x_amount_from, r.x_amount_to, r.x_discount_pct, r.x_active])) === JSON.stringify([[0, 499.99, 0, true], [500, 1000, 2, true], [1000.01, 0, 3, true]]), JSON.stringify(rows));
  const [def] = await call("ir.default", "search_read", { domain: [["field_id.model", "=", TIER], ["field_id.name", "=", "x_active"]], fields: ["json_value"] });
  check("a new tier is active by default (ir.default)", def?.json_value === "true", JSON.stringify(def));
  const v = await one("ir.ui.view", [["name", "=", SETTINGS_FORM]]);
  const gv = await call(CFG, "get_views", { views: [[v, "form"]] });
  check("«⚙️ إعدادات التسعير» shows the tiers (editable)", String(gv?.views?.form?.arch ?? "").includes('name="x_tier_ids"'));
  const [acc] = await call("ir.model", "read", { ids: [await modelId(TIER)], fields: ["access_ids"] });
  check("access rights on x_pricing_tier", (acc?.access_ids ?? []).length > 0);
  done();
}

save();
const tierModel = await ensureModel(ctx, "tierModel", TIER, "شرائح خصم الكمية");
await ensureFields(ctx, TIER, tierModel, TIER_FIELDS);
await modelOrderAccess(tierModel, TIER, "x_sequence asc, x_amount_from asc, id asc");
// the one2many on the settings, and the invoice's discount
const cfgModel = await modelId(CFG);
const haveO2m = await one("ir.model.fields", [["model", "=", CFG], ["name", "=", "x_tier_ids"]]);
if (haveO2m) log(`= ${CFG}.x_tier_ids #${haveO2m}`);
else {
  log(`+ ${CFG}.x_tier_ids (one2many → ${TIER})`);
  if (APPLY) {
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: cfgModel, name: "x_tier_ids", ttype: "one2many", relation: TIER, relation_field: "x_config_id", field_description: "شرائح خصم الكمية" }] });
    rb.created.tierIds = id; save();
    log(`  → #${id}`);
  }
}
const invModel = await modelId("x_invoice");
const invHave = new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", invModel]], fields: ["name"] })).map((r) => r.name));
rb.created.invoiceFields ??= [];
for (const d of INVOICE_FIELDS) {
  if (invHave.has(d.name)) { log(`= x_invoice.${d.name}`); continue; }
  log(`+ x_invoice.${d.name} (float)`);
  if (!APPLY) continue;
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: invModel, ...d }] });
  rb.created.invoiceFields.push(id); save();
  log(`  → #${id}`);
}
// a new tier: active by default
const activeField = await one("ir.model.fields", [["model", "=", TIER], ["name", "=", "x_active"]]);
const haveDefault = activeField ? await one("ir.default", [["field_id", "=", activeField]]) : null;
if (haveDefault) log(`= ir.default ${TIER}.x_active #${haveDefault}`);
else {
  log(`+ ir.default ${TIER}.x_active = true`);
  if (APPLY && activeField) {
    const [id] = await call("ir.default", "create", { vals_list: [{ field_id: activeField, json_value: "true" }] });
    rb.created.defaultActive = id; save();
  }
}
// the settings form: the tiers inside it
const vid = await one("ir.ui.view", [["name", "=", SETTINGS_FORM]]);
const [view] = await call("ir.ui.view", "read", { ids: [vid], fields: ["arch_db"] });
if (String(view.arch_db).includes('name="x_tier_ids"')) log("= settings form shows the tiers");
else {
  log(`✎ view ${vid} ${SETTINGS_FORM}: + the tiers`);
  if (APPLY) {
    rb.before.settingsFormId = vid; rb.before.settingsForm ??= view.arch_db; save();
    const arch = String(view.arch_db).replace(/\s*<\/sheet>/, "\n" + TIERS_BLOCK);
    if (!arch.includes("x_tier_ids")) throw new Error("could not place the tiers in the settings form — stop");
    await call("ir.ui.view", "write", { ids: [vid], vals: { arch_base: arch } });
  }
}
// the three tiers
const existing = tierModel ? await call(TIER, "search_read", { domain: [["x_config_id", "=", CONFIG_ID]], fields: ["id"], context: { active_test: false } }) : [];
if (existing.length) log(`= ${existing.length} tier(s) on config #${CONFIG_ID}`);
else {
  log(`+ ${TIERS.length} tiers on config #${CONFIG_ID}: ${TIERS.map((t) => `${t.x_amount_from}–${t.x_amount_to || "∞"} ${t.x_discount_pct}%`).join(" · ")}`);
  if (APPLY) {
    rb.created.tiers = await call(TIER, "create", { vals_list: TIERS.map((t) => ({ ...t, x_config_id: CONFIG_ID, x_name: `${t.x_amount_from}–${t.x_amount_to || "∞"}: ${t.x_discount_pct}%` })) });
    save();
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
