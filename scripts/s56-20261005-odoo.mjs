// § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم» made plain (scripts/lib/s56-ui.mjs is the data):
//
//   1  the fields the worker fills with every run (src/day-screen.ts) — on x_price_day_line the
//      table's cells («الشراء شامل», «ربحنا بسعر السوق» and its number, «المقترح (وربحه)», «فرق
//      المقترح عن السوق», «القرار»); on x_price_day the header's four numbers and the chart
//      (x_chart_html, an HTML field that keeps Odoo's sanitizer).
//   2  the screen's body in utak.price_day_form: the header, the four large numbers, the chart, the
//      table in the review's order, cards on a phone, everything else in the line's own form. The
//      form's header (its buttons), the links and the banners are not touched.
//
//   node scripts/s56-20261005-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s56-20261005-odoo.mjs --apply --fields   step 1 alone — BEFORE the worker's code is deployed (it reads and writes the fields)
//   node scripts/s56-20261005-odoo.mjs --apply            steps 1 and 2 — the view AFTER the code is deployed and the days are filled
//                                                         (scripts/s56-20261005-days.mts), so the screen never shows empty columns
//   node scripts/s56-20261005-odoo.mjs --verify           read-only checks
//   node scripts/s56-20261005-odoo.mjs --rollback [--apply]          the form's arch as it was. The fields stay (the worker writes them).
//   node scripts/s56-20261005-odoo.mjs --rollback --drop [--apply]   and delete the fields — by Baraa's decision only, AFTER the
//                                                         worker's code is rolled back (it reads them with every line).
// Rollback file: scripts/artifacts/s56-20261005-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, decision, order, invoice or payment is written here: fields and one view.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, rollbackFile } from "./lib/s40-kit.mjs";
import {
  BODY_MARK, CHART_FIELD, COLUMNS, DAY_FIELDS, DAY_MODEL, DAY_NOTE_56, DETAIL_FIELDS, LINE_FIELDS, LINE_MODEL, SANITIZE_FLAGS, VIEW_DAY, dayArch,
} from "./lib/s56-ui.mjs";
// § 57 أ (2026-10-05): the form carries its own class and stylesheet, and the average's label says «(المنشور)» (scripts/lib/s57-ui.mjs)
import { FIELD_LABELS, dayArch57 } from "./lib/s57-ui.mjs";
// § 58 ج + د (2026-10-05): the body sits in the first page of a notebook, with a target, three tabs and one link more (scripts/lib/s58-ui.mjs): taken off before the comparison
import { dayArch57Of } from "./lib/s58-ui.mjs";

const FIELDS_ONLY = process.argv.includes("--fields");
const RB = new URL("./artifacts/s56-20261005-odoo-rollback.json", import.meta.url);
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s56-20261005-odoo.mjs");
const { rb, save } = ctx;
rb.before.views ??= {};
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active"], context: ALL }))[0];
const rendered = async (id) => String((await call(DAY_MODEL, "get_views", { views: [[id, "form"]] }))?.views?.form?.arch ?? "");
const headerOf = (arch) => /<header>[\s\S]*?<\/header>/.exec(arch)?.[0] ?? "";
const fieldsHave = async (model, defs) => {
  const have = new Set((await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "in", defs.map((d) => d.name)]], fields: ["name"] })).map((r) => r.name));
  return defs.every((d) => have.has(d.name));
};

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const v = rb.before.views[VIEW_DAY];
  log(v ? `view #${v.id} ${VIEW_DAY}: its arch back (${v.arch.length} characters)` : `view ${VIEW_DAY}: not changed by this script`);
  log(DROP ? `fields ${(rb.created.fields ?? []).join(", ") || "-"} (created): dropped` : `fields ${(rb.created.fields ?? []).join(", ") || "-"} (created): stay (the worker writes them; nothing is deleted)`);
  if (APPLY && v) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
  if (DROP) await dropCreated(rb, [["ir.model.fields", [...(rb.created.fields ?? [])].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  for (const [model, defs] of [[LINE_MODEL, LINE_FIELDS], [DAY_MODEL, DAY_FIELDS]]) {
    const f = await call(model, "fields_get", { attributes: ["type", "string"] });
    check(`${model}: ${defs.map((d) => `${d.name} (${d.ttype})`).join(", ")}`, defs.every((d) => f[d.name]?.type === d.ttype && f[d.name].string === (FIELD_LABELS[d.name] ?? d.field_description)), JSON.stringify(defs.map((d) => [d.name, f[d.name]])));
    await pause();
  }
  const [chart] = await call("ir.model.fields", "search_read", { domain: [["model", "=", DAY_MODEL], ["name", "=", CHART_FIELD.name]], fields: SANITIZE_FLAGS });
  check(`${CHART_FIELD.name} keeps Odoo's sanitizer (tags and attributes), the style attribute and the classes as written`, !!chart && SANITIZE_FLAGS.every((k) => chart[k] === CHART_FIELD[k]), JSON.stringify(chart));
  await pause();
  const v = await viewOf(VIEW_DAY);
  const was = rb.before.views[VIEW_DAY];
  if (!v?.arch_db.includes(BODY_MARK)) {
    check(`the form #${v?.id} carries § 56's body`, false, "the view is still the one of before § 56: run --apply (after the worker's code is deployed and the days are filled)");
    done();
  }
  if (was) check(`the form #${v.id} is the one of before § 56 with its body replaced (and § 57's class, stylesheet and label), and nothing else: its header (the buttons), the links, the banners and «تقرير النشر» byte for byte`, dayArch57Of(v.arch_db) === dayArch57(dayArch(was.arch)) && headerOf(v.arch_db) === headerOf(was.arch) && headerOf(was.arch).length > 0, `${v.arch_db.length} against ${dayArch57(dayArch(was.arch)).length} characters`);
  const arch = await rendered(v.id);
  check("it renders: «🔄 إعادة الحساب», «نشر المعتمد الآن», the day before and after, and the four links, as they were", ["🔄 إعادة الحساب", "نشر المعتمد الآن", "◀ اليوم السابق", "اليوم التالي ▶", "📅 الأيام السابقة", "📥 عروض المصادر", "📦 الأصناف", "⚙️ الإعدادات"].every((s) => arch.includes(`string="${s}"`)), arch.slice(0, 300));
  const order = (names) => names.map((n) => arch.indexOf(n)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]));
  check("the order: the date, the state and the publication time, the four large numbers, the chart, the table, then the day's details", order([`name="x_date"`, `name="utak_day_head"`, `name="x_n_publish"`, `name="x_n_skip"`, `name="x_n_warn"`, `name="x_avg_profit_show"`, `name="x_chart_html"`, `<field name="x_line_ids"`, `name="utak_day_details"`]));
  const list = /<list[\s\S]*?<\/list>/.exec(arch)?.[0] ?? "";
  const shown = [...list.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].filter((m) => !/column_invisible|optional="hide"/.test(m[2])).map((m) => [m[1], /string="([^"]*)"/.exec(m[2])?.[1]]);
  check(`the table: ${COLUMNS.map((c) => c[1]).join(" · ")} — nine columns in the review's order, read-only (a row opens the line)`, JSON.stringify(shown) === JSON.stringify(COLUMNS) && !/editable=/.test(list), JSON.stringify(shown));
  const card = /<kanban[\s\S]*?<\/kanban>/.exec(arch)?.[0] ?? "";
  check("cards on a phone: the same cells in the same order, each on a line of its own", /mode="list,kanban"/.test(arch) && COLUMNS.map((c) => card.indexOf(`<field name="${c[0]}"`, card.indexOf("<templates>"))).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])), card.slice(0, 200));
  const form = /<form string="تفاصيل الصنف">[\s\S]*?<\/form>/.exec(arch)?.[0] ?? "";
  check("the line's own form: «قرار براء» and «السعر المعدّل», and what left the table — the carton share, the waste, «بدون خسارة», the observations, the sources, the technical fields", [...DETAIL_FIELDS, "x_decision", "x_manual_price"].every((f) => form.includes(`name="${f}"`)) && DETAIL_FIELDS.filter((f) => f !== "x_status").every((f) => !list.includes(`name="${f}"`)), form.slice(0, 200));
  check("the explanation: how «ربحنا» is made, § 48's formula and § 54's rule", arch.includes(DAY_NOTE_56) && !/متى بلغ/.test(arch));
  await pause();
  // what the worker wrote on the last real day
  const [day] = await call(DAY_MODEL, "search_read", { domain: [["x_date", "<=", riyadhToday()], ["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", ...DAY_FIELDS.map((d) => d.name)], order: "x_date desc, id desc", limit: 1 });
  const lines = day ? await call(LINE_MODEL, "search_read", { domain: [["x_day_id", "=", day.id]], fields: ["id", "x_reason", ...LINE_FIELDS.map((d) => d.name)], order: "x_sequence, id" }) : [];
  const html = String(day?.x_chart_html || "");
  check(`the day #${day?.id} (${day?.x_date}, «${day?.x_state}») carries its chart (${html.length} characters): both parts, no script, no style block, no SVG`, html.includes("utak-day-chart") && html.includes("utak-prices") && html.includes("utak-profits") && !/<script|<style|<svg|<iframe|\son\w+=/i.test(html), html.slice(0, 200));
  check(`…a row and a column for each of its ${lines.length} lines of the day`, (html.match(/class="utak-row /g) ?? []).length === day?.x_n_publish + day?.x_n_skip && (html.match(/class="utak-col /g) ?? []).length === day?.x_n_publish + day?.x_n_skip, `${(html.match(/class="utak-row /g) ?? []).length} rows`);
  check(`…and its four numbers: للنشر ${day?.x_n_publish} · لا تنشر ${day?.x_n_skip} · ⚠️ ${day?.x_n_warn} · متوسط ربح الكرتون ${day?.x_avg_profit_show}`, lines.length > 0 && day.x_n_publish + day.x_n_skip === lines.filter((l) => !String(l.x_outcome_show).includes("خارج الكتالوج")).length && day.x_n_warn <= lines.length && !!day.x_avg_profit_show, JSON.stringify(day && Object.fromEntries(DAY_FIELDS.filter((d) => d.ttype !== "html").map((d) => [d.name, day[d.name]]))));
  check("…every line with its cells («القرار» with its mark first)", lines.length > 0 && lines.every((l) => /^(✅|❌|⚠️|🔻) /.test(String(l.x_outcome_show)) && [l.x_cost_vat_show, l.x_market_profit_show, l.x_suggested_profit_show, l.x_gap_show].every((x) => typeof x === "string" && x.length > 0)), JSON.stringify(lines.slice(0, 2)));
  for (const l of lines) log(`    #${l.id}: شامل ${l.x_cost_vat_show} · ربحنا بسعر السوق ${l.x_market_profit_show} · المقترح ${l.x_suggested_profit_show} · الفرق ${l.x_gap_show} · ${l.x_outcome_show}`);
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? `APPLY${FIELDS_ONLY ? " (the fields only)" : ""}` : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the fields the worker fills`);
await ensureFields(ctx, LINE_MODEL, await modelId(LINE_MODEL), LINE_FIELDS);
await pause();
await ensureFields(ctx, DAY_MODEL, await modelId(DAY_MODEL), DAY_FIELDS);
await pause();

log(`— 2: the body of «📊 اليوم» (${VIEW_DAY})`);
const v = await viewOf(VIEW_DAY);
if (!v) throw new Error(`view ${VIEW_DAY} not found — stop`);
const want = dayArch(v.arch_db);
if (want === v.arch_db) log(`= view ${VIEW_DAY} #${v.id}`);
else {
  log(`✎ view ${VIEW_DAY} #${v.id}: ${v.arch_db.length} → ${want.length} characters (the body: the header and its four numbers, the chart, the table of ${COLUMNS.length} columns, the cards, the line's form; the form's header and links untouched)`);
  log(`    the table: ${COLUMNS.map((c) => c[1]).join(" · ")}`);
  log(`    in the line's form: ${DETAIL_FIELDS.join(", ")}`);
  if (FIELDS_ONLY) log("  · --fields: the view is left as it is");
  else if (APPLY) {
    if (!(await fieldsHave(LINE_MODEL, LINE_FIELDS)) || !(await fieldsHave(DAY_MODEL, DAY_FIELDS))) throw new Error("the fields do not exist yet — stop");
    rb.before.views[VIEW_DAY] ??= { id: v.id, arch: v.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: want } });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s56-20261005-odoo.mjs --verify" : "dry-run: nothing written");
