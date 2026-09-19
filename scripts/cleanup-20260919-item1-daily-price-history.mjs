import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw 0;auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// Full history — every x_daily_price row ever
const rows = await call("x_daily_price","search_read",{
  domain: [],
  fields: ["id","x_date","x_product_tmpl_id","x_supplier_id","x_price_sar","create_date","x_is_simulation"],
  order: "id asc",
});
console.log(`Total x_daily_price rows: ${rows.length}`);
// Group by date
const byDate = new Map();
for (const r of rows) {
  if (!byDate.has(r.x_date)) byDate.set(r.x_date, []);
  byDate.get(r.x_date).push(r);
}
console.log(`\nRows per date:`);
for (const [d, arr] of [...byDate.entries()].sort()) {
  console.log(`  ${d}: ${arr.length}`);
}

// Show all rows briefly
console.log(`\nAll rows:`);
for (const r of rows) {
  const p = Array.isArray(r.x_product_tmpl_id) ? r.x_product_tmpl_id[1] : r.x_product_tmpl_id;
  const s = Array.isArray(r.x_supplier_id) ? r.x_supplier_id[1] : r.x_supplier_id;
  console.log(`  id=${r.id} date=${r.x_date} prod=${String(p ?? "-").slice(0, 40).padEnd(40)} sup=${String(s ?? "-").padEnd(20)} price=${r.x_price_sar} sim=${r.x_is_simulation} create=${r.create_date}`);
}
