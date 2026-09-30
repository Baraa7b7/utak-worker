// WhatsApp inbox channel titles, existing channels (2026-09-25).
//
// Renames every discuss.channel linked to a partner (x_wa_partner_id) to
// «واتساب · <name> · +<number>», and «(قديم) …» for a channel whose number
// has a live channel elsewhere — through src/wa-inbox.ts syncInboxChannelTitles,
// the same function the worker uses. Only discuss.channel.name is written:
// no channel, message or partner is created, changed or deleted.
//
//   1. saves every channel's name before any write (rollback file, kept from the first run);
//   2. asks Odoo first: a write of the same name on one channel — refused → stop;
//   3. renames, then reads every title back.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-channel-titles.mts [--dry-run]
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-channel-titles.mts --rollback [--dry-run]
//
// Out:      scripts/artifacts/inbox-20260925-channel-titles.json (+ .md, before/after table)
// Rollback: scripts/artifacts/inbox-20260925-channel-titles-rollback.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  // The only write this script may make: discuss.channel.write.
  if (m && !["search_read", "read", "search", "search_count", "fields_get"].includes(m[2]) && !(m[1] === "discuss.channel" && m[2] === "write")) {
    throw new Error(`BLOCKED: ${m[1]}.${m[2]}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } }
const env: any = { ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY, MSG_DEDUP: new KV() };

const { call } = await import("../src/odoo.ts");
const { syncInboxChannelTitles } = await import("../src/wa-inbox.ts");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const art = (f: string) => new URL(`scripts/artifacts/${f}`, root).pathname;
const RB = art("inbox-20260925-channel-titles-rollback.json");
const shown = (s: string | null) => String(s ?? "—").replace(/[\u2066\u2069]/g, "");

type Ch = { id: number; name: string; x_wa_partner_id: [number, string] | false };
const readChannels = () => call<Ch[]>(env, "discuss.channel", "search_read", {
  domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name", "x_wa_partner_id"], context: { active_test: false }, order: "id asc", limit: 2000,
});

if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8")) as { before: Array<{ id: number; name: string }> };
  const now = new Map((await readChannels()).map((c) => [c.id, c.name]));
  for (const b of rb.before) {
    if (now.get(b.id) === b.name) continue;
    console.log(`channel ${b.id}: «${shown(now.get(b.id) ?? "")}» ← «${b.name}»`);
    if (!DRY) await call(env, "discuss.channel", "write", { ids: [b.id], vals: { name: b.name } });
  }
  console.log(DRY ? "dry-run: nothing written" : "rollback done");
  process.exit(0);
}

// 1. before
const before = await readChannels();
if (!existsSync(RB) && !DRY) {
  writeFileSync(RB, JSON.stringify({ script: "scripts/inbox-20260925-channel-titles.mts", createdAt: new Date().toISOString(),
    before: before.map((c) => ({ id: c.id, name: c.name, x_wa_partner_id: c.x_wa_partner_id ? c.x_wa_partner_id[0] : null })) }, null, 2) + "\n");
}

// 2. does Odoo let the API user rename a channel? Same name back = no change.
let allowed: boolean | string = "skipped (dry run)";
if (!DRY) {
  try {
    await call(env, "discuss.channel", "write", { ids: [before[0].id], vals: { name: before[0].name } });
    allowed = true;
  } catch (e) {
    allowed = false;
    console.error(`Odoo refused discuss.channel.write: ${(e as Error).message.slice(0, 300)}\nStopping — nothing renamed.`);
    writeFileSync(art("inbox-20260925-channel-titles.json"), JSON.stringify({ at: new Date().toISOString(), allowed, error: (e as Error).message.slice(0, 500) }, null, 2) + "\n");
    process.exit(2);
  }
}

// 3. rename (or plan)
const changes = await syncInboxChannelTitles(env, { dryRun: DRY });
const after = new Map((await readChannels()).map((c) => [c.id, c.name]));
const partnerIds = [...new Set(before.map((c) => c.x_wa_partner_id && c.x_wa_partner_id[0]).filter(Boolean))] as number[];
const partners = new Map((await call<any[]>(env, "res.partner", "read", { ids: partnerIds, fields: ["id", "name", "active", "x_wa_channel_id"], context: { active_test: false } })).map((p) => [p.id, p]));
const rows = [];
for (const c of before) {
  const ch = changes.find((x) => x.channelId === c.id)!;
  const msgs = await call<number>(env, "mail.message", "search_count", { domain: [["model", "=", "discuss.channel"], ["res_id", "=", c.id]] });
  const [last] = await call<Array<{ date: string }>>(env, "mail.message", "search_read", { domain: [["model", "=", "discuss.channel"], ["res_id", "=", c.id]], fields: ["date"], order: "id desc", limit: 1 });
  const p = c.x_wa_partner_id ? partners.get(c.x_wa_partner_id[0]) : null;
  rows.push({
    channel: c.id, before: c.name, planned: ch?.after ?? null, after: after.get(c.id) ?? null, number: ch?.number ?? "",
    partner: p ? { id: p.id, name: p.name, active: p.active, linksHere: p.x_wa_channel_id?.[0] === c.id } : null,
    old: ch?.old ?? false, written: ch?.written ?? false, messages: msgs, lastActivity: last?.date ?? null,
  });
}
const dupNumbers = [...new Set(rows.filter((r) => r.number && rows.filter((x) => x.number === r.number).length > 1).map((r) => r.number))];
const readBackOk = DRY || rows.every((r) => r.planned === null || r.after === r.planned);

writeFileSync(art("inbox-20260925-channel-titles.json"), JSON.stringify({ at: new Date().toISOString(), dryRun: DRY, allowed, readBackOk, duplicateNumbers: dupNumbers, rows }, null, 2) + "\n");
const md = [
  `# قنوات واتساب في Odoo: قبل وبعد — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC${DRY ? " (تجربة، لم يُكتب شيء)" : ""}`, "",
  "| القناة | قبل | بعد | الرقم | الشريك | رسائل | آخر نشاط |", "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.channel} | ${r.before} | ${shown(DRY ? r.planned : r.after)} | ${r.number || "—"}${dupNumbers.includes(r.number) ? " ⚠️ مكرر" : ""} | ${r.partner ? `${r.partner.name} (#${r.partner.id}${r.partner.active ? "" : "، مؤرشف"})` : "—"} | ${r.messages} | ${String(r.lastActivity ?? "—").slice(0, 16)} |`),
  "", `**أرقام لها أكثر من قناة:** ${dupNumbers.length ? dupNumbers.join("، ") : "لا شيء"}. **Odoo يسمح بإعادة التسمية عبر الـ API:** ${allowed === true ? "نعم" : allowed}. **القراءة بعد الكتابة تطابق:** ${readBackOk ? "نعم" : "لا"}.`,
].join("\n") + "\n";
writeFileSync(art("inbox-20260925-channel-titles.md"), md);
console.log(md);
console.log(DRY ? "dry-run: nothing written" : `written ${changes.filter((c) => c.written).length}; read back ${readBackOk ? "✓" : "✗"}`);
if (!readBackOk) process.exit(1);
