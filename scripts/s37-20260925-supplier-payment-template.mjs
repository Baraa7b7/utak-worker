// § 37 (2026-09-25): utak_supplier_payment_sent at Meta — the supplier's
// notice of a payment Baraa approved. UTILITY, Arabic, no buttons, 4 variables:
// {{1}} the amount (2 decimals), {{2}} the Riyadh date, {{3}} the reference
// (SP-2026-0001), {{4}} what UTAK still owes him (2 decimals, never below 0).
//
//   node scripts/s37-20260925-supplier-payment-template.mjs            (dry-run: the text, and whether the name exists at Meta)
//   node scripts/s37-20260925-supplier-payment-template.mjs --meta     (POST once if the name does not exist — never a retry)
//   node scripts/s37-20260925-supplier-payment-template.mjs --status   (GET: status / category)
//
// Meta: the only write is POST /message_templates for a name Meta does not
// have (any status). No delete, no edit, no second wording: if Meta rejects it
// or files it MARKETING it is not re-submitted and the gateway never uses it
// (the notice then waits, held, for the supplier's next message — § 34).
// Out: scripts/artifacts/s37-20260925-supplier-payment-template-meta.json. No WhatsApp send.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const SUPPLIER_PAYMENT_TEMPLATE = {
  name: "utak_supplier_payment_sent",
  purpose: "supplier_payment_sent",
  label: "إشعار دفعة للمورد",
  body: "تم تسجيل دفعة لك من يو تاك بمبلغ {{1}} ر.س بتاريخ {{2}}، رقم المرجع {{3}}. الرصيد المتبقي لك: {{4}} ر.س.",
  example: ["1500.00", "26 سبتمبر 2026", "SP-2026-0001", "250.00"],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = Object.fromEntries(
    readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const V = "v22.0", WABA = "2144001136512196";
  const TOKEN = env.META_ACCESS_TOKEN;
  const OUT = new URL("./artifacts/s37-20260925-supplier-payment-template-meta.json", import.meta.url).pathname;
  const META = process.argv.includes("--meta");
  const log = (...a) => console.log(...a);
  const t = SUPPLIER_PAYMENT_TEMPLATE;
  const vars = t.body.match(/\{\{\d+\}\}/g) ?? [];
  if (vars.join() !== "{{1}},{{2}},{{3}},{{4}}") throw new Error(`variables ${vars}`);
  if (/^\s*\{\{/.test(t.body) || /\}\}\s*[.،]?\s*$/.test(t.body)) throw new Error("starts or ends with a variable");

  async function inventory() {
    const all = [];
    let url = `https://graph.facebook.com/${V}/${WABA}/message_templates?limit=100&fields=id,name,language,status,category,previous_category,rejected_reason,components`;
    while (url) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      all.push(...j.data);
      url = j.paging?.next;
    }
    return all;
  }
  const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s37-20260925-supplier-payment-template.mjs", created: null };
  const before = await inventory();
  const have = before.find((x) => x.name === t.name);
  log(`${t.name}\n  «${t.body}»\n  example ${JSON.stringify(t.example)} · no buttons · UTILITY · ar`);
  if (have) log(`  = exists at Meta: ${have.status}/${have.category}${have.previous_category ? ` (was ${have.previous_category})` : ""} — not re-submitted`);
  else if (!META) log("  + would POST (dry-run)");
  else {
    const payload = { name: t.name, language: "ar", category: "UTILITY", components: [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }] };
    const r = await fetch(`https://graph.facebook.com/${V}/${WABA}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    report.created = { at: new Date().toISOString(), http: r.status, response: j, payload };
    writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
    log(`  → POST ${r.status} ${JSON.stringify(j)}`);
  }
  const after = await inventory();
  const m = after.find((x) => x.name === t.name);
  report.status = m ? { id: m.id, status: m.status, category: m.category, previous_category: m.previous_category ?? null, rejected_reason: m.rejected_reason ?? null } : null;
  report.statusAt = new Date().toISOString();
  (report.history ??= []).push({ at: report.statusAt, ...(report.status ?? {}) });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  log("status:", JSON.stringify(report.status));
}
