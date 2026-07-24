// src/lib/swing/feature-store.ts — the READ side of the swing keystone (PR-14). Pure. Evidence-only.
//
// The write side (feature-vector.ts + the HELD snapshot-write hook) stamps one SwingFeatureVector PER
// SNAPSHOT across a position's life. This module reads that pile back: it joins each graded swing position
// to its outcome and turns the accumulated rows + snapshot series into honest base rates and TRAJECTORY
// studies — the arc-shaped questions a same-day 0DTE store can't ask ("did the thesis stall two sessions
// before it died?", "did IV crush kill setups the underlying actually vindicated?").
//
// TWO HARD RULES, both mirrored verbatim from zerodte/feature-store.ts (same discipline, distinct schema):
//   1. A position counts only once it is GRADED to a win/loss — an ungraded/open row is not evidence and is
//      dropped, never coerced to a loss.
//   2. A base rate is reported only at/above MIN_SAMPLES; below it the rate is `null` (unknown), never a
//      point estimate off a handful of trades that reads as fact. A null base rate is honest; a 2/3 = "67%"
//      is a lie. MIN_SAMPLES is IMPORTED from the 0DTE store so the swing floor can never quietly diverge.
//
// WIN PREDICATE: realized_pnl_pct > 0 — the EXACT predicate record.ts isSwingWin / zerodte isZeroDteWin use,
// so the member-facing record and this learning store can never disagree on what a win is.
//
// PURE & deterministic — no IO. The DB reads (fetchGradedSwingFeatureRows / fetchSwingSnapshots, PR-10) are
// INJECTED as deps (loadSwingTrajectoryStudies), so this module imports nothing from db.ts and the studies
// are unit-tested with plain rows. The row shapes are structural (the db.ts rows satisfy them) to keep this
// module dependency-free — the same loose-shape discipline the 0DTE store uses with RawGradedRow.

import { MIN_SAMPLES, type BaseRate } from "../zerodte/feature-store";
import { SWING_ARCHETYPES, SWING_SUB_LANES_ORDER, type SwingArchetype, type SwingSubLane } from "./taxonomy";

// Re-export MIN_SAMPLES so swing callers/tests read the honest-null floor from one place.
export { MIN_SAMPLES, type BaseRate };

/** A graded swing position as the feature store needs it — structurally satisfied by db.ts SwingPositionRow.
 *  Loose on purpose (no db import) so this stays a pure, testable core. */
export interface SwingFeatureRowLike {
  id: number;
  ticker: string;
  direction: "long" | "short";
  archetype: string | null;
  sub_lane: string;
  session_date: string;
  realized_pnl_pct: number | null;
  graded_at: string | null;
  feature_vector: Record<string, unknown> | null;
}

/** One snapshot in a position's longitudinal series — structurally satisfied by db.ts SwingSnapshotRow. */
export interface SwingSnapshotLike {
  position_id: number;
  snapshot_kind: string;
  dte_remaining: number | null;
  running_mfe: number | null;
  running_mae: number | null;
  option_mark: number | null;
  underlying_px: number | null;
  thesis_state: string | null;
  feature_vector: Record<string, unknown> | null;
  created_at: string;
}

export type SwingGradeLabel = "win" | "loss";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Grade a position to win/loss, or null when it is not evidence. Graded = graded_at present AND a finite
 * realized P&L. Win = realized_pnl_pct > 0 (identical to record.ts / zerodte). An ungraded or open row is
 * null — never coerced to a loss.
 */
export function swingLabel(row: Pick<SwingFeatureRowLike, "graded_at" | "realized_pnl_pct">): SwingGradeLabel | null {
  if (!row.graded_at) return null;
  if (!finite(row.realized_pnl_pct)) return null;
  return row.realized_pnl_pct > 0 ? "win" : "loss";
}

// ── base-rate primitives (same pattern as zerodte/feature-store.ts; sealRate/emptyRate are private there) ──

function emptyRate(): BaseRate {
  return { n: 0, wins: 0, winRate: null, pnlSum: 0, pnlN: 0 };
}

function addToRate(cell: BaseRate, label: SwingGradeLabel, pnlPct: number | null): void {
  cell.n += 1;
  if (label === "win") cell.wins += 1;
  if (pnlPct != null) {
    cell.pnlSum += pnlPct;
    cell.pnlN += 1;
  }
}

/** Fill winRate ONLY at/above MIN_SAMPLES — honest-null below it (calibration-first). */
function sealRate(cell: BaseRate): BaseRate {
  cell.winRate = cell.n >= MIN_SAMPLES ? cell.wins / cell.n : null;
  return cell;
}

function bump(map: Record<string, BaseRate>, key: string, label: SwingGradeLabel, pnlPct: number | null): void {
  (map[key] ??= emptyRate());
  addToRate(map[key]!, label, pnlPct);
}

export interface SwingFeatureStoreSummary {
  overall: BaseRate;
  byArchetype: Record<string, BaseRate>;
  bySubLane: Record<string, BaseRate>;
  /** Graded-but-not-evidence never happens here (dropped), but coverage of the join is surfaced. */
  gradedRows: number;
  droppedRows: number;
}

/**
 * Summarize graded swing positions into base rates. Counts are always exact; a winRate stays null until the
 * cell clears MIN_SAMPLES, so a thin cut can't masquerade as a calibrated edge. Raw material for the
 * probability/graduation layers — NOT a gate.
 */
export function summarizeSwingFeatureStore(rows: SwingFeatureRowLike[]): SwingFeatureStoreSummary {
  const overall = emptyRate();
  const byArchetype: Record<string, BaseRate> = {};
  const bySubLane: Record<string, BaseRate> = {};
  let gradedRows = 0;
  let droppedRows = 0;

  for (const row of rows) {
    const label = swingLabel(row);
    if (!label) {
      droppedRows += 1;
      continue; // not graded → not evidence
    }
    gradedRows += 1;
    const pnl = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
    addToRate(overall, label, pnl);
    bump(byArchetype, row.archetype ?? "unknown", label, pnl);
    bump(bySubLane, row.sub_lane || "unknown", label, pnl);
  }

  sealRate(overall);
  for (const m of [byArchetype, bySubLane]) for (const k of Object.keys(m)) sealRate(m[k]!);

  return { overall, byArchetype, bySubLane, gradedRows, droppedRows };
}

// ── trajectory studies: join the snapshot SERIES to the graded outcome ─────────────────────────────────
//
// Each study partitions the GRADED positions by a boolean predicate over that position's ordered snapshot
// series, then reports the base rate of each side + the win-rate delta (only when BOTH sides seal — no
// delta off thin cells). This is the arc-shaped read a same-day store cannot produce.

export interface TrajectoryStudy {
  signal: string;
  /** Positions whose snapshot series exhibits the pattern. */
  withSignal: BaseRate;
  /** Positions evaluated but WITHOUT the pattern. */
  withoutSignal: BaseRate;
  /** (withSignal.winRate − withoutSignal.winRate) × 100, only when BOTH are sealed; else null. */
  deltaWinRatePct: number | null;
  /** Graded positions that couldn't be evaluated (no snapshots / predicate returned null) — never a fake side. */
  skipped: number;
}

/** A snapshot accessor the caller injects (pre-loaded via fetchSwingSnapshots) — keeps the study pure. */
export type SnapshotAccessor = (positionId: number) => SwingSnapshotLike[];

/** predicate → true (has pattern) / false (evaluated, no pattern) / null (can't evaluate → skip). */
type SeriesPredicate = (snaps: SwingSnapshotLike[], row: SwingFeatureRowLike) => boolean | null;

function runTrajectoryStudy(
  signal: string,
  rows: SwingFeatureRowLike[],
  snapshotsFor: SnapshotAccessor,
  predicate: SeriesPredicate
): TrajectoryStudy {
  const withSignal = emptyRate();
  const withoutSignal = emptyRate();
  let skipped = 0;

  for (const row of rows) {
    const label = swingLabel(row);
    if (!label) {
      skipped += 1; // not graded outcome to join to
      continue;
    }
    const snaps = snapshotsFor(row.id) ?? [];
    const hit = predicate(snaps, row);
    if (hit == null) {
      skipped += 1;
      continue;
    }
    const pnl = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
    addToRate(hit ? withSignal : withoutSignal, label, pnl);
  }

  sealRate(withSignal);
  sealRate(withoutSignal);
  const deltaWinRatePct =
    withSignal.winRate != null && withoutSignal.winRate != null
      ? (withSignal.winRate - withoutSignal.winRate) * 100
      : null;
  return { signal, withSignal, withoutSignal, deltaWinRatePct, skipped };
}

/** EOD snapshots in time order (the recorder appends one per session close). */
function eodSnaps(snaps: SwingSnapshotLike[]): SwingSnapshotLike[] {
  return snaps.filter((s) => s.snapshot_kind === "eod");
}

/** A snapshot's flow pillar, read from its pinned feature_vector (pil_flow); null when absent. */
function snapFlow(s: SwingSnapshotLike): number | null {
  const v = s.feature_vector?.pil_flow;
  return finite(v) ? v : null;
}

/**
 * studyTwoStagnantSessions — does a thesis that STALLS across two sessions go on to lose? A "stagnant
 * session" is an EOD snapshot whose running MFE did NOT improve over the prior EOD (no new favorable
 * progress that session). Signal = ≥2 such stagnant sessions. Needs ≥3 EOD snapshots (≥2 transitions) to
 * evaluate — fewer → null (skip, never fabricate a side).
 */
export function studyTwoStagnantSessions(
  rows: SwingFeatureRowLike[],
  snapshotsFor: SnapshotAccessor
): TrajectoryStudy {
  return runTrajectoryStudy("two_stagnant_sessions", rows, snapshotsFor, (snaps) => {
    const eod = eodSnaps(snaps);
    if (eod.length < 3) return null; // not enough sessions to judge a stall
    let stagnant = 0;
    for (let i = 1; i < eod.length; i++) {
      const prev = eod[i - 1]!.running_mfe;
      const cur = eod[i]!.running_mfe;
      if (!finite(prev) || !finite(cur)) return null; // MFE not tracked → can't evaluate
      if (cur <= prev + 1e-9) stagnant += 1; // no new favorable progress this session
    }
    return stagnant >= 2;
  });
}

/**
 * studyFlowDecay — does the FLOW pillar fading across the position's life predict a loss? Reads the pinned
 * pil_flow off each snapshot in order; signal = the last finite flow reading is materially below the first
 * (decay ≥ 0.10 on the 0–1 pillar). Needs ≥2 snapshots carrying a finite pil_flow — fewer → null.
 */
export function studyFlowDecay(rows: SwingFeatureRowLike[], snapshotsFor: SnapshotAccessor): TrajectoryStudy {
  return runTrajectoryStudy("flow_decay", rows, snapshotsFor, (snaps) => {
    const flows = snaps.map(snapFlow).filter((f): f is number => f != null);
    if (flows.length < 2) return null;
    return flows[0]! - flows[flows.length - 1]! >= 0.1;
  });
}

/**
 * studyIvKillsGoodSetups — did IV crush kill setups the UNDERLYING actually vindicated? Signal fires when a
 * HIGH-evidence setup (pinned evidence_score ≥ 70) shows the option collapsing (mark falls ≥25% off its
 * first reading) WHILE the underlying held (running MAE shallower than −3% at the worst option point). The
 * first snapshot's option_mark proxies entry premium (snapshots don't carry it separately). Needs ≥2
 * snapshots with a finite option_mark + a pinned evidence_score — else null.
 */
export function studyIvKillsGoodSetups(
  rows: SwingFeatureRowLike[],
  snapshotsFor: SnapshotAccessor
): TrajectoryStudy {
  return runTrajectoryStudy("iv_kills_good_setups", rows, snapshotsFor, (snaps, row) => {
    const evidence = row.feature_vector?.evidence_score;
    if (!finite(evidence)) return null;
    const marked = snaps.filter((s) => finite(s.option_mark));
    if (marked.length < 2) return null;
    const entryMark = marked[0]!.option_mark as number;
    if (!(entryMark > 0)) return null;
    // Worst option point in the series + the underlying MAE observed there.
    let worstRatio = Infinity;
    let maeAtWorst: number | null = null;
    for (const s of marked) {
      const ratio = (s.option_mark as number) / entryMark;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        maeAtWorst = finite(s.running_mae) ? s.running_mae : null;
      }
    }
    const goodSetup = evidence >= 70;
    const optionCrushed = worstRatio <= 0.75; // option lost ≥25%
    const underlyingHeld = maeAtWorst != null && maeAtWorst >= -3; // underlying didn't break (MAE shallow)
    return goodSetup && optionCrushed && underlyingHeld;
  });
}

/** Best sub-lane (DTE class) per archetype: the sub-lane whose graded bucket has the highest SEALED win rate. */
export interface BestDteByArchetype {
  bySubLane: Record<string, BaseRate>;
  /** The winning sub-lane once at least one of its buckets seals (≥MIN_SAMPLES); null while all provisional. */
  best: { subLane: SwingSubLane; winRate: number } | null;
}

/**
 * analyzeBestDteByArchetype — which contract sub-lane (Tactical/Standard/Extended) works best for each
 * archetype. Groups graded rows by archetype → within each, a base rate per sub-lane, sealed under
 * MIN_SAMPLES. `best` stays null until a sub-lane bucket actually seals — an honest "not enough evidence
 * yet", never a winner crowned off 3 trades. Iterates the canonical archetype/sub-lane order so the output
 * is stable and complete.
 */
export function analyzeBestDteByArchetype(
  rows: SwingFeatureRowLike[]
): Record<SwingArchetype, BestDteByArchetype> {
  const out = {} as Record<SwingArchetype, BestDteByArchetype>;
  for (const a of SWING_ARCHETYPES) out[a] = { bySubLane: {}, best: null };

  for (const row of rows) {
    const label = swingLabel(row);
    if (!label) continue;
    const arch = (row.archetype ?? "") as SwingArchetype;
    if (!out[arch]) continue; // unknown/legacy archetype — not a canonical bucket
    const pnl = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
    bump(out[arch].bySubLane, row.sub_lane || "unknown", label, pnl);
  }

  for (const a of SWING_ARCHETYPES) {
    const bucket = out[a];
    for (const k of Object.keys(bucket.bySubLane)) sealRate(bucket.bySubLane[k]!);
    // Best = highest SEALED win rate among the canonical sub-lanes (skips unsealed + non-canonical).
    let best: { subLane: SwingSubLane; winRate: number } | null = null;
    for (const lane of SWING_SUB_LANES_ORDER) {
      const cell = bucket.bySubLane[lane];
      if (cell?.winRate != null && (best == null || cell.winRate > best.winRate)) {
        best = { subLane: lane, winRate: cell.winRate };
      }
    }
    bucket.best = best;
  }
  return out;
}

// ── deps-injected async orchestrator (wires the PR-10 accessors WITHOUT importing db.ts) ────────────────

export interface SwingFeatureStoreDeps {
  /** PR-10 fetchGradedSwingFeatureRows (graded + feature-bearing swing positions). */
  fetchGradedRows: () => Promise<SwingFeatureRowLike[]>;
  /** PR-10 fetchSwingSnapshots — one position's ordered snapshot series. */
  fetchSnapshots: (positionId: number) => Promise<SwingSnapshotLike[]>;
}

export interface SwingTrajectoryStudies {
  summary: SwingFeatureStoreSummary;
  twoStagnantSessions: TrajectoryStudy;
  flowDecay: TrajectoryStudy;
  ivKillsGoodSetups: TrajectoryStudy;
  bestDteByArchetype: Record<SwingArchetype, BestDteByArchetype>;
}

/**
 * Load the graded rows + each position's snapshot series through INJECTED accessors, then run the pure
 * base-rate + trajectory studies. The route passes the real PR-10 db accessors; tests pass fakes — so no
 * live DB is needed to exercise the join. Snapshots are pre-loaded into a Map so the pure studies stay sync.
 */
export async function loadSwingTrajectoryStudies(deps: SwingFeatureStoreDeps): Promise<SwingTrajectoryStudies> {
  const rows = await deps.fetchGradedRows();
  const byId = new Map<number, SwingSnapshotLike[]>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, await deps.fetchSnapshots(row.id));
  }
  const snapshotsFor: SnapshotAccessor = (id) => byId.get(id) ?? [];
  return {
    summary: summarizeSwingFeatureStore(rows),
    twoStagnantSessions: studyTwoStagnantSessions(rows, snapshotsFor),
    flowDecay: studyFlowDecay(rows, snapshotsFor),
    ivKillsGoodSetups: studyIvKillsGoodSetups(rows, snapshotsFor),
    bestDteByArchetype: analyzeBestDteByArchetype(rows),
  };
}
