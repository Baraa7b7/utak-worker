// Saturday 26/09 on the real Odoo data through the single send gateway
// (2026-09-25, STATUS § 33), with nothing sent and nothing written. Every
// message the day produces, and the gateway's decision for it: session text,
// template, held for the number (window closed, no UTILITY template), skipped,
// or refused (allowlist / owner guard). Derived from scripts/shift-20260925-dryrun.mts.
//
//   • Odoo: reads go to the tenant (cached per request body for the run);
//     every write is answered locally and recorded. x_team_attendance lives in
//     memory here, so each tick sees what the previous ones "wrote".
//   • Meta: every POST /messages is answered locally and recorded; any other
//     Graph call is refused. Claude and Gotenberg are refused.
//   • Env: [env.sim.vars] from wrangler.toml as committed (OWNER_WINDOW_OPEN_AT).
//
// The day: worker.scheduled() for the ten sim crons at their Riyadh times (the
// */5 tick 288 times — attendance and the held-queue sweep); nobody on the team
// taps «بدء الدوام» — the worst case. The windows are read from Odoo (Meta
// timestamps: Baraa tapped 25/09 06:53, x_wa_message 151).
//
// Baraa:
//   default          he taps his 06:00 template at 06:03 — as a real signed
//                    webhook through /webhook, so the gateway flushes what it
//                    held for him and sends «✅ تم».
//   --no-owner-tap   he never taps.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/gw-20260925-saturday.mts [--no-owner-tap]
//
// Out: scripts/artifacts/gw-20260925-saturday[-no-owner-tap].{json,md}

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
const riyadhMs = (ymdHm: string) => RealDate.parse(ymdHm.replace(" ", "T") + ":00+03:00");
const setRiyadh = (ymdHm: string) => { fixedNow = riyadhMs(ymdHm); };
const TODAY_REAL = new RealDate(RealDate.now() + 3 * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- args
const DAYS = ["2026-09-26"];                                  // Saturday
const NO_TAP = process.argv.includes("--no-owner-tap");
const OMAR_PARTNER = 9;
const OWNER_PARTNER = 45;                                     // the only active partner on Baraa's number
const OWNER_TAP_AFTER_MIN = 3;


// ---------------------------------------------------------------- env
const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const simTriggers = toml.slice(toml.search(/^\[env\.sim\.triggers\]/m), toml.search(/^\[env\.sim\.vars\]/m));
const CRONS = [...simTriggers.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (!CRONS.includes("*/5 * * * *")) throw new Error("wrangler.toml [env.sim.triggers] has no */5 cron");
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

// ---------------------------------------------------------------- fetch
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get", "name_search", "web_search_read"]);
type Send = { day: string; at: string; to: string; what: string; kind: string };
let day = "", at = "";
const sends: Send[] = [];
const writes: Array<{ day: string; at: string; model: string; method: string }> = [];
const refused: string[] = [];
const rowsOut: Array<{ day: string; at: string; status: string; body: string; why: string }> = [];
const gwLines: Array<{ day: string; at: string; line: string }> = [];
const cache = new Map<string, string>();
const att = new Map<number, Record<string, unknown>>(); // x_team_attendance, in memory
let attId = 0;
const realFetch = globalThis.fetch;
const reply = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
function attDomain(dom: unknown[], r: Record<string, unknown>): boolean {
  return dom.every((t) => {
    if (!Array.isArray(t)) return true;
    const [f, op, v] = t as [string, string, unknown];
    const x = r[f];
    if (op === "=") return x === v;
    if (op === "in") return (v as unknown[]).includes(x);
    throw new Error(`dry-run: x_team_attendance domain op ${op} not modelled`);
  });
}
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes("graph.facebook.com")) {
    if (method === "POST" && /\/messages$/.test(url)) {
      const b = init?.body ? JSON.parse(init.body) : {};
      const params = (b.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
      const what = b.type === "template" ? `قالب ${b.template?.name} [${params.join(" | ")}]` : b.type === "text" ? `نص: ${String(b.text?.body ?? "").replace(/\s+/g, " ").slice(0, 160)}` : b.type;
      sends.push({ day, at, to: String(b.to ?? ""), what, kind: b.type === "template" ? String(b.template?.name) : String(b.type) });
      return reply({ messages: [{ id: `wamid.DRY${sends.length}` }] });
    }
    refused.push(url.split("?")[0]);
    return new Response(JSON.stringify({ error: { message: "dry-run: Graph refused" } }), { status: 503 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) { refused.push(url.split("?")[0]); throw new Error(`BLOCKED (dry-run): ${url.split("?")[0]}`); }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  const body = init?.body ? JSON.parse(init.body) : {};
  if (m && m[1] === "x_team_attendance") {
    writes.push({ day, at, model: m[1], method: m[2] });
    if (m[2] === "create") return reply(body.vals_list.map((v: Record<string, unknown>) => { const id = ++attId; att.set(id, { id, ...v }); return id; }));
    if (m[2] === "write") { for (const id of body.ids) Object.assign(att.get(id) ?? {}, body.vals); return reply(true); }
    if (m[2] === "search_read") {
      return reply([...att.values()].filter((r) => attDomain(body.domain ?? [], r))
        .map((r) => Object.fromEntries((body.fields ?? Object.keys(r)).map((f: string) => [f, r[f] ?? false]))));
    }
    throw new Error(`dry-run: x_team_attendance.${m[2]} not modelled`);
  }
  if (m && m[1] === "x_wa_message" && m[2] === "create") {
    for (const v of body.vals_list ?? []) if (["held", "skipped", "expired", "failed"].includes(String(v.x_status))) rowsOut.push({ day, at, status: String(v.x_status), body: String(v.x_body ?? "").replace(/\s+/g, " ").slice(0, 140), why: String(v.x_meta_error ?? v.x_debug_payload ?? "").slice(0, 160) });
  }
  if (m && !READS.has(m[2])) {
    writes.push({ day, at, model: m[1], method: m[2] });
    return reply(m[2] === "create" ? [990000 + writes.length] : true);
  }
  const key = url + "|" + (init?.body ?? "");
  let text = cache.get(key);
  if (text === undefined) {
    const r = await realFetch(input, init);
    text = await r.text();
    if (!r.ok) return new Response(text, { status: r.status });
    cache.set(key, text);
  }
  return new Response(text, { status: 200 });
}) as typeof fetch;

const blocked: Array<{ day: string; at: string; line: string }> = [];
const errors: Array<{ day: string; at: string; line: string }> = [];
console.warn = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  if (/BLOCKED by allowlist|owner-guard\] blocked/.test(s)) blocked.push({ day, at, line: s.slice(0, 200) });
  if (s.startsWith("[gateway]")) gwLines.push({ day, at, line: s.slice(0, 260) });
};
console.log = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  if (s.startsWith("[gateway]")) gwLines.push({ day, at, line: s.slice(0, 260) });
};
const out = process.stdout.write.bind(process.stdout);
console.error = (...a: unknown[]) => { errors.push({ day, at, line: a.map((x) => x instanceof Error ? x.message : String(x)).join(" ").slice(0, 240) }); };

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } async list() { return { keys: [], list_complete: true }; } }
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "DRY-RUN", META_APP_SECRET: "DRY-RUN", META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"),
  META_WABA_ID: tomlVar("META_WABA_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"),
  WORKER_ORIGIN: tomlVar("WORKER_ORIGIN"), OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"),
  CLAUDE_MODEL_CLASSIFY: tomlVar("CLAUDE_MODEL_CLASSIFY"), CLAUDE_MODEL_REPLY: tomlVar("CLAUDE_MODEL_REPLY"),
  SIMULATION_MODE: tomlVar("SIMULATION_MODE"), PILOT_MODE: tomlVar("PILOT_MODE"),
  SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"), ACCOUNTING_SYNC: tomlVar("ACCOUNTING_SYNC"),
  OWNER_WINDOW_OPEN_AT: tomlVar("OWNER_WINDOW_OPEN_AT"),
  SIM_DB: fakeD1, MSG_DEDUP: new KV(),
};
if (env.OWNER_WINDOW_OPEN_AT !== "06:00") throw new Error(`OWNER_WINDOW_OPEN_AT in wrangler.toml is «${env.OWNER_WINDOW_OPEN_AT}», expected 06:00`);

const { createHmac } = await import("node:crypto");
const worker = (await import("../src/index.ts")).default;
const { fetchRoster } = await import("../src/team-roster.ts");
const { readWindow } = await import("../src/wa-window.ts");

// ---------------------------------------------------------------- the day
setRiyadh(`${DAYS[0]} 00:00`);
const roster = await fetchRoster(env);
const tail = (s: string) => (s ? "…" + String(s).replace(/\D/g, "").slice(-4) : "-");
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const CRON_AT: Record<string, number> = {};
for (const c of CRONS) {
  const mm = /^(\d+) (\d+) \* \* \*$/.exec(c);
  if (mm) CRON_AT[c] = ((Number(mm[2]) + 3) % 24) * 60 + Number(mm[1]);
}
const ownerDigits = String(env.OWNER_WHATSAPP).replace(/\D/g, "");
const windowsAtStart: Record<string, unknown> = {};
for (const m of [...roster.members.map((x) => ({ name: x.name, to: x.whatsapp })), { name: "براء", to: env.OWNER_WHATSAPP }, { name: "أحمد حسان (مورد)", to: "+966571777704" }]) {
  const w = await readWindow(env, String(m.to));
  windowsAtStart[`${m.name} ${tail(String(m.to))}`] = w.open ? `مفتوحة حتى ${new RealDate(w.closesAtMs + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}` : `مقفلة (آخر وارد: ${w.lastInboundMs ? new RealDate(w.lastInboundMs + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "لا شيء"})`;
}
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as any;
async function ownerTap(ms: number) {
  const payload = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: ownerDigits, profile: { name: "Bara.a" } }],
    messages: [{ id: `wamid.DRYTAP${ms}`, from: ownerDigits, timestamp: String(Math.floor(ms / 1000)), type: "button", button: { payload: "shift_start", text: "بدء الدوام" } }],
  } }] }] };
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(raw).digest("hex");
  const res = await worker.fetch(new Request(`${env.WORKER_ORIGIN}/webhook`, { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } }), env, ctx);
  await Promise.allSettled(pending.splice(0));
  return res.status;
}
let tapStatus: number | null = null;
let pendingOwnerTap: number | null = null;
day = DAYS[0];
for (let min = 0; min < 24 * 60; min += 5) {
  at = hm(min);
  setRiyadh(`${day} ${at}`);
  if (pendingOwnerTap !== null && Date.now() >= pendingOwnerTap) {
    at = hm(min - 2);
    setRiyadh(`${day} ${at}`);
    tapStatus = await ownerTap(Date.now());
    pendingOwnerTap = null;
    at = hm(min);
    setRiyadh(`${day} ${at}`);
  }
  const due = CRONS.filter((c) => c === "*/5 * * * *" || CRON_AT[c] === min);
  const n = sends.length;
  for (const c of due) {
    await worker.scheduled({ cron: c, scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
    await Promise.allSettled(pending.splice(0));
  }
  if (!NO_TAP && sends.slice(n).some((s) => s.to === ownerDigits && s.kind === "utak_shift_start_v2")) pendingOwnerTap = Date.now() + (OWNER_TAP_AFTER_MIN + 2) * 60e3;
}
const heldAtEnd: Record<string, unknown[]> = {};
for (const [k, v] of env.MSG_DEDUP.store as Map<string, string>) {
  if (/^wa_q:v1:\d+$/.test(k)) heldAtEnd[tail(k.slice(8))] = JSON.parse(v).map((i: any) => ({ purpose: i.purpose, body: String(i.body?.text?.body ?? i.body?.interactive?.body?.text ?? i.body?.type).slice(0, 90), expires: new RealDate(i.expiresAt + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ") }));
}

// ---------------------------------------------------------------- the report: one line per gateway decision
const who = (d: string) => {
  const x = String(d).replace(/\D/g, "");
  if (x === ownerDigits || x.endsWith(ownerDigits.slice(-4)) && d.startsWith("…")) return "براء";
  const m = roster.members.find((r) => String(r.whatsapp).replace(/\D/g, "").endsWith(x.slice(-4)));
  return m ? m.name : x.endsWith("7704") ? "أحمد حسان" : d;
};
type Line = { at: string; to: string; purpose: string; decision: string; what: string };
const lines: Line[] = [];
const sendQueue = [...sends];
for (const g of gwLines) {
  const mm = /\[gateway\] (sent|held|skipped|expired|BLOCKED by allowlist)[: ]?(?:purpose=(\S+))? ?(?:to=(\S+))?(.*)$/.exec(g.line);
  if (!mm) continue;
  const [, kind, purpose = "-", to = "-", rest] = mm;
  let decision = kind, what = rest.trim();
  if (kind === "sent") {
    const via = /via=(\S+)/.exec(rest)?.[1] ?? "";
    decision = via.startsWith("template:") ? `قالب ${via.slice(9)}` : `نص (${via})`;
    if (/held → flushed/.test(rest)) decision += " — من الطابور";
    const i = sendQueue.findIndex((s) => s.at === g.at && tail(s.to) === to);
    what = i >= 0 ? sendQueue.splice(i, 1)[0].what : "";
  } else if (kind === "held") decision = "محفوظة (خارج النافذة، لا قالب UTILITY)";
  else if (kind === "skipped") decision = "لم تُرسل";
  else if (kind.startsWith("BLOCKED")) { decision = "مرفوضة (القائمة المسموحة)"; }
  lines.push({ at: g.at, to, purpose, decision, what: what.replace(/\|/g, "/").slice(0, 170) });
}
const report = {
  mode: NO_TAP ? "Baraa never taps" : "Baraa taps his 06:00 template at 06:03 (signed webhook)", tapStatus,
  day: DAYS[0], crons: CRONS, windowsAtStart,
  roster: roster.members.map((m) => ({ name: m.name, to: tail(m.whatsapp), roles: m.codes, attendance: m.attendance, calendar: m.calendarName || null })),
  decisions: lines, graphPosts: sends.length, heldAtEnd, rows: rowsOut,
  writesByModel: Object.entries(writes.reduce((a: Record<string, number>, w) => { a[`${w.model}.${w.method}`] = (a[`${w.model}.${w.method}`] ?? 0) + 1; return a; }, {})),
  blocked, errors, refused: [...new Set(refused)],
};
const base = `scripts/artifacts/gw-20260925-saturday${NO_TAP ? "-no-owner-tap" : ""}`;
writeFileSync(new URL(base + ".json", root), JSON.stringify(report, null, 2) + "\n");
const count = (f: (l: Line) => boolean) => lines.filter(f).length;
const md = [
  `# السبت ${DAYS[0]} عبر البوابة الموحّدة — بيانات Odoo الحقيقية، بلا إرسال ولا كتابة`,
  "",
  `المواعيد العشرة، ونبضة */5 (التحضير وكنس الطابور) 288 مرة، ولا أحد من الفريق يضغط «بدء الدوام». ${NO_TAP ? "براء لا يضغط قالب 06:00." : `براء يضغط قالب 06:00 الساعة 06:03 (webhook موقّع عبر /webhook، ${tapStatus}).`}`,
  "",
  "## النوافذ عند بداية اليوم (من Odoo، بوقت Meta)",
  "",
  ...Object.entries(windowsAtStart).map(([k, v]) => `- ${k}: ${v}`),
  "",
  "## كل رسالة وقرار البوابة",
  "",
  "| الوقت | إلى | الغرض | القرار | المحتوى |",
  "|---|---|---|---|---|",
  ...lines.map((l) => `| ${l.at} | ${who(l.to)} ${l.to} | ${l.purpose} | ${l.decision} | ${l.what} |`),
  "",
  `- المجموع: ${lines.length} — قالب ${count((l) => l.decision.startsWith("قالب"))}، نص ${count((l) => l.decision.startsWith("نص"))}، محفوظة ${count((l) => l.decision.startsWith("محفوظة"))}، لم تُرسل ${count((l) => l.decision === "لم تُرسل")}، مرفوضة بالقائمة ${count((l) => l.decision.startsWith("مرفوضة"))}.`,
  `- ما بقي محفوظاً آخر اليوم: ${JSON.stringify(heldAtEnd)}`,
  `- صفوف x_wa_message (held / skipped / expired / failed): ${rowsOut.length}`,
  `- كتابات Odoo (مجابة محلياً، لم تصل Odoo): ${JSON.stringify(report.writesByModel)}`,
  `- أخطاء: ${errors.length}، ومرفوض خارجي: ${report.refused.join("، ") || "0"}`,
].join("\n");
writeFileSync(new URL(base + ".md", root), md + "\n");
out(md + "\n");
out(`\nerrors: ${JSON.stringify(errors.slice(0, 8))}\n`);
