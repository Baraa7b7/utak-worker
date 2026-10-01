// § 46 د (2026-10-01) — the Odoo «WhatsApp» app's icon.
//
// First, read-only: does UTAK (the worker's code, its Odoo automations, server actions, custom
// fields and views, the UTAK menu) use ANY model of Odoo's WhatsApp module (whatsapp.message,
// whatsapp.template, whatsapp.account, …)? UTAK's own models are x_wa_message / x_wa_control /
// x_whatsapp_template and its channel is the Cloudflare worker.
//   • not used → the root menu «WhatsApp» is switched off (ir.ui.menu.active = false; a module
//     update does not write `active`, while it can rewrite a menu's groups). The module stays
//     installed: nothing is uninstalled, no setting is touched;
//   • used → nothing is hidden, and the reason is printed.
//
//   node scripts/s46-20261001-wa-menu.mjs                    the check + the plan, nothing written
//   node scripts/s46-20261001-wa-menu.mjs --apply            rollback file first, then hide (only when unused)
//   node scripts/s46-20261001-wa-menu.mjs --verify           read-only checks
//   node scripts/s46-20261001-wa-menu.mjs --rollback [--apply]   the menu back
//
// Out: scripts/artifacts/s46-20261001-wa-menu-check.json, …-rollback.json. No WhatsApp message.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { APPLY, ROLLBACK, VERIFY, call, checker, log } from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s46-20261001-wa-menu-rollback.json", import.meta.url);
const OUT = new URL("./artifacts/s46-20261001-wa-menu-check.json", import.meta.url);
const ALL = { active_test: false };
const MODEL_RE = /whatsapp\.(message|template|account|composer|preview|partner\.bsuid|template\.button|template\.variable)\b/;

async function rootMenu() {
  const m = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", false], ["web_icon", "=like", "whatsapp,%"]], fields: ["id", "name", "active", "group_ids", "web_icon", "child_id"], context: ALL });
  if (m.length !== 1) throw new Error(`the WhatsApp root menu: ${m.length} found — stop`);
  return m[0];
}

/** Every place UTAK could reach the module's models. Read-only. */
async function usage() {
  const found = [];
  // 1. the worker's code
  const src = new URL("../src/", import.meta.url);
  const hits = [];
  for (const f of readdirSync(src).filter((x) => x.endsWith(".ts"))) {
    readFileSync(new URL(f, src), "utf8").split("\n").forEach((line, i) => { if (MODEL_RE.test(line)) hits.push(`src/${f}:${i + 1}`); });
  }
  if (hits.length) found.push(`the worker's code names a module model: ${hits.join(", ")}`);
  // 2. the module's models
  const models = await call("ir.model", "search_read", { domain: [["model", "=like", "whatsapp.%"]], fields: ["id", "model"] });
  const names = models.map((m) => m.model);
  // 3. custom fields: on a module model, or pointing to one
  const fOn = await call("ir.model.fields", "search_read", { domain: [["model", "in", names], ["state", "=", "manual"]], fields: ["id", "model", "name"] });
  const fTo = await call("ir.model.fields", "search_read", { domain: [["relation", "in", names], ["state", "=", "manual"]], fields: ["id", "model", "name", "relation"] });
  if (fOn.length) found.push(`custom fields on the module's models: ${fOn.map((f) => `${f.model}.${f.name}`).join(", ")}`);
  if (fTo.length) found.push(`custom fields pointing to the module's models: ${fTo.map((f) => `${f.model}.${f.name} → ${f.relation}`).join(", ")}`);
  // 4. automations and server actions
  const autos = await call("base.automation", "search_read", { domain: [["model_name", "in", names]], fields: ["id", "name", "model_name", "active"], context: ALL });
  if (autos.length) found.push(`automations on the module's models: ${autos.map((a) => `#${a.id} ${a.name}`).join(", ")}`);
  const acts = await call("ir.actions.server", "search_read", { domain: ["|", "|", ["state", "=", "whatsapp"], ["model_name", "in", names], ["code", "ilike", "env['whatsapp."]], fields: ["id", "name", "state", "model_name", "create_uid", "xml_id"], context: ALL });
  const customActs = acts.filter((a) => !a.xml_id);
  if (customActs.length) found.push(`server actions (not the module's own) on / sending through the module: ${customActs.map((a) => `#${a.id} ${a.name} (${a.state}, ${a.model_name})`).join(", ")}`);
  // every UTAK automation's actions: none of state «whatsapp»
  const allAutos = await call("base.automation", "search_read", { domain: [], fields: ["id", "name", "action_server_ids"], context: ALL });
  const actIds = [...new Set(allAutos.flatMap((a) => a.action_server_ids))];
  const autoActs = actIds.length ? await call("ir.actions.server", "read", { ids: actIds, fields: ["id", "name", "state", "model_name", "code"] }) : [];
  const waActs = autoActs.filter((a) => a.state === "whatsapp" || names.includes(a.model_name) || MODEL_RE.test(String(a.code || "")));
  if (waActs.length) found.push(`automation actions using the module: ${waActs.map((a) => `#${a.id} ${a.name}`).join(", ")}`);
  // 5. custom views (no xml id) on the module's models, or UTAK views naming them
  const views = await call("ir.ui.view", "search_read", { domain: ["|", ["model", "in", names], ["arch_db", "ilike", "whatsapp."]], fields: ["id", "name", "model", "xml_id", "arch_db"], context: ALL });
  const customViews = views.filter((v) => !v.xml_id && (names.includes(v.model) || MODEL_RE.test(String(v.arch_db || ""))));
  if (customViews.length) found.push(`custom views on / naming the module's models: ${customViews.map((v) => `#${v.id} ${v.name} (${v.model})`).join(", ")}`);
  // 6. the UTAK menu's actions
  const utakMenus = await call("ir.ui.menu", "search_read", { domain: [["id", "child_of", 529]], fields: ["id", "name", "action"], context: ALL });
  const winIds = utakMenus.map((m) => String(m.action || "")).filter((a) => a.startsWith("ir.actions.act_window,")).map((a) => Number(a.split(",")[1]));
  const wins = winIds.length ? await call("ir.actions.act_window", "read", { ids: winIds, fields: ["id", "name", "res_model"] }) : [];
  const waWins = wins.filter((w) => names.includes(w.res_model));
  if (waWins.length) found.push(`UTAK menus opening the module's models: ${waWins.map((w) => `${w.name} → ${w.res_model}`).join(", ")}`);
  // 7. for the record: what the module itself holds
  const counts = {};
  for (const m of ["whatsapp.account", "whatsapp.template", "whatsapp.message"]) if (names.includes(m)) counts[m] = await call(m, "search_count", { domain: [], context: ALL });
  return {
    found, models: names, counts, automationsScanned: allAutos.length, automationActionsScanned: autoActs.length, srcHits: hits,
    customFieldsOn: fOn.length, customFieldsTo: fTo.length, serverActions: acts.map((a) => `#${a.id} ${a.name} (${a.state}, ${a.model_name}${a.xml_id ? `, ${a.xml_id}` : ""})`),
    viewsScanned: views.length, utakWindows: wins.length,
  };
}

const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s46-20261001-wa-menu.mjs", createdAt: new Date().toISOString(), before: null };

if (ROLLBACK) {
  if (!rb.before) { log("nothing to roll back (the menu was not hidden by this script)"); process.exit(0); }
  log(`ir.ui.menu #${rb.before.id} «${rb.before.name}»: active back to ${rb.before.active}`);
  if (APPLY) await call("ir.ui.menu", "write", { ids: [rb.before.id], vals: { active: rb.before.active } });
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

const menu = await rootMenu();
const u = await usage();
const modules = await call("ir.module.module", "search_read", { domain: [["name", "=like", "whatsapp%"]], fields: ["name", "state"] });

if (VERIFY) {
  const { check, done } = checker();
  check("UTAK uses no model of Odoo's WhatsApp module", u.found.length === 0, u.found.join(" | "));
  check(`the root menu «${menu.name}» (#${menu.id}) is hidden (active = false)`, menu.active === false);
  check("its groups are untouched", JSON.stringify(menu.group_ids) === JSON.stringify(rb.before?.group_ids ?? menu.group_ids));
  check("the module stays installed (nothing uninstalled)", modules.find((m) => m.name === "whatsapp")?.state === "installed"
    && (!rb.modules || JSON.stringify(Object.fromEntries(modules.map((m) => [m.name, m.state]))) === JSON.stringify(rb.modules)), JSON.stringify(modules.map((m) => `${m.name}=${m.state}`)));
  const utak = await call("ir.ui.menu", "search_read", { domain: [["id", "in", [529, 563, 564, 565]]], fields: ["id", "name", "active"], context: ALL });
  check("UTAK's own menus («💬 المحادثات»، «رسائل واتساب»، «تحكم واتساب») are still there", utak.length === 4 && utak.every((m) => m.active), JSON.stringify(utak));
  done();
}

log(`وحدة WhatsApp: ${modules.filter((m) => m.state === "installed").map((m) => m.name).join(", ")}`);
log(`نماذجها: ${u.models.join(", ")}`);
log(`سجلاتها: ${Object.entries(u.counts).map(([m, n]) => `${m} ${n}`).join("، ")}`);
log(`كود الوركر (src/): ${u.srcHits.length ? u.srcHits.join(", ") : "لا يذكر أي نموذج منها"}`);
log(`حقول مخصصة على نماذجها ${u.customFieldsOn}، وحقول مخصصة تشير إليها ${u.customFieldsTo}`);
log(`الأتمتات المفحوصة ${u.automationsScanned} وإجراءاتها ${u.automationActionsScanned}، والعروض ${u.viewsScanned}، ونوافذ قائمة UTAK ${u.utakWindows}`);
log(`إجراءات خادم على نماذج الوحدة أو بنوع «whatsapp»: ${u.serverActions.join(" | ") || "لا شيء"}`);
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), menu: { id: menu.id, name: menu.name, active: menu.active, group_ids: menu.group_ids }, modules, ...u }, null, 2) + "\n");
if (u.found.length) {
  log(`\n✗ UTAK يستعمل الوحدة — لا يُخفى شيء:`);
  for (const f of u.found) log(`  • ${f}`);
  process.exit(1);
}
log(`\n✓ UTAK لا يستعمل أي نموذج من وحدة Odoo WhatsApp.`);
if (menu.active === false) { log(`= القائمة الجذرية «${menu.name}» (#${menu.id}) مخفية`); process.exit(0); }
log(`✎ ir.ui.menu #${menu.id} «${menu.name}»: active true → false (الوحدة تبقى مثبتة)`);
if (APPLY) {
  writeFileSync(RB, JSON.stringify({ ...rb, before: { id: menu.id, name: menu.name, active: menu.active, group_ids: menu.group_ids }, modules: Object.fromEntries(modules.map((m) => [m.name, m.state])) }, null, 2) + "\n");
  await call("ir.ui.menu", "write", { ids: [menu.id], vals: { active: false } });
  log("applied");
} else log("dry-run: nothing written (add --apply)");
