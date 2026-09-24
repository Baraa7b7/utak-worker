// Empty media in the WhatsApp inbox (2026-09-25, STATUS § 28).
//
// Until today attachMetaMedia sent the bytes as `datas`, which Odoo saas~19.4
// drops (ir_attachment.py _check_contents: "Use raw, datas has been removed"),
// so every inbound media was stored empty (file_size 0) — the three voice
// notes 248/252/253 — and Odoo's voice player crashed on them. This fills each
// empty attachment in a WhatsApp channel with the same bytes, downloaded
// again from Meta by its media id (GET only), checked against Meta's size and
// sha256, and written the way the fixed worker writes them (`raw`, base64).
// The attachment keeps its id, name, mimetype, message and voice metadata.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-voice-backfill.mts            # dry run (default)
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-voice-backfill.mts --apply
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-voice-backfill.mts --rollback [--apply]
//
// Out:      scripts/artifacts/inbox-20260925-voice-backfill.{json,md} (the clips themselves only in a temp dir: customers' voices stay out of git)
// Rollback: scripts/artifacts/inbox-20260925-voice-backfill-rollback.json (written before any write, kept from the first run)

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore — plain JS helper
import { call } from "./lib/odoo-cli.mjs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const GV = /META_GRAPH_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("wrangler.toml", root), "utf8"))?.[1] ?? "v22.0";

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (url.startsWith("https://graph.facebook.com/") || url.startsWith("https://lookaside.fbsbx.com/")) {
    if (method !== "GET") throw new Error(`BLOCKED: ${method} ${url} — Meta is read-only here`);
    return realFetch(input, init);
  }
  if (!url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !["search_read", "read", "search", "search_count"].includes(m[2]) && `${m[1]}.${m[2]}` !== "ir.attachment.write") {
    throw new Error(`BLOCKED: ${m[1]}.${m[2]}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const art = (f: string) => new URL(`scripts/artifacts/${f}`, root).pathname;
const RB = art("inbox-20260925-voice-backfill-rollback.json");
const OUT = art(`inbox-20260925-voice-backfill${ROLLBACK ? "-rollback-run" : ""}`);
const sha = (alg: string, b: Uint8Array) => createHash(alg).update(b).digest("hex");

type Att = { id: number; name: string; mimetype: string; file_size: number; checksum: string | false; res_id: number; voice_ids: number[]; create_date: string };

if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8")) as { before: Att[] };
  for (const b of rb.before) {
    console.log(`attachment ${b.id} (${b.name}) → empty again, mimetype ${b.mimetype}`);
    if (APPLY) await call("ir.attachment", "write", { ids: [b.id], vals: { raw: false, mimetype: b.mimetype } });
  }
  const now: Att[] = await call("ir.attachment", "read", { ids: rb.before.map((b) => b.id), fields: ["id", "file_size"] });
  console.log(APPLY ? `rollback done: ${now.map((a) => `${a.id}=${a.file_size}B`).join(", ")}` : "dry run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- plan
const channels: Array<{ id: number; name: string }> = await call("discuss.channel", "search_read", {
  domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name"], context: { active_test: false }, limit: 2000,
});
const chName = new Map(channels.map((c) => [c.id, String(c.name).replace(/[⁦-⁩]/g, "")]));
const all: Att[] = await call("ir.attachment", "search_read", {
  domain: [["res_model", "=", "discuss.channel"], ["res_id", "in", channels.map((c) => c.id)]],
  fields: ["id", "name", "mimetype", "file_size", "checksum", "res_id", "voice_ids", "create_date"], order: "id asc",
});
const empty = all.filter((a) => !a.file_size);
console.log(`attachments in WhatsApp channels: ${all.length}, empty: ${empty.length}`);
const CLIPS = mkdtempSync(join(tmpdir(), "utak-voice-"));

type Plan = Att & { mediaId: string; message: number | null; logRow: number | null; bytes?: Uint8Array; metaSize?: number; metaSha256?: string; codec?: string; duration?: number; problem?: string };
const plans: Plan[] = [];
for (const a of empty) {
  const mediaId = /^(\d+)\.[a-z0-9]+$/i.exec(a.name)?.[1] ?? "";
  const [msg] = await call("mail.message", "search_read", { domain: [["attachment_ids", "in", [a.id]]], fields: ["id"], limit: 1 });
  const [log] = mediaId ? await call("x_wa_message", "search_read", { domain: [["x_direction", "=", "in"], ["x_body", "ilike", `:${mediaId}]`]], fields: ["id"], limit: 1 }) : [];
  const p: Plan = { ...a, mediaId, message: msg?.id ?? null, logRow: log?.id ?? null };
  plans.push(p);
  if (!mediaId || !log) { p.problem = "no Meta media id matching an inbound log row"; continue; }
  const metaRes = await fetch(`https://graph.facebook.com/${GV}/${mediaId}`, { headers: { Authorization: `Bearer ${dotenv.META_ACCESS_TOKEN}` } });
  const meta = await metaRes.json() as { url?: string; file_size?: number; sha256?: string; error?: { message: string } };
  if (!meta.url) { p.problem = `Meta: ${meta.error?.message ?? metaRes.status}`; continue; }
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${dotenv.META_ACCESS_TOKEN}` } });
  const bytes = new Uint8Array(await bin.arrayBuffer());
  Object.assign(p, { bytes, metaSize: meta.file_size, metaSha256: meta.sha256 });
  if (!bytes.length || bytes.length !== meta.file_size) { p.problem = `size ${bytes.length} ≠ Meta ${meta.file_size}`; continue; }
  if (meta.sha256 && sha("sha256", bytes) !== meta.sha256) { p.problem = "sha256 ≠ Meta"; continue; }
  const file = `${CLIPS}/${a.id}-${a.name}`;
  writeFileSync(file, bytes);
  try {
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,sample_rate,channels", "-of", "json", file]).toString());
    p.codec = `${probe.streams?.[0]?.codec_name} ${probe.streams?.[0]?.sample_rate}Hz ${probe.streams?.[0]?.channels}ch`;
    p.duration = Number(probe.format?.duration);
  } catch { p.codec = "ffprobe unavailable"; }
}
for (const p of plans) {
  console.log(`  #${p.id} ${p.name} ${p.mimetype} · channel ${p.res_id} «${chName.get(p.res_id)}» · message ${p.message} · log ${p.logRow} · voice ${p.voice_ids.join(",") || "—"}` +
    (p.problem ? ` → ✗ ${p.problem}` : ` → ${p.bytes!.length} B, sha256 = Meta ✓, ${p.codec}, ${p.duration?.toFixed(2)} s`));
}
const ready = plans.filter((p) => !p.problem);

const report: Record<string, unknown> = {
  at: new Date().toISOString(), mode: APPLY ? "apply" : "dry-run", attachments: all.length, empty: empty.length, ready: ready.length,
  plans: plans.map(({ bytes, ...p }) => ({ ...p, bytes: bytes?.length ?? 0 })),
};

if (APPLY && ready.length) {
  if (!existsSync(RB)) {
    writeFileSync(RB, JSON.stringify({ script: "scripts/inbox-20260925-voice-backfill.mts", createdAt: new Date().toISOString(),
      before: ready.map(({ id, name, mimetype, file_size, checksum, res_id, voice_ids, create_date }) => ({ id, name, mimetype, file_size, checksum, res_id, voice_ids, create_date })) }, null, 2) + "\n");
    console.log(`\nsnapshot → ${RB}`);
  } else console.log(`\nsnapshot kept from the first run → ${RB}`);
  const verified: unknown[] = [];
  for (const p of ready) {
    // mimetype sent too: without it _check_contents would re-guess it from the bytes.
    await call("ir.attachment", "write", { ids: [p.id], vals: { raw: Buffer.from(p.bytes!).toString("base64"), mimetype: p.mimetype } });
    const [now] = await call("ir.attachment", "read", { ids: [p.id], fields: ["file_size", "checksum", "mimetype", "voice_ids", "raw"] });
    const back = Buffer.from(String(now.raw || ""), "base64");
    const ok = now.file_size === p.bytes!.length && now.checksum === sha("sha1", p.bytes!) && sha("sha256", back) === p.metaSha256
      && now.mimetype === p.mimetype && JSON.stringify(now.voice_ids) === JSON.stringify(p.voice_ids);
    verified.push({ id: p.id, ok, file_size: now.file_size, checksum: now.checksum, sha256: sha("sha256", back), mimetype: now.mimetype, voice_ids: now.voice_ids });
    console.log(`  #${p.id}: ${ok ? "✓" : "✗"} stored ${now.file_size} B, sha1 ${now.checksum}, read back sha256 ${ok ? "= Meta" : "≠"}, voice ${now.voice_ids}`);
  }
  report.verified = verified;
} else if (!APPLY) console.log("\ndry run: nothing written (add --apply)");

writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${OUT}.md`, [
  `# Empty WhatsApp media in Odoo — ${report.mode} (${report.at})`, "",
  `Attachments in WhatsApp channels: ${all.length}; empty: ${empty.length}; refilled from Meta: ${APPLY ? (report.verified as any[] | undefined)?.filter((v: any) => v.ok).length ?? 0 : `${ready.length} planned`}.`, "",
  "| attachment | name | mimetype | channel | message | voice | bytes | duration | codec | status |", "|---|---|---|---|---|---|---|---|---|---|",
  ...plans.map((p) => `| ${p.id} | ${p.name} | ${p.mimetype} | ${p.res_id} ${chName.get(p.res_id)} | ${p.message} | ${p.voice_ids.join(",")} | ${p.bytes?.length ?? 0} | ${p.duration?.toFixed(2) ?? "—"} s | ${p.codec ?? "—"} | ${p.problem ?? "ok"} |`),
  "",
].join("\n"));
console.log(`→ ${OUT}.json / .md`);
