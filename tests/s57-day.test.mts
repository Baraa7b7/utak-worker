// § 57 أ (2026-10-05) — «💲 التسعير» ← «📊 اليوم» as Baraa sees it in Odoo itself
// (scripts/lib/s57-ui.mjs): the form's own class and stylesheet, and the average's label.
//
//   [1] the arch: § 56's with the class on the form, ONE stylesheet first in the sheet and the tile's
//       label — the header (the buttons), the links, the body's fields and «تقرير النشر» untouched;
//       twice changes nothing; an arch that is not § 56's stops the script
//   [2] the stylesheet: every rule under the form's own class (no other form is touched); the whole
//       width; a table that wraps and clips nothing; «(+2.43)» under its price; room under the last line
//   [3] «متوسط ربح الكرتون (المنشور)» wherever it shows: the tile, the fields' labels, the guide
//   [4] the checks of § 48 and § 56 read the screen after § 57
//
// No Odoo, no network, no send: the arch is text.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-day.test.mts

import { readFileSync } from "node:fs";
import { assert, done } from "./s46-kit.mts";

// @ts-ignore — plain .mjs helpers
const UI = await import("../scripts/lib/s57-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI56 = await import("../scripts/lib/s56-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI48 = await import("../scripts/lib/s48-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI49 = await import("../scripts/lib/s49-ui.mjs");
// @ts-ignore — plain .mjs helpers
const UI54 = await import("../scripts/lib/s54-odoo.mjs");

const A = { refresh: 1004, confirm: 1038, unapprove: 1003, approve: 1002, prev: 1033, next: 1034, openDay: 1032, openSources: 1037, days: 1009, products: 1041, settings: 1027, purchaseList: 1039, marketList: 1040, packagings: 1042, profitGraph: 1043 };
const note = UI54.NOTES.find((n: string[]) => n[0] === UI56.VIEW_DAY);
const s54 = String(UI54.noteArch(String(UI49.dayArch(UI48.dayForm(A))), note[1], note[2]));
const was = String(UI56.dayArch(s54));          // what the tenant carried before § 57: § 56's screen
const now = String(UI.dayArch57(was));
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ================================================================ [1] the arch
{
  const headOf = (a: string) => /<header>[\s\S]*?<\/header>/.exec(a)?.[0] ?? "";
  const style = /<style>[\s\S]*?<\/style>/.exec(now)?.[0] ?? "";
  assert("the form carries its own class, and nothing else of its opening tag changed", now.startsWith(`<form string="📊 اليوم" create="0" delete="0" class="utak_day_form">`) && was.startsWith(`<form string="📊 اليوم" create="0" delete="0">`) && UI.FORM_CLASS === "utak_day_form", now.slice(0, 90));
  assert("ONE stylesheet, the first thing in the day's own sheet (before the title and the tiles), and none in the line's form", now.split("<style").length === 2 && now.indexOf("<sheet>") + "<sheet>".length + 5 === now.indexOf("<style>") && now.indexOf("</style>") < now.indexOf(`<div class="oe_title"><h1>`) && style === UI.STYLE_TAG
    && !/<style/.test(/<form string="تفاصيل الصنف">[\s\S]*?<\/form>/.exec(now)![0]), String(now.indexOf("<style>")));
  assert("without the class, the stylesheet and the label it is § 56's arch byte for byte: the header (the buttons), the links, the banners, every field of the body, «تقرير النشر»",
    now.replace(` class="utak_day_form"`, "").replace(`\n    ${UI.STYLE_TAG}`, "").replace(UI.TILE, `<div>${UI.AVG_LABEL_56}</div>`) === was && headOf(now) === headOf(was) && headOf(now).length > 400 && now.length - was.length === ` class="utak_day_form"`.length + UI.STYLE_TAG.length + 5 + " (المنشور)".length);
  assert("applying it twice changes nothing", UI.dayArch57(now) === now);
  const stops = (a: string) => { try { UI.dayArch57(a); return false; } catch { return true; } };
  assert("an arch that is not § 56's stops the script: the screen of before § 56, a form that already carries a stylesheet or a chatter, a tile that is not there, a second form tag", stops(s54) && stops("<form/>") && stops(was.replace("<sheet>", "<sheet><style>a{}</style>")) && stops(was.replace("</sheet>\n</form>", "</sheet><chatter/>\n</form>"))
    && stops(was.replace(`<div>${UI.AVG_LABEL_56}</div>`, "<div>متوسط</div>")) && stops(`<data>${was}</data>`) && !stops(was));
  const wellFormed = (xml: string): string => {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([\w-]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
      if (m[4]) continue;
      if (!m[1]) stack.push(m[2]);
      else if (stack.pop() !== m[2]) return `</${m[2]}> closes nothing`;
    }
    const left = xml.replace(/<\/?[\w-]+(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g, "");
    return stack.length ? `<${stack.join("> <")}> left open` : left.includes("<") ? `a stray «<»: ${left.slice(left.indexOf("<"), left.indexOf("<") + 60)}` : left.includes("&") && /&(?!gt;|lt;|amp;|quot;)/.test(left) ? "a bare «&»" : "";
  };
  assert("the arch is well formed XML, and the stylesheet's text holds no «<», no «>» and no «&»", wellFormed(now) === "" && !/[<>&]/.test(UI.DAY_STYLE), wellFormed(now));
  assert("the table is still § 56's nine read-only columns and a phone still gets its cards", now.includes(UI56.LINE_LIST) && now.includes(UI56.LINE_CARD) && /mode="list,kanban"/.test(now) && UI56.COLUMNS.length === 9);
}

// ================================================================ [2] the stylesheet
{
  const css = String(UI.DAY_STYLE);
  const rules = css.split("\n").map((r) => r.trim()).filter(Boolean);
  const selectors = rules.flatMap((r) => r.replace(/^@media \(min-width: 768px\) \{ /, "").split("{")[0].split(",").map((s) => s.trim()));
  assert("six rules, every selector under the form's own class — no other form, not even the line's dialog, is touched", rules.length === 6 && selectors.length === 9 && selectors.every((s) => s.startsWith(".utak_day_form ")), JSON.stringify(selectors));
  assert("the whole width: no max-width on the renderer (Odoo's 2600px) and on the sheet's background (Odoo's 1400px)", rules[0] === ".utak_day_form .o_form_renderer, .utak_day_form .o_form_sheet_bg { max-width: none !important; }", rules[0]);
  assert("room under the last line as high as the chat bubbles can stack (440 px), on a wide screen only: a phone's cards get none", rules[1] === "@media (min-width: 768px) { .utak_day_form .o_form_sheet { padding-bottom: 440px !important; } }" && UI.BOTTOM_ROOM_PX === 440 && UI.BOTTOM_ROOM_PX >= 8 * 52 + 10, rules[1]);
  const T = `.utak_day_form .o_field_widget[name="x_line_ids"] .o_list_table`;
  assert("the table of the day's lines alone: the browser's own column widths (not Odoo's fixed ones), the whole width", rules[2] === `${T} { table-layout: auto !important; width: 100% !important; }`, rules[2]);
  assert("every cell and every heading wraps and clips nothing: no nowrap, no hidden overflow, no «…»", rules[3] === `${T} th, ${T} td.o_data_cell { width: auto !important; max-width: none !important; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; vertical-align: top; }`
    && rules[4] === `${T} th .text-truncate { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }`, `${rules[3]} / ${rules[4]}`);
  assert("«المقترح (وربحه)»: the column as narrow as its longest word, so «(+2.43)» sits under its price in the same cell — the heading and the cell both", rules[5] === `${T} th[data-name="x_suggested_profit_show"], ${T} td[name="x_suggested_profit_show"] { width: 1px !important; }` && UI.TWO_LINE_COLUMN === "x_suggested_profit_show"
    && UI56.COLUMNS.some((c: string[]) => c[0] === UI.TWO_LINE_COLUMN && c[1] === "المقترح (وربحه)"), rules[5]);
  assert("nothing of it hides, colours or moves anything: widths, wrapping and one padding only", !/display|visibility|color|position|float|margin|font|z-index|url\(|@import|expression/i.test(css.replace(/text-overflow/g, "")), css);
}

// ================================================================ [3] the label
{
  assert("the tile says «متوسط ربح الكرتون (المنشور)», once — the three coloured numbers above it are the same field", now.split("<div>متوسط ربح الكرتون (المنشور)</div>").length === 2 && !now.includes("<div>متوسط ربح الكرتون</div>") && (now.match(/<field name="x_avg_profit_show"/g) ?? []).length === 3 && UI.AVG_LABEL === "متوسط ربح الكرتون (المنشور)");
  assert("the two fields' own labels follow", JSON.stringify(UI.FIELD_LABELS) === JSON.stringify({ x_avg_profit: "متوسط ربح الكرتون (المنشور) — رقم", x_avg_profit_show: "متوسط ربح الكرتون (المنشور)" }) && UI56.DAY_FIELDS.filter((f: any) => f.name in UI.FIELD_LABELS).length === 2);
  const guide = read("docs/OPERATING-DAY.md");
  assert("OPERATING-DAY names it as the screen does, and nowhere without «(المنشور)»", guide.includes("«متوسط ربح الكرتون (المنشور)»") && !/متوسط ربح الكرتون(?! \(المنشور\))/.test(guide), String(guide.match(/متوسط ربح الكرتون(?! \(المنشور\))[^\n]{0,40}/)?.[0]));
  assert("OPERATING-DAY: the screen takes the whole width, «(+2.43)» sits under its price, and the room under the last line is for the chat bubbles", /تملأ عرض الشاشة كله/.test(guide) && /تحت السعر في الخانة نفسها/.test(guide) && /فقاعات المحادثات/.test(guide));
}

// ================================================================ [4] the older checks read the screen after § 57
{
  const s56 = read("scripts/s56-20261005-odoo.mjs"), s48 = read("scripts/s48-20261001-ui.mjs"), shots = read("scripts/s56-20261005-shots.mts");
  assert("§ 56's verify compares the form with § 56's arch carried through § 57, and the two labels with § 57's", s56.includes(`import { FIELD_LABELS, dayArch57 } from "./lib/s57-ui.mjs";`) && s56.includes("v.arch_db === dayArch57(dayArch(was.arch))") && s56.includes("(FIELD_LABELS[d.name] ?? d.field_description)"));
  assert("§ 48's verify reads the day's table through § 57 (the class and the stylesheet are not a change of its columns)", s48.includes(`from "./lib/s57-ui.mjs"`) && s48.includes("FORM_CLASS"));
  assert("the drawn pictures follow: the form's class, its stylesheet and the cell names Odoo gives a list, and § 57's label", shots.includes(`await import("./lib/s57-ui.mjs")`) && shots.includes("UI57.DAY_STYLE") && shots.includes("UI57.FORM_CLASS") && shots.includes("UI57.TILE") && shots.includes('data-name="${c.name}"') && shots.includes('name="${c.name}"'));
}

done();
