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
// The switch was made in two phases (2026-10-08): for under thirty minutes the worker accepted the token of
// before too, while Odoo's 24 actions were rewritten; this file is phase 3 — that token is refused, and
// nothing here reads it. A later rotation: scripts/s67-20261008-token.mjs --which=hook.

import type { Env } from "./config";

/** A hook secret shorter than this is not a secret: nothing is accepted. */
export const HOOK_SECRET_MIN = 32;

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

/** Does this token open the routes of Odoo's buttons? */
export function hookTokenOk(env: Env, provided: string): boolean {
  const secret = hookSecret(env);
  return secret !== "" && tokensEqual(provided, secret);
}

/** The routes this secret gates: every `/odoo/hook/*`, and the two sends Odoo's quotation buttons make. */
export function isHookGated(pathname: string): boolean {
  return pathname.startsWith("/odoo/hook/") || pathname === "/internal/quotation-wa-send" || pathname === "/internal/sale-quotation-wa-send";
}
