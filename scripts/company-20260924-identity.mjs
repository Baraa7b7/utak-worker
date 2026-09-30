// Company identity data + Othman's role (2026-09-24). Idempotent; the tenant
// is shared with prod, so the "before" of everything it touches is saved
// first. No WhatsApp: nothing here sends, and any graph.facebook.com request
// throws.
//
//   node scripts/company-20260924-identity.mjs [--dry-run]
//   node scripts/company-20260924-identity.mjs --rollback [--dry-run]
//
// 1. res.company(1) (locked data):
//      x_legal_name_en = «UTAK Company»
//      x_address_en    = the English national address, formal wording
//      x_legal_form_ar / x_legal_form_en (new char fields) = the entity type:
//        «شركة ذات مسؤولية محدودة (شخص واحد)» / «Limited Liability Company (One Person)»
//      shown in the «بيانات المستندات الرسمية» group of the company form
//      (view res.company.form.x_legal_form, after x_legal_name_en).
// 2. res.partner(15) «عثمان عبدالوهاب»: x_role_ids emptied (was «مدير»). Not
//    archived, not deleted — he stays a customer (customer_rank 1). Checked
//    afterwards against the worker's own team lookups
//    (src/odoo.ts::getTeamMembersByRole for every role code and
//    ::findTeamMemberByWhatsApp for his number): he must match none.
//
// Rollback file: scripts/artifacts/company-20260924-identity-rollback.json

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from the identity script");
  return realFetch(input, init);
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const RB_PATH = new URL("./artifacts/company-20260924-identity-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

const LEGAL_NAME_EN = "UTAK Company";
const LEGAL_FORM = {
  ar: "شركة ذات مسؤولية محدودة (شخص واحد)",
  en: "Limited Liability Company (One Person)",
};
// Locked: «prince muhammad ibn abdulrahman ibn abdulaziz - al sulay dist»,
// Riyadh, postal code 14273, additional number 4309 (building 8141 as in the
// Arabic x_address_ar). The additional number is spelled out rather than
// «14273-4309» so the Arabic and English lines carry the same parts.
const ADDRESS_EN = "8141 Prince Muhammad ibn Abdulrahman ibn Abdulaziz St., Al Sulay Dist., Riyadh 14273, Additional No. 4309";
const NEW_FIELDS = [
  { name: "x_legal_form_ar", field_description: "نوع الكيان (عربي)", value: LEGAL_FORM.ar },
  { name: "x_legal_form_en", field_description: "نوع الكيان (إنجليزي) / Legal Form", value: LEGAL_FORM.en },
];
const VIEW_NAME = "res.company.form.x_legal_form";
const OTHMAN = 15;
const ROLE_CODES = ["driver", "warehouse", "collector", "admin"];

const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : null);
const saveRb = (rb) => { if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n"); };

const fieldRows = () => call("ir.model.fields", "search_read", {
  domain: [["model", "=", "res.company"], ["name", "in", NEW_FIELDS.map((f) => f.name)]], fields: ["id", "name"],
});
async function readCompany(present) {
  const [c] = await call("res.company", "read", { ids: [1], fields: ["x_legal_name_en", "x_address_en", ...present.map((f) => f.name)] });
  return c;
}
const readOthman = async () => (await call("res.partner", "read", {
  ids: [OTHMAN], fields: ["name", "active", "x_role_ids", "customer_rank", "x_whatsapp_number", "phone"], context: { active_test: false },
}))[0];

/** The worker's own team lookups (src/odoo.ts), same domains. */
async function teamPaths(p) {
  const byRole = {};
  for (const code of ROLE_CODES) {
    const rows = await call("res.partner", "search_read", { domain: [["x_role_ids.x_code", "=", code], ["active", "=", true]], fields: ["id"], limit: 50 });
    byRole[code] = rows.map((r) => r.id);
  }
  const num = p.x_whatsapp_number || p.phone;
  const team = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "=", num], ["phone", "=", num], ["x_role_ids", "!=", false], ["active", "=", true]],
    fields: ["id"], limit: 1,
  });
  return { byRole, teamMatchForNumber: team.map((r) => r.id) };
}

async function setup() {
  const fields0 = await fieldRows();
  const c0 = await readCompany(fields0);
  const p0 = await readOthman();
  const views0 = await call("ir.ui.view", "search_read", { domain: [["name", "=", VIEW_NAME]], fields: ["id"] });
  if (!p0 || p0.name !== "عثمان عبدالوهاب") throw new Error(`partner ${OTHMAN} is not «عثمان عبدالوهاب»: ${JSON.stringify(p0)}`);

  let rb = readRb();
  if (!rb) {
    rb = {
      script: "scripts/company-20260924-identity.mjs",
      createdAt: new Date().toISOString(),
      before: {
        company: c0,
        fields_present: fields0.map((f) => f.name),
        view_ids: views0.map((v) => v.id),
        othman: p0,
        team_paths: await teamPaths(p0),
      },
      created: { field_ids: [], view_id: null },
      wrote: {},
    };
  }
  saveRb(rb); // before any write

  // 1a. fields
  const [cm] = await call("ir.model", "search_read", { domain: [["model", "=", "res.company"]], fields: ["id"] });
  for (const f of NEW_FIELDS) {
    if (fields0.some((x) => x.name === f.name)) { log(`field res.company.${f.name}: exists`); continue; }
    log(`field res.company.${f.name}: create (char)`);
    if (DRY) continue;
    const [id] = await call("ir.model.fields", "create", {
      vals_list: [{ model_id: cm.id, name: f.name, field_description: f.field_description, ttype: "char", state: "manual" }],
    }, { probe: [["model", "=", "res.company"], ["name", "=", f.name]] });
    rb.created.field_ids.push(id);
    saveRb(rb);
  }

  // 1b. view: the two fields right after the English legal name
  if (views0.length) log(`view ${VIEW_NAME}: exists (${views0[0].id})`);
  else {
    log(`view ${VIEW_NAME}: create`);
    if (!DRY) {
      const [base] = await call("ir.ui.view", "search_read", { domain: [["name", "=", "res.company.form.x_bilingual"]], fields: ["id"], limit: 1 });
      if (!base) throw new Error("view res.company.form.x_bilingual not found");
      const arch = `<data>
  <xpath expr="//field[@name='x_legal_name_en']" position="after">
    <field name="x_legal_form_ar"/>
    <field name="x_legal_form_en"/>
  </xpath>
</data>`;
      const [vid] = await call("ir.ui.view", "create", {
        vals_list: [{ name: VIEW_NAME, model: "res.company", type: "form", inherit_id: base.id, mode: "extension", arch_db: arch }],
      }, { probe: [["name", "=", VIEW_NAME]] });
      rb.created.view_id = vid;
      saveRb(rb);
    }
  }

  // 1c. values
  const want = { x_legal_name_en: LEGAL_NAME_EN, x_address_en: ADDRESS_EN, ...Object.fromEntries(NEW_FIELDS.map((f) => [f.name, f.value])) };
  const cNow = DRY ? c0 : await readCompany(await fieldRows());
  const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => cNow[k] !== v));
  for (const [k, v] of Object.entries(want)) log(`res.company.${k}: ${JSON.stringify(cNow[k] ?? null)} → ${JSON.stringify(v)}${k in diff ? "" : " (already)"}`);
  if (Object.keys(diff).length && !DRY) {
    rb.wrote.company = { ...(rb.wrote.company ?? {}), ...diff };
    saveRb(rb);
    await call("res.company", "write", { ids: [1], vals: diff });
  }

  // 2. Othman: no role, still active
  const roles = Array.isArray(p0.x_role_ids) ? p0.x_role_ids : [];
  log(`res.partner(${OTHMAN}) ${p0.name}: x_role_ids ${JSON.stringify(roles)} → []${roles.length ? "" : " (already)"} · active ${p0.active} (unchanged)`);
  if (roles.length && !DRY) {
    rb.wrote.othman = { x_role_ids: roles };
    saveRb(rb);
    await call("res.partner", "write", { ids: [OTHMAN], vals: { x_role_ids: [[6, 0, []]] } });
  }

  if (DRY) { log("dry-run: nothing written"); return; }

  // verify
  const c1 = await readCompany(await fieldRows());
  const bad = Object.entries(want).filter(([k, v]) => c1[k] !== v);
  if (bad.length) throw new Error(`company verify failed: ${JSON.stringify(bad)}`);
  const p1 = await readOthman();
  const paths = await teamPaths(p1);
  const inPath = Object.entries(paths.byRole).filter(([, ids]) => ids.includes(OTHMAN)).map(([k]) => k);
  if ((p1.x_role_ids || []).length || !p1.active || inPath.length || paths.teamMatchForNumber.includes(OTHMAN)) {
    throw new Error(`Othman verify failed: ${JSON.stringify({ p1, paths })}`);
  }
  rb.after = { company: c1, othman: p1, team_paths: paths };
  saveRb(rb);
  log(`verify ✓ company fields · Othman active, no role, in no team lookup (${JSON.stringify(paths.byRole)}, number match ${JSON.stringify(paths.teamMatchForNumber)})`);
}

async function rollback() {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file ${RB_PATH}`);
  if (rb.wrote.othman) {
    log(`res.partner(${OTHMAN}).x_role_ids ← ${JSON.stringify(rb.wrote.othman.x_role_ids)}`);
    if (!DRY) await call("res.partner", "write", { ids: [OTHMAN], vals: { x_role_ids: [[6, 0, rb.before.othman.x_role_ids]] } });
  }
  if (rb.wrote.company) {
    const back = Object.fromEntries(Object.keys(rb.wrote.company).filter((k) => k in rb.before.company).map((k) => [k, rb.before.company[k]]));
    log(`res.company ← ${JSON.stringify(back)}`);
    if (!DRY && Object.keys(back).length) await call("res.company", "write", { ids: [1], vals: back });
  }
  if (rb.created.view_id) { log(`unlink view ${rb.created.view_id}`); if (!DRY) await call("ir.ui.view", "unlink", { ids: [rb.created.view_id] }); }
  if (rb.created.field_ids.length) { log(`unlink fields ${rb.created.field_ids}`); if (!DRY) await call("ir.model.fields", "unlink", { ids: rb.created.field_ids }); }
  log(DRY ? "dry-run: nothing written" : "rollback done");
}

await (ROLLBACK ? rollback() : setup());
