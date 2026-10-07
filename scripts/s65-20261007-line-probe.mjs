// § 65 ز (2026-10-07) — the LIVE probe of the line's automation, on the simulated request SQ-0003 (#3) alone:
// an edit of a line's price is recalculated by the worker with no button pressed, the typed price is kept,
// the pass ends (no loop), and the line is left as it was found.
//
//   node scripts/s65-20261007-line-probe.mjs            read-only: the request and its line as they are
//   node scripts/s65-20261007-line-probe.mjs --apply    the probe (four writes on line #32, the last restores it)
//
// Nothing but x_special_quote #3 and its line is written (a request flagged «محاكاة», closed). No WhatsApp send.
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const APPLY = process.argv.includes("--apply");
const QUOTE = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ["id", "x_qty", "x_purchase_price", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_final_net", "x_total", "x_profit", "write_date"];
const quote = async () => (await call("x_special_quote", "read", { ids: [QUOTE], fields: ["x_name", "x_state", "x_utak_simulation", "x_price_mode", "x_calc_mode", "x_profit_text", "write_date"] }))[0];
const line = async (id) => (await call("x_special_quote_line", "read", { ids: [id], fields: FIELDS }))[0];
let ok = 0, bad = 0;
const check = (name, cond, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
/** The line once the worker's pass has landed: read until it stops changing (two equal reads, 4s apart). */
async function settled(id) {
  let prev = null;
  for (let i = 0; i < 8; i++) {
    await sleep(4000);
    const now = await line(id);
    if (prev && prev.write_date === now.write_date) return now;
    prev = now;
  }
  return prev;
}

const q = await quote();
console.log(`${q.x_name} #${QUOTE}: ${q.x_state}, simulation=${q.x_utak_simulation}, mode=${q.x_price_mode}, calc=${q.x_calc_mode}`);
if (q.x_utak_simulation !== true) { console.log("✗ not a simulated request — nothing done"); process.exit(1); }
const [first] = await call("x_special_quote_line", "search_read", { domain: [["x_quote_id", "=", QUOTE]], fields: FIELDS, order: "id asc", limit: 1 });
console.log("line as found:", JSON.stringify(first));
if (!APPLY) { console.log("read-only (add --apply for the probe)"); process.exit(0); }

const net = q.x_price_mode !== "gross";
const typedField = net ? "x_final_net" : "x_final_price", otherField = net ? "x_final_price" : "x_final_net";
// 1 — the purchase price
await call("x_special_quote_line", "write", { ids: [first.id], vals: { x_purchase_price: first.x_purchase_price + 2 } });
const a = await settled(first.id);
check(`a new purchase price (${first.x_purchase_price} → ${first.x_purchase_price + 2}) is recalculated with no button: «بدون خسارة» ${first.x_no_loss_price} → ${a.x_no_loss_price}, the profit ${first.x_profit} → ${a.x_profit}`, a.x_no_loss_price > first.x_no_loss_price && a.x_profit < first.x_profit, JSON.stringify(a));
check(`the final prices are kept (${a.x_final_price} / ${a.x_final_net})`, a.x_final_price === first.x_final_price && a.x_final_net === first.x_final_net);
// 2 — the final price of the mode: typed, kept, the other follows
const typed = Math.round((first[typedField] + 3) * 100) / 100;
await call("x_special_quote_line", "write", { ids: [first.id], vals: { [typedField]: typed } });
const b2 = await settled(first.id);
const follow = net ? Math.round(typed * 1.15 * 100) / 100 : Math.round((typed / 1.15) * 100) / 100;
check(`a typed final price (${typedField} = ${typed}) is kept as typed`, b2[typedField] === typed, JSON.stringify(b2));
check(`the other follows it (${otherField} = ${follow}), and the total and the profit with it (${b2.x_total} / ${b2.x_profit})`, b2[otherField] === follow && b2.x_total !== a.x_total && b2.x_profit > a.x_profit, JSON.stringify(b2));
// 3 — the pass ends: nothing writes the line again
await sleep(9000);
const b3 = await line(first.id);
check("the pass ends: the line is not written again nine seconds later (no loop)", b3.write_date === b2.write_date, `${b2.write_date} → ${b3.write_date}`);
// 4 — as it was found
await call("x_special_quote_line", "write", { ids: [first.id], vals: { x_purchase_price: first.x_purchase_price, [typedField]: first[typedField] } });
const z = await settled(first.id);
const same = ["x_qty", "x_purchase_price", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_final_net", "x_total", "x_profit"].every((k) => z[k] === first[k]);
check("the line is left as it was found (every number)", same, JSON.stringify(z));
const q2 = await quote();
check(`the request is still ${q.x_state}, its mode ${q.x_price_mode}, its profit line as before`, q2.x_state === q.x_state && q2.x_price_mode === q.x_price_mode && q2.x_profit_text === q.x_profit_text, JSON.stringify(q2));
console.log(`probe: ${ok}/${ok + bad}`);
process.exit(bad ? 1 : 0);
