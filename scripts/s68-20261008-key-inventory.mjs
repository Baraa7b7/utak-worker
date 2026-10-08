// § 68 ب (2026-10-08) — where the CURRENT Odoo API key lives, read-only. Nothing is written anywhere but the
// report, nothing is sent, and the key is NEVER printed or stored: a place is named by its path, and the key
// by its tag alone (scripts/lib/s67-token.mjs — the first 6 hex of its SHA-256).
//
//   node scripts/s68-20261008-key-inventory.mjs
//
// It looks in:
//   · the worker's secrets, by NAME (wrangler secret list, prod and sim — a secret's value cannot be read back)
//   · Odoo: the server actions whose URL token IS the key (the hook token of before § 68), and the user's own keys
//   · this checkout: every file (tracked, untracked, ignored — backups/ and scripts/artifacts/ among them)
//   · git: every commit of every branch (the patch text)
//   · this machine: the shell's history and rc files, wrangler's and Claude's settings and transcripts, Composio's
//   · GitHub: workflows in the repo (a repo secret's name needs `gh`, or the repo's Settings page)
//
// Out: scripts/artifacts/s68-20261008-key-inventory.json (paths and tags only).
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { call } from "./lib/odoo-cli.mjs";
import { secretOf, tag, workerUrls } from "./lib/s67-token.mjs";

const root = new URL("../", import.meta.url).pathname;
const home = homedir();
const local = Object.fromEntries(readFileSync(join(root, ".env.sim-verify"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = local.ODOO_API_KEY;
if (!KEY || KEY.length < 16) { console.log("✗ no ODOO_API_KEY in .env.sim-verify"); process.exit(1); }
const out = { at: new Date().toISOString(), keyTag: tag(KEY), keyLength: KEY.length };
const say = (s) => console.log(String(s).split(KEY).join(`<tag:${tag(KEY)}>`));

/** Does this file hold the key? Streamed, with an overlap of the key's length between chunks. */
function fileHas(path) {
  return new Promise((resolve) => {
    let tail = "", hit = false;
    const s = createReadStream(path, { encoding: "latin1", highWaterMark: 1 << 20 });
    s.on("data", (chunk) => { if ((tail + chunk).includes(KEY)) { hit = true; s.destroy(); } else tail = chunk.slice(-KEY.length); });
    s.on("close", () => resolve(hit));
    s.on("error", () => resolve(false));
  });
}
/** Every regular file under `dir` (no symlink followed), `skip` names left out, up to `maxBytes` a file. */
function* walk(dir, skip, maxBytes = 300 * 1024 * 1024) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (skip.has(n)) continue;
    const p = join(dir, n);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walk(p, skip, maxBytes);
    else if (st.isFile() && st.size >= KEY.length && st.size <= maxBytes) yield p;
  }
}
async function scan(label, dir, skip = new Set()) {
  const hits = [];
  let n = 0;
  for (const p of walk(dir, skip)) { n++; if (await fileHas(p)) hits.push(p); }
  return { label, files: n, hits };
}

// ---------------------------------------------------------------- the worker's secrets (names)
out.workerSecrets = {};
for (const env of ["prod", "sim"]) {
  const r = spawnSync("npx", ["wrangler", "secret", "list", ...(env === "sim" ? ["--env", "sim"] : [])], { cwd: root, encoding: "utf8", timeout: 90_000 });
  let names = [];
  try { names = JSON.parse(r.stdout.slice(r.stdout.indexOf("["))).map((s) => s.name).sort(); } catch { names = [`(unreadable: exit ${r.status})`]; }
  out.workerSecrets[env] = names;
  say(`worker ${env}: ${names.length} secret(s) — ${names.join(", ")}`);
}

// ---------------------------------------------------------------- Odoo
const actions = await call("ir.actions.server", "search_read", { domain: ["|", ["webhook_url", "ilike", "utak-worker"], ["code", "ilike", "utak-worker"]], fields: ["id", "name", "state", "webhook_url", "code"], order: "id asc", context: { active_test: false } });
const carriers = [];
const hookTags = new Set();
for (const a of actions) {
  const text = String(a.state === "webhook" ? a.webhook_url : a.code || "");
  for (const u of workerUrls(text)) if (u.token && secretOf(u.path) === "hook") hookTags.add(tag(u.token));
  if (text.includes(KEY)) carriers.push({ id: a.id, name: a.name, field: a.state === "webhook" ? "webhook_url" : "code", paths: [...new Set(workerUrls(text).map((u) => u.path))] });
}
out.odooActionsWithKey = carriers;
out.hookTokenTags = [...hookTags];
say(`Odoo: ${actions.length} server action(s) name the worker; ${carriers.length} carry the Odoo API key itself as their URL token — ${carriers.map((c) => `#${c.id}`).join(" ")}`);
say(`      hook token tag(s) in Odoo: ${[...hookTags].join(", ")} · the key's tag: ${tag(KEY)} → ${hookTags.has(tag(KEY)) ? "THE SAME" : "different"}`);
await new Promise((r) => setTimeout(r, 900));
// elsewhere in Odoo: automations, crons, parameters, views
out.odooElsewhere = [];
for (const [model, fields] of [["ir.cron", ["code"]], ["ir.config_parameter", ["value"]], ["ir.ui.view", ["arch_db"]]]) {
  try {
    const rows = await call(model, "search_read", { domain: [[fields[0], "ilike", KEY]], fields: ["id"], context: { active_test: false }, limit: 50 });
    for (const r of rows) out.odooElsewhere.push(`${model} #${r.id}`);
  } catch (e) { out.odooElsewhere.push(`${model}: unreadable (${String(e.message).slice(0, 60).split(KEY).join("<key>")})`); }
  await new Promise((r) => setTimeout(r, 900));
}
say(`      elsewhere in Odoo (crons, parameters, views): ${out.odooElsewhere.join(", ") || "none"}`);
// the user's own API keys, as Odoo lists them (never their value: Odoo keeps a hash)
try {
  const who = await call("res.users", "search_read", { domain: [["login", "=", local.ODOO_LOGIN]], fields: ["id", "name", "login"], limit: 1 });
  const keys = await call("res.users.apikeys", "search_read", { domain: [], fields: ["id", "name", "user_id", "scope", "create_date", "expiration_date"], order: "id asc", limit: 50 });
  out.odooUser = who[0] ? { id: who[0].id, name: who[0].name } : null;
  out.odooApiKeys = keys.map((k) => ({ id: k.id, name: k.name, user: Array.isArray(k.user_id) ? k.user_id[0] : k.user_id, scope: k.scope || null, created: k.create_date, expires: k.expiration_date || null }));
  say(`      the user: #${out.odooUser?.id} «${out.odooUser?.name}» — API keys Odoo lists: ${out.odooApiKeys.map((k) => `#${k.id} «${k.name}» (${String(k.created).slice(0, 10)}${k.expires ? `, expires ${String(k.expires).slice(0, 10)}` : ", no expiry"})`).join(" · ") || "none readable"}`);
} catch (e) {
  out.odooApiKeys = `unreadable: ${String(e.message).slice(0, 160).split(KEY).join("<key>")}`;
  say(`      the user's API keys: ${out.odooApiKeys}`);
}

// ---------------------------------------------------------------- this checkout
const tracked = new Set(spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\0").filter(Boolean));
const repo = await scan("checkout", root, new Set([".git", "node_modules", ".wrangler"]));
out.checkout = { files: repo.files, hits: repo.hits.map((p) => { const rel = relative(root, p); return { path: rel, tracked: tracked.has(rel) }; }) };
say(`checkout: ${repo.files} file(s) read; the key is in ${repo.hits.length}: ${out.checkout.hits.map((h) => `${h.path}${h.tracked ? " (TRACKED BY GIT)" : ""}`).join(", ") || "none"}`);

// ---------------------------------------------------------------- git history
out.gitHistory = await new Promise((resolve) => {
  const p = spawn("git", ["log", "--all", "-p", "--no-color", "--no-textconv", "--format=%x01%H"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  let tail = "", commit = "", hits = new Set(), n = 0;
  p.stdout.setEncoding("latin1");
  p.stdout.on("data", (chunk) => {
    const text = tail + chunk;
    let from = 0;
    for (;;) {
      const i = text.indexOf("\x01", from);
      const seg = text.slice(from, i < 0 ? text.length : i);
      if (seg.includes(KEY) && commit) hits.add(commit);
      if (i < 0) break;
      const eol = text.indexOf("\n", i);
      if (eol < 0) break;
      commit = text.slice(i + 1, eol).trim(); n++;
      from = eol + 1;
    }
    tail = text.slice(-KEY.length);
  });
  p.on("close", () => resolve({ commits: n, hits: [...hits].map((h) => h.slice(0, 8)) }));
});
say(`git history: ${out.gitHistory.commits} commit(s) read (all branches); the key is in ${out.gitHistory.hits.length}: ${out.gitHistory.hits.join(", ") || "none"}`);

// ---------------------------------------------------------------- this machine
out.machine = [];
const single = [".zsh_history", ".bash_history", ".zshrc", ".zprofile", ".zshenv", ".profile", ".bashrc", ".netrc", ".npmrc", ".claude.json", ".mcp.json"].map((f) => join(home, f));
for (const p of single) if (existsSync(p) && (await fileHas(p))) out.machine.push(p.replace(home, "~"));
const dirs = [
  ["~/.claude", join(home, ".claude"), new Set(["node_modules"])],
  ["~/.config", join(home, ".config"), new Set(["node_modules"])],
  ["~/.wrangler", join(home, ".wrangler"), new Set()],
  ["~/Library/Preferences/.wrangler", join(home, "Library/Preferences/.wrangler"), new Set()],
  ["~/Library/Application Support/Claude", join(home, "Library/Application Support/Claude"), new Set(["Cache", "Code Cache", "GPUCache", "blob_storage", "Crashpad", "vm_bundles", "claude-code-vm"])],
  ["~/.composio", join(home, ".composio"), new Set()],
];
out.machineDirs = {};
for (const [label, dir, skip] of dirs) {
  if (!existsSync(dir)) { out.machineDirs[label] = "absent"; continue; }
  const r = await scan(label, dir, skip);
  out.machineDirs[label] = { files: r.files, hits: r.hits.map((p) => p.replace(home, "~")) };
  for (const h of r.hits) out.machine.push(h.replace(home, "~"));
}
say(`this machine (shell history and rc files, ${dirs.map((d) => d[0]).join(", ")}): the key is in ${out.machine.length} file(s)`);
for (const m of out.machine) say(`  · ${m}`);

// ---------------------------------------------------------------- GitHub and Composio (local settings only)
out.github = { workflows: existsSync(join(root, ".github/workflows")) ? readdirSync(join(root, ".github/workflows")) : [], gh: spawnSync("which", ["gh"]).status === 0 };
say(`GitHub: ${out.github.workflows.length} workflow file(s) in the repo${out.github.gh ? "" : "; `gh` is not installed — the repo's secret NAMES are on its Settings → Secrets page"}`);
const composio = [];
for (const p of [join(home, ".claude.json"), join(root, ".mcp.json"), join(home, "Library/Application Support/Claude/claude_desktop_config.json"), join(home, ".claude/settings.json"), join(root, ".claude/settings.json"), join(root, ".claude/settings.local.json")]) {
  if (!existsSync(p)) continue;
  const t = readFileSync(p, "utf8");
  if (/composio/i.test(t)) composio.push({ file: p.replace(home, "~").replace(root, ""), mentionsOdoo: /odoo/i.test(t), holdsTheKey: t.includes(KEY) });
}
out.composio = composio;
say(`Composio in local settings: ${composio.map((c) => `${c.file} (names Odoo: ${c.mentionsOdoo ? "yes" : "no"}; holds the key: ${c.holdsTheKey ? "YES" : "no"})`).join(" · ") || "no local file names it (the connection's credentials live at Composio, not here)"}`);

writeFileSync(join(root, "scripts/artifacts/s68-20261008-key-inventory.json"), JSON.stringify(out, null, 2).split(KEY).join(`<tag:${tag(KEY)}>`) + "\n");
say("out: scripts/artifacts/s68-20261008-key-inventory.json (paths and tags only)");
