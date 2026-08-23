import { MIN_READABLE_PCT_FOR_VERDICT } from "@/features/helix/lib/helix-direction-read";

/**
 * Dark-pool buy/sell bias, gated on how much of the premium could actually be read.
 *
 * WHY THIS EXISTS. `biasFromSide` lived inline in `DarkPoolPanel.tsx` and computed
 * `buy / (buy + sell)` — a ratio whose denominator is the SIDED premium only. Prints with no
 * direction never enter it. The one guard it had fired only when NO print carried a side at all:
 *
 *     const total = buy + sell;
 *     if (total <= 0) { ...render "—"... }
 *     const r = buy / total;                    // <- everything neutral is already gone
 *
 * So an all-or-nothing population was handled and a PARTIAL one was not. With, say, 5% of premium
 * sided and leaning buy, the panel renders a confident `BULLISH` drawn from a twentieth of the
 * tape, with nothing on screen saying so. That is the absence-as-measurement failure this lane has
 * now fixed repeatedly (`_COMMON.md` #7): a rate reported without the denominator it was actually
 * computed over.
 *
 * MEASURED BEFORE CHANGING ANYTHING (2026-08-23, live production, off-hours): the market-wide feed
 * and the ticker-scoped feed for NVDA, SPY, TSLA and AAPL each returned 50 prints — **250 prints,
 * every one `neutral`, 0.0% sided premium coverage.** So the partial case is **latent, not live**:
 * today the old guard fires and the panel correctly shows `—`, and this change is behaviour-neutral
 * on current data. It is made anyway because the defect is in the SHAPE of the computation, not in
 * whether this week's feed happens to trigger it — and the off-hours measurement is a floor. UW may
 * populate `sentiment`/`direction` under RTH volume, and the first day it does is not the day to
 * discover that a member-facing directional label has no coverage gate.
 *
 * THE THRESHOLD IS IMPORTED, NOT REDECLARED. `MIN_READABLE_PCT_FOR_VERDICT` already governs exactly
 * this judgement for the flow tape, and #2731 was a whole PR about what happens when a second copy
 * of a product rule drifts from the original. One rule, two surfaces.
 */

export type DarkPoolBiasPrint = {
  side?: string | null;
  premium: number;
};

export type DarkPoolBiasRead = {
  /** `unreadable` is a REFUSAL, distinct from `MIXED`. MIXED means "read successfully, and
   *  genuinely two-sided"; unreadable means "not enough of this was readable to say". Collapsing
   *  them is the same conflation §5c of the market-open runbook keeps having to un-conflate. */
  label: "BULLISH" | "BEARISH" | "MIXED" | "unreadable";
  buyPremium: number;
  sellPremium: number;
  /** Premium on prints carrying no direction — the slice the old ratio silently discarded. */
  neutralPremium: number;
  /** Share of TOTAL premium whose side could be read, 0–100. `null` when there is no premium at
   *  all — never 0, which would read as "measured, none readable" when nothing was measured. */
  readablePct: number | null;
  /** True when a verdict would rest on a minority of the premium. The surface must refuse, and
   *  should SAY what the coverage was rather than silently showing a dash. */
  minorityEvidence: boolean;
};

export function readDarkPoolBias(
  prints: readonly DarkPoolBiasPrint[],
  minReadablePct: number = MIN_READABLE_PCT_FOR_VERDICT
): DarkPoolBiasRead {
  let buyPremium = 0;
  let sellPremium = 0;
  let neutralPremium = 0;

  for (const p of prints ?? []) {
    const premium = Number(p?.premium);
    if (!Number.isFinite(premium) || premium <= 0) continue;
    if (p.side === "buy") buyPremium += premium;
    else if (p.side === "sell") sellPremium += premium;
    // Anything else — "neutral", absent, or a value the route did not map — is UNREAD premium, not
    // zero premium. The route maps a missing direction to "neutral", so `side` is never null here;
    // the else-branch is kept broad so an unmapped value cannot silently land in buy or sell.
    else neutralPremium += premium;
  }

  const readable = buyPremium + sellPremium;
  const total = readable + neutralPremium;
  const readablePct = total > 0 ? (readable / total) * 100 : null;
  const minorityEvidence = readablePct == null || readablePct < minReadablePct;

  if (minorityEvidence) {
    return { label: "unreadable", buyPremium, sellPremium, neutralPremium, readablePct, minorityEvidence };
  }

  const r = buyPremium / readable;
  const label = r >= 0.65 ? "BULLISH" : r <= 0.35 ? "BEARISH" : "MIXED";
  return { label, buyPremium, sellPremium, neutralPremium, readablePct, minorityEvidence };
}
