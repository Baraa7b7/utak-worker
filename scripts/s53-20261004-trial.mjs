// § 53 (2026-10-04) — the ONE trial of each customer form: asks the deployed prod worker to send it.
//
// The worker decides everything (src/order-form.ts sendOrderFormTest, src/register-form.ts
// sendRegisterFormTest): the recipient is Baraa's own number and no other can be named, it goes only
// while his 24h window is open (no template, nothing held), once a day per form, marked «🧪 تجربة».
// His reply is answered: the order form creates no order, the registration form writes nothing in Odoo.
//
//   node scripts/s53-20261004-trial.mjs order|register            dry-run: what would be called (nothing sent)
//   node scripts/s53-20261004-trial.mjs order|register --send     POST the form's hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s53-20261004-trial-<form>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const HOOK = { order: "order-form-test", register: "register-form-test" };
const form = process.argv.find((a) => a in HOOK);
const SEND = process.argv.includes("--send");
if (!form) { console.log("usage: node scripts/s53-20261004-trial.mjs order|register [--send]"); process.exit(1); }
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
writeFileSync(new URL(`./artifacts/s53-20261004-trial-${form}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
