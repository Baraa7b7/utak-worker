// § 45 د (2026-09-30): delete the empty draft journal entry account.move #62 — on Baraa's explicit
// permission (the § 45 order), the only record this launch deletes.
//
//   node scripts/s45-20260930-delete-move62.mjs            dry run: every check, nothing written
//   node scripts/s45-20260930-delete-move62.mjs --apply    checks → full snapshot → unlink → verify
//
// Checks (any difference = no delete): #62 is draft, has no lines and a zero total; no stored
// many2one / many2many field of any model points to it (only its own chatter: the creation note
// and its follower, which Odoo removes with it); BILL/2026/09/0004 (#60), MISC/2026/09/0002 (#61)
// and MISC/2026/09/0003 (#63) are posted and read the same before and after.
// Out: scripts/artifacts/s45-20260930-move62-snapshot.json (the record, all fields, its messages and
// followers — enough to re-create it by hand), s45-20260930-move62-report.json
import { existsSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const APPLY = process.argv.includes("--apply");
const ID = 62;
const KEEP = { 60: "BILL/2026/09/0004", 61: "MISC/2026/09/0002", 63: "MISC/2026/09/0003" };
const SNAP = new URL("./artifacts/s45-20260930-move62-snapshot.json", import.meta.url);
const log = (...a) => console.log(...a);
const problems = [];
const need = (c, what) => { if (!c) problems.push(what); log(`  ${c ? "✓" : "✗"} ${what}`); return !!c; };
const KF = ["id", "name", "state", "move_type", "date", "amount_total", "journal_id", "ref", "line_ids", "write_date"];
const keepState = async () => call("account.move", "read", { ids: Object.keys(KEEP).map(Number), fields: KF });

const [m] = await call("account.move", "search_read", { domain: [["id", "=", ID]], fields: ["id", "name", "state", "move_type", "line_ids", "amount_total", "amount_total_signed", "ref", "date", "journal_id"], context: { active_test: false } });
need(m, `account.move #${ID} exists`);
if (m) {
  need(m.state === "draft", `#${ID} is draft (${m.state})`);
  need(Array.isArray(m.line_ids) && m.line_ids.length === 0, `#${ID} has no lines (${JSON.stringify(m.line_ids)})`);
  need(Number(m.amount_total) === 0 && Number(m.amount_total_signed) === 0, `#${ID} total 0 (${m.amount_total})`);
}
const lines = await call("account.move.line", "search_count", { domain: [["move_id", "=", ID]] });
need(lines === 0, `no account.move.line on #${ID} (${lines})`);
const rel = await call("ir.model.fields", "search_read", { domain: [["relation", "=", "account.move"], ["ttype", "in", ["many2one", "many2many"]], ["store", "=", true]], fields: ["model", "name", "ttype"] });
const hits = [];
for (const f of rel) {
  const n = await call(f.model, "search_count", { domain: [[f.name, "in", [ID]]], context: { active_test: false } }).catch(() => -1);
  if (n !== 0) hits.push(`${f.model}.${f.name}: ${n}`);
}
need(hits.length === 0, `no record points to #${ID} (${rel.length} stored fields${hits.length ? `: ${hits.join(", ")}` : ""})`);
const msgs = await call("mail.message", "search_read", { domain: [["model", "=", "account.move"], ["res_id", "=", ID]], fields: ["id", "message_type", "body", "date", "author_id", "subtype_id"] });
const fols = await call("mail.followers", "search_read", { domain: [["res_model", "=", "account.move"], ["res_id", "=", ID]], fields: ["id", "partner_id"] });
const atts = await call("ir.attachment", "search_count", { domain: [["res_model", "=", "account.move"], ["res_id", "=", ID]] });
need(msgs.every((x) => x.message_type === "notification") && atts === 0, `its own chatter only: ${msgs.length} note(s), ${fols.length} follower(s), ${atts} attachment(s)`);
const keep0 = await keepState();
for (const k of keep0) need(k.name === KEEP[k.id] && k.state === "posted", `#${k.id} ${k.name} posted (${k.state}, ${k.amount_total}, ${k.date})`);
const count0 = await call("account.move", "search_count", { domain: [] });
log(`  · account.move count now ${count0}`);

if (problems.length) { log(`\n✗ ${problems.length} check(s) failed — nothing deleted`); process.exit(1); }
if (!APPLY) { log("\n✓ dry run: every check passed, nothing written. --apply deletes #62."); process.exit(0); }

// snapshot (all fields) → unlink → verify
if (existsSync(SNAP)) throw new Error("snapshot exists already — #62 was handled by an earlier run");
const [full] = await call("account.move", "read", { ids: [ID] });
writeFileSync(SNAP, JSON.stringify({ at: new Date().toISOString(), record: full, messages: msgs, followers: fols, keepBefore: keep0, countBefore: count0 }, null, 2) + "\n");
log(`  · snapshot → ${SNAP.pathname.split("/").slice(-3).join("/")}`);
await call("account.move", "unlink", { ids: [ID] });
const gone = (await call("account.move", "search_count", { domain: [["id", "=", ID]], context: { active_test: false } })) === 0;
const keep1 = await keepState();
const same = JSON.stringify(keep1.map(({ write_date, ...r }) => r)) === JSON.stringify(keep0.map(({ write_date, ...r }) => r)) && JSON.stringify(keep1.map((r) => r.write_date)) === JSON.stringify(keep0.map((r) => r.write_date));
const count1 = await call("account.move", "search_count", { domain: [] });
const msgs1 = await call("mail.message", "search_count", { domain: [["model", "=", "account.move"], ["res_id", "=", ID]] });
const report = { at: new Date().toISOString(), deleted: ID, gone, keepUnchanged: same, countBefore: count0, countAfter: count1, chatterLeft: msgs1, keepAfter: keep1 };
writeFileSync(new URL("./artifacts/s45-20260930-move62-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
log(`${gone ? "✓" : "✗"} #${ID} gone · ${same ? "✓" : "✗"} #60 / #61 / #63 unchanged (write_date too) · account.move ${count0} → ${count1} · its chatter left: ${msgs1}`);
process.exit(gone && same && count1 === count0 - 1 ? 0 : 1);
