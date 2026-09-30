// م5 on the real Odoo data, with nothing sent and nothing written (2026-09-25).
//
//   • Odoo: reads go to the tenant; every write (create / write / message_post …)
//     is answered locally and recorded.
//   • Meta: every request to graph.facebook.com is answered locally and recorded
//     (the worker env carries no real token either).
//
// Runs, as the crons would: who the 02:00 ask reaches and through which
// template; nudgeLateSuppliers (05:00) and alertSuppliersWithoutPrices (21:15)
// on today's (Riyadh) ask logs — the closest picture of tomorrow.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-20260925-supplier-dryrun.mts
//
// Out: scripts/artifacts/wa-20260925-supplier-dryrun.json

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const sends: any[] = [];
const writes: Array<{ model: string; method: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) {
    const body = init?.body ? JSON.parse(init.body) : null;
    sends.push(body);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.DRY${sends.length}` }] }), { status: 200 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) {
    writes.push({ model: m[1], method: m[2] });
    return new Response(JSON.stringify(m[2] === "create" ? [770000 + writes.length] : true), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } }
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "DRY-RUN", META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"),
  OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"), SIMULATION_MODE: tomlVar("SIMULATION_MODE"), PILOT_MODE: tomlVar("PILOT_MODE"),
  SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"), SIM_DB: fakeD1, MSG_DEDUP: new KV(),
};

const { getActiveSuppliersForAsk, getTemplateByPurpose, getRecentSupplierLogs } = await import("../src/odoo.ts");
const { nudgeLateSuppliers, alertSuppliersWithoutPrices } = await import("../src/suppliers.ts");
const { supplierAskParams } = await import("../src/templates.ts");
const { riyadhMinutes } = await import("../src/hours.ts");

const tail = (s: string) => "…" + String(s ?? "").replace(/\D/g, "").slice(-4);
const shape = (b: any) => ({
  to: tail(b?.to), type: b?.type, template: b?.template?.name ?? null,
  params: (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? null,
  text: b?.text?.body ?? null,
});

// 1) the 02:00 ask
const suppliers = await getActiveSuppliersForAsk(env);
const askTpl = await getTemplateByPurpose(env, "supplier_ask", (n: string) => supplierAskParams(n, "", "").length);
// 2) today's ask logs (Riyadh day)
const logs = await getRecentSupplierLogs(env, riyadhMinutes() / 60 + 0.1);
// 3) 05:00 and 21:15, on today's logs
sends.length = 0;
const nudge = await nudgeLateSuppliers(env);
const nudgeSends = sends.map(shape);
sends.length = 0;
const alert = await alertSuppliersWithoutPrices(env);
const alertSends = sends.map(shape);

const out = {
  at: new Date().toISOString(),
  ask0200: { template: askTpl?.x_meta_template_id ?? null, category: askTpl?.x_category ?? null,
    suppliers: suppliers.map((s: any) => ({ id: s.id, name: s.name, to: tail(s.x_whatsapp_number), products: (s.x_supplied_product_ids ?? []).length })) },
  todayLogs: logs.map((l: any) => ({ id: l.id, supplier: l.x_supplier_id?.[1], sent_at: l.x_sent_at, replied_at: l.x_replied_at || null, status: l.x_status })),
  nudge0500: { ...nudge, sends: nudgeSends },
  alert2115: { ...alert, sends: alertSends },
  blockedOdooWrites: writes,
  nothingLeft: "every Graph request and Odoo write above was answered locally",
};
writeFileSync(new URL("scripts/artifacts/wa-20260925-supplier-dryrun.json", root), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
