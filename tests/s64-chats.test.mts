// § 64 [1] (2026-10-07) — «💬 المحادثات» by date (scripts/lib/s64-odoo.mjs: Odoo runs it, the worker has no part).
//
//   The WhatsApp conversations as one list in the groups of a chat sidebar — 📌 المثبّتة ← اليوم ← أمس ← آخر 7 أيام
//   ← آخر 30 يوماً ← أقدم — by RIYADH's days, the newest message first in each.
//
//   [1] the groups by Riyadh's day: midnight's two sides, yesterday, 7 and 30; a pinned one; no message
//   [2] the time the list shows (today: the hour; before it: the date) and the preview (80, «📎 مرفق»)
//   [3] ODOO'S OWN CODE (the Python of the three actions and of the scheduled action), run as it is under python3
//       against a stand-in for Odoo's records: it agrees with the JS twin case by case, a pinned conversation stays
//       pinned, an older message changes nothing, and nothing it does can stop a message
//   [4] the screen: one list grouped by «المجموعة», its columns, its buttons, its search; the menu; 00:05 Riyadh
//
// No network, no Odoo: python3 runs the code Odoo is given (datetime is the one module Odoo hands a server action).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s64-chats.test.mts

import { spawnSync } from "node:child_process";
import { assert, done } from "./s46-kit.mts";

// @ts-ignore — plain .mjs data
const L = await import("../scripts/lib/s64-odoo.mjs");

const utc = (riyadh: string): number => Date.parse(`${riyadh.replace(" ", "T")}:00+03:00`);
const odoo = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const NOW = utc("2026-10-08 00:05"); // the scheduled action's own minute: 21:05 UTC of the 7th

// ================================================================ [1]
console.log("\n[1] the groups, by Riyadh's day");
{
  const b = (last: string, now = NOW, pinned = false) => L.bucketOf(utc(last), now, pinned);
  assert("the six groups in the list's order, their keys sorting the same way", JSON.stringify(L.BUCKETS.map((x: string[]) => x[1])) === JSON.stringify(["📌 المثبّتة", "اليوم", "أمس", "آخر 7 أيام", "آخر 30 يوماً", "أقدم"])
    && JSON.stringify(L.BUCKETS.map((x: string[]) => x[0])) === JSON.stringify([...L.BUCKETS.map((x: string[]) => x[0])].sort()));
  assert("a message of 00:00 in Riyadh is today's — though UTC still calls it yesterday (21:00)", b("2026-10-08 00:00") === "2_today" && odoo(utc("2026-10-08 00:00")).startsWith("2026-10-07 21:00"));
  assert("a message of 23:59 the night before is yesterday's — though UTC puts it on the same day as now", b("2026-10-07 23:59") === "3_yesterday" && odoo(utc("2026-10-07 23:59")).slice(0, 10) === odoo(NOW).slice(0, 10));
  assert("at 02:30 in Riyadh a message of 23:10 is yesterday's (UTC: both on the 7th)", L.bucketOf(utc("2026-10-07 23:10"), utc("2026-10-08 02:30"), false) === "3_yesterday");
  assert("yesterday is one Riyadh day back, whatever the hour", b("2026-10-07 00:00") === "3_yesterday" && b("2026-10-06 23:59") === "4_week");
  assert("«آخر 7 أيام»: two to seven days back", b("2026-10-06 12:00") === "4_week" && b("2026-10-01 00:00") === "4_week" && b("2026-09-30 23:59") === "5_month");
  assert("«آخر 30 يوماً»: eight to thirty days back", b("2026-09-30 12:00") === "5_month" && b("2026-09-08 00:00") === "5_month" && b("2026-09-07 23:59") === "6_older");
  assert("«أقدم»: more than thirty days back, and a conversation with no message", b("2026-08-01 10:00") === "6_older" && L.bucketOf(NaN, NOW, false) === "6_older");
  assert("a pinned conversation is «📌 المثبّتة» whatever its last message — old, new or none", b("2026-10-08 00:01", NOW, true) === "1_pinned" && b("2026-01-01 10:00", NOW, true) === "1_pinned" && L.bucketOf(NaN, NOW, true) === "1_pinned");
  assert("a message a clock's drift ahead of now is today's", b("2026-10-08 00:07") === "2_today" && b("2026-10-08 23:00") === "2_today");
  assert("the same message moves on as the days pass: today → yesterday → week → month → older", ["2026-10-08 09:00", "2026-10-09 00:00", "2026-10-10 00:00", "2026-10-16 00:00", "2026-11-07 23:59", "2026-11-08 00:00"].map((n) => L.bucketOf(utc("2026-10-08 08:00"), utc(n), false)).join(",") === "2_today,3_yesterday,4_week,5_month,5_month,6_older");
}

// ================================================================ [2]
console.log("\n[2] the time and the preview");
{
  assert("today's message shows its hour in Riyadh (not UTC's)", L.labelOf(utc("2026-10-08 00:03"), NOW) === "00:03" && L.labelOf(utc("2026-10-07 21:15"), utc("2026-10-07 21:30")) === "21:15");
  assert("an earlier day's shows its date — Riyadh's date (01:30 of the 7th is 22:30 UTC of the 6th)", L.labelOf(utc("2026-10-07 01:30"), NOW) === "2026-10-07" && odoo(utc("2026-10-07 01:30")).startsWith("2026-10-06 22:30"));
  assert("no message: no label", L.labelOf(NaN, NOW) === "");
  const long = "ا".repeat(200);
  assert(`a preview is ${L.PREVIEW_MAX} characters at most: 79 and «…»`, L.PREVIEW_MAX === 80 && [...L.previewOf(long, false)].length === 80 && L.previewOf(long, false).endsWith("…") && L.previewOf("ا".repeat(80), false) === "ا".repeat(80));
  assert("its spaces and line breaks are one space each", L.previewOf("  السلام   عليكم\n\nشكراً\tلكم ", false) === "السلام عليكم شكراً لكم");
  assert("media with no text is «📎 مرفق»; so is media whose text is its file's name alone", L.ATTACHMENT_PREVIEW === "📎 مرفق" && L.previewOf("", true) === "📎 مرفق" && L.previewOf("   ", true) === "📎 مرفق" && L.previewOf("📎 2398224714039171.jpg", true) === "📎 مرفق");
  assert("media with a caption keeps the caption; text with no media is never «مرفق»", L.previewOf("طلب عرض سعر .pdf", true) === "طلب عرض سعر .pdf" && L.previewOf("", false) === "" && L.previewOf("📎 S00016.pdf", false) === "📎 S00016.pdf");
  assert("an emoji is one character of the eighty (never cut in half)", [...L.previewOf("🌿".repeat(100), false)].length === 80 && !/[\uD800-\uDBFF]$/.test(L.previewOf("🌿".repeat(100), false).slice(0, -1)));
}

// ================================================================ [3] Odoo's own code under python3
console.log("\n[3] Odoo's own code, as it is given to Odoo");
{
  // every (last, now, pinned) of a grid around the boundaries, and a set of texts
  const lasts = ["", "2026-10-08 00:00", "2026-10-07 23:59", "2026-10-07 00:00", "2026-10-06 23:59", "2026-10-01 00:00", "2026-09-30 23:59", "2026-09-08 00:00", "2026-09-07 23:59", "2026-08-01 10:00", "2026-10-08 13:45", "2026-10-09 02:00"];
  const nows = ["2026-10-08 00:05", "2026-10-08 02:30", "2026-10-08 23:59", "2026-10-09 00:00", "2026-11-07 12:00"];
  const buckets = lasts.flatMap((last) => nows.flatMap((now) => [false, true].map((pinned) => ({ last: last ? odoo(utc(last)) : "", now: odoo(utc(now)), pinned }))));
  const previews = [["", false], ["", true], ["   ", true], ["📎 239822.jpg", true], ["📎 S00016.pdf", false], ["طلب عرض سعر .pdf", true], ["  السلام   عليكم\n\nشكراً\tلكم ", false], ["ا".repeat(80), false], ["ا".repeat(81), false], ["كلمة ".repeat(40), false], ["🌿".repeat(100), false], ["🤖 آلي 📊 21:15 لا يوجد طلبات مؤكدة اليوم — ما تم إنشاء قائمة شراء.", false]].map(([text, att]) => ({ text, att }));
  // a stand-in for the records the actions touch: a dict with attributes, write(), exists(), sudo()
  const HARNESS = `
import datetime as _dt, json, sys
data = json.loads(sys.stdin.read())
def _t(s):
    return _dt.datetime.strptime(s, '%Y-%m-%d %H:%M:%S') if s else False
class _Now(_dt.datetime):
    at = None
    @classmethod
    def now(cls):
        return cls.at
class datetime:
    timedelta = _dt.timedelta
    datetime = _Now
class Rec(dict):
    def __getattr__(self, k):
        if k in self:
            return self[k]
        raise AttributeError(k)
    def __bool__(self):
        return bool(self.get('id'))
    def write(self, vals):
        if self.get('_fails'):
            raise ValueError('the write failed')
        self['_writes'] = self.get('_writes', 0) + 1
        self.update(vals)
    def exists(self):
        return self
    def sudo(self):
        return self
class Recs(list):
    def sudo(self):
        return self
class Model:
    def __init__(self, name):
        self.name = name
    def sudo(self):
        return self
    def with_context(self, **kw):
        return self
    def browse(self, i):
        return CHANNELS.get(i, Rec())
    def search(self, domain, order=None, limit=None):
        if self.name == 'discuss.channel':
            assert domain == [('x_wa_partner_id', '!=', False)], domain
            return Recs(c for c in CHANNELS.values() if c['x_wa_partner_id'])
        want = dict((f, v) for f, op, v in domain)
        assert want['model'] == 'discuss.channel' and want['message_type'] == 'comment' and order == 'date desc, id desc' and limit == 1, (domain, order, limit)
        found = sorted((m for m in MESSAGES if m['res_id'] == want['res_id'] and m['message_type'] == 'comment'), key=lambda m: (m['date'], m['id']))
        return found[-1] if found else Rec()
LOGGED = []
def log(message, level='info'):
    LOGGED.append([level, message])
pure = {'datetime': datetime}
exec(data['pure'], pure)
out = {'buckets': [], 'previews': [pure['wa_preview'](p['text'], p['att']) for p in data['previews']], 'runs': []}
for c in data['buckets']:
    out['buckets'].append([pure['wa_bucket'](_t(c['last']), _t(c['now']), c['pinned']), pure['wa_label'](_t(c['last']), _t(c['now']))])
for run in data['runs']:
    CHANNELS = dict((c['id'], Rec(c, x_last_msg_at=_t(c.get('x_last_msg_at') or ''))) for c in run['channels'])
    MESSAGES = [Rec(m, date=_t(m['date']), attachment_ids=m.get('attachment_ids') or []) for m in run.get('messages', [])]
    _Now.at = _t(run['now'])
    del LOGGED[:]
    scope = {'datetime': datetime, 'env': {'discuss.channel': Model('discuss.channel'), 'mail.message': Model('mail.message')}, 'log': log}
    if 'record' in run:
        scope['record'] = MESSAGES[run['record']]
    if 'records' in run:
        scope['records'] = Recs(CHANNELS[i] for i in run['records'])
        scope['record'] = scope['records'][0]
    error = None
    try:
        exec(data['codes'][run['code']], scope)
    except Exception as e:
        error = repr(e)
    out['runs'].append({'error': error, 'logged': list(LOGGED), 'action': scope.get('action'), 'channels': dict((str(i), dict((k, (v.strftime('%Y-%m-%d %H:%M:%S') if isinstance(v, _dt.datetime) else v)) for k, v in c.items())) for i, c in CHANNELS.items())})
print(json.dumps(out, ensure_ascii=False))
`;
  const chan = (id: number, more: Record<string, unknown> = {}) => ({ id, x_wa_partner_id: 100 + id, x_pinned: false, x_last_msg_at: "", x_last_msg_preview: false, x_date_bucket: false, x_last_msg_label: false, ...more });
  const msg = (id: number, res_id: number, riyadh: string, more: Record<string, unknown> = {}) => ({ id, model: "discuss.channel", message_type: "comment", res_id, date: odoo(utc(riyadh)), preview: `رسالة ${id}`, attachment_ids: [], ...more });
  const now = odoo(utc("2026-10-08 10:00"));
  const runs = [
    /* 0 */ { code: "onMessage", now, channels: [chan(1)], messages: [msg(11, 1, "2026-10-08 09:59")], record: 0 },
    /* 1 */ { code: "onMessage", now, channels: [chan(1, { x_pinned: true })], messages: [msg(11, 1, "2026-10-08 09:59")], record: 0 },
    /* 2 */ { code: "onMessage", now, channels: [chan(1, { x_last_msg_at: odoo(utc("2026-10-08 09:00")), x_last_msg_preview: "الأحدث", x_date_bucket: "2_today", x_last_msg_label: "09:00" })], messages: [msg(11, 1, "2026-10-05 08:00")], record: 0 },
    /* 3 */ { code: "onMessage", now, channels: [chan(1, { x_wa_partner_id: false })], messages: [msg(11, 1, "2026-10-08 09:59")], record: 0 },
    /* 4 */ { code: "onMessage", now, channels: [chan(1)], messages: [msg(11, 1, "2026-10-08 09:59", { message_type: "notification", preview: "غادر القناة" })], record: 0 },
    /* 5 */ { code: "onMessage", now, channels: [chan(1)], messages: [msg(11, 1, "2026-10-08 09:59", { model: "sale.order" })], record: 0 },
    /* 6 */ { code: "onMessage", now, channels: [chan(1, { _fails: true })], messages: [msg(11, 1, "2026-10-08 09:59")], record: 0 },
    /* 7 */ { code: "onMessage", now, channels: [chan(1)], messages: [msg(11, 1, "2026-10-08 09:59", { preview: "", attachment_ids: [5] })], record: 0 },
    /* 8 */ { code: "onMessage", now, channels: [chan(1)], messages: [msg(11, 7, "2026-10-08 09:59")], record: 0 },
    /* 9 */ { code: "recompute", now, channels: [chan(1), chan(2, { x_pinned: true }), chan(3), chan(4, { x_wa_partner_id: false }), chan(5, { x_last_msg_at: odoo(utc("2026-10-08 09:30")), x_last_msg_preview: "رسالة 51", x_date_bucket: "2_today", x_last_msg_label: "09:30" })],
      messages: [msg(11, 1, "2026-10-07 23:59"), msg(12, 1, "2026-10-07 10:00"), msg(13, 1, "2026-10-08 09:00", { message_type: "notification", preview: "غادر القناة" }), msg(21, 2, "2026-09-01 10:00"), msg(41, 4, "2026-10-08 09:00"), msg(51, 5, "2026-10-08 09:30")] },
    /* 10 */ { code: "pin", now, channels: [chan(1, { x_last_msg_at: odoo(utc("2026-10-07 12:00")), x_date_bucket: "3_yesterday" })], records: [1] },
    /* 11 */ { code: "pin", now, channels: [chan(1, { x_pinned: true, x_last_msg_at: odoo(utc("2026-10-07 12:00")), x_date_bucket: "1_pinned" })], records: [1] },
    /* 12 */ { code: "open", now, channels: [chan(44)], records: [44] },
  ];
  const py = spawnSync("python3", ["-c", HARNESS], { input: JSON.stringify({ pure: L.PY_PURE, codes: { onMessage: L.ON_MESSAGE_CODE, recompute: L.RECOMPUTE_CODE, pin: L.PIN_CODE, open: L.OPEN_CODE }, buckets, previews, runs }), encoding: "utf8" });
  assert("python3 runs the code Odoo is given (python3 must be on this machine: the test runs Odoo's own Python)", py.status === 0 && !!py.stdout, String(py.stderr || py.error || "").slice(-600));
  const out = py.status === 0 ? JSON.parse(py.stdout) : { buckets: [], previews: [], runs: [] };
  const offB = buckets.map((c, i) => [c, out.buckets[i], [L.bucketOf(L.odooMs(c.last), L.odooMs(c.now), c.pinned), L.labelOf(L.odooMs(c.last), L.odooMs(c.now))]]).filter(([, py2, js]) => JSON.stringify(py2) !== JSON.stringify(js));
  assert(`the group and the label: Odoo's code and its JS twin agree on every one of ${buckets.length} cases around the boundaries`, buckets.length === 120 && out.buckets.length === 120 && !offB.length, JSON.stringify(offB.slice(0, 2)));
  const offP = previews.map((p, i) => [p.text, out.previews[i], L.previewOf(p.text, p.att)]).filter(([, a, b]) => a !== b);
  assert(`the preview: they agree on every one of ${previews.length} texts`, out.previews.length === previews.length && !offP.length, JSON.stringify(offP.slice(0, 2)));
  const ch = (i: number, id = 1) => out.runs[i]?.channels?.[String(id)] ?? {};
  assert("a new message: its time, its preview, «اليوم» and its hour on the conversation — one write", ch(0).x_last_msg_at === odoo(utc("2026-10-08 09:59")) && ch(0).x_last_msg_preview === "رسالة 11" && ch(0).x_date_bucket === "2_today" && ch(0).x_last_msg_label === "09:59" && ch(0)._writes === 1 && out.runs[0].error === null);
  assert("a pinned conversation takes the message and STAYS «📌 المثبّتة»", ch(1).x_date_bucket === "1_pinned" && ch(1).x_last_msg_label === "09:59" && ch(1).x_pinned === true);
  assert("a message OLDER than the one the conversation shows (a backfilled one) changes nothing", ch(2)._writes === undefined && ch(2).x_last_msg_preview === "الأحدث" && ch(2).x_date_bucket === "2_today");
  assert("an internal conversation (no WhatsApp partner) is never written", ch(3)._writes === undefined && ch(3).x_date_bucket === false);
  assert("«غادر القناة» (a notification) is not a message of the conversation; nor is a comment on another model", ch(4)._writes === undefined && ch(5)._writes === undefined);
  assert("TROUBLE IN IT NEVER STOPS THE MESSAGE: a write that fails is logged as an error and swallowed", out.runs[6].error === null && out.runs[6].logged.length === 1 && out.runs[6].logged[0][0] === "error" && String(out.runs[6].logged[0][1]).startsWith("utak.wa_chats.on_message:"));
  assert("media with no text: «📎 مرفق»", ch(7).x_last_msg_preview === "📎 مرفق");
  assert("a message of a conversation that is not there: nothing, and no error", out.runs[8].error === null && ch(8)._writes === undefined && out.runs[8].logged.length === 0);
  const r = out.runs[9];
  assert("the 00:05 pass: every WhatsApp conversation from its LAST COMMENT (not «غادر القناة»)", r?.error === null && ch(9, 1).x_last_msg_at === odoo(utc("2026-10-07 23:59")) && ch(9, 1).x_date_bucket === "3_yesterday" && ch(9, 1).x_last_msg_label === "2026-10-07" && ch(9, 1).x_last_msg_preview === "رسالة 11");
  assert("…a pinned one keeps its group and gets its message's date; one with no message is «أقدم» with nothing shown", ch(9, 2).x_date_bucket === "1_pinned" && ch(9, 2).x_last_msg_label === "2026-09-01" && ch(9, 3).x_date_bucket === "6_older" && ch(9, 3).x_last_msg_at === false && ch(9, 3).x_last_msg_label === false);
  assert("…an internal conversation is not touched, and one already right is not written again", ch(9, 4)._writes === undefined && ch(9, 4).x_date_bucket === false && ch(9, 5)._writes === undefined && ch(9, 1)._writes === 1);
  assert("«📌 تثبيت»: pinned, and in «📌 المثبّتة» at once", ch(10).x_pinned === true && ch(10).x_date_bucket === "1_pinned");
  assert("«📌 إلغاء»: back to the group of its last message's day", ch(11).x_pinned === false && ch(11).x_date_bucket === "3_yesterday");
  assert("«فتح»: Odoo's own Discuss on THIS conversation", JSON.stringify(out.runs[12]?.action) === JSON.stringify({ type: "ir.actions.client", tag: "mail.action_discuss", params: { active_id: "discuss.channel_44" } }));
  assert("the three actions and the scheduled action carry the SAME pure part, and the message's action wraps all it does in a try", [L.ON_MESSAGE_CODE, L.RECOMPUTE_CODE, L.PIN_CODE].every((c: string) => c.startsWith(L.PY_PURE)) && L.CHAT_CRON.code === L.RECOMPUTE_CODE
    && L.ON_MESSAGE_CODE.slice(L.PY_PURE.length).trimStart().startsWith("try:") && L.ON_MESSAGE_CODE.includes("except Exception as e:"));
}

// ================================================================ [4]
console.log("\n[4] the screen, the menu, the hour");
{
  const arch = String(L.chatListArch({ open: 1061, pin: 1060 }));
  assert("ONE list, grouped by «المجموعة» (the action's context) with its groups open, the newest message first", L.CHAT_WINDOW.view_mode === "list" && L.CHAT_WINDOW.context === "{'search_default_g_bucket': 1}" && arch.includes('expand="1"') && arch.includes('default_order="x_last_msg_at desc"')
    && L.CHAT_SEARCH_ARCH.includes(`<filter name="g_bucket" string="المجموعة" context="{'group_by': 'x_date_bucket'}"/>`));
  const cols = [...arch.matchAll(/<field name="(x_[a-z_]+)"([^>]*)\/>/g)].filter((m) => !m[2].includes("column_invisible")).map((m) => `${m[1]}|${/string="([^"]*)"/.exec(m[2])?.[1]}`);
  assert("its columns: العميل، المقتطف، الوقت، 📌", JSON.stringify(cols) === JSON.stringify(["x_wa_partner_id|العميل", "x_last_msg_preview|المقتطف", "x_last_msg_label|الوقت", "x_pinned|📌"]), JSON.stringify(cols));
  assert("«📌 تثبيت» on a conversation that is not pinned, «📌 إلغاء» on one that is — the same action; «فتح», and a row's own click, open it in Discuss", arch.includes(`<button name="1060" type="action" string="📌 تثبيت" invisible="x_pinned"/>`) && arch.includes(`<button name="1060" type="action" string="📌 إلغاء" invisible="not x_pinned"/>`)
    && arch.includes(`<button name="1061" type="action" string="فتح"`) && arch.includes(`action="1061" type="action"`));
  assert("the list writes nothing of its own: no create, no delete, no edit in place", ["create", "delete", "edit"].every((k) => arch.includes(`${k}="0"`)));
  assert("the WhatsApp conversations alone: an internal conversation is never in it", L.CHAT_WINDOW.domain === "[('x_wa_partner_id', '!=', False)]");
  assert("the search: by the name and by the number (the conversation's name, the contact's name, his WhatsApp number, his phone)", ["('name', 'ilike', self)", "('x_wa_partner_id.name', 'ilike', self)", "('x_wa_partner_id.x_whatsapp_number', 'ilike', self)", "('x_wa_partner_id.phone', 'ilike', self)"].every((t) => L.CHAT_SEARCH_ARCH.includes(t)) && L.CHAT_SEARCH_ARCH.includes("f_pinned"));
  assert("the menu #565 takes the list; what it opened (Odoo's Discuss, #110) is what a rollback gives back", L.CHAT_MENU_ID === 565 && L.CHAT_MENU_OLD_ACTION === "ir.actions.client,110");
  assert("a NEW automation of its own on every new comment of a conversation — never the inbox's #12 or its action #979", L.CHAT_AUTOMATION.name === "wa_chats.on_message" && L.CHAT_AUTOMATION.trigger === "on_create" && L.CHAT_AUTOMATION.model === "mail.message"
    && L.CHAT_AUTOMATION.filter_domain === `[("model", "=", "discuss.channel"), ("message_type", "=", "comment")]` && L.CHAT_ACTIONS.onMessage.name !== "wa_inbox.reply_webhook");
  assert("the scheduled action: every day at 21:05 UTC = 00:05 in Riyadh", L.CHAT_CRON.utcTime === "21:05:00" && L.CHAT_CRON.riyadhTime === "00:05" && L.CHAT_CRON.interval_number === 1 && L.CHAT_CRON.interval_type === "days"
    && new Date(Date.parse("2026-10-07T21:05:00Z") + L.RIYADH_HOURS * 3600_000).toISOString().slice(0, 16) === "2026-10-08T00:05");
  assert("its first run is the NEXT 00:05 Riyadh — tonight's when it is made before it, tomorrow's from that minute on", L.nextCronCall(utc("2026-10-07 21:30")) === "2026-10-07 21:05:00" && L.nextCronCall(utc("2026-10-08 00:04")) === "2026-10-07 21:05:00" && L.nextCronCall(utc("2026-10-08 00:05")) === "2026-10-08 21:05:00" && L.nextCronCall(utc("2026-10-08 03:00")) === "2026-10-08 21:05:00");
  assert("the five fields, by their names and their titles", JSON.stringify(L.CHANNEL_FIELDS.map((f: any) => [f.name, f.ttype, f.field_description])) === JSON.stringify([["x_pinned", "boolean", "مثبّتة"], ["x_last_msg_at", "datetime", "آخر رسالة"], ["x_last_msg_preview", "char", "مقتطف آخر رسالة"], ["x_date_bucket", "selection", "المجموعة"], ["x_last_msg_label", "char", "الوقت"]]));
}

done();
