// § 65 (2026-10-07) — the suppliers' registry on the tenant (scripts/lib/s65-odoo.mjs is the data):
//
//   1  two models — «مواسم المورد» and «طاقة المورد» — with their fields, order and access
//   2  the supplier's card: «حالة المورد» and 19 more fields on res.partner, three one2many, the Arabic
//      names of «نوع المورد» (and its new value «مورد مصاريف»), two Arabic field titles
//   3  seven fields on x_price_offer, two on x_daily_price (the size and the origin), «تفعيل تواصل
//      الموردين» on the settings (off)
//   4  the archived product an unmatched item of an offer hangs on (its required links), and its packaging
//   5  five server actions: two webhooks to the PROD worker (invite / welcome), three code actions
//      (approve / suspend / a line's edit presses its request's «🔄 احسب»), and the line's automation
//   6  the screens: «🧑‍🌾 الموردون» (list, search, form), «📥 عروض الموردين», «📅 تقويم المواسم»,
//      «📦 خريطة الطاقة» — their actions and their menus under «🛒 المشتريات» — and five extension views
//      (the size and the origin beside the price; the settings' switch). The old «الموردين» menu off.
//   7  the data: #55 «مورد مصاريف» (its tag), Ahmad #30 and Raed #109 «معتمد» with no type. Nobody else.
//
//   node scripts/s65-20261007-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s65-20261007-odoo.mjs --apply            the seven steps (the rollback file first)
//   node scripts/s65-20261007-odoo.mjs --verify           read-only checks
//   node scripts/s65-20261007-odoo.mjs --rollback [--apply]   the four menus, the line's automation and the five
//                                                         extension views off, the old menu on, the three partners and the
//                                                         type's names as they were. Fields, models, rows and actions stay.
// Rollback file: scripts/artifacts/s65-20261007-odoo-rollback.json. The tenant is production. No WhatsApp
// send. The hook token is read from an existing server action at run time, never printed.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: it reads x_supplier_state and writes the new fields.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, ensureActWindow, ensureFields, ensureMenu, ensureModel, ensureServerAction, ensureView, log,
  modelId, modelOrderAccess, one, rollbackFile, step,
} from "./lib/s40-kit.mjs";
import * as L from "./lib/s65-odoo.mjs";

const RB = new URL("./artifacts/s65-20261007-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s65-20261007-odoo.mjs");
const { rb, save } = ctx;
const c = rb.created, b = rb.before;
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const AR = { lang: "ar_001" };
const SOURCE_ACTION = "utak.prices.refresh_webhook";
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "type"], context: ALL }))[0] ?? null;
const actionByName = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "state", "model_name", "webhook_url", "code"], context: ALL }))[0] ?? null;
const windowByName = async (name) => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "res_model", "view_mode", "domain", "context", "search_view_id", "view_ids"], context: ALL }))[0] ?? null;
const menuRow = async (title) => (await call("ir.ui.menu", "search_read", { domain: [["name", "=", title], ["parent_id", "=", L.PURCHASE_MENU]], fields: ["id", "sequence", "action", "active"], context: ALL }))[0] ?? null;
const automationRow = async () => (await call("base.automation", "search_read", { domain: [["name", "=", L.LINE_AUTOMATION.name]], fields: ["id", "name", "active", "trigger", "model_name", "trigger_field_ids", "action_server_ids"], context: ALL }))[0] ?? null;
const fieldIds = async (model, names) => {
  const rows = await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "in", names]], fields: ["id", "name"] });
  return names.map((n) => rows.find((r) => r.name === n)?.id).filter(Boolean);
};
const typeRows = async () => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", L.PARTNER], ["name", "=", L.SUPPLIER_TYPE_FIELD]], fields: ["id", "field_description"] });
  const rows = f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f.id]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [];
  return { f, rows };
};
const unlinkedRow = async () => (await call("product.template", "search_read", { domain: [["default_code", "=", L.UNLINKED.code]], fields: ["id", "name", "active", "sale_ok", "x_is_active_for_sale", "x_utak_new"], context: ALL }))[0] ?? null;
/** The prod worker's origin and the hook token, from the action Odoo already calls it with. Never printed. */
async function hookBase() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", SOURCE_ACTION]], fields: ["webhook_url"], limit: 1 });
  const m = /^https:\/\/([^/]+)\/odoo\/hook\/[a-z-]+\?token=([A-Za-z0-9._~-]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error(`could not read the origin / token from ${SOURCE_ACTION}`);
  if (m[1] !== L.PROD_HOST) throw new Error(`${SOURCE_ACTION} does not call the prod worker: ${m[1]}`);
  return { url: (op) => `https://${m[1]}${L.HOOK_PATH}?token=${m[2]}&op=${op}`, shown: (op) => `https://${m[1]}${L.HOOK_PATH}?token=…&op=${op}` };
}
const EXT_NAMES = Object.keys(L.EXTENSIONS);
const MENU_KEYS = Object.keys(L.MENUS);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const off = async (label, model, id) => { if (!id) { log(`= ${label}: not there`); return; } log(`✎ ${label} #${id}: off`); if (APPLY) { await call(model, "write", { ids: [id], vals: { active: false } }); await pause(400); } };
  for (const k of MENU_KEYS) await off(`menu «${L.MENUS[k].title}»`, "ir.ui.menu", (await menuRow(L.MENUS[k].title))?.id);
  if (b.oldMenuActive === true) { log(`✎ menu #${L.OLD_SUPPLIERS_MENU} «الموردين»: on again`); if (APPLY) await call("ir.ui.menu", "write", { ids: [L.OLD_SUPPLIERS_MENU], vals: { active: true } }); }
  await off(`automation «${L.LINE_AUTOMATION.name}»`, "base.automation", (await automationRow())?.id);
  for (const name of EXT_NAMES) await off(`view ${name}`, "ir.ui.view", (await viewByName(name))?.id);
  for (const d of L.DATA) {
    const was = b.partners?.[d.id];
    if (!was) { log(`= partner #${d.id}: no value of before kept`); continue; }
    log(`✎ partner #${d.id} «${d.name}»: ${JSON.stringify(was)}`);
    if (APPLY) { await call(L.PARTNER, "write", { ids: [d.id], vals: was }); await pause(400); }
  }
  for (const r of b.typeRows ?? []) {
    log(`✎ «${L.SUPPLIER_TYPE_FIELD}» ${r.value}: «${r.name}» (sequence ${r.sequence})`);
    if (APPLY) { await call("ir.model.fields.selection", "write", { ids: [r.id], vals: { name: r.name, sequence: r.sequence } }); await call("ir.model.fields.selection", "write", { ids: [r.id], vals: { name: r.name }, context: AR }); await pause(300); }
  }
  for (const [name, was] of Object.entries(b.titles ?? {})) {
    log(`✎ ${L.PARTNER}.${name}: «${was.title}»`);
    if (APPLY) { await call("ir.model.fields", "write", { ids: [was.id], vals: { field_description: was.title } }); await call("ir.model.fields", "write", { ids: [was.id], vals: { field_description: was.title }, context: AR }); await pause(300); }
  }
  void DROP;
  log("the two models, every field, the rows, the views, the actions, «مورد مصاريف» and the unlinked product stay (nothing is deleted); the buttons call a hook the rolled-back code answers 404");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const fieldsOk = async (model, defs) => {
    const f = await call(model, "fields_get", { attributes: ["type", "string", "relation", "store", "selection", "required"] });
    const bad = defs.filter((d) => !(f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && (!d.relation || f[d.name].relation === d.relation) && (!d.required || f[d.name].required)));
    check(`${model}: its ${defs.length} field(s), each of its kind, title and relation`, !bad.length, JSON.stringify(bad.map((d) => [d.name, f[d.name]])));
    await pause();
    return f;
  };
  for (const [model, name, order, defs] of [[L.SEASON_MODEL, L.SEASON_MODEL_NAME, L.SEASON_ORDER, L.SEASON_FIELDS], [L.CAPACITY_MODEL, L.CAPACITY_MODEL_NAME, L.CAPACITY_ORDER, L.CAPACITY_FIELDS]]) {
    const mid = await modelId(model);
    const [m] = mid ? await call("ir.model", "read", { ids: [mid], fields: ["id", "model", "name", "order", "access_ids"] }) : [];
    check(`the model ${model} #${mid} «${name}», ordered «${order}», with an access rule`, m?.name === name && m.order === order && (m.access_ids ?? []).length > 0, JSON.stringify(m));
    if (mid) await fieldsOk(model, defs);
  }
  const pf = await fieldsOk(L.PARTNER, [...L.PARTNER_FIELDS, ...L.PARTNER_O2M]);
  check(`«${L.SUPPLIER_TYPE_TITLE}»: its seven values in order, in Arabic`, JSON.stringify(pf[L.SUPPLIER_TYPE_FIELD]?.selection ?? []) === JSON.stringify(L.SUPPLIER_TYPES) && pf[L.SUPPLIER_TYPE_FIELD].string === L.SUPPLIER_TYPE_TITLE, JSON.stringify(pf[L.SUPPLIER_TYPE_FIELD]));
  check(`«${L.SUPPLIED_TITLE}» is the title of ${L.SUPPLIED_FIELD}`, pf[L.SUPPLIED_FIELD]?.string === L.SUPPLIED_TITLE, pf[L.SUPPLIED_FIELD]?.string);
  check("«حالة المورد»: بانتظار الاعتماد / معتمد / موقوف", JSON.stringify(pf.x_supplier_state?.selection ?? []) === JSON.stringify(L.STATES));
  check("«إيقاع التواصل»: يومي / أسبوعي / شهري / عند الطلب", JSON.stringify(pf.x_contact_cadence?.selection ?? []) === JSON.stringify(L.CADENCES));
  const of = await fieldsOk(L.OFFER_MODEL, L.OFFER_FIELDS);
  check("«نوع العرض»: عرض مورد / صنف إضافي", JSON.stringify(of.x_offer_kind?.selection ?? []) === JSON.stringify(L.OFFER_KINDS));
  await fieldsOk(L.DAILY_MODEL, L.DAILY_FIELDS);
  await fieldsOk(L.CONFIG_MODEL, L.CONFIG_FIELDS);
  const cfgs = await call(L.CONFIG_MODEL, "search_read", { domain: [], fields: ["id", "x_is_active", "x_supplier_outreach"], limit: 20 });
  check(`«تفعيل تواصل الموردين» is off on every settings row (${cfgs.length})`, cfgs.length > 0 && cfgs.every((r) => r.x_supplier_outreach === false), JSON.stringify(cfgs));
  await pause();

  const un = await unlinkedRow();
  const packs = un ? await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "=", un.id]], fields: ["id", "x_name", "x_is_default"], limit: 5 }) : [];
  check(`the unlinked item #${un?.id} «${L.UNLINKED.name}»: archived, not for sale, no «صنف جديد» flag, with a packaging #${packs[0]?.id}`, !!un && un.active === false && un.x_is_active_for_sale === false && un.x_utak_new === false && packs.length >= 1, JSON.stringify([un, packs]));
  await pause();

  const base = await hookBase();
  const ids = {};
  for (const [k, h] of Object.entries(L.HOOKS)) {
    const a = await actionByName(h.name); ids[k] = a?.id;
    check(`action ${h.name} #${a?.id}: a webhook of ${L.PARTNER} → ${base.shown(h.op)}`, a?.state === "webhook" && a.model_name === L.PARTNER && a.webhook_url === base.url(h.op));
  }
  for (const [k, def] of [...Object.entries(L.CODE_ACTIONS), ["line", L.LINE_ACTION]]) {
    const a = await actionByName(def.name); ids[k] = a?.id;
    check(`action ${def.name} #${a?.id}: code of ${def.model}, as written`, a?.state === "code" && a.model_name === def.model && a.code === def.code, JSON.stringify(a?.code));
  }
  await pause();
  const auto = await automationRow();
  const trig = await fieldIds(L.LINE_MODEL, L.LINE_AUTOMATION.fields);
  check(`the automation «${L.LINE_AUTOMATION.name}» #${auto?.id}: ${L.LINE_AUTOMATION.trigger} of ${L.LINE_MODEL} on ${L.LINE_AUTOMATION.fields.join(", ")} → the line's action alone`,
    !!auto?.active && auto.trigger === L.LINE_AUTOMATION.trigger && auto.model_name === L.LINE_MODEL && JSON.stringify([...auto.trigger_field_ids].sort()) === JSON.stringify([...trig].sort()) && JSON.stringify(auto.action_server_ids) === JSON.stringify([ids.line]), JSON.stringify(auto));
  await pause();

  const V = L.VIEWS;
  const want = {
    [V.suppliersList]: L.suppliersListArch(ids), [V.suppliersSearch]: L.SUPPLIERS_SEARCH_ARCH, [V.suppliersForm]: L.supplierFormArch(ids),
    [V.offersList]: L.OFFERS_LIST_ARCH, [V.offersSearch]: L.OFFERS_SEARCH_ARCH, [V.seasonsPivot]: L.SEASONS_PIVOT_ARCH, [V.seasonsList]: L.SEASONS_LIST_ARCH,
    [V.seasonsSearch]: L.SEASONS_SEARCH_ARCH, [V.capacityList]: L.CAPACITY_LIST_ARCH, [V.capacitySearch]: L.CAPACITY_SEARCH_ARCH,
  };
  const got = {};
  for (const [name, arch] of Object.entries(want)) {
    const v = await viewByName(name); got[name] = v;
    check(`the view ${name} #${v?.id}: active, as written`, !!v?.active && v.arch_db === arch, "the stored arch differs");
    await pause(400);
  }
  const form = got[V.suppliersForm]?.arch_db ?? "";
  check("the supplier's form: five tabs — البيانات، الأصناف والطاقة، المواسم، العروض والأسعار، الدفع", JSON.stringify([...form.matchAll(/<page string="([^"]+)"/g)].map((m) => m[1])) === JSON.stringify(["البيانات", "الأصناف والطاقة", "المواسم", "العروض والأسعار", "الدفع"]));
  check("the suppliers' list: its nine columns in order, and the three buttons above", (() => {
    const arch = got[V.suppliersList]?.arch_db ?? "";
    const cols = [...arch.matchAll(/<field name="([a-z_]+)"([^>]*)\/>/g)].filter((m) => !/optional="hide"/.test(m[2])).map((m) => m[1]);
    return JSON.stringify(cols) === JSON.stringify(["name", "x_supplier_type", "x_supplier_state", "x_supplier_location", "x_supplied_product_ids", "x_last_offer_text", "x_reply_rate", "x_price_gap_pct", "x_sp_remaining"])
      && [ids.approve, ids.suspend, ids.invite].every((id) => arch.includes(`<button name="${id}" type="action"`));
  })());
  for (const model of [L.PARTNER, L.SEASON_MODEL, L.CAPACITY_MODEL, L.OFFER_MODEL]) {
    // Odoo itself builds each screen (a wrong field or xpath fails here, not on Baraa's click)
    const types = model === L.PARTNER ? [["form", got[V.suppliersForm]?.id], ["list", got[V.suppliersList]?.id]] : model === L.SEASON_MODEL ? [["pivot", got[V.seasonsPivot]?.id], ["list", got[V.seasonsList]?.id]]
      : model === L.CAPACITY_MODEL ? [["list", got[V.capacityList]?.id]] : [["list", got[V.offersList]?.id]];
    for (const [type, id] of types) {
      let how = "";
      const r = id ? await call(model, "get_view", { view_id: id, view_type: type }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; }) : null;
      check(`Odoo builds the ${type} #${id} of ${model}`, !!r?.arch, how);
      await pause(400);
    }
  }
  for (const name of EXT_NAMES) {
    const def = L.EXTENSIONS[name], v = await viewByName(name), p = await viewByName(def.parent);
    check(`the extension ${name} #${v?.id} on ${def.parent} #${p?.id}: active, as written`, !!v?.active && v.inherit_id?.[0] === p?.id && v.arch_db === def.arch, JSON.stringify(v?.arch_db));
    let how = "";
    const r = p ? await call(def.model, "get_view", { view_id: p.id, view_type: p.type }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; }) : null;
    check(`Odoo builds ${def.parent} with it (${name === "utak.pricing_settings_form.s65_outreach" ? "the switch" : "the size and the origin"} shown)`, !!r?.arch && r.arch.includes(name.endsWith("outreach") ? 'name="x_supplier_outreach"' : 'name="x_item_size"'), how);
    await pause(400);
  }
  const SEARCH_OF = { suppliers: V.suppliersSearch, offers: V.offersSearch, seasons: V.seasonsSearch, capacity: V.capacitySearch };
  for (const k of MENU_KEYS) {
    const def = L.ACTIONS[k], w = await windowByName(def.name), m = await menuRow(L.MENUS[k].title);
    check(`the action «${def.name}» #${w?.id}: ${def.res_model}, ${def.view_mode}, its domain, context and search`, w?.res_model === def.res_model && w.view_mode === def.view_mode && (w.domain || "[]") === def.domain && (w.context || "{}") === def.context && w.search_view_id?.[0] === got[SEARCH_OF[k]]?.id, JSON.stringify(w));
    check(`the menu «${L.MENUS[k].title}» #${m?.id} under «🛒 المشتريات» opens it`, !!m?.active && m.sequence === L.MENUS[k].sequence && m.action === `ir.actions.act_window,${w?.id}`, JSON.stringify(m));
    await pause(400);
  }
  const sw = await windowByName(L.ACTIONS.suppliers.name);
  const bound = sw?.view_ids?.length ? await call("ir.actions.act_window.view", "read", { ids: sw.view_ids, fields: ["view_mode", "view_id", "sequence"] }) : [];
  check("«🧑‍🌾 الموردون» opens its own list and its own form", bound.some((x) => x.view_mode === "list" && x.view_id?.[0] === got[V.suppliersList]?.id) && bound.some((x) => x.view_mode === "form" && x.view_id?.[0] === got[V.suppliersForm]?.id), JSON.stringify(bound));
  const [old] = await call("ir.ui.menu", "search_read", { domain: [["id", "=", L.OLD_SUPPLIERS_MENU]], fields: ["id", "active"], context: ALL });
  check(`the old menu «الموردين» #${L.OLD_SUPPLIERS_MENU} is off`, old?.active === false, JSON.stringify(old));
  await pause();

  const parts = await call(L.PARTNER, "read", { ids: L.DATA.map((d) => d.id), fields: ["id", "name", "x_supplier_type", "x_supplier_state", "category_id", "x_contact_cadence"] });
  for (const d of L.DATA) {
    const p = parts.find((x) => x.id === d.id);
    check(`#${d.id} «${d.name}»: ${JSON.stringify(d.vals)}${d.id === 55 ? " (its tag «مورد مصاريف»)" : ", no type"}`, !!p && Object.entries(d.vals).every(([k, v]) => p[k] === v) && (d.id === 55 ? (p.category_id ?? []).includes(L.EXPENSE_TAG) : p.x_supplier_type === false), JSON.stringify(p));
  }
  const touched = await call(L.PARTNER, "search_read", { domain: [["x_supplier_state", "!=", false]], fields: ["id", "name", "x_supplier_state", "x_utak_simulation"], context: ALL, limit: 50 });
  check(`a state on Ahmad and Raed alone among the real partners (${touched.filter((p) => !p.x_utak_simulation).map((p) => `#${p.id}`).join(" ")})`, JSON.stringify(touched.filter((p) => !p.x_utak_simulation).map((p) => p.id).sort((x, y) => x - y)) === JSON.stringify([30, 109]), JSON.stringify(touched));
  // the worker's reads answer
  let how = "";
  const r1 = await call(L.PARTNER, "search_read", { domain: ["|", "|", ["x_price_source", "=", true], ["supplier_rank", ">", 0], ["x_supplier_state", "!=", false]], fields: ["id", "x_supplier_state", "x_supplier_type", "x_contact_cadence", "x_next_contact"], limit: 5 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
  check(`the worker's read of the closed numbers answers (${r1?.length ?? "-"} read)`, Array.isArray(r1), how);
  const r2 = await call(L.OFFER_MODEL, "search_read", { domain: [["x_offer_kind", "=", "supplier_offer"]], fields: [...L.OFFER_FIELDS.map((d) => d.name), "x_special", "x_special_unit", "x_available_qty"], limit: 3 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
  check(`the worker's read of the suppliers' offers answers (${r2?.length ?? "-"} read)`, Array.isArray(r2), how);
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write
const base = await hookBase();
log(`hook: ${base.shown("<op>")} (the token is read from «${SOURCE_ACTION}», not printed)`);

log("— 1: the two models");
const partnerMid = await modelId(L.PARTNER);
const seasonMid = await ensureModel(ctx, "seasonModel", L.SEASON_MODEL, L.SEASON_MODEL_NAME);
await pause();
await ensureFields(ctx, L.SEASON_MODEL, seasonMid, L.SEASON_FIELDS);
await pause();
const capacityMid = seasonMid || APPLY ? await ensureModel(ctx, "capacityModel", L.CAPACITY_MODEL, L.CAPACITY_MODEL_NAME) : (log(`+ model ${L.CAPACITY_MODEL}`), null);
await pause();

log("— 2: the supplier's card");
await ensureFields(ctx, L.PARTNER, partnerMid, L.PARTNER_FIELDS);
await pause();
// the capacity's «نسبة الرد» is related to the card's: after the card's field
await ensureFields(ctx, L.CAPACITY_MODEL, capacityMid, L.CAPACITY_FIELDS);
await pause();
await modelOrderAccess(seasonMid, L.SEASON_MODEL, L.SEASON_ORDER);
await modelOrderAccess(capacityMid, L.CAPACITY_MODEL, L.CAPACITY_ORDER);
await pause();
if (seasonMid && capacityMid) await ensureFields(ctx, L.PARTNER, partnerMid, L.PARTNER_O2M);
else for (const d of L.PARTNER_O2M) log(`+ ${L.PARTNER}.${d.name} (one2many)`);
await pause();
{
  const { f, rows } = await typeRows();
  if (!f) throw new Error(`${L.SUPPLIER_TYPE_FIELD} is not there — stop`);
  b.typeRows ??= rows.map((r) => ({ id: r.id, value: r.value, name: r.name, sequence: r.sequence }));
  b.titles ??= {};
  save();
  for (const [i, [value, name]] of L.SUPPLIER_TYPES.entries()) {
    const row = rows.find((r) => r.value === value);
    if (row && row.name === name && row.sequence === i) { log(`= «${L.SUPPLIER_TYPE_FIELD}» ${value}: «${name}»`); continue; }
    if (row) {
      log(`✎ «${L.SUPPLIER_TYPE_FIELD}» ${value}: «${row.name}» → «${name}» (sequence ${i})`);
      if (APPLY) { await call("ir.model.fields.selection", "write", { ids: [row.id], vals: { name, sequence: i } }); await call("ir.model.fields.selection", "write", { ids: [row.id], vals: { name }, context: AR }); await pause(300); }
    } else {
      log(`+ «${L.SUPPLIER_TYPE_FIELD}» ${value}: «${name}» (sequence ${i})`);
      if (APPLY) { [c.expenseSelection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: f.id, value, name, sequence: i }] }); save(); await pause(300); }
    }
  }
  for (const [name, title] of [[L.SUPPLIER_TYPE_FIELD, L.SUPPLIER_TYPE_TITLE], [L.SUPPLIED_FIELD, L.SUPPLIED_TITLE]]) {
    const [row] = await call("ir.model.fields", "search_read", { domain: [["model", "=", L.PARTNER], ["name", "=", name]], fields: ["id", "field_description"] });
    if (!row) throw new Error(`${L.PARTNER}.${name} is not there — stop`);
    if (row.field_description === title) { log(`= ${L.PARTNER}.${name}: «${title}»`); continue; }
    log(`✎ ${L.PARTNER}.${name}: «${row.field_description}» → «${title}»`);
    b.titles[name] ??= { id: row.id, title: row.field_description }; save();
    if (APPLY) { await call("ir.model.fields", "write", { ids: [row.id], vals: { field_description: title } }); await call("ir.model.fields", "write", { ids: [row.id], vals: { field_description: title }, context: AR }); await pause(300); }
  }
}

log("— 3: the offers, the daily prices, the settings");
await ensureFields(ctx, L.OFFER_MODEL, await modelId(L.OFFER_MODEL), L.OFFER_FIELDS);
await pause();
await ensureFields(ctx, L.DAILY_MODEL, await modelId(L.DAILY_MODEL), L.DAILY_FIELDS);
await pause();
await ensureFields(ctx, L.CONFIG_MODEL, await modelId(L.CONFIG_MODEL), L.CONFIG_FIELDS);
await pause();

log("— 4: the unlinked item");
{
  let un = await unlinkedRow();
  if (un) log(`= product «${L.UNLINKED.name}» #${un.id}`);
  else {
    log(`+ product «${L.UNLINKED.name}» [${L.UNLINKED.code}] (archived, not for sale, no «صنف جديد» alert)`);
    if (APPLY) {
      [c.unlinkedProduct] = await call("product.template", "create", { vals_list: [{ name: L.UNLINKED.name, default_code: L.UNLINKED.code, sale_ok: false, purchase_ok: false }] });
      save();
      await pause();
      // the new-item automation flags it for a «🆕 صنف جديد» alert ten minutes later: off at once
      await call("product.template", "write", { ids: [c.unlinkedProduct], vals: { x_utak_new: false, x_is_active_for_sale: false } });
      await pause();
      un = await unlinkedRow();
    }
  }
  if (un) {
    const packs = await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "=", un.id]], fields: ["id", "x_name"], limit: 5 });
    if (packs.length) log(`= its packaging #${packs[0].id} «${packs[0].x_name}»`);
    else {
      log(`+ its packaging «${L.UNLINKED.pack}»`);
      if (APPLY) { [c.unlinkedPack] = await call("x_product_packaging", "create", { vals_list: [{ x_name: L.UNLINKED.pack, x_product_tmpl_id: un.id, x_is_default: true }] }); save(); await pause(); }
    }
    if (un.active || un.x_utak_new || un.x_is_active_for_sale) {
      log(`✎ product #${un.id}: archived, not for sale, no «صنف جديد» flag`);
      if (APPLY) { await call("product.template", "write", { ids: [un.id], vals: { x_utak_new: false, x_is_active_for_sale: false, active: false } }); await pause(); }
    }
  }
}

log("— 5: the five server actions and the line's automation");
const ids = {};
for (const [key, h] of Object.entries(L.HOOKS)) {
  ids[key] = await ensureServerAction(ctx, key, h.name, { model_id: partnerMid, state: "webhook", webhook_url: base.url(h.op), webhook_field_ids: [[6, 0, []]] });
  await pause(500);
}
const lineMid = await modelId(L.LINE_MODEL);
for (const [key, def] of [...Object.entries(L.CODE_ACTIONS), ["line", L.LINE_ACTION]]) {
  ids[key] = await ensureServerAction(ctx, key, def.name, { model_id: def.model === L.PARTNER ? partnerMid : lineMid, state: "code", code: def.code });
  const have = ids[key] ? await actionByName(def.name) : null;
  if (have && have.code !== def.code) {
    log(`✎ action ${def.name} #${have.id}: its code, as written here`);
    b.actionCode ??= {}; b.actionCode[def.name] ??= have.code; save();
    if (APPLY) await call("ir.actions.server", "write", { ids: [have.id], vals: { code: def.code } });
  }
  await pause(500);
}
{
  const auto = await automationRow();
  if (auto && !auto.active) {
    log(`✎ automation «${L.LINE_AUTOMATION.name}» #${auto.id}: on again`);
    if (APPLY) await call("base.automation", "write", { ids: [auto.id], vals: { active: true } });
  } else {
    c.lineAutomation = await step(`automation ${L.LINE_AUTOMATION.name} (${L.LINE_MODEL}, ${L.LINE_AUTOMATION.trigger}: ${L.LINE_AUTOMATION.fields.join(", ")})`, auto?.id ?? c.lineAutomation, async () => (await call("base.automation", "create", { vals_list: [{
      name: L.LINE_AUTOMATION.name, model_id: lineMid, trigger: L.LINE_AUTOMATION.trigger, active: true,
      trigger_field_ids: [[6, 0, await fieldIds(L.LINE_MODEL, L.LINE_AUTOMATION.fields)]], action_server_ids: [[6, 0, [ids.line]]],
    }] }))[0]);
    save();
  }
  await pause();
}

log("— 6: the screens");
const ready = !!(seasonMid && capacityMid && ids.approve && ids.suspend && ids.invite) || APPLY;
const V = L.VIEWS;
const view = async (key, name, model, type, arch) => {
  if (!ready) { log(`+ view ${name}`); return null; }
  const id = await ensureView(ctx, key, name, { model, type, priority: 16, arch_base: arch });
  // a view made by an earlier run is brought up to date (its arch of before is kept in the rollback file)
  const have = id ? await viewByName(name) : null;
  if (have && have.arch_db !== arch) {
    log(`✎ view ${name} #${have.id}: its arch, as written here`);
    b.arch ??= {}; b.arch[name] ??= have.arch_db; save();
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: arch } });
  }
  await pause(500);
  return id;
};
const vid = {};
vid.suppliersList = await view("suppliersList", V.suppliersList, L.PARTNER, "list", L.suppliersListArch(ids));
vid.suppliersSearch = await view("suppliersSearch", V.suppliersSearch, L.PARTNER, "search", L.SUPPLIERS_SEARCH_ARCH);
vid.suppliersForm = await view("suppliersForm", V.suppliersForm, L.PARTNER, "form", L.supplierFormArch(ids));
vid.offersList = await view("offersList", V.offersList, L.OFFER_MODEL, "list", L.OFFERS_LIST_ARCH);
vid.offersSearch = await view("offersSearch", V.offersSearch, L.OFFER_MODEL, "search", L.OFFERS_SEARCH_ARCH);
vid.seasonsPivot = await view("seasonsPivot", V.seasonsPivot, L.SEASON_MODEL, "pivot", L.SEASONS_PIVOT_ARCH);
vid.seasonsList = await view("seasonsList", V.seasonsList, L.SEASON_MODEL, "list", L.SEASONS_LIST_ARCH);
vid.seasonsSearch = await view("seasonsSearch", V.seasonsSearch, L.SEASON_MODEL, "search", L.SEASONS_SEARCH_ARCH);
vid.capacityList = await view("capacityList", V.capacityList, L.CAPACITY_MODEL, "list", L.CAPACITY_LIST_ARCH);
vid.capacitySearch = await view("capacitySearch", V.capacitySearch, L.CAPACITY_MODEL, "search", L.CAPACITY_SEARCH_ARCH);

for (const name of EXT_NAMES) {
  const def = L.EXTENSIONS[name], p = await viewByName(def.parent);
  if (!p) { log(`✗ the view ${def.parent} is not there — ${name} not made`); continue; }
  const have = await viewByName(name);
  if (have && !have.active) {
    log(`✎ view ${name} #${have.id}: on again`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true } });
  } else await ensureView(ctx, name, name, { model: def.model, inherit_id: p.id, mode: "extension", priority: 99, arch_base: def.arch });
  await pause(500);
}

const SEARCH_OF = { suppliers: "suppliersSearch", offers: "offersSearch", seasons: "seasonsSearch", capacity: "capacitySearch" };
const BOUND = { suppliers: [["list", "suppliersList"], ["form", "suppliersForm"]], offers: [["list", "offersList"]], seasons: [["pivot", "seasonsPivot"], ["list", "seasonsList"]], capacity: [["list", "capacityList"]] };
for (const k of MENU_KEYS) {
  const def = L.ACTIONS[k];
  const viewIds = BOUND[k].map(([mode, key], i) => [0, 0, { sequence: i + 1, view_mode: mode, view_id: vid[key] }]);
  const actionId = !ready ? (log(`+ act_window ${def.name}`), null) : await ensureActWindow(ctx, k, def.name, {
    res_model: def.res_model, view_mode: def.view_mode, domain: def.domain, context: def.context, help: def.help,
    ...(vid[SEARCH_OF[k]] ? { search_view_id: vid[SEARCH_OF[k]] } : {}), ...(BOUND[k].every(([, key]) => vid[key]) ? { view_ids: viewIds } : {}),
  });
  await pause(500);
  const menu = await menuRow(L.MENUS[k].title);
  if (menu && !menu.active) {
    log(`✎ menu «${L.MENUS[k].title}» #${menu.id}: on again`);
    if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: true } });
  } else await ensureMenu(ctx, k, L.MENUS[k].title, L.PURCHASE_MENU, actionId ? `ir.actions.act_window,${actionId}` : false, L.MENUS[k].sequence);
  await pause(500);
}
{
  const [old] = await call("ir.ui.menu", "search_read", { domain: [["id", "=", L.OLD_SUPPLIERS_MENU]], fields: ["id", "name", "active"], context: ALL });
  b.oldMenuActive ??= old?.active ?? null; save();
  if (old?.active) { log(`✎ menu #${old.id} «${old.name}»: off (the new «${L.MENUS.suppliers.title}» takes its place)`); if (APPLY) await call("ir.ui.menu", "write", { ids: [old.id], vals: { active: false } }); }
  else log(`= menu #${L.OLD_SUPPLIERS_MENU}: off`);
}
await pause();

log("— 7: the data (three partners)");
{
  const rows = await call(L.PARTNER, "read", { ids: L.DATA.map((d) => d.id), fields: ["id", "name", "x_supplier_type", "category_id", ...(await fieldIds(L.PARTNER, ["x_supplier_state"])).length ? ["x_supplier_state"] : []] });
  b.partners ??= {};
  for (const d of L.DATA) {
    const p = rows.find((x) => x.id === d.id);
    if (!p) { log(`✗ partner #${d.id} «${d.name}» is not there`); continue; }
    if (d.id === 55 && !(p.category_id ?? []).includes(L.EXPENSE_TAG)) { log(`✗ partner #55 does not carry the tag «مورد مصاريف» — not classified`); continue; }
    const diff = Object.fromEntries(Object.entries(d.vals).filter(([k, v]) => (p[k] ?? false) !== v));
    if (!Object.keys(diff).length) { log(`= partner #${d.id} «${p.name}»: ${JSON.stringify(d.vals)}`); continue; }
    log(`✎ partner #${d.id} «${p.name}»: ${JSON.stringify(diff)}`);
    b.partners[d.id] ??= Object.fromEntries(Object.keys(diff).map((k) => [k, p[k] ?? false])); save();
    if (APPLY) { await call(L.PARTNER, "write", { ids: [d.id], vals: diff }); await pause(400); }
  }
}
save();
void one;
log(APPLY ? "done — verify: node scripts/s65-20261007-odoo.mjs --verify" : "dry-run: nothing written");
