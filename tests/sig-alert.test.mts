// Unit tests for the signature-failure alerting cover (2026-09-21).
//
// Runs under the same mini-runner pattern as the other tests in this
// directory. Verifies:
//   • classifySignatureFailure — pure classifier over the sig header.
//   • handleSignatureFailure — first-of-day alert + KV counter, debounced
//     for subsequent same-day failures, silent when the send layer throws.
//   • readRecentSignatureFailures — 7-day rollup for /health.
//   • verifySignature (from meta.ts) — valid HMAC accepts, invalid rejects,
//     missing header rejects (proves the /webhook route never reaches
//     handleSignatureFailure for a legitimate post).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//     tests/sig-alert.test.mts

import {
  classifySignatureFailure,
  handleSignatureFailure,
  readRecentSignatureFailures,
} from "../src/webhook-alert.ts";
import { verifySignature } from "../src/meta.ts";
import { riyadhDateKey } from "../src/hours.ts";
import { noteInbound } from "../src/wa-window.ts";

// 2026-09-25 (STATUS § 33) — the alert goes through the single send gateway:
// text inside Baraa's 24h window, held for his next message outside it. Most
// cases below open his window first (an inbound from him an hour ago).
const OWNER = "+966505154962";
async function ownerWindowOpen(env: any): Promise<void> {
  await noteInbound(env, OWNER, Date.now() - 60 * 60 * 1000);
}

// ---------- fetch mock ----------
interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}
let captured: CapturedRequest[] = [];
type FetchImpl = (input: unknown, init?: unknown) => Promise<Response> | Response;
let fetchImpl: FetchImpl = defaultFetch;
const originalFetch = globalThis.fetch;

function defaultFetch(input: unknown, init?: unknown): Response {
  // deno-lint-ignore no-explicit-any
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  // deno-lint-ignore no-explicit-any
  const rawBody = (init as any)?.body ?? "";
  let body: unknown = null;
  try {
    body = typeof rawBody === "string" ? JSON.parse(rawBody) : null;
  } catch {
    body = rawBody;
  }
  captured.push({
    url: String(url),
    method: (init as { method?: string })?.method ?? "GET",
    body,
  });

  // Graph messages endpoint → 200 + fake wamid.
  if (String(url).includes("graph.facebook.com")) {
    return new Response(
      JSON.stringify({
        messaging_product: "whatsapp",
        contacts: [{ input: "+966505154962", wa_id: "966505154962" }],
        messages: [{ id: "wamid.TEST" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Odoo JSON-2 endpoints (dispatchEcho path) → return empty arrays / true.
  const s = String(url);
  const isCreate = s.endsWith("/create");
  const isSearchRead = s.endsWith("/search_read");
  const isRead = s.endsWith("/read");
  return new Response(
    JSON.stringify(isCreate ? [999] : isSearchRead ? [] : isRead ? [] : true),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

globalThis.fetch = ((input: unknown, init?: unknown) =>
  Promise.resolve(fetchImpl(input, init))) as typeof globalThis.fetch;

function useFetch(fn: FetchImpl) {
  fetchImpl = fn;
}
function resetFetch() {
  fetchImpl = defaultFetch;
  captured = [];
}

// ---------- KV mock ----------
interface KvOpts {
  expirationTtl?: number;
}
class MockKV {
  store = new Map<string, { value: string; ttl?: number }>();
  failMode: "none" | "get" | "put" = "none";
  async get(key: string): Promise<string | null> {
    if (this.failMode === "get") throw new Error("kv-get-forced");
    return this.store.get(key)?.value ?? null;
  }
  async put(key: string, value: string, opts?: KvOpts): Promise<void> {
    if (this.failMode === "put") throw new Error("kv-put-forced");
    this.store.set(key, { value, ttl: opts?.expirationTtl });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(overrides: Record<string, unknown> = {}): {
  env: any;
  kv: MockKV;
} {
  const kv = new MockKV();
  const env: any = {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    OWNER_WHATSAPP: "+966505154962",
    META_APP_SECRET: "TEST_APP_SECRET",
    META_ACCESS_TOKEN: "TEST_META_TOKEN",
    META_PHONE_NUMBER_ID: "1351691708016803",
    META_GRAPH_VERSION: "v22.0",
    MSG_DEDUP: kv,
    // Deliberately no SIMULATION_MODE / PILOT_MODE / SIM_ALLOWLIST so
    // runtimeMode() lands on "prod" and the gateway takes the real-send path
    // (which our fetch mock intercepts). This is the failure mode that
    // matters most: the same path prod would take under the actual outage.
    ...overrides,
  };
  return { env, kv };
}

// ---------- log capture ----------
const logs: string[] = [];
const origWarn = console.warn;
const origLog = console.log;
console.warn = (...args: unknown[]) => {
  logs.push("[warn] " + args.map(String).join(" "));
};
// keep console.log for the runner itself, but capture too for assertions
console.log = (...args: unknown[]) => {
  logs.push("[log] " + args.map(String).join(" "));
  origLog.apply(console, args as unknown[]);
};
function resetLogs() {
  logs.length = 0;
}
function findLog(prefix: string): string | undefined {
  return logs.find((l) => l.includes(prefix));
}

// ---------- runner ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    origLog(`  ✗ ${label}${detail ? " (" + detail + ")" : ""}`);
  }
}

// ---------- helpers ----------
async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function graphCalls(): CapturedRequest[] {
  return captured.filter((c) => c.url.includes("graph.facebook.com"));
}

// ============================================================
// [1] classifySignatureFailure
// ============================================================
origLog("sig-alert tests\n");
origLog("[1] classifySignatureFailure");
assert("null header → missing_header", classifySignatureFailure(null) === "missing_header");
assert("empty header → missing_header", classifySignatureFailure("") === "missing_header");
assert(
  "no sha256= prefix → bad_prefix",
  classifySignatureFailure("md5=abcd") === "bad_prefix",
);
assert(
  "sha256= prefix but wrong body → hmac_mismatch",
  classifySignatureFailure("sha256=deadbeef") === "hmac_mismatch",
);

// ============================================================
// [2] handleSignatureFailure — first + second failure same day
// ============================================================
origLog("\n[2] first + second failure same day");
{
  resetFetch();
  resetLogs();
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-21T10:00:00Z");
  const dateKey = riyadhDateKey(now);
  await ownerWindowOpen(env);

  await handleSignatureFailure(env, {
    rawBodyLength: 512,
    signatureHeader: "sha256=deadbeef1234567890",
    now,
  });

  assert(
    "counter incremented to 1",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.value === "1",
  );
  assert(
    "counter TTL is 7 days",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.ttl === 7 * 24 * 60 * 60,
  );
  assert(
    "debounce marker written",
    kv.store.get(`wa_sig_fail_alert:${dateKey}`)?.value === "1",
  );
  assert(
    "debounce marker TTL is 24h",
    kv.store.get(`wa_sig_fail_alert:${dateKey}`)?.ttl === 24 * 60 * 60,
  );
  const g1 = graphCalls();
  assert("exactly one Meta Graph POST", g1.length === 1, `got ${g1.length}`);
  assert(
    "Graph POST is a text message",
    g1[0] && (g1[0].body as any)?.type === "text",
  );
  assert(
    "Graph POST is addressed to OWNER_WHATSAPP (digits only)",
    g1[0] && (g1[0].body as any)?.to === "966505154962",
  );
  const alertBody = String((g1[0]?.body as any)?.text?.body ?? "");
  assert(
    "alert body mentions webhook rejection",
    alertBody.includes("رفض توقيع webhook"),
  );
  assert(
    "alert body mentions the failure count of the day",
    alertBody.includes("1"),
  );
  assert(
    "sig prefix log line printed with first 8 chars only",
    !!findLog("sig_prefix=deadbeef"),
  );
  assert(
    "log does not leak the app secret",
    !logs.some((l) => l.includes("TEST_APP_SECRET")),
  );

  // Second failure the same day — counter goes to 2, no new Graph POST.
  await handleSignatureFailure(env, {
    rawBodyLength: 512,
    signatureHeader: "sha256=deadbeef1234567890",
    now,
  });
  assert(
    "counter incremented to 2",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.value === "2",
  );
  const g2 = graphCalls();
  assert(
    "still exactly one Meta Graph POST — second alert debounced",
    g2.length === 1,
    `got ${g2.length}`,
  );
}

// ============================================================
// [2b] Baraa outside his 24h window — held for him, nothing sent now
// ============================================================
origLog("\n[2b] owner outside the 24h window — the alert waits in his queue");
{
  resetFetch();
  resetLogs();
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-21T11:00:00Z");
  await handleSignatureFailure(env, { rawBodyLength: 64, signatureHeader: "sha256=deadbeef1234567890", now });
  assert("no Graph POST outside the window", graphCalls().length === 0, `got ${graphCalls().length}`);
  const q = JSON.parse(kv.store.get("wa_q:v1:966505154962")?.value ?? "[]");
  assert("the alert is held in his queue", q.length === 1 && String(q[0]?.body?.text?.body ?? "").includes("رفض توقيع webhook"));
  assert("no template for it (utak_owner_alert is MARKETING)", !captured.some((c) => JSON.stringify(c.body ?? "").includes("utak_owner_alert")));
}

// ============================================================
// [3] missing header treated as failure
// ============================================================
origLog("\n[3] missing x-hub-signature-256 header");
{
  resetFetch();
  resetLogs();
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-22T10:00:00Z");
  const dateKey = riyadhDateKey(now);
  await ownerWindowOpen(env);

  await handleSignatureFailure(env, {
    rawBodyLength: 128,
    signatureHeader: null,
    now,
  });

  assert(
    "counter incremented to 1 despite missing header",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.value === "1",
  );
  assert(
    "log line records has_header=false",
    !!findLog("has_header=false"),
  );
  assert(
    "log line records sig_prefix=(none)",
    !!findLog("sig_prefix=(none)"),
  );
  assert("still fired the daily alert", graphCalls().length === 1);
}

// ============================================================
// [4] alert send throws — must not throw, must not undo counter
// ============================================================
origLog("\n[4] alert send throws");
{
  resetFetch();
  resetLogs();
  useFetch(() => {
    throw new Error("simulated-meta-network-drop");
  });
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-23T10:00:00Z");
  const dateKey = riyadhDateKey(now);
  await ownerWindowOpen(env);

  let threw = false;
  try {
    await handleSignatureFailure(env, {
      rawBodyLength: 256,
      signatureHeader: "sha256=abcdef1234567890",
      now,
    });
  } catch {
    threw = true;
  }
  assert("handleSignatureFailure did not throw", threw === false);
  assert(
    "counter still recorded before the send failed",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.value === "1",
  );
  assert(
    "debounce marker still recorded (alert slot claimed)",
    kv.store.get(`wa_sig_fail_alert:${dateKey}`)?.value === "1",
  );
  assert(
    "warn log line captured the send failure",
    !!findLog("alert dispatch threw") ||
      !!findLog("simulated-meta-network-drop"),
  );
  resetFetch();
}

// ============================================================
// [5] Meta returns non-2xx (e.g. 24h window closed) — silent, no throw
// ============================================================
origLog("\n[5] Meta returns non-2xx (24h window closed)");
{
  resetFetch();
  resetLogs();
  useFetch((input) => {
    const url = String(input);
    if (url.includes("graph.facebook.com")) {
      captured.push({ url, method: "POST", body: null });
      return new Response(
        JSON.stringify({
          error: {
            code: 131047,
            message: "Message failed to send because more than 24 hours",
            type: "OAuthException",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return defaultFetch(input);
  });
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-24T10:00:00Z");
  const dateKey = riyadhDateKey(now);
  await ownerWindowOpen(env);

  let threw = false;
  try {
    await handleSignatureFailure(env, {
      rawBodyLength: 64,
      signatureHeader: "sha256=abcdef1234567890",
      now,
    });
  } catch {
    threw = true;
  }
  assert("handleSignatureFailure did not throw", threw === false);
  assert(
    "counter still incremented",
    kv.store.get(`wa_sig_fail:${dateKey}`)?.value === "1",
  );
  assert(
    "warn log line captured Meta rejection",
    !!findLog("[meta] send failed status=400 code=131047"),
  );
  // STATUS § 33 — 131047: his window is marked closed, the alert waits for him.
  const win = JSON.parse(kv.store.get("wa_win:v1:966505154962")?.value ?? "{}");
  assert("131047 marks the owner's window closed", Number(win.closed) > 0);
  const q = JSON.parse(kv.store.get("wa_q:v1:966505154962")?.value ?? "[]");
  assert("the alert goes back to his queue, once", q.length === 1 && q[0]?.attempts === 1);
  assert("one Graph POST only — no retry", graphCalls().length === 1, `got ${graphCalls().length}`);
  resetFetch();
}

// ============================================================
// [6] readRecentSignatureFailures
// ============================================================
origLog("\n[6] readRecentSignatureFailures");
{
  resetFetch();
  resetLogs();
  const { env, kv } = makeEnv();
  const now = new Date("2026-09-25T10:00:00Z");
  const today = riyadhDateKey(now);
  const yesterday = riyadhDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  await kv.put(`wa_sig_fail:${today}`, "3");
  await kv.put(`wa_sig_fail:${yesterday}`, "5");

  const rows = await readRecentSignatureFailures(env, 7, now);
  assert("returns 7 rows", rows.length === 7);
  assert("today count reflects KV", rows.find((r) => r.date === today)?.count === 3);
  assert(
    "yesterday count reflects KV",
    rows.find((r) => r.date === yesterday)?.count === 5,
  );
  const total = rows.reduce((a, b) => a + b.count, 0);
  assert("7-day total is 8", total === 8);
}

// ============================================================
// [7] verifySignature — proves valid signatures never reach the alert path
// ============================================================
origLog("\n[7] verifySignature (control: valid signatures do not alert)");
{
  const secret = "TEST_APP_SECRET";
  const env = { META_APP_SECRET: secret } as any;
  const body = JSON.stringify({ entry: [{ id: "1" }] });
  const good = "sha256=" + (await hmacSha256Hex(secret, body));

  const okValid = await verifySignature(body, good, env);
  assert("valid hmac → verifySignature true", okValid === true);

  const okBad = await verifySignature(body, "sha256=" + "0".repeat(64), env);
  assert("invalid hmac → verifySignature false", okBad === false);

  const okNoHeader = await verifySignature(body, null, env);
  assert("null header → verifySignature false", okNoHeader === false);

  const okBadPrefix = await verifySignature(body, "md5=abcd", env);
  assert("wrong prefix → verifySignature false", okBadPrefix === false);
}

// ============================================================
// wrap-up
// ============================================================
console.log = origLog;
console.warn = origWarn;
globalThis.fetch = originalFetch;

origLog(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  origLog("\nFailures:");
  for (const f of failures) origLog(`  - ${f}`);
  process.exit(1);
}
