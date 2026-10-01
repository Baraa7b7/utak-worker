// § 43 (2026-09-27) — read-only launch checks: step 0 and part (أ). GET only on
// Cloudflare and Meta; search_read / read only on Odoo. No secret value is
// printed or written: every comparison reports the name and «مطابق / غير مطابق».
//
//   node scripts/archive/s43-20260927-precheck.mjs <label>
//
//   Cloudflare  the deployed version and the schedules of utak-worker (prod) and
//               utak-worker-sim, and the secret NAMES on both.
//   Meta        the phone number's webhook_configuration and the WABA's
//               subscribed apps (system token, .env.sim-verify); then, with the
//               app token (app_id|META_APP_SECRET from .env.prod-launch, sent in
//               the Authorization header, never in a URL): GET /{app} (the
//               secret is valid) and GET /{app}/subscriptions (callback + fields).
//   Odoo        every base.automation / ir.actions.server / ir.cron /
//               ir.config_parameter that carries a worker host or one of the four
//               token names: its host (sim / prod / other), the route, which
//               secret the route expects (from src/index.ts), and whether the
//               token it carries equals that secret's value in .env.prod-launch.
//
// Out: scripts/artifacts/s43-20260927-precheck-<label>.json (names and verdicts only).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const label = process.argv[2] || "snapshot";
const root = new URL("../../", import.meta.url);
const dotenv = (f) => Object.fromEntries(readFileSync(new URL(f, root), "utf8").split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#") && l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sv = dotenv(".env.sim-verify");
const launch = dotenv(".env.prod-launch");
const SECRETS = ["ODOO_HOOK_TOKEN", "SALE_PDF_DOWNLOAD_TOKEN", "SIM_SECRET", "INTERNAL_WEBHOOK_SECRET", "META_APP_SECRET", "META_VERIFY_TOKEN"];
for (const k of SECRETS) if (!launch[k]) throw new Error(`.env.prod-launch: ${k} missing or empty`);

const PROD_HOST = "utak-worker.utak-business.workers.dev";
const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";
const APP_ID = "2331128704328678";
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const tv = (k) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(toml) ?? [])[1] ?? "";
const PHONE = tv("META_PHONE_NUMBER_ID"), WABA = tv("META_WABA_ID"), GV = tv("META_GRAPH_VERSION");

// ---------------------------------------------------------------- Cloudflare
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
    schedules: sched,
    secretNames: secrets,
  };
};
const cloudflare = { prod: await worker("utak-worker"), sim: await worker("utak-worker-sim") };
cloudflare.prodMissing = SECRETS.filter((k) => !cloudflare.prod.secretNames.includes(k));

// ---------------------------------------------------------------- Meta (GET only)
const graph = async (path, token) => {
  const r = await fetch(`https://graph.facebook.com/${GV}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
};
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u ?? ""); } };
const phone = await graph(`${PHONE}?fields=webhook_configuration`, sv.META_ACCESS_TOKEN);
const subscribed = await graph(`${WABA}/subscribed_apps`, sv.META_ACCESS_TOKEN);
const appToken = `${APP_ID}|${launch.META_APP_SECRET}`;
const app = await graph(`${APP_ID}?fields=id,name`, appToken);
const subs = await graph(`${APP_ID}/subscriptions`, appToken);
const waSub = (subs.body?.data ?? []).find((s) => s.object === "whatsapp_business_account") ?? null;
const meta = {
  phoneWebhook: phone.status === 200 ? Object.fromEntries(Object.entries(phone.body.webhook_configuration ?? {}).map(([k, v]) => [k, v])) : { error: phone.status, message: phone.body?.error?.message },
  wabaSubscribedApps: subscribed.status === 200 ? (subscribed.body.data ?? []).map((a) => ({ id: a.whatsapp_business_api_data?.id, name: a.whatsapp_business_api_data?.name, override_callback_uri: a.override_callback_uri ?? null })) : { error: subscribed.status },
  appSecret: app.status === 200 && app.body?.id === APP_ID ? "صالح" : `غير صالح (HTTP ${app.status}: ${app.body?.error?.message ?? "?"})`,
  appName: app.body?.name ?? null,
  appSubscription: waSub ? { object: waSub.object, callback_url: waSub.callback_url, host: hostOf(waSub.callback_url), active: waSub.active, fields: (waSub.fields ?? []).map((f) => f.name).sort() } : (subs.status === 200 ? null : { error: subs.status, message: subs.body?.error?.message }),
};
meta.pointsTo = [meta.phoneWebhook?.application, meta.appSubscription?.callback_url].map(hostOf).map((h) => h === SIM_HOST ? "sim" : h === PROD_HOST ? "prod" : h || "—");

// ---------------------------------------------------------------- Odoo (reads only)
const odoo = async (model, method, body) => {
  for (let i = 0; ; i++) {
    const r = await fetch(`${sv.ODOO_URL}/json/2/${model}/${method}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sv.ODOO_API_KEY}` }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (r.status === 429 && i < 5) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
    throw new Error(`${model}.${method} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
};
// which secret each route expects (src/index.ts, src/sim.ts)
const expectedFor = (path) => {
  if (/^\/internal\/(quotation-issue|receipt-issue|official-doc\/)/.test(path)) return "INTERNAL_WEBHOOK_SECRET";
  if (/^\/internal\/(quotation-wa-send|sale-quotation-wa-send)$/.test(path) || /^\/odoo\/hook\//.test(path)) return "ODOO_HOOK_TOKEN";
  if (/^\/internal\/(sale-quotation-pdf|invoice-pdf|purchase-order-pdf)$/.test(path)) return "SALE_PDF_DOWNLOAD_TOKEN";
  if (/^\/sim\//.test(path)) return "SIM_SECRET";
  return null;
};
const TOKEN_NAMES = ["ODOO_HOOK_TOKEN", "INTERNAL_WEBHOOK_SECRET", "SIM_SECRET", "SALE_PDF_DOWNLOAD_TOKEN"];
const nameOfValue = (v) => SECRETS.filter((k) => launch[k] === v);
const inspect = (text) => {
  const t = String(text ?? "");
  const urls = [...t.matchAll(/https?:\/\/[^\s"'<>)]+/g)].filter((m) => /workers\.dev|utak-worker/.test(m[0]));
  return urls.map((m) => {
    let url; try { url = new URL(m[0]); } catch { return { host: "?", path: "?" }; }
    const host = url.host === SIM_HOST ? "sim" : url.host === PROD_HOST ? "prod" : url.host;
    const expected = expectedFor(url.pathname);
    // in the URL itself, or (a code action: 'https://…?id=' + str(record.id) + '&token=…') in the 200 characters after it
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 200).split(/\n/)[0];
    const carried = url.searchParams.get("token") ?? url.searchParams.get("secret") ?? (/[?&](?:token|secret)=([A-Za-z0-9._~+/=-]+)/.exec(tail) ?? [])[1] ?? null;
    const carriedIs = carried == null ? [] : nameOfValue(carried);
    return {
      host, path: url.pathname, expects: expected,
      token: carried == null ? "بلا توكن" : expected ? (launch[expected] === carried ? "مطابق" : "غير مطابق") : (carriedIs.length ? `يساوي ${carriedIs.join("/")}` : "لا يساوي أي قيمة في الملف"),
      // a mismatch that equals another secret of the file (a swap) is named; the value never is
      ...(expected && carried != null && launch[expected] !== carried ? { carriedEquals: carriedIs.length ? carriedIs.join("/") : "لا شيء في الملف" } : {}),
    };
  });
};
const found = [];
const scan = async (model, fields, domain, texts) => {
  const rows = await odoo(model, "search_read", { domain, fields, context: { active_test: false } });
  for (const r of rows) {
    const text = texts.map((f) => r[f] || "").join("\n");
    const names = TOKEN_NAMES.filter((n) => text.includes(n));
    const values = TOKEN_NAMES.filter((n) => text.includes(launch[n]));
    const links = inspect(text);
    if (!links.length && !names.length && !values.length) continue;
    // a header / variable that carries a token outside a URL (e.g. "X-Admin-Token": "…")
    const headerTokens = [...text.matchAll(/(x-admin-token|x-sim-secret|token|secret)["']?\s*[:=]\s*["']([A-Za-z0-9._~+/=-]{12,})["']/gi)]
      .map((m) => ({ key: m[1], is: nameOfValue(m[2]).join("/") || "لا يساوي أي قيمة في الملف" }));
    found.push({
      model, id: r.id, name: r.name ?? r.key, active: r.active ?? null, state: r.state ?? null,
      links, namesMentioned: names, fileValuesPresent: values, headerTokens,
    });
  }
};
await scan("ir.actions.server", ["id", "name", "state", "webhook_url", "code", "model_name"], ["|", "|", ["webhook_url", "!=", false], ["code", "ilike", "workers.dev"], ["code", "ilike", "token"]], ["webhook_url", "code"]);
await scan("base.automation", ["id", "name", "active", "url", "action_server_ids", "model_name"], [], ["url"]);
await scan("ir.cron", ["id", "name", "active", "code", "ir_actions_server_id"], [], ["code"]);
await scan("ir.config_parameter", ["id", "key", "value"], [], ["key", "value"]);
// automations linked to the server actions found
const saIds = new Set(found.filter((f) => f.model === "ir.actions.server").map((f) => f.id));
const autos = await odoo("base.automation", "search_read", { domain: [], fields: ["id", "name", "active", "action_server_ids", "model_name", "trigger"], context: { active_test: false } });
const linked = autos.filter((a) => (a.action_server_ids ?? []).some((id) => saIds.has(id))).map((a) => ({ id: a.id, name: a.name, active: a.active, model: a.model_name, trigger: a.trigger, actions: a.action_server_ids.filter((id) => saIds.has(id)) }));

// per-secret verdict over every link that expects it
const verdict = {};
for (const n of TOKEN_NAMES) {
  const ls = found.flatMap((f) => f.links.filter((l) => l.expects === n).map((l) => ({ where: `${f.model} #${f.id}`, host: l.host, path: l.path, token: l.token })));
  verdict[n] = ls.length ? { records: ls.length, match: ls.filter((l) => l.token === "مطابق").length, mismatch: ls.filter((l) => l.token === "غير مطابق").length, noToken: ls.filter((l) => l.token === "بلا توكن").length } : "لا يوجد في Odoo";
}

const out = {
  label, at: new Date().toISOString(), riyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " "),
  cloudflare, meta, odoo: { found, linkedAutomations: linked, verdict, simHostRecords: found.filter((f) => f.links.some((l) => l.host === "sim")).map((f) => `${f.model} #${f.id}`) },
};
writeFileSync(new URL(`scripts/artifacts/s43-20260927-precheck-${label}.json`, root), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
