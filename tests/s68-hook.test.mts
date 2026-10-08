// § 68 أ (2026-10-08) — the token of Odoo's buttons is its own secret (src/hook-auth.ts).
//
//   [أ1] the secret: unset, too short, or equal to the Odoo API key → nothing is accepted
//   [أ2] a token: the secret opens, anything else does not — the Odoo API key among them
//   [أ3] PHASE 3: the token of before is refused, whatever the worker still holds (phase 1 — accepted for under
//        thirty minutes while Odoo's 24 actions were rewritten — is commit 390c83c and its tests)
//   [أ4] every route of Odoo's buttons is behind it: a wrong token, no token and the Odoo key get 401
//   [أ5] «does this URL pass?» (probe=1): the token alone is checked, nothing runs
//   [أ6] the worker compares what arrives with the hook secret alone, and no token reaches a log
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s68-hook.test.mts

import { readFileSync, readdirSync } from "node:fs";
import { OWNER, ctx, graph, odooLog, openWindow, quiet } from "./wa-harness.mts";
import { DAY, assert, done, fresh } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
const HA = await import("../src/hook-auth.ts");

const SECRET = "s68-hook-secret-0123456789abcdef0123456789abcdef";
const BEFORE = "the-token-of-before-which-was-the-odoo-api-key";
const KEY = BEFORE; // until § 68 the two were one value
const MIN = 60_000;
const INDEX = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
/** Every route the hook secret gates, as the worker's source names them. */
const ROUTES = [...new Set([...INDEX.matchAll(/url\.pathname === "(\/odoo\/hook\/[a-z0-9-]+)"/g)].map((m) => m[1])), "/internal/quotation-wa-send", "/internal/sale-quotation-wa-send"];
/** The tenant's world at 12:00; `before` / `until`: what phase 1 put on the worker (its secret of before, its window). */
function world(o: { secret?: string | null; before?: string | null; until?: number | null } = {}): any {
  const env = fresh(`${DAY} 12:00`);
  env.ODOO_API_KEY = KEY;
  if (o.secret !== null) env.HOOK_SECRET = o.secret ?? SECRET;
  if (o.before) env.ODOO_HOOK_TOKEN = o.before;
  if (o.until) env.HOOK_LEGACY_UNTIL = String(o.until);
  return env;
}
const post = (env: any, path: string, query: string) => quiet(() => worker.fetch(new Request(`https://w.test${path}${query}`, { method: "POST", body: "{}" }), env, ctx));
const status = async (env: any, path: string, query: string) => (await post(env, path, query)).status;

// ================================================================ أ1
console.log("\n[أ1] the secret");
{
  const e = (o: Record<string, unknown>) => ({ ODOO_API_KEY: KEY, ...o }) as any;
  assert("set, long enough, not the Odoo key: it is the secret", HA.hookSecret(e({ HOOK_SECRET: SECRET })) === SECRET);
  assert("not set: no secret", HA.hookSecret(e({})) === "" && HA.hookSecret(e({ HOOK_SECRET: "" })) === "");
  assert(`shorter than ${HA.HOOK_SECRET_MIN} characters: no secret`, HA.hookSecret(e({ HOOK_SECRET: "x".repeat(HA.HOOK_SECRET_MIN - 1) })) === "" && HA.hookSecret(e({ HOOK_SECRET: "x".repeat(HA.HOOK_SECRET_MIN) })) !== "");
  assert("equal to the Odoo API key: no secret (the two are never one again)", HA.hookSecret(e({ HOOK_SECRET: KEY })) === "" && KEY.length >= HA.HOOK_SECRET_MIN);
  assert("the routes it gates: every /odoo/hook/*, and the two sends of the quotation buttons — not the other /internal routes", HA.isHookGated("/odoo/hook/prices") && HA.isHookGated("/internal/quotation-wa-send") && HA.isHookGated("/internal/sale-quotation-wa-send") && !HA.isHookGated("/internal/quotation-issue") && !HA.isHookGated("/internal/invoice-pdf") && !HA.isHookGated("/webhook") && !HA.isHookGated("/odoo/hookx"));
}

// ================================================================ أ2
console.log("\n[أ2] a token");
{
  const env = world();
  assert("the secret opens", HA.hookTokenOk(env, SECRET));
  assert("a wrong token, an empty one, the secret cut short or made longer: refused", !HA.hookTokenOk(env, "nope") && !HA.hookTokenOk(env, "") && !HA.hookTokenOk(env, SECRET.slice(0, -1)) && !HA.hookTokenOk(env, SECRET + "x"));
  assert("a token of the secret's own length that differs in one character: refused", !HA.hookTokenOk(env, SECRET.slice(0, -1) + "X") && !HA.hookTokenOk(env, "X" + SECRET.slice(1)) && !HA.tokensEqual("abc", "abd") && HA.tokensEqual("abc", "abc"));
  assert("the Odoo API key is not a token", !HA.hookTokenOk(env, KEY));
  const none = world({ secret: null });
  assert("a worker without its secret accepts nothing — not the empty token either", !HA.hookTokenOk(none, "") && !HA.hookTokenOk(none, SECRET) && !HA.hookTokenOk(none, "undefined"));
  const same = world({ secret: KEY });
  assert("a worker whose hook secret IS the Odoo key accepts nothing — not that value either", !HA.hookTokenOk(same, KEY) && !HA.hookTokenOk(same, ""));
  assert("…on the routes: 401 with the «right» token", (await status(same, "/odoo/hook/s67-trial", `?token=${KEY}&op=state`)) === 401);
  const short = world({ secret: "short-secret" });
  assert("a short secret opens nothing", !HA.hookTokenOk(short, "short-secret") && (await status(short, "/odoo/hook/s67-trial", "?token=short-secret&op=state")) === 401);
}

// ================================================================ أ3
console.log("\n[أ3] PHASE 3 — the token of before is refused");
{
  const now = Date.now();
  // the worker as phase 1 left it: the secret of before still on it, and a window that would be open
  const left = world({ before: BEFORE, until: now + 20 * MIN });
  assert("refused, even with phase 1's secret and its window still on the worker", !HA.hookTokenOk(left, BEFORE) && (await status(left, "/odoo/hook/prices", `?probe=1&token=${BEFORE}`)) === 401 && (await status(left, "/odoo/hook/s67-trial", `?token=${BEFORE}&op=state`)) === 401);
  assert("…and the new one opens", HA.hookTokenOk(left, SECRET) && (await status(left, "/odoo/hook/prices", `?probe=1&token=${SECRET}`)) === 200);
  const only = world({ secret: null, before: BEFORE, until: now + 20 * MIN });
  assert("a worker that holds the secret of before ALONE accepts nothing", !HA.hookTokenOk(only, BEFORE) && !HA.hookTokenOk(only, "") && (await status(only, "/odoo/hook/prices", `?probe=1&token=${BEFORE}`)) === 401);
  const SRC = new URL("../src/", import.meta.url);
  const reads = readdirSync(SRC).filter((f) => f.endsWith(".ts")).filter((f) => /ODOO_HOOK_TOKEN|HOOK_LEGACY_UNTIL/.test(readFileSync(new URL(f, SRC), "utf8").replace(/\/\/.*$/gm, "")));
  assert("nothing in the worker reads the secret of before, or a window for it", reads.length === 0, reads.join(", "));
  assert("the hook's check has no window left in it", !("legacyWindowOpen" in HA) && !("LEGACY_WINDOW_MS" in HA) && HA.hookTokenOk.length === 2);
}

// ================================================================ أ4
console.log("\n[أ4] every route of Odoo's buttons");
{
  const env = world();
  assert(`the worker's source names ${ROUTES.length} gated routes (the 24 Odoo actions call 11 of them)`, ROUTES.length >= 30, String(ROUTES.length));
  const bad: string[] = [];
  for (const path of ROUTES) {
    for (const [what, q] of [["a wrong token", "?token=nope"], ["no token", ""], ["the Odoo API key", `?token=${KEY}`], ["an empty token", "?token="]] as const) {
      const s = await status(env, path, q);
      if (s !== 401) bad.push(`${path} ${what} → ${s}`);
    }
  }
  assert("a wrong token, no token, an empty one and the Odoo API key get 401 on every one of them", bad.length === 0, bad.join(" · "));
  const open: string[] = [];
  for (const path of ROUTES) if ((await status(env, path, `?probe=1&token=${SECRET}`)) !== 200) open.push(path);
  assert("the secret passes the gate of every one of them", open.length === 0, open.join(" · "));
  const hdr = (token: string, query = "") => quiet(() => worker.fetch(new Request(`https://w.test/admin/wa-template-sync${query}`, { headers: { "x-admin-token": token } }), env, ctx));
  assert("the admin's synchronous template sync (a header, never the query): the Odoo key and a wrong token get 401", (await hdr(KEY)).status === 401 && (await hdr("nope")).status === 401 && (await hdr(SECRET, `?token=${SECRET}`)).status === 401);
  assert("every comparison of a button's token in the worker's entry goes through the one check", (INDEX.match(/hookTokenOk\(env, providedToken\)/g) ?? []).length === ROUTES.length - 1 + 1 && !/ODOO_HOOK_TOKEN/.test(INDEX),
    `${(INDEX.match(/hookTokenOk\(env, providedToken\)/g) ?? []).length} checks for ${ROUTES.length} routes`);
}

// ================================================================ أ5
console.log("\n[أ5] probe=1 — the token alone");
{
  const env = world();
  openWindow(env, OWNER);
  const before = { sent: graph.length, odoo: odooLog.length };
  const r = await post(env, "/odoo/hook/s60-trial", `?probe=1&token=${SECRET}`);
  const body = await r.json() as any;
  assert("the right token: 200 «ok, probe»", r.status === 200 && body.ok === true && body.probe === true, JSON.stringify(body));
  assert("…and nothing ran: no message left, and Odoo was not asked for anything", graph.length === before.sent && odooLog.length === before.odoo, `${graph.length - before.sent} sends, ${odooLog.length - before.odoo} Odoo calls`);
  assert("a wrong token: the 401 of every route", (await status(env, "/odoo/hook/s60-trial", "?probe=1&token=nope")) === 401 && (await status(env, "/odoo/hook/s60-trial", "?probe=1")) === 401);
  assert("probe=1 opens nothing outside the hook's routes", (await status(env, "/internal/quotation-issue", `?probe=1&token=${SECRET}`)) !== 200 && (await status(env, "/sim/outbound", `?probe=1&token=${SECRET}`)) !== 200);
  assert("without probe=1 the route runs as it always did (the trial of § 67 reads the switch)", (await status(env, "/odoo/hook/s67-trial", `?token=${SECRET}&op=state`)) === 200);
}

// ================================================================ أ6
console.log("\n[أ6] what a token is compared with, and what is logged");
{
  const SRC = new URL("../src/", import.meta.url);
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const uses = files.filter((f) => /ODOO_API_KEY/.test(readFileSync(new URL(f, SRC), "utf8"))).sort();
  assert("the Odoo API key is named in three files of the worker: its settings, the Odoo client, and the hook's own check", JSON.stringify(uses) === JSON.stringify(["config.ts", "hook-auth.ts", "odoo.ts"]), uses.join(", "));
  const auth = readFileSync(new URL("hook-auth.ts", SRC), "utf8").replace(/\/\/.*$/gm, "");
  const keyLines = auth.split("\n").filter((l) => l.includes("ODOO_API_KEY"));
  assert("…and there it is compared with the worker's OWN secret, never with a token that arrives", keyLines.length === 1 && /if \(s === env\.ODOO_API_KEY\) return "";/.test(keyLines[0]) && !keyLines[0].includes("provided"), keyLines.join(" | "));
  assert("no route compares a token with the key itself", !/timingSafeEqual\([^)]*ODOO_API_KEY/.test(INDEX) && !/ODOO_API_KEY/.test(INDEX));
  // nothing a request carries, and nothing the worker holds, reaches a log
  const lines: string[] = [];
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (...a: unknown[]) => { lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  const now = Date.now();
  const env = world({ before: BEFORE, until: now + 20 * MIN });
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
  try {
    for (const path of ROUTES) {
      for (const t of [SECRET, BEFORE, "a-wrong-token-that-must-not-be-logged"]) await worker.fetch(new Request(`https://w.test${path}?token=${t}&probe=1`, { method: "POST", body: "{}" }), env, ctx);
      await worker.fetch(new Request(`https://w.test${path}?token=a-wrong-token-that-must-not-be-logged`, { method: "POST", body: "{}" }), env, ctx);
    }
    await worker.fetch(new Request(`https://w.test/odoo/hook/s67-trial?token=${SECRET}&op=state`, { method: "POST" }), env, ctx);
    await worker.fetch(new Request(`https://w.test/odoo/hook/team-roster?token=${SECRET}`, { method: "POST", body: JSON.stringify({ _model: "hr.employee", _id: 1 }) }), env, ctx);
  } finally {
    Object.assign(console, real);
  }
  const all = lines.join("\n");
  assert("no token is in any log line: not the secret, not the token of before, not a wrong one", !all.includes(SECRET) && !all.includes(BEFORE) && !all.includes("a-wrong-token-that-must-not-be-logged"), lines.filter((l) => l.includes(SECRET) || l.includes(BEFORE) || l.includes("a-wrong-token")).slice(0, 2).join(" | ").slice(0, 200));
}

done();
