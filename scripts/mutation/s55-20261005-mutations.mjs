// Mutation check for § 55 (2026-10-05) — the day's price review made plain («ربحنا» signed, the three
// choice lines, the form's two lines) and the team's forms: each mutation disables ONE guard, runs its
// test file, and must make it fail. The source is restored in `finally` after every run; a pattern that
// is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s55-20261005-mutations.mjs [أ …]     (no argument: every part)
//
// Out: scripts/artifacts/s55-20261005-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s55.test.mts";
const PR = "src/prices.ts";
const RV = "src/price-review.ts";
const LIB = "scripts/lib/s55-flows.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ «ربحنا»
  ["أ", "«ربحنا» without the VAT: the sale price is not divided by 1.15", [[RV,
    "  const d = r.vatPct ? 1 + r.vatPct / 100 : 1;\n  return round2(round2(price / d) - r.fullCost);", "  const d = 1;\n  return round2(round2(price / d) - r.fullCost);"]], T],
  ["أ", "«ربحنا» without the waste and the carton share: the purchase price alone is taken off", [[RV,
    "  return round2(round2(price / d) - r.fullCost);", "  return round2(round2(price / d) - r.purchase);"]], T],
  ["أ", "a profit is made up for a line without a purchase price", [[RV,
    "  if (!(r.purchase > 0) || !(r.fullCost > 0) || !(price > 0)) return null;", "  if (!(r.fullCost > 0) || !(price > 0)) return null;"]], T],
  ["أ", "a profit is made up for a line without a full cost", [[RV,
    "  if (!(r.purchase > 0) || !(r.fullCost > 0) || !(price > 0)) return null;", "  if (!(r.purchase > 0) || !(price > 0)) return null;"]], T],
  ["أ", "the VAT rate is not the day's (always 15 %)", [[RV,
    "  const vatPct = profitVatRate(day);", "  const vatPct = 15;"]], T],
  ["أ", "a profit is written without its «+»", [[RV,
    "  return `${n > 0 ? \"+\" : n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(2)}`;", "  return `${n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(2)}`;"]], T],
  ["أ", "a loss is written without its «−»", [[RV,
    "  return `${n > 0 ? \"+\" : n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(2)}`;", "  return `${n > 0 ? \"+\" : \"\"}${Math.abs(n).toFixed(2)}`;"]], T],
  ["أ", "the minus is an ASCII hyphen", [[RV,
    "  return `${n > 0 ? \"+\" : n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(2)}`;", "  return `${n > 0 ? \"+\" : n < 0 ? \"-\" : \"\"}${Math.abs(n).toFixed(2)}`;"]], T],
  ["أ", "a profit is written with one decimal", [[RV,
    "  return `${n > 0 ? \"+\" : n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(2)}`;", "  return `${n > 0 ? \"+\" : n < 0 ? \"−\" : \"\"}${Math.abs(n).toFixed(1)}`;"]], T],
  // ---------------------------------------------------------------- أ the line and its mark
  ["أ", "an outlier's line does not open with ⚠️", [[RV,
    "  if (isWarned(r)) return \"⚠️\";", "  if (false) return \"⚠️\";"]], T],
  ["أ", "a line that is not published opens with ✅", [[RV,
    "  if (o.kind === \"skip\") return \"❌\";", "  if (false) return \"❌\";"]], T],
  ["أ", "a price with no profit is marked ✅", [[RV,
    "  return p === null || p > 0 ? \"✅\" : \"🔻\";", "  return p === null || p >= 0 ? \"✅\" : \"🔻\";"]], T],
  ["أ", "an outlier Baraa already decided still warns", [[RV,
    "export const isWarned = (r: ReviewRow): boolean => !r.decision && r.proposal.outlier;", "export const isWarned = (r: ReviewRow): boolean => r.proposal.outlier;"]], T],
  ["أ", "the outlier's second line names no numbers", [[RV,
    "${m.last > 0 && m.now > 0 ? ` (${money(m.last)} ← ${money(m.now)})` : \" عن آخر سعر\"}", "${false ? ` (${money(m.last)} ← ${money(m.now)})` : \" عن آخر سعر\"}"]], T],
  ["أ", "a market outlier is called a purchase one", [[RV,
    "`⚠️ سعر ${m.kind === \"market\" ? \"السوق\" : \"الشراء\"} تغيّر كثير", "`⚠️ سعر ${false ? \"السوق\" : \"الشراء\"} تغيّر كثير"]], T],
  ["أ", "what moved on an outlier is not read", [[RV,
    "    if (l && r.proposal.outlier && !r.decision) r.moved = await readMoved(", "    if (false) r.moved = await readMoved("]], T],
  ["أ", "the price before an outlier is today's own row", [[RV,
    "[field, \">\", 0], [\"x_date\", \"<=\", day], [\"id\", \"!=\", notId]]", "[field, \">\", 0], [\"x_date\", \"<=\", day]]"]], T],
  ["أ", "the price before an outlier may be a simulation row", [[RV,
    "[\"x_packaging_id\", \"=\", packaging], [\"x_utak_simulation\", \"!=\", true]];", "[\"x_packaging_id\", \"=\", packaging]];"]], T],
  ["أ", "the profit shown is always the market's, whatever the price the line goes out at", [[RV,
    "  if (o.kind !== \"skip\") return profitText(r, o.kind, o.price);", "  if (o.kind !== \"skip\") return profitText(r, \"market\", r.sale);"]], T],
  ["أ", "a line that is not published shows its profit at the suggested price, not at the market", [[RV,
    "  if (r.sale > 0) return profitText(r, \"market\", r.sale);\n", ""]], T],
  ["أ", "a line without a purchase price does not say so", [[RV,
    "  if (!(r.purchase > 0)) return \"لا سعر شراء\";\n", ""]], T],
  ["أ", "Baraa's own decision is not marked «قرارك»", [[RV,
    "  return `${o.byOwner ? \"قرارك: \" : \"\"}${o.kind === \"skip\"", "  return `${false ? \"قرارك: \" : \"\"}${o.kind === \"skip\""]], T],
  ["أ", "the price after the uplift is not shown beside the market", [[RV,
    "${r.upliftPct > 0 ? ` (بعد الزيادة ${money(r.sale)})` : \"\"}", "${false ? ` (بعد الزيادة ${money(r.sale)})` : \"\"}"]], T],
  ["أ", "a profit made without the carton share does not say so", [[RV,
    "${noShare(r) ? NO_SHARE_NOTE : \"\"}: ${signed(p)}`;", ": ${signed(p)}`;"]], T],
  ["أ", "every profit is marked «بلا حصة التشغيل»", [[RV,
    "const noShare = (r: ReviewRow): boolean => r.purchase > 0 && r.fullCost > 0 && !(r.breakEven > 0);", "const noShare = (r: ReviewRow): boolean => r.purchase > 0 && r.fullCost > 0;"]], T],
  ["أ", "no market price reads «سوق 0»", [[RV,
    "const marketText = (r: ReviewRow): string => (r.market > 0 ? `سوق", "const marketText = (r: ReviewRow): string => (true ? `سوق"]], T],
  ["أ", "the form's first line does not say «لا سعر شراء»", [[RV,
    "  const numbers = [purchaseText(r) || \"لا سعر شراء\",", "  const numbers = [purchaseText(r),"]], T],
  ["أ", "the form's first line drops the purchase price with its VAT", [[RV,
    "  const numbers = [purchaseText(r) || \"لا سعر شراء\",", "  const numbers = [r.purchase > 0 ? `شراء ${money(r.purchase)}` : \"لا سعر شراء\","]], T],
  ["أ", "the message's line drops the purchase price", [[RV,
    "  const prices = [purchaseText(r), marketText(r)].filter(Boolean).join(\" · \");", "  const prices = [marketText(r)].filter(Boolean).join(\" · \");"]], T],
  ["أ", "«شامل» is the purchase price itself (not × 1.15)", [[RV,
    "Math.round(r.purchase * PURCHASE_VAT_FACTOR * 1e6)", "Math.round(r.purchase * 1e6)"]], T],
  ["أ", "«شامل» is made with another rate", [[RV,
    "export const PURCHASE_VAT_FACTOR = 1.15;", "export const PURCHASE_VAT_FACTOR = 1.05;"]], T],
  ["أ", "«شامل» drops its zeros («23» for 23.00)", [[RV,
    "(${withVat.toFixed(2)} شامل)", "(${money(withVat)} شامل)"]], T],
  ["أ", "«شامل» is rounded from the float (12.50 → 14.37)", [[RV,
    "  const withVat = Math.round(Math.round(r.purchase * PURCHASE_VAT_FACTOR * 1e6) / 1e4) / 100;", "  const withVat = Math.round(r.purchase * PURCHASE_VAT_FACTOR * 100) / 100;"]], T],
  ["أ", "no purchase price reads «شراء 0 (0.00 شامل)»", [[RV,
    "  if (!(r.purchase > 0)) return \"\";\n  const withVat", "  const withVat"]], T],
  ["أ", "a new shape of the message cannot be tried the day it is deployed (the trial's claim ignores its edition)", [[RV,
    "`prv_test:${REVIEW_FLOW_ID}:${REVIEW_TEST_EDITION}:${riyadhDateKey(new Date(now))}`", "`prv_test:${REVIEW_FLOW_ID}:${riyadhDateKey(new Date(now))}`"]], T],
  ["أ", "a change of the cost alone (another «ربحنا») sends no update", [[RV,
    "r.proposal.outlier ? 1 : 0, r.fullCost || 0].join(\":\");", "r.proposal.outlier ? 1 : 0].join(\":\");"]], T],
  // ---------------------------------------------------------------- أ the note and the three lines
  ["أ", "the note under the title is missing from the message", [[RV,
    "  const whole = [title, PROFIT_NOTE, ...changed, \"\", ...table, \"\", ...tail].join(\"\\n\");", "  const whole = [title, ...changed, \"\", ...table, \"\", ...tail].join(\"\\n\");"]], T],
  ["أ", "the note under the title is missing from the table's text", [[RV,
    "...(i === 0 ? [PROFIT_NOTE, ...changed] : [])", "...(i === 0 ? changed : [])"]], T],
  ["أ", "the first line lists only what goes out by itself", [[RV,
    "    `لو ضغطت «${REVIEW_BUTTON_ALL_NAME}» ينتشر: ${list(out, true)}`,", "    `لو ضغطت «${REVIEW_BUTTON_ALL_NAME}» ينتشر: ${list(auto, true)}`,"]], T],
  ["أ", "the second line lists what IS published", [[RV,
    "    `وما ينتشر: ${list(stay, false)}`,", "    `وما ينتشر: ${list(out, false)}`,"]], T],
  ["أ", "the third line lists everything the tap would publish", [[RV,
    "ينتشر تلقائياً: ${list(auto, true)}`,", "ينتشر تلقائياً: ${list(out, true)}`,"]], T],
  ["أ", "after the time the third line still promises a publication at 6", [[RV,
    "    o.late ? `فات موعد ${clockAr(deadlineMin)} وما انتشرت أسعار اليوم", "    false ? `فات موعد ${clockAr(deadlineMin)} وما انتشرت أسعار اليوم"]], T],
  ["أ", "an empty list is left blank (no «لا شيء»)", [[RV,
    "(!rs.length ? NOTHING : o.compact ? counted(rs) : named(rs, price));", "(!rs.length ? \"\" : o.compact ? counted(rs) : named(rs, price));"]], T],
  ["أ", "the buttons' text of a long day lists every name (past 1024)", [[RV,
    "(!rs.length ? NOTHING : o.compact ? counted(rs) : named(rs, price));", "(!rs.length ? NOTHING : false ? counted(rs) : named(rs, price));"]], T],
  ["أ", "the short message counts the items in place of naming them", [[RV,
    "  const tail = choiceLines(rows, deadlineMin, { late: o.late });", "  const tail = choiceLines(rows, deadlineMin, { late: o.late, compact: true });"]], T],
  ["أ", "the names are lost on a long day: the table's text closes without the three lines", [[RV,
    "  for (const line of [...table, \"\", ...tail.flatMap((t) => wrapList(t, room))]) {", "  for (const line of table) {"]], T],
  ["أ", "a long list of names is not cut: a part passes a text message's room", [[RV,
    "...tail.flatMap((t) => wrapList(t, room))", "...tail"]], T],
  ["أ", "an outlier's second line may open the next part, away from its item", [[RV,
    "...g.rows.map((r) => reviewItemLines(r).join(\"\\n\"))]);", "...g.rows.flatMap(reviewItemLines)]);"]], T],
  ["أ", "the publication time is written «06:00» in the third line", [[RV,
    "`الساعة ${minutes % 60 === 0 ? String(Math.floor(minutes / 60)) : hhmm(minutes)}`;", "`الساعة ${hhmm(minutes)}`;"]], T],
  ["أ", "the first part's room ignores the note under its title: it may pass a text message's limit", [[RV,
    "  let size = [PROFIT_NOTE, ...changed].reduce((n, l) => n + l.length + 1, 0);", "  let size = 0;"]], T],
  ["أ", "two items are counted «2 صنفاً»", [[RV,
    "rows.length === 2 ? \"صنفان\" :", "false ? \"صنفان\" :"]], T],
  // ---------------------------------------------------------------- أ the buttons
  ["أ", "the first button is «اعتمد الكل كما هو» again", [[RV,
    "export const REVIEW_BUTTON_ALL_NAME = \"نفّذ المقترح\";", "export const REVIEW_BUTTON_ALL_NAME = \"اعتمد الكل كما هو\";"]], T],
  ["أ", "the second button is «مراجعة» again", [[RV,
    "export const REVIEW_BUTTON_FORM = \"✏️ عدّل\";", "export const REVIEW_BUTTON_FORM = \"✏️ مراجعة\";"]], T],
  ["أ", "the third button is «لا تنشر اليوم» again", [[RV,
    "export const REVIEW_BUTTON_NONE = \"⛔ لا تنشر شيء\";", "export const REVIEW_BUTTON_NONE = \"⛔ لا تنشر اليوم\";"]], T],
  ["أ", "the 06:00 alert of a day that was not published names the old buttons", [[PR,
    "«✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً", "«✅ اعتمد الكل» أو «✏️ مراجعة» من رسالة المراجعة ينشر فوراً"]], T],
  ["أ", "the answer to an old exception message names the old buttons", [[PR,
    "(✅ نفّذ المقترح / ✏️ عدّل)", "(✅ اعتمد الكل / ✏️ مراجعة)"]], T],
  // ---------------------------------------------------------------- أ the confirmation
  ["أ", "the confirmation drops each item's profit", [[RV,
    "${profit === null ? \"\" : ` · ربحنا ${signed(profit)}`}`;\n    }), averageProfitLine(out)] : [", "`;\n    }), averageProfitLine(out)] : ["]], T],
  ["أ", "the confirmation drops «متوسط الربح للكرتون»", [[RV,
    "    }), averageProfitLine(out)] : [", "    })] : ["]], T],
  ["أ", "the average is the sum of the profits", [[RV,
    "signed(profits.reduce((a, b) => a + b, 0) / profits.length)", "signed(profits.reduce((a, b) => a + b, 0))"]], T],
  ["أ", "the trial's form answer drops each decision's profit", [[RV,
    "ر.س (${PUBLISH_LABEL[x.kind]})${profitNote(x.item, x.price)}`}", "ر.س (${PUBLISH_LABEL[x.kind]})`}"]], T],
  // ---------------------------------------------------------------- أ the form
  ["أ", "the worker still sends utak_owner_review_v1", [[RV,
    "export const REVIEW_FLOW_ID = \"1135227635856887\";", "export const REVIEW_FLOW_ID = \"1084593151143621\";"]], T],
  ["أ", "the worker fills fifteen slots a page (the Flow has ten)", [[RV,
    "export const REVIEW_FLOW_PAGE_SLOTS = 10;", "export const REVIEW_FLOW_PAGE_SLOTS = 15;"]], T],
  ["أ", "the worker fills four pages (the Flow has six)", [[RV,
    "export const REVIEW_FLOW_PAGES = 6;", "export const REVIEW_FLOW_PAGES = 4;"]], T],
  ["أ", "the form's second line is not sent", [[RV,
    "    data[`y${n}`] = it ? it.info2 ?? \"-\" : \"-\";", "    data[`y${n}`] = \"-\";"]], T],
  ["أ", "the Flow shows one line an item (its second caption is gone)", [[LIB,
    "    { type: \"TextCaption\", text: rref(k, `y${n}`), visible: rref(k, `v${n}`) },\n", ""]], T],
  ["أ", "the Flow's second line reads the first line's key", [[LIB,
    "    { type: \"TextCaption\", text: rref(k, `y${n}`), visible: rref(k, `v${n}`) },", "    { type: \"TextCaption\", text: rref(k, `x${n}`), visible: rref(k, `v${n}`) },"]], T],
  ["أ", "the Flow has fifteen slots a page (sixty components)", [[LIB,
    "export const REVIEW_PAGE_SLOTS = 10;", "export const REVIEW_PAGE_SLOTS = 15;"]], T],
  ["أ", "the form's first line drops the profit at the market price", [[RV,
    "marketText(r), r.sale > 0 ? profitText(r, \"market\", r.sale) : \"\"].filter(Boolean).join(\" · \");", "marketText(r), \"\"].filter(Boolean).join(\" · \");"]], T],
  ["أ", "the form's first line drops an outlier's warning", [[RV,
    "  return cut([...movedLines(r), numbers].join(\" · \"), REVIEW_INFO_MAX);", "  return cut([numbers].join(\" · \"), REVIEW_INFO_MAX);"]], T],
  ["أ", "our price is compared with the market AFTER the uplift", [[RV,
    "  const d = round2(r.suggested - r.market);", "  const d = round2(r.suggested - r.sale);"]], T],
  ["أ", "«أعلى» and «أقل» are swapped", [[RV,
    "${d > 0 ? \"أعلى\" : \"أقل\"} من السوق بـ", "${d < 0 ? \"أعلى\" : \"أقل\"} من السوق بـ"]], T],
  ["أ", "the percentage is of our price, not of the market's", [[RV,
    "signedPct((d / r.market) * 100)", "signedPct((d / r.suggested) * 100)"]], T],
  ["أ", "without a market price the second line still compares", [[RV,
    "  if (!(r.market > 0)) return `${lead} — لا سعر سوق للمقارنة`;\n", ""]], T],
  ["أ", "a price equal to the market's is «أقل من السوق بـ 0»", [[RV,
    "  if (d === 0) return `${lead} = سعر السوق`;\n", ""]], T],
  ["أ", "a choice does not carry its profit", [[RV,
    "  return p === null ? cut(base, REVIEW_OPTION_MAX) : fits([`${base} (ربح ${signed(p)})`, `${base} (${signed(p)})`, base], REVIEW_OPTION_MAX);", "  return cut(base, REVIEW_OPTION_MAX);"]], T],
  ["أ", "a choice longer than thirty characters is cut in the middle of its number", [[RV,
    "fits([`${base} (ربح ${signed(p)})`, `${base} (${signed(p)})`, base], REVIEW_OPTION_MAX);", "cut(`${base} (ربح ${signed(p)})`, REVIEW_OPTION_MAX);"]], T],
  ["أ", "«بسعر السوق» is offered at the market as observed, not after the uplift", [[RV,
    "[{ id: \"market\", title: pricedOption(r, \"بسعر السوق\", r.sale) }]", "[{ id: \"market\", title: pricedOption(r, \"بسعر السوق\", r.market) }]"]], T],
  ["أ", "the form's item does not keep what its profit is made from", [[RV,
    "    purchase: r.purchase, fullCost: r.fullCost, vatPct: r.vatPct,\n", ""]], T],
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
writeFileSync(new URL("../artifacts/s55-20261005-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
