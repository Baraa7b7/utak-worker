// § 66 (2026-10-08) — the special request's hook against a DEPLOYED worker, with nothing sent to anyone:
//
//   1  /health answers ok;
//   2  /odoo/hook/special-quote with a wrong token: 401;
//   3  with Odoo's own token (read from the action Odoo calls the worker with, never printed): the two new ops
//      «approve» and «convert» for a request that is NOT THERE → 202 (the worker of before answers 400: it does not
//      know them; the worker reads Odoo, finds no request, writes nothing and sends nothing); an op the hook does not
//      know and another model's record → 400. On sim the token is sim's own: step 3 is skipped there when the worker
//      answers 401.
//
//   node scripts/s66-20261008-smoke.mjs sim|prod
//
// Nothing is written in Odoo and no message is sent: the only id asked for is one no request carries.
import { call } from "./lib/odoo-cli.mjs";
import { HOOKS, HOOK_PATH, PROD_HOST, QUOTE_MODEL } from "./lib/s66-odoo.mjs";

const [target] = process.argv.slice(2);
const HOSTS = { prod: PROD_HOST, sim: PROD_HOST.replace("utak-worker.", "utak-worker-sim.") };
if (!HOSTS[target]) { console.log("usage: s66-20261008-smoke.mjs sim|prod"); process.exit(2); }
const NO_REQUEST = 999999999;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith(`https://${HOSTS[target]}/health`) && !url.startsWith(`https://${HOSTS[target]}${HOOK_PATH}`)) throw new Error(`BLOCKED: ${url.slice(0, 70)}`);
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
const bad = await post(`${HOOK_PATH}?token=not-the-token&op=approve`, { _model: QUOTE_MODEL, _id: NO_REQUEST });
check("the special request's hook refuses a wrong token (401)", bad.status === 401, String(bad.status));

const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", HOOKS.approve.name]], fields: ["webhook_url"], limit: 1 });
const token = /[?&]token=([A-Za-z0-9._~-]+)/.exec(String(act?.webhook_url ?? ""))?.[1] ?? "";
check(`Odoo's «${HOOKS.approve.name}» calls the PROD worker's hook with op=approve`, String(act?.webhook_url ?? "").startsWith(`https://${PROD_HOST}${HOOK_PATH}?token=`) && String(act.webhook_url).endsWith("&op=approve") && !!token);
const unknown = await post(`${HOOK_PATH}?token=${token}&op=delete`, { _model: QUOTE_MODEL, _id: NO_REQUEST });
if (unknown.status === 401 && target === "sim") console.log("  = sim holds a token of its own: the calls with Odoo's token are prod's alone");
else {
  check("an op the hook does not know: 400", unknown.status === 400, String(unknown.status));
  const other = await post(`${HOOK_PATH}?token=${token}&op=approve`, { _model: "x_price_day", _id: 1 });
  check("another model's record: 400", other.status === 400, String(other.status));
  for (const h66 of Object.values(HOOKS)) {
    const r = await post(`${HOOK_PATH}?token=${token}&op=${h66.op}`, { _model: QUOTE_MODEL, _id: NO_REQUEST });
    const j = await r.json().catch(() => ({}));
    check(`op=${h66.op} for a request that is not there: 202 accepted (the worker of before answers 400)`, r.status === 202 && j.status === "accepted" && j.op === h66.op, `${r.status} ${JSON.stringify(j).slice(0, 100)}`);
  }
}
console.log(ok ? "smoke: ok" : "smoke: FAILED");
process.exit(ok ? 0 : 1);
