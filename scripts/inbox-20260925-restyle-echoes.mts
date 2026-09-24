// Bot echoes already in the WhatsApp inbox, dark mode (2026-09-25, STATUS § 28).
//
// Every «🤖 آلي» echo the worker posted 09-20 → 09-24 carries a cream box
// (background-color:#F7F5F0) with no text colour, so in Odoo's dark theme its
// text is #E4E4E4 on cream — unreadable. This rewrites the style attribute of
// that box to AUTO_STYLE (src/wa-inbox.ts, no colour at all) through
// restyleAutoEcho, the same function the tests pin. Not a word of any text
// changes: the script refuses a pair whose text differs.
//
// Why a one-shot server action: Odoo saas~19.4 gives no ORM write on channel
// messages to anyone but their author (discuss_channel.py
// _mail_get_operation_for_mail_message_operation: write → []), admin or not —
// mail.message.write answers 403. A code action run once by the admin API
// user writes with sudo(), compare-and-swap per message (old body must still
// be exactly what we read), and is deleted right after.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-restyle-echoes.mts            # dry run (default)
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-restyle-echoes.mts --apply
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-restyle-echoes.mts --rollback [--apply]
//
// Out:      scripts/artifacts/inbox-20260925-restyle-echoes.{json,md}
// Rollback: scripts/artifacts/inbox-20260925-restyle-echoes-rollback.json (written before any write, kept from the first run)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-ignore — plain JS helper
import { call } from "./lib/odoo-cli.mjs";
import { AUTO_STYLE, hasFixedColor, restyleAutoEcho } from "../src/wa-inbox.ts";

const root = new URL("../", import.meta.url);
const ODOO_URL = readFileSync(new URL(".env.sim-verify", root), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
const WRITES = new Set(["ir.actions.server.create", "ir.actions.server.run", "ir.actions.server.unlink"]);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !["search_read", "read", "search", "search_count"].includes(m[2]) && !WRITES.has(`${m[1]}.${m[2]}`)) {
    throw new Error(`BLOCKED: ${m[1]}.${m[2]}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const art = (f: string) => new URL(`scripts/artifacts/${f}`, root).pathname;
const RB = art("inbox-20260925-restyle-echoes-rollback.json");
const OUT = art(`inbox-20260925-restyle-echoes${ROLLBACK ? "-rollback-run" : ""}`);
const textOf = (h: string) => String(h ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "");
const noStyle = (h: string) => String(h ?? "").replace(/ style="[^"]*"/g, "");

type Msg = { id: number; res_id: number; date: string; author_id: [number, string] | false; body: string };
type Pair = { id: number; channel: number; date: string; before: string; after: string };

// ---------------------------------------------------------------- the action
// Static code; the pairs travel in the call's context. Compare-and-swap: a
// message whose body is no longer exactly `old` is reported, never written.
const ACTION_CODE = `
pairs = env.context.get('utak_pairs') or []
do_write = bool(env.context.get('utak_apply'))
Msg = env['mail.message'].sudo()
match = []
mismatch = []
written = []
for pair in pairs:
    mid = pair[0]
    m = Msg.browse(mid).exists()
    if not m or m.model != 'discuss.channel' or str(m.body or '') != pair[1]:
        mismatch.append(mid)
        continue
    match.append(mid)
    if do_write:
        m.write({'body': pair[2]})
        written.append(mid)
action = {'type': 'ir.actions.act_window_close', 'infos': {'match': match, 'mismatch': mismatch, 'written': written}}
`;

async function runAction(triples: Array<[number, string, string]>, write: boolean) {
  const [modelId] = await call("ir.model", "search", { domain: [["model", "=", "mail.message"]], limit: 1 });
  const [actionId] = await call("ir.actions.server", "create", {
    vals_list: [{ name: "UTAK one-shot · restyle WhatsApp bot echoes (2026-09-25, § 28)", model_id: modelId, state: "code", code: ACTION_CODE }],
  });
  console.log(`server action ${actionId} created`);
  try {
    const check = await call("ir.actions.server", "run", { ids: [actionId], context: { utak_pairs: triples, utak_apply: false } });
    const c = check?.infos ?? {};
    console.log(`check: ${c.match?.length ?? "?"} match, ${c.mismatch?.length ?? "?"} mismatch`);
    if (!c.match || c.match.length !== triples.length) throw new Error(`check failed — mismatch ${JSON.stringify(c.mismatch)}; nothing written`);
    if (!write) return { check: c, written: [] as number[] };
    const res = await call("ir.actions.server", "run", { ids: [actionId], context: { utak_pairs: triples, utak_apply: true } });
    console.log(`apply: ${res?.infos?.written?.length ?? "?"} written, ${res?.infos?.mismatch?.length ?? "?"} mismatch`);
    return { check: c, written: (res?.infos?.written ?? []) as number[], mismatch: res?.infos?.mismatch ?? [] };
  } finally {
    await call("ir.actions.server", "unlink", { ids: [actionId] });
    const left = await call("ir.actions.server", "search_count", { domain: [["id", "=", actionId]] });
    console.log(`server action ${actionId} deleted (${left} left)`);
  }
}

async function readBodies(ids: number[]) {
  const rows: Array<{ id: number; body: string }> = await call("mail.message", "read", { ids, fields: ["id", "body"] });
  return new Map(rows.map((r) => [r.id, r.body]));
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8")) as { pairs: Pair[] };
  const now = await readBodies(rb.pairs.map((p) => p.id));
  const todo = rb.pairs.filter((p) => now.get(p.id) === p.after);
  console.log(`rollback: ${rb.pairs.length} in the file, ${todo.length} still restyled, ${rb.pairs.length - todo.length} already back or changed since`);
  if (!APPLY) { console.log("dry run: nothing written (add --apply)"); process.exit(0); }
  const r = await runAction(todo.map((p) => [p.id, p.after, p.before]), true);
  const after = await readBodies(todo.map((p) => p.id));
  const back = todo.filter((p) => after.get(p.id) === p.before).length;
  writeFileSync(`${OUT}.json`, JSON.stringify({ at: new Date().toISOString(), restored: back, of: todo.length, ...r }, null, 2) + "\n");
  console.log(`rollback done: ${back}/${todo.length} bodies are the original again`);
  process.exit(back === todo.length ? 0 : 1);
}

// ---------------------------------------------------------------- plan
const [bot] = await call("res.partner", "search_read", { domain: [["name", "=", "UTAK بوت"]], fields: ["id"], limit: 1 });
const channels: Array<{ id: number }> = await call("discuss.channel", "search_read", {
  domain: [["x_wa_partner_id", "!=", false]], fields: ["id"], context: { active_test: false }, limit: 2000,
});
const msgs: Msg[] = await call("mail.message", "search_read", {
  domain: [["model", "=", "discuss.channel"], ["res_id", "in", channels.map((c) => c.id)]],
  fields: ["id", "res_id", "date", "author_id", "body"], order: "id asc", limit: 10000,
});
const styled = msgs.filter((m) => hasFixedColor(m.body));
const pairs: Pair[] = [];
const refused: Array<{ id: number; why: string }> = [];
for (const m of styled) {
  const after = restyleAutoEcho(m.body);
  if (!after) { refused.push({ id: m.id, why: "coloured, but not a «🤖 آلي» echo — left alone" }); continue; }
  if (!m.author_id || m.author_id[0] !== bot.id) { refused.push({ id: m.id, why: `author ${m.author_id && m.author_id[1]} is not UTAK بوت` }); continue; }
  if (textOf(after) !== textOf(m.body) || noStyle(after) !== noStyle(m.body)) { refused.push({ id: m.id, why: "text would change" }); continue; }
  if (hasFixedColor(after)) { refused.push({ id: m.id, why: "still coloured after" }); continue; }
  pairs.push({ id: m.id, channel: m.res_id, date: m.date, before: m.body, after });
}
console.log(`WhatsApp channels ${channels.length}, messages ${msgs.length}, with a fixed colour ${styled.length} → to restyle ${pairs.length}, refused ${refused.length}`);
for (const r of refused) console.log(`  refused #${r.id}: ${r.why}`);
for (const p of pairs.slice(0, 2)) console.log(`\n#${p.id} (channel ${p.channel})\n  before: ${p.before.slice(0, 140)}…\n  after:  ${p.after.slice(0, 140)}…`);

const report: Record<string, unknown> = {
  at: new Date().toISOString(), mode: APPLY ? "apply" : "dry-run", autoStyle: AUTO_STYLE,
  channels: channels.length, messages: msgs.length, withFixedColour: styled.length, toRestyle: pairs.length, refused,
  ids: pairs.map((p) => p.id),
};

if (APPLY && pairs.length) {
  if (!existsSync(RB)) {
    writeFileSync(RB, JSON.stringify({ script: "scripts/inbox-20260925-restyle-echoes.mts", createdAt: new Date().toISOString(), autoStyle: AUTO_STYLE, pairs }, null, 2) + "\n");
    console.log(`\nsnapshot → ${RB}`);
  } else {
    console.log(`\nsnapshot kept from the first run → ${RB}`);
  }
  const r = await runAction(pairs.map((p) => [p.id, p.before, p.after]), true);
  // verify: every body is exactly the planned one, text unchanged, no colour
  const now = await readBodies(pairs.map((p) => p.id));
  const ok = pairs.filter((p) => now.get(p.id) === p.after && textOf(now.get(p.id)!) === textOf(p.before) && !hasFixedColor(now.get(p.id)!));
  const differ = pairs.filter((p) => now.get(p.id) !== p.after).map((p) => ({ id: p.id, stored: now.get(p.id) }));
  Object.assign(report, { written: r.written.length, verified: ok.length, differ });
  console.log(`\nverify: ${ok.length}/${pairs.length} stored exactly as planned, text unchanged, no fixed colour${differ.length ? ` — ${differ.length} differ` : ""}`);
} else if (!APPLY) {
  console.log("\ndry run: nothing written (add --apply)");
}

writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2) + "\n");
const md = [
  `# Restyle WhatsApp bot echoes — ${report.mode} (${report.at})`, "",
  `- WhatsApp channels: ${channels.length}, messages: ${msgs.length}`,
  `- with a fixed colour: ${styled.length} (all «🤖 آلي» echoes by UTAK بوت: ${pairs.length === styled.length ? "yes" : "no"})`,
  `- restyled to \`${AUTO_STYLE}\`: ${APPLY ? `${report.verified ?? 0} verified` : `${pairs.length} planned`}`,
  refused.length ? `- refused: ${refused.map((r) => `#${r.id} (${r.why})`).join(", ")}` : "- refused: none",
  "", "| # | channel | date (UTC) | text (first 60) |", "|---|---|---|---|",
  ...pairs.map((p) => `| ${p.id} | ${p.channel} | ${p.date} | ${textOf(p.before).replace(/\n/g, " ").replace(/\|/g, "\\|").slice(0, 60)} |`),
  "", "Sample (first):", "", "```html", `before: ${pairs[0]?.before ?? ""}`, `after:  ${pairs[0]?.after ?? ""}`, "```", "",
];
writeFileSync(`${OUT}.md`, md.join("\n"));
console.log(`→ ${OUT}.json / .md`);
