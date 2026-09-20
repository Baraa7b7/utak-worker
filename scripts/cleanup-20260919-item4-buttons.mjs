// Item 4 — Hide native Print + Send-by-Email on 3 screens, and add a
// UTAK "تنزيل PDF (UTAK)" server-action button on account.move (out_invoice)
// and purchase.order. sale.order button already exists (id=971 server action,
// id=2789 view — from commit cd05389).
//
// All mutations recorded to scripts/artifacts/cleanup-20260919-rollback.json;
// scripts/cleanup-20260919-rollback.mjs (dry-run only) restores them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
const WORKER_ORIGIN = process.env.WORKER_ORIGIN || "https://utak-worker-sim.utak-business.workers.dev";
const TOKEN = process.env.SALE_PDF_DOWNLOAD_TOKEN;
if (!TOKEN) {
  console.error("STOP: pass SALE_PDF_DOWNLOAD_TOKEN=<hex> (same value as `wrangler secret put SALE_PDF_DOWNLOAD_TOKEN --env sim`)");
  process.exit(1);
}
if (!/^[a-f0-9]{32,128}$/i.test(TOKEN)) {
  console.error("STOP: SALE_PDF_DOWNLOAD_TOKEN must be 32-128 hex chars");
  process.exit(1);
}

let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const rollbackPath = new URL("./artifacts/cleanup-20260919-rollback.json", import.meta.url).pathname;
mkdirSync(dirname(rollbackPath), { recursive: true });
let rollback = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rollbackPath)) { try { rollback = JSON.parse(readFileSync(rollbackPath, "utf8")); } catch {} }
function record(op) { rollback.operations.push(op); writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2) + "\n"); }

// Helpers
async function findOrCreateView(name, model, inheritId, arch) {
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name","=",name],["model","=",model]],
    fields: ["id","name","arch","inherit_id","active","priority"],
  });
  if (existing.length > 0) {
    const row = existing[0];
    record({ ts: new Date().toISOString(), model: "ir.ui.view", id: row.id, before: { arch: row.arch, active: row.active, priority: row.priority }, action: "write" });
    await call("ir.ui.view", "write", { ids: [row.id], vals: { arch, active: true, priority: 20 } });
    console.log(`  view id=${row.id} name=${name} updated`);
    return row.id;
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, type: "form", model, inherit_id: inheritId, priority: 20, arch }],
  });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "ir.ui.view", id, before: null, action: "create", name });
  console.log(`  view id=${id} name=${name} created`);
  return id;
}

async function findOrCreateServerAction(name, modelId, code) {
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name","=",name],["model_id","=",modelId]],
    fields: ["id","name","code","state","binding_type","binding_view_types"],
  });
  if (existing.length > 0) {
    const row = existing[0];
    record({ ts: new Date().toISOString(), model: "ir.actions.server", id: row.id, before: { code: row.code, state: row.state, binding_type: row.binding_type, binding_view_types: row.binding_view_types }, action: "write" });
    await call("ir.actions.server", "write", { ids: [row.id], vals: { state:"code", code, binding_type:"action", binding_view_types:"list,form" } });
    console.log(`  action id=${row.id} name=${name} updated`);
    return row.id;
  }
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{ name, model_id: modelId, state: "code", code, binding_type: "action", binding_view_types: "list,form" }],
  });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "ir.actions.server", id, before: null, action: "create", name });
  console.log(`  action id=${id} name=${name} created`);
  return id;
}

async function resolveIrModelId(model) {
  const rows = await call("ir.model", "search_read", { domain: [["model","=",model]], fields: ["id","model"] });
  if (!rows[0]) throw new Error(`no ir.model row for ${model}`);
  return rows[0].id;
}

async function resolveInheritViewId(module, name) {
  const rows = await call("ir.model.data", "search_read", { domain: [["module","=",module],["name","=",name]], fields: ["res_id"] });
  if (!rows[0]?.res_id) throw new Error(`cannot resolve ${module}.${name}`);
  return rows[0].res_id;
}

// ---- (A) Hide native "Send by Email" + "Print" on the 3 screens ----
// Odoo 19 SaaS: sale.order/account.move/purchase.order forms don't render
// discrete Send + Print buttons in the header — the print menu is the
// binding_model_id on ir.actions.report. So we DUAL-strategy:
//   1) Unbind (binding_model_id=false) every ir.actions.report row still
//      bound to these three models — kills the Print dropdown items.
//   2) Add an inherit view for each model that sets invisible="1" on the
//      standard "action_quotation_send" (sale), "action_invoice_sent"
//      (account.move), "action_rfq_send" (purchase.order) header buttons.

// (A1) Unbind report actions on the 3 models
for (const m of ["sale.order","account.move","purchase.order"]) {
  const modelRow = await call("ir.model","search_read",{domain:[["model","=",m]],fields:["id","model"]});
  const modelId = modelRow[0]?.id;
  if (!modelId) { console.log(`  ir.model row missing for ${m}, skipping report unbind`); continue; }
  const reports = await call("ir.actions.report","search_read",{
    domain: [["binding_model_id","=",modelId]],
    fields: ["id","name","report_name","binding_model_id","binding_type"],
  });
  console.log(`  ${m}: ${reports.length} bound report(s)`);
  for (const r of reports) {
    console.log(`    id=${r.id} name=${r.name} report=${r.report_name}`);
    record({ ts: new Date().toISOString(), model: "ir.actions.report", id: r.id, before: { binding_model_id: r.binding_model_id, binding_type: r.binding_type }, action: "write:unbind" });
    await call("ir.actions.report","write",{ ids:[r.id], vals: { binding_model_id: false } });
  }
}

// (A2) Add inherit views that hide native header send/print buttons
// sale.order — hide action_quotation_send, action_confirm's "Print" menu is via reports.
console.log("\n(A2) Adding native-hide views…");
const saleFormId = await resolveInheritViewId("sale","view_order_form");
const saleHideArch = `<data>
  <xpath expr="//button[@name='action_quotation_send']" position="attributes"><attribute name="invisible">1</attribute></xpath>
  <xpath expr="//button[@name='action_preview_sale_order']" position="attributes"><attribute name="invisible">1</attribute></xpath>
</data>`;
try {
  await findOrCreateView("utak.sale.order.form.hide_send", "sale.order", saleFormId, saleHideArch);
} catch (e) {
  console.log(`  sale hide view: ${e.message} — falling back to safer single xpath`);
  const safer = `<data><xpath expr="//button[@name='action_quotation_send']" position="attributes"><attribute name="invisible">1</attribute></xpath></data>`;
  await findOrCreateView("utak.sale.order.form.hide_send", "sale.order", saleFormId, safer);
}

// account.move — hide "Send" (action_invoice_sent) and "Send & Print" (action_send_and_print) header buttons
const moveFormId = await resolveInheritViewId("account","view_move_form");
const moveHideArch = `<data>
  <xpath expr="//button[@name='action_invoice_sent']" position="attributes"><attribute name="invisible">1</attribute></xpath>
</data>`;
try {
  await findOrCreateView("utak.account.move.form.hide_send", "account.move", moveFormId, moveHideArch);
} catch (e) {
  console.log(`  account.move hide view failed: ${e.message} (button name may differ; leaving as-is)`);
}

// purchase.order — hide RFQ send + print RFQ header buttons
const poFormId = await resolveInheritViewId("purchase","purchase_order_form");
const poHideArch = `<data>
  <xpath expr="//button[@name='action_rfq_send']" position="attributes"><attribute name="invisible">1</attribute></xpath>
  <xpath expr="//button[@name='print_quotation']" position="attributes"><attribute name="invisible">1</attribute></xpath>
</data>`;
try {
  await findOrCreateView("utak.purchase.order.form.hide_send", "purchase.order", poFormId, poHideArch);
} catch (e) {
  console.log(`  purchase.order hide view failed: ${e.message}`);
  try {
    const safer = `<data><xpath expr="//button[@name='action_rfq_send']" position="attributes"><attribute name="invisible">1</attribute></xpath></data>`;
    await findOrCreateView("utak.purchase.order.form.hide_send", "purchase.order", poFormId, safer);
  } catch (e2) {
    console.log(`    also failed: ${e2.message}`);
  }
}

// ---- (B) UTAK PDF (UTAK) buttons ----
// sale.order: already exists (action id=971 + view id=2789) — leave alone.
console.log("\n(B) UTAK PDF buttons for account.move + purchase.order…");

// account.move server action (invoice PDF)
const moveModelId = await resolveIrModelId("account.move");
const moveActionCode =
  `action = {\n` +
  `    'type': 'ir.actions.act_url',\n` +
  `    'url': '${WORKER_ORIGIN}/internal/invoice-pdf?id=' + str(record.id) + '&token=${TOKEN}',\n` +
  `    'target': 'new',\n` +
  `}`;
const moveActionId = await findOrCreateServerAction("utak.invoice.pdf_download", moveModelId, moveActionCode);
const moveButtonArch = `<data>
  <xpath expr="//header" position="inside">
    <button name="${moveActionId}" string="تنزيل PDF (UTAK)" type="action" class="btn-secondary"
            invisible="move_type not in ('out_invoice','out_refund')"/>
  </xpath>
</data>`;
await findOrCreateView("utak.account.move.form.pdf_button", "account.move", moveFormId, moveButtonArch);

// purchase.order server action (PO PDF)
const poModelId = await resolveIrModelId("purchase.order");
const poActionCode =
  `action = {\n` +
  `    'type': 'ir.actions.act_url',\n` +
  `    'url': '${WORKER_ORIGIN}/internal/purchase-order-pdf?id=' + str(record.id) + '&token=${TOKEN}',\n` +
  `    'target': 'new',\n` +
  `}`;
const poActionId = await findOrCreateServerAction("utak.purchase.pdf_download", poModelId, poActionCode);
const poButtonArch = `<data>
  <xpath expr="//header" position="inside">
    <button name="${poActionId}" string="تنزيل PDF (UTAK)" type="action" class="btn-secondary"/>
  </xpath>
</data>`;
await findOrCreateView("utak.purchase.order.form.pdf_button", "purchase.order", poFormId, poButtonArch);

console.log(`\nDone. Rollback log at ${rollbackPath}`);
console.log(`  Sim endpoints: ${WORKER_ORIGIN}/internal/{invoice-pdf,purchase-order-pdf}?id=…&token=…`);
console.log(`  Server actions: moveActionId=${moveActionId}, poActionId=${poActionId}`);
