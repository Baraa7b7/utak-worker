// Inspect: does x_packaging_id exist on sale.order.line and purchase.order.line?
// What automation, if any, is already firing on them? What views inherit the standard tree?

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// x_packaging_id on sale.order.line
const solFields = await call("ir.model.fields","search_read",{
  domain:[["model","=","sale.order.line"],["name","=","x_packaging_id"]],
  fields:["id","name","ttype","relation","field_description","state","on_delete","domain","related"],
});
console.log("sale.order.line.x_packaging_id:", JSON.stringify(solFields));

// x_packaging_id on purchase.order.line
const polFields = await call("ir.model.fields","search_read",{
  domain:[["model","=","purchase.order.line"],["name","=","x_packaging_id"]],
  fields:["id","name","ttype","relation","field_description","state","on_delete","domain","related"],
});
console.log("purchase.order.line.x_packaging_id:", JSON.stringify(polFields));

// list views for sale.order.line and purchase.order.line
const solViews = await call("ir.ui.view","search_read",{
  domain:[["model","=","sale.order"],["name","ilike","order.line"]],
  fields:["id","name","type","inherit_id","priority"],
});
console.log("\nsale.order line-related views:");
for (const v of solViews) console.log(`  ${JSON.stringify(v)}`);

const polViews = await call("ir.ui.view","search_read",{
  domain:[["model","=","purchase.order"],["name","ilike","order.line"]],
  fields:["id","name","type","inherit_id","priority"],
});
console.log("\npurchase.order line-related views:");
for (const v of polViews) console.log(`  ${JSON.stringify(v)}`);

// custom views on sale.order and purchase.order
const utakViews = await call("ir.ui.view","search_read",{
  domain:[["name","=like","utak.%"]],
  fields:["id","name","model","type","inherit_id","priority","active"],
});
console.log(`\nutak.* views (${utakViews.length}):`);
for (const v of utakViews) console.log(`  ${JSON.stringify(v)}`);

// automations targeting sale.order.line / purchase.order.line
const autos = await call("base.automation","search_read",{
  domain:[["model_name","in",["sale.order.line","purchase.order.line"]]],
  fields:["id","name","model_name","trigger","filter_domain","active"],
});
console.log("\nautomations on line models:");
for (const a of autos) console.log(`  ${JSON.stringify(a)}`);

// standard sale/purchase order form views (for reference; we inherit)
const standardForms = await call("ir.ui.view","search_read",{
  domain:[["model","in",["sale.order","purchase.order"]],["type","=","form"],["inherit_id","=",false]],
  fields:["id","name","model"],
  limit:5,
});
console.log("\nStandard form views (no inherit):");
for (const v of standardForms) console.log(`  ${JSON.stringify(v)}`);

// x_product_packaging field list for domain wire-up
const packFields = await call("ir.model.fields","search_read",{
  domain:[["model","=","x_product_packaging"]],
  fields:["id","name","ttype","relation","field_description"],
  order:"name",
});
console.log(`\nx_product_packaging fields (${packFields.length}):`);
for (const f of packFields) console.log(`  ${f.name} ${f.ttype}${f.relation?" → "+f.relation:""}`);
