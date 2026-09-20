// WhatsApp Discuss Inbox — 2026-09-20.
//
// One private discuss.channel per contact partner. Baraa is the only human
// member. Inbound WhatsApp messages are mirrored into the channel as-the-
// contact; system echoes (outbound sends, template deliveries, failure
// notices) are posted as the "UTAK بوت" partner so the automation on
// mail.message can filter them out.
//
// This module never throws to its callers. The webhook handler wraps every
// call in try/catch + ctx.waitUntil, and every KV / Odoo failure ends up as
// a console.warn — the customer bot must never break because the mirror
// bookkeeping tripped.

import type { Env } from "./config";
import { call } from "./odoo";

// KV keys — 1h TTL so we still recover from an accidental partner rename or
// bot-partner rewrite without needing a full worker restart.
const KV_BOT_PARTNER = "wa_inbox:bot_partner_id";
const KV_BARAA_PARTNER = "wa_inbox:baraa_partner_id";
const kvChannel = (pid: number) => `wa_inbox:channel_for_partner:${pid}`;
const KV_TTL = 3600;

// -------------------------------------------------------------
// Author resolution
// -------------------------------------------------------------

async function getBaraaPartnerId(env: Env): Promise<number> {
  const cached = await env.MSG_DEDUP.get(KV_BARAA_PARTNER);
  if (cached) return Number(cached);
  const users = await call<Array<{ id: number; partner_id: [number, string] | false }>>(
    env,
    "res.users",
    "search_read",
    {
      domain: [["login", "=", env.ODOO_LOGIN]],
      fields: ["id", "partner_id"],
      limit: 1,
    },
  );
  if (!users.length || !users[0].partner_id) {
    throw new Error(`[wa-inbox] admin partner not found for ${env.ODOO_LOGIN}`);
  }
  const pid = users[0].partner_id[0];
  try { await env.MSG_DEDUP.put(KV_BARAA_PARTNER, String(pid), { expirationTtl: KV_TTL }); } catch { /* ignore */ }
  return pid;
}

/** Returns UTAK بوت partner id, or null if the setup script did not create it. */
export async function getBotPartnerId(env: Env): Promise<number | null> {
  const cached = await env.MSG_DEDUP.get(KV_BOT_PARTNER);
  if (cached) return Number(cached);
  const rows = await call<Array<{ id: number }>>(env, "res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id"],
    limit: 1,
  });
  if (!rows.length) return null;
  const pid = rows[0].id;
  try { await env.MSG_DEDUP.put(KV_BOT_PARTNER, String(pid), { expirationTtl: KV_TTL }); } catch { /* ignore */ }
  return pid;
}

// -------------------------------------------------------------
// Channel resolution
// -------------------------------------------------------------

/**
 * Ensure a discuss.channel exists for `partnerId`. Returns the channel id, or
 * null if the record cannot be created (surfaced to the caller which then
 * logs a warning and continues).
 *
 * Idempotent by partner.x_wa_channel_id, then by KV cache, and creates the
 * channel + writes the link atomically enough that a lost race just wastes a
 * throw-away channel row (unlinked on rerun via ensureChannelDeduplicate).
 */
export async function ensureInboxChannel(
  env: Env,
  partnerId: number,
  partnerName: string,
): Promise<number | null> {
  if (!partnerId) return null;

  // KV cache
  try {
    const cached = await env.MSG_DEDUP.get(kvChannel(partnerId));
    if (cached) return Number(cached);
  } catch { /* ignore */ }

  // Existing link
  try {
    const rows = await call<Array<{ id: number; x_wa_channel_id: [number, string] | false }>>(
      env,
      "res.partner",
      "read",
      { ids: [partnerId], fields: ["id", "x_wa_channel_id"] },
    );
    const link = rows[0]?.x_wa_channel_id;
    if (link && Array.isArray(link) && typeof link[0] === "number") {
      try { await env.MSG_DEDUP.put(kvChannel(partnerId), String(link[0]), { expirationTtl: KV_TTL }); } catch { /* ignore */ }
      return link[0];
    }
  } catch (e) {
    console.warn("[wa-inbox] read partner failed", (e as Error).message);
    return null;
  }

  // Create
  const baraa = await getBaraaPartnerId(env);
  const displayName = (partnerName ?? "").trim() || `#${partnerId}`;
  let channelId: number;
  try {
    // channel_partner_ids on discuss.channel is a computed m2m that Odoo 19
    // rejects on direct write ("cannot use 'list' as a set element"), so we
    // create the channel first, then add Baraa as a discuss.channel.member
    // in a follow-up call.
    const created = await call<number[]>(env, "discuss.channel", "create", {
      vals_list: [{
        name: `واتساب · ${displayName}`,
        channel_type: "group",
        x_wa_partner_id: partnerId,
      }],
    });
    channelId = created[0];
  } catch (e) {
    console.warn("[wa-inbox] create channel failed", (e as Error).message);
    return null;
  }

  // Add Baraa as a member (with all-messages notifications so his Odoo
  // mobile pings on every incoming). Non-fatal if it fails — the channel
  // still exists and mirror posts continue.
  try {
    await call(env, "discuss.channel.member", "create", {
      vals_list: [{
        channel_id: channelId,
        partner_id: baraa,
        custom_notifications: "all",
      }],
    });
  } catch (e) {
    console.warn("[wa-inbox] member create failed", (e as Error).message);
  }

  try {
    await call(env, "res.partner", "write", {
      ids: [partnerId],
      vals: { x_wa_channel_id: channelId },
    });
  } catch (e) {
    console.warn("[wa-inbox] write partner.x_wa_channel_id failed", (e as Error).message);
    // non-fatal — the reverse link still works via x_wa_partner_id
  }

  try { await env.MSG_DEDUP.put(kvChannel(partnerId), String(channelId), { expirationTtl: KV_TTL }); } catch { /* ignore */ }
  return channelId;
}

// -------------------------------------------------------------
// Message posting
// -------------------------------------------------------------

/**
 * Post `body` (HTML) to `channelId` as `authorPartnerId`. Uses
 * mail.message.create directly instead of discuss.channel.message_post
 * because message_post's body arg is TEXT (Odoo escapes and re-wraps in
 * <p>), which would double-wrap our already-HTML bodies and turn the tags
 * into visible &lt;p&gt; text. Direct create stores the HTML verbatim,
 * matching what backfilled rows look like.
 * Returns true on success.
 */
export async function postToChannel(
  env: Env,
  channelId: number,
  authorPartnerId: number,
  body: string,
  attachmentIds: number[] = [],
): Promise<boolean> {
  try {
    const vals: Record<string, unknown> = {
      model: "discuss.channel",
      res_id: channelId,
      message_type: "comment",
      author_id: authorPartnerId,
      body,
    };
    if (attachmentIds.length > 0) {
      // m2m command form Odoo 19 JSON-2 accepts for attachment_ids on create.
      vals.attachment_ids = attachmentIds.map((id) => [4, id]);
    }
    await call(env, "mail.message", "create", { vals_list: [vals] });
    return true;
  } catch (e) {
    console.warn("[wa-inbox] postToChannel failed", (e as Error).message);
    return false;
  }
}

/** Wrap a plain string in a minimal HTML paragraph (body is html on mail.message). */
export function textToHtml(text: string): string {
  const escaped = (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Preserve line breaks
  return `<p>${escaped.replace(/\n/g, "<br/>")}</p>`;
}

// -------------------------------------------------------------
// Meta media → ir.attachment upload
// -------------------------------------------------------------

interface UploadedAttachment {
  attachmentId: number;
  filename: string;
  mimetype: string;
}

/**
 * Download a Meta media object by id, upload it as ir.attachment attached to
 * the given discuss.channel, and return the new attachment id.
 * Best-effort — a failure returns null and the caller falls back to text.
 */
export async function attachMetaMedia(
  env: Env,
  mediaId: string,
  channelId: number,
  overrideMime?: string,
  filenameHint?: string,
): Promise<UploadedAttachment | null> {
  try {
    const gv = env.META_GRAPH_VERSION || "v20.0";
    // 1) get URL + mime
    const metaRes = await fetch(`https://graph.facebook.com/${gv}/${mediaId}`, {
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
    });
    if (!metaRes.ok) {
      console.warn("[wa-inbox] media meta fetch failed", metaRes.status);
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) return null;
    const mime = overrideMime || meta.mime_type || "application/octet-stream";
    // 2) fetch bytes
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
    });
    if (!binRes.ok) {
      console.warn("[wa-inbox] media bytes fetch failed", binRes.status);
      return null;
    }
    const bytes = new Uint8Array(await binRes.arrayBuffer());
    const b64 = bytesToBase64(bytes);
    const filename = filenameHint || defaultFilename(mime, mediaId);
    // 3) upload as ir.attachment on the discuss.channel
    const created = await call<number[]>(env, "ir.attachment", "create", {
      vals_list: [{
        name: filename,
        datas: b64,
        mimetype: mime,
        res_model: "discuss.channel",
        res_id: channelId,
      }],
    });
    return { attachmentId: created[0], filename, mimetype: mime };
  } catch (e) {
    console.warn("[wa-inbox] attachMetaMedia failed", (e as Error).message);
    return null;
  }
}

/** After uploading a voice-audio attachment, mark it as a Discuss voice
 * message so the player shows in the channel instead of a download link. */
export async function markAttachmentAsVoice(
  env: Env,
  attachmentId: number,
): Promise<boolean> {
  try {
    await call(env, "discuss.voice.metadata", "create", {
      vals_list: [{ attachment_id: attachmentId }],
    });
    return true;
  } catch (e) {
    console.warn("[wa-inbox] voice metadata create failed", (e as Error).message);
    return false;
  }
}

function defaultFilename(mime: string, id: string): string {
  const ext =
    mime.startsWith("image/jpeg") ? "jpg" :
    mime.startsWith("image/") ? mime.split("/")[1] :
    mime.startsWith("audio/ogg") ? "ogg" :
    mime.startsWith("audio/mpeg") ? "mp3" :
    mime.startsWith("audio/") ? mime.split("/")[1] :
    mime.startsWith("video/") ? mime.split("/")[1] :
    mime === "application/pdf" ? "pdf" :
    "bin";
  return `${id}.${ext}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

// -------------------------------------------------------------
// Inbound mirroring
// -------------------------------------------------------------

// The bare minimum shape we need from a normalized Meta payload, plus the raw
// media object for images/audio/documents. Kept local so callers don't need
// to import the Meta types.
export interface InboundForInbox {
  partnerId: number;
  partnerName: string;
  wamid: string;
  type: string;               // "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "interactive" | "button" | ...
  text?: string;              // caption / button text
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  media?: { id: string; mime_type?: string; filename?: string; voice?: boolean };
}

/**
 * Mirror one inbound WhatsApp message into the contact's Discuss channel.
 * Every branch is best-effort; the caller must call this from ctx.waitUntil
 * so a failure never blocks the customer bot.
 */
export async function mirrorInbound(env: Env, m: InboundForInbox): Promise<void> {
  const channelId = await ensureInboxChannel(env, m.partnerId, m.partnerName);
  if (!channelId) return;

  // The customer partner is the author. For "unknown" partners (created on
  // demand by findOrCreateCustomer) that maps 1:1 to the same partner row we
  // just posted an inbox for.
  const author = m.partnerId;

  if (m.type === "text" && m.text) {
    await postToChannel(env, channelId, author, textToHtml(m.text));
    return;
  }

  if (m.type === "location" && m.location) {
    const { latitude, longitude, name, address } = m.location;
    const label = [name, address].filter(Boolean).join(" — ");
    const url = `https://maps.google.com/?q=${latitude},${longitude}`;
    const body = `<p>📍 موقع${label ? " · " + escapeHtml(label) : ""}</p><p><a href="${url}" target="_blank" rel="noopener">${url}</a></p>`;
    await postToChannel(env, channelId, author, body);
    return;
  }

  if ((m.type === "interactive" || m.type === "button") && m.text) {
    await postToChannel(env, channelId, author, textToHtml(m.text));
    return;
  }

  if ((m.type === "image" || m.type === "video" || m.type === "document" || m.type === "sticker") && m.media?.id) {
    const uploaded = await attachMetaMedia(env, m.media.id, channelId, m.media.mime_type, m.media.filename);
    if (uploaded) {
      const caption = m.text ? textToHtml(m.text) : `<p>📎 ${escapeHtml(uploaded.filename)}</p>`;
      await postToChannel(env, channelId, author, caption, [uploaded.attachmentId]);
    } else {
      await postToChannel(env, channelId, author, `<p>[${escapeHtml(m.type)}] ما قدرنا نستلمه من Meta.</p>`);
    }
    return;
  }

  if (m.type === "audio" && m.media?.id) {
    const uploaded = await attachMetaMedia(env, m.media.id, channelId, m.media.mime_type ?? "audio/ogg");
    if (uploaded) {
      // Voice metadata so Discuss renders the player
      await markAttachmentAsVoice(env, uploaded.attachmentId);
      await postToChannel(env, channelId, author, "", [uploaded.attachmentId]);
    } else {
      await postToChannel(env, channelId, author, "<p>[audio] ما قدرنا نستلمه.</p>");
    }
    return;
  }

  // Unknown / unsupported
  await postToChannel(env, channelId, author, `<p>[نوع الرسالة: ${escapeHtml(m.type)}]</p>`);
}

function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// -------------------------------------------------------------
// System echoes (bot-authored)
// -------------------------------------------------------------

/**
 * Post an echo of a successfully-sent outbound WhatsApp message into the
 * recipient's Discuss channel, authored as UTAK بوت.
 *
 * `body` is treated as plain text and wrapped in HTML. `partnerName` is only
 * used when the channel has to be created lazily.
 */
export async function echoOutbound(
  env: Env,
  partnerId: number,
  partnerName: string,
  body: string,
): Promise<void> {
  if (!partnerId || !body) return;
  const channelId = await ensureInboxChannel(env, partnerId, partnerName);
  if (!channelId) return;
  const bot = await getBotPartnerId(env);
  if (!bot) {
    console.warn("[wa-inbox] echoOutbound: UTAK بوت partner missing — run apply script");
    return;
  }
  await postToChannel(env, channelId, bot, textToHtml(body));
}

/**
 * Post a "did not send" note into the recipient's Discuss channel, so Baraa
 * sees why a Discuss reply failed to reach Meta.
 */
export async function echoFailure(
  env: Env,
  partnerId: number,
  partnerName: string,
  reason: string,
): Promise<void> {
  if (!partnerId) return;
  const channelId = await ensureInboxChannel(env, partnerId, partnerName);
  if (!channelId) return;
  const bot = await getBotPartnerId(env);
  if (!bot) return;
  await postToChannel(env, channelId, bot, `<p>⚠️ ما انرسلت: ${escapeHtml(reason)}</p>`);
}

// -------------------------------------------------------------
// HTML → text (for Discuss replies)
// -------------------------------------------------------------

/**
 * Cheap HTML → plaintext for the Discuss composer output. Preserves
 * paragraph/newline structure, drops tags, unescapes the entities Discuss
 * commonly emits, and collapses excessive blank lines.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    // Block-level closers get a paragraph break; adjacent <p></p> collapse
    // safely with the /\n{3,}/ pass at the end.
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

// -------------------------------------------------------------
// 24h window check
// -------------------------------------------------------------

/**
 * Returns true iff `partnerId` has an inbound WhatsApp event newer than 24h.
 * Sources: latest x_wa_message with x_direction='in', OR latest
 * x_message_analysis.x_created_at. Any read failure defers to "closed" so we
 * do not accidentally send free-form text into a stale window.
 */
export async function isInside24hWindow(env: Env, partnerId: number): Promise<boolean> {
  if (!partnerId) return false;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let latest = 0;
  try {
    const rows = await call<Array<{ create_date: string }>>(env, "x_wa_message", "search_read", {
      domain: [["x_partner_id", "=", partnerId], ["x_direction", "=", "in"]],
      fields: ["create_date"],
      order: "create_date desc",
      limit: 1,
    });
    if (rows[0]?.create_date) {
      const t = Date.parse(rows[0].create_date.replace(" ", "T") + "Z");
      if (Number.isFinite(t)) latest = Math.max(latest, t);
    }
  } catch (e) {
    console.warn("[wa-inbox] window read x_wa_message failed", (e as Error).message);
  }
  try {
    const rows = await call<Array<{ x_created_at: string }>>(env, "x_message_analysis", "search_read", {
      domain: [["x_customer_id", "=", partnerId]],
      fields: ["x_created_at"],
      order: "x_created_at desc",
      limit: 1,
    });
    if (rows[0]?.x_created_at) {
      const t = Date.parse(rows[0].x_created_at.replace(" ", "T") + "Z");
      if (Number.isFinite(t)) latest = Math.max(latest, t);
    }
  } catch (e) {
    console.warn("[wa-inbox] window read x_message_analysis failed", (e as Error).message);
  }
  return latest > cutoff;
}

// -------------------------------------------------------------
// Inbound author gate (used by /odoo/hook/wa-inbox)
// -------------------------------------------------------------

/**
 * Given a mail.message.id from the inbox automation webhook, return the info
 * we need to decide whether Baraa's reply from Discuss should be sent out.
 * The gate is: message is on a WhatsApp-inbox channel, author is an internal
 * (share=False) user, and author is not the bot partner. Everything else
 * gets `send: false` with a short `skip` reason for logging.
 */
export interface ReplyGate {
  send: boolean;
  skip?: string;
  channelId?: number;
  partnerId?: number;
  partnerName?: string;
  partnerPhone?: string;
  body?: string;
  attachmentCount?: number;
  mailMessageId?: number;
}

export async function evaluateInboxReplyMessage(
  env: Env,
  mailMessageId: number,
): Promise<ReplyGate> {
  // 1. Read the message
  let msg: {
    id: number;
    model: string | false;
    res_id: number | false;
    message_type: string | false;
    author_id: [number, string] | false;
    body: string | false;
    attachment_ids: number[];
  };
  try {
    const rows = await call<Array<typeof msg>>(env, "mail.message", "read", {
      ids: [mailMessageId],
      fields: ["id", "model", "res_id", "message_type", "author_id", "body", "attachment_ids"],
    });
    if (!rows[0]) return { send: false, skip: "message not found", mailMessageId };
    msg = rows[0];
  } catch (e) {
    return { send: false, skip: `read message: ${(e as Error).message}`, mailMessageId };
  }

  if (msg.model !== "discuss.channel" || !msg.res_id) {
    return { send: false, skip: "not on discuss.channel", mailMessageId };
  }
  if (msg.message_type !== "comment") {
    return { send: false, skip: "not a comment", mailMessageId };
  }
  if (!msg.author_id || !Array.isArray(msg.author_id)) {
    return { send: false, skip: "no author", mailMessageId };
  }

  // 2. Load channel with x_wa_partner_id
  let channel: { id: number; x_wa_partner_id: [number, string] | false };
  try {
    const rows = await call<Array<typeof channel>>(env, "discuss.channel", "read", {
      ids: [msg.res_id as number],
      fields: ["id", "x_wa_partner_id"],
    });
    if (!rows[0]) return { send: false, skip: "channel not found", mailMessageId };
    channel = rows[0];
  } catch (e) {
    return { send: false, skip: `read channel: ${(e as Error).message}`, mailMessageId };
  }

  if (!channel.x_wa_partner_id) return { send: false, skip: "channel has no wa partner", mailMessageId };
  const partnerId = channel.x_wa_partner_id[0];
  const channelId = channel.id;

  // 3. Author must be an internal user
  const bot = await getBotPartnerId(env);
  if (bot && msg.author_id[0] === bot) {
    return { send: false, skip: "author is bot", mailMessageId, channelId, partnerId };
  }
  if (msg.author_id[0] === partnerId) {
    return { send: false, skip: "author is the wa partner (inbound echo)", mailMessageId, channelId, partnerId };
  }

  // Author's linked user
  try {
    const users = await call<Array<{ id: number; share: boolean }>>(env, "res.users", "search_read", {
      domain: [["partner_id", "=", msg.author_id[0]]],
      fields: ["id", "share"],
      limit: 1,
    });
    const isInternal = users[0] && users[0].share === false;
    if (!isInternal) {
      return { send: false, skip: "author has no internal user", mailMessageId, channelId, partnerId };
    }
  } catch (e) {
    return { send: false, skip: `res.users lookup: ${(e as Error).message}`, mailMessageId, channelId, partnerId };
  }

  // 4. Read partner info
  let partner: { id: number; name: string; phone: string | false; x_whatsapp_number: string | false; x_wa_allowed: boolean };
  try {
    const rows = await call<Array<typeof partner>>(env, "res.partner", "read", {
      ids: [partnerId],
      fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_allowed"],
    });
    if (!rows[0]) return { send: false, skip: "partner not found", mailMessageId, channelId, partnerId };
    partner = rows[0];
  } catch (e) {
    return { send: false, skip: `read partner: ${(e as Error).message}`, mailMessageId, channelId, partnerId };
  }

  // Owner-guard (E.164 digit comparison)
  const ownerDigits = (env.OWNER_WHATSAPP || "").replace(/[^0-9]/g, "");
  const partnerPhone = String(partner.x_whatsapp_number || partner.phone || "");
  const partnerDigits = partnerPhone.replace(/[^0-9]/g, "");
  if (ownerDigits && partnerDigits && ownerDigits === partnerDigits) {
    return {
      send: false,
      skip: "owner-guard: partner is OWNER_WHATSAPP",
      mailMessageId,
      channelId,
      partnerId,
      partnerName: partner.name,
      partnerPhone,
    };
  }

  if (partner.x_wa_allowed === false) {
    return {
      send: false,
      skip: "partner not whatsapp-allowed",
      mailMessageId,
      channelId,
      partnerId,
      partnerName: partner.name,
      partnerPhone,
    };
  }

  const bodyText = htmlToText(msg.body || "");

  return {
    send: true,
    channelId,
    partnerId,
    partnerName: partner.name,
    partnerPhone,
    body: bodyText,
    attachmentCount: Array.isArray(msg.attachment_ids) ? msg.attachment_ids.length : 0,
    mailMessageId,
  };
}
