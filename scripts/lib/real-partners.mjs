// § 44 ب (2026-09-28) — the real customers' records are never marked «محاكاة».
//
// The list: Abu Makeen (#31, «ابو مكين المعبري», who absorbs #47 «يو» in § 44 ج),
// and «بيت التمور» (#105): created by the sim worker from WhatsApp on 09-27
// 08:59 and classified «عميل» by Baraa by hand at 10:55 (§ 44 أ-4). Nobody else
// was created or classified by Baraa in the period. A later real customer is
// added here by id.
//
// A record is linked to a partner when it is the partner's own (order, message,
// analysis), hangs off one of its orders (line, invoice, payment, stop,
// quotation), or carries one of those (a route with one of its stops, the
// purchase list of a day it has a live order on, that list's dues and their
// lines). Such a record never gets x_utak_simulation — even with
// x_is_simulation = true (the sim / pilot worker stamps every record it creates,
// so a real customer who wrote to sim has stamped rows). A linked record that is
// ALREADY marked is never unmarked here: it is listed for Baraa to decide.
//
// Used by scripts/s42-20260927-prelaunch-mark.mts (scan / mark / verify), which
// scripts/cutover-prod.mts runs in its step 3ب; tested in tests/s44.test.mts.

export const REAL_PARTNER_IDS = Object.freeze([31, 105]);

/** The domain of each model's records linked DIRECTLY (by a field path) to the partners. */
export function linkedDomains(ids = REAL_PARTNER_IDS) {
  const list = [...ids];
  return {
    x_daily_order: [["x_customer_id", "in", list]],
    x_daily_order_line: [["x_order_id.x_customer_id", "in", list]],
    x_invoice: [["x_order_id.x_customer_id", "in", list]],
    x_payment: [["x_invoice_id.x_order_id.x_customer_id", "in", list]],
    x_delivery_stop: [["x_order_id.x_customer_id", "in", list]],
    x_quotation: [["x_order_id.x_customer_id", "in", list]],
    x_message_analysis: [["x_customer_id", "in", list]],
    x_wa_message: [["x_partner_id", "in", list]],
  };
}

/**
 * Per model, the ids of the records linked to the partners (direct and derived).
 * `call(model, method, body)` is the Odoo JSON-2 caller (scripts/lib/odoo-cli.mjs,
 * or a fake in the tests). Only reads.
 */
export async function linkedRecordIds(call, ids = REAL_PARTNER_IDS, models = null) {
  const direct = linkedDomains(ids);
  const want = (m) => !models || models.includes(m);
  const out = {};
  for (const [m, domain] of Object.entries(direct)) {
    if (!want(m) && !["x_daily_order", "x_delivery_stop"].includes(m)) continue;
    out[m] = new Set(await call(m, "search", { domain, context: { active_test: false } }));
  }
  // a route that carries one of their stops
  const stops = out.x_delivery_stop?.size
    ? await call("x_delivery_stop", "read", { ids: [...out.x_delivery_stop], fields: ["id", "x_route_id"] })
    : [];
  out.x_delivery_route = new Set(stops.map((s) => (Array.isArray(s.x_route_id) ? s.x_route_id[0] : 0)).filter(Boolean));
  // the purchase list of a day they have a live (not cancelled) order on, its dues and their lines
  const orders = out.x_daily_order?.size
    ? await call("x_daily_order", "read", { ids: [...out.x_daily_order], fields: ["id", "x_order_date", "x_state"] })
    : [];
  const days = [...new Set(orders.filter((o) => o.x_state !== "cancelled" && o.x_order_date).map((o) => o.x_order_date))];
  out.x_purchase_list = new Set(days.length ? await call("x_purchase_list", "search", { domain: [["x_date", "in", days]], context: { active_test: false } }) : []);
  out.x_supplier_due = new Set(out.x_purchase_list.size ? await call("x_supplier_due", "search", { domain: [["x_purchase_list_id", "in", [...out.x_purchase_list]]], context: { active_test: false } }) : []);
  out.x_supplier_due_line = new Set(out.x_supplier_due.size ? await call("x_supplier_due_line", "search", { domain: [["x_due_id", "in", [...out.x_supplier_due]]], context: { active_test: false } }) : []);
  for (const m of Object.keys(out)) if (!want(m)) delete out[m];
  return out;
}

/** The ids the pre-launch rule would mark, less the ones linked to a real partner. */
export function withoutReal(model, ids, linked) {
  const keep = linked?.[model];
  if (!keep || !keep.size) return { ids: [...ids], excluded: [] };
  return { ids: ids.filter((id) => !keep.has(id)), excluded: ids.filter((id) => keep.has(id)) };
}

/**
 * The pre-launch rule for one model (§ 42 ج, § 44 ب): x_is_simulation = true and
 * x_utak_simulation not yet true, less the records linked to a real customer.
 * A model without x_utak_simulation has nothing to mark; one without
 * x_is_simulation is counted (unmarked) and left.
 */
export async function selectForMark(call, model, linked) {
  const f = await call(model, "fields_get", { attributes: ["type"] });
  const hasIs = "x_is_simulation" in f, hasSim = "x_utak_simulation" in f;
  if (!hasSim) return { hasIs, hasSim, ids: [], excluded: [], unmarkedNoRule: null };
  if (!hasIs) return { hasIs, hasSim, ids: [], excluded: [], unmarkedNoRule: await call(model, "search_count", { domain: [["x_utak_simulation", "!=", true]] }) };
  const all = await call(model, "search", { domain: [["x_is_simulation", "=", true], ["x_utak_simulation", "!=", true]], order: "id asc" });
  const { ids, excluded } = withoutReal(model, all, linked);
  return { hasIs, hasSim, ids, excluded, unmarkedNoRule: null };
}
