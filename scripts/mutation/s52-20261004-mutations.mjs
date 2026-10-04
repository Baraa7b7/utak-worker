// Mutation check for § 52 (2026-10-04) — the price form by category (Flow v2), the outside market
// source, the VAT line by role, the official template, the form after the old template and the 05:00
// reminder to the market sources: each mutation disables ONE guard, runs tests/s52.test.mts, and must
// make it fail. The source is restored in `finally` after every run; a pattern that is not found
// exactly once stops the script. (The transfer line — § 52 أ — has its own script:
// scripts/mutation/s52-20261004-iban-mutations.mjs.)
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// some mutations edit scripts/lib/s52-price-flow.mjs in place, and the Meta script reading a mutated
// lib would send it to Meta.
//
//   node scripts/mutation/s52-20261004-mutations.mjs [ب|ج|د|هـ|و|ز …]     (no argument: every part)
//
// Out: scripts/artifacts/s52-20261004-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s52.test.mts";
const PF = "src/price-flow.ts";
const SU = "src/suppliers.ts";
const PS = "src/price-sources.ts";
const TQ = "src/team-queue.ts";
const IX = "src/index.ts";
const EN = "src/pricing-engine.ts";
const PR = "src/prices.ts";
const TS = "src/wa-template-sync.ts";
const LIB = "scripts/lib/s52-price-flow.mjs";
const DOC = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- هـ the Flow at Meta
  ["هـ", "a page of the Flow at Meta has fourteen fields", [[LIB,
    "export const FLOW_PAGE_SLOTS = 15;", "export const FLOW_PAGE_SLOTS = 14;"]], T],
  ["هـ", "the Flow has three pages", [[LIB,
    "export const FLOW_PAGES = [\"PAGE_A\", \"PAGE_B\", \"PAGE_C\", \"PAGE_D\"];", "export const FLOW_PAGES = [\"PAGE_A\", \"PAGE_B\", \"PAGE_C\"];"]], T],
  ["هـ", "the routes are left to Meta (the «التالي» inside an If is not followed)", [[LIB,
    "routing_model: flowRoutingModel(), screens:", "screens:"]], T],
  ["هـ", "a page's fields are required", [[LIB,
    "          required: false,", "          required: true,"]], T],
  ["هـ", "a page's fields are free text", [[LIB,
    "          \"input-type\": \"number\",", "          \"input-type\": \"text\","]], T],
  ["هـ", "a later page reads its own (empty) data", [[LIB,
    "const ref = (k, key) => (k === 1 ?", "const ref = (k, key) => (true ?"]], T],
  ["هـ", "«إرسال» while a page follows, «التالي» on the last one", [[LIB,
    "then: [nextFooter(k)], else: [submitFooter(k)] }", "then: [submitFooter(k)], else: [nextFooter(k)] }"]], T],
  ["هـ", "«إرسال» sends its own page's fields alone", [[LIB,
    "  const upTo = Array.from({ length: k * FLOW_PAGE_SLOTS }, (_, i) => i + 1);", "  const upTo = pageSlots(k);"]], T],
  ["هـ", "an earlier page's field is read from the last page's form", [[LIB,
    "  return owner === k ?", "  return true ?"]], T],
  ["هـ", "only the last page can end the Flow", [[LIB,
    "    terminal: true,", "    terminal: last,"]], T],
  ["هـ", "the page has no heading of its category", [[LIB,
    "        { type: \"TextHeading\", text: ref(k, `t${k}`) },", "        { type: \"TextHeading\", text: ref(k, \"sub\") },"]], T],
  ["هـ", "the worker still sends utak_price_ask_v1", [[PF,
    "export const PRICE_FLOW_ID = \"1123704886881420\";", "export const PRICE_FLOW_ID = \"1086052444016554\";"]], T],
  ["هـ", "the worker opens v1's screen", [[PF,
    "export const PRICE_FLOW_SCREEN = \"PAGE_A\";", "export const PRICE_FLOW_SCREEN = \"PRICES\";"]], T],
  ["هـ", "the worker fills three pages", [[PF,
    "export const PRICE_FLOW_PAGES = 4;", "export const PRICE_FLOW_PAGES = 3;"]], T],
  ["هـ", "vegetables before fruits", [[PF,
    "[{ id: 5, title: \"فواكه\" }, { id: 6, title: \"خضار\" }, { id: 7, title: \"ورقيات\" }];", "[{ id: 6, title: \"خضار\" }, { id: 5, title: \"فواكه\" }, { id: 7, title: \"ورقيات\" }];"]], T],
  ["هـ", "an empty category takes a page", [[PF,
    "items: all.filter((i) => !(of.get(i.productId) ?? 0)) }].filter((g) => g.items.length);", "items: all.filter((i) => !(of.get(i.productId) ?? 0)) }];"]], T],
  ["هـ", "an item of no category has no field", [[PF,
    "{ title: FLOW_OTHER_TITLE, items: all.filter((i) => !(of.get(i.productId) ?? 0)) }", "{ title: FLOW_OTHER_TITLE, items: all.filter(() => false) }"]], T],
  ["هـ", "a child category is not its root's", [[PF,
    "c && hops < 20; c = cats.get(m2oId(c.parent_id)), hops++) {\n      if (titles.has(c.id))", "c && hops < 1; c = cats.get(m2oId(c.parent_id)), hops++) {\n      if (titles.has(c.id))"]], T],
  ["هـ", "the page's heading is not the category's name in Odoo", [[PF,
    "if (name) titles.set(c.id, name); }", "}"]], T],
  ["هـ", "the sixteenth item of a category spills into the next page", [[PF,
    "g.items.slice(0, PRICE_FLOW_PAGE_SLOTS).map((it, j) =>", "g.items.slice(0, PRICE_FLOW_PAGE_SLOTS + 1).map((it, j) =>"]], T],
  ["هـ", "every page's items take the first page's slots", [[PF,
    "({ it, slot: k * PRICE_FLOW_PAGE_SLOTS + j + 1 })", "({ it, slot: j + 1 })"]], T],
  ["هـ", "the overflow alert names no category", [[PF,
    "over: groups.filter((g) => g.items.length > PRICE_FLOW_PAGE_SLOTS).map(", "over: groups.filter(() => false).map("]], T],
  ["هـ", "«التالي» is never shown", [[PF,
    "    if (k < PRICE_FLOW_PAGES) data[`m${k}`] = k < pages.length;", "    if (k < PRICE_FLOW_PAGES) data[`m${k}`] = false;"]], T],
  ["هـ", "«التالي» on the last page that has items", [[PF,
    "    if (k < PRICE_FLOW_PAGES) data[`m${k}`] = k < pages.length;", "    if (k < PRICE_FLOW_PAGES) data[`m${k}`] = k <= pages.length;"]], T],
  ["هـ", "a page has no heading in the data", [[PF,
    "    data[`t${k}`] = pages[k - 1] ?? \"-\";", "    data[`t${k}`] = \"-\";"]], T],
  ["هـ", "«تعديل» opens one page whatever the form had", [[PF,
    "  let pages = opts.pages?.length ? opts.pages : [FLOW_PLAIN_TITLE];", "  let pages = [FLOW_PLAIN_TITLE];"]], T],
  ["هـ", "the token is kept without its pages", [[PF,
    "name: src.name, supplier: src.supplier, kind, items, pages, createdAt: now,", "name: src.name, supplier: src.supplier, kind, items, createdAt: now,"]], T],
  ["هـ", "a v1 token is refused after § 52", [[PF,
    "    return rec && (rec.v === 1 || rec.v === 2) && Array.isArray(rec.items) ? rec : null;", "    return rec && rec.v === 2 && Array.isArray(rec.items) ? rec : null;"]], T],
  // ---------------------------------------------------------------- ج the VAT line by role
  ["ج", "the form tells a «سوق» source «بدون ضريبة»", [[PF,
    "  market: \"اكتب السعر زي ما ينباع في السوق (شامل الضريبة).\",\n};\nexport const PRICE_FLOW_EMPTY_NOTE", "  market: \"الأسعار بدون ضريبة.\",\n};\nexport const PRICE_FLOW_EMPTY_NOTE"]], T],
  ["ج", "the form's line does not follow the role", [[PF,
    "export const flowNote = (kind: PriceKind): string => `${VAT_LINE[kind]} ${PRICE_FLOW_EMPTY_NOTE}`;", "export const flowNote = (kind: PriceKind): string => `${VAT_LINE.purchase} ${PRICE_FLOW_EMPTY_NOTE}`;"]], T],
  ["ج", "the form tells a «شراء» source nothing about the tax", [[PF,
    "  purchase: \"الأسعار بدون ضريبة.\",\n  market: \"اكتب السعر", "  purchase: \"\",\n  market: \"اكتب السعر"]], T],
  ["ج", "the ask above the button tells a «سوق» source «بدون ضريبة»", [[PF,
    "  market: \"اضغط «أدخل الأسعار» واكتب السعر زي ما ينباع في السوق (شامل الضريبة).\",", "  market: \"اضغط «أدخل الأسعار» وعبّ سعر كل صنف (بدون ضريبة).\","]], T],
  ["ج", "the reminder to a «سوق» source asks for «أسعارك»", [[PF,
    "${kind === \"market\" ? \"أسعار السوق\" : \"أسعارك\"}", "${\"أسعارك\"}"]], T],
  ["ج", "the free-text ask of a «سوق» source has no VAT line", [[PS,
    "وسعر السوق لكل صنف. ${MARKET_VAT_LINE}`;", "وسعر السوق لكل صنف.`;"]], T],
  ["ج", "the market line says «بدون ضريبة»", [[PS,
    "export const MARKET_VAT_LINE = \"اكتب السعر زي ما ينباع في السوق (شامل الضريبة).\";", "export const MARKET_VAT_LINE = \"الأسعار بدون ضريبة.\";"]], T],
  ["ج", "the engine reads a market observation as net of VAT", [[EN,
    "      if (suggested !== null) { if (sale < suggested - 0.0001) exceptions.push(\"below_profit\"); }", "      if (suggested !== null) { if (sale * 1.15 < suggested - 0.0001) exceptions.push(\"below_profit\"); }"]], T],
  ["ج", "the profit keeps the VAT of the market price", [[EN,
    "  return (vatRatePct ? sale / (1 + vatRatePct / 100) : sale) - purchase - waste;", "  return sale - purchase - waste;"]], T],
  // ---------------------------------------------------------------- د the template
  ["د", "the template opens with a greeting and an emoji", [[LIB,
    "  body: \"طلب تحديث الأسعار ليوم {{1}}", "  body: \"صباح الخير 🌿 طلب تحديث الأسعار ليوم {{1}}"]], T],
  ["د", "the template is submitted MARKETING", [[LIB,
    "    category: \"UTILITY\",", "    category: \"MARKETING\","]], T],
  ["د", "the template's button opens the second page", [[LIB,
    "navigate_screen: FLOW_FIRST_SCREEN }", "navigate_screen: FLOW_PAGES[1] }"]], T],
  ["د", "the template's button is a quick reply", [[LIB,
    "buttons: [{ type: \"FLOW\", text: t.button,", "buttons: [{ type: \"QUICK_REPLY\", text: t.button,"]], T],
  ["د", "the worker names v1's template", [[PF,
    "export const PRICE_FLOW_TEMPLATE = \"utak_price_ask_flow_v2\";", "export const PRICE_FLOW_TEMPLATE = \"utak_price_ask_flow_v1\";"]], T],
  ["د", "the worker sends two variables to a template of one", [[PF,
    "export const flowAskParams = (day: string): string[] => [arabicDate(day)];", "export const flowAskParams = (day: string): string[] => [arabicDate(day), arabicDate(day)];"]], T],
  ["د", "a PENDING template counts as usable", [[PF,
    "    if (utility.some((r) => String(r.x_meta_status || \"\").toUpperCase() === \"APPROVED\")) return \"ready\";", "    if (utility.length) return \"ready\";"]], T],
  ["د", "a MARKETING template counts as usable", [[PF,
    "    const utility = rows.filter((r) => String(r.x_category || \"\").toUpperCase() === \"UTILITY\");", "    const utility = rows;"]], T],
  ["د", "a usable template is not checked at Meta before the ask (re-filed MARKETING, it is still sent)", [[PF,
    "  if (state !== \"pending\" && state !== \"ready\") return state;", "  if (state !== \"pending\") return state;"]], T],
  ["د", "the check before the ask does not write Meta's category", [[TS,
    "vals: { x_meta_status: t.status, x_category: t.category, x_last_synced: nowOdoo() } });\n  return \"changed\";", "vals: { x_meta_status: t.status, x_last_synced: nowOdoo() } });\n  return \"changed\";"]], T],
  ["د", "the check before the ask does not write Meta's status (an evening approval waits for 05:00)", [[TS,
    "vals: { x_meta_status: t.status, x_category: t.category, x_last_synced: nowOdoo() } });\n  return \"changed\";", "vals: { x_category: t.category, x_last_synced: nowOdoo() } });\n  return \"changed\";"]], "tests/s51.test.mts"],
  ["د", "the check before the ask writes the row even when nothing changed", [[TS,
    "  if (!off.length) return \"same\";\n", ""]], T],
  ["د", "a template whose name contains this one's is taken for it", [[TS,
    ".data?.find((x) => x.name === name);", ".data?.find((x) => x.name.includes(name));"]], T],
  ["د", "the check before the ask is a full sync of every template", [[PF,
    "    await syncOneTemplate(env, PRICE_FLOW_TEMPLATE);", "    await (await import(\"./wa-template-sync\")).runTemplateSync(env);"]], T],
  // ---------------------------------------------------------------- ب رائد
  ["ب", "a supplier counts as an outside source", [[PS,
    "domain: [[SOURCE_FIELD, \"=\", true], [\"supplier_rank\", \"=\", 0], [\"customer_rank\", \"=\", 0],", "domain: [[SOURCE_FIELD, \"=\", true], [\"customer_rank\", \"=\", 0],"]], T],
  ["ب", "a customer who is a source counts as an outside source", [[PS,
    "domain: [[SOURCE_FIELD, \"=\", true], [\"supplier_rank\", \"=\", 0], [\"customer_rank\", \"=\", 0],", "domain: [[SOURCE_FIELD, \"=\", true], [\"supplier_rank\", \"=\", 0],"]], T],
  ["ب", "a partner that is no price source counts as an outside source", [[PS,
    "domain: [[SOURCE_FIELD, \"=\", true], [\"supplier_rank\", \"=\", 0], [\"customer_rank\", \"=\", 0],", "domain: [[\"supplier_rank\", \"=\", 0], [\"customer_rank\", \"=\", 0],"]], T],
  ["ب", "the outside source is routed as a customer", [[IX,
    "      sourceMatch = !t && !sup && !cus && src ? { id: src.id, name: src.name } : null;", "      sourceMatch = null;"]], T],
  ["ب", "the outside source's message falls through to the customer path", [[IX,
    "    if (sourceMatch) {\n      await outsideSourceMessage(env, sourceMatch, msg, ctx);\n      await markSeen(env, msg.messageId);\n      continue;\n    }\n", ""]], T],
  ["ب", "a customer partner is made for the outside source's number", [[IX,
    "          supplier: sup ? { id: sup.id, name: sup.name } : sourceMatch,", "          supplier: sup ? { id: sup.id, name: sup.name } : null,"]], T],
  ["ب", "the outside source's voice note gets the customer's media handling", [[IX,
    "      if (!teamMatch && !supplierMatch && !sourceMatch && ingestRoute !== \"owner\"", "      if (!teamMatch && !supplierMatch && ingestRoute !== \"owner\""]], T],
  ["ب", "the outside source's text is never read as prices", [[IX,
    "      const r = await tryMarketReply(env, { partnerId: source.id, name: source.name }, msg.from, msg.text, msg.messageId);", "      const r = null as string | null;"]], T],
  ["ب", "the outside source's message is not acknowledged", [[IX,
    "    await sendText(env, msg.from, OUTSIDE_SOURCE_ACK, { ctx, purpose: \"bot_reply\" });\n", ""]], T],
  ["ب", "Baraa is not told of the outside source's message", [[IX,
    "    await sendOwnerAlert(env, outsideSourceAlert(source.name, msg.from, msg.text || `[${msg.type}]`));\n", ""]], T],
  ["ب", "the outside source is acknowledged on top of the form", [[IX,
    "  if (await owedPriceForm(env, msg.from)) handled = true;\n", "  await owedPriceForm(env, msg.from);\n"]], T],
  ["ب", "02:30: an outside source outside its window gets no template (its ask is held)", [[PS,
    "      } else if (await askByOldTemplate(jenv, t, nowMs).catch(", "      } else if (false && await askByOldTemplate(jenv, t, nowMs).catch("]], T],
  ["ب", "the old template carries no item of today", [[PS,
    "params: supplierAskParams(tmpl.x_meta_template_id, name, list) },\n  }));", "params: supplierAskParams(tmpl.x_meta_template_id, name, \"\") },\n  }));"]], T],
  ["ب", "an old template that did not go still counts as the ask (no text ask, a form owed)", [[PS,
    "  if (d?.action !== \"template\") return false;\n  if (!t.employeeId) {", "  if (!t.employeeId) {"]], T],
  ["ب", "the outside source waits in a team queue it never flushes", [[PS,
    "...src.partners.filter((p) => !p.supplier && !emp.has(p.partnerId)).map((p) => ({ partnerId: p.partnerId, employeeId: null,", "...src.partners.filter((p) => !p.supplier && !emp.has(p.partnerId)).map((p) => ({ partnerId: p.partnerId, employeeId: 1,"]], T],
  // ---------------------------------------------------------------- و the form after the old template
  ["و", "02:00: the old template leaves no form owed", [[SU,
    "      await priceFlow.markFlowOwed(env, flowSrc);\n", ""]], T],
  ["و", "02:30: the old template leaves no form owed to the outside source", [[PS,
    "  if (!t.employeeId) {\n    const { markFlowOwed }", "  if (false) {\n    const { markFlowOwed }"]], T],
  ["و", "the supplier's text brings no owed form", [[IX,
    "      // kept: his window has just opened, so the form goes now (once a day).\n      await owedPriceForm(env, msg.from);\n", "      // kept: his window has just opened, so the form goes now (once a day).\n"]], T],
  ["و", "the supplier's button tap brings no owed form", [[IX,
    "        if (replyText) await sendText(env, msg.from, replyText, { ctx, purpose: \"bot_reply\" });\n        await owedPriceForm(env, msg.from);\n", "        if (replyText) await sendText(env, msg.from, replyText, { ctx, purpose: \"bot_reply\" });\n"]], T],
  ["و", "the supplier's voice note brings no owed form", [[IX,
    "          console.warn(\"[media] supplier handling failed\", (e as Error)?.message);\n        }\n        await owedPriceForm(env, msg.from);\n", "          console.warn(\"[media] supplier handling failed\", (e as Error)?.message);\n        }\n"]], T],
  ["و", "the owed form goes with every message of the day", [[PF,
    "  if (!claim.claimed) return false;\n  try {\n    const r = await sendFlowAsk(env, { ...owed.src, whatsapp: to }, { now });", "  try {\n    const r = await sendFlowAsk(env, { ...owed.src, whatsapp: to }, { now });"],
    [PF, "    await finishButton(env, claim, DAY_TTL);\n    await clearFlowOwed(env, to);\n", "    await finishButton(env, claim, DAY_TTL);\n"]], T],
  ["و", "the owed form goes after the day's publication", [[PF,
    "  if (await dayPublished(env, day).catch(() => false)) { await clearFlowOwed(env, to); return false; }\n", ""]], T],
  ["و", "yesterday's owed form goes today", [[PF,
    "  if (owed.day !== day) { await clearFlowOwed(env, to); return false; }\n", ""]], T],
  ["و", "text prices that were kept still bring the form (supplier)", [[SU,
    "await markPricesArrived(env, supplier.x_whatsapp_number, riyadhDateKey());", "void markPricesArrived;"]], T],
  ["و", "text prices that were kept still bring the form (market source)", [[PS,
    "await markPricesArrived(env, src.digits, day);", "void markPricesArrived;"]], T],
  ["و", "a queued ask is sent on top of prices that arrived by the form", [[PF,
    "    if (!rec.test && w.saved.length) await markPricesArrived(env, to, rec.day);\n", ""]], T],
  ["و", "the flush sends a queued ask whatever arrived", [[TQ,
    "      if (await pricesArrived(env, to, riyadhDateKey())) { console.log(\"[pending_loc] market ask dropped: today's prices already arrived\"); continue; }\n", ""]], T],
  ["و", "«ما قدرنا نقرأ الأسعار…»: a «سوق» source is told to write «شراء»", [[PS,
    "    return { saved: 0, reply: marketUnreadText(src.role ?? null, src.outside === true) };", "    return { saved: 0, reply: marketUnreadText(null, src.outside === true) };"]], T],
  ["و", "the «سوق» text's example carries a purchase price", [[PS,
    "ثم سعر السوق، مثل «رمان كبير 26». ${MARKET_VAT_LINE}`", "ثم سعر السوق، مثل «رمان كبير 26»، ولسعر الشراء «رمان كبير 26 شراء 22». ${MARKET_VAT_LINE}`"]], T],
  ["و", "05:00: the reminder goes before 05:00", [[PS,
    "  if (m < MARKET_NUDGE_MINUTE) return { action: \"before\" };\n", ""]], T],
  ["و", "05:00: the reminder goes after the publication time", [[PS,
    "  if (m >= untilMinute) return { action: \"after\" }; // the day's prices are due: no reminder after them\n", ""]], T],
  ["و", "05:00: the reminder's claim is not checked (the gateway is asked every tick)", [[PS,
    "    if (!claim.claimed) { nudges.push({ name: t.name, action: \"claimed_before\" }); continue; }\n", ""]], T],
  ["و", "05:00: a source that sent a price is reminded", [[PS,
    "      if (await hasOffersToday(env, t.partnerId, day)) action = \"replied\";\n      else if", "      if (false) action = \"replied\";\n      else if"]], T],
  ["و", "05:00: an employee on his day off is reminded", [[PS,
    "return h.hold && h.phase !== \"before\"; })()) action = \"off\";", "return false; })()) action = \"off\";"]], T],
  ["و", "05:00: an employee who has not tapped is not reminded", [[PS,
    "return h.hold && h.phase !== \"before\"; })()) action = \"off\";", "return h.hold; })()) action = \"off\";"]], T],
  ["و", "05:00: the reminder is the ask's text", [[PS,
    "{ now: nowMs, body: flowNudgeText(cutoffLabel(ORDERING_HOURS_OPEN), sourceKind(nudgeSrc)) }", "{ now: nowMs }"]], T],
  ["و", "05:00: no old template outside the window", [[PS,
    "        else if (await askByOldTemplate(jenv, t, nowMs)) action = \"old_template\";", "        else if (false) action = \"old_template\";"]], T],
  ["و", "05:00: a text reply after the reminder is not read as prices", [[PS,
    "        if (action === \"flow\" || action === \"template\" || action === \"old_template\") await writeMarketAskMarker(env, t.whatsapp, day, nowMs);\n", ""]], T],
  ["و", "the tick never runs the reminder", [[PR,
    "    out.marketNudge = await runMarketNudge(env, now, dl);\n", ""]], T],
  // ---------------------------------------------------------------- ز the trial
  ["ز", "v1's trial of the same day uses up v2's", [[PF,
    "`pflow_test:${PRICE_FLOW_ID}:${riyadhDateKey(new Date(now))}`", "`pflow_test:${riyadhDateKey(new Date(now))}`"]], T],
  ["ز", "the trial's heading is plain", [[PF,
    "pages.map((t) => pageTitle(t, !!opts.test))", "pages.map((t) => pageTitle(t, false))"]], T],
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
      writeFileSync(path, cur.replace(find, () => replace));
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
writeFileSync(new URL("../artifacts/s52-20261004-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
