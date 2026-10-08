// § 68 (2026-10-08) — the trial of the attendance record on Baraa's OWN card, from the deployed worker (never from
// this machine): «بدأت الدوام», then «انتهى دوامي». The row is marked «محاكاة»: it enters no figure of the month.
//
//   node scripts/s68-20261008-trial.mjs state [sim]   nothing is sent or written: the trial's row of today
//   node scripts/s68-20261008-trial.mjs in            dry-run: what would be called
//   node scripts/s68-20261008-trial.mjs in --send     the entry: the row on Baraa's card, and the answer a member gets —
//                                                     with «🏁 انتهى دوامي» under it — to Baraa's own number (once a day)
//   node scripts/s68-20261008-trial.mjs out --send    the exit on that row, and its answer (he may tap the button instead)
//
// The worker decides everything: the recipient is Baraa's number and no other can be named; his window must be open
// (an interactive message is never sent outside it). The hook secret is read from one of Odoo's own actions at run
// time, used in the request, and never printed (every line is scrubbed).
// Out: scripts/artifacts/s68-20261008-trial-<op>.json (the worker's answer; no token).
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { PROD_HOST, SIM_HOST, scrub, workerUrls } from "./lib/s67-token.mjs";

const op = process.argv.slice(2).find((a) => ["state", "in", "out"].includes(a));
const SIM = process.argv.includes("sim");
const SEND = process.argv.includes("--send");
const known = [];
const say = (...a) => console.log(scrub(a.join(" "), known));
if (!op) { say("usage: node scripts/s68-20261008-trial.mjs state [sim] | in [--send] | out [--send]"); process.exit(1); }
if (op !== "state" && SIM) { say("the trial goes from prod alone"); process.exit(1); }

const rows = await call("ir.actions.server", "search_read", { domain: [["webhook_url", "ilike", `${PROD_HOST}/odoo/hook/`]], fields: ["id", "webhook_url"], limit: 30, context: { active_test: false } });
const token = rows.flatMap((r) => workerUrls(r.webhook_url)).find((u) => u.token && u.path.startsWith("/odoo/hook/"))?.token ?? "";
if (!token) { say("✗ no Odoo server action carries the hook secret — nothing called"); process.exit(1); }
known.push(token);
const host = SIM ? SIM_HOST : PROD_HOST;
if (op !== "state" && !SEND) { say(`dry-run: would POST https://${host}/odoo/hook/s68-trial?token=…&op=${op} (add --send)`); process.exit(0); }
const res = await fetch(`https://${host}/odoo/hook/s68-trial?token=${token}&op=${op}`, { method: "POST" });
const body = await res.json().catch(() => ({}));
const out = { at: new Date().toISOString(), worker: SIM ? "sim" : "prod", http: res.status, ...body };
writeFileSync(new URL(`./artifacts/s68-20261008-trial-${op}${SIM ? "-sim" : ""}.json`, import.meta.url), scrub(JSON.stringify(out, null, 2), known) + "\n");
say(JSON.stringify(out));
process.exit(res.ok && body.ok !== false && (op === "state" || body.sent) ? 0 : 1);
