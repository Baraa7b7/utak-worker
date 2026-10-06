// § 59 ب (2026-10-06) — the marketing member's price list.
//
// Omar visits the shops and shows them our prices. With every publication of
// the day's prices each member who holds «تسويق» gets «📋 قائمة أسعار يو تاك
// اليوم»: the PUBLISHED items alone — the name, the packaging, the sale price
// with VAT — «صالحة حتى 6:00 صباح بكرة», and a wa.me link to UTAK's number with
// «أبي أطلب» ready. It is written to be forwarded to a shop as it is: no
// greeting to him, no word about us.
//
// § 53 holds: an employee sees the SALE price alone. Nothing here reads a
// purchase price, a market price, a suggested price or a profit — the lines
// come from the customers' own reader of the valid list (src/order-form.ts
// listItems) — and the gateway refuses the purpose for the number of a price
// source or a supplier (src/price-privacy.ts).
//
//   • Inside his 24h window: the list, as text.
//   • Outside it: utak_team_prices_ready_v1 (purpose team_prices_ready, UTILITY —
//     «قائمة أسعار يو تاك ليوم … جاهزة» with «أرسل القائمة»), and his tap sends
//     the list. Not APPROVED or not UTILITY → never used.
//   • Either way outside the window the list is OWED to him (KV, until the list
//     expires): it goes with his first message, whatever it says — built then,
//     from the list valid then, never an old one. Nothing is held in the gateway.
//   • «الأسعار» / «القائمة» from him at any hour: the valid list, or «الأسعار
//     تتحدث» while none is published.

import type { Env } from "./config";
import type { TeamMember, TeamRole } from "./types";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, releaseButton } from "./button-lock";
import { arabicDate } from "./wa-params";
import { fullName, money, weekdayAr } from "./prices";
import { validPriceList, type ValidList } from "./price-validity";
import { waDigits } from "./wa-window";

export const MARKETING_ROLE: TeamRole = "marketing";
/** The list itself, as the member reads it (and forwards it): our sale prices. */
export const TEAM_PRICES_PURPOSE = "team_price_list";
/** The lookup purpose of utak_team_prices_ready_v1 (outside his window). */
export const TEAM_PRICES_READY_PURPOSE = "team_prices_ready";
/** The payload of the template's «أرسل القائمة». */
export const TEAM_PRICES_PAYLOAD = "team_prices_send";
export const TEAM_PRICES_TITLE = "📋 قائمة أسعار يو تاك اليوم";
export const TEAM_PRICES_VAT_LINE = "الأسعار شاملة ضريبة القيمة المضافة.";
export const TEAM_PRICES_VALID_LINE = "صالحة حتى 6:00 صباح بكرة.";
/** The text the shop's WhatsApp opens with. */
export const ORDER_LINK_TEXT = "أبي أطلب";
export const TEAM_PRICES_UPDATING_TEXT = "الأسعار تتحدث الآن 🌿 أول ما تُنشر قائمة اليوم توصلك هنا.";
/** What a marketing member reads when he writes anything else. */
export const marketingHintText = (name: string): string => `مرحبا ${name} 👋 اكتب «الأسعار» وتوصلك قائمة أسعار يو تاك اليوم، جاهزة ترسلها لأي محل.`;
export const TEAM_PRICES_LIMIT = 3500;
const OWED_KV = "team_prices_owed:v1";
const CLAIM_TTL = 3 * 24 * 60 * 60;

export interface TeamPriceItem { productName: string; packagingName: string; price: number }

/** «https://wa.me/9665…?text=أبي أطلب» — UTAK's own number (UTAK_WA_NUMBER); "" when the worker does not know it. */
export function orderLink(env: Env): string {
  const d = waDigits(String(env.UTAK_WA_NUMBER ?? ""));
  return d.length >= 9 ? `https://wa.me/${d}?text=${encodeURIComponent(ORDER_LINK_TEXT)}` : "";
}

/** «الأسعار» / «القائمة» (and how they are written: «الاسعار», «أسعار اليوم», «قائمة الأسعار», «القايمة»), as the whole message. */
export function teamPricesCommand(text: string): boolean {
  const t = String(text ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ئ/g, "ي").replace(/ة/g, "ه")
    .replace(/[^ء-ي\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(ال)?اسعار( اليوم)?$/.test(t) || /^(ال)?قايمه( (ال)?اسعار)?( اليوم)?$/.test(t);
}

export const isMarketingMember = (m: Pick<TeamMember, "x_role" | "x_role_codes">): boolean =>
  m.x_role === MARKETING_ROLE || !!m.x_role_codes?.includes(MARKETING_ROLE);
/** A member with no role but «تسويق»: no task of the day is his, so the team's «استخدم الأزرار» says nothing to him. */
export const isMarketingOnly = (m: Pick<TeamMember, "x_role" | "x_role_codes">): boolean =>
  isMarketingMember(m) && (m.x_role_codes ?? [m.x_role]).every((c) => c === MARKETING_ROLE);

/**
 * The list as he forwards it: the title with the day, a line an item — the
 * name, the packaging, the sale price — then the VAT line, the validity and
 * the order link. Cut on line boundaries into parts of at most `limit`
 * characters, «(1/2)» when there is more than one.
 */
export function teamPriceListParts(day: string, items: TeamPriceItem[], link: string, limit: number = TEAM_PRICES_LIMIT): string[] {
  const head = `${TEAM_PRICES_TITLE} — ${weekdayAr(day)} ${arabicDate(day)}`;
  const footer = [TEAM_PRICES_VAT_LINE, TEAM_PRICES_VALID_LINE, link ? `للطلب على واتساب: ${link}` : ""].filter(Boolean).join("\n");
  const lines = items.map((i) => `• ${fullName(i.productName)} (${String(i.packagingName ?? "").trim()}): ${money(i.price)} ر.س`);
  const room = Math.max(200, limit - head.length - footer.length - 16);
  const chunks: string[][] = [[]];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > room && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }
    chunks[chunks.length - 1].push(l);
    size += l.length + 1;
  }
  const n = chunks.length;
  return chunks.map((c, i) => {
    const parts = [n > 1 ? `${head} (${i + 1}/${n})` : head, "", ...c];
    if (i === n - 1) parts.push("", footer);
    return parts.join("\n");
  });
}

/** The published items of a valid list, as the customers' own reader gives them (sale prices alone). */
export async function teamPriceItems(env: Env, list: Pick<ValidList, "dayId">): Promise<TeamPriceItem[]> {
  const { listItems } = await import("./order-form");
  return (await listItems(env, list)).map((i) => ({ productName: i.productName, packagingName: i.packagingName, price: i.price }));
}

const owedKey = (to: string) => `${OWED_KV}:${waDigits(to)}`;
async function markOwed(env: Env, to: string, list: ValidList, now: number): Promise<void> {
  const ttl = Math.max(60, Math.ceil((list.validUntilMs - now) / 1000));
  try { await env.MSG_DEDUP.put(owedKey(to), JSON.stringify({ day: list.day, dayId: list.dayId }), { expirationTtl: ttl }); } catch { /* «الأسعار» still answers him */ }
}
async function clearOwed(env: Env, to: string): Promise<boolean> {
  try {
    const had = !!(await env.MSG_DEDUP.get(owedKey(to)));
    if (had) await env.MSG_DEDUP.delete(owedKey(to));
    return had;
  } catch { return false; }
}

export type TeamPricesAction = "session" | "template" | "owed" | "refused" | "no_items" | "no_number" | "claimed_before";
export interface TeamPricesResult { name: string; action: TeamPricesAction }

/** The list's parts to a number whose window is open (he just wrote, or the gateway says so). The number of parts that went. */
async function sendParts(env: Env, to: string, parts: string[], ctx?: ExecutionContext): Promise<number> {
  let sent = 0;
  for (const part of parts) {
    const d = gatewayDecision(await sendViaGateway(env, { purpose: TEAM_PRICES_PURPOSE, to, content: textContent(part), noHold: true, noHoldReason: "تصله مع أول رسالة منه", ctx }));
    if (d?.action !== "session") break;
    sent++;
  }
  return sent;
}

/**
 * After a publication: the list to every member who holds «تسويق», once a
 * member and price day. Inside his window the list; outside it the template
 * with «أرسل القائمة» when Meta holds it UTILITY — and the list owed to him
 * either way. Never throws.
 */
export async function teamPricesAfterPublication(env: Env, list: ValidList, now: number = Date.now(), ctx?: ExecutionContext): Promise<TeamPricesResult[]> {
  const out: TeamPricesResult[] = [];
  try {
    const { getTeamMembersByRole } = await import("./odoo");
    const members = await getTeamMembersByRole(env, MARKETING_ROLE);
    if (!members.length) return out;
    const items = await teamPriceItems(env, list);
    const parts = items.length ? teamPriceListParts(list.day, items, orderLink(env)) : [];
    for (const m of members) {
      const to = String(m.x_whatsapp_number || "");
      if (!to) { out.push({ name: m.name, action: "no_number" }); continue; }
      if (!parts.length) { out.push({ name: m.name, action: "no_items" }); continue; }
      const claim = await claimButton(env, `team_prices:${list.dayId}:p${m.id}`, CLAIM_TTL);
      if (!claim.claimed) { out.push({ name: m.name, action: "claimed_before" }); continue; }
      let action: TeamPricesAction = "refused";
      try {
        const d = gatewayDecision(await sendViaGateway(env, {
          purpose: TEAM_PRICES_PURPOSE, to, content: textContent(parts[0]),
          fallback: [{ kind: "template", purpose: TEAM_PRICES_READY_PURPOSE, params: [arabicDate(list.day)], buttons: [{ index: 0, payload: TEAM_PRICES_PAYLOAD }] }],
          noHold: true, noHoldReason: "القائمة تصله مع أول رسالة منه (لا قالب UTILITY لها)", ctx,
        }));
        if (d?.action === "session") {
          if (parts.length > 1) await sendParts(env, to, parts.slice(1), ctx);
          action = "session";
        } else if (d?.action === "template" || d?.action === "skipped") {
          // his window is closed: the list waits for his tap on «أرسل القائمة» — or for his first message
          await markOwed(env, to, list, now);
          action = d.action === "template" ? "template" : "owed";
        } else {
          await releaseButton(env, claim); // refused (the allowlist, the price guard): nothing went, nothing is owed
        }
      } catch (e) {
        await releaseButton(env, claim).catch(() => {});
        console.warn(`[team-prices] ${m.name}: the list could not be sent`, (e as Error)?.message);
      }
      out.push({ name: m.name, action });
      console.log(`[team-prices] ${list.day} → ${m.name}: ${action}`);
    }
  } catch (e) {
    console.warn("[team-prices] the marketing list after the publication failed", (e as Error)?.message);
  }
  return out;
}

/**
 * The valid list to a marketing member who asked for it — «الأسعار» / «القائمة»,
 * or «أرسل القائمة» on the template — or «الأسعار تتحدث» while none is
 * published. His window is open (he just wrote). What was owed to him is
 * settled by this answer. Returns what he got.
 */
export async function answerTeamPricesAsk(env: Env, to: string, ctx?: ExecutionContext, now: number = Date.now()): Promise<"list" | "updating" | "failed"> {
  await clearOwed(env, to);
  try {
    const list = await validPriceList(env, now);
    const items = list ? await teamPriceItems(env, list) : [];
    if (!list || !items.length) {
      await sendViaGateway(env, { purpose: TEAM_PRICES_PURPOSE, to, content: textContent(TEAM_PRICES_UPDATING_TEXT), noHold: true, ctx });
      return "updating";
    }
    const parts = teamPriceListParts(list.day, items, orderLink(env));
    return (await sendParts(env, to, parts, ctx)) === parts.length ? "list" : "failed";
  } catch (e) {
    console.warn("[team-prices] the list could not be read for the ask", (e as Error)?.message);
    await sendViaGateway(env, { purpose: TEAM_PRICES_PURPOSE, to, content: textContent(TEAM_PRICES_UPDATING_TEXT), noHold: true, ctx }).catch(() => {});
    return "failed";
  }
}

/**
 * The list owed to a marketing member (published while his window was closed):
 * with his first message, whatever it says — the list valid NOW; an owed list
 * that has expired since is simply dropped. True when a list went.
 */
export async function sendOwedTeamPrices(env: Env, to: string, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  if (!(await clearOwed(env, to))) return false;
  try {
    const list = await validPriceList(env, now);
    const items = list ? await teamPriceItems(env, list) : [];
    if (!list || !items.length) return false;
    const parts = teamPriceListParts(list.day, items, orderLink(env));
    return (await sendParts(env, to, parts, ctx)) > 0;
  } catch (e) {
    console.warn("[team-prices] the owed list could not be sent", (e as Error)?.message);
    return false;
  }
}
