// Mutation check for § 68 (2026-10-08) — the hook secret of Odoo's buttons, and the employee's file:
//   أ  the token of Odoo's buttons is its own secret (src/hook-auth.ts, the routes of src/index.ts)
//   ب  the attendance record: the words, the entry and its minutes, the exit, the place, «غائب» after two hours in
//      one alert, the time off's row, the entry of a member off attendance, the trial (src/attendance.ts, src/s68-trial.ts)
//   ج  the employee's file: the papers and their ends, the month, «العهدة والمستحقات», «الأداء», the day's one run
//      (src/employee-file.ts)
// Each mutation disables ONE guard, runs the test file named with it, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s68-20261008-mutations.mjs [أ ب ج]     (no argument: every part)
//
// Out: scripts/artifacts/s68-20261008-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TH = "tests/s68-hook.test.mts", TA = "tests/s68-attendance.test.mts", TF = "tests/s68-file.test.mts";
const HA = "src/hook-auth.ts", IDX = "src/index.ts", ATT = "src/attendance.ts", TRI = "src/s68-trial.ts", EF = "src/employee-file.ts", GW = "src/wa-gateway.ts";
const GATE = "      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {";
const OPEN = "      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (false) {";
/** One route's own gate, switched off. */
const route = (path, part = "أ", test = TH) => [part, `${path} is open without the token`, [[IDX, `url.pathname === "${path}") {\n${GATE}`, `url.pathname === "${path}") {\n${OPEN}`]], test];
const IN_LINE = "      const isShiftStart = (isButton && msg.buttonId === \"shift_start\") || (msg.type === \"text\" && AT.shiftInCommand(msg.text));";
const OUT_LINE = "      const isShiftEnd = (isButton && msg.buttonId === AT.SHIFT_END_PAYLOAD) || (msg.type === \"text\" && AT.shiftOutCommand(msg.text));";
const TAP_WRITE = "  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status, x_late_min: lateMinutes(tapMs, shiftMs), x_source: SOURCE_WHATSAPP });";
const ABSENT_SEND = "      await sendOwnerAlert(withAutoSendJob(env, \"shift_absent\"), absentText(absent), { kind: ABSENT_ALERT_KIND });";
const LEAVE_IF = "      if (dp.kind === \"leave\" && dp.startMin !== undefined && nowMs >= riyadhDayMinuteMs(day, dp.startMin)) {";
const OPEN_DOMAIN = "    domain: [[\"x_employee_id\", \"=\", employeeId], [\"x_date\", \"in\", [addDaysYmd(day, -1), day]], [\"x_utak_simulation\", \"!=\", true], [\"x_tapped_at\", \"!=\", false]],";
const ASKED_STATE = "      state: card[d.state] === \"done\" ? \"done\" : card[d.state] === \"progress\" ? \"progress\" : \"missing\",";
const FROZEN_MONTH = "    if (frozenAt(fz, riyadhDayMinuteMs(from, 0)) && frozenAt(fz, riyadhDayMinuteMs(today, 0) - 1)) {";
const ATT_DOMAIN = "    domain: [[\"x_employee_id\", \"in\", employeeIds], [\"x_date\", \">=\", from], [\"x_date\", \"<=\", to], [SIM_FIELD, \"!=\", true]],";
const ROUTE_DOMAIN = "      domain: [[\"x_driver_id\", \"=\", m.partnerId], [\"x_date\", \">=\", first], [\"x_date\", \"<=\", today], [SIM_FIELD, \"!=\", true]], fields: [\"id\", \"x_date\"], limit: 400,";
const SKIP_UNCHANGED = "      if (!Object.keys(vals).length && !opts.stamp) continue;";

const M = [
  // ---------------------------------------------------------------- أ: the secret
  ["أ", "a short secret is a secret", [[HA, "  if (s.length < HOOK_SECRET_MIN) return \"\";\n", ""]], TH],
  ["أ", "the Odoo API key may be the hook secret", [[HA, "  if (s === env.ODOO_API_KEY) return \"\";\n", ""]], TH],
  ["أ", "a worker without its secret accepts the empty token", [[HA, "  return secret !== \"\" && tokensEqual(provided, secret);", "  return tokensEqual(provided, secret);"]], TH],
  ["أ", "a token of the right length opens", [[HA, "  return diff === 0;", "  return true;"]], TH],
  ["أ", "the start of the secret opens", [[HA, "  if (a.length !== b.length) return false;\n", ""]], TH],
  ["أ", "the secret's minimum is a character", [[HA, "export const HOOK_SECRET_MIN = 32;", "export const HOOK_SECRET_MIN = 1;"]], TH],
  // PHASE 3 — the token of before
  ["أ", "the token of before opens again", [[HA, "  return secret !== \"\" && tokensEqual(provided, secret);", "  return (secret !== \"\" && tokensEqual(provided, secret)) || tokensEqual(provided, String((env as unknown as Record<string, string>).ODOO_HOOK_TOKEN ?? \"-\"));"]], TH],
  // the routes
  ["أ", "the two quotation sends are not behind the secret", [[HA, "  return pathname.startsWith(\"/odoo/hook/\") || pathname === \"/internal/quotation-wa-send\" || pathname === \"/internal/sale-quotation-wa-send\";", "  return pathname.startsWith(\"/odoo/hook/\");"]], TH],
  ["أ", "probe=1 answers without checking the token", [[IDX, "      if (!hookTokenOk(env, url.searchParams.get(\"token\") ?? \"\")) return json({ error: \"unauthorized\" }, 401);\n", ""]], TH],
  ["أ", "probe=1 opens outside the hook's routes", [[IDX, "    if (url.searchParams.get(\"probe\") === \"1\" && isHookGated(url.pathname)) {", "    if (url.searchParams.get(\"probe\") === \"1\") {"]], TH],
  ["أ", "probe=1 lets the route run", [[IDX, "      return json({ ok: true, probe: true });\n", ""]], TH],
  route("/odoo/hook/wa-template-sync"), route("/odoo/hook/wa"), route("/internal/quotation-wa-send"), route("/internal/sale-quotation-wa-send"),
  route("/odoo/hook/wa-inbox"), route("/odoo/hook/wa-inbox-partner"), route("/odoo/hook/team-roster"), route("/odoo/hook/special-quote"), route("/odoo/hook/supplier"),
  ["أ", "the admin's template sync is open without the token", [[IDX, "      const providedToken = request.headers.get(\"x-admin-token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {", "      const providedToken = request.headers.get(\"x-admin-token\") ?? \"\";\n      if (false) {"]], TH],

  // ---------------------------------------------------------------- ب: the words
  ["ب", "«غائب» is one hour after the start", [[ATT, "export const ABSENT_AFTER_MIN = 120;", "export const ABSENT_AFTER_MIN = 60;"]], TA],
  ["ب", "the words are not the entry", [[IDX, IN_LINE, "      const isShiftStart = isButton && msg.buttonId === \"shift_start\";"]], TA],
  ["ب", "the words are not the exit", [[IDX, OUT_LINE, "      const isShiftEnd = isButton && msg.buttonId === AT.SHIFT_END_PAYLOAD;"]], TA],
  ["ب", "the exit's button does nothing", [[IDX, OUT_LINE, "      const isShiftEnd = msg.type === \"text\" && AT.shiftOutCommand(msg.text);"]], TA],
  ["ب", "a part of a message is the entry", [[ATT, "  return IN_WORDS.has(plainWords(text));", "  return [...IN_WORDS].some((w) => plainWords(text).includes(w));"]], TA],
  ["ب", "a part of a message is the exit", [[ATT, "  return OUT_WORDS.has(plainWords(text));", "  return [...OUT_WORDS].some((w) => plainWords(text).includes(w));"]], TA],
  ["ب", "the letters' marks are kept", [[ATT, ".replace(/[\\u064B-\\u0652\\u0640]/g, \"\")", ""]], TA],
  ["ب", "the alef's spellings are not one", [[ATT, ".replace(/[أإآ]/g, \"ا\")", ""]], TA],
  ["ب", "an emoji before the words breaks them", [[ATT, "    .replace(/[^\\u0621-\\u064A0-9a-zA-Z ]+/g, \" \")", "    "]], TA],
  // the entry
  ["ب", "an entry in time has minutes late", [[ATT, "  return statusForTap(tapMs, shiftMs) === \"late\" ? Math.floor((tapMs - shiftMs) / MIN) : 0;", "  return Math.max(0, Math.floor((tapMs - shiftMs) / MIN));"]], TA],
  ["ب", "the entry does not write its minutes", [[ATT, TAP_WRITE, "  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status, x_source: SOURCE_WHATSAPP });"]], TA],
  ["ب", "the entry does not say it came from WhatsApp", [[ATT, TAP_WRITE, "  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status, x_late_min: lateMinutes(tapMs, shiftMs) });"]], TA],
  ["ب", "the entry's answer has no «🏁 انتهى دوامي»", [[IDX, "            if (tap.kind === \"first\" && !tap.afterEnd) await sendButtons(env, msg.from, `${tap.text}\\n${AT.ENTRY_HINT}`, [AT.shiftEndButton()], { ctx, purpose: \"shift_ack\" });\n            else await sendText", "            if (false) await sendButtons(env, msg.from, `${tap.text}\\n${AT.ENTRY_HINT}`, [AT.shiftEndButton()], { ctx, purpose: \"shift_ack\" });\n            else await sendText"]], TA],
  ["ب", "the hint before the entry has no «✅ بدأت الدوام»", [[IDX, "          if (att.phase === \"before\" && att.sent) await sendButtons(", "          if (false) await sendButtons("]], TA],
  ["ب", "the hint's button is another payload", [[ATT, "export const shiftStartButton = (): { id: string; title: string } => ({ id: SHIFT_START_PAYLOAD, title: SHIFT_START_TITLE });", "export const shiftStartButton = (): { id: string; title: string } => ({ id: SHIFT_END_PAYLOAD, title: SHIFT_START_TITLE });"]], TA],
  // the exit
  ["ب", "an exit is written on a row with no entry", [[ATT, OPEN_DOMAIN, "    domain: [[\"x_employee_id\", \"=\", employeeId], [\"x_date\", \"in\", [addDaysYmd(day, -1), day]], [\"x_utak_simulation\", \"!=\", true]],"]], TA],
  ["ب", "an exit is written on a simulation row", [[ATT, OPEN_DOMAIN, "    domain: [[\"x_employee_id\", \"=\", employeeId], [\"x_date\", \"in\", [addDaysYmd(day, -1), day]], [\"x_tapped_at\", \"!=\", false]],"]], TA],
  ["ب", "yesterday's open entry is never closed", [[ATT, OPEN_DOMAIN, "    domain: [[\"x_employee_id\", \"=\", employeeId], [\"x_date\", \"=\", day], [\"x_utak_simulation\", \"!=\", true], [\"x_tapped_at\", \"!=\", false]],"]], TA],
  ["ب", "an entry of long ago is closed", [[ATT, "  return before && outMs - odooUtcMs(before.x_tapped_at as string) <= OPEN_ENTRY_MAX_MS ? before : null;", "  return before ?? null;"]], TA],
  ["ب", "a second exit is told the new hour", [[ATT, "  if (row.x_out_at) return again(row.x_out_at);\n", ""]], TA],
  ["ب", "two exits at once are both written", [[ATT, "  if (!claim.claimed) return again(toOdooUtc(outMs));\n", ""]], TA],
  ["ب", "Baraa's exit looks for his entry", [[ATT, "  if (isOwnerNumber(env, m.whatsapp)) return { kind: \"owner\", text: OWNER_NO_ATTENDANCE_TEXT };\n", ""]], TA],
  ["ب", "the exit's answer does not ask for the place", [[IDX, "end.kind === \"done\" ? `${end.text}\\n${AT.EXIT_HINT}` : end.text", "end.text"]], TA],
  // the place
  ["ب", "a place is kept whenever it comes", [[ATT, "  if (!rec || !(rec.rowId > 0) || nowMs < rec.at || nowMs - rec.at > LOCATION_WINDOW_SEC * 1000) return null;", "  if (!rec || !(rec.rowId > 0) || nowMs < rec.at) return null;"]], TA],
  ["ب", "a second place replaces the first", [[ATT, "  try { await env.MSG_DEDUP.delete(placeKey(from)); } catch { /* it expires */ }\n", ""]], TA],
  ["ب", "the exit's place is written as the entry's", [[ATT, "{ [rec.which === \"out\" ? \"x_out_map\" : \"x_in_map\"]: mapUrl(place.latitude, place.longitude) }", "{ x_in_map: mapUrl(place.latitude, place.longitude) }"]], TA],
  ["ب", "the exit does not wait for a place", [[ATT, "  await rememberForPlace(env, m.whatsapp, row.id, \"out\", outMs);\n", ""]], TA],
  ["ب", "the entry does not wait for a place", [[ATT, "  await rememberForPlace(env, m.whatsapp, row.id, \"in\", tapMs);\n", ""]], TA],
  ["ب", "a place is never kept", [[IDX, "          const which = await AT.saveShiftPlace(env, msg.from, msg.location);", "          const which = null as \"in\" | \"out\" | null;"]], TA],
  // «غائب»
  ["ب", "every absent member is his own alert", [[ATT, ABSENT_SEND, "      for (const one of absent) await sendOwnerAlert(withAutoSendJob(env, \"shift_absent\"), absentText([one]), { kind: ABSENT_ALERT_KIND });"]], TA],
  ["ب", "the «غائب» alerts are not one kind", [[ATT, ABSENT_SEND, "      await sendOwnerAlert(withAutoSendJob(env, \"shift_absent\"), absentText(absent));"]], TA],
  ["ب", "nobody is told of «غائب»", [[ATT, "  if (absent.length) {", "  if (false) {"]], TA],
  // the time off
  ["ب", "a day of time off has no row", [[ATT, LEAVE_IF, "      if (false) {"]], TA],
  ["ب", "the time off's row is written before the shift's hour", [[ATT, LEAVE_IF, "      if (dp.kind === \"leave\" && dp.startMin !== undefined) {"]], TA],
  ["ب", "the time off's row is written again after a KV wipe", [[ATT, "    if (await findRow(env, m.employeeId, day)) return \"leave\";\n", ""]], TA],
  ["ب", "the time off's row does not carry its name", [[ATT, "      x_source: SOURCE_MANUAL, x_note: `إجازة: ${dp.leave || \"إجازة\"}`,", "      x_source: SOURCE_MANUAL,"]], TA],
  // off attendance
  ["ب", "a member off attendance is not recorded", [[ATT, "  if (plan.kind !== \"work\") return freeEntry(env, roster, m, day, tapMs);", "  if (plan.kind !== \"work\") return { kind: \"not_on_attendance\" };"]], TA],
  ["ب", "a member off attendance is never late", [[ATT, "    if (shiftMs !== null) status = statusForTap(tapMs, shiftMs);\n", ""]], TA],
  ["ب", "his own schedule is not read", [[ATT, "    if (lines.some((l) => !l.durationBased && l.hourTo > l.hourFrom)) return daySpan(lines, m.calendarId, day);\n", ""]], TA],
  ["ب", "the company's working days are not read", [[ATT, "  return co ? daySpan(co.lines, co.calendarId, day) : null;", "  return null;"]], TA],
  ["ب", "his second «بدأت الدوام» makes a second entry", [[ATT, "  if (row?.x_tapped_at) return again(row);\n  const claim = await claimButton(env, claimKey(day, m, \"tap\"), CLAIM_TTL);\n  if (!claim.claimed) return again({ id: row?.id ?? 0,", "  const claim = await claimButton(env, `${claimKey(day, m, \"tap\")}:${tapMs}`, CLAIM_TTL);\n  if (!claim.claimed) return again({ id: row?.id ?? 0,"]], TA],
  // the trial
  ["ب", "the trial's row is a real one", [[TRI, "      x_note: S68_TRIAL_NOTE, x_utak_simulation: true,", "      x_note: S68_TRIAL_NOTE, x_utak_simulation: false,"]], TA],
  ["ب", "the trial runs twice a day", [[TRI, "    if (row) return { op, sent: false, rowId: row.id, reason: \"the trial's entry was recorded today already\" };\n", ""]], TA],
  ["ب", "the trial's exit is written twice", [[TRI, "    if (row.x_out_at) {", "    if (false) {"]], TA],
  ["ب", "the trial's button works from any number", [[IDX, "          if (isOwnerNumber(env, msg.from)) await (await import(\"./s68-trial\")).runS68Trial(env, \"out\");", "          await (await import(\"./s68-trial\")).runS68Trial(env, \"out\");"]], TA],
  ["ب", "the trial's purpose may not reach Baraa", [[GW, "(OWNER_ALLOWED_PURPOSES as Set<string>).add(\"attendance_test\");", ""]], TA],
  ["ب", "the trial's answer has a member's own exit button", [[TRI, "[{ id: S68_TRIAL_END_PAYLOAD, title: SHIFT_END_TITLE }]", "[{ id: \"shift_end\", title: SHIFT_END_TITLE }]"]], TA],
  route("/odoo/hook/s68-trial", "ب", TA),

  // ---------------------------------------------------------------- ج: the papers
  ["ج", "the driving licence is asked of everyone", [[EF, "    .filter((d) => !d.role || codes.includes(d.role))\n", ""]], TF],
  ["ج", "an unnamed «أخرى» is asked", [[EF, "    .filter((d) => !d.name || named(d) !== \"\")\n", ""]], TF],
  ["ج", "Odoo's empty name is a name", [[EF, "(d.name && typeof card[d.name] === \"string\" ? (card[d.name] as string).trim() : \"\")", "(d.name ? String(card[d.name] ?? \"\").trim() : \"\")"]], TF],
  ["ج", "«لا ينطبق» is asked", [[EF, "    .filter((d) => card[d.state] !== \"na\")\n", ""]], TF],
  ["ج", "«قيد الإجراء» is complete", [[EF, ASKED_STATE, "      state: card[d.state] === \"done\" || card[d.state] === \"progress\" ? \"done\" : \"missing\","]], TF],
  ["ج", "«قيد الإجراء» is not said", [[EF, ASKED_STATE, "      state: card[d.state] === \"done\" ? \"done\" : \"missing\","]], TF],
  ["ج", "the percentage rounds down", [[EF, ".length) / papers.length + 0.5) : 100;", ".length) / papers.length) : 100;"]], TF],
  ["ج", "no paper asked is 0%", [[EF, ".length) / papers.length + 0.5) : 100;", ".length) / papers.length + 0.5) : 0;"]], TF],
  ["ج", "the worker reads a paper's number", [[EF, "[d.state, d.expiry, ...(d.name ? [d.name] : [])]", "[d.state, d.expiry, d.number, ...(d.name ? [d.name] : [])]"]], TF],
  // the ends
  ["ج", "thirty days are sixty", [[EF, "  if (left <= 30) return \"30\";", "  if (left <= 60) return \"30\";"]], TF],
  ["ج", "seven days are not a step", [[EF, "  if (left <= 7) return \"7\";\n", ""]], TF],
  ["ج", "a paper that ended is not told", [[EF, "  if (left < 0) return \"expired\";", "  if (left < 0) return null;"]], TF],
  ["ج", "a paper is told every day", [[EF, "      if (!told) due.push({ key, line: expiryLine(m.name, p.title, p.expiry, today) });", "      due.push({ key, line: expiryLine(m.name, p.title, p.expiry, today) });"]], TF],
  ["ج", "a message that did not leave marks its papers told", [[EF, "  if (r.outcome === \"failed\") return { due: due.length, outcome: \"failed\" };\n", ""]], TF],
  ["ج", "each paper is its own message", [[EF, "  const r = await ownerAlert(env, `${EXPIRY_HEAD}\\n${due.map((d) => d.line).join(\"\\n\")}\\nتُحدَّث من «👥 الموظفون ← الأوراق».`, { kind: EXPIRY_KIND, now });", "  let r = { outcome: \"sent\" as string };\n  for (const one of due) r = await ownerAlert(env, `${EXPIRY_HEAD}\\n${one.line}`, { now });"]], TF],
  // the month
  ["ج", "the summary goes on any day", [[EF, "  if (today.slice(8, 10) !== \"01\") return \"not_first\";\n", ""]], TF],
  ["ج", "the summary goes at every run of the first", [[EF, "  if (!claim.claimed) return \"sent_before\";\n", ""]], TF],
  ["ج", "a month frozen whole is told", [[EF, FROZEN_MONTH, "    if (false) {"]], TF],
  ["ج", "a month frozen at its start alone is not told", [[EF, FROZEN_MONTH, "    if (frozenAt(fz, riyadhDayMinuteMs(from, 0))) {"]], TF],
  ["ج", "a month frozen at its end alone is not told", [[EF, FROZEN_MONTH, "    if (frozenAt(fz, riyadhDayMinuteMs(today, 0) - 1)) {"]], TF],
  ["ج", "a summary that did not leave is not tried again", [[EF, "    if (r.outcome === \"failed\") { await releaseButton(env, claim); return \"failed\"; }", "    if (r.outcome === \"failed\") return \"failed\";"]], TF],
  ["ج", "simulation rows enter the month", [[EF, ATT_DOMAIN, "    domain: [[\"x_employee_id\", \"in\", employeeIds], [\"x_date\", \">=\", from], [\"x_date\", \"<=\", to]],"]], TF],
  ["ج", "the new month's rows enter the month", [[EF, ATT_DOMAIN, "    domain: [[\"x_employee_id\", \"in\", employeeIds], [\"x_date\", \">=\", from], [SIM_FIELD, \"!=\", true]],"]], TF],
  ["ج", "the month before enters the month", [[EF, ATT_DOMAIN, "    domain: [[\"x_employee_id\", \"in\", employeeIds], [\"x_date\", \"<=\", to], [SIM_FIELD, \"!=\", true]],"]], TF],
  ["ج", "a late day is not a day present", [[EF, "    if (r.x_status === \"present\" || r.x_status === \"late\") f.present++;", "    if (r.x_status === \"present\") f.present++;"]], TF],
  ["ج", "the minutes of a day in time are counted", [[EF, "    if (r.x_status === \"late\") { f.late++; f.lateMin += Number(r.x_late_min) || 0; }", "    if (r.x_status === \"late\") f.late++;\n    f.lateMin += Number(r.x_late_min) || 0;"]], TF],
  ["ج", "one employee's month is everyone's rows", [[EF, "monthFigures(rows.filter((r) => m2oId(r.x_employee_id) === m.employeeId))", "monthFigures(rows)"]], TF],
  // «العهدة والمستحقات»
  ["ج", "who is not a collector has a custody", [[EF, "  if (!m.codes.includes(\"collector\") || !m.partnerId) return { collector: false };\n", ""]], TF],
  ["ج", "a transfer is cash in hand", [[EF, "  const cash = (await collectedBy(env, m.partnerId, [[\"x_method\", \"=\", \"cash\"]]));", "  const cash = (await collectedBy(env, m.partnerId));"]], TF],
  ["ج", "a simulation payment is cash", [[EF, "    domain: [[\"x_collected_by\", \"=\", partnerId], [SIM_FIELD, \"!=\", true], ...extra],", "    domain: [[\"x_collected_by\", \"=\", partnerId], ...extra],"]], TF],
  ["ج", "a simulation invoice's payment is cash", [[EF, "  return pays.filter((p) => !sim.has(m2oId(p.x_invoice_id)));", "  return pays;"]], TF],
  ["ج", "another collector's cash is his", [[EF, "    domain: [[\"x_collected_by\", \"=\", partnerId], [SIM_FIELD, \"!=\", true], ...extra],", "    domain: [[SIM_FIELD, \"!=\", true], ...extra],"]], TF],
  ["ج", "this month's cash is all his cash", [[EF, "month: cashOf(cash.filter((p) => p.x_collected_at && odooUtcMs(p.x_collected_at) >= fromMs))", "month: cashOf(cash)"]], TF],
  ["ج", "draft lines are in the journal's balance", [[EF, "[[\"account_id\", \"=\", account], [\"parent_state\", \"=\", \"posted\"]]", "[[\"account_id\", \"=\", account]]"]], TF],
  ["ج", "another account's lines are in the journal's balance", [[EF, "[[\"account_id\", \"=\", account], [\"parent_state\", \"=\", \"posted\"]]", "[[\"parent_state\", \"=\", \"posted\"]]"]], TF],
  ["ج", "no journal reads as a balance of 0", [[EF, "    if (!account) return null;", "    if (!account) return 0;"]], TF],
  // «الأداء»
  ["ج", "a late delivery is in time", [[EF, "      if (odooUtcMs(s.x_delivered_at as string) <= end) f.deliveries.onTime++;", "      f.deliveries.onTime++;"]], TF],
  ["ج", "a simulation route is his", [[EF, ROUTE_DOMAIN, "      domain: [[\"x_driver_id\", \"=\", m.partnerId], [\"x_date\", \">=\", first], [\"x_date\", \"<=\", today]], fields: [\"id\", \"x_date\"], limit: 400,"]], TF],
  ["ج", "last month's route is this month's", [[EF, ROUTE_DOMAIN, "      domain: [[\"x_driver_id\", \"=\", m.partnerId], [\"x_date\", \"<=\", today], [SIM_FIELD, \"!=\", true]], fields: [\"id\", \"x_date\"], limit: 400,"]], TF],
  ["ج", "another driver's route is his", [[EF, ROUTE_DOMAIN, "      domain: [[\"x_date\", \">=\", first], [\"x_date\", \"<=\", today], [SIM_FIELD, \"!=\", true]], fields: [\"id\", \"x_date\"], limit: 400,"]], TF],
  ["ج", "a customer's refusal is damage", [[EF, "[[\"x_order_id\", \"in\", orders], [\"x_return_reason\", \"=\", \"damaged\"]]", "[[\"x_order_id\", \"in\", orders]]"]], TF],
  ["ج", "a simulation note is counted", [[EF, "[[\"x_order_id\", \"in\", orders], [\"x_kind\", \"=\", \"damaged\"], [\"x_is_simulation\", \"!=\", true]]", "[[\"x_order_id\", \"in\", orders], [\"x_kind\", \"=\", \"damaged\"]]"]], TF],
  ["ج", "a «ناقص» note is damage", [[EF, "[[\"x_order_id\", \"in\", orders], [\"x_kind\", \"=\", \"damaged\"], [\"x_is_simulation\", \"!=\", true]]", "[[\"x_order_id\", \"in\", orders], [\"x_is_simulation\", \"!=\", true]]"]], TF],
  ["ج", "an invoice's days stop at its first collection", [[EF, "if (issued.has(id) && at >= (last.get(id) ?? 0)) last.set(id, at);", "if (issued.has(id) && !last.has(id)) last.set(id, at);"]], TF],
  ["ج", "the custody difference is a week's", [[EF, "    for (let i = 0; i < 4; i++) { const rec = await readCustody(", "    for (let i = 0; i < 7; i++) { const rec = await readCustody("]], TF],
  ["ج", "no data is a figure of 0", [[EF, "    lines.push(!c || c.invoices === 0 ? `• أيام التحصيل: ${NO_DATA}` : ", "    lines.push(!c ? `• أيام التحصيل: ${NO_DATA}` : "]], TF],
  ["ج", "no delivery is 0 of 0", [[EF, "    lines.push(!d || d.delivered === 0 ? `• التسليمات في وقتها: ${NO_DATA}`", "    lines.push(!d ? `• التسليمات في وقتها: ${NO_DATA}`"]], TF],
  ["ج", "who has no role gets figures", [[EF, "  if (!f.driver && !f.collector) return `${lines[0]}\\n${NO_ROLE_PERF_TEXT}`;\n", ""]], TF],
  // the card, the button, the run
  ["ج", "a card is written when nothing changed", [[EF, SKIP_UNCHANGED, ""]], TF],
  ["ج", "the button does not write the hour", [[EF, SKIP_UNCHANGED, "      if (!Object.keys(vals).length) continue;"]], TF],
  ["ج", "the button refreshes every card", [[EF, "  const staff = roster.staff.filter((m) => !opts.employeeId || m.employeeId === opts.employeeId);", "  const staff = roster.staff;"]], TF],
  ["ج", "the button takes another model", [[IDX, "      if (url.searchParams.get(\"op\") !== \"refresh\" || body._model !== \"hr.employee\" || !Number.isInteger(id) || id <= 0) {", "      if (url.searchParams.get(\"op\") !== \"refresh\" || !Number.isInteger(id) || id <= 0) {"]], TF],
  ["ج", "the button takes another op", [[IDX, "      if (url.searchParams.get(\"op\") !== \"refresh\" || body._model !== \"hr.employee\" || !Number.isInteger(id) || id <= 0) {", "      if (body._model !== \"hr.employee\" || !Number.isInteger(id) || id <= 0) {"]], TF],
  route("/odoo/hook/employee-file", "ج", TF),
  ["ج", "the day's run goes before 08:10", [[EF, "  if (riyadhMinutes(new Date(now)) < FILE_TICK_MINUTE) return { action: \"before\" };\n", ""]], TF],
  ["ج", "the day's run goes at every tick", [[EF, "  if (!claim.claimed) return { action: \"done_today\" };\n", ""]], TF],
  ["ج", "Odoo not answering spends the day's run", [[EF, "    await releaseButton(env, claim); // Odoo did not answer: the next tick tries again\n", ""]], TF],
  ["ج", "the tick does not run the file's day", [[IDX, "            const ef = await runEmployeeFileTick(rawEnv, Date.now());", "            const ef = { action: \"before\" as string };"]], TF],
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
writeFileSync(new URL("../artifacts/s68-20261008-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
