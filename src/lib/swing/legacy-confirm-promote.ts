// Legacy Night Hawk CONFIRMED → Swings handoff (post–morning-confirm, thesis intact).
//
// After nighthawk-morning-confirm validates overnight theses, CONFIRMED names (not pulled /
// INVALIDATED) are promoted into the swing serving snapshot so they surface on the Swings tab
// with a NIGHT HAWK origin badge. Serve-only: bucketGraduated stays false — no auto-commit.

import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import type { PlayStatus } from "@/features/nighthawk/lib/morning-confirm-verdict";
import { parsePlayLevels } from "@/features/nighthawk/lib/play-levels";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import type { PlayDirection } from "../horizon-fanout";
import { produceHorizonPlays, type HorizonPlay } from "../horizon-plays";
import { buildSwingDossier, type SwingDossier } from "./dossier";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context";
import type { SwingReads } from "../swing-signals";
import type { SwingServingSnapshot } from "./serving-lane";
import { persistSwingServingSnapshot, readSwingServingSnapshot } from "./serving-lane";
import { swingThesisKey, type SwingWatchCandidate } from "./accumulation-store";
import { swingServingReadsFromPlan, swingServingMetaFromDossier } from "./serving-ingest";

/** Discovery provenance stamped on promoted swing rows — renders as the desk origin badge. */
export const LEGACY_SWING_SIGNAL_KIND = "NIGHT HAWK";

export function isLegacyPromotedSignal(signalKinds: string[] | undefined | null): boolean {
  return (signalKinds ?? []).includes(LEGACY_SWING_SIGNAL_KIND);
}

/** Cross-session persistence bar satisfied by morning thesis validation (not a lone print). */
const LEGACY_PROMOTED_MIN_SESSIONS = 2;

export function legacyPlayDirection(play: PlaybookPlay): PlayDirection {
  const d = play.direction;
  return String(d ?? "").toLowerCase().startsWith("s") || String(d ?? "") === "SHORT" ? "SHORT" : "LONG";
}

function syntheticAccumulation(play: PlaybookPlay, direction: PlayDirection, spot: number): ZeroDteFlowAccumulation {
  const days = Math.max(1, play.flow_streak_days ?? 2);
  const isLong = direction === "LONG";
  // Ground strength in the published edition score — never fabricate a whale-print premium.
  const strength = Math.min(100, Math.max(40, play.score ?? 70));
  return {
    direction: isLong ? "bull" : "bear",
    strength,
    days,
    net_signed_premium: 0,
    magnet_strike: spot > 0 ? spot : 100,
    magnet_side: isLong ? "call" : "put",
    aligned: true,
  };
}

function swingReadsForLegacy(play: PlaybookPlay, direction: PlayDirection, spot: number): SwingReads {
  const accum = syntheticAccumulation(play, direction, spot);
  const days = Math.max(1, play.flow_streak_days ?? 2);
  // Structural reads only — no fabricated 10d returns; lineage is edition-confirmed, not live flow.
  return {
    accumulation: accum,
    flowWindowDays: days + 2,
    returnPct10d: null,
    spyReturnPct10d: null,
    priceAboveEma20: direction === "LONG",
    ema20AboveEma50: direction === "LONG",
    ema50Rising: direction === "LONG",
  };
}

function planFromLegacyLevels(
  play: PlaybookPlay,
  spot: number,
): { entryUnderlyingPx: number; thesisInvalidationPx: number; targetUnderlyingPx: number; atr: number } | null {
  const levels = parsePlayLevels(play);
  const entryMid =
    levels.entry_range_low != null && levels.entry_range_high != null
      ? (levels.entry_range_low + levels.entry_range_high) / 2
      : spot;
  const stop = levels.stop;
  const target = levels.target;
  if (!Number.isFinite(entryMid) || entryMid <= 0 || stop == null || target == null) return null;
  const atr = Math.abs(entryMid - stop) / 1.5;
  return {
    entryUnderlyingPx: entryMid,
    thesisInvalidationPx: stop,
    targetUnderlyingPx: target,
    atr: atr > 0 ? atr : entryMid * 0.02,
  };
}

/** Build one promoted swing artifact triple (dossier + play + watch) — pure when chain rows are supplied. */
export function buildLegacySwingArtifacts(params: {
  play: PlaybookPlay;
  checkedAt: string;
  editionFor: string;
  spot: number | null;
  chainRows: ChainStrikeRow[];
  chainSpot: number;
}): { dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate } | null {
  const { play, checkedAt, editionFor, spot, chainRows, chainSpot } = params;
  const ticker = play.ticker.toUpperCase();
  const direction = legacyPlayDirection(play);
  const groundedSpot = spot != null && spot > 0 ? spot : chainSpot;
  if (!(groundedSpot > 0) || chainRows.length === 0) return null;

  const plan = planFromLegacyLevels(play, groundedSpot);
  if (!plan) return null;

  const reads = swingReadsForLegacy(play, direction, groundedSpot);
  const dossier = buildSwingDossier({
    ticker,
    asOf: checkedAt,
    intendedDte: 14,
    reads,
    structure: {
      priceAboveEma20: direction === "LONG",
      ema20AboveEma50: direction === "LONG",
      ema50Rising: direction === "LONG",
    },
    relStrength: { nameReturnPct: reads.returnPct10d ?? 0, spyReturnPct: reads.spyReturnPct10d ?? 0 },
    flow: {
      accumAlignedDays: reads.accumulation?.days ?? 2,
      accumTotalDays: reads.flowWindowDays,
    },
    volatility: { contractQuality01: 0.65, thetaBurden01: 0.35 },
    regime01: 0.55,
    // Lower data quality — accumulation reads are edition-grounded, not live UW flow.
    dataQuality01: 0.55,
    planLevels: plan,
    ivRank: play.iv_rank ?? null,
  });

  // Force playbook direction — overnight edition is authoritative after morning confirm.
  const scoredDossier: SwingDossier = { ...dossier, direction };

  const playSet = produceHorizonPlays([
    {
      ticker,
      direction,
      horizonScores: { SWING: play.score ?? scoredDossier.score.score },
      asOfYmd: editionFor,
      chainRows,
    },
  ]);
  const swingPlay = playSet.SWING[0];
  if (!swingPlay) return null;

  const readsForMeta = swingServingReadsFromPlan(scoredDossier, groundedSpot, {
    contract: swingPlay.contract,
    asOf: checkedAt,
  });
  const meta = swingServingMetaFromDossier(scoredDossier, readsForMeta ?? undefined);

  const enrichedPlay: HorizonPlay = {
    ...swingPlay,
    archetype: meta.archetype ?? scoredDossier.archetype.archetype ?? undefined,
    subLane: meta.subLane ?? scoredDossier.subLane ?? undefined,
    setupState: meta.setupState ?? undefined,
    entryStatus: meta.entryStatus ?? undefined,
    signalKinds: [LEGACY_SWING_SIGNAL_KIND],
    firstSeenAt: checkedAt,
    bucketGraduated: false,
    factors: meta.factors,
    regime: meta.regime,
    thesisLevel: meta.thesisLevel,
    thesisNote: meta.thesisNote ?? undefined,
    reason: `${swingPlay.reason} · Legacy morning confirm (${editionFor})`,
  };

  const archetype = scoredDossier.archetype.archetype ?? "UNCLASSIFIED";
  const watch: SwingWatchCandidate = {
    ticker,
    direction,
    archetype,
    observationCount: LEGACY_PROMOTED_MIN_SESSIONS,
    distinctSessionDays: LEGACY_PROMOTED_MIN_SESSIONS,
    phasesSeen: ["PRE_OPEN"],
    signalKinds: [LEGACY_SWING_SIGNAL_KIND],
    sessionSignalKinds: [LEGACY_SWING_SIGNAL_KIND],
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    lastSessionDay: editionFor,
  };

  return { dossier: scoredDossier, play: enrichedPlay, watch };
}

/** Merge promoted artifacts into a serving snapshot, deduping by thesis key (existing rows win). */
export function mergeLegacyPromotedSnapshot(
  snap: SwingServingSnapshot | null,
  additions: Array<{ dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate }>,
  opts: { sessionDay: string; asOf: string; spotsByTicker: Record<string, number> },
): SwingServingSnapshot {
  const base: SwingServingSnapshot = snap ?? {
    asOf: opts.asOf,
    sessionDay: opts.sessionDay,
    dossiers: [],
    plays: [],
    watch: [],
    observed: [],
    spotsByTicker: {},
  };

  const existingKeys = new Set<string>([
    ...(base.watch ?? []).map((c) => swingThesisKey(c.ticker, c.direction, c.archetype)),
    ...(base.plays ?? []).map((p) =>
      swingThesisKey(p.ticker, p.direction, p.archetype ?? null),
    ),
  ]);

  const dossiers = [...(base.dossiers ?? [])];
  const plays = [...(base.plays ?? [])];
  const watch = [...(base.watch ?? [])];
  const spotsByTicker = { ...(base.spotsByTicker ?? {}), ...opts.spotsByTicker };

  for (const add of additions) {
    const key = swingThesisKey(add.watch.ticker, add.watch.direction, add.watch.archetype);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    dossiers.push(add.dossier);
    plays.push(add.play);
    watch.push(add.watch);
    const t = add.watch.ticker.toUpperCase();
    if (spotsByTicker[t] == null && opts.spotsByTicker[t] != null) {
      spotsByTicker[t] = opts.spotsByTicker[t]!;
    }
  }

  return {
    ...base,
    asOf: opts.asOf,
    sessionDay: opts.sessionDay,
    dossiers,
    plays,
    watch,
    spotsByTicker,
  };
}

/** Pull NIGHT HAWK thesis triples out of a persisted serving snapshot (morning-confirm handoff). */
export function legacyPromotedTriplesFromSnapshot(
  snap: SwingServingSnapshot,
): Array<{ dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate }> {
  const triples: Array<{ dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate }> = [];
  for (const w of snap.watch ?? []) {
    if (!isLegacyPromotedSignal(w.signalKinds)) continue;
    const ticker = w.ticker.toUpperCase();
    const play = (snap.plays ?? []).find(
      (p) => p.ticker.toUpperCase() === ticker && p.direction === w.direction,
    );
    const dossier = (snap.dossiers ?? []).find((d) => d.ticker.toUpperCase() === ticker);
    if (!play || !dossier) continue;
    triples.push({ dossier, play, watch: w });
  }
  return triples;
}

function stripTickersFromSnapshot(snap: SwingServingSnapshot, tickers: Set<string>): SwingServingSnapshot {
  const keep = (t: string) => !tickers.has(t.toUpperCase());
  return {
    ...snap,
    dossiers: (snap.dossiers ?? []).filter((d) => keep(d.ticker)),
    plays: (snap.plays ?? []).filter((p) => keep(p.ticker)),
    watch: (snap.watch ?? []).filter((w) => keep(w.ticker)),
    observed: (snap.observed ?? []).filter((o) => keep(o.ticker)),
  };
}

/** Re-attach morning-confirm legacy promotions after a swing-discovery scan overwrites the snapshot. */
export function carryLegacyPromotedIntoSnapshot(
  fresh: SwingServingSnapshot,
  prior: SwingServingSnapshot | null,
): SwingServingSnapshot {
  if (!prior) return fresh;
  const triples = legacyPromotedTriplesFromSnapshot(prior);
  if (triples.length === 0) return fresh;
  const legacyTickers = new Set(triples.map((t) => t.watch.ticker.toUpperCase()));
  const stripped = stripTickersFromSnapshot(fresh, legacyTickers);
  return mergeLegacyPromotedSnapshot(stripped, triples, {
    sessionDay: fresh.sessionDay,
    asOf: fresh.asOf,
    spotsByTicker: { ...(prior.spotsByTicker ?? {}), ...(fresh.spotsByTicker ?? {}) },
  });
}

export async function promoteLegacyConfirmedToSwing(opts: {
  editionFor: string;
  checkedAt: string;
  confirmed: PlayStatus[];
  plays: PlaybookPlay[];
  stockPremarketByTicker: Record<string, number | null>;
}): Promise<{ promoted: number; skipped: number; errors: string[]; promotedTickers: string[] }> {
  const errors: string[] = [];
  let promoted = 0;
  let skipped = 0;
  const promotedTickers: string[] = [];

  const confirmedTickers = new Set(
    opts.confirmed.filter((ps) => ps.status === "CONFIRMED").map((ps) => ps.ticker.toUpperCase()),
  );
  if (confirmedTickers.size === 0) {
    return { promoted: 0, skipped: 0, errors, promotedTickers: [] };
  }

  const additions: Array<{ dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate }> = [];
  const additionTickers: string[] = [];
  const spotsByTicker: Record<string, number> = {};

  for (const play of opts.plays) {
    const ticker = play.ticker.toUpperCase();
    if (!confirmedTickers.has(ticker)) continue;
    if (play.pulled) {
      skipped++;
      continue;
    }

    const spot = opts.stockPremarketByTicker[ticker] ?? null;
    if (spot != null && spot > 0) spotsByTicker[ticker] = spot;

    let chainRows: ChainStrikeRow[] = [];
    let chainSpot = spot ?? 0;
    try {
      const resolved = await resolveTickerChainRows(ticker);
      if (!resolved || resolved.rows.length === 0) {
        skipped++;
        errors.push(`${ticker}: no chain rows`);
        continue;
      }
      chainRows = resolved.rows;
      chainSpot = resolved.spot;
      if (spotsByTicker[ticker] == null && chainSpot > 0) spotsByTicker[ticker] = chainSpot;
    } catch (err) {
      skipped++;
      errors.push(`${ticker}: chain ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const artifact = buildLegacySwingArtifacts({
      play,
      checkedAt: opts.checkedAt,
      editionFor: opts.editionFor,
      spot,
      chainRows,
      chainSpot,
    });
    if (!artifact) {
      skipped++;
      errors.push(`${ticker}: could not build swing artifact`);
      continue;
    }
    additions.push(artifact);
    additionTickers.push(ticker);
    promoted++;
  }

  if (additions.length === 0) {
    return { promoted: 0, skipped, errors, promotedTickers: [] };
  }

  const snap = await readSwingServingSnapshot();
  const merged = mergeLegacyPromotedSnapshot(snap, additions, {
    sessionDay: opts.editionFor,
    asOf: opts.checkedAt,
    spotsByTicker,
  });
  const ok = await persistSwingServingSnapshot(merged);
  if (!ok) {
    errors.push("persistSwingServingSnapshot failed");
    return { promoted: 0, skipped: skipped + additions.length, errors, promotedTickers: [] };
  }

  return { promoted, skipped, errors, promotedTickers: additionTickers };
}
