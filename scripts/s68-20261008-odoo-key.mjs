// § 68 ب (2026-10-08) — a NEW Odoo API key for the worker and the scripts, and the old one retired.
//
// Until § 68 the Odoo API key was also the token in the URL of 24 Odoo buttons: every link that carried it may
// have been seen (a browser's history, a log, a screen). The buttons have their own secret now (HOOK_SECRET);
// this replaces the key itself. Odoo creates a key only for a user who has just proved who he is (its «identity
// check»: the password), so the new key is made by Baraa in Odoo and handed to this script at a HIDDEN prompt.
//
//   node scripts/s68-20261008-odoo-key.mjs                read-only: the key in use (by tag), its user, the keys Odoo
//                                                         lists for him, and what the two workers answer
//   node scripts/s68-20261008-odoo-key.mjs --try-create   asks Odoo's own wizard for a new key with no password: Odoo
//                                                         answers with its identity check (then nothing is made). A key
//                                                         it does return is used at once, as --rotate does.
//   node scripts/s68-20261008-odoo-key.mjs --rotate       BARAA RUNS THIS IN HIS TERMINAL: the new key is typed (or
//        pasted) at a prompt that shows nothing; it is checked with one read (the same user as the key in use), then:
//        the rollback file → the worker's secret on sim (and /health) → on prod (and /health) → .env.sim-verify →
//        one Odoo read from this machine → the first */5 tick on prod (wrangler tail, read-only).
//   node scripts/s68-20261008-odoo-key.mjs --old-refused  after Baraa deleted the OLD key in Odoo: one read with it must
//                                                         be refused — then its value is wiped from the rollback file.
//   node scripts/s68-20261008-odoo-key.mjs --rollback     while the old key still exists in Odoo: it goes back on the
//                                                         workers and in .env.sim-verify.
//
// A key is NEVER printed, logged, or passed on a command line: it travels by stdin to `wrangler secret put`,
// and shows as its tag alone (the first 6 hex of its SHA-256). The rollback file holds the old key until
// --old-refused wipes it: backups/s68-20261008-odoo-key-rollback.json (outside git, mode 600). Each
// `wrangler secret put` deploys a new version of that worker: outside 04:00–06:15, and record the live versions.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PROD_HOST, SIM_HOST, scrub, tag } from "./lib/s67-token.mjs";

const MODE = ["--try-create", "--rotate", "--old-refused", "--rollback"].find((m) => process.argv.includes(m)) ?? "status";
const KEY_NAME = "ODOO_API_KEY";
const KEY_LABEL = "utak-worker 2026-10";
const ENV_FILE = new URL("../.env.sim-verify", import.meta.url);
const RB = new URL("../backups/s68-20261008-odoo-key-rollback.json", import.meta.url);
const root = new URL("../", import.meta.url).pathname;
const known = [];
const say = (...a) => console.log(scrub(a.join(" "), known));
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name, cond, detail = "") => { say(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); if (!cond) bad++; return !!cond; };

const envText = () => readFileSync(ENV_FILE, "utf8");
const envMap = () => Object.fromEntries(envText().split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const local = envMap();
const ODOO_URL = local.ODOO_URL;
const current = local[KEY_NAME];
if (!ODOO_URL || !current) { say("✗ .env.sim-verify has no ODOO_URL / ODOO_API_KEY"); process.exit(1); }
known.push(current);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (![`${ODOO_URL}/`, `https://${PROD_HOST}/`, `https://${SIM_HOST}/`].some((p) => url.startsWith(p))) throw new Error(`BLOCKED: ${url.slice(0, 40)}`);
  return realFetch(input, init);
};

/** One call to Odoo's JSON-2 with a given key. Never throws: { status, body }. */
async function odoo(key, model, method, body = {}) {
  try {
    const r = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch { j = null; }
    return { status: r.status, body: j, text: r.ok ? "" : t.slice(0, 200) };
  } catch (e) {
    return { status: 0, body: null, text: String(e?.message ?? e).slice(0, 200) };
  }
}
/** The user a key belongs to (Odoo's own answer), or null when the key is refused. */
async function userOf(key) {
  const r = await odoo(key, "res.users", "context_get");
  return r.status === 200 && Number(r.body?.uid) > 0 ? Number(r.body.uid) : null;
}
/** /health of a worker, six answers in a row a second apart (a new version reaches the edge over some seconds). */
async function health(host) {
  let last = "";
  for (let i = 0; i < 6; i++) {
    const j = await fetch(`https://${host}/health`).then((r) => r.json()).catch((e) => ({ status: "unreachable", odoo: String(e?.message ?? e).slice(0, 80) }));
    last = `${j.status} ${j.odoo ?? ""}`.trim();
    if (!(j.status === "ok" && String(j.odoo).includes("apikey"))) return { ok: false, last };
    await pause(1000);
  }
  return { ok: true, last };
}
function putSecret(value, env) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", KEY_NAME, ...(env === "sim" ? ["--env", "sim"] : [])], { cwd: root, input: `${value}\n`, encoding: "utf8", timeout: 120_000 });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`, known).split("\n").filter((l) => /success|error|✘|Creating|Uploaded/i.test(l)).slice(-2).join(" | ");
  return { ok: r.status === 0, out };
}
function writeLocal(value) {
  const next = envText().split(/\r?\n/).map((l) => (l.startsWith(`${KEY_NAME}=`) ? `${KEY_NAME}=${value}` : l)).join("\n");
  writeFileSync(ENV_FILE, next, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}
/** A line typed at a prompt that shows nothing (a terminal only). */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("this step needs a terminal: the key is typed at a hidden prompt, never given as an argument"));
    process.stdout.write(prompt);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    let s = "";
    const on = (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003") { process.stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (c === "\r" || c === "\n" || c === "\u0004") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", on); process.stdout.write("\n"); return resolve(s.trim()); }
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1); else s += c;
      }
    };
    process.stdin.on("data", on);
  });
}
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null);
const writeRb = (rb) => { mkdirSync(new URL("../backups/", import.meta.url), { recursive: true }); writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n", { mode: 0o600 }); };

// ---------------------------------------------------------------- the key in use
const uid = await userOf(current);
say(`the key in use: tag ${tag(current)} — ${uid ? `Odoo user #${uid}` : "✗ REFUSED by Odoo"}`);
if (uid) {
  const keys = await odoo(current, "res.users.apikeys", "search_read", { domain: [], fields: ["id", "name", "scope", "create_date", "expiration_date"], order: "id asc" });
  if (keys.status === 200) say(`the keys Odoo lists for him: ${keys.body.map((k) => `#${k.id} «${k.name}» (${String(k.create_date).slice(0, 10)}${k.expiration_date ? `, expires ${String(k.expiration_date).slice(0, 10)}` : ", no expiry"})`).join(" · ") || "none"}`);
}

// ---------------------------------------------------------------- status
if (MODE === "status") {
  for (const [name, host] of [["prod", PROD_HOST], ["sim", SIM_HOST]]) { const h = await health(host); say(`${name} /health: ${h.last}`); }
  const rb = readRb();
  if (rb) say(`rollback file: rotated ${rb.at} (${rb.beforeTag} → ${rb.afterTag})${rb.before ? " — the old key's value is still in it (run --old-refused after deleting it in Odoo)" : " — the old key's value is wiped"}`);
  process.exit(uid ? 0 : 1);
}

// ---------------------------------------------------------------- the old key is gone
if (MODE === "--old-refused") {
  const rb = readRb();
  if (!rb) { say("✗ no rollback file: nothing was rotated by this script"); process.exit(1); }
  if (!rb.before) { say(`= the old key (tag ${rb.beforeTag}) was checked «refused» on ${rb.refusedAt}; its value is wiped`); process.exit(0); }
  known.push(rb.before);
  const old = await odoo(rb.before, "res.users", "context_get");
  if (!check(`Odoo refuses the old key (tag ${rb.beforeTag})`, old.status === 401 || old.status === 403, `HTTP ${old.status} — it still works: delete «${rb.oldName ?? "the old key"}» in Odoo (the photo top right → التفضيلات → أمان الحساب → مفاتيح API)`)) process.exit(1);
  check("…and the key in use still works", !!uid);
  writeRb({ ...rb, before: null, refusedAt: new Date().toISOString() });
  say("the old key's value is wiped from the rollback file. What still holds it on this machine is dead text (the shell's history, old session transcripts).");
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- rollback
if (MODE === "--rollback") {
  const rb = readRb();
  if (!rb?.before) { say("✗ no old key to put back (no rollback file, or the old key was wiped after --old-refused)"); process.exit(1); }
  known.push(rb.before);
  if (!check(`the old key (tag ${rb.beforeTag}) still works in Odoo`, !!(await userOf(rb.before)))) process.exit(1);
  for (const env of ["sim", "prod"]) { const r = putSecret(rb.before, env); check(`wrangler secret put ${KEY_NAME} (${env}) ${r.out}`, r.ok); if (!r.ok) process.exit(1); }
  writeLocal(rb.before);
  for (const [name, host] of [["sim", SIM_HOST], ["prod", PROD_HOST]]) { const h = await health(host); check(`${name} /health: ${h.last}`, h.ok); }
  say(bad ? `✗ ${bad} check(s) failed` : "rollback done: the old key is back on sim, prod and .env.sim-verify");
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- a new key: Odoo's wizard, or Baraa's hidden prompt
if (!uid) { say("✗ the key in use is refused: nothing is rotated from here"); process.exit(1); }
let next = "";
if (MODE === "--try-create") {
  const wiz = await odoo(current, "res.users.apikeys.description", "create", { vals_list: [{ name: KEY_LABEL, scope: "rpc", duration: "365" }] });
  if (wiz.status !== 200) { say(`✗ Odoo did not open its key wizard: HTTP ${wiz.status} ${wiz.text}`); process.exit(1); }
  const made = await odoo(current, "res.users.apikeys.description", "make_key", { ids: wiz.body });
  const key = made.body?.context?.default_key;
  if (made.status === 200 && typeof key === "string" && key.length >= 20) { next = key; known.push(next); say("Odoo made the key without asking who it is — it is used now"); }
  else {
    const asks = made.body?.res_model === "res.users.identitycheck";
    say(asks
      ? "Odoo answered with its identity check (res.users.identitycheck): a key is made only after the user's password — NOT possible from a script without it. Nothing was made."
      : `Odoo did not make a key: HTTP ${made.status} ${made.text || JSON.stringify(made.body).slice(0, 160)}`);
    say("Next: Baraa makes the key in Odoo and runs --rotate (the steps are in docs/history/s68.md).");
    process.exit(asks ? 0 : 1);
  }
} else {
  say(`\nالمفتاح الجديد يُكتب (أو يُلصق) الآن ولا يظهر على الشاشة. من Odoo: الصورة أعلى اليمين ← التفضيلات ← أمان الحساب ← مفتاح API جديد ← الوصف «${KEY_LABEL}».`);
  next = await readHidden("المفتاح الجديد (مخفي)، ثم Enter: ");
  known.push(next);
}
if (next.length < 20 || /\s/.test(next)) { say("✗ this is not a key (too short, or it holds a space) — nothing changed"); process.exit(1); }
if (next === current) { say("✗ this is the key in use — nothing changed"); process.exit(1); }
const nextUid = await userOf(next);
if (!check(`the new key (tag ${tag(next)}) is accepted by Odoo`, !!nextUid, "refused: nothing changed")) process.exit(1);
if (!check(`…for the same user (#${uid})`, nextUid === uid, `it belongs to user #${nextUid}: nothing changed`)) process.exit(1);
const read = await odoo(next, "res.partner", "search_count", { domain: [] });
if (!check("…and reads Odoo (one count)", read.status === 200 && Number.isInteger(read.body))) process.exit(1);

// the rollback file BEFORE anything changes
const keys = await odoo(current, "res.users.apikeys", "search_read", { domain: [], fields: ["id", "name"], order: "id asc" });
writeRb({ script: "scripts/s68-20261008-odoo-key.mjs", at: new Date().toISOString(), uid, before: current, beforeTag: tag(current), afterTag: tag(next), oldName: keys.body?.[0]?.name ?? null });
say("rollback file: backups/s68-20261008-odoo-key-rollback.json (outside git, mode 600)");

for (const [env, host] of [["sim", SIM_HOST], ["prod", PROD_HOST]]) {
  const r = putSecret(next, env);
  if (!check(`wrangler secret put ${KEY_NAME} (${env}) ${r.out}`, r.ok)) { say("✗ stopped. Run --rollback to put the old key back where it was changed."); process.exit(1); }
  const h = await health(host);
  if (!check(`${env} /health with the new key: ${h.last}`, h.ok)) { say("✗ stopped before the next step. Run --rollback."); process.exit(1); }
}
writeLocal(next);
const again = envMap()[KEY_NAME];
check(".env.sim-verify holds the new key (mode 600)", again === next);
const fromHere = await odoo(again, "res.partner", "search_count", { domain: [] });
check("an Odoo read from this machine with the key of the file", fromHere.status === 200);
say("the first */5 tick on prod with the new key (wrangler tail, up to 6 minutes)…");
const tick = spawnSync("node", ["scripts/s46-20261001-after-deploy.mjs", "--minutes=6", "--out=s68-odoo-key-after"], { cwd: root, encoding: "utf8", timeout: 480_000 });
for (const l of scrub(`${tick.stdout ?? ""}`, known).split("\n").filter((x) => /^[✓✗]|utak-worker "\*\/5/.test(x))) say(`  ${l}`);
check("the tick ran with no exception", tick.status === 0 && /✓ أول نبضة/.test(tick.stdout ?? ""));
say(bad ? `\n✗ ${bad} check(s) failed — the old key is still valid in Odoo: --rollback puts it back` : `\n✓ المفتاح الجديد يعمل على sim و prod وعلى هذا الجهاز (${tag(current)} ← ${tag(next)}).
الباقي عليك:
 1) في Odoo: التفضيلات ← أمان الحساب ← مفاتيح API ← احذف المفتاح القديم «${keys.body?.[0]?.name ?? "claude"}».
 2) ثم: node scripts/s68-20261008-odoo-key.mjs --old-refused
 3) إن كان اتصال Composio بـ Odoo يستعمل المفتاح القديم: حدّثه هناك بالمفتاح الجديد.
 4) سجّل النسختين الحيّتين: node scripts/s49-20261001-step0.mjs s68-key-after`);
process.exit(bad ? 1 : 0);
