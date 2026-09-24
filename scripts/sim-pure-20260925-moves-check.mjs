// Read-only: posted account.move by type, and anything posted/created after a
// cutoff (2026-09-25 "sim محاكاة خالصة", STATUS § 27).
//
//   node scripts/sim-pure-20260925-moves-check.mjs <label> [--since "YYYY-MM-DD HH:MM:SS"]
//
// <label> names the artifact: scripts/artifacts/sim-pure-20260925-moves-<label>.json
// --since is UTC (Odoo stores datetimes in UTC). Default = commit dc916ec
// (2026-09-24 20:21:18 +03 = 17:21:18 UTC).
//
// Only search_read. No create / write / unlink.

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const env = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const label = process.argv[2];
if (!label || label.startsWith("--")) { console.error("usage: <label> [--since 'YYYY-MM-DD HH:MM:SS']"); process.exit(2); }
const si = process.argv.indexOf("--since");
const SINCE = si > 0 ? process.argv[si + 1] : "2026-09-24 17:21:18";

async function sr(model, domain, fields, extra = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${env.ODOO_URL}/json/2/${model}/search_read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ODOO_API_KEY}`, "X-Odoo-Database": env.ODOO_DB },
      body: JSON.stringify({ domain, fields, context: { active_test: false }, ...extra }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`${model} search_read ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  throw new Error(`${model} search_read: retries exhausted`);
}

const moves = await sr("account.move", [], ["id", "name", "move_type", "state", "date", "create_date", "write_date", "amount_total", "amount_tax", "partner_id", "journal_id", "payment_state", "reversed_entry_id"], { order: "id asc" });

const byType = {};
for (const m of moves) {
  byType[m.move_type] ??= { posted: 0, draft: 0, cancel: 0 };
  byType[m.move_type][m.state] = (byType[m.move_type][m.state] ?? 0) + 1;
}
const posted = moves.filter((m) => m.state === "posted");
const pick = (m) => ({ id: m.id, name: m.name, move_type: m.move_type, state: m.state, date: m.date, amount_total: m.amount_total, amount_tax: m.amount_tax, partner: m.partner_id ? m.partner_id[1] : null, journal: m.journal_id ? m.journal_id[1] : null, payment_state: m.payment_state, create_date: m.create_date, write_date: m.write_date });
const createdAfter = moves.filter((m) => m.create_date > SINCE).map(pick);
const postedTouchedAfter = posted.filter((m) => m.write_date > SINCE).map(pick);

const so = await sr("sale.order", [], ["id", "name", "state", "create_date"]);
const po = await sr("purchase.order", [], ["id", "name", "state", "create_date"]);
const pay = await sr("account.payment", [], ["id", "name", "state", "create_date"]);
const tally = (rows) => rows.reduce((a, r) => ((a[r.state] = (a[r.state] ?? 0) + 1), a), {});

const out = {
  label, at: new Date().toISOString(), since_utc: SINCE,
  account_move: { total: moves.length, posted: posted.length, max_id: moves.at(-1)?.id ?? null, by_type: byType },
  created_after_since: createdAfter,
  posted_written_after_since: postedTouchedAfter,
  sale_order: { total: so.length, by_state: tally(so), created_after_since: so.filter((r) => r.create_date > SINCE).map((r) => r.name) },
  purchase_order: { total: po.length, by_state: tally(po), created_after_since: po.filter((r) => r.create_date > SINCE).map((r) => r.name) },
  account_payment: { total: pay.length, by_state: tally(pay), created_after_since: pay.filter((r) => r.create_date > SINCE).map((r) => r.name) },
};
const file = new URL(`scripts/artifacts/sim-pure-20260925-moves-${label}.json`, root);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ ...out, created_after_since: out.created_after_since.length, posted_written_after_since: out.posted_written_after_since.length }, null, 2));
if (createdAfter.length || postedTouchedAfter.length) {
  console.log("\n-- created after since:"); for (const m of createdAfter) console.log(JSON.stringify(m));
  console.log("-- posted & written after since:"); for (const m of postedTouchedAfter) console.log(JSON.stringify(m));
}
console.log(`\n→ ${file.pathname}`);
