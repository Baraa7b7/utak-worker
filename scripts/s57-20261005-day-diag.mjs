// § 57 أ (2026-10-05) — read-only: what «📊 اليوم» (utak.price_day_form) really is on the tenant — the
// view, everything that inherits it, what get_views hands the browser, and whether the model carries a
// chatter. Nothing is written. Output: scripts/artifacts/s57-20261005-day-arch.json and a summary.
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const ALL = { active_test: false };
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const MODEL = "x_price_day";
const views = await call("ir.ui.view", "search_read", { domain: [["model", "=", MODEL]], fields: ["id", "name", "type", "mode", "priority", "active", "inherit_id", "inherit_children_ids", "arch_db"], context: ALL });
await pause();
const [model] = await call("ir.model", "search_read", { domain: [["model", "=", MODEL]], fields: ["id", "name", "is_mail_thread", "is_mail_activity", "is_mail_blacklist"] });
await pause();
const form = views.find((v) => v.name === "utak.price_day_form");
const got = await call(MODEL, "get_views", { views: [[form.id, "form"]] });
const arch = String(got?.views?.form?.arch ?? "");
await pause();
const lineViews = await call("ir.ui.view", "search_read", { domain: [["model", "=", "x_price_day_line"]], fields: ["id", "name", "type", "mode", "active", "inherit_id"], context: ALL });
writeFileSync(new URL("./artifacts/s57-20261005-day-arch.json", import.meta.url), JSON.stringify({ readAt: new Date().toISOString(), model, views, rendered: arch, lineViews }, null, 2) + "\n");

console.log(`model ${MODEL} #${model.id}: is_mail_thread=${model.is_mail_thread} is_mail_activity=${model.is_mail_activity}`);
for (const v of views) console.log(`view #${v.id} ${v.name} (${v.type}, ${v.mode}, priority ${v.priority}, active ${v.active}) inherit=${JSON.stringify(v.inherit_id)} children=${JSON.stringify(v.inherit_children_ids)} ${v.arch_db.length} chars`);
for (const v of lineViews) console.log(`line view #${v.id} ${v.name} (${v.type}, ${v.mode}, active ${v.active}) inherit=${JSON.stringify(v.inherit_id)}`);
console.log(`rendered form: ${arch.length} chars`);
const outline = [...arch.matchAll(/<(form|sheet|header|chatter|div class="oe_chatter"|notebook|field name="message_ids"|field name="message_follower_ids"|field name="activity_ids")([^>]*)>/g)].map((m) => `${m.index}: <${m[1]}${m[2].slice(0, 120)}>`);
console.log(outline.join("\n"));
console.log("tail:", JSON.stringify(arch.slice(-500)));
console.log("head:", JSON.stringify(arch.slice(0, 400)));
