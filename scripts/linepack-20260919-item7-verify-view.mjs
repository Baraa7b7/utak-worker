// Verify views parse & fields are correctly resolved via fields_view_get / get_view.
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// Try get_view on sale.order form
try {
  const v = await call("sale.order","get_view",{view_id:1225,view_type:"form"});
  console.log(`sale.order get_view OK — arch len ${v.arch?.length ?? 0}`);
  // check that x_packaging_id appears in the resulting arch
  const hasField = v.arch?.includes("x_packaging_id");
  console.log(`  x_packaging_id in resolved arch: ${hasField}`);
} catch (e) { console.error("sale.order get_view FAIL:", e.message); }

try {
  const v = await call("purchase.order","get_view",{view_id:2165,view_type:"form"});
  console.log(`purchase.order get_view OK — arch len ${v.arch?.length ?? 0}`);
  const hasField = v.arch?.includes("x_packaging_id");
  console.log(`  x_packaging_id in resolved arch: ${hasField}`);
} catch (e) { console.error("purchase.order get_view FAIL:", e.message); }
