// Fetch existing list views' arch to plan first-column insertion.
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}
const v = await call("ir.ui.view","read",{ids:[2723,2731],fields:["id","name","arch","type","mode","inherit_id"]});
for (const x of v) { console.log(`\n---- view id=${x.id} name=${x.name} type=${x.type} mode=${x.mode} inherit=${JSON.stringify(x.inherit_id)}`); console.log(x.arch); }
