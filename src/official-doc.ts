// UTAK Official Documents — «المستندات الرسمية»
// Any non-routine paper (bank letter, certificate, authorization, financial
// statement, …) rendered on the UTAK letterhead via renderPDFShell.
//
// The record lives in Odoo (x_official_doc + x_official_doc_block); the
// Worker owns the pipeline — preview, issue, AI drafting, PDF, R2 upload —
// exactly like the quotation flow (Odoo → Server Action → 202 → waitUntil).

import type { Env } from "./config";
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION } from "./config";
import { call } from "./odoo";
import { readCompanyInfo, type CompanyInfo } from "./company";
import {
  BRAND_COLORS,
  BRAND_FONT,
  computePageMetrics,
  escapeHTML,
  htmlToPDF,
  renderPDFShell,
  renderSealSignatureBlock,
  signDocToken,
  uploadPDFToR2,
  type LegalFooterInfo,
} from "./pdf-template";
import { UI, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, taglineFor, thanksLine as thanksLineFor } from "./doc-shell";
import { toLegalFooterAr } from "./legal-footer";

// ============================================================================
// Types (mirror the Odoo model)
// ============================================================================

export type OfficialDocType =
  | "letter"
  | "certificate"
  | "authorization"
  | "statement"
  | "other";

export type OfficialDocStatus = "draft" | "issued";

export type BlockType =
  | "heading"
  | "badge"
  | "paragraph"
  | "kv_card"
  | "table"
  | "highlight_row"
  | "notes"
  | "signature"
  | "stamp";

export type BlockTone = "neutral" | "warning" | "success";

export const BLOCK_TYPES: readonly BlockType[] = [
  "heading",
  "badge",
  "paragraph",
  "kv_card",
  "table",
  "highlight_row",
  "notes",
  "signature",
  "stamp",
] as const;

export const BLOCK_TONES: readonly BlockTone[] = [
  "neutral",
  "warning",
  "success",
] as const;

export interface OfficialDocBlock {
  id?: number;
  sequence: number;
  block_type: BlockType;
  text: string;
  tone: BlockTone;
  align_numbers: boolean;
}

export interface OfficialDocRecord {
  id: number;
  name: string;             // "UTAK-L-2026-001" or "" for draft
  doc_type: OfficialDocType;
  recipient: string;
  recipient_label: string;
  subject: string;
  date: Date;
  status: OfficialDocStatus;
  ai_prompt: string;
  blocks: OfficialDocBlock[];
  is_template: boolean;
  template_name: string;
  // Part B: language selector on the record (x_official_doc.x_lang).
  // Defaults to "ar" when the field is missing/unset — preserves Part A
  // rendering byte-for-byte on any doc that predates this change.
  lang?: DocLang;
}

export type { CompanyInfo };

// ============================================================================
// Block-type tone colors (shared with pdf-template's BRAND palette)
// ============================================================================

const TONE_COLORS: Record<BlockTone, { border: string; bg: string; text: string }> = {
  neutral: {
    border: BRAND_COLORS.borderSoft,
    bg: "transparent",
    text: BRAND_COLORS.ink,
  },
  warning: {
    // The orange dot (BRAND_COLORS.accent) with a very faint wash.
    border: BRAND_COLORS.accent,
    bg: "rgba(224, 123, 57, 0.06)",
    text: BRAND_COLORS.accent,
  },
  success: {
    // UTAK green.
    border: BRAND_COLORS.primary,
    bg: "rgba(30, 90, 65, 0.05)",
    text: BRAND_COLORS.primary,
  },
};

// ============================================================================
// x_text parsers — each block type has its own line-oriented mini-syntax.
// All parsers are pure functions; unit-tested in tests/official-doc.test.mts.
// ============================================================================

function splitLines(s: string): string[] {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function parseKVCard(text: string): Array<{ key: string; value: string }> {
  return splitLines(text)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return { key: line, value: "" };
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((r) => r.key.length > 0);
}

export interface ParsedTable {
  headers: string[];
  rows: Array<{ cells: string[]; isTotal: boolean }>;
}

export function parseTable(text: string): ParsedTable {
  const lines = splitLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split("|").map((c) => c.trim());
  const rows = lines.slice(1).map((line) => {
    const isTotal = line.startsWith("=");
    const src = isTotal ? line.slice(1).trim() : line;
    const cells = src.split("|").map((c) => c.trim());
    return { cells, isTotal };
  });
  return { headers, rows };
}

export function parseHighlightRow(text: string): { label: string; values: string[] } {
  const cells = String(text ?? "")
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const [label = "", ...values] = cells;
  return { label, values };
}

export function parseNotes(text: string): string[] {
  return splitLines(text);
}

export function parseSignature(text: string): { name: string; title: string } {
  const [name = "", title = ""] = splitLines(text);
  return { name, title };
}

// ============================================================================
// Placeholder guard — rejects `[anything]` inside block text. Used before
// issue-time so an AI-drafted document with any "[الوصف]" gap can't ship.
// ============================================================================

const PLACEHOLDER_RE = /\[[^\]\n]{1,60}\]/;

export function findPlaceholders(blocks: OfficialDocBlock[]): Array<{ sequence: number; snippet: string }> {
  const hits: Array<{ sequence: number; snippet: string }> = [];
  for (const b of blocks) {
    const m = b.text.match(PLACEHOLDER_RE);
    if (m) hits.push({ sequence: b.sequence, snippet: m[0] });
  }
  return hits;
}

// ============================================================================
// Block renderers — each returns a `.utak-block` <div> so the shell's opt-in
// multi-page rules (break-inside: avoid) apply.
// ============================================================================

function renderHeadingBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  return `<div class="utak-block" style="font-size: 16px; font-weight: 500; color: ${c.text}; letter-spacing: 0.02em; margin-bottom: 6px;">${escapeHTML(text)}</div>`;
}

function renderBadgeBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  return `<div class="utak-block" style="display: flex; margin: 4px 0;">
    <div style="display: inline-flex; padding: 4px 12px; border: 0.5px solid ${c.border}; background: ${c.bg}; color: ${c.text}; font-size: 11px; font-weight: 500; letter-spacing: 0.14em;">${escapeHTML(text)}</div>
  </div>`;
}

function renderParagraphBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  // Preserve paragraph breaks; whitespace-first-line indent stays default.
  const bodyHtml = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) => escapeHTML(para).replace(/\n/g, "<br/>"))
    .map((h) => `<div style="margin-bottom: 6px;">${h}</div>`)
    .join("");
  return `<div class="utak-block" style="font-size: 12.5px; font-weight: 400; color: ${c.text}; line-height: 1.9; text-align: justify;">${bodyHtml}</div>`;
}

function renderKVCardBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  const rows = parseKVCard(text);
  if (rows.length === 0) return "";
  const inner = rows
    .map(
      (r) => `<div style="display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 6px 0; border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
        <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em;">${escapeHTML(r.key)}</div>
        <div style="font-size: 12.5px; font-weight: 400; color: ${BRAND_COLORS.ink};">${escapeHTML(r.value)}</div>
      </div>`,
    )
    .join("");
  return `<div class="utak-block" style="border: 0.5px solid ${c.border}; background: ${c.bg}; padding: 10px 16px;">${inner}</div>`;
}

function renderTableBlock(text: string, tone: BlockTone, alignNumbers: boolean): string {
  const parsed = parseTable(text);
  if (parsed.headers.length === 0) return "";
  const numAlign = alignNumbers ? "text-align: left; direction: ltr;" : "text-align: right;";
  const numDetector = /^-?[\d.,]+(?:\s*[^\s].*)?$/; // number-like leading cell
  const isNumericCol = (colIdx: number): boolean => {
    if (colIdx === 0) return false; // label column
    const sampleRow = parsed.rows[0]?.cells[colIdx] ?? "";
    return numDetector.test(sampleRow.trim());
  };
  const headHtml = parsed.headers
    .map((h, i) => {
      const align = isNumericCol(i) ? numAlign : "text-align: right;";
      return `<th style="${align} font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em; padding: 8px 6px;">${escapeHTML(h)}</th>`;
    })
    .join("");
  const bodyHtml = parsed.rows
    .map((r) => {
      const cellsHtml = r.cells
        .map((v, i) => {
          const align = isNumericCol(i) ? numAlign : "text-align: right;";
          const totalStyle = r.isTotal ? `font-weight: 500; color: ${BRAND_COLORS.ink};` : "";
          return `<td style="${align} font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.ink}; padding: 6px; ${totalStyle}">${escapeHTML(v)}</td>`;
        })
        .join("");
      const borderTop = r.isTotal
        ? `border-top: 0.5px solid ${BRAND_COLORS.borderStrong};`
        : `border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};`;
      const bg = r.isTotal ? `background: rgba(30, 90, 65, 0.04);` : "";
      return `<tr class="utak-block" style="${borderTop} ${bg}">${cellsHtml}</tr>`;
    })
    .join("");
  const toneBorder = TONE_COLORS[tone].border;
  return `<div class="utak-block">
    <table style="width: 100%; border-collapse: collapse; table-layout: auto; border-top: 0.5px solid ${toneBorder}; border-bottom: 0.5px solid ${toneBorder};">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>`;
}

function renderHighlightRowBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  const { label, values } = parseHighlightRow(text);
  const valuesHtml = values
    .map((v) => `<div style="font-size: 14px; font-weight: 500; color: ${c.text}; direction: ltr; text-align: left; min-width: 120px;">${escapeHTML(v)}</div>`)
    .join("");
  return `<div class="utak-block" style="display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 12px 16px; border: 0.5px solid ${c.border}; background: ${c.bg};">
    <div style="font-size: 12.5px; font-weight: 500; color: ${c.text};">${escapeHTML(label)}</div>
    <div style="display: flex; gap: 16px;">${valuesHtml}</div>
  </div>`;
}

function renderNotesBlock(text: string, tone: BlockTone): string {
  const c = TONE_COLORS[tone];
  const items = parseNotes(text);
  if (items.length === 0) return "";
  const itemsHtml = items
    .map(
      (n, i) => `<div class="utak-block" style="display: grid; grid-template-columns: 24px 1fr; gap: 8px; padding: 3px 0;">
      <div style="font-size: 11px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; direction: ltr; text-align: right;">${i + 1}.</div>
      <div style="font-size: 11.5px; font-weight: 400; color: ${BRAND_COLORS.ink}; line-height: 1.8;">${escapeHTML(n)}</div>
    </div>`,
    )
    .join("");
  return `<div class="utak-block" style="border-inline-start: 2px solid ${c.border}; padding-inline-start: 10px;">${itemsHtml}</div>`;
}

function renderSignatureBlock(text: string): string {
  const { name, title } = parseSignature(text);
  return `<div class="utak-block" style="margin-top: 20px; display: flex; flex-direction: column; gap: 4px; width: 240px;">
    <div style="height: 40px; border-bottom: 0.5px solid ${BRAND_COLORS.ink};"></div>
    <div style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink}; padding-top: 6px;">${escapeHTML(name)}</div>
    ${title ? `<div style="font-size: 10.5px; font-weight: 400; color: ${BRAND_COLORS.inkMuted};">${escapeHTML(title)}</div>` : ""}
  </div>`;
}

function renderStampBlock(text: string): string {
  // A muted ring evoking a stamp — no fake authenticity marks; the caption
  // is whatever `text` contains.
  return `<div class="utak-block" style="margin-top: 8px; display: flex;">
    <div style="width: 110px; height: 110px; border: 1.5px dashed ${BRAND_COLORS.primary}; border-radius: 55px; display: flex; align-items: center; justify-content: center; text-align: center; color: ${BRAND_COLORS.primary}; font-size: 10px; font-weight: 500; letter-spacing: 0.14em; line-height: 1.6; opacity: 0.7;">${escapeHTML(text || "الختم")}</div>
  </div>`;
}

export function renderBlock(b: OfficialDocBlock): string {
  switch (b.block_type) {
    case "heading":        return renderHeadingBlock(b.text, b.tone);
    case "badge":          return renderBadgeBlock(b.text, b.tone);
    case "paragraph":      return renderParagraphBlock(b.text, b.tone);
    case "kv_card":        return renderKVCardBlock(b.text, b.tone);
    case "table":          return renderTableBlock(b.text, b.tone, b.align_numbers);
    case "highlight_row":  return renderHighlightRowBlock(b.text, b.tone);
    case "notes":          return renderNotesBlock(b.text, b.tone);
    case "signature":      return renderSignatureBlock(b.text);
    case "stamp":          return renderStampBlock(b.text);
    default:               return "";
  }
}

export function renderBlocks(
  blocks: OfficialDocBlock[],
  opts: { omitStampPlaceholder?: boolean } = {},
): string {
  const ordered = [...blocks].sort((a, b) => a.sequence - b.sequence);
  const parts: string[] = [];
  for (const b of ordered) {
    // An issued doc prints the real company seal (bottom-left); the dashed
    // ring would be a second, fake-looking stamp.
    if (opts.omitStampPlaceholder && b.block_type === "stamp") continue;
    const html = renderBlock(b);
    if (!html) continue;
    parts.push(html);
  }
  // Consistent vertical rhythm between blocks.
  return `<div style="display: flex; flex-direction: column; gap: 14px; font-family: '${BRAND_FONT}', 'Tajawal', sans-serif;">${parts.join("")}</div>`;
}

// ============================================================================
// Document title mapping
// ============================================================================

const DOC_TITLE_AR: Record<OfficialDocType, string> = {
  letter: "خطاب رسمي",
  certificate: "إفادة",
  authorization: "تفويض",
  statement: "قائمة مالية",
  other: "مستند رسمي",
};

// ============================================================================
// Above-body strip: subject + recipient line, above the main block flow.
// ============================================================================

function renderSubjectStrip(
  subject: string,
  recipient: string,
  recipientLabel: string,
  lang: DocLang = "ar",
): string {
  if (!subject && !recipient) return "";
  const subjectLabel = lang === "en" ? UI.subjectLabel.en : UI.subjectLabel.ar;
  const subjectHtml = subject
    ? `<div style="display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: baseline;">
        <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em;">${escapeHTML(subjectLabel)}</div>
        <div style="font-size: 13px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(subject)}</div>
      </div>`
    : "";
  const recipientHtml = recipient
    ? `<div style="display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: baseline;">
        <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em;">${escapeHTML(recipientLabel || "إلى")}</div>
        <div style="font-size: 13px; font-weight: 400; color: ${BRAND_COLORS.ink};">${escapeHTML(recipient)}</div>
      </div>`
    : "";
  return `<div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px;">${recipientHtml}${subjectHtml}</div>`;
}

// ============================================================================
// Density picker — very short = airy, ~1 page = normal, >1 page = tight.
// Uses total char count + table row count as a proxy for content weight.
// ============================================================================

function estimateContentWeight(blocks: OfficialDocBlock[]): number {
  let chars = 0;
  let tableRows = 0;
  for (const b of blocks) {
    chars += b.text.length;
    if (b.block_type === "table") tableRows += parseTable(b.text).rows.length;
  }
  // Rough heuristic tuned to A4 20mm-margin body:
  //   ~2400 chars of paragraph ≈ 1 page; 30 table rows ≈ 1 page.
  return chars + tableRows * 80;
}

function pickDensity(weight: number): "airy" | "normal" | "tight" {
  if (weight < 500) return "airy";
  if (weight > 2400) return "tight";
  return "normal";
}

// ============================================================================
// Main HTML render
// ============================================================================

export interface OfficialDocRenderContext {
  record: OfficialDocRecord;
  company: CompanyInfo;
  /** When true, adds "معاينة — غير معتمد" badge in the header and no number. */
  isPreview: boolean;
  /** For preview mode, we show the pending number as a placeholder. */
  numberOverride?: string;
}

export function renderOfficialDocHTML(ctx: OfficialDocRenderContext): string {
  const { record, company, isPreview } = ctx;
  // Language: x_official_doc only supports ar/en (per task). "bi" is not a
  // valid mode for official docs — the record.lang type carries "ar" | "en".
  const lang: DocLang = (record.lang as DocLang | undefined) === "en" ? "en" : "ar";
  const isEn = lang === "en";
  const weight = estimateContentWeight(record.blocks);
  const density = pickDensity(weight);
  const heaviestTable = Math.max(
    0,
    ...record.blocks.filter((b) => b.block_type === "table").map((b) => parseTable(b.text).rows.length),
  );
  const pageMetrics = computePageMetrics(Math.max(heaviestTable, density === "tight" ? 20 : density === "airy" ? 4 : 10));

  const docNumber = isPreview ? (ctx.numberOverride ?? "—") : record.name || "—";
  const legalFooter: LegalFooterInfo = toLegalFooterAr(company);

  const recipientLabel = record.recipient_label
    || (isEn ? UI.toLabel.en : UI.toLabel.ar);
  const aboveBody = renderSubjectStrip(record.subject, record.recipient, recipientLabel, lang);
  // 2026-09-24 — the real seal + signature go on ISSUED docs only. A preview
  // (draft) keeps the dashed placeholder ring and never carries the seal.
  const sealBlock = isPreview
    ? ""
    : renderSealSignatureBlock({ stamp: company.stampImage, signature: company.signatureImage });
  const bodyHTML = renderBlocks(record.blocks, { omitStampPlaceholder: sealBlock !== "" && !!company.stampImage });

  // Title picker per lang. bi is not supported for official docs so the
  // en branch is the only non-Arabic fallback.
  const titleAr = DOC_TITLE_AR[record.doc_type] ?? DOC_TITLE_AR.other;
  const titleEn = ({
    letter: UI.officialLetter.en,
    certificate: UI.officialCertificate.en,
    authorization: UI.officialAuthorization.en,
    statement: UI.officialStatement.en,
    other: UI.officialOther.en,
  } as const)[record.doc_type] ?? UI.officialOther.en;

  return renderPDFShell({
    documentTitle: isEn ? titleEn : titleAr,
    documentNumber: docNumber,
    documentDate: record.date,
    billTo: { name: record.recipient || "", address: "", phone: "" },
    from: fromPartyFor(lang, company),
    hideBillTo: true,
    hideFrom: true,
    suppressPartiesRow: true,
    bodyHTML,
    aboveBodyHTML: aboveBody,
    belowBodyHTML: sealBlock || undefined,
    hideFooterNote: true,
    hideThanks: true,
    legalFooterBar: legalFooter,
    multiPageBreaks: true,
    headerBadge: isPreview
      ? { text: isEn ? UI.previewBadge.en : "معاينة — غير معتمد", color: BRAND_COLORS.accent, bg: "rgba(224, 123, 57, 0.08)" }
      : undefined,
    pageMetrics,
    lang: isEn ? "en" : undefined,
    tagline: isEn ? taglineFor("en") : undefined,
    documentDateStr: isEn ? formatDateEn(record.date) : undefined,
    thanksLine: isEn ? thanksLineFor("en", company) : undefined,
  });
}

// ============================================================================
// PDF pipeline
// ============================================================================

export async function generateOfficialDocPDF(
  ctx: OfficialDocRenderContext,
  env: Env,
): Promise<Uint8Array> {
  return await htmlToPDF(renderOfficialDocHTML(ctx), env);
}

// ============================================================================
// R2 upload — final PDFs live under official-docs/<number>.pdf, previews
// under official-docs/previews/<id>-<ts>.pdf.
// ============================================================================

export async function uploadOfficialDocFinal(
  env: Env,
  pdfBytes: Uint8Array,
  docNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  const result = await uploadPDFToR2(env, {
    pdfBytes,
    folder: "official-docs",
    urlPrefix: "official-doc-pdf",
    docNumber,
    workerOrigin,
  });
  if (!env.ADMIN_TOKEN) throw new Error("ADMIN_TOKEN missing");
  const token = await signDocToken(env.ADMIN_TOKEN, docNumber);
  const publicUrl = `${workerOrigin}/official-doc-pdf/${encodeURIComponent(docNumber)}/${token}.pdf`;
  return { ...result, publicUrl };
}

export async function uploadOfficialDocPreview(
  env: Env,
  pdfBytes: Uint8Array,
  recordId: number,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  const ts = Date.now();
  const key = `official-docs/previews/${recordId}-${ts}.pdf`;
  if (!env.ADMIN_TOKEN) throw new Error("ADMIN_TOKEN missing");
  await env.INVOICES_BUCKET.put(key, pdfBytes, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition: `inline; filename="preview-${recordId}.pdf"`,
    },
    customMetadata: {
      recordId: String(recordId),
      preview: "true",
      uploadedAt: new Date().toISOString(),
    },
  });
  const previewName = `preview-${recordId}-${ts}`;
  const token = await signDocToken(env.ADMIN_TOKEN, previewName);
  const publicUrl = `${workerOrigin}/official-doc-pdf/${encodeURIComponent(previewName)}/${token}.pdf`;
  return { key, publicUrl, size: pdfBytes.byteLength };
}

export async function verifyOfficialDocToken(
  secret: string,
  docName: string,
  token: string,
): Promise<boolean> {
  const expected = await signDocToken(secret, docName);
  return expected === token;
}

// ============================================================================
// Number generator — UTAK-L-YYYY-NNN.
// N = count of ISSUED docs in the same year + 1, with retry-on-collision.
// ============================================================================

export async function nextDocNumber(env: Env, forDate: Date): Promise<string> {
  const year = forDate.getUTCFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await call<Array<{ id: number; x_name: string | false }>>(
      env,
      "x_official_doc",
      "search_read",
      {
        domain: [
          ["x_status", "=", "issued"],
          ["x_name", "like", `UTAK-L-${year}-%`],
        ],
        fields: ["id", "x_name"],
      },
    );
    let maxN = 0;
    for (const r of rows) {
      const m = String(r.x_name || "").match(/^UTAK-L-\d{4}-(\d{1,6})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    const nextN = maxN + 1;
    const candidate = `UTAK-L-${year}-${String(nextN).padStart(3, "0")}`;
    // Optimistic: the write step below will error on unique-constraint clash,
    // then we retry with a fresh scan.
    const collision = await call<number>(env, "x_official_doc", "search_count", {
      domain: [["x_name", "=", candidate]],
    });
    if (collision === 0) return candidate;
  }
  throw new Error("nextDocNumber: 5 attempts to reserve number all collided");
}

// ============================================================================
// Odoo reads: record + blocks + company
// ============================================================================

export async function readOfficialDoc(env: Env, id: number): Promise<OfficialDocRecord | null> {
  type DocRow = {
    id: number;
    x_name: string | false;
    x_doc_type: string | false;
    x_recipient: string | false;
    x_recipient_label: string | false;
    x_subject: string | false;
    x_date: string | false;
    x_status: string | false;
    x_ai_prompt: string | false;
    x_is_template: boolean | false;
    x_template_name: string | false;
    x_block_ids: number[] | false;
    x_lang?: string | false;
  };
  // x_lang was added in Part B — probe once, only include it in the read
  // fields if present so this reader stays backwards compatible with any
  // tenant that hasn't installed the field yet.
  const langFieldRows = await call<Array<{ name: string }>>(env, "ir.model.fields", "search_read", {
    domain: [["model", "=", "x_official_doc"], ["name", "=", "x_lang"]],
    fields: ["name"],
  });
  const hasLangField = langFieldRows.length > 0;
  const readFields = [
    "id",
    "x_name",
    "x_doc_type",
    "x_recipient",
    "x_recipient_label",
    "x_subject",
    "x_date",
    "x_status",
    "x_ai_prompt",
    "x_is_template",
    "x_template_name",
    "x_block_ids",
    ...(hasLangField ? ["x_lang"] : []),
  ];
  const rows = await call<DocRow[]>(env, "x_official_doc", "read", {
    ids: [id],
    fields: readFields,
  });
  const r = rows[0];
  if (!r) return null;

  type BlockRow = {
    id: number;
    x_sequence: number | false;
    x_block_type: string | false;
    x_text: string | false;
    x_tone: string | false;
    x_align_numbers: boolean | false;
  };
  const blockRows: BlockRow[] = Array.isArray(r.x_block_ids) && r.x_block_ids.length > 0
    ? await call<BlockRow[]>(env, "x_official_doc_block", "read", {
        ids: r.x_block_ids,
        fields: ["id", "x_sequence", "x_block_type", "x_text", "x_tone", "x_align_numbers"],
      })
    : [];

  const blocks: OfficialDocBlock[] = blockRows.map((b) => ({
    id: b.id,
    sequence: typeof b.x_sequence === "number" ? b.x_sequence : 0,
    block_type: (b.x_block_type || "paragraph") as BlockType,
    text: String(b.x_text || ""),
    tone: (b.x_tone || "neutral") as BlockTone,
    align_numbers: b.x_align_numbers !== false,
  }));

  const rawDate = r.x_date || null;
  const date = rawDate ? new Date(String(rawDate) + "T00:00:00Z") : new Date();

  const rawLang = r.x_lang;
  const lang: DocLang = rawLang === "en" ? "en" : "ar";
  return {
    id: r.id,
    name: String(r.x_name || ""),
    doc_type: (r.x_doc_type || "letter") as OfficialDocType,
    recipient: String(r.x_recipient || ""),
    recipient_label: String(r.x_recipient_label || (lang === "en" ? "To" : "إلى")),
    subject: String(r.x_subject || ""),
    date,
    status: (r.x_status || "draft") as OfficialDocStatus,
    ai_prompt: String(r.x_ai_prompt || ""),
    blocks,
    is_template: r.x_is_template === true,
    template_name: String(r.x_template_name || ""),
    lang,
  };
}

// readCompanyInfo lives in ./company.ts (single source of truth used by every
// UTAK PDF renderer). Re-exported here so existing callers keep their import
// site unchanged.
export { readCompanyInfo };

// ============================================================================
// AI drafting — a strict-JSON call to Claude that rewrites the block list.
// ============================================================================

const AI_SYSTEM_PROMPT_AR = `أنت كاتب رسمي لشركة يوتاك (UTAK) في المملكة العربية السعودية.
تحوّل طلب المستخدم إلى مستند رسمي مبني على بلوكات.

القواعد الملزمة (بدون استثناء):
- عربية فصحى رسمية سعودية، مختصرة وبدون حشو.
- ممنوع اختراع أي رقم أو تاريخ أو اسم أو مبلغ غير موجود في الطلب أو في بيانات الشركة المرفقة.
- أي معلومة ناقصة تنكتب placeholder داخل أقواس مربعة، مثال: [رقم الحساب]، [تاريخ الاجتماع]، [اسم الجهة]. النظام يمنع إصدار المستند حتى يعبّي المستخدم كل الـ placeholders.
- التوقيع يضاف فقط لو المستند خطاب رسمي (letter) أو تفويض (authorization) أو طلبه المستخدم صراحة.
- الختم فقط لو طلبه المستخدم صراحة.
- بيانات الشركة تُقرأ من MERGED CONTEXT، لا تُخترع.

الرد ملزم أن يكون JSON فقط، بهذا الشكل (بدون شروح ولا Markdown):
{
  "doc_type": "letter"|"certificate"|"authorization"|"statement"|"other",
  "recipient": "<اسم الجهة، أو فارغ إذا لم يُذكر>",
  "subject": "<موضوع مختصر بسطر واحد>",
  "blocks": [
    {"type": "<one of: heading|badge|paragraph|kv_card|table|highlight_row|notes|signature|stamp>", "text": "<محتوى البلوك بصيغة x_text>", "tone": "neutral"|"warning"|"success"}
  ]
}

صيغة x_text لكل نوع:
- heading / badge / paragraph: نص عادي.
- kv_card: كل سطر «العنوان: القيمة».
- table: كل سطر صف والخلايا مفصولة بـ | ، أول سطر رأس. أي صف يبدأ بـ = يُعرض إجمالي.
- highlight_row: «العنوان | القيمة1 | القيمة2».
- notes: كل سطر ملاحظة (الترقيم تلقائي، لا تكتب الرقم).
- signature: سطران — الاسم ثم الصفة.
- stamp: نص قصير داخل الختم (مثل «شركة يوتاك»).

الحد الأقصى: 25 بلوك.`;

const AI_SYSTEM_PROMPT_EN = `You are an official writer for UTAK (شركة يوتاك), a Saudi Arabian company.
Turn the user's request into an official document composed of typed blocks.

Binding rules (no exceptions):
- Formal, concise Saudi business English — no filler.
- Never invent numbers, dates, names, or amounts not present in the request or the attached company data.
- Any missing information is written as a placeholder in square brackets: e.g. [Account Number], [Meeting Date], [Recipient Name]. The system blocks issuance until every placeholder is resolved.
- A signature is added ONLY if the doc is a letter, an authorization, or the user explicitly asked for one.
- A stamp is added ONLY if the user explicitly asked.
- Company data is read from MERGED CONTEXT; never invented.

The response MUST be JSON only (no prose, no markdown):
{
  "doc_type": "letter"|"certificate"|"authorization"|"statement"|"other",
  "recipient": "<recipient name, or empty>",
  "subject": "<one-line subject>",
  "blocks": [
    {"type": "<one of: heading|badge|paragraph|kv_card|table|highlight_row|notes|signature|stamp>", "text": "<x_text payload>", "tone": "neutral"|"warning"|"success"}
  ]
}

x_text format per block type:
- heading / badge / paragraph: plain text.
- kv_card: one "Label: Value" per line.
- table: one row per line, cells separated by |, first line is the header. Any line starting with = renders as a total row.
- highlight_row: "Label | Value1 | Value2".
- notes: one note per line (numbering is automatic — don't include numbers).
- signature: two lines — name then title.
- stamp: short text inside the stamp (e.g. "UTAK").

Max 25 blocks.`;

export interface AIDraftResult {
  doc_type: OfficialDocType;
  recipient: string;
  subject: string;
  blocks: Array<{ type: BlockType; text: string; tone: BlockTone }>;
}

async function callClaudeForDraft(env: Env, userMsg: string, lang: DocLang = "ar"): Promise<string> {
  const model = env.CLAUDE_MODEL_REPLY;
  if (!model) throw new Error("CLAUDE_MODEL_REPLY missing");
  const systemPrompt = lang === "en" ? AI_SYSTEM_PROMPT_EN : AI_SYSTEM_PROMPT_AR;
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 400);
    throw new Error(`claude ${res.status}: ${errText}`);
  }
  // deno-lint-ignore no-explicit-any
  const data: any = await res.json();
  const first = data?.content?.find((b: { type?: string }) => b?.type === "text");
  return first?.text ?? "";
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

export function validateAIDraft(raw: string): AIDraftResult | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object") return { error: "not an object" };
  // deno-lint-ignore no-explicit-any
  const p = parsed as any;
  const doc_type = p.doc_type;
  if (typeof doc_type !== "string" || !["letter", "certificate", "authorization", "statement", "other"].includes(doc_type)) {
    return { error: `invalid doc_type: ${doc_type}` };
  }
  if (!Array.isArray(p.blocks)) return { error: "blocks must be an array" };
  if (p.blocks.length > 25) return { error: `too many blocks (${p.blocks.length} > 25)` };
  const cleanBlocks: Array<{ type: BlockType; text: string; tone: BlockTone }> = [];
  for (let i = 0; i < p.blocks.length; i++) {
    const b = p.blocks[i];
    if (!b || typeof b !== "object") return { error: `blocks[${i}] not an object` };
    const type = b.type;
    if (typeof type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(type)) {
      return { error: `blocks[${i}].type invalid: ${type}` };
    }
    const text = typeof b.text === "string" ? b.text : "";
    if (text.length > 5000) return { error: `blocks[${i}].text too long (${text.length})` };
    const tone = typeof b.tone === "string" && (BLOCK_TONES as readonly string[]).includes(b.tone)
      ? (b.tone as BlockTone)
      : "neutral";
    cleanBlocks.push({ type: type as BlockType, text, tone });
  }
  return {
    doc_type: doc_type as OfficialDocType,
    recipient: typeof p.recipient === "string" ? p.recipient : "",
    subject: typeof p.subject === "string" ? p.subject : "",
    blocks: cleanBlocks,
  };
}

export async function aiDraftDocument(
  env: Env,
  args: { prompt: string; company: CompanyInfo; currentDocType?: OfficialDocType; lang?: DocLang },
): Promise<AIDraftResult> {
  const lang: DocLang = args.lang === "en" ? "en" : "ar";
  const nameForCtx = lang === "en"
    ? (args.company.legalNameEn || args.company.nameEn)
    : (args.company.legalNameAr || args.company.nameAr);
  const addressForCtx = lang === "en"
    ? (args.company.addressEn || args.company.address)
    : (args.company.addressAr || args.company.address);
  const userMsg = lang === "en"
    ? [
        `User request:`,
        args.prompt,
        ``,
        `MERGED CONTEXT (company data — never invent other values):`,
        `- Legal name: ${nameForCtx}`,
        `- Commercial Registration: ${args.company.cr || "(not registered yet)"}`,
        `- VAT No.: ${args.company.vat || "(not registered yet)"}`,
        `- Address: ${addressForCtx || "(unspecified)"}`,
        `- Phone: ${args.company.phone || "(unspecified)"}`,
        `- Email: ${args.company.email || "(unspecified)"}`,
        ``,
        args.currentDocType ? `Current suggested doc_type: ${args.currentDocType}` : "",
      ]
    : [
        `طلب المستخدم:`,
        args.prompt,
        ``,
        `MERGED CONTEXT (بيانات الشركة، ممنوع اختراع غيرها):`,
        `- الاسم الرسمي: ${nameForCtx}`,
        `- السجل التجاري: ${args.company.cr || "(غير مسجل بعد)"}`,
        `- الرقم الضريبي: ${args.company.vat || "(غير مسجل بعد)"}`,
        `- العنوان: ${addressForCtx || "(غير محدد)"}`,
        `- الهاتف: ${args.company.phone || "(غير محدد)"}`,
        `- الإيميل: ${args.company.email || "(غير محدد)"}`,
        ``,
        args.currentDocType ? `النوع الحالي المقترح: ${args.currentDocType}` : "",
      ];
  const joined = userMsg.filter((l) => l.length > 0).join("\n");
  const raw = await callClaudeForDraft(env, joined, lang);
  const validated = validateAIDraft(raw);
  if ("error" in validated) {
    throw new Error(`AI JSON invalid: ${validated.error} — raw start: ${raw.slice(0, 200)}`);
  }
  return validated;
}

// ============================================================================
// Odoo writes — the three pipeline endpoints call these helpers.
// ============================================================================

async function writeDoc(env: Env, id: number, vals: Record<string, unknown>): Promise<void> {
  await call<boolean>(env, "x_official_doc", "write", { ids: [id], vals });
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// -------- preview --------
export async function runPreviewPipeline(
  env: Env,
  args: { docId: number; workerOrigin: string },
): Promise<{ previewUrl: string }> {
  const record = await readOfficialDoc(env, args.docId);
  if (!record) throw new Error(`official-doc ${args.docId} not found`);
  const company = await readCompanyInfo(env);
  const pdf = await generateOfficialDocPDF(
    { record, company, isPreview: true, numberOverride: "معاينة" },
    env,
  );
  const uploaded = await uploadOfficialDocPreview(env, pdf, args.docId, args.workerOrigin);
  await writeDoc(env, args.docId, {
    x_preview_url: uploaded.publicUrl,
    x_last_error: false,
  });
  return { previewUrl: uploaded.publicUrl };
}

// -------- issue --------
export async function runIssuePipeline(
  env: Env,
  args: { docId: number; workerOrigin: string },
): Promise<{ number: string; pdfUrl: string; issuedAt: string }> {
  const record = await readOfficialDoc(env, args.docId);
  if (!record) throw new Error(`official-doc ${args.docId} not found`);
  if (record.status === "issued") {
    throw new Error(`official-doc ${args.docId} already issued as ${record.name}`);
  }
  if (record.blocks.length === 0) {
    await writeDoc(env, args.docId, { x_last_error: "لا يوجد أي بلوك في المستند" });
    throw new Error("no blocks");
  }
  const placeholders = findPlaceholders(record.blocks);
  if (placeholders.length > 0) {
    const msg = "لا يمكن الإصدار — placeholders باقية: " + placeholders.map((p) => p.snippet).join(", ");
    await writeDoc(env, args.docId, { x_last_error: msg });
    throw new Error(msg);
  }

  const number = await nextDocNumber(env, record.date);
  const company = await readCompanyInfo(env);
  // Assign the number BEFORE render so the header shows it.
  const finalRecord: OfficialDocRecord = { ...record, name: number };
  const pdf = await generateOfficialDocPDF(
    { record: finalRecord, company, isPreview: false },
    env,
  );
  const uploaded = await uploadOfficialDocFinal(env, pdf, number, args.workerOrigin);

  const issuedAt = nowOdoo();
  await writeDoc(env, args.docId, {
    x_name: number,
    x_pdf_url: uploaded.publicUrl,
    x_issued_at: issuedAt,
    x_status: "issued",
    x_last_error: false,
  });
  return { number, pdfUrl: uploaded.publicUrl, issuedAt };
}

// -------- ai-draft --------
export async function runAIDraftPipeline(
  env: Env,
  args: { docId: number },
): Promise<{ blocksWritten: number }> {
  const record = await readOfficialDoc(env, args.docId);
  if (!record) throw new Error(`official-doc ${args.docId} not found`);
  if (record.status === "issued") throw new Error(`already issued`);
  if (!record.ai_prompt || !record.ai_prompt.trim()) {
    await writeDoc(env, args.docId, { x_last_error: "لا يوجد طلب في «الصياغة الذكية»" });
    throw new Error("no prompt");
  }
  const company = await readCompanyInfo(env);
  let draft: AIDraftResult;
  try {
    draft = await aiDraftDocument(env, {
      prompt: record.ai_prompt,
      company,
      currentDocType: record.doc_type,
      lang: record.lang,
    });
  } catch (e) {
    const msg = `Claude فشل: ${(e as Error).message}`.slice(0, 240);
    await writeDoc(env, args.docId, { x_last_error: msg });
    throw e;
  }

  // Delete existing blocks then write the draft's blocks. Odoo cascades
  // block writes cleanly for records still in draft.
  const existingIds = record.blocks.map((b) => b.id).filter((id): id is number => typeof id === "number");
  if (existingIds.length > 0) {
    await call(env, "x_official_doc_block", "unlink", { ids: existingIds });
  }
  const valsList = draft.blocks.map((b, i) => ({
    x_doc_id: args.docId,
    x_sequence: (i + 1) * 10,
    x_block_type: b.type,
    x_text: b.text,
    x_tone: b.tone,
    x_align_numbers: true,
  }));
  if (valsList.length > 0) {
    await call<number[]>(env, "x_official_doc_block", "create", { vals_list: valsList });
  }
  // Fill the top-level fields only if empty — respect what the user typed.
  const topVals: Record<string, unknown> = { x_last_error: false };
  if (!record.recipient && draft.recipient) topVals.x_recipient = draft.recipient;
  if (!record.subject && draft.subject) topVals.x_subject = draft.subject;
  if (record.doc_type === "letter" && draft.doc_type !== "letter") {
    // Only overwrite doc_type when user is on the default (letter) and draft
    // suggests otherwise — never override an explicit user choice.
    topVals.x_doc_type = draft.doc_type;
  }
  await writeDoc(env, args.docId, topVals);
  return { blocksWritten: valsList.length };
}
