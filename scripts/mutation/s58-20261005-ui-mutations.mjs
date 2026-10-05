// Mutation check for § 58 ج + د as Odoo carries them today (2026-10-05) — «📊 اليوم» with its notebook
// («📍 اليوم» first, three tabs of one read-only HTML field each, the target under the tiles, the link
// «📊 حلّل بنفسك»), «📈 تاريخ الأسعار» (Odoo's own graph and pivot on the real lines) and «هدف الربح
// اليومي» in the settings: scripts/lib/s58-ui.mjs, scripts/lib/s58-odoo.mjs, scripts/s58-20261005-day.mjs
// and the older verifies that read the screen through dayArch57Of. Only what is in the code: the worker
// does not fill the tabs yet. Each mutation disables ONE rule, runs the test file, and must make it fail.
// The source is restored in `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits the scripts in place, so it never runs in the working tree.
//
//   node scripts/mutation/s58-20261005-ui-mutations.mjs [اليوم التاريخ الإعدادات الحقول الفحوص]     (no argument: every part)
//
// Out: scripts/artifacts/s58-20261005-ui-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s58-ui.test.mts";
const UI = "scripts/lib/s58-ui.mjs";
const OD = "scripts/lib/s58-odoo.mjs";
const DAY = "scripts/s58-20261005-day.mjs";
const V57 = "scripts/s57-20261005-day.mjs";
const V56 = "scripts/s56-20261005-odoo.mjs";
const V48 = "scripts/s48-20261001-ui.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- the day's form
  ["اليوم", "the first page is not named «📍 اليوم»", [[UI,
    "export const TODAY_TAB = { name: \"utak_today\", title: \"📍 اليوم\" };", "export const TODAY_TAB = { name: \"utak_today\", title: \"اليوم\" };"]], T],
  ["اليوم", "the tabs come in another order", [[UI,
    "  { name: \"utak_money\", title: \"💧 وين يروح المال\", field: \"x_tab_money_html\" },\n  { name: \"utak_items\", title: \"⭐ الأصناف\", field: \"x_tab_items_html\" },", "  { name: \"utak_items\", title: \"⭐ الأصناف\", field: \"x_tab_items_html\" },\n  { name: \"utak_money\", title: \"💧 وين يروح المال\", field: \"x_tab_money_html\" },"]], T],
  ["اليوم", "a tab reads another tab's field", [[UI,
    "  { name: \"utak_items\", title: \"⭐ الأصناف\", field: \"x_tab_items_html\" },", "  { name: \"utak_items\", title: \"⭐ الأصناف\", field: \"x_tab_money_html\" },"]], T],
  ["اليوم", "a tab is dropped", [[UI,
    "  { name: \"utak_next\", title: \"🎯 الفرص والقادم\", field: \"x_tab_next_html\" },\n", ""]], T],
  ["اليوم", "a tab's field can be edited by hand", [[UI,
    "      <field name=\"${t.field}\" readonly=\"1\" nolabel=\"1\"/>", "      <field name=\"${t.field}\" nolabel=\"1\"/>"]], T],
  ["اليوم", "the line of an empty tab shows beside a filled one", [[UI,
    "      <div class=\"text-muted\" invisible=\"${t.field}\">${TAB_EMPTY_NOTE}</div>", "      <div class=\"text-muted\">${TAB_EMPTY_NOTE}</div>"]], T],
  ["اليوم", "an empty tab does not say how it is built", [[UI,
    "export const TAB_EMPTY_NOTE = \"يُبنى مع أول حساب لليوم: اضغط «🔄 إعادة الحساب».\";", "export const TAB_EMPTY_NOTE = \"لا بيانات.\";"]], T],
  ["اليوم", "the notebook has no name of its own", [[UI,
    "export const NOTEBOOK = \"utak_day_tabs\";", "export const NOTEBOOK = \"tabs\";"]], T],
  ["اليوم", "the target is not right under the tiles", [[UI,
    "arch.slice(arch.indexOf(TILES_FROM), arch.indexOf(APPROVED_FROM)), TARGET_TAG,\n    arch.slice(arch.indexOf(APPROVED_FROM), end), NOTEBOOK_CLOSE, SHEET_END,", "arch.slice(arch.indexOf(TILES_FROM), arch.indexOf(APPROVED_FROM)),\n    arch.slice(arch.indexOf(APPROVED_FROM), end), TARGET_TAG, NOTEBOOK_CLOSE, SHEET_END,"]], T],
  ["اليوم", "the target can be edited by hand", [[UI,
    "export const TARGET_TAG = `<field name=\"${TARGET_FIELD}\" readonly=\"1\" nolabel=\"1\" class=\"mb-3\"/>\\n    `;", "export const TARGET_TAG = `<field name=\"${TARGET_FIELD}\" nolabel=\"1\" class=\"mb-3\"/>\\n    `;"]], T],
  ["اليوم", "the target is another field", [[UI,
    "export const TARGET_FIELD = \"x_target_html\";", "export const TARGET_FIELD = \"x_chart_html\";"]], T],
  ["اليوم", "the notebook opens above the links and the banners", [[UI,
    "    arch.slice(0, arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length), historyLink(historyAction),\n    arch.slice(arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length, arch.indexOf(TILES_FROM)), NOTEBOOK_OPEN,", "    arch.slice(0, arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length), historyLink(historyAction), NOTEBOOK_OPEN,\n    arch.slice(arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length, arch.indexOf(TILES_FROM)),"]], T],
  ["اليوم", "the link «📊 حلّل بنفسك» opens the settings", [[UI,
    "export const historyLink = (actionId) => `\\n      <button name=\"${actionId}\" type=\"action\"", "export const historyLink = (actionId) => `\\n      <button name=\"${SETTINGS_ACTION}\" type=\"action\""]], T],
  ["اليوم", "the link has another label", [[UI,
    "export const HISTORY_BUTTON = \"📊 حلّل بنفسك\";", "export const HISTORY_BUTTON = \"📊 التحليل\";"]], T],
  ["اليوم", "the link is not added", [[UI,
    "arch.slice(0, arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length), historyLink(historyAction),", "arch.slice(0, arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length),"]], T],
  ["اليوم", "an arch that already carries § 58 is changed again", [[UI,
    "  if (arch.includes(`<notebook name=\"${NOTEBOOK}\">`)) return arch;\n  if (!Number.isInteger(historyAction)", "  if (!Number.isInteger(historyAction)"]], T],
  ["اليوم", "a missing action of «📈 تاريخ الأسعار» is written as it is", [[UI,
    "  if (!Number.isInteger(historyAction) || historyAction <= 0) throw new Error(", "  if (false) throw new Error("]], T],
  ["اليوم", "an action given as text is taken", [[UI,
    "  if (!Number.isInteger(historyAction) || historyAction <= 0) throw new Error(", "  if (!(historyAction > 0)) throw new Error("]], T],
  ["اليوم", "an arch that already has a notebook is taken", [[UI,
    " || arch.includes(\"<notebook\")\n", "\n"]], T],
  ["اليوم", "an arch without § 57's class is taken", [[UI,
    "  if (!arch.startsWith(FORM_OPEN) || !once(arch, TILES_FROM)", "  if (!once(arch, TILES_FROM)"]], T],
  ["اليوم", "an arch without the settings' link is taken", [[UI,
    " || !once(arch, SETTINGS_LINK) || !arch.endsWith(SHEET_END)", " || !arch.endsWith(SHEET_END)"]], T],
  ["اليوم", "an arch with another end is taken", [[UI,
    " || !once(arch, SETTINGS_LINK) || !arch.endsWith(SHEET_END)", " || !once(arch, SETTINGS_LINK)"]], T],
  ["اليوم", "taking § 58 off leaves the target behind", [[UI,
    ".replace(NOTEBOOK_OPEN, \"\").replace(TARGET_TAG, \"\")", ".replace(NOTEBOOK_OPEN, \"\")"]], T],
  ["اليوم", "taking § 58 off leaves the link behind", [[UI,
    "  const out = arch.replace(link, \"\").replace(NOTEBOOK_OPEN, \"\")", "  const out = arch.replace(NOTEBOOK_OPEN, \"\")"]], T],
  ["اليوم", "taking § 58 off a form changed by hand does not stop", [[UI,
    "  if (out.includes(\"<notebook\") || out.includes(TARGET_FIELD) || out.includes(HISTORY_BUTTON) || TABS.some((t) => out.includes(t.field))) throw new Error(", "  if (false) throw new Error("]], T],
  // ---------------------------------------------------------------- «📈 تاريخ الأسعار»
  ["التاريخ", "the graph is bars", [[UI,
    "type=\"line\" stacked=\"0\" sample=\"0\">", "type=\"bar\" stacked=\"0\" sample=\"0\">"]], T],
  ["التاريخ", "the graph's first measure is the sale price", [[UI,
    "  <field name=\"${HISTORY_MEASURES[0][0]}\" type=\"measure\"/>\n</graph>", "  <field name=\"${HISTORY_MEASURES[1][0]}\" type=\"measure\"/>\n</graph>"]], T],
  ["التاريخ", "the graph groups by the item before the day", [[UI,
    "  <field name=\"${HISTORY_DAY_FIELD}\" interval=\"day\"/>\n  <field name=\"${HISTORY_ITEM_FIELD}\"/>", "  <field name=\"${HISTORY_ITEM_FIELD}\"/>\n  <field name=\"${HISTORY_DAY_FIELD}\" interval=\"day\"/>"]], T],
  ["التاريخ", "the graph groups by the week", [[UI,
    "  <field name=\"${HISTORY_DAY_FIELD}\" interval=\"day\"/>\n  <field name=\"${HISTORY_ITEM_FIELD}\"/>", "  <field name=\"${HISTORY_DAY_FIELD}\" interval=\"week\"/>\n  <field name=\"${HISTORY_ITEM_FIELD}\"/>"]], T],
  ["التاريخ", "the pivot puts the items in columns", [[UI,
    "  <field name=\"${HISTORY_ITEM_FIELD}\" type=\"row\"/>", "  <field name=\"${HISTORY_ITEM_FIELD}\" type=\"col\"/>"]], T],
  ["التاريخ", "the pivot shows Odoo's sample data when empty", [[UI,
    "<pivot string=\"${HISTORY_TITLE}\" sample=\"0\">", "<pivot string=\"${HISTORY_TITLE}\" sample=\"1\">\n  <!-- widget -->"]], T],
  ["التاريخ", "a measure is dropped", [[UI,
    "[\"x_real_profit\", \"الربح الحقيقي للكرتون\"], ", ""]], T],
  ["التاريخ", "the measures come in another order", [[UI,
    "[\"x_market_price\", \"سعر السوق\"], [\"x_sale_price\", \"سعر البيع\"],", "[\"x_sale_price\", \"سعر البيع\"], [\"x_market_price\", \"سعر السوق\"],"]], T],
  ["التاريخ", "the contribution's measure is another field", [[UI,
    "[CONTRIBUTION_FIELD, \"مساهمة الكرتون\"],", "[\"x_break_even\", \"مساهمة الكرتون\"],"]], T],
  ["التاريخ", "a measure is a field the line does not have", [[UI,
    "[\"x_cost_price\", \"سعر الشراء\"],", "[\"x_purchase_price\", \"سعر الشراء\"],"]], T],
  ["التاريخ", "a simulation day's lines are counted", [[UI,
    "export const HISTORY_DOMAIN = \"[('x_utak_simulation', '=', False), ('x_day_id.x_utak_simulation', '=', False)]\";", "export const HISTORY_DOMAIN = \"[('x_utak_simulation', '=', False)]\";"]], T],
  ["التاريخ", "the menu comes before «📊 اليوم»", [[UI,
    "export const HISTORY_MENU_SEQUENCE = 25;", "export const HISTORY_MENU_SEQUENCE = 5;"]], T],
  ["التاريخ", "the menu sits under another app", [[UI,
    "export const PRICING_MENU = 582;", "export const PRICING_MENU = 1;"]], T],
  ["التاريخ", "the screen has another title", [[UI,
    "export const HISTORY_TITLE = \"📈 تاريخ الأسعار\";", "export const HISTORY_TITLE = \"تاريخ الأسعار\";"]], T],
  ["التاريخ", "the action opens every line, simulation or not", [[DAY,
    "view_mode: \"graph,pivot,list\", domain: HISTORY_DOMAIN,", "view_mode: \"graph,pivot,list\","]], T],
  ["التاريخ", "the action's graph is the pivot's view", [[DAY,
    "{ sequence: 1, view_mode: \"graph\", view_id: graphId }", "{ sequence: 1, view_mode: \"graph\", view_id: pivotId }"]], T],
  ["التاريخ", "the action opens on the pivot", [[DAY,
    "{ sequence: 2, view_mode: \"pivot\", view_id: pivotId }", "{ sequence: 0, view_mode: \"pivot\", view_id: pivotId }"]], T],
  ["التاريخ", "a rollback deletes the menu", [[DAY,
    "await call(\"ir.ui.menu\", \"write\", { ids: menus, vals: { active: false } })", "await call(\"ir.ui.menu\", \"unlink\", { ids: menus })"]], T],
  ["التاريخ", "a rollback deletes what was created without --drop", [[DAY,
    "  if (DROP) await dropCreated(", "  await dropCreated("]], T],
  // ---------------------------------------------------------------- «⚙️ الإعدادات»
  ["الإعدادات", "«هدف الربح اليومي» sits above «الكراتين المتوقعة يومياً»", [[UI,
    "  return arch.replace(CARTONS_TAG, `${CARTONS_TAG}${PROFIT_TARGET_TAG}`);", "  return arch.replace(CARTONS_TAG, `${PROFIT_TARGET_TAG}${CARTONS_TAG}`);"]], T],
  ["الإعدادات", "a form that already has the field gets it again", [[UI,
    "  if (arch.includes(`name=\"${PROFIT_TARGET_FIELD}\"`)) return arch;\n", ""]], T],
  ["الإعدادات", "a form without «الكراتين المتوقعة يومياً» is written as it is", [[UI,
    "  if (!once(arch, CARTONS_TAG)) throw new Error(", "  if (false) throw new Error("]], T],
  ["الإعدادات", "taking the field off leaves it", [[UI,
    "export const settingsArch57Of = (arch) => arch.replace(PROFIT_TARGET_TAG, \"\");", "export const settingsArch57Of = (arch) => arch;"]], T],
  ["الإعدادات", "the field has another name", [[OD,
    "export const PROFIT_TARGET_FIELD = \"x_daily_profit_target\";", "export const PROFIT_TARGET_FIELD = \"x_profit_target\";"]], T],
  ["الإعدادات", "the field has another label", [[OD,
    "export const PROFIT_TARGET_LABEL = \"هدف الربح اليومي (ريال)\";", "export const PROFIT_TARGET_LABEL = \"الهدف\";"]], T],
  // ---------------------------------------------------------------- the fields
  ["الحقول", "the four HTML fields lose Odoo's sanitizer", [[OD,
    "const HTML_FLAGS = { sanitize: true, sanitize_overridable: false, sanitize_tags: true,", "const HTML_FLAGS = { sanitize: false, sanitize_overridable: false, sanitize_tags: true,"]], T],
  ["الحقول", "the four HTML fields keep any attribute", [[OD,
    "sanitize_tags: true, sanitize_attributes: true, sanitize_style: false,", "sanitize_tags: true, sanitize_attributes: false, sanitize_style: false,"]], T],
  ["الحقول", "the four HTML fields have their inline style stripped", [[OD,
    "sanitize_form: true, strip_style: false, strip_classes: false };", "sanitize_form: true, strip_style: true, strip_classes: false };"]], T],
  ["الحقول", "the contribution is another field of the line", [[OD,
    "export const CONTRIBUTION_FIELD = \"x_contribution\";", "export const CONTRIBUTION_FIELD = \"x_real_profit\";"]], T],
  ["الحقول", "the plan's basis has a third value", [[OD,
    "export const PLAN_BASIS_OPTIONS = [[\"simple\", \"متوسط بسيط\"], [\"weighted\", \"مرجّح بمبيعات آخر 7 أيام\"]];", "export const PLAN_BASIS_OPTIONS = [[\"simple\", \"متوسط بسيط\"], [\"weighted\", \"مرجّح بمبيعات آخر 7 أيام\"], [\"manual\", \"يدوي\"]];"]], T],
  ["الحقول", "«التالف مسجَّل فعلاً» is a number", [[OD,
    "  { name: \"x_act_waste_real\", ttype: \"boolean\",", "  { name: \"x_act_waste_real\", ttype: \"float\","]], T],
  ["الحقول", "«وقت حساب الفعلي» is a text", [[OD,
    "  { name: \"x_act_at\", ttype: \"datetime\",", "  { name: \"x_act_at\", ttype: \"char\","]], T],
  // ---------------------------------------------------------------- the older checks
  ["الفحوص", "§ 57's verify compares the form with § 58's parts on it", [[V57,
    "dayArch57Of(v.arch_db) === dayArch57(was.arch)", "v.arch_db === dayArch57(was.arch)"]], T],
  ["الفحوص", "§ 56's verify compares the form with § 58's parts on it", [[V56,
    "dayArch57Of(v.arch_db) === dayArch57(dayArch(was.arch))", "v.arch_db === dayArch57(dayArch(was.arch))"]], T],
  ["الفحوص", "§ 48's verify does not expect «📈 تاريخ الأسعار» in the menu", [[V48,
    "[HISTORY_TITLE, `ir.actions.act_window,${history}`], ", ""]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s58-20261005-ui-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
