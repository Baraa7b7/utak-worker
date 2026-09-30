// § 43 و (2026-09-27) — the cutover: sim → prod, in four steps, each with its
// rollback file, and an automatic rollback of every completed step when one
// fails. The dry run (default) does every read and prints every planned change;
// --apply writes, and only when it STARTS between 22:35 and 01:40 Riyadh.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts            dry run
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts --apply    the cutover
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts --apply --now
//                                                                             § 45 ز (Baraa, 2026-09-30 18:2x): the cutover outside
//                                                                             22:35–01:40, on his word, after the read-only gate
//                                                                             scripts/s45-20260930-cutover-precheck.mjs passed
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts --rollback [--apply]
//                                                                             undo the last --apply run from its rollback files
//
// Before the first write (reads only):
//   · the time (the window), git (branch main = origin/main, no modified tracked file), the six values of
//     .env.prod-launch (never printed: names and «مطابق / غير مطابق» only)
//   · Cloudflare: prod has [] and sim the twelve; the active versions (the rollback targets)
//   · Meta: the app secret is valid; the app's whatsapp_business_account subscription (callback + fields);
//     prod AND sim both answer the verify challenge with the file's META_VERIFY_TOKEN (so step 1 and its
//     rollback can both pass Meta's check)
//   · prod /health (ok, Odoo connected)
//   · Odoo: every ir.actions.server / base.automation / ir.cron / ir.config_parameter carrying the sim
//     host → its planned value (host → prod, the token → the file's value for the secret its route expects)
//   · sim's KV queues (read only — listed, never moved): wa_q:v1:* (the held messages), pending_loc:*
//     (the team's deferred tasks), cpay_open:v1 (open collections)
//   · § 45 هـ — the 24h windows: the gateway reads them from the worker's OWN KV (src/wa-window.ts,
//     wa_win:v1:<digits>; Odoo only when the key is missing), and prod's KV is not sim's — every
//     wa_win:v1:* of sim, listed (masked) with what step 2ب would write on prod
//   · the re-mark, dry: what `s42-20260927-prelaunch-mark.mts mark` would flag now — never a record linked
//     to a real customer (§ 44 ب: scripts/lib/real-partners.mjs, #31 and #105; the mark script leaves them out)
//
// The steps (--apply), in this order; a failure rolls back every step before it, then stops:
//   1. Meta: POST /{app}/subscriptions — callback https://<prod>/webhook, the same fields, the file's
//      verify_token. Verified: the subscription and the phone's webhook_configuration point to prod.
//      Rollback: the same call with the previous callback (sim).
//   2. Odoo: every record carrying the sim host → the prod host, and every token that is not the file's
//      value → the file's value. Before / after listed with the tokens masked. Rollback: the original
//      values, written back (kept in backups/cutover-prod-odoo-originals-<ts>.json, mode 600, outside
//      git: they carry sim's tokens; the artifact keeps only masked values and sha256).
//   2ب. § 45 هـ — the windows: every wa_win:v1:* of sim's KV → prod's KV, merged with prod's own key
//      (mergeWindowRecords: the newest inbound and the newest 131047 — after step 1 new inbounds land on
//      prod, so nothing is lost and nothing reopened), with the key's expiry (windowRecordUntil).
//      Verified: each key read back from prod. Rollback: prod's previous value back, or the key removed.
//   3. sim: [env.sim.triggers] crons = [] in wrangler.toml, `wrangler deploy --env sim`. Verified: sim's
//      schedules []. Rollback: wrangler.toml back, sim's schedules (the twelve) and its previous version
//      (Cloudflare API).
//      3ب. The re-mark, now that sim is quiet (90 s for an in-flight tick): backup ← mark --apply ← verify,
//      with the account counts read before step 1. Its marks are not rolled back (they are right either
//      way — § 39 / § 42 rule); a failed verify rolls back 3, 2 and 1.
//   4. prod: [triggers] crons = the twelve lines sim had (comments included), `wrangler deploy`. Verified:
//      prod's schedules = the twelve, and tests/cron-blocks.mts reads «prod» as the active block (the
//      tests pin «the twelve on exactly one worker», so none needs editing). Rollback: wrangler.toml as
//      after step 3, prod's schedules [] and its previous version.
// Then (reads): the subscription → prod; the first */5 tick ran on prod and nothing on sim after step 3
// (Cloudflare analytics, polled up to 12 minutes); prod /health; sim's schedules []. All green → the
// file .env.prod-launch is deleted. Not green → nothing is rolled back automatically (every step was
// verified on its own); the report says what failed and the --rollback command.
//
// No WhatsApp message is sent. Nothing is deleted in Odoo. No tax setting, no module.
// Out: scripts/artifacts/cutover-prod/<run>/ (plan.json, step rollback files, report.json).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { cronBlocks, TWELVE } from "../tests/cron-blocks.mts";
// @ts-ignore — plain .mjs helper (retries 429 like src/odoo.ts)
import { call } from "./lib/odoo-cli.mjs";
// @ts-ignore — plain .mjs helper (§ 44 ب: the real customers the re-mark never marks)
import { REAL_PARTNER_IDS } from "./lib/real-partners.mjs";
import { evaluateWindow, mergeWindowRecords, windowRecordUntil, type WindowRecord } from "../src/wa-window.ts";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
/** § 45 ز — Baraa moved the cutover to now (he approves now, not tonight): the window check is waived, and said so. */
const NOW_FLAG = process.argv.includes("--now");
const root = new URL("../", import.meta.url);
const rel = (p: string) => new URL(p, root);
const log = (...a: unknown[]) => console.log(...a);
const now = () => new Date();
const riyadh = (d: Date = now()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
const riyadhMinutes = (d: Date = now()) => { const r = new Date(d.getTime() + 3 * 3600_000); return r.getUTCHours() * 60 + r.getUTCMinutes(); };
const inWindow = (m: number) => m >= 22 * 60 + 35 || m <= 1 * 60 + 40;
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const PROD_HOST = "utak-worker.utak-business.workers.dev";
const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";
const PROD_WEBHOOK = `https://${PROD_HOST}/webhook`;
const APP_ID = "2331128704328678";
const SIM_KV = "998122f32d7b46c2a45cf01acec3cb0e";
const PROD_KV = "1e77d51cf1154af1aef076d1d31905a6";
const WIN_PREFIX = "wa_win:v1:";
const SECRETS = ["ODOO_HOOK_TOKEN", "SALE_PDF_DOWNLOAD_TOKEN", "SIM_SECRET", "INTERNAL_WEBHOOK_SECRET", "META_APP_SECRET", "META_VERIFY_TOKEN"] as const;

const dotenv = (f: string): Record<string, string> => Object.fromEntries(readFileSync(rel(f), "utf8").split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#") && l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sv = dotenv(".env.sim-verify");
const toml0 = readFileSync(rel("wrangler.toml"), "utf8");
const tv = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(toml0) ?? [])[1] ?? "";
const PHONE = tv("META_PHONE_NUMBER_ID"), GV = tv("META_GRAPH_VERSION");

// ---------------------------------------------------------------- run folder
const RUNS = rel("scripts/artifacts/cutover-prod/");
const runId = riyadh().replace(/[-: ]/g, "").slice(0, 12);
const runDir = new URL(`${ROLLBACK ? "rollback-" : APPLY ? "apply-" : "dry-"}${runId}/`, RUNS);
mkdirSync(runDir, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(new URL(name, runDir), JSON.stringify(data, null, 2) + "\n");
const report: Record<string, unknown> = { run: runDir.pathname.split("/").slice(-2, -1)[0], mode: ROLLBACK ? "rollback" : APPLY ? "apply" : "dry-run", startedRiyadh: riyadh() };

// ---------------------------------------------------------------- Cloudflare
spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" }); // refreshes the OAuth token
// § 45 ز — read on every call, never cached: `wrangler deploy` (steps 3 and 4) renews the OAuth token and the
// old one stops working at once (the 18:36 run: step 4's schedules read, and every Cloudflare rollback after
// it, «Authentication error» — the rollback of 4, 3 and 2ب left undone until --rollback ran with the new token).
const WRANGLER_CFG = `${homedir()}/Library/Preferences/.wrangler/config/default.toml`;
const cfToken = (): string => {
  const t = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(WRANGLER_CFG, "utf8")) ?? [])[1];
  if (!t) throw new Error("no wrangler oauth_token");
  return t;
};
cfToken();
const cf = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${cfToken()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const j: any = await r.json();
  if (!j.success) throw new Error(`Cloudflare ${path}: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.result;
};
const account: string = (await cf("/accounts"))[0].id;
const schedules = async (name: string): Promise<string[]> => ((await cf(`/accounts/${account}/workers/scripts/${name}/schedules`)).schedules ?? []).map((s: any) => s.cron);
const putSchedules = async (name: string, crons: readonly string[]) => cf(`/accounts/${account}/workers/scripts/${name}/schedules`, { method: "PUT", body: JSON.stringify(crons.map((cron) => ({ cron }))) });
const activeVersion = async (name: string): Promise<string> => {
  const d = ((await cf(`/accounts/${account}/workers/scripts/${name}/deployments`)).deployments ?? [])[0];
  const v = (d?.versions ?? []).find((x: any) => x.percentage === 100) ?? d?.versions?.[0];
  if (!v) throw new Error(`${name}: no active version`);
  return v.version_id;
};
const redeployVersion = async (name: string, versionId: string, why: string) => cf(`/accounts/${account}/workers/scripts/${name}/deployments`, {
  method: "POST", body: JSON.stringify({ strategy: "percentage", versions: [{ version_id: versionId, percentage: 100 }], annotations: { "workers/message": why.slice(0, 100) } }),
});
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const invocationsSince = async (sinceIso: string) => {
  const q = `query($a:String!,$s:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsScheduled(limit:200,filter:{datetime_geq:$s},orderBy:[datetime_ASC]){scriptName cron status datetime}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${cfToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: { a: account, s: sinceIso } }) });
  const j: any = await r.json();
  if (j.errors) throw new Error(`analytics: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return (j.data?.viewer?.accounts?.[0]?.workersInvocationsScheduled ?? []) as Array<{ scriptName: string; cron: string; status: string; datetime: string }>;
};
const kvUrl = (ns: string, key: string) => `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;
const kvGet = async (key: string, ns: string = SIM_KV): Promise<string | null> => {
  const r = await fetch(kvUrl(ns, key), { headers: { Authorization: `Bearer ${cfToken()}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV get ${ns.slice(0, 6)} ${key.split(":").slice(0, 2).join(":")}: HTTP ${r.status}`);
  return r.text();
};
const kvKeys = async (prefix: string, ns: string = SIM_KV): Promise<string[]> => {
  const out: string[] = [];
  let cursor = "";
  do {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`, { headers: { Authorization: `Bearer ${cfToken()}` } });
    const j: any = await r.json();
    if (!j.success) throw new Error(`KV list ${ns.slice(0, 6)} ${prefix}: ${JSON.stringify(j.errors).slice(0, 200)}`);
    out.push(...(j.result ?? []).map((k: any) => k.name));
    cursor = j.result_info?.cursor ?? "";
  } while (cursor);
  return out;
};
/** § 45 هـ — a KV write with an absolute expiry (unix seconds). */
const kvPut = async (ns: string, key: string, value: string, expirationMs: number) => {
  const r = await fetch(`${kvUrl(ns, key)}?expiration=${Math.ceil(expirationMs / 1000)}`, { method: "PUT", headers: { Authorization: `Bearer ${cfToken()}`, "Content-Type": "text/plain" }, body: value });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(`KV put ${ns.slice(0, 6)} ${key.split(":").slice(0, 2).join(":")}: HTTP ${r.status} ${JSON.stringify(j.errors ?? "").slice(0, 160)}`);
};
const kvDelete = async (ns: string, key: string) => {
  const r = await fetch(kvUrl(ns, key), { method: "DELETE", headers: { Authorization: `Bearer ${cfToken()}` } });
  if (!r.ok && r.status !== 404) throw new Error(`KV delete ${ns.slice(0, 6)}: HTTP ${r.status}`);
};
const parseWin = (raw: string | null): WindowRecord | null => {
  if (!raw) return null;
  try { const j = JSON.parse(raw); return { in: Number(j?.in) || 0, ...(Number(j?.closed) ? { closed: Number(j.closed) } : {}) }; } catch { return null; }
};
/** § 45 هـ — sim's windows and what step 2ب writes on prod (merged with prod's own key). */
async function windowPlan(): Promise<Array<{ key: string; sim: WindowRecord; prodBefore: string | null; merged: WindowRecord; until: number; open: boolean }>> {
  const out = [];
  for (const key of await kvKeys(WIN_PREFIX, SIM_KV)) {
    const sim = parseWin(await kvGet(key, SIM_KV));
    if (!sim) continue;
    const prodBefore = await kvGet(key, PROD_KV);
    const merged = mergeWindowRecords(sim, parseWin(prodBefore))!;
    const until = windowRecordUntil(merged);
    if (until <= Date.now() + 60_000) continue; // gone within the minute anyway
    out.push({ key, sim, prodBefore, merged, until, open: evaluateWindow(merged).open });
  }
  return out;
}

// ---------------------------------------------------------------- Meta
const graph = async (path: string, token: string, init: RequestInit = {}) => {
  const r = await fetch(`https://graph.facebook.com/${GV}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const readSubscription = async (appToken: string) => {
  const s = await graph(`${APP_ID}/subscriptions`, appToken);
  const w = (s.body?.data ?? []).find((x: any) => x.object === "whatsapp_business_account");
  if (s.status !== 200 || !w) throw new Error(`Meta subscriptions: HTTP ${s.status} ${s.body?.error?.message ?? "no whatsapp_business_account subscription"}`);
  return { callback_url: String(w.callback_url), fields: (w.fields ?? []).map((f: any) => f.name).sort() as string[], active: w.active === true };
};
const phoneWebhook = async () => String((await graph(`${PHONE}?fields=webhook_configuration`, sv.META_ACCESS_TOKEN)).body?.webhook_configuration?.application ?? "");
const challenge = async (host: string, verifyToken: string): Promise<boolean> => {
  const ch = `s43-${randomBytes(6).toString("hex")}`;
  const u = new URL(`https://${host}/webhook`);
  u.searchParams.set("hub.mode", "subscribe"); u.searchParams.set("hub.verify_token", verifyToken); u.searchParams.set("hub.challenge", ch);
  const r = await fetch(u);
  return r.status === 200 && (await r.text()) === ch;
};
const subscribe = async (appToken: string, callbackUrl: string, fields: string[], verifyToken: string) => {
  const body = new URLSearchParams({ object: "whatsapp_business_account", callback_url: callbackUrl, fields: fields.join(","), verify_token: verifyToken, include_values: "true" });
  const r = await graph(`${APP_ID}/subscriptions`, appToken, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (r.status !== 200 || r.body?.success !== true) throw new Error(`Meta subscribe → ${new URL(callbackUrl).host}: HTTP ${r.status} ${r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 120)}`);
};

// ---------------------------------------------------------------- Odoo: the records carrying the sim host
/** Which secret each worker route expects (src/index.ts, src/sim.ts). */
const expectedFor = (path: string): (typeof SECRETS)[number] | null => {
  if (/^\/internal\/(quotation-issue|receipt-issue|official-doc\/)/.test(path)) return "INTERNAL_WEBHOOK_SECRET";
  if (/^\/internal\/(quotation-wa-send|sale-quotation-wa-send)$/.test(path) || /^\/odoo\/hook\//.test(path)) return "ODOO_HOOK_TOKEN";
  if (/^\/internal\/(sale-quotation-pdf|invoice-pdf|purchase-order-pdf)$/.test(path)) return "SALE_PDF_DOWNLOAD_TOKEN";
  if (/^\/sim\//.test(path)) return "SIM_SECRET";
  return null;
};
const TOKEN_RE = /([?&](?:token|secret)=)([A-Za-z0-9._~+/=%-]+)/g;
const maskTokens = (s: string) => String(s ?? "").replace(TOKEN_RE, "$1***");
/**
 * The new value of one field: every worker URL on the sim host → the prod host, and the token that
 * follows it (in the URL, or a code action's `'…?id=' + str(record.id) + '&token=…'`) → the file's
 * value for the secret the route expects. A token already equal to it is left as it is.
 */
function rewrite(text: string, launch: Record<string, string>): { value: string; links: Array<{ path: string; expects: string | null; token: "مطابق" | "غير مطابق → قيمة الملف" | "بلا توكن" }> } {
  const links: Array<{ path: string; expects: string | null; token: "مطابق" | "غير مطابق → قيمة الملف" | "بلا توكن" }> = [];
  let out = "";
  let last = 0;
  const re = new RegExp(`https://${SIM_HOST.replace(/\./g, "\\.")}(/[A-Za-z0-9/_.-]*)`, "g");
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    const path = m[1];
    const expects = expectedFor(path);
    // the rest of this line, up to the next URL on it
    const lineEnd = text.indexOf("\n", re.lastIndex) < 0 ? text.length : text.indexOf("\n", re.lastIndex);
    const nextUrl = text.slice(re.lastIndex, lineEnd).search(/https?:\/\//);
    const segEnd = nextUrl < 0 ? lineEnd : re.lastIndex + nextUrl;
    let seg = text.slice(re.lastIndex, segEnd);
    let token: "مطابق" | "غير مطابق → قيمة الملف" | "بلا توكن" = "بلا توكن";
    seg = seg.replace(new RegExp(TOKEN_RE.source), (_all, pre: string, val: string) => {
      if (!expects) { token = "بلا توكن"; return `${pre}${val}`; }
      const want = /^[A-Za-z0-9._~-]+$/.test(launch[expects]) ? launch[expects] : encodeURIComponent(launch[expects]);
      token = val === want ? "مطابق" : "غير مطابق → قيمة الملف";
      return `${pre}${want}`;
    });
    links.push({ path, expects, token });
    out += text.slice(last, m.index) + `https://${PROD_HOST}${path}` + seg;
    last = segEnd;
    re.lastIndex = segEnd;
  }
  return { value: out + text.slice(last), links };
}
type Target = { model: string; id: number; name: string; field: string; original: string; planned: string; links: ReturnType<typeof rewrite>["links"] };
async function odooTargets(launch: Record<string, string>): Promise<Target[]> {
  const out: Target[] = [];
  const scan = async (model: string, fields: string[], textFields: string[], domain: unknown[]) => {
    const rows: any[] = await call(model, "search_read", { domain, fields, context: { active_test: false } });
    for (const r of rows) for (const f of textFields) {
      const v = typeof r[f] === "string" ? r[f] : "";
      if (!v.includes(SIM_HOST)) continue;
      const w = rewrite(v, launch);
      out.push({ model, id: r.id, name: String(r.name ?? r.key ?? ""), field: f, original: v, planned: w.value, links: w.links });
    }
  };
  await scan("ir.actions.server", ["id", "name", "webhook_url", "code"], ["webhook_url", "code"], ["|", ["webhook_url", "ilike", SIM_HOST], ["code", "ilike", SIM_HOST]]);
  const bf: Record<string, unknown> = await call("base.automation", "fields_get", { attributes: ["type"] });
  // base.automation.url is computed (not stored): read them all, filter here
  if ("url" in bf) await scan("base.automation", ["id", "name", "url"], ["url"], []);
  await scan("ir.cron", ["id", "name", "code"], ["code"], [["code", "ilike", SIM_HOST]]);
  await scan("ir.config_parameter", ["id", "key", "value"], ["value"], [["value", "ilike", SIM_HOST]]);
  return out;
}
const acctCounts = async () => ({ moves: (await call("account.move", "search_count", { domain: [] })) as number, payments: (await call("account.payment", "search_count", { domain: [] })) as number });

// ---------------------------------------------------------------- wrangler.toml
const SIM_BLOCK_RE = /(\[env\.sim\.triggers\]\n)crons = \[\n([\s\S]*?)\n\]/;
const PROD_BLOCK_RE = /(^\[triggers\]\n)crons = \[\]/m;
function tomlSimEmpty(toml: string, stamp: string): { toml: string; lines: string } {
  const m = SIM_BLOCK_RE.exec(toml);
  if (!m) throw new Error("wrangler.toml: [env.sim.triggers] crons = [ … ] not found");
  const kept = m[2].split("\n").map((l) => `#${l}`).join("\n");
  return { toml: toml.replace(SIM_BLOCK_RE, `$1# ${stamp} (STATUS § 43 و) — the cutover: sim's twelve moved to prod's [triggers]. Were:\n${kept}\ncrons = []`), lines: m[2] };
}
function tomlProdFilled(toml: string, lines: string, stamp: string): string {
  if (!PROD_BLOCK_RE.test(toml)) throw new Error("wrangler.toml: [triggers] crons = [] not found");
  return toml.replace(PROD_BLOCK_RE, `$1# ${stamp} (STATUS § 43 و) — the cutover: the twelve crons, as they were on [env.sim.triggers].\ncrons = [\n${lines}\n]`);
}
const deploy = (env: "sim" | "prod") => {
  const args = ["wrangler", "deploy", ...(env === "sim" ? ["--env", "sim"] : [])];
  const r = spawnSync("npx", args, { cwd: root, encoding: "utf8", timeout: 240_000 });
  spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" }); // the token is renewed on disk; cfToken() reads it
  const outText = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const version = (/Current Version ID:\s*([0-9a-f-]{36})/.exec(outText) ?? [])[1] ?? null;
  if (r.status !== 0 || !version) throw new Error(`wrangler deploy ${env}: exit ${r.status}${version ? "" : ", no version id"} — ${outText.split("\n").filter((l) => /error|✘/i.test(l)).slice(0, 3).join(" | ").slice(0, 300)}`);
  return version;
};

// ---------------------------------------------------------------- the s42 re-mark
const markStep = (args: string[]) => {
  const r = spawnSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", "scripts/s42-20260927-prelaunch-mark.mts", ...args], { cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout ?? ""}`.split("\n").filter((l) => l.trim() && !/HTTP 429|retry/.test(l));
  // § 45 ز — the first --apply (18:29) failed its verify with no ✗ and nothing on stdout to say why: keep stderr's tail
  const errTail = `${r.stderr ?? ""}`.split("\n").filter((l) => l.trim() && !/ExperimentalWarning|--import|trace-warnings|HTTP 429|retry in/.test(l)).slice(-3);
  const why = [r.error ? String(r.error.message ?? r.error) : "", r.signal ? `signal ${r.signal}` : "", r.status !== null && r.status !== 0 ? `exit ${r.status}` : "", ...errTail].filter(Boolean);
  return { ok: r.status === 0, lines, why };
};

// ================================================================ --rollback
if (ROLLBACK) {
  const runs = existsSync(RUNS) ? readdirSync(RUNS).filter((d) => d.startsWith("apply-")).sort() : [];
  const last = runs.at(-1);
  if (!last) throw new Error("no apply-* run to roll back");
  const dir = new URL(`${last}/`, RUNS);
  const read = (f: string) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir), "utf8")) : null);
  log(`rollback of ${last} (${APPLY ? "APPLY" : "dry run"})`);
  // the JSON files describe wrangler.toml; its text is in step3/step4-wrangler.toml.before
  const withToml = (j: any, f: string) => (j && existsSync(new URL(f, dir)) ? { ...j, tomlBefore: readFileSync(new URL(f, dir), "utf8") } : null);
  const s4f = withToml(read("step4-prod-rollback.json"), "step4-wrangler.toml.before");
  const s3f = withToml(read("step3-sim-rollback.json"), "step3-wrangler.toml.before");
  if ((read("step4-prod-rollback.json") && !s4f) || (read("step3-sim-rollback.json") && !s3f)) throw new Error("a step3/step4-wrangler.toml.before file is missing — not rolling back blind");
  if (read("step1-meta-rollback.json") && !existsSync(rel(".env.prod-launch"))) log("  ⚠ .env.prod-launch is gone (deleted after a green cutover): step 1 needs META_APP_SECRET and META_VERIFY_TOKEN — recreate the file, or set the callback from Meta's dashboard");
  const done = await rollbackSteps(s4f, s3f, read("step2-odoo-rollback.json"), read("step1-meta-rollback.json"), read("step2b-windows-rollback.json"));
  save("report.json", { ...report, of: last, done });
  process.exit(done.every((d) => d.ok) ? 0 : 1);
}

async function rollbackSteps(s4: any, s3: any, s2: any, s1: any, s2b: any = null): Promise<Array<{ step: string; ok: boolean; detail: string }>> {
  const done: Array<{ step: string; ok: boolean; detail: string }> = [];
  const attempt = async (step: string, fn: () => Promise<string>) => {
    try { const d = await fn(); done.push({ step, ok: true, detail: d }); log(`  ↩ ${step}: ${d}`); } catch (e) { done.push({ step, ok: false, detail: (e as Error).message }); log(`  ✗ ${step}: ${(e as Error).message}`); }
  };
  if (s4) await attempt("4 prod crons", async () => {
    if (!APPLY) return `would: wrangler.toml as after step 3, prod schedules [], prod version ${s4.prevVersion.slice(0, 8)}`;
    writeFileSync(rel("wrangler.toml"), s4.tomlBefore);
    await putSchedules("utak-worker", []);
    await redeployVersion("utak-worker", s4.prevVersion, "§ 43 cutover rollback");
    const now4 = await schedules("utak-worker");
    if (now4.length) throw new Error(`prod schedules still ${now4.length}`);
    return `prod schedules [], version ${s4.prevVersion.slice(0, 8)}`;
  });
  if (s3) await attempt("3 sim crons", async () => {
    if (!APPLY) return `would: wrangler.toml original, sim schedules the ${s3.schedules.length}, sim version ${s3.prevVersion.slice(0, 8)}`;
    writeFileSync(rel("wrangler.toml"), s3.tomlBefore);
    await putSchedules("utak-worker-sim", s3.schedules);
    await redeployVersion("utak-worker-sim", s3.prevVersion, "§ 43 cutover rollback");
    const now3 = await schedules("utak-worker-sim");
    if (!sameSet(now3, s3.schedules)) throw new Error(`sim schedules ${now3.length}, want ${s3.schedules.length}`);
    return `sim schedules ${now3.length}, version ${s3.prevVersion.slice(0, 8)}`;
  });
  if (s2b) await attempt("2ب windows", async () => {
    const keys = s2b.keys as Array<{ key: string; prodBefore: string | null; untilBefore: number | null }>;
    if (!APPLY) return `would: ${keys.length} prod KV window key(s) back (${keys.filter((k) => k.prodBefore === null).length} removed)`;
    for (const k of keys) {
      if (k.prodBefore === null) await kvDelete(PROD_KV, k.key);
      else await kvPut(PROD_KV, k.key, k.prodBefore, Math.max(Date.now() + 120_000, k.untilBefore ?? 0));
    }
    return `${keys.length} prod KV window key(s) back`;
  });
  if (s2) await attempt("2 Odoo", async () => {
    const originals = JSON.parse(readFileSync(rel(s2.originalsFile), "utf8")) as Array<{ model: string; id: number; field: string; original: string }>;
    if (!APPLY) return `would: ${originals.length} records back to their original values (${s2.originalsFile})`;
    for (const o of originals) await call(o.model, "write", { ids: [o.id], vals: { [o.field]: o.original } });
    for (const o of originals) {
      const [r] = await call(o.model, "read", { ids: [o.id], fields: [o.field] });
      if (sha(String(r?.[o.field] ?? "")) !== sha(o.original)) throw new Error(`${o.model} #${o.id}.${o.field} not restored`);
    }
    return `${originals.length} records restored (sha256 verified)`;
  });
  if (s1) await attempt("1 Meta", async () => {
    const launch = dotenv(".env.prod-launch");
    const appToken = `${APP_ID}|${launch.META_APP_SECRET}`;
    if (!APPLY) return `would: subscription callback → ${s1.before.callback_url}`;
    await subscribe(appToken, s1.before.callback_url, s1.before.fields, launch.META_VERIFY_TOKEN);
    const after = await readSubscription(appToken);
    if (after.callback_url !== s1.before.callback_url) throw new Error(`callback is ${after.callback_url}`);
    return `subscription callback → ${after.callback_url}`;
  });
  return done;
}

// ================================================================ preflight (reads)
const problems: string[] = [];
const need = (cond: unknown, what: string) => { if (!cond) problems.push(what); log(`  ${cond ? "✓" : "✗"} ${what}`); return !!cond; };
log(`§ 43 cutover — ${APPLY ? "APPLY" : "dry run"} — ${riyadh()} Riyadh`);
log("\n[preflight]");
const minute = riyadhMinutes();
report.window = { riyadh: riyadh(), inWindow: inWindow(minute), waivedByNow: NOW_FLAG };
if (APPLY && NOW_FLAG) log(`  · the window 22:35–01:40 waived by --now (§ 45 ز, Baraa): start ${riyadh().slice(11, 16)}`);
else if (APPLY) need(inWindow(minute), `the start time ${riyadh().slice(11, 16)} is inside 22:35–01:40 Riyadh`);
else log(`  · the window 22:35–01:40: now ${riyadh().slice(11, 16)} → ${inWindow(minute) ? "inside" : "outside"} (a dry run runs any time)`);

const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();
spawnSync("git", ["fetch", "origin", "--quiet"], { cwd: root });
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const head = git("rev-parse", "HEAD"), originMain = git("rev-parse", "origin/main");
const dirty = git("status", "--porcelain", "--untracked-files=no");
report.git = { branch, head: head.slice(0, 7), originMain: originMain.slice(0, 7), dirty: dirty.split("\n").filter(Boolean) };
(APPLY ? need : (c: unknown, w: string) => log(`  ${c ? "✓" : "·"} ${w}`))(branch === "main" && head === originMain && !dirty, `git: on main = origin/main (${head.slice(0, 7)}), no modified tracked file (now: ${branch} ${head.slice(0, 7)}${dirty ? ", modified: " + dirty.split("\n").length : ""})`);

let launch: Record<string, string> = {};
if (need(existsSync(rel(".env.prod-launch")), ".env.prod-launch exists")) {
  launch = dotenv(".env.prod-launch");
  need(SECRETS.every((k) => launch[k]), `.env.prod-launch has the six values (${SECRETS.map((k) => `${k} ${launch[k] ? "✓" : "✗"}`).join(", ")})`);
}
const appToken = `${APP_ID}|${launch.META_APP_SECRET ?? ""}`;

const cfState = {
  prodSchedules: await schedules("utak-worker"), simSchedules: await schedules("utak-worker-sim"),
  prodVersion: await activeVersion("utak-worker"), simVersion: await activeVersion("utak-worker-sim"),
};
report.cloudflare = { ...cfState, prodVersion: cfState.prodVersion.slice(0, 8), simVersion: cfState.simVersion.slice(0, 8) };
need(cfState.prodSchedules.length === 0, `prod schedules [] (now ${cfState.prodSchedules.length}); active version ${cfState.prodVersion.slice(0, 8)}`);
need(sameSet(cfState.simSchedules, TWELVE), `sim schedules = the twelve (now ${cfState.simSchedules.length}); active version ${cfState.simVersion.slice(0, 8)}`);
const cb0 = cronBlocks(toml0);
need(cb0.active === "sim", `wrangler.toml: the twelve on [env.sim.triggers], [triggers] [] (active block: ${cb0.active})`);
need(cb0.prod.length === 0 && sameSet(cfState.simSchedules, cb0.sim), "wrangler.toml matches Cloudflare (prod [], sim's twelve)");

const app = await graph(`${APP_ID}?fields=id`, appToken);
need(app.status === 200 && app.body?.id === APP_ID, `META_APP_SECRET: ${app.status === 200 ? "صالح" : "غير صالح"}`);
let sub0: Awaited<ReturnType<typeof readSubscription>> | null = null;
try { sub0 = await readSubscription(appToken); } catch (e) { need(false, (e as Error).message); }
if (sub0) need(new URL(sub0.callback_url).host === SIM_HOST && sub0.active, `Meta subscription → sim (${sub0.callback_url}), active, fields ${sub0.fields.join(",")}`);
const ph0 = await phoneWebhook();
need(new URL(ph0 || "https://x").host === SIM_HOST, `phone webhook_configuration.application → sim (${ph0})`);
need(await challenge(PROD_HOST, launch.META_VERIFY_TOKEN ?? ""), "prod answers the verify challenge with the file's META_VERIFY_TOKEN (مطابق)");
need(await challenge(SIM_HOST, launch.META_VERIFY_TOKEN ?? ""), "sim answers it too (step 1's rollback can pass Meta's check)");
// /health reads Odoo: a 429 of the shared tenant reads «degraded» for a moment — three tries, 10 s apart
const getHealth = async () => {
  let h: { status: number; body: any } = { status: 0, body: {} };
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 10_000));
    h = await fetch(`https://${PROD_HOST}/health`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as any })).catch((e) => ({ status: 0, body: { error: String(e) } }));
    if (h.status === 200 && h.body?.status === "ok") break;
  }
  return h;
};
const health = await getHealth();
need(health.status === 200 && health.body?.status === "ok", `prod /health: ${health.status} ${health.body?.status ?? ""} ${health.body?.odoo ?? ""}`);

const targets = launch.ODOO_HOOK_TOKEN ? await odooTargets(launch) : [];
report.odooPlan = targets.map((t) => ({ model: t.model, id: t.id, name: t.name, field: t.field, before: maskTokens(t.original).slice(0, 220), after: maskTokens(t.planned).slice(0, 220), links: t.links, beforeSha: sha(t.original), afterSha: sha(t.planned) }));
need(targets.length > 0 && targets.every((t) => !t.planned.includes(SIM_HOST) && t.links.every((l) => l.expects && l.token !== "بلا توكن")),
  `Odoo: ${targets.length} records carry the sim host; each planned value has the prod host and a token for its route (${targets.filter((t) => t.links.some((l) => l.token.startsWith("غير"))).length} tokens → the file's value)`);
const acct0 = await acctCounts();
report.acctBefore = acct0;

// sim's KV queues — read, listed, never moved
const mask = (s: string) => s.replace(/\d{8,}/g, (d) => `${d.slice(0, 3)}…${d.slice(-4)}`);
const queues: Record<string, unknown> = {};
for (const prefix of ["wa_q:v1:", "pending_loc:", "cpay_open:", "cpay:v1:"]) {
  const keys = await kvKeys(prefix);
  queues[prefix] = await Promise.all(keys.map(async (k) => {
    const raw = await kvGet(k);
    let items: unknown = null;
    try { const j = JSON.parse(raw ?? "null"); items = Array.isArray(j) ? j.map((i: any) => ({ purpose: i?.purpose ?? (i?.text ? "team_task" : i?.route_start ? "route_start" : i?.latitude ? "location" : "?"), expiresAt: i?.expiresAt ? riyadh(new Date(i.expiresAt)) : undefined })) : typeof j === "object" && j ? Object.keys(j).length + " fields" : j; } catch { items = "(raw)"; }
    return { key: mask(k), items };
  }));
}
report.simKvQueues = queues;
// § 45 هـ — the windows (read only here; step 2ب writes them on prod)
const winPlan0 = await windowPlan();
report.windows = winPlan0.map((w) => ({ key: mask(w.key), open: w.open, lastInRiyadh: w.merged.in ? riyadh(new Date(w.merged.in)) : null, closedByMeta: !!w.merged.closed && w.merged.closed >= w.merged.in, prodHad: w.prodBefore !== null }));
log(`  · sim's 24h windows (${WIN_PREFIX}*): ${winPlan0.length} key(s), ${winPlan0.filter((w) => w.open).length} open now — step 2ب copies them to prod's KV: ${winPlan0.map((w) => `${mask(w.key).slice(WIN_PREFIX.length)}${w.open ? " open" : ""}`).join(", ") || "none"}`);
log(`  · sim KV queues (not moved): ${Object.entries(queues).map(([p, v]) => `${p} ${(v as unknown[]).length}`).join(", ")}`);

const remarkDry = markStep(["mark", `--rb=cutover-prod-${runId}-remark-rollback.json`]);
report.remarkDry = remarkDry.lines;
report.realPartnersNeverMarked = REAL_PARTNER_IDS;
log(`  · real customers the re-mark never marks (§ 44 ب): ${REAL_PARTNER_IDS.map((id: number) => "#" + id).join(", ")}`);
log(`  · re-mark now (dry): ${remarkDry.lines.filter((l) => !/dry-run/.test(l)).join(" · ") || "nothing to mark"}`);

// the toml edits, in memory: sim [] then prod the twelve → «prod» is the active block, and back again exactly
const stamp = riyadh().slice(0, 16);
const t3 = tomlSimEmpty(toml0, stamp);
const t4 = tomlProdFilled(t3.toml, t3.lines, stamp);
need(cronBlocks(t3.toml).prod.length === 0 && cronBlocks(t3.toml).sim.length === 0 && cronBlocks(t4).active === "prod" && sameSet(cronBlocks(t4).prod, TWELVE),
  "wrangler.toml edits (in memory): after step 3 both [], after step 4 «prod» holds the twelve and sim []");
save("plan.json", report);

log("\n[plan]");
log(`  1. Meta subscription callback ${sub0?.callback_url ?? "?"} → ${PROD_WEBHOOK} (fields ${sub0?.fields.join(",") ?? "?"}, verify_token from the file)`);
log(`  2. Odoo, ${targets.length} records:`);
for (const t of targets) log(`       ${t.model} #${t.id} ${t.name} [${t.field}]: ${t.links.map((l) => `${l.path} ${l.expects} ${l.token}`).join("; ")}`);
log(`  2ب. the 24h windows: ${winPlan0.length} key(s) of sim's KV → prod's KV (merged, read back; rollback: prod's previous values)`);
log(`  3. [env.sim.triggers] → [] and wrangler deploy --env sim (rollback: sim's twelve + version ${cfState.simVersion.slice(0, 8)})`);
log(`     3ب. re-mark: backup ← mark --apply ← verify (account.move ${acct0.moves}, account.payment ${acct0.payments} expected unchanged)`);
log(`  4. [triggers] → the twelve and wrangler deploy (rollback: [] + version ${cfState.prodVersion.slice(0, 8)})`);

if (problems.length) {
  log(`\n✗ preflight: ${problems.length} problem(s) — ${APPLY ? "nothing written" : "the --apply run would stop here"}:\n  - ${problems.join("\n  - ")}`);
  save("report.json", { ...report, problems });
  process.exit(APPLY ? 1 : 0);
}
if (!APPLY) {
  log("\n✓ dry run: every read done, nothing written. Inside 22:35–01:40 Riyadh, from main:\n  node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts --apply");
  save("report.json", report);
  process.exit(0);
}

// ================================================================ the four steps (--apply)
const completed: Array<"1" | "2" | "2ب" | "3" | "4"> = [];
const rb: Record<string, any> = {};
const stepLog: Record<string, unknown> = {};
const fail = async (step: string, e: unknown) => {
  log(`\n✗ step ${step} failed: ${(e as Error).message}\n↩ rolling back ${completed.length ? completed.slice().reverse().join(", ") : "nothing (no step completed)"}`);
  const done = await rollbackSteps(completed.includes("4") ? rb.s4 : null, completed.includes("3") ? rb.s3 : null, completed.includes("2") ? rb.s2 : null, completed.includes("1") ? rb.s1 : null, completed.includes("2ب") ? rb.s2b : null);
  save("report.json", { ...report, steps: stepLog, failed: { step, error: (e as Error).message }, rolledBack: done });
  log(done.every((d) => d.ok) ? "↩ rollback complete" : "✗ ROLLBACK INCOMPLETE — see report.json");
  process.exit(1);
};

// 1. Meta
try {
  rb.s1 = { before: sub0, phoneBefore: ph0, at: riyadh() };
  save("step1-meta-rollback.json", rb.s1);
  await subscribe(appToken, PROD_WEBHOOK, sub0!.fields, launch.META_VERIFY_TOKEN);
  completed.push("1");
  const s1 = await readSubscription(appToken);
  let ph1 = "";
  for (let i = 0; i < 6 && new URL(ph1 || "https://x").host !== PROD_HOST; i++) { if (i) await new Promise((r) => setTimeout(r, 5000)); ph1 = await phoneWebhook(); }
  if (s1.callback_url !== PROD_WEBHOOK || !sameSet(s1.fields, sub0!.fields) || !s1.active) throw new Error(`subscription is ${s1.callback_url} (${s1.fields.length} fields, active ${s1.active})`);
  if (new URL(ph1 || "https://x").host !== PROD_HOST) throw new Error(`phone webhook_configuration.application is ${ph1}`);
  stepLog["1"] = { callback: s1.callback_url, fields: s1.fields, phone: ph1, challengeAccepted: true };
  log(`\n✓ 1. Meta → ${s1.callback_url} (Meta accepted the challenge; phone ${ph1})`);
} catch (e) { await fail("1", e); }

// 2. Odoo
try {
  const originalsFile = `backups/cutover-prod-odoo-originals-${runId}.json`;
  mkdirSync(rel("backups/"), { recursive: true });
  writeFileSync(rel(originalsFile), JSON.stringify(targets.map((t) => ({ model: t.model, id: t.id, field: t.field, original: t.original })), null, 1) + "\n", { mode: 0o600 });
  chmodSync(rel(originalsFile), 0o600);
  rb.s2 = { originalsFile, records: targets.map((t) => ({ model: t.model, id: t.id, name: t.name, field: t.field, before: maskTokens(t.original).slice(0, 220), beforeSha: sha(t.original), afterSha: sha(t.planned) })) };
  save("step2-odoo-rollback.json", rb.s2);
  completed.push("2"); // a partial write is rolled back too (every original is on file)
  for (const t of targets) await call(t.model, "write", { ids: [t.id], vals: { [t.field]: t.planned } });
  const after = await odooTargets(launch);
  if (after.length) throw new Error(`${after.length} records still carry the sim host`);
  const rows: Array<{ where: string; before: string; after: string }> = [];
  for (const t of targets) {
    const [r] = await call(t.model, "read", { ids: [t.id], fields: [t.field] });
    const v = String(r?.[t.field] ?? "");
    if (sha(v) !== sha(t.planned)) throw new Error(`${t.model} #${t.id}.${t.field} is not the planned value`);
    rows.push({ where: `${t.model} #${t.id} ${t.name}`, before: maskTokens(t.original).slice(0, 160), after: maskTokens(v).slice(0, 160) });
  }
  stepLog["2"] = { records: rows.length, rows, tokens: "every link: prod host, the file's value (مطابق)" };
  log(`✓ 2. Odoo: ${rows.length} records → prod, tokens = the file's values`);
} catch (e) { await fail("2", e); }

// 2ب. § 45 هـ — the windows: sim's KV → prod's KV (after step 1 new inbounds land on prod: merged, nothing lost)
try {
  const plan = await windowPlan();
  rb.s2b = { keys: plan.map((w) => ({ key: w.key, prodBefore: w.prodBefore, untilBefore: w.prodBefore ? windowRecordUntil(parseWin(w.prodBefore) ?? { in: 0 }) : null })) };
  writeFileSync(new URL("step2b-windows-rollback.json", runDir), JSON.stringify(rb.s2b, null, 2) + "\n", { mode: 0o600 });
  completed.push("2ب");
  for (const w of plan) await kvPut(PROD_KV, w.key, JSON.stringify(w.merged), w.until);
  const bad: string[] = [];
  for (const w of plan) {
    const back = parseWin(await kvGet(w.key, PROD_KV));
    if (!back || back.in !== w.merged.in || (back.closed ?? 0) !== (w.merged.closed ?? 0)) bad.push(mask(w.key));
  }
  if (bad.length) throw new Error(`prod KV window key(s) not as written: ${bad.join(", ")}`);
  stepLog["2ب"] = { keys: plan.length, open: plan.filter((w) => w.open).length, numbers: plan.map((w) => ({ key: mask(w.key), open: w.open, lastInRiyadh: riyadh(new Date(w.merged.in)) })) };
  log(`✓ 2ب. windows: ${plan.length} key(s) → prod's KV (${plan.filter((w) => w.open).length} open), read back`);
} catch (e) { await fail("2ب", e); }

// 3. sim crons → []
try {
  rb.s3 = { tomlBefore: toml0, schedules: cfState.simSchedules, prevVersion: cfState.simVersion };
  save("step3-sim-rollback.json", { ...rb.s3, tomlBefore: `(${toml0.length} chars, sha ${sha(toml0)} — the wrangler.toml of ${head.slice(0, 7)})` });
  writeFileSync(new URL("step3-wrangler.toml.before", runDir), toml0);
  writeFileSync(rel("wrangler.toml"), t3.toml);
  completed.push("3");
  const v3 = deploy("sim");
  const s3 = await schedules("utak-worker-sim");
  if (s3.length) throw new Error(`sim schedules still ${s3.length}`);
  stepLog["3"] = { simVersion: v3, simSchedules: s3, at: now().toISOString() };
  log(`✓ 3. sim: schedules [], version ${v3.slice(0, 8)}`);
} catch (e) { await fail("3", e); }

// 3ب. the re-mark, sim quiet
try {
  log("   … 90 s for an in-flight sim tick, then the re-mark");
  await new Promise((r) => setTimeout(r, 90_000));
  const rbName = `cutover-prod-${runId}-remark-rollback.json`;
  const b = markStep(["backup", `--rb=${rbName}`]);
  if (!b.ok) throw new Error(`re-mark backup: ${[...b.lines.slice(-2), ...b.why].join(" ")}`);
  const m = markStep(["mark", "--apply", `--rb=${rbName}`]);
  if (!m.ok) throw new Error(`re-mark: ${[...m.lines.slice(-2), ...m.why].join(" ")}`);
  const vArgs = ["verify", `--rb=${rbName}`, `--expect-moves=${acct0.moves}`, `--expect-payments=${acct0.payments}`];
  let v = markStep(vArgs);
  // § 45 ز — a verify that fails with no ✗ is the process, not the data (an Odoo hiccup): twice more, 30 s apart.
  // A ✗ (a real mismatch) rolls back at once, as before.
  for (let i = 0; i < 2 && !v.ok && !v.lines.some((l) => l.includes("✗")); i++) {
    log(`   … re-mark verify failed with no ✗ (${v.why.join(" | ").slice(0, 200) || "no reason printed"}) — again in 30 s`);
    await new Promise((r) => setTimeout(r, 30_000));
    v = markStep(vArgs);
  }
  if (!v.ok) throw new Error(`re-mark verify: ${[...v.lines.filter((l) => l.includes("✗")), ...v.why].join(" | ").slice(0, 400)}`);
  stepLog["3ب"] = { mark: m.lines, verify: v.lines.at(-1), rollback: `scripts/artifacts/${rbName}` };
  log(`✓ 3ب. re-mark: ${m.lines.filter((l) => /←|→/.test(l)).length} change(s), ${v.lines.at(-1)}`);
} catch (e) { await fail("3ب", e); }

// 4. prod crons ← the twelve
try {
  rb.s4 = { tomlBefore: t3.toml, prevVersion: cfState.prodVersion };
  save("step4-prod-rollback.json", { ...rb.s4, tomlBefore: `(${t3.toml.length} chars, sha ${sha(t3.toml)} — wrangler.toml after step 3)` });
  writeFileSync(new URL("step4-wrangler.toml.before", runDir), t3.toml);
  writeFileSync(rel("wrangler.toml"), t4);
  completed.push("4");
  const v4 = deploy("prod");
  const s4 = await schedules("utak-worker");
  if (!sameSet(s4, TWELVE)) throw new Error(`prod schedules ${s4.length}, want the twelve`);
  if (cronBlocks(readFileSync(rel("wrangler.toml"), "utf8")).active !== "prod") throw new Error("tests/cron-blocks.mts does not read «prod» as the active block");
  stepLog["4"] = { prodVersion: v4, prodSchedules: s4, at: now().toISOString() };
  log(`✓ 4. prod: the twelve schedules, version ${v4.slice(0, 8)}`);
} catch (e) { await fail("4", e); }

// ---------------------------------------------------------------- after (reads)
log("\n[after]");
const post: string[] = [];
const check = (cond: unknown, what: string) => { if (!cond) post.push(what); log(`  ${cond ? "✓" : "✗"} ${what}`); };
const subAfter = await readSubscription(appToken);
check(subAfter.callback_url === PROD_WEBHOOK, `Meta subscription → ${subAfter.callback_url}`);
const t3At = String((stepLog["3"] as any).at), t4At = String((stepLog["4"] as any).at);
let prodTick: any = null, simAfter: any[] = [];
for (let i = 0; i < 24 && !prodTick; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const inv = await invocationsSince(t3At).catch(() => []);
  prodTick = inv.find((x) => x.scriptName === "utak-worker" && x.cron === "*/5 * * * *" && x.datetime >= t4At) ?? null;
  simAfter = inv.filter((x) => x.scriptName === "utak-worker-sim" && Date.parse(x.datetime) > Date.parse(t3At) + 30_000);
}
check(prodTick, `the first */5 tick on prod: ${prodTick ? `${prodTick.datetime} ${prodTick.status}` : "not seen in 12 minutes"}`);
check(simAfter.length === 0, `nothing on sim after step 3 (${simAfter.length} invocation(s))`);
const h = await getHealth();
check(h.status === 200 && h.body?.status === "ok", `prod /health: ${h.status} ${h.body?.status} ${h.body?.odoo}`);
check((await schedules("utak-worker-sim")).length === 0, "sim schedules []");
{
  const s2b = (stepLog["2ب"] as any) ?? { keys: 0 };
  const onProd = (await kvKeys(WIN_PREFIX, PROD_KV)).length;
  check(onProd >= s2b.keys, `prod's KV holds the copied windows (${onProd} key(s) ≥ ${s2b.keys} copied)`);
}
if (!post.length) {
  unlinkSync(rel(".env.prod-launch"));
  log("  ✓ .env.prod-launch deleted");
}
save("report.json", { ...report, steps: stepLog, after: { subscription: subAfter.callback_url, prodTick, simAfter, health: h.body?.status, problems: post }, envFileDeleted: !post.length });
log(post.length
  ? `\n⚠ the cutover is done but ${post.length} check(s) are not green — nothing rolled back automatically; .env.prod-launch kept.\n  To undo: node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/cutover-prod.mts --rollback --apply`
  : "\n✓ cutover complete. Commit wrangler.toml and this run's folder, then push main and sim-harness.");
process.exit(post.length ? 1 : 0);
