// Mutation check for § 48 (2026-10-01): each mutation disables ONE guard of a part, runs that part's
// test file, and must make it fail. The source is restored in `finally` after every run; a pattern
// that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// some mutations edit scripts/lib/s48-odoo-views.mjs in place, and an Odoo setup script reading a
// mutated lib would write it to the tenant.
//
//   node scripts/mutation/s48-20261001-mutations.mjs [أ|ب|ج|د|و …]     (no argument: every part)
//
// Out: scripts/artifacts/s48-20261001-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
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
const UI = "scripts/lib/s48-ui.mjs";
const PLC = "src/places.ts";
const OW = "src/owner-window.ts";
const PSF = "src/product-setup.ts";
const SPF = "src/supplier-pay.ts";
const DOC = "docs/OPERATING-DAY.md";

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
    "\"x_expected_cartons\", \"x_min_profit_sar\", \"x_outlier_ratio\", \"x_market_uplift_pct\"],", "\"x_expected_cartons\", \"x_min_profit_sar\", \"x_outlier_ratio\", \"x_market_uplift_pct\", \"x_min_margin_pct\"],"]], T],
  ["أ", "the minimum profit read from «الهامش الأدنى ٪»", [[OC,
    "    minProfit: typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,", "    minProfit: typeof (r as any).x_min_margin_pct === \"number\" ? Math.max(0, (r as any).x_min_margin_pct) : typeof r.x_min_profit_sar === \"number\" ? Math.max(0, r.x_min_profit_sar) : DEFAULT_MIN_PROFIT_SAR,"]], T],
  ["أ", "a market price equal to the suggested price is an exception", [[EN,
    "      if (suggested !== null) { if (sale < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (sale <= suggested) exceptions.push(\"below_profit\"); }"]], T],
  ["أ", "an automatic line sells at the suggested price, not the market price", [[EN,
    "  return { status: \"auto\", sale: round2(p.sale as number), excluded: false, reason: \"\" };", "  return { status: \"auto\", sale: round2(p.suggested ?? (p.sale as number)), excluded: false, reason: \"\" };"]], T],
  ["أ", "a change of «الربح الأدنى للكرتون» does not recompute the day", [[PR,
    "    rec.id, rec.x_state, settings.wastePct, settings.minProfit, settings.marketUpliftPct, vat.ratePct,", "    rec.id, rec.x_state, settings.wastePct, settings.marketUpliftPct, vat.ratePct,"]], T],
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
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.sale, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: v.sale > 0 ? v.sale : (p.suggested ?? p.sale), approved: v.sale > 0, wastePct: settings.wastePct,"]], T],
  ["ج", "the engine's approved line still gets a preview", [[PR,
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.sale, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.sale, approved: false, wastePct: settings.wastePct,"]], T],
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
    "    return { saved: 0, reply: marketUnreadText(src.role ?? null, src.outside === true) };", "    return null;"]], T],
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
  // ---------------------------------------------------------------- و «💲 التسعير»: the places, the confirmation, the settings, the screens' Python
  ["و", "the missed-day alert still sends Baraa to «💰 أسعار اليوم»", [[PR,
    "    `لا تُعاد أسعار أمس. قرارك ثم «نشر المعتمد الآن» في ${PLACE_TODAY} ينشر عادي.`,", "    \"لا تُعاد أسعار أمس. قرارك ثم «نشر المعتمد الآن» في «💰 أسعار اليوم» ينشر عادي.\","]], T],
  ["و", "the late-decision reply names the old place", [[PR,
    "` السجل «فات الموعد»: انشر من ${PLACE_TODAY} بزر «نشر المعتمد الآن».` : \"\";", "\" السجل «فات الموعد»: انشر من «💰 أسعار اليوم» ← «نشر المعتمد الآن».\" : \"\";"]], T],
  ["و", "the screen's name is not under «💲 التسعير»", [[PLC,
    "const place = (screen: string): string => `«${PRICING_MENU}» ← «${screen}»`;", "const place = (screen: string): string => `«${screen}»`;"]], T],
  ["و", "«📊 اليوم» is named «💰 أسعار اليوم»", [[PLC,
    "export const PLACE_TODAY = place(\"📊 اليوم\");", "export const PLACE_TODAY = place(\"💰 أسعار اليوم\");"]], T],
  ["و", "the settings' place is the old «⚙️ إعدادات التسعير»", [[PB,
    "  if (cartons === null) notes.push(`«الكراتين المتوقعة يومياً» فارغة في ${PLACE_SETTINGS}: لا حصة تشغيل.`);", "  if (cartons === null) notes.push(\"«الكراتين المتوقعة يومياً» فارغة في «⚙️ إعدادات التسعير»: لا حصة تشغيل.\");"]], T],
  ["و", "the review reminder names the old place", [[OW,
    "التفاصيل في ${PLACE_TODAY}.`;", "التفاصيل في «💰 أسعار اليوم».`;"]], T],
  ["و", "the new-product alert does not say where to complete it", [[PSF,
    "    `أكمله من ${PLACE_PRODUCTS}.`,\n", ""]], T],
  ["و", "a supplier due without a price points at the old «الأسعار اليومية»", [[SPF,
    "        `أدخل سعر المورد لذلك اليوم في ${PLACE_SOURCES} (ردود الشراء)، وتُحسب", "        `أدخل سعر المورد لذلك اليوم في «الأسعار اليومية»، وتُحسب"]], T],
  ["و", "the engine does not write the recipients' count", [[PR,
    "vals: { ...boardHeader(share, board, now), ...(await recipientsCount(env)) } });", "vals: { ...boardHeader(share, board, now) } });"]], T],
  ["و", "a board rewrite does not bring the recipients' count up to date", [[PR,
    "...(opts.dry ? {} : await recipientsCount(env)) };", "};"]], T],
  ["و", "the recipients' count is every customer (the opted-out too)", [[PR,
    "    return { x_n_recipients: (await priceRecipients(env)).length };", "    return { x_n_recipients: (await call<Array<{ id: number }>>(env, \"res.partner\", \"search_read\", { domain: [[\"customer_rank\", \">\", 0]], fields: [\"id\"] })).length };"]], T],
  ["و", "the outlier ratio is not read from the settings", [[OC,
    "    outlierRatio: typeof r.x_outlier_ratio === \"number\" && r.x_outlier_ratio > 1 ? r.x_outlier_ratio : PRICE_OUTLIER_RATIO,", "    outlierRatio: PRICE_OUTLIER_RATIO,"]], T],
  ["و", "a ratio not above 1 is taken as it is", [[OC,
    "    outlierRatio: typeof r.x_outlier_ratio === \"number\" && r.x_outlier_ratio > 1 ? r.x_outlier_ratio : PRICE_OUTLIER_RATIO,", "    outlierRatio: typeof r.x_outlier_ratio === \"number\" ? r.x_outlier_ratio : PRICE_OUTLIER_RATIO,"]], T],
  ["و", "no settings record: the ratio is 0 (every price an outlier)", [[OC,
    "    return (await readPricingSettings(env, day))?.outlierRatio ?? PRICE_OUTLIER_RATIO;", "    return (await readPricingSettings(env, day))?.outlierRatio ?? 0;"]], T],
  ["و", "the supplier's outlier ignores the settings' ratio", [[SU,
    "      const outlier = !!last && isPriceOutlier(last.price, p.cost_price, outlierRatio);", "      const outlier = !!last && isPriceOutlier(last.price, p.cost_price);"]], T],
  ["و", "isPriceOutlier ignores the ratio it is given", [[SU,
    "  return Math.max(last, next) / Math.min(last, next) >= ratio;\n}\n\n", "  return Math.max(last, next) / Math.min(last, next) >= PRICE_OUTLIER_RATIO;\n}\n\n"]], T],
  ["و", "a market observation's outlier ignores the ratio", [[PS,
    "  const mOut = isOutlier(lastM, o.market, o.ratio);", "  const mOut = isOutlier(lastM, o.market);"]], T],
  ["و", "a source's reply does not pass the settings' ratio", [[PS,
    "        purchase: k.purchase, market: k.market, qty: k.qty, messageId, text, ratio,", "        purchase: k.purchase, market: k.market, qty: k.qty, messageId, text,"]], T],
  ["و", "a weighed packaging without a weight is not «missing» for the alert", [[PSF,
    "  else if (WEIGHED_TYPES.includes(String(def.x_type || \"\")) && !(Number(def.x_approx_weight_kg) > 0)) out.push(\"وزن التعبئة (بلا وزن)\");\n", ""]], T],
  ["و", "a packaging sold by the piece is asked for a weight", [[PSF,
    "export const WEIGHED_TYPES = [\"carton\", \"bag\", \"foam\"];", "export const WEIGHED_TYPES = [\"carton\", \"bag\", \"foam\", \"piece\"];"]], T],
  ["و", "«الناقص» in Odoo does not ask for the supplier", [[UI,
    "    if not record.x_supplier_ids:\n        out.append('${MISSING_LABEL.supplier}')\n", ""]], T],
  ["و", "«الناقص» in Odoo takes any category as a produce category", [[UI,
    "        ok = (c.name or '').strip() in REF\n", "        ok = True\n"]], T],
  ["و", "«الناقص» in Odoo does not walk up to the parent category", [[UI,
    "        c = c.parent_id\n        hops += 1\n    if not ok:", "        c = False\n        hops += 1\n    if not ok:"]], T],
  ["و", "«الناقص» in Odoo misses a carton without a weight", [[UI,
    "    elif d.x_type in ('carton', 'bag', 'foam') and not (d.x_approx_weight_kg > 0):\n        out.append('${MISSING_LABEL.noWeight}')\n", ""]], T],
  ["و", "«الناقص» in Odoo counts a bag of 8 kg as the temporary carton", [[UI,
    "    elif d.x_type == 'carton' and d.x_approx_weight_kg == 8:", "    elif d.x_approx_weight_kg == 8:"]], T],
  ["و", "«الناقص» in Odoo looks at any packaging, not the default one", [[UI,
    "    d = packs.filtered(lambda k: k.x_is_default)[:1] or packs[:1]\n    if not d:", "    d = packs[:1]\n    if not d:"]], T],
  ["و", "the default packaging of the list is the first one, default or not", [[UI,
    "    record['x_pack_id'] = packs.filtered(lambda k: k.x_is_default)[:1] or packs[:1]`;", "    record['x_pack_id'] = packs[:1]`;"]], T],
  ["و", "the filter «ناقص» is not the same field", [[UI,
    "  <filter name=\"f_missing\" string=\"ناقص\" domain=\"[('x_missing', '!=', False)]\"/>", "  <filter name=\"f_missing\" string=\"ناقص\" domain=\"[('x_is_active_for_sale', '=', False)]\"/>"]], T],
  ["و", "the products' list shows the services too", [[UI,
    "export const productsDomain = (c) => `[('type', '!=', 'service'), '|',", "export const productsDomain = (c) => `['|',"]], T],
  ["و", "«📊 اليوم» creates today's record when it is missing", [[UI,
    "missing = not rec\nif not rec:\n    rec = Day.search([('x_date', '<', today), ('x_utak_simulation', '=', False)], order='x_date desc, id desc', limit=1)", "missing = not rec\nif not rec:\n    Day.create({'x_date': today})\n    rec = Day.search([('x_date', '<', today), ('x_utak_simulation', '=', False)], order='x_date desc, id desc', limit=1)"]], T],
  ["و", "«📊 اليوم» opens the simulation's record of the day", [[UI,
    "rec = Day.search([('x_date', '=', today), ('x_utak_simulation', '=', False)], order='id', limit=1)", "rec = Day.search([('x_date', '=', today)], order='id desc', limit=1)"]], T],
  ["و", "no record today: the last day opens without its note", [[UI,
    ", 'context': {'utak_no_today': missing, 'utak_view': 'sources' if sources else 'day'}\")}`;\nexport const stepDayCode", ", 'context': {'utak_no_today': False, 'utak_view': 'sources' if sources else 'day'}\")}`;\nexport const stepDayCode"]], T],
  ["و", "the day is the UTC day, not Riyadh's", [[UI,
    "const RIYADH_TODAY = \"(datetime.datetime.now() + datetime.timedelta(hours=3)).date()\";", "const RIYADH_TODAY = \"datetime.datetime.now().date()\";"]], T],
  ["و", "the day before / after stops on a simulation day", [[UI,
    "rec = Day.search([('x_date', '${dir === \"prev\" ? \"<\" : \">\"}', record.x_date), ('x_utak_simulation', '=', False)],", "rec = Day.search([('x_date', '${dir === \"prev\" ? \"<\" : \">\"}', record.x_date)],"]], T],
  ["و", "the day before / after leaves the sources screen for the day's", [[UI,
    "${pick(v)}\n${openForm(\"rec.id\", \"view\", \"name\", \", 'context': {'utak_no_today': False,", "sources = False\nview = ${v.day}\nname = '${MENU.today}'\n${openForm(\"rec.id\", \"view\", \"name\", \", 'context': {'utak_no_today': False,"]], T],
  ["و", "«نشر المعتمد الآن» is confirmed on a published day too", [[UI,
    "export const confirmCode = (v) => `if record.x_state not in ('draft', 'missed'):\n    raise UserError('لا يُنشر إلا سجل «مسودة» أو «فات الموعد».')\n", "export const confirmCode = (v) => `"]], T],
  ["و", "the confirmation opens as a full page, not a dialog", [[UI,
    "'views': [[${v.confirm}, 'form']], 'target': 'new'}`;", "'views': [[${v.confirm}, 'form']], 'target': 'current'}`;"]], T],
  ["و", "«نشر المعتمد الآن» publishes at one tap (no confirmation)", [[UI,
    "    <button name=\"${a.confirm}\" type=\"action\" string=\"نشر المعتمد الآن\"", "    <button name=\"${a.approve}\" type=\"action\" string=\"نشر المعتمد الآن\""]], T],
  ["و", "the confirmation does not name the customers", [[UI,
    "      <field name=\"x_n_recipients\" string=\"العملاء الذين ستصلهم\" readonly=\"1\"/>\n", ""]], T],
  ["و", "the confirmation does not say it sends for real", [[UI,
    "<strong>هذا يرسل رسائل واتساب فعلية للعملاء الآن، ولا يُتراجع عنه.</strong>", "<strong>تأكيد.</strong>"]], T],
  ["و", "the confirmation's button shows with nothing to publish", [[UI,
    "class=\"btn-primary\" invisible=\"not x_n_publishable\" close=\"1\"/>", "class=\"btn-primary\" close=\"1\"/>"]], T],
  ["و", "an excluded line counts among the items to publish", [[UI,
    "const PUBLISHABLE = \"record.x_line_ids.filtered(lambda l: l.x_status in ('auto', 'manual') and not l.x_excluded and l.x_sale_price > 0)\";", "const PUBLISHABLE = \"record.x_line_ids.filtered(lambda l: l.x_status in ('auto', 'manual') and l.x_sale_price > 0)\";"]], T],
  ["و", "an exception counts among the items to publish", [[UI,
    "const PUBLISHABLE = \"record.x_line_ids.filtered(lambda l: l.x_status in ('auto', 'manual') and not l.x_excluded and l.x_sale_price > 0)\";", "const PUBLISHABLE = \"record.x_line_ids.filtered(lambda l: not l.x_excluded or l.x_status == 'exception')\";"]], T],
  ["و", "the settings do not attach a cost line created elsewhere", [[UI,
    "stray = env['x_operating_cost'].search([('x_config_id', '!=', rec.id)])\nif stray:\n    stray.write({'x_config_id': rec.id})\n", ""]], T],
  ["و", "«قرار براء» cannot be chosen in the row", [[UI,
    "        <field name=\"x_decision\" string=\"قرار براء\"/>\n        <field name=\"x_manual_price\" string=\"السعر المعدّل\" invisible=\"x_decision != 'edit' and not x_manual_price\"/>\n        <field name=\"x_offers\"", "        <field name=\"x_decision\" string=\"قرار براء\" readonly=\"1\"/>\n        <field name=\"x_manual_price\" string=\"السعر المعدّل\" invisible=\"x_decision != 'edit' and not x_manual_price\"/>\n        <field name=\"x_offers\""]], T],
  ["و", "the lines' table shows the raw sale number (0.00)", [[UI,
    "        <field name=\"x_sale_show\" string=\"البيع\"/>\n        <field name=\"x_profit_show\" string=\"الربح / المعاينة\" decoration-it=", "        <field name=\"x_sale_price\" string=\"البيع\"/>\n        <field name=\"x_profit_show\" string=\"الربح / المعاينة\" decoration-it="]], T],
  ["و", "the phone gets the table, not cards", [[UI,
    "    <field name=\"x_line_ids\" readonly=\"x_state not in ('draft', 'missed')\" mode=\"list,kanban\">", "    <field name=\"x_line_ids\" readonly=\"x_state not in ('draft', 'missed')\" mode=\"list\">"]], T],
  ["و", "the card's preview is not set apart", [[UI,
    "<span t-attf-class=\"#{!record.x_sale_price.raw_value and record.x_preview_sale.raw_value ? 'fst-italic' : ''}\"><field name=\"x_profit_show\"/></span>", "<span><field name=\"x_profit_show\"/></span>"]], T],
  ["و", "the card uses a filled badge for the status", [[UI,
    "              <field name=\"x_board_status\" class=\"text-nowrap ms-2\"/>\n            </div>\n            <div class=\"d-flex justify-content-between\"><span class=\"text-muted\">الشراء</span>", "              <field name=\"x_board_status\" widget=\"badge\" class=\"text-nowrap ms-2\"/>\n            </div>\n            <div class=\"d-flex justify-content-between\"><span class=\"text-muted\">الشراء</span>"]], T],
  ["و", "the day's screen has no note for a day that is not today", [[UI,
    "    <div class=\"alert alert-warning\" role=\"alert\" invisible=\"not context.get('utak_no_today')\">لا يوجد سجل أسعار لليوم بعد (يبنيه النظام مع أول سعر يصل، أو عند 04:00). المعروض آخر يوم مسجَّل.</div>\n", ""]], T],
  ["و", "an old pricing menu stays visible", [[UI,
    "  [537, \"معاملات التسعير\"], [555, \"الأصناف\"], [556, \"التغليف\"],", "  [537, \"معاملات التسعير\"], [555, \"الأصناف\"],"]], T],
  ["و", "the menu's name differs from the worker's texts", [[UI,
    "export const MENU = { root: \"💲 التسعير\", today: \"📊 اليوم\",", "export const MENU = { root: \"💲 التسعير\", today: \"📊 أسعار اليوم\","]], T],
  ["و", "the guide still sends Baraa to «💰 أسعار اليوم»", [[DOC,
    "بعد قرار متأخر من **💲 التسعير ← 📊 اليوم** |", "بعد قرار متأخر من **💰 أسعار اليوم** |"]], T],
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
writeFileSync(new URL("../artifacts/s48-20261001-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
