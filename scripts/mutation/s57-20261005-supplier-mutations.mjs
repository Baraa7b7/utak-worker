// Mutation check for § 57 ز (2026-10-05) — the supplier's tax number read from the pictures of his
// invoices and his registration form (src/supplier-vat.ts), its three arrivals (src/index.ts,
// src/receipt-form.ts, src/purchase-invoice.ts, src/expense-form.ts), Claude's prompt (src/config.ts)
// and the Flow's JSON (scripts/lib/s57-supplier-flow.mjs). Each mutation disables ONE guard, runs the
// test file, and must make it fail. The source is restored in `finally` after every run; a pattern
// that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s57-20261005-supplier-mutations.mjs [flow rule reading out picture list expense form reply trial guide …]     (no argument: every part)
//
// Out: scripts/artifacts/s57-20261005-supplier-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s57-supplier-vat.test.mts";
const SV = "src/supplier-vat.ts";
const CL = "src/claude.ts";
const CFG = "src/config.ts";
const VA = "src/vat-ask.ts";
const EF = "src/expense-form.ts";
const RC = "src/receipt-form.ts";
const PI = "src/purchase-invoice.ts";
const IDX = "src/index.ts";
const GW = "src/wa-gateway.ts";
const PU = "src/wa-purposes.ts";
const LIB = "scripts/lib/s57-supplier-flow.mjs";
const GUIDE = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- the Flow at Meta
  ["flow", "the certificate's photo is optional in the Flow", [[LIB,
    "export const SUPPLIER_PHOTO_MIN = 1;", "export const SUPPLIER_PHOTO_MIN = 0;"]], T],
  ["flow", "the Flow takes several photos", [[LIB,
    "export const SUPPLIER_PHOTO_MAX = 1;", "export const SUPPLIER_PHOTO_MAX = 3;"]], T],
  ["flow", "the official name is optional in the Flow", [[LIB,
    "SUPPLIER_LEGAL_HINT, \"text\", true],", "SUPPLIER_LEGAL_HINT, \"text\", false],"]], T],
  ["flow", "the commercial registration takes any text", [[LIB,
    "SUPPLIER_CR_HINT, \"number\", true],", "SUPPLIER_CR_HINT, \"text\", true],"]], T],
  ["flow", "the tax number is optional in the Flow", [[LIB,
    "SUPPLIER_VAT_HINT, \"number\", true],", "SUPPLIER_VAT_HINT, \"number\", false],"]], T],
  ["flow", "the IBAN is required", [[LIB,
    "SUPPLIER_IBAN_HINT, \"text\", false],", "SUPPLIER_IBAN_HINT, \"text\", true],"]], T],
  ["flow", "«إرسال» does not carry the photo", [[LIB,
    "export const SUPPLIER_FIELDS = [\"legal\", \"cr\", \"vat\", SUPPLIER_PHOTO_NAME, \"iban\"];", "export const SUPPLIER_FIELDS = [\"legal\", \"cr\", \"vat\", \"iban\"];"]], T],
  ["flow", "the Flow is exported under another name", [[LIB,
    "export const SUPPLIER_FLOW_NAME = \"utak_supplier_register_v1\";", "export const SUPPLIER_FLOW_NAME = \"utak_supplier_register_v2\";"]], T],
  ["flow", "a hint longer than Meta's eighty characters", [[LIB,
    "export const SUPPLIER_CR_HINT = \"10 أرقام\";", "export const SUPPLIER_CR_HINT = \"رقم السجل التجاري للمنشأة كما هو مكتوب في شهادة السجل التجاري الصادرة من وزارة التجارة: عشرة أرقام\";"]], T],
  ["flow", "the photo's field is pre-filled or required as a text field is", [[LIB,
    "\"max-file-size-kb\": SUPPLIER_PHOTO_MAX_KB,", "\"max-file-size-kb\": SUPPLIER_PHOTO_MAX_KB, required: true,"]], T],
  ["flow", "the worker opens another screen", [[SV,
    "export const SUPPLIER_REGISTER_FLOW_SCREEN = \"SUPPLIER_REGISTER\";", "export const SUPPLIER_REGISTER_FLOW_SCREEN = \"SUPPLIER_B\";"]], T],
  ["flow", "the message's button is longer than Meta's twenty characters", [[SV,
    "export const SUPPLIER_REGISTER_CTA = \"سجّل بياناتك\";", "export const SUPPLIER_REGISTER_CTA = \"سجّل بيانات منشأتك الرسمية\";"]], T],
  ["flow", "the heading is not cut to Meta's eighty characters", [[SV,
    "    t: cut(`${mark}${SUPPLIER_REGISTER_TITLE} — ${who.name}`, SUPPLIER_HEADING_MAX),", "    t: `${mark}${SUPPLIER_REGISTER_TITLE} — ${who.name}`,"]], T],
  ["flow", "the message's text is not cut to 1024", [[SV,
    "        body: { text: cut(text, SUPPLIER_BODY_MAX) },", "        body: { text },"]], T],
  ["flow", "«الاسم الرسمي» does not open on what the caller gave", [[SV,
    "    i_legal: o.init?.legal ?? \"\",", "    i_legal: \"\","]], T],
  ["flow", "the worker sends a key the screen does not have", [[SV,
    "    how: SUPPLIER_REGISTER_HOW_TEXT,\n", "    how: SUPPLIER_REGISTER_HOW_TEXT, note: \"\",\n"]], T],
  // ---------------------------------------------------------------- the rule
  ["rule", "a number that does not end with 3 is a tax number", [[VA,
    "  return /^3\\d{13}3$/.test(s) ? s : null;", "  return /^3\\d{14}$/.test(s) ? s : null;"]], T],
  ["rule", "a number that does not start with 3 is a tax number", [[VA,
    "  return /^3\\d{13}3$/.test(s) ? s : null;", "  return /^\\d{14}3$/.test(s) ? s : null;"]], T],
  ["rule", "a number grouped with dashes is not read", [[SV,
    "  return parseVatNumber(String(raw).replace(/\\p{Pd}/gu, \"\"));", "  return parseVatNumber(String(raw));"]], T],
  ["rule", "what is neither a text nor a number may be a tax number", [[SV,
    "  if (typeof raw !== \"string\" && typeof raw !== \"number\") return null;\n", ""]], T],
  ["rule", "a commercial registration of nine digits is one", [[SV,
    "export const SUPPLIER_CR_DIGITS = 10;", "export const SUPPLIER_CR_DIGITS = 9;"]], T],
  ["rule", "a commercial registration in Arabic-Indic digits is refused", [[SV,
    "  const s = westernDigits(clean(raw, 40)).replace(/[\\s-]/g, \"\");", "  const s = clean(raw, 40).replace(/[\\s-]/g, \"\");"]], T],
  ["rule", "an IBAN that fails mod 97 is kept", [[SV,
    "  return ibanProblem(typed) ? null : typed;", "  return typed;"]], T],
  ["rule", "an IBAN left empty is a wrong IBAN", [[SV,
    "  if (!typed) return \"\";\n", ""]], T],
  ["rule", "a name of two letters, or none, matches", [[SV,
    "export const SUPPLIER_NAME_MIN = 3;", "export const SUPPLIER_NAME_MIN = 0;"]], T],
  ["rule", "the two spellings of a letter are two names", [[SV,
    "    .replace(/[أإآٱ]/g, \"ا\").replace(/ى/g, \"ي\").replace(/ة/g, \"ه\")\n", ""]], T],
  ["rule", "the marks of a name are part of it", [[SV,
    "    .replace(/\\p{Mn}|ـ/gu, \"\")\n", ""]], T],
  ["rule", "a name is compared whole, not one within the other", [[SV,
    "(x.includes(y) || y.includes(x));", "x === y;"]], T],
  // ---------------------------------------------------------------- Claude's reading
  ["reading", "an answer without is_invoice is not «failed»", [[SV,
    "  if (!j || typeof j.is_invoice !== \"boolean\") return { status: \"failed\" };", "  if (!j) return { status: \"failed\" };"]], T],
  ["reading", "a picture that is not an invoice is an invoice with no number", [[SV,
    "  if (!j.is_invoice) return { status: \"not_invoice\" };\n", ""]], T],
  ["reading", "UTAK's own number is taken as the seller's", [[SV,
    "  return vat && vat !== ownVat ? { status: \"valid\"", "  return vat ? { status: \"valid\""]], T],
  ["reading", "the reading is decided without UTAK's own number", [[SV,
    "SYSTEM_PROMPT_READ_SUPPLIER_INVOICE, ask), ownVat);", "SYSTEM_PROMPT_READ_SUPPLIER_INVOICE, ask));"]], T],
  ["reading", "UTAK's own number is not read from the company", [[SV,
    "  return validVat(c?.vat || \"\") ?? \"\";", "  return \"\";"]], T],
  ["reading", "the question does not name the buyer's number", [[SV,
    "${ownVat ? ` UTAK's own VAT number is ${ownVat}: it is the buyer's, never the answer.` : \"\"}", ""]], T],
  ["reading", "the prompt does not forbid the buyer's number", [[CFG,
    "- NEVER the buyer's number. UTAK (يوتاك) is the BUYER on these invoices and its own VAT number may be printed on them as the customer's: it is never the answer. A number you cannot tell to be the seller's is null.\n", ""]], T],
  ["reading", "the prompt lets a digit be guessed", [[CFG,
    "never compute, complete, correct or guess a digit.", "complete a digit you cannot read."]], T],
  ["reading", "the prompt answers with other keys", [[CFG,
    "\"supplier_name\": \"<string>\"|null, \"invoice_number\"", "\"seller\": \"<string>\"|null, \"invoice_number\""]], T],
  ["reading", "the picture is read under another prompt", [[SV,
    "readDocumentJson(env, file, SYSTEM_PROMPT_READ_SUPPLIER_INVOICE, ask)", "readDocumentJson(env, file, \"Read the invoice.\", ask)"]], T],
  ["reading", "a PDF is not a picture", [[CL,
    "  return READ_IMAGE_TYPES.has(m) || m === READ_PDF_TYPE;", "  return READ_IMAGE_TYPES.has(m);"]], T],
  ["reading", "a name that was not read is the name «null»", [[SV,
    "  (typeof v === \"string\" || typeof v === \"number\" ? String(v) : \"\").replace(", "  String(v).replace("]], T],
  // ---------------------------------------------------------------- who is out
  ["out", "the pictures of a price source that is not a supplier are read", [[SV,
    "  if (c.source && !c.supplier) return true;\n", ""]], T],
  ["out", "a team member's own card is read for", [[SV,
    "  if (memberByPartner(roster, c.id)) return true;\n", ""]], T],
  ["out", "a card with Baraa's own number is read for", [[SV,
    "  if (isOwnerRecipient(env, c.whatsapp)) return true;\n", ""]], T],
  ["out", "«مشتريات السوق النقدية» is read for, and given a number", [[SV,
    "  return c.ref === CASH_MARKET_REF;", "  return false;"]], T],
  ["out", "the picture is fetched and read before knowing whose it may be", [[SV,
    "    if (!cards.length) return { action: \"out\" };\n", ""]], T],
  // ---------------------------------------------------------------- a picture arrives
  ["picture", "the same picture is read twice", [[SV,
    "    if (!claim.claimed) return { action: \"seen\" };\n", ""]], T],
  ["picture", "a picture that was not fetched is never read later", [[SV,
    "    if (!file) { await releaseButton(env, claim); return { action: \"no_file\" }; }", "    if (!file) return { action: \"no_file\" };"]], T],
  ["picture", "a picture that was not fetched counts as one that was not read", [[SV,
    "    if (!file) { await releaseButton(env, claim); return { action: \"no_file\" }; }", "    if (!file) return await offerRegisterForm(env, cards[0], { now, ctx: p.ctx, where: p.where });"]], T],
  ["picture", "a sheet is «a picture that was not read»", [[SV,
    "    if (!canReadDocument(file.mime)) return { action: \"not_picture\" };\n", ""]], T],
  ["picture", "a failure throws into the picture's own path", [[SV,
    "    console.warn(`[supplier-vat] ${p.where}: the picture was not handled`, (e as Error)?.message);\n    return { action: \"error\" };", "    throw e;"]], T],
  ["picture", "a supplier's own picture is checked against the name printed on it", [[SV,
    "    const card = p.kind === \"chat\" ? cards[0] : whose(", "    const card = whose("]], T],
  ["picture", "with no name read, the first of several suppliers is taken", [[SV,
    "  if (!nameRead) return cards.length === 1 ? cards[0] : null;", "  if (!nameRead) return cards[0] ?? null;"]], T],
  ["picture", "a name read that is nobody's is ignored: the only supplier is taken", [[SV,
    "  return named.length === 1 ? named[0] : null;", "  return named.length === 1 ? named[0] : cards.length === 1 ? cards[0] : null;"]], T],
  ["picture", "a name that is two suppliers' takes the first", [[SV,
    "  return named.length === 1 ? named[0] : null;", "  return named[0] ?? null;"]], T],
  ["picture", "his card's official name is not compared", [[SV,
    " || sameSupplierName(c.legal, nameRead));", ");"]], T],
  ["picture", "an expense's picture that is nobody's alerts Baraa", [[SV,
    "      if (reading.status === \"valid\" && p.kind === \"list\") {", "      if (reading.status === \"valid\") {"]], T],
  ["picture", "an unread picture of several suppliers alerts Baraa", [[SV,
    "      if (reading.status === \"valid\" && p.kind === \"list\") {", "      if (p.kind === \"list\") {"]], T],
  ["picture", "a number that is nobody's is said for every page", [[SV,
    "        if (told.claimed) { await tellOwner(env, vatUnmatchedText(", "        if (true) { await tellOwner(env, vatUnmatchedText("]], T],
  ["picture", "nothing is said of a number that is nobody's", [[SV,
    "await tellOwner(env, vatUnmatchedText(reading.vat, reading.name, cards.map((c) => c.name), from, p.where)); ", ""]], T],
  ["picture", "a number on his card is replaced", [[SV,
    "  if (!card.vat) {\n    await call(env, \"res.partner\", \"write\", { ids: [card.id], vals: registeredVals(vat) });", "  if (true) {\n    await call(env, \"res.partner\", \"write\", { ids: [card.id], vals: registeredVals(vat) });"]], T],
  ["picture", "the number is not written", [[SV,
    "    await call(env, \"res.partner\", \"write\", { ids: [card.id], vals: registeredVals(vat) });\n", ""]], T],
  ["picture", "the card is not marked «مسجّل»", [[SV,
    "({ vat, x_vat_registered: true, x_vat_status: \"registered\" });", "({ vat, x_vat_registered: true });"]], T],
  ["picture", "the card is not marked «مسجل في الضريبة»", [[SV,
    "({ vat, x_vat_registered: true, x_vat_status: \"registered\" });", "({ vat, x_vat_status: \"registered\" });"]], T],
  ["picture", "Baraa is not told of a number written", [[SV,
    "    await tellOwner(env, vatRegisteredText(card.name, vat, from));\n", ""]], T],
  ["picture", "Baraa's line is worded otherwise", [[SV,
    "— فواتيره من الآن عليها 15%`;", "— تُضاف الضريبة على فواتيره`;"]], T],
  ["picture", "an invoice whose number was not read is not named by its day", [[SV,
    "`فاتورة ${invoice || `صورة ${arabicDate(day)}`}`;", "`فاتورة ${invoice}`;"]], T],
  ["picture", "the number that is his is said to Baraa as another", [[SV,
    "  if (cardDigits(card.vat) === vat) return { action: \"same\", partnerId: card.id, vat };\n", ""]], T],
  ["picture", "a number grouped on his card is another number", [[SV,
    "  if (cardDigits(card.vat) === vat) return", "  if (card.vat === vat) return"]], T],
  ["picture", "the same mismatch is said for every page", [[SV,
    "  if (told.claimed) { await tellOwner(env, vatMismatchText(", "  if (true) { await tellOwner(env, vatMismatchText("]], T],
  ["picture", "a mismatch is not said", [[SV,
    "await tellOwner(env, vatMismatchText(card.name, card.vat, vat, from, where)); ", ""]], T],
  ["picture", "the mismatch does not say where the picture is", [[SV,
    "    ...(where ? [`الصورة: ${where}`] : []),\n", ""]], T],
  ["picture", "a supplier's picture is not read", [[IDX,
    "        if (msg.type === \"image\" || msg.type === \"document\") {\n          const { supplierSentPicture }", "        if (false) {\n          const { supplierSentPicture }"]], T],
  ["picture", "a supplier's voice note is read as a picture", [[IDX,
    "        if (msg.type === \"image\" || msg.type === \"document\") {\n          const { supplierSentPicture }", "        if (true) {\n          const { supplierSentPicture }"]], T],
  // ---------------------------------------------------------------- the purchase list's invoice
  ["list", "a simulation's list is read", [[SV,
    "  if (!row || row.x_utak_simulation === true) return [];", "  if (!row) return [];"]], T],
  ["list", "the list's own supplier is not one of its suppliers", [[SV,
    "  return [Array.isArray(row.x_supplier_id) ? row.x_supplier_id[0] : 0, ...lines];", "  return lines;"]], T],
  ["list", "the lines' suppliers are not the list's", [[SV,
    "  return [Array.isArray(row.x_supplier_id) ? row.x_supplier_id[0] : 0, ...lines];", "  return [Array.isArray(row.x_supplier_id) ? row.x_supplier_id[0] : 0];"]], T],
  ["list", "lines that cannot be read lose the list's own supplier", [[SV,
    "} catch { lines = []; }", "} catch (e) { throw e; }"]], T],
  ["list", "a list that cannot be read throws into the buyer's answer", [[SV,
    "    console.warn(`[supplier-vat] list ${listId}: its suppliers could not be read`, (e as Error)?.message);\n    return { action: \"error\" };", "    throw e;"]], T],
  ["list", "the receipt form's photo is not kept for the reading", [[RC,
    "      kept.push({ id: p.id, file });\n", ""]], T],
  ["list", "the receipt form reads nothing", [[RC,
    "  for (const k of photo.kept) await (await import(\"./supplier-vat\")).readListInvoice(env, rec.listId, { id: k.id }, k.file, ctx);\n", ""]], T],
  ["list", "the receipt form's photo is downloaded again for the reading", [[RC,
    "readListInvoice(env, rec.listId, { id: k.id }, k.file, ctx);", "readListInvoice(env, rec.listId, { id: k.id }, null as never, ctx);"]], T],
  ["list", "the buyer's photo after «تم الشراء» is not read", [[PI,
    "  await readListInvoice(env, p.listId, { id: media.id }, file);\n", ""]], T],
  ["list", "a purchase price is read with the list's suppliers", [[SV,
    "  // a simulation's list is test data: nothing real is written from its picture\n", "  await call(env, \"x_daily_price\", \"search_read\", { domain: [], fields: [\"x_price_sar\"], limit: 1 });\n"]], T],
  // ---------------------------------------------------------------- the expense's attachment
  ["expense", "the expense's attachment is not read", [[EF,
    "  await readExpenseInvoice(env, a);\n", ""]], T],
  ["expense", "an expense's picture that was not read sends the form", [[SV,
    "    if (card.vat || p.kind === \"expense\") return { action: \"unread\", partnerId: card.id };", "    if (card.vat) return { action: \"unread\", partnerId: card.id };"]], T],
  ["expense", "the expense's picture is read for another partner than the bill's", [[SV,
    "kind: \"expense\", partnerIds: [a.partnerId],", "kind: \"expense\", partnerIds: [a.moveId],"]], T],
  // ---------------------------------------------------------------- the form, once ever
  ["form", "a supplier who has a number is sent the form for a picture that was not read", [[SV,
    "    if (card.vat || p.kind === \"expense\") return { action: \"unread\", partnerId: card.id };", "    if (p.kind === \"expense\") return { action: \"unread\", partnerId: card.id };"]], T],
  ["form", "a supplier already asked is asked again", [[SV,
    "  if (card.asked >= 1 || card.notRegistered) return", "  if (card.notRegistered) return"]], T],
  ["form", "a supplier whose card says «غير مسجّل» is asked", [[SV,
    "  if (card.asked >= 1 || card.notRegistered) return", "  if (card.asked >= 1) return"]], T],
  ["form", "a supplier with no number is not said to Baraa", [[SV,
    "await tellOwner(env, vatNoNumberText(card.name, o.where)); ", ""]], T],
  ["form", "a supplier with no number is said for every picture", [[SV,
    "    if (told.claimed) { await tellOwner(env, vatNoNumberText(", "    if (true) { await tellOwner(env, vatNoNumberText("]], T],
  ["form", "two pictures at once send two forms", [[SV,
    "  if (!once.claimed) return { action: \"asked_before\", partnerId: card.id };\n", ""]], T],
  ["form", "a form that did not go blocks the next one", [[SV,
    "  if (!r.sent) {\n    await releaseButton(env, once);", "  if (!r.sent) {"]], T],
  ["form", "a form Meta refused is owed, and retried with every message", [[SV,
    "    if (r.reason !== \"window_closed\") return { action: \"form_failed\", partnerId: card.id };\n", ""]], T],
  ["form", "a form his window was closed for is forgotten", [[SV,
    "    await env.MSG_DEDUP.put(supplierOwedKey(to), JSON.stringify({ partnerId: card.id, where: o.where } satisfies SupplierOwed), { expirationTtl: MEDIA_TTL });\n", ""]], T],
  ["form", "his card does not count the form", [[SV,
    "vals: { x_vat_ask_count: 1 } }); } catch (e) {", "vals: {} }); } catch (e) {"]], T],
  ["form", "the form is tried outside his window", [[SV,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["form", "the form may be held", [[SV,
    "    noHold: true,\n    noHoldReason: \"نموذج تسجيل المورد يُرسل داخل نافذة 24 ساعة فقط\",\n", ""]], T],
  ["form", "the form opens on his card's display name though it has an official one", [[SV,
    "init: { legal: card.legal || card.name } });", "init: { legal: card.name } });"]], T],
  ["form", "the owed form goes though his card has a number now", [[SV,
    "card?.vat === \"\" ? await offerRegisterForm(", "card ? await offerRegisterForm("]], T],
  ["form", "a form that went stays owed", [[SV,
    "    if (r.action !== \"form_owed\") await env.MSG_DEDUP.delete(key);\n", ""]], T],
  ["form", "a form still owed is forgotten", [[SV,
    "    if (r.action !== \"form_owed\") await env.MSG_DEDUP.delete(key);", "    await env.MSG_DEDUP.delete(key);"]], T],
  ["form", "the owed form does not go with his first message", [[IDX,
    "    if (supplierMatch && msg.type !== \"image\" && msg.type !== \"document\") {", "    if (false) {"]], T],
  ["form", "the owed form goes before his picture is read", [[IDX,
    "    if (supplierMatch && msg.type !== \"image\" && msg.type !== \"document\") {", "    if (supplierMatch) {"]], T],
  ["form", "the owed form does not follow a picture of his that is not an invoice", [[SV,
    "  await sendOwedSupplierRegisterForm(env, from, ctx);\n", ""]], T],
  // ---------------------------------------------------------------- «إرسال»
  ["reply", "a token sent to another number is read", [[SV,
    "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], T],
  ["reply", "a token is read twice", [[SV,
    "  if (!claim.claimed) {\n    console.warn(`[supplier-vat] repeated token", "  if (false) {\n    console.warn(`[supplier-vat] repeated token"]], T],
  ["reply", "an empty official name is kept", [[SV,
    "...(/\\p{L}/u.test(typed.legal) ? [] : [\"legal\" as const]), ", ""]], T],
  ["reply", "a commercial registration that is not ten digits is kept", [[SV,
    "...(cr ? [] : [\"cr\" as const]), ", ""]], T],
  ["reply", "a tax number that is not one is kept", [[SV,
    "...(vat ? [] : [\"vat\" as const]), ", ""]], T],
  ["reply", "a form with no certificate is kept", [[SV,
    ", ...(photo ? [] : [\"photo\" as const]),", ","]], T],
  ["reply", "a refused form sends no fresh form", [[SV,
    "      const again = await sendSupplierRegisterForm(env, { partnerId: rec.partnerId, name: rec.name, whatsapp: to }, { now: nowMs, ctx, body: text, init: f.typed, test: rec.test }).catch(() => ({ sent: false }));", "      const again = { sent: false };"]], T],
  ["reply", "the fresh form opens empty", [[SV,
    "body: text, init: f.typed, test: rec.test }", "body: text, test: rec.test }"]], T],
  ["reply", "a refused form that could not be sent again says nothing", [[SV,
    "      if (!again.sent) await say(text);\n", ""]], T],
  ["reply", "the form's number replaces the one on his card", [[SV,
    "    const number: NumberCase = !card.vat ? \"new\" : cardDigits(card.vat) === f.vat ? \"same\" : \"other\";", "    const number: NumberCase = \"new\";"]], T],
  ["reply", "the number that is his is «another» number", [[SV,
    "    const number: NumberCase = !card.vat ? \"new\" : cardDigits(card.vat) === f.vat ? \"same\" : \"other\";", "    const number: NumberCase = !card.vat ? \"new\" : \"other\";"]], T],
  ["reply", "the form's number is not written on a card that has none", [[SV,
    "...(number === \"new\" ? registeredVals(f.vat) : {}), ", ""]], T],
  ["reply", "the official name is not written", [[SV,
    "vals: { x_legal_name: f.legal, x_cr_number: f.cr, ", "vals: { x_cr_number: f.cr, "]], T],
  ["reply", "the commercial registration is not written", [[SV,
    "vals: { x_legal_name: f.legal, x_cr_number: f.cr, ", "vals: { x_legal_name: f.legal, "]], T],
  ["reply", "an IBAN that is not valid is written", [[SV,
    "...(f.iban ? { x_iban: f.iban } : {}) },", "...(f.typed.iban ? { x_iban: f.typed.iban } : {}) },"]], T],
  ["reply", "a valid IBAN is not written", [[SV,
    ", ...(f.iban ? { x_iban: f.iban } : {}) },", " },"]], T],
  ["reply", "the certificate is not attached", [[SV,
    "    const certificate = await keepCertificate(env, card.id, f);", "    const certificate = true; void keepCertificate;"]], T],
  ["reply", "the certificate is attached with no note in his card's log", [[SV,
    "    await call(env, \"res.partner\", \"message_post\", ", "    void ("]], T],
  ["reply", "the certificate is attached to nothing", [[SV,
    "res_model: \"res.partner\", res_id: partnerId }] });", "res_model: \"res.partner\" }] });"]], T],
  ["reply", "a certificate that was not fetched throws into the answer", [[SV,
    "  if (!file) return false;\n  try {", "  try {"]], T],
  ["reply", "a certificate Odoo refused throws into the answer", [[SV,
    "    console.warn(`[supplier-vat] partner=${partnerId}: the certificate was not kept`, (e as Error)?.message);\n    return false;", "    throw e;"]], T],
  ["reply", "the supplier is not answered", [[SV,
    "    await say(supplierDoneText(f, { number, certificate }));\n", ""]], T],
  ["reply", "Baraa gets no summary", [[SV,
    "    await tellOwner(env, supplierOwnerText(card.name, f, { number, have: card.vat, certificate }));\n", ""]], T],
  ["reply", "a write Odoo refused spends the token", [[SV,
    "  } catch (e) {\n    await releaseButton(env, claim);\n    throw e;\n  }\n}\n\n// ---------------------------------------------------------------- the trial to Baraa", "  } catch (e) {\n    throw e;\n  }\n}\n\n// ---------------------------------------------------------------- the trial to Baraa"]], T],
  ["reply", "the wrong IBAN is not said to the supplier", [[SV,
    " : f.iban === null ? [SUPPLIER_BAD_IBAN_TEXT] : []),", " : []),"]], T],
  ["reply", "the wrong IBAN is not said to Baraa", [[SV,
    " : f.iban === null ? [`⚠️ الآيبان اللي كتبه غير صحيح ولم يُحفظ: ${f.typed.iban}`] : []),", " : []),"]], T],
  ["reply", "the supplier is shown a number as kept when it was not", [[SV,
    "    o.number === \"other\" ? SUPPLIER_OTHER_NUMBER_TEXT : `• الرقم الضريبي: ${f.vat}`,", "    `• الرقم الضريبي: ${f.vat}`,"]], T],
  ["reply", "Baraa's line does not say «من نموذج التسجيل»", [[SV,
    "export const FROM_FORM = \"نموذج التسجيل\";", "export const FROM_FORM = \"النموذج\";"]], T],
  ["reply", "the form's reply is read as prices", [[IDX,
    "} else if ((await import(\"./supplier-vat\")).isSupplierRegisterToken(msg.flow.token ?? \"\")) {", "} else if (false) {"]], T],
  // ---------------------------------------------------------------- the trial, the purposes
  ["trial", "the trial goes more than once a day", [[SV,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], T],
  ["trial", "a trial that did not go spends the day", [[SV,
    "    if (!r.sent) { await releaseButton(env, claim); return r; }", "    if (!r.sent) return r;"]], T],
  ["trial", "the trial is not marked «🧪 تجربة»", [[SV,
    "  const mark = opts.test ? `${SUPPLIER_REGISTER_TEST_MARK} — ` : \"\";\n  const res = await sendViaGateway(env, {", "  const mark = \"\";\n  const res = await sendViaGateway(env, {"]], T],
  ["trial", "the trial's heading is not marked", [[SV,
    "  const mark = o.test ? `${SUPPLIER_REGISTER_TEST_MARK} — ` : \"\";\n  return {\n    t: cut(", "  const mark = \"\";\n  return {\n    t: cut("]], T],
  ["trial", "the trial is sent under the supplier's purpose", [[SV,
    "    purpose: opts.test ? SUPPLIER_REGISTER_TEST_PURPOSE : SUPPLIER_REGISTER_PURPOSE,", "    purpose: SUPPLIER_REGISTER_PURPOSE,"]], T],
  ["trial", "the trial's answers are sent under the supplier's purpose", [[SV,
    "  const purpose = isOwnerRecipient(env, to) ? SUPPLIER_REGISTER_TEST_PURPOSE : SUPPLIER_REGISTER_PURPOSE;", "  const purpose = SUPPLIER_REGISTER_PURPOSE;"]], T],
  ["trial", "the trial's «إرسال» is written as a supplier's", [[SV,
    "    if (rec.test) {\n      await finishButton(env, claim, TOKEN_TTL);\n      await say(supplierTrialText(f));", "    if (false) {\n      await finishButton(env, claim, TOKEN_TTL);\n      await say(supplierTrialText(f));"]], T],
  ["trial", "the refusal's fresh trial form is a supplier's", [[SV,
    "init: f.typed, test: rec.test }", "init: f.typed }"]], T],
  ["trial", "the trial's hook asks for no token", [[IDX,
    "url.pathname === \"/odoo/hook/supplier-register-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "url.pathname === \"/odoo/hook/supplier-register-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {"]], T],
  ["trial", "the trial's purpose is not among the owner's", [[GW,
    " \"expense_form_test\", \"supplier_register_form_test\",", " \"expense_form_test\","]], T],
  ["trial", "the supplier's form is «important» (Baraa alerted for one that is not sent)", [[PU,
    "supplier_register_form: { label: \"نموذج تسجيل المورد\", kind: \"reply\", important: false,", "supplier_register_form: { label: \"نموذج تسجيل المورد\", kind: \"reply\", important: true,"]], T],
  // ---------------------------------------------------------------- the guide
  ["guide", "the guide does not carry Baraa's line", [[GUIDE,
    "«سجّلنا الرقم الضريبي لـ [المورد]: [الرقم] من فاتورة [رقمها] — فواتيره من الآن عليها 15%»", "رسالة بتسجيل الرقم"]], T],
  ["guide", "the guide does not say the form waits for his first message", [[GUIDE,
    "ينتظر النموذج **أول رسالة منه** (لا قالب).", "يصله قالب."]], T],
  ["guide", "the guide says a wrong IBAN refuses the form", [[GUIDE,
    "**لا يُحفظ ولا يُرفض النموذج بسببه**", "يُرفض النموذج بسببه"]], T],
  ["guide", "the guide's section is not before «فاتورة الشراء»", [[GUIDE,
    "## الرقم الضريبي للمورد آلياً، ونموذج تسجيل المورد (§ 57)\n", "## الرقم الضريبي للمورد\n"]], T],
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
writeFileSync(new URL("../artifacts/s57-20261005-supplier-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
