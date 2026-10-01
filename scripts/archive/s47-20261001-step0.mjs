// § 47 (2026-10-01) — step 0 and the after-deploy check, read-only:
//   · Cloudflare: the active version and the schedules of prod and sim, and /health of both
//   · Meta: the phone's webhook_configuration (GET, the token of .env.sim-verify, never printed)
//   · Odoo: every ir.actions.server / base.automation / ir.cron / ir.config_parameter carrying a
//     worker host, counted by host (search_read only)
//
//   node scripts/archive/s47-20261001-step0.mjs <label>
//
// Out: scripts/artifacts/s47-20261001-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { call } from "../lib/odoo-cli.mjs";

const root = new URL("../../", import.meta.url);
const label = process.argv[2] ?? "step0";
const env = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const HOSTS = { prod: "utak-worker.utak-business.workers.dev", sim: "utak-worker-sim.utak-business.workers.dev" };
const SCRIPTS = { prod: "utak-worker", sim: "utak-worker-sim" };
const PHONE = "1351691708016803";
const out = { label, atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };

// ---- Cloudflare
spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" });
const tok = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) ?? [])[1];
const cf = async (p) => { const j = await (await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: { Authorization: `Bearer ${tok}` } })).json(); if (!j.success) throw new Error(`${p}: ${JSON.stringify(j.errors)}`); return j.result; };
const account = (await cf("/accounts"))[0].id;
for (const w of ["prod", "sim"]) {
  const d = ((await cf(`/accounts/${account}/workers/scripts/${SCRIPTS[w]}/deployments`)).deployments ?? [])[0];
  const v = (d?.versions ?? []).find((x) => x.percentage === 100) ?? d?.versions?.[0];
  const sched = ((await cf(`/accounts/${account}/workers/scripts/${SCRIPTS[w]}/schedules`)).schedules ?? []).map((s) => s.cron);
  let health = null;
  for (let i = 0; i < 3; i++) {
    health = await fetch(`https://${HOSTS[w]}/health`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })).catch((e) => ({ status: 0, body: { error: String(e) } }));
    if (health.status === 200 && health.body?.status === "ok") break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  out[w] = { version: v?.version_id ?? null, deployedAt: d?.created_on ?? null, schedules: sched, health: { status: health.status, state: health.body?.status, odoo: health.body?.odoo } };
  console.log(`${w}: version ${String(v?.version_id).slice(0, 8)} · schedules ${sched.length} · /health ${health.status} ${health.body?.status} ${health.body?.odoo ?? ""}`);
}

// ---- Meta
const ph = await (await fetch(`https://graph.facebook.com/v22.0/${PHONE}?fields=webhook_configuration`, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } })).json();
out.metaPhoneWebhook = ph?.webhook_configuration ?? { error: ph?.error?.message ?? "?" };
console.log(`Meta phone webhook_configuration → ${JSON.stringify(out.metaPhoneWebhook)}`);

// ---- Odoo
const hostOf = (text) => (String(text ?? "").includes(HOSTS.sim) ? "sim" : String(text ?? "").includes(HOSTS.prod) ? "prod" : null);
out.odoo = { prod: [], sim: [] };
const scan = async (model, fields, texts, domain) => {
  const rows = await call(model, "search_read", { domain, fields, context: { active_test: false } });
  for (const r of rows) for (const f of texts) {
    const h = hostOf(r[f]);
    if (h) out.odoo[h].push(`${model} #${r.id} ${r.name ?? r.key ?? ""} (${f})`);
  }
};
const either = (f) => ["|", [f, "ilike", HOSTS.sim], [f, "ilike", HOSTS.prod]];
await scan("ir.actions.server", ["id", "name", "webhook_url", "code"], ["webhook_url", "code"], ["|", ...either("webhook_url"), ...either("code")]);
const bf = await call("base.automation", "fields_get", { attributes: ["type"] });
if ("url" in bf) await scan("base.automation", ["id", "name", "url"], ["url"], []);
await scan("ir.cron", ["id", "name", "code"], ["code"], either("code"));
await scan("ir.config_parameter", ["id", "key", "value"], ["value"], either("value"));
const actions = new Set(out.odoo.prod.filter((l) => l.startsWith("ir.actions.server")).map((l) => l.split(" ")[1]));
out.odooProdActions = actions.size;
console.log(`Odoo links → prod ${out.odoo.prod.length} (ir.actions.server: ${actions.size}) · sim ${out.odoo.sim.length}`);
for (const l of out.odoo.sim) console.log(`  ✗ sim: ${l}`);
writeFileSync(new URL(`scripts/artifacts/s47-20261001-${label}.json`, root), JSON.stringify(out, null, 2) + "\n");
