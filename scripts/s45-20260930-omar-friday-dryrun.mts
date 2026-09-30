// § 45 ج (2026-09-30) — Omar on seven days, on the real Odoo data, with nothing sent and nothing
// written: Thursday 10-01 from 12:00 and Friday 10-02 all day, every sim cron at its Riyadh time
// (the */5 tick every 5 minutes), nobody taps «بدء الدوام» (the worst case). Built on
// scripts/team-20260925-dryrun.mts (same fetch guard: Odoo reads cached, every write answered
// locally, x_team_attendance in memory, Graph POST /messages recorded, anything else refused).
//
// Checked for Friday: «بدء الدوام» to Omar at 02:00 (and the +30 reminder only because nobody taps);
// the purchase list after Thursday's shift held until Friday 02:00 (not Saturday); the driver's
// follow-up at 11:30 / 12:30 (end − 30 / end + 30 of 02:00–12:00); no «راحة / إجازة» alert.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s45-20260930-omar-friday-dryrun.mts
//
// Out: scripts/artifacts/s45-20260930-omar-friday-dryrun.{json,md}

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

// ---------------------------------------------------------------- args
const DAYS = ["2026-10-01", "2026-10-02"];           // Thursday (from 12:00), Friday
const FROM: Record<string, number> = { "2026-10-01": 12 * 60, "2026-10-02": 0 };
const ASSUME = process.argv.includes("--assume-omar");
const OMAR_EMP = 4, OMAR_PARTNER = 9, FAKE_CAL = 900001;
const FAKE_CAL_NAME = "دوام عمر (افتراضي): الأحد–الخميس 07:00–15:00";
const FAKE_LINES = [6, 0, 1, 2, 3].map((d, i) => ({
  id: 900100 + i, calendar_id: [FAKE_CAL, FAKE_CAL_NAME], calendar_type: "fixed", dayofweek: String(d), hour_from: 7, hour_to: 15,
  duration_based: false, date: false, recurrency: false, recurrency_type: "weeks", recurrency_interval: 1, recurrency_until: false, recurrency_excluded_occurences: false,
}));

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
type Send = { day: string; at: string; to: string; what: string };
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
      const what = b.type === "template" ? `قالب ${b.template?.name} [${params.join(" | ")}]` : b.type === "text" ? `نص: ${String(b.text?.body ?? "").replace(/\s+/g, " ").slice(0, 140)}` : b.type;
      sends.push({ day, at, to: String(b.to ?? ""), what });
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
  // «what if»: عمر's schedule lines (a calendar that does not exist in Odoo)
  if (ASSUME && m && m[1] === "resource.calendar.attendance" && JSON.stringify(body.domain ?? []).includes(String(FAKE_CAL))) {
    return reply(FAKE_LINES);
  }
  const key = url + "|" + (init?.body ?? "");
  let text = cache.get(key);
  if (text === undefined) {
    const r = await realFetch(input, init);
    text = await r.text();
    if (!r.ok) return new Response(text, { status: r.status });
    cache.set(key, text);
  }
  // «what if»: عمر on attendance with that schedule (read side only)
  if (ASSUME && m && m[1] === "hr.employee" && m[2] === "search_read") {
    const rows = JSON.parse(text);
    if (Array.isArray(rows)) for (const r of rows) if (r.id === OMAR_EMP) { r.x_utak_attendance = true; r.resource_calendar_id = [FAKE_CAL, FAKE_CAL_NAME]; }
    return reply(rows);
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

const worker = (await import("../src/index.ts")).default;
const attendance = await import("../src/attendance.ts");
const { fetchRoster, dayPlan } = await import("../src/team-roster.ts");

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

// ---------------------------------------------------------------- the days
const probes: Array<{ day: string; at: string; hold: unknown }> = [];
const dayRows: Record<string, unknown[]> = {};
const ownerAt: Record<string, string> = {};
for (const d of DAYS) {
  day = d;
  for (let min = FROM[d] ?? 0; min < 24 * 60; min += 5) {
    at = hm(min);
    setRiyadh(`${d} ${at}`);
    const due = CRONS.filter((c) => c === "*/5 * * * *" || CRON_AT[c] === min);
    for (const c of due) {
      // a job that waits on the (frozen) clock would never end: 90 s of real time at most, then it is reported
      const t0 = RealDate.now();
      const r = await Promise.race([
        worker.scheduled({ cron: c, scheduledTime: Date.now(), noRetry() {} } as any, env, { waitUntil() {}, passThroughOnException() {} } as any).then(() => "ok"),
        new Promise((res) => setTimeout(() => res("timeout"), 90_000)),
      ]);
      if (r === "timeout") { errors.push({ day, at, line: `TIMEOUT ${c} (90 s)` }); out(`  ! ${d} ${at} ${c}: no end after 90 s — skipped\n`); }
      else if (RealDate.now() - t0 > 20_000) out(`  · ${d} ${at} ${c}: ${Math.round((RealDate.now() - t0) / 1000)} s\n`);
    }
    if (min % 60 === 0) out(`${d} ${at} · sends ${sends.length} · writes ${writes.length} · errors ${errors.length}\n`);
    // the probes: the purchase list after Thursday's shift (21:15), and a task on Friday during / after his shift
    if ((d === "2026-10-01" && at === "21:15") || (d === "2026-10-02" && (at === "10:00" || at === "16:00"))) {
      const h = await attendance.holdForTask(env, OMAR_PARTNER, { kind: "purchase_list", label: `قائمة الشراء (تجربة) ${d} ${at}` });
      probes.push({ day: d, at, hold: { hold: h.hold, phase: h.phase ?? "-", next: h.next ?? "-", onAttendance: h.onAttendance } });
    }
  }
  const r = await fetchRoster(env);
  dayRows[d] = r.members.map((m) => ({ ...dayPlan(r, m, d), name: m.name, to: tail(m.whatsapp), roles: m.codes, attendance: m.attendance, calendar: m.calendarName || "-" }));
  setRiyadh(`${d} 00:00`);
  const plans = r.members.filter((m) => String(m.whatsapp).replace(/\D/g, "") !== String(env.OWNER_WHATSAPP).replace(/\D/g, ""))
    .map((m) => ({ m, p: dayPlan(r, m, d) })).filter((x) => x.p.kind === "work").map((x) => ({ whatsapp: x.m.whatsapp, startMin: x.p.startMin ?? null }));
  void plans; ownerAt[d] = hm(attendance.ownerWindowPlan(env).minutes);
}

// ---------------------------------------------------------------- report
const ownerDigits = String(env.OWNER_WHATSAPP).replace(/\D/g, "");
const who = (to: string) => {
  if (to === ownerDigits) return "براء (المالك)";
  const m = roster.members.find((x) => String(x.whatsapp).replace(/\D/g, "") === to);
  return m ? m.name : tail(to);
};
const report = {
  assume: ASSUME ? FAKE_CAL_NAME : null, days: DAYS, crons: CRONS,
  roster: roster.members.map((m) => ({ employee: m.employeeId, partner: m.partnerId, name: m.name, to: tail(m.whatsapp), roles: m.codes, attendance: m.attendance, calendar: m.calendarName || null })),
  plans: dayRows, ownerWindowAt: ownerAt,
  sends: sends.map((s) => ({ ...s, to: tail(s.to), who: who(s.to) })),
  probes, attendanceRows: [...att.values()],
  writesOutsideAttendance: writes.filter((w) => w.model !== "x_team_attendance").length,
  blocked, errors, refused,
};
const base = "scripts/artifacts/s45-20260930-omar-friday-dryrun";
writeFileSync(new URL(base + ".json", root), JSON.stringify(report, null, 2) + "\n");
const ROLE_AR: Record<string, string> = { driver: "سائق", warehouse: "شراء", collector: "محصّل", admin: "مدير" };
const kindAr: Record<string, string> = { work: "يوم عمل", day_off: "إجازة أسبوعية", leave: "إجازة", not_enrolled: "غير مشمول بالتحضير", no_calendar: "بلا جدول عمل", no_number: "بلا رقم", no_clock_time: "جدول بلا ساعات" };
const md: string[] = [
  `# § 45 ج — عمر 7 أيام: تشغيل جاف على بيانات Odoo الحقيقية — الخميس 10-01 من 12:00 والجمعة 10-02`,
  "", `كل مواعيد sim (${CRONS.length})، ونبضة */5 كل 5 دقائق، ولا أحد يضغط «بدء الدوام». لا إرسال ولا كتابة.`, "",
  "## الفريق (hr.employee)", "", "| الموظف | الرقم | الأدوار | مشمول بالتحضير | جدول العمل |", "|---|---|---|---|---|",
  ...report.roster.map((m) => `| ${m.name} (${m.employee}) | ${m.to} | ${m.roles.map((r) => ROLE_AR[r] ?? r).join("، ")} | ${m.attendance ? "نعم" : "لا"} | ${m.calendar ?? "—"} |`),
];
for (const d of DAYS) {
  md.push("", `## ${d}`, "", `- نافذة براء: ${ownerAt[d]}`);
  for (const p of dayRows[d] as any[]) md.push(`- ${p.name}: ${kindAr[p.kind] ?? p.kind}${p.startMin !== undefined ? ` (${hm(p.startMin)}–${hm(p.endMin)})` : ""}`);
  md.push("", "| الوقت | إلى | ما سيصله |", "|---|---|---|");
  const ds = sends.filter((s) => s.day === d);
  if (!ds.length) md.push("| — | — | لا شيء |");
  for (const s of ds) md.push(`| ${s.at} | ${who(s.to) === tail(s.to) ? tail(s.to) : `${who(s.to)} ${tail(s.to)}`} | ${s.what.replace(/\|/g, "/")} |`);
  md.push("", "قائمة الشراء لعمر (holdForTask كما تناديه 21:15):", ...probes.filter((p) => p.day === d).map((p) => `- ${p.at}: ${JSON.stringify(p.hold)}`));
}
md.push("", `- صفوف الحضور (في الذاكرة): ${report.attendanceRows.length}`, `- كتابات Odoo أخرى (مجابة محلياً): ${report.writesOutsideAttendance}`,
  `- محجوب بالقائمة: ${blocked.length}`, `- أخطاء: ${errors.length}`, `- مرفوض (Graph/خارجي): ${refused.length}`);
const omarFri = (dayRows["2026-10-02"] as any[]).find((p) => /عمر/.test(p.name));
const offAlerts = sends.filter((s) => s.to === ownerDigits && /راحت|إجازة|يوم راحته/.test(s.what));
const shiftStart = sends.filter((s) => s.day === "2026-10-02" && /utak_shift_start/.test(s.what) && who(s.to) !== "براء (المالك)");
md.push("", "## الخلاصة (الجمعة 10-02)", "",
  `- خطة عمر: ${omarFri ? `${kindAr[omarFri.kind] ?? omarFri.kind} ${omarFri.startMin !== undefined ? `${hm(omarFri.startMin)}–${hm(omarFri.endMin)}` : ""}` : "?"}`,
  `- «بدء الدوام» لعمر: ${shiftStart.map((s) => s.at).join("، ") || "لا شيء"}`,
  `- متابعة السائق: التذكير ${omarFri?.endMin ? hm(omarFri.endMin - 30) : "?"} والتنبيه ${omarFri?.endMin ? hm(omarFri.endMin + 30) : "?"} (نهاية الدوام ∓ 30؛ تُرسل فقط إن بقيت محطات مفتوحة)`,
  `- تنبيهات «راحة / إجازة» لبراء: ${offAlerts.length}`);
writeFileSync(new URL(base + ".md", root), md.join("\n") + "\n");
out(md.join("\n") + "\n");
out(`\nerrors: ${JSON.stringify(errors.slice(0, 5))}\nblocked: ${JSON.stringify(blocked.slice(0, 5))}\nrefused: ${JSON.stringify([...new Set(refused)].slice(0, 5))}\n`);
