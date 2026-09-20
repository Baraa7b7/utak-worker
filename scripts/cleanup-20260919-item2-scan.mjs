// Scan for any test bill or PO artifacts referenced by item3's bill flow.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// All account.move rows tagged as bills
const bills = await call("account.move","search_read",{
  domain:[["move_type","=","in_invoice"]],
  fields:["id","name","state","payment_state","invoice_date","date","partner_id","amount_total","ref","invoice_origin","create_date"],
  order:"id asc",
});
console.log(`in_invoice (vendor bill) rows: ${bills.length}`);
for (const b of bills) console.log(`  ${JSON.stringify(b)}`);

// All purchase.order rows for Ahmed
const pos = await call("purchase.order","search_read",{
  domain:[["partner_id","=",30]],
  fields:["id","name","state","date_order","amount_total","origin","invoice_status","invoice_ids","create_date"],
  order:"id asc",
});
console.log(`\npurchase.order rows for Ahmed (id=30): ${pos.length}`);
for (const po of pos) console.log(`  ${JSON.stringify(po)}`);

// All account.move rows regardless of type
const all = await call("account.move","search_read",{
  domain:[],
  fields:["id","name","state","move_type","payment_state","create_date"],
  order:"id asc",
});
console.log(`\nAll account.move rows: ${all.length}`);
for (const m of all) console.log(`  ${JSON.stringify(m)}`);

// Sequence used for vendor bills
const seqs = await call("ir.sequence","search_read",{
  domain:[["code","=","account.move"]],
  fields:["id","name","code","prefix","padding","number_next_actual","implementation","use_date_range"],
});
console.log(`\nir.sequence code=account.move: ${JSON.stringify(seqs)}`);
const seqDR = await call("ir.sequence.date_range","search_read",{
  domain:[],
  fields:["id","sequence_id","date_from","date_to","number_next_actual"],
});
console.log(`\nir.sequence.date_range rows: ${JSON.stringify(seqDR)}`);
