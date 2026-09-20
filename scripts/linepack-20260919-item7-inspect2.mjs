// Check purchase.order.line fields to know product_template_id availability and default view arch.
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// Check product_template_id on both models
for (const model of ["sale.order.line","purchase.order.line"]) {
  const f = await call("ir.model.fields","search_read",{
    domain:[["model","=",model],["name","in",["product_id","product_template_id"]]],
    fields:["id","name","ttype","relation","field_description","related"],
  });
  console.log(`${model}:`);
  for (const r of f) console.log(`  ${JSON.stringify(r)}`);
}

// Check ir.model row for these two models — needed for automation model_id
const models = await call("ir.model","search_read",{
  domain:[["model","in",["sale.order.line","purchase.order.line","product.template"]]],
  fields:["id","model","name"],
});
console.log("\nir.model rows:");
for (const r of models) console.log(`  ${JSON.stringify(r)}`);

// standard sale.order.line list view arch (get id and inspect)
const solList = await call("ir.ui.view","search_read",{
  domain:[["model","=","sale.order.line"],["type","=","list"]],
  fields:["id","name","inherit_id","priority"],
});
console.log("\nsale.order.line list views:");
for (const v of solList) console.log(`  ${JSON.stringify(v)}`);

const polList = await call("ir.ui.view","search_read",{
  domain:[["model","=","purchase.order.line"],["type","=","list"]],
  fields:["id","name","inherit_id","priority"],
});
console.log("\npurchase.order.line list views:");
for (const v of polList) console.log(`  ${JSON.stringify(v)}`);

// Look at what the sale.order.form line_ids block contains, to know where to xpath.
const soForm = await call("ir.ui.view","read",{ids:[1225],fields:["id","arch"]});
const soArch = soForm[0].arch;
// print a slice near order_line
const orderLineIdx = soArch.indexOf("order_line");
if (orderLineIdx>-1){
  console.log("\nsale.order.form arch — around order_line:");
  console.log(soArch.slice(Math.max(0,orderLineIdx-100), orderLineIdx+1500));
}

const poForm = await call("ir.ui.view","read",{ids:[2165],fields:["id","arch"]});
const poArch = poForm[0].arch;
const idx = poArch.indexOf("order_line");
if (idx>-1){
  console.log("\npurchase.order.form arch — around order_line:");
  console.log(poArch.slice(Math.max(0,idx-100), idx+1500));
}
