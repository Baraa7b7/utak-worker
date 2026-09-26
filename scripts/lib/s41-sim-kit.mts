// § 41 و (2026-09-26) — the kit of the full-day simulation (scripts/s41-full-day-sim.mts).
//
// The worker's own code (src/index.ts: fetch for /webhook and /internal/*,
// scheduled for the crons) runs IN THIS PROCESS, against the sim worker's
// configuration ([env.sim.vars] of wrangler.toml) and — with --odoo=live — the
// shared Odoo tenant. The deployed sim worker is not driven: the time is
// injected here (a process clock, Riyadh wall time), which no deployed route
// can do, so there is nothing to protect with ADMIN_TOKEN and nothing that
// could ever run on prod.
//
//   • WhatsApp: SIMULATION_MODE on, PILOT_MODE off → every send is captured
//     by the gateway (sim_outbound, the sim D1 via the Cloudflare API with
//     --odoo=live, and in memory here); graph.facebook.com is refused outright
//     for anything but a media download (answered here with fake bytes).
//   • SIM_RUN_ID: no Discuss line in any channel (src/config.ts isSimRun).
//   • KV: in memory (the run's windows, queues, claims never reach the
//     deployed worker's KV).
//   • Claude: answered here from the scenario's own texts (intent, order
//     items, prices, screening) — the extraction is not what is simulated.
//   • R2: a local folder (the PDFs of the run). Gotenberg: the real service
//     (.env.zatca-oneoff), so the PDFs are the real ones.
//   • Odoo automations that call the deployed worker: #1 (x_payment → the
//     receipt) is switched off for the run (scripts/s41-20260926-sim-mark.mts
//     --automation); the run calls /internal/receipt-issue in-process instead.
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

export const ROOT = new URL("../../", import.meta.url);
export type Mode = "live" | "fake";

// ---------------------------------------------------------------- the clock (live; fake uses the harness's)
const RealDate = Date;
let fixedNow: number | null = null;
export const realNow = () => RealDate.now();
let harnessSetRiyadh: ((s: string) => void) | null = null;
export function installLiveClock(): void {
  class SimDate extends RealDate {
    constructor(...a: unknown[]) {
      // deno-lint-ignore no-explicit-any
      if (a.length === 0 && fixedNow !== null) super(fixedNow); else super(...(a as [any]));
    }
    static now(): number { return fixedNow ?? RealDate.now(); }
  }
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Date = SimDate;
}
export function useHarnessClock(fn: (s: string) => void): void { harnessSetRiyadh = fn; }
/** Riyadh wall clock «2026-09-27 02:00». */
export function at(ymdHm: string): void {
  if (harnessSetRiyadh) harnessSetRiyadh(ymdHm);
  fixedNow = RealDate.parse(ymdHm.replace(" ", "T") + ":00+03:00");
}
export function nowRiyadh(): string {
  return new RealDate((fixedNow ?? RealDate.now()) + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

// ---------------------------------------------------------------- local secrets
function dotenv(name: string): Record<string, string> {
  const path = new URL(name, ROOT);
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}
export function simVars(): Record<string, string> {
  const toml = readFileSync(new URL("wrangler.toml", ROOT), "utf8");
  const block = toml.split("[env.sim.vars]")[1].split(/\n\[/)[0];
  const vars: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Z_]+)\s*=\s*"([^"]*)"/.exec(line.trim());
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

// ---------------------------------------------------------------- the fake customers (never real numbers)
export const FAKE_PREFIX = "+96650000410";
export const TEAM = {
  owner: "+966505154962", omar: "+966545816832", othman: "+966530399474", ahmed: "+966571777704",
};

// ---------------------------------------------------------------- capture
export interface Captured { at: string; to: string; type: string; template: string | null; text: string; wamid: string; raw: any }
export const captured: Captured[] = [];
let seenCaptured = 0;
/** The captures since the last call. */
export function takeCaptured(): Captured[] { const out = captured.slice(seenCaptured); seenCaptured = captured.length; return out; }

function captureD1(inner: any): any {
  return {
    prepare(sql: string) {
      const bindAndRun = (params: unknown[]) => ({
        run: async () => {
          if (/INSERT INTO sim_outbound/i.test(sql)) {
            const [, , to, type, template, , body_text, , wamid, raw] = params as any[];
            let parsed: any = {};
            try { parsed = JSON.parse(String(raw)); } catch { /* keep {} */ }
            captured.push({ at: nowRiyadh(), to: String(to), type: String(type), template: template ?? null, text: String(body_text ?? ""), wamid: String(wamid), raw: parsed });
          }
          return inner ? inner.prepare(sql).bind(...params).run() : {};
        },
        all: async () => (inner ? inner.prepare(sql).bind(...params).all() : { results: [] }),
        first: async () => (inner ? inner.prepare(sql).bind(...params).first() : null),
      });
      return { bind: (...params: unknown[]) => bindAndRun(params), ...bindAndRun([]) };
    },
  };
}

// ---------------------------------------------------------------- KV (in memory)
export class MemKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) { this.store.set(k, String(v)); }
  async delete(k: string) { this.store.delete(k); }
  async list(o: { prefix?: string } = {}) { return { keys: [...this.store.keys()].filter((k) => !o.prefix || k.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true }; }
}

// ---------------------------------------------------------------- R2 (a local folder)
function localBucket(dir: URL): any {
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => new URL(key.replace(/[^\w.\-/]/g, "_").replace(/\//g, "__"), dir);
  return {
    async put(key: string, bytes: Uint8Array | ArrayBuffer | string) {
      const b = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes as ArrayBuffer);
      writeFileSync(path(key), b);
      return { key, size: b.length };
    },
    async get(key: string) {
      const p = path(key);
      if (!existsSync(p)) return null;
      const b = readFileSync(p);
      return { body: b, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), httpMetadata: { contentType: "application/pdf" }, size: b.length };
    },
    async head(key: string) { return existsSync(path(key)) ? { key, size: readFileSync(path(key)).length } : null; },
    async delete(key: string) { /* never */ void key; },
  };
}

// ---------------------------------------------------------------- the env
export interface SimEnvOpts { mode: Mode; runId: string; outDir: URL; baseEnv?: any; liveD1?: any }
export function buildEnv(o: SimEnvOpts): any {
  const vars = simVars();
  const local = dotenv(".env.sim-verify");
  const gb = dotenv(".env.zatca-oneoff");
  const kv = new MemKV();
  const env: any = {
    ...(o.baseEnv ?? {}),
    ...vars,
    ODOO_URL: o.mode === "live" ? vars.ODOO_URL : (o.baseEnv?.ODOO_URL ?? vars.ODOO_URL),
    ODOO_API_KEY: o.mode === "live" ? local.ODOO_API_KEY : (o.baseEnv?.ODOO_API_KEY ?? "K"),
    // the switch that captures every send, and the run's own id
    SIMULATION_MODE: "true",
    PILOT_MODE: "false",
    SIM_RUN_ID: o.runId,
    SIM_ALLOWLIST: [TEAM.owner, TEAM.omar, TEAM.othman, TEAM.ahmed, FAKE_PREFIX].join(","),
    ACCOUNTING_SYNC: "false",
    // secrets of THIS process only (the deployed worker's are never read)
    META_APP_SECRET: "s41-" + randomBytes(12).toString("hex"),
    META_ACCESS_TOKEN: "s41-no-meta",
    META_VERIFY_TOKEN: "s41",
    ADMIN_TOKEN: "s41-" + randomBytes(16).toString("hex"),
    INTERNAL_WEBHOOK_SECRET: "s41-" + randomBytes(16).toString("hex"),
    ODOO_HOOK_TOKEN: "s41-" + randomBytes(16).toString("hex"),
    ANTHROPIC_API_KEY: "s41-scripted",
    GOTENBERG_URL: gb.GOTENBERG_URL, GOTENBERG_USER: gb.GOTENBERG_USER, GOTENBERG_PASSWORD: gb.GOTENBERG_PASSWORD,
    MSG_DEDUP: kv,
    SIM_DB: captureD1(o.liveD1 ?? null),
    INVOICES_BUCKET: localBucket(new URL("r2/", o.outDir)),
    WORKER_ORIGIN: "https://utak-worker-sim.utak-business.workers.dev",
  };
  return env;
}

// ---------------------------------------------------------------- the network guard
export interface ClaudeScript {
  /** The intent of a text (classifyIntent). */
  intent(text: string): string;
  /** A screening verdict for a new number's texts. */
  screen(texts: string[]): { intent: string; reason: string };
  /** The order items of a text: [{ product_id, packaging_id, quantity, product_name_raw }]. */
  order(text: string): unknown[];
  /** The prices of a supplier / source text: { prices, unrecognized }. */
  prices(text: string): { prices: unknown[]; unrecognized: string[] };
}
export const netLog: Array<{ host: string; method: string }> = [];
// ---------------------------------------------------------------- Odoo pacing (--odoo=live)
// s41-live-1 compressed two days into ~13 minutes, and the tenant's rate limiter
// (odoo.com, HTTP 429) answered the burst: an offer, a template lookup and a
// pricing read gave up after odoo.ts's retries, and each failure then cascaded
// through the days. A real day spreads the same requests over 24 hours, so the
// harness paces them: at most ODOO_PARALLEL at once, ODOO_GAP_MS between starts,
// and a 429 that still comes is re-sent here (the limiter refused it before
// Odoo ran it — odoo.ts's own rule), counted in odooStats for the report. The
// worker's handling of a 429 that outlasts its retries is tested in
// tests/s41.test.mts ([قالب] [سوق]), not here.
const ODOO_PARALLEL = 2, ODOO_GAP_MS = 150, ODOO_429_TRIES = 8;
export const odooStats = { requests: 0, absorbed429: 0 };
let odooActive = 0, odooNext = 0;
const odooQueue: Array<() => void> = [];
async function odooPaced(send: () => Promise<Response>): Promise<Response> {
  while (odooActive >= ODOO_PARALLEL) await new Promise<void>((r) => odooQueue.push(r));
  odooActive++;
  try {
    for (let i = 0; ; i++) {
      const now = realNow(), at = Math.max(now, odooNext);
      odooNext = at + ODOO_GAP_MS;
      if (at > now) await new Promise((r) => setTimeout(r, at - now));
      odooStats.requests++;
      const res = await send();
      if (res.status !== 429 || i >= ODOO_429_TRIES) return res;
      odooStats.absorbed429++;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(i, 4)));
    }
  } finally {
    odooActive--;
    odooQueue.shift()?.();
  }
}
export const MEDIA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export function installFetchGuard(mode: Mode, claude: ClaudeScript, prompts: { classify: string; screen: string; order: string; prices: string }, inner: typeof fetch): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const u = new URL(url);
    netLog.push({ host: u.host, method: init?.method ?? "GET" });
    if (u.host === "api.anthropic.com") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      const user = String(b?.messages?.[0]?.content ?? "");
      let text = "";
      if (b.system === prompts.classify) text = JSON.stringify({ intent: claude.intent(user.split("\n\nSender type:")[0]), confidence: 0.95 });
      else if (b.system === prompts.screen) text = JSON.stringify(claude.screen(user.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ""))));
      else if (b.system === prompts.order) text = JSON.stringify(claude.order(user.split("MESSAGE: ").pop() ?? ""));
      else if (b.system === prompts.prices) text = JSON.stringify(claude.prices(user.split("MESSAGE:\n").pop() ?? ""));
      else text = "تمام، وصلتنا رسالتك 🌿";
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
    }
    if (u.host === "graph.facebook.com") {
      const method = String(init?.method ?? "GET").toUpperCase();
      const media = /\/(SIMMEDIA_[A-Za-z0-9_]+)$/.exec(u.pathname);
      if (method === "GET" && media) return new Response(JSON.stringify({ url: `https://media.sim.local/${media[1]}`, mime_type: /PDF$/.test(media[1]) ? "application/pdf" : "image/jpeg", file_size: MEDIA.length }), { status: 200 });
      throw new Error(`BLOCKED: a real Meta call (${method} ${u.pathname}) — the simulation never reaches Meta`);
    }
    if (u.host === "media.sim.local") return new Response(MEDIA, { status: 200 });
    if (mode === "live") {
      if (u.host === "utakfresh.odoo.com") {
        const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(u.pathname);
        if (m && (m[2] === "unlink" || m[1] === "ir.module.module" || ((m[1] === "account.move" || m[1] === "account.payment") && m[2] !== "search_read" && m[2] !== "read" && m[2] !== "search_count"))) {
          throw new Error(`BLOCKED (simulation): ${m[1]}.${m[2]}`);
        }
        return odooPaced(() => inner(input, init));
      }
      if (u.host === "api.cloudflare.com" && u.pathname.includes("/d1/database/")) return inner(input, init);
      const gb = dotenv(".env.zatca-oneoff").GOTENBERG_URL;
      if (gb && url.startsWith(gb)) return inner(input, init);
      throw new Error(`BLOCKED (simulation): ${u.host}`);
    }
    // fake mode: Odoo and the rest go to the harness; Gotenberg is real (the PDFs)
    const gb = dotenv(".env.zatca-oneoff").GOTENBERG_URL;
    if (gb && url.startsWith(gb)) return (globalThis as any).__realFetch(input, init);
    return inner(input, init);
  }) as typeof fetch;
}

// ---------------------------------------------------------------- the worker's own entry points
export interface Ctx { tasks: Promise<unknown>[]; waitUntil(p: Promise<unknown>): void; passThroughOnException(): void }
export function newCtx(): Ctx { const tasks: Promise<unknown>[] = []; return { tasks, waitUntil: (p) => { tasks.push(p.catch((e) => console.error("[ctx task]", e?.message ?? e))); }, passThroughOnException: () => {} }; }
let seq = 0;
export async function webhook(worker: any, env: any, from: string, msg: Record<string, unknown>, profileName = "x"): Promise<number> {
  const digits = from.replace(/\D/g, "");
  const payload = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: env.META_PHONE_NUMBER_ID }, contacts: [{ wa_id: digits, profile: { name: profileName } }], messages: [{ id: `wamid.S41IN${Date.now()}${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }] } }] }] };
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(raw).digest("hex");
  const ctx = newCtx();
  const res = await worker.fetch(new Request("https://sim.local/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sig } }), env, ctx);
  await drain(ctx);
  return res.status;
}
export async function drain(ctx: Ctx): Promise<void> {
  for (let i = 0; i < 6 && ctx.tasks.length; i++) { const t = ctx.tasks.splice(0); await Promise.all(t); }
}
export async function cron(worker: any, env: any, expr: string): Promise<void> {
  const ctx = newCtx();
  await worker.scheduled({ cron: expr, scheduledTime: Date.now(), noRetry() {} }, env, ctx);
  await drain(ctx);
}
export async function internal(worker: any, env: any, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const ctx = newCtx();
  const res = await worker.fetch(new Request(`https://sim.local${path}?token=${encodeURIComponent(env.INTERNAL_WEBHOOK_SECRET)}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env, ctx);
  await drain(ctx);
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
}
