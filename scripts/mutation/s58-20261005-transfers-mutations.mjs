// Mutation check for § 58 أ 1 + أ 3 + ب (2026-10-05) — ONE source for every transfer: the notice every
// door files or updates (src/transfer-form.ts), the collector's «تحويل 🏦» (src/collect-pay.ts,
// src/invoice.ts) and the delivery form's (src/delivery-form.ts), the last guard before any payment
// (src/invoice.ts recordCollection), the customer's ONE message after «✅ وصل» with its receipts
// (src/receipt.ts, src/payment-confirm.ts), the two buttons after a delivery (src/after-delivery.ts,
// src/router.ts) and the two trials. Each mutation disables ONE guard, runs the test file, and must make
// it fail. The source is restored in `finally` after every run; a pattern that is not found exactly once
// stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s58-20261005-transfers-mutations.mjs [مصدر محصّل حارس وصل إيصال زرّان تجربة دليل]     (no argument: every part)
//
// Out: scripts/artifacts/s58-20261005-transfers-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s58-transfers.test.mts";
const T55 = "tests/s55-delivery.test.mts";
const TR = "src/transfer-form.ts";
const CP = "src/collect-pay.ts";
const INV = "src/invoice.ts";
const DF = "src/delivery-form.ts";
const PC = "src/payment-confirm.ts";
const RC = "src/receipt.ts";
const AD = "src/after-delivery.ts";
const RT = "src/router.ts";
const IDX = "src/index.ts";
const GUIDE = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- one notice an invoice
  ["مصدر", "a second source on an invoice with an open notice files a notice of its own", [[TR,
    "  if (!first) return { notice: { v: 1, id: newNoticeId(), at: nowMs, ...fields, sources: [source] }, linked: false, replaced: false };", "  if (true) return { notice: { v: 1, id: newNoticeId(), at: nowMs, ...fields, sources: [source] }, linked: false, replaced: false };"]], T],
  ["مصدر", "a decided notice still counts as the invoice's open one", [[TR,
    "    if (n && !n.decided) return n;", "    if (n) return n;"]], T],
  ["مصدر", "the customer's notice does not mark its invoices as waiting on it", [[TR,
    "    await used();\n    await markOpen(env, n);\n", "    await used();\n"]], T],
  ["مصدر", "the collector's notice does not mark its invoice as waiting on it", [[TR,
    "  await writeTransferNotice(env, n);\n  await markOpen(env, n);\n}", "  await writeTransferNotice(env, n);\n}"]], T],
  ["مصدر", "the customer's figures do not stand over a collector's", [[TR,
    "  const replaced = source.by === \"customer\" && !before.some((s) => s.by === \"customer\");", "  const replaced = false;"]], T],
  ["مصدر", "a collector's figures take the place of the customer's", [[TR,
    "  const replaced = source.by === \"customer\" && !before.some((s) => s.by === \"customer\");", "  const replaced = !before.some((s) => s.by === source.by);"]], T],
  ["مصدر", "the customer's linked form asks Baraa a second time", [[TR,
    "    if (planned.linked) await sendOwnerLinked(env, planned, media, extra, ctx);\n    else await sendOwnerNotice(", "    await sendOwnerNotice("]], T],
  ["مصدر", "the collector's linked tap asks Baraa a second time", [[TR,
    "  if (planned.linked) await sendOwnerLinked(env, planned, undefined, [], o.ctx);\n  else await sendOwnerNotice(", "  await sendOwnerNotice("]], T],
  ["مصدر", "the second source is linked silently: Baraa does not read the two sources", [[TR,
    "  if (planned.linked) await sendOwnerLinked(env, planned, undefined, [], o.ctx);\n  else await sendOwnerNotice(", "  if (!planned.linked) await sendOwnerNotice("]], T],
  ["مصدر", "the message of the two sources does not say which amount «✅ وصل» will record", [[TR,
    "    ...(differ ? [`⚠️ المبالغ مختلفة:", "    ...(false ? [`⚠️ المبالغ مختلفة:"]], T],
  ["مصدر", "the message of the two sources says the amounts differ when they do not", [[TR,
    "  const differ = new Set(src.map((x) => fmtSar(x.amount))).size > 1;", "  const differ = src.length > 1;"]], T],
  ["مصدر", "the customer's receipt is not shown to Baraa with the second source", [[TR,
    "  if (media) {\n    const body = /pdf/i.test(media.mime)", "  if (false) {\n    const body = /pdf/i.test(media.mime)"]], T],
  ["مصدر", "a receipt Meta refuses takes the two sources with it: Baraa reads nothing", [[TR,
    "    if (sent?.action !== \"rejected\") return;", "    if (true) return;"]], T],
  ["مصدر", "the second source's line loses its hour", [[TR,
    " ر.س — الساعة ${riyadhHHMM(new Date(s.at))}`;", " ر.س`;"]], T],
  // ---------------------------------------------------------------- the collector's «تحويل 🏦»
  ["محصّل", "«المبلغ كامل» of «تحويل 🏦» records the payment at once", [[CP,
    "  if (method === \"transfer\") {\n    const { noticeCollectorTransfer } = await import(\"./transfer-form\");\n    let noticeId = \"\";", "  if (false) {\n    const { noticeCollectorTransfer } = await import(\"./transfer-form\");\n    let noticeId = \"\";"]], T],
  ["محصّل", "the amount he types for «تحويل 🏦» records the payment at once", [[CP,
    "  if (ptr.method === \"transfer\") {", "  if (false) {"]], T],
  ["محصّل", "«المبلغ كامل» of «تحويل 🏦» tapped twice files two notices", [[CP,
    "    const said = await withButtonLock(env, cpRecLock(invoiceId, promptNonce), async () => {\n      const r = await noticeCollectorTransfer(env, invoiceId, null, who);\n      noticeId = r.noticeId ?? \"\";\n      return r.text;\n    });", "    const said = (await noticeCollectorTransfer(env, invoiceId, null, who)).text;"]], T],
  ["محصّل", "an amount above what is left is filed as a notice", [[TR,
    "  if (amount !== null && amount > remaining + 0.005) return { text:", "  if (false) return { text:"]], T],
  ["محصّل", "a paid invoice takes a collector's notice", [[TR,
    "  if (inv.status === \"paid\") return { text: `الفاتورة ${inv.number} تم تحصيلها مسبقاً ✅` };\n", ""]], T],
  ["محصّل", "an invoice with nothing left takes a collector's notice", [[TR,
    "  if (!(remaining > 0.005)) return { text: `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${inv.number}.` };\n", ""]], T],
  ["محصّل", "the collector reads another line", [[TR,
    "export const COLLECTOR_NOTICED_TEXT = \"تمام، سجّلناه — ينتظر تأكيد وصول المبلغ\";", "export const COLLECTOR_NOTICED_TEXT = \"تم تسجيل التحصيل تحويل 🏦\";"]], T],
  ["محصّل", "the collector's notice reaches Baraa without the line of its source", [[TR,
    "ownerNoticeText(n, [collectorSourceText(who.name)])", "ownerNoticeText(n, [])"]], T],
  ["محصّل", "the collector's notice is kept as the customer's own", [[TR,
    "    source: { by: \"collector\", name: who.name, at: nowMs, amount: sum, invoices: [inv.number] },", "    source: { by: \"customer\", name: who.name, at: nowMs, amount: sum, invoices: [inv.number] },"]], T],
  ["محصّل", "the collector's notice names no customer to tell", [[TR,
    "partnerId: cust?.id ?? 0, name: cust?.name ?? \"\", to: waDigits(cust?.phone ?? \"\"),", "partnerId: cust?.id ?? 0, name: cust?.name ?? \"\", to: \"\","]], T],
  ["محصّل", "the direct collection button's «تحويل» records a payment", [[INV,
    "  if (method === \"transfer\") {\n    const { noticeCollectorTransfer } = await import(\"./transfer-form\");\n    return { text:", "  if (false) {\n    const { noticeCollectorTransfer } = await import(\"./transfer-form\");\n    return { text:"]], T],
  ["محصّل", "the delivery form's «تحويل» records a payment", [[DF,
    "    if (method === \"transfer\") {\n      const { noticeCollectorTransfer }", "    if (false) {\n      const { noticeCollectorTransfer }"]], T55],
  ["محصّل", "a transfer above the invoice in the delivery form is not told as such", [[DF,
    "      if (n.overLimit) return { kind: \"over\", method, amount, remaining: n.overLimit.remaining };\n", ""]], T55],
  ["محصّل", "the delivery form's over-amount rings the last guard beside its own line", [[DF,
    "invoiceId: inv.invoiceId, quietExcess: true, method, amount, collectedBy, exact: true", "invoiceId: inv.invoiceId, method, amount, collectedBy, exact: true"]], T55],
  ["محصّل", "the delivery form's transfer notice also writes its own line to Baraa", [[DF,
    "  const pay = p.kind === \"paid\" || p.kind === \"noticed\" ? \"\"", "  const pay = p.kind === \"paid\" ? \"\""]], T55],
  ["محصّل", "the one who delivered reads that the transfer waits for the bank, not for Baraa", [[DF,
    "سجّلناه إشعار تحويل، ولا دفعة حتى ${owner", "ينتظر المطابقة البنكية${owner ? \"\" : \"\"}${owner"]], T55],
  // ---------------------------------------------------------------- the last guard
  ["حارس", "an amount above what is left is put on the invoice", [[INV,
    "  if (amount > remaining) amount = remaining;\n", ""]], T],
  ["حارس", "a payment cut down to what is left does not tell Baraa", [[INV,
    "  if (cutDown) await excess(remaining, amount);\n", ""]], T],
  ["حارس", "a payment on a paid invoice does not tell Baraa", [[INV,
    "    await excess(0, 0);\n", ""]], T],
  ["حارس", "an amount typed above what is left does not tell Baraa", [[INV,
    "    await excess(remaining, 0);\n    return { text: `المتبقي", "    return { text: `المتبقي"]], T],
  ["حارس", "a caller that says the excess itself is not heard: the guard rings too", [[INV,
    "    if (!a.quietExcess) await alertExcessPayment(", "    await alertExcessPayment("]], T],
  ["حارس", "the guard rings on every try of the same amount", [[INV,
    "    if (!claim.claimed) return false;\n    await sendOwnerAlert(env, excessAlertText(a));", "    await sendOwnerAlert(env, excessAlertText(a));"]], T],
  ["حارس", "the guard rings when exactly what is left is taken", [[INV,
    "  const cutDown = amount > remaining + 0.005;", "  const cutDown = true;"]], T],
  ["حارس", "the alert does not say what was left", [[INV,
    "والمتبقي ${fmtSar(Math.max(0, a.left))} ر.س. ", ""]], T],
  ["حارس", "the alert does not say the amount asked", [[INV,
    "المبلغ ${asked} والمتبقي", "والمتبقي"]], T],
  ["حارس", "the alert does not name the invoice", [[INV,
    "— الفاتورة ${a.number} (${a.method", "(${a.method"]], T],
  ["حارس", "«✅ وصل» lets the guard's own alert ring beside its message", [[TR,
    "invoiceId: inv.id, quietExcess: true, method: \"transfer\"", "invoiceId: inv.id, method: \"transfer\""]], T],
  ["حارس", "«✅ وصل» does not say the invoice that took less than its share", [[TR,
    "      if (got + 0.005 < share) shorts.push({ number: inv.number, asked: share, left: got });\n", ""]], T],
  ["حارس", "«✅ وصل» says the two amounts the wrong way round", [[TR,
    "المبلغ ${fmtSar(x.asked)} ر.س والمتبقي ${fmtSar(x.left)} ر.س — ", "المبلغ ${fmtSar(x.left)} ر.س والمتبقي ${fmtSar(x.asked)} ر.س — "]], T],
  ["حارس", "an invoice's share is the whole transfer, not what was left on it at the notice", [[TR,
    "      const share = round2(Math.min(left, inv.remaining));", "      const share = 0;"]], T],
  // ---------------------------------------------------------------- «✅ وصل»: the customer's one message
  ["وصل", "the customer reads the one fixed line of before", [[TR,
    "content: textContent(customerConfirmedText(n.amount, rows, excess)), ctx }));", "content: textContent(\"استلمنا تحويلك ✅ شكراً لك\"), ctx }));"]], T],
  ["وصل", "the message does not name the invoices and their amounts", [[TR,
    "${rows.map((r) => `فاتورة ${r.number} (${fmtSar(r.amount)} ريال${r.paid ? \"\" : \" — جزئي\"})`).join(\"، \")}", ""]], T],
  ["وصل", "a part payment is not said to be one", [[TR,
    "${r.paid ? \"\" : \" — جزئي\"})`).join(\"، \")", ")`).join(\"، \")"]], T],
  ["وصل", "what is left over is not said to the customer", [[TR,
    "    ...(excess > 0 ? [`الباقي ${fmtSar(excess)} ريال رصيد لك عندنا.`] : []),\n", ""]], T],
  // § 59 د — the rule turned: the receipts are attached files after the message, never links in it
  ["وصل", "«✅ وصل» sends no receipt's file after its message", [[TR,
    "    for (const r of rows) await sendReceiptFile(env, n.to, { number: r.receiptNumber, url: r.receiptUrl }, { paymentId: r.paymentId, ctx });\n", ""]], T],
  ["وصل", "the message says the amount of the first invoice, not of the transfer", [[TR,
    "textContent(customerConfirmedText(n.amount, rows, excess))", "textContent(customerConfirmedText(rows[0]?.amount ?? 0, rows, excess))"]], T],
  ["وصل", "Baraa does not read the sources under what was recorded", [[TR,
    "    ...(src.length > 1 ? [`المصادر:", "    ...(src.length > 99 ? [`المصادر:"]], T],
  ["وصل", "Baraa reads that the receipts' files went when none did", [[TR,
    "  return `أُبلغ العميل برسالة واحدة${receipts ? \"، ومعها ملفات الإيصالات PDF\" : \"\"}.`;", "  return `أُبلغ العميل برسالة واحدة، ومعها ملفات الإيصالات PDF.`;"]], T],
  // ---------------------------------------------------------------- the receipts
  ["إيصال", "«✅ وصل» issues no receipt", [[TR,
    "        r.receiptUrl = issued?.pdfUrl;", "        r.receiptUrl = undefined;"]], T],
  ["إيصال", "a receipt that cannot be built stops «✅ وصل»'s messages", [[TR,
    "      } catch (e) {\n        console.warn(`[transfer] notice ${id}: the receipt of payment #${r.paymentId} was not issued`, (e as Error)?.message);\n      }", "      } finally { /* no catch */ }"]], T],
  ["إيصال", "a row of a notice gets a message of its own too", [[PC,
    "  if (isTransferNoticeNote(pay.x_notes)) {", "  if (false) {"]], T],
  ["إيصال", "the payment's note is not read", [[PC,
    "fields: [\"id\", \"x_invoice_id\", \"x_amount\", \"x_notes\", SIM_FIELD],", "fields: [\"id\", \"x_invoice_id\", \"x_amount\", SIM_FIELD],"]], T],
  ["إيصال", "any note with «تحويل» is taken for a notice's row", [[PC,
    "export const TRANSFER_NOTICE_NOTE_RE = /إشعار تحويل TRN-[a-f0-9]{10}(?![a-f0-9])/;", "export const TRANSFER_NOTICE_NOTE_RE = /تحويل/;"]], T],
  ["إيصال", "a shorter id is taken for a notice's", [[PC,
    "export const TRANSFER_NOTICE_NOTE_RE = /إشعار تحويل TRN-[a-f0-9]{10}(?![a-f0-9])/;", "export const TRANSFER_NOTICE_NOTE_RE = /إشعار تحويل TRN-[a-f0-9]+/;"]], T],
  ["إيصال", "a row that carries its receipt is built again", [[RC,
    "  if (row.x_studio_char_1_1 && row.x_studio_char_2) {", "  if (false) {"]], T],
  ["إيصال", "the receipt issued by «✅ وصل» is not written back on its row", [[RC,
    "      vals: { x_studio_char_1_1: data.receiptNumber, x_studio_datetime_1_1: nowOdoo(), x_studio_char_2: uploaded.publicUrl },", "      vals: {},"]], T],
  ["إيصال", "a payment that does not exist is issued a receipt's answer", [[RC,
    "  if (!row) return null;\n  if (row.x_studio_char_1_1", "  if (!row) return { paymentId, number: \"\", pdfUrl: \"\" };\n  if (row.x_studio_char_1_1"]], T],
  // ---------------------------------------------------------------- the two buttons after a delivery
  ["زرّان", "«تم التسليم» does not send the two buttons", [[RT,
    "  if (afterTo) {\n    const { offerAfterDelivery }", "  if (false) {\n    const { offerAfterDelivery }"]], T],
  ["زرّان", "the two buttons go before the delivery message", [[RT,
    "      afterTo = cust.phone;\n", "      afterTo = cust.phone;\n      await (await import(\"./after-delivery\")).offerAfterDelivery(env, { orderId, to: afterTo });\n"]], T],
  ["زرّان", "the window is not looked at before the send", [[AD,
    "    if (!(await readWindow(env, to, a.now ?? Date.now())).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["زرّان", "an order gets the message more than once", [[AD,
    "    if (!claim.claimed) return { sent: false, reason: \"already\" };\n", ""]], T],
  ["زرّان", "every order of the customer shares one time", [[AD,
    "export const afterDeliveryLock = (orderId: number): string => `after_delivery:${orderId}`;", "export const afterDeliveryLock = (orderId: number): string => `after_delivery:${orderId * 0}`;"]], T],
  ["زرّان", "the message's words change", [[AD,
    "export const AFTER_DELIVERY_TEXT = \"لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇\";", "export const AFTER_DELIVERY_TEXT = \"لو حوّلت اضغط هنا 👇\";"]], T],
  ["زرّان", "the message carries the transfer button alone", [[AD,
    "content: buttonsContent(AFTER_DELIVERY_TEXT, [transferNoticeButton(), complaintStartButton()]),", "content: buttonsContent(AFTER_DELIVERY_TEXT, [transferNoticeButton()]),"]], T],
  ["زرّان", "the message carries the note button first", [[AD,
    "content: buttonsContent(AFTER_DELIVERY_TEXT, [transferNoticeButton(), complaintStartButton()]),", "content: buttonsContent(AFTER_DELIVERY_TEXT, [complaintStartButton(), transferNoticeButton()]),"]], T],
  ["زرّان", "the message goes under the invoice's purpose", [[AD,
    "export const AFTER_DELIVERY_PURPOSE = \"customer_after_delivery\";", "export const AFTER_DELIVERY_PURPOSE = \"customer_transfer_form\";"]], T],
  ["زرّان", "an order with no number is sent to", [[AD,
    "    if (!to || !a.orderId) return { sent: false, reason: \"no_number\" };\n", ""]], T],
  // ---------------------------------------------------------------- the two trials
  ["تجربة", "the buttons' trial goes while Baraa's window is closed", [[AD,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["تجربة", "the buttons' trial goes more than once a day", [[AD,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], T],
  ["تجربة", "the buttons' trial carries the customer's own buttons", [[AD,
    "        { id: \"aftest_transfer\", title: transferNoticeButton().title },", "        transferNoticeButton(),"]], T],
  ["تجربة", "the buttons' trial is not marked «🧪 تجربة»", [[AD,
    "export const afterDeliveryTestText = (): string => `${AFTER_DELIVERY_TEST_MARK} — هكذا", "export const afterDeliveryTestText = (): string => `هكذا"]], T],
  ["تجربة", "a trial button from any number is answered", [[AD,
    "  if (!m || !owner || waDigits(from) !== owner) return null;", "  if (!m || !owner) return null;"]], T],
  ["تجربة", "a trial button's answer does not say that nothing was written", [[AD,
    "  return `${AFTER_DELIVERY_TEST_MARK} — ${what}.\\n${AFTER_DELIVERY_TEST_TAIL}`;", "  return `${AFTER_DELIVERY_TEST_MARK} — ${what}.`;"]], T],
  ["تجربة", "the webhook does not route a trial button", [[IDX,
    "/^aftest_(transfer|note)$/.test(msg.buttonId ?? \"\")", "/^aftest_never$/.test(msg.buttonId ?? \"\")"]], T],
  ["تجربة", "the two trial hooks need no token", [[IDX,
    "      if (!expected || !timingSafeEqual(providedToken, expected)) {\n        return json({ error: \"unauthorized\" }, 401);\n      }\n      try {\n        if (url.pathname === \"/odoo/hook/after-delivery-test\") {", "      if (false) {\n        return json({ error: \"unauthorized\" }, 401);\n      }\n      try {\n        if (url.pathname === \"/odoo/hook/after-delivery-test\") {"]], T],
  ["تجربة", "the hook of the ONE message sends the buttons' trial", [[IDX,
    "        const { sendTransferConfirmedTest } = await import(\"./transfer-form\");\n        return json({ ok: true, ...(await sendTransferConfirmedTest(env)) });", "        const { sendAfterDeliveryTest } = await import(\"./after-delivery\");\n        return json({ ok: true, ...(await sendAfterDeliveryTest(env)) });"]], T],
  ["تجربة", "the message's trial goes while Baraa's window is closed", [[TR,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["تجربة", "the message's trial goes more than once a day", [[TR,
    "  if (!once.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], T],
  ["تجربة", "the message's trial is not marked «🧪 تجربة»", [[TR,
    "    `${TRANSFER_TEST_MARK} — هكذا تصل العميل رسالة واحدة بعد", "    `هكذا تصل العميل رسالة واحدة بعد"]], T],
  ["تجربة", "the message's trial says samples are real invoices", [[TR,
    "    const rows = real.length === 2 ? real : sampleInvoices(day).slice(0, 2);\n    const res = await sendViaGateway(env, {\n      purpose: TRANSFER_CONFIRMED_TEST_PURPOSE, to: owner, content: textContent(confirmedTestText(rows, real.length === 2)),", "    const rows = real.length === 2 ? real : sampleInvoices(day).slice(0, 2);\n    const res = await sendViaGateway(env, {\n      purpose: TRANSFER_CONFIRMED_TEST_PURPOSE, to: owner, content: textContent(confirmedTestText(rows, true)),"]], T],
  ["تجربة", "the message's trial does not say that nothing was written", [[TR,
    "    \"(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)\",\n  ].join(\"\\n\");\n}\n/**\n * The ONE message of «✅ وصل» for two invoices", "  ].join(\"\\n\");\n}\n/**\n * The ONE message of «✅ وصل» for two invoices"]], T],
  // ---------------------------------------------------------------- the guide
  ["دليل", "the guide does not say what Omar reads after «تحويل 🏦»", [[GUIDE,
    "ويقرأ عمر «تمام، سجّلناه — ينتظر تأكيد وصول المبلغ»", "ويقرأ عمر رداً"]], T],
  ["دليل", "the guide does not say the system stops the repeat", [[GUIDE,
    "**النظام يمنع التكرار:**", "**ملاحظات:**"]], T],
  ["دليل", "the guide does not say a second notice is linked with no second request", [[GUIDE,
    "**يُربط بالأول** بلا طلب تأكيد ثانٍ:", "يُسجَّل:"]], T],
  ["دليل", "the guide does not say one payment or none", [[GUIDE,
    "**دفعة واحدة أو لا شيء** على الفاتورة", "دفعة على الفاتورة"]], T],
  ["دليل", "the guide does not say cash is as it was", [[GUIDE,
    "- **النقد كما هو:** «نقد 💵» يسجّل الدفعة فوراً في عهدة المحصّل.\n", ""]], T],
  ["دليل", "the guide does not carry the customer's ONE message to the letter", [[GUIDE,
    "- بعد «✅ وصل»: رسالة واحدة «استلمنا تحويلك X ريال ✅ وسددنا: فاتورة Y (مبلغ)، فاتورة Z (مبلغ)»", "- بعد «✅ وصل»: رسالة واحدة"]], T],
  ["دليل", "the guide's page is not the one before the transfer notice's", [[GUIDE,
    "## التحويلات: مصدر واحد (§ 58)\n", "## التحويلات: مصدر واحد (§ 58)\n\n## ملاحظات\n"]], T],
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
writeFileSync(new URL("../artifacts/s58-20261005-transfers-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
