import { mapClaudePlayToEdition } from "./claude-edition";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import { buildDeterministicThesis } from "./deterministic-edition";
import type { TickerDossier } from "./dossier";
import { effectiveMeritScore, effectiveMinPublishPlays } from "./edition-quality";
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

/**
 * STRUCTURAL-ONLY backfill eligibility (2026-09-28 redesign, operator-approved — replaces the old
 * rankedCandidateMeritEligible, which required the SAME score+tier bar as the organic path and
 * made backfill a no-op on any night where the whole pool scored weakly, not just a gate-rejection
 * rescue). Backfill exists specifically to admit a candidate that did NOT clear the merit bar, so
 * checking that bar here would defeat the point. What it must still clear is "this is a real,
 * safe, gradeable trade, not a guess":
 *   - not trading-halted (mirrors deterministic-edition.ts's own main-loop check — a halted name
 *     has no live market to enter at all, backfill or not).
 * Score/tier are deliberately NOT checked here. Sector-concentration risk is respected by
 * ranking the eligible pool on effectiveMeritScore (governor-demoted), never raw score, in
 * backfillThinEditionPlays below — a name the cross-edition governor already discounted for
 * over-representation stays discounted for backfill purposes too, it is never bypassed.
 * "Completed scoring" and "resolves a real, liquid, affordable, geometry-valid contract" are
 * enforced by construction: the caller only ever passes candidates from the already-scored
 * `ranked` pool, and backfillThinEditionPlays itself skips (never placeholder-publishes) any
 * candidate that can't resolve a real contract or fails the geometry gate.
 */
export function backfillCandidateEligible(scored: ScoredCandidate): boolean {
  return !scored.trading_halt;
}

/**
 * PURE selection logic (2026-09-28, extracted from backfillThinEditionPlays so it's testable
 * without a network-dependent chain fetch — same split `buildDeterministicEditionPlays` already
 * uses: chains are an INPUT, never fetched internally). Given an already-eligible, already-ranked
 * pool plus their resolved chains, builds up to `minPlays` backfill plays. Every rejection reason
 * (no dossier, no contract, failed geometry) is a plain `continue` with a console.warn — the
 * candidate is simply not added, never published as a placeholder.
 */
export function selectBackfillPlays(params: {
  finalPlays: PlaybookPlay[];
  pool: ScoredCandidate[];
  dossiers: Record<string, TickerDossier>;
  chains: Record<string, EditionChainData>;
  minPlays: number;
}): { plays: PlaybookPlay[]; notes: string[] } {
  const { finalPlays, dossiers, chains, minPlays } = params;
  const used = new Set(finalPlays.map((p) => p.ticker.toUpperCase()));
  const notes: string[] = [];
  const backfilled: PlaybookPlay[] = [...finalPlays];
  // effectiveMeritScore, not raw score: a candidate the cross-edition sector-concentration
  // governor already demoted stays demoted here too — backfill ranks AFTER that risk control is
  // applied, it does not let a capped sector jump back ahead of an uncapped one by reverting to
  // raw score. Sorted here (not by the caller) so this — the part the operator specifically
  // required ("rank the remaining eligible candidates after those risk controls are applied") —
  // is covered by a pure, direct unit test rather than trusted-by-construction in the
  // network-touching wrapper.
  const pool = [...params.pool].sort((a, b) => effectiveMeritScore(b) - effectiveMeritScore(a));

  for (const scored of pool) {
    if (used.has(scored.ticker.toUpperCase())) continue;
    if (backfilled.length >= minPlays) break;
    const ticker = scored.ticker.toUpperCase();
    const dossier = dossiers[ticker];
    if (!dossier) continue;

    // No placeholder contracts: a backfill candidate with no real, liquid, affordable contract
    // is skipped outright, never published with an options_play of "-". This is the concrete
    // "prevent obviously bad/invalid contracts" guard — pickAffordableChainContract already
    // enforces the liquidity floor (tieredMinOi) and the $35/share premium cap; here we simply
    // refuse to fall through when it returns null instead of silently degrading to stock-only.
    const contract = pickAffordableChainContract(ticker, scored.direction, chains[ticker]);
    if (!contract) {
      console.warn(`[nighthawk/backfill] skipped ${ticker} — no real liquid/affordable contract`);
      continue;
    }
    const support = dossier.tech?.support_levels?.[0];
    const resistance = dossier.tech?.resistance_levels?.[0];
    const spot = dossier.tech?.price ?? chains[ticker]?.spot;
    const levels = buildDirectionalStockLevels({
      direction: scored.direction,
      support,
      resistance,
      spot,
    });
    // Same narrative builder every organically-qualified play (buildPlay) and last-resort rescue
    // play (buildRescuePlays) already use, both in deterministic-edition.ts — before this, a
    // backfill play's thesis/key_signal were both just `dossier.tech?.summary` (a bare technical
    // one-liner, e.g. "BB holding above VWAP.") with no catalyst quote, R:R context, or watch
    // flags, reading noticeably thinner than an organic pick even though buildDeterministicThesis
    // needs nothing selectBackfillPlays doesn't already have in scope (scored, dossier, levels).
    const { thesis, key_signal } = buildDeterministicThesis(scored, dossier, levels);
    const play = {
      ...mapClaudePlayToEdition(
        {
          ticker,
          type: "stock",
          direction: scored.direction === "long" ? "LONG" : "SHORT",
          conviction: scored.conviction,
          key_signal,
          entry_range: levels.entry_range,
          target: levels.target,
          stop: levels.stop,
          options_play: contract.options_play,
          entry_premium: contract.entry_premium,
          score: scored.score,
        },
        backfilled.length + 1,
        dossiers
      ),
      // mapClaudePlayToEdition derives `thesis` from the SAME raw `key_signal` it's given (no
      // separate thesis field on ClaudePlayRaw) — override with buildDeterministicThesis's own
      // richer, distinct thesis text rather than letting the compact key_signal double as both.
      thesis,
    };
    // Defense in depth: skip backfill candidates that still fail geometry (e.g. resistance ≤ support).
    if (!validatePlayGeometry(play).ok) {
      console.warn(`[nighthawk/backfill] skipped ${ticker} — levels fail geometry gate`);
      continue;
    }
    backfilled.push(
      capGatePromotedConviction({
        ...play,
        gate_promoted: true,
        selection_tier: "BACKFILL",
        gate_warnings: [
          `Ranked-pool merit fill (#${backfilled.length + 1} by score ${Math.round(effectiveMeritScore(scored))}) — verify entry geometry before acting`,
        ],
      }),
    );
    used.add(ticker);
    notes.push(
      `Merit backfill ${ticker} (merit ${Math.round(effectiveMeritScore(scored))}) — chain-grounded contract.`
    );
  }

  if (!notes.length) return { plays: finalPlays, notes: [] };

  const reranked = backfilled.map((p, i) => ({ ...p, rank: i + 1 }));
  return {
    plays: reranked,
    notes: [
      `Thin edition backfill: added ${notes.length} ranked-pool play(s) to reach minimum ${minPlays}.`,
      ...notes,
    ],
  };
}

/**
 * When critic/grounding/merit filter leaves fewer than the ops minimum, backfill from the
 * next-best ranked candidates (same universe as synthesis, sorted by governor-adjusted
 * effectiveMeritScore so the cross-edition sector cap is respected, never bypassed) with
 * chain-grounded contracts. Every backfill play is gate_promoted, carries selection_tier:
 * "BACKFILL" (distinct from an organically-qualified play), and an honest warning — never
 * silent filler, and never a placeholder: a candidate with no resolvable contract is skipped,
 * not published with a "-" options_play. Thin I/O wrapper around selectBackfillPlays — fetches
 * chains for the eligible pool, then hands off to the pure selection logic above.
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
  // Dedupe + structural eligibility only — selectBackfillPlays does the governor-respecting sort.
  const pool = params.ranked
    .filter((r) => !used.has(r.ticker.toUpperCase()))
    .filter((r) => backfillCandidateEligible(r));
  if (!pool.length) return { plays: params.finalPlays, notes: [] };

  const dossierList = pool
    .map((r) => params.dossiers[r.ticker.toUpperCase()])
    .filter((d): d is TickerDossier => Boolean(d));

  const chains = await fetchEditionChains({
    stockTickers: pool.map((r) => r.ticker),
    dossiers: dossierList,
  });

  return selectBackfillPlays({
    finalPlays: params.finalPlays,
    pool,
    dossiers: params.dossiers,
    chains,
    minPlays,
  });
}
