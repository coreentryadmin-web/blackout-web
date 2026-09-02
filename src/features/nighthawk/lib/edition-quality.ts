/**
 * Legacy evening edition — global strongest-play selection policy.
 *
 * Product rule (2026-08-03): the Legacy book must be the strongest plays out of the
 * entire scored universe (all dossier'd names), not a truncated top-18 slice padded
 * with rescue/backfill/hedge filler.
 *
 * Book floor (2026-08-04): still publish 3–5 names when the organic path thins out,
 * but ONLY by promoting the next-highest merit names from the same ranked universe —
 * score + tier floor, gate_promoted + warnings, never score-20 hedge filler.
 */

import type { PlaybookPlay } from "./types";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import {
  MIN_PUBLISH_SCORE,
  EDITION_MIN_PUBLISH_PLAYS,
  EDITION_TARGET_PLAYS,
  MAX_DOSSIER_STOCKS,
} from "./constants";
import {
  assignNighthawkTier,
  nhTierInputFromScored,
  nhConvictionRank,
  NH_SCORE_PRIME_MIN,
  type NighthawkTier,
} from "./nighthawk-tiers";

function envFlag(name: string, defaultOn = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Global-strongest mode — default ON. Set NH_LEGACY_GLOBAL_STRONGEST=0 for volume-first legacy. */
export function legacyGlobalStrongest(): boolean {
  return envFlag("NH_LEGACY_GLOBAL_STRONGEST", true);
}

/** How many ranked dossier'd names enter synthesis (full universe when global-strongest). */
export function effectiveSynthesisPool(): number {
  if (legacyGlobalStrongest()) return MAX_DOSSIER_STOCKS;
  return envInt("NH_LEGACY_SYNTHESIS_POOL", 18, 5, MAX_DOSSIER_STOCKS);
}

/** Minimum merit tier to publish (B while global-strongest is validated on live post-close). */
export function legacyMinPublishTier(): NighthawkTier {
  const raw = (process.env.NH_LEGACY_MIN_TIER ?? "B").trim().toUpperCase();
  if (raw === "B") return "B";
  if (raw === "C") return "C";
  return "A";
}

export function effectiveMinPublishScore(): number {
  const floor = Number(process.env.NH_MIN_PUBLISH_SCORE);
  if (Number.isFinite(floor) && floor > 0) return floor;
  // Global-strongest uses the measured overnight PRIME band floor (40–55), not the
  // inverted 55–69 band — see nighthawk-tiers.ts header (+2.99% avg in prime band).
  return legacyGlobalStrongest() ? Math.max(MIN_PUBLISH_SCORE, NH_SCORE_PRIME_MIN) : MIN_PUBLISH_SCORE;
}

export function effectiveTargetPlays(): number {
  return envInt(
    "NH_LEGACY_MAX_PLAYS",
    legacyGlobalStrongest() ? EDITION_TARGET_PLAYS : EDITION_TARGET_PLAYS,
    1,
    5
  );
}

export function effectiveMinPublishPlays(): number {
  return envInt(
    "NH_LEGACY_MIN_PLAYS",
    legacyGlobalStrongest() ? EDITION_MIN_PUBLISH_PLAYS : EDITION_MIN_PUBLISH_PLAYS,
    0,
    5
  );
}

/** Score floor for gate-promote + ranked-pool backfill rescue (tracks effectiveMinPublishScore). */
export function gatePromoteMinScore(): number {
  return effectiveMinPublishScore();
}

export function rescuePlaysEnabled(): boolean {
  return envFlag("NH_LEGACY_RESCUE", true);
}

export function gatePromoteEnabled(): boolean {
  return envFlag("NH_LEGACY_GATE_PROMOTE", true);
}

export function thinEditionBackfillEnabled(): boolean {
  return envFlag("NH_LEGACY_BACKFILL", true);
}

export function diversityHedgeEnabled(): boolean {
  if (legacyGlobalStrongest()) return envFlag("NH_LEGACY_DIVERSITY_HEDGE", false);
  return envFlag("NH_LEGACY_DIVERSITY_HEDGE", true);
}

export function forcedContrarianHedgeEnabled(): boolean {
  if (legacyGlobalStrongest()) return envFlag("NH_LEGACY_FORCED_HEDGE", false);
  return envFlag("NH_LEGACY_FORCED_HEDGE", true);
}

export function criticRescueEnabled(): boolean {
  // ON by default until global-strongest merit bar is validated on live post-close editions.
  return envFlag("NH_LEGACY_CRITIC_RESCUE", true);
}

/** Effective merit score — governor demotions apply to selection order. */
export function effectiveMeritScore(scored: ScoredCandidate): number {
  return scored.score - (scored.govPenalty ?? 0);
}

/**
 * How many candidates in a RANKED pool already clear the score+tier merit floor, evaluated on the
 * SAME two checks `filterPlaysByMerit` applies downstream (2026-08-05, root-cause instrumentation
 * for the 08-05-vs-08-04 thin-output investigation). Pure — no I/O, no side effects — so a build
 * can log this pre-synthesis without any behavior change, and a future session can unit-test the
 * count directly instead of reasoning about it from console output.
 *
 * NOT safe to use alone as a "nothing can possibly publish" short-circuit condition — see
 * {@link anyRankedClearsScoreFloor} for why the rescue-safe guard is score-only, not score+tier.
 */
export function countRankedClearingMerit(ranked: ScoredCandidate[]): number {
  const minScore = effectiveMinPublishScore();
  const minTier = legacyMinPublishTier();
  const minRank = nhConvictionRank(minTier);
  let clearing = 0;
  for (const r of ranked) {
    if (effectiveMeritScore(r) < minScore) continue;
    const tier = assignNighthawkTier(nhTierInputFromScored(r)).tier;
    if (nhConvictionRank(tier) < minRank) continue;
    clearing++;
  }
  return clearing;
}

/**
 * True when AT LEAST ONE candidate in the ranked pool clears the SCORE floor alone (tier not
 * required). This is the correct guard for a "skip synthesis, nothing can publish" short-circuit
 * — deliberately looser than {@link countRankedClearingMerit}'s score+tier check, because
 * `promoteTopBlocked` (publish-gates.ts's gate-promote rescue) admits a blocked play on
 * `play.score >= gatePromoteMinScore()` ALONE, with NO tier check — it is the loosest merit bar
 * anywhere in the downstream pipeline. `filterPlaysByMerit`/`rankedCandidateMeritEligible`
 * (play-backfill.ts) both require score+tier, but gate-promote's score-only bar means a
 * score-clears/tier-fails candidate is NOT guaranteed to fail every rescue path — only a
 * score-fails candidate is. Short-circuiting on the stricter score+tier check would risk skipping
 * synthesis on a night gate-promote could still have rescued something from.
 */
export function anyRankedClearsScoreFloor(ranked: ScoredCandidate[]): boolean {
  const minScore = effectiveMinPublishScore();
  return ranked.some((r) => effectiveMeritScore(r) >= minScore);
}

export function playMeritTier(
  play: PlaybookPlay,
  dossiers: Record<string, TickerDossier>
): NighthawkTier {
  const ticker = String(play.ticker ?? "").toUpperCase();
  const dossier = dossiers[ticker];
  const scored = dossier?.scored;
  if (scored) {
    return assignNighthawkTier(nhTierInputFromScored(scored)).tier;
  }
  const score = play.score ?? 0;
  return assignNighthawkTier({
    score: Number.isFinite(score) ? score : null,
    confirmingSignals: play.confirming_signals ?? null,
    earningsRisk: play.earnings_risk ?? false,
  }).tier;
}

/** Drop sub-floor / sub-tier plays; re-sort by effective merit; cap at target. */
export function filterPlaysByMerit(
  plays: PlaybookPlay[],
  dossiers: Record<string, TickerDossier>,
  ranked?: ScoredCandidate[]
): { plays: PlaybookPlay[]; dropped: Array<{ ticker: string; reason: string }> } {
  const minScore = effectiveMinPublishScore();
  const minTier = legacyMinPublishTier();
  const minRank = nhConvictionRank(minTier);
  const dropped: Array<{ ticker: string; reason: string }> = [];
  const meritByTicker = new Map<string, number>();
  if (ranked) {
    for (const r of ranked) meritByTicker.set(r.ticker.toUpperCase(), effectiveMeritScore(r));
  }

  const kept = plays.filter((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const score = meritByTicker.get(ticker) ?? play.score ?? 0;
    if (score < minScore) {
      dropped.push({ ticker, reason: `merit ${score} < floor ${minScore}` });
      return false;
    }
    const tier = playMeritTier(play, dossiers);
    if (nhConvictionRank(tier) < minRank) {
      dropped.push({ ticker, reason: `tier ${tier} < min ${minTier}` });
      return false;
    }
    return true;
  });

  kept.sort(
    (a, b) =>
      (meritByTicker.get(b.ticker.toUpperCase()) ?? b.score ?? -Infinity) -
      (meritByTicker.get(a.ticker.toUpperCase()) ?? a.score ?? -Infinity)
  );
  kept.forEach((p, i) => {
    p.rank = i + 1;
  });

  return { plays: kept.slice(0, effectiveTargetPlays()), dropped };
}
