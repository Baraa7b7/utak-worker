// Mutation check for § 62 د (2026-10-07) — the quotation's tidy-up: «عرض سعر الوحدة» (أ: src/quotation.ts,
// src/special-quotation.ts, src/sale-order-quotation.ts), the rounding of «المقترح» before VAT (ج:
// src/special-quote-math.ts, src/special-quote.ts), «👁️ معاينة PDF» (د: src/quote-preview.ts), one sheet up to
// twelve lines (هـ: src/quotation.ts, src/pdf-template.ts), the foot of the page (و), the sale order's
// quotation (ز: src/sale-order-quotation.ts) and «المنشأ» / «المقاس» (ح). Each mutation disables ONE guard,
// runs the test file named with it, and must make it fail. The source is restored in `finally` after every
// run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s62d-20261007-mutations.mjs [أ ج د هـ و ز ح]     (no argument: every part)
//
// Out: scripts/artifacts/s62d-20261007-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TL = "tests/s62d-layout.test.mts", TS = "tests/s62d-sale-order.test.mts", TP = "tests/s62d-preview.test.mts", TI = "tests/i18n.test.mts", TZ = "tests/zatca-qr.test.mts";
const QUO = "src/quotation.ts", QT = "src/special-quotation.ts", SQ = "src/special-quote.ts", MATH = "src/special-quote-math.ts", SOQ = "src/sale-order-quotation.ts";
const PV = "src/quote-preview.ts", PT = "src/pdf-template.ts", I18N = "src/i18n.ts", DS = "src/doc-shell.ts", BANK = "src/bank-line.ts", IDX = "src/index.ts", LIB = "scripts/lib/s62d-odoo.mjs";
const AUTO = "  return q.lines.length > 0 && q.lines.every((l) => l.qty === 1) ? \"unit\" : \"qty\";";
const UNIT_NUMBERS = "      ...(unit ? { net: l.finalNet, vat: round2(l.finalPrice - l.finalNet), gross: l.finalPrice } : {}),";
const SIGNED = "  return signDocToken(secret, `preview:${kind}:${id}:${expiry}`);";
const DRAFT_SO = "{ ...data, quotationNumber: DRAFT_NUMBER, issued: false, draft: true }";
const VAT_WORDS = "  const vatWords = taxedIncluded > 0 && taxedExcluded === 0 ? \"included\" : taxedExcluded > 0 && taxedIncluded === 0 ? \"excluded\" : \"\";";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ — «عرض سعر الوحدة»
  ["أ", "«تلقائي» never prints unit prices", [[QT, AUTO, "  return \"qty\";"]], TL],
  ["أ", "«تلقائي» prints unit prices when ONE quantity is 1", [[QT, AUTO, "  return q.lines.length > 0 && q.lines.some((l) => l.qty === 1) ? \"unit\" : \"qty\";"]], TL],
  ["أ", "a request with no lines prints unit prices", [[QT, AUTO, "  return q.lines.every((l) => l.qty === 1) ? \"unit\" : \"qty\";"]], TL],
  ["أ", "«شكل العرض» is ignored", [[QT, "  if (q.layout === \"unit\" || q.layout === \"qty\") return q.layout;\n", ""]], TL],
  ["أ", "«بالكميات» is ignored", [[QT, "  if (q.layout === \"unit\" || q.layout === \"qty\") return q.layout;", "  if (q.layout === \"unit\") return q.layout;"]], TL],
  ["أ", "the unit's VAT is 15 % of the price before it again (not the two prices' difference)", [[QT, UNIT_NUMBERS, "      ...(unit ? { net: l.finalNet, vat: round2(l.finalNet * VAT_RATE), gross: l.finalPrice } : {}),"]], TL],
  ["أ", "the unit's price with VAT is recomputed from the one before it", [[QT, UNIT_NUMBERS, "      ...(unit ? { net: l.finalNet, vat: round2(l.finalPrice - l.finalNet), gross: round2(l.finalNet * VAT_FACTOR) } : {}),"]], TL],
  ["أ", "the unit's price before VAT is the one with it", [[QT, UNIT_NUMBERS, "      ...(unit ? { net: l.finalPrice, vat: round2(l.finalPrice - l.finalNet), gross: l.finalPrice } : {}),"]], TL],
  ["أ", "the request's data never says «unit»", [[QT, "    ...(unit ? { layout: \"unit\" as const } : {}),\n", ""]], TL],
  ["أ", "the renderer never draws the unit table", [[QUO, "  const unit = data.layout === \"unit\";\n  const table", "  const unit = false;\n  const table"]], TL],
  ["أ", "the renderer draws the unit table for every quotation", [[QUO, "  const unit = data.layout === \"unit\";\n  const table", "  const unit = true;\n  const table"]], TL],
  ["أ", "a unit-price quotation prints totals", [[QUO, "    totalsHTML: unit ? undefined : renderQuotationTotalsHTML(", "    totalsHTML: renderQuotationTotalsHTML("]], TL],
  ["أ", "the VAT column comes before the price before VAT", [[QUO, "          ${th(\"colPriceNet\", \"18%\", true)}\n          ${th(\"colVat15\", \"13%\", true)}", "          ${th(\"colVat15\", \"13%\", true)}\n          ${th(\"colPriceNet\", \"18%\", true)}"]], TL],
  ["أ", "the two prices are printed in each other's column", [[QUO, "      ${money(item.net, rowH)}\n      ${money(item.vat, rowH, true)}\n      ${money(item.gross, rowH)}", "      ${money(item.gross, rowH)}\n      ${money(item.vat, rowH, true)}\n      ${money(item.net, rowH)}"]], TL],
  ["أ", "the VAT column prints the price before VAT", [[QUO, "      ${money(item.vat, rowH, true)}", "      ${money(item.net, rowH, true)}"]], TL],
  ["أ", "the line under the unit table is not printed", [[QUO, "${escapeHTML(isEn ? UI.unitPricesNote.en : UI.unitPricesNote.ar)}</div>`;", "</div>`;"]], TL],
  ["أ", "the line under the unit table is not Baraa's words", [[I18N, "  unitPricesNote: T(\"الأسعار لكل وحدة كما في عمود العبوة\",", "  unitPricesNote: T(\"الأسعار لكل وحدة\","]], TL],
  ["أ", "the VAT column's title is «الضريبة»", [[I18N, "  colVat15: T(\"ضريبة 15%\", \"VAT 15%\"),", "  colVat15: T(\"الضريبة\", \"VAT 15%\"),"]], TL],
  ["أ", "the last column's title is «السعر شامل الضريبة»", [[I18N, "  colPriceGross: T(\"السعر بعد الضريبة\",", "  colPriceGross: T(\"السعر شامل الضريبة\","]], TL],
  ["أ", "«بالكميات» read from Odoo is «تلقائي»", [[SQ, "export const asLayout = (v: unknown): QuoteLayout => (v === \"unit\" || v === \"qty\" ? v : \"auto\");", "export const asLayout = (v: unknown): QuoteLayout => (v === \"unit\" ? v : \"auto\");"]], TL],
  ["أ", "«شكل العرض» is not read from the request", [[SQ, "layout: asLayout(q.x_layout),", "layout: asLayout(undefined),"]], TL],
  ["أ", "a unit-price quotation says «الأسعار شاملة …» in «شاملة»", [[QT, "    footerNote: quotationNote(q.validUntil, q.priceMode, unit ? \"unit\" : \"qty\"),", "    footerNote: quotationNote(q.validUntil, q.priceMode),"]], TL],
  ["أ", "the note of a unit-price quotation keeps the VAT sentence", [[QT, "${mode === \"gross\" && layout !== \"unit\" ? `${VAT_INCLUSIVE_NOTE} ` : \"\"}", "${mode === \"gross\" ? `${VAT_INCLUSIVE_NOTE} ` : \"\"}"]], TL],
  ["أ", "a unit-price quotation goes by the template that states a total", [[QT, "      const fits = !unit && templateFits(q.validUntil, now);", "      const fits = templateFits(q.validUntil, now);"]], TL],
  ["أ", "Baraa is told a total of a unit-price quotation", [[QT, "    const total = unit ? `أسعار الوحدة لـ", "    const total = false ? `أسعار الوحدة لـ"]], TL],
  ["أ", "the day's quotation builder sets the unit layout", [[QUO, "    is_manual: isManual,\n    customer_id: order.customer_id,", "    is_manual: isManual,\n    layout: \"unit\",\n    customer_id: order.customer_id,"]], TL],
  ["أ", "a sale order never prints unit prices", [[SOQ, "  const unitLayout = items.length > 0 && items.every((x) => x.qty === 1);", "  const unitLayout = false;"]], TS],
  ["أ", "a sale order prints unit prices when ONE quantity is 1", [[SOQ, "  const unitLayout = items.length > 0 && items.every((x) => x.qty === 1);", "  const unitLayout = items.length > 0 && items.some((x) => x.qty === 1);"]], TS],
  ["أ", "a sale order's unit price before VAT is the one with it", [[SOQ, "price: unit, total, net, vat: tax, gross, ...(detail ? { detail } : {}) });", "price: unit, total, net: gross, vat: tax, gross, ...(detail ? { detail } : {}) });"]], TS],
  ["أ", "a sale order's unit VAT is not Odoo's price_tax", [[SOQ, "price: unit, total, net, vat: tax, gross, ...(detail ? { detail } : {}) });", "price: unit, total, net, vat: 0, gross, ...(detail ? { detail } : {}) });"]], TS],
  // ---------------------------------------------------------------- ج — «المقترح» before VAT
  ["ج", "«قبل الضريبة» rounds «المقترح» on the VAT-inclusive price, as «شاملة» does", [[MATH, "  if (mode !== \"net\") return { gross, net: netOf(gross) };", "  return { gross, net: netOf(gross) };"]], TL],
  ["ج", "«شاملة» rounds «المقترح» on the price before VAT", [[MATH, "  if (mode !== \"net\") return { gross, net: netOf(gross) };", "  if (mode !== \"net\" && false) return { gross, net: netOf(gross) };"]], TL],
  ["ج", "«المقترح» before VAT is not rounded to the quarter", [[MATH, "  const net = ceilTo(Math.max(pos(marketMedian), least) / VAT_FACTOR);", "  const net = round2(Math.max(pos(marketMedian), least) / VAT_FACTOR);"]], TL],
  ["ج", "«المقترح» before VAT ignores the market", [[MATH, "  const net = ceilTo(Math.max(pos(marketMedian), least) / VAT_FACTOR);", "  const net = ceilTo(least / VAT_FACTOR);"]], TL],
  ["ج", "«المقترح» before VAT is rounded on the price with VAT", [[MATH, "  const net = ceilTo(Math.max(pos(marketMedian), least) / VAT_FACTOR);", "  const net = ceilTo(Math.max(pos(marketMedian), least));"]], TL],
  ["ج", "the VAT-inclusive «المقترح» does not follow the rounded one", [[MATH, "  return { gross: grossOf(net), net };", "  return { gross, net };"]], TL],
  ["ج", "a market price alone is suggested before VAT with no purchase price", [[MATH, "  if (!(pos(purchase) > 0)) return { gross: 0, net: 0 };\n", ""]], TL],
  ["ج", "the request's mode is not what rounds «المقترح»", [[SQ, "    const sug = suggestedFor(l.purchase, n.marketMedian, wastePct, marginPct, q.priceMode);", "    const sug = suggestedFor(l.purchase, n.marketMedian, wastePct, marginPct, \"gross\");"]], TL],
  ["ج", "«المقترح قبل الضريبة» is not written on the line", [[SQ, "    if (differs(l.suggestedNet, sug.net)) lv.x_suggested_net = sug.net;\n", ""]], TL],
  ["ج", "«المقترح» on the line stays the VAT-inclusive rounding", [[SQ, "    if (differs(l.suggested, sug.gross)) lv.x_suggested_price = sug.gross;", "    if (differs(l.suggested, n.suggested)) lv.x_suggested_price = n.suggested;"]], TL],
  ["ج", "«المقترح قبل الضريبة» is not read back (a second pass writes it again)", [[SQ, "suggestedNet: num(l.x_suggested_net),", "suggestedNet: 0,"]], TL],
  // ---------------------------------------------------------------- د — «👁️ معاينة PDF»
  ["د", "anything is taken for a ticket (Odoo is asked for it)", [[PV, "  if (!UUID.test(ticket)) return notFound();\n", ""]], TP],
  ["د", "a ticket opens more than once", [[PV, "  if (row.x_used) return messagePage(410,", "  if (false) return messagePage(410,"]], TP],
  ["د", "an old ticket still opens", [[PV, "  if (!(age < TICKET_TTL_MS) || age < -60_000) return", "  if (age < -60_000) return"]], TP],
  ["د", "a ticket dated in the future opens", [[PV, "  if (!(age < TICKET_TTL_MS) || age < -60_000) return", "  if (!(age < TICKET_TTL_MS)) return"]], TP],
  ["د", "a ticket lives fifty minutes", [[PV, "export const TICKET_TTL_MS = 5 * 60_000;", "export const TICKET_TTL_MS = 50 * 60_000;"]], TP],
  ["د", "the link lives a day", [[PV, "export const LINK_TTL_MS = 15 * 60_000;", "export const LINK_TTL_MS = 24 * 3600_000;"]], TP],
  ["د", "the ticket is not burnt", [[PV, "    await call<boolean>(env, TICKET_MODEL, \"write\", { ids: [row.id], vals: { x_used: true, x_active: false } });\n", ""]], TP],
  ["د", "a ticket that could not be burnt still gives the link", [[PV, "    console.error(\"[preview] the ticket could not be burnt\", (e as Error)?.message);\n    return messagePage(503, `${w.failed} الآن`, `Odoo لم يجب. ${w.again}`);", "    console.error(\"[preview] the ticket could not be burnt\", (e as Error)?.message);"]], TP],
  ["د", "a ticket for any model gives a link", [[PV, "(model, resId) => !!PREVIEW_KINDS[model] && resId > 0);", "() => true);"]], TP],
  ["د", "a sale order's ticket opens a special request", [[PV, "  const kind = PREVIEW_KINDS[r.model], id = r.resId;", "  const kind = \"sq\" as PreviewKind, id = r.resId;"]], TP],
  ["د", "the link's signature is not checked", [[PV, "  if (!sameText(await previewSignature(env.ADMIN_TOKEN, kind, id, expiry), signature)) return notFound();\n", ""]], TP],
  ["د", "the expiry is not under the signature", [[PV, SIGNED, "  return signDocToken(secret, `preview:${kind}:${id}`);"]], TP],
  ["د", "the kind is not under the signature", [[PV, SIGNED, "  return signDocToken(secret, `preview:${id}:${expiry}`);"]], TP],
  ["د", "the record is not under the signature", [[PV, SIGNED, "  return signDocToken(secret, `preview:${kind}:${expiry}`);"]], TP],
  ["د", "the signature is the public document token of the record", [[PV, SIGNED, "  return signDocToken(secret, String(id));"]], TP],
  ["د", "the link never expires", [[PV, "  if (!(expiry > now)) return messagePage(410, \"انتهت صلاحية المعاينة\", AGAIN);\n", ""]], TP],
  ["د", "a worker with no secret signs a link", [[PV, "  if (!env.ADMIN_TOKEN) return messagePage(500, \"تعذّرت المعاينة\", \"إعداد الخدمة ناقص.\");\n", ""]], TP],
  ["د", "the link is given under the secret's own name in it", [[PV, "Location: await previewLinkPath(env.ADMIN_TOKEN, kind, id, now + LINK_TTL_MS)", "Location: `${await previewLinkPath(env.ADMIN_TOKEN, kind, id, now + LINK_TTL_MS)}?token=${env.ADMIN_TOKEN}`"]], TP],
  ["د", "a sale order that cannot be quoted is previewed all the same", [[PV, "  if (data.has_blocking_issue) return { refused: (data.problems ?? []).join(\"\\n\") || \"صنف بلا سعر\" };\n", ""]], TP],
  ["د", "a sale order's preview prints the order's number", [[PV, DRAFT_SO, "{ ...data, issued: false, draft: true }"]], TP],
  ["د", "a sale order's preview is not marked a draft", [[PV, DRAFT_SO, "{ ...data, quotationNumber: DRAFT_NUMBER, issued: false }"]], TP],
  ["د", "the preview is served to be saved, not read", [[PV, "\"Content-Disposition\": `inline; filename=\"${file}\"`", "\"Content-Disposition\": `attachment; filename=\"${file}\"`"]], TP],
  ["د", "the preview may be cached by anyone on the way", [[PV, "\"Cache-Control\": \"private, no-store\" },", "\"Cache-Control\": \"public, max-age=3600\" },"]], TP],
  ["د", "the special request's preview is not marked a draft", [[QT, "  const data = specialQuotationData(q, DRAFT_NUMBER, await readCustomer(env, q), now, { draft: true });", "  const data = specialQuotationData(q, DRAFT_NUMBER, await readCustomer(env, q), now, { draft: false });"]], TP],
  ["د", "the special request's preview prints its name as a number", [[QT, "  const data = specialQuotationData(q, DRAFT_NUMBER, await readCustomer(env, q), now, { draft: true });", "  const data = specialQuotationData(q, quoteName(quoteId), await readCustomer(env, q), now, { draft: true });"]], TP],
  ["د", "a request with a line unpriced is previewed", [[QT, "  if (miss.noPrice.length) return { refused: `أسطر بلا سعر نهائي: ${miss.noPrice.join(\"، \")}` };\n", ""]], TP],
  ["د", "a request with a line without a quantity is previewed", [[QT, "  if (miss.noQty.length) return { refused: `أسطر بلا كمية: ${miss.noQty.join(\"، \")}` };\n", ""]], TP],
  ["د", "a request with no lines is previewed", [[QT, "  if (!q.lines.length) return { refused: \"لا أصناف في الطلب\" };\n", ""]], TP],
  ["د", "the preview reads the line's prices as stored, not as the mode reads them", [[QT, "  const q: SpecialQuote = { ...read, lines: read.lines.map((l) => ({ ...l, ...finalsOf(l, read.priceMode) })) };", "  const q: SpecialQuote = read;"]], TP],
  ["د", "in «قبل الضريبة» the price with VAT does not follow the typed one", [[SQ, "? l.finalPrice : grossOf(l.finalNet), finalNet: l.finalNet };", "? l.finalPrice : l.finalPrice, finalNet: l.finalNet };"]], TP],
  ["د", "the preview saves the recalculated numbers", [[QT, "  const read = await readQuote(env, quoteId);\n  if (!read) return null;", "  await recalcQuote(env, quoteId, { now });\n  const read = await readQuote(env, quoteId);\n  if (!read) return null;"]], TP],
  ["د", "the preview writes a result line on the request", [[QT, "  const { generateQuotationPDF } = await import(\"./quotation\");\n  return { pdf: await generateQuotationPDF(data, env), name: quoteName(quoteId) };", "  const { generateQuotationPDF } = await import(\"./quotation\");\n  await writeResult(env, quoteId, \"معاينة\", now);\n  return { pdf: await generateQuotationPDF(data, env), name: quoteName(quoteId) };"]], TP],
  ["د", "the word across a draft is not printed", [[QUO, "    draftMark: data.draft ? (lang === \"en\" ? UI.draft.en : UI.draft.ar) : undefined,", "    draftMark: undefined,"]], TP],
  ["د", "a draft carries no badge under its number's place", [[QUO, "    headerBadge: data.draft ? {", "    headerBadge: false ? {"]], TP],
  ["د", "the word across a draft is as faint as the brand mark", [[PT, "color: ${BRAND_COLORS.accent}; opacity: 0.16;", "color: ${BRAND_COLORS.accent}; opacity: 0.04;"]], TP],
  ["د", "a draft that is called issued is sealed", [[QUO, "    footerSealHTML: issuedSealHTML(data.issued && !data.draft, company,", "    footerSealHTML: issuedSealHTML(data.issued, company,"]], TL],
  ["د", "the old «pdf» op issues the quotation", [[SQ, "  if (op === \"pdf\") {\n    await writeResult(env, id, PDF_MOVED_TEXT, now);\n    return { op, id, action: \"moved\", detail: \"the preview opens in the browser\" };\n  }\n", ""]], TP],
  ["د", "the old «pdf» op says nothing on the request", [[SQ, "    await writeResult(env, id, PDF_MOVED_TEXT, now);\n", ""]], TP],
  ["د", "the worker's route answers POST alone", [[IDX, "    if (request.method === \"GET\" && url.pathname.startsWith(\"/preview/\")) {", "    if (request.method === \"POST\" && url.pathname.startsWith(\"/preview/\")) {"]], TP],
  ["د", "Odoo's action carries a token in its address", [[LIB, "    'url': 'https://${PROD_HOST}${PREVIEW_PATH}' + ticket,", "    'url': 'https://${PROD_HOST}${PREVIEW_PATH}' + ticket + '?token=x',"]], TP],
  ["د", "Odoo's action makes its ticket for no record", [[LIB, "'x_model': '${model}', 'x_res_id': record.id})", "'x_model': '${model}', 'x_res_id': 0})"]], TP],
  ["د", "Odoo's ticket is not random (the record's id)", [[LIB, "env.cr.execute(\"SELECT gen_random_uuid()::text\")\nticket = env.cr.fetchone()[0]", "ticket = str(record.id)"]], TP],
  ["د", "the form keeps «⬇️ PDF لي فقط»", [[LIB, "`<button name=\"${a.preview}\" type=\"action\" string=\"${PREVIEW_BUTTON}\"/>`);", "`<button name=\"${a.pdf}\" type=\"action\" string=\"⬇️ PDF لي فقط\"/>`);"]], TP],
  // ---------------------------------------------------------------- هـ — one sheet up to twelve lines
  ["هـ", "only eight lines are fitted to a sheet", [[QUO, "export const FIT_MAX_ROWS = 12;", "export const FIT_MAX_ROWS = 8;"]], TL],
  ["هـ", "thirteen lines are told one sheet too", [[QUO, "  if (i.rows > FIT_MAX_ROWS) {", "  if (i.rows > 99) {"]], TL],
  ["هـ", "the page is never told its sheet", [[QUO, "    fitOnePage: pageMetrics.fit,", "    fitOnePage: false,"]], TL],
  ["هـ", "the page keeps a minimum height alone (its gaps never give way)", [[PT, "min-height: 297mm;${fit ? \" height: 297mm;\" : \"\"}", "min-height: 297mm;"]], TL],
  ["هـ", "the gaps have no least to shrink to", [[PT, "${fit && least ? ` min-height: ${least};` : \"\"}", ""]], TL],
  ["هـ", "the PDF service is not told the fitted page's printable height", [[PT, " .utak-page.utak-fit { height: calc(297mm - ${reserved}in) !important; }", ""]], TL],
  ["هـ", "the page keeps its 20 mm foot padding above the page-number margin", [[PT, "  const foot = Number(options?.marginBottom ?? 0) > 0 ? ` ${PAGE_FOOT_SELECTOR} { margin-bottom: ${PAGE_FOOT_PADDING} !important; }` : \"\";", "  const foot = \"\";"]], TL],
  ["هـ", "a top margin alone shrinks the foot padding", [[PT, "  const foot = Number(options?.marginBottom ?? 0) > 0 ? ` ${PAGE_FOOT_SELECTOR}", "  const foot = reserved > 0 ? ` ${PAGE_FOOT_SELECTOR}"]], TZ],
  ["هـ", "the foot padding under the page-number margin is 20 mm", [[PT, "export const PAGE_FOOT_PADDING = \"6mm\";", "export const PAGE_FOOT_PADDING = \"20mm\";"]], TL],
  ["هـ", "the sheet is reckoned with the old foot padding", [[QUO, "export const FIT_SHEET_PX = Math.floor((297 - 20 - 6) * (96 / 25.4)", "export const FIT_SHEET_PX = Math.floor((297 - 20 - 20) * (96 / 25.4)"]], TL],
  ["هـ", "the sheet is reckoned without the page-number margin", [[QUO, " - Number(GOTENBERG_FOOTER_MARGIN) * 96);", ");"]], TL],
  ["هـ", "a row's extra height is not counted", [[QUO, "const ROW_EXTRA_PX = 3;", "const ROW_EXTRA_PX = 0;"]], TL],
  ["هـ", "the seal's block is not counted", [[QUO, "  const totals = i.sealed ? 155 : i.unit ? 0 : 118;", "  const totals = i.sealed ? 0 : i.unit ? 0 : 118;"]], TL],
  ["هـ", "a draft's totals are not counted", [[QUO, "  const totals = i.sealed ? 155 : i.unit ? 0 : 118;", "  const totals = i.sealed ? 155 : 0;"]], TL],
  ["هـ", "the line under a unit table is not counted", [[QUO, "  const unitNote = i.unit ? 22 : 0;", "  const unitNote = 0;"]], TL],
  ["هـ", "the blocks under the table are not counted", [[QUO, "  const below = (i.belowBlocks ?? 0) * 33 + (i.belowLines ?? 0) * 20;", "  const below = 0;"]], TL],
  ["هـ", "the transfer line is not counted", [[QUO, " + (i.bankLine ? 22 : 0) + 12 + 16;", " + 12 + 16;"]], TL],
  ["هـ", "the note's second line is not counted", [[QUO, "Math.max(1, i.noteLines ?? 1) * 17", "17"]], TL],
  ["هـ", "a party block's lines are not counted", [[QUO, "  const parties = 20 + partyLines * 19 + (partyLines - 1) * 5;", "  const parties = 111;"]], TL],
  ["هـ", "the group titles are not counted", [[QUO, " + strip + (i.sectionRows ?? 0) * (SECTION_ROW_PX + 1);", " + strip;"]], TL],
  ["هـ", "the rows are sized against a sheet 200 px taller", [[QUO, " + gapsPx(t) + FIT_RESERVE_PX <= FIT_SHEET_PX) { found = h; break; }", " + gapsPx(t) + FIT_RESERVE_PX <= FIT_SHEET_PX + 200) { found = h; break; }"]], TL],
  ["هـ", "the rows are sized with the gaps wide open", [[QUO, "const FIT_GAPS_OPEN = 0.25;", "const FIT_GAPS_OPEN = 1;"]], TL],
  ["هـ", "the rows are sized with nothing kept free", [[QUO, "const FIT_RESERVE_PX = 6;", "const FIT_RESERVE_PX = 0;"]], TL],
  ["هـ", "a row may be 48 px tall", [[QUO, "const ROW_MAX_PX = 36, ROW_MIN_PX = 24, DETAIL_ROW_MIN_PX = 25;", "const ROW_MAX_PX = 48, ROW_MIN_PX = 24, DETAIL_ROW_MIN_PX = 25;"]], TL],
  ["هـ", "a row with a detail line has no least of its own", [[QUO, "    detailRowHeight: `${Math.max(row, DETAIL_ROW_MIN_PX)}px`,", "    detailRowHeight: `${row}px`,"]], TL],
  ["هـ", "a dense page's detail row has no least", [[QUO, "detailRowHeight: `${Math.max(parseInt(m.rowHeight, 10) || 0, DETAIL_ROW_MIN_PX)}px` };", "detailRowHeight: m.rowHeight };"]], TL],
  ["هـ", "the gaps cannot shrink (their least is their height)", [[QUO, "export const FIT_GAPS = { gap: [12, 24], preTable: [14, 40], postTable: [12, 40] } as const;", "export const FIT_GAPS = { gap: [24, 24], preTable: [40, 40], postTable: [40, 40] } as const;"]], TL],
  ["هـ", "the head's padding never tightens", [[QUO, "const thPadFor = (row: number): number => (row >= 30 ? 10 : 8);", "const thPadFor = (row: number): number => 10;"]], TL],
  ["هـ", "a draft is budgeted as sealed", [[QUO, "    sealed: !!(data.issued && !data.draft && company),", "    sealed: true,"]], TL],
  ["هـ", "the rows with a detail line are not counted from the data", [[QUO, "    detailRows: data.items.filter((x) => String(x.detail ?? \"\").trim()).length,", "    detailRows: 0,"]], TL],
  ["هـ", "the company's transfer line is not read into the budget", [[QUO, "    bankLine: !!company?.bankLine,", "    bankLine: true,"]], TL],
  ["هـ", "the blocks under the table are not read into the budget", [[QUO, "    belowBlocks: blocks.length,", "    belowBlocks: 0,"]], TL],
  ["هـ", "the seal of a page of several sheets is raised above its block", [[QUO, "pageMetrics.fit ? undefined : 0),", "undefined),"]], TL],
  ["هـ", "the seal of a one-sheet page is not raised", [[QUO, "pageMetrics.fit ? undefined : 0),", "0),"]], TL],
  // ---------------------------------------------------------------- و — the foot of the page
  ["و", "the quotation's terms keep the narrow column and the QR cell", [[QUO, "    wideTerms: true,", "    wideTerms: false,"]], TL],
  ["و", "the quotation's strip keeps its second line", [[QUO, "    legalOneLine: true,", "    legalOneLine: false,"]], TL],
  ["و", "the quotation's addresses break anywhere", [[QUO, "    partyAddressByParts: true,", "    partyAddressByParts: false,"]], TL],
  ["و", "the quotation's block is titled «شروط الدفع»", [[QUO, "    termsLabel: labelForQuotationTerms(lang),", "    termsLabel: undefined,"]], TL],
  ["و", "the terms' title is «شروط الدفع» in the dictionary", [[I18N, "  termsAndNotes: T(\"الشروط والملاحظات\",", "  termsAndNotes: T(\"شروط الدفع\","]], TL],
  ["و", "the English quotation's terms title is the Arabic one", [[DS, "  return lang === \"en\" ? UI.termsAndNotes.en : UI.termsAndNotes.ar;", "  return UI.termsAndNotes.ar;"]], TL],
  ["و", "the one-line strip may break", [[PT, "style=\"text-align: center; white-space: nowrap; font-size: ${BRAND_TYPE.legal.size};", "style=\"text-align: center; font-size: ${BRAND_TYPE.legal.size};"]], TL],
  ["و", "the one-line strip is on the start side", [[PT, "style=\"text-align: center; white-space: nowrap; font-size: ${BRAND_TYPE.legal.size};", "style=\"text-align: right; white-space: nowrap; font-size: ${BRAND_TYPE.legal.size};"]], TL],
  ["و", "the one-line strip drops the commercial register", [[PT, "  if (info.cr && info.cr.trim()) parts.push(`${en ? info.crLabelEn ?? \"CR No.\" : \"س.ت\"} ${asBdi(info.cr)}`);\n", ""]], TL],
  ["و", "the one-line strip drops the VAT number", [[PT, "  if (info.vat && info.vat.trim()) parts.push(`${en ? info.vatLabelEn ?? \"VAT No.\" : \"الرقم الضريبي\"} ${asBdi(info.vat)}`);\n", ""]], TL],
  ["و", "the one-line strip drops the company's name", [[PT, "  if (name) parts.push(escapeHTML(name));\n", ""]], TL],
  ["و", "the English strip keeps the Arabic name", [[PT, "  const name = ((en ? info.nameEn : \"\") || info.name || \"\").trim();", "  const name = (info.name || \"\").trim();"]], TL],
  ["و", "«one line» is not what the strip is asked for", [[PT, "  if (oneLine) return renderLegalOneLine(info, lang);\n", ""]], TL],
  ["و", "every document's strip is one line (the invoice loses its address line)", [[PT, "renderLegalFooterBar(opts.legalFooterBar, lang, opts.legalOneLine === true)", "renderLegalFooterBar(opts.legalFooterBar, lang, true)"]], TL],
  ["و", "the foot of an issued page may split between sheets", [[PT, "    <div class=\"utak-block\" data-utak=\"page-foot\">\n    ${footerBlock}", "    <div data-utak=\"page-foot\">\n    ${footerBlock}"]], TL],
  ["و", "the foot of a plain page may split between sheets", [[PT, "    <div class=\"utak-block\" data-utak=\"page-foot\">\n    ${renderFooter(", "    <div data-utak=\"page-foot\">\n    ${renderFooter("]], TI],
  ["و", "«شكراً» of the wide terms is on the start side", [[PT, "      <div style=\"height: 12px;\"></div>\n      <div style=\"text-align: center; font-size: 10px;", "      <div style=\"height: 12px;\"></div>\n      <div style=\"text-align: right; font-size: 10px;"]], TL],
  ["و", "the wide terms print no «شكراً» line", [[PT, "opts.hideThanks ? undefined : inlineThanks ?? `شكراً لثقتكم في ${BRAND_INFO.nameAr}`", "undefined"]], TL],
  ["و", "the wide terms print no transfer line", [[PT, "  const transferRow = bankLineHTML ? `\\n          ${bankLineHTML}` : \"\";", "  const transferRow = \"\";"]], TL],
  ["و", "the transfer line keeps the bank account's holder", [[BANK, "  return `للتحويل: ${name} — ${parts[parts.length - 2]} — ${parts[parts.length - 1]}`;", "  return text;"]], TL],
  ["و", "the transfer line loses its bank", [[BANK, "  return `للتحويل: ${name} — ${parts[parts.length - 2]} — ${parts[parts.length - 1]}`;", "  return `للتحويل: ${name} — ${parts[parts.length - 1]}`;"]], TL],
  ["و", "a line that ends with no IBAN is rewritten", [[BANK, " || !parts[parts.length - 1].startsWith(\"IBAN \")) return text;", ") return text;"]], TL],
  ["و", "a line that is not a transfer line is rewritten", [[BANK, " || !parts[0].startsWith(\"للتحويل: \")", ""]], TL],
  ["و", "the transfer line is written with no legal name given", [[BANK, "  if (!name || parts.length < 3", "  if (parts.length < 3"]], TL],
  ["و", "the quotation's transfer line takes the company's short name", [[QUO, "bankLineWithHolder(company?.bankLine, company?.legalNameAr || company?.nameAr),", "bankLineWithHolder(company?.bankLine, company?.nameAr),"]], TL],
  ["و", "a company with no legal name gets no name on its transfer line", [[QUO, "bankLineWithHolder(company?.bankLine, company?.legalNameAr || company?.nameAr),", "bankLineWithHolder(company?.bankLine, company?.legalNameAr),"]], TL],
  ["و", "an address' parts are plain inline runs (they break inside)", [[PT, "parts.map((part) => `<span style=\"display: inline-block; max-width: 100%;\">${escapeHTML(part)}</span>`).join(\" \");", "parts.map((part) => `<span>${escapeHTML(part)}</span>`).join(\" \");"]], TL],
  ["و", "an address is cut at every space", [[PT, ".split(/(?<=[،,])\\s*/)", ".split(/\\s+/)"]], TL],
  ["و", "an address' parts lose their commas", [[PT, ".split(/(?<=[،,])\\s*/)", ".split(/[،,]\\s*/)"]], TL],
  ["و", "every document's addresses are cut in parts", [[PT, "(opts.partyAddressByParts ? { ...party, addressByParts: true } : party);", "({ ...party, addressByParts: true });"]], TL],
  ["و", "a party asked for parts gets its address whole", [[PT, "${party.addressByParts ? partyAddressHTML(party.address) : escapeHTML(party.address)}", "${escapeHTML(party.address)}"]], TL],
  // ---------------------------------------------------------------- ز — the sale order's quotation
  ["ز", "the product's name wins over what was written on the line", [[SOQ, "    const name = firstDescriptionLine(l.name) || productName;", "    const name = productName || firstDescriptionLine(l.name);"]], TS],
  ["ز", "a line with no product is «صنف» again", [[SOQ, "    const name = firstDescriptionLine(l.name) || productName;", "    const name = productName || \"صنف\";"]], TS],
  ["ز", "the description's first line is taken even when it is blank", [[SOQ, ".map((x) => x.trim()).find((x) => x) ?? \"\";", ".map((x) => x.trim())[0] ?? \"\";"]], TS],
  ["ز", "the description's reference is kept in the name", [[SOQ, "  return stripRef(line).trim();", "  return line;"]], TS],
  ["ز", "the whole description is the name", [[SOQ, "  const line = String(typeof name === \"string\" ? name : \"\").split(/\\r?\\n/).map((x) => x.trim()).find((x) => x) ?? \"\";", "  const line = String(typeof name === \"string\" ? name : \"\").trim();"]], TS],
  ["ز", "a note line is a group's title", [[SOQ, "    if (kind === \"line_note\") {", "    if (kind === \"line_note\" && false) {"]], TS],
  ["ز", "a note's text is dropped", [[SOQ, "      if (text) notes.push(text);\n", ""]], TS],
  ["ز", "a section's title is dropped", [[SOQ, "      if (title) sections.push({ before: items.length, title });\n", ""]], TS],
  ["ز", "every section sits above the first item", [[SOQ, "      if (title) sections.push({ before: items.length, title });", "      if (title) sections.push({ before: 0, title });"]], TS],
  ["ز", "a section line is an item (and one with no price)", [[SOQ, "    if (kind) {\n      const title = firstDescriptionLine(l.name);", "    if (false) {\n      const title = firstDescriptionLine(l.name);"]], TS],
  ["ز", "a line with no quantity is an item", [[SOQ, "    if (!(qty > 0)) {", "    if (false) {"]], TS],
  ["ز", "a line with no quantity is never an alternative", [[SOQ, "      if (price > 0 && name) {", "      if (false) {"]], TS],
  ["ز", "an alternative's price is not printed", [[SOQ, "} — ${plain(price)} ريال`);", "}`);"]], TS],
  ["ز", "an alternative loses its origin", [[SOQ, "packagingName !== NO_PACKAGING_PLACEHOLDER ? packagingName : \"\", detail].filter(Boolean)", "packagingName !== NO_PACKAGING_PLACEHOLDER ? packagingName : \"\"].filter(Boolean)"]], TS],
  ["ز", "a line with no product and no description is printed nameless", [[SOQ, "    if (!name) {\n      has_blocking_issue = true;", "    if (!name && false) {\n      has_blocking_issue = true;"]], TS],
  ["ز", "a nameless line does not stop the quotation", [[SOQ, "    if (!name) {\n      has_blocking_issue = true;\n", "    if (!name) {\n"]], TS],
  ["ز", "a nameless line is told by a wrong place", [[SOQ, "      problems.push(`السطر ${place} بلا منتج ولا وصف: اكتب وصفه أو اختر منتجه`);", "      problems.push(`السطر ${lineIdx} بلا منتج ولا وصف: اكتب وصفه أو اختر منتجه`);"]], TS],
  ["ز", "a note and a section are counted in a line's place", [[SOQ, "    place++;\n    const productName", "    const productName"], [SOQ, "    lineIdx++;\n    const kind", "    lineIdx++; place++;\n    const kind"]], TS],
  ["ز", "a line's total is the price × the quantity again, not Odoo's", [[SOQ, "gross = round2(num(l.price_total));", "gross = round2(stored * qty);"]], TS],
  ["ز", "a line's price before VAT is not Odoo's price_subtotal", [[SOQ, "      net = round2(num(l.price_subtotal));", "      net = round2(num(l.price_total));"]], TS],
  ["ز", "every tax is read as held in the price", [[SOQ, "      const included = Math.abs(asked - gross) <= Math.abs(asked - net);", "      const included = true;"]], TS],
  ["ز", "every tax is read as added on top", [[SOQ, "      const included = Math.abs(asked - gross) <= Math.abs(asked - net);", "      const included = false;"]], TS],
  ["ز", "the discount is forgotten when the taxes are told apart", [[SOQ, "      const asked = stored * qty * (1 - num(l.discount) / 100);", "      const asked = stored * qty * 100;"]], TS],
  ["ز", "a discounted line prints the undiscounted unit", [[SOQ, "      unit = num(l.discount) ? round2(total / qty) : stored;", "      unit = stored;"]], TS],
  ["ز", "an untaxed line counts as taxed", [[SOQ, "      if (tax > 0.004) { if (included) taxedIncluded++; else taxedExcluded++; }", "      if (true) { if (included) taxedIncluded++; else taxedExcluded++; }"]], TS],
  ["ز", "lines of both kinds are said «شاملة»", [[SOQ, VAT_WORDS, "  const vatWords = taxedIncluded > 0 ? \"included\" : taxedExcluded > 0 ? \"excluded\" : \"\";"]], TS],
  ["ز", "a tax held in the price is not said", [[SOQ, "      : vatWords === \"included\" ? { vatInclusive: true }", "      : vatWords === \"included\" ? {}"]], TS],
  ["ز", "a tax added on top is said «شاملة»", [[SOQ, "      : vatWords === \"excluded\" ? { footerNote: `${QUOTATION_FOOTER}. ${UI.vatExclusiveNote.ar}` } : {}),", "      : vatWords === \"excluded\" ? { vatInclusive: true } : {}),"]], TS],
  ["ز", "a tax added on top is not said", [[SOQ, "      : vatWords === \"excluded\" ? { footerNote: `${QUOTATION_FOOTER}. ${UI.vatExclusiveNote.ar}` } : {}),", "      : {}),"]], TS],
  ["ز", "«قبل الضريبة» is not Baraa's words", [[I18N, "  vatExclusiveNote: T(\"الأسعار قبل ضريبة القيمة المضافة\",", "  vatExclusiveNote: T(\"الأسعار بدون ضريبة\","]], TS],
  ["ز", "the subtotal is the lines' sum, not the order's amount", [[SOQ, "  const subtotal = fromOdoo ? round2(num(order.amount_untaxed)) : sumNet;", "  const subtotal = sumNet;"]], TS],
  ["ز", "the VAT is the lines' sum, not the order's amount", [[SOQ, "  const vatAmount = fromOdoo ? round2(num(order.amount_tax)) : sumTax;", "  const vatAmount = sumTax;"]], TS],
  ["ز", "the total is the lines' sum, not the order's amount", [[SOQ, "  const grandTotal = fromOdoo ? round2(num(order.amount_total)) : sumGross;", "  const grandTotal = sumGross;"]], TS],
  ["ز", "the VAT is 0 and the total the subtotal, as before", [[SOQ, "  const vatAmount = fromOdoo ? round2(num(order.amount_tax)) : sumTax;", "  const vatAmount = 0;"]], TS],
  ["ز", "the order's amounts are used though a line's price is not Odoo's", [[SOQ, "  const fromOdoo = !fallbackPriced && typeof order.amount_total === \"number\";", "  const fromOdoo = typeof order.amount_total === \"number\";"]], TS],
  ["ز", "a fallback price is read as before VAT", [[SOQ, "net = round2(gross / VAT_FACTOR); tax = round2(gross - net);", "net = gross; tax = 0;"]], TS],
  ["ز", "the totals keep a «الخصم» row", [[SOQ, "hideDiscount: true },", "hideDiscount: false },"]], TS],
  ["ز", "the VAT row says 15% with no tax on the order", [[SOQ, "vatLabel: vatAmount > 0 ? SALE_VAT_LABEL : SALE_NO_VAT_LABEL,", "vatLabel: SALE_VAT_LABEL,"]], TS],
  ["ز", "the subtotal's label is the day's «المجموع الفرعي»", [[SOQ, "totals: { subtotalLabel: SALE_NET_SUBTOTAL_LABEL, ", "totals: { "]], TS],
  ["ز", "a line with no product shows no packaging", [[SOQ, "    const packagingName = packagingNames[lineIdx] !== NO_PACKAGING_PLACEHOLDER || l.product_id || !uom ? packagingNames[lineIdx] : uom;", "    const packagingName = packagingNames[lineIdx];"]], TS],
  ["ز", "Odoo's generic unit names a packaging", [[SOQ, "l.product_uom_id && l.product_uom_id[0] !== GENERIC_UOM_ID ?", "l.product_uom_id ?"]], TS],
  ["ز", "a product's line takes its unit of measure for a packaging", [[SOQ, "!== NO_PACKAGING_PLACEHOLDER || l.product_id || !uom ? packagingNames[lineIdx] : uom;", "!== NO_PACKAGING_PLACEHOLDER || !uom ? packagingNames[lineIdx] : uom;"]], TS],
  ["ز", "an order with nothing to quote is a quotation", [[SOQ, "  if (!items.length && !problems.length) { has_blocking_issue = true; problems.push(\"لا أصناف في أمر البيع: أضف سطراً بكمية وسعر\"); }\n", ""]], TS],
  ["ز", "a line with no price is not named among the reasons", [[SOQ, "  for (const n of missing_products) problems.push(`صنف بلا سعر: ${n}`);\n", ""]], TS],
  ["ز", "the alternatives are not handed to the page", [[SOQ, "    ...(alternatives.length ? { belowTable: { label: SALE_ALTERNATIVES_LABEL, text: alternatives.join(\"\\n\") } } : {}),\n", ""]], TS],
  ["ز", "the notes are not handed to the page", [[SOQ, "    ...(notes.length ? { belowBlocks: [{ label: SALE_NOTES_LABEL, text: notes.join(\"\\n\") }] } : {}),\n", ""]], TS],
  ["ز", "the sections are not handed to the page", [[SOQ, "    ...(sections.length ? { sections } : {}),\n", ""]], TS],
  ["ز", "the page draws no group title", [[QUO, "  return (sections ?? []).filter((x) => x.before === index && String(x.title ?? \"\").trim()).map((x) => `", "  return ([] as NonNullable<QuotationPDFData[\"sections\"]>).map((x) => `"]], TS],
  ["ز", "the page draws no more blocks under the table", [[QUO, " + (data.belowBlocks ?? []).map((b) => renderBelowTableHTML(b)).join(\"\");", ";"]], TS],
  ["ز", "«إرسال واتساب» tells Baraa «صنف بلا سعر» whatever the reason", [[IDX, "              const reason = (data.problems ?? []).join(\" | \") || \"صنف بلا سعر\";", "              const reason = \"صنف بلا سعر\";"]], TS],
  ["ز", "a unit-price quotation's message states a total", [[IDX, "x_body: data.layout === \"unit\" ? `عرض سعر ${data.quotationNumber} — أسعار الوحدة لـ ${data.items.length} صنف` : ", "x_body: "]], TS],
  // ---------------------------------------------------------------- ح — «المنشأ» and «المقاس»
  ["ح", "a bare size is printed without «مقاس»", [[QUO, "z ? (/مقاس|size/i.test(z) ? z : `مقاس ${z}`) : \"\"", "z"]], TL],
  ["ح", "a size already worded gets «مقاس» again", [[QUO, "z ? (/مقاس|size/i.test(z) ? z : `مقاس ${z}`) : \"\"", "z ? `مقاس ${z}` : \"\""]], TL],
  ["ح", "the origin and the size are not set apart", [[QUO, "].filter(Boolean).join(\" · \");\n}\n/** A row's height", "].filter(Boolean).join(\" \");\n}\n/** A row's height"]], TL],
  ["ح", "the size comes before the origin", [[QUO, "  return [o, z ? (/مقاس|size/i.test(z) ? z : `مقاس ${z}`) : \"\"].filter(Boolean)", "  return [z ? (/مقاس|size/i.test(z) ? z : `مقاس ${z}`) : \"\", o].filter(Boolean)"]], TL],
  ["ح", "the detail line is not drawn under the name", [[QUO, "  return d ? `<div style=\"line-height: 1.3; overflow: hidden; text-overflow: ellipsis;\">${nameHTML}</div>${d}` : nameHTML;", "  return nameHTML;"]], TL],
  ["ح", "the detail is as large as the name", [[QUO, "<div data-utak=\"item-detail\" style=\"font-size: 9px;", "<div data-utak=\"item-detail\" style=\"font-size: 12px;"]], TL],
  ["ح", "a special request's line loses its size on the page", [[QT, "    const detail = itemDetail(l.origin, l.size);", "    const detail = itemDetail(l.origin, \"\");"]], TL],
  ["ح", "a special request's line loses its origin on the page", [[QT, "    const detail = itemDetail(l.origin, l.size);", "    const detail = itemDetail(\"\", l.size);"]], TL],
  ["ح", "the origin and the size are not read from the request's line", [[SQ, "origin: str(l.x_item_origin).trim(), size: str(l.x_item_size).trim(),", "origin: \"\", size: \"\","]], TL],
  ["ح", "the origin and the size do not go to the sale order", [[QT, "    x_item_origin: l.origin || false, x_item_size: l.size || false,\n", ""]], TL],
  ["ح", "the sale order's size is the origin", [[QT, "    x_item_origin: l.origin || false, x_item_size: l.size || false,", "    x_item_origin: l.origin || false, x_item_size: l.origin || false,"]], TL],
  ["ح", "an emptied origin stays on the sale order", [[QT, "    x_item_origin: l.origin || false, x_item_size: l.size || false,", "    ...(l.origin ? { x_item_origin: l.origin } : {}), x_item_size: l.size || false,"]], TL],
  ["ح", "a line that left the request keeps its price on the order (an «alternative» of its quotation)", [[QT, "commands.push([1, o.id, { product_uom_qty: 0, price_unit: 0 }]);", "commands.push([1, o.id, { product_uom_qty: 0 }]);"]], TL],
  ["ح", "a sale order's line loses its size on the page", [[SOQ, "    const detail = itemDetail(l.x_item_origin, l.x_item_size);", "    const detail = itemDetail(l.x_item_origin, \"\");"]], TS],
  ["ح", "a sale order's line loses its origin on the page", [[SOQ, "    const detail = itemDetail(l.x_item_origin, l.x_item_size);", "    const detail = itemDetail(\"\", l.x_item_size);"]], TS],
  ["ح", "the request's two columns are not on its form", [[LIB, "`<field name=\"x_unit\" string=\"التعبئة\"/>\\n            <field name=\"x_item_origin\" optional=\"show\"/>\\n            <field name=\"x_item_size\" optional=\"show\"/>`);", "`<field name=\"x_unit\" string=\"التعبئة\"/>`);"]], TL],
  ["ح", "the sale order's two columns are not on its form", [[LIB, "    <field name=\"x_item_origin\" optional=\"show\"/>\n    <field name=\"x_item_size\" optional=\"show\"/>\n  </xpath>", "  </xpath>"]], TL],
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
writeFileSync(new URL("../artifacts/s62d-20261007-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
