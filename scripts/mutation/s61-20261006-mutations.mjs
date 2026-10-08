// Mutation check for § 61 (2026-10-06) — the jobs: an employee's roles are his job's ∪ his card's, his
// schedule and attendance (ب: src/team-roster.ts), an employee who enters a job and one who leaves it
// (د: src/staffing.ts, src/index.ts), the vacant job and the data check of the 21:30 summary (ملخص:
// src/staffing.ts, src/owner-summary.ts), the three trials (و: src/s61-trials.ts, src/wa-gateway.ts), the
// four jobs' data and the template (ج: scripts/lib/s61-odoo.mjs, scripts/lib/s61-templates.mjs) and the
// operating guide (دليل: docs/OPERATING-DAY.md). Each mutation disables ONE guard, runs the test file,
// and must make it fail. The source is restored in `finally` after every run; a pattern that is not
// found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s61-20261006-mutations.mjs [ب د ملخص و ج دليل]     (no argument: every part)
//
// Out: scripts/artifacts/s61-20261006-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s61-jobs.test.mts";
const TR = "src/team-roster.ts", ST = "src/staffing.ts", TRIAL = "src/s61-trials.ts", LIB = "scripts/lib/s61-odoo.mjs", GUIDE = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ب — the effective roles, schedule and attendance
  ["ب", "the job's roles are not read (the card's alone, as before § 61)", [[TR,
    "const codes = effectiveCodes(job?.codes ?? [], codesOf(r.x_utak_role_ids));", "const codes = effectiveCodes([], codesOf(r.x_utak_role_ids));"]], T],
  ["ب", "the card's additional roles are dropped once he has a job", [[TR,
    "const codes = effectiveCodes(job?.codes ?? [], codesOf(r.x_utak_role_ids));", "const codes = effectiveCodes(job?.codes ?? [], job ? [] : codesOf(r.x_utak_role_ids));"]], T],
  ["ب", "the card's roles come before the job's", [[TR,
    "  return [...new Set([...jobCodes, ...cardCodes])];", "  return [...new Set([...cardCodes, ...jobCodes])];"]], T],
  ["ب", "a role on both the job and the card is held twice", [[TR,
    "  return [...new Set([...jobCodes, ...cardCodes])];", "  return [...jobCodes, ...cardCodes];"]], T],
  ["ب", "an employee with a job and an empty card is not read at all", [[TR,
    "domain: [\"|\", [\"x_utak_role_ids\", \"!=\", false], [\"job_id\", \"!=\", false]],", "domain: [[\"x_utak_role_ids\", \"!=\", false]],"]], T],
  ["ب", "the job's «مشمول بالتحضير» is ignored", [[TR,
    "attendance: r.x_utak_attendance === true || job?.attendance === true,", "attendance: r.x_utak_attendance === true,"]], T],
  ["ب", "the card's «مشمول بالتحضير» is ignored once he has a job", [[TR,
    "attendance: r.x_utak_attendance === true || job?.attendance === true,", "attendance: job ? job.attendance === true : r.x_utak_attendance === true,"]], T],
  ["ب", "Odoo's default schedule on a new card wins the job's default", [[TR,
    "  if (job?.id && (!card.id || card.id === companyDefault)) return { id: job.id, name: job.name };", "  if (job?.id && !card.id) return { id: job.id, name: job.name };"]], T],
  ["ب", "the job's default schedule wins a schedule chosen on the card", [[TR,
    "  if (job?.id && (!card.id || card.id === companyDefault)) return { id: job.id, name: job.name };", "  if (job?.id) return { id: job.id, name: job.name };"]], T],
  ["ب", "the company's default schedule is never read", [[TR,
    "  if (rows.some((r) => jobById.get(m2oId(r.job_id as M2O) ?? 0)?.calendarId)) {", "  if (rows.length < 0) {"]], T],
  ["ب", "a holder of a job without roles is not on the staff", [[TR,
    "    if (codes.length === 0 && !job) continue;", "    if (codes.length === 0) continue;"]], T],
  ["ب", "a holder of a job without roles is a team member", [[TR,
    "  const members = staff.filter((m) => m.codes.length > 0);", "  const members = staff;"]], T],
  ["ب", "the roster does not name the member's job", [[TR,
    "      jobId: job?.id ?? null,", "      jobId: null,"]], T],
  ["ب", "a roster cached by the code of before § 61 is read as this one", [[TR,
    "if (r && Array.isArray(r.members) && Array.isArray(r.jobs) && Array.isArray(r.staff) && nowMs", "if (r && Array.isArray(r.members) && nowMs"]], T],
  ["ب", "the jobs' roles are not turned into codes", [[TR,
    "    codes: codesOf(j.x_job_role_ids),", "    codes: [],"]], T],
  ["ب", "the job's default schedule is not read", [[TR,
    "    calendarId: m2oId(j.x_default_calendar_id as M2O),", "    calendarId: null,"]], T],

  // ---------------------------------------------------------------- د — in
  ["د", "the first tick announces everyone who holds a job", [[ST,
    "  if (prev === null) {\n    await env.MSG_DEDUP.put(STAFF_KV, JSON.stringify(now));\n    return { action: \"baseline\", moves: [] };\n  }", "  if (prev === null) prev = [];"]], T],
  ["د", "the roster of the tick is not kept (the same move at every tick)", [[ST,
    "  if (JSON.stringify(now) !== JSON.stringify(prev)) await env.MSG_DEDUP.put(STAFF_KV, JSON.stringify(now));\n", ""]], T],
  ["د", "a move is announced again when its claim was taken", [[ST,
    "      if (!claim.claimed) { done.push(`${name}:${mv.kind}:claimed_before`); continue; }\n", ""]], T],
  ["د", "an empty roster is believed: everyone «left»", [[ST,
    "  if (now.length === 0 && prev.some((p) => p.jobId)) {", "  if (now.length < 0) {"]], T],
  ["د", "an unchanged holder is an entry at every tick", [[ST,
    "    if (m.jobId && p?.jobId !== m.jobId) out.push({ kind: \"in\", who: m });", "    if (m.jobId) out.push({ kind: \"in\", who: m });"]], T],
  ["د", "an employee given a job is not an entry", [[ST,
    "    if (m.jobId && p?.jobId !== m.jobId) out.push({ kind: \"in\", who: m });\n", ""]], T],
  ["د", "a job changed is not an exit from the old one", [[ST,
    "    if (p?.jobId && p.jobId !== m.jobId) out.push({ kind: \"out\", who: p, why: m.jobId ? \"job_changed\" : \"job_removed\", next: m.jobName });\n", ""]], T],
  ["د", "a job changed reads «أُزيلت الوظيفة»", [[ST,
    "why: m.jobId ? \"job_changed\" : \"job_removed\", next: m.jobName", "why: \"job_removed\", next: m.jobName"]], T],
  ["د", "an employee gone from the staff is not an exit", [[ST,
    "  for (const p of prev) if (p.jobId && !now.has(p.id)) out.push({ kind: \"gone\", who: p });\n", ""]], T],
  ["د", "an archived employee reads «أُزيلت الوظيفة», and the reverse", [[ST,
    "(await archived(env, id)) === false ? \"job_removed\" : \"archived\";", "(await archived(env, id)) === false ? \"archived\" : \"job_removed\";"]], T],
  ["د", "Baraa is sent a welcome to himself", [[ST,
    "  if (isOwner(env, m.whatsapp)) return \"owner\";\n", ""]], T],
  ["د", "a welcome that cannot go is held for the employee", [[ST,
    "      noHold: true, noHoldReason: \"الترحيب يصل براء نصاً ليرسله بنفسه\", ctx,", "      ctx,"]], T],
  ["د", "no template outside the employee's window", [[ST,
    "      fallback: [{ kind: \"template\", purpose: TEAM_WELCOME_PURPOSE, params: [...params] }],\n", ""]], T],
  ["د", "the template's variables in another order", [[ST,
    "  return [name, jobName, firstTaskForMember(first)];", "  return [jobName, name, firstTaskForMember(first)];"]], T],
  ["د", "the welcome's text is not the template's", [[ST,
    "أول مهمة تصلك ${p[2]}. مهامك وتحديثاتها تصلك في هذه المحادثة.`;", "أول مهمة تصلك ${p[2]}.`;"]], T],
  ["د", "a welcome by the template reads as one in his window", [[ST,
    "return d?.action === \"session\" ? \"session\" : d?.action === \"template\" ? \"template\" : \"not_sent\";", "return d?.action === \"session\" || d?.action === \"template\" ? \"session\" : \"not_sent\";"]], T],
  ["د", "a welcome that did not go: Baraa is not given its text", [[ST,
    "أرسله له بنفسك:\\n${text}`;", "أرسله له بنفسك.`;"]], T],
  ["د", "Baraa gets no message of the entry", [[ST,
    "  await sendOwnerAlert(env, entryText(m, first, takeover, fate, welcomeText(params)));\n", ""]], T],
  ["د", "the entry message carries the title of the takeover list without its points", [[ST,
    "takeover.length ? [\"قائمة الاستلام:\", ...bullets(takeover)] : [NO_TAKEOVER_TEXT]", "takeover.length ? [\"قائمة الاستلام:\"] : [NO_TAKEOVER_TEXT]"]], T],
  ["د", "the entry message carries the HANDOVER list", [[ST,
    "takeover = (await readJobLists(env, m.jobId)).takeover;", "takeover = (await readJobLists(env, m.jobId)).handover;"]], T],
  ["د", "an employee without a number: no warning", [[ST,
    "    ...(m.whatsapp ? [] : [NO_NUMBER_WARNING]),\n", ""]], T],
  ["د", "on attendance without a schedule: no warning", [[ST,
    "    ...(m.attendance && !m.calendarName ? [NO_SCHEDULE_WARNING] : []),\n", ""]], T],
  ["د", "«مدير» is shown as a message role", [[ST,
    "{ driver: \"سائق\", warehouse: \"شراء\", collector: \"محصّل\", marketing: \"تسويق\" };", "{ driver: \"سائق\", warehouse: \"شراء\", collector: \"محصّل\", marketing: \"تسويق\", admin: \"مدير\" };"]], T],
  ["د", "the first task ignores his shift", [[ST,
    "  if (m.attendance) {\n    const n = nextShiftStart(roster, m, nowMs);", "  if (m.attendance && nowMs < 0) {\n    const n = nextShiftStart(roster, m, nowMs);"]], T],
  ["د", "a marketing member's first task is «none»", [[ST,
    "  if (m.codes.includes(\"marketing\")) return { kind: \"prices\" };\n", ""]], T],
  ["د", "the first shift without its weekday in the welcome", [[ST,
    "return `مع بداية دوامك يوم ${weekday} الساعة ${hhmm(t.startMin)}`;", "return `مع بداية دوامك الساعة ${hhmm(t.startMin)}`;"]], T],
  ["د", "the pulse does not run the jobs' tick", [["src/index.ts",
    "const st = await runStaffingTick(withAutoSendJob(rawEnv, STAFFING_JOB), Date.now(), ctx);", "const st = { action: \"none\", moves: [] as string[] }; void runStaffingTick; void STAFFING_JOB;"]], T],
  ["د", "the welcome's purpose is not registered", [["src/wa-purposes.ts",
    "  team_welcome: op(\"ترحيب موظف جديد\"),\n", ""]], T],

  // ---------------------------------------------------------------- د — out
  ["د", "the exit message carries the TAKEOVER list", [[ST,
    "handover = (await readJobLists(env, who.jobId)).handover;", "handover = (await readJobLists(env, who.jobId)).takeover;"]], T],
  ["د", "the day's cash with him is not read", [[ST,
    "      if (cash.count > 0 || handed) {", "      if (cash.count < 0) {"]], T],
  ["د", "the cash of everyone is read as his", [[ST,
    "const cash = await expectedCash(env, who.partnerId, day);", "const cash = await expectedCash(env, null, day);"]], T],
  ["د", "his custody of the day is not read", [[ST,
    "const handed = await readCustody(env, day, who.partnerId).catch(() => null);", "const handed = null as { handed: number } | null;"]], T],
  ["د", "the invoices to collect are not read", [[ST,
    "      if (open.length) out.push(`فواتير غير محصّلة:", "      if (open.length < 0) out.push(`فواتير غير محصّلة:"]], T],
  ["د", "the invoices to collect are read for one who never collected", [[ST,
    "  if (has(\"collector\")) {", "  if (has(\"collector\") || has(\"driver\")) {"]], T],
  ["د", "his open stops are not read", [[ST,
    "      if (stops.length) out.push(`محطات بلا «تم التسليم»:", "      if (stops.length < 0) out.push(`محطات بلا «تم التسليم»:"]], T],
  ["د", "the purchase lists not received are not read", [[ST,
    "      if (lists.length) out.push(`قوائم شراء غير مستلمة:", "      if (lists.length < 0) out.push(`قوائم شراء غير مستلمة:"]], T],
  ["د", "the purchase lists are read for one who never bought", [[ST,
    "  if (has(\"warehouse\")) {", "  if (has(\"warehouse\") || has(\"driver\")) {"]], T],
  ["د", "nothing open: no line says so", [[ST,
    "    ...bullets(facts.length ? facts : [NOTHING_OPEN_TEXT]),", "    ...bullets(facts),"]], T],
  ["د", "his kept tasks are not moved (the tick counts them only)", [[ST,
    "  try { moved = await moveKeptTasks(env, who, roster, stays); }", "  try { moved = await moveKeptTasks(env, who, roster, true); }"]], T],
  ["د", "his kept tasks are taken from him although he still holds a role", [[ST,
    "  const stays = roster.members.some((m) => m.employeeId === who.id);", "  const stays = false;"]], T],
  ["د", "his kept tasks go to a member who holds none of his roles", [[ST,
    "waDigits(m.whatsapp) !== waDigits(who.whatsapp) && who.codes.some((c) => m.codes.includes(c))) ?? null;", "waDigits(m.whatsapp) !== waDigits(who.whatsapp)) ?? null;"]], T],
  ["د", "what was kept for him stays kept for his number", [[ST,
    "  // he left: nothing kept for him goes to his number any more\n  await env.MSG_DEDUP.delete(key);\n", ""]], T],
  ["د", "with no other holder, his kept tasks' texts do not reach Baraa", [[ST,
    "    ...q.texts.slice(0, KEPT_SHOWN).map((t) => `• ${t.replace(/\\s+/g, \" \").slice(0, 160)}`),\n", ""]], T],
  ["د", "Baraa gets no message of the exit", [[ST,
    "  await sendOwnerAlert(env, exitText(who, why, handover, facts, keptLines(moved, false, stays), nextJob));\n", ""]], T],
  ["د", "a job changed does not name the new job", [[ST,
    "  if (why === \"job_changed\") return `صار ${next}`;\n", ""]], T],

  // ---------------------------------------------------------------- ملخص — the vacant job and the data check
  ["ملخص", "a job without roles is «شاغرة»", [[ST,
    "  return roster.jobs.filter((j) => j.codes.length > 0 && !roster.staff.some((m) => m.jobId === j.id));", "  return roster.jobs.filter((j) => !roster.staff.some((m) => m.jobId === j.id));"]], T],
  ["ملخص", "a held job is «شاغرة»", [[ST,
    "  return roster.jobs.filter((j) => j.codes.length > 0 && !roster.staff.some((m) => m.jobId === j.id));", "  return roster.jobs.filter((j) => j.codes.length > 0);"]], T],
  ["ملخص", "the vacancy line says another word", [[ST,
    "  return jobs.length ? `وظيفة شاغرة: ${jobs.map((j) => j.name).join(\"، \")}` : \"\";", "  return jobs.length ? `وظائف بلا موظف: ${jobs.map((j) => j.name).join(\"، \")}` : \"\";"]], T],
  ["ملخص", "the data check comes before the vacancy line", [[ST,
    "  return [vacancyLine(vacantJobs(roster)), dataCheckLine(await dataFindings(env, roster, day))].filter(Boolean);", "  return [dataCheckLine(await dataFindings(env, roster, day)), vacancyLine(vacantJobs(roster))].filter(Boolean);"]], T],
  ["ملخص", "the 21:30 summary does not carry the two lines", [["src/owner-summary.ts",
    "...(f.unavailable ? [f.unavailable] : []), ...(f.staffing ?? [])];", "...(f.unavailable ? [f.unavailable] : [])];"]], T],
  ["ملخص", "the summary's figures do not read the two lines", [["src/owner-summary.ts",
    "  f.staffing = (await attempt(\"staffing\", async () => (await import(\"./staffing\")).staffingLines(env, day, nowMs))) ?? [];\n", ""]], T],
  ["ملخص", "every employee is checked, not the operating roles alone", [[ST,
    "  const operating = roster.staff.filter((m) => m.codes.some((c) => OPERATING_ROLES.includes(c)));", "  const operating = roster.staff;"]], T],
  ["ملخص", "an operating role without a number is not found", [[ST,
    "    noNumber: operating.filter((m) => !m.whatsapp).map((m) => m.name),", "    noNumber: [],"]], T],
  ["ملخص", "an operating role without a schedule is not found", [[ST,
    "    noSchedule: operating.filter((m) => !m.calendarId).map((m) => m.name),", "    noSchedule: [],"]], T],
  ["ملخص", "a simulation cost line covers a job", [[ST,
    "[\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],\n      fields: [\"id\", \"x_name\", \"x_job_id\", \"x_employee_id\"]", "[\"x_date_to\", \">=\", day]],\n      fields: [\"id\", \"x_name\", \"x_job_id\", \"x_employee_id\"]"]], T],
  ["ملخص", "a closed cost line covers a job", [[ST,
    "domain: [[\"x_date_from\", \"<=\", day], \"|\", [\"x_date_to\", \"=\", false], [\"x_date_to\", \">=\", day], [SIM_FIELD, \"!=\", true]],\n      fields: [\"id\", \"x_name\", \"x_job_id\", \"x_employee_id\"]", "domain: [[\"x_date_from\", \"<=\", day], [SIM_FIELD, \"!=\", true]],\n      fields: [\"id\", \"x_name\", \"x_job_id\", \"x_employee_id\"]"]], T],
  ["ملخص", "a cost line tied to the holder does not cover his job", [[ST,
    "!jobsPaid.has(j.id) && !holders.some((m) => employeesPaid.has(m.employeeId)); })", "!jobsPaid.has(j.id); })"]], T],
  ["ملخص", "a cost line tied to the job does not cover it", [[ST,
    "return holders.length > 0 && !jobsPaid.has(j.id) && !holders.some(", "return holders.length > 0 && !holders.some("]], T],
  ["ملخص", "a vacant job is asked for a cost line", [[ST,
    "return holders.length > 0 && !jobsPaid.has(j.id) && !holders.some(", "return !jobsPaid.has(j.id) && !holders.some("]], T],
  ["ملخص", "an ACTIVE employee's cost line is «لموظف غير نشط»", [[ST,
    "    const inactive = new Set(rows.filter((r) => r.active === false).map((r) => r.id));", "    const inactive = new Set(rows.map((r) => r.id));"]], T],
  ["ملخص", "an archived employee's cost line is not found", [[ST,
    "    f.inactiveCost = lines.filter((l) => inactive.has(m2oId(l.x_employee_id))).map((l) => String(l.x_name || `#${l.id}`));", "    f.inactiveCost = [];"]], T],
  ["ملخص", "the data check's line goes out with nothing found", [[ST,
    "  return parts.length ? `${DATA_CHECK_HEAD} ${parts.join(\" · \")}` : \"\";", "  return `${DATA_CHECK_HEAD} ${parts.join(\" · \")}`;"]], T],
  ["ملخص", "cost lines that cannot be read are passed in silence", [[ST,
    "    f.noCost === null ? \"بنود التكلفة: تعذّرت قراءتها\" : f.noCost.length", "    f.noCost === null ? \"\" : f.noCost.length"]], T],

  // ---------------------------------------------------------------- و — the trials
  ["و", "the trials are not marked «🧪 تجربة»", [[TRIAL,
    "export const S61_TRIAL_MARK = \"🧪 تجربة\";", "export const S61_TRIAL_MARK = \"ملاحظة\";"]], T],
  ["و", "a trial goes again the same day", [[TRIAL,
    "  if (!claim.claimed) return { sent: false, reason: \"already_today\" };\n", ""]], T],
  ["و", "a trial is tried while his window is closed", [[TRIAL,
    "  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: \"window_closed\" };\n", ""]], T],
  ["و", "the exit trial MOVES his kept tasks", [[TRIAL,
    "keptLines(await moveKeptTasks(env, who, roster, true), true);", "keptLines(await moveKeptTasks(env, who, roster, false), true);"]], T],
  ["و", "the trial employee takes a held job, not the vacant one", [[TRIAL,
    "  return vacantJobs(roster)[0] ?? roster.jobs.find((j) => j.codes.length > 0) ?? roster.jobs[0] ?? null;", "  return roster.jobs.find((j) => j.codes.length > 0) ?? roster.jobs[0] ?? null;"]], T],
  ["و", "the exit trial reads another employee's card", [[TRIAL,
    "roster.staff.find((m) => m.jobId && waDigits(m.whatsapp) === owner) ?? null;", "roster.staff.find((m) => m.jobId) ?? null;"]], T],
  ["و", "the trials do not say nothing was written", [[TRIAL,
    "    const why = await went(env, owner, [entryTrialHead(job.name), \"\", body, \"\", S61_TRIAL_TAIL].join(\"\\n\"));", "    const why = await went(env, owner, [entryTrialHead(job.name), \"\", body].join(\"\\n\"));"]], T],
  ["و", "the trials' purpose is refused for Baraa's number", [["src/wa-gateway.ts",
    "(OWNER_ALLOWED_PURPOSES as Set<string>).add(\"staffing_test\");", "void 0;"]], T],
  ["و", "the trials' hook opens without the token", [["src/index.ts",
    "url.pathname === \"/odoo/hook/s61-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (!hookTokenOk(env, providedToken)) {", "url.pathname === \"/odoo/hook/s61-trial\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      if (false) {"]], T],

  // ---------------------------------------------------------------- ج — the data of the Odoo script and the template
  ["ج", "the operating job does not carry «محصّل»", [[LIB,
    "roles: [\"driver\", \"warehouse\", \"collector\"], calendar: \"UTAK — أيام العمل\", attendance: true, holder: 6,", "roles: [\"driver\", \"warehouse\"], calendar: \"UTAK — أيام العمل\", attendance: true, holder: 6,"]], T],
  ["ج", "the coordinator's job carries no role (Othman off the team once his card is emptied)", [[LIB,
    "roles: [\"admin\"], calendar: \"UTAK — عثمان\", attendance: false, holder: 5,", "roles: [], calendar: \"UTAK — عثمان\", attendance: false, holder: 5,"]], T],
  ["ج", "the driver's job is assigned to somebody", [[LIB,
    "roles: [\"driver\"], calendar: \"UTAK — أيام العمل\", attendance: true, holder: null,", "roles: [\"driver\"], calendar: \"UTAK — أيام العمل\", attendance: true, holder: 6,"]], T],
  ["ج", "the operating job's KPIs lose «فرق العهدة»", [[LIB,
    "      \"فرق العهدة: الفرق بين الكاش المتوقع والمسلَّم. الهدف صفر كل يوم.\",\n", ""]], T],
  ["ج", "the operating job's handover loses the vehicle's keys and papers", [[LIB,
    "      \"العهدة والكاش: يسلّم كل ما معه، ويُطابَق بالمتوقع.\",\n      \"مفاتيح المركبة ووثائقها إن وُجدت.\",\n", "      \"العهدة والكاش: يسلّم كل ما معه، ويُطابَق بالمتوقع.\",\n"]], T],
  ["ج", "the card's field gets another title", [[LIB,
    "export const CARD_ROLES_LABEL = \"أدوار إضافية (خارج الوظيفة)\";", "export const CARD_ROLES_LABEL = \"أدوار UTAK\";"]], T],
  ["ج", "the handover list is a plain text field the worker cannot read as points", [[LIB,
    "{ name: \"x_handover_list\", ttype: \"html\",", "{ name: \"x_handover_list\", ttype: \"text\","]], T],
  ["ج", "the template's body is not the worker's welcome", [["scripts/lib/s61-templates.mjs",
    "أول مهمة تصلك {{3}}. مهامك وتحديثاتها تصلك في هذه المحادثة.\",", "أول مهمة تصلك {{3}}. مهامك تصلك هنا.\","]], T],

  // ---------------------------------------------------------------- دليل — the operating guide
  ["دليل", "the guide has no section of the jobs", [[GUIDE,
    "## الوظائف (§ 61)", "## الفريق (§ 61)"]], T],
  ["دليل", "the guide does not say «ثلاث خطوات»", [[GUIDE,
    "### كيف تضيف موظفاً (ثلاث خطوات)", "### كيف تضيف موظفاً"]], T],
  ["دليل", "the guide does not say Odoo's default schedule is not a choice", [[GUIDE,
    "الجدول الذي يضعه Odoo وحده على كل بطاقة جديدة («40 hours/week») لا يُعدّ اختياراً", "الجدول الذي على البطاقة هو الذي يسري دائماً"]], T],
  ["دليل", "the guide lets an employee be deleted", [[GUIDE,
    "(إجراء ← أرشفة). **لا حذف.**", "(إجراء ← أرشفة أو حذف)."]], T],
  ["دليل", "the guide does not say the handover list reaches Baraa", [[GUIDE,
    "ومعها **قائمة التسليم** بنقاطها، وتحتها «ما يقرؤه النظام الآن»", "وتحتها «ما يقرؤه النظام الآن»"]], T],
  ["دليل", "the guide says the system makes the cost line", [[GUIDE,
    "**النظام لا ينشئ بند تكلفة ولا يغيّره**", "**النظام يضيف بند التكلفة**"]], T],
  ["دليل", "the guide does not name the vacancy line", [[GUIDE,
    "سطر **«وظيفة شاغرة: سائق توصيل»** في ملخص 21:30", "سطر في ملخص 21:30"]], T],
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
writeFileSync(new URL("../artifacts/s61-20261006-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
