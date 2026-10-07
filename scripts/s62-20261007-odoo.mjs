// § 62 أ (2026-10-07) — «طلب أسعار خاص» on the tenant (scripts/lib/s62-odoo.mjs is the data):
//
//   1  three models — the request, its lines, its sources — with their fields, order and access
//   2  three fields on x_price_offer: «خاص», the request, the unit of the price
//   3  seven server actions: five webhooks to the PROD worker (send / recalc / accept / issue / pdf)
//      and two code actions (close / reopen)
//   4  the list, the search and the form; the action; the menu «💲 التسعير ← 🧾 طلبات أسعار خاصة»
//   5  the automation: a save that changes what the numbers are made of asks the worker for them
//   6  three extension views on «عروض المصادر»: the «خاص» column and its two filters
//
//   node scripts/s62-20261007-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s62-20261007-odoo.mjs --apply            the six steps (the rollback file first)
//   node scripts/s62-20261007-odoo.mjs --verify           read-only checks
//   node scripts/s62-20261007-odoo.mjs --rollback [--apply]          the menu, the automation and the three extension views off.
//                                                         The models, their fields and their rows stay (nothing is deleted).
//   node scripts/s62-20261007-odoo.mjs --rollback --drop [--apply]   and delete what was created — by Baraa's decision only,
//                                                         AFTER the worker's code is rolled back (it filters on x_special).
// Rollback file: scripts/artifacts/s62-20261007-odoo-rollback.json. The tenant is production. No WhatsApp
// send. No price of the day, order, invoice, payment or journal entry is written here. The hook token is
// read from an existing server action at run time, used in the new actions' URLs, never printed.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the day's readers filter on x_price_offer.x_special.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu, ensureModel, ensureServerAction, ensureView, log,
  modelId, modelOrderAccess, one, rollbackFile, step,
} from "./lib/s40-kit.mjs";
import {
  ACTION_CONTEXT, ACTION_DOMAIN, ACTION_NAME, AUTOMATION_FIELDS, AUTOMATION_NAME, AUTOMATION_TRIGGER, CODE_ACTIONS, HOOKS, HOOK_PATH, LINE_COLUMNS, LINE_FIELDS,
  LINE_MODEL, LINE_MODEL_NAME, LINE_ORDER, LIST_ARCH, MENU_SEQUENCE, MENU_TITLE, OFFER_EXT_ARCH, OFFER_FIELDS, OFFER_MODEL, OFFER_PARENTS, PRICE_MODES, PRICING_MENU, PROD_HOST,
  QUOTE_FIELDS, QUOTE_MODEL, QUOTE_MODEL_NAME, QUOTE_O2M, QUOTE_ORDER, RECIPIENT_FIELDS, RECIPIENT_MODEL, RECIPIENT_MODEL_NAME, RECIPIENT_ORDER, SEARCH_ARCH,
  VIEW_FORM, VIEW_LIST, VIEW_SEARCH, formArch,
} from "./lib/s62-odoo.mjs";

const RB = new URL("./artifacts/s62-20261007-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s62-20261007-odoo.mjs");
const { rb, save } = ctx;
const c = rb.created;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const SOURCE_ACTION = "utak.prices.refresh_webhook";
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "type"], context: ALL }))[0] ?? null;
const menuRow = async () => (await call("ir.ui.menu", "search_read", { domain: [["name", "=", MENU_TITLE], ["parent_id", "=", PRICING_MENU]], fields: ["id", "sequence", "action", "active"], context: ALL }))[0] ?? null;
const automationRow = async () => (await call("base.automation", "search_read", { domain: [["name", "=", AUTOMATION_NAME]], fields: ["id", "name", "active", "trigger", "model_name", "trigger_field_ids", "action_server_ids"], context: ALL }))[0] ?? null;
const fieldIds = async (model, names) => {
  const rows = await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "in", names]], fields: ["id", "name"] });
  return names.map((n) => rows.find((r) => r.name === n)?.id).filter(Boolean);
};
/** The prod worker's origin and the hook token, from the action Odoo already calls it with. Never printed. */
async function hookBase() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", SOURCE_ACTION]], fields: ["webhook_url"], limit: 1 });
  const m = /^https:\/\/([^/]+)\/odoo\/hook\/[a-z-]+\?token=([A-Za-z0-9._~-]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error(`could not read the origin / token from ${SOURCE_ACTION}`);
  if (m[1] !== PROD_HOST) throw new Error(`${SOURCE_ACTION} does not call the prod worker: ${m[1]}`);
  return { url: (op) => `https://${m[1]}${HOOK_PATH}?token=${m[2]}&op=${op}`, shown: (op) => `https://${m[1]}${HOOK_PATH}?token=…&op=${op}` };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const off = async (label, model, id) => { if (!id) { log(`= ${label}: not there`); return; } log(`✎ ${label} #${id}: off`); if (APPLY) { await call(model, "write", { ids: [id], vals: { active: false } }); await pause(400); } };
  await off(`menu «${MENU_TITLE}»`, "ir.ui.menu", (await menuRow())?.id);
  await off(`automation «${AUTOMATION_NAME}»`, "base.automation", (await automationRow())?.id);
  for (const name of Object.keys(OFFER_PARENTS)) await off(`view ${name}`, "ir.ui.view", (await viewByName(name))?.id);
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", Object.values(c.menus ?? {})], ["base.automation", [c.automation]], ["ir.actions.act_window", Object.values(c.windows ?? {})],
      ["ir.ui.view", Object.values(c.views ?? {})], ["ir.actions.server", Object.values(c.actions ?? {})],
      ["ir.model.fields", [...(c.fields ?? [])].reverse()], ["ir.model", [c.recipientModel, c.lineModel, c.quoteModel]],
    ]);
  } else log("the three models, their fields, their rows, the views and the actions stay (nothing is deleted); the buttons call a hook the rolled-back code answers 404");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  for (const [model, name, order, defs] of [[QUOTE_MODEL, QUOTE_MODEL_NAME, QUOTE_ORDER, [...QUOTE_FIELDS, ...QUOTE_O2M]], [LINE_MODEL, LINE_MODEL_NAME, LINE_ORDER, LINE_FIELDS], [RECIPIENT_MODEL, RECIPIENT_MODEL_NAME, RECIPIENT_ORDER, RECIPIENT_FIELDS]]) {
    const mid = await modelId(model);
    const [m] = mid ? await call("ir.model", "read", { ids: [mid], fields: ["id", "model", "name", "order", "access_ids"] }) : [];
    check(`the model ${model} #${mid} «${name}», ordered «${order}», with an access rule`, m?.name === name && m.order === order && (m.access_ids ?? []).length > 0, JSON.stringify(m));
    await pause();
    const f = mid ? await call(model, "fields_get", { attributes: ["type", "string", "relation", "store", "selection", "required"] }) : {};
    const bad = defs.filter((d) => !(f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && (!d.relation || f[d.name].relation === d.relation) && (!d.required || f[d.name].required)));
    check(`${model}: its ${defs.length} fields, each of its kind, title and relation`, !bad.length, JSON.stringify(bad.map((d) => [d.name, f[d.name]])));
    await pause();
  }
  const sf = await call(QUOTE_MODEL, "fields_get", { allfields: ["x_state", "x_price_mode"], attributes: ["selection"] });
  check("the request's states: draft, sent, priced, quoted, closed", JSON.stringify((sf.x_state?.selection ?? []).map((s) => s[0])) === JSON.stringify(["draft", "sent", "priced", "quoted", "closed"]), JSON.stringify(sf.x_state));
  check("«الأسعار في العرض»: قبل الضريبة (net) / شاملة الضريبة (gross)", JSON.stringify(sf.x_price_mode?.selection ?? []) === JSON.stringify(PRICE_MODES), JSON.stringify(sf.x_price_mode));
  const of = await call(OFFER_MODEL, "fields_get", { attributes: ["type", "string", "relation"] });
  check(`${OFFER_MODEL}: «خاص» (boolean), the request (many2one → ${QUOTE_MODEL}), the unit (char)`, OFFER_FIELDS.every((d) => of[d.name]?.type === d.ttype && of[d.name].string === d.field_description && (!d.relation || of[d.name].relation === d.relation)), JSON.stringify(OFFER_FIELDS.map((d) => of[d.name])));
  await pause();
  // the actions: the five webhooks call the PROD worker's hook with their op (the token is compared, never shown)
  const base = await hookBase();
  const names = [...Object.values(HOOKS).map((h) => h.name), ...Object.values(CODE_ACTIONS).map((a) => a.name)];
  const acts = await call("ir.actions.server", "search_read", { domain: [["name", "in", names]], fields: ["id", "name", "state", "model_name", "webhook_url", "code"] });
  const by = Object.fromEntries(acts.map((a) => [a.name, a]));
  for (const h of Object.values(HOOKS)) check(`action ${h.name} #${by[h.name]?.id}: a webhook of ${QUOTE_MODEL} → ${base.shown(h.op)}`, by[h.name]?.state === "webhook" && by[h.name].model_name === QUOTE_MODEL && by[h.name].webhook_url === base.url(h.op));
  for (const a of Object.values(CODE_ACTIONS)) check(`action ${a.name} #${by[a.name]?.id}: code, as written`, by[a.name]?.state === "code" && by[a.name].model_name === QUOTE_MODEL && by[a.name].code === a.code, JSON.stringify(by[a.name]?.code));
  await pause();
  const ids = Object.fromEntries([...Object.entries(HOOKS), ...Object.entries(CODE_ACTIONS)].map(([k, v]) => [k, by[v.name]?.id]));
  const form = await viewByName(VIEW_FORM), list = await viewByName(VIEW_LIST), search = await viewByName(VIEW_SEARCH);
  check(`the form ${VIEW_FORM} #${form?.id}: as written, its seven buttons on the seven actions`, form?.active && form.model === QUOTE_MODEL && form.arch_db === formArch(ids), "the stored arch differs");
  check(`the form's lines: their columns in order (${LINE_COLUMNS.join(", ")})`, (() => {
    const shown = [...String(form?.arch_db ?? "").split('<page string="الأصناف"')[1]?.split("</page>")[0].matchAll(/<field name="(x_[a-z_]+)"([^>]*)\/>/g) ?? []].filter((m) => !/optional="hide"|widget="handle"/.test(m[2])).map((m) => m[1]);
    return JSON.stringify(shown) === JSON.stringify(LINE_COLUMNS);
  })());
  check(`the list ${VIEW_LIST} #${list?.id} and the search ${VIEW_SEARCH} #${search?.id}: as written`, list?.active && list.arch_db === LIST_ARCH && search?.active && search.arch_db === SEARCH_ARCH);
  await pause();
  const [action] = await call("ir.actions.act_window", "search_read", { domain: [["name", "=", ACTION_NAME]], fields: ["id", "res_model", "view_mode", "domain", "context", "search_view_id"] });
  check(`the action «${ACTION_NAME}» #${action?.id}: the real requests, list then form`, action?.res_model === QUOTE_MODEL && action.view_mode === "list,form" && action.domain === ACTION_DOMAIN && action.context === ACTION_CONTEXT && action.search_view_id?.[0] === search?.id, JSON.stringify(action));
  const menu = await menuRow();
  check(`the menu «${MENU_TITLE}» #${menu?.id} under «💲 التسعير» (#${PRICING_MENU}) opens it`, !!menu?.active && menu.sequence === MENU_SEQUENCE && menu.action === `ir.actions.act_window,${action?.id}`, JSON.stringify(menu));
  await pause();
  const auto = await automationRow();
  const trig = await fieldIds(QUOTE_MODEL, AUTOMATION_FIELDS);
  check(`the automation «${AUTOMATION_NAME}» #${auto?.id}: ${AUTOMATION_TRIGGER} of ${QUOTE_MODEL} on ${AUTOMATION_FIELDS.join(", ")} → the recalc webhook alone`,
    !!auto?.active && auto.trigger === AUTOMATION_TRIGGER && auto.model_name === QUOTE_MODEL && JSON.stringify([...auto.trigger_field_ids].sort()) === JSON.stringify([...trig].sort()) && JSON.stringify(auto.action_server_ids) === JSON.stringify([ids.recalc]), JSON.stringify(auto));
  await pause();
  for (const [name, parent] of Object.entries(OFFER_PARENTS)) {
    const v = await viewByName(name), p = await viewByName(parent);
    check(`the extension ${name} #${v?.id} on ${parent} #${p?.id}: active, as written`, !!v?.active && v.inherit_id?.[0] === p?.id && v.arch_db === OFFER_EXT_ARCH[name], JSON.stringify(v?.arch_db));
    await pause(500);
  }
  // the worker's reads answer, and the day's readers' filter is a field of the model
  let how = "";
  const rows = await call(OFFER_MODEL, "search_read", { domain: [["x_special", "!=", true]], fields: ["id", "x_special", "x_special_quote_id"], limit: 3 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
  check(`the day's readers' filter [x_special != true] answers on ${OFFER_MODEL} (${rows?.length ?? "-"} rows read)`, Array.isArray(rows), how);
  const reqs = await call(QUOTE_MODEL, "search_read", { domain: ACTION_DOMAIN === "[('x_utak_simulation', '=', False)]" ? [["x_utak_simulation", "=", false]] : [], fields: [...QUOTE_FIELDS.map((d) => d.name), "x_line_ids", "x_recipient_ids"], limit: 3 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
  check(`the worker's read of a request answers (${reqs?.length ?? "-"} read)`, Array.isArray(reqs), how);
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write
const base = await hookBase();
log(`hook: ${base.shown("<op>")} (the token is read from «${SOURCE_ACTION}», not printed)`);

log(`— 1: the three models`);
const quoteMid = await ensureModel(ctx, "quoteModel", QUOTE_MODEL, QUOTE_MODEL_NAME);
await pause();
await ensureFields(ctx, QUOTE_MODEL, quoteMid, QUOTE_FIELDS);
await pause();
const lineMid = quoteMid || APPLY ? await ensureModel(ctx, "lineModel", LINE_MODEL, LINE_MODEL_NAME) : (log(`+ model ${LINE_MODEL}`), null);
await pause();
await ensureFields(ctx, LINE_MODEL, lineMid, LINE_FIELDS);
await pause();
const recMid = quoteMid || APPLY ? await ensureModel(ctx, "recipientModel", RECIPIENT_MODEL, RECIPIENT_MODEL_NAME) : (log(`+ model ${RECIPIENT_MODEL}`), null);
await pause();
await ensureFields(ctx, RECIPIENT_MODEL, recMid, RECIPIENT_FIELDS);
await pause();
await ensureFields(ctx, QUOTE_MODEL, quoteMid, QUOTE_O2M);
await pause();
await modelOrderAccess(quoteMid, QUOTE_MODEL, QUOTE_ORDER);
await modelOrderAccess(lineMid, LINE_MODEL, LINE_ORDER);
await modelOrderAccess(recMid, RECIPIENT_MODEL, RECIPIENT_ORDER);
await pause();

log(`— 2: «خاص» on ${OFFER_MODEL}`);
await ensureFields(ctx, OFFER_MODEL, await modelId(OFFER_MODEL), OFFER_FIELDS);
await pause();

log(`— 3: the seven server actions`);
const ids = {};
for (const [key, h] of Object.entries(HOOKS)) {
  ids[key] = await ensureServerAction(ctx, key, h.name, { model_id: quoteMid, state: "webhook", webhook_url: base.url(h.op), webhook_field_ids: [[6, 0, []]] });
  await pause(500);
}
for (const [key, a] of Object.entries(CODE_ACTIONS)) {
  ids[key] = await ensureServerAction(ctx, key, a.name, { model_id: quoteMid, state: "code", code: a.code });
  await pause(500);
}

log(`— 4: the list, the search, the form, the action and the menu`);
const haveModel = !!quoteMid;
const view = async (key, name, type, arch) => (haveModel || APPLY ? ensureView(ctx, key, name, { model: QUOTE_MODEL, type, priority: 16, arch_base: arch }) : (log(`+ view ${name}`), null));
await view("list", VIEW_LIST, "list", LIST_ARCH);
await pause();
const searchId = await view("search", VIEW_SEARCH, "search", SEARCH_ARCH);
await pause();
for (const l of formArch(Object.fromEntries(Object.keys({ ...HOOKS, ...CODE_ACTIONS }).map((k) => [k, ids[k] ?? `<${k}>`]))).split("\n")) log(`    ${l}`);
await view("form", VIEW_FORM, "form", formArch(ids));
await pause();
// the form as this file writes it now: a view made by an earlier run is brought up to date (its arch of before is kept in the rollback file)
{
  const have = await viewByName(VIEW_FORM), want = formArch(ids);
  if (have && Object.values(ids).every(Boolean) && have.arch_db !== want) {
    log(`✎ view ${VIEW_FORM} #${have.id}: its arch, as written here`);
    rb.before.formArch ??= have.arch_db; save();
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: want } });
    await pause();
  }
}
const actionId = await ensureActWindow(ctx, "requests", ACTION_NAME, {
  res_model: QUOTE_MODEL, view_mode: "list,form", domain: ACTION_DOMAIN, context: ACTION_CONTEXT, ...(searchId ? { search_view_id: searchId } : {}),
  help: "<p>طلب عميل بأصناف خارج قائمة اليوم: أنشئه، واضغط «📨 أرسل طلب الأسعار»، وانتظر أسعار المصادر، واعتمد السعر النهائي لكل سطر، ثم «📄 أصدر عرض السعر».</p>",
});
await pause();
{
  const [act] = actionId ? await call("ir.actions.act_window", "read", { ids: [actionId], fields: ["id", "context"] }) : [];
  if (act && act.context !== ACTION_CONTEXT) {
    log(`✎ act_window #${act.id}: context ← ${ACTION_CONTEXT}`);
    rb.before.actionContext ??= act.context; save();
    if (APPLY) await call("ir.actions.act_window", "write", { ids: [act.id], vals: { context: ACTION_CONTEXT } });
    await pause();
  }
}
const menu = await menuRow();
if (menu && !menu.active) {
  log(`✎ menu «${MENU_TITLE}» #${menu.id}: on again`);
  if (APPLY) await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: true } });
} else await ensureMenu(ctx, "requests", MENU_TITLE, PRICING_MENU, actionId ? `ir.actions.act_window,${actionId}` : false, MENU_SEQUENCE);
await pause();

log(`— 5: the automation (${AUTOMATION_TRIGGER} on ${AUTOMATION_FIELDS.join(", ")})`);
const auto = await automationRow();
if (auto && !auto.active) {
  log(`✎ automation «${AUTOMATION_NAME}» #${auto.id}: on again`);
  if (APPLY) await call("base.automation", "write", { ids: [auto.id], vals: { active: true } });
} else {
  c.automation = await step(`automation ${AUTOMATION_NAME}`, auto?.id ?? c.automation, async () => (await call("base.automation", "create", { vals_list: [{
    name: AUTOMATION_NAME, model_id: quoteMid, trigger: AUTOMATION_TRIGGER, active: true,
    trigger_field_ids: [[6, 0, await fieldIds(QUOTE_MODEL, AUTOMATION_FIELDS)]], action_server_ids: [[6, 0, [ids.recalc]]],
  }] }))[0]);
  save();
}
await pause();

log(`— 6: «خاص» on the lists and the search of «عروض المصادر»`);
for (const [name, parent] of Object.entries(OFFER_PARENTS)) {
  const p = await viewByName(parent);
  if (!p) { log(`✗ the view ${parent} is not there — ${name} not made`); continue; }
  const have = await viewByName(name);
  if (have && !have.active) {
    log(`✎ view ${name} #${have.id}: on again`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true } });
  } else await ensureView(ctx, name, name, { model: OFFER_MODEL, inherit_id: p.id, mode: "extension", priority: 99, arch_base: OFFER_EXT_ARCH[name] });
  await pause(600);
}
save();
void one;
log(APPLY ? "done — verify: node scripts/s62-20261007-odoo.mjs --verify" : "dry-run: nothing written");
