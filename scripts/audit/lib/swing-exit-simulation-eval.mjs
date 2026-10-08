/**
 * Pure exit-management simulation engine (Ask Largo standing mandate, operator directive
 * 2026-09-26): "determine exactly where those gains are being lost" between Banger/native-swing's
 * MFE opportunity (43.2% of Banger closes) and realized capture (9.2%).
 *
 * WHAT THIS DOES. For every closed native-swing position (leg) with a real per-tick history
 * (`GET /api/admin/swing/closed-position-snapshots`'s `snapshots[]` — ~15-min RTH cadence, append-
 * only, written since the engine's real-money go-live), chronologically replays 7 alternative exit
 * rules against the REAL observed `option_mark` path and compares each to the REAL recorded outcome
 * ("current" — ground truth, never re-derived, so that arm carries zero simulation risk).
 *
 * LOOK-AHEAD DISCIPLINE (the load-bearing invariant). Every rule below decides its action at tick i
 * using ONLY `ticks[0..i]` — the mark/underlying/gate signal observed AT OR BEFORE that tick. No
 * rule ever consults a later tick, the real final exit, or the real recorded outcome to decide an
 * earlier action. The one exception, and it is not a look-ahead violation: every candidate rule
 * respects the SAME real "gate floor" — the first tick where `event_json.gating === true` in the
 * real snapshot stream. That gate is production's own real-time, already-computed capital-
 * preservation/thesis-invalidation verdict (`manage.ts`'s GATING_RUNGS: structural_stop, thesis_stop,
 * expiry_risk, premium_stop — documented as "GATE (enforced:true always) — you never wait on a
 * graded bucket to protect capital"), observed AT that exact past tick, not fabricated and not
 * borrowed from the future — a candidate rule at tick i does not know a gate will fire at tick i+3,
 * it only respects one that has ALREADY fired at or before tick i. This is how "thesis/invalidation
 * exits" is tested without reimplementing swing's qualitative thesis-break logic from scratch (which
 * `swing-early-trim-ab.mjs` already documented as unreconstructable offline without fabrication) —
 * the real system already computed it, tick by tick, and logged it.
 *
 * SCOPE NOTE (disclosed, not fixed here): only the leg the closed-deck route sources from (the
 * TERMINAL leg of a roll chain) is simulated — a multi-leg chain's earlier legs' snapshot history is
 * not stitched in (see the admin route's own header). A position with zero or one snapshot cannot be
 * chronologically replayed at all (no path to walk) and is excluded from every rule below, counted
 * and reported, never silently dropped or coerced.
 *
 * OPTION-DIRECTION CONVENTION: every swing position (LONG or SHORT thesis) is a LONG OPTION (a call
 * for LONG, a put for SHORT) — never short premium. So "mark rising = favorable, mark falling =
 * adverse" holds identically regardless of thesis direction; no sign-flipping is needed anywhere in
 * this module for the option-premium math (direction only matters for cross-cutting segmentation).
 *
 * PURE AND TOTAL: no IO, no clock (all "now" comes from tick timestamps already in the data), no
 * throw.
 */

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/**
 * Normalize a row's raw `snapshots[]` (already ascending `created_at, id` per the DB accessor) into
 * the minimal per-tick shape every rule reads. Drops a tick with no usable `option_mark` — a rule
 * cannot decide on a mark it doesn't have, and carrying a null mark forward would silently freeze
 * the rule's view of the world one tick behind reality without saying so.
 */
export function normalizeTicks(row) {
  const snaps = Array.isArray(row?.snapshots) ? row.snapshots : [];
  const ticks = [];
  for (const s of snaps) {
    if (!finite(s?.option_mark) || s.option_mark <= 0) continue;
    const ej = s.event_json && typeof s.event_json === "object" ? s.event_json : null;
    ticks.push({
      at: typeof s.created_at === "string" ? s.created_at : null,
      mark: s.option_mark,
      dteRemaining: finite(s.dte_remaining) ? s.dte_remaining : null,
      gating: ej?.gating === true,
      rung: typeof ej?.rung === "string" ? ej.rung : null,
      action: typeof ej?.action === "string" ? ej.action : null,
      thesisState: typeof s.thesis_state === "string" ? s.thesis_state : null,
    });
  }
  return ticks;
}

/** First tick index (0-based) where a REAL capital-preservation gate had already fired, or null if
 *  none did in the observed series. This is the shared floor every candidate rule below respects. */
export function findFirstGateTick(ticks) {
  const idx = ticks.findIndex((t) => t.gating === true);
  return idx === -1 ? null : idx;
}

/**
 * Blended realized P&L% from a sequence of {fraction, mark} exit events (each fraction of the
 * ORIGINAL position size realized at that mark) plus the entry premium. Fractions must sum to <= 1
 * (a final "runner" event should carry the remaining fraction) — the caller's responsibility.
 */
function blendedPnlPct(entry, events) {
  if (!(entry > 0) || events.length === 0) return null;
  const totalFraction = events.reduce((a, e) => a + e.fraction, 0);
  if (totalFraction <= 0) return null;
  // Every rule below always closes out the full remaining fraction by its own final event (a
  // hard-stop, a gate, a trail/breakeven trigger, or "series end") — so `totalFraction` is always
  // ~1 in practice; this is a defensive floor, not a top-up branch.
  const value = events.reduce((a, e) => a + e.fraction * e.mark, 0);
  return round2(((value / entry) - 1) * 100);
}

/** MFE-captured % — realized P&L as a fraction of the position's own overall peak favorable move
 *  (peakPremium-based, matching this study's other tools' convention). Null when there was no real
 *  favorable excursion to capture (peak <= entry). */
function mfeCapturedPct(realizedPnlPct, entry, peakPremium) {
  if (realizedPnlPct == null || !(entry > 0) || !finite(peakPremium) || peakPremium <= entry) return null;
  const mfePct = ((peakPremium / entry) - 1) * 100;
  if (!(mfePct > 0)) return null;
  return round2((realizedPnlPct / mfePct) * 100);
}

/** Max drawdown-after-profit observed ALONG THE PATH THE RULE ACTUALLY WALKED (ticks[0..exitIdx]
 *  inclusive) — once the mark first exceeds entry, track the running peak-so-far and the worst
 *  retracement from that peak seen before the rule's own exit tick. Null if the mark never went
 *  above entry before exit (nothing to give back). Uses only ticks up to the exit — no look-ahead. */
function maxDrawdownAfterProfit(entry, ticks, exitIdx) {
  let peakSoFar = null;
  let worst = null;
  for (let i = 0; i <= exitIdx && i < ticks.length; i++) {
    const mark = ticks[i].mark;
    if (mark > entry) {
      peakSoFar = peakSoFar == null ? mark : Math.max(peakSoFar, mark);
    }
    if (peakSoFar != null) {
      const dd = ((mark - peakSoFar) / peakSoFar) * 100; // <= 0
      if (worst == null || dd < worst) worst = dd;
    }
  }
  return worst == null ? null : round2(worst);
}

/**
 * The one fixed input every rule needs: entry premium, the real peak (for MFE-capture context), the
 * normalized tick series, and the real gate-floor index (shared across all candidate rules).
 */
function ruleContext(row) {
  const entry = finite(row?.entryPremium) ? row.entryPremium : null;
  const peak = finite(row?.peakPremium) ? row.peakPremium : null;
  const ticks = normalizeTicks(row);
  const gateIdx = findFirstGateTick(ticks);
  return { entry, peak, ticks, gateIdx };
}

/** Shared helper: the exit index a rule would use given its OWN trigger index (or null if its
 *  condition never fires), clipped to the real gate floor when the gate fires first, and finally
 *  to end-of-series when neither the rule nor a gate ever fires (rides to the last real tick). */
function resolveExitIdx(ownTriggerIdx, gateIdx, lastIdx) {
  const candidates = [ownTriggerIdx, gateIdx, lastIdx].filter((x) => x != null);
  return candidates.length ? Math.min(...candidates) : lastIdx;
}

// ── Individual rule simulators — each returns { exitIdx, events, exitCause } or null if not
//    simulable (e.g. no ticks at all). `events` are {fraction, mark} pairs summing to 1. ──

function simulateNoEarlyTrim(ctx) {
  const { ticks, gateIdx } = ctx;
  if (!ticks.length) return null;
  const lastIdx = ticks.length - 1;
  const exitIdx = gateIdx != null ? gateIdx : lastIdx;
  return { exitIdx, events: [{ fraction: 1, mark: ticks[exitIdx].mark }], exitCause: gateIdx != null ? "gate" : "series_end" };
}

/** Generic two-rung (or single-rung) trim ladder + optional trailing stop + hard stop on the runner,
 *  mirroring SWING_SCALE_OUT_POLICY's own mechanics (trim at trigger levels, trail the runner off
 *  ITS OWN peak-since-armed, hard stop from entry) but walked tick-by-tick against the real path
 *  instead of approximated from peak/trough summaries alone. */
function simulateLadder(ctx, { rungs, trailFromPeakPct, hardStopPct }) {
  const { entry, ticks, gateIdx } = ctx;
  if (!entry || !ticks.length) return null;
  const lastIdx = ticks.length - 1;
  const sortedRungs = [...rungs].sort((a, b) => a.triggerPct - b.triggerPct);
  const events = [];
  let remaining = 1;
  let rungPtr = 0;
  let runnerArmed = false;
  let runnerPeak = null;
  let exitIdx = null;
  let exitCause = null;

  for (let i = 0; i <= lastIdx; i++) {
    if (gateIdx != null && i === gateIdx) {
      events.push({ fraction: remaining, mark: ticks[i].mark });
      remaining = 0;
      exitIdx = i;
      exitCause = "gate";
      break;
    }
    const mark = ticks[i].mark;
    // Hard stop — before any trim, a capital backstop independent of the gate stream (mirrors
    // SCALE_OUT_RULES.hard_stop_mult applying "before any tranche is taken").
    if (rungPtr === 0 && hardStopPct != null && mark <= entry * (1 + hardStopPct / 100)) {
      events.push({ fraction: remaining, mark });
      remaining = 0;
      exitIdx = i;
      exitCause = "hard_stop";
      break;
    }
    while (rungPtr < sortedRungs.length && mark >= entry * (1 + sortedRungs[rungPtr].triggerPct / 100)) {
      const frac = Math.min(remaining, sortedRungs[rungPtr].fraction);
      events.push({ fraction: frac, mark });
      remaining = round2(remaining - frac);
      rungPtr += 1;
    }
    if (rungPtr >= sortedRungs.length && remaining > 0 && trailFromPeakPct != null) {
      if (!runnerArmed) {
        runnerArmed = true;
        runnerPeak = mark;
      } else {
        runnerPeak = Math.max(runnerPeak, mark);
      }
      if (mark <= runnerPeak * (trailFromPeakPct / 100)) {
        events.push({ fraction: remaining, mark });
        remaining = 0;
        exitIdx = i;
        exitCause = "trail_stop";
        break;
      }
    }
  }
  if (remaining > 0) {
    // Series ended (or ran out of ticks) before the runner's trailing/hard-stop condition fired —
    // close the remainder at the LAST real observed mark, never fabricated.
    events.push({ fraction: remaining, mark: ticks[lastIdx].mark });
    exitIdx = lastIdx;
    exitCause = exitCause ?? "series_end";
  }
  return { exitIdx, events, exitCause };
}

function simulateTrailingStopAfterMfe(ctx, { armAtGainPct, trailBackPct }) {
  const { entry, ticks, gateIdx } = ctx;
  if (!entry || !ticks.length) return null;
  const lastIdx = ticks.length - 1;
  let armed = false;
  let peakSinceArm = null;
  for (let i = 0; i <= lastIdx; i++) {
    if (gateIdx != null && i === gateIdx) {
      return { exitIdx: i, events: [{ fraction: 1, mark: ticks[i].mark }], exitCause: "gate" };
    }
    const mark = ticks[i].mark;
    const gainPct = ((mark / entry) - 1) * 100;
    if (!armed && gainPct >= armAtGainPct) {
      armed = true;
      peakSinceArm = mark;
    } else if (armed) {
      peakSinceArm = Math.max(peakSinceArm, mark);
      if (mark <= peakSinceArm * (1 - trailBackPct / 100)) {
        return { exitIdx: i, events: [{ fraction: 1, mark }], exitCause: "trail_stop" };
      }
    }
  }
  return { exitIdx: lastIdx, events: [{ fraction: 1, mark: ticks[lastIdx].mark }], exitCause: "series_end" };
}

function simulateBreakevenStop(ctx, { armAtGainPct }) {
  const { entry, ticks, gateIdx } = ctx;
  if (!entry || !ticks.length) return null;
  const lastIdx = ticks.length - 1;
  let armed = false;
  for (let i = 0; i <= lastIdx; i++) {
    if (gateIdx != null && i === gateIdx) {
      return { exitIdx: i, events: [{ fraction: 1, mark: ticks[i].mark }], exitCause: "gate" };
    }
    const mark = ticks[i].mark;
    const gainPct = ((mark / entry) - 1) * 100;
    if (!armed && gainPct >= armAtGainPct) armed = true;
    if (armed && mark <= entry) {
      return { exitIdx: i, events: [{ fraction: 1, mark }], exitCause: "breakeven_stop" };
    }
  }
  return { exitIdx: lastIdx, events: [{ fraction: 1, mark: ticks[lastIdx].mark }], exitCause: "series_end" };
}

function simulateTimeBasedExit(ctx, { holdTicks }) {
  const { ticks, gateIdx } = ctx;
  if (!ticks.length) return null;
  const lastIdx = ticks.length - 1;
  const timeIdx = Math.min(holdTicks, lastIdx);
  const exitIdx = resolveExitIdx(timeIdx, gateIdx, lastIdx);
  const cause = gateIdx != null && exitIdx === gateIdx ? "gate" : exitIdx === timeIdx ? "time_stop" : "series_end";
  return { exitIdx, events: [{ fraction: 1, mark: ticks[exitIdx].mark }], exitCause: cause };
}

function simulateThesisInvalidationOnly(ctx) {
  const { ticks, gateIdx } = ctx;
  if (!ticks.length) return null;
  const lastIdx = ticks.length - 1;
  const exitIdx = gateIdx != null ? gateIdx : lastIdx;
  return { exitIdx, events: [{ fraction: 1, mark: ticks[exitIdx].mark }], exitCause: gateIdx != null ? "gate" : "series_end" };
}

/** The named rule set this study tests, in report order. Each `sim` takes a ruleContext and returns
 *  {exitIdx, events, exitCause} or null (not simulable for this row). Parameters are fixed and
 *  disclosed here — never tuned against the outcome they're being measured on. */
export const EXIT_RULES = [
  { id: "no_early_trim", label: "No early trim — ride 100% to real gate/close", sim: (ctx) => simulateNoEarlyTrim(ctx) },
  {
    id: "current_replica",
    label: "Current policy replica (50%@+100%, trail runner 50%-of-peak, -60% hard stop)",
    sim: (ctx) => simulateLadder(ctx, { rungs: [{ triggerPct: 100, fraction: 0.5 }], trailFromPeakPct: 50, hardStopPct: -60 }),
  },
  {
    id: "trim_30_50_runner",
    label: "30%@+50% / 50%@+100% / 20% runner (same trail+hard-stop as current)",
    sim: (ctx) => simulateLadder(ctx, { rungs: [{ triggerPct: 50, fraction: 0.3 }, { triggerPct: 100, fraction: 0.5 }], trailFromPeakPct: 50, hardStopPct: -60 }),
  },
  {
    id: "trim_50_runner_no_trail",
    label: "50%@+100% / 50% runner, NO trailing stop (hard stop only)",
    sim: (ctx) => simulateLadder(ctx, { rungs: [{ triggerPct: 100, fraction: 0.5 }], trailFromPeakPct: null, hardStopPct: -60 }),
  },
  {
    id: "trailing_stop_after_mfe",
    label: "No trim; arm trailing stop at +50% gain, exit on 30% retrace from peak",
    sim: (ctx) => simulateTrailingStopAfterMfe(ctx, { armAtGainPct: 50, trailBackPct: 30 }),
  },
  {
    id: "breakeven_stop",
    label: "No trim; move stop to breakeven once +25% gain reached",
    sim: (ctx) => simulateBreakevenStop(ctx, { armAtGainPct: 25 }),
  },
  {
    id: "time_based_5",
    label: "Time-based exit — 5 held ticks (~1 RTH session) unless gate fires first",
    sim: (ctx) => simulateTimeBasedExit(ctx, { holdTicks: 5 }),
  },
  {
    id: "time_based_10",
    label: "Time-based exit — 10 held ticks (~2 RTH sessions) unless gate fires first",
    sim: (ctx) => simulateTimeBasedExit(ctx, { holdTicks: 10 }),
  },
  {
    id: "thesis_invalidation_only",
    label: "Thesis/invalidation exit only — no profit-taking at all, exit solely on a real gate",
    sim: (ctx) => simulateThesisInvalidationOnly(ctx),
  },
];

/**
 * Simulate every rule for one closed position row. Returns null rows/metrics (never a fabricated
 * number) wherever the position lacks the basis to compute them (no entry premium, no ticks).
 * `current` is GROUND TRUTH from the row's own real recorded outcome, not simulated.
 */
export function simulateRowAcrossRules(row) {
  const ctx = ruleContext(row);
  const hasChronology = ctx.entry != null && ctx.ticks.length >= 2;

  const current = {
    id: "current",
    label: "Current (real recorded outcome)",
    realizedPnlPct: finite(row?.exitPnlPct) ? row.exitPnlPct : null,
    mfeCapturedPct: mfeCapturedPct(finite(row?.exitPnlPct) ? row.exitPnlPct : null, ctx.entry, ctx.peak),
    maxDrawdownAfterProfitPct: hasChronology ? maxDrawdownAfterProfit(ctx.entry, ctx.ticks, ctx.ticks.length - 1) : null,
    exitCause: row?.closedReason ?? null,
  };

  const results = { current };
  if (!hasChronology) {
    for (const rule of EXIT_RULES) results[rule.id] = null;
    return { positionId: row?.positionId ?? null, ticker: row?.ticker ?? null, hasChronology: false, tickCount: ctx.ticks.length, current, results };
  }

  for (const rule of EXIT_RULES) {
    const outcome = rule.sim(ctx);
    if (!outcome) {
      results[rule.id] = null;
      continue;
    }
    const realizedPnlPct = blendedPnlPct(ctx.entry, outcome.events);
    results[rule.id] = {
      id: rule.id,
      label: rule.label,
      realizedPnlPct,
      mfeCapturedPct: mfeCapturedPct(realizedPnlPct, ctx.entry, ctx.peak),
      maxDrawdownAfterProfitPct: maxDrawdownAfterProfit(ctx.entry, ctx.ticks, outcome.exitIdx),
      exitCause: outcome.exitCause,
    };
  }

  return { positionId: row?.positionId ?? null, ticker: row?.ticker ?? null, hasChronology: true, tickCount: ctx.ticks.length, current, results };
}

/**
 * Aggregate one rule's paired outcomes across a population (already filtered to rows where BOTH
 * `current` and this rule are non-null). Reports win rate, avg winner/loser, expectancy, a paired
 * mean-delta vs current with a normal-approx CI (same discipline as swing-early-trim-eval.mjs), and
 * two named failure-mode counts the operator explicitly asked for.
 */
export function aggregateRule(simRows, ruleId, { largeWinnerThresholdPct = 50, prematureKillFraction = 0.5 } = {}) {
  const paired = [];
  for (const r of simRows) {
    const cur = r.current?.realizedPnlPct;
    const cand = r.results?.[ruleId]?.realizedPnlPct;
    if (!finite(cur) || !finite(cand)) continue;
    paired.push({ ticker: r.ticker, positionId: r.positionId, current: cur, candidate: cand, delta: round2(cand - cur) });
  }
  const n = paired.length;
  if (n === 0) return { ruleId, n: 0, verdict: "NO DATA" };

  const wins = paired.filter((p) => p.candidate > 0);
  const losses = paired.filter((p) => p.candidate <= 0);
  const winRate = round2((wins.length / n) * 100);
  const avgWinner = wins.length ? round2(wins.reduce((a, p) => a + p.candidate, 0) / wins.length) : null;
  const avgLoser = losses.length ? round2(losses.reduce((a, p) => a + p.candidate, 0) / losses.length) : null;
  const expectancy =
    avgWinner != null && avgLoser != null
      ? round2((wins.length / n) * avgWinner + (losses.length / n) * avgLoser)
      : avgWinner != null
        ? avgWinner
        : avgLoser;

  const meanDelta = paired.reduce((a, p) => a + p.delta, 0) / n;
  const variance = n > 1 ? paired.reduce((a, p) => a + (p.delta - meanDelta) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: round2(meanDelta - 1.96 * stderr), hi: round2(meanDelta + 1.96 * stderr) };
  const verdict = n < 2 ? "INSUFFICIENT N" : ci.lo > 0 ? "CANDIDATE SEPARATED (better)" : ci.hi < 0 ? "CURRENT SEPARATED (better)" : "INCONCLUSIVE";

  const actualWinners = paired.filter((p) => p.current > 0);
  const turnedWinnerIntoLoser = actualWinners.filter((p) => p.candidate <= 0).length;
  const largeWinnersActual = paired.filter((p) => p.current >= largeWinnerThresholdPct);
  const prematurelyKilled = largeWinnersActual.filter((p) => p.candidate < p.current * prematureKillFraction).length;

  return {
    ruleId,
    n,
    winRate,
    avgWinner,
    avgLoser,
    expectancy: round2(expectancy),
    meanCurrent: round2(paired.reduce((a, p) => a + p.current, 0) / n),
    meanCandidate: round2(paired.reduce((a, p) => a + p.candidate, 0) / n),
    meanDelta: round2(meanDelta),
    ci,
    verdict,
    turnedWinnerIntoLoser,
    turnedWinnerIntoLoserRate: actualWinners.length ? round2((turnedWinnerIntoLoser / actualWinners.length) * 100) : null,
    largeWinnerN: largeWinnersActual.length,
    prematurelyKilledLargeWinners: prematurelyKilled,
    prematurelyKilledRate: largeWinnersActual.length ? round2((prematurelyKilled / largeWinnersActual.length) * 100) : null,
  };
}

/** Unconditional baseline stats for the "current" (ground-truth) arm alone — no candidate to pair
 *  against, so no delta/CI, just the same win-rate/avg-winner/avg-loser/expectancy shape every rule
 *  is measured against. Always report this FIRST, before any candidate-rule claim. */
export function baselineStats(simRows) {
  const usable = simRows.filter((r) => finite(r.current?.realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };
  const wins = usable.filter((r) => r.current.realizedPnlPct > 0);
  const losses = usable.filter((r) => r.current.realizedPnlPct <= 0);
  const winRate = round2((wins.length / n) * 100);
  const avgWinner = wins.length ? round2(wins.reduce((a, r) => a + r.current.realizedPnlPct, 0) / wins.length) : null;
  const avgLoser = losses.length ? round2(losses.reduce((a, r) => a + r.current.realizedPnlPct, 0) / losses.length) : null;
  const expectancy =
    avgWinner != null && avgLoser != null
      ? round2((wins.length / n) * avgWinner + (losses.length / n) * avgLoser)
      : avgWinner != null
        ? avgWinner
        : avgLoser;
  return {
    n,
    winRate,
    avgWinner,
    avgLoser,
    expectancy: round2(expectancy),
    meanRealized: round2(usable.reduce((a, r) => a + r.current.realizedPnlPct, 0) / n),
  };
}

/** Categorical segmentation (direction/archetype/subLane) of a rule's aggregate stats, reusing
 *  aggregateRule per group — mirrors swing-discovery-edge-eval.mjs's groupByCategory shape. */
export function aggregateRuleByCategory(simRows, ruleId, categoryFn, opts) {
  const groups = new Map();
  for (const r of simRows) {
    const key = categoryFn(r);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .map(([label, rows]) => ({ label: String(label), ...aggregateRule(rows, ruleId, opts) }))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
}
