// Mutation check for § 64 (2026-10-07) — «💬 المحادثات» by date (م: scripts/lib/s64-odoo.mjs — the Python Odoo runs
// and its JS twin), the worker's «📈 تاريخ الأسعار» page (ت: src/price-history.ts, src/quote-preview.ts) and § 62 د's
// leftovers (ب: the old download's 410, «التعبئة» as text, a typed price under a change of mode — the pair's stale
// price never taken for the typed one — the second sheet's padding, the ticket's archive). Each mutation disables ONE guard, runs the test file named with it, and
// must make it fail. The source is restored in `finally` after every run; a pattern that is not found exactly
// once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ and scripts/lib/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s64-20261007-mutations.mjs [م ت ب]     (no argument: every part)
//
// Out: scripts/artifacts/s64-20261007-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TC = "tests/s64-chats.test.mts", TH = "tests/s64-history.test.mts", TB = "tests/s64-leftovers.test.mts";
const LIB = "scripts/lib/s64-odoo.mjs", PH = "src/price-history.ts", PV = "src/quote-preview.ts", SOQ = "src/sale-order-quotation.ts", QT = "src/special-quotation.ts", SQ = "src/special-quote.ts", PT = "src/pdf-template.ts", IDX = "src/index.ts";
const PREV = ".filter((r) => r.day < lastMarket.day && price(r.market) > 0).pop()";
const KEPT = "l.finalPrice > 0 && netOf(l.finalPrice) === l.finalNet ? l.finalPrice : grossOf(l.finalNet)";
const FLOW = ".utak-page { -webkit-box-decoration-break: clone; box-decoration-break: clone; padding-bottom: 0 !important; }";
const GONE = "    if (url.pathname === SALE_PDF_GONE_PATH) {\n      return new Response(null, { status: 410, headers: { \"Cache-Control\": \"no-store\" } });\n    }\n";
const CHANGED = "modeSettled(q) ? finalsOf(l, net ? \"net\" : \"gross\") : finalsAfterModeChange(l, net ? \"net\" : \"gross\")";
const MOVED = "  const grossMoved = lineTotal(l.qty, l.finalPrice) !== round2(l.total);";
const PY_BUCKET_LINE = "\n        'x_date_bucket': wa_bucket(last, now, channel.x_pinned),";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- م — «💬 المحادثات»
  ["م", "Odoo's code counts UTC's days", [[LIB, "    return (moment + datetime.timedelta(hours=${RIYADH_HOURS})).date()", "    return moment.date()"]], TC],
  ["م", "the JS twin counts UTC's days", [[LIB, "export const riyadhDay = (ms) => Math.floor((ms + RIYADH_MS) / 86400_000);", "export const riyadhDay = (ms) => Math.floor(ms / 86400_000);"]], TC],
  ["م", "Odoo's code: two days back is still «أمس»", [[LIB, "    if days == 1:", "    if days <= 2:"]], TC],
  ["م", "Odoo's code: «آخر 7 أيام» ends at six", [[LIB, "    if days <= 7:", "    if days <= 6:"]], TC],
  ["م", "Odoo's code: «آخر 30 يوماً» reaches thirty-one", [[LIB, "    if days <= 30:", "    if days <= 31:"]], TC],
  ["م", "the JS twin: «آخر 7 أيام» ends at six", [[LIB, "days <= 7 ? \"4_week\"", "days <= 6 ? \"4_week\""]], TC],
  ["م", "the JS twin: «آخر 30 يوماً» reaches thirty-one", [[LIB, "days <= 30 ? \"5_month\"", "days <= 31 ? \"5_month\""]], TC],
  ["م", "Odoo's code: a pinned conversation follows its message's day", [[LIB, "    if pinned:\n        return '1_pinned'\n", ""]], TC],
  ["م", "the JS twin: a pinned conversation follows its message's day", [[LIB, "  if (pinned) return \"1_pinned\";\n", ""]], TC],
  ["م", "Odoo's code: a conversation with no message is «اليوم»", [[LIB, "    if not last:\n        return '6_older'", "    if not last:\n        return '2_today'"]], TC],
  ["م", "Odoo's code: today's message shows its date", [[LIB, "        return local.strftime('%H:%M')", "        return local.strftime('%Y-%m-%d')"]], TC],
  ["م", "Odoo's code: the hour shown is UTC's", [[LIB, "    local = last + datetime.timedelta(hours=${RIYADH_HOURS})", "    local = last"]], TC],
  ["م", "the JS twin: an earlier day shows its hour", [[LIB, "<= 0 ? local.slice(11, 16) : local.slice(0, 10);", "<= 0 ? local.slice(11, 16) : local.slice(11, 16);"]], TC],
  ["م", "a preview of two hundred characters", [[LIB, "export const PREVIEW_MAX = 80;", "export const PREVIEW_MAX = 200;"]], TC],
  ["م", "Odoo's code: media with no text shows nothing", [[LIB, "    if has_attachment and (not text or text.startswith('📎')):", "    if False:"]], TC],
  ["م", "Odoo's code: text with no media is «مرفق» when it is empty", [[LIB, "    if has_attachment and (not text or text.startswith('📎')):", "    if not text or text.startswith('📎'):"]], TC],
  ["م", "the JS twin: media with no text shows nothing", [[LIB, "  if (hasAttachment && (!t || t.startsWith(\"📎\"))) return ATTACHMENT_PREVIEW;\n", ""]], TC],
  ["م", "Odoo's code: the preview keeps its line breaks", [[LIB, "    text = ' '.join((text or '').split())", "    text = (text or '').strip()"]], TC],
  ["م", "an older message takes the conversation's place of the newer", [[LIB, "            if not channel.x_last_msg_at or last >= channel.x_last_msg_at:", "            if True:"]], TC],
  ["م", "an internal conversation is written", [[LIB, "        if channel and channel.x_wa_partner_id:", "        if channel:"]], TC],
  ["م", "«غادر القناة» counts as a message", [[LIB, "record.message_type == 'comment' and ", ""]], TC],
  ["م", "a comment on any model moves a conversation", [[LIB, "    if record.model == '${CHANNEL_MODEL}' and ", "    if "]], TC],
  ["م", "trouble in the automation stops the message", [[LIB, "except Exception as e:\n    log('utak.wa_chats.on_message: %s' % e, level='error')", "except Exception as e:\n    raise"]], TC],
  ["م", "a new message takes a pinned conversation out of «📌 المثبّتة»", [[LIB, "                    'x_date_bucket': wa_bucket(last, now, channel.x_pinned),", "                    'x_date_bucket': wa_bucket(last, now, False),"]], TC],
  ["م", "the 00:05 pass takes «غادر القناة» for the last message", [[LIB, ", ('message_type', '=', 'comment')], order=", "], order="]], TC],
  ["م", "the 00:05 pass takes a pinned conversation out of «📌 المثبّتة»", [[LIB, PY_BUCKET_LINE, "\n        'x_date_bucket': wa_bucket(last, now, False),"]], TC],
  ["م", "the 00:05 pass writes every conversation every night", [[LIB, "    if changed:\n        channel.write(changed)\n", "    channel.write(vals)\n"]], TC],
  ["م", "«📌 تثبيت» does not move the conversation", [[LIB, "    channel.write({'x_pinned': pinned, 'x_date_bucket': wa_bucket(channel.x_last_msg_at, now, pinned)})", "    channel.write({'x_pinned': pinned})"]], TC],
  ["م", "«📌 إلغاء» pins again", [[LIB, "    pinned = not channel.x_pinned", "    pinned = True"]], TC],
  ["م", "«فتح» opens the inbox, not the conversation", [[LIB, "    'params': {'active_id': '${CHANNEL_MODEL}_%s' % record.id},", "    'params': {'default_active_id': 'mail.box_inbox'},"]], TC],
  ["م", "the scheduled action runs at 00:05 UTC (03:05 Riyadh)", [[LIB, "utcTime: \"21:05:00\"", "utcTime: \"00:05:00\""]], TC],
  ["م", "its first run is counted from 00:05 UTC", [[LIB, "d.getUTCDate(), 21, 5, 0);", "d.getUTCDate(), 0, 5, 0);"]], TC],
  ["م", "its first run may be in the past", [[LIB, "  if (t <= nowMs) t += 86400_000;\n", ""]], TC],
  ["م", "the list does not open grouped", [[LIB, "context: \"{'search_default_g_bucket': 1}\"", "context: \"{}\""]], TC],
  ["م", "the groups open closed", [[LIB, " expand=\"1\"", ""]], TC],
  ["م", "the oldest message first", [[LIB, "default_order=\"x_last_msg_at desc\"", "default_order=\"x_last_msg_at asc\""]], TC],
  ["م", "the internal conversations are in the list", [[LIB, "domain: \"[('x_wa_partner_id', '!=', False)]\"", "domain: \"[]\""]], TC],
  ["م", "a row's click opens the channel's form", [[LIB, " action=\"${a.open}\" type=\"action\">", ">"]], TC],
  ["م", "the search does not read the number", [[LIB, "('x_wa_partner_id.x_whatsapp_number', 'ilike', self), ", ""]], TC],
  ["م", "the list may be edited in place", [[LIB, " edit=\"0\"", ""]], TC],
  ["م", "another menu takes the list", [[LIB, "export const CHAT_MENU_ID = 565;", "export const CHAT_MENU_ID = 563;"]], TC],
  ["م", "the automation runs on every write of a message too", [[LIB, "trigger: \"on_create\", filter_domain", "trigger: \"on_create_or_write\", filter_domain"]], TC],
  ["م", "the automation runs on every message of every model", [[LIB, "filter_domain: `[(\"model\", \"=\", \"${CHANNEL_MODEL}\"), (\"message_type\", \"=\", \"comment\")]`", "filter_domain: `[]`"]], TC],
  ["م", "the groups' keys do not sort as the list shows them", [[LIB, "[\"2_today\", \"اليوم\"], [\"3_yesterday\", \"أمس\"]", "[\"3_today\", \"اليوم\"], [\"2_yesterday\", \"أمس\"]"]], TC],
  ["م", "the pin button shows «📌 تثبيت» on a pinned conversation", [[LIB, "string=\"📌 تثبيت\" invisible=\"x_pinned\"/>", "string=\"📌 تثبيت\"/>"]], TC],

  // ---------------------------------------------------------------- ت — «📈 تاريخ الأسعار»
  ["ت", "a day with no price is a zero", [[PH, "return v > 0 ? v : null; });", "return v > 0 ? v : 0; });"]], TH],
  ["ت", "the line is drawn across the empty days", [[PH, "    if (lastRun && lastRun.at + lastRun.values.length === i) lastRun.values.push(v);", "    if (lastRun) lastRun.values.push(v);"]], TH],
  ["ت", "a lone day is a path of its own", [[PH, "runs(values).filter((r) => r.values.length > 1)\n", "runs(values)\n"]], TH],
  ["ت", "four days are enough", [[PH, "export const MIN_DAYS = 5;", "export const MIN_DAYS = 4;"]], TH],
  ["ت", "every item is drawn", [[PH, "enough: marketDays >= MIN_DAYS,", "enough: true,"]], TH],
  ["ت", "the guard counts the days of a purchase price", [[PH, "const marketDays = market.filter((v) => v !== null).length;", "const marketDays = purchase.filter((v) => v !== null).length;"]], TH],
  ["ت", "a card without enough days draws its chart all the same", [[PH, "  const body = c.enough ? chartSvg(c) : ", "  const body = true ? chartSvg(c) : "]], TH],
  ["ت", "the change is from the day before, empty or not", [[PH, PREV, ".filter((r) => r.day < lastMarket.day).pop()"]], TH],
  ["ت", "the last real day is looked for inside the period alone", [[PH, PREV, ".filter((r) => r.day >= from && r.day < lastMarket.day && price(r.market) > 0).pop()"]], TH],
  ["ت", "the change's per cent is of the new price", [[PH, "pct: round2((amount / prevMarket.value) * 100)", "pct: round2((amount / lastMarket.value) * 100)"]], TH],
  ["ت", "the same price is «▼ 0.00»", [[PH, "  if (c.change.amount === 0) return `بلا تغيير ${since}`;\n", ""]], TH],
  ["ت", "the reference is the full cost before its VAT", [[PH, "  if (r.breakEven > 0) return r.breakEven;\n", "  if (r.fullCost > 0) return r.fullCost;\n"]], TH],
  ["ت", "a line with the full cost alone gets it as it is", [[PH, "Math.round((Math.round(r.fullCost * 100) * (100 + VAT_PCT)) / 100) / 100 : 0;", "r.fullCost : 0;"]], TH],
  ["ت", "the reference stands on a day with no purchase", [[PH, "(price(r.purchase) > 0 ? referenceOf(r) : 0)", "referenceOf(r)"]], TH],
  ["ت", "the page opens by the name", [[PH, "    : move(b) - move(a) || byName(a, b)));", "    : byName(a, b)));"]], TH],
  ["ت", "an item with no change leads", [[PH, "(c.change ? Math.abs(c.change.pct) : -1)", "(c.change ? Math.abs(c.change.pct) : 999)"]], TH],
  ["ت", "a fall ranks under every rise", [[PH, "(c.change ? Math.abs(c.change.pct) : -1)", "(c.change ? c.change.pct : -1)"]], TH],
  ["ت", "«النشطة للبيع فقط» is ignored", [[PH, "    if (query.activeOnly && !p.activeForSale) continue;\n", ""]], TH],
  ["ت", "the category is ignored", [[PH, "query.category === null || c.categoryId === query.category", "true"]], TH],
  ["ت", "the page opens on thirty days", [[PH, "export const DEFAULT_PERIOD: Period = 14;", "export const DEFAULT_PERIOD: Period = 30;"]], TH],
  ["ت", "the page opens on every item, active for sale or not", [[PH, "activeOnly: p.get(\"all\") !== \"1\",", "activeOnly: p.get(\"all\") === \"0\","]], TH],
  ["ت", "a period that is not offered is taken", [[PH, "days: (PERIODS as readonly number[]).includes(d) ? (d as Period) : DEFAULT_PERIOD,", "days: d > 0 ? (d as Period) : DEFAULT_PERIOD,"]], TH],
  ["ت", "a line dated after today is shown", [[PH, "    if (!(r.productId > 0) || r.day > today) continue;", "    if (!(r.productId > 0)) continue;"]], TH],
  ["ت", "a simulated line is read", [[PH, "[[SIM_FIELD, \"=\", false], [`x_day_id.${SIM_FIELD}`, \"=\", false], ", "[[`x_day_id.${SIM_FIELD}`, \"=\", false], "]], TH],
  ["ت", "a simulated day's lines are read", [[PH, "[[SIM_FIELD, \"=\", false], [`x_day_id.${SIM_FIELD}`, \"=\", false], ", "[[SIM_FIELD, \"=\", false], "]], TH],
  ["ت", "the lines are read four hundred days back", [[PH, "export const LOOKBACK_DAYS = 90;", "export const LOOKBACK_DAYS = 400;"]], TH],
  ["ت", "any ticket opens the page", [[PH, "(model) => model === HISTORY_MODEL);", "() => true);"]], TH],
  ["ت", "the link's signature is not checked", [[PH, "  if (!sameText(await historySignature(env.ADMIN_TOKEN, expiry), signature)) return notFound();\n", ""]], TH],
  ["ت", "the link never ends", [[PH, "  if (!(expiry > now)) return messagePage(410, \"انتهت صلاحية الرابط\", AGAIN);\n", ""]], TH],
  ["ت", "the expiry is not under the signature", [[PH, "signDocToken(secret, `history:${expiry}`)", "signDocToken(secret, \"history\")"]], TH],
  ["ت", "the page's signature is a preview's", [[PH, "signDocToken(secret, `history:${expiry}`)", "signDocToken(secret, `preview:sq:1:${expiry}`)"]], TH],
  ["ت", "the link is given under the secret's own name in it", [[PH, "Location: await historyLinkPath(env.ADMIN_TOKEN, now + LINK_TTL_MS)", "Location: `${await historyLinkPath(env.ADMIN_TOKEN, now + LINK_TTL_MS)}?token=${env.ADMIN_TOKEN}`"]], TH],
  ["ت", "a worker with no secret serves the page", [[PH, "  if (!env.ADMIN_TOKEN) return notFound();\n", ""]], TH],
  ["ت", "the page may be cached on the way", [[PH, "\"Cache-Control\": \"private, no-store\", \"X-Robots-Tag\"", "\"Cache-Control\": \"public, max-age=600\", \"X-Robots-Tag\""]], TH],
  ["ت", "the page may run a script", [[PH, "\"default-src 'none'; style-src", "\"default-src *; script-src *; style-src"]], TH],
  ["ت", "a used ticket is not archived", [[PV, "vals: { x_used: true, x_active: false } });", "vals: { x_used: true } });"]], TH],
  ["ت", "an archived ticket reads as unknown, not as used", [[PV, "limit: 1, context: { active_test: false } });", "limit: 1 });"]], TH],
  ["ت", "a door burns a ticket that is not its own", [[PV, "  if (!row || !accepts(model, resId)) return messagePage(404, w.unknown, w.again);\n", "  if (!row) return messagePage(404, w.unknown, w.again);\n"]], TH],
  ["ت", "the page is 1200 px wide", [[PH, "export const MAX_WIDTH_PX = 960;", "export const MAX_WIDTH_PX = 1200;"]], TH],
  ["ت", "one card a row on every screen", [[PH, "@media (min-width:720px){.grid2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}\n", ""]], TH],
  ["ت", "no dark colours", [[PH, "@media (prefers-color-scheme: dark){:root{", "@media (prefers-color-scheme: none){:root{"]], TH],
  ["ت", "an item's name is written as markup", [[PH, "<h2>${esc(c.name)}</h2>", "<h2>${c.name}</h2>"]], TH],
  ["ت", "a number has one decimal", [[PH, "export const money = (n: number): string => n.toFixed(2);", "export const money = (n: number): string => n.toFixed(1);"]], TH],
  ["ت", "ninety days carry a marker a day", [[PH, "  const dense = n > 30;", "  const dense = false;"]], TH],
  ["ت", "the page's title is not its question", [[PH, "export const HISTORY_TITLE = \"كيف يتحرك سعر السوق مقابل شرائنا؟\";", "export const HISTORY_TITLE = \"📈 تاريخ الأسعار\";"]], TH],
  ["ت", "a control drops the other choices", [[PH, "const periods = PERIODS.map((d) => chip(`${d} يوماً`, { ...q, days: d }, q.days === d)).join(\"\");", "const periods = PERIODS.map((d) => chip(`${d} يوماً`, { ...DEFAULT_QUERY, days: d }, q.days === d)).join(\"\");"]], TH],
  ["ت", "the menu's action carries a fixed token", [[LIB, "    'url': 'https://${PROD_HOST}${HISTORY_PATH}' + ticket,", "    'url': 'https://${PROD_HOST}${HISTORY_PATH}' + ticket + '?token=fixed',"]], TH],
  ["ت", "the menu's ticket names another model", [[LIB, "'x_model': '${HISTORY_TICKET_MODEL}', 'x_res_id': 0})", "'x_model': 'sale.order', 'x_res_id': 0})"]], TH],
  ["ت", "the page opens in Odoo's own tab", [[LIB, "    'url': 'https://${PROD_HOST}${HISTORY_PATH}' + ticket,\n    'target': 'new',", "    'url': 'https://${PROD_HOST}${HISTORY_PATH}' + ticket,\n    'target': 'self',"]], TH],
  ["ت", "Odoo's own chart still opens on the line chart", [[LIB, "export const HISTORY_WINDOW_MODE = \"pivot,graph,list\";", "export const HISTORY_WINDOW_MODE = \"graph,pivot,list\";"]], TH],

  // ---------------------------------------------------------------- ب — § 62 د's leftovers
  ["ب", "the old download's path is not answered here (it falls to the worker's 404)", [[IDX, GONE, ""]], TB],
  ["ب", "the 410 carries content", [[IDX, "      return new Response(null, { status: 410, headers: { \"Cache-Control\": \"no-store\" } });", "      return new Response(\"gone\", { status: 410, headers: { \"Cache-Control\": \"no-store\" } });"]], TB],
  ["ب", "the 410 is for GET alone", [[IDX, "    if (url.pathname === SALE_PDF_GONE_PATH) {", "    if (request.method === \"GET\" && url.pathname === SALE_PDF_GONE_PATH) {"]], TB],
  ["ب", "«التعبئة» as text is not printed", [[SOQ, "  lines.forEach((l, i) => { const text = packTextOf(l); if (text) packagingNames[i] = text; });\n", ""]], TB],
  ["ب", "«العبوة» stands before «التعبئة»", [[SOQ, "if (text) packagingNames[i] = text; });", "if (text && !l.x_packaging_id) packagingNames[i] = text; });"]], TB],
  ["ب", "a text of spaces is a text", [[SOQ, "(typeof l.x_pack_text === \"string\" ? l.x_pack_text.trim() : \"\")", "(typeof l.x_pack_text === \"string\" ? l.x_pack_text : \"\")"]], TB],
  ["ب", "the line's «التعبئة» is not read", [[SOQ, "          \"x_pack_text\",\n", ""]], TB],
  ["ب", "«📄 أصدر عرض السعر» does not copy «التعبئة»", [[QT, "    x_pack_text: l.unit || false,\n", ""]], TB],
  ["ب", "a typed VAT-inclusive price is rewritten when the mode changes", [[SQ, KEPT, "grossOf(l.finalNet)"]], TB],
  ["ب", "a price typed before VAT does not move the one with it", [[SQ, KEPT, "l.finalPrice > 0 ? l.finalPrice : grossOf(l.finalNet)"]], TB],
  ["ب", "after a change of mode the mode's own price is always the typed one (a stale pair wipes or rewrites the typed price)", [[SQ, CHANGED, "finalsOf(l, net ? \"net\" : \"gross\")"]], TB],
  ["ب", "the mode of a calculation is never recorded on the request", [[SQ, "  if (q.calcMode !== q.priceMode) vals.x_calc_mode = q.priceMode;\n", ""]], TB],
  ["ب", "the recorded mode is never read", [[SQ, "calcMode: q.x_calc_mode === \"net\" || q.x_calc_mode === \"gross\" ? q.x_calc_mode : null,", "calcMode: null,"]], TB],
  ["ب", "a NEW request is read by which price moved (a price of the other kind alone becomes its final price)", [[SQ, " || (q.calcMode === null && !q.prepared);", ";"]], TB],
  ["ب", "a request calculated before § 64 is read by its mode alone", [[SQ, "(q.calcMode === null && !q.prepared)", "q.calcMode === null"]], TB],
  ["ب", "a line with no quantity: the price before VAT is always taken for the typed one", [[SQ, "  if (!(l.qty > 0)) return finalsOf(l, mode);\n", ""]], TB],
  ["ب", "the VAT-inclusive price is never seen to move", [[SQ, MOVED, "  const grossMoved = false;"]], TB],
  ["ب", "the VAT-inclusive price is always seen to move", [[SQ, MOVED, "  const grossMoved = true;"]], TB],
  ["ب", "both moved in «شاملة الضريبة»: the price before VAT wins", [[SQ, "  if (mode === \"gross\") return finalsOf(l, \"gross\");\n", ""]], TB],
  ["ب", "both moved in «قبل الضريبة»: the price with VAT wins", [[SQ, "  return finalsOf(l, netMoved ? \"net\" : \"gross\");", "  return finalsOf(l, \"gross\");"]], TB],
  ["ب", "in «قبل الضريبة» the price before VAT wins though it never moved", [[SQ, "  return finalsOf(l, netMoved ? \"net\" : \"gross\");", "  return finalsOf(l, \"net\");"]], TB],
  ["ب", "the preview reads the mode's own price after a change of mode", [[SQ, "  return modeSettled(q) ? finalsOf(l, q.priceMode) : finalsAfterModeChange(l, q.priceMode);", "  return finalsOf(l, q.priceMode);"]], TB],
  ["ب", "«وضع آخر حساب» is free text in Odoo", [[LIB, "{ name: \"x_calc_mode\", ttype: \"selection\",", "{ name: \"x_calc_mode\", ttype: \"char\","]], TB],
  ["ب", "the page's padding is not repeated at a sheet's break", [[PT, FLOW, ".utak-page { padding-bottom: 0 !important; }"]], TB],
  ["ب", "the bottom padding is repeated too (the first sheet loses room)", [[PT, FLOW, ".utak-page { -webkit-box-decoration-break: clone; box-decoration-break: clone; }"]], TB],
  ["ب", "no room under the page's foot", [[PT, "\n  ${PAGE_FOOT_SELECTOR} { margin-bottom: ${BRAND_TYPE.pagePadding}; }`;", "`;"]], TB],
  ["ب", "the room under the foot is on another block", [[PT, "export const PAGE_FOOT_SELECTOR = \".utak-page > [data-utak=page-foot]\";", "export const PAGE_FOOT_SELECTOR = \".utak-page > .utak-block\";"]], TB],
  ["ب", "the automation reads «الأسعار في العرض» alone", [[LIB, "fields: [\"x_price_mode\", \"x_layout\"] };", "fields: [\"x_price_mode\"] };"]], TB],
  ["ب", "the automation presses «📄 أصدر» instead of «🔄 احسب»", [[LIB, "export const RECALC_HOOK_ACTION = \"utak.special_quote.recalc_webhook\";", "export const RECALC_HOOK_ACTION = \"utak.special_quote.issue_webhook\";"]], TB],
  ["ب", "the automation runs on a new request too", [[LIB, "model: QUOTE_MODEL, trigger: \"on_write\", fields:", "model: QUOTE_MODEL, trigger: \"on_create_or_write\", fields:"]], TB],
  ["ب", "a seventh ticket is archived with the six", [[LIB, "export const TICKETS_TO_ARCHIVE = [1, 2, 3, 4, 5, 6];", "export const TICKETS_TO_ARCHIVE = [1, 2, 3, 4, 5, 6, 7];"]], TB],
  ["ب", "another view is switched off for the old button's", [[LIB, "export const OLD_PDF_VIEW_ID = 2789;", "export const OLD_PDF_VIEW_ID = 2787;"]], TB],
  ["ب", "S00015's lines are filled, not S00016's", [[LIB, "export const PACK_FILL = { sale: \"S00016\", quote: 2 };", "export const PACK_FILL = { sale: \"S00015\", quote: 2 };"]], TB],
  ["ب", "the worker does not archive the ticket it burns (the source's own words)", [[PV, "vals: { x_used: true, x_active: false } });", "vals: { x_used: true } });"]], TB],
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
writeFileSync(new URL("../artifacts/s64-20261007-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
