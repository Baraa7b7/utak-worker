// § 43 ج (2026-09-27) — the next 24 hours of prod's schedule, dry: every job the
// twelve crons run, with prod's variables read from wrangler.toml ([vars], the
// launch combination of § 42 د) and the live Odoo tenant, and nothing sent and
// nothing written.
//
//   • Odoo: reads go to the tenant (identical reads are answered from a local
//     cache — nothing is written, so a repeat is the same answer); every write
//     (create / write / message_post / …) is answered locally and counted.
//   • Meta: every POST /messages is answered locally and recorded with its full
//     recipient; every other Graph call is refused (the env carries no token).
//     Claude, Gotenberg and anything else are refused.
//   • KV / D1 / R2: in memory, one day shared by every job (the dedup keys, the
//     24h windows — empty, as on prod's first day — and the held queue).
//
// The clock is set to each job's minute, in order, from 2026-09-27 02:00 to
// 2026-09-28 01:57 Riyadh: the ten daily crons, each */5 tick (288) and each
// driver tick (288). Every message the gateway decides on is listed — sent
// (template or session), held (the queue), skipped, refused — with the
// recipient's identity from Odoo: Baraa (OWNER_WHATSAPP), a team member
// (hr.employee with «أدوار UTAK»), a supplier / price source (res.partner
// supplier_rank > 0 or x_price_source), or «آخر» (the stop condition of § 43 ج).
//
// The price list's audience (§ 35 priceRecipients, read only): the */5 tick publishes the day by
// itself at the deadline (automatic approval), so its recipients count in the condition.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/archive/s43-20260927-cron-dryrun.mts [--from=2026-09-27T02:00] [--hours=24]
//
// Out: scripts/artifacts/s43-20260927-cron-dryrun.json (+ .md), numbers masked.
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
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const FROM = RealDate.parse(`${arg("from", "2026-09-27T02:00")}:00+03:00`);
const HOURS = Number(arg("hours", "24"));
const riyadh = (ms: number) => new RealDate(ms + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

// ---------------------------------------------------------------- env (prod)
const root = new URL("../../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const prodVars = toml.slice(toml.indexOf("[vars]"), toml.indexOf("[[kv_namespaces]]"));
const simTriggers = toml.slice(toml.search(/^\[env\.sim\.triggers\]/m), toml.search(/^\[env\.sim\.vars\]/m));
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(prodVars) ?? [])[1];
const CRONS = [...simTriggers.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
if (CRONS.length !== 12) throw new Error(`expected the 12 sim crons, found ${CRONS.length}`);

// ---------------------------------------------------------------- fetch
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get", "name_search", "read_group", "web_read", "web_search_read"]);
let job = "";
type Send = { at: string; job: string; to: string; kind: string; template?: string; text?: string; purpose?: string };
const sends: Send[] = [];
type Decision = { at: string; job: string; action: string; purpose: string; last4: string; note?: string };
const decisions: Decision[] = [];
const writes: Array<{ job: string; model: string; method: string }> = [];
const refused: Array<{ job: string; url: string }> = [];
const cache = new Map<string, string>();
let odooReads = 0, cacheHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init?.method ?? (typeof input === "object" && input?.method) ?? "GET").toUpperCase();
  if (url.includes("graph.facebook.com")) {
    if (method === "POST" && /\/messages$/.test(url)) {
      const b = init?.body ? JSON.parse(init.body) : {};
      sends.push({
        at: riyadh(Date.now()), job, to: String(b.to ?? ""), kind: b.type,
        template: b.type === "template" ? b.template?.name : undefined,
        text: b.type === "text" ? String(b.text?.body ?? "").replace(/\s+/g, " ").slice(0, 90)
          : b.type === "interactive" ? String(b.interactive?.body?.text ?? "").replace(/\s+/g, " ").slice(0, 90) : undefined,
      });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: b.to }], messages: [{ id: `wamid.DRY43.${sends.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    refused.push({ job, url: url.replace(/\?.*$/, "") });
    return new Response(JSON.stringify({ error: { message: "dry-run: Graph refused", code: 0 } }), { status: 503 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) {
    refused.push({ job, url: url.split("?")[0] });
    throw new Error(`BLOCKED (dry-run): ${url.split("?")[0]}`);
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m || !READS.has(m[2])) {
    writes.push({ job, model: m?.[1] ?? "?", method: m?.[2] ?? url.slice(0, 60) });
    return new Response(JSON.stringify(m?.[2] === "create" ? [990000 + writes.length] : true), { status: 200, headers: { "content-type": "application/json" } });
  }
  const key = `${url}\n${typeof init?.body === "string" ? init.body : ""}`;
  const hit = cache.get(key);
  if (hit !== undefined) { cacheHits++; return new Response(hit, { status: 200, headers: { "content-type": "application/json" } }); }
  for (let i = 0; ; i++) {
    odooReads++;
    const r = await realFetch(input, init);
    if (r.status === 429 && i < 8) { await new Promise((s) => setTimeout(s, 800 * (i + 1))); continue; }
    const t = await r.text();
    if (r.ok) cache.set(key, t);
    return new Response(t, { status: r.status, headers: { "content-type": "application/json" } });
  }
}) as typeof fetch;

// the gateway's own lines carry the purpose and the last four digits
const errors: Array<{ job: string; line: string }> = [];
const onLine = (s: string) => {
  let x = /\[gateway\] (sent|held|skipped|expired|blocked) purpose=(\S+) to=…(\d{4})(.*)$/.exec(s);
  if (x) {
    decisions.push({ at: riyadh(Date.now()), job, action: x[1], purpose: x[2], last4: x[3], note: x[4].replace(/^\s*(—\s*)?/, "").slice(0, 160) || undefined });
    if (x[1] === "sent") {
      const s2 = [...sends].reverse().find((z) => !z.purpose && z.to.replace(/\D/g, "").endsWith(x![3]));
      if (s2) s2.purpose = x[2];
    }
    return;
  }
  x = /\[owner-guard\] blocked purpose=(\S+)/.exec(s);
  if (x) { decisions.push({ at: riyadh(Date.now()), job, action: "refused (owner-guard)", purpose: x[1], last4: OWNER.slice(-4) }); return; }
  x = /\[gateway\] skip to=…(\d{4}) — (.*)$/.exec(s);
  if (x) { decisions.push({ at: riyadh(Date.now()), job, action: "refused", purpose: (/purpose=(\S+?)\)/.exec(x[2]) ?? [])[1] ?? "?", last4: x[1], note: x[2].slice(0, 160) }); return; }
  x = /\[gateway\] skip purpose=(\S+) to=…(\d{4}) — (.*)$/.exec(s);
  if (x) { decisions.push({ at: riyadh(Date.now()), job, action: "refused", purpose: x[1], last4: x[2], note: x[3].slice(0, 160) }); return; }
  x = /\[gateway\] BLOCKED by allowlist: to=(\d+)/.exec(s);
  if (x) decisions.push({ at: riyadh(Date.now()), job, action: "refused (allowlist)", purpose: "?", last4: x[1].slice(-4) });
};
const realLog = console.log, realWarn = console.warn, realError = console.error;
console.log = (...a: unknown[]) => onLine(a.map(String).join(" "));
console.warn = (...a: unknown[]) => onLine(a.map(String).join(" "));
console.error = (...a: unknown[]) => { const s = a.map((x) => x instanceof Error ? x.message : String(x)).join(" "); onLine(s); errors.push({ job, line: s.slice(0, 240) }); };

class KV {
  store = new Map<string, string>();
  async get(k: string, t?: unknown) { const v = this.store.get(k) ?? null; return v !== null && (t === "json" || (t as { type?: string })?.type === "json") ? JSON.parse(v) : v; }
  async put(k: string, v: string) { this.store.set(k, typeof v === "string" ? v : JSON.stringify(v)); }
  async delete(k: string) { this.store.delete(k); }
  async list(o?: { prefix?: string }) { return { keys: [...this.store.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true, cursor: "" }; }
}
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), all: async () => ({ results: [] }), first: async () => null }), run: async () => ({ success: true }), all: async () => ({ results: [] }), first: async () => null }), batch: async () => [] };
const fakeR2 = { put: async () => ({}), get: async () => null, head: async () => null, delete: async () => {} };
const kv = new KV();
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "DRY-RUN", META_APP_SECRET: "DRY-RUN", META_VERIFY_TOKEN: "DRY-RUN",
  META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"), META_WABA_ID: tomlVar("META_WABA_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"),
  WORKER_ORIGIN: tomlVar("WORKER_ORIGIN"), OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"),
  CLAUDE_MODEL_CLASSIFY: tomlVar("CLAUDE_MODEL_CLASSIFY"), CLAUDE_MODEL_REPLY: tomlVar("CLAUDE_MODEL_REPLY"),
  SIMULATION_MODE: tomlVar("SIMULATION_MODE"), PILOT_MODE: tomlVar("PILOT_MODE"), SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"),
  ACCOUNTING_SYNC: tomlVar("ACCOUNTING_SYNC"), OWNER_WINDOW_OPEN_AT: tomlVar("OWNER_WINDOW_OPEN_AT"),
  SIM_DB: fakeD1, MSG_DEDUP: kv, INVOICES_BUCKET: fakeR2,
};
const OWNER = String(env.OWNER_WHATSAPP ?? "").replace(/\D/g, "");
if (env.SIMULATION_MODE !== "false" || env.PILOT_MODE !== "false" || env.SIM_ALLOWLIST !== undefined || env.ACCOUNTING_SYNC !== "true") {
  throw new Error(`not prod's launch combination: ${JSON.stringify({ SIMULATION_MODE: env.SIMULATION_MODE, PILOT_MODE: env.PILOT_MODE, SIM_ALLOWLIST: env.SIM_ALLOWLIST, ACCOUNTING_SYNC: env.ACCOUNTING_SYNC })}`);
}

const worker = (await import("../../src/index.ts")).default;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} } as any;

// ---------------------------------------------------------------- the day
const LABEL: Record<string, string> = {
  "0 23 * * *": "02:00 طلب أسعار الموردين",
  "0 2 * * *": "05:00 درجات الموردين + تذكير المورد الصامت + مزامنة القوالب",
  "0 3 * * *": "06:00 فتح الطلبات + تنبيه موردين لم يردوا + متابعة قائمة الشراء",
  "0 5 * * *": "08:00 التقييم + تذكير الدفع (م2) + إعادة التنشيط",
  "0 14 * * *": "17:00 تذكير الطلب المعتاد",
  "0 15 * * *": "18:00 ملخص التحصيل",
  "0 17 * * *": "20:00 تذكير الطلبات غير المؤكدة",
  "0 18 * * *": "21:00 إقفال الطلبات غير المؤكدة",
  "15 18 * * *": "21:15 قائمة الشراء + تنبيه المورد بلا سعر",
  "30 18 * * *": "21:30 ملخص اليوم لبراء (م17)",
  "*/5 * * * *": "*/5 التحضير + الطابور + السجل + الأسعار + تأكيد الدفع + فاتورة الشراء + التحصيل + دفع الموردين",
  "2,7,12,17,22,27,32,37,42,47,52,57 * * * *": "*/5+2 متابعة السائق (م12)",
};
const matches = (cron: string, ms: number): boolean => {
  const d = new RealDate(ms);
  const [mi, h] = cron.split(" ");
  const inField = (f: string, v: number) => f === "*" || (f.startsWith("*/") ? v % Number(f.slice(2)) === 0 : f.split(",").map(Number).includes(v));
  return inField(mi, d.getUTCMinutes()) && inField(h, d.getUTCHours());
};
const runs: Array<{ at: string; cron: string }> = [];
const started = RealDate.now();
for (let t = FROM; t < FROM + HOURS * 3600_000; t += 60_000) {
  // the daily jobs first, then the ticks of the same minute
  const due = CRONS.filter((c) => matches(c, t)).sort((a, b) => Number(a.startsWith("*/") || a.startsWith("2,")) - Number(b.startsWith("*/") || b.startsWith("2,")));
  for (const cron of due) {
    fixedNow = t;
    job = `${riyadh(t).slice(11)} ${LABEL[cron] ?? cron}`;
    runs.push({ at: riyadh(t), cron });
    await worker.scheduled({ cron, scheduledTime: t, noRetry() {} } as any, env, ctx);
    while (pending.length) await Promise.allSettled(pending.splice(0));
  }
  if (new RealDate(t).getUTCMinutes() === 0) realLog(`${riyadh(t)} · runs ${runs.length} · sends ${sends.length} · decisions ${decisions.length} · reads ${odooReads} (cache ${cacheHits}) · ${Math.round((RealDate.now() - started) / 1000)}s`);
}
fixedNow = null;
console.log = realLog; console.warn = realWarn; console.error = realError;

// ---------------------------------------------------------------- who is who
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const mask = (v: unknown) => { const d = digits(v); return d ? `+${d.slice(0, 3)}…${d.slice(-4)}` : "—"; };
const odooRead = async (model: string, body: unknown): Promise<any[]> => {
  for (let i = 0; ; i++) {
    const r = await realFetch(`${dotenv.ODOO_URL}/json/2/${model}/search_read`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dotenv.ODOO_API_KEY}` }, body: JSON.stringify(body),
    });
    if (r.status === 429 && i < 8) { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`${model}.search_read HTTP ${r.status}`);
    return r.json();
  }
};
const partners: any[] = await odooRead("res.partner", { domain: [], fields: ["id", "name", "phone", "x_whatsapp_number", "supplier_rank", "customer_rank", "x_price_source", "x_contact_class", "active"], context: { active_test: false } });
const employees: any[] = await odooRead("hr.employee", { domain: [["x_utak_role_ids", "!=", false]], fields: ["id", "name", "x_utak_whatsapp", "work_contact_id", "active"] });
type Who = { category: "براء" | "فريق (hr.employee)" | "مورد / مصدر" | "آخر"; name: string };
const identify = (num: string): Who => {
  const d = digits(num);
  if (d && d === OWNER) return { category: "براء", name: "براء (OWNER_WHATSAPP)" };
  const e = employees.filter((x) => digits(x.x_utak_whatsapp) === d);
  if (e.length) return { category: "فريق (hr.employee)", name: e.map((x) => `${x.name} (موظف #${x.id})`).join("، ") };
  const p = partners.filter((x) => d && (digits(x.x_whatsapp_number) === d || digits(x.phone) === d));
  const sup = p.filter((x) => (x.supplier_rank ?? 0) > 0 || x.x_price_source === true);
  if (sup.length) return { category: "مورد / مصدر", name: sup.map((x) => `${x.name} (#${x.id})`).join("، ") };
  return { category: "آخر", name: p.map((x) => `${x.name} (#${x.id}${x.active ? "" : "، مؤرشف"}${x.x_contact_class ? `، ${x.x_contact_class}` : ""})`).join("، ") || "لا شريك" };
};
const knownByLast4 = (l4: string): string[] => {
  const all = new Set<string>();
  if (OWNER.endsWith(l4)) all.add(OWNER);
  for (const e of employees) if (digits(e.x_utak_whatsapp).endsWith(l4)) all.add(digits(e.x_utak_whatsapp));
  for (const p of partners) for (const n of [p.x_whatsapp_number, p.phone]) if (digits(n) && digits(n).endsWith(l4)) all.add(digits(n));
  for (const s of sends) if (digits(s.to).endsWith(l4)) all.add(digits(s.to));
  return [...all];
};
// held: the queue in KV has the full numbers
const heldQueues: Array<{ to: string; purposes: string[] }> = [];
for (const [k, v] of kv.store) {
  const m = /^wa_q:v1:(\d+)$/.exec(k);
  if (m) heldQueues.push({ to: m[1], purposes: (JSON.parse(v) as Array<{ purpose: string }>).map((i) => i.purpose) });
}

// the price list (§ 35 / § 40): the */5 tick publishes it by itself — at the deadline a draft day
// with a publishable line is approved automatically and published (checkPricesDeadline →
// publishPriceDay), and an approved day is published by the same tick. It did not run above only
// because no price has arrived today. Its audience is src/prices.ts priceRecipients, read here.
const { priceRecipients } = await import("../../src/prices.ts");
const onApproval = (await priceRecipients(env)).map((r) => ({ number: mask(r.phone), name: `${r.name} (#${r.id})`, category: identify(r.phone).category }));

type Row = { number: string; category: string; name: string; purposes: Set<string>; outcomes: Map<string, number>; jobs: Set<string>; first: string };
const rows = new Map<string, Row>();
const add = (num: string, purpose: string, outcome: string, jobName: string, at: string) => {
  const d = digits(num) || `…${num}`;
  const w = digits(num) ? identify(num) : { category: "آخر", name: "رقم غير معروف" };
  const r = rows.get(d) ?? { number: digits(num) ? mask(num) : `…${num}`, category: w.category, name: w.name, purposes: new Set(), outcomes: new Map(), jobs: new Set(), first: at };
  r.purposes.add(purpose || "?"); r.outcomes.set(outcome, (r.outcomes.get(outcome) ?? 0) + 1); r.jobs.add(jobName.replace(/^\d\d:\d\d /, "")); rows.set(d, r);
};
for (const s of sends) add(s.to, s.purpose ?? "?", s.kind === "template" ? `قالب ${s.template}` : `جلسة (${s.kind})`, s.job, s.at);
for (const d of decisions.filter((x) => x.action !== "sent")) {
  const cands = knownByLast4(d.last4);
  add(cands.length === 1 ? cands[0] : d.last4, d.purpose, d.action + (cands.length > 1 ? ` (…${d.last4} يطابق ${cands.length})` : ""), d.job, d.at);
}
const table = [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.first.localeCompare(b.first));
const others = table.filter((r) => r.category === "آخر");
const publishOthers = onApproval.filter((r) => r.category === "آخر");

const out = {
  at: new RealDate().toISOString(),
  window: { fromRiyadh: riyadh(FROM), hours: HOURS },
  env: { SIMULATION_MODE: env.SIMULATION_MODE, PILOT_MODE: env.PILOT_MODE, SIM_ALLOWLIST: env.SIM_ALLOWLIST ?? "(unset)", ACCOUNTING_SYNC: env.ACCOUNTING_SYNC, OWNER_WINDOW_OPEN_AT: env.OWNER_WINDOW_OPEN_AT, WORKER_ORIGIN: env.WORKER_ORIGIN },
  crons: CRONS,
  runs: { total: runs.length, byCron: CRONS.map((c) => ({ cron: c, label: LABEL[c], runs: runs.filter((r) => r.cron === c).length })) },
  recipients: table.map((r) => ({ number: r.number, category: r.category, name: r.name, purposes: [...r.purposes], outcomes: Object.fromEntries(r.outcomes), jobs: [...r.jobs], first: r.first })),
  condition: {
    allowedOnly: others.length === 0 && publishOthers.length === 0,
    others: others.map((r) => ({ number: r.number, name: r.name, purposes: [...r.purposes] })),
    pricePublishOthers: publishOthers.map((r) => ({ number: r.number, name: r.name, purpose: "prices_publish (نبضة */5 عند الموعد أو بعد الاعتماد)" })),
  },
  sends: sends.map((s) => ({ ...s, to: mask(s.to) })),
  decisions,
  priceApprovalAudience: onApproval,
  heldAtEnd: heldQueues.map((q) => ({ to: mask(q.to), who: identify(q.to), purposes: q.purposes })),
  odoo: { reads: odooReads, cacheHits, writesIntercepted: writes.reduce((a, w) => ((a[`${w.model}.${w.method}`] = (a[`${w.model}.${w.method}`] ?? 0) + 1), a), {} as Record<string, number>) },
  refusedCalls: [...new Set(refused.map((r) => `${r.url}`))],
  errors: errors.reduce((a, e) => { const k = `${e.job.replace(/^\d\d:\d\d /, "")} :: ${e.line.slice(0, 160)}`; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>),
};
writeFileSync(new URL("scripts/artifacts/s43-20260927-cron-dryrun.json", root), JSON.stringify(out, null, 1) + "\n");
const md = [
  `# § 43 ج — جدولة prod للـ24 ساعة القادمة، جافاً (${riyadh(FROM)} → +${HOURS}س، الرياض)`,
  "",
  `المتغيرات من wrangler.toml [vars]: SIMULATION_MODE=${env.SIMULATION_MODE} · PILOT_MODE=${env.PILOT_MODE} · SIM_ALLOWLIST=${env.SIM_ALLOWLIST ?? "غير معرّف"} · ACCOUNTING_SYNC=${env.ACCOUNTING_SYNC} · OWNER_WINDOW_OPEN_AT=${env.OWNER_WINDOW_OPEN_AT}`,
  `التشغيلات: ${runs.length} (${out.runs.byCron.map((c) => `${c.label?.split(" ")[0]} ×${c.runs}`).join("، ")})`,
  "",
  "| الرقم | الفئة | الاسم | الأغراض | النتيجة | المهام |",
  "|---|---|---|---|---|---|",
  ...table.map((r) => `| ${r.number} | ${r.category} | ${r.name} | ${[...r.purposes].join("، ")} | ${[...r.outcomes].map(([k, v]) => `${k} ×${v}`).join("، ")} | ${[...r.jobs].join(" · ")} |`),
  "",
  `**جمهور نشر الأسعار (§ 35 / § 40، قراءة):** النبضة */5 تعتمد اليوم تلقائياً عند الموعد النهائي إن كان فيه صنف قابل للنشر وتنشره، وتنشر اليوم المعتمد. لم يجرِ أعلاه لأن لا سعر وصل اليوم. من سيصله: ${onApproval.length ? onApproval.map((r) => `${r.number} ${r.name} [${r.category}]`).join("، ") : "لا أحد"}`,
  "",
  `**الشرط (براء + الفريق + الموردون/المصادر فقط):** ${others.length === 0 && publishOthers.length === 0 ? "متحقق ✅" : `غير متحقق ❌ — ${[...others.map((r) => `${r.number} ${r.name}`), ...publishOthers.map((r) => `${r.number} ${r.name} (نشر الأسعار)`)].join("؛ ")}`}`,
  `المحجوز في الطابور آخر اليوم: ${out.heldAtEnd.length ? out.heldAtEnd.map((h) => `${h.to} ${h.who.name}: ${h.purposes.join("، ")}`).join(" | ") : "لا شيء"}`,
  `قراءات Odoo: ${odooReads} (+${cacheHits} من الذاكرة) · كتابات معترضة: ${JSON.stringify(out.odoo.writesIntercepted)}`,
  `نداءات مرفوضة: ${out.refusedCalls.join("، ") || "لا شيء"}`,
  `أخطاء المهام: ${Object.keys(out.errors).length ? Object.entries(out.errors).map(([k, v]) => `${k} ×${v}`).join(" | ") : "لا شيء"}`,
  "",
].join("\n");
writeFileSync(new URL("scripts/artifacts/s43-20260927-cron-dryrun.md", root), md);
realLog(md);
