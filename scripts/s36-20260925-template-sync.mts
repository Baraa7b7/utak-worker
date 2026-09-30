// § 36 (أ) — the 05:00 template sync, now (src/wa-template-sync.ts runTemplateSync,
// the same function the cron and the Odoo «مزامنة» button call).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s36-20260925-template-sync.mts [label]            dry-run
//   … [label] --apply            snapshot every row, then runTemplateSync, then --verify
//   … [label] --verify           Odoo = Meta (status, category, body, buttons, and the § 36 text fields when they exist)
//   … [label] --rollback [--apply]   the snapshot's values back (dry by default). No delete.
//
// Meta: GET /message_templates only. Graph POST is blocked in this process
// (no WhatsApp send, no template create). Odoo writes: x_whatsapp_template
// (the fields the sync writes) and the x_wa_control sync summary.
// Out: scripts/artifacts/s36-20260925-template-sync-<label>-{dry,rollback,verify}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";
import { call } from "./lib/odoo-cli.mjs";

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) || "a";
const APPLY = args.includes("--apply"), VERIFY = args.includes("--verify"), ROLLBACK = args.includes("--rollback");
const art = (s: string) => new URL(`./artifacts/s36-20260925-template-sync-${label}-${s}.json`, import.meta.url);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") && String(init?.method ?? "GET").toUpperCase() !== "GET") throw new Error(`BLOCKED Graph ${init?.method} ${url.slice(0, 80)}`);
  return realFetch(input, init);
}) as typeof fetch;

const env: any = await liveSimEnv();
const TEXT_FIELDS = ["x_body_text", "x_buttons_text"];
const tf = await call("x_whatsapp_template", "fields_get", { attributes: ["type"] });
const hasText = TEXT_FIELDS.every((f) => f in tf);
const SYNC_FIELDS = ["x_meta_id", "x_meta_status", "x_category", "x_body", "x_param_count", "x_buttons", "x_last_synced", "x_missing_in_meta", "x_label_ar", "x_name", ...(hasText ? TEXT_FIELDS : [])];
const readRows = async () => call("x_whatsapp_template", "search_read", {
  domain: [], fields: ["id", "x_meta_template_id", "x_language", ...SYNC_FIELDS], order: "id asc", limit: 2000,
}) as Promise<any[]>;
const readControl = async () => call("x_wa_control", "search_read", { domain: [], fields: ["id", "x_sync_requested", "x_last_sync_at", "x_last_sync_result"], limit: 1 }) as Promise<any[]>;

async function metaTemplates(): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_WABA_ID}/message_templates?limit=100&fields=id,name,language,status,category,components`;
  for (let p = 0; p < 20 && url; p++) {
    const r = await realFetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Meta GET ${r.status}`);
    out.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  return out;
}

const sync = await import("../src/wa-template-sync.ts");
/** What the sync writes for a Meta template (the § 36 export when present). */
function expected(t: any): Record<string, unknown> {
  if (typeof (sync as any).templateSyncVals === "function") return (sync as any).templateSyncVals(t);
  let body = "", buttons = "";
  for (const c of t.components ?? []) {
    if (c.type === "BODY") body = c.text ?? "";
    if (c.type === "BUTTONS") buttons = (c.buttons ?? []).map((b: any, i: number) => `[${i}] ${b.type} — ${b.text}${b.url ? ` → ${b.url}` : ""}${b.phone_number ? ` → ${b.phone_number}` : ""}`).join("\n");
  }
  return { x_meta_id: t.id, x_meta_status: t.status, x_category: t.category, x_body: body, x_buttons: buttons };
}
async function diff(): Promise<any> {
  const [meta, rows] = await Promise.all([metaTemplates(), readRows()]);
  const byKey = new Map(rows.map((r) => [`${r.x_meta_template_id}::${String(r.x_language || "").toLowerCase()}`, r]));
  const changes: any[] = [];
  const missingInOdoo: string[] = [];
  for (const t of meta) {
    const r = byKey.get(`${t.name}::${String(t.language || "").toLowerCase()}`);
    if (!r) { missingInOdoo.push(`${t.name}/${t.language}`); continue; }
    const want = expected(t);
    const d = Object.entries(want).filter(([k, v]) => k in r && String(r[k] ?? "") !== String(v ?? "") && !(r[k] === false && (v === "" || v === false)));
    if (d.length) changes.push({ id: r.id, name: t.name, fields: Object.fromEntries(d.map(([k, v]) => [k, { odoo: r[k], meta: v }])) });
  }
  const seen = new Set(meta.map((t) => `${t.name}::${String(t.language || "").toLowerCase()}`));
  const missingInMeta = rows.filter((r) => r.x_meta_template_id && !seen.has(`${r.x_meta_template_id}::${String(r.x_language || "").toLowerCase()}`)).map((r) => r.id);
  return { at: new Date().toISOString(), meta: meta.length, odoo: rows.length, hasTextFields: hasText, changes, missingInOdoo, missingInMeta };
}

if (ROLLBACK) {
  if (!existsSync(art("rollback"))) throw new Error("no snapshot");
  const snap = JSON.parse(readFileSync(art("rollback"), "utf8"));
  console.log(`rollback ${APPLY ? "APPLY" : "dry"}: ${snap.rows.length} rows, control ${snap.control?.[0]?.id ?? "-"}`);
  for (const r of snap.rows) {
    const vals: any = {};
    for (const f of SYNC_FIELDS) if (f in r) vals[f] = r[f];
    if (APPLY) await call("x_whatsapp_template", "write", { ids: [r.id], vals });
  }
  if (snap.control?.[0] && APPLY) {
    const { id, ...vals } = snap.control[0];
    await call("x_wa_control", "write", { ids: [id], vals });
  }
  console.log(APPLY ? "restored" : "(dry — add --apply)");
  process.exit(0);
}

const before = await diff();
writeFileSync(art("dry"), JSON.stringify(before, null, 2) + "\n");
console.log(`Meta ${before.meta} · Odoo ${before.odoo} · text fields ${before.hasTextFields ? "present" : "absent"} · rows the sync changes: ${before.changes.length} · new in Odoo: ${before.missingInOdoo.length} · gone from Meta: ${before.missingInMeta.length}`);
for (const c of before.changes.slice(0, 80)) console.log(`  #${c.id} ${c.name}: ${Object.keys(c.fields).join(", ")}`);

if (APPLY) {
  const snap = { at: new Date().toISOString(), fields: SYNC_FIELDS, rows: await readRows(), control: await readControl() };
  writeFileSync(art("rollback"), JSON.stringify(snap, null, 2) + "\n");
  console.log(`snapshot → ${art("rollback").pathname} (${snap.rows.length} rows)`);
  const report = await sync.runTemplateSync(env);
  console.log("runTemplateSync:", JSON.stringify({ ...report, by_status: report.by_status }));
}
if (APPLY || VERIFY) {
  const after = await diff();
  const rows = await readRows();
  const control = await readControl();
  const ok = after.changes.length === 0 && after.missingInOdoo.length === 0;
  writeFileSync(art("verify"), JSON.stringify({ ...after, ok, control }, null, 2) + "\n");
  console.log(`verify: ${ok ? "OK" : "DIFF"} — changes left ${after.changes.length}, new in Odoo ${after.missingInOdoo.length}; control: ${control[0]?.x_last_sync_at} ${control[0]?.x_last_sync_result}`);
  const synced = rows.filter((r) => r.x_last_synced && Date.parse(r.x_last_synced.replace(" ", "T") + "Z") > Date.now() - 15 * 60_000).length;
  console.log(`rows synced in the last 15 min: ${synced}/${rows.length}`);
}
