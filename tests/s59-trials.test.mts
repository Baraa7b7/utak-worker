// § 59 ز (2026-10-06) — the five trials of § 59 to Baraa's own number.
//
// Each: his number alone, «🧪 تجربة», inside his window only, once a day; nothing written in Odoo.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s59-trials.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, graph, heldFor, odooLog, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { C1_PHONE, DAY, DRIVER_PHONE, assert, cost, done, fresh, rejected } from "./s46-kit.mts";

const kitFetch = globalThis.fetch;
let gotenberg = 0;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) { gotenberg++; return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 }); }
  return kitFetch(input as any, init);
}) as typeof fetch;

const TRIALS = await import("../src/s59-trials.ts");
const OF = await import("../src/order-form.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendText } = await import("../src/meta.ts");
const worker = (await import("../src/index.ts")).default;

const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const writes = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method) && l.model !== "x_wa_message" && !l.model.startsWith("discuss.") && l.model !== "mail.message");
const r2: string[] = [];

function world(riyadh = `${DAY} 10:00`, list: "published" | "none" = "published"): any {
  const env = fresh(riyadh); cost(500);
  Object.assign(env, { UTAK_WA_NUMBER: "+966580000467", GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p", ADMIN_TOKEN: "ADM", ODOO_HOOK_TOKEN: "HOOK",
    INVOICES_BUCKET: { put: async (k: string) => { r2.push(k); return {}; }, head: async () => null, get: async () => null } });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: "315022736600003" });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 6;
  const d = seed("x_price_day", { x_date: DAY, x_state: list === "published" ? "published" : "missed", x_name: `أسعار ${DAY}`, x_utak_simulation: false, ...(list === "published" ? { x_published_at: utc(`${DAY} 06:00`) } : {}) });
  const line = (seq: number, p: number, k: number, v: Record<string, unknown>) => seed("x_price_day_line", { x_day_id: d, x_sequence: seq, x_product_tmpl_id: p, x_packaging_id: k, x_blocked: false, x_utak_simulation: false, x_manual_price: 0, ...v });
  line(1, 1, 11, { x_cost_price: 15.55, x_market_price: 31, x_sale_price: list === "published" ? 31 : 0, x_suggested_price: 22.5, x_status: list === "published" ? "auto" : "exception", x_excluded: false });
  line(2, 2, 21, { x_cost_price: 14.44, x_market_price: 28.5, x_sale_price: list === "published" ? 28.5 : 0, x_suggested_price: 19.5, x_status: list === "published" ? "auto" : "exception", x_excluded: false });
  gotenberg = 0; r2.length = 0; odooLog.length = 0;
  return env;
}
const post = (env: any, name: string, token = "HOOK") => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/s59-trial?name=${name}&token=${token}`, { method: "POST" }), env, ctx));

console.log("\n[ز] the trials are Baraa's alone");
{
  assert("five names", JSON.stringify(TRIALS.S59_TRIAL_NAMES) === JSON.stringify(["prices", "form", "unavailable", "quotation", "shift"]));
  assert("their purposes are the gateway's, an hour long", [TRIALS.TEAM_PRICES_TEST_PURPOSE, TRIALS.QUOTATION_FILE_TEST_PURPOSE, TRIALS.SHIFT_START_TEST_PURPOSE].every((p) => PURPOSES[p]?.kind === "operational" && JSON.stringify(PURPOSES[p]?.ttl) === JSON.stringify({ hours: 1 })));
  const env = world();
  for (const p of [TRIALS.TEAM_PRICES_TEST_PURPOSE, TRIALS.QUOTATION_FILE_TEST_PURPOSE, TRIALS.SHIFT_START_TEST_PURPOSE]) {
    const leak = await quiet(() => sendText(env, "+" + C1_PHONE, "x", { purpose: p }));
    const own = await quiet(() => sendText(env, "+" + OWNER, "x", { purpose: p }));
    assert(`«${p}»: refused for any other number (403), sent to Baraa's`, leak.status === 403 && own.ok, `${leak.status} / ${own.status}`);
  }
  assert("an unknown name is no trial", (await TRIALS.sendS59Trial(env, "xyz")).reason === "unknown_trial");
}

console.log("\n[ز1] the marketing member's price list, as he gets it");
{
  let env = world();
  let r = await quiet(() => TRIALS.sendTeamPricesTest(env));
  let t = textsTo(OWNER);
  assert("two messages to Baraa: the trial's line, then the list itself as Omar gets it", r.sent && r.example === false && r.items === 2 && t.length === 2 && t[0].startsWith("🧪 تجربة — هكذا تصل عمر قائمة الأسعار مع كل نشر") && t[0].includes("بأسعار القائمة الصالحة الآن") && t[0].endsWith(TRIALS.S59_TRIAL_TAIL), t.join("\n---\n"));
  assert("…the list: its title, the two published items at their sale prices, the validity, the link", t[1].startsWith("📋 قائمة أسعار يو تاك اليوم — ") && t[1].includes("• طماطم (كرتون): 31 ر.س") && t[1].includes("• خيار (جرم): 28.50 ر.س") && t[1].includes("صالحة حتى 6:00 صباح بكرة.") && t[1].includes("https://wa.me/966580000467?text="), t[1]);
  assert("…no purchase or suggested price in it, and it is the forwardable text itself (no trial mark inside it)", !/15\.55|14\.44|22\.5|19\.5/.test(t.join("")) && !t[1].includes("🧪"));
  assert("…nothing to Omar or to a customer, nothing written in Odoo", sentTo(DRIVER_PHONE).length === 0 && sentTo(C1_PHONE).length === 0 && writes().length === 0, JSON.stringify(writes().map((w) => `${w.model}.${w.method}`)));
  assert("once a day", (await quiet(() => TRIALS.sendTeamPricesTest(env))).reason === "already_today" && textsTo(OWNER).length === 2);
  // his window closed: nothing, nothing held, and the day is not spent
  env = world(); closeOwnerWindow(env);
  r = await quiet(() => TRIALS.sendTeamPricesTest(env));
  assert("his window closed: not sent, nothing held, the day's turn kept", r.sent === false && r.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0);
  // no valid list: the last day's lines as an example that says so
  env = world(`${DAY} 10:00`, "none");
  r = await quiet(() => TRIALS.sendTeamPricesTest(env));
  t = textsTo(OWNER);
  assert("no valid list: the last day's lines as an EXAMPLE, and the line says so", r.sent && r.example === true && t[0].includes("بأسعار آخر يوم كمثال: لا قائمة صالحة الآن") && t[1].includes("• طماطم (كرتون): "), t.join("\n---\n"));
}

console.log("\n[ز2 + ز3] the order form's message, and «غير متوفر اليوم»");
{
  const env = world();
  const f = await quiet(() => TRIALS.sendS59Trial(env, "form"));
  let flows = flowsTo(OWNER);
  assert("form: ONE form to Baraa, marked, its message naming the available items and their prices", f.sent && flows.length === 1 && bodyOf(flows[0]).startsWith("🧪 تجربة — ") && bodyOf(flows[0]).includes("\n\nالمتوفر اليوم:\n• طماطم (كرتون): 31 ر.س\n• خيار (جرم): 28.50 ر.س"), bodyOf(flows[0]));
  const u = await quiet(() => TRIALS.sendS59Trial(env, "unavailable"));
  flows = flowsTo(OWNER);
  assert("unavailable: a trial of its own the same day — «🧪 تجربة — هذا الصنف غير متوفر اليوم 🌿», an empty line, «المتوفر اليوم:» and the form", u.sent && flows.length === 2 && bodyOf(flows[1]).startsWith(`🧪 تجربة — ${OF.UNAVAILABLE_TEXT}\n\nالمتوفر اليوم:\n• طماطم (كرتون): 31 ر.س`), bodyOf(flows[1]));
  assert("each once a day", (await quiet(() => TRIALS.sendS59Trial(env, "form"))).reason === "already_today" && (await quiet(() => TRIALS.sendS59Trial(env, "unavailable"))).reason === "already_today" && flowsTo(OWNER).length === 2);
  assert("no order, no line", rows("x_daily_order").length === 0 && rows("x_daily_order_line").length === 0);
}

console.log("\n[ز4] a quotation's PDF as an attached file");
{
  const env = world();
  const r = await quiet(() => TRIALS.sendQuotationFileTest(env));
  const got = sentTo(OWNER);
  const doc = got[0]?.document;
  assert("ONE message to Baraa: a document, named UTAK-Q-TRIAL-<day>.pdf", r.sent && r.number === "UTAK-Q-TRIAL-20261003" && got.length === 1 && got[0].type === "document" && doc.filename === "UTAK-Q-TRIAL-20261003.pdf" && /^https:\/\/w\.test\/quotation-pdf\/UTAK-Q-TRIAL-20261003\//.test(doc.link), JSON.stringify(got).slice(0, 400));
  assert("…its caption: the trial's line, the number, the total of one carton each (59.5), and that nothing was written — no link", doc.caption.startsWith("🧪 تجربة — هكذا يصل العميل عرض السعر: ملف PDF مرفق باسمه (UTAK-Q-TRIAL-20261003.pdf)، لا رابط.") && doc.caption.includes("الإجمالي: 59.5 ر.س") && doc.caption.endsWith(TRIALS.S59_TRIAL_TAIL) && !/https?:\/\//.test(doc.caption), doc.caption);
  assert("…the PDF was made and archived under the trial's own number; no quotation record, no order, nothing written", gotenberg === 1 && r2.join() === "quotations/UTAK-Q-TRIAL-20261003.pdf" && rows("x_quotation").length === 0 && rows("x_daily_order").length === 0 && writes().length === 0, JSON.stringify(writes().map((w) => `${w.model}.${w.method}`)));
  assert("once a day", (await quiet(() => TRIALS.sendQuotationFileTest(env))).reason === "already_today" && gotenberg === 1);
}

console.log("\n[ز5] «بدء الدوام» as it reaches Baraa now");
{
  const env = world();
  const r = await quiet(() => TRIALS.sendShiftStartTest(env));
  const got = sentTo(OWNER);
  const params = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  const payloads = (b: any): string[] => (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload);
  assert("one line that says so, then the template itself: utak_shift_start_v2 [«براء»], «بدء الدوام» → shift_start", r.sent && got.length === 2 && got[0].type === "text" && String(got[0].text.body).startsWith("🧪 تجربة — بعد هذه الرسالة يصلك قالب «بدء الدوام»") && got[1]?.template?.name === "utak_shift_start_v2" && params(got[1]).join() === "براء" && payloads(got[1]).join() === "shift_start", JSON.stringify(got).slice(0, 500));
  assert("…the line says 2:00 and what his tap releases", String(got[0].text.body).includes("الساعة 2:00") && String(got[0].text.body).includes("قائمة الشراء المفتوحة") && String(got[0].text.body).includes("لا يُسجَّل حضور"));
  assert("no attendance row, nothing written, once a day", rows("x_team_attendance").length === 0 && writes().length === 0 && (await quiet(() => TRIALS.sendShiftStartTest(env))).reason === "already_today");
}

console.log("\n[ز] the hook");
{
  const env = world();
  const bad = await post(env, "prices", "WRONG");
  assert("a wrong token: 401, nothing sent", bad.status === 401 && sentTo(OWNER).length === 0);
  const ok = await post(env, "prices");
  const j = await ok.json() as any;
  assert("POST /odoo/hook/s59-trial?name=prices: the trial goes, and the answer says so", ok.status === 200 && j.ok === true && j.sent === true && textsTo(OWNER).length === 2, JSON.stringify(j));
  const again = await (await post(env, "prices")).json() as any;
  assert("…a second call the same day: not sent again", again.sent === false && again.reason === "already_today" && textsTo(OWNER).length === 2);
  const none = await (await post(env, "nothing")).json() as any;
  assert("an unknown name: nothing", none.sent === false && none.reason === "unknown_trial");
  const script = readFileSync(new URL("../scripts/s59-20261006-trial.mjs", import.meta.url), "utf8");
  assert("the script names the five trials, calls prod's hook alone, is dry by default and prints no token", TRIALS.S59_TRIAL_NAMES.every((n) => script.includes(`"${n}"`)) && script.includes("/odoo/hook/s59-trial?name=") && script.includes('process.argv.includes("--send")') && !/console\.log\([^)]*token\b[^)]*\$\{token\}/.test(script));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

void [graph, setRiyadh];
done();
