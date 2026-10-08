// § 67 ز (2026-10-08) — rotates a worker URL token: a new secret on the worker (sim, then prod) and the same
// token in every Odoo action that calls the worker with it, together. The old token stops working the moment
// the prod secret is set. A token is NEVER printed or logged: every line goes through scrub(), and a token
// shows as its tag alone (scripts/lib/s67-token.mjs).
//
//   node scripts/s67-20261008-token.mjs --which=pdf,internal           dry-run: who carries each token (by tag)
//   node scripts/s67-20261008-token.mjs --which=pdf,internal --apply   the rollback file, the two secrets, Odoo, the checks
//   node scripts/s67-20261008-token.mjs --which=pdf,internal --verify  read-only: one token a secret in Odoo, and the
//                                                                      live routes answer it (and refuse a wrong one)
//   node scripts/s67-20261008-token.mjs --rollback --apply             the tokens of before, on the worker and in Odoo
//
//   --which   pdf       SALE_PDF_DOWNLOAD_TOKEN  (the token § 66's facts script printed to a local log)
//             internal  INTERNAL_WEBHOOK_SECRET
//             hook      HOOK_SECRET              (24 actions, #979 among them — since § 68 a secret of its own)
//
// Rollback file: backups/s67-20261008-token-rollback.json — it holds the tokens of before (the actions' own text),
// so it lives in backups/ (outside git), never in scripts/artifacts. Each `wrangler secret put` deploys a new
// version of that worker: run it outside 04:00–06:15, and record the live versions after it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { PROD_HOST, SECRETS, newToken, replaceToken, scrub, secretOf, tag, workerUrls } from "./lib/s67-token.mjs";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const ROLLBACK = process.argv.includes("--rollback");
const WHICH = (process.argv.find((a) => a.startsWith("--which=")) ?? "").slice(8).split(",").filter(Boolean);
const RB = new URL("../backups/s67-20261008-token-rollback.json", import.meta.url);
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const known = []; // every token this run has seen: scrub() turns each into its tag
const say = (...a) => console.log(scrub(a.join(" "), known));
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith(`https://${PROD_HOST}/`)) throw new Error(`BLOCKED: ${url.slice(0, 40)}`);
  return realFetch(input, init);
};

if (!ROLLBACK && (!WHICH.length || WHICH.some((w) => !(w in SECRETS)))) { say(`--which=${Object.keys(SECRETS).join(",")} (one or more)`); process.exit(2); }

/** Every server action that names the worker, with the URLs and tokens in it. */
async function actions() {
  const rows = await call("ir.actions.server", "search_read", { domain: ["|", ["webhook_url", "ilike", "utak-worker"], ["code", "ilike", "utak-worker"]], fields: ["id", "name", "state", "webhook_url", "code"], order: "id asc", context: ALL });
  return rows.map((r) => {
    const field = r.state === "webhook" ? "webhook_url" : "code";
    const urls = workerUrls(r[field]);
    for (const u of urls) if (u.token) known.push(u.token);
    return { id: r.id, name: r.name, field, text: String(r[field] || ""), urls };
  });
}
/** The actions of one secret, and the ONE token they carry (null when they do not agree). */
function holders(all, key) {
  const mine = all.filter((a) => a.urls.some((u) => u.token && secretOf(u.path) === key));
  const tokens = [...new Set(mine.flatMap((a) => a.urls.filter((u) => secretOf(u.path) === key && u.token).map((u) => u.token)))];
  return { mine, token: tokens.length === 1 ? tokens[0] : null, tokens };
}
function putSecret(name, value, env) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name, ...(env === "sim" ? ["--env", "sim"] : [])], { input: `${value}\n`, encoding: "utf8", timeout: 120_000 });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`, [value, ...known]).split("\n").filter((l) => /success|error|✘|Creating|Uploaded|Deployed|version/i.test(l)).slice(-3).join(" | ");
  return { ok: r.status === 0, out };
}
/** Does the live prod worker take this token on a route of this secret? No side effect: nothing is issued or sent. */
async function probe(key, token) {
  if (key === "internal") {
    // an unexpected model is refused AFTER the token is checked: 401 = the token is wrong, 400 = it was taken
    const r = await fetch(`https://${PROD_HOST}/internal/quotation-issue?token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _model: "x_probe", _id: 1 }) });
    return r.status === 400 ? "taken" : r.status === 401 ? "refused" : `HTTP ${r.status}`;
  }
  if (key === "hook") {
    const r = await fetch(`https://${PROD_HOST}/odoo/hook/s67-trial?token=${token}&op=state`, { method: "POST" });
    return r.status === 200 ? "taken" : r.status === 401 ? "refused" : `HTTP ${r.status}`;
  }
  // pdf: a real posted invoice is rendered (read-only) with the right token, and «not found» with a wrong one
  const [mv] = await call("account.move", "search_read", { domain: [["move_type", "=", "out_invoice"], ["state", "=", "posted"]], fields: ["id"], order: "id desc", limit: 1 });
  if (!mv) return "no invoice to probe with";
  const r = await fetch(`https://${PROD_HOST}/internal/invoice-pdf?id=${mv.id}&token=${token}`);
  await r.arrayBuffer().catch(() => null);
  return r.status === 200 && String(r.headers.get("content-type")).includes("pdf") ? "taken" : r.status === 404 ? "refused" : `HTTP ${r.status}`;
}

/**
 * Every route of a secret, with its token: «taken» when the worker went past the token check (it then refuses the
 * probe's model, or renders a real document, read-only). Nothing is issued, sent or written.
 */
async function routes(key, token) {
  const out = [];
  const post = async (path, body) => {
    const r = await fetch(`https://${PROD_HOST}${path}?token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.status === 400 ? "taken" : r.status === 401 ? "refused" : `HTTP ${r.status}`;
  };
  if (key === "internal") {
    for (const path of ["/internal/quotation-issue", "/internal/receipt-issue", "/internal/official-doc/preview", "/internal/official-doc/issue", "/internal/official-doc/ai-draft"]) {
      out.push([path, await post(path, { _model: "x_probe", _id: 1 })]);
      await pause(400);
    }
  } else if (key === "pdf") {
    const pdf = async (path, model, domain) => {
      const [rec] = await call(model, "search_read", { domain, fields: ["id"], order: "id desc", limit: 1 });
      if (!rec) return "no record to probe with";
      const r = await fetch(`https://${PROD_HOST}${path}?id=${rec.id}&token=${token}`);
      await r.arrayBuffer().catch(() => null);
      return r.status === 200 && String(r.headers.get("content-type")).includes("pdf") ? "taken" : r.status === 404 ? "refused" : `HTTP ${r.status}`;
    };
    out.push(["/internal/invoice-pdf", await pdf("/internal/invoice-pdf", "account.move", [["move_type", "=", "out_invoice"], ["state", "=", "posted"]])]);
    await pause();
    out.push(["/internal/purchase-order-pdf", await pdf("/internal/purchase-order-pdf", "purchase.order", [["state", "in", ["purchase", "done"]]])]);
    const gone = await fetch(`https://${PROD_HOST}/internal/sale-quotation-pdf?id=1&token=${token}`);
    out.push(["/internal/sale-quotation-pdf", gone.status === 410 ? "gone (410, since § 64)" : `HTTP ${gone.status}`]);
  } else {
    out.push(["/odoo/hook/s67-trial", await probe("hook", token)]);
  }
  return out;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(RB)) { say("✗ no rollback file (backups/s67-20261008-token-rollback.json)"); process.exit(1); }
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  for (const s of rb.secrets ?? []) known.push(s.before, s.after);
  say(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  for (const s of rb.secrets ?? []) {
    say(`✎ ${s.name}: the token of before (${tag(s.before)}) on sim and prod, and in ${s.actions.length} action(s)`);
    if (!APPLY) continue;
    for (const env of ["sim", "prod"]) { const r = putSecret(s.name, s.before, env); say(`  ${r.ok ? "✓" : "✗"} wrangler secret put ${s.name} (${env}) ${r.out}`); if (!r.ok) process.exit(1); }
    for (const a of s.actions) { await call("ir.actions.server", "write", { ids: [a.id], vals: { [a.field]: a.before } }); await pause(400); }
    say(`  ✓ ${s.actions.length} action(s) as before`);
  }
  process.exit(0);
}

const all = await actions();
await pause();
let bad = 0;
const check = (name, cond, detail = "") => { say(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); if (!cond) bad++; };

// ---------------------------------------------------------------- verify
if (VERIFY) {
  for (const key of WHICH) {
    const { mine, token, tokens } = holders(all, key);
    say(`## ${key} (${SECRETS[key].name}): ${mine.length} action(s) — ${mine.map((a) => `#${a.id}`).join(" ")}`);
    check("its actions carry ONE token", !!token, `${tokens.length} different tokens: ${tokens.map(tag).join(", ")}`);
    if (!token) continue;
    for (const [path, got] of await routes(key, token)) check(`${path} takes it (tag ${tag(token)})`, got === "taken" || got.startsWith("gone"), got);
    await pause();
    check("…and refuses a token that is not it", (await probe(key, newToken())) === "refused");
    await pause();
    if (existsSync(RB)) {
      const before = (JSON.parse(readFileSync(RB, "utf8")).secrets ?? []).find((s) => s.name === SECRETS[key].name)?.before;
      if (before) {
        known.push(before);
        check(`the token of before (tag ${tag(before)}) is in no action`, !all.some((a) => a.text.includes(before)));
        check("…and the live prod worker refuses it", (await probe(key, before)) === "refused");
        await pause();
      }
    }
  }
  // no token is shared between two secrets, and none is the Odoo API key
  const local = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const key of WHICH) {
    const { token } = holders(all, key);
    if (token) check(`${key}: its token is not the Odoo API key`, token !== local.ODOO_API_KEY);
  }
  say(`verify: ${bad ? `${bad} ✗` : "ok"}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- apply / dry-run
say(APPLY ? `APPLY — ${WHICH.join(", ")}` : `dry-run — ${WHICH.join(", ")} (nothing is written; add --apply)`);
const plan = [];
for (const key of WHICH) {
  const { mine, token, tokens } = holders(all, key);
  say(`## ${key} (${SECRETS[key].name}): ${mine.length} action(s), token tag ${token ? tag(token) : `✗ ${tokens.length} different`}`);
  for (const a of mine) say(`  ✎ #${a.id} «${a.name}» ${a.field}: ${a.urls.map((u) => u.path).join(", ")}`);
  if (!token) { say("✗ the actions of this secret do not carry one token — nothing is rotated"); process.exit(1); }
  plan.push({ key, name: SECRETS[key].name, before: token, actions: mine });
}
if (!APPLY) { say("dry-run: nothing written (add --apply)"); process.exit(0); }

// the rollback file BEFORE anything changes (the tokens of before are the actions' own text: backups/, outside git)
mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s67-20261008-token.mjs", secrets: [] };
for (const p of plan) {
  p.after = newToken();
  known.push(p.after);
  rb.secrets = rb.secrets.filter((s) => s.name !== p.name);
  rb.secrets.push({ name: p.name, at: new Date().toISOString(), before: p.before, after: p.after, actions: p.actions.map((a) => ({ id: a.id, field: a.field, before: a.text })) });
}
writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n", { mode: 0o600 });
say("rollback file: backups/s67-20261008-token-rollback.json (outside git)");

for (const p of plan) {
  say(`## ${p.key}: ${tag(p.before)} → ${tag(p.after)}`);
  // sim first (Odoo does not call it), then prod: from that moment the old token is refused, so Odoo follows at once
  for (const env of ["sim", "prod"]) {
    const r = putSecret(p.name, p.after, env);
    say(`  ${r.ok ? "✓" : "✗"} wrangler secret put ${p.name} (${env}) ${r.out}`);
    if (!r.ok) { say("✗ stopped: Odoo was not touched for this secret. Run --rollback --apply to put the token of before on the worker."); process.exit(1); }
  }
  for (const a of p.actions) {
    await call("ir.actions.server", "write", { ids: [a.id], vals: { [a.field]: replaceToken(a.text, p.before, p.after) } });
    await pause(400);
  }
  say(`  ✓ ${p.actions.length} action(s) carry the new token`);
}
await pause(2000);
const after = await actions();
for (const p of plan) {
  const { token } = holders(after, p.key);
  check(`${p.key}: every action carries the new token (tag ${tag(p.after)})`, token === p.after);
  check(`${p.key}: the token of before is in no action`, !after.some((a) => a.text.includes(p.before)));
  check(`${p.key}: the live prod worker takes the new token`, (await probe(p.key, p.after)) === "taken");
  await pause();
  check(`${p.key}: …and refuses the token of before`, (await probe(p.key, p.before)) === "refused");
  await pause();
}
say(bad ? `✗ ${bad} check(s) failed` : "applied: the tokens are rotated");
process.exit(bad ? 1 : 0);
