// § 46 هـ (2026-10-01) — the scheduled invocations seen live by `wrangler tail <worker> --format json`.
//
// On 2026-09-30 Cloudflare's scheduled analytics lagged and the schedule change itself took 75
// minutes to act (STATUS § 45 ز): the cutover's «first tick» check ran out of its 12 minutes and
// the proof came from `wrangler tail`. scripts/cutover-prod.mts now waits up to 90 minutes and
// accepts either source.
//
// wrangler prints one JSON object per invocation (pretty-printed, so an object spans lines); a
// scheduled one carries event.cron.
import { spawn } from "node:child_process";

/** The complete top-level JSON objects of `text` (concatenated, pretty or one-line) and what is left. */
export function splitJsonObjects(text) {
  const objects = [];
  let depth = 0, start = -1, inString = false, escaped = false, consumed = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { if (depth > 0) inString = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not an event: skipped */ }
        consumed = i + 1;
        start = -1;
      }
    }
  }
  return { objects, rest: text.slice(consumed) };
}

/** The scheduled invocations among tail events: { cron, at (ISO), outcome, script }. */
export function scheduledTicks(objects) {
  return objects
    .filter((o) => o && typeof o === "object" && o.event && typeof o.event === "object" && typeof o.event.cron === "string")
    .map((o) => ({
      cron: o.event.cron,
      at: new Date(Number(o.eventTimestamp ?? o.event.scheduledTime ?? Date.now())).toISOString(),
      outcome: String(o.outcome ?? "?"),
      script: String(o.scriptName ?? ""),
    }));
}

/**
 * `wrangler tail <worker> --format json` in the background: `ticks` fills as scheduled
 * invocations arrive. A tail that ends is started again by `alive()`. `stop()` ends it.
 */
export function watchTail(worker, cwd) {
  const ticks = [];
  let child = null, buf = "", stopped = false;
  const start = () => {
    buf = "";
    child = spawn("npx", ["wrangler", "tail", worker, "--format", "json"], { cwd, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      const { objects, rest } = splitJsonObjects(buf);
      buf = rest.length > 2_000_000 ? "" : rest;
      for (const t of scheduledTicks(objects)) ticks.push({ ...t, script: t.script || worker });
    });
    child.on("error", () => { /* alive() starts it again */ });
  };
  start();
  return {
    ticks,
    alive() { if (!stopped && child && child.exitCode !== null) start(); },
    stop() { stopped = true; try { child?.kill(); } catch { /* gone */ } },
  };
}
