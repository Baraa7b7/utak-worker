// Item 5 read-only: inspect x_type selection + Automations 8 & 9 + rows 35, 41.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// 1. x_type field
const fields = await call("x_product_packaging","fields_get",{attributes:["type","string","selection"]});
console.log("x_type field:", JSON.stringify(fields.x_type, null, 2));

// 2. Selection option IDs on the field
const fieldRow = await call("ir.model.fields","search_read",{
  domain: [["model","=","x_product_packaging"],["name","=","x_type"]],
  fields: ["id","name","ttype","selection_ids"],
});
console.log("\nir.model.fields x_type:", JSON.stringify(fieldRow, null, 2));
if (fieldRow[0]?.selection_ids?.length) {
  const opts = await call("ir.model.fields.selection","read",{
    ids: fieldRow[0].selection_ids,
    fields: ["id","name","value","sequence","field_id"],
  });
  console.log("\nselection options:", JSON.stringify(opts, null, 2));
}

// 3. Automations 8 and 9
const autos = await call("base.automation","read",{
  ids: [8, 9],
  fields: ["id","name","model_name","trigger","active","filter_domain","trigger_field_ids","action_server_ids"],
});
console.log("\nAutomations 8 & 9:", JSON.stringify(autos, null, 2));
// Their server actions
for (const a of autos) {
  if (a.action_server_ids?.length) {
    const acts = await call("ir.actions.server","read",{
      ids: a.action_server_ids,
      fields: ["id","name","state","code","update_field_id","update_boolean_value","selection_value"],
    });
    console.log(`\naction_server for automation ${a.id}:`, JSON.stringify(acts, null, 2));
  }
}

// 4. Rows 35 and 41
const rows = await call("x_product_packaging","read",{
  ids: [35, 41],
  fields: ["id","x_name","x_product_tmpl_id","x_type","x_approx_weight_kg","x_is_default","x_sequence"],
});
console.log("\nrows 35 & 41:", JSON.stringify(rows, null, 2));

// 5. All watermelon packagings (product تمrows[?].x_product_tmpl_id[0])
if (rows.find(r => r.id === 41)?.x_product_tmpl_id) {
  const watermelonTmpl = rows.find(r => r.id === 41).x_product_tmpl_id[0];
  const pkgs = await call("x_product_packaging","search_read",{
    domain: [["x_product_tmpl_id","=",watermelonTmpl]],
    fields: ["id","x_name","x_type","x_approx_weight_kg","x_is_default","x_sequence"],
    order: "x_sequence, id",
  });
  console.log(`\nAll packagings for watermelon (tmpl=${watermelonTmpl}):`, JSON.stringify(pkgs, null, 2));
}
