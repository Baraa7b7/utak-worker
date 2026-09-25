// The 18:00 collection summary and the inbox bot echo — 2026-09-24.
//
//   1. simulation invoices (x_is_simulation) never reach the collector;
//   2. every utak_collection_summary variable is one line, for any list;
//   3. free text goes out only inside the 24h window (#131047 otherwise);
//   4. a failed or unmapped template is recorded / alerted, not swallowed;
//   5. the bot echo's cream box carries its own dark text colour (AA+).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/collection-sim.test.mts

import {
  COLL, CUST, CUST2, graph, odooLog, order, ownerAlerts, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, table,
} from "./wa-harness.mts";

const COLL_PHONE = "966500000602";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const { sendDailyCollectionSummary, buildCollectionSummary, NOTHING_TO_COLLECT_TEXT } = await import("../src/invoice.ts");
const { getUnpaidInvoicesWithCustomer } = await import("../src/odoo.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const { isInvalidTemplateParam } = await import("../src/wa-params.ts");
const { AUTO_STYLE, autoLabelHtml, kvLastInboundTs } = await import("../src/wa-inbox.ts");
const { BRAND_COLORS } = await import("../src/pdf-template.ts");

/** utak_collection_summary body as approved by Meta (GET 2026-09-24, UTILITY). */
const TEMPLATE_TEXT = "📋 قائمة تحصيل اليوم {{1}}:\n\n{{2}}\n\nإجمالي مطلوب: {{3}} ر.س\nعدد الفواتير: {{4}}\n\nلما تحصّل من أي عميل، افتح رسالة الفاتورة واضغط زر التحصيل.";
const render = (p: string[]) => p.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, v), TEMPLATE_TEXT);
/** Meta #132018 / #131008 rules, plus the 1024-char body cap. */
const metaOk = (p: string[]) =>
  p.length === 4 && p.every((v) => !isInvalidTemplateParam(v) && !/[\r\n\t]/.test(v) && !/ {5,}/.test(v)) && render(p).length <= 1024;

const invoice = (num: string, total: number, sim: boolean, customer = CUST, status = "issued") =>
  seed("x_invoice", {
    x_invoice_number: num, x_total: total, x_status: status, x_is_simulation: sim,
    x_order_id: order(customer, "delivered", "2026-09-24", 1, { x_delivery_neighborhood: "النرجس" }),
  });
const summaryTo = (digits: string) => sentTo(digits).filter((b) => b?.template?.name === "utak_collection_summary");
const textTo = (digits: string) => sentTo(digits).filter((b) => b?.type === "text");
const params = (b: any): string[] => b.template.components.find((c: any) => c.type === "body").parameters.map((p: any) => p.text);
const inWindow = (env: any) => env.MSG_DEDUP.put(kvLastInboundTs(COLL), String(Date.now() - 3600e3));
const heldFor = (env: any, digits: string): any[] => JSON.parse(env.MSG_DEDUP.store.get(`wa_q:v1:${digits}`) ?? "[]");

// ================================================================ 1
console.log("\n[1] simulation invoices never reach the collection summary");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  invoice("UTAK-ACCT-TEST-1789968293059", 3, true);
  invoice("UTAK-VAT-D-1790151628519", 115, true);
  invoice("UTAK-ACCT-CB-1790150478040", 7, true, CUST2, "overdue");
  invoice("UTAK-INV-20260924-001", 240.5, false);
  invoice("UTAK-INV-20260924-002", 80, false, CUST2, "overdue");
  invoice("UTAK-INV-20260923-009", 999, false, CUST, "paid");

  const unpaid = await quiet(() => getUnpaidInvoicesWithCustomer(env));
  assert("unpaid list = the two real open invoices only", unpaid.length === 2 && unpaid.every((u) => u.number.startsWith("UTAK-INV-2026092")), JSON.stringify(unpaid));
  const q = odooLog.find((l) => l.model === "x_invoice" && l.method === "search_read");
  assert("the Odoo domain itself carries x_is_simulation != true", JSON.stringify(q?.body?.domain ?? []).includes('["x_is_simulation","!=",true]'), JSON.stringify(q?.body?.domain));

  const r = await quiet(() => sendDailyCollectionSummary(env));
  const cs = summaryTo(COLL_PHONE);
  assert("one template to the collector", cs.length === 1, JSON.stringify(graph));
  const p = params(cs[0]);
  assert("count {{4}} = 2", p[3] === "2", p[3]);
  assert("total {{3}} = 320.5", p[2] === "320.5", p[2]);
  assert("no test number in the list", !/UTAK-(ACCT|VAT)/.test(p[1]), p[1]);
  assert("both real numbers listed", p[1].includes("UTAK-INV-20260924-001") && p[1].includes("UTAK-INV-20260924-002"), p[1]);
  assert("report: 2 invoices, 320.5, via template", r.invoices === 2 && r.total === 320.5 && r.sends[0]?.via === "template", JSON.stringify(r));
}
{
  // The 09-24 case: every open invoice is a simulation one (15 → 555 SAR).
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  for (let i = 0; i < 15; i++) invoice(`UTAK-ACCT-TEST-${i}`, 37, true);
  const r = await quiet(() => sendDailyCollectionSummary(env));
  assert("all-simulation: no summary template at all", summaryTo(COLL_PHONE).length === 0);
  assert("all-simulation, outside window: nothing sent to the collector", sentTo(COLL_PHONE).length === 0, JSON.stringify(sentTo(COLL_PHONE)));
  // STATUS § 33 — outside the window the «nothing to collect» text waits for
  // the collector's next message (until the end of the day), never sent blind.
  assert("report says why (held for the collector)", r.invoices === 0 && r.sends[0]?.via === "held" && /نافذة/.test(r.sends[0]?.reason ?? ""), JSON.stringify(r));
  assert("the text is held for the collector", heldFor(env, COLL_PHONE).length === 1 && heldFor(env, COLL_PHONE)[0].body.text.body === NOTHING_TO_COLLECT_TEXT);

  const env2 = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  for (let i = 0; i < 15; i++) invoice(`UTAK-VAT-E-${i}`, 37, true);
  await inWindow(env2);
  await quiet(() => sendDailyCollectionSummary(env2));
  const t = textTo(COLL_PHONE);
  assert("all-simulation, inside window: «nothing to collect» as text", t.length === 1 && t[0].text.body === NOTHING_TO_COLLECT_TEXT, JSON.stringify(t));
}

// ================================================================ 2
console.log("\n[2] every summary variable is one line, for any list");
{
  const hostile = [
    "مطعم\nالوادي", "بقالة\tالنخيل", "  سوبرماركت     الريان  ", "كافيه\r\nالبن", "\n", "م".repeat(300),
  ];
  let allOk = true; let worst = "";
  for (const n of [1, 2, 4, 15, 40, 120, 200]) {
    const list = Array.from({ length: n }, (_, i) => ({
      number: `UTAK-INV-20260924-${String(i).padStart(3, "0")}`, total: 10 + i * 1.25,
      customer_name: hostile[i % hostile.length], neighborhood: i % 3 ? "حي\nالعليا" : "",
    }));
    const s = buildCollectionSummary(list, "2026-09-24");
    if (!metaOk(s.params)) { allOk = false; worst = `${n}: ${JSON.stringify(s.params).slice(0, 300)} (${render(s.params).length})`; }
  }
  assert("1…200 invoices, hostile names: 4 variables, no \\n/\\t, ≤ 4 spaces, body ≤ 1024", allOk, worst);
  const s15 = buildCollectionSummary(Array.from({ length: 15 }, (_, i) => ({ number: `N${i}`, total: 37, customer_name: "اختبار محاسبة", neighborhood: "" })), "2026-09-24");
  assert("{{1}} is the Arabic date", s15.params[0] === "24 سبتمبر 2026", s15.params[0]);
  assert("the in-window text keeps the full multi-line list", s15.text.split("\n").length > 15);

  // End to end: what reaches Graph from the real function.
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  for (let i = 0; i < 60; i++) invoice(`UTAK-INV-20260924-${i}`, 12.5, false, i % 2 ? CUST : CUST2);
  table("res.partner").get(CUST)!.name = "مطعم\nالوادي   الكبير";
  await quiet(() => sendDailyCollectionSummary(env));
  const cs = summaryTo(COLL_PHONE);
  assert("60 real invoices: one template reaches Graph", cs.length === 1);
  assert("what Graph receives passes Meta's rules", cs[0] && metaOk(params(cs[0])), cs[0] ? JSON.stringify(params(cs[0])).slice(0, 300) : "");
  assert("a long list says how many were left out", cs[0] && /و \d+ أخرى$/.test(params(cs[0])[1]), cs[0] ? params(cs[0])[1].slice(-60) : "");
}

// ================================================================ 3 + 4
console.log("\n[3] no free-text fallback outside the 24h window (#131047); failures recorded");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  invoice("UTAK-INV-20260924-001", 50, false);
  setFail({ utak_collection_summary: 132018 });
  const r = await quiet(() => sendDailyCollectionSummary(env));
  assert("outside window + template refused: no text to the collector", textTo(COLL_PHONE).length === 0, JSON.stringify(textTo(COLL_PHONE)));
  const failedRows = rows("x_wa_message").filter((w) => w.x_status === "failed");
  assert("the refusal is an x_wa_message row with x_status=failed + 132018",
    failedRows.length === 1 && String(failedRows[0].x_meta_error).includes("132018"), JSON.stringify(rows("x_wa_message")));
  assert("owner alerted once with template + code", ownerAlerts().filter((a) => a.includes("utak_collection_summary") && a.includes("132018")).length === 1, ownerAlerts().join("\n"));
  assert("report: via none, reason Meta 132018", r.sends[0]?.via === "none" && /132018/.test(r.sends[0]?.reason ?? ""), JSON.stringify(r));
}
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  invoice("UTAK-INV-20260924-001", 50, false);
  setFail({ utak_collection_summary: 132018 });
  await inWindow(env);
  const r = await quiet(() => sendDailyCollectionSummary(env));
  const t = textTo(COLL_PHONE);
  // STATUS § 33 — one attempt per message: Meta refused the template, so no
  // text follows it (and none of this purpose to this number for 24h).
  assert("inside window + template refused: no second message", t.length === 0, JSON.stringify(t));
  assert("report: via none, Meta 132018", r.sends[0]?.via === "none" && /132018/.test(r.sends[0]?.reason ?? ""), JSON.stringify(r));
}
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  invoice("UTAK-INV-20260924-001", 50, false);
  for (const [id, t] of table("x_whatsapp_template")) if (t.x_purpose === "collection_summary") table("x_whatsapp_template").delete(id);
  await quiet(() => sendDailyCollectionSummary(env));
  assert("no template mapped, outside window: nothing to the collector", sentTo(COLL_PHONE).length === 0);
  assert("…the full text is held for the collector", heldFor(env, COLL_PHONE).length === 1 && String(heldFor(env, COLL_PHONE)[0].body.text.body).includes("UTAK-INV-20260924-001"));
  assert("…and the owner is told once", ownerAlerts().filter((a) => a.includes("ملخص التحصيل") && a.includes("محفوظة")).length === 1, ownerAlerts().join("\n"));
}
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  invoice("UTAK-INV-20260924-001", 50, false);
  await quiet(() => sendDailyCollectionSummary(env));
  assert("template accepted: no text sent as well", textTo(COLL_PHONE).length === 0 && summaryTo(COLL_PHONE).length === 1);
}

// ================================================================ 5
console.log("\n[5] the bot echo inherits the theme colours (no fixed colour), in both themes");
{
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // What it was: Odoo 19 dark-mode --body-color on the cream box (09-20 → 09-24).
  assert("before (dark theme #E4E4E4 on cream) was below AA", ratio("#E4E4E4", BRAND_COLORS.bgPage) < 4.5);
  // 2026-09-25: neither a background nor a text colour — both come from the theme.
  assert("AUTO_STYLE pins no colour and no background", !/color|background|#/i.test(AUTO_STYLE), AUTO_STYLE);
  const html = autoLabelHtml("📋 قائمة التحصيل اليومية\n1. x", "ملخص التحصيل");
  assert("every echo opens with the AUTO_STYLE box", html.startsWith(`<p style="${AUTO_STYLE}">`) && html.includes("<br/>"));
  assert("the prefix and body carry no style of their own", !/<(strong|span|br)[^>]*style=/.test(html));
}

console.log(`\ncollection-sim: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
