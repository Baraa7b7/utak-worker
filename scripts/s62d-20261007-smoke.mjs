// § 62 د (2026-10-07) — «👁️ معاينة PDF» against a DEPLOYED worker, end to end, the way the button does it:
//
//   1  Odoo's own action is pressed through the API (ir.actions.server.run) on a record: it makes the one-use
//      ticket and answers the address the browser would open (on prod);
//   2  the ticket is opened on the worker asked for (sim or prod): 302 to the worker's signed link;
//   3  the link is opened: the draft PDF (saved beside the samples, its pages counted) — or, for a record that
//      cannot be quoted, the page that says why;
//   4  the ticket is opened again: 410 (it opens once); a ticket nobody made and a link with a wrong signature: 404.
//
//   node scripts/s62d-20261007-smoke.mjs sim|prod quote <x_special_quote id>
//   node scripts/s62d-20261007-smoke.mjs sim|prod sale  <sale.order number, e.g. S00005>
//
// What it writes: ONE row of x_preview_ticket (made by Odoo's action, burnt by the worker). Nothing of the
// record itself is written — by the action, by the worker or by this script — and no message is sent.
// The worker's secret never leaves the worker: this script holds no token of it.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { call } from "./lib/odoo-cli.mjs";
import { PREVIEW_ACTIONS, PREVIEW_PATH, PROD_HOST, QUOTE_MODEL, SALE_MODEL, TICKET_MODEL } from "./lib/s62d-odoo.mjs";

const [target, kind, which] = process.argv.slice(2);
const HOSTS = { prod: PROD_HOST, sim: PROD_HOST.replace("utak-worker.", "utak-worker-sim.") };
if (!HOSTS[target] || !["quote", "sale"].includes(kind) || !which) { console.log("usage: s62d-20261007-smoke.mjs sim|prod quote <id> | sale <number>"); process.exit(2); }
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/") && !url.startsWith(`https://${HOSTS[target]}/preview/`)) throw new Error(`BLOCKED: ${url.slice(0, 70)}`);
  return realFetch(input, init);
};
let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const base = `https://${HOSTS[target]}`;
const get = (path) => fetch(`${base}${path}`, { redirect: "manual" });

const def = PREVIEW_ACTIONS[kind];
const [action] = await call("ir.actions.server", "search_read", { domain: [["name", "=", def.name]], fields: ["id"], limit: 1 });
const [rec] = kind === "quote"
  ? await call(QUOTE_MODEL, "search_read", { domain: [["id", "=", Number(which)]], fields: ["id", "x_name", "write_date"], limit: 1 })
  : await call(SALE_MODEL, "search_read", { domain: [["name", "=", which]], fields: ["id", "name", "state", "write_date"], limit: 1 });
if (!action || !rec) { console.log(`✗ ${!action ? `the action ${def.name}` : `${def.model} ${which}`} is not there`); process.exit(1); }
console.log(`${target} (${HOSTS[target]}) · ${def.name} #${action.id} on ${def.model} #${rec.id} (${rec.x_name || rec.name})`);

const pressed = await call("ir.actions.server", "run", { ids: [action.id], context: { active_model: def.model, active_id: rec.id, active_ids: [rec.id] } });
const m = new RegExp(`^https://${PROD_HOST.replace(/\./g, "\\.")}${PREVIEW_PATH}([0-9a-f-]{36})$`).exec(String(pressed?.url ?? ""));
check("Odoo's action answers the worker's address with a fresh ticket", pressed?.type === "ir.actions.act_url" && !!m);
if (!m) process.exit(1);
const ticket = m[1];

const hop = await get(`${PREVIEW_PATH}${ticket}`);
const where = hop.headers.get("location") ?? "";
check(`the ticket: 302 to the worker's signed link for this record`, hop.status === 302 && new RegExp(`^/preview/doc/${kind === "quote" ? "sq" : "so"}/${rec.id}/\\d+/[a-f0-9]{16}\\.pdf$`).test(where), `${hop.status} ${where.replace(/[a-f0-9]{16}\.pdf$/, "<signature>.pdf")}`);
const [row] = await call(TICKET_MODEL, "search_read", { domain: [["x_name", "=", ticket]], fields: ["id", "x_used", "x_model", "x_res_id"], limit: 1, context: { active_test: false } }); // § 64: a burnt ticket is archived
check("the ticket is burnt in Odoo", row?.x_used === true && row.x_res_id === rec.id, JSON.stringify(row));

if (where) {
  const doc = await get(where);
  const type = doc.headers.get("content-type") ?? "";
  if (doc.status === 200) {
    const bytes = new Uint8Array(await doc.arrayBuffer());
    const file = `scripts/artifacts/q62d-20261007-smoke-${target}-${kind}-${String(rec.x_name || rec.name).replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
    writeFileSync(new URL(`../${file}`, import.meta.url), bytes);
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [new URL(`../${file}`, import.meta.url).pathname], { encoding: "utf8" }))?.[1] ?? 0);
    check(`the link: the draft PDF, to read in the browser (${pages} page${pages === 1 ? "" : "s"}, ${bytes.length} bytes) → ${file}`, type === "application/pdf" && String(doc.headers.get("content-disposition")).startsWith("inline; filename=\"draft-") && doc.headers.get("cache-control") === "private, no-store" && pages >= 1);
  } else {
    const page = (await doc.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    check(`the link: this record cannot be quoted, and the page says why (${doc.status})`, doc.status === 409 && type.startsWith("text/html"), page.slice(0, 200));
  }
  const forged = where.replace(/([a-f0-9])\.pdf$/, (_, c) => `${c === "0" ? "1" : "0"}.pdf`);
  check("a link with a signature one character off: 404", (await get(forged)).status === 404);
}
check("the ticket a second time: 410", (await get(`${PREVIEW_PATH}${ticket}`)).status === 410);
check("a ticket nobody made: 404", (await get(`${PREVIEW_PATH}00000000-0000-4000-8000-000000000000`)).status === 404);
const [after] = await call(def.model, "search_read", { domain: [["id", "=", rec.id]], fields: ["id", "write_date"], limit: 1 });
check(`the ${def.model} itself was not written (its write_date as before)`, after?.write_date === rec.write_date, `${rec.write_date} → ${after?.write_date}`);
console.log(ok ? "✓ smoke passed" : "✗ smoke failed");
process.exit(ok ? 0 : 1);
