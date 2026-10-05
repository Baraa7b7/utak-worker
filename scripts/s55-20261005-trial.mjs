// § 55 (2026-10-05) — the trials of § 55 to Baraa: asks the deployed prod worker to send one.
//
// The worker decides everything: the recipient is Baraa's own number and no other can be named, it goes
// only while his 24h window is open (no template, nothing held), once a day for each, marked «🧪 تجربة».
//   review    the day's price review as § 55 writes it (src/price-review.ts sendPriceReviewTest), with
//             today's price lines as they stand; its three buttons and its form (utak_owner_review_v2)
//             are answered; nothing is written in Odoo and nothing is published.
//   delivery  the delivery and collection form (§ 55 ب, src/delivery-form.ts sendDeliveryFormTest:
//             utak_delivery_v1), with the latest real order's lines — or, while the tenant has no
//             real order, the latest one marked as a simulation (read only either way); its reply is
//             answered with what would be done: nothing is delivered, no invoice issued, no payment recorded.
//   receipt   the purchases' receipt form (§ 55 د, src/receipt-form.ts sendReceiptFormTest:
//             utak_receipt_v1) with the latest real purchase list's items; its reply is answered with
//             what would be done — nothing written, no list confirmed, no photo downloaded.
//   carload   the car-load form (src/car-load.ts sendCarLoadFormTest): the morning form over the active
//             items; its reply is answered with what would be kept, and nothing is kept.
//   custody   the custody handover form (src/custody-form.ts sendCustodyFormTest): it shows today's
//             real cash collections (read-only); its reply is answered, and nothing is kept.
//
//   node scripts/s55-20261005-trial.mjs review            dry-run: what would be called (nothing sent)
//   node scripts/s55-20261005-trial.mjs review --send     POST its hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s55-20261005-trial-<name>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const HOOK = { review: "price-review-test", delivery: "delivery-form-test", receipt: "receipt-form-test", carload: "carload-form-test", custody: "custody-form-test" };
const form = process.argv.slice(2).find((a) => a in HOOK);
if (!form) { console.log(`usage: node scripts/s55-20261005-trial.mjs <${Object.keys(HOOK).join("|")}> [--send]`); process.exit(1); }
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
writeFileSync(new URL(`./artifacts/s55-20261005-trial-${form}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && body.sent ? 0 : 1);
