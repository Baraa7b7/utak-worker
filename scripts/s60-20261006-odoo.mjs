// § 60 ج (2026-10-06) — «طلبوا وما كان متوفر»: the light record of every «هذا الصنف غير متوفر اليوم»
// (scripts/lib/s60-odoo.mjs is the data):
//
//   1  the model x_unavailable_request, its six fields, its order and «Role / User» access
//   2  its list (read-only), its action (the real rows alone) and its menu under «💲 التسعير»
//
//   node scripts/s60-20261006-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s60-20261006-odoo.mjs --apply            the two steps (the rollback file first)
//   node scripts/s60-20261006-odoo.mjs --verify           read-only checks (and § 58's history views: the contribution is a measure)
//   node scripts/s60-20261006-odoo.mjs --rollback [--apply]          the menu off. The model, its fields and its rows stay (nothing is deleted).
//   node scripts/s60-20261006-odoo.mjs --rollback --drop [--apply]   and delete the menu, the action, the view, the fields and the model — by
//                                                         Baraa's decision only, AFTER the worker's code is rolled back (it writes the rows).
// Rollback file: scripts/artifacts/s60-20261006-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, decision, order, invoice, payment or journal entry is written here.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the worker creates a row with every «غير متوفر اليوم».
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu, ensureModel, ensureView, log, modelId, modelOrderAccess, rollbackFile } from "./lib/s40-kit.mjs";
import {
  CONTRIBUTION_FIELD, HISTORY_VIEWS, PRICING_MENU, REQUEST_ACTION, REQUEST_DOMAIN, REQUEST_FIELDS, REQUEST_LIST_ARCH, REQUEST_MENU_SEQUENCE, REQUEST_MODEL,
  REQUEST_MODEL_NAME, REQUEST_ORDER, REQUEST_TITLE, REQUEST_VIEW,
} from "./lib/s60-odoo.mjs";

const RB = new URL("./artifacts/s60-20261006-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s60-20261006-odoo.mjs");
const { rb, save } = ctx;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const menuRow = async () => (await call("ir.ui.menu", "search_read", { domain: [["name", "=", REQUEST_TITLE], ["parent_id", "=", PRICING_MENU]], fields: ["id", "sequence", "action", "active"], context: ALL }))[0] ?? null;

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const menu = await menuRow();
  log(menu ? `✎ menu «${REQUEST_TITLE}» #${menu.id}: off` : `= menu «${REQUEST_TITLE}»: not there`);
  if (APPLY && menu?.active) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: false } });
  const c = rb.created;
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", Object.values(c.menus ?? {})], ["ir.actions.act_window", Object.values(c.windows ?? {})], ["ir.ui.view", Object.values(c.views ?? {})],
      ["ir.model.fields", [...(c.fields ?? [])].reverse()], ["ir.model", [c.model]],
    ]);
  } else log(`the model ${REQUEST_MODEL}, its fields, its list and its rows: stay (the worker writes the rows; nothing is deleted)`);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const mid = await modelId(REQUEST_MODEL);
  const [model] = mid ? await call("ir.model", "read", { ids: [mid], fields: ["id", "model", "name", "order", "access_ids"] }) : [];
  check(`the model ${REQUEST_MODEL} #${mid} «${REQUEST_MODEL_NAME}», ordered «${REQUEST_ORDER}», with an access rule`, model?.name === REQUEST_MODEL_NAME && model.order === REQUEST_ORDER && (model.access_ids ?? []).length > 0, JSON.stringify(model));
  await pause();
  const f = mid ? await call(REQUEST_MODEL, "fields_get", { attributes: ["type", "string", "relation", "store"] }) : {};
  check(`its fields: ${REQUEST_FIELDS.map((d) => `${d.name} (${d.ttype})`).join(", ")}`, REQUEST_FIELDS.every((d) => f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && f[d.name].store && (!d.relation || f[d.name].relation === d.relation)), JSON.stringify(REQUEST_FIELDS.filter((d) => f[d.name]?.type !== d.ttype).map((d) => [d.name, f[d.name]])));
  await pause();
  const [view] = await call("ir.ui.view", "search_read", { domain: [["name", "=", REQUEST_VIEW]], fields: ["id", "model", "type", "active", "arch_db"], context: ALL });
  check(`the list ${REQUEST_VIEW} #${view?.id}: read-only, as written`, view?.active && view.model === REQUEST_MODEL && view.type === "list" && view.arch_db === REQUEST_LIST_ARCH && /create="0"/.test(view.arch_db) && /edit="0"/.test(view.arch_db), JSON.stringify(view?.arch_db));
  await pause();
  const [action] = await call("ir.actions.act_window", "search_read", { domain: [["name", "=", REQUEST_ACTION]], fields: ["id", "res_model", "view_mode", "domain"] });
  check(`the action «${REQUEST_ACTION}» #${action?.id}: the real rows alone, as a list`, action?.res_model === REQUEST_MODEL && action.view_mode === "list" && action.domain === REQUEST_DOMAIN, JSON.stringify(action));
  await pause();
  const menu = await menuRow();
  check(`the menu «${REQUEST_TITLE}» #${menu?.id} under «💲 التسعير» (#${PRICING_MENU}), after «📈 تاريخ الأسعار», opens it`, !!menu?.active && menu.sequence === REQUEST_MENU_SEQUENCE && menu.action === `ir.actions.act_window,${action?.id}`, JSON.stringify(menu));
  await pause();
  // the model answers a read as the worker reads it, and holds no row of a simulation in the real ones
  let rows = null, how = "";
  try { rows = await call(REQUEST_MODEL, "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: REQUEST_FIELDS.map((d) => d.name), order: REQUEST_ORDER, limit: 5 }); } catch (e) { how = String(e?.message ?? e).slice(0, 160); }
  check(`the worker's read of the real rows answers (${rows?.length ?? "-"} of the last five)`, Array.isArray(rows), how);
  await pause();
  // د 4 — «📈 تاريخ الأسعار» (§ 58): the carton's contribution is one of its measures
  const history = await call("ir.ui.view", "search_read", { domain: [["name", "in", HISTORY_VIEWS]], fields: ["id", "name", "type", "active", "arch_db"], context: ALL });
  const pivot = history.find((v) => v.type === "pivot");
  const lineField = (await call("x_price_day_line", "fields_get", { attributes: ["type", "string", "store"] }))[CONTRIBUTION_FIELD];
  check(`«📈 تاريخ الأسعار»: «${lineField?.string}» (${CONTRIBUTION_FIELD}) is a stored number of the line and a measure of the pivot #${pivot?.id}; the graph #${history.find((v) => v.type === "graph")?.id} is active (any stored number is a measure of it)`,
    history.length === 2 && history.every((v) => v.active) && lineField?.type === "float" && lineField.store === true && new RegExp(`<field name="${CONTRIBUTION_FIELD}" type="measure"/>`).test(pivot?.arch_db ?? ""), JSON.stringify([lineField, pivot?.arch_db]));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the model ${REQUEST_MODEL}`);
const mid = await ensureModel(ctx, "model", REQUEST_MODEL, REQUEST_MODEL_NAME);
await pause();
await ensureFields(ctx, REQUEST_MODEL, mid, REQUEST_FIELDS);
await pause();
await modelOrderAccess(mid, REQUEST_MODEL, REQUEST_ORDER);
await pause();

log(`— 2: its list, its action and its menu`);
for (const l of REQUEST_LIST_ARCH.split("\n")) log(`    ${l}`);
// a view of a model that does not exist yet cannot be made: the dry-run before the model shows the plan
const viewId = mid || APPLY ? await ensureView(ctx, "list", REQUEST_VIEW, { model: REQUEST_MODEL, type: "list", priority: 16, arch_base: REQUEST_LIST_ARCH }) : (log(`+ view ${REQUEST_VIEW}`), null);
await pause();
const actionId = await ensureActWindow(ctx, "requests", REQUEST_ACTION, {
  res_model: REQUEST_MODEL, view_mode: "list", domain: REQUEST_DOMAIN, context: "{}",
  help: "<p>كل صنف طلبه عميل وردّ عليه النظام «غير متوفر اليوم»: اليوم، والعميل، والصنف كما كتبه، والكمية إن ذُكرت. يكتبه الوركر.</p>",
});
await pause();
const menu = await menuRow();
if (menu && !menu.active) {
  log(`✎ menu «${REQUEST_TITLE}» #${menu.id}: on again`);
  if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: true } });
} else await ensureMenu(ctx, "requests", REQUEST_TITLE, PRICING_MENU, actionId ? `ir.actions.act_window,${actionId}` : false, REQUEST_MENU_SEQUENCE);
void viewId;
save();
log(APPLY ? "done — verify: node scripts/s60-20261006-odoo.mjs --verify" : "dry-run: nothing written");
