// § 34 (2026-09-25): the four «فتح المحادثة» templates at Meta — one per
// recipient category, UTILITY, Arabic, one QUICK_REPLY «عرض التحديث».
//
//   node scripts/s34-20260925-opener-templates.mjs            (dry-run: the texts, and which names exist at Meta)
//   node scripts/s34-20260925-opener-templates.mjs --meta     (POST the names that do not exist yet — never a retry)
//   node scripts/s34-20260925-opener-templates.mjs --status   (GET: status / category of the four)
//
// Meta: the only write is POST /message_templates for a name Meta does not
// have (any status). No delete, no edit, and no second wording: a template
// Meta rejects or files as MARKETING is not re-submitted (§ 34 decision) — the
// gateway never uses it, and that category's important messages stay held.
// Out: scripts/artifacts/s34-20260925-opener-templates-meta.json. No WhatsApp send.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// {{1}} a reference or a date, {{2}} the kind of update in two or three words.
// The quick reply's payload is set at send time (src/wa-opener.ts OPEN_PAYLOAD).
export const OPENER_TEMPLATES = [
  {
    category: "customer",
    name: "utak_update_customer",
    purpose: "conv_open_customer",
    label: "فتح المحادثة: تحديث على الحساب (للعميل)",
    body: "يوجد تحديث على حسابك لدى يو تاك رقم {{1}}: {{2}}. اضغط «عرض التحديث» للتفاصيل.",
    example: ["1045", "إيصال الدفع"],
  },
  {
    category: "team",
    name: "utak_update_team",
    purpose: "conv_open_team",
    label: "فتح المحادثة: تحديث على المهام (للفريق)",
    body: "يوجد تحديث على مهامك في وردية {{1}}: {{2}}. اضغط «عرض التحديث» للتفاصيل.",
    example: ["26 سبتمبر 2026", "مسار التوصيل"],
  },
  {
    category: "supplier",
    name: "utak_update_supplier",
    purpose: "conv_open_supplier",
    label: "فتح المحادثة: تحديث على طلب التوريد (للمورد)",
    body: "يوجد تحديث على طلب التوريد بتاريخ {{1}}: {{2}}. اضغط «عرض التحديث» للتفاصيل.",
    example: ["26 سبتمبر 2026", "تعديل الكمية"],
  },
  {
    category: "owner",
    name: "utak_update_owner",
    purpose: "conv_open_owner",
    label: "فتح المحادثة: تحديث تشغيلي (للمالك)",
    body: "يوجد تحديث تشغيلي على حساب يو تاك بتاريخ {{1}}: {{2}}. اضغط «عرض التحديث» للتفاصيل.",
    example: ["26 سبتمبر 2026", "تنبيه تشغيلي"],
  },
];
export const OPEN_BUTTON_TEXT = "عرض التحديث";

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = Object.fromEntries(
    readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const V = "v22.0", WABA = "2144001136512196";
  const TOKEN = env.META_ACCESS_TOKEN;
  const OUT = new URL("./artifacts/s34-20260925-opener-templates-meta.json", import.meta.url).pathname;
  const META = process.argv.includes("--meta");
  const log = (...a) => console.log(...a);

  // Static checks: never start or end with a variable, exactly {{1}} and {{2}} in order.
  for (const t of OPENER_TEMPLATES) {
    const vars = t.body.match(/\{\{\d+\}\}/g) ?? [];
    if (vars.join() !== "{{1}},{{2}}") throw new Error(`${t.name}: variables ${vars}`);
    if (/^\s*\{\{/.test(t.body) || /\}\}\s*[.،]?\s*$/.test(t.body)) throw new Error(`${t.name}: starts or ends with a variable`);
    if (t.example.length !== 2) throw new Error(`${t.name}: two examples needed`);
  }

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

  const before = await inventory();
  const byName = new Map(before.map((t) => [t.name, t]));
  const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s34-20260925-opener-templates.mjs", created: {} };
  report.inventoryAt = new Date().toISOString();
  report.inventoryCount = before.length;

  for (const t of OPENER_TEMPLATES) {
    const have = byName.get(t.name);
    log(`\n${t.name} (${t.category})\n  «${t.body}»\n  example ${JSON.stringify(t.example)} · QUICK_REPLY «${OPEN_BUTTON_TEXT}»`);
    if (have) {
      log(`  = exists at Meta: ${have.status}/${have.category}${have.previous_category ? ` (was ${have.previous_category})` : ""}${have.rejected_reason && have.rejected_reason !== "NONE" ? ` rejected: ${have.rejected_reason}` : ""} — not re-submitted`);
      continue;
    }
    if (!META) { log("  + would POST (dry-run)"); continue; }
    const payload = {
      name: t.name,
      language: "ar",
      category: "UTILITY",
      components: [
        { type: "BODY", text: t.body, example: { body_text: [t.example] } },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: OPEN_BUTTON_TEXT }] },
      ],
    };
    const r = await fetch(`https://graph.facebook.com/${V}/${WABA}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    report.created[t.name] = { at: new Date().toISOString(), http: r.status, response: j, payload };
    writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
    log(`  → POST ${r.status} ${JSON.stringify(j)}`);
  }

  const after = await inventory();
  report.status = Object.fromEntries(OPENER_TEMPLATES.map((t) => {
    const m = after.find((x) => x.name === t.name);
    return [t.name, m ? { id: m.id, status: m.status, category: m.category, previous_category: m.previous_category ?? null, rejected_reason: m.rejected_reason ?? null } : null];
  }));
  report.statusAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  log("\nstatus:", JSON.stringify(report.status, null, 2));
}
