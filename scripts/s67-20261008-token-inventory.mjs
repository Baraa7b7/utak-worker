// § 67 ز (2026-10-08) — read-only inventory of every place that carries a worker token:
// Odoo server actions (webhook_url and code), URL actions and views that name the worker's host.
// A token is NEVER printed: each one is shown as a tag (the first 6 hex of its SHA-256), so two places
// with the same tag carry the same token and nothing can be read back from the tag.
//
//   node scripts/s67-20261008-token-inventory.mjs > scripts/artifacts/logs/s67-token-inventory.log 2>&1
import { readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { scrub, secretOf, tag, workerUrls } from "./lib/s67-token.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const seen = []; // every token read: scrub() turns each into its tag, whatever line it lands in
const say = (...a) => console.log(scrub(a.join(" "), seen));

const lines = [];
const tags = {};
const note = (where, id, name, active, text) => {
  for (const u of workerUrls(text)) {
    if (u.token) seen.push(u.token);
    const t = u.token ? tag(u.token) : "-";
    lines.push(`${where} #${id}${active === false ? " (off)" : ""} «${String(name).slice(0, 50)}» → ${u.host} ${u.path} token=${t} secret=${secretOf(u.path) ?? "-"}`);
    if (u.token) (tags[t] ??= new Set()).add(`${u.host} ${u.path.split("/").slice(0, 3).join("/")}`);
  }
};

const acts = await call("ir.actions.server", "search_read", { domain: ["|", ["webhook_url", "ilike", "utak-worker"], ["code", "ilike", "utak-worker"]], fields: ["id", "name", "state", "webhook_url", "code"], order: "id asc", context: ALL });
for (const a of acts) note(`ir.actions.server[${a.state}]`, a.id, a.name, undefined, `${a.webhook_url || ""}\n${a.code || ""}`);
await pause();
const urls = await call("ir.actions.act_url", "search_read", { domain: [["url", "ilike", "utak-worker"]], fields: ["id", "name", "url"], order: "id asc", context: ALL });
for (const a of urls) note("ir.actions.act_url", a.id, a.name, undefined, a.url);
await pause();
const views = await call("ir.ui.view", "search_read", { domain: [["arch_db", "ilike", "utak-worker"]], fields: ["id", "name", "active", "arch_db"], order: "id asc", context: ALL });
for (const v of views) note("ir.ui.view", v.id, v.name, v.active, v.arch_db);
await pause();
// which of those actions an automation or a scheduled job runs (they stop with the token, too)
const autos = await call("base.automation", "search_read", { domain: [["action_server_ids", "in", acts.map((a) => a.id)]], fields: ["id", "name", "active", "action_server_ids"], order: "id asc", context: ALL });

say(`## Odoo places that name the worker (${lines.length} URL(s) in ${acts.length} server action(s), ${urls.length} URL action(s), ${views.length} view(s))`);
say(lines.join("\n"));
say(`\n## automations that run one of them\n${autos.map((a) => `base.automation #${a.id}${a.active ? "" : " (off)"} «${a.name}» → actions ${a.action_server_ids.filter((i) => acts.some((x) => x.id === i)).join(",")}`).join("\n") || "(none)"}`);
say(`\n## distinct tokens (by tag) and the routes each one opens\n${Object.entries(tags).map(([t, s]) => `${t}: ${[...s].sort().join(" · ")}`).join("\n")}`);

// the local file's names (values never read into the output), and where src reads each secret
const names = readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.slice(0, l.indexOf("=")).trim());
say(`\n## .env.sim-verify — names only\n${names.join(", ")}`);
const local = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
say(`\n## local values that are one of Odoo's tokens (by tag)\n${Object.entries(local).filter(([, v]) => v && tags[tag(v)]).map(([k, v]) => `${k} = tag ${tag(v)}`).join("\n") || "(none)"}`);
