/**
 * What a SET of prints says about direction — and how much of that set could be read at all.
 *
 * Used by every HELIX surface that renders a directional verdict over aggregated premium: the
 * Expiry Concentration bars, the Net Premium leaderboard, and the ticker drawer's bias pill. One
 * derivation, because three surfaces on one page silently disagreeing about what "bullish" means
 * is the failure this whole lane keeps finding.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * THREE surfaces coloured a directional verdict from option type alone:
 *
 *     ExpiryConcentration   callPct = callPremium / (call + put);  isBull = callPct >= 55
 *     NetPremiumLeaderboard isBull  = (calls - puts) >= 0          -> a green triangle-up
 *     TickerDrawer          isBull  = callPrem >= putPrem          -> a green "up N% calls" pill
 *
 * Calls dominate a bucket → green. But a call that was SOLD is bearish, and #2691 replaced exactly
 * this rule everywhere else on the same page (`flowDirection`, `DIRECTION_BASIS`). So the tide bar
 * and the split-flow radar read one rule while the panel between them read the one they replaced.
 * Two components on one page can paint opposite colours from the same tape.
 *
 * MEASURED, live production tape, 5000 rows / 168h, 2026-08-23. All four expiry horizons rendered
 * BULLISH GREEN and **all four disagree** with the shipped rule:
 *
 *   horizon      total prem   readable   aggression-aware   of readable CALL premium, SOLD
 *   0DTE         $149.6M        63.0%    mixed              42.7%
 *   This week     $62.1M        84.7%    mixed              50.7%
 *   Monthly       $2.17B         6.1%    undetermined       59.2%
 *   LEAPS         $8.46B         3.2%    undetermined       45.4%
 *
 * "This week" is the sharpest single number: bearish premium ($26.302M) slightly EXCEEDS bullish
 * ($26.232M), and the bar was green.
 *
 * The Net Premium leaderboard, measured the same run: **7 of its top 10 tickers disagree** with the
 * arrow they render. The worst is its own top row — **SPX, a green triangle-up over $4.02B of net
 * premium whose direction is 0.1% readable.** Three tickers (AMD, MU, SMH) agree, so the honest
 * rule does not simply flatten the panel; it keeps the verdicts that have evidence behind them.
 *
 * ── THE SECOND DEFECT, WHICH IS THE LARGER ONE ──────────────────────────────────────────────────
 *
 * `ask_pct` is a Group A field (HELIX-MAP §4A), and Monthly/LEAPS are dominated by the SPX/SPY
 * index feed, which does not carry it. So the direction of **94% of Monthly premium and 97% of
 * LEAPS premium is not readable at all** — and the panel painted a confident green over it.
 *
 * A colour asserted over unreadable data is worse than no colour: it is indistinguishable, to the
 * member, from one backed by evidence. So `readablePct` is part of the verdict rather than a
 * diagnostic, and the caller renders it. `directionLabel` already refuses a verdict when more
 * premium is unreadable than readable; this module keeps the number that refusal was made from,
 * because "neutral" and "could not read" must not look the same on screen.
 *
 * ── WHAT IS KEPT, DELIBERATELY ──────────────────────────────────────────────────────────────────
 *
 * `callPremium` / `putPremium` survive untouched. They are the panel's own native fact, and the
 * Largo product contract is ADDITIVE: normalising a product's intelligence away to satisfy a shared
 * shape is a violation, not compliance. They simply no longer decide the colour.
 */
import {
  directionLabel,
  directionalPremium,
  type DirectionalPremium,
  type FlowDirection,
} from "./helix-flow-aggression";

/** A print, as much of one as this module needs. */
export type DirectionReadFlow = {
  option_type?: string | null;
  ask_pct?: number | null;
  premium: number;
};

export type DirectionRead = {
  /** The shipped four-way verdict, or `mixed` / `undetermined`. */
  label: FlowDirection | "mixed";
  /** The premium split the verdict was drawn from. */
  premium: DirectionalPremium;
  /** Share of this horizon's total premium whose direction could be read, 0–100. `null` when the
   *  horizon carries no premium at all — never 0, which would read as "measured, none readable"
   *  when nothing was measured. */
  readablePct: number | null;
  /** True when the verdict rests on a minority of the premium. The colour must stay neutral here
   *  even if the readable slice leans hard, and the surface must SAY so. */
  minorityEvidence: boolean;
};

/** Below this share of readable premium, a directional colour is not honest. */
export const MIN_READABLE_PCT_FOR_COLOR = 50;

export function readDirection(flows: readonly DirectionReadFlow[]): DirectionRead {
  const premium = directionalPremium(flows);
  const readable = premium.bullish + premium.bearish;
  const total = readable + premium.undetermined;

  const readablePct = total > 0 ? (readable / total) * 100 : null;
  const minorityEvidence = readablePct == null || readablePct < MIN_READABLE_PCT_FOR_COLOR;

  // `directionLabel` already refuses when unreadable > readable. The extra gate here is the same
  // rule stated as a share so the SURFACE can use the number, not a second threshold: at exactly
  // 50% the two agree, and below it both refuse.
  const label = minorityEvidence ? "undetermined" : directionLabel(premium);

  return { label, premium, readablePct, minorityEvidence };
}

/** The colour class a horizon earns. `null` = neutral, which is the honest default. */
export function directionTone(d: DirectionRead): "bull" | "bear" | null {
  if (d.minorityEvidence) return null;
  if (d.label === "bullish") return "bull";
  if (d.label === "bearish") return "bear";
  return null;
}

/**
 * The row's tooltip. States the basis, the split, and — the part that matters — how much premium
 * the read covers, so a neutral bar is legible as "could not read" rather than "balanced".
 */
export function readDirectionTitle(d: DirectionRead): string {
  const usd = (n: number) =>
    "$" + Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  if (d.readablePct == null) {
    return "No premium in this horizon to read a direction from.";
  }
  const share = `${Math.round(d.readablePct * 10) / 10}% of this horizon's premium`;
  const split = `${usd(d.premium.bullish)} bullish vs ${usd(d.premium.bearish)} bearish`;
  const unread = `${usd(d.premium.undetermined)} could not be read (no ask-side data — the index feed does not report it)`;

  if (d.minorityEvidence) {
    // Says the colour is withheld and why, rather than letting neutral imply balance.
    return `Direction not shown: only ${share} carries the ask-side data needed to read it. Of that slice, ${split}. ${unread}.`;
  }
  return `Direction read from ${share}: ${split}. ${unread}. Bought calls and sold puts are bullish; sold calls and bought puts are bearish.`;
}
