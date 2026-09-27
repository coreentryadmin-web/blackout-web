/**
 * TICK-LEVEL NBBO QUOTE RECONSTRUCTION (operator directive 2026-09-27, phase 2: kill the
 * verification weakness in the prior real-bar-replay work). PR #5521's adversarial validation found
 * that production manages Banger exits against a continuous NBBO quote-MID (`midOf`/
 * `reliableMarkFromSnapshot`, `src/lib/providers/options-snapshot.ts`), never a trade print — so a
 * replay built from Polygon's daily TRADE-aggregate bars could only verify ~10% of real scaled/
 * runner positions (winners) vs ~92% of pure stop-outs (losers), a severe, disqualifying selection
 * bias for exactly the population where 100/33/70 and production's own 100/50/50 diverge.
 *
 * THIS MODULE removes that gap by replaying REAL historical Polygon NBBO QUOTE TICKS (not trade
 * bars) through a tick-by-tick clone of production's OWN live management loop
 * (`src/lib/banger/live-sync.ts` + `src/lib/zerodte/scale-out.ts`'s `deriveScaleOutAction`) — the
 * SAME data type, the SAME resolution logic (imports the REAL, unmodified `midOf` and
 * `reliableMarkFromQuote` from `src/lib/providers/options-snapshot.ts` rather than re-cloning them,
 * since neither needs config-parameterization and a real import removes all drift risk), generalized
 * only where the exit RULE's own numbers (trigger/fraction/trail) must vary between control and
 * candidate.
 *
 * TWO FILL TRACKS, computed in the SAME walk, because the operator asked to test both "is this what
 * production's own model says happened" and "is this actually executable":
 *   - MODEL: production's own real formula, byte-for-byte — a STOP_OUT prices at the FIXED
 *     `entry*hard_stop_mult` (never the tick's actual undershoot); a TAKE_PARTIAL credits the FIXED
 *     `entry*scale_at_mult` (never the tick's actual overshoot); an EXIT_RUNNER prices at the tick's
 *     ACTUAL mark (`src/lib/banger/live-sync.ts`'s real `const exitPremium = ... : mark` — NOT the
 *     theoretical `peak*trail_from_peak` the PRIOR PR's bar-based clone used, which is a genuine,
 *     newly-found discrepancy: discrete ~1s polling means the real live mark at the tick that first
 *     satisfies the retrace test can already have undershot the exact theoretical level, and
 *     production's real ledger banks that ACTUAL, sometimes-worse number, not the clean target).
 *   - EXEC (realistic executable): identical trigger TIMING (a real trader watches the same mid a
 *     real member's app displays), but every SELL/exit fill uses the tick's own BID instead of the
 *     mid/model price — capped so it is NEVER credited better than the model fill (a market sell
 *     order cannot price-improve past the model's own number). This is the REAL observed spread at
 *     the exact decision instant, not an assumed flat haircut.
 *
 * PEAK TRACKING mirrors `live-sync.ts` exactly: `peak = Math.max(priorPeak, mark)`, computed
 * INCLUSIVE of the current tick, every tick, before the decision is evaluated — provably equivalent
 * here to using the pre-tick peak for the retrace test (any tick where a retrace test could fire
 * satisfies `mark <= priorPeak`, which by definition means this tick is NOT a new high, so
 * `max(priorPeak, mark) === priorPeak` — the two orderings coincide exactly at every tick that
 * matters, so this module uses the simpler pre-tick form without any behavioral difference).
 *
 * PURE AND TOTAL: no IO, no clock, no throw. `midOf`/`reliableMarkFromQuote` ARE real, unmodified
 * production imports (safe: both are pure, config-free). `replayTickState` is a parametric CLONE
 * of `deriveScaleOutAction`'s real decision logic (a copy, not an import, ONLY because that function
 * hard-codes `SCALE_OUT_RULES` rather than accepting it as a parameter) — proven exact against the
 * real function as an oracle in this module's own test file before being trusted for anything else.
 */
import { midOf, reliableMarkFromQuote } from "../../../src/lib/providers/options-snapshot.ts";

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Folds raw ascending quote ticks {t, bid, ask} and trade ticks {t, price} into an ordered series of
 * {t, mark, bid} reliable marks — the SAME resolution production's real `fetchMarks` callback
 * applies (`mark = midOf(bid,ask) ?? last ?? dayClose`, then `reliableMarkFromQuote` guards a
 * bid=0 backstop-quote divergence against the most recent real trade print). `initialReferencePrice`
 * stands in for production's `dayClose` fallback when no trade has printed yet in the window (the
 * caller passes the row's own `entry_premium` — itself a daily-bar CLOSE per `pickBangerContract`'s
 * own doc comment, i.e. exactly the kind of "last known real print" `dayClose` represents).
 * A quote tick with no usable mid AND no reference price is skipped (never fabricated).
 */
export function buildReliableMarkSeries(quoteTicksAsc, tradeTicksAsc, initialReferencePrice) {
  const out = [];
  let ref = finite(initialReferencePrice) && initialReferencePrice > 0 ? initialReferencePrice : null;
  let ti = 0;
  const trades = Array.isArray(tradeTicksAsc) ? tradeTicksAsc : [];
  for (const q of quoteTicksAsc ?? []) {
    while (ti < trades.length && trades[ti].t <= q.t) {
      if (finite(trades[ti].price) && trades[ti].price > 0) ref = trades[ti].price;
      ti++;
    }
    const bid = finite(q.bid) ? q.bid : null;
    const ask = finite(q.ask) ? q.ask : null;
    const mid = midOf(bid, ask);
    const rawMark = mid ?? (ref != null ? ref : null);
    if (rawMark == null) continue;
    const reliable = reliableMarkFromQuote(rawMark, bid, ref);
    if (reliable == null) continue;
    out.push({ t: q.t, mark: reliable, bid: bid ?? reliable });
  }
  return out;
}

/**
 * Appends a synthetic final tick settling an untriggered (or still-open-at-fetch-boundary) position
 * at its OCC intrinsic value — `max(0, underlyingCloseOnExpiry - strike)` — exactly
 * `settleExpiredBangerRow`'s real formula (`src/lib/banger/live-sync.ts`). Guarantees
 * `replayTickState`'s "ride to the last tick" fallback always resolves to the TRUE expiry
 * settlement, never an accidental stale quote (a contract's real quote flow can go quiet well
 * before expiry once the market has priced it near-worthless) — the caller always appends this,
 * unconditionally, rather than relying on the fetched quote series happening to extend that far.
 */
export function appendExpirySettlementTick(ticks, expiryTimestampMs, underlyingCloseOnExpiry, strike) {
  if (!finite(underlyingCloseOnExpiry) || !finite(strike)) return ticks;
  const intrinsic = Math.max(0, underlyingCloseOnExpiry - strike);
  return [...(ticks ?? []), { t: expiryTimestampMs, mark: intrinsic, bid: intrinsic }];
}

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/**
 * The tick-by-tick management state machine — a parametric clone of `deriveScaleOutAction` +
 * `live-sync.ts`'s calling loop, generalized over `rules` (`{scale_at_mult, scale_fraction,
 * trail_from_peak, hard_stop_mult}`) so control and candidate can be replayed against the IDENTICAL
 * real tick series. See this module's header for the MODEL-vs-EXEC fill distinction and why peak
 * tracking here is provably equivalent to production's real inclusive-of-current-tick form.
 */
export function replayTickState(ticks, entryPremium, rules) {
  const { scale_at_mult, scale_fraction, trail_from_peak, hard_stop_mult } = rules;
  if (!(entryPremium > 0) || !Array.isArray(ticks) || ticks.length === 0) {
    return {
      modelRealizedMultiple: 1,
      execRealizedMultiple: 1,
      exitCause: "no_data",
      scaled: false,
      peakAtExit: entryPremium,
      exitTickIndex: null,
      exitTickT: null,
    };
  }
  let peak = entryPremium;
  let scaled = false;
  let modelRealized = 0;
  let execRealized = 0;
  let remaining = 1;

  const finalize = (meta) => ({
    modelRealizedMultiple: modelRealized / entryPremium,
    execRealizedMultiple: execRealized / entryPremium,
    ...meta,
  });

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const mark = tick.mark;
    if (!finite(mark) || mark < 0) continue; // an unusable tick is skipped, never fabricated
    const bid = finite(tick.bid) ? tick.bid : mark;
    const newPeak = Math.max(peak, mark);

    if (!scaled) {
      if (mark <= entryPremium * hard_stop_mult) {
        const modelFill = entryPremium * hard_stop_mult;
        const execFill = Math.min(bid, modelFill); // never priced better than the model fill
        modelRealized += remaining * modelFill;
        execRealized += remaining * execFill;
        remaining = 0;
        return finalize({ exitCause: "hard_stop", scaled: false, peakAtExit: newPeak, exitTickIndex: i, exitTickT: tick.t });
      }
      if (mark >= entryPremium * scale_at_mult) {
        const modelFill = entryPremium * scale_at_mult;
        const execFill = Math.min(bid, modelFill);
        modelRealized += scale_fraction * modelFill;
        execRealized += scale_fraction * execFill;
        remaining -= scale_fraction;
        scaled = true;
      }
    } else if (mark <= peak * trail_from_peak) {
      const modelFill = mark; // production's REAL formula: the tick's ACTUAL mark, not the theoretical trail level
      const execFill = Math.min(bid, modelFill);
      modelRealized += remaining * modelFill;
      execRealized += remaining * execFill;
      remaining = 0;
      return finalize({ exitCause: "trail_stop", scaled: true, peakAtExit: newPeak, exitTickIndex: i, exitTickT: tick.t });
    }
    peak = newPeak;
  }

  if (remaining > 0) {
    const last = ticks.at(-1);
    const lastMark = finite(last.mark) ? last.mark : entryPremium;
    const lastBid = finite(last.bid) ? last.bid : lastMark;
    modelRealized += remaining * lastMark;
    execRealized += remaining * Math.min(lastBid, lastMark);
  }
  return finalize({
    exitCause: scaled ? "series_end_after_scale" : "series_end_never_triggered",
    scaled,
    peakAtExit: peak,
    exitTickIndex: ticks.length - 1,
    exitTickT: ticks.at(-1)?.t ?? null,
  });
}

/** Runs control and candidate against the SAME tick series and reports both fill tracks + deltas. */
export function replayPairTick(ticks, entryPremium, controlRules, candidateRules) {
  const control = replayTickState(ticks, entryPremium, controlRules);
  const candidate = replayTickState(ticks, entryPremium, candidateRules);
  const controlModelPct = round2((control.modelRealizedMultiple - 1) * 100);
  const candidateModelPct = round2((candidate.modelRealizedMultiple - 1) * 100);
  const controlExecPct = round2((control.execRealizedMultiple - 1) * 100);
  const candidateExecPct = round2((candidate.execRealizedMultiple - 1) * 100);
  return {
    control: { ...control, modelPct: controlModelPct, execPct: controlExecPct },
    candidate: { ...candidate, modelPct: candidateModelPct, execPct: candidateExecPct },
    modelDelta: finite(controlModelPct) && finite(candidateModelPct) ? round2(candidateModelPct - controlModelPct) : null,
    execDelta: finite(controlExecPct) && finite(candidateExecPct) ? round2(candidateExecPct - controlExecPct) : null,
  };
}
