// § 67 ز (2026-10-08) — the worker's URL tokens, handled without ever showing one.
//
// Three secrets of the worker gate the routes Odoo calls with a `?token=` in the URL (scripts/s67-20261008-
// token-inventory.mjs found them, 2026-10-08):
//   pdf       SALE_PDF_DOWNLOAD_TOKEN   the browser-facing PDF links (Odoo code actions build the URL)
//   internal  INTERNAL_WEBHOOK_SECRET   /internal/quotation-issue, /internal/receipt-issue, /internal/official-doc/*
//   hook      HOOK_SECRET               /odoo/hook/*, /internal/quotation-wa-send, /internal/sale-quotation-wa-send
//             (§ 68: a secret of its own — until then ODOO_HOOK_TOKEN, whose value was the Odoo API key;
//             scripts/s68-20261008-hook-secret.mjs made the switch, in two phases)
// A token is shown only as its tag (the first 6 hex of its SHA-256): two places with the same tag carry the
// same token, and nothing can be read back from a tag.
import { createHash, randomBytes } from "node:crypto";

export const PROD_HOST = "utak-worker.utak-business.workers.dev";
export const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";

export const SECRETS = {
  pdf: { name: "SALE_PDF_DOWNLOAD_TOKEN", routes: ["/internal/sale-quotation-pdf", "/internal/invoice-pdf", "/internal/purchase-order-pdf"] },
  internal: { name: "INTERNAL_WEBHOOK_SECRET", routes: ["/internal/quotation-issue", "/internal/receipt-issue", "/internal/official-doc/"] },
  hook: { name: "HOOK_SECRET", routes: ["/odoo/hook/", "/internal/quotation-wa-send", "/internal/sale-quotation-wa-send"] },
};

export const tag = (t) => createHash("sha256").update(String(t)).digest("hex").slice(0, 6);
/** A new token: 64 hex characters (256 bits), safe in a URL as it is. */
export const newToken = () => randomBytes(32).toString("hex");

const URL_RE = /https?:\/\/(utak-worker(?:-sim)?\.[a-z0-9.-]+)(\/[A-Za-z0-9/_-]*)?/g;
const TOKEN_RE = /token=([A-Za-z0-9._~-]{8,})/;

/**
 * Every worker URL in a text with the token that follows it — in the URL itself («…?token=X&op=…») or in the
 * rest of the same line (Odoo's code actions: «…pdf?id=' + str(record.id) + '&token=X'»). The token itself is
 * returned for the caller to compare and replace: print `tag(u.token)`, never `u.token`.
 */
export function workerUrls(text) {
  const out = [];
  const s = String(text ?? "");
  for (const m of s.matchAll(URL_RE)) {
    const eol = s.indexOf("\n", m.index);
    const rest = s.slice(m.index + m[0].length, eol < 0 ? s.length : eol);
    const t = TOKEN_RE.exec(rest);
    out.push({ host: m[1].startsWith("utak-worker-sim") ? "sim" : "prod", path: m[2] ?? "/", token: t ? t[1] : null });
  }
  return out;
}

/** Which secret gates this path? */
export function secretOf(path) {
  for (const [key, s] of Object.entries(SECRETS)) if (s.routes.some((r) => (r.endsWith("/") ? path.startsWith(r) : path === r))) return key;
  return null;
}

/** `text` with every occurrence of the token `from` replaced by `to` (a token is 8+ URL-safe characters: no regex). */
export function replaceToken(text, from, to) {
  if (!from || String(from).length < 8) throw new Error("refusing to replace a token shorter than 8 characters");
  return String(text ?? "").split(from).join(to);
}

/**
 * What may be printed or logged: every known secret becomes its tag, and whatever else follows «token=»,
 * «secret=», «key=» or «Bearer » is masked whole.
 */
export function scrub(text, secrets = []) {
  let s = String(text ?? "");
  for (const x of secrets.filter((v) => v && String(v).length >= 8)) s = s.split(String(x)).join(`<tag:${tag(x)}>`);
  return s
    .replace(/((?:token|secret|key|sig)=)(?!<tag:)[^&"'\s<>)]+/gi, "$1<masked>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <masked>");
}
