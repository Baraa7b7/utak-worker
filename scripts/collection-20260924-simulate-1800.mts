// Replay of the 18:00 collection job with the current code, on the real Odoo
// data, with nothing leaving (2026-09-24).
//
//   • Odoo: reads (search_read / read / search / search_count / fields_get) go
//     to the real tenant; every other method (create, write, message_post, …)
//     is answered locally and listed — nothing is written.
//   • Meta: GET /message_templates is real (the approved body and category);
//     every POST to graph.facebook.com is captured and answered locally.
//
// Three runs:
//   A. sendDailyCollectionSummary as the 0 15 * * * cron calls it, today.
//   B. the 09-24 list (the 15 test invoices, 555 SAR) through the same
//      builder + sendTemplateByPurpose + fetchMeta: what Graph would receive,
//      checked against Meta's rules and the approved template.
//   C. the same list with the template refused (#132018): does the job fall
//      back to free text? Only inside the collector's 24h window.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/collection-20260924-simulate-1800.mts
//
// Out: scripts/artifacts/collection-20260924-simulate-1800.json

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const graphPosts: any[] = [];
const odooWritesBlocked: Array<{ model: string; method: string }> = [];
/** template name → Meta error code to answer with (run C). */
let refuse: Record<string, number> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes("graph.facebook.com")) {
    if (method === "GET" && url.includes("/message_templates")) return realFetch(input, init);
    const body = init?.body ? JSON.parse(init.body) : null;
    graphPosts.push(body);
    const code = refuse[body?.template?.name];
    if (code) return new Response(JSON.stringify({ error: { message: `(#${code}) simulated`, code } }), { status: 400 });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.SIM${graphPosts.length}` }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) {
    odooWritesBlocked.push({ model: m[1], method: m[2] });
    return new Response(JSON.stringify(m[2] === "create" ? [990000 + odooWritesBlocked.length] : true), { status: 200 });
  }
  if (!m && !url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } }
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
const baseEnv: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "SIMULATED", META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"),
  META_WABA_ID: tomlVar("META_WABA_ID"), OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"),
  SIMULATION_MODE: tomlVar("SIMULATION_MODE"), PILOT_MODE: tomlVar("PILOT_MODE"), SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"),
  ACCOUNTING_SYNC: tomlVar("ACCOUNTING_SYNC"), WORKER_ORIGIN: tomlVar("WORKER_ORIGIN"),
  SIM_DB: fakeD1,
};

const { withAutoSendJob, CRON_JOB } = await import("../src/auto-send-guard.ts");
const { sendDailyCollectionSummary, buildCollectionSummary } = await import("../src/invoice.ts");
const { getCollectorTeamMembers, call } = await import("../src/odoo.ts");
const { sendTemplateByPurpose, clearTemplateCache, T } = await import("../src/templates.ts");
const { isInside24hWindow } = await import("../src/wa-inbox.ts");
const { isInvalidTemplateParam } = await import("../src/wa-params.ts");

const tail = (s: string) => "…" + String(s).replace(/\D/g, "").slice(-4);
const freshEnv = () => withAutoSendJob({ ...baseEnv, MSG_DEDUP: new KV() }, CRON_JOB["0 15 * * *"]);
const mask = (b: any) => ({ ...b, to: tail(b?.to ?? "") });

// Approved template, from Meta (GET).
const tplRes = await realFetch(`https://graph.facebook.com/${baseEnv.META_GRAPH_VERSION}/${baseEnv.META_WABA_ID}/message_templates?name=utak_collection_summary&fields=name,status,category,language,components`,
  { headers: { Authorization: `Bearer ${dotenv.META_ACCESS_TOKEN}` } });
const tpl = ((await tplRes.json()) as any).data?.[0];
const TEMPLATE_TEXT: string = tpl?.components?.find((c: any) => c.type === "BODY")?.text ?? "";
const varCount = new Set(TEMPLATE_TEXT.match(/\{\{\d+\}\}/g) ?? []).size;
const render = (p: string[]) => p.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, v), TEMPLATE_TEXT);
const metaCheck = (p: string[]) => ({
  count: `${p.length}/${varCount}`,
  oneLine: p.every((v) => !/[\r\n\t\u2028\u2029]/.test(v)),
  noFiveSpaces: p.every((v) => !/ {5,}/.test(v)),
  nonEmpty: p.every((v) => !isInvalidTemplateParam(v)),
  renderedLength: render(p).length,
  accepted: p.length === varCount && p.every((v) => !isInvalidTemplateParam(v)) && render(p).length <= 1024,
});

const collectors = await getCollectorTeamMembers(freshEnv());
const windows = await Promise.all(collectors.map(async (c) => ({ id: c.id, name: c.name, to: tail(c.whatsapp), inside24h: await isInside24hWindow(freshEnv(), c.id) })));

// ---------------------------------------------------------------- A
graphPosts.length = 0; odooWritesBlocked.length = 0; clearTemplateCache();
const reportA = await sendDailyCollectionSummary(freshEnv());
const runA = { report: reportA, graphPosts: graphPosts.map(mask), odooWritesBlocked: [...odooWritesBlocked] };

// ---------------------------------------------------------------- B
const testInv = await call<any[]>(freshEnv(), "x_invoice", "search_read", {
  domain: [["x_status", "in", ["issued", "overdue"]]], fields: ["id", "x_invoice_number", "x_total", "x_order_id", "x_is_simulation"], order: "x_invoice_date asc, id asc", limit: 200,
});
const orderIds = testInv.map((i) => i.x_order_id?.[0]).filter(Boolean);
const orders = await call<any[]>(freshEnv(), "x_daily_order", "read", { ids: orderIds, fields: ["id", "x_customer_id", "x_delivery_neighborhood"] });
const om = new Map(orders.map((o) => [o.id, o]));
const list = testInv.map((i) => {
  const o = om.get(i.x_order_id?.[0]);
  return { number: i.x_invoice_number, total: i.x_total, customer_name: o?.x_customer_id ? String(o.x_customer_id[1]).replace(/^\[[^\]]*\]\s*/, "") : "عميل", neighborhood: o?.x_delivery_neighborhood || "" };
});
const built = buildCollectionSummary(list, "2026-09-24");
graphPosts.length = 0; odooWritesBlocked.length = 0; clearTemplateCache();
const envB = freshEnv();
for (const c of collectors) await sendTemplateByPurpose(envB, c.whatsapp, T.COLLECTION_SUMMARY, built.params);
const sentB = graphPosts.filter((b) => b?.template?.name === "utak_collection_summary");
const paramsB: string[] = sentB[0]?.template?.components?.find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const runB = {
  invoices: list.length, total: built.grandTotal, allSimulation: testInv.every((i) => i.x_is_simulation === true),
  toGraph: sentB.map(mask), params: paramsB, meta: metaCheck(paramsB), rendered: render(paramsB),
};

// ---------------------------------------------------------------- C
// The real function, on a list that is not empty: a stand-in copy of the 15
// with the flag cleared *in this process only* (the Odoo reply is rewritten
// before the code sees it; nothing is written to Odoo).
const stubFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const res = await stubFetch(input, init);
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (/\/json\/2\/x_invoice\/search_read/.test(url) && String(init?.body ?? "").includes("x_is_simulation")) {
    return new Response(JSON.stringify(testInv.map(({ x_is_simulation, ...r }) => r)), { status: 200 });
  }
  return res;
}) as typeof fetch;
graphPosts.length = 0; odooWritesBlocked.length = 0; clearTemplateCache();
refuse = { utak_collection_summary: 132018 };
const reportC = await sendDailyCollectionSummary(freshEnv());
refuse = {};
globalThis.fetch = stubFetch;
const runC = {
  report: reportC,
  textToCollectors: graphPosts.filter((b) => b?.type === "text" && collectors.some((c) => tail(c.whatsapp) === tail(b.to))).length,
  ownerAlerts: graphPosts.filter((b) => tail(b?.to ?? "") === tail(baseEnv.OWNER_WHATSAPP)).map(mask),
  failureRowsWouldBeWritten: odooWritesBlocked.filter((w) => w.model === "x_wa_message").length,
};

const out = {
  at: new Date().toISOString(),
  template: { name: tpl?.name, status: tpl?.status, category: tpl?.category, language: tpl?.language, variables: varCount },
  collectors: windows,
  A_today: runA, B_0924_list: runB, C_refused_template: runC,
  nothingLeft: { graphPostsForwarded: 0, odooWritesForwarded: 0 },
};
writeFileSync(new URL("scripts/artifacts/collection-20260924-simulate-1800.json", root), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ template: out.template, collectors: windows, A: runA.report, B: { ...runB, rendered: undefined, toGraph: runB.toGraph.length }, C: runC }, null, 2));
