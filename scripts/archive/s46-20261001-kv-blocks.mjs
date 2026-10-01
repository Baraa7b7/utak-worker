// § 46 هـ (2026-10-01) — read-only: the gateway's refusal memory on prod's KV (wa_blk_p:v1:* — a
// purpose Meta refused for a number, 24h; wa_blk_t:v1:* — a template dropped for a number today),
// numbers masked. Cloudflare API: GET only (the wrangler OAuth token, never printed).
//
//   node scripts/archive/s46-20261001-kv-blocks.mjs
//
// Out: scripts/artifacts/s46-20261001-kv-blocks.json
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const PROD_KV = "1e77d51cf1154af1aef076d1d31905a6";
spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" });
const tok = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) ?? [])[1];
const cf = async (p, raw = false) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (raw) return r.ok ? r.text() : null;
  const j = await r.json(); if (!j.success) throw new Error(`${p}: ${JSON.stringify(j.errors)}`); return j;
};
const account = (await cf("/accounts")).result[0].id;
const mask = (k) => k.replace(/(\d{5,})(\d{4})/g, (_, a, b) => `…${b}`);
const riyadh = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
const out = { atRiyadh: riyadh(Date.now()), keys: [] };
for (const prefix of ["wa_blk_p:v1:", "wa_blk_t:v1:"]) {
  const j = await cf(`/accounts/${account}/storage/kv/namespaces/${PROD_KV}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`);
  for (const k of j.result) {
    const value = await cf(`/accounts/${account}/storage/kv/namespaces/${PROD_KV}/values/${encodeURIComponent(k.name)}`, true);
    const row = { key: mask(k.name), expiresRiyadh: k.expiration ? riyadh(k.expiration * 1000) : null, value: String(value ?? "").slice(0, 120) };
    out.keys.push(row);
    console.log(`${row.key} · ينتهي ${row.expiresRiyadh ?? "—"} · ${row.value}`);
  }
}
if (!out.keys.length) console.log("لا مفاتيح حجب على KV prod");
writeFileSync(new URL("scripts/artifacts/s46-20261001-kv-blocks.json", root), JSON.stringify(out, null, 2) + "\n");
