// Inbox 2026-09-20 — rollback.
// Reverses inbox-20260920-apply.mjs + inbox-20260920-apply-automation.mjs
// using the JSON snapshot at scripts/artifacts/inbox-20260920-rollback.json.
//
// Default: dry-run — prints what would happen. Pass --apply to execute.
//
// Reversible operations (order matches the create order in reverse):
//   1. base.automation and ir.actions.server rows created for the inbox
//      (from rollback.created.automations, .server_actions).
//   2. Menu "💬 المحادثات" and any menus this run created.
//   3. UTAK بوت partner (only if this run created it).
//   4. Fields x_wa_channel_id / x_wa_partner_id (only if this run created them).
//      Odoo removes the underlying column with the field, so this also drops
//      any values.
//   5. Cron 62: restore previous active state (usually True).
//   6. Any mail.message / discuss.channel rows created by the backfill (if
//      the backfill was applied; those rows live in a separate map).

import { readFileSync, existsSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rollbackPath = new URL("./artifacts/inbox-20260920-rollback.json", import.meta.url).pathname;
if (!existsSync(rollbackPath)) {
  console.error(`Rollback JSON not found at ${rollbackPath}. Nothing to do.`);
  process.exit(1);
}
const rb = JSON.parse(readFileSync(rollbackPath, "utf8"));

const doIt = async (label, fn) => {
  console.log(`- ${label}${APPLY ? "" : " (dry-run)"}`);
  if (APPLY) {
    try { await fn(); } catch (e) { console.warn(`  ! ${label}: ${(e).message}`); }
  }
};

// 1. Automations + server actions (mail.message hook)
for (const a of (rb.created?.automations ?? [])) {
  await doIt(`unlink base.automation id=${a.id} (${a.name})`, () =>
    call("base.automation", "unlink", { ids: [a.id] }));
}
for (const sa of (rb.created?.server_actions ?? [])) {
  await doIt(`unlink ir.actions.server id=${sa.id} (${sa.name})`, () =>
    call("ir.actions.server", "unlink", { ids: [sa.id] }));
}

// 2. Menus
for (const m of (rb.created?.menus ?? [])) {
  await doIt(`unlink ir.ui.menu id=${m.id} (${m.name})`, () =>
    call("ir.ui.menu", "unlink", { ids: [m.id] }));
}

// 3. UTAK بوت partner
for (const p of (rb.created?.partners ?? [])) {
  // Best-effort — Odoo will refuse if the partner is referenced by mail.message
  // author_id rows. In that case the report warns and leaves the partner as-is;
  // that is intentional: the automation was the actor writer, not this run.
  await doIt(`unlink res.partner id=${p.id} (${p.name})`, () =>
    call("res.partner", "unlink", { ids: [p.id] }));
}

// 4. Fields (drops column & data)
for (const f of (rb.created?.fields ?? [])) {
  await doIt(`unlink ir.model.fields id=${f.id} (${f.model}.${f.name})`, () =>
    call("ir.model.fields", "unlink", { ids: [f.id] }));
}

// 5. Cron 62
if (rb.mutated?.cron_62?.before?.active === true && rb.mutated?.cron_62?.after) {
  await doIt(`restore cron 62 active=true`, () =>
    call("ir.cron", "write", { ids: [62], vals: { active: true } }));
}

// 6. Backfill-created mail.message / channels (separate map)
const bfMapPath = new URL("./artifacts/inbox-backfill-map.json", import.meta.url).pathname;
if (existsSync(bfMapPath)) {
  const bf = JSON.parse(readFileSync(bfMapPath, "utf8"));
  const mmIds = (bf.mail_messages ?? []).map((r) => r.mail_message_id).filter(Boolean);
  if (mmIds.length) {
    await doIt(`unlink ${mmIds.length} backfilled mail.message rows`, () =>
      call("mail.message", "unlink", { ids: mmIds }));
  }
  const channelIds = (bf.channels_created ?? []).map((r) => r.channel_id).filter(Boolean);
  if (channelIds.length) {
    await doIt(`unlink ${channelIds.length} backfilled discuss.channel rows`, () =>
      call("discuss.channel", "unlink", { ids: channelIds }));
  }
}

console.log(APPLY ? "\nRollback complete." : "\nDry-run. Pass --apply to execute.");
