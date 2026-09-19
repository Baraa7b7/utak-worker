// Locate tomato + watermelon templates and their packagings for the seed test.
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

// Tomato: search product.template by Arabic name
const tomato = await call("product.template","search_read",{
  domain:[["name","ilike","طماطم"]],
  fields:["id","name","default_code"],
});
console.log("Tomato templates:");
for (const t of tomato) console.log(`  #${t.id} ${t.default_code || ""} ${t.name}`);

// Watermelon
const wm = await call("product.template","search_read",{
  domain:[["name","ilike","بطيخ"]],
  fields:["id","name","default_code"],
});
console.log("\nWatermelon templates:");
for (const t of wm) console.log(`  #${t.id} ${t.default_code || ""} ${t.name}`);

// Packagings for whichever ids come back
const allTmplIds = [...tomato.map(t=>t.id), ...wm.map(t=>t.id)];
if (allTmplIds.length > 0) {
  const packs = await call("x_product_packaging","search_read",{
    domain:[["x_product_tmpl_id","in",allTmplIds]],
    fields:["id","x_name","x_product_tmpl_id","x_type","x_is_default","x_approx_weight_kg"],
    order:"x_product_tmpl_id,x_sequence,id",
  });
  console.log("\nPackagings:");
  for (const p of packs) console.log(`  #${p.id} tmpl=${JSON.stringify(p.x_product_tmpl_id)} name="${p.x_name}" type=${p.x_type} default=${p.x_is_default} w=${p.x_approx_weight_kg}`);
}

// product.product variants for those templates
if (allTmplIds.length > 0) {
  const variants = await call("product.product","search_read",{
    domain:[["product_tmpl_id","in",allTmplIds]],
    fields:["id","display_name","product_tmpl_id","uom_id"],
  });
  console.log("\nVariants:");
  for (const v of variants) console.log(`  variant #${v.id} tmpl=${JSON.stringify(v.product_tmpl_id)} name="${v.display_name}" uom=${JSON.stringify(v.uom_id)}`);
}
