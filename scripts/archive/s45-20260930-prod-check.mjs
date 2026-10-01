// § 45 و / ز (2026-09-30) — read-only checks of both workers: the active version and the schedules
// (Cloudflare API), /health (Odoo connected), the GET /webhook verify challenge with the
// META_VERIFY_TOKEN of .env.prod-launch (never printed: «مطابق / غير مطابق» only), and Meta's
// subscription callback (GET with the app token from the same file).
//
//   node scripts/archive/s45-20260930-prod-check.mjs <label>
//
// Out: scripts/artifacts/s45-20260930-prod-check-<label>.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const label = process.argv[2] ?? "check";
const dotenv = (f) => Object.fromEntries(readFileSync(new URL(f, root), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const launch = existsSync(new URL(".env.prod-launch", root)) ? dotenv(".env.prod-launch") : {};
const HOSTS = { prod: "utak-worker.utak-business.workers.dev", sim: "utak-worker-sim.utak-business.workers.dev" };
const SCRIPTS = { prod: "utak-worker", sim: "utak-worker-sim" };
const APP_ID = "2331128704328678";

spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" });
const tok = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) ?? [])[1];
const cf = async (p) => { const j = await (await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: { Authorization: `Bearer ${tok}` } })).json(); if (!j.success) throw new Error(`${p}: ${JSON.stringify(j.errors)}`); return j.result; };
const account = (await cf("/accounts"))[0].id;
const out = { label, atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };
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
  let challenge = "لا توكن في الملف";
  if (launch.META_VERIFY_TOKEN) {
    const ch = `s45-${randomBytes(6).toString("hex")}`;
    const u = new URL(`https://${HOSTS[w]}/webhook`);
    u.searchParams.set("hub.mode", "subscribe"); u.searchParams.set("hub.verify_token", launch.META_VERIFY_TOKEN); u.searchParams.set("hub.challenge", ch);
    const r = await fetch(u);
    challenge = r.status === 200 && (await r.text()) === ch ? "مطابق" : `غير مطابق (HTTP ${r.status})`;
  }
  out[w] = { version: v?.version_id ?? null, deployedAt: d?.created_on ?? null, schedules: sched, health: { status: health.status, state: health.body?.status, odoo: health.body?.odoo, mode: health.body?.mode ?? health.body?.runtime ?? null }, challenge };
  console.log(`${w}: version ${String(v?.version_id).slice(0, 8)} · schedules ${sched.length} · /health ${health.status} ${health.body?.status} ${health.body?.odoo ?? ""} · challenge ${challenge}`);
}
if (launch.META_APP_SECRET) {
  const s = await (await fetch(`https://graph.facebook.com/v22.0/${APP_ID}/subscriptions`, { headers: { Authorization: `Bearer ${APP_ID}|${launch.META_APP_SECRET}` } })).json();
  const wa = (s.data ?? []).find((x) => x.object === "whatsapp_business_account");
  out.metaSubscription = wa ? { callback: wa.callback_url, active: wa.active } : null;
  console.log(`Meta subscription → ${wa?.callback_url ?? "?"} (active ${wa?.active})`);
}
writeFileSync(new URL(`scripts/artifacts/s45-20260930-prod-check-${label}.json`, root), JSON.stringify(out, null, 2) + "\n");
