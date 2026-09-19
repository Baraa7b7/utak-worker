// Item 7 — Packaging on lines. Applies:
//   A) x_packaging_id on purchase.order.line (many2one → x_product_packaging, on_delete=restrict)
//   B) Inherit views adding "العبوة" column to sale.order.form (1225) and purchase.order.form (2165)
//   C) base.automation on sale.order.line + purchase.order.line: fill default packaging
//      when product_id changes and current packaging is empty OR belongs to another template
//
// Records BEFORE snapshot into linepack-20260919-rollback.json (merge).

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const ROLLBACK_PATH = new URL("./artifacts/linepack-20260919-rollback.json", import.meta.url).pathname;
const rollback = JSON.parse(readFileSync(ROLLBACK_PATH,"utf8"));
function recordOp(op){rollback.operations.push({ts:new Date().toISOString(),...op});writeFileSync(ROLLBACK_PATH,JSON.stringify(rollback,null,2));}

async function findOne(model,domain,fields){const rows=await call(model,"search_read",{domain,fields,limit:1});return rows[0]??null;}

// ============ A) Create x_packaging_id on purchase.order.line ============
console.log("[A] purchase.order.line.x_packaging_id field");
const polModel = await findOne("ir.model", [["model","=","purchase.order.line"]], ["id"]);
if (!polModel) throw new Error("purchase.order.line model row missing");
const packModel = await findOne("ir.model", [["model","=","x_product_packaging"]], ["id"]);
if (!packModel) throw new Error("x_product_packaging model row missing");

const existingField = await findOne("ir.model.fields", [
  ["model","=","purchase.order.line"],
  ["name","=","x_packaging_id"],
], ["id","ttype","relation","on_delete","field_description"]);

let polFieldId;
if (existingField) {
  polFieldId = existingField.id;
  console.log(`  field exists id=${existingField.id} — leaving as-is: ${JSON.stringify(existingField)}`);
} else {
  const [id] = await call("ir.model.fields","create",{vals_list:[{
    model_id: polModel.id,
    model: "purchase.order.line",
    name: "x_packaging_id",
    ttype: "many2one",
    relation: "x_product_packaging",
    state: "manual",
    on_delete: "restrict",
    field_description: "العبوة",
    copied: true,
  }]});
  polFieldId = id;
  recordOp({model:"ir.model.fields",id,action:"create",name:"purchase.order.line.x_packaging_id"});
  console.log(`  ✓ created field id=${id} (many2one → x_product_packaging, on_delete=restrict)`);
}

// ============ B) Inherit views — packaging column ============
console.log("\n[B] inherit views");

async function upsertView(name, vals){
  const existing = await findOne("ir.ui.view",[["name","=",name]],["id"]);
  if (existing){
    await call("ir.ui.view","write",{ids:[existing.id],vals});
    console.log(`  view "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("ir.ui.view","create",{vals_list:[{name,...vals}]});
  recordOp({model:"ir.ui.view",id,action:"create",name});
  console.log(`  view "${name}" created id=${id}`);
  return id;
}

// sale.order — add x_packaging_id inside the sol_list after product_template_id
// Domain uses product_template_id (real m2o on sale.order.line).
// options no_create no_open — user picks from existing packagings only.
await upsertView("utak.sale.order.form.packaging_col", {
  model: "sale.order",
  type: "form",
  inherit_id: 1225,
  priority: 25,
  mode: "extension",
  active: true,
  arch_base: `<xpath expr="//list[@name='sol_list']/field[@name='product_template_id']" position="after">
  <field name="x_packaging_id" string="العبوة" optional="show"
         domain="[('x_product_tmpl_id', '=', product_template_id)]"
         options="{'no_create': True, 'no_open': True}"/>
</xpath>`,
});

// purchase.order — add x_packaging_id inside the list after product_id
// PO line has no product_template_id — use dotted product_id.product_tmpl_id.
await upsertView("utak.purchase.order.form.packaging_col", {
  model: "purchase.order",
  type: "form",
  inherit_id: 2165,
  priority: 25,
  mode: "extension",
  active: true,
  arch_base: `<xpath expr="//field[@name='order_line']/list/field[@name='product_id']" position="after">
  <field name="x_packaging_id" string="العبوة" optional="show"
         domain="[('x_product_tmpl_id', '=', product_id.product_tmpl_id)]"
         options="{'no_create': True, 'no_open': True}"/>
</xpath>`,
});

// ============ C) Automations — default packaging on product_id change ============
console.log("\n[C] base.automation on line models");

// Server actions (code)
const AUTO_CODE = `
for r in records:
    if not r.product_id:
        continue
    if not r.product_id.product_tmpl_id:
        continue
    tmpl_id = r.product_id.product_tmpl_id.id
    keep = False
    if r.x_packaging_id:
        if r.x_packaging_id.x_product_tmpl_id:
            if r.x_packaging_id.x_product_tmpl_id.id == tmpl_id:
                keep = True
    if keep:
        continue
    default = env['x_product_packaging'].search([
        ('x_product_tmpl_id', '=', tmpl_id),
        ('x_is_default', '=', True),
    ], limit=1)
    if default:
        r.write({'x_packaging_id': default.id})
    else:
        if r.x_packaging_id:
            r.write({'x_packaging_id': False})
`.trim();

async function upsertServerAction(name, modelId, code){
  const existing = await findOne("ir.actions.server",[["name","=",name]],["id"]);
  const vals = {name,model_id:modelId,state:"code",code,usage:"base_automation"};
  if (existing){
    await call("ir.actions.server","write",{ids:[existing.id],vals});
    console.log(`  ir.actions.server "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("ir.actions.server","create",{vals_list:[vals]});
  recordOp({model:"ir.actions.server",id,action:"create",name});
  console.log(`  ir.actions.server "${name}" created id=${id}`);
  return id;
}

async function upsertAutomation({name, modelId, triggerFieldName}){
  const trigField = await findOne("ir.model.fields",
    [["model","=",name.includes("purchase")?"purchase.order.line":"sale.order.line"],["name","=",triggerFieldName]],
    ["id"]);
  if (!trigField) throw new Error(`no trigger field for ${name}`);

  const existing = await findOne("base.automation",[["name","=",name]],["id"]);
  const saName = `${name} — action`;
  const saId = await upsertServerAction(saName, modelId, AUTO_CODE);

  const vals = {
    name,
    model_id: modelId,
    trigger: "on_create_or_write",
    trigger_field_ids: [[6,0,[trigField.id]]],
    filter_domain: false,
    action_server_ids: [[6,0,[saId]]],
    active: true,
  };
  if (existing){
    await call("base.automation","write",{ids:[existing.id],vals});
    console.log(`  base.automation "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("base.automation","create",{vals_list:[vals]});
  recordOp({model:"base.automation",id,action:"create",name});
  console.log(`  base.automation "${name}" created id=${id}`);
  return id;
}

const solModel = await findOne("ir.model",[["model","=","sale.order.line"]],["id"]);
if (!solModel) throw new Error("sale.order.line model row missing");

await upsertAutomation({
  name: "utak.sale.order.line.default_packaging",
  modelId: solModel.id,
  triggerFieldName: "product_id",
});

await upsertAutomation({
  name: "utak.purchase.order.line.default_packaging",
  modelId: polModel.id,
  triggerFieldName: "product_id",
});

console.log(`\nDONE — rollback: ${ROLLBACK_PATH}`);
