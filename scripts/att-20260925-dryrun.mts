// Tomorrow's attendance on the real Odoo data, with nothing sent and nothing
// written (2026-09-25, STATUS § 29).
//
//   • Odoo: reads go to the tenant (cached per request body for the run);
//     every write is answered locally and recorded. x_team_attendance lives in
//     memory here, so each tick sees what the previous ones "wrote".
//   • Meta: every POST /messages is answered locally and recorded; any other
//     Graph call is refused. Claude and Gotenberg are refused.
//   • Env: [env.sim.vars] from wrangler.toml as committed (SIM_ALLOWLIST,
//     OWNER_WINDOW_OPEN_AT, ACCOUNTING_SYNC).
//
// Runs worker.scheduled({cron:"*/5 * * * *"}) every 5 minutes over
// 2026-09-26 (Riyadh), 00:00 → 23:55, and nobody taps «بدء الدوام» — the
// worst case: when the template, the reminder and the alerts would go out.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/att-20260925-dryrun.mts
//   … --assume 9=05:00        # «what if» x_shift_start for partner 9 were 05:00 (read side only)
//
// Out: scripts/artifacts/att-20260925-dryrun[-assume].{json,md}

import { readFileSync, writeFileSync } from "node:fs";

// 2026-09-25 (STATUS § 31) — superseded. The roster is hr.employee and the
// shift comes from its working schedule (x_shift_start and getAttendanceTeam
// are gone). The same dry run, on the new source: scripts/team-20260925-dryrun.mts.
console.log("superseded by scripts/team-20260925-dryrun.mts (STATUS § 31)");
process.exit(0);

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

// ---------------------------------------------------------------- args
const DAY = "2026-09-26";
const assume = new Map<number, number>();
const ai = process.argv.indexOf("--assume");
if (ai > 0) for (const pair of String(process.argv[ai + 1] ?? "").split(",")) {
  const m = /^(\d+)=(\d{1,2}):(\d{2})$/.exec(pair.trim());
  if (!m) throw new Error(`--assume id=HH:MM[,id=HH:MM] — got «${pair}»`);
  assume.set(Number(m[1]), Number(m[2]) + Number(m[3]) / 60);
}

// ---------------------------------------------------------------- env
const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const simTriggers = toml.slice(toml.search(/^\[env\.sim\.triggers\]/m), toml.search(/^\[env\.sim\.vars\]/m));
if (!simTriggers.includes(`"*/5 * * * *"`)) throw new Error("wrangler.toml [env.sim.triggers] has no */5 cron");
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

// ---------------------------------------------------------------- fetch
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get", "name_search"]);
type Send = { at: string; to: string; what: string };
let at = "";
const sends: Send[] = [];
const writes: Array<{ at: string; model: string; method: string }> = [];
const refused: string[] = [];
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
      const what = b.type === "template" ? `قالب ${b.template?.name} [${params.join(" | ")}]` : b.type === "text" ? `نص: ${String(b.text?.body ?? "").replace(/\s+/g, " ").slice(0, 120)}` : b.type;
      sends.push({ at, to: String(b.to ?? ""), what });
      return reply({ messages: [{ id: `wamid.DRY${sends.length}` }] });
    }
    refused.push(url.split("?")[0]);
    return new Response(JSON.stringify({ error: { message: "dry-run: Graph refused" } }), { status: 503 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) { refused.push(url.split("?")[0]); throw new Error(`BLOCKED (dry-run): ${url.split("?")[0]}`); }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  const body = init?.body ? JSON.parse(init.body) : {};
  if (m && m[1] === "x_team_attendance") {
    writes.push({ at, model: m[1], method: m[2] });
    if (m[2] === "create") return reply(body.vals_list.map((v: Record<string, unknown>) => { const id = ++attId; att.set(id, { id, ...v }); return id; }));
    if (m[2] === "write") { for (const id of body.ids) Object.assign(att.get(id) ?? {}, body.vals); return reply(true); }
    if (m[2] === "search_read") {
      return reply([...att.values()].filter((r) => attDomain(body.domain ?? [], r))
        .map((r) => Object.fromEntries((body.fields ?? Object.keys(r)).map((f: string) => [f, f === "x_partner_id" ? [r[f], ""] : (r[f] ?? false)]))));
    }
    throw new Error(`dry-run: x_team_attendance.${m[2]} not modelled`);
  }
  if (m && !READS.has(m[2])) {
    writes.push({ at, model: m[1], method: m[2] });
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
  // «what if»: overlay x_shift_start on the partner rows we read
  if (assume.size && m && m[1] === "res.partner" && (m[2] === "search_read" || m[2] === "read")) {
    const rows = JSON.parse(text);
    if (Array.isArray(rows)) for (const r of rows) if (assume.has(r.id) && "x_shift_start" in r) r.x_shift_start = assume.get(r.id);
    return reply(rows);
  }
  return new Response(text, { status: 200 });
}) as typeof fetch;

const blocked: Array<{ at: string; line: string }> = [];
const errors: Array<{ at: string; line: string }> = [];
const acted: Array<{ at: string; line: string }> = [];
console.warn = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  if (/BLOCKED by allowlist|owner-guard\] blocked/.test(s)) blocked.push({ at, line: s.slice(0, 200) });
};
console.log = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.startsWith("[attendance ")) acted.push({ at, line: s.slice(0, 400) }); };
const out = process.stdout.write.bind(process.stdout);
console.error = (...a: unknown[]) => { errors.push({ at, line: a.map((x) => x instanceof Error ? x.message : String(x)).join(" ").slice(0, 240) }); };

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

const worker = (await import("../src/index.ts")).default;
const { getAttendanceTeam } = await import("../src/odoo.ts");
const { shiftMinutes, hhmm, ownerWindowPlan } = await import("../src/attendance.ts");

// ---------------------------------------------------------------- the roster, from Odoo
setRiyadh(`${DAY} 00:00`);
const team = await getAttendanceTeam(env);
const tail = (s: string) => "…" + String(s).replace(/\D/g, "").slice(-4);
const roster = team.map((m) => ({ id: m.id, name: m.name, to: tail(m.whatsapp), roles: m.codes, shift: shiftMinutes(m.shiftStart) === null ? null : hhmm(shiftMinutes(m.shiftStart) as number) }));

// ---------------------------------------------------------------- the day
for (let min = 0; min < 24 * 60; min += 5) {
  at = hhmm(min);
  setRiyadh(`${DAY} ${at}`);
  await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry() {} } as any, env, { waitUntil() {}, passThroughOnException() {} } as any);
}

const byTo = (digits: string) => sends.filter((s) => s.to === digits);
const ownerDigits = String(env.OWNER_WHATSAPP).replace(/\D/g, "");
// 2026-09-25 (STATUS § 30) — Baraa's window: earliest shift − 15 min, else OWNER_WINDOW_OPEN_AT
const ownerAt = hhmm(ownerWindowPlan(env, team.filter((m) => String(m.whatsapp).replace(/\D/g, "") !== String(env.OWNER_WHATSAPP).replace(/\D/g, ""))).minutes);
const people = [
  ...roster.map((r) => {
    const m = team.find((t) => t.id === r.id)!;
    const d = String(m.whatsapp).replace(/\D/g, "");
    return { ...r, sends: byTo(d).map((s) => `${s.at} ${s.what}`) };
  }),
  { id: 0, name: "براء (المالك)", to: tail(ownerDigits), roles: ["—"], shift: ownerAt + " (نافذة)", sends: byTo(ownerDigits).map((s) => `${s.at} ${s.what}`) },
];
const report = {
  day: DAY, assume: Object.fromEntries(assume), ownerWindowAt: ownerAt,
  ticks: 288, roster, people,
  attendanceRows: [...att.values()],
  writesOutsideAttendance: writes.filter((w) => w.model !== "x_team_attendance"),
  blocked, errors, refused,
};
const base = `scripts/artifacts/att-20260925-dryrun${assume.size ? "-assume" : ""}`;
writeFileSync(new URL(base + ".json", root), JSON.stringify(report, null, 2) + "\n");
const md = [
  `# الحضور غداً ${DAY} — تشغيل جاف على بيانات Odoo الحقيقية${assume.size ? ` (افتراض: ${[...assume].map(([k, v]) => `${k}=${hhmm(Math.round(v * 60))}`).join("، ")})` : ""}`,
  "", "288 نبضة (كل 5 دقائق)، ولا أحد يضغط «بدء الدوام». لا إرسال ولا كتابة.", "",
  "| الشخص | الرقم | الأدوار | بداية الدوام | ما سيصله (الرياض) |", "|---|---|---|---|---|",
  ...people.map((p) => `| ${p.name} (${p.id || "—"}) | ${p.to} | ${p.roles.join("، ")} | ${p.shift ?? "لا وقت"} | ${p.sends.length ? p.sends.join("<br>") : "لا شيء"} |`),
  "", `- صفوف الحضور: ${report.attendanceRows.length}`, `- كتابات خارج الحضور (صدى وسجلات، مجابة محلياً): ${report.writesOutsideAttendance.length}`,
  `- محجوب: ${blocked.length}`, `- أخطاء: ${errors.length}`, `- مرفوض (Graph/خارجي): ${refused.length}`,
].join("\n");
writeFileSync(new URL(base + ".md", root), md + "\n");
out(md + "\n");
out(`\nerrors: ${JSON.stringify(errors.slice(0, 5))}\nblocked: ${JSON.stringify(blocked.slice(0, 5))}\n`);
