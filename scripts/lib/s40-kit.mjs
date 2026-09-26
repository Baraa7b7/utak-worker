// § 40 (2026-09-26) — shared steps of the pricing-engine v1 Odoo scripts
// (scripts/s40-20260926-*.mjs). JSON-2 only, through scripts/lib/odoo-cli.mjs;
// every request other than utakfresh.odoo.com is blocked. Each script: dry-run
// by default, --apply writes the rollback file BEFORE the first write and adds
// every id the moment it is created, --verify is read-only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

export { call };
export const APPLY = process.argv.includes("--apply");
export const VERIFY = process.argv.includes("--verify");
export const ROLLBACK = process.argv.includes("--rollback");
export const DROP = process.argv.includes("--drop");
export const UTAK_MENU = 529;          // UTAK
export const PURCHASE_MENU = 547;      // UTAK ← 🛒 المشتريات
export const USER_GROUP_ID = 1;        // «Role / User», as on the other UTAK models
export const log = (...a) => console.log(...a);

export const find = async (model, domain) => (await call(model, "search_read", { domain, fields: ["id"], limit: 50, context: { active_test: false } })).map((r) => r.id);
export const one = async (model, domain) => (await find(model, domain))[0];
export const modelId = async (m) => one("ir.model", [["model", "=", m]]);
export const fieldRow = async (m, f) => (await call("ir.model.fields", "search_read", {
  domain: [["model", "=", m], ["name", "=", f]], fields: ["id", "ttype", "field_description", "store", "compute", "depends", "readonly", "relation", "selection", "help"], limit: 1,
}))[0] ?? null;

/** The rollback file: read (or start) it; `save()` writes it only under --apply. */
export function rollbackFile(url, script) {
  const path = url.pathname;
  const rb = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { script, createdAt: new Date().toISOString(), created: {}, before: {} };
  rb.created ??= {}; rb.before ??= {};
  return { rb, save: () => { if (APPLY) writeFileSync(path, JSON.stringify(rb, null, 2) + "\n"); } };
}

/** «= label #id» when it exists, else «+ label» and — under --apply — create it. */
export async function step(label, have, fn) {
  if (have) { log(`= ${label} #${have}`); return have; }
  log(`+ ${label}`);
  if (!APPLY) return null;
  const id = await fn();
  log(`  → #${id}`);
  return id;
}

/** A custom model (Odoo adds x_name). Its order and access come after its fields (modelOrderAccess). */
export async function ensureModel(ctx, key, model, name) {
  const { rb, save } = ctx;
  const have = await modelId(model);
  rb.created[key] = await step(`model ${model}`, have ?? rb.created[key], async () =>
    (await call("ir.model", "create", { vals_list: [{ name, model }] }))[0]);
  save();
  return rb.created[key];
}

/** The model's order (its fields must exist and be stored) and «Role / User» crud. */
export async function modelOrderAccess(mid, model, order) {
  if (!APPLY || !mid) { log(`+ order «${order}» / access on ${model}`); return; }
  await call("ir.model", "write", { ids: [mid], vals: { order } });
  const [acc] = await call("ir.model", "read", { ids: [mid], fields: ["access_ids"] });
  if (!(acc?.access_ids ?? []).length) {
    await call("ir.model", "write", { ids: [mid], vals: { access_ids: [[0, 0, { name: `${model} user`, group_id: USER_GROUP_ID, operation: "crud", kind: "permission", active: true }]] } });
  }
  log(`= order «${order}» / access on ${model}`);
}

/** Fields on a model (by ir.model id): the missing ones are created; the created ids go to rb.created.fields. */
export async function ensureFields(ctx, model, mid, defs) {
  const { rb, save } = ctx;
  rb.created.fields ??= [];
  const have = mid ? new Set((await call("ir.model.fields", "search_read", { domain: [["model_id", "=", mid]], fields: ["name"] })).map((r) => r.name)) : new Set();
  for (const d of defs) {
    if (have.has(d.name)) { log(`= ${model}.${d.name}`); continue; }
    log(`+ ${model}.${d.name} (${d.ttype}${d.compute ? ", compute" : ""})`);
    if (!APPLY) continue;
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...d }] });
    rb.created.fields.push(id); save();
    log(`  → #${id}`);
  }
}

export async function ensureView(ctx, key, name, vals) {
  const { rb, save } = ctx;
  rb.created.views ??= {};
  rb.created.views[key] = await step(`view ${name}`, (await one("ir.ui.view", [["name", "=", name]])) ?? rb.created.views[key], async () =>
    (await call("ir.ui.view", "create", { vals_list: [{ name, ...vals }] }))[0]);
  save();
  return rb.created.views[key];
}

export async function ensureServerAction(ctx, key, name, vals) {
  const { rb, save } = ctx;
  rb.created.actions ??= {};
  rb.created.actions[key] = await step(`server action ${name}`, (await one("ir.actions.server", [["name", "=", name]])) ?? rb.created.actions[key], async () =>
    (await call("ir.actions.server", "create", { vals_list: [{ name, ...vals }] }))[0]);
  save();
  return rb.created.actions[key];
}

export async function ensureActWindow(ctx, key, name, vals) {
  const { rb, save } = ctx;
  rb.created.windows ??= {};
  rb.created.windows[key] = await step(`act_window ${name}`, (await one("ir.actions.act_window", [["name", "=", name]])) ?? rb.created.windows[key], async () =>
    (await call("ir.actions.act_window", "create", { vals_list: [{ name, ...vals }] }))[0]);
  save();
  return rb.created.windows[key];
}

export async function ensureMenu(ctx, key, name, parent, action, sequence) {
  const { rb, save } = ctx;
  rb.created.menus ??= {};
  rb.created.menus[key] = await step(`menu ${name}`, (await one("ir.ui.menu", [["name", "=", name], ["parent_id", "=", parent]])) ?? rb.created.menus[key], async () =>
    (await call("ir.ui.menu", "create", { vals_list: [{ name, parent_id: parent, action, sequence }] }))[0]);
  save();
  return rb.created.menus[key];
}

/** A read-only verify runner: check(name, cond, detail); done() prints «verify: ok/total» and exits. */
export function checker() {
  let ok = 0, bad = 0;
  return {
    check(name, cond, detail = "") { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } },
    done() { log(`verify: ${ok}/${ok + bad}`); process.exit(bad ? 1 : 0); },
  };
}

/** The ids created by a rollback file, per kind, for --rollback --drop (reverse order). */
export async function dropCreated(rb, order) {
  for (const [model, ids] of order) {
    const list = ids.filter(Boolean);
    log(`drop ${model} ${list.join(",") || "-"}`);
    if (APPLY && list.length) await call(model, "unlink", { ids: list });
  }
}
