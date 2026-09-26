// § 41 (2026-09-26) — the pattern scan of every mutation script, without
// running a test: each script's list is loaded from a copy cut before its run
// loop, and every [file, find] is counted in the current tree. A script stops
// at its first pattern not found exactly once (by design), so this runs after
// any change to src/ and before the mutations themselves.
//
//   node scripts/s41-20260926-mutation-scan.mjs
//
// Out: stdout, one line per script (patterns, not matching once), exit 1 on any.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const scripts = readdirSync(join(root, "scripts")).filter((f) => /-mutations\.mjs$/.test(f)).sort();
const dir = mkdtempSync(join(tmpdir(), "mscan-"));
let bad = 0, total = 0;
for (const f of scripts) {
  const src = readFileSync(join(root, "scripts", f), "utf8");
  const cut = src.search(/\nconst (want = new Set\(process\.argv|results = \[\];)/);
  if (cut < 0) { console.log(`?  ${f}: no run loop found — skipped`); continue; }
  const listName = /\nconst (M|MUTATIONS|mutations)\s*=\s*\[/.exec(src)?.[1];
  if (!listName) { console.log(`?  ${f}: no mutation list — skipped`); continue; }
  const body = src.slice(0, cut)
    .replace(/new URL\("\.\.\/", import\.meta\.url\)\.pathname/g, JSON.stringify(root))
    .replace(/^import .*$/gm, (l) => (/node:fs|node:child_process/.test(l) ? l : ""));
  const tmp = join(dir, f);
  writeFileSync(tmp, `${body}\nexport default ${listName};\n`);
  const list = (await import(tmp)).default;
  let n = 0, off = [];
  for (const m of list) {
    // [name, [[file, find, replace], …], test] / [part, name, [[…]], test], or [name, file, find, replace, all] (att)
    const edits = m.find((x) => Array.isArray(x) && Array.isArray(x[0]))
      ?? (typeof m[1] === "string" && /^(src|scripts|tests)\//.test(m[1]) ? [[m[1], m[2], m[3], m[4]]] : []);
    for (const [file, find, , all] of edits) {
      n++;
      const cur = readFileSync(join(root, file), "utf8");
      const c = cur.split(find).length - 1;
      if (all ? c < 1 : c !== 1) off.push(`${file} ×${c}: ${String(find).slice(0, 70).replace(/\n/g, "⏎")}`);
    }
  }
  total += n; bad += off.length;
  console.log(`${off.length ? "✗" : "✓"}  ${f}: ${n} patterns${off.length ? `, ${off.length} not once` : ""}`);
  for (const o of off) console.log(`     ${o}`);
}
console.log(`\n${total} patterns, ${bad} not matching once`);
process.exit(bad ? 1 : 0);
