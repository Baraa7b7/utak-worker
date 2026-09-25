// Classify the partners WhatsApp already created (2026-09-25, STATUS § 30).
//
// Reads every active partner with a number, its WhatsApp conversation
// (x_wa_message inbound + the older x_message_analysis), the orders on each
// number, and the team roles; planBackfill (scripts/lib/review-backfill-core.mjs)
// keeps only the partners created from WhatsApp that are not known. Each of
// them gets the decision below, read from its conversation (the intents of
// src/screening.ts). Writes ONLY the new fields (x_contact_class = unreviewed,
// x_ai_intent, x_ai_reason, x_review_pending, x_review_last_msg / _at):
// customer_rank / supplier_rank are never changed, nobody is archived. Every
// partner that enters review gets its one message in «📋 مراجعة الأرقام» (as
// UTAK بوت, like the worker). No WhatsApp: the owner alert is the worker's,
// for numbers that enter review from now on.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/rev-20260925-backfill.mts            # dry run: the table
//   … --apply
//   … --verify
//   … --rollback [--apply]
//
// Rollback: scripts/artifacts/rev-20260925-backfill-rollback.json (the fields
// before, per partner, written before the first write; the posted message ids).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-ignore — plain .mjs helpers
import { call } from "./lib/odoo-cli.mjs";
// @ts-ignore
import { planBackfill, digits } from "./lib/review-backfill-core.mjs";
import { INTENT_LABEL, REVIEW_ACTION_NAME, REVIEW_CHANNEL_NAME, reviewMessageHtml, reviewRecordUrl } from "../src/screening.ts";

globalThis.fetch = ((real) => (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") || url.includes("anthropic.com")) throw new Error("BLOCKED: no WhatsApp / Claude from this script");
  return real(input, init);
})(globalThis.fetch);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const VERIFY = args.includes("--verify");
const RB = new URL("./artifacts/rev-20260925-backfill-rollback.json", import.meta.url).pathname;
const MD = new URL("./artifacts/rev-20260925-backfill-dryrun.md", import.meta.url).pathname;
const OWNER = "+966505154962";
const ODOO_URL = "https://utakfresh.odoo.com";
const FIELDS = ["x_contact_class", "x_ai_intent", "x_ai_reason", "x_review_pending", "x_review_last_msg", "x_review_last_at"];

// Decisions read from each conversation (2026-09-25). Intents as in src/screening.ts.
const DECISIONS: Record<number, { intent: string; reason: string }> = {
  19: { intent: "personal", reason: "مندوب سمسا يبلغ عن توصيل شحنة لنا، لا طلب شراء" },
  49: { intent: "personal", reason: "روابط اجتماعات ومواعيد وإجازات ومقاطع، بلا أي طلب" },
  50: { intent: "purchase", reason: "ضغط «أبغى أطلب» بعد التحية" },
  54: { intent: "vendor_pitch", reason: "فني شبكات يعرض علينا عرض إنترنت جديد" },
  59: { intent: "unclear", reason: "رسالة واحدة فيها حرف «ا» فقط" },
};

const MEDIA_MARK = /^\[(audio|image|video|document|sticker|location|voice)[:\]\s]/i;

async function load() {
  const partners = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "!=", false], ["phone", "!=", false]],
    fields: ["id", "name", "active", "phone", "x_whatsapp_number", "customer_rank", "supplier_rank", ...FIELDS],
    context: { active_test: false }, order: "id asc",
  });
  // STATUS § 31 — the team is hr.employee: its Work Contacts are known partners.
  const team = await call("hr.employee", "search_read", { domain: [["x_utak_role_ids", "!=", false]], fields: ["work_contact_id"] });
  const teamPartnerIds = new Set<number>(team.map((e: any) => e.work_contact_id?.[0]).filter(Boolean));
  const numOf = new Map(partners.map((p: any) => [p.id, digits(p.x_whatsapp_number || p.phone)]));
  const orderNumbers = new Set<string>();
  for (const o of await call("x_daily_order", "search_read", { domain: [], fields: ["x_customer_id"], context: { active_test: false }, limit: 5000 })) {
    const n = o.x_customer_id ? numOf.get(o.x_customer_id[0]) : ""; if (n) orderNumbers.add(n);
  }
  for (const o of await call("sale.order", "search_read", { domain: [], fields: ["partner_id"], limit: 5000 })) {
    const n = o.partner_id ? numOf.get(o.partner_id[0]) : ""; if (n) orderNumbers.add(n);
  }
  const history = new Map<number, Array<{ body: string; at: string }>>();
  const push = (pid: number, body: string, at: string) => {
    const b = String(body ?? "").trim();
    if (!pid || !b || MEDIA_MARK.test(b)) return;
    const list = history.get(pid) ?? [];
    if (!list.some((m) => m.body === b)) list.push({ body: b, at });
    history.set(pid, list);
  };
  for (const m of await call("x_wa_message", "search_read", { domain: [["x_direction", "=", "in"]], fields: ["x_partner_id", "x_body", "create_date"], order: "id asc", limit: 5000 })) {
    push(m.x_partner_id?.[0], m.x_body, m.create_date);
  }
  for (const m of await call("x_message_analysis", "search_read", { domain: [], fields: ["x_customer_id", "x_message_text", "x_created_at", "create_date"], order: "id asc", limit: 5000 })) {
    push(m.x_customer_id?.[0], m.x_message_text, m.x_created_at || m.create_date);
  }
  for (const [pid, list] of history) history.set(pid, list.sort((a, b) => String(a.at).localeCompare(String(b.at))));
  return { partners, teamPartnerIds, orderNumbers, history };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  for (const [pid, vals] of Object.entries(rb.before as Record<string, Record<string, unknown>>)) {
    console.log(`${APPLY ? "" : "would "}restore partner ${pid}: ${JSON.stringify(vals)}`);
    if (APPLY) await call("res.partner", "write", { ids: [Number(pid)], vals, context: { active_test: false } });
  }
  const msgs = (rb.posted ?? []).map((p: any) => p.messageId).filter(Boolean);
  if (msgs.length) {
    console.log(`${APPLY ? "" : "would "}delete channel messages ${msgs.join(",")}`);
    if (APPLY) {
      try { await call("mail.message", "unlink", { ids: msgs }); }
      catch (e) { console.log(`  channel messages not deleted (${(e as Error).message.slice(0, 120)}); scripts/rev-20260925-odoo-setup.mjs --rollback deletes the channel with them`); }
    }
  }
  console.log(APPLY ? "rollback done" : "dry run: nothing changed (add --apply)");
  process.exit(0);
}

const data = await load();
const plan = planBackfill({ ...data, ownerNumber: OWNER, decisions: DECISIONS });
const todo = plan.filter((r: any) => r.vals);

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const ids = Object.keys(rb.planned).map(Number);
  const now = await call("res.partner", "read", { ids, fields: ["id", "customer_rank", "supplier_rank", "active", ...FIELDS], context: { active_test: false } });
  let ok = true;
  for (const p of now) {
    const want = rb.planned[p.id];
    const same = FIELDS.every((f) => JSON.stringify(p[f]) === JSON.stringify(want[f]));
    const ranks = p.customer_rank === rb.ranks[p.id].customer_rank && p.supplier_rank === rb.ranks[p.id].supplier_rank && p.active === true;
    console.log(`${same && ranks ? "✓" : "✗"} ${p.id}: ${p.x_ai_intent} pending=${p.x_review_pending} ranks ${p.customer_rank}/${p.supplier_rank} active=${p.active}`);
    if (!same || !ranks) ok = false;
  }
  // after the apply the planned partners read as «مصنّف مسبقاً»: they are checked above
  const untouched = plan.filter((r: any) => r.skip && !(r.id in rb.planned)).map((r: any) => r.id);
  const others = await call("res.partner", "read", { ids: untouched, fields: ["id", "x_contact_class", "x_ai_intent"], context: { active_test: false } });
  const touched = others.filter((p: any) => p.x_ai_intent || (p.x_contact_class && p.id !== 15));
  console.log(`${touched.length ? "✗" : "✓"} known / skipped partners untouched (${untouched.length}; عثمان 15 = فريق من سكربت الإعداد)`);
  const n = await call("res.partner", "search_count", { domain: [["x_review_pending", "=", true]] });
  const menu = await call("ir.ui.menu", "search_read", { domain: [["name", "ilike", "مراجعة الأرقام"]], fields: ["name"] });
  console.log(`${menu[0]?.name?.endsWith(`(${n})`) ? "✓" : "✗"} menu «${menu[0]?.name}» / pending ${n}`);
  process.exit(ok && !touched.length ? 0 : 1);
}

// ---------------------------------------------------------------- the table (dry run)
const lines = [
  "| # | الاسم | الرقم | النية | السبب | ينتظر المراجعة؟ |",
  "|---|---|---|---|---|---|",
  ...todo.map((r: any) => `| ${r.id} | ${r.name} | ${r.number} | ${INTENT_LABEL[r.intent as keyof typeof INTENT_LABEL]} | ${r.reason} | ${r.pending ? "نعم" : "لا"} |`),
  "",
  "**لا يُلمس:**",
  "",
  "| # | الاسم | الرقم | السبب |",
  "|---|---|---|---|",
  ...plan.filter((r: any) => r.skip).map((r: any) => `| ${r.id} | ${r.name} | ${r.number} | ${r.skip} |`),
];
console.log(lines.join("\n"));
if (!APPLY) {
  writeFileSync(MD, `# rev-20260925 backfill — dry run (${new Date().toISOString()})\n\n${lines.join("\n")}\n`);
  console.log(`\ndry run: nothing written (add --apply). Table: ${MD}`);
  process.exit(0);
}

// ---------------------------------------------------------------- apply
if (existsSync(RB)) throw new Error(`${RB} exists — the backfill already ran (use --verify / --rollback)`);
const ids = todo.map((r: any) => r.id);
const before = await call("res.partner", "read", { ids, fields: ["id", "customer_rank", "supplier_rank", ...FIELDS], context: { active_test: false } });
const rb: any = {
  at: new Date().toISOString(),
  before: Object.fromEntries(before.map((p: any) => [p.id, Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? false]))])),
  ranks: Object.fromEntries(before.map((p: any) => [p.id, { customer_rank: p.customer_rank, supplier_rank: p.supplier_rank }])),
  planned: Object.fromEntries(todo.map((r: any) => [r.id, r.vals])),
  posted: [],
};
if (before.some((p: any) => FIELDS.some((f) => p[f] && p[f] !== false))) throw new Error("a planned partner already has a review field set — refusing");
const save = () => writeFileSync(RB, JSON.stringify(rb, null, 2));
save(); // the snapshot is on disk before the first write

for (const r of todo) {
  await call("res.partner", "write", { ids: [r.id], vals: r.vals });
  console.log(`✓ ${r.id} ${r.name}: ${r.intent}${r.pending ? " → ينتظر المراجعة" : ""}`);
}

const [channel] = await call("discuss.channel", "search_read", { domain: [["name", "=", REVIEW_CHANNEL_NAME], ["channel_type", "=", "channel"]], fields: ["id"], limit: 1 });
const [action] = await call("ir.actions.act_window", "search_read", { domain: [["name", "=", REVIEW_ACTION_NAME]], fields: ["id"], limit: 1 });
const [bot] = await call("res.partner", "search_read", { domain: [["name", "=", "UTAK بوت"]], fields: ["id"], limit: 1 });
if (!channel || !bot) throw new Error("review channel or UTAK بوت not found");
for (const r of todo.filter((x: any) => x.pending)) {
  const p = data.partners.find((x: any) => x.id === r.id);
  const body = reviewMessageHtml({
    name: r.name, number: "+" + digits(p.x_whatsapp_number || p.phone), intent: r.intent, reason: r.reason, first: r.first,
    url: reviewRecordUrl({ ODOO_URL } as any, r.id, action?.id ?? 0),
  });
  const messageId = await call("discuss.channel", "message_post", {
    ids: [channel.id], body, body_is_html: true, message_type: "comment", author_id: bot.id, subtype_xmlid: "mail.mt_comment",
  });
  rb.posted.push({ partnerId: r.id, messageId: Array.isArray(messageId) ? messageId[0] : messageId });
  save();
  console.log(`  channel ${channel.id} ← message ${JSON.stringify(messageId)} about ${r.id}`);
}
console.log(`done: ${todo.length} classified, ${rb.posted.length} in review.`);
