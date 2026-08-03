/**
 * Legacy evening edition quality policy — env-overridable, defaults to "best only".
 *
 * Standing product rule (2026-08-03): one canonical book per edition_for; never swap
 * plays on incidental re-runs. Publish fewer names at a higher merit bar.
 */

import type { PlaybookPlay } from "./types";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import { MIN_PUBLISH_SCORE, EDITION_MIN_PUBLISH_PLAYS, EDITION_TARGET_PLAYS } from "./constants";
import { assignNighthawkTier, nhTierInputFromScored, nhConvictionRank, type NighthawkTier } from "./nighthawk-tiers";

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

/** Strict quality mode — default ON. Set NH_LEGACY_QUALITY_STRICT=0 to revert to volume-first. */
export function legacyQualityStrict(): boolean {
  return envFlag("NH_LEGACY_QUALITY_STRICT", true);
}

/** Minimum merit tier to publish (A = best only). */
export function legacyMinPublishTier(): NighthawkTier {
  const raw = (process.env.NH_LEGACY_MIN_TIER ?? "A").trim().toUpperCase();
  if (raw === "B") return "B";
  if (raw === "C") return "C";
  return "A";
}

export function effectiveMinPublishScore(): number {
  const floor = Number(process.env.NH_MIN_PUBLISH_SCORE);
  if (Number.isFinite(floor) && floor > 0) return floor;
  // Strict: prime-band floor (40) + headroom; tier filter is the real gate.
  return legacyQualityStrict() ? Math.max(MIN_PUBLISH_SCORE, 55) : MIN_PUBLISH_SCORE;
}

export function effectiveTargetPlays(): number {
  return envInt("NH_LEGACY_MAX_PLAYS", legacyQualityStrict() ? 3 : EDITION_TARGET_PLAYS, 1, 5);
}

export function effectiveMinPublishPlays(): number {
  return envInt("NH_LEGACY_MIN_PLAYS", legacyQualityStrict() ? 1 : EDITION_MIN_PUBLISH_PLAYS, 0, 5);
}

export function gatePromoteEnabled(): boolean {
  if (legacyQualityStrict()) return envFlag("NH_LEGACY_GATE_PROMOTE", false);
  return envFlag("NH_LEGACY_GATE_PROMOTE", true);
}

export function thinEditionBackfillEnabled(): boolean {
  if (legacyQualityStrict()) return envFlag("NH_LEGACY_BACKFILL", false);
  return envFlag("NH_LEGACY_BACKFILL", true);
}

export function forcedContrarianHedgeEnabled(): boolean {
  if (legacyQualityStrict()) return envFlag("NH_LEGACY_FORCED_HEDGE", false);
  return envFlag("NH_LEGACY_FORCED_HEDGE", true);
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

/** Drop plays below score floor and below minimum merit tier. Re-rank 1..N. */
export function filterPlaysByMerit(
  plays: PlaybookPlay[],
  dossiers: Record<string, TickerDossier>,
  ranked?: ScoredCandidate[]
): { plays: PlaybookPlay[]; dropped: Array<{ ticker: string; reason: string }> } {
  const minScore = effectiveMinPublishScore();
  const minTier = legacyMinPublishTier();
  const minRank = nhConvictionRank(minTier);
  const dropped: Array<{ ticker: string; reason: string }> = [];
  const scoreByTicker = new Map<string, number>();
  if (ranked) {
    for (const r of ranked) scoreByTicker.set(r.ticker.toUpperCase(), r.score);
  }

  const kept = plays.filter((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const score = play.score ?? scoreByTicker.get(ticker) ?? 0;
    if (score < minScore) {
      dropped.push({ ticker, reason: `score ${score} < floor ${minScore}` });
      return false;
    }
    const tier = playMeritTier(play, dossiers);
    if (nhConvictionRank(tier) < minRank) {
      dropped.push({ ticker, reason: `tier ${tier} < min ${minTier}` });
      return false;
    }
    return true;
  });

  kept.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  kept.forEach((p, i) => {
    p.rank = i + 1;
  });

  return { plays: kept.slice(0, effectiveTargetPlays()), dropped };
}
