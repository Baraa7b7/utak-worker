// The sim worker's environment, from this machine, for a live trial that must
// share the deployed worker's state (STATUS § 34 / § 35): the sim KV namespace
// and D1 database through the Cloudflare REST API (the wrangler OAuth token,
// never printed), the [env.sim.vars] values, and the Odoo / Meta credentials of
// .env.sim-verify. The real src/ code runs against it: what it holds lands in
// the live queue, and the deployed worker flushes it on the number's reply.
//
// PILOT_MODE=true with the deployed SIM_ALLOWLIST: a send reaches Meta only for
// an allowlisted number, exactly as on the worker.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const SIM_KV_NAMESPACE = "998122f32d7b46c2a45cf01acec3cb0e";
const SIM_D1_DATABASE = "f0631ac1-9659-4d5c-bc35-05797afe50c7";

function wranglerToken() {
  const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8");
  const token = (/oauth_token\s*=\s*"([^"]+)"/.exec(cfg) || [])[1];
  if (!token) throw new Error("no wrangler oauth_token — run `npx wrangler whoami` first");
  return token;
}

function simVars() {
  const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
  const block = toml.split("[env.sim.vars]")[1].split(/\n\[/)[0];
  const vars = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Z_]+)\s*=\s*"([^"]*)"/.exec(line.trim());
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function localSecrets() {
  return Object.fromEntries(
    readFileSync(new URL("../../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

export async function liveSimEnv() {
  const token = wranglerToken();
  const realFetch = globalThis.fetch;
  const cf = async (path, init = {}) => realFetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const accounts = await (await cf("/accounts")).json();
  if (!accounts?.result?.[0]?.id) throw new Error("Cloudflare API refused the wrangler token (expired?) — run `npx wrangler whoami` once, then retry");
  const account = accounts.result[0].id;
  const kvBase = `/accounts/${account}/storage/kv/namespaces/${SIM_KV_NAMESPACE}/values/`;
  const MSG_DEDUP = {
    async get(key) {
      const r = await cf(kvBase + encodeURIComponent(key));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`KV get ${key}: ${r.status}`);
      return await r.text();
    },
    async put(key, value, opts = {}) {
      const q = opts.expirationTtl ? `?expiration_ttl=${Math.max(60, Math.ceil(opts.expirationTtl))}` : "";
      const r = await cf(kvBase + encodeURIComponent(key) + q, { method: "PUT", body: String(value), headers: { "Content-Type": "text/plain" } });
      if (!r.ok) throw new Error(`KV put ${key}: ${r.status} ${await r.text()}`);
    },
    async delete(key) {
      await cf(kvBase + encodeURIComponent(key), { method: "DELETE" });
    },
  };
  const d1 = async (sql, params) => {
    const r = await cf(`/accounts/${account}/d1/database/${SIM_D1_DATABASE}/query`, {
      method: "POST", body: JSON.stringify({ sql, params }), headers: { "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (!j.success) throw new Error(`D1: ${JSON.stringify(j.errors).slice(0, 200)}`);
    return j.result?.[0] ?? { results: [] };
  };
  const SIM_DB = {
    prepare(sql) {
      const stmt = (params = []) => ({
        run: async () => d1(sql, params),
        all: async () => ({ results: (await d1(sql, params)).results ?? [] }),
        first: async () => ((await d1(sql, params)).results ?? [])[0] ?? null,
      });
      return { bind: (...params) => stmt(params), ...stmt([]) };
    },
  };
  const s = localSecrets();
  return {
    ...simVars(),
    ODOO_API_KEY: s.ODOO_API_KEY,
    META_ACCESS_TOKEN: s.META_ACCESS_TOKEN,
    MSG_DEDUP,
    SIM_DB,
  };
}
