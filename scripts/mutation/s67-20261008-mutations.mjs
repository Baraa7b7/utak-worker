// Mutation check for § 67 (2026-10-08) — the freeze, the gateway's policy for Meta's refusals, Baraa's merged
// alerts, the cause of the dawn's storm, the 04:30 / 07:30 alerts, and the token's scrubbing:
//   أ  «🧊 وضع التجميد» (src/freeze.ts, the gateway's gate, the ticks, the publication)
//   ب  the cause: a status callback is quiet, Odoo's alert is buffered, the template sync writes what changed, spaced
//   د  the policy (src/meta-errors.ts, src/wa-retry.ts, handleRejection): the retry of 131056, the permanent block, the important alert
//   هـ the merge and the hourly cap (src/owner-alerts.ts)
//   و  04:30 «مصدر لم يرسل» with its button, 07:30 the reminder (src/sources-missing.ts)
//   ز  a token is never printed (scripts/lib/s67-token.mjs)
// Each mutation disables ONE guard, runs the test file named with it, and must make it fail. The source is restored
// in `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ and scripts/lib/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s67-20261008-mutations.mjs [أ ب د هـ و ز]     (no argument: every part)
//
// Out: scripts/artifacts/s67-20261008-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const TF = "tests/s67-freeze.test.mts", TG = "tests/s67-gateway.test.mts", TS = "tests/s67-sources.test.mts";
const FZ = "src/freeze.ts", GW = "src/wa-gateway.ts", IDX = "src/index.ts", PR = "src/prices.ts", ATT = "src/attendance.ts", PUR = "src/wa-purposes.ts";
const ME = "src/meta-errors.ts", RT = "src/wa-retry.ts", OA = "src/owner-alerts.ts", OD = "src/odoo.ts", MS = "src/wa-message-send.ts", SY = "src/wa-template-sync.ts";
const SM = "src/sources-missing.ts", OT = "src/owner-team.ts", TR = "src/s67-trial.ts", TL = "scripts/lib/s67-token.mjs";
const SEND_GUARD = "  if (req.manual || kind === \"manual\" || env.OWNER_ACT || req.purpose === FREEZE_REPLY_PURPOSE) return null;";
const TRANSIENT_BRANCH = "  } else if (m && (cls === \"transient\" || neverBlocked(m.p))) {";
const PERMANENT_BRANCH = "  } else if (m?.p && blocksOnRefusal(m.p) && cls === \"permanent\") {";
const OWNER_STEP = "    report.owner.action = fz.on || fz.missed(riyadhDayMinuteMs(day, plan.minutes)) ? FROZEN_MISSED_STEP : await ownerWindowStep(env, day, nowMs, plan.minutes);";
const MEMBER_STEP = "    if (fz.on || fz.missed(riyadhDayMinuteMs(day, dp.startMin as number))) { report.members.push({ ...base, action: FROZEN_MISSED_STEP }); continue; }";
const KIND_HEAD = "  const head = line.split(/[:—(«\"“]/)[0].replace(/[0-9٠-٩]+/g, \"#\").replace(/\\s+/g, \" \").trim();";
const CAP_GATE = "    if (!critical && !(await takeHourSlot(env, now))) {\n      await overflow(env, text, now);\n      return { outcome: \"capped\" };";

const M = [
  // ---------------------------------------------------------------- أ: the switch
  ["أ", "«حتى تاريخ» is ignored: frozen for ever", [[FZ, "  return s.switchOn && (!s.until || now < untilEndMs(s.until));", "  return s.switchOn;"]], TF],
  ["أ", "turned off: the freeze that ended is forgotten (what was due in it goes late)", [[FZ, "  let end = s.switchOn ? Number.POSITIVE_INFINITY : (s.endedAt ?? since);", "  let end = s.switchOn ? Number.POSITIVE_INFINITY : since;"]], TF],
  ["أ", "what was due before «بدأ» counts as frozen", [[FZ, "  return ms >= since && ms < end;", "  return ms < end;"]], TF],
  ["أ", "a send reads the settings from Odoo", [[FZ, "  if (!opts.fresh) return cached ?? { ...OFF, readAt: now };\n", ""]], TF],
  ["أ", "Odoo not answering thaws the system", [[FZ, "\n    return cached ?? { ...OFF, readAt: now };", "\n    return { ...OFF, readAt: now };"]], TF],
  ["أ", "the settings' reply is not read", [[FZ, "    reply: reply || DEFAULT_FREEZE_REPLY,", "    reply: DEFAULT_FREEZE_REPLY,"]], TF],
  // the gateway
  ["أ", "the gateway freezes nothing", [[FZ, "  if (!isFrozenNow(s, now)) return null;", "  return null;"]], TF],
  ["أ", "a send inside one of Baraa's acts is frozen", [[FZ, SEND_GUARD, "  if (req.manual || kind === \"manual\" || req.purpose === FREEZE_REPLY_PURPOSE) return null;"]], TF],
  ["أ", "a manual message is frozen", [[FZ, SEND_GUARD, "  if (env.OWNER_ACT || req.purpose === FREEZE_REPLY_PURPOSE) return null;"]], TF],
  ["أ", "the freeze's own reply is frozen", [[FZ, SEND_GUARD, "  if (req.manual || kind === \"manual\" || env.OWNER_ACT) return null;"]], TF],
  ["أ", "Baraa's own number is frozen by the gateway", [[GW, "  if (!isOwnerRecipient(env, to)) {\n    const { frozenSend, FROZEN_STATUS } = await import(\"./freeze\");", "  {\n    const { frozenSend, FROZEN_STATUS } = await import(\"./freeze\");"]], TF],
  ["أ", "what the freeze steps over is not recorded", [[GW, "      await logSkipped(env, req, to, frozen, FROZEN_STATUS);\n", ""]], TF],
  ["أ", "what the freeze steps over is recorded «skipped»", [[FZ, "export const FROZEN_STATUS = \"frozen\";", "export const FROZEN_STATUS = \"skipped\";"]], TF],
  ["أ", "a trial may go to another number", [[GW, "  if (isTrialPurpose(req.purpose) && !isOwnerRecipient(env, to)) {", "  if (false) {"]], TF],
  ["أ", "the sim worker's test send does not reach Baraa", [[GW, "(OWNER_ALLOWED_PURPOSES as Set<string>).add(\"sim_test\");", ""]], TF],
  ["أ", "a trial is any purpose", [[PUR, "  return /_test$/.test(purpose);", "  return false;"]], TF],
  // the scheduled jobs
  ["أ", "the 02:00 ask runs while frozen", [[FZ, "  \"0 23 * * *\",   // 02:00 the price ask\n", ""]], TF],
  ["أ", "the 06:00 cron runs while frozen", [[FZ, "  \"0 3 * * *\",    // 06:00 the publication, «صباح الخير», the purchase follow-up\n", ""]], TF],
  ["أ", "the 21:30 summary goes while frozen", [[FZ, "  \"30 18 * * *\",  // 21:30 Baraa's summary\n", ""]], TF],
  ["أ", "a frozen cron runs", [[IDX, "      if (frozen && fz.FROZEN_CRONS.has(cron)) {", "      if (false) {"]], TF],
  ["أ", "the 05:00 reminder goes while frozen", [[IDX, "          if (!frozen) {\n          await updateSupplierReliabilityScores(env);", "          {\n          await updateSupplierReliabilityScores(env);"]], TF],
  ["أ", "the prices tick runs while frozen", [[PR, "  if (fz.on) return out;\n", ""]], TF],
  ["أ", "a job is «مجمّد» at every tick", [[FZ, "      if (await env.MSG_DEDUP.get(jobKey(day, j.key))) continue;\n", ""]], TF],
  ["أ", "a job not due yet is «مجمّد»", [[FZ, "    if (j.minute > m || !frozenAt(s, riyadhDayMinuteMs(day, j.minute))) continue;", "    if (!frozenAt(s, riyadhDayMinuteMs(day, j.minute))) continue;"]], TF],
  ["أ", "a job that ran before the freeze is «مجمّد»", [[FZ, "    if (j.minute > m || !frozenAt(s, riyadhDayMinuteMs(day, j.minute))) continue;", "    if (j.minute > m) continue;"]], TF],
  ["أ", "a job started by hand is recorded at every start", [[FZ, "    if (await env.MSG_DEDUP.get(key)) return \"recorded before\";\n", ""]], TF],
  ["أ", "the tick does not read the switch fresh", [[FZ, "  const s = await readFreeze(env, now, { fresh: true });\n  if (!s.switchOn) return { on: false, action: \"off\" };", "  const s = await readFreeze(env, now);\n  if (!s.switchOn) return { on: false, action: \"off\" };"]], TF],
  // «حتى تاريخ»
  ["أ", "«حتى تاريخ» passed: the switch is not turned off", [[FZ, "      await call(env, CONFIG_MODEL, \"write\", { ids: [s.configId], vals: { x_freeze_on: false, x_freeze_until: false } });\n", ""]], TF],
  ["أ", "«حتى تاريخ» stays on the settings", [[FZ, "vals: { x_freeze_on: false, x_freeze_until: false } });", "vals: { x_freeze_on: false } });"]], TF],
  ["أ", "turned off by itself: Baraa is not told", [[FZ, "      await sendOwnerAlert(env, freezeEndedText(s.until), { kind: \"freeze_ended\", critical: true });\n", ""]], TF],
  // an incoming message
  ["أ", "an incoming message is never frozen", [[FZ, "  if (!isFrozenNow(s, now)) return false;", "  if (true) return false;"]], TF],
  ["أ", "the customer's reply at every message", [[FZ, "        if (!(last > 0 && Math.abs(now - last) < FREEZE_REPLY_EVERY_MS)) {", "        if (true) {"]], TF],
  ["أ", "the customer gets no reply", [[FZ, "          await sendText(env, m.from, s.reply, { ctx, purpose: FREEZE_REPLY_PURPOSE });\n", ""]], TF],
  ["أ", "a supplier and the team get the customer's reply", [[FZ, "    if (m.who === \"customer\") {\n      // § 66", "    if (true) {\n      // § 66"]], TF],
  ["أ", "Baraa is not told who wrote", [[FZ, "      await sendOwnerAlert(env, frozenInboundAlert(m.who, m.name, m.from, m.what.replace(/\\s+/g, \" \").slice(0, 200), replied), { kind: \"freeze_inbound\" });\n", ""]], TF],
  ["أ", "Baraa's own message is frozen", [[IDX, "    if (!isOwnerNumber(env, msg.from)) {\n      const { frozenInbound } = await import(\"./freeze\");", "    {\n      const { frozenInbound } = await import(\"./freeze\");"]], TF],
  ["أ", "the bot answers a frozen message all the same", [[IDX, "ingestPartnerName || msg.profileName || \"\", who, what, partnerId: ingestPartnerId }, ctx)) {\n        await markSeen(env, msg.messageId);\n        continue;", "ingestPartnerName || msg.profileName || \"\", who, what, partnerId: ingestPartnerId }, ctx)) {\n        await markSeen(env, msg.messageId);"]], TF],
  // Baraa's own acts
  ["أ", "Baraa's own tap is the system's", [[IDX, "    const actEnv = isOwnerNumber(env, msg.from) ? withOwnerAct(env, \"owner\") : env;", "    const actEnv = env;"]], TF],
  ["أ", "a request of Odoo's is the system's", [[IDX, "    const env = isOwnerActPath(url.pathname) ? withOwnerAct(baseEnv, \"odoo\") : baseEnv;", "    const env = baseEnv;"]], TF],
  ["أ", "the /internal routes are not Baraa's acts", [[FZ, "  return pathname.startsWith(\"/odoo/hook/\") || pathname.startsWith(\"/internal/\");", "  return pathname.startsWith(\"/odoo/hook/\");"]], TF],
  ["أ", "the trial's route is open without the token", [[IDX, "      if (!expected || !timingSafeEqual(providedToken, expected)) {\n        return json({ error: \"unauthorized\" }, 401);\n      }\n      try {\n        const { runS67Trial } = await import(\"./s67-trial\");", "      try {\n        const { runS67Trial } = await import(\"./s67-trial\");"]], TF],
  ["أ", "the trial's «state» does not read the switch fresh", [[TR, "  const v = await freezeView(env, now, { fresh: true });", "  const v = await freezeView(env, now);"]], TF],
  // nothing late
  ["أ", "the market ask goes late after the freeze", [[PR, "fz.missedToday(MARKET_ASK_MINUTE) ? FROZEN_MISSED : await runMarketAsk(env, now, dl);", "await runMarketAsk(env, now, dl);"]], TF],
  ["أ", "«مصدر لم يرسل» goes late after the freeze", [[PR, "fz.missedToday(SOURCES_MISSING_MINUTE) ? FROZEN_MISSED : await runSourcesMissing(env, now);", "await runSourcesMissing(env, now);"]], TF],
  ["أ", "the 05:00 reminder goes late after the freeze", [[PR, "fz.missedToday(MARKET_NUDGE_MINUTE) ? FROZEN_MISSED : await runMarketNudge(env, now, dl);", "await runMarketNudge(env, now, dl);"]], TF],
  ["أ", "the review goes late after the freeze", [[PR, "fz.missedToday(exceptionsFromMinutes(env)) ? FROZEN_MISSED : await notifyPriceReviewMessage(env, now);", "await notifyPriceReviewMessage(env, now);"]], TF],
  ["أ", "«لم تُنشر» goes late after the freeze", [[PR, "fz.missedToday(dl) ? { action: \"after_window\", day: riyadhDateKey(new Date(now)) } : await checkPricesDeadline(env, now);", "await checkPricesDeadline(env, now);"]], TF],
  ["أ", "a day approved while frozen is published by itself after it", [[PR, " && !fz.missed(approvedAt)) {", ") {"]], TF],
  ["أ", "Baraa's «بدء الدوام» goes late after the freeze", [[ATT, OWNER_STEP, "    report.owner.action = fz.on ? FROZEN_MISSED_STEP : await ownerWindowStep(env, day, nowMs, plan.minutes);"]], TF],
  ["أ", "a freeze that began after the shift does not stop Baraa's «بدء الدوام»", [[ATT, OWNER_STEP, "    report.owner.action = fz.missed(riyadhDayMinuteMs(day, plan.minutes)) ? FROZEN_MISSED_STEP : await ownerWindowStep(env, day, nowMs, plan.minutes);"]], TF],
  ["أ", "a member's «بدء الدوام» goes late after the freeze", [[ATT, MEMBER_STEP, "    if (fz.on) { report.members.push({ ...base, action: FROZEN_MISSED_STEP }); continue; }"]], TF],
  ["أ", "a freeze that began after the shift does not stop a member's «بدء الدوام»", [[ATT, MEMBER_STEP, "    if (fz.missed(riyadhDayMinuteMs(day, dp.startMin as number))) { report.members.push({ ...base, action: FROZEN_MISSED_STEP }); continue; }"]], TF],
  // the day's list
  ["أ", "the day's list is published while frozen", [[PR, "    if ((await freezeView(env, now)).on) {\n      const told", "    if (false) {\n      const told"]], TF],
  ["أ", "a frozen publication is said at every press", [[PR, "      if (told.claimed) {\n        await sendOwnerAlert({ ...env, AUTO_SEND_JOB: undefined } as Env, `🧊 أسعار", "      if (true) {\n        await sendOwnerAlert({ ...env, AUTO_SEND_JOB: undefined } as Env, `🧊 أسعار"]], TF],
  ["أ", "the upkeep (the retries, the merged alerts) does not run from the driver's tick", [[IDX, "      if (cron === TICK_CRON || cron === TICK2_CRON) {", "      if (cron === TICK_CRON) {"]], TF],

  // ---------------------------------------------------------------- ب: the cause
  ["ب", "a status callback's lookup alerts Baraa", [[MS, "      { quiet: true },\n    );\n    if (rows.length === 0) return null;", "      {},\n    );\n    if (rows.length === 0) return null;"]], TG],
  ["ب", "a quiet call alerts all the same", [[OD, "  if (quiet || alertDepth > 0) return;", "  if (alertDepth > 0) return;"]], TG],
  ["ب", "«Odoo لم يستجب» goes at once, one a call", [[OD, "{ kind: ODOO_DOWN_KIND, critical: true, buffer: { title: ODOO_DOWN_TITLE } });", "{ kind: ODOO_DOWN_KIND, critical: true });"]], TG],
  ["ب", "the limiter's page goes with its markup", [[OD, "  return String(message ?? \"\").replace(/<[^>]*>/g, \" \").replace(/\\s+/g, \" \").trim().slice(0, 160);", "  return String(message ?? \"\").replace(/\\s+/g, \" \").trim().slice(0, 160);"]], TG],
  ["ب", "the error's words are not cut", [[OD, ".replace(/\\s+/g, \" \").trim().slice(0, 160);\n}\n\nasync function alertExhausted", ".replace(/\\s+/g, \" \").trim();\n}\n\nasync function alertExhausted"]], TG],
  ["ب", "the sync writes every row", [[SY, "        if (rowInSync(existing, synced) && existing.x_missing_in_meta !== true && !(\"x_label_ar\" in vals) && !(\"x_name\" in vals)) {", "        if (false) {"]], TG],
  ["ب", "the sync's writes are not spaced", [[SY, "        if (wrote++ > 0) await syncSleep(SYNC_WRITE_SPACING_MS);\n        await write([existing.id], vals);", "        wrote++;\n        await write([existing.id], vals);"]], TG],
  ["ب", "the sync's creates are not spaced", [[SY, "        if (wrote++ > 0) await syncSleep(SYNC_WRITE_SPACING_MS);\n        await create({", "        wrote++;\n        await create({"]], TG],
  ["ب", "the spacing is nothing", [[SY, "export const SYNC_WRITE_SPACING_MS = 400;", "export const SYNC_WRITE_SPACING_MS = 0;"]], TG],
  ["ب", "the unchanged rows get no «آخر مزامنة»", [[SY, "      await call<boolean>(env, \"x_whatsapp_template\", \"write\", { ids: unchanged, vals: { x_last_synced: nowOdoo() } });\n", ""]], TG],
  ["ب", "a row Odoo was not read for counts as in sync", [[SY, "  return Object.entries(synced).every(([k, v]) => k in row && same(row[k], v));", "  return Object.entries(synced).every(([k, v]) => same(row[k], v));"]], TG],
  ["ب", "a row is in sync whatever it holds", [[SY, "  return Object.entries(synced).every(([k, v]) => k in row && same(row[k], v));", "  return true;"]], TG],

  // ---------------------------------------------------------------- د: the policy
  ["د", "131056 does not pass by itself", [[ME, "  131056, // (Business Account, Consumer Account) pair rate limit hit\n", ""]], TG],
  ["د", "an HTTP 5xx is not a passing fault", [[ME, "  if (META_TRANSIENT.has(c) || (c >= 500 && c <= 599)) return \"transient\";", "  if (META_TRANSIENT.has(c)) return \"transient\";"]], TG],
  ["د", "a refusal with no code is unknown", [[ME, "  if (code === null || code === undefined || code === \"\" || !Number.isFinite(c)) return \"transient\";", "  if (!Number.isFinite(c)) return \"transient\";"]], TG],
  ["د", "131026 is not permanent", [[ME, "  131026, // message undeliverable (the number is not on WhatsApp, or cannot receive it)\n", ""]], TG],
  ["د", "131000 is retried", [[ME, "  131057, // account in maintenance mode", "  131057, 131000,"]], TG],
  ["د", "the window's own code is a passing fault", [[ME, "  if (c === META_WINDOW_CLOSED) return \"window\";\n", ""]], TG],
  ["د", "every retry a minute apart", [[ME, "export const RETRY_DELAYS_MIN: readonly number[] = [1, 5, 15];", "export const RETRY_DELAYS_MIN: readonly number[] = [1, 1, 1];"]], TG],
  ["د", "two retries, not three", [[ME, "export const RETRY_DELAYS_MIN: readonly number[] = [1, 5, 15];", "export const RETRY_DELAYS_MIN: readonly number[] = [1, 5];"]], TG],
  ["د", "every message is retried for ever", [[ME, "  return forever ? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1] * 60_000 : null;", "  return RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1] * 60_000;"]], TG],
  ["د", "an important alert is dropped after the third retry", [[ME, "  return forever ? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1] * 60_000 : null;", "  return null;"]], TG],
  ["د", "Baraa's number is blocked a whole day", [[ME, "export const OWNER_BLOCK_MAX_SEC = 3600;", "export const OWNER_BLOCK_MAX_SEC = 24 * 3600;"]], TG],
  ["د", "a customer's number is blocked an hour", [[ME, "export const PURPOSE_BLOCK_SEC = 24 * 3600;", "export const PURPOSE_BLOCK_SEC = 3600;"]], TG],
  ["د", "a passing refusal is not retried", [[GW, TRANSIENT_BRANCH, "  } else if (m && neverBlocked(m.p)) {"]], TG],
  ["د", "an important alert refused for good is dropped", [[GW, TRANSIENT_BRANCH, "  } else if (m && cls === \"transient\") {"]], TG],
  ["د", "a permanent refusal blocks nothing", [[GW, PERMANENT_BRANCH, "  } else if (m?.p && blocksOnRefusal(m.p) && false) {"]], TG],
  ["د", "an unknown refusal blocks", [[GW, PERMANENT_BRANCH, "  } else if (m?.p && blocksOnRefusal(m.p)) {"]], TG],
  ["د", "Baraa's number gets the customers' block", [[GW, "    const ttl = isOwnerRecipient(env, to) ? OWNER_BLOCK_MAX_SEC : PURPOSE_BLOCK_SEC;", "    const ttl = PURPOSE_BLOCK_SEC;"]], TG],
  ["د", "the block of 2026-10-08 (131056) still counts", [[GW, "?.code) === \"permanent\";", "?.code) !== \"payment\";"]], TG],
  ["د", "an important alert is blocked as any purpose", [[GW, "  if (neverBlocked(purpose)) return false;\n", ""]], TG],
  ["د", "owner_critical is an ordinary purpose", [[PUR, "\"تنبيه مهم\"), neverBlock: true },", "\"تنبيه مهم\"), neverBlock: false },"]], TG],
  ["د", "a message is queued though it expires first", [[GW, "  if (delay === null || m.e <= now + delay) return null;", "  if (delay === null) return null;"]], TG],
  ["د", "a retry is not counted", [[GW, "manual: m.m, retries: made + 1, nextAt, code: f.code,", "manual: m.m, retries: made, nextAt, code: f.code,"]], TG],
  ["د", "a template's retry loses its body", [[GW, "body, template: m.s ? undefined : m.t,", "body, template: undefined,"]], TG],
  ["د", "a template's retry is built again", [[GW, "      if (opt.raw) return dispatchToMeta(env, req, to, opt.raw.body, opt.raw.name);\n", ""]], TG],
  ["د", "a queued retry is a failure all the same (the send)", [[GW, "  if (handled.retryAt) {\n    return decided(jsonResponse({ gateway: { decision: \"held\", retryAt: handled.retryAt, code } }, 202),", "  if (false) {\n    return decided(jsonResponse({ gateway: { decision: \"held\", retryAt: handled.retryAt, code } }, 202),"]], TG],
  ["د", "a queued retry is a failure all the same (the status)", [[GW, "  if (handled.retryAt) return { duplicate: false };\n", ""]], TG],
  ["د", "a retry's row is not marked", [[GW, "    x_status: \"held\",\n    x_meta_error: `Meta ${f.code ?? \"?\"}: ${f.message} — رفض مؤقت", "    x_status: \"failed\",\n    x_meta_error: `Meta ${f.code ?? \"?\"}: ${f.message} — رفض مؤقت"]], TG],
  ["د", "a retry goes before its time", [[RT, "  const due = cur.filter((i) => i.nextAt <= now);", "  const due = cur;"]], TG],
  ["د", "a retry that went stays in the queue", [[RT, "  if (due.length) await writeRetries(env, cur.filter((i) => i.nextAt > now));\n", ""]], TG],
  ["د", "the same message waits twice", [[RT, "  await writeRetries(env, [...cur.filter((i) => i.id !== item.id), item]);", "  await writeRetries(env, [...cur, item]);"]], TG],
  ["د", "a retry that expired is sent", [[GW, "    if (item.expiresAt <= now) {\n      await upsertRow(env, item.rowId, item.to, {\n        x_status: \"expired\",", "    if (false) {\n      await upsertRow(env, item.rowId, item.to, {\n        x_status: \"expired\","]], TG],
  ["د", "the ticks do not send the retries", [[IDX, "        await runRetryQueue(rawEnv, now, ctx);\n", ""]], TG],
  ["د", "an important alert goes under owner_alert", [[OA, "      purpose: critical ? OWNER_CRITICAL_PURPOSE : OWNER_ALERT_PURPOSE,", "      purpose: OWNER_ALERT_PURPOSE,"]], TG],
  ["د", "«لم تُنشر» is an ordinary alert", [[PR, "export const UNPUBLISHED_ALERT = { kind: \"prices_unpublished\", critical: true } as const;", "export const UNPUBLISHED_ALERT = { kind: \"prices_unpublished\", critical: false } as const;"]], TG],
  ["د", "the deadline's «لم تُنشر» does not carry it", [[PR, "  ].join(\"\\n\"), byOwner ? {} : UNPUBLISHED_ALERT);", "  ].join(\"\\n\"));"]], TG],

  // ---------------------------------------------------------------- هـ: the merge and the cap
  ["هـ", "no window: every alert goes", [[OA, "export const MERGE_WINDOW_MS = 10 * 60_000;", "export const MERGE_WINDOW_MS = 0;"]], TG],
  ["هـ", "the window is an hour", [[OA, "export const MERGE_WINDOW_MS = 10 * 60_000;", "export const MERGE_WINDOW_MS = 60 * 60_000;"]], TG],
  ["هـ", "seven an hour", [[OA, "export const HOURLY_CAP = 6;", "export const HOURLY_CAP = 7;"]], TG],
  ["هـ", "no cap", [[OA, "  if (n >= HOURLY_CAP) return false;\n", ""]], TG],
  ["هـ", "a kind keeps its digits", [[OA, KIND_HEAD, "  const head = line.split(/[:—(«\"“]/)[0].replace(/\\s+/g, \" \").trim();"]], TG],
  ["هـ", "a kind is the whole line", [[OA, KIND_HEAD, "  const head = line.replace(/[0-9٠-٩]+/g, \"#\").replace(/\\s+/g, \" \").trim();"]], TG],
  ["هـ", "what an alert said is lost in the merge", [[OA, "  if (r.texts.join(\"\\n\").length + String(text).length <= MERGED_TEXT_LIMIT) r.texts.push(String(text));", "  if (false) r.texts.push(String(text));"]], TG],
  ["هـ", "a merged message has no limit", [[OA, "<= MERGED_TEXT_LIMIT) r.texts.push(String(text));", ">= 0) r.texts.push(String(text));"]], TG],
  ["هـ", "what did not fit is not counted", [[OA, "  else r.dropped++;\n", ""]], TG],
  ["هـ", "a window's end sends nothing", [[OA, "  await deliver(env, text, r.critical);\n  return true;", "  return true;"]], TG],
  ["هـ", "a window nothing repeated in sends a message", [[OA, "  if (r.repeats <= 0) return false;\n", ""]], TG],
  ["هـ", "a buffered kind goes at once", [[OA, "    if (opts.buffer) {\n      fresh.repeats = 1;", "    if (false) {\n      fresh.repeats = 1;"]], TG],
  ["هـ", "a buffered kind's one message is not sent", [[OA, "      fresh.repeats = 1;\n", ""]], TG],
  ["هـ", "an important alert is counted by the cap", [[OA, CAP_GATE, "    if (!(await takeHourSlot(env, now))) {\n      await overflow(env, text, now);\n      return { outcome: \"capped\" };"]], TG],
  ["هـ", "what is over the cap is dropped", [[OA, CAP_GATE, "    if (!critical && !(await takeHourSlot(env, now))) {\n      return { outcome: \"capped\" };"]], TG],
  ["هـ", "the hour's summary goes before the hour ends", [[OA, "        if (now < hour + HOUR_MS) { keep[id] = at; continue; }", "        if (false) { keep[id] = at; continue; }"]], TG],
  ["هـ", "a window still open is closed by the tick", [[OA, "      if (Math.abs(now - rec.first) < MERGE_WINDOW_MS) { keep[id] = at; continue; }", "      if (false) { keep[id] = at; continue; }"]], TG],
  ["هـ", "an alert that did not leave keeps its kind's window", [[OA, "    try { await del(env, kindKey(fnv1a(opts.kind ?? alertKind(text)))); } catch { /* it ends in ten minutes */ }\n", ""]], TG],
  ["هـ", "the ticks do not close the windows", [[IDX, "        const fl = await flushOwnerAlerts(rawEnv, now);", "        const fl = { merged: 0, summaries: 0 }; void flushOwnerAlerts;"]], TG],
  ["هـ", "sendOwnerAlert goes straight to the gateway", [[ "src/templates.ts", "  await ownerAlert(env, text, opts);\n}", "  await sendOwnerMessage(env, text, T.OWNER_ALERT); void ownerAlert; void opts;\n}"]], TG],

  // ---------------------------------------------------------------- و: 04:30 and 07:30
  ["و", "the alert goes at 04:00", [[SM, "export const SOURCES_MISSING_MINUTE = 4 * 60 + 30;", "export const SOURCES_MISSING_MINUTE = 4 * 60;"]], TS],
  ["و", "the alert goes at every tick", [[SM, "  if (!claim.claimed) return { action: \"claimed_before\" };\n  try {\n    const silent = await silentSources(env, day);", "  try {\n    const silent = await silentSources(env, day);"]], TS],
  ["و", "the alert has no end of its hour", [[SM, "  if (m >= SOURCES_MISSING_MINUTE + SOURCES_WINDOW_MIN) return { action: \"after\" };\n", ""]], TS],
  ["و", "the alert is an ordinary one", [[SM, "      purpose: OWNER_CRITICAL_PURPOSE,", "      purpose: \"owner_alert\","]], TS],
  ["و", "the alert has no button", [[SM, "[{ id: reaskPayload(day), title: REASK_TITLE }]),", "[{ id: \"x\", title: REASK_TITLE }]),"]], TS],
  ["و", "a «خاص» answer is his last price", [[SM, "[SIM_FIELD, \"!=\", true], [SPECIAL_FIELD, \"!=\", true]], fields: [\"x_date\"]", "[SIM_FIELD, \"!=\", true]], fields: [\"x_date\"]"]], TS],
  ["و", "a source that sent today is named", [[SM, "    if (out.has(t.partnerId) || await hasOffersToday(env, t.partnerId, day)) continue;", "    if (out.has(t.partnerId)) continue;"]], TS],
  ["و", "the last send is not said", [[SM, "آخر إرسال: ${s.last ? arabicDate(s.last) : \"لم يرسل من قبل\"}`),", "آخر إرسال: —`),"]], TS],
  ["و", "an alert the gateway did not take is the day's one", [[SM, "    if (taken) await finishButton(env, claim, DAY_TTL); else await releaseButton(env, claim);\n    return { action: taken ? \"alerted\" : \"not_delivered\", silent:", "    await finishButton(env, claim, DAY_TTL);\n    return { action: taken ? \"alerted\" : \"not_delivered\", silent:"]], TS],
  ["و", "the button of another day asks again", [[SM, "  if (day !== today) return `هذا تنبيه يوم", "  if (false) return `هذا تنبيه يوم"]], TS],
  ["و", "the button asks at every tap", [[SM, "  if (!claim.claimed) return \"سبق إعادة طلب الأسعار اليوم من هذا الزر ✅\";\n", ""]], TS],
  ["و", "the button asks nobody", [[SM, "      const r = await sendFlowAsk(aenv, src, {", "      const r = await (async (..._a: unknown[]) => ({ via: null as \"session\" | \"template\" | null, duplicate: false }))(aenv, src, {"]], TS],
  ["و", "the reminder goes at 07:00", [[SM, "export const MISSED_REMIND_MINUTE = 7 * 60 + 30;", "export const MISSED_REMIND_MINUTE = 7 * 60;"]], TS],
  ["و", "the reminder goes whatever the day's state", [[SM, "    if (rec?.x_state !== \"missed\") {", "    if (!rec) {"]], TS],
  ["و", "a day Baraa closed himself is reminded", [[SM, "    if (inDay.length > 0 && inDay.every((l) => l.x_decision === \"skip\")) { await finishButton(env, claim, DAY_TTL); return { action: \"by_owner\" }; }\n", ""]], TS],
  ["و", "the reminder goes at every tick", [[SM, "  if (!claim.claimed) return { action: \"claimed_before\" };\n  try {\n    const { readDay, readLines, OUT_OF_CATALOG_REASON } = await import(\"./prices\");", "  try {\n    const { readDay, readLines, OUT_OF_CATALOG_REASON } = await import(\"./prices\");"]], TS],
  ["و", "the button is not one of Baraa's own", [[OT, "      || REASK_PAYLOAD.test(button)                         // § 67 و — «🔁 أعد طلب الأسعار» under the 04:30 alert\n", ""]], TS],
  ["و", "the webhook does not answer the button", [[IDX, "        if ((msg.type === \"interactive\" || msg.type === \"button\") && REASK_PAYLOAD.test(msg.buttonId ?? \"\")) {", "        if (false) {"]], TS],
  ["و", "the tick does not run the 04:30 alert", [[PR, "    out.sourcesMissing = fz.missedToday(SOURCES_MISSING_MINUTE) ? FROZEN_MISSED : await runSourcesMissing(env, now);", "    out.sourcesMissing = { action: \"before\" }; void runSourcesMissing;"]], TS],
  ["و", "the tick does not run the 07:30 reminder", [[PR, "    out.missedRemind = fz.missedToday(MISSED_REMIND_MINUTE) ? FROZEN_MISSED : await runMissedReminder(env, now);", "    out.missedRemind = { action: \"before\" }; void runMissedReminder;"]], TS],

  // ---------------------------------------------------------------- ز: a token is never printed
  ["ز", "a known token is printed as it is", [[TL, "  for (const x of secrets.filter((v) => v && String(v).length >= 8)) s = s.split(String(x)).join(`<tag:${tag(x)}>`);\n", ""]], TG],
  ["ز", "what follows «token=» is printed", [[TL, "    .replace(/((?:token|secret|key|sig)=)(?!<tag:)[^&\"'\\s<>)]+/gi, \"$1<masked>\")\n", ""]], TG],
  ["ز", "a bearer token is printed", [[TL, "    .replace(/Bearer\\s+[A-Za-z0-9._-]+/g, \"Bearer <masked>\");", "    ;"]], TG],
  ["ز", "a token an Odoo code action builds is not seen", [[TL, "    const rest = s.slice(m.index + m[0].length, eol < 0 ? s.length : eol);", "    const rest = s.slice(m.index + m[0].length, m.index + m[0].length + 1);"]], TG],
  ["ز", "a tag is the token's first characters", [[TL, "export const tag = (t) => createHash(\"sha256\").update(String(t)).digest(\"hex\").slice(0, 6);", "export const tag = (t) => String(t).slice(0, 6);"]], TG],
  ["ز", "a short string is replaced as a token", [[TL, "  if (!from || String(from).length < 8) throw new Error(", "  if (!from) throw new Error("]], TG],
  ["ز", "a new token is short", [[TL, "export const newToken = () => randomBytes(32).toString(\"hex\");", "export const newToken = () => randomBytes(8).toString(\"hex\");"]], TG],
  ["ز", "the PDF routes are the hook's secret", [[TL, "  pdf: { name: \"SALE_PDF_DOWNLOAD_TOKEN\", routes: [\"/internal/sale-quotation-pdf\", \"/internal/invoice-pdf\", \"/internal/purchase-order-pdf\"] },", "  pdf: { name: \"SALE_PDF_DOWNLOAD_TOKEN\", routes: [] },"]], TG],
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
writeFileSync(new URL("../artifacts/s67-20261008-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
