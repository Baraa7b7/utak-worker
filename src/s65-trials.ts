// § 65 (2026-10-07) — the three trials of the suppliers' registry to Baraa's own
// number («🧪 تجربة»), each only while his 24h window is open, once a day:
//
//   signup   the registration form «تسجيل مورد» (he fills it as a farmer): its card
//            is a NEW one flagged «محاكاة», with no number — his own card is not
//            touched;
//   offer    «📦 بضاعتي جاهزة»: its row is an x_price_offer flagged «محاكاة»;
//   market   the day's market price form with «المقاس» and «المنشأ», then
//            «➕ صنف إضافي»: its rows are flagged «محاكاة».
//
// A row flagged «محاكاة» is read by no number (§ 37 ج), and the two kinds of
// rows the forms add are «خاص» as well. Nobody but Baraa is reached, and a
// closed window burns no attempt (the caller is told «window_closed»).

import type { Env } from "./config";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";

export const S65_TRIALS = ["signup", "offer", "market"] as const;
export type S65Trial = (typeof S65_TRIALS)[number];
const DAY_TTL = 26 * 60 * 60;

export async function sendS65Trial(env: Env, name: string, now: number = Date.now()): Promise<{ trial: string; sent: boolean; reason?: string; token?: string }> {
  if (!(S65_TRIALS as readonly string[]).includes(name)) return { trial: name, sent: false, reason: "unknown_trial" };
  if (name === "signup") {
    const { sendSignupTest } = await import("./supplier-registry");
    return { trial: name, ...(await sendSignupTest(env, now)) };
  }
  if (name === "offer") {
    const { sendOfferTest } = await import("./supplier-offer");
    return { trial: name, ...(await sendOfferTest(env, now)) };
  }
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { trial: name, sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { trial: name, sent: false, reason: "window_closed" };
  const { PRICE_FLOW_ID, sendFlowAsk } = await import("./price-flow");
  const claim = await claimButton(env, `pflow_test_sim:${PRICE_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { trial: name, sent: false, reason: "already_today" };
  try {
    // the trial's rows hang on Baraa's own partner (the card of his number), flagged «محاكاة»
    const { findCardByNumber } = await import("./supplier-registry");
    const card = await findCardByNumber(env, `+${owner}`).catch(() => null);
    if (!card) { await releaseButton(env, claim); return { trial: name, sent: false, reason: "no_owner_partner" }; }
    const r = await sendFlowAsk(env, { partnerId: card.id, name: "براء", whatsapp: owner, supplier: false, role: "market" }, { now, test: true, sim: true });
    if (!r.via) { await releaseButton(env, claim); return { trial: name, sent: false, reason: r.reason }; }
    await finishButton(env, claim, DAY_TTL);
    return { trial: name, sent: true, token: r.token };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
