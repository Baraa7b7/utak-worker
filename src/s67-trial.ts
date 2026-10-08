// § 67 (2026-10-08) — the trial of § 67, to Baraa's number alone (`/odoo/hook/s67-trial?op=…`):
//
//   op=alert   ONE trial alert under `owner_alert` — the purpose the gateway had blocked for 24 hours on
//              2026-10-08 (Meta 131056). It goes as every alert of his goes: through the merge of § 67 هـ and the
//              gateway, inside his window (held with the opener outside it). Once a day.
//   op=state   nothing is sent: the freeze as the worker reads it now (the switch, «حتى تاريخ», the stamps),
//              and the retries and the purpose blocks waiting in KV for his number.
//
// Nothing is written in Odoo by either, and nobody but Baraa is reached.

import type { Env } from "./config";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey, riyadhHHMM } from "./hours";
import { freezeView } from "./freeze";
import { ownerAlert } from "./owner-alerts";
import { gatewayDecision, isPurposeBlock, purposeBlockKey } from "./wa-gateway";
import { readRetries } from "./wa-retry";

export const S67_TRIAL_MARK = "🧪 تجربة";
export const s67TrialText = (at: string): string =>
  `${S67_TRIAL_MARK} § 67 — تنبيه تجريبي (${at}): حجب التنبيهات رُفع، وتنبيهاتك تصلك من جديد. من الآن: خطأ Meta المؤقت (131056) يُعاد إرساله بعد دقيقة ثم 5 ثم 15 ولا يحجب شيئاً، والتنبيهات المتكررة من النوع نفسه خلال 10 دقائق رسالة واحدة. (تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)`;

export interface S67TrialResult { op: string; sent?: boolean; decision?: string; reason?: string; state?: Record<string, unknown> }

export async function runS67Trial(env: Env, op: string, now: number = Date.now()): Promise<S67TrialResult> {
  if (op === "alert") {
    const claim = await claimButton(env, `s67_trial_alert:${riyadhDateKey(new Date(now))}`, 26 * 3600);
    if (!claim.claimed) return { op, sent: false, reason: "the trial alert went today already" };
    const r = await ownerAlert({ ...env, AUTO_SEND_JOB: undefined } as Env, s67TrialText(riyadhHHMM(new Date(now))), { kind: "s67_trial", now });
    const d = gatewayDecision(r.response);
    const sent = d?.action === "session" || d?.action === "held";
    if (sent) await finishButton(env, claim, 26 * 3600); else await releaseButton(env, claim);
    return { op, sent, decision: d?.action ?? r.outcome, reason: d && "reason" in d ? d.reason : undefined };
  }
  const v = await freezeView(env, now, { fresh: true });
  const owner = String(env.OWNER_WHATSAPP ?? "");
  const blocks: Record<string, boolean> = {};
  for (const p of ["owner_alert", "owner_critical"]) {
    let raw: string | null = null;
    try { raw = await env.MSG_DEDUP.get(purposeBlockKey(owner, p)); } catch { raw = null; }
    blocks[p] = isPurposeBlock(raw);
  }
  return {
    op: "state",
    state: {
      frozen: v.on, switchOn: v.state.switchOn, until: v.state.until,
      since: v.state.since ? new Date(v.state.since).toISOString() : null,
      endedAt: v.state.endedAt ? new Date(v.state.endedAt).toISOString() : null,
      replyLength: v.state.reply.length,
      retriesWaiting: (await readRetries(env)).length,
      ownerBlocks: blocks,
      // a request of Odoo's is Baraa's own act (src/freeze.ts withOwnerAct): what it sends is not the system's
      ownerAct: env.OWNER_ACT ?? null,
    },
  };
}
