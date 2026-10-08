// § 68 أ (2026-10-08) — «does a button of Odoo's really reach the worker?», end to end, with no change of data:
// Odoo itself runs ONE harmless action — «utak.team_roster.hook ← hr.employee» (the worker drops its roster
// cache: the next read asks Odoo again) — while `wrangler tail` watches prod for the request Odoo makes.
//
//   node scripts/s68-20261008-button-e2e.mjs
//
// The tail takes its time to connect, and an event missed is not an event that did not happen: the script
// first sends requests of its own (a wrong token → 401) until the tail shows one — only then is Odoo asked.
// The tail's lines carry the request's URL, and so the hook's token: they are read in memory alone, and what is
// printed is the path, the status and the worker's own log line — never a URL (scripts/lib/s67-token.mjs scrubs).
import { spawn } from "node:child_process";
import { call } from "./lib/odoo-cli.mjs";
import { PROD_HOST, scrub } from "./lib/s67-token.mjs";
import { splitJsonObjects } from "./lib/tail-ticks.mjs";

const ACTION = "utak.team_roster.hook ← hr.employee";
const PATH = "/odoo/hook/team-roster";
const root = new URL("../", import.meta.url).pathname;
const riyadh = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(11, 19);
const hits = [];
let buf = "";
const tail = spawn("npx", ["wrangler", "tail", "utak-worker", "--format", "json"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
tail.stdout.setEncoding("utf8");
tail.stdout.on("data", (chunk) => {
  buf += chunk;
  const { objects, rest } = splitJsonObjects(buf);
  buf = rest;
  for (const o of objects) {
    const url = String(o?.event?.request?.url ?? "");
    if (!url.includes(PATH)) continue;
    hits.push({ at: riyadh(o.eventTimestamp ?? Date.now()), method: o.event.request.method, path: new URL(url).pathname, status: o.event?.response?.status ?? null, outcome: o.outcome, logs: (o.logs ?? []).map((l) => scrub(l.message.map(String).join(" "))).slice(0, 3), exceptions: (o.exceptions ?? []).length });
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 1;
try {
  // the tail is live when it shows a request of our own
  let live = false;
  for (let i = 0; i < 20 && !live; i++) {
    await wait(3000);
    await fetch(`https://${PROD_HOST}${PATH}?probe=1&token=${"0".repeat(64)}`, { method: "POST", body: "{}" });
    await wait(1500);
    live = hits.some((h) => h.status === 401);
  }
  if (!live) throw new Error("the tail showed none of this script's own requests in 90 seconds — nothing was asked of Odoo");
  console.log(`the tail is live (it shows this script's own request: HTTP 401 on ${PATH}) at ${riyadh(Date.now())}`);
  const mine = hits.length;
  const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", ACTION]], fields: ["id", "state", "model_name"], limit: 1 });
  const [emp] = await call("hr.employee", "search_read", { domain: [["job_id", "!=", false]], fields: ["id"], order: "id asc", limit: 1 });
  if (!act || !emp) throw new Error("no action or no employee to run it on");
  console.log(`Odoo runs action #${act.id} «${ACTION}» (${act.state}) on hr.employee #${emp.id} at ${riyadh(Date.now())}…`);
  await call("ir.actions.server", "run", { ids: [act.id], context: { active_model: "hr.employee", active_id: emp.id, active_ids: [emp.id] } });
  for (let i = 0; i < 50 && hits.length === mine; i++) await wait(500);
  await wait(2000);
  const odoo = hits.slice(mine);
  if (!odoo.length) console.log(`✗ no request of Odoo's on ${PATH} reached prod in 25 seconds`);
  for (const h of odoo) console.log(`${h.status === 202 && h.outcome === "ok" ? "✓" : "✗"} ${h.at} ${h.method} ${h.path} → HTTP ${h.status} (${h.outcome})${h.exceptions ? `, ${h.exceptions} exception(s)` : ""}${h.logs.length ? ` — ${h.logs.join(" | ")}` : ""}`);
  code = odoo.some((h) => h.status === 202 && h.outcome === "ok") ? 0 : 1;
} catch (e) {
  console.log(`✗ ${scrub(String(e?.message ?? e)).slice(0, 300)}`);
} finally {
  tail.kill("SIGTERM");
}
process.exit(code);
