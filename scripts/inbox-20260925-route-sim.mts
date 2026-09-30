// Which inbox channel does a new message reach? (2026-09-25) — on the real
// Odoo data, with nothing written and nothing sent.
//
//   • Odoo: reads go to the tenant; every write (create, write, message_post, …)
//     is answered locally and recorded — so we see which channel a message
//     would be posted to, and whether a channel would be created.
//   • Meta: every request to graph.facebook.com is refused. Outbound runs in
//     SIMULATION_MODE (fetchMeta never calls Meta there) to reach the echo.
//
// For every number that has an inbox channel, plus one number Odoo does not
// know: one inbound (ingestInbound, as the webhook calls it) and one outbound
// (sendText → fetchMeta → echo) — the channel each lands in, against the live
// channel of that number, and the number of channels that would be created.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-route-sim.mts
//
// Out: scripts/artifacts/inbox-20260925-route-sim.json (+ .md)

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
let writes: Array<{ model: string; method: string; body: any }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) {
    writes.push({ model: m[1], method: m[2], body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(m[2] === "create" ? [880000 + writes.length] : true), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } }
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
const baseEnv = () => ({
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", META_ACCESS_TOKEN: "SIMULATED", META_PHONE_NUMBER_ID: "0", META_GRAPH_VERSION: "v22.0",
  SIMULATION_MODE: "true", PILOT_MODE: "false", SIM_ALLOWLIST: "+96", SIM_DB: fakeD1, MSG_DEDUP: new KV(),
}) as any;

const { call } = await import("../src/odoo.ts");
const { ingestInbound, syncInboxChannelTitles } = await import("../src/wa-inbox.ts");
const { sendText } = await import("../src/meta.ts");

// The live channel of every number, as the titles have it (dry run: nothing written).
const plan = await syncInboxChannelTitles(baseEnv(), { dryRun: true });
const liveByNumber = new Map<string, number>();
for (const c of plan) if (c.number && !c.old) liveByNumber.set(c.number, c.channelId);
const numbers = [...liveByNumber.keys(), "+966599000999"];

/** Runs fn with the console muted; the warnings it printed are kept (Odoo hiccups show up there). */
let warnings: string[] = [];
const quiet = async <T,>(fn: () => Promise<T>) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ").slice(0, 200)); };
  try { return await fn(); } finally { console.log = l; console.warn = w; }
};
const landed = () => {
  const posts = writes.filter((w) => w.model === "discuss.channel" && w.method === "message_post").map((w) => w.body.ids?.[0]);
  const creates = writes.filter((w) => w.model === "discuss.channel" && w.method === "create");
  return { channel: posts.at(-1) ?? null, created: creates.length, createdTitle: creates[0]?.body?.vals_list?.[0]?.name ?? null };
};

async function route(num: string) {
  warnings = [];
  writes = [];
  await quiet(() => ingestInbound(baseEnv(), {
    partnerId: 0, partnerName: "", wamid: `wamid.SIM.${num}`, type: "text", text: "محاكاة", from: num,
    profileName: "محاكاة", metaTimestamp: String(Math.floor(Date.now() / 1000)),
  }));
  const inbound = landed();
  const partnerCreated = writes.some((w) => w.model === "res.partner" && w.method === "create");
  let outbound: ReturnType<typeof landed> | { skipped: string } = { skipped: "owner — no echo by design" };
  if (num !== "+966505154962") {
    writes = [];
    await quiet(() => sendText(baseEnv(), num, "محاكاة صادر"));
    outbound = landed();
  }
  const live = liveByNumber.get(num) ?? null;
  const inboundOk = live ? inbound.channel === live && inbound.created === 0 : inbound.created === 1;
  const outboundOk = "skipped" in outbound || (live ? outbound.channel === live && outbound.created === 0 : true);
  return { number: num, liveChannel: live, inbound, partnerCreated, outbound, ok: inboundOk && outboundOk, warnings };
}

// A miss is run once more, with the warnings of both runs kept: the tenant
// answers 503 now and then, and a lost read must not pass for a wrong channel.
const rows = [];
for (const num of numbers) {
  const first = await route(num);
  rows.push(first.ok ? first : { ...(await route(num)), firstTry: { inbound: first.inbound, outbound: first.outbound, warnings: first.warnings } });
}

const clean = (s: unknown) => String(s ?? "").replace(/[\u2066\u2069]/g, "");
const out = { at: new Date().toISOString(), allOk: rows.every((r) => r.ok), rows };
writeFileSync(new URL("scripts/artifacts/inbox-20260925-route-sim.json", root), JSON.stringify(out, null, 2) + "\n");
const md = [
  `# محاكاة وصول الرسائل إلى قنوات الصندوق — ${out.at.slice(0, 16).replace("T", " ")} UTC (لا كتابة ولا إرسال)`, "",
  "| الرقم | القناة الحية | الوارد وصل إلى | قنوات جديدة (وارد) | الصادر وصل إلى | قنوات جديدة (صادر) | ✓ |", "|---|---|---|---|---|---|---|",
  ...rows.map((r: any) => `| ${r.number}${r.firstTry ? " (أُعيد)" : ""} | ${r.liveChannel ?? "— (رقم جديد)"} | ${r.inbound.channel ?? "—"} | ${r.inbound.created}${r.inbound.createdTitle ? ` («${clean(r.inbound.createdTitle)}»)` : ""}${r.partnerCreated ? " + شريك جديد" : ""} | ${"skipped" in r.outbound ? "المالك: بلا صدى" : r.outbound.channel ?? "—"} | ${"skipped" in r.outbound ? "—" : r.outbound.created} | ${r.ok ? "✓" : "✗"} |`),
  "", ...rows.filter((r: any) => r.firstTry).map((r: any) => `- ${r.number}: أُعيد بعد محاولة أولى فارغة. تحذيرات الأولى: ${r.firstTry.warnings.join(" | ") || "—"}`),
  "", `**النتيجة:** ${out.allOk ? "كل رقم يصل إلى قناته الحية، ولا قناة ثانية؛ والرقم الجديد قناة واحدة بعنوانها الكامل." : "يوجد رقم لم يصل إلى قناته الحية — راجع الجدول."}`,
].join("\n") + "\n";
writeFileSync(new URL("scripts/artifacts/inbox-20260925-route-sim.md", root), md);
console.log(md);
if (!out.allOk) process.exit(1);
