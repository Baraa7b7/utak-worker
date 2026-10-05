// § 57 أ (2026-10-05) — «💲 التسعير» ← «📊 اليوم» as Baraa sees it in Odoo itself
// (scripts/lib/s57-ui.mjs is the data and says what was read from the tenant):
//
//   1  the labels of x_avg_profit and x_avg_profit_show: «متوسط ربح الكرتون (المنشور)»;
//   2  utak.price_day_form: the form's own class and stylesheet (the whole width, a table that wraps and
//      cuts nothing, «(+2.43)» under its price, room under the last line) and the tile's label. The
//      header (its buttons), the links, the banners, the body's fields and «تقرير النشر» are not touched.
//
//   node scripts/s57-20261005-day.mjs                    dry-run: the plan, nothing written
//   node scripts/s57-20261005-day.mjs --apply            both steps (the rollback file first)
//   node scripts/s57-20261005-day.mjs --verify           read-only checks
//   node scripts/s57-20261005-day.mjs --rollback [--apply]   the arch and the two labels as they were
// Rollback file: scripts/artifacts/s57-20261005-day-rollback.json. The tenant is production. No
// WhatsApp send. No price, decision, order, invoice or payment is written here: two labels and one view.
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";
import { BODY_MARK, COLUMNS, DAY_MODEL, VIEW_DAY } from "./lib/s56-ui.mjs";
import { AVG_LABEL, AVG_LABEL_56, BOTTOM_ROOM_PX, DAY_STYLE, FIELD_LABELS, FORM_CLASS, FORM_OPEN, TILE, TWO_LINE_COLUMN, dayArch57 } from "./lib/s57-ui.mjs";

const RB = new URL("./artifacts/s57-20261005-day-rollback.json", import.meta.url);
const ALL = { active_test: false };
const { rb, save } = rollbackFile(RB, "scripts/s57-20261005-day.mjs");
rb.before.views ??= {}; rb.before.labels ??= {};
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active", "inherit_children_ids"], context: ALL }))[0];
const labelRows = async () => call("ir.model.fields", "search_read", { domain: [["model", "=", DAY_MODEL], ["name", "in", Object.keys(FIELD_LABELS)]], fields: ["id", "name", "field_description"] });
const rendered = async (id) => String((await call(DAY_MODEL, "get_views", { views: [[id, "form"]] }))?.views?.form?.arch ?? "");
const headerOf = (arch) => /<header>[\s\S]*?<\/header>/.exec(arch)?.[0] ?? "";
const flat = (s) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const v = rb.before.views[VIEW_DAY];
  log(v ? `view #${v.id} ${VIEW_DAY}: its arch back (${v.arch.length} characters)` : `view ${VIEW_DAY}: not changed by this script`);
  if (APPLY && v) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
  for (const [name, was] of Object.entries(rb.before.labels)) {
    log(`field ${DAY_MODEL}.${name} #${was.id}: its label back («${was.field_description}»)`);
    if (APPLY) await call("ir.model.fields", "write", { ids: [was.id], vals: { field_description: was.field_description } });
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const [model] = await call("ir.model", "search_read", { domain: [["model", "=", DAY_MODEL]], fields: ["id", "is_mail_thread", "is_mail_activity"] });
  await pause();
  const v = await viewOf(VIEW_DAY);
  check(`${DAY_MODEL} carries no chatter (is_mail_thread ${model?.is_mail_thread}), the form names none and nothing inherits it: the empty half was the sheet's max-width, not a chatter`, model?.is_mail_thread === false && !/<chatter|oe_chatter|message_ids/.test(v?.arch_db ?? "<chatter") && (v?.inherit_children_ids ?? [1]).length === 0, JSON.stringify([model, v?.inherit_children_ids]));
  const was = rb.before.views[VIEW_DAY];
  check(`the form #${v?.id} carries § 57's class`, !!v?.arch_db.startsWith(FORM_OPEN), String(v?.arch_db).slice(0, 80));
  if (was) check("…and is the one of § 56 with the class, the stylesheet and the tile's label, and nothing else: its header (the buttons) byte for byte", v.arch_db === dayArch57(was.arch) && headerOf(v.arch_db) === headerOf(was.arch) && headerOf(was.arch).length > 0 && was.arch.includes(BODY_MARK), `${v.arch_db.length} against ${dayArch57(was.arch).length} characters`);
  const arch = await rendered(v.id);
  const style = /<style>([\s\S]*?)<\/style>/.exec(arch)?.[1] ?? "";
  check(`it renders with the class on the form and ONE stylesheet, as written (${DAY_STYLE.length} characters), inside the sheet`, new RegExp(`<form[^>]*class="${FORM_CLASS}"`).test(arch) && arch.split("<style").length === 2 && flat(style) === flat(DAY_STYLE) && arch.indexOf("<sheet>") < arch.indexOf("<style>") && arch.indexOf("<style>") < arch.indexOf(BODY_MARK), flat(style).slice(0, 200));
  check("…every rule under the form's own class: the whole width, the table's own column widths, cells and headings that wrap and clip nothing", flat(style).split("} ").filter(Boolean).every((r) => r.replace(/^@media \(min-width: 768px\) \{ /, "").startsWith(`.${FORM_CLASS} `)) && /\.o_form_renderer, \.utak_day_form \.o_form_sheet_bg \{ max-width: none !important; \}/.test(style) && /table-layout: auto !important/.test(style) && /white-space: normal !important; overflow: visible !important; text-overflow: clip !important/.test(style), flat(style).slice(0, 200));
  check(`…«(+2.43)» under its price in the same cell (the column ${TWO_LINE_COLUMN} as narrow as its longest word), and ${BOTTOM_ROOM_PX} px under the last line on a wide screen`, style.includes(`th[data-name="${TWO_LINE_COLUMN}"]`) && style.includes(`td[name="${TWO_LINE_COLUMN}"] { width: 1px !important; }`) && style.includes(`@media (min-width: 768px) { .${FORM_CLASS} .o_form_sheet { padding-bottom: ${BOTTOM_ROOM_PX}px !important; } }`));
  check(`the tile says «${AVG_LABEL}», once, and «${AVG_LABEL_56}» alone nowhere`, arch.split(TILE).length === 2 && !arch.includes(`<div>${AVG_LABEL_56}</div>`), "");
  const list = /<list[\s\S]*?<\/list>/.exec(arch)?.[0] ?? "";
  const shown = [...list.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].filter((m) => !/column_invisible|optional="hide"/.test(m[2])).map((m) => [m[1], /string="([^"]*)"/.exec(m[2])?.[1]]);
  check(`the table is still § 56's nine columns, and a phone still gets its cards (mode="list,kanban")`, JSON.stringify(shown) === JSON.stringify(COLUMNS) && /mode="list,kanban"/.test(arch), JSON.stringify(shown));
  check("the buttons, the day before and after and the four links, as they were", ["🔄 إعادة الحساب", "نشر المعتمد الآن", "◀ اليوم السابق", "اليوم التالي ▶", "📅 الأيام السابقة", "📥 عروض المصادر", "📦 الأصناف", "⚙️ الإعدادات"].every((s) => arch.includes(`string="${s}"`)), arch.slice(0, 200));
  await pause();
  const labels = await labelRows();
  check(`the fields' own labels: ${Object.entries(FIELD_LABELS).map(([k, l]) => `${k} «${l}»`).join(", ")}`, labels.length === 2 && labels.every((r) => r.field_description === FIELD_LABELS[r.name]), JSON.stringify(labels));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the two labels`);
for (const r of await labelRows()) {
  const want = FIELD_LABELS[r.name];
  if (r.field_description === want) { log(`= ${DAY_MODEL}.${r.name} #${r.id} «${want}»`); continue; }
  log(`✎ ${DAY_MODEL}.${r.name} #${r.id}: «${r.field_description}» → «${want}»`);
  if (!APPLY) continue;
  rb.before.labels[r.name] ??= { id: r.id, field_description: r.field_description }; save();
  await call("ir.model.fields", "write", { ids: [r.id], vals: { field_description: want } });
  await pause();
}

log(`— 2: «📊 اليوم» (${VIEW_DAY})`);
const v = await viewOf(VIEW_DAY);
if (!v) throw new Error(`view ${VIEW_DAY} not found — stop`);
const want = dayArch57(v.arch_db);
if (want === v.arch_db) log(`= view ${VIEW_DAY} #${v.id}`);
else {
  log(`✎ view ${VIEW_DAY} #${v.id}: ${v.arch_db.length} → ${want.length} characters (class="${FORM_CLASS}" on the form, its stylesheet first in the sheet, the tile «${AVG_LABEL}»; nothing else)`);
  for (const l of DAY_STYLE.split("\n")) log(`    ${l.trim()}`);
  if (APPLY) {
    rb.before.views[VIEW_DAY] ??= { id: v.id, arch: v.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: want } });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s57-20261005-day.mjs --verify" : "dry-run: nothing written");
