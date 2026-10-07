// § 62 د (2026-10-07) — «👁️ معاينة PDF»: a quotation's DRAFT in the browser, from the special request's
// screen and from the sale order's.
//
//   Odoo's button (a code action) makes a ONE-USE ticket — a row of x_preview_ticket: a random uuid from
//   the database, the record, the moment — and opens  GET /preview/t/<ticket>  in a new tab.
//
//   1  /preview/t/<ticket>: the worker reads the ticket back from Odoo (the proof that a signed-in user
//      of Odoo pressed the button on THAT record a moment ago), burns it (x_used), and answers 302 to
//   2  /preview/doc/<kind>/<id>/<expiry>/<signature>.pdf — its own link: an HMAC of the kind, the record
//      and the expiry, good for LINK_TTL_MS, checked without asking anyone. The PDF is built there.
//
// No fixed secret is in the button, the action, or the address bar: the ticket dies on its first use (and
// after TICKET_TTL_MS unused), the link a few minutes later, and both name one record.
//
// A preview is a draft to the eye — «مسودة» across the page and in the number's place, no seal, no
// signature — and to the books: NOTHING IS WRITTEN but the ticket's own row. No number is taken, no sale
// order is made or changed, no state moves, no «آخر نتيجة», no file is kept in R2, and no message is sent.

import type { Env } from "./config";
import { call } from "./odoo";
import { signDocToken } from "./pdf-template";

export const TICKET_MODEL = "x_preview_ticket";
export const TICKET_TTL_MS = 5 * 60_000;
export const LINK_TTL_MS = 15 * 60_000;
export const PREVIEW_PREFIX = "/preview/";
export type PreviewKind = "sq" | "so";
/** The models a ticket may name, and the short name each has in a link. */
export const PREVIEW_KINDS: Readonly<Record<string, PreviewKind>> = { x_special_quote: "sq", "sale.order": "so" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOC = /^doc\/(sq|so)\/([1-9]\d{0,9})\/(\d{10,16})\/([a-f0-9]{16})\.pdf$/;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A plain Arabic page for the tab the button opened: what happened, and what to do. */
export function messagePage(status: number, title: string, text: string): Response {
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family: system-ui, sans-serif; background: #F7F5F0; color: #1A1815; margin: 0; padding: 48px 24px; text-align: center;">
<h1 style="font-size: 20px; font-weight: 500; color: #1E5A41;">${esc(title)}</h1><p style="font-size: 15px; line-height: 1.9; white-space: pre-wrap;">${esc(text)}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const notFound = (): Response => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const AGAIN = "ارجع إلى Odoo واضغط «👁️ معاينة PDF» من جديد.";

/** The signature of a preview link: the kind, the record and the expiry under the worker's own secret. */
export function previewSignature(secret: string, kind: PreviewKind, id: number, expiry: number): Promise<string> {
  return signDocToken(secret, `preview:${kind}:${id}:${expiry}`);
}
export async function previewLinkPath(secret: string, kind: PreviewKind, id: number, expiry: number): Promise<string> {
  return `${PREVIEW_PREFIX}doc/${kind}/${id}/${expiry}/${await previewSignature(secret, kind, id, expiry)}.pdf`;
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** Odoo's UTC «YYYY-MM-DD HH:MM:SS» → ms; NaN when it is not one. */
const odooMs = (s: unknown): number => (typeof s === "string" && s ? Date.parse(`${s.replace(" ", "T")}Z`) : NaN);

interface TicketRow { id: number; x_model: string | false; x_res_id: number | false; x_used: boolean; create_date: string | false }
/** The words of the pages a ticket's door answers with (the preview's, the price-history page's). */
export interface TicketWords { failed: string; unknown: string; once: string; again: string }
const PREVIEW_WORDS: TicketWords = { failed: "تعذّرت المعاينة", unknown: "رابط معاينة غير معروف", once: "رابط المعاينة يفتح مرة واحدة.", again: AGAIN };
export interface Redeemed { model: string; resId: number }

/**
 * A ticket Odoo made (§ 62 د's preview buttons; § 64's «📈 تاريخ الأسعار» menu): read back, held against what this
 * door `accepts`, checked — once, for TICKET_TTL_MS — and BURNT before anything is given for it. § 64: a burnt
 * ticket is archived with the same write (x_active), so the list of tickets holds the live ones; it is read back
 * archived or not, to be told «استُعمل» and not «غير معروف». A Response = the ticket opens nothing.
 */
export async function redeemTicket(env: Env, ticket: string, now: number, w: TicketWords, accepts: (model: string, resId: number) => boolean): Promise<Redeemed | Response> {
  if (!UUID.test(ticket)) return notFound();
  let row: TicketRow | undefined;
  try {
    [row] = await call<TicketRow[]>(env, TICKET_MODEL, "search_read", { domain: [["x_name", "=", ticket]], fields: ["id", "x_model", "x_res_id", "x_used", "create_date"], limit: 1, context: { active_test: false } });
  } catch (e) {
    console.error("[preview] the ticket could not be read", (e as Error)?.message);
    return messagePage(503, `${w.failed} الآن`, `Odoo لم يجب. ${w.again}`);
  }
  const model = String(row?.x_model || ""), resId = Number(row?.x_res_id) || 0;
  if (!row || !accepts(model, resId)) return messagePage(404, w.unknown, w.again);
  if (row.x_used) return messagePage(410, "هذا الرابط استُعمل", `${w.once} ${w.again}`);
  const age = now - odooMs(row.create_date);
  // a ticket from the future (beyond a clock's drift) is as dead as an old one
  if (!(age < TICKET_TTL_MS) || age < -60_000) return messagePage(410, "انتهت صلاحية الرابط", w.again);
  try {
    // burnt BEFORE the link is given: a ticket that cannot be burnt opens nothing
    await call<boolean>(env, TICKET_MODEL, "write", { ids: [row.id], vals: { x_used: true, x_active: false } });
  } catch (e) {
    console.error("[preview] the ticket could not be burnt", (e as Error)?.message);
    return messagePage(503, `${w.failed} الآن`, `Odoo لم يجب. ${w.again}`);
  }
  return { model, resId };
}

/** Step 1 — the ticket Odoo's button made: read back, burnt, and exchanged for the worker's signed link. */
export async function handlePreviewTicket(env: Env, ticket: string, now: number = Date.now()): Promise<Response> {
  if (!env.ADMIN_TOKEN) return messagePage(500, "تعذّرت المعاينة", "إعداد الخدمة ناقص.");
  const r = await redeemTicket(env, ticket, now, PREVIEW_WORDS, (model, resId) => !!PREVIEW_KINDS[model] && resId > 0);
  if (r instanceof Response) return r;
  const kind = PREVIEW_KINDS[r.model], id = r.resId;
  return new Response(null, { status: 302, headers: { Location: await previewLinkPath(env.ADMIN_TOKEN, kind, id, now + LINK_TTL_MS), "Cache-Control": "no-store" } });
}

export type PreviewBuilt = { pdf: Uint8Array; name: string } | { refused: string } | null;
/** The draft PDF of one record. Null when it is not there; { refused } with the reason it cannot be previewed. */
export async function buildPreviewPdf(env: Env, kind: PreviewKind, id: number, now: number = Date.now()): Promise<PreviewBuilt> {
  if (kind === "sq") {
    const { previewSpecialQuotation } = await import("./special-quotation");
    return previewSpecialQuotation(env, id, now);
  }
  const { buildQuotationPDFDataFromSaleOrder } = await import("./sale-order-quotation");
  const { generateQuotationPDF } = await import("./quotation");
  const { DRAFT_NUMBER } = await import("./special-quotation");
  // a sale order that is not there: Odoo's read throws (MissingError) — searched first, so it is simply not there
  const there = await call<Array<{ id: number }>>(env, "sale.order", "search_read", { domain: [["id", "=", id]], fields: ["id"], limit: 1 });
  if (!there.length) return null;
  const data = await buildQuotationPDFDataFromSaleOrder(env, id);
  if (!data) return null;
  if (data.has_blocking_issue) return { refused: (data.problems ?? []).join("\n") || "صنف بلا سعر" };
  // whatever the order's state: a preview is a draft (the order's own number is not printed, and no seal)
  return { pdf: await generateQuotationPDF({ ...data, quotationNumber: DRAFT_NUMBER, issued: false, draft: true }, env), name: data.quotationNumber };
}

/** Step 2 — the worker's own link: its signature and its expiry, then the draft itself. */
export async function handlePreviewDoc(env: Env, kind: PreviewKind, id: number, expiry: number, signature: string, now: number = Date.now()): Promise<Response> {
  if (!env.ADMIN_TOKEN) return notFound();
  if (!sameText(await previewSignature(env.ADMIN_TOKEN, kind, id, expiry), signature)) return notFound();
  if (!(expiry > now)) return messagePage(410, "انتهت صلاحية المعاينة", AGAIN);
  let built: PreviewBuilt;
  try {
    built = await buildPreviewPdf(env, kind, id, now);
  } catch (e) {
    console.error(`[preview] ${kind} ${id} failed`, (e as Error)?.message);
    return messagePage(500, "تعذّر بناء المعاينة", `${String((e as Error)?.message ?? e).slice(0, 200)}\n${AGAIN}`);
  }
  if (!built) return messagePage(404, "السجل غير موجود", "لم يُعثر على السجل الذي طُلبت معاينته.");
  if ("refused" in built) return messagePage(409, "لا معاينة بعد", `${built.refused}\nأكمل ما ينقص ثم اضغط «👁️ معاينة PDF» من جديد.`);
  const file = `draft-${built.name.replace(/[^A-Za-z0-9._-]/g, "") || "quotation"}.pdf`;
  return new Response(built.pdf.slice().buffer, {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}"`, "Content-Length": String(built.pdf.byteLength), "Cache-Control": "private, no-store" },
  });
}

/** GET /preview/… — the two steps above; anything else is not found. */
export async function handlePreview(env: Env, pathname: string, now: number = Date.now()): Promise<Response> {
  const rest = pathname.slice(PREVIEW_PREFIX.length);
  if (rest.startsWith("t/")) return handlePreviewTicket(env, rest.slice(2), now);
  const m = DOC.exec(rest);
  if (!m) return notFound();
  return handlePreviewDoc(env, m[1] as PreviewKind, Number(m[2]), Number(m[3]), m[4], now);
}
