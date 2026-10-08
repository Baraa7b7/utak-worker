// Mutation check for § 46 (2026-10-01): each mutation disables ONE guard of a part, runs that
// part's test file (tests/s46-*.test.mts), and must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
//   node scripts/mutation/s46-20261001-mutations.mjs [أ|ب|ج|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s46-20261001-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TA = "tests/s46-board.test.mts";
const TB = "tests/s46-product.test.mts";
const TC = "tests/s46-zero-price.test.mts";
const TE = "tests/s46-post-launch.test.mts";
const PB = "src/pricing-board.ts";
const PR = "src/prices.ts";
const OC = "src/operating-cost.ts";
const EN = "src/pricing-engine.ts"; // § 47: the line's cost is priceFloor (the board and the engine's rule read the same numbers)
const LIB = "scripts/lib/s46-odoo-code.mjs";
const PSF = "src/product-setup.ts";
const ZP = "src/zero-price.ts";
const IV = "src/invoice.ts";
const RT = "src/router.ts";
const QT = "src/quotation.ts";
const IX = "src/index.ts";
const SF = "src/send-failure.ts";
const GW = "src/wa-gateway.ts";
const RP = "scripts/lib/real-partners.mjs";
const MK = "scripts/s42-20260927-prelaunch-mark.mts";
const CUT = "scripts/cutover-prod.mts";
const TT = "scripts/lib/tail-ticks.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the pricing board
  // § 47 أ — the purchase price is net as entered: the two mutations of the registered / unregistered
  // split are now the two ways of taking it for a VAT-inclusive (÷ 1.15) or a VAT-less (× 1.15) price.
  ["أ", "§ 47: the purchase divided by 1.15 again (taken as VAT-inclusive)", [[EN,
    "  const netH = halalas(a.purchase);", "  const netH = halalas(a.vatRatePct ? a.purchase / 1.15 : a.purchase);"]], TA],
  ["أ", "§ 47: the VAT added on the net purchase (× 1.15)", [[EN,
    "  const netH = halalas(a.purchase);", "  const netH = halalas(a.vatRatePct ? a.purchase * 1.15 : a.purchase);"]], TA],
  ["أ", "the waste on the purchase with its VAT (× 1.15), not on the net purchase", [[EN,
    "  const wasteH = Math.round((netH * Math.max(0, a.wastePct)) / 100);", "  const wasteH = Math.round((netH * 1.15 * Math.max(0, a.wastePct)) / 100);"]], TA],
  ["أ", "the full cost without the carton share", [[EN,
    "  const fullH = netH + wasteH + (a.opShare !== null ? halalas(a.opShare) : 0);", "  const fullH = netH + wasteH;"]], TA],
  ["أ", "the net sale not divided from the cutoff", [[PB,
    "const netSale = hasSale ? round2((i.sale as number) / d) : 0;", "const netSale = hasSale ? round2(i.sale as number) : 0;"]], TA],
  ["أ", "divided by 1.15 before the cutoff too", [[PB,
    "const d = i.vatRatePct ? 1 + i.vatRatePct / 100 : 1;", "const d = 1.15;"]], TA],
  ["أ", "a real profit of exactly 0 is 🟢", [[PB,
    "else status = realProfit > 0 ? \"green\" : \"yellow\";", "else status = realProfit >= 0 ? \"green\" : \"yellow\";"]], TA],
  ["أ", "no 🟡: not covering the share is 🔴", [[PB,
    "else status = realProfit > 0 ? \"green\" : \"yellow\";", "else status = realProfit > 0 ? \"green\" : \"red\";"]], TA],
  ["أ", "the goods exactly covered is 🔴", [[PB,
    "    if (goods < 0) status = \"red\";", "    if (goods <= 0) status = \"red\";"]], TA],
  ["أ", "an unreadable share guessed 🟢 / 🟡", [[PB,
    "    else if (i.opShare === null) status = \"none\";\n", ""]], TA],
  ["أ", "a status without a purchase price", [[PB,
    "const complete = hasPurchase && hasSale;", "const complete = hasSale;"]], TA],
  ["أ", "a status without a market price", [[PB,
    "const complete = hasPurchase && hasSale;", "const complete = hasPurchase;"]], TA],
  ["أ", "the actual average before 7 delivery days", [[PB,
    "  if (days.length < ACTUAL_DAYS) return { days: days.length, average: null };", "  if (days.length < 6) return { days: days.length, average: null };"]], TA],
  ["أ", "the actual average never used", [[PB,
    "const cartons = useActual ? (actual.average as number) : exp;", "const cartons = exp;"]], TA],
  ["أ", "the expected cartons empty → ÷ 1", [[PB,
    "const exp = expected !== null && expected > 0 ? expected : null;", "const exp = expected !== null && expected > 0 ? expected : 1;"]], TA],
  ["أ", "the comparison at 250 cartons", [[PB,
    "export const COMPARE_CARTONS = 500;", "export const COMPARE_CARTONS = 250;"]], TA],
  ["أ", "the comparison from the cartons in use", [[PB,
    "share500: cost !== null ? round2(cost / COMPARE_CARTONS) : null,", "share500: cost !== null ? round2(cost / (cartons ?? 1)) : null,"]], TA],
  ["أ", "a simulation delivery counted", [[PB,
    "[\"x_delivered_at\", \"<\", riyadhDayStartUtc(day)], [\"x_utak_simulation\", \"!=\", true]],", "[\"x_delivered_at\", \"<\", riyadhDayStartUtc(day)]],"]], TA],
  ["أ", "the board's own day counted", [[PB,
    "[\"x_delivered_at\", \">=\", from], [\"x_delivered_at\", \"<\", riyadhDayStartUtc(day)], ", "[\"x_delivered_at\", \">=\", from], "]], TA],
  ["أ", "an undelivered order counted", [[PB,
    "domain: [[\"x_state\", \"in\", [\"delivered\", \"closed\"]], [\"x_delivered_at\", \">=\", from],", "domain: [[\"x_delivered_at\", \">=\", from],"]], TA],
  ["أ", "a delivery older than the look-back counted", [[PB,
    "domain: [[\"x_state\", \"in\", [\"delivered\", \"closed\"]], [\"x_delivered_at\", \">=\", from],", "domain: [[\"x_state\", \"in\", [\"delivered\", \"closed\"]],"]], TA],
  ["أ", "a line short at delivery counted", [[PB,
    "domain: [[\"x_order_id\", \"in\", ids], [\"x_status\", \"!=\", \"unavailable\"], ", "domain: [[\"x_order_id\", \"in\", ids], "]], TA],
  ["أ", "the average over every delivery day, not the last 7", [[PB,
    "const ids = days.slice(0, ACTUAL_DAYS).flatMap(", "const ids = days.flatMap("]], TA],
  ["أ", "the delivery day by the UTC date", [[PB,
    "const riyadhDayOf = (odooUtc: string) => new Date(Date.parse(odooUtc.replace(\" \", \"T\") + \"Z\") + 3 * 3600_000).toISOString().slice(0, 10);",
    "const riyadhDayOf = (odooUtc: string) => new Date(Date.parse(odooUtc.replace(\" \", \"T\") + \"Z\")).toISOString().slice(0, 10);"]], TA],
  ["أ", "the day's cost never read again", [[PB,
    "nowMs - kept.at < BOARD_INPUT_TTL_SEC * 1000", "nowMs - kept.at < 99999 * 1000"]], TA],
  ["أ", "«🔄 إعادة الحساب» does not read the cost again", [[PR,
    // § 47 ب: the inputs are read before the rule (the suggested price needs the carton share)
    "of the rule\n  const inputs = await readBoardInputs(env, day, now, !!opts.force);",
    "of the rule\n  const inputs = await readBoardInputs(env, day, now, false);"]], TA],
  ["أ", "the share not in the engine's fingerprint", [[PR,
    "    [share.cost, share.cartons, share.basis, share.expected],\n", ""]], TA],
  ["أ", "the card of an exception has no sale (the market price not used)", [[PR,
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.sale, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: v.sale, approved: v.sale > 0, wastePct: settings.wastePct,"]], TA],
  ["أ", "the engine's card ignores Baraa's price", [[PR,
    "purchase: p.purchase, sale: v.sale > 0 ? v.sale : p.sale, approved: v.sale > 0, wastePct: settings.wastePct,", "purchase: p.purchase, sale: p.sale, approved: v.sale > 0, wastePct: settings.wastePct,"]], TA],
  ["أ", "the stored card ignores Baraa's price", [[PR,
    "sale: Number(l.x_sale_price) > 0 ? Number(l.x_sale_price) : marketSale(l),", "sale: marketSale(l),"]], TA],
  // § 47 أ — no source is «registered» on the board any more; its counterpart: the engine's own line keeps the carton share
  ["أ", "§ 47: the engine's line computed without the carton share", [[PR,
    "      vatRatePct: vat.ratePct, opShare: share.share, minProfit: settings.minProfit,\n    });", "      vatRatePct: vat.ratePct, opShare: null, minProfit: settings.minProfit,\n    });"]], TA],
  ["أ", "the header not written by the engine", [[PR,
    "    await call(env, PRICE_DAY_MODEL, \"write\", { ids: [rec.id], vals: { ...boardHeader(share, board, now), ...screen.header(), ...(await recipientsCount(env)) } });", "    void boardHeader;"]], TA],
  ["أ", "no board after a decision", [[PR,
    "    await rewriteBoard(env, dayId, { now });", "    void dayId;"]], TA],
  ["أ", "a dry rewrite writes the lines", [[PR,
    "    if (!opts.dry) await call(env, PRICE_LINE_MODEL, \"write\", { ids: [l.id], vals });", "    await call(env, PRICE_LINE_MODEL, \"write\", { ids: [l.id], vals });"]], TA],
  ["أ", "a dry rewrite writes the header", [[PR,
    "  if (!opts.dry) await call(env, PRICE_DAY_MODEL, \"write\", { ids: [dayId], vals: header });", "  await call(env, PRICE_DAY_MODEL, \"write\", { ids: [dayId], vals: header });"]], TA],
  ["أ", "🟡 counted as 🟢 in the header", [[PB,
    "x_n_green: n(\"green\"), x_n_yellow: n(\"yellow\"),", "x_n_green: n(\"green\") + n(\"yellow\"), x_n_yellow: 0,"]], TA],
  ["أ", "the expected cartons not read from the settings", [[OC,
    "    expectedCartons: cartons > 0 ? Math.floor(cartons) : null,", "    expectedCartons: 250,"]], TA],
  ["أ", "the board changes the sale price (the rule moved)", [[PR,
    "      x_sale_price: v.sale,\n      x_excluded: v.excluded,", "      x_sale_price: b.x_board_sale,\n      x_excluded: v.excluded,"]], TA],
  // ---------------------------------------------------------------- ب the new product
  ["ب", "a reference typed by hand overwritten on creation", [[LIB,
    "    if not code:\n${refBlock(\"        \")}", "    if True:\n${refBlock(\"        \")}"]], TB],
  ["ب", "a service prepared", [[LIB,
    "    if rec.type == 'service' or code.startswith('UTAK-SALE') or code.startswith('UTAK-PUR'):", "    if code.startswith('UTAK-SALE') or code.startswith('UTAK-PUR'):"]], TB],
  ["ب", "UTAK-SALE… prepared", [[LIB,
    "    if rec.type == 'service' or code.startswith('UTAK-SALE') or code.startswith('UTAK-PUR'):", "    if rec.type == 'service' or code.startswith('UTAK-PUR'):"]], TB],
  ["ب", "UTAK-PUR… prepared", [[LIB,
    "    if rec.type == 'service' or code.startswith('UTAK-SALE') or code.startswith('UTAK-PUR'):", "    if rec.type == 'service' or code.startswith('UTAK-SALE'):"]], TB],
  ["ب", "«نشط للبيع» left as created", [[LIB,
    "        'x_is_active_for_sale': False,\n", ""]], TB],
  ["ب", "the flag for Baraa's alert not set", [[LIB,
    "        '${NEW_FLAG}': True,\n", ""]], TB],
  ["ب", "an archived product's number not counted (a repeated reference)", [[LIB,
    "Tmpl = env['product.template'].with_context(active_test=False)\nPack = env", "Tmpl = env['product.template']\nPack = env"]], TB],
  ["ب", "the highest number repeated (no + 1)", [[LIB,
    "    ref = prefix + str(top + 1).zfill(3)", "    ref = prefix + str(top).zfill(3)"]], TB],
  ["ب", "the reference not padded to three digits", [[LIB,
    "    ref = prefix + str(top + 1).zfill(3)", "    ref = prefix + str(top + 1)"]], TB],
  ["ب", "a reference that is not a number breaks the series", [[LIB,
    "        if tail.isdigit() and int(tail) > top:", "        if int(tail) > top:"]], TB],
  ["ب", "a parent category not followed (Odoo)", [[LIB,
    "    c = c.parent_id\n", "    c = False\n"]], TB],
  ["ب", "the plain 15% as the purchase tax", [[LIB,
    "'supplier_taxes_id': [(6, 0, [${d.purchaseTax}])],", "'supplier_taxes_id': [(6, 0, [${d.saleTax}])],"]], TB],
  ["ب", "the sale tax not set", [[LIB,
    "        'taxes_id': [(6, 0, [${d.saleTax}])],\n", ""]], TB],
  ["ب", "the purchase method left as created", [[LIB,
    "        'purchase_method': '${d.purchaseMethod}',\n", ""]], TB],
  ["ب", "a second packaging on a product that has one", [[LIB,
    "    if not Pack.search_count([('x_product_tmpl_id', '=', rec.id)]):", "    if True:"]], TB],
  ["ب", "the packaging not the default", [[LIB,
    "'x_approx_weight_kg': ${TEMP_CARTON_KG}, 'x_is_default': True,", "'x_approx_weight_kg': ${TEMP_CARTON_KG}, 'x_is_default': False,"]], TB],
  ["ب", "the temporary weight 5 kg", [[LIB,
    "export const TEMP_CARTON_KG = 8;", "export const TEMP_CARTON_KG = 5;"]], TB],
  ["ب", "the category set later overwrites a typed reference", [[LIB,
    "    if code or rec.type == 'service':\n        continue", "    if rec.type == 'service':\n        continue"]], TB],
  ["ب", "vegetables numbered as fruits", [[LIB,
    "\"خضار\": \"UTAK-VEG-\"", "\"خضار\": \"UTAK-FRT-\""]], TB],
  ["ب", "the alert at once (no 10 minutes)", [[PSF,
    "const ok = Number.isFinite(created) && now - created >= ALERT_AFTER_MIN * 60_000;", "const ok = Number.isFinite(created) && now - created >= 0;"]], TB],
  ["ب", "the flag not cleared after the alert", [[PSF,
    "    await call(env, \"product.template\", \"write\", { ids: [p.id], vals: { [NEW_FLAG]: false } })\n      .catch(", "    await Promise.resolve()\n      .catch("]], TB],
  ["ب", "a second alert when the flag comes back", [[PSF,
    "    if (!claim.claimed) {\n      // alerted before", "    if (false) {\n      // alerted before"]], TB],
  ["ب", "an alert with nothing missing", [[PSF,
    "      if (missing.length) {\n        const { sendOwnerAlert }", "      if (true) {\n        const { sendOwnerAlert }"]], TB],
  ["ب", "an existing product alerted (the flag not read)", [[PSF,
    "    domain: [[NEW_FLAG, \"=\", true]],", "    domain: [],"]], TB],
  ["ب", "a parent category not followed (the worker)", [[PSF,
    "c = cats.get(m2oId(c.parent_id)), hops++", "c = undefined, hops++"]], TB],
  ["ب", "the supplier not listed", [[PSF,
    "  if (!(p.x_supplier_ids ?? []).length) out.push(\"المورد\");\n", ""]], TB],
  ["ب", "«نشط للبيع» not listed", [[PSF,
    "  if (p.x_is_active_for_sale !== true) out.push(\"«نشط للبيع»\");\n", ""]], TB],
  ["ب", "the carton's weight listed whatever it is", [[PSF,
    "else if (def.x_type === \"carton\" && Number(def.x_approx_weight_kg) === TEMP_CARTON_KG) out.push(", "else if (def.x_type === \"carton\") out.push("]], TB],
  ["ب", "the category not listed", [[PSF,
    "  if (!categ || !isRefCategory(categ, cats)) {", "  if (false) {"]], TB],
  ["ب", "the tick not wired", [[IX,
    "            const ps = await runProductSetupTick(withAutoSendJob(rawEnv, PRODUCT_SETUP_JOB), Date.now());", "            const ps: Array<{ action: string }> = [];"]], TB],
  // ---------------------------------------------------------------- ج the zero-price guard
  ["ج", "0 is a price", [[ZP,
    "return !(typeof unit === \"number\" && Number.isFinite(unit) && unit > 0);", "return !(typeof unit === \"number\" && Number.isFinite(unit) && unit >= 0);"]], TC],
  ["ج", "a negative price is a price", [[ZP,
    "return !(typeof unit === \"number\" && Number.isFinite(unit) && unit > 0);", "return !(typeof unit === \"number\" && Number.isFinite(unit) && unit !== 0);"]], TC],
  // § 49 ب — «خلاص» (the request, and the order's own message) makes its quotation in quoteOrder (src/order-flow.ts): the guard stands there, once for both
  // § 59 ج — the guard inside quoteOrder is gone with its two mutations («the guard off at the quotation
  // request», «…at «خلاص» in the order's message»): a line the list does not hold leaves the order before
  // any quotation («غير متوفر اليوم», scripts/mutation/s59-20261006-mutations.mjs), so nothing without a
  // price reaches it. The guard at «تأكيد الطلب» and its alert are checked below, as before.
  ["ج", "the guard off at «تأكيد الطلب»", [[RT,
    "  if (review) {\n    if (o.state !== \"draft\") await updateOrderState(env, orderId, \"draft\");", "  if (false) {\n    if (o.state !== \"draft\") await updateOrderState(env, orderId, \"draft\");"]], TC],
  ["ج", "a refused confirm leaves the order «بانتظار التأكيد»", [[RT,
    "    if (o.state !== \"draft\") await updateOrderState(env, orderId, \"draft\");\n    return { text: review };", "    return { text: review };"]], TC],
  ["ج", "no alert to Baraa for the quotation", [[ZP,
    "  if (claim.claimed) {\n    await alertOwner(env, [\n      `🚫 عرض سعر لم يُرسل", "  if (false) {\n    await alertOwner(env, [\n      `🚫 عرض سعر لم يُرسل"]], TC],
  ["ج", "an alert at every «خلاص»", [[ZP,
    "const claim = await claimButton(env, `zero_q:${orderId}:${riyadhDateKey()}`, 26 * 3600);", "const claim = await claimButton(env, `zero_q:${orderId}:${Math.random()}`, 26 * 3600);"]], TC],
  ["ج", "the alert without the order's number", [[ZP,
    "      `🚫 عرض سعر لم يُرسل — الطلب #${orderId} (${found.customer || \"عميل\"}): صنف بسعر صفر أو بلا سعر:`,", "      `🚫 عرض سعر لم يُرسل (${found.customer || \"عميل\"}): صنف بسعر صفر أو بلا سعر:`,"]], TC],
  ["ج", "the alert without the items", [[ZP,
    "      ...found.zero.map(label),\n", ""]], TC],
  ["ج", "the manual price not read by the check", [[ZP,
    "let unit = !isZeroPrice(l.price_unit_manual) ? (l.price_unit_manual as number) : !isZeroPrice(l.unit_price) ? (l.unit_price as number) : 0;", "let unit = !isZeroPrice(l.unit_price) ? (l.unit_price as number) : 0;"]], TC],
  ["ج", "the stored unit price not read by the check", [[ZP,
    "let unit = !isZeroPrice(l.price_unit_manual) ? (l.price_unit_manual as number) : !isZeroPrice(l.unit_price) ? (l.unit_price as number) : 0;", "let unit = !isZeroPrice(l.price_unit_manual) ? (l.price_unit_manual as number) : 0;"]], TC],
  ["ج", "the day's price not read by the check", [[ZP,
    "    if (isZeroPrice(unit)) unit = (await unfrozenLinePrice(env, order, l.product_id, l.packaging_id)).price;\n", ""]], TC],
  ["ج", "the PDF pipeline's alert without the order", [[QT,
    "${data.order_id ? `، الطلب #${data.order_id}` : \"\"}", ""]], TC],
  ["ج", "the invoice guard off", [[IV,
    "  if (zeroLines.length) {\n    console.warn(`[invoice] order ${orderId}: ${zeroLines.length} line(s) without a price", "  if (false) {\n    console.warn(`[invoice] order ${orderId}: ${zeroLines.length} line(s) without a price"]], TC],
  ["ج", "the invoice issued after the alert", [[IV,
    "issuedAt.getTime());\n    return null;\n  }", "issuedAt.getTime());\n  }"]], TC],
  ["ج", "the invoice's check takes 0 as a price", [[IV,
    "  const zeroLines = pricedLines.filter((p) => isZeroPrice(p.unit));", "  const zeroLines = pricedLines.filter((p) => p.unit === undefined);"]], TC],
  ["ج", "the held order not remembered for the tick", [[ZP,
    "    if (!list.some((h) => h.o === orderId)) await writeIndex(env, [...list, { o: orderId, at: now }]);", "    void list;"]], TC],
  ["ج", "a held order listed twice", [[ZP,
    "    if (!list.some((h) => h.o === orderId)) await writeIndex(env, [...list, { o: orderId, at: now }]);", "    await writeIndex(env, [...list, { o: orderId, at: now }]);"]], TC],
  ["ج", "an alert at every hold of the same order", [[ZP,
    "const claim = await claimButton(env, `inv_zero_alert:${orderId}`, Math.ceil(ZERO_INVOICE_KEEP_MS / 1000));", "const claim = await claimButton(env, `inv_zero_alert:${orderId}:${Math.random()}`, Math.ceil(ZERO_INVOICE_KEEP_MS / 1000));"]], TC],
  ["ج", "no alert to Baraa for the invoice", [[ZP,
    "  if (!claim.claimed) return;\n  await alertOwner(env, [\n    `🚫 فاتورة لم تصدر", "  if (true) return;\n  await alertOwner(env, [\n    `🚫 فاتورة لم تصدر"]], TC],
  ["ج", "the tick tries the invoice while the price is still missing", [[ZP,
    "        if (z.zero.length) { out.push({ orderId: h.o, action: \"waiting\" }); continue; }", "        if (false) { out.push({ orderId: h.o, action: \"waiting\" }); continue; }"]], TC],
  ["ج", "the tick never issues", [[ZP,
    "        const inv = await createAndDispatchInvoiceForOrder(env, h.o);", "        const inv = null as { number: string } | null;"]], TC],
  ["ج", "an issued order stays in the list", [[ZP,
    "const done = new Set(out.filter((r) => r.action === \"issued\" || r.action === \"dropped\").map((r) => r.orderId));", "const done = new Set<number>();"]], TC],
  ["ج", "a held order never dropped (30 days)", [[ZP,
    "      if (now - h.at > ZERO_INVOICE_KEEP_MS) {", "      if (false) {"]], TC],
  ["ج", "the invoice ignores the corrected manual price", [[IV,
    "    if (isZeroPrice(unit) && !isZeroPrice(l.price_unit_manual)) unit = l.price_unit_manual as number;\n", ""]], TC],
  ["ج", "the tick reads Odoo with nothing held", [[ZP,
    "  const list = await readIndex(env);\n  if (!list.length) return [];\n  const run", "  const list = await readIndex(env);\n  await orderZeroLines(env, 0);\n  if (!list.length) return [];\n  const run"]], TC],
  ["ج", "the tick not wired", [[IX,
    "            const zi = await runZeroInvoiceTick(rawEnv, Date.now());", "            const zi: Array<{ action: string }> = [];"]], TC],
  // ---------------------------------------------------------------- هـ after the launch
  ["هـ", "x_quotation not in the mark's models", [[MK,
    "  \"x_daily_order\", \"x_daily_order_line\", \"x_quotation\", \"x_invoice\",", "  \"x_daily_order\", \"x_daily_order_line\", \"x_invoice\","]], TE],
  ["هـ", "no parent rule (a quotation never selected)", [[RP,
    "  if (parent) {\n    const all = await call(model, \"search\", {", "  if (false) {\n    const all = await call(model, \"search\", {"]], TE],
  ["هـ", "a real customer's quotation marked", [[RP,
    "return { hasIs: true, hasSim, ids: kept.ids, excluded: kept.excluded,", "return { hasIs: true, hasSim, ids: all, excluded: kept.excluded,"]], TE],
  ["هـ", "only an order already marked (the same run's orders missed)", [[RP,
    "\"|\", [`${parent}.x_utak_simulation`, \"=\", true], [`${parent}.x_is_simulation`, \"=\", true]], order: \"id asc\",", "[`${parent}.x_utak_simulation`, \"=\", true]], order: \"id asc\","]], TE],
  ["هـ", "a quotation already marked selected again", [[RP,
    "domain: [[\"x_utak_simulation\", \"!=\", true], \"|\", [`${parent}.x_utak_simulation`", "domain: [\"|\", [`${parent}.x_utak_simulation`"]], TE],
  ["هـ", "the first tick waits 12 minutes", [[CUT,
    "export const FIRST_TICK_WAIT_MIN = 90;", "export const FIRST_TICK_WAIT_MIN = 12;"]], TE],
  ["هـ", "wrangler tail not accepted for the first tick", [[CUT,
    "prodTick = seen ? { ...seen, source: \"analytics\" } : live ? { scriptName: \"utak-worker\", cron: live.cron, status: live.outcome, datetime: live.at, source: \"wrangler tail\" } : null;",
    "prodTick = seen ? { ...seen, source: \"analytics\" } : null;"]], TE],
  ["هـ", "a brace inside a string breaks the tail's events", [[TT,
    "    if (ch === '\"') { if (depth > 0) inString = true; continue; }", "    if (ch === '\"') { continue; }"]], TE],
  ["هـ", "a request counted as a scheduled tick", [[TT,
    "&& typeof o.event.cron === \"string\")", "&& true)"]], TE],
  ["هـ", "131042 alerted per template", [[SF,
    "  if (isPaymentIssue(f.code)) {\n    try {", "  if (false) {\n    try {"]], TE],
  ["هـ", "a 131042 alert at every refusal", [[SF,
    "      if (await env.MSG_DEDUP.get(key)) return;\n      await env.MSG_DEDUP.put(key, new Date().toISOString(), { expirationTtl: ALERT_TTL });\n      const { sendOwnerAlert } = await import(\"./templates\");\n      await sendOwnerAlert(env, PAYMENT_ISSUE_TEXT);",
    "      await env.MSG_DEDUP.put(key, new Date().toISOString(), { expirationTtl: ALERT_TTL });\n      const { sendOwnerAlert } = await import(\"./templates\");\n      await sendOwnerAlert(env, PAYMENT_ISSUE_TEXT);"]], TE],
  ["هـ", "the 131042 alert once ever (not once a day)", [[SF,
    "      const key = `${PAYMENT_ALERT_PREFIX}${day}`;", "      const key = `${PAYMENT_ALERT_PREFIX}`;"]], TE],
  ["هـ", "no 131042 alert when the refused template was Baraa's own", [[SF,
    "  if (isPaymentIssue(f.code)) {\n    try {", "  if (isPaymentIssue(f.code)) {\n    if (isOwner(env, f.to)) return;\n    try {"]], TE],
  ["هـ", "the alert's text changed", [[SF,
    "سدّد المستحق في الفوترة والمدفوعات لحساب واتساب للأعمال\";", "راجع حساب واتساب للأعمال\";"]], TE],
  ["هـ", "131042 blocks the purpose for 24h", [["src/meta-errors.ts",
    "  if (c === 131042) return \"payment\";", "  if (c === 131042) return \"permanent\";"]], TE],
  ["هـ", "a stored 131042 block still blocks", [[GW,
    "    return metaErrorClass((JSON.parse(stored) as { code?: number | string | null })?.code) === \"permanent\";", "    return true;"]], TE],
  ["هـ", "no stored block blocks any more", [[GW,
    "    return metaErrorClass((JSON.parse(stored) as { code?: number | string | null })?.code) === \"permanent\";", "    return false;"]], TE],
  ["هـ", "131042 as a string not recognised", [[SF,
    "export const isPaymentIssue = (code: unknown): boolean => Number(code) === META_PAYMENT_ISSUE;", "export const isPaymentIssue = (code: unknown): boolean => code === META_PAYMENT_ISSUE;"]], TE],
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
writeFileSync(new URL("../artifacts/s46-20261001-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
