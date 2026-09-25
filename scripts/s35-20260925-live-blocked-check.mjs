// STATUS § 35 — live: «اعتماد أسعار اليوم» refuses while an outlier is unhandled.
// Unticks «اعتماد رغم الشذوذ» on today's cucumber line, runs the approve button
// (must be refused, the record stays draft), then ticks it back. Nothing deleted.
// Out: scripts/artifacts/s35-20260925-live-blocked-check.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
const TODAY = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const [d] = await call("x_price_day", "search_read", { domain: [["x_date", "=", TODAY]], fields: ["id", "x_state"], limit: 1 });
const [l] = await call("x_price_day_line", "search_read", { domain: [["x_day_id", "=", d.id], ["x_product_tmpl_id", "=", 72]], fields: ["id", "x_outlier_ok", "x_blocked"] });
const out = { day: d, before: l };
await call("x_price_day_line", "write", { ids: [l.id], vals: { x_outlier_ok: false } });
out.unticked = (await call("x_price_day_line", "read", { ids: [l.id], fields: ["x_outlier_ok", "x_blocked"] }))[0];
try {
  await call("ir.actions.server", "run", { ids: [1002], context: { active_model: "x_price_day", active_id: d.id, active_ids: [d.id] } });
  out.approve = { refused: false };
} catch (e) {
  out.approve = { refused: true, error: String(e?.message ?? e).match(/"message": "([^"]+)"/)?.[1] ?? String(e).slice(0, 200) };
}
out.stateAfter = (await call("x_price_day", "read", { ids: [d.id], fields: ["x_state"] }))[0].x_state;
await call("x_price_day_line", "write", { ids: [l.id], vals: { x_outlier_ok: true } });
out.restored = (await call("x_price_day_line", "read", { ids: [l.id], fields: ["x_outlier_ok", "x_blocked"] }))[0];
writeFileSync(new URL("./artifacts/s35-20260925-live-blocked-check.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
