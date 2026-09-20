// Item 6 — Rename watermelon template to "بطيخ (بالحبة)" and deactivate sale.
// Also report banana states (do NOT change bananas).

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

// Check what fields product.template has (x_is_active_for_sale? or sale_ok?)
const pf = await call("product.template","fields_get",{attributes:["type","string"]});
const activeCandidates = ["x_is_active_for_sale","sale_ok","active"];
console.log(`available active-ish fields:`, activeCandidates.filter(f => pf[f]).map(f => `${f}(${pf[f].type})`));

// Watermelon
const wm = (await call("product.template","search_read",{
  domain:[["id","=",104]],
  fields:["id","name","default_code","sale_ok","x_is_active_for_sale","list_price"],
}))[0];
console.log(`\nWatermelon BEFORE: ${JSON.stringify(wm)}`);

const NEW_NAME = "بطيخ (بالحبة)";
const vals = {};
if (wm.name !== NEW_NAME) vals.name = NEW_NAME;
if (wm.x_is_active_for_sale !== false) vals.x_is_active_for_sale = false;
if (Object.keys(vals).length > 0) {
  record({ ts: new Date().toISOString(), model:"product.template", id: 104, before: { name: wm.name, x_is_active_for_sale: wm.x_is_active_for_sale }, action:"write" });
  await call("product.template","write",{ids:[104],vals});
  console.log(`  wrote ${JSON.stringify(vals)}`);
}
const wmAfter = (await call("product.template","read",{ids:[104],fields:["id","name","x_is_active_for_sale","sale_ok","list_price"]}))[0];
console.log(`Watermelon AFTER: ${JSON.stringify(wmAfter)}`);

// Bananas — read only
const bananas = await call("product.template","search_read",{
  domain: [["default_code","in",["UTAK-FRT-002","UTAK-FRT-013"]]],
  fields: ["id","name","default_code","sale_ok","x_is_active_for_sale","list_price"],
  order: "default_code",
});
console.log(`\nBananas (READ-ONLY, unchanged):`);
for (const b of bananas) console.log(`  ${JSON.stringify(b)}`);
