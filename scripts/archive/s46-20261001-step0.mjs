// § 46 (2026-10-01) — step 0, read-only: where Meta's webhook and Odoo's worker links point.
//   · Meta: the phone's webhook_configuration (GET, the token of .env.sim-verify, never printed)
//   · Odoo: every ir.actions.server / base.automation / ir.cron / ir.config_parameter carrying a
//     worker host, counted by host (search_read only)
//
//   node scripts/archive/s46-20261001-step0.mjs
//
// Out: scripts/artifacts/s46-20261001-step0.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "../lib/odoo-cli.mjs";

const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const PROD_HOST = "utak-worker.utak-business.workers.dev";
const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";
const PHONE = "1351691708016803";
const out = { atRiyadh: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") };

const ph = await (await fetch(`https://graph.facebook.com/v22.0/${PHONE}?fields=webhook_configuration`, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } })).json();
out.metaPhoneWebhook = ph?.webhook_configuration ?? { error: ph?.error?.message ?? "?" };
console.log(`Meta phone webhook_configuration → ${JSON.stringify(out.metaPhoneWebhook)}`);

const hostOf = (text) => (String(text ?? "").includes(SIM_HOST) ? "sim" : String(text ?? "").includes(PROD_HOST) ? "prod" : null);
out.odoo = { prod: [], sim: [] };
const scan = async (model, fields, texts, domain) => {
  const rows = await call(model, "search_read", { domain, fields, context: { active_test: false } });
  for (const r of rows) for (const f of texts) {
    const h = hostOf(r[f]);
    if (h) out.odoo[h].push(`${model} #${r.id} ${r.name ?? r.key ?? ""} (${f})`);
  }
};
const either = (f) => ["|", [f, "ilike", SIM_HOST], [f, "ilike", PROD_HOST]];
await scan("ir.actions.server", ["id", "name", "webhook_url", "code"], ["webhook_url", "code"], ["|", ...either("webhook_url"), ...either("code")]);
const bf = await call("base.automation", "fields_get", { attributes: ["type"] });
if ("url" in bf) await scan("base.automation", ["id", "name", "url"], ["url"], []);
await scan("ir.cron", ["id", "name", "code"], ["code"], either("code"));
await scan("ir.config_parameter", ["id", "key", "value"], ["value"], either("value"));
console.log(`Odoo links → prod ${out.odoo.prod.length} · sim ${out.odoo.sim.length}`);
for (const l of out.odoo.sim) console.log(`  ✗ sim: ${l}`);
const actions = new Set(out.odoo.prod.filter((l) => l.startsWith("ir.actions.server")).map((l) => l.split(" ")[1]));
console.log(`  ir.actions.server على prod: ${actions.size}`);
writeFileSync(new URL("scripts/artifacts/s46-20261001-step0.json", root), JSON.stringify(out, null, 2) + "\n");
