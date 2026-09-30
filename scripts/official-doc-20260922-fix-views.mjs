// Fix the 6 views the previous session created so the new fields are visible
// on the exact screens Baraa opens.
//
// Problems found on 2026-09-22 (get_view probes on the composed form arch):
// 1. res.company.form.x_bilingual (view #2809) inserted x_legal_name_ar/en and
//    x_address_ar/en INSIDE the <h1 class="o_outlined"> wrapping the company
//    name. They render as heading-styled text, no labels, so Baraa doesn't see
//    them as editable fields. FIX: move them into a grouped block on the
//    "General Information" tab, next to VAT, with a "بيانات المستندات الرسمية"
//    heading.
// 2. All the other x_doc_lang extension views (partner, quotation, sale.order,
//    invoice, payment, delivery-stop, official-doc, product.template) work but
//    have priority=20, which puts them after the account-reports and
//    account-inherit views (priority=16). None of them collide arch-wise but
//    it is safer to keep priority=20 and just re-verify each field lands.
//
// This script:
//   - REWRITES view #2809 with a corrected arch (idempotent).
//   - Records the write into scripts/artifacts/official-docs-created.json
//     with the previous arch so the rollback script can restore it.
//   - Optionally re-verifies get_view for the res.company form.
//
// Dry-run by default. Pass --apply to write.

import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
const rb = JSON.parse(readFileSync(rbPath, "utf8"));
rb.operations = rb.operations || [];
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }

// The corrected arch — targets the "identifiers" div that wraps the VAT
// label + widget. Everything sits in a proper <group> so each field gets a
// label. The group heading uses Arabic + a light English mirror since Baraa
// browses in ar_001 but shares screenshots with an English audience.
const CORRECTED_ARCH = `<data>
  <xpath expr="//div[@name='identifiers']" position="after">
    <group string="بيانات المستندات الرسمية / Legal Documents Data" name="x_utak_legal_docs">
      <field name="x_legal_name_ar" placeholder="مثال: شركة يو تاك ذات مسؤولية محدودة"/>
      <field name="x_legal_name_en" placeholder="e.g. UTAK Limited"/>
      <field name="x_address_ar" placeholder="مثال: الرياض، حي السلي، طريق الملك فهد"/>
      <field name="x_address_en" placeholder="e.g. Riyadh, As-Sulai, King Fahd Road"/>
    </group>
  </xpath>
</data>`;

async function main() {
  console.log(`=== fix views (${APPLY ? "apply" : "dry-run"}) ===\n`);

  // 1. Read the current arch for view #2809 so we can log it for rollback.
  const [current] = await call("ir.ui.view", "read", { ids: [2809], fields: ["id", "name", "arch_db", "arch", "inherit_id"] });
  if (!current) {
    console.error("view #2809 not found — cannot fix");
    process.exit(1);
  }
  console.log(`current view #${current.id} name=${current.name}`);
  console.log(`  arch_db length = ${(current.arch_db ?? "").length}`);
  console.log(`  inherit_id = ${JSON.stringify(current.inherit_id)}`);

  // If the arch already contains the corrected group name, skip.
  if ((current.arch_db ?? "").includes("x_utak_legal_docs")) {
    console.log("  [skip] view already carries the corrected group — no change needed");
    return;
  }

  if (!APPLY) {
    console.log("\n[dry-run] would write:");
    console.log(CORRECTED_ARCH);
    return;
  }

  // 2. Persist the before-state for rollback.
  record({
    ts: new Date().toISOString(),
    model: "ir.ui.view", id: 2809, name: current.name,
    action: "write",
    before: { arch_db: current.arch_db ?? "" },
  });

  // 3. Write the new arch.
  await call("ir.ui.view", "write", { ids: [2809], vals: { arch_base: CORRECTED_ARCH } });
  console.log("  wrote corrected arch to view #2809");

  // 4. Re-verify by re-reading the composed arch.
  const gv = await call("res.company", "get_view", { view_id: false, view_type: "form" });
  const arch = gv?.arch ?? "";
  const fields = ["x_legal_name_ar", "x_legal_name_en", "x_address_ar", "x_address_en"];
  console.log("\ncomposed arch verification:");
  for (const f of fields) {
    const idx = arch.indexOf(`name="${f}"`);
    if (idx < 0) { console.log(`  ${f}: MISSING`); continue; }
    // Check it's not inside <h1>
    const before = arch.slice(0, idx);
    const lastH1 = before.lastIndexOf("<h1");
    const closeH1 = before.lastIndexOf("</h1>");
    const insideH1 = lastH1 > closeH1;
    // Check it's inside our group
    const nearGroup = before.slice(-500).includes("x_utak_legal_docs");
    console.log(`  ${f}: PRESENT  insideH1=${insideH1}  insideGroup=${nearGroup}`);
  }
}
main().catch((e) => { console.error("[fatal]", e.stack ?? e.message ?? e); process.exit(1); });
