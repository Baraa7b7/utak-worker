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

// [part, name, [[file, find, replace], …], test file]
export const M = [
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
];

if (import.meta.url === `file://${process.argv[1]}`) {
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
}
