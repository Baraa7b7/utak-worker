// Mutation check for the pricing engine v1 (STATUS § 40, 2026-09-26): each
// mutation disables ONE guard of a part, runs tests/pricing-v1.test.mts, and
// must make it fail. The source is restored in `finally` after every run; a
// pattern that is not found exactly once stops the script.
//
//   node scripts/s40-20260926-mutations.mjs [أ|ب|ج|د|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s40-20260926-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/pricing-v1.test.mts";
const OC = "src/operating-cost.ts";
const PS = "src/price-sources.ts";
const EN = "src/pricing-engine.ts";
const PR = "src/prices.ts";
const OP = "src/order-pricing.ts";
const SM = "src/owner-summary.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the operating costs
  ["أ", "a monthly share on the driver's day off", [[OC,
    "    if (!workingDay) return 0;\n", ""]], T],
  ["أ", "monthly ÷ 30 calendar days, not the working days", [[OC,
    "const days = i.frequency === \"monthly\" ? monthWorkingDays : yearWorkingDays;", "const days = i.frequency === \"monthly\" ? 30 : yearWorkingDays;"]], T],
  ["أ", "yearly ÷ the month's working days", [[OC,
    "const days = i.frequency === \"monthly\" ? monthWorkingDays : yearWorkingDays;", "const days = monthWorkingDays;"]], T],
  ["أ", "«إلى» ignored", [[OC,
    "domain: [[\"x_date_from\", \"<=\", day], \"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],",
    "domain: [[\"x_date_from\", \"<=\", day], [SIM_FIELD, \"!=\", true]],"]], T],
  ["أ", "«من» ignored", [[OC,
    "domain: [[\"x_date_from\", \"<=\", day], \"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],",
    "domain: [\"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],"]], T],
  ["أ", "a simulation line counted", [[OC,
    "[\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],", "[\"x_date_to\", \">=\", day]],"]], T],
  ["أ", "no driver schedule → 0 (a guess) instead of «تعذّر»", [[OC,
    "    if (!schedule) return null;\n", "    if (!schedule) return 0;\n"]], T],
  ["أ", "the unreadable total summed partially", [[OC,
    "    total: unread ? null : round2(shares.reduce((a, s) => a + (s.perDay as number), 0)),",
    "    total: round2(shares.reduce((a, s) => a + (s.perDay ?? 0), 0)),"]], T],
  ["أ", "any member's schedule, not the driver's", [[OC,
    "roster.members.filter((m) => m.codes.includes(\"driver\") && m.calendarId)", "roster.members.filter((m) => m.calendarId)"]], T],
  ["أ", "a driver off attendance: his schedule not read", [[OC,
    "  if (!lines.length) {\n    // not on attendance", "  if (false) {\n    // not on attendance"]], T],
  ["أ", "planned stops «empty» read as 0 stops", [[OC,
    "    plannedStops: stops > 0 ? Math.floor(stops) : null,", "    plannedStops: Math.floor(stops),"]], T],
  ["أ", "the settings of an inactive record", [[OC,
    "    domain: [[\"x_is_active\", \"=\", true], [\"x_active_from\", \"<=\", day],", "    domain: [[\"x_active_from\", \"<=\", day],"]], T],
  // ---------------------------------------------------------------- ب the sources
  ["ب", "the extractor's label trusted (no «سوق» / «شراء» rule)", [[PS,
    "    const kind = k === \"ambiguous\" ? c.label : k === \"other\" ? OTHER[DEFAULT_KIND[role]] : DEFAULT_KIND[role];", "    const kind = c.label;"]], T],
  ["ب", "«20 سوق 24»: the keyword taken by both numbers", [[PS,
    "      return !(next !== undefined && NUM.test(next));", "      return true;"]], T],
  ["ب", "a number not written in the message kept (م6)", [[PS,
    "    if (k === \"unwritten\") { out.dropped.push(`${c.v}: غير مكتوب في الرسالة`); continue; }", "    if (false) { continue; }"]], T],
  ["ب", "a quantity not written kept", [[PS,
    "    if (kindByText(text, q, role) === \"unwritten\") out.dropped.push(`الكمية ${q}: غير مكتوبة`);\n    else out.qty = q;", "    out.qty = q;"]], T],
  ["ب", "a product outside the catalog kept", [[PS,
    "    if (!ids.has(it.product_id)) { dropped.push({ item: it, reason: \"صنف لا يورّده\" }); continue; }", ""]], T],
  ["ب", "Omar's default kind: purchase", [[PS,
    "const DEFAULT_KIND: Record<SourceRole, PriceKind> = { supplier: \"purchase\", observer: \"market\" };", "const DEFAULT_KIND: Record<SourceRole, PriceKind> = { supplier: \"purchase\", observer: \"purchase\" };"]], T],
  ["ب", "the market ask sent to a supplier too", [[PS,
    "...src.partners.filter((p) => !p.supplier && !emp.has(p.partnerId))", "...src.partners.filter((p) => !emp.has(p.partnerId))"]], T],
  ["ب", "the ask not claimed once a day", [[PS,
    "claimButton(env, `mask_sent:${day}:p${t.partnerId}`, 26 * 60 * 60)", "claimButton(env, `mask_sent:${day}:p${t.partnerId}:${Math.random()}`, 26 * 60 * 60)"]], T],
  ["ب", "the ask before 02:30", [[PS,
    "  if (m < MARKET_ASK_MINUTE) return { action: \"before\" };\n", ""]], T],
  ["ب", "the ask after the publication time", [[PS,
    "  if (m >= untilMinute) return { action: \"after\" };\n", ""]], T],
  ["ب", "outside the window: held by the gateway, not the team queue", [[PS,
    "content: textContent(text), noHold: true, noHoldReason: \"طابور الفريق حتى «بدء الدوام»\" }", "content: textContent(text) }"]], T],
  ["ب", "before the tap: sent anyway", [[PS,
    "        if (h.hold) {\n          if (h.phase === \"before\") {", "        if (false) {\n          if (h.phase === \"before\") {"]], T],
  ["ب", "a day off: queued anyway", [[PS,
    "          if (h.phase === \"before\") {", "          if (true) {"]], T],
  ["ب", "the reply window a day, not 90 minutes", [[PS,
    "nowMs - m.at <= MARKET_REPLY_WINDOW_MIN * MIN", "nowMs - m.at <= 24 * 60 * MIN"]], T],
  ["ب", "the held ask's delivering message read as prices", [[PS,
    "  if (m.at === null) { await writeMarketAskMarker(env, digits, day, nowMs); return false; }", "  if (m.at === null) { await writeMarketAskMarker(env, digits, day, nowMs); return true; }"]], T],
  ["ب", "the queue flush does not start the window", [["src/team-queue.ts",
    "        if (r.ok && marketAsk) {", "        if (false) {"]], T],
  ["ب", "yesterday's queued ask sent", [["src/team-queue.ts",
    "      if (l.ask_day !== riyadhDateKey()) {", "      if (false) {"]], T],
  ["ب", "a source without the flag read", [[PS,
    "  if (!emp && !src.partners.some((p) => p.partnerId === who.partnerId && !p.supplier)) return null;\n", ""]], T],
  ["ب", "no market outlier", [[PS,
    "  const mOut = isOutlier(lastM, o.market);", "  const mOut = false;"]], T],
  ["ب", "a simulation offer as the outlier reference", [[PS,
    "[f, \">\", 0], [SIM_FIELD, \"!=\", true]],", "[f, \">\", 0]],"]], T],
  ["ب", "Ahmed's «سوق» number saved as his purchase price", [["src/suppliers.ts",
    "    const p = { ...k.item, cost_price: k.purchase ?? 0 };", "    const p = { ...k.item, cost_price: k.purchase ?? k.market ?? 0 };"], ["src/suppliers.ts",
    "      if (k.purchase !== undefined) {", "      if (p.cost_price > 0) {"]], T],
  ["ب", "Ahmed's market observation not saved", [["src/suppliers.ts",
    "      if (k.market !== undefined || k.qty !== undefined) {", "      if (false) {"]], T],
  ["ب", "the team hook not wired in /webhook", [["src/index.ts",
    ".then((m) => m.tryMarketReply(env,", ".then((m) => null && m.tryMarketReply(env,"]], T],
  ["ب", "the ask not in the */5 prices tick", [["src/prices.ts",
    "    out.marketAsk = await runMarketAsk(env, now, dl);", "    out.marketAsk = { action: \"ran\" }; void runMarketAsk;"]], T],
  ["ب", "the ask under the cron's job (a «duplicate» of another text that day)", [[PS,
    "  const jenv = withAutoSendJob(env, MARKET_ASK_PURPOSE);", "  const jenv = env; void withAutoSendJob;"]], T],
  ["ب", "Omar's reply not acknowledged", [[PS,
    "  return { saved, reply: marketAckText(saved) };", "  return { saved, reply: \"\" };"]], T],
  // ---------------------------------------------------------------- ج the engine
  ["ج", "purchase = the highest, not the lowest", [[EN,
    "const purchases = its.filter((o) => o.kind === \"purchase\").sort((a, b) => a.price - b.price || a.rowId - b.rowId);", "const purchases = its.filter((o) => o.kind === \"purchase\").sort((a, b) => b.price - a.price || a.rowId - b.rowId);"]], T],
  ["ج", "market = the mean, not the median", [[EN,
    "  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);", "  return round2(v.reduce((a, b) => a + b, 0) / v.length);"]], T],
  ["ج", "an even count: the upper middle, not the mean of the two", [[EN,
    "  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);", "  return round2(v[mid]);"]], T],
  ["ج", "sale = the purchase price", [[EN,
    "  return { status: \"auto\", sale: round2(p.market as number), excluded: false, reason: \"\" };", "  return { status: \"auto\", sale: round2(p.purchase as number), excluded: false, reason: \"\" };"]], T],
  ["ج", "the waste ignored in the unit profit", [[EN,
    "  return round2(market - purchase - (wastePct / 100) * purchase);", "  return round2(market - purchase);"]], T],
  ["ج", "(1) no purchase price is not an exception", [[EN,
    "    if (purchase === null) exceptions.push(\"no_purchase\");\n", ""]], T],
  ["ج", "(2) no market price is not an exception", [[EN,
    "    if (market === null) exceptions.push(\"no_market\");\n", ""]], T],
  ["ج", "(3) a unit profit of 0 passes (< instead of ≤)", [[EN,
    "    if (profit !== null && profit <= 0) exceptions.push(\"no_profit\");", "    if (profit !== null && profit < 0) exceptions.push(\"no_profit\");"]], T],
  ["ج", "(4) an outlier purchase price passes", [[EN,
    "const outlier = { purchase: !!p?.outlier, market: markets.some((o) => o.outlier) };", "const outlier = { purchase: false, market: markets.some((o) => o.outlier) };"]], T],
  ["ج", "(4) an outlier market observation passes", [[EN,
    "const outlier = { purchase: !!p?.outlier, market: markets.some((o) => o.outlier) };", "const outlier = { purchase: !!p?.outlier, market: false };"]], T],
  ["ج", "a source's earlier row counts over its latest", [[EN,
    "    if (!cur || o.rowId > cur.rowId) best.set(k, o);", "    if (!cur) best.set(k, o);"]], T],
  ["ج", "a supplier without «مصدر أسعار» counted", [[EN,
    "[\"x_extraction_status\", \"!=\", \"failed\"], [\"x_supplier_id\", \"in\", ids]],", "[\"x_extraction_status\", \"!=\", \"failed\"]],"]], T],
  ["ج", "a simulation offer counted", [[EN,
    "    domain: [[\"x_date\", \"=\", day], [\"x_utak_simulation\", \"!=\", true], [\"x_source_partner_id\", \"in\", ids]],", "    domain: [[\"x_date\", \"=\", day], [\"x_source_partner_id\", \"in\", ids]],"]], T],
  ["ج", "yesterday's observations carried over", [[EN,
    "    domain: [[\"x_date\", \"=\", day], [\"x_utak_simulation\", \"!=\", true], [\"x_source_partner_id\", \"in\", ids]],", "    domain: [[\"x_utak_simulation\", \"!=\", true], [\"x_source_partner_id\", \"in\", ids]],"]], T],
  ["ج", "an active product nobody priced gets no line", [[EN,
    "    for (const k of use.length ? use : [mine.find((x) => x.x_is_default) ?? mine[0]]) {", "    for (const k of use) {"]], T],
  ["ج", "Baraa's decision ignored by the refresh", [[PR,
    "    const decision = (l?.x_decision || null) as Decision | null;", "    const decision = null as Decision | null;"]], T],
  ["ج", "«لا تنشر» not honoured", [[EN,
    "  if (decision === \"skip\") return { status: \"unpublished\", sale: 0, excluded: true, reason: \"براء: لا تنشر\" };\n", ""]], T],
  ["ج", "exceptions sent before 04:00", [[PR,
    "  if (m < exceptionsFromMinutes(env) || m >= dl) return { action: \"outside\" };", "  if (m >= dl) return { action: \"outside\" };"]], T],
  ["ج", "exceptions sent after the publication time", [[PR,
    "  if (m < exceptionsFromMinutes(env) || m >= dl) return { action: \"outside\" };", "  if (m < exceptionsFromMinutes(env)) return { action: \"outside\" };"]], T],
  ["ج", "no KV guard per product and day", [[PR,
    "  for (const l of exc) if ((await env.MSG_DEDUP.get(`btnlock:v1:${excLock(day, l)}`)) === null) fresh.push(l);", "  for (const l of exc) fresh.push(l);"],
    [PR, "    const c = await claimButton(env, excLock(day, l), EXC_TTL);\n    if (!c.claimed) continue;", "    const c = await claimButton(env, `${excLock(day, l)}:${Math.random()}`, EXC_TTL);\n    if (!c.claimed) continue;"]], T],
  ["ج", "more than 8: a message per exception", [[PR,
    "  if (exc.length > EXCEPTIONS_MANY) {", "  if (false) {"]], T],
  ["ج", "the threshold at 7", [[PR,
    "export const EXCEPTIONS_MANY = 8;", "export const EXCEPTIONS_MANY = 7;"]], T],
  ["ج", "the count message without the review link", [[PR,
    "        `راجعها في شاشة المراجعة: ${await reviewUrl(env, rec.id)}`,\n", ""]], T],
  ["ج", "«اعتمد بسعر السوق» offered without a market price", [[PR,
    "      ...(Number(l.x_market_price) > 0 ? [{ id: `pexc_m_${l.id}`, title: \"اعتمد بسعر السوق\" }] : []),", "      { id: `pexc_m_${l.id}`, title: \"اعتمد بسعر السوق\" },"]], T],
  ["ج", "«اعتمد بسعر السوق» taken without a market price", [[PR,
    "    if (!(market > 0)) return `لا سعر سوق لـ ${name} اليوم: اختر «لا تنشر» أو «عدّل».`;\n", ""]], T],
  ["ج", "no lock: a second decision overwrites the first", [[PR,
    "  if (l.x_decision) return { l, day, why: `القرار مسجّل مسبقاً على ${lineName(l)}: ${DECISION_LABEL[l.x_decision as Decision]}.` };\n", ""],
    [PR, "  const lock = await claimButton(env, `pexc_dec:${l.id}`);", "  const lock = await claimButton(env, `pexc_dec:${l.id}:${Math.random()}`);"]], T],
  ["ج", "«عدّل»: a price after 30 minutes taken", [[PR,
    "  if (now - pend.at > EDIT_REPLY_MIN * 60_000 || now < pend.at) {", "  if (now < pend.at) {"]], T],
  ["ج", "«عدّل»: two numbers → the first taken", [[PR,
    "  if (nums.length !== 1) return", "  if (nums.length < 1) return"]], T],
  ["ج", "a decision after the publication taken", [[PR,
    "  if (!day || (day.x_state !== \"draft\" && day.x_state !== \"missed\")) {", "  if (!day) {"]], T],
  ["ج", "an exception without a decision published", [[PR,
    "  return (l.x_status === \"auto\" || l.x_status === \"manual\") && !l.x_excluded && Number(l.x_sale_price) > 0;", "  return l.x_status !== \"unpublished\";"]], T],
  ["ج", "no line to Baraa with the undecided count", [[PR,
    "    if (undecided.length) {\n      await sendOwnerAlert(", "    if (false) {\n      await sendOwnerAlert("]], T],
  ["ج", "the publication time waits for Baraa (no automatic approval)", [[PR,
    "  if (target.x_state === \"draft\" && lines.some(isPublishable)) {", "  if (false) {"]], T],
  ["ج", "no last refresh at the publication time", [[PR,
    "    await refreshPriceDay(env, { day, now, force: true });\n", ""]], T],
  ["ج", "the tick runs the engine all day", [[PR,
    "    out.refresh = m >= ENGINE_FROM_MINUTE && m < dl + DEADLINE_WINDOW_MIN", "    out.refresh = true"]], T],
  ["ج", "the publication's sale rule: the purchase price", [["src/pricing-engine.ts",
    "  if (l.x_status === \"auto\") return round2(Number(l.x_market_price) || 0);", "  if (l.x_status === \"auto\") return round2(Number((l as any).x_cost_price) || 0);"]], T],
  ["ج", "the display margin ÷ the market price", [[EN,
    "  return purchase > 0 && market > 0 ? round2(((market - purchase) / purchase) * 100) : 0;", "  return purchase > 0 && market > 0 ? round2(((market - purchase) / market) * 100) : 0;"]], T],
  ["ج", "Baraa's tap not wired in /webhook", [["src/index.ts",
    "/^pexc_[mse]_\\d+$/.test(msg.buttonId ?? \"\")", "false"]], T],
  ["ج", "his «عدّل» reply not wired in /webhook", [["src/index.ts",
    "          const r = await handlePriceEditReply(env, msg.text).catch((e) => {", "          const r = await Promise.resolve(null).catch((e) => { void handlePriceEditReply;"]], T],
  // ---------------------------------------------------------------- د the tiers and the minimum
  ["د", "a tier's «إلى» exclusive (1,000 → no tier)", [[OP,
    "(t.to === null || a <= t.to + 0.0001)", "(t.to === null || a < t.to)"]], T],
  ["د", "an inactive tier used", [[OP,
    "    domain: [[\"x_config_id\", \"=\", configId], [\"x_active\", \"=\", true]],", "    domain: [[\"x_config_id\", \"=\", configId]],"]], T],
  ["د", "the discount on the VAT-inclusive total", [[OP,
    // § 41: the split is computed once (split.subtotal)
    "  const base = rate ? split.subtotal : gross;", "  const base = gross;"]], T],
  ["د", "no guard (profit after the discount unchecked)", [[OP,
    "  if (after < minProfit) {", "  if (false) {"]], T],
  ["د", "planned stops empty → a discount anyway", [[OP,
    "  if (settings.plannedStops === null) return { ...out, reason: \"«عدد المحطات اليومية المخطط» فارغ\" };\n", ""]], T],
  ["د", "a line without the day's purchase price counted at 0", [[OP,
    // § 41: the cost row carries the winning source too ({ price, source })
    "    if (!(c && c.price > 0)) return null;", "    if (!(c && c.price > 0)) continue;"]], T],
  ["د", "the waste left out of the order's profit", [[OP,
    // § 41: the per-line profit is vatProfit (the waste inside it)
    "    profit += vatProfit(l.unit, c.price, wastePct, vat.ratePct, vat.registered(c.source)) * l.qty;", "    profit += vatProfit(l.unit, c.price, 0, vat.ratePct, vat.registered(c.source)) * l.qty;"]], T],
  ["د", "the day's cost unreadable → a discount anyway", [[OP,
    "  if (cost.total === null) return { ...out, profitBefore: profit, reason: `تكلفة اليوم لا تُقرأ (${cost.reason ?? \"—\"})` };\n", ""]], T],
  ["د", "ACCOUNTING_SYNC on → a discount anyway", [[OP,
    "  if (isAccountingSyncEnabled(env)) return { ...out, reason: \"الخصم غير مربوط بأمر البيع بعد (ACCOUNTING_SYNC)\" };\n", ""]], T],
  ["د", "the VAT on the net before the discount", [[OP,
    "  const tax = ratePct ? round2((net * ratePct) / 100) : 0;", "  const tax = ratePct ? round2((split.subtotal * ratePct) / 100) : 0;"]], T],
  ["د", "the invoice ignores the discount", [["src/invoice.ts",
    "    if (d.applied) { discount = d.amount; discountPct = d.pct; }", "    if (false) { discount = d.amount; discountPct = d.pct; }"]], T],
  ["د", "the invoice record without x_discount", [["src/odoo.ts",
    "      ...((vals.discount ?? 0) > 0 ? { x_discount: vals.discount, x_discount_pct: vals.discountPct ?? 0 } : {}),", ""]], T],
  ["د", "the invoice PDF without the discount line", [["src/invoice.ts",
    "    discount: invoiceDiscount(invoice),", "    discount: 0,"]], T],
  ["د", "the customer's invoice text without the discount", [["src/invoice.ts",
    "  const discountLine = discount > 0 ? [`خصم الكمية: ${discount} ر.س`] : [];", "  const discountLine: string[] = [];"]], T],
  ["د", "the quotation without the discount", [["src/quotation.ts",
    "      if (d.applied) {\n        const { computeInclusiveTotals } = await import(\"./accounting\");", "      if (false) {\n        const { computeInclusiveTotals } = await import(\"./accounting\");"]], T],
  ["د", "no minimum at all", [[OP,
    "  return { total, min, below: unpriced === 0 && order.lines.length > 0 && total < min, unpriced };", "  return { total, min, below: false, unpriced };"]], T],
  ["د", "the minimum itself refused (≤ instead of <)", [[OP,
    "order.lines.length > 0 && total < min, unpriced };", "order.lines.length > 0 && total <= min, unpriced };"]], T],
  ["د", "the quotation request ignores the minimum", [["src/router.ts",
    "  if (minimum?.below) return { text: belowMinimumText(minimum) };\n", ""]], T],
  ["د", "the inline «خلاص» ignores the minimum", [["src/router.ts",
    "    if (minimum?.below) {\n      return {\n        text: [(created", "    if (false) {\n      return {\n        text: [(created"]], T],
  ["د", "«تأكيد الطلب» confirms below the minimum", [["src/router.ts",
    "    if (minimum?.below) {\n      if (o.state === \"waiting_confirmation\") await updateOrderState(env, orderId, \"draft\");", "    if (false) {\n      if (o.state === \"waiting_confirmation\") await updateOrderState(env, orderId, \"draft\");"]], T],
  ["د", "a refused confirmation leaves the order waiting (not open)", [["src/router.ts",
    "      if (o.state === \"waiting_confirmation\") await updateOrderState(env, orderId, \"draft\");\n", ""]], T],
  ["د", "ح3's reminder offers the button below the minimum", [["src/team.ts",
    "      if (minimum?.below) {\n        const why", "      if (false) {\n        const why"]], T],
  ["د", "the reply to ح3's template offers the button below the minimum", [["src/index.ts",
    "          if (minimum?.below) {\n            await sendText(env, msg.from, `طلبك رقم", "          if (false) {\n            await sendText(env, msg.from, `طلبك رقم"]], T],
  // § 41 ب (2026-09-26): the three mutations of the daily «المحطات فارغ» alert
  // («the stops alert although they are filled», «… every tick», «… not in the
  // prices tick») were deleted with the alert itself (checkPlannedStops); its
  // absence is tested and mutated in tests/s41.test.mts / s41 mutations [ب].
  // ---------------------------------------------------------------- هـ the coverage line
  ["هـ", "the invoices' discount not taken off the profit", [[SM,
    // § 41: the discount per invoice (VAT-inclusive from the cutoff)
    "    if (!(d > 0)) continue;\n    // with VAT", "    if (true) continue;\n    // with VAT"]], T],
  ["هـ", "a line short at delivery counted in the profit", [[SM,
    "    if (String(l.x_status) === \"unavailable\") continue; // short at delivery: not sold\n", ""]], T],
  ["هـ", "the waste left out of the day's profit", [[SM,
    // § 41: the per-line profit is vatProfit (the waste inside it)
    "    profit += vatProfit(sale, buy.price, waste, vatRatePct, registered(buy.source)) * qty;", "    profit += vatProfit(sale, buy.price, 0, vatRatePct, registered(buy.source)) * qty;"]], T],
  ["هـ", "a simulation order counted", [[SM,
    "    domain: [[\"x_order_date\", \"=\", day], [\"x_state\", \"in\", states], [SIM_FIELD, \"!=\", true]],", "    domain: [[\"x_order_date\", \"=\", day], [\"x_state\", \"in\", states]],"]], T],
  ["هـ", "today's orders instead of today's deliveries", [[SM,
    // § 41: with the VAT rate of the summary day
    "  const profit = await attempt(\"coverage_profit\", () => deliveredProfit(env, yesterday, profitVatRate(day)));", "  const profit = await attempt(\"coverage_profit\", () => deliveredProfit(env, day, profitVatRate(day)));"]], T],
  ["هـ", "a line without its day's purchase price counted at 0", [[SM,
    // § 41: the cost row carries the winning source too ({ price, source })
    "    if (!(buy && buy.price > 0)) throw new Error(\"a delivered line without its day's purchase price\");\n", "    if (!buy) continue;\n"]], T],
  ["هـ", "a line without a sale price counted at 0", [[SM,
    "    if (!(sale > 0)) throw new Error(\"a delivered line without a sale price\");\n", ""]], T],
  ["هـ", "the purchase price of any day, not the order's", [[SM,
    "    domain: [[\"x_day_id.x_date\", \"=\", orderDay], [\"x_cost_price\", \">\", 0]],", "    domain: [[\"x_cost_price\", \">\", 0]],"]], T],
  ["هـ", "yesterday's operating cost, not today's", [[SM,
    "(await dailyOperatingCost(env, day, nowMs)).total", "(await dailyOperatingCost(env, yesterday, nowMs)).total"]], T],
  ["هـ", "a coverage over a zero cost", [[SM,
    "pct: profit !== null && cost !== null && cost > 0 ? Math.round((profit / cost) * 100) : null", "pct: profit !== null && cost !== null ? Math.round((profit / cost) * 100) : null"]], T],
  ["هـ", "no fourth line in the text", [[SM,
    "    coverageLine(f.coverage),\n", ""]], T],
  ["هـ", "the template without the coverage", [[SM,
    "  return [p1, p2, `${p3} · ${coverageShort(f.coverage)}`];", "  return [p1, p2, p3];"]], T],
  ["هـ", "the coverage on its own line inside {{3}}", [[SM,
    "  return [p1, p2, `${p3} · ${coverageShort(f.coverage)}`];", "  return [p1, p2, `${p3}\\n${coverageShort(f.coverage)}`];"]], T],
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
writeFileSync(new URL("./artifacts/s40-20260926-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
