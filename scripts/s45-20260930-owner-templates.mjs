// § 45 أ (2026-09-30): Baraa's two window templates at Meta — UTILITY, Arabic, each tied to one
// operations day and one quick reply.
//
//   node scripts/s45-20260930-owner-templates.mjs            (dry-run: the texts, and which names exist at Meta)
//   node scripts/s45-20260930-owner-templates.mjs --meta     (POST the names that do not exist yet — never a retry)
//   node scripts/s45-20260930-owner-templates.mjs --status   (GET: status / category of the two)
//
// Meta: the only write is POST /message_templates for a name Meta does not have (any status). No
// delete, no edit, and no second wording: a template Meta rejects or files as MARKETING is not
// re-submitted (§ 34 / § 45 rule) — the code keeps its present behaviour without it.
// Out: scripts/artifacts/s45-20260930-owner-templates-meta.json. No WhatsApp send.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Template 1: {{1}} the operations day, {{2}}–{{4}} the three variables of utak_v2_summary
// (src/owner-summary.ts summaryParams), in the same lines. Template 2: {{1}} the price day, {{2}} the
// number of exceptions. The quick replies' payloads are set at send time (src/owner-window.ts).
export const OWNER_TEMPLATES = [
  {
    name: "utak_owner_daily_summary_v1",
    purpose: "owner_summary",
    label: "ملخص عمليات اليوم (للمالك) بزر «تم الاطلاع»",
    body: "ملخص عمليات يو تاك ليوم {{1}}\n\nطلبات: {{2}}\nتوصيلات: {{3}}\nإجمالي: {{4}} ريال\n\nتفاصيل أكثر في لوحة القيادة.",
    example: ["30 سبتمبر 2026", "5 مؤكدة لـ 1 أكتوبر 2026 بإجمالي 1250.00 ريال", "4 مسلَّمة من 5", "المحصَّل اليوم 800.00 والمعلَّق 450.00 · تغطية التكاليف 34% بربح 170.00 من 496.53"],
    // Meta refuses an emoji in a button (400, subcode 2388060 «لا يمكن أن تحتوي الأزرار على … رموز
    // تعبيرية», 16:32 Riyadh): the order's «تم الاطلاع ✅» went in as «تم الاطلاع».
    button: "تم الاطلاع",
  },
  {
    name: "utak_owner_price_review_v1",
    purpose: "owner_price_review",
    label: "استثناءات أسعار اليوم (للمالك) بزر «عرض الاستثناءات»",
    body: "أسعار يو تاك ليوم {{1}}: {{2}} صنف بانتظار قرارك قبل 06:00.",
    example: ["1 أكتوبر 2026", "3"],
    button: "عرض الاستثناءات",
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = Object.fromEntries(
    readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const V = "v22.0", WABA = "2144001136512196";
  const TOKEN = env.META_ACCESS_TOKEN;
  const OUT = new URL("./artifacts/s45-20260930-owner-templates-meta.json", import.meta.url).pathname;
  const META = process.argv.includes("--meta");
  const log = (...a) => console.log(...a);

  // Static checks: never start or end with a variable, {{1}}..{{n}} in order, one example each.
  for (const t of OWNER_TEMPLATES) {
    const vars = t.body.match(/\{\{\d+\}\}/g) ?? [];
    if (vars.join() !== vars.map((_, i) => `{{${i + 1}}}`).join()) throw new Error(`${t.name}: variables ${vars}`);
    if (/^\s*\{\{/.test(t.body) || /\}\}\s*[.،]?\s*$/.test(t.body)) throw new Error(`${t.name}: starts or ends with a variable`);
    if (t.example.length !== vars.length) throw new Error(`${t.name}: ${vars.length} examples needed`);
    if ([...t.button].length > 25) throw new Error(`${t.name}: button text over 25`);
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
  const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s45-20260930-owner-templates.mjs", created: {}, checks: [] };
  report.checks ??= [];

  for (const t of OWNER_TEMPLATES) {
    const have = byName.get(t.name);
    log(`\n${t.name}\n  «${t.body.replace(/\n/g, " / ")}»\n  example ${JSON.stringify(t.example)} · QUICK_REPLY «${t.button}»`);
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
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: t.button }] },
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
  const status = Object.fromEntries(OWNER_TEMPLATES.map((t) => {
    const m = after.find((x) => x.name === t.name);
    return [t.name, m ? { id: m.id, status: m.status, category: m.category, previous_category: m.previous_category ?? null, rejected_reason: m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : null } : null];
  }));
  const riyadh = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  report.status = status;
  report.statusAtRiyadh = riyadh;
  report.checks.push({ atRiyadh: riyadh, status });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  log(`\nstatus (${riyadh} Riyadh):`, JSON.stringify(status, null, 2));
}
