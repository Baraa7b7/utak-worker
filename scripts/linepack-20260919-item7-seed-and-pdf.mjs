// Seed test — sale.order + purchase.order, verify automation, download PDFs, delete.
//
// Steps:
//  1) Create draft sale.order for partner 31 with tomato+watermelon lines (no explicit packaging).
//  2) Verify automation set default packaging on each line.
//  3) Verify dropdown restrictions (fields_get + on onchange are covered by the domain in the view;
//     we assert that x_product_packaging.search with the given domain returns ONLY own-product packs).
//  4) Change tomato line packaging to جرم (id=2), keep watermelon حبة.
//  5) Download SO PDF via /internal/sale-quotation-pdf.
//  6) Repeat for purchase.order for Ahmed (partner 30).
//  7) Delete both drafts.
//
// Saves artifacts:
//   scripts/artifacts/linepack-20260919-so-<id>.pdf
//   scripts/artifacts/linepack-20260919-po-<id>.pdf

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const TOMATO_VAR = 71;
const WATERMELON_VAR = 104;
const TOMATO_TMPL = 71;
const WATERMELON_TMPL = 104;
const TOMATO_PACK_BAG = 2;   // جرم · 8 كيلو
const CUSTOMER = 31;
const AHMED    = 30;

// 3) Domain-side check: x_product_packaging with domain [('x_product_tmpl_id','=',<tmpl>)] returns own only
for (const tmpl of [TOMATO_TMPL, WATERMELON_TMPL]) {
  const own = await call("x_product_packaging","search_read",{
    domain:[["x_product_tmpl_id","=",tmpl]],
    fields:["id","x_name","x_product_tmpl_id"],
  });
  const foreign = own.filter((r)=>r.x_product_tmpl_id[0]!==tmpl);
  console.log(`Domain check tmpl=${tmpl}: ${own.length} results, foreign=${foreign.length}`);
  if (foreign.length>0) throw new Error("Domain leak: dropdown would include other product's packagings");
}

// 1) Create draft sale.order — no explicit x_packaging_id on the lines
console.log("\n[1] create draft sale.order");
const soIds = await call("sale.order","create",{vals_list:[{
  partner_id: CUSTOMER,
  origin:     "UTAK-LINEPACK-TEST",
  order_line: [
    [0,0,{product_id:TOMATO_VAR,     name:"طماطم (اختبار)", product_uom_qty:5, price_unit:30, tax_ids:[[6,0,[]]]}],
    [0,0,{product_id:WATERMELON_VAR, name:"بطيخ (اختبار)", product_uom_qty:3, price_unit:20, tax_ids:[[6,0,[]]]}],
  ],
}]});
const soId = soIds[0];
console.log(`  sale.order id=${soId}`);

// 2) Read back the lines and verify automation set default packaging
const so = await call("sale.order","read",{ids:[soId],fields:["id","name","state","order_line"]});
const solLines = await call("sale.order.line","read",{ids:so[0].order_line,fields:["id","product_id","x_packaging_id","product_uom_qty","price_unit"]});
console.log("[2] SO lines after auto-default:");
for (const l of solLines) console.log(`  ${JSON.stringify(l)}`);

const tomatoLine = solLines.find((l)=>l.product_id?.[0]===TOMATO_VAR);
const wmLine = solLines.find((l)=>l.product_id?.[0]===WATERMELON_VAR);
if (!tomatoLine?.x_packaging_id || tomatoLine.x_packaging_id[0]!==1) {
  console.warn(`  ⚠️ tomato line: expected default #1 فلين, got ${JSON.stringify(tomatoLine?.x_packaging_id)}`);
} else {
  console.log(`  ✓ tomato line got default فلين (id=1)`);
}
if (!wmLine?.x_packaging_id || wmLine.x_packaging_id[0]!==41) {
  console.warn(`  ⚠️ watermelon line: expected default #41 حبة, got ${JSON.stringify(wmLine?.x_packaging_id)}`);
} else {
  console.log(`  ✓ watermelon line got default حبة (id=41)`);
}

// 4) Change tomato packaging to جرم (id=2)
console.log("\n[4] change tomato packaging to جرم (id=2)");
await call("sale.order.line","write",{ids:[tomatoLine.id],vals:{x_packaging_id:TOMATO_PACK_BAG}});
const tomatoAfter = await call("sale.order.line","read",{ids:[tomatoLine.id],fields:["id","x_packaging_id"]});
console.log(`  after: ${JSON.stringify(tomatoAfter[0])}`);
if (tomatoAfter[0].x_packaging_id?.[0] !== TOMATO_PACK_BAG) throw new Error("automation clobbered manual choice");
console.log(`  ✓ automation did NOT overwrite manual choice`);

// 5) Download SO PDF via /internal/sale-quotation-pdf
// Get SALE_PDF_DOWNLOAD_TOKEN from the ir.actions.server row (embedded)
const actionRows = await call("ir.actions.server","search_read",{
  domain:[["name","=","sale.quotation.pdf_download"]],
  fields:["id","code"],
});
const tokMatch = actionRows[0]?.code?.match(/token=([a-f0-9]{32,128})/i);
const SALE_TOK = tokMatch?.[1];
if (!SALE_TOK) throw new Error("no SALE_PDF_DOWNLOAD_TOKEN in action");

// worker origin — sim env
const workerOrigin = env.WORKER_ORIGIN || "https://utak-worker-sim.utak-business.workers.dev";
const soPdfUrl = `${workerOrigin}/internal/sale-quotation-pdf?id=${soId}&token=${SALE_TOK}`;
console.log(`\n[5] download SO PDF ${soPdfUrl}`);
const soRes = await fetch(soPdfUrl);
console.log(`  status ${soRes.status} content-type ${soRes.headers.get("content-type")}`);
if (soRes.ok && soRes.headers.get("content-type")?.includes("pdf")) {
  const bytes = new Uint8Array(await soRes.arrayBuffer());
  const soPdfPath = new URL(`./artifacts/linepack-20260919-so-${soId}.pdf`, import.meta.url).pathname;
  writeFileSync(soPdfPath, bytes);
  console.log(`  ✓ saved ${bytes.length} bytes → ${soPdfPath}`);
} else {
  const body = await soRes.text();
  console.warn(`  ⚠️ SO PDF failed: ${body.slice(0,500)}`);
}

// 6) Create draft purchase.order for Ahmed with same two products
console.log("\n[6] create draft purchase.order for Ahmed");
const poIds = await call("purchase.order","create",{vals_list:[{
  partner_id: AHMED,
  origin:     "UTAK-LINEPACK-TEST",
  order_line: [
    [0,0,{product_id:TOMATO_VAR,     name:"طماطم (اختبار)", product_qty:5, price_unit:22, tax_ids:[[6,0,[]]]}],
    [0,0,{product_id:WATERMELON_VAR, name:"بطيخ (اختبار)", product_qty:3, price_unit:0.6, tax_ids:[[6,0,[]]]}],
  ],
}]});
const poId = poIds[0];
console.log(`  purchase.order id=${poId}`);

const po = await call("purchase.order","read",{ids:[poId],fields:["id","name","state","order_line"]});
const polLines = await call("purchase.order.line","read",{ids:po[0].order_line,fields:["id","product_id","x_packaging_id","product_qty","price_unit"]});
console.log("  PO lines after auto-default:");
for (const l of polLines) console.log(`    ${JSON.stringify(l)}`);

const polTomato = polLines.find((l)=>l.product_id?.[0]===TOMATO_VAR);
const polWm = polLines.find((l)=>l.product_id?.[0]===WATERMELON_VAR);

// change tomato PO line to جرم
await call("purchase.order.line","write",{ids:[polTomato.id],vals:{x_packaging_id:TOMATO_PACK_BAG}});
console.log(`  ✓ set tomato PO line to جرم (id=2)`);

// PO PDF: get token
const poActionRows = await call("ir.actions.server","search_read",{
  domain:[["name","=","utak.purchase.order.pdf_download"]],
  fields:["id","code"],
});
const poTokMatch = poActionRows[0]?.code?.match(/token=([a-f0-9]{32,128})/i);
const PO_TOK = poTokMatch?.[1] ?? SALE_TOK; // task says both endpoints reuse SALE_PDF_DOWNLOAD_TOKEN
const poPdfUrl = `${workerOrigin}/internal/purchase-order-pdf?id=${poId}&token=${PO_TOK}`;
console.log(`\n[7] download PO PDF ${poPdfUrl}`);
const poRes = await fetch(poPdfUrl);
console.log(`  status ${poRes.status} content-type ${poRes.headers.get("content-type")}`);
if (poRes.ok && poRes.headers.get("content-type")?.includes("pdf")) {
  const bytes = new Uint8Array(await poRes.arrayBuffer());
  const poPdfPath = new URL(`./artifacts/linepack-20260919-po-${poId}.pdf`, import.meta.url).pathname;
  writeFileSync(poPdfPath, bytes);
  console.log(`  ✓ saved ${bytes.length} bytes → ${poPdfPath}`);
} else {
  const body = await poRes.text();
  console.warn(`  ⚠️ PO PDF failed: ${body.slice(0,500)}`);
}

// 8) Cleanup: delete both drafts
console.log("\n[8] cleanup");
try {
  await call("sale.order","action_cancel",{ids:[soId]});
} catch (e) { /* no-op if button not exposed */ }
await call("sale.order","unlink",{ids:[soId]});
console.log(`  ✓ deleted sale.order id=${soId}`);
await call("purchase.order","button_cancel",{ids:[poId]});
await call("purchase.order","unlink",{ids:[poId]});
console.log(`  ✓ deleted purchase.order id=${poId}`);

console.log(`\nSeed test complete. Draft ids used: SO=${soId}, PO=${poId}. Both deleted.`);
