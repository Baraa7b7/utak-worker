// § 64 (2026-10-07) — «📈 تاريخ الأسعار» against a DEPLOYED worker, end to end, the way the menu does it:
//
//   1  Odoo's own action is pressed through the API (ir.actions.server.run): it makes the one-use ticket and
//      answers the address the browser would open (on prod);
//   2  the ticket is opened on the worker asked for (sim or prod): 302 to the worker's signed link;
//   3  the link is opened: the page (saved beside the pictures), then with other choices in its address;
//   4  the ticket is opened again: 410 (it opens once, and is archived); a ticket nobody made and a link with a
//      wrong signature: 404;
//   5  the old fixed-token download of a sale order's quotation: 410 with no content.
//
//   node scripts/s64-20261007-smoke.mjs sim|prod
//
// What it writes: ONE row of x_preview_ticket (made by Odoo's action, burnt and archived by the worker). Nothing
// else is written — by the action, by the worker or by this script — and no message is sent. The worker's secret
// never leaves the worker: this script holds no token of it.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { HISTORY_ACTION, HISTORY_PATH, HISTORY_TICKET_MODEL, PROD_HOST, TICKET_MODEL } from "./lib/s64-odoo.mjs";

const [target] = process.argv.slice(2);
const HOSTS = { prod: PROD_HOST, sim: PROD_HOST.replace("utak-worker.", "utak-worker-sim.") };
if (!HOSTS[target]) { console.log("usage: s64-20261007-smoke.mjs sim|prod"); process.exit(2); }
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith(`https://${HOSTS[target]}/history/`) && url !== `https://${HOSTS[target]}/internal/sale-quotation-pdf?id=16`) throw new Error(`BLOCKED: ${url.slice(0, 70)}`);
  return realFetch(input, init);
};
let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const base = `https://${HOSTS[target]}`;
const get = (path) => fetch(`${base}${path}`, { redirect: "manual" });
const shown = (s) => String(s).replace(/[a-f0-9]{16}$/, "<signature>").replace(/[0-9a-f-]{36}$/, "<ticket>");

const [action] = await call("ir.actions.server", "search_read", { domain: [["name", "=", HISTORY_ACTION.name]], fields: ["id"], limit: 1 });
if (!action) { console.log(`✗ the action ${HISTORY_ACTION.name} is not there`); process.exit(1); }
console.log(`${target} (${HOSTS[target]}) · ${HISTORY_ACTION.name} #${action.id}`);

const pressed = await call("ir.actions.server", "run", { ids: [action.id], context: { active_model: HISTORY_ACTION.model } });
const m = new RegExp(`^https://${PROD_HOST.replace(/\./g, "\\.")}${HISTORY_PATH}([0-9a-f-]{36})$`).exec(String(pressed?.url ?? ""));
check("Odoo's action answers the worker's address with a fresh ticket, in a new tab", pressed?.type === "ir.actions.act_url" && pressed.target === "new" && !!m, shown(pressed?.url ?? ""));
if (!m) process.exit(1);
const ticket = m[1];

const hop = await get(`${HISTORY_PATH}${ticket}`);
const where = hop.headers.get("location") ?? "";
check("the ticket: 302 to the worker's own signed link (an expiry and a signature, nothing else)", hop.status === 302 && /^\/history\/p\/\d+\/[a-f0-9]{16}$/.test(where), `${hop.status} ${shown(where)}`);
const [row] = await call(TICKET_MODEL, "search_read", { domain: [["x_name", "=", ticket]], fields: ["id", "x_used", "x_active", "x_model", "x_res_id"], limit: 1, context: { active_test: false } });
check("the ticket is burnt AND archived in Odoo", row?.x_used === true && row.x_active === false && row.x_model === HISTORY_TICKET_MODEL, JSON.stringify(row));
const minutes = where ? Math.round((Number(/^\/history\/p\/(\d+)\//.exec(where)?.[1]) - Date.now()) / 60000) : NaN;
check(`the link ends in fifteen minutes (${minutes})`, minutes >= 14 && minutes <= 15);

if (where) {
  const page = await get(where);
  const html = await page.text();
  const cards = html.split('<article class="card"').length - 1, thin = html.split('class="thin"').length - 1, charts = html.split('<svg class="chart"').length - 1;
  const file = `scripts/artifacts/s64-20261007-smoke-${target}.html`;
  writeFileSync(new URL(`../${file}`, import.meta.url), html);
  check(`the link: the page — its question, ${cards} cards (${charts} charts, ${thin} «بيانات غير كافية») → ${file}`, page.status === 200 && String(page.headers.get("content-type")).startsWith("text/html") && html.includes("كيف يتحرك سعر السوق مقابل شرائنا؟") && cards > 0 && charts + thin === cards);
  check("never cached, never indexed, no script allowed (and none in it)", page.headers.get("cache-control") === "private, no-store" && String(page.headers.get("x-robots-tag")).includes("noindex") && String(page.headers.get("content-security-policy")).startsWith("default-src 'none'") && !/<script/i.test(html));
  const other = await get(`${where}?d=30&all=1&s=name`);
  const html2 = await other.text();
  check(`its choices in the address: 30 days, every item, by the name (${html2.split('<article class="card"').length - 1} cards)`, other.status === 200 && html2.includes("آخر 30 يوماً") && html2.split('<article class="card"').length - 1 >= cards);
  const forged = where.replace(/([a-f0-9])$/, (_, c) => (c === "0" ? "1" : "0"));
  check("a link with a signature one character off: 404", (await get(forged)).status === 404);
}
check("the ticket a second time: 410", (await get(`${HISTORY_PATH}${ticket}`)).status === 410);
check("a ticket nobody made: 404", (await get(`${HISTORY_PATH}00000000-0000-4000-8000-000000000000`)).status === 404);
const gone = await fetch(`${base}/internal/sale-quotation-pdf?id=16`, { redirect: "manual" });
check("the old fixed-token download: 410, no content", gone.status === 410 && (await gone.text()) === "", String(gone.status));
console.log(ok ? "✓ smoke passed" : "✗ smoke failed");
process.exit(ok ? 0 : 1);
