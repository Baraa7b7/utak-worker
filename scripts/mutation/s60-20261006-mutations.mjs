// Mutation check for § 60 (2026-10-06), 1 of 3 — «طلبوا وما كان متوفر» (ج: src/unavailable-log.ts,
// src/router.ts, src/order-flow.ts), the additions of «📍 اليوم» and the chart's width (أ: src/day-screen.ts,
// src/day-insight.ts, src/day-tabs.ts), the 21:30 summary's lines (ملخص: src/owner-summary.ts,
// src/day-screen.ts), the one trial (هـ: src/s60-trial.ts, src/index.ts) and the operating guide (دليل:
// docs/OPERATING-DAY.md). The day's target is in s60-20261006-target-mutations.mjs, the tabs in
// s60-20261006-tabs-mutations.mjs (three scripts: three copies of the tree run side by side).
// Each mutation disables ONE guard, runs the test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s60-20261006-mutations.mjs [ج أ ملخص هـ دليل]     (no argument: every part)
//
// Out: scripts/artifacts/s60-20261006-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ج
  ["ج", "an empty item gets a row", [["src/unavailable-log.ts",
    ".filter((it) => it.text).map((it) => ({", ".map((it) => ({"]], "tests/s60-unavailable.test.mts"],
  ["ج", "his words are kept whole (no 120-character cut)", [["src/unavailable-log.ts",
    ".trim().slice(0, REQUEST_TEXT_MAX);", ".trim();"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the catalog's item is not written on the row", [["src/unavailable-log.ts",
    "x_product_tmpl_id: Number(it.productId) > 0 ? Number(it.productId) : false,", "x_product_tmpl_id: false,"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the quantity he gave is not written", [["src/unavailable-log.ts",
    "x_quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 0,", "x_quantity: 0,"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the row carries no day", [["src/unavailable-log.ts",
    "    x_date: day,\n    x_partner_id: partnerId,", "    x_date: false,\n    x_partner_id: partnerId,"]], "tests/s60-unavailable.test.mts"],
  ["ج", "a trial to Baraa's own number (no customer) is recorded", [["src/unavailable-log.ts",
    "    if (!(a.partnerId > 0)) return 0;\n", ""]], "tests/s60-unavailable.test.mts"],
  ["ج", "a row that cannot be written stops the answer", [["src/unavailable-log.ts",
    "    console.warn(\"[unavailable] the request was not recorded\", (e as Error)?.message);\n    return 0;", "    throw e;"]], "tests/s60-unavailable.test.mts"],
  ["ج", "a simulation's row is counted", [["src/unavailable-log.ts",
    "domain: [[\"x_date\", \">=\", from], [\"x_date\", \"<=\", to], [SIM_FIELD, \"!=\", true]],", "domain: [[\"x_date\", \">=\", from], [\"x_date\", \"<=\", to]],"]], "tests/s60-unavailable.test.mts"],
  ["ج", "rows of older days are counted with the day's", [["src/unavailable-log.ts",
    "domain: [[\"x_date\", \">=\", from], [\"x_date\", \"<=\", to], [SIM_FIELD, \"!=\", true]],", "domain: [[\"x_date\", \"<=\", to], [SIM_FIELD, \"!=\", true]],"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the catalog's item is counted by his words (one item, three names)", [["src/unavailable-log.ts",
    "const key = r.productId > 0 ? `p:${r.productId}` : `t:${r.text}`;", "const key = `t:${r.text}`;"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the asks are counted as customers", [["src/unavailable-log.ts",
    "customers: g.who.size,", "customers: g.asks,"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the most asked first, not the most customers", [["src/unavailable-log.ts",
    ".sort((a, b) => b.customers - a.customers || b.asks - a.asks ||", ".sort((a, b) => b.asks - a.asks ||"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the summary's line names every item (no five)", [["src/unavailable-log.ts",
    "items.slice(0, max).map(itemText)", "items.map(itemText)"]], "tests/s60-unavailable.test.mts"],
  ["ج", "«+N» is dropped", [["src/unavailable-log.ts",
    "${rest > 0 ? `، +${rest}` : \"\"}", ""]], "tests/s60-unavailable.test.mts"],
  ["ج", "no row still makes a line", [["src/unavailable-log.ts",
    "  if (!items.length) return \"\";\n", ""]], "tests/s60-unavailable.test.mts"],
  ["ج", "an item asked for once names its customer too", [["src/unavailable-log.ts",
    "${i.asks > 1 ? ` (${customersWord(i.customers)})` : \"\"}", "${` (${customersWord(i.customers)})`}"]], "tests/s60-unavailable.test.mts"],
  ["ج", "the intake records nothing", [["src/router.ts",
    "          partnerId: partner.id,\n          items: [\n            ...missing.map(", "          partnerId: 0,\n          items: [\n            ...missing.map("]], "tests/s60-unavailable.test.mts"],
  ["ج", "the intake records the catalog's name, not his own words", [["src/router.ts",
    "text: it.product_name_raw || nameOf(it), productId: it.product_id, quantity: it.quantity", "text: nameOf(it), productId: it.product_id, quantity: it.quantity"]], "tests/s60-unavailable.test.mts"],
  ["ج", "an item switched off is recorded without its catalog item", [["src/router.ts",
    "...deactivatedMatches.map((m) => ({ text: m.raw, productId: m.product_id,", "...deactivatedMatches.map((m) => ({ text: m.raw, productId: 0,"]], "tests/s60-unavailable.test.mts"],
  ["ج", "an item we do not sell is not recorded", [["src/router.ts",
    "            ...trulyUnknown.map((it) => ({ text: it.product_name_raw, quantity: it.quantity })),\n", ""]], "tests/s60-unavailable.test.mts"],
  ["ج", "a line that leaves an order is not recorded", [["src/order-flow.ts",
    "  if (asked.length) await logUnavailable(env, { partnerId: order.customer_id, items: asked, now: now.getTime() });\n", ""]], "tests/s60-unavailable.test.mts"],
  ["ج", "a line that leaves an order is recorded without its quantity", [["src/order-flow.ts",
    "asked.push({ text: l.product_name, productId: l.product_id, quantity: l.quantity });", "asked.push({ text: l.product_name, productId: l.product_id });"]], "tests/s60-unavailable.test.mts"],
  // ---------------------------------------------------------------- أ
  ["أ", "no ┃ at the break-even", [["src/day-screen.ts",
    "    if (r.breakEven > 0) marks.push(`<div class=\"utak-even text-danger\"", "    if (false) marks.push(`<div class=\"utak-even text-danger\""]], "tests/s60-screen.test.mts"],
  ["أ", "no pink zone before the break-even", [["src/day-screen.ts",
    "    if (r.breakEven > 0) marks.push(`<div class=\"utak-loss-zone", "    if (false) marks.push(`<div class=\"utak-loss-zone"]], "tests/s60-screen.test.mts"],
  ["أ", "the pink zone covers the whole axis", [["src/day-screen.ts",
    "left:0;width:${axisAt(a, r.breakEven)}%;top:50%;height:10px", "left:0;width:100%;top:50%;height:10px"]], "tests/s60-screen.test.mts"],
  ["أ", "the ┃ stands at the purchase price", [["src/day-screen.ts",
    "style=\"position:absolute;left:${axisAt(a, r.breakEven)}%;top:1px;bottom:1px", "style=\"position:absolute;left:${axisAt(a, r.purchaseVat)}%;top:1px;bottom:1px"]], "tests/s60-screen.test.mts"],
  ["أ", "the ┃ is not red", [["src/day-screen.ts",
    "class=\"utak-even text-danger\" title=", "class=\"utak-even text-success\" title="]], "tests/s60-screen.test.mts"],
  ["أ", "the ┃ takes Odoo's «bg-danger» (too dark on the dark theme)", [["src/day-screen.ts",
    "class=\"utak-even text-danger\" title=", "class=\"utak-even bg-danger\" title="]], "tests/s60-screen.test.mts"],
  ["أ", "the ┃ has no fill", [["src/day-screen.ts",
    "width:3px;margin-left:-1.5px;background:currentColor\"></div>`);", "width:3px;margin-left:-1.5px\"></div>`);"]], "tests/s60-screen.test.mts"],
  ["أ", "the zone is solid red, not a light pink", [["src/day-screen.ts",
    "class=\"utak-loss-zone bg-danger bg-opacity-25\"", "class=\"utak-loss-zone bg-danger\""]], "tests/s60-screen.test.mts"],
  ["أ", "the key does not name the break-even", [["src/day-screen.ts",
    "    + `<span class=\"text-nowrap\">${EVEN_IN} ${EVEN_KEY_TEXT}</span>`\n", ""]], "tests/s60-screen.test.mts"],
  ["أ", "the key's words for the break-even changed", [["src/day-screen.ts",
    "export const EVEN_KEY_TEXT = \"التعادل (أقل سعر بدون خسارة)\";", "export const EVEN_KEY_TEXT = \"التعادل\";"]], "tests/s60-screen.test.mts"],
  ["أ", "no «┃ التعادل» under the row", [["src/day-screen.ts",
    "  if (r.breakEven > 0) values.push(`<span class=\"utak-even-value", "  if (false) values.push(`<span class=\"utak-even-value"]], "tests/s60-screen.test.mts"],
  ["أ", "the value under the row is the purchase price", [["src/day-screen.ts",
    "${EVEN_LABEL} <span dir=\"ltr\">${fixed2(r.breakEven)}</span></span>`);", "${EVEN_LABEL} <span dir=\"ltr\">${fixed2(r.purchaseVat)}</span></span>`);"]], "tests/s60-screen.test.mts"],
  ["أ", "the axis does not reach a break-even past the other marks", [["src/day-screen.ts",
    "[r.purchaseVat, r.market, r.ours, r.breakEven]));\n  const key =", "[r.purchaseVat, r.market, r.ours]));\n  const key ="]], "tests/s60-screen.test.mts"],
  ["أ", "no move beside the purchase's value", [["src/day-screen.ts",
    "value(\"cost\", r.purchaseVat, moveIn(r.purchaseMove))", "value(\"cost\", r.purchaseVat)"]], "tests/s60-screen.test.mts"],
  ["أ", "no move beside the market's value", [["src/day-screen.ts",
    "value(\"market\", r.market, moveIn(r.marketMove))", "value(\"market\", r.market)"]], "tests/s60-screen.test.mts"],
  ["أ", "the move's arrow points the wrong way", [["src/day-screen.ts",
    "${m > 0 ? \"▲\" : \"▼\"} ${signed(m)}</span>`);", "${m > 0 ? \"▼\" : \"▲\"} ${signed(m)}</span>`);"]], "tests/s60-screen.test.mts"],
  ["أ", "a value that did not move gets an arrow", [["src/day-screen.ts",
    "Math.abs(now - Number(before)) >= 0.005 ? round2(now - Number(before)) : null);", "Math.abs(now - Number(before)) >= 0 ? round2(now - Number(before)) : null);"]], "tests/s60-screen.test.mts"],
  ["أ", "a value with no earlier number gets a move", [["src/day-screen.ts",
    "(now > 0 && Number(before) > 0 && Math.abs(", "(now > 0 && Math.abs("]], "tests/s60-screen.test.mts"],
  ["أ", "the purchase's move is of the price without the VAT (not the value shown)", [["src/day-screen.ts",
    "purchaseMove: moveOf(purchaseWithVat(r.purchase), last ? purchaseWithVat(last.purchase) : undefined)", "purchaseMove: moveOf(r.purchase, last?.purchase)"]], "tests/s60-screen.test.mts"],
  ["أ", "a simulation's day is read as the last number", [["src/day-tabs.ts",
    "domain: [[\"x_date\", \">=\", addDays(day, -HISTORY_DAYS)], [\"x_date\", \"<\", day], [SIM_FIELD, \"!=\", true]],", "domain: [[\"x_date\", \">=\", addDays(day, -HISTORY_DAYS)], [\"x_date\", \"<\", day]],"]], "tests/s60-screen.test.mts"],
  ["أ", "the day's own numbers are read as «the last day»", [["src/day-tabs.ts",
    "[\"x_date\", \">=\", addDays(day, -HISTORY_DAYS)], [\"x_date\", \"<\", day], [SIM_FIELD", "[\"x_date\", \">=\", addDays(day, -HISTORY_DAYS)], [\"x_date\", \"<=\", day], [SIM_FIELD"]], "tests/s60-screen.test.mts"],
  ["أ", "the oldest number is taken as the last", [["src/day-tabs.ts",
    ".sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))) {", ".sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {"]], "tests/s60-screen.test.mts"],
  ["أ", "the contribution is not written beside the profit", [["src/day-screen.ts",
    "  const contribution = r.contribution === null ? \"\" : `", "  const contribution = true ? \"\" : `"]], "tests/s60-screen.test.mts"],
  ["أ", "the contribution does not take the waste off", [["src/day-insight.ts",
    "return round2(round2(price / d) - l.purchase - (Number(l.waste) || 0));", "return round2(round2(price / d) - l.purchase);"]], "tests/s60-screen.test.mts"],
  ["أ", "the contribution takes no VAT off the price", [["src/day-insight.ts",
    "  const d = l.vatPct ? 1 + l.vatPct / 100 : 1;\n  return round2(round2(price / d) - l.purchase", "  const d = 1;\n  return round2(round2(price / d) - l.purchase"]], "tests/s60-screen.test.mts"],
  ["أ", "the row's contribution is always at the market price", [["src/day-screen.ts",
    "const at = publish ? price : base === \"market\" ? r.sale : base === \"suggested\" ? r.suggested : 0;", "const at = r.sale;"]], "tests/s60-screen.test.mts"],
  ["أ", "x_contribution is not written on the line", [["src/day-screen.ts",
    "  return {\n    x_contribution,\n", "  return {\n    x_contribution: 0,\n"]], "tests/s60-screen.test.mts"],
  ["أ", "the line's contribution keeps the waste in", [["src/day-screen.ts",
    "round2(net - buy - (Number(l.x_waste_cost) || 0)) : 0;", "round2(net - buy) : 0;"]], "tests/s60-screen.test.mts"],
  ["أ", "no line under the key", [["src/day-screen.ts",
    "\n    + `<div class=\"utak-key-note small text-muted mb-2\">${chartKeyNote(extra)}</div>`;", ";"]], "tests/s60-screen.test.mts"],
  ["أ", "the key's line always says 250 cartons", [["src/day-screen.ts",
    "const n = extra?.cartons && extra.cartons > 0 ? Math.round(extra.cartons * 100) / 100 : 0;", "const n = 250;"]], "tests/s60-screen.test.mts"],
  ["أ", "an actual average is called a target", [["src/day-screen.ts",
    "const on = !n ? \"\" : extra?.basis === \"actual\" ?", "const on = !n ? \"\" : false ?"]], "tests/s60-screen.test.mts"],
  ["أ", "«سعرنا مقابل السوق» may grow to 1200px", [["src/day-screen.ts",
    "export const CHART_PRICES_MAX_PX = 960;", "export const CHART_PRICES_MAX_PX = 1200;"]], "tests/s60-screen.test.mts"],
  ["أ", "«سعرنا مقابل السوق» stretches with the screen", [["src/day-screen.ts",
    "`flex:0 1 ${CHART_PRICES_MAX_PX}px;max-width:${CHART_PRICES_MAX_PX}px;min-width:0`", "`flex:1 1 ${CHART_PRICES_MAX_PX}px;min-width:0`"]], "tests/s60-screen.test.mts"],
  ["أ", "«ربح الكرتون» is never beside the prices", [["src/day-screen.ts",
    "<div class=\"utak-day-chart d-xxl-flex align-items-start\">", "<div class=\"utak-day-chart\">"]], "tests/s60-screen.test.mts"],
  ["أ", "«ربح الكرتون» goes beside the prices from 1200px", [["src/day-screen.ts",
    "<div class=\"utak-day-chart d-xxl-flex align-items-start\">", "<div class=\"utak-day-chart d-xl-flex align-items-start\">"]], "tests/s60-screen.test.mts"],
  ["أ", "no gap between the two drawings", [["src/day-screen.ts",
    "<div class=\"utak-profits ms-xxl-4\" style=", "<div class=\"utak-profits\" style="]], "tests/s60-screen.test.mts"],
  // ---------------------------------------------------------------- ملخص
  ["ملخص", "the text does not gain § 60's lines", [["src/owner-summary.ts",
    "    coverageLine(f.coverage),\n    ...insightLines(f),\n", "    coverageLine(f.coverage),\n"]], "tests/s60-summary.test.mts"],
  ["ملخص", "«طلبوا اليوم وما كان متوفر» is dropped", [["src/owner-summary.ts",
    "...(f.unavailable ? [f.unavailable] : [])", "...[]"]], "tests/s60-summary.test.mts"],
  ["ملخص", "a brief that cannot be made leaves no word", [["src/owner-summary.ts",
    "...(f.brief ?? [BRIEF_UNAVAILABLE_TEXT])", "...(f.brief ?? [])"]], "tests/s60-summary.test.mts"],
  ["ملخص", "reading the summary's figures writes the day's actual", [["src/owner-summary.ts",
    "closingBrief(env, day, nowMs, { keep: !!opts.keep })", "closingBrief(env, day, nowMs, { keep: true })"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the summary does not keep the day's actual", [["src/owner-summary.ts",
    "const figures = await readSummaryFigures(env, nowMs, { keep: true });", "const figures = await readSummaryFigures(env, nowMs, { keep: false });"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the lines do not follow a template inside his window", [["src/owner-summary.ts",
    "  if (d?.action === \"template\" && night?.first) {", "  if (false) {"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the follow-up has another title", [["src/owner-summary.ts",
    "export const FOLLOW_UP_TITLE = \"📊 تكملة ملخص اليوم\";", "export const FOLLOW_UP_TITLE = \"📊 ملخص اليوم\";"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the summary's 🎯 line is about the day before", [["src/day-screen.ts",
    "return screenBrief(r.rows, r.dayLines, day, r.state, r.extra, { when: \"اليوم\", actual: a.actual });", "return screenBrief(r.rows, r.dayLines, day, r.state, r.extra);"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the day's screen is not written again with the summary", [["src/day-screen.ts",
    "const r = await writeDayScreen(env, a.dayId, { dry: !o.keep, now: nowMs });", "const r = await writeDayScreen(env, a.dayId, { dry: true, now: nowMs });"]], "tests/s60-summary.test.mts"],
  ["ملخص", "a day without prices gives «تعذّر» instead of «لا أسعار لليوم»", [["src/day-screen.ts",
    "  if (!a.dayId) return [NO_DAY_BRIEF, briefActualLine(a.actual, \"اليوم\"), `💧 ${NO_SPLIT_TEXT}`, \"➡️ لا فرصة ظاهرة اليوم\"];\n", ""]], "tests/s60-summary.test.mts"],
  ["ملخص", "the actual is never kept by the summary's brief", [["src/day-screen.ts",
    "const a = await computeDayActual(env, day, nowMs, { dry: !o.keep });", "const a = await computeDayActual(env, day, nowMs, { dry: true });"]], "tests/s60-summary.test.mts"],
  ["ملخص", "the closing day's 🎯 line says «أمس»", [["src/day-screen.ts",
    "actual: closing ? closing.actual : yesterday ? yesterday.actual : undefined, when: closing?.when ?? \"أمس\",", "actual: closing ? closing.actual : yesterday ? yesterday.actual : undefined, when: \"أمس\","]], "tests/s60-summary.test.mts"],
  ["ملخص", "the screen's own box shows the day itself under «أمس»", [["src/day-screen.ts",
    "    x_target_html: targetHtml(plan, yesterday ? yesterday.actual : null, extra.own ?? null),", "    x_target_html: targetHtml(plan, yesterday ? yesterday.actual : null, null),"]], "tests/s60-summary.test.mts"],
  // ---------------------------------------------------------------- هـ
  ["هـ", "the trial goes with his window closed", [["src/s60-trial.ts",
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial goes more than once a day", [["src/s60-trial.ts",
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial does not say its numbers are illustrative", [["src/s60-trial.ts",
    " الأرقام كلها توضيحية وليست أرقام اليوم.`;", "`;"]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial does not close on «لم يُكتب شيء»", [["src/s60-trial.ts",
    "return [S60_TRIAL_HEAD, \"\", summaryText(figures), \"\", S60_TRIAL_TAIL].join(\"\\n\");", "return [S60_TRIAL_HEAD, \"\", summaryText(figures)].join(\"\\n\");"]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial goes under the summary's own purpose", [["src/s60-trial.ts",
    "export const SUMMARY_TEST_PURPOSE = \"target_lines_test\";", "export const SUMMARY_TEST_PURPOSE = \"owner_summary\";"]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial's hook asks for no token", [["src/index.ts",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/s60-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {", "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/s60-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {"]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial's 🎯 line is not the order's example", [["src/s60-trial.ts",
    "wasteRecorded: 96 * 0.6 + 15 });", "wasteRecorded: 96 * 0.6 });"]], "tests/s60-trial.test.mts"],
  ["هـ", "the trial is marked spent although nothing went", [["src/s60-trial.ts",
    "    await releaseButton(env, claim);\n    return { sent: false, reason: d ?", "    await finishButton(env, claim, DAY_TTL);\n    return { sent: false, reason: d ?"]], "tests/s60-trial.test.mts"],
  // ---------------------------------------------------------------- دليل
  ["دليل", "the guide does not say the four lines reach him at 21:30", [["docs/OPERATING-DAY.md",
    "**الأسطر الأربعة نفسها تصلك في ملخص 21:30**، وسطر 🎯 فيه عن **اليوم المُقفل**", "الأسطر الأربعة على الشاشة وحدها"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide says the decision is made on the contribution", [["docs/OPERATING-DAY.md",
    "القرار المقترح والمحرك ورسالة المراجعة على **الربح** كما كانت", "القرار المقترح والمحرك ورسالة المراجعة على **المساهمة**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide's contribution keeps the carton share in", [["docs/OPERATING-DAY.md",
    "**مساهمة الكرتون = البيع ÷ 1.15 − الشراء − التالف** (بلا حصة تشغيل)", "**مساهمة الكرتون = البيع ÷ 1.15 − الشراء − التالف − حصة التشغيل**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide does not say the four parts add up", [["docs/OPERATING-DAY.md",
    "**مجموع البنود = الفرق كله.**", ""]], "tests/s60-history.test.mts"],
  ["دليل", "the guide lets the pink zone be a profit", [["docs/OPERATING-DAY.md",
    "**منطقة وردية**: أي سعر بيع داخلها خسارة", "**منطقة وردية**: أي سعر بيع داخلها ربح"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide promises a drawing in the tabs", [["docs/OPERATING-DAY.md",
    "**لا جدول ملون ولا مصفوفة ولا شلال الآن:**", "**جدول ملون ومصفوفة وشلال:**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide says Baraa is alerted at once for an unavailable item", [["docs/OPERATING-DAY.md",
    "**لا تنبيه فوري لك.**", "**يصلك تنبيه فوري.**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide lets items be compared by price on one chart", [["docs/OPERATING-DAY.md",
    "**لا تقارن أصنافاً بأسعارها على رسم واحد**", "**قارن الأصناف بأسعارها على رسم واحد**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide lets the pie be opened on a price", [["docs/OPERATING-DAY.md",
    "**الدائري للكميات لا للأسعار:**", "**الدائري للأسعار:**"]], "tests/s60-history.test.mts"],
  ["دليل", "the guide says a folded total is an average", [["docs/OPERATING-DAY.md",
    "**لو طويت الأيام أو الأصناف باليد صار الرقم مجموعاً لا متوسطاً**", "لو طويت الأيام أو الأصناف باليد بقي الرقم متوسطاً"]], "tests/s60-history.test.mts"],
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
writeFileSync(new URL("../artifacts/s60-20261006-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
