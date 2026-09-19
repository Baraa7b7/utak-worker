// Item 2 — deactivate bananas for sale (Amerian 97, Indian 109).
// x_is_active_for_sale = false so Baraa can price them before they return.
// Records BEFORE snapshot into linepack-20260919-rollback.json.

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

const IDS = [97, 109];
const rows = await call("product.template","read",{ids:IDS,fields:["id","name","x_is_active_for_sale","sale_ok"]});
console.log("BEFORE:");
for (const r of rows) console.log(`  ${JSON.stringify(r)}`);

for (const r of rows) {
  if (r.x_is_active_for_sale === false) {
    console.log(`  #${r.id} "${r.name}" already inactive — skip`);
    continue;
  }
  recordOp({model:"product.template",id:r.id,action:"write",before:{x_is_active_for_sale:r.x_is_active_for_sale},vals:{x_is_active_for_sale:false}});
  await call("product.template","write",{ids:[r.id],vals:{x_is_active_for_sale:false}});
  console.log(`  ✓ #${r.id} "${r.name}" → x_is_active_for_sale=false`);
}

const after = await call("product.template","read",{ids:IDS,fields:["id","name","x_is_active_for_sale"]});
console.log("\nAFTER:");
for (const r of after) console.log(`  ${JSON.stringify(r)}`);
