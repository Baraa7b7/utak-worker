// STATUS § 36 — the live trial, Baraa's number (…4962) only. Every text starts
// with «🧪 تجربة § 36».
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s36-20260925-live-trial.mts state
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s36-20260925-live-trial.mts send
//
// `send`, through the real gateway (src/, PILOT_MODE, the deployed allowlist,
// the live KV and D1 — scripts/lib/cf-live-env.mjs), in this order:
//   1. a text inside his window (open since his message 15:35 UTC);
//   2. APPROVED / UTILITY utak_shift_start_v2 (owner_window) with a trial variable;
//   3. his window closed in KV (as a 131047 would), then a critical message
//      (owner_alert): held — its full text under «⏳ محفوظة» in his channel.
//      The DEPLOYED worker flushes it at his next message, and the same line
//      turns «✅ أُرسلت» (server action).
// `state`: his window and queue, his x_wa_message rows since the trial, and
// the lines of «واتساب · Bara.a - U TAK» (channel 29) since then.
// Out: scripts/artifacts/s36-20260925-live-trial-<mode>.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";

const mode = process.argv[2] ?? "state";
const env: any = await liveSimEnv();
const owner = String(env.OWNER_WHATSAPP);
const OWNER_PARTNER = 45, OWNER_CHANNEL = 29;
const { readWindow, markWindowClosed } = await import("../src/wa-window.ts");
const { readQueue } = await import("../src/wa-queue.ts");
const { call } = await import("../src/odoo.ts");
const SEND = new URL("./artifacts/s36-20260925-live-trial-send.json", import.meta.url);
const since = existsSync(SEND) ? JSON.parse(readFileSync(SEND, "utf8")).startedAt : new Date(Date.now() - 3600_000).toISOString();
const odooTs = (iso: string) => iso.replace("T", " ").slice(0, 19);
const plain = (html: string) => String(html || "").replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

async function state(from: string) {
  const rows = await call<any[]>(env, "x_wa_message", "search_read", {
    domain: [["x_partner_id", "=", OWNER_PARTNER], ["create_date", ">=", odooTs(from)]],
    fields: ["id", "x_direction", "x_kind", "x_status", "x_body", "x_meta_error", "x_meta_message_id", "x_template_id", "x_params", "x_debug_payload", "x_echo_status", "x_echo_message_id", "x_processed_at", "create_date"],
    order: "id asc", limit: 50,
  });
  const lines = await call<any[]>(env, "mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", OWNER_CHANNEL], ["create_date", ">=", odooTs(from)]],
    fields: ["id", "author_id", "date", "parent_id", "body"],
    order: "id asc", limit: 50,
  });
  return {
    at: new Date().toISOString(),
    window: await readWindow(env, owner),
    queue: (await readQueue(env, owner)).map((i: any) => ({ purpose: i.purpose, rowId: i.rowId, text: i.body?.text?.body })),
    rows,
    lines: lines.map((m) => ({ id: m.id, author: m.author_id?.[1], date: m.date, parent: m.parent_id || null, text: plain(m.body), html: m.body })),
  };
}

const out: any = { mode, owner: `…${owner.slice(-4)}` };
if (mode === "send") {
  out.startedAt = new Date(Date.now() - 5000).toISOString();
  out.before = { window: await readWindow(env, owner), queue: (await readQueue(env, owner)).length };
  const { sendOwnerMessage, sendTemplateByPurpose } = await import("../src/templates.ts");
  const { gatewayDecision } = await import("../src/wa-gateway.ts");
  // 1. a text inside his window
  const t1 = "🧪 تجربة § 36 (1 من 3): نص داخل النافذة. يجب أن يظهر في محادثة «واتساب · Bara.a - U TAK» بنصه، ومعه صف في سجل رسائل واتساب.";
  const r1 = await sendOwnerMessage(env, t1, "owner_alert");
  out.step1 = { decision: gatewayDecision(r1), status: r1?.status };
  // 2. an APPROVED / UTILITY template with a trial variable
  const r2 = await sendTemplateByPurpose(env, owner, "team_shift_start", ["🧪 تجربة § 36 (2 من 3)"], [{ index: 0, payload: "shift_start" }], undefined, { sendPurpose: "owner_window" });
  out.step2 = { decision: gatewayDecision(r2), status: r2.status };
  // 3. his window closed, then a critical message: held
  await markWindowClosed(env, owner, Date.now());
  const t3 = "🧪 تجربة § 36 (3 من 3): رسالة مهمة ونافذتك مقفلة، فحُفظت. تظهر في المحادثة بنصها وتحتها «⏳ محفوظة»، وحين تراسل رقم يو تاك تصلك هنا ويتحوّل السطر نفسه إلى «✅ أُرسلت».";
  const r3 = await sendOwnerMessage(env, t3, "owner_alert");
  out.step3 = { decision: gatewayDecision(r3), status: r3?.status };
  await new Promise((r) => setTimeout(r, 1500));
  out.after = await state(out.startedAt);
} else {
  out.state = await state(since);
}
writeFileSync(new URL(`./artifacts/s36-20260925-live-trial-${mode}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
const s = out.after ?? out.state;
console.log(JSON.stringify({ steps: [out.step1, out.step2, out.step3].filter(Boolean), window: s.window, queue: s.queue }, null, 1));
for (const r of s.rows) console.log(`row #${r.id} ${r.x_direction} ${r.x_kind} ${r.x_status} echo=${r.x_echo_status}#${r.x_echo_message_id || "-"} tpl=${r.x_template_id ? r.x_template_id[1] : "-"} — ${String(r.x_body).replace(/\n/g, " ⏎ ").slice(0, 120)}${r.x_meta_error ? ` [${String(r.x_meta_error).slice(0, 80)}]` : ""}`);
for (const l of s.lines) console.log(`line #${l.id} ${l.author} ${l.date}${l.parent ? ` ↳ reply to #${l.parent[0] ?? l.parent}` : ""}\n    ${l.text.replace(/\n/g, "\n    ")}`);
