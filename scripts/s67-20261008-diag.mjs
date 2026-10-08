// § 67 (2026-10-08) — read-only facts about the dawn's «Odoo لم يستجب» storm (nothing is written):
// the day's x_wa_message rows to Baraa's number, the gateway's purpose blocks in prod KV, the day's
// send-failure counter, the failed statuses in prod D1, and whether Workers Logs keeps history.
//
//   node scripts/s67-20261008-diag.mjs > scripts/artifacts/logs/s67-diag.log 2>&1
//
// Every number is masked to its last three digits, and anything shaped like a token is masked.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { call } from "./lib/odoo-cli.mjs";

const PROD_KV = "1e77d51cf1154af1aef076d1d31905a6";
const PROD_D1 = "25c09c09-7ffe-44cc-a30c-24dbcbde08af";
const FROM_UTC = process.argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "2026-10-07 21:00:00"; // 00:00 Riyadh
const TO_UTC = process.argv.find((a) => a.startsWith("--to="))?.slice(5) ?? "2026-10-08 05:00:00";     // 08:00 Riyadh

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith("https://api.cloudflare.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (url.startsWith("https://api.cloudflare.com/") && init?.method && !["GET", "POST"].includes(init.method)) throw new Error(`BLOCKED (read-only): ${init.method}`);
  return realFetch(input, init);
};

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
export const mask = (s) => String(s ?? "")
  .replace(/(token=)[^&"'\s<]+/g, "$1<masked>")
  .replace(/([?&](?:secret|key|sig)=)[^&"'\s<]+/g, "$1<masked>")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <masked>")
  .replace(/\+?\d{8,15}/g, (d) => `…${d.slice(-3)}`);
const show = (title, v) => console.log(`\n## ${title}\n${mask(typeof v === "string" ? v : JSON.stringify(v, null, 1))}`);
const safe = async (title, fn) => { try { show(title, await fn()); } catch (e) { show(`${title} — FAILED`, String(e?.message ?? e).slice(0, 400)); } await pause(); };
const riyadh = (utc) => { const d = new Date(String(utc).replace(" ", "T") + "Z"); return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(5, 19).replace("T", " "); };

const token = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) || [])[1];
const cf = (path, init = {}) => fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
const owner = (/^OWNER_WHATSAPP\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) || [])[1].replace(/\D/g, "");

// ---- 1. Odoo: the dawn's rows ----
await safe(`x_wa_message ${FROM_UTC} → ${TO_UTC} UTC (Riyadh time shown)`, async () => {
  const rows = await call("x_wa_message", "search_read", {
    domain: [["create_date", ">=", FROM_UTC], ["create_date", "<=", TO_UTC]],
    fields: ["id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_status", "x_body", "x_meta_error", "x_manual"],
    order: "id asc", limit: 400,
  });
  const byStatus = {};
  for (const r of rows) byStatus[`${r.x_direction}/${r.x_status}`] = (byStatus[`${r.x_direction}/${r.x_status}`] ?? 0) + 1;
  return `${rows.length} rows ${JSON.stringify(byStatus)}\n` + rows.map((r) =>
    `#${r.id} ${riyadh(r.create_date)} ${r.x_direction} ${r.x_kind} [${r.x_status}] p=${r.x_partner_id ? `#${r.x_partner_id[0]}` : "-"}\n   ${String(r.x_body ?? "").replace(/\s+/g, " ").slice(0, 330)}${r.x_meta_error ? `\n   ! ${String(r.x_meta_error).replace(/\s+/g, " ").slice(0, 260)}` : ""}`).join("\n");
});

// ---- 2. prod KV: the purpose blocks, and the day's counters ----
const account = (await (await cf("/accounts")).json())?.result?.[0]?.id;
if (!account) { show("Cloudflare", "the wrangler token was refused — run `npx wrangler whoami` once, then retry"); process.exit(1); }
const kv = `/accounts/${account}/storage/kv/namespaces/${PROD_KV}`;
const kvGet = async (key) => { const r = await cf(`${kv}/values/${encodeURIComponent(key)}`); return r.status === 404 ? null : await r.text(); };
const kvList = async (prefix) => {
  const out = [];
  for (let cursor = ""; ;) {
    const j = await (await cf(`${kv}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`)).json();
    out.push(...(j.result ?? []));
    cursor = j.result_info?.cursor ?? "";
    if (!cursor) return out;
  }
};
await safe("prod KV — wa_blk_p:v1:* (the 24h purpose blocks)", async () => {
  const keys = await kvList("wa_blk_p:v1:");
  const out = [];
  for (const k of keys) out.push(`${k.name} exp=${k.expiration ? new Date(k.expiration * 1000).toISOString() : "-"} owner=${k.name.includes(`:${owner}:`)} value=${await kvGet(k.name)}`);
  return out.join("\n") || "(none)";
});
await safe("prod KV — wa_blk_t:v1:2026-10-08:* (templates Meta dropped today)", async () => (await kvList("wa_blk_t:v1:2026-10-08:")).map((k) => k.name).join("\n") || "(none)");
await safe("prod KV — send-failure counters", async () => {
  const out = [];
  for (const d of ["2026-10-06", "2026-10-07", "2026-10-08"]) out.push(`wa_send_fail:${d} = ${await kvGet(`wa_send_fail:${d}`)}`);
  for (const k of await kvList("wa_send_fail_alert:2026-10-08")) out.push(`${k.name} = ${await kvGet(k.name)}`);
  return out.join("\n");
});
await safe("prod KV — held queue of the owner's number, and the gateway's alert marks of the day", async () => {
  const out = [];
  for (const p of ["wa_q:", "waq:", "gw_alert:v1:2026-10-08:", "wa_win:", "owner_window", "opener"]) {
    const keys = await kvList(p);
    out.push(`${p}* → ${keys.length} key(s)${keys.length ? ": " + keys.slice(0, 12).map((k) => k.name).join(", ") : ""}`);
  }
  return out.join("\n");
});

// ---- 3. prod D1: failed statuses of the day ----
await safe("prod D1 — wa_status_log failed, 10-07 21:00 UTC onwards", async () => {
  const r = await cf(`/accounts/${account}/d1/database/${PROD_D1}/query`, {
    method: "POST",
    body: JSON.stringify({
      sql: "SELECT wamid, status, meta_ts, received_ms, recipient, error_code, row_id, applied, verdict FROM wa_status_log WHERE status = 'failed' AND received_ms >= ? ORDER BY received_ms ASC LIMIT 200",
      params: [Date.parse(FROM_UTC.replace(" ", "T") + "Z")],
    }),
  });
  const j = await r.json();
  if (!j.success) return `D1: ${JSON.stringify(j.errors).slice(0, 300)}`;
  const rows = j.result?.[0]?.results ?? [];
  return `${rows.length} failed status(es)\n` + rows.map((x) =>
    `${new Date(x.received_ms + 3 * 3600_000).toISOString().slice(5, 19).replace("T", " ")} code=${x.error_code} to=…${String(x.recipient).slice(-3)} row=${x.row_id} applied=${x.applied} verdict=${x.verdict} wamid=…${String(x.wamid).slice(-8)}`).join("\n");
});

// ---- 4. does Workers Logs keep history for the prod worker? ----
await safe("Cloudflare — the prod worker's observability setting", async () => {
  const j = await (await cf(`/accounts/${account}/workers/scripts/utak-worker/settings`)).json();
  return { success: j.success, observability: j.result?.observability ?? null, logpush: j.result?.logpush ?? null, tail_consumers: j.result?.tail_consumers ?? null };
});

// ---- 5. the 05:00 template sync: when each row was last written (one write per template, in Meta's order) ----
await safe("x_whatsapp_template — x_last_synced per row (UTC), and the control row", async () => {
  const rows = await call("x_whatsapp_template", "search_read", { domain: [], fields: ["id", "x_meta_template_id", "x_last_synced", "x_missing_in_meta", "x_meta_status"], order: "x_last_synced asc, id asc", limit: 400, context: { active_test: false } });
  const bySecond = {};
  for (const r of rows) bySecond[String(r.x_last_synced)] = (bySecond[String(r.x_last_synced)] ?? 0) + 1;
  await pause();
  const ctl = await call("x_wa_control", "search_read", { domain: [], fields: ["id", "x_last_sync_at", "x_last_sync_result", "write_date"], limit: 2 });
  return `${rows.length} template rows; writes per second:\n${Object.entries(bySecond).map(([k, v]) => `  ${k} × ${v}`).join("\n")}\ncontrol: ${JSON.stringify(ctl)}`;
});

// ---- 6. prod D1: every status callback around the storm ----
await safe("prod D1 — wa_status_log 2026-10-08 01:55 → 02:10 UTC (all statuses)", async () => {
  const r = await cf(`/accounts/${account}/d1/database/${PROD_D1}/query`, {
    method: "POST",
    body: JSON.stringify({
      sql: "SELECT wamid, status, received_ms, recipient, error_code, row_id, applied, verdict FROM wa_status_log WHERE received_ms >= ? AND received_ms <= ? ORDER BY received_ms ASC LIMIT 300",
      params: [Date.parse("2026-10-08T01:55:00Z"), Date.parse("2026-10-08T02:10:00Z")],
    }),
  });
  const j = await r.json();
  if (!j.success) return `D1: ${JSON.stringify(j.errors).slice(0, 300)}`;
  const rows = j.result?.[0]?.results ?? [];
  return `${rows.length} status(es)\n` + rows.map((x) =>
    `${new Date(x.received_ms + 3 * 3600_000).toISOString().slice(11, 23)} ${x.status} to=…${String(x.recipient).slice(-3)} row=${x.row_id} applied=${x.applied} verdict=${x.verdict} wamid=…${String(x.wamid).slice(-10)}`).join("\n");
});
