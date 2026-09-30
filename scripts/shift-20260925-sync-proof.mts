// Proof that the 05:00 template sync can record its result again after the
// automation 6 fix (2026-09-25, STATUS § 32). Nothing is sent, nothing is
// written.
//
//   1. runTemplateSync() from src — the code the 05:00 cron runs — against the
//      real Odoo reads. Meta is not called: its template list is rebuilt from
//      Odoo's own x_whatsapp_template rows (the ones not missing in Meta).
//      Every Odoo write is answered locally and captured; any Graph POST is
//      refused and counted.
//   2. The live filter of base.automation 6 (read from Odoo now) and the old
//      JSON one are evaluated with Python the way Odoo's safe_eval does it
//      (eval, no builtins): the old one raises NameError('true') — the 500 of
//      every 05:00 since 09-17 — the new one is a domain.
//   3. That domain against x_wa_control after the sync's own write
//      (x_sync_requested=False …): no match → the webhook does NOT fire again
//      (no loop). Against x_sync_requested=True (Baraa's «مزامنة» button):
//      a match → the webhook fires, as intended.
//   4. The server side (scripts/shift-20260925-odoo-setup.mjs, in its rollback
//      file): the same no-op write on x_wa_control failed with the NameError
//      before the fix and passed after it.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/shift-20260925-sync-proof.mts
//
// Out: scripts/artifacts/shift-20260925-sync-proof.{json,md}

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const simVars = toml.slice(toml.indexOf("[env.sim.vars]"), toml.indexOf("[[env.sim.kv_namespaces]]"));
const tomlVar = (k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(simVars) ?? [])[1] ?? "";

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
const reply = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
const writes: Array<{ model: string; method: string; body: any }> = [];
const refused: string[] = [];
let metaList: unknown[] = [];
const odoo = async (model: string, method: string, body: unknown) => {
  const r = await realFetch(`${dotenv.ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dotenv.ODOO_API_KEY}` }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${model}.${method} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes("graph.facebook.com")) {
    if (method === "GET" && url.includes("/message_templates")) return reply({ data: metaList });   // never reaches Meta
    refused.push(`${method} ${url.split("?")[0]}`);
    return new Response(JSON.stringify({ error: { message: "proof: Graph refused" } }), { status: 503 });
  }
  if (!url.startsWith(dotenv.ODOO_URL)) { refused.push(url.split("?")[0]); throw new Error(`BLOCKED: ${url.split("?")[0]}`); }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) {
    writes.push({ model: m[1], method: m[2], body: init?.body ? JSON.parse(init.body) : {} });
    return reply(m[2] === "create" ? [990000 + writes.length] : true);
  }
  return realFetch(input, init);
}) as typeof fetch;
const errors: string[] = [];
console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(" ").slice(0, 200)); };
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ").slice(0, 200)); };
const out = process.stdout.write.bind(process.stdout);
console.log = () => {};

// ---------------------------------------------------------------- Meta's list, rebuilt from Odoo (read-only)
const rows = await odoo("x_whatsapp_template", "search_read", {
  domain: [["x_missing_in_meta", "=", false], ["x_meta_template_id", "!=", false]],
  fields: ["x_meta_template_id", "x_language", "x_meta_id", "x_meta_status", "x_category", "x_body", "x_buttons"], limit: 2000,
}) as Array<Record<string, any>>;
metaList = rows.map((r) => {
  let buttons: unknown[] = [];
  try { const b = JSON.parse(String(r.x_buttons || "[]")); if (Array.isArray(b)) buttons = b; } catch { /* none */ }
  return {
    id: String(r.x_meta_id || ""), name: r.x_meta_template_id, language: r.x_language, status: r.x_meta_status || "APPROVED", category: r.x_category || "UTILITY",
    components: [{ type: "BODY", text: String(r.x_body || "") }, ...(buttons.length ? [{ type: "BUTTONS", buttons }] : [])],
  };
});

// ---------------------------------------------------------------- 1. the sync, as the 05:00 cron runs it
class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } async list() { return { keys: [], list_complete: true }; } }
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  META_ACCESS_TOKEN: "PROOF", META_WABA_ID: tomlVar("META_WABA_ID"), META_GRAPH_VERSION: tomlVar("META_GRAPH_VERSION"), META_PHONE_NUMBER_ID: tomlVar("META_PHONE_NUMBER_ID"),
  OWNER_WHATSAPP: tomlVar("OWNER_WHATSAPP"), PILOT_MODE: tomlVar("PILOT_MODE"), SIMULATION_MODE: tomlVar("SIMULATION_MODE"), SIM_ALLOWLIST: tomlVar("SIM_ALLOWLIST"),
  ACCOUNTING_SYNC: tomlVar("ACCOUNTING_SYNC"), MSG_DEDUP: new KV(),
};
const { runTemplateSync } = await import("../src/wa-template-sync.ts");
const report = await runTemplateSync(env);
const ctlWrites = writes.filter((w) => w.model === "x_wa_control");
const tplWrites = writes.filter((w) => w.model === "x_whatsapp_template");

// ---------------------------------------------------------------- 2. the filters, as Odoo's safe_eval reads them
const [a6] = await odoo("base.automation", "read", { ids: [6], fields: ["name", "filter_domain", "trigger", "trigger_field_ids", "action_server_ids", "active"] }) as any[];
const OLD = `[["x_sync_requested", "=", true]]`;
const PY = `
import json, sys
names = {"uid": 2, "user": None, "time": None, "datetime": None, "dateutil": None, "timezone": None, "float_compare": None, "b64encode": None, "b64decode": None, "Command": None}
out = []
for src in json.loads(sys.argv[1]):
    try:
        out.append({"src": src, "ok": True, "value": eval(src, {"__builtins__": {}}, dict(names))})
    except Exception as e:
        out.append({"src": src, "ok": False, "error": type(e).__name__ + ": " + str(e)})
print(json.dumps(out))
`;
const evals = JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify([OLD, a6.filter_domain])], { encoding: "utf8" })) as Array<{ src: string; ok: boolean; value?: unknown; error?: string }>;
const [oldEval, newEval] = evals;

// ---------------------------------------------------------------- 3. the domain against x_wa_control after the sync's write
const [ctl] = await odoo("x_wa_control", "search_read", { domain: [], fields: ["id", "x_sync_requested", "x_last_sync_at", "x_last_sync_result"], limit: 1 }) as any[];
const matches = (dom: unknown, rec: Record<string, unknown>) => (dom as Array<[string, string, unknown]>).every(([f, op, v]) => {
  if (op !== "=") throw new Error(`op ${op} not modelled`);
  return rec[f] === v;
});
const afterSync = { ...ctl, ...(ctlWrites.at(-1)?.body?.vals ?? {}) };
const afterButton = { ...ctl, x_sync_requested: true };
const firesAfterSync = newEval.ok ? matches(newEval.value, afterSync) : null;
const firesOnButton = newEval.ok ? matches(newEval.value, afterButton) : null;

// ---------------------------------------------------------------- 4. the server-side probe from the setup script
const rb = JSON.parse(readFileSync(new URL("scripts/artifacts/shift-20260925-odoo-setup-rollback.json", root), "utf8"));

const checks: Array<[string, boolean, string]> = [
  ["the sync ran against the real Odoo rows (Meta list rebuilt from Odoo)", report.fetched === rows.length && report.fetched > 0, `fetched=${report.fetched}`],
  ["the sync logic itself: no error", report.errors.length === 0, JSON.stringify(report.errors.slice(0, 3))],
  ["it ends with ONE write on x_wa_control: x_sync_requested=False, x_last_sync_at, x_last_sync_result",
    ctlWrites.length === 1 && ctlWrites[0].method === "write" && ctlWrites[0].body.vals.x_sync_requested === false && !!ctlWrites[0].body.vals.x_last_sync_at && !!ctlWrites[0].body.vals.x_last_sync_result,
    JSON.stringify(ctlWrites.map((w) => ({ m: w.method, vals: w.body.vals })))],
  ["the old filter (JSON true) fails in Odoo's eval: NameError", !oldEval.ok && /NameError: name 'true' is not defined/.test(oldEval.error ?? ""), oldEval.error ?? ""],
  [`automation 6 in Odoo now: ${a6.filter_domain}`, a6.filter_domain === `[["x_sync_requested", "=", True]]` && a6.active === true && a6.trigger === "on_create_or_write", JSON.stringify(a6)],
  ["the live filter evaluates to a domain (no error)", newEval.ok && JSON.stringify(newEval.value) === JSON.stringify([["x_sync_requested", "=", true]]), JSON.stringify(newEval)],
  ["after the sync's own write (x_sync_requested=False): no match → the webhook does not fire again (no loop)", firesAfterSync === false, JSON.stringify(afterSync)],
  ["Baraa's button (x_sync_requested=True): a match → the webhook fires, as intended", firesOnButton === true, ""],
  ["server: the same write failed before the fix (HTTP 500 NameError)", rb.proof?.before?.ok === false && /NameError/.test(rb.proof?.before?.error ?? ""), String(rb.proof?.before?.error ?? "").slice(0, 140)],
  ["server: …and passed after it", rb.proof?.after?.ok === true, ""],
  ["nothing sent: no Graph POST, no call outside Odoo", refused.length === 0, refused.join(", ")],
];
const result = {
  at: new Date().toISOString(), report: { ...report, created_names: report.created_names.length, missing_in_meta_names: report.missing_in_meta_names },
  controlWrite: ctlWrites.map((w) => w.body), templateWritesCaptured: tplWrites.length, otherWrites: writes.filter((w) => w.model !== "x_wa_control" && w.model !== "x_whatsapp_template").map((w) => `${w.model}.${w.method}`),
  automation6: a6, evals, controlNow: ctl, afterSync, firesAfterSync, firesOnButton, serverProof: rb.proof, refused, logged: errors.slice(0, 10),
  checks: checks.map(([name, ok, detail]) => ({ name, ok, detail })),
};
writeFileSync(new URL("scripts/artifacts/shift-20260925-sync-proof.json", root), JSON.stringify(result, null, 2) + "\n");
const md = [
  "# إثبات مزامنة القوالب 05:00 بعد إصلاح الأتمتة 6 (بلا إرسال ولا كتابة)", "",
  `- المزامنة (runTemplateSync من src): ${report.fetched} قالباً، و${tplWrites.length} كتابة قوالب التُقطت ولم تُرسل، ثم كتابة x_wa_control واحدة:`,
  "  `" + JSON.stringify(ctlWrites.at(-1)?.body?.vals ?? {}) + "`",
  `- الشرط القديم: \`${OLD}\` ← ${oldEval.ok ? "صالح؟!" : oldEval.error}`,
  `- الشرط الحي في Odoo الآن: \`${a6.filter_domain}\` ← ${newEval.ok ? JSON.stringify(newEval.value) : newEval.error}`,
  `- بعد كتابة المزامنة (x_sync_requested=False): الأتمتة ${firesAfterSync ? "تنطلق (حلقة!)" : "لا تنطلق — لا حلقة"}. وزر «مزامنة» (True): ${firesOnButton ? "تنطلق كما يُقصد" : "لا تنطلق!"}.`,
  `- على الخادم: الكتابة نفسها قبل الإصلاح ${rb.proof?.before?.ok ? "نجحت؟!" : "فشلت 500 NameError"}، وبعده ${rb.proof?.after?.ok ? "نجحت" : "فشلت"}.`,
  "", ...checks.map(([name, ok, detail]) => `- ${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`),
];
writeFileSync(new URL("scripts/artifacts/shift-20260925-sync-proof.md", root), md.join("\n") + "\n");
out(md.join("\n") + "\n");
const bad = checks.filter(([, ok]) => !ok);
out(`\nsync proof: ${checks.length - bad.length}/${checks.length}\n`);
if (bad.length) process.exit(1);
