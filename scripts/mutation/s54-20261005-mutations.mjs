// Mutation check for § 54 (2026-10-05) — the day's prices reviewed by Baraa in one message: each
// mutation disables ONE guard, runs tests/s54.test.mts, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s54-20261005-mutations.mjs [أ|ب|ج|د|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s54-20261005-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s54.test.mts";
const PE = "src/pricing-engine.ts";
const PR = "src/prices.ts";
const RV = "src/price-review.ts";
const OC = "src/operating-cost.ts";
const IX = "src/index.ts";
const GW = "src/wa-gateway.ts";
// § 55 — the Flow the worker sends is utak_owner_review_v2: the Flow's guards are checked on its JSON (v1's is frozen at Meta and no longer sent)
const LIB = "scripts/lib/s55-flows.mjs";
const ODOO = "scripts/lib/s54-odoo.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the rule
  ["أ", "rule 1 off: a line without a purchase price is proposed for publication", [[PE,
    "  if (i.purchase === null || !(i.purchase > 0)) return skip(\"no_purchase\");", "  if (false) return skip(\"no_purchase\");"]], T],
  ["أ", "rule 3: a line without a market price is published by itself at the suggested price", [[PE,
    "{ kind: \"profit\", price: suggested, why: \"no_market\", outlier, auto: false }", "{ kind: \"profit\", price: suggested, why: \"no_market\", outlier, auto: !outlier }"]], T],
  ["أ", "rule 3 off: a line without a market price is «لا تنشر»", [[PE,
    "return suggested > 0 ? { kind: \"profit\", price: suggested, why: \"no_market\", outlier, auto: false } : skip(\"no_price\");", "return skip(\"no_price\");"]], T],
  ["أ", "rule 4 by § 47's threshold: a loss = below the SUGGESTED price", [[PE,
    "? sale < i.breakEven - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");", "? sale < suggested - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");"]], T],
  ["أ", "rule 4 off: a market price below «بدون خسارة» is published", [[PE,
    "? sale < i.breakEven - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");", "? false : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");"]], T],
  ["أ", "rule 4: «بدون خسارة» itself is a loss (≤ in place of <)", [[PE,
    "? sale < i.breakEven - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");", "? sale < i.breakEven + 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");"]], T],
  ["أ", "no carton share: a unit profit that is not above zero is published", [[PE,
    "? sale < i.breakEven - 0.0001 : i.unitProfit !== null && i.unitProfit <= 0) return skip(\"loss\");", "? sale < i.breakEven - 0.0001 : false) return skip(\"loss\");"]], T],
  ["أ", "rule 6: the setting «بالمقترح» is not read (always the market price)", [[PE,
    "    return above === \"suggested\" ? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: !outlier }", "    return false ? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: !outlier }"]], T],
  ["أ", "rule 6: the default is «بالمقترح»", [[PE,
    "    return above === \"suggested\" ? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: !outlier }", "    return above !== \"suggested\" ? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: !outlier }"]], T],
  ["أ", "rule 6: a market price equal to the suggested one is not «أعلى من المقترح»", [[PE,
    "  if (suggested > 0 && sale >= suggested - 0.0001) {", "  if (suggested > 0 && sale > suggested + 0.0001) {"]], T],
  ["أ", "rule 6 swallows rule 5: the setting decides below the suggested price too", [[PE,
    "  if (suggested > 0 && sale >= suggested - 0.0001) {", "  if (suggested > 0) {"]], T],
  ["أ", "rule 2: an outlier between «بدون خسارة» and the suggested price is published by itself", [[PE,
    "  return { kind: \"market\", price: sale, why: \"below_suggested\", outlier, auto: !outlier };", "  return { kind: \"market\", price: sale, why: \"below_suggested\", outlier, auto: true };"]], T],
  ["أ", "rule 2: an outlier above the suggested price is published by itself («بسعر السوق»)", [[PE,
    "      : { kind: \"market\", price: sale, why: \"above_suggested\", outlier, auto: !outlier };", "      : { kind: \"market\", price: sale, why: \"above_suggested\", outlier, auto: true };"]], T],
  ["أ", "rule 2: an outlier above the suggested price is published by itself («بالمقترح»)", [[PE,
    "? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: !outlier }", "? { kind: \"profit\", price: suggested, why: \"above_suggested\", outlier, auto: true }"]], T],
  ["أ", "rule 2: the ⚠️ mark is lost", [[PE,
    "  const outlier = i.outlier === true;\n  const skip", "  const outlier = false;\n  const skip"]], T],
  ["أ", "any value of the setting is «بالمقترح»", [[PE,
    "  return v === \"suggested\" ? \"suggested\" : ABOVE_SUGGESTED_DEFAULT;", "  return v ? \"suggested\" : ABOVE_SUGGESTED_DEFAULT;"]], T],
  ["أ", "the engine does not pass the setting to the rule", [[PE,
    "unitProfit: profit, outlier: outlier.purchase || outlier.market }, above);", "unitProfit: profit, outlier: outlier.purchase || outlier.market });"]], T],
  ["أ", "the engine does not pass the outlier to the rule (an outlier line is automatic)", [[PE,
    "unitProfit: profit, outlier: outlier.purchase || outlier.market }, above);", "unitProfit: profit, outlier: false }, above);"]], T],
  ["أ", "the engine's rule compares the market price BEFORE the uplift", [[PE,
    "const proposal = proposeDecision({ purchase, sale, breakEven, suggested,", "const proposal = proposeDecision({ purchase, sale: market, breakEven, suggested,"]], T],
  ["أ", "a loss leaves no reason on the line", [[PE,
    "      if (breakEven !== null) { if (sale < breakEven - 0.0001) exceptions.push(\"loss\"); }", "      if (breakEven !== null) { /* no loss */ }"]], T],
  ["أ", "the reason of a loss names the suggested price, not «بدون خسارة»", [[PE,
    "أقل من سعر بدون خسارة ${money(breakEven as number)}`", "أقل من سعر بدون خسارة ${money(suggested as number)}`"]], T],
  ["أ", "a line the rule does not publish by itself is «تلقائي»", [[PE,
    "  if (!p.proposal.auto) return { status: \"exception\", sale: 0, excluded: true, reason: p.reason };", "  if (false) return { status: \"exception\", sale: 0, excluded: true, reason: p.reason };"]], T],
  ["أ", "an automatic line always sells at the market price («بالمقترح» ignored by the verdict)", [[PE,
    "  return { status: \"auto\", sale: round2(p.proposal.price), excluded: false,", "  return { status: \"auto\", sale: round2(p.sale as number), excluded: false,"]], T],
  ["أ", "an automatic line sold at the suggested price does not say why", [[PE,
    "reason: cheaper ? aboveSuggestedReason(p.sale as number, p.proposal.price) : \"\" };", "reason: \"\" };"]], T],
  ["أ", "the publication's check: any line may sell at its suggested price", [[PE,
    "  if (l.x_status !== \"auto\") return false;\n  const suggested = round2(", "  const suggested = round2("]], T],
  ["أ", "the publication's check: an automatic line may sell at the suggested price below the market too", [[PE,
    "  return suggested > 0 && marketSale(l) >= suggested - 0.0001 && Math.abs(sale - suggested) <= 0.005;", "  return suggested > 0 && Math.abs(sale - suggested) <= 0.005;"]], T],
  ["أ", "the publication's check refuses an automatic line at the suggested price", [[PE,
    "  return suggested > 0 && marketSale(l) >= suggested - 0.0001 && Math.abs(sale - suggested) <= 0.005;", "  return false;"]], T],
  ["أ", "the publication checks with § 53's rule alone (the market price)", [[PR,
    "    const mismatch = publishable.filter((l) => !saleMatchesRule(l));", "    const mismatch = publishable.filter((l) => Math.abs(Number(l.x_sale_price) - saleRule(l)) > 0.005);"]], T],
  ["أ", "the day's engine run does not read the setting", [[PR,
    "settings.marketUpliftPct, settings.aboveSuggested);", "settings.marketUpliftPct);"]], T],
  ["أ", "a change of the setting does not recompute the day (not in the fingerprint)", [[PR,
    "settings.marketUpliftPct, settings.aboveSuggested, vat.ratePct,", "settings.marketUpliftPct, vat.ratePct,"]], T],
  ["أ", "the settings do not carry the new field", [[OC,
    "    aboveSuggested: aboveSuggestedOf(r.x_above_suggested),", "    aboveSuggested: aboveSuggestedOf(undefined),"]], T],
  ["أ", "Odoo: the field's values are not the ones the worker reads", [[ODOO,
    "export const ABOVE_OPTIONS = [[\"market\", \"بسعر السوق\"], [\"suggested\", \"بالمقترح\"]];", "export const ABOVE_OPTIONS = [[\"market\", \"بسعر السوق\"], [\"profit\", \"بالمقترح\"]];"]], T],
  ["أ", "Odoo: the default of the setting is «بالمقترح»", [[ODOO,
    "export const ABOVE_DEFAULT = \"market\";", "export const ABOVE_DEFAULT = \"suggested\";"]], T],
  ["أ", "Odoo: the setting goes in the form a second time on a second run", [[ODOO,
    "  if (arch.includes(ABOVE_MARK)) return arch;", "  if (false) return arch;"]], T],
  ["أ", "Odoo: a settings form without «زيادة على سعر السوق ٪» is written anyway", [[ODOO,
    "  if (!UPLIFT_53.test(arch)) throw new Error(", "  if (false) throw new Error("]], T],

  ["أ", "Odoo: a screen whose rule's sentence was changed by hand is written anyway", [[ODOO,
    "  if (arch.split(was).length !== 2) throw new Error(", "  if (false) throw new Error("]], T],
  ["أ", "Odoo: the rule's sentence is written a second time on a second run", [[ODOO,
    "  if (arch.includes(now)) return arch;\n  if (arch.split(was)", "  if (arch.split(was)"]], T],

  // ---------------------------------------------------------------- ب the one message
  ["ب", "the review goes before 04:00", [[RV,
    "  if (m < exceptionsFromMinutes(env)) return { action: \"outside\" };", "  if (false) return { action: \"outside\" };"]], T],
  ["ب", "a day that is not a draft is reviewed before 06:00", [[RV,
    "  if (!late && rec.x_state !== \"draft\") return { action: \"no_draft\" };", ""]], T],
  ["ب", "the 06:00 tick drops the review owed on a day still «مسودة» (the deadline has not decided it yet)", [[RV,
    "    if (rec.x_state !== \"draft\") await settle();\n    return { action: \"outside\" };", "    await settle();\n    return { action: \"outside\" };"]], T],
  ["ب", "a day published at 06:00 keeps its review owed", [[RV,
    "    if (rec.x_state !== \"draft\") await settle();\n    return { action: \"outside\" };", "    return { action: \"outside\" };"]], T],
  ["ب", "after 06:00 the review is sent on a day that is not «فات الموعد»", [[RV,
    "  if (late && rec.x_state !== \"missed\") {", "  if (false) {"]], T],
  ["ب", "after 06:00 a review that reached him is sent again when a row changes", [[RV,
    "  if (late && !(await owed())) return { action: \"outside\" };", "  if (false) return { action: \"outside\" };"]], T],
  ["ب", "a day with every row decided is reported as sent before", [[RV,
    "  if (!waiting.length) { await settle(); return { action: \"decided\" }; }", "  if (false) { await settle(); return { action: \"decided\" }; }"]], T],
  ["ب", "the review is sent again at every tick", [[RV,
    "  if (prev && !changed.length) return { action: \"sent_before\", ver: prev.ver, count: needing };", "  if (false) return { action: \"sent_before\", ver: prev.ver, count: needing };"]], T],
  ["ب", "a changed row sends no new review", [[RV,
    "  const changed = waiting.filter((r) => !known.has(rowSig(r)));", "  const changed = waiting.filter(() => false);"]], T],
  ["ب", "the snapshot of what was sent is not kept", [[RV,
    "    await writeSnapshot(env, { v: 1, day, dayId: rec.id, ver, at: now, rows, sigs: waiting.map(rowSig) });\n    await settle();", "    await settle();"]], T],
  ["ب", "an update keeps version 1 (the older buttons still decide)", [[RV,
    "  const ver = (prev?.ver ?? 0) + 1;", "  const ver = 1;"]], T],
  ["ب", "an update is titled as the first review", [[RV,
    "      ...(prev ? { update: { at: hhmm(m), changed: changed.map((r) => r.name) } } : {}),", ""]], T],
  ["ب", "his window closed: the review is sent to the gateway anyway", [[RV,
    "  if (!(await readWindow(env, owner, now)).open) {\n    // nothing is held", "  if (false) {\n    // nothing is held"]], T],
  ["ب", "a review that could not go is not owed (his next message brings nothing)", [[RV,
    "    try { await env.MSG_DEDUP.put(owedKey(day), \"1\", { expirationTtl: DAY_TTL }); } catch { /* the next tick marks it */ }", ""]], T],
  ["ب", "the template counts every row, the ones published by themselves too", [[RV,
    "      review = await notifyPriceReview(env, day, needing, now).catch((e) => {", "      review = await notifyPriceReview(env, day, waiting.length, now).catch((e) => {"]], T],
  ["ب", "the template «… قبل 06:00» is sent after 06:00", [[RV,
    "    if (!late && needing > 0) {", "    if (needing > 0) {"]], T],
  ["ب", "the review goes under the cron's auto-send key (an attempt Meta failed is never tried again)", [[RV,
    "  const env = { ...env0, AUTO_SEND_JOB: undefined } as Env;", "  const env = env0;"]], T],
  ["ب", "the review and its answers are held outside his window", [[RV,
    "    noHold: true, noHoldReason: \"مراجعة الأسعار تُرسل داخل نافذة براء فقط\", ctx,", "    ctx,"]], T],
  ["ب", "the review owed is not sent at his message", [[IX,
    "      if (await sendOwedPriceReview(env, Date.now(), ctx)) flushed = { sent: (flushed?.sent ?? 0) + 1 };", ""]], T],
  ["ب", "the review sent at his tap is not counted (he also gets «لا مراجعة أسعار بانتظارك»)", [[IX,
    "      if (await sendOwedPriceReview(env, Date.now(), ctx)) flushed = { sent: (flushed?.sent ?? 0) + 1 };", "      await sendOwedPriceReview(env, Date.now(), ctx);"]], T],
  ["ب", "a late review does not say an approval publishes at once", [[RV,
    "    o.late ? `فات موعد ${clockAr(deadlineMin)} وما انتشرت أسعار اليوم", "    false ? `فات موعد ${clockAr(deadlineMin)} وما انتشرت أسعار اليوم"]], T],
  // the text
  ["ب", "the whole review always goes above the buttons (cut at 1024)", [[RV,
    "  if (whole.length <= bodyMax) return { texts: [], body: whole };", "  if (true) return { texts: [], body: whole };"]], T],
  ["ب", "the table always goes as a separate text", [[RV,
    "  if (whole.length <= bodyMax) return { texts: [], body: whole };", "  if (false) return { texts: [], body: whole };"]], T],
  ["ب", "a long table is one text, whatever its length", [[RV,
    "    if (size + line.length + 1 > room && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }", ""]], T],
  ["ب", "the buttons after a separate table carry no summary", [[RV,
    "    body: [title, `${rows.length} ${itemsWord(rows.length)} في الجدول أعلاه.`, ...choiceLines(rows, deadlineMin, { late: o.late, compact: true })].join(\"\\n\").slice(0, bodyMax),", "    body: title,"]], T],
  ["ب", "one category gets a heading line too", [[RV,
    "...(groups.length > 1 ? [...(i ? [\"\"] : []), `— ${g.title} —`] : [])", "...(true ? [...(i ? [\"\"] : []), `— ${g.title} —`] : [])"]], T],
  ["ب", "several categories get no heading line", [[RV,
    "...(groups.length > 1 ? [...(i ? [\"\"] : []), `— ${g.title} —`] : [])", "...(false ? [...(i ? [\"\"] : []), `— ${g.title} —`] : [])"]], T],
  // § 55 — «the percentage is of the market price, not of the purchase»: «الفرق» and its percentage left the message (§ 55 أ); «ربحنا» is guarded in s55-20261005-mutations.mjs.
  // § 55 — «the difference is from the price after the uplift»: «الفرق» left the message (§ 55 أ).
  // § 55 — «a line without a market price shows a difference»: «الفرق» left the message (§ 55 أ).
  // § 55 — «no market price reads «سوق 0»»: the line is § 55's; its guard is in s55-20261005-mutations.mjs under the same name.
  // § 55 — «no purchase price reads «شراء 0»»: the purchase price left the message for the form; its guard is in s55-20261005-mutations.mjs («…in the form»).
  ["ب", "an outlier's line is not marked ⚠️", [[RV,
    "  if (isWarned(r)) return \"⚠️\";", "  if (false) return \"⚠️\";"]], T],
  ["ب", "the decision does not say the price is after the uplift", [[RV,
    "${r.upliftPct > 0 ? ` (بعد الزيادة ${money(r.sale)})` : \"\"}", "${false ? ` (بعد الزيادة ${money(r.sale)})` : \"\"}"]], T],
  // § 55 — «a loss reads «لا تنشر» with no reason»: the line reads «← لا تنشر» by the order's own format (§ 55 أ): the reason is the signed profit beside it.
  ["ب", "a row Baraa decided shows the proposed decision", [[RV,
    "  return `${o.byOwner ? \"قرارك: \" : \"\"}${o.kind === \"skip\"", "  return `${false ? \"قرارك: \" : \"\"}${o.kind === \"skip\""]], T],
  ["ب", "the summary counts no ⚠️", [[RV,
    "warn: rows.filter(isWarned).length,", "warn: 0,"]], T],
  ["ب", "the summary counts every row as published by itself", [[RV,
    "export const publishesAsIs = (r: ReviewRow): boolean => (r.decision ? rowOutcome(r).kind !== \"skip\" : r.proposal.auto);", "export const publishesAsIs = (r: ReviewRow): boolean => (r.decision ? rowOutcome(r).kind !== \"skip\" : r.proposal.kind !== \"skip\");"]], T],
  ["ب", "a line of an item that left the catalog is in the review", [[RV,
    "  const inDay = lines.filter((l) => l.x_reason !== OUT_OF_CATALOG_REASON);\n  const names", "  const inDay = lines;\n  const names"]], T],
  ["ب", "the row's proposal ignores the outlier flag of the stored line", [[RV,
    "unitProfit: purchase > 0 && sale > 0 ? Number(l.x_unit_profit) || 0 : null, outlier: l.x_is_outlier === true,", "unitProfit: purchase > 0 && sale > 0 ? Number(l.x_unit_profit) || 0 : null, outlier: false,"]], T],
  ["ب", "the review reads «بسعر السوق» whatever the settings say", [[RV,
    "    return (await readPricingSettings(env, day))?.aboveSuggested ?? \"market\";", "    return \"market\";"]], T],
  ["ب", "the second button does not open the form (a fourth title)", [[RV,
    "export const REVIEW_BUTTON_FORM = \"✏️ عدّل\";", "export const REVIEW_BUTTON_FORM = \"✏️ عدّل الأسعار واحداً واحداً\";"]], T],
  // gone: the message per exception
  ["ب", "a tap on an old exception's choice is not answered", [[IX,
    "          await sendText(env, msg.from, OLD_EXCEPTION_TEXT, { ctx, purpose: \"owner_alert\" });", ""]], T],
  ["ب", "the webhook does not know the review's buttons", [[IX,
    "/^prvt?_[arn]_\\d+_\\d+$/.test(msg.buttonId ?? \"\")) {", "/^prvX_[arn]_\\d+_\\d+$/.test(msg.buttonId ?? \"\")) {"]], T],
  // the buttons
  ["ب", "the buttons of an older review still decide", [[RV,
    "  if (snap.ver !== ver) { await tell(STALE_TEXT(riyadhClock(snap.at))); return \"stale\"; }", ""]], T],
  ["ب", "a second tap decides again", [[RV,
    "  if (!claim.claimed) { await tell(\"سُجّل قرارك من هذه الرسالة مسبقاً ✅\"); return \"duplicate\"; }", ""]], T],
  ["ب", "«اعتمد الكل» overwrites a decision Baraa took in Odoo", [[RV,
    "      : snap.rows.filter((r) => !lines.get(r.lineId)?.x_decision).map(", "      : snap.rows.map("]], T],
  ["ب", "«لا تنشر اليوم» leaves out the rows proposed for publication", [[RV,
    "      ? snap.rows.map((r) => ({ lineId: r.lineId, kind: \"skip\" as const, price: 0 }))", "      ? snap.rows.filter((r) => r.proposal.kind === \"skip\").map((r) => ({ lineId: r.lineId, kind: \"skip\" as const, price: 0 }))"]], T],
  ["ب", "a button of another day's review decides", [[RV,
    "  if (day.x_date !== riyadhDateKey(new Date(now))) return {", "  if (false) return {"]], T],
  ["ب", "a published day takes a decision", [[RV,
    "  if (day.x_state === \"published\") return {", "  if (false) return {"]], T],
  ["ب", "a day being published takes a decision", [[RV,
    "  if (day.x_state === \"approved\") return {", "  if (false) return {"]], T],
  ["ب", "an item that left the catalog takes a decision", [[RV,
    "    if (!l || l.x_reason === OUT_OF_CATALOG_REASON || sameDecision(l, e.kind, e.price)) continue;", "    if (!l || sameDecision(l, e.kind, e.price)) continue;"]], T],
  ["ب", "a decision the line already carries is written again", [[RV,
    "    if (!l || l.x_reason === OUT_OF_CATALOG_REASON || sameDecision(l, e.kind, e.price)) continue;", "    if (!l || l.x_reason === OUT_OF_CATALOG_REASON) continue;"]], T],
  ["ب", "a decision does not fix its price for itself (x_manual_for)", [[RV,
    "  return { x_decision: kind, x_manual_price: price, x_manual_for: kind, x_status: \"manual\",", "  return { x_decision: kind, x_manual_price: price, x_status: \"manual\","]], T],
  ["ب", "a decision carries no time", [[RV,
    "x_reason: DECISION_REASON[kind], x_sale_price: price, x_excluded: false, x_decided_at: nowOdoo(now) };", "x_reason: DECISION_REASON[kind], x_sale_price: price, x_excluded: false };"]], T],
  ["ب", "«لا تنشر» leaves the line in the publication", [[RV,
    "x_reason: DECISION_REASON.skip, x_sale_price: 0, x_excluded: true, x_decided_at: nowOdoo(now) };", "x_reason: DECISION_REASON.skip, x_sale_price: 0, x_excluded: false, x_decided_at: nowOdoo(now) };"]], T],
  ["ب", "the confirmation does not name what is not published", [[RV,
    "    stay.length ? `لا يُنشر: ${stay.map((r) => `${r.name}${r.decision ? \"\" : \" (بلا قرار)\"}`).join(\"، \")}.` : \"\",", ""]], T],
  ["ب", "the confirmation carries no «✏️ تعديل»", [[RV,
    "  const again = late === \"published\" ? null : [{ id: `prv_r_${day.id}_0`, title: REVIEW_BUTTON_EDIT }];", "  const again = null as Array<{ id: string; title: string }> | null;"]], T],
  ["ب", "the confirmation of a published day still offers «✏️ تعديل»", [[RV,
    "  const again = late === \"published\" ? null : [{ id: `prv_r_${day.id}_0`, title: REVIEW_BUTTON_EDIT }];", "  const again = [{ id: `prv_r_${day.id}_0`, title: REVIEW_BUTTON_EDIT }];"]], T],

  // ---------------------------------------------------------------- ج the form
  ["ج", "the Flow: a list does not open on a decision", [[LIB,
    "\"data-source\": rref(k, `o${n}`), \"init-value\": rref(k, `s${n}`), visible:", "\"data-source\": rref(k, `o${n}`), visible:"]], T],
  ["ج", "the Flow: the list may be emptied", [[LIB,
    "label: rref(k, `l${n}`), required: rref(k, `v${n}`),", "label: rref(k, `l${n}`), required: false,"]], T],
  ["ج", "the Flow: thirteen items a page (more than fifty components)", [[LIB,
    "export const REVIEW_PAGE_SLOTS = 10;", "export const REVIEW_PAGE_SLOTS = 13;"]], T],
  ["ج", "the Flow: «السعر اليدوي» is a text field", [[LIB,
    "label: REVIEW_MANUAL_LABEL, \"input-type\": \"number\", required: false,", "label: REVIEW_MANUAL_LABEL, \"input-type\": \"text\", required: false,"]], T],
  ["ج", "the Flow: «اعتمد» does not carry the manual prices", [[LIB,
    "upTo.flatMap((n) => [[`d${n}`, rformRef(k, \"d\", n)], [`p${n}`, rformRef(k, \"p\", n)]])", "upTo.flatMap((n) => [[`d${n}`, rformRef(k, \"d\", n)]])"]], T],
  ["ج", "the worker sends the form to another screen", [[RV,
    "export const REVIEW_FLOW_SCREEN = \"REVIEW_A\";", "export const REVIEW_FLOW_SCREEN = \"REVIEW_B\";"]], T],
  ["ج", "«انشر بسعر السوق» is offered without a market price", [[RV,
    "    ...(r.sale > 0 ? [{ id: \"market\",", "    ...(true ? [{ id: \"market\","]], T],
  ["ج", "«انشر بالمقترح» is offered without a suggested price", [[RV,
    "    ...(r.suggested > 0 ? [{ id: \"profit\",", "    ...(true ? [{ id: \"profit\","]], T],
  ["ج", "the options do not show their prices", [[RV,
    "title: pricedOption(r, \"بسعر السوق\", r.sale) }]", "title: \"بسعر السوق\" }]"]], T],
  ["ج", "the list opens on the proposed decision, not on Baraa's own", [[RV,
    "  const want = o.kind === \"edit\" ? \"manual\" : o.kind;", "  const want = r.proposal.kind;"]], T],
  ["ج", "«السعر اليدوي» does not open with the price he typed", [[RV,
    "    manual: o.kind === \"edit\" && o.price > 0 ? money(o.price) : \"\",", "    manual: \"\","]], T],
  ["ج", "a long name is not cut to Meta's twenty characters", [[RV,
    "label: cut(r.name, REVIEW_LABEL_MAX), info: reviewInfo(r),", "label: r.name, info: reviewInfo(r),"]], T],
  // § 55 — «the item's numbers do not carry «بدون خسارة»»: the form's two lines are § 55's («ربحنا» and where our price stands); «بدون خسارة» stays on the line in Odoo and in the ⚠️ of a manual price below it.
  ["ج", "the sixteenth item of a category is dropped (no second page)", [[RV,
    "    for (let i = 0; i < g.rows.length; i += REVIEW_FLOW_PAGE_SLOTS) {", "    for (let i = 0; i < 1; i += REVIEW_FLOW_PAGE_SLOTS) {"]], T],
  ["ج", "a fifth page is filled (slots the Flow does not have)", [[RV,
    "  const used = pages.slice(0, REVIEW_FLOW_PAGES);", "  const used = pages;"]], T],
  ["ج", "«التالي» on the last page that has items", [[RV,
    "    if (k < REVIEW_FLOW_PAGES) data[`m${k}`] = k < pages.length;", "    if (k < REVIEW_FLOW_PAGES) data[`m${k}`] = k <= pages.length;"]], T],
  ["ج", "a hidden slot has no option (an empty list at Meta)", [[RV,
    "    data[`o${n}`] = it ? it.options : [{ id: \"skip\", title: \"-\" }];", "    data[`o${n}`] = it ? it.options : [];"]], T],
  ["ج", "an empty slot is shown", [[RV,
    "    data[`v${n}`] = !!it;", "    data[`v${n}`] = true;"]], T],
  ["ج", "the form is not kept by its token", [[RV,
    "  await env.MSG_DEDUP.put(reviewFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });", ""]], T],
  ["ج", "the webhook reads the review's reply as a price form", [[IX,
    "        if (isReviewFormToken(msg.flow.token ?? \"\")) {", "        if (false) {"]], T],
  ["ج", "any choice the client sends is taken (an option the item was not offered)", [[RV,
    "    const choice = item.options.some((o) => o.id === raw) ? raw : item.selected;", "    const choice = raw || item.selected;"]], T],
  ["ج", "a list that came back empty is «لا تنشر»", [[RV,
    "    const choice = item.options.some((o) => o.id === raw) ? raw : item.selected;", "    const choice = item.options.some((o) => o.id === raw) ? raw : \"skip\";"]], T],
  ["ج", "«السعر اليدوي» is read whatever the choice", [[RV,
    "    if (choice === \"manual\") {\n      const price", "    if (choice === \"manual\" || String(values[`p${item.slot}`] ?? \"\") !== \"\") {\n      const price"]], T],
  ["ج", "«سعر يدوي» without a price is «لا تنشر»", [[RV,
    "      else out.noPrice.push(item);", "      else out.decisions.push({ item, lineId: item.lineId, kind: \"skip\", price: 0 });"]], T],
  ["ج", "«انشر بالمقترح» from the form publishes at the market price", [[RV,
    "    } else if (choice === \"profit\") out.decisions.push({ item, lineId: item.lineId, kind: \"profit\", price: item.suggested });", "    } else if (choice === \"profit\") out.decisions.push({ item, lineId: item.lineId, kind: \"profit\", price: item.sale });"]], T],
  ["ج", "a reply from another number with his token is read", [[RV,
    "  if (!rec || rec.to !== from || from !== ownerOf(env)) {", "  if (!rec) {"]], T],
  ["ج", "a token is read twice", [[RV,
    "  if (!claim.claimed) { await tell(REVIEW_FORM_USED_TEXT); return { action: \"duplicate\" }; }", ""]], T],
  ["ج", "a manual price below «بدون خسارة» gets no ⚠️ line", [[RV,
    "    ...below.map((r) => `⚠️ ${r.name}: السعر اليدوي ${money(r.decidedPrice)} أقل من سعر بدون خسارة ${money(r.breakEven)}.`),", ""]], T],
  ["ج", "every manual price gets the ⚠️ line", [[RV,
    "r.decision === \"edit\" && r.breakEven > 0 && r.decidedPrice > 0 && r.decidedPrice < r.breakEven - 0.0001);", "r.decision === \"edit\" && r.breakEven > 0 && r.decidedPrice > 0);"]], T],
  ["ج", "«سعر يدوي» without a price is not reported", [[RV,
    "    await confirmDecisions(env, { day: d.day, late: d.late }, now, noPriceNote(entries.noPrice), ctx);", "    await confirmDecisions(env, { day: d.day, late: d.late }, now, [], ctx);"]], T],
  // after 06:00
  ["ج", "an approval after 06:00 waits (no publication)", [[RV,
    "  return { day, late: riyadhMinutes(new Date(now)) >= pricesDeadlineMinutes(env).minutes };", "  return { day, late: false };"]], T],
  ["ج", "an approval before 06:00 publishes at once", [[RV,
    "  return { day, late: riyadhMinutes(new Date(now)) >= pricesDeadlineMinutes(env).minutes };", "  return { day, late: true };"]], T],
  ["ج", "a late approval with nothing approved still approves the day", [[RV,
    "  if (!(await readLines(env, day.id)).some(isPublishable)) return \"nothing\";", ""]], T],
  ["ج", "a late approval approves the day and does not publish it", [[RV,
    "  const r = await publishPriceDay(env, day.id, { ctx, now, approvedVia: \"اعتماد براء من واتساب بعد الموعد\" });", "  const r = { action: \"published\" };"]], T],
  ["ج", "the late publication's report does not name the approval from WhatsApp", [[RV,
    "{ ctx, now, approvedVia: \"اعتماد براء من واتساب بعد الموعد\" });", "{ ctx, now });"]], T],
  ["ج", "the confirmation of a late publication reads «سيُنشر 06:00»", [[RV,
    "  const lead = o.late === \"published\" ? `نُشر الآن (بعد موعد ${o.deadline}، بمسار «نشر المعتمد الآن»):`\n", "  const lead = false ? `نُشر الآن (بعد موعد ${o.deadline}، بمسار «نشر المعتمد الآن»):`\n"]], T],

  // ---------------------------------------------------------------- د no decision until 06:00
  ["د", "the 06:00 message does not name what was not published", [[PR,
    "      left.length ? `لم يُنشر (${left.length}): ${unpublishedList(left)}.` : \"\",", "      \"\","]], T],
  ["د", "the reasons: his «لا تنشر» reads as a missing price", [[PR,
    "  if (l.x_decision === \"skip\") return \"قرارك: لا تنشر\";", ""]], T],
  ["د", "the reasons: no purchase price is not named", [[PR,
    "  if (!(Number(l.x_cost_price) > 0)) return \"لا سعر شراء\";", ""]], T],
  ["د", "the reasons: no market price is not named", [[PR,
    "  if (!(sale > 0)) return \"بلا سعر سوق وبلا قرار\";", ""]], T],
  ["د", "the reasons: a loss is not named", [[PR,
    "  if (floor > 0 && sale < floor - 0.0001) return `خسارة: السوق ${money(sale)} أقل من ${money(floor)}، وبلا قرار`;", ""]], T],
  ["د", "the reasons: an outlier is not named", [[PR,
    "  if (l.x_is_outlier) return \"سعر شاذ وبلا قرار\";", ""]], T],
  ["د", "a long list of unpublished items is named whole (past a text message's room)", [[PR,
    "  const named = lines.slice(0, UNPUBLISHED_NAMED_MAX).map(", "  const named = lines.map("]], T],
  ["د", "the unpublished items past the twentieth are not counted", [[PR,
    "  return more > 0 ? `${named}، و${more} غيرها (التفاصيل في ${PLACE_TODAY})` : named;", "  return named;"]], T],
  ["د", "a day Baraa closed himself raises the alarm of a missed day", [[PR,
    "  const byOwner = inDay.length > 0 && inDay.every((l) => l.x_decision === \"skip\");", "  const byOwner = false;"]], T],
  ["د", "the missed day's alert does not say why each item stayed out", [[PR,
    "    anyPrice ? `لم يُنشر (${inDay.length}): ${unpublishedList(inDay)}.` : \"لم يصل سعر من المصادر اليوم.\",", "    anyPrice ? `الأصناف: ${inDay.length}.` : \"لم يصل سعر من المصادر اليوم.\","]], T],
  ["د", "the missed day's alert does not say the review's buttons publish at once", [[PR,
    "«✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً، أو قرارك", "قرارك"]], T],

  // ---------------------------------------------------------------- هـ the trial, the gateway
  ["هـ", "the trial's buttons decide for real", [[RV,
    "  if (test) return handleTestButton(env, op, dayId, now, ctx);", ""]], T],
  ["هـ", "the trial's form is written for real", [[RV,
    "  if (rec.test) {\n    await tell(testFormAnswer(rec, entries));\n    return { action: \"test\" };\n  }", ""]], T],
  ["هـ", "a second trial the same day", [[RV,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };", ""]], T],
  ["هـ", "the trial is tried with his window closed", [[RV,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };", ""]], T],
  ["هـ", "the trial shows the decisions already taken on the day", [[RV,
    "    const rows = (await dayReviewRows(env, rec)).map((r) => ({ ...r, decision: null, decidedPrice: 0 }));", "    const rows = await dayReviewRows(env, rec);"]], T],
  ["هـ", "the trial is not marked «🧪 تجربة»", [[RV,
    "pricesDeadlineMinutes(env).minutes, { test: true });", "pricesDeadlineMinutes(env).minutes, {});"]], T],
  ["هـ", "the trial's buttons are the real ones", [[RV,
    "buttonsContent(built.body, reviewButtons(rec.id, 1, true)), true))) {", "buttonsContent(built.body, reviewButtons(rec.id, 1, false)), true))) {"]], T],
  ["هـ", "the trial's route needs no token", [[IX,
    "url.pathname === \"/odoo/hook/price-review-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {",
    "url.pathname === \"/odoo/hook/price-review-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (false) {"]], T],
  ["هـ", "the trial's purpose is not the owner's (the gateway's owner guard blocks it)", [[GW,
    "\"owner_order_confirmed\", \"price_review_test\"]);", "\"owner_order_confirmed\"]);"]], T],
  ["هـ", "the review's purpose is not the owner's alone (it may reach another number)", [[GW,
    "    if (OWNER_ALLOWED_PURPOSES.has(p) && !isOwnerRecipient(env, to)) {", "    if (false) {"]], T],
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
writeFileSync(new URL("../artifacts/s54-20261005-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
