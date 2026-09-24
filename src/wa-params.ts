// WhatsApp template parameter hygiene — 2026-09-24 (WA-SCENARIOS ح1).
//
// Meta rejects a template send with #132018 when a body variable carries a
// newline, a tab, or more than four consecutive spaces, and #131008 when it is
// empty. Proven on sim: utak_collection_summary failed 6/6 because {{2}} was a
// multi-line list. Rather than trusting every caller, fetchMeta runs every
// template send through sanitizeTemplateBody (one place, every path), and
// callers that build lists use joinCapped so the cut falls on an item boundary.

/** Longest single variable fetchMeta lets through (template bodies cap at 1024 total). */
export const TEMPLATE_PARAM_MAX = 900;
/** Budget for a list variable built by a caller (leaves room for the template text). */
export const TEMPLATE_LIST_MAX = 600;

const LINE_BREAK = /[\r\n\t\u2028\u2029\v\f]/;

/** One line, single spaces, never empty, at most `max` chars (cut on a separator). */
export function sanitizeTemplateParam(v: unknown, max: number = TEMPLATE_PARAM_MAX): string {
  let s = String(v ?? "")
    .replace(/[ \u00a0]*[\r\n\t\u2028\u2029\v\f]+[ \u00a0]*/g, " · ")
    .replace(/[ \u00a0]{2,}/g, " ")
    .replace(/( · ){2,}/g, " · ")
    .trim()
    .replace(/^·\s*/, "")
    .replace(/\s*·$/, "")
    .trim();
  if (!s) return "-";
  if (s.length > max) s = cutOnBoundary(s, max);
  return s;
}

function cutOnBoundary(s: string, max: number): string {
  const room = Math.max(1, max - 2);
  const head = s.slice(0, room);
  const at = Math.max(head.lastIndexOf(" · "), head.lastIndexOf("، "), head.lastIndexOf(", "));
  const cut = at > room / 2 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(" ") > room / 2 ? head.lastIndexOf(" ") : room);
  return `${cut.trim()} …`;
}

/** True when Meta would refuse this variable (#132018 / #131008). */
export function isInvalidTemplateParam(s: unknown): boolean {
  const t = String(s ?? "");
  return t.trim() === "" || LINE_BREAK.test(t) || / {5,}/.test(t);
}

export interface ParamFix {
  component: string;
  index: number;
  reason: "newline" | "spaces" | "empty" | "length";
}

/**
 * Sanitize every text parameter of a template message in place (body and
 * header). Returns what had to be fixed — a non-empty list is a caller bug
 * (the caller passed Meta-invalid text) and is logged as such by fetchMeta.
 */
export function sanitizeTemplateBody(body: Record<string, unknown>): { fixes: ParamFix[]; invalid: ParamFix[] } {
  const fixes: ParamFix[] = [];
  const invalid: ParamFix[] = [];
  if ((body as { type?: string }).type !== "template") return { fixes, invalid };
  // deno-lint-ignore no-explicit-any
  const comps: any[] = (body as any)?.template?.components ?? [];
  for (const c of comps) {
    if (c?.type !== "body" && c?.type !== "header") continue;
    const params: Array<{ type?: string; text?: unknown }> = c?.parameters ?? [];
    params.forEach((p, index) => {
      if (p?.type !== "text") return;
      const raw = String(p.text ?? "");
      const clean = sanitizeTemplateParam(raw);
      if (clean !== raw) {
        const reason: ParamFix["reason"] = /[\r\n\t\u2028\u2029\v\f]/.test(raw) ? "newline"
          : raw.trim() === "" ? "empty"
          : / {2,}/.test(raw) ? "spaces"
          : "length";
        fixes.push({ component: c.type, index, reason });
      }
      p.text = clean;
      if (isInvalidTemplateParam(clean)) invalid.push({ component: c.type, index, reason: "newline" });
    });
  }
  return { fixes, invalid };
}

/**
 * Join list items on one line, cutting on an item boundary and saying how
 * many were left out: "طماطم × 3، خيار × 2 … و 7 أخرى".
 */
export function joinCapped(
  items: string[],
  max: number = TEMPLATE_LIST_MAX,
  sep = "، ",
  more: (n: number) => string = (n) => `و ${n} أخرى`,
): { text: string; shown: number; truncated: boolean } {
  const clean = items.map((i) => sanitizeTemplateParam(i, max)).filter((i) => i !== "-");
  let text = "";
  let shown = 0;
  for (let i = 0; i < clean.length; i++) {
    const next = text ? `${text}${sep}${clean[i]}` : clean[i];
    const rest = clean.length - (i + 1);
    const tail = rest > 0 ? ` … ${more(rest)}` : "";
    if (next.length + tail.length > max && shown > 0) break;
    text = next;
    shown++;
  }
  const left = clean.length - shown;
  if (left > 0) text = `${text} … ${more(left)}`;
  return { text: text || "-", shown, truncated: left > 0 };
}

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/**
 * "2026-09-24" → "24 سبتمبر 2026" (Gregorian, Latin digits). Built by hand,
 * not by Intl, so no bidi control marks land inside an Arabic sentence and the
 * output does not depend on the runtime's ICU data. Falls back to the input.
 */
export function arabicDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  if (!m) return String(ymd ?? "");
  const month = AR_MONTHS[Number(m[2]) - 1];
  if (!month) return String(ymd);
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Mask a phone for alerts: last four digits only. */
export function maskPhone(s: string): string {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  return d ? `…${d.slice(-4)}` : "(none)";
}
