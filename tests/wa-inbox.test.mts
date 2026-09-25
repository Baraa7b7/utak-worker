// Unit tests for src/wa-inbox.ts pure helpers + evaluateInboxReplyMessage
// under a mocked Odoo call layer.
//
// The Vitest-style style is a local mini-runner: no framework, no globals.
// A failure throws through and the process exits non-zero.
//
//   node --experimental-strip-types tests/wa-inbox.test.mts

import { htmlToText, textToHtml } from "../src/wa-inbox.ts";

// ---------- fetch mock ----------
interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}
let captured: CapturedRequest[] = [];
// Programmable per-call response by (model, method)
type MockKey = string; // `${model}.${method}`
const mockResponses = new Map<MockKey, unknown>();

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init: unknown) => {
  // deno-lint-ignore no-explicit-any
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  // deno-lint-ignore no-explicit-any
  const bodyText = (init as any)?.body ?? "";
  let body: unknown = null;
  try { body = typeof bodyText === "string" ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  captured.push({ url, method: (init as { method?: string })?.method ?? "GET", body });

  // Match /json/2/<model>/<method>
  const m = String(url).match(/\/json\/2\/([^/]+)\/([^/?]+)/);
  if (m) {
    const key = `${m[1]}.${m[2]}`;
    if (mockResponses.has(key)) {
      return new Response(JSON.stringify(mockResponses.get(key)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
  }
  // Default: return [] for search_read, true for write, [1] for create, [] otherwise
  const isCreate = String(url).endsWith("/create");
  const isSearchRead = String(url).endsWith("/search_read");
  const isRead = String(url).endsWith("/read");
  return new Response(JSON.stringify(isCreate ? [1] : isSearchRead ? [] : isRead ? [] : true), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}) as typeof globalThis.fetch;

// ---------- test infrastructure ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
    console.log(`  ✗ ${label}${detail ? " (" + detail + ")" : ""}`);
  }
}

function makeEnv(overrides: Record<string, string | undefined> = {}): any {
  return {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    OWNER_WHATSAPP: "+966505154962",
    META_ACCESS_TOKEN: "TEST_META",
    META_GRAPH_VERSION: "v20.0",
    MSG_DEDUP: {
      _store: new Map<string, string>(),
      async get(k: string) { return (this._store as Map<string, string>).get(k) ?? null; },
      async put(k: string, v: string) { (this._store as Map<string, string>).set(k, v); },
      async delete(k: string) { (this._store as Map<string, string>).delete(k); },
    },
    ...overrides,
  };
}

function reset() { captured = []; mockResponses.clear(); }

console.log("wa-inbox tests\n");

// ============================================================
// 1. htmlToText
// ============================================================
console.log("[1] htmlToText");
assert("empty → empty", htmlToText("") === "");
assert("plain <p>",
  htmlToText("<p>مرحبا يا صديقي</p>") === "مرحبا يا صديقي");
assert("<br> becomes newline",
  htmlToText("<p>سطر1<br/>سطر2</p>") === "سطر1\nسطر2");
assert("multiple <p> paragraphs preserved with double newline",
  htmlToText("<p>أول</p><p>ثاني</p>") === "أول\n\nثاني");
assert("entity decoding",
  htmlToText("<p>A &amp; B &lt;c&gt; &quot;x&quot; &#39;y&#39;</p>")
    === "A & B <c> \"x\" 'y'");
assert("&nbsp; becomes plain space",
  htmlToText("<p>a&nbsp;b</p>") === "a b");
assert("tags nested inside stripped",
  htmlToText("<p><strong>مهم</strong> جدا</p>") === "مهم جدا");
assert("blank tags collapsed",
  htmlToText("<p></p><p></p><p>نص</p>") === "نص");
assert("triple newlines collapsed to double",
  htmlToText("a<br/><br/><br/>b") === "a\n\nb");

// ============================================================
// 2. textToHtml (round-trip escape)
// ============================================================
console.log("\n[2] textToHtml");
assert("html-escapes &<>",
  textToHtml("A & B <c> >d>") === "<p>A &amp; B &lt;c&gt; &gt;d&gt;</p>");
assert("newlines become <br/>",
  textToHtml("سطر\nسطر2") === "<p>سطر<br/>سطر2</p>");
assert("empty gives <p></p>",
  textToHtml("") === "<p></p>");

// ============================================================
// 3. The 24h window — src/wa-window.ts (STATUS § 33). isInside24hWindow is
//    gone: it also read arrival times (x_message_analysis, the Discuss
//    mirror), so a message Meta re-delivered days late opened a window Meta
//    had closed. Now: Meta timestamps only, per number, 10-minute margin.
// ============================================================
console.log("\n[3] the 24h window — Meta timestamps only, per number, 10-minute margin");
const { parseMetaTimestampMs } = await import("../src/wa-inbox.ts");
const { readWindow, noteInbound, markWindowClosed, WINDOW_MARGIN_MS } = await import("../src/wa-window.ts");
const NUM = "+966500000100";
const now = Date.now();
const odooTs = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const recent = odooTs(now - 60 * 60 * 1000);
const old = odooTs(now - 48 * 60 * 60 * 1000);

// case 3a: nothing anywhere → closed
reset();
mockResponses.set("res.partner.search_read", [{ id: 100 }]);
mockResponses.set("x_wa_message.search_read", []);
{
  const w = await readWindow(makeEnv(), NUM);
  assert("no evidence anywhere → closed", w.open === false);
}

// case 3b: an inbound row with Meta's timestamp (x_processed_at) 1h ago → open
reset();
mockResponses.set("res.partner.search_read", [{ id: 100 }]);
mockResponses.set("x_wa_message.search_read", [{ x_processed_at: recent }]);
{
  const w = await readWindow(makeEnv(), NUM);
  assert("inbound x_processed_at (Meta) 1h ago → open", w.open === true && w.source === "odoo");
  const q = captured.find((c) => String(c.url).includes("/json/2/x_wa_message/search_read"));
  const dom = JSON.stringify((q?.body as { domain?: unknown })?.domain ?? []);
  assert("reads inbound rows with x_processed_at only", dom.includes("x_direction") && dom.includes("x_processed_at"), dom);
}

// case 3c: Meta's timestamp 48h ago → closed, however recent the row's arrival
reset();
mockResponses.set("res.partner.search_read", [{ id: 100 }]);
mockResponses.set("x_wa_message.search_read", [{ x_processed_at: old, create_date: recent }]);
{
  const w = await readWindow(makeEnv(), NUM);
  assert("Meta 48h ago, arrived 1h ago → closed (arrival never counts)", w.open === false);
}

// case 3d: only arrival-time evidence (classifier row, Discuss mirror) → closed, never queried
reset();
mockResponses.set("res.partner.search_read", [{ id: 100 }]);
mockResponses.set("x_wa_message.search_read", []);
mockResponses.set("x_message_analysis.search_read", [{ x_created_at: recent }]);
mockResponses.set("mail.message.search_read", [{ date: recent }]);
{
  const w = await readWindow(makeEnv(), NUM);
  assert("x_message_analysis / mail.message recent → still closed", w.open === false);
  const arrival = captured.filter((c) => String(c.url).includes("/x_message_analysis/") || String(c.url).includes("/mail.message/"));
  assert("arrival-time sources are not read at all", arrival.length === 0, `reads=${arrival.length}`);
}

// case 3e: KV (Meta timestamp) → open, Odoo not queried
reset();
{
  const env = makeEnv();
  await noteInbound(env, NUM, now - 2 * 60 * 60 * 1000, now);
  captured = [];
  const w = await readWindow(env, NUM);
  assert("KV recent → open", w.open === true && w.source === "kv");
  assert("KV hit short-circuits Odoo", captured.length === 0, `reads=${captured.length}`);
}

// case 3f: the 10-minute margin and the 24h edge
reset();
{
  const env = makeEnv();
  await noteInbound(env, "+966500000101", now - (24 * 60 - 15) * 60 * 1000, now); // 23h45m ago
  assert("23h45m ago → open", (await readWindow(env, "+966500000101")).open === true);
  await noteInbound(env, "+966500000102", now - (24 * 60 - 5) * 60 * 1000, now); // 23h55m ago
  assert("23h55m ago → closed (10-minute margin)", (await readWindow(env, "+966500000102")).open === false);
  assert("margin is 10 minutes", WINDOW_MARGIN_MS === 10 * 60 * 1000);
}

// case 3g: a message Meta stamped 25h ago (re-delivered late) does not open it
reset();
mockResponses.set("res.partner.search_read", [{ id: 100 }]);
mockResponses.set("x_wa_message.search_read", []);
{
  const env = makeEnv();
  const w = await noteInbound(env, NUM, now - 25 * 60 * 60 * 1000, now);
  assert("late inbound (25h by Meta) → closed", w.open === false);
  assert("… and nothing written for it", (await env.MSG_DEDUP.get("wa_win:v1:966500000100")) === null);
}

// case 3h: 131047 closes it at once; only a newer inbound reopens it
reset();
{
  const env = makeEnv();
  await noteInbound(env, NUM, now - 60 * 60 * 1000, now);
  await markWindowClosed(env, NUM, now);
  assert("131047 → closed at once", (await readWindow(env, NUM)).open === false);
  await noteInbound(env, NUM, now - 30 * 60 * 1000, now);
  assert("an inbound older than the refusal does not reopen", (await readWindow(env, NUM)).open === false);
  await noteInbound(env, NUM, now + 1000, now + 2000);
  assert("a newer inbound reopens", (await readWindow(env, NUM, now + 2000)).open === true);
}

// case 3i: parseMetaTimestampMs — pure helper for the timestamp gate
assert("parseMetaTimestampMs undefined → null", parseMetaTimestampMs(undefined) === null);
assert("parseMetaTimestampMs empty → null", parseMetaTimestampMs("") === null);
assert("parseMetaTimestampMs unix seconds → ms",
  parseMetaTimestampMs("1727280000") === 1727280000 * 1000);
assert("parseMetaTimestampMs already ms → passthrough",
  parseMetaTimestampMs(String(1727280000 * 1000)) === 1727280000 * 1000);
assert("parseMetaTimestampMs negative → null", parseMetaTimestampMs("-5") === null);
assert("parseMetaTimestampMs non-numeric → null", parseMetaTimestampMs("abc") === null);

// ============================================================
// 4. evaluateInboxReplyMessage — author gate
// ============================================================
console.log("\n[4] evaluateInboxReplyMessage — author gate + owner + allow");
const { evaluateInboxReplyMessage } = await import("../src/wa-inbox.ts");

function setBotPartnerLookup(id: number) {
  mockResponses.set("res.partner.search_read", [{ id }]);
}

// 4a: not on discuss.channel → skip
reset();
mockResponses.set("mail.message.read", [{
  id: 100, model: "res.partner", res_id: 3, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>hi</p>", attachment_ids: [],
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 100);
  assert("wrong model skipped", g.send === false && g.skip === "not on discuss.channel");
}

// 4b: not comment → skip
reset();
mockResponses.set("mail.message.read", [{
  id: 101, model: "discuss.channel", res_id: 10, message_type: "notification",
  author_id: [3, "baraa"], body: "<p>hi</p>", attachment_ids: [],
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 101);
  assert("non-comment skipped", g.send === false && g.skip === "not a comment");
}

// 4c: channel has no wa partner → skip
reset();
mockResponses.set("mail.message.read", [{
  id: 102, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>hi</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: false }]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 102);
  assert("channel without x_wa_partner_id skipped", g.send === false && g.skip === "channel has no wa partner");
}

// 4d: author is the bot → skip (loop prevention)
reset();
mockResponses.set("mail.message.read", [{
  id: 103, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [42, "UTAK بوت"], body: "<p>echo</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
setBotPartnerLookup(42); // getBotPartnerId(env) returns 42
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 103);
  assert("bot author skipped (loop prevention)", g.send === false && g.skip === "author is bot");
}

// 4e: author is the wa partner (inbound mirror echo) → skip
reset();
mockResponses.set("mail.message.read", [{
  id: 104, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [30, "أحمد"], body: "<p>hi from customer</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
setBotPartnerLookup(42);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 104);
  assert("wa-partner author skipped (inbound echo)",
    g.send === false && g.skip === "author is the wa partner (inbound echo)");
}

// 4f: author has no user (external contact) → skip
reset();
mockResponses.set("mail.message.read", [{
  id: 105, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [77, "some external"], body: "<p>hi</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
setBotPartnerLookup(42);
// For res.users.search_read → no rows (no internal user)
mockResponses.set("res.users.search_read", []);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 105);
  assert("author without internal user skipped",
    g.send === false && g.skip === "author has no internal user");
}

// 4g: owner-guard — partner phone matches OWNER_WHATSAPP
reset();
mockResponses.set("mail.message.read", [{
  id: 106, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>hi</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "OWNER"] }]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]); // bot lookup
mockResponses.set("res.users.search_read", [{ id: 2, share: false }]); // internal
mockResponses.set("res.partner.read", [{
  id: 30, name: "OWNER", phone: false, x_whatsapp_number: "+966505154962", x_wa_allowed: true,
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 106);
  assert("owner-guard blocks send",
    g.send === false && (g.skip ?? "").startsWith("owner-guard"));
}

// 4h: x_wa_allowed=false → refuse
reset();
mockResponses.set("mail.message.read", [{
  id: 107, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>hi</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]);
mockResponses.set("res.users.search_read", [{ id: 2, share: false }]);
mockResponses.set("res.partner.read", [{
  id: 30, name: "أحمد", phone: false, x_whatsapp_number: "+966536251307", x_wa_allowed: false,
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 107);
  assert("x_wa_allowed=false blocks", g.send === false && g.skip === "partner not whatsapp-allowed");
}

// 4i: happy path — send=true
reset();
mockResponses.set("mail.message.read", [{
  id: 108, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>هلا يا صديق</p>", attachment_ids: [],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]);
mockResponses.set("res.users.search_read", [{ id: 2, share: false }]);
mockResponses.set("res.partner.read", [{
  id: 30, name: "أحمد", phone: false, x_whatsapp_number: "+966536251307", x_wa_allowed: true,
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 108);
  assert("happy path send=true",
    g.send === true && g.channelId === 10 && g.partnerId === 30 &&
    g.body === "هلا يا صديق" && g.attachmentCount === 0);
}

// 4j: html body → text with newlines
reset();
mockResponses.set("mail.message.read", [{
  id: 109, model: "discuss.channel", res_id: 10, message_type: "comment",
  author_id: [3, "baraa"], body: "<p>سطر1<br/>سطر2</p><p>سطر3</p>", attachment_ids: [7],
}]);
mockResponses.set("discuss.channel.read", [{ id: 10, x_wa_partner_id: [30, "أحمد"] }]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]);
mockResponses.set("res.users.search_read", [{ id: 2, share: false }]);
mockResponses.set("res.partner.read", [{
  id: 30, name: "أحمد", phone: false, x_whatsapp_number: "+966536251307", x_wa_allowed: true,
}]);
{
  const g = await evaluateInboxReplyMessage(makeEnv(), 109);
  assert("html→text preserves newlines",
    g.send === true && g.body === "سطر1\nسطر2\n\nسطر3" && g.attachmentCount === 1);
}

// ============================================================
// Summary
// ============================================================
globalThis.fetch = originalFetch;
console.log("\n----------------------------------------");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("All wa-inbox tests passed.");
