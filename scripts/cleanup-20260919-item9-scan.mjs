// Item 9 scan: inspect x_whatsapp_template fields, existing views, and all rows.
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const f = await call("x_whatsapp_template","fields_get",{attributes:["type","string","relation"]});
console.log("x_whatsapp_template fields (x_ prefix):");
for (const [k,v] of Object.entries(f).filter(([k])=>k.startsWith("x_"))) {
  console.log(`  ${k.padEnd(28)} type=${v.type} rel=${v.relation??""} str=${v.string}`);
}

const modelRow = await call("ir.model","search_read",{
  domain:[["model","=","x_whatsapp_template"]],
  fields:["id","model","name","state"],
});
console.log("\nir.model row:", JSON.stringify(modelRow));
const modelFields = await call("ir.model","fields_get",{attributes:["type","string"]});
console.log("ir.model available fields:", Object.keys(modelFields).filter(k => k.includes("name")).join(", "));

const rows = await call("x_whatsapp_template","search_read",{
  domain:[],
  fields:["id","x_meta_template_id","x_language","x_purpose","x_meta_status","x_missing_in_meta"],
  order:"id asc",
});
console.log(`\nTemplates total: ${rows.length}`);
for (const r of rows) console.log(`  ${JSON.stringify(r)}`);

// existing views for x_whatsapp_template
const views = await call("ir.ui.view","search_read",{
  domain:[["model","=","x_whatsapp_template"]],
  fields:["id","name","type","inherit_id","priority","mode","active"],
  order:"type, id",
});
console.log(`\nViews for x_whatsapp_template: ${views.length}`);
for (const v of views) console.log(`  ${JSON.stringify(v)}`);
