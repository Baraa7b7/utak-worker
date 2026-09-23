// Odoo JSON-2 client for manual scripts (reads .env.sim-verify).
// Same retry policy as src/odoo.ts::call: 429 is re-sent for every method
// (the odoo.com rate limiter answered, Odoo never ran it); 5xx / network is
// re-sent only for reads, and for a create only after a probe finds nothing.
// 4xx (incl. 422 = UserError) is never retried.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);

export async function call(model, method, body, { probe } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res, t;
    try {
      res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
        body: JSON.stringify(body),
      });
      t = await res.text();
    } catch (e) {
      res = null; t = String(e?.message ?? e);
    }
    if (res?.ok) return JSON.parse(t);
    const status = res?.status ?? 0;
    const ambiguous = status === 0 || status >= 500;
    const canRetry = status === 429 || (ambiguous && (READS.has(method) || (method === "create" && probe)));
    if (!canRetry || attempt >= 4) throw new Error(`${model}.${method} HTTP ${status}: ${t.slice(0, 400)}`);
    const ra = Number(res?.headers?.get("retry-after"));
    const wait = ra > 0 ? Math.min(ra * 1000, 15000) : Math.round(1000 * 2 ** attempt * (0.5 + Math.random() / 2));
    console.log(`  … HTTP ${status || "network"} on ${model}.${method}, retry in ${(wait / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, wait));
    if (ambiguous && method === "create" && probe) {
      const found = await call(model, "search", { domain: probe, limit: 2 });
      if (found.length) { console.log(`  … probe found ${found.join(",")} — not creating again`); return [found[0]]; }
    }
  }
}
