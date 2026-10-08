// § 68 أ (2026-10-08) — the token of Odoo's buttons becomes a secret of its own (HOOK_SECRET), in two phases
// with no button ever broken. Until now the token in the 24 Odoo actions that call `/odoo/hook/*` (and the two
// `/internal/*-wa-send` routes) was the Odoo API key itself.
//
//   node scripts/s68-20261008-hook-secret.mjs                         status, read-only: the token Odoo's actions carry (by tag),
//                                                                     and what the live workers accept
//   node scripts/s68-20261008-hook-secret.mjs --step=secret [--apply] 1  a new random HOOK_SECRET on sim, then prod (the rollback
//                                                                        file first). The code of before § 68 does not read it.
//        … then THE DEPLOY OF PHASE 1 (sim, then prod), each with `--var HOOK_LEGACY_UNTIL:<epoch ms, ≤ 30 minutes ahead>`
//   node scripts/s68-20261008-hook-secret.mjs --step=odoo [--apply]   2  the 24 actions: the token of before → the new one; then every
//                                                                        action's own URL is checked against the live worker (probe=1:
//                                                                        the token alone is checked, nothing runs)
//        … then THE DEPLOY OF PHASE 3 (sim, then prod): the token of before is refused
//   node scripts/s68-20261008-hook-secret.mjs --step=retire [--apply] 3  ODOO_HOOK_TOKEN deleted from sim and prod
//   node scripts/s68-20261008-hook-secret.mjs --step=verify [--phase=1|3]   read-only: 24/24 carry ONE token that is not the Odoo
//        API key and pass; and the token of before — accepted in phase 1, refused (401) in phase 3
//   node scripts/s68-20261008-hook-secret.mjs --rollback [--apply]    the 24 actions as they were (PHASE 1 ONLY: the worker must
//                                                                     still accept the token of before)
//   node scripts/s68-20261008-hook-secret.mjs --step=old-code [--apply]  after `wrangler rollback` to a version of before § 68
//        (it reads ODOO_HOOK_TOKEN, and carries the Odoo key in it): ODOO_HOOK_TOKEN ← the token Odoo's actions carry now
//
// A token is NEVER printed or logged: every line goes through scrub(), and a token shows as its tag alone
// (scripts/lib/s67-token.mjs). The rollback file holds the tokens (the actions' own text): backups/ (outside
// git, mode 600). Each `wrangler secret put|delete` deploys a new version of that worker: outside 04:00–06:15,
// and the live versions are recorded after it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { PROD_HOST, SIM_HOST, newToken, replaceToken, scrub, secretOf, tag, workerUrls } from "./lib/s67-token.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=")[1] ?? "";
const STEP = arg("step");
const PHASE = arg("phase");
const NEW_NAME = "HOOK_SECRET", OLD_NAME = "ODOO_HOOK_TOKEN";
const RB = new URL("../backups/s68-20261008-hook-rollback.json", import.meta.url);
const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const known = [];
const say = (...a) => console.log(scrub(a.join(" "), known));
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!["https://utakfresh.odoo.com/", `https://${PROD_HOST}/`, `https://${SIM_HOST}/`].some((p) => url.startsWith(p))) throw new Error(`BLOCKED: ${url.slice(0, 40)}`);
  return realFetch(input, init);
};
const local = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (local.ODOO_API_KEY) known.push(local.ODOO_API_KEY);
let bad = 0;
const check = (name, cond, detail = "") => { say(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); if (!cond) bad++; };

/** The Odoo actions that call a route of the hook secret, with the token each carries. */
async function holders() {
  const rows = await call("ir.actions.server", "search_read", { domain: ["|", ["webhook_url", "ilike", "utak-worker"], ["code", "ilike", "utak-worker"]], fields: ["id", "name", "state", "webhook_url", "code"], order: "id asc", context: { active_test: false } });
  const mine = [];
  for (const r of rows) {
    const field = r.state === "webhook" ? "webhook_url" : "code";
    const text = String(r[field] || "");
    const urls = workerUrls(text).filter((u) => secretOf(u.path) === "hook");
    if (!urls.length) continue;
    for (const u of urls) if (u.token) known.push(u.token);
    mine.push({ id: r.id, name: r.name, field, text, urls });
  }
  const tokens = [...new Set(mine.flatMap((a) => a.urls.map((u) => u.token).filter(Boolean)))];
  return { mine, tokens, token: tokens.length === 1 ? tokens[0] : null };
}
function wrangler(args, env, input) {
  const r = spawnSync("npx", ["wrangler", ...args, ...(env === "sim" ? ["--env", "sim"] : [])], { input, encoding: "utf8", timeout: 120_000 });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`, known).split("\n").filter((l) => /success|error|✘|Creating|Uploaded|Deployed|Deleting|version|not found/i.test(l)).slice(-3).join(" | ");
  return { ok: r.status === 0, out };
}
/** Does this worker know `probe=1`? On the code of before § 68 the trial's «state» route would RUN (it is read-only): that is how the two are told apart. */
async function knowsProbe(host, token) {
  const r = await fetch(`https://${host}/odoo/hook/s67-trial?op=state&probe=1&token=${token}`, { method: "POST" });
  if (r.status === 401) return "refused";
  const j = await r.json().catch(() => ({}));
  return r.status === 200 && j.probe === true ? "yes" : r.status === 200 ? "no" : `HTTP ${r.status}`;
}
/** The gate alone: «taken» / «refused». Sent only to a worker that knows probe=1. */
async function probe(host, path, token, query = "") {
  const r = await fetch(`https://${host}${path}?${query}${query ? "&" : ""}token=${token}&probe=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  return r.status === 200 && j.probe === true ? "taken" : r.status === 401 ? "refused" : `HTTP ${r.status}`;
}
/**
 * The same answer six times in a row, a second apart — or the answer that broke the row. A deploy reaches
 * Cloudflare's edge over some seconds: just after one, a request may still be served by the version of before
 * (2026-10-08: the new token was «taken», then «refused» two seconds later, then «taken» for good).
 */
async function steady(ask, want, n = 6) {
  for (let i = 0; i < n; i++) {
    const got = await ask();
    if (got !== want) return got;
    await pause(1000);
  }
  return want;
}
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null);
const writeRb = (rb) => { mkdirSync(new URL("../backups/", import.meta.url), { recursive: true }); writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n", { mode: 0o600 }); };

const rb = readRb();
if (rb) known.push(rb.before, rb.after);
const { mine, tokens, token } = await holders();
await pause();

// ---------------------------------------------------------------- rollback (phase 1 only)
if (ROLLBACK) {
  if (!rb?.actions?.length) { say("✗ no rollback file (backups/s68-20261008-hook-rollback.json)"); process.exit(1); }
  say(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const live = await knowsProbe(PROD_HOST, rb.before);
  say(`the live prod worker and the token of before (tag ${tag(rb.before)}): ${live === "refused" ? "REFUSED" : "accepted"}`);
  if (live === "refused") { say("✗ the worker no longer accepts the token of before: putting it back in Odoo would break every button. Nothing is written."); process.exit(1); }
  for (const a of rb.actions) {
    say(`✎ #${a.id}: ${a.field} ← the text of before`);
    if (APPLY) { await call("ir.actions.server", "write", { ids: [a.id], vals: { [a.field]: a.before } }); await pause(400); }
  }
  say(APPLY ? `rollback done: ${rb.actions.length} action(s) as before (HOOK_SECRET stays on the worker: it is read by § 68's code alone)` : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- 1: the new secret on the worker
if (STEP === "secret") {
  say(APPLY ? "APPLY — step 1: a new HOOK_SECRET" : "dry-run — step 1 (nothing is written; add --apply)");
  say(`Odoo: ${mine.length} action(s) carry the hook token — tag ${token ? tag(token) : `✗ ${tokens.length} different`}${token && token === local.ODOO_API_KEY ? " (THE ODOO API KEY ITSELF)" : ""}`);
  if (!token) { say("✗ the actions do not carry one token — stopped"); process.exit(1); }
  if (rb?.after && rb.put?.prod) { say(`= a new secret was put before (tag ${tag(rb.after)}, prod ${rb.put.prod}) — nothing to do`); process.exit(0); }
  say(`+ ${NEW_NAME}: a new random secret (64 hex) on sim, then prod — ${OLD_NAME} is not touched`);
  if (!APPLY) { say("dry-run: nothing written (add --apply)"); process.exit(0); }
  const fresh = { script: "scripts/s68-20261008-hook-secret.mjs", at: new Date().toISOString(), before: token, after: newToken(), put: {}, actions: mine.map((a) => ({ id: a.id, field: a.field, before: a.text })) };
  known.push(fresh.after);
  writeRb(fresh);
  say("rollback file: backups/s68-20261008-hook-rollback.json (outside git, mode 600)");
  for (const env of ["sim", "prod"]) {
    const r = wrangler(["secret", "put", NEW_NAME], env, `${fresh.after}\n`);
    say(`  ${r.ok ? "✓" : "✗"} wrangler secret put ${NEW_NAME} (${env}) ${r.out}`);
    if (!r.ok) { say("✗ stopped: Odoo was not touched"); process.exit(1); }
    fresh.put[env] = new Date().toISOString();
    writeRb(fresh);
  }
  say(`step 1 done: ${NEW_NAME} tag ${tag(fresh.after)} on sim and prod. Next: the deploy of phase 1, then --step=odoo`);
  process.exit(0);
}

// ---------------------------------------------------------------- 2: Odoo's 24 actions
if (STEP === "odoo") {
  say(APPLY ? "APPLY — step 2: Odoo's actions" : "dry-run — step 2 (nothing is written; add --apply)");
  if (!rb?.after) { say("✗ no new secret yet (run --step=secret --apply first)"); process.exit(1); }
  const todo = mine.filter((a) => a.text.includes(rb.before));
  const doneAlready = mine.filter((a) => a.text.includes(rb.after));
  say(`${mine.length} action(s): ${todo.length} carry the token of before (tag ${tag(rb.before)}), ${doneAlready.length} the new one (tag ${tag(rb.after)})`);
  // the worker must accept BOTH before Odoo is touched — else a button breaks between two writes
  const know = await steady(() => knowsProbe(PROD_HOST, rb.after), "yes");
  const old = know === "yes" ? await steady(() => probe(PROD_HOST, "/odoo/hook/prices", rb.before), "taken") : "?";
  say(`the live prod worker (six answers in a row): the new token ${know === "yes" ? "is taken (it runs § 68's code)" : `→ ${know}`}; the token of before → ${old}`);
  if (know !== "yes") { say("✗ the live prod worker does not accept the new token yet (deploy phase 1 first) — nothing is written"); process.exit(1); }
  if (todo.length && old !== "taken") say("! the token of before is refused already (its window closed, or phase 3 is live): every action still carrying it is a button that does not work — rewriting them puts each one back to work");
  for (const a of todo) say(`  ✎ #${a.id} «${a.name}» ${a.field}: ${a.urls.map((u) => u.path).join(", ")}`);
  if (!APPLY) { say("dry-run: nothing written (add --apply)"); process.exit(0); }
  for (const a of todo) {
    await call("ir.actions.server", "write", { ids: [a.id], vals: { [a.field]: replaceToken(a.text, rb.before, rb.after) } });
    await pause(400);
  }
  rb.odooAt = new Date().toISOString();
  writeRb(rb);
  say(`  ✓ ${todo.length} action(s) rewritten`);
  await pause(1500);
}

// ---------------------------------------------------------------- 3: the secret of before, off the worker
if (STEP === "retire") {
  say(APPLY ? `APPLY — step 3: ${OLD_NAME} off sim and prod` : "dry-run — step 3 (nothing is written; add --apply)");
  if (!rb?.after || token !== rb.after) { say("✗ Odoo's actions do not carry the new token: nothing is deleted"); process.exit(1); }
  const before = await steady(() => probe(PROD_HOST, "/odoo/hook/prices", rb.before), "refused");
  say(`the live prod worker and the token of before (six answers in a row): ${before}`);
  if (before !== "refused") { say("✗ the live prod worker still accepts the token of before (deploy phase 3 first, or wait for the window's end) — nothing is deleted"); process.exit(1); }
  for (const env of ["sim", "prod"]) {
    say(`- wrangler secret delete ${OLD_NAME} (${env})`);
    if (!APPLY) continue;
    const r = wrangler(["secret", "delete", OLD_NAME], env, "y\n");
    say(`  ${r.ok ? "✓" : "✗"} ${r.out}`);
    if (!r.ok) bad++;
  }
  if (APPLY) { rb.retiredAt = new Date().toISOString(); writeRb(rb); }
  say(APPLY ? (bad ? `✗ ${bad} delete(s) failed` : "step 3 done") : "dry-run: nothing written (add --apply)");
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- old code (after a rollback of the worker to before § 68)
if (STEP === "old-code") {
  say(APPLY ? `APPLY — ${OLD_NAME} ← the token Odoo's actions carry now` : "dry-run (nothing is written; add --apply)");
  if (!token) { say("✗ the actions do not carry one token — stopped"); process.exit(1); }
  if (token === local.ODOO_API_KEY) { say("= Odoo's actions carry the Odoo key, as the code of before expects — nothing to do"); process.exit(0); }
  for (const env of ["sim", "prod"]) {
    say(`✎ wrangler secret put ${OLD_NAME} (${env}) ← tag ${tag(token)}`);
    if (!APPLY) continue;
    const r = wrangler(["secret", "put", OLD_NAME], env, `${token}\n`);
    say(`  ${r.ok ? "✓" : "✗"} ${r.out}`);
    if (!r.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- status / verify (read-only), and the checks after step 2
const after = STEP === "odoo" ? await holders() : { mine, tokens, token };
say(`## Odoo: ${after.mine.length} action(s) on the hook's routes — ${after.mine.map((a) => `#${a.id}`).join(" ")}`);
check("they carry ONE token", !!after.token, `${after.tokens.length} different: ${after.tokens.map(tag).join(", ")}`);
if (after.token) {
  say(`   tag ${tag(after.token)}`);
  check("…and it is not the Odoo API key", after.token !== local.ODOO_API_KEY);
  if (rb?.after) check(`…it is the new HOOK_SECRET (tag ${tag(rb.after)})`, after.token === rb.after);
  if (rb?.before) check(`the token of before (tag ${tag(rb.before)}) is in no action`, !after.mine.some((a) => a.text.includes(rb.before)));
}
for (const [name, host] of [["prod", PROD_HOST], ["sim", SIM_HOST]]) {
  if (!after.token || after.token === local.ODOO_API_KEY) { say(`## ${name}: Odoo still carries the Odoo key — the live gate is not probed with it`); continue; }
  const know = await knowsProbe(host, after.token);
  await pause(300);
  check(`${name}: the worker takes the token Odoo carries (and knows probe=1: § 68's code)`, know === "yes", know);
  if (know !== "yes") continue;
  if (name === "prod") {
    // every action's OWN URL, as Odoo holds it
    const failed = [];
    for (const a of after.mine) for (const u of a.urls) {
      const got = await probe(host, u.path, u.token ?? "");
      if (got !== "taken") failed.push(`#${a.id} ${u.path} → ${got}`);
      await pause(150);
    }
    check(`prod: ${after.mine.length}/${after.mine.length} actions — each one's own URL passes the gate`, failed.length === 0, failed.join(" · "));
  }
  check(`${name}: a token that is not it gets 401`, (await probe(host, "/odoo/hook/prices", newToken())) === "refused");
  await pause(300);
  if (rb?.before) {
    const got = await probe(host, "/odoo/hook/prices", rb.before);
    if (PHASE === "3") check(`${name}: the token of before is REFUSED (phase 3)`, got === "refused", got);
    else if (PHASE === "1" && name === "prod") check(`${name}: the token of before is still accepted (phase 1: its window is open)`, got === "taken", got);
    else say(`   ${name}: the token of before → ${got}`);
    await pause(300);
  }
  if (local.ODOO_API_KEY && PHASE === "3") check(`${name}: the Odoo API key as a token gets 401`, (await probe(host, "/odoo/hook/prices", local.ODOO_API_KEY)) === "refused");
}
say(bad ? `✗ ${bad} check(s) failed` : `${STEP === "odoo" ? "step 2 done" : "verify"}: ok`);
process.exit(bad ? 1 : 0);
