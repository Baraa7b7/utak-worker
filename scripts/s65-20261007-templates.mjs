// § 65 (2026-10-07): the two templates of the suppliers' registry at Meta (scripts/lib/s65-flows.mjs) —
//   utak_supplier_invite_v1    «📨 أرسل رابط التسجيل» outside the number's window (a «تسجيل مورد» button)
//   utak_supplier_checkin_v1   the periodic check-in of an approved supplier outside his window («عرض مورد»)
//
//   node scripts/s65-20261007-templates.mjs              dry-run: the texts, and what Meta has (GET only)
//   node scripts/s65-20261007-templates.mjs --template   POST each ONCE, if its name does not exist (never a retry)
//   node scripts/s65-20261007-templates.mjs --status     GET: their status / category (written to the artifact)
//
// Meta: no delete, no edit. Refused or filed MARKETING → not re-submitted (one submission): the worker never
// uses it — «📨 أرسل رابط التسجيل» shows Baraa the invitation's text to send himself, and a check-in outside
// the window waits. No WhatsApp send here.
// Out: scripts/artifacts/s65-20261007-templates-meta.json (ids and statuses; no token).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { templateComponents, textProblems } from "./lib/s59-templates.mjs";
import { S65_TEMPLATES } from "./lib/s65-flows.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOKEN = env.META_ACCESS_TOKEN;
const V = "v22.0", WABA = "2144001136512196", APP_ID = "2331128704328678";
const OUT = new URL("./artifacts/s65-20261007-templates-meta.json", import.meta.url).pathname;
const has = (f) => process.argv.includes(f);
const log = (...a) => console.log(...a);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(`https://graph.facebook.com/${V}/`)) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (/\/messages(\?|$)/.test(url)) throw new Error("BLOCKED: a message send");
  return realFetch(input, init);
};
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s65-20261007-templates.mjs", templates: {}, history: [] };
const save = () => writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

async function inventory() {
  const out = new Map();
  let url = `https://graph.facebook.com/${V}/${WABA}/message_templates?limit=100&fields=id,name,language,status,category,previous_category,rejected_reason,components`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`meta GET HTTP ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    for (const x of j.data ?? []) out.set(x.name, x);
    url = j.paging?.next ?? null;
  }
  return out;
}
/** The sample PDF of the document header (the root's quotation.pdf, as utak_quotation_pdf_v1's). */
async function uploadPdfHandle() {
  const buf = readFileSync(new URL("../quotation.pdf", import.meta.url).pathname);
  const start = await fetch(`https://graph.facebook.com/${V}/${APP_ID}/uploads?file_length=${buf.length}&file_type=application/pdf`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
  const sj = await start.json();
  if (!start.ok || !sj.id) throw new Error(`upload start HTTP ${start.status}: ${JSON.stringify(sj).slice(0, 300)}`);
  const up = await fetch(`https://graph.facebook.com/${V}/${sj.id}`, { method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, file_offset: "0" }, body: buf });
  const uj = await up.json();
  if (!up.ok || !uj.h) throw new Error(`upload HTTP ${up.status}: ${JSON.stringify(uj).slice(0, 300)}`);
  return uj.h;
}
const shape = (m) => (m ? {
  id: m.id, name: m.name, status: m.status, category: m.category, previous_category: m.previous_category ?? null, rejected_reason: m.rejected_reason ?? null,
  header: (m.components ?? []).find((c) => c.type === "HEADER")?.format ?? null,
  body: (m.components ?? []).find((c) => c.type === "BODY")?.text ?? null,
  buttons: ((m.components ?? []).find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b) => `${b.type}:${b.text}`),
} : null);

let bad = 0;
for (const t of S65_TEMPLATES) {
  const p = textProblems(t);
  log(`${p.length ? "✗" : "✓"} ${t.name} [${t.purpose}] ${t.params} variable(s)${t.documentHeader ? ", DOCUMENT header" : ""}${t.buttons.length ? `, button «${t.buttons.map((b) => b.text).join("» «")}»` : ""}${p.length ? " — " + p.join("; ") : ""}`);
  log(`    «${t.body}»\n    example ${JSON.stringify(t.example)} · UTILITY · ${t.language} · ${[...t.body].length} characters`);
  bad += p.length;
}
if (bad) { console.error(`${bad} text problem(s) — nothing sent`); process.exit(1); }

let inv = await inventory();
for (const t of S65_TEMPLATES) {
  const m = inv.get(t.name);
  if (m) { log(`  = ${t.name} exists at Meta: #${m.id} ${m.status}/${m.category}${m.previous_category ? ` (was ${m.previous_category})` : ""}${m.rejected_reason && m.rejected_reason !== "NONE" ? ` — ${m.rejected_reason}` : ""}`); continue; }
  if (!has("--template")) { log(`  + ${t.name}: would POST (dry-run)`); continue; }
  // a body with no variable takes no example (Meta refuses an empty one)
  const components = templateComponents(t, t.documentHeader ? await uploadPdfHandle() : null).map((c) => (c.type === "BODY" && !t.params ? { type: "BODY", text: t.body } : c));
  const payload = { name: t.name, language: t.language, category: "UTILITY", components };
  const r = await fetch(`https://graph.facebook.com/${V}/${WABA}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  report.history.push({ at: new Date().toISOString(), what: "template", name: t.name, http: r.status, response: j, payload: { ...payload, components: components.map((c) => (c.type === "HEADER" ? { type: c.type, format: c.format } : c)) } });
  save();
  log(`  → ${t.name}: POST ${r.status} ${JSON.stringify(j)}`);
}
if (has("--template")) { await new Promise((res) => setTimeout(res, 15000)); inv = await inventory(); }
for (const t of S65_TEMPLATES) {
  const m = inv.get(t.name);
  if (m || has("--status") || has("--template")) report.templates[t.name] = { ...(shape(m) ?? { name: t.name, status: "NOT_AT_META" }), readAt: new Date().toISOString() };
  if (t.replaces) { const old = inv.get(t.replaces); log(`  ${t.replaces} (of before, not touched): ${old ? `${old.status}/${old.category}` : "not at Meta"}`); }
  log(`${t.name}: ${JSON.stringify(report.templates[t.name] ?? shape(m))}`);
}
if (Object.keys(report.templates).length) save();
