// Brand identity for issued documents (2026-09-24) — company name, seal and
// signature fields, CRN check. Idempotent; tenant is shared with prod, so
// every change is recorded before it happens.
//
//   node scripts/brand-20260924-stamp-setup.mjs [--dry-run]
//        [--stamp=<png>] [--signature=<png>]
//   node scripts/brand-20260924-stamp-setup.mjs --rollback
//
// What it does:
//   1. res.company.name → «شركة يوتاك ذات مسؤولية محدودة» (joined, as on the
//      seal and the CR); x_legal_name_ar the same when empty or still «يو تاك».
//      res.partner(1).name follows (Odoo relates them).
//   2. Two binary fields on res.company: x_stamp_image, x_signature_image,
//      plus a small form group to see / replace them from Odoo.
//   3. Uploads the green seal (default: Desktop/Utak/ختم الشركة/
//      UTAK-Seal-Final-Stamped.png, #1E5A41), downscaled to 709 px = 40 mm at
//      450 dpi. The signature is uploaded only when --signature is given —
//      there is no approved signature file yet.
//   4. CRN 7055194869 in res.partner(1).additional_identifiers.SA_CRN (the
//      key readCompanyInfo reads) — written only if missing/different.
//   5. Prints VAT + address for the report. Never touches them.
//
// Rollback file: scripts/artifacts/brand-20260924-stamp-setup-rollback.json
// (the FIRST real run's "before" is kept; later runs only add created ids).

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const NAME_AR = "شركة يوتاك ذات مسؤولية محدودة";
const CRN = "7055194869";
const STAMP_PX = 709;
const STAMP_SRC = opt("stamp") ?? join(homedir(), "Desktop/Utak/ختم الشركة/UTAK-Seal-Final-Stamped.png");
const SIGNATURE_SRC = opt("signature");
const RB_PATH = new URL("./artifacts/brand-20260924-stamp-setup-rollback.json", import.meta.url).pathname;
const VIEW_NAME = "res.company.form.x_stamp_signature";
const FIELDS = [
  { name: "x_stamp_image", field_description: "ختم الشركة / Company Stamp" },
  { name: "x_signature_image", field_description: "التوقيع المعتمد / Authorized Signature" },
];

const log = (...a) => console.log(...a);
const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : null);
const saveRb = (rb) => { if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n"); };

async function readState() {
  const [c] = await call("res.company", "read", {
    ids: [1], fields: ["name", "vat", "x_legal_name_ar", "partner_id", "street", "street2", "city", "zip", "country_id", "state_id"],
  });
  const [p] = await call("res.partner", "read", { ids: [c.partner_id[0]], fields: ["name", "additional_identifiers"] });
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.company"], ["name", "in", FIELDS.map((f) => f.name)]], fields: ["id", "name", "ttype"],
  });
  const views = await call("ir.ui.view", "search_read", { domain: [["name", "=", VIEW_NAME]], fields: ["id"] });
  return { c, p, fields, views };
}

function ident(p) {
  const v = p.additional_identifiers;
  if (v && typeof v === "object") return { ...v };
  if (typeof v === "string" && v.trim().startsWith("{")) return JSON.parse(v);
  return {};
}

function pngBase64(src, px) {
  if (!existsSync(src)) throw new Error(`image not found: ${src}`);
  const out = join(mkdtempSync(join(tmpdir(), "utak-brand-")), "img.png");
  execFileSync("sips", ["-s", "format", "png", "-Z", String(px), src, "--out", out], { stdio: "ignore" });
  return readFileSync(out).toString("base64");
}

async function rollback() {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file at ${RB_PATH}`);
  log("rollback from", RB_PATH);
  if (rb.created?.view_id) {
    log("  unlink view", rb.created.view_id);
    if (!DRY) await call("ir.ui.view", "unlink", { ids: [rb.created.view_id] });
  }
  for (const id of rb.created?.field_ids ?? []) {
    log("  unlink field", id);
    if (!DRY) await call("ir.model.fields", "unlink", { ids: [id] });
  }
  const vals = { name: rb.before.company_name, x_legal_name_ar: rb.before.x_legal_name_ar };
  log("  res.company(1) ←", vals);
  if (!DRY) await call("res.company", "write", { ids: [1], vals });
  if (rb.wrote?.additional_identifiers) {
    log("  res.partner(%d).additional_identifiers ←", rb.before.partner_id, rb.before.additional_identifiers);
    if (!DRY) await call("res.partner", "write", { ids: [rb.before.partner_id], vals: { additional_identifiers: rb.before.additional_identifiers } });
  }
  log(DRY ? "dry-run: nothing written" : "rollback done");
}

async function setup() {
  const s0 = await readState();
  let rb = readRb();
  if (!rb) {
    rb = {
      script: "scripts/brand-20260924-stamp-setup.mjs",
      createdAt: new Date().toISOString(),
      before: {
        company_name: s0.c.name,
        x_legal_name_ar: s0.c.x_legal_name_ar,
        partner_id: s0.c.partner_id[0],
        partner_name: s0.p.name,
        additional_identifiers: s0.p.additional_identifiers,
        fields_present: s0.fields.map((f) => f.name),
        view_present: s0.views.map((v) => v.id),
      },
      created: { field_ids: [], view_id: null },
      wrote: {},
    };
  }
  saveRb(rb); // before any write

  // 1. name
  if (s0.c.name !== NAME_AR) {
    log(`name: «${s0.c.name}» → «${NAME_AR}»`);
    if (!DRY) await call("res.company", "write", { ids: [1], vals: { name: NAME_AR } });
    rb.wrote.company_name = NAME_AR;
  } else log("name: already", NAME_AR);
  const legal = s0.c.x_legal_name_ar || "";
  if (!legal || legal.includes("يو تاك")) {
    log(`x_legal_name_ar: «${legal}» → «${NAME_AR}»`);
    if (!DRY) await call("res.company", "write", { ids: [1], vals: { x_legal_name_ar: NAME_AR } });
    rb.wrote.x_legal_name_ar = NAME_AR;
  } else log("x_legal_name_ar: kept", legal);

  // 2. fields + view
  const [model] = await call("ir.model", "search_read", { domain: [["model", "=", "res.company"]], fields: ["id"] });
  for (const f of FIELDS) {
    if (s0.fields.some((x) => x.name === f.name)) { log(`field ${f.name}: exists`); continue; }
    log(`field ${f.name}: create (binary)`);
    if (DRY) continue;
    const [id] = await call("ir.model.fields", "create", {
      vals_list: [{ model_id: model.id, name: f.name, field_description: f.field_description, ttype: "binary", state: "manual" }],
    }, { probe: [["model", "=", "res.company"], ["name", "=", f.name]] });
    rb.created.field_ids.push(id);
    saveRb(rb);
  }
  if (s0.views.length) log(`view ${VIEW_NAME}: exists (${s0.views[0].id})`);
  else {
    log(`view ${VIEW_NAME}: create`);
    if (!DRY) {
      const [base] = await call("ir.ui.view", "search_read", { domain: [["model", "=", "res.company"], ["type", "=", "form"], ["inherit_id", "=", false]], fields: ["id"], limit: 1 });
      const arch = `<data>
  <xpath expr="//div[@name='identifiers']" position="after">
    <group string="الختم والتوقيع / Stamp &amp; Signature" name="x_utak_stamp_signature">
      <field name="x_stamp_image" widget="image" options="{'size': [120, 120]}"/>
      <field name="x_signature_image" widget="image" options="{'size': [180, 90]}"/>
    </group>
  </xpath>
</data>`;
      const [vid] = await call("ir.ui.view", "create", {
        vals_list: [{ name: VIEW_NAME, model: "res.company", type: "form", inherit_id: base.id, mode: "extension", arch_db: arch, priority: 99 }],
      }, { probe: [["name", "=", VIEW_NAME]] });
      rb.created.view_id = vid;
      saveRb(rb);
    }
  }

  // 3. images
  const images = [{ field: "x_stamp_image", src: STAMP_SRC, px: STAMP_PX }];
  if (SIGNATURE_SRC) images.push({ field: "x_signature_image", src: SIGNATURE_SRC, px: 900 });
  else log("x_signature_image: no --signature file given — left empty");
  if (!DRY) {
    for (const im of images) {
      const b64 = pngBase64(im.src, im.px);
      const [cur] = await call("res.company", "read", { ids: [1], fields: [im.field] });
      if (cur[im.field] === b64) { log(`${im.field}: already uploaded (${b64.length} b64 chars)`); continue; }
      log(`${im.field}: upload ${im.src} → ${im.px}px, ${Math.round((b64.length * 3) / 4 / 1024)} KB`);
      await call("res.company", "write", { ids: [1], vals: { [im.field]: b64 } });
      rb.wrote[im.field] = { src: im.src, px: im.px, bytes: Math.round((b64.length * 3) / 4) };
    }
  } else log(`dry-run: would upload ${STAMP_SRC}`);

  // 4. CRN
  const idsNow = ident(s0.p);
  if (idsNow.SA_CRN === CRN) log(`CRN: SA_CRN already ${CRN} on res.partner(${s0.c.partner_id[0]})`);
  else {
    log(`CRN: SA_CRN ${idsNow.SA_CRN ?? "(none)"} → ${CRN}`);
    if (!DRY) await call("res.partner", "write", { ids: [s0.c.partner_id[0]], vals: { additional_identifiers: { ...idsNow, SA_CRN: CRN } } });
    rb.wrote.additional_identifiers = { ...idsNow, SA_CRN: CRN };
  }
  saveRb(rb);

  // 5. verify
  const s1 = await readState();
  const [imgs] = await call("res.company", "read", { ids: [1], fields: ["x_stamp_image", "x_signature_image"] }).catch(() => [{}]);
  const report = {
    company_name: s1.c.name,
    partner_name: s1.p.name,
    x_legal_name_ar: s1.c.x_legal_name_ar,
    vat: s1.c.vat,
    crn: ident(s1.p).SA_CRN ?? null,
    address: { street: s1.c.street, street2: s1.c.street2, city: s1.c.city, zip: s1.c.zip, state: s1.c.state_id?.[1], country: s1.c.country_id?.[1] },
    fields: s1.fields,
    view: s1.views.map((v) => v.id),
    stamp_uploaded: typeof imgs?.x_stamp_image === "string" && imgs.x_stamp_image.startsWith("iVBOR"),
    signature_uploaded: typeof imgs?.x_signature_image === "string" && imgs.x_signature_image.length > 0,
  };
  log(JSON.stringify(report, null, 2));
  log(DRY ? "dry-run: nothing written" : `rollback: ${RB_PATH}`);
}

await (ROLLBACK ? rollback() : setup());
