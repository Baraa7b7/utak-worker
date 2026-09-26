// م8 — «في الطريق» to the customer (2026-09-26, STATUS § 38; WA-SCENARIOS م8 / ع7).
//
// utak_out_for_delivery (UTILITY, APPROVED; purpose customer_delivery_incoming):
// «طلبك رقم {{1}} في الطريق إليك الآن مع {{2}}. يو تاك» = [order number,
// «السائق <name>»] (Meta's own example: «12345», «السائق أحمد»). Inside the
// customer's 24h window the same words go as text; outside it, the template.
//
// When — in the route's own order, x_delivery_stop.x_sequence (the order the
// stops were built in and sent to the driver):
//   • the first stop: when the driver's route goes out (sendDriverRoute), or —
//     a route held until «بدء الدوام» (§ 29 / § 31) — when it is flushed to him
//     after the tap (the queue's route_start marker);
//   • each next stop: when the driver taps «تم التسليم» on the stop before it;
//   • «مشكلة» on a stop sends nothing to the next one; «تم التسليم» on that
//     same stop later resumes the sequence;
//   • an order cancelled, or delivered already, is skipped: the stop after it
//     gets the message instead;
//   • an order marked x_utak_simulation: nothing is sent for it, and the
//     sequence waits for its «تم التسليم» like any stop the driver goes to;
//   • a customer who stopped the marketing messages (x_wa_marketing_optout,
//     § 23) still gets it: it is an operational UTILITY message. A partner held
//     from customer automation (§ 30) does not.
// One message per order: a KV claim before the send (button-lock), then the
// order's rows in x_wa_message (§ 36: this purpose, the order number in the
// text) — a second tap, a re-run or a lost KV key never send it twice.

import type { Env } from "./config";
import { call } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { T } from "./templates";
import { claimButton } from "./button-lock";
import { heldPartnerIds } from "./screening";
import { SIM_FIELD } from "./supplier-pay";

export const OFD_PURPOSE = T.CUSTOMER_DELIVERY_INCOMING;
export const OFD_TEMPLATE = "utak_out_for_delivery";
const OFD_CLAIM_TTL = 7 * 24 * 60 * 60;
/** Order states that take no «في الطريق»: the stop is skipped. */
const DONE_STATES = new Set(["cancelled", "delivered", "closed"]);

export type OfdAction =
  | "sent" | "held" | "failed"          // the gateway's answer for this order
  | "already" | "claimed"               // one message per order
  | "simulation" | "held_partner" | "no_phone"
  | "issue_waits"                       // the next stop is marked «مشكلة»: its «تم التسليم» resumes
  | "end" | "no_route";
export interface OfdOutcome {
  action: OfdAction;
  /** The order the outcome is about (the one notified, or the one that stopped the sequence). */
  orderId?: number;
  /** Orders passed over on the way (cancelled or delivered already). */
  skipped: number[];
}

type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const stripRef = (s: string) => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();

/** «طلبك رقم #41 في الطريق إليك الآن مع السائق عمر المجهلي. يو تاك» — the template's words, as text. */
export function ofdText(orderId: number, driverName: string): string {
  return `🚚 طلبك رقم #${orderId} في الطريق إليك الآن مع ${driverLabel(driverName)}. يو تاك`;
}
/** {{2}}: «السائق عمر المجهلي» (one line), or «السائق» when the name is unknown. */
export function driverLabel(driverName: string): string {
  const n = String(driverName ?? "").replace(/\s+/g, " ").trim();
  return n ? `السائق ${n}` : "السائق";
}
export function ofdParams(orderId: number, driverName: string): string[] {
  return [String(orderId), driverLabel(driverName)];
}

interface StopRow { id: number; orderId: number; sequence: number; status: string }

/** The route's stops in the driver's order (x_sequence, then id). */
async function routeStops(env: Env, routeId: number): Promise<StopRow[]> {
  const rows = await call<Array<{ id: number; x_order_id: M2O; x_sequence: number | false; x_status: string }>>(env, "x_delivery_stop", "search_read", {
    domain: [["x_route_id", "=", routeId]],
    fields: ["id", "x_order_id", "x_sequence", "x_status"],
    order: "x_sequence asc, id asc",
    limit: 500,
  });
  return rows
    .map((r) => ({ id: r.id, orderId: m2oId(r.x_order_id), sequence: Number(r.x_sequence || 0), status: String(r.x_status || "") }))
    .filter((r) => r.orderId > 0)
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
}

async function routeDriverName(env: Env, routeId: number): Promise<string> {
  const [r] = await call<Array<{ x_driver_id: M2O }>>(env, "x_delivery_route", "read", { ids: [routeId], fields: ["x_driver_id"] });
  return Array.isArray(r?.x_driver_id) ? stripRef(r.x_driver_id[1]) : "";
}

/** The route just went out to the driver: its first stop's customer. */
export async function notifyRouteStart(env: Env, routeId: number, driverName?: string): Promise<OfdOutcome> {
  const stops = await routeStops(env, routeId);
  if (stops.length === 0) return { action: "no_route", skipped: [] };
  const out = await notifyFrom(env, stops, 0, driverName ?? (await routeDriverName(env, routeId)));
  console.log(`[ofd] route ${routeId} start → ${out.action}${out.orderId ? ` #${out.orderId}` : ""}${out.skipped.length ? ` (skipped ${out.skipped.join(",")})` : ""}`);
  return out;
}

/** «تم التسليم» on `orderId`: the customer of the stop after it, in the route's order. */
export async function notifyNextAfterDelivered(env: Env, orderId: number): Promise<OfdOutcome> {
  const [stop] = await call<Array<{ id: number; x_route_id: M2O }>>(env, "x_delivery_stop", "search_read", {
    domain: [["x_order_id", "=", orderId]],
    fields: ["id", "x_route_id"],
    order: "id desc",
    limit: 1,
  });
  const routeId = m2oId(stop?.x_route_id);
  if (!stop || !routeId) return { action: "no_route", skipped: [] };
  const stops = await routeStops(env, routeId);
  const i = stops.findIndex((s) => s.id === stop.id);
  if (i < 0) return { action: "no_route", skipped: [] };
  const out = await notifyFrom(env, stops, i + 1, await routeDriverName(env, routeId));
  console.log(`[ofd] delivered #${orderId} → ${out.action}${out.orderId ? ` #${out.orderId}` : ""}${out.skipped.length ? ` (skipped ${out.skipped.join(",")})` : ""}`);
  return out;
}

async function notifyFrom(env: Env, stops: StopRow[], start: number, driverName: string): Promise<OfdOutcome> {
  const rest = stops.slice(start);
  if (rest.length === 0) return { action: "end", skipped: [] };
  const orders = await call<Array<{ id: number; x_state: string | false; x_customer_id: M2O } & Record<string, unknown>>>(env, "x_daily_order", "read", {
    ids: [...new Set(rest.map((s) => s.orderId))],
    fields: ["id", "x_state", "x_customer_id", SIM_FIELD],
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const skipped: number[] = [];
  for (const s of rest) {
    const o = byId.get(s.orderId);
    if (!o || DONE_STATES.has(String(o.x_state || "")) || s.status === "delivered") {
      skipped.push(s.orderId);
      continue;
    }
    if (s.status === "issue") return { action: "issue_waits", orderId: s.orderId, skipped };
    if (o[SIM_FIELD] === true) {
      console.log(`[ofd] skip #${s.orderId} — simulation (${SIM_FIELD}): nothing sent`);
      return { action: "simulation", orderId: s.orderId, skipped };
    }
    return { action: await sendOfd(env, s.orderId, m2oId(o.x_customer_id), driverName), orderId: s.orderId, skipped };
  }
  return { action: "end", skipped };
}

/** Rows of this purpose in x_wa_message that carry `orderId` in their text (sent, or held to go). */
async function ofdOnRecord(env: Env, orderId: number): Promise<boolean> {
  try {
    const rows = await call<Array<{ id: number; x_body: string | false }>>(env, "x_wa_message", "search_read", {
      domain: [
        ["x_direction", "=", "out"],
        ["x_debug_payload", "ilike", OFD_PURPOSE],
        ["x_body", "ilike", String(orderId)],
        ["x_status", "in", ["sent", "delivered", "read", "held", "dry_ok"]],
      ],
      fields: ["id", "x_body"],
      limit: 20,
    });
    const re = new RegExp(`(?<!\\d)${orderId}(?!\\d)`);
    return rows.some((r) => re.test(String(r.x_body || "")));
  } catch (e) {
    // the KV claim already stands for this order: the record is the second net
    console.warn(`[ofd] record check for #${orderId} failed`, (e as Error)?.message);
    return false;
  }
}

async function sendOfd(env: Env, orderId: number, customerId: number, driverName: string): Promise<OfdAction> {
  if (!customerId) return "no_phone";
  const [p] = await call<Array<{ id: number; x_whatsapp_number: string | false; phone: string | false }>>(env, "res.partner", "read", {
    ids: [customerId], fields: ["id", "x_whatsapp_number", "phone"],
  });
  const to = String(p?.x_whatsapp_number || p?.phone || "");
  if (!to) return "no_phone";
  try {
    if ((await heldPartnerIds(env, [customerId])).has(customerId)) return "held_partner";
  } catch (e) {
    console.warn(`[ofd] review state of ${customerId} unreadable — not holding`, (e as Error)?.message);
  }
  const claim = await claimButton(env, `ofd:${orderId}`, OFD_CLAIM_TTL);
  if (!claim.claimed) return "claimed";
  if (await ofdOnRecord(env, orderId)) return "already";
  const r = await sendViaGateway(env, {
    purpose: OFD_PURPOSE,
    to,
    content: textContent(ofdText(orderId, driverName)),
    fallback: [{ kind: "template", purpose: OFD_PURPOSE, params: ofdParams(orderId, driverName) }],
  });
  const d = gatewayDecision(r);
  if (d?.action === "session" || d?.action === "template") return "sent";
  if (d?.action === "held") return "held";
  return "failed";
}
