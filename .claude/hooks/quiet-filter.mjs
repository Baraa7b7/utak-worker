#!/usr/bin/env node
// § 55.1 (2026-10-05) — the filter behind .claude/hooks/filter-test-output.sh. It reads everything a
// test or mutation command printed (stdin) and prints the failures and the summary only:
//
//   (default)  the command is quiet already — `npm test`, the all-mutations runner, the pattern scan:
//              its «✓» lines and the lines of the files that passed are dropped, the rest is kept as it is.
//   --raw      a test file or a mutation script run on its own (every check is a line): «✗» lines with
//              their details, the summary lines, and the end of the output when it died.
//
// The last line of stdin is «::utak-rc=N», the exit code of the command (written by the hook): the
// filter exits with it, so a failing test still fails. What it reads is classified by tests/quiet.mjs;
// if that cannot be loaded, everything is printed as it came.
import { readFileSync } from "node:fs";

const raw = readFileSync(0, "utf8");
const mark = /(?:^|\n)::utak-rc=(\d+)\s*$/.exec(raw);
const rc = mark ? Number(mark[1]) : 0;
const text = mark ? raw.slice(0, mark.index) : raw;
const RAW = process.argv.includes("--raw");

let out;
try {
  const { quiet, isFileOk, isNoise, isPass } = await import(new URL("../../tests/quiet.mjs", import.meta.url));
  const lines = text.split("\n");
  let kept, pass, okFiles = 0;
  if (RAW) {
    const q = quiet(text, { rc });
    kept = q.kept; pass = q.pass;
    // never nothing: a command that printed no summary line still shows how it ended
    if (!kept.length) kept = lines.filter((l) => l.trim() && !isPass(l) && !isNoise(l)).slice(-3);
  } else {
    pass = lines.filter(isPass).length;
    okFiles = lines.filter(isFileOk).length;
    kept = lines.filter((l) => !isPass(l) && !isFileOk(l) && !isNoise(l));
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    kept = kept.filter((l, i) => l.trim() || (kept[i - 1] ?? "").trim());
  }
  const other = lines.filter((l) => l.trim() && !isNoise(l)).length - kept.filter((l) => l.trim()).length - pass - okFiles;
  const hidden = [pass ? `${pass} ✓ lines` : "", okFiles ? `${okFiles} passing files` : "", other > 0 ? `${other} other lines` : ""].filter(Boolean);
  out = kept.join("\n") + (hidden.length ? `\n[quiet-filter] hidden: ${hidden.join(", ")} — VERBOSE=1 before the command shows all` : "");
} catch (e) {
  out = `${text}\n[quiet-filter] not filtered (${e?.message ?? e})`;
}
process.stdout.write(out.replace(/\n*$/, "\n"));
process.exit(rc);
