// UTAK — archive the test collector partner 10 «محمد المحصّل - اختبار» (2026-09-24).
//
//   node scripts/cleanup-20260924-archive-test-collector.mjs [--dry-run] [--rollback]
//
// Archive only (active=false), never delete. Refused if the partner is on any
// account.move / account.move.line / account.payment / sale.order /
// purchase.order, or if an x_payment it collected is linked to an
// account.payment. Its smoke-test x_payment 1 / x_collection_task 1 (2026-08)
// stay as they are. Once archived it drops out of getCollectorTeamMembers
// (active=true), so the daily collection list stops going to its fake number.
//
// Snapshot: scripts/artifacts/cleanup-20260924-archive-test-collector-rollback.json
// --rollback sets active=true again.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const PID = 10;
const SNAP = new URL("./artifacts/cleanup-20260924-archive-test-collector-rollback.json", import.meta.url);
const DRY = process.argv.includes("--dry-run");
const ctx = { active_test: false };

if (process.argv.includes("--rollback")) {
  const snap = JSON.parse(readFileSync(SNAP, "utf8"));
  await call("res.partner", "write", { ids: [snap.partner.id], vals: { active: snap.partner.active } });
  console.log(`partner ${snap.partner.id} active → ${snap.partner.active}`);
  process.exit(0);
}

const [p] = await call("res.partner", "read", {
  ids: [PID], fields: ["id", "name", "active", "x_is_simulation", "x_role", "x_role_ids", "x_whatsapp_number", "x_wa_channel_id"], context: ctx,
});
if (!p || !/اختبار/.test(p.name)) { console.error(`STOP: partner ${PID} is not the test collector: ${p?.name}`); process.exit(1); }
console.log(`partner ${p.id} «${p.name}» active=${p.active} roles=${JSON.stringify(p.x_role_ids)}`);

const accounting = {};
for (const [model, field] of [
  ["account.move", "partner_id"], ["account.move.line", "partner_id"], ["account.payment", "partner_id"],
  ["sale.order", "partner_id"], ["purchase.order", "partner_id"],
]) accounting[`${model}.${field}`] = await call(model, "search_count", { domain: [[field, "=", PID]], context: ctx });
const payments = await call("x_payment", "search_read", {
  domain: [["x_collected_by", "=", PID]], fields: ["id", "x_amount", "x_account_payment_id", "x_notes", "x_collected_at"], context: ctx,
});
const tasks = await call("x_collection_task", "search_read", {
  domain: [["x_collector_id", "=", PID]], fields: ["id", "x_status", "x_date"], context: ctx,
});
const messages = await call("x_wa_message", "search_count", { domain: [["x_partner_id", "=", PID]], context: ctx });
console.log("accounting refs:", JSON.stringify(accounting));
console.log("x_payment:", JSON.stringify(payments));
console.log("x_collection_task:", JSON.stringify(tasks), "x_wa_message:", messages);

const linked = Object.values(accounting).some((n) => n > 0) || payments.some((x) => x.x_account_payment_id);
if (linked) { console.error("STOP: partner is linked to a real accounting record — not archived"); process.exit(1); }
if (!p.active) { console.log("already archived — nothing to do"); process.exit(0); }
if (DRY) { console.log("dry-run — would archive"); process.exit(0); }

if (!existsSync(SNAP)) {
  writeFileSync(SNAP, JSON.stringify({
    at: new Date().toISOString(), partner: { id: p.id, name: p.name, active: p.active, x_role_ids: p.x_role_ids },
    refs: { accounting, x_payment: payments, x_collection_task: tasks, x_wa_message: messages },
    rollback: "node scripts/cleanup-20260924-archive-test-collector.mjs --rollback",
  }, null, 2));
}
await call("res.partner", "write", { ids: [PID], vals: { active: false } });
const [after] = await call("res.partner", "read", { ids: [PID], fields: ["active"], context: ctx });
console.log(`archived: active=${after.active}`);
