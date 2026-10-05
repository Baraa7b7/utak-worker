// § 58 ج + د (2026-10-05) — «📊 اليوم» with its tabs, «📈 تاريخ الأسعار» and «هدف الربح اليومي», as
// Odoo carries them (scripts/lib/s58-ui.mjs, scripts/lib/s58-odoo.mjs).
//
//   [1] the day's arch: § 57's with ONE notebook — «📍 اليوم» first, holding everything the screen showed
//       and the target under the tiles; three tabs, one read-only HTML field each; one link more —
//       and § 57's arch byte for byte once those parts are taken off; twice changes nothing; an arch
//       that is not § 57's stops the script
//   [2] «📈 تاريخ الأسعار»: Odoo's own graph and pivot on the real lines, the five measures, its menu
//   [3] «⚙️ الإعدادات»: «هدف الربح اليومي» under «الكراتين المتوقعة يومياً»
//   [4] the fields: on the tenant (the schema fixture), the four HTML fields sanitized as § 56's chart
//   [5] the older checks (§ 48, § 56, § 57) read the screen after § 58
//
// No Odoo, no network, no send: the arch is text.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s58-ui.test.mts

import { readFileSync } from "node:fs";
import { assert, done } from "./s46-kit.mts";

// @ts-ignore — plain .mjs helpers
const UI = await import("../scripts/lib/s58-ui.mjs");
// @ts-ignore — plain .mjs helpers
const OD = await import("../scripts/lib/s58-odoo.mjs");
// @ts-ignore — plain .mjs helpers
const UI57 = await import("../scripts/lib/s57-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI56 = await import("../scripts/lib/s56-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI48 = await import("../scripts/lib/s48-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI49 = await import("../scripts/lib/s49-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI54 = await import("../scripts/lib/s54-odoo.mjs");

const A = { refresh: 1004, confirm: 1038, unapprove: 1003, approve: 1002, prev: 1033, next: 1034, openDay: 1032, openSources: 1037, days: 1009, products: 1041, settings: 1027, purchaseList: 1039, marketList: 1040, packagings: 1042, profitGraph: 1043 };
const HISTORY = 1046;   // «UTAK — تاريخ الأسعار» on the tenant
const note = UI54.NOTES.find((n: string[]) => n[0] === UI56.VIEW_DAY);
const s54 = String(UI54.noteArch(String(UI49.dayArch(UI48.dayForm(A))), note[1], note[2]));
const s56 = String(UI56.dayArch(s54));
const was = String(UI57.dayArch57(s56));        // what the tenant carried before § 58: § 57's screen
const now = String(UI.dayArch58(was, HISTORY));
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SCHEMA = JSON.parse(read("tests/fixtures-odoo-fields-20261005-s58.json"));
const at = (s: string, from = 0) => now.indexOf(s, from);
const inOrder = (text: string, parts: string[]) => parts.map((p) => text.indexOf(p)).every((p, i, all) => p >= 0 && (i === 0 || p > all[i - 1]));
const wellFormed = (xml: string): string => {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([\w-]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return `</${m[2]}> closes nothing`;
  }
  const left = xml.replace(/<\/?[\w-]+(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g, "");
  return stack.length ? `<${stack.join("> <")}> left open` : left.includes("<") ? `a stray «<»: ${left.slice(left.indexOf("<"), left.indexOf("<") + 60)}` : "";
};

// ================================================================ [1] the day's arch
console.log("\n[1] «📊 اليوم»: one notebook, «📍 اليوم» first with everything it showed, three tabs, one link");
{
  const headOf = (a: string) => /<header>[\s\S]*?<\/header>/.exec(a)?.[0] ?? "";
  const pages = [...now.matchAll(/<page string="([^"]*)" name="([^"]*)">/g)].map((m) => [m[2], m[1]]);
  assert("ONE notebook, named, with four pages in the order's order: «📍 اليوم», «💧 وين يروح المال», «⭐ الأصناف», «🎯 الفرص والقادم»", now.split("<notebook").length === 2 && now.includes(`<notebook name="utak_day_tabs">`)
    && JSON.stringify(pages) === JSON.stringify([["utak_today", "📍 اليوم"], ["utak_money", "💧 وين يروح المال"], ["utak_items", "⭐ الأصناف"], ["utak_next", "🎯 الفرص والقادم"]]), JSON.stringify(pages));
  assert("without § 58's parts it is § 57's arch byte for byte: the header (the buttons), the class, the stylesheet, the links, the banners, every field, «تقرير النشر»", UI.dayArch57Of(now) === was && headOf(now) === headOf(was) && headOf(now).length > 400
    && now.length - was.length === UI.historyLink(HISTORY).length + UI.NOTEBOOK_OPEN.length + UI.TARGET_TAG.length + UI.NOTEBOOK_CLOSE.length, `${now.length} − ${was.length}`);
  assert("applying it twice changes nothing; an arch of § 57 comes back from dayArch57Of as it is", UI.dayArch58(now, HISTORY) === now && UI.dayArch58(now, 7) === now && UI.dayArch57Of(was) === was);
  const stops = (a: string, id: unknown = HISTORY) => { try { UI.dayArch58(a, id); return false; } catch { return true; } };
  assert("an arch that is not § 57's stops the script: § 56's (no class), one that already has a notebook, no tiles, no note under them, no settings link, another end", stops(s56) && stops("<form/>") && stops(was.replace("<sheet>", "<sheet><notebook><page/></notebook>"))
    && stops(was.replace(`name="utak_day_tiles"`, `name="tiles"`)) && stops(was.replace(`name="utak_approved_note"`, `name="note"`)) && stops(was.replace(`string="⚙️ الإعدادات"`, `string="الإعدادات"`)) && stops(`${was}\n`) && !stops(was));
  assert("…and so does a missing action of «📈 تاريخ الأسعار»: the link never opens nothing", stops(was, null) && stops(was, 0) && stops(was, "1046") && stops(was, -3));
  const taken = (a: string) => { try { UI.dayArch57Of(a); return false; } catch { return true; } };
  assert("taking § 58's parts off a form changed by hand stops too (a tab's field left behind)", taken(now.replace(`<page string="⭐ الأصناف" name="utak_items">`, `<page string="الأصناف" name="utak_items">`)) && !taken(now));
  assert("the arch is well formed XML", wellFormed(now) === "", wellFormed(now));

  const today = now.slice(at(`name="utak_today"`), at(`name="utak_money"`));
  assert("«📍 اليوم» holds everything the screen showed, in its order, with the target RIGHT UNDER the tiles: tiles, target, the note, the chart, the table, the day's details, «تقرير النشر»", inOrder(today, [`name="utak_day_tiles"`, `<field name="x_target_html" readonly="1" nolabel="1" class="mb-3"/>`, `name="utak_approved_note"`, `<field name="x_chart_html"`, `<field name="x_line_ids"`, `name="utak_day_details"`, `name="x_publish_report"`])
    && today.includes(`</div></div>\n      </div>\n    <field name="x_target_html"`) && today.includes(UI56.LINE_LIST) && today.includes(UI56.LINE_CARD) && /mode="list,kanban"/.test(today), today.slice(0, 120));
  assert("…and nothing of it is left outside that page", [`name="utak_day_tiles"`, `name="x_chart_html"`, `<field name="x_line_ids"`, `name="utak_day_details"`, `name="x_publish_report"`, `name="x_target_html"`].every((s) => now.split(s).length === 2 && at(s) > at(`name="utak_today"`) && at(s) < at(`name="utak_money"`)));
  assert("above the tabs, as they were: the stylesheet (one, first in the sheet), the links, the banners, the title, the state and the publication time", inOrder(now, ["<sheet>", "<style>", `name="utak_pricing_nav"`, `name="x_is_today"`, `<div class="oe_title"><h1>`, `name="utak_day_head"`, `invisible="not x_board_note"`, "<notebook"])
    && now.split("<style").length === 2 && now.includes(UI57.STYLE_TAG) && now.startsWith(UI57.FORM_OPEN));
  for (const [i, t] of UI.TABS.entries()) {
    const page = now.slice(at(`name="${t.name}"`), i + 1 < UI.TABS.length ? at(`name="${UI.TABS[i + 1].name}"`) : at("</notebook>"));
    assert(`«${t.title}» is ONE read-only HTML field (${t.field}) and the line that says how it is built, shown only while the field is empty`, (page.match(/<field /g) ?? []).length === 1 && page.includes(`<field name="${t.field}" readonly="1" nolabel="1"/>`)
      && page.includes(`<div class="text-muted" invisible="${t.field}">يُبنى مع أول حساب لليوم: اضغط «🔄 إعادة الحساب».</div>`) && now.split(`name="${t.field}"`).length === 2 && !/<button|<style|widget=/.test(page), page);
  }
  const nav = now.slice(at(`name="utak_pricing_nav"`), at(`name="x_is_today"`));
  assert("the link «📊 حلّل بنفسك» opens «📈 تاريخ الأسعار», last in the row, after the four links that were there", inOrder(nav, [`name="1009"`, `name="1037"`, `name="1041"`, `name="1027"`, `<button name="${HISTORY}" type="action" string="📊 حلّل بنفسك" class="btn btn-link px-2"/>`]) && (nav.match(/<button /g) ?? []).length === 5);
  assert("no button of the header and no field of § 57's screen changed its attributes (the tabs add no button that writes)", (now.match(/<button /g) ?? []).length === (was.match(/<button /g) ?? []).length + 1 && (now.match(/<field /g) ?? []).length === (was.match(/<field /g) ?? []).length + 4);
}

// ================================================================ [2] «📈 تاريخ الأسعار»
console.log("\n[2] «📈 تاريخ الأسعار»: Odoo's own graph and pivot on the real lines");
{
  const g = String(UI.HISTORY_GRAPH_ARCH), p = String(UI.HISTORY_PIVOT_ARCH);
  assert("the graph: lines over the days, one an item, the market price first — no custom JS", /^<graph string="📈 تاريخ الأسعار" type="line" stacked="0" sample="0">/.test(g) && inOrder(g, [`<field name="x_day_date" interval="day"/>`, `<field name="x_product_tmpl_id"/>`, `<field name="x_market_price" type="measure"/>`])
    && (g.match(/<field /g) ?? []).length === 3 && !/js_class|widget|<script/.test(g + p) && wellFormed(g) === "" && wellFormed(p) === "");
  assert("the pivot: an item a row, a day a column, and the five measures in the order's order — السوق، البيع، الشراء، الربح، المساهمة", inOrder(p, [`<field name="x_product_tmpl_id" type="row"/>`, `<field name="x_day_date" interval="day" type="col"/>`, ...["x_market_price", "x_sale_price", "x_cost_price", "x_real_profit", "x_contribution"].map((f) => `<field name="${f}" type="measure"/>`)])
    && (p.match(/type="measure"/g) ?? []).length === 5);
  assert("the measures are fields of the line on the tenant, and the contribution is the one § 58 created", UI.HISTORY_MEASURES.every(([f]: string[]) => SCHEMA.x_price_day_line.includes(f)) && UI.HISTORY_MEASURES[4][0] === OD.CONTRIBUTION_FIELD && OD.LINE_FIELDS[0].field_description === UI.HISTORY_MEASURES[4][1]
    && SCHEMA.x_price_day_line.includes(UI.HISTORY_DAY_FIELD) && SCHEMA.x_price_day_line.includes(UI.HISTORY_ITEM_FIELD));
  assert("the real lines alone: neither the line nor its day is a simulation's", UI.HISTORY_DOMAIN === "[('x_utak_simulation', '=', False), ('x_day_id.x_utak_simulation', '=', False)]" && SCHEMA.x_price_day_line.includes("x_utak_simulation") && SCHEMA.x_price_day.includes("x_utak_simulation"));
  assert("its menu sits under «💲 التسعير» between «📅 الأيام السابقة» (20) and «📥 عروض المصادر» (30): «📊 اليوم» stays the app's first screen", UI.PRICING_MENU === 582 && UI.HISTORY_MENU_SEQUENCE > 20 && UI.HISTORY_MENU_SEQUENCE < 30 && UI.HISTORY_TITLE === "📈 تاريخ الأسعار" && UI.HISTORY_BUTTON === "📊 حلّل بنفسك");
  const script = read("scripts/s58-20261005-day.mjs");
  assert("the script binds the action to its own two views (graph, then pivot), with the domain, and switches the menu off on a rollback (nothing is deleted without --drop)", script.includes(`view_mode: "graph,pivot,list", domain: HISTORY_DOMAIN`) && script.includes(`{ sequence: 1, view_mode: "graph", view_id: graphId }`) && script.includes(`{ sequence: 2, view_mode: "pivot", view_id: pivotId }`)
    && script.includes(`await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } })`) && script.includes("if (DROP) await dropCreated("));
}

// ================================================================ [3] «⚙️ الإعدادات»
console.log("\n[3] «⚙️ الإعدادات»: «هدف الربح اليومي» under «الكراتين المتوقعة يومياً»");
{
  const before = String(UI48.settingsForm(A));
  const after = String(UI.settingsArch58(before));
  assert("the field sits right under «الكراتين المتوقعة يومياً», and nothing else of the form changed", after.includes(`<field name="x_expected_cartons"/>\n        <field name="x_daily_profit_target"/>`) && UI.settingsArch57Of(after) === before && after.length - before.length === UI.PROFIT_TARGET_TAG.length && wellFormed(after) === "");
  assert("twice changes nothing; a form without «الكراتين المتوقعة يومياً» stops the script", UI.settingsArch58(after) === after && (() => { try { UI.settingsArch58("<form><sheet/></form>"); return false; } catch { return true; } })());
  assert("the field is the settings' own, named as the order names it, 0 by default (a float with no default is 0)", OD.PROFIT_TARGET_FIELD === "x_daily_profit_target" && OD.PROFIT_TARGET_LABEL === "هدف الربح اليومي (ريال)" && OD.CONFIG_FIELDS.length === 1 && OD.CONFIG_FIELDS[0].ttype === "float" && SCHEMA.x_pricing_config.includes("x_daily_profit_target"));
}

// ================================================================ [4] the fields
console.log("\n[4] the fields § 58 created are on the tenant, and the four HTML fields keep Odoo's sanitizer");
{
  assert("every field of the day, its line and the settings is in the tenant's schema", OD.DAY_FIELDS.every((f: any) => SCHEMA.x_price_day.includes(f.name)) && OD.LINE_FIELDS.every((f: any) => SCHEMA.x_price_day_line.includes(f.name)) && OD.DAY_FIELDS.length === 21,
    OD.DAY_FIELDS.filter((f: any) => !SCHEMA.x_price_day.includes(f.name)).map((f: any) => f.name).join(","));
  assert("the four HTML fields are the target and the three tabs, each sanitized exactly as § 56's chart (tags and attributes cleaned, the style attribute and the classes kept)", JSON.stringify(OD.HTML_FIELDS.map((f: any) => f.name)) === JSON.stringify(["x_target_html", "x_tab_money_html", "x_tab_items_html", "x_tab_next_html"])
    && JSON.stringify(UI.NEW_DAY_FIELDS) === JSON.stringify(OD.HTML_FIELDS.map((f: any) => f.name)) && OD.HTML_FIELDS.every((f: any) => f.ttype === "html" && UI56.SANITIZE_FLAGS.every((k: string) => f[k] === UI56.CHART_FIELD[k]))
    && UI56.CHART_FIELD.sanitize === true && UI56.CHART_FIELD.sanitize_tags === true && UI56.CHART_FIELD.sanitize_attributes === true && JSON.stringify(OD.SANITIZE_FLAGS) === JSON.stringify(UI56.SANITIZE_FLAGS));
  assert("the plan's basis has the two values the worker writes, as the tenant holds them", JSON.stringify(OD.PLAN_BASIS_OPTIONS.map((o: string[]) => o[0])) === JSON.stringify(["simple", "weighted"]) && JSON.stringify(SCHEMA._selections["x_price_day.x_plan_basis"]) === JSON.stringify(["simple", "weighted"]));
  assert("the plan (six), the actual (eleven) and the four HTML fields: each kind has its type", ["x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_profit_target", "x_target_cartons", "x_act_cartons", "x_act_margin", "x_act_waste", "x_act_cost", "x_act_profit", "x_var_volume", "x_var_margin", "x_var_waste", "x_var_cost"]
    .every((n) => OD.DAY_FIELDS.find((f: any) => f.name === n)?.ttype === "float") && OD.DAY_FIELDS.find((f: any) => f.name === "x_act_waste_real")?.ttype === "boolean" && OD.DAY_FIELDS.find((f: any) => f.name === "x_act_at")?.ttype === "datetime");
}

// ================================================================ [5] the older checks read the screen after § 58
console.log("\n[5] the checks of § 48, § 56 and § 57 read the screen after § 58");
{
  const v57 = read("scripts/s57-20261005-day.mjs"), v56 = read("scripts/s56-20261005-odoo.mjs"), v48 = read("scripts/s48-20261001-ui.mjs");
  assert("§ 57's and § 56's verify compare the form with § 58's parts taken off", v57.includes(`import { dayArch57Of } from "./lib/s58-ui.mjs";`) && v57.includes("dayArch57Of(v.arch_db) === dayArch57(was.arch)")
    && v56.includes(`import { dayArch57Of } from "./lib/s58-ui.mjs";`) && v56.includes("dayArch57Of(v.arch_db) === dayArch57(dayArch(was.arch))"));
  assert("§ 48's verify expects «📈 تاريخ الأسعار» after «📅 الأيام السابقة», and its own five screens where they were", v48.includes(`import { HISTORY_ACTION, HISTORY_TITLE } from "./lib/s58-ui.mjs";`) && v48.includes("[MENU.days, `ir.actions.act_window,${a.days}`], [HISTORY_TITLE, `ir.actions.act_window,${history}`], [MENU.sources,"));
}

done();
