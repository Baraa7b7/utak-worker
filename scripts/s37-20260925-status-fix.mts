// § 37 أ — the x_wa_message rows whose Meta status went down (a lower status
// written after a higher one, as #162 in § 36), corrected from what Meta
// actually reported. Also creates the D1 status log (wa_status_log) the worker
// writes from § 37 on.
//
// Evidence of Meta's statuses, per wamid:
//   • D1 wa_status_log (from the § 37 deploy on; empty before it);
//   • the saved `wrangler tail` logs in scripts/artifacts/*.log, lines
//     «[inbox] wamid=<last 10> from=…<last 4> kind=status status=<s>» — matched
//     to a row by the wamid's last 10 characters AND the recipient's last 4.
// D1 sim_outbound has no status (only Meta's answer to the send), and Meta has
// no API to read a message's status back, so a row with no evidence stays as it is.
// The target is the highest status reported (sent < failed < delivered < read,
// src/wa-status.ts); a row is written only when statusVerdict applies.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s37-20260925-status-fix.mts            dry-run (reads only)
//   … --d1-table                  create wa_status_log in the sim D1 if missing (schema/wa_status_log.sql), then verify
//   … --apply                     snapshot, then write, then verify
//   … --verify                    every planned row now at its target
//   … --rollback [--apply]        the written rows back to their snapshot status (no delete)
//
// Out: scripts/artifacts/s37-20260925-status-fix-{plan,rollback,verify}.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";
import { call } from "./lib/odoo-cli.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply"), ROLLBACK = args.includes("--rollback"), VERIFY = args.includes("--verify"), D1TABLE = args.includes("--d1-table");
const art = (s: string) => new URL(`./artifacts/s37-20260925-status-fix-${s}.json`, import.meta.url);
const { highestStatus, statusVerdict } = await import("../src/wa-status.ts");
const env: any = await liveSimEnv();

// ---------------------------------------------------------------- the D1 table
async function d1Tables(): Promise<string[]> {
  const { results } = await env.SIM_DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return (results ?? []).map((r: any) => r.name);
}
if (D1TABLE) {
  const before = await d1Tables();
  console.log(`D1 tables before: ${before.join(", ")}`);
  if (before.includes("wa_status_log")) console.log("wa_status_log exists — nothing to create");
  else {
    const sql = readFileSync(new URL("../schema/wa_status_log.sql", import.meta.url), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of sql) { console.log(`  ${stmt.split("\n")[0]} …`); await env.SIM_DB.prepare(stmt).run(); }
  }
  const after = await d1Tables();
  const cols = (await env.SIM_DB.prepare("PRAGMA table_info(wa_status_log)").all()).results.map((r: any) => r.name);
  const idx = (await env.SIM_DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='wa_status_log'").all()).results.map((r: any) => r.name);
  const ok = after.includes("wa_status_log") && ["wamid", "status", "meta_ts", "received_ms", "recipient", "error_code", "row_id", "applied", "verdict"].every((c) => cols.includes(c))
    && idx.includes("idx_wa_status_log_wamid") && after.includes("sim_outbound");
  console.log(`D1 tables after: ${after.join(", ")}\nwa_status_log columns: ${cols.join(", ")}\nindex: ${idx.join(", ")}\nverify: ${ok ? "OK" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(art("rollback"))) throw new Error("no rollback file — nothing was applied");
  const snap = JSON.parse(readFileSync(art("rollback"), "utf8"));
  console.log(`rollback ${APPLY ? "APPLY" : "(dry)"}: ${snap.rows.length} rows back to their snapshot status`);
  for (const r of snap.rows) {
    console.log(`  #${r.id} ${r.target} ← ${r.x_status}`);
    if (APPLY) await call("x_wa_message", "write", { ids: [r.id], vals: { x_status: r.x_status } });
  }
  process.exit(0);
}

// ---------------------------------------------------------------- evidence
type Ev = { status: string; source: string };
const byWamid = new Map<string, Ev[]>();
const tail: Array<{ suffix: string; to4: string; status: string; file: string; line: number }> = [];
for (const f of readdirSync(new URL("./artifacts/", import.meta.url)).filter((f) => f.endsWith(".log"))) {
  readFileSync(new URL(`./artifacts/${f}`, import.meta.url), "utf8").split("\n").forEach((l, i) => {
    const m = /\[inbox\] wamid=(\S{10}) from=…(\d{4}) kind=status status=(sent|delivered|read|failed)/.exec(l);
    if (m) tail.push({ suffix: m[1], to4: m[2], status: m[3], file: f, line: i + 1 });
  });
}
const tables = await d1Tables();
if (tables.includes("wa_status_log")) {
  const { results } = await env.SIM_DB.prepare("SELECT wamid, status FROM wa_status_log").all();
  for (const r of results ?? []) {
    const list = byWamid.get(r.wamid) ?? [];
    list.push({ status: r.status, source: "d1:wa_status_log" });
    byWamid.set(r.wamid, list);
  }
}
console.log(`evidence: ${tail.length} tail-log status lines, ${[...byWamid.values()].flat().length} D1 status lines${tables.includes("wa_status_log") ? "" : " (wa_status_log not created yet)"}`);

// ---------------------------------------------------------------- the rows
const rows: any[] = await call("x_wa_message", "search_read", {
  domain: [["x_direction", "=", "out"], ["x_meta_message_id", "!=", false]],
  fields: ["id", "x_status", "x_meta_message_id", "x_partner_id", "x_processed_at", "write_date"],
  order: "id asc",
});
const partnerIds = [...new Set(rows.map((r) => r.x_partner_id?.[0]).filter(Boolean))];
const partners: any[] = partnerIds.length
  ? await call("res.partner", "read", { ids: partnerIds, fields: ["x_whatsapp_number", "phone"], context: { active_test: false } })
  : [];
const last4 = new Map(partners.map((p) => [p.id, String(p.x_whatsapp_number || p.phone || "").replace(/\D/g, "").slice(-4)]));

const plan: any[] = [];
const noEvidence: any[] = [];
const already: any[] = [];
for (const r of rows) {
  const w = String(r.x_meta_message_id);
  const to4 = last4.get(r.x_partner_id?.[0]) ?? "";
  const ev: Ev[] = [
    ...(byWamid.get(w) ?? []),
    ...tail.filter((t) => w.endsWith(t.suffix) && (!to4 || t.to4 === to4)).map((t) => ({ status: t.status, source: `${t.file}:${t.line}` })),
  ];
  if (!ev.length) { noEvidence.push({ id: r.id, x_status: r.x_status }); continue; }
  const target = highestStatus(ev.map((e) => e.status));
  const v = target ? statusVerdict(r.x_status, target) : { apply: false, why: "none" };
  const entry = { id: r.id, wamid_tail: w.slice(-12), x_status: r.x_status, target, verdict: v.why, evidence: ev };
  if (target && v.apply) plan.push(entry); else already.push(entry);
}
const byStatus = (list: any[]) => list.reduce((a: any, r: any) => ((a[r.x_status] = (a[r.x_status] ?? 0) + 1), a), {});
const report = {
  at: new Date().toISOString(),
  scanned: rows.length,
  byStatus: byStatus(rows),
  toCorrect: plan,
  withEvidenceAlreadyRight: already,
  withoutEvidence: { count: noEvidence.length, byStatus: byStatus(noEvidence), sentIds: noEvidence.filter((r) => r.x_status === "sent").map((r) => r.id) },
};
console.log(`scanned ${rows.length} outbound rows with a wamid: ${JSON.stringify(report.byStatus)}`);
console.log(`with Meta evidence: ${plan.length + already.length} — already at their highest: ${already.map((a) => `#${a.id} ${a.x_status}`).join(", ") || "none"}`);
console.log(`to correct: ${plan.length ? plan.map((p) => `#${p.id} ${p.x_status} → ${p.target}`).join(", ") : "none"}`);
console.log(`without evidence (left as they are): ${noEvidence.length} ${JSON.stringify(report.withoutEvidence.byStatus)}; «sent»: ${report.withoutEvidence.sentIds.join(", ")}`);

if (VERIFY) {
  const snap = existsSync(art("rollback")) ? JSON.parse(readFileSync(art("rollback"), "utf8")) : { rows: [] };
  const now: any[] = snap.rows.length ? await call("x_wa_message", "read", { ids: snap.rows.map((r: any) => r.id), fields: ["id", "x_status"] }) : [];
  const bad = snap.rows.filter((r: any) => now.find((n) => n.id === r.id)?.x_status !== r.target);
  const out = { at: new Date().toISOString(), written: snap.rows.length, atTarget: snap.rows.length - bad.length, stillToCorrect: plan.length, bad };
  writeFileSync(art("verify"), JSON.stringify(out, null, 2) + "\n");
  console.log(`verify: ${out.atTarget}/${out.written} at target, still to correct ${plan.length} → ${bad.length === 0 && plan.length === 0 ? "OK" : "FAILED"}`);
  process.exit(bad.length === 0 && plan.length === 0 ? 0 : 1);
}

writeFileSync(art("plan"), JSON.stringify(report, null, 2) + "\n");
if (!APPLY) { console.log("dry-run — nothing written (plan in scripts/artifacts/s37-20260925-status-fix-plan.json)"); process.exit(0); }

// ---------------------------------------------------------------- apply
writeFileSync(art("rollback"), JSON.stringify({ at: new Date().toISOString(), rows: plan.map((p) => ({ id: p.id, x_status: p.x_status, target: p.target })) }, null, 2) + "\n");
console.log(`snapshot: scripts/artifacts/s37-20260925-status-fix-rollback.json (${plan.length} rows)`);
for (const p of plan) {
  await call("x_wa_message", "write", { ids: [p.id], vals: { x_status: p.target } });
  console.log(`  #${p.id} ${p.x_status} → ${p.target}`);
}
console.log(`applied: ${plan.length} rows`);
