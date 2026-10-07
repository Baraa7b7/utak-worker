// § 62 د (2026-10-07) — the quotation's tidy-up on the tenant (scripts/lib/s62d-odoo.mjs is the data), in TWO parts:
//
//   schema (--only=schema, BEFORE the worker's code: it reads these fields)
//     1  x_special_quote.x_layout «شكل العرض»; x_special_quote_line.x_item_origin «المنشأ», x_item_size «المقاس»,
//        x_suggested_net «المقترح قبل الضريبة»; sale.order.line.x_item_origin, x_item_size
//     2  the model x_preview_ticket (a one-use ticket of «👁️ معاينة PDF») with its fields, order and access
//     3  two code actions «👁️ معاينة PDF» (the special request's, the sale order's) — on no screen yet
//   ui (--only=ui, AFTER the worker's code is deployed: the button opens a route of the new code)
//     4  the special request's form: «👁️ معاينة PDF» in place of «⬇️ PDF لي فقط», «شكل العرض», the three columns;
//        the action's context (a new request is «تلقائي»)
//     5  an extension view on the sale order's form: «👁️ معاينة PDF» and the two columns «المنشأ» / «المقاس»
//
//   node scripts/s62d-20261007-odoo.mjs --only=schema|ui             dry-run: the plan, nothing written
//   node scripts/s62d-20261007-odoo.mjs --only=schema|ui --apply     (the rollback file first)
//   node scripts/s62d-20261007-odoo.mjs --only=schema|ui --verify    read-only checks
//   node scripts/s62d-20261007-odoo.mjs --probe --apply              presses each preview action once through the API on a record
//                                                                    that is NOT SQ-0002 / S00015 / S00016: the ticket row it makes is
//                                                                    checked and burnt (x_used). Two rows are written, nothing else.
//   node scripts/s62d-20261007-odoo.mjs --rollback [--apply]         the ui back: the form's arch and the action's context of before,
//                                                                    the sale order's extension off. Fields, model and actions stay.
// Rollback file: scripts/artifacts/s62d-20261007-odoo-rollback.json. The tenant is production. No WhatsApp send. No
// record of a request, a sale order, a price or an entry is written here (the probe's two ticket rows aside).
// ROLLBACK ORDER: (1) --rollback (the screens of before), (2) THE CODE, and the fields stay (nothing is deleted).
import {
  APPLY, ROLLBACK, VERIFY, call, checker, ensureFields, ensureModel, ensureServerAction, ensureView, log, modelId, modelOrderAccess, one, rollbackFile,
} from "./lib/s40-kit.mjs";
import * as S62 from "./lib/s62-odoo.mjs";
import {
  ACTION_CONTEXT, ACTION_NAME, LAYOUTS, LINE_COLUMNS, LINE_FIELDS, LINE_MODEL, PREVIEW_ACTIONS, PREVIEW_PATH, PROD_HOST, QUOTE_FIELDS, QUOTE_MODEL, SALE_EXT_PRIORITY,
  SALE_FORM_PARENT, SALE_LINE_FIELDS, SALE_LINE_MODEL, SALE_MODEL, TICKET_FIELDS, TICKET_MODEL, TICKET_MODEL_NAME, TICKET_ORDER, VIEW_FORM, VIEW_SALE_EXT, formArch, saleExtArch,
} from "./lib/s62d-odoo.mjs";

const RB = new URL("./artifacts/s62d-20261007-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s62d-20261007-odoo.mjs");
const { rb, save } = ctx;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const PROBE = process.argv.includes("--probe");
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const PROTECTED_SALE = ["S00015", "S00016"], PROTECTED_QUOTE = 2;
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "priority"], context: ALL }))[0] ?? null;
const actionByName = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "state", "model_name", "code"], context: ALL }))[0] ?? null;
/** § 62's seven actions by their names, and § 62 د's preview: the ids the form's buttons call. */
async function formIds() {
  const names = [...Object.entries(S62.HOOKS), ...Object.entries(S62.CODE_ACTIONS)];
  const rows = await call("ir.actions.server", "search_read", { domain: [["name", "in", names.map(([, v]) => v.name)]], fields: ["id", "name"] });
  const ids = Object.fromEntries(names.map(([k, v]) => [k, rows.find((r) => r.name === v.name)?.id]));
  ids.preview = (await actionByName(PREVIEW_ACTIONS.quote.name))?.id;
  return ids;
}
const windowRow = async () => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", ACTION_NAME]], fields: ["id", "context"] }))[0] ?? null;
if (!ROLLBACK && !PROBE && ONLY !== "schema" && ONLY !== "ui") { console.log("say which part: --only=schema (before the code) or --only=ui (after the deploy)"); process.exit(2); }

// ---------------------------------------------------------------- rollback (the ui alone)
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const form = await viewByName(VIEW_FORM);
  if (form && rb.before.formArch && form.arch_db !== rb.before.formArch) {
    log(`✎ view ${VIEW_FORM} #${form.id}: its arch of before § 62 د («⬇️ PDF لي فقط» again)`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [form.id], vals: { arch_base: rb.before.formArch } });
  } else log(`= view ${VIEW_FORM}: as before (or never changed)`);
  await pause();
  const win = await windowRow();
  if (win && rb.before.actionContext && win.context !== rb.before.actionContext) {
    log(`✎ act_window #${win.id}: context ← ${rb.before.actionContext}`);
    if (APPLY) await call("ir.actions.act_window", "write", { ids: [win.id], vals: { context: rb.before.actionContext } });
  } else log(`= act_window «${ACTION_NAME}»: context as before`);
  await pause();
  const ext = await viewByName(VIEW_SALE_EXT);
  if (ext?.active) { log(`✎ view ${VIEW_SALE_EXT} #${ext.id}: off`); if (APPLY) await call("ir.ui.view", "write", { ids: [ext.id], vals: { active: false } }); }
  else log(`= view ${VIEW_SALE_EXT}: ${ext ? "already off" : "not there"}`);
  log("the fields, the model x_preview_ticket and the two actions stay (nothing is deleted)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- probe: one press of each action, through the API
if (PROBE) {
  const { check, done } = checker();
  log(APPLY ? "PROBE — apply (two ticket rows are written, then burnt)" : "probe dry-run (nothing is pressed; add --apply)");
  const [quote] = await call(QUOTE_MODEL, "search_read", { domain: [["id", "!=", PROTECTED_QUOTE]], fields: ["id", "x_name"], order: "id asc", limit: 1, context: ALL });
  const [sale] = await call(SALE_MODEL, "search_read", { domain: [["name", "not in", PROTECTED_SALE]], fields: ["id", "name"], order: "id asc", limit: 1, context: ALL });
  for (const [key, rec] of [["quote", quote], ["sale", sale]]) {
    const def = PREVIEW_ACTIONS[key], act = await actionByName(def.name);
    log(`${def.name} #${act?.id} on ${def.model} #${rec?.id} (${rec?.x_name || rec?.name || "—"})`);
    if (!APPLY || !act || !rec) { if (APPLY) check(`${def.name}: an action and a record to press it on`, false); continue; }
    const before = Date.now();
    const out = await call("ir.actions.server", "run", { ids: [act.id], context: { active_model: def.model, active_id: rec.id, active_ids: [rec.id] } });
    const m = new RegExp(`^https://${PROD_HOST.replace(/\./g, "\\.")}${PREVIEW_PATH}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`).exec(String(out?.url ?? ""));
    check(`${def.name}: answers a url action to the worker's ${PREVIEW_PATH}<uuid>, in a new tab`, out?.type === "ir.actions.act_url" && !!m && out.target === "new", JSON.stringify({ type: out?.type, target: out?.target, url: String(out?.url ?? "").replace(/[0-9a-f-]{36}$/, "<ticket>") }));
    await pause();
    const [row] = m ? await call(TICKET_MODEL, "search_read", { domain: [["x_name", "=", m[1]]], fields: ["id", "x_model", "x_res_id", "x_used", "create_date"] }) : [];
    const age = row ? before - Date.parse(String(row.create_date).replace(" ", "T") + "Z") : NaN;
    check(`${def.name}: its ticket is a row of ${TICKET_MODEL} for ${def.model} #${rec.id}, unused, made now`, row?.x_model === def.model && row.x_res_id === rec.id && row.x_used === false && Math.abs(age) < 120000, JSON.stringify(row ? { ...row, age } : null));
    if (row) { await call(TICKET_MODEL, "write", { ids: [row.id], vals: { x_used: true } }); log(`  the probe's ticket #${row.id} is burnt (x_used)`); }
    await pause();
  }
  if (!APPLY) { log("dry-run: nothing pressed"); process.exit(0); }
  done();
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  if (ONLY === "schema") {
    for (const [model, defs] of [[QUOTE_MODEL, QUOTE_FIELDS], [LINE_MODEL, LINE_FIELDS], [SALE_LINE_MODEL, SALE_LINE_FIELDS], [TICKET_MODEL, TICKET_FIELDS]]) {
      const f = await call(model, "fields_get", { attributes: ["type", "string", "selection", "store"] }).catch(() => ({}));
      const bad = defs.filter((d) => !(f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && f[d.name].store !== false));
      check(`${model}: ${defs.map((d) => `${d.name} «${d.field_description}»`).join(", ")}`, !bad.length, JSON.stringify(bad.map((d) => [d.name, f[d.name]])));
      if (model === QUOTE_MODEL) check("«شكل العرض»: تلقائي (auto) / أسعار الوحدة (unit) / بالكميات (qty)", JSON.stringify(f.x_layout?.selection ?? []) === JSON.stringify(LAYOUTS), JSON.stringify(f.x_layout?.selection));
      await pause();
    }
    const mid = await modelId(TICKET_MODEL);
    const [m] = mid ? await call("ir.model", "read", { ids: [mid], fields: ["id", "model", "name", "order", "access_ids"] }) : [];
    check(`the model ${TICKET_MODEL} #${mid} «${TICKET_MODEL_NAME}», ordered «${TICKET_ORDER}», with an access rule`, m?.name === TICKET_MODEL_NAME && m.order === TICKET_ORDER && (m.access_ids ?? []).length > 0, JSON.stringify(m));
    for (const def of Object.values(PREVIEW_ACTIONS)) {
      const a = await actionByName(def.name);
      check(`action ${def.name} #${a?.id}: code of ${def.model}, as written (a ticket, then ${PREVIEW_PATH}<ticket> — no token in it)`, a?.state === "code" && a.model_name === def.model && a.code === def.code && !/token=/.test(a.code ?? ""), JSON.stringify(a?.code));
      await pause(500);
    }
    // the worker's reads answer
    let how = "";
    const q = await call(QUOTE_MODEL, "search_read", { domain: [], fields: ["id", "x_layout"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const l = await call(LINE_MODEL, "search_read", { domain: [], fields: ["id", "x_item_origin", "x_item_size", "x_suggested_net"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const s = await call(SALE_LINE_MODEL, "search_read", { domain: [], fields: ["id", "display_type", "name", "product_uom_qty", "price_unit", "price_subtotal", "price_tax", "price_total", "discount", "product_uom_id", "x_item_origin", "x_item_size"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    check(`the worker's reads of the new fields answer (requests ${q?.length ?? "-"}, lines ${l?.length ?? "-"}, sale lines ${s?.length ?? "-"})`, Array.isArray(q) && Array.isArray(l) && Array.isArray(s), how);
  } else {
    const ids = await formIds();
    const form = await viewByName(VIEW_FORM);
    check(`the form ${VIEW_FORM} #${form?.id}: § 62's with § 62 د's four changes («${"👁️ معاينة PDF"}» on the code action #${ids.preview})`, !!form?.active && Object.values(ids).every(Boolean) && form.arch_db === formArch(ids), "the stored arch differs");
    check("the form: no «⬇️ PDF لي فقط», and no button on the old pdf webhook", !!form && !form.arch_db.includes("PDF لي فقط") && !form.arch_db.includes(`name="${ids.pdf}"`));
    check(`the form's lines: their columns in order (${LINE_COLUMNS.join(", ")})`, (() => {
      const shown = [...String(form?.arch_db ?? "").split('<page string="الأصناف"')[1]?.split("</page>")[0].matchAll(/<field name="(x_[a-z_]+)"([^>]*)\/>/g) ?? []].filter((m) => !/optional="hide"|widget="handle"/.test(m[2])).map((m) => m[1]);
      return JSON.stringify(shown) === JSON.stringify(LINE_COLUMNS);
    })());
    const win = await windowRow();
    check(`the action «${ACTION_NAME}» #${win?.id}: a new request is «تلقائي»`, win?.context === ACTION_CONTEXT, win?.context);
    await pause();
    const ext = await viewByName(VIEW_SALE_EXT), parent = await viewByName(SALE_FORM_PARENT);
    const sale = await actionByName(PREVIEW_ACTIONS.sale.name);
    check(`the extension ${VIEW_SALE_EXT} #${ext?.id} on ${SALE_FORM_PARENT} #${parent?.id}: active, priority ${SALE_EXT_PRIORITY}, as written (the button on #${sale?.id})`, !!ext?.active && ext.inherit_id?.[0] === parent?.id && ext.priority === SALE_EXT_PRIORITY && ext.arch_db === saleExtArch(sale?.id), JSON.stringify(ext?.arch_db));
    // the screens load with it: Odoo combines the form and its extensions (a broken xpath answers an error here)
    let how = "";
    const combined = await call(SALE_MODEL, "get_views", { views: [[parent?.id ?? false, "form"]] }).catch((e) => { how = String(e?.message ?? e).slice(0, 200); return null; });
    const arch = String(combined?.views?.form?.arch ?? "");
    check("the sale order's form, as Odoo serves it: «👁️ معاينة PDF», «المنشأ» and «المقاس» in the lines, and the two older UTAK buttons", arch.includes("معاينة PDF") && arch.includes('name="x_item_origin"') && arch.includes('name="x_item_size"') && arch.includes("إرسال واتساب (UTAK)") && arch.includes("تنزيل PDF (UTAK)"), how || `${arch.length} chars`);
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? `APPLY — ${ONLY}` : `dry-run — ${ONLY} (nothing is written; add --apply)`);
save(); // the rollback file before the first write

if (ONLY === "schema") {
  log("— 1: the fields");
  await ensureFields(ctx, QUOTE_MODEL, await modelId(QUOTE_MODEL), QUOTE_FIELDS);
  await pause();
  await ensureFields(ctx, LINE_MODEL, await modelId(LINE_MODEL), LINE_FIELDS);
  await pause();
  await ensureFields(ctx, SALE_LINE_MODEL, await modelId(SALE_LINE_MODEL), SALE_LINE_FIELDS);
  await pause();
  log(`— 2: the model ${TICKET_MODEL}`);
  const ticketMid = await ensureModel(ctx, "ticketModel", TICKET_MODEL, TICKET_MODEL_NAME);
  await pause();
  await ensureFields(ctx, TICKET_MODEL, ticketMid, TICKET_FIELDS);
  await pause();
  await modelOrderAccess(ticketMid, TICKET_MODEL, TICKET_ORDER);
  await pause();
  log("— 3: the two code actions «👁️ معاينة PDF» (on no screen yet)");
  for (const [key, def] of Object.entries(PREVIEW_ACTIONS)) {
    for (const l of def.code.split("\n")) log(`    ${l}`);
    const id = await ensureServerAction(ctx, `preview_${key}`, def.name, { model_id: await modelId(def.model), state: "code", code: def.code });
    const have = id ? await actionByName(def.name) : null;
    if (have && have.code !== def.code) {
      log(`✎ server action ${def.name} #${have.id}: its code, as written here`);
      rb.before[`code_${key}`] ??= have.code; save();
      if (APPLY) await call("ir.actions.server", "write", { ids: [have.id], vals: { code: def.code } });
    }
    await pause(500);
  }
  save();
  log(APPLY ? "done — verify: node scripts/s62d-20261007-odoo.mjs --only=schema --verify" : "dry-run: nothing written");
  process.exit(0);
}

// ui
log("— 4: the special request's form and its action's context");
const ids = await formIds();
const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { log(`✗ actions not found: ${missing.join(", ")} — run --only=schema first`); process.exit(1); }
{
  const have = await viewByName(VIEW_FORM), want = formArch(ids);
  if (!have) { log(`✗ the view ${VIEW_FORM} is not there`); process.exit(1); }
  if (have.arch_db === want) log(`= view ${VIEW_FORM} #${have.id}: as written here`);
  else {
    if (have.arch_db !== S62.formArch(ids) && !rb.before.formArch) log(`  note: the stored arch is not § 62's as written (it is kept whole in the rollback file)`);
    log(`✎ view ${VIEW_FORM} #${have.id}: «👁️ معاينة PDF» for «⬇️ PDF لي فقط», «شكل العرض», «المنشأ» / «المقاس» / «المقترح قبل الضريبة»`);
    rb.before.formArch ??= have.arch_db; save();
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: want } });
  }
  await pause();
  const win = await windowRow();
  if (win && win.context !== ACTION_CONTEXT) {
    log(`✎ act_window #${win.id}: context ← ${ACTION_CONTEXT}`);
    rb.before.actionContext ??= win.context; save();
    if (APPLY) await call("ir.actions.act_window", "write", { ids: [win.id], vals: { context: ACTION_CONTEXT } });
  } else log(`= act_window «${ACTION_NAME}»: context as written here`);
  await pause();
}
log("— 5: the sale order's form: «👁️ معاينة PDF», «المنشأ» and «المقاس»");
{
  const parent = await viewByName(SALE_FORM_PARENT);
  const sale = await actionByName(PREVIEW_ACTIONS.sale.name);
  if (!parent || !sale) { log(`✗ ${!parent ? `the view ${SALE_FORM_PARENT}` : `the action ${PREVIEW_ACTIONS.sale.name}`} is not there`); process.exit(1); }
  const want = saleExtArch(sale.id);
  for (const l of want.split("\n")) log(`    ${l}`);
  const have = await viewByName(VIEW_SALE_EXT);
  if (have && !have.active) {
    log(`✎ view ${VIEW_SALE_EXT} #${have.id}: on again`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true, arch_base: want } });
  } else if (have && have.arch_db !== want) {
    log(`✎ view ${VIEW_SALE_EXT} #${have.id}: its arch, as written here`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: want } });
  } else await ensureView(ctx, "saleExt", VIEW_SALE_EXT, { model: SALE_MODEL, inherit_id: parent.id, mode: "extension", priority: SALE_EXT_PRIORITY, arch_base: want });
}
save();
void one;
log(APPLY ? "done — verify: node scripts/s62d-20261007-odoo.mjs --only=ui --verify" : "dry-run: nothing written");
