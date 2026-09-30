// Unit tests for src/odoo.ts::call retry policy (2026-09-23).
//   1. 429 then 200 → success after one retry, Retry-After honoured
//   2. 503 on every attempt → 1 + ODOO_MAX_RETRIES requests, then throws,
//      one owner alert naming the operation and the record
//   3. 400 / 404 / 422 (UserError — posting refused) → no retry, no alert
//   4. create with probe: 504 then probe finds the record → returned, NOT
//      created again (1 create request)
//   5. create with probe: 502 then probe empty → create re-sent once
//   6. create WITHOUT probe on 502 → not retried (would risk a duplicate)
//   7. create on 429 → retried (rate limiter answered, Odoo never ran it)
//   8. network error on a read → retried
//   9. action_post on 500 → not retried
//  10. probe-create exhausted → final probe adopts a late commit; if still
//      empty → alert + throw
//  11. alert throttled per model.method; parseRetryAfter / backoffMs bounds
//
// Same no-framework style as tests/vat.test.mts.

import {
  call,
  ODOO_MAX_RETRIES,
  backoffMs,
  parseRetryAfter,
  retryDecision,
  setOdooRetryHooksForTests,
} from "../src/odoo.ts";

interface Req { url: string; body: any }
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";
let captured: Req[] = [];
let script: Array<(r: Req) => Reply> = [];
let fallback: (r: Req) => Reply = () => ({ status: 200, body: true });
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED WhatsApp in odoo-retry.test");
  let body: any = null;
  try { body = JSON.parse(init?.body ?? ""); } catch { body = null; }
  const req = { url, body };
  captured.push(req);
  const next = script.length ? script.shift()! : fallback;
  const r = next(req);
  if (r === "network") throw new TypeError("fetch failed");
  return new Response(JSON.stringify(r.body ?? null), {
    status: r.status,
    headers: { "Content-Type": "application/json", ...(r.headers ?? {}) },
  });
}) as typeof globalThis.fetch;

const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com",
  ODOO_DB: "utakfresh",
  ODOO_LOGIN: "admin@utakfresh.com",
  ODOO_API_KEY: "TEST_KEY",
};

let sleeps: number[] = [];
let alerts: string[] = [];
function reset(): void {
  captured = []; script = []; fallback = () => ({ status: 200, body: true });
  sleeps = []; alerts = [];
  setOdooRetryHooksForTests({
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    alert: async (_e, text) => { alerts.push(text); },
  });
}
const hits = (suffix: string) => captured.filter((c) => c.url.endsWith(suffix));

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(detail ? `${label} — ${detail}` : label); console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`); }
}
async function rejects(p: Promise<unknown>): Promise<Error | null> {
  try { await p; return null; } catch (e) { return e as Error; }
}
const userError = { name: "odoo.exceptions.UserError", message: "Please set the Invoice Date to be either less than or equal to today as per the Asia/Riyadh time zone" };

console.log("1. 429 then 200 → success, Retry-After honoured");
reset();
script = [() => ({ status: 429, headers: { "Retry-After": "2" } }), () => ({ status: 200, body: [{ id: 1 }] })];
{
  const r = await call<any[]>(env, "res.partner", "search_read", { domain: [], fields: ["id"] });
  assert("result returned", r?.[0]?.id === 1);
  assert("2 requests", captured.length === 2, String(captured.length));
  assert("slept Retry-After 2000ms", sleeps.length === 1 && sleeps[0] === 2000, JSON.stringify(sleeps));
  assert("no alert", alerts.length === 0);
}

console.log("2. 503 every time → exhausted, alert, throw");
reset();
fallback = () => ({ status: 503, body: "Service Unavailable" });
{
  const e = await rejects(call(env, "x_invoice", "search_read", { domain: [["id", "=", 5]], fields: ["id"] }));
  assert("throws", !!e);
  assert(`1 + ${ODOO_MAX_RETRIES} requests`, captured.length === 1 + ODOO_MAX_RETRIES, String(captured.length));
  assert("backoff grows", sleeps.length === 3 && sleeps[0] < sleeps[1] && sleeps[1] < sleeps[2], JSON.stringify(sleeps));
  assert("one alert", alerts.length === 1, String(alerts.length));
  assert("alert names the operation", alerts[0]?.includes("x_invoice.search_read"));
  assert("alert names the record", alerts[0]?.includes("[\"id\",\"=\",5]"), alerts[0]);
}

console.log("3. 400 / 404 / 422 → no retry, no alert");
for (const [status, body] of [[400, { name: "BadRequest" }], [404, "not found"], [403, { name: "odoo.exceptions.AccessError", message: "no" }], [422, userError]] as const) {
  reset();
  script = [() => ({ status, body })];
  const e = await rejects(call(env, "account.move", "action_post", { ids: [9] }));
  assert(`${status}: throws`, !!e);
  assert(`${status}: 1 request`, captured.length === 1, String(captured.length));
  assert(`${status}: no alert`, alerts.length === 0);
}
{
  reset();
  script = [() => ({ status: 422, body: userError })];
  const e = await rejects(call(env, "account.move", "action_post", { ids: [9] }));
  assert("422 message carries the Odoo exception name", !!e?.message.includes("odoo.exceptions.UserError"), e?.message);
  // a 5xx whose body names an odoo exception is a logic error too
  reset();
  script = [() => ({ status: 500, body: { name: "odoo.exceptions.ValidationError", message: "bad" } })];
  await rejects(call(env, "res.partner", "search_read", { domain: [] }));
  assert("5xx with odoo.exceptions.* body → no retry", captured.length === 1, String(captured.length));
}

console.log("4. create + probe: 504, probe finds record → adopted, no second create");
reset();
script = [
  () => ({ status: 504, body: "Gateway Timeout" }),                  // create — may have committed
  (r) => ({ status: 200, body: r.url.endsWith("/search") ? [77] : null }), // probe
];
{
  const probe = [["origin", "=", "x_daily_order/1"], ["state", "=", "draft"]];
  const ids = await call<number[]>(env, "sale.order", "create", { vals_list: [{ origin: "x_daily_order/1" }] }, { probe });
  assert("returns the probed id", ids?.[0] === 77, JSON.stringify(ids));
  assert("exactly 1 create request", hits("/sale.order/create").length === 1, String(hits("/sale.order/create").length));
  assert("probe searched with the given domain", JSON.stringify(hits("/sale.order/search")[0]?.body?.domain) === JSON.stringify(probe));
  assert("no alert", alerts.length === 0);
}

console.log("5. create + probe: 502, probe empty → re-sent once");
reset();
script = [
  () => ({ status: 502 }),
  () => ({ status: 200, body: [] }),       // probe: nothing committed
  () => ({ status: 200, body: [88] }),     // create again
];
{
  const ids = await call<number[]>(env, "account.move", "create", { vals_list: [{ ref: "INV-X" }] }, { probe: [["ref", "=", "INV-X"]] });
  assert("returns new id", ids?.[0] === 88, JSON.stringify(ids));
  assert("2 create requests", hits("/account.move/create").length === 2);
  assert("1 probe", hits("/account.move/search").length === 1);
}

console.log("6. create WITHOUT probe on 502 → not retried");
reset();
script = [() => ({ status: 502 })];
{
  const e = await rejects(call(env, "x_daily_order", "create", { vals_list: [{}] }));
  assert("throws", !!e);
  assert("1 create request", hits("/x_daily_order/create").length === 1);
  assert("no alert (not a retry exhaustion)", alerts.length === 0);
}

console.log("7. create on 429 → retried (never reached Odoo)");
reset();
script = [() => ({ status: 429 }), () => ({ status: 200, body: [5] })];
{
  const ids = await call<number[]>(env, "x_payment", "create", { vals_list: [{}] });
  assert("returns id", ids?.[0] === 5);
  assert("2 create requests, no probe", hits("/x_payment/create").length === 2 && captured.length === 2);
}

console.log("8. network error on a read → retried");
reset();
script = [() => "network", () => ({ status: 200, body: 3 })];
{
  const n = await call<number>(env, "res.partner", "search_count", { domain: [] });
  assert("result after network retry", n === 3);
}

console.log("9. action_post on 500 → not retried");
reset();
script = [() => ({ status: 500, body: "Internal Server Error" })];
{
  const e = await rejects(call(env, "account.move", "action_post", { ids: [3] }));
  assert("throws", !!e);
  assert("1 request", captured.length === 1);
}
{
  reset();
  script = [() => ({ status: 500 }), () => ({ status: 200, body: [1] })];
  await call(env, "account.payment.register", "create", { vals_list: [{}] });
  assert("wizard create (transient) on 500 → retried", hits("/account.payment.register/create").length === 2);
  reset();
  script = [() => ({ status: 502 }), () => ({ status: 200, body: true })];
  await call(env, "x_invoice", "write", { ids: [1], vals: { x_status: "paid" } });
  assert("write on 502 → retried (idempotent)", hits("/x_invoice/write").length === 2);
}

console.log("10. probe-create exhausted");
reset();
{
  let creates = 0;
  fallback = (r) => {
    if (r.url.endsWith("/create")) { creates++; return { status: 502 }; }
    return { status: 200, body: creates > ODOO_MAX_RETRIES ? [99] : [] }; // commit lands only after the last try
  };
  const ids = await call<number[]>(env, "purchase.order", "create", { vals_list: [{}] }, { probe: [["origin", "=", "x_purchase_list/1"]] });
  assert("final probe adopts late commit", ids?.[0] === 99, JSON.stringify(ids));
  assert(`${1 + ODOO_MAX_RETRIES} creates`, creates === 1 + ODOO_MAX_RETRIES, String(creates));
  assert("no alert when adopted", alerts.length === 0);
}
reset();
{
  fallback = (r) => r.url.endsWith("/create") ? { status: 502 } : { status: 200, body: [] };
  const e = await rejects(call(env, "purchase.order", "create", { vals_list: [{ origin: "x_purchase_list/2" }] }, { probe: [["origin", "=", "x_purchase_list/2"]] }));
  assert("throws when never found", !!e);
  assert("one alert with the operation", alerts.length === 1 && alerts[0].includes("purchase.order.create"), alerts[0]);
  assert("probes after every failure", hits("/purchase.order/search").length === 1 + ODOO_MAX_RETRIES);
  const p2 = await call<number[]>(env, "purchase.order", "search", { domain: [] }).catch(() => null);
  assert("(sanity) search still works", Array.isArray(p2));
}

console.log("11. throttle + helpers");
reset();
fallback = () => ({ status: 503 });
await rejects(call(env, "x_route", "search_read", { domain: [] }));
await rejects(call(env, "x_route", "search_read", { domain: [] }));
assert("second exhaustion within 10 min → no second alert", alerts.length === 1, String(alerts.length));
assert("parseRetryAfter seconds", parseRetryAfter("3") === 3000);
assert("parseRetryAfter capped at 15 s", parseRetryAfter("600") === 15000);
assert("parseRetryAfter date", parseRetryAfter(new Date(Date.parse("2026-09-23T10:00:05Z")).toUTCString(), Date.parse("2026-09-23T10:00:00Z")) === 5000);
assert("parseRetryAfter garbage → null", parseRetryAfter("soon") === null);
assert("backoff attempt 0 in 500–1000", backoffMs(0, () => 0) === 500 && backoffMs(0, () => 1) === 1000);
assert("backoff attempt 2 in 2000–4000", backoffMs(2, () => 0) === 2000 && backoffMs(2, () => 1) === 4000);
assert("decision: 422 → no", retryDecision("account.move", "action_post", { kind: "http", status: 422 }, false) === "no");
assert("decision: create 429 → retry", retryDecision("account.move", "create", { kind: "http", status: 429 }, false) === "retry");
assert("decision: create 504 + probe → probe-then-retry", retryDecision("account.move", "create", { kind: "http", status: 504 }, true) === "probe-then-retry");
assert("decision: unlink network → no", retryDecision("x_invoice", "unlink", { kind: "network" }, false) === "no");

setOdooRetryHooksForTests(null);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
