// § 49 هـ (2026-10-01) — the item's full name first, never cut, its UTAK-… code under it (a card) or in
// a hidden column of its own (a table): the archs § 49 writes over § 48's screens («📊 اليوم», the day
// opened from «📅 الأيام السابقة» and its «📈 ربح الأصناف عبر الأيام» list, «📥 عروض المصادر»), the
// roles block of د on the settings and the sources screens, and the Python Odoo runs for the name.
//
// No Odoo, no network: scripts/lib/s48-ui.mjs changed by scripts/lib/s49-ui.mjs, and python3.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s49-ui.test.mts

import { execFileSync } from "node:child_process";
import { quiet, rows, table } from "./wa-harness.mts";
import { DAY, assert, cost, done, dp, fresh, market } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");

// @ts-ignore — plain .mjs helpers
const UI48 = await import("../scripts/lib/s48-ui.mjs");
// @ts-ignore
const UI = await import("../scripts/lib/s49-ui.mjs");

// ================================================================ [هـ] the item's full name
console.log("\n[هـ] the item's full name first, never cut, its code under it or hidden (the archs § 49 writes)");
{
  const A = { refresh: 1, confirm: 2, unapprove: 3, approve: 4, prev: 5, next: 6, openDay: 7, openSources: 8, days: 9, products: 10, settings: 11, purchaseList: 12, marketList: 13, packagings: 14, profitGraph: 15 };
  const W = { sourcePartners: 21, sourceEmployees: 22 };
  const day = UI.dayArch(UI48.dayForm(A));
  const list = /<list[^>]*editable="bottom"[\s\S]*?<\/list>/.exec(day)![0];
  const shown = [...list.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].filter((m) => !/column_invisible/.test(m[2])).map((m) => m[1]);
  assert("«📊 اليوم», the table: the first column is the full name (a text field: it wraps, never cut)", shown[0] === "x_item_show" && UI.LINE_FIELDS.find((f: any) => f.name === "x_item_show").ttype === "text");
  assert("…the code is a column of its own, hidden unless switched on; the «[UTAK-…] name» and the packaging columns are gone", /name="x_item_code"[^>]*optional="hide"/.test(list) && !/x_product_tmpl_id|x_packaging_id/.test(list));
  assert("…every other column as § 48 left it, in its order", shown.slice(1).filter((c) => c !== "x_item_code").join() === "x_cost_show,x_supplier_id,x_market_show,x_market_count,x_even_show,x_suggested_show,x_sale_show,x_profit_show,x_board_status,x_status,x_reason,x_decision,x_manual_price,x_offers", shown.join());
  const card = /<kanban[\s\S]*?<\/kanban>/.exec(day)![0];
  assert("…the phone's card: the full name first in bold, the code under it in small text, before every number", /name="x_item_show" class="fw-bold fs-5"/.test(card) && /<div class="small text-muted"[^>]*><field name="x_item_code"\/><\/div>/.test(card) && card.indexOf("x_item_show") < card.indexOf("x_item_code") && card.indexOf("x_item_code") < card.indexOf("x_cost_show") && !/name="x_name"/.test(card));
  assert("…applying it twice changes nothing; an arch that is not § 48's stops the script", UI.dayArch(day) === day && (() => { try { UI.dayArch("<form/>"); return false; } catch { return true; } })());
  const src = UI.sourcesArch(UI48.sourcesForm(A), W);
  const firsts = [...src.matchAll(/<list[^>]*>([\s\S]*?)<\/list>/g)].map((m) => /<field name="(\w+)"/.exec(m[1])![1]);
  assert("«📥 عروض المصادر»: the full name first in the purchase and the market tabs, then the source", firsts[0] === "x_item_show" && firsts[1] === "x_item_show" && src.indexOf('name="x_item_show"') < src.indexOf('name="x_supplier_id"'), firsts.join());
  assert("…and the roles: the line, the rule, and the two lists the role is edited in", src.includes('name="x_sources_note"') && src.includes('name="21"') && src.includes('name="22"') && src.includes(UI.ROLES_RULE) && UI.sourcesArch(src, W) === src);
  const set = UI.settingsArch(UI48.settingsForm(A), W);
  assert("«⚙️ الإعدادات»: the roles block before the operating costs; «الحد الأدنى للطلب» still there", set.includes('name="x_sources_note"') && set.indexOf("utak_source_roles") < set.indexOf("x_cost_line_ids") && set.includes('name="x_min_order_sar"') && UI.settingsArch(set, W) === set);
  const noteOf = (arch: string) => /<div class="alert alert-info mb-1" role="status">[\s\S]*?<\/div><\/div>/.exec(arch)?.[0] ?? "";
  assert("…the links to the two lists sit UNDER the light-blue note, never inside it (a link on it measured 3.93:1)", noteOf(set).includes(UI.ROLES_RULE) && !/<button/.test(noteOf(set)) && !/<button/.test(noteOf(src)) && /<\/div><\/div>\s*<button name="21"/.test(set));
  assert("…a block of the first shape (links inside the note) is replaced, not doubled", (() => { const first = set.replace(noteOf(set), "").replace(/<div name="utak_source_roles" class="mb-2">[\s\S]*?<\/div>/, `<div class="alert alert-info" role="status" name="utak_source_roles">\n      <strong>دور الأسعار:</strong> <field name="x_sources_note"/>\n      <div><button name="21" type="action"/></div>\n      <div>${UI.ROLES_RULE}</div>\n    </div>`); const again = UI.settingsArch(first, W); return again.split('name="x_sources_note"').length === 2 && !/<button/.test(noteOf(again)) && noteOf(again).length > 0; })());
  assert("the lists of their own (ردود الشراء / مشاهدات السوق): the full name first", /^<list[^>]*>\s*<field name="x_item_show"/.test(UI.purchaseListArch(UI48.PURCHASE_LIST)) && /^<list[^>]*>\s*<field name="x_item_show"/.test(UI.marketListArch(UI48.MARKET_LIST)));
  const board = `<list string="لوحة التسعير" create="0">\n  <field name="x_day_date" optional="show"/>\n  <field name="x_product_tmpl_id" string="الصنف"/>\n  <field name="x_packaging_id" string="التعبئة"/>\n  <field name="x_cost_price" string="الشراء"/>\n</list>`;
  const board49 = UI.boardListArch(board);
  assert("«📅 الأيام السابقة» ← «📈 ربح الأصناف عبر الأيام», its list: the full name in the place of «[UTAK-…] name» and the packaging", /<field name="x_day_date"[^>]*\/>\s*<field name="x_item_show" string="الصنف"\/>\s*<field name="x_item_code" string="الرمز" optional="hide"\/>\s*<field name="x_cost_price"/.test(board49) && !/x_product_tmpl_id|x_packaging_id/.test(board49) && UI.boardListArch(board49) === board49, board49);
  assert("the role is edited in the row of both lists, and shown on the source's own card only for a source", /editable="bottom"/.test(UI.SOURCE_PARTNERS_LIST) && /name="x_price_role"/.test(UI.SOURCE_EMPLOYEES_LIST) && /invisible="not x_price_source"/.test(UI.CARD_ROLE));
}
{
  // the Python Odoo runs for «الصنف»: the product's own name (no code in it) and the packaging's, whole
  const PY = `
import json, sys
class R(dict):
    __getattr__ = lambda s, k: s.get(k)
    def __setitem__(s, k, v): dict.__setitem__(s, k, v)
code, cases = sys.argv[1], json.loads(sys.argv[2])
recs = [R(x_product_tmpl_id=R(name=c[0]), x_packaging_id=R(x_name=c[1])) for c in cases]
exec(code, {"self": recs})
print(json.dumps([r["x_item_show"] for r in recs], ensure_ascii=False))`;
  const long = "طماطم شيري كرزية درجة أولى مستوردة من هولندا";
  const out = JSON.parse(execFileSync("python3", ["-c", PY, UI.ITEM_SHOW_CODE, JSON.stringify([["رمان كبير", "كرتون"], [long, "كرتون · 14 كيلو"], ["موز أمريكي", null], [null, null]])], { encoding: "utf8" }));
  assert("«رمان كبير — كرتون»; a long name whole (no «…»); a name without a packaging; nothing → «—»", out[0] === "رمان كبير — كرتون" && out[1] === `${long} — كرتون · 14 كيلو` && out[2] === "موز أمريكي" && out[3] === "—", JSON.stringify(out));
  assert("the code is the product's own reference (a related field), never part of the name", UI.LINE_FIELDS.find((f: any) => f.name === "x_item_code").related === "x_product_tmpl_id.default_code");
}

done();
