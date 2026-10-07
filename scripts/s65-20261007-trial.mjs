// § 65 (2026-10-07) — the three trials of the suppliers' registry to Baraa: asks the deployed prod worker to send one.
//
// The worker decides everything: the recipient is Baraa's own number and no other can be named, it goes only
// while his 24h window is open (nothing held, and a closed window burns no attempt), once a day for each,
// marked «🧪 تجربة». What his replies write is flagged «محاكاة» and read by no number (src/s65-trials.ts):
//   signup   the registration form «تسجيل مورد» (fill it as a farmer): a NEW card «🧪 تجربة …» with no number
//   offer    «📦 بضاعتي جاهزة»: one row «عرض مورد»
//   market   the day's market price form with «المقاس» and «المنشأ», then «➕ صنف إضافي»
//
//   node scripts/s65-20261007-trial.mjs signup            dry-run: what would be called (nothing sent)
//   node scripts/s65-20261007-trial.mjs signup --send     POST its hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them at run
// time (search_read, read-only), used in the request, never printed and never stored. This script imports
// no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s65-20261007-trial-<name>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const NAMES = ["signup", "offer", "market"];
const name = process.argv.slice(2).find((a) => NAMES.includes(a));
if (!name) { console.log(`usage: node scripts/s65-20261007-trial.mjs <${NAMES.join("|")}> [--send]`); process.exit(1); }
const SEND = process.argv.includes("--send");
const rows = await call("ir.actions.server", "search_read", {
  domain: [["webhook_url", "ilike", `${HOST}/odoo/hook/`]], fields: ["id", "name", "webhook_url"], limit: 40, context: { active_test: false },
});
let token = "";
for (const r of rows) {
  const m = /odoo\/hook\/[a-z0-9-]+\?token=([A-Za-z0-9._~-]+)/.exec(String(r.webhook_url || ""));
  if (m) { token = m[1]; break; }
}
if (!token) { console.log("✗ no Odoo server action carries the hook token — nothing called"); process.exit(1); }
console.log(`hook token: read from Odoo (${rows.length} action(s) call ${HOST}), not printed`);
const path = `/odoo/hook/s65-trial?name=${name}`;
if (!SEND) { console.log(`dry-run: would POST https://${HOST}${path} (add --send)`); process.exit(0); }
const res = await fetch(`https://${HOST}${path}&token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const body = await res.json().catch(() => ({}));
const out = { at: new Date().toISOString(), name, http: res.status, ...body };
writeFileSync(new URL(`./artifacts/s65-20261007-trial-${name}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
