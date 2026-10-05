// Mutation check for § 57 (2026-10-05). Each mutation disables ONE guard, runs its test file, and must
// make it fail. The source is restored in `finally` after every run; a pattern that is not found
// exactly once stops the script.
//
//   أ  «📊 اليوم» as Baraa sees it in Odoo: the form's own class and stylesheet (the whole width, a
//      table that wraps and clips nothing, «(+2.43)» under its price, room under the last line) and
//      «متوسط ربح الكرتون (المنشور)» — scripts/lib/s57-ui.mjs, tests/s57-day.test.mts
//
//   ج  the bank journal BNK1 and «كشف البنك الأسبوعي» — scripts/s57-20261005-bank.mjs, tests/s57-bank.test.mts
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits the source in place, so it never runs in the working tree.
//
//   node scripts/mutation/s57-20261005-mutations.mjs [أ …]     (no argument: every part)
//
// Out: scripts/artifacts/s57-20261005-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TD = "tests/s57-day.test.mts";
const UI = "scripts/lib/s57-ui.mjs";
const GUIDE = "docs/OPERATING-DAY.md";
const TB = "tests/s57-bank.test.mts";
const BANK = "scripts/s57-20261005-bank.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the day's screen in Odoo itself
  ["أ", "the form does not carry its own class (the stylesheet matches nothing)", [[UI,
    "export const FORM_OPEN = `<form string=\"📊 اليوم\" create=\"0\" delete=\"0\" class=\"${FORM_CLASS}\">`;", "export const FORM_OPEN = `<form string=\"📊 اليوم\" create=\"0\" delete=\"0\">`;"]], TD],
  ["أ", "the stylesheet is not written into the arch", [[UI,
    "}\\n    ${STYLE_TAG}${arch.slice(at)}`.replace(TILE_56, TILE);", "}${arch.slice(at)}`.replace(TILE_56, TILE);"]], TD],
  ["أ", "the stylesheet lands in the line's own form (the second sheet)", [[UI,
    "  const sheet = arch.indexOf(SHEET_OPEN);", "  const sheet = arch.lastIndexOf(SHEET_OPEN);"]], TD],
  ["أ", "the rules are written for every form of Odoo, not under this form's class", [[UI,
    "const FORM = `.${FORM_CLASS}`;", "const FORM = `.o_form_view`;"]], TD],
  ["أ", "the sheet keeps Odoo's 1400 px (the left half stays empty)", [[UI,
    "`${FORM} .o_form_renderer, ${FORM} .o_form_sheet_bg { max-width: none !important; }`,", "`${FORM} .o_form_renderer { max-width: none !important; }`,"]], TD],
  ["أ", "the table keeps Odoo's fixed column widths", [[UI,
    "`${TABLE} { table-layout: auto !important; width: 100% !important; }`,", "`${TABLE} { width: 100% !important; }`,"]], TD],
  ["أ", "a cell still does not wrap (it ends in «…»)", [[UI,
    "white-space: normal !important; overflow: visible !important; text-overflow: clip !important; vertical-align: top; }`,", "overflow: visible !important; text-overflow: clip !important; vertical-align: top; }`,"]], TD],
  ["أ", "a heading is still cut", [[UI,
    "  `${TABLE} th .text-truncate { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }`,\n", ""]], TD],
  ["أ", "«(+2.43)» stays beside its price (the column is not narrowed)", [[UI,
    "  `${TABLE} th[data-name=\"${TWO_LINE_COLUMN}\"], ${TABLE} td[name=\"${TWO_LINE_COLUMN}\"] { width: 1px !important; }`,\n", ""]], TD],
  ["أ", "the narrowed column is «فرق المقترح عن السوق»", [[UI,
    "export const TWO_LINE_COLUMN = \"x_suggested_profit_show\";", "export const TWO_LINE_COLUMN = \"x_gap_show\";"]], TD],
  ["أ", "no room under the last line (the chat bubbles cover it)", [[UI,
    "  `@media (min-width: 768px) { ${FORM} .o_form_sheet { padding-bottom: ${BOTTOM_ROOM_PX}px !important; } }`,\n", ""]], TD],
  ["أ", "the room under the last line is lower than the bubbles can stack", [[UI,
    "export const BOTTOM_ROOM_PX = 440;", "export const BOTTOM_ROOM_PX = 120;"]], TD],
  ["أ", "the room is added on a phone too (under its cards)", [[UI,
    "`@media (min-width: 768px) { ${FORM} .o_form_sheet { padding-bottom: ${BOTTOM_ROOM_PX}px !important; } }`,", "`${FORM} .o_form_sheet { padding-bottom: ${BOTTOM_ROOM_PX}px !important; }`,"]], TD],
  ["أ", "the tile still says «متوسط ربح الكرتون»", [[UI,
    "export const TILE = `<div>${AVG_LABEL}</div>`;", "export const TILE = `<div>${AVG_LABEL_56}</div>`;"]], TD],
  ["أ", "the label does not say «(المنشور)»", [[UI,
    "export const AVG_LABEL = \"متوسط ربح الكرتون (المنشور)\";", "export const AVG_LABEL = \"متوسط ربح الكرتون (للنشر)\";"]], TD],
  ["أ", "the number's own field keeps its old label", [[UI,
    "export const FIELD_LABELS = { x_avg_profit: `${AVG_LABEL} — رقم`, x_avg_profit_show: AVG_LABEL };", "export const FIELD_LABELS = { x_avg_profit_show: AVG_LABEL };"]], TD],
  ["أ", "an arch that already carries a stylesheet or a chatter is rewritten all the same", [[UI,
    " || arch.includes(\"<style\") || /<chatter|oe_chatter|message_ids/.test(arch)) {", ") {"]], TD],
  ["أ", "an arch without § 56's tile (the screen of before § 56) is rewritten all the same", [[UI,
    " || !once(arch, TILE_56) || sheet < arch.indexOf(\"</header>\")", " || sheet < arch.indexOf(\"</header>\")"]], TD],
  ["أ", "the guide names the average without «(المنشور)»", [[GUIDE,
    "     - **«متوسط ربح الكرتون (المنشور)»:** متوسط «ربحنا»", "     - **«متوسط ربح الكرتون»:** متوسط «ربحنا»"]], TD],
  ["أ", "the guide does not say the screen takes the whole width", [[GUIDE,
    "الشاشة **تملأ عرض الشاشة كله**", "الشاشة كما كانت"]], TD],
  // ---------------------------------------------------------------- ج the bank journal and the weekly statement
  ["ج", "the bank's source is set to the online synchronisation", [[BANK,
    "const SOURCE = \"file_import\";", "const SOURCE = \"online_sync\";"]], TB],
  ["ج", "a source someone else set is overwritten", [[BANK,
    "else if (j.bank_statements_source !== \"undefined\") throw new Error(", "else if (false) throw new Error("]], TB],
  ["ج", "the journal is written before its value is kept for the rollback", [[BANK,
    "    rb.before.journal ??= { id: BNK1, bank_statements_source: j.bank_statements_source }; save();\n", ""]], TB],
  ["ج", "the script writes another journal", [[BANK,
    "export const BNK1 = 13;", "export const BNK1 = 19;"]], TB],
  ["ج", "the guide sends the upload to the journal's settings, not to the bank's card", [[GUIDE,
    "**المحاسبة ← لوحة المحاسبة ← بطاقة Bank ← «رفع»**", "**المحاسبة ← الإعدادات ← اليوميات**"]], TB],
  ["ج", "the guide does not say the amount is not counted twice", [[GUIDE,
    "**المبلغ لا يُحسب مرتين:** رصيد البنك (101001) يتحرك مرة واحدة، من الكشف.", ""]], TB],
  ["ج", "the guide does not say the first statement starts on the day the account was opened", [[GUIDE,
    "**أول كشف يبدأ من يوم فتح الحساب**، و", ""]], TB],
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
writeFileSync(new URL("../artifacts/s57-20261005-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
