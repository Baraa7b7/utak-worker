// Item 9 apply — add x_label_ar Char, put it first on both list views,
// set id=46's label, try rec_name (bail gracefully if unavailable).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const rollbackPath = new URL("./artifacts/cleanup-20260919-rollback.json", import.meta.url).pathname;
mkdirSync(dirname(rollbackPath), { recursive: true });
let rollback = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rollbackPath)) { try { rollback = JSON.parse(readFileSync(rollbackPath, "utf8")); } catch {} }
function record(op) { rollback.operations.push(op); writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2) + "\n"); }

// 1. Create x_label_ar Char field (idempotent)
const modelId = 5108;
const existing = await call("ir.model.fields","search_read",{
  domain:[["model","=","x_whatsapp_template"],["name","=","x_label_ar"]],
  fields:["id","name","ttype","field_description"],
});
let fieldId;
if (existing.length > 0) {
  fieldId = existing[0].id;
  console.log(`x_label_ar already exists: id=${fieldId}`);
} else {
  const ids = await call("ir.model.fields","create",{
    vals_list: [{
      model: "x_whatsapp_template",
      model_id: modelId,
      name: "x_label_ar",
      ttype: "char",
      field_description: "الاسم العربي",
      state: "manual",
    }],
  });
  fieldId = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model:"ir.model.fields", id: fieldId, before: null, action:"create" });
  console.log(`created x_label_ar: id=${fieldId}`);
}

// 2. Set id=46's x_label_ar = "تأكيد المورد"
const row46Before = (await call("x_whatsapp_template","read",{ids:[46],fields:["id","x_label_ar","x_meta_template_id"]}))[0];
console.log(`\nRow 46 BEFORE: ${JSON.stringify(row46Before)}`);
if (row46Before.x_label_ar !== "تأكيد المورد") {
  record({ ts: new Date().toISOString(), model:"x_whatsapp_template", id: 46, before: { x_label_ar: row46Before.x_label_ar }, action:"write" });
  await call("x_whatsapp_template","write",{ids:[46],vals:{ x_label_ar: "تأكيد المورد" }});
}
const row46After = (await call("x_whatsapp_template","read",{ids:[46],fields:["id","x_label_ar"]}))[0];
console.log(`Row 46 AFTER: ${JSON.stringify(row46After)}`);

// 3. Update both list views to place x_label_ar as the first column
const NEW_ARCH_2723 = `<list string="قوالب الواتساب" default_order="x_purpose, x_name">
  <field name="x_label_ar"/>
  <field name="x_name"/>
  <field name="x_meta_template_id"/>
  <field name="x_purpose"/>
  <field name="x_language"/>
  <field name="x_body_preview" optional="show"/>
</list>`;
const view2723Before = (await call("ir.ui.view","read",{ids:[2723],fields:["id","arch"]}))[0];
record({ ts: new Date().toISOString(), model:"ir.ui.view", id: 2723, before: { arch: view2723Before.arch }, action:"write" });
await call("ir.ui.view","write",{ids:[2723],vals:{ arch: NEW_ARCH_2723 }});
console.log(`\nview 2723 updated`);

const NEW_ARCH_2731 = `<list string="قوالب واتساب" sample="1">
  <field name="x_label_ar" string="الاسم العربي"/>
  <field name="x_purpose" string="الغرض"/>
  <field name="x_name" string="الاسم الداخلي"/>
  <field name="x_meta_template_id" string="Meta Template Name"/>
  <field name="x_language" string="اللغة"/>
  <field name="x_body_preview" string="معاينة النص" optional="show"/>
</list>`;
const view2731Before = (await call("ir.ui.view","read",{ids:[2731],fields:["id","arch"]}))[0];
record({ ts: new Date().toISOString(), model:"ir.ui.view", id: 2731, before: { arch: view2731Before.arch }, action:"write" });
await call("ir.ui.view","write",{ids:[2731],vals:{ arch: NEW_ARCH_2731 }});
console.log(`view 2731 updated`);

// 4. Try to set rec_name — Odoo Online SaaS 19 does not expose rec_name on ir.model.
//    Attempt gracefully.
try {
  await call("ir.model","write",{ids:[5108],vals:{ rec_name: "x_label_ar" }});
  console.log(`rec_name set to x_label_ar on ir.model id=5108`);
} catch (e) {
  console.log(`rec_name NOT settable via JSON-RPC (${(e).message.slice(0,120)}). Column added; display-name unchanged.`);
}
