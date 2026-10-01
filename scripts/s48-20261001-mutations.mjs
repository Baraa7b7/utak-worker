// Mutation check for § 48 (2026-10-01): each mutation disables ONE guard of a part, runs that part's
// test file, and must make it fail. The source is restored in `finally` after every run; a pattern
// that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// some mutations edit scripts/lib/s48-odoo-views.mjs in place, and an Odoo setup script reading a
// mutated lib would write it to the tenant.
//
//   node scripts/s48-20261001-mutations.mjs [أ|ب|ج|د|و …]     (no argument: every part)
//
// Out: scripts/artifacts/s48-20261001-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/s48.test.mts";
const T47 = "tests/s47.test.mts";
const EN = "src/pricing-engine.ts";
const PB = "src/pricing-board.ts";
const PR = "src/prices.ts";
const OC = "src/operating-cost.ts";
const OD = "src/odoo.ts";
const PS = "src/price-sources.ts";
const SU = "src/suppliers.ts";
const VW = "scripts/lib/s48-odoo-views.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  ["أ", "the suggested price by the percentage of § 47 (full cost × 1.05 × 1.15)", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep((fullH * 105 * vat) / 1e6),"]], T],
  ["أ", "the minimum profit added after the VAT", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep((fullH * vat) / 1e4 + Math.max(0, a.minProfit)),"]], T],
  ["أ", "the minimum profit doubled", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep(((fullH + 2 * halalas(Math.max(0, a.minProfit))) * vat) / 1e4),"]], T],
  ["أ", "a negative amount lowers the suggested price below the break-even", [[EN,
    "    suggested: ceilToStep(((fullH + halalas(Math.max(0, a.minProfit))) * vat) / 1e4),", "    suggested: ceilToStep(((fullH + halalas(a.minProfit)) * vat) / 1e4),"]], T],
  ["أ", "the suggested price rounded to the nearest half riyal, not up", [[EN,
    "  return round2(Math.ceil(x / step - 1e-6) * step);", "  return round2(Math.round(x / step) * step);"]], T],
  ["أ", "the suggested price rounded up to a whole riyal", [[EN,
    "export const SUGGESTED_STEP = 0.5;", "export const SUGGESTED_STEP = 1;"]], T],
  ["أ", "the default minimum profit is 5", [[EN,
    "export const DEFAULT_MIN_PROFIT_SAR = 2;", "export const DEFAULT_MIN_PROFIT_SAR = 5;"]], T],
  ["أ", "«الهامش الأدنى ٪» still read from the settings", [[OC,
    "\"x_expected_cartons\", \"x_min_profit_sar\"],", "\"x_expected_cartons\", \"x_min_profit_sar\", \"x_min_margin_pct\"],"]], T],
  ["أ", "the minimum profit read from «الهامش الأدنى ٪»", [[OC,
    "    minProfit: typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,", "    minProfit: typeof (r as any).x_min_margin_pct === \"number\" ? Math.max(0, (r as any).x_min_margin_pct) : typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,"]], T],
  ["أ", "a market price equal to the suggested price is an exception", [[EN,
    "      if (suggested !== null) { if (market < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (market <= suggested) exceptions.push(\"below_profit\"); }"]], T],
  ["أ", "an automatic line sells at the suggested price, not the market price", [[EN,
    "  return { status: \"auto\", sale: round2(p.market as number), excluded: false, reason: \"\" };", "  return { status: \"auto\", sale: round2(p.suggested ?? (p.market as number)), excluded: false, reason: \"\" };"]], T],
  ["أ", "a change of «الربح الأدنى للكرتون» does not recompute the day", [[PR,
    "    rec.id, rec.x_state, settings.wastePct, settings.minProfit, vat.ratePct,", "    rec.id, rec.x_state, settings.wastePct, vat.ratePct,"]], T],
  ["ب", "the supplier row's fallback is the purchase × 1.38 again", [[SU,
    "      const sale = fallbackSale(p.cost_price, floorInputs);", "      const sale = round2(p.cost_price * 1.38);"]], T],
  ["ب", "no floor inputs: the fallback is a guessed purchase × 1.38", [[PB,
    "  if (!f) return 0;", "  if (!f) return round2(purchase * 1.38);"]], T],
  ["ب", "no carton share: the fallback is the purchase price itself", [[PB,
    "opShare: f.opShare, vatRatePct: f.vatRatePct, minProfit: f.minProfit })?.suggested ?? 0;", "opShare: f.opShare, vatRatePct: f.vatRatePct, minProfit: f.minProfit })?.suggested ?? purchase;"]], T],
  ["ب", "the fallback ignores the settings' minimum profit", [[PB,
    "  return { wastePct: settings.wastePct, opShare: share.share, minProfit: settings.minProfit, vatRatePct: profitVatRate(day) };", "  return { wastePct: settings.wastePct, opShare: share.share, minProfit: 0, vatRatePct: profitVatRate(day) };"]], T],
  ["ب", "the fallback made without the VAT", [[PB,
    "  return { wastePct: settings.wastePct, opShare: share.share, minProfit: settings.minProfit, vatRatePct: profitVatRate(day) };", "  return { wastePct: settings.wastePct, opShare: share.share, minProfit: settings.minProfit, vatRatePct: null };"]], T],
  ["ب", "the engine does not keep the supplier rows' fallback in step", [[PR,
    "  await syncFallbackSale(env, day, offers, floor);\n", ""]], T],
  ["ب", "a row that already carries a fallback is never corrected", [[PR,
    "    if (Math.abs((o.saleStored ?? 0) - want) < 0.0001) continue;", "    if ((o.saleStored ?? 0) > 0) continue;"]], T],
  ["ب", "no suggested price: the old fallback stays on the row", [[PR,
    "    const want = fallbackSale(o.price, floor);", "    const want = fallbackSale(o.price, floor) || (o.saleStored ?? 0);"]], T],
  ["ب", "the row's stored fallback is not in the engine's fingerprint", [[PR,
    "o.partnerId, o.saleStored ?? 0]),", "o.partnerId]),"]], T],
  ["ب", "the fingerprint kept is the one before the rows were written (the next tick recomputes)", [[PR,
    "  await syncFallbackSale(env, day, offers, floor);\n  // …and the fingerprint kept is the one of the rows as they are now (the next tick is «unchanged»)\n  const fp = fingerprint();", "  const fp = fingerprint();\n  await syncFallbackSale(env, day, offers, floor);"]], T],
  ["ب", "the engine writes a simulation row's fallback", [[EN,
    "[\"x_supplier_id\", \"in\", ids], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_supplier_id\", \"in\", ids]],"]], T],
  ["ب", "the quotation does not take the day's line's suggested price", [[OD,
    "    if (suggested > 0) return { price: suggested, source: \"today\", price_date: today, age_days: 0 };\n", ""]], T],
  ["ب", "a line with a purchase price and no suggested price falls back to an older price", [[OD,
    "    if (Number(line?.x_cost_price ?? 0) > 0) return { price: 0, source: \"missing\", price_date: null, age_days: null };\n", ""]], T],
  ["ب", "a simulation day's line is a price", [[OD,
    "        [\"x_day_id.x_utak_simulation\", \"!=\", true],\n        [\"x_utak_simulation\", \"!=\", true],\n", "        [\"x_utak_simulation\", \"!=\", true],\n"]], T],
  ["ب", "a purchase price today without a fallback takes an older day's price", [[OD,
    "  if (bare.length) return { price: 0, source: \"missing\", price_date: null, age_days: null };\n", ""]], T],
  ["ب", "a simulation row counts as today's purchase price", [[OD,
    "      [\"x_extraction_status\", \"!=\", \"failed\"],\n      [\"x_utak_simulation\", \"!=\", true],\n    ],\n    fields: [\"id\"],", "      [\"x_extraction_status\", \"!=\", \"failed\"],\n    ],\n    fields: [\"id\"],"]], T],
  ["ج", "an approved line keeps a preview", [[PB,
    "  const preview = i.approved !== true && suggested > 0;", "  const preview = suggested > 0;"]], T],
  ["ج", "no preview at all", [[PB,
    "  const preview = i.approved !== true && suggested > 0;", "  const preview = false;"]], T],
  ["ج", "the preview's profit made from the market price", [[PB,
    "    x_preview_profit: preview ? round2(round2(suggested / d) - fullCost) : 0,", "    x_preview_profit: preview ? round2(netSale - fullCost) : 0,"]], T],
  ["ج", "the preview's profit without taking the VAT out", [[PB,
    "    x_preview_profit: preview ? round2(round2(suggested / d) - fullCost) : 0,", "    x_preview_profit: preview ? round2(suggested - fullCost) : 0,"]], T],
  ["ج", "the preview's sale is the break-even, not the suggested price", [[PB,
    "    x_preview_sale: preview ? suggested : 0,", "    x_preview_sale: preview ? (fl?.breakEven ?? 0) : 0,"]], T],
  ["ج", "the real profit of an unapproved line is made from the suggested price (the preview takes its place)", [[PR,
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.market, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: v.sale > 0 ? v.sale : (p.suggested ?? p.market), approved: v.sale > 0, wastePct: settings.wastePct,"]], T],
  ["ج", "the engine's approved line still gets a preview", [[PR,
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.market, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.market, approved: false, wastePct: settings.wastePct,"]], T],
  ["ج", "a stored approved line still gets a preview (after a decision)", [[PR,
    "    approved: Number(l.x_sale_price) > 0,\n", ""]], T],
  ["ج", "the preview is not among the board's fields", [[PB,
    "\"x_board_status\", \"x_preview_sale\", \"x_preview_profit\"] as const;", "\"x_board_status\"] as const;"]], T],
  ["ج", "a line leaving the catalog keeps the board of its old approved price (no preview)", [[PR,
    "    const b = storedBoardLine({ ...l, x_sale_price: 0 }, settings.wastePct, vat.ratePct, share.share, settings.minProfit);", "    const b = storedBoardLine(l, settings.wastePct, vat.ratePct, share.share, settings.minProfit);"]], T],
  ["ج", "a missing value shows 0.00", [[VW,
    "    record['${field}'] = ('%.2f' % value) if value else '—'`;", "    record['${field}'] = '%.2f' % value`;"]], T],
  ["ج", "the preview shown without the word «معاينة»", [[VW,
    "        record['x_profit_show'] = 'معاينة %.2f' % record.x_preview_profit", "        record['x_profit_show'] = '%.2f' % record.x_preview_profit"]], T],
  ["ج", "an unapproved line shows the market's profit, not its preview", [[VW,
    "    if record.x_sale_price:\n        record['x_profit_show'] = '%.2f' % record.x_real_profit", "    if record.x_sale_price or record.x_real_profit:\n        record['x_profit_show'] = '%.2f' % record.x_real_profit"]], T],
  ["ج", "a line with neither shows 0.00", [[VW,
    "    else:\n        record['x_profit_show'] = '—'`;", "    else:\n        record['x_profit_show'] = '0.00'`;"]], T],
  ["ج", "«معاينة» not set apart (no italics)", [[VW,
    " decoration-it=\"not x_sale_price and x_preview_sale\"/>", "/>"]], T],
  ["ج", "the day's list shows the raw market number (0.00)", [[VW,
    "        <field name=\"x_market_show\" string=\"السوق\"/>", "        <field name=\"x_market_show\" column_invisible=\"1\"/>"]], T],
  ["ج", "«السعر المعدّل» shows 0.00 on every line", [[VW,
    "        <field name=\"x_manual_price\" invisible=\"x_decision != 'edit' and not x_manual_price\"/>`;", "        <field name=\"x_manual_price\"/>`;"]], T],
  ["ج", "the explanation still says the percentage", [[VW,
    "«المقترح» = (التكلفة الكاملة + الربح الأدنى للكرتون) × 1.15، لأعلى لأقرب نصف ريال. القاعدة", "«المقترح» = التكلفة الكاملة × (1 + الهامش الأدنى ٪) × 1.15، لأعلى لأقرب نصف ريال. القاعدة"]], T],
  ["د", "a «فات الموعد» day is not computed by the engine", [[PR,
    "  if (found && (found.x_state === \"approved\" || found.x_state === \"published\")) {", "  if (found && found.x_state !== \"draft\") {"]], T],
  ["د", "the tick does not apply a decision taken in Odoo", [[PR,
    "  try { out.decisions = await applyOdooDecisions(env, now); } catch (e) { out.decisions = { error: (e as Error)?.message ?? String(e) }; }\n", ""]], T],
  ["د", "the tick recomputes an approved / published day for a decision", [[PR,
    "      [\"x_day_id.x_state\", \"in\", [\"draft\", \"missed\"]], [\"x_day_id.x_utak_simulation\", \"!=\", true],", "      [\"x_day_id.x_utak_simulation\", \"!=\", true],"]], T],
  ["د", "the tick recomputes for a decision on a simulation day", [[PR,
    "      [\"x_day_id.x_state\", \"in\", [\"draft\", \"missed\"]], [\"x_day_id.x_utak_simulation\", \"!=\", true],", "      [\"x_day_id.x_state\", \"in\", [\"draft\", \"missed\"]],"]], T],
  ["د", "the tick recomputes the day every five minutes (a decision already seen)", [[PR,
    "      [\"x_decision\", \"!=\", false], [\"x_decided_at\", \"=\", false],", "      [\"x_decision\", \"!=\", false],"]], T],
  ["د", "the tick looks a week back", [[PR,
    "export const ODOO_DECISION_DAYS_BACK = 1;", "export const ODOO_DECISION_DAYS_BACK = 7;"]], T],
  ["د", "the tick looks at today alone", [[PR,
    "  const from = riyadhDateKey(new Date(now - ODOO_DECISION_DAYS_BACK * 24 * 3600_000));", "  const from = today;"]], T],
  ["د", "a decision on a line outside the catalog is never marked seen", [[PR,
    "    if (l.x_decision && !l.x_decided_at) vals.x_decided_at = nowOdoo(now);\n", ""]], T],
  ["د", "a decision chosen in Odoo is not stamped with its time", [[PR,
    "    if (decision && !l.x_decided_at) want.x_decided_at = nowOdoo(now);\n", ""]], T],
  ["د", "a decision inherits the price fixed for another decision", [[EN,
    "  if (l.x_decision === \"market\" || l.x_decision === \"profit\") return !l.x_manual_for || l.x_manual_for === l.x_decision ? price : 0;", "  if (l.x_decision === \"market\" || l.x_decision === \"profit\") return price;"]], T],
  ["د", "a price fixed before § 48 (no mark) is dropped", [[EN,
    "return !l.x_manual_for || l.x_manual_for === l.x_decision ? price : 0;", "return l.x_manual_for === l.x_decision ? price : 0;"]], T],
  ["د", "«سعر معدّل» loses his number when it was fixed for another decision", [[EN,
    " ? price : 0;\n  return price;\n}", " ? price : 0;\n  return !l.x_manual_for || l.x_manual_for === l.x_decision ? price : 0;\n}"]], T],
  ["د", "the engine reads the raw «السعر المعدّل», whatever it was fixed for", [[PR,
    "    const fixed = l ? fixedPrice(l) : 0;", "    const fixed = Number(l?.x_manual_price) || 0;"]], T],
  ["د", "the publication's check reads the raw «السعر المعدّل»", [[EN,
    "    const fixed = fixedPrice(l);\n    if (fixed > 0) return round2(fixed);", "    const fixed = Number(l.x_manual_price) || 0;\n    if (fixed > 0) return round2(fixed);"]], T],
  ["د", "the stale fixed price stays on a line changed to «اعتمد بسعر السوق»", [[PR,
    "  if (decision === \"market\" && v.status === \"manual\") return stale ? { x_manual_price: 0, x_manual_for: false } : fixed > 0 ? { x_manual_for: \"market\" } : {};", "  if (decision === \"market\" && v.status === \"manual\") return fixed > 0 ? { x_manual_for: \"market\" } : {};"]], T],
  ["د", "a market price fixed before § 48 gets no mark", [[PR,
    "  if (decision === \"market\" && v.status === \"manual\") return stale ? { x_manual_price: 0, x_manual_for: false } : fixed > 0 ? { x_manual_for: \"market\" } : {};", "  if (decision === \"market\" && v.status === \"manual\") return stale ? { x_manual_price: 0, x_manual_for: false } : {};"]], T],
  ["د", "the price fixed for «profit» carries no mark", [[PR,
    "  if (decision === \"profit\" && v.status === \"manual\") return { ...(fixed > 0 ? {} : { x_manual_price: v.sale }), x_manual_for: \"profit\" };", "  if (decision === \"profit\" && v.status === \"manual\") return { ...(fixed > 0 ? {} : { x_manual_price: v.sale }) };"]], T],
  ["د", "«اعتمد بالسعر المربح» chosen in Odoo: the suggested price of that run is not kept", [[PR,
    "  if (decision === \"profit\" && v.status === \"manual\") return { ...(fixed > 0 ? {} : { x_manual_price: v.sale }), x_manual_for: \"profit\" };", "  if (decision === \"profit\" && v.status === \"manual\") return { x_manual_for: \"profit\" };"]], T],
  ["د", "«سعر معدّل» carries no mark", [[PR,
    "  if (decision === \"edit\" && v.status === \"manual\") return { x_manual_for: \"edit\" };\n", ""]], T],
  ["د", "the fixed price stays when the decision is removed or «لا تنشر»", [[PR,
    "  if ((!decision || decision === \"skip\") && l.x_manual_for) return { x_manual_price: 0, x_manual_for: false };\n", ""]], T],
  ["د", "the fixed price stays on «لا تنشر»", [[PR,
    "  if ((!decision || decision === \"skip\") && l.x_manual_for) return { x_manual_price: 0, x_manual_for: false };", "  if (!decision && l.x_manual_for) return { x_manual_price: 0, x_manual_for: false };"]], T],
  ["د", "a price Baraa typed with no decision is wiped by the engine", [[PR,
    "  if ((!decision || decision === \"skip\") && l.x_manual_for) return { x_manual_price: 0, x_manual_for: false };", "  if (!decision || decision === \"skip\") return { x_manual_price: 0, x_manual_for: false };"]], T],
  ["د", "the WhatsApp «اعتمد بالسعر المربح» writes no mark", [[PR,
    "{ x_decision: \"profit\", x_manual_price: suggested, x_manual_for: \"profit\", x_status: \"manual\",", "{ x_decision: \"profit\", x_manual_price: suggested, x_status: \"manual\","]], T47],
  ["د", "a simulation row of the day is read by the engine", [[EN,
    "[\"x_supplier_id\", \"in\", ids], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_supplier_id\", \"in\", ids], [\"x_utak_simulation\", \"=\", true]],"]], T],
  ["د", "a source's unreadable reply is an ordinary message again (no alert, «استخدم الأزرار»)", [[PS,
    "    return { saved: 0, reply: MARKET_UNREAD_TEXT };", "    return null;"]], T],
  ["د", "the unreadable reply: Baraa is not told", [[PS,
    "        await sendOwnerAlert(env, marketUnreadAlert(src.name, text, check.dropped.length));\n", ""]], T],
  ["د", "the unreadable reply: the alert repeats with every delivery of the message", [[PS,
    "    if (claim.claimed) {\n      try {\n        const { sendOwnerAlert }", "    if (true) {\n      try {\n        const { sendOwnerAlert }"]], T],
  ["د", "a message without a number raises the alert", [[PS,
    "    if (!hasNumber(text)) return null;\n", ""]], T],
  ["د", "Arabic-Indic digits are not seen as a number", [[PS,
    "const hasNumber = (text: string): boolean => /[0-9٠-٩۰-۹]/.test(text);", "const hasNumber = (text: string): boolean => /[0-9]/.test(text);"]], T],
  ["د", "the alert does not carry his text", [[PS,
    "كتابة اسم الصنف كاملاً.\\n\\nالنص: ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`;", "كتابة اسم الصنف كاملاً.`;"]], T],
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
writeFileSync(new URL("./artifacts/s48-20261001-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
