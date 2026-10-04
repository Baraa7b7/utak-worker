// Mutation check for § 47 (2026-10-01): each mutation disables ONE guard of a part, runs that
// part's test file, and must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
//   node scripts/mutation/s47-20261001-mutations.mjs [أ|ب|ج …]     (no argument: every part)
//
// Out: scripts/artifacts/s47-20261001-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s47.test.mts";
const TPA = "tests/purchase-accounting.test.mts";
const EN = "src/pricing-engine.ts";
const PB = "src/pricing-board.ts";
const PR = "src/prices.ts";
const OC = "src/operating-cost.ts";
const PA = "src/purchase-accounting.ts";
const SP = "src/supplier-pay.ts";
const OD = "src/odoo.ts";
const PS = "src/price-sources.ts";
const SU = "src/suppliers.ts";
const PO = "src/purchase-order.ts";
const IX = "src/index.ts";
const PSF = "src/product-setup.ts";
const VW = "scripts/lib/s47-odoo-views.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the purchase price is net of VAT
  ["أ", "the whole profit ÷ 1.15 (the purchase taken as VAT-inclusive)", [[EN,
    "  return (vatRatePct ? sale / (1 + vatRatePct / 100) : sale) - purchase - waste;", "  return vatRatePct ? (sale - purchase - waste) / (1 + vatRatePct / 100) : sale - purchase - waste;"]], T],
  ["أ", "the board's net purchase = the purchase ÷ 1.15", [[EN,
    "  const netH = halalas(a.purchase);", "  const netH = halalas(a.vatRatePct ? a.purchase / 1.15 : a.purchase);"]], T],
  ["أ", "the lowest offer compares a supplier's price net of a VAT (÷ 1.15), not the numbers as written", [[EN,
    ".sort((a, b) => a.price - b.price || a.rowId - b.rowId);", ".sort((a, b) => (a.model === \"dp\" ? a.price / 1.15 : a.price) - (b.model === \"dp\" ? b.price / 1.15 : b.price) || a.rowId - b.rowId);"]], T],
  ["أ", "the bill's tax taken out of the net price (the price-included split)", [[PA,
    "    const tax = ratePct ? roundHalala((net * ratePct) / 100) : 0;", "    const tax = ratePct ? roundHalala((net * ratePct) / (100 + ratePct)) : 0;"]], T],
  ["أ", "the bill's total without the tax added", [[PA,
    "    return { net, tax, gross: roundHalala(net + tax) };", "    return { net, tax, gross: net };"]], T],
  ["أ", "the bill's tax rounded on the total, not on each line", [[PA,
    "  return { subtotal: sum(\"net\"), tax: sum(\"tax\"), total: sum(\"gross\"), lines };\n}\n\n/** null = no tax",
    "  return { subtotal: sum(\"net\"), tax: roundHalala((sum(\"net\") * (ratePct ?? 0)) / 100), total: sum(\"gross\"), lines };\n}\n\n/** null = no tax"]], T],
  ["أ", "a price-included purchase tax accepted for the bill", [[PA,
    "  if (base.price_include) {\n    throw new Error(", "  if (false) {\n    throw new Error("]], TPA],
  ["أ", "an inactive purchase tax accepted for the bill", [[PA,
    "  if (!base || !base.active || base.type_tax_use !== \"purchase\" || base.amount_type !== \"percent\" || !(base.amount > 0)) {\n    throw new Error(`ضريبة الشراء ${co.account_purchase_tax_id[0]} غير صالحة`);\n  }\n  if (base.price_include) {",
    "  if (!base || base.type_tax_use !== \"purchase\" || base.amount_type !== \"percent\" || !(base.amount > 0)) {\n    throw new Error(`ضريبة الشراء ${co.account_purchase_tax_id[0]} غير صالحة`);\n  }\n  if (base.price_include) {"]], TPA],
  ["أ", "the tax added for a supplier without a VAT number", [[PA,
    "  if (!supplierIsVatRegistered(a.supplierVat)) return null;\n", ""]], TPA],
  ["أ", "the tax added before the VAT cutoff", [[PA,
    "  if (!isVatApplicable(a.billDate, a.vatEffectiveDate)) return null;\n", ""]], TPA],
  ["أ", "the expected totals of the bill made the price-included way (no tax on top)", [[PA,
    "    const expected = computeNetTotals(\n      b.items.map((it) => (it.unit_price as number) * it.total_quantity),\n      tax?.rate ?? null,\n    );",
    "    const expected = computeNetTotals(\n      b.items.map((it) => (it.unit_price as number) * it.total_quantity),\n      null,\n    );"]], TPA],
  ["أ", "the supplier due without the VAT of a supplier with a VAT number", [[SP,
    "    return { subtotalH: netH + vatH, vatH };", "    return { subtotalH: netH, vatH };"]], T],
  ["أ", "the supplier due with VAT for every supplier", [[SP,
    "(sid) => (taxed.has(sid) ? VAT_RATE_PCT : null));", "() => VAT_RATE_PCT);"]], T],
  ["أ", "the supplier due with VAT before the cutoff", [[SP,
    "  if (!uniq.length || !/^\\d{4}-\\d{2}-\\d{2}$/.test(day) || !isVatApplicable(day)) return new Set();", "  if (!uniq.length || !/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) return new Set();"]], T],
  ["أ", "the VAT of a due line rounded down", [[SP,
    "  return ratePct ? Math.round((netH * ratePct) / 100) : 0;", "  return ratePct ? Math.floor((netH * ratePct) / 100) : 0;"]], T],
  ["أ", "the due line's note does not say the VAT was added", [[SP,
    "              l.vatH > 0 ? `المستحق = الكمية × السعر + ضريبة ${VAT_RATE_PCT}% (${money(l.vatH)} ر.س): المورد مسجل والسعر بدون ضريبة` : \"\",\n", ""]], T],
  ["أ", "today's supplier row with a purchase price alone hides today's sale price", [[OD,
    "      [\"x_sale_price\", \">\", 0], // § 47 أ — a row with a purchase price alone is not a sale price\n", ""]], T],
  ["أ", "the stale fallback stops at a row with a purchase price alone", [[OD,
    "      [\"x_sale_price\", \">\", 0], // § 47 أ\n", ""]], T],
  // § 51 — the sentence «ولو معك سعر شراء اكتب «شراء» جنب رقمه…» was deleted from the ask of a source without a
  // role; «بدون ضريبة» is now said by the ask of a «شراء» source (and by the Flow, tests/s51.test.mts).
  ["أ", "the ask of a «شراء» source does not say the purchase price is without VAT", [[PS,
    "والتعبئة وسعر الشراء لكل صنف، بدون ضريبة.`;", "والتعبئة وسعر الشراء لكل صنف.`;"]], T],
  ["أ", "the supplier's «تعديل الأسعار» reply does not say «بدون ضريبة»", [[SU,
    "(الصنف، التعبئة، السعر بدون ضريبة)", "(الصنف، التعبئة، السعر)"]], T],
  ["أ", "the 05:00 reminder as text does not say «بدون ضريبة»", [[SU,
    " لو سمحت (الأسعار بدون ضريبة).`;", " لو سمحت.`;"]], T],
  ["أ", "the exception's message does not say the purchase is without VAT", [[PR,
    "    `الشراء (بدون ضريبة): ${cost} · السوق: ${market}${profit}`,", "    `الشراء: ${cost} · السوق: ${market}${profit}`,"]], T],
  ["أ", "the purchase order document hides the VAT row", [[PO,
    "  const taxRow = tax > 0.005", "  const taxRow = tax > 1e9"]], T],
  ["أ", "the purchase order document shows a VAT row without a tax", [[PO,
    "  const taxRow = tax > 0.005", "  const taxRow = tax >= 0"]], T],
  // ---------------------------------------------------------------- ب the profitable price
  ["ب", "the suggested price rounded to the nearest half, not up", [[EN,
    "  return round2(Math.ceil(x / step - 1e-6) * step);", "  return round2(Math.round(x / step) * step);"]], T],
  ["ب", "the suggested price rounded up to a whole riyal", [[EN,
    "export const SUGGESTED_STEP = 0.5;", "export const SUGGESTED_STEP = 1;"]], T],
  ["ب", "a float's noise pushes a price on a step to the next step", [[EN,
    "  return round2(Math.ceil(x / step - 1e-6) * step);", "  return round2(Math.ceil(x / step) * step);"]], T],
  ["ب", "the suggested price without the minimum profit (§ 48: riyals a carton)", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep((fullH * vat) / 1e4),"]], T],
  ["ب", "the minimum profit taken as a percentage of the full cost (the rule of § 47), not riyals on top of it", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep((fullH * (100 + Math.max(0, a.minProfit)) * vat) / 1e6),"]], T],
  ["ب", "the suggested price without the VAT", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * 100) / 1e4),"]], T],
  ["ب", "the break-even without the VAT", [[EN,
    "    breakEven: Math.round((fullH * vat) / 100) / 100,", "    breakEven: fullH / 100,"]], T],
  ["ب", "the break-even carries the minimum profit", [[EN,
    "    breakEven: Math.round((fullH * vat) / 100) / 100,", "    breakEven: Math.round(((fullH + halalas(a.minProfit)) * vat) / 100) / 100,"]], T],
  ["ب", "the VAT multiplied before the cutoff too", [[EN,
    "  const vat = a.vatRatePct ? 100 + a.vatRatePct : 100;", "  const vat = 115;"]], T],
  ["ب", "the carton share unreadable: a suggested price from a guessed cost", [[EN,
    "  if (a.opShare === null) return { ...base, breakEven: null, suggested: null };\n", ""]], T],
  ["ب", "the full cost without the carton share", [[EN,
    "  const fullH = netH + wasteH + (a.opShare !== null ? halalas(a.opShare) : 0);", "  const fullH = netH + wasteH;"]], T],
  ["ب", "the full cost without the waste", [[EN,
    "  const fullH = netH + wasteH + (a.opShare !== null ? halalas(a.opShare) : 0);", "  const fullH = netH + (a.opShare !== null ? halalas(a.opShare) : 0);"]], T],
  ["ب", "the default minimum profit is 0", [[EN,
    "export const DEFAULT_MIN_PROFIT_SAR = 2;", "export const DEFAULT_MIN_PROFIT_SAR = 0;"]], T],
  ["ب", "(2) a market price below the suggested one is not an exception", [[EN,
    "      if (suggested !== null) { if (market < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (false) exceptions.push(\"below_profit\"); }"]], T],
  ["ب", "(1) a market price equal to the suggested one is an exception", [[EN,
    "      if (suggested !== null) { if (market < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (market <= suggested + 0.0001) exceptions.push(\"below_profit\"); }"]], T],
  ["ب", "(2) the rule compares with the break-even, not the suggested price", [[EN,
    "      if (suggested !== null) { if (market < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (market < (fl?.breakEven ?? 0) - 0.0001) exceptions.push(\"below_profit\"); }"]], T],
  ["ب", "no carton share: no profit rule at all", [[EN,
    "      else if (profit !== null && profit <= 0) exceptions.push(\"no_profit\");", "      else void profit;"]], T],
  ["ب", "(3) a line without a market price approved at the suggested price without Baraa", [[EN,
    "  if (p.exceptions.length) return { status: \"exception\", sale: 0, excluded: true, reason: p.reason };",
    "  if (p.exceptions.length) return p.suggested && !p.market ? { status: \"auto\", sale: p.suggested, excluded: false, reason: \"\" } : { status: \"exception\", sale: 0, excluded: true, reason: p.reason };"]], T],
  ["ب", "(1) a profitable line published at the suggested price, not the market price", [[EN,
    "  return { status: \"auto\", sale: round2(p.market as number), excluded: false, reason: \"\" };", "  return { status: \"auto\", sale: round2(p.suggested ?? (p.market as number)), excluded: false, reason: \"\" };"]], T],
  ["ب", "«اعتمد بالسعر المربح» ignored by the engine", [[EN,
    "  if (decision === \"profit\") {", "  if (false) {"]], T],
  ["ب", "«اعتمد بالسعر المربح» approves at the market price", [[EN,
    "    const price = manualPrice > 0 ? manualPrice : p.suggested ?? 0;", "    const price = manualPrice > 0 ? manualPrice : p.market ?? 0;"]], T],
  ["ب", "«اعتمد بالسعر المربح» forgets the price he saw", [[EN,
    "    const price = manualPrice > 0 ? manualPrice : p.suggested ?? 0;", "    const price = p.suggested ?? 0;"]], T],
  ["ب", "the publication's check: a «profit» line without a typed price is compared with the market price", [[EN,
    "    if (l.x_decision === \"profit\") return round2(Number(l.x_suggested_price) || 0);\n", ""]], T],
  ["ب", "«اعتمد بالسعر المربح» chosen in Odoo: the engine does not keep the price of that run", [[PR,
    "    Object.assign(want, keptPrice(l, decision, v, fixed));\n", ""]], T],
  ["ب", "the engine's rule gets no carton share and no minimum profit", [[PR,
    "  const plan = computePricing(items, offers, settings.wastePct, vat, { opShare: share.share, minProfit: settings.minProfit });", "  const plan = computePricing(items, offers, settings.wastePct, vat);"]], T],
  ["ب", "the engine's rule ignores «الربح الأدنى للكرتون» of the settings", [[PR,
    "  const plan = computePricing(items, offers, settings.wastePct, vat, { opShare: share.share, minProfit: settings.minProfit });", "  const plan = computePricing(items, offers, settings.wastePct, vat, { opShare: share.share, minProfit: 2 });"]], T],
  ["ب", "the line's two numbers ignore «الربح الأدنى للكرتون» of the settings", [[PR,
    "      vatRatePct: vat.ratePct, opShare: share.share, minProfit: settings.minProfit,\n    });", "      vatRatePct: vat.ratePct, opShare: share.share, minProfit: 2,\n    });"]], T],
  ["ب", "a stored line's two numbers ignore «الربح الأدنى للكرتون»", [[PR,
    "    wastePct, vatRatePct, opShare, minProfit,\n  });", "    wastePct, vatRatePct, opShare, minProfit: 2,\n  });"]], T],
  ["ب", "a change of «الربح الأدنى للكرتون» does not recompute the day", [[PR,
    "    rec.id, rec.x_state, settings.wastePct, settings.minProfit, vat.ratePct,", "    rec.id, rec.x_state, settings.wastePct, vat.ratePct,"]], T],
  ["ب", "«الربح الأدنى للكرتون» not read from the settings", [[OC,
    "    minProfit: typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,", "    minProfit: DEFAULT_MIN_PROFIT_SAR,"]], T],
  ["ب", "Baraa's 0 taken for the default 2", [[OC,
    "    minProfit: typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,", "    minProfit: Number(r.x_min_profit_sar) > 0 ? Number(r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,"]], T],
  ["ب", "the board's line does not carry the suggested price", [[PB,
    "    x_break_even: fl?.breakEven ?? 0, x_suggested_price: suggested,", "    x_break_even: fl?.breakEven ?? 0, x_suggested_price: 0,"]], T],
  ["ب", "the board's line does not carry the break-even", [[PB,
    "    x_break_even: fl?.breakEven ?? 0, x_suggested_price: suggested,", "    x_break_even: 0, x_suggested_price: suggested,"]], T],
  ["ب", "the two numbers are not among the board's fields (not read back for the message)", [[PB,
    "\"x_full_cost\", \"x_break_even\", \"x_suggested_price\", \"x_board_sale\"", "\"x_full_cost\", \"x_board_sale\""]], T],
  ["ب", "«اعتمد بالسعر المربح» offered when the market price reaches the suggested one", [[PR,
    "  return suggested > 0 && (!(market > 0) || market < suggested - 0.0001);", "  return suggested > 0;"]], T],
  ["ب", "«اعتمد بالسعر المربح» not offered without a market price", [[PR,
    "  return suggested > 0 && (!(market > 0) || market < suggested - 0.0001);", "  return suggested > 0 && market > 0 && market < suggested - 0.0001;"]], T],
  ["ب", "«اعتمد بالسعر المربح» offered without a suggested price", [[PR,
    "  return suggested > 0 && (!(market > 0) || market < suggested - 0.0001);", "  return !(market > 0) || market < suggested - 0.0001;"]], T],
  ["ب", "the choice «اعتمد بالسعر المربح» is not in the message", [[PR,
    "    ...(offersProfitChoice(l) ? [{ id: `pexc_p_${l.id}`, title: PROFIT_BUTTON_TITLE, description: `${money(Number(l.x_suggested_price))} ر.س` }] : []),\n", ""]], T],
  ["ب", "four choices cut to three reply buttons (no list)", [[PR,
    "const content = choices.length <= 3 ? buttonsContent(text, choices.map(({ id, title }) => ({ id, title }))) : listContent(text, DECISION_LIST_BUTTON, choices);", "const content = buttonsContent(text, choices.map(({ id, title }) => ({ id, title })));"]], T],
  ["ب", "three choices sent as a list too", [[PR,
    "const content = choices.length <= 3 ? buttonsContent(", "const content = choices.length <= 2 ? buttonsContent("]], T],
  ["ب", "the message does not carry the suggested price", [[PR,
    "    suggested,\n    `السبب: ${l.x_reason || \"—\"}`,", "    `السبب: ${l.x_reason || \"—\"}`,"]], T],
  ["ب", "the message's suggested line without the break-even", [[PR,
    "${Number(l.x_break_even) > 0 ? ` · أقل سعر بيع بدون خسارة: ${money(Number(l.x_break_even))}` : \"\"}`", "`"]], T],
  ["ب", "the tap «اعتمد بالسعر المربح» is not a price decision", [[PR,
    "export const PRICE_EXCEPTION_PAYLOAD = /^pexc_([mspe])_(\\d+)$/;", "export const PRICE_EXCEPTION_PAYLOAD = /^pexc_([mse])_(\\d+)$/;"]], T],
  ["ب", "«اعتمد بالسعر المربح» taken without a suggested price", [[PR,
    "    if (!(suggested > 0)) return `لا سعر مربح مقترح لـ ${name} اليوم (لا سعر شراء، أو تكلفة اليوم لا تُقرأ): اختر «لا تنشر» أو «عدّل».`;\n", ""]], T],
  ["ب", "the tap does not keep the price he saw", [[PR,
    "{ x_decision: \"profit\", x_manual_price: suggested, x_manual_for: \"profit\", x_status: \"manual\",", "{ x_decision: \"profit\", x_manual_price: 0, x_manual_for: \"profit\", x_status: \"manual\","]], T],
  ["ب", "the tap approves at the market price", [[PR,
    "x_reason: \"براء: اعتمد بالسعر المربح\", x_sale_price: suggested, x_excluded: false }", "x_reason: \"براء: اعتمد بالسعر المربح\", x_sale_price: Number(l.x_market_price) || 0, x_excluded: false }"]], T],
  ["ب", "no board after «اعتمد بالسعر المربح»", [[PR,
    "    if (ok) await boardAfterDecision(env, day.id, now);\n    return ok ? `✅ ${name}: يُنشر بالسعر المربح", "    return ok ? `✅ ${name}: يُنشر بالسعر المربح"]], T],
  ["ب", "his tap on the list row is not wired in /webhook", [[IX,
    "/^pexc_[mspe]_\\d+$/.test(msg.buttonId ?? \"\")", "/^pexc_[mse]_\\d+$/.test(msg.buttonId ?? \"\")"]], T],
  ["ب", "the card does not show the suggested price", [[VW,
    "\n            <div class=\"d-flex justify-content-between fw-bold\"><span>السعر المربح المقترح</span><field name=\"x_suggested_price\"/></div>", ""]], T],
  ["ب", "the card does not show the break-even", [[VW,
    "\n            <div class=\"d-flex justify-content-between\"><span class=\"text-muted\">أقل سعر بيع بدون خسارة</span><field name=\"x_break_even\"/></div>", ""]], T],
  ["ب", "the list does not show the two columns", [[VW,
    "\n  <field name=\"x_break_even\"/>\n  <field name=\"x_suggested_price\"/>`;", "`;"]], T],
  ["ب", "«الهامش الأدنى ٪» is not in the settings form", [[VW,
    "\n        <field name=\"x_min_margin_pct\"/>`;", "`;"]], T],
  // ---------------------------------------------------------------- ج the day of 10-01, and the new-product alert
  ["ج", "a «فات الموعد» day is not computed by the engine", [[PR,
    "  if (found && (found.x_state === \"approved\" || found.x_state === \"published\")) {", "  if (found && found.x_state !== \"draft\") {"]], T],
  ["ج", "the line of a product not for sale loses its purchase price", [[PR,
    "x_reason: \"ليس في الكتالوج النشط اليوم\", x_sale_price: 0, x_excluded: true, ...b });", "x_reason: \"ليس في الكتالوج النشط اليوم\", x_sale_price: 0, x_excluded: true, ...b, x_cost_price: 0 });"]], T],
  ["ج", "the line of a product not for sale gets no board numbers", [[PR,
    "x_reason: \"ليس في الكتالوج النشط اليوم\", x_sale_price: 0, x_excluded: true, ...b });", "x_reason: \"ليس في الكتالوج النشط اليوم\", x_sale_price: 0, x_excluded: true });"]], T],
  ["ج", "the new-product tick reads every product (the flag ignored)", [[PSF,
    "    domain: [[NEW_FLAG, \"=\", true]],", "    domain: [],"]], T],
  ["ج", "the new-product tick reads the products whose flag is off", [[PSF,
    "    domain: [[NEW_FLAG, \"=\", true]],", "    domain: [[NEW_FLAG, \"!=\", true]],"]], T],
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
writeFileSync(new URL("../artifacts/s47-20261001-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
