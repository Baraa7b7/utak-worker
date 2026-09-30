// § 45 ز (2026-09-30, Baraa's decision at the pre-cutover gate): the six «pending» quotations of
// simulation orders get x_utak_simulation = true, like their orders (the § 42 mark does not cover
// x_quotation). Nothing else is written; nothing is deleted.
//
//   node scripts/s45-20260930-mark-quotes.mjs              dry run: each quotation, its order and the plan
//   node scripts/s45-20260930-mark-quotes.mjs --apply      rollback snapshot → write → verify
//   node scripts/s45-20260930-mark-quotes.mjs --rollback   x_utak_simulation back to the snapshot's values
//
// Out: scripts/artifacts/s45-20260930-mark-quotes-rollback.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const IDS = [4, 5, 6, 7, 8, 12];
const RB = new URL("./artifacts/s45-20260930-mark-quotes-rollback.json", import.meta.url);
const F = ["id", "x_quotation_number", "x_order_id", "x_sent_at", "x_customer_response", "x_is_simulation", "x_utak_simulation"];

if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  for (const r of rb.before) await call("x_quotation", "write", { ids: [r.id], vals: { x_utak_simulation: r.x_utak_simulation } });
  console.log(`rolled back ${rb.before.length} quotation(s)`);
  process.exit(0);
}
const qs = await call("x_quotation", "read", { ids: IDS, fields: F });
const orders = await call("x_daily_order", "read", { ids: qs.map((q) => q.x_order_id[0]), fields: ["id", "x_order_date", "x_state", "x_customer_id", "x_utak_simulation"] });
const byId = new Map(orders.map((o) => [o.id, o]));
let ok = qs.length === IDS.length;
for (const q of qs) {
  const o = byId.get(q.x_order_id[0]);
  const fine = q.x_customer_response === "pending" && q.x_utak_simulation === false && o?.x_utak_simulation === true;
  ok &&= fine;
  console.log(`${fine ? "·" : "✗"} ${q.x_quotation_number} (#${q.id}) sent ${q.x_sent_at}, ${q.x_customer_response}, x_utak_simulation ${q.x_utak_simulation} ← order #${o?.id} ${o?.x_order_date} ${o?.x_state} ${o?.x_customer_id?.[1]} marked ${o?.x_utak_simulation}`);
}
if (!ok) { console.log("✗ not as expected — nothing written"); process.exit(1); }
if (!APPLY) { console.log(`dry run: would set x_utak_simulation = true on ${qs.length} quotation(s)`); process.exit(0); }
if (existsSync(RB)) throw new Error("rollback file exists — not applying twice");
writeFileSync(RB, JSON.stringify({ at: new Date().toISOString(), before: qs }, null, 2) + "\n");
await call("x_quotation", "write", { ids: IDS, vals: { x_utak_simulation: true } });
const after = await call("x_quotation", "read", { ids: IDS, fields: F });
const good = after.every((q) => q.x_utak_simulation === true && q.x_customer_response === "pending");
console.log(`${good ? "✓" : "✗"} ${after.filter((q) => q.x_utak_simulation).length}/${IDS.length} marked; x_customer_response unchanged`);
process.exit(good ? 0 : 1);
