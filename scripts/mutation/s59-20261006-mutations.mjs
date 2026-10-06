// Mutation check for § 59 (2026-10-06) — Omar's operating tasks to Baraa through the roles and the
// company's working days (أ: src/owner-team.ts, src/attendance.ts, src/operating-cost.ts,
// src/driver-followup.ts, src/out-for-delivery.ts), the marketing member's price list (ب:
// src/team-prices.ts), what is available today and the text quotation (ج: src/order-form.ts,
// src/order-flow.ts, src/router.ts, src/price-validity.ts, src/sale-accounting.ts), every PDF as an
// attached file (د: src/quotation.ts, src/payment-confirm.ts, src/transfer-form.ts, src/meta.ts) and the
// five trials (ز: src/s59-trials.ts). Each mutation disables ONE guard, runs the test file, and must
// make it fail. The source is restored in `finally` after every run; a pattern that is not found
// exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s59-20261006-mutations.mjs [أ ب ج د ز]     (no argument: every part)
//
// Out: scripts/artifacts/s59-20261006-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ
  ["أ", "the costs' working days follow the driver again (the company's schedule is not read)", [["src/operating-cost.ts",
    "const schedule = needs ? (await companySchedule(env, day, nowMs)) ?? (await driverSchedule(env, nowMs)) : null;", "const schedule = needs ? await driverSchedule(env, nowMs) : null;"]], "tests/s59-team.test.mts"],
  ["أ", "a driver's schedule wins over the company's", [["src/operating-cost.ts",
    "const schedule = needs ? (await companySchedule(env, day, nowMs)) ?? (await driverSchedule(env, nowMs)) : null;", "const schedule = needs ? (await driverSchedule(env, nowMs)) ?? (await companySchedule(env, day, nowMs)) : null;"]], "tests/s59-team.test.mts"],
  ["أ", "a company schedule without a line reads as «every day is off» (the monthlies silently dropped)", [["src/operating-cost.ts",
    "    if (schedule.company && schedule.lines.length === 0) return null;\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "«تعذّر» of the company's schedule gives the driver's reason", [["src/operating-cost.ts",
    "reason: schedule?.company ? NO_COMPANY_DAYS_REASON : schedule ? ", "reason: schedule ? "]], "tests/s59-team.test.mts"],
  ["أ", "the settings' schedule is read from Odoo with every computation (no KV)", [["src/operating-cost.ts",
    "    try { await env.MSG_DEDUP.put(`${WORKDAYS_KV}:${day}`, JSON.stringify({ c: named }), { expirationTtl: WORKDAYS_TTL }); } catch { /* next time */ }\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "a tenant without the field: the cost fails instead of reading the driver's schedule", [["src/operating-cost.ts",
    "(e as Error)?.message);\n      return null;\n    }\n    try { await env.MSG_DEDUP.put(`${WORKDAYS_KV}", "(e as Error)?.message);\n      throw e;\n    }\n    try { await env.MSG_DEDUP.put(`${WORKDAYS_KV}"]], "tests/s59-team.test.mts"],
  ["أ", "the cost does not say its working days came from the company's schedule", [["src/operating-cost.ts",
    "source: schedule ? (schedule.company ? \"company\" : \"driver\") : null", "source: schedule ? \"driver\" : null"]], "tests/s59-team.test.mts"],
  ["أ", "a team purpose reaches Baraa although he holds no role", [["src/owner-team.ts",
    "  return OWNER_TEAM_PURPOSES.has(purpose) && (await ownerOnTeam(env));", "  return OWNER_TEAM_PURPOSES.has(purpose);"]], "tests/s59-team.test.mts"],
  ["أ", "ANY purpose reaches Baraa once he holds a role", [["src/owner-team.ts",
    "  return OWNER_TEAM_PURPOSES.has(purpose) && (await ownerOnTeam(env));", "  return await ownerOnTeam(env);"]], "tests/s59-team.test.mts"],
  ["أ", "the owner guard never opens for a team purpose", [["src/wa-gateway.ts",
    "    if (!OWNER_ALLOWED_PURPOSES.has(p) && !(await teamPurposeForOwner(env, p))) {", "    if (!OWNER_ALLOWED_PURPOSES.has(p)) {"]], "tests/s59-team.test.mts"],
  ["أ", "an unreadable roster opens the guard", [["src/owner-team.ts",
    "a team purpose stays refused for the owner\", (e as Error)?.message);\n    return false;", "a team purpose stays refused for the owner\", (e as Error)?.message);\n    return true;"]], "tests/s59-team.test.mts"],
  ["أ", "«بدء الدوام» reaches Baraa as a member's too", [["src/owner-team.ts",
    "  \"team_task\", \"shift_ack\", \"team_sp_decision\", \"commission\", \"bot_reply\",", "  \"team_task\", \"shift_ack\", \"team_sp_decision\", \"commission\", \"bot_reply\", \"team_shift_start\","]], "tests/s59-team.test.mts"],
  ["أ", "his «بدء الدوام» stays at the fixed hour although he has a shift of his own", [["src/attendance.ts",
    "  if (ownShift !== null) plan.minutes = ownShift;\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "his tap releases no task", [["src/index.ts",
    "            await deliverTasksOnTap(env, teamMember, msg.from, { quietWhenNone: true });\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "«ما عندك مهام» after his «✅ تم»", [["src/index.ts",
    "deliverTasksOnTap(env, teamMember, msg.from, { quietWhenNone: true });", "deliverTasksOnTap(env, teamMember, msg.from, {});"]], "tests/s59-team.test.mts"],
  ["أ", "his own buttons and commands go to the team's router", [["src/index.ts",
    "const ownersOwn = !!teamMatch && isOwnerNumber(env, msg.from) && (await import(\"./owner-team\")).isOwnerOwnMessage(msg);", "const ownersOwn = false;"]], "tests/s59-team.test.mts"],
  ["أ", "every message of his is «his own» (none is a member's)", [["src/index.ts",
    "const ownersOwn = !!teamMatch && isOwnerNumber(env, msg.from) && (await import(\"./owner-team\")).isOwnerOwnMessage(msg);", "const ownersOwn = !!teamMatch && isOwnerNumber(env, msg.from);"]], "tests/s59-team.test.mts"],
  ["أ", "the price review's buttons are not his own", [["src/owner-team.ts",
    "      || /^prvt?_[arn]_\\d+_\\d+$/.test(button)               // the day's price review\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "«✅ وصل» is not his own", [["src/owner-team.ts",
    "      || /^trn_(ok|no)_/.test(button)                       // «✅ وصل» / «❌ ما وصل»\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "«مصروف» is not his own", [["src/owner-team.ts",
    "  return deliverCommandOrderId(text) !== null || expenseCommand(text);", "  return deliverCommandOrderId(text) !== null;"]], "tests/s59-team.test.mts"],
  ["أ", "«بدء الدوام» is his own (no task released)", [["src/owner-team.ts",
    "      || button === EXPENSE_BUTTON || EXPENSE_UNDO_PAYLOAD.test(button);", "      || button === EXPENSE_BUTTON || EXPENSE_UNDO_PAYLOAD.test(button) || button === \"shift_start\";"]], "tests/s59-team.test.mts"],
  ["أ", "the end-of-shift follow-up leaves Baraa out, as before § 59", [["src/driver-followup.ts",
    "  const drivers = roster.members.filter((m) => m.codes.includes(\"driver\") && m.partnerId);", "  const drivers = roster.members.filter((m) => m.codes.includes(\"driver\") && m.partnerId && !isOwner(m));"]], "tests/s59-team.test.mts"],
  ["أ", "12:30 says «براء: انتهى دوامه»", [["src/driver-followup.ts",
    "isOwner ? ownerOwnAfterShiftText(stops, endMin) : ownerAfterShiftText(m.name, stops, endMin)", "ownerAfterShiftText(m.name, stops, endMin)"]], "tests/s59-team.test.mts"],
  ["أ", "his day off raises an alert that names him", [["src/driver-followup.ts",
    "        else if (isOwner(m)) { if (day === today) steps.push(`${day}:${plan.kind}:owner`); }\n", ""]], "tests/s59-team.test.mts"],
  ["أ", "«في الطريق … مع السائق براء»", [["src/out-for-delivery.ts",
    "  return whatsapp && isOwnerRecipient(env, whatsapp) ? OWNER_DRIVER : name;", "  return name;"]], "tests/s59-team.test.mts"],
  ["أ", "the caller's name wins over who the route's driver is", [["src/out-for-delivery.ts",
    "    return ofdDriverName(env, given ?? stripRef(r.x_driver_id[1]), String(p?.x_whatsapp_number || p?.phone || \"\"));", "    return given ?? ofdDriverName(env, stripRef(r.x_driver_id[1]), String(p?.x_whatsapp_number || p?.phone || \"\"));"]], "tests/s59-team.test.mts"],
  ["أ", "the team's label is not Baraa's wording", [["src/out-for-delivery.ts",
    "export const TEAM_LABEL = \"فريق يو تاك\";", "export const TEAM_LABEL = \"فريق التوصيل\";"]], "tests/s59-team.test.mts"],
  // ---------------------------------------------------------------- ب
  ["ب", "the publication sends the marketing member nothing", [["src/prices.ts",
    "    const marketing = await marketingListAfterPublication(penv, { dayId, day: day.x_date }, now, opts.ctx);", "    const marketing: Array<{ name: string; action: string }> = [];"]], "tests/s59-prices.test.mts"],
  ["ب", "the list goes to whoever holds «سائق»", [["src/team-prices.ts",
    "    const members = await getTeamMembersByRole(env, MARKETING_ROLE);", "    const members = await getTeamMembersByRole(env, \"driver\");"]], "tests/s59-prices.test.mts"],
  ["ب", "every line of the day is in the list (the unpublished too, at their suggested price)", [["src/team-prices.ts",
    "  return (await listItems(env, list)).map(", "  return (await listItems(env, list, true)).map("]], "tests/s59-prices.test.mts"],
  ["ب", "the list carries the item's reference code", [["src/team-prices.ts",
    "`• ${fullName(i.productName)} (", "`• ${i.productName} ("]], "tests/s59-prices.test.mts"],
  ["ب", "«صالحة حتى 6:00 صباح بكرة» left out", [["src/team-prices.ts",
    "[TEAM_PRICES_VAT_LINE, TEAM_PRICES_VALID_LINE, link ?", "[TEAM_PRICES_VAT_LINE, link ?"]], "tests/s59-prices.test.mts"],
  ["ب", "the validity is not Baraa's wording", [["src/team-prices.ts",
    "export const TEAM_PRICES_VALID_LINE = \"صالحة حتى 6:00 صباح بكرة.\";", "export const TEAM_PRICES_VALID_LINE = \"صالحة اليوم.\";"]], "tests/s59-prices.test.mts"],
  ["ب", "no order link in the list", [["src/team-prices.ts",
    "link ? `للطلب على واتساب: ${link}` : \"\"", "\"\""]], "tests/s59-prices.test.mts"],
  ["ب", "the link opens without «أبي أطلب»", [["src/team-prices.ts",
    "`https://wa.me/${d}?text=${encodeURIComponent(ORDER_LINK_TEXT)}`", "`https://wa.me/${d}`"]], "tests/s59-prices.test.mts"],
  ["ب", "a link from a number that is not one", [["src/team-prices.ts",
    "  return d.length >= 9 ? `https://wa.me/", "  return d.length >= 1 ? `https://wa.me/"]], "tests/s59-prices.test.mts"],
  ["ب", "the list goes again with every run for the same day", [["src/team-prices.ts",
    "      if (!claim.claimed) { out.push({ name: m.name, action: \"claimed_before\" }); continue; }\n", ""]], "tests/s59-prices.test.mts"],
  ["ب", "the template's «أرسل القائمة» carries no payload", [["src/team-prices.ts",
    "buttons: [{ index: 0, payload: TEAM_PRICES_PAYLOAD }] }],", "buttons: [] }],"]], "tests/s59-prices.test.mts"],
  ["ب", "the list is held in the gateway outside his window", [["src/team-prices.ts",
    "          noHold: true, noHoldReason: \"القائمة تصله مع أول رسالة منه (لا قالب UTILITY لها)\", ctx,", "          ctx,"]], "tests/s59-prices.test.mts"],
  ["ب", "a list he did not get is not owed to him", [["src/team-prices.ts",
    "          await markOwed(env, to, list, now);\n", ""]], "tests/s59-prices.test.mts"],
  ["ب", "his own ask does not settle what was owed (a second list with his next message)", [["src/team-prices.ts",
    "  await clearOwed(env, to);\n  try {\n    const list = await validPriceList(env, now);", "  try {\n    const list = await validPriceList(env, now);"]], "tests/s59-prices.test.mts"],
  ["ب", "before the publication he is told nothing", [["src/team-prices.ts",
    "      await sendViaGateway(env, { purpose: TEAM_PRICES_PURPOSE, to, content: textContent(TEAM_PRICES_UPDATING_TEXT), noHold: true, ctx });\n      return \"updating\";", "      return \"updating\";"]], "tests/s59-prices.test.mts"],
  ["ب", "any message with «أسعار» in it is the command", [["src/team-prices.ts",
    "  return /^(ال)?اسعار( اليوم)?$/.test(t) ||", "  return /اسعار/.test(t) ||"]], "tests/s59-prices.test.mts"],
  ["ب", "«القائمة» is not the command", [["src/team-prices.ts",
    " || /^(ال)?قايمه( (ال)?اسعار)?( اليوم)?$/.test(t);", ";"]], "tests/s59-prices.test.mts"],
  ["ب", "any member of the team is answered with the list", [["src/index.ts",
    "        if (TP.isMarketingMember(teamMember)) {", "        if (true) {"]], "tests/s59-prices.test.mts"],
  ["ب", "a marketing member's other text gets the team's «استخدم الأزرار»", [["src/index.ts",
    "            } else if ((await import(\"./team-prices\")).isMarketingOnly(teamMember)) {", "            } else if (false) {"]], "tests/s59-prices.test.mts"],
  ["ب", "the hint follows the owed list", [["src/index.ts",
    "            if (TP.isMarketingOnly(teamMember) && msg.type === \"text\") {", "            if (false) {"]], "tests/s59-prices.test.mts"],
  ["ب", "the list is not a price-bearing purpose (it reaches a supplier's number)", [["src/price-privacy.ts",
    "  \"team_price_list\",\n]);", "]);"]], "tests/s59-prices.test.mts"],
  // ---------------------------------------------------------------- ج
  ["ج", "the form's message does not name what is available", [["src/order-form.ts",
    "content: orderFormSession(orderFormBody(`${mark}${opts.body ?? orderFormAskText(who.name)}`, available.filter((i) => i.price > 0)), rec.token,", "content: orderFormSession(`${mark}${opts.body ?? orderFormAskText(who.name)}`, rec.token,"]], "tests/s59-available.test.mts"],
  ["ج", "more than ten items named", [["src/order-form.ts",
    "  const lines = items.slice(0, AVAILABLE_MAX).map(availableLine);", "  const lines = items.map(availableLine);"]], "tests/s59-available.test.mts"],
  ["ج", "«+N صنف داخل النموذج» left out", [["src/order-form.ts",
    "  const more = (n: number): string => (n > 0 ? `+${n} صنف داخل النموذج` : \"\");", "  const more = (_n: number): string => \"\";"]], "tests/s59-available.test.mts"],
  ["ج", "the body goes over Meta's 1024 characters", [["src/order-form.ts",
    "    if (chars(text).length <= room) return text;", "    if (true) return text;"]], "tests/s59-available.test.mts"],
  ["ج", "the item's line carries its reference code", [["src/order-form.ts",
    "`• ${clean(i.productName)} (${clean(i.packagingName)}): ${money(i.price)} ر.س`", "`• ${i.productName} (${clean(i.packagingName)}): ${money(i.price)} ر.س`"]], "tests/s59-available.test.mts"],
  ["ج", "«عدّل الطلب» names the available items too", [["src/order-form.ts",
    "    const available = o.cta === ORDER_FORM_EDIT_CTA ? [] : built.available;", "    const available = built.available;"]], "tests/s59-available.test.mts"],
  ["ج", "an item the list does not hold is added to the order", [["src/router.ts",
    "        active.splice(0, active.length, ...active.filter((it) => !missing.includes(it)));\n", ""]], "tests/s59-available.test.mts"],
  ["ج", "what the list does not hold is not said to be unavailable", [["src/router.ts",
    "      if (missing.length || deactivatedMatches.length || trulyUnknown.length) {", "      if (false) {"]], "tests/s59-available.test.mts"],
  ["ج", "an item we do not sell is not «غير متوفر» (the soft line of before)", [["src/router.ts",
    "      if (missing.length || deactivatedMatches.length || trulyUnknown.length) {", "      if (missing.length) {"]], "tests/s59-available.test.mts"],
  ["ج", "«هذا الصنف» although he asked for other items too", [["src/router.ts",
    "alone: items.length === 1 };", "alone: true };"]], "tests/s59-available.test.mts"],
  ["ج", "the unavailable answer goes once a list (the form's own rule)", [["src/index.ts",
    "  if (reply.orderForm?.unavailable) {", "  if (false) {"]], "tests/s59-available.test.mts"],
  ["ج", "the unavailable wording is not Baraa's", [["src/order-form.ts",
    "export const UNAVAILABLE_TEXT = \"هذا الصنف غير متوفر اليوم 🌿\";", "export const UNAVAILABLE_TEXT = \"الصنف غير موجود 🌿\";"]], "tests/s59-available.test.mts"],
  ["ج", "a line the list does not hold stays in the order's quotation («نراجع السعر»)", [["src/order-flow.ts",
    "      unavailable.push(l.product_name);\n      continue;\n", "      unavailable.push(l.product_name);\n"]], "tests/s59-available.test.mts"],
  ["ج", "the line that left the order is not marked", [["src/order-flow.ts",
    "vals: { x_status: \"unavailable\", x_unit_price: 0, x_subtotal: 0 }", "vals: { x_unit_price: 0, x_subtotal: 0 }"]], "tests/s59-available.test.mts"],
  ["ج", "an order with nothing left in it stays open", [["src/order-flow.ts",
    "    await updateOrderState(env, a.orderId, \"cancelled\");\n    const { unavailableText }", "    const { unavailableText }"]], "tests/s59-available.test.mts"],
  ["ج", "the order that waited is told «غير متوفر» without what is available", [["src/order-flow.ts",
    "        await send(textContent([q.text, block].filter(Boolean).join(\"\\n\")));", "        await send(textContent(q.text));"]], "tests/s59-available.test.mts"],
  ["ج", "the text quotation's lines carry no amount", [["src/order-flow.ts",
    " × ${qtyText(l.quantity)} = ${money(round2(price(l) * l.quantity))} ر.س`),", " × ${qtyText(l.quantity)}`),"]], "tests/s59-available.test.mts"],
  ["ج", "the text quotation carries no total", [["src/order-flow.ts",
    "    `المجموع: ${money(total)} ر.س`,\n    \"\",\n    ...[q.locationLine", "    \"\",\n    ...[q.locationLine"]], "tests/s59-available.test.mts"],
  ["ج", "the quotation does not say what was left out", [["src/order-flow.ts",
    "    ...(q.unavailable?.length ? [leftOutNote(q.unavailable)] : []),\n", ""]], "tests/s46-zero-price.test.mts"],
  ["ج", "«خلاص» answers with the bare quotation of before", [["src/router.ts",
    "  return {\n    bodyBeforeButtons: await quotationBody(env, orderId, q, now),\n    buttons: quotationButtons(orderId),\n  };", "  return {\n    bodyBeforeButtons: `📄 الكوتيشن رقم ${q.number}`,\n    buttons: quotationButtons(orderId),\n  };"]], "tests/s59-available.test.mts"],
  ["ج", "«تأكيد» confirms over his head an order a line just left", [["src/router.ts",
    "confirmable = !!fr && fr.lines > 0 && fr.unavailable.length === 0;", "confirmable = !!fr && fr.lines > 0;"]], "tests/s46-zero-price.test.mts"],
  ["ج", "a line that left the order before it was priced enters the sale order", [["src/sale-accounting.ts",
    "    if (r.x_status === \"unavailable\" && !unit) continue;\n", ""]], "tests/sale-accounting.test.mts"],
  ["ج", "the unavailable answer has no text when no form can go", [["src/order-form.ts",
    "content: textContent(orderFormBody(head, items)), noHold: true, ctx });\n    return gatewayDecision(res)?.action === \"session\";", "content: textContent(\"\"), noHold: true, ctx });\n    return gatewayDecision(res)?.action === \"session\";"]], "tests/s59-available.test.mts"],
  ["ج", "the welcome is not Baraa's wording", [["src/templates.ts",
    "تم تفعيل حسابك في يو تاك 🌿 تقدر تطلب من هنا في أي وقت: اكتب «اطلب» ويوصلك نموذج فيه أصناف اليوم وأسعارها.`;", "تم تفعيل حسابك في يو تاك. آخر موعد للطلب يومياً الساعة 9:00 مساءً.`;"]], "tests/s59-available.test.mts"],
  ["ج", "a new customer gets no welcome", [["src/index.ts",
    "        await sendText(env, msg.from, welcomeText(msg.profileName || \"\"), { ctx, purpose: \"customer_welcome\" });\n", ""]], "tests/s59-available.test.mts"],
  // ---------------------------------------------------------------- د
  ["د", "the quotation's file outside the window never uses v2", [["src/quotation.ts",
    "            { kind: \"template\", purpose: QUOTATION_PDF_V2_PURPOSE, params, header },\n", ""]], "tests/s59-files.test.mts"],
  ["د", "v2 not usable: no v1 behind it", [["src/quotation.ts",
    "            { kind: \"template\", purpose: T.CUSTOMER_QUOTATION_PDF, params, header },\n", ""]], "tests/s59-files.test.mts"],
  ["د", "v1 is tried before v2", [["src/quotation.ts",
    "            { kind: \"template\", purpose: QUOTATION_PDF_V2_PURPOSE, params, header },\n            { kind: \"template\", purpose: T.CUSTOMER_QUOTATION_PDF, params, header },", "            { kind: \"template\", purpose: T.CUSTOMER_QUOTATION_PDF, params, header },\n            { kind: \"template\", purpose: QUOTATION_PDF_V2_PURPOSE, params, header },"]], "tests/s59-files.test.mts"],
  ["د", "the quotation's file has no name of its own", [["src/quotation.ts",
    "filename: pdfFileName(data.quotationNumber) };", "filename: \"quotation.pdf\" };"]], "tests/s59-files.test.mts"],
  ["د", "the quotation's caption carries the file's link", [["src/quotation.ts",
    "        `الإجمالي: ${data.grandTotal} ر.س`,\n        ``,\n        `${QUOTATION_FOOTER}. شكراً لتعاملكم مع UTAK 🌿`,\n      ].join(\"\\n\");\n      const header", "        `الإجمالي: ${data.grandTotal} ر.س`,\n        `الملف: ${uploaded.publicUrl}`,\n        `${QUOTATION_FOOTER}. شكراً لتعاملكم مع UTAK 🌿`,\n      ].join(\"\\n\");\n      const header"]], "tests/s59-files.test.mts"],
  ["د", "a file's name without «.pdf»", [["src/meta.ts",
    "  return `${n || \"UTAK\"}.pdf`;", "  return n || \"UTAK\";"]], "tests/s59-files.test.mts"],
  ["د", "a caption longer than Meta's 1024", [["src/meta.ts",
    "{ caption: c.slice(0, 1024) }", "{ caption: c }"]], "tests/s59-files.test.mts"],
  ["د", "the receipt's file never follows its words", [["src/payment-confirm.ts",
    "  const file = action === \"sent\" || action === \"held\" ? await sendReceiptFile(env, to, opts.receipt, { paymentId, ctx: opts.ctx }) : \"none\";", "  const file: ReceiptFileAction = \"none\";"]], "tests/s59-files.test.mts"],
  ["د", "Baraa is alerted about every receipt file that waits", [["src/payment-confirm.ts",
    "      important: false,\n      // (not linked", "      important: true,\n      // (not linked"]], "tests/s59-files.test.mts"],
  ["د", "an empty document goes for a receipt without a file", [["src/payment-confirm.ts",
    "  if (!to || !receipt?.url) return \"none\";", "  if (!to) return \"none\";"]], "tests/s59-files.test.mts"],
  ["د", "the receipt's file is not named by its number", [["src/payment-confirm.ts",
    "documentContent(receipt.url, receipt.number || \"UTAK-R\", receipt.number ?", "documentContent(receipt.url, \"UTAK-R\", receipt.number ?"]], "tests/s59-files.test.mts"],
  ["د", "«✅ وصل» outside the window waits 48 hours again (no template)", [["src/transfer-form.ts",
    "    if (!open && rows.length) {", "    if (false) {"]], "tests/s59-files.test.mts"],
  ["د", "«✅ وصل» sends the template inside the window too", [["src/transfer-form.ts",
    "    if (!open && rows.length) {", "    if (rows.length) {"]], "tests/s59-files.test.mts"],
  ["د", "the one text is held too after the templates went", [["src/transfer-form.ts",
    "    if (templates) via = \"template\";\n    else {", "    if (templates) via = \"template\";\n    {"]], "tests/s59-files.test.mts"],
  ["د", "the template of «✅ وصل» is not linked to its payment", [["src/transfer-form.ts",
    "          link: { model: PAYCONF_LINK_MODEL, id: r.paymentId }, ctx,\n        }));\n        if (d?.action !== \"template\") break;", "          ctx,\n        }));\n        if (d?.action !== \"template\") break;"]], "tests/s59-files.test.mts"],
  ["د", "the receipt's file waits a day, not a week", [["src/wa-purposes.ts",
    "customer_receipt_file: op(\"ملف الإيصال (PDF)\", false, { hours: 168 }),", "customer_receipt_file: op(\"ملف الإيصال (PDF)\", false, { hours: 24 }),"]], "tests/s59-files.test.mts"],
  ["د", "Baraa's line does not say the customer was told by template", [["src/transfer-form.ts",
    "  if (via === \"template\") return `أُبلغ العميل بقالب «استلمنا دفعتك» لكل فاتورة (نافذته مغلقة)", "  if (via === \"template\") return `أُبلغ العميل برسالة واحدة"]], "tests/s59-files.test.mts"],
  // ---------------------------------------------------------------- ز
  ["ز", "a trial goes although his window is closed", [["src/s59-trials.ts",
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n  const claim = await claimButton(env, `s59_trial:", "  const claim = await claimButton(env, `s59_trial:"]], "tests/s59-trials.test.mts"],
  ["ز", "a trial goes again the same day", [["src/s59-trials.ts",
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n  try {\n    const r = await send(owner);", "  try {\n    const r = await send(owner);"]], "tests/s59-trials.test.mts"],
  ["ز", "the trials' purposes are not Baraa's alone", [["src/wa-gateway.ts",
    "for (const p of [\"team_prices_test\", \"quotation_file_test\", \"shift_start_test\"]) (OWNER_ALLOWED_PURPOSES as Set<string>).add(p);", "for (const p of [] as string[]) (OWNER_ALLOWED_PURPOSES as Set<string>).add(p);"]], "tests/s59-trials.test.mts"],
  ["ز", "the hook answers without the token", [["src/index.ts",
    "url.pathname === \"/odoo/hook/s59-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {", "url.pathname === \"/odoo/hook/s59-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false && providedToken && expected) {"]], "tests/s59-trials.test.mts"],
  ["ز", "the unavailable trial spends the form trial's turn", [["src/order-form.ts",
    "${kind === \"unavailable\" ? \"unavailable:\" : \"\"}", ""]], "tests/s59-trials.test.mts"],
  ["ز", "an example list is not said to be one", [["src/s59-trials.ts",
    "${example ? \"، بأسعار آخر يوم كمثال: لا قائمة صالحة الآن\" : \"، بأسعار القائمة الصالحة الآن\"}", "، بأسعار القائمة الصالحة الآن"]], "tests/s59-trials.test.mts"],
  ["ز", "the trial quotation carries a real quotation's number", [["src/s59-trials.ts",
    "`UTAK-Q-TRIAL-${day.replace(/-/g, \"\")}`", "`UTAK-Q-${day.replace(/-/g, \"\")}-001`"]], "tests/s59-trials.test.mts"],
  ["ز", "the trial's list is not the member's own text (marked inside)", [["src/s59-trials.ts",
    "    for (const part of parts) await went(env, TEAM_PRICES_TEST_PURPOSE, owner, textContent(part));", "    for (const part of parts) await went(env, TEAM_PRICES_TEST_PURPOSE, owner, textContent(`${S59_TRIAL_MARK} ${part}`));"]], "tests/s59-trials.test.mts"],
  ["ز", "«بدء الدوام»'s trial goes as a member's template (the owner guard refuses it)", [["src/s59-trials.ts",
    "undefined, { sendPurpose: OWNER_WINDOW_PURPOSE });", "undefined, {});"]], "tests/s59-trials.test.mts"],
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
writeFileSync(new URL("../artifacts/s59-20261006-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
