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

interface MetaTemplate {
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
}

export interface TemplateSyncReport {
  fetched: number;
  by_status: Record<string, number>;
  updated: number;
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

async function loadOdooTemplates(env: Env): Promise<OdooTemplateRow[]> {
  return await call<OdooTemplateRow[]>(env, "x_whatsapp_template", "search_read", {
    domain: [],
    fields: ["id", "x_meta_template_id", "x_language", "x_missing_in_meta", "x_label_ar", "x_name", "x_purpose"],
    limit: 2000,
  });
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

  for (const t of metaTemplates) {
    const key = keyOf(t.name, t.language);
    seenKeys.add(key);
    const { body, buttons } = extractBodyAndButtons(t);
    const paramCount = countBodyParams(body);
    const existing = odooByKey.get(key);
    try {
      if (existing) {
        // ONLY the new fields — never x_meta_template_id / x_language / x_purpose
        const vals: Record<string, unknown> = {
          x_meta_id: t.id,
          x_meta_status: t.status,
          x_category: t.category,
          x_body: body,
          x_param_count: paramCount,
          x_buttons: buttons,
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
        await call<boolean>(env, "x_whatsapp_template", "write", {
          ids: [existing.id],
          vals,
        });
        report.updated++;
      } else {
        // New — x_purpose left unset so fetchMapping never picks it.
        const desired = pickArabicLabel(t.name);
        await call<number[]>(env, "x_whatsapp_template", "create", {
          vals_list: [{
            x_meta_template_id: t.name,
            x_language: t.language,
            x_meta_id: t.id,
            x_meta_status: t.status,
            x_category: t.category,
            x_body: body,
            x_param_count: paramCount,
            x_buttons: buttons,
            x_last_synced: nowOdoo(),
            x_missing_in_meta: false,
            x_label_ar: desired,
            x_name: desired,
          }],
        });
        report.created++;
        report.created_names.push(`${t.name}/${t.language}`);
      }
    } catch (e) {
      report.errors.push(`${t.name}/${t.language}: ${(e as Error).message}`);
    }
  }

  // Odoo rows the syncer has not seen this run: flag as missing_in_meta.
  // Rows already flagged in a prior run stay flagged — no delete, ever.
  for (const r of odooRows) {
    if (typeof r.x_meta_template_id !== "string" || !r.x_meta_template_id) continue;
    const lang = typeof r.x_language === "string" ? r.x_language : "";
    if (seenKeys.has(keyOf(r.x_meta_template_id, lang))) continue;
    try {
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
