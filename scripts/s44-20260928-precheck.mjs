// § 44 (2026-09-28) — step-0 read-only checks. GET only on Cloudflare and Meta.
// Unlike s43's precheck it never opens .env.prod-launch (the § 44 order forbids it):
// Meta is read with the system token from .env.sim-verify only.
//
//   node scripts/s44-20260928-precheck.mjs <label>
// Out: scripts/artifacts/s44-20260928-precheck-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const label = process.argv[2] || "snapshot";
const root = new URL("../", import.meta.url);
const dotenv = (f) => Object.fromEntries(readFileSync(new URL(f, root), "utf8").split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#") && l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sv = dotenv(".env.sim-verify");
const PROD_HOST = "utak-worker.utak-business.workers.dev";
const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const tv = (k) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(toml) ?? [])[1] ?? "";
const PHONE = tv("META_PHONE_NUMBER_ID"), WABA = tv("META_WABA_ID"), GV = tv("META_GRAPH_VERSION");

const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8");
const cfToken = (/oauth_token\s*=\s*"([^"]+)"/.exec(cfg) || [])[1];
if (!cfToken) throw new Error("no wrangler oauth_token — run `npx wrangler whoami` first");
const cf = async (path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${cfToken}` } });
  const j = await r.json();
  if (!j.success) throw new Error(`${path}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.result;
};
const account = (await cf("/accounts"))[0].id;
const worker = async (name) => {
  const dep = ((await cf(`/accounts/${account}/workers/scripts/${name}/deployments`)).deployments ?? [])[0];
  const sched = ((await cf(`/accounts/${account}/workers/scripts/${name}/schedules`)).schedules ?? []).map((s) => s.cron);
  const secrets = (await cf(`/accounts/${account}/workers/scripts/${name}/secrets`)).map((s) => s.name).sort();
  return {
    deployed: dep ? { created_on: dep.created_on, versions: (dep.versions ?? []).map((v) => `${v.version_id.slice(0, 8)} ${v.percentage}%`) } : null,
    schedules: sched, secretNames: secrets,
  };
};
const cloudflare = { prod: await worker("utak-worker"), sim: await worker("utak-worker-sim") };

const graph = async (path, token) => {
  const r = await fetch(`https://graph.facebook.com/${GV}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u ?? ""); } };
const phone = await graph(`${PHONE}?fields=webhook_configuration`, sv.META_ACCESS_TOKEN);
const subscribed = await graph(`${WABA}/subscribed_apps`, sv.META_ACCESS_TOKEN);
const meta = {
  phoneWebhook: phone.status === 200 ? phone.body.webhook_configuration ?? {} : { error: phone.status, message: phone.body?.error?.message },
  wabaSubscribedApps: subscribed.status === 200 ? (subscribed.body.data ?? []).map((a) => ({ id: a.whatsapp_business_api_data?.id, name: a.whatsapp_business_api_data?.name, override_callback_uri: a.override_callback_uri ?? null })) : { error: subscribed.status },
};
meta.pointsTo = hostOf(meta.phoneWebhook?.application) === SIM_HOST ? "sim" : hostOf(meta.phoneWebhook?.application) === PROD_HOST ? "prod" : hostOf(meta.phoneWebhook?.application) || "—";

const health = {};
for (const [k, h] of [["sim", SIM_HOST], ["prod", PROD_HOST]]) {
  const r = await fetch(`https://${h}/health`).catch((e) => ({ status: `ERR ${e.message}` }));
  health[k] = { status: r.status, body: r.text ? (await r.text()).slice(0, 300) : null };
}
const out = { label, at: new Date().toISOString(), riyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " "), cloudflare, meta, health };
writeFileSync(new URL(`scripts/artifacts/s44-20260928-precheck-${label}.json`, root), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
