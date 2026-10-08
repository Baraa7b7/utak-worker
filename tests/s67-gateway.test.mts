// § 67 ب / د / هـ (2026-10-08) — the gateway's policy for Meta's refusals, Baraa's merged alerts, and the
// cause of the dawn's storm.
//
//   [د1] the classes of Meta's refusals, and the spacing of a retry
//   [د2] 131056: the SAME message again after 1 → 5 → 15 minutes, nothing blocked; then «failed»
//   [د3] a template refused for a passing reason goes again exactly as it was built
//   [د4] a permanent refusal blocks the purpose: 24 hours — ONE hour for Baraa's number; an old block of 131056 counts for nothing
//   [د5] an unknown refusal: failed, nothing blocked, nothing retried
//   [د6] an important alert is never blocked and never dropped
//   [هـ1] the same kind within ten minutes is one message — nothing an alert said is lost
//   [هـ2] «Odoo لم يستجب»: nothing at once, one message at the window's end
//   [هـ3] six alerts an hour that are not important, the rest in one summary
//   [ب1] the storm of 2026-10-08 cannot feed itself: a status callback Odoo refuses alerts nobody
//   [ب2] the template sync writes what changed, spaced, and one stamp for the rest
//   [ز]  a token is never printed: its tag alone
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s67-gateway.test.mts

import { readFileSync } from "node:fs";
import { CUST, CUST_PHONE, OWNER, closeOwnerWindow, ctx, failNext, graph, heldFor, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { DAY, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
// § 67 هـ — these tests are about the alerts as Baraa gets them: the merge and the cap are ON (the harness turns them off for the tests of before)
(await import("../src/owner-alerts.ts")).setOwnerAlertShapingForTests(true);
const GW = await import("../src/wa-gateway.ts");
const ME = await import("../src/meta-errors.ts");
const RT = await import("../src/wa-retry.ts");
const OA = await import("../src/owner-alerts.ts");
const ODOO = await import("../src/odoo.ts");
const SYNC = await import("../src/wa-template-sync.ts");
const PR = await import("../src/prices.ts");
const TOK = await import("../scripts/lib/s67-token.mjs");
const { sendOwnerAlert, sendOwnerCritical } = await import("../src/templates.ts");
const { neverBlocked, purposePolicy } = await import("../src/wa-purposes.ts");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const TICK = "*/5 * * * *", TICK2 = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const MIN = 60_000;
const at = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const text = (to: string, body: string, purpose: string, extra: Record<string, unknown> = {}) => ({ purpose, to: "+" + to, content: { kind: "session" as const, body: { type: "text", text: { body } } }, ...extra });
const gw = async (env: any, req: any) => GW.gatewayDecision(await quiet(() => GW.sendViaGateway(env, req)));
const cron = (env: any, c: string) => quiet(() => worker.scheduled({ cron: c } as any, env, ctx));
const retries = (env: any) => quiet(() => RT.readRetries(env));
const runRetries = (env: any) => quiet(() => GW.runRetryQueue(env, Date.now()));
const rowOf = (body: string) => rows("x_wa_message").filter((r: any) => r.x_body === body) as any[];
const block = (env: any, to: string, purpose: string) => { const raw = env.MSG_DEDUP.store.get(GW.purposeBlockKey(to, purpose)); return raw ? JSON.parse(raw) : null; };
const bodies = (to: string): string[] => sentTo(to).map((b: any) => String(b?.text?.body ?? b?.template?.name ?? `[${b?.type}]`));
const flush = (env: any, afterMin = 11) => quiet(() => OA.flushOwnerAlerts(env, Date.now() + afterMin * MIN));

// ================================================================ د1
console.log("\n[د1] the classes of Meta's refusals");
{
  const c = ME.metaErrorClass;
  assert("131056 (the pair's rate limit) passes by itself", c(131056) === "transient" && ME.META_PAIR_RATE_LIMIT === 131056);
  assert("so do the account's limits, Meta's outages, an HTTP 5xx and a refusal with no code", [130429, 131048, 80007, 4, 131016, 133004, 131057, 2, 1, 500, 503].every((x) => c(x) === "transient") && c(null) === "transient" && c(undefined) === "transient" && c("") === "transient");
  assert("the window, the dropped template and the payment keep their own handling", c(131047) === "window" && c(131049) === "template_day" && c(131042) === "payment");
  assert("what fails again whenever it is sent again is permanent", [131026, 131021, 131051, 131008, 131009, 100, 132000, 132001, 132012, 132015, 132016, 132018, 131050, 131031, 133010, 190, 368].every((x) => c(x) === "permanent") && c("131026") === "permanent");
  assert("anything else is unknown — 131000 among them", c(131000) === "unknown" && c(999999) === "unknown" && c(404) === "unknown");
  assert("no code is in two classes", [...ME.META_TRANSIENT].every((x) => !ME.META_PERMANENT.has(x)) && ![131047, 131049, 131042].some((x) => ME.META_TRANSIENT.has(x) || ME.META_PERMANENT.has(x)));
  assert("a retry's spacing: 1 → 5 → 15 minutes, then none", ME.retryDelayMs(0, false) === 1 * MIN && ME.retryDelayMs(1, false) === 5 * MIN && ME.retryDelayMs(2, false) === 15 * MIN && ME.retryDelayMs(3, false) === null && JSON.stringify(ME.RETRY_DELAYS_MIN) === "[1,5,15]");
  assert("…and an important alert keeps the last spacing", ME.retryDelayMs(3, true) === 15 * MIN && ME.retryDelayMs(40, true) === 15 * MIN && ME.retryDelayMs(0, true) === 1 * MIN);
  assert("a block is 24 hours — an hour for Baraa's number", ME.PURPOSE_BLOCK_SEC === 86400 && ME.OWNER_BLOCK_MAX_SEC === 3600);
}

// ================================================================ د2
console.log("\n[د2] 131056: the same message again, 1 → 5 → 15 minutes, nothing blocked");
{
  const env = fresh(`${DAY} 10:00`);
  openWindow(env, CUST_PHONE, 5);
  failNext.push(131056);
  const d = await gw(env, text(CUST_PHONE, "طلبك في الطريق 🚚", "customer_delivery_incoming"));
  assert("refused with 131056: taken for its retry (held), not a failure", d?.action === "held" && String((d as any).reason).includes("131056"), JSON.stringify(d));
  assert("NOTHING is blocked: the purpose has no block for the number", block(env, CUST_PHONE, "customer_delivery_incoming") === null);
  assert("nobody is alerted, and the failure counter does not move", ownerTexts().length === 0 && !env.MSG_DEDUP.store.has(`wa_send_fail:${DAY}`));
  let q = await retries(env);
  assert("the message waits for its first retry, a minute later", q.length === 1 && q[0].retries === 1 && q[0].nextAt === at(`${DAY} 10:01`) && q[0].code === 131056 && q[0].to === CUST_PHONE);
  assert("its row says so («held», the code, the time of the retry)", rowOf("طلبك في الطريق 🚚").length === 1 && rowOf("طلبك في الطريق 🚚")[0].x_status === "held" && /131056.*رفض مؤقت.*10:01/.test(String(rowOf("طلبك في الطريق 🚚")[0].x_meta_error)), JSON.stringify(rowOf("طلبك في الطريق 🚚")));
  assert("it is not in the number's held queue (that one waits for his message)", heldFor(env, CUST_PHONE).length === 0);
  // before its time: nothing
  setRiyadh(`${DAY} 10:00`);
  assert("a tick before the minute is up: nothing goes", (await runRetries(env)).due === 0 && sentTo(CUST_PHONE).length === 1);
  // the first retry, refused again → five minutes
  setRiyadh(`${DAY} 10:02`);
  failNext.push(131056);
  await cron(env, TICK2);
  q = await retries(env);
  assert("the tick after a minute sends THE SAME message; refused again, it waits five minutes", sentTo(CUST_PHONE).length === 2 && JSON.stringify(sentTo(CUST_PHONE)[1]) === JSON.stringify(sentTo(CUST_PHONE)[0]) && q.length === 1 && q[0].retries === 2 && q[0].nextAt === at(`${DAY} 10:07`), JSON.stringify(q));
  setRiyadh(`${DAY} 10:05`);
  await cron(env, TICK);
  assert("three minutes later: not due yet", sentTo(CUST_PHONE).length === 2);
  // the second retry, refused again → fifteen minutes
  setRiyadh(`${DAY} 10:07`);
  failNext.push(131056);
  await cron(env, TICK2);
  q = await retries(env);
  assert("after five minutes: again; refused, it waits fifteen", sentTo(CUST_PHONE).length === 3 && q[0]?.retries === 3 && q[0].nextAt === at(`${DAY} 10:22`), JSON.stringify(q));
  // the third retry: accepted
  setRiyadh(`${DAY} 10:22`);
  await cron(env, TICK2);
  const row = rowOf("طلبك في الطريق 🚚");
  assert("after fifteen: Meta takes it — ONE row, «sent», the queue empty", sentTo(CUST_PHONE).length === 4 && (await retries(env)).length === 0 && row.length === 1 && row[0].x_status === "sent", JSON.stringify(row.map((r) => r.x_status)));
  assert("…and still nothing was ever blocked or alerted", block(env, CUST_PHONE, "customer_delivery_incoming") === null && ownerTexts().length === 0);

  // refused at every try: three retries, then «failed» — and still no block
  const env2 = fresh(`${DAY} 10:00`);
  openWindow(env2, CUST_PHONE, 5);
  failNext.push(131056, 131056, 131056, 131056);
  await gw(env2, text(CUST_PHONE, "طلبك وصل", "customer_delivery_done"));
  for (const hm of ["10:01", "10:06", "10:21"]) { setRiyadh(`${DAY} ${hm}`); await runRetries(env2); }
  const dead = rowOf("طلبك وصل");
  assert("refused at the send and at its three retries: four tries in all, then «failed»", sentTo(CUST_PHONE).length === 4 && (await retries(env2)).length === 0 && dead.length === 1 && dead[0].x_status === "failed" && String(dead[0].x_meta_error).includes("131056"), JSON.stringify(dead));
  assert("…a failure now: counted once, and Baraa told once", env2.MSG_DEDUP.store.get(`wa_send_fail:${DAY}`) === "1" && ownerTexts().filter((t) => t.includes("فشل إرسال واتساب") && t.includes("131056")).length === 1, ownerTexts().join(" | "));
  assert("…and the purpose is STILL not blocked: the next message of it goes", block(env2, CUST_PHONE, "customer_delivery_done") === null && (await gw(env2, text(CUST_PHONE, "طلب آخر وصل", "customer_delivery_done")))?.action === "session");
  // the very same message refused twice waits once
  const envS = fresh(`${DAY} 10:00`);
  openWindow(envS, CUST_PHONE, 5);
  failNext.push(131056, 131056);
  await gw(envS, text(CUST_PHONE, "الرسالة نفسها", "customer_delivery_incoming"));
  await gw(envS, text(CUST_PHONE, "الرسالة نفسها", "customer_delivery_incoming"));
  assert("the very same message refused twice waits ONCE", (await retries(envS)).length === 1);
  // a message that would expire before its retry is not queued
  const env3 = fresh(`${DAY} 10:00`);
  openWindow(env3, CUST_PHONE, 5);
  failNext.push(131056);
  const soon = await gw(env3, text(CUST_PHONE, "ينتهي قريباً", "customer_delivery_incoming", { expiresAt: at(`${DAY} 10:00`) + 30_000 }));
  assert("a message that expires before its retry is not queued: failed, as it is", soon?.action === "rejected" && (await retries(env3)).length === 0);
  // the async way: Meta accepts, then a «failed» status with 131056
  const env4 = fresh(`${DAY} 10:00`);
  openWindow(env4, CUST_PHONE, 5);
  await gw(env4, text(CUST_PHONE, "تحديث طلبك", "customer_order_update"));
  const wamid = String((rowOf("تحديث طلبك")[0] ?? {}).x_meta_message_id ?? "");
  await quiet(() => worker.fetch(signed({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: "failed", recipient_id: CUST_PHONE, errors: [{ code: 131056, message: "pair rate limit hit" }] }] } }] }] }), env4, ctx));
  q = await retries(env4);
  assert("a «failed» status with 131056 after Meta took it: queued for its retry the same way, nothing blocked, nobody alerted", !!wamid && q.length === 1 && q[0].retries === 1 && block(env4, CUST_PHONE, "customer_order_update") === null && ownerTexts().length === 0, JSON.stringify([wamid, q]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د3
console.log("\n[د3] a template refused for a passing reason goes again as it was built");
{
  const env = fresh(`${DAY} 10:00`);
  const { sendTemplateByPurpose } = await import("../src/templates.ts");
  failNext.push(131056);
  const d = GW.gatewayDecision(await quiet(() => sendTemplateByPurpose(env, "+" + CUST_PHONE, "customer_delivery_done", ["مطعم الوادي"])));
  const first = sentTo(CUST_PHONE)[0];
  assert("the template was refused with 131056 and waits for its retry", d?.action === "held" && first?.type === "template" && first.template?.name === "utak_delivered" && (await retries(env))[0]?.template === "utak_delivered");
  setRiyadh(`${DAY} 10:01`);
  await runRetries(env);
  assert("a minute later: the same template, the same variables, exactly", sentTo(CUST_PHONE).length === 2 && JSON.stringify(sentTo(CUST_PHONE)[1]) === JSON.stringify(first) && (await retries(env)).length === 0);
}

// ================================================================ د4
console.log("\n[د4] a permanent refusal blocks — 24 hours, an hour for Baraa's number");
{
  const env = fresh(`${DAY} 10:00`);
  openWindow(env, CUST_PHONE, 5);
  failNext.push(131026);
  const d = await gw(env, text(CUST_PHONE, "طلبك في الطريق", "customer_delivery_incoming"));
  const b = block(env, CUST_PHONE, "customer_delivery_incoming");
  assert("131026 (undeliverable): a failure, not retried", d?.action === "rejected" && (await retries(env)).length === 0);
  assert("…and the purpose is blocked for the number for 24 hours", b?.code === 131026 && Date.parse(b.until) - Date.parse(b.at) === 24 * 3600_000, JSON.stringify(b));
  const again = await gw(env, text(CUST_PHONE, "طلبك في الطريق (2)", "customer_delivery_incoming"));
  assert("the next automatic send of the purpose never reaches Meta", again?.action === "skipped" && sentTo(CUST_PHONE).length === 1 && String((again as any).reason).includes("رفضاً دائماً"));
  assert("a manual message to the same number still goes", (await gw(env, text(CUST_PHONE, "معك براء", "wa_message_manual")))?.action === "session");
  // Baraa's number: an hour at most
  const env2 = fresh(`${DAY} 10:00`);
  failNext.push(131026);
  await gw(env2, text(OWNER, "تنبيه", "owner_alert"));
  const ob = block(env2, OWNER, "owner_alert");
  assert("owner_alert, a permanent refusal: blocked ONE hour, not a day", ob?.code === 131026 && Date.parse(ob.until) - Date.parse(ob.at) === 3600_000, JSON.stringify(ob));
  // the block of 2026-10-08, as it was written: it counts for nothing now
  assert("a block written for 131056 (the dawn of 2026-10-08) does not count", GW.isPurposeBlock(JSON.stringify({ code: 131056, at: "2026-10-08T02:02:29.719Z" })) === false);
  assert("…nor one for the payment issue; a permanent one counts; an unreadable one counts", GW.isPurposeBlock(JSON.stringify({ code: 131042 })) === false && GW.isPurposeBlock(JSON.stringify({ code: 131026 })) === true && GW.isPurposeBlock("garbage") === true && GW.isPurposeBlock(null) === false);
  const env3 = fresh(`${DAY} 10:00`);
  env3.MSG_DEDUP.store.set(GW.purposeBlockKey(OWNER, "owner_alert"), JSON.stringify({ code: 131056, at: "2026-10-08T02:02:29.719Z" }));
  assert("with that very key in KV, an alert to Baraa goes", (await gw(env3, text(OWNER, "تنبيه بعد الحجب القديم", "owner_alert")))?.action === "session");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د5
console.log("\n[د5] an unknown refusal: failed, nothing blocked, nothing retried");
{
  const env = fresh(`${DAY} 10:00`);
  openWindow(env, CUST_PHONE, 5);
  failNext.push(131000);
  const d = await gw(env, text(CUST_PHONE, "رسالة", "customer_delivery_incoming"));
  assert("131000: a failure", d?.action === "rejected" && rowOf("رسالة")[0]?.x_status === "failed");
  assert("…nothing blocked, nothing queued: the next send is a new attempt", block(env, CUST_PHONE, "customer_delivery_incoming") === null && (await retries(env)).length === 0 && (await gw(env, text(CUST_PHONE, "رسالة ثانية", "customer_delivery_incoming")))?.action === "session");
}

// ================================================================ د6
console.log("\n[د6] an important alert is never blocked and never dropped");
{
  assert("owner_critical: held with the opener as an alert is, and a refusal never blocks it", neverBlocked("owner_critical") && purposePolicy("owner_critical")?.critical === true && GW.blocksOnRefusal("owner_critical") === false && GW.blocksOnRefusal("owner_alert") === true && !neverBlocked("owner_alert"));
  const env = fresh(`${DAY} 10:00`);
  // a permanent block on both purposes in KV: the important one goes all the same
  for (const p of ["owner_alert", "owner_critical"]) env.MSG_DEDUP.store.set(GW.purposeBlockKey(OWNER, p), JSON.stringify({ code: 131026, at: new Date().toISOString() }));
  await quiet(() => sendOwnerAlert(env, "تنبيه عادي"));
  const went = await quiet(() => sendOwnerCritical(env, "🚚 طلب كبير 60 كرتون", { kind: "big" }));
  assert("an ordinary alert is stopped by its purpose's block; the important one is not", !ownerTexts().includes("تنبيه عادي") && ownerTexts().includes("🚚 طلب كبير 60 كرتون") && went.taken === true);
  // Meta refuses it, permanently or not: queued, tried again, never dropped
  const env2 = fresh(`${DAY} 10:00`);
  failNext.push(131026);
  const r = await quiet(() => sendOwnerCritical(env2, "✅ العميل يبدو موافقاً على العرض", { kind: "ok" }));
  let q = await quiet(() => RT.readRetries(env2));
  assert("refused with a PERMANENT code: taken all the same — queued for a minute later, nothing blocked", r.taken === true && q.length === 1 && q[0].purpose === "owner_critical" && q[0].nextAt === at(`${DAY} 10:01`) && block(env2, OWNER, "owner_critical") === null);
  failNext.push(131056, 131026, 131056, 131056);
  for (const hm of ["10:01", "10:06", "10:21", "10:36"]) { setRiyadh(`${DAY} ${hm}`); await quiet(() => GW.runRetryQueue(env2, Date.now())); }
  q = await quiet(() => RT.readRetries(env2));
  assert("refused at every retry: past the third it keeps trying every fifteen minutes — never dropped", q.length === 1 && q[0].retries === 5 && q[0].nextAt === at(`${DAY} 10:51`), JSON.stringify(q));
  setRiyadh(`${DAY} 10:51`);
  await cron(env2, TICK2);
  assert("…and when Meta takes it, it reaches him: six tries in all — the send, four refused retries, and the one Meta took", sentTo(OWNER).filter((b: any) => b?.text?.body === "✅ العميل يبدو موافقاً على العرض").length === 6, String(sentTo(OWNER).length));
  assert("…the queue is empty and its ONE row is «sent»", (await quiet(() => RT.readRetries(env2))).length === 0 && rowOf("✅ العميل يبدو موافقاً على العرض").length === 1 && rowOf("✅ العميل يبدو موافقاً على العرض")[0].x_status === "sent");
  // one that expires while it waits is marked so, and not sent
  const env5 = fresh(`${DAY} 10:00`);
  failNext.push(131056);
  await quiet(() => sendOwnerCritical(env5, "تنبيه ينتهي", { kind: "exp" }));
  const before = sentTo(OWNER).length;
  setRiyadh("2026-10-05 10:00"); // past the 36 hours of an alert
  const ran = await quiet(() => GW.runRetryQueue(env5, Date.now()));
  assert("a retry whose message expired while it waited: marked «expired», never sent, the queue empty", ran.expired === 1 && ran.sent === 0 && sentTo(OWNER).length === before && rowOf("تنبيه ينتهي")[0]?.x_status === "expired" && (await quiet(() => RT.readRetries(env5))).length === 0, JSON.stringify(ran));
  setRiyadh(`${DAY} 10:00`);
  // outside his window: held for it, with the opener — the queue of his important alerts
  const env3 = fresh(`${DAY} 10:00`);
  closeOwnerWindow(env3);
  const heldR = await quiet(() => sendOwnerCritical(env3, "⏰ مصدر لم يرسل", { kind: "src" }));
  assert("outside Baraa's window: held for his next message (not skipped, not dropped)", heldR.taken === true && heldFor(env3, OWNER).length === 1 && heldFor(env3, OWNER)[0].purpose === "owner_critical" && heldFor(env3, OWNER)[0].expiresAt - Date.now() === 36 * 3600_000);
  // the named ones go under it
  const env4 = fresh(`${DAY} 06:05`);
  env4.MSG_DEDUP.store.set(GW.purposeBlockKey(OWNER, "owner_alert"), JSON.stringify({ code: 131026, at: new Date().toISOString() }));
  await quiet(() => PR.checkPricesDeadline(env4, Date.now()));
  assert("«أسعار اليوم لم تُنشر» is one of them: it arrives with owner_alert blocked", ownerTexts().some((t) => t.includes("لم تُنشر حتى 06:00")) && PR.UNPUBLISHED_ALERT.critical === true);
  assert("«🚚 طلب كبير» and «✅ يبدو موافقاً» (src/special-accept.ts), «مصدر لم يرسل» and the 07:30 reminder (src/sources-missing.ts), Odoo not answering (src/odoo.ts): each is sent as an important alert",
    /sendOwnerCritical\(/.test(srcOf("special-accept.ts")) && !/sendOwnerMessage\(\{ \.\.\.env/.test(srcOf("special-accept.ts")) && /purpose: OWNER_CRITICAL_PURPOSE/.test(srcOf("sources-missing.ts")) && /sendOwnerCritical\(/.test(srcOf("sources-missing.ts")) && /kind: ODOO_DOWN_KIND, critical: true/.test(srcOf("odoo.ts")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ1
console.log("\n[هـ1] the same kind within ten minutes is one message");
{
  // the merge is ON on the worker: only a test can turn it off, and no file of src/ does
  const { readdirSync } = await import("node:fs");
  const srcFiles = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"));
  assert("the merge and the cap are on by default, and nothing in src/ turns them off (the switch is the tests' alone)", /^let shaping = true;$/m.test(srcOf("owner-alerts.ts")) && srcFiles.filter((f) => /setOwnerAlertShapingForTests\(/.test(srcOf(f))).join() === "owner-alerts.ts" && !/OWNER_ALERT[A-Z_]*\b.*env\./.test(srcOf("owner-alerts.ts")));
  assert("a kind is the alert's first words: digits out, and what follows «:» «—» a bracket or a quote", OA.alertKind("⚠️ المورد \"أحمد\" لم يرسل أسعار اليوم") === OA.alertKind("⚠️ المورد \"رائد\" لم يرسل أسعار اليوم") && OA.alertKind("📥 رسالة «الفاتورة» إلى …501 محفوظة") === "📥 رسالة" && OA.alertKind("رقم جديد راسل: أحمد (9665…)") === "رقم جديد راسل" && OA.alertKind("تنبيه 1") === OA.alertKind("تنبيه 2") && OA.alertKind("☀️ صباح الخير براء\nسطر") === "☀️ صباح الخير براء");
  assert("two different alerts are two kinds", OA.alertKind("⚠️ فشل إرسال واتساب — القالب x") !== OA.alertKind("⚠️ المورد \"أحمد\" لم يرسل") && OA.alertKind("") === "تنبيه");
  const env = fresh(`${DAY} 10:00`);
  await quiet(() => sendOwnerAlert(env, "⚠️ المورد \"أحمد حسان\" لم يرسل أسعار اليوم"));
  setRiyadh(`${DAY} 10:03`);
  await quiet(() => sendOwnerAlert(env, "⚠️ المورد \"مزرعة حمد\" لم يرسل أسعار اليوم"));
  setRiyadh(`${DAY} 10:05`);
  await cron(env, TICK);
  assert("a tick inside the window does not close it: the folded alert still waits", ownerTexts().length === 1);
  setRiyadh(`${DAY} 10:09`);
  await quiet(() => sendOwnerAlert(env, "⚠️ المورد \"سوق الجملة\" لم يرسل أسعار اليوم"));
  await quiet(() => sendOwnerAlert(env, "📥 رسالة «الفاتورة» إلى …501 محفوظة"));
  assert("three alerts of one kind in nine minutes: the FIRST goes at once, the two others do not; another kind goes", JSON.stringify(ownerTexts()) === JSON.stringify(["⚠️ المورد \"أحمد حسان\" لم يرسل أسعار اليوم", "📥 رسالة «الفاتورة» إلى …501 محفوظة"]), ownerTexts().join(" | "));
  setRiyadh(`${DAY} 10:10`);
  await cron(env, TICK);
  const merged = ownerTexts()[2] ?? "";
  assert("the tick at the window's end sends ONE message with every alert it folded, as each was written", ownerTexts().length === 3 && merged === "🔁 2 تنبيهات أخرى من النوع نفسه بين 10:00 و10:09:\n• ⚠️ المورد \"مزرعة حمد\" لم يرسل أسعار اليوم\n• ⚠️ المورد \"سوق الجملة\" لم يرسل أسعار اليوم", merged);
  await cron(env, TICK2);
  assert("the next tick: nothing more", ownerTexts().length === 3);
  await quiet(() => sendOwnerAlert(env, "⚠️ المورد \"أحمد حسان\" لم يرسل أسعار اليوم"));
  assert("after the window: an alert of the kind is a first one again", ownerTexts().length === 4);
  // one repeat: its own wording; and a window nothing repeated in sends nothing
  const env2 = fresh(`${DAY} 11:00`);
  await quiet(() => sendOwnerAlert(env2, "تنبيه 1"));
  await quiet(() => sendOwnerAlert(env2, "تنبيه 2"));
  await quiet(() => sendOwnerAlert(env2, "ملاحظة وحيدة"));
  await flush(env2);
  assert("one repeat: «🔁 1 تنبيه آخر …»; a kind that did not repeat sends nothing at its window's end", JSON.stringify(ownerTexts()) === JSON.stringify(["تنبيه 1", "ملاحظة وحيدة", "🔁 1 تنبيه آخر من النوع نفسه بين 11:00 و11:00:\n• تنبيه 2"]), ownerTexts().join(" | "));
  // a merged message never grows past its limit
  const env3 = fresh(`${DAY} 12:00`);
  for (let i = 0; i < 40; i++) await quiet(() => sendOwnerAlert(env3, `تنبيه ${i} ${"س".repeat(180)}`, { kind: "long" }));
  await flush(env3);
  const big = ownerTexts()[1] ?? "";
  assert("forty long alerts of a kind: one at once, then ONE message that keeps what fits and counts the rest", ownerTexts().length === 2 && big.length <= OA.MERGED_TEXT_LIMIT + 200 && /… و\d+ غيرها$/.test(big) && big.startsWith("🔁 39 تنبيهات أخرى"), `${ownerTexts().length} ${big.length}`);
  // an alert that did not leave does not open a window
  const env4 = fresh(`${DAY} 13:00`);
  failNext.push(131026);
  await quiet(() => sendOwnerAlert(env4, "تنبيه لم يخرج", { kind: "k" }));
  env4.MSG_DEDUP.store.delete(GW.purposeBlockKey(OWNER, "owner_alert"));
  await quiet(() => sendOwnerAlert(env4, "تنبيه بعده", { kind: "k" }));
  assert("an alert Meta refused does not open its kind's window: the next one goes at once (it is not folded behind a message that never left)", sentTo(OWNER).length === 2 && sentTo(OWNER)[1]?.text?.body === "تنبيه بعده");
}

// ================================================================ هـ2
console.log("\n[هـ2] «Odoo لم يستجب»: one message at the window's end");
{
  const env = fresh(`${DAY} 03:00`);
  const down = (detail: string) => quiet(() => sendOwnerAlert(env, detail, { kind: ODOO.ODOO_DOWN_KIND, critical: true, buffer: { title: ODOO.ODOO_DOWN_TITLE } }));
  for (let i = 0; i < 11; i++) { setRiyadh(`${DAY} 03:0${Math.min(i, 9)}`); await down(`بعد 4 محاولات — العملية x_wa_message.search_read، السجل ${i} — odoo HTTP_429`); }
  assert("eleven exhausted calls in ten minutes: NOT ONE message while they come", sentTo(OWNER).length === 0);
  setRiyadh(`${DAY} 03:10`);
  await cron(env, TICK);
  assert("the window's end: ONE message, the count, the span and the last error", JSON.stringify(ownerTexts()) === JSON.stringify(["⚠️ Odoo لم يستجب 11 مرة بين 03:00 و03:09 — آخر خطأ: بعد 4 محاولات — العملية x_wa_message.search_read، السجل 10 — odoo HTTP_429"]), ownerTexts().join(" | "));
  // one alone
  const env2 = fresh(`${DAY} 04:00`);
  await quiet(() => sendOwnerAlert(env2, "بعد 4 محاولات — العملية x_daily_order.write، السجل ids=7 — odoo HTTP_503", { kind: ODOO.ODOO_DOWN_KIND, critical: true, buffer: { title: ODOO.ODOO_DOWN_TITLE } }));
  await flush(env2);
  assert("one alone: one message, with its hour", JSON.stringify(ownerTexts()) === JSON.stringify(["⚠️ Odoo لم يستجب (04:00) — بعد 4 محاولات — العملية x_daily_order.write، السجل ids=7 — odoo HTTP_503"]));
  // the real path: a call that exhausts its retries
  const env3 = fresh(`${DAY} 05:00`);
  ODOO.setOdooRetryHooksForTests({ sleep: async () => {} });
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/x_wa_control/")) return new Response("<html><body><h1>429 Too Many Requests</h1> You have sent too many requests in a given amount of time. </body></html>", { status: 429 });
    return real(input as any, init);
  }) as typeof fetch;
  try {
    await quiet(() => ODOO.call(env3, "x_wa_control", "write", { ids: [1], vals: { x_sync_requested: false } }).catch(() => null));
    await quiet(() => ODOO.call(env3, "x_wa_control", "write", { ids: [1], vals: { x_sync_requested: false } }, { quiet: true }).catch(() => null));
  } finally { globalThis.fetch = real; }
  assert("a call Odoo refuses four times: nothing to Baraa at once", sentTo(OWNER).length === 0);
  await flush(env3);
  ODOO.setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
  assert("…then one message — the limiter's page as its words, not its markup — and the quiet call is not in it", ownerTexts().length === 1 && ownerTexts()[0] === "⚠️ Odoo لم يستجب (05:00) — بعد 4 محاولات — العملية x_wa_control.write، السجل ids=1 — odoo HTTP_429: 429 Too Many Requests You have sent too many requests in a given amount of time.", ownerTexts().join(" | "));
  assert("an error's words: its markup out, 160 characters at most", ODOO.briefError("<html><body><h1>429 Too Many Requests</h1> x </body></html>") === "429 Too Many Requests x" && ODOO.briefError("ب".repeat(400)).length === 160);
}

// ================================================================ هـ3
console.log("\n[هـ3] six an hour that are not important, the rest in one summary");
{
  const env = fresh(`${DAY} 14:00`);
  for (let i = 1; i <= 9; i++) { setRiyadh(`${DAY} 14:${String(i * 5).padStart(2, "0")}`); await quiet(() => sendOwnerAlert(env, `تنبيه من نوع ${i}`, { kind: `kind${i}` })); }
  assert("nine alerts of nine kinds in one hour: six go", ownerTexts().length === OA.HOURLY_CAP && OA.HOURLY_CAP === 6 && ownerTexts()[5] === "تنبيه من نوع 6", ownerTexts().join(" | "));
  await quiet(() => sendOwnerAlert(env, "🚚 طلب كبير", { kind: "crit", critical: true }));
  assert("an important one is not counted by the cap: it goes", ownerTexts().length === 7 && ownerTexts()[6] === "🚚 طلب كبير");
  setRiyadh(`${DAY} 14:55`);
  await cron(env, TICK);
  assert("before the hour ends: the rest still waits", ownerTexts().length === 7);
  setRiyadh(`${DAY} 15:00`);
  await cron(env, TICK);
  const sum = ownerTexts()[7] ?? "";
  assert("the hour's end: ONE summary with the three that were over the cap", ownerTexts().length === 8 && sum === "📋 3 تنبيهات أخرى بين 14:00 و15:00 لم تُرسل منفردة (الحد 6 في الساعة):\n• تنبيه من نوع 7\n• تنبيه من نوع 8\n• تنبيه من نوع 9", sum);
  await quiet(() => sendOwnerAlert(env, "تنبيه الساعة التالية", { kind: "next" }));
  assert("the next hour starts from zero", ownerTexts().length === 9);
}

// ================================================================ ب1
console.log("\n[ب1] the storm cannot feed itself");
{
  const env = fresh(`${DAY} 05:02`);
  ODOO.setOdooRetryHooksForTests({ sleep: async () => {} }); // the real alert, as on the worker
  const real = globalThis.fetch;
  let lookups = 0;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/x_wa_message/")) { lookups++; return new Response("<html><h1>429 Too Many Requests</h1></html>", { status: 429 }); }
    return real(input as any, init);
  }) as typeof fetch;
  try {
    // 41 alerts' worth of Meta's callbacks (sent, delivered, read) while Odoo answers 429 to every lookup
    for (let i = 0; i < 41; i++) {
      for (const status of ["sent", "delivered", "read"]) {
        await quiet(() => worker.fetch(signed({ entry: [{ changes: [{ value: { statuses: [{ id: `wamid.STORM${i}`, status, recipient_id: OWNER, timestamp: "1791424949" }] } }] }] }), env, ctx));
      }
    }
  } finally { globalThis.fetch = real; ODOO.setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} }); }
  assert("123 status callbacks Odoo refuses (each tried four times)", lookups === 123 * 4, String(lookups));
  assert("NOT ONE alert to Baraa: a callback's lookup is quiet (on 2026-10-08 each one alerted, and each alert called back)", sentTo(OWNER).length === 0);
  await flush(env);
  assert("…and nothing waits to be sent after it either", sentTo(OWNER).length === 0 && graph.filter((b: any) => b?.to).length === 0);
  assert("the lookup and its write are marked quiet in the code", /\{ quiet: true \},\s*\);\s*if \(rows\.length === 0\) return null;/.test(srcOf("wa-message-send.ts")));
}

// ================================================================ ب2
console.log("\n[ب2] the template sync: what changed, spaced, one stamp for the rest");
{
  const env = fresh(`${DAY} 05:00`);
  env.META_WABA_ID = "WABA";
  for (const r of rows("x_whatsapp_template")) table("x_whatsapp_template").delete((r as any).id);
  const N = 77;
  const meta = Array.from({ length: N }, (_, i) => ({ id: `m${i}`, name: `utak_t${i}`, language: "ar", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: `نص ${i} {{1}}` }] }));
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("graph.facebook.com") && url.includes("message_templates")) return new Response(JSON.stringify({ data: meta }), { status: 200 });
    return real(input as any, init);
  }) as typeof fetch;
  const pauses: number[] = [];
  SYNC.setSyncSleepForTests(async (ms) => { pauses.push(ms); });
  const tplWrites = () => odooLog.filter((l) => l.model === "x_whatsapp_template" && (l.method === "write" || l.method === "create"));
  try {
    // the first run: nothing in Odoo yet — 77 creates, each after a pause
    const r1 = await quiet(() => SYNC.syncTemplates(env));
    assert("the first sync creates the 77 rows — a pause before every write but the first", r1.created === N && tplWrites().length === N && pauses.length === N - 1 && pauses.every((p) => p === SYNC.SYNC_WRITE_SPACING_MS) && SYNC.SYNC_WRITE_SPACING_MS === 400, `${r1.created} ${tplWrites().length} ${pauses.length}`);
    // the daily run when nothing changed at Meta: ONE call
    odooLog.length = 0; pauses.length = 0;
    const r2 = await quiet(() => SYNC.syncTemplates(env));
    const w2 = tplWrites();
    assert("the daily sync with nothing changed at Meta: ONE write for the 77 rows («آخر مزامنة»), not 77", r2.updated === N && r2.written === 0 && w2.length === 1 && w2[0].body.ids.length === N && JSON.stringify(Object.keys(w2[0].body.vals)) === '["x_last_synced"]' && pauses.length === 0, `${r2.updated} ${r2.written} ${w2.length}`);
    // two templates changed at Meta: their two writes, spaced, and one stamp for the 75 others
    odooLog.length = 0; pauses.length = 0;
    meta[3].status = "PAUSED"; meta[40].category = "MARKETING";
    const r3 = await quiet(() => SYNC.syncTemplates(env));
    const w3 = tplWrites();
    assert("two templates changed: two writes of their own and one stamp for the 75 others — three calls, a pause between each two", r3.written === 2 && w3.length === 3 && w3[0].body.vals.x_meta_status === "PAUSED" && w3[1].body.vals.x_category === "MARKETING" && w3[2].body.ids.length === N - 2 && pauses.length === 2, `${r3.written} ${w3.length} ${pauses.length}`);
    assert("…and the two rows hold Meta's values", (rows("x_whatsapp_template").find((r: any) => r.x_meta_template_id === "utak_t3") as any).x_meta_status === "PAUSED" && (rows("x_whatsapp_template").find((r: any) => r.x_meta_template_id === "utak_t40") as any).x_category === "MARKETING");
    assert("a row is in sync only when every synced value is Odoo's own", SYNC.rowInSync({ a: "x", b: false, c: 2 }, { a: "x", b: "", c: "2" }) && !SYNC.rowInSync({ a: "x" }, { a: "y" }) && !SYNC.rowInSync({}, { a: "" }));
  } finally { globalThis.fetch = real; SYNC.setSyncSleepForTests(null); }
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ز
console.log("\n[ز] a token is never printed");
{
  const SECRET = "c0ffee" + "9".repeat(58), OTHER = "abcDEF_123-xyz.456~789";
  const hook = `https://utak-worker.utak-business.workers.dev/odoo/hook/special-quote?token=${OTHER}&op=send`;
  const code = `action = {\n    'type': 'ir.actions.act_url',\n    'url': 'https://utak-worker.utak-business.workers.dev/internal/invoice-pdf?id=' + str(record.id) + '&token=${SECRET}',\n    'target': 'new',\n}`;
  const u1 = TOK.workerUrls(hook), u2 = TOK.workerUrls(code);
  assert("a token is found in a webhook's URL and in an Odoo code action that builds its URL", u1.length === 1 && u1[0].token === OTHER && u1[0].path === "/odoo/hook/special-quote" && u1[0].host === "prod" && u2.length === 1 && u2[0].token === SECRET && u2[0].path === "/internal/invoice-pdf");
  assert("a URL with no token has none (the preview's ticket)", TOK.workerUrls("'url': 'https://utak-worker.utak-business.workers.dev/preview/t/' + ticket,")[0].token === null && TOK.workerUrls("https://utak-worker-sim.utak-business.workers.dev/health")[0].host === "sim");
  assert("each route has its secret", TOK.secretOf("/internal/invoice-pdf") === "pdf" && TOK.secretOf("/internal/sale-quotation-pdf") === "pdf" && TOK.secretOf("/internal/quotation-issue") === "internal" && TOK.secretOf("/internal/official-doc/issue") === "internal" && TOK.secretOf("/odoo/hook/wa") === "hook" && TOK.secretOf("/internal/quotation-wa-send") === "hook" && TOK.secretOf("/preview/t/") === null);
  const t = TOK.tag(SECRET);
  assert("a tag is six hex characters, the same for the same token, and never part of it", /^[0-9a-f]{6}$/.test(t) && t === TOK.tag(SECRET) && t !== TOK.tag(OTHER) && !SECRET.includes(t));
  const shown = TOK.scrub(`${hook}\n${code}\nAuthorization: Bearer ${OTHER}\nwrangler: secret=${SECRET}`, [SECRET]);
  assert("what is printed never carries a token: a known one is its tag, any other is masked", !shown.includes(SECRET) && !shown.includes(OTHER) && shown.includes(`<tag:${t}>`) && shown.includes("token=<masked>") && shown.includes("Bearer <masked>"), shown);
  const a = TOK.newToken(), b = TOK.newToken();
  assert("a new token is 64 hex characters, never the same twice", /^[0-9a-f]{64}$/.test(a) && a !== b);
  assert("replacing a token touches it alone, everywhere it is", TOK.replaceToken(`${code} ${code}`, SECRET, a).split(a).length === 3 && !TOK.replaceToken(code, SECRET, a).includes(SECRET) && TOK.replaceToken(hook, SECRET, a) === hook);
  let threw = false; try { TOK.replaceToken(code, "abc", a); } catch { threw = true; }
  assert("a token too short to be one is never replaced", threw);
  for (const f of ["s67-20261008-token.mjs", "s67-20261008-token-inventory.mjs"]) {
    const src = readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
    const prints = src.split("\n").filter((l) => /console\.(log|error|warn)\(|process\.std(out|err)\.write\(/.test(l));
    assert(`scripts/${f}: it prints through ONE line, and that line scrubs (a token there is its tag, anything after «token=» is masked)`, prints.length === 1 && /console\.log\(scrub\(a\.join\(" "\), (known|seen)\)\)/.test(prints[0]), prints.join(" | "));
  }
  assert("the rotation's rollback file (it holds the tokens of before) is in backups/, outside git — never in scripts/artifacts", /backups\/s67-20261008-token-rollback\.json/.test(readFileSync(new URL("../scripts/s67-20261008-token.mjs", import.meta.url), "utf8")) && readFileSync(new URL("../.gitignore", import.meta.url), "utf8").split("\n").some((l) => /^\/?backups\/?$/.test(l.trim())));
}

done();
