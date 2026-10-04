// § 53 ج / د (2026-10-04): the customer's two WhatsApp Flows at Meta — utak_order_v1 (the order form)
// and utak_register_v1 (the registration). No template is made for them: both are sent inside the
// 24h window only.
//
//   node scripts/s53-20261004-flows.mjs [order] [register]              dry-run: each Flow JSON's shape, and what Meta has (GET only)
//   node scripts/s53-20261004-flows.mjs [order] [register] --create     POST the Flow (DRAFT) if the name does not exist, and upload its JSON
//   node scripts/s53-20261004-flows.mjs [order] [register] --upload     upload the JSON again (a DRAFT Flow only)
//   node scripts/s53-20261004-flows.mjs [order] [register] --publish    POST /publish (irreversible: a published Flow's JSON is frozen)
//   node scripts/s53-20261004-flows.mjs [order] [register] --preview    GET a preview link (printed, never stored)
//
// No Flow named = both. Neither uses an endpoint (flow_action navigate, the data with the message): no
// encryption key is generated or uploaded. Meta: nothing is deleted. No WhatsApp send here.
// Out: scripts/artifacts/s53-20261004-flows-meta.json (ids and statuses; no token).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FLOWS, FLOW_CATEGORIES } from "./lib/s53-flows.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const V = "v22.0", WABA = "2144001136512196";
const OUT = new URL("./artifacts/s53-20261004-flows-meta.json", import.meta.url).pathname;
const has = (f) => process.argv.includes(f);
const log = (...a) => console.log(...a);
const graph = async (path, init = {}) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { ...init, headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, ...(init.headers ?? {}) } });
  return { http: r.status, json: await r.json().catch(() => ({})) };
};
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s53-20261004-flows.mjs", flows: {}, history: [] };
const save = () => writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
const note = (what, r) => { report.history.push({ at: new Date().toISOString(), what, http: r.http, response: r.json }); save(); };
const named = FLOWS.filter((f) => process.argv.includes(f.key));
const todo = named.length ? named : FLOWS;

async function findFlow(name) {
  const r = await graph(`${WABA}/flows?fields=id,name,status,categories,json_version,validation_errors&limit=100`);
  if (r.json.error) throw new Error(`flows: ${JSON.stringify(r.json.error)}`);
  return (r.json.data ?? []).find((f) => f.name === name) ?? null;
}
async function uploadJson(id, jsonText, key) {
  const form = new FormData();
  form.append("file", new Blob([jsonText], { type: "application/json" }), "flow.json");
  form.append("name", "flow.json");
  form.append("asset_type", "FLOW_JSON");
  const r = await graph(`${id}/assets`, { method: "POST", body: form });
  note(`${key}: upload`, r);
  log(`  → upload ${r.http} ${JSON.stringify(r.json)}`);
  return r;
}

for (const f of todo) {
  const flowJson = f.build();
  const jsonText = JSON.stringify(flowJson, null, 2);
  const first = flowJson.screens[0];
  const inputs = flowJson.screens.reduce((n, s) => n + s.layout.children.filter((c) => c.type === "TextInput" || c.type === "Dropdown").length, 0);
  log(`${f.name}: Flow JSON ${flowJson.version}, ${flowJson.screens.length} screen(s) (${flowJson.screens.map((s) => s.id).join(" → ")}), ${inputs} inputs, ${Object.keys(first.data).length} data keys on ${first.id}, ${jsonText.length} chars`);
  let flow = await findFlow(f.name);
  if (flow) log(`= at Meta: #${flow.id} ${flow.status} (json ${flow.json_version ?? "?"})${flow.validation_errors?.length ? ` — ${flow.validation_errors.length} validation error(s)` : ""}`);
  else if (!has("--create")) log("+ would POST the Flow as DRAFT and upload its JSON (dry-run)");
  if (has("--create") && !flow) {
    const r = await graph(`${WABA}/flows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, categories: FLOW_CATEGORIES }) });
    note(`${f.key}: create`, r);
    log(`  → create ${r.http} ${JSON.stringify(r.json)}`);
    if (!r.json.id) process.exit(1);
    await uploadJson(r.json.id, jsonText, f.key);
    flow = await findFlow(f.name);
  }
  if (has("--upload") && flow) {
    if (flow.status !== "DRAFT") { log(`  ✗ the Flow is ${flow.status}: its JSON is frozen`); process.exit(1); }
    await uploadJson(flow.id, jsonText, f.key);
    flow = await findFlow(f.name);
  }
  if (has("--publish") && flow) {
    if (flow.status === "PUBLISHED") log("= already PUBLISHED");
    else if (flow.validation_errors?.length) { log("  ✗ validation errors — not published"); process.exit(1); }
    else {
      const r = await graph(`${flow.id}/publish`, { method: "POST" });
      note(`${f.key}: publish`, r);
      log(`  → publish ${r.http} ${JSON.stringify(r.json)}`);
      flow = await findFlow(f.name);
    }
  }
  if (flow) {
    report.flows[f.key] = { id: flow.id, name: flow.name, status: flow.status, json_version: flow.json_version ?? null, categories: flow.categories ?? null, validation_errors: flow.validation_errors ?? [], at: new Date().toISOString() };
    save();
    if (flow.validation_errors?.length) log(JSON.stringify(flow.validation_errors, null, 2));
  }
  if (has("--preview") && flow) {
    const r = await graph(`${flow.id}?fields=preview.invalidate(false)`);
    log(`preview: ${r.json.preview?.preview_url ?? JSON.stringify(r.json)}`);
  }
}
log("flows:", JSON.stringify(report.flows));
