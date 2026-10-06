// § 61 ب + ج (2026-10-06) — the proof that nobody's EFFECTIVE roles moved: the team as the worker's own
// code of THIS tree reads it from the tenant (src/team-roster.ts fetchRoster — no cache), and the cost of
// the proof day (src/operating-cost.ts dailyOperatingCost), saved under a label. Run before the jobs
// exist (the code of before § 61), after the jobs are assigned, and after the cards are emptied of what
// the job carries: the three must be the same, letter for letter.
//
// Read-only: any request that is not a read of utakfresh.odoo.com throws. No WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s61-20261006-roles.mts <label>
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s61-20261006-roles.mts --compare=<a>,<b>[,<c>…]
//
// Out: scripts/artifacts/s61-20261006-roles.json (one entry a label). The numbers are kept as their
// last four digits only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const OUT = new URL("scripts/artifacts/s61-20261006-roles.json", root);
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s61-20261006-roles.mts", runs: {} };
const PROOF_DAY = "2026-10-06";

const cmp = (process.argv.find((a) => a.startsWith("--compare=")) ?? "").split("=")[1];
if (cmp) {
  const labels = cmp.split(",").filter(Boolean);
  const runs = labels.map((l) => report.runs[l]);
  if (runs.some((r) => !r)) { console.error(`✗ no run for: ${labels.filter((_, i) => !runs[i]).join(", ")}`); process.exit(2); }
  let bad = 0;
  const first = runs[0];
  for (let i = 1; i < runs.length; i++) {
    const same = JSON.stringify(first.team) === JSON.stringify(runs[i].team);
    const cost = first.cost.total === runs[i].cost.total && first.cost.monthWorkingDays === runs[i].cost.monthWorkingDays && first.cost.source === runs[i].cost.source;
    console.log(`${same ? "✓" : "✗"} the team of «${labels[0]}» = the team of «${labels[i]}» (${first.team.length} members, letter for letter)`);
    console.log(`${cost ? "✓" : "✗"} the cost of ${PROOF_DAY}: ${first.cost.total} = ${runs[i].cost.total} (${runs[i].cost.monthWorkingDays} working days, from «${runs[i].cost.workdaysFrom}»)`);
    if (!same) {
      bad++;
      for (const m of first.team) {
        const o = runs[i].team.find((x: any) => x.employeeId === m.employeeId);
        if (JSON.stringify(m) !== JSON.stringify(o)) console.log(`  ✗ #${m.employeeId} ${m.name}: ${JSON.stringify(m)} ≠ ${JSON.stringify(o ?? null)}`);
      }
      for (const o of runs[i].team) if (!first.team.some((m: any) => m.employeeId === o.employeeId)) console.log(`  ✗ #${o.employeeId} ${o.name}: only in «${labels[i]}»`);
    }
    if (!cost) bad++;
  }
  for (const m of first.team) console.log(`  #${m.employeeId} ${m.name}: ${m.codes.join(" + ") || "-"} · ${m.attendance ? "مشمول بالتحضير" : "بلا تحضير"} · ${m.calendarName || "بلا جدول"} · …${m.whatsappTail}`);
  process.exit(bad ? 1 : 0);
}

const label = process.argv[2];
if (!label || label.startsWith("-")) { console.error("usage: … scripts/s61-20261006-roles.mts <label> | --compare=a,b"); process.exit(2); }
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
const pause = (ms = 500) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (a write): ${m[1]}.${m[2]}`);
  await pause(); // the rate limit is shared with the live worker
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};

const { fetchRoster, dayPlan } = await import("../src/team-roster.ts");
const { dailyOperatingCost } = await import("../src/operating-cost.ts");
const roster: any = await fetchRoster(env);
// what every path of the worker follows, member by member — and nothing § 61 adds to the roster
const team = [...roster.members].sort((a: any, b: any) => a.employeeId - b.employeeId).map((m: any) => {
  const plan: any = dayPlan(roster, m, PROOF_DAY);
  return {
    employeeId: m.employeeId, name: m.name, partnerId: m.partnerId, whatsappTail: String(m.whatsapp).replace(/\D/g, "").slice(-4),
    codes: m.codes, attendance: m.attendance, calendarId: m.calendarId, calendarName: m.calendarName,
    neighborhoods: m.neighborhoods, day: { kind: plan.kind, startMin: plan.startMin ?? null, endMin: plan.endMin ?? null },
  };
});
kv.clear();
const c: any = await dailyOperatingCost(env, PROOF_DAY);
const cost = { total: c.total, monthWorkingDays: c.monthWorkingDays, yearWorkingDays: c.yearWorkingDays, workdaysFrom: c.driver, source: c.source ?? "driver", reason: c.reason ?? null };
report.runs[label] = { at: new Date().toISOString(), team, cost };
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
for (const m of team) console.log(`${label} #${m.employeeId} ${m.name}: ${m.codes.join(" + ") || "-"} · ${m.attendance ? "مشمول بالتحضير" : "بلا تحضير"} · ${m.calendarName || "بلا جدول"} · ${PROOF_DAY}: ${m.day.kind}${m.day.startMin === null ? "" : ` ${m.day.startMin}–${m.day.endMin}`} · …${m.whatsappTail}`);
console.log(`${label} cost ${PROOF_DAY}: ${c.total === null ? `تعذّر (${c.reason})` : c.total.toFixed(2)} · ${c.monthWorkingDays} working days · from «${c.driver ?? "-"}» (${cost.source})`);

// --lines: what the worker of THIS tree would say tonight, read from the tenant and sent nowhere — the
// summary's two lines, the entry message of the trial employee, and the exit list read from Baraa's card.
if (process.argv.includes("--lines")) {
  kv.clear();
  const ST: any = await import("../src/staffing.ts");
  const TRIAL: any = await import("../src/s61-trials.ts");
  const live: any = await fetchRoster(env);
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  console.log("— the 21:30 summary would gain:");
  for (const l of [ST.vacancyLine(ST.vacantJobs(live)), ST.dataCheckLine(await ST.dataFindings(env, live, day))].filter(Boolean)) console.log(`  ${l}`);
  const j = TRIAL.trialJob(live);
  if (j) {
    const m = TRIAL.trialMember(j);
    const first = ST.firstTask(live, m, Date.now());
    console.log("— an entry (the trial employee):");
    console.log(ST.entryText(m, first, (await ST.readJobLists(env, j.id)).takeover, "session", "").split("\n").map((l: string) => `  ${l}`).join("\n"));
    console.log(`  ${ST.welcomeText(ST.welcomeParams(m.name, m.jobName, first))}`);
  }
  const owner = live.staff.find((m: any) => m.jobId && String(m.whatsapp).replace(/\D/g, "").endsWith(team.find((t: any) => t.name === "براء")?.whatsappTail ?? "----"));
  if (owner) {
    const who = ST.snapOf(owner);
    console.log("— an exit (read from Baraa's card, nothing moved):");
    console.log(ST.exitText(who, "trial", (await ST.readJobLists(env, owner.jobId)).handover, await ST.exitFacts(env, who), []).split("\n").map((l: string) => `  ${l}`).join("\n"));
  }
}
