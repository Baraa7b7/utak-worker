// § 60 (2026-10-06, Baraa's amendment) — «📈 تاريخ الأسعار»: a saved filter an item.
//
// The tool is read ONE item at a time (an item's prices against another's on one chart say nothing: a
// banana at 75 beside a pomegranate at 18). So each item active for sale has a saved filter of its own,
// by its name, shared with every user («المفضلة»): the chart on that item alone, by the day. The Odoo
// script (scripts/s60-20261006-day.mjs, scripts/lib/s60-ui.mjs itemFilterVals — the same rows, held
// equal by tests/s60-history.test.mts) made them for the items of 2026-10-06; a NEW item gets its own
// here, with the day's computation (src/prices.ts refreshPriceDay). An item whose filter exists — active
// or switched off by Baraa — is left alone: nothing is ever written twice, nothing is ever put back.
// The items known to have one are kept in KV for a day, so a run reads Odoo only when an item is new.
// Never blocks the engine: a failure is logged and the prices go on.

import type { Env } from "./config";
import { call } from "./odoo";

export const HISTORY_ACTION = "UTAK — تاريخ الأسعار";
export const FILTER_MODEL = "ir.filters";
export const LINE_MODEL = "x_price_day_line";
export const ITEM_FILTER_MEASURE = "x_market_price";
const KNOWN_KEY = "hist_filters:v1";
const KNOWN_TTL = 24 * 3600;

/** The product's own name: the «[UTAK-…]» reference in front of it removed. */
export const plainName = (name: string): string => String(name ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();

/**
 * The saved filter of one item: its lines that carry a market price, by the day, as a line chart of the
 * market price, shared with every user. The action's own domain (the real lines alone) still applies.
 * Pure — the very row scripts/lib/s60-ui.mjs itemFilterVals writes.
 */
export function itemFilterVals(productId: number, name: string, actionId: number): Record<string, unknown> {
  return {
    name: plainName(name), model_id: LINE_MODEL, action_id: actionId, user_ids: [[6, 0, []]], is_default: false, sort: "[]",
    domain: `[("x_product_tmpl_id", "=", ${productId}), ("x_market_price", ">", 0)]`,
    context: `{"group_by": ["x_day_date:day"], "graph_measure": "${ITEM_FILTER_MEASURE}", "graph_mode": "line", "graph_groupbys": ["x_day_date:day"], "graph_stacked": False}`,
  };
}

/**
 * Every item of the day has its saved filter: the ones that have none yet are created. `items`: the
 * active items the engine just priced (a product once, whatever its packagings). Returns how many were
 * created. Never throws.
 */
export async function ensureItemFilters(env: Env, items: Array<{ productId: number; productName: string }>): Promise<number> {
  try {
    const products = new Map(items.filter((i) => i.productId > 0 && plainName(i.productName)).map((i) => [i.productId, i.productName]));
    if (!products.size) return 0;
    let known: number[] = [];
    try { known = JSON.parse((await env.MSG_DEDUP.get(KNOWN_KEY)) ?? "[]") as number[]; } catch { /* read Odoo */ }
    if ([...products.keys()].every((id) => known.includes(id))) return 0;
    const [action] = await call<Array<{ id: number }>>(env, "ir.actions.act_window", "search_read", { domain: [["name", "=", HISTORY_ACTION]], fields: ["id"], limit: 1 });
    // no «📈 تاريخ الأسعار» on this tenant (§ 58's view rolled back): nothing to filter
    if (!action) return 0;
    // a filter switched off is still his: it is found, and never made again
    const have = await call<Array<{ name: string }>>(env, FILTER_MODEL, "search_read", {
      domain: [["model_id", "=", LINE_MODEL], ["action_id", "=", action.id]], fields: ["name"], context: { active_test: false }, limit: 2000,
    });
    const names = new Set(have.map((f) => String(f.name)));
    const vals_list = [...products].map(([id, name]) => itemFilterVals(id, name, action.id)).filter((v) => !names.has(String(v.name)))
      // two products of one name: one filter (the first)
      .filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i);
    if (vals_list.length) await call<number[]>(env, FILTER_MODEL, "create", { vals_list });
    try { await env.MSG_DEDUP.put(KNOWN_KEY, JSON.stringify([...new Set([...known, ...products.keys()])]), { expirationTtl: KNOWN_TTL }); } catch { /* the next run reads Odoo again */ }
    if (vals_list.length) console.log(`[history-filters] +${vals_list.length}: ${vals_list.map((v) => v.name).join("، ")}`);
    return vals_list.length;
  } catch (e) {
    console.warn("[history-filters] the items' saved filters could not be made", (e as Error)?.message);
    return 0;
  }
}
