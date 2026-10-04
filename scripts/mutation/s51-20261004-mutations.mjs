// Mutation check for § 51 (2026-10-04) — the price ask as a WhatsApp Flow: each mutation disables ONE
// guard, runs tests/s51.test.mts, and must make it fail. The source is restored in `finally` after
// every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// some mutations edit scripts/lib/s51-price-flow.mjs in place, and the Meta script reading a mutated
// lib would send it to Meta.
//
//   node scripts/mutation/s51-20261004-mutations.mjs [أ|ب|ج|د|هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s51-20261004-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s51.test.mts";
const PF = "src/price-flow.ts";
const SU = "src/suppliers.ts";
const PS = "src/price-sources.ts";
const TQ = "src/team-queue.ts";
const MT = "src/meta.ts";
const IX = "src/index.ts";
const GW = "src/wa-gateway.ts";
const WP = "src/wa-purposes.ts";
const LIB = "scripts/lib/s51-price-flow.mjs";
const DOC = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the form
  ["أ", "the worker fills sixteen slots of a fifteen-field page", [[PF,
    "export const PRICE_FLOW_PAGE_SLOTS = 15;", "export const PRICE_FLOW_PAGE_SLOTS = 16;"]], T],
  ["أ", "the Flow at Meta has fourteen fields", [[LIB,
    "export const FLOW_SLOTS = 15;", "export const FLOW_SLOTS = 14;"]], T],
  ["أ", "the Flow's fields are required", [[LIB,
    "            required: false,", "            required: true,"]], T],
  ["أ", "the Flow's fields are free text", [[LIB,
    "            \"input-type\": \"number\",", "            \"input-type\": \"text\","]], T],
  ["أ", "the Flow's line above the fields does not say «بدون ضريبة»", [[LIB,
    "export const FLOW_NOTE = \"الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر.\";", "export const FLOW_NOTE = \"اترك الخانة فاضية لو الصنف غير متوفر.\";"]], T],
  ["أ", "the worker's line above the fields does not say «بدون ضريبة»", [[PF,
    "  purchase: \"الأسعار بدون ضريبة.\",\n  market: \"اكتب السعر", "  purchase: \"\",\n  market: \"اكتب السعر"]], T],
  ["أ", "the template's button is not a FLOW button", [[LIB,
    "buttons: [{ type: \"FLOW\", text: t.button,", "buttons: [{ type: \"QUICK_REPLY\", text: t.button,"]], T],
  ["أ", "the purchase ask inside the window does not say «بدون ضريبة»", [[PF,
    "  purchase: \"اضغط «أدخل الأسعار» وعبّ سعر كل صنف (بدون ضريبة).\",", "  purchase: \"اضغط «أدخل الأسعار» وعبّ سعر كل صنف.\","]], T],
  ["أ", "the heading is «أسعار الشراء» for a «سوق» source too", [[PF,
    "(kind === \"purchase\" ? \"أسعار الشراء\" : \"أسعار السوق\");", "(kind === \"purchase\" ? \"أسعار الشراء\" : \"أسعار الشراء\");"]], T],
  ["أ", "a label longer than Meta's twenty characters is sent whole", [[PF,
    "export const LABEL_MAX = 20;", "export const LABEL_MAX = 40;"]], T],
  ["أ", "a hint longer than Meta's eighty characters is sent whole", [[PF,
    "export const HINT_MAX = 80;", "export const HINT_MAX = 400;"]], T],
  ["أ", "the hint is empty when there is no last price", [[PF,
    "`آخر سعر: ${money(last)}` : NO_LAST_PRICE;", "`آخر سعر: ${money(last)}` : \"\";"]], T],
  ["أ", "the product's code stays in its label", [[PF,
    "String(s ?? \"\").replace(/^\\[[^\\]]*\\]\\s*/, \"\").replace(/\\s+/g, \" \").trim();", "String(s ?? \"\").replace(/\\s+/g, \" \").trim();"]], T],
  ["أ", "a hidden slot is shown", [[PF,
    "    data[`v${n}`] = !!it;", "    data[`v${n}`] = true;"]], T],
  ["أ", "the form never opens with a value", [[PF,
    "    data[`i${n}`] = it && init[n] > 0 ? money(init[n]) : \"\";", "    data[`i${n}`] = \"\";"]], T],
  ["أ", "a simulation row's price is a hint", [[PF,
    "[f, \">\", 0], [SIM_FIELD, \"!=\", true]],", "[f, \">\", 0]],"]], T],
  ["أ", "the hint is the oldest price, not the newest", [[PF,
    "      if (!out.has(key) && Number(r[f]) > 0) out.set(key, Number(r[f]));", "      if (Number(r[f]) > 0) out.set(key, Number(r[f]));"]], T],
  ["أ", "no active item still makes a form", [[PF,
    "  if (!items.length) return null;\n", ""]], T],
  ["أ", "the sixteenth item is dropped silently", [[PF,
    "    if (built.left.length) await alertOverflow(env, day, built.over, built.left);", "    if (built.left.length > 1) await alertOverflow(env, day, built.over, built.left);"]], T],
  ["أ", "the overflow alert goes with every ask of the day", [[PF,
    "  if (!claim.claimed) return;\n", ""]], T],
  ["أ", "a supplier's role on his card is ignored", [[PF,
    "PriceKind => s.role ?? (s.supplier ? \"purchase\" : \"market\");", "PriceKind => (s.supplier ? \"purchase\" : \"market\");"]], T],
  ["أ", "the token is not kept with its number", [[PF,
    "day, to: waDigits(src.whatsapp), partnerId: src.partnerId,", "day, to: \"\", partnerId: src.partnerId,"]], T],
  // ---------------------------------------------------------------- ب the ask
  ["ب", "the template goes even inside the window", [[PF,
    "    content: p.session,\n    fallback: opts.test ? [] : [p.template],", "    content: opts.test ? p.session : p.template,\n    fallback: opts.test ? [] : [p.session],"]], T],
  ["ب", "a template that is not APPROVED counts as usable", [[PF,
    "    if (utility.some((r) => String(r.x_meta_status || \"\").toUpperCase() === \"APPROVED\")) return \"ready\";", "    if (utility.length) return \"ready\";"]], T],
  ["ب", "a MARKETING template counts as usable", [[PF,
    "    const utility = rows.filter((r) => String(r.x_category || \"\").toUpperCase() === \"UTILITY\");", "    const utility = rows;"]], T],
  ["ب", "Meta's list is read before every ask, whatever the template's state", [[PF,
    "  if (state !== \"pending\" && state !== \"ready\") return state;", "  if (state === \"ready\") return state;"]], T],
  ["ب", "a PENDING template is never read again from Meta", [[PF,
    "  if (state !== \"pending\" && state !== \"ready\") return state;", "  if (state) return state;"]], T],
  ["ب", "with neither the window nor the template the gateway is still asked (a «skipped» line)", [[PF,
    "  if (!(await readWindow(env, to, now)).open && (opts.test || !(await flowTemplateReady(env)))) return { via: null, duplicate: false, reason: \"not_usable\" };\n", ""]], T],
  ["ب", "a refused Flow leaves its token behind", [[PF,
    "    try { await env.MSG_DEDUP.delete(flowTokenKey(p.record.token)); } catch { /* expires on its own */ }\n", ""]], T],
  ["ب", "the Flow ask is a marketing purpose", [[WP,
    "  price_ask_flow: op(\"نموذج طلب الأسعار\"),", "  price_ask_flow: { label: \"نموذج طلب الأسعار\", kind: \"marketing\", important: false, ttl: \"day\" },"]], T],
  ["ب", "the template's FLOW button carries nothing", [[GW,
    "  if (opt.flow) {", "  if (false) {"]], T],
  ["ب", "02:00: the old template goes as well as the Flow", [[SU,
    "by Flow (${flow.via}) log=${flowLog}`);\n        continue;", "by Flow (${flow.via}) log=${flowLog}`);"]], T],
  ["ب", "02:00: a Flow ask is not logged as an ask", [[SU,
    "        const flowLog = await createSupplierAskLog(env, s.id);", "        const flowLog = 0;"]], T],
  ["ب", "02:00: a Flow refused as a duplicate falls to the old template", [[SU,
    "      if (flow?.duplicate) {\n        skippedDuplicate++;", "      if (false) {\n        skippedDuplicate++;"]], T],
  ["ب", "02:00: the supplier's role is not read", [[SU,
    "whatsapp: s.x_whatsapp_number, supplier: true, role: await partnerPriceRole(env, s.id) };", "whatsapp: s.x_whatsapp_number, supplier: true, role: null };"]], T],
  ["ب", "02:00: a PENDING template is not read again before the ask", [[SU,
    "  if (!isSimRun(env)) await priceFlow.refreshFlowTemplate(env);", "  if (false) await priceFlow.refreshFlowTemplate(env);"]], T],
  ["ب", "05:00: the old reminder goes as well as the Flow", [[SU,
    "      if (flow?.via) { nudged++; continue; }", "      if (flow?.via) { nudged++; }"]], T],
  ["ب", "05:00: the reminder inside the window is the ask's text", [[SU,
    "{ body: flowNudgeText(needBy, sourceKind(flowSrc)) })", "{})"]], T],
  ["ب", "05:00: the reminder's Flow text asks for no deadline", [[PF,
    "اليوم للحين، نحتاجها قبل الساعة ${needBy} لو سمحت. ${FILL_LINE[kind]}", "اليوم للحين، نحتاجها لو سمحت. ${FILL_LINE[kind]}"]], T],
  ["ب", "02:30: the Flow is sent under the cron's job (a «duplicate» of another interactive message that day)", [[PS,
    "        const r = await sendFlowAsk(jenv, flowSrc, { now: nowMs });", "        const r = await sendFlowAsk(env, flowSrc, { now: nowMs });"]], T],
  ["ب", "02:30: Omar inside his window gets the text, not the Flow", [[PS,
    "        } else if (await byFlow()) {", "        } else if (false) {"]], T],
  ["ب", "02:30: the 90 minutes do not start with the Flow", [[PS,
    "        } else if (await byFlow()) {\n          await writeMarketAskMarker(env, t.whatsapp, day, nowMs); action = \"sent\";", "        } else if (await byFlow()) {\n          action = \"sent\";"]], T],
  ["ب", "02:30: outside his window the queue holds the text alone", [[PS,
    "ask_day: day, ...(await queuedFlow()) }]);", "ask_day: day }]);"]], T],
  ["ب", "02:30: before his tap the queue holds the text alone", [[PS,
    "ask_day: day, ...(await queuedFlow()) }], h.queueTtl);", "ask_day: day }], h.queueTtl);"]], T],
  ["ب", "02:30: the Flow's token is of a source with no employee", [[PS,
    "const flowSrc = { partnerId: t.partnerId, employeeId: t.employeeId, name: t.name,", "const flowSrc = { partnerId: t.partnerId, employeeId: null, name: t.name,"]], T],
  ["ب", "the flush sends the queued text, not the Flow", [[TQ,
    "    if (marketAsk && l.flow && typeof l.flow === \"object\") {", "    if (false) {"]], T],
  ["ب", "the flush sends the Flow and its text", [[TQ,
    "          await onQueuedAskFlushed(env, to, l.ask_day);\n          continue;", "          await onQueuedAskFlushed(env, to, l.ask_day);"]], T],
  ["ب", "the flushed Flow does not start the 90 minutes", [[TQ,
    "          const { onQueuedAskFlushed } = await import(\"./price-sources\");\n          await onQueuedAskFlushed(env, to, l.ask_day);\n          continue;", "          continue;"]], T],
  ["ب", "Omar's text still invites a purchase price", [[PS,
    "أرسل أسعار السوق اليوم لو سمحت: الصنف والتعبئة والسعر لكل صنف. ${MARKET_VAT_LINE}`;", "أرسل أسعار السوق اليوم لو سمحت: الصنف والتعبئة والسعر لكل صنف. ولو معك سعر شراء اكتب «شراء» جنب رقمه، وسعر الشراء بدون ضريبة. ${MARKET_VAT_LINE}`;"]], T],
  // ---------------------------------------------------------------- ج the reply
  ["ج", "an nfm_reply is not parsed", [[MT,
    "          } else if (m?.interactive?.nfm_reply) {", "          } else if (false) {"]], T],
  ["ج", "the flow_token stays among the fields", [[MT,
    "  const { flow_token, ...values } = obj;", "  const { flow_token } = obj; const values = obj;"]], T],
  ["ج", "an unreadable response_json throws", [[MT,
    "  } catch { /* an empty reply */ }", "  } catch (e) { throw e; }"]], T],
  ["ج", "the webhook does not route a Flow's reply", [[IX,
    "    if (msg.flow) {", "    if (false) {"]], T],
  ["ج", "a token sent to another number is read", [[PF,
    "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], T],
  ["ج", "yesterday's form is taken today", [[PF,
    "  const expired = rec.day !== riyadhDateKey(new Date(now)) ? \"day\"", "  const expired = false ? \"day\""]], T],
  ["ج", "a reply after the day's publication is taken", [[PF,
    "    : !rec.test && (await dayPublished(env, rec.day).catch(() => false)) ? \"published\" : null;", "    : false ? \"published\" : null;"]], T],
  ["ج", "a day that was not published counts as published", [[PF,
    "  return !!r && (r.x_state === \"published\" || !!r.x_published_at);", "  return !!r;"]], T],
  ["ج", "an expired reply is not reported to Baraa", [[PF,
    "    if (!rec.test) await alertOwner(env, `⌛ رد نموذج الأسعار", "    if (false) await alertOwner(env, `⌛ رد نموذج الأسعار"]], T],
  ["ج", "a token is read twice", [[PF,
    "  if (!claim.claimed || rec.usedAt) {", "  if (false) {"]], T],
  ["ج", "a used token forgets what it carried", [[PF,
    "    await writeFlowToken(env, { ...rec, usedAt: now, values });", "    await writeFlowToken(env, { ...rec, usedAt: now });"]], T],
  ["ج", "an empty field is not «not available»", [[PF,
    "  if (s === \"\") return null;", "  if (s === \"\") return \"invalid\";"]], T],
  ["ج", "zero is a price", [[PF,
    "  return n > 0 ? n : \"invalid\";", "  return n;"]], T],
  ["ج", "Arabic digits are not read", [[PF,
    "    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))\n", ""]], T],
  ["ج", "the Arabic decimal mark is not read", [[PF,
    "    .replace(/٫/g, \".\")\n", ""]], T],
  ["ج", "a price keeps more than two decimals", [[PF,
    "  const n = Math.round(Number(s) * 100) / 100;\n  return n > 0", "  const n = Number(s);\n  return n > 0"]], T],
  ["ج", "a Flow price is marked «extracted»", [[PF,
    "extraction_status: outlier ? \"pending\" : \"flow\",", "extraction_status: outlier ? \"pending\" : \"extracted\","]], T],
  ["ج", "an outlier from the Flow is not marked", [[PF,
    "        const outlier = !!last && isPriceOutlier(last.price, e.price, ratio);", "        const outlier = false;"]], T],
  ["ج", "a supplier's purchase price goes to the offers, not to x_daily_price", [[PF,
    "  const asDaily = rec.supplier && rec.kind === \"purchase\";", "  const asDaily = false;"]], T],
  ["ج", "a «سوق» source's number is written as a purchase offer", [[PF,
    "...(rec.kind === \"purchase\" ? { purchase: e.price } : { market: e.price }),", "...({ purchase: e.price }),"]], T],
  ["ج", "the offer is not on the employee", [[PF,
    "partnerId: rec.partnerId, employeeId: rec.employeeId, productId: e.item.productId,", "partnerId: rec.partnerId, employeeId: null, productId: e.item.productId,"]], T],
  ["ج", "the row carries no fallback sale price", [[PF,
    "cost_price: e.price, sale_price: fallbackSale(e.price, floorInputs), actual_weight_kg: null,", "cost_price: e.price, sale_price: 0, actual_weight_kg: null,"]], T],
  ["ج", "the ask log is not marked answered", [[PF,
    "      if (log) await updateSupplierLog(env, log.id, {", "      if (false) await updateSupplierLog(env, log!.id, {"]], T],
  ["ج", "an edit answers an older ask", [[PF,
    "  if (rec.supplier && !rec.parent) {", "  if (rec.supplier) {"]], T],
  ["ج", "«💰 أسعار اليوم» does not follow the reply", [[PF,
    "      await refreshPriceDay(env, { now });", "      void refreshPriceDay;"]], T],
  ["ج", "the answer carries «أدخل الأسعار», not «تعديل»", [[PF,
    "test: rec.test, body, cta: PRICE_FLOW_EDIT_CTA }).catch(() => null);", "test: rec.test, body, cta: PRICE_FLOW_CTA }).catch(() => null);"]], T],
  ["ج", "«تعديل» opens an empty form", [[PF,
    "{ now, items: rec.items, pages: rec.pages, init, parent: rec.token,", "{ now, items: rec.items, pages: rec.pages, parent: rec.token,"]], T],
  ["ج", "«تعديل» reuses the token it corrects", [[PF,
    "    const r = edit ? await sendViaGateway(env, { purpose, to, content: edit.session, ctx }) : null;", "    const r = edit ? await sendViaGateway(env, { purpose, to, content: flowSession(body, rec.token, edit.data, PRICE_FLOW_EDIT_CTA), ctx }) : null;"]], T],
  ["ج", "a field emptied in an edit is dropped silently", [[PF,
    "entries.empty.filter((i) => before[i.slot] > 0).map(", "entries.empty.filter(() => false).map("]], T],
  ["ج", "Baraa is not told of a field emptied in an edit", [[PF,
    "    if (kept.length && !rec.test) await alertOwner(env, `ℹ️", "    if (false) await alertOwner(env, `ℹ️"]], T],
  ["ج", "a number that is not a price is not named in the answer", [[PF,
    "  if (a.invalid?.length) lines.push(", "  if (false) lines.push("]], T],
  ["ج", "every field empty is answered as prices received", [[PF,
    "  else lines.push(`${head}وصلت ✅ بدون أسعار: ما سُجّل سعر من هذا النموذج.`);", "  else lines.push(`${head}وصلت ✅`);"]], T],
  // ---------------------------------------------------------------- د the trial
  ["د", "the trial writes in Odoo", [[PF,
    "    const w = rec.test ? { saved: entries.priced, unsaved: [] as FlowItem[] } : await saveFlowPrices(", "    const w = false ? { saved: entries.priced, unsaved: [] as FlowItem[] } : await saveFlowPrices("]], T],
  ["د", "the trial's answer is not marked as a trial", [[PF,
    "  if (a.test) lines.push(\"(تجربة: لم يُكتب شيء في Odoo)\");", "  if (false) lines.push(\"(تجربة: لم يُكتب شيء في Odoo)\");"]], T],
  ["د", "the trial's heading is plain", [[PF,
    "`${test ? `${TEST_MARK} — ` : \"\"}${category}`;", "`${false ? `${TEST_MARK} — ` : \"\"}${category}`;"]], T],
  ["د", "the trial's text is plain", [[PF,
    "  const text = opts.body ?? `${opts.test ? `${TEST_MARK} — ` : \"\"}${flowAskText(src.name, kind, day)}`;", "  const text = opts.body ?? `${flowAskText(src.name, kind, day)}`;"]], T],
  ["د", "the trial goes whatever his window", [[PF,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["د", "the trial goes at every call", [[PF,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], T],
  ["د", "an «edit» of the trial is a real reply", [[PF,
    "...(opts.test ? { test: true } : {}), ...(opts.parent ?", "...(opts.test && !opts.parent ? { test: true } : {}), ...(opts.parent ?"]], T],
  ["د", "the trial shows no last price", [[PF,
    "hintsFrom: ref ? { partnerId: ref.partnerId, supplier: true } : undefined });", "hintsFrom: undefined });"]], T],
  ["د", "the owner guard refuses the trial", [[GW,
    "new Set([\"price_flow_test\", \"owner_alert\",", "new Set([\"owner_alert\","]], T],
  ["د", "the trial route needs no token", [[IX,
    "url.pathname === \"/odoo/hook/price-flow-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "url.pathname === \"/odoo/hook/price-flow-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {"]], T],
  // ---------------------------------------------------------------- هـ the guide
  ["هـ", "the guide does not name the Flow's template", [[DOC,
    "القالب الجديد `utak_price_ask_flow_v1` **صنّفه", "القالب الجديد **صنّفه"]], T],
  ["هـ", "the guide does not say a field per item", [[DOC,
    "ثم **خانة لكل صنف «نشط للبيع»** في Odoo وقت الإرسال", "ثم الخانات"]], T],
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
writeFileSync(new URL("../artifacts/s51-20261004-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
