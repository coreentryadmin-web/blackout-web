// Legacy Night Hawk CONFIRMED → Swings handoff (post–morning-confirm, thesis intact).
//
// After nighthawk-morning-confirm validates overnight theses, CONFIRMED names (not pulled /
// INVALIDATED) are promoted into the swing serving snapshot so they surface on the Swings tab
// with a NIGHT HAWK origin badge.
//
// LIFECYCLE (fixed 2026-10-01, Ask Largo standing mandate — a real bug, not a design choice):
// DISCOVERED → FORMING/PRE_TRIGGER → TRIGGERED/CONFIRMED → ACTIVE → EXITED/INVALIDATED.
// `buildLegacySwingArtifacts` classifies a Legacy play ONCE, at first promotion (`checkedAt`).
// Before this fix, every later day's carry-forward (`carryLegacyPromotedIntoSnapshot` →
// `refreshCarriedLegacyPlay`) refreshed ONLY the contract's price/DTE and left `setupState`/
// `entryStatus` FROZEN at that first-promotion-day read forever — a name whose underlying ran
// straight through its own published trigger days later still showed PRE_TRIGGER, because nothing
// ever looked again. Live-reproduced 2026-09-30/10-01: DELL and NVDA, both first classified
// 2026-09-28, both still read FORMING/PRE_TRIGGER on 2026-10-01 — NVDA's underlying had already
// closed through its $225.07 trigger at $228.38 three sessions earlier. `refreshCarriedLegacyPlay`
// now re-runs the EXACT SAME pure classifiers the WATCH lane calls on first promotion
// (`swingServingReadsFromPlan` + `swingServingMetaFromDossier`, which wrap `deriveSetupState`/
// `deriveEntryPlan`) against the carried dossier's PINNED structural levels (entry/invalidation/ATR
// — those don't drift daily, only price does) and a FRESH spot, every refresh. This also makes
// INVALIDATED reachable for the first time (a Legacy thesis whose underlying closes through its own
// invalidation level now correctly reads INVALIDATED instead of staying FORMING forever).
//
// GRADUATION (added 2026-10-01): a Legacy-promoted thesis was previously serve-only FOREVER —
// `commitGateBlockedBy: ["legacy:exempt"]` and `bucketGraduated: false` were hardcoded because
// these rows live ENTIRELY in this module's own persisted serving snapshot, a data path completely
// disjoint from `accumulation-store.ts` (the ONLY store `discovery.ts`'s commit loop reads
// candidates from via `fetchWatchEligible`) — not a flag bug, a genuinely separate pipeline with no
// bridge between them. `legacyCommitCandidatesFromSnapshot` is that bridge: once (and ONLY once) a
// carried Legacy play's LIVE-recomputed `setupState==="TRIGGERED"` and
// `entryStatus==="AT_TRIGGER"|"PULLBACK_TO_ENTRY"` — the SAME observable gate `serving.ts` requires
// for an organic candidate to reach COMMIT_NOW — it becomes a real `SwingCommitCandidate` built from
// its OWN already-materialized dossier/contract (no new fetch needed) and can be appended to
// `discovery.ts`'s existing `commitCandidates` list, so it is decided by the REAL, UNMODIFIED
// `computeSwingCommitPlan` — same G-S3 earnings / G-S4 regime / G-S6 confluence / G-S12 halt / G-S14
// Cortex gates, same armed-budget + book-percent caps + idempotency checks, zero duplicated or
// weakened logic. Deliberately does NOT invent a "NIGHT HAWK" confluence kind for G-S6: a Legacy-only
// candidate carries zero Tier-0 discovery-path provenance unless it is ALSO independently screened by
// organic FLOW/STRUCTURE/etc. this same scan, so G-S6 (>=2/3 INDEPENDENT kinds) legitimately blocks a
// Legacy-only signal exactly as it would an under-corroborated organic one — a single human-curated
// read must not be able to satisfy that bar alone, or this bridge would silently weaken the gate the
// operator explicitly asked not to bypass.

import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import type { PlayStatus } from "@/features/nighthawk/lib/morning-confirm-verdict";
import { parsePlayLevels } from "@/features/nighthawk/lib/play-levels";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import { calendarDte, type PlayDirection } from "../horizon-fanout";
import { produceHorizonPlays, type HorizonPlay } from "../horizon-plays";
import { HORIZONS } from "../horizons";
import { atrProxyFromCloses, deriveSwingPlanLevels } from "./structure-levels";
import { buildSwingDossier, type SwingDossier } from "./dossier";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context";
import type { SwingReads } from "../swing-signals";
import type { SwingServingSnapshot } from "./serving-lane";
import { persistSwingServingSnapshot, readSwingServingSnapshot } from "./serving-lane";
import { swingThesisKey, type SwingWatchCandidate } from "./accumulation-store";
import { swingServingReadsFromPlan, swingServingMetaFromDossier } from "./serving-ingest";
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { todayEt } from "@/lib/et-date";
import type { SwingCommitCandidate } from "./commit";
import type { SwingDiscoveryPath } from "./discovery";

/** Same lookback organic Swing discovery fetches (swing-discovery/route.ts DAILY_BAR_LOOKBACK_DAYS) — enough
 *  calendar days back to give atrProxyFromCloses its 14-session window on a typical trading calendar. */
const LEGACY_PROMOTE_DAILY_BAR_LOOKBACK_DAYS = 200;

function ymdDaysAgo(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
}

/** Fail-soft daily-closes fetch for the ATR-based plan path (planFromCloses). A failure or empty result
 *  yields null — buildLegacySwingArtifacts then falls back to planFromLegacyLevels, never throws. */
async function fetchLegacyPromoteCloses(ticker: string, nowMs: number): Promise<number[] | null> {
  try {
    const to = todayEt(new Date(nowMs));
    const from = ymdDaysAgo(nowMs, LEGACY_PROMOTE_DAILY_BAR_LOOKBACK_DAYS);
    const bars = await fetchStockDailyBars(ticker, from, to);
    const closes = bars.map((b) => b.c).filter((c) => Number.isFinite(c));
    return closes.length > 0 ? closes : null;
  } catch {
    return null;
  }
}

/** Discovery provenance stamped on promoted swing rows — renders as the desk origin badge. */
export const LEGACY_SWING_SIGNAL_KIND = "NIGHT HAWK";

export function isLegacyPromotedSignal(signalKinds: string[] | undefined | null): boolean {
  return (signalKinds ?? []).includes(LEGACY_SWING_SIGNAL_KIND);
}

/**
 * Legacy promotion must not admit contracts below the Swing lane floor — the same [dteMin, dteMax]
 * window organic discovery and produceHorizonPlays enforce. resolveTickerChainRows returns front
 * expiries with no DTE filter; without this, a dte 2–4 contract overlaps the 0DTE board (FINDINGS
 * 2026-08-06 P1 dual-admission on the Legacy→Swing path).
 */
export function filterChainRowsForSwingPromotion(
  rows: ChainStrikeRow[],
  sessionDayYmd: string,
): ChainStrikeRow[] {
  const minDte = HORIZONS.SWING.dteMin;
  const maxDte = HORIZONS.SWING.dteMax;
  return rows.filter((row) => {
    const dte = calendarDte(sessionDayYmd, row.expiry);
    return Number.isFinite(dte) && dte >= minDte && dte <= maxDte;
  });
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

/**
 * FALLBACK ONLY (FINDINGS 2026-08-06 P2 follow-up): Legacy's own published overnight-thesis entry/stop/
 * target band, sized for a NEXT-DAY 0DTE-adjacent thesis, not a genuine multi-day swing hold. Live evidence:
 * the 30-day grading record's top failure modes were `target_unreachable` (16/48) and
 * `unfilled_never_traded_back` (9/48) — consistent with these next-day-sized levels being unrealistic over
 * an actual 2-30 DTE hold. `planFromCloses` (below) is now the PRIMARY path whenever any daily closes are
 * available at all; this is used only when the closes fetch itself comes back empty (no price history to
 * ground an ATR proxy in), so a promoted play still gets SOME geometry rather than none.
 */
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

/**
 * PRIMARY path (FINDINGS 2026-08-06 P2 follow-up, fix): the SAME `deriveSwingPlanLevels`/`atrProxyFromCloses`
 * organic Swing discovery uses (`swing-ingest.ts`) — 1.5×ATR stop / 2.7×ATR target grounded in the
 * underlying's own recent daily range, not Legacy's overnight-thesis band. Used whenever `nameCloses` has
 * ANY data at all (even too thin for a real ATR proxy — `deriveSwingPlanLevels` itself falls back to a
 * price-relative 1.5% ATR in that case, identical to what organic discovery does on a thin series, so a
 * Legacy-promoted play's geometry degrades exactly the same way an organically-discovered one's would,
 * never a Legacy-specific special case).
 */
function planFromCloses(
  direction: PlayDirection,
  spot: number,
  nameCloses: readonly number[],
): { entryUnderlyingPx: number; thesisInvalidationPx: number; targetUnderlyingPx: number; atr: number } | null {
  return deriveSwingPlanLevels(direction, spot, atrProxyFromCloses(nameCloses));
}

/** Build one promoted swing artifact triple (dossier + play + watch) — pure when chain rows (+ optional
 *  daily closes) are supplied. */
export function buildLegacySwingArtifacts(params: {
  play: PlaybookPlay;
  checkedAt: string;
  editionFor: string;
  spot: number | null;
  chainRows: ChainStrikeRow[];
  chainSpot: number;
  /** Recent daily closes for the underlying (any length > 0) — when present, plan levels are grounded in
   *  the underlying's own multi-day ATR (`planFromCloses`) instead of Legacy's overnight-thesis band
   *  (FINDINGS 2026-08-06 P2 follow-up, fix). Absent/empty → falls back to `planFromLegacyLevels`. */
  nameCloses?: readonly number[] | null;
}): { dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate } | null {
  const { play, checkedAt, editionFor, spot, chainRows, chainSpot, nameCloses } = params;
  const ticker = play.ticker.toUpperCase();
  const direction = legacyPlayDirection(play);
  const groundedSpot = spot != null && spot > 0 ? spot : chainSpot;
  if (!(groundedSpot > 0) || chainRows.length === 0) return null;

  const swingChainRows = filterChainRowsForSwingPromotion(chainRows, editionFor);
  if (swingChainRows.length === 0) return null;

  const plan =
    nameCloses != null && nameCloses.length > 0
      ? (planFromCloses(direction, groundedSpot, nameCloses) ?? planFromLegacyLevels(play, groundedSpot))
      : planFromLegacyLevels(play, groundedSpot);
  if (!plan) return null;

  const reads = swingReadsForLegacy(play, direction, groundedSpot);

  const playSet = produceHorizonPlays([
    {
      ticker,
      direction,
      horizonScores: { SWING: play.score ?? 70 },
      asOfYmd: editionFor,
      chainRows: swingChainRows,
    },
  ]);
  const swingPlay = playSet.SWING[0];
  if (!swingPlay?.contract) return null;

  const intendedDte = swingPlay.contract.dte;
  const dossier = buildSwingDossier({
    ticker,
    asOf: checkedAt,
    intendedDte,
    reads,
    structure: {
      priceAboveEma20: direction === "LONG",
      ema20AboveEma50: direction === "LONG",
      ema50Rising: direction === "LONG",
    },
    // Omit relStrength when 10d returns are absent — `?? 0` would fabricate a worst-case REL_STRENGTH
    // score (relativeStrengthScore(0,0)=0) instead of dropping the pillar from the denominator.
    ...(reads.returnPct10d != null && reads.spyReturnPct10d != null
      ? { relStrength: { nameReturnPct: reads.returnPct10d, spyReturnPct: reads.spyReturnPct10d } }
      : {}),
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

  const readsForMeta = swingServingReadsFromPlan(scoredDossier, groundedSpot, {
    contract: swingPlay.contract,
    asOf: checkedAt,
  });
  const meta = swingServingMetaFromDossier(scoredDossier, readsForMeta ?? undefined);

  /**
   * FINDINGS 2026-09-12 (Ask Largo × Night Hawk Swings mandate): `meta.factors` is
   * `contributionsToFactors(scoredDossier.score.contributions)` — a breakdown of the DOSSIER's own
   * independently-computed synthetic pillar score (structure heuristics + a hardcoded
   * regime01=0.55/dataQuality01=0.55 — see `buildLegacySwingArtifacts` above). But the `score` this
   * play actually SHOWS (and the one `scoreFloor` gates/graduation compare against) is
   * `swingPlay.score`, sourced straight from Legacy's own PUBLISHED edition conviction score
   * (`horizonScores: { SWING: play.score ?? 70 }` above) — a completely different scoring run.
   *
   * Pairing them (the pre-fix behavior) violates `contributionsToFactors`'s own documented
   * invariant in `swing-pillars.ts` — "never a freshly re-run dossier's contributions paired with
   * a frozen/pinned score from a different run" — and is the third occurrence of the exact bug
   * class #4826/#4832 already fixed in `banger-lane-merge.ts`/`vector-lane-enrich.ts` and
   * `live-plays.ts`/`serving-lane.ts`: a "Why this play was picked" panel showing a SCORE next to
   * factor rows that do not sum to it. Live evidence (2026-09-12,
   * GET /api/market/nighthawk/horizons?view=swings): MRVL score 81 vs factors summing to 74.7,
   * IREN score 61 vs 75.8 (factors LARGER than score), SKHY (WATCH) score 59 vs 26.6 — all three
   * are Legacy-morning-confirm-promoted rows (`reason` carries "Legacy morning confirm").
   *
   * Fix, same shape as the Banger-lane fix: the Legacy edition score is the one real, authoritative
   * signal behind this promoted play (this file's own `syntheticAccumulation` comment: "Ground
   * strength in the published edition score — never fabricate a whale-print premium"), so the
   * honest breakdown is a single factor equal to that score, not a synthetic dossier decomposition
   * paired with a number it was never computed from. `meta.archetype`/`meta.regime`/
   * `meta.thesisLevel`/etc. are unaffected — those are independent classification reads, not
   * additive-sum-to-score fields, so they keep using the dossier's real values.
   */
  const factors: HorizonPlay["factors"] = [{ label: "Night Hawk edition score", points: swingPlay.score }];

  const enrichedPlay: HorizonPlay = {
    ...swingPlay,
    archetype: meta.archetype ?? scoredDossier.archetype.archetype ?? undefined,
    subLane: meta.subLane ?? scoredDossier.subLane ?? undefined,
    setupState: meta.setupState ?? undefined,
    entryStatus: meta.entryStatus ?? undefined,
    signalKinds: [LEGACY_SWING_SIGNAL_KIND],
    commitGateBlockedBy: ["legacy:exempt"],
    firstSeenAt: checkedAt,
    bucketGraduated: false,
    factors,
    regime: meta.regime,
    thesisLevel: meta.thesisLevel,
    thesisNote: meta.thesisNote ?? undefined,
    sectorLeadershipFacts: meta.sectorLeadershipFacts,
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

/**
 * Expiry (YYYY-MM-DD) of a carried play's frozen contract, or null when the blob has none.
 *
 * A null expiry is treated as UNVERIFIABLE, not as fine: `isCarriedContractLive` drops it. A carried
 * row we cannot date is exactly the row we cannot vouch for.
 */
export function carriedContractExpiry(play: HorizonPlay): string | null {
  const exp = play?.contract?.expiry;
  return typeof exp === "string" && exp.length > 0 ? exp : null;
}

/**
 * True when a legacy-carried play's FROZEN contract is still tradeable on `sessionDay`.
 *
 * Carried rows re-attach the prior snapshot's play verbatim — contract blob, quote and greeks
 * included — so a contract that has since expired keeps being served with its flag-day numbers.
 * Measured live 2026-08-07: the board showed CRWV 84C, SKHY 148C and RDDT 152.5C all labelled
 * "3DTE" with expiry 2026-08-07, i.e. ZERO DTE and expiring that session, at flag-day prices —
 * SKHY served mid 6.44 against a live 0.22 (−96.5%), and AEM's served 9.38 vs 21.30 was BELOW
 * intrinsic. Deltas were equally frozen (SKHY served Δ0.600 vs live Δ0.086).
 *
 * Fail-closed by design: an expired or undateable contract is DROPPED rather than served. Showing
 * no row is a small loss; showing a real ticker at a price 29× its market is a member sizing a
 * position off a number that has not existed for days.
 */
export function isCarriedContractLive(play: HorizonPlay, sessionDay: string): boolean {
  const expiry = carriedContractExpiry(play);
  if (!expiry || !sessionDay) return false;
  // Expiry ON the session day still trades that day, so `>=` — this guard is about contracts that
  // have already expired, not about the lane's DTE floor (a separate, deliberate policy question).
  return expiry >= sessionDay;
}

/**
 * Refresh a legacy-carried play for the current session: recompute calendar DTE, merge a fresher
 * quote from today's organic scan when strike/expiry match, drop stale mids when the DTE label has
 * drifted (FINDINGS 2026-08-07 frozen-contract serve bug) — AND (fixed 2026-10-01) re-run the LIVE
 * setup-maturity/entry-stance classification against a fresh spot, instead of leaving `setupState`/
 * `entryStatus` frozen at whatever they read on the play's original promotion day. `live` is optional
 * and backward-compatible: omitting it (or an ungroundable spot/dossier) reproduces the exact prior
 * behavior — contract-only refresh, classification untouched — so every existing caller/test that
 * doesn't pass it keeps working unchanged.
 */
export function refreshCarriedLegacyPlay(
  play: HorizonPlay,
  sessionDay: string,
  freshPlayByTicker?: ReadonlyMap<string, HorizonPlay>,
  live?: { dossier?: SwingDossier | null; spot?: number | null; asOf?: string },
): HorizonPlay | null {
  if (!isCarriedContractLive(play, sessionDay) || !play.contract) return null;
  const expiry = carriedContractExpiry(play)!;
  const dte = calendarDte(sessionDay, expiry);
  if (!Number.isFinite(dte) || dte < HORIZONS.SWING.dteMin || dte > HORIZONS.SWING.dteMax) return null;

  const fresh = freshPlayByTicker?.get(play.ticker.toUpperCase());
  const sameContract =
    fresh?.contract &&
    fresh.contract.expiry === expiry &&
    fresh.contract.strike === play.contract.strike &&
    fresh.contract.right === play.contract.right;

  const staleDte = play.contract.dte !== dte;
  const mergedContract = sameContract
    ? { ...play.contract, ...fresh!.contract, dte }
    : {
        ...play.contract,
        dte,
        // A carried blob with a stale DTE label almost certainly has a stale quote too — drop it
        // honestly until live marks or the next scan repopulates it.
        ...(staleDte
          ? { mid: null, bid: null, ask: null, delta: play.contract.delta ?? null }
          : {}),
      };

  const reason =
    play.reason && staleDte
      ? play.reason.replace(/\b\d+DTE\b/g, `${dte}DTE`)
      : play.reason;

  // ── live re-classification (fixed 2026-10-01) ──────────────────────────────────────────────
  // Re-run the EXACT SAME pure classifiers the WATCH lane calls at first promotion
  // (swingServingReadsFromPlan → swingServingMetaFromDossier, which wrap deriveSetupState /
  // deriveEntryPlan) against the dossier's PINNED structural plan levels (entry/invalidation/ATR —
  // these were set once from promotion-day ATR and should NOT drift daily) and a FRESH spot. A
  // missing dossier or ungroundable spot degrades honestly to the prior (frozen) fields — never a
  // guess, same discipline as every other field in this module.
  let liveFields: Partial<HorizonPlay> = {};
  if (live?.dossier && live.spot != null && Number.isFinite(live.spot) && live.spot > 0) {
    const reads = swingServingReadsFromPlan(live.dossier, live.spot, {
      contract: mergedContract,
      asOf: live.asOf,
    });
    if (reads) {
      const meta = swingServingMetaFromDossier(live.dossier, reads);
      liveFields = {
        setupState: meta.setupState ?? play.setupState,
        entryStatus: meta.entryStatus ?? play.entryStatus,
        thesisLevel: meta.thesisLevel,
        thesisNote: meta.thesisNote ?? undefined,
        entryTriggerUnderlyingPx: meta.entryTriggerUnderlyingPx ?? play.entryTriggerUnderlyingPx ?? null,
        invalidationUnderlyingPx:
          live.dossier.plan?.thesisInvalidationPx ?? play.invalidationUnderlyingPx ?? null,
        liveSpot: live.spot,
      };
    }
  }

  return { ...play, contract: mergedContract, reason, ...liveFields };
}

/**
 * Re-attach morning-confirm legacy promotions after a swing-discovery scan overwrites the snapshot.
 * `freshSpotsByTicker` (optional, caller-injected IO) supplies a current underlying price per carried
 * Legacy ticker — tried first, falling back to whatever this scan's own organic universe or the
 * prior snapshot already had cached for that ticker. Absent for a given ticker ⇒ that one row's
 * classification stays frozen this cycle (honest degrade, never a guess) while every other field
 * (contract price/DTE) still refreshes normally.
 */
export function carryLegacyPromotedIntoSnapshot(
  fresh: SwingServingSnapshot,
  prior: SwingServingSnapshot | null,
  opts?: { freshSpotsByTicker?: Record<string, number> },
): SwingServingSnapshot {
  if (!prior) return fresh;
  const freshByTicker = new Map(
    (fresh.plays ?? []).map((p) => [p.ticker.toUpperCase(), p] as const),
  );
  const extraSpots = opts?.freshSpotsByTicker ?? {};
  const triples = legacyPromotedTriplesFromSnapshot(prior)
    .map((t) => {
      const ticker = t.watch.ticker.toUpperCase();
      const spot =
        extraSpots[ticker] ?? fresh.spotsByTicker?.[ticker] ?? prior.spotsByTicker?.[ticker] ?? null;
      const refreshed = refreshCarriedLegacyPlay(t.play, fresh.sessionDay, freshByTicker, {
        dossier: t.dossier,
        spot,
        asOf: fresh.asOf,
      });
      return refreshed ? { ...t, play: refreshed } : null;
    })
    .filter((t): t is NonNullable<typeof t> => t != null);
  if (triples.length === 0) return fresh;
  const legacyTickers = new Set(triples.map((t) => t.watch.ticker.toUpperCase()));
  const stripped = stripTickersFromSnapshot(fresh, legacyTickers);
  return mergeLegacyPromotedSnapshot(stripped, triples, {
    sessionDay: fresh.sessionDay,
    asOf: fresh.asOf,
    spotsByTicker: { ...(prior.spotsByTicker ?? {}), ...(fresh.spotsByTicker ?? {}) },
  });
}

/**
 * GRADUATION BRIDGE (fixed 2026-10-01): Legacy-promoted triples whose LIVE-recomputed maturity has
 * reached the SAME observable gate `serving.ts`'s router requires for an organic candidate to reach
 * COMMIT_NOW — `setupState==="TRIGGERED"` AND `entryStatus` at `"AT_TRIGGER"`/`"PULLBACK_TO_ENTRY"` —
 * become real `SwingCommitCandidate`s, built from their OWN already-materialized dossier/contract (no
 * new fetch needed). The caller (discovery.ts's commit loop) appends these onto its existing
 * `commitCandidates` array BEFORE calling the real, unmodified `computeSwingCommitPlan` — so every
 * real-time gate (G-S3/G-S4/G-S6/G-S12/G-S14, armed budget, book-percent caps, idempotency) applies
 * exactly as it does to an organic candidate. A triple still FORMING/EXTENDED, or PRE_TRIGGER, or
 * INVALIDATED, or with no attached contract, is never included — it stays served WATCH/RESEARCH,
 * exactly like an organic candidate in the same observable state would.
 *
 * `discoveryPaths` deliberately does NOT invent a "NIGHT HAWK" kind — see the file header. Pass
 * `pathsByTicker` (the same per-scan Tier-0 provenance map discovery.ts already builds) so a Legacy
 * ticker that ALSO happens to be independently screened by organic FLOW/STRUCTURE/etc. this scan
 * gets credit for that real corroboration; a Legacy-only name legitimately carries an empty path set
 * and will block on G-S6 confluence like any other under-corroborated single-source candidate.
 */
export function legacyCommitCandidatesFromSnapshot(
  triples: ReadonlyArray<{ dossier: SwingDossier; play: HorizonPlay; watch: SwingWatchCandidate }>,
  opts: { sessionDate: string; pathsByTicker?: ReadonlyMap<string, readonly string[]> },
): SwingCommitCandidate[] {
  const out: SwingCommitCandidate[] = [];
  for (const t of triples) {
    const { play, dossier } = t;
    if (play.setupState !== "TRIGGERED") continue;
    if (play.entryStatus !== "AT_TRIGGER" && play.entryStatus !== "PULLBACK_TO_ENTRY") continue;
    if (!play.contract) continue;
    const ticker = play.ticker.toUpperCase();
    const direction: PlayDirection | null =
      play.direction === "LONG" || play.direction === "SHORT" ? play.direction : null;
    if (!direction) continue;
    const discoveryPaths = (opts.pathsByTicker?.get(ticker) ?? []) as SwingDiscoveryPath[];
    out.push({
      ticker,
      direction,
      archetype: dossier.archetype.archetype ?? null,
      subLane: dossier.subLane ?? null,
      score: typeof play.score === "number" ? play.score : 0,
      contract: play.contract,
      sessionDate: opts.sessionDate,
      entryUnderlyingPx: dossier.plan?.entryUnderlyingPx ?? null,
      thesisInvalidationPx: dossier.plan?.thesisInvalidationPx ?? null,
      targetUnderlyingPx: dossier.plan?.targetUnderlyingPx ?? null,
      topFlowStrike: null,
      pillars: dossier.pillarSignals ?? null,
      presentPillars: dossier.dataQuality?.presentPillars ?? null,
      dataQualityDegraded: dossier.dataQuality?.degraded ?? null,
      ivRank: dossier.ivRank ?? null,
      discoveryPaths,
      earningsInWindow: false,
      halted: false,
      dailyBarComplete: true,
    });
  }
  return out;
}

/**
 * Drop committed Legacy tickers from the persisted serving snapshot — the Legacy-lane counterpart of
 * `reconcileDiscoveryAfterCommit` (discovery.ts), which already does this for organic watchCandidates.
 * Without this, a Legacy thesis that just opened a REAL position (via `legacyCommitCandidatesFromSnapshot`
 * above) would keep being carried forward as a WATCH row too, showing the same thesis twice.
 */
export function removeCommittedLegacyFromSnapshot(
  snap: SwingServingSnapshot,
  committedTickers: ReadonlySet<string>,
): SwingServingSnapshot {
  if (committedTickers.size === 0) return snap;
  return stripTickersFromSnapshot(snap, new Set([...committedTickers].map((t) => t.toUpperCase())));
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

    // ATR-grounded plan levels (FINDINGS 2026-08-06 P2 follow-up, fix) — fail-soft: a fetch failure or thin
    // history just falls back to Legacy's own levels inside buildLegacySwingArtifacts, never blocks promotion.
    const nameCloses = await fetchLegacyPromoteCloses(ticker, Date.parse(opts.checkedAt) || Date.now());

    const artifact = buildLegacySwingArtifacts({
      play,
      checkedAt: opts.checkedAt,
      editionFor: opts.editionFor,
      spot,
      chainRows,
      chainSpot,
      nameCloses,
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
