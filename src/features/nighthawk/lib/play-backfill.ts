import { mapClaudePlayToEdition } from "./claude-edition";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import type { TickerDossier } from "./dossier";
import {
  effectiveMeritScore,
  effectiveMinPublishPlays,
  effectiveMinPublishScore,
  legacyMinPublishTier,
  playMeritTier,
} from "./edition-quality";
import { nhConvictionRank } from "./nighthawk-tiers";
import { tieredMinOi } from "./grounding";
import { validatePlayGeometry } from "./play-constraints";
import { capGatePromotedConviction } from "./publish-gates";
import { buildDirectionalStockLevels } from "./play-levels";
import {
  fetchEditionChains,
  type ChainStrikeRow,
  type EditionChainData,
} from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";

/** Pick the nearest affordable, liquid chain contract for a directional play. */
export function pickAffordableChainContract(
  ticker: string,
  direction: "long" | "short",
  chain: EditionChainData | undefined
): { options_play: string; entry_premium: number } | null {
  if (!chain?.rows?.length) return null;
  const side = direction === "short" ? "put" : "call";
  const spot = chain.spot > 0 ? chain.spot : 0;

  const minOi = spot > 0 ? tieredMinOi(spot) : 500;
  const affordable = (row: ChainStrikeRow): number | null => {
    const ask = side === "put" ? row.put_ask : row.call_ask;
    const oi = side === "put" ? row.put_oi : row.call_oi;
    if (ask == null || !Number.isFinite(ask) || ask <= 0 || ask > MAX_OPTION_PREMIUM_PER_SHARE) return null;
    if (oi < minOi) return null;
    return Number(ask.toFixed(2));
  };

  const candidates = [...chain.rows]
    .map((row) => ({ row, premium: affordable(row) }))
    .filter((c): c is { row: ChainStrikeRow; premium: number } => c.premium != null)
    .sort((a, b) => {
      const distA = spot > 0 ? Math.abs(a.row.strike - spot) : 0;
      const distB = spot > 0 ? Math.abs(b.row.strike - spot) : 0;
      if (distA !== distB) return distA - distB;
      return a.row.expiry.localeCompare(b.row.expiry);
    });

  const best = candidates[0];
  if (!best) return null;
  const sideLabel = side === "put" ? "Put" : "Call";
  return {
    options_play: `${ticker} $${best.row.strike} ${sideLabel} ${best.row.expiry}, entry prem ~$${best.premium.toFixed(2)}`,
    entry_premium: best.premium,
  };
}

/** True when a ranked candidate clears the global-strongest merit bar (score + tier). */
export function rankedCandidateMeritEligible(
  scored: ScoredCandidate,
  dossiers: Record<string, TickerDossier>,
): boolean {
  const minScore = effectiveMinPublishScore();
  const minTier = legacyMinPublishTier();
  if (effectiveMeritScore(scored) < minScore) return false;
  const probe: PlaybookPlay = {
    rank: 1,
    ticker: scored.ticker,
    direction: scored.direction === "short" ? "SHORT" : "LONG",
    conviction: scored.conviction,
    play_type: "stock",
    thesis: "",
    key_signal: "",
    entry_range: "-",
    target: "-",
    stop: "-",
    options_play: "-",
    score: scored.score,
    confirming_signals: scored.confirming_signals,
    earnings_risk: scored.earnings_risk,
  };
  const tier = playMeritTier(probe, dossiers);
  return nhConvictionRank(tier) >= nhConvictionRank(minTier);
}

/**
 * When critic/grounding/merit filter leaves fewer than the ops minimum, backfill from the
 * highest-merit ranked candidates (same universe as synthesis) with chain-grounded contracts.
 * Every backfill play is gate_promoted with an honest warning — never silent filler.
 */
export async function backfillThinEditionPlays(params: {
  finalPlays: PlaybookPlay[];
  ranked: ScoredCandidate[];
  dossiers: Record<string, TickerDossier>;
  minPlays?: number;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const minPlays = params.minPlays ?? effectiveMinPublishPlays();
  if (params.finalPlays.length >= minPlays) {
    return { plays: params.finalPlays, notes: [] };
  }

  const used = new Set(params.finalPlays.map((p) => p.ticker.toUpperCase()));
  const pool = params.ranked
    .filter((r) => !used.has(r.ticker.toUpperCase()))
    .filter((r) => rankedCandidateMeritEligible(r, params.dossiers))
    .sort((a, b) => effectiveMeritScore(b) - effectiveMeritScore(a));
  if (!pool.length) return { plays: params.finalPlays, notes: [] };

  const dossierList = pool
    .map((r) => params.dossiers[r.ticker.toUpperCase()])
    .filter((d): d is TickerDossier => Boolean(d));

  const chains = await fetchEditionChains({
    stockTickers: pool.map((r) => r.ticker),
    dossiers: dossierList,
  });

  const notes: string[] = [];
  const backfilled: PlaybookPlay[] = [...params.finalPlays];

  for (const scored of pool) {
    if (backfilled.length >= minPlays) break;
    const ticker = scored.ticker.toUpperCase();
    const dossier = params.dossiers[ticker];
    if (!dossier) continue;

    const contract = pickAffordableChainContract(ticker, scored.direction, chains[ticker]);
    const support = dossier.tech?.support_levels?.[0];
    const resistance = dossier.tech?.resistance_levels?.[0];
    const spot = dossier.tech?.price ?? chains[ticker]?.spot;
    const levels = buildDirectionalStockLevels({
      direction: scored.direction,
      support,
      resistance,
      spot,
    });
    const play = mapClaudePlayToEdition(
      {
        ticker,
        type: "stock",
        direction: scored.direction === "long" ? "LONG" : "SHORT",
        conviction: scored.conviction,
        key_signal:
          dossier.tech?.summary ??
          `Ranked-pool backfill (score ${Math.round(scored.score)}) — verify before entry.`,
        entry_range: levels.entry_range,
        target: levels.target,
        stop: levels.stop,
        options_play: contract?.options_play ?? "-",
        entry_premium: contract?.entry_premium,
        score: scored.score,
      },
      backfilled.length + 1,
      params.dossiers
    );
    // Defense in depth: skip backfill candidates that still fail geometry (e.g. resistance ≤ support).
    if (!validatePlayGeometry(play).ok) {
      console.warn(`[nighthawk/backfill] skipped ${ticker} — levels fail geometry gate`);
      continue;
    }
    backfilled.push(
      capGatePromotedConviction({
        ...play,
        gate_promoted: true,
        gate_warnings: [
          `Ranked-pool merit fill (#${backfilled.length + 1} by score ${Math.round(effectiveMeritScore(scored))}) — verify entry geometry before acting`,
        ],
      }),
    );
    used.add(ticker);
    notes.push(
      `Merit backfill ${ticker} (merit ${Math.round(effectiveMeritScore(scored))})${contract ? " — chain-grounded contract" : " — levels only"}.`
    );
  }

  if (!notes.length) return { plays: params.finalPlays, notes: [] };

  const reranked = backfilled.map((p, i) => ({ ...p, rank: i + 1 }));
  return {
    plays: reranked,
    notes: [
      `Thin edition backfill: added ${notes.length} ranked-pool play(s) to reach minimum ${minPlays}.`,
      ...notes,
    ],
  };
}
