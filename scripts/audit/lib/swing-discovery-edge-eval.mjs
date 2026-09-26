/**
 * Pure evaluation helpers for the NIGHT HAWK SWINGS (native/organic engine) discovery-edge study —
 * the swing-side sibling of `banger-discovery-edge-eval.mjs`, same operator directive (2026-09-26):
 * "reconstruct what NIGHTHAWK knew at the time of selection and measure what happened afterward...
 * prevent look-ahead bias... identify which inputs actually separate winners from losers."
 *
 * REUSES `banger-discovery-edge-eval.mjs`'s generic bucketing/verdict/Spearman/baseline machinery
 * unmodified (schema-agnostic — operates on `row[key]` access, never assumes Banger's field names).
 * This file supplies only the swing-shaped `derivePreEntryMetrics`/`deriveOutcomeMetrics`, producing
 * the SAME output field names (`mfePct`, `maePct`, `realizedPnlPct`, `is100PlusMfe`,
 * `is100PlusRealized`, `isLoss`) so the shared functions work without modification.
 *
 * LOOK-AHEAD DISCIPLINE: every pre-entry field below comes from data PINNED AT COMMIT
 * (`commit.ts`'s `buildCommitInsert`) — `score`, `cortex` (the full pinned Cortex verdict, decision,
 * conviction), `archetype`, `subLane`, `contract` (strike/expiry/dte/delta chosen at commit),
 * `entryPremium`, `topFlowProvenance` (whether the picked strike matched the flow's own magnet
 * strike — also decided at commit), `firstSeenAt`/`committedAt` (both real timestamps that exist
 * before or AT commit). Every outcome field (`peakPremium`, `troughPremium`, `exitPnlPct`, `exitAt`,
 * `closedReason`) is necessarily observed strictly after entry. Neither function reads the other's
 * fields.
 *
 * DATA SOURCE: `GET /api/market/swing/record?days=90`'s `closedDeck[]` (member-facing route, already
 * exposes exactly this pinned-at-commit + outcome shape per closed position — no new admin route
 * needed). See this study's own report for the one gap this route does NOT cover (peak/trough
 * TIMESTAMPS, needed for a true "time to MFE" — closedDeck carries only peak/trough VALUES).
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso ?? "");
  const b = Date.parse(toIso ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round(((b - a) / 86_400_000) * 100) / 100;
}

/**
 * Pre-entry variables only — everything here is knowable at (or before) the moment of commit.
 * @param {object} row - one closedDeck[] entry from GET /api/market/swing/record
 */
export function derivePreEntryMetrics(row) {
  const c = row?.contract ?? null;
  const cortex = row?.cortex ?? null;

  let dayOfWeek = null;
  if (typeof row?.committedAt === "string") {
    const d = new Date(row.committedAt);
    if (!Number.isNaN(d.getTime())) dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  }

  return {
    score: finite(row?.score) ? row.score : null,
    cortexScore: finite(cortex?.score) ? cortex.score : null,
    cortexConviction: typeof cortex?.conviction === "string" ? cortex.conviction : null,
    cortexDecision: typeof cortex?.decision === "string" ? cortex.decision : null,
    cortexAbstained: cortex?.abstained === true,
    cortexSupportCount: Array.isArray(cortex?.supports) ? cortex.supports.length : null,
    cortexOpposeCount: Array.isArray(cortex?.opposes) ? cortex.opposes.length : null,
    cortexVetoCount: Array.isArray(cortex?.vetoes) ? cortex.vetoes.length : null,
    cortexAbsentCount: Array.isArray(cortex?.absent) ? cortex.absent.length : null,
    direction: typeof row?.direction === "string" ? row.direction.toUpperCase() : null,
    archetype: typeof row?.archetype === "string" ? row.archetype : null,
    subLane: typeof row?.subLane === "string" ? row.subLane : null,
    dte: finite(c?.dte) ? c.dte : null,
    // Delta is reported as a signed value in this feed's own convention (see live-plays.ts's own
    // comment: absolute in [0,1] for calls, negative for puts) — take magnitude as the moneyness
    // read, direction is already carried separately in `direction` above.
    deltaAbs: finite(c?.delta) ? Math.abs(c.delta) : null,
    strike: finite(c?.strike) ? c.strike : null,
    entryPremium: finite(row?.entryPremium) ? row.entryPremium : null,
    // Did the strike NIGHTHAWK actually picked match the flow's own strongest (magnet) strike, or
    // was a different strike chosen on tradability/fit (play-brief-intel.ts's own "Strike vs flow"
    // disclosure)? A real, pinned-at-commit contract-selection signal.
    topFlowMatchedPick: row?.topFlowProvenance?.matchedPick === true,
    entryPresentPillarsThin: row?.entryPresentPillars != null, // dossier.ts's own thin-entry flag
    // WATCH-to-commit lag: how long this thesis sat on WATCH before real capital committed. Both
    // timestamps exist AT OR BEFORE commit, so this is a genuine pre-entry-knowable quantity (an
    // entry-TIMING variable), not an outcome.
    watchToCommitDays: daysBetween(row?.firstSeenAt, row?.committedAt),
    dayOfWeek,
  };
}

/**
 * Outcome variables only — necessarily observed strictly after entry. MFE/MAE relative to entry
 * premium (this repo's own mfe-capture.ts convention), matching banger-discovery-edge-eval.mjs
 * exactly so the shared bucketing/verdict machinery needs no changes.
 */
export function deriveOutcomeMetrics(row) {
  const entryPremium = finite(row?.entryPremium) ? row.entryPremium : null;
  const peak = finite(row?.peakPremium) ? row.peakPremium : null;
  const trough = finite(row?.troughPremium) ? row.troughPremium : null;
  const realizedPnlPct = finite(row?.exitPnlPct) ? row.exitPnlPct : null;

  const mfePct = entryPremium != null && entryPremium > 0 && peak != null
    ? (peak / entryPremium - 1) * 100
    : null;
  const maePct = entryPremium != null && entryPremium > 0 && trough != null
    ? (trough / entryPremium - 1) * 100
    : null;

  return {
    mfePct,
    maePct,
    realizedPnlPct,
    is100PlusMfe: mfePct != null ? mfePct >= 100 : null,
    is100PlusRealized: realizedPnlPct != null ? realizedPnlPct >= 100 : null,
    isLoss: realizedPnlPct != null ? realizedPnlPct < 0 : null,
    closedReason: typeof row?.closedReason === "string" ? row.closedReason : null,
    // Real, honestly-available duration proxy — HOLD length (commit to exit), NOT time-to-peak.
    // closedDeck carries peak/trough VALUES only, no timestamps, so a true "time to MFE" cannot be
    // computed from this route — see this study's own report for the data-capture gap this is.
    holdDays: daysBetween(row?.committedAt, row?.exitAt),
  };
}

/** One row's pre-entry + outcome metrics, joined. */
export function deriveRowMetrics(row) {
  return {
    ...derivePreEntryMetrics(row),
    ...deriveOutcomeMetrics(row),
    positionId: row?.positionId ?? null,
    ticker: row?.ticker ?? null,
  };
}

/** Categorical (non-numeric) group summary — mirrors bucketByVariableQuantile's per-bucket stat
 *  shape but groups by an exact categorical value (archetype, subLane, direction, cortexDecision,
 *  cortexConviction, closedReason, topFlowMatchedPick) instead of a quantile split. */
export function groupByCategory(rows, categoryKey) {
  const groups = new Map();
  for (const r of rows) {
    const k = r[categoryKey];
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([label, rowsInGroup]) => {
    const n = rowsInGroup.length;
    const withOutcome = rowsInGroup.filter((r) => finite(r.realizedPnlPct));
    const wins = rowsInGroup.filter((r) => r.isLoss === false).length;
    const hits100Mfe = rowsInGroup.filter((r) => r.is100PlusMfe === true).length;
    const hits100Realized = rowsInGroup.filter((r) => r.is100PlusRealized === true).length;
    const avg = (key) => {
      const vals = rowsInGroup.map((r) => r[key]).filter(finite);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    };
    return {
      label: String(label),
      n,
      nWithOutcome: withOutcome.length,
      winRate: withOutcome.length ? Math.round((wins / withOutcome.length) * 1000) / 10 : null,
      hit100MfeRate: withOutcome.length ? Math.round((hits100Mfe / withOutcome.length) * 1000) / 10 : null,
      hit100RealizedRate: withOutcome.length ? Math.round((hits100Realized / withOutcome.length) * 1000) / 10 : null,
      avgRealizedPnlPct: avg("realizedPnlPct"),
      avgMfePct: avg("mfePct"),
      avgMaePct: avg("maePct"),
    };
  }).sort((a, b) => b.n - a.n);
}
