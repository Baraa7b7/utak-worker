// § 64 ج (2026-10-07) — the automation «utak.special_quote.recalc (on mode / layout)» against the DEPLOYED worker,
// end to end, on a request made for the test and flagged «محاكاة» (the worker recalculates a simulated request and
// nothing more: it sends nothing and issues nothing). SQ-0002 and the request #1 are never named.
//
//   1  a request is made (the first run; later runs reopen the same one): the test contact, «محاكاة», «قبل الضريبة»,
//      ONE line (a purchase price, no final price); it is calculated, «المقترح» as the mode rounds it
//   2  «الأسعار في العرض» ← «شاملة الضريبة»: the NEW automation recalculates it — «المقترح» is rounded the other way
//   3  a final price is typed with VAT (11.00). A LINE'S EDIT ASKS ODOO FOR NO RECALCULATION (its ids do not change):
//      the price before VAT stays empty. The mode goes to «قبل الضريبة»: the typed 11.00 is KEPT and 9.57 follows
//      (the first run of this probe, 2026-10-07 22:17, found it WIPED: the fix is finalsAfterModeChange)
//   4  the other way: 10.00 typed before VAT, not followed, the mode back to «شاملة الضريبة»: 10.00 kept, 11.50 follows
//   5  «شكل العرض» ← «أسعار الوحدة»: saved, and nothing of the prices moves
//   6  the request is closed
//
//   node scripts/s64-20261007-mode-probe.mjs            dry-run: what it would do
//   node scripts/s64-20261007-mode-probe.mjs --apply    ONE simulated request (made once, reused; closed, never deleted)
//
// Nothing is sent to anyone. The request's id is kept in scripts/artifacts/s64-20261007-odoo-rollback.json.
import { APPLY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";
import * as L from "./lib/s64-odoo.mjs";

const { rb, save } = rollbackFile(new URL("./artifacts/s64-20261007-odoo-rollback.json", import.meta.url), "scripts/s64-20261007-odoo.mjs");
const TEST_PARTNER = 10, PRODUCT = 97; // «محمد المحصّل - اختبار»; موز أمريكي (named on the line alone)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LINE = ["id", "x_purchase_price", "x_suggested_price", "x_suggested_net", "x_final_price", "x_final_net", "x_no_loss_price"];
const HEAD = ["id", "x_name", "x_state", "x_prepared", "x_price_mode", "x_layout", "x_utak_simulation", "x_sale_order_id", "x_asked_at", "x_last_result"];
const read = async (id) => ({ q: (await call(L.QUOTE_MODEL, "read", { ids: [id], fields: HEAD }))[0], l: (await call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "=", id]], fields: LINE }))[0] });
/** The request once the worker's recalculation has landed (asked for by an automation: a few seconds). */
async function settled(id, done, tries = 12) {
  let now;
  for (let i = 0; i < tries; i++) { await wait(1500); now = await read(id); if (done(now)) break; }
  return now;
}

const [partner] = await call("res.partner", "search_read", { domain: [["id", "=", TEST_PARTNER]], fields: ["id", "name", "active", "x_utak_simulation"], limit: 1, context: { active_test: false } }); // the test contacts are archived
const auto = (await call("base.automation", "search_read", { domain: [["name", "=", L.MODE_AUTOMATION.name]], fields: ["id", "active"] }))[0];
log(`the automation «${L.MODE_AUTOMATION.name}» #${auto?.id} (${auto?.active ? "on" : "OFF"}); the test contact #${partner?.id} «${partner?.name}»`);
if (!auto?.active || !partner) { log("✗ the automation or the test contact is not there"); process.exit(1); }
if (!APPLY) { log("+ ONE simulated request (one line), its mode and its layout changed, then closed — dry-run: nothing written (add --apply)"); process.exit(0); }

const { check, done } = checker();
// ONE simulated request for every run of this probe: made the first time, reopened and emptied of its prices after
let id = rb.created.modeProbeQuote;
if (id) {
  const now = await read(id);
  await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_state: "draft", x_layout: false, x_line_ids: [[1, now.l.id, { x_final_price: 0, x_final_net: 0 }]] } });
  // back to «قبل الضريبة» by a write of its own: the automation recalculates, and the mode is the one last calculated in
  if (now.q.x_price_mode !== "net") await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "net" } });
  else { await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "gross" } }); await wait(6000); await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "net" } }); }
  log(`= request #${id} (simulated): reopened, its final prices emptied`);
} else {
  [id] = await call(L.QUOTE_MODEL, "create", { vals_list: [{ x_partner_id: TEST_PARTNER, x_state: "draft", x_utak_simulation: true, x_price_mode: "net", x_note: "§ 64: فحص أتمتة تغيير «الأسعار في العرض» — محاكاة، لا تُرسل ولا تُصدر", x_line_ids: [[0, 0, { x_product_tmpl_id: PRODUCT, x_qty: 1, x_unit: "كيلو", x_purchase_price: 10, x_sequence: 10 }]] }] });
  rb.created.modeProbeQuote = id; save();
  log(`+ request #${id} (simulated)`);
}
const CALC = ["x_calc_mode"];
const calcMode = async () => (await call(L.QUOTE_MODEL, "read", { ids: [id], fields: CALC }))[0].x_calc_mode;
const a = await settled(id, (s) => s.q.x_prepared && s.q.x_price_mode === "net" && s.l?.x_suggested_net > 0 && Number.isInteger(Math.round(s.l.x_suggested_net * 400) / 100) && !(s.l.x_final_price > 0));
await wait(2500);
check(`[1] the request (${a.q.x_name}) is calculated in «قبل الضريبة»: «المقترح» ${a.l?.x_suggested_net} before VAT (a quarter riyal), ${a.l?.x_suggested_price} with it; «وضع آخر حساب» = ${await calcMode()}`, a.q.x_prepared === true && a.q.x_utak_simulation === true && a.l?.x_suggested_net > 0 && Number.isInteger(Math.round(a.l.x_suggested_net * 400) / 100) && (await calcMode()) === "net", JSON.stringify(a));

await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "gross" } });
const b = await settled(id, (s) => s.l?.x_suggested_price !== a.l.x_suggested_price);
await wait(2500);
check(`[2] the mode changed to «شاملة الضريبة» and the NEW automation recalculated it: «المقترح» ${a.l.x_suggested_price} → ${b.l.x_suggested_price} with VAT (now the quarter riyal), ${a.l.x_suggested_net} → ${b.l.x_suggested_net} before it; «وضع آخر حساب» = ${await calcMode()}`, b.q.x_price_mode === "gross" && b.l.x_suggested_price !== a.l.x_suggested_price && Number.isInteger(Math.round(b.l.x_suggested_price * 400) / 100) && (await calcMode()) === "gross", JSON.stringify(b.l));
check("…and no final price was written by it (none was typed)", !(b.l.x_final_price > 0) && !(b.l.x_final_net > 0), JSON.stringify(b.l));

// a final price typed with VAT. A line's edit asks Odoo for NO recalculation (the lines' ids do not change): the
// price before VAT stays empty until «🔄 احسب» — and the mode is changed before that
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_line_ids: [[1, b.l.id, { x_final_price: 11 }]] } });
await wait(6000);
const c = await read(id);
check(`[3] 11.00 typed with VAT; the line's edit alone asked for no recalculation (before VAT: ${c.l.x_final_net})`, c.l.x_final_price === 11 && !(c.l.x_final_net > 0), JSON.stringify(c.l));
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "net" } });
const d = await settled(id, (s) => s.l?.x_suggested_net === a.l.x_suggested_net && s.l?.x_final_net > 0);
check(`…then the mode changed to «قبل الضريبة»: recalculated, and the typed 11.00 is KEPT with ${d.l.x_final_net} before it — neither wiped nor rewritten`, d.q.x_price_mode === "net" && d.l.x_suggested_net === a.l.x_suggested_net && d.l.x_final_price === 11 && d.l.x_final_net === 9.57, JSON.stringify(d.l));

// the other way: a price typed before VAT, not followed, then the mode changed back
await wait(2500);
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_line_ids: [[1, b.l.id, { x_final_net: 10 }]] } });
await wait(5000);
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_price_mode: "gross" } });
const d2 = await settled(id, (s) => s.l?.x_final_price === 11.5);
check(`[4] 10.00 typed before VAT (11.00 beside it stale), then «شاملة الضريبة»: 10.00 is KEPT and ${d2.l.x_final_price} follows`, d2.q.x_price_mode === "gross" && d2.l.x_final_net === 10 && d2.l.x_final_price === 11.5, JSON.stringify(d2.l));

await wait(2500);
await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_layout: "unit" } });
const e = await settled(id, () => true, 3);
check("[5] «شكل العرض» ← «أسعار الوحدة»: saved, and no price moved", e.q.x_layout === "unit" && e.l.x_final_price === 11.5 && e.l.x_final_net === 10 && e.l.x_suggested_price === d2.l.x_suggested_price, JSON.stringify(e));
check("nothing was sent or issued for it: never asked of a source, no sale order", !e.q.x_asked_at && !e.q.x_sale_order_id, JSON.stringify(e.q));

await call(L.QUOTE_MODEL, "write", { ids: [id], vals: { x_state: "closed" } });
const f = await read(id);
check(`[6] the request #${id} (${f.q.x_name}) is closed — simulated, kept (nothing is deleted)`, f.q.x_state === "closed" && f.q.x_utak_simulation === true);
done();
