// 2026-09-24 — deterministic template choice for an x_purpose.
//
// fetchMapping / getTemplateByPurpose used to read `limit: 1` with no order,
// so when two x_whatsapp_template rows shared a purpose (collection_summary,
// purchase_list, driver_dispatch until 09-24) the row that went out depended
// on Odoo's default ordering. Now every candidate is read and ranked here:
//
//   1. x_meta_status = APPROVED (Meta refuses anything else)
//   2. x_param_count equals the number of params the caller will send
//   3. x_category = UTILITY (a MARKETING template for a service message is
//      the wrong category and costs more)
//   4. highest id (the most recently registered row)
//
// More than one candidate is still a data error: the caller logs it and
// alerts the owner (see reportDuplicatePurpose in templates.ts).

export interface TemplateCandidate {
  id: number;
  x_meta_template_id: string;
  x_language: string | false;
  x_param_count?: number | false;
  x_meta_status?: string | false;
  x_category?: string | false;
}

export const TEMPLATE_CANDIDATE_FIELDS = [
  "id",
  "x_meta_template_id",
  "x_language",
  "x_param_count",
  "x_meta_status",
  "x_category",
];

/** Ranks candidates; `paramCountFor(name)` = params the caller sends to that template (null = unknown). */
export function pickTemplate<T extends TemplateCandidate>(
  rows: T[],
  paramCountFor: (templateName: string) => number | null = () => null,
): T | null {
  if (rows.length === 0) return null;
  const score = (r: T): number[] => {
    const want = paramCountFor(r.x_meta_template_id);
    return [
      r.x_meta_status === "APPROVED" ? 1 : 0,
      want !== null && r.x_param_count === want ? 1 : 0,
      r.x_category === "UTILITY" ? 1 : 0,
      r.id,
    ];
  };
  return [...rows].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  })[0];
}

/** Purposes held by more than one row. "other" is the "no purpose" value and never counts. */
export function findDuplicatePurposes(
  rows: Array<{ id: number; x_purpose?: string | false; x_meta_template_id?: string | false }>,
): Record<string, string[]> {
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const p = typeof r.x_purpose === "string" ? r.x_purpose : "";
    if (!p || p === "other") continue;
    const list = by.get(p) ?? [];
    list.push(`${r.x_meta_template_id || "?"}#${r.id}`);
    by.set(p, list);
  }
  const out: Record<string, string[]> = {};
  for (const [p, list] of by) if (list.length > 1) out[p] = list;
  return out;
}
