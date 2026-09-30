// § 34 (2026-09-25): the Odoo side of «فتح المحادثة» and the payment receipt.
//
//   1. five values on x_whatsapp_template.x_purpose:
//        conv_open_customer / conv_open_team / conv_open_supplier / conv_open_owner
//        («فتح المحادثة» per recipient category, src/wa-opener.ts), and
//        customer_payment_received (the receipt's template outside the window);
//   2. a row per new template (utak_update_customer / _team / _supplier / _owner)
//      with its purpose, status and category from Meta (GET). The gateway uses
//      a row only when it says APPROVED and UTILITY, so a pending one waits,
//      and one Meta rejects or files as MARKETING is never used (the 05:00 sync
//      and --refresh below keep status and category current);
//   3. #56 utak_payment_received → customer_payment_received, only if Meta has
//      it APPROVED, UTILITY, with 2 variables.
//
//   node scripts/s34-20260925-odoo.mjs                     dry-run (default): prints the plan, writes nothing
//   node scripts/s34-20260925-odoo.mjs --apply             snapshot first, then write
//   node scripts/s34-20260925-odoo.mjs --verify            read-only checks
//   node scripts/s34-20260925-odoo.mjs --refresh [--apply] status / category of the 4 + #56 from Meta
//   node scripts/s34-20260925-odoo.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/s34-20260925-odoo-rollback.json — #56 back to its
// old purpose; the four rows set to x_purpose=other and archived-in-name
// («(ملغى)»), never deleted; the selection values removed only if no row uses
// them. Graph is GET only here; no WhatsApp send. Tenant shared with prod.
import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { OPENER_TEMPLATES } from "./s34-20260925-opener-templates.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") && (init?.method ?? "GET") !== "GET") throw new Error("BLOCKED: Graph is GET only");
  return realFetch(input, init);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const VERIFY = process.argv.includes("--verify");
const REFRESH = process.argv.includes("--refresh");
const RB = new URL("./artifacts/s34-20260925-odoo-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

const SELECTIONS = [
  ["conv_open_customer", "فتح المحادثة (عميل) — utak_update_customer"],
  ["conv_open_team", "فتح المحادثة (فريق) — utak_update_team"],
  ["conv_open_supplier", "فتح المحادثة (مورد) — utak_update_supplier"],
  ["conv_open_owner", "فتح المحادثة (المالك) — utak_update_owner"],
  ["customer_payment_received", "إيصال الدفع (قالب خارج النافذة)"],
];
const RECEIPT_ROW = 56;
const RECEIPT_NAME = "utak_payment_received";
const RECEIPT_PURPOSE = "customer_payment_received";

async function metaTemplate(name) {
  const r = await fetch(`https://graph.facebook.com/v22.0/2144001136512196/message_templates?name=${name}&fields=id,name,status,category,components,language`, {
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  });
  const t = (await r.json()).data?.find((x) => x.name === name && (x.language ?? "ar") === "ar");
  if (!t) return null;
  const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
  const buttons = t.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  return { id: t.id, status: t.status, category: t.category, vars: new Set(body.match(/\{\{\d+\}\}/g) ?? []).size, body, buttons: buttons.map((b) => `${b.type}:${b.text}`) };
}

const [field] = await call("ir.model.fields", "search_read", {
  domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]], fields: ["id", "ttype"],
});
if (!field || field.ttype !== "selection") throw new Error("x_purpose selection field not found");
const fg = await call("x_whatsapp_template", "fields_get", { attributes: ["type"] });
for (const f of ["x_meta_template_id", "x_language", "x_meta_status", "x_category", "x_param_count", "x_purpose", "x_label_ar", "x_meta_id"]) {
  if (!fg[f]) throw new Error(`x_whatsapp_template.${f} missing — stop`);
}

async function selectionId(value) {
  const s = await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", field.id], ["value", "=", value]], fields: ["id"] });
  return s[0]?.id ?? null;
}
async function rowByName(name) {
  const r = await call("x_whatsapp_template", "search_read", {
    domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]],
    fields: ["id", "x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_label_ar", "x_meta_id"],
  });
  return r[0] ?? null;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  log(`#${RECEIPT_ROW}: x_purpose ← ${rb.receiptBefore?.x_purpose}`);
  if (APPLY && rb.receiptBefore) await call("x_whatsapp_template", "write", { ids: [RECEIPT_ROW], vals: { x_purpose: rb.receiptBefore.x_purpose } });
  for (const id of rb.rowsCreated ?? []) {
    const [r] = await call("x_whatsapp_template", "read", { ids: [id], fields: ["id", "x_meta_template_id", "x_label_ar"] });
    if (!r) continue;
    const label = String(r.x_label_ar || "").startsWith("(ملغى)") ? r.x_label_ar : `(ملغى) ${r.x_label_ar || r.x_meta_template_id}`;
    log(`#${id} ${r.x_meta_template_id}: x_purpose ← other, label «${label}» (not deleted)`);
    if (APPLY) await call("x_whatsapp_template", "write", { ids: [id], vals: { x_purpose: "other", x_label_ar: label } });
  }
  for (const [value, id] of Object.entries(rb.selectionsCreated ?? {})) {
    const used = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", value]] });
    if (used) log(`keep selection ${value} #${id}: ${used} row(s) still use it`);
    else { log(`remove selection ${value} #${id}`); if (APPLY) await call("ir.model.fields.selection", "unlink", { ids: [id] }); }
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- Meta (GET)
const meta = {};
for (const t of OPENER_TEMPLATES) meta[t.name] = await metaTemplate(t.name);
meta[RECEIPT_NAME] = await metaTemplate(RECEIPT_NAME);
for (const [n, m] of Object.entries(meta)) log(`Meta ${n}: ${m ? `${m.status}/${m.category}, ${m.vars} var(s), buttons ${JSON.stringify(m.buttons)}` : "MISSING"}`);

// ---------------------------------------------------------------- verify
if (VERIFY) {
  let ok = 0, bad = 0;
  const check = (name, cond, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name} ${detail}`); } };
  for (const [value] of SELECTIONS) check(`selection ${value}`, !!(await selectionId(value)));
  for (const t of OPENER_TEMPLATES) {
    const r = await rowByName(t.name);
    check(`${t.name}: one row, purpose ${t.purpose}`, r?.x_purpose === t.purpose, JSON.stringify(r));
    check(`${t.name}: 2 variables, Arabic label`, r?.x_param_count === 2 && r?.x_label_ar === t.label, JSON.stringify(r));
    check(`${t.name}: status/category = Meta`, !!meta[t.name] && r?.x_meta_status === meta[t.name].status && r?.x_category === meta[t.name].category,
      `${r?.x_meta_status}/${r?.x_category} vs ${meta[t.name]?.status}/${meta[t.name]?.category}`);
    const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", t.purpose]], fields: ["id"] });
    check(`${t.purpose}: exactly one row`, holders.length === 1, JSON.stringify(holders));
  }
  const [p56] = await call("x_whatsapp_template", "read", { ids: [RECEIPT_ROW], fields: ["x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_param_count"] });
  check(`#${RECEIPT_ROW} ${RECEIPT_NAME} → ${RECEIPT_PURPOSE}`, p56?.x_meta_template_id === RECEIPT_NAME && p56?.x_purpose === RECEIPT_PURPOSE, JSON.stringify(p56));
  check(`#${RECEIPT_ROW} APPROVED/UTILITY, 2 variables`, p56?.x_meta_status === "APPROVED" && p56?.x_category === "UTILITY" && p56?.x_param_count === 2, JSON.stringify(p56));
  const dup = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", RECEIPT_PURPOSE]], fields: ["id"] });
  check(`${RECEIPT_PURPOSE}: exactly one row`, dup.length === 1, JSON.stringify(dup));
  const auto = await call("base.automation", "search_read", { domain: [["model_id.model", "=", "x_whatsapp_template"]], fields: ["id", "name", "filter_domain"] }).catch(() => []);
  check("no automation on x_whatsapp_template filters on the new purposes", !auto.some((a) => /conv_open|customer_payment_received/.test(String(a.filter_domain))), JSON.stringify(auto));
  log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- refresh
if (REFRESH) {
  for (const name of [...OPENER_TEMPLATES.map((t) => t.name), RECEIPT_NAME]) {
    const r = await rowByName(name);
    const m = meta[name];
    if (!r || !m) { log(`${name}: row ${r?.id ?? "-"} / Meta ${m ? "ok" : "missing"} — skipped`); continue; }
    if (r.x_meta_status === m.status && r.x_category === m.category) { log(`= #${r.id} ${name}: ${m.status}/${m.category}`); continue; }
    log(`✎ #${r.id} ${name}: ${r.x_meta_status}/${r.x_category} → ${m.status}/${m.category}`);
    if (APPLY) await call("x_whatsapp_template", "write", { ids: [r.id], vals: { x_meta_status: m.status, x_category: m.category, x_meta_id: m.id } });
  }
  log(APPLY ? "refresh done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- plan / apply
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : {
  script: "scripts/s34-20260925-odoo.mjs", createdAt: new Date().toISOString(),
  selectionsCreated: {}, rowsCreated: [], receiptBefore: null,
};
const [p56] = await call("x_whatsapp_template", "read", { ids: [RECEIPT_ROW], fields: ["id", "x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_param_count"] });
if (p56?.x_meta_template_id !== RECEIPT_NAME) throw new Error(`#${RECEIPT_ROW} is not ${RECEIPT_NAME}: ${JSON.stringify(p56)}`);
rb.receiptBefore ??= { x_purpose: p56.x_purpose, x_meta_status: p56.x_meta_status, x_category: p56.x_category, x_param_count: p56.x_param_count };
if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
log(`snapshot: ${APPLY ? RB : "(dry-run, not written)"}`);

for (const [value, name] of SELECTIONS) {
  const id = await selectionId(value);
  if (id) { log(`= selection ${value} #${id}`); continue; }
  log(`+ selection ${value} «${name}»`);
  if (APPLY) {
    const created = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: field.id, value, name }] });
    rb.selectionsCreated[value] = Array.isArray(created) ? created[0] : created;
    writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  }
}

for (const t of OPENER_TEMPLATES) {
  const m = meta[t.name];
  if (!m) throw new Error(`${t.name} missing at Meta — run scripts/s34-20260925-opener-templates.mjs --meta first`);
  if (m.vars !== 2) throw new Error(`${t.name}: ${m.vars} variables at Meta (2 expected) — stop`);
  const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", t.purpose]], fields: ["id", "x_meta_template_id"] });
  const r = await rowByName(t.name);
  if (holders.some((h) => h.id !== r?.id)) throw new Error(`${t.purpose} already on another row ${JSON.stringify(holders)} — stop`);
  const vals = { x_meta_status: m.status, x_category: m.category, x_param_count: 2, x_purpose: t.purpose, x_label_ar: t.label, x_meta_id: m.id };
  if (r) {
    const diff = Object.entries(vals).filter(([k, v]) => r[k] !== v);
    if (!diff.length) { log(`= #${r.id} ${t.name} (${m.status}/${m.category}) on ${t.purpose}`); continue; }
    log(`✎ #${r.id} ${t.name}: ${diff.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    if (APPLY) await call("x_whatsapp_template", "write", { ids: [r.id], vals: Object.fromEntries(diff) });
    continue;
  }
  log(`+ row ${t.name} (${m.status}/${m.category}) → ${t.purpose} «${t.label}»`);
  if (APPLY) {
    const created = await call("x_whatsapp_template", "create", { vals_list: [{ x_meta_template_id: t.name, x_language: "ar", ...vals }] });
    rb.rowsCreated.push(Array.isArray(created) ? created[0] : created);
    writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  }
}

const rm = meta[RECEIPT_NAME];
if (!rm || rm.status !== "APPROVED" || rm.category !== "UTILITY" || rm.vars !== 2) {
  log(`! ${RECEIPT_NAME} at Meta is ${rm ? `${rm.status}/${rm.category}/${rm.vars} vars` : "missing"} — #${RECEIPT_ROW} not moved (the receipt stays held outside the window)`);
} else if (p56.x_purpose === RECEIPT_PURPOSE) {
  log(`= #${RECEIPT_ROW} already on ${RECEIPT_PURPOSE}`);
} else {
  const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", RECEIPT_PURPOSE]], fields: ["id"] });
  if (holders.length) throw new Error(`${RECEIPT_PURPOSE} already on ${JSON.stringify(holders)} — stop`);
  log(`✎ #${RECEIPT_ROW} ${RECEIPT_NAME}: x_purpose ${p56.x_purpose} → ${RECEIPT_PURPOSE}`);
  if (APPLY) await call("x_whatsapp_template", "write", { ids: [RECEIPT_ROW], vals: { x_purpose: RECEIPT_PURPOSE, x_meta_status: rm.status, x_category: rm.category, x_param_count: 2 } });
}
log(APPLY ? "applied — run --verify" : "dry-run: nothing written (add --apply)");
