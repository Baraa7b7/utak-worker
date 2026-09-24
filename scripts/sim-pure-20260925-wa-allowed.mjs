// sim محاكاة خالصة (2026-09-25، STATUS § 27): الأرقام المسموحة على sim = براء والفريق فقط.
//
// fetchMeta (src/meta.ts) يسمح للرقم إن طابق SIM_ALLOWLIST أو إن كان لشريك نشط
// عليه res.partner.x_wa_allowed = true (src/odoo.ts::isPartnerWaAllowed). الخانة
// كانت على 39 شريكاً، منهم عملاء حقيقيون، فكانت هي التوسيع الفعلي للقائمة.
// هذا السكربت يطفئ الخانة على كل شريك رقمه ليس رقم براء أو أحد الفريق، ويتركها
// على رقم الفريق. لا يكتب إلا res.partner.x_wa_allowed، ولا يمس Meta ولا قيداً.
//
//   node scripts/sim-pure-20260925-wa-allowed.mjs                      (dry-run)
//   node scripts/sim-pure-20260925-wa-allowed.mjs --apply
//   node scripts/sim-pure-20260925-wa-allowed.mjs --rollback           (dry-run)
//   node scripts/sim-pure-20260925-wa-allowed.mjs --rollback --apply
//
// اللقطة قبل أي كتابة: scripts/artifacts/sim-pure-20260925-wa-allowed-rollback.json
// (المعرّف والاسم والقيمة السابقة، والرقم مقنّعاً إلا آخر 4). التراجع يعيد
// x_wa_allowed = true على المعرّفات المسجلة فيها فقط.
//
// أثر الخانة على prod: لا شيء اليوم. prod بلا SIM_ALLOWLIST فيسمح fetchMeta لكل
// رقم دون قراءتها. لكن رد صندوق Odoo (src/wa-inbox.ts) يرفض الشريك الذي خانته
// false في أي بيئة، فعند نقل أتمتة الصندوق إلى prod تُعاد الخانة للعملاء من اللقطة.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const RB = new URL("./artifacts/sim-pure-20260925-wa-allowed-rollback.json", import.meta.url);

// الفريق (قرار براء المقفل 2026-09-25): براء، أحمد حسان، عثمان عبدالوهاب، عمر المجهلي.
// الأرقام من شركائهم في Odoo (45 و30 و15 و9).
export const TEAM = {
  "966505154962": "براء",
  "966571777704": "أحمد حسان",
  "966530399474": "عثمان عبدالوهاب",
  "966545816832": "عمر المجهلي",
};
// شريك براء بلا رقم (مستخدم Odoo): لا أثر للخانة عليه، ويبقى كما هو.
const KEEP_WITHOUT_NUMBER = { 3: "براء (مستخدم Odoo، بلا رقم)" };

const digits = (v) => String(v || "").replace(/\D/g, "");
const mask = (v) => { const d = digits(v); return d ? `+${d.slice(0, 3)}…${d.slice(-4)}` : "—"; };
const log = (s) => console.log(`${APPLY ? "" : "(dry-run) "}${s}`);

function classify(p) {
  const nums = [...new Set([digits(p.x_whatsapp_number), digits(p.phone)].filter(Boolean))];
  const team = nums.map((n) => TEAM[n]).find(Boolean);
  if (team) return { keep: true, who: `فريق: ${team}`, nums };
  if (KEEP_WITHOUT_NUMBER[p.id]) return { keep: true, who: KEEP_WITHOUT_NUMBER[p.id], nums };
  return { keep: false, who: nums.length ? "غير الفريق" : "بلا رقم", nums };
}

async function allowedNow() {
  return call("res.partner", "search_read", {
    domain: [["x_wa_allowed", "=", true], ["active", "in", [true, false]]],
    fields: ["id", "name", "active", "phone", "x_whatsapp_number", "x_wa_allowed"],
    order: "id",
  });
}

function table(rows) {
  console.log("| الشريك | الاسم | نشط | الرقم | التصنيف | القرار |");
  console.log("|---|---|---|---|---|---|");
  for (const p of rows) {
    const c = classify(p);
    console.log(`| ${p.id} | ${p.name} | ${p.active ? "نعم" : "مؤرشف"} | ${c.nums.map(mask).join("، ") || "—"} | ${c.who} | ${c.keep ? "تبقى" : "تُطفأ"} |`);
  }
}

async function rollback() {
  if (!existsSync(RB)) throw new Error("no rollback file — this script never applied");
  const snap = JSON.parse(readFileSync(RB, "utf8"));
  const ids = snap.turned_off.map((r) => r.id);
  log(`rollback: x_wa_allowed = true على ${ids.length} شريكاً: ${ids.join(", ")}`);
  if (!APPLY) return;
  await call("res.partner", "write", { ids, vals: { x_wa_allowed: true } });
  const back = await call("res.partner", "search_read", {
    domain: [["id", "in", ids], ["active", "in", [true, false]]], fields: ["id", "x_wa_allowed"],
  });
  const bad = back.filter((r) => !r.x_wa_allowed).map((r) => r.id);
  console.log(`verify: ${back.length - bad.length}/${ids.length} عادت true ${bad.length ? `❌ ${bad.join(",")}` : "✅"}`);
}

async function apply() {
  const rows = await allowedNow();
  const off = rows.filter((p) => !classify(p).keep);
  const kept = rows.filter((p) => classify(p).keep);
  console.log(`x_wa_allowed = true الآن: ${rows.length}`);
  table(rows);
  log(`\nتُطفأ على ${off.length}: ${off.map((p) => p.id).join(", ") || "—"}`);
  log(`تبقى على ${kept.length}: ${kept.map((p) => p.id).join(", ")}`);
  if (off.length === 0) { console.log("لا شيء للكتابة — idempotent ✅"); return; }
  if (!APPLY) return;

  if (existsSync(RB)) {
    // A second apply after a partial first one: keep the first snapshot, add the new ids.
    const prev = JSON.parse(readFileSync(RB, "utf8"));
    const known = new Set(prev.turned_off.map((r) => r.id));
    for (const p of off) if (!known.has(p.id)) prev.turned_off.push(snapRow(p));
    writeFileSync(RB, JSON.stringify(prev, null, 2) + "\n");
  } else {
    writeFileSync(RB, JSON.stringify({
      at: new Date().toISOString(),
      field: "res.partner.x_wa_allowed",
      before_true_count: rows.length,
      kept: kept.map(snapRow),
      turned_off: off.map(snapRow),
    }, null, 2) + "\n");
  }
  console.log(`snapshot → ${RB.pathname}`);

  await call("res.partner", "write", { ids: off.map((p) => p.id), vals: { x_wa_allowed: false } });
  const after = await allowedNow();
  const stray = after.filter((p) => !classify(p).keep);
  console.log(`verify: x_wa_allowed = true بعد الكتابة ${after.length} (${after.map((p) => p.id).join(", ")}) ${stray.length ? `❌ خارج الفريق: ${stray.map((p) => p.id).join(",")}` : "✅ كلها للفريق"}`);
}

function snapRow(p) {
  const c = classify(p);
  return { id: p.id, name: p.name, active: p.active, numbers_masked: c.nums.map(mask), class: c.who, x_wa_allowed_before: p.x_wa_allowed };
}

if (ROLLBACK) await rollback(); else await apply();
