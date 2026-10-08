// § 67 (2026-10-08) — read-only checks after the deploy (nothing is written, nothing is sent):
//
//   node scripts/s67-20261008-check.mjs trial            the trial alert's row and its status at Meta
//   node scripts/s67-20261008-check.mjs since=HH:MM      every x_wa_message row since that Riyadh hour today:
//                                                        who it went to (Baraa / another partner / nobody), its status —
//                                                        «does anything automatic leave for anyone but Baraa?»
//   node scripts/s67-20261008-check.mjs frozen[=YYYY-MM-DD]   the «🧊 مجمّد» rows of a day (today), one a job / a message
//
// Numbers are never printed (a partner is its id), and bodies are cut to their first words.
import { readFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const arg = process.argv[2] ?? "";
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const riyadh = (utc) => new Date(Date.parse(String(utc).replace(" ", "T") + "Z") + 3 * 3600_000).toISOString().slice(11, 19);
const brief = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\+?\d{9,15}/g, (d) => `…${d.slice(-3)}`).slice(0, 110);
const owner = (/^OWNER_WHATSAPP\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) || [])[1].replace(/\D/g, "");
const [ownerPartner] = await call("res.partner", "search_read", { domain: [["x_whatsapp_number", "like", owner.slice(-9)]], fields: ["id"], limit: 1, context: { active_test: false } });
const FIELDS = ["id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_status", "x_source", "x_body", "x_meta_error"];
const line = (r) => `#${r.id} ${riyadh(r.create_date)} ${r.x_direction} [${r.x_status}] ${r.x_source ?? ""} → ${!r.x_partner_id ? "nobody" : r.x_partner_id[0] === ownerPartner?.id ? "Baraa" : `partner #${r.x_partner_id[0]}`} — ${brief(r.x_body)}`;

if (arg === "trial") {
  const rows = await call("x_wa_message", "search_read", { domain: [["x_body", "like", "🧪 تجربة § 67"], ["create_date", ">=", `${today} 00:00:00`]], fields: FIELDS, order: "id desc", limit: 3 });
  console.log(rows.map(line).join("\n") || "no trial row today");
  process.exit(rows.some((r) => ["sent", "delivered", "read"].includes(r.x_status)) ? 0 : 1);
}
if (arg.startsWith("since=")) {
  const [h, m] = arg.slice(6).split(":").map(Number);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) + (h * 60 + m - 180) * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const rows = await call("x_wa_message", "search_read", { domain: [["create_date", ">=", from]], fields: FIELDS, order: "id asc", limit: 300 });
  console.log(rows.map(line).join("\n") || "(no row)");
  const left = rows.filter((r) => r.x_direction === "out" && ["sent", "delivered", "read", "held", "queued", "sending"].includes(r.x_status) && r.x_partner_id && r.x_partner_id[0] !== ownerPartner?.id && r.x_source !== "manual");
  console.log(`\n${rows.length} row(s) since ${arg.slice(6)}: ${rows.filter((r) => r.x_status === "frozen").length} «مجمّد»; automatic messages that left (or wait) for anyone but Baraa: ${left.length}${left.length ? ` — ${left.map((r) => `#${r.id}`).join(" ")}` : ""}`);
  process.exit(left.length ? 1 : 0);
}
if (arg.startsWith("frozen")) {
  const day = arg.includes("=") ? arg.split("=")[1] : today;
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + 21 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const rows = await call("x_wa_message", "search_read", { domain: [["x_status", "=", "frozen"], ["create_date", ">=", from], ["create_date", "<", to]], fields: FIELDS, order: "id asc", limit: 300 });
  console.log(rows.map(line).join("\n") || `no «مجمّد» row on ${day}`);
  console.log(`\n${rows.length} «مجمّد» row(s) on ${day}; the 02:00 price ask among them: ${rows.some((r) => String(r.x_body).includes("طلب أسعار الشراء من الموردين (02:00)")) ? "yes" : "no"}`);
  process.exit(0);
}
console.log("usage: node scripts/s67-20261008-check.mjs trial | since=HH:MM | frozen[=YYYY-MM-DD]");
process.exit(2);
