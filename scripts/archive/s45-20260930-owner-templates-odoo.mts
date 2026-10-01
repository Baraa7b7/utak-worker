// § 45 ب (2026-09-30): the two owner-window templates in x_whatsapp_template, as the 05:00 sync writes
// them (templateSyncVals from Meta, the Arabic label), with x_purpose «other»: a purpose lookup never
// picks them (no duplicate-purpose alert next to utak_v2_summary); src/owner-window.ts reads them by
// name and uses a row only while it is APPROVED / UTILITY. Tonight's 21:30 must not wait for 05:00.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/archive/s45-20260930-owner-templates-odoo.mts            dry run
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/archive/s45-20260930-owner-templates-odoo.mts --apply    snapshot → create / update → verify
//
// Meta: GET only. Odoo: create a missing row, or write the sync's fields on an existing one (never
// x_purpose / x_meta_template_id / x_language of an existing row). Rollback: the rows are inert without
// the § 45 code (x_purpose «other»); rolling the worker back is the rollback, and the daily sync would
// create the same rows anyway. The snapshot keeps the before-state of every row this script touches.
// Out: scripts/artifacts/s45-20260930-owner-templates-odoo-{dry,rollback}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-ignore — plain .mjs helper
import { call } from "../lib/odoo-cli.mjs";
import { pickArabicLabel, templateSyncVals, type MetaTemplate } from "../../src/wa-template-sync.ts";
import { PRICE_REVIEW_TEMPLATE, SUMMARY_TEMPLATE } from "../../src/owner-window.ts";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(readFileSync(new URL("../../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const V = "v22.0", WABA = "2144001136512196";
const NAMES = [SUMMARY_TEMPLATE, PRICE_REVIEW_TEMPLATE];
const nowOdoo = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const FIELDS = ["id", "x_meta_template_id", "x_language", "x_purpose", "x_meta_id", "x_meta_status", "x_category", "x_param_count", "x_body_text", "x_buttons_text", "x_label_ar", "x_name", "x_last_synced"];

const plan: Array<{ name: string; meta: unknown; before: unknown; op: "create" | "write"; vals: Record<string, unknown> }> = [];
for (const name of NAMES) {
  const r = await fetch(`https://graph.facebook.com/${V}/${WABA}/message_templates?name=${name}&fields=id,name,language,status,category,components`, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
  const j: any = await r.json();
  const t = (j.data ?? []).find((x: any) => x.name === name) as MetaTemplate | undefined;
  if (!t) throw new Error(`${name}: not at Meta`);
  const [row] = await call("x_whatsapp_template", "search_read", { domain: [["x_meta_template_id", "=", name], ["x_language", "=", t.language]], fields: FIELDS, context: { active_test: false } });
  const synced = templateSyncVals(t);
  const label = pickArabicLabel(name);
  const vals = row
    ? { ...synced, x_last_synced: nowOdoo(), x_missing_in_meta: false }
    : { x_meta_template_id: name, x_language: t.language, x_purpose: "other", ...synced, x_last_synced: nowOdoo(), x_missing_in_meta: false, x_label_ar: label, x_name: label };
  plan.push({ name, meta: { status: t.status, category: t.category }, before: row ?? null, op: row ? "write" : "create", vals });
  console.log(`${name}: Meta ${t.status}/${t.category} · Odoo ${row ? `#${row.id} ${row.x_meta_status}/${row.x_category} purpose=${row.x_purpose}` : "no row"} → ${row ? "write" : "create"} (x_purpose ${row ? "kept" : "other"}, params ${synced.x_param_count})`);
}
writeFileSync(new URL("../artifacts/s45-20260930-owner-templates-odoo-dry.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), plan }, null, 2) + "\n");
if (!APPLY) { console.log("dry run: nothing written"); process.exit(0); }

const RB = new URL("../artifacts/s45-20260930-owner-templates-odoo-rollback.json", import.meta.url);
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { runs: [] };
const run = { at: new Date().toISOString(), rows: [] as unknown[] };
rb.runs.push(run);
writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
let ok = true;
for (const p of plan) {
  let id: number;
  if (p.op === "create") id = ([] as number[]).concat(await call("x_whatsapp_template", "create", { vals_list: [p.vals] }))[0];
  else { id = (p.before as any).id; await call("x_whatsapp_template", "write", { ids: [id], vals: p.vals }); }
  run.rows.push({ name: p.name, id, op: p.op, before: p.before });
  writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  const [after] = await call("x_whatsapp_template", "read", { ids: [id], fields: FIELDS });
  const good = after.x_meta_status === (p.meta as any).status && after.x_category === (p.meta as any).category && after.x_meta_template_id === p.name
    && (p.op === "create" ? after.x_purpose === "other" : after.x_purpose === (p.before as any).x_purpose);
  ok &&= good;
  console.log(`${good ? "✓" : "✗"} #${id} ${after.x_meta_template_id}: ${after.x_meta_status}/${after.x_category}, purpose ${after.x_purpose}, params ${after.x_param_count}, buttons «${after.x_buttons_text}»`);
}
const dups = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", "owner_summary"]] });
console.log(`${dups === 1 ? "✓" : "✗"} owner_summary still held by one row (${dups})`);
process.exit(ok && dups === 1 ? 0 : 1);
