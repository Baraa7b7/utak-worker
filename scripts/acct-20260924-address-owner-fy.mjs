// National address, owner current account, first fiscal year (2026-09-24).
// Idempotent; the tenant is shared with prod, so the "before" of everything it
// touches is saved first.
//
//   node scripts/acct-20260924-address-owner-fy.mjs [--dry-run]
//   node scripts/acct-20260924-address-owner-fy.mjs --rollback [--dry-run]
//
// 1. National address (locked data) on res.company(1) and res.partner(1):
//      standard fields  street  = شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز
//                       street2 = حي السلي (district — Odoo's usual slot)
//                       city = الرياض · zip = 14273 · state = Riyadh · SA
//      new fields (no standard counterpart without l10n_sa_edi, which stays
//      uninstalled) on res.partner, mirrored on res.company as related:
//                       x_sa_building_no   رقم المبنى / Building No.      8141
//                       x_sa_additional_no الرقم الفرعي / Additional No.  4309
//                       x_sa_short_address العنوان المختصر / Short Address RQYA8141
//      x_address_ar / x_address_en (the documents' bilingual address) are
//      filled only when empty, in the national-address order.
//      A form group «العنوان الوطني» on the company form shows the three.
// 2. Account 201021 «جاري المالك / Owner Current Account», liability_current,
//    created only if no account with that name/code exists. No entry on it.
// 3. account.fiscal.year «FY2026» 2026-09-13 → 2026-12-31 (the first, short
//    year from the CR date). The company year-end stays 31/12.
// 4. English name «Paid-in Capital» on 300010 when its en_US name is still
//    the Arabic one (the bilingual statements print both).
//
// Rollback file: scripts/artifacts/acct-20260924-address-owner-fy-rollback.json

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const RB_PATH = new URL("./artifacts/acct-20260924-address-owner-fy-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

const ADDRESS = {
  building: "8141",
  additional: "4309",
  zip: "14273",
  street: "شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز",
  district: "حي السلي",
  city: "الرياض",
  short: "RQYA8141",
};
// Arabic: no "zip-additional" pair — inside Arabic text the bidi algorithm
// turns both numbers into Arabic-context numbers and prints "4309-14273".
const ADDRESS_AR = `${ADDRESS.building} ${ADDRESS.street}، ${ADDRESS.district}، ${ADDRESS.city} ${ADDRESS.zip}، الرقم الفرعي ${ADDRESS.additional}`;
// Values this script wrote earlier — replaced; anything else is someone's edit and is kept.
const OWN_EARLIER_AR = [`${ADDRESS.building} ${ADDRESS.street}، ${ADDRESS.district}، ${ADDRESS.city} ${ADDRESS.zip}-${ADDRESS.additional}`];
const ADDRESS_EN = `${ADDRESS.building} Prince Mohammed bin Abdulrahman bin Abdulaziz St, Al Sulay Dist., Riyadh ${ADDRESS.zip}-${ADDRESS.additional}`;
const NEW_FIELDS = [
  { name: "x_sa_building_no", field_description: "رقم المبنى / Building No.", value: ADDRESS.building },
  { name: "x_sa_additional_no", field_description: "الرقم الفرعي / Additional No.", value: ADDRESS.additional },
  { name: "x_sa_short_address", field_description: "العنوان المختصر / Short Address", value: ADDRESS.short },
];
const VIEW_NAME = "res.company.form.x_national_address";
const OWNER = { code: "201021", name_ar: "جاري المالك", name_en: "Owner Current Account", type: "liability_current" };
const CAPITAL = { code: "300010", name_en: "Paid-in Capital" };
const FY = { name: "FY2026", date_from: "2026-09-13", date_to: "2026-12-31" };
const STD = ["street", "street2", "city", "zip", "state_id", "country_id"];

const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : null);
const saveRb = (rb) => { if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n"); };
const m2o = (v) => (Array.isArray(v) ? v[0] : v || false);

async function fieldRows() {
  return call("ir.model.fields", "search_read", {
    domain: [["model", "in", ["res.partner", "res.company"]], ["name", "in", NEW_FIELDS.map((f) => f.name)]],
    fields: ["id", "model", "name", "ttype", "related"],
  });
}

async function findOwner() {
  const byCode = await call("account.account", "search_read", { domain: [["code", "=", OWNER.code]], fields: ["id", "code", "name", "account_type"], context: { lang: "ar_001" } });
  const byName = await call("account.account", "search_read", { domain: [["name", "ilike", OWNER.name_ar]], fields: ["id", "code", "name", "account_type"], context: { lang: "ar_001" } });
  return { byCode, byName };
}

async function readAll(present) {
  const extra = present.filter((f) => f.model === "res.company").map((f) => f.name);
  const [c] = await call("res.company", "read", { ids: [1], fields: [...STD, "partner_id", "x_address_ar", "x_address_en", ...extra] });
  const pExtra = present.filter((f) => f.model === "res.partner").map((f) => f.name);
  const [p] = await call("res.partner", "read", { ids: [c.partner_id[0]], fields: [...STD, ...pExtra] });
  return { c, p };
}

async function setup() {
  const fields0 = await fieldRows();
  const s0 = await readAll(fields0);
  const owner0 = await findOwner();
  const fy0 = await call("account.fiscal.year", "search_read", { domain: [["company_id", "=", 1]], fields: ["id", "name", "date_from", "date_to"] });
  const views0 = await call("ir.ui.view", "search_read", { domain: [["name", "=", VIEW_NAME]], fields: ["id"] });

  let rb = readRb();
  if (!rb) {
    rb = {
      script: "scripts/acct-20260924-address-owner-fy.mjs",
      createdAt: new Date().toISOString(),
      before: {
        company: Object.fromEntries([...STD, "x_address_ar", "x_address_en"].map((k) => [k, STD.includes(k) && k.endsWith("_id") ? m2o(s0.c[k]) : s0.c[k]])),
        partner_id: s0.c.partner_id[0],
        partner: Object.fromEntries(STD.map((k) => [k, k.endsWith("_id") ? m2o(s0.p[k]) : s0.p[k]])),
        fields_present: fields0.map((f) => `${f.model}.${f.name}`),
        owner_account: owner0,
        fiscal_years: fy0,
        views: views0.map((v) => v.id),
      },
      created: { field_ids: [], view_id: null, owner_account_id: null, fiscal_year_id: null },
      wrote: {},
    };
  }
  saveRb(rb); // before any write

  // 1a. fields: partner (stored char), company (related to partner)
  const [pm] = await call("ir.model", "search_read", { domain: [["model", "=", "res.partner"]], fields: ["id"] });
  const [cm] = await call("ir.model", "search_read", { domain: [["model", "=", "res.company"]], fields: ["id"] });
  for (const f of NEW_FIELDS) {
    for (const [model, modelId, extra] of [
      ["res.partner", pm.id, {}],
      ["res.company", cm.id, { related: `partner_id.${f.name}`, readonly: false, store: false }],
    ]) {
      if (fields0.some((x) => x.model === model && x.name === f.name)) { log(`field ${model}.${f.name}: exists`); continue; }
      log(`field ${model}.${f.name}: create (char${extra.related ? `, related ${extra.related}` : ""})`);
      if (DRY) continue;
      const [id] = await call("ir.model.fields", "create", {
        vals_list: [{ model_id: modelId, name: f.name, field_description: f.field_description, ttype: "char", state: "manual", ...extra }],
      }, { probe: [["model", "=", model], ["name", "=", f.name]] });
      rb.created.field_ids.push(id);
      saveRb(rb);
    }
  }

  // 1b. view on the company form
  if (views0.length) log(`view ${VIEW_NAME}: exists (${views0[0].id})`);
  else {
    log(`view ${VIEW_NAME}: create`);
    if (!DRY) {
      const [base] = await call("ir.ui.view", "search_read", { domain: [["model", "=", "res.company"], ["type", "=", "form"], ["inherit_id", "=", false]], fields: ["id"], limit: 1 });
      const arch = `<data>
  <xpath expr="//div[@name='identifiers']" position="after">
    <group string="العنوان الوطني / National Address" name="x_utak_national_address">
      <field name="x_sa_building_no"/>
      <field name="x_sa_additional_no"/>
      <field name="x_sa_short_address"/>
    </group>
  </xpath>
</data>`;
      const [vid] = await call("ir.ui.view", "create", {
        vals_list: [{ name: VIEW_NAME, model: "res.company", type: "form", inherit_id: base.id, mode: "extension", arch_db: arch, priority: 98 }],
      }, { probe: [["name", "=", VIEW_NAME]] });
      rb.created.view_id = vid;
      saveRb(rb);
    }
  }

  // 1c. values. Company address fields write through to partner 1; the
  // partner is written too so both are right even if that link changes.
  const [sa] = await call("res.country", "search_read", { domain: [["code", "=", "SA"]], fields: ["id"] });
  const [riyadh] = await call("res.country.state", "search_read", { domain: [["country_id", "=", sa.id], ["name", "ilike", "Riyadh"]], fields: ["id", "name"], limit: 1 });
  const std = { street: ADDRESS.street, street2: ADDRESS.district, city: ADDRESS.city, zip: ADDRESS.zip, country_id: sa.id, ...(riyadh ? { state_id: riyadh.id } : {}) };
  const custom = Object.fromEntries(NEW_FIELDS.map((f) => [f.name, f.value]));
  const bilingual = {};
  if (!s0.c.x_address_ar || (OWN_EARLIER_AR.includes(s0.c.x_address_ar) && s0.c.x_address_ar !== ADDRESS_AR)) bilingual.x_address_ar = ADDRESS_AR;
  else log("x_address_ar: kept", s0.c.x_address_ar);
  if (!s0.c.x_address_en) bilingual.x_address_en = ADDRESS_EN; else log("x_address_en: kept", s0.c.x_address_en);
  log("res.company(1) ←", { ...std, ...bilingual });
  log(`res.partner(${s0.c.partner_id[0]}) ←`, { ...std, ...custom });
  if (!DRY) {
    await call("res.company", "write", { ids: [1], vals: { ...std, ...bilingual } });
    await call("res.partner", "write", { ids: [s0.c.partner_id[0]], vals: { ...std, ...custom } });
    rb.wrote.address = { ...std, ...custom, ...bilingual };
    saveRb(rb);
  }

  // 2. owner current account
  const hit = [...owner0.byCode, ...owner0.byName];
  if (hit.length) {
    const a = hit[0];
    log(`owner account: exists ${a.id} ${a.code} «${a.name}» ${a.account_type}`);
    if (a.account_type !== OWNER.type) throw new Error(`owner account ${a.id} is ${a.account_type}, expected ${OWNER.type} — not touching it`);
  } else {
    log(`owner account: create ${OWNER.code} «${OWNER.name_ar} / ${OWNER.name_en}» ${OWNER.type}`);
    if (!DRY) {
      const [id] = await call("account.account", "create", {
        vals_list: [{ code: OWNER.code, name: OWNER.name_en, account_type: OWNER.type, reconcile: false, company_ids: [[6, 0, [1]]] }],
        context: { lang: "en_US" },
      }, { probe: [["code", "=", OWNER.code]] });
      await call("account.account", "write", { ids: [id], vals: { name: OWNER.name_ar }, context: { lang: "ar_001" } });
      rb.created.owner_account_id = id;
      saveRb(rb);
    }
  }

  // 3. fiscal year
  const same = fy0.find((f) => f.date_from === FY.date_from && f.date_to === FY.date_to);
  const overlap = fy0.find((f) => f !== same && f.date_from <= FY.date_to && f.date_to >= FY.date_from);
  if (same) log(`fiscal year: exists ${same.id} ${same.name} ${same.date_from} → ${same.date_to}`);
  else if (overlap) throw new Error(`fiscal year ${overlap.id} ${overlap.date_from}→${overlap.date_to} overlaps ${FY.date_from}→${FY.date_to} — not creating`);
  else {
    log(`fiscal year: create ${FY.name} ${FY.date_from} → ${FY.date_to}`);
    if (!DRY) {
      const [id] = await call("account.fiscal.year", "create", { vals_list: [{ ...FY, company_id: 1 }] }, { probe: [["company_id", "=", 1], ["date_from", "=", FY.date_from]] });
      rb.created.fiscal_year_id = id;
      saveRb(rb);
    }
  }

  // 4. English name of the capital account
  const [capAr] = await call("account.account", "search_read", { domain: [["code", "=", CAPITAL.code]], fields: ["id", "name"], context: { lang: "ar_001" } });
  if (capAr) {
    const [capEn] = await call("account.account", "read", { ids: [capAr.id], fields: ["name"], context: { lang: "en_US" } });
    if (/[\u0600-\u06FF]/.test(capEn.name)) {
      log(`account ${CAPITAL.code} en_US name: «${capEn.name}» → «${CAPITAL.name_en}» (ar_001 stays «${capAr.name}»)`);
      if (!DRY) {
        rb.wrote.capital_name_en = { id: capAr.id, before_en: capEn.name, before_ar: capAr.name, after_en: CAPITAL.name_en };
        saveRb(rb);
        await call("account.account", "write", { ids: [capAr.id], vals: { name: CAPITAL.name_en }, context: { lang: "en_US" } });
        const [chk] = await call("account.account", "read", { ids: [capAr.id], fields: ["name"], context: { lang: "ar_001" } });
        if (chk.name !== capAr.name) {
          log(`  ar_001 name changed to «${chk.name}» — restoring «${capAr.name}»`);
          await call("account.account", "write", { ids: [capAr.id], vals: { name: capAr.name }, context: { lang: "ar_001" } });
        }
      }
    } else log(`account ${CAPITAL.code} en_US name: kept «${capEn.name}»`);
  }

  // verify
  const fields1 = await fieldRows();
  const s1 = await readAll(fields1);
  const owner1 = await findOwner();
  const ownerId = (owner1.byCode[0] ?? owner1.byName[0])?.id;
  const ownerEn = ownerId ? (await call("account.account", "read", { ids: [ownerId], fields: ["name"], context: { lang: "en_US" } }))[0].name : null;
  const ownerLines = ownerId ? await call("account.move.line", "search_count", { domain: [["account_id", "=", ownerId]] }) : null;
  const fy1 = await call("account.fiscal.year", "search_read", { domain: [["company_id", "=", 1]], fields: ["id", "name", "date_from", "date_to"] });
  const report = {
    company: s1.c, partner: s1.p, fields: fields1,
    owner_account: { ...(owner1.byCode[0] ?? owner1.byName[0] ?? {}), name_en: ownerEn, move_lines: ownerLines },
    fiscal_years: fy1,
  };
  log(JSON.stringify(report, null, 2));
  log(DRY ? "dry-run: nothing written" : `rollback: ${RB_PATH}`);
}

async function rollback() {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file at ${RB_PATH}`);
  log("rollback from", RB_PATH);
  if (rb.wrote.capital_name_en) {
    const c = rb.wrote.capital_name_en;
    log(`  account ${c.id} en_US name ← «${c.before_en}»`);
    if (!DRY) await call("account.account", "write", { ids: [c.id], vals: { name: c.before_en }, context: { lang: "en_US" } });
  }
  if (rb.created.fiscal_year_id) {
    log("  unlink fiscal year", rb.created.fiscal_year_id);
    if (!DRY) await call("account.fiscal.year", "unlink", { ids: [rb.created.fiscal_year_id] });
  }
  if (rb.created.owner_account_id) {
    const n = await call("account.move.line", "search_count", { domain: [["account_id", "=", rb.created.owner_account_id]] });
    if (n) log(`  owner account ${rb.created.owner_account_id} has ${n} line(s) — kept (unlink would fail); archive by hand if needed`);
    else {
      log("  unlink owner account", rb.created.owner_account_id);
      if (!DRY) await call("account.account", "unlink", { ids: [rb.created.owner_account_id] });
    }
  }
  const b = rb.before.company;
  const addr = { street: b.street, street2: b.street2, city: b.city, zip: b.zip, state_id: b.state_id, country_id: b.country_id };
  log("  res.company(1) ←", { ...addr, x_address_ar: b.x_address_ar, x_address_en: b.x_address_en });
  if (!DRY) await call("res.company", "write", { ids: [1], vals: { ...addr, x_address_ar: b.x_address_ar, x_address_en: b.x_address_en } });
  const pb = rb.before.partner;
  log(`  res.partner(${rb.before.partner_id}) ←`, pb);
  if (!DRY) await call("res.partner", "write", { ids: [rb.before.partner_id], vals: pb });
  if (rb.created.view_id) {
    log("  unlink view", rb.created.view_id);
    if (!DRY) await call("ir.ui.view", "unlink", { ids: [rb.created.view_id] });
  }
  // company (related) fields first, then the partner fields they point to
  const created = rb.created.field_ids.length
    ? await call("ir.model.fields", "read", { ids: rb.created.field_ids, fields: ["id", "model"] })
    : [];
  for (const f of [...created].sort((a, b) => (a.model === "res.company" ? -1 : 1) - (b.model === "res.company" ? -1 : 1))) {
    log("  unlink field", f.id, f.model);
    if (!DRY) await call("ir.model.fields", "unlink", { ids: [f.id] });
  }
  log(DRY ? "dry-run: nothing written" : "rollback done");
}

await (ROLLBACK ? rollback() : setup());
