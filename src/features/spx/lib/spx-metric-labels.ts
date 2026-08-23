// SPX desk metric LABELS — one definition per member-facing name, so two different quantities can
// never end up wearing the same word on two different surfaces.
//
// WHY THIS FILE EXISTS. The desk and the EOD pin panel each compute a "max pain" and they are not
// the same number (SLAYER-MAP §5):
//
//   desk.max_pain  — OPEN INTEREST only, near-term multi-expiry aggregate  (gexPositioningFromHeatmap)
//   pin max pain   — OPEN INTEREST + today's intraday VOLUME, 0DTE-scoped  (pinMaxPain)
//
// Both are correct. They are two metrics wearing one word, and they routinely disagree — which
// reads to a member as one of the two panels being broken. The pin panel already disambiguated
// itself ("EFF MAX PAIN" / "effective max pain"); the desk header and the iOS desk did not, so the
// disclosure only existed on one side of a comparison that needs both.
//
// A TOOLTIP IS NOT DISCLOSURE ON A TOUCH DEVICE. The desktop header carries the full explanation in
// `METRIC_TIPS.maxPain`, which is real disclosure with a mouse and none at all on a phone — there is
// no hover, and `MetricRow` (ios/SpxIosMetricGroups.tsx) has no title prop to hang one on. On that
// surface the LABEL is the only place the basis can live, which is why this is a rename and not
// another tooltip.
//
// The labels are constants rather than literals so `spx-metric-labels.test.ts` can assert the two
// stay distinct. A rename that collapses them would otherwise be a one-character edit nothing
// catches.

/**
 * Desk header / iOS desk: max pain computed from OPEN INTEREST only, aggregated across the
 * near-term expiries the GEX matrix carries. `OI` is the disambiguator against the pin panel's
 * volume-weighted `EFF`.
 */
export const SPX_DESK_MAX_PAIN_LABEL = "OI Max Pain";

/** Lower-case variant for the iOS metric rows, whose other labels are sentence-case ("Max pain"). */
export const SPX_DESK_MAX_PAIN_LABEL_IOS = "OI max pain";

/**
 * EOD pin panel: max pain weighting OPEN INTEREST **and** today's intraday volume, 0DTE-scoped.
 * "Effective" is the pin engine's own word for that weighting (see buildDrivers()).
 */
export const SPX_PIN_MAX_PAIN_LABEL = "EFF MAX PAIN";

/** Sentence-case form used in the pin panel's driver prose. */
export const SPX_PIN_MAX_PAIN_LABEL_PROSE = "effective max pain";
