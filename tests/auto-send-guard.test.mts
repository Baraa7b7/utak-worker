// Tests for the automated-send idempotency key + one-row-per-wamid logging
// (2026-09-23, duplicate WhatsApp messages).
//
//   1. Two back-to-back automated sends of the same job → Meta hit once,
//      second call refused as SkippedDuplicate (409).
//   2. The next Riyadh day → the same send goes out again.
//   3. A different job on the same day (owner alert from 06:00 vs 21:15)
//      is NOT blocked.
//   4. Manual send from Odoo (no AUTO_SEND_JOB) is never blocked, twice in
//      a row → two Meta calls; the repeat only logs a warning.
//   5. logWaMessage twice with the same wamid → exactly one x_wa_message
//      create.
//   6. The key is written before the send (present even when Meta fails).
//
// Runs under Node --experimental-strip-types; no framework. Nothing leaves
// the process: fetch is mocked for both graph.facebook.com and Odoo.
//
// 2026-09-25 (STATUS § 33) — sends go through the single gateway
// (sendViaGateway); fetchMeta is gone. Templates carry their row (APPROVED /
// UTILITY), session texts need the number's window (opened with noteInbound).

import { sendViaGateway, type GwOption } from "../src/wa-gateway.ts";
import { noteInbound } from "../src/wa-window.ts";
import {
  autoSendKey,
  claimAutoSend,
  isSkippedDuplicate,
  withAutoSendJob,
  CRON_JOB,
} from "../src/auto-send-guard.ts";
import { logWaMessage } from "../src/wa-message-send.ts";

// ---------- in-memory KV ----------
function makeKV() {
  const store = new Map<string, { v: string; ttl?: number }>();
  return {
    store,
    async get(k: string) { return store.has(k) ? store.get(k)!.v : null; },
    async put(k: string, v: string, o?: { expirationTtl?: number }) { store.set(k, { v, ttl: o?.expirationTtl }); },
    async delete(k: string) { store.delete(k); },
  };
}

// ---------- fetch mock ----------
let metaCalls: any[] = [];
let odooCalls: Array<{ path: string; body: any }> = [];
let metaStatus = 200;
let waRowsByWamid = new Map<string, number>();
let nextWamid = 1;

globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  let body: any = null;
  try { body = JSON.parse(init?.body ?? "null"); } catch { body = init?.body; }
  if (url.includes("graph.facebook.com")) {
    metaCalls.push(body);
    if (metaStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: "boom", code: 1 } }), { status: metaStatus });
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.TEST${nextWamid++}` }] }), { status: 200 });
  }
  const path = new URL(url).pathname;
  odooCalls.push({ path, body });
  if (path.endsWith("/x_wa_message/search_read")) {
    const w = body?.domain?.[0]?.[2];
    return new Response(JSON.stringify(waRowsByWamid.has(w) ? [{ id: waRowsByWamid.get(w) }] : []), { status: 200 });
  }
  if (path.endsWith("/x_wa_message/create")) {
    const w = body?.vals_list?.[0]?.x_meta_message_id;
    const id = 1000 + odooCalls.length;
    if (w) waRowsByWamid.set(w, id);
    return new Response(JSON.stringify([id]), { status: 200 });
  }
  if (path.endsWith("/res.partner/search_read")) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  return new Response(JSON.stringify(true), { status: 200 });
}) as typeof globalThis.fetch;

function makeEnv(extra: Record<string, unknown> = {}): any {
  return {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    META_GRAPH_VERSION: "v22.0",
    META_PHONE_NUMBER_ID: "1",
    META_ACCESS_TOKEN: "x",
    OWNER_WHATSAPP: "+966500000001",
    PILOT_MODE: "true",
    SIM_ALLOWLIST: "+966500000001,+966500000002",
    MSG_DEDUP: makeKV(),
    ...extra,
  };
}

const tpl = (name: string, to = "966500000002") => ({
  messaging_product: "whatsapp",
  to,
  type: "template",
  template: { name, language: { code: "ar" }, components: [] },
});
const row = (name: string) => ({ id: 1, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_category: "UTILITY", x_param_count: 0 });
const sendTpl = (env: any, name: string, purpose: string, to = "966500000002") =>
  sendViaGateway(env, { purpose, to, content: { kind: "template", row: row(name) } });
const text = (body: string): GwOption => ({ kind: "session", body: { type: "text", text: { body } } });
const sendTxt = (env: any, body: string, purpose: string, to = "966500000002") =>
  sendViaGateway(env, { purpose, to, content: text(body) });
const openWindow = (env: any, to: string) => noteInbound(env, to, Date.now() - 3600_000);

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`); }
}
function reset() { metaCalls = []; odooCalls = []; metaStatus = 200; waRowsByWamid = new Map(); }

console.log("\n[1] double automated call → one Meta send");
{
  reset();
  const env = withAutoSendJob(makeEnv(), CRON_JOB["0 23 * * *"]);
  const r1 = await sendTpl(env, "utak_supplier_daily_ask", "supplier_ask");
  const r2 = await sendTpl(env, "utak_supplier_daily_ask", "supplier_ask");
  assert("first send ok", r1.ok);
  assert("second refused with 409", r2.status === 409, String(r2.status));
  assert("second flagged SkippedDuplicate", await isSkippedDuplicate(r2));
  assert("Meta hit exactly once", metaCalls.length === 1, String(metaCalls.length));
  const key = autoSendKey("966500000002", tpl("utak_supplier_daily_ask"), "ask_suppliers");
  const ttl = (env.MSG_DEDUP as any).store.get(key)?.ttl;
  assert("key TTL = 26h", ttl === 26 * 3600, String(ttl));
  assert("key uses Riyadh day + recipient + template + job",
    /^autosend:v1:\d{4}-\d{2}-\d{2}:966500000002:tpl:utak_supplier_daily_ask:ask_suppliers$/.test(key), key);
}

console.log("\n[2] next Riyadh day → sends again");
{
  const env = makeEnv();
  // 2026-09-23 20:59 UTC = 23:59 Riyadh; 21:01 UTC = 00:01 Riyadh next day.
  const d1 = new Date("2026-09-23T20:59:00Z");
  const d2 = new Date("2026-09-23T21:01:00Z");
  const a = await claimAutoSend(env, "+966500000002", tpl("utak_v2_inactive"), "daily_outreach", d1);
  const b = await claimAutoSend(env, "+966500000002", tpl("utak_v2_inactive"), "daily_outreach", d1);
  const c = await claimAutoSend(env, "+966500000002", tpl("utak_v2_inactive"), "daily_outreach", d2);
  assert("day 1 first claim ok", a.claimed);
  assert("day 1 second claim refused", !b.claimed);
  assert("day 2 (after Riyadh midnight) claim ok", c.claimed);
  assert("day boundary is Riyadh, not UTC", a.key.includes(":2026-09-23:") && c.key.includes(":2026-09-24:"), `${a.key} / ${c.key}`);
}

console.log("\n[3] same template, different job, same day → both sent");
{
  reset();
  const base = makeEnv();
  const owner = "966500000001";
  await openWindow(base, owner);
  const r1 = await sendTxt(withAutoSendJob(base, "open_ordering"), "تنبيه", "owner_alert", owner);
  const r2 = await sendTxt(withAutoSendJob(base, "aggregate_purchase"), "تنبيه", "owner_alert", owner);
  assert("06:00 alert sent", r1.ok);
  assert("21:15 alert sent", r2.ok);
  assert("Meta hit twice", metaCalls.length === 2, String(metaCalls.length));
}

console.log("\n[4] manual send from Odoo is never blocked");
{
  reset();
  const env = makeEnv();
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
  const r1 = await sendTpl(env, "utak_invoice_customer_v2", "wa_message_manual");
  const r2 = await sendTpl(env, "utak_invoice_customer_v2", "wa_message_manual");
  console.warn = origWarn;
  assert("manual #1 sent", r1.ok);
  assert("manual #2 sent", r2.ok);
  assert("Meta hit twice", metaCalls.length === 2, String(metaCalls.length));
  assert("repeat within 60s logged as warning", warns.some((w) => w.includes("[manual-send]") && w.includes("not blocked")));
  const autoKeys = [...(env.MSG_DEDUP as any).store.keys()].filter((k: string) => k.startsWith("autosend:"));
  assert("no autosend key written for manual send", autoKeys.length === 0, autoKeys.join(","));
}

console.log("\n[5] one x_wa_message row per wamid");
{
  reset();
  const env = makeEnv();
  await logWaMessage(env, { partnerId: 30, direction: "out", kind: "template", body: "x", metaMessageId: "wamid.SAME", source: "auto" });
  await logWaMessage(env, { partnerId: 30, direction: "out", kind: "template", body: "x", metaMessageId: "wamid.SAME", source: "auto" });
  const creates = odooCalls.filter((c) => c.path.endsWith("/x_wa_message/create"));
  assert("exactly one create for the same wamid", creates.length === 1, String(creates.length));
  await logWaMessage(env, { partnerId: 30, direction: "out", kind: "template", body: "x", metaMessageId: "wamid.OTHER", source: "auto" });
  const creates2 = odooCalls.filter((c) => c.path.endsWith("/x_wa_message/create"));
  assert("a different wamid still creates", creates2.length === 2, String(creates2.length));
}

console.log("\n[6] key written before the send (held even when Meta fails)");
{
  reset();
  metaStatus = 500;
  const env = withAutoSendJob(makeEnv(), "collection_summary");
  await openWindow(env, "966500000001");
  await openWindow(env, "966500000002");
  const r1 = await sendTpl(env, "utak_collection_summary", "collection_summary");
  metaStatus = 200;
  const key = autoSendKey("966500000002", tpl("utak_collection_summary"), "collection_summary");
  assert("the job key was written before the send", (env.MSG_DEDUP as any).store.has(key), key);
  const r2 = await sendTpl(env, "utak_collection_summary", "collection_summary");
  // 2026-09-24 (ح6): a failure also alerts the owner (+966500000001) once —
  // only the calls to the original recipient count here.
  const toRecipient = metaCalls.filter((b: any) => b?.to === "966500000002");
  assert("first attempt reached Meta and failed", !r1.ok && toRecipient.length === 1, String(toRecipient.length));
  assert("the failure alerted the owner", metaCalls.some((b: any) => b?.to === "966500000001"));
  assert("retry of the same template same job refused (409)", r2.status === 409, String(r2.status));
  // STATUS § 33 — Meta refused the purpose: no automatic send of it to this
  // number for 24h, not even the text fallback (it used to go once).
  const r3 = await sendTxt(env, "fallback", "collection_summary");
  assert("text fallback of the refused purpose refused too", r3.status === 409, String(r3.status));
  const again = metaCalls.filter((b: any) => b?.to === "966500000002");
  assert("Meta reached once for this recipient — no retry", again.length === 1, String(again.length));
}

console.log("\n[7] request paths (no AUTO_SEND_JOB) are untouched");
{
  reset();
  const env = makeEnv();
  await openWindow(env, "966500000002");
  const a = await sendTxt(env, "hi", "bot_reply");
  const b = await sendTxt(env, "hi", "bot_reply");
  assert("bot replies both sent", a.ok && b.ok && metaCalls.length === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
