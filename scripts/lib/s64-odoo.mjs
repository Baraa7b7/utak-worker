// § 64 (2026-10-07) — «💬 المحادثات» by date, the worker's «📈 تاريخ الأسعار» page and § 62 د's leftovers, as data:
// one source for scripts/s64-20261007-odoo.mjs (which writes it to the tenant) and tests/s64-*.test.mts.
//
//   1  «💬 المحادثات»: the WhatsApp conversations (discuss.channel with x_wa_partner_id) as ONE list grouped the way a
//      chat sidebar is: 📌 المثبّتة ← اليوم ← أمس ← آخر 7 أيام ← آخر 30 يوماً ← أقدم, the newest message first in each.
//      Five fields on the channel; a NEW automation on mail.message (the inbox's own #12 and its action #979 are not
//      touched) keeps them with every message, in or out; a scheduled action at 00:05 Riyadh moves the groups on.
//      The days are RIYADH's (UTC+3, no daylight saving), never UTC's.
//   2  «📈 تاريخ الأسعار»: the menu opens the WORKER's page (src/price-history.ts) in a new tab through a one-use
//      ticket (§ 62 د's x_preview_ticket) — no fixed secret. Odoo's own chart stays as «🔢 جدول الأسعار», pivot first.
//   3  § 62 د's leftovers: «التعبئة» as text on a sale order's line (x_pack_text), the old «تنزيل PDF (UTAK)» button
//      off, a request recalculated when «الأسعار في العرض» / «شكل العرض» changes, used tickets archived (x_active).
//
// Odoo runs the Python below (saas~19.4: no custom module, no JS): the PURE part of it — the day, the group, the
// time label, the preview — is run as it is under python3 by tests/s64-chats.test.mts against its JS twin here.

import * as S62 from "./s62-odoo.mjs";
import * as S62D from "./s62d-odoo.mjs";

export const PROD_HOST = S62.PROD_HOST;
const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;

// ================================================================ 1: «💬 المحادثات»
export const CHANNEL_MODEL = "discuss.channel";
export const MESSAGE_MODEL = "mail.message";
/** The groups, in the order the list shows them: the keys sort as the list must (Odoo orders a group by its key). */
export const BUCKETS = [["1_pinned", "📌 المثبّتة"], ["2_today", "اليوم"], ["3_yesterday", "أمس"], ["4_week", "آخر 7 أيام"], ["5_month", "آخر 30 يوماً"], ["6_older", "أقدم"]];
export const PREVIEW_MAX = 80;
export const ATTACHMENT_PREVIEW = "📎 مرفق";
export const RIYADH_HOURS = 3;
export const CHANNEL_FIELDS = [
  { name: "x_pinned", ttype: "boolean", field_description: "مثبّتة", help: "محادثة مثبّتة تبقى في أول «💬 المحادثات» مهما قدمت آخر رسالة فيها." },
  { name: "x_last_msg_at", ttype: "datetime", field_description: "آخر رسالة", help: "وقت آخر رسالة في المحادثة (واردة أو صادرة). تكتبه أتمتة «💬 المحادثات»." },
  { name: "x_last_msg_preview", ttype: "char", field_description: "مقتطف آخر رسالة", help: `أول ${PREVIEW_MAX} حرفاً من آخر رسالة؛ وسائط بلا نص = «${ATTACHMENT_PREVIEW}».` },
  { name: "x_date_bucket", ttype: "selection", selection: sel(BUCKETS), field_description: "المجموعة", help: "مجموعة المحادثة في «💬 المحادثات» بيوم الرياض: المثبّتة، اليوم، أمس، آخر 7 أيام، آخر 30 يوماً، أقدم. تُحسب مع كل رسالة، ويومياً 00:05." },
  { name: "x_last_msg_label", ttype: "char", field_description: "الوقت", help: "وقت آخر رسالة كما تعرضه القائمة: الساعة إن كانت اليوم، والتاريخ إن كانت قبله (بتوقيت الرياض)." },
];

/**
 * The pure part, as Odoo runs it (`datetime` is the module Odoo gives a server action). The datetimes are naive UTC,
 * as Odoo keeps them. A message later than `now` (a clock's drift) is today's.
 */
export const PY_PURE = `def wa_day(moment):
    return (moment + datetime.timedelta(hours=${RIYADH_HOURS})).date()

def wa_bucket(last, now, pinned):
    if pinned:
        return '1_pinned'
    if not last:
        return '6_older'
    days = (wa_day(now) - wa_day(last)).days
    if days <= 0:
        return '2_today'
    if days == 1:
        return '3_yesterday'
    if days <= 7:
        return '4_week'
    if days <= 30:
        return '5_month'
    return '6_older'

def wa_label(last, now):
    if not last:
        return ''
    local = last + datetime.timedelta(hours=${RIYADH_HOURS})
    if (wa_day(now) - wa_day(last)).days <= 0:
        return local.strftime('%H:%M')
    return local.strftime('%Y-%m-%d')

def wa_preview(text, has_attachment):
    text = ' '.join((text or '').split())
    if has_attachment and (not text or text.startswith('📎')):
        return '${ATTACHMENT_PREVIEW}'
    if len(text) > ${PREVIEW_MAX}:
        text = text[:${PREVIEW_MAX - 1}].rstrip() + '…'
    return text
`;

// ---- the JS twin of PY_PURE (the dry-run's counts, and the test's reference)
const RIYADH_MS = RIYADH_HOURS * 3600_000;
/** Odoo's UTC «YYYY-MM-DD HH:MM:SS» → ms; NaN when it is not one. */
export const odooMs = (s) => (typeof s === "string" && s ? Date.parse(`${s.replace(" ", "T")}Z`) : NaN);
/** The Riyadh day of a moment, as a count of days. */
export const riyadhDay = (ms) => Math.floor((ms + RIYADH_MS) / 86400_000);
export function bucketOf(lastMs, nowMs, pinned) {
  if (pinned) return "1_pinned";
  if (!Number.isFinite(lastMs)) return "6_older";
  const days = riyadhDay(nowMs) - riyadhDay(lastMs);
  return days <= 0 ? "2_today" : days === 1 ? "3_yesterday" : days <= 7 ? "4_week" : days <= 30 ? "5_month" : "6_older";
}
export function labelOf(lastMs, nowMs) {
  if (!Number.isFinite(lastMs)) return "";
  const local = new Date(lastMs + RIYADH_MS).toISOString();
  return riyadhDay(nowMs) - riyadhDay(lastMs) <= 0 ? local.slice(11, 16) : local.slice(0, 10);
}
export function previewOf(text, hasAttachment) {
  // Python's str.split(): any run of whitespace
  let t = String(text ?? "").split(/\s+/u).filter(Boolean).join(" ");
  if (hasAttachment && (!t || t.startsWith("📎"))) return ATTACHMENT_PREVIEW;
  // Python counts code points, not UTF-16 units
  const cp = [...t];
  if (cp.length > PREVIEW_MAX) t = cp.slice(0, PREVIEW_MAX - 1).join("").trimEnd() + "…";
  return t;
}

/** What counts as a conversation's message: a comment (in or out, the worker's line or Baraa's reply) — not «غادر القناة». */
export const MESSAGE_DOMAIN = [["model", "=", CHANNEL_MODEL], ["message_type", "=", "comment"]];
export const MESSAGE_ORDER = "date desc, id desc";

/**
 * Every new message of a WhatsApp conversation: its time, its preview, and the group «اليوم» (a pinned one stays
 * pinned). A message older than the one the conversation already shows (a backfilled one) changes nothing. NEVER
 * stops the message itself: any trouble here is logged and swallowed.
 */
export const ON_MESSAGE_CODE = `${PY_PURE}
try:
    if record.model == '${CHANNEL_MODEL}' and record.message_type == 'comment' and record.res_id:
        channel = env['${CHANNEL_MODEL}'].sudo().browse(record.res_id).exists()
        if channel and channel.x_wa_partner_id:
            now = datetime.datetime.now()
            last = record.date or now
            if not channel.x_last_msg_at or last >= channel.x_last_msg_at:
                channel.write({
                    'x_last_msg_at': last,
                    'x_last_msg_preview': wa_preview(record.preview, bool(record.attachment_ids)) or False,
                    'x_date_bucket': wa_bucket(last, now, channel.x_pinned),
                    'x_last_msg_label': wa_label(last, now) or False,
                })
except Exception as e:
    log('utak.wa_chats.on_message: %s' % e, level='error')
`;
/** The whole list again from each conversation's last message: the 00:05 pass, and the first fill. Writes what changed only. */
export const RECOMPUTE_CODE = `${PY_PURE}
now = datetime.datetime.now()
Message = env['${MESSAGE_MODEL}'].sudo()
for channel in env['${CHANNEL_MODEL}'].sudo().with_context(active_test=False).search([('x_wa_partner_id', '!=', False)]):
    msg = Message.search([('model', '=', '${CHANNEL_MODEL}'), ('res_id', '=', channel.id), ('message_type', '=', 'comment')], order='${MESSAGE_ORDER}', limit=1)
    last = msg.date if msg else False
    vals = {
        'x_last_msg_at': last,
        'x_last_msg_preview': (wa_preview(msg.preview, bool(msg.attachment_ids)) if msg else '') or False,
        'x_date_bucket': wa_bucket(last, now, channel.x_pinned),
        'x_last_msg_label': wa_label(last, now) or False,
    }
    changed = dict((k, v) for k, v in vals.items() if (channel[k] or False) != v)
    if changed:
        channel.write(changed)
`;
/** «📌 تثبيت / إلغاء»: the conversation changes its place at once. */
export const PIN_CODE = `${PY_PURE}
now = datetime.datetime.now()
for channel in records.sudo():
    pinned = not channel.x_pinned
    channel.write({'x_pinned': pinned, 'x_date_bucket': wa_bucket(channel.x_last_msg_at, now, pinned)})
`;
/** «فتح»: the conversation itself, in Discuss. */
export const OPEN_CODE = `action = {
    'type': 'ir.actions.client',
    'tag': 'mail.action_discuss',
    'params': {'active_id': '${CHANNEL_MODEL}_%s' % record.id},
}`;
export const CHAT_ACTIONS = {
  onMessage: { name: "utak.wa_chats.on_message", model: MESSAGE_MODEL, code: ON_MESSAGE_CODE },
  pin: { name: "utak.wa_chats.pin", model: CHANNEL_MODEL, code: PIN_CODE },
  open: { name: "utak.wa_chats.open", model: CHANNEL_MODEL, code: OPEN_CODE },
};
export const CHAT_AUTOMATION = { name: "wa_chats.on_message", model: MESSAGE_MODEL, trigger: "on_create", filter_domain: `[("model", "=", "${CHANNEL_MODEL}"), ("message_type", "=", "comment")]` };
/** The daily pass: 00:05 in Riyadh = 21:05 UTC of the day before. */
export const CHAT_CRON = { name: "UTAK: 💬 المحادثات — مجموعات التاريخ (00:05 الرياض)", model: CHANNEL_MODEL, code: RECOMPUTE_CODE, utcTime: "21:05:00", riyadhTime: "00:05", interval_number: 1, interval_type: "days" };
/** The next 21:05:00 UTC strictly after `nowMs`, as Odoo keeps a datetime. */
export function nextCronCall(nowMs) {
  const d = new Date(nowMs);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 5, 0);
  if (t <= nowMs) t += 86400_000;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

export const CHAT_MENU_ID = 565;
export const CHAT_MENU_OLD_ACTION = "ir.actions.client,110"; // Odoo's own Discuss, on «All inboxes»
export const VIEW_CHAT_LIST = "utak.wa_chats.list";
export const VIEW_CHAT_SEARCH = "utak.wa_chats.search";
export const CHAT_WINDOW = { name: "💬 المحادثات", domain: "[('x_wa_partner_id', '!=', False)]", context: "{'search_default_g_bucket': 1}", view_mode: "list" };
/** One list, grouped by «المجموعة» with its groups open; a row opens the conversation itself in Discuss. */
export const chatListArch = (a) => `<list string="💬 المحادثات" create="0" delete="0" edit="0" import="0" export_xlsx="0" expand="1" default_order="x_last_msg_at desc" action="${a.open}" type="action">
  <field name="x_date_bucket" column_invisible="1"/>
  <field name="x_last_msg_at" column_invisible="1"/>
  <field name="x_wa_partner_id" string="العميل"/>
  <field name="x_last_msg_preview" string="المقتطف"/>
  <field name="x_last_msg_label" string="الوقت"/>
  <field name="x_pinned" string="📌" widget="boolean" readonly="1"/>
  <button name="${a.pin}" type="action" string="📌 تثبيت" invisible="x_pinned"/>
  <button name="${a.pin}" type="action" string="📌 إلغاء" invisible="not x_pinned"/>
  <button name="${a.open}" type="action" string="فتح" class="btn-primary"/>
</list>`;
export const CHAT_SEARCH_ARCH = `<search string="💬 المحادثات">
  <field name="name" string="الاسم أو الرقم" filter_domain="['|', '|', '|', ('name', 'ilike', self), ('x_wa_partner_id.name', 'ilike', self), ('x_wa_partner_id.x_whatsapp_number', 'ilike', self), ('x_wa_partner_id.phone', 'ilike', self)]"/>
  <filter name="f_pinned" string="📌 المثبّتة" domain="[('x_pinned', '=', True)]"/>
  <separator/>
  <filter name="g_bucket" string="المجموعة" context="{'group_by': 'x_date_bucket'}"/>
</search>`;

// ================================================================ 2: «📈 تاريخ الأسعار»
export const HISTORY_MODEL = "x_price_day_line";
export const HISTORY_PATH = "/history/t/";
/** What a ticket of the page names in x_model (it names no record). */
export const HISTORY_TICKET_MODEL = HISTORY_MODEL;
export const HISTORY_MENU_ID = 588;
export const HISTORY_WINDOW_ID = 1046;
export const HISTORY_PARENT_MENU = 582;
export const HISTORY_WINDOW_NAME = "🔢 جدول الأسعار";
export const HISTORY_WINDOW_MODE = "pivot,graph,list";
export const HISTORY_TABLE_MENU = { name: "🔢 جدول الأسعار", sequence: 26 };
/** The menu's action: a one-use ticket (the database's own uuid), then the worker's address with the ticket alone. */
export const HISTORY_ACTION = {
  name: "utak.price_history.page", model: HISTORY_MODEL,
  code: `env.cr.execute("SELECT gen_random_uuid()::text")
ticket = env.cr.fetchone()[0]
env['${S62D.TICKET_MODEL}'].create({'x_name': ticket, 'x_model': '${HISTORY_TICKET_MODEL}', 'x_res_id': 0})
action = {
    'type': 'ir.actions.act_url',
    'url': 'https://${PROD_HOST}${HISTORY_PATH}' + ticket,
    'target': 'new',
}`,
};

// ================================================================ 3: § 62 د's leftovers
export const SALE_LINE_MODEL = "sale.order.line";
export const SALE_LINE_FIELDS = [
  { name: "x_pack_text", ttype: "char", field_description: "التعبئة", help: "نص التعبئة كما يُطبع في عرض السعر (مثل: 18 كيلو). يسبق «العبوة»: المطبوع = هذا النص، وإلا العبوة المختارة، وإلا عبوة المنتج الافتراضية. «📄 أصدر عرض السعر» ينسخه من الطلب الخاص." },
];
export const TICKET_MODEL = S62D.TICKET_MODEL;
export const TICKET_FIELDS = [
  { name: "x_active", ttype: "boolean", field_description: "نشط", help: "التذكرة المستعملة تُؤرشف: يطفئه الوركر عند أول فتح." },
];
/** The six tickets § 62 د's checks left (all used): archived. */
export const TICKETS_TO_ARCHIVE = [1, 2, 3, 4, 5, 6];
export const OLD_PDF_VIEW_ID = 2789;      // sale.order.form.utak_pdf_button: «تنزيل PDF (UTAK)», a link with a fixed token
export const OLD_PDF_VIEW_NAME = "sale.order.form.utak_pdf_button";
export const SALE_FORM_PARENT = S62D.SALE_FORM_PARENT;
export const VIEW_SALE_PACK = "utak.sale.order.form.pack_text";
export const SALE_PACK_PRIORITY = 46;     // after § 62 د's preview_origin_size (45)
export const SALE_PACK_ARCH = `<data>
  <xpath expr="//list[@name='sol_list']/field[@name='x_packaging_id']" position="after">
    <field name="x_pack_text" optional="show"/>
  </xpath>
</data>`;
export const QUOTE_MODEL = S62.QUOTE_MODEL;
/**
 * «وضع آخر حساب»: the mode («الأسعار في العرض») the worker last calculated the request in. The price Baraa typed is
 * THAT mode's — a line's edit does not ask Odoo for a recalculation (its ids do not change), so when the mode is
 * changed the other price of the pair may be stale or empty: the worker reads the pair the old mode's way first.
 */
export const QUOTE_FIELDS = [
  { name: "x_calc_mode", ttype: "selection", selection: sel(S62.PRICE_MODES), field_description: "وضع آخر حساب (تقني)", help: "«الأسعار في العرض» كما كان عند آخر حساب أجراه الوركر: السعر النهائي المكتوب هو سعر ذلك الوضع. يكتبه الوركر؛ لا يُعدَّل باليد." },
];
export const RECALC_HOOK_ACTION = "utak.special_quote.recalc_webhook"; // § 62's: the worker's recalc, the one «🔄 احسب» presses
/** A change of «الأسعار في العرض» or «شكل العرض»: the request's own recalc webhook, pressed for it. */
export const MODE_ACTION = {
  name: "utak.special_quote.recalc_on_mode", model: QUOTE_MODEL,
  code: `hook = env['ir.actions.server'].sudo().search([('name', '=', '${RECALC_HOOK_ACTION}')], limit=1)
if hook:
    for rec in records:
        hook.with_context(active_model='${QUOTE_MODEL}', active_id=rec.id, active_ids=[rec.id]).run()`,
};
export const MODE_AUTOMATION = { name: "utak.special_quote.recalc (on mode / layout)", model: QUOTE_MODEL, trigger: "on_write", fields: ["x_price_mode", "x_layout"] };
/** S00016's lines take «التعبئة» of SQ-0002's, line for line by their order. */
export const PACK_FILL = { sale: "S00016", quote: 2 };
