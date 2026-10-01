// § 46 و (2026-10-01) — after the prod deploy, read-only: the first scheduled invocations on prod seen
// live by `wrangler tail` (their cron, time, outcome, exceptions and console.error lines), and
// nothing scheduled on sim. Then the schedules of both workers, /health, and Meta's webhook
// (scripts/s45-20260930-prod-check.mjs and scripts/s46-20261001-step0.mjs print those).
//
//   node scripts/s46-20261001-after-deploy.mjs [--minutes=9]
//
// Out: scripts/artifacts/s46-20261001-after-deploy.json
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { splitJsonObjects } from "./lib/tail-ticks.mjs";

const root = new URL("../", import.meta.url).pathname;
const MINUTES = Number(process.argv.find((a) => a.startsWith("--minutes="))?.slice(10) ?? 9);
const riyadh = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(11, 19);
const started = Date.now();
const seen = { "utak-worker": [], "utak-worker-sim": [] };

function watch(worker) {
  let buf = "";
  const child = spawn("npx", ["wrangler", "tail", worker, "--format", "json"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    const { objects, rest } = splitJsonObjects(buf);
    buf = rest;
    for (const o of objects) {
      if (!o?.event || typeof o.event.cron !== "string") continue;
      const errors = (o.logs ?? []).filter((l) => l.level === "error").map((l) => (l.message ?? []).map(String).join(" ").slice(0, 300));
      const row = { cron: o.event.cron, at: riyadh(Number(o.eventTimestamp ?? Date.now())), outcome: o.outcome, exceptions: (o.exceptions ?? []).map((e) => `${e.name}: ${e.message}`.slice(0, 300)), errors, logs: (o.logs ?? []).length };
      seen[worker].push(row);
      console.log(`${worker} "${row.cron}" @ ${row.at} — ${row.outcome}${row.exceptions.length ? ` · exceptions: ${row.exceptions.join(" | ")}` : ""}${errors.length ? ` · console.error: ${errors.join(" | ")}` : ""}`);
    }
  });
  return child;
}
const tails = [watch("utak-worker"), watch("utak-worker-sim")];
console.log(`wrangler tail on prod and sim from ${riyadh(started)} (Riyadh), up to ${MINUTES} minutes…`);
const five = () => seen["utak-worker"].filter((t) => t.cron === "*/5 * * * *");
while (Date.now() - started < MINUTES * 60_000 && !(five().length >= 1 && seen["utak-worker"].length >= 2)) await new Promise((r) => setTimeout(r, 2000));
// a little longer, so the driver tick two minutes later is seen as well
const until = Date.now() + 20_000;
while (Date.now() < until) await new Promise((r) => setTimeout(r, 2000));
for (const t of tails) t.kill();
const first = five()[0] ?? null;
const out = { startedRiyadh: riyadh(started), endedRiyadh: riyadh(Date.now()), firstFiveMinuteTickOnProd: first, prod: seen["utak-worker"], sim: seen["utak-worker-sim"] };
writeFileSync(new URL("./artifacts/s46-20261001-after-deploy.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(first ? `\n✓ أول نبضة */5 على prod بعد النشر: ${first.at} (${first.outcome})${first.exceptions.length || first.errors.length ? " — مع أخطاء، راجعها" : "، بلا استثناء ولا console.error"}` : `\n✗ لم تُر نبضة */5 على prod في ${MINUTES} دقائق`);
console.log(seen["utak-worker-sim"].length ? `✗ sim شغّل ${seen["utak-worker-sim"].length} موعداً` : "✓ لا تشغيل مجدول على sim");
process.exit(first && !seen["utak-worker-sim"].length ? 0 : 1);
