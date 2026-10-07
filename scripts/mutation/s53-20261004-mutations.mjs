// Mutation check for § 53 (2026-10-04) — price privacy by role (أ), the optional uplift on the market
// price (ب) and the pay reminder that carries the IBAN (هـ): each mutation disables ONE guard, runs
// tests/s53.test.mts, and must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s53-20261004-mutations.mjs [أ|ب|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s53-20261004-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s53.test.mts";
const FL = "src/price-flow.ts";
const PS = "src/price-sources.ts";
const PP = "src/price-privacy.ts";
const GW = "src/wa-gateway.ts";
const PR = "src/prices.ts";
const RV = "src/price-review.ts";
const IX = "src/index.ts";
const EN = "src/pricing-engine.ts";
const OC = "src/operating-cost.ts";
const OUT = "src/outreach.ts";
const LIB = "scripts/lib/s53-odoo.mjs";
const TPL = "scripts/lib/s53-templates.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the form's hints
  ["أ", "an outside source is not recognised: its form shows its last price", [[FL,
    "  const outside = isOutsideSource(hints);", "  const outside = false;"]], T],
  ["أ", "an outside source's hint is «لا سعر سابق» (a word about a price)", [[FL,
    "last.get(`${it.productId}:${it.packagingId}`) ?? null, outside);", "last.get(`${it.productId}:${it.packagingId}`) ?? null, false);"]], T],
  ["أ", "the price rows of an outside source are read for its form", [[FL,
    "const last = outside ? new Map<string, number>() : await lastPrices(", "const last = await lastPrices("]], T],
  ["أ", "the hint of an outside source falls back to the last price", [[FL,
    "const lastText = noPrice ? NO_PRICE_HINT : last !== null", "const lastText = last !== null"]], T],
  ["أ", "an employee counts as an outside source (no hint of his own number)", [[FL,
    "boolean => !s.supplier && !s.employeeId;", "boolean => !s.supplier;"]], T],
  ["أ", "a row typed in Odoo under a source's name is shown as his last price", [[FL,
    "[f, \">\", 0], [\"x_source_message_id\", \"!=\", false], [SIM_FIELD, \"!=\", true], ...(daily ? [] : [[\"x_special\", \"!=\", true]])],", "[f, \">\", 0], [SIM_FIELD, \"!=\", true], ...(daily ? [] : [[\"x_special\", \"!=\", true]])],"]], T],
  ["أ", "another source's prices fill the hints of any ask (not the trial alone)", [[FL,
    "opts.test && opts.hintsFrom ? opts.hintsFrom : src, kind);", "opts.hintsFrom ?? src, kind);"]], T],
  // ---------------------------------------------------------------- أ the texts
  ["أ", "«ما قدرنا نقرأ…» to an outside source carries the example's number", [[PS,
    "  outside ? (role === \"purchase\"", "  false ? (role === \"purchase\""]], T],
  ["أ", "the reply's hook does not say the source is an outside one", [[PS,
    "role: sourceRole(src, who.partnerId), outside: !emp }, text,", "role: sourceRole(src, who.partnerId), outside: false }, text,"]], T],
  // ---------------------------------------------------------------- أ the gateway
  ["أ", "an owner's purpose goes to any number", [[GW,
    "    if (OWNER_ALLOWED_PURPOSES.has(p) && !isOwnerRecipient(env, to)) {", "    if (false) {"]], T],
  ["أ", "the customers' price purposes are not checked", [[GW,
    "    if (CUSTOMER_PRICE_PURPOSES.has(req.purpose)) {", "    if (false) {"]], T],
  ["أ", "a number that cannot be verified is taken as open", [[GW,
    "        closed = await priceClosedNumber(env, to);", "        closed = await priceClosedNumber(env, to).catch(() => null);"]], T],
  ["أ", "a closed number is not refused", [[GW,
    "      if (closed) {\n        console.warn(`[price-privacy] blocked purpose=${req.purpose}", "      if (false) {\n        console.warn(`[price-privacy] blocked purpose=${req.purpose}"]], T],
  ["أ", "Baraa is not told that a message was stopped", [[GW,
    "        await alertPriceClosed(env, req.purpose, to, closed);\n", ""]], T],
  ["أ", "Baraa is told at every stopped message (no once-a-day)", [[GW,
    "    if (await kvGet(env, key)) return;\n    await kvPut(env, key, new Date().toISOString(), 26 * 3600);\n    const label", "    const label"]], T],
  ["أ", "the quotation's PDF is not a price-bearing purpose", [[PP,
    "\"customer_prices\", \"customer_quotation\", \"customer_quotation_pdf\", \"customer_order_form\",", "\"customer_prices\", \"customer_quotation\", \"customer_order_form\","]], T],
  ["أ", "the order form is not a price-bearing purpose", [[PP,
    "\"customer_prices\", \"customer_quotation\", \"customer_quotation_pdf\", \"customer_order_form\",", "\"customer_prices\", \"customer_quotation\", \"customer_quotation_pdf\","]], T],
  ["أ", "the day's list is not a price-bearing purpose", [[PP,
    "\"customer_prices\", \"customer_quotation\", \"customer_quotation_pdf\", \"customer_order_form\",", "\"customer_quotation\", \"customer_quotation_pdf\", \"customer_order_form\","]], T],
  // ---------------------------------------------------------------- أ the closed numbers
  ["أ", "a supplier is not closed (the price sources alone)", [[PP,
    "domain: [\"|\", \"|\", [\"x_price_source\", \"=\", true], [\"supplier_rank\", \">\", 0], [\"x_supplier_state\", \"!=\", false]],", "domain: [\"|\", [\"x_price_source\", \"=\", true], [\"x_supplier_state\", \"!=\", false]],"]], T],
  ["أ", "a price source is not closed (the suppliers alone)", [[PP,
    "domain: [\"|\", \"|\", [\"x_price_source\", \"=\", true], [\"supplier_rank\", \">\", 0], [\"x_supplier_state\", \"!=\", false]],", "domain: [\"|\", [\"supplier_rank\", \">\", 0], [\"x_supplier_state\", \"!=\", false]],"]], T],
  ["أ", "a number kept in «phone» alone is not closed", [[PP,
    "new Set([r.x_whatsapp_number, r.phone].map(", "new Set([r.x_whatsapp_number].map("]], T],
  ["أ", "«0550…» and «+966550…» are two numbers", [[PP,
    "  return x === y || (x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9));", "  return x === y;"]], T],
  ["أ", "every supplier is called a «source»", [[PP,
    "(Number(r.supplier_rank) || 0) > 0 || r.x_price_source !== true ? \"supplier\" : \"source\";", "\"source\";"]], T],
  ["أ", "the closed numbers are not kept (a read at every send)", [[PP,
    "  try { await env.MSG_DEDUP.put(CLOSED_KV_KEY, JSON.stringify(list), { expirationTtl: CLOSED_TTL_SECONDS }); } catch { /* the next send reads again */ }\n", ""]], T],
  ["أ", "the closed numbers are kept an hour", [[PP,
    "export const CLOSED_TTL_SECONDS = 5 * 60;", "export const CLOSED_TTL_SECONDS = 60 * 60;"]], T],
  // ---------------------------------------------------------------- أ the day's list
  ["أ", "the price list reaches a second partner on a source's or a supplier's number", [[PR,
    "(Number(p.supplier_rank) || 0) > 0 || closed.some((c) => sameNumber(c.digits, d))) continue;", "(Number(p.supplier_rank) || 0) > 0) continue;"]], T],
  ["أ", "the price list reaches a customer flagged «مصدر أسعار»", [[PR,
    "    if (p.x_price_source === true || (Number(p.supplier_rank) || 0) > 0 || closed.some(", "    if ((Number(p.supplier_rank) || 0) > 0 || closed.some("]], T],
  ["أ", "the price list reaches a supplier that carries a customer rank", [[PR,
    "    if (p.x_price_source === true || (Number(p.supplier_rank) || 0) > 0 || closed.some(", "    if (p.x_price_source === true || closed.some("]], T],
  // ---------------------------------------------------------------- أ the inbound
  ["أ", "a source's or a supplier's number that no lookup gave enters the customer path", [[IX,
    "            sourceMatch = { id: closed.id, name: closed.name };\n", ""]], T],
  ["أ", "Baraa's own number on a supplier partner makes him an outside source", [[IX,
    "      if (!t && !sup && !sourceMatch && !(await import(\"./wa-gateway\")).isOwnerRecipient(env, msg.from)) {", "      if (!t && !sup && !sourceMatch) {"]], T],
  // ---------------------------------------------------------------- ب the uplift
  ["ب", "the sale price is not rounded up to the half", [[EN,
    "  return ceilToStep(halalas(market * (1 + pct / 100)) / 100);", "  return halalas(market * (1 + pct / 100)) / 100;"]], T],
  ["ب", "the sale price is rounded to the NEAREST half", [[EN,
    "  return ceilToStep(halalas(market * (1 + pct / 100)) / 100);", "  return Math.round(halalas(market * (1 + pct / 100)) / 50) / 2;"]], T],
  ["ب", "the sale price is rounded up to a whole riyal", [[EN,
    "  return ceilToStep(halalas(market * (1 + pct / 100)) / 100);", "  return Math.ceil(halalas(market * (1 + pct / 100)) / 100 - 1e-6);"]], T],
  ["ب", "at 0 % the market price is still rounded up to the half", [[EN,
    "  if (!(pct > 0) || !(market > 0)) return market;", "  if (!(market > 0)) return market;"]], T],
  ["ب", "a negative uplift lowers the price", [[EN,
    "  return Number.isFinite(n) && n > 0 ? n : 0;", "  return Number.isFinite(n) ? n : 0;"]], T],
  ["ب", "the uplift is taken as a fraction (3 = 300 %)", [[EN,
    "  return ceilToStep(halalas(market * (1 + pct / 100)) / 100);", "  return ceilToStep(halalas(market * (1 + pct)) / 100);"]], T],
  ["ب", "the rule ignores the uplift: the sale price is the market price", [[EN,
    "    const sale = market !== null ? upliftedSale(market, uplift) : null;", "    const sale = market;"]], T],
  ["ب", "the unit profit is made from the market price, not the price after the uplift", [[EN,
    "      ? round2(vatProfit(sale, purchase, wastePct, vat.ratePct)) : null;", "      ? round2(vatProfit(market as number, purchase, wastePct, vat.ratePct)) : null;"]], T],
  // § 54 أ — the exception's line is «أقل سعر بيع بدون خسارة» (the suggested price before): the code «loss»
  ["ب", "the comparison with «بدون خسارة» is made on the market price, not the price after the uplift", [[EN,
    "      if (breakEven !== null) { if (sale < breakEven - 0.0001) exceptions.push(\"loss\"); }", "      if (breakEven !== null) { if ((market as number) < breakEven - 0.0001) exceptions.push(\"loss\"); }"]], T],
  ["ب", "the exception's reason does not say the price after the uplift", [[EN,
    "  return upliftPct > 0 ? `سعر السوق ${money(market)} بعد الزيادة ${money(upliftPct)}٪ = ${money(sale)}` : `سعر السوق ${money(market)}`;", "  return `سعر السوق ${money(market)}`;"]], T],
  ["ب", "at 0 % the exception's reason names «الزيادة»", [[EN,
    "  return upliftPct > 0 ? `سعر السوق ${money(market)} بعد الزيادة", "  return upliftPct >= 0 ? `سعر السوق ${money(market)} بعد الزيادة"]], T],
  ["ب", "an automatic line is published at the market price, without the uplift", [[EN,
    "  return { status: \"auto\", sale: round2(p.proposal.price), excluded: false,", "  return { status: \"auto\", sale: round2(p.market as number), excluded: false,"]], T],
  ["ب", "«اعتمد بسعر السوق» approves the market price without the uplift", [[EN,
    "    const price = manualPrice > 0 ? manualPrice : p.sale ?? 0;", "    const price = manualPrice > 0 ? manualPrice : p.market ?? 0;"]], T],
  ["ب", "a stored line's «سعر السوق» ignores its uplift", [[EN,
    "  return market > 0 ? upliftedSale(market, l.x_uplift_pct) : 0;", "  return market;"]], T],
  ["ب", "the line does not carry the uplift it was made with", [[EN,
    "      sale, upliftPct: uplift,", "      sale, upliftPct: 0,"]], T],
  ["ب", "the engine's run does not read the uplift of the settings", [[PR,
    "{ opShare: share.share, minProfit: settings.minProfit }, settings.marketUpliftPct, settings.aboveSuggested);", "{ opShare: share.share, minProfit: settings.minProfit }, 0, settings.aboveSuggested);"]], T],
  ["ب", "a change of the uplift does not recompute the day", [[PR,
    "settings.minProfit, settings.marketUpliftPct, settings.aboveSuggested, vat.ratePct,", "settings.minProfit, settings.aboveSuggested, vat.ratePct,"]], T],
  ["ب", "the uplift is not written on the line (the publication cannot check its price)", [[PR,
    "      x_uplift_pct: p.upliftPct,\n", ""]], T],
  // § 54 — 3 mutations of the uplift in the exception message went with the message and its tap: «the message does not
  // show the price after the uplift» (the review's «(بعد الزيادة N٪)»: scripts/mutation/s54-20261005-mutations.mjs), «the
  // answer to the tap does not say «بعد الزيادة»» (the confirmation names the price alone), and «the tap «اعتمد بسعر
  // السوق» fixes the market price without the uplift» (one source now: the row's price below, offered and fixed alike).
  // The two that stay are the review's (src/price-review.ts):
  ["ب", "the review says «بعد الزيادة» at 0 %", [[RV,
    "${r.upliftPct > 0 ? ` (بعد الزيادة ${money(r.sale)})`", "${r.upliftPct >= 0 ? ` (بعد الزيادة ${money(r.sale)})`"]], T],
  ["ب", "«انشر بسعر السوق» is offered (and fixed) at the market price without the uplift", [[RV,
    "market = Number(l.x_market_price) || 0, sale = marketSale(l);", "market = Number(l.x_market_price) || 0, sale = market;"]], T],
  ["ب", "the settings' uplift is not read (always 0)", [[OC,
    "    marketUpliftPct: upliftOf(r.x_market_uplift_pct),", "    marketUpliftPct: 0,"]], T],
  ["ب", "a negative uplift of the settings is taken as it is", [[OC,
    "    marketUpliftPct: upliftOf(r.x_market_uplift_pct),", "    marketUpliftPct: Number(r.x_market_uplift_pct) || 0,"]], T],
  ["ب", "Odoo: the field is added at every run of the script (twice in the form)", [[LIB,
    "  if (arch.includes(UPLIFT_MARK)) return arch;\n", ""]], T],
  ["ب", "Odoo: a form without «نسبة السعر الشاذ» is written as it is", [[LIB,
    "  if (!OUTLIER_48.test(arch)) throw new Error(", "  if (false) throw new Error("]], T],
  ["ب", "Odoo: the default uplift is 3", [[LIB,
    "export const UPLIFT_DEFAULT = 0;", "export const UPLIFT_DEFAULT = 3;"]], T],
  // ---------------------------------------------------------------- هـ the pay reminder with the IBAN
  ["هـ", "the template with the IBAN is never tried", [[OUT,
    "      const resp = withIban && ibanCurrent\n", "      const resp = false\n"]], T],
  ["هـ", "the template with the IBAN goes whatever account the journal carries", [[OUT,
    "      ibanCurrent ??= await payRemindIbanCurrent(env);", "      ibanCurrent ??= true;"]], T],
  ["هـ", "the template's IBAN is compared with nothing (any valid line passes)", [[OUT,
    "    return (await bankTransferLine(env)) === PAY_REMIND_IBAN_LINE;", "    return (await bankTransferLine(env)) !== \"\";"]], T],
  ["هـ", "no reminder of before behind the new template (pending or MARKETING: nothing goes)", [[OUT,
    "{ requestPurpose: T.CUSTOMER_PAY_REMIND, fallback: [before] })", "{ requestPurpose: T.CUSTOMER_PAY_REMIND })"]], T],
  ["هـ", "the due date is the invoice's own date", [[OUT,
    "export const INVOICE_DUE_DAYS = 30;", "export const INVOICE_DUE_DAYS = 0;"]], T],
  ["هـ", "the due date is the NEWEST invoice's", [[OUT,
    "    if (date && (!row.firstDate || date < row.firstDate)) row.firstDate = date;", "    if (date && (!row.firstDate || date > row.firstDate)) row.firstDate = date;"]], T],
  ["هـ", "the amount is written without its halalas", [[OUT,
    "  return [debt.invoices.join(\"، \"), debt.amount.toFixed(2), arabicDate(", "  return [debt.invoices.join(\"، \"), String(debt.amount), arabicDate("]], T],
  ["هـ", "the first invoice alone is named", [[OUT,
    "  return [debt.invoices.join(\"، \"), debt.amount.toFixed(2), arabicDate(", "  return [debt.invoices[0], debt.amount.toFixed(2), arabicDate("]], T],
  ["هـ", "a debt with no invoice date still takes the new template", [[OUT,
    "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(debt.firstDate) || !debt.invoices.length) return null;\n", ""]], T],
  ["هـ", "the invoice's date is not read (no due date)", [[OUT,
    "fields: [\"id\", \"x_invoice_number\", \"x_total\", \"x_order_id\", \"x_invoice_date\"],", "fields: [\"id\", \"x_invoice_number\", \"x_total\", \"x_order_id\"],"]], T],
  ["هـ", "the worker's transfer line is not the template's", [[OUT,
    "IBAN SA59 4500 0000 1682 9572 3001\";", "IBAN SA59 4500 0000 1682 9572 3002\";"]], T],
  ["هـ", "the template is submitted MARKETING", [[TPL,
    "    category: \"UTILITY\",", "    category: \"MARKETING\","]], T],
  ["هـ", "the template opens with a greeting", [[TPL,
    "  body: `تذكير بالفاتورة رقم {{1}}", "  body: `أهلاً، تذكير بالفاتورة رقم {{1}}"]], T],
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
writeFileSync(new URL("../artifacts/s53-20261004-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
