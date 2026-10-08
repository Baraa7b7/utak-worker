// Mutation check for § 65 (2026-10-07) — the suppliers' registry (س: src/supplier-registry.ts, src/supplier-catalog.ts,
// src/price-privacy.ts, the hook's route, scripts/lib/s65-odoo.mjs), the supplier's own offer (ع: src/supplier-offer.ts),
// the price forms (د: «المقاس» and «المنشأ» in src/price-flow.ts, «➕ صنف إضافي» in src/price-extra.ts, the approved market
// sources, the 02:00 ask's guard, the trial) and the periodic check-in with the cards' numbers (هـ: src/supplier-outreach.ts).
// Each mutation disables ONE guard, runs the test file named with it, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ and scripts/lib/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s65-20261007-mutations.mjs [س ع د هـ]     (no argument: every part)
//
// Out: scripts/artifacts/s65-20261007-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TR = "tests/s65-registry.test.mts", TO = "tests/s65-offer.test.mts", TP = "tests/s65-prices.test.mts", TU = "tests/s65-outreach.test.mts";
const REG = "src/supplier-registry.ts", CAT = "src/supplier-catalog.ts", OFF = "src/supplier-offer.ts", EX = "src/price-extra.ts", PF = "src/price-flow.ts", PS = "src/price-sources.ts";
const OD = "src/odoo.ts", PP = "src/price-privacy.ts", OUT = "src/supplier-outreach.ts", IDX = "src/index.ts", TRI = "src/s65-trials.ts", WP = "src/wa-purposes.ts", GW = "src/wa-gateway.ts";
const LIBO = "scripts/lib/s65-odoo.mjs", LIBF = "scripts/lib/s65-flows.mjs";
const CLOSED = "domain: [\"|\", \"|\", [\"x_price_source\", \"=\", true], [\"supplier_rank\", \">\", 0], [\"x_supplier_state\", \"!=\", false]],";
const TARGETS = "...src.partners.filter((p) => p.approved && (!p.supplier || (p.role === \"market\" && !p.purchaseAsked)) && !emp.has(p.partnerId))";
const DUE_SQL = "[SIM_FIELD, \"!=\", true], \"|\", [\"x_next_contact\", \"=\", false], [\"x_next_contact\", \"<=\", day]],";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- س — the registry
  ["س", "any message that mentions a supplier is the keyword", [[REG, "export const isSignupKeyword = (text: string): boolean => SIGNUP_RE.test(plain(text));", "export const isSignupKeyword = (text: string): boolean => /مورد/.test(plain(text));"]], TR],
  ["س", "a team member may register", [[REG, "if (!isSignupKeyword(msg.text) || who.team || isOwnerRecipient(env, msg.from)) return false;", "if (!isSignupKeyword(msg.text) || isOwnerRecipient(env, msg.from)) return false;"]], TR],
  ["س", "a registered customer may register", [[REG, "  if (isCustomerCard(card)) return false;\n", ""]], TR],
  ["س", "a supplier «موقوف» gets the form", [[REG, "  if (card?.state === \"suspended\") return false;\n", ""]], TR],
  ["س", "a form without a type is taken", [[REG, "  if (!type) problems.push(\"type\");\n", ""]], TR],
  ["س", "a form without a trade name is taken", [[REG, "  if (!trade || !/[\\p{L}\\p{N}]/u.test(trade)) problems.push(\"trade\");\n", ""]], TR],
  ["س", "a refused form is written all the same", [[REG, "  if (p.problems.length) {\n    const again = await sendSignupForm(", "  if (false) {\n    const again = await sendSignupForm("]], TR],
  ["س", "the type «مورد مصاريف» can be chosen from the form", [[REG, "export const SIGNUP_TYPES = [\"farmer\", \"importer\", \"market_agent\", \"wholesaler\", \"distributor\", \"other\"] as const;", "export const SIGNUP_TYPES = [\"farmer\", \"importer\", \"market_agent\", \"wholesaler\", \"distributor\", \"other\", \"expense\"] as const;"]], TR],
  ["س", "a card that carries a state is made «بانتظار الاعتماد» again", [[REG, "    ...(card?.state ? {} : { [STATE_FIELD]: \"pending\" }),", "    ...({ [STATE_FIELD]: \"pending\" }),"]], TR],
  ["س", "a supplier's name is overwritten by what he typed", [[REG, "    ...(known ? {} : { name: p.trade }),", "    ...({ name: p.trade }),"]], TR],
  ["س", "his items replace «الأصناف التي يوفرها»", [[REG, "{ x_supplied_product_ids: productIds.map((id) => [4, id]) }", "{ x_supplied_product_ids: [[6, 0, productIds]] }"]], TR],
  ["س", "what the catalog does not name is dropped", [[REG, "    x_supplier_items_text: unmatched.join(\"، \") || false,", "    x_supplier_items_text: false,"]], TR],
  ["س", "the countries are not matched", [[REG, "    ...(countries.length ? { x_origin_country_ids: countries.map((id) => [4, id]) } : {}),\n", ""]], TR],
  ["س", "the shop is not kept with the location", [[REG, "  const location = [p.location, p.shop].filter(Boolean).join(\" — \");\n  const detail", "  const location = p.location;\n  const detail"]], TR],
  ["س", "the days of «آجل» are not kept", [[REG, "    ...(p.pay === \"credit\" && p.payDays ? { x_pay_days: p.payDays } : {}),\n", ""]], TR],
  ["س", "a number not reviewed yet stays a customer", [[REG, " ? {} : { customer_rank: 0 }) } });", " ? {} : {}) } });"]], TR],
  ["س", "a token is read by any number", [[REG, "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], TR],
  ["س", "a token is read twice", [[REG, "  if (!claim.claimed || rec.usedAt) {\n    await say(SIGNUP_USED_TEXT);", "  if (false) {\n    await say(SIGNUP_USED_TEXT);"]], TR],
  ["س", "a season is written twice", [[REG, "  const vals = rows.filter((c) => !seen.has(`${normName(c.name)}|${c.from}|${c.to}`)).map((c) => ({", "  const vals = rows.map((c) => ({"]], TR],
  ["س", "a crop with no month is a season", [[REG, "  const rows = p.crops.filter((c) => c.from);", "  const rows = p.crops;"]], TR],
  ["س", "an empty «إلى» is not the month of «من»", [[REG, "      crops.push({ name, from, to: asMonth(raw[`f_b${r}`]) || from });", "      crops.push({ name, from, to: asMonth(raw[`f_b${r}`]) });"]], TR],
  ["س", "the trial updates Baraa's own card", [[REG, "    const card = rec.test ? null : (await readSupplierCard(env, rec.partnerId)) ?? (await findCardByNumber(env, msg.from));", "    const card = (await readSupplierCard(env, rec.partnerId)) ?? (await findCardByNumber(env, msg.from));"]], TR],
  ["س", "the trial's card is not flagged «محاكاة»", [[REG, "        ...(rec.test ? { [SIM_FIELD]: true } : { x_whatsapp_number: `+${to}`, x_wa_allowed: true }),", "        ...(false ? { [SIM_FIELD]: true } : { x_whatsapp_number: `+${to}`, x_wa_allowed: true }),"]], TR],
  ["س", "the trial's seasons are not flagged «محاكاة»", [[REG, "    await writeSeasons(env, partnerId, p, idOf, !!rec.test)", "    await writeSeasons(env, partnerId, p, idOf, false)"]], TR],
  ["س", "the owner is not told of a registration", [[REG, "  await tellOwner(env, signupOwnerText(p, to, matchedNames, unmatched, isNew, !!rec.test));\n", ""]], TR],
  ["س", "«📨 أرسل رابط التسجيل» sends every time it is pressed", [[REG, "  if (!claim.claimed) { await writeCardResult(env, id, \"سبق إرسال الرابط اليوم: لم يُرسل مرة ثانية\", {}, now); return { op: \"invite\", id, action: \"claimed_before\" }; }\n", ""]], TR],
  ["س", "a simulated card is invited", [[REG, "  if (card.simulation) { await writeCardResult(env, id, \"بطاقة محاكاة: لا يُرسل منها شيء\", {}, now); return { op: \"invite\", id, action: \"simulation\" }; }\n", ""]], TR],
  ["س", "the invitation makes an approved card «بانتظار الاعتماد»", [[REG, "  const state = card.state ? {} : { [STATE_FIELD]: \"pending\", x_contact_class: \"supplier\", x_review_pending: false };", "  const state = { [STATE_FIELD]: \"pending\", x_contact_class: \"supplier\", x_review_pending: false };"]], TR],
  ["س", "the invitation's text is not shown to Baraa", [[REG, "    await writeCardResult(env, id, `⚠️ لم يُرسل (نافذته مغلقة والقالب غير معتمد بعد). أرسل له هذا النص بنفسك: ${INVITE_TEXT}`, state, now);", "    await writeCardResult(env, id, \"⚠️ لم يُرسل\", state, now);"]], TR],
  ["س", "a card that is not «معتمد» is welcomed", [[REG, "  if (card.state !== \"approved\") return { op: \"welcome\", id, action: \"not_approved\" };\n", ""]], TR],
  ["س", "the welcome goes again at every «✅ اعتماد»", [[REG, "  if (!claim.claimed) { await writeCardResult(env, id, \"✅ معتمد — الترحيب أُرسل من قبل\", more, now); return { op: \"welcome\", id, action: \"claimed_before\" }; }\n", ""]], TR],
  ["س", "an importer's welcome has no «🚢 وصلت شحنة»", [[REG, "  return type === \"importer\" ? [OFFER_SHIP_BUTTON, OFFER_READY_BUTTON] : [OFFER_READY_BUTTON];", "  return [OFFER_READY_BUTTON];"]], TR],
  ["س", "the welcome is not held outside his window", [[REG, "content: buttons.length ? buttonsContent(text, buttons) : textContent(text), ctx });", "content: buttons.length ? buttonsContent(text, buttons) : textContent(text), noHold: true, ctx });"]], TR],
  ["س", "the welcome writes no «التواصل القادم»", [[REG, "  const more: Record<string, unknown> = next ? { x_next_contact: next } : {};", "  const more: Record<string, unknown> = {};"]], TR],
  ["س", "the Sunday after a Sunday is that Sunday", [[REG, "const add = (7 - d.getUTCDay()) % 7 || 7;", "const add = (7 - d.getUTCDay()) % 7;"]], TR],
  ["س", "a monthly cadence is next due in thirty days", [[REG, "  if (cadence === \"monthly\") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);", "  if (cadence === \"monthly\") return new Date(d.getTime() + 30 * 86400_000).toISOString().slice(0, 10);"]], TR],
  ["س", "a farmer's cadence is weekly in the worker", [[REG, "importer: \"weekly\", farmer: \"monthly\", other: \"on_demand\" };", "importer: \"weekly\", farmer: \"weekly\", other: \"on_demand\" };"]], TR],
  ["س", "the welcome is held for an hour", [[WP, "  supplier_welcome: op(\"ترحيب مورد معتمد\", false, { hours: 168 }),", "  supplier_welcome: op(\"ترحيب مورد معتمد\", false, { hours: 1 }),"]], TR],
  ["س", "the trial's purpose is not Baraa's", [[GW, "(OWNER_ALLOWED_PURPOSES as Set<string>).add(\"supplier_registry_test\");", "void 0;"]], TR],
  ["س", "a card with a state is not a closed number", [[PP, CLOSED, "domain: [\"|\", [\"x_price_source\", \"=\", true], [\"supplier_rank\", \">\", 0]],"]], TR],
  ["س", "a registry's supplier is «مصدر أسعار»", [[PP, "(Number(r.supplier_rank) || 0) > 0 || r.x_price_source !== true ? \"supplier\" : \"source\";", "(Number(r.supplier_rank) || 0) > 0 ? \"supplier\" : \"source\";"]], TR],
  ["س", "the webhook routes «تسجيل مورد» as any message", [[IDX, "        const answered = isSignupKeyword(msg.text) ? await answerSignupKeyword(", "        const answered = false && isSignupKeyword(msg.text) ? await answerSignupKeyword("]], TR],
  ["س", "the hook takes an op it does not know", [[IDX, "      if (!(id > 0) || !isSupplierHookOp(op)) return json({ error: \"missing id or op\" }, 400);", "      if (!(id > 0)) return json({ error: \"missing id or op\" }, 400);"]], TR],
  ["س", "the hook takes another model's record", [[IDX, "      if (body._model && body._model !== \"res.partner\") return json({ error: `unexpected model: ${body._model}` }, 400);\n", ""]], TR],
  ["س", "«الطماطم» is not «طماطم»", [[CAT, ".map((w) => w.replace(/^ال(?=.{2,})/, \"\").replace(/[ةها]$/, \"ه\"));", ".map((w) => w.replace(/[ةها]$/, \"ه\"));"]], TR],
  ["س", "a name is listed twice", [[CAT, "    if (!key || seen.has(key)) continue;", "    if (!key) continue;"]], TR],
  ["س", "a country is named by a part of a word", [[REG, "    const code = COUNTRY_CODES[countryKey(part)];", "    const code = COUNTRY_CODES[countryKey(part)] ?? COUNTRY_CODES[countryKey(part).slice(0, 3)];"]], TR],
  ["س", "Odoo: the cadence of the type replaces the card's", [[LIBO, "    if not rec.x_contact_cadence and CADENCE.get(rec.x_supplier_type):", "    if CADENCE.get(rec.x_supplier_type):"]], TR],
  ["س", "Odoo: «✅ اعتماد» presses the invitation's webhook", [[LIBO, "hook = env['ir.actions.server'].sudo().search([('name', '=', '${HOOKS.welcome.name}')], limit=1)\nfor rec in records:", "hook = env['ir.actions.server'].sudo().search([('name', '=', '${HOOKS.invite.name}')], limit=1)\nfor rec in records:"]], TR],
  ["س", "Odoo: a farmer's cadence is weekly", [[LIBO, "importer: \"weekly\", farmer: \"monthly\", other: \"on_demand\" };", "importer: \"weekly\", farmer: \"weekly\", other: \"on_demand\" };"]], TR],
  ["س", "Odoo: a season that wraps the year covers nothing", [[LIBO, " if a <= b else (${Number(m)} >= a or ${Number(m)} <= b)) else 0`;", " if a <= b else False) else 0`;"]], TR],
  ["س", "Odoo: an empty «إلى» is no month", [[LIBO, "    b = int(r.x_month_to or 0) or a", "    b = int(r.x_month_to or 0)"]], TR],
  ["س", "Odoo: the line's automation leaves the final price before VAT out", [[LIBO, "fields: [\"x_purchase_price\", \"x_final_price\", \"x_final_net\", \"x_qty\"] };", "fields: [\"x_purchase_price\", \"x_final_price\", \"x_qty\"] };"]], TR],
  ["س", "Odoo: the line's automation presses «📄 أصدر»", [[LIBO, "export const RECALC_HOOK_ACTION = \"utak.special_quote.recalc_webhook\";", "export const RECALC_HOOK_ACTION = \"utak.special_quote.issue_webhook\";"]], TR],
  ["س", "Odoo: the line's automation recalculates the line's own id as a request", [[LIBO, "    for q in records.mapped('x_quote_id'):", "    for q in records:"]], TR],
  ["س", "Odoo: «عروض الموردين» lists every offer", [[LIBO, "    domain: \"[('x_offer_kind', '=', 'supplier_offer')]\", context: \"{'create': False}\",", "    domain: \"[]\", context: \"{'create': False}\","]], TR],
  ["س", "the form's type list offers «مورد مصاريف»", [[LIBF, "{ id: \"distributor\", title: \"موزّع متخصص\" }, { id: \"other\", title: \"أخرى\" },\n];", "{ id: \"distributor\", title: \"موزّع متخصص\" }, { id: \"other\", title: \"أخرى\" }, { id: \"expense\", title: \"مورد مصاريف\" },\n];"]], TR],
  ["س", "the invitation's button is not the keyword", [[LIBF, "export const INVITE_BUTTON = \"تسجيل مورد\";", "export const INVITE_BUTTON = \"سجّل الآن\";"]], TR],

  // ---------------------------------------------------------------- ع — the supplier's offer
  ["ع", "a supplier «بانتظار الاعتماد» gets the offer form", [[OFF, "  if (card.state !== \"approved\") {\n    if (card.state === \"pending\")", "  if (false) {\n    if (card.state === \"pending\")"]], TO],
  ["ع", "a number that is no supplier is answered", [[OFF, "  if (!card?.state) return false;", "  if (!card) return false;"]], TO],
  ["ع", "a team member is answered", [[OFF, "  if (!what || who.team || isOwnerRecipient(env, msg.from)) return false;", "  if (!what || isOwnerRecipient(env, msg.from)) return false;"]], TO],
  ["ع", "a supplier «بانتظار الاعتماد» is told nothing", [[OFF, "    if (card.state === \"pending\") await sendViaGateway(", "    if (false) await sendViaGateway("]], TO],
  ["ع", "«عرض مورد» opens nothing", [[OFF, " || t === \"عرض مورد\") return \"ready\";", ") return \"ready\";"]], TO],
  ["ع", "«وصلت شحنة» opens «بضاعتي جاهزة»", [[OFF, "  if (id === \"sup_offer:ship\") return \"ship\";", "  if (id === \"sup_offer:ship\") return \"ready\";"]], TO],
  ["ع", "the item is taken from what the client sends", [[OFF, "  const item = rec.items.find((i) => String(i.id) === chosen) ?? null;", "  const item = /^\\d+$/.test(chosen) ? { id: Number(chosen), name: chosen } : null;"]], TO],
  ["ع", "«صنف آخر» without its text is taken", [[OFF, "  if (!item && !(chosen === OFFER_OTHER_ID && other)) problems.push(\"item\");", "  if (!item && chosen !== OFFER_OTHER_ID) problems.push(\"item\");"]], TO],
  ["ع", "an offer without a quantity is taken", [[OFF, "  if (qty === null) problems.push(\"qty\");\n", ""]], TO],
  ["ع", "an offer without a price is taken", [[OFF, "  if (price === null) problems.push(\"price\");\n", ""]], TO],
  ["ع", "an offer without a packaging is taken", [[OFF, "  if (!pack) problems.push(\"pack\");\n", ""]], TO],
  ["ع", "zero is a number above zero", [[OFF, "  const n = Math.round(Number(s) * 100) / 100;\n  return n > 0 ? n : null;\n}\n/** A DatePicker", "  const n = Math.round(Number(s) * 100) / 100;\n  return n >= 0 ? n : null;\n}\n/** A DatePicker"]], TO],
  ["ع", "«حتى» before «من» is kept", [[OFF, "  if (from && until && until < from) until = \"\";\n", ""]], TO],
  ["ع", "a refused form is written", [[OFF, "  if (p.problems.length) { await say(OFFER_BAD_TEXT); return { action: \"invalid\" }; }\n", ""]], TO],
  ["ع", "the offer's row is not «خاص»", [[OFF, "    x_special: true,\n    x_special_unit: p.pack,", "    x_special: false,\n    x_special_unit: p.pack,"]], TO],
  ["ع", "the offer's row has no kind", [[OFF, "    x_offer_kind: OFFER_KIND,", "    x_offer_kind: false,"]], TO],
  ["ع", "the offer's price is a market price", [[OFF, "    x_purchase_price: p.price,\n    x_market_price: 0,", "    x_purchase_price: 0,\n    x_market_price: p.price,"]], TO],
  ["ع", "the packaging he wrote is not kept", [[OFF, "    x_special_unit: p.pack,", "    x_special_unit: false,"]], TO],
  ["ع", "the size is not kept", [[OFF, "    x_item_size: p.size || false,", "    x_item_size: false,"]], TO],
  ["ع", "the origin is not kept", [[OFF, "    x_item_origin: p.origin || false,", "    x_item_origin: false,"]], TO],
  ["ع", "«جاهز من» is not kept", [[OFF, "    x_ready_from: p.from || false,", "    x_ready_from: false,"]], TO],
  ["ع", "«جاهز حتى» is not kept", [[OFF, "    x_ready_until: p.until || false,", "    x_ready_until: false,"]], TO],
  ["ع", "the available quantity is not kept", [[OFF, "    x_available_qty: p.qty,", "    x_available_qty: 0,"]], TO],
  ["ع", "a token is read by any number", [[OFF, "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], TO],
  ["ع", "a token is read twice", [[OFF, "  if (!claim.claimed || rec.usedAt) { await say(OFFER_USED_TEXT); return { action: \"duplicate\" }; }\n", ""]], TO],
  ["ع", "a supplier stopped since is written", [[OFF, "    if (!card || card.id !== rec.partnerId || card.state !== \"approved\") { await say(OFFER_NOT_APPROVED_TEXT); return { action: \"not_approved\" }; }\n", ""]], TO],
  ["ع", "an item not in the catalog is announced as any offer", [[OFF, "  const head = linked ? `${rec.what", "  const head = true ? `${rec.what"]], TO],
  ["ع", "an unmatched item counts as linked", [[CAT, "  return { ...(await unlinkedItem(env)), linked: false, name: text };", "  return { ...(await unlinkedItem(env)), linked: true, name: text };"]], TO],
  ["ع", "a shipment is announced as «عرض مورد»", [[OFF, "`${rec.what === \"ship\" ? \"🚢 وصلت شحنة\" : \"📦 عرض مورد\"} من «${rec.name}»`", "`📦 عرض مورد من «${rec.name}»`"]], TO],
  ["ع", "the owner is not told of an offer", [[OFF, "  await tellOwner(env, offerOwnerText(rec, p, linked));\n", ""]], TO],
  ["ع", "the trial's row is not flagged «محاكاة»", [[OFF, "    ...(rec.test ? { [SIM_FIELD]: true } : {}),", "    ...(false ? { [SIM_FIELD]: true } : {}),"]], TO],
  ["ع", "the trial writes on Baraa's card", [[OFF, "    if (!rec.test) {\n      // «آخر سعر/عرض» on his card", "    if (true) {\n      // «آخر سعر/عرض» on his card"]], TO],
  ["ع", "his card's «آخر سعر/عرض» is not written", [[OFF, "vals: { x_last_offer_text: `${offerLine(p)} — ${day}`.slice(0, 250) } })", "vals: {} })"]], TO],
  ["ع", "the list takes more than Meta's two hundred", [[OFF, "export const OFFER_ITEMS_MAX = 199;", "export const OFFER_ITEMS_MAX = 399;"]], TO],
  ["ع", "a choice's title is not cut", [[OFF, "({ id: String(i.id), title: cut(i.name, 30) }))", "({ id: String(i.id), title: i.name }))"]], TO],
  ["ع", "«صنف آخر» is not offered", [[OFF, ", { id: OFFER_OTHER_ID, title: OFFER_OTHER_TITLE }];", "];"]], TO],
  ["ع", "the form opens on no day", [[OFF, "how: OFFER_HOW[what], items: offerOptions(items), d: day };", "how: OFFER_HOW[what], items: offerOptions(items), d: \"\" };"]], TO],

  // ---------------------------------------------------------------- د — the price forms
  ["د", "the size is not read from the reply", [[PF, "      const size = slotText(values[`s${item.slot}`]), origin", "      const size = \"\", origin"]], TP],
  ["د", "the origin is not read from the reply", [[PF, ", origin = slotText(values[`o${item.slot}`]);", ", origin = \"\";"]], TP],
  ["د", "the size is not written on a daily price", [[OD, "  if (vals.size) record.x_item_size = vals.size;\n", ""]], TP],
  ["د", "the origin is not written on a daily price", [[OD, "  if (vals.origin) record.x_item_origin = vals.origin;\n", ""]], TP],
  ["د", "the size is not written on an observation", [[PS, "      ...(o.size ? { x_item_size: o.size } : {}),\n", ""]], TP],
  ["د", "the origin is not written on an observation", [[PS, "      ...(o.origin ? { x_item_origin: o.origin } : {}),\n", ""]], TP],
  ["د", "the supplier's daily price is not given the two fields", [[PF, "          size: e.size, origin: e.origin,\n        });", "        });"]], TP],
  ["د", "a size is kept at any length", [[PF, "export const SLOT_TEXT_MAX = 40;", "export const SLOT_TEXT_MAX = 400;"]], TP],
  ["د", "the answer does not name the size and the origin", [[PF, "${s.size || s.origin ? ` (${[s.size, s.origin].filter(Boolean).join(\"، \")})` : \"\"}`;", "`;"]], TP],
  ["د", "«تعديل» opens without the size and the origin", [[PF, "{ now, items: rec.items, pages: rec.pages, init, initTexts, parent: rec.token,", "{ now, items: rec.items, pages: rec.pages, init, parent: rec.token,"]], TP],
  ["د", "the token does not keep what the reply carried", [[PF, "if (s.size || s.origin) texts[s.item.slot] =", "if (false) texts[s.item.slot] ="]], TP],
  ["د", "the template is sent v3's data", [[PF, "params: flowAskParams(day), flow: { token: record.token, data } },", "params: flowAskParams(day), flow: { token: record.token, data: sessionData } },"]], TP],
  ["د", "the message is sent v2's data", [[PF, "    session: flowSession(text, record.token, sessionData, opts.cta ?? PRICE_FLOW_CTA),", "    session: flowSession(text, record.token, data, opts.cta ?? PRICE_FLOW_CTA),"]], TP],
  ["د", "the form opens the size of a hidden slot", [[PF, "    data[`is${n}`] = shown ? slotText(texts[n]?.s) : \"\";", "    data[`is${n}`] = slotText(texts[n]?.s) || \"x\";"]], TP],
  ["د", "the worker sends v2's id", [[PF, "export const PRICE_FLOW_ID = \"1120057760674035\";", "export const PRICE_FLOW_ID = \"1123704886881420\";"]], TP],
  ["د", "«➕ صنف إضافي» is offered after «تعديل» too", [[PF, "    if (!rec.parent && (!rec.test || rec.sim)) {", "    if ((!rec.test || rec.sim)) {"]], TP],
  ["د", "«➕ صنف إضافي» is offered after § 51's trial", [[PF, "    if (!rec.parent && (!rec.test || rec.sim)) {", "    if (!rec.parent) {"]], TP],
  ["د", "«➕ صنف إضافي» is never offered", [[PF, "    if (!rec.parent && (!rec.test || rec.sim)) {", "    if (false) {"]], TP],
  ["د", "the new trial writes nothing", [[PF, "    const w = rec.test && !rec.sim ? {", "    const w = rec.test ? {"]], TP],
  ["د", "the trial's rows are not flagged «محاكاة»", [[PS, "      ...(o.simulation ? { [SIM_FIELD]: true } : {}),\n", ""]], TP],
  ["د", "the trial's reply refreshes the day", [[PF, "  if (saved.length && !rec.sim) {", "  if (saved.length) {"]], TP],
  ["د", "the market trial is § 51's (nothing written)", [[TRI, "{ now, test: true, sim: true });", "{ now, test: true });"]], TP],
  ["د", "the trial's extra form is not a trial", [[PF, "kind: rec.kind, day: rec.day, test: rec.test }, ctx, now);", "kind: rec.kind, day: rec.day }, ctx, now);"]], TP],
  ["د", "an extra row with no readable price is dropped silently", [[EX, "    if (price === null) { invalid.push(name); continue; }", "    if (price === null) { continue; }"]], TP],
  ["د", "an extra price without a name is a row", [[EX, "    if (!name) continue;\n    const price", "    const price"]], TP],
  ["د", "the form reads four rows", [[EX, "export const EXTRA_ROWS = 5;", "export const EXTRA_ROWS = 4;"]], TP],
  ["د", "an extra row is not «خاص»", [[EX, "    x_special: true,\n    x_special_unit: r.pack || false,", "    x_special: false,\n    x_special_unit: r.pack || false,"]], TP],
  ["د", "an extra row has no kind", [[EX, "    x_offer_kind: EXTRA_KIND,", "    x_offer_kind: false,"]], TP],
  ["د", "a market source's extra is a purchase price", [[EX, "    x_purchase_price: rec.kind === \"purchase\" ? r.price : 0,", "    x_purchase_price: r.price,"]], TP],
  ["د", "a purchase source's extra is a market price", [[EX, "    x_market_price: rec.kind === \"market\" ? r.price : 0,", "    x_market_price: r.price,"]], TP],
  ["د", "the extra row loses the packaging he wrote", [[EX, "    x_special_unit: r.pack || false,", "    x_special_unit: false,"]], TP],
  ["د", "the extra row loses its size", [[EX, "    x_item_size: r.size || false,", "    x_item_size: false,"]], TP],
  ["د", "the extra row loses its origin", [[EX, "    x_item_origin: r.origin || false,", "    x_item_origin: false,"]], TP],
  ["د", "the extra row loses the employee", [[EX, "    x_source_employee_id: rec.employeeId || false,", "    x_source_employee_id: false,"]], TP],
  ["د", "an extra token is read by any number", [[EX, "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], TP],
  ["د", "an extra token is read twice", [[EX, "  if (!claim.claimed || rec.usedAt) { await say(EXTRA_USED_TEXT); return { action: \"duplicate\" }; }\n", ""]], TP],
  ["د", "an empty extra form burns its token", [[EX, "  if (!rows.length) { await say(extraAckText([], invalid)); return { action: \"empty\" }; }\n", ""]], TP],
  ["د", "the trial's extra rows are not flagged «محاكاة»", [[EX, "    ...(rec.test ? { [SIM_FIELD]: true } : {}),", "    ...(false ? { [SIM_FIELD]: true } : {}),"]], TP],
  ["د", "Baraa is not told of an item not in the catalog", [[EX, "      unlinked.length ? `🆕 صنف من مورد (ليس في الكتالوج): ", "      false ? `🆕 صنف من مورد (ليس في الكتالوج): "]], TP],
  ["د", "a market source reads the purchase line", [[EX, "note: EXTRA_NOTE[who.kind] }),", "note: EXTRA_NOTE.purchase }),"]], TP],
  ["د", "the 02:30 ask reaches a source that is not approved", [[PS, TARGETS, "...src.partners.filter((p) => (!p.supplier || (p.role === \"market\" && !p.purchaseAsked)) && !emp.has(p.partnerId))"]], TP],
  ["د", "a «سوق» supplier is asked at 02:00 and at 02:30", [[PS, TARGETS, "...src.partners.filter((p) => p.approved && (!p.supplier || p.role === \"market\") && !emp.has(p.partnerId))"]], TP],
  ["د", "an approved «سوق» supplier is never asked at 02:30", [[PS, TARGETS, "...src.partners.filter((p) => p.approved && !p.supplier && !emp.has(p.partnerId))"]], TP],
  ["د", "«بانتظار الاعتماد» counts as approved", [[PS, "      approved: p[SUPPLIER_STATE_FIELD] === \"approved\",", "      approved: p[SUPPLIER_STATE_FIELD] !== \"suspended\","]], TP],
  ["د", "a supplier with no items counts as asked at 02:00", [[PS, "purchaseAsked: supplier && !!whatsapp && (p.x_supplied_product_ids ?? []).length > 0,", "purchaseAsked: supplier && !!whatsapp,"]], TP],
  ["د", "the 02:00 ask reaches a supplier «بانتظار الاعتماد»", [[OD, "      [\"x_supplier_state\", \"not in\", [\"pending\", \"suspended\"]],", "      [\"x_supplier_state\", \"not in\", [\"suspended\"]],"]], TP],
  ["د", "the 02:00 ask reaches a supplier «موقوف»", [[OD, "      [\"x_supplier_state\", \"not in\", [\"pending\", \"suspended\"]],", "      [\"x_supplier_state\", \"not in\", [\"pending\"]],"]], TP],
  ["د", "the 02:00 ask reaches approved suppliers alone", [[OD, "      [\"x_supplier_state\", \"not in\", [\"pending\", \"suspended\"]],", "      [\"x_supplier_state\", \"=\", \"approved\"],"]], TP],
  ["د", "v3 at Meta: fourteen slots a page", [[LIBF, "export const PRICE_PAGE_SLOTS = 15;", "export const PRICE_PAGE_SLOTS = 14;"]], TP],
  ["د", "v3 at Meta: «إرسال» does not return the origin", [[LIBF, "export const SLOT_FIELDS = [\"p\", \"s\", \"o\"];", "export const SLOT_FIELDS = [\"p\", \"s\"];"]], TP],
  ["د", "v3 at Meta: the size is required", [[LIBF, "name: `s${n}`, label: SIZE_LABEL, \"input-type\": \"text\", required: false,", "name: `s${n}`, label: SIZE_LABEL, \"input-type\": \"text\", required: true,"]], TP],
  ["د", "v3 at Meta: the size is shown for a hidden slot", [[LIBF, "\"helper-text\": SIZE_HINT, visible: pref(k, `v${n}`),", "\"helper-text\": SIZE_HINT,"]], TP],
  ["د", "v3 at Meta: the title is a component of its own (fifty-one a page)", [[LIBF, "        { type: \"TextBody\", text: pref(k, \"note\") },\n        ...priceSlots(k)", "        { type: \"TextSubheading\", text: pref(k, \"sub\") },\n        { type: \"TextBody\", text: pref(k, \"note\") },\n        ...priceSlots(k)"]], TP],
  ["د", "the extra form at Meta: its price is a text", [[LIBF, "  [\"xp\", \"سعر الصنف\", \"بالريال\", \"number\"],", "  [\"xp\", \"سعر الصنف\", \"بالريال\", \"text\"],"]], TP],

  // ---------------------------------------------------------------- هـ — the check-in and the numbers
  ["هـ", "the check-in runs with the switch off", [[OUT, "    if (!(await outreachEnabled(env, day))) return { action: \"off\" };\n", ""]], TU],
  ["هـ", "a settings row with no value is on", [[OUT, "  return r?.[OUTREACH_FIELD] === true;", "  return r?.[OUTREACH_FIELD] !== false;"]], TU],
  ["هـ", "the check-in runs after 18:00", [[OUT, "  if (minute < OUTREACH_FROM_MINUTE || minute >= OUTREACH_UNTIL_MINUTE) return { action: \"outside\" };", "  if (minute < OUTREACH_FROM_MINUTE) return { action: \"outside\" };"]], TU],
  ["هـ", "the check-in runs before 09:00", [[OUT, "  if (minute < OUTREACH_FROM_MINUTE || minute >= OUTREACH_UNTIL_MINUTE) return { action: \"outside\" };", "  if (minute >= OUTREACH_UNTIL_MINUTE) return { action: \"outside\" };"]], TU],
  ["هـ", "the check-in starts at 08:00", [[OUT, "export const OUTREACH_FROM_MINUTE = 9 * 60;", "export const OUTREACH_FROM_MINUTE = 8 * 60;"]], TU],
  ["هـ", "the check-in ends at 19:00", [[OUT, "export const OUTREACH_UNTIL_MINUTE = 18 * 60;", "export const OUTREACH_UNTIL_MINUTE = 19 * 60;"]], TU],
  ["هـ", "a day that is not due is read all the same", [[OUT, "  if (!isSunday(day) && !isFirstOfMonth(day)) return { action: \"not_due_day\" };\n", ""]], TU],
  ["هـ", "a supplier that is not approved is checked in on", [[OUT, "      domain: [[STATE_FIELD, \"=\", \"approved\"], [\"x_contact_cadence\", \"in\", [\"weekly\", \"monthly\"]],", "      domain: [[STATE_FIELD, \"!=\", false], [\"x_contact_cadence\", \"in\", [\"weekly\", \"monthly\"]],"]], TU],
  ["هـ", "a daily supplier is checked in on", [[OUT, "[\"x_contact_cadence\", \"in\", [\"weekly\", \"monthly\"]],", "[\"x_contact_cadence\", \"!=\", false],"], [OUT, "  if (cadence === \"weekly\") return { due: isSunday(day), next: nextSunday(day) };", "  if (cadence === \"weekly\" || cadence === \"daily\") return { due: isSunday(day), next: nextSunday(day) };"]], TU],
  ["هـ", "a simulated card is checked in on", [[OUT, DUE_SQL, "\"|\", [\"x_next_contact\", \"=\", false], [\"x_next_contact\", \"<=\", day]],"]], TU],
  ["هـ", "a card whose «التواصل القادم» is after today is read", [[OUT, DUE_SQL, "[SIM_FIELD, \"!=\", true]],"]], TU],
  ["هـ", "a supplier is written to at every tick of a due day", [[OUT, "  if (!claim.claimed) return { partnerId: s.id, name: s.name, action: \"claimed_before\" };\n", ""]], TU],
  ["هـ", "«التواصل القادم» is not written", [[OUT, "    if (next) await call<boolean>(env, \"res.partner\", \"write\", { ids: [s.id], vals: { x_next_contact: next } })", "    if (false) await call<boolean>(env, \"res.partner\", \"write\", { ids: [s.id], vals: { x_next_contact: next } })"]], TU],
  ["هـ", "«التواصل القادم» moves when nothing went", [[OUT, "    if (d?.action !== \"session\" && d?.action !== \"template\") return { partnerId: s.id, name: s.name, action: \"not_sent\", detail: d ? d.action : \"no_decision\" };\n", ""]], TU],
  ["هـ", "a check-in that cannot go is held", [[OUT, "noHold: true, noHoldReason: \"التواصل الدوري لا يُحفظ: يُعاد في موعده القادم\", ctx,", "ctx,"]], TU],
  ["هـ", "the template is not tried outside the window", [[OUT, "      fallback: [{ kind: \"template\", purpose: CHECKIN_PURPOSE, params: (template) => checkinParams(template, s.name, day) }], ", "      "]], TU],
  ["هـ", "the template names nobody", [[OUT, "fallback: [{ kind: \"template\", purpose: CHECKIN_PURPOSE, params: (template) => checkinParams(template, s.name, day) }],", "fallback: [{ kind: \"template\", purpose: CHECKIN_PURPOSE, params: [\"\"] }],"]], TU],
  ["هـ", "Baraa's own number is checked in on", [[OUT, "  if (!s.whatsapp || isOwnerRecipient(env, s.whatsapp)) return { partnerId: s.id, name: s.name, action: \"no_number\" };", "  if (!s.whatsapp) return { partnerId: s.id, name: s.name, action: \"no_number\" };"]], TU],
  ["هـ", "a farmer's season is not read", [[OUT, "      for (const s of seasons) if (seasonCovers(s.x_month_from, s.x_month_to, month)) inSeason.add(", "      for (const s of seasons) if (false) inSeason.add("]], TU],
  ["هـ", "a simulated season makes a season", [[OUT, "domain: [[\"x_partner_id\", \"in\", monthly], [SIM_FIELD, \"!=\", true]], fields: [\"x_partner_id\", \"x_month_from\", \"x_month_to\"]", "domain: [[\"x_partner_id\", \"in\", monthly]], fields: [\"x_partner_id\", \"x_month_from\", \"x_month_to\"]"]], TU],
  ["هـ", "weekly is due every day", [[OUT, "  if (cadence === \"weekly\") return { due: isSunday(day), next: nextSunday(day) };", "  if (cadence === \"weekly\") return { due: true, next: nextSunday(day) };"]], TU],
  ["هـ", "monthly outside the season is due on Sundays", [[OUT, "    if (!inSeason) return { due: isFirstOfMonth(day), next: nextFirst(day) };", "    if (!inSeason) return { due: isSunday(day), next: nextFirst(day) };"]], TU],
  ["هـ", "monthly inside the season is due on the first alone", [[OUT, "    return { due: isSunday(day) || isFirstOfMonth(day), next: sun < first ? sun : first };", "    return { due: isFirstOfMonth(day), next: sun < first ? sun : first };"]], TU],
  ["هـ", "inside the season the next contact is always a Sunday", [[OUT, "next: sun < first ? sun : first };", "next: sun };"]], TU],
  ["هـ", "a season that wraps the year covers nothing", [[OUT, "  return a <= b ? a <= month && month <= b : month >= a || month <= b;", "  return a <= b ? a <= month && month <= b : false;"]], TU],
  ["هـ", "an empty «إلى» covers to the year's end", [[OUT, "  const b = Number(to) >= 1 && Number(to) <= 12 ? Number(to) : a;", "  const b = Number(to) >= 1 && Number(to) <= 12 ? Number(to) : 12;"]], TU],
  ["هـ", "the Sunday after a Sunday is that Sunday", [[OUT, "export const nextSunday = (day: string): string => plusDays(day, 7 - dayOf(day).getUTCDay());", "export const nextSunday = (day: string): string => plusDays(day, (7 - dayOf(day).getUTCDay()) % 7);"]], TU],
  ["هـ", "the check-in's button opens nothing", [[OUT, "export const CHECKIN_BUTTON = { id: \"sup_offer:ready\", title: \"📦 عرض مورد\" } as const;", "export const CHECKIN_BUTTON = { id: \"sup_checkin\", title: \"📦 عرض مورد\" } as const;"]], TU],
  ["هـ", "a failed send counts as a day we wrote", [[OUT, "=> m.x_status === \"sent\" || m.x_status === \"delivered\" || m.x_status === \"read\";", "=> true;"]], TU],
  ["هـ", "a simulated message counts", [[OUT, "[\"create_date\", \">=\", `${since} 00:00:00`], [SIM_FIELD, \"!=\", true]], fields: [\"x_partner_id\", \"x_direction\"", "[\"create_date\", \">=\", `${since} 00:00:00`]], fields: [\"x_partner_id\", \"x_direction\""]], TU],
  ["هـ", "the days of the reply rate are UTC's", [[OUT, "Z`) + 3 * 3600_000).toISOString().slice(0, 10);\nconst money", "Z`) + 0 * 3600_000).toISOString().slice(0, 10);\nconst money"]], TU],
  ["هـ", "the reply rate counts his days, not ours", [[OUT, "  return round1((n / asked.size) * 100);", "  return round1((n / Math.max(1, answered.size)) * 100);"]], TU],
  ["هـ", "a purchase price is compared without VAT", [[OUT, "    for (const d of myDaily) pairs.push({ his: Number(d.x_price_sar) * VAT,", "    for (const d of myDaily) pairs.push({ his: Number(d.x_price_sar),"]], TU],
  ["هـ", "a «خاص» row is compared with the market", [[OUT, "    for (const o of myOffers.filter((x) => x.x_special !== true)) {", "    for (const o of myOffers) {"]], TU],
  ["هـ", "a day with no market price counts as a gap", [[OUT, "  const ok = pairs.filter((p) => p.his > 0 && p.market > 0);", "  const ok = pairs.filter((p) => p.his > 0).map((p) => ({ his: p.his, market: p.market || p.his * 2 }));"]], TU],
  ["هـ", "the numbers are written at every pass", [[OUT, "    if (Object.keys(vals).length) { await call<boolean>(env, \"res.partner\", \"write\", { ids: [id], vals }); written++; }", "    { await call<boolean>(env, \"res.partner\", \"write\", { ids: [id], vals }); written++; }"]], TU],
  ["هـ", "the capacity's last price is not written", [[OUT, "      if (hit && (Number(k.x_last_price) !== hit.price || String(k.x_last_price_date || \"\") !== hit.day)) {", "      if (false) {"]], TU],
  ["هـ", "the numbers are computed before 09:00", [[OUT, "  if (riyadhMinutes(new Date(now)) < OUTREACH_FROM_MINUTE) return { action: \"before\" };\n", ""]], TU],
  ["هـ", "the numbers are computed at every tick", [[OUT, "  if (!claim.claimed) return { action: \"claimed_before\" };\n", ""]], TU],
  ["هـ", "the tick runs the check-in outside its own job", [[IDX, "runSupplierOutreachTick(withAutoSendJob(rawEnv, OUTREACH_JOB), Date.now(), ctx)", "runSupplierOutreachTick(rawEnv, Date.now(), ctx)"]], TU],
  ["هـ", "the check-in template's button is not «عرض مورد»", [[LIBF, "export const CHECKIN_BUTTON = \"عرض مورد\";", "export const CHECKIN_BUTTON = \"سجّل عرضك\";"]], TU],
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
writeFileSync(new URL("../artifacts/s65-20261007-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
