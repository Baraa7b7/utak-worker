// § 45 ز (2026-09-30, Baraa's change: the cutover now, not at 22:35) — the read-only gate before it.
// The cutover runs only when every condition holds:
//   1. no real open order (x_utak_simulation not set) for today or tomorrow: draft, waiting
//      confirmation, confirmed — and in purchase / in delivery too (still open);
//   2. no sent quotation waiting for the customer (x_quotation pending; sale.order «sent»), no open
//      purchase list (draft / sent), no open route (draft / dispatched / in progress) or stop (pending);
//   3. sim's KV queues listed: the held messages (wa_q), the team's deferred tasks (pending_loc), and
//      the open flows (collection, supplier payment, VAT questions, the price edit);
//   4. no scheduled run on sim in the next 10 minutes other than the 5-minute ticks (*/5 and the
//      driver follow-up at 2,7,12,…).
//
//   node scripts/s45-20260930-cutover-precheck.mjs
//
// Odoo: search_read only. Cloudflare: GET only. Out: scripts/artifacts/s45-20260930-cutover-precheck.json
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { call } from "./lib/odoo-cli.mjs";

const root = new URL("../", import.meta.url);
const NOW = Date.now();
const riyadhDay = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
const riyadhHM = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(11, 16);
const today = riyadhDay(NOW), tomorrow = riyadhDay(NOW + 24 * 3600_000);
const NOT_SIM = ["x_utak_simulation", "!=", true];
const out = { atRiyadh: `${today} ${riyadhHM(NOW)}`, today, tomorrow, conditions: {} };
const problems = [];
const cond = (key, ok, detail) => { out.conditions[key] = { ok, detail }; if (!ok) problems.push(`${key}: ${JSON.stringify(detail).slice(0, 400)}`); console.log(`${ok ? "✓" : "✗"} ${key} — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}`); };
const m2o = (v) => (Array.isArray(v) ? `${v[0]} ${v[1]}` : v || "—");

// 1. orders
const OPEN = ["draft", "waiting_confirmation", "confirmed", "in_purchase", "in_delivery"];
const orders = await call("x_daily_order", "search_read", { domain: [["x_order_date", "in", [today, tomorrow]], ["x_state", "in", OPEN], NOT_SIM], fields: ["id", "x_order_date", "x_state", "x_customer_id", "x_is_simulation"] });
cond("1. طلب حقيقي مفتوح لليوم أو الغد", orders.length === 0, orders.length ? orders.map((o) => `#${o.id} ${o.x_order_date} ${o.x_state} ${m2o(o.x_customer_id)}`) : "لا شيء");
const anyOpen = await call("x_daily_order", "search_read", { domain: [["x_state", "in", OPEN], NOT_SIM], fields: ["id", "x_order_date", "x_state", "x_customer_id"] });
out.openOrdersAnyDay = anyOpen.map((o) => `#${o.id} ${o.x_order_date} ${o.x_state} ${m2o(o.x_customer_id)}`);
console.log(`  · (للعلم) طلبات حقيقية مفتوحة بأي تاريخ: ${anyOpen.length}${anyOpen.length ? ` — ${out.openOrdersAnyDay.join("، ")}` : ""}`);

// 2. quotations, purchase lists, routes, stops
const quotes = await call("x_quotation", "search_read", { domain: [["x_customer_response", "=", "pending"], ["x_sent_at", "!=", false], NOT_SIM], fields: ["id", "x_sent_at", "x_customer_response"] });
const so = await call("sale.order", "search_read", { domain: [["state", "=", "sent"]], fields: ["id", "name", "partner_id", "date_order"] });
cond("2أ. عرض سعر مرسل بانتظار العميل", quotes.length === 0 && so.length === 0, quotes.length || so.length ? { x_quotation: quotes.map((q) => `#${q.id} ${q.x_sent_at}`), sale_order_sent: so.map((s) => `${s.name} ${m2o(s.partner_id)}`) } : "لا شيء");
const lists = await call("x_purchase_list", "search_read", { domain: [["x_status", "in", ["draft", "sent"]], NOT_SIM], fields: ["id", "x_date", "x_status"] });
cond("2ب. قائمة شراء مفتوحة", lists.length === 0, lists.length ? lists.map((l) => `#${l.id} ${l.x_date} ${l.x_status}`) : "لا شيء");
const routes = await call("x_delivery_route", "search_read", { domain: [["x_status", "in", ["draft", "dispatched", "in_progress"]], NOT_SIM], fields: ["id", "x_date", "x_status"] });
const stops = await call("x_delivery_stop", "search_read", { domain: [["x_status", "=", "pending"], NOT_SIM], fields: ["id", "x_route_id", "x_order_id"] });
cond("2ج. مسار أو محطة مفتوحة", routes.length === 0 && stops.length === 0, routes.length || stops.length ? { routes: routes.map((r) => `#${r.id} ${r.x_date} ${r.x_status}`), stops: stops.map((s) => `#${s.id} route ${m2o(s.x_route_id)}`) } : "لا شيء");

// 3. sim KV queues (listed)
spawnSync("npx", ["wrangler", "whoami"], { cwd: root, encoding: "utf8" });
const tok = (/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8")) ?? [])[1];
const H = { Authorization: `Bearer ${tok}` };
const cf = async (p) => { const j = await (await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: H })).json(); if (!j.success) throw new Error(`${p}: ${JSON.stringify(j.errors)}`); return j; };
const account = (await cf("/accounts")).result[0].id;
const SIM_KV = "998122f32d7b46c2a45cf01acec3cb0e";
const keys = async (prefix) => {
  const names = []; let cursor = "";
  do { const j = await cf(`/accounts/${account}/storage/kv/namespaces/${SIM_KV}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`); names.push(...j.result.map((k) => k.name)); cursor = j.result_info?.cursor ?? ""; } while (cursor);
  return names;
};
const kvGet = async (k) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${SIM_KV}/values/${encodeURIComponent(k)}`, { headers: H }); return r.status === 404 ? null : r.text(); };
const mask = (s) => s.replace(/\d{8,}/g, (d) => `${d.slice(0, 3)}…${d.slice(-4)}`);
const riyadh = (ms) => new Date(Number(ms) + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const QUEUES = ["wa_q:v1:", "pending_loc:", "cpay_open:", "cpay:v1:", "cpay_amount:v1:", "sp_flow:v1:", "vat_ask:v1:", "pexc_edit:v1:", "pinv:v1:"];
const queues = {};
for (const p of QUEUES) {
  const ks = await keys(p);
  queues[p] = [];
  for (const k of ks) {
    const raw = await kvGet(k);
    let what = "(raw)";
    try {
      const j = JSON.parse(raw ?? "null");
      what = Array.isArray(j) ? j.map((i) => `${i?.purpose ?? (i?.text ? "team_task" : i?.route_start ? "route_start" : i?.latitude ? "location" : "?")}${i?.expiresAt ? ` حتى ${riyadh(i.expiresAt)}` : ""}`).join("، ") : j && typeof j === "object" ? Object.keys(j).slice(0, 6).join(",") : String(j);
    } catch { /* raw */ }
    queues[p].push(`${mask(k)} → ${what}`);
  }
}
out.simKvQueues = queues;
console.log("· طوابير KV على sim (قراءة، لا تُنقل):");
for (const [p, v] of Object.entries(queues)) console.log(`    ${p} ${v.length}${v.length ? `: ${v.join(" | ")}` : ""}`);

// 4. the next 10 minutes on sim
const sched = (await cf(`/accounts/${account}/workers/scripts/utak-worker-sim/schedules`)).result.schedules.map((s) => s.cron);
const TICKS = new Set(["*/5 * * * *", "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"]);
const due = [];
for (let t = Math.ceil(NOW / 60_000) * 60_000; t <= NOW + 10 * 60_000; t += 60_000) {
  const d = new Date(t);
  for (const c of sched) {
    const [mi, h] = c.split(" ");
    const f = (x, v) => x === "*" || (x.startsWith("*/") ? v % Number(x.slice(2)) === 0 : x.split(",").map(Number).includes(v));
    if (f(mi, d.getUTCMinutes()) && f(h, d.getUTCHours())) due.push({ at: riyadhHM(t), cron: c });
  }
}
const daily = due.filter((d) => !TICKS.has(d.cron));
cond("4. تشغيل مجدول على sim خلال 10 دقائق غير النبضات", daily.length === 0, daily.length ? daily : `النبضات فقط: ${due.map((d) => `${d.at} ${d.cron.startsWith("*/") ? "*/5" : "متابعة السائق"}`).join("، ")}`);
out.simSchedules = sched;

writeFileSync(new URL("scripts/artifacts/s45-20260930-cutover-precheck.json", root), JSON.stringify({ ...out, problems }, null, 2) + "\n");
console.log(problems.length ? `\n✗ ${problems.length} شرط لم يتحقق — لا تحويل` : "\n✓ كل الشروط متحققة");
process.exit(problems.length ? 1 : 0);
