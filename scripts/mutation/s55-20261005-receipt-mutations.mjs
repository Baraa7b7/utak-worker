// Mutation check for § 55 د (2026-10-05) — the buyer's receipt of the purchases as a WhatsApp Flow
// (src/receipt-form.ts, utak_receipt_v1): each mutation disables ONE guard, runs
// tests/s55-receipt.test.mts, and must make it fail. The source is restored in `finally` after every
// run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s55-20261005-receipt-mutations.mjs [د …]     (no argument: every part)
//
// Out: scripts/artifacts/s55-20261005-receipt-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s55-receipt.test.mts";
const RC = "src/receipt-form.ts";
const LIB = "scripts/lib/s55-flows.mjs";
const TM = "src/team.ts";
const RT = "src/router.ts";
const IX = "src/index.ts";
const GW = "src/wa-gateway.ts";
const PUR = "src/wa-purposes.ts";
const SPAY = "src/supplier-pay.ts";
const PIV = "src/purchase-invoice.ts";
const META = "src/meta.ts";
const TRIAL = "scripts/s55-20261005-trial.mjs";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- د the Flow at Meta
  ["د", "the Flow has fifteen quantity fields (the worker fills thirty)", [[LIB,
    "export const RECEIPT_SLOTS = 30;", "export const RECEIPT_SLOTS = 15;"]], T],
  ["د", "the worker fills forty slots (the Flow has thirty)", [[RC,
    "export const RECEIPT_FLOW_SLOTS = 30;", "export const RECEIPT_FLOW_SLOTS = 40;"]], T],
  ["د", "the Flow has four cash-market rows", [[LIB,
    "export const RECEIPT_CASH_ROWS = 5;", "export const RECEIPT_CASH_ROWS = 4;"]], T],
  ["د", "the worker reads four cash-market rows (the Flow has five)", [[RC,
    "export const RECEIPT_CASH_ROWS = 5;", "export const RECEIPT_CASH_ROWS = 4;"]], T],
  ["د", "the worker reads ten photos a reply (the Flow's picker takes one)", [[RC,
    "export const RECEIPT_PHOTO_MAX = 1;", "export const RECEIPT_PHOTO_MAX = 10;"]], T],
  ["د", "the photo is not a property of the `complete` payload", [[LIB,
    "    [RECEIPT_PHOTO_NAME]: `\\${form.${RECEIPT_PHOTO_NAME}}`,\n", ""]], T],
  ["د", "the photo travels in the `navigate` payload", [[LIB,
    "name: RECEIPT_CASH_SCREEN }, payload: {} } },", "name: RECEIPT_CASH_SCREEN }, payload: { photo: \"${form.photo}\" } } },"]], T],
  ["د", "the PhotoPicker demands a photo (min-uploaded-photos 1)", [[LIB,
    "\"min-uploaded-photos\": 0,", "\"min-uploaded-photos\": 1,"]], T],
  ["د", "max-uploaded-photos is left to Meta's default (30: refused)", [[LIB,
    "\"max-uploaded-photos\": RECEIPT_PHOTO_MAX, ", ""]], T],
  ["د", "two PhotoPickers on one screen", [[LIB,
    "            receiptPhotoPicker(),\n", "            receiptPhotoPicker(),\n            receiptPhotoPicker(),\n"]], T],
  ["د", "the PhotoPicker sits inside an If", [[LIB,
    "            receiptPhotoPicker(),\n", "            { type: \"If\", condition: cref(\"v1\"), then: [receiptPhotoPicker()], else: [] },\n"]], T],
  ["د", "a quantity field of the Flow is optional", [[LIB,
    "\"input-type\": \"number\", required: `\\${data.v${n}}`,\n", "\"input-type\": \"number\", required: false,\n"]], T],
  ["د", "a quantity field of the Flow does not open on a value", [[LIB,
    "    \"helper-text\": `\\${data.h${n}}`, \"init-value\": `\\${data.i${n}}`, visible: `\\${data.v${n}}`,\n", "    \"helper-text\": `\\${data.h${n}}`, visible: `\\${data.v${n}}`,\n"]], T],
  ["د", "a cash-market field of the Flow is required", [[LIB,
    "\"input-type\": type, required: false,", "\"input-type\": type, required: true,"]], T],
  ["د", "«إرسال» leaves the cash-market rows out of the reply", [[LIB,
    "    ...Object.fromEntries(receiptCashRows().flatMap((k) => RECEIPT_CASH_FIELDS.map(([name]) => [`${name}${k}`, `\\${form.${name}${k}}`]))),\n", ""]], T],
  ["د", "«إرسال» reads the quantities from its own screen (they are on RECEIPT_A)", [[LIB,
    "[`g${n}`, `\\${screen.${RECEIPT_FIRST_SCREEN}.form.g${n}}`]", "[`g${n}`, `\\${form.g${n}}`]"]], T],
  ["د", "the rows' lists read no options", [[LIB,
    "\"data-source\": cref(\"items\") }", "\"data-source\": [] }"]], T],
  ["د", "the price field's label passes Meta's twenty characters", [[LIB,
    "[\"cp\", \"number\", \"السعر المدفوع\",", "[\"cp\", \"number\", \"السعر المدفوع للكرتون\","]], T],
  ["د", "the message opens another Flow", [[RC,
    "            flow_id: RECEIPT_FLOW_ID,", "            flow_id: \"961075853720270\","]], T],
  // ---------------------------------------------------------------- د the button
  ["د", "the session form still carries «تم الشراء ✅»", [[TM,
    "    receiptButton(listId),\n", "    { id: `purchase_done_${listId}`, title: \"تم الشراء ✅\" },\n"]], T],
  ["د", "the Meta template's quick reply is changed to the form's payload", [[TM,
    "      { index: 0, payload: `purchase_done_${listId}` },\n", "      { index: 0, payload: `prc_${listId}` },\n"]], T],
  ["د", "the session text still tells him to tap «تم الشراء»", [[TM,
    "اضغط «${RECEIPT_BUTTON_TITLE}» لما تخلّص وأكّد اللي استلمته", "اضغط \"تم الشراء\" لما تخلّص"]], T],
  ["د", "the router does not read prc_<list>", [[RT,
    "    if (mReceipt) {", "    if (false) {"]], T],
  ["د", "«استلام» is not a command", [[IX,
    "(await import(\"./receipt-form\").then((m) => m.isReceiptCommand(msg.text, teamMember)))", "false"]], T],
  ["د", "«استلام» waits for «بدء الدوام» (after his shift the list could not be confirmed)", [[IX,
    "const reply: RouterReply = await answerReceiptAsk(", "const reply: RouterReply = att.hold ? { text: holdText(att) } : await answerReceiptAsk("]], T],
  ["د", "the form's reply is not routed to its handler", [[IX,
    "} else if ((await import(\"./receipt-form\")).isReceiptFormToken(msg.flow.token ?? \"\")) {", "} else if (false) {"]], T],
  // ---------------------------------------------------------------- د who gets it
  ["د", "any team member gets the form", [[RC,
    "    return m && m.codes.includes(\"warehouse\") ? \"\" : \"not_warehouse\";", "    return m ? \"\" : \"not_warehouse\";"]], T],
  ["د", "the recipient is not checked at all", [[RC,
    "    const problem = await receiptRecipientProblem(env, to);\n    if (problem) return { sent: false, reason: problem };", "    const problem = \"\";\n    if (problem) return { sent: false, reason: problem };"]], T],
  ["د", "a roster that cannot be read lets the form go", [[RC,
    "    return \"unverified\";", "    return \"\";"]], T],
  ["د", "the form does not check his window itself", [[RC,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const list = opts.test", "  const list = opts.test"]], T],
  ["د", "the form is held for a number outside its window", [[RC,
    "    noHold: true,\n    noHoldReason: \"نموذج استلام المشتريات يُرسل داخل نافذة 24 ساعة فقط\",\n", ""]], T],
  ["د", "a form that did not go leaves its token behind", [[RC,
    "    try { await env.MSG_DEDUP.delete(receiptFormKey(rec.token)); } catch { /* expires on its own */ }\n", ""]], T],
  ["د", "the form goes as a bot reply, not under the team's purpose", [[RC,
    "    purpose: opts.test ? RECEIPT_TEST_PURPOSE : RECEIPT_PURPOSE,", "    purpose: opts.test ? RECEIPT_TEST_PURPOSE : \"bot_reply\","]], T],
  ["د", "the gateway does not know the form's purpose", [[PUR,
    "  purchase_receipt_form: op(\"نموذج استلام المشتريات\"),\n", ""]], T],
  ["د", "a form that cannot go alerts Baraa (an important purpose)", [[PUR,
    "  purchase_receipt_form: op(\"نموذج استلام المشتريات\"),", "  purchase_receipt_form: op(\"نموذج استلام المشتريات\", true),"]], T],
  ["د", "the form of a list already confirmed is sent", [[RC,
    "  if (!opts.test && (list.status === \"done\" || list.status === \"cancelled\")) return { sent: false, reason: list.status };\n", ""]], T],
  ["د", "a form that cannot go leaves him with nothing (no «تم الشراء» of before)", [[RC,
    "    return fallbackReply(listId);\n  } catch (e) {", "    return { text: \"\" };\n  } catch (e) {"]], T],
  ["د", "«استلام» opens a list of any age", [[RC,
    "riyadhDateKey(new Date(now - RECEIPT_OPEN_HOURS * 3600_000))", "\"2000-01-01\""]], T],
  ["د", "«استلام» opens the oldest open list", [[RC,
    "  return ids.length ? Math.max(...ids) : null;", "  return ids.length ? Math.min(...ids) : null;"]], T],
  ["د", "any message that starts with «استلام» is the command", [[RC,
    "  return /^استلام(?: المشتريات)?$/.test(t);", "  return /^استلام/.test(t);"]], T],
  ["د", "«إستلام» is not read", [[RC,
    "    .replace(/[أإآ]/g, \"ا\")\n", ""]], T],
  ["د", "another member's «استلام» is the buyer's command", [[RC,
    "): boolean => wantsReceiptForm(text) && isReceiptMember(m);", "): boolean => wantsReceiptForm(text);"]], T],
  // ---------------------------------------------------------------- د what the form shows
  ["د", "a field does not open on the quantity ordered", [[RC,
    "    data[`i${n}`] = it ? init[n] ?? qty(it.ordered) : \"\";", "    data[`i${n}`] = it ? init[n] ?? \"\" : \"\";"]], T],
  ["د", "the hint drops «المطلوب N»", [[RC,
    "[clean(packaging), `المطلوب ${qty(ordered)}`, clean(supplier)]", "[clean(packaging), clean(supplier)]"]], T],
  ["د", "the hint drops the supplier's name", [[RC,
    "[clean(packaging), `المطلوب ${qty(ordered)}`, clean(supplier)]", "[clean(packaging), `المطلوب ${qty(ordered)}`]"]], T],
  ["د", "the hint carries the list's purchase price", [[RC,
    "...receiptSlotTexts(it.product_name, it.packaging_name, ordered, supplier), ordered, supplier };", "...receiptSlotTexts(it.product_name, it.packaging_name, ordered, `${supplier} ${it.unit_price}`), ordered, supplier };"]], T],
  ["د", "a long name is not cut to Meta's twenty characters", [[RC,
    "    label: cut(clean(product), RECEIPT_LABEL_MAX),", "    label: clean(product),"]], T],
  ["د", "a long hint is not cut to Meta's eighty characters", [[RC,
    ".filter(Boolean).join(\" · \"), RECEIPT_HINT_MAX),", ".filter(Boolean).join(\" · \"), 400),"]], T],
  ["د", "a long option is not cut to Meta's thirty characters", [[RC,
    "` — ${clean(packaging)}` : \"\"}`, RECEIPT_OPTION_MAX), name:", "` — ${clean(packaging)}` : \"\"}`, 400), name:"]], T],
  ["د", "more than two hundred options are sent", [[RC,
    "  return [...out.values()].slice(0, RECEIPT_CATALOG_MAX);", "  return [...out.values()];"]], T],
  ["د", "the list's own items are not among the rows' options", [[RC,
    "  for (const it of items) if (!it.special_line) out.set(itemKey(it.product_id, it.packaging_id), option(it.product_id, it.packaging_id, it.product_name, it.packaging_name));\n", ""]], T],
  ["د", "the active items are not among the rows' options", [[RC,
    "    for (const a of await readActiveItems(env, [])) {", "    for (const a of [] as Awaited<ReturnType<typeof readActiveItems>>) {"]], T],
  ["د", "the lines beyond the thirtieth are not named", [[RC,
    "  return { shown, rest: items.slice(RECEIPT_FLOW_SLOTS).map((it) => itemName(it.product_name, it.packaging_name)) };", "  return { shown, rest: [] };"]], T],
  ["د", "a line the market won is named by its usual supplier", [[RC,
    "  return (it) => (!it.special_line && market.has(itemKey(it.product_id, it.packaging_id)) ? cashName : names.get(idOf(it)) ?? \"\");", "  return (it) => names.get(idOf(it)) ?? \"\";"]], T],
  // ---------------------------------------------------------------- د reading the reply
  ["د", "a reply from another number is read", [[RC,
    "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], T],
  ["د", "an empty quantity field is taken as 0", [[RC,
    "  return typeof n === \"number\" && n <= RECEIPT_QTY_MAX ? n : \"invalid\";", "  return typeof n === \"number\" && n <= RECEIPT_QTY_MAX ? n : 0;"]], T],
  ["د", "a quantity above 9999 is taken", [[RC,
    "  return typeof n === \"number\" && n <= RECEIPT_QTY_MAX ? n : \"invalid\";", "  return typeof n === \"number\" ? n : \"invalid\";"]], T],
  ["د", "a quantity with three decimals is taken", [[RC,
    "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";", "  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";"]], T],
  ["د", "a negative quantity is taken", [[RC,
    "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";", "  if (!/^-?\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";"]], T],
  ["د", "a bad quantity does not refuse the form", [[RC,
    "  const bad = entries.badQty.length > 0 || entries.badRows.length > 0;", "  const bad = entries.badRows.length > 0;"]], T],
  ["د", "an incomplete cash row does not refuse the form", [[RC,
    "  const bad = entries.badQty.length > 0 || entries.badRows.length > 0;", "  const bad = entries.badQty.length > 0;"]], T],
  ["د", "a refused form spends its token", [[RC,
    "    if (bad) {\n      await releaseButton(env, use);\n", "    if (bad) {\n"]], T],
  ["د", "no fresh form after a refusal", [[RC,
    "const again = await sendReceiptForm(env, who, rec.listId, { now: nowMs, init, body: receiptRefusalText(entries, true), ctx }).catch(() => ({ sent: false }));", "const again = { sent: false }; void init;"]], T],
  ["د", "the fresh form forgets the quantities he typed", [[RC,
    "{ now: nowMs, init, body: receiptRefusalText(entries, true), ctx }", "{ now: nowMs, body: receiptRefusalText(entries, true), ctx }"]], T],
  ["د", "the refusal does not name the quantity fields", [[RC,
    "    e.badQty.length ? `• الكمية المستلمة لازم رقم (0 لو ما استلمت الصنف): ${namesWithin(e.badQty.map((i) => i.name), 400)}` : \"\",\n", ""]], T],
  ["د", "the refusal does not name what a cash row lacks", [[RC,
    ": ناقص ${r.missing.join(\"، \")}`),", "`),"]], T],
  ["د", "a cash row without a quantity counts", [[RC,
    "    if (!opt || typeof quantity !== \"number\" || typeof price !== \"number\" || !seller) {", "    if (!opt || typeof price !== \"number\" || !seller) {"]], T],
  ["د", "a cash row without a price counts", [[RC,
    "    if (!opt || typeof quantity !== \"number\" || typeof price !== \"number\" || !seller) {", "    if (!opt || typeof quantity !== \"number\" || !seller) {"]], T],
  ["د", "a cash row without a seller counts", [[RC,
    "    if (!opt || typeof quantity !== \"number\" || typeof price !== \"number\" || !seller) {", "    if (!opt || typeof quantity !== \"number\" || typeof price !== \"number\") {"]], T],
  ["د", "a cash row's item is taken from the client's data, not from the token's options", [[RC,
    "    const opt = rec.catalog.find((o) => o.id === id);", "    const opt = rec.catalog.find((o) => o.id === id) ?? { id, title: id, name: id };"]], T],
  ["د", "a cash row's quantity of 0 counts", [[RC,
    "  return n > 0 && n <= max ? n : \"invalid\";", "  return n >= 0 && n <= max ? n : \"invalid\";"]], T],
  ["د", "a price above the limit is taken", [[RC,
    "  return n > 0 && n <= max ? n : \"invalid\";", "  return n > 0 ? n : \"invalid\";"]], T],
  ["د", "what he typed in a row with no item is lost in silence", [[RC,
    "      if (typed.some(Boolean)) out.loose.push({ row: k, typed: typed.filter(Boolean).join(\" · \") });\n", ""]], T],
  ["د", "a row with no item makes a payment", [[RC,
    "    if (!id) {\n      // a row with no item is no row\n", "    if (false) {\n      // a row with no item is no row\n"]], T],
  // ---------------------------------------------------------------- د the token and the list
  ["د", "a token is read twice", [[RC,
    "  if (!use.claimed || rec.usedAt) {", "  if (false) {"]], T],
  ["د", "a list already confirmed is written again", [[RC,
    "    if (!list || list.status === \"done\" || list.status === \"cancelled\") {", "    if (!list || list.status === \"cancelled\") {"]], T],
  ["د", "a cancelled list is confirmed", [[RC,
    "    if (!list || list.status === \"done\" || list.status === \"cancelled\") {", "    if (!list || list.status === \"done\") {"]], T],
  ["د", "the form does not take the lock of the «تم الشراء» button", [[RC,
    "    lock = await claimButton(env, `purchase_done:${rec.listId}`);", "    lock = await claimButton(env, `purchase_done:${rec.listId}:${Math.random()}`);"]], T],
  ["د", "a list being confirmed by another tap is written anyway", [[RC,
    "    if (!lock.claimed) {", "    if (false) {"]], T],
  ["د", "a failed confirmation keeps the token and the list's lock", [[RC,
    "    if (lock) await releaseButton(env, lock);\n    await releaseButton(env, use);\n    throw e;", "    throw e;"]], T],
  // ---------------------------------------------------------------- د writing
  ["د", "the received quantities are not written (the list stays as ordered)", [[RC,
    "    return { ...it, ordered_quantity: ordered, total_quantity: quantity };", "    return { ...it, ordered_quantity: ordered, total_quantity: ordered };"]], T],
  ["د", "what was ordered is not kept on the line", [[RC,
    "    return { ...it, ordered_quantity: ordered, total_quantity: quantity };", "    return { ...it, total_quantity: quantity };"]], T],
  ["د", "the write drops the line's other keys (its price, its supplier)", [[RC,
    "    return { ...it, ordered_quantity: ordered, total_quantity: quantity };", "    return { product_id: it.product_id, product_name: it.product_name, packaging_id: it.packaging_id, packaging_name: it.packaging_name, order_ids: it.order_ids, ordered_quantity: ordered, total_quantity: quantity };"]], T],
  ["د", "what was ordered is overwritten by an earlier receipt", [[RC,
    "round2(Number(it.ordered_quantity ?? it.total_quantity) || 0);", "round2(Number(it.total_quantity) || 0);"]], T],
  ["د", "a quantity goes to the line at the same place, not to its own item", [[RC,
    "    const quantity = got.get(lineKey(it.product_id, it.packaging_id, it.special_line)) ?? ordered;", "    const quantity = received[items.indexOf(it)]?.quantity ?? ordered;"]], T],
  ["د", "a line beyond the form is written as received 0", [[RC,
    "    const quantity = got.get(lineKey(it.product_id, it.packaging_id, it.special_line)) ?? ordered;", "    const quantity = got.get(lineKey(it.product_id, it.packaging_id, it.special_line)) ?? 0;"]], T],
  ["د", "the list is not confirmed after the receipt", [[RC,
    "    const done = await warehouseConfirmedPurchase(env, rec.listId);", "    const done = { routesDispatched: 0, ordersMoved: 0 }; void warehouseConfirmedPurchase;"]], T],
  ["د", "the list is confirmed BEFORE the received quantities are written (billed and owed as ordered)", [[RC,
    "    lines = await writeReceived(env, list, entries.received);\n", ""], [RC,
    "    routes = done.routesDispatched; moved = done.ordersMoved;\n", "    routes = done.routesDispatched; moved = done.ordersMoved;\n    lines = await writeReceived(env, list, entries.received);\n"]], T],
  ["د", "a line received 0 makes a due line (and a «بلا سعر» alert)", [[SPAY,
    "    if (!(qty > 0)) continue;\n", ""]], T],
  // ---------------------------------------------------------------- د the cash-market rows
  ["د", "no payment is made of the cash rows", [[RC,
    "  const payment = await recordCashRows(env, rec, entries.cash, msg.messageId);", "  const payment = null as CashOutcome; void recordCashRows;"]], T],
  ["د", "the payment is the first row's alone", [[RC,
    "amountH: cashTotalH(rows), member:", "amountH: cashTotalH(rows.slice(0, 1)), member:"]], T],
  ["د", "the amount ignores the quantity", [[RC,
    "const cashH = (r: ReceiptCashRow): number => halalas(r.quantity * r.price);", "const cashH = (r: ReceiptCashRow): number => halalas(r.price);"]], T],
  ["د", "the payment carries no note", [[RC,
    "note: cashPaymentNote(rec.listId, rows), wamid });", "wamid });"]], T],
  ["د", "createTeamPayment drops the note", [[SPAY,
    "    ...(input.note ? { x_note: input.note.slice(0, 4000) } : {}),\n", ""]], T],
  ["د", "createTeamPayment writes a note on every payment (the default changed)", [[SPAY,
    "    ...(input.note ? { x_note: input.note.slice(0, 4000) } : {}),\n", "    x_note: String(input.note ?? \"\").slice(0, 4000),\n"]], T],
  ["د", "the payment does not carry the reply's wamid", [[RC,
    "note: cashPaymentNote(rec.listId, rows), wamid });", "note: cashPaymentNote(rec.listId, rows) });"]], T],
  ["د", "the note drops the seller's name", [[RC,
    " ر.س — البائع: ${r.seller}`;", " ر.س`;"]], T],
  ["د", "the note drops the total", [[RC,
    "...rows.map(cashRowText), `المجموع: ${money(cashTotalH(rows))} ر.س`].join(\"\\n\");", "...rows.map(cashRowText)].join(\"\\n\");"]], T],
  ["د", "a missing «مشتريات السوق النقدية» partner is not told apart", [[RC,
    "    if (!cash) return { failed: `لا شريك «${CASH_MARKET_NAME}»` };\n", ""]], T],
  // ---------------------------------------------------------------- د the photo
  ["د", "the reply's photo is not read", [[RC,
    "loose: [], photos: readReceiptPhotos(values.photo) };", "loose: [], photos: [] };"]], T],
  ["د", "the reply's photo is not kept on the list", [[RC,
    "      if (await storePurchaseInvoiceFile(env, rec.listId, file, { nowMs })) saved++;", "      void storePurchaseInvoiceFile; void file;"]], T],
  ["د", "every photo of a reply is downloaded, whatever the picker takes", [[RC,
    "  const wanted = photos.slice(0, Math.max(1, RECEIPT_PHOTO_MAX));", "  const wanted = photos;"]], T],
  ["د", "no 60-minute window when the form carries no photo", [[RC,
    "  if (awaited) {\n    const { openPurchaseInvoiceWindow }", "  if (false) {\n    const { openPurchaseInvoiceWindow }"]], T],
  ["د", "the photo is asked for again although it was kept", [[RC,
    "  const awaited = saved < Math.max(1, wanted.length);", "  const awaited = true;"]], T],
  ["د", "he is not asked for the photo when none came", [[RC,
    "? `${RECEIPT_PHOTO_FAILED_NOTE} ${PINV_ASK_TEXT}` : PINV_ASK_TEXT;", "? `${RECEIPT_PHOTO_FAILED_NOTE} ${PINV_ASK_TEXT}` : \"\";"]], T],
  ["د", "a photo that could not be kept is not said to have failed", [[RC,
    "? `${RECEIPT_PHOTO_FAILED_NOTE} ${PINV_ASK_TEXT}` : PINV_ASK_TEXT;", "? PINV_ASK_TEXT : PINV_ASK_TEXT;"]], T],
  ["د", "the form's photo overwrites the invoice the list already holds", [[PIV,
    "  if (!list.x_tax_invoice_filename && !list.x_tax_invoice_at) {", "  if (true) {"]], T],
  ["د", "the photo's time is not written on the list", [[PIV,
    "x_tax_invoice_filename: filename, x_tax_invoice_at: toOdooUtc(nowMs) },", "x_tax_invoice_filename: filename },"]], T],
  ["د", "the reply's inbox line shows the photo as [object Object]", [[META,
    "  const filled = Object.values(flow.values).map(shown).filter(Boolean);", "  const filled = Object.values(flow.values).map((v) => String(v ?? \"\").trim()).filter(Boolean); void shown;"]], T],
  // ---------------------------------------------------------------- د the messages
  ["د", "Baraa hears of every receipt", [[RC,
    "): boolean => s.lines.some(isDiff) || s.cash.length > 0 || s.loose.length > 0;", "): boolean => true;"]], T],
  ["د", "Baraa does not hear of a difference", [[RC,
    "): boolean => s.lines.some(isDiff) || s.cash.length > 0 || s.loose.length > 0;", "): boolean => s.cash.length > 0 || s.loose.length > 0;"]], T],
  ["د", "Baraa does not hear of a cash row", [[RC,
    "): boolean => s.lines.some(isDiff) || s.cash.length > 0 || s.loose.length > 0;", "): boolean => s.lines.some(isDiff) || s.loose.length > 0;"]], T],
  ["د", "Baraa does not hear of a row with no item", [[RC,
    "): boolean => s.lines.some(isDiff) || s.cash.length > 0 || s.loose.length > 0;", "): boolean => s.lines.some(isDiff) || s.cash.length > 0;"]], T],
  ["د", "Baraa's message goes under the team's purpose (refused to his number)", [[RC,
    "await sendOwnerMessage(env, p, RECEIPT_OWNER_PURPOSE);", "await sendOwnerMessage(env, p, RECEIPT_PURPOSE);"]], T],
  ["د", "Baraa's message is an ordinary alert, not the team's note", [[RC,
    "export const RECEIPT_OWNER_PURPOSE = \"owner_team_note\";", "export const RECEIPT_OWNER_PURPOSE = \"owner_alert\";"]], T],
  ["د", "Baraa's message drops the supplier of a difference", [[RC,
    "...diffs.map((l) => receivedLineText(l, true)),", "...diffs.map((l) => receivedLineText(l)),"]], T],
  ["د", "Baraa's message drops the cash rows", [[RC,
    "[\"🛒 مشتريات السوق النقدي (كما أدخلها):\", ...s.cash.map(cashRowText),", "[\"🛒 مشتريات السوق النقدي (كما أدخلها):\","]], T],
  ["د", "Baraa is not told where the payment waits", [[RC,
    "? ` — الدفعة ${p.ref} بانتظار اعتمادك في UTAK ← 💵 دفع الموردين.`", "? ` — الدفعة ${p.ref}.`"]], T],
  ["د", "the buyer's message drops the differences", [[RC,
    "[...diffs.map((l) => receivedLineText(l)), same ?", "[same ?"]], T],
  ["د", "the buyer's message drops his cash rows", [[RC,
    "[\"🛒 مشتريات السوق النقدي:\", ...s.cash.map(cashRowText),", "[\"🛒 مشتريات السوق النقدي:\","]], T],
  ["د", "a surplus is reported as a shortfall", [[RC,
    ": l.received < l.ordered ? `ناقص ${qty(l.ordered - l.received)}`", ": true ? `ناقص ${qty(l.ordered - l.received)}`"]], T],
  ["د", "an item received 0 is reported as short, not as not received", [[RC,
    "(l.received === 0 ? \"لم يُستلم\" : l.received", "(false ? \"لم يُستلم\" : l.received"]], T],
  ["د", "the buyer's answer has no «💵 دفعت لمورد»", [[RC,
    "    } else await say(buttonsContent(`${detail}\\n${tail}`, [startButton()]));", "    } else await say(textContent(`${detail}\\n${tail}`));"]], T],
  ["د", "the buyer's answer drops what «تم الشراء» answers (the routes)", [[RC,
    "tail = `${halfDone ? RECEIPT_HALF_TEXT : receiptRoutesLine(routes, moved)}\\n${photoLine}`;", "tail = photoLine;"]], T],
  ["د", "a confirmation that failed after the list was confirmed loses the form (his cash rows, his photo)", [[RC,
    "      if (after?.status !== \"done\") throw e;", "      if (true) throw e;"]], T],
  ["د", "a confirmation that failed before the list was confirmed goes on as if it were", [[RC,
    "      if (after?.status !== \"done\") throw e;", "      if (false) throw e;"]], T],
  ["د", "the buyer is told the routes went when the confirmation did not finish", [[RC,
    "${halfDone ? RECEIPT_HALF_TEXT : receiptRoutesLine(routes, moved)}", "${receiptRoutesLine(routes, moved)}"]], T],
  ["د", "Baraa is not told that the confirmation did not finish", [[RC,
    "  if (halfDone) {\n    const { sendOwnerAlert }", "  if (false) {\n    const { sendOwnerAlert }"]], T],
  ["د", "a receipt longer than 1024 characters is cut (differences lost)", [[RC,
    "    if (detail.length + tail.length + 1 > BODY_MAX) {", "    if (false) {"]], T],
  // ---------------------------------------------------------------- د the trial
  ["د", "the trial's reply is written like a buyer's", [[RC,
    "  if (rec.test) {\n    await say(textContent(receiptTestAnswer(rec, entries)));\n    return { action: \"test\", listId: rec.listId };\n  }\n", ""]], T],
  ["د", "the trial is not marked on its screens", [[RC,
    "  const mark = opts.test ? `${RECEIPT_TEST_MARK} — ` : \"\";", "  const mark = \"\";"]], T],
  ["د", "the trial's message is not marked", [[RC,
    "receiptFormText(list.id, list.day, shown.length, rest, !!opts.test)", "receiptFormText(list.id, list.day, shown.length, rest, false)"]], T],
  ["د", "the trial goes under the team's purpose", [[RC,
    "    purpose: opts.test ? RECEIPT_TEST_PURPOSE : RECEIPT_PURPOSE,", "    purpose: RECEIPT_PURPOSE,"]], T],
  ["د", "the trial's purpose is not the owner's (it may reach any number)", [[GW,
    " \"receipt_form_test\", \"custody_form_test\",", " \"custody_form_test\","]], T],
  ["د", "the gateway does not know the trial's purpose", [[PUR,
    "  receipt_form_test: op(\"تجربة نموذج استلام المشتريات\", false, { hours: 1 }),\n", ""]], T],
  ["د", "the trial script does not know the receipt form", [[TRIAL,
    ", receipt: \"receipt-form-test\"", ""]], T],
  ["د", "the trial goes twice a day", [[RC,
    "claimButton(env, `rcform_test:${RECEIPT_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL)", "claimButton(env, `rcform_test:${RECEIPT_FLOW_ID}:${riyadhDateKey(new Date(now))}:${Math.random()}`, DAY_TTL)"]], T],
  ["د", "the trial ignores his window", [[RC,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""], [RC,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const list = opts.test", "  if (!opts.test && !(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const list = opts.test"]], T],
  ["د", "the trial is built from a simulation list", [[RC,
    "      domain: [[SIM_FIELD, \"!=\", true]], fields: [\"id\"], order: \"id desc\", limit: 5,", "      domain: [], fields: [\"id\"], order: \"id desc\", limit: 5,"]], T],
  ["د", "the trial needs a real list (none on the tenant: nothing to show)", [[RC,
    "    if (!test) {\n      // no real list yet", "    if (false) {\n      // no real list yet"]], T],
  ["د", "the trial's hook is not there", [[IX,
    "url.pathname === \"/odoo/hook/receipt-form-test\"", "url.pathname === \"/odoo/hook/receipt-form-test-x\""]], T],
  ["د", "the trial's hook asks for no token", [[IX,
    "url.pathname === \"/odoo/hook/receipt-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "url.pathname === \"/odoo/hook/receipt-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {\n        void providedToken; void expected;"]], T],
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
writeFileSync(new URL("../artifacts/s55-20261005-receipt-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
