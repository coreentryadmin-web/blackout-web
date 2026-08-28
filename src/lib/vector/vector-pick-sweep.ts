import "server-only";

import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { buildRankedVectorPicks, VECTOR_CANDIDATE_POOL_SIZE } from "@/features/vector/lib/vector-contract-picks";
import { loadVectorPickEnrichment } from "@/features/vector/lib/vector-pick-enrichment";
import {
  evaluateVectorPickLiveStatus,
  resolveVectorPickLiveMid,
} from "@/features/vector/lib/vector-pick-live-status";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import {
  shouldPersistVectorPickClosure,
  vectorPickClosureCommitKey,
} from "@/lib/vector/vector-pick-closure-log";
import {
  insertVectorPickClosure,
  vectorPickClosureExists,
} from "@/lib/vector/vector-pick-closures-db";
import { upsertVectorPickLeader } from "@/lib/vector/vector-pick-leaders-db";
import {
  mergePeakPremiumPct,
  pickContextFromFullState,
  vectorPickLeaderKey,
} from "@/lib/vector/vector-pick-sweep-core";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { VECTOR_DEFAULT_DTE_HORIZON } from "@/features/vector/lib/vector-dte-horizon";

export type VectorPickSweepTickerResult = {
  ticker: string;
  verdict: "GREEN" | "SKIP" | "AMBER" | "RED";
  detail: string;
  picksRanked: number;
  leadersWritten: number;
  closuresLogged: number;
};

export type VectorPickSweepSummary = {
  sessionDate: string | null;
  tickersAttempted: number;
  green: number;
  skip: number;
  amber: number;
  red: number;
  leadersWritten: number;
  closuresLogged: number;
  results: VectorPickSweepTickerResult[];
};

function quoteForOcc(
  occ: string,
  side: "call" | "put",
  snap: import("@/lib/providers/options-snapshot").OptionSnapshot | undefined
) {
  const ws = getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS);
  if (ws) {
    const mid = resolveVectorPickLiveMid({ bid: ws.bid, ask: ws.ask, mark: ws.mark });
    if (mid != null || ws.bid != null || ws.ask != null) {
      return { bid: ws.bid, ask: ws.ask, mid, delta: null, markStale: mid == null };
    }
  }
  if (snap) {
    return {
      bid: snap.bid,
      ask: snap.ask,
      mid: resolveVectorPickLiveMid({ bid: snap.bid, ask: snap.ask, mark: snap.mark ?? null }),
      delta: snap.delta ?? null,
      markStale: false,
    };
  }
  return { bid: null, ask: null, mid: null, delta: null, markStale: true };
}

/** Evaluate + persist leaders/closures for one ticker using cache-first full state. */
export async function sweepVectorPickForTicker(
  ticker: string,
  sessionDate: string
): Promise<VectorPickSweepTickerResult> {
  const state = await fetchVectorFullState(ticker, VECTOR_DEFAULT_DTE_HORIZON);
  if (!state?.spot || !state.play || state.play.bias === "neutral") {
    return { ticker, verdict: "SKIP", detail: "no directional play", picksRanked: 0, leadersWritten: 0, closuresLogged: 0 };
  }

  const ctxBase = pickContextFromFullState(state);
  if (!ctxBase) {
    return { ticker, verdict: "SKIP", detail: "no pick context", picksRanked: 0, leadersWritten: 0, closuresLogged: 0 };
  }

  const chain = await resolveTickerChainRows(ticker);
  if (!chain) {
    return { ticker, verdict: "AMBER", detail: "no option chain", picksRanked: 0, leadersWritten: 0, closuresLogged: 0 };
  }

  const enrichment = await loadVectorPickEnrichment(ticker).catch(() => ({
    gexKingStrike: null,
    maxPain: null,
    strikeTotals: null,
    catalysts: [],
    newsHeadline: null,
  }));

  const ctx = {
    ...ctxBase,
    enrichment: {
      gexKingStrike: enrichment.gexKingStrike,
      maxPain: enrichment.maxPain,
      strikeTotals: enrichment.strikeTotals ?? undefined,
      catalysts: enrichment.catalysts,
      newsHeadline: enrichment.newsHeadline,
    },
  };

  const pool = buildRankedVectorPicks(ctx, chain, ticker, { limit: VECTOR_CANDIDATE_POOL_SIZE });
  const picks = pool.filter((p) => p.occ).slice(0, 3);
  if (!picks.length) {
    return { ticker, verdict: "AMBER", detail: "play ok, zero ranked picks", picksRanked: 0, leadersWritten: 0, closuresLogged: 0 };
  }

  const occs = picks.map((p) => p.occ!);
  const snaps = await fetchOptionsUnifiedSnapshot(occs).catch(
    () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
  );

  const play = state.play;
  let leadersWritten = 0;
  let closuresLogged = 0;

  for (const pick of picks) {
    const occ = pick.occ!;
    const quote = quoteForOcc(occ, pick.side, snaps.get(occ));
    const evalResult = evaluateVectorPickLiveStatus({
      spot: state.spot,
      side: pick.side,
      entryMid: pick.entryMid ?? pick.premium ?? null,
      caveat: pick.caveat,
      invalidation: play.invalidation ?? null,
      bias: play.bias,
      callWall: ctx.callWall ?? null,
      putWall: ctx.putWall ?? null,
      gammaFlip: ctx.gammaFlip ?? null,
      quote,
    });

    const entryMid = pick.entryMid ?? pick.premium ?? null;
    const peak = mergePeakPremiumPct(null, evalResult.premiumPctFromEntry);

    const playJson = {
      bias: play.bias,
      conviction: play.conviction,
      grade: play.grade,
      headline: play.headline,
      thesis: play.thesis,
      invalidation: play.invalidation,
      style: play.style,
    };

    const pickJson = {
      rank: pick.rank,
      label: pick.label,
      role: pick.role,
      premium: pick.premium,
      confidence: pick.confidence,
      caveat: pick.caveat,
      sweep: true,
    };

    const leaderKey = vectorPickLeaderKey(sessionDate, ticker, occ);
    const wroteLeader = await upsertVectorPickLeader({
      leaderKey,
      sessionDate,
      ticker,
      occ,
      side: pick.side,
      strike: pick.strike,
      expiry: pick.expiry,
      rank: pick.rank ?? null,
      label: pick.label ?? null,
      role: pick.role ?? null,
      entryMid,
      liveMid: quote.mid,
      premiumPctFromEntry: evalResult.premiumPctFromEntry,
      peakPremiumPct: peak,
      actionStatus: evalResult.status,
      actionReason: evalResult.reason,
      setupInvalidated: evalResult.setupInvalidated,
      spot: state.spot,
      playJson,
      pickJson,
    });
    if (wroteLeader) leadersWritten += 1;

    if (evalResult.status === "dont_buy") {
      const commitKey = vectorPickClosureCommitKey(sessionDate, ticker, occ);
      const exists = await vectorPickClosureExists(commitKey);
      if (shouldPersistVectorPickClosure(evalResult.status, exists)) {
        const logged = await insertVectorPickClosure({
          commitKey,
          sessionDate,
          ticker,
          occ,
          side: pick.side,
          strike: pick.strike,
          expiry: pick.expiry,
          rank: pick.rank ?? null,
          label: pick.label ?? null,
          role: pick.role ?? null,
          entryMid,
          closeMid: quote.mid,
          premiumPctFromEntry: evalResult.premiumPctFromEntry,
          closeReason: evalResult.reason,
          setupInvalidated: evalResult.setupInvalidated,
          spot: state.spot,
          playJson,
          pickJson,
        });
        if (logged) closuresLogged += 1;
      }
    }
  }

  return {
    ticker,
    verdict: "GREEN",
    detail: `${picks.length} pick(s) · ${play.bias} ${play.grade} · conv ${play.conviction}`,
    picksRanked: picks.length,
    leadersWritten,
    closuresLogged,
  };
}

const SWEEP_CONCURRENCY = 4;

/** Universe-wide Vector pick sweep — server-side, no `/vector` viewer required. */
export async function runVectorPickUniverseSweep(): Promise<VectorPickSweepSummary> {
  const sessionDate = etSessionDate(Date.now());
  if (!sessionDate) {
    return {
      sessionDate: null,
      tickersAttempted: 0,
      green: 0,
      skip: 0,
      amber: 0,
      red: 0,
      leadersWritten: 0,
      closuresLogged: 0,
      results: [],
    };
  }

  const tickers = vectorUniverseTickers();
  const results: VectorPickSweepTickerResult[] = [];

  for (let i = 0; i < tickers.length; i += SWEEP_CONCURRENCY) {
    const batch = tickers.slice(i, i + SWEEP_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          return await sweepVectorPickForTicker(ticker, sessionDate);
        } catch (err) {
          return {
            ticker,
            verdict: "RED" as const,
            detail: err instanceof Error ? err.message : String(err),
            picksRanked: 0,
            leadersWritten: 0,
            closuresLogged: 0,
          };
        }
      })
    );
    results.push(...batchResults);
  }

  return {
    sessionDate,
    tickersAttempted: tickers.length,
    green: results.filter((r) => r.verdict === "GREEN").length,
    skip: results.filter((r) => r.verdict === "SKIP").length,
    amber: results.filter((r) => r.verdict === "AMBER").length,
    red: results.filter((r) => r.verdict === "RED").length,
    leadersWritten: results.reduce((n, r) => n + r.leadersWritten, 0),
    closuresLogged: results.reduce((n, r) => n + r.closuresLogged, 0),
    results,
  };
}
