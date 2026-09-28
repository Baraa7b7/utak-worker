// § 44 ج (2026-09-28) — the four numbers of § 43 (#20, #46, #47, #50), in Odoo.
//
//   #20 «PILOT-عميل-حي-العليا»   archived.
//   #46 «عمر» (the duplicate)      archived — only when no hr.employee points to it (work contact,
//                                  user partner, address, follower); else stop on this one and list.
//   #47 «يو» → #31 «ابو مكين المعبري» (the same number):
//        · every stored reference to #47 (ir.model.fields → res.partner, many2one / many2many, on every
//          non-transient model) is listed; the writable ones move to #31: its x_wa_message rows, its
//          WhatsApp inbox channel (x_wa_partner_id), anything else found;
//        · mail.message.author_id stays on #47 (Odoo refuses mail.message writes to the API user, 403 —
//          STATUS § 22) and res.partner.commercial_partner_id is #47's own (stored compute): listed;
//        · #31 takes #47's WhatsApp number (its own x_whatsapp_number is empty) and the live channel
//          (x_wa_channel_id), then «عميل» by «📋 مراجعة الأرقام»'s own button (server action 988);
//        · #47 archived; the channel titles through src/wa-inbox.ts syncInboxChannelTitles (the
//          worker's function: the live channel «واتساب · ابو مكين المعبري · +…», #31's old one stays «(قديم)»).
//   #50 «Not Book»   «شخصي» by «📋 مراجعة الأرقام»'s own button (server action 991).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s44-20260928-partners.mts            dry run
//   … --apply       the rollback file first (backups/, mode 600 — it carries the channel titles with the full
//                   number), a masked copy in scripts/artifacts/, then the writes, then verify
//   … --verify      reads: the four, the references left, the price-publish audience (src/prices.ts)
//   … --rollback [--apply]
//
// No deletion, no WhatsApp, no tax setting, no module.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const ROLLBACK = process.argv.includes("--rollback");
const log = (...a: unknown[]) => console.log(...a);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// Odoo only; the writes this script may make are listed (anything else is refused before it leaves)
const WRITES = new Set(["res.partner.write", "x_wa_message.write", "discuss.channel.write", "ir.actions.server.run"]);
const realFetch = globalThis.fetch;
let allowWrite = false;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith(dotenv.ODOO_URL)) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !["search_read", "read", "search", "search_count", "fields_get"].includes(m[2])) {
    const k = `${m[1]}.${m[2]}`;
    if (!WRITES.has(k) || !allowWrite) throw new Error(`BLOCKED: ${k}${allowWrite ? "" : " (dry run)"}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

class KV { store = new Map<string, string>(); async get(k: string) { return this.store.get(k) ?? null; } async put(k: string, v: string) { this.store.set(k, v); } async delete(k: string) { this.store.delete(k); } }
const tomlSrc = readFileSync(new URL("wrangler.toml", root), "utf8");
const OWNER = (/^OWNER_WHATSAPP\s*=\s*"([^"]*)"/m.exec(tomlSrc) ?? [])[1] ?? "";
const env: any = { ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY, OWNER_WHATSAPP: OWNER, MSG_DEDUP: new KV() };
const { call } = await import("../src/odoo.ts");
const { syncInboxChannelTitles } = await import("../src/wa-inbox.ts");
const { priceRecipients } = await import("../src/prices.ts");

const SA_CUSTOMER = 988, SA_PERSONAL = 991;
const PILOT = 20, OMAR_DUP = 46, YOU = 47, ABU_MAKEEN = 31, NOT_BOOK = 50;
const ALL = [PILOT, OMAR_DUP, YOU, ABU_MAKEEN, NOT_BOOK];
const RB_FULL = new URL("backups/s44-20260928-partners-rollback.json", root);
const RB_MASKED = new URL("scripts/artifacts/s44-20260928-partners-rollback-masked.json", root);
const OUT = new URL("scripts/artifacts/s44-20260928-partners.json", root);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const mask = (s: unknown) => { const d = digits(s); return d.length >= 7 ? `+${d.slice(0, 3)}…${d.slice(-4)}` : d ? "…" : ""; };
const maskText = (s: unknown) => String(s ?? "").replace(/\+?\d{9,}/g, (d) => mask(d)).replace(/[⁦⁩]/g, "");
const PFIELDS = ["id", "name", "active", "x_contact_class", "x_review_pending", "x_ai_intent", "customer_rank", "supplier_rank", "x_whatsapp_number", "phone", "x_wa_allowed", "x_wa_marketing_optout", "x_wa_channel_id", "x_role_ids"];
const readPartners = async () => call<any[]>(env, "res.partner", "read", { ids: ALL, fields: PFIELDS, context: { active_test: false } });
const maskP = (p: any) => ({ ...p, x_whatsapp_number: mask(p.x_whatsapp_number), phone: mask(p.phone), x_wa_channel_id: Array.isArray(p.x_wa_channel_id) ? [p.x_wa_channel_id[0], maskText(p.x_wa_channel_id[1])] : p.x_wa_channel_id });

/** Every stored many2one / many2many to res.partner on a non-transient model, and the records pointing to `ids`. */
async function references(ids: number[]): Promise<Array<{ model: string; field: string; ttype: string; id: number; partner: number }>> {
  const fields = await call<any[]>(env, "ir.model.fields", "search_read", { domain: [["relation", "=", "res.partner"], ["ttype", "in", ["many2one", "many2many"]], ["store", "=", true]], fields: ["model", "name", "ttype"], order: "model asc" });
  const models = await call<any[]>(env, "ir.model", "search_read", { domain: [["transient", "=", false]], fields: ["model", "abstract"] });
  const real = new Set(models.filter((m) => !m.abstract).map((m) => m.model));
  const hits: Array<{ model: string; field: string; ttype: string; id: number; partner: number }> = [];
  for (const f of fields) {
    if (!real.has(f.model)) continue;
    let rows: any[] = [];
    try {
      rows = await call<any[]>(env, f.model, "search_read", { domain: [[f.name, "in", ids]], fields: ["id", f.name], context: { active_test: false }, limit: 500 });
    } catch { continue; } // a model the API user cannot read (listed by the scan of 09-28: none)
    for (const r of rows) {
      const v = r[f.name];
      const pids: number[] = f.ttype === "many2one" ? (Array.isArray(v) ? [v[0]] : []) : (Array.isArray(v) ? v : []);
      for (const pid of pids.filter((x) => ids.includes(x))) hits.push({ model: f.model, field: f.name, ttype: f.ttype, id: r.id, partner: pid });
    }
  }
  return hits;
}
/** A reference that cannot or must not move (with why). */
function fixed(h: { model: string; field: string; id: number; partner: number }): string | null {
  if (h.model === "mail.message") return "Odoo يرفض تعديل mail.message لمستخدم الـ API (403، § 22): يبقى كاتبها #47 المؤرشف";
  if (h.model === "res.partner" && h.field === "commercial_partner_id" && h.id === h.partner) return "حقل محسوب مخزّن يشير إلى السجل نفسه";
  if (h.model === "discuss.channel.member" || h.model === "mail.followers") return "عضوية أو متابعة: تُترك مع الشريك المؤرشف";
  return null;
}
async function employeesOf(pid: number): Promise<any[]> {
  const out: any[] = [];
  for (const k of ["work_contact_id", "user_partner_id", "address_id", "message_partner_ids"]) {
    const r = await call<any[]>(env, "hr.employee", "search_read", { domain: [[k, "in", [pid]]], fields: ["id", "name", "active"], context: { active_test: false } });
    for (const e of r) out.push({ field: k, ...e });
  }
  return out;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB_FULL, "utf8"));
  allowWrite = APPLY;
  const w = async (model: string, ids: number[], vals: Record<string, unknown>) => {
    log(`${APPLY ? "" : "would "}${model} ${ids.join(",")} ← ${maskText(JSON.stringify(vals))}`);
    if (APPLY) await call(env, model, "write", { ids, vals, context: { active_test: false } });
  };
  for (const [mid, ids] of Object.entries(rb.moved as Record<string, number[]>)) {
    const [model, field] = mid.split(":");
    if (ids.length) await w(model, ids, { [field]: YOU });
  }
  for (const c of rb.channels) await w("discuss.channel", [c.id], { name: c.name, x_wa_partner_id: c.x_wa_partner_id });
  for (const p of rb.partners) {
    const vals: Record<string, unknown> = { active: p.active, x_contact_class: p.x_contact_class, x_review_pending: p.x_review_pending, customer_rank: p.customer_rank, x_whatsapp_number: p.x_whatsapp_number, x_wa_channel_id: Array.isArray(p.x_wa_channel_id) ? p.x_wa_channel_id[0] : false };
    await w("res.partner", [p.id], vals);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- read + plan
const before = await readPartners();
const P = Object.fromEntries(before.map((p) => [p.id, p]));
const refs = await references([YOU]);
const empsOmar = await employeesOf(OMAR_DUP);
const channelsBefore = await call<any[]>(env, "discuss.channel", "search_read", { domain: [["x_wa_partner_id", "in", [YOU, ABU_MAKEEN]]], fields: ["id", "name", "x_wa_partner_id"], context: { active_test: false } });
const move = refs.filter((h) => !fixed(h));
const keep = refs.filter((h) => fixed(h)).map((h) => ({ ...h, why: fixed(h) }));
const byModel: Record<string, number[]> = {};
for (const h of move) (byModel[`${h.model}:${h.field}:${h.ttype}`] ??= []).push(h.id);
const plan = {
  "#20": P[PILOT].active ? "أرشفة" : "مؤرشف أصلاً",
  "#46": empsOmar.length ? `توقف: مرتبط بـ hr.employee ${JSON.stringify(empsOmar)}` : P[OMAR_DUP].active ? "أرشفة (لا hr.employee يشير إليه)" : "مؤرشف أصلاً",
  "#47→#31": {
    move: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, v])),
    keep: keep.map((k) => `${k.model}.${k.field} #${k.id}: ${k.why}`),
    number: P[ABU_MAKEEN].x_whatsapp_number ? "لـ #31 رقم واتساب أصلاً" : `رقم #47 (${mask(P[YOU].x_whatsapp_number)}) إلى #31`,
    channel: `القناة الحية ${Array.isArray(P[YOU].x_wa_channel_id) ? P[YOU].x_wa_channel_id[0] : "—"} إلى #31، وقناته القديمة ${Array.isArray(P[ABU_MAKEEN].x_wa_channel_id) ? P[ABU_MAKEEN].x_wa_channel_id[0] : "—"} تبقى «(قديم)»`,
    classify: `#31 «عميل» بزر المراجعة (إجراء الخادم ${SA_CUSTOMER})`,
    archive: "#47 أرشفة",
  },
  "#50": P[NOT_BOOK].x_contact_class === "personal" ? "شخصي أصلاً" : `«شخصي» بزر المراجعة (إجراء الخادم ${SA_PERSONAL})`,
};
const audienceBefore = (await priceRecipients(env)).map((r) => `#${r.id} ${r.name} ${mask(r.phone)}`);
log("before:", JSON.stringify(before.map(maskP), null, 0));
log("references to #47:", refs.length, "· move", move.length, "· keep", keep.length);
log("plan:", JSON.stringify(plan, null, 1));
log("price-publish audience now:", audienceBefore.join(" · ") || "none");

if (!APPLY && !VERIFY) {
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), mode: "dry-run", before: before.map(maskP), refs, plan, audienceBefore }, null, 1) + "\n");
  log("dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- apply
if (APPLY) {
  if (empsOmar.length) log(`⚠️ #46 is linked to hr.employee — left as it is: ${JSON.stringify(empsOmar)}`);
  const rb = {
    at: new Date().toISOString(), script: "scripts/s44-20260928-partners.mts",
    partners: before.map((p) => ({ id: p.id, active: p.active, x_contact_class: p.x_contact_class, x_review_pending: p.x_review_pending, customer_rank: p.customer_rank, x_whatsapp_number: p.x_whatsapp_number, x_wa_channel_id: p.x_wa_channel_id })),
    channels: channelsBefore.map((c) => ({ id: c.id, name: c.name, x_wa_partner_id: Array.isArray(c.x_wa_partner_id) ? c.x_wa_partner_id[0] : false })),
    moved: {} as Record<string, number[]>,
  };
  if (!existsSync(new URL("backups/", root))) mkdirSync(new URL("backups/", root), { recursive: true });
  const saveRb = () => {
    writeFileSync(RB_FULL, JSON.stringify(rb, null, 1) + "\n");
    chmodSync(RB_FULL, 0o600);
    writeFileSync(RB_MASKED, JSON.stringify({ ...rb, note: "full values in backups/s44-20260928-partners-rollback.json (600, outside git)", partners: rb.partners.map(maskP), channels: rb.channels.map((c) => ({ ...c, name: maskText(c.name) })) }, null, 1) + "\n");
  };
  saveRb();
  allowWrite = true;
  const w = async (model: string, ids: number[], vals: Record<string, unknown>) => {
    log(`${model} ${ids.join(",")} ← ${maskText(JSON.stringify(vals))}`);
    await call(env, model, "write", { ids, vals, context: { active_test: false } });
  };
  // #20
  if (P[PILOT].active) await w("res.partner", [PILOT], { active: false });
  // #46
  if (!empsOmar.length && P[OMAR_DUP].active) await w("res.partner", [OMAR_DUP], { active: false });
  // #47 → #31: the references
  for (const [k, ids] of Object.entries(byModel)) {
    const [model, field, ttype] = k.split(":");
    rb.moved[`${model}:${field}`] = ids; saveRb();
    if (ttype === "many2one") await w(model, ids, { [field]: ABU_MAKEEN });
    else for (const id of ids) await w(model, [id], { [field]: [[3, YOU], [4, ABU_MAKEEN]] });
  }
  // #31: the number, the live channel, «عميل»
  const vals31: Record<string, unknown> = {};
  if (!P[ABU_MAKEEN].x_whatsapp_number && P[YOU].x_whatsapp_number) vals31.x_whatsapp_number = P[YOU].x_whatsapp_number;
  if (Array.isArray(P[YOU].x_wa_channel_id)) vals31.x_wa_channel_id = P[YOU].x_wa_channel_id[0];
  // #47 archived BEFORE #31 takes the number (no two active partners share it for a moment)
  await w("res.partner", [YOU], { active: false });
  if (Object.keys(vals31).length) await w("res.partner", [ABU_MAKEEN], vals31);
  log(`ir.actions.server ${SA_CUSTOMER} (عميل) on #${ABU_MAKEEN}`);
  await call(env, "ir.actions.server", "run", { ids: [SA_CUSTOMER], context: { active_model: "res.partner", active_ids: [ABU_MAKEEN], active_id: ABU_MAKEEN } });
  // #50
  if (P[NOT_BOOK].x_contact_class !== "personal") {
    log(`ir.actions.server ${SA_PERSONAL} (شخصي) on #${NOT_BOOK}`);
    await call(env, "ir.actions.server", "run", { ids: [SA_PERSONAL], context: { active_model: "res.partner", active_ids: [NOT_BOOK], active_id: NOT_BOOK } });
  }
  // the titles, by the worker's own function (only discuss.channel.name)
  const titles = await syncInboxChannelTitles(env, { partnerId: ABU_MAKEEN });
  log("titles:", titles.map((t) => `#${t.channelId} «${maskText(t.before)}» → «${maskText(t.after)}»${t.written ? "" : " (unchanged)"}`).join(" · ") || "none");
  allowWrite = false;
}

// ---------------------------------------------------------------- verify
const after = await readPartners();
const A = Object.fromEntries(after.map((p) => [p.id, p]));
const left = await references([YOU]);
const leftMovable = left.filter((h) => !fixed(h));
const channelsAfter = await call<any[]>(env, "discuss.channel", "search_read", { domain: [["x_wa_partner_id", "in", [YOU, ABU_MAKEEN]]], fields: ["id", "name", "x_wa_partner_id"], context: { active_test: false } });
const audience = await priceRecipients(env);
const team = new Set<string>(); // the roster is excluded by priceRecipients itself
let ok = 0, bad = 0;
const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
check("#20 archived", A[PILOT].active === false);
check(empsOmar.length ? "#46 left (linked to hr.employee)" : "#46 archived, no hr.employee points to it", empsOmar.length ? A[OMAR_DUP].active === true : A[OMAR_DUP].active === false, JSON.stringify(empsOmar));
check("#47 archived", A[YOU].active === false);
check(`no movable reference to #47 left (${left.length} fixed: ${left.map((h) => `${h.model}.${h.field} #${h.id}`).join(", ")})`, leftMovable.length === 0, JSON.stringify(leftMovable));
check("#31 «عميل», reviewed, customer_rank ≥ 1, active", A[ABU_MAKEEN].x_contact_class === "customer" && A[ABU_MAKEEN].x_review_pending === false && A[ABU_MAKEEN].customer_rank >= 1 && A[ABU_MAKEEN].active === true, JSON.stringify(maskP(A[ABU_MAKEEN])));
check("#31 has the number #47 had", digits(A[ABU_MAKEEN].x_whatsapp_number) !== "" && digits(A[ABU_MAKEEN].x_whatsapp_number) === digits(P[YOU].x_whatsapp_number || P[ABU_MAKEEN].x_whatsapp_number));
check("#31 not opted out of marketing, not held", A[ABU_MAKEEN].x_wa_marketing_optout !== true);
const live = channelsAfter.find((c) => Array.isArray(P[YOU].x_wa_channel_id) && c.id === P[YOU].x_wa_channel_id[0]);
check("the live channel is #31's, titled with his name", !!live && live.x_wa_partner_id?.[0] === ABU_MAKEEN && String(live.name).includes("ابو مكين المعبري") && !String(live.name).startsWith("(قديم)"), maskText(live?.name));
check("#31's link points to the live channel", Array.isArray(A[ABU_MAKEEN].x_wa_channel_id) && A[ABU_MAKEEN].x_wa_channel_id[0] === live?.id);
check("#50 «شخصي», not pending", A[NOT_BOOK].x_contact_class === "personal" && A[NOT_BOOK].x_review_pending === false);
const outside = audience.filter((r) => !team.has(digits(r.phone)));
check(`price-publish audience outside the team: ${outside.map((r) => `#${r.id} ${r.name}`).join(", ")}`, outside.some((r) => r.id === ABU_MAKEEN) && !outside.some((r) => [PILOT, OMAR_DUP, YOU, NOT_BOOK].includes(r.id)));
log(`verify: ${ok}/${ok + bad}`);
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(), mode: APPLY ? "apply" : "verify", plan, before: before.map(maskP), after: after.map(maskP),
  refsBefore: refs, refsLeft: left.map((h) => ({ ...h, why: fixed(h) })), channelsBefore: channelsBefore.map((c) => ({ ...c, name: maskText(c.name) })), channelsAfter: channelsAfter.map((c) => ({ ...c, name: maskText(c.name) })),
  audienceBefore, audienceAfter: audience.map((r) => `#${r.id} ${r.name} ${mask(r.phone)}`), verify: { ok, total: ok + bad },
}, null, 1) + "\n");
process.exit(bad ? 1 : 0);
