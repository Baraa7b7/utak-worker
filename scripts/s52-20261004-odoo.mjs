// § 52 (2026-10-04) — what Odoo needs: the company's bank account, the outside market source, and the
// row of the Flow's new template.
//
//   أ  res.partner.bank     the company's account (IBAN, holder «شركة يوتاك», bank «البنك السعودي الأول»)
//      account.journal BNK1  its «bank_account_id» = that account (the worker reads the transfer line
//                            through this journal: src/company.ts). No SWIFT is written unless --bic= is
//                            given: it must come from the bank's own published source.
//   ب  res.partner           «رائد», +966550689078: a price source whose role is «سوق», allowed on
//                            WhatsApp, neither a customer nor a supplier (both ranks 0), and classed
//                            «supplier» in the number review so that every customer automation skips him.
//                            Searched by number first: never a second partner.
//   د  x_whatsapp_template   the row of utak_price_ask_flow_v2 (ar) with the purpose price_ask_flow, its
//                            status and category as Meta has them (the last --status of
//                            scripts/s52-20261004-price-flow.mjs, from its artifact). The row of
//                            utak_price_ask_flow_v1 (filed MARKETING, never used) gives the purpose up
//                            («other»): one row per purpose.
//
//   node scripts/s52-20261004-odoo.mjs [أ] [ب] [د]            dry-run: the plan, nothing written
//   node scripts/s52-20261004-odoo.mjs [أ] [ب] [د] --apply    rollback file first, then write (idempotent)
//   node scripts/s52-20261004-odoo.mjs --verify               read-only checks
//   node scripts/s52-20261004-odoo.mjs --rollback [--apply]   the journal's account off and the account
//                                                              archived; رائد no longer a source, not allowed,
//                                                              archived; the v2 row's purpose «other» and the
//                                                              v1 row's purpose back. Nothing is deleted.
// No part named = every part. Rollback file: scripts/artifacts/s52-20261004-odoo-rollback.json. The
// tenant is production. No WhatsApp send. No price, order, invoice or payment is written here.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";
import { FLOW_TEMPLATE } from "./lib/s52-price-flow.mjs";

const RB = new URL("./artifacts/s52-20261004-odoo-rollback.json", import.meta.url);
const META = new URL("./artifacts/s52-20261004-price-flow-meta.json", import.meta.url);
const parts = ["أ", "ب", "د"].filter((p) => process.argv.includes(p));
const on = (p) => !parts.length || parts.includes(p);
const BIC = (process.argv.find((a) => a.startsWith("--bic=")) ?? "").slice(6).trim();

export const IBAN = "SA5945000000168295723001";
const HOLDER = "شركة يوتاك", BANK = "البنك السعودي الأول", JOURNAL = "BNK1";
const RAED = { name: "رائد", number: "+966550689078" };
const TPL = "x_whatsapp_template", V1 = "utak_price_ask_flow_v1";

/** ISO 13616: the country and check digits to the end, letters as numbers, mod 97 = 1. */
function ibanOk(iban) {
  const s = String(iban).replace(/\s+/g, "").toUpperCase();
  if (!/^SA\d{22}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}
if (!ibanOk(IBAN) || IBAN.length !== 24 || IBAN.slice(4, 6) !== "45") { log("✗ the IBAN does not check (24 characters, mod-97 = 1, bank code 45) — stop"); process.exit(1); }

const { rb, save } = rollbackFile(RB, "scripts/s52-20261004-odoo.mjs");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const BANK_FIELDS = ["id", "account_number", "sanitized_account_number", "holder_name", "bank_name", "bank_bic", "partner_id", "company_id", "active"];
const bankRows = async () => call("res.partner.bank", "search_read", { domain: [["sanitized_account_number", "=", IBAN]], fields: BANK_FIELDS, limit: 5, context: { active_test: false } });
const journal = async () => (await call("account.journal", "search_read", { domain: [["code", "=", JOURNAL]], fields: ["id", "name", "code", "type", "bank_account_id", "default_account_id"], limit: 2 }));
const RAED_FIELDS = ["id", "name", "phone", "x_whatsapp_number", "x_wa_allowed", "x_price_source", "x_price_role", "customer_rank", "supplier_rank", "x_contact_class", "x_review_pending", "active"];
const raedRows = async () => call("res.partner", "search_read", {
  domain: ["|", ["x_whatsapp_number", "ilike", RAED.number.slice(-9)], ["phone", "ilike", RAED.number.slice(-9)]], fields: RAED_FIELDS, limit: 5, context: { active_test: false },
});
const tplRows = async (name) => call(TPL, "search_read", {
  domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]],
  fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text", "x_buttons_text"], limit: 2,
});
function atMeta() {
  if (!existsSync(META)) return null;
  const t = JSON.parse(readFileSync(META, "utf8")).template;
  return t?.name === FLOW_TEMPLATE.name ? t : null;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  const [j] = await journal();
  if (j && c.bank && Array.isArray(j.bank_account_id) && j.bank_account_id[0] === c.bank) {
    log(`account.journal #${j.id} ${j.code}: bank_account_id #${c.bank} → ${JSON.stringify(b.journalBank ?? false)}`);
    if (APPLY) await call("account.journal", "write", { ids: [j.id], vals: { bank_account_id: b.journalBank ?? false } });
  }
  if (c.bank) { log(`res.partner.bank #${c.bank}: archived (not deleted)`); if (APPLY) await call("res.partner.bank", "write", { ids: [c.bank], vals: { active: false } }); }
  if (c.raed) {
    log(`res.partner #${c.raed} «${RAED.name}»: x_price_source off, x_wa_allowed off, archived (not deleted)`);
    if (APPLY) await call("res.partner", "write", { ids: [c.raed], vals: { x_price_source: false, x_wa_allowed: false, active: false } });
  }
  const [v2] = await tplRows(FLOW_TEMPLATE.name);
  if (v2) { log(`${TPL} #${v2.id} ${FLOW_TEMPLATE.name}: x_purpose ${v2.x_purpose} → other`); if (APPLY) await call(TPL, "write", { ids: [v2.id], vals: { x_purpose: "other" } }); }
  const [v1] = await tplRows(V1);
  if (v1 && b.v1Purpose) { log(`${TPL} #${v1.id} ${V1}: x_purpose ${v1.x_purpose} → ${b.v1Purpose}`); if (APPLY) await call(TPL, "write", { ids: [v1.id], vals: { x_purpose: b.v1Purpose } }); }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const banks = (await bankRows()).filter((r) => r.active !== false);
  const [j] = await journal();
  check(`one active account ${IBAN} (24 characters, mod-97 = 1, bank code 45)`, banks.length === 1 && banks[0].sanitized_account_number === IBAN && ibanOk(banks[0].account_number), JSON.stringify(banks.map((r) => [r.id, r.account_number, r.active])));
  check(`its holder «${HOLDER}», its bank «${BANK}», on the company's partner`, banks[0]?.holder_name === HOLDER && banks[0]?.bank_name === BANK && Array.isArray(banks[0]?.partner_id) && banks[0].partner_id[0] === 1, JSON.stringify([banks[0]?.holder_name, banks[0]?.bank_name, banks[0]?.partner_id]));
  check(`no SWIFT on it unless one was given from the bank's own source (${BIC || "none given"})`, String(banks[0]?.bank_bic || "") === (rb.created.bic ?? ""), JSON.stringify(banks[0]?.bank_bic));
  check(`the journal ${JOURNAL} (a bank journal on 101001) carries it`, j?.type === "bank" && Array.isArray(j.bank_account_id) && j.bank_account_id[0] === banks[0]?.id && /^101001/.test(String(j.default_account_id?.[1] ?? "")), JSON.stringify(j));
  await wait(900);
  const raed = (await raedRows()).filter((r) => r.active !== false);
  check(`one partner with ${RAED.number}: «${RAED.name}»`, raed.length === 1 && raed[0].name === RAED.name && raed[0].phone === RAED.number && raed[0].x_whatsapp_number === RAED.number, JSON.stringify(raed.map((r) => [r.id, r.name, r.phone, r.x_whatsapp_number])));
  check("…a price source whose role is «سوق», allowed on WhatsApp", raed[0]?.x_price_source === true && raed[0]?.x_price_role === "market" && raed[0]?.x_wa_allowed === true, JSON.stringify(raed[0]));
  check("…neither a customer nor a supplier (both ranks 0), and out of every customer automation (class «supplier», not waiting for review)", raed[0]?.customer_rank === 0 && raed[0]?.supplier_rank === 0 && raed[0]?.x_contact_class === "supplier" && raed[0]?.x_review_pending !== true, JSON.stringify(raed[0]));
  const emp = await call("hr.employee", "search_read", { domain: [["work_contact_id", "=", raed[0]?.id ?? 0]], fields: ["id"], limit: 1 });
  check("…and not an employee (no «بدء الدوام» to wait for)", emp.length === 0);
  await wait(900);
  const meta = atMeta();
  const v2 = await tplRows(FLOW_TEMPLATE.name), v1 = await tplRows(V1);
  check(`one row of ${FLOW_TEMPLATE.name} (ar), purpose ${FLOW_TEMPLATE.purpose}, 1 variable`, v2.length === 1 && v2[0].x_purpose === FLOW_TEMPLATE.purpose && v2[0].x_param_count === 1, JSON.stringify(v2));
  check(`its status and category are Meta's at the last --status (${meta?.status}/${meta?.category}, ${meta?.at})`, !!meta && v2[0]?.x_meta_status === meta.status && v2[0]?.x_category === meta.category && v2[0]?.x_meta_id === meta.id, JSON.stringify([v2[0]?.x_meta_status, v2[0]?.x_category, v2[0]?.x_meta_id]));
  check("its text and its button are on the row", v2[0]?.x_body_text === FLOW_TEMPLATE.body && v2[0]?.x_buttons_text === FLOW_TEMPLATE.button, JSON.stringify([v2[0]?.x_body_text, v2[0]?.x_buttons_text]));
  const holders = await call(TPL, "search_read", { domain: [["x_purpose", "=", FLOW_TEMPLATE.purpose]], fields: ["id", "x_meta_template_id"] });
  check(`no other template holds the purpose (${V1} gave it up)`, holders.length === 1 && v1.length === 1 && v1[0].x_purpose === "other", JSON.stringify([holders, v1.map((r) => r.x_purpose)]));
  const ask = await call(TPL, "search_read", { domain: [["x_purpose", "=", "supplier_ask"]], fields: ["id", "x_meta_template_id", "x_meta_status", "x_category"] });
  check("the ask of before is untouched: utak_supplier_ask_v2, APPROVED, UTILITY", ask.length === 1 && ask[0].x_meta_template_id === "utak_supplier_ask_v2" && ask[0].x_meta_status === "APPROVED" && ask[0].x_category === "UTILITY", JSON.stringify(ask));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");

if (on("أ")) {
  log("— أ: the company's bank account");
  const [co] = await call("res.company", "search_read", { domain: [], fields: ["id", "name", "partner_id"], limit: 1 });
  const [j] = await journal();
  if (!co || !j || j.type !== "bank") { log(`✗ company or the bank journal ${JOURNAL} not found — stop`); process.exit(1); }
  const have = await bankRows();
  if (have.length > 1) { log(`✗ ${have.length} accounts with this IBAN — stop`); process.exit(1); }
  let bankId = have[0]?.id ?? null;
  const want = { holder_name: HOLDER, bank_name: BANK, ...(BIC ? { bank_bic: BIC } : {}) };
  if (!bankId) {
    log(`+ res.partner.bank: ${IBAN} · «${HOLDER}» · «${BANK}»${BIC ? ` · SWIFT ${BIC}` : " · no SWIFT (none given from the bank's own source)"} on partner #${co.partner_id[0]} (${co.partner_id[1]})`);
    if (APPLY) {
      [bankId] = await call("res.partner.bank", "create", { vals_list: [{ partner_id: co.partner_id[0], company_id: co.id, account_number: IBAN, ...want }] }, { probe: [["sanitized_account_number", "=", IBAN]] });
      rb.created.bank = bankId; if (BIC) rb.created.bic = BIC; save();
      log(`  → #${bankId}`);
    }
  } else {
    const diff = Object.fromEntries(Object.entries({ ...want, active: true }).filter(([k, v]) => have[0][k] !== v));
    if (!Object.keys(diff).length) log(`= res.partner.bank #${bankId} ${have[0].account_number} · «${have[0].holder_name}» · «${have[0].bank_name}»`);
    else {
      log(`✎ res.partner.bank #${bankId}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(have[0][k])} → ${JSON.stringify(v)}`).join(", ")}`);
      if (APPLY) { rb.before.bank ??= Object.fromEntries(Object.keys(diff).map((k) => [k, have[0][k]])); if (BIC) rb.created.bic = BIC; save(); await call("res.partner.bank", "write", { ids: [bankId], vals: diff }); }
    }
  }
  const cur = Array.isArray(j.bank_account_id) ? j.bank_account_id[0] : false;
  if (bankId && cur === bankId) log(`= account.journal #${j.id} ${j.code}: bank_account_id #${bankId}`);
  else {
    log(`✎ account.journal #${j.id} ${j.code} (${j.default_account_id?.[1]}): bank_account_id ${JSON.stringify(cur)} → ${bankId ? `#${bankId}` : "the new account"}`);
    if (APPLY && bankId) { rb.before.journalBank ??= cur; save(); await call("account.journal", "write", { ids: [j.id], vals: { bank_account_id: bankId } }); }
  }
  await wait(900);
}

if (on("ب")) {
  log("— ب: رائد, an outside market source");
  const have = await raedRows();
  if (have.length > 1) { log(`✗ ${have.length} partners carry ${RAED.number}: ${have.map((r) => `#${r.id} ${r.name}`).join(", ")} — stop`); process.exit(1); }
  const want = { name: RAED.name, phone: RAED.number, x_whatsapp_number: RAED.number, x_wa_allowed: true, x_price_source: true, x_price_role: "market", x_contact_class: "supplier", x_review_pending: false };
  if (!have.length) {
    log(`+ res.partner «${RAED.name}» ${RAED.number}: x_wa_allowed, x_price_source, x_price_role market, customer_rank 0, supplier_rank 0, x_contact_class supplier (no customer automation)`);
    if (APPLY) {
      [rb.created.raed] = await call("res.partner", "create", { vals_list: [{ ...want, customer_rank: 0, supplier_rank: 0, is_company: false }] }, { probe: [["x_whatsapp_number", "=", RAED.number]] });
      save(); log(`  → #${rb.created.raed}`);
    }
  } else {
    const row = have[0];
    if (row.customer_rank > 0 || row.supplier_rank > 0) { log(`✗ partner #${row.id} ${row.name} carries the number and is a customer or a supplier (ranks ${row.customer_rank}/${row.supplier_rank}) — stop: Baraa decides`); process.exit(1); }
    const diff = Object.fromEntries(Object.entries({ ...want, active: true }).filter(([k, v]) => row[k] !== v));
    if (!Object.keys(diff).length) log(`= res.partner #${row.id} «${row.name}» ${row.x_whatsapp_number}: source, role ${row.x_price_role}`);
    else {
      log(`✎ res.partner #${row.id}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
      if (APPLY) { if (!rb.created.raed) rb.before.raed ??= { id: row.id, ...Object.fromEntries(Object.keys(diff).map((k) => [k, row[k]])) }; save(); await call("res.partner", "write", { ids: [row.id], vals: diff }); }
    }
  }
  await wait(900);
}

if (on("د")) {
  log("— د: the row of the Flow's template");
  const meta = atMeta();
  if (!meta) { log(`✗ no Meta status of ${FLOW_TEMPLATE.name} — run scripts/s52-20261004-price-flow.mjs --status first`); process.exit(1); }
  log(`Meta (read ${meta.at}): ${meta.name} #${meta.id} ${meta.status}/${meta.category}`);
  // the v1 row gives the purpose up first: never two rows on one purpose
  const v1 = await tplRows(V1);
  if (v1.length === 1 && v1[0].x_purpose === FLOW_TEMPLATE.purpose) {
    log(`✎ ${TPL} #${v1[0].id} ${V1} (${v1[0].x_meta_status}/${v1[0].x_category}): x_purpose ${v1[0].x_purpose} → other`);
    if (APPLY) { rb.before.v1Purpose ??= v1[0].x_purpose; save(); await call(TPL, "write", { ids: [v1[0].id], vals: { x_purpose: "other" } }); }
  } else log(`= ${TPL} ${V1}: ${v1.map((r) => `#${r.id} purpose ${r.x_purpose}`).join(", ") || "no row"}`);
  const rows = await tplRows(FLOW_TEMPLATE.name);
  if (rows.length > 1) { log(`✗ ${rows.length} rows of ${FLOW_TEMPLATE.name} — stop`); process.exit(1); }
  const want = { x_meta_id: meta.id, x_meta_status: meta.status, x_category: meta.category, x_param_count: 1, x_body_text: FLOW_TEMPLATE.body, x_buttons_text: FLOW_TEMPLATE.button, x_purpose: FLOW_TEMPLATE.purpose };
  if (!rows.length) {
    log(`+ ${TPL}: ${FLOW_TEMPLATE.name} (ar) «${FLOW_TEMPLATE.label}», purpose ${FLOW_TEMPLATE.purpose}, ${meta.status}/${meta.category}`);
    if (APPLY) {
      [rb.created.row] = await call(TPL, "create", { vals_list: [{
        x_meta_template_id: FLOW_TEMPLATE.name, x_language: FLOW_TEMPLATE.language, ...want,
        x_body: FLOW_TEMPLATE.body, x_buttons: `[0] FLOW — ${FLOW_TEMPLATE.button}`,
        x_label_ar: FLOW_TEMPLATE.label, x_name: FLOW_TEMPLATE.label, x_last_synced: nowOdoo(), x_missing_in_meta: false,
      }] }, { probe: [["x_meta_template_id", "=", FLOW_TEMPLATE.name], ["x_language", "=", FLOW_TEMPLATE.language]] });
      save(); log(`  → #${rb.created.row}`);
    }
  } else {
    const row = rows[0];
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => row[k] !== v));
    if (!Object.keys(diff).length) log(`= ${TPL} #${row.id} ${FLOW_TEMPLATE.name}: ${row.x_meta_status}/${row.x_category}, purpose ${row.x_purpose}`);
    else {
      log(`✎ ${TPL} #${row.id}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
      if (APPLY) { if (!rb.created.row) rb.before.rowPurpose ??= row.x_purpose || "other"; save(); await call(TPL, "write", { ids: [row.id], vals: diff }); }
    }
  }
}
log(APPLY ? "done — verify: node scripts/s52-20261004-odoo.mjs --verify" : "dry-run: nothing written");
