// § 68 أ (2026-10-08) — the token of Odoo's buttons is its OWN secret.
//
// Until § 68 the token in the URL of every Odoo button and automation that calls the worker (`/odoo/hook/*`,
// and the two `/internal/*-wa-send` routes) was the Odoo API key itself: a leaked link was a leaked key with
// the user's whole access. HOOK_SECRET is a random secret of its own, set by scripts/s68-20261008-hook-secret.mjs,
// and it is the ONLY thing a token that arrives is ever compared with:
//   • too short, or not set: nothing is accepted (a worker without its secret answers 401 to every button);
//   • equal to the Odoo API key: nothing is accepted — the two must never be one again. That is a check of the
//     worker's own settings; no token that arrives is compared with the key.
//
// PHASE 1 (this file, for at most thirty minutes): the 24 Odoo actions still carry the token of before while
// they are rewritten, so that token (ODOO_HOOK_TOKEN) is accepted too — only inside the window that ends at
// HOOK_LEGACY_UNTIL (epoch ms, given to `wrangler deploy --var`), and only while that end is at most thirty
// minutes away: a far end does not open a long window, and with none there is no window at all. The deploy
// of phase 3 removes this path, the variable and the secret of before.

import type { Env } from "./config";

/** A hook secret shorter than this is not a secret: nothing is accepted. */
export const HOOK_SECRET_MIN = 32;
/** PHASE 1 — the token of before is accepted for this long at most. */
export const LEGACY_WINDOW_MS = 30 * 60_000;

/** Equal, in time that does not depend on where they differ. */
export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The secret a button's token is compared with — or "" when the worker's settings give none it may use. */
export function hookSecret(env: Env): string {
  const s = String(env.HOOK_SECRET ?? "");
  if (s.length < HOOK_SECRET_MIN) return "";
  if (s === env.ODOO_API_KEY) return "";
  return s;
}

/** PHASE 1 — is the window of the token of before open at `now`? */
export function legacyWindowOpen(env: Env, now: number): boolean {
  // not set, or not a time: NaN — and nothing is before NaN
  const until = Number(env.HOOK_LEGACY_UNTIL ?? Number.NaN);
  return now < until && until - now <= LEGACY_WINDOW_MS;
}

/** Does this token open the routes of Odoo's buttons? */
export function hookTokenOk(env: Env, provided: string, now: number = Date.now()): boolean {
  const secret = hookSecret(env);
  if (secret && tokensEqual(provided, secret)) return true;
  // PHASE 1 — the token of before, inside its window alone
  const before = String(env.ODOO_HOOK_TOKEN ?? "");
  return before.length > 0 && legacyWindowOpen(env, now) && tokensEqual(provided, before);
}

/** The routes this secret gates: every `/odoo/hook/*`, and the two sends Odoo's quotation buttons make. */
export function isHookGated(pathname: string): boolean {
  return pathname.startsWith("/odoo/hook/") || pathname === "/internal/quotation-wa-send" || pathname === "/internal/sale-quotation-wa-send";
}
