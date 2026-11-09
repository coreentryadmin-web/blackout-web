// Money / share-count formatting for the flow-brief LLM prompt (round-first-then-promote).
//
// Same "round-first-then-promote" money-formatter defect class already fixed in ~20
// other call sites across the repo (see src/lib/helix-discord-format.ts's own
// moneyShort, which this mirrors pattern-for-pattern). The code this replaced in
// src/app/api/market/flow-brief/route.ts picked a fixed K/M unit by comparing the RAW,
// unrounded value against a threshold, then rounded it INSIDE that unit's own branch —
// so a value just under a 1000x boundary rounds UP past 1000 without the label being
// promoted:
//   (999_600 / 1000).toFixed(0)      -> "1000" rendered as "$1000K" instead of "$1.0M"
//   (999_950_000 / 1e6).toFixed(1)   -> "1000.0" rendered as "$1000.0M" instead of "$1.0B"
//   (1_999_750 / 1000).toFixed(0)    -> "2000" rendered "2000K shares" instead of "2.0M shares"
// These values only feed the LLM prompt (never shown to members directly as raw JSON),
// but Claude is instructed to "explicitly name" the massive prints and quotes them close
// to verbatim in the brief it writes — so a mislabeled unit here surfaces as a visibly
// wrong number in a real member-facing flow-brief sentence.
//
// Kept in its own module (rather than inline in route.ts) so it can be unit-tested
// without pulling in the route's server-only imports (anthropic/db/unusual-whales, etc.).
export function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) {
    const mRounded = (n / 1_000_000).toFixed(1);
    if (Math.abs(Number(mRounded)) >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${mRounded}M`;
  }
  if (abs >= 1_000) {
    const kRounded = Math.round(n / 1_000);
    if (Math.abs(kRounded) >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${kRounded}K`;
  }
  return `$${Math.round(n)}`;
}

/**
 * BUG FIX (round 489): this was missing the sub-1,000 "raw count" tier every sibling
 * share-count formatter in this repo has (e.g. `darkpool-discord-format.ts`'s `fmtShares`,
 * which this module's own header says `moneyShort` "mirrors pattern-for-pattern" — the
 * pattern it was meant to mirror but didn't). Any `n < 1000` fell straight into the K
 * branch and got rounded to the nearest WHOLE THOUSAND, not formatted as a thousands unit:
 *   sharesShort(25)  -> Math.round(25 / 1000)  = Math.round(0.025) = 0  -> "0K"
 *   sharesShort(500) -> Math.round(500 / 1000) = Math.round(0.5)   = 1  -> "1K"
 * Reachable in production, not just a theoretical boundary: this function's one real call
 * site (`flow-brief/route.ts`'s dark-pool block line) only gates on PREMIUM (`>= $15M`),
 * never on share count, and `share_size` is an independent upstream field — a $15M+ block
 * in an ultra-high-priced name (e.g. BRK.A, ~$600K+/share) is tens of shares, not thousands.
 * A real 25-share BRK.A block would render "~0K shares" in a member-facing flow-brief
 * sentence, understating the actual print by three orders of magnitude while looking like
 * a plausible, honest number. Fix: add the same `< 1,000` raw-count tier `moneyShort` (this
 * file) and `fmtShares` (darkpool-discord-format.ts) already have.
 */
export function sharesShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const kRounded = Math.round(n / 1_000);
    if (Math.abs(kRounded) >= 1_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${kRounded}K`;
  }
  return `${Math.round(n)}`;
}
