// § 62 هـ (2026-10-07) — the three trials of «طلب أسعار خاص» to Baraa: asks the deployed prod worker to send one.
//
// The worker decides everything: the recipient is Baraa's own number and no other can be named, it goes
// only while his 24h window is open (nothing held), once a day for each, marked «🧪 تجربة». Nothing is
// written in Odoo, and it reaches no source and no customer (src/s62-trials.ts).
//   purchase    the special form as a «شراء» source reads it (the quantities in the hints)
//   market      the same form as a «سوق» source reads it (no quantity at all)
//   quotation   the request's quotation as a PDF with illustrative prices that say so
// The request shown is the newest real one that is not closed (or --id=<request>).
//
// And one call that is not a trial:
//   recalc      asks the worker for a request's numbers again (--id=<request>, else the newest open one):
//               the same call a save in Odoo makes. It prepares a new request (its name, the defaults,
//               its sources) and sends nothing.
//
//   node scripts/s62-20261007-trial.mjs purchase            dry-run: what would be called (nothing sent)
//   node scripts/s62-20261007-trial.mjs purchase --send     POST its hook on prod, once
//
// The hook token is the one Odoo's own server actions call the worker with: read from one of them
// at run time (search_read, read-only), used in the request, never printed and never stored.
// This script imports no worker code and sends nothing to Meta itself.
// Out: scripts/artifacts/s62-20261007-trial-<name>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const HOST = "utak-worker.utak-business.workers.dev";
const NAMES = ["purchase", "market", "quotation", "recalc"];
const name = process.argv.slice(2).find((a) => NAMES.includes(a));
if (!name) { console.log(`usage: node scripts/s62-20261007-trial.mjs <${NAMES.join("|")}> [--id=<request>] [--send]`); process.exit(1); }
const SEND = process.argv.includes("--send");
let id = Number(process.argv.find((a) => a.startsWith("--id="))?.slice(5)) || 0;
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
if (name === "recalc" && !id) {
  const [q] = await call("x_special_quote", "search_read", { domain: [["x_utak_simulation", "!=", true], ["x_state", "!=", "closed"]], fields: ["id", "x_name"], order: "id desc", limit: 1 });
  id = q?.id ?? 0;
  if (!id) { console.log("✗ no open request — nothing called"); process.exit(1); }
}
const path = name === "recalc" ? `/odoo/hook/special-quote?op=recalc` : `/odoo/hook/s62-trial?name=${name}${id ? `&id=${id}` : ""}`;
if (!SEND) { console.log(`dry-run: would POST https://${HOST}${path}${name === "recalc" ? ` for x_special_quote #${id}` : ""} (add --send)`); process.exit(0); }
const res = await fetch(`https://${HOST}${path}&token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: name === "recalc" ? JSON.stringify({ _model: "x_special_quote", _id: id }) : "{}" });
const body = await res.json().catch(() => ({}));
const out = { at: new Date().toISOString(), name, id: id || undefined, http: res.status, ...body };
writeFileSync(new URL(`./artifacts/s62-20261007-trial-${name}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
process.exit(res.ok && (name === "recalc" ? res.status === 202 : body.sent) ? 0 : 1);
