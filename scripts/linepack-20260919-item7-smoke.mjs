// Smoke test the packaging automation — no PDF, no deploy dependency.
// Creates a sale.order and a purchase.order (draft), verifies auto-default,
// verifies manual override sticks, then deletes both.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

console.log("--- SALE.ORDER automation smoke test ---");
const soIds = await call("sale.order","create",{vals_list:[{
  partner_id: 31,
  origin: "UTAK-LINEPACK-SMOKE",
  order_line: [
    [0,0,{product_id:71,  name:"طماطم", product_uom_qty:5, price_unit:30, tax_ids:[[6,0,[]]]}],
    [0,0,{product_id:104, name:"بطيخ",  product_uom_qty:3, price_unit:20, tax_ids:[[6,0,[]]]}],
  ],
}]});
const soId = soIds[0];
console.log(`created sale.order id=${soId}`);
const so = await call("sale.order","read",{ids:[soId],fields:["order_line"]});
const solLines = await call("sale.order.line","read",{ids:so[0].order_line,fields:["id","product_id","x_packaging_id"]});
for (const l of solLines) console.log(`  line ${l.id}: product ${JSON.stringify(l.product_id)} → x_packaging_id=${JSON.stringify(l.x_packaging_id)}`);

const tomatoLine = solLines.find((l)=>l.product_id?.[0]===71);
const wmLine = solLines.find((l)=>l.product_id?.[0]===104);
if (tomatoLine.x_packaging_id?.[0] !== 1) console.warn(`FAIL: tomato SO line should have pack #1 فلين, got ${JSON.stringify(tomatoLine.x_packaging_id)}`);
else console.log(`✓ tomato SO line default → فلين (id=1)`);
if (wmLine.x_packaging_id?.[0] !== 41) console.warn(`FAIL: watermelon SO line should have pack #41, got ${JSON.stringify(wmLine.x_packaging_id)}`);
else console.log(`✓ watermelon SO line default → حبة (id=41)`);

// override tomato to جرم (id=2) and re-read
await call("sale.order.line","write",{ids:[tomatoLine.id],vals:{x_packaging_id:2}});
const [after] = await call("sale.order.line","read",{ids:[tomatoLine.id],fields:["x_packaging_id"]});
if (after.x_packaging_id?.[0] !== 2) console.warn(`FAIL: manual override was reset — got ${JSON.stringify(after.x_packaging_id)}`);
else console.log(`✓ manual override preserved (SO line → جرم id=2)`);

// change tomato to watermelon → automation should reset packaging to watermelon's default
await call("sale.order.line","write",{ids:[tomatoLine.id],vals:{product_id:104}});
const [swapped] = await call("sale.order.line","read",{ids:[tomatoLine.id],fields:["product_id","x_packaging_id"]});
if (swapped.x_packaging_id?.[0] !== 41) console.warn(`FAIL: product-change should reset to watermelon default (41), got ${JSON.stringify(swapped.x_packaging_id)}`);
else console.log(`✓ product change reset SO line packaging to watermelon default حبة (id=41)`);

console.log("\n--- PURCHASE.ORDER automation smoke test ---");
const poIds = await call("purchase.order","create",{vals_list:[{
  partner_id: 30,
  origin: "UTAK-LINEPACK-SMOKE",
  order_line: [
    [0,0,{product_id:71,  name:"طماطم", product_qty:5, price_unit:22, tax_ids:[[6,0,[]]]}],
    [0,0,{product_id:104, name:"بطيخ",  product_qty:3, price_unit:0.6, tax_ids:[[6,0,[]]]}],
  ],
}]});
const poId = poIds[0];
console.log(`created purchase.order id=${poId}`);
const po = await call("purchase.order","read",{ids:[poId],fields:["order_line"]});
const polLines = await call("purchase.order.line","read",{ids:po[0].order_line,fields:["id","product_id","x_packaging_id"]});
for (const l of polLines) console.log(`  line ${l.id}: product ${JSON.stringify(l.product_id)} → x_packaging_id=${JSON.stringify(l.x_packaging_id)}`);
const polTomato = polLines.find((l)=>l.product_id?.[0]===71);
const polWm = polLines.find((l)=>l.product_id?.[0]===104);
if (polTomato.x_packaging_id?.[0] !== 1) console.warn(`FAIL: tomato PO line should default to فلين (1), got ${JSON.stringify(polTomato.x_packaging_id)}`);
else console.log(`✓ tomato PO line default → فلين (id=1)`);
if (polWm.x_packaging_id?.[0] !== 41) console.warn(`FAIL: watermelon PO line should default to حبة (41), got ${JSON.stringify(polWm.x_packaging_id)}`);
else console.log(`✓ watermelon PO line default → حبة (id=41)`);

// cleanup
console.log("\ncleanup");
await call("sale.order","unlink",{ids:[soId]});
console.log(`✓ deleted sale.order id=${soId}`);
await call("purchase.order","button_cancel",{ids:[poId]});
await call("purchase.order","unlink",{ids:[poId]});
console.log(`✓ deleted purchase.order id=${poId}`);
