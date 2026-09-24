// WA-SCENARIOS — important gaps, batch 2 (م5، م6، م7: the supplier path), 2026-09-25.
//
//   م5  a supplier still silent at 05:00 gets ONE reminder (utak_supplier_price_nudge),
//       and the owner one alert per still-silent supplier when the 21:15 list is built;
//   م6  a reply that is not readable as prices (free text, a bare number, voice,
//       image) → «وصلتنا …» + the owner alerted at once with the text; no guessed
//       price is ever saved (the price must be written in the message);
//   م7  the confirmation's buttons: «تعديل الأسعار» / «توقف اليوم» (noted + owner) /
//       «شكراً» (no reply) — none reaches the price extractor;
//   and an outlier price: saved, marked x_extraction_status=pending, owner alerted.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the real field lists (fields_get on the tenant:
// tests/fixtures-odoo-fields-20260924.json + tests/fixtures-odoo-fields-20260925-suppliers.json):
// an unknown field, or a selection value the field does not have, is answered
// the way Odoo answers it (HTTP 500). Claude is mocked and counted. No network,
// no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-important-b2.test.mts

import { readFileSync } from "node:fs";
import { ctx, graph, inbound, ownerAlerts, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const F1 = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20260924.json", import.meta.url), "utf8"));
const F2 = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20260925-suppliers.json", import.meta.url), "utf8"));
const REAL: Record<string, string[]> = { ...F1, ...F2 };
const SELECTIONS: Record<string, string[]> = { ...F1._selections, ...F2._selections };
// added on the tenant by scripts/wa-20260925-supplier-nudge-purpose.mjs (selection #4025)
SELECTIONS["x_whatsapp_template.x_purpose"] = [...SELECTIONS["x_whatsapp_template.x_purpose"], "supplier_price_nudge"];
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  // res.partner / product.template: the fixtures keep the custom fields and a few base ones.
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
let claudeCalls = 0;
let supplierExtract: { prices: unknown[]; unrecognized: string[] } = { prices: [], unrecognized: [] };
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    claudeCalls++;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(supplierExtract) }] }), { status: 200 });
  }
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
      const message = bad.length ? `Invalid field '${bad[0]}' on '${m[1]}'` : `Wrong value for ${badSel[0]}`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const { clearTemplateCache } = await import("../src/templates.ts");
const sup = await import("../src/suppliers.ts");
const worker = (await import("../src/index.ts")).default;

const SUP = 700, SUP_PHONE = "966500000700", SUP2 = 701, SUP2_PHONE = "966500000701";
/** reset() + two suppliers, today's 02:00 asks, the supplier templates. */
function fresh(riyadh = "2026-09-25 05:00"): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  claudeCalls = 0; supplierExtract = { prices: [], unrecognized: [] };
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: SUP, name: "أحمد حسان", supplier_rank: 1, x_whatsapp_number: "+" + SUP_PHONE, x_supplied_product_ids: [1, 2] });
  seed("res.partner", { id: SUP2, name: "مورد الخضار", supplier_rank: 1, x_whatsapp_number: "+" + SUP2_PHONE, x_supplied_product_ids: [1] });
  seed("x_whatsapp_template", { x_purpose: "supplier_confirm", x_meta_template_id: "utak_supplier_confirm_v1", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "supplier_price_nudge", x_meta_template_id: "utak_supplier_price_nudge", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  // 02:00 Riyadh today = 23:00 UTC yesterday
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: SUP, x_sent_at: "2026-09-24 23:00:05", x_status: "sent", x_replied_at: false });
  seed("x_supplier_price_request_log", { id: 901, x_supplier_id: SUP2, x_sent_at: "2026-09-24 23:00:06", x_status: "sent", x_replied_at: false });
  return env;
}
const tpl = (digits: string, name: string) => sentTo(digits).filter((b) => b?.template?.name === name);
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
const params = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const log = (id: number) => table("x_supplier_price_request_log").get(id)!;
const supplierArg = (id: number) => ({ ...table("res.partner").get(id)!, id } as any);
let ENV: any;
const reply = (text: string, id = SUP) => quiet(() => sup.handleSupplierReply(ENV, supplierArg(id), text, `wamid.S${Math.random()}`));

// ================================================================ م5
console.log("\n[م5] one reminder at 05:00, then one owner alert per silent supplier at 21:15");
{
  ENV = fresh("2026-09-25 05:00");
  const r = await quiet(() => sup.nudgeLateSuppliers(ENV));
  const n1 = tpl(SUP_PHONE, "utak_supplier_price_nudge");
  assert("new: silent supplier gets utak_supplier_price_nudge", n1.length === 1, JSON.stringify(graph.map((g) => g?.template?.name ?? g?.type)));
  assert("new: [supplier name, «6:00 صباحاً»]", params(n1[0]).join("|") === "أحمد حسان|6:00 صباحاً", JSON.stringify(params(n1[0])));
  assert("both silent suppliers reminded, each once", r.nudged === 2 && tpl(SUP2_PHONE, "utak_supplier_price_nudge").length === 1, JSON.stringify(r));
  await quiet(() => sup.nudgeLateSuppliers(ENV));
  setRiyadh("2026-09-25 10:00");
  await quiet(() => sup.nudgeLateSuppliers(ENV));
  assert("ONE reminder only: a second and a third run send nothing", tpl(SUP_PHONE, "utak_supplier_price_nudge").length === 1 && tpl(SUP2_PHONE, "utak_supplier_price_nudge").length === 1);
}
{
  ENV = fresh("2026-09-25 05:00");
  Object.assign(log(900), { x_replied_at: "2026-09-24 23:40:00", x_status: "replied" });
  Object.assign(log(901), { x_status: "no_reply" }); // the ask never reached him (ت13)
  seed("x_supplier_price_request_log", { id: 899, x_supplier_id: SUP, x_sent_at: "2026-09-23 23:00:05", x_status: "sent", x_replied_at: false }); // yesterday
  await quiet(() => sup.nudgeLateSuppliers(ENV));
  assert("no reminder to a supplier who replied, whose ask failed, or for yesterday's ask", tpl(SUP_PHONE, "utak_supplier_price_nudge").length === 0 && tpl(SUP2_PHONE, "utak_supplier_price_nudge").length === 0);
}
{
  ENV = fresh("2026-09-25 05:00");
  await quiet(() => worker.scheduled({ cron: "0 2 * * *" } as any, ENV, ctx));
  assert("wired: the 05:00 cron sends the reminder (old: nothing)", tpl(SUP_PHONE, "utak_supplier_price_nudge").length === 1);
  setRiyadh("2026-09-25 21:15");
  const before = ownerAlerts().length;
  await quiet(() => worker.scheduled({ cron: "15 18 * * *" } as any, ENV, ctx));
  const alerts = ownerAlerts().slice(before);
  assert("21:15: one owner alert PER silent supplier (not batched)", alerts.filter((a) => a.includes("لم يرسل أسعار اليوم")).length === 2, alerts.join("\n"));
  assert("the alert names the supplier, the ask time and the one reminder", alerts.some((a) => a.includes("أحمد حسان") && a.includes("02:00") && a.includes("ذُكّر مرة واحدة الساعة 05:00")), alerts.join("\n"));
  await quiet(() => sup.alertSuppliersWithoutPrices(ENV));
  assert("21:15 alert once per ask (a re-run adds none)", ownerAlerts().slice(before).filter((a) => a.includes("لم يرسل أسعار اليوم")).length === 2);
}
{
  ENV = fresh("2026-09-25 21:15");
  Object.assign(log(900), { x_replied_at: "2026-09-25 06:10:00", x_status: "parsed" });
  const r = await quiet(() => sup.alertSuppliersWithoutPrices(ENV));
  assert("a supplier who replied is not alerted", r.alerted === 1 && !ownerAlerts().some((a) => a.includes("أحمد حسان") && a.includes("لم يرسل")), JSON.stringify(r));
}
{
  // purpose unmapped: text only inside the 24h window
  ENV = fresh("2026-09-25 05:00");
  for (const [id, t] of [...table("x_whatsapp_template")]) if (t.x_purpose === "supplier_price_nudge") table("x_whatsapp_template").delete(id);
  clearTemplateCache();
  await ENV.MSG_DEDUP.put(`wa_inbox:last_in_ts:${SUP}`, String(Date.now() - 3600e3));
  await quiet(() => sup.nudgeLateSuppliers(ENV));
  assert("unmapped template: text inside the window", texts(SUP_PHONE).some((t) => t.includes("ما وصلتنا أسعارك")), JSON.stringify(texts(SUP_PHONE)));
  assert("unmapped template: nothing outside the window (no 131047)", sentTo(SUP2_PHONE).length === 0);
}

// ================================================================ م6
console.log("\n[م6] a reply that is not prices → «وصلتنا» + owner alert with the text; no guessed price");
for (const text of ["صباح الورد", "25", "الأسعار مثل أمس بس الطماطم نازلة شوي"]) {
  ENV = fresh("2026-09-25 06:00");
  supplierExtract = { prices: [], unrecognized: [] };
  const out = await reply(text);
  assert(`«${text}»: reply = «وصلتنا … والفريق بيراجعها»`, out === sup.SUPPLIER_ACK_TEXT, out);
  assert(`«${text}»: old «أرسل بصيغة…» gone`, !out.includes("بصيغة"));
  assert(`«${text}»: owner alerted with the text (even under 15 characters)`, ownerAlerts().some((a) => a.includes("ما فهمناه كأسعار") && a.includes(text)), ownerAlerts().join("\n"));
  assert(`«${text}»: no price saved`, rows("x_daily_price").length === 0);
  assert(`«${text}»: ask marked replied (no reminder, no 21:15 alert)`, !!log(900).x_replied_at && log(900).x_status === "replied");
}
{
  ENV = fresh("2026-09-25 06:00");
  // the model «reads» 30 for tomatoes and a product he does not supply; the message says 25
  supplierExtract = { prices: [
    { product_id: 1, packaging_id: 11, cost_price: 30 },
    { product_id: 99, packaging_id: 11, cost_price: 25 },
    { product_id: 2, packaging_id: 11, cost_price: 25 },
  ], unrecognized: [] };
  const out = await reply("طماطم 25");
  assert("guessed prices (number not written / not his product / wrong packaging): none saved", rows("x_daily_price").length === 0);
  assert("…treated as unreadable: «وصلتنا» + alert", out === sup.SUPPLIER_ACK_TEXT && ownerAlerts().some((a) => a.includes("مخمَّن")));
  const c = sup.checkExtractedPrices(supplierExtract.prices as any, [{ id: 1 }, { id: 2 }], [{ id: 11, product_id: 1 }, { id: 21, product_id: 2 }], "طماطم ٢٥ ريال، خيار 1,250");
  assert("pure: Arabic-Indic digits and thousands commas are read", sup.numbersInText("طماطم ٢٥ ريال، خيار 1,250").join("|") === "25|1250");
  assert("pure: reasons per dropped price", c.kept.length === 0 && c.dropped.map((d) => d.reason).join("|") === "السعر غير مكتوب في الرسالة|صنف لا يورّده|تعبئة لا تخص الصنف", JSON.stringify(c.dropped));
}
{
  ENV = fresh("2026-09-25 06:00");
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 25 }, { product_id: 2, packaging_id: 21, cost_price: 18 }], unrecognized: [] };
  const out = await reply("طماطم كرتون 25، خيار جرم 15");
  const saved = rows("x_daily_price");
  assert("mixed: the written price is saved, the unwritten one is not", saved.length === 1 && saved[0].x_price_sar === 25 && saved[0].x_extraction_status === "extracted", JSON.stringify(saved));
  assert("mixed: owner told what was left out", ownerAlerts().some((a) => a.includes("استُبعد 1") && a.includes("خيار")));
  assert("mixed: confirmation template, not the ack", out === "" && tpl(SUP_PHONE, "utak_supplier_confirm_v1").length === 1);
}
{
  ENV = fresh("2026-09-25 06:00");
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "audio", audio: { id: "A1", voice: true, mime_type: "audio/ogg" } })), ENV, ctx));
  assert("voice (webhook): the supplier gets «وصلتنا» (old: nothing)", texts(SUP_PHONE).includes(sup.SUPPLIER_ACK_TEXT), JSON.stringify(sentTo(SUP_PHONE)));
  assert("voice: owner alerted «رسالة صوتية من المورد»", ownerAlerts().some((a) => a.includes("رسالة صوتية") && a.includes("أحمد حسان")));
  assert("voice: no price, Claude never called", rows("x_daily_price").length === 0 && claudeCalls === 0);
  assert("voice: ask marked replied", !!log(900).x_replied_at);
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "image", image: { id: "I1", mime_type: "image/jpeg", caption: "أسعار اليوم" } })), ENV, ctx));
  assert("image with caption: alert carries the caption", ownerAlerts().some((a) => a.includes("صورة") && a.includes("أسعار اليوم")));
}

// ================================================================ outlier
console.log("\n[outlier] saved, marked for review, owner alerted; never refused");
{
  ENV = fresh("2026-09-25 06:00");
  seed("x_daily_price", { x_supplier_id: SUP, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-09-24", x_price_sar: 25, x_extraction_status: "extracted" });
  seed("x_daily_price", { x_supplier_id: SUP, x_product_tmpl_id: 2, x_packaging_id: 21, x_date: "2026-09-24", x_price_sar: 15, x_extraction_status: "extracted" });
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 60 }, { product_id: 2, packaging_id: 21, cost_price: 16 }], unrecognized: [] };
  await reply("طماطم كرتون 60، خيار جرم 16");
  const today = rows("x_daily_price").filter((r) => r.x_date !== "2026-09-24");
  const tom = today.find((r) => r.x_product_tmpl_id === 1), cuc = today.find((r) => r.x_product_tmpl_id === 2);
  assert("outlier 25 → 60: saved (not refused)", tom?.x_price_sar === 60, JSON.stringify(today));
  assert("outlier: marked x_extraction_status = pending", tom?.x_extraction_status === "pending");
  assert("normal 15 → 16: extracted, no flag", cuc?.x_extraction_status === "extracted");
  const oa = ownerAlerts().filter((a) => a.includes("سعر شاذ"));
  assert("owner alert: product, old and new price", oa.length === 1 && oa[0].includes("طماطم") && oa[0].includes("25") && oa[0].includes("60") && oa[0].includes("+140%"), oa.join("\n"));
  assert("pure: ±50% is the line, both ways", sup.isPriceOutlier(20, 30) && sup.isPriceOutlier(30, 20) && !sup.isPriceOutlier(20, 29) && !sup.isPriceOutlier(0, 10));
}
{
  ENV = fresh("2026-09-25 06:00");
  seed("x_daily_price", { x_supplier_id: SUP, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-09-24", x_price_sar: 25, x_extraction_status: "extracted" });
  seed("x_daily_price", { x_supplier_id: SUP, x_product_tmpl_id: 2, x_packaging_id: 21, x_date: "2026-09-24", x_price_sar: 15, x_extraction_status: "extracted" });
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 5 }, { product_id: 2, packaging_id: 21, cost_price: 40 }], unrecognized: [] };
  await reply("طماطم 5، خيار 40");
  assert("two outliers in one message → two separate alerts", ownerAlerts().filter((a) => a.includes("سعر شاذ")).length === 2);
  seed("x_daily_price", { x_supplier_id: SUP2, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-09-24", x_price_sar: 100, x_extraction_status: "extracted" });
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 26 }], unrecognized: [] };
  await reply("طماطم 26", SUP2);
  assert("compared with the SAME supplier's last price only", ownerAlerts().filter((a) => a.includes("سعر شاذ")).length === 3, ownerAlerts().filter((a) => a.includes("سعر شاذ")).join("\n"));
}

// ================================================================ م7
console.log("\n[م7] the confirmation's buttons never reach the price extractor");
{
  ENV = fresh("2026-09-25 06:00");
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 25 }], unrecognized: [] };
  await reply("طماطم كرتون 25");
  const conf = tpl(SUP_PHONE, "utak_supplier_confirm_v1").at(-1);
  const pl = (conf?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => `${c.index}:${c.parameters[0].payload}`);
  assert("confirmation carries the three payloads", pl.join("|") === "0:supplier_edit|1:supplier_stop|2:supplier_thanks", JSON.stringify(pl));
  const calls = claudeCalls;
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "button", button: { payload: "supplier_stop", text: "توقف اليوم" } })), ENV, ctx));
  assert("«توقف اليوم»: reply «سجّلنا توقفك اليوم»", texts(SUP_PHONE).includes(sup.SUPPLIER_STOP_TEXT), JSON.stringify(sentTo(SUP_PHONE)));
  assert("«توقف اليوم»: noted on the ask log", String(log(900).x_name).startsWith("توقف اليوم 06:00"), String(log(900).x_name));
  assert("«توقف اليوم»: owner alerted", ownerAlerts().filter((a) => a.includes("توقف اليوم") && a.includes("أحمد حسان")).length === 1);
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "button", button: { payload: "supplier_stop", text: "توقف اليوم" } })), ENV, ctx));
  assert("«توقف اليوم» twice: still one owner alert", ownerAlerts().filter((a) => a.includes("توقف اليوم") && a.includes("أحمد حسان")).length === 1);
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "button", button: { text: "تعديل الأسعار" } })), ENV, ctx));
  assert("«تعديل الأسعار» (old confirmation, no payload): «أرسل الأسعار المعدلة»", texts(SUP_PHONE).includes(sup.SUPPLIER_EDIT_TEXT));
  const before = sentTo(SUP_PHONE).length;
  await quiet(() => worker.fetch(signed(inbound(SUP_PHONE, { type: "button", button: { payload: "supplier_thanks", text: "شكراً" } })), ENV, ctx));
  assert("«شكراً»: no reply", sentTo(SUP_PHONE).length === before);
  assert("old path gone: no button reached Claude, no «أرسل بصيغة…»", claudeCalls === calls && !texts(SUP_PHONE).some((t) => t.includes("بصيغة")));
  assert("pure: a plain text is not a button", sup.supplierButtonAction({ type: "text", text: "توقف اليوم" }) === null);
}

// ================================================================ price date
console.log("\n[date] a price sent at 02:30 Riyadh is today's price for the 21:15 purchase list");
{
  ENV = fresh("2026-09-25 02:30"); // = 2026-09-24 23:30 UTC
  supplierExtract = { prices: [{ product_id: 1, packaging_id: 11, cost_price: 25 }], unrecognized: [] };
  await reply("طماطم كرتون 25");
  const p = rows("x_daily_price")[0];
  assert("x_date = the Riyadh day (old: the UTC day before)", p?.x_date === "2026-09-25", String(p?.x_date));
  const { prefillPurchasePrices } = await import("../src/odoo.ts");
  setRiyadh("2026-09-25 21:15");
  const pre = await quiet(() => prefillPurchasePrices(ENV, [{ product_id: 1, packaging_id: 11, product_name: "طماطم", packaging_name: "كرتون", total_qty: 3 } as any], "2026-09-25"));
  assert("the 21:15 list finds it: unit price 25 from this supplier", pre.items[0]?.unit_price === 25 && pre.items[0]?.price_supplier_id === SUP, JSON.stringify(pre.items[0]));
}

// ================================================================ owner alerts
console.log("\n[owner] alerts: session text inside the owner's 24h window (no #131049 cap), the template outside");
{
  const { sendOwnerAlert } = await import("../src/templates.ts");
  const OWNER_DIGITS = "966500000001";
  const ownerSends = () => sentTo(OWNER_DIGITS);
  ENV = fresh("2026-09-25 21:15");
  seed("res.partner", { id: 45, name: "براء", x_whatsapp_number: "+" + OWNER_DIGITS });
  await quiet(() => sendOwnerAlert(ENV, "تنبيه تجريبي خارج النافذة"));
  assert("outside the window: the utak_owner_alert template (as before)", ownerSends().at(-1)?.template?.name === "utak_owner_alert", JSON.stringify(ownerSends().at(-1)));
  await ENV.MSG_DEDUP.put("wa_inbox:last_in_ts:45", String(Date.now() - 2 * 3600e3));
  await quiet(() => sendOwnerAlert(ENV, "تنبيه تجريبي داخل النافذة\nسطر ثانٍ"));
  const last = ownerSends().at(-1);
  assert("inside the window: a session text, the whole alert kept (lines too)", last?.type === "text" && last?.text?.body === "تنبيه تجريبي داخل النافذة\nسطر ثانٍ", JSON.stringify(last));
  await quiet(() => sup.alertSuppliersWithoutPrices(ENV));
  assert("a batch-2 alert inside the window goes as text too", ownerSends().filter((b) => b?.type === "text" && String(b.text?.body).includes("لم يرسل أسعار اليوم")).length === 2);
}

// ================================================================ schema gate
console.log("\n[schema] every Odoo call named real fields and real selection values");
assert("no call rejected by the real-field gate", rejected.length === 0, rejected.join("\n"));

console.log(`\nwa-important-b2: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
