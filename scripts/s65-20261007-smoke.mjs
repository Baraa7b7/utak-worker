// § 65 (2026-10-07) — the suppliers' hook against a DEPLOYED worker, with nothing sent to anyone:
//
//   1  /health answers ok;
//   2  /odoo/hook/supplier with a wrong token: 401 (the route is there: the worker of before answers 404), and
//      so does /odoo/hook/s65-trial;
//   3  with Odoo's own token (read from the action Odoo calls the worker with, never printed): an op the hook
//      does not know and another model's record → 400; op=welcome for a card that is NOT THERE → 202 (the
//      worker reads Odoo, finds no card, and sends nothing). On sim the token is sim's own: step 3 is skipped
//      there when the worker answers 401.
//
//   node scripts/s65-20261007-smoke.mjs sim|prod
//
// Nothing is written in Odoo and no message is sent: the only id asked for is one no partner carries.
import { call } from "./lib/odoo-cli.mjs";
import { HOOKS, HOOK_PATH, PROD_HOST } from "./lib/s65-odoo.mjs";

const [target] = process.argv.slice(2);
const HOSTS = { prod: PROD_HOST, sim: PROD_HOST.replace("utak-worker.", "utak-worker-sim.") };
if (!HOSTS[target]) { console.log("usage: s65-20261007-smoke.mjs sim|prod"); process.exit(2); }
const NO_CARD = 999999999;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith(`https://${HOSTS[target]}/health`) && !url.startsWith(`https://${HOSTS[target]}/odoo/hook/s`)) throw new Error(`BLOCKED: ${url.slice(0, 70)}`);
  return realFetch(input, init);
};
let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const base = `https://${HOSTS[target]}`;
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
console.log(`${target} (${HOSTS[target]})`);

const h = await fetch(`${base}/health`);
const hj = await h.json().catch(() => ({}));
check("/health answers ok", h.status === 200 && (hj.status === "ok" || hj.ok === true), JSON.stringify(hj).slice(0, 120));
const bad = await post(`${HOOK_PATH}?token=not-the-token&op=welcome`, { _model: "res.partner", _id: NO_CARD });
check("the suppliers' hook is there and refuses a wrong token (401; the worker of before answers 404)", bad.status === 401, String(bad.status));
const badTrial = await post("/odoo/hook/s65-trial?token=not-the-token&name=signup");
check("the trials' route is there and refuses a wrong token (401)", badTrial.status === 401, String(badTrial.status));

const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", HOOKS.welcome.name]], fields: ["webhook_url"], limit: 1 });
const token = /[?&]token=([A-Za-z0-9._~-]+)/.exec(String(act?.webhook_url ?? ""))?.[1] ?? "";
check(`Odoo's «${HOOKS.welcome.name}» calls the PROD worker's hook with op=welcome`, String(act?.webhook_url ?? "").startsWith(`https://${PROD_HOST}${HOOK_PATH}?token=`) && String(act.webhook_url).endsWith("&op=welcome") && !!token);
const unknown = await post(`${HOOK_PATH}?token=${token}&op=delete`, { _model: "res.partner", _id: NO_CARD });
if (unknown.status === 401 && target === "sim") console.log("  = sim holds a token of its own: the calls with Odoo's token are prod's alone");
else {
  check("an op the hook does not know: 400", unknown.status === 400, String(unknown.status));
  const other = await post(`${HOOK_PATH}?token=${token}&op=welcome`, { _model: "x_special_quote", _id: 1 });
  check("another model's record: 400", other.status === 400, String(other.status));
  const none = await post(`${HOOK_PATH}?token=${token}&op=welcome`, { _model: "res.partner", _id: NO_CARD });
  const nj = await none.json().catch(() => ({}));
  check("op=welcome for a card that is not there: 202 accepted (the worker finds no card and sends nothing)", none.status === 202 && nj.status === "accepted" && nj.op === "welcome", JSON.stringify(nj));
}
console.log(ok ? "smoke: ok" : "smoke: FAILED");
process.exit(ok ? 0 : 1);
