// Three days on the real Odoo data, with nothing sent and nothing written
// (2026-09-25, STATUS § 32: the team's real schedules, Baraa's fixed 06:00).
//
//   • Odoo: reads go to the tenant (cached per request body for the run);
//     every write is answered locally and recorded. x_team_attendance lives in
//     memory here, so each tick sees what the previous ones "wrote".
//   • Meta: every POST /messages is answered locally and recorded; any other
//     Graph call is refused. Claude and Gotenberg are refused.
//   • Env: [env.sim.vars] from wrangler.toml as committed (OWNER_WINDOW_OPEN_AT).
//
// Days: Saturday 26/09, Friday 02/10, Saturday 03/10. For each day:
// worker.scheduled() for the ten sim crons at their Riyadh times (the */5
// attendance tick 288 times); nobody on the team taps «بدء الدوام» — the worst
// case. Probes of the after-shift rule: a task for عمر (partner 9) through
// holdForTask at 01:00, 10:00, 13:00 and 21:30, exactly as the route / list /
// collection paths call it (one «بعد دوامه» alert per task kind and day).
//
// Baraa's window (whether the owner alerts go as text or as the template):
//   default          he taps his 06:00 template at 06:03 every day (as he did
//                    on 25/09 at 06:53: x_wa_message 151). A day whose previous
//                    day is not simulated and is still ahead gets that tap
//                    assumed (01/10 06:03); 26/09 uses the real Odoo data.
//   --no-owner-tap   he never taps (the alerts go as utak_owner_alert).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/shift-20260925-dryrun.mts [--no-owner-tap]
//
// Out: scripts/artifacts/shift-20260925-dryrun[-no-owner-tap].{json,md}

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
const DAYS = ["2026-09-26", "2026-10-02", "2026-10-03"];      // Saturday, Friday, Saturday
const NO_TAP = process.argv.includes("--no-owner-tap");
const OMAR_PARTNER = 9;
const OWNER_PARTNER = 45;                                     // the only active partner on Baraa's number
const OWNER_TAP_AFTER_MIN = 3;
const PROBES = ["01:00", "10:00", "13:00", "21:30"];

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
};
console.log = () => {};
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

const worker = (await import("../src/index.ts")).default;
const attendance = await import("../src/attendance.ts");
const { fetchRoster, dayPlan } = await import("../src/team-roster.ts");
const { kvLastInboundTs } = await import("../src/wa-inbox.ts");

// ---------------------------------------------------------------- the roster, from Odoo
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
const prevDay = (d: string) => new RealDate(RealDate.parse(`${d}T12:00:00Z`) - 86400e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the days
const probes: Array<{ day: string; at: string; hold: unknown }> = [];
const dayRows: Record<string, unknown[]> = {};
const ownerAt: Record<string, string> = {};
const assumedTaps: string[] = [];
let pendingOwnerTap: number | null = null;
for (const d of DAYS) {
  day = d;
  // Baraa's tap on the previous day's 06:00 template (default mode only)
  const pd = prevDay(d);
  if (!NO_TAP && !DAYS.includes(pd) && pd > TODAY_REAL) {
    await env.MSG_DEDUP.put(kvLastInboundTs(OWNER_PARTNER), String(riyadhMs(`${pd} 06:03`)));
    assumedTaps.push(`${pd} 06:03`);
  }
  for (let min = 0; min < 24 * 60; min += 5) {
    at = hm(min);
    setRiyadh(`${d} ${at}`);
    if (pendingOwnerTap !== null && Date.now() >= pendingOwnerTap) {
      await env.MSG_DEDUP.put(kvLastInboundTs(OWNER_PARTNER), String(pendingOwnerTap));
      assumedTaps.push(new RealDate(pendingOwnerTap + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " "));
      pendingOwnerTap = null;
    }
    const due = CRONS.filter((c) => c === "*/5 * * * *" || CRON_AT[c] === min);
    const n = sends.length;
    for (const c of due) {
      await worker.scheduled({ cron: c, scheduledTime: Date.now(), noRetry() {} } as any, env, { waitUntil() {}, passThroughOnException() {} } as any);
    }
    if (!NO_TAP && sends.slice(n).some((s) => s.to === ownerDigits && s.kind === "utak_shift_start_v2")) pendingOwnerTap = Date.now() + OWNER_TAP_AFTER_MIN * 60e3;
    if (PROBES.includes(at)) {
      const h = await attendance.holdForTask(env, OMAR_PARTNER, { kind: "dryrun_probe", label: `مهمة تجريبية ${at}` });
      probes.push({ day: d, at, hold: { hold: h.hold, phase: h.phase ?? "-", next: h.next ?? "-" } });
    }
  }
  const r = await fetchRoster(env);
  dayRows[d] = r.members.map((m) => ({ ...dayPlan(r, m, d), name: m.name, to: tail(m.whatsapp), roles: m.codes, attendance: m.attendance, calendar: m.calendarName || "-" }));
  ownerAt[d] = hm(attendance.ownerWindowPlan(env).minutes);
}

// ---------------------------------------------------------------- report
const who = (to: string) => {
  if (to === ownerDigits) return "براء";
  const m = roster.members.find((x) => String(x.whatsapp).replace(/\D/g, "") === to);
  return m ? m.name : tail(to);
};
const report = {
  mode: NO_TAP ? "no owner tap" : "Baraa taps his 06:00 template at 06:03 daily", assumedTaps,
  days: DAYS, crons: CRONS, ownerWindowOpenAt: env.OWNER_WINDOW_OPEN_AT,
  roster: roster.members.map((m) => ({ employee: m.employeeId, partner: m.partnerId, name: m.name, to: tail(m.whatsapp), roles: m.codes, attendance: m.attendance, calendar: m.calendarName || null })),
  plans: dayRows, ownerWindowAt: ownerAt,
  sends: sends.map((s) => ({ ...s, to: tail(s.to), who: who(s.to) })),
  probes, attendanceRows: [...att.values()],
  writesOutsideAttendance: writes.filter((w) => w.model !== "x_team_attendance").length,
  writesOutsideAttendanceByModel: Object.entries(writes.filter((w) => w.model !== "x_team_attendance").reduce((a: Record<string, number>, w) => { a[`${w.model}.${w.method}`] = (a[`${w.model}.${w.method}`] ?? 0) + 1; return a; }, {})),
  blocked, errors, refused: [...new Set(refused)],
};
const base = `scripts/artifacts/shift-20260925-dryrun${NO_TAP ? "-no-owner-tap" : ""}`;
writeFileSync(new URL(base + ".json", root), JSON.stringify(report, null, 2) + "\n");
const ROLE_AR: Record<string, string> = { driver: "سائق", warehouse: "شراء", collector: "محصّل", admin: "مدير" };
const kindAr: Record<string, string> = { work: "يوم عمل", day_off: "إجازة أسبوعية", leave: "إجازة", not_enrolled: "غير مشمول بالتحضير", no_calendar: "بلا جدول عمل", no_number: "بلا رقم", no_clock_time: "جدول بلا ساعات" };
const WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const md: string[] = [
  `# تشغيل جاف على بيانات Odoo الحقيقية — ${DAYS.join(" و")}`,
  "", `كل مواعيد sim (${CRONS.length})، ونبضة التحضير 288 مرة في اليوم، ولا أحد من الفريق يضغط «بدء الدوام». لا إرسال ولا كتابة.`,
  `نافذة براء: ${env.OWNER_WINDOW_OPEN_AT} ثابتة (OWNER_WINDOW_OPEN_AT). ${NO_TAP ? "افتراض: براء لا يضغط قالبه أبداً." : `افتراض: براء يضغط قالب 06:00 الساعة 06:03 كل يوم (ضغطات مفترضة: ${assumedTaps.join("، ")})؛ ويوم 26/09 من بيانات Odoo الحقيقية (ضغط 25/09 06:53).`}`, "",
  "## الفريق (hr.employee)", "", "| الموظف | الرقم | الأدوار | مشمول بالتحضير | جدول العمل |", "|---|---|---|---|---|",
  ...report.roster.map((m) => `| ${m.name} (${m.employee}) | ${m.to} | ${m.roles.map((r) => ROLE_AR[r] ?? r).join("، ")} | ${m.attendance ? "نعم" : "لا"} | ${m.calendar ?? "—"} |`),
];
for (const d of DAYS) {
  md.push("", `## ${WEEK[new RealDate(`${d}T12:00:00Z`).getUTCDay()]} ${d}`, "", `- رسالة براء الصباحية: ${ownerAt[d]}`);
  for (const p of dayRows[d] as any[]) md.push(`- ${p.name}: ${kindAr[p.kind] ?? p.kind}${p.startMin !== undefined ? ` (${hm(p.startMin)}–${hm(p.endMin)})` : ""}`);
  md.push("", "| الوقت | إلى | ما سيصله |", "|---|---|---|");
  const ds = sends.filter((s) => s.day === d);
  if (!ds.length) md.push("| — | — | لا شيء |");
  for (const s of ds) md.push(`| ${s.at} | ${who(s.to) === tail(s.to) ? tail(s.to) : `${who(s.to)} ${tail(s.to)}`} | ${s.what.replace(/\|/g, "/")} |`);
  md.push("", "مهمة تجريبية لعمر (holdForTask):", ...probes.filter((p) => p.day === d).map((p) => `- ${p.at}: ${JSON.stringify(p.hold)}`));
}
md.push("", `- صفوف الحضور (في الذاكرة): ${report.attendanceRows.length}`, `- كتابات Odoo أخرى (مجابة محلياً، لم تصل Odoo): ${report.writesOutsideAttendance} ${JSON.stringify(report.writesOutsideAttendanceByModel)}`,
  `- محجوب بالقائمة: ${blocked.length}`, `- أخطاء: ${errors.length}`, `- مرفوض (Graph/خارجي): ${report.refused.join("، ") || "0"}`);
writeFileSync(new URL(base + ".md", root), md.join("\n") + "\n");
out(md.join("\n") + "\n");
out(`\nerrors: ${JSON.stringify(errors.slice(0, 8))}\nblocked: ${JSON.stringify(blocked.slice(0, 5))}\n`);
