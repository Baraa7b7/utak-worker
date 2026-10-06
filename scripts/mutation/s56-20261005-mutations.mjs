// Mutation check for § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم» made plain: the table's cells and the
// header's four numbers (the review's own numbers), the chart («سعرنا مقابل السوق», «ربح الكرتون»), what
// the engine writes of them, and the screen's arch. Each mutation disables ONE guard, runs
// tests/s56.test.mts, and must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s56-20261005-mutations.mjs [أ …]     (no argument: every part)
//
// Out: scripts/artifacts/s56-20261005-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s56.test.mts";
const DS = "src/day-screen.ts";
const PR = "src/prices.ts";
const LIB = "scripts/lib/s56-ui.mjs";
const GUIDE = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the table's cells
  ["أ", "«الشراء شامل» is the purchase price without the VAT", [[DS,
    "Math.round(Math.round(purchase * PURCHASE_VAT_FACTOR * 1e6) / 1e4) / 100 : 0;", "Math.round(Math.round(purchase * 1e6) / 1e4) / 100 : 0;"]], T],
  ["أ", "«الشراء شامل» loses a halala (12.50 → 14.37)", [[DS,
    "Math.round(Math.round(purchase * PURCHASE_VAT_FACTOR * 1e6) / 1e4) / 100 : 0;", "Math.round(purchase * PURCHASE_VAT_FACTOR * 100) / 100 : 0;"]], T],
  ["أ", "a price is written with one decimal", [[DS,
    "export const fixed2 = (x: number): string => round2(x).toFixed(2);", "export const fixed2 = (x: number): string => round2(x).toFixed(1);"]], T],
  ["أ", "«ربحنا بسعر السوق» is made at the market price before its uplift", [[DS,
    "  const marketProfit = r.sale > 0 ? profitAt(r, r.sale) : null;", "  const marketProfit = r.market > 0 ? profitAt(r, r.market) : null;"]], T],
  ["أ", "«ربحنا بسعر السوق» is the profit at the suggested price", [[DS,
    "  const marketProfit = r.sale > 0 ? profitAt(r, r.sale) : null;", "  const marketProfit = r.sale > 0 ? profitAt(r, r.suggested) : null;"]], T],
  ["أ", "the suggested price is shown without its profit", [[DS,
    "${row.suggestedProfit === null ? \"\" : ` (${profitText(row.suggestedProfit, row)})`}", "${\"\"}"]], T],
  ["أ", "the gap is the market price minus the suggested one (its sign turned)", [[DS,
    "? round2(r.suggested - r.market) : null;", "? round2(r.market - r.suggested) : null;"]], T],
  ["أ", "the gap's percent is taken of the suggested price", [[DS,
    "gapPct: gap === null ? null : (gap / r.market) * 100,", "gapPct: gap === null ? null : (gap / r.suggested) * 100,"]], T],
  ["أ", "the gap is shown without its percent", [[DS,
    "ltr(`${signed(row.gap)} (${signedPct(row.gapPct)})`),", "ltr(`${signed(row.gap)}`),"]], T],
  ["أ", "a signed cell has no left-to-right mark (its sign jumps to the right in Odoo)", [[DS,
    "const ltr = (s: string): string => `${LTR_MARK}${s}`;", "const ltr = (s: string): string => s;"]], T],
  ["أ", "a missing value is written 0.00", [[DS,
    "x_market_profit_show: row.marketProfit === null ? NONE : ltr(profitText(row.marketProfit, row)),", "x_market_profit_show: ltr(profitText(row.marketProfit ?? 0, row)),"]], T],
  ["أ", "the number that colours «ربحنا بسعر السوق» is always positive", [[DS,
    "    x_market_profit: row.marketProfit ?? 0,", "    x_market_profit: Math.abs(row.marketProfit ?? 0),"]], T],
  // ---------------------------------------------------------------- أ «القرار»
  ["أ", "an outlier still waiting does not open with ⚠️", [[DS,
    "  const mark = warn ? \"⚠️\" : !publish ? \"❌\"", "  const mark = false ? \"⚠️\" : !publish ? \"❌\""]], T],
  ["أ", "a line that is not published opens with ✅", [[DS,
    "  const mark = warn ? \"⚠️\" : !publish ? \"❌\"", "  const mark = warn ? \"⚠️\" : false ? \"❌\""]], T],
  ["أ", "a price with no profit is marked ✅", [[DS,
    ": outProfit === null || outProfit > 0 ? \"✅\" : \"🔻\";", ": true ? \"✅\" : \"🔻\";"]], T],
  ["أ", "a line waiting for Baraa reads «معتمد»", [[DS,
    "${approved ? \"معتمد\" : \"ينتظر قرارك\"}", "${true ? \"معتمد\" : \"ينتظر قرارك\"}"]], T],
  ["أ", "Baraa's own decision is not named as his", [[DS,
    "    : r.decision ? `${mark} قرارك: ${what}`", "    : false ? `${mark} قرارك: ${what}`"]], T],
  ["أ", "a published day still reads the proposal, not what its lines store", [[DS,
    "  const publish = locked ? stored : o.kind !== \"skip\";", "  const publish = o.kind !== \"skip\";"]], T],
  ["أ", "a day published before the engine reads «لم يُنشر» on every line", [[DS,
    "  const stored = isPublishable(l) || (locked && !l.x_status && !l.x_excluded && Number(l.x_sale_price) > 0);", "  const stored = isPublishable(l);"]], T],
  ["أ", "a line without a status counts as approved on an open day too", [[DS,
    "(locked && !l.x_status && !l.x_excluded && Number(l.x_sale_price) > 0);", "(!l.x_status && !l.x_excluded && Number(l.x_sale_price) > 0);"]], T],
  ["أ", "a line left out of a day published before the engine reads «نُشر»", [[DS,
    "(locked && !l.x_status && !l.x_excluded && Number(l.x_sale_price) > 0);", "(locked && !l.x_status && Number(l.x_sale_price) >= 0);"]], T],
  ["أ", "a published line reads «يُنشر», not «نُشر»", [[DS,
    "${state === \"published\" ? \"نُشر\" : \"يُنشر\"}", "${state !== \"published\" ? \"نُشر\" : \"يُنشر\"}"]], T],
  ["أ", "a published day still counts an outlier as waiting", [[DS,
    "  const warn = !locked && isWarned(r);", "  const warn = isWarned(r);"]], T],
  ["أ", "his own price is called «بسعر السوق»", [[DS,
    "    : o.kind === \"edit\" ? \"own\" : o.kind === \"profit\" ? \"suggested\" : \"market\";", "    : o.kind === \"profit\" ? \"suggested\" : \"market\";"]], T],
  ["أ", "a row that is not published shows its profit at the suggested price", [[DS,
    "  const base: ProfitBase | null = publish ? outBase : r.sale > 0 ? \"market\" : r.suggested > 0 ? \"suggested\" : null;", "  const base: ProfitBase | null = publish ? outBase : r.suggested > 0 ? \"suggested\" : null;"]], T],
  ["أ", "an item out of the active catalog keeps a decision's text", [[DS,
    "x_gap_show: NONE, x_outcome_show: OUT_OF_CATALOG_TEXT, x_contribution };", "x_gap_show: NONE, x_outcome_show: \"❌ لا تنشر\", x_contribution };"]], T],
  // ---------------------------------------------------------------- أ the header
  ["أ", "«لا تنشر» counts every item", [[DS,
    "x_n_skip: rows.length - publish,", "x_n_skip: rows.length,"]], T],
  ["أ", "«⚠️» is never counted", [[DS,
    "x_n_warn: rows.filter((r) => r.warn).length,", "x_n_warn: 0,"]], T],
  ["أ", "the average takes the items that are not published too", [[DS,
    "rows.filter((r) => r.publish && r.profit !== null)", "rows.filter((r) => r.profit !== null)"]], T],
  ["أ", "the average is a sum", [[DS,
    "round2(profits.reduce((a, b) => a + b, 0) / profits.length) : null;", "round2(profits.reduce((a, b) => a + b, 0)) : null;"]], T],
  ["أ", "no item to publish: the average reads 0.00", [[DS,
    "x_avg_profit_show: avg === null ? NONE : ltr(signed(avg)),", "x_avg_profit_show: ltr(signed(avg ?? 0)),"]], T],
  // ---------------------------------------------------------------- ب «سعرنا مقابل السوق»
  ["ب", "the chart has no key", [[DS,
    "<div class=\"small text-muted mb-2\">${CHART_PRICES_NOTE}</div>${key}", "<div class=\"small text-muted mb-2\">${CHART_PRICES_NOTE}</div>"]], T],
  ["ب", "the market's mark is a square like the purchase's (a colour alone would tell them apart)", [[DS,
    "  market: \"width:14px;height:14px;border:2px solid currentColor;border-radius:50%;box-sizing:border-box\",", "  market: \"width:10px;height:10px;background:currentColor\","]], T],
  ["ب", "our mark is no diamond", [[DS,
    "  ours: \"width:10px;height:10px;background:currentColor;transform:rotate(45deg)\",", "  ours: \"width:10px;height:10px;background:currentColor\","]], T],
  ["ب", "a mark carries a colour of its own (wrong in one of the two themes)", [[DS,
    "  cost: \"width:10px;height:10px;background:currentColor\",", "  cost: \"width:10px;height:10px;background:#111827\","]], T],
  ["ب", "an item without a market price still gets a market mark", [[DS,
    "    if (r.market > 0) marks.push(markOn(\"market\", axisAt(a, r.market), r.market));", "    marks.push(markOn(\"market\", axisAt(a, r.market), r.market));"]], T],
  ["ب", "an item without a market price does not say «لا سعر سوق»", [[DS,
    ": `<span class=\"text-nowrap\">${NO_MARKET_TEXT}</span>`);", ": \"\");"]], T],
  ["ب", "an item without a purchase price does not say «لا سعر شراء»", [[DS,
    ": `<span class=\"text-nowrap\">${NO_PURCHASE_TEXT}</span>`);", ": \"\");"]], T],
  ["ب", "our mark stands at the market price", [[DS,
    "    if (r.ours > 0) marks.push(markOn(\"ours\", axisAt(a, r.ours), r.ours));", "    if (r.ours > 0) marks.push(markOn(\"ours\", axisAt(a, r.market || r.ours), r.ours));"]], T],
  ["ب", "«سعرنا» is the price of the proposal even before anything is decided", [[DS,
    "    ours: publish && approved ? price : r.suggested > 0 ? r.suggested : 0, decided: publish && approved,", "    ours: publish ? price : r.suggested > 0 ? r.suggested : 0, decided: publish && approved,"]], T],
  ["ب", "a price that only waits is called «مقرر»", [[DS,
    "    ours: publish && approved ? price : r.suggested > 0 ? r.suggested : 0, decided: publish && approved,", "    ours: publish && approved ? price : r.suggested > 0 ? r.suggested : 0, decided: publish,"]], T],
  ["ب", "a mark's place is taken from zero, not from the axis' start", [[DS,
    "((x - a.lo) / (a.hi - a.lo)) * 100", "(x / a.hi) * 100"]], T],
  ["ب", "the axis is not written under the rows", [[DS,
    "${rows.map((r) => priceRow(r, axis)).join(\"\")}${axis ? axisRow(axis) : \"\"}</div>", "${rows.map((r) => priceRow(r, axis)).join(\"\")}</div>"]], T],
  ["ب", "the axis' ticks are not drawn on the rows", [[DS,
    "    marks.push(line(\"left:0;right:0;top:50%;height:1px\"), ...a.ticks.map((t) => line(`left:${axisAt(a, t)}%;top:50%;width:1px;height:8px;margin-top:-4px`)));", "    marks.push(line(\"left:0;right:0;top:50%;height:1px\"));"]], T],
  ["ب", "the track follows the page's direction (right to left in Odoo)", [[DS,
    "<div class=\"utak-track\" dir=\"ltr\" style=\"${TRACK}height:26px\">", "<div class=\"utak-track\" style=\"${TRACK}height:26px\">"]], T],
  ["ب", "the axis' step is a fortieth of the range (dozens of ticks)", [[DS,
    "  const raw = (max - min || max * 0.2) / 7,", "  const raw = (max - min || max * 0.2) / 40,"]], T],
  ["ب", "an axis of one price has no length", [[DS,
    "  if (hi <= lo) hi = r6(lo + step);\n", ""]], T],
  ["ب", "a profit and a loss wear the same colour", [[DS,
    "  const tone = r.profit > 0 ? \" text-success\" : r.profit < 0 ? \" text-danger\" : \"\";", "  const tone = r.profit !== 0 ? \" text-success\" : \"\";"]], T],
  ["ب", "a row's profit has no arrow (its colour alone tells a loss)", [[DS,
    "  const arrow = r.profit > 0 ? \"▲ \" : r.profit < 0 ? \"▼ \" : \"\";", "  const arrow = \"\";"]], T],
  ["ب", "a row's profit does not say what it was made at", [[DS,
    "<span class=\"fw-normal\">${PROFIT_BASE_TEXT[r.profitBase]}${r.noShare ? NO_SHARE_NOTE : \"\"}</span>${contribution}</div>`;", "<span class=\"fw-normal\"></span>${contribution}</div>`;"]], T],
  ["ب", "a product's name is written into the row as HTML", [[DS,
    "<div class=\"utak-name fw-bold\">${r.mark} ${esc(r.name)}</div>", "<div class=\"utak-name fw-bold\">${r.mark} ${r.name}</div>"]], T],
  ["ب", "a product's name is written under its column as HTML", [[DS,
    "      + `<div class=\"small fw-bold\">${r.mark} ${esc(r.name)}</div>`", "      + `<div class=\"small fw-bold\">${r.mark} ${r.name}</div>`"]], T],
  ["ب", "a no-break space reaches the HTML (Odoo stores it as an entity)", [[DS,
    "String(s ?? \"\").replace(/\\u00a0/g, \" \").replace(/&/g, \"&amp;\")", "String(s ?? \"\").replace(/&/g, \"&amp;\")"]], T],
  // ---------------------------------------------------------------- ب «ربح الكرتون»
  ["ب", "a loss is drawn above the zero line too", [[DS,
    "${p !== null && p > 0 ? bar(\"text-success\", \"4px 4px 0 0\") : \"\"}</div>`", "${p !== null && p !== 0 ? bar(\"text-success\", \"4px 4px 0 0\") : \"\"}</div>`"]], T],
  ["ب", "a loss has no column", [[DS,
    "${p !== null && p < 0 ? bar(\"text-danger\", \"0 0 4px 4px\") + label : \"\"}</div>`", "${p !== null && p < 0 ? label : \"\"}</div>`"]], T],
  ["ب", "a loss's value is not written on its column", [[DS,
    "${p !== null && p < 0 ? bar(\"text-danger\", \"0 0 4px 4px\") + label : \"\"}</div>`", "${p !== null && p < 0 ? bar(\"text-danger\", \"0 0 4px 4px\") : \"\"}</div>`"]], T],
  ["ب", "a profit's value is not written on its column", [[DS,
    "${p === null || p >= 0 ? label : \"\"}${p !== null && p > 0", "${p === null ? label : \"\"}${p !== null && p > 0"]], T],
  ["ب", "every column has the same height", [[DS,
    "  const px = (p: number): number => Math.max(2, Math.round((Math.abs(p) / most) * BAR_UNIT_PX));", "  const px = (p: number): number => BAR_UNIT_PX + 0 * p;"]], T],
  ["ب", "there is no zero line", [[DS,
    "      + zero\n", "\n"]], T],
  ["ب", "a column does not say what its profit was made at", [[DS,
    "      + `<div class=\"small text-muted\">${r.profitBase ? PROFIT_BASE_TEXT[r.profitBase] : r.purchase > 0 ? NONE : NO_PURCHASE_TEXT}</div>`", "      + `<div class=\"small text-muted\"></div>`"]], T],
  // ---------------------------------------------------------------- ج what the engine writes
  ["ج", "a new line is created without the screen's cells", [[PR,
    "      Object.assign(want, screen.line({ id: -(creates.length + 1), x_product_tmpl_id: [p.productId, p.productName], x_packaging_id: [p.packagingId, p.packagingName] }, want));\n", ""]], T],
  ["ج", "a line the engine updates keeps its old cells", [[PR,
    "    Object.assign(want, screen.line(l, want));\n", ""]], T],
  ["ج", "a line that left the catalog keeps its old cells", [[PR,
    "    const vals = changed(l, { ...gone, ...screen.line(l, gone) });", "    const vals = changed(l, { ...gone });"]], T],
  ["ج", "the engine does not write the four numbers and the chart", [[PR,
    "vals: { ...boardHeader(share, board, now), ...screen.header(), ...(await recipientsCount(env)) } });", "vals: { ...boardHeader(share, board, now), ...(await recipientsCount(env)) } });"]], T],
  ["ج", "a board rewrite does not write the four numbers and the chart", [[PR,
    "...screen.header(), ...(opts.dry ? {} : await recipientsCount(env)) };", "...(opts.dry ? {} : await recipientsCount(env)) };"]], T],
  ["ج", "a board rewrite makes the day's numbers from no line", [[PR,
    "    const vals = changed(l, { ...b, ...screen.line(l, { ...b }) });", "    const vals = changed(l, { ...b });"]], T],
  ["ج", "the screen is not written after a publication", [[PR,
    "    await screenAfterPublication(penv, dayId);\n", ""]], T],
  ["ج", "the lines are read without the screen's cells (every run writes them again)", [[PR,
    "  ...SCREEN_LINE_FIELDS,\n];", "];"]], T],
  ["ج", "writeDayScreen writes in a dry run", [[DS,
    "    if (!opts.dry) await call(env, PRICE_LINE_MODEL, \"write\", { ids: [l.id], vals });", "    await call(env, PRICE_LINE_MODEL, \"write\", { ids: [l.id], vals });"]], T],
  ["ج", "writeDayScreen writes the day in a dry run", [[DS,
    "  if (!opts.dry) await call(env, PRICE_DAY_MODEL, \"write\", { ids: [dayId], vals: screen.header });", "  await call(env, PRICE_DAY_MODEL, \"write\", { ids: [dayId], vals: screen.header });"]], T],
  ["ج", "writeDayScreen writes every line, changed or not", [[DS,
    ".filter(([k, v]) => !sameCell((l as unknown as Record<string, unknown>)[k], v)));", ".filter(() => true));"]], T],
  ["ج", "writeDayScreen does not write the day", [[DS,
    "  if (!opts.dry) await call(env, PRICE_DAY_MODEL, \"write\", { ids: [dayId], vals: screen.header });", "  void PRICE_DAY_MODEL;"]], T],
  // ---------------------------------------------------------------- ج the screen's arch
  ["ج", "the table is edited in the row again", [[LIB,
    "export const LINE_LIST = `<list create=\"0\" delete=\"0\">", "export const LINE_LIST = `<list editable=\"bottom\" create=\"0\" delete=\"0\">"]], T],
  ["ج", "«السوق» comes before «الشراء شامل» in the table", [[LIB,
    "        <field name=\"x_cost_vat_show\" string=\"${label(\"x_cost_vat_show\")}\"/>\n        <field name=\"x_market_show\" string=\"${label(\"x_market_show\")}\"/>", "        <field name=\"x_market_show\" string=\"${label(\"x_market_show\")}\"/>\n        <field name=\"x_cost_vat_show\" string=\"${label(\"x_cost_vat_show\")}\"/>"]], T],
  ["ج", "the columns' order is changed in the list of columns itself", [[LIB,
    "  [\"x_outcome_show\", \"القرار\"],\n  [\"x_reason\", \"السبب\"],", "  [\"x_reason\", \"السبب\"],\n  [\"x_outcome_show\", \"القرار\"],"]], T],
  ["ج", "«بدون خسارة» is back in the table", [[LIB,
    "        <field name=\"x_reason\" string=\"${label(\"x_reason\")}\"/>\n      </list>`;", "        <field name=\"x_reason\" string=\"${label(\"x_reason\")}\"/>\n        <field name=\"x_even_show\" string=\"بدون خسارة\"/>\n      </list>`;"]], T],
  ["ج", "a whole row is coloured by its status again", [[LIB,
    "export const LINE_LIST = `<list create=\"0\" delete=\"0\">", "export const LINE_LIST = `<list create=\"0\" delete=\"0\" decoration-danger=\"x_status == 'exception'\">"]], T],
  ["ج", "«ربحنا بسعر السوق» is not coloured by its sign", [[LIB,
    " decoration-success=\"x_market_profit &gt; 0\" decoration-danger=\"x_market_profit &lt; 0\" decoration-bf=\"x_market_profit != 0\"/>", "/>"]], T],
  ["ج", "the card's cells are in another order", [[LIB,
    "            ${cardRow(\"x_cost_show\")}\n            ${cardRow(\"x_cost_vat_show\")}", "            ${cardRow(\"x_cost_vat_show\")}\n            ${cardRow(\"x_cost_show\")}"]], T],
  ["ج", "«قرار براء» cannot be chosen in Odoo any more", [[LIB,
    "              <field name=\"x_decision\" string=\"قرار براء\"/>", "              <field name=\"x_decision\" string=\"قرار براء\" readonly=\"1\"/>"]], T],
  ["ج", "the carton share is not in the line's form", [[LIB,
    "              ${ro(\"x_op_share\", \"حصة التشغيل\")}\n", ""]], T],
  ["ج", "the chart comes after the table", [[LIB,
    "    <field name=\"x_chart_html\" readonly=\"1\" nolabel=\"1\" class=\"mb-3\"/>\n    <div class=\"text-muted mb-3\" invisible=\"x_chart_html\" name=\"utak_chart_empty\">${CHART_EMPTY_NOTE}</div>\n", ""], [LIB,
    "    <separator string=\"تفاصيل حساب اليوم\"/>", "    <field name=\"x_chart_html\" readonly=\"1\" nolabel=\"1\" class=\"mb-3\"/>\n    <div class=\"text-muted mb-3\" invisible=\"x_chart_html\" name=\"utak_chart_empty\">${CHART_EMPTY_NOTE}</div>\n    <separator string=\"تفاصيل حساب اليوم\"/>"]], T],
  ["ج", "the four numbers are three", [[LIB,
    "        ${tile(`${big(\"x_n_warn\")}\n          <div>⚠️ سعر شاذ ينتظرك</div>`)}\n", ""]], T],
  ["ج", "the average is green whatever its sign", [[LIB,
    "<div class=\"fs-1 fw-bold lh-1 text-success\" invisible=\"x_avg_profit &lt;= 0\">", "<div class=\"fs-1 fw-bold lh-1 text-success\">"]], T],
  ["ج", "a published day still says «للنشر»", [[LIB,
    "<div invisible=\"not (${PUBLISHED})\">✅ نُشر</div>", "<div invisible=\"1\">✅ نُشر</div>"]], T],
  ["ج", "the body replaces the form's header too (the buttons go)", [[LIB,
    "const BODY_FROM = `<div class=\"oe_title\"><h1>`;", "const BODY_FROM = `<header>`;"]], T],
  ["ج", "«تقرير النشر» is replaced with the body", [[LIB,
    "  return `${arch.slice(0, from)}${DAY_BODY}${arch.slice(to)}`;", "  return `${arch.slice(0, from)}${DAY_BODY}${arch.slice(arch.indexOf(\"</sheet>\"))}`;"]], T],
  ["ج", "an arch that is not § 48 + § 49 + § 54's is replaced all the same", [[LIB,
    "  if (!/<list editable=\"bottom\"/.test(body) || !body.includes(NOTE_54)) throw", "  if (false) throw"]], T],
  ["ج", "applying it twice stops the script", [[LIB,
    "  if (arch.includes(BODY_MARK)) return arch;\n", ""]], T],
  ["ج", "the explanation loses § 54's rule", [[LIB,
    "export const DAY_NOTE_56 = `${PROFIT_RULE} ${NOTE_54}`;", "export const DAY_NOTE_56 = `${PROFIT_RULE} ${DAY_NOTE}`;"]], T],
  ["ج", "the chart's field is created without Odoo's sanitizer (it would take a script from any internal user)", [[LIB,
    "  sanitize: true, sanitize_overridable: false, sanitize_tags: true,", "  sanitize: false, sanitize_overridable: false, sanitize_tags: false,"]], T],
  ["ج", "the chart's style attributes are sanitized away", [[LIB,
    "sanitize_attributes: true, sanitize_style: false, sanitize_form: true, strip_style: false, strip_classes: false,", "sanitize_attributes: true, sanitize_style: true, sanitize_form: true, strip_style: true, strip_classes: false,"]], T],
  // ---------------------------------------------------------------- the team's guide
  ["ج", "the guide does not say how the chart's three marks are read", [[GUIDE,
    "**■ الشراء شامل الضريبة**، و**○ السوق**، و**◆ سعرنا**", "ثلاث علامات"]], T],
  ["ج", "the guide still says «قرار براء» is chosen in the row", [[GUIDE,
    "   - **اضغط سطر الصنف لتفتح تفاصيله** (الجدول نفسه للقراءة):", "   - **«قرار براء» في السطر نفسه:**"]], T],
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
writeFileSync(new URL("../artifacts/s56-20261005-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
