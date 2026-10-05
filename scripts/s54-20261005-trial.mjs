// § 54 (2026-10-05) — the ONE trial of the day's price review: asks the deployed prod worker to send it.
//
// The worker decides everything (src/price-review.ts sendPriceReviewTest): the recipient is Baraa's own
// number and no other can be named, it goes only while his 24h window is open (no template, nothing
// held), once a day, marked «🧪 تجربة», with today's price lines as they stand. Its three buttons and
// its form are answered; nothing is written in Odoo and nothing is published.
//
//   node scripts/s54-20261005-trial.mjs            dry-run: what would be called (nothing sent)
//   node scripts/s54-20261005-trial.mjs --send     POST the review's hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s54-20261005-trial-review.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const HOOK = { review: "price-review-test" };
const form = "review";
const SEND = process.argv.includes("--send");
const rows = await call("ir.actions.server", "search_read", {
  domain: ["|", ["webhook_url", "ilike", `${HOST}/odoo/hook/`], ["code", "ilike", `${HOST}/odoo/hook/`]],
  fields: ["id", "name", "webhook_url", "code"], limit: 30, context: { active_test: false },
});
let token = "";
for (const r of rows) {
  const m = /odoo\/hook\/[a-z-]+\?token=([A-Za-z0-9._~-]+)/.exec(`${r.webhook_url || ""}\n${r.code || ""}`);
  if (m) { token = m[1]; break; }
}
if (!token) { console.log("✗ no Odoo server action carries the hook token — nothing called"); process.exit(1); }
console.log(`hook token: read from Odoo (${rows.length} action(s) call ${HOST}), not printed`);
if (!SEND) { console.log(`dry-run: would POST https://${HOST}/odoo/hook/${HOOK[form]} (add --send)`); process.exit(0); }
const res = await fetch(`https://${HOST}/odoo/hook/${HOOK[form]}?token=${token}`, { method: "POST" });
const body = await res.json().catch(() => ({}));
const out = { at: new Date().toISOString(), form, http: res.status, ...body, token: body.token ? `${String(body.token).slice(0, 14)}…` : undefined };
writeFileSync(new URL(`./artifacts/s54-20261005-trial-${form}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
