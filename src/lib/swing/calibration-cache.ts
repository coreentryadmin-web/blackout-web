// src/lib/swing/calibration-cache.ts — persists a DISTILLED slice of the swing calibration ladder's
// per-archetype/per-sub-lane graduation verdicts so the play-brief's request path (which cannot
// reach the DB flow window the ladder computes from) can cite a ticker's own historical archetype/
// sub-lane track record — Largo product contract point #10, "historical context"
// (docs/audit/LARGO-PRODUCT-CONTRACT.md).
//
// WHY THIS EXISTS (CLAUDE.md's Ask Largo mandate: "scoped but not yet built... blocked on a cache
// layer — the cron-side analyzeArchetypeRecord/analyzeSubLaneRecord compute is cheap but nothing
// persists a reusable report for the brief's request path to read"). calibration.ts's
// analyzeArchetypeRecord/analyzeSubLaneRecord already run every cron tick
// (swing-active-refresh/route.ts, via analyzeSwingCalibration) and produce exactly the shape a
// citation needs — but today the report is used ONCE (graduatedEdgeRungsFromReport, for the manage
// engine's live rung enforcement) and then DISCARDED. This module closes that gap: the cron writes a
// distilled snapshot here, and play-brief-context.ts reads it back through a bounded, best-effort
// read (brief-source-timeout.ts) that degrades to "no citation" rather than blocking the brief.
//
// DISTILLED, NOT THE WHOLE REPORT: `SwingCalibrationReport` carries seven wrappers' worth of raw
// CalibrationBucket/CI/recommendation objects (archetype floors, sub-lane floors, pillar weights,
// exit rungs, edge gates, contract rank, allocation caps) — far more than a brief needs to cite one
// archetype's win rate, and most of it (pillar weights, exit rungs, gates, rank, allocation) is not
// keyed by TICKER at all, so a brief has no way to attach it to "this play" anyway. Only the
// archetype and sub-lane floor buckets are keyed by something a play carries (`play.archetype`/
// `play.subLane`) — the same two dimensions commit.ts's `isCommitGraduated` already gates real
// capital on — so this module distills exactly those two, to exactly the fields a citation needs
// (tier / graduated / Wilson lower-bound / point-Δ / the sample it was computed over).
//
// PRECISION (Largo C6/C9): `wilsonLb` and the sample size cited alongside it MUST come from the
// SAME population. calibration.ts's `bucket` field on each graduation result is signal-ON ∪
// signal-OFF combined; `wilsonLb`/`tier` are computed from the signal-ON bucket ALONE
// (`onBucket`, added to `SwingStagedVerdict` alongside this module). Distilling from `bucket`
// instead would pair a Wilson lower-bound with a larger sample than it was actually computed over —
// an overstated-confidence bug that would be easy to introduce silently, so this module reads
// `onBucket` explicitly rather than the combined one.
//
// SAME WRITE/READ SEAM AS serving-lane.ts's persisted discovery snapshot
// (persistSwingServingSnapshot/readSwingServingSnapshot): a cron-side writer, a request-path reader,
// shared-cache.ts (Redis SET/GET, in-memory fallback) as the seam — see that file's header for the
// general pattern this mirrors.

import type {
  SwingArchetypeGraduation,
  SwingCalibrationReport,
  SwingGraduationTier,
  SwingSubLaneGraduation,
} from "./calibration";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";

/**
 * One archetype/sub-lane bucket's citation-ready evidence — everything a brief section needs to
 * quote a track record HONESTLY: the staged tier, the graduation flag, the Wilson lower-bound win
 * rate the graduation math actually cleared, the raw point-estimate edge over the off-signal
 * baseline, and the EXACT sample (n/wins/losses) `wilsonLbPct` was computed over.
 */
export interface SwingTrackRecordEntry {
  /** Staged tier by graded on-signal sample count (RESEARCH/PROVISIONAL_SHADOW/LIMITED/BROAD). */
  tier: SwingGraduationTier;
  /** The one true graduation flag — see calibration.ts's SwingStagedVerdict.graduated. A citation
   *  must never be built from an entry with `graduated:false` (Largo C6: omit, don't fabricate). */
  graduated: boolean;
  /** Wilson 95% LOWER-BOUND win rate of the on-signal bucket, as a PERCENTAGE (0-100) — the
   *  citation-ready form of calibration.ts's [0,1] proportion. */
  wilsonLbPct: number;
  /** Raw point-estimate win-rate edge (on-signal minus off-signal baseline), percentage points.
   *  Null when recommendSignal could not compute a delta (no usable off-signal baseline yet). */
  pointDeltaPts: number | null;
  /** Graded sample size the tier/wilsonLbPct are computed over — the ON-signal bucket only, never
   *  the wider on∪off bucket (see this file's header on the precision hazard that would create). */
  n: number;
  wins: number;
  losses: number;
  /** Raw (point-estimate) win rate of that same on-signal bucket, for display alongside the LB.
   *  Null only when n=0. */
  winRatePct: number | null;
}

/** Shared distillation for one graduation-ladder bucket result (works for both the archetype and
 *  sub-lane wrappers — both extend SwingStagedVerdict with the identical fields this reads). */
function distillEntry(g: SwingArchetypeGraduation | SwingSubLaneGraduation): SwingTrackRecordEntry {
  return {
    tier: g.tier,
    graduated: g.graduated,
    // wilsonLb is a [0,1] proportion (calibration.ts round4) — citation form is a 1-decimal percent.
    wilsonLbPct: Math.round(g.wilsonLb * 1000) / 10,
    pointDeltaPts: g.pointDelta,
    n: g.onBucket.n,
    wins: g.onBucket.wins,
    losses: g.onBucket.losses,
    winRatePct: g.onBucket.win_rate_pct,
  };
}

/**
 * The distilled, persistable snapshot — one entry per archetype/sub-lane the ladder graded this
 * cycle. A bucket the ladder has no rows for at all is simply ABSENT from the map (never a
 * fabricated zero-evidence entry) — the read-side lookup helpers below treat a missing key exactly
 * like `graduated:false`.
 */
export interface SwingArchetypeTrackRecordSnapshot {
  /** ISO timestamp this distillation was computed (cron write time) — Largo C1/C2 provenance. */
  asOf: string;
  /** Whole-lane graded-play count at write time (SwingCalibrationReport.graded_plays) — context for
   *  how broad the evidence base is overall, independent of any one bucket's own `n`. */
  gradedPlays: number;
  archetypes: Partial<Record<SwingArchetype, SwingTrackRecordEntry>>;
  subLanes: Partial<Record<SwingSubLane, SwingTrackRecordEntry>>;
}

/**
 * Pure distillation off an ALREADY-COMPUTED SwingCalibrationReport — no re-derivation. The cron
 * (swing-active-refresh/route.ts) already runs `analyzeSwingCalibration` once per tick for the
 * graduated-edge-rungs read; this reads the SAME report's `archetype_floors`/`sub_lane_floors`
 * rather than calling `analyzeArchetypeRecord`/`analyzeSubLaneRecord` a second time.
 */
export function distillSwingCalibrationReport(
  report: SwingCalibrationReport,
  nowIso: string = new Date().toISOString(),
): SwingArchetypeTrackRecordSnapshot {
  const archetypes: Partial<Record<SwingArchetype, SwingTrackRecordEntry>> = {};
  for (const g of report.archetype_floors) archetypes[g.archetype] = distillEntry(g);
  const subLanes: Partial<Record<SwingSubLane, SwingTrackRecordEntry>> = {};
  for (const g of report.sub_lane_floors) subLanes[g.subLane] = distillEntry(g);
  return { asOf: nowIso, gradedPlays: report.graded_plays, archetypes, subLanes };
}

/** Shared-cache key. Versioned (`v1`) per the repo's shared-cache convention so a future shape
 *  change can ship without a stale-shaped read racing a mid-deploy writer. */
export const SWING_ARCHETYPE_TRACK_RECORD_CACHE_KEY = "swing:calibration:archetype_track_record:v1";

/**
 * TTL — deliberately NOT sized to the cron's own ~15-minute intraday cadence, and this is a
 * considered deviation, not an oversight. `swing-active-refresh` only runs during RTH
 * (`isEtCashRth()` gate in the route), so the LAST write of an ordinary week lands Friday
 * afternoon — the exact same "weekday-only cron writer, but the read side must serve all weekend"
 * shape that already bit `SWING_SERVING_TTL_SEC` in serving-lane.ts at a too-short 26h TTL: that key
 * expired mid-weekend and silently zeroed an unrelated part of this SAME play-brief for the whole
 * gap (measured live 2026-09-06, documented in serving-lane.ts). This report's underlying data —
 * which archetypes/sub-lanes have graduated — also moves far slower than every 15 minutes (it only
 * shifts as new GRADED rows land, not on every intraday mark-and-review tick), so there is no
 * correctness reason to tie its TTL to the tick rate at all; a many-hours-stale graduation verdict is
 * still an honest, useful citation. Sized like `SWING_SERVING_TTL_SEC` (120h = 5 days) for the same
 * reason: safe past an ordinary Friday-close → Monday-open gap plus a Monday market holiday, with
 * margin, rather than repeating the exact bug already found on this cron's sibling snapshot.
 */
export const SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC = 120 * 60 * 60;

/** Persist one cron tick's distilled snapshot for the brief's request path to read. Fail-soft:
 *  returns false on a cache-layer error rather than throwing — the cron's calibration block already
 *  tolerates a failed graduated-rungs read the same way, and a missed write here costs the brief
 *  nothing worse than "no track-record citation this cycle" (the read side degrades identically to
 *  a cold cache). */
export async function persistSwingArchetypeTrackRecord(
  snapshot: SwingArchetypeTrackRecordSnapshot,
): Promise<boolean> {
  try {
    await sharedCacheSet(
      SWING_ARCHETYPE_TRACK_RECORD_CACHE_KEY,
      snapshot,
      SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC,
    );
    return true;
  } catch {
    return false;
  }
}

/** Read the latest persisted snapshot. Null on a cold/missing/unavailable cache — never throws;
 *  callers (play-brief-context.ts) additionally race this against a timeout budget
 *  (brief-source-timeout.ts) so a wedged Redis hop cannot block brief composition either. */
export async function readSwingArchetypeTrackRecord(): Promise<SwingArchetypeTrackRecordSnapshot | null> {
  try {
    return await sharedCacheGet<SwingArchetypeTrackRecordSnapshot>(SWING_ARCHETYPE_TRACK_RECORD_CACHE_KEY);
  } catch {
    return null;
  }
}

/**
 * Look up ONE archetype's track-record entry, but ONLY when it has actually graduated — Largo's
 * confidence-omission principle (LARGO-PRODUCT-CONTRACT.md C6: "confidence must be OMITTED when a
 * product cannot calibrate it... omission is honest, fabrication is not"). An ungraduated bucket's
 * win rate must never be cited as if it were reliable evidence, discounted or otherwise — it is
 * omitted entirely. Null archetype, missing snapshot, or missing/ungraduated entry all return null.
 */
export function graduatedArchetypeEntry(
  snapshot: SwingArchetypeTrackRecordSnapshot | null | undefined,
  archetype: SwingArchetype | null | undefined,
): SwingTrackRecordEntry | null {
  if (!snapshot || !archetype) return null;
  const entry = snapshot.archetypes[archetype];
  return entry?.graduated === true ? entry : null;
}

/** Same gating as {@link graduatedArchetypeEntry}, for the sub-lane dimension. */
export function graduatedSubLaneEntry(
  snapshot: SwingArchetypeTrackRecordSnapshot | null | undefined,
  subLane: SwingSubLane | null | undefined,
): SwingTrackRecordEntry | null {
  if (!snapshot || !subLane) return null;
  const entry = snapshot.subLanes[subLane];
  return entry?.graduated === true ? entry : null;
}
