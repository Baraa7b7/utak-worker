// § 36 (ب-3) — the outbound messages of a Riyadh day that D1 has and Odoo does
// not: an x_wa_message row and a line in the number's Discuss channel, after
// the fact, from the D1 send log (sim_outbound).
//
//   • a send with no row → a row: the number's partner (Baraa's too), the text
//     as the recipient read it (a template rendered from its approved text),
//     its wamid, x_processed_at AND create_date = the actual send time,
//     x_backfilled «مستكمل», the template's name in x_template_id /
//     x_params / x_debug_payload only;
//   • a row that exists but lacks its partner or its text (written before
//     § 36: «[text]», no partner on Baraa's number) → completed the same way,
//     x_backfilled «مستكمل» (the snapshot keeps what it was);
//   • a send with no Discuss line → a line in the channel, «🤖 آلي · مستكمل»,
//     dated at the send time, with a status line: «✅ أُرسلت HH:MM», or
//     «⚠️ لم تصل: …» for one Meta refused.
// Old Discuss lines are never edited. Nothing is deleted. No WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s36-20260925-backfill.mts [YYYY-MM-DD]            dry-run
//   … [YYYY-MM-DD] --apply        snapshot, then write, then verify (the reconcile again)
//   … --rollback [--apply]        the completed rows back as they were; the created rows and lines stay (no delete)
//
// Out: scripts/artifacts/s36-20260925-backfill-{plan,rollback,applied}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { liveSimEnv } from "./lib/cf-live-env.mjs";
import { call } from "./lib/odoo-cli.mjs";

const args = process.argv.slice(2);
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || "2026-09-25";
const APPLY = args.includes("--apply"), ROLLBACK = args.includes("--rollback");
const art = (s: string) => new URL(`./artifacts/s36-20260925-backfill-${s}.json`, import.meta.url);

// no WhatsApp from here: Graph POST refused in this process
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") && String(init?.method ?? "GET").toUpperCase() !== "GET") throw new Error(`BLOCKED Graph POST ${url.slice(0, 80)}`);
  return realFetch(input, init);
}) as typeof fetch;

const env: any = await liveSimEnv();
const R = await import("../src/wa-record.ts");
const { ensureInboxChannel, getBotPartnerId } = await import("../src/wa-inbox.ts");

const odooTs = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

if (ROLLBACK) {
  if (!existsSync(art("rollback"))) throw new Error("no rollback file");
  const snap = JSON.parse(readFileSync(art("rollback"), "utf8"));
  console.log(`rollback ${APPLY ? "APPLY" : "(dry)"}: ${snap.completed.length} completed rows back as they were; created rows ${snap.created?.length ?? "?"} and lines stay (no delete)`);
  for (const r of snap.completed) {
    const { id, ...vals } = r;
    console.log(`  #${id} ← ${JSON.stringify(vals).slice(0, 160)}`);
    if (APPLY) await call("x_wa_message", "write", { ids: [id], vals });
  }
  process.exit(0);
}

// ---------------------------------------------------------------- the gaps, from the reconcile
execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", "scripts/s36-20260925-reconcile.mts", day, "pre-backfill"], { stdio: "ignore" });
const rec = JSON.parse(readFileSync(new URL("./artifacts/s36-20260925-reconcile-pre-backfill.json", import.meta.url), "utf8"));
const d1 = (await env.SIM_DB.prepare("SELECT id, ts_ms, to_number, msg_type, template_name, wamid, raw_request FROM sim_outbound WHERE id IN (" + rec.sends.map((s: any) => Number(s.d1)).join(",") + ")").all()).results as any[];
const d1ById = new Map(d1.map((r) => [r.id, r]));

type Plan = {
  d1: number; at: string; to: string; kind: string; delivered: boolean; metaError: string | null;
  text: string; synced: boolean; templateId?: number; templateName?: string; params?: string[];
  partner: { id: number; name: string } | null;
  row: { action: "create" | "complete" | "ok"; id?: number; set?: Record<string, unknown> };
  /** An existing row's own status (a later Meta «failed» that D1's sync flag does not show). */
  rowStatus?: string; rowError?: string;
  echo: { action: "post" | "ok" };
};
const plans: Plan[] = [];
for (const s of rec.sends) {
  const raw = d1ById.get(s.d1);
  const full = JSON.parse(raw.raw_request);
  const delivered = full.__delivered !== false;
  const me = full.__meta_error ? `Meta ${full.__meta_error.code ?? "?"}: ${full.__meta_error.message ?? ""}`.slice(0, 500) : null;
  const body = Object.fromEntries(Object.entries(full).filter(([k]) => !k.startsWith("__") && k !== "messaging_product" && k !== "to"));
  const shown = await R.outboundText(env, body as Record<string, unknown>);
  const partner = await R.partnerForNumber(env, s.num);
  const p: Plan = {
    d1: s.d1, at: s.at, to: s.to, kind: shown.kind, delivered, metaError: me, text: shown.text, synced: shown.synced,
    templateId: shown.templateId, templateName: shown.templateName, params: shown.params, partner,
    row: { action: "ok", id: s.row?.id }, echo: { action: s.echo ? "ok" : "post" },
  };
  if (!s.row) p.row = { action: "create" };
  else {
    const [cur] = await call("x_wa_message", "read", { ids: [s.row.id], fields: ["id", "x_partner_id", "x_body", "x_template_id", "x_params", "x_backfilled", "x_debug_payload", "x_processed_at", "x_status", "x_meta_error"] });
    p.rowStatus = String(cur.x_status || "");
    p.rowError = String(cur.x_meta_error || "");
    const set: Record<string, unknown> = {};
    if (!cur.x_partner_id && partner) set.x_partner_id = partner.id;
    const bodyStale = !cur.x_body || /^\[[a-z]+\]$/.test(String(cur.x_body)) || String(cur.x_body).startsWith("📋 قالب:");
    if (bodyStale && !s.echo) {
      set.x_body = shown.text.slice(0, 2000);
      if (shown.templateId && !cur.x_template_id) set.x_template_id = shown.templateId;
      if (shown.kind === "template") set.x_params = JSON.stringify(shown.params ?? []);
      set.x_debug_payload = JSON.stringify({ ...(safeJson(cur.x_debug_payload)), backfilled_from: `D1 sim_outbound #${s.d1}`, ...(shown.templateName ? { template: shown.templateName } : {}) }).slice(0, 4000);
    }
    if (Object.keys(set).length) p.row = { action: "complete", id: s.row.id, set: { ...set, x_backfilled: true } };
  }
  plans.push(p);
}
function safeJson(v: unknown): Record<string, unknown> { try { return JSON.parse(String(v || "{}")); } catch { return {}; } }

const todo = plans.filter((p) => p.row.action !== "ok" || p.echo.action !== "ok");
writeFileSync(art("plan"), JSON.stringify({ day, at: new Date().toISOString(), plans }, null, 2) + "\n");
console.log(`day ${day}: ${plans.length} sends in D1 · to do ${todo.length}`);
for (const p of todo) {
  console.log(`  D1 ${p.d1} ${p.at.slice(11, 19)} ${p.to} ${p.kind}${p.templateName ? ` (${p.templateName})` : ""} ${p.rowStatus ? `row:${p.rowStatus}` : p.delivered ? "sent" : "REFUSED"} — row ${p.row.action}${p.row.id ? ` #${p.row.id}` : ""}${p.row.set ? ` ${Object.keys(p.row.set).join(",")}` : ""} · line ${p.echo.action} · partner ${p.partner?.id ?? "-"}`);
  console.log(`      «${p.text.replace(/\n/g, " ⏎ ").slice(0, 110)}»${p.synced ? "" : " [unsynced]"}`);
}
if (!APPLY) { console.log("(dry — add --apply)"); process.exit(0); }

// ---------------------------------------------------------------- snapshot, then write
const completed = [];
for (const p of todo.filter((x) => x.row.action === "complete")) {
  const [cur] = await call("x_wa_message", "read", { ids: [p.row.id], fields: ["id", ...Object.keys(p.row.set!)] });
  completed.push(Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
}
const snap = { day, at: new Date().toISOString(), completed, created: [] as Array<{ row: number; message: number | null; d1: number }> };
writeFileSync(art("rollback"), JSON.stringify(snap, null, 2) + "\n");
console.log(`snapshot → ${art("rollback").pathname} (${completed.length} rows to complete)`);

const bot = await getBotPartnerId(env);
const applied: any[] = [];
for (const p of todo) {
  const ms = Date.parse(p.at);
  const status = p.delivered ? "sent" : "failed";
  let rowId = p.row.id;
  if (p.row.action === "create") {
    const vals: Record<string, unknown> = {
      x_direction: "out", x_kind: p.kind, x_body: p.text.slice(0, 2000), x_status: status, x_source: "auto",
      x_processed_at: odooTs(ms), create_date: odooTs(ms), x_backfilled: true, x_echo_status: p.partner ? "pending" : "none",
      x_debug_payload: JSON.stringify({ backfilled_from: `D1 sim_outbound #${p.d1}`, ...(p.templateName ? { template: p.templateName } : {}), ...(p.synced ? {} : { unsynced: true }) }),
      ...(p.partner ? { x_partner_id: p.partner.id } : {}),
      ...(d1ById.get(p.d1).wamid && !String(d1ById.get(p.d1).wamid).includes(".no_id.") ? { x_meta_message_id: d1ById.get(p.d1).wamid } : {}),
      ...(p.templateId ? { x_template_id: p.templateId } : {}),
      ...(p.kind === "template" ? { x_params: JSON.stringify(p.params ?? []) } : {}),
      ...(p.metaError ? { x_meta_error: p.metaError } : {}),
    };
    try {
      [rowId] = await call("x_wa_message", "create", { vals_list: [vals] });
    } catch (e) {
      console.warn(`  create_date refused (${String((e as Error).message).slice(0, 80)}) — without it`);
      delete vals.create_date;
      [rowId] = await call("x_wa_message", "create", { vals_list: [vals] });
    }
    snap.created.push({ row: rowId!, message: null, d1: p.d1 });
    writeFileSync(art("rollback"), JSON.stringify(snap, null, 2) + "\n");
  } else if (p.row.action === "complete") {
    await call("x_wa_message", "write", { ids: [rowId], vals: p.row.set });
  }
  let messageId: number | null = null;
  if (p.echo.action === "post" && p.partner && bot) {
    const channelId = await ensureInboxChannel(env, p.partner.id, p.partner.name, { number: p.to });
    const hhmm = R.riyadhHHMM(odooTs(ms));
    const st = p.rowStatus || (p.delivered ? "sent" : "failed");
    const line = st === "failed" ? R.statusLineFor("failed", "", p.rowError || p.metaError || "Meta") : R.statusLineFor("sent", hhmm, "");
    const html = R.echoHtml(p.text, { template: p.kind === "template", backfilled: true, status: line });
    const post = (extra: Record<string, unknown>) => call("discuss.channel", "message_post", {
      ids: [channelId], body: html, body_is_html: true, message_type: "comment", author_id: bot, subtype_xmlid: "mail.mt_comment", ...extra,
    });
    let res: any;
    try { res = await post({ date: odooTs(ms) }); } catch (e) {
      console.warn(`  message_post with date refused (${String((e as Error).message).slice(0, 80)}) — without it (the time is in the status line)`);
      res = await post({});
    }
    messageId = Array.isArray(res) ? res[0] : typeof res === "number" ? res : res?.id ?? null;
    if (rowId) await call("x_wa_message", "write", { ids: [rowId], vals: { x_echo_status: "posted", ...(messageId ? { x_echo_message_id: messageId } : {}) } });
    const c = snap.created.find((x) => x.row === rowId);
    if (c) c.message = messageId;
    writeFileSync(art("rollback"), JSON.stringify(snap, null, 2) + "\n");
  }
  applied.push({ d1: p.d1, row: rowId, rowAction: p.row.action, message: messageId });
  console.log(`  ✓ D1 ${p.d1} → row #${rowId} (${p.row.action})${messageId ? ` · line #${messageId}` : ""}`);
}
writeFileSync(art("applied"), JSON.stringify({ day, at: new Date().toISOString(), applied }, null, 2) + "\n");

// ---------------------------------------------------------------- verify
execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", "scripts/s36-20260925-reconcile.mts", day, "after-backfill"], { stdio: "ignore" });
const after = JSON.parse(readFileSync(new URL("./artifacts/s36-20260925-reconcile-after-backfill.json", import.meta.url), "utf8"));
const gaps = after.sends.filter((s: any) => !s.row || (s.channels.length && !s.echo));
const created = applied.map((a) => a.row);
const rows = await call("x_wa_message", "read", { ids: created, fields: ["id", "create_date", "x_processed_at", "x_backfilled", "x_echo_status", "x_partner_id"] });
console.log(`verify: gaps left ${gaps.length}/${after.sends.length}; rows ${rows.filter((r: any) => r.x_backfilled).length}/${rows.length} «مستكمل»; create_date = send time ${rows.filter((r: any) => r.create_date === r.x_processed_at).length}/${rows.length}`);
for (const g of gaps) console.log(`  gap: D1 ${g.d1} ${g.to} row=${g.row?.id ?? "-"} echo=${g.echo?.id ?? "-"}`);
