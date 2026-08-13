/**
 * Largo play similarity card — "past plays like today's NVDA 0DTE".
 * Resolves today's query vector from the board or ledger, then k-NN over the feature store.
 */

import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { buildSetupFeatureVector, type SetupFeatureVector } from "@/lib/zerodte/feature-vector";
import {
  DEFAULT_SIMILARITY_K,
  findSimilarZeroDteSetups,
  type OutcomeDistribution,
  type SimilarityNeighbor,
} from "@/lib/zerodte/similarity";
import { dbConfigured, fetchGradedFeatureVectorRows } from "@/lib/db";

export type PlaySimilarityCard = {
  kind: "play_similarity";
  query_ticker: string;
  query_session: string;
  as_of: string;
  query_summary: string;
  query_source: "ledger_vector" | "board_setup" | "recent_analog";
  k: number;
  corpus_size: number;
  neighbors: SimilarityNeighbor[];
  distribution: OutcomeDistribution;
  insufficient_neighbors: boolean;
};

function summarizeQuery(fv: SetupFeatureVector): string {
  const parts = [
    `${fv.ticker} ${fv.side}`,
    fv.evidence_score != null ? `score ${Math.round(fv.evidence_score)}` : null,
    fv.fq_score != null ? `fq ${Math.round(fv.fq_score)}` : null,
    fv.reg_structure ? `regime ${fv.reg_structure}` : null,
    fv.discovery_origin ? `origin ${fv.discovery_origin}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || `${fv.ticker} 0DTE setup`;
}

async function queryFromBoard(ticker: string, sessionDate: string): Promise<SetupFeatureVector | null> {
  const { getZeroDteBoardPayload } = await import("@/lib/platform/zerodte-service");
  const board = await getZeroDteBoardPayload().catch(() => null);
  if (!board?.setups?.length) return null;
  const setup = board.setups.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase());
  if (!setup) return null;

  const nowEt = etMinutes(new Date());
  return buildSetupFeatureVector({
    ticker: setup.ticker,
    direction: setup.direction,
    etMinutes: Math.max(0, nowEt - 9 * 60 - 30),
    evidenceScore: setup.score,
    dossierScore: setup.dossier_score ?? null,
    flowQuality: setup.flow_quality,
    discoveryOrigin: setup.discovery_origin,
    contractHorizon: setup.contract_horizon,
    actualDteAtCommit: setup.actual_dte_at_commit,
    gammaRegime: setup.gamma_regime ?? null,
    darkPoolBias: (setup.dark_pool_bias as "bullish" | "bearish" | "mixed" | null) ?? null,
    vwapDistPct:
      setup.vwap != null && setup.underlying_price != null && setup.underlying_price > 0
        ? ((setup.underlying_price - setup.vwap) / setup.underlying_price) * 100
        : null,
    rsi14: setup.rsi14 ?? null,
    relVolume: setup.rel_volume ?? null,
    atr14: setup.atr14 ?? null,
  });
}

async function queryFromLedger(ticker: string, sessionDate: string): Promise<SetupFeatureVector | null> {
  if (!dbConfigured()) return null;
  const rows = await fetchGradedFeatureVectorRows(500);
  const hit = rows.find(
    (r) =>
      r.ticker.toUpperCase() === ticker.toUpperCase() &&
      r.session_date === sessionDate &&
      r.feature_vector &&
      typeof r.feature_vector === "object"
  );
  if (!hit?.feature_vector) return null;
  return hit.feature_vector as unknown as SetupFeatureVector;
}

async function recentTickerVector(ticker: string): Promise<SetupFeatureVector | null> {
  if (!dbConfigured()) return null;
  const rows = await fetchGradedFeatureVectorRows(500);
  const hit = rows.find(
    (r) =>
      r.ticker.toUpperCase() === ticker.toUpperCase() &&
      r.feature_vector &&
      typeof r.feature_vector === "object"
  );
  if (!hit?.feature_vector) return null;
  return hit.feature_vector as unknown as SetupFeatureVector;
}

/** Build the play-similarity card for Largo prefetch. */
export async function playSimilarityForLargo(ticker = "NVDA"): Promise<PlaySimilarityCard | null> {
  const t = String(ticker).trim().toUpperCase() || "NVDA";
  const sessionDate = todayEtYmd();

  let query: SetupFeatureVector | null = null;
  let querySource: PlaySimilarityCard["query_source"] = "board_setup";

  query = await queryFromBoard(t, sessionDate);
  if (!query) {
    query = await queryFromLedger(t, sessionDate);
    if (query) querySource = "ledger_vector";
  }
  if (!query) {
    query = await recentTickerVector(t);
    if (query) querySource = "recent_analog";
  }
  if (!query) return null;

  const rawRows = dbConfigured() ? await fetchGradedFeatureVectorRows(5000) : [];
  if (!rawRows.length) return null;

  const result = findSimilarZeroDteSetups(query, rawRows, {
    k: DEFAULT_SIMILARITY_K,
    sameTicker: true,
    excludeSessionDate: sessionDate,
  });

  return roundFloats({
    kind: "play_similarity",
    query_ticker: t,
    query_session: sessionDate,
    as_of: new Date().toISOString(),
    query_summary: summarizeQuery(query),
    query_source: querySource,
    k: result.k,
    corpus_size: result.corpusSize,
    neighbors: result.neighbors.slice(0, 12),
    distribution: result.distribution,
    insufficient_neighbors: result.insufficientNeighbors,
  });
}
