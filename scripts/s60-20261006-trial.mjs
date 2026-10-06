// § 60 هـ (2026-10-06) — the ONE trial of § 60 to Baraa: asks the deployed prod worker to send it.
//
// The worker decides everything: the recipient is Baraa's own number and no other can be named, it goes
// only while his 24h window is open (nothing held), once a day, marked «🧪 تجربة». Nothing is written
// in Odoo, nothing is read from it, and it reaches nobody but Baraa (src/s60-trial.ts):
//   summary      the 21:30 summary as it reaches him from now on — its five lines, then the four of
//                «خلاصة اليوم» and «طلبوا اليوم وما كان متوفر» — in ILLUSTRATIVE numbers that say so
//
//   node scripts/s60-20261006-trial.mjs summary            dry-run: what would be called (nothing sent)
//   node scripts/s60-20261006-trial.mjs summary --send     POST its hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s60-20261006-trial-<name>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const NAMES = ["summary"];
const name = process.argv.slice(2).find((a) => NAMES.includes(a));
if (!name) { console.log(`usage: node scripts/s60-20261006-trial.mjs <${NAMES.join("|")}> [--send]`); process.exit(1); }
const SEND = process.argv.includes("--send");
const rows = await call("ir.actions.server", "search_read", {
  domain: ["|", ["webhook_url", "ilike", `${HOST}/odoo/hook/`], ["code", "ilike", `${HOST}/odoo/hook/`]],
  fields: ["id", "name", "webhook_url", "code"], limit: 30, context: { active_test: false },
});
let token = "";
for (const r of rows) {
  const m = /odoo\/hook\/[a-z0-9-]+\?token=([A-Za-z0-9._~-]+)/.exec(`${r.webhook_url || ""}\n${r.code || ""}`);
  if (m) { token = m[1]; break; }
}
if (!token) { console.log("✗ no Odoo server action carries the hook token — nothing called"); process.exit(1); }
console.log(`hook token: read from Odoo (${rows.length} action(s) call ${HOST}), not printed`);
if (!SEND) { console.log(`dry-run: would POST https://${HOST}/odoo/hook/s60-trial?name=${name} (add --send)`); process.exit(0); }
const res = await fetch(`https://${HOST}/odoo/hook/s60-trial?name=${name}&token=${token}`, { method: "POST" });
const body = await res.json().catch(() => ({}));
const out = { at: new Date().toISOString(), name, http: res.status, ...body, token: undefined };
writeFileSync(new URL(`./artifacts/s60-20261006-trial-${name}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
