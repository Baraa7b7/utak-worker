// § 67 ج (2026-10-08) — lifts the gateway's 24h block of `owner_alert` on Baraa's number (prod KV).
//
// Meta answered 131056 (the pair's temporary rate limit) to the dawn's burst of «Odoo لم يستجب» alerts,
// and the gateway of § 33 stopped the whole purpose for 24h. The key's value is recorded first
// (scripts/artifacts/s67-20261008-unblock.json — the number masked, no secret), then the key is deleted.
//
//   node scripts/s67-20261008-unblock.mjs            dry-run: the key and its value (nothing changes)
//   node scripts/s67-20261008-unblock.mjs --apply    record, delete, read back
//   node scripts/s67-20261008-unblock.mjs --verify   read-only: is the key gone?
//
// Only this one key is touched: wa_blk_p:v1:<owner>:owner_alert. Every other request is blocked.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const PROD_KV = "1e77d51cf1154af1aef076d1d31905a6";
const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const OUT = new URL("./artifacts/s67-20261008-unblock.json", import.meta.url);

const owner = (/^OWNER_WHATSAPP\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) || [])[1].replace(/\D/g, "");
const KEY = `wa_blk_p:v1:${owner}:owner_alert`;
const shown = `wa_blk_p:v1:…${owner.slice(-3)}:owner_alert`;

const token = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) || [])[1];
const realFetch = globalThis.fetch;
const cf = (path, init = {}) => {
  if (!path.startsWith("/accounts")) throw new Error("BLOCKED");
  return realFetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
};
globalThis.fetch = () => { throw new Error("BLOCKED: this script talks to the Cloudflare KV API alone"); };

const account = (await (await cf("/accounts")).json())?.result?.[0]?.id;
if (!account) { console.log("✗ the wrangler token was refused — run `npx wrangler whoami` once, then retry"); process.exit(1); }
const base = `/accounts/${account}/storage/kv/namespaces/${PROD_KV}`;
const read = async () => {
  const r = await cf(`${base}/values/${encodeURIComponent(KEY)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV get: HTTP ${r.status}`);
  return await r.text();
};
const expiry = async () => {
  const j = await (await cf(`${base}/keys?prefix=${encodeURIComponent(KEY)}&limit=10`)).json();
  const k = (j.result ?? []).find((x) => x.name === KEY);
  return k?.expiration ? new Date(k.expiration * 1000).toISOString() : null;
};

const value = await read();
if (VERIFY) {
  console.log(value === null ? `✓ ${shown} is not in prod KV` : `✗ ${shown} is still there: ${value}`);
  process.exit(value === null ? 0 : 1);
}
if (value === null) {
  console.log(`= ${shown} is not in prod KV — nothing to lift${existsSync(OUT) ? " (recorded before: scripts/artifacts/s67-20261008-unblock.json)" : ""}`);
  process.exit(0);
}
const expiresAt = await expiry();
console.log(`${APPLY ? "✎" : "+"} ${shown} = ${value} (expires ${expiresAt ?? "?"})`);
if (!APPLY) { console.log("dry-run: nothing deleted (add --apply)"); process.exit(0); }

// the record BEFORE the delete: what was there, and how to put it back
writeFileSync(OUT, JSON.stringify({
  script: "s67-20261008-unblock.mjs", at: new Date().toISOString(), namespace: "prod MSG_DEDUP", key: shown, value: JSON.parse(value), expiresAt,
  restore: "PUT the value under wa_blk_p:v1:<OWNER_WHATSAPP digits>:owner_alert with the remaining TTL — only to reproduce the block; it lapses by itself at expiresAt",
}, null, 2) + "\n");
const del = await cf(`${base}/values/${encodeURIComponent(KEY)}`, { method: "DELETE" });
if (!del.ok) { console.log(`✗ delete: HTTP ${del.status}`); process.exit(1); }
const after = await read();
console.log(after === null ? `✓ deleted — recorded in scripts/artifacts/s67-20261008-unblock.json` : `✗ the key is still readable: ${after}`);
process.exit(after === null ? 0 : 1);
