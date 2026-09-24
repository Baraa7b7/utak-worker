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
import { BRAND_COLORS } from "./pdf-template";

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
 * discuss.channel.message_post with body_is_html=true so Odoo:
 *   1. keeps our HTML verbatim (probe 2026-09-20: body_is_html bypasses the
 *      plaintext2html wrap that turned `<b>` into `&lt;b&gt;` on plain calls);
 *   2. broadcasts the bus.bus notification `discuss.channel/new_message`,
 *      which is what makes the message appear in the Discuss UI live without
 *      a page refresh. mail.message.create alone did neither.
 * Returns true on success. Failure is non-fatal for the caller.
 */
export async function postToChannel(
  env: Env,
  channelId: number,
  authorPartnerId: number,
  body: string,
  attachmentIds: number[] = [],
): Promise<boolean> {
  try {
    const args: Record<string, unknown> = {
      ids: [channelId],
      body,
      body_is_html: true,
      message_type: "comment",
      author_id: authorPartnerId,
      subtype_xmlid: "mail.mt_comment",
    };
    if (attachmentIds.length > 0) {
      args.attachment_ids = attachmentIds;
    }
    await call(env, "discuss.channel", "message_post", args);
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

// -------------------------------------------------------------
// Ingest — the single funnel every inbound Meta message flows through.
// -------------------------------------------------------------

export type InboundRoute = "team" | "supplier" | "customer" | "new" | "owner";

export interface IngestResult {
  /** last-4 tail of the sender, for the [inbox] log line. */
  fromTail: string;
  /** Resolved partner id, or null if the mirror failed to create one. */
  partnerId: number | null;
  /** Resolved partner display name (may be empty for a brand-new row). */
  partnerName: string;
  /** How we categorized the sender. */
  route: InboundRoute;
  /** true when the Discuss mirror + x_wa_message log both succeeded. */
  mirrored: boolean;
  /** Populated when mirrored=false; short reason for the [inbox] line. */
  skip?: string;
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
 * 2026-09-20 (cover) — visual marker prepended to every bot-authored echo so
 * Baraa can tell an automatic reply from his own manual replies at a glance.
 * The green left-border + cream background are best-effort — Odoo's Discuss
 * HTML sanitizer sometimes strips inline styles; when it does, the "🤖 آلي"
 * prefix in the text still marks the row and the badge column on
 * x_wa_message keeps the same distinction machine-readable.
 *
 * 2026-09-24 (contrast) — the box sets its own text colour too. Without it the
 * text inherited Discuss's theme colour: #111827 in light mode, but #E4E4E4 in
 * dark mode — pale grey on the cream box, ~1.2:1. Ink on paper is ~16:1 in
 * both themes, since neither colour comes from the theme any more. Odoo's
 * style whitelist (mail.message.body) keeps background-color and color and
 * drops border-left. Echoes posted before this keep their stored style: Odoo
 * refuses mail.message write to the API user (403, only the author may edit).
 */
export const AUTO_STYLE =
  `border-left: 3px solid ${BRAND_COLORS.primary}; background-color: ${BRAND_COLORS.bgPage}; ` +
  `color: ${BRAND_COLORS.ink}; padding: 4px 8px; margin: 0;`;

export function autoLabelHtml(bodyText: string, templateLabel?: string): string {
  const prefix = templateLabel
    ? `🤖 آلي · ${escapeHtml(templateLabel)}`
    : "🤖 آلي";
  const escapedBody = escapeHtml(bodyText ?? "").replace(/\n/g, "<br/>");
  return `<p style="${AUTO_STYLE}"><strong>${prefix}</strong><br/>${escapedBody}</p>`;
}

/**
 * Post an echo of a successfully-sent outbound WhatsApp message into the
 * recipient's Discuss channel, authored as UTAK بوت.
 *
 * `body` is treated as plain text and wrapped in HTML with the "🤖 آلي"
 * prefix. `partnerName` is only used when the channel has to be created
 * lazily.
 */
export async function echoOutbound(
  env: Env,
  partnerId: number,
  partnerName: string,
  body: string,
  templateLabel?: string,
): Promise<void> {
  if (!partnerId || !body) return;
  const channelId = await ensureInboxChannel(env, partnerId, partnerName);
  if (!channelId) return;
  const bot = await getBotPartnerId(env);
  if (!bot) {
    console.warn("[wa-inbox] echoOutbound: UTAK بوت partner missing — run apply script");
    return;
  }
  await postToChannel(env, channelId, bot, autoLabelHtml(body, templateLabel));
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
// Ingest — the sole entry point every inbound Meta message uses.
//
// Resolves the sender partner in priority team → supplier → customer → new,
// stamps x_wa_message with x_source='inbound', posts the mirror into the
// contact's Discuss channel, and returns a small result the caller uses to
// print a single [inbox] console line. Every failure is contained: the
// customer bot MUST continue on the caller's own path even if the mirror
// bookkeeping fails.
// -------------------------------------------------------------

/** Redact a phone-like string to its last 4 digits, prefixed with "…". */
export function phoneTail(s: string): string {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  return d ? `…${d.slice(-4)}` : "(none)";
}

export async function ingestInbound(
  env: Env,
  m: InboundForInbox & { from: string; profileName?: string; metaTimestamp?: string },
  looked?: {
    team?: { id: number; name: string } | null;
    supplier?: { id: number; name: string } | null;
    customer?: { id: number; name: string } | null;
  },
): Promise<IngestResult> {
  const fromTail = phoneTail(m.from);
  const ownerDigits = (env.OWNER_WHATSAPP || "").replace(/[^0-9]/g, "");
  const fromDigits = m.from.replace(/[^0-9]/g, "");
  const isOwner = Boolean(ownerDigits && fromDigits && ownerDigits === fromDigits);
  // 2026-09-20 (fix) — the owner short-circuit used to return early with
  // mirrored=false. That made Baraa's own test messages invisible in the
  // inbox even though the mirror was the whole point. We now proceed through
  // the same lookup+mirror path; `route` is still reported as "owner" so
  // callers that want to skip customer-bot routing can, but the Discuss
  // channel receives the message like any other partner.

  // Team → supplier → customer → new. Passed-in matches let the caller
  // reuse a Promise.all it did for other reasons; we still fall back to
  // fresh lookups on miss.
  let route: InboundRoute = "new";
  let matched: { id: number; name: string } | null = null;
  const lTeam = looked?.team ?? null;
  const lSupplier = looked?.supplier ?? null;
  const lCustomer = looked?.customer ?? null;
  if (lTeam) { matched = { id: lTeam.id, name: lTeam.name }; route = "team"; }
  else if (lSupplier) { matched = { id: lSupplier.id, name: lSupplier.name }; route = "supplier"; }
  else if (lCustomer) { matched = { id: lCustomer.id, name: lCustomer.name }; route = "customer"; }

  if (!matched) {
    // Fall back to fresh lookups (a caller that already did Promise.all
    // passes them in via `looked` and skips this branch).
    try {
      const { findTeamMemberByWhatsApp, findSupplierByWhatsApp, findCustomerByWhatsApp } =
        await import("./odoo");
      const [team, sup, cus] = await Promise.all([
        findTeamMemberByWhatsApp(env, m.from).catch(() => null),
        findSupplierByWhatsApp(env, m.from).catch(() => null),
        findCustomerByWhatsApp(env, m.from).catch(() => null),
      ]);
      if (team) { matched = { id: team.id, name: team.name }; route = "team"; }
      else if (sup) { matched = { id: sup.id, name: sup.name }; route = "supplier"; }
      else if (cus) { matched = { id: cus.id, name: cus.name }; route = "customer"; }
    } catch (e) {
      console.warn("[inbox ingest] lookup failed:", (e as Error).message);
    }
  }

  // Auto-create if still unmatched. This is a real customer partner (never
  // a team member), stamped `customer` role — see findOrCreateCustomer for
  // the audit trail.
  if (!matched) {
    try {
      const { findOrCreateCustomer } = await import("./odoo");
      const created = await findOrCreateCustomer(env, m.from, m.profileName ?? "");
      matched = { id: created.id, name: created.name || m.profileName || m.from };
      route = "new";
    } catch (e) {
      const skip = `partner-create: ${(e as Error).message}`;
      return { fromTail, partnerId: null, partnerName: "", route: "new", mirrored: false, skip };
    }
  }

  // Owner override: if this is Baraa's own personal number, report route
  // as "owner" so the caller's customer-bot routing skips it, even though
  // the mirror still runs.
  if (isOwner) route = "owner";

  // 2026-09-20 (fix) — record Meta's own timestamp for the sender BEFORE the
  // mirror so the 24h-window check can trust it even if x_wa_message row
  // creation fails downstream. The Meta timestamp is unix seconds as a
  // string. Fallback to now() if Meta didn't send one (very rare).
  const metaMs = parseMetaTimestampMs(m.metaTimestamp) ?? Date.now();
  try {
    await env.MSG_DEDUP.put(kvLastInboundTs(matched.id), String(metaMs), {
      expirationTtl: LAST_INBOUND_TTL,
    });
  } catch (e) {
    console.warn("[inbox ingest] KV write last_in_ts failed:", (e as Error).message);
  }

  // Log x_wa_message with source='inbound'. Best-effort; a KV / Odoo hiccup
  // must not stop the mirror below.
  const bodyForLog =
    m.text ||
    (m.media
      ? `[${m.type}:${m.media.id}${m.media.filename ? ` ${m.media.filename}` : ""}]`
      : "") ||
    (m.location ? "[location]" : "") ||
    `[${m.type}]`;
  const kind: "text" | "template" | "document" | "button_reply" =
    m.type === "interactive" || m.type === "button"
      ? "button_reply"
      : (m.media && m.type !== "audio") ? "document" : "text";
  try {
    const { logWaMessage } = await import("./wa-message-send");
    await logWaMessage(env, {
      partnerId: matched.id,
      direction: "in",
      kind,
      body: bodyForLog,
      metaMessageId: m.wamid,
      status: "received",
      source: "inbound",
      metaTimestampMs: metaMs,
    });
  } catch (e) {
    console.warn("[inbox ingest] logWaMessage failed:", (e as Error).message);
  }

  // Mirror to Discuss
  try {
    await mirrorInbound(env, {
      partnerId: matched.id,
      partnerName: matched.name,
      wamid: m.wamid,
      type: m.type,
      text: m.text,
      location: m.location,
      media: m.media,
    });
    return { fromTail, partnerId: matched.id, partnerName: matched.name, route, mirrored: true };
  } catch (e) {
    return {
      fromTail,
      partnerId: matched.id,
      partnerName: matched.name,
      route,
      mirrored: false,
      skip: `mirror: ${(e as Error).message}`,
    };
  }
}

// -------------------------------------------------------------
// 24h window — KV state + Meta timestamp
// -------------------------------------------------------------

/** KV key holding the unix-ms timestamp of the last inbound Meta message per partner. */
export function kvLastInboundTs(partnerId: number): string {
  return `wa_inbox:last_in_ts:${partnerId}`;
}
const LAST_INBOUND_TTL = 25 * 60 * 60; // 25h so a fresh inbound still fits inside the 24h window

/**
 * Parse a Meta webhook `timestamp` (unix seconds as string) into unix ms in
 * UTC. Returns null if the value is missing or not a positive number.
 */
export function parseMetaTimestampMs(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Meta docs say the value is unix seconds. Accept ms too (n > 1e12) for
  // safety, so a caller passing already-converted ms still gets it right.
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
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
 * Sources (in order, first that yields a fresh unix-ms wins the compare):
 *   1. KV `wa_inbox:last_in_ts:<partnerId>` — Meta's own timestamp for the
 *      most recent inbound, written by ingestInbound. This is the primary
 *      source because it reflects Meta's own clock, in UTC, and never lags
 *      behind Odoo write latency.
 *   2. x_wa_message with x_direction='in' — the audit tab in Odoo. Uses
 *      x_processed_at (Meta timestamp, set by logWaMessage on inbound) with
 *      create_date as a legacy fallback for pre-fix rows.
 *   3. x_message_analysis.x_created_at — classifier records; kept for
 *      backward compat with prior conversations that never hit x_wa_message.
 *   4. mail.message on the partner's Discuss channel authored by the partner
 *      themselves — the mirror row. Safety net so a channel with visible
 *      inbounds is never wrongly reported closed.
 * All comparisons in UTC unix ms. A read failure on a source is treated as
 * "no evidence" (never as "closed"), so one failing lookup does not lock the
 * user out when another source has the answer.
 */
export async function isInside24hWindow(env: Env, partnerId: number): Promise<boolean> {
  if (!partnerId) return false;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let latest = 0;

  // (1) KV — the fastest and most accurate source.
  try {
    const raw = await env.MSG_DEDUP.get(kvLastInboundTs(partnerId));
    if (raw) {
      const t = Number(raw);
      if (Number.isFinite(t) && t > 0) latest = Math.max(latest, t);
    }
  } catch (e) {
    console.warn("[wa-inbox] window read KV failed", (e as Error).message);
  }
  if (latest > cutoff) return true;

  // (2) x_wa_message.x_processed_at (Meta timestamp), fallback to create_date.
  try {
    const rows = await call<Array<{ create_date: string; x_processed_at: string | false }>>(
      env,
      "x_wa_message",
      "search_read",
      {
        domain: [["x_partner_id", "=", partnerId], ["x_direction", "=", "in"]],
        fields: ["create_date", "x_processed_at"],
        order: "create_date desc",
        limit: 1,
      },
    );
    const r = rows[0];
    const src = (typeof r?.x_processed_at === "string" && r.x_processed_at) || r?.create_date;
    if (src) {
      const t = Date.parse(String(src).replace(" ", "T") + "Z");
      if (Number.isFinite(t)) latest = Math.max(latest, t);
    }
  } catch (e) {
    console.warn("[wa-inbox] window read x_wa_message failed", (e as Error).message);
  }
  if (latest > cutoff) return true;

  // (3) x_message_analysis.
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
  if (latest > cutoff) return true;

  // (4) mail.message on the partner's Discuss channel authored by the partner
  //     themselves (safety net for pre-fix conversations where the mirror
  //     ran but no x_wa_message row was ever written).
  try {
    const rows = await call<Array<{ date: string }>>(env, "mail.message", "search_read", {
      domain: [
        ["model", "=", "discuss.channel"],
        ["author_id", "=", partnerId],
        ["message_type", "=", "comment"],
      ],
      fields: ["date"],
      order: "date desc",
      limit: 1,
    });
    if (rows[0]?.date) {
      const t = Date.parse(String(rows[0].date).replace(" ", "T") + "Z");
      if (Number.isFinite(t)) latest = Math.max(latest, t);
    }
  } catch (e) {
    console.warn("[wa-inbox] window read mail.message failed", (e as Error).message);
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
