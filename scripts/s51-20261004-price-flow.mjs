// § 51 (2026-10-04): the price-ask WhatsApp Flow and its template at Meta.
//
//   node scripts/s51-20261004-price-flow.mjs              dry-run: the Flow JSON's shape, and what Meta has (GET only)
//   node scripts/s51-20261004-price-flow.mjs --create     POST the Flow (DRAFT) if the name does not exist, and upload its JSON
//   node scripts/s51-20261004-price-flow.mjs --upload     upload the JSON again (a DRAFT Flow only)
//   node scripts/s51-20261004-price-flow.mjs --publish    POST /publish (irreversible: a published Flow's JSON is frozen)
//   node scripts/s51-20261004-price-flow.mjs --template   POST the template once, if the name does not exist (never a retry)
//   node scripts/s51-20261004-price-flow.mjs --status     GET: the Flow's status and validation errors, the template's status / category
//   node scripts/s51-20261004-price-flow.mjs --preview    GET a preview link of the Flow (printed, never stored)
//
// The Flow uses no endpoint (flow_action navigate, the data with the message):
// no encryption key is generated or uploaded. Meta: no delete, no edit of a
// template; one rejected or filed MARKETING is not re-submitted, and the worker
// keeps the current ask (utak_supplier_ask_v2). No WhatsApp send here.
// Out: scripts/artifacts/s51-20261004-price-flow-meta.json (ids and statuses; no token).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FLOW_CATEGORIES, FLOW_NAME, FLOW_TEMPLATE, buildFlowJson, templatePayload } from "./lib/s51-price-flow.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const V = "v22.0", WABA = "2144001136512196";
const TOKEN = env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/s51-20261004-price-flow-meta.json", import.meta.url).pathname;
const has = (f) => process.argv.includes(f);
const log = (...a) => console.log(...a);
const auth = { Authorization: `Bearer ${TOKEN}` };
const graph = async (path, init = {}) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  return { http: r.status, json: await r.json().catch(() => ({})) };
};
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s51-20261004-price-flow.mjs", flow: null, template: null, history: [] };
const save = () => writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
const note = (what, r) => { report.history.push({ at: new Date().toISOString(), what, http: r.http, response: r.json }); save(); };

const flowJson = buildFlowJson();
const jsonText = JSON.stringify(flowJson, null, 2);
const screen = flowJson.screens[0];
log(`${FLOW_NAME}: Flow JSON ${flowJson.version}, screen ${screen.id}, ${screen.layout.children.length} components (${screen.layout.children.filter((c) => c.type === "TextInput").length} inputs), ${Object.keys(screen.data).length} data keys, ${jsonText.length} chars`);

async function findFlow() {
  const r = await graph(`${WABA}/flows?fields=id,name,status,categories,json_version,validation_errors&limit=100`);
  if (r.json.error) throw new Error(`flows: ${JSON.stringify(r.json.error)}`);
  return (r.json.data ?? []).find((f) => f.name === FLOW_NAME) ?? null;
}
async function uploadJson(id) {
  const form = new FormData();
  form.append("file", new Blob([jsonText], { type: "application/json" }), "flow.json");
  form.append("name", "flow.json");
  form.append("asset_type", "FLOW_JSON");
  const r = await graph(`${id}/assets`, { method: "POST", body: form });
  note("upload", r);
  log(`  → upload ${r.http} ${JSON.stringify(r.json)}`);
  return r;
}
async function templateAtMeta() {
  let url = `${WABA}/message_templates?limit=100&fields=id,name,language,status,category,previous_category,rejected_reason,components`;
  while (url) {
    const r = await graph(url);
    if (r.json.error) throw new Error(JSON.stringify(r.json.error));
    const m = (r.json.data ?? []).find((x) => x.name === FLOW_TEMPLATE.name);
    if (m) return m;
    url = r.json.paging?.next ? r.json.paging.next.replace(`https://graph.facebook.com/${V}/`, "") : null;
  }
  return null;
}

let flow = await findFlow();
if (flow) log(`= Flow at Meta: #${flow.id} ${flow.status} (json ${flow.json_version ?? "?"})${flow.validation_errors?.length ? ` — ${flow.validation_errors.length} validation error(s)` : ""}`);
else if (!has("--create")) log("+ would POST the Flow as DRAFT and upload its JSON (dry-run)");

if (has("--create") && !flow) {
  const r = await graph(`${WABA}/flows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: FLOW_NAME, categories: FLOW_CATEGORIES }) });
  note("create", r);
  log(`  → create ${r.http} ${JSON.stringify(r.json)}`);
  if (!r.json.id) process.exit(1);
  await uploadJson(r.json.id);
  flow = await findFlow();
}
if (has("--upload") && flow) {
  if (flow.status !== "DRAFT") { log(`  ✗ the Flow is ${flow.status}: its JSON is frozen`); process.exit(1); }
  await uploadJson(flow.id);
  flow = await findFlow();
}
if (has("--publish") && flow) {
  if (flow.status === "PUBLISHED") log("= already PUBLISHED");
  else if (flow.validation_errors?.length) { log("  ✗ validation errors — not published"); process.exit(1); }
  else {
    const r = await graph(`${flow.id}/publish`, { method: "POST" });
    note("publish", r);
    log(`  → publish ${r.http} ${JSON.stringify(r.json)}`);
    flow = await findFlow();
  }
}
if (flow) {
  report.flow = { id: flow.id, name: flow.name, status: flow.status, json_version: flow.json_version ?? null, categories: flow.categories ?? null, validation_errors: flow.validation_errors ?? [], at: new Date().toISOString() };
  save();
  if (flow.validation_errors?.length) log(JSON.stringify(flow.validation_errors, null, 2));
}
if (has("--preview") && flow) {
  const r = await graph(`${flow.id}?fields=preview.invalidate(false)`);
  log(`preview: ${r.json.preview?.preview_url ?? JSON.stringify(r.json)}`);
}

let tpl = await templateAtMeta();
const t = FLOW_TEMPLATE;
log(`${t.name}\n  «${t.body}»\n  example ${JSON.stringify(t.example)} · FLOW button «${t.button}» · UTILITY · ${t.language}`);
if (tpl) log(`  = exists at Meta: ${tpl.status}/${tpl.category}${tpl.previous_category ? ` (was ${tpl.previous_category})` : ""} — not re-submitted`);
else if (!has("--template")) log("  + would POST (dry-run)");
else if (!flow || flow.status !== "PUBLISHED") { log("  ✗ the Flow is not PUBLISHED — the template is not submitted"); process.exit(1); }
else {
  const payload = templatePayload(flow.id);
  const r = await graph(`${WABA}/message_templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  report.templateCreated = { at: new Date().toISOString(), http: r.http, response: r.json, payload };
  note("template", r);
  log(`  → POST ${r.http} ${JSON.stringify(r.json)}`);
  tpl = await templateAtMeta();
}
report.template = tpl ? { id: tpl.id, name: tpl.name, status: tpl.status, category: tpl.category, previous_category: tpl.previous_category ?? null, rejected_reason: tpl.rejected_reason ?? null, at: new Date().toISOString() } : null;
save();
log("flow:", JSON.stringify(report.flow), "\ntemplate:", JSON.stringify(report.template));
