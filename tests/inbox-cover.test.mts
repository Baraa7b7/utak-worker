// Unit tests for the inbox cover (2026-09-20) — ingestInbound routing,
// phone-tail redaction, and echoOutbound auto-label prefix. Uses the same
// mini-runner style as wa-inbox.test.mts.
//
//   node --experimental-strip-types tests/inbox-cover.test.mts

import { ingestInbound, phoneTail } from "../src/wa-inbox.ts";

// ---------- fetch mock ----------
interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}
let captured: CapturedRequest[] = [];
type MockKey = string;
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

  const m = String(url).match(/\/json\/2\/([^/]+)\/([^/?]+)/);
  if (m) {
    const key = `${m[1]}.${m[2]}`;
    if (mockResponses.has(key)) {
      return new Response(JSON.stringify(mockResponses.get(key)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
  }
  const isCreate = String(url).endsWith("/create");
  const isSearchRead = String(url).endsWith("/search_read");
  const isRead = String(url).endsWith("/read");
  return new Response(JSON.stringify(isCreate ? [999] : isSearchRead ? [] : isRead ? [] : true), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}) as typeof globalThis.fetch;

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

console.log("inbox-cover tests\n");

// ============================================================
// 1. phoneTail
// ============================================================
console.log("[1] phoneTail");
assert("full E.164 → last 4", phoneTail("+966545816832") === "…6832");
assert("digits only", phoneTail("966545816832") === "…6832");
assert("empty → (none)", phoneTail("") === "(none)");
assert("undefined → (none)", phoneTail(undefined as any) === "(none)");
assert("non-digits stripped", phoneTail("(966) 545-816-832") === "…6832");
assert("short number", phoneTail("+12") === "…12");

// ============================================================
// 2. ingestInbound routing — priority team → supplier → customer → new
// ============================================================
console.log("\n[2] ingestInbound routing");

// Common mocks that satisfy mirrorInbound → ensureInboxChannel:
//   - partner.read returns an existing x_wa_channel_id so we don't create.
//   - res.users.search_read returns the admin partner so getBaraaPartnerId works.
function mockPartnerWithChannel(pid: number, channelId: number) {
  mockResponses.set("res.partner.read", [{
    id: pid, x_wa_channel_id: [channelId, `واتساب · #${pid}`],
  }]);
  mockResponses.set("res.users.search_read", [{ id: 2, partner_id: [7, "Baraa"] }]);
}

// 2a: team wins over supplier + customer
reset();
mockPartnerWithChannel(9, 19);
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_1", type: "text", text: "hi",
      from: "+966545816832", profileName: "Omar" },
    {
      team: { id: 9, name: "عمر المجهلي" },
      supplier: { id: 88, name: "مورد" },
      customer: { id: 77, name: "عميل" },
    },
  );
  assert("team match takes priority", r.route === "team" && r.partnerId === 9);
  assert("mirrored=true when everything succeeds", r.mirrored === true);
  assert("fromTail includes last 4", r.fromTail === "…6832");
}

// 2b: supplier when team missing
reset();
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_2", type: "text", text: "hi",
      from: "+966571777704", profileName: "Ahmed" },
    { team: null, supplier: { id: 30, name: "أحمد حسان" }, customer: null },
  );
  assert("supplier route when no team", r.route === "supplier" && r.partnerId === 30);
}

// 2c: customer when neither team nor supplier
reset();
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_3", type: "text", text: "hi",
      from: "+966536251307", profileName: "Test" },
    { team: null, supplier: null, customer: { id: 41, name: "ماجد" } },
  );
  assert("customer route", r.route === "customer" && r.partnerId === 41);
}

// 2d: owner short-circuits mirror
reset();
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_4", type: "text", text: "hi",
      from: "+966505154962", profileName: "Baraa" },
  );
  assert("owner returns route=owner", r.route === "owner");
  assert("owner mirrored=false with skip=owner",
    r.mirrored === false && r.skip === "owner");
  assert("owner has no partner id", r.partnerId === null);
}

// 2e: new-partner path when no match anywhere — creates via findOrCreateCustomer
reset();
mockResponses.set("res.partner.search_read", []);       // no existing customer
mockResponses.set("x_employee_role.search_read", [{ id: 5 }]); // customer role
mockResponses.set("res.partner.create", [1234]);        // new partner id
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_5", type: "text", text: "hi",
      from: "+966500001111", profileName: "Stranger" },
    { team: null, supplier: null, customer: null },
  );
  assert("no match → route=new", r.route === "new");
  assert("new partner created", r.partnerId === 1234);
}

// 2f: falls back to internal lookup if `looked` omitted
reset();
mockResponses.set("res.partner.search_read", []);       // all three searches empty
mockResponses.set("x_employee_role.search_read", [{ id: 5 }]);
mockResponses.set("res.partner.create", [5555]);
{
  const r = await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_6", type: "text", text: "hi",
      from: "+966500002222", profileName: "Stranger2" },
  );
  assert("internal lookups fire, creates partner", r.partnerId === 5555 && r.route === "new");
}

// ============================================================
// 3. ingestInbound source stamping (x_wa_message)
// ============================================================
console.log("\n[3] source stamping");
reset();
mockPartnerWithChannel(9, 19);
{
  await ingestInbound(
    makeEnv(),
    { partnerId: 0, partnerName: "", wamid: "wamid_7", type: "text", text: "hi",
      from: "+966545816832", profileName: "Omar" },
    { team: { id: 9, name: "عمر" }, supplier: null, customer: null },
  );
  const created = captured.filter(
    (c) => String(c.url).endsWith("/x_wa_message/create"),
  );
  assert("x_wa_message.create called once", created.length === 1);
  // deno-lint-ignore no-explicit-any
  const vals = (created[0]?.body as any)?.vals_list?.[0] ?? {};
  assert("x_source = 'inbound'", vals.x_source === "inbound");
  assert("x_direction = 'in'", vals.x_direction === "in");
  assert("x_meta_message_id set", vals.x_meta_message_id === "wamid_7");
  assert("x_partner_id = 9", vals.x_partner_id === 9);
}

// ============================================================
// 4. echoOutbound prepends 🤖 آلي prefix
// ============================================================
console.log("\n[4] auto label");
reset();
// res.partner.read returns the recipient's existing channel; second lookup is
// the bot partner search — same mock covers both.
mockResponses.set("res.partner.read", [{
  id: 30, x_wa_channel_id: [14, "واتساب · أحمد"],
}]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]); // UTAK بوت
{
  const { echoOutbound } = await import("../src/wa-inbox.ts");
  await echoOutbound(makeEnv(), 30, "أحمد", "مرحبا يا شريكنا");
  const created = captured.filter(
    (c) => String(c.url).endsWith("/mail.message/create"),
  );
  assert("mail.message.create called once", created.length === 1);
  // deno-lint-ignore no-explicit-any
  const vals = (created[0]?.body as any)?.vals_list?.[0] ?? {};
  const body = String(vals.body ?? "");
  assert("body includes 🤖 آلي prefix", body.includes("🤖 آلي"));
  assert("body includes original text", body.includes("مرحبا يا شريكنا"));
  assert("body uses green/left-border style",
    body.includes("border-left") && body.includes("#1E5A41"));
}

reset();
mockResponses.set("res.partner.read", [{
  id: 30, x_wa_channel_id: [14, "واتساب · أحمد"],
}]);
mockResponses.set("res.partner.search_read", [{ id: 42 }]);
{
  const { echoOutbound } = await import("../src/wa-inbox.ts");
  await echoOutbound(makeEnv(), 30, "أحمد", "التفاصيل", "customer_welcome");
  const created = captured.filter(
    (c) => String(c.url).endsWith("/mail.message/create"),
  );
  // deno-lint-ignore no-explicit-any
  const vals = (created[0]?.body as any)?.vals_list?.[0] ?? {};
  const body = String(vals.body ?? "");
  assert("template label rendered as '🤖 آلي · customer_welcome'",
    body.includes("🤖 آلي · customer_welcome"));
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
console.log("All inbox-cover tests passed.");
