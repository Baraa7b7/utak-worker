// Item 8 — set web_icon_data on ir.ui.menu id=529 to utak-icon-color-192.png.
// Records previous value.

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

const ICON_PATH = "/Users/baraa7/Desktop/Utak/logos kit/png/utak-icon-color-192.png";
const bytes = readFileSync(ICON_PATH);
const b64 = bytes.toString("base64");
console.log(`icon file: ${ICON_PATH} (${bytes.length} bytes → ${b64.length} chars base64)`);

const before = await call("ir.ui.menu","read",{ids:[529],fields:["id","name","web_icon","web_icon_data"]});
if (!before[0]) { console.error("STOP: ir.ui.menu id=529 not found"); process.exit(1); }
console.log(`BEFORE id=529 name="${before[0].name}" web_icon="${before[0].web_icon}"`);
console.log(`  web_icon_data (before) len=${(before[0].web_icon_data||"").length}`);

recordOp({model:"ir.ui.menu",id:529,action:"write",before:{web_icon_data:before[0].web_icon_data ?? false}});
await call("ir.ui.menu","write",{ids:[529],vals:{web_icon_data:b64}});

const after = await call("ir.ui.menu","read",{ids:[529],fields:["id","name","web_icon","web_icon_data"]});
console.log(`AFTER  id=529 web_icon_data len=${(after[0].web_icon_data||"").length}`);
if (!after[0].web_icon_data || after[0].web_icon_data.length===0) throw new Error("web_icon_data empty after write");
console.log("✓ icon applied");
