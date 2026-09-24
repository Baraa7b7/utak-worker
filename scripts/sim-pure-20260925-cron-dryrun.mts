// Tomorrow's sim schedule on the real Odoo data, with nothing sent and nothing
// written (2026-09-25, STATUS § 27).
//
//   • Odoo: reads go to the tenant; every write (create / write / message_post …)
//     is answered locally and recorded.
//   • Meta: every POST /messages is answered locally and recorded (the env has
//     no real token either); every other Graph call is refused. Claude and
//     Gotenberg are refused.
//   • Env: [env.sim.vars] from wrangler.toml as committed (ACCOUNTING_SYNC,
//     SIM_ALLOWLIST), so fetchMeta applies the real list and the real
//     x_wa_allowed flags (read live from Odoo).
//
// Runs worker.scheduled() for each of the nine sim crons with the clock set to
// 2026-09-25 at that Riyadh time, in order, one shared in-memory KV. A send the
// list refuses is caught from fetchMeta's own warning line, so both "sent" and
// "blocked" recipients show.
//
// Proxy pass: the 05:00 nudge, 06:00 missing-supplier alert and 21:15 alert act
// on the same day's 02:00 ask, which this dry run does not persist. They run a
// second time with the clock on 2026-09-24, on today's real ask logs.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/sim-pure-20260925-cron-dryrun.mts
//
// Out: scripts/artifacts/sim-pure-20260925-cron-dryrun.json (+ .md)

import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------- clock
const RealDate = Date;
let fixedNow: number | null = null;
class FakeDate extends RealDate {
  constructor(...a: unknown[]) {
    // deno-lint-ignore no-explicit-any
    if (a.length === 0 && fixedNow !== null) super(fixedNow); else super(...(a as [any]));
  }
  static now(): number { return fixedNow ?? RealDate.now(); }
}
// deno-lint-ignore no-explicit-any
(globalThis as any).Date = FakeDate;
const setRiyadh = (ymdHm: string) => { fixedNow = RealDate.parse(ymdHm.replace(" ", "T") + ":00+03:00"); };

// ---------------------------------------------------------------- env
const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const simTriggers = toml.slice(toml.search(/^\[env\.sim\.triggers\]/m), toml.search(/^\[env\.sim\.vars\]/m));
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

// ---------------------------------------------------------------- fetch
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get", "name_search"]);
type Send = { job: string; to: string; kind: string; what: string };
let job = "";
const sends: Send[] = [];
const blocked: Array<{ job: string; to: string; why: string }> = [];
const writes: Array<{ job: string; model: string; method: string }> = [];
const refused: Array<{ job: string; url: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes("graph.facebook.com")) {
    if (method === "POST" && /\/messages$/.test(url)) {
      const b = init?.body ? JSON.parse(init.body) : {};
      const what = b.type === "template" ? `قالب ${b.template?.name}` : b.type === "text" ? `نص: ${String(b.text?.body ?? "").replace(/\s+/g, " ").slice(0, 70)}` : b.type;
      sends.push({ job, to: String(b.to ?? ""), kind: b.type, what });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.DRY${sends.length}` }] }), { status: 200 });
    }
    refused.push({ job, url: url.replace(/access_token=[^&]+/, "access_token=…") });
    return new Response(JSON.stringify({ error: { message: "dry-run: Graph refused" } }), { status: 503 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) {
    refused.push({ job, url: url.split("?")[0] });
    throw new Error(`BLOCKED (dry-run): ${url.split("?")[0]}`);
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) {
    writes.push({ job, model: m[1], method: m[2] });
    return new Response(JSON.stringify(m[2] === "create" ? [990000 + writes.length] : true), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

// fetchMeta's own refusal line carries the recipient.
const realWarn = console.warn;
console.warn = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  const mb = /BLOCKED by allowlist: to=(\S+)/.exec(s);
  if (mb) blocked.push({ job, to: mb[1], why: "خارج القائمة" });
  const mo = /\[owner-guard\] blocked purpose=(\S+)/.exec(s);
  if (mo) blocked.push({ job, to: tomlVar("OWNER_WHATSAPP"), why: `owner-guard ${mo[1]}` });
};
const errors: Array<{ job: string; line: string }> = [];
console.log = () => {};
console.error = (...a: unknown[]) => { errors.push({ job, line: a.map((x) => x instanceof Error ? x.message : String(x)).join(" ").slice(0, 240) }); };

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } async list() { return { keys: [], list_complete: true }; } }
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
const fakeR2 = { put: async () => ({}), get: async () => null, head: async () => null };
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "DRY-RUN", META_APP_SECRET: "DRY-RUN", META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"),
  META_WABA_ID: tomlVar("META_WABA_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"),
  WORKER_ORIGIN: tomlVar("WORKER_ORIGIN"), OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"),
  CLAUDE_MODEL_CLASSIFY: tomlVar("CLAUDE_MODEL_CLASSIFY"), CLAUDE_MODEL_REPLY: tomlVar("CLAUDE_MODEL_REPLY"),
  SIMULATION_MODE: tomlVar("SIMULATION_MODE"), PILOT_MODE: tomlVar("PILOT_MODE"),
  SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"), ACCOUNTING_SYNC: tomlVar("ACCOUNTING_SYNC"),
  SIM_DB: fakeD1, MSG_DEDUP: new KV(), INVOICES_BUCKET: fakeR2,
};

const worker = (await import("../src/index.ts")).default;
const suppliers = await import("../src/suppliers.ts");
const hours = await import("../src/hours.ts");
void hours;
const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as any;

const CRONS: Array<[string, string, string]> = [
  ["0 23 * * *", "2026-09-25 02:00", "طلب أسعار الموردين"],
  ["0 2 * * *", "2026-09-25 05:00", "درجات الموردين + تذكير المورد الصامت + مزامنة القوالب"],
  ["0 3 * * *", "2026-09-25 06:00", "فتح الطلبات + تنبيه موردين لم يردوا + متابعة قائمة شراء بلا «تم الشراء»"],
  ["0 5 * * *", "2026-09-25 08:00", "تقييم + تذكير دفع + إعادة تنشيط"],
  ["0 14 * * *", "2026-09-25 17:00", "تذكير الطلب المعتاد"],
  ["0 15 * * *", "2026-09-25 18:00", "ملخص التحصيل للمحصّل"],
  ["0 17 * * *", "2026-09-25 20:00", "تذكير الطلبات غير المؤكدة"],
  ["0 18 * * *", "2026-09-25 21:00", "إقفال الطلبات غير المؤكدة + إشعار العميل"],
  ["15 18 * * *", "2026-09-25 21:15", "قائمة الشراء للمستودع + تنبيه لكل مورد بلا سعر"],
];
const deployedCrons = [...simTriggers.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);

for (const [cron, at, label] of CRONS) {
  job = `${at.slice(11)} ${label}`;
  setRiyadh(at);
  await worker.scheduled({ cron, scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
}

// Proxy pass on today's real 02:00 ask logs.
const proxy: Array<[string, string, () => Promise<unknown>]> = [
  ["2026-09-24 05:00", "بديل: تذكير المورد الصامت على سجل اليوم", () => suppliers.nudgeLateSuppliers(env)],
  ["2026-09-24 21:15", "بديل: تنبيه المورد بلا سعر على سجل اليوم", () => suppliers.alertSuppliersWithoutPrices(env)],
];
env.MSG_DEDUP = new KV();
for (const [at, label, fn] of proxy) {
  job = `${at.slice(11)} ${label}`;
  setRiyadh(at);
  try { await fn(); } catch (e) { blocked.push({ job, to: "-", why: `threw: ${(e as Error).message}` }); }
}
fixedNow = null;

// ---------------------------------------------------------------- who is who
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const mask = (v: unknown) => { const d = digits(v); return d ? `+${d.slice(0, 3)}…${d.slice(-4)}` : "—"; };
const list = tomlVar("SIM_ALLOWLIST").split(",").map((s) => digits(s)).filter(Boolean);
const partners: Array<{ id: number; name: string; phone: string | false; x_whatsapp_number: string | false; x_wa_allowed: boolean }> =
  await (await realFetch(`${dotenv.ODOO_URL}/json/2/res.partner/search_read`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dotenv.ODOO_API_KEY}` },
    body: JSON.stringify({ domain: [], fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_allowed"] }),
  })).json();
const who = (to: string) => {
  const d = digits(to);
  const p = partners.filter((x) => digits(x.x_whatsapp_number) === d || digits(x.phone) === d);
  return p.map((x) => `${x.name} (#${x.id})`).join("، ") || "لا شريك نشط";
};
const inList = (to: string) => list.includes(digits(to));

const rowsOut = [
  ...sends.map((s) => ({ job: s.job, to: mask(s.to), partner: who(s.to), what: s.what, outcome: "يُرسل", in_list: inList(s.to) })),
  ...blocked.map((b) => ({ job: b.job, to: mask(b.to), partner: b.to === "-" ? "-" : who(b.to), what: b.why, outcome: "محجوب", in_list: b.to === "-" ? false : inList(b.to) })),
];
const out = {
  at: new RealDate().toISOString(),
  env: { SIM_ALLOWLIST_masked: list.map(mask), ACCOUNTING_SYNC: env.ACCOUNTING_SYNC, PILOT_MODE: env.PILOT_MODE, SIMULATION_MODE: env.SIMULATION_MODE },
  deployed_crons_in_toml: deployedCrons,
  crons: CRONS.map(([cron, at, label]) => ({ cron, riyadh: at.slice(11), label })),
  rows: rowsOut,
  every_sent_recipient_in_list: sends.every((s) => inList(s.to)),
  odoo_writes_intercepted: writes.reduce((a, w) => ((a[`${w.model}.${w.method}`] = (a[`${w.model}.${w.method}`] ?? 0) + 1), a), {} as Record<string, number>),
  accounting_writes: writes.filter((w) => /^(account\.|sale\.order|purchase\.order)/.test(w.model)),
  refused_calls: refused,
  errors_by_job: errors,
};
writeFileSync(new URL("scripts/artifacts/sim-pure-20260925-cron-dryrun.json", root), JSON.stringify(out, null, 2) + "\n");
const md = [
  "# مواعيد sim غداً (2026-09-25) على بيانات Odoo الحقيقية — لا إرسال ولا كتابة",
  "",
  `القائمة: ${list.map(mask).join("، ")} · ACCOUNTING_SYNC=${env.ACCOUNTING_SYNC}`,
  "",
  "| المهمة (الرياض) | الرقم | الشريك | ما يخرج | النتيجة | ضمن القائمة |",
  "|---|---|---|---|---|---|",
  ...rowsOut.map((r) => `| ${r.job} | ${r.to} | ${r.partner} | ${r.what} | ${r.outcome} | ${r.in_list ? "نعم" : "لا"} |`),
  "",
  `كل من يُرسل إليه ضمن القائمة: ${out.every_sent_recipient_in_list ? "نعم ✅" : "لا ❌"}`,
  `كتابات Odoo المعترضة: ${JSON.stringify(out.odoo_writes_intercepted)}`,
  `كتابات محاسبية: ${out.accounting_writes.length}`,
  `مواعيد [env.sim.triggers]: ${deployedCrons.length} — ${deployedCrons.join(" · ")}`,
  `أخطاء المهام: ${errors.length ? errors.map((e) => `${e.job}: ${e.line}`).join(" | ") : "لا شيء"}`,
  "",
].join("\n");
writeFileSync(new URL("scripts/artifacts/sim-pure-20260925-cron-dryrun.md", root), md);
console.warn = realWarn;
process.stdout.write(md + "\n");
