// § 66 — the shared world of the tests of «العميل وافق ← طلب» (tests/s66-*.test.mts): § 62's world
// (tests/s62-kit.mts: Ahmed «شراء», Raed «سوق», the customer Madarat, six products, two of them not «نشط للبيع»)
// and what the acceptance needs — the order-confirmation template, «حد الطلب الكبير», the sale-accounting's
// service product, and Odoo's sale.order confirm / cancel (the harness answers `true` to a method it does not know).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.

import { OWNER, odooLog, openWindow, rows, seed, sentTo, table } from "./wa-harness.mts";
import { AHMED, GARLIC, LETTUCE, MADARAT_PHONE, MUSHROOM, ORANGE, lineOf, request, world as world62 } from "./s62-kit.mts";

export * from "./s62-kit.mts";
export const SERVICE = 111;
export const CONFIRM_TEMPLATE = "utak_order_confirmed";
/** What Odoo's confirm does to the next sale order: "picking" leaves a stock picking on it, "draft" leaves it unconfirmed. */
export const confirmAs = { how: "sale" as "sale" | "picking" | "draft" };

const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/sale\.order\/(action_confirm|action_cancel)$/.exec(url);
  if (m && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    odooLog.push({ model: "sale.order", method: m[1], body });
    for (const id of body.ids ?? []) {
      const so = table("sale.order").get(id);
      if (!so) continue;
      if (m[1] === "action_cancel") so.state = "cancel";
      else if (confirmAs.how !== "draft") { so.state = "sale"; so.picking_ids = confirmAs.how === "picking" ? [7001] : []; }
    }
    return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return kitFetch(input as any, init);
}) as typeof fetch;

/** § 62's tenant at `riyadh`, the customer's window open, and § 66's own rows. */
export function world(riyadh?: string): any {
  const env = world62(riyadh);
  confirmAs.how = "sale";
  seed("x_whatsapp_template", { x_purpose: "customer_order_confirm", x_meta_template_id: CONFIRM_TEMPLATE, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  seed("product.product", { id: SERVICE, default_code: "UTAK-SALE-GOODS", type: "service" });
  Object.assign(table("x_pricing_config").get(1)!, { x_large_order_cartons: 50, x_min_order_sar: 0 });
  openWindow(env, MADARAT_PHONE);
  return env;
}

/** [product, quantity, purchase, final VAT-inclusive, «التعبئة»]: the lines of the tests' request. */
export type Row = [number, number, number, number, string?];
export const SIX: Row[] = [[ORANGE, 1464, 3, 4.75], [LETTUCE, 494, 6, 9], [GARLIC, 194, 10, 14.25], [1, 33, 2, 3], [MUSHROOM, 12, 20, 27.5], [2, 9, 2.5, 3.5]];
/** A request with its lines priced (the purchase price as Ahmed sent it: his observation, so he is its supplier). */
export function priced(lines: Row[] = SIX, extra: Record<string, unknown> = {}): number {
  const id = request(lines.map(([p, q]) => [p, q] as [number, number]), extra);
  lines.forEach(([p, , buy, fin, unit], i) => {
    const l = [...table("x_special_quote_line").values()].filter((x) => x.x_quote_id === id)[i] as Record<string, unknown>;
    void lineOf;
    Object.assign(l, { x_purchase_price: buy, x_final_price: fin, x_final_net: Math.round((fin / 1.15) * 100) / 100, x_obs: JSON.stringify({ purchase: { [AHMED]: { p: buy, n: "أحمد حسان", at: 1 } }, market: {} }), ...(unit ? { x_unit: unit } : {}) });
  });
  return id;
}
export const textsTo = (d: string): string[] => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
export const ownerSaid = (): string[] => sentTo(OWNER).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? ""));
export const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
export const ordersOf = (quoteId: number) => rows("x_daily_order").filter((o: any) => o.x_special_quote_id === quoteId) as Array<Record<string, any>>;
export const orderLines = (orderId: number) => rows("x_daily_order_line").filter((l: any) => l.x_order_id === orderId) as Array<Record<string, any>>;
export const unlockConvert = (env: any, id: number) => env.MSG_DEDUP.store.delete(`btnlock:v1:spq_convert:${id}`);
export const unlockIssue = (env: any, id: number) => env.MSG_DEDUP.store.delete(`btnlock:v1:spq_issue:${id}`);
export const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
