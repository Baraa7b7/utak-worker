// § 45 هـ (2026-09-30) — every mutation script on HEAD, each in its own copy of the tree (`git archive
// HEAD`, node_modules linked), N at a time: a mutation script edits src/ in place, so two can never
// share a tree, and the working tree is never touched.
//
//   node scripts/s45-20260930-mutations-all.mjs [--jobs=9] [--out=scripts/artifacts/<file>.txt]
//
// Out: scripts/artifacts/s45-20260930-mutations-all.txt (every script's caught / total), exit 1 on any miss.
// § 46 — --out=<file> writes a later run to its own file (the § 45 record stays as it was).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const JOBS = Number(process.argv.find((a) => a.startsWith("--jobs="))?.slice(7) ?? 9);
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "scripts/artifacts/s45-20260930-mutations-all.txt";
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim();
if (dirty) console.log(`⚠ modified tracked files are NOT in the copies (HEAD ${head} only):\n${dirty}`);
const scripts = readdirSync(join(root, "scripts")).filter((f) => /-mutations\.mjs$/.test(f)).sort();
const base = mkdtempSync(join(tmpdir(), "s45-mut-"));
const started = Date.now();

function copy(name) {
  const dir = join(base, name);
  execFileSync("mkdir", ["-p", dir]);
  execFileSync("sh", ["-c", `git archive HEAD | tar -x -C '${dir}'`], { cwd: root });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return dir;
}
function run(f) {
  return new Promise((resolve) => {
    const dir = copy(f.replace(/\.mjs$/, ""));
    const p = spawn("node", [join("scripts", f)], { cwd: dir });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => {
      const sum = /(\d+)\/(\d+) caught/.exec(out);
      const missed = out.split("\n").filter((l) => /MISSED|pattern found/.test(l));
      resolve({ f, code, caught: sum ? Number(sum[1]) : 0, total: sum ? Number(sum[2]) : 0, missed });
      rmSync(dir, { recursive: true, force: true });
    });
  });
}

const queue = [...scripts];
const results = [];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const r = await run(f);
    results.push(r);
    console.log(`${r.code === 0 && r.caught === r.total && r.total > 0 ? "✓" : "✗"} ${r.f}: ${r.caught}/${r.total}${r.missed.length ? `  — ${r.missed.slice(0, 3).join(" | ")}` : ""}`);
  }
}));
rmSync(base, { recursive: true, force: true });
results.sort((a, b) => a.f.localeCompare(b.f));
const caught = results.reduce((s, r) => s + r.caught, 0), total = results.reduce((s, r) => s + r.total, 0);
const ok = results.every((r) => r.code === 0 && r.caught === r.total && r.total > 0);
const text = [
  `# ${OUT.includes("s45-") ? "§ 45" : OUT.split("/").pop().split("-")[0].replace(/^s/, "§ ")} — every mutation script on HEAD ${head} (git archive copies, ${JOBS} in parallel), ${new Date().toISOString()}, ${Math.round((Date.now() - started) / 60000)} min`,
  ...results.map((r) => `=== ${r.f.replace(/-mutations\.mjs$/, "")}\n${r.caught}/${r.total} caught${r.missed.length ? `\n${r.missed.join("\n")}` : ""}`),
  `\nTOTAL ${caught}/${total} caught in ${results.length} scripts`,
].join("\n");
writeFileSync(join(root, OUT), text + "\n");
console.log(`\n${caught}/${total} caught in ${results.length} scripts — ${ok ? "all caught" : "NOT all caught"}`);
process.exit(ok ? 0 : 1);
