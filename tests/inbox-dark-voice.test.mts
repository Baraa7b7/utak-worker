// WhatsApp inbox in Odoo, 2026-09-25 (STATUS § 28):
//   (أ) no fixed colour in any message body the worker writes — every text
//       inherits the Discuss theme, light or dark;
//   (ب) inbound media reach Odoo whole: bytes in `raw` (saas~19.4 dropped
//       `datas`, which left every voice note empty and crashed the player),
//       an empty / short / not-kept upload is never left behind.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/inbox-dark-voice.test.mts

import {
  AUTO_STYLE, autoLabelHtml, echoFailure, echoOutbound, hasFixedColor, mirrorInbound,
  postToChannel, restyleAutoEcho, stripFixedColors, textToHtml, attachMetaMedia,
} from "../src/wa-inbox.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(detail ? `${label} — ${detail}` : label); console.log(`  ✗ ${label}${detail ? " (" + detail + ")" : ""}`); }
}

// ---------- fake Meta + Odoo ----------
type Call = { model: string; method: string; body: any };
let calls: Call[] = [];
let metaMedia: { mime_type: string; file_size?: number } = { mime_type: "audio/ogg" };
let mediaBytes = new Uint8Array(0);
let storedSize: (sent: number) => number = (n) => n;
const LOOKASIDE = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1";

globalThis.fetch = (async (input: unknown, init: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://graph.facebook.com/")) {
    return new Response(JSON.stringify({ url: LOOKASIDE, ...metaMedia }), { status: 200 });
  }
  if (url === LOOKASIDE) return new Response(mediaBytes, { status: 200 });
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`unexpected fetch ${url}`);
  const body = init?.body ? JSON.parse(init.body) : {};
  calls.push({ model: m[1], method: m[2], body });
  const key = `${m[1]}.${m[2]}`;
  let out: unknown = true;
  if (key === "ir.attachment.create") out = [777];
  else if (key === "ir.attachment.read") {
    const sent = calls.find((c) => c.model === "ir.attachment" && c.method === "create")?.body?.vals_list?.[0]?.raw ?? "";
    out = [{ id: 777, file_size: storedSize(Buffer.from(sent, "base64").length) }];
  } else if (key === "discuss.voice.metadata.create") out = [5];
  else if (m[2] === "create") out = [999];
  else if (m[2] === "search_read" || m[2] === "read") out = [];
  return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

function makeEnv(): any {
  const store = new Map<string, string>([
    ["wa_inbox:channel_for_partner:49", "32"],
    ["wa_inbox:bot_partner_id", "42"],
  ]);
  return {
    ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: "K",
    META_ACCESS_TOKEN: "T", META_GRAPH_VERSION: "v22.0", OWNER_WHATSAPP: "+966505154962",
    MSG_DEDUP: { async get(k: string) { return store.get(k) ?? null; }, async put(k: string, v: string) { store.set(k, v); }, async delete(k: string) { store.delete(k); } },
  };
}
const posts = () => calls.filter((c) => c.model === "discuss.channel" && c.method === "message_post").map((c) => c.body);
const reset = () => { calls = []; metaMedia = { mime_type: "audio/ogg" }; mediaBytes = new Uint8Array(0); storedSize = (n) => n; };
const textOf = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "");

// Odoo saas~19.4 odoo/tools/mail.py _Cleaner._style_whitelist (+ border-<side>-<attr>).
const ODOO_STYLE_WHITELIST = new Set([
  "font-size", "font-family", "font-weight", "font-style", "background-color", "color", "text-align",
  "line-height", "letter-spacing", "text-transform", "text-decoration", "opacity",
  "float", "vertical-align", "display", "object-fit", "direction",
  "padding", "padding-top", "padding-left", "padding-bottom", "padding-right",
  "margin", "margin-top", "margin-left", "margin-bottom", "margin-right", "white-space",
  "background-image", "background-position", "background-size", "background-repeat", "background-origin",
  "border", "border-color", "border-radius", "border-style", "border-width", "border-top", "border-bottom",
  "height", "width", "max-width", "min-width", "min-height",
  "border-collapse", "border-spacing", "caption-side", "empty-cells", "table-layout",
  ...["top", "bottom", "left", "right"].flatMap((p) => ["style", "color", "width", "left-radius", "right-radius"].map((a) => `border-${p}-${a}`)),
]);

// The stored body of mail.message 2464 (channel 32), as Odoo keeps it today.
const STORED_2464 = '<p style="background-color:#F7F5F0; padding:4px 8px; margin:0"><strong>🤖 آلي</strong><br>السلام عليكم أستاذ أبو محمد،<br><br>شكراً لكم على اقتراح الموعدين. سيتم التواصل معكم من قِبل الفريق المختص لتأكيد الموعد المناسب والتفاصيل الأخرى قريباً.<br><br>نقدّر تواصلكم معنا 🌷</p>';

console.log("inbox-dark-voice tests\n");

// ================================================================ 1
console.log("[1] AUTO_STYLE: no colour, only what Odoo keeps, in Odoo's own form");
{
  const decls = AUTO_STYLE.split(";").map((d) => d.trim()).filter(Boolean);
  assert("no colour / background / hex in AUTO_STYLE", !/color|background|#|rgb|hsl/i.test(AUTO_STYLE), AUTO_STYLE);
  assert("every property survives Odoo's style whitelist", decls.every((d) => ODOO_STYLE_WHITELIST.has(d.split(":")[0])), decls.join(" | "));
  assert("stored form «prop:value; prop:value» (what we post is what Odoo keeps)", AUTO_STYLE === decls.join("; ") && decls.every((d) => /^[a-z-]+:[^ ]/.test(d)));
  assert("start-side bar (right, RTL UI) marks the echo without a colour", /border-right-style:solid/.test(AUTO_STYLE) && /border-right-width:\d+px/.test(AUTO_STYLE));
  assert("no border-left shorthand (Odoo drops it)", !/border-left\s*:/.test(AUTO_STYLE));
  const html = autoLabelHtml("سطر\nسطر 2", "customer_welcome");
  assert("autoLabelHtml keeps the «🤖 آلي» text mark", html.includes("<strong>🤖 آلي · customer_welcome</strong>"));
  assert("autoLabelHtml has no fixed colour", !hasFixedColor(html), html);
}

// ================================================================ 2
console.log("\n[2] hasFixedColor / stripFixedColors");
{
  assert("detects the 09-20 cream box", hasFixedColor(STORED_2464));
  assert("detects the 09-24 ink colour", hasFixedColor('<p style="color: #1A1815; padding: 4px">x</p>'));
  assert("detects a coloured border shorthand", hasFixedColor('<p style="border-left: 3px solid #1E5A41">x</p>'));
  assert("detects a named colour", hasFixedColor("<span style='color:red'>x</span>"));
  assert("detects <font color>", hasFixedColor('<font color="#ff0000">x</font>'));
  assert("detects rgb()", hasFixedColor('<p style="background: rgb(1,2,3)">x</p>'));
  assert("plain text and AUTO_STYLE pass", !hasFixedColor(`<p style="${AUTO_STYLE}">x</p>`) && !hasFixedColor("<p>color: red</p>"));
  const s = stripFixedColors(STORED_2464);
  assert("strip removes the background, keeps padding/margin", s.startsWith('<p style="padding:4px 8px; margin:0">'), s.slice(0, 60));
  assert("strip keeps every character of the text", textOf(s) === textOf(STORED_2464));
  assert("strip drops an empty style attribute", stripFixedColors('<p style="color:#000">x</p>') === "<p>x</p>");
  assert("strip removes <font color>", stripFixedColors('<font color="#f00">x</font>') === "<font>x</font>");
  const typed = '<p>&lt;p style="color:red"&gt;مرحبا</p>';
  assert("escaped text is not markup: not flagged", !hasFixedColor(typed));
  assert("escaped text is not markup: never rewritten", stripFixedColors(typed) === typed);
}

// ================================================================ 3
console.log("\n[3] every body the worker posts into Odoo is colour-free");
{
  reset();
  const env = makeEnv();
  const base = { partnerId: 49, partnerName: "ابو محمد الوصابي", wamid: "wamid.X" };
  await mirrorInbound(env, { ...base, type: "text", text: 'مرحبا <p style="color:red">x</p>' });
  await mirrorInbound(env, { ...base, type: "location", location: { latitude: 24.7, longitude: 46.7, name: "المحل" } });
  await mirrorInbound(env, { ...base, type: "interactive", text: "تأكيد الطلب" });
  await mirrorInbound(env, { ...base, type: "reaction" });
  mediaBytes = new Uint8Array([1, 2, 3]); metaMedia = { mime_type: "image/jpeg", file_size: 3 };
  await mirrorInbound(env, { ...base, type: "image", media: { id: "m1" }, text: "صورة" });
  mediaBytes = new Uint8Array(0);
  await mirrorInbound(env, { ...base, type: "document", media: { id: "m2" } });
  await mirrorInbound(env, { ...base, type: "audio", media: { id: "m3", voice: true } });
  await echoOutbound(env, 49, "ابو محمد", "رد آلي\nسطر", "customer_welcome");
  await echoOutbound(env, 49, "ابو محمد", "رد آلي");
  await echoFailure(env, 49, "ابو محمد", "Meta 131049");
  await postToChannel(env, 32, 42, STORED_2464);
  const bodies = posts().map((b) => String(b.body));
  assert("11 bodies posted", bodies.length === 11, String(bodies.length));
  const bad = bodies.filter(hasFixedColor);
  assert("none pins a colour", bad.length === 0, bad.join(" || "));
  assert("inbound text is escaped, never markup", bodies[0].includes("&lt;p style=\"color:red\"&gt;"));
  assert("postToChannel strips a coloured body on the way in", bodies[10].startsWith('<p style="padding:4px 8px; margin:0">'), bodies[10].slice(0, 50));
  assert("echo keeps the «🤖 آلي» mark and the start-side bar", bodies[7].startsWith(`<p style="${AUTO_STYLE}"><strong>🤖 آلي · customer_welcome</strong>`));
  assert("textToHtml is style-free", !/style=/.test(textToHtml("a\nb")));
}

// ================================================================ 4
console.log("\n[4] restyleAutoEcho — existing echoes: the style changes, not a word");
{
  const after = restyleAutoEcho(STORED_2464);
  assert("an old echo is restyled", after !== null);
  assert("to AUTO_STYLE", after!.startsWith(`<p style="${AUTO_STYLE}"><strong>🤖 آلي</strong>`));
  assert("text identical, character for character", textOf(after!) === textOf(STORED_2464));
  const noStyle = (h: string) => h.replace(/ style="[^"]*"/, "");
  assert("only the style attribute differs", noStyle(after!) === noStyle(STORED_2464));
  assert("no fixed colour after", !hasFixedColor(after!));
  assert("idempotent: a current echo is left alone", restyleAutoEcho(after!) === null);
  assert("an inbound message is not touched", restyleAutoEcho("<p>الخميس 15.10.2026</p>") === null);
  assert("a failure note is not touched", restyleAutoEcho("<p>⚠️ ما انرسلت: Meta 131049</p>") === null);
  assert("a styled paragraph without the mark is not touched", restyleAutoEcho('<p style="color:red">x</p>') === null);
  const labelled = '<p style="background-color:#F7F5F0; padding:4px 8px; margin:0"><strong>🤖 آلي · customer_welcome</strong><br>📋 قالب: utak_v2_welcome (ابو محمد الوصابي)</p>';
  assert("a template echo is restyled too", restyleAutoEcho(labelled) === labelled.replace('background-color:#F7F5F0; padding:4px 8px; margin:0', AUTO_STYLE));
}

// ================================================================ 5
console.log("\n[5] media upload — bytes in raw, verified, never left empty");
{
  reset();
  const env = makeEnv();
  mediaBytes = new Uint8Array(Array.from({ length: 18837 }, (_, i) => i % 251));
  metaMedia = { mime_type: "audio/ogg", file_size: 18837 };
  const up = await attachMetaMedia(env, "1432266335518091", 32, "audio/ogg; codecs=opus");
  const create = calls.find((c) => c.model === "ir.attachment" && c.method === "create")!.body.vals_list[0];
  assert("uploaded", up?.attachmentId === 777);
  assert("bytes go in raw (base64)", Buffer.from(create.raw, "base64").equals(Buffer.from(mediaBytes)));
  assert("no datas (saas~19.4 drops it → empty file)", !("datas" in create));
  assert("mimetype and name kept", create.mimetype === "audio/ogg; codecs=opus" && create.name === "1432266335518091.ogg");
  assert("stored size read back", calls.some((c) => c.model === "ir.attachment" && c.method === "read"));
  assert("nothing removed", !calls.some((c) => c.method === "unlink"));

  reset();
  metaMedia = { mime_type: "audio/ogg", file_size: 0 };
  assert("empty download → null", (await attachMetaMedia(makeEnv(), "e", 32)) === null);
  assert("… and no attachment created", !calls.some((c) => c.method === "create"));

  reset();
  mediaBytes = new Uint8Array(100); metaMedia = { mime_type: "audio/ogg", file_size: 18837 };
  assert("short download (100 of 18837) → null", (await attachMetaMedia(makeEnv(), "s", 32)) === null);
  assert("… and no attachment created", !calls.some((c) => c.method === "create"));

  reset();
  mediaBytes = new Uint8Array(500); metaMedia = { mime_type: "audio/ogg", file_size: 500 };
  storedSize = () => 0;
  assert("Odoo kept 0 bytes → null", (await attachMetaMedia(makeEnv(), "z", 32)) === null);
  const un = calls.find((c) => c.model === "ir.attachment" && c.method === "unlink");
  assert("… and the broken attachment is removed", un?.body?.ids?.[0] === 777);
}

// ================================================================ 6
console.log("\n[6] voice note → voice player only on a whole file; else a text line, no broken attachment");
{
  reset();
  const env = makeEnv();
  mediaBytes = new Uint8Array(14625).fill(7); metaMedia = { mime_type: "audio/ogg", file_size: 14625 };
  await mirrorInbound(env, { partnerId: 49, partnerName: "ابو محمد", wamid: "w", type: "audio", media: { id: "3284731155049953", mime_type: "audio/ogg; codecs=opus", voice: true } });
  const voice = calls.find((c) => c.model === "discuss.voice.metadata" && c.method === "create");
  const p = posts()[0];
  assert("voice metadata on the uploaded attachment", voice?.body?.vals_list?.[0]?.attachment_id === 777);
  assert("posted with the attachment", Array.isArray(p?.attachment_ids) && p.attachment_ids[0] === 777);
  const order = calls.map((c) => `${c.model}.${c.method}`);
  assert("upload → read back → voice → post, in that order",
    order.indexOf("ir.attachment.create") < order.indexOf("ir.attachment.read")
    && order.indexOf("ir.attachment.read") < order.indexOf("discuss.voice.metadata.create")
    && order.indexOf("discuss.voice.metadata.create") < order.indexOf("discuss.channel.message_post"));

  reset();
  mediaBytes = new Uint8Array(14625).fill(7); metaMedia = { mime_type: "audio/ogg", file_size: 14625 };
  storedSize = () => 0;
  await mirrorInbound(makeEnv(), { partnerId: 49, partnerName: "ابو محمد", wamid: "w", type: "audio", media: { id: "x", voice: true } });
  assert("not kept → no voice metadata", !calls.some((c) => c.model === "discuss.voice.metadata"));
  assert("… a text line instead", posts().length === 1 && String(posts()[0].body).includes("[audio]") && !posts()[0].attachment_ids);
  assert("… and the empty attachment is removed", calls.some((c) => c.model === "ir.attachment" && c.method === "unlink"));
}

console.log(`\ninbox-dark-voice: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
