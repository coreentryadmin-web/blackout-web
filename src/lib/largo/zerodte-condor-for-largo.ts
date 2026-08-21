/**
 * IRON CONDOR, for the model — the product Largo did not know existed.
 *
 * ── THE DEFECT (measured live 2026-08-21) ────────────────────────────────────────────────────
 *
 * Asked "what is the win rate on the Night Hawk iron condor, and is there a catch?", live Largo
 * answered: "Night Hawk does not have a dedicated iron condor setup type" and quoted a made-up
 * "~60-65% win rate" pulled from SPX Slayer's track record. Every word of that is wrong. The
 * 0DTE iron condor is a production-ready, flag-ON-by-default Night Hawk product (`condor.ts`,
 * `iron-condor.ts`): it SELLS a delta-neutral 0DTE condor with short strikes ±0.6-0.8% from the
 * midday price, and it is rendered on the member's own command deck (`CommandDeck.tsx`,
 * `PlayTerminal.tsx`) with its win rate and intraday-breach rate.
 *
 * The cause is the fleet's signature shape: the fact exists in the system and is not wired to the
 * tool that needs it. The `condor` desk submodule's `preferredTools` were `get_zerodte_plays` and
 * `get_open_plays` — NEITHER carried condor geometry — and no tool anywhere returned the condor's
 * win rate or breach rate. So Largo had nothing to route to, and a model with nothing to cite and
 * no "I don't have that" reflex confabulated instead.
 *
 * ── WHY A STABLE PRODUCT DESCRIPTOR, NOT JUST LIVE ROWS ──────────────────────────────────────
 *
 * "What is the condor win rate" is mostly a PRODUCT question, not a live-position one. Its answer —
 * ~77% at ±0.6% / ~92% at ±0.8%, paired with the ~18.7% intraday-breach tail — is a backtested
 * characteristic that holds whether or not a condor is live this minute (and pre-open, none is).
 * A tool that only surfaced live condor rows would still leave Largo empty pre-market and it would
 * confabulate again. So this emits the STABLE descriptor from the engine's own exported constants.
 *
 * ── THE HONEST-SKEW RULE, CARRIED THROUGH ────────────────────────────────────────────────────
 *
 * The one non-negotiable of this product is that its high win rate is NEGATIVE skew — small credit
 * most days, a bigger (defined) loss on breakout days. `iron-condor.ts` enforces it (win rate
 * capped at 97, breach companion nulled on off-geometry), `condor-render.ts` enforces it
 * (`condorWinRateLine` pairs the two), and this descriptor states it in words the model cannot drop,
 * so Largo can never surface the win rate as if it were free edge.
 */

import {
  CONDOR_WINRATE_BY_WIDTH,
  SHIPPED_INTRADAY_BREACH_PCT,
  SURFACED_WIN_RATE_CAP,
} from "@/lib/zerodte/iron-condor";
import { condorWinRateLine, type CondorGeometry } from "@/lib/zerodte/condor-render";

/**
 * The stable "what IS the Night Hawk iron condor" block — answerable with no live position.
 * Derived entirely from the engine's exported constants, so it cannot drift from what the board
 * actually sells.
 */
export function ironCondorProductForLargo(): Record<string, unknown> {
  return {
    what_it_is:
      "A delta-neutral 0DTE iron condor SOLD for a net credit — the premium-selling counterpart to " +
      "the directional 0DTE board. Short strikes sit ~±0.6-0.8% from the midday price, pushed beyond " +
      "the dealer GEX walls; the long wings cap the loss (defined risk). It wins when price stays in " +
      "range (most days), which is the opposite skew to the directional plays — the two hedge.",
    // The measured width→win-rate table, as SURFACED (capped). Never emit the raw 100/96 tail: a
    // ~75-sample backtest cannot support a literal 100%, which is why the engine caps at 97.
    win_rate_by_width: CONDOR_WINRATE_BY_WIDTH.map((w) => ({
      short_strike_distance_pct: +(w.width_pct * 100).toFixed(2),
      est_win_rate_pct: Math.min(w.win_rate, SURFACED_WIN_RATE_CAP),
    })),
    surfaced_win_rate_cap_pct: SURFACED_WIN_RATE_CAP,
    intraday_breach_pct: SHIPPED_INTRADAY_BREACH_PCT,
    skew: "negative",
    // The rule the model must not drop. A win rate quoted without this reads as free edge.
    honest_skew_note:
      "This win rate is NEGATIVE skew: a small credit on the ~80% of days price stays in range, and " +
      "a bigger (but DEFINED) loss on the ~" +
      `${SHIPPED_INTRADAY_BREACH_PCT}% of days it breaches a short strike intraday. ALWAYS quote the ` +
      "intraday-breach rate next to the win rate — never the win rate alone, and never as if it were " +
      "a directional edge. Profitability depends on the live credit, a breach stop, and small size.",
    note:
      "These are the product's backtested characteristics, not a live position. Ask about the live " +
      "0DTE board for any condor currently committed this session.",
  };
}

/**
 * The lean condor view for ONE live/committed condor row, using the same `condorWinRateLine` the
 * member's terminal renders — so the tool and the desk cannot disagree about the two numbers.
 * Returns null for a directional row or a condor with no pinned geometry.
 */
export function liveCondorForLargo(geom: CondorGeometry | null): Record<string, unknown> | null {
  if (!geom) return null;
  const wr = condorWinRateLine(geom);
  return {
    structure: "iron_condor",
    short_put: geom.short_put,
    long_put: geom.long_put,
    short_call: geom.short_call,
    long_call: geom.long_call,
    breach_lower: geom.breach_lower,
    breach_upper: geom.breach_upper,
    net_credit: geom.net_credit,
    max_loss: geom.max_loss,
    est_win_rate_pct: wr.winRate,
    intraday_breach_pct: wr.breachRatePct,
    // The render's own flag: a win rate present with no breach companion must be captioned as an
    // unmeasured tail, not surfaced as free edge.
    breach_rate_unmeasured: wr.breachUnmeasured,
  };
}
