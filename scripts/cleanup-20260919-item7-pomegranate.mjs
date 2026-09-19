// Item 7 — Pomegranate packagings with weight=0 → clear weight to False.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const rollbackPath = new URL("./artifacts/cleanup-20260919-rollback.json", import.meta.url).pathname;
mkdirSync(dirname(rollbackPath), { recursive: true });
let rollback = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rollbackPath)) { try { rollback = JSON.parse(readFileSync(rollbackPath, "utf8")); } catch {} }
function record(op) { rollback.operations.push(op); writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2) + "\n"); }

// Pomegranate = default_code prefixed UTAK-FRT-011 (رمان صغير), UTAK-FRT-005 (رمان وسط), UTAK-FRT-012 (رمان كبير)
const pomTmpls = await call("product.template","search_read",{
  domain: [["default_code","in",["UTAK-FRT-005","UTAK-FRT-011","UTAK-FRT-012"]]],
  fields: ["id","default_code","name"],
});
console.log(`Pomegranate templates:`, JSON.stringify(pomTmpls));
const tmplIds = pomTmpls.map(t => t.id);

const packs = await call("x_product_packaging","search_read",{
  domain: [["x_product_tmpl_id","in",tmplIds]],
  fields: ["id","x_name","x_product_tmpl_id","x_type","x_approx_weight_kg","x_is_default"],
  order: "x_product_tmpl_id, id",
});
console.log(`\nAll pomegranate packagings:`);
for (const p of packs) console.log(`  ${JSON.stringify(p)}`);

for (const p of packs) {
  if (p.x_approx_weight_kg === 0 || p.x_approx_weight_kg === false) {
    if (p.x_approx_weight_kg === 0) {
      record({ ts: new Date().toISOString(), model:"x_product_packaging", id: p.id, before: { x_approx_weight_kg: 0 }, action:"write" });
      await call("x_product_packaging","write",{ids:[p.id],vals:{ x_approx_weight_kg: false }});
      console.log(`  cleared weight on id=${p.id} (${p.x_name})`);
    } else {
      console.log(`  id=${p.id} already false, skip`);
    }
  }
}

const after = await call("x_product_packaging","search_read",{
  domain: [["x_product_tmpl_id","in",tmplIds]],
  fields: ["id","x_name","x_type","x_approx_weight_kg","x_is_default"],
  order: "x_product_tmpl_id, id",
});
console.log(`\nAFTER:`);
for (const p of after) console.log(`  ${JSON.stringify(p)}`);
