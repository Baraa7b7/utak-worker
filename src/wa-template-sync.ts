// Phase 1 — Template sync Meta → Odoo.
//
// Match rules (per spec):
//  - Match Odoo x_whatsapp_template records by (x_meta_template_id, x_language).
//  - Existing row → write ONLY new fields (x_meta_id, x_meta_status, x_category,
//    x_body, x_param_count, x_buttons, x_last_synced, x_missing_in_meta=false).
//    Never touches x_meta_template_id / x_language / x_purpose — these are the
//    fields the sender uses to pick a template (see src/templates.ts::fetchMapping).
//  - Missing in Odoo → create row with the new fields + x_meta_template_id +
//    x_language filled, x_purpose left empty so automated flows never
//    auto-select it. Baraa can wire it later via the form.
//  - Missing in Meta → x_missing_in_meta = true, no delete.
//  - 2026-09-25 (STATUS § 36) — x_body_text is the approved text as the
//    recipient reads it: a text header, the body and the footer, one per
//    line, {{n}} unfilled; x_buttons_text is the button labels, one per line.
//    The gateway renders every template send from them (src/wa-record.ts),
//    so Discuss and x_wa_message show the message, not the template's name.
//
// Arabic labels (2026-09-21):
//  - x_label_ar is the source of truth for the human-friendly Arabic name; the
//    map lives in wa-template-labels.json — one file, one line per template.
//    A NEW template picks its label from the map (fallback = technical name so
//    no row ever renders blank). An EXISTING label is never overwritten — if
//    Baraa renamed a template from the form, that hand-picked name survives
//    every sync.
//  - x_name (Odoo's rec_name → drives display_name) is a display mirror of the
//    final x_label_ar, rewritten on every sync so list/form views always show
//    the Arabic label and never the raw utak_* technical name. Rewrites are
//    skipped when the value already matches, so we don't churn on every run.

import type { Env } from "./config";
import { call } from "./odoo";
import AR_LABELS from "./wa-template-labels.json" with { type: "json" };
import { findDuplicatePurposes } from "./template-pick";
import { sendOwnerAlert } from "./templates";

/**
 * Arabic label to display for a WhatsApp template in Odoo.
 * Returns the mapped Arabic name if we have one, otherwise the technical name
 * (never empty — a template with no Arabic entry is still legible in lists).
 */
export function pickArabicLabel(technicalName: string): string {
  const map = AR_LABELS as Record<string, string>;
  const ar = map[technicalName];
  return typeof ar === "string" && ar.trim() ? ar : technicalName;
}

/** True when the template has an entry in wa-template-labels.json (vs. fallback). */
export function hasArabicLabel(technicalName: string): boolean {
  const map = AR_LABELS as Record<string, string>;
  return typeof map[technicalName] === "string" && map[technicalName].trim().length > 0;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{
    type: string;
    format?: string;
    text?: string;
    example?: unknown;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}

interface OdooTemplateRow {
  id: number;
  x_meta_template_id: string | false;
  x_language: string | false;
  x_missing_in_meta?: boolean;
  x_label_ar?: string | false;
  x_name?: string | false;
  x_purpose?: string | false;
  /** § 67 ب — the synced values as Odoo holds them (absent when this Odoo could not be read for them). */
  [synced: string]: unknown;
}

// § 67 ب — the sync used to write EVERY row, one call after another with no pause: 77 writes in 8 seconds
// on 2026-10-08 (02:01:19–02:01:26 UTC), after which Odoo's limiter answered 429 to the worker for minutes.
// Now a row is written only when Meta's values differ from Odoo's, the writes are spaced, and the rows that
// did not change get «آخر مزامنة» in ONE call.
export const SYNC_WRITE_SPACING_MS = 400;
let syncSleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tests only: replace the pause between two writes. */
export function setSyncSleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  syncSleep = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}
const SYNCED_FIELDS = ["x_meta_id", "x_meta_status", "x_category", "x_body", "x_param_count", "x_buttons", "x_body_text", "x_buttons_text"];
const same = (a: unknown, b: unknown): boolean => String(a === false || a == null ? "" : a) === String(b === false || b == null ? "" : b);
/** Does this row already hold what Meta says? False when Odoo's values were not read. */
export function rowInSync(row: Record<string, unknown>, synced: Record<string, unknown>): boolean {
  return Object.entries(synced).every(([k, v]) => k in row && same(row[k], v));
}

export interface TemplateSyncReport {
  fetched: number;
  by_status: Record<string, number>;
  updated: number;
  /** § 67 ب — of `updated`: the rows that needed a write of their own (the rest got «آخر مزامنة» in one call). */
  written?: number;
  created: number;
  missing_in_meta: number;
  missing_in_meta_names: string[];
  created_names: string[];
  /** 2026-09-24 — x_purpose values held by more than one row ("other" excluded). */
  duplicate_purposes: Record<string, string[]>;
  errors: string[];
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Count body params — Meta encodes them as `{{1}}`, `{{2}}`, …
function countBodyParams(body: string): number {
  const matches = body.match(/\{\{\d+\}\}/g);
  if (!matches) return 0;
  const nums = new Set(matches.map((m) => Number(m.replace(/[^0-9]/g, ""))));
  return nums.size;
}

/**
 * § 36 — the approved text (text header, body, footer — one per line) and the
 * button labels (one per line) of a Meta template.
 */
export function templateDisplayText(tpl: Pick<MetaTemplate, "components">): { bodyText: string; buttonsText: string } {
  const comps = tpl.components ?? [];
  const header = comps.find((c) => c.type === "HEADER" && c.format === "TEXT" && typeof c.text === "string")?.text ?? "";
  const body = comps.find((c) => c.type === "BODY" && typeof c.text === "string")?.text ?? "";
  const footer = comps.find((c) => c.type === "FOOTER" && typeof c.text === "string")?.text ?? "";
  const buttons = comps.find((c) => c.type === "BUTTONS" && Array.isArray(c.buttons))?.buttons ?? [];
  return {
    bodyText: [header, body, footer].map((t) => t.trim()).filter(Boolean).join("\n"),
    buttonsText: buttons.map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n"),
  };
}

/** Every value the sync writes from a Meta template (labels excepted). */
export function templateSyncVals(t: MetaTemplate): Record<string, unknown> {
  const { body, buttons } = extractBodyAndButtons(t);
  const { bodyText, buttonsText } = templateDisplayText(t);
  return {
    x_meta_id: t.id,
    x_meta_status: t.status,
    x_category: t.category,
    x_body: body,
    x_param_count: countBodyParams(body),
    x_buttons: buttons,
    x_body_text: bodyText,
    x_buttons_text: buttonsText,
  };
}

/** The § 36 text fields: left out of a write when this Odoo does not have them yet. */
const TEXT_FIELDS = ["x_body_text", "x_buttons_text"];
function withoutTextFields(vals: Record<string, unknown>): Record<string, unknown> {
  const v = { ...vals };
  for (const f of TEXT_FIELDS) delete v[f];
  return v;
}
function missingTextField(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return TEXT_FIELDS.some((f) => m.includes(f));
}

function extractBodyAndButtons(tpl: MetaTemplate): { body: string; buttons: string } {
  let body = "";
  let buttonsSummary = "";
  for (const c of tpl.components ?? []) {
    if (c.type === "BODY" && typeof c.text === "string") {
      body = c.text;
    }
    if (c.type === "BUTTONS" && Array.isArray(c.buttons)) {
      buttonsSummary = c.buttons
        .map((b, i) => `[${i}] ${b.type} — ${b.text}${b.url ? ` → ${b.url}` : ""}${b.phone_number ? ` → ${b.phone_number}` : ""}`)
        .join("\n");
    }
  }
  return { body, buttons: buttonsSummary };
}

async function fetchAllMetaTemplates(env: Env): Promise<MetaTemplate[]> {
  const graphVersion = env.META_GRAPH_VERSION;
  const wabaId = env.META_WABA_ID;
  const token = env.META_ACCESS_TOKEN;
  const collected: MetaTemplate[] = [];
  let url: string | null =
    `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components`;
  // Guard against a broken paging cursor — abort after 20 pages (2000 templates).
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meta templates list failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: MetaTemplate[]; paging?: { next?: string } };
    for (const t of json.data ?? []) collected.push(t);
    url = json.paging?.next ?? null;
  }
  return collected;
}

/**
 * § 52 د — ONE template's status and category as Meta holds them now (one GET
 * by name), copied to its Odoo row(s) only when they differ. For a template
 * that must be re-checked right before it is used: Meta files a template
 * MARKETING after approving it (§ 34, § 51), and the daily sync is at 05:00.
 * «missing» when Meta does not list it (the row is left as it is). Throws on
 * Meta or Odoo trouble.
 */
export async function syncOneTemplate(env: Env, name: string): Promise<"changed" | "same" | "missing"> {
  const res = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_WABA_ID}/message_templates?name=${encodeURIComponent(name)}&limit=50&fields=id,name,language,status,category`,
    { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`Meta template read failed: HTTP ${res.status}`);
  const t = ((await res.json()) as { data?: Array<Pick<MetaTemplate, "id" | "name" | "status" | "category">> }).data?.find((x) => x.name === name);
  if (!t) return "missing";
  const rows = await call<Array<{ id: number; x_meta_status?: string | false; x_category?: string | false }>>(env, "x_whatsapp_template", "search_read", {
    domain: [["x_meta_template_id", "=", name]], fields: ["id", "x_meta_status", "x_category"], limit: 5,
  });
  const off = rows.filter((r) => String(r.x_meta_status || "") !== t.status || String(r.x_category || "") !== t.category);
  if (!off.length) return "same";
  await call(env, "x_whatsapp_template", "write", { ids: off.map((r) => r.id), vals: { x_meta_status: t.status, x_category: t.category, x_last_synced: nowOdoo() } });
  return "changed";
}

async function loadOdooTemplates(env: Env): Promise<OdooTemplateRow[]> {
  const base = ["id", "x_meta_template_id", "x_language", "x_missing_in_meta", "x_label_ar", "x_name", "x_purpose"];
  try {
    return await call<OdooTemplateRow[]>(env, "x_whatsapp_template", "search_read", { domain: [], fields: [...base, ...SYNCED_FIELDS], limit: 2000 });
  } catch (e) {
    // an Odoo without the § 36 text fields: every row counts as changed, as before § 67
    if (!missingTextField(e)) throw e;
    return await call<OdooTemplateRow[]>(env, "x_whatsapp_template", "search_read", { domain: [], fields: base, limit: 2000 });
  }
}

function keyOf(name: string, lang: string): string {
  return `${name}::${(lang || "").toLowerCase()}`;
}

export async function syncTemplates(env: Env): Promise<TemplateSyncReport> {
  const report: TemplateSyncReport = {
    fetched: 0,
    by_status: {},
    updated: 0,
    created: 0,
    missing_in_meta: 0,
    missing_in_meta_names: [],
    created_names: [],
    duplicate_purposes: {},
    errors: [],
  };

  let metaTemplates: MetaTemplate[];
  try {
    metaTemplates = await fetchAllMetaTemplates(env);
  } catch (e) {
    report.errors.push(`meta fetch: ${(e as Error).message}`);
    return report;
  }
  report.fetched = metaTemplates.length;
  for (const t of metaTemplates) {
    report.by_status[t.status] = (report.by_status[t.status] ?? 0) + 1;
  }

  const odooRows = await loadOdooTemplates(env);
  // The sync never writes x_purpose, so this is a read-only check; the owner
  // alert goes out from runTemplateSync.
  report.duplicate_purposes = findDuplicatePurposes(odooRows);
  const odooByKey = new Map<string, OdooTemplateRow>();
  for (const r of odooRows) {
    if (typeof r.x_meta_template_id === "string" && r.x_meta_template_id) {
      const lang = typeof r.x_language === "string" ? r.x_language : "";
      odooByKey.set(keyOf(r.x_meta_template_id, lang), r);
    }
  }
  const seenKeys = new Set<string>();
  // § 36 — an Odoo without x_body_text / x_buttons_text (setup not run yet):
  // those two are left out for the rest of the run, nothing else changes.
  let textFields = true;
  const write = async (ids: number[], vals: Record<string, unknown>) => {
    try {
      await call<boolean>(env, "x_whatsapp_template", "write", { ids, vals: textFields ? vals : withoutTextFields(vals) });
    } catch (e) {
      if (!textFields || !missingTextField(e)) throw e;
      textFields = false;
      console.warn("[wa-sync] x_body_text / x_buttons_text missing in Odoo — synced without them");
      await call<boolean>(env, "x_whatsapp_template", "write", { ids, vals: withoutTextFields(vals) });
    }
  };
  const create = async (vals: Record<string, unknown>) => {
    try {
      await call<number[]>(env, "x_whatsapp_template", "create", { vals_list: [textFields ? vals : withoutTextFields(vals)] });
    } catch (e) {
      if (!textFields || !missingTextField(e)) throw e;
      textFields = false;
      await call<number[]>(env, "x_whatsapp_template", "create", { vals_list: [withoutTextFields(vals)] });
    }
  };

  const unchanged: number[] = [];
  let wrote = 0;
  for (const t of metaTemplates) {
    const key = keyOf(t.name, t.language);
    seenKeys.add(key);
    const synced = templateSyncVals(t);
    const existing = odooByKey.get(key);
    try {
      if (existing) {
        // ONLY the new fields — never x_meta_template_id / x_language / x_purpose
        const vals: Record<string, unknown> = {
          ...synced,
          x_last_synced: nowOdoo(),
          x_missing_in_meta: false,
        };
        // Two-tier label handling:
        //   x_label_ar (source of truth, human-picked) → back-filled only when
        //     empty; a value Baraa set from the form is never overwritten.
        //   x_name (display mirror; Odoo's rec_name = x_name so display_name
        //     is derived from it) → always rewritten to match the final
        //     x_label_ar so list/form views always show the Arabic name and
        //     never the raw utak_* technical name.
        const currentLabel = typeof existing.x_label_ar === "string" ? existing.x_label_ar.trim() : "";
        const desired = pickArabicLabel(t.name);
        const finalLabel = currentLabel || desired;
        if (!currentLabel) vals.x_label_ar = desired;
        // Only touch x_name when it does not already match finalLabel — avoids
        // pointless writes but ensures the display column is always Arabic.
        const currentName = typeof existing.x_name === "string" ? existing.x_name.trim() : "";
        if (currentName !== finalLabel) vals.x_name = finalLabel;
        // § 67 ب — nothing to say about this row: no call of its own (its «آخر مزامنة» goes with the others below)
        if (rowInSync(existing, synced) && existing.x_missing_in_meta !== true && !("x_label_ar" in vals) && !("x_name" in vals)) {
          unchanged.push(existing.id);
          report.updated++;
          continue;
        }
        if (wrote++ > 0) await syncSleep(SYNC_WRITE_SPACING_MS);
        await write([existing.id], vals);
        report.updated++;
      } else {
        // New — x_purpose left unset so fetchMapping never picks it.
        const desired = pickArabicLabel(t.name);
        if (wrote++ > 0) await syncSleep(SYNC_WRITE_SPACING_MS);
        await create({
          x_meta_template_id: t.name,
          x_language: t.language,
          ...synced,
          x_last_synced: nowOdoo(),
          x_missing_in_meta: false,
          x_label_ar: desired,
          x_name: desired,
        });
        report.created++;
        report.created_names.push(`${t.name}/${t.language}`);
      }
    } catch (e) {
      report.errors.push(`${t.name}/${t.language}: ${(e as Error).message}`);
    }
  }

  report.written = wrote;
  // § 67 ب — the rows Meta and Odoo agree on: «آخر مزامنة» for all of them in ONE call
  if (unchanged.length) {
    try {
      if (wrote > 0) await syncSleep(SYNC_WRITE_SPACING_MS);
      await call<boolean>(env, "x_whatsapp_template", "write", { ids: unchanged, vals: { x_last_synced: nowOdoo() } });
    } catch (e) {
      report.errors.push(`last-synced of ${unchanged.length} unchanged rows: ${(e as Error).message}`);
    }
  }

  // Odoo rows the syncer has not seen this run: flag as missing_in_meta.
  // Rows already flagged in a prior run stay flagged — no delete, ever.
  for (const r of odooRows) {
    if (typeof r.x_meta_template_id !== "string" || !r.x_meta_template_id) continue;
    const lang = typeof r.x_language === "string" ? r.x_language : "";
    if (seenKeys.has(keyOf(r.x_meta_template_id, lang))) continue;
    // already flagged in an earlier run: nothing new to write
    if (r.x_missing_in_meta === true) { report.missing_in_meta++; report.missing_in_meta_names.push(`${r.x_meta_template_id}/${lang}`); continue; }
    try {
      await syncSleep(SYNC_WRITE_SPACING_MS);
      await call<boolean>(env, "x_whatsapp_template", "write", {
        ids: [r.id],
        vals: { x_missing_in_meta: true, x_last_synced: nowOdoo() },
      });
      report.missing_in_meta++;
      report.missing_in_meta_names.push(`${r.x_meta_template_id}/${lang}`);
    } catch (e) {
      report.errors.push(`mark-missing ${r.x_meta_template_id}: ${(e as Error).message}`);
    }
  }

  return report;
}

// ---- Reset the control-singleton flag after a sync round ----
async function writeControlAfterSync(env: Env, report: TemplateSyncReport): Promise<void> {
  try {
    const rows = await call<Array<{ id: number }>>(env, "x_wa_control", "search_read", {
      domain: [], fields: ["id"], limit: 1,
    });
    const summary = [
      `fetched=${report.fetched}`,
      Object.entries(report.by_status).map(([k, v]) => `${k}=${v}`).join(" "),
      `updated=${report.updated}`,
      `created=${report.created}`,
      `missing_in_meta=${report.missing_in_meta}`,
      Object.keys(report.duplicate_purposes).length
        ? `duplicate_purposes=${Object.keys(report.duplicate_purposes).join(",")}` : "",
      report.errors.length ? `errors=${report.errors.length}` : "",
    ].filter(Boolean).join(" · ");
    const vals: Record<string, unknown> = {
      x_sync_requested: false,
      x_last_sync_at: nowOdoo(),
      x_last_sync_result: summary,
    };
    if (rows[0]) {
      await call(env, "x_wa_control", "write", { ids: [rows[0].id], vals });
    } else {
      await call(env, "x_wa_control", "create", {
        vals_list: [{ x_name: "Control", ...vals }],
      });
    }
  } catch (e) {
    console.warn("[wa-sync] writeControlAfterSync failed", (e as Error)?.message);
  }
}

// ---- Public entry point — used by the hook AND the 05:00 cron append. ----
export async function runTemplateSync(env: Env): Promise<TemplateSyncReport> {
  const report = await syncTemplates(env);
  await writeControlAfterSync(env, report);
  const dups = Object.entries(report.duplicate_purposes);
  if (dups.length) {
    const text = dups.map(([p, list]) => `${p}: ${list.join("، ")}`).join(" | ");
    console.error(`[wa-sync] duplicate x_purpose — ${text}`);
    try {
      await sendOwnerAlert(env, `مزامنة قوالب واتساب: غرض مربوط بأكثر من قالب — ${text}. اترك قالباً واحداً لكل غرض.`);
    } catch (e) {
      console.warn("[wa-sync] duplicate alert failed", (e as Error)?.message);
    }
  }
  return report;
}
