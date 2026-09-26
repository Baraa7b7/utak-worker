// § 43 (2026-09-27) — the two cron blocks of wrangler.toml, parsed: prod's
// [triggers] and sim's [env.sim.triggers]. The launch invariant the tests pin:
// the twelve crons run on exactly ONE worker and the other has [] — sim until
// the cutover (scripts/cutover-prod.mts step 3 empties sim, step 4 fills prod),
// prod after it. Never both (every job would run twice on the one tenant and
// the one number, § 9), never neither.
import { readFileSync } from "node:fs";

/** The twelve crons, in wrangler.toml order (§ 38 / § 41). */
export const TWELVE = [
  "0 23 * * *", "0 2 * * *", "0 3 * * *", "0 17 * * *", "0 18 * * *", "15 18 * * *",
  "0 15 * * *", "0 14 * * *", "0 5 * * *", "*/5 * * * *", "2,7,12,17,22,27,32,37,42,47,52,57 * * * *", "30 18 * * *",
] as const;

function cronsAfter(toml: string, header: string): string[] {
  const i = toml.search(new RegExp(`^\\[${header.replace(/[.[\]]/g, "\\$&")}\\]\\s*$`, "m"));
  if (i < 0) throw new Error(`no [${header}] in wrangler.toml`);
  const m = /crons\s*=\s*\[([\s\S]*?)\]/.exec(toml.slice(i));
  if (!m) throw new Error(`no crons under [${header}]`);
  return m[1].split("\n").map((l) => l.replace(/#.*$/, "")).join("\n").match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)) ?? [];
}

export function cronBlocks(toml: string = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) {
  const prod = cronsAfter(toml, "triggers");
  const sim = cronsAfter(toml, "env.sim.triggers");
  const same = (a: string[]) => a.length === TWELVE.length && TWELVE.every((c) => a.includes(c));
  const active: "prod" | "sim" | null = same(prod) && sim.length === 0 ? "prod" : same(sim) && prod.length === 0 ? "sim" : null;
  return { prod, sim, active, activeCrons: active === "prod" ? prod : active === "sim" ? sim : [] };
}
