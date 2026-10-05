// Mutation check for § 55 ج (2026-10-05) — the team's forms that write nothing in Odoo: the car's
// load (src/car-load.ts). Each mutation disables ONE guard, runs its test file, and must make it
// fail. The source is restored in `finally` after every run; a pattern that is not found exactly once
// stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s55-20261005-team-forms-mutations.mjs [ج هـ …]     (no argument: every part)
//
// Out: scripts/artifacts/s55-20261005-team-forms-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TC = "tests/s55-car.test.mts";
const CL = "src/car-load.ts";
const IDX = "src/index.ts";
const RT = "src/router.ts";
const GW = "src/wa-gateway.ts";
const LIB = "scripts/lib/s55-flows.mjs";
const TRIAL = "scripts/s55-20261005-trial.mjs";
/** The driver's text command, as the team's texts try it (src/index.ts). */
const CL_TEXT = "        } else if (await import(\"./car-load\").then((m) => m.carLoadText(env, teamMember, msg.text, msg.from, ctx))) {";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ج the Flow and what the worker sends
  ["ج", "the Flow shows «التالف» whenever the slot is shown (the morning too)", [[LIB,
    "visible: lref(k, `w${n}`), \"init-value\": lref(k, `j${n}`) },", "visible: lref(k, `v${n}`), \"init-value\": lref(k, `j${n}`) },"]], TC],
  ["ج", "the Flow has twenty slots a page (more than fifty components)", [[LIB,
    "export const CARLOAD_PAGE_SLOTS = 15;", "export const CARLOAD_PAGE_SLOTS = 20;"]], TC],
  ["ج", "«إرسال» does not carry the second field", [[LIB,
    "upTo.flatMap((n) => [[`a${n}`, cformRef(k, \"a\", n)], [`b${n}`, cformRef(k, \"b\", n)]])", "upTo.map((n) => [`a${n}`, cformRef(k, \"a\", n)])"]], TC],
  ["ج", "the Flow's first field takes any text", [[LIB,
    "{ type: \"TextInput\", name: `a${n}`, label: lref(k, `l${n}`), \"input-type\": \"number\",", "{ type: \"TextInput\", name: `a${n}`, label: lref(k, `l${n}`), \"input-type\": \"text\","]], TC],
  ["ج", "the Flow's page has no line of text under its heading", [[LIB,
    "        { type: \"TextBody\", text: lref(k, \"note\") },\n", ""]], TC],
  ["ج", "the car-load Flow is not in the Meta script's list", [[LIB,
    "  { key: \"carload\", name: CARLOAD_FLOW_NAME, build: buildCarloadFlowJson, first: CARLOAD_FIRST_SCREEN },\n", ""]], TC],
  ["ج", "the worker fills ten slots a page (the Flow has fifteen)", [[CL,
    "export const CARLOAD_FLOW_PAGE_SLOTS = 15;", "export const CARLOAD_FLOW_PAGE_SLOTS = 10;"]], TC],
  ["ج", "the worker opens another screen", [[CL,
    "export const CARLOAD_FLOW_SCREEN = \"LOAD_A\";", "export const CARLOAD_FLOW_SCREEN = \"LOAD_B\";"]], TC],
  ["ج", "«التالف» is shown in the morning", [[CL,
    "    data[`w${n}`] = !!it && moment === \"evening\";", "    data[`w${n}`] = !!it;"]], TC],
  ["ج", "«التالف» is hidden in the evening", [[CL,
    "    data[`w${n}`] = !!it && moment === \"evening\";", "    data[`w${n}`] = false;"]], TC],
  ["ج", "an unused slot's label is an empty string", [[CL,
    "    data[`l${n}`] = it ? it.label : \"-\";", "    data[`l${n}`] = it ? it.label : \"\";"]], TC],
  ["ج", "a page that follows is not announced («التالي» never shows)", [[CL,
    "    if (k < CARLOAD_FLOW_PAGES) data[`m${k}`] = k < pages.length;", "    if (k < CARLOAD_FLOW_PAGES) data[`m${k}`] = false;"]], TC],
  ["ج", "a long name is not cut to the label's twenty characters", [[CL,
    "    label: cut(p, CARLOAD_LABEL_MAX),", "    label: p,"]], TC],
  ["ج", "«تالف: …» is not cut to twenty characters", [[CL,
    "    label2: cut(`تالف: ${p}`, CARLOAD_LABEL_MAX),", "    label2: `تالف: ${p}`,"]], TC],
  ["ج", "a long heading is not cut to eighty characters", [[CL,
    "cut(`${mark}${title} — ${pages[k - 1]}`, CARLOAD_HEADING_MAX)", "`${mark}${title} — ${pages[k - 1]}`"]], TC],
  ["ج", "the evening's hint does not name what was loaded", [[CL,
    "`الباقي في السيارة · المحمّل ${qty(loaded)}${k ? ` ${k}` : \"\"}`", "`الباقي في السيارة`"]], TC],
  // ---------------------------------------------------------------- ج the triggers
  ["ج", "a message that begins with «حمولة» is the command", [[CL,
    "  if (t === \"حموله\" || t === \"حموله السياره\") return \"morning\";", "  if (t.startsWith(\"حموله\")) return \"morning\";"]], TC],
  ["ج", "a message that holds «الباقي» is the command", [[CL,
    "  if (t === \"نهايه الحموله\" || t === \"الباقي\") return \"evening\";", "  if (t.includes(\"نهايه الحموله\") || t.includes(\"الباقي\")) return \"evening\";"]], TC],
  ["ج", "«حموله» as a phone types it is not the command", [[CL,
    ".replace(/[أإآ]/g, \"ا\").replace(/ى/g, \"ي\").replace(/ة/g, \"ه\")\n    .replace(/[.!؟?،,\\s]+$/g, \"\").replace(/\\s+/g, \" \");\n  if (t === \"حموله\"", ".replace(/[أإآ]/g, \"ا\").replace(/ى/g, \"ي\")\n    .replace(/[.!؟?،,\\s]+$/g, \"\").replace(/\\s+/g, \" \");\n  if (t === \"حموله\""]], TC],
  ["ج", "the text command is answered for any team member", [[CL,
    "  if (!moment || !hasRole(member, CARLOAD_ROLE)) return false;", "  if (!moment) return false;"]], TC],
  ["ج", "the buttons are answered for any team member", [[CL,
    "    if (!m || !m.codes.includes(CARLOAD_ROLE)) return null;", "    if (!m) return null;"]], TC],
  ["ج", "the button's member is the partner the caller names, not the number that tapped", [[CL,
    "    const m = memberByNumber(await loadRoster(env), number);\n    if (!m || !m.codes.includes(CARLOAD_ROLE)) return null;", "    const m = (await loadRoster(env)).members.find((x) => x.partnerId === partner.id) ?? null;\n    if (!m || !m.codes.includes(CARLOAD_ROLE)) return null;"]], TC],
  ["ج", "the role that loads the car is the buyer's", [[CL,
    "export const CARLOAD_ROLE = \"driver\";", "export const CARLOAD_ROLE = \"warehouse\";"]], TC],
  ["ج", "the driver's text command is not wired in the team's texts", [[IDX, CL_TEXT, "        } else if (false) {"]], TC],
  ["ج", "the buttons are not wired in the router", [[RT,
    "    if (carLoadButtonMoment(t)) {", "    if (false) {"]], TC],
  ["ج", "the Flow's reply is not routed by its token", [[IDX,
    "        } else if ((await import(\"./car-load\")).isCarLoadToken(msg.flow.token ?? \"\")) {", "        } else if (false) {"]], TC],
  ["ج", "the command is tried before the pending notes", [[IDX, CL_TEXT, "        } else if (false) {"], [IDX,
    "        if (pendingListId) {\n          const listId = Number(pendingListId);", "        if (await import(\"./car-load\").then((m) => m.carLoadText(env, teamMember, msg.text, msg.from, ctx))) {\n        } else if (pendingListId) {\n          const listId = Number(pendingListId);"]], TC],
  ["ج", "the command is tried after the shift's hold", [[IDX, CL_TEXT, "        } else if (false) {"], [IDX,
    "        } else if (att.hold) {\n          await sendText(env, msg.from, holdText(att), { ctx, purpose: \"bot_reply\" });\n        } else {",
    "        } else if (att.hold) {\n          await sendText(env, msg.from, holdText(att), { ctx, purpose: \"bot_reply\" });\n        } else if (await import(\"./car-load\").then((m) => m.carLoadText(env, teamMember, msg.text, msg.from, ctx))) {\n        } else {"]], TC],
  ["ج", "the form is held outside the window", [[CL,
    "  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: \"window_closed\" };\n  const day = riyadhDateKey(new Date(now));\n  let items", "  const day = riyadhDateKey(new Date(now));\n  let items"], [CL,
    "    noHold: true,\n    noHoldReason: \"نموذج الحمولة يُرسل داخل نافذة 24 ساعة فقط\",\n", ""]], TC],
  ["ج", "outside his window a line is held for him", [[CL,
    "    if (!r.sent && r.reason !== \"window_closed\") await tell(", "    if (!r.sent) await tell("]], TC],
  // ---------------------------------------------------------------- ج the morning
  ["ج", "an empty field is kept as an item of the load", [[CL,
    "entries.read.filter((r) => r.a > 0).map((r) => ({", "entries.read.map((r) => ({"]], TC],
  ["ج", "the day's record is kept one day", [[CL,
    "export const CARLOAD_KEEP_SEC = 4 * 24 * 60 * 60;", "export const CARLOAD_KEEP_SEC = 24 * 60 * 60;"]], TC],
  ["ج", "the record is the driver's, whatever the day", [[CL,
    "`cload:v1:${day}:${driverId}`;", "`cload:v1:${driverId}`;"]], TC],
  ["ج", "the morning's confirmation carries no «نهاية الحمولة» button", [[CL,
    "content: buttonsContent(t.body, [carLoadEveningButton()]), ctx });", "content: textContent(t.body), ctx });"]], TC],
  ["ج", "Baraa is not told of the morning's load", [[CL,
    "      await sendOwnerMessage(env, ownerLoadLine(day, { replacedAt: onRecord?.loadedAt }), CARLOAD_OWNER_PURPOSE);\n", ""]], TC],
  ["ج", "Baraa is not told that a load replaced another", [[CL,
    "ownerLoadLine(day, { replacedAt: onRecord?.loadedAt })", "ownerLoadLine(day, {})"]], TC],
  ["ج", "the driver is not told that his load replaced another", [[CL,
    "      const t = loadConfirmText(day, { replacedAt: onRecord?.loadedAt });", "      const t = loadConfirmText(day, {});"]], TC],
  ["ج", "«حمولة» after the evening count still sends the form", [[CL,
    "    if (moment === \"morning\" && onRecord?.count) {", "    if (false) {"]], TC],
  ["ج", "a morning form sent after the evening count replaces the load", [[CL,
    "      if (onRecord?.count) {\n        await used();\n        await say(CARLOAD_CLOSED_TEXT);", "      if (false) {\n        await used();\n        await say(CARLOAD_CLOSED_TEXT);"]], TC],
  ["ج", "a form with no quantity is kept as an empty load", [[CL,
    "      if (!items.length) {\n        // nothing loaded", "      if (false) {\n        // nothing loaded"]], TC],
  ["ج", "an empty form spends its token", [[CL,
    "        await releaseButton(env, claim);\n        await say(CARLOAD_EMPTY_TEXT);", "        await used();\n        await say(CARLOAD_EMPTY_TEXT);"]], TC],
  ["ج", "the form sent again does not open with the load on record", [[CL,
    "    } else if (onRecord && !init) {", "    } else if (false) {"]], TC],
  ["ج", "the form sent again does not say it replaces the load", [[CL,
    "      onRecordAt = onRecord.loadedAt;\n", ""]], TC],
  ["ج", "no active item: the form's failure is said, not that there is none", [[CL,
    "r.reason === \"no_items\" ? CARLOAD_NO_ITEMS_TEXT : CARLOAD_FAILED_TEXT, ctx);\n    return r;", "CARLOAD_FAILED_TEXT, ctx);\n    return r;"]], TC],
  // ---------------------------------------------------------------- ج the evening and the count
  ["ج", "«نهاية الحمولة» with no load gets no morning form", [[CL,
    "    if (moment === \"evening\" && !onRecord) {", "    if (false) {"]], TC],
  ["ج", "«نهاية الحمولة» with no load gets the morning form without the line saying so", [[CL,
    "body: `${CARLOAD_NO_LOAD_TEXT}\\n${carLoadFormText(\"morning\", day)}` });", "body: carLoadFormText(\"morning\", day) });"]], TC],
  ["ج", "the evening form of a count on record opens empty", [[CL,
    "      if (onRecord?.count && !init) {", "      if (false) {"]], TC],
  ["ج", "the damaged cartons are not taken off what left the car", [[CL,
    "    const dispatched = round2(i.loaded - left - damaged);", "    const dispatched = round2(i.loaded - left);"]], TC],
  ["ج", "what is left is not taken off what left the car", [[CL,
    "    const dispatched = round2(i.loaded - left - damaged);", "    const dispatched = round2(i.loaded - damaged);"]], TC],
  ["ج", "the difference is delivered − dispatched", [[CL,
    "diff: delivered ? round2(dispatched - got) : 0 };", "diff: delivered ? round2(got - dispatched) : 0 };"]], TC],
  ["ج", "an item delivered and never loaded is no difference", [[CL,
    "    if (!rows.some((r) => r.key === key)) rows.push(", "    if (false) rows.push("]], TC],
  ["ج", "an order that was not delivered counts", [[CL,
    "domain: [[\"x_state\", \"in\", [\"delivered\", \"closed\"]], [\"x_delivered_at\", \">=\", toOdooUtc(from)],", "domain: [[\"x_delivered_at\", \">=\", toOdooUtc(from)],"]], TC],
  ["ج", "a closed order's delivery does not count", [[CL,
    "[\"x_state\", \"in\", [\"delivered\", \"closed\"]]", "[\"x_state\", \"in\", [\"delivered\"]]"]], TC],
  ["ج", "a simulation order's delivery counts", [[CL,
    "toOdooUtc(from + DAY_MS)], [SIM_FIELD, \"!=\", true]],", "toOdooUtc(from + DAY_MS)]],"]], TC],
  ["ج", "an «unavailable» line counts as delivered", [[CL,
    "[\"x_status\", \"!=\", \"unavailable\"], [SIM_FIELD, \"!=\", true]],", "[SIM_FIELD, \"!=\", true]],"]], TC],
  ["ج", "a simulation line counts", [[CL,
    "[\"x_status\", \"!=\", \"unavailable\"], [SIM_FIELD, \"!=\", true]],", "[\"x_status\", \"!=\", \"unavailable\"]],"]], TC],
  ["ج", "the day is UTC's, not Riyadh's", [[CL,
    "  const from = riyadhDayMinuteMs(day, 0);\n  const orders", "  const from = Date.parse(`${day}T00:00:00Z`);\n  const orders"]], TC],
  ["ج", "the night before's deliveries count", [[CL,
    "[\"x_delivered_at\", \">=\", toOdooUtc(from)], ", ""]], TC],
  ["ج", "the deliveries after midnight count", [[CL,
    "[\"x_delivered_at\", \"<\", toOdooUtc(from + DAY_MS)], ", ""]], TC],
  ["ج", "the deliveries are added by product alone, whatever the packaging", [[CL,
    "    const key = `${p}:${k}`;\n    const cur = out.get(key);", "    const key = `${p}:0`;\n    const cur = out.get(key);"]], TC],
  ["ج", "Baraa is told only when something differs", [[CL,
    "    for (const p of ownerCountText(day, delivered, { correctedAt: onRecord.countedAt })) await sendOwnerMessage(env, p, CARLOAD_OWNER_PURPOSE);",
    "    if (!delivered || carLoadRows(day, delivered).some((r) => Math.abs(r.diff) >= 0.005)) for (const p of ownerCountText(day, delivered, { correctedAt: onRecord.countedAt })) await sendOwnerMessage(env, p, CARLOAD_OWNER_PURPOSE);"]], TC],
  ["ج", "deliveries that cannot be read count as none", [[CL,
    "      console.warn(`[car-load] ${rec.day}: the deliveries could not be read — no comparison`, (e as Error)?.message);", "      delivered = new Map();"]], TC],
  ["ج", "an item that matches is listed among the differences", [[CL,
    "  const off = rows.filter((r) => Math.abs(r.diff) >= 0.005);", "  const off = rows;"]], TC],
  ["ج", "matching deliveries are not said to match", [[CL,
    "    if (!off.length) lines.push(CARLOAD_MATCH_TEXT);\n    else {", "    {"]], TC],
  ["ج", "an item never loaded reads «المحمّل 0 · الباقي 0 …»", [[CL,
    "        lines.push(r.loaded > 0\n", "        lines.push(true\n"]], TC],
  ["ج", "the damaged items are not listed for Baraa", [[CL,
    "  if (damaged.length) lines.push(`التالف: ", "  if (false) lines.push(`التالف: "]], TC],
  ["ج", "a difference is written without its «+»", [[CL,
    "  return `${v > 0 ? \"+\" : v < 0 ? \"−\" : \"\"}${qty(Math.abs(v))}`;", "  return `${v < 0 ? \"−\" : \"\"}${qty(Math.abs(v))}`;"]], TC],
  ["ج", "a difference's minus is an ASCII hyphen", [[CL,
    "  return `${v > 0 ? \"+\" : v < 0 ? \"−\" : \"\"}${qty(Math.abs(v))}`;", "  return `${v > 0 ? \"+\" : v < 0 ? \"-\" : \"\"}${qty(Math.abs(v))}`;"]], TC],
  ["ج", "a second count is not said to be a correction", [[CL,
    "ownerCountText(day, delivered, { correctedAt: onRecord.countedAt })", "ownerCountText(day, delivered, {})"]], TC],
  ["ج", "the driver is not told that his count replaced another", [[CL,
    "countConfirmText(day, { replacedAt: onRecord.countedAt })", "countConfirmText(day, {})"]], TC],
  ["ج", "an evening form of a load replaced since is read", [[CL,
    "    if (!onRecord || onRecord.loadedAt !== rec.loadedAt) {", "    if (!onRecord) {"]], TC],
  ["ج", "a long message to Baraa is one text, whatever its length", [[CL,
    "    if (cur.length && size + l.length + 1 > room) { parts.push(cur.join(\"\\n\")); cur = []; size = 0; }\n", ""]], TC],
  // ---------------------------------------------------------------- ج bad values
  ["ج", "a negative quantity is read", [[CL,
    "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";", "  if (!/^-?\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";"]], TC],
  ["ج", "three decimals are read", [[CL,
    "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";", "  if (!/^\\d+(\\.\\d+)?$/.test(s)) return \"invalid\";"]], TC],
  ["ج", "what is not a number is read as zero", [[CL,
    "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return \"invalid\";", "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return 0;"]], TC],
  ["ج", "an empty field is not zero", [[CL,
    "  if (s === \"\") return 0;", "  if (s === \"\") return \"invalid\";"]], TC],
  ["ج", "any number of cartons is a quantity", [[CL,
    "  return n <= CARLOAD_QTY_MAX ? n : \"invalid\";", "  return n;"]], TC],
  ["ج", "a bad value is read as zero and the rest of the form is kept", [[CL,
    "    if (entries.invalid.length || entries.over.length) {", "    if (false) {"]], TC],
  ["ج", "left + damaged may pass what was loaded", [[CL,
    "&& round2(av + bv) > item.loaded) out.over.push(", "&& false) out.over.push("]], TC],
  ["ج", "left + damaged equal to what was loaded is refused", [[CL,
    "&& round2(av + bv) > item.loaded) out.over.push(", "&& round2(av + bv) >= item.loaded) out.over.push("]], TC],
  ["ج", "a refused form carries no fresh form", [[CL,
    "      await again(carLoadRefusalText(entries));", "      await say(carLoadRefusalText(entries));"]], TC],
  ["ج", "a refused form can be sent again", [[CL,
    "      await used();\n      await again(carLoadRefusalText(entries));", "      await releaseButton(env, claim);\n      await again(carLoadRefusalText(entries));"]], TC],
  ["ج", "the fresh form opens empty", [[CL,
    "pages: rec.pages, init: typed, loadedAt: rec.loadedAt,", "pages: rec.pages, loadedAt: rec.loadedAt,"]], TC],
  ["ج", "a bad «التالف» is named by the first field's label", [[CL,
    "    if (b === \"invalid\") out.invalid.push(item.label2);", "    if (b === \"invalid\") out.invalid.push(item.label);"]], TC],
  ["ج", "the refusal does not name the field", [[CL,
    "`• قيمة غير صحيحة في: ${namesLine(e.invalid, 300)} — ", "`• قيمة غير صحيحة — "]], TC],
  // ---------------------------------------------------------------- ج the token
  ["ج", "a token is read from any number", [[CL,
    "  if (!rec || rec.to !== to) {", "  if (!rec) {"]], TC],
  ["ج", "a token is read twice", [[CL,
    "  if (!claim.claimed || rec.usedAt) {", "  if (false) {"]], TC],
  ["ج", "a form of another day is read", [[CL,
    "  if (rec.day !== today) {", "  if (false) {"]], TC],
  ["ج", "the token does not say whose it is", [[CL,
    "  return `cl1.${day.replace(/-/g, \"\")}.${driverId}.${rand}`;", "  return `cl1.${rand}`;"]], TC],
  // ---------------------------------------------------------------- ج more items than a page, than the form
  ["ج", "a fifth page's items get a slot beyond the form", [[CL,
    "  const used = pages.slice(0, CARLOAD_FLOW_PAGES);", "  const used = pages;"]], TC],
  ["ج", "a small category wastes its page: fifty-three items do not fit", [[CL,
    "  if (pages.length > CARLOAD_FLOW_PAGES) {\n    pages = [];", "  if (false) {\n    pages = [];"]], TC],
  ["ج", "a category's sixteenth item has no field", [[CL,
    "rows: rows.slice(i, i + CARLOAD_FLOW_PAGE_SLOTS) });\n    }\n  }\n  if (pages.length", "rows: rows.slice(i, i + CARLOAD_FLOW_PAGE_SLOTS) });\n      break;\n    }\n  }\n  if (pages.length"]], TC],
  ["ج", "the items beyond the form are not named in its message", [[CL,
    "  if (o.left?.length) lines.push(", "  if (false) lines.push("]], TC],
  ["ج", "a long confirmation is cut at 1024 characters", [[CL,
    "  if (whole.length <= BODY_MAX) return { parts: [], body: whole };", "  if (true) return { parts: [], body: whole };"]], TC],
  // ---------------------------------------------------------------- ج nothing in Odoo, no price
  ["ج", "the count is written on the order lines in Odoo", [[CL,
    "    await writeCarLoad(env, day);\n    await used();\n    for (const p of countConfirmText(", "    await writeCarLoad(env, day);\n    await call(env, \"x_daily_order_line\", \"write\", { ids: [0], vals: { x_notes: \"car load\" } });\n    await used();\n    for (const p of countConfirmText("]], TC],
  ["ج", "the load is written on the driver's card in Odoo", [[CL,
    "      await writeCarLoad(env, day);\n      await used();\n      const t = loadConfirmText(", "      await writeCarLoad(env, day);\n      await call(env, \"res.partner\", \"write\", { ids: [rec.driverId], vals: { comment: \"car load\" } });\n      await used();\n      const t = loadConfirmText("]], TC],
  ["ج", "the lines' prices are read with the deliveries", [[CL,
    "fields: [\"x_product_tmpl_id\", \"x_packaging_id\", \"x_quantity\"], limit: 20000,", "fields: [\"x_product_tmpl_id\", \"x_packaging_id\", \"x_quantity\", \"x_unit_price\"], limit: 20000,"]], TC],
  ["ج", "a price is written in a field's hint", [[CL,
    "`${k ? `${k} · ` : \"\"}الكمية المحمّلة`", "`${k ? `${k} · ` : \"\"}السعر 99.99 ر.س`"]], TC],
  // ---------------------------------------------------------------- ج the trial and the purposes
  ["ج", "the trial's purpose is not among the owner's", [[GW,
    "\"conv_open_owner\", \"car_load_form_test\", \"owner_team_note\",", "\"conv_open_owner\", \"owner_team_note\","]], TC],
  ["ج", "the trial goes more than once a day", [[CL,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], TC],
  ["ج", "a trial that did not go spends the day", [[CL,
    "    if (!r.sent) { await releaseButton(env, claim); return r; }", "    if (!r.sent) return r;"]], TC],
  ["ج", "the trial's reply is kept as a load", [[CL,
    "      if (rec.test) {\n        await used();\n        const t = loadConfirmText(day, { test: true });", "      if (false) {\n        await used();\n        const t = loadConfirmText(day, { test: true });"]], TC],
  ["ج", "the trial is not marked «🧪 تجربة»", [[CL,
    "  const mark = opts.test ? `${CARLOAD_TEST_MARK} — ` : \"\";", "  const mark = \"\";"]], TC],
  ["ج", "the trial is sent under the driver's purpose", [[CL,
    "    purpose: opts.test ? CARLOAD_TEST_PURPOSE : CARLOAD_PURPOSE,", "    purpose: CARLOAD_PURPOSE,"]], TC],
  ["ج", "the trial's answer is sent under the driver's purpose", [[CL,
    "  const purpose = isOwnerRecipient(env, to) ? CARLOAD_TEST_PURPOSE : CARLOAD_PURPOSE;", "  const purpose = CARLOAD_PURPOSE;"]], TC],
  ["ج", "Baraa's messages go under a purpose that is not his", [[CL,
    "export const CARLOAD_OWNER_PURPOSE = T.OWNER_TEAM_NOTE;", "export const CARLOAD_OWNER_PURPOSE = \"bot_reply\";"]], TC],
  ["ج", "the trial's hook asks for no token", [[IDX,
    "url.pathname === \"/odoo/hook/carload-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "url.pathname === \"/odoo/hook/carload-form-test\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false) {"]], TC],
  ["ج", "the trial script does not know the car-load hook", [[TRIAL,
    ", carload: \"carload-form-test\"", ""]], TC],
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
writeFileSync(new URL("../artifacts/s55-20261005-team-forms-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
