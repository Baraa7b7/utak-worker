// § 46 هـ — after the launch (2026-10-01): x_quotation in the pre-launch mark (a simulation order's
// quotation is a simulation), the cutover's first tick (90 minutes, analytics or wrangler tail),
// and Meta 131042 — the account's payment problem: one clear alert a day, and no purpose block.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s46-post-launch.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  COLL_PHONE, CUST, CUST_PHONE, OWNER, employee, graph, heldFor, odooLog, openWindow, partnerOf, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, table, workSchedule,
} from "./wa-harness.mts";
import {
  AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, FIX, OMAR_EMP, assert, cost, dayOf, deliveredAt, done, dp, fourLines, fresh, lineFor, market, ownerTexts, rejected, setExtract,
} from "./s46-kit.mts";

const SF = await import("../src/send-failure.ts");
const GW = await import("../src/wa-gateway.ts");
// @ts-ignore — plain .mjs helpers
const RP = await import("../scripts/lib/real-partners.mjs");
// @ts-ignore
const TT = await import("../scripts/lib/tail-ticks.mjs");

// ================================================================ [هـ]
console.log("\n[هـ-1] the pre-launch mark: a simulation order's quotation is a simulation");
{
  reset(); setRiyadh(`${DAY} 10:00`);
  seed("res.partner", { id: 31, name: "ابو مكين المعبري", customer_rank: 1 });
  const oSim = seed("x_daily_order", { x_customer_id: 900, x_state: "draft", x_order_date: "2026-09-15", x_is_simulation: true, x_utak_simulation: true });
  const oIs = seed("x_daily_order", { x_customer_id: 900, x_state: "draft", x_order_date: "2026-09-16", x_is_simulation: true });
  const oReal = seed("x_daily_order", { x_customer_id: 31, x_state: "confirmed", x_order_date: "2026-10-01", x_is_simulation: true });
  const oPlain = seed("x_daily_order", { x_customer_id: 901, x_state: "confirmed", x_order_date: "2026-10-01" });
  const qSim = seed("x_quotation", { x_order_id: oSim });
  const qIs = seed("x_quotation", { x_order_id: oIs });
  const qReal = seed("x_quotation", { x_order_id: oReal });
  const qPlain = seed("x_quotation", { x_order_id: oPlain });
  const qDone = seed("x_quotation", { x_order_id: oSim, x_utak_simulation: true });
  const call = async (model: string, method: string, body: any): Promise<any> => {
    if (method === "fields_get") return model === "x_quotation" ? { x_utak_simulation: {} } : { x_is_simulation: {}, x_utak_simulation: {} };
    return (await fetch(`https://odoo.test/json/2/${model}/${method}`, { method: "POST", body: JSON.stringify(body) })).json();
  };
  const linked = await RP.linkedRecordIds(call, [31]);
  const s = await RP.selectForMark(call, "x_quotation", linked);
  assert("the quotation of an order already marked is selected", s.ids.includes(qSim), JSON.stringify(s));
  assert("…and of an order the same run will mark (x_is_simulation)", s.ids.includes(qIs));
  assert("a real customer's quotation is never selected (listed as excluded), nor an ordinary order's", !s.ids.includes(qReal) && s.excluded.includes(qReal) && !s.ids.includes(qPlain), JSON.stringify(s));
  assert("one already marked is not selected again", !s.ids.includes(qDone) && s.ids.length === 2);
  const markSrc = readFileSync(new URL("../scripts/s42-20260927-prelaunch-mark.mts", import.meta.url), "utf8");
  const models = /export const MODELS = \[([\s\S]*?)\];/.exec(markSrc)?.[1] ?? "";
  assert("the mark script's models include x_quotation, after the order and its lines", /"x_daily_order", "x_daily_order_line", "x_quotation"/.test(models), models);
  assert("the other models keep their rule (x_is_simulation = true, not yet marked)", JSON.stringify(Object.keys(RP.PARENT_RULE)) === '["x_quotation"]' && RP.PARENT_RULE.x_quotation === "x_order_id");
}

console.log("\n[هـ-2] the cutover's first tick: 90 minutes, analytics or wrangler tail");
{
  const cut = readFileSync(new URL("../scripts/cutover-prod.mts", import.meta.url), "utf8");
  assert("the wait is 90 minutes (it was 12), polled every 30 seconds", /export const FIRST_TICK_WAIT_MIN = 90;/.test(cut) && /i < FIRST_TICK_WAIT_MIN \* 2 && !prodTick/.test(cut) && !/i < 24 && !prodTick/.test(cut));
  assert("the tick is accepted from the analytics OR from wrangler tail, and the source is reported", /prodTick = seen \? \{ \.\.\.seen, source: "analytics" \} : live \? \{[^}]*source: "wrangler tail" \} : null;/.test(cut)
    && /const live = tailProd\.ticks\.find\(\(x: any\) => x\.cron === "\*\/5 \* \* \* \*" && x\.at >= t4At\)/.test(cut) && /watchTail\("utak-worker"/.test(cut) && /watchTail\("utak-worker-sim"/.test(cut));
  assert("a tick sim runs after step 3 is seen by the tail too", /tailSim\.ticks\.filter/.test(cut));
  assert("the tails are stopped whatever happens", /finally \{\s*tailProd\.stop\(\); tailSim\.stop\(\);/.test(cut));
  const ev = (cron: string | null, ts: number, script = "utak-worker") => JSON.stringify({ outcome: "ok", scriptName: script, event: cron ? { cron, scheduledTime: ts } : { request: { url: "https://x/health?a={b}", method: "GET" } }, eventTimestamp: ts, logs: [{ message: ['a "quoted" } text', "{{ open"] }] }, null, 2);
  const stream = ev("*/5 * * * *", 1790800800123) + "\n" + ev(null, 1790800801000) + "\n" + ev("0 17 * * *", 1790800802000);
  const { objects, rest } = TT.splitJsonObjects(stream + "\n" + ev("*/5 * * * *", 1790801100000).slice(0, 60));
  const ticks = TT.scheduledTicks(objects);
  assert("wrangler tail's pretty JSON is split into its events (braces and quotes inside strings do not break it)", objects.length === 3 && rest.trim().length === 60, `${objects.length} ${rest.length}`);
  assert("…the scheduled ones only, with their cron and time", ticks.length === 2 && ticks[0].cron === "*/5 * * * *" && ticks[0].at === "2026-09-30T20:40:00.123Z" && ticks[0].outcome === "ok" && ticks[1].cron === "0 17 * * *", JSON.stringify(ticks));
  const whole = TT.splitJsonObjects(rest + ev("*/5 * * * *", 1790801100000).slice(60));
  assert("an event cut between two chunks is completed by the next chunk", whole.objects.length === 1 && TT.scheduledTicks(whole.objects)[0].at === "2026-09-30T20:45:00.000Z", JSON.stringify(whole.objects.length));
}

console.log("\n[هـ-3] Meta 131042 (the account's payment problem): one clear alert a day, and no purpose block");
{
  const env = fresh(`${DAY} 02:30`);
  await quiet(() => SF.recordSendFailure(env, { to: "+" + DRIVER_PHONE, what: "utak_shift_start_v2", code: 131042, message: "Business eligibility payment issue", phase: "async", hasRow: true }));
  await quiet(() => SF.recordSendFailure(env, { to: "+" + AHMED_PHONE, what: "utak_supplier_price_nudge", code: "131042", message: "Business eligibility payment issue", phase: "sync", hasRow: true }));
  await quiet(() => SF.recordSendFailure(env, { to: "+" + OWNER, what: "utak_shift_start_v2", code: "131042", message: "Business eligibility payment issue", phase: "async", hasRow: true }));
  const t = ownerTexts();
  assert("three templates refused with 131042 in a day (one of them Baraa's own): ONE alert", t.length === 1, JSON.stringify(t));
  assert("…the clear text, exactly", t[0] === "⚠️ Meta أوقف رسائل القوالب بسبب الدفع: سدّد المستحق في الفوترة والمدفوعات لحساب واتساب للأعمال" && t[0] === SF.PAYMENT_ISSUE_TEXT, t[0]);
  assert("…not the per-template «فشل إرسال واتساب» alert", !t.some((x) => /فشل إرسال واتساب/.test(x)));
  await quiet(() => SF.recordSendFailure(env, { to: "+" + AHMED_PHONE, what: "utak_supplier_price_nudge", code: 131026, message: "Message undeliverable", phase: "async", hasRow: true }));
  assert("another Meta code keeps its per-template alert", ownerTexts().length === 2 && /فشل إرسال واتساب — القالب: utak_supplier_price_nudge، الرمز 131026/.test(ownerTexts()[1]), JSON.stringify(ownerTexts()));
  const fails = await SF.readRecentSendFailures(env, 1, new Date());
  assert("every refusal is still counted (/health sendFailures)", fails[0].count === 4, JSON.stringify(fails));
  setRiyadh("2026-10-04 02:30");
  await quiet(() => SF.recordSendFailure(env, { to: "+" + DRIVER_PHONE, what: "utak_shift_start_v2", code: 131042, message: "Business eligibility payment issue", phase: "async", hasRow: true }));
  assert("the next day it is unpaid still: one alert again", ownerTexts().filter((x) => x === SF.PAYMENT_ISSUE_TEXT).length === 2);
  setRiyadh("2026-10-05 06:00");
  await quiet(() => SF.recordSendFailure(env, { to: "+" + OWNER, what: "utak_shift_start_v2", code: 131042, message: "Business eligibility payment issue", phase: "async", hasRow: true }));
  assert("a day when only Baraa's own template is refused: he is still told (his text needs no template)", ownerTexts().filter((x) => x === SF.PAYMENT_ISSUE_TEXT).length === 3);
}
{
  const env = fresh(`${DAY} 10:00`);
  const req = () => quiet(() => GW.sendViaGateway(env, { purpose: "collection_request", to: "+" + COLL_PHONE, content: { kind: "template", purpose: "collection_request", params: ["مطعم", "العليا", "UTAK-INV-1", "100"] } as any }));
  assert("collection_request is a purpose a refusal blocks for 24h", GW.blocksOnRefusal("collection_request"));
  setFail({ utak_collection_request: 131042 });
  const r1 = await req();
  const key = GW.purposeBlockKey("+" + COLL_PHONE, "collection_request");
  assert("a template refused with 131042: no 24h block of its purpose for that number", r1.status === 400 && !env.MSG_DEDUP.store.has(key), `${r1.status} ${env.MSG_DEDUP.store.get(key)}`);
  assert("…Baraa's one clear alert", ownerTexts().filter((x) => x === SF.PAYMENT_ISSUE_TEXT).length === 1 && !ownerTexts().some((x) => /فشل إرسال واتساب/.test(x)), JSON.stringify(ownerTexts()));
  setFail({});
  graph.length = 0;
  const r2 = await req();
  assert("Baraa pays: the very next send of that purpose goes", r2.ok && sentTo(COLL_PHONE).some((b: any) => b?.template?.name === "utak_collection_request"), `${r2.status}`);
  env.MSG_DEDUP.store.set(key, JSON.stringify({ code: 131042, at: "2026-09-30T23:30:45.833Z" }));
  graph.length = 0;
  const r3 = await req();
  assert("a block written for 131042 before this guard (as on prod's KV today) no longer blocks", r3.ok && sentTo(COLL_PHONE).length === 1, `${r3.status}`);
  env.MSG_DEDUP.store.set(key, JSON.stringify({ code: 131026, at: "2026-10-03T06:00:00.000Z" }));
  graph.length = 0;
  const r4 = await req();
  assert("a block for any other refusal still blocks (24h, as before)", r4.status === 409 && sentTo(COLL_PHONE).length === 0, `${r4.status}`);
  env.MSG_DEDUP.store.delete(key);
  setFail({ utak_collection_request: 131026 });
  await req();
  assert("…and another refusal still writes its block", env.MSG_DEDUP.store.has(key) && GW.isPurposeBlock(env.MSG_DEDUP.store.get(key)));
  assert("isPurposeBlock: null no, 131042 no, another code yes, an unreadable value yes", !GW.isPurposeBlock(null) && !GW.isPurposeBlock('{"code":131042}') && !GW.isPurposeBlock('{"code":"131042"}') && GW.isPurposeBlock('{"code":131026}') && GW.isPurposeBlock("x"));
  setFail({});
}

// ================================================================ [س]
console.log("\n[س] schema");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));

done();
