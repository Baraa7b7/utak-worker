// § 46 ب (2026-10-01) — a new product is prepared the moment it is created.
//
// In Odoo (the Python is scripts/lib/s46-odoo-code.mjs, tested in tests/s46.test.mts):
//   1. the categories فواكه / خضار / ورقيات (product.category had only Goods / Expenses / Services /
//      Deliveries, and the produce carries none) — the reference follows the category;
//   2. product.template.x_utak_new «صنف جديد (بانتظار تنبيه براء)»: set on creation, read and
//      cleared by the worker's tick after Baraa's one alert (src/product-setup.ts);
//   3. two server actions and their automations:
//        on_create            → the reference by the category (continuing from the highest in
//                               use), the sale tax and the purchase tax — § 47 أ (2026-10-01):
//                               the company's own purchase tax «15%», price-EXCLUDED, because every
//                               purchase price is entered net of VAT (it was «15% شامل (مشتريات)»,
//                               price-included, in § 46) — the
//                               type / storable / unit / purchase method / invoice policy of the
//                               majority of the existing produce (READ here, never assumed),
//                               «نشط للبيع» = false, a default packaging «كرتون» 8 kg;
//        on_write (categ_id)  → the reference when it is still empty. One typed by hand is never
//                               changed. The supplier is never linked.
//   4. the existing products without a reference (not services, not UTAK-SALE / UTAK-PUR): the
//      SAME on-create action is run on each (so the rule is the code, and the code is proven on
//      the tenant before its automation exists); x_utak_new is then cleared (no WhatsApp from
//      here: the product is listed in the report instead). No existing reference is touched.
//
//   node scripts/s46-20261001-product-setup.mjs                    dry-run: the plan, nothing written
//   node scripts/s46-20261001-product-setup.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s46-20261001-product-setup.mjs --verify           read-only checks
//   node scripts/s46-20261001-product-setup.mjs --rollback [--apply]          automations off, the completed products' values back
//   node scripts/s46-20261001-product-setup.mjs --rollback --drop [--apply]   and delete what this script created (never without a decision)
//
// Rollback file: scripts/artifacts/s46-20261001-product-setup-rollback.json. The tenant is
// production. No WhatsApp, no tax setting, no module, nothing deleted.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureServerAction, log, modelId, one, rollbackFile, step,
} from "./lib/s40-kit.mjs";
import { NAMES, NEW_FLAG, ON_CATEGORY_CODE, REF_PREFIX, TEMP_CARTON_KG, onCreateCode } from "./lib/s46-odoo-code.mjs";

const RB = new URL("./artifacts/s46-20261001-product-setup-rollback.json", import.meta.url);
const CODES = new URL("./artifacts/s46-20261001-product-codes-before.json", import.meta.url);
const TMPL = "product.template", PACK = "x_product_packaging";
const ALL = { active_test: false };
const FIELDS = [{ name: NEW_FLAG, ttype: "boolean", field_description: "صنف جديد (بانتظار تنبيه براء)", help: "يُعلَّم عند إنشاء الصنف. الوركر يرسل لبراء تنبيهاً واحداً بما ينقص الصنف ثم يطفئه." }];
const P_FIELDS = ["id", "name", "default_code", "categ_id", "type", "is_storable", "uom_id", "purchase_method", "invoice_policy", "taxes_id", "supplier_taxes_id", "x_is_active_for_sale", "active"];
const intermediary = (p) => /^UTAK-(SALE|PUR)/.test(String(p.default_code || ""));
const produceRef = (p) => Object.values(REF_PREFIX).some((x) => String(p.default_code || "").startsWith(x));

const ctx = rollbackFile(RB, "scripts/s46-20261001-product-setup.mjs");
const { rb, save } = ctx;

/** The values of the majority of the existing produce (the products that carry a UTAK-FRT / VEG / LEAF reference). */
async function majority() {
  const all = await call(TMPL, "search_read", { domain: [], fields: P_FIELDS, order: "id asc", context: ALL });
  const produce = all.filter(produceRef);
  const top = (f) => {
    const n = new Map();
    for (const p of produce) { const k = JSON.stringify(Array.isArray(p[f]) && typeof p[f][1] === "string" ? p[f][0] : p[f]); n.set(k, (n.get(k) ?? 0) + 1); }
    const [k, c] = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    return { value: JSON.parse(k), count: c, of: produce.length };
  };
  const m = { type: top("type"), storable: top("is_storable"), uom: top("uom_id"), purchaseMethod: top("purchase_method"), invoicePolicy: top("invoice_policy"), saleTax: top("taxes_id") };
  // § 47 أ — the purchase price is net of VAT: the company's purchase tax, added on top (never a price-included one)
  const [co] = await call("res.company", "read", { ids: [1], fields: ["account_purchase_tax_id"] });
  const taxes = co?.account_purchase_tax_id ? await call("account.tax", "read", { ids: [co.account_purchase_tax_id[0]], fields: ["id", "name", "amount", "type_tax_use", "price_include", "active"] }) : [];
  if (taxes.length !== 1 || taxes[0].type_tax_use !== "purchase" || taxes[0].amount !== 15 || taxes[0].price_include || !taxes[0].active) {
    throw new Error(`the company's purchase tax is not an active price-excluded 15%: ${JSON.stringify(taxes)} — stop`);
  }
  const saleIds = m.saleTax.value;
  if (!Array.isArray(saleIds) || saleIds.length !== 1) throw new Error(`the produce's sale tax is not one tax: ${JSON.stringify(saleIds)} — stop`);
  const [sale] = await call("account.tax", "read", { ids: saleIds, fields: ["id", "name", "amount", "type_tax_use"] });
  if (sale?.type_tax_use !== "sale" || sale.amount !== 15) throw new Error(`the produce's sale tax is not 15%: ${JSON.stringify(sale)} — stop`);
  for (const [k, v] of Object.entries(m)) if (v.count * 2 <= v.of) throw new Error(`no clear majority for ${k}: ${JSON.stringify(v)} — stop`);
  return {
    all, produce, m,
    d: { saleTax: sale.id, purchaseTax: taxes[0].id, type: m.type.value, storable: m.storable.value === true, uom: m.uom.value, purchaseMethod: m.purchaseMethod.value, invoicePolicy: m.invoicePolicy.value },
    taxNames: { sale: `${sale.name} (#${sale.id})`, purchase: `${taxes[0].name} (#${taxes[0].id})` },
  };
}
/** The products the rule completes: no reference, not a service, not an intermediary. */
const unnumbered = (all) => all.filter((p) => p.active && !String(p.default_code || "").trim() && p.type !== "service" && !intermediary(p));
let hasFlag = null;
const snapshotProduct = async (id) => ({
  // the flag is read only once it exists (the dry run comes before it)
  product: (await call(TMPL, "read", { ids: [id], fields: (hasFlag ??= NEW_FLAG in (await call(TMPL, "fields_get", { attributes: ["type"] }))) ? [...P_FIELDS, NEW_FLAG] : P_FIELDS }))[0],
  packagings: await call(PACK, "search_read", { domain: [["x_product_tmpl_id", "=", id]], fields: ["id", "x_name", "x_type", "x_approx_weight_kg", "x_is_default", "x_sequence"] }),
});

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const autos = Object.values(c.automations ?? {}).filter(Boolean);
  log(`automations off: ${autos.join(",") || "-"}`);
  if (APPLY && autos.length) await call("base.automation", "write", { ids: autos, vals: { active: false } });
  for (const [id, b] of Object.entries(rb.before.products ?? {})) {
    const p = b.product;
    const vals = { default_code: p.default_code, type: p.type, is_storable: p.is_storable, uom_id: p.uom_id?.[0] ?? false, purchase_method: p.purchase_method, invoice_policy: p.invoice_policy,
      taxes_id: [[6, 0, p.taxes_id]], supplier_taxes_id: [[6, 0, p.supplier_taxes_id]], x_is_active_for_sale: p.x_is_active_for_sale };
    log(`product #${id} «${p.name}»: back to ${JSON.stringify(vals)} (its packaging created here stays unless --drop)`);
    if (APPLY) await call(TMPL, "write", { ids: [Number(id)], vals });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["base.automation", autos],
      ["ir.actions.server", Object.values(c.actions ?? {})],
      [PACK, c.packagings ?? []],
      ["ir.model.fields", c.fields ?? []],
      ["product.category", Object.values(c.categories ?? {})],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

const M = await majority();
log(`الأغلبية (${M.produce.length} صنفاً برقم UTAK-FRT / VEG / LEAF): النوع ${M.d.type} (${M.m.type.count})، مخزّن ${M.d.storable} (${M.m.storable.count})، الوحدة #${M.d.uom} (${M.m.uom.count})، طريقة الشراء ${M.d.purchaseMethod} (${M.m.purchaseMethod.count})، سياسة الفوترة ${M.d.invoicePolicy} (${M.m.invoicePolicy.count})`);
log(`الضرائب: البيع ${M.taxNames.sale}، الشراء ${M.taxNames.purchase}`);
const CREATE_CODE = onCreateCode(M.d);

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const pf = await call(TMPL, "fields_get", { attributes: ["type"] });
  check(`${TMPL}.${NEW_FLAG} boolean`, pf[NEW_FLAG]?.type === "boolean");
  const cats = await call("product.category", "search_read", { domain: [["name", "in", Object.keys(REF_PREFIX)]], fields: ["id", "name", "parent_id"] });
  for (const n of Object.keys(REF_PREFIX)) check(`category «${n}» (one)`, cats.filter((c) => c.name === n).length === 1);
  const acts = await call("ir.actions.server", "search_read", { domain: [["name", "in", [NAMES.onCreateAction, NAMES.onCategoryAction]]], fields: ["id", "name", "state", "code", "model_id"] });
  const aCreate = acts.find((a) => a.name === NAMES.onCreateAction), aCat = acts.find((a) => a.name === NAMES.onCategoryAction);
  check("the on-create action's code = scripts/lib/s46-odoo-code.mjs with the tenant's majority values", aCreate?.state === "code" && aCreate.code === CREATE_CODE, aCreate?.code?.slice(0, 80));
  check("the on-category action's code = scripts/lib/s46-odoo-code.mjs", aCat?.state === "code" && aCat.code === ON_CATEGORY_CODE);
  const autos = await call("base.automation", "search_read", { domain: [["name", "in", [NAMES.onCreateAutomation, NAMES.onCategoryAutomation]]], fields: ["id", "name", "trigger", "active", "model_name", "action_server_ids", "trigger_field_ids", "filter_domain"], context: ALL });
  const uCreate = autos.find((a) => a.name === NAMES.onCreateAutomation), uCat = autos.find((a) => a.name === NAMES.onCategoryAutomation);
  check("automation on_create on product.template → the on-create action, active", uCreate?.trigger === "on_create" && uCreate.active && uCreate.model_name === TMPL && JSON.stringify(uCreate.action_server_ids) === JSON.stringify([aCreate?.id]), JSON.stringify(uCreate));
  const categField = (await call("ir.model.fields", "search_read", { domain: [["model", "=", TMPL], ["name", "=", "categ_id"]], fields: ["id"] }))[0]?.id;
  check("automation on_write, categ_id only → the on-category action, active", uCat?.trigger === "on_write" && uCat.active && uCat.model_name === TMPL && JSON.stringify(uCat.action_server_ids) === JSON.stringify([aCat?.id])
    && JSON.stringify(uCat.trigger_field_ids) === JSON.stringify([categField]), JSON.stringify(uCat));
  check(`the purchase tax in the code is the company's price-excluded ${M.taxNames.purchase} (§ 47 أ) and the sale tax 15%`, CREATE_CODE.includes(`'supplier_taxes_id': [(6, 0, [${M.d.purchaseTax}])]`) && CREATE_CODE.includes(`'taxes_id': [(6, 0, [${M.d.saleTax}])]`));
  check("the code never links a supplier and never sets «نشط للبيع» true", !/seller_ids|x_supplier_ids/.test(CREATE_CODE + ON_CATEGORY_CODE) && CREATE_CODE.includes("'x_is_active_for_sale': False") && !/x_is_active_for_sale': True/.test(CREATE_CODE));
  if (existsSync(CODES)) {
    const before = JSON.parse(readFileSync(CODES, "utf8")).codes;
    const now = Object.fromEntries(M.all.map((p) => [p.id, p.default_code || ""]));
    const changed = Object.entries(before).filter(([id, c]) => c && now[id] !== c);
    check(`no existing reference changed (${Object.values(before).filter(Boolean).length} references)`, changed.length === 0, JSON.stringify(changed));
  }
  for (const [id, b] of Object.entries(rb.before.products ?? {})) {
    const s = await snapshotProduct(Number(id));
    const p = s.product;
    const inRef = Array.isArray(p.categ_id) && Object.keys(REF_PREFIX).some((n) => String(p.categ_id[1]).split(" / ").includes(n));
    check(`#${id} «${p.name}»: الضرائب ${JSON.stringify(p.taxes_id)}/${JSON.stringify(p.supplier_taxes_id)}، ${p.type}${p.is_storable ? " مخزّن" : ""}، ${p.purchase_method}، غير نشط للبيع`,
      JSON.stringify(p.taxes_id) === JSON.stringify([M.d.saleTax]) && JSON.stringify(p.supplier_taxes_id) === JSON.stringify([M.d.purchaseTax]) && p.type === M.d.type && p.is_storable === M.d.storable
      && p.uom_id?.[0] === M.d.uom && p.purchase_method === M.d.purchaseMethod && p.invoice_policy === M.d.invoicePolicy && p.x_is_active_for_sale === false, JSON.stringify(p));
    check(`#${id}: تعبئة افتراضية «كرتون · ${TEMP_CARTON_KG} كيلو» (سمّتها الأتمتة 8)`, s.packagings.length >= 1 && (b.packagings.length > 0 || (s.packagings.length === 1 && s.packagings[0].x_type === "carton" && s.packagings[0].x_is_default === true
      && s.packagings[0].x_approx_weight_kg === TEMP_CARTON_KG && s.packagings[0].x_name === `كرتون · ${TEMP_CARTON_KG} كيلو`)), JSON.stringify(s.packagings));
    check(`#${id}: ${inRef ? `رقم مرجعي ${p.default_code}` : "بلا فئة ← بلا رقم مرجعي (ينتظر الفئة من براء)"}`, inRef ? /^UTAK-(FRT|VEG|LEAF)-\d{3}$/.test(String(p.default_code || "")) : !p.default_code, JSON.stringify(p.default_code));
    check(`#${id}: ${NEW_FLAG} مطفأ (لا تنبيه واتساب من هذا السكربت)`, p[NEW_FLAG] === false);
  }
  const flagged = await call(TMPL, "search_read", { domain: [[NEW_FLAG, "=", true]], fields: ["id", "name", "create_date"], context: ALL });
  log(`  · (للعلم) أصناف معلَّمة ${NEW_FLAG} الآن (أنشئت بعد الأتمتة، بانتظار تنبيه الوركر): ${flagged.map((p) => `#${p.id} ${p.name}`).join("، ") || "لا شيء"}`);
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
if (!existsSync(CODES) && APPLY) writeFileSync(CODES, JSON.stringify({ at: new Date().toISOString(), codes: Object.fromEntries(M.all.map((p) => [p.id, p.default_code || ""])) }, null, 1) + "\n");
// 1. the categories
rb.created.categories ??= {};
for (const name of Object.keys(REF_PREFIX)) {
  rb.created.categories[name] = await step(`product.category «${name}» → ${REF_PREFIX[name]}###`, (await one("product.category", [["name", "=", name]])) ?? rb.created.categories[name], async () =>
    (await call("product.category", "create", { vals_list: [{ name }] }))[0]);
  save();
}
// 2. the flag
const tmplModel = await modelId(TMPL);
await ensureFields(ctx, TMPL, tmplModel, FIELDS);
// 3. the actions (code kept equal to the lib)
const aCreate = await ensureServerAction(ctx, "onCreate", NAMES.onCreateAction, { model_id: tmplModel, state: "code", code: CREATE_CODE });
const aCat = await ensureServerAction(ctx, "onCategory", NAMES.onCategoryAction, { model_id: tmplModel, state: "code", code: ON_CATEGORY_CODE });
if (APPLY) for (const [id, code, name] of [[aCreate, CREATE_CODE, NAMES.onCreateAction], [aCat, ON_CATEGORY_CODE, NAMES.onCategoryAction]]) {
  const [a] = await call("ir.actions.server", "read", { ids: [id], fields: ["code"] });
  if (a.code !== code) { await call("ir.actions.server", "write", { ids: [id], vals: { code } }); log(`✎ ${name}: code updated`); }
}
// 4. the existing products without a reference: the same action, run on each
const todo = unnumbered(M.all);
log(`أصناف قائمة بلا رقم مرجعي: ${todo.length ? todo.map((p) => `#${p.id} «${p.name}» (الفئة: ${p.categ_id ? p.categ_id[1] : "بلا"})`).join("، ") : "لا شيء"}`);
rb.before.products ??= {};
rb.created.packagings ??= [];
for (const p of todo) {
  const before = rb.before.products[p.id] ?? (await snapshotProduct(p.id));
  const planned = {
    taxes_id: [M.d.saleTax], supplier_taxes_id: [M.d.purchaseTax], type: M.d.type, is_storable: M.d.storable, uom_id: M.d.uom, purchase_method: M.d.purchaseMethod, invoice_policy: M.d.invoicePolicy,
    x_is_active_for_sale: false, packaging: before.packagings.length ? "(له تعبئة: لا شيء)" : `كرتون · ${TEMP_CARTON_KG} كيلو (افتراضية)`,
    default_code: p.categ_id ? "بحسب الفئة" : "بلا فئة ← بلا رقم، ويُبلَّغ براء",
  };
  const diff = Object.entries(planned).filter(([k, v]) => !(k in before.product) || JSON.stringify(Array.isArray(before.product[k]) && typeof before.product[k][1] === "string" ? before.product[k][0] : before.product[k]) !== JSON.stringify(v));
  log(`✎ #${p.id} «${p.name}»: ${diff.map(([k, v]) => `${k} ${k in before.product ? JSON.stringify(before.product[k]) : ""} → ${JSON.stringify(v)}`).join("؛ ")}`);
  if (!APPLY) continue;
  if (!rb.before.products[p.id]) { rb.before.products[p.id] = before; save(); }
  // the on-create action itself, on this product (proves the code on the tenant before its automation exists)
  await call("ir.actions.server", "run", { ids: [aCreate], context: { active_model: TMPL, active_id: p.id, active_ids: [p.id] } });
  await call(TMPL, "write", { ids: [p.id], vals: { [NEW_FLAG]: false } });
  hasFlag = true;
  const after = await snapshotProduct(p.id);
  for (const k of after.packagings) if (!before.packagings.some((b) => b.id === k.id) && !rb.created.packagings.includes(k.id)) rb.created.packagings.push(k.id);
  save();
  log(`  → الرقم: ${after.product.default_code || "بلا (بلا فئة)"} · التعبئة: ${after.packagings.map((k) => `#${k.id} ${k.x_name}`).join("، ") || "—"} · الضرائب ${JSON.stringify(after.product.taxes_id)}/${JSON.stringify(after.product.supplier_taxes_id)}`);
  // the on-category action too: nothing to do without a category, and it must run clean
  await call("ir.actions.server", "run", { ids: [aCat], context: { active_model: TMPL, active_id: p.id, active_ids: [p.id] } });
}
// 5. the automations, only now
rb.created.automations ??= {};
const categField = (await call("ir.model.fields", "search_read", { domain: [["model", "=", TMPL], ["name", "=", "categ_id"]], fields: ["id"] }))[0]?.id;
const auto = async (key, name, vals) => {
  rb.created.automations[key] = await step(`base.automation ${name}`, (await call("base.automation", "search_read", { domain: [["name", "=", name]], fields: ["id"], context: ALL }))[0]?.id ?? rb.created.automations[key], async () =>
    (await call("base.automation", "create", { vals_list: [{ name, model_id: tmplModel, active: true, ...vals }] }))[0]);
  save();
};
await auto("onCreate", NAMES.onCreateAutomation, { trigger: "on_create", action_server_ids: [[6, 0, [aCreate ?? 0]]] });
await auto("onCategory", NAMES.onCategoryAutomation, { trigger: "on_write", trigger_field_ids: [[6, 0, [categField]]], action_server_ids: [[6, 0, [aCat ?? 0]]] });
if (APPLY) {
  // Odoo may fill trigger_field_ids itself: keep categ_id alone (STATUS § 35)
  const [u] = await call("base.automation", "read", { ids: [rb.created.automations.onCategory], fields: ["trigger_field_ids", "active"] });
  if (JSON.stringify(u.trigger_field_ids) !== JSON.stringify([categField])) await call("base.automation", "write", { ids: [rb.created.automations.onCategory], vals: { trigger_field_ids: [[6, 0, [categField]]] } });
  for (const id of Object.values(rb.created.automations)) {
    const [a] = await call("base.automation", "read", { ids: [id], fields: ["active"], context: ALL });
    if (!a.active) { await call("base.automation", "write", { ids: [id], vals: { active: true } }); log(`✎ automation #${id} on again`); }
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
