// § 55.1 (2026-10-05) — the one helper behind every quiet output: it reads what a test file, a
// mutation script or a whole run printed, and keeps the count of «✓», every «✗» with its details,
// the summary lines, and a crash's trace. Nothing here runs a test or changes a result: the test
// files print exactly what they printed before (VERBOSE=1 shows it all).
//
// Used by tests/run.mjs (`npm test`) and by .claude/hooks/quiet-filter.mjs (the PreToolUse hook's
// filter for a test file or a mutation script run on its own).

const PASS = /^\s*✓/;
const FAIL = /^\s*✗/;
/** A warning of a runner («⚠ modified tracked files are NOT in the copies»): kept with what follows it, not a failure. */
const WARN = /^\s*⚠/;
/** A section title of a test file («[3] …», «[ب2] …») or a worker log line («[gateway] …»): it ends a «✗» block. */
const HEADER = /^\s*\[[^\]]*\]/;
/** The end of a test file: its own counts, then (in most files) the failed names once more. */
const TAIL = /\d+ passed, \d+ failed|^\s*Failures?\s*:|^\s*failed\s*:\s*\d+/i;
/** A line that is a result on its own: kept whatever else is dropped. */
const SUMMARY = /\d+ ✓ \/ \d+ ✗|\d+ passed, \d+ failed|^\s*(passed|failed)\s*:\s*\d+|\d+\/\d+ caught|\d+ patterns, \d+ not matching|ALL PASSED|tests passed\.|^TOTAL |^verify: \d+\/\d+|stopped at the first failing file|not in the list/i;
/** One file of `npm test` that passed: «name: N ✓ / 0 ✗». */
const FILE_OK = /^\S+: \d+ ✓ \/ 0 ✗$/;
/** node's own three lines about --experimental-loader, and npm's echo of the command. */
const NOISE = /^\(node:\d+\) ExperimentalWarning|^--import 'data:text\/javascript|^\(Use `node --trace-warnings|^> /;
/** An uncaught exception: node ends its trace with its version. */
const CRASH_END = /^Node\.js v\d+/;
const CRASH_LINES = 40;

/**
 * Every line of `text`, classified. `rc` is the exit code of what printed it (0 when unknown).
 * Returns the lines worth reading, in their order, and the counts of what was left out.
 */
export function quiet(text, { rc = 0 } = {}) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  let pass = 0, fail = 0, tail = false, inFail = false, summaryFailed = 0;
  const keep = new Array(lines.length).fill(false);
  const tailFails = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (PASS.test(l)) { pass++; inFail = false; continue; }
    if (NOISE.test(l)) { inFail = false; continue; }
    const counts = /(\d+) passed, (\d+) failed/.exec(l) ?? /^\s*failed\s*:\s*()(\d+)/i.exec(l);
    if (counts) summaryFailed = Math.max(summaryFailed, Number(counts[2]));
    if (FAIL.test(l)) {
      // after the file's own counts the failed names are listed once more: the same failures
      if (tail) { tailFails.push(i); inFail = false; continue; }
      fail++; keep[i] = true; inFail = true; continue;
    }
    if (WARN.test(l)) { keep[i] = true; inFail = true; continue; }
    if (TAIL.test(l)) { tail = true; inFail = false; keep[i] = SUMMARY.test(l); continue; }
    if (SUMMARY.test(l)) { inFail = false; keep[i] = true; continue; }
    if (HEADER.test(l)) { inFail = false; continue; }
    // the rest of a «✗» whose detail runs over several lines
    if (inFail) keep[i] = true;
  }
  // a file that names its failures only at its end
  if (!fail && tailFails.length) { for (const i of tailFails) keep[i] = true; fail = tailFails.length; }
  fail = Math.max(fail, summaryFailed);
  // it died (an exception, a timeout) rather than failed a check: the end of what it printed, as it is
  const last = lines.length ? lines[lines.length - 1] : "";
  const crashed = rc !== 0 && (fail === 0 || CRASH_END.test(last));
  if (crashed) {
    let n = 0;
    for (let i = lines.length - 1; i >= 0 && n < CRASH_LINES; i--) {
      if (PASS.test(lines[i]) || NOISE.test(lines[i])) continue;
      keep[i] = true; n++;
    }
  }
  const kept = lines.filter((_, i) => keep[i]);
  // blank lines inside a kept block stay; at its end they go
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  return { pass, fail, crashed, kept, hidden: lines.length - kept.length, okFiles: lines.filter((l) => FILE_OK.test(l)).length };
}

/** `npm test`'s line of a file that passed: dropped by the hook's filter (the total says it). */
export const isFileOk = (line) => FILE_OK.test(line);
export const isPass = (line) => PASS.test(line);
export const isNoise = (line) => NOISE.test(line);
