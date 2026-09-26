// Meta's delivery statuses never go down — 2026-09-25 (STATUS § 37 أ).
//
//   [0] the order: sent < failed < delivered < read — every pair, the row's
//       own gateway states (held, skipped, expired, queued) are not
//       overwritten, the technical note keeps JSON and the last five.
//   [1] the webhook, every order: sent / delivered / read in all six orders →
//       read; with failed: {sent, failed} → failed, {sent, delivered, failed}
//       → delivered, whatever the order (#162: «delivered» then «sent» in the
//       same second stays delivered).
//   [2] failed after delivered / read: not written, noted in x_debug_payload;
//       nothing acted on — no «⚠️ ما انرسلت» line, no owner alert, no failure
//       row or /health count, no window closed, no purpose blocked.
//   [3] failed over sent: written and acted on as before (§ 33).
//   [4] delivered after failed: written, and the Discuss line says it went.
//   [5] a held message flushed and read: a later failed leaves its status
//       line alone (no server action, no new line).
//   [6] the D1 status log: every call with its verdict and Meta's timestamp;
//       a row created after its «delivered» starts at delivered; no row and D1
//       says delivered → a failed is not acted on.
//   [7] static: every write of a Meta status goes through statusVerdict.
//   [8] schema: every Odoo write names real fields (fixtures).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) + an in-memory D1.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-status.test.mts

import { readFileSync } from "node:fs";
import {
  CUST, CUST_PHONE, OWNER, graph, heldFor, odooLog, openWindow, quiet, reset, rows, seed, sentTo, serverActions, setRiyadh,
  signed, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = ["./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-review.json", "./fixtures-odoo-fields-20260925-gateway.json",
  "./fixtures-odoo-fields-20260925-s36.json",
  // STATUS § 41 ج — the 18:00 list and م2 exclude by x_invoice.x_utak_simulation
  "./fixtures-odoo-fields-20260926-s41.json"].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if (model === "res.partner" && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
    const b = JSON.parse(init.body);
    const writes: Array<Record<string, unknown>> = [b.vals ?? {}, ...((b.vals_list ?? []) as Array<Record<string, unknown>>)];
    const names = [
      ...((b.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0])),
      ...(b.fields ?? []),
      ...writes.flatMap((v) => Object.keys(v)),
    ];
    const bad = names.filter((f: string) => !known(m[1], f));
    const badSel = writes.flatMap((v) => Object.entries(v))
      .filter(([k, val]) => SELECTIONS[`${m[1]}.${k}`] && val !== false && !SELECTIONS[`${m[1]}.${k}`].includes(String(val)))
      .map(([k, val]) => `${k}=${val}`);
    if (bad.length || badSel.length) {
      rejected.push(`${m[1]}.${m[2]}: ${[...bad, ...badSel].join(",")}`);
      return new Response(JSON.stringify({ name: "builtins.ValueError", message: "Invalid" }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

// ---------------------------------------------------------------- an in-memory D1 (sim_outbound + wa_status_log)
type LogRow = { id: number; wamid: string; status: string; meta_ts: number | null; received_ms: number; recipient: string | null; error_code: number | null; row_id: number | null; applied: number; verdict: string };
let statusLog: LogRow[] = [];
function makeD1() {
  return {
    prepare(sql: string) {
      const run = (params: unknown[]) => ({
        async run() {
          if (/INSERT INTO wa_status_log/.test(sql)) {
            const [wamid, status, meta_ts, received_ms, recipient, error_code, row_id, applied, verdict] = params as any[];
            statusLog.push({ id: statusLog.length + 1, wamid, status, meta_ts, received_ms, recipient, error_code, row_id, applied, verdict });
          }
          return { success: true };
        },
        async all() {
          if (/FROM wa_status_log WHERE wamid/.test(sql)) return { results: statusLog.filter((r) => r.wamid === params[0]).map((r) => ({ status: r.status })) };
          return { results: [] };
        },
        async first() { return null; },
      });
      return { bind: (...p: unknown[]) => run(p), ...run([]) };
    },
  };
}

const { statusVerdict, highestStatus, withIgnoredNote, META_STATUS_RANK } = await import("../src/wa-status.ts");
const { sendText } = await import("../src/meta.ts");
const { flushHeld } = await import("../src/wa-gateway.ts");
const { readWindow } = await import("../src/wa-window.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const { readRecentSendFailures } = await import("../src/send-failure.ts");
const worker = (await import("../src/index.ts")).default;

const BOT = 42;
let ENV: any;
function fresh(riyadh = "2026-09-26 10:00"): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; statusLog = [];
  env.SIM_DB = makeD1();
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("discuss.channel", { id: 70, name: "واتساب · مطعم الوادي", x_wa_partner_id: CUST });
  table("res.partner").get(CUST)!.x_wa_channel_id = 70;
  return env;
}
/** A ctx whose waitUntil tasks the test awaits (the Discuss line runs there). */
function collectingCtx() {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p: Promise<unknown>) => { tasks.push(p); }, passThroughOnException: () => {} } as any;
}
const waRow = (wamid: string) => rows("x_wa_message").find((r) => r.x_meta_message_id === wamid) as any;
async function status(wamid: string, st: string, extra: Record<string, unknown> = {}): Promise<void> {
  const c = collectingCtx();
  await quiet(async () => {
    await worker.fetch(signed({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: st, recipient_id: CUST_PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...extra }] } }] }] }), ENV, c);
    await Promise.all(c.tasks);
  });
}
const FAIL = (code: number) => ({ errors: [{ code, message: `(#${code}) refused` }] });
/** One accepted text to the customer (window open) → its wamid. */
async function sendOne(text = "رسالة", purpose = "collection_nothing"): Promise<string> {
  openWindow(ENV, CUST_PHONE, 30);
  const r = await quiet(() => sendText(ENV, "+" + CUST_PHONE, text, { purpose } as any));
  return (await r.clone().json()).messages[0].id;
}
const failLines = () => odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post" && String(l.body?.body ?? "").includes("ما انرسلت")).length;
function perms<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

// ================================================================ 0. the order
console.log("\n[0] the order: sent < failed < delivered < read");
{
  assert("ranks: sent 1 < failed 2 < delivered 3 < read 4",
    META_STATUS_RANK.sent < META_STATUS_RANK.failed && META_STATUS_RANK.failed < META_STATUS_RANK.delivered && META_STATUS_RANK.delivered < META_STATUS_RANK.read);
  const S = ["sent", "delivered", "read", "failed"] as const;
  const expect: Record<string, boolean> = {
    "sent>sent": false, "sent>delivered": true, "sent>read": true, "sent>failed": true,
    "delivered>sent": false, "delivered>delivered": false, "delivered>read": true, "delivered>failed": false,
    "read>sent": false, "read>delivered": false, "read>read": false, "read>failed": false,
    "failed>sent": false, "failed>delivered": true, "failed>read": true, "failed>failed": false,
  };
  const wrong = S.flatMap((cur) => S.map((inc) => [cur, inc] as const)).filter(([c, i]) => statusVerdict(c, i).apply !== expect[`${c}>${i}`]);
  assert("all 16 pairs: a lower or equal status is never written; failed only over sent", wrong.length === 0, JSON.stringify(wrong));
  assert("failed after delivered / read: verdict «failed_after_delivery»",
    statusVerdict("delivered", "failed").why === "failed_after_delivery" && statusVerdict("read", "failed").why === "failed_after_delivery");
  assert("sent after delivered: «lower»; the same again: «same»", statusVerdict("delivered", "sent").why === "lower" && statusVerdict("read", "read").why === "same");
  assert("a row with no status takes any Meta status", S.every((s) => statusVerdict(false, s).apply && statusVerdict("", s).why === "new"));
  assert("the gateway's own states are not overwritten (held, skipped, expired, queued, received)",
    ["held", "skipped", "expired", "queued", "received"].every((c) => S.every((s) => !statusVerdict(c, s).apply && statusVerdict(c, s).why === "not_meta_state")));
  assert("highestStatus: read over delivered over failed over sent; nothing → null",
    highestStatus(["sent", "delivered", "failed"]) === "delivered" && highestStatus(["failed", "read", "sent"]) === "read"
      && highestStatus(["sent", "failed"]) === "failed" && highestStatus(["x"]) === null);
  const n1 = JSON.parse(withIgnoredNote(JSON.stringify({ purpose: "p", template: "t" }), { status: "failed", over: "read" }));
  assert("the technical note keeps the row's JSON and adds ignored_statuses", n1.purpose === "p" && n1.template === "t" && n1.ignored_statuses?.[0]?.over === "read");
  const n2 = JSON.parse(withIgnoredNote("[text]", { status: "failed" }));
  assert("…a non-JSON payload is kept under «payload»", n2.payload === "[text]" && n2.ignored_statuses.length === 1);
  let p: string = "";
  for (let i = 0; i < 7; i++) p = withIgnoredNote(p, { i });
  assert("…the last five notes only", JSON.parse(p).ignored_statuses.length === 5 && JSON.parse(p).ignored_statuses[4].i === 6);
}

// ================================================================ 1. every order
console.log("\n[1] the webhook, every order: the highest status wins");
{
  const bad: string[] = [];
  for (const order of perms(["sent", "delivered", "read"])) {
    ENV = fresh();
    const w = await sendOne();
    for (const s of order) await status(w, s);
    if (waRow(w)?.x_status !== "read") bad.push(`${order.join("→")} = ${waRow(w)?.x_status}`);
  }
  assert("sent / delivered / read in all six orders → read", bad.length === 0, bad.join("; "));
  ENV = fresh();
  const w162 = await sendOne("🧪 كما #162");
  await status(w162, "delivered");
  await status(w162, "sent");
  assert("#162: «delivered» then «sent» in the same second → stays delivered", waRow(w162)?.x_status === "delivered", waRow(w162)?.x_status);
  const bad2: string[] = [];
  for (const order of perms(["sent", "delivered", "failed"])) {
    ENV = fresh();
    const w = await sendOne();
    for (const s of order) await status(w, s, s === "failed" ? FAIL(131026) : {});
    if (waRow(w)?.x_status !== "delivered") bad2.push(`${order.join("→")} = ${waRow(w)?.x_status}`);
  }
  assert("{sent, delivered, failed} in all six orders → delivered", bad2.length === 0, bad2.join("; "));
  const bad3: string[] = [];
  for (const order of perms(["sent", "failed"])) {
    ENV = fresh();
    const w = await sendOne();
    for (const s of order) await status(w, s, s === "failed" ? FAIL(131026) : {});
    if (waRow(w)?.x_status !== "failed") bad3.push(`${order.join("→")} = ${waRow(w)?.x_status}`);
  }
  assert("{sent, failed} in both orders → failed", bad3.length === 0, bad3.join("; "));
}

// ================================================================ 2. failed after delivered / read
console.log("\n[2] failed after delivered / read: not written, not acted on, noted");
for (const top of ["delivered", "read"]) {
  ENV = fresh();
  const w = await sendOne("وصلت ثم «فشلت»");
  await status(w, top);
  const rowsBefore = rows("x_wa_message").length;
  const alertsBefore = sentTo(OWNER).length;
  const linesBefore = failLines();
  const postsBefore = odooLog.filter((l) => l.method === "message_post").length;
  await status(w, "failed", FAIL(131047));
  const r = waRow(w);
  assert(`${top} → failed: the row stays «${top}»`, r?.x_status === top, r?.x_status);
  assert(`…x_meta_error not written`, !r?.x_meta_error);
  const note = JSON.parse(String(r?.x_debug_payload || "{}")).ignored_statuses?.[0];
  assert(`…the technical note in x_debug_payload (failed over ${top}, with Meta's error)`,
    note?.status === "failed" && note?.over === top && String(note?.error).includes("131047"), JSON.stringify(note));
  assert("…no «⚠️ ما انرسلت» line and no other Discuss line", failLines() === linesBefore && odooLog.filter((l) => l.method === "message_post").length === postsBefore);
  assert("…no alert to Baraa, no failure row", sentTo(OWNER).length === alertsBefore && rows("x_wa_message").length === rowsBefore);
  assert("…131047 did not close the window, nothing re-queued", (await readWindow(ENV, CUST_PHONE)).open === true && heldFor(ENV, CUST_PHONE).length === 0);
  assert("…no /health count", ((await readRecentSendFailures(ENV, 1))[0]?.count ?? 0) === 0);
  // another refusal code: no purpose block either
  const w2 = await sendOne("ثانية");
  await status(w2, top);
  await status(w2, "failed", FAIL(131026));
  assert("…131026 after it: the purpose is not blocked for 24h", !ENV.MSG_DEDUP.store.has(`wa_blk_p:v1:${CUST_PHONE}:collection_nothing`));
  const again = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "ثالثة", { purpose: "collection_nothing" } as any));
  assert("…and the next message of that purpose goes", again.ok);
}

// ================================================================ 3. failed over sent
console.log("\n[3] failed over sent: written and acted on (§ 33 as before)");
{
  ENV = fresh();
  const w = await sendOne("قُبلت ثم فشلت");
  await status(w, "sent");
  await status(w, "failed", FAIL(131026));
  const r = waRow(w);
  assert("sent → failed: the row is «failed» with Meta's error", r?.x_status === "failed" && String(r?.x_meta_error).includes("131026"));
  assert("…«⚠️ ما انرسلت» in the channel, and the purpose blocked 24h", failLines() === 1 && ENV.MSG_DEDUP.store.has(`wa_blk_p:v1:${CUST_PHONE}:collection_nothing`));
  assert("…counted on /health", ((await readRecentSendFailures(ENV, 1))[0]?.count ?? 0) === 1);
  ENV = fresh();
  const w2 = await sendOne("نافذة");
  await status(w2, "failed", FAIL(131047));
  assert("failed with no earlier status (131047): acted on — window closed, the row back to «held» (re-queued, § 33)",
    waRow(w2)?.x_status === "held" && (await readWindow(ENV, CUST_PHONE)).open === false && heldFor(ENV, CUST_PHONE).length === 1, waRow(w2)?.x_status);
  await status(w2, "sent");
  assert("…a late «sent» for the old wamid does not overwrite the re-queued row", waRow(w2)?.x_status === "held");
  ENV = fresh();
  const w3 = await sendOne("قالب لا يُعاد");
  await status(w3, "failed", FAIL(131026));
  await status(w3, "sent");
  assert("failed (131026), then a late «sent»: stays «failed»", waRow(w3)?.x_status === "failed");
}

// ================================================================ 4. delivered after failed
console.log("\n[4] delivered after failed: written, the channel says it went");
{
  ENV = fresh();
  const w = await sendOne("فشلت ثم وصلت");
  await status(w, "failed", FAIL(131026));
  const echoId = waRow(w)?.x_echo_message_id;
  await status(w, "delivered");
  const r = waRow(w);
  assert("failed → delivered: the row is «delivered»", r?.x_status === "delivered", r?.x_status);
  const reply = rows("mail.message").find((m: any) => m.parent_id === echoId && String(m.body).includes("✅ أُرسلت"));
  assert("…a «✅ أُرسلت» line under the message", !!echoId && !!reply, `echo=${echoId}`);
}

// ================================================================ 5. a held message's status line
console.log("\n[5] held → flushed → read: a later failed leaves its line alone");
{
  ENV = fresh();
  // Odoo's server action (the status line): edit the row's line in place
  const ACTION = seed("ir.actions.server", { name: "UTAK — سطر حالة رسالة واتساب" });
  let runs = 0;
  serverActions[ACTION] = (body: any) => {
    runs++;
    const row = table("x_wa_message").get(body.context.active_id) as any;
    const msg = table("mail.message").get(row?.x_echo_message_id) as any;
    if (msg) msg.body = String(msg.body).replace(/<p>⏳[^<]*<\/p>$/, `<p>✅ أُرسلت</p>`);
    return { infos: { utak_updated: msg ? 1 : 0 } };
  };
  ENV.MSG_DEDUP.store.delete(`wa_win:v1:${CUST_PHONE}`);
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "محفوظة ثم أُرسلت", { purpose: "collection_nothing" } as any));
  const heldRow = rows("x_wa_message").find((r: any) => r.x_status === "held") as any;
  assert("held: a row and a «⏳ محفوظة» line", !!heldRow?.x_echo_message_id);
  openWindow(ENV, CUST_PHONE, 1);
  await quiet(() => flushHeld(ENV, CUST_PHONE, { open: true } as any));
  const flushed = table("x_wa_message").get(heldRow.id) as any;
  const w = String(flushed?.x_meta_message_id || "");
  assert("…flushed: the same row «sent» with its wamid, the line «✅ أُرسلت»",
    flushed?.x_status === "sent" && w && String(table("mail.message").get(heldRow.x_echo_message_id)?.body).includes("✅ أُرسلت"));
  await status(w, "read");
  const runsBefore = runs;
  const postsBefore = odooLog.filter((l) => l.method === "message_post").length;
  const lineBefore = String(table("mail.message").get(heldRow.x_echo_message_id)?.body);
  await status(w, "failed", FAIL(131047));
  assert("…failed after read: the row stays «read»", (table("x_wa_message").get(heldRow.id) as any)?.x_status === "read");
  assert("…its status line untouched: no server action, no reply, same text",
    runs === runsBefore && odooLog.filter((l) => l.method === "message_post").length === postsBefore
      && String(table("mail.message").get(heldRow.x_echo_message_id)?.body) === lineBefore);
  assert("…not re-queued (131047 ignored)", heldFor(ENV, CUST_PHONE).length === 0);
}

// ================================================================ 6. the D1 status log
console.log("\n[6] the D1 status log");
{
  ENV = fresh();
  const w = await sendOne();
  await status(w, "delivered", { timestamp: "1790380000" });
  await status(w, "sent");
  await status(w, "read");
  await status(w, "read");
  await status(w, "failed", FAIL(131026));
  const mine = statusLog.filter((l) => l.wamid === w);
  assert("one line per call (5)", mine.length === 5, String(mine.length));
  assert("…verdicts: higher, lower, higher, same, failed_after_delivery",
    mine.map((l) => l.verdict).join(",") === "higher,lower,higher,same,failed_after_delivery", mine.map((l) => l.verdict).join(","));
  assert("…applied 1 only where written", mine.map((l) => l.applied).join("") === "10100");
  assert("…Meta's timestamp, the row id, the recipient, the error code",
    mine[0].meta_ts === 1790380000 && mine[0].row_id === waRow(w)?.id && mine[0].recipient === CUST_PHONE && mine[4].error_code === 131026);
  // a status for a wamid no row carries
  await status("wamid.NOROW", "delivered");
  assert("no row: logged «no_row», nothing written", statusLog.some((l) => l.wamid === "wamid.NOROW" && l.verdict === "no_row" && l.applied === 0));
  const alerts = sentTo(OWNER).length;
  await status("wamid.NOROW", "failed", FAIL(131047));
  assert("…a later failed for it: D1 says delivered → not acted on (no alert, no failure row, window open)",
    sentTo(OWNER).length === alerts && !rows("x_wa_message").some((r: any) => String(r.x_meta_error).includes("131047"))
      && (await readWindow(ENV, CUST_PHONE)).open === true
      && statusLog.some((l) => l.wamid === "wamid.NOROW" && l.status === "failed" && l.verdict === "failed_after_delivery"));
  // Meta's «delivered» before the send's row exists
  const next = `wamid.T${graph.length + 1}`;
  await status(next, "delivered");
  const w2 = await sendOne("سريعة");
  assert("a row created after its «delivered» starts at delivered (not «sent»)", w2 === next && waRow(w2)?.x_status === "delivered", `${w2} ${waRow(w2)?.x_status}`);
  // no D1 (prod): nothing breaks
  ENV = fresh();
  delete ENV.SIM_DB;
  const w3 = await sendOne();
  await status(w3, "read");
  await status(w3, "delivered");
  assert("no D1 (prod): the order still holds", waRow(w3)?.x_status === "read");
}

// ================================================================ 7. static
console.log("\n[7] static: every Meta status write goes through the order");
{
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const ms = src("wa-message-send.ts");
  const fn = ms.slice(ms.indexOf("export async function updateWaStatusByWamid"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert("updateWaStatusByWamid writes x_status only when statusVerdict applies",
    /statusVerdict\(previous, status\)/.test(body) && /if \(v\.apply\) \{\s*const vals[^}]*x_status: status/.test(body));
  const idx = src("index.ts");
  const loop = idx.slice(idx.indexOf("async function handleWebhook"), idx.indexOf("const messages = parseWebhook(payload);"));
  assert("the webhook's status loop: applyMetaStatus / handleStatusFailure, never updateWaStatusByWamid directly",
    /applyMetaStatus\(/.test(loop) && /handleStatusFailure\(/.test(loop) && !/updateWaStatusByWamid\(/.test(loop));
  const gw = src("wa-gateway.ts");
  const hsf = gw.slice(gw.indexOf("export async function handleStatusFailure"));
  assert("handleStatusFailure returns before acting when failed came after delivery",
    hsf.indexOf("if (over) {") > 0 && hsf.indexOf("if (over) {") < hsf.indexOf("await handleRejection("));
  const callers = ["index.ts", "wa-gateway.ts", "wa-status.ts", "wa-record.ts", "invoice.ts", "team.ts", "receipt.ts"]
    .filter((f) => /updateWaStatusByWamid\(env/.test(src(f)));
  assert("updateWaStatusByWamid is called from wa-status.ts and handleStatusFailure only", callers.sort().join(",") === "wa-gateway.ts,wa-status.ts", callers.join(","));
}

// ================================================================ 8. schema
console.log("\n[8] schema: every Odoo write names real fields");
assert("no write named a field or value the fixtures do not know", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failures:\n  " + failures.join("\n  ")); process.exit(1); }
