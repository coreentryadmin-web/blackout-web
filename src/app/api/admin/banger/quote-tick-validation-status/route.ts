// GET /api/admin/banger/quote-tick-validation-status — admin-visible status for the Banger
// live-tick-log CONTROL-vs-CANDIDATE exit-rule study (operator directive 2026-09-27, phase 4).
//
// WHAT THIS ANSWERS, end to end, in one call:
//   - Is `banger_quote_tick_log` actually collecting enough to reconstruct BOTH the real CONTROL
//     exit (SCALE_OUT_RULES) and the 100/33/70 CANDIDATE from the SAME real trade, for every closed
//     Banger position? (per-position tick-coverage classification, `quote-tick-readiness.ts`)
//   - Which positions are ELIGIBLE for the study and which are REJECTED, and exactly why (missing
//     ticks, gaps, duplicate ticks, stale/backstop-heavy quotes, or a replayed `scaled` flag that
//     disagrees with what the DB actually recorded — the "partial fill" safeguard)?
//   - Has the eligible population crossed n>=30 yet? If not, report the shortfall honestly and stop
//     — this route NEVER computes or returns a CONTROL-vs-CANDIDATE verdict before that floor is
//     cleared, no matter how the numbers look on fewer positions (operator directive: "do not
//     produce a winner early").
//   - Once ready, the CONTROL and CANDIDATE results themselves (win rate, expectancy, mean delta +
//     95% CI, verdict), on both the MODEL track (theoretical fill) and EXEC track (bid-capped,
//     more conservative real-fill estimate).
//
// READ-ONLY. Never touches production Banger exit behavior, never tunes CONTROL_RULES or
// CANDIDATE_RULES (both imported verbatim from quote-tick-verdict.ts, which imports the entry rule
// straight from src/lib/zerodte/scale-out.ts and asserts byte-identity to it in its own test file),
// never backfits — every threshold here (edge/interior gap tolerances, BACKSTOP_HEAVY_RATIO,
// DEFAULT_MIN_VERIFIED_N=30) is a pre-existing, disclosed constant from quote-tick-readiness.ts /
// quote-tick-verdict.ts, none of them chosen or adjusted from this route's own output.
//
// Mirrors admin/banger/closed-export's and admin/banger/quote-tick-export's own auth/error/header
// conventions. Uses the cheap aggregate tick-coverage scan as a pre-filter (coverageEnvelopeOverlaps)
// so a position with no logged ticks at all never pays for a per-contract detail fetch.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { fetchBangerClosedExportRows, type BangerPositionRow } from "@/lib/banger/positions-db";
import { fetchBangerQuoteTickCoverage, fetchBangerQuoteTicksForContract, type BangerQuoteTickCoverageRow } from "@/lib/banger/quote-tick-log";
import {
  assessPositionCoverage,
  buildReadinessReport,
  buildEligibilityReadiness,
  coverageEnvelopeOverlaps,
  projectDaysToReadiness,
  DEFAULT_MIN_VERIFIED_N,
  type CoverageBucket,
} from "@/lib/banger/quote-tick-readiness";
import { replayPairTick, crossCheckScaledFlag, aggregateVerdict, CONTROL_RULES, CANDIDATE_RULES, type TradeRow } from "@/lib/banger/quote-tick-verdict";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;
const MAX_ROWS = 5000;
const MAX_TICKS_PER_CONTRACT = 5000;
const MAX_CONTRACTS_IN_COVERAGE = 5000;
/** Buffer before the position window's own `since` so the tick-coverage pre-filter can see rows for
 *  a position that was COMMITTED before the window but CLOSED inside it. Banger positions are 0-2
 *  week swing-style holds, so 30 days is generous headroom, not a tuned value. */
const TICK_COVERAGE_LOOKBACK_BUFFER_DAYS = 30;
/** How far past a position's own `closed_at` to ask for ticks — covers ordinary clock/insert skew
 *  between the row's stamped close time and the last tick actually logged for it. */
const CLOSE_WINDOW_BUFFER_MINUTES = 30;

type PositionStatusRow = {
  id: number;
  ticker: string;
  contract_occ: string;
  status: string;
  committed_at: string | null;
  closed_at: string | null;
  entry_premium: number;
  scaled_already: boolean;
  realized_pnl_pct: number | null;
  eligible: boolean;
  coverage: CoverageBucket | "NO_TICK_COVERAGE" | "MISSING_LIFECYCLE_TIMESTAMPS";
  tickCount: number;
  rejectReasons: string[];
  scaledFlagCrossCheck: { matches: boolean; replayScaled: boolean; recordedScaledAlready: boolean } | null;
  controlModelPct: number | null;
  candidateModelPct: number | null;
  modelDeltaPct: number | null;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS),
  );
  const minVerifiedN = Math.max(
    1,
    Number(req.nextUrl.searchParams.get("minN") ?? DEFAULT_MIN_VERIFIED_N) || DEFAULT_MIN_VERIFIED_N,
  );
  const windowSinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const windowSinceIso = new Date(windowSinceMs).toISOString();
  const tickCoverageSinceIso = new Date(windowSinceMs - TICK_COVERAGE_LOOKBACK_BUFFER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [positions, coverageRows] = await Promise.all([
      fetchBangerClosedExportRows(windowSinceIso, MAX_ROWS),
      fetchBangerQuoteTickCoverage(tickCoverageSinceIso, MAX_CONTRACTS_IN_COVERAGE),
    ]);

    const coverageByOcc = new Map<string, BangerQuoteTickCoverageRow>();
    for (const row of coverageRows) coverageByOcc.set(row.contract_occ, row);

    const statusRows: PositionStatusRow[] = [];
    // Two TradeRow arrays per fill track, one per "arm" placed in the `cand` slot -- aggregateVerdict
    // always computes winRate/avgWinner/avgLoser/expectancy/profitFactor off `cand.realizedPnlPct`,
    // so this is what makes CONTROL's and CANDIDATE's reported stats each genuinely their OWN
    // results, not one side's stats with the other only ever showing up as a median/delta.
    const candidateCentricModelRows: TradeRow[] = [];
    const controlCentricModelRows: TradeRow[] = [];
    const candidateCentricExecRows: TradeRow[] = [];
    const controlCentricExecRows: TradeRow[] = [];

    for (const position of positions) {
      const row = await classifyOnePosition(position, coverageByOcc);
      statusRows.push(row.status);
      if (row.candidateCentricModel) candidateCentricModelRows.push(row.candidateCentricModel);
      if (row.controlCentricModel) controlCentricModelRows.push(row.controlCentricModel);
      if (row.candidateCentricExec) candidateCentricExecRows.push(row.candidateCentricExec);
      if (row.controlCentricExec) controlCentricExecRows.push(row.controlCentricExec);
    }

    const coverageBuckets = statusRows.map((r) => (isCoverageBucket(r.coverage) ? r.coverage : "NONE"));
    const tickCoverageReport = buildReadinessReport(coverageBuckets, minVerifiedN);
    const eligibilityReadiness = buildEligibilityReadiness(
      statusRows.map((r) => r.eligible),
      minVerifiedN,
    );

    const windowDays = Math.max(1, days);
    const observedDailyEligibleRate = eligibilityReadiness.eligibleN > 0 ? eligibilityReadiness.eligibleN / windowDays : null;
    const projectedDaysToReady = projectDaysToReadiness(eligibilityReadiness.eligibleN, minVerifiedN, observedDailyEligibleRate);

    const ready = eligibilityReadiness.readyForVerdict;
    const candidateModelVerdict = ready ? aggregateVerdict(candidateCentricModelRows) : null;
    const controlModelVerdict = ready ? aggregateVerdict(controlCentricModelRows) : null;
    const candidateExecVerdict = ready ? aggregateVerdict(candidateCentricExecRows) : null;
    const controlExecVerdict = ready ? aggregateVerdict(controlCentricExecRows) : null;

    const eligiblePositions = statusRows.filter((r) => r.eligible);
    const rejectedPositions = statusRows.filter((r) => !r.eligible);

    const nowMs = Date.now();
    return NextResponse.json(
      roundFloats({
        // Largo contract C1: a UTC instant alone resolves the wrong ET session after ~20:00 ET --
        // keep the instant, add the ET wall-clock anchor beside it (session-anchor.test.ts).
        as_of: etStamp(nowMs),
        session_date: etSessionDate(nowMs),
        window: { since: windowSinceIso, days },
        study: {
          ready,
          status: ready ? "READY" : "NOT_READY",
          minVerifiedN,
          eligibleN: eligibilityReadiness.eligibleN,
          shortfall: eligibilityReadiness.shortfall,
          totalClosedPositionsInWindow: eligibilityReadiness.totalClosedPositionsInWindow,
          observedDailyEligibleRate,
          projectedDaysToReady,
          note: ready
            ? "n>=" + minVerifiedN + " eligible closed positions reached -- verdict below is real, not a preview."
            : "Below the n>=" + minVerifiedN + " floor -- no CONTROL-vs-CANDIDATE verdict is computed yet, by design (never produce a winner early).",
        },
        tickCoverage: {
          byBucket: tickCoverageReport.byBucket,
          fullCoverageN: tickCoverageReport.fullCoverageN,
        },
        eligiblePositions,
        rejectedPositions,
        control: { rules: CONTROL_RULES, model: controlModelVerdict, exec: controlExecVerdict },
        candidate: { rules: CANDIDATE_RULES, model: candidateModelVerdict, exec: candidateExecVerdict },
      }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    recordAdminRouteError("admin/banger/quote-tick-validation-status", error);
    return NextResponse.json({ error: "Failed to compute banger quote-tick validation status" }, { status: 502 });
  }
}

function isCoverageBucket(x: string): x is CoverageBucket {
  return x === "FULL" || x === "PARTIAL_START" || x === "PARTIAL_END" || x === "PARTIAL_BOTH" || x === "GAPPY" || x === "DUPLICATE_CONFLICT" || x === "BACKSTOP_HEAVY" || x === "NONE";
}

async function classifyOnePosition(
  position: BangerPositionRow,
  coverageByOcc: Map<string, BangerQuoteTickCoverageRow>,
): Promise<{
  status: PositionStatusRow;
  candidateCentricModel: TradeRow | null;
  controlCentricModel: TradeRow | null;
  candidateCentricExec: TradeRow | null;
  controlCentricExec: TradeRow | null;
}> {
  const base = {
    id: position.id,
    ticker: position.ticker,
    contract_occ: position.contract_occ,
    status: position.status,
    committed_at: position.committed_at,
    closed_at: position.closed_at,
    entry_premium: position.entry_premium,
    scaled_already: position.scaled_already,
    realized_pnl_pct: position.realized_pnl_pct,
  };

  const committedAtMs = position.committed_at ? Date.parse(position.committed_at) : NaN;
  const closedAtMs = position.closed_at ? Date.parse(position.closed_at) : NaN;
  const rejected = (coverage: PositionStatusRow["coverage"], tickCount: number, rejectReasons: string[]) => ({
    status: { ...base, eligible: false as const, coverage, tickCount, rejectReasons, scaledFlagCrossCheck: null, controlModelPct: null, candidateModelPct: null, modelDeltaPct: null },
    candidateCentricModel: null,
    controlCentricModel: null,
    candidateCentricExec: null,
    controlCentricExec: null,
  });

  if (!Number.isFinite(committedAtMs) || !Number.isFinite(closedAtMs) || closedAtMs <= committedAtMs) {
    return rejected("MISSING_LIFECYCLE_TIMESTAMPS", 0, ["missing_lifecycle_timestamps"]);
  }

  const coverageRow = coverageByOcc.get(position.contract_occ);
  if (!coverageEnvelopeOverlaps({ committedAtMs, closedAtMs }, coverageRow)) {
    return rejected("NO_TICK_COVERAGE", 0, ["no_tick_coverage_for_contract"]);
  }

  const untilIso = new Date(closedAtMs + CLOSE_WINDOW_BUFFER_MINUTES * 60_000).toISOString();
  const rawTickRows = await fetchBangerQuoteTicksForContract(position.contract_occ, position.committed_at!, untilIso, MAX_TICKS_PER_CONTRACT);
  const coverage = assessPositionCoverage({ committedAtMs, closedAtMs, rawTickRows });

  if (coverage.coverage !== "FULL") {
    return rejected(coverage.coverage, coverage.tickCount, coverage.reasons);
  }

  const entryPremium = num(position.entry_premium) ?? 0;
  const pair = replayPairTick(coverage.cleanedTicks, entryPremium, CONTROL_RULES, CANDIDATE_RULES);
  const crossCheck = crossCheckScaledFlag(pair.control.scaled, position.scaled_already);
  const scaledFlagCrossCheck = { matches: crossCheck.matches, replayScaled: crossCheck.replayScaled, recordedScaledAlready: crossCheck.recordedScaledAlready };

  if (!crossCheck.matches) {
    return {
      status: {
        ...base,
        eligible: false,
        coverage: coverage.coverage,
        tickCount: coverage.tickCount,
        rejectReasons: [crossCheck.reason!],
        scaledFlagCrossCheck,
        controlModelPct: pair.control.modelPct,
        candidateModelPct: pair.candidate.modelPct,
        modelDeltaPct: pair.modelDelta,
      },
      candidateCentricModel: null,
      controlCentricModel: null,
      candidateCentricExec: null,
      controlCentricExec: null,
    };
  }

  // Each `cand` slot below is what aggregateVerdict scores as the arm's OWN win-rate/expectancy/
  // median -- so building both directions here (rather than deriving one from the other later) is
  // what lets CONTROL and CANDIDATE each get their own real, independently-computed stats.
  const candidateCentricModel: TradeRow | null =
    pair.control.modelPct != null && pair.candidate.modelPct != null
      ? { id: position.id, ticker: position.ticker, current: pair.control.modelPct, cand: { realizedPnlPct: pair.candidate.modelPct, delta: pair.modelDelta } }
      : null;
  const controlCentricModel: TradeRow | null =
    pair.control.modelPct != null && pair.candidate.modelPct != null
      ? { id: position.id, ticker: position.ticker, current: pair.candidate.modelPct, cand: { realizedPnlPct: pair.control.modelPct, delta: pair.modelDelta == null ? null : -pair.modelDelta } }
      : null;
  const candidateCentricExec: TradeRow | null =
    pair.control.execPct != null && pair.candidate.execPct != null
      ? { id: position.id, ticker: position.ticker, current: pair.control.execPct, cand: { realizedPnlPct: pair.candidate.execPct, delta: pair.execDelta } }
      : null;
  const controlCentricExec: TradeRow | null =
    pair.control.execPct != null && pair.candidate.execPct != null
      ? { id: position.id, ticker: position.ticker, current: pair.candidate.execPct, cand: { realizedPnlPct: pair.control.execPct, delta: pair.execDelta == null ? null : -pair.execDelta } }
      : null;

  return {
    status: {
      ...base,
      eligible: true,
      coverage: coverage.coverage,
      tickCount: coverage.tickCount,
      rejectReasons: [],
      scaledFlagCrossCheck,
      controlModelPct: pair.control.modelPct,
      candidateModelPct: pair.candidate.modelPct,
      modelDeltaPct: pair.modelDelta,
    },
    candidateCentricModel,
    controlCentricModel,
    candidateCentricExec,
    controlCentricExec,
  };
}
