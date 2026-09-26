// Mutation check for § 41 (2026-09-26): each mutation disables ONE guard of a
// part, runs its test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/s41-20260926-mutations.mjs [أ|ب|ج|د|هـ|عزل …]     (no argument: every part)
//
// Out: scripts/artifacts/s41-20260926-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/s41.test.mts";
const T40 = "tests/pricing-v1.test.mts";
const CF = "src/config.ts";
const EN = "src/pricing-engine.ts";
const PR = "src/prices.ts";
const OP = "src/order-pricing.ts";
const SM = "src/owner-summary.ts";
const INV = "src/invoice.ts";
const OD = "src/odoo.ts";
const OUT = "src/outreach.ts";
const TSA = "tests/sale-accounting.test.mts";
const QT = "src/quotation.ts";
const TXI = "src/tax-invoice.ts";
const RT = "src/router.ts";
const PIV = "src/purchase-invoice.ts";
const IX = "src/index.ts";
const ATT = "src/attendance.ts";
const SP = "src/supplier-pay.ts";
const WI = "src/wa-inbox.ts";
const WR = "src/wa-record.ts";
const GW = "src/wa-gateway.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the VAT inside the profit
  ["أ", "the engine never takes the VAT out", [[PR,
    "  const vat = { ratePct: profitVatRate(day), registered:", "  const vat = { ratePct: null, registered:"]], T],
  ["أ", "the VAT taken out before the cutoff too", [[CF,
    "  return isVatApplicable(dayRiyadh) ? PROFIT_VAT_RATE_PCT : null;", "  return PROFIT_VAT_RATE_PCT;"]], T],
  ["أ", "an unregistered source treated as registered", [[EN,
    "  return registered ? (sale - purchase - waste) / d : sale / d - purchase - waste;", "  return (sale - purchase - waste) / d;"]], T],
  ["أ", "a registered source treated as unregistered", [[EN,
    "  return registered ? (sale - purchase - waste) / d : sale / d - purchase - waste;", "  return sale / d - purchase - waste;"]], T],
  ["أ", "the registration of another source than the purchase's winner", [[EN,
    "vat.registered(p.partnerId))) : null;", "vat.registered(purchases[purchases.length - 1].partnerId))) : null;"]], T],
  ["أ", "the fingerprint ignores a change of «مسجل في الضريبة»", [[PR,
    " vat.ratePct, [...sources.partnerIds].sort((a, b) => a - b).map((pid) => [pid, vat.registered(pid)]),", ""]], T],
  ["أ", "the discount guard's profit not net of VAT", [[OP,
    "  let vat: VatContext = NO_VAT;\n  if (rate) {", "  let vat: VatContext = NO_VAT;\n  if (false) {"]], T],
  ["أ", "the discount guard ignores the line's source", [[OP,
    "vat.registered(c.source)) * l.qty;", "true) * l.qty;"]], T],
  ["أ", "the discount not taken off with VAT", [[OP,
    "    ? round2(raw - (gross - discountedTotals(split, amount, rate).total) / (1 + rate / 100))", "    ? round2(raw)"]], T],
  ["أ", "the discount taken off after the rounding (not before the division)", [[OP,
    "    ? round2(raw - (gross - discountedTotals(split, amount, rate).total) / (1 + rate / 100))", "    ? round2(round2(raw) - (gross - discountedTotals(split, amount, rate).total) / (1 + rate / 100))"]], T],
  ["أ", "the 21:30 profit not net of VAT", [[SM,
    "deliveredProfit(env, yesterday, profitVatRate(day))", "deliveredProfit(env, yesterday)"]], T],
  ["أ", "the 21:30 VAT by the order's day, not the invoice's (today)", [[SM,
    "deliveredProfit(env, yesterday, profitVatRate(day))", "deliveredProfit(env, yesterday, profitVatRate(yesterday))"]], T],
  ["أ", "the 21:30 profit ignores the line's source", [[SM,
    "vatProfit(sale, buy.price, waste, vatRatePct, registered(buy.source)) * qty;", "vatProfit(sale, buy.price, waste, vatRatePct, true) * qty;"]], T],
  ["أ", "the 21:30 discount (VAT-inclusive) not divided", [[SM,
    "      ? Math.max(0, round2((grossByOrder.get(m2oId(i.x_order_id)) ?? 0) - (Number(i.x_total) || 0))) / (1 + vatRatePct / 100)\n      : d;", "      ? Math.max(0, round2((grossByOrder.get(m2oId(i.x_order_id)) ?? 0) - (Number(i.x_total) || 0)))\n      : d;"]], T40],
  // ---------------------------------------------------------------- ب the «المحطات فارغ» alert gone
  ["ب", "the daily alert back in the prices tick", [[PR,
    "  // § 41 ب — the daily «عدد المحطات اليومية المخطط فارغ» alert (§ 40 د) was\n",
    "  await sendOwnerAlert(env, \"⚠️ «عدد المحطات اليومية المخطط» فارغ في «⚙️ إعدادات التسعير».\").catch(() => {});\n  // § 41 ب — the daily «عدد المحطات اليومية المخطط فارغ» alert (§ 40 د) was\n"]], T],
  ["ب", "empty planned stops → a discount anyway", [[OP,
    "  if (settings.plannedStops === null) return { ...out, reason: \"«عدد المحطات اليومية المخطط» فارغ\" };\n", ""]], T],
  // ---------------------------------------------------------------- ج the invoice at «تم التسليم»
  ["ج", "a simulation order gets an invoice", [[INV,
    "  if (await isSimulationOrder(env, orderId)) {", "  if (false) {"]], T],
  ["ج", "no check for the order's existing invoice", [[INV,
    "  const existing = await findInvoiceForOrder(env, orderId);\n  if (existing) {", "  const existing = await findInvoiceForOrder(env, orderId);\n  if (false) {"]], T],
  ["ج", "no KV claim while an invoice is issued", [[INV,
    "claimButton(env, `invoice_issue:${orderId}`, INVOICE_CLAIM_TTL)", "claimButton(env, `invoice_issue:${orderId}:${Math.random()}`, INVOICE_CLAIM_TTL)"]], T],
  ["ج", "the claim released after an issue (not kept «done»)", [[INV,
    "    if (issued) await finishButton(env, claim, INVOICE_DONE_TTL);\n    else await releaseButton(env, claim);", "    await releaseButton(env, claim);"]], T],
  ["ج", "the invoice not sent at «تم التسليم»", [[INV,
    "  await sendIssuedInvoice(env, invoiceId, invoiceNumber, () => dispatchInvoiceToCustomer(env, {", "  if (false) await sendIssuedInvoice(env, invoiceId, invoiceNumber, () => dispatchInvoiceToCustomer(env, {"]], T],
  ["ج", "x_invoice_sent_at not checked before the send", [[INV,
    "    if (inv?.x_invoice_sent_at) {\n      console.log(`[invoice-send] ${invoiceNumber} already sent", "    if (false) {\n      console.log(`[invoice-send] ${invoiceNumber} already sent"]], T],
  ["ج", "a failed send keeps x_invoice_sent_at (never retried)", [[INV,
    "    await writeInvoice(env, invoiceId, { x_invoice_sent_at: false }).catch(() => {});\n    const msg = `[invoice-send] ${invoiceNumber}: تعذّر إرسال الفاتورة للعميل عند التسليم", "    const msg = `[invoice-send] ${invoiceNumber}: تعذّر إرسال الفاتورة للعميل عند التسليم"]], T],
  ["ج", "the supply / issue time not written", [[INV,
    "    invoiceDate: invoiceDateYmd,\n    issuedAt,", "    invoiceDate: invoiceDateYmd,"]], T],
  ["ج", "the number's day from UTC (02:30 Riyadh → yesterday)", [[INV,
    "  const ymd = invoiceDateYmd.replace(/-/g, \"\");", "  const ymd = issuedAt.toISOString().slice(0, 10).replace(/-/g, \"\");"]], T],
  ["ج", "the invoice date from UTC", [[INV,
    "  const invoiceDateYmd = todayRiyadhYmd(issuedAt);", "  const invoiceDateYmd = issuedAt.toISOString().slice(0, 10);"]], T],
  ["ج", "the day's serial counts the simulation invoices", [[OD,
    "    domain: [[\"x_invoice_date\", \"=\", day], [\"x_utak_simulation\", \"!=\", true]],", "    domain: [[\"x_invoice_date\", \"=\", day]],"]], T],
  ["ج", "a zero invoice when every line is short", [[INV,
    "  if (order.lines.length === 0) {\n    if (accountingOn)", "  if (false) {\n    if (accountingOn)"]], TSA],
  ["ج", "م2 back on x_is_simulation (nothing reminded on sim / pilot)", [[OUT,
    "      [\"x_utak_simulation\", \"!=\", true],\n    ],", "      [\"x_is_simulation\", \"!=\", true],\n    ],"]], T],
  ["ج", "the 18:00 list back on x_is_simulation", [[OD,
    "    domain: [[\"x_status\", \"in\", [\"issued\", \"overdue\"]], [\"x_utak_simulation\", \"!=\", true]],", "    domain: [[\"x_status\", \"in\", [\"issued\", \"overdue\"]], [\"x_is_simulation\", \"!=\", true]],"]], T],
  // ---------------------------------------------------------------- سعر the order's day's price (found building ج)
  ["سعر", "the day asked ignored (always today)", [[OD,
    "  const today = day ?? riyadhToday(); // 2026-09-25", "  const today = riyadhToday(); // 2026-09-25"]], T],
  ["سعر", "the invoice priced at the delivery day", [[INV,
    "      unit = (await getLatestSalePrice(env, l.product_id, l.packaging_id, order.order_date ?? undefined)).price;\n    }\n    const line_total", "      unit = (await getLatestSalePrice(env, l.product_id, l.packaging_id)).price;\n    }\n    const line_total"]], T],
  ["سعر", "the quotation priced at the day it is built", [[QT,
    "      const lookup = await getLatestSalePrice(env, l.product_id, l.packaging_id, order.order_date ?? undefined);", "      const lookup = await getLatestSalePrice(env, l.product_id, l.packaging_id);"]], T],
  ["سعر", "the stale fallback takes a later day's price", [[OD,
    "      [\"x_packaging_id\", \"=\", packagingId],\n      [\"x_date\", \"<=\", today],\n      [\"x_utak_simulation\"", "      [\"x_packaging_id\", \"=\", packagingId],\n      [\"x_utak_simulation\""]], T],
  // ---------------------------------------------------------------- د the tax invoice from 10-01
  ["د", "«فاتورة ضريبية» for every tax invoice (no «مبسطة»)", [[INV,
    "  const title = !isTaxInvoice ? UI.invoice : taxInvoiceKind(data.customer.vat) === \"tax\" ? UI.taxInvoice : UI.simplifiedTaxInvoice;", "  const title = !isTaxInvoice ? UI.invoice : UI.taxInvoice;"]], T],
  ["د", "«مبسطة» even with the customer's VAT number", [[TXI,
    "  return typeof customerVat === \"string\" && customerVat.trim() ? \"tax\" : \"simplified\";", "  return \"simplified\";"]], T],
  ["د", "the lines printed VAT-inclusive on a tax invoice", [[INV,
    "    items.forEach((it, i) => { it.price = b.lines[i].unitNet; it.total = b.lines[i].net; });", ""]], T],
  ["د", "the rounding carried by the total, not the VAT line", [[TXI,
    "  const tax = round2(t - (subtotal - disc));", "  const tax = nominalTax;"]], T],
  ["د", "the issue time from create_date / the build time, not x_issued_at", [[INV,
    "  const issuedAt = row?.x_issued_at ? parseOdooUtc(row.x_issued_at) : row?.create_date ? parseOdooUtc(row.create_date) : new Date();", "  const issuedAt = row?.create_date ? parseOdooUtc(row.create_date) : new Date();"]], T],
  ["د", "no issue time printed", [[INV,
    "    documentDateStr: lang === \"en\" ? formatDateEn(data.invoiceDate) : issuedStr,", "    documentDateStr: lang === \"en\" ? formatDateEn(data.invoiceDate) : undefined,"]], T],
  ["د", "the seller's VAT number on an invoice before 10-01", [[INV,
    "    ? toLegalFooterAr(isTaxInvoice ? company : { ...company, vat: \"\" })", "    ? toLegalFooterAr(company)"]], T],
  ["د", "a zero discount row on a tax invoice", [[INV,
    "${isTax && !(discount > 0) ? \"\" : `", "${false ? \"\" : `"]], T],
  ["د", "VAT by the order's day, not the issue date", [[INV,
    "    saleTax = await resolveSaleTaxForDate(env, invoiceDateYmd);", "    saleTax = await resolveSaleTaxForDate(env, order.order_date ?? invoiceDateYmd);"]], T],
  ["د", "the quotation page without the VAT note from 10-01", [[QT,
    "    ...(isVatApplicable(new Date(quotationDate.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)) ? { vatInclusive: true } : {}),", ""]], T],
  ["د", "the quotation message without the VAT note from 10-01", [[RT,
    "  return isVatApplicable(riyadhDateKey()) ? \"الأسعار شاملة ضريبة القيمة المضافة.\" : \"\";", "  return \"\";"]], T],
  // ---------------------------------------------------------------- هـ the purchase tax invoice
  ["هـ", "no «أرسل صورة فاتورة الشراء الضريبية» after «تم الشراء»", [[RT,
    "(${ordersMoved} توصيلة).\\n${PINV_ASK_TEXT}`;", "(${ordersMoved} توصيلة).`;"]], T],
  ["هـ", "no 60-minute window opened by «تم الشراء»", [[RT,
    "      if (partner?.id) await openPurchaseInvoiceWindow(env, partner.id, listId);\n", ""]], T],
  ["هـ", "no 60-minute limit", [[PIV,
    "  if (nowMs - p.at > PINV_WINDOW_MIN * MIN) {", "  if (false) {"]], T],
  ["هـ", "a second file overwrites the first", [[PIV,
    "  if (!list.x_tax_invoice_filename && !list.x_tax_invoice_at) {", "  if (true) {"]], T],
  ["هـ", "no «وصلت الفاتورة ✅»", [[PIV,
    "  return PINV_ACK_TEXT;\n}", "  return null;\n}"]], T],
  ["هـ", "team media not routed to the purchase invoice", [[IX,
    "            const ack = await handlePurchaseInvoiceMedia(env, teamMatch.id, msg.media!);", "            const ack = null as string | null; void handlePurchaseInvoiceMedia;"]], T],
  ["هـ", "the 12:00 line before 12:00", [[PIV,
    "  if (riyadhMinutes(new Date(nowMs)) < PINV_ALERT_MINUTE) return { action: \"before\" };\n", ""]], T],
  ["هـ", "the 12:00 line every tick", [[PIV,
    "claimButton(env, `pinv_alert:${day}`, 26 * 3600)", "claimButton(env, `pinv_alert:${day}:${Math.random()}`, 26 * 3600)"],
    [PIV, "  try { if (await env.MSG_DEDUP.get(doneKey)) return { action: \"checked\" }; } catch { /* read Odoo */ }", "  try { if (false) return { action: \"checked\" }; } catch { /* read Odoo */ }"]], T],
  ["هـ", "a simulation list chased", [[PIV,
    "      [SIM_FIELD, \"!=\", true],\n      [\"x_tax_invoice_filename\", \"=\", false],", "      [\"x_tax_invoice_filename\", \"=\", false],"]], T],
  ["هـ", "a list with its invoice (by hand) chased", [[PIV,
    "      [\"x_tax_invoice_filename\", \"=\", false],\n", ""]], T],
  ["هـ", "every old list chased (no 24-hour window)", [[PIV,
    "      [\"x_ahmad_confirmed_at\", \">=\", toOdooUtc(noon - DAY_MS)],\n", ""]], T],
  ["هـ", "the */5 tick does not run the 12:00 check", [[IX,
    "            const pi = await checkPurchaseInvoices(withAutoSendJob(rawEnv, PINV_JOB), Date.now());", "            const pi = { action: \"skip\" }; void checkPurchaseInvoices; void withAutoSendJob; void PINV_JOB;"]], T],
  // ---------------------------------------------------------------- عزل the simulation's isolation (found designing و)
  ["عزل", "the day's price record: a simulation day counts", [[PR,
    "    domain: [[\"x_date\", \"=\", day], [\"x_utak_simulation\", \"!=\", true]], fields: DAY_FIELDS,", "    domain: [[\"x_date\", \"=\", day]], fields: DAY_FIELDS,"]], T],
  ["عزل", "the published sale price: a simulation day counts", [[OD,
    "        [\"x_day_id.x_utak_simulation\", \"!=\", true], // § 41\n", ""]], T],
  ["عزل", "the discount guard's purchase: a simulation day counts", [[OP,
    "[\"x_day_id.x_date\", \"=\", day], [\"x_day_id.x_utak_simulation\", \"!=\", true], [\"x_product_tmpl_id\"", "[\"x_day_id.x_date\", \"=\", day], [\"x_product_tmpl_id\""]], T],
  ["عزل", "the 21:30 profit's purchase: a simulation day counts", [[SM,
    "[\"x_day_id.x_date\", \"=\", orderDay], [\"x_day_id.x_utak_simulation\", \"!=\", true], [\"x_cost_price\"", "[\"x_day_id.x_date\", \"=\", orderDay], [\"x_cost_price\""]], T],
  ["عزل", "the engine: a simulation supplier price counts", [[EN,
    "[\"x_supplier_id\", \"in\", ids], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_supplier_id\", \"in\", ids]],"]], T],
  ["عزل", "the outlier reference: a simulation price counts", [[OD,
    "      [\"x_utak_simulation\", \"!=\", true], // § 41 — a simulation price is no reference\n", ""]], T],
  ["عزل", "the 21:15 prefill: a simulation price counts", [[OD,
    "[\"x_date\", \"=\", ymd], [\"x_price_sar\", \">\", 0], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_date\", \"=\", ymd], [\"x_price_sar\", \">\", 0]],"]], T],
  ["عزل", "the sale price fallback: a simulation price counts", [[OD,
    "      [\"x_date\", \"<=\", today],\n      [\"x_utak_simulation\", \"!=\", true], // § 41\n", "      [\"x_date\", \"<=\", today],\n"]], T],
  ["عزل", "the day's supplier price: a simulation row counts", [[OD,
    "      [\"x_date\", \"=\", today],\n      [\"x_utak_simulation\", \"!=\", true], // § 41\n", "      [\"x_date\", \"=\", today],\n"]], T],
  ["عزل", "the supplier dues: a simulation price counts", [[SP,
    "[\"x_price_sar\", \">\", 0], [\"x_utak_simulation\", \"!=\", true]],\n    fields: [\"id\", \"x_supplier_id\", \"x_product_tmpl_id\"", "[\"x_price_sar\", \">\", 0]],\n    fields: [\"id\", \"x_supplier_id\", \"x_product_tmpl_id\""]], T],
  ["عزل", "the pending supplier ask: a simulation log counts", [[OD,
    "      [\"x_replied_at\", \"=\", false],\n      [\"x_utak_simulation\", \"!=\", true], // § 41\n", "      [\"x_replied_at\", \"=\", false],\n"]], T],
  ["عزل", "the latest supplier log: a simulation log counts", [[OD,
    "    domain: [[\"x_supplier_id\", \"=\", supplierId], [\"x_utak_simulation\", \"!=\", true]],", "    domain: [[\"x_supplier_id\", \"=\", supplierId]],"]], T],
  ["عزل", "the recent supplier logs: a simulation log counts", [[OD,
    "    domain: [[\"x_sent_at\", \">=\", cutoff], [\"x_utak_simulation\", \"!=\", true]],", "    domain: [[\"x_sent_at\", \">=\", cutoff]],"]], T],
  ["عزل", "attendance: a simulation row counts", [[ATT,
    "[\"x_employee_id\", \"in\", employeeIds], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_employee_id\", \"in\", employeeIds]],"]], T],
  ["عزل", "the day's purchase list: a simulation list counts", [[OD,
    "    domain: [[\"x_date\", \"=\", today], [\"x_utak_simulation\", \"!=\", true]],\n    fields: [\"id\", \"x_aggregated_items\", \"x_supplier_id\"],", "    domain: [[\"x_date\", \"=\", today]],\n    fields: [\"id\", \"x_aggregated_items\", \"x_supplier_id\"],"]], T],
  ["عزل", "the 06:00 list follow-up: a simulation list counts", [[OD,
    "[\"x_date\", \">=\", sinceDate], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_date\", \">=\", sinceDate]],"]], T],
  ["عزل", "today's latest list: a simulation list counts", [[OD,
    "    domain: [[\"x_date\", \"=\", today], [\"x_utak_simulation\", \"!=\", true]],\n    fields: [\"id\"],\n    limit: 1,", "    domain: [[\"x_date\", \"=\", today]],\n    fields: [\"id\"],\n    limit: 1,"]], T],
  ["عزل", "the 20:00 / 21:00 unconfirmed orders: a simulation order counts", [[OD,
    "      [\"x_state\", \"in\", [\"waiting_confirmation\", \"draft\"]],\n      [\"x_utak_simulation\", \"!=\", true], // § 41\n", "      [\"x_state\", \"in\", [\"waiting_confirmation\", \"draft\"]],\n"]], T],
  ["عزل", "the 21:15 confirmed lines: a simulation order counts", [[OD,
    "[\"x_state\", \"=\", \"confirmed\"], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_state\", \"=\", \"confirmed\"]],"]], T],
  ["عزل", "a simulation run: its channel exists", [[WI,
    "  if (isSimRun(env)) return null;\n  if (!partnerId) return null;", "  if (!partnerId) return null;"]], T],
  ["عزل", "a simulation run: its row «pending» (the deployed tick would post it)", [[WR,
    "  const echo = !rec.noEcho && !!partner && !isSimRun(env);", "  const echo = !rec.noEcho && !!partner;"]], T],
  ["عزل", "a simulation run: a channel found by name (the review channel) still posted", [[WI,
    "  if (isSimRun(env)) return false;\n  try {", "  try {"]], T],
  ["عزل", "a simulation run: the 05:00 cron syncs the templates from Meta", [[IX,
    "          if (!isSimRun(env)) try {\n            const { runTemplateSync }", "          if (true) try {\n            const { runTemplateSync }"]], T],
  // ---------------------------------------------------------------- موقع a pending location (found by the simulation)
  ["موقع", "a text with a number saved as the neighborhood (confirmed order)", [[IX,
    "  return t.length >= 2 && t.length <= 60 && !hasDigits(t);", "  return t.length >= 2 && t.length <= 60;"]], T],
  ["موقع", "a text with a number caught by the quotation's location wait", [[IX,
    "      if (msg.type === \"text\" && !hasDigits(msg.text)) {", "      if (msg.type === \"text\") {"]], T],
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
writeFileSync(new URL("./artifacts/s41-20260926-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
