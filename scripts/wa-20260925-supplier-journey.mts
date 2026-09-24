// One supplier day, end to end, with nothing leaving the process (2026-09-25).
//
// The real worker code (crons and /webhook) on the in-memory Odoo + captured
// Graph of tests/wa-harness.mts, Claude mocked per message. Five suppliers:
//   A never replies · B sends correct prices · C free text · D a voice note ·
//   E a price far from his last one.
// 02:00 ask → replies 02:30 → 05:00 cron (reminder) → 21:15 cron (list + alerts).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-20260925-supplier-journey.mts
//
// Out: scripts/artifacts/wa-20260925-supplier-journey.md

import { writeFileSync } from "node:fs";
import { ctx, graph, inbound, ownerAlerts, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table } from "../tests/wa-harness.mts";

const harnessFetch = globalThis.fetch;
/** Claude, per message: what a careful extraction of that text returns. */
function extractionFor(message: string): unknown {
  if (/طماطم كرتون 25/.test(message)) return { prices: [{ product_id: 1, packaging_id: 11, cost_price: 25 }, { product_id: 2, packaging_id: 21, cost_price: 15 }], unrecognized: [] };
  if (/طماطم كرتون 60/.test(message)) return { prices: [{ product_id: 1, packaging_id: 11, cost_price: 60 }], unrecognized: [] };
  return { prices: [], unrecognized: [] };
}
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    const msg = JSON.parse(init.body)?.messages?.[0]?.content ?? "";
    const text = String(typeof msg === "string" ? msg : JSON.stringify(msg)).split("MESSAGE:").pop() ?? "";
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(extractionFor(text)) }] }), { status: 200 });
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const worker = (await import("../src/index.ts")).default;
const { clearTemplateCache } = await import("../src/templates.ts");

const env = reset(); clearTemplateCache();
seed("res.users", { id: 2, login: "x", partner_id: 3 });
for (const id of [1, 2]) Object.assign(table("product.template").get(id)!, { active: true, sale_ok: true, x_is_active_for_sale: true });
const S = [
  { id: 801, key: "A", name: "مورد لا يرد", phone: "966500000801", reply: null as null | Record<string, unknown> },
  { id: 802, key: "B", name: "مورد منضبط", phone: "966500000802", reply: { type: "text", text: { body: "طماطم كرتون 25، خيار جرم 15" } } },
  { id: 803, key: "C", name: "مورد يكتب كلاماً", phone: "966500000803", reply: { type: "text", text: { body: "صباح النور، الأسعار مثل أمس تقريباً" } } },
  { id: 804, key: "D", name: "مورد يرسل صوتاً", phone: "966500000804", reply: { type: "audio", audio: { id: "VOICE1", voice: true, mime_type: "audio/ogg" } } },
  { id: 805, key: "E", name: "مورد بسعر شاذ", phone: "966500000805", reply: { type: "text", text: { body: "طماطم كرتون 60" } } },
];
for (const s of S) seed("res.partner", { id: s.id, name: s.name, supplier_rank: 1, active: true, x_whatsapp_number: "+" + s.phone, x_supplied_product_ids: [1, 2] });
seed("x_daily_price", { x_supplier_id: 805, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-09-24", x_price_sar: 25, x_extraction_status: "extracted" });
for (const [purpose, name, n] of [["supplier_ask", "utak_supplier_ask_v2", 2], ["supplier_confirm", "utak_supplier_confirm_v1", 2], ["supplier_price_nudge", "utak_supplier_price_nudge", 2]] as const) {
  seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: "UTILITY" });
}

const steps: string[] = [];
const run = async (label: string, riyadh: string, fn: () => Promise<unknown>) => { setRiyadh(riyadh); await quiet(fn); steps.push(`${riyadh.slice(11)} ${label}`); };
await run("طلب الأسعار (كرون 02:00)", "2026-09-25 02:00", () => worker.scheduled({ cron: "0 23 * * *" } as any, env, ctx));
for (const s of S) if (s.reply) await run(`رد ${s.key}`, "2026-09-25 02:30", () => worker.fetch(signed(inbound(s.phone, s.reply!)), env, ctx));
await run("كرون 05:00 (الموثوقية ثم التذكير)", "2026-09-25 05:00", () => worker.scheduled({ cron: "0 2 * * *" } as any, env, ctx));
await run("كرون 21:15 (قائمة الشراء ثم التنبيهات)", "2026-09-25 21:15", () => worker.scheduled({ cron: "15 18 * * *" } as any, env, ctx));

const toSupplier = (phone: string) => sentTo(phone).map((b: any) => b.type === "template"
  ? `قالب ${b.template.name} [${(b.template.components.find((c: any) => c.type === "body")?.parameters ?? []).map((p: any) => p.text).join(" | ").slice(0, 70)}]`
  : `نص: «${String(b.text?.body ?? "").slice(0, 70)}»`);
const alertsAbout = (name: string) => ownerAlerts().map((a) => JSON.parse(a)).map((b: any) => String(b.template?.components?.[0]?.parameters?.[0]?.text ?? b.text?.body ?? ""))
  .filter((t) => t.includes(name)).map((t) => `«${t.replace(/\s+/g, " ").slice(0, 150)}»`);
const logOf = (id: number) => [...table("x_supplier_price_request_log").values()].find((l) => l.x_supplier_id === id);
const L: string[] = [];
L.push(`# يوم مورد كامل بالمحاكاة — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
L.push("الكود الحقيقي (الكرونات و/webhook) على Odoo في الذاكرة، وGraph مُعترض، وClaude محاكى. **لا إرسال ولا كتابة حقيقية.**", "");
L.push(`**الخطوات:** ${steps.join(" ← ")}`, "");
for (const s of S) {
  const lg = logOf(s.id);
  const prices = rows("x_daily_price").filter((p) => p.x_supplier_id === s.id && p.x_date === "2026-09-25");
  L.push(`## ${s.key}) ${s.name}`, "");
  L.push(`- **ردّه:** ${s.reply ? (s.reply.type === "audio" ? "رسالة صوتية" : `«${(s.reply as any).text.body}»`) : "لا شيء"}`);
  L.push(`- **ما وصله منا:** ${toSupplier(s.phone).join(" ← ") || "—"}`);
  L.push(`- **تنبيهات براء:** ${alertsAbout(s.name).join(" / ") || "لا شيء"}`);
  L.push(`- **الأسعار المحفوظة:** ${prices.map((p) => `${p.x_product_tmpl_id === 1 ? "طماطم" : "خيار"} ${p.x_price_sar} (${p.x_extraction_status})`).join("، ") || "لا شيء"}`);
  L.push(`- **سجل الطلب:** ${lg ? `${lg.x_status}${lg.x_replied_at ? "، رد" : "، بلا رد"}` : "—"}`, "");
}
const md = L.join("\n") + "\n";
writeFileSync(new URL("./artifacts/wa-20260925-supplier-journey.md", import.meta.url), md);
console.log(md);
console.log(`graph requests: ${graph.length} (all captured in memory)`);
