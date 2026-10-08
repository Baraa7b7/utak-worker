// § 67 د (2026-10-08) — what a refusal by Meta means for the gateway (src/wa-gateway.ts handleRejection).
//
// Before: any refusal but 131047 / 131049 / 131042 stopped the purpose to that number for 24 hours. On
// 2026-10-08 Meta answered 131056 — the pair's rate limit, gone in a minute — and every alert to Baraa was
// stopped for a day. Now:
//
//   class        codes                                   what the gateway does
//   window       131047                                  the window is closed; a valid session message goes back
//                                                        to the number's queue (as before)
//   template_day 131049                                  that template is not sent to that number again today
//   payment      131042                                  nothing is blocked; one alert a day (§ 46 هـ)
//   transient    131056 130429 131048 80007 4 131016     THE SAME MESSAGE again, spaced 1 → 5 → 15 minutes; no
//                133004 131057 2 1, HTTP 5xx,             block. After the third retry it is «failed» — an
//                and a refusal with no code              important alert keeps trying every 15 minutes
//   permanent    131026 131021 131051 131052 131053      the purpose is not sent to that number again
//                131008 131009 100 132000 132001 132005  automatically: 24 hours — ONE hour for a purpose of
//                132007 132012 132015 132016 132018      Baraa's own number. Never for an important alert
//                132068 131050 130472 131031 131045      (queued and tried again), a bot reply or a manual send
//                133010 190 10 200 368
//   unknown      anything else — 131000 among them       recorded «failed»; nothing is blocked and nothing is
//                («something went wrong»: Meta says it   retried (the next send of the purpose is a new attempt)
//                for a passing fault and for a message
//                it cannot take as it is built)
//
// The lists are Meta's Cloud API error codes: the ones this code base has met (131008, 131026, 131042, 131047,
// 131049, 131056, 132018) and the rest of the same two families in Meta's reference.

export const META_WINDOW_CLOSED = 131047;
export const META_TEMPLATE_DROPPED = 131049;
export const META_PAIR_RATE_LIMIT = 131056;

/** Gone by itself in minutes: the pair's or the account's rate limits, Meta's own outages. */
export const META_TRANSIENT: ReadonlySet<number> = new Set([
  131056, // (Business Account, Consumer Account) pair rate limit hit
  130429, // Cloud API throughput reached
  131048, // spam rate limit hit
  80007,  // the WhatsApp Business Account's rate limit
  4,      // API too many calls
  131016, // service unavailable
  133004, // server temporarily unavailable
  131057, // account in maintenance mode
  2,      // API service: temporary downtime
  1,      // API unknown: a request Meta could not serve
]);

/** Will fail again whenever it is sent again: the number, the message itself, the template, or the account. */
export const META_PERMANENT: ReadonlySet<number> = new Set([
  131026, // message undeliverable (the number is not on WhatsApp, or cannot receive it)
  131021, // recipient cannot be sender
  131051, // unsupported message type
  131052, // media download error
  131053, // media upload error
  131008, // required parameter is missing
  131009, // parameter value is not valid
  100,    // invalid parameter
  132000, // template param count mismatch
  132001, // template does not exist
  132005, // template hydrated text too long
  132007, // template format character policy violated
  132012, // template parameter format mismatch
  132015, // template is paused
  132016, // template is disabled
  132018, // template: an issue with the parameters
  132068, // flow is blocked
  131050, // the user stopped marketing messages
  130472, // the user's number is part of an experiment
  131031, // account has been locked
  131045, // incorrect certificate
  133010, // phone number not registered
  190,    // access token expired
  10,     // permission denied
  200,    // permission denied
  368,    // temporarily blocked for policy violations
]);

export type MetaErrorClass = "window" | "template_day" | "payment" | "transient" | "permanent" | "unknown";

/** `code` is Meta's error code, or the HTTP status when the answer carried none. */
export function metaErrorClass(code: number | string | null | undefined): MetaErrorClass {
  const c = Number(code);
  if (code === null || code === undefined || code === "" || !Number.isFinite(c)) return "transient";
  if (c === META_WINDOW_CLOSED) return "window";
  if (c === META_TEMPLATE_DROPPED) return "template_day";
  if (c === 131042) return "payment";
  if (META_TRANSIENT.has(c) || (c >= 500 && c <= 599)) return "transient";
  if (META_PERMANENT.has(c)) return "permanent";
  return "unknown";
}

/** The spacing of the retries of one message, in minutes: the first a minute after the refusal. */
export const RETRY_DELAYS_MIN: readonly number[] = [1, 5, 15];
/** A permanent refusal stops the purpose to that number this long… */
export const PURPOSE_BLOCK_SEC = 24 * 3600;
/** …and a purpose of Baraa's own number an hour at most. */
export const OWNER_BLOCK_MAX_SEC = 3600;

/**
 * When the retry after `attempt` earlier ones is due (ms from now), or null: no retry is left. An important
 * alert (`forever`) keeps the last spacing until the message expires.
 */
export function retryDelayMs(attempt: number, forever: boolean): number | null {
  const i = Math.max(0, attempt);
  if (i < RETRY_DELAYS_MIN.length) return RETRY_DELAYS_MIN[i] * 60_000;
  return forever ? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1] * 60_000 : null;
}
