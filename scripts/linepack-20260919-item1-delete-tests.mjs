// Delete the test records left by the previous cleanup (item10 seed).
// Only touches drafts. Records a full BEFORE snapshot to
// scripts/artifacts/linepack-20260919-rollback.json (merged into existing).

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const ROLLBACK_PATH = new URL("./artifacts/linepack-20260919-rollback.json", import.meta.url).pathname;
let rollback;
try { rollback = JSON.parse(readFileSync(ROLLBACK_PATH,"utf8")); }
catch { rollback = { generated_at: new Date().toISOString(), operations: [] }; }

function recordOp(op){rollback.operations.push({ts:new Date().toISOString(),...op});writeFileSync(ROLLBACK_PATH,JSON.stringify(rollback,null,2));}

// ── purchase.order id=5 (P00007, draft, origin=UTAK-CLEANUP-TEST) ──
const po = await call("purchase.order","read",{ids:[5],fields:["id","name","state","partner_id","origin","date_order","amount_total","order_line"]});
if (!po[0]) { console.log("purchase.order 5 not found — skip"); }
else if (po[0].state !== "draft") {
  console.error(`STOP: purchase.order 5 state=${po[0].state}, not draft. Refuse to delete.`);
  process.exit(1);
}
else if (po[0].origin !== "UTAK-CLEANUP-TEST") {
  console.error(`STOP: purchase.order 5 origin=${po[0].origin}, expected UTAK-CLEANUP-TEST. Refuse to delete.`);
  process.exit(1);
}
else {
  const lines = po[0].order_line?.length
    ? await call("purchase.order.line","read",{ids:po[0].order_line,fields:["id","product_id","name","product_qty","price_unit","tax_ids"]})
    : [];
  recordOp({model:"purchase.order",id:5,action:"unlink",before:{...po[0],order_line_data:lines}});
  // draft PO must be cancelled before unlink on saas
  await call("purchase.order","button_cancel",{ids:[5]});
  await call("purchase.order","unlink",{ids:[5]});
  console.log(`✓ deleted purchase.order id=5 (P00007, draft, UTAK-CLEANUP-TEST)`);
}

// ── account.move id=5 (draft out_invoice partner 31 no VAT) ──
const am = await call("account.move","read",{ids:[5],fields:["id","name","state","partner_id","move_type","invoice_date","amount_total","amount_tax","journal_id","invoice_line_ids"]});
if (!am[0]) { console.log("account.move 5 not found — skip"); }
else if (am[0].state !== "draft") {
  console.error(`STOP: account.move 5 state=${am[0].state}, not draft. Refuse to delete.`);
  process.exit(1);
}
else if (am[0].move_type !== "out_invoice") {
  console.error(`STOP: account.move 5 move_type=${am[0].move_type}, expected out_invoice. Refuse to delete.`);
  process.exit(1);
}
else if (!Array.isArray(am[0].partner_id) || am[0].partner_id[0] !== 31) {
  console.error(`STOP: account.move 5 partner ${JSON.stringify(am[0].partner_id)}, expected [31,...]. Refuse to delete.`);
  process.exit(1);
}
else {
  const invlines = am[0].invoice_line_ids?.length
    ? await call("account.move.line","read",{ids:am[0].invoice_line_ids,fields:["id","product_id","name","quantity","price_unit","tax_ids"]})
    : [];
  recordOp({model:"account.move",id:5,action:"unlink",before:{...am[0],invoice_line_data:invlines}});
  await call("account.move","unlink",{ids:[5]});
  console.log(`✓ deleted account.move id=5 (draft out_invoice, partner 31, amount 72)`);
}

console.log(`\nrollback file: ${ROLLBACK_PATH}`);
