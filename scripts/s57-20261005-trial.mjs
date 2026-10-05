// § 57 ح (2026-10-05) — the four trials of § 57 to Baraa: asks the deployed prod worker to send one.
//
// The worker decides everything: the recipient is Baraa's own number and no other can be named, it goes
// only while his 24h window is open (no template, nothing held), once a day for each, marked «🧪 تجربة».
// The reply of every trial is answered with what WOULD be recorded: nothing is written in Odoo, and it
// reaches nobody but Baraa.
//   transfer   the customer's transfer notice (src/transfer-form.ts sendTransferFormTest: utak_transfer_v1)
//   complaint  the customer's «⚠️ عندي ملاحظة» (src/complaint-form.ts sendComplaintFormTest: utak_complaint_v1)
//   expense    Baraa's expense (src/expense-form.ts sendExpenseFormTest: utak_expense_v1)
//   supplier   the supplier's registration (src/supplier-vat.ts sendSupplierRegisterFormTest: utak_supplier_register_v1)
//
//   node scripts/s57-20261005-trial.mjs transfer            dry-run: what would be called (nothing sent)
//   node scripts/s57-20261005-trial.mjs transfer --send     POST its hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s57-20261005-trial-<name>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const HOOK = { transfer: "transfer-form-test", complaint: "complaint-form-test", expense: "expense-form-test", supplier: "supplier-register-form-test" };
const form = process.argv.slice(2).find((a) => a in HOOK);
if (!form) { console.log(`usage: node scripts/s57-20261005-trial.mjs <${Object.keys(HOOK).join("|")}> [--send]`); process.exit(1); }
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
writeFileSync(new URL(`./artifacts/s57-20261005-trial-${form}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
