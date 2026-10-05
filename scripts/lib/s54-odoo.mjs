// § 54 (2026-10-05) — what § 54 puts in Odoo, as data: one source for scripts/s54-20261005-odoo.mjs
// (which writes it to the tenant) and tests/s54.test.mts (which reads the pieces).
//
//   أ  x_pricing_config.x_above_suggested «لما يكون السوق أعلى من المقترح» — a selection of two values,
//      «بسعر السوق» (market, the default: what the worker did before § 54) and «بالمقترح» (suggested:
//      cheaper than the market) — = «بسعر السوق» on the active record, shown in «💲 التسعير» ←
//      «⚙️ الإعدادات» right after «زيادة على سعر السوق ٪» (§ 53).
//   ب  the sentence of the rule on three screens — «📊 اليوم» (utak.price_day_form), the board
//      (utak.pricing_board_form) and «⚙️ الإعدادات» — said «سعر البيع = سعر السوق متى بلغ المقترح، وغير
//      ذلك استثناء»: it is § 54's rule now (NOTES).
// Nothing else: Baraa's decisions land in the fields the line already has (x_decision,
// x_manual_price, x_manual_for, x_decided_at, x_status, x_sale_price, x_excluded).

export const ABOVE_FIELD = "x_above_suggested";
export const ABOVE_LABEL = "لما يكون السوق أعلى من المقترح";
/** [value, label] — the values are the ones src/pricing-engine.ts reads (aboveSuggestedOf). */
export const ABOVE_OPTIONS = [["market", "بسعر السوق"], ["suggested", "بالمقترح"]];
export const ABOVE_DEFAULT = "market";
export const ABOVE_SELECTION = `[${ABOVE_OPTIONS.map(([v, l]) => `('${v}', '${l}')`).join(", ")}]`;
export const CFG_FIELDS = [
  { name: ABOVE_FIELD, ttype: "selection", selection: ABOVE_SELECTION, field_description: ABOVE_LABEL,
    help: "القرار المقترح لصنف سعر سوقه (بعد «زيادة على سعر السوق ٪») يصل «السعر المربح المقترح» أو يتجاوزه: «بسعر السوق» ينشره بسعر السوق (الافتراضي)، و«بالمقترح» ينشره بالسعر المقترح (أرخص من السوق). الصنف الذي سوقه بين «أقل سعر بيع بدون خسارة» والمقترح يُنشر بسعر السوق دائماً، وما سوقه أقل من «بدون خسارة» لا يُنشر بلا قرارك." },
];

/** «⚙️ الإعدادات» (utak.pricing_settings_form, § 48 + § 53): the setting right after «زيادة على سعر السوق ٪». */
export const SETTINGS_VIEW = "utak.pricing_settings_form";
const ABOVE_MARK = `<field name="${ABOVE_FIELD}"/>`;
const UPLIFT_53 = /<field name="x_market_uplift_pct"\/>/;
export function settingsArch(arch) {
  if (arch.includes(ABOVE_MARK)) return arch;
  if (!UPLIFT_53.test(arch)) throw new Error("⚙️ الإعدادات: «زيادة على سعر السوق ٪» was not found in the form — stop (§ 53 not applied, or the view was changed by hand?)");
  return arch.replace(UPLIFT_53, (m) => `${m}\n        ${ABOVE_MARK}`);
}

// ---------------------------------------------------------------- ب the rule's sentence on the screens
const RULE_54 = "سوق بين «بدون خسارة» والمقترح يُنشر تلقائياً بسعر السوق، وسوق فوق المقترح حسب «لما يكون السوق أعلى من المقترح» في الإعدادات. بلا شراء، أو بلا سوق، أو سوق أقل من «بدون خسارة»، أو سعر شاذ: ينتظر قرارك في رسالة المراجعة (04:00) أو هنا، ولا يُنشر بلا قرار";
/** [view, the sentence of before § 54, the sentence now] — each `was` is one sentence of a longer note; the rest of the note stays. */
export const NOTES = [
  ["utak.price_day_form",
    "القاعدة: سعر البيع = سعر السوق متى بلغ المقترح، وغير ذلك استثناء بقرارك.",
    `القاعدة: ${RULE_54}.`],
  ["utak.pricing_board_form",
    "سعر البيع = سعر السوق متى بلغ السعر المربح المقترح، وإلا استثناء بقرارك.",
    `سعر البيع: ${RULE_54}.`],
  [SETTINGS_VIEW,
    "سعر البيع = سعر السوق لليوم متى بلغ «السعر المربح المقترح» = (الشراء + التالف + حصة الكرتون + الربح الأدنى للكرتون) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. الاستثناءات (بلا شراء، بلا سوق، سوق أقل من السعر المربح، سعر شاذ) تصل براء، وغيرها يُعتمد ويُنشر تلقائياً في موعد النشر.",
    `«السعر المربح المقترح» = (الشراء + التالف + حصة الكرتون + الربح الأدنى للكرتون) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال؛ و«بدون خسارة» هو نفسه بلا الربح الأدنى. ${RULE_54}.`],
];
/** The view's arch with the rule's sentence of § 54 (unchanged when it already carries it). */
export function noteArch(arch, was, now) {
  if (arch.includes(now)) return arch;
  if (arch.split(was).length !== 2) throw new Error(`the rule's sentence of before § 54 was not found once in the view — stop (the view was changed by hand?): ${was.slice(0, 50)}…`);
  return arch.replace(was, now);
}
