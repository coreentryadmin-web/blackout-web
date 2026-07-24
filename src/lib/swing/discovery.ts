// src/lib/swing/discovery.ts — THE one whole-market swing discovery core (PR-11, resolves SEV-3).
//
// The single discovery path for the swing lane (SEV-3: the drafts each had their own scan). It is
// two-tier and whole-market:
//
//   TIER-0 (cheap, whole-market) — two independent screens surface candidate NAMES:
//     • FLOW screen: the multi-day accumulation engine (`accumulationSignalsFromFlow` →
//       `flowAccumulationByTicker`) over a 120h flow window — names with DIRECTIONAL stacked positioning.
//     • STRUCTURE screen: `screenBreakoutMovers` over Polygon grouped-daily — closed-strong, high-volume
//       breakout movers across the ENTIRE market.
//   MERGE — union the two screens, unioning provenance paths. A name on BOTH is corroborated (ranked first
//   for the Tier-1 budget). Crucially, a STRUCTURE-only name with NO flow still passes through (FM#1): it
//   just carries a null accumulation read and produces a dossier without the FLOW pillar — never dropped
//   merely because it has no options flow.
//
//   TIER-1 (per-name, budget-capped) — enrich each merged name: assemble its multi-day reads
//   (`ingestSwingReads`, injected) → `buildSwingDossier` (which runs `scoreSwingPillars` internally) →
//   feed the scored, directional dossiers to `produceHorizonPlays`.
//
// PERSISTENCE-GATED (the whole point of a SWING engine vs a same-day lottery): a candidate is only promoted
// to the WATCH rail once its thesis has PERSISTED across ≥2 distinct session days (accumulation-store).
// A first-sighting candidate is OBSERVED (accreted into the memory) but stays BELOW the WATCH bar this run.
//
// EVIDENCE-ONLY (`commitEligibleCount` held at 0): PR-11 wires a WATCH-only rail. Nothing here COMMITs or
// sizes risk — the lane isn't authorized to commit until its archetype×sub-lane bucket graduates (PR-16).
//
// SHAPE: `deriveSwingCandidates` + the merge/rank helpers are PURE and deterministic (unit-testable on fixed
// inputs). `runSwingDiscoveryScan` is the thin IO shell — every fetch/accessor is INJECTED, so the whole
// orchestration is testable without a live DB or provider (Postgres/WS are blocked in the sandbox anyway).

import { buildSwingDossier, type SwingDossier, type SwingDossierInput } from "./dossier";
import {
  observeSwingCandidate,
  fetchWatchEligible,
  MIN_PERSISTENCE_SESSIONS,
  type SwingAccumAccessors,
  type SwingWatchCandidate,
} from "./accumulation-store";
import type { MinimalFlowRow } from "../zerodte/flow-accumulation-context";
import { accumulationSignalsFromFlow } from "../zerodte/flow-accumulation-context";
import type { FlowAccumulationSignal } from "@/features/nighthawk/lib/flow-accumulation";
import {
  screenBreakoutMovers,
  isExcludedInstrument,
  type BreakoutMover,
} from "@/features/nighthawk/lib/candidates";
import {
  produceHorizonPlays,
  type HorizonCandidate,
  type HorizonPlaySet,
} from "../horizon-plays";
import type { PlayDirection } from "../horizon-fanout";
import type { SwingArchetype } from "./taxonomy";

// ─── WHY RECALL MATTERS (operator critique #7) ──────────────────────────────────
// A discovery funnel is easy to optimize for PRECISION (everything that surfaces is good) while
// silently destroying RECALL (a genuinely strong candidate never surfaces) — and recall damage is
// INVISIBLE by construction: you only see what came out, never what the funnel dropped. Two silent
// leaks live in THIS funnel:
//   (a) the top-N Tier-1 budget CAP — `rankTierZeroSeeds(...).slice(0, tier1Cap)` — can drop a name
//       whose Tier-0 rank sat right at the floor of the enriched set. Nothing downstream ever learns
//       that name existed. This is the load-bearing leak; `cappedOut`/`cappedOutCount` make it VISIBLE.
//   (b) per-cut erosion — one archetype / liquidity band / regime can lose a disproportionate share of
//       its candidates to thin (degraded) reads while the headline count looks healthy.
// The `SwingDiscoveryRecall` object below is EVIDENCE-ONLY instrumentation: it changes NOTHING about
// what surfaces (identical dossiers/watch/plays); it just measures the funnel so a recall collapse is
// observable instead of silent. `computeSwingDiscoveryRecall` is PURE/deterministic on fixed inputs.

/** Which Tier-0 screen(s) surfaced a name — provenance carried through the merge for ranking + explain. */
export type SwingDiscoveryPath = "FLOW" | "STRUCTURE";

/** Discovery cadence phase. The plan ships POST_CLOSE first (cleanest full-session accumulation read); the
 *  other phases land in PR-13. Accreted into the accumulation memory's `phases_seen`. */
export type SwingDiscoveryPhase = "POST_CLOSE" | "PRE_OPEN" | "MIDDAY" | "POWER_HOUR" | "OVERNIGHT";

/** A merged Tier-0 candidate: a name with the union of the screens that surfaced it. */
export interface TierZeroSeed {
  ticker: string;
  paths: SwingDiscoveryPath[];
}

/** A Tier-1-enriched seed: the merged name plus the assembled dossier input the pure core scores. */
export interface SwingCandidateSeed {
  ticker: string;
  paths: SwingDiscoveryPath[];
  input: SwingDossierInput;
}

export interface SwingDiscoveryConfig {
  /** Multi-day flow window (hours) — 120h ≈ a week of stacked positioning (no max_dte cap, unlike 0DTE). */
  flowWindowHours: number;
  /** Max breakout movers the structure screen keeps (ranked by $-volume). */
  maxStructureMovers: number;
  /** Top-N merged names to enrich in Tier-1 — bounds the per-name fetch cost under the cron budget. */
  tier1Cap: number;
  /** Distinct session days a candidate must persist before promotion to the WATCH rail. */
  minPersistenceSessions: number;
  /** The DTE the thesis intends to trade (resolves the sub-lane); STANDARD (14d) is the neutral default. */
  intendedDte: number;
}

export const DEFAULT_SWING_DISCOVERY_CONFIG: SwingDiscoveryConfig = {
  flowWindowHours: 120,
  maxStructureMovers: 40,
  tier1Cap: 40,
  minPersistenceSessions: MIN_PERSISTENCE_SESSIONS,
  intendedDte: 14,
};

/** How many accumulating rows to pull when reading the WATCH-eligible rail. Matches the accumulation-store
 *  accessor default; ample for a whole-market rail where only persisted names surface. */
export const WATCH_ELIGIBLE_FETCH_LIMIT = 500;

// ─── PURE Tier-0 merge + rank ────────────────────────────────────────────────────

/**
 * Union the FLOW and STRUCTURE screens into one deduped candidate list, unioning provenance paths. Excluded
 * instruments (indices/leveraged ETPs/SPAC units) are dropped as a belt (the structure screen already
 * excludes them; the flow screen may not). Deterministic: sorted by ticker so the merge is stable.
 */
export function mergeTierZeroScreens(
  flowTickers: string[],
  structureTickers: string[],
): TierZeroSeed[] {
  const paths = new Map<string, Set<SwingDiscoveryPath>>();
  const add = (raw: string, path: SwingDiscoveryPath) => {
    const t = String(raw ?? "").toUpperCase();
    if (!t || isExcludedInstrument(t)) return;
    const cur = paths.get(t) ?? new Set<SwingDiscoveryPath>();
    cur.add(path);
    paths.set(t, cur);
  };
  for (const t of flowTickers) add(t, "FLOW");
  for (const t of structureTickers) add(t, "STRUCTURE");

  return Array.from(paths.entries())
    .map(([ticker, set]) => ({
      ticker,
      // Stable path order (FLOW before STRUCTURE) so provenance is deterministic.
      paths: (["FLOW", "STRUCTURE"] as SwingDiscoveryPath[]).filter((p) => set.has(p)),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Rank merged seeds for the Tier-1 budget: CORROBORATED names (both screens) first, then by flow-accumulation
 * strength, then by breakout $-volume, then ticker (deterministic tie-break). This spends the per-name fetch
 * budget on the names with the most independent evidence.
 */
export function rankTierZeroSeeds(
  seeds: TierZeroSeed[],
  accSignals: Map<string, FlowAccumulationSignal>,
  moverByTicker: Map<string, BreakoutMover>,
): TierZeroSeed[] {
  const strengthOf = (t: string) => accSignals.get(t)?.strength ?? 0;
  const dollarOf = (t: string) => moverByTicker.get(t)?.dollar ?? 0;
  return [...seeds].sort((a, b) => {
    if (b.paths.length !== a.paths.length) return b.paths.length - a.paths.length; // corroborated first
    const ds = strengthOf(b.ticker) - strengthOf(a.ticker);
    if (ds !== 0) return ds;
    const dd = dollarOf(b.ticker) - dollarOf(a.ticker);
    if (dd !== 0) return dd;
    return a.ticker.localeCompare(b.ticker);
  });
}

/**
 * PURE core: turn enriched candidate seeds into scored dossiers. One `buildSwingDossier` per seed (which runs
 * the archetype classifier + 7-pillar scorer internally), sorted by score (desc) then ticker (asc) so the
 * output is deterministic on fixed inputs. A flow-less structure-only seed still yields a dossier here — its
 * accumulation read is null, so it simply scores without the FLOW pillar (FM#1). Nothing is filtered out on
 * score: the gate/persistence layer decides what surfaces, not this producer.
 */
export function deriveSwingCandidates(seeds: SwingCandidateSeed[]): SwingDossier[] {
  return seeds
    .map((s) => buildSwingDossier(s.input))
    .sort((a, b) => b.score.score - a.score.score || a.ticker.localeCompare(b.ticker));
}

/**
 * The independent SIGNAL KINDS a scan sighting carries for corroboration (accumulation-store's anti-lone-print
 * gate): the Tier-0 SCREEN provenance (FLOW / STRUCTURE) the name surfaced under, PLUS "CATALYST" when its
 * dossier grounded the CATALYST pillar (a genuinely independent read from the flow/structure screens). This is
 * the honest independence axis — distinct KINDS of evidence — NOT the cadence phase the writers also stamp
 * (see the `hasCorroboration` note in accumulation-store.ts). Two FLOW sightings across cadence windows are one
 * kind; a FLOW print AND a CATALYST (or a STRUCTURE breakout) are two. PURE. */
export function signalKindsForObservation(
  paths: SwingDiscoveryPath[],
  dossier: SwingDossier,
): string[] {
  const kinds = new Set<string>(paths); // FLOW / STRUCTURE — the Tier-0 screens that surfaced the name
  if (dossier.pillarSignals.CATALYST != null) kinds.add("CATALYST"); // a grounded catalyst = an independent signal
  return [...kinds];
}

// ─── PURE recall instrumentation (evidence-only — see the WHY-RECALL header) ────────

/** One funnel cut: how many candidates were `seen` in this bucket vs how many survived as a usable
 *  (`enriched`, non-degraded) read. `recall = enriched/seen` is the within-cut survival rate. */
export interface RecallCut {
  seen: number;
  enriched: number;
}

/** A candidate the top-N cap dropped — surfaced (bounded sample) so a strong name lost purely to the
 *  budget is VISIBLE, not silent. `tier0Rank` is 1-based over the full ranked order (pre-cap). */
export interface SwingCappedOutEntry {
  ticker: string;
  tier0Rank: number;
  reason: string;
}

/** Discovery-recall metrics emitted alongside the dossiers. Pure/deterministic on fixed inputs. */
export interface SwingDiscoveryRecall {
  /** Candidates that passed Tier-0 (the deduped merged union). */
  tier0Count: number;
  tier0FlowCount: number;
  tier0StructureCount: number;
  mergedCount: number;
  /** Names that actually produced a dossier in Tier-1 (post-cap, minus un-groundable enrich failures). */
  tier1EnrichedCount: number;
  /** Candidates that passed Tier-0 but were dropped purely by the top-N cap (the load-bearing leak). */
  cappedOutCount: number;
  /** Bounded sample of the capped-out names, worst-rank first, flagged when near the enriched floor. */
  cappedOut: SwingCappedOutEntry[];
  /** Per-cut seen/enriched over the surfaced dossiers (keys derived from the dossier itself). */
  byArchetype: Record<string, RecallCut>;
  byLiquidityTier: Record<string, RecallCut>;
  byRegime: Record<string, RecallCut>;
}

/** Bucket a breakout-mover's $-volume into a coarse liquidity tier (flow-only names have no $-vol → UNKNOWN). */
export function liquidityTierForDollar(dollar: number | null | undefined): string {
  if (dollar == null || !Number.isFinite(dollar) || dollar <= 0) return "UNKNOWN";
  if (dollar >= 1e9) return "MEGA";
  if (dollar >= 2.5e8) return "LARGE";
  if (dollar >= 5e7) return "MID";
  return "SMALL";
}

/** Bucket a normalized (0–1) regime read into a named band; null/absent → UNKNOWN. */
export function regimeBandFor01(regime01: number | null | undefined): string {
  if (regime01 == null || !Number.isFinite(regime01)) return "UNKNOWN";
  if (regime01 >= 0.66) return "RISK_ON";
  if (regime01 >= 0.34) return "NEUTRAL";
  return "RISK_OFF";
}

/**
 * PURE: compute the discovery-recall metrics for one scan. See the WHY-RECALL header for the motivation.
 *
 * Funnel level (the "silently dropped a candidate" leak): `tier0Count → tier1EnrichedCount`, plus the
 * candidates the top-N cap severed (`cappedOut`/`cappedOutCount`). A capped name is flagged NEAR ENRICHED
 * FLOOR when it's corroborated (both screens) or its flow-accumulation strength meets/exceeds the WEAKEST
 * strength among the names that DID get enriched — i.e. it was no weaker than something we kept, so the cap,
 * not the evidence, is why it's gone.
 *
 * Per-cut level (`byArchetype`/`byLiquidityTier`/`byRegime`): computed over the SURFACED dossiers, where
 * `seen` = a dossier exists in that bucket and `enriched` = that dossier's read is usable (not degraded).
 * `recall = enriched/seen` is the within-cut trustworthy-survival rate — it exposes a bucket bleeding
 * candidates to thin reads even when the headline count looks fine. `seen` sums to `dossiers.length` across
 * a cut's buckets by construction (every dossier lands in exactly one bucket per cut).
 */
export function computeSwingDiscoveryRecall(args: {
  tier0FlowCount: number;
  tier0StructureCount: number;
  merged: TierZeroSeed[];
  /** The FULL ranked order (pre-cap) — needed to know each capped name's rank + who was severed. */
  rankedFull: TierZeroSeed[];
  tier1Cap: number;
  /** The dossiers actually produced in Tier-1 (post-cap, post-enrich). */
  dossiers: SwingDossier[];
  accSignals?: Map<string, FlowAccumulationSignal>;
  moverByTicker?: Map<string, BreakoutMover>;
  /** Max capped-out entries to sample (bounded so the log/JSON stays small). Default 20. */
  cappedSampleLimit?: number;
}): SwingDiscoveryRecall {
  const {
    tier0FlowCount,
    tier0StructureCount,
    merged,
    rankedFull,
    tier1Cap,
    dossiers,
    accSignals,
    moverByTicker,
    cappedSampleLimit = 20,
  } = args;

  const strengthOf = (t: string) => accSignals?.get(t.toUpperCase())?.strength ?? 0;

  // The enriched-set floor = the weakest flow strength we chose to KEEP. A capped name at/above this floor
  // was no weaker than something enriched → its exclusion is the cap's doing, not the evidence's.
  const enrichedStrengths = dossiers.map((d) => strengthOf(d.ticker));
  const floorStrength = enrichedStrengths.length ? Math.min(...enrichedStrengths) : 0;

  const cappedSeeds = rankedFull.slice(Math.max(0, tier1Cap)); // everything beyond the top-N budget
  const cappedOut: SwingCappedOutEntry[] = cappedSeeds
    .map((seed, i) => {
      const rank = tier1Cap + i + 1; // 1-based rank in the full ranked order
      const strength = strengthOf(seed.ticker);
      const corroborated = seed.paths.length >= 2;
      const nearFloor = corroborated || (strength > 0 && strength >= floorStrength);
      const reason =
        `dropped by top-${tier1Cap} cap (rank ${rank}/${rankedFull.length}; ` +
        `paths ${seed.paths.join("+")}; flowStrength ${strength})` +
        (nearFloor ? " — NEAR ENRICHED FLOOR" : "");
      return { ticker: seed.ticker, tier0Rank: rank, reason };
    })
    // Corroborated / near-floor names first (the ones whose loss actually matters), else by rank.
    .sort((a, b) => {
      const an = a.reason.includes("NEAR ENRICHED FLOOR") ? 0 : 1;
      const bn = b.reason.includes("NEAR ENRICHED FLOOR") ? 0 : 1;
      return an - bn || a.tier0Rank - b.tier0Rank;
    })
    .slice(0, cappedSampleLimit);

  // ── Per-cut seen/enriched over the surfaced dossiers. ──
  const bump = (rec: Record<string, RecallCut>, key: string, usable: boolean) => {
    const cur = rec[key] ?? { seen: 0, enriched: 0 };
    cur.seen += 1;
    if (usable) cur.enriched += 1;
    rec[key] = cur;
  };
  const byArchetype: Record<string, RecallCut> = {};
  const byLiquidityTier: Record<string, RecallCut> = {};
  const byRegime: Record<string, RecallCut> = {};
  for (const d of dossiers) {
    const usable = !d.dataQuality.degraded;
    bump(byArchetype, d.archetype.archetype ?? "unclassified", usable);
    bump(byLiquidityTier, liquidityTierForDollar(moverByTicker?.get(d.ticker.toUpperCase())?.dollar), usable);
    bump(byRegime, regimeBandFor01(d.pillarSignals.REGIME ?? null), usable);
  }

  return {
    tier0Count: merged.length,
    tier0FlowCount,
    tier0StructureCount,
    mergedCount: merged.length,
    tier1EnrichedCount: dossiers.length,
    cappedOutCount: cappedSeeds.length,
    cappedOut,
    byArchetype,
    byLiquidityTier,
    byRegime,
  };
}

// ─── IO shell ─────────────────────────────────────────────────────────────────────

/** Everything the shell needs, INJECTED so the orchestration is testable without live DB/providers. */
export interface SwingDiscoveryDeps {
  /** Pull the 120h multi-day flow window (db.fetchRecentFlows mapped to MinimalFlowRow — NO max_dte cap). */
  fetchFlowWindow: () => Promise<MinimalFlowRow[]>;
  /** Pull the whole-market grouped-daily bars (polygon.fetchDailyMarketSummary results). */
  fetchGroupedDaily: () => Promise<
    Array<{ T?: string; o?: number; h?: number; l?: number; c?: number; v?: number }>
  >;
  /** SPY ascending daily closes — fetched ONCE, passed into every Tier-1 enrich (relative-strength base). */
  fetchSpyCloses: () => Promise<number[]>;
  /** Tier-1 enrich: assemble the dossier input for a name (swing-ingest). Null → the name is dropped. */
  enrichCandidate: (
    seed: TierZeroSeed,
    ctx: {
      accumulation: FlowAccumulationSignal | null;
      mover: BreakoutMover | null;
      spyCloses: number[];
      asOf: string;
      sessionDay: string;
      intendedDte: number;
    },
  ) => Promise<SwingDossierInput | null>;
  /** The PR-10 accumulation accessors (persistence memory). */
  accum: SwingAccumAccessors;
  /** OPTIONAL: fetch a name's option chain to attach a concrete WATCH contract (produceHorizonPlays). When
   *  absent, the play set is empty — the WATCH rail is still driven by persistence, not by a contract. */
  fetchChainRows?: (ticker: string) => Promise<HorizonCandidate["chainRows"]>;
  nowMs: number;
  /** ET session day (YYYY-MM-DD) the scan is anchored to — the distinct-day persistence key. */
  sessionDay: string;
  phase: SwingDiscoveryPhase;
  config?: Partial<SwingDiscoveryConfig>;
}

/** What one discovery scan surfaces. `commitEligibleCount` is a LITERAL 0 — the WATCH-only rail (see header). */
export interface SwingDiscoveryResult {
  asOf: string;
  sessionDay: string;
  phase: SwingDiscoveryPhase;
  /** Names surfaced by the Tier-0 FLOW screen (directional multi-day accumulation). */
  tier0FlowCount: number;
  /** Names surfaced by the Tier-0 STRUCTURE screen (breakout movers). */
  tier0StructureCount: number;
  /** Deduped merged candidates (before the Tier-1 budget cap). */
  mergedCount: number;
  /** Names actually enriched in Tier-1 (post-cap, minus those with no groundable reads). */
  enrichedCount: number;
  /** The scored dossiers (both paths; includes flow-less structure-only dossiers — FM#1). */
  dossiers: SwingDossier[];
  /** Candidates that have cleared the cross-session persistence bar AND appear in this scan → the WATCH rail. */
  watchCandidates: SwingWatchCandidate[];
  watchCount: number;
  /** Concrete WATCH plays with a liquid contract (empty unless `fetchChainRows` is provided). */
  playSet: HorizonPlaySet;
  /** LITERAL 0 — PR-11 is a WATCH-only, evidence-only rail; nothing is authorized to commit yet. */
  commitEligibleCount: 0;
  /** Discovery-recall instrumentation (evidence-only; does NOT change what surfaces). See WHY-RECALL header. */
  recall: SwingDiscoveryRecall;
}

/**
 * Run one whole-market swing discovery scan (two-tier, persistence-gated, WATCH-only). See the file header
 * for the full pipeline. Every side-effecting step is injected via `deps`, so this is deterministic given
 * its deps and unit-testable with fakes.
 */
export async function runSwingDiscoveryScan(
  deps: SwingDiscoveryDeps,
): Promise<SwingDiscoveryResult> {
  const cfg: SwingDiscoveryConfig = { ...DEFAULT_SWING_DISCOVERY_CONFIG, ...deps.config };
  const asOf = new Date(deps.nowMs).toISOString();

  // ── TIER-0 FLOW: multi-day accumulation over the flow window → directional names. ──
  const flows = await deps.fetchFlowWindow();
  const accSignals = accumulationSignalsFromFlow(flows, deps.nowMs);
  const flowTickers: string[] = [];
  for (const [ticker, sig] of accSignals) {
    // Only DIRECTIONAL accumulation seeds a swing thesis; a neutral name has no side to trade.
    if (sig.direction !== "neutral") flowTickers.push(ticker);
  }

  // ── TIER-0 STRUCTURE: whole-market breakout movers (already excludes ETPs/units). ──
  const grouped = await deps.fetchGroupedDaily();
  const movers = screenBreakoutMovers(grouped, cfg.maxStructureMovers);
  const moverByTicker = new Map<string, BreakoutMover>(movers.map((m) => [m.ticker.toUpperCase(), m]));
  const structureTickers = movers.map((m) => m.ticker);

  // ── MERGE + rank + cap to the Tier-1 budget. ──
  const merged = mergeTierZeroScreens(flowTickers, structureTickers);
  // Keep the FULL ranked order so the recall instrumentation can see WHO the top-N cap severed (not just
  // the survivors). The behavior is unchanged — only `ranked` (the capped slice) feeds Tier-1.
  const rankedFull = rankTierZeroSeeds(merged, accSignals, moverByTicker);
  const ranked = rankedFull.slice(0, cfg.tier1Cap);

  // ── TIER-1 enrich (one SPY fetch shared across every name). ──
  const spyCloses = await deps.fetchSpyCloses();
  const candidateSeeds: SwingCandidateSeed[] = [];
  for (const seed of ranked) {
    const input = await deps.enrichCandidate(seed, {
      accumulation: accSignals.get(seed.ticker) ?? null,
      mover: moverByTicker.get(seed.ticker) ?? null,
      spyCloses,
      asOf,
      sessionDay: deps.sessionDay,
      intendedDte: cfg.intendedDte,
    });
    if (input) candidateSeeds.push({ ticker: seed.ticker, paths: seed.paths, input });
  }

  // ── SCORE (pure). ──
  const dossiers = deriveSwingCandidates(candidateSeeds);

  // ── RECALL (pure, evidence-only): measure the funnel so a dropped-strong-candidate is VISIBLE. ──
  const recall = computeSwingDiscoveryRecall({
    tier0FlowCount: flowTickers.length,
    tier0StructureCount: structureTickers.length,
    merged,
    rankedFull,
    tier1Cap: cfg.tier1Cap,
    dossiers,
    accSignals,
    moverByTicker,
  });
  // One-line recall summary in the shell (the funnel + the load-bearing capped-out leak).
  const nearFloor = recall.cappedOut.filter((c) => c.reason.includes("NEAR ENRICHED FLOOR")).length;
  console.info(
    `[swing-discovery] recall: tier0 ${recall.tier0Count} (flow ${recall.tier0FlowCount}/struct ${recall.tier0StructureCount}) ` +
      `→ enriched ${recall.tier1EnrichedCount}; capped-out ${recall.cappedOutCount}` +
      (recall.cappedOutCount ? ` (${nearFloor} near enriched floor)` : ""),
  );

  // ── PERSISTENCE: observe each directional dossier this session, then read who has cleared the bar. ──
  // The Tier-0 screen provenance (seed.paths) lives on the candidate seeds, not on the scored dossier, so map
  // ticker → paths to accrete the real SIGNAL KINDS (FLOW/STRUCTURE[+CATALYST]) into the corroboration set.
  const pathsByTicker = new Map<string, SwingDiscoveryPath[]>(
    candidateSeeds.map((s) => [s.ticker.toUpperCase(), s.paths]),
  );
  // (ticker,direction) → archetype resolver for this scan's dossiers — makes WATCH promotion ARCHETYPE-AWARE
  // so an event/immediate archetype (EVENT_DRIVEN / POST_EARNINGS_DRIFT / FAILED_BREAKDOWN) can clear on a
  // single CORROBORATED session (its intended 1-session fast-track) instead of the conservative 2-session
  // default that fetchWatchEligible falls back to WITHOUT a resolver.
  const archetypeByKey = new Map<string, SwingArchetype | null>();
  for (const d of dossiers) {
    if (!d.direction) continue;
    archetypeByKey.set(`${d.ticker.toUpperCase()}|${d.direction}`, d.archetype.archetype);
    await observeSwingCandidate(deps.accum, {
      ticker: d.ticker,
      direction: d.direction,
      sessionDay: deps.sessionDay,
      phase: deps.phase,
      signalKinds: signalKindsForObservation(pathsByTicker.get(d.ticker.toUpperCase()) ?? [], d),
    });
  }
  // The WATCH rail = persistence-cleared candidates that ALSO appear in this scan (a stale memory row for a
  // name that didn't show up today is not surfaced here — fadeStaleAccum retires those on the cron path).
  const seenThisScan = new Set(
    dossiers.filter((d) => d.direction).map((d) => `${d.ticker}|${d.direction}`),
  );
  const eligible = await fetchWatchEligible(
    deps.accum,
    cfg.minPersistenceSessions,
    WATCH_ELIGIBLE_FETCH_LIMIT,
    (c) => archetypeByKey.get(`${c.ticker.toUpperCase()}|${c.direction}`) ?? null,
  );
  const watchCandidates = eligible.filter((c) => seenThisScan.has(`${c.ticker}|${c.direction}`));

  // ── OPTIONAL play production: attach a concrete WATCH contract when chains are available. ──
  let playSet: HorizonPlaySet = { ZERO_DTE: [], SWING: [], LEAPS: [] };
  if (deps.fetchChainRows) {
    const horizonCands: HorizonCandidate[] = [];
    for (const d of dossiers) {
      if (!d.direction) continue; // no side → no directional contract to fan out
      const chainRows = await deps.fetchChainRows(d.ticker);
      if (!chainRows || chainRows.length === 0) continue;
      horizonCands.push({
        ticker: d.ticker,
        direction: d.direction as PlayDirection,
        // Score the SWING lane by the dossier's evidence score; other lanes get no score → skipped.
        horizonScores: { SWING: d.score.score },
        asOfYmd: deps.sessionDay,
        chainRows,
      });
    }
    playSet = produceHorizonPlays(horizonCands);
  }

  return {
    asOf,
    sessionDay: deps.sessionDay,
    phase: deps.phase,
    tier0FlowCount: flowTickers.length,
    tier0StructureCount: structureTickers.length,
    mergedCount: merged.length,
    enrichedCount: candidateSeeds.length,
    dossiers,
    watchCandidates,
    watchCount: watchCandidates.length,
    playSet,
    // WATCH-only rail: PR-11 commits NOTHING. Held at 0 by construction, not derived — the lane graduates
    // to commit-eligible only when its archetype×sub-lane bucket clears the ladder (PR-16).
    commitEligibleCount: 0,
    recall,
  };
}
