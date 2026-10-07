// § 62 د [د] (2026-10-07) — «👁️ معاينة PDF» (src/quote-preview.ts): a quotation's DRAFT in the browser.
//
//   Odoo's button makes a one-use ticket (a row of x_preview_ticket) and opens /preview/t/<ticket>; the worker
//   reads it back, burns it, and answers 302 to its own signed, short-lived link; the PDF is built there.
//
//   • a draft to the eye: «مسودة» across the page and in the number's place, no seal, no signature
//   • a draft to the books: nothing is numbered, no sale order is made or changed, no state moves, no message
//     is sent, no file is kept — the ticket's own row is the one thing written
//   • the ticket: once, for five minutes, for one record; the link: its signature, for fifteen minutes, for
//     that record; no fixed secret in the button, the action or the address
//   • «📄 أصدر عرض السعر» alone numbers, seals and sends (tests/s62-quotation.test.mts)
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62d-preview.test.mts

import { readFileSync } from "node:fs";
import { ctx, graph, odooLog, quiet, seed, setRiyadh, table } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { DAY, GARLIC, LETTUCE, MADARAT, ORANGE, lineOf, quote, r2, request, saleOrders, world } from "./s62-kit.mts";
import * as KIT from "./s62-kit.mts";

const PV = await import("../src/quote-preview.ts");
const QT = await import("../src/special-quotation.ts");
const SQ = await import("../src/special-quote.ts");
const LIB = await import("../scripts/lib/s62d-odoo.mjs");
const LIB62 = await import("../scripts/lib/s62-odoo.mjs");
const worker = (await import("../src/index.ts")).default;

const T1 = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", T2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", T3 = "ffffffff-0000-4000-8000-aaaaaaaaaaaa";
const NOW = Date.parse(`${DAY}T14:00:00+03:00`);
const odooAt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const ticket = (name: string, model: string, id: number, more: Record<string, unknown> = {}) => seed("x_preview_ticket", { x_name: name, x_model: model, x_res_id: id, x_used: false, create_date: odooAt(NOW - 3000), ...more });
const writesOf = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method) && l.model !== "x_wa_message" && !l.model.startsWith("discuss.") && l.model !== "mail.message");
const readsOf = () => odooLog.filter((l) => ["read", "search_read", "search"].includes(l.method));
const get = (env: any, path: string, now = NOW) => quiet(() => PV.handlePreview(env, path, now));
const pages: string[] = [];
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) for (const f of (init?.body as FormData).getAll("files") as File[]) if (f.name === "index.html") pages.push(await f.text());
  return kitFetch(input as any, init);
}) as typeof fetch;
/** A request priced line by line (three lines, a quantity of 1 each: a price list). */
function priced(extra: Record<string, unknown> = {}): number {
  return request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49, x_unit: "18 كيلو" }], [GARLIC, 1, { x_purchase_price: 10, x_final_price: 14.25 }], [LETTUCE, 1, { x_purchase_price: 5, x_final_price: 8 }]], extra);
}
const fresh = (): any => { const env = world(`${DAY} 14:00`); pages.length = 0; graph.length = 0; return env; };

// ============================================================================
console.log("\n[د1] the ticket, then the worker's own link, then the draft");
{
  const env = fresh();
  const id = priced();
  const before = JSON.stringify(quote(id)), linesBefore = JSON.stringify([lineOf(id, ORANGE), lineOf(id, GARLIC)]);
  const tid = ticket(T1, "x_special_quote", id);
  odooLog.length = 0;
  const hop = await get(env, `/preview/t/${T1}`);
  const where = hop.headers.get("Location") ?? "";
  const m = /^\/preview\/doc\/sq\/(\d+)\/(\d+)\/([a-f0-9]{16})\.pdf$/.exec(where);
  assert("the ticket of Odoo's button answers 302 to the worker's own link: the record, an expiry, a signature", hop.status === 302 && !!m && Number(m[1]) === id && hop.headers.get("Cache-Control") === "no-store", where);
  assert("the link is good for fifteen minutes, signed for THIS kind, record and expiry under the worker's secret", !!m && Number(m[2]) === NOW + PV.LINK_TTL_MS && PV.LINK_TTL_MS === 15 * 60_000 && m[3] === await PV.previewSignature("ADM", "sq", id, NOW + PV.LINK_TTL_MS));
  assert("the ticket is burnt before the link is given (its own row is the one thing written)", table("x_preview_ticket").get(tid)!.x_used === true && writesOf().length === 1 && writesOf()[0].model === "x_preview_ticket" && JSON.stringify(writesOf()[0].body.vals) === '{"x_used":true}');
  assert("no secret travels: the address of the link holds no token of the worker or of the hook", !where.includes("ADM") && !where.includes("HOOK") && !/token=/.test(where));
  assert("nothing was built on the first step", KIT.gotenberg === 0 && pages.length === 0);

  odooLog.length = 0;
  const doc = await get(env, where);
  const bytes = new Uint8Array(await doc.arrayBuffer());
  assert("the link answers the PDF itself, to read in the browser and to save (inline, a file name, never cached)", doc.status === 200 && doc.headers.get("Content-Type") === "application/pdf" && doc.headers.get("Content-Disposition") === `inline; filename="draft-${SQ.quoteName(id)}.pdf"` && doc.headers.get("Cache-Control") === "private, no-store" && bytes.length === 4 && bytes[0] === 0x25 && KIT.gotenberg === 1);
  const html = pages[0] ?? "";
  assert("a draft to the eye: «مسودة» across the page, in the number's place and under it", html.includes('data-utak="draft-mark"') && />مسودة<\/div>/.test(html.slice(html.indexOf('data-utak="draft-mark"'))) && html.includes(`>${QT.DRAFT_NUMBER}</span>`) && html.includes("مسودة — غير معتمدة") && QT.DRAFT_NUMBER === "مسودة");
  assert("…the mark is large and plain to see (150 px, not the 4 % brand mark)", /font-size: 150px;[^"]*opacity: 0\.16;/.test(html.slice(html.indexOf('data-utak="draft-mark"'))));
  assert("…no seal and no signature", !html.includes('data-utak="stamp"') && !html.includes('data-utak="signature"') && !html.includes('data-utak="seal-signature"'));
  assert("…and no number of an order anywhere on it", !/S0\d{4}/.test(html) && !html.includes(SQ.quoteName(id)));
  assert("it is the page that would be issued: the customer, the three lines at their prices, unit prices (every quantity 1)", html.includes("شركة مدارات للاغذية") && html.includes('data-utak="unit-prices"') && html.includes("139.49") && html.includes("14.25") && html.includes("8.00"));
  assert("a draft to the books: NOTHING is written by the PDF's step (no number, no sale order, no state, no «آخر نتيجة»)", writesOf().length === 0 && JSON.stringify(quote(id)) === before && JSON.stringify([lineOf(id, ORANGE), lineOf(id, GARLIC)]) === linesBefore && saleOrders().length === 0);
  assert("…the request is as it was: «مسودة», no number, no order, no link, no result line", quote(id).x_state === "draft" && !quote(id).x_quotation_number && !quote(id).x_sale_order_id && !quote(id).x_pdf_url && !quote(id).x_last_result && !quote(id).x_issued_at);
  assert("no message to anyone, and no file kept", graph.length === 0 && r2.length === 0);
  assert("the link opens again while it lasts (a reload, a download) — still nothing written", (await get(env, where, NOW + 14 * 60_000)).status === 200 && writesOf().length === 0 && saleOrders().length === 0);
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ============================================================================
console.log("\n[د2] the ticket opens once, for a moment, for one record");
{
  const env = fresh();
  const id = priced();
  ticket(T1, "x_special_quote", id);
  const first = await get(env, `/preview/t/${T1}`);
  odooLog.length = 0;
  const second = await get(env, `/preview/t/${T1}`);
  assert("a second use of the same ticket: 410, no link, nothing written", first.status === 302 && second.status === 410 && !second.headers.get("Location") && writesOf().length === 0 && (await second.text()).includes("يفتح مرة واحدة"));
  const old = ticket(T2, "x_special_quote", id, { create_date: odooAt(NOW - PV.TICKET_TTL_MS - 1000) });
  const stale = await get(env, `/preview/t/${T2}`);
  assert("a ticket older than five minutes: 410, no link, and it is not burnt", stale.status === 410 && !stale.headers.get("Location") && table("x_preview_ticket").get(old)!.x_used === false && PV.TICKET_TTL_MS === 5 * 60_000);
  table("x_preview_ticket").get(old)!.create_date = odooAt(NOW - PV.TICKET_TTL_MS + 5000);
  assert("…one a few seconds younger still opens", (await get(env, `/preview/t/${T2}`)).status === 302);
  ticket(T3, "x_special_quote", id, { create_date: odooAt(NOW + 10 * 60_000) });
  assert("a ticket dated in the future is as dead as an old one", (await get(env, `/preview/t/${T3}`)).status === 410);
  table("x_preview_ticket").clear();
  odooLog.length = 0;
  assert("a ticket Odoo does not hold: 404", (await get(env, `/preview/t/${T1}`)).status === 404 && readsOf().length === 1);
  odooLog.length = 0;
  const bad = await Promise.all(["/preview/t/1", "/preview/t/", `/preview/t/${T1}x`, `/preview/t/${T1.toUpperCase()}`, "/preview/t/' OR 1=1", "/preview/", "/preview/x", `/preview/doc/sq/1/${NOW + 1000}/zzzz.pdf`, "/preview/doc/xx/1/17000000000000/0123456789abcdef.pdf"].map((p) => get(env, p)));
  assert("anything that is not a ticket's shape or a link's shape: 404 without asking Odoo anything", bad.every((r) => r.status === 404) && odooLog.length === 0);
  ticket(T1, "res.partner", MADARAT);
  ticket(T2, "x_special_quote", 0);
  assert("a ticket for a model that has no preview, or for no record: 404, and no link", (await get(env, `/preview/t/${T1}`)).status === 404 && (await get(env, `/preview/t/${T2}`)).status === 404);
  assert("the kinds a ticket may name are the two screens that carry the button", JSON.stringify(PV.PREVIEW_KINDS) === '{"x_special_quote":"sq","sale.order":"so"}' && PV.TICKET_MODEL === LIB.TICKET_MODEL);
  // Odoo down while the ticket is read, or while it is burnt: nothing opens
  table("x_preview_ticket").clear();
  const tid = ticket(T1, "x_special_quote", id);
  const realFetch = globalThis.fetch;
  let failOn = "search_read";
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes(`/json/2/x_preview_ticket/${failOn}`)) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no" }), { status: 403 });
    return realFetch(input as any, init);
  }) as typeof fetch;
  const down = await get(env, `/preview/t/${T1}`);
  failOn = "write";
  const unburnt = await get(env, `/preview/t/${T1}`);
  globalThis.fetch = realFetch;
  assert("the ticket cannot be read: 503 and no link", down.status === 503 && !down.headers.get("Location"));
  assert("the ticket cannot be burnt: 503 and NO link (a ticket that stays alive opens nothing)", unburnt.status === 503 && !unburnt.headers.get("Location") && table("x_preview_ticket").get(tid)!.x_used === false);
  const noSecret = await get({ ...env, ADMIN_TOKEN: "" }, `/preview/t/${T1}`);
  assert("a worker with no secret signs nothing: no link, and the ticket is left alive", noSecret.status === 500 && !noSecret.headers.get("Location") && table("x_preview_ticket").get(tid)!.x_used === false);
}

// ============================================================================
console.log("\n[د3] the link: its signature, its record, its fifteen minutes");
{
  const env = fresh();
  const id = priced(), other = priced();
  const exp = NOW + PV.LINK_TTL_MS;
  const good = await PV.previewLinkPath("ADM", "sq", id, exp);
  const sig = /([a-f0-9]{16})\.pdf$/.exec(good)![1];
  odooLog.length = 0;
  const tries: Array<[string, string]> = [
    ["another record under the same signature", `/preview/doc/sq/${other}/${exp}/${sig}.pdf`],
    ["a later expiry under the same signature", `/preview/doc/sq/${id}/${exp + 3600_000}/${sig}.pdf`],
    ["the other kind under the same signature", `/preview/doc/so/${id}/${exp}/${sig}.pdf`],
    ["a signature of another secret", await PV.previewLinkPath("OTHER", "sq", id, exp)],
    ["a signature one character off", good.replace(`${sig}.pdf`, `${sig.slice(0, 15)}${sig[15] === "0" ? "1" : "0"}.pdf`)],
  ];
  for (const [name, path] of tries) assert(`${name}: 404`, (await get(env, path)).status === 404);
  assert("…none of them asked Odoo or the PDF service anything", odooLog.length === 0 && KIT.gotenberg === 0);
  const late = await get(env, good, exp + 1);
  assert("the link past its fifteen minutes: 410, nothing built — press the button again", late.status === 410 && KIT.gotenberg === 0 && odooLog.length === 0 && (await late.text()).includes("«👁️ معاينة PDF»"));
  assert("…a moment before: the PDF", (await get(env, good, exp - 1)).status === 200 && KIT.gotenberg === 1);
  assert("a worker with no secret serves nothing", (await get({ ...env, ADMIN_TOKEN: "" }, good)).status === 404);
  assert("the signature is not the document tokens' (a quotation's public link signs its number alone)", sig !== await (await import("../src/pdf-template.ts")).signDocToken("ADM", String(id)));
}

// ============================================================================
console.log("\n[د4] what cannot be issued cannot be previewed — and says why");
{
  const env = fresh();
  const id = request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49 }], [GARLIC, 1, { x_purchase_price: 10 }], [LETTUCE, 0, { x_purchase_price: 5, x_final_price: 8 }]]);
  const path = await PV.previewLinkPath("ADM", "sq", id, NOW + 60_000);
  odooLog.length = 0;
  const r = await get(env, path);
  const page = await r.text();
  assert("a line with no final price: 409 with its name, no PDF", r.status === 409 && page.includes("أسطر بلا سعر نهائي: ثوم") && r.headers.get("Content-Type") === "text/html; charset=utf-8" && KIT.gotenberg === 0);
  assert("…nothing written, nothing sent", writesOf().length === 0 && graph.length === 0 && saleOrders().length === 0);
  Object.assign(lineOf(id, GARLIC), { x_final_price: 14.25 });
  assert("then a line with a price and no quantity is named", (await (await get(env, path)).text()).includes("أسطر بلا كمية: خس أمريكي"));
  const none = request([]);
  assert("a request with no lines: 409", (await get(env, await PV.previewLinkPath("ADM", "sq", none, NOW + 60_000))).status === 409);
  assert("a request that is not there: 404", (await get(env, await PV.previewLinkPath("ADM", "sq", 987654, NOW + 60_000))).status === 404);
  // «قبل الضريبة»: the preview reads the typed price and follows it, without saving what a save would
  const net = request([[ORANGE, 1, { x_purchase_price: 100, x_final_net: 121.25 }]], { x_price_mode: "net" });
  pages.length = 0; odooLog.length = 0;
  const ok = await get(env, await PV.previewLinkPath("ADM", "sq", net, NOW + 60_000));
  assert("a request in «قبل الضريبة» not yet recalculated: its typed 121.25 and 139.44 with VAT on the draft — and still not written on the line", ok.status === 200 && pages[0].includes("121.25") && pages[0].includes("139.44") && pages[0].includes("18.19") && !lineOf(net, ORANGE).x_final_price && writesOf().length === 0);
  assert("a closed request can still be looked at; a request flagged «محاكاة» too (a draft reaches nobody)", await quiet(async () => {
    const a = priced({ x_state: "closed" }), b = priced({ x_utak_simulation: true });
    return (await PV.handlePreview(env, await PV.previewLinkPath("ADM", "sq", a, NOW + 60_000), NOW)).status === 200 && (await PV.handlePreview(env, await PV.previewLinkPath("ADM", "sq", b, NOW + 60_000), NOW)).status === 200 && quote(a).x_state === "closed";
  }));
  // the PDF service down
  KIT.pdfDown.on = true;
  const broken = await get(env, await PV.previewLinkPath("ADM", "sq", priced(), NOW + 60_000));
  KIT.pdfDown.on = false;
  assert("the PDF service down: 500 with a page to read, nothing written", broken.status === 500 && (await broken.text()).includes("تعذّر بناء المعاينة") && saleOrders().length === 0);
}

// ============================================================================
console.log("\n[د5] the sale order's «👁️ معاينة PDF»");
{
  const env = fresh();
  const line = (lid: number, name: string, price: number) => { const sub = Math.round((price / 1.15) * 100) / 100; return seed("sale.order.line", { id: lid, order_id: 15, display_type: false, product_id: false, name, product_uom_qty: 1, price_unit: price, price_total: price, price_subtotal: sub, price_tax: price - sub, discount: 0, product_uom_id: [31, "كرتون"], x_price_unit_manual: 0, x_packaging_id: false, x_item_origin: false, x_item_size: false }); };
  seed("sale.order", { id: 15, name: "S00015", partner_id: [MADARAT, "شركة مدارات للاغذية"], date_order: "2026-10-07 09:00:00", create_date: "2026-10-07 09:00:00", order_line: [line(901, "برتقال (افريقي) 18 كيلو", 115), line(902, "تفاح احمر ", 152)], state: "sale", amount_untaxed: 232.17, amount_tax: 34.83, amount_total: 267 });
  const before = JSON.stringify(table("sale.order").get(15));
  ticket(T1, "sale.order", 15);
  odooLog.length = 0;
  const hop = await get(env, `/preview/t/${T1}`);
  const where = hop.headers.get("Location") ?? "";
  assert("its ticket answers the worker's link for the sale order", hop.status === 302 && new RegExp(`^/preview/doc/so/15/${NOW + PV.LINK_TTL_MS}/[a-f0-9]{16}\\.pdf$`).test(where), where);
  const doc = await get(env, where);
  const html = pages[0] ?? "";
  assert("the PDF, named by the order for the file alone", doc.status === 200 && doc.headers.get("Content-Disposition") === 'inline; filename="draft-S00015.pdf"');
  assert("a draft whatever the order's state (a confirmed order too): «مسودة» in the number's place — the order's number is not printed — and no seal", html.includes('data-utak="draft-mark"') && html.includes(`>${QT.DRAFT_NUMBER}</span>`) && !html.includes("S00015") && !html.includes('data-utak="stamp"') && !html.includes('data-utak="signature"'));
  assert("the order's lines as its quotation prints them (unit prices: 100.00 · 15.00 · 115.00)", html.includes("برتقال (افريقي) 18 كيلو") && html.includes("100.00") && html.includes("115.00") && html.includes('data-utak="unit-prices"'));
  assert("the order is not touched: the ticket's row is the one write of the whole press", JSON.stringify(table("sale.order").get(15)) === before && writesOf().length === 1 && writesOf()[0].model === "x_preview_ticket" && saleOrders().length === 1 && graph.length === 0 && r2.length === 0 && table("x_wa_message").size === 0);
  // an order that cannot be quoted says why; one that is not there is not found
  seed("sale.order", { id: 16, name: "S00016", partner_id: [MADARAT, "شركة مدارات للاغذية"], date_order: "2026-10-07 09:00:00", create_date: "2026-10-07 09:00:00", order_line: [seed("sale.order.line", { id: 903, order_id: 16, display_type: false, product_id: false, name: false, product_uom_qty: 1, price_unit: 10, price_total: 10, price_subtotal: 8.7, price_tax: 1.3, discount: 0, product_uom_id: false, x_price_unit_manual: 0, x_packaging_id: false })], state: "draft", amount_untaxed: 8.7, amount_tax: 1.3, amount_total: 10 });
  const refused = await get(env, await PV.previewLinkPath("ADM", "so", 16, NOW + 60_000));
  assert("a line with no product and no description: 409, in the builder's words", refused.status === 409 && (await refused.text()).includes("السطر 1 بلا منتج ولا وصف"));
  assert("an order that is not there: 404", (await get(env, await PV.previewLinkPath("ADM", "so", 4242, NOW + 60_000))).status === 404);
}

// ============================================================================
console.log("\n[د6] the worker's route, the old button, and Odoo's side");
{
  const env = fresh();
  setRiyadh(`${DAY} 14:00`);
  const id = priced();
  ticket(T1, "x_special_quote", id);
  const viaRoute = await quiet(() => worker.fetch(new Request(`https://w.test/preview/t/${T1}`), env, ctx));
  const where = viaRoute.headers.get("Location") ?? "";
  assert("GET /preview/t/<ticket> on the worker: the 302 to its link, then the PDF", viaRoute.status === 302 && /^\/preview\/doc\/sq\/\d+\/\d+\/[a-f0-9]{16}\.pdf$/.test(where) && (await quiet(() => worker.fetch(new Request(`https://w.test${where}`), env, ctx))).headers.get("Content-Type") === "application/pdf");
  assert("…POST is not the preview's (nothing else answers on it)", (await quiet(() => worker.fetch(new Request(`https://w.test/preview/t/${T1}`, { method: "POST" }), env, ctx))).status !== 302);
  // the old «⬇️ PDF لي فقط»: a screen still open on it issues nothing
  const old = await quiet(() => SQ.handleSpecialQuoteHook(env, id, "pdf"));
  assert("the old button's op issues nothing and says where the preview is", old.action === "moved" && saleOrders().length === 0 && !quote(id).x_quotation_number && String(quote(id).x_last_result).startsWith(SQ.PDF_MOVED_TEXT) && graph.length === 0);
  assert("«📄 أصدر عرض السعر» alone numbers and sends", (await quiet(() => SQ.handleSpecialQuoteHook(env, id, "issue"))).action === "issued" && saleOrders().length === 1 && !!quote(id).x_quotation_number && quote(id).x_state === "quoted");

  // Odoo's side (scripts/lib/s62d-odoo.mjs)
  for (const [key, model] of [["quote", "x_special_quote"], ["sale", "sale.order"]] as Array<[string, string]>) {
    const code: string = LIB.PREVIEW_ACTIONS[key].code;
    assert(`Odoo's action on ${model}: a random ticket from the database, kept as a row for THIS record, then the worker's /preview/t/<ticket> in a new tab`, LIB.PREVIEW_ACTIONS[key].model === model && code.includes('env.cr.execute("SELECT gen_random_uuid()::text")') && code.includes(`env['x_preview_ticket'].create({'x_name': ticket, 'x_model': '${model}', 'x_res_id': record.id})`) && code.includes(`'url': 'https://${LIB.PROD_HOST}/preview/t/' + ticket`) && code.includes("'target': 'new'") && code.includes("'type': 'ir.actions.act_url'"));
    assert(`…no fixed secret in it (no token, nothing after the ticket), and it writes nothing on the ${model} itself`, !/token|secret|ADMIN|HOOK/i.test(code) && !code.includes("record.write") && !code.includes(".write("));
  }
  const ids = { send: 1, accept: 2, recalc: 3, issue: 4, pdf: 5, close: 6, reopen: 7, preview: 8 };
  const arch: string = LIB.formArch(ids);
  assert("the special request's form: «👁️ معاينة PDF» on the code action, in the place of «⬇️ PDF لي فقط»", arch.includes('<button name="8" type="action" string="👁️ معاينة PDF"/>') && !arch.includes("PDF لي فقط") && !arch.includes('name="5"') && LIB62.formArch(ids).includes('<button name="5" type="action" string="⬇️ PDF لي فقط"'));
  assert("…«📄 أصدر عرض السعر» is as it was (its confirmation too), and «شكل العرض» sits under «الأسعار في العرض»", arch.includes('<button name="4" type="action" string="📄 أصدر عرض السعر" invisible="x_state == \'closed\'" confirm="يصدر عرض السعر بالأسعار النهائية ويُرسل ملفه للعميل. متأكد؟"/>') && arch.includes('<field name="x_price_mode" required="1"/>\n        <field name="x_layout" placeholder="تلقائي"/>'));
  const shown = [...arch.split('<page string="الأصناف"')[1].split("</page>")[0].matchAll(/<field name="(x_[a-z_]+)"([^>]*)\/>/g)].filter((m) => !/optional="hide"|widget="handle"/.test(m[2])).map((m) => m[1]);
  assert("…its lines: § 62's columns with «المنشأ», «المقاس» and «المقترح قبل الضريبة»", JSON.stringify(shown) === JSON.stringify(LIB.LINE_COLUMNS) && LIB.ACTION_CONTEXT.includes("'default_x_layout': 'auto'"), shown.join());
  const ext: string = LIB.saleExtArch(9);
  assert("the sale order's form: «👁️ معاينة PDF» in its header, after «العبوة» the two columns", ext.includes('<button name="9" string="👁️ معاينة PDF" type="action" class="btn-secondary"/>') && ext.includes(`//list[@name='sol_list']/field[@name='x_packaging_id']`) && LIB.SALE_EXT_PRIORITY > 40);
  assert("the worker reads every field the tenant got, and the ticket's three", ["x_layout"].every((f) => readFileSync(new URL("../src/special-quote.ts", import.meta.url), "utf8").includes(`"${f}"`)) && LIB.TICKET_FIELDS.map((f: any) => f.name).join() === "x_model,x_res_id,x_used");
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

globalThis.fetch = kitFetch;
done();
