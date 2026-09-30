// Mutation check for § 42 (2026-09-27): each mutation disables ONE guard of a
// part, runs its test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/s42-20260927-mutations.mjs [أ|ب|د …]     (no argument: every part)
//
// Out: scripts/artifacts/s42-20260927-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/s42.test.mts";
const SP = "src/supplier-pay.ts";
const CM = "src/cash-market.ts";
const GW = "src/wa-gateway.ts";
const RT = "src/router.ts";
const CP = "src/collect-pay.ts";
const INV = "src/invoice.ts";
const IX = "src/index.ts";
const WT = "wrangler.toml";
const CF = "src/config.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ «مشتريات السوق النقدية»
  ["أ", "the market winner ignored (Omar's lines back under Ahmed)", [[SP,
    "    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));",
    "    const won = undefined as { price: number; sourceName: string } | undefined;"]], T],
  ["أ", "a market line owed to the item's supplier (Ahmed), not the cash market", [[SP,
    "      const sid = market!.cashSupplierId;",
    "      const sid = (itemSupplier(it, list.listSupplierId) ?? market!.cashSupplierId)!;"]], T],
  ["أ", "a market line at the list's price (Ahmed's), not Omar's written one", [[SP,
    "...base, unitPrice: won.price, priceId: null, subtotalH: lineSubtotalH(qty, won.price), noPrice: false,",
    "...base, unitPrice: won.price, priceId: null, subtotalH: lineSubtotalH(qty, Number((it as { unit_price?: number }).unit_price ?? won.price)), noPrice: false,"]], T],
  ["أ", "no cash-market partner: the market lines «بلا سعر» under Ahmed again", [[SP,
    "      if (!market!.cashSupplierId) { noSupplier.push(it); continue; }",
    "      if (!market!.cashSupplierId) { const s0 = itemSupplier(it, list.listSupplierId); if (!s0) { noSupplier.push(it); continue; } const d0 = by.get(s0) ?? { supplierId: s0, lines: [], amountH: 0, unpriced: 0 }; d0.lines.push({ ...base, unitPrice: null, priceId: null, subtotalH: 0, noPrice: true }); d0.unpriced++; by.set(s0, d0); continue; }"]], T],
  ["أ", "a supplier's winning price read as the market's", [[CM,
    "    if (!nonSupplier(pid)) continue;\n", ""]], T],
  ["أ", "a simulation day of «أسعار اليوم» read", [[CM,
    "[\"x_day_id.x_utak_simulation\", \"!=\", true], [\"x_utak_simulation\", \"!=\", true],\n", "\n"]], T],
  ["أ", "the cash-market partner never looked up", [[SP,
    "  const cash = await findCashMarketSupplier(env);\n  if (!cash)",
    "  const cash = null as { id: number } | null;\n  if (!cash)"]], T],
  ["أ", "Omar's picker without the cash market", [[SP,
    "      const s = won ? market.cashSupplierId : itemSupplier(it, ls);",
    "      const s = itemSupplier(it, ls);"]], T],
  ["أ", "a cash-market payment notified like any supplier's", [[SP,
    "    const isCash = !!cash && cash.id === supplierId;",
    "    const isCash = false && !!cash && cash.id === supplierId;"]], T],
  ["أ", "the gateway sends to the cash market's number", [[GW,
    "    if (await isCashMarketNumber(env, to)) {",
    "    if (false && (await isCashMarketNumber(env, to))) {"]], T],
  ["أ", "the gateway matches the exact digits only (0500… vs 966500…)", [[CM,
    "  return nums.some((n) => n === d || (n.length >= 9 && d.length >= 9 && n.slice(-9) === d.slice(-9)));",
    "  return nums.some((n) => n === d);"]], T],
  // ---------------------------------------------------------------- ب the partial collection from WhatsApp
  ["ب", "«نقد» records the whole balance at once (§ 41)", [[RT,
    "      reply = await askCollection(env, Number(mCollect[2]), mCollect[1] as \"cash\" | \"transfer\", collectorOf(partner));",
    "      reply = { text: (await (await import(\"./invoice\")).recordCollection(env, { invoiceId: Number(mCollect[2]), method: mCollect[1] as \"cash\" | \"transfer\" })).text };"]], T],
  ["ب", "«نقد» / «تحويل» without the short lock (a double tap: two prompts)", [[RT,
    "withButtonLock(env, `collect_ask:${mCollect[2]}`, async () => {", "withButtonLock(env, `collect_ask:${mCollect[2]}:${Math.random()}`, async () => {"]], T],
  ["ب", "«المبلغ كامل» without its lock (two taps at once: two payments)", [[CP,
    "  const text = await withButtonLock(env, cpRecLock(invoiceId, promptNonce), async () => {",
    "  const text = await withButtonLock(env, cpRecLock(invoiceId, promptNonce) + Math.random(), async () => {"]], T],
  ["ب", "the recording lock per invoice, not per prompt (the rest never collected)", [[CP,
    "export const cpRecLock = (invoiceId: number, nonce: string): string => `collect_rec:${invoiceId}:${nonce}`;",
    "export const cpRecLock = (invoiceId: number, nonce: string): string => `collect_rec:${invoiceId}`;"]], T],
  ["ب", "an amount without its lock (two texts at once: two payments)", [[CP,
    "  const claim = await claimButton(env, cpRecLock(ptr.invoiceId, ptr.nonce));",
    "  const claim = await claimButton(env, cpRecLock(ptr.invoiceId, ptr.nonce) + Math.random());"]], T],
  ["ب", "more than the balance cut down to it and recorded", [[INV,
    "  if (amount > remaining + 0.005 && a.exact) {", "  if (false) {"]], T],
  ["ب", "two numbers: the first one taken", [[CP,
    "  if (values.length > 1) return { kind: \"many\" };\n", ""]], T],
  ["ب", "Arabic-Indic digits not read", [[CP,
    "    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)\n", ""]], T],
  ["ب", "zero or a signed number taken as an amount", [[CP,
    "  if (!(v > 0) || dec > 2 || v > CP_MAX_AMOUNT) return { kind: \"none\" };", "  if (dec > 2 || v > CP_MAX_AMOUNT) return { kind: \"none\" };"]], T],
  ["ب", "the 30 minutes not enforced (an amount after them recorded)", [[CP,
    "  if (now - ptr.at > CP_WAIT_MIN * MIN) { await clearAmountPointer(env, who.id); return null; }\n", ""]], T],
  ["ب", "the pointer kept after the recording (his next number «تم مسبقاً»)", [[CP,
    "  if (ptr && ptr.invoiceId === invoiceId) await clearAmountPointer(env, partnerId);\n", ""]], T],
  ["ب", "«مبلغ آخر» leaves an open supplier-payment flow first in line", [[CP,
    "`pending_collect_note:${who.id}`, flowKey(who.id)]", "`pending_collect_note:${who.id}`]"]], T],
  ["ب", "the amount text never read (index.ts)", [[IX,
    "      } else if (msg.type === \"text\" && (collectReply = await import(\"./collect-pay\")",
    "      } else if (false && msg.type === \"text\" && (collectReply = await import(\"./collect-pay\")"]], T],
  ["ب", "a stale prompt's «مبلغ آخر» after its recording goes on", [[CP,
    "  if (await lockTaken(env, cpRecLock(invoiceId, promptNonce))) return { text: ALREADY_DONE_TEXT };\n", ""]], T],
  ["ب", "the reminder before the 30 minutes", [[CP,
    "        if (now - st.at < CP_WAIT_MIN * MIN) { out.push({ invoiceId, action: \"waiting\" }); continue; }\n", ""]], T],
  ["ب", "the reminder never marked (so Baraa's alert never comes)", [[CP,
    "        await writePending(env, { ...st, remindedAt: now });", "        await writePending(env, { ...st });"]], T],
  ["ب", "Baraa's alert timed from the reminder, not from his last step", [[CP,
    "      if (now - Math.max(st.at, st.remindedAt) < CP_WAIT_MIN * MIN)", "      if (now - st.remindedAt < CP_WAIT_MIN * MIN)"]], T],
  ["ب", "Baraa's alert not once (no mark, no claim, a job per tick)", [[CP,
    "      if (claim.claimed) {\n        const { withAutoSendJob } = await import(\"./auto-send-guard\");\n        await sendOwnerAlert(withAutoSendJob(env, `collect_alert:${invoiceId}:${st.nonce}`), ownerAlertText(st, remaining));",
    "      if (true) {\n        const { withAutoSendJob } = await import(\"./auto-send-guard\");\n        await sendOwnerAlert(withAutoSendJob(env, `collect_alert:${invoiceId}:${now}`), ownerAlertText(st, remaining) + ` ${now}`);"], [CP,
    "      await writePending(env, { ...st, alertedAt: now });\n      await dropIndex(env, invoiceId);\n", ""]], T],
  ["ب", "a paid invoice still reminded", [[CP,
    "      if (!inv || inv.status === \"paid\" || !(remaining > 0.005)) {", "      if (!inv) {"]], T],
  ["ب", "the */5 cron without the collection tick", [[IX,
    "            const cp = await runCollectPayTick(env, Date.now());", "            const cp: Array<{ action: string }> = []; void runCollectPayTick;"]], T],
  ["ب", "a partial's account.payment at the whole balance", [[INV,
    "        invoiceNumber: invoice.number,\n        amount,\n        method,", "        invoiceNumber: invoice.number,\n        amount: remaining,\n        method,"]], T],
  ["ب", "the full button's title past Meta's 20 characters (cut by Meta's cap)", [[CP,
    "].find((t) => t.length <= 20)!;", "][0];"]], T],
  // ---------------------------------------------------------------- د prod's variables
  ["د", "prod run as the pilot (PILOT_MODE true)", [[WT,
    "PILOT_MODE           = \"false\"", "PILOT_MODE           = \"true\""]], T],
  ["د", "prod without the accounting (ACCOUNTING_SYNC false)", [[WT,
    "ACCOUNTING_SYNC      = \"true\"", "ACCOUNTING_SYNC      = \"false\""]], T],
  ["د", "prod capturing instead of sending (SIMULATION_MODE true)", [[WT,
    "SIMULATION_MODE      = \"false\"", "SIMULATION_MODE      = \"true\""]], T],
  ["د", "a SIM_ALLOWLIST left on prod (the team only)", [[WT,
    "OWNER_WINDOW_OPEN_AT = \"06:00\"\n", "OWNER_WINDOW_OPEN_AT = \"06:00\"\nSIM_ALLOWLIST        = \"+966505154962,+966571777704\"\n"]], T],
  ["د", "an unset allowlist read as «nobody» (every number refused)", [[CF,
    "  if (list.length === 0) return true; // unset = production behavior", "  if (list.length === 0) return false; // unset = production behavior"]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("./artifacts/s42-20260927-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
