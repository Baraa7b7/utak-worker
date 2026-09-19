// Item 3 (read-only) — Ahmed Hassan (partner 30) supplier balance +
// journal entries. Expects zero after test bill delete. No writes.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const AHMED = 30;
const ahmed = await call("res.partner","read",{ids:[AHMED],fields:["id","name","supplier_rank","customer_rank","property_account_payable_id","property_account_receivable_id","credit","debit"]});
console.log(`Partner ${AHMED}:`, JSON.stringify(ahmed[0]));

// Payable balance: sum of account.move.lines against Ahmed on the payable account
const payableAcc = ahmed[0].property_account_payable_id?.[0];
if (!payableAcc) console.log("\nNo payable account set on partner (expected true when nothing has been posted).");
else {
  const payableLines = await call("account.move.line","search_read",{
    domain:[["partner_id","=",AHMED],["account_id","=",payableAcc],["parent_state","=","posted"]],
    fields:["id","move_id","account_id","debit","credit","balance","date","name"],
    order:"date desc, id desc",
  });
  console.log(`\nPayable account ${payableAcc} posted lines: ${payableLines.length}`);
  let sumBalance = 0;
  for (const l of payableLines) {
    sumBalance += (l.balance ?? (l.debit - l.credit));
    console.log(`  ${JSON.stringify(l)}`);
  }
  console.log(`\nPayable balance (posted lines): ${sumBalance}`);
}

// All journal entries touching Ahmed (any account, any state) — safety net
const anyLines = await call("account.move.line","search_read",{
  domain:[["partner_id","=",AHMED]],
  fields:["id","move_id","account_id","debit","credit","balance","date","name","parent_state"],
  order:"date desc, id desc",
});
console.log(`\nAll account.move.line rows for Ahmed (any state): ${anyLines.length}`);
for (const l of anyLines) console.log(`  ${JSON.stringify(l)}`);

// Any account.move at all touching Ahmed
const moves = await call("account.move","search_read",{
  domain:[["partner_id","=",AHMED]],
  fields:["id","name","state","move_type","amount_total","date","payment_state"],
  order:"date desc, id desc",
});
console.log(`\nAll account.move for Ahmed: ${moves.length}`);
for (const m of moves) console.log(`  ${JSON.stringify(m)}`);
