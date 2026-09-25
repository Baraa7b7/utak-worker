// STATUS § 34 — the live trial, Baraa's number (…4962) only.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s34-20260925-live-trial.mts state
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s34-20260925-live-trial.mts send
//
// `send`: closes Baraa's 24h window in the sim KV (as a 131047 would), then
// sends ONE critical message through the real gateway (src/, PILOT_MODE, the
// deployed allowlist) — outside the window it is held in the live queue, and
// utak_update_owner goes if Meta has it APPROVED and UTILITY. The deployed
// sim worker flushes the queue on his next tap or message.
// `state`: his window, queue and today's opener mark, and his x_wa_message
// rows of the last hours. Out: scripts/artifacts/s34-20260925-live-trial-<mode>.json
import { writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";

const mode = process.argv[2] ?? "state";
const env: any = await liveSimEnv();
const owner = String(env.OWNER_WHATSAPP);
const { readWindow, markWindowClosed } = await import("../src/wa-window.ts");
const { readQueue } = await import("../src/wa-queue.ts");
const { openerDayKey, openerCoolKey } = await import("../src/wa-opener.ts");
const { call } = await import("../src/odoo.ts");

async function state() {
  const since = new Date(Date.now() - 6 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const rowsOut = await call<any[]>(env, "x_wa_message", "search_read", {
    domain: [["x_partner_id", "=", false], ["x_direction", "=", "out"], ["create_date", ">=", since]],
    fields: ["id", "x_status", "x_body", "x_meta_error", "x_meta_message_id", "create_date", "write_date"],
    order: "id desc", limit: 20,
  });
  return {
    at: new Date().toISOString(),
    window: await readWindow(env, owner),
    queue: (await readQueue(env, owner)).map((i: any) => ({ id: i.id, purpose: i.purpose, rowId: i.rowId, created: new Date(i.createdAt).toISOString(), expires: new Date(i.expiresAt).toISOString(), text: i.body?.text?.body ?? i.body?.type })),
    openerToday: await env.MSG_DEDUP.get(openerDayKey(owner)),
    openerCool: await env.MSG_DEDUP.get(openerCoolKey(owner)),
    rows: rowsOut,
  };
}

const out: any = { mode, owner: `…${owner.slice(-4)}` };
if (mode === "send") {
  out.before = await state();
  await markWindowClosed(env, owner, Date.now());
  const { sendOwnerMessage } = await import("../src/templates.ts");
  const { gatewayDecision } = await import("../src/wa-gateway.ts");
  const text = "🧪 تجربة § 34 (فتح المحادثة): رسالة مهمة أُرسلت ونافذتك مقفلة، فحُفظت ولم تُرسل. وصلتك الآن لأنك راسلت رقم يو تاك أو ضغطت «عرض التحديث».";
  const resp = await sendOwnerMessage(env, text, "owner_alert");
  out.decision = gatewayDecision(resp);
  out.status = resp?.status;
  try { out.body = resp ? await resp.clone().json() : null; } catch { out.body = null; }
  out.after = await state();
} else {
  out.state = await state();
}
writeFileSync(new URL(`./artifacts/s34-20260925-live-trial-${mode}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
