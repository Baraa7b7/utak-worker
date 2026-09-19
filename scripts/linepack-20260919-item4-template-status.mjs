// Item 4 — pull utak_supplier_confirm_v1 status/category from Meta and
// update x_meta_status on x_whatsapp_template id=46. No send.

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY,META_ACCESS_TOKEN}=env;

if (!META_ACCESS_TOKEN) { console.error("STOP: META_ACCESS_TOKEN not in .env.sim-verify"); process.exit(1); }

const WABA_ID = "2144001136512196";
const GRAPH = "https://graph.facebook.com/v22.0";

// 1) Pull template list filtered by name
const url = `${GRAPH}/${WABA_ID}/message_templates?name=utak_supplier_confirm_v1&fields=id,name,language,status,category,rejected_reason,quality_score,previous_category`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
const meta = await r.json();
if (!r.ok) { console.error("Meta error:", JSON.stringify(meta)); process.exit(1); }
console.log("Meta response for utak_supplier_confirm_v1:");
console.log(JSON.stringify(meta, null, 2));

const tpl = (meta.data ?? []).find((t) => t.id === "949738058176454" || t.name === "utak_supplier_confirm_v1");
if (!tpl) { console.log("Template not found by name — check the id"); process.exit(0); }

const {status, category, rejected_reason, previous_category} = tpl;
console.log(`\nStatus=${status}  category=${category}  previous_category=${previous_category ?? ""}  rejected=${rejected_reason ?? ""}`);

if (category === "MARKETING") {
  console.log("\n⚠️  CATEGORY CHANGED TO MARKETING — will NOT resubmit. Reporting only.");
}

// 2) Update Odoo x_whatsapp_template id=46 x_meta_status
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const rp=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await rp.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!rp.ok){if(rp.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${rp.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const row = await call("x_whatsapp_template","read",{ids:[46],fields:["id","x_meta_id","x_meta_template_id","x_meta_status","x_category","x_missing_in_meta","x_last_synced"]});
console.log(`\nOdoo x_whatsapp_template id=46 BEFORE:`, JSON.stringify(row[0]));

const ROLLBACK_PATH = new URL("./artifacts/linepack-20260919-rollback.json", import.meta.url).pathname;
const rollback = JSON.parse(readFileSync(ROLLBACK_PATH,"utf8"));
function recordOp(op){rollback.operations.push({ts:new Date().toISOString(),...op});writeFileSync(ROLLBACK_PATH,JSON.stringify(rollback,null,2));}

const vals = {};
if (row[0].x_meta_status !== status) vals.x_meta_status = status;
if (category && row[0].x_category !== category) vals.x_category = category;
if (row[0].x_missing_in_meta) vals.x_missing_in_meta = false;
vals.x_last_synced = new Date().toISOString().slice(0,19).replace("T"," ");

if (Object.keys(vals).length === 1 && "x_last_synced" in vals && row[0].x_meta_status === status && row[0].x_category === category && !row[0].x_missing_in_meta) {
  console.log("Already in sync — no write.");
} else {
  const before = {};
  for (const k of Object.keys(vals)) before[k] = row[0][k];
  recordOp({model:"x_whatsapp_template",id:46,action:"write",before,vals});
  await call("x_whatsapp_template","write",{ids:[46],vals});
  const after = await call("x_whatsapp_template","read",{ids:[46],fields:["id","x_meta_status","x_category","x_missing_in_meta","x_last_synced"]});
  console.log(`AFTER:`, JSON.stringify(after[0]));
}
