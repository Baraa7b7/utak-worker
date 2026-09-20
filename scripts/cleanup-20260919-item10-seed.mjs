// Seed a draft purchase.order + a draft customer invoice for PDF-button verification.
// Both stay in draft — no accounting/payment impact.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const AHMED = 30;
const CUST = 31; // ابو مكين المعبري

// Find a UTAK product variant for line testing
const variants = await call("product.product","search_read",{
  domain: [["product_tmpl_id.default_code","=like","UTAK-%"]],
  fields:["id","display_name","product_tmpl_id","uom_id"],
  limit: 3,
});
console.log("variants:", JSON.stringify(variants));

// 1) purchase.order — draft
const poIds = await call("purchase.order","create",{
  vals_list: [{
    partner_id: AHMED,
    date_order: "2026-09-19 12:00:00",
    origin: "UTAK-CLEANUP-TEST",
    order_line: variants.slice(0,2).map(v => [0,0,{
      product_id: v.id,
      name: v.display_name,
      product_qty: 2,
      price_unit: 15,
      uom_id: v.uom_id?.[0] ?? 1,
      tax_ids: [[6,0,[]]],
    }]),
  }],
});
const poId = Array.isArray(poIds) ? poIds[0] : poIds;
console.log(`\ncreated purchase.order id=${poId}`);

// 2) account.move — draft customer invoice
const journals = await call("account.journal","search_read",{domain:[["type","=","sale"]],fields:["id","name","code"]});
const journalId = journals[0]?.id;
if (!journalId) { console.error("no sale journal"); process.exit(1); }
const invIds = await call("account.move","create",{
  vals_list: [{
    move_type: "out_invoice",
    partner_id: CUST,
    invoice_date: "2026-09-19",
    journal_id: journalId,
    invoice_line_ids: variants.slice(0,2).map(v => [0,0,{
      product_id: v.id,
      name: v.display_name,
      quantity: 3,
      price_unit: 12,
      tax_ids: [[6,0,[]]],
    }]),
  }],
});
const invId = Array.isArray(invIds) ? invIds[0] : invIds;
console.log(`created account.move id=${invId}`);

console.log(`\nSEED RESULT — for verification only, leave in draft:`);
console.log(`  sale.order      : 6`);
console.log(`  purchase.order  : ${poId}`);
console.log(`  account.move    : ${invId}`);
