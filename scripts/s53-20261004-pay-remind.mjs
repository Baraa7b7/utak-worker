// § 53 هـ (2026-10-04): the pay reminder that carries the IBAN, utak_pay_remind_iban_v1, at Meta.
//
//   node scripts/s53-20261004-pay-remind.mjs              dry-run: the template's text, and what Meta has (GET only)
//   node scripts/s53-20261004-pay-remind.mjs --template   POST it ONCE, if the name does not exist (never a retry)
//   node scripts/s53-20261004-pay-remind.mjs --status     GET: its status / category (written to the artifact)
//
// Meta: no delete, no edit. A template refused or filed MARKETING is not re-submitted (§ 53 هـ: one
// submission): the worker keeps the reminder of before (utak_pay_remind_v3). No WhatsApp send here.
// Out: scripts/artifacts/s53-20261004-pay-remind-meta.json (id and statuses; no token).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PAY_REMIND_IBAN, payRemindPayload } from "./lib/s53-templates.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const V = "v22.0", WABA = "2144001136512196";
const OUT = new URL("./artifacts/s53-20261004-pay-remind-meta.json", import.meta.url).pathname;
const has = (f) => process.argv.includes(f);
const log = (...a) => console.log(...a);
const graph = async (path, init = {}) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { ...init, headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, ...(init.headers ?? {}) } });
  return { http: r.status, json: await r.json().catch(() => ({})) };
};
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s53-20261004-pay-remind.mjs", template: null, history: [] };
const save = () => writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

async function atMeta(name) {
  let url = `${WABA}/message_templates?limit=100&fields=id,name,language,status,category,previous_category,rejected_reason,components`;
  while (url) {
    const r = await graph(url);
    if (r.json.error) throw new Error(JSON.stringify(r.json.error));
    const m = (r.json.data ?? []).find((x) => x.name === name);
    if (m) return m;
    url = r.json.paging?.next ? r.json.paging.next.replace(`https://graph.facebook.com/${V}/`, "") : null;
  }
  return null;
}

const t = PAY_REMIND_IBAN;
log(`${t.name}\n  «${t.body}»\n  example ${JSON.stringify(t.example)} · UTILITY · ${t.language} · ${[...t.body].length} characters`);
let tpl = await atMeta(t.name);
if (tpl) log(`  = exists at Meta: #${tpl.id} ${tpl.status}/${tpl.category}${tpl.previous_category ? ` (was ${tpl.previous_category})` : ""}${tpl.rejected_reason && tpl.rejected_reason !== "NONE" ? ` — ${tpl.rejected_reason}` : ""} — not re-submitted`);
else if (!has("--template")) log("  + would POST (dry-run)");
else {
  const payload = payRemindPayload();
  const r = await graph(`${WABA}/message_templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  report.templateCreated = { at: new Date().toISOString(), http: r.http, response: r.json, payload };
  report.history.push({ at: new Date().toISOString(), what: "template", http: r.http, response: r.json });
  save();
  log(`  → POST ${r.http} ${JSON.stringify(r.json)}`);
  tpl = await atMeta(t.name);
}
const old = await atMeta(t.replaces);
log(`  ${t.replaces} (the reminder of before, not touched): ${old ? `${old.status}/${old.category}` : "not at Meta"}`);
if (tpl || has("--status") || has("--template")) {
  report.template = tpl ? { id: tpl.id, name: tpl.name, status: tpl.status, category: tpl.category, previous_category: tpl.previous_category ?? null, rejected_reason: tpl.rejected_reason ?? null, body: (tpl.components ?? []).find((c) => c.type === "BODY")?.text ?? null, at: new Date().toISOString() } : null;
  report.before = old ? { name: old.name, status: old.status, category: old.category } : null;
  save();
}
log("template:", JSON.stringify(report.template));
