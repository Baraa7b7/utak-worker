// Mutation check for § 44 (2026-09-28): each mutation disables ONE guard of a
// part, runs its test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/s44-20260928-mutations.mjs [ب|د|هـ|و|ز …]     (no argument: every part)
//
// Out: scripts/artifacts/s44-20260928-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/s44.test.mts";
const RP = "scripts/lib/real-partners.mjs";
const MK = "scripts/s42-20260927-prelaunch-mark.mts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ب the real customers are never marked
  ["ب", "the exclusion drops nothing (every x_is_simulation record marked)", [[RP,
    "  if (!keep || !keep.size) return { ids: [...ids], excluded: [] };",
    "  return { ids: [...ids], excluded: [] };"]], T],
  ["ب", "selectForMark ignores the links", [[RP,
    "  const { ids, excluded } = withoutReal(model, all, linked);",
    "  const { ids, excluded } = { ids: all, excluded: [] };"]], T],
  ["ب", "the route carrying his stop not protected", [[RP,
    "  out.x_delivery_route = new Set(stops.map((s) => (Array.isArray(s.x_route_id) ? s.x_route_id[0] : 0)).filter(Boolean));",
    "  out.x_delivery_route = new Set();"]], T],
  ["ب", "a cancelled order protects its day's purchase list", [[RP,
    "orders.filter((o) => o.x_state !== \"cancelled\" && o.x_order_date)",
    "orders.filter((o) => o.x_order_date)"]], T],
  ["ب", "the dues' lines not protected", [[RP,
    "  out.x_supplier_due_line = new Set(out.x_supplier_due.size ?",
    "  out.x_supplier_due_line = new Set(false ?"]], T],
  ["ب", "the payment read through a wrong path", [[RP,
    "    x_payment: [[\"x_invoice_id.x_order_id.x_customer_id\", \"in\", list]],",
    "    x_payment: [[\"x_invoice_id.x_customer_id\", \"in\", list]],"]], T],
  ["ب", "«بيت التمور» (#105) left out of the list", [[RP,
    "export const REAL_PARTNER_IDS = Object.freeze([31, 105]);",
    "export const REAL_PARTNER_IDS = Object.freeze([31]);"]], T],
  ["ب", "the mark script selects without the links", [[MK,
    "  return selectForMark(call, model, await linked());",
    "  return selectForMark(call, model, {});"]], T],
  ["ب", "the mark script's write guard removed", [[MK,
    "    if (s.ids.some((id) => L[m]?.has(id))) throw new Error(`${m}: a record linked to a real customer reached the write`);\n",
    ""]], T],
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
writeFileSync(new URL("./artifacts/s44-20260928-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
