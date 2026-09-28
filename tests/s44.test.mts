// § 44 — the day's order before tonight's launch (2026-09-28).
//
//   [ب] the real customers' records are never marked «محاكاة»: a record with
//       x_is_simulation of a partner in the list (scripts/lib/real-partners.mjs)
//       — its order, line, invoice, payment, stop, route, the day's purchase
//       list, its dues and lines, its messages — is left out of the pre-launch
//       mark (§ 42 ج, re-run by the cutover), and a simulation partner's is not.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s44.test.mts

import { readFileSync } from "node:fs";
import { reset, seed, setRiyadh } from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// @ts-ignore — plain .mjs helper
const RP = await import("../scripts/lib/real-partners.mjs");

// ================================================================ [ب]
console.log("\n[ب] the real customers' records are never marked");
{
  reset(); setRiyadh("2026-09-28 10:00");
  const REAL = 31, SIMP = 900;
  seed("res.partner", { id: REAL, name: "ابو مكين المعبري", customer_rank: 1, x_contact_class: "customer" });
  seed("res.partner", { id: SIMP, name: "مطعم محاكاة", customer_rank: 1, x_utak_simulation: true });
  const IS = { x_is_simulation: true };
  const oR = seed("x_daily_order", { x_customer_id: REAL, x_state: "confirmed", x_order_date: "2026-09-28", ...IS });
  const oS = seed("x_daily_order", { x_customer_id: SIMP, x_state: "confirmed", x_order_date: "2026-09-30", ...IS });
  const oRc = seed("x_daily_order", { x_customer_id: REAL, x_state: "cancelled", x_order_date: "2026-10-02", ...IS });
  const lR = seed("x_daily_order_line", { x_order_id: oR, ...IS });
  const lS = seed("x_daily_order_line", { x_order_id: oS, ...IS });
  const iR = seed("x_invoice", { x_order_id: oR, ...IS });
  const iS = seed("x_invoice", { x_order_id: oS, ...IS });
  const pR = seed("x_payment", { x_invoice_id: iR, ...IS });
  const pS = seed("x_payment", { x_invoice_id: iS, ...IS });
  const rR = seed("x_delivery_route", { ...IS });
  const rS = seed("x_delivery_route", { ...IS });
  const sR = seed("x_delivery_stop", { x_route_id: rR, x_order_id: oR, ...IS });
  const sS = seed("x_delivery_stop", { x_route_id: rS, x_order_id: oS, ...IS });
  const plR = seed("x_purchase_list", { x_date: "2026-09-28", ...IS });
  const plS = seed("x_purchase_list", { x_date: "2026-09-30", ...IS });
  const plC = seed("x_purchase_list", { x_date: "2026-10-02", ...IS }); // only the real customer's CANCELLED order that day
  const dR = seed("x_supplier_due", { x_purchase_list_id: plR, ...IS });
  const dS = seed("x_supplier_due", { x_purchase_list_id: plS, ...IS });
  const dlR = seed("x_supplier_due_line", { x_due_id: dR, ...IS });
  const dlS = seed("x_supplier_due_line", { x_due_id: dS, ...IS });
  const wR = seed("x_wa_message", { x_partner_id: REAL });
  const aR = seed("x_message_analysis", { x_customer_id: REAL, ...IS });
  const MODELS_WITH_IS = ["x_daily_order", "x_daily_order_line", "x_invoice", "x_payment", "x_delivery_route", "x_delivery_stop", "x_purchase_list", "x_supplier_due", "x_supplier_due_line", "x_message_analysis"];
  // the fake Odoo's fields_get is empty: this caller answers it as the tenant does
  const call = async (model: string, method: string, body: any): Promise<any> => {
    if (method === "fields_get") return model === "x_wa_message" ? { x_utak_simulation: {} } : MODELS_WITH_IS.includes(model) ? { x_is_simulation: {}, x_utak_simulation: {} } : {};
    const r = await fetch(`https://odoo.test/json/2/${model}/${method}`, { method: "POST", body: JSON.stringify(body) });
    return r.json();
  };
  const linked = await RP.linkedRecordIds(call, [REAL]);
  const has = (m: string, id: number) => linked[m]?.has(id) === true;
  assert("[ب] the list is #31 and #105", JSON.stringify(RP.REAL_PARTNER_IDS) === "[31,105]", JSON.stringify(RP.REAL_PARTNER_IDS));
  assert("[ب] linked: the real customer's orders (live and cancelled), line, invoice, payment, stop", has("x_daily_order", oR) && has("x_daily_order", oRc) && has("x_daily_order_line", lR) && has("x_invoice", iR) && has("x_payment", pR) && has("x_delivery_stop", sR));
  assert("[ب] linked: the route carrying his stop, the purchase list of his live order's day, its due and due line", has("x_delivery_route", rR) && has("x_purchase_list", plR) && has("x_supplier_due", dR) && has("x_supplier_due_line", dlR));
  assert("[ب] linked: his messages and message analysis", has("x_wa_message", wR) && has("x_message_analysis", aR));
  assert("[ب] NOT linked: the simulation partner's records, and the list of a day with only his cancelled order", !has("x_daily_order", oS) && !has("x_daily_order_line", lS) && !has("x_invoice", iS) && !has("x_payment", pS)
    && !has("x_delivery_stop", sS) && !has("x_delivery_route", rS) && !has("x_purchase_list", plS) && !has("x_purchase_list", plC) && !has("x_supplier_due", dS) && !has("x_supplier_due_line", dlS));
  const sel: Record<string, { ids: number[]; excluded: number[] }> = {};
  for (const m of MODELS_WITH_IS) sel[m] = await RP.selectForMark(call, m, linked);
  const realIds: Record<string, number> = { x_daily_order: oR, x_daily_order_line: lR, x_invoice: iR, x_payment: pR, x_delivery_route: rR, x_delivery_stop: sR, x_purchase_list: plR, x_supplier_due: dR, x_supplier_due_line: dlR, x_message_analysis: aR };
  const simIds: Record<string, number> = { x_daily_order: oS, x_daily_order_line: lS, x_invoice: iS, x_payment: pS, x_delivery_route: rS, x_delivery_stop: sS, x_purchase_list: plS, x_supplier_due: dS, x_supplier_due_line: dlS };
  for (const m of Object.keys(realIds)) {
    assert(`[ب] ${m}: the real customer's record (x_is_simulation) is not selected, and is listed as excluded`, !sel[m].ids.includes(realIds[m]) && sel[m].excluded.includes(realIds[m]), JSON.stringify(sel[m]));
  }
  for (const m of Object.keys(simIds)) {
    assert(`[ب] ${m}: the simulation partner's record is still selected`, sel[m].ids.includes(simIds[m]), JSON.stringify(sel[m]));
  }
  assert("[ب] the day with only his cancelled order: its list is still selected", sel.x_purchase_list.ids.includes(plC));
  // an already marked real record is never selected (nor unmarked): the rule reads x_utak_simulation != true
  seed("x_daily_order", { x_customer_id: REAL, x_state: "confirmed", x_order_date: "2026-09-29", x_is_simulation: true, x_utak_simulation: true });
  const again = await RP.selectForMark(call, "x_daily_order", await RP.linkedRecordIds(call, [REAL]));
  assert("[ب] an already marked record of his is not selected again", again.ids.length === 1 && again.ids[0] === oS, JSON.stringify(again));
  // the mark script uses the rule (scan, mark, verify) and guards its write
  const markSrc = readFileSync(new URL("../scripts/s42-20260927-prelaunch-mark.mts", import.meta.url), "utf8");
  assert("[ب] the pre-launch mark script selects through selectForMark with the real customers' links", /return selectForMark\(call, model, await linked\(\)\);/.test(markSrc) && /linkedRecordIds\(call, REAL_PARTNER_IDS\)/.test(markSrc));
  assert("[ب] the mark script refuses to write a real customer's record, and verify checks its own marks", markSrc.includes("a record linked to a real customer reached the write") && markSrc.includes("among this run's marks"));
  const cutSrc = readFileSync(new URL("../scripts/cutover-prod.mts", import.meta.url), "utf8");
  assert("[ب] the cutover's re-mark (step 3ب) runs that same script, and its dry run names the list", cutSrc.includes("scripts/s42-20260927-prelaunch-mark.mts")
    && cutSrc.includes('markStep(["mark", "--apply", `--rb=${rbName}`])') && cutSrc.includes("REAL_PARTNER_IDS"));
}

// ================================================================ summary
console.log(`\n${passed} ✓, ${failed} ✗`);
if (failed) { console.log("failed:\n  " + failures.join("\n  ")); process.exit(1); }
