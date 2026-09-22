// Official-doc 2026-09-22 — views + menus + server actions.
//
// Idempotent by name. Reuses the INTERNAL_WEBHOOK_SECRET token from an
// existing quotation server action (id=941) — never printed.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
mkdirSync(dirname(rbPath), { recursive: true });
let rb = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rbPath)) { try { rb = JSON.parse(readFileSync(rbPath, "utf8")); } catch {} }
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }

function say(...args) { console.log("[views]", ...args); }

async function findOrCreate(model, byField, byValue, valsToCreate) {
  const rows = await call(model, "search_read", {
    domain: [[byField, "=", byValue]], fields: ["id"], limit: 1,
  });
  if (rows.length > 0) {
    say(`${model} where ${byField}=${byValue} exists id=${rows[0].id}`);
    return { id: rows[0].id, created: false };
  }
  const ids = await call(model, "create", { vals_list: [valsToCreate] });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model, id, name: byValue, action: "create" });
  say(`created ${model} id=${id} ${byField}=${byValue}`);
  return { id, created: true };
}

async function getSimOriginAndToken() {
  // Reuse the existing quotation-issue server action (#941) to get
  // origin + INTERNAL_WEBHOOK_SECRET token. Never printed.
  const rows = await call("ir.actions.server", "read", { ids: [941], fields: ["webhook_url"] });
  const raw = String(rows[0]?.webhook_url ?? "");
  if (!raw) throw new Error("cannot read webhook_url from action #941");
  const u = new URL(raw);
  const token = u.searchParams.get("token");
  if (!token) throw new Error("no token on action #941 webhook_url");
  return { origin: u.origin, token };
}

async function main() {
  // Resolve model ids
  const [docModelRow] = await call("ir.model", "search_read", {
    domain: [["model", "=", "x_official_doc"]], fields: ["id"], limit: 1,
  });
  if (!docModelRow) throw new Error("x_official_doc model missing — run setup.mjs first");
  const docModelId = docModelRow.id;

  const [blockModelRow] = await call("ir.model", "search_read", {
    domain: [["model", "=", "x_official_doc_block"]], fields: ["id"], limit: 1,
  });
  if (!blockModelRow) throw new Error("x_official_doc_block model missing");
  const blockModelId = blockModelRow.id;

  const { origin, token } = await getSimOriginAndToken();

  // ---- (1) Server actions (Send Webhook Notification) ----
  say("\n(1) Server actions…");
  const previewAction = await findOrCreate("ir.actions.server", "name", "official-doc.preview_webhook", {
    name: "official-doc.preview_webhook",
    model_id: docModelId,
    state: "webhook",
    webhook_url: `${origin}/internal/official-doc/preview?token=${token}`,
  });
  const issueAction = await findOrCreate("ir.actions.server", "name", "official-doc.issue_webhook", {
    name: "official-doc.issue_webhook",
    model_id: docModelId,
    state: "webhook",
    webhook_url: `${origin}/internal/official-doc/issue?token=${token}`,
  });
  const draftAction = await findOrCreate("ir.actions.server", "name", "official-doc.ai_draft_webhook", {
    name: "official-doc.ai_draft_webhook",
    model_id: docModelId,
    state: "webhook",
    webhook_url: `${origin}/internal/official-doc/ai-draft?token=${token}`,
  });

  // ---- (2) Views ----
  say("\n(2) Views…");

  // (2a) Block list (editable) — nested under the doc form's x_block_ids field.
  const blockListArch = `<list editable="bottom" string="بلوكات المستند">
  <field name="x_sequence" widget="handle"/>
  <field name="x_block_type" string="النوع"/>
  <field name="x_text" string="النص"/>
  <field name="x_tone" string="اللون"/>
  <field name="x_align_numbers" string="أرقام يسار" optional="hide"/>
</list>`;
  const blockList = await findOrCreate("ir.ui.view", "name", "x_official_doc_block.list", {
    name: "x_official_doc_block.list",
    model: "x_official_doc_block",
    type: "list",
    arch: blockListArch,
  });

  // (2b) Doc form view.
  //   readonly-when-issued uses the Odoo 19 "readonly" expression attribute.
  //   Header buttons reference server-action ids via name="{id}".
  const docFormArch = `<form string="مستند رسمي">
  <header>
    <button name="${previewAction.id}" string="👁 معاينة" type="action" class="btn-secondary"
            invisible="x_status == 'issued'"/>
    <button name="${draftAction.id}" string="✨ صياغة ذكية" type="action" class="btn-secondary"
            invisible="x_status == 'issued'"/>
    <button name="${issueAction.id}" string="📄 إصدار" type="action" class="btn-primary"
            invisible="x_status == 'issued'"/>
    <field name="x_status" widget="statusbar" statusbar_visible="draft,issued"/>
  </header>
  <sheet>
    <div class="oe_title">
      <label for="x_name" string="الرقم" invisible="x_status != 'issued'"/>
      <h1 invisible="x_status != 'issued'"><field name="x_name" readonly="1"/></h1>
      <label for="x_template_name" string="اسم النموذج" invisible="not x_is_template"/>
      <h2 invisible="not x_is_template"><field name="x_template_name" readonly="x_status == 'issued'" placeholder="مثال: خطاب بنك — طلب عام"/></h2>
    </div>
    <group>
      <group>
        <field name="x_doc_type" string="النوع" readonly="x_status == 'issued'"/>
        <field name="x_recipient_label" string="تسمية الجهة" placeholder="إلى" readonly="x_status == 'issued'"/>
        <field name="x_recipient" string="الجهة" placeholder="مثال: بنك الراجحي، إدارة الحسابات التجارية" readonly="x_status == 'issued'"/>
      </group>
      <group>
        <field name="x_subject" string="الموضوع" readonly="x_status == 'issued'"/>
        <field name="x_date" string="التاريخ" readonly="x_status == 'issued'"/>
        <field name="x_is_template" string="نموذج جاهز" readonly="x_status == 'issued'"/>
      </group>
    </group>
    <field name="x_last_error" nolabel="1" readonly="1"
           invisible="not x_last_error"
           class="text-danger" widget="text"/>
    <div invisible="not x_pdf_url" class="alert alert-success" role="alert">
      <strong>ملف PDF:</strong> <field name="x_pdf_url" nolabel="1" widget="url" readonly="1"/>
    </div>
    <div invisible="not x_preview_url" class="alert alert-info" role="alert">
      <strong>معاينة:</strong> <field name="x_preview_url" nolabel="1" widget="url" readonly="1"/>
    </div>
    <notebook>
      <page string="المحتوى" name="content">
        <field name="x_block_ids" nolabel="1" readonly="x_status == 'issued'" context="{'default_x_tone': 'neutral', 'default_x_align_numbers': True}"/>
      </page>
      <page string="صياغة ذكية" name="ai" invisible="x_status == 'issued'">
        <div class="text-muted">اكتب طلبك بجملة، مثال: خطاب لبنك الراجحي نطلب فتح حساب تجاري.</div>
        <field name="x_ai_prompt" nolabel="1" placeholder="طلبك للصياغة الذكية…"/>
      </page>
      <page string="التوقيت" name="meta" invisible="x_status != 'issued'">
        <group>
          <field name="x_issued_at" readonly="1"/>
        </group>
      </page>
    </notebook>
  </sheet>
</form>`;
  const docForm = await findOrCreate("ir.ui.view", "name", "x_official_doc.form", {
    name: "x_official_doc.form",
    model: "x_official_doc",
    type: "form",
    arch: docFormArch,
  });

  // (2c) Doc list view.
  const docListArch = `<list string="المستندات الرسمية">
  <field name="x_name" string="الرقم"/>
  <field name="x_doc_type" string="النوع"/>
  <field name="x_recipient" string="الجهة"/>
  <field name="x_subject" string="الموضوع"/>
  <field name="x_date" string="التاريخ"/>
  <field name="x_status" string="الحالة" widget="badge"
    decoration-info="x_status == 'draft'"
    decoration-success="x_status == 'issued'"/>
  <field name="x_is_template" string="نموذج" optional="hide"/>
</list>`;
  const docList = await findOrCreate("ir.ui.view", "name", "x_official_doc.list", {
    name: "x_official_doc.list",
    model: "x_official_doc",
    type: "list",
    arch: docListArch,
  });

  // (2d) Doc search view.
  const docSearchArch = `<search string="بحث">
  <field name="x_name"/>
  <field name="x_recipient"/>
  <field name="x_subject"/>
  <filter name="drafts" string="مسودات" domain="[('x_status','=','draft')]"/>
  <filter name="issued" string="صادرة" domain="[('x_status','=','issued')]"/>
  <filter name="templates" string="نماذج" domain="[('x_is_template','=',True)]"/>
</search>`;
  const docSearch = await findOrCreate("ir.ui.view", "name", "x_official_doc.search", {
    name: "x_official_doc.search",
    model: "x_official_doc",
    type: "search",
    arch: docSearchArch,
  });

  // ---- (3) Window actions ----
  say("\n(3) Window actions…");
  const docsWindowAction = await findOrCreate("ir.actions.act_window", "name", "المستندات الرسمية — المستندات", {
    name: "المستندات الرسمية — المستندات",
    res_model: "x_official_doc",
    view_mode: "list,form",
    domain: "[('x_is_template','=',False)]",
    context: "{'default_x_is_template': False}",
  });
  const templatesWindowAction = await findOrCreate("ir.actions.act_window", "name", "المستندات الرسمية — النماذج", {
    name: "المستندات الرسمية — النماذج",
    res_model: "x_official_doc",
    view_mode: "list,form",
    domain: "[('x_is_template','=',True)]",
    context: "{'default_x_is_template': True}",
  });

  // ---- (4) Menus ----
  say("\n(4) Menus…");
  // Parent menu under UTAK (id=529). Sequence 55 sits between "المحتوى والتسويق" (50) and "الإعدادات" (60).
  const parentMenu = await findOrCreate("ir.ui.menu", "name", "📄 المستندات الرسمية", {
    name: "📄 المستندات الرسمية",
    parent_id: 529,
    sequence: 55,
  });
  await findOrCreate("ir.ui.menu", "name", "المستندات", {
    name: "المستندات",
    parent_id: parentMenu.id,
    sequence: 10,
    action: `ir.actions.act_window,${docsWindowAction.id}`,
  });
  await findOrCreate("ir.ui.menu", "name", "النماذج", {
    name: "النماذج",
    parent_id: parentMenu.id,
    sequence: 20,
    action: `ir.actions.act_window,${templatesWindowAction.id}`,
  });

  say("\nDone.");
  say(`docForm=${docForm.id} docList=${docList.id} docSearch=${docSearch.id}`);
  say(`docsAct=${docsWindowAction.id} templatesAct=${templatesWindowAction.id}`);
  say(`previewAct=${previewAction.id} issueAct=${issueAction.id} draftAct=${draftAction.id}`);
  say(`parentMenu=${parentMenu.id}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
