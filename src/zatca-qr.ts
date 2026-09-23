// ZATCA e-invoicing Phase 1 QR (2026-09-24).
//
// Phase 1 ("generation") QR = base64 of a TLV byte string with five tags:
//   1 seller name · 2 seller VAT number · 3 invoice timestamp
//   4 invoice total incl. VAT · 5 VAT total
// Each record is [tag:1 byte][length:1 byte][value: UTF-8 bytes], so every
// value must fit 255 bytes. No cryptographic stamp and no ZATCA API call —
// that is Phase 2, out of scope.
//
// Source of truth: Odoo's l10n_sa computes the same string on account.move
// (`l10n_sa_qr_code_str`, non-stored, built from the move's
// l10n_sa_confirmation_datetime in Asia/Riyadh). resolveZatcaQr prefers it
// when it decodes to exactly the five tags AND agrees with the invoice being
// printed (VAT number, total, tax). Otherwise — no linked move, older
// ACCOUNTING_SYNC-off invoices, or a mismatch — the same five fields are
// encoded here with Odoo's formatting rules, so both paths print identically.
//
// Whatever QR is chosen, the invoice prints its decoded fields verbatim next
// to the code, so the scanned values and the printed ones can never drift.

import qrcode from "qrcode-generator";

export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  /** Riyadh wall-clock time, "YYYY-MM-DDTHH:MM:SS" (l10n_sa's format). */
  timestamp: string;
  /** Total incl. VAT, two decimals, no separators ("1150.00"). */
  total: string;
  /** VAT total, two decimals ("150.00"). */
  vatTotal: string;
}

export type ZatcaQrSource = "l10n_sa" | "local";

export interface ZatcaQr {
  base64: string;
  fields: ZatcaQrFields;
  source: ZatcaQrSource;
}

export interface TlvRecord {
  tag: number;
  length: number;
  value: string;
}

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh, no DST

/** Same as Odoo float_repr(abs(x), 2): "1150.00", never "1,150.00". */
export function formatZatcaAmount(n: number): string {
  return (Math.round(Math.abs(n) * 100) / 100).toFixed(2);
}

/** UTC instant → Riyadh wall clock "YYYY-MM-DDTHH:MM:SS". */
export function formatZatcaTimestamp(utc: Date): string {
  if (Number.isNaN(utc.getTime())) throw new Error("ZATCA timestamp: invalid date");
  return new Date(utc.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 19);
}

/** Odoo datetime string ("2026-10-01 09:07:57", stored in UTC) → Date. */
export function parseOdooUtc(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

export function encodeZatcaTlv(f: ZatcaQrFields): string {
  const enc = new TextEncoder();
  const values = [f.sellerName, f.vatNumber, f.timestamp, f.total, f.vatTotal];
  const parts: number[] = [];
  values.forEach((v, i) => {
    const bytes = enc.encode(v);
    if (bytes.length === 0) throw new Error(`ZATCA QR tag ${i + 1} is empty`);
    if (bytes.length > 255) throw new Error(`ZATCA QR tag ${i + 1} is ${bytes.length} bytes (max 255)`);
    parts.push(i + 1, bytes.length, ...bytes);
  });
  return bytesToBase64(Uint8Array.from(parts));
}

export function decodeZatcaTlv(base64: string): TlvRecord[] {
  const bytes = base64ToBytes(base64);
  const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const out: TlvRecord[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (i + 2 > bytes.length) throw new Error("ZATCA TLV truncated header");
    const tag = bytes[i];
    const length = bytes[i + 1];
    if (i + 2 + length > bytes.length) throw new Error(`ZATCA TLV tag ${tag} truncated`);
    out.push({ tag, length, value: dec.decode(bytes.subarray(i + 2, i + 2 + length)) });
    i += 2 + length;
  }
  return out;
}

/** The five fields, or null unless the TLV is exactly tags 1..5 in order. */
export function parseZatcaQr(base64: string): ZatcaQrFields | null {
  let recs: TlvRecord[];
  try {
    recs = decodeZatcaTlv(base64);
  } catch {
    return null;
  }
  if (recs.length !== 5 || recs.some((r, i) => r.tag !== i + 1 || !r.value)) return null;
  const [sellerName, vatNumber, timestamp, total, vatTotal] = recs.map((r) => r.value);
  return { sellerName, vatNumber, timestamp, total, vatTotal };
}

export interface ResolveZatcaQrArgs {
  /** account.move.l10n_sa_qr_code_str, when the invoice has a posted move. */
  odooQr?: string | false | null;
  /** What the printed invoice says — Odoo's QR must agree with it. */
  expected: { vatNumber: string; total: number; vatTotal: number };
  /** Inputs for the locally encoded QR. */
  fallback: { sellerName: string; issuedAtUtc: Date };
}

export interface ResolvedZatcaQr extends ZatcaQr {
  /** Why Odoo's string was not used (absent → it was). */
  odooRejected?: string;
}

export function resolveZatcaQr(a: ResolveZatcaQrArgs): ResolvedZatcaQr {
  const want = {
    vatNumber: a.expected.vatNumber.trim(),
    total: formatZatcaAmount(a.expected.total),
    vatTotal: formatZatcaAmount(a.expected.vatTotal),
  };
  let odooRejected: string | undefined;
  if (typeof a.odooQr === "string" && a.odooQr.trim()) {
    const f = parseZatcaQr(a.odooQr.trim());
    if (!f) odooRejected = "not a 5-tag TLV";
    else if (f.vatNumber !== want.vatNumber) odooRejected = `VAT ${f.vatNumber} ≠ ${want.vatNumber}`;
    else if (f.total !== want.total) odooRejected = `total ${f.total} ≠ ${want.total}`;
    else if (f.vatTotal !== want.vatTotal) odooRejected = `tax ${f.vatTotal} ≠ ${want.vatTotal}`;
    else if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(f.timestamp)) odooRejected = `timestamp ${f.timestamp}`;
    else return { base64: a.odooQr.trim(), fields: f, source: "l10n_sa" };
  } else {
    odooRejected = "no l10n_sa QR on the move";
  }
  const fields: ZatcaQrFields = {
    sellerName: a.fallback.sellerName.trim(),
    vatNumber: want.vatNumber,
    timestamp: formatZatcaTimestamp(a.fallback.issuedAtUtc),
    total: want.total,
    vatTotal: want.vatTotal,
  };
  return { base64: encodeZatcaTlv(fields), fields, source: "local", odooRejected };
}

/**
 * The QR as inline SVG, `sizeMm` wide, with a 4-module quiet zone. Error
 * correction M; the payload is the base64 text (ASCII), so byte mode is
 * exact. Dark modules are pure ink for scanner contrast.
 */
export function zatcaQrSvg(base64: string, sizeMm: number): string {
  const qr = qrcode(0, "M");
  qr.addData(base64, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const dim = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges" style="display: block;"><rect width="${dim}" height="${dim}" fill="#FFFFFF"/><path d="${d}" fill="#000000"/></svg>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
