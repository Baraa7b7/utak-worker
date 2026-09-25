// The single WhatsApp send gateway — 2026-09-25 (STATUS § 33).
//
//   [0] static: nothing in src/ POSTs to Graph's /messages outside
//       src/wa-gateway.ts, fetchMeta is gone, and every literal purpose in a
//       send is a known purpose (src/wa-purposes.ts).
//   [1] the window decision: open → the content; closed → a UTILITY template;
//       closed, none → held (row «held», Discuss line, one alert per purpose,
//       number and day for an important one); a template needs no window.
//   [2] the window: 10-minute margin; a message Meta stamped >24h ago (late
//       re-delivery) opens nothing and flushes nothing.
//   [3] the queue: flushed on the number's next inbound, oldest first, before
//       the reply; the expired dropped (row «expired»), never twice, the same
//       message held once; the */5 sweep drops what nobody collected.
//   [4] categories: an operational purpose never uses a MARKETING template;
//       marketing purposes may, never to an opted-out number.
//   [5] Baraa's alerts: never utak_owner_alert (MARKETING); held outside his
//       window, delivered at his tap.
//   [6] Meta's refusals: 131047 closes the window and re-queues (twice at
//       most); 131049 stops that template to that number today; anything else
//       stops the purpose to that number for 24h; a status delivered twice is
//       handled once; every refusal is an x_wa_message row with its reason;
//       no send loop.
//   [7] the allowlist runs first (a refused number is never held); manual
//       sends from Odoo / Discuss are held too; unknown purpose refused.
//   [8] schema: every Odoo write names real fields and real selection values.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-gateway.test.mts

import { readdirSync, readFileSync } from "node:fs";
import {
  CUST, CUST_PHONE, CUST2, OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, openWindow, ownerAlerts, quiet, reset,
  rows, seed, sentTo, setRiyadh, signed, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = ["./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-review.json", "./fixtures-odoo-fields-20260925-gateway.json"].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if (model === "res.partner" && !f.startsWith("x_")) return true;
  return list.includes(f);
}

// ---------------------------------------------------------------- Graph refusals on demand
/** Next Graph sends to `to` (optionally of `type`) answered with Meta error `code`. */
const metaFail: Array<{ to: string; type?: string; code: number; times: number }> = [];
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
    const b = JSON.parse(init.body);
    const writes: Array<Record<string, unknown>> = [b.vals ?? {}, ...((b.vals_list ?? []) as Array<Record<string, unknown>>)];
    const names = [
      ...((b.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0])),
      ...(b.fields ?? []),
      ...writes.flatMap((v) => Object.keys(v)),
    ];
    const bad = names.filter((f: string) => !known(m[1], f));
    const badSel = writes.flatMap((v) => Object.entries(v))
      .filter(([k, val]) => SELECTIONS[`${m[1]}.${k}`] && val !== false && !SELECTIONS[`${m[1]}.${k}`].includes(String(val)))
      .map(([k, val]) => `${k}=${val}`);
    if (bad.length || badSel.length) {
      rejected.push(`${m[1]}.${m[2]}: ${[...bad, ...badSel].join(",")}`);
      return new Response(JSON.stringify({ name: "builtins.ValueError", message: "Invalid" }), { status: 500 });
    }
  }
  if (url.includes("graph.facebook.com") && url.endsWith("/messages")) {
    const body = JSON.parse(init.body);
    const i = metaFail.findIndex((f) => f.to === body.to && (!f.type || f.type === body.type));
    if (i >= 0) {
      graph.push(body);
      const f = metaFail[i];
      if (--f.times <= 0) metaFail.splice(i, 1);
      return new Response(JSON.stringify({ error: { message: `(#${f.code}) refused`, code: f.code } }), { status: 400 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const gw = await import("../src/wa-gateway.ts");
const { sendViaGateway, gatewayDecision, flushHeld, sweepExpiredHeld } = gw;
const { sendText, textContent } = await import("../src/meta.ts");
const { sendOwnerAlert, sendTemplateByPurpose, clearTemplateCache } = await import("../src/templates.ts");
const { PURPOSES, categoryAllowed, expiryFor } = await import("../src/wa-purposes.ts");
const { readWindow, noteInbound } = await import("../src/wa-window.ts");
const { handleWaMessageWebhook } = await import("../src/wa-message-send.ts");
const worker = (await import("../src/index.ts")).default;

const BOT = 42;
function fresh(riyadh: string): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  metaFail.length = 0; rejected.length = 0;
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  // a channel for the customer, so held / sent lines are visible
  seed("discuss.channel", { id: 70, name: `واتساب · مطعم الوادي`, x_wa_partner_id: CUST });
  table("res.partner").get(CUST)!.x_wa_channel_id = 70;
  // the two templates the customer tests use, with Meta's real categories
  seed("x_whatsapp_template", { x_purpose: "customer_feedback", x_meta_template_id: "utak_feedback", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "MARKETING" });
  seed("x_whatsapp_template", { x_purpose: "customer_inactive", x_meta_template_id: "utak_v2_inactive", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "MARKETING" });
  return env;
}
const txt = (to: string) => sentTo(to).filter((b) => b.type === "text").map((b) => String(b.text?.body ?? ""));
const tplTo = (to: string, name?: string) => sentTo(to).filter((b) => b.type === "template" && (!name || b.template?.name === name));
const waRows = (status?: string) => rows("x_wa_message").filter((r) => !status || r.x_status === status);
const say = (from: string, at: string, text: string, extra: Record<string, unknown> = {}) => {
  setRiyadh(at);
  return quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text }, ...extra })), ENV, ctx));
};
const secondsAgo = (h: number) => String(Math.floor(Date.now() / 1000) - h * 3600);
let ENV: any;

// ================================================================ 0. static
console.log("\n[0] one gateway: nothing else POSTs to Graph's /messages; purposes are known");
{
  const SRC = new URL("../src/", import.meta.url);
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code: Record<string, string> = Object.fromEntries(files.map((f) => [f, strip(readFileSync(new URL(f, SRC), "utf8"))]));
  const messagesEndpoint = /graph\.facebook\.com[^`"'\n]*\/messages[`"']/;
  const offenders = files.filter((f) => f !== "wa-gateway.ts" && messagesEndpoint.test(code[f]));
  assert("only src/wa-gateway.ts builds the Graph /messages URL", offenders.length === 0 && messagesEndpoint.test(code["wa-gateway.ts"]), offenders.join(","));
  const graphUsers = files.filter((f) => /graph\.facebook\.com/.test(code[f])).sort();
  assert("other Graph calls are reads or the media upload only (inbox media GET, template list GET, /media POST)",
    graphUsers.join(",") === "wa-gateway.ts,wa-inbox.ts,wa-message-send.ts,wa-template-sync.ts", graphUsers.join(","));
  assert("wa-message-send.ts: its Graph URL is /media (upload), not /messages", /\/media`/.test(code["wa-message-send.ts"]) && !/\/messages`/.test(code["wa-message-send.ts"]));
  const fetchMetaUsers = files.filter((f) => /\bfetchMeta\b/.test(code[f]));
  assert("fetchMeta is gone from src/", fetchMetaUsers.length === 0, fetchMetaUsers.join(","));
  const realSend = files.filter((f) => f !== "wa-gateway.ts" && /\bmetaRealSend\b|\bdispatchToMeta\b/.test(code[f]));
  assert("the one POST (dispatchToMeta / metaRealSend) is private to the gateway", realSend.length === 0, realSend.join(","));
  const reqType = code["wa-gateway.ts"].split("export interface GatewayRequest {")[1]?.split("\n}")[0] ?? "";
  assert("GatewayRequest: purpose, to and content are required (tsc enforces them at every call)",
    /\n\s+purpose: string;/.test(reqType) && /\n\s+to: string;/.test(reqType) && /\n\s+content: GwOption;/.test(reqType), reqType.slice(0, 200));
  // every literal purpose passed to a send is a known purpose
  const literal = new Set<string>();
  for (const f of files) for (const m of code[f].matchAll(/\bpurpose:\s*"([a-z_]+)"/g)) literal.add(m[1]);
  const unknown = [...literal].filter((p) => !PURPOSES[p]);
  assert("every literal purpose: in src/wa-purposes.ts", unknown.length === 0, unknown.join(","));
  const { T } = await import("../src/templates.ts");
  const tUnknown = Object.values(T).filter((p) => !PURPOSES[p as string]);
  assert("every T.* template purpose: in src/wa-purposes.ts", tUnknown.length === 0, tUnknown.join(","));
  const cfg = await import("../src/config.ts");
  const tmpl = [cfg.TMPL_SUPPLIER_ASK, cfg.TMPL_SUPPLIER_CONFIRM, cfg.TMPL_SUPPLIER_PRICE_NUDGE].filter((p) => !PURPOSES[p]);
  assert("supplier purposes: known", tmpl.length === 0, tmpl.join(","));
  assert("every purpose has a label, a kind, a ttl", Object.values(PURPOSES).every((p) => p.label && p.kind && p.ttl));
  assert("exactly two marketing purposes (reactivation, feedback)", Object.entries(PURPOSES).filter(([, p]) => p.kind === "marketing").map(([k]) => k).sort().join() === "customer_feedback,customer_inactive");
  // the wrappers' purpose is required at compile time
  assert("SendOpts.purpose is required (not optional)", /purpose: string;/.test(code["meta.ts"]) && !/purpose\?: string;/.test(code["meta.ts"].split("export interface SendOpts")[1]?.split("}")[0] ?? ""));
}

// ================================================================ 1. the window decision
console.log("\n[1] open → the content; closed → UTILITY template; closed, none → held");
{
  ENV = fresh("2026-09-26 10:00");
  openWindow(ENV, CUST_PHONE, 30);
  const r1 = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "مرحبا", { purpose: "bot_reply" }));
  assert("open: the session text goes", gatewayDecision(r1)?.action === "session" && txt(CUST_PHONE).includes("مرحبا"));
  assert("open: logged «sent»", waRows("sent").some((r) => r.x_body === "مرحبا"));

  ENV = fresh("2026-09-26 10:00");
  // closed + a UTILITY template for the purpose (customer_order_update, harness)
  const r2 = await quiet(() => sendViaGateway(ENV, {
    purpose: "customer_order_update", to: CUST_PHONE,
    content: textContent("طلبك رقم #5 أُلغي"),
    fallback: [{ kind: "template", purpose: "customer_order_update", params: ["#5", "أُلغي"] }],
  }));
  const d2 = gatewayDecision(r2);
  assert("closed + UTILITY template: the template goes", d2?.action === "template" && tplTo(CUST_PHONE, "utak_order_update").length === 1, JSON.stringify(d2));
  assert("closed + template: no text", txt(CUST_PHONE).length === 0);

  ENV = fresh("2026-09-26 10:00");
  const r3 = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "إيصال الدفع: …", { purpose: "customer_receipt" }));
  const d3 = gatewayDecision(r3);
  assert("closed, no template: held (202, nothing to Graph)", d3?.action === "held" && r3.status === 202 && sentTo(CUST_PHONE).length === 0, JSON.stringify(d3));
  const q = heldFor(ENV, CUST_PHONE);
  assert("…one item in the number's queue, with the purpose's expiry (end of the Riyadh day)",
    q.length === 1 && q[0].purpose === "customer_receipt" && q[0].expiresAt === Date.parse("2026-09-27T00:00:00+03:00"), JSON.stringify(q));
  assert("…an x_wa_message row «held»", waRows("held").length === 1 && String(waRows("held")[0].x_body).includes("إيصال الدفع"));
  const heldPosts = (await import("./wa-harness.mts")).odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post" && String(l.body?.body ?? "").includes("⏳ محفوظة"));
  assert("…a «⏳ محفوظة» line in his Discuss channel", heldPosts.length === 1 && heldPosts[0].body.ids[0] === 70);
  const alerts1 = ownerAlerts().filter((a) => a.includes("إيصال الدفع") && a.includes("محفوظة"));
  assert("…important purpose: Baraa told once", alerts1.length === 1, ownerAlerts().join("\n"));
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "إيصال الدفع: ثانٍ", { purpose: "customer_receipt" }));
  assert("a second one, same purpose + number + day: held, no second alert", heldFor(ENV, CUST_PHONE).length === 2 && ownerAlerts().filter((a) => a.includes("إيصال الدفع")).length === 1);
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "تم استلام الدفعة", { purpose: "customer_payment_ack" }));
  assert("not important: held, no alert", heldFor(ENV, CUST_PHONE).length === 3 && !ownerAlerts().some((a) => a.includes("تأكيد استلام الدفعة")));
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "إيصال الدفع: …", { purpose: "customer_receipt" }));
  assert("the same message again: held once (no duplicate in the queue)", heldFor(ENV, CUST_PHONE).length === 3);

  // a template needs no window
  ENV = fresh("2026-09-26 10:00");
  const r4 = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_delivery_done", ["9"]));
  assert("template content, window closed: sent", gatewayDecision(r4)?.action === "template" && tplTo(CUST_PHONE, "utak_delivered").length === 1);
  // template only, not approved → skipped + row + alert (important)
  table("x_whatsapp_template").forEach((t) => { if (t.x_purpose === "collection_summary") t.x_meta_status = "PENDING"; });
  clearTemplateCache();
  const r5 = await quiet(() => sendTemplateByPurpose(ENV, "+966500000602", "collection_summary", ["a", "b", "c", "d"]));
  assert("template only, not APPROVED: skipped (409), nothing to Graph", gatewayDecision(r5)?.action === "skipped" && r5.status === 409 && sentTo("966500000602").length === 0);
  assert("…row «skipped» with the reason", waRows("skipped").some((r) => String(r.x_meta_error).includes("PENDING")));
  assert("…Baraa told (important)", ownerAlerts().some((a) => a.includes("ملخص التحصيل") && a.includes("لم تُرسل")));
}

// ================================================================ 2. the window
console.log("\n[2] 10-minute margin; a message older than 24h by Meta's clock opens nothing");
{
  ENV = fresh("2026-09-26 10:00");
  openWindow(ENV, CUST_PHONE, 24 * 60 - 15); // 23h45m ago
  const a = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "قبل الحد", { purpose: "bot_reply" }));
  assert("23h45m after his message: open — sent", gatewayDecision(a)?.action === "session");
  openWindow(ENV, CUST_PHONE, 24 * 60 - 5); // 23h55m ago
  const b = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "بعد الحد", { purpose: "bot_reply" }));
  assert("23h55m: inside Meta's 24h but past the margin — held", gatewayDecision(b)?.action === "held");

  // the late re-delivery (§ 29): 71 hours old by Meta's timestamp
  ENV = fresh("2026-09-26 10:00");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "رسالة محفوظة", { purpose: "customer_payment_ack" }));
  await say(CUST_PHONE, "2026-09-26 10:05", "صباح الورد", { timestamp: secondsAgo(71) });
  assert("late inbound (71h): the window stays closed", (await readWindow(ENV, CUST_PHONE)).open === false);
  assert("…and the held message stays held (no flush, nothing sent)", heldFor(ENV, CUST_PHONE).length === 1 && txt(CUST_PHONE).length === 0, JSON.stringify(txt(CUST_PHONE)));
  // a button tap opens it (Meta's timestamp of the tap)
  setRiyadh("2026-09-26 10:10");
  await quiet(() => worker.fetch(signed(inbound(CUST_PHONE, { type: "interactive", interactive: { button_reply: { id: "noop_x", title: "تمام" } } })), ENV, ctx));
  assert("a button tap opens it and flushes the queue", txt(CUST_PHONE).includes("رسالة محفوظة") && heldFor(ENV, CUST_PHONE).length === 0, JSON.stringify(txt(CUST_PHONE)));
}

// ================================================================ 3. the queue
console.log("\n[3] flushed on the next inbound, oldest first, before the reply; expired dropped; no duplicates");
{
  ENV = fresh("2026-09-26 08:00");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "بوت قديم", { purpose: "bot_reply" }));        // expires 10:00 (2h)
  setRiyadh("2026-09-26 09:00");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "الأولى", { purpose: "customer_payment_ack" }));
  setRiyadh("2026-09-26 09:30");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "الثانية", { purpose: "customer_receipt" }));
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "الثانية", { purpose: "customer_receipt" }));  // duplicate
  assert("three distinct held (the duplicate held once)", heldFor(ENV, CUST_PHONE).length === 3);
  const heldRows = waRows("held").map((r) => r.id);
  await say(CUST_PHONE, "2026-09-26 11:00", "مرحبا");
  const t = txt(CUST_PHONE);
  const i1 = t.indexOf("الأولى"), i2 = t.indexOf("الثانية");
  assert("flush: the two valid ones, oldest first", i1 === 0 && i2 === 1, JSON.stringify(t));
  assert("flush: before the bot's reply to «مرحبا»", t.length >= 3 && i2 < t.length - 1, JSON.stringify(t));
  assert("the expired one (2h bot reply, 08:00) not sent", !t.includes("بوت قديم"));
  const exp = waRows("expired");
  assert("…its row marked «expired» with the reason", exp.length === 1 && String(exp[0].x_body) === "بوت قديم" && String(exp[0].x_meta_error).includes("انتهت صلاحيتها"), JSON.stringify(exp));
  assert("the sent ones: their held rows became «sent» with the wamid (no second row)",
    heldRows.filter((id) => table("x_wa_message").get(id)!.x_status === "sent" && String(table("x_wa_message").get(id)!.x_meta_message_id).startsWith("wamid.")).length === 2);
  assert("queue emptied", heldFor(ENV, CUST_PHONE).length === 0);
  const n = sentTo(CUST_PHONE).length;
  await say(CUST_PHONE, "2026-09-26 11:05", "تمام");
  assert("the next inbound sends nothing held again", !txt(CUST_PHONE).slice(n).some((x) => x === "الأولى" || x === "الثانية"));
  // a flush racing another flush: the per-item mark stops a second send
  ENV = fresh("2026-09-26 08:00");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "مرة واحدة", { purpose: "customer_payment_ack" }));
  const q = heldFor(ENV, CUST_PHONE);
  openWindow(ENV, CUST_PHONE);
  const w = await readWindow(ENV, CUST_PHONE);
  await quiet(() => flushHeld(ENV, CUST_PHONE, w));
  ENV.MSG_DEDUP.store.set(`wa_q:v1:${CUST_PHONE}`, JSON.stringify(q)); // the same item, as a racing reader saw it
  await quiet(() => flushHeld(ENV, CUST_PHONE, w));
  assert("two racing flushes: sent once", txt(CUST_PHONE).filter((x) => x === "مرة واحدة").length === 1);
  // the sweep: nobody wrote back
  ENV = fresh("2026-09-26 20:00");
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "لن يراسل", { purpose: "customer_payment_ack" }));
  setRiyadh("2026-09-27 00:05");
  const sw = await quiet(() => sweepExpiredHeld(ENV));
  assert("the */5 sweep: the expired item dropped and logged «expired»", sw.expired === 1 && heldFor(ENV, CUST_PHONE).length === 0 && waRows("expired").length === 1, JSON.stringify(sw));
  setRiyadh("2026-09-27 09:00");
  await say(CUST_PHONE, "2026-09-27 09:00", "صباح الخير");
  assert("…and never sent later", !txt(CUST_PHONE).includes("لن يراسل"));
  assert("expiry by purpose: day / 2h bot reply / 36h owner alert / 21:00 order reminder",
    expiryFor("customer_receipt", Date.parse("2026-09-26T10:00:00+03:00")) === Date.parse("2026-09-27T00:00:00+03:00")
    && expiryFor("bot_reply", 0) === 2 * 3600e3 && expiryFor("owner_alert", 0) === 36 * 3600e3
    && expiryFor("customer_order_remind", Date.parse("2026-09-26T20:00:00+03:00")) === Date.parse("2026-09-26T21:00:00+03:00"));
}

// ================================================================ 4. categories
console.log("\n[4] no MARKETING template for an operational purpose; marketing only for marketing, never to an opted-out number");
{
  assert("UTILITY: any purpose", categoryAllowed("customer_invoice", "UTILITY") && categoryAllowed("customer_feedback", "UTILITY"));
  assert("MARKETING: not for operational / reply", !categoryAllowed("customer_invoice", "MARKETING") && !categoryAllowed("owner_alert", "MARKETING") && !categoryAllowed("bot_reply", "MARKETING"));
  assert("MARKETING: for reactivation and feedback", categoryAllowed("customer_inactive", "MARKETING") && categoryAllowed("customer_feedback", "MARKETING"));
  assert("unknown / AUTHENTICATION category: never", !categoryAllowed("customer_invoice", "AUTHENTICATION") && !categoryAllowed("customer_invoice", false));
  ENV = fresh("2026-09-26 10:00");
  // an operational purpose mapped to a MARKETING template (the legacy utak_delivery_done)
  table("x_whatsapp_template").forEach((t) => { if (t.x_purpose === "customer_delivery_done") { t.x_meta_template_id = "utak_delivery_done"; t.x_category = "MARKETING"; } });
  clearTemplateCache();
  const r = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_delivery_done", ["x"], [], undefined,
    { fallback: [textContent("تم توصيل طلبك")] }));
  assert("operational + MARKETING template: the template is not sent", tplTo(CUST_PHONE).length === 0);
  assert("…outside the window the text is held instead", gatewayDecision(r)?.action === "held");
  const r2 = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_inactive", ["مطعم"]));
  assert("reactivation (marketing) + MARKETING template: sent", gatewayDecision(r2)?.action === "template" && tplTo(CUST_PHONE, "utak_v2_inactive").length === 1);
  table("res.partner").get(CUST)!.x_wa_marketing_optout = true;
  const r3 = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_feedback", ["مطعم"]));
  assert("opted out («إيقاف», § 23): the marketing template is not sent", gatewayDecision(r3)?.action === "skipped" && tplTo(CUST_PHONE, "utak_feedback").length === 0);
}

// ================================================================ 5. Baraa
console.log("\n[5] Baraa's alerts: never utak_owner_alert; held outside his window, delivered at his tap");
{
  ENV = fresh("2026-09-26 02:30");
  closeOwnerWindow(ENV);
  await quiet(() => sendOwnerAlert(ENV, "⏰ عمر لم يسجّل حضوره"));
  await quiet(() => sendOwnerAlert(ENV, "❌ عمر سُجّل غائباً"));
  assert("outside his window: nothing sent at all", sentTo(OWNER).length === 0);
  assert("…utak_owner_alert (MARKETING) never used", !graph.some((b) => b?.template?.name === "utak_owner_alert"));
  const q = heldFor(ENV, OWNER);
  assert("…both held, oldest first, alive 36h", q.length === 2 && q[0].body.text.body.includes("لم يسجّل") && q[1].expiresAt - q[1].createdAt === 36 * 3600e3);
  assert("…no alert about alerts (owner is never «important»)", waRows("held").length === 2);
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: "shift_start", text: "بدء الدوام" } })), ENV, ctx));
  const t = txt(OWNER);
  assert("his tap: both alerts, then «✅ تم»", t.length === 3 && t[0].includes("لم يسجّل") && t[1].includes("غائباً") && t[2].startsWith("✅ تم"), JSON.stringify(t));
  await quiet(() => sendOwnerAlert(ENV, "تنبيه داخل النافذة"));
  assert("inside his window: text at once", txt(OWNER).at(-1) === "تنبيه داخل النافذة");
}

// ================================================================ 6. Meta's refusals
console.log("\n[6] 131047 / 131049 / other — each recorded, none retried in a loop");
{
  // 131047 in the send response: the window we believed open was not
  ENV = fresh("2026-09-26 10:00");
  openWindow(ENV, CUST_PHONE, 60);
  metaFail.push({ to: CUST_PHONE, type: "text", code: 131047, times: 1 });
  const r = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "نص قد يُرفض", { purpose: "customer_payment_ack" }));
  assert("131047: the send is reported refused", gatewayDecision(r)?.action === "rejected" && !r.ok);
  assert("…the window is marked closed at once", (await readWindow(ENV, CUST_PHONE)).open === false && (await readWindow(ENV, CUST_PHONE)).closedByMeta);
  const q = heldFor(ENV, CUST_PHONE);
  assert("…the message is back in the queue (attempt 1)", q.length === 1 && q[0].attempts === 1 && q[0].body.text.body === "نص قد يُرفض");
  assert("…its row says why (131047 + back in the queue)", waRows("held").some((w) => String(w.x_meta_error).includes("131047") && String(w.x_meta_error).includes("أُعيدت")));
  const calls = sentTo(CUST_PHONE).length;
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "نص آخر", { purpose: "customer_payment_ack" }));
  assert("the next text to him is held without calling Meta", sentTo(CUST_PHONE).length === calls && heldFor(ENV, CUST_PHONE).length === 2);
  // he writes → flushed; Meta refuses again → dropped, not re-queued: the loop ends
  metaFail.push({ to: CUST_PHONE, type: "text", code: 131047, times: 99 });
  await say(CUST_PHONE, "2026-09-26 10:30", "هلا");
  const afterFlush = heldFor(ENV, CUST_PHONE);
  // (the bot's reply to «هلا» waits too: Meta just closed the window again)
  assert("refused twice: dropped (attempt cap), the rest waits — no loop",
    afterFlush.every((i: any) => i.body.text.body !== "نص قد يُرفض") && afterFlush.some((i: any) => i.body.text.body === "نص آخر"),
    JSON.stringify(afterFlush.map((i: any) => [i.body.text.body, i.attempts])));
  for (let k = 0; k < 3; k++) await say(CUST_PHONE, `2026-09-26 10:3${k + 1}`, "هلا");
  const refusedCalls = graph.filter((b) => b.to === CUST_PHONE && b.text?.body === "نص قد يُرفض").length;
  assert("the same message reached Meta twice in all (never a third time)", refusedCalls === 2, String(refusedCalls));
  metaFail.length = 0;

  // 131047 from the status webhook (async), delivered twice
  ENV = fresh("2026-09-26 10:00");
  openWindow(ENV, CUST_PHONE, 60);
  const ok = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "قُبلت ثم فشلت", { purpose: "customer_payment_ack" }));
  const wamid = (await ok.clone().json()).messages[0].id;
  const status = () => worker.fetch(signed({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: "failed", recipient_id: CUST_PHONE, errors: [{ code: 131047, message: "Re-engagement message" }] }] } }] }] }), ENV, ctx);
  await quiet(status);
  assert("async 131047: window closed, message back in the queue", (await readWindow(ENV, CUST_PHONE)).open === false && heldFor(ENV, CUST_PHONE).length === 1);
  const rowsAfter1 = waRows().length;
  const alerts1 = ownerAlerts().length;
  const { readRecentSendFailures } = await import("../src/send-failure.ts");
  const { odooLog } = await import("./wa-harness.mts");
  const failLines = () => odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post" && String(l.body?.body ?? "").includes("ما انرسلت")).length;
  const count1 = (await readRecentSendFailures(ENV, 1))[0].count;
  const lines1 = failLines();
  await quiet(status); // Meta delivers the same status again (§ 33 analysis: #2030 / #2114 / #2130)
  assert("the same status again: handled once (no second queue item, row, alert)", heldFor(ENV, CUST_PHONE).length === 1 && waRows().length === rowsAfter1 && ownerAlerts().length === alerts1);
  assert("…no second «⚠️ ما انرسلت» line and no second count on /health",
    failLines() === lines1 && lines1 === 1 && (await readRecentSendFailures(ENV, 1))[0].count === count1, `${lines1}→${failLines()} ${count1}`);

  // 131049 on a template: not that template to that number again today
  ENV = fresh("2026-09-26 08:00");
  metaFail.push({ to: CUST_PHONE, type: "template", code: 131049, times: 1 });
  const r1 = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_inactive", ["مطعم"]));
  assert("131049: refused, recorded", gatewayDecision(r1)?.action === "rejected" && waRows("failed").some((w) => String(w.x_meta_error).includes("131049")));
  const before = tplTo(CUST_PHONE).length;
  const r2 = await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_inactive", ["مطعم"]));
  assert("…the same template to the same number the same day: not sent", tplTo(CUST_PHONE).length === before && gatewayDecision(r2)?.action === "skipped");
  await quiet(() => sendTemplateByPurpose(ENV, "+" + "966500000502", "customer_inactive", ["نخيل"]));
  assert("…another number: sent", tplTo("966500000502", "utak_v2_inactive").length === 1);
  setRiyadh("2026-09-27 08:00");
  await quiet(() => sendTemplateByPurpose(ENV, "+" + CUST_PHONE, "customer_inactive", ["مطعم"]));
  assert("…the next day: sent again", tplTo(CUST_PHONE, "utak_v2_inactive").length === before + 1);

  // any other refusal: not that purpose to that number for 24h
  ENV = fresh("2026-09-26 18:00");
  metaFail.push({ to: "966500000602", type: "template", code: 132018, times: 1 });
  await quiet(() => sendTemplateByPurpose(ENV, "+966500000602", "collection_summary", ["a", "b", "c", "d"], [], undefined, { fallback: [textContent("القائمة نصاً")] }));
  assert("132018: the template refused, no text after it (one attempt)", sentTo("966500000602").length === 1 && txt("966500000602").length === 0);
  const blocked = await quiet(() => sendTemplateByPurpose(ENV, "+966500000602", "collection_summary", ["a", "b", "c", "d"]));
  assert("…the same purpose to the same number within 24h: blocked (409), Meta not called", blocked.status === 409 && sentTo("966500000602").length === 1);
  const other = await quiet(() => sendTemplateByPurpose(ENV, "+966500000602", "collection_request", ["x", "y", "z", "1"]));
  assert("…another purpose to that number: sent", gatewayDecision(other)?.action === "template");
  setRiyadh("2026-09-27 18:01");
  ENV.MSG_DEDUP.store.delete(`wa_blk_p:v1:966500000602:collection_summary`); // the harness KV has no TTL; 24h have passed
  const later = await quiet(() => sendTemplateByPurpose(ENV, "+966500000602", "collection_summary", ["a", "b", "c", "d"]));
  assert("…after 24h: sent", gatewayDecision(later)?.action === "template");
  assert("every refusal is an x_wa_message row with its reason", waRows("failed").every((w) => /Meta|code/.test(String(w.x_meta_error))));
  // a bot reply answers a new message: one refused reply does not silence the bot for the day
  ENV = fresh("2026-09-26 11:00");
  openWindow(ENV, CUST_PHONE, 5);
  metaFail.push({ to: CUST_PHONE, type: "text", code: 131026, times: 1 });
  await quiet(() => sendText(ENV, "+" + CUST_PHONE, "رد أول", { purpose: "bot_reply" }));
  const next = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "رد ثانٍ", { purpose: "bot_reply" }));
  assert("a refused bot reply (131026) does not block the next reply", gatewayDecision(next)?.action === "session");
  assert("…but it is recorded", waRows("failed").some((w) => String(w.x_meta_error).includes("131026")));
}

// ================================================================ 7. allowlist first, manual sends, unknown purpose
console.log("\n[7] the allowlist first; manual sends held too; unknown purpose refused");
{
  ENV = fresh("2026-09-26 10:00");
  ENV.SIM_ALLOWLIST = "+966500000601";
  const r = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "خارج القائمة", { purpose: "customer_payment_ack" }));
  assert("not allowed: refused 403 before any window decision", r.status === 403 && gatewayDecision(r)?.action === "refused");
  assert("…never held (no queue, no row)", heldFor(ENV, CUST_PHONE).length === 0 && waRows("held").length === 0);

  ENV = fresh("2026-09-26 10:00");
  const wa = seed("x_wa_message", { x_status: "queued", x_partner_id: CUST, x_kind: "text", x_body: "رسالة من Odoo", x_manual: true, x_dry_run: false, x_direction: "out" });
  const res = await quiet(() => handleWaMessageWebhook(ENV, wa, ctx));
  assert("x_wa_message text outside the window: «held» on its own row, nothing sent", res.final_status === "held" && table("x_wa_message").get(wa)!.x_status === "held" && sentTo(CUST_PHONE).length === 0, JSON.stringify(res));
  await say(CUST_PHONE, "2026-09-26 10:20", "السلام عليكم");
  assert("…sent at his next message; the same row turns «sent» with the wamid", txt(CUST_PHONE)[0] === "رسالة من Odoo" && table("x_wa_message").get(wa)!.x_status === "sent" && String(table("x_wa_message").get(wa)!.x_meta_message_id).startsWith("wamid."));
  assert("…no automation-triggering «queued» written by the gateway", !waRows("queued").length);

  ENV = fresh("2026-09-26 10:00");
  const rr = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "ردّي من الصندوق", { purpose: "inbox_reply" }));
  assert("Discuss reply outside the window: held (was refused with «انتهت نافذة 24 ساعة»)", gatewayDecision(rr)?.action === "held" && heldFor(ENV, CUST_PHONE)[0]?.expiresAt - Date.now() === 48 * 3600e3);

  const u = await quiet(() => sendText(ENV, "+" + CUST_PHONE, "x", { purpose: "no_such_purpose" }));
  assert("unknown purpose: refused (400), nothing sent or held", u.status === 400 && heldFor(ENV, CUST_PHONE).length === 1);
}

// ================================================================ 8. schema
console.log("\n[8] every Odoo call named real fields and real selection values");
assert("no call rejected by the real-field gate", rejected.length === 0, rejected.join("\n"));
assert("x_status values the gateway writes exist on the tenant", ["held", "expired", "skipped", "sent", "failed"].every((v) => SELECTIONS["x_wa_message.x_status"].includes(v)));
assert("«queued» is never the gateway's (automation 7 sends every queued row)", !readFileSync(new URL("../src/wa-gateway.ts", import.meta.url), "utf8").includes('x_status: "queued"'));
void noteInbound; void CUST2;

console.log(`\nwa-gateway: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
